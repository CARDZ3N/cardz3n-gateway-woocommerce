// End-to-end (local stand-in) check: "Change payment method" for subscriptions (customer and admin) and My Account > Add payment method.
//
// WooCommerce Subscriptions is replaced by a small stand-in inside a probe plugin (in the blueprint): the same function names the gateway calls
// and subscription objects that know their first order. The gateway's HTTP is short-circuited and every request is recorded (never any secret), so this
// proves WHAT THE GATEWAY WOULD BE ASKED TO DO and which data is stored where. The real plugin is tested separately on the demo store.
//
// ASSUMPTIONS (see includes/class-cardz3n-recurring.php A1 to A8, includes/class-cardz3n-subscriptions-service.php A9 to A11): the $0.00 `validate`
// request with vault, the card-on-file fields, and the Subscriptions hook names and arguments.
//
// Run (from the plugin folder, Node 18+):
//   npm i --no-save playwright && npx playwright install chromium
//   node tests/e2e/recurring-change-method.spec.mjs
// Environment (optional):
//   E2E_BASE_URL  use an already running site instead of starting a WordPress Playground on port 9415
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
  const port = '9415';
  const blueprint = join(pluginDir, 'tests', 'e2e', 'blueprint-recurring-change-method.json');
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
const types = (reqs) => (reqs || []).map((x) => x.type);

