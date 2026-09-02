<?php
/**
 * Settings trait — form_fields() for the main gateway class.
 *
 * Grouped, merchant-readable, and aligned with the CARDZ3N Gateway Build Spec v2.
 *
 * @package Cardz3n_Gateway
 */

namespace Cardz3n_Gateway;

defined( 'ABSPATH' ) || exit;

trait Settings_Trait {

	/**
	 * Build the WooCommerce settings form fields for this gateway.
	 */
	public function init_form_fields() {
		$brand = Brand::profile();

		$order_statuses  = function_exists( 'wc_get_order_statuses' ) ? wc_get_order_statuses() : array();
		$capture_choices = array_merge( array( '' => __( '— Disabled —', 'cardz3n-gateway' ) ), $order_statuses );

		$this->form_fields = array(

			/* ---------------- General ---------------- */
			'section_general'           => array(
				'title'       => __( 'General', 'cardz3n-gateway' ),
				'type'        => 'title',
				'description' => '',
			),
			'enabled'                   => array(
				'title'   => __( 'Enable / Disable', 'cardz3n-gateway' ),
				'type'    => 'checkbox',
				'label'   => sprintf(
					/* translators: brand name */
					__( 'Enable %s', 'cardz3n-gateway' ),
					$brand['name']
				),
				'default' => 'yes',
			),
			'title'                     => array(
				'title'             => __( 'Checkout Title', 'cardz3n-gateway' ),
				'type'              => 'text',
				'description'       => __( 'The label buyers see at checkout. Locked to "Powered by CARDZ3N" to preserve consistent brand trust at payment time.', 'cardz3n-gateway' ),
				'default'           => __( 'Powered by CARDZ3N', 'cardz3n-gateway' ),
				'desc_tip'          => true,
				'custom_attributes' => array( 'readonly' => 'readonly' ),
			),
			'description'               => array(
				'title'       => __( 'Checkout Description', 'cardz3n-gateway' ),
				'type'        => 'textarea',
				'description' => __( 'Short explanation shown beneath the payment option at checkout.', 'cardz3n-gateway' ),
				'default'     => __( 'Pay securely with a credit/debit card, ACH, Apple Pay, or Google Pay.', 'cardz3n-gateway' ),
			),
			'thankyou_instructions'     => array(
				'title'       => __( 'Thank-you Instructions', 'cardz3n-gateway' ),
				'type'        => 'textarea',
				'description' => __( 'Optional message shown on the order-received page.', 'cardz3n-gateway' ),
				'default'     => '',
			),
			'icon_style'                => array(
				'title'   => __( 'Gateway Icon Style', 'cardz3n-gateway' ),
				'type'    => 'select',
				'options' => array(
					'brands' => __( 'Show accepted card-brand icons', 'cardz3n-gateway' ),
					'brand'  => sprintf(
						/* translators: brand name */
						__( 'Show %s logo only', 'cardz3n-gateway' ),
						$brand['short_name']
					),
					'none'   => __( 'No icon', 'cardz3n-gateway' ),
				),
				'default' => 'brands',
			),
			'debug_mode'                => array(
				'title'   => __( 'Debug Mode', 'cardz3n-gateway' ),
				'type'    => 'checkbox',
				'label'   => __( 'Log transaction diagnostics (no sensitive data) to WooCommerce → Status → Logs.', 'cardz3n-gateway' ),
				'default' => 'no',
			),

			/* ---------------- Credentials ---------------- */
			'section_credentials'       => array(
				'title'       => __( 'API Credentials', 'cardz3n-gateway' ),
				'type'        => 'title',
				'description' => __( 'Generate these in your CARDZ3N Merchant Portal (z3n.transactiongateway.com) under <strong>Settings → Security Keys</strong>. Keys come in two flavors:<br><br><strong>Private Key</strong> — pick scope <em>&quot;Cart&quot;</em> (or <em>&quot;API and Cart&quot;</em>). Server-side only; signs transact.php requests.<br><strong>Public Key</strong> — pick scope <em>&quot;Tokenization&quot;</em>. Browser-side; used by inline Collect.js to tokenize card &amp; ACH fields. The key looks like <code>xxxxxx-xxxxxx-xxxxxx-xxxxxx</code>. A <em>&quot;Collect Checkout&quot;</em> public key (starting with <code>checkout_public_</code>) will NOT work — that scope drives a different hosted-redirect checkout.<br><br>Test Mode and Live Mode use different merchant accounts — do not mix Test and Live keys.', 'cardz3n-gateway' ),
			),
			'test_mode'                 => array(
				'title'       => __( 'Test Mode', 'cardz3n-gateway' ),
				'type'        => 'checkbox',
				'label'       => __( 'Enable Test Mode', 'cardz3n-gateway' ),
				'description' => __( 'When enabled, the plugin uses the Test Private &amp; Public keys to route transactions through the CARDZ3N test processor. No real card is charged. Turn off to use the Live keys for real transactions.', 'cardz3n-gateway' ),
				'default'     => 'yes',
			),
			'live_security_key'         => array(
				'title'       => __( 'Live Private Key (Cart)', 'cardz3n-gateway' ),
				'type'        => 'password',
				'default'     => '',
				'custom_attributes' => array( 'autocomplete' => 'off' ),
				'description' => __( 'From CARDZ3N Portal → Settings → Security Keys → <strong>Private Security Keys</strong>. Scope must be <em>&quot;Cart&quot;</em> or <em>&quot;API and Cart&quot;</em>. Used server-side only.', 'cardz3n-gateway' ),
			),
			'live_tokenization_key'     => array(
				'title'       => __( 'Live Public Key (Tokenization)', 'cardz3n-gateway' ),
				'type'        => 'text',
				'default'     => '',
				'custom_attributes' => array( 'autocomplete' => 'off' ),
				'description' => __( 'From CARDZ3N Portal → Settings → Security Keys → <strong>Public Security Keys</strong>. Scope must be <em>&quot;Tokenization&quot;</em>. Used by inline Collect.js in the browser (format: <code>xxxxxx-xxxxxx-xxxxxx-xxxxxx</code>). A <em>&quot;Collect Checkout&quot;</em> key (starting <code>checkout_public_</code>) will NOT work.', 'cardz3n-gateway' ),
			),
			'test_security_key'         => array(
				'title'       => __( 'Test Private Key (Cart)', 'cardz3n-gateway' ),
				'type'        => 'password',
				'default'     => '',
				'custom_attributes' => array( 'autocomplete' => 'off' ),
				'description' => __( 'Test-merchant Private Security Key with <em>Cart</em> scope. The shared NMI demo Security Key is published on the <a href="https://z3n.transactiongateway.com/merchants/resources/integration/integration_portal.php#testing_information" target="_blank">Testing Information page</a>.', 'cardz3n-gateway' ),
			),
			'test_tokenization_key'     => array(
				'title'       => __( 'Test Public Key (Tokenization)', 'cardz3n-gateway' ),
				'type'        => 'text',
				'default'     => '',
				'custom_attributes' => array( 'autocomplete' => 'off' ),
				'description' => __( 'Test-merchant Public Security Key with <em>Tokenization</em> scope (format: <code>xxxxxx-xxxxxx-xxxxxx-xxxxxx</code>). If your test merchant does not have one, request it from CARDZ3N support. A <em>Collect Checkout</em>-scoped key (starting <code>checkout_public_</code>) will NOT work.', 'cardz3n-gateway' ),
			),
			'validate_credentials'      => array(
				'title'       => __( 'Credential Test', 'cardz3n-gateway' ),
				'type'        => 'cardz3n_validate_button',
				'description' => __( 'Save changes first, then click to verify the gateway accepts your keys.', 'cardz3n-gateway' ),
			),

			/* ---------------- Payment Methods ---------------- */
			'section_payments'          => array(
				'title' => __( 'Payment Methods', 'cardz3n-gateway' ),
				'type'  => 'title',
			),
			'enable_cards'              => array(
				'title'   => __( 'Credit / Debit Cards', 'cardz3n-gateway' ),
				'type'    => 'checkbox',
				'label'   => __( 'Enable card payments.', 'cardz3n-gateway' ),
				'default' => 'yes',
			),
			'enable_ach'                => array(
				'title'   => __( 'ACH / eCheck', 'cardz3n-gateway' ),
				'type'    => 'checkbox',
				'label'   => __( 'Enable ACH bank-account payments.', 'cardz3n-gateway' ),
				'default' => 'yes',
			),
			'enable_ach_reuse'          => array(
				'title'   => __( 'Tokenized ACH Reuse', 'cardz3n-gateway' ),
				'type'    => 'checkbox',
				'label'   => __( 'Allow buyers to save ACH for reuse. Only enable if your CARDZ3N account permits tokenized ACH.', 'cardz3n-gateway' ),
				'default' => 'no',
			),
			'enable_apple_pay'          => array(
				'title'   => __( 'Apple Pay', 'cardz3n-gateway' ),
				'type'    => 'checkbox',
				'label'   => __( 'Offer Apple Pay when the buyer is on a supported device.', 'cardz3n-gateway' ),
				'default' => 'yes',
			),
			'enable_google_pay'         => array(
				'title'   => __( 'Google Pay', 'cardz3n-gateway' ),
				'type'    => 'checkbox',
				'label'   => __( 'Offer Google Pay when the buyer is on a supported device.', 'cardz3n-gateway' ),
				'default' => 'yes',
			),
			'enable_saved_methods'      => array(
				'title'   => __( 'Saved Payment Methods', 'cardz3n-gateway' ),
				'type'    => 'checkbox',
				'label'   => __( 'Let logged-in buyers save cards/ACH for reuse.', 'cardz3n-gateway' ),
				'default' => 'yes',
			),
			'enable_subscriptions'      => array(
				'title'   => __( 'Subscriptions Support', 'cardz3n-gateway' ),
				'type'    => 'checkbox',
				'label'   => __( 'Enable recurring billing when WooCommerce Subscriptions is installed.', 'cardz3n-gateway' ),
				'default' => 'yes',
			),
			'enable_preorders'          => array(
				'title'   => __( 'Pre-Orders Support', 'cardz3n-gateway' ),
				'type'    => 'checkbox',
				'label'   => __( 'Enable tokenized pre-order handling when WooCommerce Pre-Orders is installed.', 'cardz3n-gateway' ),
				'default' => 'yes',
			),

			/* ---------------- Processing ---------------- */
			'section_processing'        => array(
				'title' => __( 'Processing Rules', 'cardz3n-gateway' ),
				'type'  => 'title',
			),
			'transaction_mode'          => array(
				'title'   => __( 'Transaction Mode', 'cardz3n-gateway' ),
				'type'    => 'select',
				'options' => array(
					'sale' => __( 'Sale (authorize + capture immediately)', 'cardz3n-gateway' ),
					'auth' => __( 'Authorize only (capture later)', 'cardz3n-gateway' ),
				),
				'default' => 'sale',
			),
			'auto_capture_status'       => array(
				'title'       => __( 'Auto-capture on Status Change', 'cardz3n-gateway' ),
				'type'        => 'select',
				'options'     => $capture_choices,
				'description' => __( 'If set, authorized-only orders are captured automatically when they reach this status.', 'cardz3n-gateway' ),
				'default'     => '',
				'desc_tip'    => true,
			),
			'success_order_status'      => array(
				'title'   => __( 'Status After Successful Payment', 'cardz3n-gateway' ),
				'type'    => 'select',
				'options' => array(
					''           => __( 'Default (processing)', 'cardz3n-gateway' ),
					'processing' => __( 'Processing', 'cardz3n-gateway' ),
					'completed'  => __( 'Completed', 'cardz3n-gateway' ),
					'on-hold'    => __( 'On hold', 'cardz3n-gateway' ),
				),
				'default' => '',
			),
			'allow_dynamic_descriptors' => array(
				'title'       => __( 'Send Dynamic Descriptor', 'cardz3n-gateway' ),
				'type'        => 'checkbox',
				'label'       => __( 'Send a dynamic billing descriptor with every card transaction', 'cardz3n-gateway' ),
				'description' => __( '<strong>Leave this off unless your processor explicitly supports merchant-supplied descriptors.</strong> Most CARDZ3N / NMI processors reject transactions that include a <code>descriptor</code> field with <em>"Custom descriptors are not allowed for this processor"</em>. To use this feature, first log in to the CARDZ3N Partner Portal, open your merchant account\'s <strong>Advanced Merchant Features</strong>, and enable <strong>Allow merchant to pass Dynamic Billing Descriptors</strong>. Then return here and check this box.', 'cardz3n-gateway' ),
				'default'     => 'no',
			),
			'descriptor'                => array(
				'title'       => __( 'Dynamic Descriptor', 'cardz3n-gateway' ),
				'type'        => 'text',
				'description' => __( 'Up to 25 chars shown on cardholder statements. Leave blank to use your processor-assigned descriptor. <strong>Only sent when "Send Dynamic Descriptor" is checked above.</strong>', 'cardz3n-gateway' ),
				'default'     => '',
				'desc_tip'    => false,
			),
			'descriptor_suffix_source'  => array(
				'title'   => __( 'Descriptor Suffix Source', 'cardz3n-gateway' ),
				'type'    => 'select',
				'options' => array(
					''         => __( 'None (static descriptor)', 'cardz3n-gateway' ),
					'order_id' => __( 'Order ID', 'cardz3n-gateway' ),
				),
				'default' => '',
			),
			'allowed_card_brands'       => array(
				'title'    => __( 'Accepted Card Brands', 'cardz3n-gateway' ),
				'type'     => 'multiselect',
				'class'    => 'wc-enhanced-select',
				'options'  => array(
					'visa'       => __( 'Visa', 'cardz3n-gateway' ),
					'mastercard' => __( 'Mastercard', 'cardz3n-gateway' ),
					'amex'       => __( 'American Express', 'cardz3n-gateway' ),
					'discover'   => __( 'Discover', 'cardz3n-gateway' ),
					'maestro'    => __( 'Maestro', 'cardz3n-gateway' ),
					'jcb'        => __( 'JCB', 'cardz3n-gateway' ),
					'diners'     => __( 'Diners Club', 'cardz3n-gateway' ),
					'unionpay'   => __( 'UnionPay', 'cardz3n-gateway' ),
				),
				// 1.0.23 — Maestro, JCB, Diners Club, and UnionPay are now on by
				// default so the checkout brand row advertises the full CARDZ3N /
				// NMI routing coverage out of the box. Merchants can still
				// deselect any brand they don't want displayed.
				'default'  => array( 'visa', 'mastercard', 'amex', 'discover', 'maestro', 'jcb', 'diners', 'unionpay' ),
				'desc_tip' => true,
			),
			'gateway_receipts'          => array(
				'title'   => __( 'Gateway Receipts', 'cardz3n-gateway' ),
				'type'    => 'checkbox',
				'label'   => __( 'Also send the gateway-generated receipt email (WooCommerce receipt is primary).', 'cardz3n-gateway' ),
				'default' => 'no',
			),
			'enable_3ds'                => array(
				'title'       => __( '3D Secure 2.0', 'cardz3n-gateway' ),
				'type'        => 'checkbox',
				'label'       => __( 'Enable 3D Secure 2.0', 'cardz3n-gateway' ),
				'description' => __( '3D Secure 2.0 can help you avoid fraudulent transactions by authenticating transactions before submitting them to the gateway for processing.', 'cardz3n-gateway' ),
				'default'     => 'no',
			),

			/* ---------------- Commercial Data ---------------- */
			'section_commercial'        => array(
				'title'       => __( 'Level 3 / CEDP', 'cardz3n-gateway' ),
				'type'        => 'title',
				'description' => __( 'Send Level 3 Commercial/Corporate Card Enhanced Data (CEDP) on qualifying transactions to earn lower interchange rates. Visa retired its separate Level 2 program in 2026 -- Level 3 / CEDP is now the only path to reduced interchange on Visa commercial cards. <strong>All applicable fields below must be present together for a transaction to qualify for the discounted rate; partial data will not qualify and may be rejected outright by the card brand.</strong> Fields marked auto-pulled below are populated automatically from the order and your store profile; anything not available is omitted, not fabricated.', 'cardz3n-gateway' ),
			),
			'enable_level3'             => array(
				'title'   => __( 'Enable Level 3 / CEDP Transmission', 'cardz3n-gateway' ),
				'type'    => 'checkbox',
				'label'   => __( 'Attach enhanced commercial data to every transaction when applicable.', 'cardz3n-gateway' ),
				/* 1.0.21: opt-in. Level 2/3 is a commercial-card feature most merchants don’t need; enabling it requires meaningful catalog metadata (UPC, commodity code, tax amount) and misconfigured fields can DOWNGRADE interchange rather than improve it. Off by default; merchants who know they qualify enable it intentionally. */
				'default' => 'no',
			),
			'merchant_name_override'    => array(
				'title'       => __( 'Merchant Name Override', 'cardz3n-gateway' ),
				'type'        => 'text',
				'description' => __( 'Leave blank to use the WooCommerce store name.', 'cardz3n-gateway' ),
				'default'     => '',
				'desc_tip'    => true,
			),
			'merchant_tin'              => array(
				'title'       => __( 'Merchant Tax ID (TIN)', 'cardz3n-gateway' ),
				'type'        => 'text',
				'description' => __( 'Required for some Visa/MC commercial programs. Never inferred.', 'cardz3n-gateway' ),
				'default'     => '',
				'desc_tip'    => true,
			),
			'merchant_state'            => array(
				'title'   => __( 'Merchant State Code Override', 'cardz3n-gateway' ),
				'type'    => 'text',
				'default' => '',
			),
			'merchant_postal'           => array(
				'title'   => __( 'Ship-from Postal Code Override', 'cardz3n-gateway' ),
				'type'    => 'text',
				'default' => '',
			),
			'default_uom'               => array(
				'title'       => __( 'Default Unit of Measure (UOM)', 'cardz3n-gateway' ),
				'type'        => 'text',
				'default'     => 'EA',
				'description' => __( 'Used when a product has no _cardz3n_uom meta value.', 'cardz3n-gateway' ),
				'desc_tip'    => true,
			),
			'commodity_source'          => array(
				'title'   => __( 'Commodity Code Source', 'cardz3n-gateway' ),
				'type'    => 'select',
				'options' => array(
					'category' => __( 'WooCommerce category slug (Recommended)', 'cardz3n-gateway' ),
					'meta'     => __( 'Product meta key (_cardz3n_commodity_code)', 'cardz3n-gateway' ),
					'none'     => __( 'Omit commodity code', 'cardz3n-gateway' ),
				),
				'default' => 'category',
			),
			'upc_meta_key'              => array(
				'title'   => __( 'UPC Meta Key', 'cardz3n-gateway' ),
				'type'    => 'text',
				'default' => '_cardz3n_upc',
			),
			'commodity_meta_key'        => array(
				'title'   => __( 'Commodity Code Meta Key', 'cardz3n-gateway' ),
				'type'    => 'text',
				'default' => '_cardz3n_commodity_code',
			),
			'enable_po_field'           => array(
				'title'   => __( 'Checkout PO Number Field', 'cardz3n-gateway' ),
				'type'    => 'checkbox',
				'label'   => __( 'Show a Purchase Order (PO) number field at checkout.', 'cardz3n-gateway' ),
				/* 1.0.21: opt-in. PO numbers are a B2B/procurement feature; a retail merchant’s buyer never needs this box and it just adds noise on the checkout. Off by default; B2B stores enable it intentionally. */
				'default' => 'no',
			),
		);
	}

	/**
	 * Custom "Test" button field type for credential validation.
	 *
	 * @param string $key  Form-field key.
	 * @param array  $data Field definition (title, description, etc.).
	 * @return string
	 */
	public function generate_cardz3n_validate_button_html( $key, $data ) {
		$field_key = $this->get_field_key( $key );
		ob_start();
		?>
		<tr valign="top">
			<th scope="row" class="titledesc">
				<label><?php echo esc_html( $data['title'] ); ?></label>
			</th>
			<td class="forminp">
				<button type="button" class="button cardz3n-validate-btn" data-section="<?php echo esc_attr( Brand::id() ); ?>">
					<?php esc_html_e( 'Test Credentials', 'cardz3n-gateway' ); ?>
				</button>
				<span class="cardz3n-validate-result" style="margin-left:10px;"></span>
				<p class="description"><?php echo esc_html( $data['description'] ); ?></p>
			</td>
		</tr>
		<?php
		return ob_get_clean();
	}
}
