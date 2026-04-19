<?php
/**
 * Blocks Checkout integration for CARDZ3N Gateway.
 *
 * Registers the gateway with the WooCommerce Cart/Checkout Blocks payment
 * method registry so the admin-only "may not be compatible with the Checkout
 * block" notice disappears and the gateway appears inside the block-based
 * checkout UI alongside classic shortcode checkout support.
 *
 * The client-side bundle (assets/js/blocks/checkout.js) mounts the exact
 * same Collect.js tokenization flow used by the classic checkout so there
 * is a single code path for card / ACH / wallet / saved-method submissions.
 *
 * @package Cardz3n_Gateway
 */

namespace Cardz3n_Gateway;

defined( 'ABSPATH' ) || exit;

use Automattic\WooCommerce\Blocks\Payments\Integrations\AbstractPaymentMethodType;

/**
 * Payment-method-type implementation for the Blocks Checkout.
 */
class Blocks_Support extends AbstractPaymentMethodType {

	/**
	 * Payment method name. Must match the classic gateway ID so both checkouts
	 * reference the same WC_Payment_Gateway settings and the same order source.
	 *
	 * @var string
	 */
	protected $name;

	/**
	 * Cached reference to the classic gateway instance.
	 *
	 * @var \Cardz3n_Gateway\Gateway|null
	 */
	private $gateway = null;

	public function __construct() {
		$this->name = Brand::profile()['gateway_id'];
	}

	/**
	 * Called by Woo Blocks after the integration is registered.
	 * Pulls settings from the stored gateway options via WC_Payment_Gateway.
	 */
	public function initialize() {
		$option_key     = 'woocommerce_' . $this->name . '_settings';
		$this->settings = get_option( $option_key, array() );
	}

	/**
	 * Is this payment method available for the block checkout?
	 * Mirrors the classic gateway's is_available() contract so the same
	 * store-wide currency/country/token checks apply.
	 */
	public function is_active() {
		$gateway = $this->get_gateway();
		if ( ! $gateway ) {
			return false;
		}
		return $gateway->is_available();
	}

	/**
	 * Register the JS bundle that renders the payment method inside the block.
	 * Returns the handles that Woo Blocks should enqueue.
	 *
	 * @return string[]
	 */
	public function get_payment_method_script_handles() {

		$asset_file = CARDZ3N_GW_PATH . 'assets/js/blocks/checkout.asset.php';
		$asset      = file_exists( $asset_file ) ? require $asset_file : array(
			'dependencies' => array(),
			'version'      => CARDZ3N_GW_VERSION,
		);

		$handle = 'cardz3n-blocks-checkout';

		wp_register_script(
			$handle,
			CARDZ3N_GW_URL . 'assets/js/blocks/checkout.js',
			$asset['dependencies'],
			$asset['version'],
			true
		);

		// CARDZ3N Collect.js is required before our block script initializes Collect.
		// Served from z3n.transactiongateway.com (white-labeled NMI host).
		wp_register_script(
			'cardz3n-collectjs',
			Api_Client::collectjs_url(),
			array(),
			null, // phpcs:ignore WordPress.WP.EnqueuedResourceParameters.MissingVersion -- Vendor script, versioned by the gateway host.
			true
		);

		// Reuse the shared stylesheet from the classic checkout.
		wp_register_style(
			'cardz3n-checkout',
			CARDZ3N_GW_URL . 'assets/css/checkout.css',
			array(),
			CARDZ3N_GW_VERSION
		);
		wp_enqueue_style( 'cardz3n-checkout' );

		if ( function_exists( 'wp_set_script_translations' ) ) {
			wp_set_script_translations( $handle, 'cardz3n-gateway' );
		}

		return array( 'cardz3n-collectjs', $handle );
	}

