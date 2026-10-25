// End-to-end check of two small guards.
//
//  1. Deleting a saved payment method (the "delete token" action) only works for a signed-in user, on that user's own saved
//     methods, and only for this gateway's methods. It must not delete another user's, another gateway's, or an ownerless
//     (guest) saved method.
//  2. A payment is not charged twice: submitting an order that is already paid, or already authorized, again sends the shopper
//     on without a second request to the gateway. A normal new order still charges.
//
// A tiny probe plugin (in the blueprint) creates the saved methods and orders and short-circuits gateway HTTP, counting calls.
// No real keys, nothing is charged.
//
// Run (from the plugin folder, Node 18+):
//   npm i --no-save playwright && npx playwright install chromium
//   node tests/e2e/delete-token-and-paid-guard.spec.mjs
// Environment (optional):
//   E2E_BASE_URL  use an already running site instead of starting a WordPress Playground on port 9408
//   PLUGIN_DIR    plugin folder to mount into Playground (default: the current folder)
//   PW_DIR        folder that contains node_modules/playwright, if it is not installed in the current folder
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const require = createRequire(process.env.PW_DIR ? join(process.env.PW_DIR, 'package.json') : join(process.cwd(), 'package.json'));
const { chromium } = require('playwright');

const pluginDir = resolve(process.env.PLUGIN_DIR || process.cwd());
let base = process.env.E2E_BASE_URL;
let server = null;

async function startPlayground() {
  const port = '9408';
  const blueprint = join(pluginDir, 'tests', 'e2e', 'blueprint-delete-token.json');
  server = spawn('npx', ['--yes', '@wp-playground/cli@latest', 'start', '--blueprint', blueprint, '--mount', './:/wordpress/wp-content/plugins/cardz3n-gateway', '--no-auto-mount', '--skip-browser', '--reset', '--port', port, '--php', '8.2'], { cwd: pluginDir, shell: true });
  await new Promise((ok, fail) => {
    const t = setTimeout(() => fail(new Error('Playground did not become ready in 6 minutes')), 360000);
    const onData = (d) => { if (/Ready! WordPress is running/.test(String(d))) { clearTimeout(t); ok(); } };
    server.stdout.on('data', onData); server.stderr.on('data', onData);
    server.on('exit', () => fail(new Error('Playground exited early')));
  });
  return `http://127.0.0.1:${port}`;
}

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`); };

try {
  if (!base) base = await startPlayground();
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.setDefaultTimeout(120000);
  const probeIn = async (p, qs) => { await p.goto(`${base}/?cardz3n_e2e=${qs}`, { waitUntil: 'domcontentloaded' }); return JSON.parse(await p.evaluate(() => document.body.innerText)); };

  // A signed-out visitor first (own context): get a guest nonce.
  const guestCtx = await browser.newContext();
  const guestPage = await guestCtx.newPage(); guestPage.setDefaultTimeout(120000);
  const guestNonce = (await probeIn(guestPage, 'nonce')).nonce;

  await page.goto(base + '/wp-login.php', { waitUntil: 'domcontentloaded' });
  if (await page.locator('#user_login').count()) {
    await page.fill('#user_login', 'admin'); await page.fill('#user_pass', 'password');
    await Promise.all([page.waitForURL(/wp-admin/), page.click('#wp-submit')]);
  }
  const t = await probeIn(page, 'tokens');
  const del = async (request, nonce, id) => {
    const r = await request.post(base + '/wp-admin/admin-ajax.php', { form: { action: 'cardz3n_delete_token', nonce, token_id: String(id) }, timeout: 120000 });
    return { status: r.status(), body: await r.json().catch(() => ({})) };
  };
  const exists = async (ids) => probeIn(page, `exists&ids=${ids.join(',')}`);

  const guest = await del(guestCtx.request, guestNonce, t.guest);
  check('A signed-out visitor cannot delete an ownerless saved method (WordPress itself refuses signed-out calls to this action)', (guest.status === 400 || guest.status === 403) && guest.body.success !== true, `status=${guest.status}`);
  const otherUser = await del(ctx.request, t.nonce, t.other_user);
  check("A signed-in user cannot delete another user's saved method", otherUser.status === 400 && otherUser.body.success === false, `status=${otherUser.status}`);
  const otherGw = await del(ctx.request, t.nonce, t.own_other);
  check("A signed-in user cannot delete their own saved method of ANOTHER gateway", otherGw.status === 400 && otherGw.body.success === false, `status=${otherGw.status}`);
  const still = await exists([t.guest, t.other_user, t.own_other]);
  check('Those three saved methods still exist', still[t.guest] && still[t.other_user] && still[t.own_other], JSON.stringify(still));
  const own = await del(ctx.request, t.nonce, t.own);
  check("A signed-in user can still delete their own saved method of this gateway", own.status === 200 && own.body.success === true, `status=${own.status}`);
  check('...and it is gone', (await exists([t.own]))[t.own] === false);

  // 2) No second charge for an order that is already paid or authorized.
  const paid = await probeIn(page, 'pay&state=paid');
  check('Already-paid order: submitted again, no second request to the gateway', paid.result === 'success' && paid.http_calls === 0, `${paid.result}, calls=${paid.http_calls}`);
  const authd = await probeIn(page, 'pay&state=authorized');
  check('Already-authorized order: submitted again, no second request to the gateway', authd.result === 'success' && authd.http_calls === 0, `${authd.result}, calls=${authd.http_calls}`);
  const fresh = await probeIn(page, 'pay&state=pending');
  check('A new unpaid order still charges once', fresh.result === 'success' && fresh.http_calls === 1, `${fresh.result}, calls=${fresh.http_calls}`);

  await browser.close();
} catch (e) {
  check('test run completed without an error', false, String(e.message).slice(0, 200));
} finally {
  if (server) { try { if (process.platform === 'win32') { spawn('taskkill', ['/PID', String(server.pid), '/T', '/F']); } else { server.kill(); } } catch { /* ignore */ } }
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
