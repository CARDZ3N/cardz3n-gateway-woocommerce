// End-to-end check: with "Enable Level 3 / CEDP Transmission" ON, a request that carries a saved-card (vault) field must not also carry the customer id.
//
// Why: Level 3 data includes `customerid` (the WordPress user id). The gateway refuses a request that has a customer_vault_id together with a customer_id
// that is not the same value: "customer_id conflicts with customer_vault_id!" (shown on the NMI sandbox on 2026-11-09). The plugin merged the Level 3 data into
// every sale, so a payment with a saved card (and a renewal, or a pre-order release, which pay the same way) was declined whenever Level 3 was on.
// The plugin now drops the customer id from any request that carries customer_vault or customer_vault_id, and keeps it on every other request.
//
// This runs the real checkout form and the real WooCommerce checkout request. Only two things are stand-ins: Collect.js (mints a fixed token) and the gateway's
// HTTP replies. The gateway stand-in declines a request with a customer_vault_id and a different customer id, with the gateway's own wording.
// No keys, nothing leaves the machine. No card number exists anywhere in this test.
//
// Run (from the plugin folder, Node 18+):
//   npm i --no-save playwright && npx playwright install chromium
//   node tests/e2e/level3-vault.spec.mjs
// Environment (optional):
//   PLUGIN_DIR    plugin folder to mount into Playground (default: the current folder)
//   PW_DIR        folder that contains node_modules/playwright, if it is not installed in the current folder
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const require = createRequire(process.env.PW_DIR ? join(process.env.PW_DIR, 'package.json') : join(process.cwd(), 'package.json'));
const { chromium } = require('playwright');

const pluginDir = resolve(process.env.PLUGIN_DIR || process.cwd());
const port = '9430';
const base = `http://127.0.0.1:${port}`;
let server = null;

async function startPlayground() {
  const blueprint = join(pluginDir, 'tests', 'e2e', 'blueprint-level3-vault.json');
  server = spawn('npx', ['--yes', '@wp-playground/cli@latest', 'start', '--blueprint', blueprint, '--mount', './:/wordpress/wp-content/plugins/cardz3n-gateway', '--no-auto-mount', '--skip-browser', '--reset', '--port', port, '--php', '8.2'], { cwd: pluginDir, shell: true });
  await new Promise((ok, fail) => {
    const t = setTimeout(() => fail(new Error('Playground did not become ready in 6 minutes')), 360000);
    const onData = (d) => { if (/Ready! WordPress is running/.test(String(d))) { clearTimeout(t); ok(); } };
    server.stdout.on('data', onData); server.stderr.on('data', onData);
    server.on('exit', () => fail(new Error('Playground exited early')));
  });
}

