// End-to-end (local stand-in) check: 3-D Secure on the classic checkout, new cards only.
//
// What is proven here is the plugin's side: what the checkout page does, what it posts, what the server refuses and what it sends
// to the gateway. The real Gateway.js, the real issuer and the real gateway are NOT involved: Gateway.js and Collect.js are replaced
// by stubs, and the gateway's HTTP is stubbed and recorded (no keys, nothing leaves the machine). Details that depend on NMI's
// answers are ASSUMPTIONS T1 to T7 in includes/class-cardz3n-three-ds.php.
//
// Run (from the plugin folder, Node 18+):
//   npm i --no-save playwright && npx playwright install chromium
//   node tests/e2e/three-d-secure.spec.mjs
// Environment (optional): E2E_BASE_URL, PLUGIN_DIR, PW_DIR as in the other e2e specs (Playground port 9425).
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const require = createRequire(process.env.PW_DIR ? join(process.env.PW_DIR, 'package.json') : join(process.cwd(), 'package.json'));
const { chromium } = require('playwright');

const pluginDir = resolve(process.env.PLUGIN_DIR || process.cwd());
let base = process.env.E2E_BASE_URL;
let server = null;

async function startPlayground() {
  const port = '9425';
  const blueprint = join(pluginDir, 'tests', 'e2e', 'blueprint-three-d-secure.json');
  server = spawn('npx', ['--yes', '@wp-playground/cli@latest', 'start', '--blueprint', blueprint, '--mount', './:/wordpress/wp-content/plugins/cardz3n-gateway', '--no-auto-mount', '--skip-browser', '--reset', '--port', port, '--php', '8.2'], { cwd: pluginDir, shell: true });
  await new Promise((ok, fail) => {
    const t = setTimeout(() => fail(new Error('Playground did not become ready in 15 minutes')), 900000);
    const onData = (d) => { if (/Ready! WordPress is running/.test(String(d))) { clearTimeout(t); ok(); } };
    server.stdout.on('data', onData); server.stderr.on('data', onData);
    server.on('exit', () => fail(new Error('Playground exited early')));
  });
  return `http://127.0.0.1:${port}`;
}

// Collect.js stub: when the checkout asks for a token, it answers with one straight away.
const STUB_COLLECT_JS = `
window.__configured = null;
window.CollectJS = {
  configure: function (c) { window.__configured = c; if (typeof c.fieldsAvailableCallback === 'function') { setTimeout(c.fieldsAvailableCallback, 50); } },
  startPaymentRequest: function () { var c = window.__configured; setTimeout(function () { c.callback({ token: 'tok-3ds-e2e', tokenType: 'inline', card: { type: 'visa' } }); }, 30); },
  clearInputs: function () {}
};`;

