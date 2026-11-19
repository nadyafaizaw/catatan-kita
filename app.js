(function () {
'use strict';

/* ---------- util ---------- */
var $ = function (s, el) { return (el || document).querySelector(s); };
var $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };
var MONTHS = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
var DAYS = ['Min','Sen','Sel','Rab','Kam','Jum','Sab'];
var PALETTE = ['#4f7cff','#22d3c5','#ff6fa8','#8b7bff','#ffb454','#6cc4f5','#9bd13f'];
var ICONS = {'Makan & Cafe':'☕','Nonton & Hiburan':'🎬','Transport':'🚗','Belanja & Hadiah':'🛍️','Staycation/Hotel':'🏨','Lain-lain':'✨'};
var PERIODS = [['today','Hari ini'],['week','Minggu ini'],['month','Bulan ini'],['all','Semua'],['custom','Custom']];

var S = { data: null, tab: 'home', period: 'month', cFrom: '', cTo: '', trend: 'auto',
          hist: { q: '', cat: '', from: '', to: '', limit: 40 }, form: false, loadedAt: 0, anim: '' };

var pad = function (n) { return (n < 10 ? '0' : '') + n; };
var iso = function (d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
var fromISO = function (s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2], 12); };
var addDays = function (d, n) { var x = new Date(d.getTime()); x.setDate(x.getDate() + n); return x; };
var today = function () { var d = new Date(); d.setHours(12, 0, 0, 0); return d; };
var daysBetween = function (a, b) { return Math.round((fromISO(b) - fromISO(a)) / 864e5); };
var fmtDate = function (s) { var d = fromISO(s); return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear(); };
var fmtShort = function (s) { var d = fromISO(s); return d.getDate() + ' ' + MONTHS[d.getMonth()]; };
var fmtDay = function (s) { var d = fromISO(s); return DAYS[d.getDay()] + ', ' + d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear(); };
var rp = function (n) { return 'Rp ' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.'); };
var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); };
var lsGet = function (k) { try { return localStorage.getItem('ck_' + k); } catch (e) { return null; } };
var lsSet = function (k, v) { try { localStorage.setItem('ck_' + k, v); } catch (e) {} };

function api(action, payload) {
  var url = (window.APP_CONFIG || {}).API_URL;
  if (!url || url.indexOf('GANTI') === 0) return Promise.reject(new Error('config.js belum diisi alamat Apps Script.'));
  var ctrl = new AbortController(), to = setTimeout(function () { ctrl.abort(); }, 30000);
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ secret: lsGet('secret') || '', action: action, payload: payload || null }),
    signal: ctrl.signal, redirect: 'follow'
  }).then(function (r) {
    clearTimeout(to);
    if (!r.ok) throw new Error('Server error (' + r.status + ')');
    return r.json();
  }, function (e) {
    clearTimeout(to);
    if (e && e.name === 'AbortError') throw new Error('Koneksi terlalu lama. Coba lagi.');
    throw new Error('Tidak ada koneksi internet.');
  }).then(function (j) {
    if (!j.ok) { var err = new Error(j.error || 'Terjadi kesalahan'); err.code = j.code; throw err; }
    var d = j.data;
    if (d && d.transactions) { d.me = lsGet('me') || ''; try { lsSet('cache', JSON.stringify(d)); } catch (x) {} }
    return d;
  });
}

var toastT;
function toast(msg, type) {
  var t = $('#toast'); t.textContent = msg; t.className = 'toast show ' + (type || '');
  clearTimeout(toastT); toastT = setTimeout(function () { t.className = 'toast'; }, 3000);
}

/* ---------- data helpers ---------- */
var txs = function () { return S.data ? S.data.transactions : []; };
var inR = function (t, a, b) { return (!a || t.date >= a) && (!b || t.date <= b); };
var icon = function (c) { return ICONS[c] || '🧾'; };
var catColor = function (c) { var i = S.data.categories.indexOf(c); return PALETTE[(i < 0 ? 6 : i) % PALETTE.length]; };
var payerLabel = function (k) {
  if (!k) return 'Tanpa nama';
  var p = S.data.payers.filter(function (x) { return x.key === k; })[0];
  return p ? p.label : k;
};
var payerColor = function (k) {
  var i = S.data.payers.map(function (x) { return x.key; }).indexOf(k);
  return ['#4f7cff', '#ff6fa8', '#22d3c5'][i < 0 ? 0 : i % 3] || '#8b7bff';
};
var sortedObj = function (o) { return Object.keys(o).map(function (k) { return { k: k, v: o[k] }; }).sort(function (a, b) { return b.v - a.v; }); };

function stats(list) {
  var o = { total: 0, count: list.length, cat: {}, pay: {}, day: {}, max: null };
  list.forEach(function (t) {
    o.total += t.amount;
    o.cat[t.category] = (o.cat[t.category] || 0) + t.amount;
    o.pay[t.payer] = (o.pay[t.payer] || 0) + t.amount;
    o.day[t.date] = (o.day[t.date] || 0) + t.amount;
    if (!o.max || t.amount > o.max.amount) o.max = t;
  });
  return o;
}

