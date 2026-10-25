// End-to-end check: the "Native Block Checkout" default for new installs resolves to OFF when WooCommerce Subscriptions or
// Pre-Orders is active, because the native block method cannot take subscription or pre-order carts yet.
//
//  - No Subscriptions or Pre-Orders: a new install resolves to ON and cart_checkout_blocks is declared compatible.
//  - Subscriptions (or Pre-Orders) active, nothing saved: resolves to OFF, cart_checkout_blocks is not declared compatible,
//    the setting is still visible (and unticked), and the warning on the settings page is still shown.
//  - A merchant who saves "on" explicitly keeps it on, even with those plugins (their choice wins).
//  - An existing store (saved settings, no value for the setting) is still pinned to OFF by the one-time migration.
//
// The paid plugins are stubbed with empty classes (WC_Subscriptions, WC_Pre_Orders) inside a tiny probe plugin. No real keys
// (placeholders), nothing is charged.
//
// Run (from the plugin folder, Node 18+):
//   npm i --no-save playwright && npx playwright install chromium
//   node tests/e2e/blocks-default-subscriptions.spec.mjs
// Environment (optional):
//   E2E_BASE_URL  use an already running site instead of starting a WordPress Playground on port 9412
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
  const port = '9412';
  const blueprint = join(pluginDir, 'tests', 'e2e', 'blueprint-blocks-default-subs.json');
  server = spawn('npx', ['--yes', '@wp-playground/cli@latest', 'start', '--blueprint', blueprint, '--mount', './:/wordpress/wp-content/plugins/cardz3n-gateway', '--no-auto-mount', '--skip-browser', '--reset', '--port', port, '--php', '8.2'], { cwd: pluginDir, shell: true });
  await new Promise((ok, fail) => {
    const t = setTimeout(() => fail(new Error('Playground did not become ready in 6 minutes')), 360000);
    const onData = (d) => { if (/Ready! WordPress is running/.test(String(d))) { clearTimeout(t); ok(); } };
    server.stdout.on('data', onData); server.stderr.on('data', onData);
    server.on('exit', () => fail(new Error('Playground exited early')));
  });
  return `http://127.0.0.1:${port}`;
}

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`); };

try {
  if (!base) base = await startPlayground();
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(120000);
  const probe = async (qs) => { await page.goto(`${base}/?cardz3n_e2e=${qs}`, { waitUntil: 'domcontentloaded' }); return JSON.parse(await page.evaluate(() => document.body.innerText)); };

  await page.goto(base + '/wp-login.php', { waitUntil: 'domcontentloaded' });
  if (await page.locator('#user_login').count()) {
    await page.fill('#user_login', 'admin'); await page.fill('#user_pass', 'password');
    await Promise.all([page.waitForURL(/wp-admin/, { timeout: 90000 }).catch(() => {}), page.click('#wp-submit')]);
  }
  const gateway = `${base}/wp-admin/admin.php?page=wc-settings&tab=checkout&section=cardz3n_gateway`;

  // No Subscriptions or Pre-Orders: a new install is ON.
  await probe('migrate_fresh');
  const plain = await probe('state');
  check('No Subscriptions or Pre-Orders, new install: ON and cart_checkout_blocks declared compatible', plain.enabled === true && plain.saved_value === null && plain.blocks.compatible === true, JSON.stringify({ enabled: plain.enabled, blocks: plain.blocks }));

  // Subscriptions active, nothing saved: OFF.
  await probe('subs_on');
  await probe('migrate_fresh');
  const subs = await probe('state');
  check('Subscriptions active, new install: resolves to OFF', subs.enabled === false && subs.saved_value === null, JSON.stringify({ enabled: subs.enabled, saved: subs.saved_value }));
  check('Subscriptions active, new install: cart_checkout_blocks is not declared compatible', subs.blocks.compatible === false, JSON.stringify(subs.blocks));
  await page.goto(gateway, { waitUntil: 'domcontentloaded' });
  const box = page.locator('#woocommerce_cardz3n_gateway_enable_experimental_blocks_checkout');
  check('The setting is still visible, and unticked by default', (await box.count()) === 1 && (await box.isChecked()) === false);
  check('The warning about subscription carts is still shown', /cannot be paid with this gateway yet/.test(await page.evaluate(() => document.body.innerText)));

  // Pre-Orders alone behaves the same.
  await probe('subs_off'); await probe('pre_on'); await probe('migrate_fresh');
  const pre = await probe('state');
  check('Pre-Orders active, new install: resolves to OFF', pre.enabled === false && pre.saved_value === null, JSON.stringify({ enabled: pre.enabled }));

  // The merchant's explicit choice wins.
  await probe('switch_on');
  const chosen = await probe('state');
  check('A merchant who saves "on" keeps it on, even with Pre-Orders active', chosen.enabled === true && chosen.saved_value === 'yes');

  // An existing store is still pinned off by the one-time migration; back to no plugins, a new install is ON again.
  await probe('pre_off');
  const existing = await probe('migrate_existing');
  check('Existing store (saved settings, no value): still pinned to OFF', existing.saved_value === 'no' && existing.enabled === false, JSON.stringify(existing));
  await probe('migrate_fresh');
  const back = await probe('state');
  check('Plugins gone, new install: ON again', back.enabled === true && back.saved_value === null);

  await browser.close();
} catch (e) {
  check('test run completed without an error', false, String(e.message).slice(0, 200));
} finally {
  if (server) { try { if (process.platform === 'win32') { spawn('taskkill', ['/PID', String(server.pid), '/T', '/F']); } else { server.kill(); } } catch { /* ignore */ } }
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
