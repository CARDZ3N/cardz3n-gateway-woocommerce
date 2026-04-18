<?php
/**
 * Refund / void trait for the main gateway class.
 *
 * Implements WooCommerce's `process_refund()` contract. Attempts a void first
 * when the transaction is unsettled and the refund covers the full captured
 * amount, otherwise performs a refund or credit as appropriate.
 *
 * @package Cardz3n_Gateway
 */

namespace Cardz3n_Gateway;

defined( 'ABSPATH' ) || exit;

trait Refunds_Trait {

	/**
	 * @param int        $order_id
	 * @param float|null $amount
	 * @param string     $reason
	 * @return bool|\WP_Error
	 */
	public function process_refund( $order_id, $amount = null, $reason = '' ) {
		$order = wc_get_order( $order_id );
		if ( ! $order ) {
			return new \WP_Error( 'cardz3n_no_order', __( 'Order not found.', 'cardz3n-gateway' ) );
		}

		$txn = (string) $order->get_meta( '_cardz3n_transaction_id' );
		if ( empty( $txn ) ) {
			return new \WP_Error( 'cardz3n_no_txn', __( 'No CARDZ3N transaction ID on this order.', 'cardz3n-gateway' ) );
		}

		$client   = new Api_Client( $this->settings );
		$total    = (float) $order->get_total();
		$refund_amount = null === $amount ? $total : (float) $amount;

		// Prefer VOID for unsettled, full-amount refunds.
		$is_full = abs( $refund_amount - $total ) < 0.01;
		$void_attempted = false;

		if ( $is_full ) {
			$void_attempted = true;
			$res = $client->void( $txn );
			if ( $res['success'] ) {
				$order->add_order_note( sprintf(
					/* translators: 1: txn id, 2: reason */
					__( 'CARDZ3N: voided transaction %1$s. Reason: %2$s', 'cardz3n-gateway' ),
					$txn,
					$reason ? $reason : '—'
				) );
				return true;
			}
			// Fall through to refund on void failure.
			Logger::info( 'Void failed; falling back to refund', array( 'code' => $res['code'], 'text' => $res['text'] ) );
		}

		$res = $client->refund( $txn, $refund_amount );

		if ( $res['success'] ) {
			$order->add_order_note( sprintf(
				/* translators: 1: amount, 2: txn id, 3: refund txn id, 4: reason */
				__( 'CARDZ3N: refunded %1$s from transaction %2$s. Refund ID: %3$s. Reason: %4$s', 'cardz3n-gateway' ),
				wc_price( $refund_amount ),
				$txn,
				$res['transaction_id'],
				$reason ? $reason : '—'
			) );
			return true;
		}

		$msg = sprintf(
			/* translators: 1: code, 2: text */
			__( 'CARDZ3N refund failed. Code %1$s: %2$s', 'cardz3n-gateway' ),
			$res['code'],
			$res['text']
		);
		$order->add_order_note( $msg );

		return new \WP_Error( 'cardz3n_refund_failed', $msg );
	}
}
