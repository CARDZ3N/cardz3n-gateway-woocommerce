// End-to-end (local stand-in) check: 3-D Secure on the classic checkout, new cards only, in two modes (Attempt and Required) and Off.
//
// What is proven here is the plugin's side: what the checkout page does, what it posts, what the server refuses and what it sends to
// the gateway. The real Gateway.js, a real issuer and a real gateway with Payer Authentication are NOT involved: Gateway.js and
// Collect.js are replaced by stubs (frictionless complete, a challenge then complete, failed, gateway error, a crash, silence), and
// the gateway's HTTP is stubbed and recorded (no keys, nothing leaves the machine). Details that depend on NMI's answers are
// ASSUMPTIONS T1 to T8 in includes/class-cardz3n-three-ds.php.
//
// Rules under test:
//   - Off (default, also with no setting saved or only the old dead checkbox saved): nothing changes.
//   - Attempt: if 3-D Secure cannot run (script does not load, gateway error, 20 seconds of silence, a crash, a missing name) the
//     payment goes on WITHOUT 3-D Secure data and the order says so.
//   - Required: in all of those cases the payment is stopped with a plain message and nothing is sent to the gateway.
//   - A bank-reported failure stops the payment in both modes.
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

// Gateway.js stub. Behaviour comes from window.__3ds: complete (frictionless), challenge-then-complete, failure (the bank says failed),
// error (the gateway reports an error, for example Payer Authentication is not enabled), throw (createUI crashes), silent (no answer).
const STUB_GATEWAY_JS = `
window.__gw = { created: null, options: null, started: null, events: [] };
window.Gateway = { create: function (key) {
  window.__gw.created = key;
  var gh = {};
  return {
    on: function (ev, cb) { gh[ev] = cb; },
    get3DSecure: function () { return { createUI: function (opts) {
      window.__gw.options = opts; var h = {};
      if ((window.__3ds || 'complete') === 'throw') { throw new Error('createUI failed: payer authentication is not enabled'); }
      return {
        on: function (ev, cb) { h[ev] = cb; },
        start: function (sel) {
          window.__gw.started = sel;
          var mode = window.__3ds || 'complete';
          if (mode === 'silent') { return; }
          setTimeout(function () {
            if (mode === 'error') { gh.error && gh.error({ message: 'payer authentication is not enabled' }); return; }
            if (mode === 'cancel-failure') { h.challenge && h.challenge({}); h.failure && h.failure({ code: 'CANCELLED', message: 'The shopper cancelled the challenge' }); return; }
            if (mode === 'cancel-incomplete') { h.challenge && h.challenge({}); h.complete && h.complete({ cardHolderAuth: 'incomplete' }); return; }
            if (mode === 'challenge-hang') { h.challenge && h.challenge({}); return; }
            if (mode === 'blocked-rule') { console.error('Gateway.js - ThreeDSecureUI: Payer Authentication Error - Blocked due to Failed Authentication rule REFID: 123456'); return; }
            if (mode === 'console-error') { console.error('Gateway.js - ThreeDSecureUI: A 3DS error occurred: Error Processing PARes'); return; }
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
async function placeOrder(browser, { mode = 'complete', gatewayScript = true, product = 'E2E Test Item', lastName = 'Buyer', waitMs = 6000 } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await ctx.newPage(); page.setDefaultTimeout(300000);
  const seen = { gatewayJsRequests: 0, posts: [], reports: [] };
  await page.route(/Collect\.js/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB_COLLECT_JS }));
  await page.route(/Gateway\.js/, (route) => { seen.gatewayJsRequests++; return gatewayScript ? route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB_GATEWAY_JS }) : route.abort(); });
  await page.route(/admin-ajax\.php/, (route) => { const d = route.request().postData() || ''; if (/action=cardz3n_gw_3ds_report/.test(d)) { seen.reports.push((d.match(/reason=([^&]*)/) || [])[1] || ''); return route.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' }); } return route.continue(); });
  // The checkout request is captured and answered with a failure, so no order is created: the server side is tested separately below.
  await page.route(/wc-ajax=checkout/, (route) => { seen.posts.push(route.request().postData() || ''); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: 'failure', messages: '<ul class="woocommerce-error"><li>stub: order not created</li></ul>', refresh: false, reload: false }) }); });
  await page.addInitScript((m) => { window.__3ds = m; window.__errSeen = []; setInterval(() => { document.querySelectorAll('.woocommerce-error, .cardz3n-errors').forEach((e) => { const t = (e.innerText || '').trim(); if (t && !/secure payment form did not load|stub: order not created/i.test(t) && !window.__errSeen.includes(t)) { window.__errSeen.push(t); } }); }, 50); }, mode);
  await page.goto(base + '/', { waitUntil: 'domcontentloaded', timeout: 300000 });
  const pid = await page.evaluate((name) => fetch('/wp-json/wc/store/v1/products?search=' + encodeURIComponent(name)).then((r) => r.json()).then((p) => p[0].id), product);
  await page.goto(`${base}/?add-to-cart=${pid}`, { waitUntil: 'domcontentloaded' });
  await page.goto(base + '/checkout-classic/');
  await page.waitForSelector('form.checkout');
  await page.waitForTimeout(4000);
  const fill = { billing_first_name: 'Test', billing_last_name: lastName, billing_address_1: '1 Test St', billing_city: 'Los Angeles', billing_postcode: '90001', billing_phone: '5555550100', billing_email: 'e2e@example.test' };
  for (const [k, v] of Object.entries(fill)) { const el = page.locator(`[name="${k}"]`); if (await el.count()) { await el.first().fill(v); } }
  const pre = await page.evaluate(() => ({ mount: !!document.querySelector('#cardz3n-3ds-mount'), cfg: window.CARDZ3N_GW ? window.CARDZ3N_GW.threeDs : null }));
  await page.evaluate(() => { const m = document.querySelector('#payment_method_cardz3n_gateway'); if (m) { m.checked = true; } });
  await page.click('#place_order');
  await page.waitForTimeout(waitMs);
  const after = await page.evaluate(() => ({ gw: window.__gw, errors: window.__errSeen || [], tokenField: (document.querySelector('input[name="cardz3n_payment_token"]') || {}).value || '' }));
  await ctx.close();
  const body = seen.posts[0] ? Object.fromEntries(new URLSearchParams(seen.posts[0])) : null;
  return { pre, after, seen, body };
}

const setMode = async (browser, v) => {
  const ctx = await browser.newContext(); const p = await ctx.newPage(); p.setDefaultTimeout(300000);
  await p.goto(`${base}/?cardz3n_e2e=cfg3ds&v=${v}`, { waitUntil: 'domcontentloaded', timeout: 300000 });
  await ctx.close();
};
const AUTH_KEYS = /^cardz3n_3ds_(cavv|xid|eci|cardholder_auth|version|directory_server_id)$/;
// The payment went on WITHOUT 3-D Secure: one order request, the token, status "unavailable", no authentication values, no error.
const wentOn = (x) => x.seen.posts.length === 1 && !!x.body && x.body.cardz3n_payment_token === 'tok-3ds-e2e' && x.body.cardz3n_3ds_status === 'unavailable' && !Object.keys(x.body).some((k) => AUTH_KEYS.test(k)) && x.after.errors.length === 0;
// The payment was stopped: no order request, a plain message, the used token cleared.
const stopped = (x, re, reason) => x.seen.posts.length === 0 && x.after.errors.some((e) => re.test(e)) && x.after.tokenField === '' && (reason === undefined || (x.seen.reports.length === 1 && x.seen.reports[0] === reason));
// The payment went on without 3-D Secure and the order request carries the reason.
const wentOnBecause = (x, reason) => wentOn(x) && x.body.cardz3n_3ds_reason === reason;
const BANK = /could not be verified with your bank/i;

try {
  if (!base) base = await startPlayground();
  const browser = await chromium.launch({ headless: true });

  // ---------------------------------------------------------------- ATTEMPT (the suite starts in this mode)
  await setMode(browser, 'attempt');
  const ok = await placeOrder(browser, { mode: 'complete' });
  check('Attempt: Gateway.js is requested and the page has the 3-D Secure mount point', ok.seen.gatewayJsRequests >= 1 && ok.pre.mount === true, j({ requests: ok.seen.gatewayJsRequests, mount: ok.pre.mount }));
  check('Attempt: the page settings carry the mode and a public key', !!ok.pre.cfg && ok.pre.cfg.mode === 'attempt' && /^e2e-placeholder/.test(ok.pre.cfg.publicKey || ''), j(ok.pre.cfg && { mode: ok.pre.cfg.mode }));
  check('Attempt: frictionless: the authentication is created with the card token and billing details and started in the mount point', !!ok.after.gw && ok.after.gw.options && ok.after.gw.options.paymentToken === 'tok-3ds-e2e' && ok.after.gw.options.firstName === 'Test' && ok.after.gw.options.postalCode === '90001' && ok.after.gw.started === '#cardz3n-3ds-mount', j(ok.after.gw && ok.after.gw.options));
  check('Attempt: frictionless: the order request carries the authentication result with the token', !!ok.body && ok.body.cardz3n_3ds_status === 'complete' && ok.body.cardz3n_3ds_cavv === 'CAVV123abc=' && ok.body.cardz3n_3ds_eci === '05' && ok.body.cardz3n_3ds_cardholder_auth === 'verified' && ok.body.cardz3n_3ds_version === '2.2.0' && ok.body.cardz3n_3ds_directory_server_id === 'DS-1' && ok.body.cardz3n_payment_token === 'tok-3ds-e2e', j(ok.body && Object.keys(ok.body).filter((k) => /3ds|token/.test(k))));
  check('Attempt: display-only text from the issuer is not sent', !!ok.body && !Object.values(ok.body).some((v) => v === 'ignored'));
  check('Normal cart: no challengeIndicator is sent (no preference)', !!ok.after.gw && !!ok.after.gw.options && ok.after.gw.options.challengeIndicator === undefined, j(ok.after.gw && ok.after.gw.options && ok.after.gw.options.challengeIndicator));

  const ch = await placeOrder(browser, { mode: 'challenge-then-complete' });
  check('Attempt: challenge then complete: the order request is sent once, with the result', ch.seen.posts.length === 1 && !!ch.body && ch.body.cardz3n_3ds_status === 'complete', 'posts: ' + ch.seen.posts.length);

  const subCart = await placeOrder(browser, { mode: 'complete', product: 'E2E Subscription Item' });
  check("Subscription cart: the authentication is asked with challengeIndicator '04' (confirmed by NMI)", !!subCart.after.gw && !!subCart.after.gw.options && subCart.after.gw.options.challengeIndicator === '04', j(subCart.after.gw && subCart.after.gw.options && subCart.after.gw.options.challengeIndicator));

  const bankFail = await placeOrder(browser, { mode: 'failure' });
  check('Attempt: the bank reports the authentication as FAILED: the payment is stopped with a plain message and the token is cleared', stopped(bankFail, /could not be verified/i), j({ posts: bankFail.seen.posts.length, errors: bankFail.after.errors, token: bankFail.after.tokenField }));

  const aGone = await placeOrder(browser, { gatewayScript: false });
  check('Attempt: Gateway.js does not load: the payment goes on WITHOUT 3-D Secure, no error shown, the reason is sent with the order', wentOnBecause(aGone, 'script_unavailable'), j({ posts: aGone.seen.posts.length, errors: aGone.after.errors }));
  const aErr = await placeOrder(browser, { mode: 'error' });
  check('Attempt: the gateway reports an error (Payer Authentication not enabled): the payment goes on without 3-D Secure, with the reason', wentOnBecause(aErr, 'gateway_error'), j({ posts: aErr.seen.posts.length, errors: aErr.after.errors }));
  const aThrow = await placeOrder(browser, { mode: 'throw' });
  check('Attempt: starting 3-D Secure crashes: the payment goes on without 3-D Secure, with the reason', wentOnBecause(aThrow, 'crash'), j({ posts: aThrow.seen.posts.length, errors: aThrow.after.errors }));
  const aSilent = await placeOrder(browser, { mode: 'silent', waitMs: 27000 });
  check('Attempt: nothing answers within 20 seconds: the payment goes on without 3-D Secure, with the reason', wentOnBecause(aSilent, 'timeout'), j({ posts: aSilent.seen.posts.length, errors: aSilent.after.errors }));
  for (const [mname, mlabel] of [['cancel-failure', 'cancels the challenge (a failure event)'], ['cancel-incomplete', 'cancels the challenge (an incomplete result)'], ['challenge-hang', 'never finishes the challenge']]) {
    const cx = await placeOrder(browser, { mode: mname, waitMs: 9000 });
    check(`Attempt: the shopper ${mlabel}: the payment is STOPPED with a plain message, nothing is sent, not charged silently`, stopped(cx, /could not be verified/i), j({ posts: cx.seen.posts.length, errors: cx.after.errors }));
  }
  const aBlocked = await placeOrder(browser, { mode: 'blocked-rule' });
  check('Attempt: the gateway blocks a failed authentication and Gateway.js only logs it to the console (real behaviour on the demo account): the payment is STOPPED, not taken without 3-D Secure', stopped(aBlocked, /could not be verified/i), j({ posts: aBlocked.seen.posts.length, errors: aBlocked.after.errors }));
  const aConsole = await placeOrder(browser, { mode: 'console-error' });
  check('Attempt: Gateway.js logs a 3-D Secure processing error to the console only: the payment goes on without 3-D Secure, with the reason gateway_error', wentOnBecause(aConsole, 'gateway_error'), j({ posts: aConsole.seen.posts.length, errors: aConsole.after.errors }));
  const aName = await placeOrder(browser, { mode: 'complete', lastName: '' });
  check('Attempt: no last name: 3-D Secure is not started and the payment goes on without it, with the reason', wentOnBecause(aName, 'name_missing') && !(aName.after.gw && aName.after.gw.created), j({ posts: aName.seen.posts.length, started: !!(aName.after.gw && aName.after.gw.created) }));

  // ---------------------------------------------------------------- REQUIRED
  await setMode(browser, 'required');
  const rOk = await placeOrder(browser, { mode: 'complete' });
  check('Required: frictionless: the payment goes through with the authentication values', !!rOk.body && rOk.body.cardz3n_3ds_status === 'complete' && rOk.body.cardz3n_3ds_eci === '05' && rOk.pre.cfg && rOk.pre.cfg.mode === 'required', j(rOk.body && Object.keys(rOk.body).filter((k) => /3ds/.test(k))));
  const rBank = await placeOrder(browser, { mode: 'failure' });
  check('Required: the bank reports the authentication as FAILED: the payment is stopped with a plain message', stopped(rBank, /could not be verified/i), j({ posts: rBank.seen.posts.length, errors: rBank.after.errors }));
  const rGone = await placeOrder(browser, { gatewayScript: false });
  check('Required: Gateway.js does not load: the payment is STOPPED with a plain message, nothing is sent, and the cause is reported to the server', stopped(rGone, BANK, 'script_unavailable'), j({ posts: rGone.seen.posts.length, errors: rGone.after.errors }));
  const rErr = await placeOrder(browser, { mode: 'error' });
  check('Required: the gateway reports an error (Payer Authentication not enabled): the payment is stopped and the cause is reported', stopped(rErr, BANK, 'gateway_error'), j({ posts: rErr.seen.posts.length, errors: rErr.after.errors }));
  const rThrow = await placeOrder(browser, { mode: 'throw' });
  check('Required: starting 3-D Secure crashes: the payment is stopped and the cause is reported', stopped(rThrow, BANK, 'crash'), j({ posts: rThrow.seen.posts.length, errors: rThrow.after.errors }));
  const rSilent = await placeOrder(browser, { mode: 'silent', waitMs: 27000 });
  check('Required: nothing answers within 20 seconds: the payment is stopped and the cause is reported', stopped(rSilent, BANK, 'timeout'), j({ posts: rSilent.seen.posts.length, errors: rSilent.after.errors }));
  for (const [mname, mlabel] of [['cancel-failure', 'cancels the challenge (a failure event)'], ['cancel-incomplete', 'cancels the challenge (an incomplete result)'], ['challenge-hang', 'never finishes the challenge']]) {
    const cx = await placeOrder(browser, { mode: mname, waitMs: 9000 });
    check(`Required: the shopper ${mlabel}: the payment is STOPPED with a plain message, nothing is sent`, stopped(cx, /could not be verified/i), j({ posts: cx.seen.posts.length, errors: cx.after.errors }));
  }
  const rBlocked = await placeOrder(browser, { mode: 'blocked-rule' });
  check('Required: the gateway blocks a failed authentication (console message only): the payment is stopped with a plain message', stopped(rBlocked, /could not be verified/i), j({ posts: rBlocked.seen.posts.length, errors: rBlocked.after.errors }));
  const rConsole = await placeOrder(browser, { mode: 'console-error' });
  check('Required: Gateway.js logs a 3-D Secure processing error (console only): the payment is stopped and the cause is reported', stopped(rConsole, BANK, 'gateway_error'), j({ posts: rConsole.seen.posts.length, errors: rConsole.after.errors }));
  const rName = await placeOrder(browser, { mode: 'complete', lastName: '' });
  check('Required: no last name: the payment is stopped, the shopper is asked for the name and the cause is reported', stopped(rName, /first and last name/i, 'name_missing') && !(rName.after.gw && rName.after.gw.created), j({ posts: rName.seen.posts.length, errors: rName.after.errors }));

  // ---------------------------------------------------------------- OFF, fresh install and upgrade, the first build's checkbox
  await setMode(browser, 'off');
  const off = await placeOrder(browser, { mode: 'complete' });
  check('Off: Gateway.js is not requested, no mount point, the order request has the token and no 3-D Secure values', off.seen.gatewayJsRequests === 0 && off.pre.mount === false && !!off.body && off.body.cardz3n_payment_token === 'tok-3ds-e2e' && !Object.keys(off.body).some((k) => /^cardz3n_3ds_/.test(k)), j({ requests: off.seen.gatewayJsRequests, mount: off.pre.mount }));
  await setMode(browser, 'unset');
  const upg = await placeOrder(browser, { mode: 'complete' });
  check('Fresh install and upgrade (no mode saved, the old dead checkbox saved as yes): 3-D Secure is off: no Gateway.js, no mount point, no values', upg.seen.gatewayJsRequests === 0 && upg.pre.mount === false && !!upg.body && !Object.keys(upg.body).some((k) => /^cardz3n_3ds_/.test(k)), j({ requests: upg.seen.gatewayJsRequests, mount: upg.pre.mount }));

  // ---------------------------------------------------------------- the server
  const ctx = await browser.newContext(); const page = await ctx.newPage(); page.setDefaultTimeout(300000);
  await page.goto(`${base}/?cardz3n_e2e=suite`, { waitUntil: 'domcontentloaded', timeout: 300000 });
  const text = await page.evaluate(() => document.body.innerText);
  let r;
  try { r = JSON.parse(text); } catch (e) { check('the scenario suite ran', false, text.slice(0, 200)); throw e; }
  const reqs = (x, t) => (x.requests || []).filter((q) => q.type === t);
  const has3ds = (q) => ['cavv', 'eci', 'xid', 'cardholder_auth', 'three_ds_version', 'directory_server_id'].some((k) => q && q[k] !== undefined);
  const note = (x, re) => (x.notes || []).some((n) => re.test(n));
  const SENT_WITHOUT = /3-D Secure was not available for this payment.*sent without it/;
  const REFUSED = /3-D Secure is required, but no valid authentication was received for this card, so the payment was not sent to the gateway/;

  for (const m of ['attempt', 'required']) {
    const tag = m === 'attempt' ? 'Attempt' : 'Required';
    const au = r[m + '_authenticated']; const aus = reqs(au, 'sale')[0] || {};
    check(`Server, ${tag}: an authenticated new card is accepted and the sale carries the six authentication values`, au.result === 'success' && reqs(au, 'sale').length === 1 && aus.cavv === 'CAVV123abc=' && aus.eci === '05' && aus.xid === 'XID.1' && aus.cardholder_auth === 'verified' && aus.three_ds_version === '2.2.0' && aus.directory_server_id === 'DS-1', j(aus));
    check(`Server, ${tag}: the buyer's email is sent to the gateway exactly as on the order (the plugin never removes it)`, aus.email === 'e2e@example.test', j({ email: aus.email }));
    check(`Server, ${tag}: the order note says the card was authenticated (no card data)`, note(au, /3-D Secure: the card was authenticated.*ECI 05, verified, version 2\.2\.0/), j(au.notes));
    const na = r[m + '_not_authenticated'];
    const ps = r[m + '_status_not_complete'];
    const nn = r[m + '_no_name'];
    const tr = r[m + '_trial_authenticated']; const trs = reqs(tr, 'validate')[0] || {};
    const tn = r[m + '_trial_not_authenticated'];
    const wl = r[m + '_wallet']; const wls = reqs(wl, 'sale')[0] || {};
    if (m === 'attempt') {
      check('Server, Attempt: no authentication data: the payment goes on WITHOUT 3-D Secure values, with an order note', na.result === 'success' && reqs(na, 'sale').length === 1 && !has3ds(reqs(na, 'sale')[0]) && note(na, SENT_WITHOUT), j({ result: na.result, req: na.requests }));
      check('Server, Attempt: an authentication that did not finish goes on without 3-D Secure values (stray posted values are ignored)', ps.result === 'success' && reqs(ps, 'sale').length === 1 && !has3ds(reqs(ps, 'sale')[0]), j({ result: ps.result, req: ps.requests }));
      check('Server, Attempt: an order without a first and last name goes on without 3-D Secure values, it is not refused', nn.result === 'success' && reqs(nn, 'sale').length === 1 && !has3ds(reqs(nn, 'sale')[0]), j({ result: nn.result }));
      check('Server, Attempt: a free trial or pre-order with the card authenticated: the $0.00 verification carries the 3-D Secure values', tr.result === 'success' && !!trs.type && trs.eci === '05' && trs.cavv === 'CAVV123abc=', j(trs));
      check('Server, Attempt: a free trial or pre-order with no authentication: the $0.00 verification goes on without 3-D Secure values, with an order note', tn.result === 'success' && reqs(tn, 'validate').length === 1 && !has3ds(reqs(tn, 'validate')[0]) && note(tn, SENT_WITHOUT), j({ result: tn.result, req: tn.requests }));
    } else {
      check('Server, Required: no authentication data: the payment is REFUSED and nothing is sent to the gateway', na.result === 'failure' && (na.requests || []).length === 0 && note(na, REFUSED), j({ result: na.result, req: na.requests }));
      check('Server, Required: an authentication that did not finish is refused and nothing is sent', ps.result === 'failure' && (ps.requests || []).length === 0, j({ result: ps.result, req: ps.requests }));
      check('Server, Required: an order without a first and last name is refused and nothing is sent', nn.result === 'failure' && (nn.requests || []).length === 0, j({ result: nn.result, req: nn.requests }));
      check('Server, Required: a free trial or pre-order with the card authenticated: the $0.00 verification carries the 3-D Secure values', tr.result === 'success' && !!trs.type && trs.eci === '05' && trs.cavv === 'CAVV123abc=', j(trs));
      check('Server, Required: a free trial or pre-order with no authentication is refused and nothing is sent', tn.result === 'failure' && (tn.requests || []).length === 0, j({ result: tn.result, req: tn.requests }));
    }
    // The server decides, not the browser: tampered, failed and not-enrolled results (the gateway accepts a sale without 3-D Secure data).
    const cn = r[m + '_cancelled'];
    check(`Server, ${tag}: a posted cancelled or incomplete challenge stops the payment, nothing is sent, not charged silently`, cn.result === 'failure' && (cn.requests || []).length === 0, j({ result: cn.result, req: cn.requests }));
    const tp = r[m + '_tampered']; const fst = r[m + '_failed_status']; const frs = r[m + '_failed_result']; const ne = r[m + '_not_enrolled']; const nc = r[m + '_no_cavv'];
    const FAILED_NOTE = /3-D Secure: the authentication failed, so the payment was not sent to the gateway/;
    check(`Server, ${tag}: a posted failed authentication (status failed) stops the payment, nothing is sent, plain message`, fst.result === 'failure' && (fst.requests || []).length === 0 && note(fst, FAILED_NOTE), j({ result: fst.result, req: fst.requests }));
    check(`Server, ${tag}: values that say the authentication failed (result failed, ECI 07) stop the payment, nothing is sent`, frs.result === 'failure' && (frs.requests || []).length === 0 && note(frs, FAILED_NOTE), j({ result: frs.result, req: frs.requests }));
    // Not enrolled (nothing to authenticate): accepted in BOTH modes, the values are sent, the order says so.
    const nes = r[m + '_not_enrolled_sandbox']; const ness = reqs(nes, 'sale')[0] || {};
    check(`Server, ${tag}: a card that is not enrolled in 3-D Secure (ECI 07, empty CAVV) is accepted with an order note that says there was no authentication result`, ne.result === 'success' && reqs(ne, 'sale').length === 1 && reqs(ne, 'sale')[0].eci === '07' && note(ne, /not enrolled in 3-D Secure \(ECI 07\).*normal card payment/), j({ result: ne.result, req: ne.requests, notes: ne.notes }));
    check(`Server, ${tag}: the NMI sandbox "Not enrolled" shape (attempted, empty CAVV, ECI 07) is accepted and sent as it is`, nes.result === 'success' && ness.eci === '07' && ness.cardholder_auth === 'attempted' && ness.cavv === undefined, j(ness));
    if (m === 'attempt') {
      for (const [nm, x] of [['tampered values (bad characters, too long)', tp], ['an ECI that is not a "not enrolled" value, with no cryptogram', r.attempt_eci_without_cavv], ['a result without the cryptogram (no cavv)', nc]]) {
        check(`Server, Attempt: ${nm}: the payment goes on WITHOUT any 3-D Secure values and the order says so`, x.result === 'success' && reqs(x, 'sale').length === 1 && !has3ds(reqs(x, 'sale')[0]) && note(x, SENT_WITHOUT), j({ result: x.result, req: x.requests }));
      }
    } else {
      for (const [nm, x] of [['tampered values (bad characters, too long)', tp], ['an ECI that is not a "not enrolled" value, with no cryptogram', r.required_eci_without_cavv], ['a result without the cryptogram (no cavv)', nc]]) {
        check(`Server, Required: ${nm}: the payment is REFUSED and nothing is sent to the gateway`, x.result === 'failure' && (x.requests || []).length === 0 && note(x, /3-D Secure is required, but no valid authentication was received/), j({ result: x.result, req: x.requests }));
      }
    }
    check(`Server, ${tag}: a wallet payment is not asked for 3-D Secure (its token has its own cryptogram)`, wl.result === 'success' && reqs(wl, 'sale').length === 1 && !has3ds(wls), j(wls));
  }
  for (const m of ['attempt', 'required']) {
    const rs = r[m + '_reason']; const ru = r[m + '_reason_unknown'];
    check(`Server, ${m === 'attempt' ? 'Attempt' : 'Required'}: the cause the browser reported is written into the order note`, note(rs, /Cause: Gateway\.js could not be loaded from the gateway host\./), j(rs.notes));
    check(`Server, ${m === 'attempt' ? 'Attempt' : 'Required'}: an unknown cause is ignored (only the fixed list is accepted)`, !note(ru, /Cause:/), j(ru.notes));
  }
  const bd = r.bad_values_dropped; const bds = reqs(bd, 'sale')[0] || {};
  check('Server (Attempt): tampered values are never sent, not even the parts that look fine: the payment goes on without 3-D Secure values', bd.result === 'success' && !has3ds(bds), j(bds));
  const o1 = r.off_ignores_posted_values;
  check('Server, Off: posted authentication values are ignored, nothing extra is sent', o1.result === 'success' && !has3ds(reqs(o1, 'sale')[0] || {}), j(reqs(o1, 'sale')[0]));
  const o2 = r.off_no_values;
  check('Server, Off: a card payment is unchanged', o2.result === 'success' && reqs(o2, 'sale').length === 1 && !note(o2, /3-D Secure/), j(o2));
  const un = r.unset_is_off;
  check('Server: with no mode saved (even if the old dead checkbox was saved as yes) 3-D Secure is off and the sale carries no values', un.mode === 'off' && un.result === 'success' && !has3ds(reqs(un, 'sale')[0] || {}), j({ mode: un.mode }));
  const lg = r.legacy_yes_is_attempt;
  check('Server: the first build\'s yes/no checkbox saved as yes counts as Attempt', lg.mode === 'attempt', j({ mode: lg.mode }));
  const sb = r.subscription_first_then_renewal; const fs = reqs({ requests: sb.first_requests }, 'sale')[0] || {}; const rs = reqs({ requests: sb.renewal_requests }, 'sale')[0] || {};
  check('Subscription (Required): the first payment is authenticated and the card is saved for the renewals', sb.first_result === 'success' && fs.eci === '05' && fs.customer_vault === 'add_customer' && fs.initiated_by === 'customer', j(fs));
  check('Subscription: the renewal is merchant-initiated, sent from the saved card with the first transaction ID and NO 3-D Secure values (ASSUMPTION T4)', ['processing', 'completed'].includes(sb.renewal_status) && !!rs.customer_vault_id && rs.initiated_by === 'merchant' && !!rs.initial_transaction_id && !has3ds(rs), j(rs));
  check('The native block checkout is switched off while 3-D Secure is on (Attempt or Required), and back on when it is Off', r.native_blocks.attempt === false && r.native_blocks.required === false && r.native_blocks.off === true, j(r.native_blocks));
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
