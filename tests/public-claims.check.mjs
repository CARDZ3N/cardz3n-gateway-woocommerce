// Static check (no site needed): no public text may claim more than is proven. Run from the plugin folder: node tests/public-claims.check.mjs
//
// Claims that are NOT yet proven stay out of the public text (see the register kept by the maintainers):
//   - WooCommerce Pre-Orders at release (only "not yet verified" may appear),
//   - Apple Pay / Google Pay working (they may appear only in the FAQ, as off-by-default settings not yet verified on real devices),
//   - 3-D Secure (no code behind it),
//   - the gateway using card-on-file / stored-credential fields (internal detail, never a public claim).
import { readFileSync } from 'node:fs';

let failed = 0;
const fail = (m) => { failed++; console.log('FAIL  ' + m); };
const ok = (m) => console.log('PASS  ' + m);
const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

const readme = read('readme.txt');
const head = readme.split('== Changelog ==')[0];
// Privacy, External services and Screenshots are disclosures / planned pictures, not claims.
const claims = head.replace(/== Privacy ==[\s\S]*?== Installation ==/, '== Installation ==').replace(/== Screenshots ==[\s\S]*$/, '');
const lines = claims.split('\n');

const bad = (re, allow) => lines.filter((l) => re.test(l) && !(allow && allow.test(l)));

let b = bad(/pre-?orders?/i, /not yet verified/i);
b.length ? fail('readme.txt claims Pre-Orders: ' + b[0].slice(0, 90)) : ok('readme.txt: no Pre-Orders claim (only "not yet verified")');
b = bad(/3-?D Secure|3DS|SCA\b/i);
b.length ? fail('readme.txt claims 3-D Secure: ' + b[0].slice(0, 90)) : ok('readme.txt: no 3-D Secure claim');
b = bad(/card-on-file|stored[- ]credential|initiated_by|initial_transaction/i);
b.length ? fail('readme.txt shows an internal card-on-file detail: ' + b[0].slice(0, 90)) : ok('readme.txt: no card-on-file claim');
b = bad(/apple pay|google pay/i, /^= Do I need a separate plugin for Apple Pay or Google Pay\? =$|^The plugin has Apple Pay and Google Pay settings\. .*have not yet been verified on real devices/); // only the FAQ may name wallets, and only with the caveat
b.length ? fail('readme.txt names a wallet outside the FAQ caveat: ' + b[0].slice(0, 90)) : ok('readme.txt: Apple Pay / Google Pay appear only in the FAQ, with the "not yet verified on real devices" caveat');

// Short description and header: no wallet or pre-order claim.
const short = (readme.match(/^Embedded WooCommerce checkout[^\n]*/m) || [''])[0];
/apple pay|google pay|pre-?order/i.test(short) ? fail('readme.txt short description names wallets or pre-orders') : ok('readme.txt short description: no wallet or pre-order claim');
const main = read('cardz3n-gateway-woocommerce.php');
const headerDesc = main.split('\n').find((l) => /^\s*\* Description:/.test(l)) || '';
/pre-?order/i.test(headerDesc) ? fail('plugin header Description names pre-orders') : ok('plugin header Description: no pre-order claim');

// The newest changelog entries.
const cl = read('changelog.txt').split(/\n\d{4}-\d{2}-\d{2} - version /)[1] || '';
/pre-?orders?\b/i.test(cl.replace(/(Subscriptions or Pre-Orders|Pre-Orders is active|Pre-Orders active)/gi, '')) ? fail('changelog.txt (newest entry) claims Pre-Orders') : ok('changelog.txt: newest entry has no Pre-Orders claim');
/3-?D Secure/i.test(cl) ? fail('changelog.txt (newest entry) claims 3-D Secure') : ok('changelog.txt: no 3-D Secure claim');

// README.md
const md = read('README.md');
/pre-?order/i.test(md.split('\n').filter((l) => !/\.php/.test(l)).join('\n')) ? fail('README.md names pre-orders') : ok('README.md: no pre-order claim');

console.log(`\n${failed} problem(s)`);
process.exit(failed ? 1 : 0);
