// End-to-end (local stand-in) check: a renewal that the gateway has already charged is never charged again, whatever fails afterwards.
//
// Why: if the gateway confirms the charge and then something else throws (another plugin's hook, a failed save), the renewal used to be marked "failed";
// WooCommerce Subscriptions then retries the same renewal order and the customer is charged twice. Now the charge is recorded first, an error afterwards never
// marks the order failed, and a retry only completes the order. Same stand-in as recurring-failed-renewals.spec.mjs (fake Subscriptions API, recorded and
// stubbed gateway HTTP; the real plugin is tested on the demo store).
//
// Run (from the plugin folder, Node 18+):
//   npm i --no-save playwright && npx playwright install chromium
//   node tests/e2e/recurring-renewal-guard.spec.mjs
// Environment (optional): E2E_BASE_URL, PLUGIN_DIR, PW_DIR as in the other e2e specs (Playground port 9420).
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const require = createRequire(process.env.PW_DIR ? join(process.env.PW_DIR, 'package.json') : join(process.cwd(), 'package.json'));
const { chromium } = require('playwright');

const pluginDir = resolve(process.env.PLUGIN_DIR || process.cwd());
let base = process.env.E2E_BASE_URL;
let server = null;

async function startPlayground() {
  const port = '9420';
  const blueprint = join(pluginDir, 'tests', 'e2e', 'blueprint-recurring-renewal-guard.json');
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
  const page = await (await browser.newContext()).newPage();
  page.setDefaultTimeout(300000);
  await page.goto(`${base}/?cardz3n_e2e=suite`, { waitUntil: 'domcontentloaded', timeout: 300000 });
  const text = await page.evaluate(() => document.body.innerText);
  let r;
  try { r = JSON.parse(text); } catch (e) { check('the scenario suite ran', false, text.slice(0, 200)); throw e; }

  const a = r.charged_then_error;
  check('Charged, then another plugin throws: the renewal is NOT marked failed', a.first.status !== 'failed', j(a.first));
  check('...the charge is recorded on the order (transaction ID)', /^TX-/.test(a.marker), a.marker);
  check('...the note says the renewal was charged and will not be charged again', a.notes_after_first.some((n) => /was charged \(transaction TX-\d+\).*not be charged again/.test(n)), j(a.notes_after_first.slice(0, 3)));
  check('...the error text is not copied into the order note (it stays in the log)', !a.notes_after_first.some((n) => /boom-after-charge-secret/.test(n)));
  check('Subscriptions retries the same renewal: still only ONE sale was sent', a.sales_after_first === 1 && a.sales_after_retry === 1, j({ first: a.sales_after_first, retry: a.sales_after_retry }));
  check('...and the retry completes the order (paid)', ['processing', 'completed'].includes(a.after_retry.status) && a.after_retry.paid === true, j(a.after_retry));

  const b = r.error_before_charge;
  check('An error before any charge still fails the renewal (so Subscriptions can retry)', b.state.status === 'failed' && b.marker === '', j({ state: b.state, marker: b.marker }));
  check('...and its note does not repeat the error text', !b.notes.some((n) => /boom-before-charge-secret/.test(n)) && b.notes.some((n) => /unexpected error/i.test(n)), j(b.notes.slice(0, 3)));

  const c = r.normal_then_repeat;
  check('Normal renewal: paid, charge recorded, a repeat of the hook sends nothing more', ['processing', 'completed'].includes(c.first.status) && /^TX-/.test(c.marker) && c.requests.filter((x) => x.type === 'sale').length === 1, j({ first: c.first, marker: c.marker, sales: c.requests.filter((x) => x.type === 'sale').length }));

  await browser.close();
} catch (e) {
  check('test run completed without an error', false, String(e.message).slice(0, 200));
} finally {
  if (server) { try { if (process.platform === 'win32') { spawn('taskkill', ['/PID', String(server.pid), '/T', '/F']); } else { server.kill(); } } catch { /* ignore */ } }
}
const failed = results.filter((x) => !x.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
