// End-to-end check: the 3-D Secure settings screen and what the merchant is told.
//
// What is under test:
//   - The setting is a three-way choice and defaults to OFF on a fresh install (nothing saved).
//   - When Required is saved, the settings page shows a plain warning that Required BLOCKS ALL new-card payments until Payer Authentication is
//     enabled on the gateway account, and recommends Attempt; with Attempt or Off that warning is not shown.
//   - The help text next to the setting says Payer Authentication must be enabled first, that the plugin cannot enroll the merchant, and
//     promises nothing about liability shift or compliance.
//   - When a card payment is stopped because 3-D Secure could not run (reported by the checkout page with a fixed reason code), the
//     merchant sees a notice with the cause in plain words on the settings page; an unknown reason is refused.
//
// Run (from the plugin folder, Node 18+):
//   npm i --no-save playwright && npx playwright install chromium
//   node tests/e2e/three-d-secure-settings.spec.mjs
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
  const blueprint = join(pluginDir, 'tests', 'e2e', 'blueprint-three-d-secure-settings.json');
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
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 1400 } })).newPage();
  page.setDefaultTimeout(300000);
  await page.goto(base + '/wp-login.php', { waitUntil: 'domcontentloaded', timeout: 300000 });
  if (await page.locator('#user_login').count()) {
    await page.fill('#user_login', 'admin'); await page.fill('#user_pass', 'password');
    await Promise.all([page.waitForURL(/wp-admin/, { timeout: 90000 }).catch(() => {}), page.click('#wp-submit')]);
  }
  const gateway = `${base}/wp-admin/admin.php?page=wc-settings&tab=checkout&section=cardz3n_gateway`;
  const setMode = async (v) => { await page.goto(`${base}/?cz3s=mode&v=${v}`, { waitUntil: 'domcontentloaded' }); };
  const view = async () => {
    await page.goto(gateway, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('form#mainform');
    return page.evaluate(() => {
      const sel = document.querySelector('select[name$="three_d_secure_mode"]');
      return {
        text: document.body.innerText,
        value: sel ? sel.value : null,
        options: sel ? Array.from(sel.options).map((o) => o.value) : [],
        optionLabels: sel ? Array.from(sel.options).map((o) => o.text).join(' | ') : '',
        helper: (sel && sel.closest('td') ? sel.closest('td').innerText : '')
      };
    });
  };
  const REQUIRED_WARNING = /3D Secure is set to Required\.\s*Every new-card payment will be BLOCKED until Payer Authentication is enabled on your CARDZ3N gateway account\.\s*Use Attempt until that is confirmed[^.]*\.\s*Required applies to new-card payments only: payments with a saved card are not put through 3D Secure\./i;

  // 1) Fresh install: nothing saved.
  await setMode('unset');
  const fresh = await view();
  check('Fresh install (nothing saved): the setting is a three-way choice and defaults to Off', j(fresh.options) === j(['off', 'attempt', 'required']) && fresh.value === 'off', j({ value: fresh.value, options: fresh.options }));
  check('Fresh install: no Required warning is shown', !REQUIRED_WARNING.test(fresh.text));

  // 2) Attempt saved: no Required warning.
  await setMode('attempt');
  const att = await view();
  check('Attempt saved: the page shows Attempt and no Required warning', att.value === 'attempt' && !REQUIRED_WARNING.test(att.text), j({ value: att.value }));

  // 3) Required saved: the plain warning is shown.
  await setMode('required');
  const req = await view();
  check('Required saved: the page shows the plain warning that Required blocks ALL new-card payments and recommends Attempt', req.value === 'required' && REQUIRED_WARNING.test(req.text), j({ value: req.value }));

  // 4) The help text next to the setting.
  check('Help text: Payer Authentication must be enabled on the gateway account first, and the plugin cannot enroll the merchant', /Payer Authentication 2\.0 must be enabled on your CARDZ3N gateway account first/.test(req.helper) && /cannot enroll you/.test(req.helper), req.helper.slice(0, 120));
  check('Help text: says Required blocks all card payments until Payer Authentication is enabled, and recommends Attempt until confirmed', /BLOCKS ALL new-card payments until Payer Authentication is enabled: use Attempt until that is confirmed/.test(req.helper));
  check('Help text: says plainly that saved cards are NOT put through 3D Secure and that Required applies to new-card payments only', /3D Secure applies to NEW card payments only\. Saved cards are NOT put through 3D Secure, so Required does not stop or check a payment made with a saved card/.test(req.helper), req.helper.slice(0, 160));
  check('Setting options: the Required label says saved cards are not put through 3D Secure', /Required: stop a new-card payment[^|]*saved cards are not put through 3D Secure/.test(req.optionLabels), req.optionLabels);
  check('Help text: promises nothing about liability shift, compliance or protection from chargebacks', !/liability shift|compliant|compliance guaranteed|chargeback protection|fully protected/i.test(req.helper));

  // 5) A stopped payment is reported with a fixed reason and shown to the merchant.
  await setMode('required');
  const nonce = await page.evaluate(async (b) => {
    const r = await fetch(b + '/checkout-classic/'); const t = await r.text();
    return (t.match(/"nonce":"([a-f0-9]+)"/) || [])[1] || '';
  }, base);
  const post = (reason) => page.evaluate(async ({ b, n, reason }) => {
    const r = await fetch(b + '/wp-admin/admin-ajax.php', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ action: 'cardz3n_gw_3ds_report', nonce: n, reason }) });
    return r.status;
  }, { b: base, n: nonce, reason });
  check('The page nonce was found for the report call', nonce.length > 5, 'nonce length ' + nonce.length);
  const bad = await post('drop table');
  check('A report with a reason that is not on the fixed list is refused', bad === 400, 'status ' + bad);
  const none = await view();
  check('No notice about stopped payments before any valid report', !/card payments? (was|were) stopped in the last 7 days/i.test(none.text));
  const good = await post('gateway_error');
  const after = await view();
  check('A valid report is accepted', good === 200, 'status ' + good);
  check('The settings page now tells the merchant a card payment was stopped, with the cause in plain words (Payer Authentication probably not enabled)', /1 card payment was stopped in the last 7 days because 3D Secure could not run\.\s*Cause: the gateway reported an error starting 3-D Secure \(Payer Authentication is probably not enabled on this gateway account\)/.test(after.text), after.text.slice(after.text.indexOf('card payment') - 10, after.text.indexOf('card payment') + 160).replace(/\s+/g, ' '));

  await browser.close();
} catch (e) {
  check('test run completed without an error', false, String(e.message).slice(0, 200));
} finally {
  if (server) { try { if (process.platform === 'win32') { spawn('taskkill', ['/PID', String(server.pid), '/T', '/F']); } else { server.kill(); } } catch { /* ignore */ } }
}
const failed = results.filter((x) => !x.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
