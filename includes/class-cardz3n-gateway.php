<?php
/**
 * Main CARDZ3N Gateway class.
 *
 * Registers as a WooCommerce payment gateway, renders the embedded checkout,
 * processes payments, delegates refund/void/capture to the Refunds_Trait, and
 * coordinates the Api_Client + Level3_Mapper + Token_Service + Order_Service.
 *
 * @package Cardz3n_Gateway
 */

namespace Cardz3n_Gateway;

defined( 'ABSPATH' ) || exit;

use Cardz3n_Gateway\Api_Client;
use Cardz3n_Gateway\Brand;
use Cardz3n_Gateway\Level3_Mapper;
use Cardz3n_Gateway\Logger;
use Cardz3n_Gateway\Order_Service;
use Cardz3n_Gateway\Token_Service;
use Cardz3n_Gateway\Wallet_Service;
use Cardz3n_Gateway\ACH_Service;

class Gateway extends \WC_Payment_Gateway_CC {

	use Refunds_Trait;
	use Settings_Trait;
	use Compatibility_Trait;

	public function __construct() {
		$brand                    = Brand::profile();
		$this->id                 = $brand['gateway_id'];
		$this->method_title       = $brand['method_title'];
		$this->method_description = $this->build_method_description( $brand );
		$this->has_fields         = true;
		$this->icon               = $this->gateway_icon_url();

		$this->init_form_fields();
		$this->init_settings();

		/*
		 * 1.0.18 — Checkout title is LOCKED to "Powered by CARDZ3N" by product
		 * decision. The admin input is rendered readonly in the settings UI,
		 * but we also force the runtime value here so a merchant who hacks
		 * around the readonly attribute (or a database edit) still presents
		 * the branded label to buyers at checkout.
		 */
		$this->title       = __( 'Powered by CARDZ3N', 'cardz3n-gateway' );
		$this->description = $this->get_option( 'description' );

		$this->supports = $this->build_supports_array();

		// Persist settings.
		add_action( 'woocommerce_update_options_payment_gateways_' . $this->id, array( $this, 'process_admin_options' ) );

		// Enqueue checkout assets.
		add_action( 'wp_enqueue_scripts', array( $this, 'enqueue_checkout_assets' ) );

		// Optional PO checkout field.
		add_action( 'woocommerce_after_order_notes', array( $this, 'render_po_field' ) );
		add_action( 'woocommerce_checkout_update_order_meta', array( $this, 'save_po_field' ) );

		// Thank-you instructions.
		add_action( 'woocommerce_thankyou_' . $this->id, array( $this, 'render_thankyou' ) );

		/*
		 * NOTE: The `wp_ajax_cardz3n_validate_credentials` and
		 * `wp_ajax_cardz3n_delete_token` hooks are intentionally NOT registered here.
		 * This Gateway class is only instantiated when WooCommerce builds its
		 * `woocommerce_payment_gateways` list, which does not happen on a bare
		 * admin-ajax.php request. Hooks registered here would never fire for AJAX,
		 * causing WordPress to return HTTP 400 with an empty auth-check payload.
		 *
		 * Both AJAX actions are now registered in Cardz3n_Gateway\Admin, which boots
		 * unconditionally on every admin request (including admin-ajax). The handler
		 * implementations still live on this class; Admin delegates to them via a
		 * lazily-resolved Gateway instance.
		 */
	}

	/**
	 * Build the method_description shown on the WooCommerce
	 * Settings → Payments listing row.
	 *
	 * Appends a small recurring-payments support badge so merchants can see
	 * at a glance that this gateway supports subscriptions/recurring billing.
	 * The badge is a single SVG "recurring" icon plus a short label, rendered
	 * in an inline-flex container so it sits cleanly to the right of the
	 * description text.
	 *
	 * @param array<string,mixed> $brand Active brand profile.
	 * @return string Method description HTML (safe — only uses wp_kses-friendly tags).
	 */
	protected function build_method_description( $brand ) {
		$text = isset( $brand['method_description'] ) ? $brand['method_description'] : '';

		/*
		 * Recurring-payments support badge.
		 *
		 * WooCommerce runs method_description through wp_kses_post() before
		 * rendering, which strips <svg> and most custom tags but DOES allow
		 * <span> with a style attribute and <img>. We use a CSS background-image
		 * on a <span> with a data-URI of our recurring glyph, so the icon
		 * survives kses and has no external HTTP request, and we pair it with a
		 * UTF-8 "⟲" fallback in case the background image is blocked.
		 */
		$svg      = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="%230a5cff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 1-9 9 9 9 0 0 1-7.94-4.76"/><path d="M3 12a9 9 0 0 1 9-9 9 9 0 0 1 7.94 4.76"/><polyline points="21 3 21 7.76 16.24 7.76"/><polyline points="3 21 3 16.24 7.76 16.24"/></svg>';
		$data_uri = 'data:image/svg+xml;charset=utf-8,' . str_replace( array( '"', '<', '>' ), array( "'", '%3C', '%3E' ), $svg );

		$badge  = '<span style="display:inline-block;margin-left:8px;padding:2px 10px 2px 26px;background:#eef6ff no-repeat 8px center / 14px 14px url(\'' . esc_url( $data_uri ) . '\');border:1px solid #b6d4fe;border-radius:12px;font-size:11px;font-weight:600;color:#0a5cff;vertical-align:middle;line-height:16px;" title="' . esc_attr__( 'Supports WooCommerce Subscriptions and recurring payments', 'cardz3n-gateway' ) . '">';
		$badge .= esc_html__( 'Recurring Payments', 'cardz3n-gateway' );
		$badge .= '</span>';

		return $text . ' ' . $badge;
	}

