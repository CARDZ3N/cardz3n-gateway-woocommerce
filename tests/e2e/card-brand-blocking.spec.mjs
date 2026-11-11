// End-to-end check: card brand blocking. The "Accepted Card Brands" list only chooses logos unless "Block Other Card Brands" is ticked;
// when it is ticked, a card of a brand that is not in the list is refused before any charge where the brand is known (the browser's
// brand or a saved card), and an approved charge whose reply names a refused brand is voided at once. Default: nothing is blocked.
// Only Collect.js and the gateway's HTTP replies are stand-ins; no keys, no card numbers.
//
// Run (from the plugin folder, Node 18+):
//   npm i --no-save playwright && npx playwright install chromium
//   node tests/e2e/card-brand-blocking.spec.mjs
// Environment (optional): PLUGIN_DIR, PW_DIR as in the other e2e specs (Playground port 9431).
//   PW_DIR        folder that contains node_modules/playwright, if it is not installed in the current folder
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const require = createRequire(process.env.PW_DIR ? join(process.env.PW_DIR, 'package.json') : join(process.cwd(), 'package.json'));
const { chromium } = require('playwright');

const pluginDir = resolve(process.env.PLUGIN_DIR || process.cwd());
const port = '9431';
const base = `http://127.0.0.1:${port}`;
let server = null;

async function startPlayground() {
  const blueprint = join(pluginDir, 'tests', 'e2e', 'blueprint-card-brand.json');
  server = spawn('npx', ['--yes', '@wp-playground/cli@latest', 'start', '--blueprint', blueprint, '--mount', './:/wordpress/wp-content/plugins/cardz3n-gateway', '--no-auto-mount', '--skip-browser', '--reset', '--port', port, '--php', '8.2'], { cwd: pluginDir, shell: true });
  await new Promise((ok, fail) => {
    const t = setTimeout(() => fail(new Error('Playground did not become ready in 6 minutes')), 360000);
    const onData = (d) => { if (/Ready! WordPress is running/.test(String(d))) { clearTimeout(t); ok(); } };
    server.stdout.on('data', onData); server.stderr.on('data', onData);
    server.on('exit', () => fail(new Error('Playground exited early')));
  });
}

