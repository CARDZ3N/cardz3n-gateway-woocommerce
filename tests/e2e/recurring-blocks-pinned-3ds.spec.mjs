// PART 2 of 2 (phases 5-8: stores pinned to OFF before 1.1.0, 3-D Secure Attempt and Required, classic checkout page). Part 1 is
// recurring-blocks.spec.mjs. Split in two because one long run was interrupted by the local test browser.
// End-to-end (local stand-in) check: subscription and pre-order carts on the native block checkout, card only.
//
// Before this change the native block method advertised only 'products' and 'refunds'. WooCommerce Subscriptions / Pre-Orders add a payment
// requirement ('subscriptions' / 'pre-orders') to such carts and the Checkout block only offers methods that support every requirement, so
// those carts got "There are no payment methods available". Now the method advertises the recurring features, but only when the matching
// store switch ("Subscriptions Support" / "Pre-Orders Support") is on AND the plugin is active.
//
// The real WooCommerce Subscriptions / Pre-Orders plugins are NOT used: a probe plugin (in the blueprint) emulates the payment requirements
// with WooCommerce's own mechanism (as the plugins do) and stands in for the few functions the gateway calls. The gateway's HTTP is
// short-circuited and every request recorded (never any secret). The Checkout block page, WooCommerce's own Blocks JavaScript and the
// Store API checkout run for real in Chromium; only Collect.js is stubbed (it hands back a fake token).
//
// Run (from the plugin folder, Node 18+):
//   npm i --no-save playwright && npx playwright install chromium
//   node tests/e2e/recurring-blocks-pinned-3ds.spec.mjs
// Environment (optional):
//   E2E_BASE_URL  use an already running site instead of starting a WordPress Playground on port 9417
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
  const port = '9417';
  const blueprint = join(pluginDir, 'tests', 'e2e', 'blueprint-recurring-blocks.json');
  server = spawn('npx', ['--yes', '@wp-playground/cli@latest', 'start', '--blueprint', blueprint, '--mount', './:/wordpress/wp-content/plugins/cardz3n-gateway', '--no-auto-mount', '--skip-browser', '--reset', '--port', port, '--php', '8.2'], { cwd: pluginDir, shell: true });
  await new Promise((ok, fail) => {
    const t = setTimeout(() => fail(new Error('Playground did not become ready in 6 minutes')), 360000);
    const onData = (d) => { if (/Ready! WordPress is running/.test(String(d))) { clearTimeout(t); ok(); } };
    server.stdout.on('data', onData); server.stderr.on('data', onData);
    server.on('exit', () => fail(new Error('Playground exited early')));
  });
  return `http://127.0.0.1:${port}`;
}

