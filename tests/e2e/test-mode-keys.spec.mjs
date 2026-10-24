// End-to-end check: in Test Mode the plugin never uses the live keys.
//
// Why: Test Mode used to fall back to the live keys (or to the legacy unified pair, which holds a store's live keys)
// when no test keys were saved, so a store with only live keys charged real cards while Test Mode was on.
//
// The site is set up with Test Mode ON, only LIVE keys saved (obviously fake values "LIVE-SEC" / "LIVE-TOK") and no test keys.
// A tiny probe plugin (in the blueprint) resolves keys for several settings shapes and records what an outgoing request
// would carry; HTTP is short-circuited, so nothing leaves the machine. No real keys, nothing is charged.
//
// Run (from the plugin folder, Node 18+):
//   npm i --no-save playwright && npx playwright install chromium
//   node tests/e2e/test-mode-keys.spec.mjs
// Environment (optional):
//   E2E_BASE_URL  use an already running site instead of starting a WordPress Playground on port 9405
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
  const port = '9405';
  const blueprint = join(pluginDir, 'tests', 'e2e', 'blueprint-test-mode-keys.json');
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
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  page.setDefaultTimeout(120000);

  // 1) Key resolution and what a request would carry.
  await page.goto(base + '/?cardz3n_e2e_probe=1', { waitUntil: 'domcontentloaded' });
  const probe = JSON.parse(await page.evaluate(() => document.body.innerText));
  const a = probe.test_mode_live_keys_only, b = probe.test_mode_unified_only, c = probe.test_mode_live_and_test, d = probe.live_mode_live_keys;
  check('Test Mode with only live keys: no key is resolved', a.security === '' && a.tokenization === '' && !a.has, JSON.stringify({ has: a.has }));
  check('Test Mode with only live keys: no request is sent, so no live key leaves', a.requests === 0 && !a.sent_live_key, `requests=${a.requests}`);
  check('Test Mode with only the legacy unified pair (live keys): no key is resolved', b.security === '' && b.tokenization === '' && !b.has);
  check('Test Mode with live and test keys: the test keys are used', c.security === 'TEST-SEC' && c.tokenization === 'TEST-TOK');
  check('Test Mode with live and test keys: the live key is never sent', c.requests >= 1 && !c.sent_live_key, `requests=${c.requests}`);
  check('Live Mode with live keys still works (live key is sent)', d.security === 'LIVE-SEC' && d.requests >= 1 && d.sent_live_key);

  // 2) The storefront: checkout is blocked and the live public key is never put on the page.
  await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
  const pid = await page.evaluate(() => fetch('/wp-json/wc/store/v1/products').then((r) => r.json()).then((p) => p[0].id));
  await page.goto(`${base}/?add-to-cart=${pid}`, { waitUntil: 'domcontentloaded' });
  await page.goto(base + '/checkout-classic/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('form.checkout');
  await page.waitForTimeout(4000);
  const html = await page.content();
  check('Checkout page: the gateway is not offered', (await page.locator('input[name="payment_method"][value="cardz3n_gateway"]').count()) === 0);
  check('Checkout page: the live public key is not on the page', !html.includes('LIVE-TOK'));

  // 3) The admin screen explains it.
  await page.goto(base + '/wp-login.php', { waitUntil: 'domcontentloaded' });
  if (await page.locator('#user_login').count()) {
    await page.fill('#user_login', 'admin'); await page.fill('#user_pass', 'password');
    await Promise.all([page.waitForURL(/wp-admin/), page.click('#wp-submit')]);
  }
  await page.goto(base + '/wp-admin/admin.php?page=wc-settings&tab=checkout&section=cardz3n_gateway', { waitUntil: 'domcontentloaded' });
  const text = await page.evaluate(() => document.body.innerText);
  check('Admin: a clear error says Test Mode has no test keys and checkout is blocked', /Test Mode is on but no Test keys are saved/.test(text));

  await browser.close();
} catch (e) {
  check('test run completed without an error', false, String(e.message).slice(0, 200));
} finally {
  if (server) { try { if (process.platform === 'win32') { spawn('taskkill', ['/PID', String(server.pid), '/T', '/F']); } else { server.kill(); } } catch { /* ignore */ } }
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
