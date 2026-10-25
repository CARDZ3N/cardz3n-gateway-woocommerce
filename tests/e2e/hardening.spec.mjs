// End-to-end check of three small server-side guards.
//
//  1. A payment source the store has switched off (here ACH and Apple Pay; only cards are on) is refused on the server,
//     before any request reaches the gateway, even if the browser claims that source. A card payment still goes through.
//  2. The Capture action only works on this gateway's orders that can still be captured: not on another gateway's order,
//     not on an order that is already captured, not on a cancelled order. A normal authorized order still captures.
//  3. The "gateway hidden" warning is logged once per reason, not on every page load.
//
// A tiny probe plugin (in the blueprint) short-circuits gateway HTTP, counting calls, and creates the test orders. No real keys,
// nothing is charged.
//
// Run (from the plugin folder, Node 18+):
//   npm i --no-save playwright && npx playwright install chromium
//   node tests/e2e/hardening.spec.mjs
// Environment (optional):
//   E2E_BASE_URL  use an already running site instead of starting a WordPress Playground on port 9407
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
  const port = '9407';
  const blueprint = join(pluginDir, 'tests', 'e2e', 'blueprint-hardening.json');
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

  await page.goto(base + '/wp-login.php', { waitUntil: 'domcontentloaded' });
  if (await page.locator('#user_login').count()) {
    await page.fill('#user_login', 'admin'); await page.fill('#user_pass', 'password');
    await Promise.all([page.waitForURL(/wp-admin/), page.click('#wp-submit')]);
  }
  const probe = async (qs) => { await page.goto(`${base}/?cardz3n_e2e=${qs}`, { waitUntil: 'domcontentloaded' }); return JSON.parse(await page.evaluate(() => document.body.innerText)); };

  // 1) Sources that are switched off are refused before the gateway is called.
  const ach = await probe('pay&src=ach');
  check('ACH switched off: the payment is refused', ach.result === 'failure', ach.result);
  check('ACH switched off: no request reaches the gateway', ach.http_calls === 0, `calls=${ach.http_calls}`);
  const apple = await probe('pay&src=applePay');
  check('Apple Pay switched off: the payment is refused and nothing is sent', apple.result === 'failure' && apple.http_calls === 0, `${apple.result}, calls=${apple.http_calls}`);
  const card = await probe('pay&src=card');
  check('Card (switched on): the payment still goes through', card.result === 'success' && card.http_calls === 1, `${card.result}, calls=${card.http_calls}`);

  // 2) Capture only on capturable orders of this gateway.
  const o = await probe('orders');
  const capture = async (id) => {
    const r = await ctx.request.post(base + '/wp-admin/admin-ajax.php', { form: { action: 'cardz3n_capture_order', nonce: o.nonce, order_id: String(id) }, timeout: 120000 });
    return { status: r.status(), body: await r.json().catch(() => ({})) };
  };
  const before = (await probe('count')).count;
  const other = await capture(o.other);
  check("Capture refuses another gateway's order", other.status === 400 && other.body.success === false, `status=${other.status}`);
  const captured = await capture(o.captured);
  check('Capture refuses an order that is already captured', captured.status === 400 && captured.body.success === false, `status=${captured.status}`);
  const cancelled = await capture(o.cancelled);
  check('Capture refuses a cancelled order', cancelled.status === 400 && cancelled.body.success === false, `status=${cancelled.status}`);
  check('None of those refusals reached the gateway', (await probe('count')).count === before);
  const ok = await capture(o.ok);
  check('Capture still works on a normal authorized order', ok.status === 200 && ok.body.success === true, `status=${ok.status}`);
  check('That capture reached the gateway once', (await probe('count')).count === before + 1);

  // 3) The "gateway hidden" warning is logged once per reason.
  const hidden = await probe('hidden');
  check('The hidden-gateway warning is logged once, not on every check', hidden.new_log_lines === 1, `new log lines=${hidden.new_log_lines}`);

  await browser.close();
} catch (e) {
  check('test run completed without an error', false, String(e.message).slice(0, 200));
} finally {
  if (server) { try { if (process.platform === 'win32') { spawn('taskkill', ['/PID', String(server.pid), '/T', '/F']); } else { server.kill(); } } catch { /* ignore */ } }
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
