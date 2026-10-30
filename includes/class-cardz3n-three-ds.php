<?php
/**
 * 3-D Secure (payer authentication) helpers.
 *
 * NMI documents 3-D Secure as a separate script, Gateway.js, used together with Collect.js: after Collect.js returns a payment
 * token, the browser authenticates the card (a hidden device check, and only if the issuer asks, a challenge) and receives
 * authentication values, which are sent with the sale. Source: https://docs.nmi.com/docs/payer-authentication-3ds
 *
 * CONFIRMED by NMI's AI assistant (ticket answer, 2026-10-26; the live behaviour of our TEST account is not yet checked):
 * - 3-D Secure needs Payer Authentication 2.0 switched on for the merchant account, an eCommerce-classified processor and
 *   enrollment data (website URL, acquiring bank, bank VISA and MasterCard BINs, requestor category code, name and ID). Collect.js
 *   works with 3-D Secure only together with Gateway.js.
 * - For the first-store transaction use challengeIndicator '04'. After authentication send cavv, xid, eci, cardholder_auth,
 *   three_ds_version and directory_server_id with the Payment API request (T3 is therefore confirmed), together with the
 *   first-store flags of the recurring fields. Cardholder first and last name are required for 3-D Secure 2.
 * - 3-D Secure can be tested in Test Mode when Payer Authentication 2.0 is active. NMI's "Testing" page lists the Test Mode cards
 *   (Visa 4000000000002701 successful frictionless, ...2925 failed, ...2719 attempted, ...2503 successful step up, ...2370 failed
 *   step up and others); the AI assistant says expiry 08/2030, CVV 999, challenge password 1234 (not on the page).
 *
 * NOT answered by NMI yet (ticket 1337309, human agent): the Gateway.js address on our host, the key type, fees, how a sale without
 * 3-D Secure data is handled, the block checkout, and (still open) 3-D Secure on a $0 verification. Everything that still depends on that is an ASSUMPTION, marked here and in the PR,
 * and can be corrected with a filter without changing the plugin:
 *
 * - T1: Gateway.js is served from the same gateway host as Collect.js, at /js/v1/Gateway.js (NMI's own sandbox URL is
 *   the same /js/v1/Gateway.js path). Checked with a real request on 2026-10-27: https://z3n.transactiongateway.com/js/v1/Gateway.js
 *   answers 200 with the script (it contains get3DSecure). The address NMI's support gave (/web/js/v1/gateway.js) answers 403 from the
 *   gateway's edge, with or without a browser user agent, and a lowercase /js/v1/gateway.js answers 404, so the default stays
 *   /js/v1/Gateway.js. Ask NMI which one is meant. Filter `cardz3n_gw_3ds_script_url`.
 * - T2: Gateway.js takes the same public key that Collect.js takes (NMI says "public API key with Checkout permissions"; it may
 *   be a different key on this gateway). Filter `cardz3n_gw_3ds_public_key`.
 * - T3 (CONFIRMED by NMI's AI assistant): the sale accepts these fields, named as in NMI's table: cavv, xid, eci,
 *   cardholder_auth, three_ds_version, directory_server_id. Filter `cardz3n_gw_3ds_fields`.
 * - T4: renewals of a subscription are merchant-initiated (confirmed by NMI: initiated_by=merchant) and are sent without 3-D Secure
 *   data, from the card stored by the first (authenticated) payment; whether issuers accept that is not confirmed. NMI's page does not describe recurring billing; this is the usual card-network practice, not
 *   something the docs confirm. Nothing is added to a renewal request.
 * - T5: a $0.00 card verification (free trial, pre-order saved card) is not authenticated: NMI's page says nothing about it.
 * - T6: the saved-card path, bank payments and wallet payments are not authenticated by this plugin (a wallet token carries its
 *   own cryptogram).
 *
 * @package Cardz3n_Gateway
 */

namespace Cardz3n_Gateway;

defined( 'ABSPATH' ) || exit;

/**
 * 3-D Secure settings, script address and request fields.
 */
class Three_DS {

