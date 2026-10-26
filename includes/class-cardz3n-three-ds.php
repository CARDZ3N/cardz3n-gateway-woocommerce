<?php
/**
 * 3-D Secure (payer authentication) helpers.
 *
 * NMI documents 3-D Secure as a separate script, Gateway.js, used together with Collect.js: after Collect.js returns a payment
 * token, the browser authenticates the card (a hidden device check, and only if the issuer asks, a challenge) and receives
 * authentication values, which are sent with the sale. Source: https://docs.nmi.com/docs/payer-authentication-3ds
 *
 * Everything that depends on how CARDZ3N's gateway answers is an ASSUMPTION, marked here and in the PR, and can be corrected with
 * a filter without changing the plugin:
 *
 * - T1: Gateway.js is served from the same gateway host as Collect.js, at /js/v1/Gateway.js (NMI's own sandbox URL is
 *   https://sandbox.nmi.com/js/v1/Gateway.js). Filter `cardz3n_gw_3ds_script_url`.
 * - T2: Gateway.js takes the same public key that Collect.js takes (NMI says "public API key with Checkout permissions"; it may
 *   be a different key on this gateway). Filter `cardz3n_gw_3ds_public_key`.
 * - T3: the sale accepts these fields, named as in NMI's table: cavv, xid, eci, cardholder_auth, three_ds_version,
 *   directory_server_id. Filter `cardz3n_gw_3ds_fields`.
 * - T4: renewals of a subscription are merchant-initiated and are sent without 3-D Secure, from the card stored by the first
 *   (authenticated) payment. NMI's page does not describe recurring billing; this is the usual card-network practice, not
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
	 * Is 3-D Secure switched on in the gateway settings?
	 *
	 * @param array $settings The gateway settings.
	 * @return bool
	 */
	public static function enabled( $settings ) {
		return is_array( $settings ) && isset( $settings['enable_3d_secure'] ) && 'yes' === $settings['enable_3d_secure'];
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
	 * @param array $settings    The gateway settings.
	 * @param string $source     Normalized payment source (card, ach, apple_pay, google_pay).
	 * @param bool   $using_saved True when the customer chose a saved card.
	 * @return bool
	 */
	public static function applies( $settings, $source, $using_saved ) {
		return self::enabled( $settings ) && 'card' === $source && ! $using_saved;
	}

	/**
	 * Read the authentication result the checkout page posted.
	 *
	 * The gateway checks the values; this only makes sure the page says it finished the authentication, and keeps values that
	 * look like authentication values (letters, digits and + / = . _ -, up to 100 characters).
	 *
	 * @return array<string,string>|null Gateway request fields, or null when the authentication was not completed.
	 */
	public static function fields_from_request() {
		// phpcs:disable WordPress.Security.NonceVerification.Missing -- WooCommerce verifies the checkout nonce before process_payment().
		$status = isset( $_POST['cardz3n_3ds_status'] ) ? sanitize_text_field( wp_unslash( $_POST['cardz3n_3ds_status'] ) ) : '';
		if ( 'complete' !== $status ) {
			return null;
		}
		$fields = array();
		foreach ( self::FIELD_MAP as $posted => $name ) {
			if ( empty( $_POST[ $posted ] ) ) {
				continue;
			}
			$value = sanitize_text_field( wp_unslash( $_POST[ $posted ] ) );
			if ( strlen( $value ) > 100 || ! preg_match( '/^[A-Za-z0-9+\/=._-]+$/', $value ) ) {
				continue;
			}
			$fields[ $name ] = $value;
		}
		// phpcs:enable WordPress.Security.NonceVerification.Missing
		/**
		 * Gateway request fields that carry the authentication result. ASSUMPTION T3.
		 *
		 * @param array<string,string> $fields Field name => value.
		 */
		return (array) apply_filters( 'cardz3n_gw_3ds_fields', $fields );
	}

	/**
	 * A short, plain note for the order. No card data; only what the issuer said about the authentication.
	 *
	 * @param array<string,string> $fields Fields from fields_from_request().
	 * @return string
	 */
	public static function order_note( array $fields ) {
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
