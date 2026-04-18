<?php
/**
 * WooCommerce Pre-Orders integration (conditional).
 *
 * Pre-Orders uses tokenized authorization now, charge later. We declare support
 * and, when a pre-order is released, run a capture or vault-sale.
 *
 * @package Cardz3n_Gateway
 */

namespace Cardz3n_Gateway;

defined( 'ABSPATH' ) || exit;

class Preorders_Service {

	private static $instance = null;

	public static function instance() {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	private function __construct() {
		if ( ! class_exists( 'WC_Pre_Orders' ) ) {
			return;
		}
		add_action( 'wc_pre_orders_process_pre_order_completion_payment_' . Brand::id(), array( $this, 'process_release' ) );
	}

	/**
	 * Charge the pre-order when fulfillment is triggered.
	 */
	public function process_release( $order ) {
		if ( ! $order instanceof \WC_Order ) {
			return;
		}

		$vault_id = (string) $order->get_meta( '_cardz3n_customer_vault_id' );
		$amount   = $order->get_total();

		if ( empty( $vault_id ) ) {
			$order->add_order_note( __( 'Pre-order release failed: no vault reference on file.', 'cardz3n-gateway' ) );
			$order->update_status( 'failed' );
			return;
		}

		$client = new Api_Client();
		$mapper = new Level3_Mapper();
		$level3 = $mapper->build( $order );

		$response = $client->transaction(
			array(
				'type'              => 'sale',
				'amount'            => $amount,
				'order_id'          => $order->get_id(),
				'customer_vault_id' => $vault_id,
				'order_description' => 'WC Pre-order release #' . $order->get_id(),
				'level3'            => $level3,
			)
		);

		$extra = array(
			'payment_source_type' => 'card_vault',
			'transaction_type'    => 'preorder_release',
			'level3_sent'         => ! empty( $level3 ),
		);

		if ( $response['success'] ) {
			Order_Service::stamp( $order, $response, $extra );
			$order->payment_complete( $response['transaction_id'] );
			$order->add_order_note( Order_Service::success_note( $response, $extra ) );
		} else {
			$order->add_order_note( Order_Service::failure_note( $response, $extra ) );
			$order->update_status( 'failed' );
		}
	}
}
