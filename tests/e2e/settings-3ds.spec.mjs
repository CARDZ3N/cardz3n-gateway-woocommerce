// End-to-end check: the "3D Secure 2.0" setting no longer claims to authenticate transactions, and a saved value is not lost.
//
// Why: no code reads that setting and no payment is authenticated, yet the settings page offered a checkbox that said it
// "authenticates transactions". It is now a plain notice (no input). A value saved by an earlier version stays in the stored
// settings untouched, also after the merchant saves the settings page (a removed checkbox must not turn the stored value off).
//
// Run (from the plugin folder, Node 18+):
//   npm i --no-save playwright && npx playwright install chromium
//   node tests/e2e/settings-3ds.spec.mjs
// Environment (optional): E2E_BASE_URL, PLUGIN_DIR, PW_DIR as in the other e2e specs (Playground port 9422).
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const require = createRequire(process.env.PW_DIR ? join(process.env.PW_DIR, 'package.json') : join(process.cwd(), 'package.json'));
const { chromium } = require('playwright');

const pluginDir = resolve(process.env.PLUGIN_DIR || process.cwd());
let base = process.env.E2E_BASE_URL;
let server = null;

async function startPlayground() {
  const port = '9422';
  const blueprint = join(pluginDir, 'tests', 'e2e', 'blueprint-settings-3ds.json');
  server = spawn('npx', ['--yes', '@wp-playground/cli@latest', 'start', '--blueprint', blueprint, '--mount', './:/wordpress/wp-content/plugins/cardz3n-gateway', '--no-auto-mount', '--skip-browser', '--reset', '--port', port, '--php', '8.2'], { cwd: pluginDir, shell: true });
  await new Promise((ok, fail) => {
    const t = setTimeout(() => fail(new Error('Playground did not become ready in 15 minutes')), 900000);
    const onData = (d) => { if (/Ready! WordPress is running/.test(String(d))) { clearTimeout(t); ok(); } };
    server.stdout.on('data', onData); server.stderr.on('data', onData);
    server.on('exit', () => fail(new Error('Playground exited early')));
  });
  return `http://127.0.0.1:${port}`;
}

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`); };
const j = (x) => JSON.stringify(x);

try {
  if (!base) base = await startPlayground();
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
  page.setDefaultTimeout(300000);
  await page.goto(base + '/wp-login.php', { waitUntil: 'domcontentloaded', timeout: 300000 });
  if (await page.locator('#user_login').count()) {
    await page.fill('#user_login', 'admin'); await page.fill('#user_pass', 'password');
    await Promise.all([page.waitForURL(/wp-admin/, { timeout: 90000 }).catch(() => {}), page.click('#wp-submit')]);
  }
  const stored = async () => { await page.goto(`${base}/?cardz3n_e2e=opt`, { waitUntil: 'domcontentloaded' }); return JSON.parse(await page.evaluate(() => document.body.innerText)); };
  const gateway = `${base}/wp-admin/admin.php?page=wc-settings&tab=checkout&section=cardz3n_gateway`;

  const before = await stored();
  check('Set-up: an earlier version had saved 3D Secure as "yes"', before.has_3ds_key === true && before.enable_3ds === 'yes', j(before));

  await page.goto(gateway, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('form#mainform');
  const view = await page.evaluate(() => ({
    inputs: document.querySelectorAll('[name*="enable_3ds"]').length,
    text: document.body.innerText
  }));
  check('The settings page has no 3D Secure checkbox or input', view.inputs === 0, 'inputs: ' + view.inputs);
  check('It says plainly that 3D Secure is not available yet', /3D Secure 2\.0 \(not available yet\)/i.test(view.text) && /does not perform 3D Secure authentication yet/i.test(view.text));
  check('It no longer claims to authenticate transactions', !/authenticating transactions before submitting/i.test(view.text) && !/Enable 3D Secure 2\.0/i.test(view.text));

  // Saving the page must keep the stored value and the other settings.
  await page.locator('button.woocommerce-save-button').evaluate((b) => b.removeAttribute('disabled')); // WooCommerce keeps Save disabled until something is changed
  await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }), page.locator('button.woocommerce-save-button').click({ timeout: 60000 })]);
  await page.waitForTimeout(3000);
  const after = await stored();
  check('After saving the page: the stored 3D Secure value is still there, unchanged', after.has_3ds_key === true && after.enable_3ds === 'yes', j(after));
  check('After saving the page: other settings are intact', after.test_mode === 'yes' && after.enable_apple_pay === 'yes', j(after));

  await browser.close();
} catch (e) {
  check('test run completed without an error', false, String(e.message).slice(0, 200));
} finally {
  if (server) { try { if (process.platform === 'win32') { spawn('taskkill', ['/PID', String(server.pid), '/T', '/F']); } else { server.kill(); } } catch { /* ignore */ } }
}
const failed = results.filter((x) => !x.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
