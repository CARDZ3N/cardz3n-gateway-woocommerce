<?php
/**
 * Admin-only hooks: capture-from-order-edit button, credential validator JS,
 * and WooCommerce → Status compatibility info.
 *
 * @package Cardz3n_Gateway
 */

namespace Cardz3n_Gateway;

defined( 'ABSPATH' ) || exit;

/**
 * Admin-only hooks and screens for the CARDZ3N gateway.
 */
class Admin {

	/**
	 * Singleton instance.
	 *
	 * @var Admin|null
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
	 * Register admin-side hooks.
	 */
	private function __construct() {
		add_action( 'admin_enqueue_scripts', array( $this, 'enqueue_admin_assets' ) );
		add_action( 'woocommerce_order_item_add_action_buttons', array( $this, 'render_capture_button' ) );
		add_action( 'wp_ajax_cardz3n_capture_order', array( $this, 'ajax_capture_order' ) );

		// Surface availability reason on the gateway settings page.
		add_action( 'admin_notices', array( $this, 'maybe_render_availability_notice' ) );

		/*
		 * Gateway AJAX endpoints are registered here — not in the Gateway class —
		 * because the Gateway is only instantiated when WooCommerce builds its
		 * `woocommerce_payment_gateways` list. On a plain admin-ajax.php request,
		 * that list is never built, so hooks registered in the Gateway constructor
		 * never fire and WordPress returns HTTP 400 with an empty auth-check body.
		 * Registering here (inside the Admin bootstrap, which runs on every
		 * `is_admin()` request including admin-ajax) guarantees reachability.
		 */
		add_action( 'wp_ajax_cardz3n_validate_credentials', array( $this, 'ajax_validate_credentials' ) );
		add_action( 'wp_ajax_cardz3n_delete_token', array( $this, 'ajax_delete_token' ) );
	}

	/**
	 * AJAX: Validate the saved gateway credentials.
	 *
	 * Reads the Security Key directly from saved options (not POST, which carries
	 * a masked value). Returns HTTP 200 + success:false for every business-logic
	 * failure, reserving 400 for transport/auth problems (stale nonce, no cap).
	 */
	public function ajax_validate_credentials() {
		if ( ! current_user_can( 'manage_woocommerce' ) ) {
			wp_send_json_error( array( 'msg' => __( 'Insufficient permissions.', 'cardz3n-gateway' ) ), 403 );
		}
		if ( ! check_ajax_referer( 'cardz3n_gw_nonce', 'nonce', false ) ) {
			wp_send_json_error(
				array( 'msg' => __( 'Invalid session. Reload the settings page and try again.', 'cardz3n-gateway' ) ),
				400
			);
		}

		// Fresh read from the options table — admin form masks the key once saved.
		$client = new Api_Client( null );

		if ( ! $client->has_credentials() ) {
			wp_send_json_error(
				array(
					'ok'  => false,
					'msg' => __( 'Save changes first — no Security Key on file for the active mode.', 'cardz3n-gateway' ),
				)
			);
		}

		$result = $client->validate_credentials();

		if ( is_wp_error( $result ) ) {
			wp_send_json_error(
				array(
					'ok'  => false,
					'msg' => $result->get_error_message(),
				)
			);
		}

		if ( ! empty( $result['ok'] ) ) {
			wp_send_json_success( $result );
		}

		wp_send_json_error(
			array(
				'ok'  => false,
				'msg' => isset( $result['msg'] ) ? $result['msg'] : __( 'Gateway rejected the credentials.', 'cardz3n-gateway' ),
			)
		);
	}

	/**
	 * AJAX: Delete a saved payment token from the customer's vault.
	 */
	public function ajax_delete_token() {
		if ( ! check_ajax_referer( 'cardz3n_gw_nonce', 'nonce', false ) ) {
			wp_send_json_error( array( 'msg' => __( 'Invalid session.', 'cardz3n-gateway' ) ), 400 );
		}
		$token_id = isset( $_POST['token_id'] ) ? absint( wp_unslash( $_POST['token_id'] ) ) : 0;
		$token    = \WC_Payment_Tokens::get( $token_id );
		if ( ! $token || $token->get_user_id() !== get_current_user_id() ) {
			wp_send_json_error( array( 'msg' => __( 'Invalid token.', 'cardz3n-gateway' ) ), 400 );
		}
		$token->delete();
		wp_send_json_success();
	}

