// Staff dashboard at /admin/bookings/: review requests, see the week, block time, export.
// Login uses the Netlify Identity widget (the same accounts as the site editor).
(function () {
  var TZ = 'Europe/Zurich';
  var STATUS_LABEL = { pending: 'Pending', approved: 'Approved', declined: 'Declined', cancelled: 'Cancelled', blocked: 'Blocked' };
  var app = document.getElementById('adm');
  var spaces = (window.GSS_SPACES || []), spaceLabel = {};
  spaces.forEach(function (s) { spaceLabel[s.key] = s.label; });
  var $ = function (sel, el) { return (el || document).querySelector(sel); };
  var $$ = function (sel, el) { return Array.prototype.slice.call((el || document).querySelectorAll(sel)); };

  // ---------------------------------------------------------------- helpers
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function pad(n) { return String(n).padStart(2, '0'); }
  var partsFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  function local(iso) { var p = {}; partsFmt.formatToParts(new Date(iso)).forEach(function (x) { p[x.type] = x.value; }); return { date: p.year + '-' + p.month + '-' + p.day, time: p.hour + ':' + p.minute, min: +p.hour * 60 + +p.minute }; }
  function noon(d) { return new Date(d + 'T12:00:00Z'); }
  function addDays(d, n) { var x = noon(d); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }
  function today() { return local(new Date().toISOString()).date; }
  function monday(d) { return addDays(d, -((noon(d).getUTCDay() + 6) % 7)); }
  function fmtDay(d, o) { return new Intl.DateTimeFormat('en-GB', Object.assign({ timeZone: 'UTC' }, o)).format(noon(d)); }
  var fullFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  function when(b) {
    var a = local(b.starts_at), z = local(new Date(Date.parse(b.ends_at) - 1).toISOString()), end = local(b.ends_at).time;
    if (end === '00:00') end = '24:00';
    if (a.date === z.date) return fullFmt.format(new Date(b.starts_at)) + (b.full_day ? ', full day' : ', ' + a.time + '–' + end);
    return fullFmt.format(new Date(b.starts_at)) + ' – ' + fullFmt.format(new Date(Date.parse(b.ends_at) - 1)) + (b.full_day ? ', full days' : '');
  }
  function chf(n) { return n == null ? '—' : 'CHF ' + Number(n).toLocaleString('de-CH'); }
  function ago(iso) {
    var h = (Date.now() - Date.parse(iso)) / 3600000;
    return h < 1 ? 'just now' : h < 24 ? Math.floor(h) + ' h ago' : Math.floor(h / 24) + ' d ago';
  }
  function toast(msg, bad) {
    var t = $('#adm-toast'); t.textContent = msg; t.className = 'adm-toast is-on' + (bad ? ' is-bad' : '');
    clearTimeout(toast.t); toast.t = setTimeout(function () { t.className = 'adm-toast'; }, 4000);
  }

  // ---------------------------------------------------------------- auth + API
  var identity = window.netlifyIdentity;
  function api(method, params, body) {
    var user = identity && identity.currentUser();
    if (!user) return Promise.reject(new Error('Please log in.'));
    return user.jwt().then(function (token) {
      var qs = params ? '?' + new URLSearchParams(params).toString() : '';
      return fetch('/api/admin/bookings' + qs, {
        method: method, headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (res.status === 401) { showLogin('Your account doesn\'t have access to bookings, or your session expired.'); throw new Error(data.error || 'Please log in.'); }
        if (!res.ok) throw new Error(data.error || 'Something went wrong.');
        return data;
      });
    });
  }

  function showLogin(msg) {
    app.hidden = true; $('#adm-login').hidden = false;
    $('#adm-login-msg').textContent = msg || '';
  }
  function showApp(user) {
    $('#adm-login').hidden = true; app.hidden = false;
    $('#adm-user').textContent = (user.user_metadata && user.user_metadata.full_name) || user.email;
    route();
  }
  $('#adm-login-btn').addEventListener('click', function () { identity.open('login'); });
  $('#adm-logout').addEventListener('click', function () { identity.logout(); });
  identity.on('init', function (user) { user ? showApp(user) : showLogin(); });
  identity.on('login', function (user) { identity.close(); showApp(user); });
  identity.on('logout', function () { showLogin(); });
  identity.init();

  // ---------------------------------------------------------------- tabs
  var view = 'requests';
  $$('.adm-tab').forEach(function (t) {
    t.addEventListener('click', function () { setView(t.getAttribute('data-view')); });
  });
  function setView(v) {
    view = v;
    $$('.adm-tab').forEach(function (t) { var on = t.getAttribute('data-view') === v; t.classList.toggle('is-active', on); t.setAttribute('aria-selected', on); });
    $$('.adm-view').forEach(function (p) { p.hidden = p.getAttribute('data-view') !== v; });
    refresh();
  }
  function refresh() {
    if (view === 'requests') { loadRequests(); loadToday(); }
    if (view === 'calendar') reloadCal();
    if (view === 'list') loadList();
    countPending();
  }
  function route() {
    var ref = decodeURIComponent(location.hash.slice(1));
    setView(view);
    if (/^GSS-/.test(ref)) api('GET', { q: ref }).then(function (d) { var b = d.bookings[0]; if (b) openBooking(b); });
  }
  window.addEventListener('hashchange', route);

  function countPending() {
    api('GET', { status: 'pending', from: today() }).then(function (d) {
      var n = d.bookings.length, badge = $('#adm-pending-count');
      badge.textContent = n; badge.hidden = !n;
      document.title = (n ? '(' + n + ') ' : '') + 'Bookings | Geneva Solution Space';
    }).catch(function () {});
  }

  // ---------------------------------------------------------------- requests
  var cache = {};
  function remember(list) { list.forEach(function (b) { cache[b.id] = b; }); return list; }

  function loadRequests() {
    var box = $('#adm-requests');
    box.innerHTML = '<p class="adm-muted">Loading…</p>';
    api('GET', { status: 'pending' }).then(function (d) {
      var list = remember(d.bookings).sort(function (a, b) { return a.created_at < b.created_at ? -1 : 1; });
      var past = list.filter(function (b) { return Date.parse(b.starts_at) < Date.now(); });
      list = list.filter(function (b) { return Date.parse(b.starts_at) >= Date.now(); });
      if (!list.length) { box.innerHTML = '<div class="adm-empty"><strong>All caught up.</strong><span>No requests are waiting for a decision.</span></div>'; return; }
      box.innerHTML = list.map(card).join('') + (past.length ? '<p class="adm-muted">' + past.length + ' older pending request(s) have already passed. Find them under All bookings.</p>' : '');
    }).catch(function (e) { box.innerHTML = '<p class="adm-error">' + esc(e.message) + '</p>'; });
  }

  function card(b) {
    return '<article class="adm-card" data-id="' + b.id + '">' +
      '<header><div><p class="adm-ref">' + esc(b.reference) + ' · received ' + ago(b.created_at) + '</p>' +
      '<h3>' + esc(b.event) + '</h3><p class="adm-when">' + esc(spaceLabel[b.space] || b.space) + ' · ' + esc(when(b)) + '</p></div>' +
      '<div class="adm-price">' + chf(b.price_estimate) + (b.first_time ? '<span>first-time discount</span>' : '') + '</div></header>' +
      '<dl class="adm-facts"><div><dt>Requested by</dt><dd>' + esc(b.name) + (b.organization ? ', ' + esc(b.organization) : '') + '</dd></div>' +
      '<div><dt>Contact</dt><dd><a href="mailto:' + esc(b.email) + '">' + esc(b.email) + '</a>' + (b.phone ? ' · ' + esc(b.phone) : '') + '</dd></div>' +
      '<div><dt>Participants</dt><dd>' + esc(b.participants) + '</dd></div></dl>' +
      '<p class="adm-plan">' + esc(b.plan).replace(/\n/g, '<br>') + '</p>' +
      '<footer><button class="btn btn-solid btn-sm" data-act="review" data-id="' + b.id + '">Approve or decline</button></footer></article>';
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act="review"], [data-open]');
    if (b) { var id = b.getAttribute('data-id') || b.getAttribute('data-open'); if (cache[id]) openBooking(cache[id]); }
  });

  // ---------------------------------------------------------------- booking drawer
  var dlg = $('#adm-dialog');
  function openBooking(b) {
    cache[b.id] = b;
    var rows = [['Status', '<span class="adm-pill is-' + b.status + '">' + STATUS_LABEL[b.status] + '</span>'], ['Type', b.kind ? ({ class: 'Class', event: 'Event', meeting: 'Meeting', other: 'Other' })[b.kind] || '' : ''], ['Space', esc(spaceLabel[b.space] || b.space)], ['When', esc(when(b))]];
    if (b.status !== 'blocked') rows.push(
      ['Event', esc(b.event)], ['Participants', esc(b.participants)], ['Name', esc(b.name)],
      ['Email', '<a href="mailto:' + esc(b.email) + '">' + esc(b.email) + '</a>'], ['Phone', esc(b.phone)], ['Organization', esc(b.organization)],
      ['First booking', b.first_time ? 'Yes' : 'No'], ['Estimate', chf(b.price_estimate)], ['Final price', b.price_final != null ? chf(b.price_final) : ''],
      ['Plans', esc(b.plan).replace(/\n/g, '<br>')]);
    rows.push(['Note', esc(b.admin_note).replace(/\n/g, '<br>')], ['Received', fullFmt.format(new Date(b.created_at))]);
    if (b.decided_at) rows.push(['Decided', fullFmt.format(new Date(b.decided_at)) + ' by ' + esc(b.decided_by)]);

    var actions = '';
    if (b.status === 'pending') actions =
      '<div class="adm-decide"><label>Final price (CHF)<input type="number" min="0" step="1" name="price" value="' + (b.price_estimate != null ? Number(b.price_estimate) : '') + '"></label>' +
      '<label>Message to ' + esc(b.name) + ' <span class="adm-muted">Required to decline, optional to approve</span><textarea name="message" rows="3" placeholder="e.g. Access is via the main entrance; the AV technician will be there from 8:30."></textarea></label>' +
      '<div class="adm-actions"><button class="btn btn-solid btn-sm" data-do="approve">Approve and email</button><button class="btn btn-ghost btn-sm" data-do="decline">Decline</button></div></div>';
    else if (b.status === 'approved' && Date.parse(b.ends_at) > Date.now()) actions =
      '<div class="adm-decide"><label>Message <span class="adm-muted">Optional, sent with the cancellation</span><textarea name="message" rows="3"></textarea></label>' +
      '<div class="adm-actions"><button class="btn btn-ghost btn-sm adm-danger" data-do="cancel">Cancel booking</button></div></div>';
    else if (b.status === 'blocked') actions = '<div class="adm-actions"><button class="btn btn-ghost btn-sm adm-danger" data-do="unblock">Remove block</button></div>';

    actions += '<p class="adm-jump"><button type="button" class="bk-link" data-cal-jump="' + local(b.starts_at).date + '">Show this day in the calendar →</button></p>';
    $('#adm-dialog-body').innerHTML = '<p class="adm-ref">' + esc(b.reference) + '</p><h2>' + esc(b.status === 'blocked' ? (b.admin_note || 'Blocked time') : b.event) + '</h2>' +
      '<dl class="adm-dl">' + rows.filter(function (r) { return r[1]; }).map(function (r) { return '<div><dt>' + r[0] + '</dt><dd>' + r[1] + '</dd></div>'; }).join('') + '</dl>' +
      '<div class="adm-series" id="adm-series" hidden></div>' + actions + '<p class="adm-error" id="adm-dialog-err" hidden></p>';
    dlg.setAttribute('data-id', b.id);
    if (!dlg.open) dlg.showModal();
    showSeries(b);
    if (location.hash.slice(1) !== b.reference) history.replaceState(null, '', '#' + b.reference);
  }
  dlg.addEventListener('close', function () { history.replaceState(null, '', location.pathname); });
  $('#adm-dialog-close').addEventListener('click', function () { dlg.close(); });
  dlg.addEventListener('click', function (e) {
    if (e.target === dlg) { dlg.close(); return; }
    var btn = e.target.closest('[data-do]'); if (!btn) return;
    var act = btn.getAttribute('data-do'), id = dlg.getAttribute('data-id');
    var msg = $('textarea[name=message]', dlg), price = $('input[name=price]', dlg), err = $('#adm-dialog-err');
    if (act === 'decline' && !msg.value.trim()) { err.textContent = 'Please write a short message explaining why, so the requester knows what to do next.'; err.hidden = false; msg.focus(); return; }
    if (act === 'cancel' && !confirm('Cancel this approved booking? The requester will be emailed.')) return;
    btn.disabled = true;
    api('POST', null, { action: act, id: id, message: msg ? msg.value : '', price_final: price ? price.value : undefined })
      .then(function (d) {
        dlg.close();
        toast({ approve: 'Approved. Confirmation sent.', decline: 'Declined. The requester has been emailed.', cancel: 'Booking cancelled.', unblock: 'Block removed.' }[act]);
        if (d.booking) cache[d.booking.id] = d.booking;
        refresh();
      })
      .catch(function (e) { err.textContent = e.message; err.hidden = false; btn.disabled = false; });
  });

  // ---------------------------------------------------------------- calendar (month / week / day / agenda)
  // Everything live (pending, approved, blocked) in the visible range is fetched once;
  // space and status filters then apply instantly on the client.
  var LIVE = ['approved', 'pending', 'blocked'];
  var SPACE_COLORS = ['#3563E9', '#E4572E', '#1B9C85', '#E9A23B', '#7A5AF8'];
  var spaceColor = {}; spaces.forEach(function (s, i) { spaceColor[s.key] = SPACE_COLORS[i % SPACE_COLORS.length]; });
  var DAY_FROM = 7 * 60, DAY_TO = 22 * 60, PX = 44;
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  var saved = {};
  try { saved = JSON.parse(localStorage.getItem('gss-adm-cal') || '{}'); } catch (e) { saved = {}; }
  var C = {
    view: saved.view || (window.matchMedia('(max-width: 700px)').matches ? 'agenda' : 'week'),
    date: today(),
    spaces: saved.spaces || spaces.map(function (s) { return s.key; }),
    statuses: saved.statuses || LIVE.slice(),
    list: [], range: null,
  };
  function persist() {
    try { localStorage.setItem('gss-adm-cal', JSON.stringify({ view: C.view, spaces: C.spaces, statuses: C.statuses })); } catch (e) {}
  }

  function rangeFor(v, d) {
    if (v === 'month') { var first = d.slice(0, 8) + '01', start = monday(first); return [start, addDays(start, 41)]; }
    if (v === 'week') { var m = monday(d); return [m, addDays(m, 6)]; }
    if (v === 'day') return [d, d];
    return [d, addDays(d, 29)];
  }
  function step(n) {
    if (C.view === 'month') { var y = +C.date.slice(0, 4), m = +C.date.slice(5, 7) - 1 + n; C.date = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10); }
    else C.date = addDays(C.date, n * (C.view === 'week' ? 7 : C.view === 'day' ? 1 : 30));
    loadCal();
  }
  function setCalView(v) { C.view = v; persist(); loadCal(); }
  function showDay(d) { C.date = d; setCalView('day'); }

  $('#cal-today').addEventListener('click', function () { C.date = today(); loadCal(); });
  $('#cal-prev').addEventListener('click', function () { step(-1); });
  $('#cal-next').addEventListener('click', function () { step(1); });
  $$('[data-cal-view]').forEach(function (b) { b.addEventListener('click', function () { setCalView(b.getAttribute('data-cal-view')); }); });

  function loadCal() {
    var r = rangeFor(C.view, C.date), key = r.join('|');
    renderToolbar();
    if (C.range === key) { renderCal(); return; }
    $('#cal-body').classList.add('is-loading');
    api('GET', { from: r[0], to: r[1], status: LIVE.join(',') }).then(function (d) {
      if (rangeFor(C.view, C.date).join('|') !== key) return; // the user has moved on
      C.list = remember(d.bookings); C.range = key;
      renderCal();
    }).catch(function (e) { $('#cal-body').innerHTML = '<p class="adm-error">' + esc(e.message) + '</p>'; })
      .then(function () { $('#cal-body').classList.remove('is-loading'); });
  }
  function reloadCal() { C.range = null; loadCal(); }

  // ---- toolbar, filters, stats
  function renderToolbar() {
    var r = rangeFor(C.view, C.date), t;
    if (C.view === 'month') t = MONTHS[+C.date.slice(5, 7) - 1] + ' ' + C.date.slice(0, 4);
    else if (C.view === 'day') t = fmtDay(C.date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    else t = fmtDay(r[0], { day: 'numeric', month: 'short' }) + ' – ' + fmtDay(r[1], { day: 'numeric', month: 'short', year: 'numeric' });
    $('#cal-title').textContent = t;
    $$('[data-cal-view]').forEach(function (b) { var on = b.getAttribute('data-cal-view') === C.view; b.classList.toggle('is-active', on); b.setAttribute('aria-selected', on); });
    $('#cal-tip').textContent = {
      month: 'Click a day number to open that day. Hover a booking for details, click it to open.',
      week: 'Click a booking to open it. Drag across empty hours to block that time.',
      day: 'One column per space. Drag across empty hours to block that time.',
      agenda: 'The next 30 days. Pending requests can be approved or declined right here.',
    }[C.view];
  }

  function visible(b) { return C.spaces.indexOf(b.space) !== -1 && C.statuses.indexOf(b.status) !== -1; }

  function renderFilters() {
    var r = rangeFor(C.view, C.date);
    var inRange = C.list.filter(function (b) { return local(b.starts_at).date <= r[1] && local(new Date(Date.parse(b.ends_at) - 1).toISOString()).date >= r[0]; });
    $('#cal-space-filter').innerHTML = spaces.map(function (s) {
      var on = C.spaces.indexOf(s.key) !== -1, n = inRange.filter(function (b) { return b.space === s.key && C.statuses.indexOf(b.status) !== -1; }).length;
      return '<button type="button" class="cal-chip-filter' + (on ? ' is-on' : '') + '" data-space-toggle="' + s.key + '" aria-pressed="' + on + '"><i style="background:' + spaceColor[s.key] + '"></i>' + esc(s.label) + '<span>' + n + '</span></button>';
    }).join('');
    $('#cal-status-filter').innerHTML = LIVE.map(function (st) {
      var on = C.statuses.indexOf(st) !== -1, n = inRange.filter(function (b) { return b.status === st && C.spaces.indexOf(b.space) !== -1; }).length;
      return '<button type="button" class="cal-chip-filter' + (on ? ' is-on' : '') + '" data-status-toggle="' + st + '" aria-pressed="' + on + '"><i class="cal-st is-' + st + '"></i>' + STATUS_LABEL[st] + '<span>' + n + '</span></button>';
    }).join('');

    // Summary of what is visible (for month view: the month itself, not the padding days).
    var from = C.view === 'month' ? C.date.slice(0, 8) + '01' : r[0];
    var to = C.view === 'month' ? addDays(new Date(Date.UTC(+C.date.slice(0, 4), +C.date.slice(5, 7), 1)).toISOString().slice(0, 10), -1) : r[1];
    var shown = inRange.filter(function (b) { var d = local(b.starts_at).date; return visible(b) && d >= from && d <= to; });
    var approvedList = shown.filter(function (b) { return b.status === 'approved'; });
    var hours = shown.filter(function (b) { return b.status !== 'blocked'; }).reduce(function (h, b) { return h + (Date.parse(b.ends_at) - Date.parse(b.starts_at)) / 3600000; }, 0);
    var income = approvedList.reduce(function (s, b) { return s + Number(b.price_final != null ? b.price_final : b.price_estimate || 0); }, 0);
    var pending = shown.filter(function (b) { return b.status === 'pending'; }).length;
    $('#cal-stats').innerHTML =
      '<div><b>' + approvedList.length + '</b><span>Confirmed bookings</span></div>' +
      '<div' + (pending ? ' class="is-alert"' : '') + '><b>' + pending + '</b><span>Waiting for a decision</span></div>' +
      '<div><b>' + Math.round(hours) + ' h</b><span>Booked or requested</span></div>' +
      '<div><b>' + chf(income) + '</b><span>Expected from confirmed</span></div>';
  }

  $('#cal-space-filter').addEventListener('click', function (e) {
    var b = e.target.closest('[data-space-toggle]'); if (!b) return;
    var k = b.getAttribute('data-space-toggle'), i = C.spaces.indexOf(k);
    if (i === -1) C.spaces.push(k); else if (C.spaces.length > 1) C.spaces.splice(i, 1); else return toast('Keep at least one space visible.');
    persist(); renderCal();
  });
  $('#cal-status-filter').addEventListener('click', function (e) {
    var b = e.target.closest('[data-status-toggle]'); if (!b) return;
    var k = b.getAttribute('data-status-toggle'), i = C.statuses.indexOf(k);
    if (i === -1) C.statuses.push(k); else if (C.statuses.length > 1) C.statuses.splice(i, 1); else return toast('Keep at least one status visible.');
    persist(); renderCal();
  });

  // ---- shared pieces
  function label(b) { return b.status === 'blocked' ? (b.admin_note || 'Blocked') : (b.event || 'Booking'); }
  function hm(min) { return pad(Math.floor(min / 60)) + ':' + pad(min % 60); }
  // The part of a booking that falls on `day`, in minutes, or null.
  function seg(b, day) {
    var ls = local(b.starts_at), le = local(b.ends_at);
    var from = ls.date < day ? 0 : ls.date > day ? null : ls.min;
    var to = le.date > day ? 1440 : le.date < day ? null : le.min;
    return from == null || to == null || to <= from ? null : [from, to];
  }
  function tip(b, s) {
    return [label(b), spaceLabel[b.space] + ' · ' + (s ? hm(s[0]) + '–' + hm(s[1]) : when(b)), STATUS_LABEL[b.status] +
      (b.organization ? ' · ' + b.organization : '') + (b.participants ? ' · ' + b.participants + ' people' : '')].join('\n');
  }
  function onDay(day) {
    return C.list.filter(visible).map(function (b) { return { b: b, s: seg(b, day) }; })
      .filter(function (x) { return x.s; }).sort(function (x, y) { return x.s[0] - y.s[0] || (x.b.space < y.b.space ? -1 : 1); });
  }
  function openMinutes(day) {
    return spaces.filter(function (s) { return C.spaces.indexOf(s.key) !== -1 && (!s.open_days || s.open_days.indexOf(fmtDay(day, { weekday: 'short' })) !== -1); })
      .reduce(function (n, s) { return n + (toMin(s.close || '20:00') - toMin(s.open || '08:00')); }, 0);
  }
  function toMin(t) { return +t.slice(0, 2) * 60 + +t.slice(3, 5); }

  function renderCal() {
    renderToolbar(); renderFilters();
    var body = $('#cal-body');
    body.className = 'cal-body is-' + C.view;
    if (C.view === 'month') body.innerHTML = renderMonth();
    else if (C.view === 'agenda') body.innerHTML = renderAgenda();
    else {
      var cols = C.view === 'week'
        ? Array.apply(null, Array(7)).map(function (_, i) { var d = addDays(rangeFor('week', C.date)[0], i); return { date: d, spaces: C.spaces.slice(), head: fmtDay(d, { weekday: 'short' }) + ' <b>' + fmtDay(d, { day: 'numeric' }) + '</b>', link: d }; })
        : C.spaces.map(function (k) { return { date: C.date, spaces: [k], head: '<i class="cal-dot" style="background:' + spaceColor[k] + '"></i>' + esc(spaceLabel[k]) }; });
      body.innerHTML = renderGrid(cols, C.view === 'day');
      var now = body.querySelector('.cal-now');
      if (now && !renderCal.scrolled) { renderCal.scrolled = true; body.querySelector('.cal-scroll').scrollTop = Math.max(0, now.offsetTop - 160); }
    }
  }

  // ---- month
  function renderMonth() {
    var r = rangeFor('month', C.date), month = C.date.slice(0, 7), t = today();
    var html = '<div class="cal-m"><div class="cal-m-head">' + ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(function (d) { return '<span>' + d + '</span>'; }).join('') + '</div><div class="cal-m-grid">';
    for (var i = 0; i < 42; i++) {
      var d = addDays(r[0], i), items = onDay(d), cls = 'cal-m-day';
      if (d.slice(0, 7) !== month) cls += ' is-other';
      if (d === t) cls += ' is-today';
      if (i % 7 > 4) cls += ' is-weekend';
      var open = openMinutes(d), used = items.filter(function (x) { return x.b.status !== 'blocked'; }).reduce(function (n, x) { return n + (x.s[1] - x.s[0]); }, 0);
      var pct = open ? Math.min(100, Math.round(used / open * 100)) : 0;
      html += '<div class="' + cls + '" data-day="' + d + '"><div class="cal-m-top"><button type="button" class="cal-m-num" data-goto-day="' + d + '" aria-label="Open ' + fmtDay(d, { weekday: 'long', day: 'numeric', month: 'long' }) + '">' + +d.slice(8) + '</button>' +
        (pct ? '<span class="cal-m-load" title="' + pct + '% of opening hours booked"><i style="width:' + pct + '%"></i></span>' : '') + '</div>';
      items.slice(0, 3).forEach(function (x) {
        html += '<button type="button" class="cal-chip is-' + x.b.status + '" data-open="' + x.b.id + '" title="' + esc(tip(x.b, x.s)) + '" style="--sp:' + spaceColor[x.b.space] + '">' +
          '<b>' + (x.s[0] === 0 && x.s[1] === 1440 ? 'All day' : hm(x.s[0])) + '</b> ' + esc(label(x.b)) + '</button>';
      });
      if (items.length > 3) html += '<button type="button" class="cal-more" data-goto-day="' + d + '">+' + (items.length - 3) + ' more</button>';
      html += '</div>';
    }
    return html + '</div></div>';
  }

  // Side-by-side columns only where bookings really overlap; everything else gets the full width.
  function packed(items) {
    var out = [], cluster = [], ends = [], clusterEnd = -1;
    function flush() { cluster.forEach(function (x) { x.cols = ends.length; }); cluster = []; ends = []; }
    items.slice().sort(function (a, b) { return a.s[0] - b.s[0] || b.s[1] - a.s[1]; }).forEach(function (x) {
      if (x.s[0] >= clusterEnd) { flush(); clusterEnd = -1; }
      var col = 0; while (col < ends.length && ends[col] > x.s[0]) col++;
      ends[col] = x.s[1]; x.col = col; clusterEnd = Math.max(clusterEnd, x.s[1]);
      cluster.push(x); out.push(x);
    });
    flush();
    return out;
  }

  // ---- week & day (time grid)
  function renderGrid(cols, detailed) {
    var hours = '', h, t = today(), nowMin = local(new Date().toISOString()).min;
    for (h = DAY_FROM; h < DAY_TO; h += 60) hours += '<div class="cal-hour" style="height:' + PX + 'px"><span>' + hm(h) + '</span></div>';
    var html = '<div class="cal-scroll"><div class="cal-tgrid" style="--cols:' + cols.length + '"><div class="cal-times"><div class="cal-colhead"></div>' + hours + '</div>';
    cols.forEach(function (c) {
      html += '<div class="cal-col' + (c.date === t ? ' is-today' : '') + '"><div class="cal-colhead">' + (c.link ? '<button type="button" data-goto-day="' + c.link + '">' + c.head + '</button>' : c.head) + '</div>' +
        '<div class="cal-lane" data-date="' + c.date + '" data-spaces="' + c.spaces.join(',') + '" style="height:' + ((DAY_TO - DAY_FROM) / 60 * PX) + 'px; --lanes:' + c.spaces.length + '">';
      packed(onDay(c.date).filter(function (x) { return c.spaces.indexOf(x.b.space) !== -1; })).forEach(function (x) {
        var top = Math.max(x.s[0], DAY_FROM), bottom = Math.min(x.s[1], DAY_TO); if (bottom <= top) return;
        var hgt = Math.max(20, (bottom - top) / 60 * PX - 2), b = x.b;
        html += '<button type="button" class="cal-ev is-' + b.status + '" data-open="' + b.id + '" title="' + esc(tip(b, x.s)) + '" style="--sp:' + spaceColor[b.space] + ';top:' + ((top - DAY_FROM) / 60 * PX) + 'px;height:' + hgt + 'px;left:calc(' + x.col + ' * 100% / ' + x.cols + ' + 2px);width:calc(100% / ' + x.cols + ' - 4px)">' +
          '<strong>' + esc(label(b)) + '</strong><span>' + hm(x.s[0]) + '–' + hm(x.s[1]) + (c.spaces.length > 1 ? ' · ' + esc(spaceLabel[b.space]) : '') + '</span>' +
          (detailed && hgt > 70 && b.status !== 'blocked' ? '<span>' + esc([b.organization, b.participants ? b.participants + ' people' : ''].filter(Boolean).join(' · ')) + '</span>' : '') +
          (detailed && hgt > 90 ? '<em>' + STATUS_LABEL[b.status] + '</em>' : '') + '</button>';
      });
      if (c.date === t && nowMin >= DAY_FROM && nowMin <= DAY_TO) html += '<div class="cal-now" style="top:' + ((nowMin - DAY_FROM) / 60 * PX) + 'px"></div>';
      html += '</div></div>';
    });
    return html + '</div></div>';
  }

  // Drag (or click) across empty hours to block them.
  var drag = null;
  $('#cal-body').addEventListener('pointerdown', function (e) {
    var lane = e.target.closest('.cal-lane');
    if (!lane || e.target.closest('.cal-ev') || e.button > 0) return;
    var rect = lane.getBoundingClientRect(), keys = lane.getAttribute('data-spaces').split(',');
    var idx = Math.min(keys.length - 1, Math.max(0, Math.floor((e.clientX - rect.left) / rect.width * keys.length)));
    var hour = function (y) { return Math.max(DAY_FROM / 60, Math.min(DAY_TO / 60 - 1, Math.floor(DAY_FROM / 60 + (y - rect.top) / PX))); };
    drag = { lane: lane, rect: rect, space: keys[idx], a: hour(e.clientY), b: hour(e.clientY), hour: hour, ghost: document.createElement('div') };
    drag.ghost.className = 'cal-ghost';
    drag.ghost.style.left = 'calc(' + idx + ' * 100% / ' + keys.length + ' + 2px)'; drag.ghost.style.width = 'calc(100% / ' + keys.length + ' - 4px)';
    lane.appendChild(drag.ghost); paintGhost();
    lane.setPointerCapture(e.pointerId); e.preventDefault();
  });
  $('#cal-body').addEventListener('pointermove', function (e) { if (drag) { drag.b = drag.hour(e.clientY); paintGhost(); } });
  $('#cal-body').addEventListener('pointerup', function () {
    if (!drag) return;
    var lo = Math.min(drag.a, drag.b), hi = Math.max(drag.a, drag.b) + 1, d = drag;
    drag = null; d.ghost.remove();
    openBlock(d.lane.getAttribute('data-date'), pad(lo) + ':00', pad(hi) + ':00', d.space);
  });
  // A touch swipe that turns into scrolling cancels the pointer: drop the selection quietly.
  $('#cal-body').addEventListener('pointercancel', function () { if (drag) { drag.ghost.remove(); drag = null; } });
  function paintGhost() {
    var lo = Math.min(drag.a, drag.b), hi = Math.max(drag.a, drag.b) + 1;
    drag.ghost.style.top = ((lo * 60 - DAY_FROM) / 60 * PX) + 'px'; drag.ghost.style.height = ((hi - lo) * PX - 2) + 'px';
    drag.ghost.textContent = 'Block ' + pad(lo) + ':00–' + pad(hi) + ':00';
  }

  // ---- agenda
  function renderAgenda() {
    var r = rangeFor('agenda', C.date), html = '', any = false;
    for (var d = r[0]; d <= r[1]; d = addDays(d, 1)) {
      var items = onDay(d); if (!items.length) continue;
      any = true;
      html += '<section class="cal-a-day' + (d === today() ? ' is-today' : '') + '"><h3><button type="button" data-goto-day="' + d + '">' + fmtDay(d, { weekday: 'long', day: 'numeric', month: 'long' }) + '</button>' + (d === today() ? '<span>Today</span>' : '') + '</h3><ul>' +
        items.map(function (x) {
          var b = x.b;
          return '<li class="is-' + b.status + '"><button type="button" class="cal-a-row" data-open="' + b.id + '">' +
            '<time>' + (x.s[0] === 0 && x.s[1] === 1440 ? 'All day' : hm(x.s[0]) + '–' + hm(x.s[1])) + '</time>' +
            '<span class="cal-a-space"><i class="cal-dot" style="background:' + spaceColor[b.space] + '"></i>' + esc(spaceLabel[b.space]) + '</span>' +
            '<span class="cal-a-what"><strong>' + esc(label(b)) + '</strong>' + (b.status !== 'blocked' ? '<small>' + esc([b.kind && b.kind !== 'event' ? ({ class: 'Class', meeting: 'Meeting', other: 'Other' })[b.kind] + (b.series_id ? ' (weekly)' : '') : '', b.name, b.organization, b.participants ? b.participants + ' people' : ''].filter(Boolean).join(' · ')) + '</small>' : '') + '</span>' +
            '<span class="adm-pill is-' + b.status + '">' + STATUS_LABEL[b.status] + '</span></button>' +
            (b.status === 'pending' ? '<span class="cal-a-quick"><button type="button" class="btn btn-solid btn-sm" data-quick="approve" data-id="' + b.id + '">Approve</button><button type="button" class="btn btn-ghost btn-sm" data-act="review" data-id="' + b.id + '">Review</button></span>' : '') +
            '</li>';
        }).join('') + '</ul></section>';
    }
    return any ? html : '<div class="adm-empty"><strong>Nothing in the next 30 days.</strong><span>No bookings match the filters above.</span></div>';
  }

  // One-click approve at the estimated price (the review dialog is there for messages or a different price).
  $('#cal-body').addEventListener('click', function (e) {
    var go = e.target.closest('[data-goto-day]');
    if (go) { showDay(go.getAttribute('data-goto-day')); return; }
    var q = e.target.closest('[data-quick="approve"]');
    if (!q) return;
    var b = cache[q.getAttribute('data-id')];
    if (!confirm('Approve "' + label(b) + '" (' + when(b) + ') at ' + chf(b.price_estimate) + '?\nThe requester gets the approval email.')) return;
    q.disabled = true;
    api('POST', null, { action: 'approve', id: b.id }).then(function () { toast('Approved. Confirmation sent.'); refresh(); })
      .catch(function (err) { toast(err.message, true); q.disabled = false; });
  });

  // ---- keyboard shortcuts (calendar tab only, never while typing or in a dialog)
  document.addEventListener('keydown', function (e) {
    if (view !== 'calendar' || e.metaKey || e.ctrlKey || e.altKey || document.querySelector('dialog[open]')) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    var k = e.key.toLowerCase(), map = { m: 'month', w: 'week', d: 'day', a: 'agenda' };
    if (map[k]) setCalView(map[k]);
    else if (k === 't') { C.date = today(); loadCal(); }
    else if (e.key === 'ArrowLeft') step(-1);
    else if (e.key === 'ArrowRight') step(1);
    else if (k === 'b') openBlock(C.view === 'day' ? C.date : today());
    else if (k === 'n') openNew();
    else if (k === 'r') reloadCal();
    else if (e.key === '?') $('#cal-help').showModal();
    else return;
    e.preventDefault();
  });
  $('#cal-help-open').addEventListener('click', function () { $('#cal-help').showModal(); });
  $('#cal-help').addEventListener('click', function (e) { if (e.target === this || e.target.closest('[data-close]')) this.close(); });

  // ---- "Today at the space" panel on the Requests tab
  function loadToday() {
    var box = $('#adm-today'), d = today();
    api('GET', { from: d, to: d, status: 'approved,pending,blocked' }).then(function (res) {
      var items = remember(res.bookings).map(function (b) { return { b: b, s: seg(b, d) }; }).filter(function (x) { return x.s; })
        .sort(function (x, y) { return x.s[0] - y.s[0]; });
      var nowMin = local(new Date().toISOString()).min;
      box.innerHTML = '<div class="adm-today-head"><h2>Today at the space</h2><span class="adm-muted">' + fmtDay(d, { weekday: 'long', day: 'numeric', month: 'long' }) + '</span>' +
        '<button type="button" class="bk-link" data-cal-jump="' + d + '">Open in calendar</button></div>' +
        (items.length ? '<ul>' + items.map(function (x) {
          var live = x.s[0] <= nowMin && nowMin < x.s[1];
          return '<li class="is-' + x.b.status + (live ? ' is-live' : '') + '"><button type="button" data-open="' + x.b.id + '"><time>' + hm(x.s[0]) + '–' + hm(x.s[1]) + '</time>' +
            '<i class="cal-dot" style="background:' + spaceColor[x.b.space] + '"></i><span>' + esc(spaceLabel[x.b.space]) + '</span><strong>' + esc(label(x.b)) + '</strong>' +
            (live ? '<em>Now</em>' : '<span class="adm-pill is-' + x.b.status + '">' + STATUS_LABEL[x.b.status] + '</span>') + '</button></li>';
        }).join('') + '</ul>' : '<p class="adm-muted">Nothing booked today — the space is free.</p>');
    }).catch(function () { box.innerHTML = ''; });
  }
  document.addEventListener('click', function (e) {
    var j = e.target.closest('[data-cal-jump]'); if (!j) return;
    if (dlg.open) dlg.close();
    C.date = j.getAttribute('data-cal-jump'); C.view = 'day'; persist(); C.range = null; setView('calendar');
  });


  // ---------------------------------------------------------------- block time
  var blockDlg = $('#adm-block');
  function openBlock(date, from, to, space) {
    var f = $('#adm-block-form');
    f.reset();
    f.start_date.value = f.end_date.value = date || today();
    f.start_time.value = from || '08:00'; f.end_time.value = to || '20:00';
    f.space.value = space || (C.spaces.length === 1 ? C.spaces[0] : f.space.options[0].value);
    $('#adm-block-err').hidden = true;
    blockDlg.showModal(); f.note.focus();
  }
  $('#adm-block-open').addEventListener('click', function () { openBlock(); });
  $('#adm-block-cancel').addEventListener('click', function () { blockDlg.close(); });
  $('#adm-block-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target, btn = $('button[type=submit]', f); btn.disabled = true;
    api('POST', null, { action: 'block', space: f.space.value, start_date: f.start_date.value, start_time: f.start_time.value, end_date: f.end_date.value, end_time: f.end_time.value, note: f.note.value })
      .then(function () { blockDlg.close(); toast('Time blocked. It now shows as unavailable on the booking page.'); refresh(); })
      .catch(function (err) { var box = $('#adm-block-err'); box.textContent = err.message; box.hidden = false; })
      .then(function () { btn.disabled = false; });
  });

  // ---------------------------------------------------------------- new booking (one-off or weekly, e.g. a class)
  var newDlg = $('#adm-new'), nf = $('#adm-new-form'), KIND_LABEL = { class: 'Class', event: 'Event', meeting: 'Meeting', other: 'Other' };
  var preview = null; // sessions from the last "Check dates"
  function openNew(p) {
    p = p || {};
    nf.reset(); preview = null;
    var d = p.date || (C.view === 'day' ? C.date : today());
    nf.from.value = nf.date.value = d; nf.until.value = addDays(d, 7 * 12);
    $$('input[name=weekdays]', nf).forEach(function (c) { c.checked = c.value === fmtDay(d, { weekday: 'short' }); });
    if (p.start) nf.start_time.value = p.start; if (p.end) nf.end_time.value = p.end;
    nf.space.value = p.space || (C.spaces.length === 1 ? C.spaces[0] : nf.space.options[0].value);
    if (p.note) nf.event.value = p.note;
    syncNew(); newDlg.showModal(); nf.event.focus();
  }
  function syncNew() {
    var repeat = nf.repeat.checked;
    $('.adm-repeat', nf).hidden = !repeat; $('.adm-once', nf).hidden = repeat;
    nf.notify.disabled = !nf.email.value.trim();
    if (nf.notify.disabled) nf.notify.checked = false;
    preview = null; $('#adm-new-preview').innerHTML = ''; $('#adm-new-err').hidden = true;
    var save = $('#adm-new-save'); save.disabled = true; save.textContent = 'Create booking';
    $('#adm-new-check').hidden = false;
  }
  nf.addEventListener('change', function (e) {
    if (e.target.name === 'kind') nf.repeat.checked = e.target.value === 'class';
    if (e.target.name === 'from' && nf.repeat.checked && !$$('input[name=weekdays]:checked', nf).length) {
      var w = fmtDay(nf.from.value, { weekday: 'short' }); $$('input[name=weekdays]', nf).forEach(function (c) { c.checked = c.value === w; });
    }
    if (!e.target.closest('#adm-new-preview')) syncNew();
  });
  nf.addEventListener('input', function (e) { if (e.target.name === 'email') { nf.notify.disabled = !nf.email.value.trim(); } });
  function newPayload() {
    var p = { space: nf.space.value, start_time: nf.start_time.value, end_time: nf.end_time.value };
    if (nf.repeat.checked) { p.from = nf.from.value; p.until = nf.until.value; p.weekdays = $$('input[name=weekdays]:checked', nf).map(function (c) { return c.value; }); }
    else p.dates = [nf.date.value];
    return p;
  }
  function newError(msg) { var e = $('#adm-new-err'); e.textContent = msg; e.hidden = !msg; }
  $('#adm-new-check').addEventListener('click', function () {
    if (!nf.event.value.trim()) { newError('Please give the class or event a name.'); nf.event.focus(); return; }
    newError(''); var btn = this; btn.disabled = true;
    api('POST', null, Object.assign({ action: 'preview' }, newPayload())).then(function (d) {
      preview = d.sessions; renderPreview();
    }).catch(function (e) { newError(e.message); }).then(function () { btn.disabled = false; });
  });
  function renderPreview() {
    var clashes = preview.filter(function (x) { return x.clash; }).length, t = nf.start_time.value + '–' + nf.end_time.value;
    $('#adm-new-preview').innerHTML = '<p class="adm-preview-sum"><strong>' + preview.length + ' session' + (preview.length === 1 ? '' : 's') + '</strong> · ' + esc(spaceLabel[nf.space.value]) + ' · ' + t +
      (clashes ? ' · <span class="adm-warn">' + clashes + ' clash' + (clashes === 1 ? '' : 'es') + ' (will be skipped)</span>' : ' · <span class="adm-ok">all free</span>') + '</p>' +
      (preview.length > 1 ? '<p class="adm-muted">Untick any dates to leave out, such as holidays.</p>' : '') +
      '<ul>' + preview.map(function (x, i) {
        return '<li class="' + (x.clash ? 'is-clash' : '') + '"><label><input type="checkbox" data-i="' + i + '"' + (x.clash ? ' disabled' : ' checked') + '>' +
          '<span>' + fmtDay(x.date, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) + '</span>' +
          (x.clash ? '<em>Clashes with ' + esc(x.clash.label || x.clash.reference) + ' (' + STATUS_LABEL[x.clash.status].toLowerCase() + ')</em>' : '<em class="adm-ok">Free</em>') + '</label></li>';
      }).join('') + '</ul>';
    countPreview();
  }
  function chosen() { return $$('#adm-new-preview input[data-i]:checked').map(function (c) { return preview[+c.getAttribute('data-i')].date; }); }
  function countPreview() {
    var n = chosen().length, save = $('#adm-new-save');
    save.disabled = !n; save.textContent = n ? 'Create ' + n + ' booking' + (n === 1 ? '' : 's') : 'Nothing to create';
  }
  $('#adm-new-preview').addEventListener('change', countPreview);
  nf.addEventListener('submit', function (e) {
    e.preventDefault();
    if (!preview) { $('#adm-new-check').click(); return; }
    var dates = chosen(); if (!dates.length) return;
    var save = $('#adm-new-save'); save.disabled = true; newError('');
    var body = Object.assign(newPayload(), { action: 'create', dates: dates, kind: nf.kind.value, event: nf.event.value, name: nf.name.value, email: nf.email.value,
      organization: nf.organization.value, participants: nf.participants.value, phone: nf.phone.value, price: nf.price.value, note: nf.note.value, notify: nf.notify.checked });
    delete body.from; delete body.until; delete body.weekdays;
    api('POST', null, body).then(function (d) {
      newDlg.close();
      toast(d.bookings.length > 1 ? d.bookings.length + ' sessions booked' + (body.notify ? ' and the organizer has been emailed.' : '.') : 'Booking created.');
      C.date = dates[0]; if (view === 'calendar') { C.range = null; } refresh();
    }).catch(function (err) { newError(err.message); save.disabled = false; });
  });
  $('#adm-new-open').addEventListener('click', function () { openNew(); });
  newDlg.addEventListener('click', function (e) { if (e.target === newDlg || e.target.closest('[data-close]')) newDlg.close(); });
  $('#adm-block-to-new').addEventListener('click', function () {
    var f = $('#adm-block-form'), p = { date: f.start_date.value, start: f.start_time.value, end: f.end_time.value, space: f.space.value === 'all' ? '' : f.space.value, note: f.note.value };
    blockDlg.close(); openNew(p);
  });

  // In a booking's details: what series it belongs to, and cancelling the rest of it.
  function showSeries(b) {
    var box = $('#adm-series'); if (!box || !b.series_id) return;
    api('GET', { series: b.series_id }).then(function (d) {
      var all = d.bookings, live = all.filter(function (x) { return x.status === 'approved' || x.status === 'pending'; });
      var future = live.filter(function (x) { return Date.parse(x.starts_at) > Date.now(); });
      if (!all.length) return;
      var first = local(all[0].starts_at).date, last = local(all[all.length - 1].starts_at).date;
      box.innerHTML = '<p><strong>Weekly ' + esc((KIND_LABEL[b.kind] || 'booking').toLowerCase()) + '</strong> · ' + live.length + ' of ' + all.length + ' sessions active, ' +
        fmtDay(first, { day: 'numeric', month: 'short' }) + ' – ' + fmtDay(last, { day: 'numeric', month: 'short', year: 'numeric' }) + '</p>' +
        (future.length ? '<button type="button" class="btn btn-ghost btn-sm adm-danger" data-series-cancel="' + esc(b.series_id) + '" data-n="' + future.length + '">Cancel the ' + future.length + ' remaining session' + (future.length === 1 ? '' : 's') + '</button>' : '');
      box.hidden = false;
    }).catch(function () {});
  }
  document.addEventListener('click', function (e) {
    var c = e.target.closest('[data-series-cancel]'); if (!c) return;
    if (!confirm('Cancel all ' + c.getAttribute('data-n') + ' remaining sessions of this series? Past sessions stay as they are. No emails are sent.')) return;
    c.disabled = true;
    api('POST', null, { action: 'cancel_series', series_id: c.getAttribute('data-series-cancel') }).then(function (d) {
      dlg.close(); toast(d.cancelled + ' session' + (d.cancelled === 1 ? '' : 's') + ' cancelled.'); refresh();
    }).catch(function (err) { toast(err.message, true); c.disabled = false; });
  });

  // ---------------------------------------------------------------- list + CSV
  var listForm = $('#adm-filter'), lastList = [];
  listForm.from.value = addDays(today(), -30); listForm.to.value = addDays(today(), 180);
  listForm.addEventListener('submit', function (e) { e.preventDefault(); loadList(); });
  listForm.addEventListener('change', function (e) { if (e.target.name !== 'q') loadList(); });
  function loadList() {
    var f = listForm, p = {};
    if (f.from.value) p.from = f.from.value; if (f.to.value) p.to = f.to.value;
    if (f.status.value) p.status = f.status.value; if (f.space.value) p.space = f.space.value; if (f.q.value.trim()) p.q = f.q.value.trim();
    var box = $('#adm-list');
    box.innerHTML = '<p class="adm-muted">Loading…</p>';
    api('GET', p).then(function (d) {
      lastList = remember(d.bookings);
      $('#adm-list-count').textContent = lastList.length + ' booking' + (lastList.length === 1 ? '' : 's');
      if (!lastList.length) { box.innerHTML = '<div class="adm-empty"><span>No bookings match these filters.</span></div>'; return; }
      box.innerHTML = '<div class="adm-table-wrap"><table class="adm-table"><thead><tr><th>Reference</th><th>When</th><th>Space</th><th>Event</th><th>Requested by</th><th>Status</th><th class="num">Price</th></tr></thead><tbody>' +
        lastList.map(function (b) {
          return '<tr data-open="' + b.id + '" tabindex="0"><td class="mono">' + esc(b.reference) + '</td><td>' + esc(when(b)) + '</td><td>' + esc(spaceLabel[b.space] || b.space) + '</td>' +
            '<td>' + esc(b.status === 'blocked' ? (b.admin_note || 'Blocked') : b.event) + '</td><td>' + esc(b.name || b.decided_by) + (b.organization ? '<br><span class="adm-muted">' + esc(b.organization) + '</span>' : '') + '</td>' +
            '<td><span class="adm-pill is-' + b.status + '">' + STATUS_LABEL[b.status] + '</span></td><td class="num">' + (b.status === 'blocked' ? '' : chf(b.price_final != null ? b.price_final : b.price_estimate)) + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    }).catch(function (e) { box.innerHTML = '<p class="adm-error">' + esc(e.message) + '</p>'; });
  }
  $('#adm-list').addEventListener('keydown', function (e) {
    var tr = e.target.closest('tr[data-open]'); if (tr && e.key === 'Enter') openBooking(cache[tr.getAttribute('data-open')]);
  });
  $('#adm-csv').addEventListener('click', function () {
    var cols = ['reference', 'status', 'space', 'date', 'start', 'end', 'full_day', 'event', 'participants', 'name', 'email', 'phone', 'organization', 'first_time', 'price_estimate', 'price_final', 'admin_note', 'created_at', 'decided_by'];
    var rows = lastList.map(function (b) {
      var a = local(b.starts_at), z = local(b.ends_at);
      var v = Object.assign({}, b, { space: spaceLabel[b.space] || b.space, date: a.date, start: a.time, end: z.date === a.date ? z.time : z.date + ' ' + z.time });
      return cols.map(function (c) { var s = v[c] == null ? '' : String(v[c]); return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(',');
    });
    var blob = new Blob(['﻿' + [cols.join(',')].concat(rows).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'bookings-' + today() + '.csv'; a.click();
  });

  $('#adm-refresh').addEventListener('click', refresh);
  // Keep the inbox fresh while the tab stays open.
  setInterval(function () { if (!document.hidden && identity.currentUser() && !dlg.open && !blockDlg.open) refresh(); }, 120000);
})();
