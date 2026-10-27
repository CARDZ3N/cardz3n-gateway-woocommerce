// End-to-end (local stand-in) check: the card-on-file fields NMI confirmed on 2026-10-26.
//
// First-store transaction: customer_vault add_customer, billing_method=recurring, initiated_by=customer, stored_credential_indicator=stored,
// and the returned transaction ID is kept. Every later charge: customer_vault_id, billing_method=recurring, stored_credential_indicator=used,
// initial_transaction_id (the kept first transaction ID), initiated_by=merchant for renewals or customer for a customer-present charge.
//
// What is proven here is what the plugin SENDS and KEEPS. The gateway is a stand-in that records each request (secrets are never recorded);
// nothing leaves the machine. Whether the real gateway reads these fields is not proven (see the ASSUMPTIONS in includes/class-cardz3n-recurring.php).
//
// Run (from the plugin folder, Node 18+):
//   npm i --no-save playwright && npx playwright install chromium
//   node tests/e2e/recurring-card-on-file-fields.spec.mjs
// Environment (optional): E2E_BASE_URL, PLUGIN_DIR, PW_DIR as in the other e2e specs (Playground port 9427).
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const require = createRequire(process.env.PW_DIR ? join(process.env.PW_DIR, 'package.json') : join(process.cwd(), 'package.json'));
const { chromium } = require('playwright');

const pluginDir = resolve(process.env.PLUGIN_DIR || process.cwd());
let base = process.env.E2E_BASE_URL;
let server = null;

