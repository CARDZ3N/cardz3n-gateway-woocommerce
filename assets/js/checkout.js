/**
 * CARDZ3N Gateway — embedded WooCommerce checkout script.
 *
 * Responsibilities:
 *   - Configure NMI Collect.js inline hosted fields for card and ACH
 *   - Render Apple Pay / Google Pay wallet buttons inside the single gateway UI
 *   - Intercept the WooCommerce checkout submit, request a payment_token from
 *     Collect.js, write it to a hidden field, and re-submit the native form
 *   - Switch between the Card, ACH, and Saved tabs without reloading
 *   - Enforce duplicate-submission prevention
 *
 * No inline JS. No synchronous AJAX. All behavior lives in this file.
 */
(function ($) {
	'use strict';

	if (typeof window.CARDZ3N_GW === 'undefined') {
		return;
	}

	var cfg = window.CARDZ3N_GW;
	var gatewayId = cfg.gatewayId;
	var configured = false;
	var submitting = false;
	var activePane = cfg.enableCards ? 'card' : (cfg.enableAch ? 'ach' : 'saved');
	var $body = $(document.body);

	/* ------------------------------------------------------------------
	 * Helpers
	 * --------------------------------------------------------------- */

	function $ui() {
		return $('.cardz3n-gateway-ui[data-gateway="' + gatewayId + '"]');
	}

	function showError(msg) {
		$ui().find('.cardz3n-errors').text(msg).show();
	}

	function clearError() {
		$ui().find('.cardz3n-errors').text('').hide();
	}

	function isOurGatewaySelected() {
		return $('input[name="payment_method"]:checked').val() === gatewayId;
	}

	function activeSource() {
		// Infer based on visible pane; overridden when wallet callback fires.
		return activePane === 'ach' ? 'ach' : 'card';
	}

	function setHidden(name, value) {
		var $field = $ui().find('input[name="' + name + '"]');
		if ($field.length) {
			$field.val(value);
		} else {
			$ui().prepend('<input type="hidden" name="' + name + '" value="' + (value || '') + '" />');
		}
	}

	/* ------------------------------------------------------------------
	 * Tab switching
	 * --------------------------------------------------------------- */

	function bindTabs() {
		$(document).on('click', '.cardz3n-tabs .cardz3n-tab', function (e) {
			e.preventDefault();
			var target = $(this).data('target');
			activePane = target;
			$(this).addClass('is-active').siblings().removeClass('is-active');
			$ui().find('.cardz3n-pane').removeClass('is-active');
			$ui().find('[data-pane="' + target + '"]').addClass('is-active');

			/*
			 * Reconcile saved-token selection with the active pane.
			 *
			 * - On the Saved pane: make sure SOME saved token radio is selected so
			 *   WooCommerce's $_POST['wc-<id>-payment-token'] is populated when the
			 *   form is submitted. If none is checked, auto-check the first one.
			 * - On the Card/ACH pane: clear any saved-token radio so that
			 *   process_payment() falls through to the Collect.js tokenized path
			 *   instead of trying to charge a saved vault that the buyer no longer
			 *   wants to use.
			 */
			var $tokenRadios = $('input[name="wc-' + gatewayId + '-payment-token"]');
			if (target === 'saved') {
				if ($tokenRadios.filter(':checked').length === 0) {
					// skip the "Use a new payment method" radio (value="new") which
					// our CSS hides but WooCommerce still renders.
					$tokenRadios.filter('[value!="new"]').first().prop('checked', true).trigger('change');
				}
				setHidden('cardz3n_payment_source', 'saved');
			} else {
				// Select "new" if it exists so WC doesn't auto-pick a saved token
				// we're not using.
				var $newRadio = $tokenRadios.filter('[value="new"]');
				if ($newRadio.length) {
					$newRadio.prop('checked', true).trigger('change');
				} else {
					$tokenRadios.prop('checked', false);
				}
				setHidden('cardz3n_payment_source', target === 'ach' ? 'ach' : 'card');
				// Clear any stale token so a retry re-tokenizes.
				setHidden('cardz3n_payment_token', '');
				setHidden('cardz3n_token_type', '');
			}
			clearError();
		});
	}

	/* ------------------------------------------------------------------
	 * Collect.js configuration
	 * --------------------------------------------------------------- */

	function configureCollect() {
		if (configured || typeof window.CollectJS === 'undefined') {
			return;
		}

		var fields = {};

		if (cfg.enableCards) {
			fields.ccnumber = {
				selector: '#cardz3n-ccnumber',
				title: cfg.i18n.cardNumber,
				placeholder: '•••• •••• •••• ••••'
			};
			fields.ccexp = {
				selector: '#cardz3n-ccexp',
				title: cfg.i18n.expiry,
				placeholder: 'MM / YY'
			};
			fields.cvv = {
				display: 'show',
				selector: '#cardz3n-cvv',
				title: cfg.i18n.cvv,
				placeholder: 'CVV'
			};
		}

		if (cfg.enableAch) {
			fields.checkname = { selector: '#cardz3n-checkname', title: cfg.i18n.accountName, placeholder: 'Name on account' };
			fields.checkaba = { selector: '#cardz3n-checkaba', title: cfg.i18n.routing, placeholder: 'Routing number' };
			fields.checkaccount = { selector: '#cardz3n-checkaccount', title: cfg.i18n.account, placeholder: 'Account number' };
		}

		var collectConfig = {
			variant: 'inline',
			googleFont: 'Inter:400,500',
			invalidCss: { color: '#d64545', 'border-color': '#d64545' },
			validCss: { color: '#111', 'border-color': '#00c48c' },
			placeholderCss: { color: '#8a8f99' },
			focusCss: { 'border-color': '#0a5cff' },
			customCss: {
				'font-family': 'Inter,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif',
				'font-size': '15px',
				'line-height': '1.4'
			},
			fields: fields,
			country: cfg.country || 'US',
			currency: cfg.currency || 'USD',
			price: String(getCartTotal()),
			callback: onTokenReceived,
			timeoutDuration: 12000,
			timeoutCallback: function () {
				submitting = false;
				showError(cfg.i18n.timeout);
				$body.trigger('updated_checkout');
			},
			validationCallback: function (field, status, message) {
				// Non-blocking; WooCommerce still re-validates server-side.
			},
			fieldsAvailableCallback: function () {
				clearError();
			}
		};

		/*
		 * Wallets: Collect.js tries to construct PaymentRequestAbstraction for
		 * every wallet in the config, even in browsers/devices that don't support
		 * them. That throws "Could not create PaymentRequestAbstraction" in the
		 * console on Chrome/Windows/Linux (no Apple Pay) and on browsers without
		 * Google Pay. The throw is non-fatal — Collect.js continues — but it's
		 * noise that looks like a real bug. We now only pass each wallet's config
		 * when the browser actually exposes the runtime API.
		 */
		var applePayAvailable  = !!(window.ApplePaySession && window.ApplePaySession.canMakePayments && window.ApplePaySession.canMakePayments());
		var googlePayAvailable = !!(window.google && window.google.payments && window.google.payments.api && window.google.payments.api.PaymentsClient);

		/*
		 * Collect.js is extremely strict about the shape of its `applePay` and
		 * `googlePay` config objects. Passing an unrecognized key (e.g. `type`,
		 * `style`, `contactFields`, `emailRequired`) causes configure() to
		 * throw:
		 *   "You provided too many fields. Unexpected fields for applePay"
		 * and that throw ALSO prevents the ccnumber/ccexp/cvv iframes from
		 * rendering. 1.0.15 pares these objects down to the minimal
		 * documented fields, and if configure() still throws we retry without
		 * the wallet configs so the card form at least works.
		 */
		if (cfg.enableApplePay && applePayAvailable) {
			collectConfig.applePay = {
				selector: '.cardz3n-applepay-button'
			};
		}
		if (cfg.enableGooglePay && googlePayAvailable) {
			collectConfig.googlePay = {
				selector: '.cardz3n-googlepay-button'
			};
		}

		function attemptConfigure(config, label) {
			try {
				window.CollectJS.configure(config);
				configured = true;
				return true;
			} catch (err) {
				if (window.console && console.warn) {
					console.warn('[CARDZ3N] CollectJS.configure failed (' + label + '):', err && err.message ? err.message : err);
				}
				return false;
			}
		}

		if (attemptConfigure(collectConfig, 'full')) {
			return;
		}

		// Retry without wallet configs - card iframes are more important than
		// Apple/Google Pay buttons, and we'd rather render the card form with
		// hidden wallets than lose tokenization entirely.
		var cardOnlyConfig = {};
		for (var k in collectConfig) {
			if (Object.prototype.hasOwnProperty.call(collectConfig, k) && k !== 'applePay' && k !== 'googlePay') {
				cardOnlyConfig[k] = collectConfig[k];
			}
		}
		if (attemptConfigure(cardOnlyConfig, 'card-only fallback')) {
			$ui().find('.cardz3n-wallets').hide();
			return;
		}

		showError(cfg.i18n.initError || 'Unable to initialize secure payment form.');
	}

	function resetCollect() {
		if (typeof window.CollectJS !== 'undefined' && window.CollectJS && typeof window.CollectJS.clearInputs === 'function') {
			try { window.CollectJS.clearInputs(); } catch (e) {}
		}
		configured = false;
	}

	function getCartTotal() {
		// Non-blocking heuristic; exact total is computed server-side.
		var $row = $('.order-total .amount, .cart_totals .order-total .amount').last();
		if ($row.length) {
			var raw = $row.text().replace(/[^0-9.,-]/g, '').replace(',', '.');
			var v = parseFloat(raw);
			if (!isNaN(v) && v > 0) { return v.toFixed(2); }
		}
		return '0.00';
	}

	/* ------------------------------------------------------------------
	 * Token callback
	 * --------------------------------------------------------------- */

	function onTokenReceived(response) {
		if (!response || !response.token) {
			submitting = false;
			showError(cfg.i18n.invalidFields);
			return;
		}

		/*
		 * Collect.js tokens are SINGLE-USE. Once transact.php has consumed one,
		 * re-submitting the same token yields "Payment Token does not exist"
		 * from the gateway (REFID:... in the response). To survive a failed
		 * submission the buyer retries, and we MUST re-tokenize before the
		 * second attempt. We log the first 8 chars of the token for support
		 * diagnostics without exposing the full value.
		 */
		if (window.console && console.debug) {
			console.debug('[CARDZ3N] Collect.js minted token', (response.token || '').substring(0, 8) + '…', 'type=' + (response.tokenType || activeSource()));
		}

		setHidden('cardz3n_payment_token', response.token);
		setHidden('cardz3n_token_type', response.tokenType || activeSource());
		setHidden('cardz3n_payment_source', response.tokenType || activeSource());

		// Make sure no saved-token radio is checked (the Collect.js token beats
		// the vault lookup in process_payment() only if the saved radio is not
		// selected).
		var $tokenRadios = $('input[name="wc-' + gatewayId + '-payment-token"]');
		var $newRadio = $tokenRadios.filter('[value="new"]');
		if ($newRadio.length) { $newRadio.prop('checked', true); }
		else { $tokenRadios.prop('checked', false); }

		// Now allow the native WooCommerce submit to proceed.
		submitting = false;
		var $form = $('form.checkout');
		// Trigger the real submission; WC's own handler will send to the server.
		$form.off('submit.cardz3n').addClass('cardz3n-tokenized').trigger('submit');
	}

	/* ------------------------------------------------------------------
	 * Server-error listener
	 *
	 * 1.0.17 — when WooCommerce returns a checkout error from the server, WC
	 * fires `checkout_error` on the document with the AJAX payload. If the
	 * gateway rejected our token, we need to CLEAR the hidden fields and
	 * re-tokenize on the next submit, otherwise the buyer will keep retrying
	 * with the same already-consumed token and keep getting the same
	 * "Payment Token does not exist" response.
	 * --------------------------------------------------------------- */

	function bindCheckoutErrorReset() {
		$(document).on('checkout_error', function () {
			setHidden('cardz3n_payment_token', '');
			setHidden('cardz3n_token_type', '');
			submitting = false;
			if (window.console && console.warn) {
				console.warn('[CARDZ3N] Checkout error — cleared cached tokenization. Next submit will re-tokenize.');
			}
		});
	}

	/* ------------------------------------------------------------------
	 * Checkout form interception
	 * --------------------------------------------------------------- */

	function bindCheckoutForm() {
		var $form = $('form.checkout');
		if (!$form.length) { return; }

		$form.on('submit.cardz3n', function (e) {
			if (!isOurGatewaySelected()) { return; }

			// If the buyer is paying with a saved method, no tokenization needed.
			var tokenChoice = $form.find('input[name="wc-' + gatewayId + '-payment-token"]:checked').val();
			if (tokenChoice && tokenChoice !== 'new') {
				setHidden('cardz3n_payment_source', 'saved');
				return; // let WC submit
			}

			// If this was already tokenized, let it through.
			if ($form.hasClass('cardz3n-tokenized')) {
				$form.removeClass('cardz3n-tokenized');
				return;
			}

			// Duplicate-submit guard.
			if (submitting) {
				e.preventDefault();
				return false;
			}

			// Request tokenization; Collect.js will call onTokenReceived.
			e.preventDefault();
			submitting = true;
			clearError();
			if (typeof window.CollectJS !== 'undefined' && typeof window.CollectJS.startPaymentRequest === 'function') {
				try {
					window.CollectJS.startPaymentRequest();
				} catch (err) {
					submitting = false;
					showError(cfg.i18n.invalidFields);
				}
			} else {
				submitting = false;
				showError(cfg.i18n.invalidFields);
			}
			return false;
		});
	}

	/* ------------------------------------------------------------------
	 * Lifecycle
	 * --------------------------------------------------------------- */

	$(document).ready(function () {
		bindTabs();
		bindCheckoutForm();
		bindCheckoutErrorReset();

		// (Re)configure Collect.js after WooCommerce re-renders the checkout.
		$body.on('updated_checkout', function () {
			if ($ui().length === 0) { return; }
			resetCollect();
			setTimeout(configureCollect, 50);
			bindCheckoutForm();
		});

		// First render.
		if ($ui().length) {
			setTimeout(configureCollect, 50);
		}
	});

})(jQuery);
