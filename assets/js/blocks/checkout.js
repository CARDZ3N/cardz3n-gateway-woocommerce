/**
 * CARDZ3N Gateway — Blocks Checkout registration.
 *
 * Registers the CARDZ3N payment method with the WooCommerce Cart & Checkout
 * Blocks so the gateway renders inside the block-based checkout UI.
 *
 * Runs in a standard WordPress script environment — no build step required.
 * Dependencies (wp-html-entities, wp-element, wc-blocks-registry, wc-settings)
 * are declared via checkout.asset.php so WP enqueues them in the right order.
 *
 * Design goals:
 *   - Reuse the classic checkout's server-provided settings
 *     (tokenizationKey, enableCards, enableAch, i18n, …).
 *   - Reuse the EXISTING assets/js/checkout.js module for tab switching and
 *     Collect.js hosted-field configuration, by rendering the same markup
 *     structure/classes/ids it already operates on (.cardz3n-gateway-ui,
 *     .cardz3n-tabs, .cardz3n-pane, #cardz3n-ccnumber, etc.) and calling its
 *     exposed bridge functions (window.cardz3nGwMount / Unmount /
 *     StartTokenization). This is real hosted-field UI, not a placeholder —
 *     see the long comment block on that file's "Blocks checkout bridge"
 *     section for how completion (no form.checkout to submit) differs from
 *     the classic flow.
 *   - Scope: Card, ACH, Apple Pay, and Google Pay are supported. Apple/
 *     Google Pay reuse the SAME CollectJS.configure() call as Card/ACH --
 *     Collect.js itself populates the wallet button DOM containers and
 *     routes the resulting token through the same shared callback, so no
 *     separate WooCommerce Blocks "express payment method" registration
 *     was needed (see the wallet-rendering comment in Content() below).
 *     Saved payment methods are NOT yet supported in the Blocks checkout
 *     path (get_payment_method_data() doesn't currently pass a
 *     saved-tokens list to the client) — deliberately hidden here rather
 *     than shown non-functional. Enabling "Saved" while
 *     enable_experimental_blocks_checkout is on has no effect on this pane.
 */
