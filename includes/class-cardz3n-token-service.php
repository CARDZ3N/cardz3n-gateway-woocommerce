<?php
/**
 * Token service — saved payment method management.
 *
 * Uses WooCommerce's native WC_Payment_Token APIs. We store only non-sensitive
 * metadata locally (last4, brand, expiry label) plus the CARDZ3N/NMI customer_vault_id
 * as the remote reference.
 *
 * @package Cardz3n_Gateway
 */

namespace Cardz3n_Gateway;

defined( 'ABSPATH' ) || exit;

/**
 * Persists and reads WooCommerce payment-token metadata.
 */
class Token_Service {

	/**
	 * Persist a credit-card token from a successful vault-creating transaction.
	 *
	 * @param int    $user_id    WooCommerce user ID.
	 * @param string $gateway_id 'cardz3n_gateway' or 'aerospacepay_gateway'.
	 * @param string $vault_id   NMI customer_vault_id.
	 * @param array  $card_info  ['last4','brand','exp_month','exp_year'].
	 * @param string $error      Receives the reason when nothing was saved.
	 * @return int|false             Token ID
	 */
	public static function save_card_token( $user_id, $gateway_id, $vault_id, array $card_info, &$error = null ) {
		if ( ! $user_id || empty( $vault_id ) ) {
			$error = 'no user or vault id';
			return false;
		}

		$token = new \WC_Payment_Token_CC();
		$token->set_token( $vault_id );
		$token->set_gateway_id( $gateway_id );
		$token->set_user_id( $user_id );
		$token->set_last4( $card_info['last4'] ?? '0000' );
		$token->set_expiry_month( $card_info['exp_month'] ?? '01' );
		$token->set_expiry_year( $card_info['exp_year'] ?? gmdate( 'Y' ) );
		$token->set_card_type( strtolower( $card_info['brand'] ?? 'credit' ) );
		$token->add_meta_data( 'cardz3n_vault_id', $vault_id, true );
		$token->add_meta_data( 'cardz3n_payment_source_type', 'card', true );
		if ( ! empty( $card_info['initial_txn_id'] ) ) {
			// Needed as `initial_transaction_id` on later merchant-initiated charges (ASSUMPTION A6/A7, see Recurring).
			$token->add_meta_data( 'cardz3n_initial_txn_id', (string) $card_info['initial_txn_id'], true );
			// Only a first transaction that was sent with the first-store flags may be reused as `initial_transaction_id`.
			if ( ! empty( $card_info['initial_flagged'] ) ) {
				$token->add_meta_data( 'cardz3n_initial_flagged', 'yes', true );
			}
		}
		try {
			$saved = $token->save();
		} catch ( \Exception $e ) {
			// A missing field in the gateway reply must never break a checkout that has already been charged.
			Logger::warning( 'Could not save the card as a WooCommerce saved method: ' . $e->getMessage() );
			$error = $e->getMessage();
			return false;
		}

		return $saved ? $token->get_id() : false;
	}

	/**
	 * Strictly validate a masked card number: the last four characters must be digits (for example 4xxxxxxxxxxx1111).
	 *
	 * @param mixed $value Masked number or last four digits.
	 * @return string Four digits, or '' when the value is not usable.
	 */
	public static function valid_last4( $value ) {
		$v = substr( trim( (string) $value ), -4 );
		return preg_match( '/^\d{4}$/', $v ) ? $v : '';
	}

	/**
	 * Strictly validate a card expiry given as MMYY, MM/YY, MMYYYY or MM/YYYY.
	 *
	 * @param mixed $value Expiry.
	 * @return array{month:string,year:string}|null Two-digit month and four-digit year, or null.
	 */
	public static function valid_expiry( $value ) {
		$digits = preg_replace( '/\D/', '', (string) $value );
		if ( 4 === strlen( $digits ) ) {
			$month = (int) substr( $digits, 0, 2 );
			$year  = 2000 + (int) substr( $digits, 2, 2 );
		} elseif ( 6 === strlen( $digits ) ) {
			$month = (int) substr( $digits, 0, 2 );
			$year  = (int) substr( $digits, 2, 4 );
		} else {
			return null;
		}
		if ( $month < 1 || $month > 12 || $year < 2000 || $year > 2100 ) {
			return null;
		}
		return array(
			'month' => sprintf( '%02d', $month ),
			'year'  => (string) $year,
		);
	}

