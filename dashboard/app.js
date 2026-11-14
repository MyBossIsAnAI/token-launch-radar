// Token Launch Radar — dashboard logic. No network: every figure comes from
// the data script loaded beside this page, and every view is a hash route.
(function () {
  'use strict';
  var D = window.RADAR;
  if (!D) { document.body.textContent = 'Radar data failed to load.'; return; }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function money(n) {
    if (n == null || !isFinite(n)) return '—';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  }
  function full(n) {
    return '$' + Math.round(n).toLocaleString('en-US');
  }
  function pct(n) {
    if (n == null) return '—';
    var s = (n >= 0 ? '+' : '') + n.toFixed(1) + '%';
    return '<span class="' + (n >= 0 ? 'up' : 'down') + '">' + s + '</span>';
  }
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  var maxImplied = D.rows.length ? D.rows[0].implied_value_usd : 1;
  var watchCount = D.rows.filter(function (r) { return r.watchlist; }).length;

  // ------------------------------------------------------------ hero
  document.getElementById('hero').innerHTML =
    stat('Protocols scanned', String(D.protocols_scanned)) +
    stat('Rows ranked', String(D.board_size)) +
    stat('Watchlist covered', watchCount + ' / ' + D.watchlist_size) +
    stat('Combined implied', money(D.combined_implied_usd)) +
    stat('Live comparables', String(D.live_size));
  function stat(k, v) {
    return '<div class="stat"><div class="k">' + esc(k) + '</div><div class="v">' + esc(v) + '</div></div>';
  }
  document.getElementById('asof').textContent = D.as_of;

  // ------------------------------------------------------------ filters
  var cats = [];
  var chains = [];
  D.rows.forEach(function (r) {
    if (r.category && cats.indexOf(r.category) < 0) cats.push(r.category);
    r.chains.forEach(function (c) { if (chains.indexOf(c) < 0) chains.push(c); });
  });
  cats.sort(); chains.sort();
  var catSel = document.getElementById('f-cat');
  cats.forEach(function (c) { catSel.add(new Option(c, c)); });
  var chainSel = document.getElementById('f-chain');
  chains.forEach(function (c) { chainSel.add(new Option(c, c)); });

  var qEl = document.getElementById('q');
  var watchEl = document.getElementById('f-watch');
  var sortEl = document.getElementById('f-sort');

  function readHash() {
    var raw = location.hash || '#board';
    var hash = raw.slice(1);
    var qi = hash.indexOf('?');
    var path = qi >= 0 ? hash.slice(0, qi) : hash;
    var query = qi >= 0 ? new URLSearchParams(hash.slice(qi + 1)) : new URLSearchParams();
    return { path: path, query: query };
  }
  function boardParams() {
    var h = readHash();
    return {
      q: h.query.get('q') || '',
      category: h.query.get('category') || '',
      chain: h.query.get('chain') || '',
      watch: h.query.get('watch') === '1',
      sort: h.query.get('sort') || 'implied'
    };
  }
  function pushBoard(p) {
    var qs = new URLSearchParams();
    if (p.q) qs.set('q', p.q);
    if (p.category) qs.set('category', p.category);
    if (p.chain) qs.set('chain', p.chain);
    if (p.watch) qs.set('watch', '1');
    if (p.sort && p.sort !== 'implied') qs.set('sort', p.sort);
    var s = qs.toString();
    location.hash = '#board' + (s ? '?' + s : '');
  }
  function sortRows(rows, sort) {
    var r = rows.slice();
    if (sort === 'tvl') r.sort(function (a, b) { return b.tvl_usd - a.tvl_usd; });
    else if (sort === 'change') r.sort(function (a, b) { return (b.change_7d == null ? -1e9 : b.change_7d) - (a.change_7d == null ? -1e9 : a.change_7d); });
    else if (sort === 'multiple') r.sort(function (a, b) { return b.base_multiple - a.base_multiple; });
    else if (sort === 'age') r.sort(function (a, b) { return (b.age_days == null ? -1 : b.age_days) - (a.age_days == null ? -1 : a.age_days); });
    else r.sort(function (a, b) { return b.implied_value_usd - a.implied_value_usd; });
    return r;
  }

  function renderBoard() {
    var p = boardParams();
    qEl.value = p.q; catSel.value = p.category; chainSel.value = p.chain;
    watchEl.checked = p.watch; sortEl.value = p.sort;
    var q = p.q.trim().toLowerCase();
    var rows = D.rows.filter(function (r) {
      if (p.watch && !r.watchlist) return false;
      if (p.category && r.category !== p.category) return false;
      if (p.chain && r.chains.indexOf(p.chain) < 0) return false;
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    rows = sortRows(rows, p.sort);
    document.getElementById('count').textContent =
      rows.length + ' of ' + D.board_size + ' rows' +
      (p.watch ? ' · watchlist only' : '') +
      (p.category ? ' · ' + p.category : '') +
      (p.chain ? ' · ' + p.chain : '');
    var html = rows.map(function (r) {
      var w = Math.max(1, Math.round(100 * r.implied_value_usd / maxImplied));
      var chainTxt = r.chains.slice(0, 2).join(', ') + (r.chains.length > 2 ? ' +' + (r.chains.length - 2) : '');
      return '<tr><td>' + r.rank + '</td>' +
        '<td><a class="rowlink" href="#p/' + esc(r.slug) + '">' + esc(r.name) + '</a>' +
        (r.watchlist ? '<span class="badge">WATCH</span>' : '') +
        '<div class="cat">' + esc(r.category || 'Uncategorised') + '</div></td>' +
        '<td>' + esc(chainTxt) + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num">' + pct(r.change_7d) + '</td>' +
        '<td class="num">' + money(r.implied_value_usd) + '<div class="bar"><i style="width:' + w + '%"></i></div></td>' +
        '<td class="num">' + r.implied_per_tvl.toFixed(2) + 'x</td>' +
        '<td class="num">' + r.base_multiple.toFixed(3) + 'x<div class="cat">' + r.peer_count + ' peers · ' + esc(r.multiple_source) + '</div></td></tr>';
    }).join('');
    document.querySelector('#board-table tbody').innerHTML = html || '<tr><td colspan="8">No protocols match these filters.</td></tr>';
  }

  var debounce = null;
  qEl.addEventListener('input', function () {
    clearTimeout(debounce);
    debounce = setTimeout(function () { pushBoard(Object.assign(boardParams(), { q: qEl.value })); }, 250);
  });
  catSel.addEventListener('change', function () { pushBoard(Object.assign(boardParams(), { category: catSel.value })); });
  chainSel.addEventListener('change', function () { pushBoard(Object.assign(boardParams(), { chain: chainSel.value })); });
  watchEl.addEventListener('change', function () { pushBoard(Object.assign(boardParams(), { watch: watchEl.checked })); });
  sortEl.addEventListener('change', function () { pushBoard(Object.assign(boardParams(), { sort: sortEl.value })); });

  // ------------------------------------------------------------ detail
  function renderDetail(slug) {
    var r = null;
    D.rows.forEach(function (x) { if (x.slug === slug) r = x; });
    var el = document.getElementById('view-detail');
    if (!r) { el.innerHTML = '<p><a class="back" href="#board">← Back to the board</a></p><h2>Protocol not found</h2><p>No row on this board has the slug “' + esc(slug) + '”.</p>'; return; }
    var age = r.age_days == null ? 'unknown' : r.age_days + ' days';
    var steps = r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
    el.innerHTML =
      '<p><a class="back" href="#board">← Back to the board</a></p>' +
      '<h2>' + esc(r.name) + (r.watchlist ? '<span class="badge">WATCHLIST</span>' : '') + '</h2>' +
      '<p class="cat">' + esc(r.category || 'Uncategorised') + ' · ' + esc(r.chains.join(', ') || 'no chain listed') + ' · rank #' + r.rank + ' of ' + D.board_size + '</p>' +
      '<div class="tiles">' +
      stat('TVL', money(r.tvl_usd)) +
      stat('7d change', r.change_7d == null ? '—' : (r.change_7d >= 0 ? '+' : '') + r.change_7d.toFixed(1) + '%') +
      stat('Implied value', money(r.implied_value_usd)) +
      stat('Age', age) +
      '</div>' +
      '<div class="buildup"><div class="k">How the implied value is built</div>' +
      '<div class="eq">' + money(r.tvl_usd) + ' × ' + r.base_multiple.toFixed(3) + ' × ' + r.growth_multiplier.toFixed(2) + ' × ' + r.maturity_multiplier.toFixed(2) + ' = ' + full(r.implied_value_usd) + '</div>' +
      '<div class="parts">TVL × base multiple × growth × maturity. Base multiple ' + r.base_multiple.toFixed(3) +
      'x from ' + r.peer_count + ' peers (' + esc(r.multiple_source) + '). Growth ' + r.growth_multiplier.toFixed(2) +
      'x on a 7d change of ' + (r.change_7d == null ? 'not reported' : r.change_7d.toFixed(1) + '%') +
      '. Maturity ' + r.maturity_multiplier.toFixed(2) + 'x on ' + age + ' of track record.</div></div>' +
      '<h3>Farm plan — six steps</h3>' +
      '<ol class="plan">' + steps + '</ol>' +
      '<p class="note">This plan is generic guidance, not financial advice. ' + esc(r.name) +
      ' records no token in the snapshot; that is not proof it has none, and it may never issue one.</p>';
  }

  // ------------------------------------------------------------ live
  function renderLive() {
    var html = D.live.map(function (p) {
      return '<tr><td><strong>' + esc(p.name) + '</strong><div class="cat">' + esc(p.category || 'Uncategorised') + '</div></td>' +
        '<td>' + esc(p.category || 'Uncategorised') + '</td>' +
        '<td class="num">' + money(p.tvl_usd) + '</td>' +
        '<td class="num">' + money(p.mcap_usd) + '</td>' +
        '<td class="num">' + p.multiple.toFixed(3) + 'x</td></tr>';
    }).join('');
    document.querySelector('#live-table tbody').innerHTML = html;
  }

  // ------------------------------------------------------------ method + sandbox
  function renderMethod() {
    var m = D.model;
    var multRows = D.multiples.map(function (x) {
      return '<tr><td>' + esc(x.category) + '</td><td class="num">' + x.peers + '</td><td class="num">' + x.multiple.toFixed(3) + 'x</td><td>' + esc(x.source) + '</td></tr>';
    }).join('');
    var caves = D.caveats.map(function (c) { return '<li>' + esc(c) + '</li>'; }).join('');
    document.getElementById('method-body').innerHTML =
      '<div class="formula"><strong>implied = TVL × base multiple × growth × maturity</strong><br>' +
      'growth = 1 + clamp(7d change, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 × ' + m.growth_weight + '<br>' +
      'maturity = ' + m.maturity_floor + ' + min(age, ' + m.maturity_days + ') / ' + m.maturity_days + ' × ' + m.maturity_range +
      ' (unknown age: ' + m.unknown_age_days + ' days)<br>' +
      'A category’s base multiple is the median mcap / TVL of its traded peers when it has at least ' + m.min_peers +
      ' (ratios kept only when 0 &lt; ratio ≤ ' + m.peer_ratio_cap + ', CEX excluded); otherwise its family median, otherwise the whole-market median.</div>' +
      '<h3>Multiples by category</h3>' +
      '<div class="tablewrap"><table><thead><tr><th>Category</th><th class="num">Peers</th><th class="num">Multiple</th><th>Source</th></tr></thead><tbody>' + multRows + '</tbody></table></div>' +
      '<h3>Caveats</h3><ul class="caveats">' + caves + '</ul>';
    renderSandbox();
  }

  var gwEl = document.getElementById('gw');
  var msEl = document.getElementById('ms');
  function renderSandbox() {
    var gw = parseFloat(gwEl.value);
    var ms = parseFloat(msEl.value);
    document.getElementById('gw-val').textContent = gw.toFixed(2);
    document.getElementById('ms-val').textContent = ms.toFixed(2);
    var sand = D.rows.map(function (r) {
      var g = 1 + clamp(r.change_7d == null ? 0 : r.change_7d, D.model.growth_floor, D.model.growth_cap) / 100 * gw;
      var imp = Math.max(1, Math.round(r.tvl_usd * r.base_multiple * ms * g * r.maturity_multiplier));
      return { r: r, imp: imp };
    });
    sand.sort(function (a, b) { return b.imp - a.imp || (a.r.slug < b.r.slug ? -1 : 1); });
    document.getElementById('sandbox-count').textContent =
      'Sandbox re-ranking with growth weight ' + gw.toFixed(2) + ' and multiple scale ' + ms.toFixed(2) +
      ' — the official board above is unchanged.';
    var html = sand.map(function (x, i) {
      return '<tr><td>' + (i + 1) + '</td>' +
        '<td><a class="rowlink" href="#p/' + esc(x.r.slug) + '">' + esc(x.r.name) + '</a></td>' +
        '<td class="num">' + money(x.r.tvl_usd) + '</td>' +
        '<td class="num">' + money(x.imp) + '</td>' +
        '<td class="num">#' + x.r.rank + '</td></tr>';
    }).join('');
    document.querySelector('#sandbox-board tbody').innerHTML = html;
  }
  gwEl.addEventListener('input', renderSandbox);
  msEl.addEventListener('input', renderSandbox);

  // ------------------------------------------------------------ router
  function route() {
    var h = readHash();
    var views = ['board', 'detail', 'live', 'method'];
    views.forEach(function (v) { document.getElementById('view-' + v).hidden = true; });
    document.querySelectorAll('.nav a').forEach(function (a) { a.classList.remove('active'); });
    if (h.path === 'live') {
      document.getElementById('view-live').hidden = false;
      document.querySelector('[data-nav="live"]').classList.add('active');
      renderLive();
    } else if (h.path === 'method') {
      document.getElementById('view-method').hidden = false;
      document.querySelector('[data-nav="method"]').classList.add('active');
      renderMethod();
    } else if (h.path.indexOf('p/') === 0) {
      document.getElementById('view-detail').hidden = false;
      renderDetail(h.path.slice(2));
    } else {
      document.getElementById('view-board').hidden = false;
      document.querySelector('[data-nav="board"]').classList.add('active');
      renderBoard();
    }
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', route);
  route();
})();