const stubCollect = (card) => `(function(){var cfg=null;window.CollectJS={configure:function(c){cfg=c;if(c.fieldsAvailableCallback){setTimeout(c.fieldsAvailableCallback,50);}},startPaymentRequest:function(){setTimeout(function(){cfg.callback({token:'stub-token-123',tokenType:'inline',card:${JSON.stringify(card)}});},300);},clearInputs:function(){}};})();`;

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`); };
const j = (x) => JSON.stringify(x);
const only = process.env.CASES ? process.env.CASES.split(',') : null; // optional: run only some of the cases, e.g. CASES=2,8
const on = (n) => !only || only.includes(String(n));
const calls = (st) => st.gateway_calls.map((c) => c.call).join(',');

async function state(ctx) { return (await ctx.request.get(base + '/?cz_state=1')).json(); }

// One classic checkout as the logged-in shopper. `cfg`: the query string that sets the scenario and the settings.
// `brand`: what the Collect.js stand-in reports ('' = no brand). `saved`: pay with the seeded saved card instead of a new one.
async function checkout(browser, cfg, { brand = 'visa', saved = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addCookies([{ name: 'playground_auto_login_already_happened', value: '1', url: base }]);
  const page = await ctx.newPage(); page.setDefaultTimeout(120000);
  let seeded = 0;
  if (saved) { seeded = (await (await ctx.request.get(`${base}/?cz_seed=1`)).json()).token_id; }
  await ctx.request.get(`${base}/?${cfg}`);
  await page.route(/Collect\.js/, (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: stubCollect(brand ? { type: brand } : {}) }));
  await page.goto(base + '/wp-login.php', { waitUntil: 'domcontentloaded' });
  await page.fill('#user_login', 'shopper'); await page.fill('#user_pass', 'e2e-shopper-pass-1');
  await Promise.all([page.waitForNavigation(), page.click('#wp-submit')]);
  const pid = await page.evaluate(() => fetch('/wp-json/wc/store/v1/products').then((r) => r.json()).then((p) => p[0].id));
  await page.goto(`${base}/?add-to-cart=${pid}`);
  await page.goto(base + '/checkout-classic/'); await page.waitForSelector('form.checkout');
  for (const [id, v] of Object.entries({ billing_first_name: 'E2E', billing_last_name: 'Tester', billing_address_1: '888', billing_city: 'Los Angeles', billing_postcode: '90001', billing_phone: '5555550100', billing_email: 'e2e@example.com' })) await page.locator('#' + id).fill(v);
  await page.waitForTimeout(4000);
  if (saved) { // the saved cards sit on their own tab
    const tab = page.locator('.cardz3n-tabs .cardz3n-tab[data-target="saved"]');
    if (await tab.count()) { await tab.click(); await page.waitForTimeout(1500); }
    await page.locator('input[name="wc-cardz3n_gateway-payment-token"]:not([value="new"])').first().check();
  }
  await page.locator('#place_order').click();
  await Promise.race([page.waitForURL(/order-received/, { timeout: 90000 }), page.locator('.woocommerce-error').first().waitFor({ timeout: 90000 })]).catch(() => {});
  await page.waitForTimeout(1500);
  const reached = page.url().includes('order-received');
  const st = await state(ctx);
  const shown = (await page.locator('.woocommerce-NoticeGroup, .woocommerce-error, [role="alert"]').allInnerTexts()).join(' ').replace(/\s+/g, ' ');
  if (process.env.DEBUG_BRAND) { console.log('DEBUG url=' + page.url() + ' notices=' + shown.slice(0, 300) + ' | calls=' + JSON.stringify(st.gateway_calls) + ' | notes=' + JSON.stringify(st.notes).slice(0, 400) + ' | inputs=' + (await page.locator('#payment input[type=radio]').evaluateAll((els) => els.map((e) => e.name + '=' + e.value + (e.checked ? '*' : '')).join(' ')))); }
  await ctx.close();
  return { reached, shown, st };
}

try {
  await startPlayground();
  const browser = await chromium.launch({ headless: true });
  const ONLY = 'cz_enf=yes&cz_allow=visa,mastercard';

  // 1) Default: the setting was never saved, so nothing is blocked (a Discover card is accepted).
  if (on(1)) { const r = await checkout(browser, 'cz_set=ok', { brand: 'discover' });
    check('1 Default (not ticked): a Discover card is accepted and the order completes', r.reached && r.st.order_status === 'processing', r.st.order_status);
    check('1 Default: no void is sent', calls(r.st) === 'sale', calls(r.st)); }

  // 2) Ticked, only Visa and Mastercard chosen, the browser says Discover: refused before any gateway call.
  if (on(2)) { const r = await checkout(browser, `cz_set=ok&${ONLY}`, { brand: 'discover' });
    check('2 Blocked brand from the browser: the shopper sees a clear message', /does not accept Discover cards/.test(r.shown), r.shown.slice(0, 160));
    check('2 Nothing is sent to the gateway (no charge, no void)', calls(r.st) === '', calls(r.st));
    check('2 The order is not paid', !r.reached && r.st.order_status !== 'processing' && r.st.order_status !== 'completed', r.st.order_status); }

  // 3) Ticked, a chosen brand is accepted.
  if (on(3)) { const r = await checkout(browser, `cz_set=ok&${ONLY}`, { brand: 'visa' });
    check('3 An accepted brand (Visa) completes the order', r.reached && r.st.order_status === 'processing', r.st.order_status);
    check('3 One sale, no void', calls(r.st) === 'sale', calls(r.st)); }

  // 4) Ticked, but the brand is unknown: never blocked on a guess.
  if (on(4)) { const r = await checkout(browser, `cz_set=ok&${ONLY}`, { brand: '' });
    check('4 An unidentified brand is not blocked', r.reached && r.st.order_status === 'processing', r.st.order_status); }

  // 5) Ticked with an empty list: nothing is blocked (never turn away every card).
  if (on(5)) { const r = await checkout(browser, 'cz_set=ok&cz_enf=yes&cz_allow=', { brand: 'discover' });
    check('5 Ticked with no brand chosen: nothing is blocked', r.reached && r.st.order_status === 'processing', r.st.order_status); }

  // 6) The browser says Visa, but the approved reply names Discover: the charge is voided at once.
  if (on(6)) { const r = await checkout(browser, `cz_set=disc_reply&${ONLY}`, { brand: 'visa' });
    check('6 Brand only known from the reply: the charge is voided (sale, then void)', calls(r.st) === 'sale,void', calls(r.st));
    check('6 The order is not paid and the shopper sees the message', !r.reached && /does not accept Discover cards/.test(r.shown) && r.st.order_status !== 'processing', `${r.st.order_status} | ${r.shown.slice(0, 120)}`);
    check('6 The order note says the payment was voided', r.st.notes.some((n) => /payment was voided: a Discover card is not accepted/.test(n)), j(r.st.notes)); }

  // 7) Same, but the void is declined: the order is held with an ACTION NEEDED note.
  if (on(7)) { const r = await checkout(browser, `cz_set=disc_reply_voidfail&${ONLY}`, { brand: 'visa' });
    check('7 A failed void puts the order on hold', r.st.order_status === 'on-hold', r.st.order_status);
    check('7 The note says ACTION NEEDED, names the brand and says to void it by hand', r.st.notes.some((n) => /ACTION NEEDED.*Discover.*Void or refund this transaction at the gateway by hand/.test(n)), j(r.st.notes));
    check('7 The shopper is told to contact the store', /contact the store/.test(r.shown), r.shown.slice(0, 120)); }

  // 8) A saved card of a refused brand: refused before any gateway call.
  if (on(8)) { const r = await checkout(browser, `cz_set=ok&${ONLY}`, { saved: true });
    check('8 A saved Discover card is refused with the message', /does not accept Discover cards/.test(r.shown), r.shown.slice(0, 160));
    check('8 Nothing is sent to the gateway', calls(r.st) === '', calls(r.st)); }

  // 9) The same saved card when the setting is off: it is used normally.
  if (on(9)) { const r = await checkout(browser, 'cz_set=ok&cz_enf=no', { saved: true });
    check('9 Setting off: the saved Discover card pays normally', r.reached && r.st.order_status === 'processing', r.st.order_status); }

  await browser.close();
} catch (e) {
  check('test run completed without an error', false, String(e.message).slice(0, 200));
} finally {
  if (server) { try { if (process.platform === 'win32') { spawn('taskkill', ['/PID', String(server.pid), '/T', '/F']); } else { server.kill(); } } catch { /* ignore */ } }
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