	/* ------------------------------------------------------------------
	 * Assets & rendering
	 * --------------------------------------------------------------- */

	public function gateway_icon_url() {
		$style = $this->get_option( 'icon_style', 'brands' );
		if ( 'none' === $style ) {
			return '';
		}
		if ( 'brand' === $style ) {
			return CARDZ3N_GW_URL . 'assets/img/' . Brand::get( 'logo_file' );
		}
		return ''; // Brand icons rendered inline by payment_fields() for finer control.
	}

	public function enqueue_checkout_assets() {
		if ( ! is_checkout() && ! is_add_payment_method_page() && ! is_account_page() ) {
			return;
		}
		if ( 'no' === $this->get_option( 'enabled' ) ) {
			return;
		}

		$client = new Api_Client( $this->settings );
		$pk     = $client->tokenization_key();
		if ( empty( $pk ) ) {
			return;
		}

		/*
		 * CARDZ3N Collect.js tokenization script (white-labeled NMI host).
		 *
		 * CRITICAL: Collect.js reads its Public Tokenization Key from a
		 * `data-tokenization-key` attribute on its own <script> tag during load.
		 * Without it, Collect.js throws "A tokenization key must be provided by
		 * including a data-tokenization-key attribute" and every hosted field on
		 * the page fails to mount.
		 *
		 * WordPress's wp_enqueue_script() has no direct way to set attributes on
		 * the <script> tag, so we enqueue here and use the `script_loader_tag`
		 * filter below to inject the attribute when WordPress prints the tag.
		 */
		wp_enqueue_script(
			'cardz3n-collectjs',
			Api_Client::collectjs_url(),
			array(),
			null,
			true
		);

		// Inject data-tokenization-key onto the <script> tag that loads Collect.js.
		add_filter(
			'script_loader_tag',
			static function ( $tag, $handle ) use ( $pk ) {
				if ( 'cardz3n-collectjs' !== $handle ) {
					return $tag;
				}
				// Idempotent — avoid double-injecting if something already added the attr.
				if ( false !== strpos( $tag, 'data-tokenization-key' ) ) {
					return $tag;
				}
				$attrs = sprintf(
					' data-tokenization-key="%s" data-variant="inline"',
					esc_attr( $pk )
				);
				return preg_replace( '/<script\b/', '<script' . $attrs, $tag, 1 );
			},
			10,
			2
		);

		// Our static checkout bundle (no inline JS, no synchronous AJAX).
		wp_enqueue_script(
			'cardz3n-checkout',
			CARDZ3N_GW_URL . 'assets/js/checkout.js',
			array( 'jquery', 'cardz3n-collectjs' ),
			CARDZ3N_GW_VERSION,
			true
		);

		wp_enqueue_style(
			'cardz3n-checkout',
			CARDZ3N_GW_URL . 'assets/css/checkout.css',
			array(),
			CARDZ3N_GW_VERSION
		);

		wp_localize_script(
			'cardz3n-checkout',
			'CARDZ3N_GW',
			array(
				'version'            => CARDZ3N_GW_VERSION,
				'gatewayId'          => $this->id,
				'tokenizationKey'    => $pk,
				'enableCards'        => 'yes' === $this->get_option( 'enable_cards', 'yes' ),
				'enableAch'          => 'yes' === $this->get_option( 'enable_ach', 'yes' ),
				'enableApplePay'     => 'yes' === $this->get_option( 'enable_apple_pay', 'yes' ),
				'enableGooglePay'    => 'yes' === $this->get_option( 'enable_google_pay', 'yes' ),
				'enableSaved'        => 'yes' === $this->get_option( 'enable_saved_methods', 'yes' ),
				'allowedBrands'      => (array) $this->get_option( 'allowed_card_brands', array() ),
				'country'            => ( WC()->customer && WC()->customer->get_billing_country() ) ? WC()->customer->get_billing_country() : 'US',
				'currency'           => get_woocommerce_currency(),
				'ajaxUrl'            => admin_url( 'admin-ajax.php' ),
				'nonce'              => wp_create_nonce( 'cardz3n_gw_nonce' ),
				'i18n'                => array(
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
					'initError'     => __( 'Unable to initialize secure payment form. Please refresh the page and try again.', 'cardz3n-gateway' ),
				),
			)
		);
	}

