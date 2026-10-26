// End-to-end (local stand-in) check of two safety guards against charging a customer twice:
//  1) a recurring sale whose gateway returns no saved card is voided; if the VOID FAILS the order is held (on-hold), noted with the
//     transaction ID, the shopper is told to contact the store (not "not charged"), and no second sale can go through the same order;
//  2) a pre-order release writes its guard BEFORE the charge, clears it only on a definite decline, and keeps it on a timeout or on
//     an error thrown after a successful charge.
//
// WooCommerce Subscriptions and Pre-Orders are replaced by small stand-ins inside a probe plugin (in the blueprint). The gateway's HTTP
// is short-circuited and every request is recorded (never any secret). The real plugins are not tested here.
//
// Run (from the plugin folder, Node 18+):
//   npm i --no-save playwright && npx playwright install chromium
//   node tests/e2e/recurring-guards.spec.mjs
// Environment (optional):
//   E2E_BASE_URL  use an already running site instead of starting a WordPress Playground on port 9419
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
  const port = '9419';
  const blueprint = join(pluginDir, 'tests', 'e2e', 'blueprint-recurring-guards.json');
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
const j = (x) => JSON.stringify(x);
const types = (x) => (x || []).map((q) => q.type);
const paid = (s) => ['processing', 'completed'].includes(s);

try {
  if (!base) base = await startPlayground();
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext()).newPage();
  page.setDefaultTimeout(300000);
  await page.goto(`${base}/?cardz3n_e2e=suite`, { waitUntil: 'domcontentloaded', timeout: 300000 });
  const text = await page.evaluate(() => document.body.innerText);
  let r;
  try { r = JSON.parse(text); } catch (e) { check('the scenario suite ran', false, text.slice(0, 200)); throw e; }

  // M1: the void fails
  const vf = r.void_fails;
  check('Void fails: the sale and the void were both attempted', j(vf.first_types) === j(['sale', 'void']), j(vf.first_types));
  check('Void fails: the order is held on-hold (not pending, not failed) and the checkout returns a failure', vf.result === 'failure' && vf.status === 'on-hold' && vf.paid === false, j({ r: vf.result, s: vf.status }));
  check('Void fails: an order note names the transaction ID and says the customer was charged', vf.notes.some((n) => /TX-1\b/.test(n) && /charged/i.test(n) && /void/i.test(n)) && vf.txn === 'TX-1', j(vf.notes));
  check('Void fails: the shopper is told to contact the store, never "not charged"', /contact the store/i.test(vf.message) && !/not charged/i.test(vf.message), vf.message);
  check('Void fails: a second attempt on the same order sends no request and fails', vf.second_result === 'failure' && (vf.second_requests || []).length === 0, j(vf.second_requests));

  // M1: the void works (unchanged)
  const vo = r.void_ok;
  check('Void works: unchanged, "not charged" message, voided note, order not held', vo.result === 'failure' && /not charged/i.test(vo.message) && vo.status !== 'on-hold' && vo.notes.some((n) => /payment was voided/i.test(n)), j({ s: vo.status, m: vo.message }));

  // M2: timeout
  const to = r.release_timeout;
  check('Release, gateway timeout: one sale was sent', j(to.first_types) === j(['sale']), j(to.first_types));
  check('Release, gateway timeout: the guard is NOT cleared (a pending placeholder stays), the order is not failed', /^pending:\d+$/.test(to.guard) && to.status !== 'failed', j({ g: to.guard, s: to.status }));
  check('Release, gateway timeout: the order is noted "result unknown, check the gateway"', to.notes.some((n) => /unknown/i.test(n) && /check the gateway/i.test(n)), j(to.notes));
  check('Release, gateway timeout: a second release sends no second sale', (to.second_requests || []).length === 0, j(to.second_requests));

  // M2: decline then retry
  const dr = r.release_decline_retry;
  check('Release, decline: one sale, the order fails and the guard is cleared', j(dr.first_types) === j(['sale']) && dr.status === 'failed' && dr.guard === '', j({ s: dr.status, g: dr.guard }));
  check('Release, decline then retry: the retry charges once, the order is paid and the guard holds the transaction ID', j(dr.retry_types) === j(['sale']) && dr.retry_paid === true && /^TX-/.test(dr.retry_guard), j({ t: dr.retry_types, g: dr.retry_guard }));

  // M2: exception after a successful charge
  const th = r.release_throw_after_charge;
  check('Release, error thrown after a successful charge: one sale, the guard holds the real transaction ID', j(th.first_types) === j(['sale']) && /^TX-/.test(th.guard), j({ t: th.first_types, g: th.guard }));
  check('Release, error thrown after a successful charge: the order is not set to failed and the error is noted', th.status !== 'failed' && th.notes.some((n) => /stopped by an error/i.test(n)), j({ s: th.status, n: th.notes }));
  check('Release, error thrown after a successful charge: a second release sends no second sale', (th.second_requests || []).length === 0, j(th.second_requests));

  // M2: stale pending
  const sp = r.release_stale_pending;
  check('Release with an old pending guard: nothing is charged and the merchant gets a note', (sp.requests || []).length === 0 && sp.notes.some((n) => /unknown result/i.test(n)), j(sp.notes));

  // normal release
  const nr = r.release_normal;
  check('Normal release: charged once, order paid, the guard holds the real transaction ID', j(types(nr.requests)) === j(['sale']) && paid(nr.status) && nr.paid === true && nr.guard === nr.txn && /^TX-/.test(nr.guard), j({ g: nr.guard, t: nr.txn }));

  await browser.close();
} catch (e) {
  check('test run completed without an error', false, String(e.message).slice(0, 200));
} finally {
  if (server) { try { if (process.platform === 'win32') { spawn('taskkill', ['/PID', String(server.pid), '/T', '/F']); } else { server.kill(); } } catch { /* ignore */ } }
}
const failed = results.filter((x) => !x.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
