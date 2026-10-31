// End-to-end check: the text shown under the payment option on the classic checkout does not tell shoppers that ACH, Apple Pay or
// Google Pay are offered (they are optional and not verified on real devices), unless the merchant wrote that text.
//
// Why: the old default description read "Pay securely with a credit/debit card, ACH, Apple Pay, or Google Pay." and was shown to every
// shopper even when those methods were off. The default is now card-only, and the old default text, if it was saved by an earlier
// version, is shown as the card-only text. A description the merchant wrote is shown exactly as written.
//
// Run (from the plugin folder, Node 18+):
//   npm i --no-save playwright && npx playwright install chromium
//   node tests/e2e/default-description.spec.mjs
// Environment (optional): E2E_BASE_URL, PLUGIN_DIR, PW_DIR as in the other e2e specs (Playground port 9426).
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const require = createRequire(process.env.PW_DIR ? join(process.env.PW_DIR, 'package.json') : join(process.cwd(), 'package.json'));
const { chromium } = require('playwright');

const pluginDir = resolve(process.env.PLUGIN_DIR || process.cwd());
let base = process.env.E2E_BASE_URL;
let server = null;

async function startPlayground() {
  const port = '9426';
  const blueprint = join(pluginDir, 'tests', 'e2e', 'blueprint-default-description.json');
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
const OLD = 'Pay securely with a credit/debit card, ACH, Apple Pay, or Google Pay.';

try {
  if (!base) base = await startPlayground();
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await ctx.newPage(); page.setDefaultTimeout(300000);
  await page.route(/Collect\.js/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.CollectJS={configure:function(){},startPaymentRequest:function(){},clearInputs:function(){}};' }));
  await page.goto(base + '/', { waitUntil: 'domcontentloaded', timeout: 300000 });
  const pid = await page.evaluate(() => fetch('/wp-json/wc/store/v1/products').then((r) => r.json()).then((p) => p[0].id));
  await page.goto(`${base}/?add-to-cart=${pid}`, { waitUntil: 'domcontentloaded' });

  // What the shopper reads under the payment option for a given saved description.
  const shown = async (value) => {
    await page.goto(`${base}/?cardz3n_e2e=desc&v=${encodeURIComponent(value)}`, { waitUntil: 'domcontentloaded' });
    await page.goto(base + '/checkout-classic/');
    await page.waitForSelector('.payment_box.payment_method_cardz3n_gateway', { state: 'attached' });
    return page.evaluate(() => { const p = document.querySelector('.payment_box.payment_method_cardz3n_gateway > p'); return p ? p.textContent : ''; });
  };

  const oldSaved = await shown(OLD);
  check('An earlier version saved the old default: shoppers read the card-only text', /Pay securely with a credit or debit card\./.test(oldSaved) && !/Apple Pay|Google Pay|ACH/i.test(oldSaved), oldSaved.replace(/\s+/g, ' ').slice(0, 140));

  const unsaved = await shown('__unset__');
  check('Nothing saved: the default is card-only and names no wallet or bank method', /Pay securely with a credit or debit card\./.test(unsaved) && !/Apple Pay|Google Pay|ACH/i.test(unsaved), unsaved.replace(/\s+/g, ' ').slice(0, 140));

  const custom = await shown('Pay with Apple Pay if you like. Our own words.');
  check('A description the merchant wrote is shown exactly as written', /Pay with Apple Pay if you like\. Our own words\./.test(custom), custom.replace(/\s+/g, ' ').slice(0, 140));

  await browser.close();
} catch (e) {
  check('test run completed without an error', false, String(e.message).slice(0, 200));
} finally {
  if (server) { try { if (process.platform === 'win32') { spawn('taskkill', ['/PID', String(server.pid), '/T', '/F']); } else { server.kill(); } } catch { /* ignore */ } }
}
const failed = results.filter((x) => !x.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
