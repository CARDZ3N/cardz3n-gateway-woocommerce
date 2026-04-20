<?php
/**
 * Plugin Name: CARDZ3N Gateway for WooCommerce
 * Plugin URI: https://cardz3n.com/woocommerce
 * Description: Embedded on-site checkout for WooCommerce powered by the CARDZ3N/NMI payment gateway. Cards, ACH, Apple Pay, Google Pay, saved methods, subscriptions, refunds, captures, voids, and automatic Level 2/3 commercial-card data in a single gateway UI.
 * Version: 1.0.16
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

define( 'CARDZ3N_GW_VERSION', '1.0.16' );
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
			/*
			 * We render inside the Cart/Checkout Blocks via the classic-shortcode
			 * compatibility layer (payment_fields()/process_payment()). Declaring
			 * false tells WooCommerce Blocks: 'do not expect a PaymentMethodType
			 * registration — fall back to the classic gateway render.' This is the
			 * same pattern used by major NMI-family gateways (Evergreen Payments,
			 * NMI Gateway Standard, etc.) and keeps a single code path for
			 * classic shortcode AND Block checkouts.
			 */
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

	/*
	 * Cart/Checkout Blocks integration intentionally disabled. See
	 * `declare_compatibility('cart_checkout_blocks', …, false)` above. The
	 * Block checkout renders our classic payment_fields() output via Woo's
	 * built-in shortcode-compatibility layer, which is materially simpler
	 * and avoids the early-boot PaymentMethodRegistry timing problems we
	 * spent 1.0.11–1.0.13 chasing.
	 */
}

/*
 * NOTE: 1.0.11–1.0.13 attempted a native WooCommerce Blocks PaymentMethodType
 * integration via includes/class-cardz3n-blocks-support.php. That code path is
 * retained in the repo for future revival but is intentionally NOT loaded
 * here. 1.0.14 switched to the classic-shortcode compatibility layer because
 * Woo Blocks was failing to enqueue our PaymentMethodType bundle on some
 * stacks (empty `cardz3n_gateway_data` setting, empty blocksRegistry). This is
 * the same approach used by production NMI-family gateways such as Evergreen
 * Payments Northwest 1.1.0.
 */

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
	cardz3n_gw_maybe_migrate_settings();
	update_option( 'cardz3n_gw_version', CARDZ3N_GW_VERSION );
	update_option( 'cardz3n_gw_activated_at', current_time( 'timestamp' ) );
}

function cardz3n_gw_deactivate() {
	// Intentionally no destructive cleanup. Merchant data remains in case of reactivation.
}

/**
 * 1.0.15 migration: collapse sandbox_* and live_* keys into a single
 * security_key + tokenization_key, and rename sandbox_mode to test_mode.
 *
 * CARDZ3N has no separate sandbox portal — Test Mode is a toggle on the same
 * gateway account using the same keys. This migration runs once (idempotent)
 * on activation and on every plugin-file load as a safety net for sites that
 * didn't trigger the activation hook (e.g. upgraded via WP.org auto-update).
 *
 * Source of truth priority when populating unified keys:
 *   1. `security_key` / `tokenization_key` — already present, skip.
 *   2. `sandbox_security_key` / `sandbox_tokenization_key` — preferred
 *      because the user's earlier clarification was that Test Mode uses the
 *      same keys, and the sandbox fields were the first ones most merchants
 *      filled in when setting up.
 *   3. `live_security_key` and `live_tokenization_key` — fallback.
 *
 * Legacy fields are NOT deleted, so downgrade-to-previous-version keeps
 * working. The API client reads unified first, legacy second.
 */
function cardz3n_gw_maybe_migrate_settings() {
	$option = 'woocommerce_cardz3n_gateway_settings';
	$s      = get_option( $option, array() );
	if ( ! is_array( $s ) ) {
		return;
	}

	$changed = false;

	if ( empty( $s['security_key'] ) ) {
		foreach ( array( 'sandbox_security_key', 'live_security_key' ) as $legacy ) {
			if ( ! empty( $s[ $legacy ] ) ) {
				$s['security_key'] = (string) $s[ $legacy ];
				$changed           = true;
				break;
			}
		}
	}

	if ( empty( $s['tokenization_key'] ) ) {
		foreach ( array( 'sandbox_tokenization_key', 'live_tokenization_key' ) as $legacy ) {
			if ( ! empty( $s[ $legacy ] ) ) {
				$s['tokenization_key'] = (string) $s[ $legacy ];
				$changed               = true;
				break;
			}
		}
	}

	if ( ! isset( $s['test_mode'] ) && isset( $s['sandbox_mode'] ) ) {
		$s['test_mode'] = $s['sandbox_mode'];
		$changed        = true;
	}

	if ( $changed ) {
		update_option( $option, $s );
	}
}
add_action( 'plugins_loaded', 'cardz3n_gw_maybe_migrate_settings', 9 );
