<?php
/**
 * Small shared helpers.
 *
 * @package Cardz3n_Gateway
 */

namespace Cardz3n_Gateway;

defined( 'ABSPATH' ) || exit;

/**
 * Normalize an NMI "ccexp" in MMYY or MM/YY form into 2-digit month + 4-digit year.
 *
 * @param string $ccexp Raw expiry string as returned by Collect.js.
 * @return array{month:string,year:string}
 */
function parse_ccexp( $ccexp ) {
	$digits = preg_replace( '/\D/', '', (string) $ccexp );
	if ( strlen( $digits ) === 4 ) {
		$month = substr( $digits, 0, 2 );
		$year  = '20' . substr( $digits, 2, 2 );
	} elseif ( strlen( $digits ) === 6 ) {
		$month = substr( $digits, 0, 2 );
		$year  = substr( $digits, 2, 4 );
	} else {
		$month = '01';
		$year  = (string) ( (int) gmdate( 'Y' ) + 1 );
	}
	return array(
		'month' => $month,
		'year'  => $year,
	);
}

/**
 * Map an NMI "cc_type" / "card_type" string into a Woo-friendly brand slug.
 *
 * @param string $input Raw brand/card-type string from NMI.
 * @return string
 */
function brand_slug( $input ) {
			$v    = strtolower( trim( (string) $input ) );
	$map = array(
		'visa'             => 'visa',
		'mastercard'       => 'mastercard',
		'master'           => 'mastercard',
		'mc'               => 'mastercard',
		'american express' => 'amex',
		'amex'             => 'amex',
		'discover'         => 'discover',
		'jcb'              => 'jcb',
		'diners'           => 'diners',
		'diners club'      => 'diners',
	);
	foreach ( $map as $needle => $slug ) {
		if ( false !== strpos( $v, $needle ) ) {
			return $slug;
		}
	}
	return 'credit';
}

/**
 * Compose the descriptor for a given order based on merchant rules.
 *
 * @param \WC_Order $order   The order being charged.
 * @param array     $settings Gateway settings array.
 * @return string
 */
function descriptor_for_order( \WC_Order $order, array $settings ) {
	$base = trim( (string) ( $settings['descriptor'] ?? '' ) );
	$src  = (string) ( $settings['descriptor_suffix_source'] ?? '' );

	if ( 'order_id' === $src ) {
		$suffix    = '*' . $order->get_id();
		$max_total = 25;
		$base      = substr( $base, 0, max( 0, $max_total - strlen( $suffix ) ) );
		return $base . $suffix;
	}
	return substr( $base, 0, 25 );
}
