# CARDZ3N Gateway for WooCommerce — QA Test Matrix

Run this matrix before every production release. All tests require a sandbox
CARDZ3N / NMI account with Collect.js enabled.

## Environment

| Item               | Value                                    |
|--------------------|------------------------------------------|
| WP version         | `__________`                             |
| WC version         | `__________`                             |
| PHP version        | `__________`                             |
| Theme              | `__________`                             |
| HPOS               | Enabled / Disabled                       |

## 1. Core checkout

| #  | Scenario                                              | Expected                                                     | Pass |
|----|-------------------------------------------------------|--------------------------------------------------------------|:----:|
| 1  | Guest card payment success                            | Order → Processing; txn ID stamped; success note             |      |
| 2  | Guest ACH payment success                             | Same, source = "ACH"                                         |      |
| 3  | Logged-in card payment with "Save card" ticked        | Order success + new token appears in My Account              |      |
| 4  | Logged-in ACH with "Save bank" (only if reuse allowed)| Order success + ACH token appears in My Account              |      |
| 5  | Saved card reuse                                      | No Collect.js token submitted; vault_id used; order success  |      |
| 6  | Saved ACH reuse                                       | Same for ACH                                                 |      |
| 7  | Apple Pay success (Safari on iOS/macOS)               | Wallet button completes order                                |      |
| 8  | Google Pay success (Chrome)                           | Wallet button completes order                                |      |
| 9  | Card decline path (e.g., amount 0.01 on decline BIN)  | Error notice shown; order marked failed; failure note        |      |
| 10 | ACH reject path                                       | Same for ACH                                                 |      |
| 11 | Duplicate-click prevention                            | Second click does nothing while first request in flight      |      |
| 12 | Tokenization timeout without double charge            | User sees timeout message; no server charge recorded         |      |

## 2. Admin operations

| #  | Scenario                          | Expected                                                   | Pass |
|----|-----------------------------------|------------------------------------------------------------|:----:|
| 13 | Full refund from order admin      | Refund transaction recorded; order → Refunded              |      |
| 14 | Partial refund                    | Partial refund transaction; remaining balance correct      |      |
| 15 | Void unsettled transaction        | Void attempted first; success note reads "voided…"         |      |
| 16 | Capture authorized transaction    | `_cardz3n_captured_amount` updated; order completes        |      |

## 3. Extension compatibility

| #  | Scenario                                                     | Expected                                               | Pass |
|----|--------------------------------------------------------------|--------------------------------------------------------|:----:|
| 17 | Subscriptions initial checkout (WC Subscriptions active)     | Parent order success; subscription active             |      |
| 18 | Renewal charge with saved token                              | Scheduled renewal charges via vault; order success    |      |
| 19 | Subscription payment-method update                           | New vault id replaces old on the subscription          |      |
| 20 | Pre-order checkout (WC Pre-Orders active)                    | Auth stored; release triggers vault-sale successfully |      |

## 4. Commercial data (Level 2/3)

| #  | Scenario                                                    | Expected                                                | Pass |
|----|-------------------------------------------------------------|---------------------------------------------------------|:----:|
| 21 | Level 3 payload includes all available order + line fields  | NMI "view transaction" shows L3 fields                  |      |
| 22 | Missing L3 fields omitted gracefully                        | No fabricated values sent                               |      |
| 23 | Allocated shipping + discount calculations stable           | Line item freight/discount sum ≈ order freight/discount |      |
| 24 | PO number transmission                                      | PO visible in NMI transaction detail                    |      |
| 25 | Product UPC/commodity/UOM meta mapping                      | Item commodity code + UPC appear in NMI detail          |      |

## 5. Edge cases & compliance

| #  | Scenario                                                    | Expected                                                | Pass |
|----|-------------------------------------------------------------|---------------------------------------------------------|:----:|
| 26 | Live mode + HTTP (no TLS)                                   | Gateway hidden at checkout                              |      |
| 27 | Token deleted from My Account                               | Local token removed + remote vault deleted              |      |
| 28 | Settings: all payment methods disabled                      | Gateway hidden at checkout                              |      |
| 29 | HPOS enabled site                                           | All admin + checkout flows work                         |      |
| 30 | Card-brand restriction (disable Amex)                       | Amex icon hidden; Amex submission rejected              |      |
| 31 | Debug Mode OFF                                              | No `cardz3n-gateway` log entries for normal traffic     |      |
| 32 | Debug Mode ON                                               | Redacted transaction logs present (no PAN/CVV/account#) |      |
| 33 | AerospacePay brand variant                                  | All UI strings and logo switch                          |      |

## Sign-off

| Role              | Name          | Date       | Signature |
|-------------------|---------------|------------|-----------|
| Release engineer  |               |            |           |
| QA lead           |               |            |           |
| Product owner     |               |            |           |
