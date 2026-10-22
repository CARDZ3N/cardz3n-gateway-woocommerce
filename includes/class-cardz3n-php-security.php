<?php
/**
 * PHP runtime security check.
 *
 * The "PHP2Shell" vulnerabilities (CVE-2026-109618 and CVE-2026-109619) are
 * flaws in the PHP runtime itself, not in any plugin. A plugin cannot patch
 * them; the only fix is for the host to run a patched PHP release. What this
 * class does is tell the site owner when the PHP version WordPress is running
 * under is older than the first patched release of its branch, via a Site
 * Health test and a notice on the gateway settings screen.
 *
 * This is deliberately advisory, not a hard block: many hosts (Debian,
 * Ubuntu, RHEL, CloudLinux) backport security fixes without changing the
 * reported version number, so a version string alone cannot prove a server
 * is unpatched. Blocking activation would lock out correctly patched sites.
 *
 * @package Cardz3n_Gateway
 */

namespace Cardz3n_Gateway;

defined( 'ABSPATH' ) || exit;

/**
 * Evaluates the running PHP version against known patched releases.
 */
class Php_Security {

	/**
	 * Hook into Site Health and the admin notice area.
	 */
	public static function init() {
		add_filter( 'site_status_tests', array( __CLASS__, 'register_site_health_test' ) );
		add_action( 'admin_notices', array( __CLASS__, 'maybe_render_notice' ) );
	}

	/**
	 * First release of each PHP branch that fixes PHP2Shell.
	 *
	 * Filterable so the thresholds can be corrected or extended (for example
	 * when a new branch ships) without waiting for a plugin release.
	 *
	 * @return array<string,string> Map of "major.minor" branch => first patched version.
	 */
	public static function patched_releases() {
		$releases = array(
			'8.2' => '8.2.35',
			'8.3' => '8.3.36',
			'8.4' => '8.4.27',
			'8.5' => '8.5.12',
		);

		/**
		 * Filters the first patched PHP release per branch.
		 *
		 * @param array<string,string> $releases Map of "major.minor" => version.
		 */
		$filtered = apply_filters( 'cardz3n_gw_php_patched_releases', $releases );
		return is_array( $filtered ) ? $filtered : $releases;
	}

	/**
	 * Classify a PHP version string.
	 *
	 * Returns one of:
	 *  - 'patched'     at or above the first patched release for its branch.
	 *  - 'unpatched'   on a branch that has a fix, but below it.
	 *  - 'unsupported' on a branch older than the oldest one with a fix.
	 *  - 'unknown'     on a newer branch than this list knows about; treated as OK.
	 *
	 * @param string $version PHP version string. Defaults to the running version.
	 * @return array{status:string,branch:string,minimum:string,version:string}
	 */
	public static function evaluate( $version = PHP_VERSION ) {
		$version = (string) $version;
		$parts   = explode( '.', $version );
		$branch  = '';
		if ( isset( $parts[0], $parts[1] ) ) {
			$branch = (int) $parts[0] . '.' . (int) $parts[1];
		}

		$patched = self::patched_releases();
		if ( empty( $patched ) || '' === $branch ) {
			return array(
				'status'  => 'unknown',
				'branch'  => $branch,
				'minimum' => '',
				'version' => $version,
			);
		}

		uksort( $patched, 'version_compare' );
		$oldest_branch = (string) array_key_first( $patched );

		if ( version_compare( $branch, $oldest_branch, '<' ) ) {
			return array(
				'status'  => 'unsupported',
				'branch'  => $branch,
				'minimum' => (string) $patched[ $oldest_branch ],
				'version' => $version,
			);
		}

		if ( isset( $patched[ $branch ] ) ) {
			$minimum = (string) $patched[ $branch ];
			return array(
				'status'  => version_compare( $version, $minimum, '<' ) ? 'unpatched' : 'patched',
				'branch'  => $branch,
				'minimum' => $minimum,
				'version' => $version,
			);
		}

		return array(
			'status'  => 'unknown',
			'branch'  => $branch,
			'minimum' => '',
			'version' => $version,
		);
	}

	/**
	 * Whether the warning should be shown at all.
	 *
	 * Hosts that backport fixes can return false from this filter to silence
	 * the warning once they have confirmed the server is patched.
	 *
	 * @return bool
	 */
	protected static function enabled() {
		return (bool) apply_filters( 'cardz3n_gw_php_security_notice', true );
	}

