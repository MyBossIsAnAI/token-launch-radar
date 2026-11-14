/* Token Launch Radar — client side. Reads window.RADAR (written by main.ts
   into data.js) and renders the board, detail pages, comparables and method.
   No network calls: everything on this page comes from that one payload. */
(function () {
  'use strict';

  var DATA = window.RADAR || { rows: [], comparables: [], multiples: [], caveats: [] };
  var ROWS = DATA.rows || [];
  var BY_SLUG = {};
  ROWS.forEach(function (r) { BY_SLUG[r.slug] = r; });

  function $(id) { return document.getElementById(id); }

  function money(n) {
    if (n == null || !isFinite(n)) return '—';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  }

  function moneyFull(n) {
    if (n == null || !isFinite(n)) return '—';
    return '$' + Math.round(n).toLocaleString('en-US');
  }

  function pct(n) {
    if (n == null || !isFinite(n)) return '—';
    var s = (n >= 0 ? '+' : '') + n.toFixed(1) + '%';
    return '<span class="' + (n >= 0 ? 'pos' : 'neg') + '">' + s + '</span>';
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function ageLabel(days) {
    if (days == null) return 'unknown age';
    if (days < 30) return days + 'd old';
    if (days < 365) return Math.round(days / 30) + 'mo old';
    return (days / 365).toFixed(1) + 'y old';
  }

  /* ---- hero ---- */
  function renderHero() {
    var top = ROWS[0];
    var tiles = [
      [DATA.scanned, 'protocols scanned'],
      [ROWS.length, 'rows ranked'],
      [DATA.watchlist_covered + ' / ' + DATA.watchlist_total, 'watchlist covered'],
      [money(DATA.combined_implied_usd), 'combined implied value'],
      [(DATA.comparables || []).length, 'live comparables'],
      [top ? top.name : '—', 'top implied: ' + money(top ? top.implied_value_usd : 0)],
    ];
    $('hero').innerHTML = tiles.map(function (t) {
      return '<div class="stat"><div class="num">' + esc(t[0]) + '</div><div class="lbl">' + esc(t[1]) + '</div></div>';
    }).join('');
    $('asof').textContent = DATA.as_of || '';
  }

  /* ---- filter controls ---- */
  function fillSelect(el, values) {
    var keep = el.value;
    el.innerHTML = '<option value="">' + (el.id === 'category' ? 'All categories' : 'All chains') + '</option>' +
      values.map(function (v) { return '<option value="' + esc(v) + '">' + esc(v) + '</option>'; }).join('');
    el.value = keep;
  }

  function initFilters() {
    var cats = [], chains = [];
    ROWS.forEach(function (r) {
      if (cats.indexOf(r.category) < 0) cats.push(r.category);
      (r.chains || []).forEach(function (c) { if (chains.indexOf(c) < 0) chains.push(c); });
    });
    fillSelect($('category'), cats.sort());
    fillSelect($('chain'), chains.sort());
  }

  /* ---- board ---- */
  function filteredRows() {
    var q = ($('q').value || '').trim().toLowerCase();
    var cat = $('category').value;
    var chain = $('chain').value;
    var watchOnly = $('watch').checked;
    var sortKey = $('sort').value;
    var list = ROWS.filter(function (r) {
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0) return false;
      if (cat && r.category !== cat) return false;
      if (chain && (r.chains || []).indexOf(chain) < 0) return false;
      if (watchOnly && !r.watchlist) return false;
      return true;
    });
    var key = {
      implied: function (r) { return r.implied_value_usd; },
      tvl: function (r) { return r.tvl_usd; },
      change: function (r) { return r.change_7d == null ? -Infinity : r.change_7d; },
      multiple: function (r) { return r.base_multiple; },
      age: function (r) { return r.age_days == null ? -1 : r.age_days; },
    }[sortKey] || function (r) { return r.implied_value_usd; };
    list.sort(function (a, b) { return key(b) - key(a); });
    return list;
  }

  function renderBoard() {
    var list = filteredRows();
    var maxImp = ROWS.length ? ROWS[0].implied_value_usd : 1;
    $('count').textContent = list.length + ' of ' + ROWS.length + ' protocols shown';
    if (!list.length) {
      $('rows').innerHTML = '<tr><td colspan="8"><div class="empty">No protocols match these filters.</div></td></tr>';
      return;
    }
    $('rows').innerHTML = list.map(function (r) {
      var width = Math.max(2, Math.round((r.implied_value_usd / maxImp) * 100));
      return '<tr>' +
        '<td class="num">' + r.rank + '</td>' +
        '<td><a href="#p/' + esc(r.slug) + '">' + esc(r.name) + '</a>' +
          (r.watchlist ? '<span class="badge">Watchlist</span>' : '') +
          '<span class="peer">' + esc(r.category) + ' · ' + ageLabel(r.age_days) + '</span></td>' +
        '<td class="chain">' + esc((r.chains || []).slice(0, 3).join(', ')) + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num">' + pct(r.change_7d) + '</td>' +
        '<td class="num">' + moneyFull(r.implied_value_usd) + '<span class="bar" style="width:' + width + '%"></span></td>' +
        '<td class="num">' + r.implied_per_tvl.toFixed(2) + '×</td>' +
        '<td class="num">' + r.base_multiple.toFixed(2) + '×<span class="peer">' + r.peer_count + ' peers · ' + esc(r.multiple_source) + '</span></td>' +
        '</tr>';
    }).join('');
  }

  /* ---- detail ---- */
  function growthOf(r) {
    var c = r.change_7d == null ? 0 : Math.max(-60, Math.min(120, r.change_7d));
    return 1 + (c / 100) * 0.5;
  }
  function maturityOf(r) {
    var d = r.age_days == null ? 365 : r.age_days;
    return 0.6 + (Math.min(d, 1095) / 1095) * 0.4;
  }

  function renderDetail(slug) {
    var r = BY_SLUG[slug];
    var box = $('detail');
    if (!r) {
      box.innerHTML = '<h2>Protocol not found</h2><p class="lede">No board row has the slug “' + esc(slug) + '”.</p>';
      return;
    }
    var g = growthOf(r), m = maturityOf(r);
    box.innerHTML =
      '<h2>' + esc(r.name) + (r.watchlist ? '<span class="badge">Watchlist</span>' : '') + '</h2>' +
      '<p class="lede">' + esc(r.category) + ' · ' + esc((r.chains || []).join(', ')) + ' · ' + ageLabel(r.age_days) + '</p>' +
      '<div class="tiles">' +
        '<div class="stat"><div class="num">#' + r.rank + '</div><div class="lbl">rank</div></div>' +
        '<div class="stat"><div class="num">' + moneyFull(r.tvl_usd) + '</div><div class="lbl">TVL</div></div>' +
        '<div class="stat"><div class="num">' + moneyFull(r.implied_value_usd) + '</div><div class="lbl">implied value</div></div>' +
        '<div class="stat"><div class="num">' + r.implied_per_tvl.toFixed(2) + '×</div><div class="lbl">implied / TVL</div></div>' +
        '<div class="stat"><div class="num">' + r.base_multiple.toFixed(2) + '×</div><div class="lbl">base multiple · ' + r.peer_count + ' peers (' + esc(r.multiple_source) + ')</div></div>' +
        '<div class="stat"><div class="num">' + (r.change_7d == null ? '—' : (r.change_7d >= 0 ? '+' : '') + r.change_7d.toFixed(1) + '%') + '</div><div class="lbl">TVL change, 7d</div></div>' +
      '</div>' +
      '<div class="buildup"><div class="formula">' + moneyFull(r.tvl_usd) + ' × <span>' + r.base_multiple.toFixed(2) + '</span> × <span>' + g.toFixed(3) + '</span> × <span>' + m.toFixed(3) + '</span> = <span>' + moneyFull(r.implied_value_usd) + '</span></div>' +
      '<p>TVL × base multiple × growth factor × maturity factor. Growth comes from the 7-day TVL change, capped and halved; maturity from age, 0.6 for a new protocol up to 1.0 after three years.</p></div>' +
      '<h3>Farm plan — six steps</h3>' +
      '<ol class="plan">' + r.farm_plan.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>' +
      '<p class="lede">Farm plans describe ordinary onchain use. They do not guarantee any airdrop or reward, and most protocols on this board may never issue a token.</p>';
  }

  /* ---- comparables + method ---- */
  function renderComparables() {
    $('comparables').innerHTML = (DATA.comparables || []).map(function (c) {
      return '<tr><td>' + esc(c.name) + '</td><td>' + esc(c.category) + '</td>' +
        '<td class="num">' + money(c.tvl_usd) + '</td><td class="num">' + moneyFull(c.mcap_usd) + '</td>' +
        '<td class="num">' + c.multiple.toFixed(2) + '×</td></tr>';
    }).join('');
  }

  function renderMethod() {
    $('multiples').innerHTML = (DATA.multiples || []).map(function (m) {
      return '<tr><td>' + esc(m.category) + '</td><td class="num">' + m.peer_count + '</td>' +
        '<td class="num">' + m.median_multiple.toFixed(2) + '×</td><td>' + esc(m.source) + '</td></tr>';
    }).join('');
    $('caveats').innerHTML = (DATA.caveats || []).map(function (c) { return '<li>' + esc(c) + '</li>'; }).join('');
  }

  /* ---- sandbox ---- */
  function renderSandbox() {
    var gw = parseFloat($('gw').value);
    var ms = parseFloat($('ms').value);
    $('gw-val').textContent = gw.toFixed(2);
    $('ms-val').textContent = ms.toFixed(2) + '×';
    var rescored = ROWS.map(function (r) {
      var g = 1 + (growthOf(r) - 1) * (gw / 0.5);
      var v = Math.round(r.tvl_usd * r.base_multiple * ms * g * maturityOf(r));
      return { name: r.name, value: v };
    }).sort(function (a, b) { return b.value - a.value; });
    var top = rescored.slice(0, 3).map(function (r) { return r.name + ' (' + money(r.value) + ')'; }).join(', ');
    $('sandbox-out').textContent = 'Sandbox top 3: ' + top + '. Sandbox only — the board above is unchanged.';
  }

  /* ---- routing ---- */
  function show(view) {
    ['board', 'detail', 'comparables', 'method'].forEach(function (v) {
      $('view-' + v).hidden = v !== view;
    });
    document.querySelectorAll('.nav a').forEach(function (a) {
      a.classList.toggle('active', a.getAttribute('data-nav') === (view === 'detail' ? 'board' : view));
    });
  }

  function route() {
    var hash = location.hash || '#board';
    var parts = hash.slice(1).split('?');
    var path = parts[0] || 'board';
    var query = new URLSearchParams(parts[1] || '');
    if (path === 'board') {
      show('board');
      if (query.get('category')) $('category').value = query.get('category');
      if (query.get('chain')) $('chain').value = query.get('chain');
      if (query.get('q')) $('q').value = query.get('q');
      if (query.get('watch')) $('watch').checked = query.get('watch') === '1';
      renderBoard();
    } else if (path.indexOf('p/') === 0) {
      show('detail');
      renderDetail(path.slice(2));
    } else if (path === 'comparables') {
      show('comparables');
    } else if (path === 'method') {
      show('method');
      renderSandbox();
    } else {
      show('board');
      renderBoard();
    }
  }

  /* ---- wire up ---- */
  renderHero();
  initFilters();
  renderComparables();
  renderMethod();
  ['q', 'category', 'chain', 'watch', 'sort'].forEach(function (id) {
    $(id).addEventListener('input', renderBoard);
    $(id).addEventListener('change', renderBoard);
  });
  $('gw').addEventListener('input', renderSandbox);
  $('ms').addEventListener('input', renderSandbox);
  window.addEventListener('hashchange', route);
  route();
})();
