<?php
/**
 * WooCommerce Subscriptions integration (conditional).
 *
 * When the Subscriptions extension is active, renewal charges are processed
 * server-side using the stored customer_vault_id on the parent order's
 * associated payment token.
 *
 * This service is inert (no hooks wired) when Subscriptions isn't installed,
 * so the plugin has no hard dependency on it.
 *
 * @package Cardz3n_Gateway
 */

namespace Cardz3n_Gateway;

defined( 'ABSPATH' ) || exit;

/**
 * Handles the WooCommerce Subscriptions integration.
 */
class Subscriptions_Service {

	/**
	 * Written on the renewal order the moment the gateway confirms the charge, BEFORE anything else runs, so a later
	 * error (another plugin's hook, a failed save) can never lead to a second charge of the same renewal.
	 */
	const META_CHARGE_TXN = '_cardz3n_renewal_charge_txn';

	/**
	 * Singleton instance.
	 *
	 * @var Subscriptions_Service|null
	 */
	private static $instance = null;

	/**
	 * Get the singleton instance.
	 */
	public static function instance() {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	/**
	 * Wire the renewal hook when Subscriptions is active.
	 */
	private function __construct() {
		if ( ! $this->is_active() ) {
			return;
		}

		// Registered on init: Brand::id() builds translated text, which must not run before init.
		add_action(
			'init',
			function () {
				add_action( 'woocommerce_scheduled_subscription_payment_' . Brand::id(), array( $this, 'process_renewal' ), 10, 2 );

				/*
				 * Change payment method. ASSUMPTIONS (from the Subscriptions gateway documentation; not testable without the real plugin):
				 *   A9.  `woocommerce_subscription_payment_meta` ( $payment_meta, $subscription ) lists the editable stored values.
				 *   A10. `woocommerce_subscription_validate_payment_meta_<gateway id>` ( $payment_meta, $subscription ) is an action
				 *        that stops the save when it throws an Exception; $payment_meta holds this gateway's rows as posted.
				 *   A11. `woocommerce_subscription_failing_payment_method_updated_<gateway id>` passes the subscription and the
				 *        failed renewal order (this code finds which is which, so the order of the two does not matter).
				 */
				add_filter( 'woocommerce_subscription_payment_meta', array( $this, 'payment_meta' ), 10, 2 );
				add_action( 'woocommerce_subscription_validate_payment_meta_' . Brand::id(), array( $this, 'validate_payment_meta' ) );
				add_action( 'woocommerce_subscription_failing_payment_method_updated_' . Brand::id(), array( $this, 'copy_method_to_failed_renewal' ), 10, 2 );
			},
			5
		);
	}

	/**
	 * Show the stored card reference of a subscription so an administrator can read or correct it.
	 *
	 * @param array     $payment_meta Rows of all gateways, keyed by gateway ID.
	 * @param \WC_Order $subscription The subscription.
	 * @return array
	 */
	public function payment_meta( $payment_meta, $subscription ) {
		$payment_meta[ Brand::id() ] = array(
			'post_meta' => array(
				Recurring::META_VAULT       => array(
					'value' => (string) $subscription->get_meta( Recurring::META_VAULT ),
					'label' => __( 'Saved card ID (vault ID)', 'cardz3n-gateway' ),
				),
				Recurring::META_INITIAL_TXN => array(
					'value' => (string) $subscription->get_meta( Recurring::META_INITIAL_TXN ),
					'label' => __( 'First transaction ID of the saved card', 'cardz3n-gateway' ),
				),
			),
		);
		return $payment_meta;
	}

	/**
	 * Refuse an empty or odd-looking saved card ID before it is stored on a subscription.
	 *
	 * @param array $payment_meta This gateway's rows as posted.
	 * @throws \Exception When the saved card ID is empty or has unexpected characters.
	 */
	public function validate_payment_meta( $payment_meta ) {
		$vault   = isset( $payment_meta['post_meta'][ Recurring::META_VAULT ]['value'] ) ? trim( (string) $payment_meta['post_meta'][ Recurring::META_VAULT ]['value'] ) : '';
		$initial = isset( $payment_meta['post_meta'][ Recurring::META_INITIAL_TXN ]['value'] ) ? trim( (string) $payment_meta['post_meta'][ Recurring::META_INITIAL_TXN ]['value'] ) : '';
		if ( ! preg_match( '/^[A-Za-z0-9_-]{1,64}$/', $vault ) ) {
			throw new \Exception( esc_html__( 'Enter the saved card ID (vault ID): letters, numbers, dashes and underscores only.', 'cardz3n-gateway' ) );
		}
		if ( '' !== $initial && ! preg_match( '/^[A-Za-z0-9_-]{1,64}$/', $initial ) ) {
			throw new \Exception( esc_html__( 'The first transaction ID may only contain letters, numbers, dashes and underscores.', 'cardz3n-gateway' ) );
		}
	}

	/**
	 * After a customer fixes a failing renewal by changing the payment method, give that renewal order the new card.
	 *
	 * @param \WC_Order $first  The subscription or the failed renewal order.
	 * @param \WC_Order $second The other one.
	 */
	public function copy_method_to_failed_renewal( $first, $second ) {
		if ( ! $first instanceof \WC_Order || ! $second instanceof \WC_Order ) {
			return;
		}
		$first_is_sub = function_exists( 'wcs_is_subscription' ) && wcs_is_subscription( $first );
		$subscription = $first_is_sub ? $first : $second;
		$renewal      = $first_is_sub ? $second : $first;
		$vault        = (string) $subscription->get_meta( Recurring::META_VAULT );
		if ( '' !== $vault ) {
			Recurring::replace( $renewal, $vault, (string) $subscription->get_meta( Recurring::META_INITIAL_TXN ) );
		}
	}

	/**
	 * Whether the WooCommerce Subscriptions extension is active.
	 */
	public function is_active() {
		return class_exists( 'WC_Subscriptions' ) || class_exists( '\WC_Subscriptions' );
	}

	/**
	 * Charge the next subscription renewal.
	 *
	 * @param float     $amount       Amount to capture for this renewal.
	 * @param \WC_Order $renewal_order The renewal order being paid.
	 */
	public function process_renewal( $amount, $renewal_order ) {
		if ( ! $renewal_order instanceof \WC_Order ) {
			return;
		}

		// An unexpected error must fail this renewal cleanly (Subscriptions then applies its retry rules), never stop the scheduler.
		try {
			$this->charge_renewal( $amount, $renewal_order );
		} catch ( \Throwable $e ) {
			// The error text goes to the log only (it may name internals); the order note says what happened in plain words.
			Logger::error( 'Subscription renewal error: ' . $e->getMessage() );
			$charged = (string) $renewal_order->get_meta( self::META_CHARGE_TXN );
			if ( '' !== $charged ) {
				// The gateway already charged this renewal. Never mark it failed (Subscriptions would retry and charge again).
				$renewal_order->add_order_note(
					sprintf(
						/* translators: %s: gateway transaction ID */
						__( 'The renewal was charged (transaction %s), but an error happened afterwards, so the order may not be marked paid. It will not be charged again. Please check the order.', 'cardz3n-gateway' ),
						$charged
					)
				);
				return;
			}
			$renewal_order->add_order_note( __( 'Subscription renewal failed with an unexpected error. Details are in the CARDZ3N log.', 'cardz3n-gateway' ) );
			$renewal_order->update_status( 'failed' );
		}
	}

	/**
	 * The renewal charge itself (see process_renewal()).
	 *
	 * @param float     $amount        Amount to capture for this renewal.
	 * @param \WC_Order $renewal_order The renewal order being paid.
	 */
	private function charge_renewal( $amount, $renewal_order ) {

		// Never charge the same renewal twice (for example when the scheduled action runs again).
		if ( $renewal_order->is_paid() ) {
			return;
		}
		$already_charged = (string) $renewal_order->get_meta( self::META_CHARGE_TXN );
		if ( '' !== $already_charged ) {
			// A charge for this renewal already went through but the order was not completed (an error after the charge): finish it, never charge again.
			$renewal_order->add_order_note(
				sprintf(
					/* translators: %s: gateway transaction ID */
					__( 'A charge for this renewal already went through (transaction %s). It was not charged again.', 'cardz3n-gateway' ),
					$already_charged
				)
			);
			$renewal_order->payment_complete( $already_charged );
			return;
		}

		// The saved card: the subscription, then the first order, then the renewal order, then the customer's saved methods.
		$found       = Recurring::find_for_renewal( $renewal_order );
		$vault_id    = $found['vault_id'];
		$initial_txn = $found['initial_txn'];

		if ( empty( $vault_id ) ) {
			$renewal_order->add_order_note( __( 'Subscription renewal failed: no saved payment method was found for this subscription (not on the subscription, its first order, this order or the customer\'s saved methods).', 'cardz3n-gateway' ) );
			$renewal_order->update_status( 'failed' );
			return;
		}

		if ( '' === (string) $initial_txn ) {
			// ASSUMPTION A11: still charge (do not strand an older subscription), but say that the first transaction ID is missing.
			$renewal_order->add_order_note( __( 'The first transaction ID of this subscription is not known, so the renewal was sent without it. If the gateway or the card issuer questions it, use "Change payment method" on the subscription to save the card again.', 'cardz3n-gateway' ) );
		}

		$client = new Api_Client();
		$mapper = new Level3_Mapper();
		$level3 = $mapper->build( $renewal_order );

		$response = $client->transaction(
			array(
				'type'              => 'sale',
				'amount'            => $amount,
				'order_id'          => $renewal_order->get_id(),
				'currency'          => $renewal_order->get_currency(),
				'customer_vault_id' => $vault_id,
				'payment'           => 'creditcard', // vault knows the real type.
				'order_description' => 'WC Subscription renewal #' . $renewal_order->get_id(),
				'level3'            => $level3,
				'extra'             => Recurring::later_payment_fields( $initial_txn ), // ASSUMPTIONS A6 to A8, see Recurring.
				'billing'           => array(
					'first_name' => $renewal_order->get_billing_first_name(),
					'last_name'  => $renewal_order->get_billing_last_name(),
					'email'      => $renewal_order->get_billing_email(),
					'company'    => $renewal_order->get_billing_company(),
					'address1'   => $renewal_order->get_billing_address_1(),
					'city'       => $renewal_order->get_billing_city(),
					'state'      => $renewal_order->get_billing_state(),
					'zip'        => $renewal_order->get_billing_postcode(),
					'country'    => $renewal_order->get_billing_country(),
				),
			)
		);

		$extra = array(
			'payment_source_type' => 'card_vault',
			'transaction_type'    => 'renewal',
			'level3_sent'         => ! empty( $level3 ),
		);

		if ( $response['success'] ) {
			// First thing after a confirmed charge: remember it, so nothing that goes wrong next can cause a second charge.
			$renewal_order->update_meta_data( self::META_CHARGE_TXN, (string) $response['transaction_id'] );
			$renewal_order->save_meta_data();
			Order_Service::stamp( $renewal_order, $response, $extra );
			$renewal_order->payment_complete( $response['transaction_id'] );
			$renewal_order->add_order_note( Order_Service::success_note( $response, $extra ) );
		} else {
			$renewal_order->add_order_note( Order_Service::failure_note( $response, $extra ) );
			// ASSUMPTION: the gateway's text mentions the vault when the saved card no longer exists there.
			if ( false !== stripos( (string) $response['text'], 'vault' ) ) {
				$renewal_order->add_order_note( __( 'The saved card is no longer valid at the gateway. The customer needs to use "Change payment method" on the subscription.', 'cardz3n-gateway' ) );
			}
			$renewal_order->update_status( 'failed' );
		}
	}
}
