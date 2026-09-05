=== CARDZ3N Gateway for WooCommerce ===
Contributors: jbenedetti, cardz3n
Tags: payment gateway, credit card, ach, nmi, apple pay
Requires at least: 6.4
Tested up to: 7.1
Requires PHP: 7.4
Stable tag: 1.0.47
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Embedded WooCommerce checkout via CARDZ3N / NMI. Card, ACH, Apple Pay, Google Pay, saved methods, subscriptions, refunds, and Level 2/3 data.

== Description ==

CARDZ3N Gateway for WooCommerce turns your WooCommerce store into a full-featured embedded checkout powered by the CARDZ3N / NMI payment platform.

Buyers stay on your site — no visible redirect — and can choose between **credit/debit cards, ACH bank payments, Apple Pay, Google Pay, or a saved payment method** inside a single gateway UI. All sensitive payment data is tokenized in the browser by NMI's Collect.js library, so card numbers and bank account numbers never touch your WordPress server.

B2B merchants benefit from **automatic Level 2 and Level 3 commercial-card data** — freight, tax, line-item, UPC, commodity code, PO number, and destination fields are populated from WooCommerce order data on every transaction.

= Key features =

* Embedded, on-site checkout — no redirect
* Credit / debit card, ACH / eCheck, Apple Pay, Google Pay — all in one gateway UI
* Saved payment methods (card + ACH) with NMI Customer Vault
* WooCommerce Subscriptions compatibility (if installed)
* WooCommerce Pre-Orders compatibility (if installed)
* Authorize-only + manual capture, void, full and partial refunds
* Auto-capture on order-status change
* 3-D Secure 2 / SCA
* Dynamic descriptor with optional per-order suffix
* Card-brand restrictions
* Automatic Level 2 / Level 3 data pass-through
* Optional checkout Purchase Order (PO) number field
* Merchant-visible diagnostics in WooCommerce → Status → Logs

== Privacy ==

This plugin processes payment data on behalf of the store owner. Here is exactly what it stores and what leaves your server:

**Stored on your WordPress site (per order):**

* Card last 4 digits, brand, and expiry month/year — used to display saved methods and receipts.
* NMI Customer Vault ID — an opaque reference (not the actual card or account number) used to charge saved methods.
* NMI transaction ID, auth code, AVS/CVV response codes — used for refunds, reconciliation, and support.
* For ACH: bank name and last 4 digits of the account number (never the routing number or full account number).

**Never stored on your WordPress site:**

* Full Primary Account Number (PAN), full ACH account number, routing number, or CVV. These are tokenized by NMI Collect.js in the buyer's browser before the form is submitted. Your server never receives them.
* Your NMI Security Key is stored only in WordPress options and is never sent to the browser.

**What is sent to external services:**

* To NMI Collect.js (browser-side): your public Tokenization Key, order total, buyer billing info as entered at checkout. Collect.js returns a one-time payment token.
* To the NMI Transaction API (server-side): your Security Key, the payment token or vault ID, order amount, buyer billing/shipping address, line items, and Level 2/3 commercial-card fields when enabled.

**Controller / processor relationship:** The store owner is the data controller. CARDZ3N / NMI acts as the payment processor. Buyers should be informed via the store's own privacy policy that card and ACH data is transmitted to NMI for processing.

Data retention on your WordPress site follows your WooCommerce order retention settings. To remove all plugin settings on uninstall, the plugin ships an `uninstall.php` that deletes its options automatically when deleted via **Plugins → Delete**.

== External services ==

This plugin connects to two external CARDZ3N / NMI services to process payments:

1. **CARDZ3N Collect.js** (https://z3n.transactiongateway.com/token/Collect.js) — JavaScript library loaded in the buyer's browser at checkout from the CARDZ3N gateway host (a white-labeled NMI instance). It securely tokenizes card / ACH / wallet payment details into a one-time `payment_token`. No sensitive data is sent to your WordPress server.
* Terms of service: https://www.nmi.com/terms/
* Privacy policy: https://www.nmi.com/privacy/

2. **CARDZ3N Transaction API** (https://z3n.transactiongateway.com/api/transact.php) — server-side endpoint called by your WordPress site to execute charges, captures, voids, and refunds using the Collect.js token and your private Security Key. This is the white-labeled CARDZ3N gateway host; the plugin never calls `secure.nmi.com`.
* Terms of service: https://www.nmi.com/terms/
* Privacy policy: https://www.nmi.com/privacy/

Your private Security Key is stored in WooCommerce gateway settings and is only used server-to-server. Your public Tokenization Key is exposed to the browser (as designed by NMI) to drive Collect.js.

== Installation ==

1. Upload the plugin ZIP via **Plugins → Add New → Upload Plugin**, or extract into `wp-content/plugins/cardz3n-gateway`.
2. Activate the plugin.
3. Go to **WooCommerce → Settings → Payments** and click **CARDZ3N Gateway**.
4. Enter your sandbox or live **Security Key** and **Tokenization Key** from your CARDZ3N / NMI Merchant Portal (Settings → Security Keys).
5. Enable the payment methods you want — Cards, ACH, Apple Pay, Google Pay — and save.
6. Click **Test Credentials** to confirm the gateway accepts your keys.
7. Run a sandbox transaction end-to-end before going live.

== Frequently Asked Questions ==

= Does this plugin store credit card numbers on my site? =

No. Card, ACH, and wallet data are tokenized by NMI Collect.js in the buyer's browser. Your WordPress server only receives a short-lived `payment_token` which is exchanged server-side for a charge. Your database stores only non-sensitive metadata (last 4 digits, expiry, brand) and the NMI Customer Vault ID for tokenized reuse.

= Do I need a separate plugin for Apple Pay or Google Pay? =

No. Both wallets are included and ride on the same CARDZ3N gateway panel. Eligibility is auto-detected by device and browser.

= Does it support WooCommerce Subscriptions? =

Yes, when the WooCommerce Subscriptions extension is installed. Renewals are charged server-side against the customer vault ID stored on the parent order.

= What is Level 3 data and why does it matter? =

Level 3 is the enhanced transaction data (line items, freight, tax, destination, commodity codes, UPC, PO number) that Visa and Mastercard commercial-card programs require for the lowest interchange rates. This plugin maps WooCommerce order data to the NMI Level 3 payload automatically on every transaction.

= Does it work with HPOS (High-Performance Order Storage)? =

Yes. HPOS compatibility is declared on plugin boot.

== License ==

CARDZ3N Gateway for WooCommerce is licensed under the GNU General Public License v2.0 or later (GPL-2.0-or-later). The full license text ships with the plugin as `LICENSE` and is also available at https://www.gnu.org/licenses/gpl-2.0.html.

All PHP, JavaScript, CSS, and image assets bundled inside this plugin are first-party works authored by CARDZ3N and are released under the same GPLv2-or-later license. No third-party code or media libraries are redistributed inside the plugin package. The NMI Collect.js tokenization script is loaded at runtime from the payment processor's own servers and is not included in this distribution.

== Screenshots ==

1. Embedded checkout — Card, ACH, Apple Pay, Google Pay, and saved methods in one gateway panel.
2. ACH / eCheck tab — routing + account number fields tokenized by Collect.js.
3. Mobile checkout — Apple Pay and Google Pay wallet buttons above the card form.
4. Saved payment methods — returning customers pick a stored card or bank account.
5. Gateway settings — Security Key, Tokenization Key, environment, and Test Credentials button.
6. Commercial data settings — Level 2/3 defaults for UOM, commodity code, tax, and freight.
7. Order edit screen — capture, void, and refund directly from the WooCommerce order.

== Changelog ==

= 1.0.47 =
* Fixed a white-label gap in the 1.0.46 fix (flagged by Devin Review): the settings-option-key lookup for native Blocks checkout was rebuilt from the CARDZ3N_GW_BRAND constant plus a hardcoded '_gateway' suffix, which breaks for any white-label partner overriding gateway_id via the cardz3n_gw_brand_profile filter (their settings save under a different option than this code reads). Now resolves the option key through Brand::id() (which honors that filter), loading the Brand class on demand since it isn't guaranteed loaded yet at this early hook.

= 1.0.46 =
* Fixed the actual root cause of the native Blocks checkout never registering, on any store, since this feature's introduction in 1.0.42: the option-key lookups in the plugin bootstrap (deciding whether to declare cart_checkout_blocks compatibility, and whether to register Blocks_Support at all) read from 'woocommerce_cardz3n_settings' -- a key that never existed -- instead of the correct 'woocommerce_cardz3n_gateway_settings'. This silently made the "Native Block Checkout (Experimental)" setting a no-op regardless of whether a merchant checked it: WooCommerce always saw it as disabled, declared no Blocks compatibility, and never attempted to register a payment method for the block checkout, producing WooCommerce's own "may not be compatible with the Checkout block" notice and no available payment methods. Every fix in 1.0.43-1.0.45 was correct but could never actually be exercised until this was found.

= 1.0.45 =
* Fixed native Blocks checkout detection for good: the 1.0.44 fix (WooCommerce's own CartCheckoutUtils::is_checkout_block_default()) still returned a false negative on this store's block/FSE theme, because the Checkout block lived in a page-checkout.html theme template that was never customized/saved to the database. Removed the whole "predict whether this is a Blocks page" approach: the classic and native-Blocks integrations now share one script handle, and the shared checkout.js module detects Blocks mode by checking WooCommerce Blocks' own settings registry directly (wc.wcSettings.getSetting) instead of a custom flag, which cannot lose a print-order race the way the previous approach could.

= 1.0.44 =
* Fixed native Blocks checkout detection on block/FSE themes: the classic-checkout-skip logic added in 1.0.43 checked only the Checkout page's own content for the Checkout block, which misses block themes that place the Checkout block in a page-checkout.html theme template instead. Switched to WooCommerce's own CartCheckoutUtils::is_checkout_block_default(), which correctly checks block templates first. This was why `isBlocksCheckout` still read undefined after the 1.0.43 fix on a block-theme store.

= 1.0.43 =
* Fixed native Blocks checkout (experimental setting): the classic checkout script was being enqueued a second time on Blocks-checkout pages, overwriting the Blocks-specific gateway configuration with the classic one — this made `isBlocksCheckout` (and Blocks-only behavior gated on it) unreliable even with the setting correctly enabled.
* Fixed a hang in Blocks checkout when Collect.js's tokenization request timed out — the checkout previously waited indefinitely instead of surfacing the timeout error.
* Fixed the Blocks checkout payment method staying selectable when no tokenization key was configured or both Cards and ACH were disabled — it's now hidden in that state, matching classic-checkout availability rules.

= 1.0.42 =
* New (experimental, opt-in): Native WooCommerce Cart & Checkout Blocks integration, disabled by default. Enable via the new "Native Block Checkout" setting to test on your store. Off by default, checkout continues to render through the classic-shortcode compatibility layer exactly as before. Live-tested successfully (Visa and Mastercard, both approved) on a demo store before release.

= 1.0.41 =
* Fixed a WooCommerce Marketplace QIT Validation Test error: 'WC tested up to' header declared 9.5, an unsupported major version. Bumped to 11.1, the current WooCommerce major.

= 1.0.40 =
* Fixed two PHP 8.4 deprecation warnings flagged by WooCommerce Marketplace's QIT Code Compatibility Test: the `$settings` constructor parameter in the API client and Level 3 mapper classes was implicitly nullable (typed `array $settings = null`), which PHP 8.4 deprecates in favor of an explicit `?array $settings = null`. No behavior change.

= 1.0.39 =
* Fixed Level 3 merchant postal-origin field name: `ship_from_postal` → `ship_from_postal_code` (confirmed with NMI support).

= 1.0.38 =
* Neutral (non-branded) checkout title changed from "Credit Card" to "Check Out".

= 1.0.37 =
* Checkout title now defaults to "Credit Card" instead of "Powered by CARDZ3N"; a new, unchecked-by-default setting lets merchants opt in to CARDZ3N branding at checkout. Also sanitizes POST field names before they reach diagnostic log output.

= 1.0.36 =
* Shortened the 1.0.18 Upgrade Notice entry, which Plugin Check flagged as exceeding the 300-character limit once combined with its header line.

= 1.0.35 =
* Fixed all WordPress.org Plugin Check findings from the 1.0.34 submission: missing direct-file-access guard, unescaped HTML in translatable strings, an externally-hosted script missing an explicit version, and an oversized Changelog/Upgrade Notice.

= 1.0.34 =
* Saved Payment Methods, Subscriptions, and Pre-Orders now default off with CARDZ3N-account setup notes; fixed the same 1.0.33 runtime bug for these three; fixed Apple Pay/Google Pay account wording.

= 1.0.33 =
* Apple Pay, Google Pay, and ACH now default off and stay off at runtime (fixed hardcoded fallback); added merchant-portal setup notes; removed a leftover debug image.

= 1.0.32 =
* Payment method now shows the real card brand instead of the generic "Credit Card" label, on classic and Block checkout, including saved cards.

= 1.0.31 =
* Order screens/emails/admin now show the actual payment method used; fixed credential autofill cross-fill; real logo option; renamed Level 2/3 to Level 3/CEDP with new fields.

= 1.0.30 =
* Merged the 1.0.29 wallet fix forward; repo-wide coding-standards cleanup. No merchant-facing change.

= 1.0.29 =
* Restored native Apple Pay/Google Pay buttons (malformed Collect.js config); coding-standards cleanup.

= 1.0.28 =
* Critical: fixed card sales rejected by "Custom descriptors not allowed"; added opt-in Dynamic Descriptor setting (off by default).

= 1.0.27 =
* Critical: fixed Live-Mode card failures from inverted public-key-scope guidance; labels now point to the correct Tokenization-scope key.

= 1.0.26 =
* Added admin warning banner for credential mismatches, a "TEST MODE ACTIVE" checkout banner, and a sharper test/live key error.

= 1.0.25 =
* Critical: fixed token fields reordering out of the form on some hosts (caused "could not be tokenized"); fixed tab-switch glitches; added diagnostics.

= 1.0.24 =
* Clarified Live/Test key labels to match the Merchant Portal; added a watchdog for tokenization-key errors.

= 1.0.23 =
* Critical: fixed ACH fields silently discarding input (focus/iframe issue); card brands now default to all eight supported.

= 1.0.22 =
* Critical: fixed tokenize failures from duplicate submit handlers, a credential-mixing bug, and ACH lockup after failed submit; refreshed brand artwork.

= 1.0.21 =
* Critical: fixed ACH fields not accepting input from overlapping iframes (fixed with `inert`); Level 2/3 and PO fields default off.

= 1.0.20 =
* Critical: fixed card/ACH fields rejecting input from an invalid wallet config; added "save this card/bank" checkboxes and a version-mismatch banner.

= 1.0.19 =
* Critical: fixed Saved-tab and ACH layout bugs; restored separate Test/Live key pairs; Dynamic Descriptor now blank by default.

= 1.0.18 =
* Enable/Disable now defaults on; Checkout Title locked; 3D Secure renamed and defaults off; added a Recurring Payments badge and refreshed logo.

= 1.0.17 =
* Fixes ACH input rejection, card-tab overflow, a confusing saved-token radio, and failed-token retries; clearer errors and logging.

= 1.0.16 =
* Critical hotfix: fixed a PHP parse error in 1.0.15 that blocked activation. No functional changes.

= 1.0.15 =
* Fixes "Unable to initialize secure payment form"; merges four key fields into one Security + Tokenization Key; adds wallet icons.

= 1.0.14 =
* Fixes "no payment methods available" on the Checkout Block for good via the classic-shortcode compatibility layer.

= 1.0.13 =
* Critical: actually fixes the Block "no payment methods available" error that 1.0.12 didn't (wrong availability check timing).

= 1.0.12 =
* Attempted (didn't fix) the Block "no payment methods available" error via a DI-container registration. See 1.0.13.

= 1.0.11 =
* Added a visible admin diagnostic explaining why the gateway is or isn't appearing at checkout.

= 1.0.10 =
* Quality-of-life: silenced a non-fatal wallet console error on browsers without wallet support.

= 1.0.9 =
* Critical: fixed "No payment methods are available"; tokenization key now set correctly; live-mode HTTPS check now works behind proxies.

= 1.0.8 =
* Critical: fixed the admin "Test Credentials" AJAX action never being registered, causing HTTP 400.

= 1.0.7 =
* Critical: fixed the "Test Credentials" button returning HTTP 400; clearer error messages.

= 1.0.6 =
* Critical: switched every gateway URL to the CARDZ3N white-label host, fixing HTTP 400 errors.

= 1.0.5 =
* Added full WooCommerce Cart & Checkout Blocks compatibility.

= 1.0.4 =
* Docs/compliance fixes for WP.org: dropped unused header, hardened uninstall.php queries.

= 1.0.3 =
* uninstall.php coding-standards cleanup for WP.org compliance.

= 1.0.2 =
* Added Privacy and License sections; added uninstall.php cleanup.

= 1.0.1 =
* Minor WP.org compliance fixes. No merchant-facing changes.

= 1.0.0 =
* Initial release. Embedded Collect.js checkout -- Card, ACH, Apple Pay, Google Pay, saved methods, Subscriptions/Pre-Orders, refunds, Level 2/3 data, 3DS2/SCA, HPOS.

== Upgrade Notice ==

= 1.0.42 =
Adds an optional, off-by-default "Native Block Checkout" experimental setting. No change to default behavior unless you enable it. Safe to update.

= 1.0.41 =
Updates the declared 'WC tested up to' version from 9.5 to 11.1 (current WooCommerce major). No functional change. Safe to update.

= 1.0.40 =
Fixes two PHP 8.4 compatibility warnings (implicitly nullable constructor parameters). No behavior change. Safe to update.

= 1.0.39 =
Fixes a Level 3 field name (ship_from_postal_code) so merchant postal-origin data reaches NMI correctly. Safe to update.

= 1.0.38 =
Wording-only change: the default (non-branded) checkout title is now "Check Out" instead of "Credit Card". Safe to update.

= 1.0.37 =
Checkout title now defaults to "Credit Card"; "Powered by CARDZ3N" branding is opt-in via a new, unchecked setting. Also fixes a log-sanitization issue flagged by WordPress.org review. Safe to update.

= 1.0.36 =
Readme-only fix: shortened an Upgrade Notice entry that exceeded WordPress.org's length limit. No code changes -- safe to update.

= 1.0.35 =
Fixes WordPress.org Plugin Check findings (a missing security guard, escaping, and versioning issues) with no settings, database, or checkout behavior changes. Safe to update.

= 1.0.31 =
Order screens, emails, and confirmations now show the real payment method (ACH or card brand). Adds optional Level 3/CEDP fields (Customer Code, Duty Amount, VAT). No settings or checkout changes -- safe to update.

= 1.0.30 =
Maintenance release. Carries the 1.0.29 Apple Pay / Google Pay restoration forward and completes the coding-standards cleanup that 1.0.29 flagged as follow-up work. No settings, database, or checkout behavior changes -- safe to update.

= 1.0.29 =
Recommended upgrade. Restores native Apple Pay and Google Pay wallet buttons (removed since 1.0.20). Also fixes an admin-notice output-escaping finding and includes a repo-wide coding-standards cleanup -- no settings or database changes.

= 1.0.19 =
Recommended upgrade. Fixes the empty Saved tab, restores ACH input (for real this time), restores the separate Test and Live credential pairs that CARDZ3N actually issues, and blanks the Dynamic Descriptor default. Settings migrate automatically — no re-entry required.

= 1.0.18 =
UX polish release: sane defaults, locked Checkout Title, renamed 3D Secure (off by default), Recurring Payments badge, refreshed logo. No database changes.

= 1.0.17 =
Fixes ACH fields rejecting input, card-tab overflow, a confusing radio in saved tokens, and false "Payment Token does not exist" retries. Adds clearer buyer-facing errors and safer support logging. Recommended upgrade.

= 1.0.16 =
Critical hotfix. 1.0.15 shipped with a PHP parse error that prevented the plugin from activating. Upgrade immediately. No other changes.

= 1.0.15 =
Required if card/ACH fields stopped accepting input in 1.0.14. Fixes "Unable to initialize secure payment form," merges the four key fields into one Security Key + Tokenization Key (auto-migrated), and adds Maestro/Apple Pay/Google Pay icons.

= 1.0.14 =
Fixes "no payment methods available" on the Checkout Block for good, by rendering CARDZ3N via the classic-shortcode compatibility layer. Recommended for every site using Cart/Checkout Blocks.

= 1.0.13 =
Critical: actually fixes the Checkout Block's "no payment methods available" error that 1.0.12 didn't. Blocks_Support::is_active() wrongly used the classic-checkout cascade during Woo Blocks' early REST phase. Upgrade immediately if using Blocks.

= 1.0.12 =
Supersedes 1.0.11 but does not fix the "No payment methods available" issue on the Block-based checkout. Upgrade directly to 1.0.13.

= 1.0.11 =
Adds a visible diagnostic on the gateway settings page so you can see at a glance why the gateway is (or is not) appearing at checkout. Recommended for anyone troubleshooting a "No payment methods available" notice.

= 1.0.10 =
Quality-of-life: suppresses a noisy (non-fatal) Collect.js console error about PaymentRequestAbstraction on browsers without Apple Pay or Google Pay runtime support. No change to payment behavior.

= 1.0.9 =
Critical: fixes checkout showing "No payment methods are available." Collect.js now gets its tokenization key as a proper attribute, and the live-mode HTTPS check now works behind reverse proxies. Upgrade immediately.

= 1.0.8 =
Critical: the 1.0.7 admin "Test Credentials" fix was architecturally incomplete — the AJAX action was never being registered on admin-ajax.php requests. This release moves the hook registration into the Admin bootstrap so the handler actually runs. Upgrade immediately.

= 1.0.7 =
Critical: fixes the HTTP 400 Bad Request on the admin "Test Credentials" button. The validator now reads the Security Key from saved settings (the form masks it once saved) and returns real error messages instead of a blank network failure. Upgrade immediately.

= 1.0.6 =
Critical: switches every gateway URL to the CARDZ3N white-label host (z3n.transactiongateway.com). Fixes HTTP 400 Bad Request on Test Credentials and live checkout failures. Upgrade immediately.

= 1.0.5 =
Adds WooCommerce Cart & Checkout Blocks support — CARDZ3N now works on both classic shortcode and the new block-based checkout. Clears the admin "may not be compatible" notice.

= 1.0.4 =
Quiets the last three WP Plugin Check warnings (domain path + two prepared-SQL identifier findings). No runtime behavior changes.

= 1.0.3 =
Hardens `uninstall.php` for WP Plugin Check: prefixed variables, prepared LIKE patterns, documented DB suppressions. No runtime behavior changes.

= 1.0.2 =
Adds privacy disclosure, uninstall cleanup, and WP.org metadata polish. No merchant-facing behavior changes.

= 1.0.1 =
Minor compliance fixes for WP.org plugin directory submission. No merchant-facing changes.

= 1.0.0 =
Initial public release.