async function startPlayground() {
  const port = '9427';
  const blueprint = join(pluginDir, 'tests', 'e2e', 'blueprint-recurring-fields.json');
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
  const reqs = (x) => x.requests || [];
  const q = (x, type) => reqs(x).filter((y) => y.type === type)[0] || {};
  const FIRST = { billing_method: 'recurring', initiated_by: 'customer', stored_credential_indicator: 'stored' };
  const matches = (obj, want) => Object.entries(want).every(([k, v]) => obj[k] === v);

  // a) The first charge of a subscription with a new card.
  const a = r.first_new_card; const as = q(a, 'sale');
  check('First charge, new card: the sale carries the first-store flags (vault add, recurring, customer, stored)', a.result === 'success' && matches(as, FIRST) && as.customer_vault === 'add_customer' && as.initial_transaction_id === undefined, j(as));
  check('First charge, new card: the returned transaction ID is kept on the order and the card is saved with it, marked as sent with the flags', /^TX-\d+$/.test(a.order.initial) && !!a.token && a.token.initial === a.order.initial && a.token.flagged === 'yes', j({ order: a.order, token: a.token }));

  // b) The first charge with a saved card.
  const b = r.first_saved_flagged; const bs = q(b, 'sale');
  check('First charge, saved card whose first transaction was flagged: used + that ID + recurring + customer-initiated, from the vault', b.result === 'success' && bs.customer_vault_id === 'V-FLAGGED' && bs.billing_method === 'recurring' && bs.initiated_by === 'customer' && bs.stored_credential_indicator === 'used' && bs.initial_transaction_id === 'TX-OLD-F' && bs.customer_vault === undefined, j(bs));
  check('First charge, saved flagged card: the same first transaction ID is kept on the order', b.order.initial === 'TX-OLD-F', j(b.order));
  const b2 = r.first_saved_unflagged; const b2s = q(b2, 'sale');
  check('First charge, saved card from the ordinary save-card checkbox: treated as a first-store (stored + recurring), the old ID is NOT sent', b2.result === 'success' && b2s.customer_vault_id === 'V-PLAIN' && matches(b2s, FIRST) && b2s.initial_transaction_id === undefined, j(b2s));
  check('...and this payment becomes the new first transaction, kept on the order and on the saved card (flagged)', /^TX-\d+$/.test(b2.order.initial) && b2.order.initial !== 'TX-OLD-U' && b2.token.initial === b2.order.initial && b2.token.flagged === 'yes', j({ order: b2.order, token: b2.token }));
  const b3 = r.first_saved_none; const b3s = q(b3, 'sale');
  check('First charge, saved card with no first transaction: treated as a first-store, and its transaction ID is kept as the first', b3.result === 'success' && matches(b3s, FIRST) && /^TX-\d+$/.test(b3.order.initial) && b3.token.initial === b3.order.initial && b3.token.flagged === 'yes', j({ s: b3s, order: b3.order, token: b3.token }));

  // c) The $0.00 verification.
  const c = r.trial_new_card; const cv = q(c, 'validate');
  check('$0.00 verification, new card: validate with the first-store flags and the vault', c.result === 'success' && cv.amount === '0.00' && matches(cv, FIRST) && cv.customer_vault === 'add_customer' && reqs(c).filter((y) => y.type === 'sale').length === 0, j(cv));
  check('$0.00 verification, new card: the verification transaction ID is kept as the first transaction', /^TX-\d+$/.test(c.order.initial), j(c.order));
  const c2 = r.trial_saved_flagged;
  check('Free trial, saved flagged card: nothing is sent to the gateway, the stored first transaction is kept', c2.result === 'success' && reqs(c2).length === 0 && c2.order.initial === 'TX-OLD-TF' && c2.order.vault === 'V-TF', j({ requests: reqs(c2).length, order: c2.order }));
  const c3 = r.trial_saved_unflagged; const c3v = q(c3, 'validate');
  check('Free trial, saved card without a flagged first transaction: a $0.00 verification of the vault entry with the first-store flags', c3.result === 'success' && reqs(c3).length === 1 && c3v.amount === '0.00' && c3v.customer_vault_id === 'V-TU' && matches(c3v, FIRST) && c3v.initial_transaction_id === undefined, j(c3v));
  check('...and its transaction ID becomes the first transaction (order and saved card, flagged), not the old one', /^TX-\d+$/.test(c3.order.initial) && c3.order.initial !== 'TX-OLD-TU' && c3.token.initial === c3.order.initial && c3.token.flagged === 'yes', j({ order: c3.order, token: c3.token }));
  const c4 = r.trial_saved_unflagged_switch_off;
  check('With the re-initialise switch off: nothing is sent, and the unflagged old ID is NOT stored as the first transaction (the renewal notes it as missing)', c4.result === 'success' && reqs(c4).length === 0 && c4.order.vault === 'V-TO' && c4.order.initial === '', j({ requests: reqs(c4).length, order: c4.order }));

  // d) Change payment method.
  const d = r.change_new_card; const dv = q(d, 'validate');
  check('Change payment method, new card: a $0.00 verification with the first-store flags (nothing is charged)', d.result === 'success' && dv.amount === '0.00' && matches(dv, FIRST) && dv.customer_vault === 'add_customer' && reqs(d).filter((y) => y.type === 'sale').length === 0, j(dv));
  check('Change payment method, new card: the subscription gets a FRESH first transaction ID and the new vault ID (the old ones are gone)', /^TX-\d+$/.test(d.sub.initial) && d.sub.initial !== 'TX-FIRST-OLD' && d.sub.vault !== 'V-OLDCARD' && d.sub.vault !== '', j(d.sub));
  const d2 = r.change_saved_flagged;
  check('Change payment method, saved flagged card: nothing is sent, the card\'s own first transaction ID replaces the old one', d2.result === 'success' && reqs(d2).length === 0 && d2.sub.initial === 'TX-OLD-CF' && d2.sub.vault === 'V-CF', j({ requests: reqs(d2).length, sub: d2.sub }));
  const d3 = r.change_saved_unflagged; const d3v = q(d3, 'validate');
  check('Change payment method, saved card without a flagged first transaction: a $0.00 verification of the vault entry, first-store flags', d3.result === 'success' && reqs(d3).length === 1 && d3v.customer_vault_id === 'V-CU' && matches(d3v, FIRST), j(d3v));
  check('...and the subscription gets that fresh ID (never the old subscription ID or the card\'s unflagged ID)', /^TX-\d+$/.test(d3.sub.initial) && d3.sub.initial !== 'TX-FIRST-OLD' && d3.sub.initial !== 'TX-OLD-CU' && d3.token.flagged === 'yes' && d3.token.initial === d3.sub.initial, j({ sub: d3.sub, token: d3.token }));

  // e) Renewals.
  const e = r.renewal_with_initial; const es = q(e, 'sale');
  check('Renewal: customer_vault_id + recurring + merchant-initiated + used + the first transaction ID', ['processing', 'completed'].includes(e.status) && !!es.customer_vault_id && es.billing_method === 'recurring' && es.initiated_by === 'merchant' && es.stored_credential_indicator === 'used' && /^TX-\d+$/.test(es.initial_transaction_id || '') && es.customer_vault === undefined, j(es));
  check('Renewal with a known first transaction: no "first transaction ID is missing" note', !(e.notes || []).some((n) => /first transaction ID of this subscription is not known/.test(n)), j(e.notes));
  const f = r.renewal_without_initial; const fs = q(f, 'sale');
  check('Renewal with no known first transaction: still charged (not stranded), without the ID, and an order note says so', ['processing', 'completed'].includes(f.status) && fs.billing_method === 'recurring' && fs.initiated_by === 'merchant' && fs.stored_credential_indicator === 'used' && fs.initial_transaction_id === undefined && (f.notes || []).some((n) => /first transaction ID of this subscription is not known/.test(n)), j({ s: fs, notes: f.notes }));

  await browser.close();
} catch (e) {
  check('test run completed without an error', false, String(e.message).slice(0, 200));
} finally {
  if (server) { try { if (process.platform === 'win32') { spawn('taskkill', ['/PID', String(server.pid), '/T', '/F']); } else { server.kill(); } } catch { /* ignore */ } }
}
const failed = results.filter((x) => !x.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
