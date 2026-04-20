<?php
/**
 * NMI / CARDZ3N API client.
 *
 * Centralises all server-to-server gateway communication. The NMI Transaction
 * API (transact.php) accepts x-www-form-urlencoded POSTs and returns a
 * &-delimited key=value response. This client handles:
 *
 *   - Security-key authenticated transactions (sale, auth, capture, void, refund, credit).
 *   - Customer Vault add/update/delete (card + ACH).
 *   - Level 2/3 enhanced data pass-through (fields merged into the transact.php payload).
 *   - Deterministic response parsing and error normalization.
 *
 * Credentials are stored in WooCommerce gateway settings and only used server-side.
 *
 * @package Cardz3n_Gateway
 */

namespace Cardz3n_Gateway;

defined( 'ABSPATH' ) || exit;

class Api_Client {

	/*
	 * CARDZ3N is a white-labeled NMI instance. All server-to-server traffic
	 * and the browser-side Collect.js script must be served from the CARDZ3N
	 * gateway host (z3n.transactiongateway.com), never from secure.nmi.com.
	 *
	 * The human merchant login (/merchants/login.php) is NOT an API endpoint
	 * and will always return HTML / HTTP 400 when POSTed to — we never call
	 * that path here.
	 *
	 * These constants can be overridden at runtime via the
	 * `cardz3n_gw_api_endpoint` and `cardz3n_gw_collectjs_url` filters for
	 * merchants who operate on a different white-label NMI host.
	 */
	const GATEWAY_HOST     = 'https://z3n.transactiongateway.com';
	const ENDPOINT_LIVE    = 'https://z3n.transactiongateway.com/api/transact.php';
	const ENDPOINT_SANDBOX = 'https://z3n.transactiongateway.com/api/transact.php';
	const COLLECTJS_URL    = 'https://z3n.transactiongateway.com/token/Collect.js';
	const QUERY_URL        = 'https://z3n.transactiongateway.com/api/query.php';
	const THREE_STEP_URL   = 'https://z3n.transactiongateway.com/api/v2/three-step';

	/** @var array */
	private $settings;

	/** @var bool */
	private $sandbox;

	public function __construct( array $settings = null ) {
		if ( null === $settings ) {
			$settings = get_option( 'woocommerce_' . Brand::id() . '_settings', array() );
		}
		$this->settings = $settings;
		/*
		 * 1.0.15 renamed 'sandbox_mode' to 'test_mode'. Both are read so the
		 * gateway keeps working if the migration hasn't run yet.
		 */
		$this->sandbox = ( isset( $settings['test_mode'] ) && 'yes' === $settings['test_mode'] )
			|| ( isset( $settings['sandbox_mode'] ) && 'yes' === $settings['sandbox_mode'] );
	}

	/* ---------------------------------------------------------------------
	 * Credentials
	 *
	 * 1.0.19 restored the four-field key UI: Test Mode and Live Mode use
	 * DIFFERENT key pairs (test_security_key / test_tokenization_key and
	 * live_security_key / live_tokenization_key). CARDZ3N issues separate
	 * Test and Live keys, and the 1.0.15-1.0.18 unified single-pair UI was
	 * wrong.
	 *
	 * Resolution order for each key:
	 *   1. The test_ or live_ field for the current mode (primary).
	 *   2. Legacy sandbox_ field when in test mode (pre-1.0.15 installs).
	 *   3. Unified security_key / tokenization_key (1.0.15-1.0.18 installs).
	 *   4. Opposite-mode field as a last-resort fallback so a misconfigured
	 *      site surfaces a gateway-side auth error rather than an empty-key
	 *      error.
	 * ------------------------------------------------------------------ */

	private function first_nonempty( array $keys ) {
		foreach ( $keys as $k ) {
			if ( null === $k ) {
				continue;
			}
			$v = isset( $this->settings[ $k ] ) ? trim( (string) $this->settings[ $k ] ) : '';
			if ( '' !== $v ) {
				return $v;
			}
		}
		return '';
	}

