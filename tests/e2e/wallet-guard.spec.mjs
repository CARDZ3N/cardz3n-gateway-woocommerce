// End-to-end check: a browser whose ApplePaySession.canMakePayments() THROWS must still get the payment fields.
//
// Why: canMakePayments() throws (for example InvalidAccessError on a page that is not served over HTTPS). The throw used
// to stop the whole Collect.js setup, so the card and bank fields never mounted. Apple Pay must simply be left out.
//
// No keys, nothing is charged: Collect.js is replaced by a stub that records the configuration it is given.
//
// Run (from the plugin folder, Node 18+):
//   npm i --no-save playwright && npx playwright install chromium
//   node tests/e2e/wallet-guard.spec.mjs
// Environment (optional):
//   E2E_BASE_URL  use an already running site instead of starting a WordPress Playground on port 9404
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
  const port = '9404';
  // Same settings as the classic-settings test: ACH, Apple Pay, Google Pay and saved methods all enabled.
  const blueprint = join(pluginDir, 'tests', 'e2e', 'blueprint-classic-settings.json');
  server = spawn('npx', ['--yes', '@wp-playground/cli@latest', 'start', '--blueprint', blueprint, '--mount', './:/wordpress/wp-content/plugins/cardz3n-gateway', '--no-auto-mount', '--skip-browser', '--reset', '--port', port, '--php', '8.2'], { cwd: pluginDir, shell: true });
  await new Promise((ok, fail) => {
    const t = setTimeout(() => fail(new Error('Playground did not become ready in 6 minutes')), 360000);
    const onData = (d) => { if (/Ready! WordPress is running/.test(String(d))) { clearTimeout(t); ok(); } };
    server.stdout.on('data', onData); server.stderr.on('data', onData);
    server.on('exit', () => fail(new Error('Playground exited early')));
  });
  return `http://127.0.0.1:${port}`;
}

// Records the fields it is configured with, so the test can see whether setup ran and whether Apple Pay was included.
const STUB_COLLECT_JS = `
window.__configured = null;
window.CollectJS = {
  configure: function (c) { window.__configured = { fields: Object.keys(c.fields || {}) }; if (typeof c.fieldsAvailableCallback === 'function') { setTimeout(c.fieldsAvailableCallback, 50); } },
  startPaymentRequest: function () {},
  clearInputs: function () {}
};`;

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`); };

async function configuredFields(browser, applePayScript) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage(); page.setDefaultTimeout(120000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message)));
  await page.addInitScript(applePayScript);
  await page.route(/Collect\.js/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB_COLLECT_JS }));
  await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
  const pid = await page.evaluate(() => fetch('/wp-json/wc/store/v1/products').then((r) => r.json()).then((p) => p[0].id));
  await page.goto(`${base}/?add-to-cart=${pid}`, { waitUntil: 'domcontentloaded' });
  await page.goto(base + '/checkout-classic/');
  await page.waitForSelector('form.checkout');
  await page.waitForTimeout(5000);
  const configured = await page.evaluate(() => window.__configured);
  await ctx.close();
  return { configured, errors };
}

try {
  if (!base) base = await startPlayground();
  const browser = await chromium.launch({ headless: true });

  // 1) canMakePayments() throws: setup must still run, with the card and bank fields and without Apple Pay.
  const thrown = await configuredFields(browser, 'window.ApplePaySession = { canMakePayments: function () { throw new Error("InvalidAccessError: insecure document"); } };');
  check('canMakePayments throws: Collect.js is still configured', !!thrown.configured, thrown.errors[0] || '');
  check('canMakePayments throws: card fields are included', !!thrown.configured && thrown.configured.fields.includes('ccnumber'));
  check('canMakePayments throws: Apple Pay is left out', !!thrown.configured && !thrown.configured.fields.includes('applePay'));

  // 2) canMakePayments() returns true: Apple Pay is still offered (the guard must not switch the wallet off).
  const ok = await configuredFields(browser, 'window.ApplePaySession = { canMakePayments: function () { return true; } };');
  check('canMakePayments true: Collect.js is configured', !!ok.configured);
  check('canMakePayments true: Apple Pay is included', !!ok.configured && ok.configured.fields.includes('applePay'));

  await browser.close();
} catch (e) {
  check('test run completed without an error', false, String(e.message).slice(0, 200));
} finally {
  if (server) { try { if (process.platform === 'win32') { spawn('taskkill', ['/PID', String(server.pid), '/T', '/F']); } else { server.kill(); } } catch { /* ignore */ } }
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
