// End-to-end check for the CLASSIC (shortcode) checkout: the card token must be on the checkout request.
//
// Why: WooCommerce sends the checkout AJAX request as soon as its own submit handler runs, unless a gateway returns false
// from the `checkout_place_order_<gateway>` hook. This test fails if the request leaves before tokenization (empty token).
//
// No keys, no real gateway, nothing is charged: Collect.js is replaced by a stub that mints the fixed token "stub-token-123",
// and the checkout request is intercepted and answered with a canned failure.
//
// Run (from the plugin folder, Node 18+):
//   npm i --no-save playwright && npx playwright install chromium
//   node tests/e2e/classic-token.spec.mjs
// Environment (optional):
//   E2E_BASE_URL  use an already running site (admin/password) instead of starting a WordPress Playground on port 9401
//   PLUGIN_DIR    plugin folder to mount into Playground (default: the current folder)
//   PW_DIR        folder that contains node_modules/playwright, if it is not installed in the current folder
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const require = createRequire(process.env.PW_DIR ? join(process.env.PW_DIR, 'package.json') : join(process.cwd(), 'package.json'));
const { chromium } = require('playwright');

const pluginDir = resolve(process.env.PLUGIN_DIR || process.cwd());
const STUB_TOKEN = 'stub-token-123';
let base = process.env.E2E_BASE_URL;
let server = null;

async function startPlayground() {
  const port = '9401';
  const blueprint = join(pluginDir, 'tests', 'e2e', 'blueprint.json');
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
  window.__stub = { startCalls: [] };
  window.CollectJS = {
    configure: function (c) { cfg = c; if (typeof c.fieldsAvailableCallback === 'function') { setTimeout(c.fieldsAvailableCallback, 50); } },
    startPaymentRequest: function () {
      window.__stub.startCalls.push(Date.now());
      if (window.__stubMode === 'timeout') { setTimeout(function () { if (cfg && cfg.timeoutCallback) { cfg.timeoutCallback(); } }, 300); return; }
      setTimeout(function () { cfg.callback({ token: '${STUB_TOKEN}', tokenType: 'inline', card: { type: 'visa' } }); }, 300);
    },
    clearInputs: function () {}
  };
})();`;

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`); };

async function openCheckout(browser, mode) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage(); page.setDefaultTimeout(120000);
  const requests = [];
  await page.addInitScript((m) => { window.__stubMode = m; }, mode);
  await page.route(/Collect\.js/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB_COLLECT_JS }));
  await page.route(/wc-ajax=checkout/, (route) => {
    requests.push({ t: Date.now(), body: route.request().postData() || '' });
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: 'failure', messages: '<ul class="woocommerce-error" role="alert"><li>e2e stub: request intercepted</li></ul>', refresh: false, reload: false }) });
  });
  // Playground may log the browser in automatically; sign in only if the form is shown.
  await page.goto(base + '/wp-login.php', { waitUntil: 'domcontentloaded' });
  if (await page.locator('#user_login').count()) {
    await page.fill('#user_login', 'admin'); await page.fill('#user_pass', 'password');
    await Promise.all([page.waitForURL(/wp-admin/), page.click('#wp-submit')]);
  }
  const pid = await page.evaluate(() => fetch('/wp-json/wc/store/v1/products').then((r) => r.json()).then((p) => p[0].id));
  await page.goto(`${base}/?add-to-cart=${pid}`);
  await page.goto(base + '/checkout-classic/');
  await page.waitForSelector('form.checkout');
  for (const [id, v] of Object.entries({ billing_first_name: 'E2E', billing_last_name: 'Tester', billing_address_1: '888', billing_city: 'Los Angeles', billing_postcode: '77777', billing_phone: '5555550100', billing_email: 'e2e@example.com' })) await page.locator('#' + id).fill(v);
  await page.waitForTimeout(4000); // let WooCommerce finish its own update_order_review
  return { ctx, page, requests };
}

try {
  if (!base) base = await startPlayground();
  const browser = await chromium.launch({ headless: true });

  // 1) the token is on the checkout request, and the request waits for tokenization
  {
    const { ctx, page, requests } = await openCheckout(browser, 'ok');
    await page.locator('#place_order').click();
    await page.waitForTimeout(6000);
    const starts = await page.evaluate(() => window.__stub.startCalls);
    check('exactly one checkout request is sent', requests.length === 1, `requests=${requests.length}`);
    check('the checkout request carries the card token', requests.length >= 1 && requests[0].body.includes(`cardz3n_payment_token=${STUB_TOKEN}`), requests[0] ? (/cardz3n_payment_token=[^&]/.test(requests[0].body) ? 'token field filled' : 'token field empty or absent') : 'no request');
    check('tokenization started before the request was sent', starts.length >= 1 && requests.length >= 1 && starts[0] <= requests[0].t);
    await ctx.close();
  }
  // 2) tokenization times out: no request is sent, an error shows, the form is not stuck
  {
    const { ctx, page, requests } = await openCheckout(browser, 'timeout');
    await page.locator('#place_order').click();
    await page.waitForTimeout(4000);
    const err = (await page.locator('.cardz3n-errors').innerText().catch(() => '')).trim();
    check('no checkout request is sent when tokenization times out', requests.length === 0, `requests=${requests.length}`);
    check('an error message is shown after a tokenization timeout', err.length > 0, err.slice(0, 60));
    check('the form is not left in the processing state', !(await page.locator('form.checkout').evaluate((f) => f.classList.contains('processing'))));
    await ctx.close();
  }
  // 3) a double click still sends one request
  {
    const { ctx, page, requests } = await openCheckout(browser, 'ok');
    await page.locator('#place_order').dblclick();
    await page.waitForTimeout(6000);
    check('a double click still sends one request', requests.length === 1, `requests=${requests.length}`);
    await ctx.close();
  }
  await browser.close();
} catch (e) {
  check('test run completed without an error', false, String(e.message).slice(0, 200));
} finally {
  if (server) { try { if (process.platform === 'win32') { spawn('taskkill', ['/PID', String(server.pid), '/T', '/F']); } else { server.kill(); } } catch { /* ignore */ } }
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
