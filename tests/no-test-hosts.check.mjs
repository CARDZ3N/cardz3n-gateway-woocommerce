// Static check (no site needed): released plugin code never names a test or demo gateway host, and never removes the buyer's email from a
// gateway request. The test-only helpers (a host override, dropping the buyer email for NMI's sandbox) live in tests/ and _work/ only.
// Run from the plugin folder: node tests/no-test-hosts.check.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

let failed = 0;
const fail = (m) => { failed++; console.log('FAIL  ' + m); };
const ok = (m) => console.log('PASS  ' + m);
const files = [];
const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) { walk(p); } else if (/\.(php|js)$/.test(p) && !/\.min\./.test(p)) { files.push(p); } } };
['includes', 'assets'].forEach((d) => walk(d));
files.push('cardz3n-gateway-woocommerce.php');

// 1) No test host inside a string literal.
const hostRe = /['"`]https?:\/\/(sandbox|secure)\.(nmi|networkmerchants)\.com/i;
const hits = files.filter((f) => hostRe.test(readFileSync(f, 'utf8')));
hits.length ? fail('released code names a test or demo host in a string: ' + hits.join(', ')) : ok('no sandbox, demo or secure.nmi.com host in any string of the released code');

// 2) The buyer email is never unset or blanked on a gateway request.
const emailRe = /unset\(\s*\$[A-Za-z_>\[\]'"-]*\[\s*['"]email['"]\s*\]|\['email'\]\s*=\s*(''|""|null)\s*;/;
const bad = files.filter((f) => f.endsWith('.php') && emailRe.test(readFileSync(f, 'utf8')));
bad.length ? fail('released code removes or blanks the buyer email: ' + bad.join(', ')) : ok('the released code never removes or blanks the buyer email');
console.log('\n' + failed + ' problem(s)');
process.exit(failed ? 1 : 0);
