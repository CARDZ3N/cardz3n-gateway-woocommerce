<?php
/**
 * Plugin Name: CARDZ3N Gateway for WooCommerce
 * Plugin URI: https://cardz3n.com/woocommerce
 * Description: Embedded on-site checkout for WooCommerce powered by the CARDZ3N/NMI payment gateway. Cards, ACH, Apple Pay, Google Pay, saved methods, subscriptions, refunds, captures, voids, and automatic Level 2/3 commercial-card data in a single gateway UI.
 * Version: 1.0.4
 * Requires at least: 6.4
 * Requires PHP: 7.4
 * Requires Plugins: woocommerce
 * WC requires at least: 8.0
 * WC tested up to: 9.5
 * Author: CARDZ3N
 * Author URI: https://cardz3n.com
 * License: GPLv2 or later
 * License URI: https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain: cardz3n-gateway
 *
 * @package Cardz3n_Gateway
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/* -----------------------------------------------------------------------------
 * Plugin constants
 * -------------------------------------------------------------------------- */

define( 'CARDZ3N_GW_VERSION', '1.0.4' );
define( 'CARDZ3N_GW_FILE', __FILE__ );
define( 'CARDZ3N_GW_PATH', plugin_dir_path( __FILE__ ) );
define( 'CARDZ3N_GW_URL', plugin_dir_url( __FILE__ ) );
define( 'CARDZ3N_GW_BASENAME', plugin_basename( __FILE__ ) );

/**
 * Brand identity constant. Controls the user-facing brand of this build.
 *
 * Supported values:
 *  - 'cardz3n'       → CARDZ3N Gateway (default public distribution)
 *  - 'aerospacepay'  → AerospacePay Gateway (white-label build for aerospace/defense B2B)
 *
 * Change this line (or define CARDZ3N_GW_BRAND in wp-config.php) to ship a
 * white-labeled variant from the same codebase. All user-facing text,
 * icons, descriptors, and admin branding flow from includes/class-cardz3n-brand.php.
 */
if ( ! defined( 'CARDZ3N_GW_BRAND' ) ) {
	define( 'CARDZ3N_GW_BRAND', 'cardz3n' );
}

/* -----------------------------------------------------------------------------
 * HPOS compatibility declaration (WooCommerce 8+)
 * -------------------------------------------------------------------------- */

add_action(
	'before_woocommerce_init',
	function () {
		if ( class_exists( \Automattic\WooCommerce\Utilities\FeaturesUtil::class ) ) {
			\Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility( 'custom_order_tables', CARDZ3N_GW_FILE, true );
			\Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility( 'cart_checkout_blocks', CARDZ3N_GW_FILE, false );
		}
	}
);

/* -----------------------------------------------------------------------------
 * Bootstrapping
 * -------------------------------------------------------------------------- */

/**
 * Fail gracefully if WooCommerce is inactive.
 */
add_action( 'plugins_loaded', 'cardz3n_gw_bootstrap', 11 );

function cardz3n_gw_bootstrap() {
	if ( ! class_exists( 'WooCommerce' ) ) {
		add_action(
			'admin_notices',
			function () {
				echo '<div class="notice notice-error"><p>';
				esc_html_e( 'CARDZ3N Gateway requires WooCommerce to be installed and active.', 'cardz3n-gateway' );
				echo '</p></div>';
			}
		);
		return;
	}

	// Translations are auto-loaded from WordPress.org since WP 4.6 — no load_plugin_textdomain() call needed.

	// Load shared files.
	require_once CARDZ3N_GW_PATH . 'includes/class-cardz3n-brand.php';
	require_once CARDZ3N_GW_PATH . 'includes/class-cardz3n-logger.php';
	require_once CARDZ3N_GW_PATH . 'includes/class-cardz3n-api-client.php';
	require_once CARDZ3N_GW_PATH . 'includes/class-cardz3n-level3-mapper.php';
	require_once CARDZ3N_GW_PATH . 'includes/class-cardz3n-token-service.php';
	require_once CARDZ3N_GW_PATH . 'includes/class-cardz3n-order-service.php';
	require_once CARDZ3N_GW_PATH . 'includes/class-cardz3n-wallet-service.php';
	require_once CARDZ3N_GW_PATH . 'includes/class-cardz3n-ach-service.php';
	require_once CARDZ3N_GW_PATH . 'includes/class-cardz3n-subscriptions-service.php';
	require_once CARDZ3N_GW_PATH . 'includes/class-cardz3n-preorders-service.php';
	require_once CARDZ3N_GW_PATH . 'includes/traits/trait-cardz3n-refunds.php';
	require_once CARDZ3N_GW_PATH . 'includes/traits/trait-cardz3n-settings.php';
	require_once CARDZ3N_GW_PATH . 'includes/traits/trait-cardz3n-compatibility.php';
	require_once CARDZ3N_GW_PATH . 'includes/helpers.php';
	require_once CARDZ3N_GW_PATH . 'includes/class-cardz3n-gateway.php';
	require_once CARDZ3N_GW_PATH . 'includes/class-cardz3n-admin.php';

	// Register the gateway with WooCommerce.
	add_filter( 'woocommerce_payment_gateways', 'cardz3n_gw_register_gateway' );

	// Boot admin-only integrations.
	if ( is_admin() ) {
		Cardz3n_Gateway\Admin::instance();
	}

	// Boot subscriptions + pre-orders shims (no-op unless their extension is installed).
	Cardz3n_Gateway\Subscriptions_Service::instance();
	Cardz3n_Gateway\Preorders_Service::instance();

	// Plugin action links.
	add_filter( 'plugin_action_links_' . CARDZ3N_GW_BASENAME, 'cardz3n_gw_action_links' );
}

/**
 * Register the gateway class with WooCommerce.
 *
 * @param array $gateways Registered gateway classes.
 * @return array
 */
function cardz3n_gw_register_gateway( $gateways ) {
	$gateways[] = 'Cardz3n_Gateway\Gateway';
	return $gateways;
}

/**
 * Add a Settings link on the Plugins screen.
 *
 * @param array $links Existing links.
 * @return array
 */
function cardz3n_gw_action_links( $links ) {
	$brand_id  = Cardz3n_Gateway\Brand::id();
	$url       = admin_url( 'admin.php?page=wc-settings&tab=checkout&section=' . $brand_id );
	$settings  = '<a href="' . esc_url( $url ) . '">' . esc_html__( 'Settings', 'cardz3n-gateway' ) . '</a>';
	array_unshift( $links, $settings );
	return $links;
}

/* -----------------------------------------------------------------------------
 * Activation / deactivation
 * -------------------------------------------------------------------------- */

register_activation_hook( __FILE__, 'cardz3n_gw_activate' );
register_deactivation_hook( __FILE__, 'cardz3n_gw_deactivate' );

function cardz3n_gw_activate() {
	// Version stamp for future migrations.
	update_option( 'cardz3n_gw_version', CARDZ3N_GW_VERSION );
	update_option( 'cardz3n_gw_activated_at', current_time( 'timestamp' ) );
}

function cardz3n_gw_deactivate() {
	// Intentionally no destructive cleanup. Merchant data remains in case of reactivation.
}
