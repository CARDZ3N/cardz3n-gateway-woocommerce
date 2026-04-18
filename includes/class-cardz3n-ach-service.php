<?php
/**
 * ACH / eCheck capability module.
 *
 * All ACH collection is tokenized via Collect.js — the plugin never sees raw
 * routing/account numbers. Server-side we pass payment='check' to transact.php
 * along with the Collect.js payment_token (or a stored customer_vault_id).
 *
 * @package Cardz3n_Gateway
 */

namespace Cardz3n_Gateway;

defined( 'ABSPATH' ) || exit;

class ACH_Service {

	public static function enabled() {
		$s = get_option( 'woocommerce_' . Brand::id() . '_settings', array() );
		return isset( $s['enable_ach'] ) && 'yes' === $s['enable_ach'];
	}

	/**
	 * Whether tokenized ACH reuse is allowed. NMI's behavior depends on the
	 * sponsor bank, so we expose this as a merchant toggle that defaults off.
	 */
	public static function reuse_allowed() {
		$s = get_option( 'woocommerce_' . Brand::id() . '_settings', array() );
		return isset( $s['enable_ach_reuse'] ) && 'yes' === $s['enable_ach_reuse'];
	}
}