	/**
	 * Work out last4, brand and expiry for a card that was just stored in the gateway's Customer Vault.
	 *
	 * The sale reply does not carry card details. Sources, best first: (1) the gateway's own vault record (server-side lookup),
	 * (2) card fields in the sale reply, if a gateway ever sends them, (3) the masked values the browser posted. Each is validated
	 * strictly; the last four digits and the expiry always come from the same source.
	 *
	 * @param string          $vault_id Customer vault ID.
	 * @param Api_Client|null $client   Gateway client (for the vault lookup).
	 * @param array           $reply    Raw sale reply.
	 * @param array           $browser  Masked values posted by the browser: last4, exp, brand.
	 * @return array{details:array|null,source:string,reason:string}
	 */
	public static function resolve_card_details( $vault_id, $client, array $reply, array $browser ) {
		$candidates = array();
		$reason     = '';
		if ( $client && method_exists( $client, 'lookup_vault' ) ) {
			$found = $client->lookup_vault( $vault_id );
			if ( $found['ok'] ) {
				$candidates['gateway vault record'] = array( $found['number'], $found['exp'], $found['type'] );
			} else {
				$reason = 'vault lookup: ' . $found['error'];
			}
		}
		if ( ! empty( $reply['cc_number'] ) ) {
			$candidates['sale reply'] = array( (string) $reply['cc_number'], (string) ( $reply['cc_exp'] ?? $reply['ccexp'] ?? '' ), (string) ( $reply['cc_type'] ?? $reply['card_type'] ?? '' ) );
		}
		if ( ! empty( $browser['last4'] ) ) {
			$candidates['browser'] = array( (string) $browser['last4'], (string) ( $browser['exp'] ?? '' ), (string) ( $browser['brand'] ?? '' ) );
		}
		// Brand: the first source that names a real brand.
		$brand = '';
		foreach ( $candidates as $c ) {
			$slug = brand_slug( $c[2] );
			if ( '' === $brand && 'credit' !== $slug ) {
				$brand = $slug;
			}
		}
		foreach ( $candidates as $source => $c ) {
			$last4 = self::valid_last4( $c[0] );
			$exp   = self::valid_expiry( $c[1] );
			if ( '' !== $last4 && null !== $exp ) {
				return array(
					'details' => array(
						'last4'     => $last4,
						'brand'     => '' !== $brand ? $brand : 'credit',
						'exp_month' => $exp['month'],
						'exp_year'  => $exp['year'],
					),
					'source'  => $source,
					'reason'  => '',
				);
			}
		}
		return array(
			'details' => null,
			'source'  => '',
			'reason'  => trim( ( '' !== $reason ? $reason . '; ' : '' ) . 'no source gave a valid last four digits and expiry date' ),
		);
	}

