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

  // Choosing a standard item on a quote fills the rest of the line in. The
  // values ride on the option's data attributes, so this costs no request and
  // works the moment the page is painted. Without scripting the dropdown still
  // records which catalogue item was meant; the typist just fills the rest in.
  Array.prototype.forEach.call(document.querySelectorAll('.js-quote-line'), function (form) {
    var picker = form.querySelector('.js-catalogue');
    if (!picker) return;
    picker.addEventListener('change', function () {
      var option = picker.options[picker.selectedIndex];
      if (!option || !option.value) return;
      var set = function (name, value) {
        var input = form.querySelector('[name="' + name + '"]');
        // Never overwrite something the person has already typed.
        if (input && (!input.value || input.dataset.fromCatalogue === '1')) {
          input.value = value;
          input.dataset.fromCatalogue = '1';
        }
      };
      var force = function (name, value) {
        var input = form.querySelector('[name="' + name + '"]');
        if (input) input.value = value;
      };
      force('description', option.getAttribute('data-description') || option.textContent.trim());
      force('kind', option.getAttribute('data-kind') || 'professional');
      force('unit_label', option.getAttribute('data-unit') || 'item');
      force('gst_treatment', option.getAttribute('data-gst') || 'exclusive');
      var amount = option.getAttribute('data-amount');
      if (amount && amount !== '0.00') force('unit_amount', amount);
      else set('unit_amount', '');
    });
  });

  // Search that answers as you type.
  //
  // Progressive enhancement, not a rewrite: the form still submits normally
  // with this file blocked, and the Filter button still works. What this adds
  // is a debounced fetch of the same URL the form would have gone to, from
  // which the results region is lifted and swapped in. The server renders the
  // page it always renders; nothing here knows anything about the data.
  Array.prototype.forEach.call(document.querySelectorAll('form[data-live-search]'), function (form) {
    var region = document.querySelector('[data-live-results]');
    if (!region || !window.fetch || !window.AbortController) return;

    var timer = null;
    var inFlight = null;

    var run = function () {
      // A slow answer to an abandoned query must never overwrite the answer to
      // the one being typed now, so the previous request is cancelled.
      if (inFlight) inFlight.abort();
      inFlight = new AbortController();

      var params = new URLSearchParams(new FormData(form));
      // Any page number belongs to the old query.
      params.delete('page');
      var url = form.getAttribute('action') + '?' + params.toString();

      region.setAttribute('aria-busy', 'true');
      window.fetch(url, { signal: inFlight.signal, credentials: 'same-origin' })
        .then(function (response) { return response.ok ? response.text() : Promise.reject(response.status); })
        .then(function (markup) {
          var fresh = new DOMParser().parseFromString(markup, 'text/html')
            .querySelector('[data-live-results]');
          if (fresh) region.innerHTML = fresh.innerHTML;
          region.removeAttribute('aria-busy');
          // The address bar follows, so a reload or a shared link shows the
          // same list — replace rather than push, so Back leaves the page
          // rather than walking every keystroke.
          if (window.history && window.history.replaceState) {
            window.history.replaceState(null, '', url);
          }
        })
        .catch(function (reason) {
          // An abort is the expected case and means another request is already
          // on its way. Anything else leaves the current results alone: a
          // stale list is better than an empty one.
          if (reason !== 'AbortError') region.removeAttribute('aria-busy');
        });
    };

    var schedule = function (delay) {
      window.clearTimeout(timer);
      timer = window.setTimeout(run, delay);
    };

    form.addEventListener('input', function (event) {
      if (event.target && event.target.type === 'submit') return;
      schedule(250);
    });
    // A dropdown is a decision, not a keystroke, so it applies at once.
    form.addEventListener('change', function () { schedule(0); });
    // Enter would otherwise reload the whole page for a result already shown.
    form.addEventListener('submit', function (event) { event.preventDefault(); schedule(0); });
  });

  // The formatting buttons above a message body.
  //
  // Plain textarea manipulation rather than a rich-text editor: no
  // contenteditable, no execCommand, no library. What is stored stays the text
  // the person typed, which is what makes it safe to render and readable in the
  // audit log afterwards. Without this file the markers can simply be typed.
  Array.prototype.forEach.call(document.querySelectorAll('.js-compose'), function (composer) {
    var body = composer.querySelector('textarea');
    if (!body) return;

    var apply = function (fn) {
      var start = body.selectionStart;
      var end = body.selectionEnd;
      var result = fn(body.value.slice(start, end), body.value, start, end);
      body.value = result.value;
      body.focus();
      body.setSelectionRange(result.start, result.end);
      // So the browser marks the form dirty and any listener sees the change.
      body.dispatchEvent(new Event('input', { bubbles: true }));
    };

    Array.prototype.forEach.call(composer.querySelectorAll('[data-wrap]'), function (button) {
      var mark = button.getAttribute('data-wrap');
      button.addEventListener('click', function () {
        apply(function (selected, value, start, end) {
          var text = selected || 'text';
          return {
            value: value.slice(0, start) + mark + text + mark + value.slice(end),
            // Leave the wording selected so typing replaces it.
            start: start + mark.length,
            end: start + mark.length + text.length,
          };
        });
      });
    });

    Array.prototype.forEach.call(composer.querySelectorAll('[data-prefix]'), function (button) {
      var prefix = button.getAttribute('data-prefix');
      button.addEventListener('click', function () {
        apply(function (selected, value, start, end) {
          // Work on whole lines: a list marker in the middle of one means
          // nothing.
          var from = value.lastIndexOf('\n', start - 1) + 1;
          var to = value.indexOf('\n', end);
          if (to === -1) to = value.length;
          var lines = value.slice(from, to).split('\n');
          var numbered = /^\d+\. $/.test(prefix);
          var out = lines.map(function (line, i) {
            var bare = line.replace(/^\s*(?:[-*•]\s+|\d+[.)]\s+|#{1,3}\s+)/, '');
            return (numbered ? (i + 1) + '. ' : prefix) + bare;
          }).join('\n');
          return { value: value.slice(0, from) + out + value.slice(to), start: from, end: from + out.length };
        });
      });
    });
  });

  // Choosing "Disbursement" defaults GST to none.
  //
  // Money paid to Immigration New Zealand or a panel physician on a client's
  // behalf is passed through without GST added; adding it is the mistake that
  // is easy to make and hard to spot on a quote. Only the untouched default is
  // changed — anyone who has already set the treatment themselves keeps it.
  Array.prototype.forEach.call(document.querySelectorAll('.js-quote-line'), function (form) {
    var kind = form.querySelector('select[name="kind"]');
    var gst = form.querySelector('select[name="gst_treatment"]');
    if (!kind || !gst) return;
    gst.addEventListener('change', function () { gst.dataset.chosen = '1'; });
    kind.addEventListener('change', function () {
      if (gst.dataset.chosen === '1') return;
      gst.value = kind.value === 'professional' ? (gst.dataset.original || gst.value) : 'none';
    });
    gst.dataset.original = gst.value;
  });

  // Forms split across tabs.
  //
  // The whole form is always in the document and always submits together; the
  // tabs only decide what is on screen. With this file blocked every section
  // shows at once, which is how the form worked before and still works.
  //
  // The one thing that needs care is validation: a browser refuses to report a
  // problem on a field it cannot show, so an invalid field on a hidden tab
  // would stop the form submitting with nothing to explain why. Listening for
  // `invalid` in the capture phase lets us reveal that tab first.
  Array.prototype.forEach.call(document.querySelectorAll('.js-tabbed'), function (form) {
    var name = form.getAttribute('data-tabs');
    var bar = document.querySelector('[data-tabs-for="' + name + '"]');
    if (!bar) return;

    var panels = form.querySelectorAll('[data-panel]');
    var buttons = bar.querySelectorAll('[data-tab]');

    var show = function (which) {
      Array.prototype.forEach.call(panels, function (panel) {
        panel.hidden = panel.getAttribute('data-panel') !== which;
      });
      Array.prototype.forEach.call(buttons, function (button) {
        var on = button.getAttribute('data-tab') === which;
        button.classList.toggle('current', on);
        button.setAttribute('aria-selected', on ? 'true' : 'false');
      });
    };

    Array.prototype.forEach.call(buttons, function (button) {
      button.addEventListener('click', function () { show(button.getAttribute('data-tab')); });
    });

    form.addEventListener('invalid', function (event) {
      var panel = event.target.closest ? event.target.closest('[data-panel]') : null;
      if (panel && panel.hidden) show(panel.getAttribute('data-panel'));
    }, true);

    bar.hidden = false;
    show(buttons[0].getAttribute('data-tab'));
  });

  // Print buttons. Declared with data-print rather than an inline handler,
  // because the content security policy forbids inline script.
  Array.prototype.forEach.call(document.querySelectorAll('[data-print]'), function (button) {
    button.addEventListener('click', function () { window.print(); });
  });

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
