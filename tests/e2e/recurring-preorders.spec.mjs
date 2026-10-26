// End-to-end (local stand-in) check: a pre-order charged on release saves the card at checkout and is charged from it on release.
//
// WooCommerce Pre-Orders is replaced by a small stand-in inside a probe plugin (in the blueprint): the class and methods the gateway
// calls (WC_Pre_Orders_Order::order_requires_payment_tokenization and order_contains_pre_order) and the release action
// wc_pre_orders_process_pre_order_completion_payment_<gateway id>. The gateway's HTTP is short-circuited and every request is recorded
// (never any secret), so this proves WHAT THE GATEWAY WOULD BE ASKED TO DO. The real plugin is tested separately on the demo store.
//
// ASSUMPTIONS about Pre-Orders: a pre-order charged upon release is bought with a $0.00 total (or at least must not be charged at
// checkout), waits in a status that is not a paid status, and at release the full total is restored before the action fires.
// Card-on-file field values are ASSUMPTIONS from the gateway's published API (see includes/class-cardz3n-recurring.php, A4 to A8).
//
// Run (from the plugin folder, Node 18+):
//   npm i --no-save playwright && npx playwright install chromium
//   node tests/e2e/recurring-preorders.spec.mjs
// Environment (optional):
//   E2E_BASE_URL  use an already running site instead of starting a WordPress Playground on port 9416
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
  const port = '9416';
  const blueprint = join(pluginDir, 'tests', 'e2e', 'blueprint-recurring-preorders.json');
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
const types = (x) => j((x.requests || []).map((q) => q.type));

try {
  if (!base) base = await startPlayground();
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext()).newPage();
  page.setDefaultTimeout(300000);
  await page.goto(`${base}/?cardz3n_e2e=suite`, { waitUntil: 'domcontentloaded', timeout: 300000 });
  const text = await page.evaluate(() => document.body.innerText);
  let r;
  try { r = JSON.parse(text); } catch (e) { check('the scenario suite ran', false, text.slice(0, 200)); throw e; }

  // 1) purchase with a $0.00 total
  const pz = r.purchase_zero; const zq = (pz.requests || [])[0] || {};
  check('Pre-order bought with $0.00: exactly one request, a card verification (not a sale)', (pz.requests || []).length === 1 && zq.type === 'validate', types(pz));
  check('Pre-order bought with $0.00: verification for 0.00 that saves the card, customer-initiated stored-credential fields', zq.amount === '0.00' && zq.customer_vault === 'add_customer' && zq.initiated_by === 'customer' && zq.stored_credential_indicator === 'stored', j(zq));
  check('Pre-order bought with $0.00: the card is stored on the order and the order is not marked paid', pz.result === 'success' && /^V-/.test(pz.order.vault) && /^TX-/.test(pz.order.initial) && pz.paid === false, j(pz.order));

  // 2) purchase with the full total shown (charge on release)
  const pf = r.purchase_full_total;
  check('Pre-order charged on release with the full total shown: nothing is charged at checkout (one card verification, no sale)', types(pf) === j(['validate']) && pf.requests[0].amount === '0.00', types(pf));
  check('Pre-order with the full total shown: the card is stored on the order', pf.result === 'success' && /^V-/.test(pf.order.vault) && pf.paid === false, j(pf.order));

  // 3) release
  const rl = r.release; const q = (rl.requests || [])[0] || {};
  check('Release: exactly one request, a sale from the saved card (no card data, no token)', (rl.requests || []).length === 1 && q.type === 'sale' && /^V-/.test(q.customer_vault_id || '') && q.has_token === false, j(q));
  check('Release: the full restored amount and the order currency are sent', q.amount === '20.00' && q.currency === 'USD', j(q));
  check('Release: merchant-initiated stored-credential fields and the first transaction ID', q.initiated_by === 'merchant' && q.stored_credential_indicator === 'used' && q.initial_transaction_id === rl.order.initial && q.billing_method === 'recurring', j(q));
  check('Release: billing details are sent', q.first_name === 'Pat' && q.last_name === 'Preorder' && q.email === 'e2e@example.test' && q.zip === '89101', j(q));
  check('Release: the order is paid with the transaction ID and noted', ['processing', 'completed'].includes(rl.status) && rl.paid === true && /^TX-/.test(rl.txn), j({ status: rl.status, txn: rl.txn }));

  // 4) twice
  const tw = r.release_twice;
  check('Release fired twice: the card is charged once', (tw.requests || []).length === 1 && tw.requests[0].type === 'sale' && ['processing', 'completed'].includes(tw.status), types(tw));

  // 5) no saved card
  const nc = r.release_no_card;
  check('Release with no saved card: the order fails with a clear note and nothing is sent', nc.status === 'failed' && (nc.requests || []).length === 0 && nc.notes.some((n) => /no saved payment method was found/i.test(n)), j(nc.notes));

  // 6) declined
  const dc = r.release_declined;
  check('Release with a declined card: the order fails with a decline note, one request only', dc.status === 'failed' && (dc.requests || []).length === 1 && dc.notes.length > 0, j({ s: dc.status, n: dc.notes }));

  // 7) customer's saved card
  const cc = r.release_customer_card; const cq = (cc.requests || [])[0] || {};
  check('Release for an order without its own card: the customer\'s saved card is used, with its first transaction ID', /^V-/.test(cq.customer_vault_id || '') && /^TX-/.test(cq.initial_transaction_id || '') && (cc.requests || []).length === 1 && ['processing', 'completed'].includes(cc.status), j(cq));

  // 8) already paid
  check('Release of an order that is already paid: nothing is charged', (r.release_already_paid.requests || []).length === 0 && ['processing', 'completed'].includes(r.release_already_paid.status), types(r.release_already_paid));

  // 9) normal order
  const nq = (r.normal_order.requests || [])[0] || {};
  check('A normal order is untouched: one sale, no forced card save, no stored-credential fields', r.normal_order.result === 'success' && (r.normal_order.requests || []).length === 1 && nq.type === 'sale' && !nq.customer_vault && !nq.initiated_by && !nq.stored_credential_indicator, j(nq));

  await browser.close();
} catch (e) {
  check('test run completed without an error', false, String(e.message).slice(0, 200));
} finally {
  if (server) { try { if (process.platform === 'win32') { spawn('taskkill', ['/PID', String(server.pid), '/T', '/F']); } else { server.kill(); } } catch { /* ignore */ } }
}
const failed = results.filter((x) => !x.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
