// End-to-end (local stand-in) check: Apple Pay and Google Pay are not offered on subscription and pre-order carts.
//
// Why: a wallet token has not been proven for the later charges of a subscription or pre-order, so until it is tested the
// wallet area is hidden on those carts, and a wallet payment posted anyway for such an order is refused before anything is sent
// to the gateway. Normal carts are unchanged. Same stand-in as the other recurring specs (fake cart checks of Subscriptions and
// Pre-Orders, recorded and stubbed gateway HTTP; the real plugins are tested on the demo store). Collect.js is replaced by a stub
// that records the configuration it is given. No keys, nothing is charged.
//
// Run (from the plugin folder, Node 18+):
//   npm i --no-save playwright && npx playwright install chromium
//   node tests/e2e/recurring-wallets.spec.mjs
// Environment (optional): E2E_BASE_URL, PLUGIN_DIR, PW_DIR as in the other e2e specs (Playground port 9421).
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const require = createRequire(process.env.PW_DIR ? join(process.env.PW_DIR, 'package.json') : join(process.cwd(), 'package.json'));
const { chromium } = require('playwright');

const pluginDir = resolve(process.env.PLUGIN_DIR || process.cwd());
let base = process.env.E2E_BASE_URL;
let server = null;

async function startPlayground() {
  const port = '9421';
  const blueprint = join(pluginDir, 'tests', 'e2e', 'blueprint-wallets-recurring.json');
  server = spawn('npx', ['--yes', '@wp-playground/cli@latest', 'start', '--blueprint', blueprint, '--mount', './:/wordpress/wp-content/plugins/cardz3n-gateway', '--no-auto-mount', '--skip-browser', '--reset', '--port', port, '--php', '8.2'], { cwd: pluginDir, shell: true });
  await new Promise((ok, fail) => {
    const t = setTimeout(() => fail(new Error('Playground did not become ready in 15 minutes')), 900000);
    const onData = (d) => { if (/Ready! WordPress is running/.test(String(d))) { clearTimeout(t); ok(); } };
    server.stdout.on('data', onData); server.stderr.on('data', onData);
    server.on('exit', () => fail(new Error('Playground exited early')));
  });
  return `http://127.0.0.1:${port}`;
}