// Gateway.js stub. Behaviour comes from window.__3ds ('complete', 'failure' or 'challenge-then-complete'); everything it is asked is recorded.
const STUB_GATEWAY_JS = `
window.__gw = { created: null, options: null, started: null, events: [] };
window.Gateway = { create: function (key) {
  window.__gw.created = key;
  return {
    on: function () {},
    get3DSecure: function () { return { createUI: function (opts) {
      window.__gw.options = opts; var h = {};
      return {
        on: function (ev, cb) { h[ev] = cb; },
        start: function (sel) {
          window.__gw.started = sel;
          var mode = window.__3ds || 'complete';
          setTimeout(function () {
            if (mode === 'failure') { h.failure && h.failure({}); return; }
            if (mode === 'challenge-then-complete') { h.challenge && h.challenge({}); window.__gw.events.push('challenge'); }
            h.complete && h.complete({ cavv: 'CAVV123abc=', xid: 'XID.1', eci: '05', cardHolderAuth: 'verified', threeDsVersion: '2.2.0', directoryServerId: 'DS-1', cardHolderInfo: 'ignored' });
          }, 80);
        }
      };
    } }; }
  };
} };`;

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`); };
const j = (x) => JSON.stringify(x);

// Opens the classic checkout, fills the billing form, presses Place order and reports what happened.
async function placeOrder(browser, { mode = 'complete', gatewayScript = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await ctx.newPage(); page.setDefaultTimeout(300000);
  const seen = { gatewayJsRequests: 0, posts: [] };
  await page.route(/Collect\.js/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB_COLLECT_JS }));
  await page.route(/Gateway\.js/, (route) => { seen.gatewayJsRequests++; return gatewayScript ? route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB_GATEWAY_JS }) : route.abort(); });
  // The checkout request is captured and answered with a failure, so no order is created: the server side is tested separately below.
  await page.route(/wc-ajax=checkout/, (route) => { seen.posts.push(route.request().postData() || ''); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: 'failure', messages: '<ul class="woocommerce-error"><li>stub: order not created</li></ul>', refresh: false, reload: false }) }); });
  await page.addInitScript((m) => { window.__3ds = m; window.__errSeen = []; setInterval(() => { document.querySelectorAll('.woocommerce-error, .cardz3n-errors').forEach((e) => { const t = (e.innerText || '').trim(); if (t && !window.__errSeen.includes(t)) { window.__errSeen.push(t); } }); }, 50); }, mode);
  await page.goto(base + '/', { waitUntil: 'domcontentloaded', timeout: 300000 });
  const pid = await page.evaluate(() => fetch('/wp-json/wc/store/v1/products?search=E2E%20Test%20Item').then((r) => r.json()).then((p) => p[0].id));
  await page.goto(`${base}/?add-to-cart=${pid}`, { waitUntil: 'domcontentloaded' });
  await page.goto(base + '/checkout-classic/');
  await page.waitForSelector('form.checkout');
  await page.waitForTimeout(4000);
  const fill = { billing_first_name: 'Test', billing_last_name: 'Buyer', billing_address_1: '1 Test St', billing_city: 'Los Angeles', billing_postcode: '90001', billing_phone: '5555550100', billing_email: 'e2e@example.test' };
  for (const [k, v] of Object.entries(fill)) { const el = page.locator(`[name="${k}"]`); if (await el.count()) { await el.first().fill(v); } }
  const pre = await page.evaluate(() => ({ mount: !!document.querySelector('#cardz3n-3ds-mount'), cfg: window.CARDZ3N_GW ? window.CARDZ3N_GW.threeDs : null }));
  await page.evaluate(() => { const m = document.querySelector('#payment_method_cardz3n_gateway'); if (m) { m.checked = true; } });
  await page.click('#place_order');
  await page.waitForTimeout(6000);
  const after = await page.evaluate(() => ({ gw: window.__gw, errors: window.__errSeen || [], tokenField: (document.querySelector('input[name="cardz3n_payment_token"]') || {}).value || '' }));
  await ctx.close();
  const body = seen.posts[0] ? Object.fromEntries(new URLSearchParams(seen.posts[0])) : null;
  return { pre, after, seen, body };
}

try {
  if (!base) base = await startPlayground();
  const browser = await chromium.launch({ headless: true });

  // 1) The page, 3-D Secure on, the card is authenticated.
  const ok = await placeOrder(browser, { mode: 'complete' });
  check('On: Gateway.js is requested and the page has the 3-D Secure mount point', ok.seen.gatewayJsRequests >= 1 && ok.pre.mount === true, j({ requests: ok.seen.gatewayJsRequests, mount: ok.pre.mount }));
  check('On: the page settings say 3-D Secure is enabled and carry a public key', !!ok.pre.cfg && !!ok.pre.cfg.enabled && /^e2e-placeholder/.test(ok.pre.cfg.publicKey || ''), j(ok.pre.cfg && { enabled: ok.pre.cfg.enabled }));
  check('On: the authentication is created with the card token and the billing details, and started in the mount point', !!ok.after.gw && ok.after.gw.created !== null && ok.after.gw.options && ok.after.gw.options.paymentToken === 'tok-3ds-e2e' && ok.after.gw.options.firstName === 'Test' && ok.after.gw.options.postalCode === '90001' && ok.after.gw.started === '#cardz3n-3ds-mount', j(ok.after.gw && ok.after.gw.options));
  check('On: the order request carries the authentication result with the token', !!ok.body && ok.body.cardz3n_3ds_status === 'complete' && ok.body.cardz3n_3ds_cavv === 'CAVV123abc=' && ok.body.cardz3n_3ds_eci === '05' && ok.body.cardz3n_3ds_cardholder_auth === 'verified' && ok.body.cardz3n_3ds_version === '2.2.0' && ok.body.cardz3n_3ds_directory_server_id === 'DS-1' && ok.body.cardz3n_payment_token === 'tok-3ds-e2e', j(ok.body && Object.keys(ok.body).filter((k) => /3ds|token/.test(k))));
  check('On: card display-only text is not sent', !!ok.body && !Object.values(ok.body).some((v) => v === 'ignored'));

  // 2) A challenge first, then complete: still one order request.
  const ch = await placeOrder(browser, { mode: 'challenge-then-complete' });
  check('Challenge then complete: the order request is sent once, with the result', ch.seen.posts.length === 1 && !!ch.body && ch.body.cardz3n_3ds_status === 'complete', 'posts: ' + ch.seen.posts.length);

  // 3) Authentication fails: nothing is sent to the order request, the shopper sees a plain message, the token is cleared.
  const bad = await placeOrder(browser, { mode: 'failure' });
  check('Failure: no order request is sent', bad.seen.posts.length === 0, 'posts: ' + bad.seen.posts.length);
  check('Failure: the shopper sees a plain message', bad.after.errors.some((e) => /could not be verified/i.test(e)), j(bad.after.errors));
  check('Failure: the used token is cleared so the next try mints a new one', bad.after.tokenField === '', 'token field: "' + bad.after.tokenField + '"');

  // 4) Gateway.js cannot be loaded: nothing is sent, plain message.
  const gone = await placeOrder(browser, { gatewayScript: false });
  check('Gateway.js unavailable: no order request is sent', gone.seen.posts.length === 0, 'posts: ' + gone.seen.posts.length);
  check('Gateway.js unavailable: the shopper sees a plain message', gone.after.errors.some((e) => /not available right now/i.test(e)), j(gone.after.errors));

  // 5) The setting off: unchanged checkout (no Gateway.js, no 3-D Secure values).
  const ctl = await browser.newContext(); const cp = await ctl.newPage(); cp.setDefaultTimeout(300000);
  await cp.goto(`${base}/?cardz3n_e2e=cfg3ds&v=no`, { waitUntil: 'domcontentloaded', timeout: 300000 });
  await ctl.close();
  const off = await placeOrder(browser, { mode: 'complete' });
  check('Off: Gateway.js is not requested and there is no mount point', off.seen.gatewayJsRequests === 0 && off.pre.mount === false, j({ requests: off.seen.gatewayJsRequests, mount: off.pre.mount }));
  check('Off: the order request is sent with the token and no 3-D Secure values', !!off.body && off.body.cardz3n_payment_token === 'tok-3ds-e2e' && !Object.keys(off.body).some((k) => /^cardz3n_3ds_/.test(k)), j(off.body && Object.keys(off.body).filter((k) => /3ds|token/.test(k))));

  // 6) The server (the suite starts with the setting switched on and switches it itself).
  const ctx = await browser.newContext(); const page = await ctx.newPage(); page.setDefaultTimeout(300000);
  await page.goto(`${base}/?cardz3n_e2e=suite`, { waitUntil: 'domcontentloaded', timeout: 300000 });
  const text = await page.evaluate(() => document.body.innerText);
  let r;
  try { r = JSON.parse(text); } catch (e) { check('the scenario suite ran', false, text.slice(0, 200)); throw e; }
  const sale = (x) => (x.requests || []).filter((q) => q.type === 'sale');
  const has3ds = (q) => ['cavv', 'eci', 'xid', 'cardholder_auth', 'three_ds_version', 'directory_server_id'].some((k) => q && q[k] !== undefined);

  const a = r.on_card_not_authenticated;
  check('Server, on: a new card with no authentication is refused and nothing is sent to the gateway', a.result === 'failure' && (a.requests || []).length === 0, j(a));
  const b = r.on_card_status_not_complete;
  check('Server, on: an authentication that did not finish is refused and nothing is sent', b.result === 'failure' && (b.requests || []).length === 0, j(b));
  const c = r.on_card_authenticated;
  const cs = sale(c)[0] || {};
  check('Server, on: an authenticated card is accepted and the sale carries the authentication values', c.result === 'success' && sale(c).length === 1 && cs.cavv === 'CAVV123abc=' && cs.eci === '05' && cs.xid === 'XID.1' && cs.cardholder_auth === 'verified' && cs.three_ds_version === '2.2.0' && cs.directory_server_id === 'DS-1', j(cs));
  check('Server, on: the order note says the card was authenticated (no card data)', (c.notes || []).some((n) => /3-D Secure: the card was authenticated.*ECI 05, verified, version 2\.2\.0/.test(n)), j(c.notes));
  const d = r.on_card_bad_values_dropped; const ds = sale(d)[0] || {};
  check('Server, on: values that do not look like authentication values are dropped, not sent', d.result === 'success' && ds.cavv === undefined && ds.eci === undefined && ds.cardholder_auth === 'verified', j(ds));
  const w = r.on_wallet_not_authenticated_here; const ws = sale(w)[0] || {};
  check('Server, on: a wallet payment is not asked for 3-D Secure (its token has its own cryptogram)', w.result === 'success' && sale(w).length === 1 && !has3ds(ws), j(ws));
  const o1 = r.off_card_ignores_posted_values; const o1s = sale(o1)[0] || {};
  check('Server, off: posted authentication values are ignored, nothing extra is sent', o1.result === 'success' && !has3ds(o1s), j(o1s));
  const o2 = r.off_card_no_values;
  check('Server, off: a card payment is unchanged', o2.result === 'success' && sale(o2).length === 1, j(o2));
  const s = r.subscription_first_then_renewal; const fs = (s.first_requests || []).filter((q) => q.type === 'sale')[0] || {}; const rs = (s.renewal_requests || []).filter((q) => q.type === 'sale')[0] || {};
  check('Subscription: the first payment is authenticated and the card is saved for the renewals', s.first_result === 'success' && fs.eci === '05' && fs.customer_vault === 'add_customer', j(fs));
  check('Subscription: the renewal (merchant-initiated, ASSUMPTION T4) is sent from the saved card with no 3-D Secure values', ['processing', 'completed'].includes(s.renewal_status) && !!rs.customer_vault_id && !has3ds(rs), j(rs));
  check('The native block checkout is switched off while 3-D Secure is on, and back on when it is off', r.native_blocks.with_3ds_on === false && r.native_blocks.with_3ds_off === true, j(r.native_blocks));
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
