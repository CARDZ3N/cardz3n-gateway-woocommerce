// End-to-end check: the Apple Pay domain verification file can be pasted into the settings and is served by the plugin, and the
// settings page guides the merchant through the Apple Pay set-up.
//
// Why: Apple Pay needs Apple's Domain Verification File reachable at /.well-known/apple-developer-merchantid-domain-association
// on the store's domain. Many merchants cannot put a file there. The plugin serves the text they paste into a setting, only at that
// exact path, as plain text. The settings page also shows plain-language steps, whether the store address is HTTPS and whether the
// file is served, and warns (merchant only) when Apple Pay is on without HTTPS.
//
// No keys, nothing is charged, nothing leaves the machine.
//
// Run (from the plugin folder, Node 18+):
//   npm i --no-save playwright && npx playwright install chromium
//   node tests/e2e/apple-pay-file.spec.mjs
// Environment (optional): E2E_BASE_URL, PLUGIN_DIR, PW_DIR as in the other e2e specs (Playground port 9424).
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const require = createRequire(process.env.PW_DIR ? join(process.env.PW_DIR, 'package.json') : join(process.cwd(), 'package.json'));
const { chromium } = require('playwright');

const pluginDir = resolve(process.env.PLUGIN_DIR || process.cwd());
let base = process.env.E2E_BASE_URL;
let server = null;