	/**
	 * Path of Gateway.js on the gateway host. ASSUMPTION T1.
	 */
	const SCRIPT_PATH = '/js/v1/Gateway.js';

	/**
	 * The challengeIndicator for the first-store transaction (a subscription or a pre-order whose card is stored), as NMI says: '04'.
	 * Other payments send no indicator, so the default (no preference) applies.
	 */
	const CHALLENGE_FIRST_STORE = '04';

	/**
	 * The posted fields the checkout page sends after the browser finished the authentication, and the gateway request field
	 * each one becomes. ASSUMPTION T3 (names as in NMI's "Payer Authentication Variables" table).
	 *
	 * @var array<string,string>
	 */
	const FIELD_MAP = array(
		'cardz3n_3ds_cavv'                => 'cavv',
		'cardz3n_3ds_xid'                 => 'xid',
		'cardz3n_3ds_eci'                 => 'eci',
		'cardz3n_3ds_cardholder_auth'     => 'cardholder_auth',
		'cardz3n_3ds_version'             => 'three_ds_version',
		'cardz3n_3ds_directory_server_id' => 'directory_server_id',
	);

	/**
	 * The 3-D Secure mode in the gateway settings: 'off' (default), 'attempt' (try it; if it cannot run, take the payment without it
	 * and add an order note) or 'required' (if it cannot be completed for any reason, stop the payment with a plain message).
	 * A bank-reported authentication FAILURE stops the payment in both modes.
	 *
	 * The first build of this feature used a yes/no checkbox `enable_3d_secure`; a saved 'yes' counts as 'attempt'. The old dead
	 * `enable_3ds` checkbox is never read.
	 *
	 * @param array $settings The gateway settings.
	 * @return string off|attempt|required
	 */
	public static function mode( $settings ) {
		if ( ! is_array( $settings ) ) {
			return 'off';
		}
		if ( isset( $settings['three_d_secure_mode'] ) && in_array( $settings['three_d_secure_mode'], array( 'off', 'attempt', 'required' ), true ) ) {
			return $settings['three_d_secure_mode'];
		}
		return ( isset( $settings['enable_3d_secure'] ) && 'yes' === $settings['enable_3d_secure'] ) ? 'attempt' : 'off';
	}

	/**
	 * Is 3-D Secure switched on (attempt or required)?
	 *
	 * @param array $settings The gateway settings.
	 * @return bool
	 */
	public static function enabled( $settings ) {
		return 'off' !== self::mode( $settings );
	}

	/**
	 * Is 3-D Secure required (a payment that cannot be authenticated is stopped)?
	 *
	 * @param array $settings The gateway settings.
	 * @return bool
	 */
	public static function required( $settings ) {
		return 'required' === self::mode( $settings );
	}

	/**
	 * Address of Gateway.js. ASSUMPTION T1.
	 *
	 * @return string
	 */
	public static function script_url() {
		return (string) apply_filters( 'cardz3n_gw_3ds_script_url', Api_Client::GATEWAY_HOST . self::SCRIPT_PATH );
	}

	/**
	 * Public key Gateway.js is created with. ASSUMPTION T2: the same key Collect.js uses.
	 *
	 * @param string $tokenization_key The Collect.js public key in use.
	 * @return string
	 */
	public static function public_key( $tokenization_key ) {
		return (string) apply_filters( 'cardz3n_gw_3ds_public_key', (string) $tokenization_key );
	}

	/**
	 * Does 3-D Secure apply to this payment? Only a new card, on the sale or authorization path (see T4 to T6).
	 *
	 * @param array  $settings     The gateway settings.
	 * @param string $source       Normalized payment source (card, ach, apple_pay, google_pay).
	 * @param bool   $using_saved  True when the customer chose a saved card.
	 * @return bool
	 */
	public static function applies( $settings, $source, $using_saved ) {
		return self::enabled( $settings ) && 'card' === $source && ! $using_saved;
	}