function period() {
  var t = today(), a = null, b = null, pa = null, pb = null, label = 'Semua waktu';
  if (S.period === 'today') { a = b = iso(t); pa = pb = iso(addDays(t, -1)); label = 'Hari ini'; }
  else if (S.period === 'week') {
    var dow = (t.getDay() + 6) % 7, s = addDays(t, -dow), ps = addDays(s, -7);
    a = iso(s); b = iso(t); pa = iso(ps); pb = iso(addDays(ps, dow)); label = 'Minggu ini';
  } else if (S.period === 'month') {
    var f = new Date(t.getFullYear(), t.getMonth(), 1, 12), pf = new Date(t.getFullYear(), t.getMonth() - 1, 1, 12);
    var lastPrev = new Date(t.getFullYear(), t.getMonth(), 0, 12).getDate();
    a = iso(f); b = iso(t); pa = iso(pf);
    pb = iso(new Date(pf.getFullYear(), pf.getMonth(), Math.min(t.getDate(), lastPrev), 12));
    label = 'Bulan ' + MONTHS[t.getMonth()] + ' ' + t.getFullYear();
  } else if (S.period === 'custom' && S.cFrom && S.cTo) {
    a = S.cFrom <= S.cTo ? S.cFrom : S.cTo; b = S.cFrom <= S.cTo ? S.cTo : S.cFrom;
    var len = daysBetween(a, b) + 1;
    pb = iso(addDays(fromISO(a), -1)); pa = iso(addDays(fromISO(a), -len));
    label = fmtShort(a) + ' – ' + fmtShort(b);
  } else if (S.period === 'custom') { label = 'Pilih tanggal'; }
  return { a: a, b: b, pa: pa, pb: pb, label: label };
}

function currentView() {
  var r = period(), list = txs().filter(function (t) { return inR(t, r.a, r.b); });
  var cur = stats(list);
  var prev = r.pa ? stats(txs().filter(function (t) { return inR(t, r.pa, r.pb); })) : null;
  var days;
  if (r.a) days = Math.max(1, daysBetween(r.a, r.b) + 1);
  else if (txs().length) {
    var min = txs().reduce(function (m, t) { return t.date < m ? t.date : m; }, txs()[0].date);
    days = Math.max(1, daysBetween(min, iso(today())) + 1);
  } else days = 1;
  return { r: r, list: list, cur: cur, prev: prev, days: days };
}

function deltaChip(cur, prev) {
  if (!prev) return '';
  if (prev.total <= 0) return '<span class="delta">Belum ada data periode lalu</span>';
  var pct = (cur.total - prev.total) / prev.total * 100;
  if (Math.abs(pct) < 0.5) return '<span class="delta">Sama seperti periode lalu</span>';
  return pct > 0
    ? '<span class="delta up">▲ ' + Math.round(pct) + '% vs periode lalu</span>'
    : '<span class="delta down">▼ ' + Math.round(-pct) + '% vs periode lalu</span>';
}

/* ---------- komponen tampilan ---------- */
function emptyState(msg) {
  return '<div class="empty glass"><div class="emo">🌱</div><b>' + esc(msg || 'Belum ada transaksi') + '</b>' +
    '<p>Catat pengeluaran pertama dalam hitungan detik.</p>' +
    '<button class="primary" data-act="add">+ Tambah Transaksi</button></div>';
}

function periodChips() {
  var h = '<div class="chips-row">' + PERIODS.map(function (p) {
    return '<button class="chip' + (S.period === p[0] ? ' on' : '') + '" data-period="' + p[0] + '">' + p[1] + '</button>';
  }).join('') + '</div>';
  if (S.period === 'custom') {
    h += '<div class="custom-range"><input class="field" type="date" id="c-from" value="' + esc(S.cFrom) + '" aria-label="Dari tanggal">' +
         '<input class="field" type="date" id="c-to" value="' + esc(S.cTo) + '" aria-label="Sampai tanggal"></div>';
  }
  return h;
}

function txItem(t) {
  var sub = esc(t.category) + ' · ' + esc(payerLabel(t.payer)) + (t.note ? ' · ' + esc(t.note) : '');
  return '<button class="tx" data-row="' + t.row + '"><span class="ico">' + icon(t.category) + '</span>' +
    '<span class="tx-main"><b>' + esc(t.name || t.category) + '</b><small>' + sub + '</small></span>' +
    '<span class="amt">' + rp(t.amount) + '</span></button>';
}

function groupedList(list) {
  var by = {}, order = [];
  list.forEach(function (t) { if (!by[t.date]) { by[t.date] = []; order.push(t.date); } by[t.date].push(t); });
  return order.map(function (d) {
    var sum = by[d].reduce(function (s, t) { return s + t.amount; }, 0);
    return '<div class="day"><span>' + fmtDay(d) + '</span><span>' + rp(sum) + '</span></div>' +
      by[d].slice().sort(function (a, b) { return b.row - a.row; }).map(txItem).join('');
  }).join('');
}

