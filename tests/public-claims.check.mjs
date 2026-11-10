// Static check (no site needed): no public text may claim more than is proven. Run from the plugin folder: node tests/public-claims.check.mjs
//
// Claims that are NOT yet proven stay out of the public text (see the register kept by the maintainers):
//   - WooCommerce Pre-Orders at release (only "not yet verified" may appear),
//   - Apple Pay / Google Pay beyond what is proven: single purchases on the classic checkout, not on subscription or pre-order carts, tested once
//     each in Test Mode from a mobile device (never "real devices", never production or certified),
//   - 3-D Secure beyond what is proven: it may be named only with its limits (new cards on the classic checkout, Payer Authentication first,
//     verified on a 3-D Secure test environment, not on CARDZ3N's own host) and never as compliance, liability protection or SCA cover,
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

let b = bad(/pre-?orders?/i, /not yet verified|not offered on subscription or pre-order carts|not on subscription or pre-order carts/i);
b.length ? fail('readme.txt claims Pre-Orders: ' + b[0].slice(0, 90)) : ok('readme.txt: no Pre-Orders claim (only "not yet verified")');
b = bad(/compliant|compliance|liability shift|PSD2|guarantee|fully protected/i, /makes no promise about liability or about meeting any regulation|does not make a store PCI compliant/);
b.length ? fail('readme.txt makes a compliance or protection claim: ' + b[0].slice(0, 90)) : ok('readme.txt: no compliance or protection claim');
const faq3 = lines.find((l) => /^Optional, off by default\. The plugin can ask the cardholder's bank/.test(l)) || '';
(/Payer Authentication 2\.0 must first be enabled/.test(faq3) && /verified against a 3D Secure test environment \(a shared demo account\)/.test(faq3) && /not been verified on CARDZ3N's own gateway host/.test(faq3) && /makes no promise about liability/.test(faq3) && /not saved cards, bank payments/.test(faq3) && /Saved cards are not put through 3D Secure, so Required applies to new-card payments only/.test(faq3) && !/blocks all card payments/.test(faq3)) ? ok('readme.txt: the 3-D Secure FAQ states its limits (Payer Authentication first, NMI test environment only, no promise)') : fail('readme.txt: the 3-D Secure FAQ is missing a required limit');
b = bad(/3-?D Secure|3DS|SCA\b/i, /^= Can I use 3D Secure \(strong customer authentication\)\? =$|^Optional, off by default\. The plugin can ask the cardholder's bank|^\* Optional 3-D Secure \(Off, Attempt or Required\) for new card payments on the classic checkout$/);
b.length ? fail('readme.txt names 3-D Secure outside its FAQ: ' + b[0].slice(0, 90)) : ok('readme.txt: 3-D Secure appears only in its FAQ');
b = bad(/card-on-file|stored[- ]credential|initiated_by|initial_transaction/i);
b.length ? fail('readme.txt shows an internal card-on-file detail: ' + b[0].slice(0, 90)) : ok('readme.txt: no card-on-file claim');
b = bad(/apple pay|google pay/i, /^= Do I need a separate plugin for Apple Pay or Google Pay\? =$|single purchases on the classic checkout|^Optional, off by default\. The plugin can ask the cardholder's bank/); // a wallet may only be named with its limits
b.length ? fail('readme.txt names a wallet without its limits: ' + b[0].slice(0, 90)) : ok('readme.txt: Apple Pay / Google Pay are named only with their limits (single purchases, classic checkout)');
const walletFaq = lines.find((l) => /^The plugin has Apple Pay and Google Pay settings\./.test(l)) || '';
(/single purchases on the classic checkout, not on subscription or pre-order carts, and were tested once each in Test Mode from a mobile device/.test(walletFaq) && !/real device|production|certified/i.test(walletFaq)) ? ok('readme.txt: the wallet FAQ states single purchases, classic checkout, no subscription or pre-order carts, tested once each in Test Mode from a mobile device') : fail('readme.txt: the wallet FAQ is missing a required limit or overclaims');
b = bad(/real device|production[- ]verified|certified/i);
b.length ? fail('readme.txt makes a real-device or certification claim: ' + b[0].slice(0, 90)) : ok('readme.txt: no real-device or certification claim');
b = bad(/Level 2|Level II|\bL2\b|every transaction|secure vault|no card data|card-brand restriction/i);
b.length ? fail('readme.txt uses retired or unproven wording: ' + b[0].slice(0, 90)) : ok('readme.txt: no "Level 2", "every transaction", "secure vault", "no card data" or card-brand restriction wording');

// Short description and header: no wallet or pre-order claim.
const short = (readme.match(/^Embedded WooCommerce checkout[^\n]*/m) || [''])[0];
/apple pay|google pay|pre-?order/i.test(short) ? fail('readme.txt short description names wallets or pre-orders') : ok('readme.txt short description: no wallet or pre-order claim');
const main = read('cardz3n-gateway-woocommerce.php');
const headerDesc = main.split('\n').find((l) => /^\s*\* Description:/.test(l)) || '';
/pre-?order/i.test(headerDesc) ? fail('plugin header Description names pre-orders') : ok('plugin header Description: no pre-order claim');

// Subscriptions: never claim a test with the real WooCommerce Subscriptions plugin; say the behaviour is covered by automated stand-in tests.
const subLines = lines.filter((l) => /subscriptions/i.test(l) && /(tested|verified|certified)/i.test(l) && !/(not been tested|not tested|not yet tested|stand-in)/i.test(l));
subLines.length ? fail('readme.txt claims a Subscriptions test: ' + subLines[0].slice(0, 90)) : ok('readme.txt: no claim of a test with the real Subscriptions plugin');
/automated stand-in tests/.test(claims) && /not been tested with the real WooCommerce Subscriptions plugin/.test(claims) ? ok('readme.txt: Subscriptions say stand-in tests only') : fail('readme.txt: the Subscriptions text must say it is covered by automated stand-in tests and not tested with the real plugin');

// The newest changelog entries.
const cl = read('changelog.txt').split(/\n\d{4}-\d{2}-\d{2} - version /)[1] || '';
/pre-?orders?\b/i.test(cl.replace(/(Subscriptions or Pre-Orders|Pre-Orders is active|Pre-Orders active|not on subscription or pre-order carts)/gi, '')) ? fail('changelog.txt (newest entry) claims Pre-Orders') : ok('changelog.txt: newest entry has no Pre-Orders claim');
const cl3 = cl.split('\n').filter((l) => /3-?D Secure/i.test(l));
(cl3.every((l) => /Payer Authentication must be switched on/.test(l) && /are not authenticated/.test(l) && /Required applies to new-card payments only/.test(l) && /Saved cards are not put through 3-D Secure/.test(l)) && !/compliant|compliance|liability|verified on CARDZ3N|SCA\b/i.test(cl3.join(' '))) ? ok('changelog.txt: 3-D Secure appears only with its limits, no compliance claim') : fail('changelog.txt (newest entry) overclaims 3-D Secure');

// README.md
const md = read('README.md');
/pre-?order/i.test(md.split('\n').filter((l) => !/\.php|single purchases on the classic checkout/.test(l)).join('\n')) ? fail('README.md names pre-orders') : ok('README.md: no pre-order claim (only the wallet limit "not offered on subscription or pre-order carts")');
/Level 2|Level II|\bL2\b|every transaction|secure vault|no card data/i.test(md) ? fail('README.md uses retired wording (Level 2, every transaction, secure vault, no card data)') : ok('README.md: no "Level 2", "every transaction", "secure vault" or "no card data" wording');
/Level 2|Level II|\bL2\b/i.test(headerDesc) ? fail('plugin header Description names Level 2') : ok('plugin header Description: no Level 2');
const settingsPhp = read('includes/traits/trait-cardz3n-settings.php');
/Visa retired|every transaction when applicable|Accepted Card Brands/.test(settingsPhp) ? fail('settings text still has the Level 2 sentence, "every transaction" or the "Accepted Card Brands" label') : ok('settings text: no Level 2 sentence, no "every transaction", brand setting is logos only');
const wl = cl.split('\n').filter((l) => /apple pay|google pay/i.test(l) && /(verified|tested)/i.test(l) && !/3-?D Secure/i.test(l)); // entries that say what was verified or tested
(wl.length > 0 && wl.every((l) => /single purchases on the classic checkout, not on subscription or pre-order carts, and was tested once in Test Mode from a mobile device/.test(l) && !/real device/i.test(l))) ? ok('changelog.txt: wallet entries state their limits, no real-device wording') : fail('changelog.txt (newest entry): a wallet entry is missing its limits or says "real device"');

console.log(`\n${failed} problem(s)`);
process.exit(failed ? 1 : 0);
