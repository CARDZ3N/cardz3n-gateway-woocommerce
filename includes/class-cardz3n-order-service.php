<?php
/**
 * Order service — applies CARDZ3N metadata and notes to WooCommerce orders,
 * and implements the optional auto-capture-on-status-change rule.
 *
 * @package Cardz3n_Gateway
 */

namespace Cardz3n_Gateway;

defined( 'ABSPATH' ) || exit;

class Order_Service {

	/**
	 * Stamp the standard CARDZ3N order meta after a successful transaction.
	 *
	 * @param \WC_Order $order
	 * @param array     $response Parsed Api_Client response.
	 * @param array     $extra
	 */
	public static function stamp( \WC_Order $order, array $response, array $extra = array() ) {
		$meta = array(
			'_cardz3n_transaction_id'      => $response['transaction_id'] ?? '',
			'_cardz3n_result_code'         => $response['code'] ?? '',
			'_cardz3n_result_text'         => $response['text'] ?? '',
			'_cardz3n_auth_code'           => $response['auth_code'] ?? '',
			'_cardz3n_avs_result'          => $response['avs'] ?? '',
			'_cardz3n_customer_vault_id'   => $response['customer_vault_id'] ?? '',
			'_cardz3n_payment_source_type' => $extra['payment_source_type'] ?? 'card',
			'_cardz3n_transaction_type'    => $extra['transaction_type'] ?? 'sale',
			'_cardz3n_descriptor_sent'     => $extra['descriptor'] ?? '',
			'_cardz3n_level3_sent'         => ! empty( $extra['level3_sent'] ) ? 'yes' : 'no',
		);

		if ( isset( $extra['authorized_amount'] ) ) {
			$meta['_cardz3n_authorized_amount'] = (string) $extra['authorized_amount'];
		}
		if ( isset( $extra['captured_amount'] ) ) {
			$meta['_cardz3n_captured_amount'] = (string) $extra['captured_amount'];
		}
		if ( ! empty( $extra['po_number'] ) ) {
			$meta['_cardz3n_po_number'] = sanitize_text_field( $extra['po_number'] );
		}

		foreach ( $meta as $k => $v ) {
			$order->update_meta_data( $k, $v );
		}
		$order->save_meta_data();
	}

	/**
	 * Build a concise, human-readable order note for success.
	 */
	public static function success_note( array $response, array $extra = array() ) {
		$source = strtoupper( $extra['payment_source_type'] ?? 'card' );
		$type   = strtoupper( $extra['transaction_type'] ?? 'sale' );
		$note   = sprintf(
			/* translators: 1: transaction type, 2: source, 3: txn id, 4: auth code */
			__( '%1$s via %2$s approved. Transaction ID: %3$s. Auth: %4$s.', 'cardz3n-gateway' ),
			$type,
			$source,
			$response['transaction_id'] ?? '',
			$response['auth_code'] ?? ''
		);
		if ( ! empty( $extra['level3_sent'] ) ) {
			$note .= ' ' . __( 'Level 3 data transmitted.', 'cardz3n-gateway' );
		}
		return $note;
	}

	public static function failure_note( array $response, array $extra = array() ) {
		$source = strtoupper( $extra['payment_source_type'] ?? 'card' );
		return sprintf(
			/* translators: 1: source, 2: code, 3: message */
			__( '%1$s payment declined. Code %2$s: %3$s', 'cardz3n-gateway' ),
			$source,
			$response['code'] ?? '',
			$response['text'] ?? ''
		);
	}

	/**
	 * Auto-capture rule: when the merchant configured a trigger status and an
	 * order transitions into it, capture any outstanding authorization.
	 */
	public static function maybe_auto_capture( $order_id, $_old, $new_status, $order ) {
		if ( ! $order instanceof \WC_Order ) {
			$order = wc_get_order( $order_id );
		}
		if ( ! $order || $order->get_payment_method() !== Brand::id() ) {
			return;
		}

		$settings = get_option( 'woocommerce_' . Brand::id() . '_settings', array() );
		$trigger  = $settings['auto_capture_status'] ?? '';

		if ( empty( $trigger ) ) {
			return;
		}

		if ( 'wc-' . $new_status !== $trigger && $new_status !== str_replace( 'wc-', '', $trigger ) ) {
			return;
		}

		$authorized = (float) $order->get_meta( '_cardz3n_authorized_amount' );
		$captured   = (float) $order->get_meta( '_cardz3n_captured_amount' );
		$txn        = (string) $order->get_meta( '_cardz3n_transaction_id' );

		if ( $authorized <= 0 || $captured > 0 || empty( $txn ) ) {
			return;
		}

		$client = new Api_Client( $settings );
		$res    = $client->capture( $txn, $authorized );

		if ( $res['success'] ) {
			$order->update_meta_data( '_cardz3n_captured_amount', (string) $authorized );
			$order->add_order_note(
				sprintf(
				/* translators: 1: amount, 2: txn id */
					__( 'Auto-captured %1$s on transaction %2$s.', 'cardz3n-gateway' ),
					wc_price( $authorized ),
					$txn
				)
			);
			$order->save();
		} else {
			$order->add_order_note(
				sprintf(
				/* translators: 1: code, 2: message */
					__( 'Auto-capture failed. Code %1$s: %2$s', 'cardz3n-gateway' ),
					$res['code'],
					$res['text']
				)
			);
		}
	}
}

add_action( 'woocommerce_order_status_changed', array( 'Cardz3n_Gateway\Order_Service', 'maybe_auto_capture' ), 20, 4 );
