# Changelog

All notable changes to CARDZ3N Gateway for WooCommerce will be documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and adheres to [Semantic Versioning](https://semver.org/).

## [1.0.13] — 2026-04-19

### Fixed
- **Critical: Checkout Block *still* showed "There are no payment methods available" after 1.0.12.** The 1.0.12 hook-timing theory was wrong. Live DevTools inspection on 1.0.12 confirmed our Blocks JS bundle (`assets/js/blocks/checkout.js`) was still never enqueued on the checkout page, `wc.wcSettings.getSetting('cardz3n_gateway_data')` still returned `null`, and `wp.data.select('wc/store/payment').getAvailablePaymentMethods()` was still `{}`.
- **Actual root cause:** `Blocks_Support::is_active()` delegated to `$gateway->is_available()`. Woo Blocks calls `is_active()` very early in the REST prep phase for the checkout — often *before* `WC()->payment_gateways()->payment_gateways()` has been populated by the `woocommerce_payment_gateways` filter. In that window, our `get_gateway()` lookup returned null and `is_active()` returned false, so Woo Blocks never enqueued our JS bundle and our payment method was never registered client-side — even though the admin-side diagnostic banner (evaluated in a later, fully-booted context) reported the gateway as "available on the checkout page."

### Fix details
- `Blocks_Support::is_active()` now returns `'yes' === $this->settings['enabled']` only. The settings array is loaded synchronously in `initialize()` before any gateway-registry interaction, so the answer is stable regardless of boot order. The full availability cascade (HTTPS, credentials, currency/country) is still enforced at `Gateway::is_available()` on the classic checkout and at `Gateway::process_payment()` on the server-side — nothing insecure slips through to block-checkout orders.
- `Blocks_Support::get_payment_method_data()` now falls back to reading directly from `$this->settings` when `get_gateway()` returns null, instead of returning a stub missing `gatewayId` and `tokenizationKey`. The client-side IIFE in `assets/js/blocks/checkout.js` does `if ( ! cfg || ! cfg.gatewayId ) return;` at the top, so a stub without `gatewayId` silently short-circuited `registerPaymentMethod()` on exactly those early-REST prep renders.
- `Blocks_Support::get_supported_features()` returns `['products', 'refunds']` in the early-boot fallback (matches the classic gateway's always-declared feature set).

### Unchanged
- `process_payment()`, capture, void, refund, classic shortcode checkout, admin settings UI, diagnostic notice from 1.0.11, DI-container registration path from 1.0.12 (retained as belt-and-braces alongside the canonical `woocommerce_blocks_payment_method_type_registration` hook).

## [1.0.12] — 2026-04-19

### Fixed
- **Critical: "There are no payment methods available" on the WooCommerce Checkout Block.** Even when `Gateway::is_available()` returned true (the 1.0.11 diagnostic confirmed "Gateway is available on the checkout page."), the Block-based checkout still refused to show the gateway. Root cause: our Blocks integration was registered via `add_action('woocommerce_blocks_payment_method_type_registration', ...)` *from inside* our `woocommerce_blocks_loaded` callback. On modern WooCommerce ( ≥ 8.x) the Blocks package iterates the payment method registry during `woocommerce_blocks_loaded` itself, so attaching the registration hook from inside that same callback fires too late — our `Blocks_Support` was instantiated but never added to the registry.
- Observable symptoms before the fix (from a live diagnostic session on 1.0.11):
  - `wc.wcSettings.getSetting('cardz3n_gateway_data')` returned `null`.
  - `Object.keys(window.wc.wcSettings.allSettings).filter(k => /cardz3n/i.test(k))` was `[]`.
  - `wp.data.select('wc/store/payment').getAvailablePaymentMethods()` was `{}`.
  - `assets/js/blocks/checkout.js` was never enqueued on the checkout page (only the classic `assets/js/checkout.js` was), so `wc.wcBlocksRegistry.registerPaymentMethod()` never ran.
- We now register directly against the Blocks DI container via `\Automattic\WooCommerce\Blocks\Package::container()->get( PaymentMethodRegistry::class )` — synchronous, no hook-timing window. The old hook-based path is retained as a fallback for older Blocks versions and is wrapped in a `Throwable` guard so a missing class on older installs never fatals the site.

### Unchanged
- Classic shortcode checkout path.
- Server-side `process_payment()`, refund/capture/void flows, REST endpoints, admin settings, diagnostic notice from 1.0.11.

## [1.0.11] — 2026-04-19

### Added
- **Visible availability diagnostic on the gateway settings page.** When a merchant reports "No payment methods are available at checkout," support previously had to ask the merchant to turn on debug logging, visit the checkout, come back, read `/wp-content/uploads/cardz3n-gw-logs/*.log`, and correlate timestamps. 1.0.11 replaces that with a one-line admin notice on the gateway settings page:
  - `Status: Gateway is available on the checkout page.` (green)
  - `Status: Gateway is NOT appearing on the checkout. The "Enabled" toggle at the top of this page is off.` (yellow)
  - `Status: Gateway is NOT appearing on the checkout. Live mode requires HTTPS...`
  - `Status: Gateway is NOT appearing on the checkout. No Security Key is saved for the currently active mode...`
  - `Status: Gateway is NOT appearing on the checkout. WooCommerce itself is hiding this gateway...`

### Changed
- `Gateway::is_available()` now delegates gate logic to a new `availability_reason()` method that returns one of five machine tokens (`available`, `disabled`, `https_required`, `no_credentials`, `parent_unavailable`). The return value is stored in a per-brand 5-minute transient (`cardz3n_gw_last_avail_{brand}`) so the admin UI can read it without re-evaluating. This also unifies logging — every hide now produces a `Gateway hidden. Reason: ...` log line with a single token.
- The HTTPS check and credentials check are unchanged in behavior from 1.0.9; this is purely a refactor + diagnostic surface.

### Not affected
- Classic and Blocks checkout both call `is_available()` through the same path, so the transient reflects whichever path the shopper is on.
- `process_payment`, capture, void, refund, and the credentials validator are unchanged.

## [1.0.10] — 2026-04-19

### Fixed
- **Silenced `ApplePayRequest.js:114 Could not create PaymentRequestAbstraction` in the browser console.** Collect.js attempts to construct a `PaymentRequestAbstraction` for every wallet in its config, even in browsers/devices that don't expose the corresponding runtime API. That produced a scary-looking `console.error` on Chrome/Windows (no Apple Pay), Firefox (no Apple Pay), Linux (no Apple Pay), and any browser without Google Pay. The error was non-fatal — card and ACH fields rendered and tokenized correctly — but it masked real errors and was noise on every merchant's dev tools.
- Fix: `assets/js/checkout.js` now feature-detects `window.ApplePaySession && window.ApplePaySession.canMakePayments()` and `window.google.payments.api.PaymentsClient` before including each wallet block in the `CollectJS.configure()` call. If the runtime isn't present, that wallet is simply omitted — matching what Collect.js would have done after the throw anyway.

### Not affected
- Wallet behavior is unchanged when the runtime IS present: Apple Pay still renders on Safari/iOS/macOS (with a valid Merchant Domain), Google Pay still renders on Chrome/Android.
- Classic and Blocks checkout both benefit from this fix because the Blocks bundle delegates to the classic bundle's mount function.

## [1.0.9] — 2026-04-19

### Fixed (critical)
- **Checkout showed "No payment methods are available."** Two stacked bugs:

  **Bug 1: Collect.js tokenization key was never attached to its script tag.**
  Collect.js reads its Public Tokenization Key from a `data-tokenization-key`
  attribute on its own `<script>` tag during load. We were enqueueing the
  script via `wp_enqueue_script()` with no attribute and trying to hand the
  key off later through `wp_localize_script()` — which attaches the key to
  a *different* script variable read by our bundle, not by Collect.js.
  Result: Collect.js threw `Config.js:830 Uncaught Error: A tokenization
  key must be provided by including a data-tokenization-key attribute`,
  and no hosted field mounted.

  Fix: the key is now injected as a real HTML attribute via the WordPress
  `script_loader_tag` filter, on both the classic shortcode checkout
  (`includes/class-cardz3n-gateway.php`) and the Blocks checkout
  (`includes/class-cardz3n-blocks-support.php`). We also set
  `data-variant="inline"` so Collect.js mounts hosted fields inside our
  form instead of opening its lightbox.

  **Bug 2: HTTPS detection was wrong behind reverse proxies.**
  `Gateway::is_available()` used `is_ssl()` to enforce the live-mode HTTPS
  requirement. On managed WordPress hosts that terminate TLS at a proxy
  (InstaWP, WP Engine, Kinsta, Cloudflare flexible SSL, basically any host
  with an LB in front), `$_SERVER['HTTPS']` is empty on the internal
  request even when the visitor is clearly on HTTPS. `is_ssl()` returned
  false and the gateway silently hid itself, which Woo surfaced to the
  shopper as "No payment methods are available."

  Fix: use `wc_checkout_is_https()` (a Woo helper that handles proxy cases
  correctly) with a fallback that also honors the `X-Forwarded-Proto`
  request header.

### Changed
- `Gateway::is_available()` now writes a specific Logger::warning line when
  it hides the gateway — one of: disabled toggle, HTTPS gate, or missing
  credentials for the active mode. This turns future "gateway invisible at
  checkout" reports into a one-log-lookup fix.

### Not affected
- No changes to `process_payment`, capture, void, refund, the API client
  endpoints, or the credentials validator.

## [1.0.8] — 2026-04-19

### Fixed (critical)
- **The AJAX action `cardz3n_validate_credentials` was never actually registered on admin-ajax.php requests.** Root cause: `add_action( 'wp_ajax_cardz3n_validate_credentials', ... )` lived inside the `Gateway` class constructor, and `Gateway` is only instantiated by WooCommerce's `woocommerce_payment_gateways` filter — which fires on the Checkout page, the Woo Settings page, and the REST gateways list, but **not** on a plain `admin-ajax.php` POST. WordPress saw an unknown AJAX action, the hook never ran, and the request fell through to the default `wp-auth-check` response with HTTP 400 and body `{"wp-auth-check":true,"server_time":...}`. The browser surfaced this as "Network error."
- **Fix:** Moved both `wp_ajax_cardz3n_validate_credentials` and `wp_ajax_cardz3n_delete_token` hook registrations from `Cardz3n_Gateway\Gateway::__construct()` to `Cardz3n_Gateway\Admin::__construct()`. The Admin singleton is booted directly from the main plugin file's `is_admin()` branch, which returns true on admin-ajax requests as well as regular wp-admin page loads. The handlers are now guaranteed to be reachable on every admin-ajax call.
- **Fix:** Ported the 1.0.7 hardening (cap-check-first, `check_ajax_referer` with `$die=false`, fresh `Api_Client(null)`, HTTP 200 + `success:false` for business-logic failures) to the new Admin-class handler. `ajax_delete_token` also now uses `$die=false` so nonce failures return a clean JSON body.

### Changed
- `Gateway::__construct()` no longer registers any `wp_ajax_*` hooks. A prominent comment documents why — to prevent this regression from coming back.
- The old `Gateway::ajax_validate_credentials()` and `Gateway::ajax_delete_token()` methods remain in place as dead code for now (harmless; not wired to any hook). They will be removed in 1.1.0.

### How this slipped past 1.0.7
1.0.7 patched the handler body (the right fix) but didn't verify the hook was registered on admin-ajax. The fact that `wp_ajax_cardz3n_capture_order` works fine on the order-edit screen (and is registered in Admin, not Gateway) should have been the tell.

## [1.0.7] — 2026-04-19

### Fixed (critical)
- **Admin "Test Credentials" button returned HTTP 400 Bad Request.** The root cause was the AJAX handler (`wp_ajax_cardz3n_validate_credentials`) failing three subtle ways at once:
  1. `check_ajax_referer()` was called with its default arguments, which means it `die()`s with an opaque `-1` text response on nonce failure — the browser saw that as a raw 400 with no parseable JSON body.
  2. The handler constructed `new Api_Client( $this->settings )` from the gateway instance's cached settings, which could be stale relative to what's on disk right after the merchant clicks *Save changes*.
  3. The admin Security Key field masks its value once saved (`type=password` with a masked placeholder), so if any future refactor started trusting POST for the key, it would POST an empty string and the gateway would hard-reject.
- **New handler contract** (`includes/class-cardz3n-gateway.php`):
  1. `current_user_can( 'manage_woocommerce' )` → 403 on fail.
  2. `check_ajax_referer( 'cardz3n_gw_nonce', 'nonce', false )` → 400 with a clean JSON body on fail: `{"success":false,"data":{"msg":"Invalid session. Reload the settings page and try again."}}`.
  3. `new Api_Client( null )` — forces a fresh `get_option( 'woocommerce_{brand}_settings' )` read; POST body is never trusted for credentials.
  4. `has_credentials()` false → HTTP 200 + `success:false` + "Save changes first — no Security Key on file for the active mode."
  5. `validate_credentials()` returns `ok:false` → HTTP 200 + `success:false` + the gateway's own `responsetext` so the admin sees "Invalid security key" instead of "Network error."

### Changed
- Business-logic failures never return non-200 status codes — 400 is reserved for transport/auth problems (nonce/cap), exactly as the JS caller in `assets/js/admin-capture.js` expects.

### Not affected
- No changes to the Classic or Blocks checkout flows, `process_payment()`, capture/void/refund, the API client's endpoints, or the uninstall cleanup.

## [1.0.6] — 2026-04-19

### Fixed (critical)
- **Wrong gateway host.** Every hardcoded `secure.nmi.com` URL in the plugin has been replaced with the CARDZ3N white-label host `z3n.transactiongateway.com`. The merchant reported an HTTP 400 Bad Request on the admin *Test Credentials* button and during live checkout attempts — the root cause was the plugin POSTing to the wrong NMI instance (and, for some diagnostic flows, accidentally hitting `/merchants/login.php`, which is a human login page, not an API endpoint).
  - Transaction API → `https://z3n.transactiongateway.com/api/transact.php`
  - Query API       → `https://z3n.transactiongateway.com/api/query.php`
  - 3-Step Redirect → `https://z3n.transactiongateway.com/api/v2/three-step`
  - Collect.js      → `https://z3n.transactiongateway.com/token/Collect.js`

### Added
- New `Api_Client::COLLECTJS_URL`, `QUERY_URL`, `THREE_STEP_URL` constants plus `Api_Client::collectjs_url()`, `::query_url()`, `::three_step_url()` static helpers — a single source of truth for every external gateway URL.
- New runtime filters for merchants who operate on a different white-label NMI host: `cardz3n_gw_api_endpoint`, `cardz3n_gw_collectjs_url`, `cardz3n_gw_query_url`, `cardz3n_gw_three_step_url`.

### Changed
- Classic checkout (`includes/class-cardz3n-gateway.php`) and Blocks checkout (`includes/class-cardz3n-blocks-support.php`) both now enqueue Collect.js via `Api_Client::collectjs_url()` rather than a hardcoded string.
- `readme.txt` "External Services" section and `docs/INSTALL.md` troubleshooting table updated to reference the CARDZ3N gateway host.
- `LICENSE` attribution note updated to reference the CARDZ3N Collect.js host.

### Not affected
- No changes to the Blocks Checkout integration, HPOS handling, uninstall cleanup, or GPL/licensing.
- No new merchant-facing settings (the new host is the default; filters are opt-in for edge cases).
- WP.org directory assets (icon, banner, 7 screenshots) from 1.0.2 are still current.

## [1.0.5] — 2026-04-18

### Added
- **WooCommerce Cart & Checkout Blocks support.** CARDZ3N Gateway now renders inside the block-based checkout alongside the classic shortcode checkout. The admin-only “may not be compatible with the Checkout block” notice is cleared.
- `includes/class-cardz3n-blocks-support.php`: new `AbstractPaymentMethodType` implementation that registers the gateway with the Blocks payment-method registry. Reuses the existing gateway settings, brand profile, and tokenization key so the block UI and the classic UI share one source of truth.
- `assets/js/blocks/checkout.js`: vanilla-React block bundle (built with `wp.element`, no Webpack required) that renders the method label, icons, and mount node. Reuses the shared `assets/css/checkout.css` so the visual design matches the classic embedded checkout.
- `assets/js/blocks/checkout.asset.php`: hand-maintained WordPress dependency manifest declaring the block bundle's deps (`wp-element`, `wp-html-entities`, `wp-i18n`, `wc-blocks-registry`, `wc-settings`).
- `cardz3n_gw_register_blocks_support()`: fires on `woocommerce_blocks_loaded`, loads the integration class, and registers it with the `woocommerce_blocks_payment_method_type_registration` registry.

### Changed
- `FeaturesUtil::declare_compatibility( 'cart_checkout_blocks', … )` flipped from `false` to `true`.
- `Gateway::process_payment()` normalizes Blocks Checkout POST keys (`cardz3n_payment_kind`, `cardz3n_saved_token_id`, `wc_payment_source=blocks`) onto the classic key shape so a single server-side path serves both checkout UIs.

### Not affected
- Classic shortcode checkout behavior is unchanged.
- No new merchant-facing settings.
- WP.org directory assets (icon, banner, 7 screenshots) from 1.0.2 are still current.

## [1.0.4] — 2026-04-18

### Fixed
- Plugin header: drop the `Domain Path: /languages` header. The plugin does not yet ship any `.po`/`.mo` files, so Plugin Check flagged the directory as nonexistent in the distribution zip. WP.org language packs do not require this header.
- `uninstall.php`: switch the HPOS and payment-token `DELETE` queries to `$wpdb->prepare()` with the `%i` identifier placeholder (WP 6.2+; this plugin requires 6.4+), so `prepare()` itself quotes and escapes the table name. The scanner no longer sees any string-interpolated identifiers.
- `uninstall.php`: the postmeta DELETE also moves from `{$wpdb->postmeta}` interpolation to `%i` for consistency.

### Changed
- `Author:` plugin header shortened from `CARDZ3N Inc (DBA ChargebackZ3N)` to `CARDZ3N`. `LICENSE`, `readme.txt`, `README.md`, and `SECURITY.md` copyright / legal-entity references updated to match.

## [1.0.3] — 2026-04-18

### Fixed
- `uninstall.php`: prefix every local variable with `cardz3n_` to satisfy `WordPress.NamingConventions.PrefixAllGlobals`.
- `uninstall.php`: route transient row deletions through `delete_transient()` / `delete_site_transient()` so the object cache is flushed for each transient, rather than only removing the underlying option rows.
- `uninstall.php`: pass LIKE patterns through `$wpdb->esc_like()` + `$wpdb->prepare()` with `%s` placeholders for the postmeta, HPOS, and payment-token deletes (closes `WordPress.DB.PreparedSQL.InterpolatedNotPrepared`).
- `uninstall.php`: quote validated table identifiers with backticks and document the remaining `phpcs:ignore` lines — uninstall is a one-shot deletion pass where object-cache reads/writes are meaningless and table names are hard-coded internal identifiers verified via `SHOW TABLES`.

## [1.0.2] — 2026-04-18

### Added
- `== Privacy ==` section in `readme.txt` documenting exactly what data is stored on the WP site vs. transmitted to NMI, and the controller/processor relationship.
- `== License ==` section in `readme.txt` and full GPLv2 license text bundled in `LICENSE`, with an explicit attribution note stating that all bundled assets are first-party and GPLv2-or-later, and that no third-party libraries are redistributed inside the package.
- `uninstall.php` that removes plugin options, transients, and (optionally) order meta + saved tokens when the plugin is deleted from **Plugins → Delete**.

### Changed
- `readme.txt` `Contributors` field updated to the `cardz3n` WordPress.org handle.
- Installation instructions corrected to reference the `cardz3n-gateway` plugin folder (matches the WP.org slug).

## [1.0.1] — 2026-04-18

### Fixed
- Escape description output in `Gateway::payment_fields()` to satisfy `WordPress.Security.EscapeOutput`.

### Changed
- Remove deprecated `load_plugin_textdomain()` call; WP.org auto-loads translations since WordPress 4.6.
- Trim `readme.txt` short description to 141 characters (WP.org max is 150).
- Reduce `readme.txt` tags from 10 to the 5-tag maximum.
- Bump `Tested up to` from 6.7 to 6.9.
- Packaging: exclude `.gitignore` and other dotfiles from the distribution zip (WP.org rejects hidden files).

## [1.0.0] — 2026-04-18

### Added
- Initial public release.
- Embedded WooCommerce checkout via NMI Collect.js inline hosted fields.
- Single gateway UI with tabs for **Card**, **ACH / eCheck**, and **Saved** methods.
- Apple Pay and Google Pay wallet buttons inside the gateway panel.
- Saved payment methods (card + ACH) backed by the NMI Customer Vault.
- WooCommerce Subscriptions compatibility (renewals via vault tokens).
- WooCommerce Pre-Orders compatibility.
- Transaction modes: Sale and Authorize-only.
- Manual capture from the order edit screen.
- Auto-capture on configurable order-status change.
- Full and partial refunds, with automatic void-before-refund on unsettled transactions.
- 3-D Secure 2 / SCA support (delegated to gateway rules).
- Dynamic descriptor with optional per-order suffix.
- Card-brand restriction controls.
- Gateway receipts toggle.
- Level 2 / Level 3 commercial-data mapper with merchant-configurable UOM, commodity source, UPC key, and PO field.
- Optional checkout Purchase Order (PO) number field.
- Credential validation "Test" button.
- WooCommerce logger-backed diagnostics (redacted — never logs sensitive payment data).
- HPOS (Custom Order Tables) compatibility declared.
- White-label brand variant for AerospacePay via `CARDZ3N_GW_BRAND` constant.

### Security
- No PAN, CVV, or raw ACH data ever stored locally.
- Private Security Key is server-side only.
- All AJAX endpoints nonce-protected; admin actions gated by `manage_woocommerce`.
- Sensitive fields redacted from logs automatically.
