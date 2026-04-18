# CARDZ3N Gateway for WooCommerce — Installation & Setup Guide

## 1. Prerequisites

| Requirement       | Minimum                  |
|-------------------|--------------------------|
| WordPress         | 6.4                      |
| WooCommerce       | 8.0                      |
| PHP               | 7.4                      |
| HTTPS             | Required for live mode   |
| CARDZ3N / NMI     | Active merchant account with Collect.js enabled |

## 2. Install the plugin

**Option A — WP admin:**
1. `Plugins → Add New → Upload Plugin`
2. Choose `cardz3n-gateway-woocommerce.zip`
3. Click **Install Now**, then **Activate**

**Option B — FTP / SFTP:**
1. Unzip `cardz3n-gateway-woocommerce.zip`
2. Upload the folder to `wp-content/plugins/`
3. Activate in **Plugins**

**Option C — Git / deploy pipeline:**
```bash
cd wp-content/plugins
git clone https://github.com/your-org/cardz3n-gateway-woocommerce.git
```

## 3. Get your CARDZ3N / NMI API keys

1. Log in to the CARDZ3N / NMI Merchant Portal
2. Go to **Settings → Security Keys**
3. Create or copy:
   - **Security Key** (private — server-side only)
   - **Tokenization Key** (public — used by Collect.js in the browser)
4. Do this twice if you want separate sandbox + live keys

## 4. Configure the gateway

1. `WooCommerce → Settings → Payments → CARDZ3N Gateway → Manage`
2. Paste the Security Key and Tokenization Key into either **Sandbox** or **Live**
3. Enable **Sandbox Mode** while testing
4. Click **Save changes**, then click **Test Credentials** — you should see a green ✓
5. Enable the payment methods you want to offer
6. (B2B only) Fill in the **Level 2 / Level 3 Commercial Data** section — especially **Merchant TIN**

## 5. Run a sandbox transaction

1. Switch the gateway to **Sandbox mode** and save
2. Place a test order on the store
3. Use an NMI-supplied test card (for example `4111 1111 1111 1111`, any future expiry, any CVV)
4. Confirm:
   - Order transitions to **Processing** or **Completed**
   - Order note reads "SALE via card approved. Transaction ID: …"
   - Transaction appears in your NMI dashboard
   - If you enabled Level 3, order note reads "Level 3 data transmitted"

## 6. Go live

1. Disable **Sandbox Mode**
2. Verify HTTPS is active on your checkout page
3. Place one real low-value order with a card you control
4. Refund it immediately to confirm the refund path works
5. Monitor `WooCommerce → Status → Logs` → source `cardz3n-gateway` for the first day

## 7. White-label (AerospacePay variant)

To run the plugin under the AerospacePay brand instead of CARDZ3N, add this line
to `wp-config.php` **above** the "stop editing" comment:

```php
define( 'CARDZ3N_GW_BRAND', 'aerospacepay' );
```

All checkout text, logos, descriptor defaults, and admin copy switch accordingly.

## 8. Per-product B2B meta

Level 3 data pulls from these product-level custom fields. Any missing field is
omitted (never fabricated):

| Meta key                      | Purpose                                    |
|-------------------------------|--------------------------------------------|
| `_cardz3n_upc`                | Item Universal Product Code                |
| `_cardz3n_commodity_code`     | Item commodity / material code             |
| `_cardz3n_uom`                | Unit of measure (defaults to `EA`)         |
| `_cardz3n_po_number`          | Per-order PO number override               |
| `_cardz3n_ship_from_date`     | Shipment date override                     |
| `_cardz3n_item_freight_amount`| Per-item freight allocation override       |
| `_cardz3n_item_discount_amount` | Per-item discount override               |

These can be set via the WooCommerce admin, WP-CLI, or a product-import CSV.

## 9. Troubleshooting

| Symptom                                                  | Likely cause / fix                                            |
|----------------------------------------------------------|----------------------------------------------------------------|
| Gateway hidden at checkout                               | Missing credentials or live mode without HTTPS                |
| "Tokenization timed out" at checkout                     | Browser blocked `secure.nmi.com` — check CSP, ad-blockers     |
| `Invalid security key` on Test Credentials               | Keys swapped or belong to a disabled account                  |
| Level 3 data not transmitted                             | Toggle `Enable Level 2/3 Transmission` in settings            |
| Auto-capture never fires                                 | Set `Auto-capture on Status Change` to a specific status      |
| Apple Pay button not showing                             | Apple Pay domain verification file missing from `.well-known` |

Enable **Debug Mode** in settings, then check **WooCommerce → Status → Logs →
`cardz3n-gateway`** for redacted diagnostics.

## 10. Support

- Docs: https://cardz3n.com/docs/woocommerce
- Support: https://cardz3n.com/support
