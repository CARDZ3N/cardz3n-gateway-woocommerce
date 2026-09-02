<?php
/**
 * Level 2 / Level 3 commercial-data mapper.
 *
 * Translates a WooCommerce order into the NMI Level 3 field names accepted by
 * transact.php. Values are derived in this order of precedence:
 *
 *   1. Order-level meta (e.g., PO number from checkout)
 *   2. Product-level meta (_cardz3n_upc, _cardz3n_commodity_code, _cardz3n_uom, etc.)
 *   3. Variation-level meta (variations override product-level when present)
 *   4. Merchant plugin settings defaults (UOM, commodity source, merchant TIN, etc.)
 *   5. Derived WooCommerce values (category slug for commodity code, shipping totals, etc.)
 *
 * Per spec: if a value is unavailable, it is OMITTED rather than fabricated.
 *
 * NMI Level 3 field reference keys used here:
 *   tax                → order tax
 *   shipping           → freight total
 *   ponumber           → customer PO
 *   ship_from_postal   → merchant postal origin
 *   shipping_postal    → destination postal
 *   shipping_country   → destination country
 *   merchant_defined_field_* → optional merchant overrides
 *   item_product_code_{N}, item_description_{N}, item_commodity_code_{N},
 *   item_unit_cost_{N}, item_quantity_{N}, item_unit_of_measure_{N},
 *   item_total_amount_{N}, item_tax_amount_{N}, item_discount_amount_{N}
  	 * customerid            -> WooCommerce customer ID (Customer Code)
   	 * summary_commodity_code -> order-level commodity code (via order meta)
    	 * duty_amount            -> import duty on purchased goods (via order meta)
	 	 * vat_tax_amount, vat_tax_rate, vat_invoice_reference_number -> VAT fields
	  	 *   (all via order meta; UK/EU merchants only)
 *
 * @package Cardz3n_Gateway
 */

namespace Cardz3n_Gateway;

defined( 'ABSPATH' ) || exit;

/**
 * Maps a WooCommerce order into NMI Level 2/3 field data.
 */
class Level3_Mapper {

	/**
	 * Merchant plugin settings.
	 *
	 * @var array
	 */
	private $settings;

	/**
	 * Load merchant settings, defaulting to the saved gateway options.
	 *
	 * @param array $settings Optional settings override, mainly for tests.
	 */
	public function __construct( array $settings = null ) {
		if ( null === $settings ) {
			$settings = get_option( 'woocommerce_' . Brand::id() . '_settings', array() );
		}
		$this->settings = $settings;
	}

	/**
	 * Whether Level 2/3 data submission is enabled in settings.
	 */
	public function enabled() {
		return isset( $this->settings['enable_level3'] ) && 'yes' === $this->settings['enable_level3'];
	}