	/**
	 * Render the embedded checkout UI inside the CARDZ3N gateway panel.
	 *
	 * Structure (single gateway, multiple panes):
	 *   [ Saved | Card | ACH ]  ← tabs, visible only if method enabled + eligible
	 *   .pane-saved   → saved tokens radio list (managed by parent::saved_payment_methods())
	 *   .pane-card    → Collect.js inline hosted fields for PAN/exp/CVV
	 *   .pane-ach     → Collect.js inline hosted fields for routing/account
	 *   .wallets      → Apple/Google Pay buttons (rendered by Collect.js)
	 */
	public function payment_fields() {
		$brand = Brand::profile();

		if ( $this->get_description() ) {
			echo wp_kses_post( wpautop( wp_kses_post( $this->get_description() ) ) );
		}

		$this->render_brand_icons();

		// 1.0.19: only show the Saved tab when the logged-in customer actually
		// has saved tokens for this gateway. Prevents the empty Saved pane
		// reported in 1.0.18.
		$has_tokenization = $this->supports( 'tokenization' ) && is_user_logged_in();
		$saved_tokens     = array();
		if ( $has_tokenization && class_exists( '\WC_Payment_Tokens' ) ) {
			$saved_tokens = \WC_Payment_Tokens::get_customer_tokens( get_current_user_id(), $this->id );
		}
		$show_saved       = $has_tokenization && ! empty( $saved_tokens );
		$default_to_saved = $show_saved; // Saved is the default active tab when tokens exist.
		$enable_cards  = 'yes' === $this->get_option( 'enable_cards', 'yes' );
		$enable_ach    = 'yes' === $this->get_option( 'enable_ach', 'yes' );
		// 1.0.20: Native wallet buttons are temporarily suspended — the current
		// NMI Collect.js build rejects our documented applePay/googlePay config
		// shape and throws "Unexpected fields for applePay", which broke the
		// card + ACH iframes. Wallets will return in a later release over a
		// dedicated PaymentRequest / Apple Pay JS flow. The enable_* flags on
		// the settings page still control the brand-row logos (below) so
		// buyers still see that the merchant accepts those brands.
		$enable_apple  = false;
		$enable_google = false;
		?>
		<div class="cardz3n-gateway-ui" data-gateway="<?php echo esc_attr( $this->id ); ?>">

			<?php if ( $enable_apple || $enable_google ) : ?>
			<div class="cardz3n-wallets">
				<?php if ( $enable_apple ) : ?>
					<div class="cardz3n-applepay-button" data-cardz3n-wallet="apple"></div>
				<?php endif; ?>
				<?php if ( $enable_google ) : ?>
					<div class="cardz3n-googlepay-button" data-cardz3n-wallet="google"></div>
				<?php endif; ?>
				<div class="cardz3n-wallets-divider"><span><?php esc_html_e( 'or pay with', 'cardz3n-gateway' ); ?></span></div>
			</div>
			<?php endif; ?>

			<div class="cardz3n-tabs" role="tablist">
				<?php if ( $show_saved ) : ?>
					<button type="button" class="cardz3n-tab<?php echo $default_to_saved ? ' is-active' : ''; ?>" data-target="saved" role="tab"><?php esc_html_e( 'Saved', 'cardz3n-gateway' ); ?></button>
				<?php endif; ?>
				<?php if ( $enable_cards ) : ?>
					<button type="button" class="cardz3n-tab<?php echo $default_to_saved ? '' : ' is-active'; ?>" data-target="card" role="tab"><?php esc_html_e( 'Card', 'cardz3n-gateway' ); ?></button>
				<?php endif; ?>
				<?php if ( $enable_ach ) : ?>
					<button type="button" class="cardz3n-tab" data-target="ach" role="tab"><?php esc_html_e( 'Bank (ACH)', 'cardz3n-gateway' ); ?></button>
				<?php endif; ?>
			</div>

			<input type="hidden" name="cardz3n_payment_source" value="<?php echo $default_to_saved ? 'saved' : 'card'; ?>" />
			<input type="hidden" name="cardz3n_payment_token" value="" />
			<input type="hidden" name="cardz3n_token_type" value="" />

			<div class="cardz3n-panes">

			<?php if ( $show_saved ) : ?>
				<div class="cardz3n-pane<?php echo $default_to_saved ? ' is-active' : ''; ?>" data-pane="saved">
					<?php $this->saved_payment_methods(); ?>
				</div>
			<?php endif; ?>

			<?php if ( $enable_cards ) : ?>
			<div class="cardz3n-pane<?php echo $default_to_saved ? '' : ' is-active'; ?>" data-pane="card">
				<div class="cardz3n-field">
					<label><?php esc_html_e( 'Card number', 'cardz3n-gateway' ); ?></label>
					<div id="cardz3n-ccnumber" class="cardz3n-collect-field"></div>
				</div>
				<div class="cardz3n-row">
					<div class="cardz3n-field">
						<label><?php esc_html_e( 'Expiry', 'cardz3n-gateway' ); ?></label>
						<div id="cardz3n-ccexp" class="cardz3n-collect-field"></div>
					</div>
					<div class="cardz3n-field">
						<label><?php esc_html_e( 'CVV', 'cardz3n-gateway' ); ?></label>
						<div id="cardz3n-cvv" class="cardz3n-collect-field"></div>
					</div>
				</div>
				<?php if ( $has_tokenization ) : /* 1.0.20: always offer save when the buyer is logged in with tokenization support. */ ?>
				<label class="cardz3n-save-method">
					<input type="checkbox" name="wc-<?php echo esc_attr( $this->id ); ?>-new-payment-method" value="true" />
					<?php esc_html_e( 'Save this card for faster checkout next time.', 'cardz3n-gateway' ); ?>
				</label>
				<?php endif; ?>
			</div>
			<?php endif; ?>

			<?php if ( $enable_ach ) : ?>
			<div class="cardz3n-pane" data-pane="ach">
				<div class="cardz3n-field">
					<label><?php esc_html_e( 'Name on account', 'cardz3n-gateway' ); ?></label>
					<div id="cardz3n-checkname" class="cardz3n-collect-field"></div>
				</div>
				<div class="cardz3n-row">
					<div class="cardz3n-field">
						<label><?php esc_html_e( 'Routing number', 'cardz3n-gateway' ); ?></label>
						<div id="cardz3n-checkaba" class="cardz3n-collect-field"></div>
					</div>
					<div class="cardz3n-field">
						<label><?php esc_html_e( 'Account number', 'cardz3n-gateway' ); ?></label>
						<div id="cardz3n-checkaccount" class="cardz3n-collect-field"></div>
					</div>
				</div>
				<div class="cardz3n-field">
					<label><?php esc_html_e( 'Account type', 'cardz3n-gateway' ); ?></label>
					<select name="cardz3n_ach_account_type">
						<option value="checking"><?php esc_html_e( 'Checking', 'cardz3n-gateway' ); ?></option>
						<option value="savings"><?php esc_html_e( 'Savings', 'cardz3n-gateway' ); ?></option>
					</select>
				</div>
				<?php if ( ACH_Service::reuse_allowed() && $has_tokenization ) : ?>
				<label class="cardz3n-save-method">
					<input type="checkbox" name="wc-<?php echo esc_attr( $this->id ); ?>-new-ach-method" value="true" />
					<?php esc_html_e( 'Save this bank account for future orders.', 'cardz3n-gateway' ); ?>
				</label>
				<?php endif; ?>
			</div>
			<?php endif; ?>

			</div><!-- /.cardz3n-panes -->

			<div class="cardz3n-errors" role="alert" aria-live="polite"></div>
		</div>
		<?php
	}

