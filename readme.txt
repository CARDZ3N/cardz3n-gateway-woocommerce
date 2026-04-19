=== CARDZ3N Gateway for WooCommerce ===
Contributors: cardz3n
Tags: payment gateway, credit card, ach, nmi, apple pay
Requires at least: 6.4
Tested up to: 6.9
Requires PHP: 7.4
Stable tag: 1.0.9
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

Data retention on your WordPress site follows your WooCommerce order retention settings. To remove all plugin settings on uninstall, the plugin ships an \`uninstall.php\` that deletes its options automatically when deleted via **Plugins → Delete**.

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

= 1.0.9 =
* Fix (critical): Checkout page was showing "No payment methods are available" and the browser console reported `Config.js:830 Uncaught Error: A tokenization key must be provided by including a data-tokenization-key attribute`. Two independent bugs were stacked on top of each other.
* Fix (critical): Collect.js requires its Public Tokenization Key to be supplied as a `data-tokenization-key` attribute on its own `<script>` tag — passing it through `wp_localize_script` is too late and Collect.js throws during load. The attribute is now injected via the WordPress `script_loader_tag` filter on both the classic shortcode checkout and the Blocks checkout paths. We also add `data-variant="inline"` so Collect.js mounts hosted fields inside our form instead of firing the lightbox.
* Fix (critical): `Gateway::is_available()` was using WordPress's `is_ssl()` to enforce the live-mode HTTPS requirement. On hosts that terminate TLS at a reverse proxy (InstaWP, WP Engine, Cloudflare flexible SSL, most managed WP hosts), `is_ssl()` returns false even though the visitor is on HTTPS, which silently hid the gateway from the checkout. We now prefer `wc_checkout_is_https()` (which is proxy-aware) with a fallback that also honors `X-Forwarded-Proto: https`.
* Change: `is_available()` now logs the specific reason when it hides the gateway (no credentials, HTTPS gate, disabled toggle), making future "gateway is invisible" reports a one-log-lookup fix instead of a guessing game.

= 1.0.8 =
* Fix (critical): The `cardz3n_validate_credentials` AJAX action was never actually being registered with WordPress on admin-ajax.php requests. The hook lived in the Gateway class constructor, which only runs when WooCommerce builds its `woocommerce_payment_gateways` list — a step that does not happen on a bare admin-ajax.php request. WordPress saw an unknown action and fell through to the default auth-check response with HTTP 400, which the browser surfaced as "Network error." Moved both `wp_ajax_cardz3n_validate_credentials` and `wp_ajax_cardz3n_delete_token` registrations into the `Cardz3n_Gateway\Admin` bootstrap, which runs on every admin request (including admin-ajax), guaranteeing the handlers are always reachable.
* Fix: `wp_ajax_cardz3n_delete_token` now uses `check_ajax_referer( ..., $die=false )` for the same reason as 1.0.7's validator fix — returns a clean JSON body on nonce failure instead of dying with `-1`.

= 1.0.7 =
* Fix (critical): Admin "Test Credentials" button no longer returns HTTP 400 Bad Request. The `wp_ajax_cardz3n_validate_credentials` handler has been rewritten to (a) run the capability check before the nonce check, (b) return a clean JSON body with a 400 status when the nonce is stale instead of dying with WordPress's default `-1` text response, and (c) load the Security Key directly from the saved gateway options (`woocommerce_{cardz3n|aerospacepay}_gateway_settings`) instead of trusting the POST body — the admin form masks the key once saved, so the browser was POSTing an empty string.
* Fix: Business-logic failures on Test Credentials (no key on file, gateway rejection, transport error) now return HTTP 200 with `success:false` and a human-readable `data.msg`, so the admin UI shows the real reason instead of a generic "Network error."
* Change: `Api_Client` is now constructed with `null` in the validate-credentials flow so it re-reads settings from the options table on every click — this guarantees freshly saved keys are picked up without a page reload.
* No changes to the checkout, payment, capture, void, or refund flows.

= 1.0.6 =
* Fix (critical): Point every gateway call at the CARDZ3N white-label host. Transaction API, Query API, 3-Step Redirect, and Collect.js now resolve to `https://z3n.transactiongateway.com/...` instead of `secure.nmi.com`. This clears the HTTP 400 Bad Request observed on the "Test Credentials" admin button and on live checkout attempts.
* Add: `cardz3n_gw_api_endpoint`, `cardz3n_gw_collectjs_url`, `cardz3n_gw_query_url`, and `cardz3n_gw_three_step_url` filters so merchants on a different white-label NMI host can override the defaults without patching the plugin.
* Add: `Api_Client::collectjs_url()`, `::query_url()`, `::three_step_url()` static helpers — single source of truth for every external gateway URL.
* Change: Classic checkout and Blocks checkout both now enqueue Collect.js via `Api_Client::collectjs_url()` rather than a hardcoded string.
* Docs: readme.txt External Services section + docs/INSTALL.md troubleshooting updated to reference the CARDZ3N gateway host.

