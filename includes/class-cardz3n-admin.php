<?php
/**
 * Admin-only hooks: capture-from-order-edit button, credential validator JS,
 * and WooCommerce → Status compatibility info.
 *
 * @package Cardz3n_Gateway
 */

namespace Cardz3n_Gateway;

defined( 'ABSPATH' ) || exit;

class Admin {

	private static $instance = null;
	public static function instance() {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	private function __construct() {
		add_action( 'admin_enqueue_scripts', array( $this, 'enqueue_admin_assets' ) );
		add_action( 'woocommerce_order_item_add_action_buttons', array( $this, 'render_capture_button' ) );
		add_action( 'wp_ajax_cardz3n_capture_order', array( $this, 'ajax_capture_order' ) );
	}

	public function enqueue_admin_assets( $hook ) {
		$is_settings = ( 'woocommerce_page_wc-settings' === $hook );
		$is_order    = ( 'post.php' === $hook || 'woocommerce_page_wc-orders' === $hook );

		if ( ! $is_settings && ! $is_order ) {
			return;
		}

		wp_enqueue_script(
			'cardz3n-admin',
			CARDZ3N_GW_URL . 'assets/js/admin-capture.js',
			array( 'jquery' ),
			CARDZ3N_GW_VERSION,
			true
		);

		wp_localize_script(
			'cardz3n-admin',
			'CARDZ3N_ADMIN',
			array(
				'ajaxUrl' => admin_url( 'admin-ajax.php' ),
				'nonce'   => wp_create_nonce( 'cardz3n_gw_nonce' ),
				'i18n'    => array(
					'confirmCapture' => __( 'Capture the full authorized amount for this order?', 'cardz3n-gateway' ),
					'captureOk'      => __( 'Capture successful.', 'cardz3n-gateway' ),
					'captureFailed'  => __( 'Capture failed.', 'cardz3n-gateway' ),
					'testing'        => __( 'Testing…', 'cardz3n-gateway' ),
				),
			)
		);
	}

	public function render_capture_button( $order ) {
		if ( ! $order instanceof \WC_Order ) {
			return;
		}
		if ( $order->get_payment_method() !== Brand::id() ) {
			return;
		}
		$authorized = (float) $order->get_meta( '_cardz3n_authorized_amount' );
		$captured   = (float) $order->get_meta( '_cardz3n_captured_amount' );
		$txn        = (string) $order->get_meta( '_cardz3n_transaction_id' );
		if ( $authorized <= 0 || $captured > 0 || empty( $txn ) ) {
			return;
		}
		printf(
			'<button type="button" class="button cardz3n-capture-btn" data-order="%d">%s</button>',
			(int) $order->get_id(),
			esc_html__( 'Capture Authorized Payment', 'cardz3n-gateway' )
		);
	}

	public function ajax_capture_order() {
		check_ajax_referer( 'cardz3n_gw_nonce', 'nonce' );
		if ( ! current_user_can( 'manage_woocommerce' ) ) {
			wp_send_json_error( array( 'msg' => __( 'Insufficient permissions.', 'cardz3n-gateway' ) ), 403 );
		}

		$order_id = isset( $_POST['order_id'] ) ? absint( $_POST['order_id'] ) : 0;
		$order    = wc_get_order( $order_id );
		if ( ! $order ) {
			wp_send_json_error( array( 'msg' => __( 'Order not found.', 'cardz3n-gateway' ) ), 404 );
		}

		$txn        = (string) $order->get_meta( '_cardz3n_transaction_id' );
		$authorized = (float) $order->get_meta( '_cardz3n_authorized_amount' );
		if ( empty( $txn ) || $authorized <= 0 ) {
			wp_send_json_error( array( 'msg' => __( 'Nothing to capture.', 'cardz3n-gateway' ) ), 400 );
		}

		$client = new Api_Client();
		$res    = $client->capture( $txn, $authorized );

		if ( ! $res['success'] ) {
			$order->add_order_note( sprintf(
				/* translators: 1: code, 2: text */
				__( 'CARDZ3N manual capture failed. Code %1$s: %2$s', 'cardz3n-gateway' ),
				$res['code'],
				$res['text']
			) );
			wp_send_json_error( array( 'msg' => $res['text'] ) );
		}

		$order->update_meta_data( '_cardz3n_captured_amount', (string) $authorized );
		$order->add_order_note( sprintf(
			/* translators: 1: amount, 2: txn id */
			__( 'CARDZ3N: captured %1$s on transaction %2$s.', 'cardz3n-gateway' ),
			wc_price( $authorized ),
			$txn
		) );
		$order->payment_complete( $res['transaction_id'] );
		$order->save();

		wp_send_json_success( array( 'msg' => __( 'Captured successfully.', 'cardz3n-gateway' ) ) );
	}
}
