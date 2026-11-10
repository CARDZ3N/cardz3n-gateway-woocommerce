// End-to-end check: a logged-in customer ticks "Save this card" on the CLASSIC checkout, and the card must really end up as a saved method.
//
// Why: the gateway's sale reply carries a Customer Vault ID but NO card details (no number, expiry or brand). The plugin used to read the last
// four digits from that reply, so WooCommerce refused the saved method (empty last4), the plugin hid the error in the log, and the customer
// saw "No saved methods found." even though the gateway had stored the card. Now the plugin asks the gateway's own vault record for the masked
// details, falls back to the masked values the browser posted, and always writes an order note saying what happened.
//
// This runs the real checkout form and the real WooCommerce checkout request. Only two things are stand-ins: Collect.js (mints a fixed token
// and, in some cases, masked card details) and the gateway's HTTP replies (a sale reply shaped like the real one, and a vault lookup).
// No keys, nothing leaves the machine. Test cards are never typed: no card number exists anywhere in this test.
//
// Run (from the plugin folder, Node 18+):
//   npm i --no-save playwright && npx playwright install chromium
//   node tests/e2e/saved-card.spec.mjs
// Environment (optional):
//   PLUGIN_DIR    plugin folder to mount into Playground (default: the current folder)
//   PW_DIR        folder that contains node_modules/playwright, if it is not installed in the current folder
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const require = createRequire(process.env.PW_DIR ? join(process.env.PW_DIR, 'package.json') : join(process.cwd(), 'package.json'));
const { chromium } = require('playwright');

const pluginDir = resolve(process.env.PLUGIN_DIR || process.cwd());
const port = '9428';
const base = `http://127.0.0.1:${port}`;
let server = null;

async function startPlayground() {
  const blueprint = join(pluginDir, 'tests', 'e2e', 'blueprint-saved-card.json');
  server = spawn('npx', ['--yes', '@wp-playground/cli@latest', 'start', '--blueprint', blueprint, '--mount', './:/wordpress/wp-content/plugins/cardz3n-gateway', '--no-auto-mount', '--skip-browser', '--reset', '--port', port, '--php', '8.2'], { cwd: pluginDir, shell: true });
  await new Promise((ok, fail) => {
    const t = setTimeout(() => fail(new Error('Playground did not become ready in 6 minutes')), 360000);
    const onData = (d) => { if (/Ready! WordPress is running/.test(String(d))) { clearTimeout(t); ok(); } };
    server.stdout.on('data', onData); server.stderr.on('data', onData);
    server.on('exit', () => fail(new Error('Playground exited early')));
  });
}

