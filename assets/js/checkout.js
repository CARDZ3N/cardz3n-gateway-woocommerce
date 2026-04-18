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
			setHidden('cardz3n_payment_source', target === 'ach' ? 'ach' : 'card');
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

		// Wallets: Collect.js auto-detects eligibility and inserts a button into the target element.
		if (cfg.enableApplePay) {
			collectConfig.applePay = {
				style: 'black',
				type: 'buy',
				selector: '.cardz3n-applepay-button',
				contactFields: ['email', 'phone']
			};
		}
		if (cfg.enableGooglePay) {
			collectConfig.googlePay = {
				buttonType: 'buy',
				buttonColor: 'default',
				selector: '.cardz3n-googlepay-button',
				emailRequired: true
			};
		}

		try {
			window.CollectJS.configure(collectConfig);
			configured = true;
		} catch (err) {
			showError('Unable to initialize secure payment form.');
		}
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

		setHidden('cardz3n_payment_token', response.token);
		setHidden('cardz3n_token_type', response.tokenType || activeSource());
		setHidden('cardz3n_payment_source', response.tokenType || activeSource());

		// Now allow the native WooCommerce submit to proceed.
		submitting = false;
		var $form = $('form.checkout');
		// Trigger the real submission; WC's own handler will send to the server.
		$form.off('submit.cardz3n').addClass('cardz3n-tokenized').trigger('submit');
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
