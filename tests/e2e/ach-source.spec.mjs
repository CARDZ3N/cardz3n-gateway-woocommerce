// End-to-end check: on the CLASSIC checkout, a payment made from the Bank (ACH) tab must be sent with the ACH
// source type, and a card payment with the card source type.
//
// Why: Collect.js reports the same tokenType ("inline") for card and bank fields, and the plugin used to send that
// value as the payment source, so the server recorded bank payments as card payments.
//
// No keys, nothing is charged: Collect.js is replaced by a stub that, like the real one, answers tokenType "inline"
// for both, and the checkout request is intercepted and answered with a canned failure.
//
// Run (from the plugin folder, Node 18+):
//   npm i --no-save playwright && npx playwright install chromium
//   node tests/e2e/ach-source.spec.mjs
// Environment (optional):
//   E2E_BASE_URL  use an already running site instead of starting a WordPress Playground on port 9403
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
  const port = '9403';
  const blueprint = join(pluginDir, 'tests', 'e2e', 'blueprint-ach.json');
  server = spawn('npx', ['--yes', '@wp-playground/cli@latest', 'start', '--blueprint', blueprint, '--mount', './:/wordpress/wp-content/plugins/cardz3n-gateway', '--no-auto-mount', '--skip-browser', '--reset', '--port', port, '--php', '8.2'], { cwd: pluginDir, shell: true });
  await new Promise((ok, fail) => {
    const t = setTimeout(() => fail(new Error('Playground did not become ready in 6 minutes')), 360000);
    const onData = (d) => { if (/Ready! WordPress is running/.test(String(d))) { clearTimeout(t); ok(); } };
    server.stdout.on('data', onData); server.stderr.on('data', onData);
    server.on('exit', () => fail(new Error('Playground exited early')));
  });
  return `http://127.0.0.1:${port}`;
}

const STUB_COLLECT_JS = `
(function () {
  var cfg = null;
  window.CollectJS = {
    configure: function (c) { cfg = c; if (typeof c.fieldsAvailableCallback === 'function') { setTimeout(c.fieldsAvailableCallback, 50); } },
    startPaymentRequest: function () { setTimeout(function () { cfg.callback({ token: 'stub-token-123', tokenType: 'inline', check: { name: '', account: '', hash: '', aba: '' } }); }, 200); },
    clearInputs: function () {}
  };
})();`;

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`); };

async function placeOrder(browser, tab) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage(); page.setDefaultTimeout(120000);
  const requests = [];
  await page.route(/Collect\.js/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB_COLLECT_JS }));
  await page.route(/wc-ajax=checkout/, (route) => {
    requests.push(new URLSearchParams(route.request().postData() || ''));
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: 'failure', messages: '<ul class="woocommerce-error" role="alert"><li>e2e stub: request intercepted</li></ul>', refresh: false, reload: false }) });
  });
  await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
  const pid = await page.evaluate(() => fetch('/wp-json/wc/store/v1/products').then((r) => r.json()).then((p) => p[0].id));
  await page.goto(`${base}/?add-to-cart=${pid}`, { waitUntil: 'domcontentloaded' });
  await page.goto(base + '/checkout-classic/');
  await page.waitForSelector('form.checkout');
  for (const [id, v] of Object.entries({ billing_first_name: 'E2E', billing_last_name: 'Tester', billing_address_1: '888', billing_city: 'Los Angeles', billing_postcode: '77777', billing_phone: '5555550100', billing_email: 'e2e@example.com' })) await page.locator('#' + id).fill(v);
  await page.waitForTimeout(4000);
  if (tab === 'ach') { await page.locator('.cardz3n-tab[data-target="ach"]').click(); await page.waitForTimeout(1500); }
  await page.locator('#place_order').click();
  await page.waitForTimeout(5000);
  await ctx.close();
  return requests;
}

try {
  if (!base) base = await startPlayground();
  const browser = await chromium.launch({ headless: true });

  const ach = await placeOrder(browser, 'ach');
  check('Bank tab: one checkout request is sent', ach.length === 1, `requests=${ach.length}`);
  check('Bank tab: payment source is ach', ach[0] && ach[0].get('cardz3n_payment_source') === 'ach', ach[0] && ach[0].get('cardz3n_payment_source'));
  check('Bank tab: token type is ach', ach[0] && ach[0].get('cardz3n_token_type') === 'ach', ach[0] && ach[0].get('cardz3n_token_type'));

  const card = await placeOrder(browser, 'card');
  check('Card tab: one checkout request is sent', card.length === 1, `requests=${card.length}`);
  check('Card tab: payment source is card', card[0] && card[0].get('cardz3n_payment_source') === 'card', card[0] && card[0].get('cardz3n_payment_source'));
  check('Card tab: token type is card', card[0] && card[0].get('cardz3n_token_type') === 'card', card[0] && card[0].get('cardz3n_token_type'));

  await browser.close();
} catch (e) {
  check('test run completed without an error', false, String(e.message).slice(0, 200));
} finally {
  if (server) { try { if (process.platform === 'win32') { spawn('taskkill', ['/PID', String(server.pid), '/T', '/F']); } else { server.kill(); } } catch { /* ignore */ } }
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
