// End-to-end check for the "subscriptions are not yet supported" labelling and warning.
//
// Until renewal and pre-order release payments are verified with this gateway:
//  - the Subscriptions and Pre-Orders switches are labelled "(not yet supported)" on the gateway settings page;
//  - when WooCommerce Subscriptions (or Pre-Orders) is active AND its switch is on, a red warning is shown on that page;
//  - no warning when the switch is off, or when the plugin is not active (the warning is about a real, live combination);
//  - the checkout payment method no longer shows a "Recurring Payments" badge.
//
// The paid plugins are stubbed with empty classes in a tiny probe plugin (in the blueprint). No real keys (placeholders), nothing charged.
//
// Run (from the plugin folder, Node 18+):
//   npm i --no-save playwright && npx playwright install chromium
//   node tests/e2e/subscription-claims.spec.mjs
// Environment (optional):
//   E2E_BASE_URL  use an already running site instead of starting a WordPress Playground on port 9413
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
  const port = '9413';
  const blueprint = join(pluginDir, 'tests', 'e2e', 'blueprint-subscription-claims.json');
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

try {
  if (!base) base = await startPlayground();
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage(); page.setDefaultTimeout(120000);
  await page.route(/Collect\.js/, (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: STUB_COLLECT_JS }));
  await page.goto(base + '/wp-login.php', { waitUntil: 'domcontentloaded' });
  if (await page.locator('#user_login').count()) {
    await page.fill('#user_login', 'admin'); await page.fill('#user_pass', 'password');
    await Promise.all([page.waitForURL(/wp-admin/, { timeout: 90000 }).catch(() => {}), page.click('#wp-submit')]);
  }
  const probe = async (m) => { await page.goto(`${base}/?cardz3n_e2e=${m}`, { waitUntil: 'domcontentloaded' }); };
  const gateway = `${base}/wp-admin/admin.php?page=wc-settings&tab=checkout&section=cardz3n_gateway`;
  const settingsText = async () => { await page.goto(gateway, { waitUntil: 'domcontentloaded' }); return page.evaluate(() => document.body.innerText); };
  const RED = /have not been verified yet and may fail/;

  // Labels
  let t = await settingsText();
  check('Subscriptions switch is labelled "(not yet supported)"', /Subscriptions Support \(not yet supported\)/.test(t));
  check('Pre-Orders switch is labelled "(not yet supported)"', /Pre-Orders Support \(not yet supported\)/.test(t));
  check('The switches say renewals/release payments are not verified and may fail', /renewal payments with this gateway have not been verified/i.test(t) && /charge when a pre-order is released has not been verified/i.test(t));

  // Warning: needs the plugin active AND the switch on
  check('Nothing active, switches off: no red warning', !RED.test(t));
  await probe('subs_setting_on');
  check('Switch on but WooCommerce Subscriptions not active: no red warning', !RED.test(await settingsText()));
  await probe('subs_on');
  check('Subscriptions active and switch on: the red warning is shown', RED.test(await settingsText()));
  await probe('subs_setting_off');
  check('Subscriptions active but switch off: no red warning', !RED.test(await settingsText()));
  await probe('subs_off'); await probe('pre_on'); await probe('pre_setting_on');
  check('Pre-Orders active and its switch on: the red warning is shown', RED.test(await settingsText()));
  await probe('pre_setting_off'); await probe('pre_off');

  // Checkout: no "Recurring Payments" badge
  await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
  const pid = await page.evaluate(() => fetch('/wp-json/wc/store/v1/products?search=E2E%20Test%20Item').then((r) => r.json()).then((p) => p[0].id));
  await page.goto(`${base}/?add-to-cart=${pid}`, { waitUntil: 'domcontentloaded' });
  await page.goto(base + '/checkout-classic/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('form.checkout'); await page.waitForTimeout(5000);
  const box = await page.locator('.payment_method_cardz3n_gateway, li.wc_payment_method').first().innerText();
  check('Checkout payment method has no "Recurring Payments" badge', !/Recurring Payments/i.test(box) && box.length > 0, box.replace(/\s+/g, ' ').slice(0, 70));

  await browser.close();
} catch (e) {
  check('test run completed without an error', false, String(e.message).slice(0, 200));
} finally {
  if (server) { try { if (process.platform === 'win32') { spawn('taskkill', ['/PID', String(server.pid), '/T', '/F']); } else { server.kill(); } } catch { /* ignore */ } }
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
