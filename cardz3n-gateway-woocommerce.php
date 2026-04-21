<?php
/**
 * Plugin Name: CARDZ3N Gateway for WooCommerce
 * Plugin URI: https://cardz3n.com/woocommerce
 * Description: Embedded on-site checkout for WooCommerce powered by the CARDZ3N/NMI payment gateway. Cards, ACH, Apple Pay, Google Pay, saved methods, subscriptions, refunds, captures, voids, and automatic Level 2/3 commercial-card data in a single gateway UI.
 * Version: 1.0.24
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

define( 'CARDZ3N_GW_VERSION', '1.0.24' );
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
 * Settings migration, iterated across 1.0.15 -> 1.0.19.
 *
 * CARDZ3N DOES issue separate Test-mode and Live-mode keys. The 1.0.15-1.0.18
 * "single key pair" model was wrong. 1.0.19 restores the four-field UI
 * (live_security_key, live_tokenization_key, test_security_key,
 * test_tokenization_key) with `test_mode` selecting which pair is active.
 *
 * This migration is idempotent and runs on activation and on every
 * plugins_loaded as a safety net for WP.org auto-updates. It never deletes
 * legacy fields so older plugin versions keep working if someone downgrades.
 *
 * Forward-compat fills we perform:
 *   - Pre-1.0.15 installs: copy sandbox_security_key into test_security_key
 *     (and same for tokenization) when the test_* field is empty.
 *   - 1.0.15-1.0.18 installs: copy the unified security_key into
 *     live_security_key (and same for tokenization) when live_* is empty,
 *     because merchants on those versions were using one pair as their Live
 *     pair. Do NOT clobber test_* with the unified value — those were
 *     production keys, not test keys.
 *   - sandbox_mode -> test_mode rename is preserved.
 */
function cardz3n_gw_maybe_migrate_settings() {
	$option = 'woocommerce_cardz3n_gateway_settings';
	$s      = get_option( $option, array() );
	if ( ! is_array( $s ) ) {
		return;
	}

	$changed = false;

	// 1) Pre-1.0.15 sandbox_* -> test_* (only when test_* is empty).
	if ( empty( $s['test_security_key'] ) && ! empty( $s['sandbox_security_key'] ) ) {
		$s['test_security_key'] = (string) $s['sandbox_security_key'];
		$changed                = true;
	}
	if ( empty( $s['test_tokenization_key'] ) && ! empty( $s['sandbox_tokenization_key'] ) ) {
		$s['test_tokenization_key'] = (string) $s['sandbox_tokenization_key'];
		$changed                    = true;
	}

	// 2) 1.0.15-1.0.18 unified security_key/tokenization_key -> live_*
	//    (only when live_* is empty). Those merchants treated the unified pair
	//    as their real / live keys.
	if ( empty( $s['live_security_key'] ) && ! empty( $s['security_key'] ) ) {
		$s['live_security_key'] = (string) $s['security_key'];
		$changed                = true;
	}
	if ( empty( $s['live_tokenization_key'] ) && ! empty( $s['tokenization_key'] ) ) {
		$s['live_tokenization_key'] = (string) $s['tokenization_key'];
		$changed                    = true;
	}

	// 3) Legacy compatibility for the unified keys themselves — if a
	//    1.0.14-era install is being migrated forward and only has sandbox_*
	//    populated, still populate the unified fields so any downstream code
	//    that reads them keeps working.
	if ( empty( $s['security_key'] ) ) {
		foreach ( array( 'live_security_key', 'sandbox_security_key', 'test_security_key' ) as $src_key ) {
			if ( ! empty( $s[ $src_key ] ) ) {
				$s['security_key'] = (string) $s[ $src_key ];
				$changed           = true;
				break;
			}
		}
	}
	if ( empty( $s['tokenization_key'] ) ) {
		foreach ( array( 'live_tokenization_key', 'sandbox_tokenization_key', 'test_tokenization_key' ) as $src_key ) {
			if ( ! empty( $s[ $src_key ] ) ) {
				$s['tokenization_key'] = (string) $s[ $src_key ];
				$changed               = true;
				break;
			}
		}
	}

	// 4) sandbox_mode -> test_mode rename, unchanged from 1.0.15.
	if ( ! isset( $s['test_mode'] ) && isset( $s['sandbox_mode'] ) ) {
		$s['test_mode'] = $s['sandbox_mode'];
		$changed        = true;
	}

	if ( $changed ) {
		update_option( $option, $s );
	}
}
add_action( 'plugins_loaded', 'cardz3n_gw_maybe_migrate_settings', 9 );

