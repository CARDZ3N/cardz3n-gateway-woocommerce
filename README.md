# CARDZ3N Gateway for WooCommerce

[![WordPress](https://img.shields.io/badge/WordPress-6.4%2B-blue)](https://wordpress.org) [![WooCommerce](https://img.shields.io/badge/WooCommerce-8.0%2B-96588a)](https://woocommerce.com) [![PHP](https://img.shields.io/badge/PHP-7.4%2B-777bb4)](https://www.php.net) [![License](https://img.shields.io/badge/license-GPLv2%2B-green)](LICENSE)

Embedded, on-site WooCommerce checkout powered by the CARDZ3N / NMI payment platform.

- **Embedded UX** — no redirect. Buyers stay on-site.
- **Everything in one gateway** — credit/debit cards, ACH, Apple Pay, Google Pay, and saved methods inside a single gateway UI.
- **B2B-ready** — automatic Level 2 / Level 3 commercial-card data on every transaction.
- **Subscriptions** — native support when WooCommerce Subscriptions is installed.
- **HPOS-ready** — Custom Order Tables compatibility declared.
- **White-label** — single codebase, CARDZ3N + AerospacePay variants via a constant.

## Quick start

1. Upload the zip via `Plugins → Add New → Upload Plugin`.
2. Go to `WooCommerce → Settings → Payments → CARDZ3N Gateway → Manage`.
3. Paste your CARDZ3N / NMI **Security Key** and **Tokenization Key**.
4. Save, click **Test Credentials**, then run a sandbox order.

Full guide: [docs/INSTALL.md](docs/INSTALL.md)
QA matrix: [docs/QA-TEST-MATRIX.md](docs/QA-TEST-MATRIX.md)
Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
Changelog: [CHANGELOG.md](CHANGELOG.md)

## Repository layout

```
cardz3n-gateway-woocommerce/
├── cardz3n-gateway-woocommerce.php      # main bootstrap
├── readme.txt                            # WordPress.org readme
├── README.md                             # this file
├── CHANGELOG.md
├── LICENSE                               # GPLv2
├── assets/
│   ├── css/checkout.css
│   ├── js/{checkout,admin-capture}.js
│   └── img/*.svg                         # brand + card icons
├── includes/
│   ├── class-cardz3n-gateway.php         # WC_Payment_Gateway_CC
│   ├── class-cardz3n-api-client.php      # NMI transact.php client
│   ├── class-cardz3n-level3-mapper.php   # L2/L3 payload builder
│   ├── class-cardz3n-token-service.php   # saved methods
│   ├── class-cardz3n-order-service.php   # order meta + auto-capture
│   ├── class-cardz3n-wallet-service.php
│   ├── class-cardz3n-ach-service.php
│   ├── class-cardz3n-subscriptions-service.php
│   ├── class-cardz3n-preorders-service.php
│   ├── class-cardz3n-admin.php
│   ├── class-cardz3n-brand.php           # white-label brand registry
│   ├── class-cardz3n-logger.php
│   ├── helpers.php
│   └── traits/                            # refunds, settings, compatibility
└── docs/
    ├── INSTALL.md
    ├── QA-TEST-MATRIX.md
    └── ARCHITECTURE.md
```

## License

GPLv2 or later. © 2026 CARDZ3N Inc (DBA ChargebackZ3N).
