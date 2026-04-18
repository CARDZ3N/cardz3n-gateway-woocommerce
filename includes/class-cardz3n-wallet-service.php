<?php
/**
 * Wallet service — Apple Pay / Google Pay.
 *
 * Both wallets ride on NMI Collect.js, which handles device/eligibility detection
 * and delivers a payment_token to our server. All we do server-side is mark the
 * order as wallet-sourced for reporting.
 *
 * @package Cardz3n_Gateway
 */

namespace Cardz3n_Gateway;

defined( 'ABSPATH' ) || exit;

class Wallet_Service {

	/**
	 * Wallet source inferred from the browser-reported token type field.
	 *
	 * Collect.js returns response.tokenType like: 'applePay', 'googlePay', 'creditcard', 'check'.
	 */
	public static function normalize_source( $token_type ) {
		$type = strtolower( (string) $token_type );
		if ( false !== strpos( $type, 'apple' ) ) {
			return 'apple_pay';
		}
		if ( false !== strpos( $type, 'google' ) ) {
			return 'google_pay';
		}
		if ( 'check' === $type || 'ach' === $type ) {
			return 'ach';
		}
		return 'card';
	}

	/**
	 * Whether Apple Pay is enabled in settings.
	 */
	public static function apple_enabled() {
		$s = get_option( 'woocommerce_' . Brand::id() . '_settings', array() );
		return isset( $s['enable_apple_pay'] ) && 'yes' === $s['enable_apple_pay'];
	}

	public static function google_enabled() {
		$s = get_option( 'woocommerce_' . Brand::id() . '_settings', array() );
		return isset( $s['enable_google_pay'] ) && 'yes' === $s['enable_google_pay'];
	}
}