	/**
	 * Private security key used to sign server-side requests.
	 */
	public function security_key() {
		return $this->first_nonempty(
			array(
				$this->sandbox ? 'test_security_key' : 'live_security_key',
				$this->sandbox ? 'sandbox_security_key' : null,
				'security_key',
				$this->sandbox ? 'live_security_key' : 'test_security_key',
			)
		);
	}

	/**
	 * Public tokenization key used by Collect.js in the browser.
	 */
	public function tokenization_key() {
		return $this->first_nonempty(
			array(
				$this->sandbox ? 'test_tokenization_key' : 'live_tokenization_key',
				$this->sandbox ? 'sandbox_tokenization_key' : null,
				'tokenization_key',
				$this->sandbox ? 'live_tokenization_key' : 'test_tokenization_key',
			)
		);
	}

	public function is_sandbox() {
		return $this->sandbox;
	}

	public function endpoint() {
		$url = $this->sandbox ? self::ENDPOINT_SANDBOX : self::ENDPOINT_LIVE;
		/**
		 * Filter the Transaction API endpoint.
		 *
		 * @param string $url     Default endpoint (z3n.transactiongateway.com).
		 * @param bool   $sandbox Whether the gateway is in sandbox mode.
		 */
		return (string) apply_filters( 'cardz3n_gw_api_endpoint', $url, $this->sandbox );
	}

	/**
	 * URL of the Collect.js tokenization script.
	 * Filterable for merchants on a different white-label NMI host.
	 */
	public static function collectjs_url() {
		return (string) apply_filters( 'cardz3n_gw_collectjs_url', self::COLLECTJS_URL );
	}

	/**
	 * URL of the Query API endpoint.
	 * Filterable for merchants on a different white-label NMI host.
	 */
	public static function query_url() {
		return (string) apply_filters( 'cardz3n_gw_query_url', self::QUERY_URL );
	}

	/**
	 * URL of the 3-Step Redirect API root.
	 * Filterable for merchants on a different white-label NMI host.
	 */
	public static function three_step_url() {
		return (string) apply_filters( 'cardz3n_gw_three_step_url', self::THREE_STEP_URL );
	}

	public function has_credentials() {
		return '' !== $this->security_key() && '' !== $this->tokenization_key();
	}

	/* ---------------------------------------------------------------------
	 * Request plumbing
	 * ------------------------------------------------------------------ */

	/**
	 * Low-level POST. Merges security_key in and returns a parsed response array.
	 *
	 * @param array $payload
	 * @return array{success:bool,code:string,text:string,transaction_id:string,auth_code:string,avs:string,cvv:string,customer_vault_id:string,raw:array,error:string}
	 */
	public function post( array $payload ) {
		$payload['security_key'] = $this->security_key();

		// Defensive: never let a tokenization key leak into a server-side transact.php payload.
		unset( $payload['tokenization_key'], $payload['public_key'] );

		$loggable = Logger::redact( $payload );
		Logger::debug( 'NMI transact.php POST', $loggable );

		$response = wp_remote_post(
			$this->endpoint(),
			array(
				'timeout'     => 45,
				'redirection' => 0,
				'httpversion' => '1.1',
				'blocking'    => true,
				'headers'     => array(
					'Content-Type' => 'application/x-www-form-urlencoded',
					'User-Agent'   => 'CARDZ3N-WC/' . CARDZ3N_GW_VERSION . '; WP/' . get_bloginfo( 'version' ) . '; WC/' . ( defined( 'WC_VERSION' ) ? WC_VERSION : '' ),
				),
				'body'        => http_build_query( $payload, '', '&' ),
				'cookies'     => array(),
			)
		);

		if ( is_wp_error( $response ) ) {
			Logger::error( 'NMI transport error', array( 'error' => $response->get_error_message() ) );
			return $this->error_result( $response->get_error_message() );
		}

		$body   = wp_remote_retrieve_body( $response );
		$parsed = $this->parse_response( $body );

		Logger::debug( 'NMI transact.php response', Logger::redact( $parsed['raw'] ) );

		return $parsed;
	}