= 1.0.5 =
* Add: Full compatibility with the WooCommerce Cart & Checkout Blocks. CARDZ3N Gateway now renders inside the block-based checkout and the admin-only “may not be compatible with the Checkout block” notice no longer appears.
* Add: Blocks payment-method registration via `AbstractPaymentMethodType` — card, ACH, Apple Pay, Google Pay, and saved methods are all available in both classic and block checkouts from a single code path.
* Add: Dedicated `assets/js/blocks/checkout.js` bundle (vanilla React via `wp.element`, no build step) with a hand-maintained `checkout.asset.php` dependency manifest.
* Fix: Flip the `cart_checkout_blocks` FeaturesUtil compatibility declaration from `false` to `true`.
* Fix: `process_payment()` now normalizes the Blocks Checkout POST payload (`cardz3n_payment_kind`, `cardz3n_saved_token_id`, `wc_payment_source=blocks`) onto the classic key shape so one server-side flow serves both UIs.

= 1.0.4 =
* Fix: Plugin header — drop the `Domain Path` header so Plugin Check stops flagging the missing `languages/` folder (no translations are shipped yet; WordPress auto-loads translations from WP.org regardless).
* Fix: uninstall.php — switch the HPOS and payment-token DELETE queries to `$wpdb->prepare()` with the `%i` identifier placeholder, so the scanner never sees string interpolation of a table name.
* Change: Author header shortened to `CARDZ3N`.

= 1.0.3 =
* Fix: uninstall.php PHPCS cleanup — prefix all local variables with `cardz3n_` to satisfy `WordPress.NamingConventions.PrefixAllGlobals`.
* Fix: uninstall.php — route transient deletes through `delete_transient()` / `delete_site_transient()` so object caches flush cleanly.
* Fix: uninstall.php — pass LIKE patterns through `$wpdb->esc_like()` + `$wpdb->prepare()` for the postmeta / HPOS / payment-token deletes.
* Docs: uninstall.php — document the `phpcs:ignore` suppressions (uninstall is a one-shot pass where caching is meaningless and table names are validated internal identifiers).

= 1.0.2 =
* Add: == Privacy == section documenting what data is stored and transmitted.
* Add: == License == section and full GPLv2 license text bundled in `LICENSE`.
* Add: uninstall.php to clean plugin options when the plugin is deleted.
* Fix: update WP.org contributor handle and correct the installation path reference.

= 1.0.1 =
* Fix: escape description output in payment_fields() to satisfy WPCS.
* Change: remove deprecated load_plugin_textdomain() call (WP auto-loads since 4.6).
* Docs: trim short description to ≤150 chars; reduce tags to 5; bump Tested up to 6.9.

= 1.0.0 =
* Initial release.
* Embedded checkout via NMI Collect.js inline hosted fields.
* Card, ACH, Apple Pay, Google Pay in a single gateway UI.
* Saved payment methods (card + ACH) via NMI Customer Vault.
* WooCommerce Subscriptions + Pre-Orders compatibility.
* Refund, void, manual capture, auto-capture on status change.
* Level 2 / Level 3 commercial-data mapper.
* 3DS2/SCA, dynamic descriptor, card-brand restrictions, receipts toggle.
* HPOS compatibility declared.

== Upgrade Notice ==

= 1.0.9 =
Critical: fixes two defects that together caused the checkout to show "No payment methods are available." (1) Collect.js now receives its tokenization key as a proper `data-tokenization-key` attribute on its `<script>` tag. (2) The live-mode HTTPS check now works correctly behind reverse proxies (InstaWP, WP Engine, Cloudflare, etc.). Upgrade immediately.

= 1.0.8 =
Critical: the 1.0.7 admin "Test Credentials" fix was architecturally incomplete — the AJAX action was never being registered on admin-ajax.php requests. This release moves the hook registration into the Admin bootstrap so the handler actually runs. Upgrade immediately.

= 1.0.7 =
Critical: fixes the HTTP 400 Bad Request on the admin "Test Credentials" button. The validator now reads the Security Key from saved settings (the form masks it once saved) and returns real error messages instead of a blank network failure. Upgrade immediately.

= 1.0.6 =
Critical: switches every gateway URL to the CARDZ3N white-label host (z3n.transactiongateway.com). Fixes HTTP 400 Bad Request on Test Credentials and live checkout failures. Upgrade immediately.

= 1.0.5 =
Adds WooCommerce Cart & Checkout Blocks support — CARDZ3N now works on both classic shortcode and the new block-based checkout. Clears the admin “may not be compatible” notice.

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
