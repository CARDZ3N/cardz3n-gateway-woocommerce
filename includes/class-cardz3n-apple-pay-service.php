<?php
/**
 * Apple Pay preparation: the domain verification file and the admin guidance.
 *
 * Apple Pay on a store needs three things outside the plugin: the store on HTTPS, the store's domain registered for Apple Pay
 * on the gateway (done by CARDZ3N), and Apple's Domain Verification File reachable under `/.well-known/` on that domain
 * (docs.nmi.com/docs/digital-wallet-setup: download the file from the Merchant Portal's Apple Pay settings page, place it in
 * the `.well-known` directory of the web server, then add the domain to the allowed list). This class only does the plugin's
 * part: a merchant can paste the file's text into a setting and the plugin serves it, so no file access to the web server is needed.
 *
 * ASSUMPTION AP1: the file's path and name are Apple's standard ones, `/.well-known/apple-developer-merchantid-domain-association`
 * (NMI's page says to put the file in the `.well-known` directory; the exact file name is Apple's). Filter
 * `cardz3n_gw_apple_pay_verification_path` can change the path if the gateway says otherwise.
 *
 * @package Cardz3n_Gateway
 */

namespace Cardz3n_Gateway;

defined( 'ABSPATH' ) || exit;

/**
 * Serves the Apple Pay domain verification file from a setting, and builds the guidance shown next to the wallet settings.
 */
class Apple_Pay_Service {

	/** Settings key (inside the gateway settings) that holds the pasted file text. */
	const OPTION_KEY = 'apple_pay_verification_file';

	/** Longest file text accepted, in bytes. Apple's file is a few kilobytes of hex. */
	const MAX_BYTES = 65536;

	/**
	 * Hook the early request handler.
	 */
	public static function init() {
		add_action( 'init', array( __CLASS__, 'maybe_serve' ), 1 );
	}

	/**
	 * The path the file is served at (a path on the store's domain, never a full URL).
	 *
	 * @return string
	 */
	public static function path() {
		$path = (string) apply_filters( 'cardz3n_gw_apple_pay_verification_path', '/.well-known/apple-developer-merchantid-domain-association' );
		return '/' . ltrim( $path, '/' );
	}

	/**
	 * Full address of the file on this store (the root of the domain, which is where Apple looks).
	 *
	 * @return string
	 */
	public static function url() {
		$parts = wp_parse_url( home_url( '/' ) );
		if ( empty( $parts['scheme'] ) || empty( $parts['host'] ) ) {
			return '';
		}
		return $parts['scheme'] . '://' . $parts['host'] . ( ! empty( $parts['port'] ) ? ':' . $parts['port'] : '' ) . self::path();
	}

	/**
	 * Is the store address HTTPS?
	 *
	 * @return bool
	 */
	public static function is_https() {
		return 'https' === wp_parse_url( home_url( '/' ), PHP_URL_SCHEME );
	}

	/**
	 * The pasted file text, from the stored gateway settings ('' when none).
	 *
	 * @return string
	 */
	public static function stored_file() {
		$settings = get_option( cardz3n_gw_settings_option_key(), array() );
		$value    = is_array( $settings ) && isset( $settings[ self::OPTION_KEY ] ) ? $settings[ self::OPTION_KEY ] : '';
		return is_string( $value ) ? $value : '';
	}

	/**
	 * Clean the text pasted into the setting. Only printable ASCII, tabs and line breaks are kept (Apple's file is plain hex).
	 *
	 * @param string $value Raw posted text.
	 * @return string
	 * @throws \Exception When the text is longer than MAX_BYTES (WooCommerce shows the message and keeps the old value).
	 */
	public static function sanitize_file_text( $value ) {
		// A browser sends every line break of a text box as CR LF; keep plain LF so the served file is the text that was pasted.
		$value = str_replace( array( "\r\n", "\r" ), "\n", trim( (string) $value ) );
		$value = preg_replace( '/[^\x20-\x7E\r\n\t]/', '', $value );
		if ( strlen( $value ) > self::MAX_BYTES ) {
			throw new \Exception( esc_html__( 'The Apple Pay verification file is too long (65,536 characters at most). Paste only the contents of the file you downloaded.', 'cardz3n-gateway' ) );
		}
		return $value;
	}