function payerStack(cur) {
  var items = sortedObj(cur.pay);
  if (!items.length || !cur.total) return '';
  return '<div class="stack">' + items.map(function (e) {
    return '<i style="width:' + (e.v / cur.total * 100) + '%;background:' + payerColor(e.k) + '"></i>';
  }).join('') + '</div><div class="legend">' + items.map(function (e) {
    return '<div class="lg"><i class="dot" style="background:' + payerColor(e.k) + '"></i><span>' + esc(payerLabel(e.k)) +
      '</span><b>' + rp(e.v) + '</b><small>' + Math.round(e.v / cur.total * 100) + '%</small></div>';
  }).join('') + '</div>';
}

function donut(cur) {
  var items = sortedObj(cur.cat), acc = 0;
  var stops = items.map(function (e) {
    var a = acc / cur.total * 100; acc += e.v; var b = acc / cur.total * 100;
    return catColor(e.k) + ' ' + a + '% ' + b + '%';
  });
  return '<div class="donut-wrap"><div class="donut" style="background:conic-gradient(' + stops.join(',') + ')">' +
    '<div class="donut-in"><small>Total</small><b>' + rp(cur.total) + '</b></div></div></div>';
}

function catBars(cur) {
  var items = sortedObj(cur.cat);
  return items.map(function (e) {
    var pct = e.v / cur.total * 100;
    return '<div class="catrow"><div class="l"><span>' + icon(e.k) + ' ' + esc(e.k) + '</span><span><b>' + rp(e.v) +
      '</b><small>' + pct.toFixed(1).replace('.', ',') + '%</small></span></div>' +
      '<div class="bar"><i style="width:' + pct + '%;background:' + catColor(e.k) + '"></i></div></div>';
  }).join('');
}

function trendChart(v) {
  var mode = S.trend === 'auto' ? ((v.r.a && v.days <= 31) ? 'day' : 'month') : S.trend;
  if (mode === 'day' && !v.r.a) mode = 'month';
  var buckets = [], map = {};
  if (mode === 'day') {
    var d = fromISO(v.r.a), end = fromISO(v.r.b > iso(today()) ? iso(today()) : v.r.b), n = 0;
    while (d <= end && n < 120) { var k = iso(d); buckets.push({ k: k, label: String(d.getDate()), v: 0 }); map[k] = buckets[buckets.length - 1]; d = addDays(d, 1); n++; }
    v.list.forEach(function (t) { if (map[t.date]) map[t.date].v += t.amount; });
  } else {
    var dates = v.list.map(function (t) { return t.date; }).sort();
    if (dates.length) {
      var s = fromISO(dates[0]), e = fromISO(dates[dates.length - 1]);
      var cur = new Date(s.getFullYear(), s.getMonth(), 1, 12), last = new Date(e.getFullYear(), e.getMonth(), 1, 12), guard = 0;
      while (cur <= last && guard < 60) {
        var key = cur.getFullYear() + '-' + pad(cur.getMonth() + 1);
        buckets.push({ k: key, label: MONTHS[cur.getMonth()], v: 0 }); map[key] = buckets[buckets.length - 1];
        cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1, 12); guard++;
      }
      v.list.forEach(function (t) { map[t.date.slice(0, 7)].v += t.amount; });
    }
  }
  var max = buckets.reduce(function (m, b) { return Math.max(m, b.v); }, 0);
  var head = '<div class="trend-head"><h3>Tren pengeluaran</h3><div class="seg-mini">' +
    '<button data-act="trend" data-v="day" class="' + (mode === 'day' ? 'on' : '') + '">Harian</button>' +
    '<button data-act="trend" data-v="month" class="' + (mode === 'month' ? 'on' : '') + '">Bulanan</button></div></div>';
  if (!buckets.length || !max) return '<div class="card glass trend">' + head + '<p class="peak">Belum ada data untuk digambar.</p></div>';
  var W = 320, H = 150, padB = 18, padT = 8, n2 = buckets.length, bw = W / n2;
  var step = Math.max(1, Math.ceil(n2 / 8)), peak = buckets.reduce(function (m, b) { return b.v > m.v ? b : m; }, buckets[0]);
  var bars = buckets.map(function (b, i) {
    var h = b.v / max * (H - padB - padT), x = i * bw + bw * 0.16, w = Math.max(2, bw * 0.68), y = H - padB - h;
    return (b.v ? '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="' + Math.min(5, w / 2).toFixed(1) + '" fill="url(#tg)"><title>' + esc(b.label) + ': ' + rp(b.v) + '</title></rect>'
      : '<rect x="' + x.toFixed(1) + '" y="' + (H - padB - 2) + '" width="' + w.toFixed(1) + '" height="2" rx="1" fill="rgba(15,27,45,.08)"/>') +
      (i % step === 0 ? '<text x="' + (x + w / 2).toFixed(1) + '" y="' + (H - 4) + '" text-anchor="middle">' + esc(b.label) + '</text>' : '');
  }).join('');
  var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Grafik tren pengeluaran"><defs><linearGradient id="tg" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0" stop-color="#4f7cff"/><stop offset="1" stop-color="#22d3c5"/></linearGradient></defs>' + bars + '</svg>';
  var peakLabel = mode === 'day' ? fmtShort(peak.k) : peak.label;
  return '<div class="card glass trend">' + head + svg + '<p class="peak">Tertinggi: <b>' + rp(peak.v) + '</b> (' + esc(peakLabel) + ')</p></div>';
}