	/**
	 * Does the cart being paid contain a subscription or a pre-order, i.e. is this the first-store transaction?
	 *
	 * ASSUMPTION T8: Subscriptions' `WC_Subscriptions_Cart::cart_contains_subscription()` and Pre-Orders'
	 * `WC_Pre_Orders_Cart::cart_contains_pre_order()` are the plugins' own cart checks. A wrong answer only changes the challenge
	 * indicator (no challenge preference instead of '04'); the sale flags are decided on the order, not here.
	 * Filter `cardz3n_gw_3ds_first_store_cart`.
	 *
	 * @return bool
	 */
	public static function first_store_cart() {
		$first = false;
		if ( class_exists( 'WC_Subscriptions_Cart' ) && method_exists( 'WC_Subscriptions_Cart', 'cart_contains_subscription' ) ) {
			$first = (bool) \WC_Subscriptions_Cart::cart_contains_subscription();
		}
		if ( ! $first && class_exists( 'WC_Pre_Orders_Cart' ) && method_exists( 'WC_Pre_Orders_Cart', 'cart_contains_pre_order' ) ) {
			$first = (bool) \WC_Pre_Orders_Cart::cart_contains_pre_order();
		}
		return (bool) apply_filters( 'cardz3n_gw_3ds_first_store_cart', $first );
	}

	/**
	 * ECI values that mean the card network accepts the authentication (Visa 05 and 06, Mastercard 02 and 01: authenticated or
	 * attempted). 07 and 00 mean "not authenticated" and are not accepted. ASSUMPTION T9 (card-network practice, not NMI's page).
	 */
	const ACCEPTABLE_ECI = array( '5', '6', '2', '1' );

	/**
	 * An ECI as a plain number string: the NMI sandbox returns '5', the demo account '05', so leading zeros are ignored. Anything that is
	 * not digits is returned unchanged (and is never acceptable).
	 *
	 * @param string $eci ECI as posted.
	 * @return string
	 */
	public static function eci_number( $eci ) {
		$eci = (string) $eci;
		return ctype_digit( $eci ) ? ( '' === ltrim( $eci, '0' ) ? '0' : ltrim( $eci, '0' ) ) : $eci;
	}

