// End-to-end check: with Debug Mode ON, the plugin's log never contains payment tokens, vault IDs or customer details.
//
// Why: the debug log used to record the full one-time payment token, the vault ID and the customer's name, email, phone and
// address. It now logs a whitelist of non-sensitive fields only, and redacts customer/token-shaped keys on every other log call.
//
// A tiny probe plugin (in the blueprint) sends a gateway request carrying sentinel values (SENTINEL-TOKEN-ABC, SENTINEL-VAULT-123,
// a name, email, phone and address), has the stubbed gateway answer with a vault ID and customer details, makes a free-form log
// call, and returns the contents of the WooCommerce log file. HTTP is short-circuited; no real keys; nothing is charged.
//
// Run (from the plugin folder, Node 18+):
//   npm i --no-save playwright && npx playwright install chromium
//   node tests/e2e/debug-log.spec.mjs
// Environment (optional):
//   E2E_BASE_URL  use an already running site instead of starting a WordPress Playground on port 9406
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
  const port = '9406';
  const blueprint = join(pluginDir, 'tests', 'e2e', 'blueprint-debug-log.json');
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
  const page = await (await browser.newContext()).newPage();
  page.setDefaultTimeout(120000);
  await page.goto(base + '/?cardz3n_e2e_probe=1', { waitUntil: 'domcontentloaded' });
  const { log, length } = JSON.parse(await page.evaluate(() => document.body.innerText));

  check('the debug log was written', length > 0 && /transact\.php POST/.test(log), `bytes=${length}`);
  check('the log keeps the useful fields (type, amount, order ID, result, transaction ID)', /"amount":"12\.34"/.test(log) && /"orderid":"7777"/.test(log) && /"responsetext":"SUCCESS"/.test(log) && /TXN-777/.test(log));
  for (const [label, needle] of [
    ['payment token', 'SENTINEL-TOKEN-ABC'],
    ['vault ID', 'SENTINEL-VAULT-123'],
    ['first name', 'SentinelFirst'],
    ['last name', 'SentinelLast'],
    ['email', 'sentinel@example.test'],
    ['email (url-encoded, from the response)', 'sentinel%40example.test'],
    ['phone', '+1-555-0100'],
    ['street address', '99 Sentinel Road'],
    ['city', 'Sentinelville'],
    ['postcode', '99999'],
  ]) {
    check(`the log does not contain the ${label}`, !log.includes(needle));
  }
  check('the free-form log call redacted token, vault, email, phone and address keys', /probe context/.test(log) && !/SENTINEL/.test(log.split('probe context')[1] || ''));

  await browser.close();
} catch (e) {
  check('test run completed without an error', false, String(e.message).slice(0, 200));
} finally {
  if (server) { try { if (process.platform === 'win32') { spawn('taskkill', ['/PID', String(server.pid), '/T', '/F']); } else { server.kill(); } } catch { /* ignore */ } }
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
