// End-to-end (local stand-in) check: a subscription sign-up saves the card, and the FIRST renewal is charged from it.
//
// WooCommerce Subscriptions is replaced by a small stand-in inside a probe plugin (in the blueprint): the same function names the
// gateway calls (wcs_order_contains_subscription, wcs_get_subscriptions_for_order, wcs_get_subscriptions_for_renewal_order) and subscription
// objects that know their first order. The gateway's HTTP is short-circuited and every request is recorded (never any secret), so this proves
// WHAT THE GATEWAY WOULD BE ASKED TO DO and which data is stored where. The real plugin is tested separately on the demo store.
//
// Card-on-file field values are ASSUMPTIONS from the gateway's published API (see includes/class-cardz3n-recurring.php, A4 to A8).
//
// Run (from the plugin folder, Node 18+):
//   npm i --no-save playwright && npx playwright install chromium
//   node tests/e2e/recurring-save-and-renew.spec.mjs
// Environment (optional):
//   E2E_BASE_URL  use an already running site instead of starting a WordPress Playground on port 9414
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
  const port = '9414';
  const blueprint = join(pluginDir, 'tests', 'e2e', 'blueprint-recurring.json');
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

try {
  if (!base) base = await startPlayground();
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext()).newPage();
  page.setDefaultTimeout(300000);
  await page.goto(`${base}/?cardz3n_e2e=suite`, { waitUntil: 'domcontentloaded', timeout: 300000 });
  const text = await page.evaluate(() => document.body.innerText);
  let r;
  try { r = JSON.parse(text); } catch (e) { check('the scenario suite ran', false, text.slice(0, 200)); throw e; }

  // 1) initial purchase
  const ip = r.initial_purchase; const q = (ip.requests || [])[0] || {};
  check('Sign-up: the charge succeeds', ip.result === 'success', ip.result);
  check('Sign-up: the card is saved even though no box was ticked (customer_vault=add_customer)', q.customer_vault === 'add_customer' && q.has_token === true, j(q));
  check('Sign-up: the first charge is a sale with the stored-credential fields (customer-initiated, "stored")', q.type === 'sale' && q.initiated_by === 'customer' && q.stored_credential_indicator === 'stored', j(q));
  check('Sign-up: the saved card is stored on the first order', /^V-/.test(ip.order.vault) && /^TX-/.test(ip.order.initial), j(ip.order));
  check('Sign-up: the saved card is stored on the SUBSCRIPTION too', ip.subscription.vault === ip.order.vault && ip.subscription.initial === ip.order.initial, j(ip.subscription));

  // 2) first renewal
  const fr = r.first_renewal; const rq = (fr.requests || [])[0] || {};
  check('First renewal: exactly one request', (fr.requests || []).length === 1, `requests=${(fr.requests || []).length}`);
  check('First renewal: charged from the saved card (no card data, no token)', /^V-/.test(rq.customer_vault_id || '') && rq.has_token === false && rq.type === 'sale', j(rq));
  check('First renewal: merchant-initiated stored-credential fields and the first transaction ID', rq.initiated_by === 'merchant' && rq.stored_credential_indicator === 'used' && /^TX-/.test(rq.initial_transaction_id || '') && rq.billing_method === 'recurring', j(rq));
  check('First renewal: the renewal order is paid', ['processing', 'completed'].includes(fr.status) && fr.paid === true && /^TX-/.test(fr.txn), j({ status: fr.status, txn: fr.txn }));

  // 3) legacy: only the first order has the saved card
  const lg = r.legacy_parent_only; const lq = (lg.requests || [])[0] || {};
  check('Older store (saved card only on the first order): the renewal still finds it and is paid', lq.customer_vault_id === 'V-OLD' && ['processing', 'completed'].includes(lg.status), j(lq));
  check('Older store: the first transaction ID is taken from the first order', lq.initial_transaction_id === 'TX-OLD');
  check('Older store: the saved card is written to the subscription for next time', lg.subscription_after.vault === 'V-OLD', j(lg.subscription_after));

  // 4) no double charge
  check('A renewal that is already paid is not charged again', (r.already_paid.requests || []).length === 0 && ['processing', 'completed'].includes(r.already_paid.status), j(r.already_paid.requests));

  // 5) no saved card
  const ns = r.no_saved_card;
  check('No saved card anywhere: the renewal fails with a clear note and nothing is sent', ns.status === 'failed' && (ns.requests || []).length === 0 && ns.notes.some((n) => /no saved payment method was found/i.test(n)), j(ns.notes));

  // 6) declined
  check('A declined renewal leaves the renewal order failed (Subscriptions then applies its own retry rules)', r.declined_renewal.status === 'failed' && r.declined_renewal.requests[0].amount === '0.50', j(r.declined_renewal.status));

  // 7) currency
  check('The renewal uses the order currency (EUR), not a default of USD', (r.renewal_currency_eur.requests[0] || {}).currency === 'EUR', j(r.renewal_currency_eur.requests[0]));

  // 8) ACH
  check('Bank payment for a subscription order is refused, nothing is sent', r.ach_refused.result === 'failure' && r.ach_refused.requests.length === 0);

  // 9) normal order untouched
  const nq = (r.normal_order.requests || [])[0] || {};
  check('A normal order is untouched: no forced card save, no stored-credential fields', r.normal_order.result === 'success' && !nq.customer_vault && !nq.initiated_by && !nq.stored_credential_indicator, j(nq));

  // 10) no vault returned
  check('If the gateway returns no saved card at sign-up, the charge is voided and checkout fails', r.no_vault_returned.result === 'failure' && j(r.no_vault_returned.requests.map((x) => x.type)) === j(['sale', 'void']), j(r.no_vault_returned.requests.map((x) => x.type)));

  // 11) authorize-only setting
  check('Authorize-only store setting: a subscription sign-up is still a sale, a normal order is an authorization', j(r.auth_only_mode.subscription_order_types) === j(['sale']) && j(r.auth_only_mode.normal_order_types) === j(['auth']), j(r.auth_only_mode));

  await browser.close();
} catch (e) {
  check('test run completed without an error', false, String(e.message).slice(0, 200));
} finally {
  if (server) { try { if (process.platform === 'win32') { spawn('taskkill', ['/PID', String(server.pid), '/T', '/F']); } else { server.kill(); } } catch { /* ignore */ } }
}
const failed = results.filter((x) => !x.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
