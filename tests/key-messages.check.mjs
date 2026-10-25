// Static check (no site needed): every message that mentions the wrong kind of public key must also say the right one,
// and no message may use a vendor product name for it.
//
// Rules:
//  1. No "Collect Checkout" / "CollectCheckout" in plugin PHP or JS strings (the wrong key type is called a "hosted-checkout key").
//  2. Every line that mentions `checkout_public_` (the wrong key's prefix), or "hosted-checkout", must also mention "Tokenization"
//     (the key the on-site form needs).
//  3. The Collect.js init notices in assets/js/checkout.js must tell the merchant to use the Tokenization key, never the other kind.
//
// Run from the plugin folder: node tests/key-messages.check.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const files = ['cardz3n-gateway-woocommerce.php', 'assets/js/checkout.js'];
for (const dir of ['includes', 'includes/traits']) {
  for (const f of readdirSync(dir)) { if (f.endsWith('.php')) files.push(join(dir, f)); }
}

let failed = 0;
const fail = (msg) => { failed++; console.log('FAIL  ' + msg); };
let checked = 0;

for (const file of files) {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((line, i) => {
    const where = `${file}:${i + 1}`;
    const isComment = /^\s*(\*|\/\/|\/\*)/.test(line);
    if (!isComment && /Collect\s?Checkout/i.test(line)) { fail(`${where} names a vendor product ("Collect Checkout")`); }
    // Code that merely tests the key prefix, and the log-format string that names a field, are not messages.
    if (!isComment && !/strpos\(|has_checkout_public_key/.test(line) && /(checkout_public_|hosted-checkout)/i.test(line)) {
      checked++;
      if (!/Tokenization/.test(line)) { fail(`${where} mentions the wrong key type but does not say the Tokenization key is needed`); }
    }
  });
}

const js = readFileSync('assets/js/checkout.js', 'utf8');
for (const [name, re] of [['invalid-key notice', /notice = '[^']*not a valid Tokenization key[^']*'/], ['missing-key notice', /notice = '[^']*enter the Tokenization key[^']*'/], ['form-did-not-load error', /showError\('The secure payment form did not load[^']*Tokenization key[^']*'/]]) {
  if (!re.test(js)) { fail(`assets/js/checkout.js: the ${name} does not tell the merchant to use the Tokenization key`); }
}

console.log(`\n${checked} key-type messages checked, ${failed} problem(s)`);
process.exit(failed ? 1 : 0);
