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
 * ASSUMPTIONS (based on the gateway's published Payment API documentation; to be adjusted when the gateway answers
 * Josh's technical questions; every field set below passes through the `cardz3n_gw_recurring_fields` filter, so a
 * correction does not need new plumbing):
 *   A4. First charge of a stored card: `initiated_by=customer`, `stored_credential_indicator=stored`.
 *   A5. Those are accepted together with `customer_vault=add_customer` on a sale.
 *   A6. Later charges (renewals, pre-order release): `initiated_by=merchant`, `stored_credential_indicator=used`,
 *       and `initial_transaction_id` = the transaction ID of the first charge.
 *   A7. We keep that first transaction ID per subscription / order (meta `_cardz3n_initial_txn_id`).
 *   A8. `billing_method=recurring` marks a renewal as recurring billing.
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
			$user_id = (int) $renewal_order->get_customer_id();
			if ( $user_id > 0 && class_exists( '\WC_Payment_Tokens' ) ) {
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
			}
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
	 * Card-on-file fields for the FIRST charge of a card that will be stored (assumptions A4, A5).
	 *
	 * @param bool $already_stored True when the card was already stored (the customer picked a saved method).
	 * @return array<string,string>
	 */
	public static function first_payment_fields( $already_stored = false ) {
		$fields = array(
			'initiated_by'                => 'customer',
			'stored_credential_indicator' => $already_stored ? 'used' : 'stored',
		);
		return (array) apply_filters( 'cardz3n_gw_recurring_fields', $fields, 'first' );
	}

	/**
	 * Card-on-file fields for a LATER charge (renewal or pre-order release) (assumptions A6, A7, A8).
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