	/**
	 * Render an admin notice on the CARDZ3N gateway settings page explaining
	 * why the gateway is not appearing on the checkout (if it's not).
	 *
	 * Reads the transient set by Gateway::remember_availability_reason() which
	 * is refreshed every time is_available() is called on a frontend request.
	 */
	public function maybe_render_availability_notice() {
		if ( ! current_user_can( 'manage_woocommerce' ) ) {
			return;
		}
		// Only show on the CARDZ3N gateway settings page, not everywhere in wp-admin.
		if ( empty( $_GET['section'] ) || Brand::id() !== $_GET['section'] ) { // phpcs:ignore WordPress.Security.NonceVerification.Recommended
			return;
		}

		$reason = get_transient( 'cardz3n_gw_last_avail_' . Brand::id() );
		if ( empty( $reason ) ) {
			$msg   = __( 'Status: This gateway has not yet been evaluated on a frontend page. Visit the checkout page once while logged in to populate the status here.', 'cardz3n-gateway' );
			$class = 'notice-info';
		} elseif ( 'available' === $reason ) {
			$msg   = __( 'Status: Gateway is available on the checkout page.', 'cardz3n-gateway' );
			$class = 'notice-success';
		} else {
			$reasons = array(
				'disabled'           => __( 'The "Enabled" toggle at the top of this page is off. Turn it on and Save changes.', 'cardz3n-gateway' ),
				'https_required'     => __( 'Live mode requires HTTPS on the checkout page, but the checkout request did not appear to be HTTPS. This can happen on hosts that terminate TLS at a reverse proxy without forwarding X-Forwarded-Proto. Turn on Sandbox Mode to test, or fix the site HTTPS/proxy configuration.', 'cardz3n-gateway' ),
				'no_credentials'     => __( 'No Security Key is saved for the currently active mode. If Sandbox Mode is ON, the Sandbox Security Key must be filled in. If Sandbox Mode is OFF, the Live Security Key must be filled in.', 'cardz3n-gateway' ),
				'parent_unavailable' => __( 'WooCommerce itself is hiding this gateway. The most common cause is a currency/country restriction on the gateway, or the shopper\'s cart contents not matching the allowed product/category rules. Check WooCommerce → Settings → General for currency, and verify no filters are restricting this gateway.', 'cardz3n-gateway' ),
			);
			$msg     = isset( $reasons[ $reason ] )
				? $reasons[ $reason ]
				: sprintf( /* translators: %s: machine reason code */ __( 'Gateway is hidden. Reason code: %s', 'cardz3n-gateway' ), esc_html( $reason ) );
			$msg     = __( 'Status: Gateway is NOT appearing on the checkout.', 'cardz3n-gateway' ) . ' ' . $msg;
			$class   = 'notice-warning';
		}

		printf(
			'<div class="notice %1$s is-dismissible"><p><strong>CARDZ3N Gateway</strong> — %2$s</p></div>',
			esc_attr( $class ),
			esc_html( $msg )
		);
	}

	/**
	 * Enqueue admin JS/CSS on the settings and order-edit screens.
	 *
	 * @param string $hook Current admin page hook suffix.
	 */
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

	/**
	 * Render a capture button on the order-edit screen when eligible.
	 *
	 * @param \WC_Order $order Order being viewed/edited.
	 */
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

	/**
	 * AJAX: Capture the authorized amount for an order.
	 */
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
			$order->add_order_note(
				sprintf(
				/* translators: 1: code, 2: text */
					__( 'CARDZ3N manual capture failed. Code %1$s: %2$s', 'cardz3n-gateway' ),
					$res['code'],
					$res['text']
				)
			);
			wp_send_json_error( array( 'msg' => $res['text'] ) );
		}

		$order->update_meta_data( '_cardz3n_captured_amount', (string) $authorized );
		$order->add_order_note(
			sprintf(
			/* translators: 1: amount, 2: txn id */
				__( 'CARDZ3N: captured %1$s on transaction %2$s.', 'cardz3n-gateway' ),
				wc_price( $authorized ),
				$txn
			)
		);
		$order->payment_complete( $res['transaction_id'] );
		$order->save();

		wp_send_json_success( array( 'msg' => __( 'Captured successfully.', 'cardz3n-gateway' ) ) );
	}
}
