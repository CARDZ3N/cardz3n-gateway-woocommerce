// Static check (no site needed): no public text may claim more than is proven. Run from the plugin folder: node tests/public-claims.check.mjs
//
// Claims that are NOT yet proven stay out of the public text (see the register kept by the maintainers):
//   - WooCommerce Pre-Orders at release (only "not yet verified" may appear),
//   - Apple Pay / Google Pay working (they may appear only in the FAQ, as off-by-default settings not yet verified on real devices),
//   - 3-D Secure beyond what is proven: it may be named only with its limits (new cards on the classic checkout, Payer Authentication first,
//     verified on NMI's test environment, not on CARDZ3N's own host) and never as compliance, liability protection or SCA cover,
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
b = bad(/compliant|compliance|liability shift|PSD2|guarantee|fully protected/i, /makes no promise about liability or about meeting any regulation/);
b.length ? fail('readme.txt makes a compliance or protection claim: ' + b[0].slice(0, 90)) : ok('readme.txt: no compliance or protection claim');
const faq3 = lines.find((l) => /^Optional, off by default\. The plugin can ask the cardholder's bank/.test(l)) || '';
(/Payer Authentication 2\.0 must first be enabled/.test(faq3) && /verified against NMI's 3D Secure test environment/.test(faq3) && /not been verified on CARDZ3N's own gateway host/.test(faq3) && /makes no promise about liability/.test(faq3) && /not saved cards, bank payments/.test(faq3)) ? ok('readme.txt: the 3-D Secure FAQ states its limits (Payer Authentication first, NMI test environment only, no promise)') : fail('readme.txt: the 3-D Secure FAQ is missing a required limit');
b = bad(/3-?D Secure|3DS|SCA\b/i, /^= Can I use 3D Secure \(strong customer authentication\)\? =$|^Optional, off by default\. The plugin can ask the cardholder's bank/);
b.length ? fail('readme.txt names 3-D Secure outside its FAQ: ' + b[0].slice(0, 90)) : ok('readme.txt: 3-D Secure appears only in its FAQ');
b = bad(/card-on-file|stored[- ]credential|initiated_by|initial_transaction/i);
b.length ? fail('readme.txt shows an internal card-on-file detail: ' + b[0].slice(0, 90)) : ok('readme.txt: no card-on-file claim');
b = bad(/apple pay|google pay/i, /^= Do I need a separate plugin for Apple Pay or Google Pay\? =$|^The plugin has Apple Pay and Google Pay settings\. .*have not yet been verified on real devices|^Optional, off by default\. The plugin can ask the cardholder's bank/); // only the FAQ may name wallets, and only with the caveat
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
const cl3 = cl.split('\n').filter((l) => /3-?D Secure/i.test(l));
(cl3.every((l) => /Payer Authentication must be switched on/.test(l) && /are not authenticated/.test(l)) && !/compliant|compliance|liability|verified on CARDZ3N|SCA\b/i.test(cl3.join(' '))) ? ok('changelog.txt: 3-D Secure appears only with its limits, no compliance claim') : fail('changelog.txt (newest entry) overclaims 3-D Secure');

// README.md
const md = read('README.md');
/pre-?order/i.test(md.split('\n').filter((l) => !/\.php/.test(l)).join('\n')) ? fail('README.md names pre-orders') : ok('README.md: no pre-order claim');

console.log(`\n${failed} problem(s)`);
process.exit(failed ? 1 : 0);
