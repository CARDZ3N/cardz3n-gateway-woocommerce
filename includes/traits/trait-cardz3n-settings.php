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

	public function init_form_fields() {
		$brand = Brand::profile();

		$order_statuses  = function_exists( 'wc_get_order_statuses' ) ? wc_get_order_statuses() : array();
		$capture_choices = array_merge( array( '' => __( '— Disabled —', 'cardz3n-gateway' ) ), $order_statuses );

		$this->form_fields = array(

			/* ---------------- General ---------------- */
			'section_general'        => array(
				'title'       => __( 'General', 'cardz3n-gateway' ),
				'type'        => 'title',
				'description' => '',
			),
			'enabled'                => array(
				'title'   => __( 'Enable / Disable', 'cardz3n-gateway' ),
				'type'    => 'checkbox',
				'label'   => sprintf(
					/* translators: brand name */
					__( 'Enable %s', 'cardz3n-gateway' ),
					$brand['name']
				),
				'default' => 'no',
			),
			'title'                  => array(
				'title'       => __( 'Checkout Title', 'cardz3n-gateway' ),
				'type'        => 'text',
				'description' => __( 'The label buyers see at checkout.', 'cardz3n-gateway' ),
				'default'     => $brand['default_title'],
				'desc_tip'    => true,
			),
			'description'            => array(
				'title'       => __( 'Checkout Description', 'cardz3n-gateway' ),
				'type'        => 'textarea',
				'description' => __( 'Short explanation shown beneath the payment option at checkout.', 'cardz3n-gateway' ),
				'default'     => __( 'Pay securely with a credit/debit card, ACH, Apple Pay, or Google Pay. We never see or store your payment details.', 'cardz3n-gateway' ),
			),
			'thankyou_instructions'  => array(
				'title'       => __( 'Thank-you Instructions', 'cardz3n-gateway' ),
				'type'        => 'textarea',
				'description' => __( 'Optional message shown on the order-received page.', 'cardz3n-gateway' ),
				'default'     => '',
			),
			'icon_style'             => array(
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
			'debug_mode'             => array(
				'title'       => __( 'Debug Mode', 'cardz3n-gateway' ),
				'type'        => 'checkbox',
				'label'       => __( 'Log transaction diagnostics (no sensitive data) to WooCommerce → Status → Logs.', 'cardz3n-gateway' ),
				'default'     => 'no',
			),

			/* ---------------- Credentials ---------------- */
			'section_credentials'    => array(
				'title'       => __( 'API Credentials', 'cardz3n-gateway' ),
				'type'        => 'title',
				'description' => __( 'Generate these in your CARDZ3N / NMI Merchant Portal under Settings → Security Keys. The Tokenization Key is public (safe for the browser). The Security Key is private and never leaves your server.', 'cardz3n-gateway' ),
			),
			'test_mode'              => array(
				'title'       => __( 'Test Mode', 'cardz3n-gateway' ),
				'type'        => 'checkbox',
				'label'       => __( 'Route transactions through CARDZ3N Test Mode.', 'cardz3n-gateway' ),
				'description' => __( 'CARDZ3N does not use a separate sandbox portal — Test Mode is a toggle on the same gateway account. Use the same Security Key and Tokenization Key for both live and test transactions. Turn this on to send transactions to the test processor without charging a real card.', 'cardz3n-gateway' ),
				'default'     => 'yes',
			),
			'security_key'           => array(
				'title'       => __( 'Security Key', 'cardz3n-gateway' ),
				'type'        => 'password',
				'default'     => '',
				'description' => __( 'Private key. Used only on the server to sign API requests. Never exposed to the browser.', 'cardz3n-gateway' ),
				'desc_tip'    => true,
			),
			'tokenization_key'       => array(
				'title'       => __( 'Tokenization Key (public)', 'cardz3n-gateway' ),
				'type'        => 'text',
				'default'     => '',
				'description' => __( 'Public key used by Collect.js in the browser to tokenize card and ACH data.', 'cardz3n-gateway' ),
				'desc_tip'    => true,
			),
			'validate_credentials'   => array(
				'title'       => __( 'Credential Test', 'cardz3n-gateway' ),
				'type'        => 'cardz3n_validate_button',
				'description' => __( 'Save changes first, then click to verify the gateway accepts your keys.', 'cardz3n-gateway' ),
			),

			/* ---------------- Payment Methods ---------------- */
			'section_payments'       => array(
				'title' => __( 'Payment Methods', 'cardz3n-gateway' ),
				'type'  => 'title',
			),
			'enable_cards'           => array(
				'title'   => __( 'Credit / Debit Cards', 'cardz3n-gateway' ),
				'type'    => 'checkbox',
				'label'   => __( 'Enable card payments.', 'cardz3n-gateway' ),
				'default' => 'yes',
			),
			'enable_ach'             => array(
				'title'   => __( 'ACH / eCheck', 'cardz3n-gateway' ),
				'type'    => 'checkbox',
				'label'   => __( 'Enable ACH bank-account payments.', 'cardz3n-gateway' ),
				'default' => 'yes',
			),
			'enable_ach_reuse'       => array(
				'title'   => __( 'Tokenized ACH Reuse', 'cardz3n-gateway' ),
				'type'    => 'checkbox',
				'label'   => __( 'Allow buyers to save ACH for reuse. Only enable if your CARDZ3N account permits tokenized ACH.', 'cardz3n-gateway' ),
				'default' => 'no',
			),
			'enable_apple_pay'       => array(
				'title'   => __( 'Apple Pay', 'cardz3n-gateway' ),
				'type'    => 'checkbox',
				'label'   => __( 'Offer Apple Pay when the buyer is on a supported device.', 'cardz3n-gateway' ),
				'default' => 'yes',
			),
			'enable_google_pay'      => array(
				'title'   => __( 'Google Pay', 'cardz3n-gateway' ),
				'type'    => 'checkbox',
				'label'   => __( 'Offer Google Pay when the buyer is on a supported device.', 'cardz3n-gateway' ),
				'default' => 'yes',
			),
			'enable_saved_methods'   => array(
				'title'   => __( 'Saved Payment Methods', 'cardz3n-gateway' ),
				'type'    => 'checkbox',
				'label'   => __( 'Let logged-in buyers save cards/ACH for reuse.', 'cardz3n-gateway' ),
				'default' => 'yes',
			),
			'enable_subscriptions'   => array(
				'title'   => __( 'Subscriptions Support', 'cardz3n-gateway' ),
				'type'    => 'checkbox',
				'label'   => __( 'Enable recurring billing when WooCommerce Subscriptions is installed.', 'cardz3n-gateway' ),
				'default' => 'yes',
			),
			'enable_preorders'       => array(
				'title'   => __( 'Pre-Orders Support', 'cardz3n-gateway' ),
				'type'    => 'checkbox',
				'label'   => __( 'Enable tokenized pre-order handling when WooCommerce Pre-Orders is installed.', 'cardz3n-gateway' ),
				'default' => 'yes',
			),

			/* ---------------- Processing ---------------- */
			'section_processing'     => array(
				'title' => __( 'Processing Rules', 'cardz3n-gateway' ),
				'type'  => 'title',
			),
			'transaction_mode'       => array(
				'title'   => __( 'Transaction Mode', 'cardz3n-gateway' ),
				'type'    => 'select',
				'options' => array(
					'sale' => __( 'Sale (authorize + capture immediately)', 'cardz3n-gateway' ),
					'auth' => __( 'Authorize only (capture later)', 'cardz3n-gateway' ),
				),
				'default' => 'sale',
			),
			'auto_capture_status'    => array(
				'title'       => __( 'Auto-capture on Status Change', 'cardz3n-gateway' ),
				'type'        => 'select',
				'options'     => $capture_choices,
				'description' => __( 'If set, authorized-only orders are captured automatically when they reach this status.', 'cardz3n-gateway' ),
				'default'     => '',
				'desc_tip'    => true,
			),
			'success_order_status'   => array(
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
			'descriptor'             => array(
				'title'       => __( 'Dynamic Descriptor', 'cardz3n-gateway' ),
				'type'        => 'text',
				'description' => __( 'Up to 25 chars shown on cardholder statements.', 'cardz3n-gateway' ),
				'default'     => $brand['default_descriptor'],
				'desc_tip'    => true,
			),
			'descriptor_suffix_source' => array(
				'title'   => __( 'Descriptor Suffix Source', 'cardz3n-gateway' ),
				'type'    => 'select',
				'options' => array(
					''         => __( 'None (static descriptor)', 'cardz3n-gateway' ),
					'order_id' => __( 'Order ID', 'cardz3n-gateway' ),
				),
				'default' => '',
			),
			'allowed_card_brands'    => array(
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
				),
				'default'  => array( 'visa', 'mastercard', 'amex', 'discover' ),
				'desc_tip' => true,
			),
			'gateway_receipts'       => array(
				'title'   => __( 'Gateway Receipts', 'cardz3n-gateway' ),
				'type'    => 'checkbox',
				'label'   => __( 'Also send the gateway-generated receipt email (WooCommerce receipt is primary).', 'cardz3n-gateway' ),
				'default' => 'no',
			),
			'enable_3ds'             => array(
				'title'   => __( '3-D Secure 2 / SCA', 'cardz3n-gateway' ),
				'type'    => 'checkbox',
				'label'   => __( 'Attempt 3DS2 authentication when the gateway/account supports it.', 'cardz3n-gateway' ),
				'default' => 'yes',
			),

			/* ---------------- Commercial Data ---------------- */
			'section_commercial'     => array(
				'title'       => __( 'Level 2 / Level 3 Commercial Data', 'cardz3n-gateway' ),
				'type'        => 'title',
				'description' => __( 'Send enhanced data on commercial/purchasing cards to qualify for lower interchange. Fields are populated automatically from WooCommerce order data; any not available are omitted, not fabricated.', 'cardz3n-gateway' ),
			),
			'enable_level3'          => array(
				'title'   => __( 'Enable Level 2/3 Transmission', 'cardz3n-gateway' ),
				'type'    => 'checkbox',
				'label'   => __( 'Attach enhanced commercial data to every transaction when applicable.', 'cardz3n-gateway' ),
				'default' => 'yes',
			),
			'merchant_name_override' => array(
				'title'       => __( 'Merchant Name Override', 'cardz3n-gateway' ),
				'type'        => 'text',
				'description' => __( 'Leave blank to use the WooCommerce store name.', 'cardz3n-gateway' ),
				'default'     => '',
				'desc_tip'    => true,
			),
			'merchant_tin'           => array(
				'title'       => __( 'Merchant Tax ID (TIN)', 'cardz3n-gateway' ),
				'type'        => 'text',
				'description' => __( 'Required for some Visa/MC commercial programs. Never inferred.', 'cardz3n-gateway' ),
				'default'     => '',
				'desc_tip'    => true,
			),
			'merchant_state'         => array(
				'title'   => __( 'Merchant State Code Override', 'cardz3n-gateway' ),
				'type'    => 'text',
				'default' => '',
			),
			'merchant_postal'        => array(
				'title'   => __( 'Ship-from Postal Code Override', 'cardz3n-gateway' ),
				'type'    => 'text',
				'default' => '',
			),
			'default_uom'            => array(
				'title'       => __( 'Default Unit of Measure (UOM)', 'cardz3n-gateway' ),
				'type'        => 'text',
				'default'     => 'EA',
				'description' => __( 'Used when a product has no _cardz3n_uom meta value.', 'cardz3n-gateway' ),
				'desc_tip'    => true,
			),
			'commodity_source'       => array(
				'title'   => __( 'Commodity Code Source', 'cardz3n-gateway' ),
				'type'    => 'select',
				'options' => array(
					'category' => __( 'WooCommerce category slug (Recommended)', 'cardz3n-gateway' ),
					'meta'     => __( 'Product meta key (_cardz3n_commodity_code)', 'cardz3n-gateway' ),
					'none'     => __( 'Omit commodity code', 'cardz3n-gateway' ),
				),
				'default' => 'category',
			),
			'upc_meta_key'           => array(
				'title'   => __( 'UPC Meta Key', 'cardz3n-gateway' ),
				'type'    => 'text',
				'default' => '_cardz3n_upc',
			),
			'commodity_meta_key'     => array(
				'title'   => __( 'Commodity Code Meta Key', 'cardz3n-gateway' ),
				'type'    => 'text',
				'default' => '_cardz3n_commodity_code',
			),
			'enable_po_field'        => array(
				'title'   => __( 'Checkout PO Number Field', 'cardz3n-gateway' ),
				'type'    => 'checkbox',
				'label'   => __( 'Show a Purchase Order (PO) number field at checkout.', 'cardz3n-gateway' ),
				'default' => 'yes',
			),
		);
	}

	/**
	 * Custom "Test" button field type for credential validation.
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
