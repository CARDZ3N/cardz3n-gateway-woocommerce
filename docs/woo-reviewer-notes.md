# Notes for the Woo reviewer (paste into the testing-instructions box)

CARDZ3N for WooCommerce 1.1.0 is a payment gateway for merchants of the CARDZ3N payment gateway. It needs a CARDZ3N merchant account to take payments.

**How to test (test mode, no real charges)**
1. Install and activate WooCommerce, then this plugin.
2. WooCommerce > Settings > Payments > CARDZ3N: tick Enable, tick Test Mode, enter the TEST Security Key and TEST Tokenization Key. [JOSH: give the test keys through Woo's private reviewer field, never in this text.]
3. Classic checkout: pay with a test card. Native Block checkout (setting "Native Block Checkout", on by default for new installs): card only.
4. Optional features, each off until switched on: ACH, saved methods, Subscriptions support (card payments), Level 2/3 data, 3-D Secure.

**What was tested**
- Automated stand-in coverage for Subscriptions: 27 end-to-end spec files in the repository (excluded from the plugin zip) cover sign-up, renewals, free trials, changing the payment method and failed renewals against a stand-in for the Subscriptions plugin and the gateway.
- The developer's own test site (test mode): card payments, saved cards, Level 2/3 data switched on and off.
- Tested by the developer on the developer's test site on Nov 9, 2026, from a mobile device, in Test Mode against a gateway test account: one Apple Pay and one Google Pay payment ($1.00 each) succeeded and the gateway recorded each with the correct digital wallet type.
- [specific phone and browser: pending from Josh]
- Local WordPress with WooCommerce 11.2 in a real browser: classic card and ACH checkout, sale, authorize and capture, partial refund, void, Block checkout cases, upgrade from 1.0.43.

**What was not tested**
- The real WooCommerce Subscriptions plugin.
- The real WooCommerce Pre-Orders plugin. Pre-Orders is not claimed.
- 3-D Secure on CARDZ3N's own gateway host.

**Please report any Subscriptions issue.** If a reviewer finds a problem with Subscriptions, report it to support@cardz3n.com and we will fix it within one day.

**Where data goes:** see the Privacy and External services sections of readme.txt (Collect.js and the Transaction API on the CARDZ3N gateway host z3n.transactiongateway.com).

**Support:** support@cardz3n.com, 725-888-5001, portal.cardz3n.com.
