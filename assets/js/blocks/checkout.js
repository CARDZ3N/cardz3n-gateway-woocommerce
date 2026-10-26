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
 *   - Scope of this release: CARD payments only. ACH, saved payment methods
 *     and Apple/Google Pay are NOT yet supported in the Blocks checkout path
 *     (saved methods need a saved-tokens list passed to the client; wallets
 *     need their own integration) -- deliberately not shown rather than shown
 *     non-functional. Enabling them in settings has no effect on this pane.
 */
( function ( wp, wc, settings ) {
	'use strict';

	if ( ! wp || ! wp.element || ! wc || ! wc.wcBlocksRegistry ) {
		// Blocks registry isn't available on this page — nothing to register.
		return;
	}

	var el                    = wp.element.createElement;
	var useEffect             = wp.element.useEffect;
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
				style: { height: 24, marginLeft: 8, verticalAlign: 'middle' }
			} );
		} );

		return el(
			'span',
			{ style: { display: 'inline-flex', alignItems: 'center', gap: 8 } },
			el( PaymentMethodLabel, { text: decodeEntities( cfg.title || 'CARDZ3N Gateway' ) } ),
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

	/**
	 * Short line shown only for subscription and pre-order carts: the card is saved for the later payments.
	 * ASSUMPTION: the Checkout block's cart store exposes the payment requirements as
	 * wp.data.select( 'wc/store/cart' ).getCartData().paymentRequirements (the list the Store API sends, which
	 * WooCommerce Subscriptions / Pre-Orders extend with 'subscriptions' / 'pre-orders'). If it is missing, nothing is shown;
	 * the card is still saved because the server forces it for those orders.
	 */
	function SavedNote() {
		var requirements = wp.data.useSelect( function ( select ) {
			try {
				var data = select( 'wc/store/cart' ).getCartData();
				return ( data && data.paymentRequirements ) || [];
			} catch ( e ) {
				return [];
			}
		}, [] );
		if ( requirements.indexOf( 'subscriptions' ) === -1 && requirements.indexOf( 'pre-orders' ) === -1 ) {
			return null;
		}
		return el(
			'p',
			{ className: 'cardz3n-block-card-saved', style: { margin: '12px 0 0' } },
			( cfg.i18n && cfg.i18n.cardSaved ) || 'Your card will be saved and used for the later payments of this order.'
		);
	}

	function Content( props ) {
		var eventRegistration = props && props.eventRegistration;
		var emitResponse      = props && props.emitResponse;

		// window.CARDZ3N_GW is already populated server-side by
		// Blocks_Support::get_payment_method_script_handles() via
		// wp_localize_script(), printed before this script tag executes
		// (same mechanism the classic checkout uses) -- so the shared
		// module's window.cardz3nGwMount/Unmount/StartTokenization bridge
		// functions are already defined by the time this effect runs.
		useEffect( function () {
			if ( typeof window.cardz3nGwMount === 'function' ) {
				window.cardz3nGwMount();
			}

			return function () {
				if ( typeof window.cardz3nGwUnmount === 'function' ) {
					window.cardz3nGwUnmount();
				}
			};
		}, [] );

		// Intercept the block checkout's payment setup step. Returns a
		// Promise -- Woo Blocks supports async onPaymentSetup observers.
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

					return {
						type: emitResponse.responseTypes.SUCCESS,
						meta: {
							paymentMethodData: {
								wc_payment_source      : 'blocks',
								cardz3n_payment_kind   : 'card',
								cardz3n_token_type     : 'card',
								cardz3n_payment_token  : response.token,
								cardz3n_card_brand     : ( response.card && response.card.type ) ? response.card.type : '',
								cardz3n_saved_token_id : ''
							}
						}
					};
				} );
			} );
			return unsubscribe;
		}, [ eventRegistration, emitResponse ] );

		return el(
			'div',
			{
				className: 'cardz3n-gateway-ui',
				'data-gateway': cfg.gatewayId,
				'data-block'  : '1'
			},
			el(
				'p',
				{ className: 'cardz3n-block-description', style: { margin: '0 0 12px' } },
				decodeEntities( cfg.description || '' )
			),
			// Card pane -- hosted-field containers Collect.js mounts iframes into.
			el(
				'div',
				{ className: 'cardz3n-pane cardz3n-pane-card is-active', 'data-pane': 'card' },
				el( 'div', { id: 'cardz3n-ccnumber', className: 'cardz3n-field' } ),
				el( 'div', { id: 'cardz3n-ccexp',    className: 'cardz3n-field' } ),
				el( 'div', { id: 'cardz3n-cvv',      className: 'cardz3n-field' } )
			),
			wp.data && wp.data.useSelect ? el( SavedNote, {} ) : null,
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
	 * payment method rather than show a selectable-but-unusable option when
	 * there is no configured tokenization key or Cards are turned off.
	 * Server-side process_payment()/is_available() still enforce this
	 * independently; this is purely a UX guard against an offer the gateway
	 * could never actually fulfill.
	 */
	function canMakePayment() {
		return !! ( cfg.tokenizationKey && cfg.enableCards );
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
			/*
			 * Both stay false on purpose. showSaveOption would show WooCommerce's "save payment information" checkbox, whose
			 * value is what asks a gateway to save the card on a normal order. Subscription and pre-order orders do not need
			 * it: the server always saves the card for them (Gateway::process_payment(), no checkbox). The 'tokenization'
			 * feature (advertised for recurring carts, see Recurring::block_checkout_features()) is only what lets the
			 * Checkout block offer the method for those carts; it adds no checkbox.
			 *
			 * Observed on WooCommerce 11.2.1: the Checkout block lists a signed-in customer's saved cards for this gateway even
			 * with showSavedCards false (tests/e2e/recurring-blocks.spec.mjs). Choosing one posts
			 * wc-<gateway>-payment-token and no new card; process_payment() already handles that (the card stays stored).
			 */
			showSavedCards      : false,
			showSaveOption      : false
		}
	} );
} )( window.wp, window.wc, window.wc_cardz3n_params || null );