( function ( wp, wc, settings ) {
	'use strict';

	if ( ! wp || ! wp.element || ! wc || ! wc.wcBlocksRegistry ) {
		// Blocks registry isn't available on this page — nothing to register.
		return;
	}

	var el                    = wp.element.createElement;
	var useEffect             = wp.element.useEffect;
	var useRef                = wp.element.useRef;
	var useState              = wp.element.useState;
	var registerPaymentMethod = wc.wcBlocksRegistry.registerPaymentMethod;
	var getSetting            = ( wc.wcSettings && wc.wcSettings.getSetting ) || function () {};
	var decodeEntities        = ( wp.htmlEntities && wp.htmlEntities.decodeEntities ) || function ( s ) { return s; };

	// Server payload comes through under `<gatewayId>_data`.
	var cfg =
		( settings && settings.payment_method_data ) ||
		( typeof getSetting === 'function' ? getSetting( 'cardz3n_gateway_data', null ) : null ) ||
		( typeof getSetting === 'function' ? getSetting( 'aerospacepay_gateway_data', null ) : null );

	if ( ! cfg || ! cfg.gatewayId ) {
		return;
	}

	/* ------------------------------------------------------------------
	 * Label (with icons) + description
	 * --------------------------------------------------------------- */

	function Label( props ) {
		var PaymentMethodLabel =
			( props && props.PaymentMethodLabel ) ||
			function ( p ) { return el( 'span', null, p.text ); };

		var iconNodes = ( cfg.icons || [] ).map( function ( icon, i ) {
			return el( 'img', {
				key: 'cardz3n-icon-' + i,
				src: icon.src,
				alt: icon.alt,
				style: { height: 24, verticalAlign: 'middle' }
			} );
		} );

		var titleText = decodeEntities( cfg.title || 'CARDZ3N Gateway' );

		/*
		 * When the merchant has "Powered by CARDZ3N" branding enabled,
		 * render a real clickable link to cardz3n.com instead of the
		 * plain PaymentMethodLabel text node. Mirrors what
		 * Gateway::linkify_checkout_title() does on the classic checkout
		 * via the woocommerce_gateway_title filter -- that PHP filter has
		 * no effect here, since the Blocks checkout reads its title
		 * through this separate get_payment_method_data() JS payload, not
		 * through WooCommerce's title-rendering filter chain.
		 *
		 * stopPropagation() keeps the link's own click (and its default
		 * target="_blank" navigation) from also being intercepted by
		 * whatever parent click handler the payment-method list item uses
		 * to select this radio option.
		 */
		var labelNode = ( cfg.poweredByBranding && cfg.brandingUrl )
			? el(
				'a',
				{
					href: cfg.brandingUrl,
					target: '_blank',
					rel: 'noopener noreferrer',
					onClick: function ( e ) { e.stopPropagation(); },
					style: { color: cfg.brandingColor || '#0a5cff', textDecoration: 'underline' }
				},
				titleText
			)
			: el( PaymentMethodLabel, { text: titleText } );

		return el(
			'span',
			/*
			 * flexWrap:'wrap' + minWidth:0 let the brand-icon row wrap to a
			 * second line on narrow mobile viewports instead of overflowing
			 * past the payment-method box's right edge (reported: icons ran
			 * outside the box on mobile Safari). maxWidth:'100%' keeps the
			 * whole label+icons group from exceeding its parent's width in
			 * the first place.
			 */
			{ style: { display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, maxWidth: '100%', minWidth: 0 } },
			labelNode,
			iconNodes
		);
	}

	/* ------------------------------------------------------------------
	 * Content component — renders the embedded UI inside the block.
	 *
	 * On mount, renders the real tab + hosted-field markup and hands off to
	 * the shared assets/js/checkout.js module (window.cardz3nGwMount) for
	 * tab switching and Collect.js configuration — the exact same tested
	 * code path the classic checkout uses, operating on the same DOM
	 * structure/ids.
	 *
	 * On checkout submit, onPaymentSetup calls
	 * window.cardz3nGwStartTokenization(), which triggers Collect.js and
	 * returns a Promise resolving with the tokenized result. That result
	 * becomes this payment method's paymentMethodData, which WooCommerce
	 * copies onto $_POST for process_payment() (see the
	 * wc_payment_source === 'blocks' normalization in
	 * includes/class-cardz3n-gateway.php).
	 * --------------------------------------------------------------- */

	function Content( props ) {
		var eventRegistration = props && props.eventRegistration;
		var emitResponse      = props && props.emitResponse;

		var mountRef = useRef( null );
		var showAch  = !! cfg.enableAch;
		var showCard = !! cfg.enableCards;
		var initialPane = showCard ? 'card' : ( showAch ? 'ach' : 'card' );
		var paneState = useState( initialPane );
		var pane      = paneState[ 0 ];
		var setPane   = paneState[ 1 ];

		// window.CARDZ3N_GW is already populated server-side by
		// Blocks_Support::get_payment_method_script_handles() via
		// wp_localize_script(), printed before this script tag executes
		// (same mechanism the classic checkout uses) -- so the shared
		// module's window.cardz3nGwMount/Unmount/StartTokenization bridge
		// functions are already defined by the time this effect runs.
		useEffect( function () {
			if ( typeof window === 'undefined' ) {
				return;
			}

			if ( typeof window.cardz3nGwMount === 'function' ) {
				window.cardz3nGwMount();
			}

			return function () {
				if ( typeof window.cardz3nGwUnmount === 'function' ) {
					window.cardz3nGwUnmount();
				}
			};
			// Re-run if the buyer's cart makes a pane newly available/unavailable.
		}, [ showCard, showAch ] );

		// Intercept the block checkout's payment setup step. Returns a
		// Promise — Woo Blocks supports async onPaymentSetup observers.
		useEffect( function () {
			if ( ! eventRegistration || ! eventRegistration.onPaymentSetup ) {
				return;
			}
			var unsubscribe = eventRegistration.onPaymentSetup( function () {
				if ( typeof window.cardz3nGwStartTokenization !== 'function' ) {
					return {
						type: emitResponse.responseTypes.ERROR,
						message: ( cfg.i18n && cfg.i18n.initError ) || 'Unable to initialize secure payment form.'
					};
				}

				return window.cardz3nGwStartTokenization().then( function ( response ) {
					if ( ! response || ! response.token ) {
						return {
							type: emitResponse.responseTypes.ERROR,
							message: ( response && response.error ) || ( cfg.i18n && cfg.i18n.invalidFields ) || 'Please complete payment details.'
						};
					}

					var activePane = ( typeof window.cardz3nGwActivePane === 'function' ) ? window.cardz3nGwActivePane() : pane;
					/*
					 * 1.0.62 — response.tokenType is "inline" for a regular
					 * typed card/ACH submission (the integration style, not
					 * the payment method), but per NMI's own documented
					 * Collect.js response example it DOES report the wallet
					 * name ("applePay" / "googlePay") specifically for
					 * wallet-initiated payments. The 1.0.57 fix used
					 * activePane unconditionally to fix ACH-vs-card
					 * mislabeling, but that overcorrected: Apple Pay/Google
					 * Pay buttons render above the Card/ACH tabs and don't
					 * change which pane is active, so every wallet order
					 * got classified as whichever tab happened to be open
					 * too (Devin Review). Check for the wallet-specific
					 * tokenType first; only fall back to the pane for the
					 * one distinction tokenType can't make (card vs ach,
					 * both reported as "inline").
					 * Wallet_Service::normalize_source() (PHP) already does
					 * a case-insensitive substring match for "apple"/
					 * "google" anywhere in the token type string, so
					 * passing the raw wallet tokenType straight through is
					 * sufficient here.
					 */
					var ttLower = ( response.tokenType ? String( response.tokenType ).toLowerCase() : '' );
					var kind = ( ttLower.indexOf( 'apple' ) !== -1 || ttLower.indexOf( 'google' ) !== -1 )
						? response.tokenType
						: ( 'ach' === activePane ? 'ach' : 'card' );
					var cardBrand  = ( response.card && response.card.type ) ? response.card.type : '';

					return {
						type: emitResponse.responseTypes.SUCCESS,
						meta: {
							paymentMethodData: {
								wc_payment_source      : 'blocks',
								cardz3n_payment_kind    : kind,
								cardz3n_token_type      : kind,
								cardz3n_payment_token   : response.token,
								cardz3n_card_brand      : cardBrand,
								cardz3n_saved_token_id  : ''
							}
						}
					};
				} );
			} );
			return unsubscribe;
		}, [ eventRegistration, emitResponse, pane ] );

		function switchPane( target ) {
			setPane( target );
			if ( typeof window.cardz3nGwMount === 'function' ) {
				// Re-run tab-state reconciliation + re-mount Collect.js against
				// the newly visible pane, same as the classic tab click handler.
				window.CARDZ3N_GW_ACTIVE_PANE_HINT = target;
				window.cardz3nGwMount();
			}
		}

		var tabs = [];
		if ( showCard ) {
			tabs.push( el(
				'button',
				{
					key: 'tab-card',
					type: 'button',
					className: 'cardz3n-tab' + ( 'card' === pane ? ' is-active' : '' ),
					'data-target': 'card',
					onClick: function ( ev ) { ev.preventDefault(); switchPane( 'card' ); }
				},
				( cfg.i18n && cfg.i18n.cardTab ) || 'Card'
			) );
		}
		if ( showAch ) {
			tabs.push( el(
				'button',
				{
					key: 'tab-ach',
					type: 'button',
					className: 'cardz3n-tab' + ( 'ach' === pane ? ' is-active' : '' ),
					'data-target': 'ach',
					onClick: function ( ev ) { ev.preventDefault(); switchPane( 'ach' ); }
				},
				( cfg.i18n && cfg.i18n.achTab ) || 'Bank (ACH)'
			) );
		}

		var wallets = [];
		if ( cfg.enableApplePay ) {
			wallets.push( el( 'div', { key: 'wallet-apple', className: 'cardz3n-applepay-button', 'data-cardz3n-wallet': 'apple' } ) );
		}
		if ( cfg.enableGooglePay ) {
			wallets.push( el( 'div', { key: 'wallet-google', className: 'cardz3n-googlepay-button', 'data-cardz3n-wallet': 'google' } ) );
		}

		return el(
			'div',
			{
				ref: mountRef,
				className: 'cardz3n-gateway-ui',
				'data-gateway': cfg.gatewayId,
				'data-block'  : '1'
			},
			el(
				'p',
				{ className: 'cardz3n-block-description', style: { margin: '0 0 12px' } },
				decodeEntities( cfg.description || '' )
			),
			/*
			 * Apple Pay / Google Pay -- rendered as DOM containers Collect.js
			 * itself populates with the actual wallet button and click
			 * handling, exactly as on the classic checkout (see
			 * assets/js/checkout.js's configureCollect(): fields.applePay /
			 * fields.googlePay are feature-detected and passed straight into
			 * the SAME CollectJS.configure() call used for Card/ACH, so the
			 * resulting token flows through the SAME shared callback/
			 * cardz3nGwStartTokenization() bridge already wired up below --
			 * no separate WooCommerce Blocks "express payment method"
			 * registration needed). Wallets are feature-detected client-side
			 * (ApplePaySession.canMakePayments() / window.google.payments)
			 * inside configureCollect() itself, so an ineligible browser/
			 * device simply never gets the field passed to Collect.js at
			 * all -- these containers can render even when the wallet
			 * isn't actually eligible; they just stay empty (CSS hides an
			 * empty .cardz3n-wallets entirely, matching classic).
			 */
			wallets.length
				? el(
					'div',
					{ className: 'cardz3n-wallets' },
					wallets,
					el(
						'div',
						{ className: 'cardz3n-wallets-divider' },
						el( 'span', null, ( cfg.i18n && cfg.i18n.orPayWith ) || 'or pay with' )
					)
				)
				: null,
			tabs.length > 1
				? el( 'div', { className: 'cardz3n-tabs', role: 'tablist' }, tabs )
				: null,
			/*
			 * .cardz3n-panes establishes the SAME CSS Grid "stacked panes"
			 * trick classic checkout uses (checkout.css: display:grid;
			 * grid-template-areas:"stack"; each .cardz3n-pane placed in
			 * that one area) -- both Card and ACH panes occupy the SAME
			 * grid cell, with only the active one visible
			 * (opacity/visibility, not display:none) so switching tabs
			 * doesn't reflow/jump the layout.
			 *
			 * This wrapper was MISSING from the original Blocks markup --
			 * without it, Card and ACH were plain block-level siblings, so
			 * the inactive one (still visibility:hidden, which reserves
			 * layout space) rendered its own full height directly
			 * before/after the active one instead of overlapping it,
			 * producing a large blank gap on whichever pane was active.
			 *
			 * Separately, the display:'none' below is now keyed on
			 * whether THIS pane is the ACTIVE one ('card' === pane /
			 * 'ach' === pane) rather than whether that payment method is
			 * merely ENABLED (showCard/showAch) -- the previous condition
			 * meant BOTH panes stayed in normal flow (never display:none)
			 * whenever a merchant had both Card and ACH enabled, which is
			 * the common case and exactly what these screenshots were
			 * testing.
			 */
			el(
				'div',
				{ className: 'cardz3n-panes' },
				// Card pane — hosted-field containers Collect.js mounts iframes into.
				// Structure (label + .cardz3n-collect-field wrapper, .cardz3n-row
				// pairing for Expiry/CVV) matches the classic checkout's markup
				// exactly, since both share the same checkout.css rules and the
				// same shared checkout.js module operating on these same ids.
				el(
					'div',
					{ className: 'cardz3n-pane cardz3n-pane-card' + ( 'card' === pane ? ' is-active' : '' ), 'data-pane': 'card', style: 'card' === pane ? {} : { display: 'none' } },
					el(
						'div',
						{ className: 'cardz3n-field' },
						el( 'label', null, ( cfg.i18n && cfg.i18n.cardNumber ) || 'Card number' ),
						el( 'div', { id: 'cardz3n-ccnumber', className: 'cardz3n-collect-field' } )
					),
					el(
						'div',
						{ className: 'cardz3n-row' },
						el(
							'div',
							{ className: 'cardz3n-field' },
							el( 'label', null, ( cfg.i18n && cfg.i18n.expiry ) || 'MM / YY' ),
							el( 'div', { id: 'cardz3n-ccexp', className: 'cardz3n-collect-field' } )
						),
						el(
							'div',
							{ className: 'cardz3n-field' },
							el( 'label', null, ( cfg.i18n && cfg.i18n.cvv ) || 'CVV' ),
							el( 'div', { id: 'cardz3n-cvv', className: 'cardz3n-collect-field' } )
						)
					)
				),
				// ACH pane.
				el(
					'div',
					{ className: 'cardz3n-pane cardz3n-pane-ach' + ( 'ach' === pane ? ' is-active' : '' ), 'data-pane': 'ach', style: 'ach' === pane ? {} : { display: 'none' } },
					el(
						'div',
						{ className: 'cardz3n-field' },
						el( 'label', null, ( cfg.i18n && cfg.i18n.accountName ) || 'Name on account' ),
						el( 'div', { id: 'cardz3n-checkname', className: 'cardz3n-collect-field' } )
					),
					el(
						'div',
						{ className: 'cardz3n-row' },
						el(
							'div',
							{ className: 'cardz3n-field' },
							el( 'label', null, ( cfg.i18n && cfg.i18n.routing ) || 'Routing number' ),
							el( 'div', { id: 'cardz3n-checkaba', className: 'cardz3n-collect-field' } )
						),
						el(
							'div',
							{ className: 'cardz3n-field' },
							el( 'label', null, ( cfg.i18n && cfg.i18n.account ) || 'Account number' ),
							el( 'div', { id: 'cardz3n-checkaccount', className: 'cardz3n-collect-field' } )
						)
					)
				)
			),
			el( 'div', { className: 'cardz3n-errors', style: { display: 'none' } } )
		);
	}

	function Description() {
		return el(
			'div',
			{ className: 'cardz3n-blocks-description' },
			decodeEntities( cfg.description || '' )
		);
	}

	/**
	 * Mirror the server-side Blocks_Support::is_active() gate: hide the
	 * payment method rather than show a selectable-but-unusable option
	 * when there's no configured tokenization key or neither native rail
	 * (Cards / ACH — the only two this Blocks path currently supports) is
	 * enabled. Server-side process_payment()/is_available() still enforce
	 * this independently; this is purely a UX guard against an offer the
	 * gateway could never actually fulfill.
	 */
	function canMakePayment() {
		return !! ( cfg.tokenizationKey && ( cfg.enableCards || cfg.enableAch ) );
	}

	registerPaymentMethod( {
		name: cfg.gatewayId,
		label: el( Label, {} ),
		ariaLabel: decodeEntities( cfg.title || 'CARDZ3N Gateway' ),
		content: el( Content, {} ),
		edit:    el( Description, {} ),
		canMakePayment: canMakePayment,
		paymentMethodId: cfg.gatewayId,
		supports: {
			features: cfg.supports || [ 'products' ],
			showSavedCards      : false, // Not yet supported in the Blocks path — see file header.
			showSaveOption      : false  // Not yet supported in the Blocks path — see file header.
		}
	} );
} )( window.wp, window.wc, window.wc_cardz3n_params || null );
