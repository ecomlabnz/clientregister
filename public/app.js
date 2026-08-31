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
  // Form tabs, and the two kinds of client record.
  //
  // These are one problem rather than two. A company has no passport and a
  // person has no NZBN, so the sections that belong to the other kind are not
  // merely hidden — their tab goes too, because a tab that opens nothing is
  // worse than no tab.
  //
  // Without scripting every section shows at once, which still works: the
  // server marks the irrelevant kind hidden in the HTML itself, so the company
  // boxes never appear on an individual whether this file runs or not.
  Array.prototype.forEach.call(document.querySelectorAll('.js-tabbed'), function (form) {
    var name = form.getAttribute('data-tabs');
    var bar = document.querySelector('[data-tabs-for="' + name + '"]');
    if (!bar) return;

    var panels = form.querySelectorAll('[data-panel]');
    var buttons = bar.querySelectorAll('[data-tab]');
    var kindSelect = form.querySelector('select[name="kind"]');
    var kindBlocks = form.querySelectorAll('[data-kind]');

    // Does this element belong to the kind of record being edited?
    var applies = function (el) {
      var kind = el.getAttribute('data-kind');
      if (!kind || !kindSelect) return true;
      return kind === kindSelect.value;
    };

    var panelFor = function (which) {
      for (var i = 0; i < panels.length; i++) {
        if (panels[i].getAttribute('data-panel') === which) return panels[i];
      }
      return null;
    };

    var current = buttons.length ? buttons[0].getAttribute('data-tab') : null;

    var render = function () {
      // Anything belonging to the other kind disappears first, wherever it sits.
      Array.prototype.forEach.call(kindBlocks, function (block) {
        block.hidden = !applies(block);
      });

      // A tab whose section does not apply is not offered.
      Array.prototype.forEach.call(buttons, function (button) {
        var panel = panelFor(button.getAttribute('data-tab'));
        button.hidden = Boolean(panel) && !applies(panel);
      });

      // If the open tab just became irrelevant, fall back to the first one that
      // is not, rather than leaving the form apparently empty.
      var open = panelFor(current);
      if (!open || !applies(open)) {
        for (var i = 0; i < buttons.length; i++) {
          if (!buttons[i].hidden) { current = buttons[i].getAttribute('data-tab'); break; }
        }
      }

      Array.prototype.forEach.call(panels, function (panel) {
        panel.hidden = panel.getAttribute('data-panel') !== current || !applies(panel);
      });
      Array.prototype.forEach.call(buttons, function (button) {
        var on = button.getAttribute('data-tab') === current;
        button.classList.toggle('current', on);
        button.setAttribute('aria-selected', on ? 'true' : 'false');
      });
    };

    Array.prototype.forEach.call(buttons, function (button) {
      button.addEventListener('click', function () {
        current = button.getAttribute('data-tab');
        render();
      });
    });

    if (kindSelect) kindSelect.addEventListener('change', render);

    // A field failing validation inside a closed tab would otherwise report an
    // error nobody can see.
    form.addEventListener('invalid', function (event) {
      var panel = event.target.closest ? event.target.closest('[data-panel]') : null;
      if (panel && panel.hidden) {
        current = panel.getAttribute('data-panel');
        render();
      }
    }, true);

    bar.hidden = false;
    render();
  });

  // Individual-or-organisation, outside a tabbed form.
  //
  // The client form does this as part of its tab rendering, because there the
  // record type decides whole tabs. Elsewhere — converting an inquiry, for one
  // — the same choice governs only a couple of boxes, and marking the block
  // .js-kind is all it takes. As on the client form, the server marks the
  // irrelevant half hidden in the HTML, so this only keeps up with a change.
  Array.prototype.forEach.call(document.querySelectorAll('.js-kind'), function (block) {
    var kindSelect = block.querySelector('select[name="kind"]');
    var kindBlocks = block.querySelectorAll('[data-kind]');
    if (!kindSelect || !kindBlocks.length) return;
    var render = function () {
      Array.prototype.forEach.call(kindBlocks, function (el) {
        el.hidden = el.getAttribute('data-kind') !== kindSelect.value;
      });
    };
    kindSelect.addEventListener('change', render);
    render();
  });

  // Print buttons. Declared with data-print rather than an inline handler,
  // because the content security policy forbids inline script.
  Array.prototype.forEach.call(document.querySelectorAll('[data-print]'), function (button) {
    button.addEventListener('click', function () { window.print(); });
  });

  // Being told when something arrives.
  //
  // A small poll rather than a socket: this is a practice of a few people, the
  // answer is two numbers, and a connection held open for a message that comes
  // twice an hour is a cost with nothing to show for it. The interval is the
  // person's own, and "never" really means no request at all.
  //
  // The sounds are synthesised rather than downloaded. Partly because it is
  // lighter — no files, no requests — and partly because the content policy
  // permits no media at all, so an audio file would be blocked outright.
  (function notifications() {
    var body = document.body;
    if (body.getAttribute('data-notify') !== '1') return;
    var every = parseInt(body.getAttribute('data-notify-every') || '0', 10);
    if (!every || !window.fetch) return;

    var position = body.getAttribute('data-notify-position') || 'bottom-right';
    var soundName = body.getAttribute('data-notify-sound') || 'chime';
    // Two pieces of state, not one: "we have not asked yet" and "the inbox is
    // empty" are different things, and conflating them swallows the first
    // message to arrive into an empty inbox.
    var primed = false;
    var lastSeen = null;
    var audio = null;

    // Two soft notes, one clear note, two low taps, a short run, three warm
    // ones. Each is a frequency list and a shape; nothing here is a recording.
    var SOUNDS = {
      chime: { notes: [880, 1318.5], gap: 0.12, type: 'sine', length: 0.5 },
      ping: { notes: [1046.5], gap: 0, type: 'sine', length: 0.35 },
      knock: { notes: [196, 196], gap: 0.14, type: 'triangle', length: 0.16 },
      rise: { notes: [523.25, 659.25, 784, 1046.5], gap: 0.07, type: 'sine', length: 0.22 },
      marimba: { notes: [659.25, 783.99, 1046.5], gap: 0.11, type: 'triangle', length: 0.4 },
    };

    var play = function (name) {
      var spec = SOUNDS[name];
      if (!spec) return;
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      try {
        // Created on demand and kept: browsers refuse to start one before the
        // page has been interacted with, so the first alert may be silent.
        // That is the browser's rule, not a fault here.
        if (!audio) audio = new Ctx();
        if (audio.state === 'suspended') audio.resume();
        spec.notes.forEach(function (frequency, i) {
          var at = audio.currentTime + i * spec.gap;
          var osc = audio.createOscillator();
          var gain = audio.createGain();
          osc.type = spec.type;
          osc.frequency.setValueAtTime(frequency, at);
          // A quick attack and a long tail: a square-edged note sounds like a
          // fault, a rounded one sounds like a notification.
          gain.gain.setValueAtTime(0.0001, at);
          gain.gain.exponentialRampToValueAtTime(0.16, at + 0.012);
          gain.gain.exponentialRampToValueAtTime(0.0001, at + spec.length);
          osc.connect(gain).connect(audio.destination);
          osc.start(at);
          osc.stop(at + spec.length + 0.05);
        });
      } catch (e) { /* No audio available; the banner still appears. */ }
    };

    var banner = function (message, href) {
      var host = document.querySelector('.toasts');
      if (!host) {
        host = document.createElement('div');
        host.className = 'toasts toasts-' + position;
        document.body.appendChild(host);
      }
      var toast = document.createElement('div');
      toast.className = 'toast';
      toast.setAttribute('role', 'status');
      var link = document.createElement('a');
      link.href = href;
      link.textContent = message;
      var close = document.createElement('button');
      close.type = 'button';
      close.className = 'toast-close';
      close.setAttribute('aria-label', 'Dismiss');
      close.textContent = '×';
      close.addEventListener('click', function () { toast.remove(); });
      toast.appendChild(link);
      toast.appendChild(close);
      host.appendChild(toast);
      window.setTimeout(function () { toast.remove(); }, 12000);
    };

    var check = function () {
      // Nothing is asked for while the tab is in the background: the answer
      // would only be shown when it comes forward anyway.
      if (document.hidden) return;
      window.fetch('/inbox/api/pending', { credentials: 'same-origin' })
        .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
        .then(function (data) {
          var latest = data && data.latest;
          var id = latest ? latest.id : null;
          // The first answer after a page load sets the mark rather than
          // announcing what was already waiting before you arrived.
          if (!primed) { primed = true; lastSeen = id; return; }
          if (id === lastSeen) return;
          lastSeen = id;
          // The top of the queue changed because someone triaged it, not
          // because anything arrived. Nothing to announce.
          if (!latest) return;
          var channel = latest.channel ? latest.channel.charAt(0).toUpperCase() + latest.channel.slice(1) : 'Inbox';
          banner(
            channel + ': ' + (latest.subject || 'a new message is waiting'),
            '/inbox/' + latest.id,
          );
          play(soundName);
        })
        .catch(function () { /* Offline or signed out; try again next time. */ });
    };

    check();
    window.setInterval(check, Math.max(15, every) * 1000);
  })();

  // The matter-title suggestion lived here.
  //
  // It filled a "Matter title" box from the client and the type as you chose
  // them — "AEWV. RUBEZHANSKII, Aleksei" — and it worked exactly as designed,
  // which turned out to be the problem. A box that arrives plausibly filled in
  // is never replaced: the practice reached 44 matters every one of which was
  // named after the two columns already beside it on the row. The field is
  // gone (31 August 2026); a matter is named by what it is about, and the
  // title column is derived from that on the server.
  //
  // Removed rather than left dormant: script that fills a field nothing
  // renders is a thing the next person has to read and rule out.

  // A file input that also accepts a drop.
  //
  // Progressive enhancement in the strict sense: the input inside the box is an
  // ordinary file input and works on its own. This adds the drop target, and
  // the list of what is about to be sent — which matters, because a file that
  // silently failed to attach looks exactly like a model that read nothing.
  Array.prototype.forEach.call(document.querySelectorAll('.js-dropzone'), function (zone) {
    var input = zone.querySelector('input[type="file"]');
    var list = zone.querySelector('[data-dropzone-list]');
    if (!input) return;

    var describe = function () {
      if (!list) return;
      var files = input.files;
      if (!files || !files.length) { list.textContent = ''; return; }
      var names = [];
      for (var i = 0; i < files.length; i++) {
        names.push(files[i].name + ' (' + Math.max(1, Math.round(files[i].size / 1024)) + ' KB)');
      }
      list.textContent = names.join(', ');
    };

    var stop = function (event) { event.preventDefault(); event.stopPropagation(); };
    ['dragenter', 'dragover'].forEach(function (name) {
      zone.addEventListener(name, function (event) { stop(event); zone.classList.add('dropzone-over'); });
    });
    ['dragleave', 'drop'].forEach(function (name) {
      zone.addEventListener(name, function (event) { stop(event); zone.classList.remove('dropzone-over'); });
    });
    zone.addEventListener('drop', function (event) {
      var dropped = event.dataTransfer && event.dataTransfer.files;
      if (!dropped || !dropped.length) return;
      // Assigning a DataTransfer's list is the only way to put dropped files
      // into a file input, so the ordinary form submission carries them.
      try {
        input.files = dropped;
      } catch (e) {
        return;
      }
      describe();
    });
    input.addEventListener('change', describe);
    describe();
  });

  // A rule has two sets of fields and uses one of them. Both are rendered, so
  // the form is complete without scripting; here the irrelevant one is folded
  // away as soon as the action is chosen.
  (function ruleFields() {
    var chooser = document.querySelector('select[name="action_kind"]');
    if (!chooser) return;
    var groups = document.querySelectorAll('[data-action-fields]');
    if (!groups.length) return;

    var sync = function () {
      var chosen = chooser.value;
      for (var i = 0; i < groups.length; i++) {
        var applies = groups[i].getAttribute('data-action-fields').split(' ').indexOf(chosen) !== -1;
        groups[i].hidden = !applies;
      }
    };
    chooser.addEventListener('change', sync);
    sync();
  })();

  // A top-bar menu closes when you go elsewhere.
  //
  // The menus are <details>, which the browser opens and closes on its own,
  // and name="topnav" already keeps only one of them open at a time. What
  // plain HTML has no way to say is "and close when the person's attention
  // has moved on", so that part is here.
  //
  // Closing on mouse-out was the obvious reading and is the wrong rule: a
  // phone has no hover, so the menu would open on a tap and then never close,
  // and on a desktop a menu that vanishes when the pointer strays a few pixels
  // is worse than one that stays. Clicking or tapping anywhere else closes it,
  // on both, and Escape closes it from the keyboard. Choosing an item
  // navigates, which closes it by loading a new page.
  //
  // With scripting off the menus still open and close on click, one at a time;
  // they just stay open until something else is clicked.
  (function topbarMenus() {
    var closeAll = function (except) {
      var open = document.querySelectorAll('details.nav-group[open]');
      for (var i = 0; i < open.length; i++) {
        if (open[i] !== except) open[i].open = false;
      }
    };
    document.addEventListener('click', function (event) {
      var inside = event.target.closest ? event.target.closest('details.nav-group') : null;
      closeAll(inside);
    });
    document.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape') return;
      var open = document.querySelector('details.nav-group[open]');
      if (!open) return;
      var summary = open.querySelector('summary');
      closeAll(null);
      if (summary) summary.focus();
    });
  })();

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
