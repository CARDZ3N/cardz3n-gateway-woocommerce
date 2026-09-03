<?php
/**
 * Compatibility trait — computes the WooCommerce `supports` array dynamically
 * based on the merchant's configuration and installed extensions.
 *
 * @package Cardz3n_Gateway
 */

namespace Cardz3n_Gateway;

defined( 'ABSPATH' ) || exit;

trait Compatibility_Trait {

	/**
	 * Compute the WooCommerce `supports` array dynamically based on the
	 * merchant's saved settings and installed extensions (Subscriptions,
	 * Pre-Orders).
	 *
	 * @return string[] Supported feature keys.
	 */
	public function build_supports_array() {
		$s = $this->settings;

		$supports = array( 'products', 'refunds' );

			if ( 'yes' === ( $s['enable_saved_methods'] ?? 'no' ) ) {
			$supports[] = 'tokenization';
			$supports[] = 'add_payment_method';
		}

		// WC Subscriptions support flags, only meaningful when installed.
			if ( 'yes' === ( $s['enable_subscriptions'] ?? 'no' ) && ( class_exists( 'WC_Subscriptions' ) || class_exists( '\WC_Subscriptions' ) ) ) {
			$supports = array_merge(
				$supports,
				array(
					'subscriptions',
					'subscription_cancellation',
					'subscription_suspension',
					'subscription_reactivation',
					'subscription_amount_changes',
					'subscription_date_changes',
					'subscription_payment_method_change',
					'subscription_payment_method_change_customer',
					'subscription_payment_method_change_admin',
					'multiple_subscriptions',
				)
			);
		}

			if ( 'yes' === ( $s['enable_preorders'] ?? 'no' ) && class_exists( 'WC_Pre_Orders' ) ) {
			$supports[] = 'pre-orders';
		}

		return array_values( array_unique( $supports ) );
	}

	/**
	 * Whether the plugin is running on a reasonably current environment.
	 */
	public static function environment_ok() {
		global $wp_version;
		if ( version_compare( PHP_VERSION, '7.4', '<' ) ) {
			return false;
		}
		if ( version_compare( $wp_version, '6.4', '<' ) ) {
			return false;
		}
		if ( defined( 'WC_VERSION' ) && version_compare( WC_VERSION, '8.0', '<' ) ) {
			return false;
		}
		return true;
	}
}
