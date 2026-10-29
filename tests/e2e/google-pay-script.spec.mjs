// End-to-end check: the plugin does NOT load or integrate Google's Google Pay script itself; Collect.js does that.
//
// Why: NMI (2026-10-27): with the Collect.js wallet integration, Google's pay.js is a dependency handled inside Collect.js, and we must
// not add a second, independent Google Pay integration. An earlier version loaded Google's script from the plugin and only passed
// Google Pay to Collect.js when that script had provided the library. Now the plugin loads nothing from Google, passes Google Pay to
// Collect.js whenever the store switched it on, and passes nothing when it is off.
//
// No keys, nothing is charged, nothing is sent to Google: Collect.js and Google's script are both replaced by stubs.
//
// Run (from the plugin folder, Node 18+):
//   npm i --no-save playwright && npx playwright install chromium
//   node tests/e2e/google-pay-script.spec.mjs
// Environment (optional): E2E_BASE_URL, PLUGIN_DIR, PW_DIR as in the other e2e specs (Playground port 9423).
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const require = createRequire(process.env.PW_DIR ? join(process.env.PW_DIR, 'package.json') : join(process.cwd(), 'package.json'));
const { chromium } = require('playwright');

const pluginDir = resolve(process.env.PLUGIN_DIR || process.cwd());
let base = process.env.E2E_BASE_URL;
let server = null;

async function startPlayground() {
  const port = '9423';
  const blueprint = join(pluginDir, 'tests', 'e2e', 'blueprint-google-pay.json');
  server = spawn('npx', ['--yes', '@wp-playground/cli@latest', 'start', '--blueprint', blueprint, '--mount', './:/wordpress/wp-content/plugins/cardz3n-gateway', '--no-auto-mount', '--skip-browser', '--reset', '--port', port, '--php', '8.2'], { cwd: pluginDir, shell: true });
  await new Promise((ok, fail) => {
    const t = setTimeout(() => fail(new Error('Playground did not become ready in 15 minutes')), 900000);
    const onData = (d) => { if (/Ready! WordPress is running/.test(String(d))) { clearTimeout(t); ok(); } };
    server.stdout.on('data', onData); server.stderr.on('data', onData);
    server.on('exit', () => fail(new Error('Playground exited early')));
  });
  return `http://127.0.0.1:${port}`;
}