	private function render_brand_icons() {
		$style = $this->get_option( 'icon_style', 'brands' );
		if ( 'brands' !== $style ) {
			return;
		}
		$brands = (array) $this->get_option( 'allowed_card_brands', array( 'visa', 'mastercard', 'amex', 'discover' ) );
		$icons  = array();
		foreach ( $brands as $b ) {
			$icons[] = array(
				'file' => 'icon_cc_' . $b . '.svg',
				'alt'  => ucfirst( $b ),
			);
		}

		// 1.0.15: also surface Apple Pay / Google Pay logos in the brand row
		// even when the buyer's current device doesn't support the wallet
		// (the live wallet button still only renders when canMakePayments is
		// true). This reassures buyers the gateway accepts their wallet.
		if ( 'yes' === $this->get_option( 'enable_apple_pay', 'yes' ) ) {
			$icons[] = array( 'file' => 'icon_wallet_applepay.svg', 'alt' => 'Apple Pay' );
		}
		if ( 'yes' === $this->get_option( 'enable_google_pay', 'yes' ) ) {
			$icons[] = array( 'file' => 'icon_wallet_googlepay.svg', 'alt' => 'Google Pay' );
		}

		if ( empty( $icons ) ) {
			return;
		}
		echo '<div class="cardz3n-brand-icons">';
		foreach ( $icons as $icon ) {
			$path = CARDZ3N_GW_URL . 'assets/img/' . $icon['file'];
			printf(
				'<img src="%s" alt="%s" width="38" height="24" loading="lazy" />',
				esc_url( $path ),
				esc_attr( $icon['alt'] )
			);
		}
		echo '</div>';
	}