	/**
	 * Keep a card that was just stored in the Customer Vault as a WooCommerce saved method, and say what happened.
	 *
	 * Writes one order note (when an order is given) and one log line for the outcome: saved, or stored at the gateway but not
	 * saved (with the reason). Never throws and never writes a card number, vault ID or token to a note or log.
	 *
	 * @param int             $user_id    Customer.
	 * @param string          $gateway_id Gateway ID.
	 * @param string          $vault_id   Customer vault ID.
	 * @param array           $extra      Extra card info to keep: initial_txn_id, initial_flagged.
	 * @param Api_Client|null $client     Gateway client.
	 * @param array           $reply      Raw sale reply.
	 * @param array           $browser    Masked values posted by the browser: last4, exp, brand.
	 * @param \WC_Order|null  $order      Order or subscription to add the note to.
	 * @return int|false Saved method ID.
	 */
	public static function save_card_from_gateway( $user_id, $gateway_id, $vault_id, array $extra, $client, array $reply, array $browser, $order = null ) {
		$resolved = self::resolve_card_details( $vault_id, $client, $reply, $browser );
		$why      = $resolved['reason'];
		$id       = false;
		if ( $resolved['details'] ) {
			$info = array_merge( $extra, $resolved['details'] );
			$id = self::save_card_token( $user_id, $gateway_id, $vault_id, $info, $why );
		}
		if ( $id ) {
			Logger::info( 'Card saved as a WooCommerce saved method', array( 'details_from' => $resolved['source'] ) );
			if ( $order ) {
				$brand_label = function_exists( 'wc_get_credit_card_type_label' ) ? wc_get_credit_card_type_label( $resolved['details']['brand'] ) : $resolved['details']['brand'];
				/* translators: 1: card brand, 2: last four digits */
				$order->add_order_note( sprintf( __( 'Card saved for the customer\'s next order (%1$s ending %2$s).', 'cardz3n-gateway' ), $brand_label, $resolved['details']['last4'] ) );
			}
			return $id;
		}
		Logger::warning( 'Card stored at the gateway but not saved as a WooCommerce saved method', array( 'reason' => $why ) );
		if ( $order ) {
			/* translators: %s: reason */
			$order->add_order_note( sprintf( __( 'The card was stored at the gateway, but it could not be saved as a WooCommerce saved payment method (%s). It will not appear under My Account > Payment methods.', 'cardz3n-gateway' ), $why ) );
		}
		return false;
	}

	/**
	 * Persist an ACH token. Uses WC_Payment_Token_ECheck.
	 *
	 * @param int    $user_id    WooCommerce user ID.
	 * @param string $gateway_id 'cardz3n_gateway' or 'aerospacepay_gateway'.
	 * @param string $vault_id   NMI customer_vault_id.
	 * @param array  $ach_info   Bank account metadata.
	 */
	public static function save_ach_token( $user_id, $gateway_id, $vault_id, array $ach_info ) {
		if ( ! $user_id || empty( $vault_id ) ) {
			return false;
		}

		$token = new \WC_Payment_Token_ECheck();
		$token->set_token( $vault_id );
		$token->set_gateway_id( $gateway_id );
		$token->set_user_id( $user_id );
		$token->set_last4( $ach_info['last4'] ?? '0000' );
		$token->add_meta_data( 'cardz3n_vault_id', $vault_id, true );
		$token->add_meta_data( 'cardz3n_payment_source_type', 'ach', true );
		$token->add_meta_data( 'cardz3n_account_type', $ach_info['account_type'] ?? 'checking', true );
		try {
			$saved = $token->save();
		} catch ( \Exception $e ) {
			// Same rule as for cards: a missing field must never break a checkout that has already been charged.
			Logger::warning( 'Could not save the bank account as a WooCommerce saved method: ' . $e->getMessage() );
			return false;
		}

		return $saved ? $token->get_id() : false;
	}

	/**
	 * Delete the remote vault entry when a user deletes a token locally.
	 *
	 * Hooked via woocommerce_payment_token_deleted.
	 *
	 * @param int               $token_id Deleted token's post ID.
	 * @param \WC_Payment_Token $token    The token instance being deleted.
	 */
	public static function on_token_deleted( $token_id, $token ) {
		if ( ! $token instanceof \WC_Payment_Token ) {
			return;
		}
		if ( $token->get_gateway_id() !== Brand::id() ) {
			return;
		}

		$vault_id = $token->get_meta( 'cardz3n_vault_id' );
		if ( empty( $vault_id ) ) {
			$vault_id = $token->get_token();
		}

		if ( empty( $vault_id ) ) {
			return;
		}

		$client = new Api_Client();
		$result = $client->delete_vault( $vault_id );

		if ( $result['success'] ) {
			Logger::info( 'Deleted remote vault' );
		} else {
			Logger::warning(
				'Could not delete remote vault',
				array(
					'text' => $result['text'],
				)
			);
		}
	}
}

add_action( 'woocommerce_payment_token_deleted', array( 'Cardz3n_Gateway\Token_Service', 'on_token_deleted' ), 10, 2 );
