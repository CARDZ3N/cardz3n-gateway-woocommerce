<?php
/**
 * Brand configuration.
 *
 * Single source of truth for user-facing brand text, logos, and defaults.
 * Changing the CARDZ3N_GW_BRAND constant switches the plugin between
 * its supported brand variants without forking the codebase.
 *
 * @package Cardz3n_Gateway
 */

namespace Cardz3n_Gateway;

defined( 'ABSPATH' ) || exit;

class Brand {

	/**
	 * Returns the full brand profile for the active CARDZ3N_GW_BRAND value.
	 *
	 * @return array<string,mixed>
	 */
	public static function profile() {
		$brand = defined( 'CARDZ3N_GW_BRAND' ) ? CARDZ3N_GW_BRAND : 'cardz3n';

		$brands = array(
			'cardz3n'      => array(
				'id'                 => 'cardz3n',
				'gateway_id'         => 'cardz3n_gateway',
				'name'               => __( 'CARDZ3N Gateway', 'cardz3n-gateway' ),
				'short_name'         => __( 'CARDZ3N', 'cardz3n-gateway' ),
				'method_title'       => __( 'CARDZ3N Gateway', 'cardz3n-gateway' ),
				'method_description' => __( 'Accept credit/debit cards, ACH, Apple Pay, Google Pay, subscriptions, and B2B Level 3 data in a single embedded WooCommerce checkout.', 'cardz3n-gateway' ),
				'default_title'      => __( 'Credit Card, ACH, or Digital Wallet', 'cardz3n-gateway' ),
				'default_descriptor' => 'CARDZ3N',
				'support_url'        => 'https://cardz3n.com/support',
				'docs_url'           => 'https://cardz3n.com/docs/woocommerce',
				'primary_color'      => '#0a5cff',
				'accent_color'       => '#00c48c',
				'logo_file'          => 'logo-cardz3n.svg',
			),
			'aerospacepay' => array(
				'id'                 => 'aerospacepay',
				'gateway_id'         => 'aerospacepay_gateway',
				'name'               => __( 'AerospacePay', 'cardz3n-gateway' ),
				'short_name'         => __( 'AerospacePay', 'cardz3n-gateway' ),
				'method_title'       => __( 'AerospacePay Gateway', 'cardz3n-gateway' ),
				'method_description' => __( 'Specialized B2B payment acceptance for aerospace and defense suppliers, with automatic Level 3 commercial-card data, ACH, and purchase-order support.', 'cardz3n-gateway' ),
				'default_title'      => __( 'Commercial Card, Purchasing Card, or ACH', 'cardz3n-gateway' ),
				'default_descriptor' => 'AEROSPACEPAY',
				'support_url'        => 'https://aerospacepay.com/support',
				'docs_url'           => 'https://aerospacepay.com/docs/woocommerce',
				'primary_color'      => '#0b3d91',
				'accent_color'       => '#d64545',
				'logo_file'          => 'logo-aerospacepay.svg',
			),
		);

		$profile = isset( $brands[ $brand ] ) ? $brands[ $brand ] : $brands['cardz3n'];

		/**
		 * Allow white-label partners to override brand profile values.
		 *
		 * @param array  $profile Brand profile.
		 * @param string $brand   Active brand ID.
		 */
		return apply_filters( 'cardz3n_gw_brand_profile', $profile, $brand );
	}

	public static function id() {
		$p = self::profile();
		return $p['gateway_id'];
	}

	public static function name() {
		$p = self::profile();
		return $p['name'];
	}

	public static function get( $key, $default = '' ) {
		$p = self::profile();
		return isset( $p[ $key ] ) ? $p[ $key ] : $default;
	}
}
