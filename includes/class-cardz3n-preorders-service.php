<?php
/**
 * WooCommerce Pre-Orders integration (conditional).
 *
 * A pre-order charged on release is bought without payment: at checkout the card is verified and saved (see
 * Gateway::process_payment and Recurring), and when the shop owner releases the pre-order the full amount is charged
 * from the saved card here.
 *
 * @package Cardz3n_Gateway
 */

namespace Cardz3n_Gateway;

defined( 'ABSPATH' ) || exit;

/**
 * Handles the WooCommerce Pre-Orders integration.
 */
class Preorders_Service {
	/**
	 * Order meta: the transaction ID of the release charge (the guard against charging twice).
	 */
	const META_RELEASE_TXN = '_cardz3n_preorder_release_txn';

	/**
	 * Placeholder written to the guard before the charge is sent ("pending:<unix time>"), and how long it counts as in progress.
	 */
	const PENDING_PREFIX      = 'pending:';
	const PENDING_STALE_AFTER = 900;

	/**
	 * Singleton instance.
	 *
	 * @var Preorders_Service|null
	 */
	private static $instance = null;

	/**
	 * Get the singleton instance, initializing hooks on first use.
	 */
	public static function instance() {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	/**
	 * Hook into Pre-Orders when the extension is active.
	 */
	private function __construct() {
		if ( ! class_exists( 'WC_Pre_Orders' ) ) {
			return;
		}
		// Registered on init: Brand::id() builds translated text, which must not run before init.
		add_action(
			'init',
			function () {
				add_action( 'wc_pre_orders_process_pre_order_completion_payment_' . Brand::id(), array( $this, 'process_release' ) );
			},
			5
		);
	}

	/**
	 * Charge the pre-order when it is released.
	 *
	 * ASSUMPTION P1: WooCommerce Pre-Orders restores the order's full total before it fires the release action, and the
	 * order is not in a paid status at that point (while waiting it has the "pre-ordered" status).
	 * ASSUMPTION P2: the card-on-file fields for the later charge are the same as for a renewal (A6 to A8, see Recurring).
	 *
	 * @param \WC_Order $order The order being released for payment.
	 */
	public function process_release( $order ) {
		if ( ! $order instanceof \WC_Order ) {
			return;
		}

		// Never charge the same pre-order twice (the release action can run again, or the order may already be paid).
		if ( $order->is_paid() ) {
			return;
		}
		$guard = (string) $order->get_meta( self::META_RELEASE_TXN );
		if ( '' !== $guard ) {
			// A "pending:<time>" guard means an attempt was started and its result is not known: leave it for the merchant.
			if ( 0 === strpos( $guard, self::PENDING_PREFIX ) ) {
				$stale = ( time() - (int) substr( $guard, strlen( self::PENDING_PREFIX ) ) ) > self::PENDING_STALE_AFTER;
				$order->add_order_note(
					$stale
						? __( 'Pre-order release not retried: an earlier charge attempt has an unknown result. Check the gateway for a charge on this order; if there is none, delete the custom field _cardz3n_preorder_release_txn to allow a new release.', 'cardz3n-gateway' )
						: __( 'Pre-order release skipped: a charge attempt on this order is still in progress.', 'cardz3n-gateway' )
				);
			}
			return;
		}

		// The saved card: the order's own, then the customer's saved methods.
		$found       = Recurring::find_for_order( $order );
		$vault_id    = $found['vault_id'];
		$initial_txn = $found['initial_txn'];

		if ( '' === $vault_id ) {
			$order->add_order_note( __( 'Pre-order release failed: no saved payment method was found for this order (not on the order or the customer\'s saved methods).', 'cardz3n-gateway' ) );
			$order->update_status( 'failed' );
			return;
		}

		// Write the guard BEFORE the charge, so a crash or a timeout can never lead to a second charge.
		$order->update_meta_data( self::META_RELEASE_TXN, self::PENDING_PREFIX . time() );
		$order->save();

		try {
			$this->charge_release( $order, $vault_id, $initial_txn );
		} catch ( \Throwable $e ) {
			// The guard stays: a thrown error after a charge must never fail the order or allow another charge.
			Logger::error( 'Pre-order release error: ' . $e->getMessage() );
			$order->add_order_note(
				sprintf(
					/* translators: %s: error message */
					__( 'Pre-order release stopped by an error (%s). The result of the charge may be unknown: check the gateway before releasing again.', 'cardz3n-gateway' ),
					$e->getMessage()
				)
			);
		}
	}

	/**
	 * Send the release charge and record the outcome. The guard meta is already set to a pending placeholder.
	 *
	 * @param \WC_Order $order       The order.
	 * @param string    $vault_id    Saved card.
	 * @param string    $initial_txn First transaction ID.
	 * @return bool Whether the gateway approved the charge.
	 */
	private function charge_release( $order, $vault_id, $initial_txn ) {
		if ( '' === (string) $initial_txn ) {
			// ASSUMPTION A11: still charge, but say that the first transaction ID is missing.
			$order->add_order_note( __( 'The first transaction ID of this pre-order is not known, so the release charge was sent without it.', 'cardz3n-gateway' ) );
		}
		$client = new Api_Client();
		$mapper = new Level3_Mapper();
		$level3 = $mapper->build( $order );

		$response = $client->transaction(
			array(
				'type'              => 'sale',
				'amount'            => $order->get_total(),
				'order_id'          => $order->get_id(),
				'currency'          => $order->get_currency(),
				'customer_vault_id' => $vault_id,
				'payment'           => 'creditcard', // vault knows the real type.
				'order_description' => 'WC Pre-order release #' . $order->get_id(),
				'level3'            => $level3,
				'extra'             => Recurring::later_payment_fields( $initial_txn ), // ASSUMPTIONS A6 to A8, see Recurring.
				'billing'           => array(
					'first_name' => $order->get_billing_first_name(),
					'last_name'  => $order->get_billing_last_name(),
					'email'      => $order->get_billing_email(),
					'company'    => $order->get_billing_company(),
					'address1'   => $order->get_billing_address_1(),
					'city'       => $order->get_billing_city(),
					'state'      => $order->get_billing_state(),
					'zip'        => $order->get_billing_postcode(),
					'country'    => $order->get_billing_country(),
				),
			)
		);

		$extra = array(
			'payment_source_type' => 'card_vault',
			'transaction_type'    => 'preorder_release',
			'level3_sent'         => ! empty( $level3 ),
		);

		if ( $response['success'] ) {
			// Replace the placeholder with the real transaction ID first, before anything else can throw.
			$order->update_meta_data( self::META_RELEASE_TXN, (string) $response['transaction_id'] );
			$order->save();
			Order_Service::stamp( $order, $response, $extra );
			$order->payment_complete( $response['transaction_id'] );
			$order->add_order_note( Order_Service::success_note( $response, $extra ) );
			return true;
		}

		$order->add_order_note( Order_Service::failure_note( $response, $extra ) );
		// ASSUMPTION P3: a decline (response 2), or a gateway error with its own text (response 3, no transport error), means no charge was made.
		$definite = '2' === (string) $response['code'] || ( '3' === (string) $response['code'] && '' === (string) $response['error'] && '' !== (string) $response['text'] );
		if ( $definite ) {
			$order->delete_meta_data( self::META_RELEASE_TXN );
			$order->save();
			$order->update_status( 'failed' );
		} else {
			// Transport error or timeout: the gateway may have charged. Keep the guard and ask the merchant to check.
			$order->add_order_note( __( 'Pre-order release: the result of the charge is unknown (no clear answer from the gateway). Check the gateway before releasing again.', 'cardz3n-gateway' ) );
			$order->update_status( 'on-hold' );
		}
		return false;
	}
}
