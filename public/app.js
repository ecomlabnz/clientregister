/* Progressive enhancement only. Every action on the site works with this file
   blocked: forms submit normally and confirmations simply do not appear. */
(function () {
  'use strict';

  // Confirm destructive actions declared with data-confirm.
  document.addEventListener('submit', function (event) {
    var form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    var message = form.getAttribute('data-confirm');
    if (message && !window.confirm(message)) {
      event.preventDefault();
      return;
    }
    // Guard against double submission on slow connections.
    var button = form.querySelector('button[type="submit"]');
    if (button && !form.hasAttribute('data-allow-resubmit')) {
      window.setTimeout(function () { button.disabled = true; }, 0);
    }
  });

  // Selects marked js-autosubmit apply on change; their fallback button is
  // hidden only once we know scripting is available.
  Array.prototype.forEach.call(document.querySelectorAll('.js-hide'), function (el) {
    el.hidden = true;
  });
  Array.prototype.forEach.call(document.querySelectorAll('.js-autosubmit'), function (select) {
    select.addEventListener('change', function () {
      if (select.form) select.form.requestSubmit ? select.form.requestSubmit() : select.form.submit();
    });
  });

  // The client form carries both an individual and an organisation section.
  // Without scripting both are shown and labelled, which still works; with it,
  // only the relevant one is visible.
  var clientForm = document.querySelector('.js-client-form');
  if (clientForm) {
    var kindSelect = clientForm.querySelector('select[name="kind"]');
    var sections = clientForm.querySelectorAll('[data-kind]');
    var applyKind = function () {
      Array.prototype.forEach.call(sections, function (section) {
        section.hidden = section.getAttribute('data-kind') !== kindSelect.value;
      });
    };
    if (kindSelect && sections.length) {
      kindSelect.addEventListener('change', applyKind);
      applyKind();
    }
  }

  // "/" focuses the first search box on the page.
  document.addEventListener('keydown', function (event) {
    if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
    var active = document.activeElement;
    if (active && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)) return;
    var search = document.querySelector('input[type="search"]');
    if (search) {
      event.preventDefault();
      search.focus();
    }
  });
})();