	/**
	 * Evaluate the authentication result the checkout page posted, on the SERVER. The gateway does not enforce 3-D Secure itself (it
	 * accepted sales without any 3-D Secure data on the NMI demo account), so this is the check that counts; the browser is only
	 * where the authentication happens.
	 *
	 * State:
	 * - 'none':   nothing was posted (the browser could not run 3-D Secure, or the request bypassed it).
	 * - 'failed': the browser or the values say the authentication FAILED (status failed, cardholder_auth failed or rejected).
	 * - 'invalid': 'complete' was posted but the values are missing, malformed (not letters, digits and + / = . _ -, up to 100 characters),
	 *              or not acceptable (no cavv, an ECI that is not an authenticated or attempted value, a result that is not verified or
	 *              attempted). Tampered data lands here.
	 * - 'ok':     a complete authentication with usable values; 'fields' carries them for the gateway request.
	 *
	 * What the server CANNOT do is verify the cryptogram (cavv): only the gateway and the card network can, and the gateway does not
	 * reject a bad one on the demo account. So 'ok' means "present, well formed and acceptable", not "proven genuine".
	 *
	 * @return array{state:string,fields:array<string,string>}
	 */
	public static function evaluate_request() {
		// phpcs:disable WordPress.Security.NonceVerification.Missing -- WooCommerce verifies the checkout nonce before process_payment().
		$status = isset( $_POST['cardz3n_3ds_status'] ) ? sanitize_text_field( wp_unslash( $_POST['cardz3n_3ds_status'] ) ) : '';
		if ( '' === $status ) {
			return array(
				'state'  => 'none',
				'fields' => array(),
			);
		}
		if ( 'failed' === $status ) {
			return array(
				'state'  => 'failed',
				'fields' => array(),
			);
		}
		if ( 'complete' !== $status ) {
			// For example 'unavailable' (the browser could not run it) or anything unknown: no usable authentication.
			return array(
				'state'  => 'none',
				'fields' => array(),
			);
		}
		$fields  = array();
		$dropped = false;
		foreach ( self::FIELD_MAP as $posted => $name ) {
			if ( empty( $_POST[ $posted ] ) ) {
				continue;
			}
			$value = sanitize_text_field( wp_unslash( $_POST[ $posted ] ) );
			if ( strlen( $value ) > 100 || ! preg_match( '/^[A-Za-z0-9+\/=._-]+$/', $value ) ) {
				$dropped = true;
				continue;
			}
			$fields[ $name ] = $value;
		}
		// phpcs:enable WordPress.Security.NonceVerification.Missing

		$result = isset( $fields['cardholder_auth'] ) ? strtolower( $fields['cardholder_auth'] ) : '';
		if ( in_array( $result, array( 'failed', 'rejected', 'unavailable', 'incomplete', 'cancelled', 'canceled' ), true ) ) {
			return array(
				'state'  => 'failed',
				'fields' => array(),
			);
		}

		/*
		 * Only a consistent result is accepted (ECI as a number, leading zeros ignored):
		 *   - ECI 5 or 2 (authenticated): the cryptogram (CAVV) is present and the result is "verified".
		 *   - ECI 6 or 1 (attempted): the cryptogram is present and the result is "attempted".
		 *   - ECI 7 or 0 (NOT ENROLLED, nothing to authenticate): the cryptogram is EMPTY and the result is "attempted" (the marker NMI's
		 *     testing page documents). Accepted in BOTH modes, with an order note that says there was no authentication result.
		 * Everything else is 'invalid': missing or blank fields, an empty result without the marker, a cryptogram with ECI 7, an ECI
		 * that contradicts the result (ECI 5 with "attempted", ECI 6 with "verified"), an ECI that is not a number, tampered values.
		 *
		 * REAL-SANDBOX FINDING (2026-10-29): NMI's sandbox "Not enrolled" cards complete with EVERY value empty, without the documented
		 * marker. That shape cannot be told apart from a request whose fields were stripped, so it is NOT accepted here: Required stops
		 * it, Attempt goes on without 3-D Secure and says so. Whether production returns the documented marker is not known.
		 * LIMIT: the server cannot tell a genuine marker from a forged one, so Required cannot stop a client that posts the marker
		 * deliberately (ASSUMPTION T11, to be stated to merchants).
		 */
		$eci_n      = isset( $fields['eci'] ) ? self::eci_number( $fields['eci'] ) : '';
		$has_cavv   = ! empty( $fields['cavv'] );
		$acceptable = false;
		if ( ! $dropped ) {
			if ( in_array( $eci_n, array( '7', '0' ), true ) ) {
				$acceptable = ! $has_cavv && 'attempted' === $result;
			} elseif ( in_array( $eci_n, array( '5', '2' ), true ) ) {
				$acceptable = $has_cavv && 'verified' === $result;
			} elseif ( in_array( $eci_n, array( '6', '1' ), true ) ) {
				$acceptable = $has_cavv && 'attempted' === $result;
			}
		}
		/**
		 * Gateway request fields that carry the authentication result. ASSUMPTION T3 (confirmed by NMI's AI assistant).
		 *
		 * @param array<string,string> $fields Field name => value.
		 */
		$fields = (array) apply_filters( 'cardz3n_gw_3ds_fields', $fields );
		return array(
			'state'  => $acceptable ? 'ok' : 'invalid',
			'fields' => $acceptable ? $fields : array(),
		);
	}

	/**
	 * Why 3-D Secure could not run, as reported by the checkout page. Plain text for logs, order notes and the settings screen.
	 *
	 * @var array<string,string>
	 */
	const REASONS = array(
		'script_unavailable' => 'Gateway.js could not be loaded from the gateway host',
		'gateway_error'      => 'the gateway reported an error starting 3-D Secure (Payer Authentication is probably not enabled on this gateway account)',
		'timeout'            => '3-D Secure did not answer within 20 seconds',
		'crash'              => '3-D Secure could not start in the browser',
		'name_missing'       => 'the cardholder\'s first and last name were missing',
	);

