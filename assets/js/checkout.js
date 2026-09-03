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
	var collectInitErrored = false;

	/*
	 * 1.0.24 — catch Collect.js init errors (e.g. "Invalid tokenization key format")
	 * which otherwise throw asynchronously during Config.js evaluation and leave
	 * the hosted-field iframes silently unresponsive. When we detect this, surface
	 * a clear, actionable error in the checkout notices area.
	 */
	window.addEventListener('error', function (ev) {
		var msg = ev && ev.message ? String(ev.message) : '';
		var src = ev && ev.filename ? String(ev.filename) : '';
		var isCollect = /Collect\.js|Config\.js|transactiongateway\.com/i.test(src) || /tokenization key/i.test(msg);
		if (!isCollect) { return; }
		collectInitErrored = true;
		var notice;
		if (/Invalid tokenization key format/i.test(msg)) {
			notice = 'The Public Key configured for this site is not a valid Collect Checkout key. The store owner must open the CARDZ3N Merchant Portal → Settings → Security Keys → Public Security Keys and use a key scoped to "Collect Checkout" (not "Tokenization").';
		} else if (/tokenization key must be provided/i.test(msg)) {
			notice = 'The Public Key is missing from the CARDZ3N Gateway settings. The store owner must enter a Collect Checkout key.';
		} else {
			notice = 'Secure payment form failed to initialize: ' + msg;
		}
		try { showError(notice); } catch (e) {}
		if (window.console && console.error) {
			console.error('[CARDZ3N] Collect.js init error:', msg, 'at', src);
		}
	}, true);

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

	/**
	 * 1.0.22 — apply the active-pane invariant to the DOM.
	 *
	 * This centralizes the state-reconciliation work that used to live only in
	 * the click handler so the same logic can run after WooCommerce re-renders
	 * the checkout (updated_checkout), which otherwise reverts panes to their
	 * PHP-rendered initial state — re-locking the inactive panes with `inert`
	 * and silently blocking buyer input. That was the 1.0.21 "ACH Name field
	 * becomes unresponsive after a failed submit" symptom: WC re-rendered the
	 * checkout, the ACH pane had `inert` again from PHP, and keystrokes went
	 * nowhere even though the buyer was still conceptually on the ACH tab.
	 */
	function applyActivePane(target) {
		var $root = $ui();
		if (!$root.length) { return; }
		activePane = target;
		$root.find('.cardz3n-tabs .cardz3n-tab').each(function () {
			$(this).toggleClass('is-active', $(this).data('target') === target);
		});
		$root.find('.cardz3n-pane').each(function () {
			var isTarget = $(this).attr('data-pane') === target;
			$(this).toggleClass('is-active', isTarget);
			if (isTarget) {
				this.removeAttribute('inert');
				this.removeAttribute('aria-hidden');
			} else {
				this.setAttribute('inert', '');
				this.setAttribute('aria-hidden', 'true');
			}
		});

		// Reconcile saved-token radio state with the active pane.
		var $tokenRadios = $('input[name="wc-' + gatewayId + '-payment-token"]');
		if (target === 'saved') {
			if ($tokenRadios.filter(':checked').length === 0) {
				$tokenRadios.filter('[value!="new"]').first().prop('checked', true).trigger('change');
			}
			setHidden('cardz3n_payment_source', 'saved');
		} else {
			var $newRadio = $tokenRadios.filter('[value="new"]');
			if ($newRadio.length) {
				$newRadio.prop('checked', true);
			} else {
				$tokenRadios.prop('checked', false);
			}
			setHidden('cardz3n_payment_source', target === 'ach' ? 'ach' : 'card');
		}
	}

	function bindTabs() {
		$(document).on('click', '.cardz3n-tabs .cardz3n-tab', function (e) {
			e.preventDefault();
			var target = $(this).data('target');
			var previousPane = activePane;
			activePane = target;
			$(this).addClass('is-active').siblings().removeClass('is-active');
			/*
			 * 1.0.21 — `inert` on inactive panes.
			 *
			 * The panes are stacked in one CSS Grid cell so every Collect.js
			 * iframe mounts at the correct width on first render. But that
			 * also means the INACTIVE pane's iframes occupy the exact same
			 * rect as the ACTIVE pane's iframes. Even with
			 * `visibility:hidden` + `pointer-events:none` on the outer pane,
			 * cross-origin iframes at the same coordinates intercept keyboard
			 * events in Chromium/WebKit: focus goes to the active iframe but
			 * keydown routes to the z-order top, which is usually the card
			 * pane's ccnumber iframe. Buyers then see ACH fields that accept
			 * focus but never capture typing. Applying `inert` to the
			 * inactive pane removes every descendant (including iframes)
			 * from the hit-test and focus tree, so keystrokes flow to the
			 * active pane only. `aria-hidden` keeps screen readers in sync.
			 */
			applyActivePane(target);
			if (target !== 'saved') {
				// Explicit tab switch should invalidate any cached tokenization
				// so the next submit re-tokenizes for the freshly visible pane.
				setHidden('cardz3n_payment_token', '');
				setHidden('cardz3n_token_type', '');
			}
			/*
			 * 1.0.23 — re-mount Collect.js against the newly-visible pane only.
			 * See the long comment on configureCollect() for the cross-origin
			 * focus bug this fixes. Without this remount the buyer can switch
			 * to the ACH tab, click into the Name field, and have their
			 * typing silently swallowed because Collect.js is still focused
			 * on the (now hidden) card-ccnumber iframe.
			 */
			/*
			 * 1.0.25 — only remount Collect.js when the tab actually changed.
			 * Rapid double-clicks previously thrashed iframes, which caused
			 * the first ~100ms of typing in the newly-mounted field to be
			 * dropped. Also increased the settle delay to 120ms.
			 */
			if ((target === 'card' || target === 'ach') && target !== previousPane) {
				resetCollect();
				setTimeout(configureCollect, 120);
			}
			clearError();
		});
	}

	/* ------------------------------------------------------------------
	 * Collect.js configuration
	 * --------------------------------------------------------------- */

	/*
	 * 1.0.23 — PANE-SCOPED FIELDS.
	 *
	 * In 1.0.22 and earlier, configureCollect() registered BOTH the card and
	 * ACH fields with Collect.js on first render. The three card iframes and
	 * the three ACH iframes all mounted at the same grid-stack coordinates,
	 * but only the first one to mount (ccnumber) received Collect.js's
	 * internal auto-focus. When the buyer switched to the ACH tab and clicked
	 * the Name field, the browser focused the outer IFRAME element — but
	 * cross-origin security prevents the parent page from forcing focus into
	 * the <input> inside. Since Collect.js still considered ccnumber its
	 * focused field, the ACH input body received keystrokes (and swallowed
	 * them). Net result: ACH fields appeared clickable but silently
	 * discarded typing. Verified live in Playwright:
	 * document.activeElement inside the ACH checkname iframe remained <body>
	 * even after a real mouse click on the field.
	 *
	 * Fix: only pass the ACTIVE pane's fields to CollectJS.configure(). When
	 * the buyer switches tabs we resetCollect() + configureCollect() so the
	 * iframes for the newly-visible pane mount fresh and the first field in
	 * that pane's field hash receives Collect.js's own auto-focus. No more
	 * cross-origin focus-forwarding hack needed.
	 */
	function activeCollectPane() {
		// Only Card or ACH drive Collect.js; Saved reuses existing vault tokens.
		if (activePane === 'ach' && cfg.enableAch) { return 'ach'; }
		if (cfg.enableCards) { return 'card'; }
		if (cfg.enableAch) { return 'ach'; }
		return null;
	}

	function configureCollect() {
		if (configured || typeof window.CollectJS === 'undefined') {
			return;
		}

		var pane = activeCollectPane();
		if (!pane) { return; } // Saved-only — no hosted fields needed.

		var fields = {};

		if (pane === 'card') {
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
		} else if (pane === 'ach') {
			fields.checkname = { selector: '#cardz3n-checkname', title: cfg.i18n.accountName, placeholder: 'Name on account' };
			fields.checkaba = { selector: '#cardz3n-checkaba', title: cfg.i18n.routing, placeholder: 'Routing number' };
			fields.checkaccount = { selector: '#cardz3n-checkaccount', title: cfg.i18n.account, placeholder: 'Account number' };
		}
		// 1.0.29: Apple Pay / Google Pay -- each wallet gets ONLY its own
		// documented attributes (see the note above configureCollect()) and
		// is feature-detected so an ineligible device/browser never gets it
		// passed to Collect.js at all.
		if (cfg.enableApplePay && window.ApplePaySession && window.ApplePaySession.canMakePayments && window.ApplePaySession.canMakePayments()) {
			fields.applePay = { selector: '.cardz3n-applepay-button', type: 'buy' };
		}
		if (cfg.enableGooglePay && window.google && window.google.payments && window.google.payments.api) {
			fields.googlePay = { selector: '.cardz3n-googlepay-button' };
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

		// 1.0.29: Wallets restored. The 1.0.20 fatal throw was caused by scoping
		// errors, not a Collect.js limitation: fields.applePay had Google-Pay-only
		// keys mixed in (emailRequired, buttonColor) plus an incorrectly-shaped
		// `style` object. Collect.js validates each wallet against its own
		// attribute set and throws on any unrecognized key, taking the whole
		// configure() call down with it (why card/ACH broke too). Fixed by giving
		// each wallet only its own documented, minimal attributes -- see
		// fields.applePay / fields.googlePay below -- and by feature-detecting
		// each wallet before including it, matching the approach from 1.0.10.
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

		if (attemptConfigure(collectConfig, 'card+ach')) {
		// 1.0.29: wallets now stay visible -- each was feature-detected before
			// being added to `fields` above, so only eligible wallets render here.

			/*
			 * 1.0.24 — watchdog. If Collect.js accepted configure() but the
			 * hosted-field iframes never mount within 2.5s, the Public Key is
			 * almost certainly wrong-scope or the merchant account is disabled.
			 * Surface a clear error instead of leaving buyers staring at blank,
			 * un-typeable fields.
			 */
			setTimeout(function () {
				if (collectInitErrored) { return; }
				var $root = $ui();
				if (!$root.length) { return; }
				var expected = pane === 'card'
					? ['#cardz3n-ccnumber', '#cardz3n-ccexp', '#cardz3n-cvv']
					: ['#cardz3n-checkname', '#cardz3n-checkaba', '#cardz3n-checkaccount'];
				var mounted = 0;
				for (var i = 0; i < expected.length; i++) {
					if ($root.find(expected[i] + ' iframe').length) { mounted++; }
				}
				if (mounted === 0) {
					showError('The secure payment form did not load. The Public Key in the CARDZ3N Gateway settings may be scoped to "Tokenization" (Source API) instead of "Collect Checkout". Please notify the store owner.');
				}
			}, 2500);

			return;
		}

		showError(cfg.i18n.initError || 'Unable to initialize secure payment form.');
	}

	function resetCollect() {
		if (typeof window.CollectJS !== 'undefined' && window.CollectJS && typeof window.CollectJS.clearInputs === 'function') {
			try { window.CollectJS.clearInputs(); } catch (e) {}
		}
		/*
		 * 1.0.23 — remove Collect.js-minted iframes from the hosted-field
		 * containers so the next configureCollect() re-creates them fresh.
		 * Without this the previously-mounted iframes stick around and keep
		 * their stale focus state, defeating the pane-scoped re-mount.
		 */
		var $root = $ui();
		if ($root.length) {
			$root.find('#cardz3n-ccnumber, #cardz3n-ccexp, #cardz3n-cvv, #cardz3n-checkname, #cardz3n-checkaba, #cardz3n-checkaccount').each(function () {
				$(this).empty();
			});
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
		var cardBrand = (response.card && response.card.type) ? response.card.type : '';
		setHidden('cardz3n_card_brand', cardBrand);

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

		/*
		 * 1.0.25 — before handing control back to WooCommerce, MIRROR the
		 * hidden inputs directly into the checkout <form>. Some hosting
		 * environments (notably SiteGround) reorder DOM nodes during
		 * updated_checkout, and the hidden token inputs can end up outside
		 * the form's .serialize() scope. Appending them as direct children
		 * of form.checkout guarantees they ride along on the AJAX POST.
		 */
		var mirror = function (name, val) {
			var sel = 'input[name="' + name + '"].cardz3n-mirror';
			$form.children(sel).remove();
			$form.append('<input type="hidden" class="cardz3n-mirror" name="' + name + '" value="' + $('<div>').text(val == null ? '' : val).html() + '" />');
		};
		mirror('cardz3n_payment_token', response.token);
		mirror('cardz3n_token_type', response.tokenType || activeSource());
		mirror('cardz3n_payment_source', response.tokenType || activeSource());
		mirror('cardz3n_card_brand', cardBrand);

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
			// 1.0.22 — also strip the cardz3n-tokenized marker so bindCheckoutForm's
			// fast-path (line ~below) doesn't let a retry through WITHOUT a fresh
			// token. Without this, a failed first attempt leaves the class on the
			// form and the next click skips Collect.js entirely.
			$('form.checkout').removeClass('cardz3n-tokenized');
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

		/*
		 * 1.0.22 — always detach any prior submit.cardz3n handler before
		 * re-binding. `bindCheckoutForm()` runs on ready() AND on every
		 * `updated_checkout` (line ~below). Prior to 1.0.22 that stacked
		 * duplicate handlers; each one called preventDefault() + Collect.js
		 * startPaymentRequest() on submit, and only the last token was written
		 * to the hidden field — but the earlier handlers had already fired
		 * preventDefault() and the internal `submitting` flag, so the native
		 * form POST never reached PHP and process_payment() saw an empty
		 * `cardz3n_payment_token`, yielding "Payment details could not be
		 * tokenized. Please try again." for card submissions.
		 */
		$form.off('submit.cardz3n');

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
			// 1.0.22 — restore the active pane invariant that PHP's initial
			// render just clobbered. Without this, the pane the buyer was
			// using has `inert` re-applied by the server-rendered markup and
			// keystrokes silently go nowhere (reported as "ACH Name field
			// locks up after a failed submit").
			applyActivePane(activePane);
		});

		// First render.
		if ($ui().length) {
			setTimeout(configureCollect, 50);
		}
	});

})(jQuery);
