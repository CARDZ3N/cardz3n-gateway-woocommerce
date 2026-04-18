# Architecture notes

## Request flow

```
Browser                         WordPress                          NMI
─────────                       ─────────                          ───
Collect.js ─ tokenize ─▶                                    NMI tokenizer
  │                              POST /?wc-ajax=checkout
  └─── payment_token ─▶         Gateway::process_payment
                                Api_Client::transaction ───▶ transact.php
                                Level3_Mapper::build
                                Order_Service::stamp
                                Token_Service::save_*
                                ◀── parsed response ────────────
                                 payment_complete() / fail
                                 302 → thank-you
◀── redirect ──
```

## Why Collect.js inline (not iframe redirect)

The spec requires "embedded/on-site checkout rather than a visible off-site
redirect." Collect.js inline mode injects NMI-controlled inputs into our DOM —
no iframe, no redirect — yet the actual PAN/CVV keystrokes never cross our
origin. This is the PCI DSS SAQ A-EP model and is what Stripe Elements, Adyen
Web Drop-in, and Braintree Hosted Fields all use as well.

## Credential handling

| Key                  | Scope          | Where it lives                                      |
|----------------------|----------------|-----------------------------------------------------|
| Security Key         | Server only    | `wp_options → woocommerce_{gateway_id}_settings`    |
| Tokenization Key     | Browser + Serv | Same, but emitted to `window.CARDZ3N_GW` at checkout|

The private Security Key is deliberately omitted from every `wp_localize_script`
payload and every log entry (`Logger::redact()`).

## Level 3 precedence

Per the build spec:

1. **Order-level meta** — explicit overrides for a specific order.
2. **Variation meta** — overrides the parent product for a sold variation.
3. **Product meta** — default per product.
4. **Plugin settings defaults** — UOM `EA`, commodity source `category`.
5. **Derived WooCommerce values** — the fallback (e.g. `sanitize_title` of the
   first category slug).

If none of the above resolves to a value, the field is **omitted**. Fabricating
Level 3 values leads to interchange downgrades *and* violates card-scheme rules.

## HPOS compatibility

Declared via `FeaturesUtil::declare_compatibility( 'custom_order_tables', … )`
on `before_woocommerce_init`. All order read/write paths use the CRUD API
(`$order->get_meta()`, `$order->update_meta_data()`, `$order->save_meta_data()`)
— never direct `post_meta` access.

## Subscriptions & Pre-Orders

Both integrations load only when their parent extension is present. The main
plugin has no hard dependency on them, so the single build works for:

- Plain Woo stores
- Woo + Subscriptions
- Woo + Pre-Orders
- Woo + both

## White-label

`includes/class-cardz3n-brand.php` is the single source of truth for all
user-facing brand strings, colors, default descriptor, and logo file. A partner
who wants a new variant just adds a new entry to the `$brands` array and sets
`CARDZ3N_GW_BRAND` in `wp-config.php`.

## Extensibility

Filters / actions exposed for integrators:

| Hook                           | Type   | Purpose                                   |
|--------------------------------|--------|-------------------------------------------|
| `cardz3n_gw_brand_profile`     | filter | Override any brand string at runtime      |
| `cardz3n_gw_level3_payload`    | filter | Mutate the Level 3 payload per order      |