// Collect.js stand-in. `card` is what the browser would receive from the real script next to the token (masked values only).
const stubCollect = (card) => `(function(){var cfg=null;window.CollectJS={configure:function(c){cfg=c;if(c.fieldsAvailableCallback){setTimeout(c.fieldsAvailableCallback,50);}},startPaymentRequest:function(){setTimeout(function(){cfg.callback({token:'stub-token-123',tokenType:'inline',card:${JSON.stringify(card)}});},300);},clearInputs:function(){}};})();`;

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`); };
const j = (x) => JSON.stringify(x);

async function state(ctx) { return (await ctx.request.get(base + '/?cz_state=1')).json(); }

// One real classic checkout as the logged-in shopper. `tick`: tick the save box. `card`: what the Collect.js stand-in returns.
async function checkout(browser, scenario, { tick = true, card = { type: 'visa' } } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addCookies([{ name: 'playground_auto_login_already_happened', value: '1', url: base }]);
  const page = await ctx.newPage(); page.setDefaultTimeout(120000);
  await ctx.request.get(`${base}/?cz_set=${scenario}`);
  await page.route(/Collect\.js/, (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: stubCollect(card) }));
  await page.goto(base + '/wp-login.php', { waitUntil: 'domcontentloaded' });
  await page.fill('#user_login', 'shopper'); await page.fill('#user_pass', 'e2e-shopper-pass-1');
  await Promise.all([page.waitForNavigation(), page.click('#wp-submit')]);
  const pid = await page.evaluate(() => fetch('/wp-json/wc/store/v1/products').then((r) => r.json()).then((p) => p[0].id));
  await page.goto(`${base}/?add-to-cart=${pid}`);
  await page.goto(base + '/checkout-classic/'); await page.waitForSelector('form.checkout');
  for (const [id, v] of Object.entries({ billing_first_name: 'E2E', billing_last_name: 'Tester', billing_address_1: '888', billing_city: 'Los Angeles', billing_postcode: '90001', billing_phone: '5555550100', billing_email: 'e2e@example.com' })) await page.locator('#' + id).fill(v);
  await page.waitForTimeout(4000);
  const box = page.locator('input[name="wc-cardz3n_gateway-new-payment-method"]');
  const boxShown = (await box.count()) > 0;
  if (tick && boxShown) await box.check();
  const checked = boxShown ? await box.isChecked() : null;
  const before = (await state(ctx)).tokens.length;
  await page.locator('#place_order').click();
  await page.waitForURL(/order-received/, { timeout: 90000 }).catch(() => {});
  const reached = page.url().includes('order-received');
  const st = await state(ctx);
  await page.goto(base + '/my-account/payment-methods/');
  const account = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  await ctx.close();
  return { boxShown, checked, reached, st, added: st.tokens.length - before, newest: st.tokens[st.tokens.length - 1], account };
}

try {
  await startPlayground();
  const browser = await chromium.launch({ headless: true });

  // 1) The real case: sale reply has no card fields; the gateway's vault record has them.
  {
    const r = await checkout(browser, 'lookup_ok');
    const sale = r.st.gateway_calls.find((c) => c.call === 'sale') || {};
    const asked = r.st.gateway_calls.find((c) => c.call === 'query') || {};
    check('1 The save box is on the checkout and was ticked', r.boxShown === true && r.checked === true);
    check('1 The sale asks the gateway to store the card (customer_vault=add_customer)', sale.customer_vault === 'add_customer', j(sale));
    check('1 The plugin asks the gateway\'s vault record for the card details', asked.report_type === 'customer_vault' && asked.has_vault_id === true, j(asked));
    check('1 The order is approved and completes', r.reached && r.st.order_status === 'processing', r.st.order_status);
    check('1 A WooCommerce saved method is created', r.added === 1, `added=${r.added}`);
    check('1 It shows the right last four digits, brand and expiry', !!r.newest && r.newest.last4 === '1111' && r.newest.type === 'visa' && r.newest.exp === '12/2030', j(r.newest));
    check('1 The order note says the card was saved', r.st.notes.some((n) => /Card saved for the customer's next order \(Visa ending 1111\)/.test(n)), j(r.st.notes.filter((n) => /ard/.test(n))));
    check('1 My Account > Payment methods lists the card', /ending in 1111/.test(r.account) && !/No saved methods found/.test(r.account), r.account.slice(0, 120));
    check('1 No saved-method warning is logged', !r.st.log_lines.some((l) => /WARNING/.test(l)), j(r.st.log_lines));
  }

  // 2) The vault lookup is not available (for example a key without Query permission): the masked values the browser posted are used.
  {
    const r = await checkout(browser, 'lookup_fail', { card: { type: 'visa', number: '4xxxxxxxxxxx4242', exp: '0131' } });
    check('2 With no vault lookup, the browser\'s masked details are used: a saved method is created', r.added === 1 && !!r.newest && r.newest.last4 === '4242' && r.newest.exp === '01/2031', j(r.newest));
    check('2 The order note says the card was saved', r.st.notes.some((n) => /Card saved for the customer's next order \(Visa ending 4242\)/.test(n)), j(r.st.notes.filter((n) => /ard/.test(n))));
  }

  // 3) No source has the details: the charge still succeeds, nothing is saved, and the note says why.
  {
    const r = await checkout(browser, 'lookup_fail', { card: { type: 'visa' } });
    check('3 The order is still approved and completes', r.reached && r.st.order_status === 'processing', r.st.order_status);
    check('3 No saved method is created', r.added === 0, `added=${r.added}`);
    check('3 The order note says the card was stored at the gateway but could not be saved, with the reason', r.st.notes.some((n) => /stored at the gateway, but it could not be saved as a WooCommerce saved payment method \(.*vault lookup.*\)/.test(n)), j(r.st.notes.filter((n) => /gateway/.test(n))));
    check('3 The log has one warning for it', r.st.log_lines.some((l) => /Card stored at the gateway but not saved as a WooCommerce saved method/.test(l)), j(r.st.log_lines));
  }

  // 4) Strict validation: an impossible expiry posted by the browser is never saved (the server checks again, whatever the script sends).
  {
    const r = await checkout(browser, 'lookup_fail', { card: { type: 'visa', number: '4xxxxxxxxxxx4242', exp: '1399' } }); // month 13 does not exist
    check('4 An impossible expiry from the browser is rejected: no saved method', r.added === 0, `added=${r.added}`);
    check('4 The order still completes and the note explains', r.reached && r.st.notes.some((n) => /could not be saved as a WooCommerce saved payment method/.test(n)));
  }

  // 5) The gateway returns no vault ID at all.
  {
    const r = await checkout(browser, 'novault');
    check('5 The order is approved and completes', r.reached && r.st.order_status === 'processing', r.st.order_status);
    check('5 No saved method is created', r.added === 0, `added=${r.added}`);
    check('5 The order note says the gateway returned no vault ID', r.st.notes.some((n) => /did not return a saved-card \(vault\) ID, so the card was not saved/.test(n)), j(r.st.notes.filter((n) => /vault/.test(n))));
  }

  // 6) Box not ticked: nothing is stored, nothing is saved, no card note.
  {
    const r = await checkout(browser, 'lookup_ok', { tick: false });
    const sale = r.st.gateway_calls.find((c) => c.call === 'sale') || {};
    check('6 Unticked: the sale does not ask the gateway to store the card', !sale.customer_vault, j(sale));
    check('6 Unticked: no vault lookup is made', !r.st.gateway_calls.some((c) => c.call === 'query'));
    check('6 Unticked: no saved method and no saved-card note', r.added === 0 && !r.st.notes.some((n) => /Card saved|stored at the gateway|vault/.test(n)));
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
