=== CARDZ3N Gateway for WooCommerce ===
Contributors: cardz3n
Tags: payment gateway, credit card, ach, nmi, apple pay
Requires at least: 6.4
Tested up to: 6.9
Requires PHP: 7.4
Stable tag: 1.0.18
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

= 1.0.18 =
* Change: Enable / Disable now defaults to enabled out of the box so new installs are live as soon as credentials are saved.
* Change: Checkout Title is now locked to “Powered by CARDZ3N”. The settings field is rendered read-only and the runtime value is forced server-side so a merchant can’t accidentally replace the branded label.
* Change: Removed “We never see or store your payment details” from the default Checkout Description to give merchants a cleaner, more flexible default.
* Change: 3D Secure controls renamed for clarity. The section is now “3D Secure 2.0”, the checkbox label reads “Enable 3D Secure 2.0”, and the description explains the merchant value (“3D Secure 2.0 can help you avoid fraudulent transactions by authenticating transactions before submitting them to the gateway for processing.”).
* Change: 3D Secure 2.0 now defaults to OFF so merchants make a conscious decision to enable SCA.
* New: WooCommerce → Payments listing now shows a “Recurring Payments” support badge (small pill with a recurring icon) next to the CARDZ3N Gateway description so merchants can see subscription support at a glance.
* New: Refreshed CARDZ3N brand logo — cleaner card mark with chip and contactless arcs, improved typography, and a brand-blue accent on the “3”. Used wherever “Show CARDZ3N logo only” is selected under Gateway Icon Style.

= 1.0.17 =
* Fix (critical): ACH fields (Name on account, Routing, Account number) would not accept any input. Collect.js mounts its hosted-field iframes by reading the target container's width and height; when the container's parent has `display: none`, the iframe mounts at 0×0 and every click falls through. The Card and ACH panes now share a positioning container and inactive panes are hidden off-screen (absolute position, visibility hidden, opacity 0) instead of `display: none`, so all iframes mount at full size on first render.
* Fix (critical): On the Card tab, Collect.js iframes overflowed their bordered container because the wrapper had internal padding AND the iframe input had its own internal padding. Removed container padding, forced the iframe to fill 100% × 100% inside a clipped wrapper, and moved typography into Collect.js `customCss`. Text now sits cleanly inside each field's rounded border.
* Fix: The "Use a new payment method" radio that WooCommerce auto-injects into saved-token lists is now hidden. Our tabbed UI already separates saved-vs-new selection (Saved tab = pay with stored vault, Card/ACH tab = pay with new and tokenize) so a second "new" radio was redundant and confusing. When the buyer clicks the Saved tab, the first saved token is auto-selected. When they click Card or ACH, any saved selection is cleared so `process_payment()` goes through the Collect.js path.
* Fix: "Payment Token does not exist REFID:..." retries now work. Collect.js tokens are single-use; if the gateway rejected the first attempt, the cached token hidden field was being re-submitted on every retry, yielding the same error. The plugin now listens for WooCommerce's `checkout_error` event and clears the cached token so the next submit re-tokenizes.
* Diagnostic: When the gateway returns "Payment Token does not exist", the plugin logs the first 4 chars of the Security Key, the first 4 chars of the Tokenization Key, and the current Test Mode state, and shows the buyer a plain-English error explaining that the Security Key and Tokenization Key may belong to different merchant accounts. Successful tokenization now also logs the first 8 chars of the Collect.js token for support troubleshooting (no PAN, no PII).
* Tighter layout: saved-payment-method list styled as clean bordered rows with consistent spacing.

= 1.0.16 =
* Fix (critical): Plugin would not activate on 1.0.15 — a PHP docblock comment contained `sandbox_*/live_*`, and the embedded `*/` sequence terminated the docblock early, producing a parse error (`syntax error, unexpected identifier "into"`) that prevented the main plugin file from loading. Rewrote the comment to avoid the `*/` sequence. No functional changes; this is a hotfix for 1.0.15.

