// End-to-end check: what shoppers and merchants see for subscription and pre-order carts with the native block checkout on.
//
// The native block method is card-only and does not advertise 'subscriptions' or 'pre-orders' (saving the card for later charges is
// not built into the block path). WooCommerce Subscriptions / Pre-Orders add those as payment requirements to such carts, so the
// Checkout block offers no payment method for them and shows WooCommerce's own "There are no payment methods available".
// This test emulates that with WooCommerce's payment-requirement mechanism (the one those plugins use) and checks:
//   1. a normal cart on the Checkout block still offers this method;
//   2. a subscription cart and a pre-order cart on the Checkout block get no method (documents the behaviour, so a change is noticed);
//   3. the classic checkout still offers the gateway for a subscription cart;
//   4. the gateway settings page warns the merchant when Subscriptions or Pre-Orders is active (stubbed classes) and stays quiet
//      otherwise and on other settings pages.
//
// No real keys (placeholders), Collect.js is stubbed, nothing is charged.
//
// Run (from the plugin folder, Node 18+):
//   npm i --no-save playwright && npx playwright install chromium
//   node tests/e2e/blocks-subscription-cart.spec.mjs
// Environment (optional):
//   E2E_BASE_URL  use an already running site instead of starting a WordPress Playground on port 9411
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
  const port = '9411';
  const blueprint = join(pluginDir, 'tests', 'e2e', 'blueprint-blocks-subscription.json');
  server = spawn('npx', ['--yes', '@wp-playground/cli@latest', 'start', '--blueprint', blueprint, '--mount', './:/wordpress/wp-content/plugins/cardz3n-gateway', '--no-auto-mount', '--skip-browser', '--reset', '--port', port, '--php', '8.2'], { cwd: pluginDir, shell: true });
  await new Promise((ok, fail) => {
    const t = setTimeout(() => fail(new Error('Playground did not become ready in 6 minutes')), 360000);
    const onData = (d) => { if (/Ready! WordPress is running/.test(String(d))) { clearTimeout(t); ok(); } };
    server.stdout.on('data', onData); server.stderr.on('data', onData);
    server.on('exit', () => fail(new Error('Playground exited early')));
  });
  return `http://127.0.0.1:${port}`;
}

const STUB_COLLECT_JS = 'window.CollectJS = { configure: function (c) { if (c && typeof c.fieldsAvailableCallback === "function") { setTimeout(c.fieldsAvailableCallback, 50); } }, startPaymentRequest: function () {}, clearInputs: function () {} };';

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`); };

try {
  if (!base) base = await startPlayground();
  const browser = await chromium.launch({ headless: true });

  const cartPage = async (productName, path) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage(); page.setDefaultTimeout(120000);
    await page.route(/Collect\.js/, (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: STUB_COLLECT_JS }));
    await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
    const pid = await page.evaluate((n) => fetch('/wp-json/wc/store/v1/products?search=' + encodeURIComponent(n)).then((r) => r.json()).then((p) => (p.find((x) => x.name === n) || p[0] || {}).id), productName);
    await page.goto(`${base}/?add-to-cart=${pid}`, { waitUntil: 'domcontentloaded' });
    await page.goto(base + path, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(9000);
    return { ctx, page };
  };
  const paymentText = (page) => page.evaluate(() => { const el = document.querySelector('.wc-block-components-checkout-step--payment, .wp-block-woocommerce-checkout-payment-block'); return el ? el.innerText.replace(/\s+/g, ' ').trim() : ''; });

  // 1) normal cart on the block checkout
  { const { ctx, page } = await cartPage('E2E Test Item', '/checkout/');
    const t = await paymentText(page);
    check('Block checkout, normal cart: this gateway is offered', /Pay securely with a credit or debit card/.test(t) && !/no payment methods available/i.test(t), t.slice(0, 80));
    await ctx.close(); }
  // 2) subscription and pre-order carts on the block checkout
  for (const [label, name] of [['subscription', 'E2E Subscription Item'], ['pre-order', 'E2E Preorder Item']]) {
    const { ctx, page } = await cartPage(name, '/checkout/');
    const t = await paymentText(page);
    check(`Block checkout, ${label} cart: no method is offered (WooCommerce's own message is shown)`, /no payment methods available/i.test(t) && !/Pay securely/.test(t), t.slice(0, 90));
    await ctx.close();
  }
  // 3) classic checkout, subscription cart
  { const { ctx, page } = await cartPage('E2E Subscription Item', '/checkout-classic/');
    check('Classic checkout, subscription cart: this gateway is still offered', (await page.locator('input[name="payment_method"][value="cardz3n_gateway"]').count()) === 1);
    await ctx.close(); }

  // 4) the merchant warning
  const ctx = await browser.newContext(); const page = await ctx.newPage(); page.setDefaultTimeout(120000);
  await page.goto(base + '/wp-login.php', { waitUntil: 'domcontentloaded' });
  if (await page.locator('#user_login').count()) {
    await page.fill('#user_login', 'admin'); await page.fill('#user_pass', 'password');
    await Promise.all([page.waitForURL(/wp-admin/, { timeout: 90000 }).catch(() => {}), page.click('#wp-submit')]);
  }
  const probe = async (m) => { await page.goto(`${base}/?cardz3n_e2e=${m}`, { waitUntil: 'domcontentloaded' }); };
  const gateway = `${base}/wp-admin/admin.php?page=wc-settings&tab=checkout&section=cardz3n_gateway`;
  const warns = async (url) => { await page.goto(url, { waitUntil: 'domcontentloaded' }); return /cannot be paid with this gateway yet/.test(await page.evaluate(() => document.body.innerText)); };
  check('Settings page, no Subscriptions or Pre-Orders: no warning', (await warns(gateway)) === false);
  await probe('subs_on');
  check('Settings page, Subscriptions active: the warning is shown', (await warns(gateway)) === true);
  check('Other WooCommerce settings pages do not show the warning', (await warns(`${base}/wp-admin/admin.php?page=wc-settings&tab=general`)) === false);
  await probe('subs_off'); await probe('pre_on');
  check('Settings page, Pre-Orders active: the warning is shown', (await warns(gateway)) === true);
  await probe('pre_off');
  check('Back to neither: no warning', (await warns(gateway)) === false);
  await ctx.close();

  await browser.close();
} catch (e) {
  check('test run completed without an error', false, String(e.message).slice(0, 200));
} finally {
  if (server) { try { if (process.platform === 'win32') { spawn('taskkill', ['/PID', String(server.pid), '/T', '/F']); } else { server.kill(); } } catch { /* ignore */ } }
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
