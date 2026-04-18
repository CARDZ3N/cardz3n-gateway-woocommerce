/**
 * CARDZ3N Gateway — admin helpers.
 * Handles the manual "Capture Authorized Payment" button and the Test
 * Credentials button on the gateway settings page.
 */
(function ($) {
	'use strict';

	$(document).on('click', '.cardz3n-capture-btn', function (e) {
		e.preventDefault();
		var $btn = $(this);
		var orderId = $btn.data('order');

		if (!window.confirm(CARDZ3N_ADMIN.i18n.confirmCapture)) { return; }
		$btn.prop('disabled', true).text(CARDZ3N_ADMIN.i18n.testing);

		$.post(CARDZ3N_ADMIN.ajaxUrl, {
			action: 'cardz3n_capture_order',
			nonce: CARDZ3N_ADMIN.nonce,
			order_id: orderId
		})
		.done(function (res) {
			if (res && res.success) {
				alert(CARDZ3N_ADMIN.i18n.captureOk);
				window.location.reload();
			} else {
				alert(CARDZ3N_ADMIN.i18n.captureFailed + '\n' + (res && res.data && res.data.msg ? res.data.msg : ''));
				$btn.prop('disabled', false).text('Capture Authorized Payment');
			}
		})
		.fail(function () {
			alert(CARDZ3N_ADMIN.i18n.captureFailed);
			$btn.prop('disabled', false).text('Capture Authorized Payment');
		});
	});

	$(document).on('click', '.cardz3n-validate-btn', function (e) {
		e.preventDefault();
		var $btn = $(this);
		var $out = $btn.siblings('.cardz3n-validate-result');
		$btn.prop('disabled', true);
		$out.text(CARDZ3N_ADMIN.i18n.testing);

		$.post(CARDZ3N_ADMIN.ajaxUrl, {
			action: 'cardz3n_validate_credentials',
			nonce: CARDZ3N_ADMIN.nonce
		})
		.done(function (res) {
			if (res && res.success && res.data && res.data.ok) {
				$out.css('color', '#00875a').text('✓ ' + (res.data.msg || 'OK'));
			} else {
				$out.css('color', '#d64545').text('✗ ' + (res && res.data && res.data.msg ? res.data.msg : 'Failed'));
			}
		})
		.fail(function () {
			$out.css('color', '#d64545').text('✗ Network error.');
		})
		.always(function () {
			$btn.prop('disabled', false);
		});
	});

})(jQuery);