	/**
	 * Human-readable list of fixed releases for messages.
	 *
	 * @return string
	 */
	protected static function fixed_releases_label() {
		$patched = self::patched_releases();
		uksort( $patched, 'version_compare' );
		return implode( ', ', array_values( array_map( 'strval', $patched ) ) );
	}

	/**
	 * Warning text for a non-patched result, or empty string when fine.
	 *
	 * @param array{status:string,branch:string,minimum:string,version:string} $result Result of evaluate().
	 * @return string
	 */
	protected static function warning_text( array $result ) {
		if ( 'unpatched' !== $result['status'] && 'unsupported' !== $result['status'] ) {
			return '';
		}

		$fixed = self::fixed_releases_label();

		if ( 'unsupported' === $result['status'] ) {
			return sprintf(
				/* translators: 1: running PHP version, 2: list of fixed PHP releases. */
				__( 'This site is running PHP %1$s, a branch that no longer receives security fixes. The PHP2Shell vulnerabilities (CVE-2026-109618 and CVE-2026-109619) allow unauthenticated remote code execution and PHP has published fixes only in %2$s or newer. Ask your host to move this site to a supported PHP version.', 'cardz3n-gateway' ),
				$result['version'],
				$fixed
			);
		}

		return sprintf(
			/* translators: 1: running PHP version, 2: first patched release for this branch, 3: list of fixed PHP releases. */
			__( 'This site is running PHP %1$s. The PHP2Shell vulnerabilities (CVE-2026-109618 and CVE-2026-109619) allow unauthenticated remote code execution and are fixed from PHP %2$s on this branch (fixed releases: %3$s). Ask your host to update PHP. If your host backports security fixes without changing the version number, ask them to confirm this server is patched.', 'cardz3n-gateway' ),
			$result['version'],
			$result['minimum'],
			$fixed
		);
	}

	/**
	 * Register the Site Health test.
	 *
	 * @param array $tests Existing Site Health tests.
	 * @return array
	 */
	public static function register_site_health_test( $tests ) {
		if ( self::enabled() ) {
			$tests['direct']['cardz3n_gw_php_security'] = array(
				'label' => __( 'PHP security patch level (CARDZ3N Gateway)', 'cardz3n-gateway' ),
				'test'  => array( __CLASS__, 'site_health_test' ),
			);
		}
		return $tests;
	}

	/**
	 * Site Health test callback.
	 *
	 * @return array
	 */
	public static function site_health_test() {
		$result  = self::evaluate();
		$warning = self::warning_text( $result );

		$response = array(
			'label'       => __( 'PHP is at or above its first patched release', 'cardz3n-gateway' ),
			'status'      => 'good',
			'badge'       => array(
				'label' => __( 'Security', 'cardz3n-gateway' ),
				'color' => 'blue',
			),
			'description' => '<p>' . esc_html(
				sprintf(
					/* translators: %s: running PHP version. */
					__( 'PHP %s is at or above the first release that fixes the PHP2Shell vulnerabilities (CVE-2026-109618 and CVE-2026-109619).', 'cardz3n-gateway' ),
					$result['version']
				)
			) . '</p>',
			'actions'     => '',
			'test'        => 'cardz3n_gw_php_security',
		);

		if ( '' !== $warning ) {
			$response['label']       = __( 'PHP is missing the PHP2Shell security fix', 'cardz3n-gateway' );
			$response['status']      = 'critical';
			$response['description'] = '<p>' . esc_html( $warning ) . '</p>';
		}

		return $response;
	}

	/**
	 * Show the warning on the CARDZ3N gateway settings screen only.
	 */
	public static function maybe_render_notice() {
		if ( ! self::enabled() || ! current_user_can( 'manage_woocommerce' ) ) {
			return;
		}
		// Only on the CARDZ3N gateway settings page, matching Admin::maybe_render_availability_notice().
		if ( empty( $_GET['section'] ) || Brand::id() !== $_GET['section'] ) { // phpcs:ignore WordPress.Security.NonceVerification.Recommended,WordPress.Security.ValidatedSanitizedInput.InputNotSanitized
			return;
		}

		$warning = self::warning_text( self::evaluate() );
		if ( '' === $warning ) {
			return;
		}

		printf(
			'<div class="notice notice-error"><p><strong>%1$s</strong> — %2$s</p></div>',
			esc_html__( 'CARDZ3N Gateway security notice', 'cardz3n-gateway' ),
			esc_html( $warning )
		);
	}
}