	/**
	 * Parse an NMI response body (key=value&key=value) into a normalized array.
	 *
	 * NMI response field reference:
	 *   response      = 1 (approved), 2 (declined), 3 (error)
	 *   responsetext  = human-readable result
	 *   transactionid = gateway transaction ID
	 *   authcode      = card authorization code
	 *   avsresponse, cvvresponse = AVS / CVV result codes
	 *   customer_vault_id = returned when customer_vault operations create/return a vault
	 *
	 * @param string $body
	 * @return array
	 */
	public function parse_response( $body ) {
		$raw = array();
		parse_str( (string) $body, $raw );

		$code = isset( $raw['response'] ) ? (string) $raw['response'] : '';

		return array(
			'success'           => ( '1' === $code ),
			'code'              => $code,
			'text'              => isset( $raw['responsetext'] ) ? (string) $raw['responsetext'] : '',
			'transaction_id'    => isset( $raw['transactionid'] ) ? (string) $raw['transactionid'] : '',
			'auth_code'         => isset( $raw['authcode'] ) ? (string) $raw['authcode'] : '',
			'avs'               => isset( $raw['avsresponse'] ) ? (string) $raw['avsresponse'] : '',
			'cvv'               => isset( $raw['cvvresponse'] ) ? (string) $raw['cvvresponse'] : '',
			'customer_vault_id' => isset( $raw['customer_vault_id'] ) ? (string) $raw['customer_vault_id'] : '',
			'raw'               => $raw,
			'error'             => '',
		);
	}

	private function error_result( $msg ) {
		return array(
			'success'           => false,
			'code'              => '3',
			'text'              => $msg,
			'transaction_id'    => '',
			'auth_code'         => '',
			'avs'               => '',
			'cvv'               => '',
			'customer_vault_id' => '',
			'raw'               => array(),
			'error'             => $msg,
		);
	}

	/* ---------------------------------------------------------------------
	 * Transaction verbs
	 * ------------------------------------------------------------------ */

	/**
	 * Run a sale or auth using any of: payment_token, customer_vault_id, raw card/check.
	 *
	 * @param array $args See keys below.
	 * @return array parsed response
	 */
	public function transaction( array $args ) {
		$defaults = array(
			'type'              => 'sale', // sale | auth | capture | void | refund | credit | validate
			'amount'            => null,
			'order_id'          => null,
			'payment_token'     => null,   // Collect.js token
			'customer_vault_id' => null,   // Reuse a stored vault
			'payment'           => 'creditcard', // creditcard | check
			'currency'          => 'USD',
			'descriptor'        => '',
			'billing'           => array(), // first_name,last_name,address1,city,state,zip,country,email,phone,company
			'shipping'          => array(),
			'order_description' => '',
			'level3'            => array(), // merged as-is
			'vault'             => '',      // add_customer | update_customer
			'transactionid'     => '',      // for void/refund/capture
			'currency_code'     => null,
			'extra'             => array(),
		);

		$args = array_merge( $defaults, $args );

		$payload = array(
			'type'    => sanitize_key( $args['type'] ),
			'payment' => sanitize_key( $args['payment'] ),
		);

		if ( null !== $args['amount'] ) {
			$payload['amount'] = number_format( (float) $args['amount'], 2, '.', '' );
		}

		if ( null !== $args['order_id'] ) {
			$payload['orderid'] = (string) $args['order_id'];
		}

		if ( ! empty( $args['order_description'] ) ) {
			$payload['orderdescription'] = wp_strip_all_tags( $args['order_description'] );
		}

		if ( ! empty( $args['currency'] ) ) {
			$payload['currency'] = sanitize_text_field( $args['currency'] );
		}

		if ( ! empty( $args['descriptor'] ) ) {
			$payload['descriptor'] = sanitize_text_field( $args['descriptor'] );
		}

		if ( ! empty( $args['payment_token'] ) ) {
			$payload['payment_token'] = sanitize_text_field( $args['payment_token'] );
		}

		if ( ! empty( $args['customer_vault_id'] ) ) {
			$payload['customer_vault_id'] = sanitize_text_field( $args['customer_vault_id'] );
		}

		if ( ! empty( $args['transactionid'] ) ) {
			$payload['transactionid'] = sanitize_text_field( $args['transactionid'] );
		}

		if ( ! empty( $args['vault'] ) ) {
			$payload['customer_vault'] = sanitize_key( $args['vault'] );
		}

		// Billing.
		foreach ( array( 'first_name', 'last_name', 'company', 'address1', 'address2', 'city', 'state', 'zip', 'country', 'phone', 'email' ) as $k ) {
			if ( ! empty( $args['billing'][ $k ] ) ) {
				$payload[ $k ] = sanitize_text_field( $args['billing'][ $k ] );
			}
		}

		// Shipping.
		$shipping_map = array(
			'first_name' => 'shipping_firstname',
			'last_name'  => 'shipping_lastname',
			'address1'   => 'shipping_address1',
			'address2'   => 'shipping_address2',
			'city'       => 'shipping_city',
			'state'      => 'shipping_state',
			'zip'        => 'shipping_zip',
			'country'    => 'shipping_country',
			'company'    => 'shipping_company',
			'email'      => 'shipping_email',
		);
		foreach ( $shipping_map as $src => $dest ) {
			if ( ! empty( $args['shipping'][ $src ] ) ) {
				$payload[ $dest ] = sanitize_text_field( $args['shipping'][ $src ] );
			}
		}

		// Level 2/3 fields merged directly.
		if ( is_array( $args['level3'] ) && ! empty( $args['level3'] ) ) {
			foreach ( $args['level3'] as $k => $v ) {
				if ( null === $v || '' === $v ) {
					continue;
				}
				$payload[ $k ] = is_scalar( $v ) ? (string) $v : '';
			}
		}

		// Caller-supplied extras (wallet source, dynamic suffix, etc).
		if ( is_array( $args['extra'] ) ) {
			foreach ( $args['extra'] as $k => $v ) {
				if ( null === $v || '' === $v ) {
					continue;
				}
				$payload[ $k ] = is_scalar( $v ) ? (string) $v : '';
			}
		}

		return $this->post( $payload );
	}