/* ---------- halaman ---------- */
function header() {
  var me = S.data ? payerLabel(S.data.me) : '';
  var t = today();
  var h = '<div><h1>' + (me && me !== 'Tanpa nama' ? 'Halo, ' + esc(me) + ' 👋' : 'Catatan Kita') + '</h1><p>' +
    DAYS[t.getDay()] + ', ' + t.getDate() + ' ' + MONTHS[t.getMonth()] + ' ' + t.getFullYear() + '</p></div>' +
    '<div class="hbtns"><button class="icon-btn" data-act="refresh" aria-label="Muat ulang"><svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-3-6.7M21 4v5h-5"/></svg></button>' +
    '<button class="icon-btn" data-act="settings" aria-label="Pengaturan"><svg viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></button></div>';
  $('#hdr').innerHTML = h;
}

function viewHome() {
  var v = currentView(), c = v.cur;
  var hero = '<section class="hero"><div class="hero-top"><span>Total pengeluaran</span><span class="pill">' + esc(v.r.label) + '</span></div>' +
    '<div class="hero-amount" id="hero-amt">' + rp(c.total) + '</div>' +
    '<div class="hero-meta">' + deltaChip(c, v.prev) + '<span>' + c.count + ' transaksi</span></div>' +
    '<div class="hero-mini"><div><small>Rata-rata / hari</small><b>' + rp(c.total / v.days) + '</b></div>' +
    '<div><small>Terbesar</small><b>' + (c.max ? rp(c.max.amount) : '–') + '</b></div></div></section>';
  var h = hero + periodChips();
  if (!c.count) return h + emptyState(txs().length ? 'Tidak ada transaksi di periode ini' : 'Belum ada transaksi');

  var topCat = sortedObj(c.cat)[0], topPay = sortedObj(c.pay)[0];
  h += '<div class="grid2"><div class="glass mini"><small>Kategori terbesar</small><b>' + icon(topCat.k) + ' ' + esc(topCat.k) + '</b><em>' +
    rp(topCat.v) + ' · ' + Math.round(topCat.v / c.total * 100) + '%</em></div>' +
    '<div class="glass mini"><small>Paling banyak bayar</small><b>' + esc(payerLabel(topPay.k)) + '</b><em>' + rp(topPay.v) + '</em></div></div>';
  h += '<div class="card glass"><h3>Siapa yang membayar</h3>' + payerStack(c) + '</div>';
  var recent = v.list.slice().sort(function (a, b) { return b.date === a.date ? b.row - a.row : (b.date > a.date ? 1 : -1); }).slice(0, 5);
  h += '<div class="sec"><h2>Terbaru</h2><button class="link" data-tab="hist">Lihat semua</button></div>' + recent.map(txItem).join('');
  return h;
}

function histFiltered() {
  var f = S.hist, q = f.q.trim().toLowerCase();
  return txs().filter(function (t) {
    if (f.cat && t.category !== f.cat) return false;
    if (f.from && t.date < f.from) return false;
    if (f.to && t.date > f.to) return false;
    if (q && (t.name + ' ' + t.note + ' ' + t.category + ' ' + payerLabel(t.payer)).toLowerCase().indexOf(q) === -1) return false;
    return true;
  }).sort(function (a, b) { return a.date === b.date ? b.row - a.row : (a.date < b.date ? 1 : -1); });
}

function histList() {
  var list = histFiltered();
  if (!list.length) return txs().length
    ? '<div class="empty glass"><div class="emo">🔍</div><b>Tidak ada yang cocok</b><p>Coba ubah kata kunci atau filter.</p><button class="ghost" data-act="reset">Reset filter</button></div>'
    : emptyState();
  var shown = list.slice(0, S.hist.limit), total = list.reduce(function (s, t) { return s + t.amount; }, 0);
  return '<p style="margin:4px 4px 0;font-size:13px;color:var(--mute)">' + list.length + ' transaksi · ' + rp(total) + '</p>' +
    groupedList(shown) +
    (list.length > shown.length ? '<div style="text-align:center;margin-top:10px"><button class="ghost" data-act="more">Muat lebih banyak</button></div>' : '');
}

function viewHist() {
  var f = S.hist;
  return '<div class="filters"><div class="search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>' +
    '<input class="field" id="h-q" type="search" placeholder="Cari tempat, catatan, kategori…" value="' + esc(f.q) + '"></div>' +
    '<div class="frow"><select class="field" id="h-cat" aria-label="Kategori"><option value="">Semua kategori</option>' +
    S.data.categories.map(function (c) { return '<option' + (f.cat === c ? ' selected' : '') + ' value="' + esc(c) + '">' + esc(c) + '</option>'; }).join('') +
    '</select><input class="field" id="h-from" type="date" value="' + esc(f.from) + '" aria-label="Dari"><input class="field" id="h-to" type="date" value="' + esc(f.to) + '" aria-label="Sampai"></div>' +
    '<button class="reset" id="h-reset" data-act="reset"' + ((f.q || f.cat || f.from || f.to) ? '' : ' hidden') + '>Reset filter</button></div>' +
    '<div id="hist-list">' + histList() + '</div>';
}

