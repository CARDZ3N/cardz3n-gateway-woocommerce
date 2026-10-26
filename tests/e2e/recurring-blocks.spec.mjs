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
//   node tests/e2e/recurring-blocks.spec.mjs
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
    await page.goto(`${base}/?add-to-cart=${pid}`, { waitUntil: 'domcontentloaded' });
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

  // ---------------------------------------------------------------- Phase 1: plugins active, switches OFF
  await cfg('stub_subs=yes&stub_pre=yes&http=yes&sw_subs=no&sw_pre=no&reset_reqs=1');
  { const f = await probe('features');
    check('Switches off: the block method advertises only products and refunds', j(f.features) === j(['products', 'refunds']) && f.active === true, j(f.features)); }
  { const { ctx, page } = await cartPage('E2E Test Item'); const t = await paymentText(page);
    check('Switches off, normal cart: the method is offered', offered(t), t.slice(0, 80)); await ctx.close(); }
  for (const [label, name] of [['subscription', 'E2E Subscription Item'], ['pre-order', 'E2E Preorder Item']]) {
    const { ctx, page } = await cartPage(name); const t = await paymentText(page);
    check(`Switches off, ${label} cart: the method is NOT offered`, refused(t), t.slice(0, 90)); await ctx.close(); }
  { const w = await warns();
    check('Switches off: the settings page warns and names both switches', /Subscriptions Support \/ Pre-Orders Support is off/.test(w), w.slice(0, 160)); }

  // ---------------------------------------------------------------- Phase 2: plugins active, switches ON
  await cfg('sw_subs=yes&sw_pre=yes&reset_reqs=1');
  { const f = await probe('features');
    const need = ['products', 'refunds', 'subscriptions', 'subscription_cancellation', 'subscription_payment_method_change_customer', 'multiple_subscriptions', 'pre-orders', 'tokenization'];
    check('Switches on: the block method advertises the subscription features, pre-orders and tokenization', need.every((x) => f.features.includes(x)) && j(f.features) === j(f.data_supports), j(f.features));
    const recurring = f.features.filter((x) => !['products', 'refunds'].includes(x));
    // 'tokenization' is added on purpose (the card is saved for the later payments); the classic list only has it with "Saved Payment Methods".
    check('Switches on: every subscription and pre-order feature is also one the classic gateway supports (mirror)', recurring.filter((x) => x !== 'tokenization').every((x) => f.classic_supports.includes(x)), j(recurring.filter((x) => x !== 'tokenization' && !f.classic_supports.includes(x))));
    check('Switches on: is_active() is still true', f.active === true); }
  { const { ctx, page } = await cartPage('E2E Test Item'); const t = await paymentText(page);
    check('Switches on, normal cart: the method is offered, as before', offered(t), t.slice(0, 80));
    check('Switches on, normal cart: no "card will be saved" line', (await page.locator('.cardz3n-block-card-saved').count()) === 0);
    await ctx.close(); }
  const placed = {};
  for (const [label, name, req] of [['subscription', 'E2E Subscription Item', 'subscriptions'], ['pre-order', 'E2E Preorder Item', 'pre-orders']]) {
    const { ctx, page } = await cartPage(name); const t = await paymentText(page);
    check(`Switches on, ${label} cart: the method is offered (no dead end)`, offered(t), t.slice(0, 90));
    const m = await methodData(page);
    check(`Switches on, ${label} cart: the method data carries the recurring supports`, !!m && m.supports.includes(req) && m.supports.includes('tokenization'), m ? j(m.supports) : 'no data');
    // ASSUMPTION: the cart store exposes paymentRequirements; if this fails the line is just not shown (the card is still saved by the server).
    check(`Switches on, ${label} cart: the "card will be saved" line is shown`, (await page.locator('.cardz3n-block-card-saved').count()) === 1, (await page.locator('.cardz3n-block-card-saved').allInnerTexts()).join('|'));
    check(`Switches on, ${label} cart: no saved-card list or save checkbox is added by the 'tokenization' feature`, !/Use another payment method|Save payment information|ending in/i.test(t), t.slice(0, 120));
    await cfg('reset_reqs=1');
    const po = await placeOrder(page); placed[label] = po;
    check(`Switches on, ${label} cart: the block checkout post carries cardz3n_payment_kind=card and the token`, po.payment_method === 'cardz3n_gateway' && po.data.cardz3n_payment_kind === 'card' && po.data.wc_payment_source === 'blocks' && po.data.cardz3n_payment_token === 'tok-e2e', j(po.data));
    check(`Switches on, ${label} cart: the real block checkout succeeds`, po.status === 200 && po.json.payment_result && po.json.payment_result.payment_status === 'success', `${po.status} ${j(po.json.payment_result || po.json).slice(0, 160)}`);
    const o = await probe('order&id=' + po.json.order_id);
    const q = (o.requests || [])[0] || {};
    check(`Switches on, ${label} cart: the card is saved (customer_vault=add_customer) and the first-payment fields are sent`, q.customer_vault === 'add_customer' && q.initiated_by === 'customer' && q.stored_credential_indicator === 'stored' && q.has_token === true, j(q));
    check(`Switches on, ${label} cart: the saved card is stored on the order`, /^V-/.test(o.order_vault) && /^TX-/.test(o.order_initial), j({ v: o.order_vault, t: o.order_initial }));
    if (req === 'subscriptions') { check('Switches on, subscription cart: the saved card is stored on the subscription too', o.sub_vault === o.order_vault && /^V-/.test(o.sub_vault || ''), String(o.sub_vault)); }
    await ctx.close();
  }
  { const { ctx, page } = await cartPage('E2E Test Item'); await cfg('reset_reqs=1');
    const po = await placeOrder(page);
    const o = await probe('order&id=' + po.json.order_id); const q = (o.requests || [])[0] || {};
    check('Normal cart on the block checkout: succeeds, kind=card, and nothing is force-saved', po.status === 200 && po.data.cardz3n_payment_kind === 'card' && q.customer_vault !== 'add_customer' && !q.initiated_by && o.order_vault === '', j(q));
    await ctx.close(); }
  // A returning customer: the card saved by the sign-up order is listed by the Checkout block; a pre-order paid with it needs no new card.
  { await cfg('clear_tokens=1');
    { const { ctx, page } = await cartPage('E2E Subscription Item', '/checkout/', true); await placeOrder(page); await ctx.close(); }
    const { ctx, page } = await cartPage('E2E Preorder Item', '/checkout/', true);
    check('Returning customer, pre-order cart: the card saved by the earlier sign-up is listed', /ending in 1111/.test(await paymentText(page)));
    await cfg('reset_reqs=1');
    const po = await placeOrder(page);
    const o = await probe('order&id=' + po.json.order_id); const q = (o.requests || [])[0] || {};
    check('Returning customer, pre-order cart: paid with the saved card (no new card data), still stored for the later charge', po.status === 200 && po.data['wc-cardz3n_gateway-payment-token'] && q.customer_vault_id && q.has_token === false && /^V-/.test(o.order_vault), j(q));
    await ctx.close(); }
  { const w = await warns(); check('Switches on: the settings page warning is gone', w === '', w.slice(0, 120)); }

  // block-checkout style post straight into process_payment() (the stand-in the brief asks for)
  { const p = await probe('posts');
    for (const label of ['subscription', 'preorder']) {
      const r = p[label] || {}; const q = (r.requests || [])[0] || {};
      check(`process_payment(), blocks-shaped post, ${label} order: success, card saved, vault stored`, r.result === 'success' && q.customer_vault === 'add_customer' && /^V-/.test(r.order_vault), j({ result: r.result, q, v: r.order_vault }));
    }
    check('process_payment(), blocks-shaped post, subscription order: the subscription gets the saved card', /^V-/.test((p.subscription || {}).sub_vault || ''), String((p.subscription || {}).sub_vault));
    const n = p.normal || {}; const nq = (n.requests || [])[0] || {};
    check('process_payment(), blocks-shaped post, normal order: unchanged (no forced save, no stored-credential fields)', n.result === 'success' && nq.customer_vault !== 'add_customer' && !nq.initiated_by && n.order_vault === '', j(nq));
    const a = p.subscription_ach || {};
    check('process_payment(), blocks-shaped bank post for a subscription order: refused, no gateway request', a.result === 'failure' && (a.requests || []).length === 0, j(a)); }

  // ---------------------------------------------------------------- Phase 3: only Subscriptions switch on
  await cfg('sw_subs=yes&sw_pre=no&reset_reqs=1');
  { const { ctx, page } = await cartPage('E2E Preorder Item'); const t = await paymentText(page);
    check('Only the Subscriptions switch on, pre-order cart: the method is NOT offered', refused(t), t.slice(0, 90)); await ctx.close(); }
  { const { ctx, page } = await cartPage('E2E Subscription Item'); const t = await paymentText(page);
    check('Only the Subscriptions switch on, subscription cart: the method is offered', offered(t), t.slice(0, 90)); await ctx.close(); }
  { const w = await warns();
    check('Only the Subscriptions switch on: the warning names only Pre-Orders Support', /but Pre-Orders Support is off/.test(w), w.slice(0, 160)); }

  // ---------------------------------------------------------------- Phase 4: switches on but the plugins are not active
  await cfg('stub_subs=no&stub_pre=no&sw_subs=yes&sw_pre=yes');
  { const f = await probe('features');
    check('Switches on but Subscriptions / Pre-Orders not active: nothing recurring is advertised', j(f.features) === j(['products', 'refunds']), j(f.features)); }

  await browser.close();
} catch (e) {
  check('test run completed without an error', false, String(e.message).slice(0, 300));
} finally {
  if (server) { try { if (process.platform === 'win32') { spawn('taskkill', ['/PID', String(server.pid), '/T', '/F']); } else { server.kill(); } } catch { /* ignore */ } }
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
