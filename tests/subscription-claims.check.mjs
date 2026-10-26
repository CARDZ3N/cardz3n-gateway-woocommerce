// Static check (no site needed): until renewal and pre-order release payments are verified with this gateway, no public text may say
// that subscriptions, pre-orders or recurring payments work.
//
// Run from the plugin folder: node tests/subscription-claims.check.mjs
import { readFileSync } from 'node:fs';

let failed = 0;
const fail = (m) => { failed++; console.log('FAIL  ' + m); };
const ok = (m) => console.log('PASS  ' + m);

const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const readme = read('readme.txt');
const upToChangelog = readme.split('== Changelog ==')[0]; // the changelog keeps its history; everything above it is today's text

// 1. Short description, feature list and description: no subscription or pre-order claims.
const faqStart = upToChangelog.indexOf('== Frequently Asked Questions ==');
// The Privacy and External services sections are data-processing disclosures (they say when the gateway is called, which stays true while the setting exists), so they are not claims.
const aboveFaq = upToChangelog.slice(0, faqStart).replace(/== Privacy ==[\s\S]*?== Installation ==/, '== Installation ==');
/subscri|pre-?order|recurring/i.test(aboveFaq) ? fail('readme.txt: the short description, description or feature list still mentions subscriptions, pre-orders or recurring payments') : ok('readme.txt: no subscription, pre-order or recurring claim above the FAQ');

// 2. The FAQ answer says "not yet" and does not say "Yes".
const faq = upToChangelog.slice(faqStart);
const m = faq.match(/= Does it support WooCommerce Subscriptions[^=]*=\n\n([^\n]+)/);
(m && /^Not yet\./.test(m[1]) && /not been verified/i.test(m[1])) ? ok('readme.txt FAQ: subscriptions answer is "Not yet" and says renewals are not verified') : fail('readme.txt FAQ: the subscriptions answer must start with "Not yet." and say renewals are not verified');
// Any other FAQ mention of subscriptions must be a negative statement.
const otherFaq = faq.replace(/= Does it support WooCommerce Subscriptions[^=]*=\n\n[^\n]+\n/, '');
/subscri|pre-?order|recurring/i.test(otherFaq) ? fail('readme.txt FAQ: another answer mentions subscriptions, pre-orders or recurring payments') : ok('readme.txt FAQ: no other subscription claim');

// 3. README.md and the plugin header.
const readmeMd = read('README.md');
/Subscriptions[^\n]*native support/i.test(readmeMd) ? fail('README.md still says native subscriptions support') : ok('README.md: no "native support" claim');
const main = read('cardz3n-gateway-woocommerce.php');
const header = main.split('\n').find((l) => /^\s*\* Description:/.test(l)) || '';
/subscri|recurring/i.test(header) ? fail('plugin header Description mentions subscriptions or recurring payments') : ok('plugin header Description: no subscription claim');

// 4. No "Recurring Payments" badge or wording in the plugin's own strings.
const gateway = read('includes/class-cardz3n-gateway.php');
/__\(\s*'Recurring Payments'/.test(gateway) ? fail('the "Recurring Payments" badge string is still in the gateway class') : ok('no "Recurring Payments" badge string');

// 5. The two settings are labelled as not yet supported.
const settings = read('includes/traits/trait-cardz3n-settings.php');
(/Subscriptions Support \(not yet supported\)/.test(settings) && /Pre-Orders Support \(not yet supported\)/.test(settings)) ? ok('settings: both switches are titled "(not yet supported)"') : fail('settings: both switches must be titled "(not yet supported)"');

console.log(`\n${failed} problem(s)`);
process.exit(failed ? 1 : 0);