function viewChart() {
  var v = currentView();
  var h = periodChips();
  if (!v.cur.count) return h + emptyState(txs().length ? 'Tidak ada data di periode ini' : 'Belum ada transaksi');
  h += '<div class="card glass"><h3>Pengeluaran per kategori</h3>' + donut(v.cur) + catBars(v.cur) + '</div>';
  h += trendChart(v);
  h += '<div class="card glass"><h3>Siapa yang membayar</h3>' + payerStack(v.cur) + '</div>';
  return h;
}

function insightCard(e, title, body) {
  return '<div class="ins glass"><div class="e">' + e + '</div><div><h4>' + title + '</h4><p>' + body + '</p></div></div>';
}

function viewInsight() {
  var v = currentView(), c = v.cur, h = periodChips();
  if (!c.count) return h + emptyState(txs().length ? 'Tidak ada data di periode ini' : 'Belum ada transaksi');
  var topCat = sortedObj(c.cat)[0];
  h += insightCard('🏆', 'Kategori terbesar', '<b>' + esc(topCat.k) + '</b> menghabiskan ' + rp(topCat.v) + ' (' + Math.round(topCat.v / c.total * 100) + '% dari total).');

  var nad = S.data.payers[0], gar = S.data.payers[1];
  if (nad && gar) {
    var a = c.pay[nad.key] || 0, b = c.pay[gar.key] || 0, bersama = c.pay['Bersama'] || 0;
    var body;
    if (a === b) body = 'Seimbang: ' + esc(nad.label) + ' dan ' + esc(gar.label) + ' sama-sama ' + rp(a) + '.';
    else {
      var big = a > b ? nad : gar, small = a > b ? gar : nad;
      body = '<b>' + esc(big.label) + '</b> membayar ' + rp(Math.abs(a - b)) + ' lebih banyak dari ' + esc(small.label) +
        '.<br><small>' + esc(nad.label) + ' ' + rp(a) + ' · ' + esc(gar.label) + ' ' + rp(b) + (bersama ? ' · Bersama ' + rp(bersama) : '') + '</small>';
    }
    h += insightCard('💑', 'Siapa yang membayar', body);
  }

  if (v.prev && v.prev.total > 0) {
    var pct = (c.total - v.prev.total) / v.prev.total * 100, diff = c.total - v.prev.total;
    var body2 = (pct >= 0 ? '<span class="up-t">Naik ' : '<span class="down-t">Turun ') + Math.abs(Math.round(pct)) + '%</span> (' + (diff >= 0 ? '+' : '−') + rp(Math.abs(diff)) + ') dibanding periode sebelumnya yang sebesar ' + rp(v.prev.total) + '.';
    var cats = {}; Object.keys(c.cat).forEach(function (k) { cats[k] = (c.cat[k] || 0) - (v.prev.cat[k] || 0); });
    Object.keys(v.prev.cat).forEach(function (k) { if (!(k in cats)) cats[k] = -v.prev.cat[k]; });
    var ch = Object.keys(cats).map(function (k) { return { k: k, v: cats[k] }; }).filter(function (x) { return x.v !== 0; })
      .sort(function (x, y) { return Math.abs(y.v) - Math.abs(x.v); }).slice(0, 3);
    if (ch.length) body2 += '<br><small>' + ch.map(function (x) { return esc(x.k) + ' ' + (x.v > 0 ? '+' : '−') + rp(Math.abs(x.v)); }).join(' · ') + '</small>';
    h += insightCard('📈', 'Dibanding periode lalu', body2);
  } else if (v.prev) {
    h += insightCard('📈', 'Dibanding periode lalu', 'Belum ada data di periode sebelumnya untuk dibandingkan.');
  }

  if (c.max) h += insightCard('💸', 'Transaksi terbesar', '<b>' + esc(c.max.name || c.max.category) + '</b> sebesar ' + rp(c.max.amount) + '<br><small>' + fmtDate(c.max.date) + ' · dibayar ' + esc(payerLabel(c.max.payer)) + '</small>');
  var topDay = sortedObj(c.day)[0];
  if (topDay) h += insightCard('📅', 'Hari paling boros', '<b>' + fmtDay(topDay.k) + '</b> dengan total ' + rp(topDay.v) + '.');
  var avg = c.total / v.days, extra = '';
  if (S.period === 'month') {
    var t = today(), dim = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
    extra = '<br><small>Jika tempo ini berlanjut, perkiraan total bulan ini ' + rp(avg * dim) + '.</small>';
  }
  h += insightCard('⏱️', 'Rata-rata per hari', '<b>' + rp(avg) + '</b> dalam ' + v.days + ' hari.' + extra);
  return h;
}

function skeleton() {
  return '<div class="sk" style="height:190px"></div><div class="sk" style="height:44px"></div>' +
    '<div class="grid2"><div class="sk" style="height:90px;margin:0"></div><div class="sk" style="height:90px;margin:0"></div></div>' +
    '<div class="sk" style="height:70px"></div><div class="sk" style="height:70px"></div>';
}

function errorView(msg) {
  return '<div class="empty glass"><div class="emo">😕</div><b>Gagal memuat data</b><p>' + esc(msg) + '</p><button class="primary" data-act="retry">Coba lagi</button></div>';
}