	public function render_po_field( $checkout ) {
		if ( 'yes' !== $this->get_option( 'enable_po_field', 'yes' ) ) {
			return;
		}
		?>
		<div class="cardz3n-po-field">
			<p class="form-row form-row-wide">
				<label for="cardz3n_po_number"><?php esc_html_e( 'Purchase Order number (optional)', 'cardz3n-gateway' ); ?></label>
				<input type="text" id="cardz3n_po_number" name="cardz3n_po_number" maxlength="17" autocomplete="off" />
			</p>
		</div>
		<?php
	}

	public function save_po_field( $order_id ) {
		if ( empty( $_POST['cardz3n_po_number'] ) ) { // phpcs:ignore WordPress.Security.NonceVerification.Missing
			return;
		}
		$po = sanitize_text_field( wp_unslash( $_POST['cardz3n_po_number'] ) ); // phpcs:ignore WordPress.Security.NonceVerification.Missing
		$order = wc_get_order( $order_id );
		if ( $order ) {
			$order->update_meta_data( '_cardz3n_po_number', $po );
			$order->save_meta_data();
		}
	}

	public function render_thankyou( $order_id ) {
		$msg = trim( (string) $this->get_option( 'thankyou_instructions' ) );
		if ( '' === $msg ) {
			return;
		}
		echo '<div class="cardz3n-thankyou">' . wp_kses_post( wpautop( $msg ) ) . '</div>';
	}

	/* ------------------------------------------------------------------
	 * Availability / admin gates
	 * --------------------------------------------------------------- */

	public function is_available() {
		$reason = $this->availability_reason();
		self::remember_availability_reason( $reason );
		return ( 'available' === $reason );
	}

	/**
	 * Return a short machine-readable token describing why the gateway is
	 * available, or why it isn't. Separated from is_available() so we can
	 * surface it in an admin notice without duplicating gate logic.
	 *
	 * @return string One of: 'available', 'disabled', 'https_required',
	 *                'no_credentials', 'parent_unavailable'.
	 */
	private function availability_reason() {
		if ( 'yes' !== $this->get_option( 'enabled' ) ) {
			return 'disabled';
		}

		/*
		 * HTTPS gate for live mode. Use `wc_checkout_is_https()` instead of
		 * `is_ssl()` — the Woo helper handles reverse proxies (InstaWP, WP
		 * Engine, Cloudflare, etc.) correctly.
		 */
		// 1.0.15: unified 'test_mode' with legacy 'sandbox_mode' fallback.
		$is_test_mode = 'yes' === $this->get_option( 'test_mode', $this->get_option( 'sandbox_mode', 'no' ) );
		if ( ! is_admin() && ! $is_test_mode ) {
			$is_https = function_exists( 'wc_checkout_is_https' )
				? wc_checkout_is_https()
				: ( is_ssl() || 'https' === ( $_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '' ) ); // phpcs:ignore WordPress.Security.ValidatedSanitizedInput
			if ( ! $is_https ) {
				return 'https_required';
			}
		}

		$client = new Api_Client( $this->settings );
		if ( ! $client->has_credentials() ) {
			return 'no_credentials';
		}

		if ( ! parent::is_available() ) {
			return 'parent_unavailable';
		}

		return 'available';
	}

	/**
	 * Store the most recent availability reason in a transient so the admin UI
	 * can surface it. Stored per-brand so the CARDZ3N and AerospacePay white-
	 * label instances don't stomp on each other.
	 *
	 * @param string $reason One of the tokens from availability_reason().
	 */
	private static function remember_availability_reason( $reason ) {
		if ( ! empty( $reason ) ) {
			set_transient( 'cardz3n_gw_last_avail_' . Brand::id(), $reason, 5 * MINUTE_IN_SECONDS );
		}
		if ( 'available' !== $reason ) {
			Logger::warning( 'Gateway hidden. Reason: ' . $reason );
		}
	}

	/* ------------------------------------------------------------------
	 * process_payment — the critical server-side flow.
	 * --------------------------------------------------------------- */

