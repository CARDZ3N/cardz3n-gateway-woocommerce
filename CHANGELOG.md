# Changelog

All notable changes to CARDZ3N Gateway for WooCommerce will be documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and adheres to [Semantic Versioning](https://semver.org/).

## [1.0.27] — 2026-04-21

### Fixed
- **Cards rejected with "There was an error processing your order" while ACH worked, in Live Mode, with all four credential fields populated — a root-cause fix, not a workaround.** NMI ships two different public-key products that look superficially similar:
  - A **Public API Key with "Tokenization" scope** (format: `xxxxxx-xxxxxx-xxxxxx-xxxxxx`, four dash-delimited segments) drives inline Collect.js hosted fields — the product this plugin has always used.
  - A **Collect Checkout Key** (format: `checkout_public_<32 hex>`) drives a completely separate NMI product — a hosted-redirect checkout (CollectCheckout.js) that this plugin does NOT use.
  
  The 1.0.24–1.0.26 settings UI, field labels, field descriptions, tokenize-empty notices, and admin-side warning banner all told merchants to paste a `checkout_public_`-prefixed Collect Checkout key into the public-key slot. That advice was exactly backwards. A Collect Checkout key loaded into `data-tokenization-key=` will cause the `ccnumber` / `ccexp` / `cvv` iframes to mount (Collect.js accepts the string), the form appears to work, and tokens are even emitted at submit — but those tokens belong to the Collect Checkout product and `transact.php` cannot redeem them. NMI rejects the sale silently from the merchant's perspective (the generic "There was an error processing your order" comes back). ACH's checkname/checkaba/checkaccount iframes tokenize against a path that happens to still succeed, which is why ACH kept working and cards didn't. Every scope-guidance surface in the plugin has been rewritten to direct merchants to the Public API Key with Tokenization scope. If a `checkout_public_`-prefixed key is detected in the Live Public Key field, `admin_options()` now flags it as wrong-scope at the top of the settings page, and the checkout-time "Payment Token does not exist" live-mode error surfaces a scope-specific explanation instead of the generic message.
- **`payment=creditcard` / `payment=check` body field removed from `transact.php` calls when a Collect.js `payment_token` or a stored `customer_vault_id` is present.** Both reference plugins we compared against — the WPGateways white-labeled CARDZ3N plugin (`cardz3n_request()` / `$payment_args`) and the Evergreen Payments Northwest WooCommerce gateway (`class-wceg-gateway.php` process flow) — omit the `payment` key when posting a token. NMI infers the instrument from the token itself; sending `payment=creditcard` alongside a token NMI classifies otherwise is a request-shape mismatch that can cause card charges to reject while ACH passes. The `payment` field is still sent when the request is a raw-PAN submission (neither a token nor a vault ID present).

### Notes for support
- Merchants on 1.0.24–1.0.26 whose card processing stopped working should replace the `checkout_public_...` value in `WooCommerce → Payments → CARDZ3N → Live Public Key` with their Public API Key from NMI scoped "Tokenization" (four-segment dash format). The plugin no longer asks for a Collect Checkout key anywhere.
- The `cardz3n_gw_api_endpoint`, `cardz3n_gw_collectjs_url`, `cardz3n_gw_query_url`, and `cardz3n_gw_three_step_url` filters remain available as escape hatches for merchants on non-standard NMI hosts.

## [1.0.21] — 2026-04-20

### Fixed
- **ACH fields still didn’t accept input after 1.0.20 — cross-origin iframe event misrouting.** The 1.0.20 `applePay` removal fixed the `CollectJS.configure()` throw and got all six Collect.js iframes to mount, but ACH name / routing / account fields still rejected keystrokes. Live Playwright diagnostic confirmed the sequence: the iframes load at 346–704px wide, `.cardz3n-pane[data-pane="ach"]` is `.is-active` with `pointer-events:auto`, `document.elementFromPoint()` returns the ACH iframe at the top of the stack. But `page.mouse.click()` lands focus on the ACH iframe while `page.keyboard.type()` never reaches its input — the card pane’s `ccnumber` iframe at the same coordinates intercepts keydown. Chromium and WebKit route keydown to the z-order top cross-origin iframe, which is the inactive pane’s iframe. `visibility:hidden` + `pointer-events:none` on the outer pane stops hit-testing on the container but not on nested cross-origin iframes. 1.0.21 applies the HTML `inert` attribute (plus `aria-hidden="true"`) to every inactive pane in both the initial PHP render and the JS tab switcher, which removes every descendant (including iframes) from focus/hit-test. Grid-stack layout is preserved so Collect.js still mounts iframes at the correct width on first render.
- **“Payment details could not be tokenized. Please try again.”** was a downstream symptom — `$_POST['cardz3n_payment_token']` was empty at `process_payment()` because Collect.js never received digits in its fields. Fixed by the `inert` change above.
- **`data-cardz3n-version` attribute on `.cardz3n-gateway-ui`** was dropped between 1.0.19 and 1.0.20. Restored. Support can now confirm the running build at the checkout via that attribute AND via the localized `CARDZ3N_GW.version`.

### Changed
- **`enable_level3` default is now `no`.** Level 2/3 commercial-card interchange optimization requires meaningful catalog metadata (UPC, commodity code, tax amount). When enabled without that metadata, the processor can DOWNGRADE interchange rather than improve it. Merchants who know they qualify enable it intentionally on `WooCommerce → Payments → CARDZ3N`.
- **`enable_po_field` default is now `no`.** Purchase Order number is a B2B/procurement feature that adds clutter to a retail checkout. Off by default; B2B stores enable it intentionally.

### Reference — How stored cards are retrieved and used
- **Save at checkout:** when the buyer is logged in and checks “Save this card for faster checkout next time.” the form submits `wc-cardz3n_gateway-new-payment-method=true`. `process_payment()` detects this via `$should_vault_card`, sends `vault=add_customer` with the single-use Collect.js `payment_token` to `transact.php`, and the gateway responds with a `customer_vault_id`. `Token_Service::save_card_token($user_id, $gateway_id, $vault_id, $card_info)` persists that as a `WC_Payment_Token_CC` whose primary token is the `customer_vault_id` and whose metadata stores last4, brand, exp_month, exp_year. The identical flow works for ACH via `Token_Service::save_ach_token()` → `WC_Payment_Token_ECheck`.
- **Retrieve on subsequent checkout:** on render, `payment_fields()` calls WooCommerce’s `get_tokens()` for the current user + gateway. If any exist, the **Saved** tab appears and is auto-selected; each saved token renders as a radio under its own `<input name="wc-cardz3n_gateway-payment-token">`. The card brand, last4, and expiry come from token metadata, not from NMI — no network call at render time.
- **Charge a saved method:** when the buyer submits with a saved-token radio selected, `process_payment()` loads `WC_Payment_Tokens::get( $payment_token_id )`, verifies the token belongs to the current user and to this gateway, pulls `cardz3n_vault_id` metadata (fallback to the token’s primary key), and calls `transact.php` with `customer_vault_id=<id>` instead of `payment_token`. No Collect.js interaction is required on that pageview — saved-method submits never hit the hosted-field iframes.
- **Delete a saved method:** from `My Account → Payment methods`, `Token_Service::delete_token($token_id)` calls `Api_Client::delete_vault($vault_id)` which posts `customer_vault=delete_customer&customer_vault_id=<id>` to NMI, then removes the local `WC_Payment_Token`. If the remote delete fails the local token is still removed and a warning is logged — avoids leaving an orphan row the buyer can’t get rid of.

## [1.0.20] — 2026-04-20

### Fixed
- **Card and ACH fields rejected all input with “Unable to initialize secure payment form”.** Live-checkout diagnostic (Playwright + DevTools console) showed Collect.js throwing `You provided too many fields. Unexpected fields for applePay` during `CollectJS.configure()`. NMI’s current Collect.js build at `z3n.transactiongateway.com/token/Collect.js` rejects the documented `{selector: '.cardz3n-applepay-button'}` shape for the `applePay` / `googlePay` config blocks, and the throw prevented the `ccnumber` / `ccexp` / `cvv` / `checkname` / `checkaba` / `checkaccount` iframes from completing their event wiring — so the fields rendered but were non-interactive. A card-only fallback that rebuilt `collectConfig` without those keys also threw the same error (Collect.js appears to retain bad state after a failed configure call). 1.0.20 drops the `applePay` / `googlePay` blocks from the config entirely. Card and ACH iframes now initialize on the first pass; the retry path has been removed.

### Added
- **“Save this card for faster checkout next time.”** Opt-in checkbox on the Card tab for logged-in buyers with tokenization support. Submits the existing `wc-cardz3n-new-payment-method` field, so the 1.0.17 `process_payment()` path that vaults `customer_vault_id` via `Token_Service::save_card_token()` already picks it up. Matches the `wc-cardz3n-new-ach-method` checkbox that ACH already had.
- **First-order Save visibility fix.** The existing ACH “Save this bank account for future orders.” checkbox, and the new Card Save checkbox, now render for any logged-in buyer whose gateway supports tokenization — not only for buyers who already have a saved token. The prior `$show_saved` gate meant the first order (when the buyer has no tokens yet) never got the save prompt, so the buyer could never save their first card.
- **Higher-fidelity payment-brand SVGs.** `icon_cc_visa.svg`, `icon_cc_mastercard.svg`, `icon_cc_amex.svg`, `icon_cc_discover.svg`, `icon_cc_maestro.svg`, `icon_cc_jcb.svg`, `icon_cc_diners.svg`, `icon_cc_ach.svg`, `icon_wallet_applepay.svg`, and `icon_wallet_googlepay.svg` redrawn using brand-accurate geometry on a unified 38×24 canvas with a 3px-rounded white (or brand-colored) field, replacing the 1.0.15-era colored rectangles.
- **UnionPay** added to the `allowed_card_brands` settings option and shipped as `icon_cc_unionpay.svg`.
- **Version-mismatch admin notice** on the Plugins list and on the WooCommerce → Payments tab. When `CARDZ3N_GW_VERSION` (filesystem) differs from the stored `cardz3n_gw_version` option (written on activation), the notice tells the merchant to deactivate and reactivate the plugin to finish the upgrade. A new `admin_init` hook also syncs the stored value on every admin load so WP.org auto-updates clear the notice on the next page view without a manual deactivate/reactivate cycle.
- **`CARDZ3N_GW.version`** now included in the localized script, and **`data-cardz3n-version="<CARDZ3N_GW_VERSION>"`** now stamped on `.cardz3n-gateway-ui`, so support can confirm the actually-serving build at the checkout without FTP access.

### Changed
- **Native wallet buttons (Apple Pay / Google Pay) temporarily suspended** in the checkout UI pending migration to a dedicated PaymentRequest / Apple Pay JS flow. The brand row still advertises wallet support so buyers know the merchant accepts them, but the clickable wallet buttons are not rendered. The `enable_apple_pay` / `enable_google_pay` settings continue to control the brand-row icons.

## [1.0.19] — 2026-04-20

### Fixed
- **Saved payments tab rendered empty.** On the checkout form the "Saved" tab appeared for every logged-in buyer, even when they had no saved tokens for this gateway, so the panel rendered as a blank box. `payment_fields()` now counts the customer's tokens up front with `\WC_Payment_Tokens::get_customer_tokens( get_current_user_id(), $this->id )` and only exposes the tab when that array is non-empty. When tokens do exist, the Saved tab becomes the default active tab (instead of Card), the active-pane class is applied to `.cardz3n-pane[data-pane="saved"]`, and the hidden `cardz3n_payment_source` input is initialized to `saved` so `process_payment()` takes the tokenized path without the buyer clicking anything.
- **ACH fields still refused input after the 1.0.17 fix.** The 1.0.17 off-screen positioning (`position: absolute; left: -9999px`) put inactive panes in a detached coordinate space, and because their parent `.cardz3n-panes` had no intrinsic width, the absolutely-positioned children measured out at the wrapper's shrink-to-fit width rather than the checkout column width. Collect.js mounted the `checkname` / `checkaba` / `checkaccount` iframes at the wrong dimensions and key events fell through. `.cardz3n-panes` is now a CSS Grid stack — `display: grid; grid-template-areas: "stack"` with every `.cardz3n-pane` mapped to the `stack` area — so every pane is laid out at the real checkout-column width on first render and stays there. Inactive panes are hidden via `opacity: 0; visibility: hidden; pointer-events: none` (never `display: none`, never absolute), so Collect.js can still measure them and buyers can't tab into hidden fields.

### Changed
- **Restored the four-field credential UI.** Reverted the 1.0.15 collapse to a single Security Key + single Tokenization Key. CARDZ3N DOES issue separate Test and Live keys; the earlier merchant clarification that was the basis for the collapse was wrong. Settings now expose `live_security_key`, `live_tokenization_key`, `test_security_key`, and `test_tokenization_key`. The `test_mode` toggle selects which pair the API client uses at runtime.
- **`Api_Client::security_key()` / `Api_Client::tokenization_key()` resolution order rewritten.** New order for each call, walking the first non-empty value:
  1. `test_*` when `test_mode` is on, else `live_*`.
  2. Legacy `sandbox_*` when `test_mode` is on (pre-1.0.15 installs).
  3. Unified `security_key` / `tokenization_key` (1.0.15–1.0.18 installs).
  4. Opposite-mode `live_*` / `test_*` as a last-resort fallback so a misconfigured site surfaces a gateway-side auth error rather than an empty-key error.
- **Dynamic Descriptor default is now blank.** Previously pre-filled with the brand name (`CARDZ3N` / `AEROSPACEPAY`), which meant every new install shipped a statement descriptor the merchant had not reviewed. Leaving it blank defers to the processor-assigned descriptor on the MID; merchants can still type their own value.

### Migration
- `cardz3n_gw_maybe_migrate_settings()` rewritten to be bidirectional and idempotent. It still runs once on activation and again on every `plugins_loaded` for WP.org auto-update safety.
  - **1.0.15→1.0.19 path:** when `live_security_key` is empty but the unified `security_key` is set, copy unified → live. Same for tokenization. Rationale: merchants on 1.0.15–1.0.18 were using their one pair as the live pair against the live processor, so the unified value belongs in the live slot, not the test slot.
  - **Pre-1.0.15 path:** when `test_security_key` is empty but `sandbox_security_key` is set, copy sandbox → test. Same for tokenization.
  - **Legacy `security_key` / `tokenization_key` backfill** is still performed last, so any downstream code that reads the unified fields keeps working.
  - `sandbox_mode` → `test_mode` rename preserved, unchanged from 1.0.15.
  - Never clobbers existing values and never deletes legacy fields — downgrading to an earlier version continues to work.

## [1.0.18] — 2026-04-19

### Changed
- **Enable / Disable now defaults to enabled.** New installs are live as soon as the merchant saves credentials, matching merchant expectations for a paid gateway plugin.
- **Checkout Title is locked to "Powered by CARDZ3N".** The settings input is rendered `readonly` and the runtime value is forced server-side via `$this->title = __( 'Powered by CARDZ3N', ... )` in the constructor, so a merchant hacking around the readonly attribute or editing the options row directly still shows the branded label to buyers. The field description explains the lock.
- **Checkout Description default no longer contains "We never see or store your payment details."** New default: `Pay securely with a credit/debit card, ACH, Apple Pay, or Google Pay.`
- **3D Secure labels rewritten.** Section renamed from `3-D Secure 2 / SCA` to `3D Secure 2.0`. Checkbox label rewritten from `Attempt 3DS2 authentication when the gateway/account supports it.` to `Enable 3D Secure 2.0`. Added explanatory description: `3D Secure 2.0 can help you avoid fraudulent transactions by authenticating transactions before submitting them to the gateway for processing.`
- **3D Secure 2.0 now defaults to `no`.** Merchants make a conscious, informed choice to enable SCA.

### Added
- **Recurring Payments support badge** on the WooCommerce → Payments listing row. Rendered as a small pill (recurring glyph + "Recurring Payments" label) appended to `method_description`. The glyph is an inline SVG encoded as a `data:` URI on a `<span>` background-image so it survives WooCommerce's `wp_kses_post()` pass on method descriptions.
- **Refreshed CARDZ3N brand logo** (`assets/img/logo-cardz3n.svg`). Previous logo was a simple rect with two white bars; new logo is a gradient card mark with chip, contactless arcs, and a matching drop shadow, paired with an Inter 800 wordmark and a brand-blue accent on the "3". Used everywhere "Show CARDZ3N logo only" is selected under Gateway Icon Style.

## [1.0.17] — 2026-04-19

### Fixed
- **Critical: ACH fields accepted no input.** Collect.js mounts its hosted-field iframes by reading the target container's bounding box; when the container's parent is `display: none` (as our inactive panes were), the iframe mounts at 0×0 and every click falls through to empty space. Panes now share a `.cardz3n-panes` positioning context and inactive panes are hidden off-screen (`position: absolute; left: -9999px; visibility: hidden; opacity: 0`) instead of `display: none`, so all four ACH iframes (`checkname`, `checkaba`, `checkaccount`) and the three card iframes mount at full width on first render.
- **Critical: Card-tab fields overflowed their bordered containers.** The wrapper had `padding: 0 10px` AND the iframe's inner input had its own padding; the iframe was positioned at 100% of the wrapper's content-box, so the visible border was inset 10px on each side and the typed characters scrolled past it. Removed wrapper padding, forced iframes to fill the container with `width/height: 100%` and `overflow: hidden`, and left Collect.js's `customCss` to style typography.
- **"Use a new payment method" radio inside saved tokens.** WooCommerce's `saved_payment_methods()` auto-injects a "new" radio at the bottom of the token list, duplicating the Card tab's purpose. Hidden via CSS. When the buyer clicks the Saved tab, the first non-`new` token radio is auto-selected; when they click Card or ACH, any token radio selection is cleared (or forced to `new` if present) so `process_payment()` goes through the Collect.js tokenized path.
- **"Payment Token does not exist REFID:..." on retry.** Collect.js tokens are single-use. If the gateway rejected the first attempt, WooCommerce kept re-submitting the same cached token on every retry, producing the same error. The plugin now listens for WooCommerce's `checkout_error` event and clears `cardz3n_payment_token` + `cardz3n_token_type` hidden fields so the next submit re-tokenizes.

### Added
- Buyer-facing plain-English error when the gateway returns "Payment Token does not exist" — tells them to refresh and retry, and mentions that a mismatched Security Key / Tokenization Key pair is the likely root cause for the merchant.
- Support diagnostic logging: on every token submission, the plugin logs the first 8 chars of the Collect.js token, the first 4 chars of the Security Key, the first 4 chars of the Tokenization Key, and the current Test Mode state. No full tokens or keys are logged; `Logger::redact()` scrubs PII from all transaction logs.
- Saved-payment-method list visually restyled as clean bordered rows.

## [1.0.16] — 2026-04-19

### Fixed
- **Critical: plugin would not activate on 1.0.15.** A PHP docblock in `cardz3n-gateway-woocommerce.php` contained the literal string `sandbox_*/live_*`. The embedded `*/` sequence terminated the docblock early, producing `syntax error, unexpected identifier "into"` and preventing the entire main plugin file from loading. WordPress's activation safe-mode then refused activation. Rewrote the comment to spell out `sandbox_* and live_*` without the `*/` sequence and linted every PHP file in the distribution to confirm no other occurrences.

### Changed
- No functional changes. 1.0.16 is a hotfix for 1.0.15 only.

## [1.0.15] — 2026-04-19

### Fixed
- **Critical: "Unable to initialize secure payment form."** Card and ACH fields accepted no input in 1.0.14. Live DevTools diagnostic revealed Collect.js was throwing `You provided too many fields. Unexpected fields for applePay` because we were passing `type`, `style`, `contactFields`, `emailRequired`, and `buttonColor` to its `applePay`/`googlePay` config — all keys Collect.js rejects. That single `configure()` throw also blocked the `ccnumber` / `ccexp` / `cvv` iframes from rendering, so the entire form was dead.
- `applePay` and `googlePay` config objects now contain only `selector` (the minimal documented field set).
- Added a defensive fallback: if `configure()` still throws for any reason (e.g. Collect.js updates on NMI's side that change accepted fields), the plugin retries `configure()` without the wallet configs so the card form at least renders. A hidden wallet is a better outcome than a broken checkout.

### Changed
- **Collapsed four-field credential UI into two fields.** `sandbox_security_key`, `sandbox_tokenization_key`, `live_security_key`, and `live_tokenization_key` are replaced by a single `security_key` + single `tokenization_key`, because CARDZ3N has no separate sandbox portal — Test Mode is a toggle on the same gateway account using the same keys. Merchant-reported requirement.
- Renamed the "Sandbox Mode" toggle to "Test Mode" and clarified the inline help text.
- Tightened vertical spacing in the embedded checkout — reduced tab padding, field gaps, and brand-icon gaps; collapsed empty wallet wrappers so there's no phantom blank space when Apple/Google Pay can't render on the buyer's device.
- Brand-icon row now always surfaces Apple Pay and Google Pay logos when those methods are enabled in settings, even on devices that can't render the live wallet button (so buyers on Chrome/Windows see the gateway accepts Apple Pay).

### Added
- Maestro card brand option in Accepted Card Brands.
- `assets/img/icon_cc_maestro.svg`, `assets/img/icon_wallet_applepay.svg`, `assets/img/icon_wallet_googlepay.svg`.
- One-shot settings migration (`cardz3n_gw_maybe_migrate_settings`) that runs on plugin activation and on every `plugins_loaded` as a safety net for WP.org auto-updates. Populates `security_key` / `tokenization_key` from the legacy `sandbox_*` fields first, falling back to `live_*`. Renames `sandbox_mode` → `test_mode`. Idempotent and non-destructive: legacy fields are left in place so downgrading to 1.0.14 or earlier continues to work.

### API compatibility
- `Api_Client::security_key()` and `Api_Client::tokenization_key()` now read the unified `security_key` / `tokenization_key` first, then fall back to `sandbox_*` or `live_*` depending on current Test Mode state. No breaking change for existing installs.
- `Gateway::is_available()` now checks the unified `test_mode` option with a `sandbox_mode` fallback for the HTTPS-gate live-mode check.

## [1.0.14] — 2026-04-19

### Fixed
- **Critical: Checkout Block still showed "There are no payment methods available" on 1.0.13.** Live DevTools inspection on 1.0.13 confirmed `cardz3n_gateway_data` wcSetting was still `null`, `blocksRegistry` was empty, and our Blocks JS bundle was never enqueued — even though the classic `assets/js/checkout.js` was loading correctly. After three iterations (1.0.11 diagnostic banner, 1.0.12 DI-container registration, 1.0.13 `is_active()` fallback), it became clear that something upstream of our `Blocks_Support` registration was preventing Woo Blocks from picking up our `AbstractPaymentMethodType` on this stack.
- **Strategy change:** rather than continue debugging the native Blocks PaymentMethodType integration, 1.0.14 switches to the same approach used by production NMI-family gateways like Evergreen Payments Northwest 1.1.0 — declare `cart_checkout_blocks` feature compatibility as `false`, which tells WooCommerce Blocks to render our gateway via the classic-shortcode compatibility layer. The same `payment_fields()` HTML, `assets/js/checkout.js`, and `process_payment()` server path used for classic shortcode checkouts now renders *inside* the Block checkout too. Single code path, proven pattern, no hook-timing surface.

### Changed
- `declare_compatibility('cart_checkout_blocks', ..., false)` (was `true`).
- `woocommerce_blocks_loaded` registration call removed from `cardz3n_gw_bootstrap()`.
- `cardz3n_gw_register_blocks_support()` function removed from the main plugin file (the `Blocks_Support` class and `assets/js/blocks/checkout.js` bundle are retained in the tree for possible future revival but are no longer loaded by the runtime).

### Unchanged
- Classic shortcode checkout continues to work exactly as before.
- `Gateway::is_available()`, `Gateway::process_payment()`, refund/capture/void flows, Collect.js tokenization, saved-payment-method UI, subscriptions/pre-orders shims, HPOS compatibility, admin settings UI, diagnostic notice from 1.0.11.

### Notes
- The 1.0.11 diagnostic banner on the gateway settings page remains useful for verifying `is_available()` still passes HTTPS/credentials/currency checks on the site.
- User-reported bug that finally resolved this: Test Mode uses the SAME Security Keys as live (there is no separate sandbox portal). The current four-field UI (sandbox + live key pairs) is still misleading and will be collapsed to a single Security Key + single Tokenization Key in a follow-up release with a migration that merges sandbox→live when live is empty.

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
