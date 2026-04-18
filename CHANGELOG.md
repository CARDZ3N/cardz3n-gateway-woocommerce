# Changelog

All notable changes to CARDZ3N Gateway for WooCommerce will be documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and adheres to [Semantic Versioning](https://semver.org/).

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