/* -----------------------------------------------------------------------------
 * 1.0.20: Version-mismatch admin notice.
 *
 * Catches the stale-install situation where the .php / .js / .css on disk
 * advertise one version but `cardz3n_gw_version` (written on activation) is
 * still pointing at an older release — usually because the merchant updated
 * via FTP or extracted a new zip over the old one without re-activating. We
 * surface this on the Plugins list and on the WooCommerce → Payments screen
 * so a merchant can see at a glance which build is actually running and that
 * they need to deactivate + reactivate the plugin to finish the upgrade.
 * -------------------------------------------------------------------------- */

add_action( 'admin_notices', 'cardz3n_gw_version_mismatch_notice' );
function cardz3n_gw_version_mismatch_notice() {
	if ( ! current_user_can( 'manage_woocommerce' ) && ! current_user_can( 'activate_plugins' ) ) {
		return;
	}

	// Only render on screens the merchant will actually see.
	$screen = function_exists( 'get_current_screen' ) ? get_current_screen() : null;
	$show   = false;
	if ( $screen ) {
		if ( in_array( $screen->id, array( 'plugins', 'plugins-network' ), true ) ) {
			$show = true;
		}
		if ( isset( $_GET['page'] ) && 'wc-settings' === $_GET['page'] && isset( $_GET['tab'] ) && 'checkout' === $_GET['tab'] ) { // phpcs:ignore WordPress.Security.NonceVerification.Recommended
			$show = true;
		}
	}
	if ( ! $show ) {
		return;
	}

	$stored = (string) get_option( 'cardz3n_gw_version', '' );
	$disk   = (string) CARDZ3N_GW_VERSION;

	if ( '' === $stored ) {
		// Activation row hasn't written yet (brand-new install). Nothing to warn about.
		return;
	}
	if ( version_compare( $stored, $disk, '==' ) ) {
		return;
	}

	$plugins_url = esc_url( admin_url( 'plugins.php' ) );
	echo '<div class="notice notice-warning"><p>';
	printf(
		/* translators: 1: version string on disk, 2: version string recorded on activation, 3: URL to plugins page */
		esc_html__( 'CARDZ3N Gateway on disk is version %1$s but the last activated version was %2$s. Deactivate then reactivate the plugin from the %3$s screen to finish the upgrade.', 'cardz3n-gateway' ),
		'<strong>' . esc_html( $disk ) . '</strong>',
		'<strong>' . esc_html( $stored ) . '</strong>',
		'<a href="' . $plugins_url . '">' . esc_html__( 'Plugins', 'cardz3n-gateway' ) . '</a>'
	);
	echo '</p></div>';
}

/**
 * 1.0.20: Keep stored version in sync on every admin load for upgrade-through-WP
 * (which doesn't re-run register_activation_hook). This way once the merchant
 * loads any admin page after updating, the mismatch banner clears itself — no
 * manual deactivate/reactivate cycle needed for WP.org updates.
 */
add_action( 'admin_init', 'cardz3n_gw_sync_stored_version' );
function cardz3n_gw_sync_stored_version() {
	$stored = (string) get_option( 'cardz3n_gw_version', '' );
	if ( $stored !== CARDZ3N_GW_VERSION ) {
		update_option( 'cardz3n_gw_version', CARDZ3N_GW_VERSION );
	}
}
