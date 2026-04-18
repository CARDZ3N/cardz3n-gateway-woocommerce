<?php
/**
 * Logger wrapper around WooCommerce's logger.
 *
 * Never logs sensitive payment data. Only redacted metadata.
 *
 * @package Cardz3n_Gateway
 */

namespace Cardz3n_Gateway;

defined( 'ABSPATH' ) || exit;

class Logger {

	const SOURCE = 'cardz3n-gateway';

	/**
	 * @var \WC_Logger|null
	 */
	private static $wc_logger = null;

	/**
	 * Lazily fetch the WC logger.
	 */
	private static function wc() {
		if ( null === self::$wc_logger && function_exists( 'wc_get_logger' ) ) {
			self::$wc_logger = wc_get_logger();
		}
		return self::$wc_logger;
	}

	/**
	 * Write a debug-level entry. Only written when merchant's debug mode is on.
	 *
	 * @param string $message
	 * @param array  $context
	 */
	public static function debug( $message, array $context = array() ) {
		if ( ! self::debug_enabled() ) {
			return;
		}
		self::write( 'debug', $message, $context );
	}

	public static function info( $message, array $context = array() ) {
		self::write( 'info', $message, $context );
	}

	public static function warning( $message, array $context = array() ) {
		self::write( 'warning', $message, $context );
	}

	public static function error( $message, array $context = array() ) {
		self::write( 'error', $message, $context );
	}

	private static function write( $level, $message, array $context ) {
		$logger = self::wc();
		if ( ! $logger ) {
			return;
		}

		$redacted = self::redact( $context );
		$line     = $message;
		if ( ! empty( $redacted ) ) {
			$line .= ' | ' . wp_json_encode( $redacted );
		}

		$logger->log( $level, $line, array( 'source' => self::SOURCE ) );
	}

	/**
	 * Whether the gateway debug toggle is enabled.
	 */
	public static function debug_enabled() {
		$settings = get_option( 'woocommerce_' . Brand::id() . '_settings', array() );
		return isset( $settings['debug_mode'] ) && 'yes' === $settings['debug_mode'];
	}

	/**
	 * Redact any keys that look like sensitive payment data.
	 *
	 * @param array $context
	 * @return array
	 */
	public static function redact( array $context ) {
		$sensitive = array(
			'ccnumber',
			'cc_number',
			'card_number',
			'cvv',
			'cvv2',
			'checkaccount',
			'checkaba',
			'account_number',
			'routing_number',
			'security_key',
			'tokenization_key',
			'password',
			'merchant_password',
		);

		$walk = function ( &$value, $key ) use ( $sensitive, &$walk ) {
			if ( is_array( $value ) ) {
				array_walk( $value, $walk );
				return;
			}
			if ( in_array( strtolower( (string) $key ), $sensitive, true ) ) {
				$value = '***';
			}
		};

		array_walk( $context, $walk );
		return $context;
	}
}