function render() {
  var view = $('#view');
  if (!S.data) { view.innerHTML = skeleton(); return; }
  header();
  var fn = { home: viewHome, hist: viewHist, chart: viewChart, ins: viewInsight }[S.tab];
  view.innerHTML = '<div class="view-in">' + fn() + '</div>';
  $$('.nav-btn').forEach(function (b) { b.classList.toggle('on', b.dataset.tab === S.tab); });
  if (S.tab === 'home') {
    var el = $('#hero-amt'), v = currentView(), key = S.period + ':' + v.cur.total;
    if (el && S.anim !== key) { S.anim = key; countUp(el, v.cur.total); }
  }
}

function countUp(el, to) {
  if (!to) return;
  var t0 = performance.now(), dur = 600;
  (function tick(t) {
    var p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3);
    el.textContent = rp(to * e);
    if (p < 1) requestAnimationFrame(tick);
  })(t0);
}

/* ---------- memuat data ---------- */
function load(silent) {
  var btn = $('.icon-btn'); if (btn) btn.classList.add('spin');
  return api('getInitData').then(function (d) {
    S.data = d; S.loadedAt = Date.now(); render();
  }).catch(function (e) {
    if (e.code === 'AUTH') { lsSet('secret', ''); S.data = null; render(); showLogin(e.message); return; }
    var cached = lsGet('cache');
    if (!S.data && cached) {
      try { S.data = JSON.parse(cached); S.data.me = lsGet('me') || ''; render(); toast('Offline: menampilkan data terakhir', 'err'); return; } catch (x) {}
    }
    if (!silent || !S.data) { $('#view').innerHTML = errorView(e.message); } else toast('Gagal memuat ulang: ' + e.message, 'err');
  }).then(function () { var b = $('.icon-btn'); if (b) b.classList.remove('spin'); });
}

/* ---------- form tambah / ubah ---------- */
var fmtDigits = function (s) { return s.replace(/\D/g, '').replace(/^0+/, '').slice(0, 10).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); };