	/**
	 * Answer a request for exactly the verification file path with the stored text, before WordPress does anything else.
	 * Only that exact path, only GET and HEAD, nothing else is echoed, and nothing is done when a real file already exists
	 * there (the web server normally serves that itself before PHP runs).
	 */
	public static function maybe_serve() {
		$method = isset( $_SERVER['REQUEST_METHOD'] ) ? strtoupper( sanitize_text_field( wp_unslash( $_SERVER['REQUEST_METHOD'] ) ) ) : '';
		if ( 'GET' !== $method && 'HEAD' !== $method ) {
			return;
		}
		$uri = isset( $_SERVER['REQUEST_URI'] ) ? (string) wp_unslash( $_SERVER['REQUEST_URI'] ) : ''; // phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized -- only parsed and compared to a fixed path.
		if ( '' === $uri || false === strpos( $uri, '.well-known' ) ) {
			return;
		}
		$request_path = wp_parse_url( $uri, PHP_URL_PATH );
		if ( self::path() !== $request_path ) {
			return;
		}
		$content = self::stored_file();
		if ( '' === $content ) {
			return;
		}
		if ( file_exists( rtrim( ABSPATH, '/\\' ) . self::path() ) ) {
			return;
		}
		status_header( 200 );
		header( 'Content-Type: text/plain; charset=utf-8' );
		header( 'X-Content-Type-Options: nosniff' );
		header( 'Cache-Control: no-cache' );
		header( 'Content-Length: ' . strlen( $content ) );
		if ( 'HEAD' !== $method ) {
			echo $content; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- plain text file, administrator-supplied, sent as text/plain with nosniff.
		}
		exit;
	}

	/**
	 * The guidance shown under the Apple Pay and Google Pay checkboxes (HTML allowed by wp_kses_post).
	 *
	 * @return string
	 */
	public static function guide_html() {
		$https = self::is_https();
		$have  = '' !== self::stored_file();
		$url   = self::url();

		$html  = '<strong>' . esc_html__( 'Apple Pay and Google Pay are optional and have not yet been verified on real devices.', 'cardz3n-gateway' ) . '</strong> ';
		$html .= esc_html__( 'Apple Pay only appears for a shopper on an iPhone, iPad or Mac using Safari with a card in Apple Wallet. You set it up yourself in the gateway control panel, in these steps:', 'cardz3n-gateway' );
		$html .= '<ol style="margin:8px 0 8px 20px;list-style:decimal;">';
		$html .= '<li>' . esc_html__( 'The store address must start with https://.', 'cardz3n-gateway' ) . '</li>';
		$html .= '<li>' . esc_html__( 'In the gateway control panel, go to Options, then Settings, then Apple Pay, and download the Domain Verification File.', 'cardz3n-gateway' ) . '</li>';
		$html .= '<li>' . esc_html__( 'Put that file in your site\'s .well-known directory. Easiest here: open it in a text editor, paste its whole text into the box below and save, and this plugin serves it at the address shown below. (Uploading the file to the .well-known directory yourself works too; a real file there is used instead.)', 'cardz3n-gateway' ) . '</li>';
		$html .= '<li>' . esc_html__( 'On the same Apple Pay page in the gateway control panel, add this store\'s domain to your Allowed Domains.', 'cardz3n-gateway' ) . '</li>';
		$html .= '<li>' . esc_html__( 'Open the file address shown below in a browser (it must show the text, not an error), then test with Test Mode on, on an iPhone in Safari. A Test Mode approval does not prove that your live processor supports Apple Pay.', 'cardz3n-gateway' ) . '</li>';
		$html .= '</ol>';
		$html .= '<span class="cardz3n-apple-status">';
		$html .= '<strong>' . esc_html__( 'Store address is HTTPS:', 'cardz3n-gateway' ) . '</strong> ' . ( $https ? esc_html__( 'yes', 'cardz3n-gateway' ) : esc_html__( 'no (Apple Pay will not work until it is)', 'cardz3n-gateway' ) ) . '<br />';
		$html .= '<strong>' . esc_html__( 'Verification file:', 'cardz3n-gateway' ) . '</strong> ';
		if ( $have ) {
			/* translators: %s: address of the verification file */
			$html .= sprintf( esc_html__( 'served at %s', 'cardz3n-gateway' ), '<code>' . esc_html( $url ) . '</code>' ) . ' <a href="' . esc_url( $url ) . '" target="_blank" rel="noopener noreferrer">' . esc_html__( 'Open the file address', 'cardz3n-gateway' ) . '</a>';
		} else {
			$html .= esc_html__( 'not set', 'cardz3n-gateway' );
		}
		$html .= '</span>';
		return $html;
	}
}
