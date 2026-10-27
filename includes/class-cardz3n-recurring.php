<?php
/**
 * Recurring payments: shared helpers for WooCommerce Subscriptions and Pre-Orders.
 *
 * One saved card (a gateway "vault" entry) is created at the first payment of a subscription or pre-order and used
 * for every later charge (renewals, pre-order release). This class holds the three things both flows need:
 *   1. Detecting that an order needs a stored payment method.
 *   2. Storing the vault reference where later charges will look for it (the parent order, every subscription of
 *      the order, and the signed-in customer's saved method), and finding it again, including for stores whose
 *      first order was stamped by an older version (the "saved-method lookup problem").
 *   3. The card-on-file fields sent with the first and the later charges.
 *
 * Every field set below passes through the `cardz3n_gw_recurring_fields` filter, so a correction does not need new plumbing.
 *
 * CONFIRMED by NMI's AI assistant on 2026-10-26 (recurring ticket; to be verified against the live behaviour of our TEST
 * account, which is why they stay behind the filter):
 *   C1. The Customer Vault works in Test Mode: `customer_vault=add_customer` with a Collect.js payment_token returns a vault ID.
 *   C2. First-store transaction: `customer_vault=add_customer`, `billing_method=recurring`, `initiated_by=customer`,
 *       `stored_credential_indicator=stored`; the returned transaction_id is saved (A4, A5, A8 are now confirmed).
 *   C3. Every later charge: `customer_vault_id`, `billing_method=recurring`, `stored_credential_indicator=used`,
 *       `initial_transaction_id` (the saved first transaction ID), and `initiated_by=merchant` for renewals or
 *       `initiated_by=customer` for a customer-present charge (A6, A7 are now confirmed).
 *   C4. A void is only possible before settlement and for the full amount; after settlement it must be a refund.
 *   C5. A $0.00 verification may become a $1.00 authorization on processors that do not support validates.
 *
 * STILL ASSUMED:
 *   A9. A `type=validate` request with `customer_vault_id` (an existing vault entry) and the first-store fields is accepted
 *       and returns a transaction ID. It is used to give a saved card that has no flagged first transaction a fresh one
 *       (see Gateway::reinitialise_saved_card()). Filter `cardz3n_gw_reinitialise_saved_cards` switches it off.
 *   A10. A saved card used for a recurring order is treated as a new first-store (`stored`, with this payment as the first
 *       transaction) when its stored first transaction was not itself sent with the first-store flags.
 *   A11. A renewal without a known first transaction ID is still sent (without `initial_transaction_id`) rather than failed,
 *       so older subscriptions keep renewing; an order note says so.
 *
 * @package Cardz3n_Gateway
 */

namespace Cardz3n_Gateway;

defined( 'ABSPATH' ) || exit;

/**
 * Shared recurring-payment helpers (static, no state).
 */
class Recurring {

	const META_VAULT       = '_cardz3n_customer_vault_id';
	const META_INITIAL_TXN = '_cardz3n_initial_txn_id';

	/**
	 * Token meta: the first transaction ID of a saved card, and whether that transaction was sent with the first-store
	 * flags (only then may it be sent as `initial_transaction_id`).
	 */
	const TOKEN_INITIAL_TXN     = 'cardz3n_initial_txn_id';
	const TOKEN_INITIAL_FLAGGED = 'cardz3n_initial_flagged';

	/**
	 * The first transaction ID of a saved card, only when it is safe to reuse (sent with the first-store flags).
	 *
	 * @param \WC_Payment_Token $token Saved method.
	 * @return string Transaction ID, or an empty string.
	 */
	public static function flagged_initial_txn( $token ) {
		if ( 'yes' !== (string) $token->get_meta( self::TOKEN_INITIAL_FLAGGED ) ) {
			return '';
		}
		return (string) $token->get_meta( self::TOKEN_INITIAL_TXN );
	}

	/**
	 * Record a fresh first transaction on a saved method and mark it as sent with the first-store flags.
	 *
	 * @param int    $token_id    Saved method ID.
	 * @param string $initial_txn Transaction ID.
	 */
	public static function mark_token_initial( $token_id, $initial_txn ) {
		if ( $token_id < 1 || '' === (string) $initial_txn ) {
			return;
		}
		$token = \WC_Payment_Tokens::get( (int) $token_id );
		if ( ! $token ) {
			return;
		}
		$token->update_meta_data( self::TOKEN_INITIAL_TXN, (string) $initial_txn );
		$token->update_meta_data( self::TOKEN_INITIAL_FLAGGED, 'yes' );
		$token->save_meta_data();
	}