function openForm(tx) {
  if (S.form || !S.data) return;
  S.form = true;
  var d = S.data, edit = !!tx;
  var lastCat = lsGet('cat'), lastPay = lsGet('pay');
  var cats = d.categories.slice(), payers = d.payers.slice();
  if (edit && cats.indexOf(tx.category) < 0) cats.push(tx.category);
  if (edit && !payers.some(function (p) { return p.key === tx.payer; })) payers.push({ key: tx.payer, label: tx.payer || 'Tanpa nama' });
  var st = {
    cat: edit ? tx.category : (cats.indexOf(lastCat) >= 0 ? lastCat : cats[0]),
    pay: edit ? tx.payer : (payers.some(function (p) { return p.key === lastPay; }) ? lastPay : (d.me || payers[0].key))
  };

  var ov = document.createElement('div');
  ov.className = 'overlay';
  ov.innerHTML = '<div class="sheet" role="dialog" aria-modal="true" aria-label="' + (edit ? 'Ubah transaksi' : 'Tambah pengeluaran') + '"><div class="grab"></div>' +
    '<h2>' + (edit ? 'Ubah transaksi' : 'Tambah pengeluaran') + '</h2>' +
    '<label class="amount-box" id="f-box"><span>Rp</span><input id="f-amt" type="text" inputmode="numeric" autocomplete="off" placeholder="0" aria-label="Nominal"></label>' +
    '<div class="err" id="f-err"></div>' +
    '<div class="lbl">Kategori</div><div class="cats" id="f-cats"></div>' +
    '<div class="lbl">Siapa yang bayar</div><div class="seg" id="f-pay"></div>' +
    '<input class="field" id="f-name" type="text" maxlength="100" placeholder="Nama tempat / aktivitas (opsional)" autocomplete="off">' +
    '<div class="row2"><input class="field" id="f-date" type="date" aria-label="Tanggal"><button type="button" class="ghost" id="f-notebtn">+ Catatan</button></div>' +
    '<textarea class="field" id="f-note" rows="2" maxlength="300" placeholder="Catatan (opsional)" hidden></textarea>' +
    '<div class="actions">' + (edit ? '<button type="button" class="danger" id="f-del">Hapus</button>' : '') +
    '<button type="button" class="primary" id="f-save">Simpan</button></div></div>';
  document.body.appendChild(ov);
  document.body.style.overflow = 'hidden';
  requestAnimationFrame(function () { ov.classList.add('show'); });

  var amt = $('#f-amt', ov), box = $('#f-box', ov), err = $('#f-err', ov), save = $('#f-save', ov);
  $('#f-date', ov).value = edit ? tx.date : iso(today());
  if (edit) {
    amt.value = fmtDigits(String(tx.amount)); $('#f-name', ov).value = tx.name;
    if (tx.note) { var nt = $('#f-note', ov); nt.hidden = false; nt.value = tx.note; $('#f-notebtn', ov).hidden = true; }
  }
  function drawChoices() {
    $('#f-cats', ov).innerHTML = cats.map(function (c) {
      return '<button type="button" class="cat' + (st.cat === c ? ' on' : '') + '" data-cat="' + esc(c) + '"><span>' + icon(c) + '</span>' + esc(c) + '</button>';
    }).join('');
    $('#f-pay', ov).innerHTML = payers.map(function (p) {
      return '<button type="button" class="' + (st.pay === p.key ? 'on' : '') + '" data-pay="' + esc(p.key) + '">' + esc(p.label) + '</button>';
    }).join('');
  }
  drawChoices();
  setTimeout(function () { try { amt.focus(); } catch (e) {} }, 320);

  function close() {
    ov.classList.remove('show'); document.body.style.overflow = ''; S.form = false;
    document.removeEventListener('keydown', onKey);
    setTimeout(function () { ov.remove(); }, 300);
  }
  function onKey(e) { if (e.key === 'Escape') close(); }
  document.addEventListener('keydown', onKey);

  amt.addEventListener('input', function () { amt.value = fmtDigits(amt.value); err.textContent = ''; });
  ov.addEventListener('click', function (e) {
    if (e.target === ov) return close();
    var c = e.target.closest('[data-cat]'), p = e.target.closest('[data-pay]');
    if (c) { st.cat = c.dataset.cat; drawChoices(); }
    if (p) { st.pay = p.dataset.pay; drawChoices(); }
  });
  $('#f-notebtn', ov).addEventListener('click', function () {
    $('#f-note', ov).hidden = false; $('#f-notebtn', ov).hidden = true; $('#f-note', ov).focus();
  });
  ov.addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'date') { e.preventDefault(); doSave(); } });
  save.addEventListener('click', doSave);
  var delBtn = $('#f-del', ov);
  if (delBtn) delBtn.addEventListener('click', function () {
    confirmDelete(tx).then(function (yes) {
      if (!yes) return;
      delBtn.disabled = true; save.disabled = true;
      api('deleteTransaction', { row: tx.row, sig: tx.sig }).then(function (data) {
        S.data = data; S.loadedAt = Date.now(); close(); toast('Transaksi dihapus', 'ok'); render();
      }).catch(function (e) { delBtn.disabled = false; save.disabled = false; toast('Gagal menghapus: ' + e.message, 'err'); });
    });
  });

  function fail(msg) {
    err.textContent = msg; box.classList.remove('shake'); void box.offsetWidth; box.classList.add('shake'); amt.focus();
  }
  function doSave() {
    var amount = parseInt(amt.value.replace(/\D/g, ''), 10);
    if (!amount || amount <= 0) return fail('Isi nominal lebih dari 0.');
    var date = $('#f-date', ov).value;
    if (!date) return fail('Pilih tanggal.');
    if (!st.cat) return fail('Pilih kategori.');
    var payload = { amount: amount, date: date, category: st.cat, payer: st.pay, name: $('#f-name', ov).value.trim(), note: $('#f-note', ov).value.trim() };
    if (edit) { payload.row = tx.row; payload.sig = tx.sig; }
    save.disabled = true; save.innerHTML = '<span class="spinner"></span> Menyimpan…';
    api(edit ? 'updateTransaction' : 'addTransaction', payload).then(function (data) {
      lsSet('cat', st.cat); lsSet('pay', st.pay);
      S.data = data; S.loadedAt = Date.now(); close();
      toast(edit ? 'Perubahan tersimpan ✓' : 'Tersimpan ke spreadsheet ✓', 'ok'); render();
    }).catch(function (e) {
      save.disabled = false; save.textContent = 'Simpan';
      toast('Gagal menyimpan: ' + e.message, 'err');
    });
  }
}

function confirmDelete(tx) {
  return new Promise(function (resolve) {
    var o = document.createElement('div');
    o.className = 'overlay center';
    o.style.zIndex = 60;
    o.innerHTML = '<div class="dlg" role="alertdialog"><h3>Hapus transaksi ini?</h3><p><b>' + esc(tx.name || tx.category) + '</b> · ' + rp(tx.amount) +
      '<br>' + fmtDate(tx.date) + '<br>Baris ini akan dihapus dari spreadsheet.</p>' +
      '<div class="actions"><button type="button" class="ghost" data-v="0">Batal</button><button type="button" class="danger solid" data-v="1">Ya, hapus</button></div></div>';
    o.addEventListener('click', function (e) {
      var b = e.target.closest('[data-v]');
      if (b || e.target === o) { o.classList.remove('show'); setTimeout(function () { o.remove(); }, 200); resolve(!!b && b.dataset.v === '1'); }
    });
    document.body.appendChild(o);
    requestAnimationFrame(function () { o.classList.add('show'); });
  });
}