// Records what Collect.js is configured with, and the order of events (Google's script loaded, Collect.js configured).
const STUB_COLLECT_JS = `
window.__events = window.__events || [];
window.__configured = null;
window.CollectJS = {
  configure: function (c) {
    window.__events.push('configure');
    var f = c.fields || {};
    window.__configured = { fields: Object.keys(f), googleKeys: f.googlePay ? Object.keys(f.googlePay) : null, googleEnv: f.googlePay ? f.googlePay.environment : null };
    if (typeof c.fieldsAvailableCallback === 'function') { setTimeout(c.fieldsAvailableCallback, 50); }
  },
  startPaymentRequest: function () {},
  clearInputs: function () {}
};`;
const GOOGLE_OK_JS = `window.__events = window.__events || []; window.__events.push('google-loaded'); window.google = { payments: { api: { PaymentsClient: function () {} } } };`;
const GOOGLE_EMPTY_JS = `window.__events = window.__events || []; window.__events.push('google-loaded-without-library');`;
const GOOGLE_URL = /pay\.google\.com\/gp\/p\/js\/pay\.js/;

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`); };
const j = (x) => JSON.stringify(x);

// Opens the classic checkout with a product in the cart. `google` is how Google's script request is answered.
async function checkout(browser, google) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage(); page.setDefaultTimeout(300000);
  let googleRequests = 0;
  await page.route(/Collect\.js/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB_COLLECT_JS }));
  await page.route(GOOGLE_URL, (route) => {
    googleRequests++;
    if (google === 'ok') { return route.fulfill({ status: 200, contentType: 'application/javascript', body: GOOGLE_OK_JS }); }
    if (google === 'empty') { return route.fulfill({ status: 200, contentType: 'application/javascript', body: GOOGLE_EMPTY_JS }); }
    if (google === 'fail') { return route.abort('failed'); }
    return undefined; // 'hang': never answered
  });
  await page.goto(base + '/', { waitUntil: 'domcontentloaded', timeout: 300000 });
  const pid = await page.evaluate(() => fetch('/wp-json/wc/store/v1/products').then((r) => r.json()).then((p) => p[0].id));
  await page.goto(`${base}/?add-to-cart=${pid}`, { waitUntil: 'domcontentloaded' });
  await page.goto(base + '/checkout-classic/', { waitUntil: 'domcontentloaded' }); // a script that never answers must not hold the page load
  await page.waitForSelector('form.checkout');
  await page.waitForTimeout(google === 'hang' ? 11000 : 5000);
  const state = await page.evaluate(() => ({
    configured: window.__configured,
    events: window.__events || [],
    googleBoxEmpty: !!document.querySelector('.cardz3n-googlepay-button') && document.querySelector('.cardz3n-googlepay-button').children.length === 0,
    errors: Array.from(document.querySelectorAll('.woocommerce-error, .woocommerce-notice--error')).map((e) => e.innerText.trim()).filter(Boolean),
    scriptTags: document.querySelectorAll('script[src*="pay.google.com"]').length,
    options: window.CARDZ3N_GW ? window.CARDZ3N_GW.googlePayOptions : undefined
  }));
  await ctx.close();
  return { ...state, googleRequests };
}

try {
  if (!base) base = await startPlayground();
  const browser = await chromium.launch({ headless: true });
  const admin = await (await browser.newContext()).newPage(); admin.setDefaultTimeout(300000);
  const set = async (q) => { await admin.goto(`${base}/?cardz3n_e2e=set&${q}`, { waitUntil: 'domcontentloaded', timeout: 300000 }); };

  // 1) Google Pay on: the plugin never requests Google's script; Collect.js is configured straight away with Google Pay.
  await set('gp=yes&env=0');
  const ok = await checkout(browser, 'ok');
  check('Google Pay on: the plugin requests nothing from Google (no pay.google.com request, no script tag)', ok.googleRequests === 0 && ok.scriptTags === 0, j({ requests: ok.googleRequests, tags: ok.scriptTags }));
  check('Google Pay on: Collect.js is configured straight away, with nothing waiting for Google', ok.events.length > 0 && ok.events[0] === 'configure' && !ok.events.includes('google-loaded'), j(ok.events));
  check('Google Pay on: Collect.js gets the card fields and Google Pay, with only the documented selector', !!ok.configured && ok.configured.fields.includes('ccnumber') && ok.configured.fields.includes('googlePay') && j(ok.configured.googleKeys) === j(['selector']), j(ok.configured));
  check('Google Pay on: no error is shown to the shopper', ok.errors.length === 0, j(ok.errors));

  // 2) Google's address blocked by the shopper's browser (an ad blocker, a firewall): nothing changes for the plugin, no error.
  const blocked = await checkout(browser, 'fail');
  check('Google blocked in the browser: the card fields still mount, no error is shown', !!blocked.configured && blocked.configured.fields.includes('ccnumber') && blocked.errors.length === 0, j({ configured: blocked.configured, errors: blocked.errors }));

  // 5) The documented option filter (off by default): the option is passed to Collect.js, non-plain values are dropped.
  await set('gp=yes&env=1');
  const env = await checkout(browser, 'ok');
  check('Option filter (ASSUMPTION GP1): environment TEST is passed in test mode, a non-plain value is dropped', !!env.configured && env.configured.googleEnv === 'TEST' && j(env.configured.googleKeys) === j(['selector', 'environment']), j(env.configured));

  // 6) Google Pay off: Google's script is never requested and Google Pay is never passed.
  await set('gp=no&env=0');
  const off = await checkout(browser, 'ok');
  check('Google Pay off: Google\'s script is never requested', off.googleRequests === 0 && off.scriptTags === 0, j({ requests: off.googleRequests, tags: off.scriptTags }));
  check('Google Pay off: Collect.js is configured with the card fields and no Google Pay', !!off.configured && off.configured.fields.includes('ccnumber') && !off.configured.fields.includes('googlePay'), j(off.configured));

  await browser.close();
} catch (e) {
  check('test run completed without an error', false, String(e.message).slice(0, 200));
} finally {
  if (server) { try { if (process.platform === 'win32') { spawn('taskkill', ['/PID', String(server.pid), '/T', '/F']); } else { server.kill(); } } catch { /* ignore */ } }
}
const failedCount = results.filter((x) => !x.ok).length;
console.log(`\n${results.length - failedCount} passed, ${failedCount} failed`);
process.exit(failedCount ? 1 : 0);