	/**
	 * Whether WooCommerce Subscriptions is active.
	 *
	 * @return bool
	 */
	public static function subscriptions_active() {
		return class_exists( 'WC_Subscriptions' ) || class_exists( 'WC_Subscriptions_Core_Plugin' );
	}

	/**
	 * Whether WooCommerce Pre-Orders is active.
	 *
	 * @return bool
	 */
	public static function preorders_active() {
		return class_exists( 'WC_Pre_Orders' );
	}

	/**
	 * Recurring features the native Blocks payment method advertises, mirroring the classic gateway's supports list.
	 *
	 * Advertised only when the matching store switch ("Subscriptions Support" / "Pre-Orders Support") is on AND the plugin is
	 * active; never more than the settings allow. 'tokenization' is added with them because the card is saved for the later
	 * payments (Gateway::process_payment() forces that for these orders).
	 *
	 * @param array $settings The gateway settings.
	 * @return string[]
	 */
	public static function block_checkout_features( $settings ) {
		$features = array();
		if ( 'yes' === ( $settings['enable_subscriptions'] ?? 'no' ) && class_exists( 'WC_Subscriptions' ) ) {
			$features = array(
				'subscriptions',
				'subscription_cancellation',
				'subscription_suspension',
				'subscription_reactivation',
				'subscription_amount_changes',
				'subscription_date_changes',
				'subscription_payment_method_change',
				'subscription_payment_method_change_customer',
				'subscription_payment_method_change_admin',
				'multiple_subscriptions',
			);
		}
		if ( 'yes' === ( $settings['enable_preorders'] ?? 'no' ) && self::preorders_active() ) {
			$features[] = 'pre-orders';
		}
		if ( $features ) {
			$features[] = 'tokenization';
		}
		return $features;
	}

	/**
	 * Which of the two plugins are active but NOT offered on the block checkout (switch off, or not advertised).
	 *
	 * @param array $settings The gateway settings.
	 * @return string[] Any of 'subscriptions', 'pre-orders'.
	 */
	public static function block_checkout_gaps( $settings ) {
		$features = self::block_checkout_features( $settings );
		$gaps     = array();
		if ( self::subscriptions_active() && ! in_array( 'subscriptions', $features, true ) ) {
			$gaps[] = 'subscriptions';
		}
		if ( self::preorders_active() && ! in_array( 'pre-orders', $features, true ) ) {
			$gaps[] = 'pre-orders';
		}
		return $gaps;
	}

	/**
	 * Does this order need a stored payment method (it contains a subscription, or a pre-order charged on release)?
	 *
	 * @param \WC_Order $order Order being paid.
	 * @return bool
	 */
	public static function order_needs_stored_method( $order ) {
		if ( ! $order instanceof \WC_Order ) {
			return false;
		}
		if ( function_exists( 'wcs_order_contains_subscription' ) && wcs_order_contains_subscription( $order ) ) {
			return true;
		}
		if ( class_exists( 'WC_Pre_Orders_Order' ) ) {
			if ( method_exists( 'WC_Pre_Orders_Order', 'order_requires_payment_tokenization' ) ) {
				return (bool) \WC_Pre_Orders_Order::order_requires_payment_tokenization( $order );
			}
			if ( method_exists( 'WC_Pre_Orders_Order', 'order_contains_pre_order' ) ) {
				return (bool) \WC_Pre_Orders_Order::order_contains_pre_order( $order );
			}
		}
		return false;
	}

	/**
	 * Is this a pre-order that is charged when it is released (so nothing may be charged at checkout)?
	 *
	 * ASSUMPTION P3: Pre-Orders' `order_requires_payment_tokenization()` is true exactly for pre-orders charged upon
	 * release. Pre-Orders normally shows a $0.00 total at checkout for them; this also covers a total above zero.
	 *
	 * @param \WC_Order $order Order being paid.
	 * @return bool
	 */
	public static function order_charged_on_release( $order ) {
		if ( function_exists( 'wcs_order_contains_subscription' ) && wcs_order_contains_subscription( $order ) ) {
			return false;
		}
		return class_exists( 'WC_Pre_Orders_Order' )
			&& method_exists( 'WC_Pre_Orders_Order', 'order_requires_payment_tokenization' )
			&& (bool) \WC_Pre_Orders_Order::order_requires_payment_tokenization( $order );
	}