	/**
	 * @param int $order_id
	 * @return array{result:string,redirect:string}|null
	 */
	public function process_payment( $order_id ) {
		$order = wc_get_order( $order_id );
		if ( ! $order ) {
			wc_add_notice( __( 'Order not found.', 'cardz3n-gateway' ), 'error' );
			return null;
		}

		$client = new Api_Client( $this->settings );
		if ( ! $client->has_credentials() ) {
			wc_add_notice( __( 'Payment gateway is not configured. Please contact the store.', 'cardz3n-gateway' ), 'error' );
			return null;
		}

		// Blocks Checkout compatibility: the block bundle posts a slightly
		// different key shape (cardz3n_payment_kind, cardz3n_saved_token_id,
		// wc_payment_source=blocks). Normalize to the classic keys so the rest
		// of this method runs unchanged.
		if ( isset( $_POST['wc_payment_source'] ) && 'blocks' === $_POST['wc_payment_source'] ) { // phpcs:ignore WordPress.Security.NonceVerification.Missing
			if ( ! empty( $_POST['cardz3n_payment_kind'] ) && empty( $_POST['cardz3n_payment_source'] ) ) { // phpcs:ignore WordPress.Security.NonceVerification.Missing
				$_POST['cardz3n_payment_source'] = sanitize_text_field( wp_unslash( $_POST['cardz3n_payment_kind'] ) ); // phpcs:ignore WordPress.Security.NonceVerification.Missing
			}
			if ( ! empty( $_POST['cardz3n_saved_token_id'] ) && empty( $_POST[ 'wc-' . $this->id . '-payment-token' ] ) ) { // phpcs:ignore WordPress.Security.NonceVerification.Missing
				$_POST[ 'wc-' . $this->id . '-payment-token' ] = sanitize_text_field( wp_unslash( $_POST['cardz3n_saved_token_id'] ) ); // phpcs:ignore WordPress.Security.NonceVerification.Missing
			}
		}

		// Gather inputs from checkout. POST is nonce-protected by WooCommerce itself.
		$payment_token_id = isset( $_POST[ 'wc-' . $this->id . '-payment-token' ] ) ? sanitize_text_field( wp_unslash( $_POST[ 'wc-' . $this->id . '-payment-token' ] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Missing
		$collect_token    = isset( $_POST['cardz3n_payment_token'] ) ? sanitize_text_field( wp_unslash( $_POST['cardz3n_payment_token'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Missing
		$token_type       = isset( $_POST['cardz3n_token_type'] ) ? sanitize_text_field( wp_unslash( $_POST['cardz3n_token_type'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Missing
		$source           = isset( $_POST['cardz3n_payment_source'] ) ? sanitize_text_field( wp_unslash( $_POST['cardz3n_payment_source'] ) ) : 'card'; // phpcs:ignore WordPress.Security.NonceVerification.Missing
		$save_card        = ! empty( $_POST[ 'wc-' . $this->id . '-new-payment-method' ] ); // phpcs:ignore WordPress.Security.NonceVerification.Missing
		$save_ach         = ! empty( $_POST[ 'wc-' . $this->id . '-new-ach-method' ] ); // phpcs:ignore WordPress.Security.NonceVerification.Missing

		// Resolve payment mechanism.
		$using_saved = false;
		$vault_id    = '';
		$normalized_source = Wallet_Service::normalize_source( $token_type ?: $source );

		if ( ! empty( $payment_token_id ) && 'new' !== $payment_token_id ) {
			$token = \WC_Payment_Tokens::get( (int) $payment_token_id );
			if ( ! $token || $token->get_user_id() !== get_current_user_id() || $token->get_gateway_id() !== $this->id ) {
				wc_add_notice( __( 'Invalid saved payment method.', 'cardz3n-gateway' ), 'error' );
				return null;
			}
			$vault_id    = (string) $token->get_meta( 'cardz3n_vault_id' ) ?: $token->get_token();
			$using_saved = true;
			$normalized_source = $token instanceof \WC_Payment_Token_ECheck ? 'ach_vault' : 'card_vault';
		} elseif ( empty( $collect_token ) ) {
			wc_add_notice( __( 'Payment details could not be tokenized. Please try again.', 'cardz3n-gateway' ), 'error' );
			return null;
		}

		// Determine NMI "payment" field.
		$payment_kind = in_array( $normalized_source, array( 'ach', 'ach_vault' ), true ) ? 'check' : 'creditcard';

		// Transaction type from settings.
		$txn_type = 'yes' === $this->get_option( 'transaction_mode' ) ? 'sale' : $this->get_option( 'transaction_mode', 'sale' );
		if ( ! in_array( $txn_type, array( 'sale', 'auth' ), true ) ) {
			$txn_type = 'sale';
		}

		// Collect billing / shipping from the order.
		$billing = array(
			'first_name' => $order->get_billing_first_name(),
			'last_name'  => $order->get_billing_last_name(),
			'company'    => $order->get_billing_company(),
			'email'      => $order->get_billing_email(),
			'phone'      => $order->get_billing_phone(),
			'address1'   => $order->get_billing_address_1(),
			'address2'   => $order->get_billing_address_2(),
			'city'       => $order->get_billing_city(),
			'state'      => $order->get_billing_state(),
			'zip'        => $order->get_billing_postcode(),
			'country'    => $order->get_billing_country(),
		);
		$shipping = array(
			'first_name' => $order->get_shipping_first_name(),
			'last_name'  => $order->get_shipping_last_name(),
			'company'    => $order->get_shipping_company(),
			'address1'   => $order->get_shipping_address_1(),
			'address2'   => $order->get_shipping_address_2(),
			'city'       => $order->get_shipping_city(),
			'state'      => $order->get_shipping_state(),
			'zip'        => $order->get_shipping_postcode(),
			'country'    => $order->get_shipping_country(),
		);

		// Level 3 payload.
		$mapper = new Level3_Mapper( $this->settings );
		$level3 = $mapper->build( $order );

		// Descriptor.
		$descriptor = \Cardz3n_Gateway\descriptor_for_order( $order, $this->settings );

		// Whether to also tokenize (vault creation) during this transaction.
		$should_vault_card = ( $save_card && ! $using_saved && in_array( $normalized_source, array( 'card', 'apple_pay', 'google_pay' ), true ) );
		$should_vault_ach  = ( $save_ach && ! $using_saved && 'ach' === $normalized_source && ACH_Service::reuse_allowed() );

		$args = array(
			'type'              => $txn_type,
			'amount'            => $order->get_total(),
			'order_id'          => $order->get_id(),
			'order_description' => sprintf( /* translators: order id */ __( 'Order #%s', 'cardz3n-gateway' ), $order->get_order_number() ),
			'currency'          => $order->get_currency(),
			'descriptor'        => $descriptor,
			'payment'           => $payment_kind,
			'billing'           => $billing,
			'shipping'          => $shipping,
			'level3'            => $level3,
			'extra'             => array(
				'merchant_defined_field_10' => $normalized_source, // wallet source provenance
			),
		);

		if ( $using_saved ) {
			$args['customer_vault_id'] = $vault_id;
		} else {
			$args['payment_token'] = $collect_token;
			if ( $should_vault_card || $should_vault_ach ) {
				$args['vault'] = 'add_customer';
			}
			/*
			 * 1.0.17 — log the first 8 chars of the Collect.js token plus the
			 * first 4 chars of each key so support can verify at a glance
			 * whether the Security Key and Tokenization Key belong to the
			 * same merchant account. The full token and keys are never
			 * logged; Logger::redact() scrubs them from transaction logs too.
			 */
			Logger::info(
				'Submitting Collect.js token to transact.php',
				array(
					'token_prefix'      => substr( (string) $collect_token, 0, 8 ) . '...',
					'token_len'         => strlen( (string) $collect_token ),
					'sec_key_prefix'    => substr( $client->security_key(), 0, 4 ) . '...',
					'tok_key_prefix'    => substr( $client->tokenization_key(), 0, 4 ) . '...',
					'test_mode'         => $client->is_sandbox() ? 'yes' : 'no',
					'normalized_source' => $normalized_source,
				)
			);
		}

		$response = $client->transaction( $args );

		$extra = array(
			'payment_source_type' => $normalized_source,
			'transaction_type'    => $txn_type,
			'descriptor'          => $descriptor,
			'level3_sent'         => ! empty( $level3 ),
			'po_number'           => (string) $order->get_meta( '_cardz3n_po_number' ),
		);

		if ( 'auth' === $txn_type ) {
			$extra['authorized_amount'] = $order->get_total();
		} else {
			$extra['captured_amount'] = $order->get_total();
		}

		if ( ! $response['success'] ) {
			$note = Order_Service::failure_note( $response, $extra );
			$order->add_order_note( $note );

			/*
			 * 1.0.17 — translate the gateway's most common opaque error
			 * ("Payment Token does not exist REFID:...") into a plain-English
			 * message that tells the buyer and the merchant what to do. The
			 * raw text is still stored in the order note for support
			 * troubleshooting.
			 */
			$user_msg = $response['text'] ? $response['text'] : __( 'Payment could not be processed.', 'cardz3n-gateway' );
			if ( false !== stripos( (string) $response['text'], 'payment token does not exist' ) ) {
				Logger::error(
					'Gateway rejected Collect.js token — check Security Key / Tokenization Key pair',
					array(
						'gateway_text'   => $response['text'],
						'sec_key_prefix' => substr( $client->security_key(), 0, 4 ) . '...',
						'tok_key_prefix' => substr( $client->tokenization_key(), 0, 4 ) . '...',
						'test_mode'      => $client->is_sandbox() ? 'yes' : 'no',
					)
				);
				$user_msg = __(
					'We couldn\'t complete your payment because the gateway did not recognize the secure token. Please refresh the checkout page and try again. If this keeps happening, contact the store — the Security Key and Tokenization Key in the gateway settings may belong to different merchant accounts.',
					'cardz3n-gateway'
				);
			}

			wc_add_notice( $user_msg, 'error' );
			return null;
		}

		// Persist standard meta and notes.
		Order_Service::stamp( $order, $response, $extra );
		$order->add_order_note( Order_Service::success_note( $response, $extra ) );

		// Save token if the gateway returned a vault id and we requested vaulting.
		if ( ! empty( $response['customer_vault_id'] ) && ( $should_vault_card || $should_vault_ach ) && is_user_logged_in() ) {
			if ( $should_vault_card ) {
				Token_Service::save_card_token(
					get_current_user_id(),
					$this->id,
					$response['customer_vault_id'],
					array(
						'last4'     => substr( (string) ( $response['raw']['cc_number'] ?? '' ), -4 ),
						'brand'     => \Cardz3n_Gateway\brand_slug( $response['raw']['cc_type'] ?? $response['raw']['card_type'] ?? '' ),
						'exp_month' => \Cardz3n_Gateway\parse_ccexp( $response['raw']['cc_exp'] ?? $response['raw']['ccexp'] ?? '' )['month'],
						'exp_year'  => \Cardz3n_Gateway\parse_ccexp( $response['raw']['cc_exp'] ?? $response['raw']['ccexp'] ?? '' )['year'],
					)
				);
			}
			if ( $should_vault_ach ) {
				Token_Service::save_ach_token(
					get_current_user_id(),
					$this->id,
					$response['customer_vault_id'],
					array(
						'last4'        => substr( (string) ( $response['raw']['account_number'] ?? '' ), -4 ),
						'account_type' => isset( $_POST['cardz3n_ach_account_type'] ) ? sanitize_text_field( wp_unslash( $_POST['cardz3n_ach_account_type'] ) ) : 'checking', // phpcs:ignore WordPress.Security.NonceVerification.Missing
					)
				);
			}
		}

		// Complete or mark authorized.
		if ( 'sale' === $txn_type ) {
			$success_status = $this->get_option( 'success_order_status', '' );
			$order->payment_complete( $response['transaction_id'] );
			if ( ! empty( $success_status ) ) {
				$order->update_status( $success_status );
			}
		} else {
			// Auth only: leave awaiting capture.
			$order->update_status( 'on-hold', __( 'Authorized. Awaiting capture.', 'cardz3n-gateway' ) );
		}

		// Clear the cart and redirect.
		WC()->cart->empty_cart();

		return array(
			'result'   => 'success',
			'redirect' => $this->get_return_url( $order ),
		);
	}

	/* ------------------------------------------------------------------
	 * AJAX endpoints
	 * --------------------------------------------------------------- */

	public function ajax_validate_credentials() {
		// Capability check first so unauthorized users always get a clean 403.
		if ( ! current_user_can( 'manage_woocommerce' ) ) {
			wp_send_json_error( array( 'msg' => __( 'Insufficient permissions.', 'cardz3n-gateway' ) ), 403 );
		}

		// Nonce check with $die=false so we return a clean JSON body (not a 0/-1 text response).
		if ( ! check_ajax_referer( 'cardz3n_gw_nonce', 'nonce', false ) ) {
			wp_send_json_error(
				array( 'msg' => __( 'Invalid session. Reload the settings page and try again.', 'cardz3n-gateway' ) ),
				400
			);
		}

		/*
		 * Load settings fresh from the options table — never trust POST for credentials.
		 * The admin form masks the security key once it is saved (password input with
		 * masked placeholder), so the JS could POST an empty or masked string. Passing
		 * null here makes the API client re-read `woocommerce_{brand}_settings` itself.
		 */
		$client = new Api_Client( null );

		if ( ! $client->has_credentials() ) {
			// Business-logic failure — return HTTP 200 + success:false so the admin UI
			// shows a meaningful message instead of a generic "Network error." banner.
			wp_send_json_error(
				array(
					'ok'  => false,
					'msg' => __( 'Save changes first — no Security Key on file for the active mode.', 'cardz3n-gateway' ),
				)
			);
		}

		$result = $client->validate_credentials();

		// The API client only returns arrays (never WP_Error), but guard anyway.
		if ( is_wp_error( $result ) ) {
			wp_send_json_error( array( 'ok' => false, 'msg' => $result->get_error_message() ) );
		}

		if ( ! empty( $result['ok'] ) ) {
			wp_send_json_success( $result );
		}

		// Gateway rejected the credentials (e.g. "Invalid security key") — still HTTP 200.
		wp_send_json_error(
			array(
				'ok'  => false,
				'msg' => isset( $result['msg'] ) ? $result['msg'] : __( 'Gateway rejected the credentials.', 'cardz3n-gateway' ),
			)
		);
	}

	public function ajax_delete_token() {
		check_ajax_referer( 'cardz3n_gw_nonce', 'nonce' );
		$token_id = isset( $_POST['token_id'] ) ? absint( $_POST['token_id'] ) : 0;
		$token    = \WC_Payment_Tokens::get( $token_id );
		if ( ! $token || $token->get_user_id() !== get_current_user_id() ) {
			wp_send_json_error( array( 'msg' => __( 'Invalid token.', 'cardz3n-gateway' ) ), 400 );
		}
		$token->delete();
		wp_send_json_success();
	}
}
