# WordPress.org Plugin Submission Checklist

Everything below must be green before submitting **CARDZ3N Gateway for WooCommerce** to [wordpress.org/plugins](https://wordpress.org/plugins/developers/add/).

---

## 0. Pre-flight — account & legal

- [ ] WordPress.org account created and email verified for the submitter
- [ ] Plugin slug reserved / available: `cardz3n-gateway-woocommerce`
- [ ] Plugin name not trademarked by a third party (CARDZ3N is our mark)
- [ ] GPLv2-or-later compatible (confirmed in `LICENSE` + plugin header)
- [ ] All third-party code (SVG icons, JS, CSS) is GPLv2-compatible or authored by us
- [ ] Privacy Policy URL reachable and referenced in `readme.txt` (External services section)

## 1. Plugin header (`cardz3n-gateway-woocommerce.php`)

- [ ] `Plugin Name:` — human-readable, matches directory listing
- [ ] `Plugin URI:` — canonical marketing page
- [ ] `Description:` — one sentence, no marketing fluff, < 150 chars
- [ ] `Version:` matches `readme.txt` `Stable tag` and `CARDZ3N_GW_VERSION` constant
- [ ] `Requires at least: 6.4`
- [ ] `Requires PHP: 7.4`
- [ ] `Tested up to:` within one minor version of current WP release
- [ ] `Requires Plugins: woocommerce`
- [ ] `WC requires at least: 8.0`
- [ ] `WC tested up to:` current stable WC
- [ ] `License: GPLv2 or later`
- [ ] `License URI:` present
- [ ] `Text Domain: cardz3n-gateway`
- [ ] `Domain Path: /languages`

## 2. `readme.txt` (WP.org format)

- [ ] Header: `=== CARDZ3N Gateway for WooCommerce ===`
- [ ] `Contributors:` uses WordPress.org usernames (not emails)
- [ ] `Tags:` ≤ 5, relevant (`woocommerce, payment gateway, nmi, ach, credit card`)
- [ ] `Requires at least`, `Tested up to`, `Stable tag`, `Requires PHP`, `License` all present
- [ ] Short description ≤ 150 chars
- [ ] `== Description ==` covers what it does, supported payment methods, requirements
- [ ] `== Installation ==` step-by-step
- [ ] `== Frequently Asked Questions ==` at least 5 entries
- [ ] `== Screenshots ==` captions match `assets/screenshot-*.png` (see §7)
- [ ] `== Changelog ==` has an entry for `= 1.0.0 =`
- [ ] `== Upgrade Notice ==` entry for `= 1.0.0 =` (≤ 300 chars)
- [ ] **External services disclosure** present — lists NMI, Collect.js, Apple Pay, Google Pay with purpose, data sent, TOS + Privacy URLs

## 3. Code quality

- [ ] No PHP notices/warnings with `WP_DEBUG` on a clean Woo install
- [ ] PHPCS clean against `WordPress` + `PHPCompatibilityWP` (7.4–8.3)
- [ ] All AJAX endpoints use nonces + capability checks
- [ ] All DB queries use `$wpdb->prepare()` — no raw interpolation
- [ ] All output is escaped (`esc_html`, `esc_attr`, `esc_url`, `wp_kses_post`)
- [ ] All input is sanitized (`sanitize_text_field`, `absint`, `wc_clean`, etc.)
- [ ] Uninstall cleanup via `uninstall.php` or `register_uninstall_hook` (options, transients) — add if missing
- [ ] No `eval`, `create_function`, `assert`, `exec`, `shell_exec`, `passthru`, `system`, `popen`
- [ ] No bundled `vendor/` unless stripped / namespaced
- [ ] No minified JS/CSS without source files alongside
- [ ] No remote code loading — only Collect.js + Apple/Google Pay SDKs from documented URLs

## 4. Security & payments

- [ ] No full PAN, CVV, or raw account/routing number written to logs, order notes, or DB
- [ ] NMI `security_key` never sent to the browser — only the public `tokenization_key`
- [ ] Card data tokenized by Collect.js hosted fields — plugin never touches PAN
- [ ] All `transact.php` calls are HTTPS with `sslverify=true`
- [ ] Refund / void / capture endpoints gated behind `manage_woocommerce` capability
- [ ] AJAX nonces for: credential test, capture authorized, vault delete
- [ ] Replay guard on checkout submit (duplicate-submit lock)
- [ ] Logger redacts PAN, CVV, account, routing, and full security key

## 5. WooCommerce integration

- [ ] Registered via `woocommerce_payment_gateways` filter
- [ ] HPOS declared via `FeaturesUtil::declare_compatibility('custom_order_tables')`
- [ ] Cart / checkout blocks compatibility declared (or gracefully disabled if classic-only)
- [ ] Subscriptions: renewal payments route through saved token + Vault
- [ ] Pre-Orders: charge-upon-release path tested
- [ ] Refund flow supports partial + full, with void-first fallback on unsettled
- [ ] Order meta uses `_cardz3n_*` prefix; no meta leaked into customer-visible areas

## 6. Internationalization & accessibility

- [ ] All user-facing strings wrapped in `__()` / `_e()` / `esc_html__()` with `cardz3n-gateway`
- [ ] `languages/cardz3n-gateway.pot` generated with `wp i18n make-pot`
- [ ] Checkout form labels have proper `<label for>` bindings
- [ ] Focus order matches visual order; tab order works through hosted fields
- [ ] Color contrast ≥ 4.5:1 on checkout and admin UI
- [ ] Error messages announced to screen readers (`role="alert"` / `aria-live`)

## 7. Plugin directory assets (NOT shipped in the zip)

These live in a separate `assets/` directory committed to the `trunk` SVN but served from the directory listing page.

- [ ] `assets/icon-128x128.png` (or `.svg`)
- [ ] `assets/icon-256x256.png`
- [ ] `assets/banner-772x250.png`
- [ ] `assets/banner-1544x500.png` (hi-dpi)
- [ ] `assets/screenshot-1.png` — Embedded checkout (card tab)
- [ ] `assets/screenshot-2.png` — Embedded checkout (ACH tab)
- [ ] `assets/screenshot-3.png` — Apple Pay / Google Pay wallet buttons
- [ ] `assets/screenshot-4.png` — Saved payment methods
- [ ] `assets/screenshot-5.png` — Admin settings (Credentials section)
- [ ] `assets/screenshot-6.png` — Admin settings (Level 2/3 section)
- [ ] `assets/screenshot-7.png` — Order screen with Capture / Refund buttons

## 8. Build & packaging

- [ ] Zip contains a single top-level folder `cardz3n-gateway-woocommerce/`
- [ ] No `.git`, `.github`, `node_modules`, `tests/`, `phpcs.xml.dist`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, or `docs/WPORG-SUBMISSION-CHECKLIST.md` inside the zip
- [ ] No `.DS_Store`, `Thumbs.db`, or editor swap files
- [ ] Zip installs cleanly via WP Admin → Plugins → Add New → Upload

## 9. Submission steps

1. Log in to wordpress.org with the submitter account.
2. Go to [Add Your Plugin](https://wordpress.org/plugins/developers/add/).
3. Upload the release zip built by `.github/workflows/release.yml`.
4. Wait for the automated Plugin Check scan.
5. Address reviewer feedback (typical turnaround: 1–14 days).
6. On approval, WordPress.org emails SVN credentials.

## 10. Post-approval (SVN workflow)

- [ ] `svn co https://plugins.svn.wordpress.org/cardz3n-gateway-woocommerce/`
- [ ] Copy plugin files into `trunk/`
- [ ] Copy WP.org directory assets (icons, banners, screenshots) into `assets/`
- [ ] `svn add --force .` → `svn ci -m "Initial 1.0.0 release"`
- [ ] `svn cp trunk tags/1.0.0` → `svn ci -m "Tag 1.0.0"`
- [ ] Confirm listing appears at `https://wordpress.org/plugins/cardz3n-gateway-woocommerce/`
- [ ] Test install via WP Admin search on a clean site

## 11. Ongoing hygiene

- [ ] Every release: bump header version + `CARDZ3N_GW_VERSION` + `readme.txt` `Stable tag` + `CHANGELOG.md` + `readme.txt` changelog entry
- [ ] Every release: `svn cp trunk tags/X.Y.Z` and `svn ci`
- [ ] Respond to WP.org support forum threads within 3 business days
- [ ] Monitor plugin reviews; respond to 1- and 2-star reviews within 5 business days
- [ ] Watch `security@cardz3n.com` and file CVE where appropriate