= 1.0.15 =
* Fix (critical): "Unable to initialize secure payment form" error that prevented any card or ACH data from being entered. Collect.js was throwing `"You provided too many fields. Unexpected fields for applePay"` because the gateway was passing `type`, `style`, `contactFields`, `emailRequired`, and `buttonColor` keys that Collect.js does not accept. That single `configure()` throw also prevented the `ccnumber` / `ccexp` / `cvv` iframes from rendering, so the entire payment form was dead.
* Fix: `applePay` and `googlePay` Collect.js config objects are now pared down to the minimal documented field set (just `selector`). If `configure()` still throws for any reason, the gateway now retries without the wallet configs so the card form at least renders — a hidden wallet is a better outcome than a broken checkout.
* Change: Collapsed the four-field credential UI (`sandbox_security_key`, `sandbox_tokenization_key`, `live_security_key`, `live_tokenization_key`) into a single **Security Key** + single **Tokenization Key**, because CARDZ3N does not use a separate sandbox portal — Test Mode is a toggle on the same gateway account using the same keys. Merchant-reported requirement.
* Change: Renamed the "Sandbox Mode" toggle to "Test Mode" and clarified that it routes transactions through the CARDZ3N test processor on the same merchant account.
* Migration: Runs once on plugin activation and again (idempotent) on `plugins_loaded` so WP.org auto-updates pick it up. When the new `security_key` is empty, it copies from `sandbox_security_key` (preferred, since Test Mode uses the same keys) or `live_security_key` (fallback). Same logic for the tokenization key. Legacy fields are not deleted — the API client reads unified first with a legacy fallback, so downgrading to 1.0.14 or earlier continues to work.
* Add: Maestro card brand option in Accepted Card Brands.
* Add: Apple Pay and Google Pay SVG logos rendered in the brand-icon row alongside Visa/Mastercard/etc., even on devices that can't display the live wallet button (so buyers on Chrome/Windows see that the gateway accepts Apple Pay).
* UX: Tightened vertical spacing throughout the embedded checkout — reduced padding on tabs, field gaps, and brand-icon gaps; collapsed empty wallet wrappers so there's no phantom blank space when Apple/Google Pay can't render on the buyer's device.

= 1.0.14 =
* Fix (critical): Checkout Block still showed "There are no payment methods available" after 1.0.13. Live DevTools inspection confirmed `cardz3n_gateway_data` wcSetting was still `null`, the Blocks payment registry was empty, and our Blocks JS bundle was never enqueued — even though the classic `assets/js/checkout.js` was loading correctly. After three iterations trying to diagnose why Woo Blocks wasn't picking up our native `AbstractPaymentMethodType` on this stack, 1.0.14 switches strategy entirely.
* Change: `declare_compatibility('cart_checkout_blocks', ..., false)` — the same approach used by production NMI-family gateways like Evergreen Payments Northwest 1.1.0. This tells WooCommerce Blocks to render CARDZ3N via its classic-shortcode compatibility layer. The same `payment_fields()` HTML, `assets/js/checkout.js`, and `process_payment()` server path used on classic shortcode checkouts now renders inside the Block checkout too. Single code path, proven pattern, no hook-timing surface.
* Change: Removed the `woocommerce_blocks_loaded` registration call from plugin bootstrap. The `Blocks_Support` PHP class and `assets/js/blocks/checkout.js` bundle remain in the repo (retained for possible future revival) but are no longer loaded by the runtime.
* No change to classic shortcode checkout, `Gateway::is_available()`, `process_payment()`, refund/capture/void flows, Collect.js tokenization, saved-payment-method UI, subscriptions/pre-orders shims, HPOS compatibility, admin settings UI, or the diagnostic notice introduced in 1.0.11.