// Collect.js stub: mounts nothing, and on startPaymentRequest hands back a fake token the way the real script's callback does.
const STUB_COLLECT_JS = 'window.CollectJS = { configure: function (c) { window.__cz = c; if (c && typeof c.fieldsAvailableCallback === "function") { setTimeout(c.fieldsAvailableCallback, 50); } }, startPaymentRequest: function () { var c = window.__cz; setTimeout(function () { c.callback({ token: "tok-e2e", card: { type: "visa" } }); }, 50); }, clearInputs: function () {} };';

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`); };
const j = (x) => JSON.stringify(x);

try {
  if (!base) base = await startPlayground();
  const browser = await chromium.launch({ headless: true });

  // The probe requests go through a browser context's request API (it keeps cookies, which Playground's auto-login redirect needs).
  const probeCtx = await browser.newContext();
  const probe = async (query) => { const r = await probeCtx.request.get(`${base}/?cardz3n_e2e=${query}`, { timeout: 120000 }); const t = await r.text(); try { return JSON.parse(t); } catch { return { error: t.slice(0, 300) }; } };
  const cfg = (q) => probe('cfg&' + q);

  const cartPage = async (productName, path = '/checkout/', keepTokens = false) => {
    // Playground logs in as admin, and WooCommerce lists a signed-in customer's saved cards on the Checkout block whatever
    // the method's showSavedCards says (seen on WooCommerce 11.2.1), so every page starts without saved cards unless asked.
    if (!keepTokens) { await cfg('clear_tokens=1'); }
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage(); page.setDefaultTimeout(120000);
    await page.route(/Collect\.js/, (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: STUB_COLLECT_JS }));
    await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
    const pid = await page.evaluate((n) => fetch('/wp-json/wc/store/v1/products?search=' + encodeURIComponent(n)).then((r) => r.json()).then((p) => (p.find((x) => x.name === n) || p[0] || {}).id), productName);
    // Playground logs in as admin and WooCommerce keeps a signed-in user's cart, so start every page from an empty cart.
    await page.evaluate(async () => { const c = await fetch('/wp-json/wc/store/v1/cart'); await fetch('/wp-json/wc/store/v1/cart/items', { method: 'DELETE', headers: { Nonce: c.headers.get('nonce') } }); });
    // Test helper only: the local browser sometimes aborts this page load (net::ERR_ABORTED) on a long run; try once more.
    try { await page.goto(`${base}/?add-to-cart=${pid}`, { waitUntil: 'domcontentloaded' }); }
    catch (e) { if (!/ERR_ABORTED/.test(String(e.message))) { throw e; } await page.waitForTimeout(3000); await page.goto(`${base}/?add-to-cart=${pid}`, { waitUntil: 'domcontentloaded' }); }
    // Fill the billing address through the Store API so the Checkout block form is complete.
    await page.evaluate(async () => {
      const c = await fetch('/wp-json/wc/store/v1/cart');
      await fetch('/wp-json/wc/store/v1/cart/update-customer', { method: 'POST', headers: { 'Content-Type': 'application/json', Nonce: c.headers.get('nonce') }, body: JSON.stringify({ billing_address: { first_name: 'E2E', last_name: 'Tester', address_1: '1 Test St', city: 'Los Angeles', state: 'CA', postcode: '90001', country: 'US', email: 'e2e@example.test', phone: '' } }) });
    });
    await page.goto(base + path, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(9000);
    return { ctx, page };
  };
  const paymentText = (page) => page.evaluate(() => { const el = document.querySelector('.wc-block-components-checkout-step--payment, .wp-block-woocommerce-checkout-payment-block'); return el ? el.innerText.replace(/\s+/g, ' ').trim() : ''; });
  const offered = (t) => /Pay securely with a credit or debit card/.test(t) && !/no payment methods available/i.test(t);
  const refused = (t) => /no payment methods available/i.test(t) && !/Pay securely/.test(t);
  const methodData = (page) => page.evaluate(() => window.wc.wcSettings.getSetting('cardz3n_gateway_data', null));
  const placeOrder = async (page) => {
    const reqP = page.waitForRequest((r) => /wc\/store\/v1\/checkout/.test(r.url()) && r.method() === 'POST', { timeout: 90000 });
    const respP = page.waitForResponse((r) => /wc\/store\/v1\/checkout/.test(r.url()) && r.request().method() === 'POST', { timeout: 90000 });
    await page.click('.wc-block-components-checkout-place-order-button');
    const req = await reqP; const resp = await respP;
    const body = JSON.parse(req.postData() || '{}');
    const data = {}; for (const p of body.payment_data || []) { data[p.key] = p.value; }
    return { payment_method: body.payment_method, data, status: resp.status(), json: await resp.json().catch(() => ({})) };
  };

  // Admin login (settings page notice).
  const actx = await browser.newContext(); const admin = await actx.newPage(); admin.setDefaultTimeout(120000);
  let loggedIn = false;
  const warns = async () => {
    if (!loggedIn) {
      await admin.goto(base + '/wp-login.php', { waitUntil: 'domcontentloaded' });
      if (await admin.locator('#user_login').count()) { await admin.fill('#user_login', 'admin'); await admin.fill('#user_pass', 'password'); await Promise.all([admin.waitForURL(/wp-admin/, { timeout: 90000 }).catch(() => {}), admin.click('#wp-submit')]); }
      loggedIn = true;
    }
    await admin.goto(`${base}/wp-admin/admin.php?page=wc-settings&tab=checkout&section=cardz3n_gateway`, { waitUntil: 'domcontentloaded' });
    const t = await admin.evaluate(() => { const n = document.querySelector('.notice-warning'); return n ? n.innerText : ''; });
    return /cannot be paid with this gateway yet/.test(t) ? t : '';
  };

  // ---------------------------------------------------------------- Phase 5: pinned stores (setting saved OFF before 1.1.0), Checkout block page
  // Before this change such a store's Checkout block page showed "There are no payment methods available" (measured 2026-11-25). The native
  // method is now offered on every Checkout block page, except while 3-D Secure is Required.
  const noticeText = async () => { await warns(); return admin.evaluate(() => { const t = Array.from(document.querySelectorAll('.notice-warning, .notice-error')).map((n) => n.innerText).join('\n'); return t || '[no notices on the page] ' + document.body.innerText.replace(/\s+/g, ' ').slice(0, 200); }); };
  await cfg('stub_subs=yes&stub_pre=yes&http=yes&sw_subs=yes&sw_pre=yes&native=no&tds=off&chk=block&reset_reqs=1');
  { const st = await probe('state2');
    check('Pinned store (setting OFF), Checkout block page: the native method is offered and cart_checkout_blocks is declared compatible', st.enabled === true && st.setting_on === false && st.page_is_block === true && st.saved_value === 'no' && st.compatible === true && st.incompatible === false, j(st)); }
  { const { ctx, page } = await cartPage('E2E Test Item'); const t = await paymentText(page);
    check('Pinned store, normal cart: the card method is offered (no "no payment methods")', offered(t), t.slice(0, 90)); await ctx.close(); }
  for (const [label, name] of [['subscription', 'E2E Subscription Item'], ['pre-order', 'E2E Preorder Item']]) {
    const { ctx, page } = await cartPage(name); const t = await paymentText(page);
    check(`Pinned store, switches on, ${label} cart: the card method is offered`, offered(t), t.slice(0, 90));
    await cfg('reset_reqs=1');
    const po = await placeOrder(page);
    check(`Pinned store, switches on, ${label} cart: the block checkout succeeds`, po.status === 200 && po.json.payment_result && po.json.payment_result.payment_status === 'success', `${po.status} ${j(po.json.payment_result || po.json).slice(0, 120)}`);
    const o = await probe('order&id=' + po.json.order_id); const q = (o.requests || [])[0] || {};
    check(`Pinned store, switches on, ${label} cart: the card is saved for the later payments`, q.customer_vault === 'add_customer' && /^V-/.test(o.order_vault), j(q));
    await ctx.close(); }
  // Pinned store, plugins active, switches OFF: subscription and pre-order carts are still refused (the gateway does not take what it cannot renew).
  await cfg('sw_subs=no&sw_pre=no&reset_reqs=1');
  { const { ctx, page } = await cartPage('E2E Test Item'); const t = await paymentText(page);
    check('Pinned store, switches off, normal cart: the card method is offered', offered(t), t.slice(0, 80)); await ctx.close(); }
  for (const [label, name] of [['subscription', 'E2E Subscription Item'], ['pre-order', 'E2E Preorder Item']]) {
    const { ctx, page } = await cartPage(name); const t = await paymentText(page);
    check(`Pinned store, switches off, ${label} cart: the method is NOT offered`, refused(t), t.slice(0, 90)); await ctx.close(); }

  // ---------------------------------------------------------------- Phase 6: 3-D Secure Attempt on the Checkout block
  await cfg('sw_subs=yes&sw_pre=yes&native=unset&tds=attempt&chk=block&reset_reqs=1');
  { const st = await probe('state2');
    check('3-D Secure Attempt, Checkout block page: the native method is offered and compatible (the Checkout block cannot run 3-D Secure)', st.enabled === true && st.tds === 'attempt' && st.compatible === true, j(st)); }
  { const { ctx, page } = await cartPage('E2E Test Item'); const t = await paymentText(page);
    check('3-D Secure Attempt, normal cart: the card method is offered', offered(t), t.slice(0, 90));
    await cfg('reset_reqs=1');
    const po = await placeOrder(page);
    check('3-D Secure Attempt, normal cart: the block checkout succeeds (the payment is taken without 3-D Secure)', po.status === 200 && po.json.payment_result && po.json.payment_result.payment_status === 'success', `${po.status} ${j(po.json.payment_result || po.json).slice(0, 120)}`);
    const o = await probe('order&id=' + po.json.order_id);
    check('3-D Secure Attempt, normal cart: the order note says 3-D Secure was not available and the payment was sent without it', (o.notes || []).some((n) => /3-D Secure was not available for this payment/.test(n) && /sent without it/.test(n)), j(o.notes));
    check('3-D Secure Attempt, normal cart: the payment reached the gateway (a sale was sent)', (o.requests || []).length === 1, j((o.requests || []).map((r) => r.type)));
    await ctx.close(); }
  { const { ctx, page } = await cartPage('E2E Subscription Item'); const t = await paymentText(page);
    check('3-D Secure Attempt, subscription cart (switch on): the card method is offered', offered(t), t.slice(0, 90));
    await cfg('reset_reqs=1');
    const po = await placeOrder(page);
    const o = await probe('order&id=' + po.json.order_id); const q = (o.requests || [])[0] || {};
    check('3-D Secure Attempt, subscription cart: succeeds and the card is saved for renewals', po.status === 200 && po.json.payment_result && po.json.payment_result.payment_status === 'success' && q.customer_vault === 'add_customer' && /^V-/.test(o.order_vault), j(q));
    await ctx.close(); }
  { const w = await noticeText();
    check('3-D Secure Attempt: the settings page says the Checkout block takes card payments without 3-D Secure', /3D Secure is set to Attempt, and your checkout page uses the Checkout block/.test(w) && /taken without it/.test(w), w.slice(0, 200)); }

  // ---------------------------------------------------------------- Phase 7: 3-D Secure Required: not offered on the Checkout block (a payment without 3-D Secure would be stopped)
  await cfg('native=yes&tds=required&reset_reqs=1');
  { const st = await probe('state2');
    check('3-D Secure Required, Checkout block page (even with the setting ticked): the native method is not offered and not declared compatible', st.enabled === false && st.tds === 'required' && st.compatible === false && st.incompatible === true, j(st)); }
  for (const [label, name] of [['normal', 'E2E Test Item'], ['subscription', 'E2E Subscription Item']]) {
    const { ctx, page } = await cartPage(name); const t = await paymentText(page);
    check(`3-D Secure Required, ${label} cart: the method is NOT offered`, refused(t), t.slice(0, 90)); await ctx.close(); }
  { const w = await noticeText();
    check('3-D Secure Required: the settings page says the gateway is not offered on the Checkout block and how to fix it', /3D Secure is set to Required, and your checkout page uses the Checkout block, so this gateway is not offered there/.test(w) && /classic checkout/.test(w), w.slice(0, 200)); }

  // ---------------------------------------------------------------- Phase 8: classic checkout page and the setting off: nothing registered (as before)
  await cfg('native=no&tds=off&chk=classic');
  { const st = await probe('state2');
    check('Classic checkout page, setting OFF: the native method is not offered and not declared compatible (unchanged)', st.enabled === false && st.page_is_block === false && st.setting_on === false && st.compatible === false && st.incompatible === true, j(st)); }
  { const w = await noticeText();
    check('Classic checkout page: no Checkout-block warning on the settings page', !/your checkout page uses the Checkout block/.test(w), w.slice(0, 120)); }
  await cfg('native=unset&tds=off&chk=block');

  await browser.close();
} catch (e) {
  check('test run completed without an error', false, String(e.message).slice(0, 300));
} finally {
  if (server) { try { if (process.platform === 'win32') { spawn('taskkill', ['/PID', String(server.pid), '/T', '/F']); } else { server.kill(); } } catch { /* ignore */ } }
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
