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

/**
 * Wraps the WooCommerce logger for gateway-specific logging.
 */
class Logger {

	const SOURCE = 'cardz3n-gateway';

	/**
	 * Cached WooCommerce logger instance.
	 *
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
	 * @param string $message Log message.
	 * @param array  $context Additional context data.
	 */
	public static function debug( $message, array $context = array() ) {
		if ( ! self::debug_enabled() ) {
			return;
		}
		self::write( 'debug', $message, $context );
	}

	/**
	 * Write an info-level entry.
	 *
	 * @param string $message Log message.
	 * @param array  $context Additional context data.
	 */
	public static function info( $message, array $context = array() ) {
		self::write( 'info', $message, $context );
	}

	/**
	 * Write a warning-level entry.
	 *
	 * @param string $message Log message.
	 * @param array  $context Additional context data.
	 */
	public static function warning( $message, array $context = array() ) {
		self::write( 'warning', $message, $context );
	}

	/**
	 * Write an error-level entry.
	 *
	 * @param string $message Log message.
	 * @param array  $context Additional context data.
	 */
	public static function error( $message, array $context = array() ) {
		self::write( 'error', $message, $context );
	}

	/**
	 * Write the actual log entry via the WooCommerce logger.
	 *
	 * @param string $level   PSR log level.
	 * @param string $message Log message.
	 * @param array  $context Additional context data.
	 */
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
	 * @param array $context Context data to filter.
	 * @return array Context with sensitive values redacted.
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
			'live_security_key',
			'live_tokenization_key',
			'test_security_key',
			'test_tokenization_key',
			'sandbox_security_key',
			'sandbox_tokenization_key',
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