	/**
	 * The reason the checkout page posted for going on without 3-D Secure, or '' (only a known code is accepted).
	 *
	 * @return string
	 */
	public static function posted_reason() {
		// phpcs:ignore WordPress.Security.NonceVerification.Missing -- WooCommerce verifies the checkout nonce before process_payment().
		$code = isset( $_POST['cardz3n_3ds_reason'] ) ? sanitize_key( wp_unslash( $_POST['cardz3n_3ds_reason'] ) ) : '';
		return isset( self::REASONS[ $code ] ) ? $code : '';
	}

	/**
	 * Hooks for the checkout page's report of a stopped payment (Required mode: no order exists yet, so this is the only trace).
	 */
	public static function register_hooks() {
		add_action( 'wp_ajax_cardz3n_gw_3ds_report', array( __CLASS__, 'ajax_report' ) );
		add_action( 'wp_ajax_nopriv_cardz3n_gw_3ds_report', array( __CLASS__, 'ajax_report' ) );
	}

	/**
	 * Record that a card payment was stopped because 3-D Secure could not run (reason from a fixed list, no card data), in the log and
	 * in a short list the settings screen shows to the merchant.
	 */
	public static function ajax_report() {
		check_ajax_referer( 'cardz3n_gw_nonce', 'nonce' );
		$code = isset( $_POST['reason'] ) ? sanitize_key( wp_unslash( $_POST['reason'] ) ) : '';
		if ( ! isset( self::REASONS[ $code ] ) ) {
			wp_send_json_error( null, 400 );
		}
		$events   = self::recent_blocks();
		$events[] = array(
			'time'   => time(),
			'reason' => $code,
		);
		update_option( 'cardz3n_gw_3ds_blocked', array_slice( $events, -50 ), false );
		Logger::warning( '3-D Secure is required and could not run, so a card payment was stopped. Cause: ' . self::REASONS[ $code ] . '.' );
		wp_send_json_success();
	}

	/**
	 * Payments stopped because 3-D Secure could not run, in the last 7 days (newest last).
	 *
	 * @return array<int,array{time:int,reason:string}>
	 */
	public static function recent_blocks() {
		$events = get_option( 'cardz3n_gw_3ds_blocked', array() );
		$limit  = time() - 7 * DAY_IN_SECONDS;
		$out    = array();
		if ( is_array( $events ) ) {
			foreach ( $events as $e ) {
				if ( is_array( $e ) && isset( $e['time'], $e['reason'] ) && (int) $e['time'] >= $limit && isset( self::REASONS[ $e['reason'] ] ) ) {
					$out[] = array(
						'time'   => (int) $e['time'],
						'reason' => (string) $e['reason'],
					);
				}
			}
		}
		return $out;
	}

	/**
	 * A short, plain note for the order. No card data; only what the issuer said about the authentication.
	 *
	 * @param array<string,string> $fields Fields from evaluate_request().
	 * @return string
	 */
	public static function order_note( array $fields ) {
		if ( empty( $fields['cavv'] ) && in_array( isset( $fields['eci'] ) ? self::eci_number( $fields['eci'] ) : '', array( '', '7', '0' ), true ) ) {
			return sprintf(
				/* translators: %s: ECI value such as 07, or "none" */
				__( '3-D Secure: the card is not enrolled in 3-D Secure (ECI %s), so there was no authentication result; the payment was taken as a normal card payment.', 'cardz3n-gateway' ),
				! empty( $fields['eci'] ) ? $fields['eci'] : __( 'none', 'cardz3n-gateway' )
			);
		}
		$parts = array();
		if ( ! empty( $fields['eci'] ) ) {
			$parts[] = 'ECI ' . $fields['eci'];
		}
		if ( ! empty( $fields['cardholder_auth'] ) ) {
			$parts[] = $fields['cardholder_auth'];
		}
		if ( ! empty( $fields['three_ds_version'] ) ) {
			$parts[] = 'version ' . $fields['three_ds_version'];
		}
		return sprintf(
			/* translators: %s: short list such as "ECI 05, verified, version 2.2.0" */
			__( '3-D Secure: the card was authenticated before the payment (%s).', 'cardz3n-gateway' ),
			$parts ? implode( ', ', $parts ) : __( 'no details returned', 'cardz3n-gateway' )
		);
	}
}