	/**
	 * Subscriptions created for an order (parent, resubscribe or switch).
	 *
	 * @param \WC_Order $order Order.
	 * @return \WC_Order[] Subscription objects (WC_Subscription extends WC_Order).
	 */
	public static function subscriptions_for_order( $order ) {
		if ( ! function_exists( 'wcs_get_subscriptions_for_order' ) || ! $order instanceof \WC_Order ) {
			return array();
		}
		$subs = wcs_get_subscriptions_for_order( $order, array( 'order_type' => 'any' ) );
		return is_array( $subs ) ? array_values( $subs ) : array();
	}

	/**
	 * Store the vault reference and the first transaction ID on the order and on every subscription of it.
	 *
	 * @param \WC_Order $order       The paid order.
	 * @param string    $vault_id    Gateway vault ID of the saved card.
	 * @param string    $initial_txn Transaction ID of the first charge (or verification).
	 */
	public static function store( $order, $vault_id, $initial_txn ) {
		$vault_id    = (string) $vault_id;
		$initial_txn = (string) $initial_txn;
		if ( '' === $vault_id ) {
			return;
		}
		$targets = array_merge( array( $order ), self::subscriptions_for_order( $order ) );
		foreach ( $targets as $target ) {
			$target->update_meta_data( self::META_VAULT, $vault_id );
			if ( '' !== $initial_txn ) {
				$target->update_meta_data( self::META_INITIAL_TXN, $initial_txn );
			}
			$target->save();
		}
	}

	/**
	 * Replace the saved card of ONE subscription (or renewal order) with another one.
	 *
	 * Unlike store(), this never touches the first order or other subscriptions, and it clears the first transaction ID
	 * when the new card has none (an old card's ID must never be sent for a different card).
	 *
	 * @param \WC_Order $target      The subscription (or renewal order) to update.
	 * @param string    $vault_id    Gateway vault ID of the new card.
	 * @param string    $initial_txn First transaction ID of the new card, or an empty string.
	 */
	public static function replace( $target, $vault_id, $initial_txn ) {
		if ( '' === (string) $vault_id ) {
			return;
		}
		$target->update_meta_data( self::META_VAULT, (string) $vault_id );
		if ( '' !== (string) $initial_txn ) {
			$target->update_meta_data( self::META_INITIAL_TXN, (string) $initial_txn );
		} else {
			$target->delete_meta_data( self::META_INITIAL_TXN );
		}
		$target->save();
	}

	/**
	 * Find the saved card to charge for a renewal (or any later charge).
	 *
	 * Looks, in this order: the subscription(s) of the renewal, then the first (parent) order of each subscription,
	 * then the renewal order itself, then the customer's saved methods for this gateway. When it has to fall back
	 * it writes the result back to the subscriptions, so the next renewal finds it directly.
	 *
	 * @param \WC_Order $renewal_order The renewal order.
	 * @return array{vault_id:string,initial_txn:string,via:string}
	 */
	public static function find_for_renewal( $renewal_order ) {
		$subscriptions = function_exists( 'wcs_get_subscriptions_for_renewal_order' ) ? wcs_get_subscriptions_for_renewal_order( $renewal_order ) : array();
		$found         = array(
			'vault_id'    => '',
			'initial_txn' => '',
			'via'         => '',
		);

		foreach ( (array) $subscriptions as $sub ) {
			$v = (string) $sub->get_meta( self::META_VAULT );
			if ( '' !== $v ) {
				return array(
					'vault_id'    => $v,
					'initial_txn' => (string) $sub->get_meta( self::META_INITIAL_TXN ),
					'via'         => 'subscription',
				);
			}
		}

		foreach ( (array) $subscriptions as $sub ) {
			$parent = method_exists( $sub, 'get_parent' ) ? $sub->get_parent() : false;
			if ( $parent instanceof \WC_Order && '' !== (string) $parent->get_meta( self::META_VAULT ) ) {
				$found = array(
					'vault_id'    => (string) $parent->get_meta( self::META_VAULT ),
					'initial_txn' => (string) $parent->get_meta( self::META_INITIAL_TXN ),
					'via'         => 'parent order',
				);
				if ( '' === $found['initial_txn'] ) {
					$found['initial_txn'] = (string) $parent->get_meta( '_cardz3n_transaction_id' );
				}
				break;
			}
		}

		if ( '' === $found['vault_id'] && '' !== (string) $renewal_order->get_meta( self::META_VAULT ) ) {
			$found = array(
				'vault_id'    => (string) $renewal_order->get_meta( self::META_VAULT ),
				'initial_txn' => (string) $renewal_order->get_meta( self::META_INITIAL_TXN ),
				'via'         => 'renewal order',
			);
		}

		if ( '' === $found['vault_id'] ) {
			$found = self::find_in_customer_methods( (int) $renewal_order->get_customer_id() );
		}

		// Heal: write what was found back to the subscriptions so the next renewal finds it directly.
		if ( '' !== $found['vault_id'] ) {
			foreach ( (array) $subscriptions as $sub ) {
				if ( '' === (string) $sub->get_meta( self::META_VAULT ) ) {
					$sub->update_meta_data( self::META_VAULT, $found['vault_id'] );
					if ( '' !== $found['initial_txn'] ) {
						$sub->update_meta_data( self::META_INITIAL_TXN, $found['initial_txn'] );
					}
					$sub->save();
				}
			}
		}

		return $found;
	}