const STUB_COLLECT_JS = `
window.__configured = null;
window.CollectJS = {
  configure: function (c) { window.__configured = { fields: Object.keys(c.fields || {}) }; if (typeof c.fieldsAvailableCallback === 'function') { setTimeout(c.fieldsAvailableCallback, 50); } },
  startPaymentRequest: function () {},
  clearInputs: function () {}
};
window.ApplePaySession = { canMakePayments: function () { return true; } };
window.google = { payments: { api: {} } };`;

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`); };
const j = (x) => JSON.stringify(x);

// Opens the classic checkout with one product in the cart and reports what the shopper's page offers.
async function checkoutFor(browser, productName) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage(); page.setDefaultTimeout(300000);
  await page.route(/Collect\.js/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB_COLLECT_JS }));
  await page.goto(base + '/', { waitUntil: 'domcontentloaded', timeout: 300000 });
  const pid = await page.evaluate((name) => fetch('/wp-json/wc/store/v1/products?search=' + encodeURIComponent(name)).then((r) => r.json()).then((p) => p[0].id), productName);
  await page.goto(`${base}/?add-to-cart=${pid}`, { waitUntil: 'domcontentloaded' });
  await page.goto(base + '/checkout-classic/');
  await page.waitForSelector('form.checkout');
  await page.waitForTimeout(5000);
  const state = await page.evaluate(() => ({
    configured: window.__configured,
    walletArea: document.querySelectorAll('.cardz3n-wallets').length,
    appleBox: document.querySelectorAll('.cardz3n-applepay-button').length,
    googleBox: document.querySelectorAll('.cardz3n-googlepay-button').length,
    flags: window.CARDZ3N_GW ? { apple: window.CARDZ3N_GW.enableApplePay, google: window.CARDZ3N_GW.enableGooglePay } : null,
    errors: Array.from(document.querySelectorAll('.woocommerce-error, .woocommerce-notice--error')).map((e) => e.innerText.trim()).filter(Boolean),
    cardFields: !!document.querySelector('#cardz3n-ccnumber, .cardz3n-pane[data-pane="card"]')
  }));
  await ctx.close();
  return state;
}

try {
  if (!base) base = await startPlayground();
  const browser = await chromium.launch({ headless: true });

  // 1) A normal cart: unchanged, both wallets are offered.
  const normal = await checkoutFor(browser, 'E2E Test Item');
  check('Normal cart: the wallet area is there with both wallet buttons', normal.walletArea === 1 && normal.appleBox === 1 && normal.googleBox === 1, j(normal));
  check('Normal cart: Collect.js is given both wallets and the card fields', !!normal.configured && normal.configured.fields.includes('applePay') && normal.configured.fields.includes('googlePay') && normal.configured.fields.includes('ccnumber'), j(normal.configured));
  check('Normal cart: the page settings still allow both wallets', !!normal.flags && !!normal.flags.apple && !!normal.flags.google, j(normal.flags));

  // 2) A subscription cart: no wallet area, no wallet passed to Collect.js, no error shown, the card form still works.
  const sub = await checkoutFor(browser, 'E2E Subscription Item');
  check('Subscription cart: the wallet area is hidden (no containers at all)', sub.walletArea === 0 && sub.appleBox === 0 && sub.googleBox === 0, j(sub));
  check('Subscription cart: Collect.js gets the card fields and no wallet', !!sub.configured && sub.configured.fields.includes('ccnumber') && !sub.configured.fields.includes('applePay') && !sub.configured.fields.includes('googlePay'), j(sub.configured));
  check('Subscription cart: the page settings switch both wallets off', !!sub.flags && !sub.flags.apple && !sub.flags.google, j(sub.flags));
  check('Subscription cart: no error is shown to the shopper', sub.errors.length === 0, j(sub.errors));

  // 3) A pre-order cart: the same.
  const pre = await checkoutFor(browser, 'E2E Preorder Item');
  check('Pre-order cart: the wallet area is hidden (no containers at all)', pre.walletArea === 0 && pre.appleBox === 0 && pre.googleBox === 0, j(pre));
  check('Pre-order cart: Collect.js gets the card fields and no wallet', !!pre.configured && pre.configured.fields.includes('ccnumber') && !pre.configured.fields.includes('applePay') && !pre.configured.fields.includes('googlePay'), j(pre.configured));
  check('Pre-order cart: no error is shown to the shopper', pre.errors.length === 0, j(pre.errors));

  // 4) The server: a wallet payment posted for an order that needs a stored card is refused and sends nothing to the gateway.
  const ctx = await browser.newContext(); const page = await ctx.newPage(); page.setDefaultTimeout(300000);
  await page.goto(`${base}/?cardz3n_e2e=suite`, { waitUntil: 'domcontentloaded', timeout: 300000 });
  const text = await page.evaluate(() => document.body.innerText);
  let r;
  try { r = JSON.parse(text); } catch (e) { check('the scenario suite ran', false, text.slice(0, 200)); throw e; }
  const a = r.wallet_apple_on_subscription_order; const g = r.wallet_google_on_subscription_order;
  check('Apple Pay posted for a subscription order: refused, nothing sent to the gateway', a.result === 'failure' && a.requests.length === 0, j(a));
  check('Google Pay posted for a subscription order: refused, nothing sent to the gateway', g.result === 'failure' && g.requests.length === 0, j(g));
  const n = r.wallet_apple_on_normal_order;
  check('Apple Pay on a normal order: unchanged (accepted, one sale sent)', n.result === 'success' && n.requests.length === 1 && n.requests[0].type === 'sale', j(n));
  const c = r.card_on_subscription_order;
  check('A card on a subscription order: unchanged (accepted, card saved)', c.result === 'success' && c.requests.length === 1 && c.requests[0].customer_vault === 'add_customer', j(c));
  await ctx.close();

  await browser.close();
} catch (e) {
  check('test run completed without an error', false, String(e.message).slice(0, 200));
} finally {
  if (server) { try { if (process.platform === 'win32') { spawn('taskkill', ['/PID', String(server.pid), '/T', '/F']); } else { server.kill(); } } catch { /* ignore */ } }
}
const failed = results.filter((x) => !x.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
