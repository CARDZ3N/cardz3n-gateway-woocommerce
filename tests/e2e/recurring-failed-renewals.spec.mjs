// End-to-end (local stand-in) check: failed renewals, retries, and refunds on renewal orders.
//
// Same stand-in as recurring-save-and-renew.spec.mjs (a fake WooCommerce Subscriptions API plus recorded, stubbed gateway HTTP; the real plugin is
// tested on the demo store). Subscriptions itself decides WHEN to retry a failed renewal (it calls the gateway's renewal hook again for the same renewal
// order); this checks that the gateway behaves correctly each time: a failure leaves the order failed with a clear note, a retry is charged again, an
// unreachable gateway or an unexpected error fails the renewal cleanly, and refunds on a renewal order work (void first, refund when the void is refused).
//
// Run (from the plugin folder, Node 18+):
//   npm i --no-save playwright && npx playwright install chromium
//   node tests/e2e/recurring-failed-renewals.spec.mjs
// Environment (optional): E2E_BASE_URL, PLUGIN_DIR, PW_DIR as in the other e2e specs (Playground port 9418).
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const require = createRequire(process.env.PW_DIR ? join(process.env.PW_DIR, 'package.json') : join(process.cwd(), 'package.json'));
const { chromium } = require('playwright');

const pluginDir = resolve(process.env.PLUGIN_DIR || process.cwd());
let base = process.env.E2E_BASE_URL;
let server = null;

async function startPlayground() {
  const port = '9418';
  const blueprint = join(pluginDir, 'tests', 'e2e', 'blueprint-recurring-failed-renewals.json');
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
const paid = (s) => ['processing', 'completed'].includes(s.status) && s.paid === true;

try {
  if (!base) base = await startPlayground();
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext()).newPage();
  page.setDefaultTimeout(300000);
  await page.goto(`${base}/?cardz3n_e2e=suite`, { waitUntil: 'domcontentloaded', timeout: 300000 });
  const text = await page.evaluate(() => document.body.innerText);
  let r;
  try { r = JSON.parse(text); } catch (e) { check('the scenario suite ran', false, text.slice(0, 200)); throw e; }

  // 1) decline, then retry
  const dr = r.decline_then_retry;
  check('A declined renewal leaves the renewal order failed', dr.after_decline.status === 'failed' && dr.after_decline.paid === false, j(dr.after_decline));
  check('The retry of the same renewal order is charged again and succeeds', dr.attempts === 2 && paid(dr.after_retry), j({ attempts: dr.attempts, after_retry: dr.after_retry }));
  check('The decline is kept in the order notes', dr.notes.some((n) => /declined/i.test(n)), j(dr.notes.slice(0, 3)));

  // 2) gateway unreachable
  const te = r.transport_error;
  check('Gateway unreachable: the renewal fails cleanly with a note (no fatal error)', te.status === 'failed' && te.notes.some((n) => /cURL error 28/.test(n)), j(te.notes.slice(0, 3)));
  check('Gateway unreachable: a later retry succeeds', paid(te.after_retry), j(te.after_retry));

  // 2b) unexpected error
  const ue = r.unexpected_error;
  check('An unexpected error inside a renewal fails that renewal cleanly (plain note without the error text, status failed, nothing thrown to the scheduler)', ue.threw === false && ue.status === 'failed' && ue.notes.some((n) => /unexpected error/i.test(n)) && !ue.notes.some((n) => /boom-from-test/.test(n)), j({ threw: ue.threw, status: ue.status }));

  // 3) the gateway no longer knows the saved card
  const iv = r.invalid_vault;
  check('Saved card unknown to the gateway: the renewal fails and the note tells the customer to change the payment method', iv.status === 'failed' && iv.notes.some((n) => /Change payment method/.test(n)), j(iv.notes.slice(0, 4)));

  // 4) refunds on a renewal order
  const rf = r.refund_full_void;
  check('Refund of the full renewal voids the transaction first', rf.result === 'ok' && rf.requests.length === 1 && rf.requests[0].type === 'void' && rf.requests[0].transactionid === rf.txn, j(rf.requests));
  const rs = r.refund_settled_falls_back;
  check('If the void is refused (already settled) the full refund falls back to a refund', rs.result === 'ok' && j(rs.requests.map((x) => x.type)) === j(['void', 'refund']) && rs.requests[1].amount === '5.00', j(rs.requests.map((x) => x.type)));
  const rp = r.refund_partial;
  check('A partial refund of a renewal is a refund of that amount (no void)', rp.result === 'ok' && rp.requests.length === 1 && rp.requests[0].type === 'refund' && rp.requests[0].amount === '1.25', j(rp.requests));
  check("A refund on a renewal never touches the subscription's saved card", r.refund_keeps_saved_card.subscription.vault === 'V-OLD', j(r.refund_keeps_saved_card.subscription));

  await browser.close();
} catch (e) {
  check('test run completed without an error', false, String(e.message).slice(0, 200));
} finally {
  if (server) { try { if (process.platform === 'win32') { spawn('taskkill', ['/PID', String(server.pid), '/T', '/F']); } else { server.kill(); } } catch { /* ignore */ } }
}
const failed = results.filter((x) => !x.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