= 1.0.13 =
* Fix (critical): Checkout Block *still* showed "There are no payment methods available" after 1.0.12. The 1.0.12 hook-timing theory was wrong — live DevTools inspection on 1.0.12 confirmed our blocks JS bundle was still never enqueued, `wc.wcSettings.getSetting('cardz3n_gateway_data')` still returned null, and the Woo payment store's `getAvailablePaymentMethods()` was still `{}`. The actual bug was in `Blocks_Support::is_active()`, which delegated to `$gateway->is_available()`. Woo Blocks calls `is_active()` very early in the REST prep phase for the checkout — often before `WC()->payment_gateways()->payment_gateways()` has been fully populated by the `woocommerce_payment_gateways` filter. In that window, our `get_gateway()` lookup returned null and `is_active()` returned false, so Woo Blocks never enqueued our JS bundle and our payment method was never registered client-side.
* Fix: `Blocks_Support::is_active()` now only checks the `enabled` toggle (loaded synchronously in `initialize()`). The full availability cascade (HTTPS, credentials, currency/country) is still enforced at `Gateway::is_available()` on the classic checkout and at `Gateway::process_payment()` server-side — nothing insecure slips through.
* Fix: `Blocks_Support::get_payment_method_data()` now falls back to reading directly from `$this->settings` when `get_gateway()` returns null, instead of returning a stub missing `gatewayId` and `tokenizationKey` (the client JS short-circuited on `if ( ! cfg || ! cfg.gatewayId ) return;`).
* Fix: `Blocks_Support::get_supported_features()` returns `['products', 'refunds']` in the early-boot fallback (matches the classic gateway's declared feature set).
* No change to `process_payment()`, capture, void, refund, the classic shortcode checkout, the admin settings UI, or the diagnostic notice introduced in 1.0.11.

= 1.0.12 =
* Attempted fix for the "There are no payment methods available" error on the Checkout Block by registering the Blocks integration directly against `\Automattic\WooCommerce\Blocks\Payments\PaymentMethodRegistry` via the Blocks DI container. The DI-container call is retained as a belt-and-braces alongside the canonical hook-based registration, but it was NOT the root cause of the block-checkout failure. See 1.0.13 for the actual fix.

= 1.0.11 =
* Add: Visible admin-notice diagnostic on the gateway settings page that reports exactly why the gateway is (or is not) appearing on the checkout page. `is_available()` now stores a per-brand reason token in a 5-minute transient; the settings page reads that transient and surfaces one of five statuses with a human-readable fix. Eliminates the "gateway is invisible and no one knows why" support loop.
* Reasons surfaced: `available`, `disabled` (Enabled toggle off), `https_required` (live mode on a non-HTTPS checkout), `no_credentials` (no Security Key for the active mode), `parent_unavailable` (WooCommerce itself rejected the gateway — typically currency/country mismatch).
* No change to payment behavior.

= 1.0.10 =
* Fix: Silence the console error `ApplePayRequest.js:114 Could not create PaymentRequestAbstraction. Please verify the provided options are valid.` that appeared on browsers/devices without Apple Pay or Google Pay runtime support (e.g. Chrome on Windows, Firefox, Linux). We now feature-detect `window.ApplePaySession.canMakePayments()` and `window.google.payments.api.PaymentsClient` before passing each wallet's configuration to `CollectJS.configure()`. The error was non-fatal — the card form rendered correctly anyway — but it looked alarming in dev tools.
* No change to card, ACH, or wallet behavior when the corresponding runtime IS present.

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

= 1.0.18 =
UX polish release. Enable/Disable now defaults to enabled, Checkout Title is locked to “Powered by CARDZ3N”, 3D Secure 2.0 is renamed and now defaults to off, a Recurring Payments support badge is shown on the Payments listing, and the CARDZ3N brand logo has been refreshed. No database changes.

= 1.0.17 =
Recommended upgrade. Fixes ACH fields that refused input, card-tab field overflow, the confusing "Use a new payment method" radio inside saved tokens, and "Payment Token does not exist" retries. Also adds a helpful buyer-facing error and safer support logging when the gateway rejects a token.

= 1.0.16 =
Critical hotfix. 1.0.15 shipped with a PHP parse error that prevented the plugin from activating. Upgrade immediately. No other changes.

= 1.0.15 =
Required upgrade if card or ACH fields weren't accepting input in 1.0.14. Fixes the "Unable to initialize secure payment form" error, collapses the four-field key UI into a single Security Key + Tokenization Key with automatic migration from the old fields, renames Sandbox Mode to Test Mode, adds Maestro/Apple Pay/Google Pay logos in the brand icon row, and tightens spacing in the embedded checkout.

= 1.0.14 =
Fixes "There are no payment methods available" on the WooCommerce Checkout Block for good. We now render CARDZ3N inside the Block via the classic-shortcode compatibility layer — same pattern used by Evergreen Payments Northwest 1.1.0 and other production NMI-family gateways. Recommended upgrade for every site using Cart/Checkout Blocks.

= 1.0.13 =
Critical: fixes the Checkout Block's "There are no payment methods available" that 1.0.12 was supposed to fix but did not. `Blocks_Support::is_active()` was incorrectly delegating to the full classic-checkout availability cascade, which returns false during Woo Blocks' early REST prep phase. Upgrade immediately if you use the Block-based checkout.

= 1.0.12 =
Supersedes 1.0.11 but does not fix the "No payment methods available" issue on the Block-based checkout. Upgrade directly to 1.0.13.

= 1.0.11 =
Adds a visible diagnostic on the gateway settings page so you can see at a glance why the gateway is (or is not) appearing at checkout. Recommended for anyone troubleshooting a "No payment methods available" notice.

= 1.0.10 =
Quality-of-life: suppresses a noisy (non-fatal) Collect.js console error about PaymentRequestAbstraction on browsers without Apple Pay or Google Pay runtime support. No change to payment behavior.

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