async function startPlayground() {
  const port = '9424';
  const blueprint = join(pluginDir, 'tests', 'e2e', 'blueprint-apple-pay.json');
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
const FILE_PATH = '/.well-known/apple-developer-merchantid-domain-association';
// Looks like Apple's file (a long hex string), with a line break to prove the text is kept exactly.
const FILE_TEXT = '7B227073704964223A22E2' + 'A1B2C3D4E5F60718293A4B5C6D7E8F90'.repeat(8) + '\n' + 'FEDCBA9876543210'.repeat(6);

try {
  if (!base) base = await startPlayground();
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(300000);
  await page.goto(base + '/wp-login.php', { waitUntil: 'domcontentloaded', timeout: 300000 });
  if (await page.locator('#user_login').count()) {
    await page.fill('#user_login', 'admin'); await page.fill('#user_pass', 'password');
    await Promise.all([page.waitForURL(/wp-admin/, { timeout: 90000 }).catch(() => {}), page.click('#wp-submit')]);
  }
  const anon = await browser.newContext(); // a shopper: no login
  const get = async (path, method = 'GET') => {
    const r = method === 'GET' ? await anon.request.get(base + path, { maxRedirects: 0, failOnStatusCode: false, timeout: 180000 }) : method === 'HEAD' ? await anon.request.head(base + path, { maxRedirects: 0, failOnStatusCode: false, timeout: 180000 }) : await anon.request.post(base + path, { maxRedirects: 0, failOnStatusCode: false, timeout: 180000 });
    return { status: r.status(), type: r.headers()['content-type'] || '', nosniff: r.headers()['x-content-type-options'] || '', body: method === 'HEAD' ? '' : await r.text() };
  };
  const stored = async () => { await page.goto(`${base}/?cardz3n_e2e=opt`, { waitUntil: 'domcontentloaded' }); return JSON.parse(await page.evaluate(() => document.body.innerText)); };
  const gateway = `${base}/wp-admin/admin.php?page=wc-settings&tab=checkout&section=cardz3n_gateway`;
  const FIELD = '[name="woocommerce_cardz3n_gateway_apple_pay_verification_file"]';
  const save = async () => { await Promise.all([page.waitForLoadState('domcontentloaded'), page.click('button.woocommerce-save-button')]); await page.waitForTimeout(3000); };

  // 1) Nothing pasted: nothing is served.
  const none = await get(FILE_PATH);
  check('Nothing pasted: the file address does not serve a file', !(none.status === 200 && /text\/plain/.test(none.type)), j({ s: none.status, t: none.type }));

  // 2) The settings page: guidance, status lines, the box, and the warning for Apple Pay without HTTPS.
  await page.goto(gateway, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('form#mainform');
  const v1 = await page.evaluate((sel) => ({ text: document.body.innerText, box: document.querySelectorAll(sel).length }), FIELD);
  check('Settings page: the Apple Pay file box is there', v1.box === 1, 'boxes: ' + v1.box);
  check('Settings page: plain-language steps in NMI\'s order (HTTPS first, then the control panel, the file, Allowed Domains, the test)', /must start with https:\/\//i.test(v1.text) && /Options, then Settings, then Apple Pay/i.test(v1.text) && /paste its whole text into the box/i.test(v1.text) && /Allowed Domains/i.test(v1.text) && /iPhone in Safari/i.test(v1.text));
  check('Settings page: says wallets are optional and not yet verified on real devices', /optional and have not yet been verified on real devices/i.test(v1.text));
  check('Settings page: status "Store address is HTTPS: no" and "Verification file: not set"', /Store address is HTTPS:\s*no/i.test(v1.text) && /Verification file:\s*not set/i.test(v1.text));
  check('Settings page: Apple Pay on without HTTPS shows an admin warning', /does not start with https:\/\//i.test(v1.text) && /shoppers see no error/i.test(v1.text));

  // 3) Paste the file and save.
  await page.fill(FIELD, FILE_TEXT);
  await save();
  const s1 = await stored();
  check('After saving: the pasted text is stored exactly', s1.file === FILE_TEXT, j({ len: (s1.file || '').length }));
  check('After saving: other settings are intact', s1.test_mode === 'yes' && s1.enable_apple_pay === 'yes' && s1.enable_google_pay === 'yes', j(s1).slice(0, 160));

  // 4) The file is served to a shopper.
  const got = await get(FILE_PATH);
  check('The file address answers 200 with the exact text', got.status === 200 && got.body === FILE_TEXT, j({ s: got.status, len: got.body.length }));
  check('...as plain text, with no sniffing, and no redirect', /^text\/plain/.test(got.type) && got.nosniff === 'nosniff', j({ t: got.type, n: got.nosniff }));
  const head = await get(FILE_PATH, 'HEAD');
  check('A HEAD request answers 200 with no body', head.status === 200 && head.body === '', j({ s: head.status }));
  const post = await get(FILE_PATH, 'POST');
  check('A POST to that address is not answered with the file', post.body !== FILE_TEXT);
  const other = await get('/.well-known/security.txt');
  check('Another /.well-known path is untouched (no file text)', other.body !== FILE_TEXT && other.status !== 200, j({ s: other.status }));
  const slash = await get(FILE_PATH + '/');
  check('Only the exact path serves it (a longer path does not)', slash.body !== FILE_TEXT);

  // 5) The page now shows the file as served, and the HTTPS status when the store address is HTTPS.
  await page.goto(gateway + '&cz_https=1', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('form#mainform');
  const v2 = await page.evaluate(() => ({ text: document.body.innerText, link: !!Array.from(document.querySelectorAll('a')).find((a) => /Open the file address/.test(a.textContent)) }));
  check('Settings page with an HTTPS store address: "Store address is HTTPS: yes" and no warning', /Store address is HTTPS:\s*yes/i.test(v2.text) && !/does not start with https:\/\//i.test(v2.text));
  check('Settings page: the guidance follows NMI\'s steps (control panel Options, Settings, Apple Pay; Domain Verification File; .well-known directory; Allowed Domains) and no longer tells the merchant to ask CARDZ3N to register the domain', /Options, then Settings, then Apple Pay/.test(v2.text) && /Domain Verification File/.test(v2.text) && /\.well-known directory/.test(v2.text) && /Allowed Domains/.test(v2.text) && !/Ask CARDZ3N support/i.test(v2.text.slice(v2.text.indexOf('Apple Pay only appears'), v2.text.indexOf('Store address is HTTPS:'))), v2.text.slice(v2.text.indexOf('Apple Pay only appears'), v2.text.indexOf('Apple Pay only appears') + 160).replace(/\s+/g, ' '));
  check('Settings page: "Verification file: served at <address>" and an "Open the file address" link', /Verification file:\s*served at https:\/\/.*apple-developer-merchantid-domain-association/i.test(v2.text) && v2.link);

  // 6) Too long: refused, the old value stays.
  await page.goto(gateway, { waitUntil: 'domcontentloaded' });
  await page.fill(FIELD, 'A'.repeat(70000));
  await save();
  const s2 = await stored();
  check('Text over 65,536 characters is refused and the stored file is unchanged', s2.file === FILE_TEXT, j({ len: (s2.file || '').length }));

  // 7) A real file already on the web server wins; the plugin does nothing.
  await page.goto(`${base}/?cardz3n_e2e=makefile`, { waitUntil: 'domcontentloaded' });
  const real = await get(FILE_PATH);
  check('A real file at that address is served as it is (the plugin steps aside)', real.body === 'REAL-FILE-ON-DISK', j({ s: real.status, b: real.body.slice(0, 40) }));

  // 8) Clearing the box stops serving it (the real file is removed first by clearing the stored text only: check the stored value).
  await page.goto(gateway, { waitUntil: 'domcontentloaded' });
  await page.fill(FIELD, '');
  await save();
  const s3 = await stored();
  check('Clearing the box clears the stored text', s3.file === '', j(s3.file));

  await browser.close();
} catch (e) {
  check('test run completed without an error', false, String(e.message).slice(0, 200));
} finally {
  if (server) { try { if (process.platform === 'win32') { spawn('taskkill', ['/PID', String(server.pid), '/T', '/F']); } else { server.kill(); } } catch { /* ignore */ } }
}
const failed = results.filter((x) => !x.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
