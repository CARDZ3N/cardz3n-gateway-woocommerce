<?php
/**
 * CARDZ3N Gateway for WooCommerce — uninstall cleanup.
 *
 * Fires only when the user deletes the plugin via WP Admin → Plugins → Delete
 * (not on deactivation). Removes plugin options so no merchant secrets or
 * settings remain. Order-level meta (`_cardz3n_*`) is intentionally preserved
 * so historical orders retain their audit trail — deleting those would break
 * refund reconciliation for past transactions.
 *
 * To remove ALL traces including order meta, set the constant
 * `CARDZ3N_GW_DELETE_ORDER_META` to `true` in wp-config.php before deleting.
 *
 * @package Cardz3n_Gateway
 */

// Only run when WordPress has invoked this file during plugin deletion.
if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
	exit;
}

global $wpdb;

/*
 * 1. Delete plugin options.
 *    Covers both brand variants (cardz3n + aerospacepay) and both legacy and
 *    current option key formats.
 */
$options = array(
	'woocommerce_cardz3n_gateway_settings',
	'woocommerce_aerospacepay_gateway_settings',
	'cardz3n_gw_version',
	'cardz3n_gw_activated_at',
);

foreach ( $options as $opt ) {
	delete_option( $opt );
	delete_site_option( $opt );
}

/*
 * 2. Delete transients created by the plugin.
 */
$transients = $wpdb->get_col(
	"SELECT option_name FROM {$wpdb->options}
	 WHERE option_name LIKE '\\_transient\\_cardz3n\\_gw\\_%'
	    OR option_name LIKE '\\_transient\\_timeout\\_cardz3n\\_gw\\_%'"
);

foreach ( (array) $transients as $transient_name ) {
	delete_option( $transient_name );
}

/*
 * 3. Optionally delete order-level meta.
 *    OFF by default — preserves audit trail. Merchant opts in via wp-config.php.
 */
if ( defined( 'CARDZ3N_GW_DELETE_ORDER_META' ) && true === CARDZ3N_GW_DELETE_ORDER_META ) {
	// Classic posts-based order store.
	$wpdb->query(
		"DELETE FROM {$wpdb->postmeta} WHERE meta_key LIKE '\\_cardz3n\\_%'"
	);

	// HPOS (custom order tables).
	$hpos_meta_table = $wpdb->prefix . 'wc_orders_meta';
	$table_exists    = $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', $hpos_meta_table ) );
	if ( $table_exists === $hpos_meta_table ) {
		$wpdb->query(
			"DELETE FROM {$hpos_meta_table} WHERE meta_key LIKE '\\_cardz3n\\_%'"
		);
	}
}

/*
 * 4. Delete WooCommerce payment tokens owned by the plugin.
 *    Saved card/ACH tokens reference the now-gone NMI Customer Vault, so
 *    they are not useful after uninstall.
 */
$token_tables = array(
	$wpdb->prefix . 'woocommerce_payment_tokens',
);
foreach ( $token_tables as $tbl ) {
	$exists = $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', $tbl ) );
	if ( $exists === $tbl ) {
		$wpdb->query(
			$wpdb->prepare(
				"DELETE FROM {$tbl} WHERE gateway_id IN (%s, %s)",
				'cardz3n_gateway',
				'aerospacepay_gateway'
			)
		);
	}
}
