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

		$hook = 'woocommerce_scheduled_subscription_payment_' . Brand::id();
		add_action( $hook, array( $this, 'process_renewal' ), 10, 2 );
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

		$subscriptions = function_exists( 'wcs_get_subscriptions_for_renewal_order' )
			? wcs_get_subscriptions_for_renewal_order( $renewal_order )
			: array();

		$vault_id = '';
		foreach ( $subscriptions as $sub ) {
			$vault_id = (string) $sub->get_meta( '_cardz3n_customer_vault_id' );
			if ( ! empty( $vault_id ) ) {
				break;
			}
		}

		if ( empty( $vault_id ) ) {
			$vault_id = (string) $renewal_order->get_meta( '_cardz3n_customer_vault_id' );
		}

		if ( empty( $vault_id ) ) {
			$renewal_order->add_order_note( __( 'Subscription renewal failed: no CARDZ3N vault reference on file.', 'cardz3n-gateway' ) );
			$renewal_order->update_status( 'failed' );
			return;
		}

		$client = new Api_Client();
		$mapper = new Level3_Mapper();
		$level3 = $mapper->build( $renewal_order );

		$response = $client->transaction(
			array(
				'type'              => 'sale',
				'amount'            => $amount,
				'order_id'          => $renewal_order->get_id(),
				'customer_vault_id' => $vault_id,
				'payment'          => 'creditcard', // vault knows the real type.
				'order_description' => 'WC Subscription renewal #' . $renewal_order->get_id(),
				'level3'            => $level3,
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
			Order_Service::stamp( $renewal_order, $response, $extra );
			$renewal_order->payment_complete( $response['transaction_id'] );
			$renewal_order->add_order_note( Order_Service::success_note( $response, $extra ) );
		} else {
			$renewal_order->add_order_note( Order_Service::failure_note( $response, $extra ) );
			$renewal_order->update_status( 'failed' );
		}
	}
}
