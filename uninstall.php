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
 * Notes on the PHPCS ignore comments in this file:
 *   - Uninstall runs exactly once, at plugin deletion, so object-cache reads
 *     or writes are meaningless — the relevant caches (options, transients,
 *     payment tokens) are invalidated by the same deletes. Therefore
 *     `WordPress.DB.DirectDatabaseQuery.NoCaching` and `DirectQuery` are
 *     suppressed with justification where we must touch the DB directly.
 *   - Table names are never user input: they are built from the hard-coded
 *     WordPress prefix plus a hard-coded suffix, and are additionally
 *     verified to exist via `SHOW TABLES LIKE %s` before use.
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
$cardz3n_options = array(
	'woocommerce_cardz3n_gateway_settings',
	'woocommerce_aerospacepay_gateway_settings',
	'cardz3n_gw_version',
	'cardz3n_gw_activated_at',
);

foreach ( $cardz3n_options as $cardz3n_opt ) {
	delete_option( $cardz3n_opt );
	delete_site_option( $cardz3n_opt );
}

/*
 * 2. Delete transients created by the plugin.
 *    We look up the raw `_transient_*` option rows so we can route every hit
 *    through delete_transient()/delete_site_transient(), which also flushes
 *    the object cache for us.
 */
// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching -- Uninstall runs once; no caching layer is relevant, and the option rows are removed in the same pass.
$cardz3n_transient_rows = $wpdb->get_col(
	"SELECT option_name FROM {$wpdb->options}
	 WHERE option_name LIKE '\\_transient\\_cardz3n\\_gw\\_%'
	    OR option_name LIKE '\\_transient\\_timeout\\_cardz3n\\_gw\\_%'
	    OR option_name LIKE '\\_site\\_transient\\_cardz3n\\_gw\\_%'
	    OR option_name LIKE '\\_site\\_transient\\_timeout\\_cardz3n\\_gw\\_%'"
);

foreach ( (array) $cardz3n_transient_rows as $cardz3n_transient_row ) {
	if ( 0 === strpos( $cardz3n_transient_row, '_site_transient_timeout_' ) ) {
		delete_site_transient( substr( $cardz3n_transient_row, strlen( '_site_transient_timeout_' ) ) );
	} elseif ( 0 === strpos( $cardz3n_transient_row, '_site_transient_' ) ) {
		delete_site_transient( substr( $cardz3n_transient_row, strlen( '_site_transient_' ) ) );
	} elseif ( 0 === strpos( $cardz3n_transient_row, '_transient_timeout_' ) ) {
		delete_transient( substr( $cardz3n_transient_row, strlen( '_transient_timeout_' ) ) );
	} elseif ( 0 === strpos( $cardz3n_transient_row, '_transient_' ) ) {
		delete_transient( substr( $cardz3n_transient_row, strlen( '_transient_' ) ) );
	}
}

/*
 * 3. Optionally delete order-level meta.
 *    OFF by default — preserves audit trail. Merchant opts in via wp-config.php.
 */
if ( defined( 'CARDZ3N_GW_DELETE_ORDER_META' ) && true === CARDZ3N_GW_DELETE_ORDER_META ) {

	// 3a. Classic posts-based order store.
	// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching -- Uninstall runs once; no caching layer is relevant.
	$wpdb->query(
		$wpdb->prepare(
			"DELETE FROM {$wpdb->postmeta} WHERE meta_key LIKE %s",
			$wpdb->esc_like( '_cardz3n_' ) . '%'
		)
	);

	// 3b. HPOS (custom order tables).
	// Table name is hard-coded plus the WP prefix, and verified via SHOW TABLES
	// before use, so identifier interpolation is safe.
	$cardz3n_hpos_table = $wpdb->prefix . 'wc_orders_meta';

	// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching -- Schema probe; not cacheable by design.
	$cardz3n_hpos_exists = $wpdb->get_var(
		$wpdb->prepare( 'SHOW TABLES LIKE %s', $cardz3n_hpos_table )
	);

	if ( $cardz3n_hpos_exists === $cardz3n_hpos_table ) {
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching,WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- Uninstall runs once; table name is a validated internal identifier (see SHOW TABLES check above), never user input. Value placeholders are still prepared.
		$wpdb->query(
			$wpdb->prepare(
				"DELETE FROM `{$cardz3n_hpos_table}` WHERE meta_key LIKE %s",
				$wpdb->esc_like( '_cardz3n_' ) . '%'
			)
		);
	}
}

/*
 * 4. Delete WooCommerce payment tokens owned by the plugin.
 *    Saved card/ACH tokens reference the now-gone NMI Customer Vault, so
 *    they are not useful after uninstall.
 */
$cardz3n_token_tables = array(
	$wpdb->prefix . 'woocommerce_payment_tokens',
);

foreach ( $cardz3n_token_tables as $cardz3n_token_table ) {

	// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching -- Schema probe; not cacheable by design.
	$cardz3n_token_exists = $wpdb->get_var(
		$wpdb->prepare( 'SHOW TABLES LIKE %s', $cardz3n_token_table )
	);

	if ( $cardz3n_token_exists === $cardz3n_token_table ) {
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching,WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- Uninstall runs once; table name is a validated internal identifier (see SHOW TABLES check above), never user input. Value placeholders are still prepared.
		$wpdb->query(
			$wpdb->prepare(
				"DELETE FROM `{$cardz3n_token_table}` WHERE gateway_id IN (%s, %s)",
				'cardz3n_gateway',
				'aerospacepay_gateway'
			)
		);
	}
}
