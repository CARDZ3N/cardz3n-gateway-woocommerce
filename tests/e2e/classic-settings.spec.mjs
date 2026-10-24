// End-to-end check: on the CLASSIC (shortcode) checkout, the page's JS settings (window.CARDZ3N_GW) must show
// ACH, Apple Pay, Google Pay and saved methods as ON when they are enabled in the gateway settings, even with the
// opt-in "Native Block Checkout" setting also on. The Checkout BLOCK page must keep its card-only settings.
//
// Why: the Blocks registration used to print a second `var CARDZ3N_GW` on the classic page that switched all four off.
//
// No keys, nothing is charged: Collect.js is replaced by a stub and the settings use placeholder values.
//
// Run (from the plugin folder, Node 18+):
//   npm i --no-save playwright && npx playwright install chromium
//   node tests/e2e/classic-settings.spec.mjs
// Environment (optional):
//   E2E_BASE_URL  use an already running site instead of starting a WordPress Playground on port 9402
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
  const port = '9402';
  const blueprint = join(pluginDir, 'tests', 'e2e', 'blueprint-classic-settings.json');
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

async function settingsOn(browser, path) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage(); page.setDefaultTimeout(120000);
  await page.route(/Collect\.js/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB_COLLECT_JS }));
  await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
  const pid = await page.evaluate(() => fetch('/wp-json/wc/store/v1/products').then((r) => r.json()).then((p) => p[0].id));
  await page.goto(`${base}/?add-to-cart=${pid}`, { waitUntil: 'domcontentloaded' });
  await page.goto(base + path, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.CARDZ3N_GW, null, { timeout: 60000 });
  const s = await page.evaluate(() => { const c = window.CARDZ3N_GW; return { cards: !!c.enableCards, ach: !!c.enableAch, apple: !!c.enableApplePay, google: !!c.enableGooglePay, saved: !!c.enableSaved }; });
  await ctx.close();
  return s;
}

try {
  if (!base) base = await startPlayground();
  const browser = await chromium.launch({ headless: true });

  const classic = await settingsOn(browser, '/checkout-classic/');
  check('classic checkout: cards on', classic.cards);
  check('classic checkout: ACH on', classic.ach);
  check('classic checkout: Apple Pay on', classic.apple);
  check('classic checkout: Google Pay on', classic.google);
  check('classic checkout: saved methods on', classic.saved);

  // The default WooCommerce Checkout page is a Checkout block page: it must keep the card-only Blocks settings.
  const blocks = await settingsOn(browser, '/checkout/');
  check('Checkout block page: cards on', blocks.cards);
  check('Checkout block page: ACH, wallets and saved methods stay off', !blocks.ach && !blocks.apple && !blocks.google && !blocks.saved, JSON.stringify(blocks));

  await browser.close();
} catch (e) {
  check('test run completed without an error', false, String(e.message).slice(0, 200));
} finally {
  if (server) { try { if (process.platform === 'win32') { spawn('taskkill', ['/PID', String(server.pid), '/T', '/F']); } else { server.kill(); } } catch { /* ignore */ } }
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
