=== CARDZ3N Gateway for WooCommerce ===
Contributors: cardz3ninc
Tags: woocommerce, payment gateway, credit card, ach, nmi, apple pay, google pay, level 3, subscriptions, b2b
Requires at least: 6.4
Tested up to: 6.7
Requires PHP: 7.4
Stable tag: 1.0.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Embedded on-site checkout for WooCommerce powered by the CARDZ3N / NMI payment platform. Card, ACH, Apple Pay, Google Pay, subscriptions, refunds, and automatic Level 2/3 commercial-card data in a single gateway UI.

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

== External services ==

This plugin connects to two external CARDZ3N / NMI services to process payments:

1. **NMI Collect.js** (https://secure.nmi.com/token/Collect.js) — JavaScript library loaded in the buyer's browser at checkout. It securely tokenizes card / ACH / wallet payment details into a one-time `payment_token`. No sensitive data is sent to your WordPress server.
   * Terms of service: https://www.nmi.com/terms/
   * Privacy policy: https://www.nmi.com/privacy/

2. **NMI Transaction API** (https://secure.nmi.com/api/transact.php) — server-side endpoint called by your WordPress site to execute charges, captures, voids, and refunds using the Collect.js token and your private Security Key.
   * Terms of service: https://www.nmi.com/terms/
   * Privacy policy: https://www.nmi.com/privacy/

Your private Security Key is stored in WooCommerce gateway settings and is only used server-to-server. Your public Tokenization Key is exposed to the browser (as designed by NMI) to drive Collect.js.

== Installation ==

1. Upload the plugin ZIP via **Plugins → Add New → Upload Plugin**, or extract into `wp-content/plugins/cardz3n-gateway-woocommerce`.
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

== Screenshots ==

1. Embedded checkout — Card, ACH, Apple Pay, Google Pay, and saved methods in one gateway panel.
2. Gateway settings — credentials, payment methods, processing rules, Level 2/3.
3. Manual capture button on the order edit screen.
4. Level 3 commercial-data fields and overrides.

== Changelog ==

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

= 1.0.0 =
Initial public release.