	/**
	 * The default (or last) card saved for a customer under this gateway.
	 *
	 * @param int $user_id Customer ID (0 for a guest).
	 * @return array{vault_id:string,initial_txn:string,via:string}
	 */
	private static function find_in_customer_methods( $user_id ) {
		$found = array(
			'vault_id'    => '',
			'initial_txn' => '',
			'via'         => '',
		);
		if ( $user_id < 1 || ! class_exists( '\WC_Payment_Tokens' ) ) {
			return $found;
		}
		foreach ( \WC_Payment_Tokens::get_customer_tokens( $user_id, Brand::id() ) as $token ) {
			$v = ( '' !== (string) $token->get_meta( 'cardz3n_vault_id' ) ) ? (string) $token->get_meta( 'cardz3n_vault_id' ) : (string) $token->get_token();
			if ( '' !== $v && ! ( $token instanceof \WC_Payment_Token_ECheck ) ) {
				$found = array(
					'vault_id'    => $v,
					'initial_txn' => (string) $token->get_meta( 'cardz3n_initial_txn_id' ),
					'via'         => "customer's saved method",
				);
				if ( $token->is_default() ) {
					break;
				}
			}
		}
		return $found;
	}

	/**
	 * Find the saved card to charge for a single order that is paid later (a pre-order released by the shop owner).
	 *
	 * Looks at the order's own saved card first (stored at checkout), then the customer's saved methods.
	 *
	 * @param \WC_Order $order The order.
	 * @return array{vault_id:string,initial_txn:string,via:string}
	 */
	public static function find_for_order( $order ) {
		$vault = (string) $order->get_meta( self::META_VAULT );
		if ( '' !== $vault ) {
			$initial = (string) $order->get_meta( self::META_INITIAL_TXN );
			return array(
				'vault_id'    => $vault,
				'initial_txn' => ( '' !== $initial ) ? $initial : (string) $order->get_meta( '_cardz3n_transaction_id' ),
				'via'         => 'order',
			);
		}
		return self::find_in_customer_methods( (int) $order->get_customer_id() );
	}

	/**
	 * Card-on-file fields for a payment made while the customer is present: the first-store transaction of a card (C2), or a
	 * later customer-present charge of a card whose first transaction is known (C3).
	 *
	 * @param bool   $reuse_initial True when a saved card is reused and its flagged first transaction ID is known.
	 * @param string $initial_txn   That first transaction ID.
	 * @return array<string,string>
	 */
	public static function first_payment_fields( $reuse_initial = false, $initial_txn = '' ) {
		$fields = array(
			'billing_method'              => 'recurring',
			'initiated_by'                => 'customer',
			'stored_credential_indicator' => 'stored',
		);
		if ( $reuse_initial && '' !== (string) $initial_txn ) {
			$fields['stored_credential_indicator'] = 'used';
			$fields['initial_transaction_id']      = (string) $initial_txn;
		}
		return (array) apply_filters( 'cardz3n_gw_recurring_fields', $fields, 'first' );
	}

	/**
	 * Card-on-file fields for a LATER charge, merchant-initiated (renewal or pre-order release) (C3).
	 *
	 * @param string $initial_txn Transaction ID of the first charge, when known.
	 * @return array<string,string>
	 */
	public static function later_payment_fields( $initial_txn = '' ) {
		$fields = array(
			'billing_method'              => 'recurring',
			'initiated_by'                => 'merchant',
			'stored_credential_indicator' => 'used',
		);
		if ( '' !== (string) $initial_txn ) {
			$fields['initial_transaction_id'] = (string) $initial_txn;
		}
		return (array) apply_filters( 'cardz3n_gw_recurring_fields', $fields, 'later' );
	}
}
