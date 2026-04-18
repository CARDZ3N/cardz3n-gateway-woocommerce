# Changelog

All notable changes to CARDZ3N Gateway for WooCommerce will be documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and adheres to [Semantic Versioning](https://semver.org/).

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