try {
  if (!base) base = await startPlayground();
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext()).newPage();
  page.setDefaultTimeout(300000);
  await page.goto(`${base}/?cardz3n_e2e=suite`, { waitUntil: 'domcontentloaded', timeout: 300000 });
  const text = await page.evaluate(() => document.body.innerText);
  let r;
  try { r = JSON.parse(text); } catch (e) { check('the scenario suite ran', false, text.slice(0, 200)); throw e; }

  // D1) customer changes to a new card
  const c = r.change_new_card; const sr = c.signup_requests || []; const q = sr[0] || {};
  check('Change to a new card: exactly one request, a $0.00 verification, and NO sale', c.error === undefined && j(types(sr)) === j(['validate']) && q.amount === '0.00', c.error || j(sr));
  check('Change to a new card: the card is added to the vault with the first-payment fields', q.customer_vault === 'add_customer' && q.has_token === true && q.initiated_by === 'customer' && q.stored_credential_indicator === 'stored', j(q));
  check('Change to a new card: the subscription holds the NEW vault ID and first transaction ID', /^V-\d+$/.test(c.sub.vault) && c.sub.vault !== 'V-OLD' && /^TX-\d+$/.test(c.sub.initial) && c.sub.initial !== 'TX-OLD', j(c.sub));
  check('Change to a new card: the first order and the customer\'s other subscription are left alone', c.parent.vault === 'V-OLD' && c.parent.initial === 'TX-OLD' && c.other_sub.vault === 'V-OLD' && c.other_sub.initial === 'TX-OLD', j({ parent: c.parent, other: c.other_sub }));
  check('Change to a new card: the customer is sent to the subscription page and the subscription status is unchanged', c.result === 'success' && c.redirect === c.view_url && c.redirect !== '' && c.status === 'pending', j({ r: c.redirect, v: c.view_url, s: c.status }));
  check('Change to a new card: the card is also kept as a WooCommerce saved method', c.tokens_added === 1, String(c.tokens_added));
  const rr = (c.renewal_requests || [])[0] || {};
  check('Change to a new card: the NEXT renewal is charged from the new vault with the new first transaction ID', (c.renewal_requests || []).length === 1 && rr.type === 'sale' && rr.customer_vault_id === c.sub.vault && rr.initial_transaction_id === c.sub.initial, j(rr));

  // D2) declined
  const d = r.change_declined;
  check('Declined new card: the change fails, only a verification was sent, the old card stays and nothing is saved', d.error === undefined && d.result === 'failure' && j(types(d.requests)) === j(['validate']) && d.sub.vault === 'V-OLD' && d.sub.initial === 'TX-OLD' && d.tokens_added === 0, d.error || j(d));

  // D3) saved card
  const s = r.change_saved_card;
  check('Saved card chosen: no request is sent to the gateway', s.error === undefined && (s.requests || []).length === 0, s.error || j(s.requests));
  check('Saved card chosen: the subscription gets that card and its first transaction ID, the first order is untouched', s.result === 'success' && s.sub.vault === 'V-SAVED' && s.sub.initial === 'TX-SAVED' && s.parent.vault === 'V-OLD', j(s));
  const s2 = r.change_saved_card_no_txn;
  check('Saved card without a first transaction ID: the old card\'s ID is not left behind, a fresh one comes from a $0.00 verification of the saved card', s2.result === 'success' && s2.sub.vault === 'V-SAVED2' && /^TX-\d+$/.test(s2.sub.initial) && s2.sub.initial !== 'TX-OLD' && (s2.requests || []).length === 1 && s2.requests[0].type === 'validate' && s2.requests[0].amount === '0.00' && s2.requests[0].customer_vault_id === 'V-SAVED2' && s2.requests[0].stored_credential_indicator === 'stored' && s2.requests[0].billing_method === 'recurring', j({ sub: s2.sub, requests: s2.requests }));

  // D4) ACH, D5) someone else's subscription
  const a = r.change_ach_refused;
  check('Bank (ACH) is refused, nothing is sent, the old card stays', a.result === 'failure' && (a.requests || []).length === 0 && a.sub.vault === 'V-OLD', j(a));
  const o = r.change_other_customers_subscription;
  check('A subscription of another customer cannot be changed: refused, nothing sent, nothing stored', o.result === 'failure' && (o.requests || []).length === 0 && o.sub.vault === 'V-OLD', j(o));

  // D6) payment meta
  const pm = (r.payment_meta_filter.meta || {});
  const row = (pm.cardz3n_gateway || {}).post_meta || {};
  check('Admin payment-meta table: the vault ID and first transaction ID are listed with their stored values and labels', (row._cardz3n_customer_vault_id || {}).value === 'V-OLD' && (row._cardz3n_initial_txn_id || {}).value === 'TX-OLD' && !!(row._cardz3n_customer_vault_id || {}).label && !!(row._cardz3n_initial_txn_id || {}).label, j(pm));
  check('Admin payment-meta table: other gateways\' rows are kept', !!pm.other_gateway, j(Object.keys(pm)));

  // D7) validation
  const v = r.payment_meta_validation;
  check('Admin validation: an empty or blank vault ID is refused with a clear message', v.empty !== 'ok' && v.spaces_only !== 'ok' && /vault ID/i.test(v.empty), j({ e: v.empty, b: v.spaces_only }));
  check('Admin validation: a vault ID with odd characters is refused', v.odd !== 'ok' && v.odd_initial !== 'ok', j({ odd: v.odd, odd_initial: v.odd_initial }));
  check('Admin validation: normal IDs pass', v.valid === 'ok' && v.valid_with_initial === 'ok', j({ valid: v.valid, valid2: v.valid_with_initial }));

  // D8) add_payment_method
  const ap = r.add_payment_method_ok;
  check('Add payment method: one $0.00 verification with vault, NO sale', ap.error === undefined && j(types(ap.requests)) === j(['validate']) && ap.requests[0].amount === '0.00' && ap.requests[0].customer_vault === 'add_customer', ap.error || j(ap.requests));
  check('Add payment method: succeeds, saves one method, and goes back to the Payment methods page', ap.result === 'success' && ap.tokens_added === 1 && /payment-methods/.test(ap.redirect), j({ r: ap.result, t: ap.tokens_added, u: ap.redirect }));
  const ad = r.add_payment_method_declined;
  check('Add payment method with a declined card: fails and nothing is saved', ad.error === undefined && ad.result === 'failure' && ad.tokens_added === 0, ad.error || j(ad));
  const ae = r.add_payment_method_ach_or_empty;
  check('Add payment method with a bank token or no token: refused, nothing sent, nothing saved', ae.error === undefined && ae.ach === 'failure' && ae.empty === 'failure' && (ae.requests || []).length === 0 && ae.tokens_added === 0, ae.error || j(ae));

  // D9) failing renewal
  const f = r.failing_renewal_updated;
  check('Failing renewal fixed by a method change: the failed renewal order gets the new vault and first transaction ID (either argument order)', f.renewal_a.vault === 'V-NEW' && f.renewal_a.initial === 'TX-NEW' && f.renewal_b.vault === 'V-NEW' && f.renewal_b.initial === 'TX-NEW', j(f));

  // D10) regression
  const n = r.normal_order_still_sale; const nq = (n.requests || [])[0] || {};
  check('A normal order is untouched: still one sale', n.result === 'success' && j(types(n.requests)) === j(['sale']) && !nq.customer_vault, j(n.requests));

  await browser.close();
} catch (e) {
  check('test run completed without an error', false, String(e.message).slice(0, 200));
} finally {
  if (server) { try { if (process.platform === 'win32') { spawn('taskkill', ['/PID', String(server.pid), '/T', '/F']); } else { server.kill(); } } catch { /* ignore */ } }
}
const failed = results.filter((x) => !x.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
