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
	 * @return int|false             Token ID
	 */
	public static function save_card_token( $user_id, $gateway_id, $vault_id, array $card_info ) {
		if ( ! $user_id || empty( $vault_id ) ) {
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
		$saved = $token->save();

		return $saved ? $token->get_id() : false;
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
		$saved = $token->save();

		return $saved ? $token->get_id() : false;
	}

	/**
	 * Delete the remote vault entry when a user deletes a token locally.
	 *
	 * Hooked via woocommerce_payment_token_deleted.
	  	 *
	 * @param int              $token_id Deleted token's post ID.
	 * @param \WC_Payment_Token $token    The token instance being deleted.
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
			Logger::info( 'Deleted remote vault', array( 'vault_id' => $vault_id ) );
		} else {
			Logger::warning(
				'Could not delete remote vault',
				array(
					'vault_id' => $vault_id,
					'text'     => $result['text'],
				)
			);
		}
	}
}

add_action( 'woocommerce_payment_token_deleted', array( 'Cardz3n_Gateway\Token_Service', 'on_token_deleted' ), 10, 2 );