	/**
	 * Build the Level 2/3 payload for a given order.
	 *
	 * @param \WC_Order $order Order to build the payload from.
	 * @return array Level 2/3 payload fields, or an empty array when disabled.
	 */
	public function build( \WC_Order $order ) {
		if ( ! $this->enabled() ) {
			return array();
		}

		$payload = array();

		// ------- Merchant-level fields -------.
		$merchant_name_override   = trim( (string) ( $this->settings['merchant_name_override'] ?? '' ) );
		$merchant_tin             = trim( (string) ( $this->settings['merchant_tin'] ?? '' ) );
		$merchant_state_override  = trim( (string) ( $this->settings['merchant_state'] ?? '' ) );
		$merchant_postal_override = trim( (string) ( $this->settings['merchant_postal'] ?? '' ) );

		if ( '' !== $merchant_tin ) {
			$payload['merchant_defined_field_1'] = self::ascii( $merchant_tin );
		}
		if ( '' !== $merchant_name_override ) {
			$payload['merchant_defined_field_2'] = self::ascii( $merchant_name_override );
		}
		if ( '' !== $merchant_state_override ) {
			$payload['merchant_defined_field_3'] = self::ascii( $merchant_state_override );
		}

		// Ship-from postal.
		$ship_from_postal = $merchant_postal_override;
		if ( '' === $ship_from_postal ) {
			$ship_from_postal = (string) ( WC()->countries ? WC()->countries->get_base_postcode() : '' );
		}
		if ( '' !== $ship_from_postal ) {
			$payload['ship_from_postal'] = self::ascii( $ship_from_postal );
		}

		// ------- Order-level fields -------.
		$tax_total = (float) $order->get_total_tax();
		if ( $tax_total > 0 ) {
			$payload['tax'] = number_format( $tax_total, 2, '.', '' );
		}

		$shipping_total = (float) $order->get_shipping_total() + (float) $order->get_shipping_tax();
		if ( $shipping_total > 0 ) {
			$payload['shipping'] = number_format( $shipping_total, 2, '.', '' );
		}

		// PO number: prefer explicit order meta, fall back to checkout field if present.
		$po = $order->get_meta( '_cardz3n_po_number' );
		if ( empty( $po ) ) {
			$po = $order->get_meta( '_po_number' );
		}
		if ( empty( $po ) && isset( $_POST['cardz3n_po_number'] ) ) { // phpcs:ignore WordPress.Security.NonceVerification.Missing
			$po = sanitize_text_field( wp_unslash( $_POST['cardz3n_po_number'] ) ); // phpcs:ignore WordPress.Security.NonceVerification.Missing
		}
		if ( ! empty( $po ) ) {
			$payload['ponumber'] = self::ascii( $po );
		}

		// Destination.
		$ship_country = ( '' !== $order->get_shipping_country() ) ? $order->get_shipping_country() : $order->get_billing_country();
		$ship_zip     = ( '' !== $order->get_shipping_postcode() ) ? $order->get_shipping_postcode() : $order->get_billing_postcode();
		if ( ! empty( $ship_country ) ) {
			$payload['shipping_country'] = self::ascii( $ship_country );
		}
		if ( ! empty( $ship_zip ) ) {
			$payload['shipping_postal'] = self::ascii( $ship_zip );
		}

		// Order date. NMI generally accepts orderdate_YYMMDD on certain processors; we expose
		// it as a merchant-defined field to avoid processor-specific rejection.
		$payload['merchant_defined_field_4'] = $order->get_date_created()
			? $order->get_date_created()->date( 'Y-m-d' )
			: gmdate( 'Y-m-d' );

		// Ship-from date (best effort: order meta or today).
		$ship_from_date = $order->get_meta( '_cardz3n_ship_from_date' );
		if ( ! empty( $ship_from_date ) ) {
			$payload['merchant_defined_field_5'] = self::ascii( $ship_from_date );
		}

		// Optional overall discount amount.
		$discount_total = (float) $order->get_discount_total();
		if ( $discount_total > 0 ) {
			$payload['discount_amount'] = number_format( $discount_total, 2, '.', '' );
		}
		// Customer code -- genuine WooCommerce customer identifier (logged-in orders only).
		$customer_id = (int) $order->get_customer_id();
		if ( $customer_id > 0 ) {
			$payload['customerid'] = (string) $customer_id;
		}
		// International Level 3 fields (summary commodity code, duty, VAT). WooCommerce
		// has no native concept of these; only sent when an order/plugin has recorded
		// them via order meta. Per spec: omitted, never fabricated, when absent.
		$summary_commodity = $order->get_meta( '_cardz3n_summary_commodity_code' );
		if ( ! empty( $summary_commodity ) ) {
			$payload['summary_commodity_code'] = self::ascii( $summary_commodity );
		}
		$duty_amount = $order->get_meta( '_cardz3n_duty_amount' );
		if ( '' !== $duty_amount && is_numeric( $duty_amount ) && (float) $duty_amount > 0 ) {
			$payload['duty_amount'] = number_format( (float) $duty_amount, 2, '.', '' );
		}
		$vat_tax_amount = $order->get_meta( '_cardz3n_vat_tax_amount' );
		if ( '' !== $vat_tax_amount && is_numeric( $vat_tax_amount ) && (float) $vat_tax_amount > 0 ) {
			$payload['vat_tax_amount'] = number_format( (float) $vat_tax_amount, 2, '.', '' );
		}
		$vat_tax_rate = $order->get_meta( '_cardz3n_vat_tax_rate' );
		if ( '' !== $vat_tax_rate && is_numeric( $vat_tax_rate ) ) {
			$payload['vat_tax_rate'] = number_format( (float) $vat_tax_rate, 2, '.', '' );
		}
		$vat_invoice_ref = $order->get_meta( '_cardz3n_vat_invoice_ref' );
		if ( ! empty( $vat_invoice_ref ) ) {
			$payload['vat_invoice_reference_number'] = self::ascii( $vat_invoice_ref );
		}

		// ------- Item-level fields -------.
		$default_uom        = trim( (string) ( $this->settings['default_uom'] ?? 'EA' ) );
		$commodity_source   = (string) ( $this->settings['commodity_source'] ?? 'category' ); // category | meta | none.
		$upc_meta_key       = trim( (string) ( $this->settings['upc_meta_key'] ?? '_cardz3n_upc' ) );
		$commodity_meta_key = trim( (string) ( $this->settings['commodity_meta_key'] ?? '_cardz3n_commodity_code' ) );

		$index = 1;
		foreach ( $order->get_items() as $item_id => $item ) {
			if ( ! $item instanceof \WC_Order_Item_Product ) {
				continue;
			}

			$product   = $item->get_product();
			$quantity  = (int) $item->get_quantity();
			$line_sub  = (float) $item->get_subtotal();
			$line_tot  = (float) $item->get_total();
			$line_tax  = (float) $item->get_total_tax();
			$unit_cost = $quantity > 0 ? round( $line_sub / $quantity, 2 ) : $line_sub;
			$discount  = max( 0, round( $line_sub - $line_tot, 2 ) );

			// Description: sanitized, truncated to 26 (NMI item_description limit is 35, but we stay safe for L3 Visa).
			$description = self::ascii( wp_strip_all_tags( $item->get_name() ) );
			if ( strlen( $description ) > 35 ) {
				$description = substr( $description, 0, 35 );
			}

			// Product code: SKU preferred, else product ID.
			$product_code = '';
			if ( $product ) {
				$product_code = (string) $product->get_sku();
				if ( '' === $product_code ) {
					$product_code = 'PID-' . (int) ( $item->get_product_id() );
				}
			}

			// UPC: product meta first, variation meta second.
			$upc = '';
			if ( $product ) {
				$upc = (string) $product->get_meta( $upc_meta_key );
			}

			// Commodity code.
			$commodity = '';
			if ( 'meta' === $commodity_source && $product ) {
				$commodity = (string) $product->get_meta( $commodity_meta_key );
			} elseif ( 'category' === $commodity_source && $product ) {
				$cats = wc_get_product_category_list( $product->get_id(), '|', '', '' );
				if ( ! empty( $cats ) ) {
					$parts     = array_map( 'trim', explode( '|', wp_strip_all_tags( $cats ) ) );
					$first     = isset( $parts[0] ) ? $parts[0] : '';
					$commodity = sanitize_title( $first );
					$commodity = substr( $commodity, 0, 12 );
				}
			}

			// UOM (per product) with default fallback.
			$uom = '';
			if ( $product ) {
				$uom = (string) $product->get_meta( '_cardz3n_uom' );
			}
			if ( '' === $uom ) {
				$uom = $default_uom;
			}

			$suffix = '_' . $index;

			$payload[ 'item_product_code' . $suffix ]    = self::ascii( $product_code );
			$payload[ 'item_description' . $suffix ]     = $description;
			$payload[ 'item_quantity' . $suffix ]        = (string) $quantity;
			$payload[ 'item_unit_of_measure' . $suffix ] = self::ascii( $uom );
			$payload[ 'item_unit_cost' . $suffix ]       = number_format( (float) $unit_cost, 2, '.', '' );
			$payload[ 'item_total_amount' . $suffix ]    = number_format( (float) $line_tot, 2, '.', '' );

			if ( $line_tax > 0 ) {
				$payload[ 'item_tax_amount' . $suffix ] = number_format( (float) $line_tax, 2, '.', '' );
			}
			if ( $discount > 0 ) {
				$payload[ 'item_discount_amount' . $suffix ] = number_format( (float) $discount, 2, '.', '' );
			}
			if ( '' !== $commodity ) {
				$payload[ 'item_commodity_code' . $suffix ] = self::ascii( $commodity );
			}
			if ( '' !== $upc ) {
				$payload[ 'item_product_code' . $suffix ] = self::ascii( $upc );
			}

			++$index;

			// NMI caps line items per transaction; 99 is a safe ceiling.
			if ( $index > 99 ) {
				break;
			}
		}

		/**
		 * Filter the final Level 3 payload before it ships with the transaction.
		 */
		return (array) apply_filters( 'cardz3n_gw_level3_payload', $payload, $order );
	}


		/**
		 * Strip anything outside printable ASCII to avoid Visa/MC L3 rejection on special chars.
		 *
		 * @param string $v Value to sanitize.
		 *
		 * @return string
		 */
	public static function ascii( $v ) {
		$v = (string) $v;
		$v = preg_replace( '/[^\x20-\x7E]/', '', $v );
		return trim( $v );
	}
}