	/**
	 * Data passed to the JS bundle as `wc.wcSettings.getPaymentMethodData( gatewayId )`.
	 * Keep parity with the classic checkout's wp_localize_script() payload so
	 * the same JS helpers can consume either entry point.
	 *
	 * @return array
	 */
	public function get_payment_method_data() {

		$gateway = $this->get_gateway();
		if ( ! $gateway ) {
			return array(
				'title'       => Brand::profile()['default_title'],
				'description' => '',
				'supports'    => array(),
			);
		}

		$client = new Api_Client( $gateway->settings );

		return array(
			'name'               => $this->name,
			'gatewayId'          => $this->name,
			'title'              => $gateway->get_option( 'title', Brand::profile()['default_title'] ),
			'description'        => $gateway->get_option( 'description', '' ),
			'icons'              => $this->get_icon_urls(),
			'tokenizationKey'    => $client->tokenization_key(),
			'enableCards'        => 'yes' === $gateway->get_option( 'enable_cards', 'yes' ),
			'enableAch'          => 'yes' === $gateway->get_option( 'enable_ach', 'yes' ),
			'enableApplePay'     => 'yes' === $gateway->get_option( 'enable_apple_pay', 'yes' ),
			'enableGooglePay'    => 'yes' === $gateway->get_option( 'enable_google_pay', 'yes' ),
			'enableSaved'        => 'yes' === $gateway->get_option( 'enable_saved_methods', 'yes' ),
			'allowedBrands'      => (array) $gateway->get_option( 'allowed_card_brands', array() ),
			'country'            => ( WC()->customer && WC()->customer->get_billing_country() ) ? WC()->customer->get_billing_country() : 'US',
			'currency'           => get_woocommerce_currency(),
			'supports'           => $this->get_supported_features(),
			'i18n'               => array(
				'cardTab'       => __( 'Card', 'cardz3n-gateway' ),
				'achTab'        => __( 'Bank (ACH)', 'cardz3n-gateway' ),
				'savedTab'      => __( 'Saved', 'cardz3n-gateway' ),
				'cardNumber'    => __( 'Card number', 'cardz3n-gateway' ),
				'expiry'        => __( 'MM / YY', 'cardz3n-gateway' ),
				'cvv'           => __( 'CVV', 'cardz3n-gateway' ),
				'accountName'   => __( 'Name on account', 'cardz3n-gateway' ),
				'routing'       => __( 'Routing number', 'cardz3n-gateway' ),
				'account'       => __( 'Account number', 'cardz3n-gateway' ),
				'checking'      => __( 'Checking', 'cardz3n-gateway' ),
				'savings'       => __( 'Savings', 'cardz3n-gateway' ),
				'processing'    => __( 'Processing…', 'cardz3n-gateway' ),
				'invalidFields' => __( 'Please check your payment details and try again.', 'cardz3n-gateway' ),
				'timeout'       => __( 'Tokenization timed out. Please try again.', 'cardz3n-gateway' ),
			),
		);
	}

	/**
	 * Features the Blocks Checkout should enable for this method.
	 * Pulled straight from the classic gateway's $supports array so the block
	 * UI offers the same capabilities (refunds, tokenization, subscriptions…).
	 *
	 * @return string[]
	 */
	public function get_supported_features() {
		$gateway = $this->get_gateway();
		if ( ! $gateway ) {
			return array( 'products' );
		}

		// Default feature set guaranteed by this gateway.
		$features = array( 'products', 'refunds' );

		// Optional features that depend on settings / companion plugins.
		$supports_map = array(
			'tokenization'                    => 'tokenization',
			'subscriptions'                   => 'subscriptions',
			'subscription_cancellation'       => 'subscriptions',
			'subscription_suspension'         => 'subscriptions',
			'subscription_reactivation'       => 'subscriptions',
			'subscription_amount_changes'     => 'subscriptions',
			'subscription_date_changes'       => 'subscriptions',
			'subscription_payment_method_change' => 'subscriptions',
			'multiple_subscriptions'          => 'subscriptions',
			'pre-orders'                      => 'pre-orders',
		);

		foreach ( $supports_map as $wc_feature => $block_feature ) {
			if ( $gateway->supports( $wc_feature ) && ! in_array( $block_feature, $features, true ) ) {
				$features[] = $block_feature;
			}
		}

		return $features;
	}

	/**
	 * Resolve the classic gateway instance lazily (it may not exist yet when
	 * Woo Blocks boots this class on the REST API early lifecycle).
	 *
	 * @return \Cardz3n_Gateway\Gateway|null
	 */
	private function get_gateway() {
		if ( null !== $this->gateway ) {
			return $this->gateway;
		}
		if ( ! function_exists( 'WC' ) || ! WC()->payment_gateways() ) {
			return null;
		}
		$all = WC()->payment_gateways()->payment_gateways();
		if ( isset( $all[ $this->name ] ) && $all[ $this->name ] instanceof Gateway ) {
			$this->gateway = $all[ $this->name ];
		}
		return $this->gateway;
	}

	/**
	 * Return an array of brand icon URLs (visa/mc/amex/ach/applepay/googlepay).
	 *
	 * @return array<int, array{src:string, alt:string}>
	 */
	private function get_icon_urls() {
		$base  = CARDZ3N_GW_URL . 'assets/img/';
		$icons = array(
			array(
				'src' => $base . 'icon_cc_visa.svg',
				'alt' => 'Visa',
			),
			array(
				'src' => $base . 'icon_cc_mastercard.svg',
				'alt' => 'Mastercard',
			),
			array(
				'src' => $base . 'icon_cc_amex.svg',
				'alt' => 'American Express',
			),
			array(
				'src' => $base . 'icon_cc_discover.svg',
				'alt' => 'Discover',
			),
		);
		// Filter out icons that don't actually ship (keeps the block UI clean).
		return array_values(
			array_filter(
				$icons,
				function ( $icon ) {
					$path = str_replace( CARDZ3N_GW_URL, CARDZ3N_GW_PATH, $icon['src'] );
					return file_exists( $path );
				}
			)
		);
	}
}
