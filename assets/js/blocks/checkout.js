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
 *   - Keep the initial block content minimal. The heavy Collect.js-powered
 *     card/ACH/wallet panes are inserted into the same DOM node and rely on
 *     the existing assets/js/checkout.js module once it mounts.
 *   - Emit a `payment_token` (plus `payment_method_kind`: card|ach|saved|
 *     applepay|googlepay) with the checkout payload so server-side
 *     process_payment() can stay identical to the classic flow.
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
	 * We render an anchor div with the same data-attributes the classic
	 * checkout.js uses (`.cardz3n-gateway-ui[data-gateway=…]`) so the
	 * shared script can mount its tab UI, Collect.js hosted fields, and
	 * wallet buttons into the block without a separate UI implementation.
	 *
	 * On block checkout submit, we intercept via onPaymentSetup and push
	 * the tokenized payment_token + payment_method_kind into the order
	 * meta. Server-side process_payment() reads these and runs the sale.
	 * --------------------------------------------------------------- */

	function Content( props ) {
		var eventRegistration = props && props.eventRegistration;
		var emitResponse      = props && props.emitResponse;

		var mountRef = useRef( null );

		// Ensure the shared Collect.js-backed UI knows what to render.
		// We mirror the classic CARDZ3N_GW global because the existing
		// assets/js/checkout.js module consumes it at init time.
		useEffect( function () {
			if ( typeof window === 'undefined' ) {
				return;
			}
			window.CARDZ3N_GW = window.CARDZ3N_GW || {
				gatewayId       : cfg.gatewayId,
				tokenizationKey : cfg.tokenizationKey,
				enableCards     : !! cfg.enableCards,
				enableAch       : !! cfg.enableAch,
				enableApplePay  : !! cfg.enableApplePay,
				enableGooglePay : !! cfg.enableGooglePay,
				enableSaved     : !! cfg.enableSaved,
				allowedBrands   : cfg.allowedBrands || [],
				country         : cfg.country || 'US',
				currency        : cfg.currency || 'USD',
				i18n            : cfg.i18n || {},
				isBlocksCheckout: true
			};

			// If the classic bundle is already loaded on the page, nudge it to
			// (re-)mount into the block's UI node. The bundle exposes a global
			// `cardz3nGwMount` when running in block mode.
			if ( typeof window.cardz3nGwMount === 'function' && mountRef.current ) {
				window.cardz3nGwMount( mountRef.current );
			}
		}, [] );

		// Intercept the block checkout's payment setup step and return the
		// tokenized payment_token picked up from the shared DOM.
		useEffect( function () {
			if ( ! eventRegistration || ! eventRegistration.onPaymentSetup ) {
				return;
			}
			var unsubscribe = eventRegistration.onPaymentSetup( function () {
				var root = mountRef.current;
				if ( ! root ) {
					return {
						type: emitResponse.responseTypes.ERROR,
						message: ( cfg.i18n && cfg.i18n.invalidFields ) || 'Please complete payment details.'
					};
				}

				var tokenInput = root.querySelector( 'input[name="cardz3n_payment_token"]' );
				var kindInput  = root.querySelector( 'input[name="cardz3n_payment_kind"]' );
				var savedInput = root.querySelector( 'input[name="cardz3n_saved_token_id"]:checked' );
				var brandInput = root.querySelector( 'input[name="cardz3n_card_brand"]' );

				var token = tokenInput && tokenInput.value ? tokenInput.value : '';
				var kind  = kindInput && kindInput.value ? kindInput.value : 'card';
				var saved = savedInput && savedInput.value ? savedInput.value : '';
				var brand = brandInput && brandInput.value ? brandInput.value : '';

				if ( ! token && ! saved ) {
					return {
						type: emitResponse.responseTypes.ERROR,
						message: ( cfg.i18n && cfg.i18n.invalidFields ) || 'Please complete payment details.'
					};
				}

				return {
					type: emitResponse.responseTypes.SUCCESS,
					meta: {
						paymentMethodData: {
							cardz3n_payment_token    : token,
							cardz3n_payment_kind     : kind,
							cardz3n_saved_token_id   : saved,
							cardz3n_card_brand      : brand,
							wc_payment_source        : 'blocks'
						}
					}
				};
			} );
			return unsubscribe;
		}, [ eventRegistration, emitResponse ] );

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
			// Lightweight placeholder shell — the shared checkout.js fills
			// in tabs + Collect.js hosted fields when it mounts.
			el( 'div', { className: 'cardz3n-pane cardz3n-pane-card', 'data-pane': 'card' } ),
			el( 'div', { className: 'cardz3n-pane cardz3n-pane-ach',  'data-pane': 'ach', style: { display: 'none' } } ),
			el( 'div', { className: 'cardz3n-pane cardz3n-pane-saved','data-pane': 'saved', style: { display: 'none' } } ),
			el( 'div', { className: 'cardz3n-errors', style: { display: 'none' } } ),
			// Hidden fields populated by the tokenization flow.
			el( 'input', { type: 'hidden', name: 'cardz3n_payment_token', defaultValue: '' } ),
			el( 'input', { type: 'hidden', name: 'cardz3n_payment_kind',  defaultValue: 'card' } ),
			el( 'input', { type: 'hidden', name: 'cardz3n_card_brand',   defaultValue: '' } )
		);
	}

	function Description() {
		return el(
			'div',
			{ className: 'cardz3n-blocks-description' },
			decodeEntities( cfg.description || '' )
		);
	}

	registerPaymentMethod( {
		name: cfg.gatewayId,
		label: el( Label, {} ),
		ariaLabel: decodeEntities( cfg.title || 'CARDZ3N Gateway' ),
		content: el( Content, {} ),
		edit:    el( Description, {} ),
		canMakePayment: function () { return true; },
		paymentMethodId: cfg.gatewayId,
		supports: {
			features: cfg.supports || [ 'products' ],
			showSavedCards      : !! cfg.enableSaved,
			showSaveOption      : !! cfg.enableSaved
		}
	} );
} )( window.wp, window.wc, window.wc_cardz3n_params || null );