/* ---------- masuk & pengaturan ---------- */
function showLogin(msg) {
  if ($('#login')) { if (msg) $('#l-err').textContent = msg; return; }
  var o = document.createElement('div');
  o.className = 'overlay center'; o.id = 'login'; o.style.zIndex = 80;
  o.innerHTML = '<div class="dlg login"><div class="logo">💙</div><h3>Catatan Kita</h3>' +
    '<p>Masukkan kata sandi bersama untuk membuka catatan.</p>' +
    '<div class="seg" id="l-who"><button type="button" data-who="Nad">Saya Nadya</button><button type="button" data-who="Gar">Saya Tegar</button></div>' +
    '<input class="field" id="l-pass" type="password" placeholder="Kata sandi" autocomplete="current-password" autocapitalize="off">' +
    '<div class="err" id="l-err">' + esc(msg || '') + '</div>' +
    '<button type="button" class="primary" id="l-go" style="width:100%">Masuk</button></div>';
  document.body.appendChild(o);
  requestAnimationFrame(function () { o.classList.add('show'); });
  var who = lsGet('me') || 'Nad', pass = $('#l-pass', o), err = $('#l-err', o), go = $('#l-go', o);
  function paint() { $$('#l-who button', o).forEach(function (b) { b.classList.toggle('on', b.dataset.who === who); }); }
  paint();
  $('#l-who', o).addEventListener('click', function (e) { var b = e.target.closest('[data-who]'); if (b) { who = b.dataset.who; paint(); } });
  function submit() {
    var p = pass.value.trim();
    if (!p) { err.textContent = 'Isi kata sandi.'; pass.focus(); return; }
    lsSet('secret', p); lsSet('me', who); err.textContent = '';
    go.disabled = true; go.innerHTML = '<span class="spinner"></span> Memeriksa…';
    api('getInitData').then(function (d) {
      S.data = d; S.loadedAt = Date.now(); o.classList.remove('show'); setTimeout(function () { o.remove(); }, 250);
      toast('Selamat datang ✓', 'ok'); render();
    }).catch(function (e) {
      lsSet('secret', ''); go.disabled = false; go.textContent = 'Masuk'; err.textContent = e.message; pass.focus();
    });
  }
  go.addEventListener('click', submit);
  pass.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
  setTimeout(function () { try { pass.focus(); } catch (x) {} }, 300);
}

function openSettings() {
  var me = S.data ? payerLabel(S.data.me) : '';
  var o = document.createElement('div');
  o.className = 'overlay center'; o.style.zIndex = 70;
  o.innerHTML = '<div class="dlg" role="dialog"><h3>Pengaturan</h3><p>Masuk sebagai <b>' + esc(me) + '</b> di perangkat ini.<br>Keluar akan menghapus kata sandi dari perangkat ini.</p>' +
    '<div class="actions"><button type="button" class="ghost" data-v="0">Tutup</button><button type="button" class="danger solid" data-v="1">Keluar</button></div></div>';
  o.addEventListener('click', function (e) {
    var b = e.target.closest('[data-v]');
    if (!b && e.target !== o) return;
    o.classList.remove('show'); setTimeout(function () { o.remove(); }, 200);
    if (b && b.dataset.v === '1') { lsSet('secret', ''); lsSet('cache', ''); S.data = null; render(); showLogin(); }
  });
  document.body.appendChild(o);
  requestAnimationFrame(function () { o.classList.add('show'); });
}

/* ---------- event ---------- */
document.addEventListener('click', function (e) {
  var el = e.target.closest('[data-tab],[data-period],[data-row],[data-act]');
  if (!el || el.closest('.overlay')) return;
  if (el.dataset.tab) { S.tab = el.dataset.tab; render(); window.scrollTo(0, 0); return; }
  if (el.dataset.period) { S.period = el.dataset.period; render(); return; }
  if (el.dataset.row) {
    var row = +el.dataset.row, t = txs().filter(function (x) { return x.row === row; })[0];
    if (t) openForm(t); return;
  }
  var a = el.dataset.act;
  if (a === 'add') openForm();
  else if (a === 'settings') openSettings();
  else if (a === 'refresh' || a === 'retry') { if (!S.data) $('#view').innerHTML = skeleton(); load(a === 'refresh'); }
  else if (a === 'trend') { S.trend = el.dataset.v; render(); }
  else if (a === 'more') { S.hist.limit += 40; $('#hist-list').innerHTML = histList(); }
  else if (a === 'reset') { S.hist = { q: '', cat: '', from: '', to: '', limit: 40 }; render(); }
});
$('#fab').addEventListener('click', function () { openForm(); });

document.addEventListener('input', function (e) {
  var id = e.target.id;
  if (id === 'h-q') S.hist.q = e.target.value;
  else if (id === 'h-cat') S.hist.cat = e.target.value;
  else if (id === 'h-from') S.hist.from = e.target.value;
  else if (id === 'h-to') S.hist.to = e.target.value;
  else return;
  S.hist.limit = 40; $('#hist-list').innerHTML = histList();
  var rb = $('#h-reset'); if (rb) rb.hidden = !(S.hist.q || S.hist.cat || S.hist.from || S.hist.to);
});
document.addEventListener('change', function (e) {
  if (e.target.id === 'c-from') { S.cFrom = e.target.value; if (S.cTo || e.target.value) { if (!S.cTo) S.cTo = S.cFrom; render(); } }
  if (e.target.id === 'c-to') { S.cTo = e.target.value; if (!S.cFrom) S.cFrom = S.cTo; render(); }
});
document.addEventListener('visibilitychange', function () {
  if (!document.hidden && S.data && !S.form && Date.now() - S.loadedAt > 60000) load(true);
});

if ('serviceWorker' in navigator) { window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); }); }
render();
if (lsGet('secret') && lsGet('me')) load(false); else showLogin();
})();
