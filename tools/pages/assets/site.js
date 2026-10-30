// Task loot-reference-pages-20261030 (lane SITE): Terminal State reference site — small progressive-enhancement script.
// Without it every table and group is still fully visible; it only adds text filtering and expand/collapse-all buttons.
// No network access, no storage, no third-party code.
(function () {
  'use strict';

  function normalise(text) {
    return String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function setupFilter(box) {
    var target = document.getElementById(box.getAttribute('data-filter'));
    var input = box.querySelector('input');
    var status = box.querySelector('[data-filter-status]');
    if (!target || !input) return;
    // Rows ([data-filter-row]: table rows or whole <details> blocks) are the units that match or not. Groups
    // ([data-filter-group]) are hidden while a filter is active and none of their rows match.
    var rows = Array.prototype.slice.call(target.querySelectorAll('[data-filter-row]'));
    var groups = Array.prototype.slice.call(target.querySelectorAll('[data-filter-group]'));
    var rowOpen = rows.map(function (r) { return r.tagName === 'DETAILS' ? r.open : false; });
    var groupOpen = groups.map(function (g) { return g.tagName === 'DETAILS' ? g.open : false; });
    var texts = rows.map(function (r) { return normalise((r.getAttribute('data-search') || '') + ' ' + r.textContent); });
    var noun = box.getAttribute('data-filter-noun') || 'entries';
    box.hidden = false;

    function apply() {
      var terms = normalise(input.value).split(' ').filter(Boolean);
      var active = terms.length > 0;
      var shown = 0;
      rows.forEach(function (row, i) {
        var hit = terms.every(function (t) { return texts[i].indexOf(t) !== -1; });
        row.hidden = !hit;
        if (row.tagName === 'DETAILS') row.open = active ? hit : rowOpen[i];
        if (hit) shown += 1;
      });
      groups.forEach(function (group, i) {
        var visible = group.querySelector('[data-filter-row]:not([hidden])') !== null;
        group.hidden = active && !visible;
        if (group.tagName === 'DETAILS') group.open = active ? visible : groupOpen[i];
      });
      if (status) {
        status.textContent = active ? shown + ' of ' + rows.length + ' ' + noun + ' match' : rows.length + ' ' + noun;
      }
    }

    input.addEventListener('input', apply);
    var params = new URLSearchParams(window.location.search);
    if (params.get('q')) input.value = params.get('q');
    apply();
  }

  function setupDetailsTools(tools) {
    var scope = document.getElementById(tools.getAttribute('data-details-tools')) || document;
    tools.hidden = false;
    tools.addEventListener('click', function (event) {
      var button = event.target.closest('button[data-details]');
      if (!button) return;
      var open = button.getAttribute('data-details') === 'expand';
      Array.prototype.forEach.call(scope.querySelectorAll('details'), function (d) {
        if (!d.hidden) d.open = open;
      });
    });
  }

  function init() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-filter]'), setupFilter);
    Array.prototype.forEach.call(document.querySelectorAll('[data-details-tools]'), setupDetailsTools);
    // Opening a link to a row/group inside a closed <details> reveals it.
    function revealHash() {
      if (!window.location.hash) return;
      var el = document.getElementById(decodeURIComponent(window.location.hash.slice(1)));
      var opened = false;
      for (var node = el; node; node = node.parentElement) {
        if (node.tagName === 'DETAILS' && !node.open) { node.open = true; opened = true; }
      }
      if (el && opened) el.scrollIntoView();
    }
    window.addEventListener('hashchange', revealHash);
    revealHash();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
