// End-to-end check: the native Cart & Checkout Blocks integration is ON by default for NEW installs, stays off for
// stores that already existed, can be switched off, and the compatibility declarations follow it.
//
//  - Fresh install (no saved value): setting resolves to ON, the plugin declares cart_checkout_blocks compatible and HPOS
//    compatible, the setting is visible and ticked on the gateway settings page, and the default Checkout block page
//    carries the plugin's block payment-method data (the native method is registered).
//  - Existing store (settings saved before the default existed, no value for the setting): the one-time migration pins it to
//    OFF, so an update never switches the block checkout over by itself. A fresh install keeps the default (ON).
//  - Switched off: the setting is OFF, cart_checkout_blocks is not declared compatible, the block payment method is not
//    registered; HPOS stays compatible.
//
// A tiny probe plugin (in the blueprint) reports state and runs the migration. No real keys (placeholders), nothing charged.
//
// Run (from the plugin folder, Node 18+):
//   npm i --no-save playwright && npx playwright install chromium
//   node tests/e2e/blocks-default.spec.mjs
// Environment (optional):
//   E2E_BASE_URL  use an already running site instead of starting a WordPress Playground on port 9409
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
  const port = '9409';
  const blueprint = join(pluginDir, 'tests', 'e2e', 'blueprint-blocks-default.json');
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
  const page = await ctx.newPage();
  page.setDefaultTimeout(120000);
  await page.route(/Collect\.js/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB_COLLECT_JS }));
  const probe = async (qs) => { await page.goto(`${base}/?cardz3n_e2e=${qs}`, { waitUntil: 'domcontentloaded' }); return JSON.parse(await page.evaluate(() => document.body.innerText)); };
  const blockData = async () => {
    await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
    const pid = await page.evaluate(() => fetch('/wp-json/wc/store/v1/products').then((r) => r.json()).then((p) => p[0].id));
    await page.goto(`${base}/?add-to-cart=${pid}`, { waitUntil: 'domcontentloaded' });
    await page.goto(base + '/checkout/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(8000);
    return page.evaluate(() => { try { return !!(window.wc && window.wc.wcSettings && window.wc.wcSettings.getSetting('cardz3n_gateway_data')); } catch (e) { return false; } });
  };
  const blockDescription = () => page.evaluate(() => { try { return String(window.wc.wcSettings.getSetting('cardz3n_gateway_data').description || ''); } catch (e) { return ''; } });

  // Fresh install.
  const fresh = await probe('state');
  check('Fresh install: Native Block Checkout resolves to ON', fresh.enabled === true && fresh.saved_value === null, JSON.stringify({ saved: fresh.saved_value }));
  check('Fresh install: cart_checkout_blocks is declared compatible', fresh.blocks.compatible && !fresh.blocks.incompatible, JSON.stringify(fresh.blocks));
  check('Fresh install: HPOS (custom_order_tables) is declared compatible', fresh.hpos.compatible && !fresh.hpos.incompatible, JSON.stringify(fresh.hpos));
  check('Fresh install: the default Checkout block page has the native method registered', (await blockData()) === true);

  // The block checkout is card-only, so its description must not promise ACH or wallets (the page is still loaded from the check above).
  const desc = await blockDescription();
  check('Block checkout description is card-only (no ACH, Apple Pay or Google Pay promised)', desc.length > 0 && !/ACH|Apple|Google/i.test(desc), desc.slice(0, 80));

  // The setting stays visible, and is ticked by default.
  await page.goto(base + '/wp-login.php', { waitUntil: 'domcontentloaded' });
  if (await page.locator('#user_login').count()) {
    await page.fill('#user_login', 'admin'); await page.fill('#user_pass', 'password');
    await Promise.all([page.waitForURL(/wp-admin/), page.click('#wp-submit')]);
  }
  await page.goto(base + '/wp-admin/admin.php?page=wc-settings&tab=checkout&section=cardz3n_gateway', { waitUntil: 'domcontentloaded' });
  const box = page.locator('#woocommerce_cardz3n_gateway_enable_experimental_blocks_checkout');
  check('The Native Block Checkout setting is visible and ticked by default', (await box.count()) === 1 && (await box.isChecked()));

  // Existing store and fresh-install migration.
  const existing = await probe('migrate_existing');
  check('Existing store (saved settings, no value): the migration pins the setting to OFF', existing.saved_value === 'no' && existing.enabled === false && existing.flag === true, JSON.stringify(existing));
  const fresh2 = await probe('migrate_fresh');
  check('Fresh install: the migration leaves the default (ON) and records that it ran', fresh2.saved_value === null && fresh2.enabled === true && fresh2.flag === true, JSON.stringify(fresh2));

  // Switched off.
  await probe('switch_off');
  const off = await probe('state');
  check('Switched off: the setting is OFF', off.enabled === false && off.saved_value === 'no');
  check('Switched off: cart_checkout_blocks is not declared compatible', !off.blocks.compatible, JSON.stringify(off.blocks));
  check('Switched off: HPOS stays compatible', off.hpos.compatible && !off.hpos.incompatible);
  check('Switched off: the native method is not registered on the block checkout', (await blockData()) === false);

  await browser.close();
} catch (e) {
  check('test run completed without an error', false, String(e.message).slice(0, 200));
} finally {
  if (server) { try { if (process.platform === 'win32') { spawn('taskkill', ['/PID', String(server.pid), '/T', '/F']); } else { server.kill(); } } catch { /* ignore */ } }
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