const stubCollect = `(function(){var cfg=null;window.CollectJS={configure:function(c){cfg=c;if(c.fieldsAvailableCallback){setTimeout(c.fieldsAvailableCallback,50);}},startPaymentRequest:function(){setTimeout(function(){cfg.callback({token:'stub-token-123',tokenType:'inline',card:{type:'visa'}});},300);},clearInputs:function(){}};})();`;

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`); };
const j = (x) => JSON.stringify(x);

async function state(ctx) { return (await ctx.request.get(base + '/?cz_state=1')).json(); }

// One real classic checkout as the logged-in shopper. `mode`: 'save' ticks the save box, 'plain' pays with a new card and does not save it, 'saved' pays with the saved card.
async function checkout(browser, mode) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addCookies([{ name: 'playground_auto_login_already_happened', value: '1', url: base }]);
  const page = await ctx.newPage(); page.setDefaultTimeout(120000);
  await ctx.request.get(`${base}/?cz_reset=1`);
  await page.route(/Collect\.js/, (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: stubCollect }));
  await page.goto(base + '/wp-login.php', { waitUntil: 'domcontentloaded' });
  await page.fill('#user_login', 'shopper'); await page.fill('#user_pass', 'e2e-shopper-pass-1');
  await Promise.all([page.waitForNavigation(), page.click('#wp-submit')]);
  const pid = await page.evaluate(() => fetch('/wp-json/wc/store/v1/products').then((r) => r.json()).then((p) => p[0].id));
  await page.goto(`${base}/?add-to-cart=${pid}`);
  await page.goto(base + '/checkout-classic/'); await page.waitForSelector('form.checkout');
  for (const [id, v] of Object.entries({ billing_first_name: 'E2E', billing_last_name: 'Tester', billing_address_1: '888', billing_city: 'Los Angeles', billing_postcode: '90001', billing_phone: '5555550100', billing_email: 'e2e@example.com' })) await page.locator('#' + id).fill(v);
  await page.waitForTimeout(4000);
  let picked = null;
  if (mode === 'save') {
    const box = page.locator('input[name="wc-cardz3n_gateway-new-payment-method"]');
    if (await box.count()) await box.check();
  } else if (mode === 'saved') {
    const tab = page.locator('.cardz3n-tabs .cardz3n-tab[data-target="saved"]');
    if (await tab.count()) { await tab.click(); await page.waitForTimeout(1500); }
    const radios = page.locator('input[name="wc-cardz3n_gateway-payment-token"]:not([value="new"])');
    picked = await radios.count();
    if (picked) await radios.first().check();
    picked = await page.locator('input[name="wc-cardz3n_gateway-payment-token"]:not([value="new"]):checked').count();
  }
  await page.locator('#place_order').click();
  await page.waitForURL(/order-received/, { timeout: 90000 }).catch(() => {});
  const reached = page.url().includes('order-received');
  const errors = (await page.locator('.woocommerce-error').allInnerTexts().catch(() => [])).join(' ').replace(/\s+/g, ' ');
  const st = await state(ctx);
  await ctx.close();
  return { reached, errors, st, picked, sale: st.gateway_calls.filter((c) => c.call === 'sale').pop() || {} };
}

try {
  await startPlayground();
  const browser = await chromium.launch({ headless: true });

  // 1) Save-card checkout (the gateway stores the card): the sale asks for add_customer and must not carry a customer id.
  {
    const r = await checkout(browser, 'save');
    check('1 Save card: the sale asks the gateway to store the card', r.sale.customer_vault === 'add_customer', j(r.sale));
    check('1 Save card: no customer id is sent with the vault request', r.sale.has_customerid === false && r.sale.has_customer_id === false, j(r.sale));
    check('1 Save card: the order is approved and completes', r.reached && r.st.order_status === 'processing', r.st.order_status);
    check('1 Save card: a saved method exists afterwards', r.st.tokens.length === 1, j(r.st.tokens));
  }

  // 2) Paying with the saved card (the same request a renewal or a pre-order release sends): a customer_vault_id, and no customer id.
  {
    const r = await checkout(browser, 'saved');
    check('2 Saved card: the saved card was offered and picked', r.picked >= 1, `radios=${r.picked}`);
    check('2 Saved card: the sale carries the vault id', r.sale.has_vault_id === true, j(r.sale));
    check('2 Saved card: no customer id is sent with the vault id (the gateway would decline a different one)', r.sale.has_customerid === false && r.sale.has_customer_id === false, j(r.sale));
    check('2 Saved card: the gateway did not report a conflict', r.sale.conflict === false && !/conflicts with customer_vault_id/.test(r.errors), r.errors.slice(0, 160));
    check('2 Saved card: the order is approved and completes', r.reached && r.st.order_status === 'processing', r.st.order_status);
  }

  // 3) A new card that is not saved, Level 3 on: Level 3 data (including the customer id) is still sent. The fix must not turn Level 3 off.
  {
    const r = await checkout(browser, 'plain');
    check('3 No vault: the sale has no vault field', !r.sale.customer_vault && r.sale.has_vault_id === false, j(r.sale));
    check('3 No vault: Level 3 still sends the customer id', r.sale.has_customerid === true, j(r.sale));
    check('3 No vault: the order is approved and completes', r.reached && r.st.order_status === 'processing', r.st.order_status);
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