	/**
	 * Convenience wrappers.
	 */

	public function capture( $transaction_id, $amount = null ) {
		$args = array(
			'type'          => 'capture',
			'transactionid' => $transaction_id,
		);
		if ( null !== $amount ) {
			$args['amount'] = $amount;
		}
		return $this->transaction( $args );
	}

	public function void( $transaction_id ) {
		return $this->transaction(
			array(
				'type'          => 'void',
				'transactionid' => $transaction_id,
			)
		);
	}

	public function refund( $transaction_id, $amount = null ) {
		$args = array(
			'type'          => 'refund',
			'transactionid' => $transaction_id,
		);
		if ( null !== $amount ) {
			$args['amount'] = $amount;
		}
		return $this->transaction( $args );
	}

	/**
	 * Delete a Customer Vault entry.
	 */
	public function delete_vault( $vault_id ) {
		return $this->post(
			array(
				'customer_vault'    => 'delete_customer',
				'customer_vault_id' => sanitize_text_field( $vault_id ),
			)
		);
	}

	/**
	 * Validate credentials (cheap no-op "validate" request).
	 *
	 * NMI will respond with code=3 "Invalid security key" when the key is wrong,
	 * otherwise it will reject for a different reason (e.g., "Missing card data"),
	 * which we treat as proof the key is accepted.
	 */
	public function validate_credentials() {
		if ( ! $this->has_credentials() ) {
			return array(
				'ok'  => false,
				'msg' => __( 'Enter both a Security Key and a Public Tokenization Key.', 'cardz3n-gateway' ),
			);
		}

		$res = $this->post(
			array(
				'type' => 'validate',
			)
		);

		$text_lower = strtolower( $res['text'] );
		if ( false !== strpos( $text_lower, 'invalid security key' ) || false !== strpos( $text_lower, 'authentication failed' ) ) {
			return array(
				'ok'  => false,
				'msg' => $res['text'],
			);
		}

		return array(
			'ok'  => true,
			'msg' => __( 'Credentials accepted by the gateway.', 'cardz3n-gateway' ),
		);
	}
}
