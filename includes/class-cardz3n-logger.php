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
	 * Fields of a gateway request that may be written to the debug log. Anything else
	 * (payment tokens, vault IDs, names, emails, phones, addresses, keys) is dropped.
	 *
	 * @return string[]
	 */
	public static function request_log_fields() {
		return array( 'type', 'amount', 'currency', 'orderid', 'payment', 'transactionid', 'merchant_defined_field_10' );
	}

	/**
	 * Fields of a gateway response that may be written to the debug log.
	 *
	 * @return string[]
	 */
	public static function response_log_fields() {
		return array( 'response', 'responsetext', 'response_code', 'transactionid', 'authcode', 'avsresponse', 'cvvresponse', 'type', 'orderid', 'amount' );
	}

	/**
	 * Keep only the allowed top-level, scalar fields of a request or response (a whitelist).
	 *
	 * @param array    $data    Request or response data.
	 * @param string[] $allowed Field names that may be logged.
	 * @return array Only the allowed scalar fields.
	 */
	public static function whitelist( array $data, array $allowed ) {
		$out = array();
		foreach ( $allowed as $field ) {
			if ( isset( $data[ $field ] ) && is_scalar( $data[ $field ] ) ) {
				$out[ $field ] = $data[ $field ];
			}
		}
		return $out;
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
			'payment_token',
			'token',
			'customer_vault_id',
			'vault_id',
		);

		// Customer details and anything vault- or token-shaped, whatever the exact key is called.
		$sensitive_pattern = '/(^|_)(token|vault_?id|e?mail|phone|first_?name|last_?name|full_?name|firstname|lastname|company|address(_?\d+)?|city|state|zip|post(al)?_?code|country)$|vault/';

		$walk = function ( &$value, $key ) use ( $sensitive, $sensitive_pattern, &$walk ) {
			if ( is_array( $value ) ) {
				array_walk( $value, $walk );
				return;
			}
			$lower = strtolower( (string) $key );
			if ( in_array( $lower, $sensitive, true ) || preg_match( $sensitive_pattern, $lower ) ) {
				$value = '***';
			}
		};

		array_walk( $context, $walk );
		return $context;
	}
}
