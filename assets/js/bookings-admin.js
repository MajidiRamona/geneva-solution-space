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
    if (view === 'requests') loadRequests();
    if (view === 'calendar') loadWeek();
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
    var rows = [['Status', '<span class="adm-pill is-' + b.status + '">' + STATUS_LABEL[b.status] + '</span>'], ['Space', esc(spaceLabel[b.space] || b.space)], ['When', esc(when(b))]];
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

    $('#adm-dialog-body').innerHTML = '<p class="adm-ref">' + esc(b.reference) + '</p><h2>' + esc(b.status === 'blocked' ? (b.admin_note || 'Blocked time') : b.event) + '</h2>' +
      '<dl class="adm-dl">' + rows.filter(function (r) { return r[1]; }).map(function (r) { return '<div><dt>' + r[0] + '</dt><dd>' + r[1] + '</dd></div>'; }).join('') + '</dl>' +
      actions + '<p class="adm-error" id="adm-dialog-err" hidden></p>';
    dlg.setAttribute('data-id', b.id);
    if (!dlg.open) dlg.showModal();
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

  // ---------------------------------------------------------------- week calendar
  var weekStart = monday(today()), DAY_FROM = 7 * 60, DAY_TO = 22 * 60, PX = 44;
  $('#adm-week-prev').addEventListener('click', function () { weekStart = addDays(weekStart, -7); loadWeek(); });
  $('#adm-week-next').addEventListener('click', function () { weekStart = addDays(weekStart, 7); loadWeek(); });
  $('#adm-week-today').addEventListener('click', function () { weekStart = monday(today()); loadWeek(); });
  $('#adm-week-space').addEventListener('change', loadWeek);

  function loadWeek() {
    var end = addDays(weekStart, 6), sel = $('#adm-week-space').value;
    $('#adm-week-title').textContent = fmtDay(weekStart, { day: 'numeric', month: 'short' }) + ' – ' + fmtDay(end, { day: 'numeric', month: 'short', year: 'numeric' });
    var params = { from: weekStart, to: end, status: 'pending,approved,blocked' };
    if (sel !== 'all') params.space = sel;
    api('GET', params).then(function (d) { renderWeek(remember(d.bookings), sel); })
      .catch(function (e) { $('#adm-week').innerHTML = '<p class="adm-error">' + esc(e.message) + '</p>'; });
  }

  function renderWeek(list, sel) {
    var lanes = sel === 'all' ? spaces.map(function (s) { return s.key; }) : [sel];
    var hours = '', h;
    for (h = DAY_FROM; h < DAY_TO; h += 60) hours += '<div class="adm-hour" style="height:' + PX + 'px"><span>' + pad(h / 60) + ':00</span></div>';
    var html = '<div class="adm-week-grid" style="--lanes:' + lanes.length + '"><div class="adm-week-times"><div class="adm-week-dayhead"></div>' + hours + '</div>';
    for (var i = 0; i < 7; i++) {
      var day = addDays(weekStart, i);
      html += '<div class="adm-week-day' + (day === today() ? ' is-today' : '') + '"><div class="adm-week-dayhead">' + fmtDay(day, { weekday: 'short' }) + ' <b>' + fmtDay(day, { day: 'numeric' }) + '</b></div>' +
        '<div class="adm-week-col" data-date="' + day + '" style="height:' + ((DAY_TO - DAY_FROM) / 60 * PX) + 'px">';
      list.forEach(function (b) {
        var lane = lanes.indexOf(b.space); if (lane < 0) return;
        var ls = local(b.starts_at), le = local(b.ends_at);
        var from = ls.date < day ? 0 : ls.date > day ? null : ls.min;
        var to = le.date > day ? 1440 : le.date < day ? null : le.min;
        if (from == null || to == null || to <= from) return;
        var top = Math.max(from, DAY_FROM), bottom = Math.min(to, DAY_TO); if (bottom <= top) return;
        var label = b.status === 'blocked' ? (b.admin_note || 'Blocked') : b.event;
        html += '<button class="adm-ev is-' + b.status + '" data-open="' + b.id + '" style="top:' + ((top - DAY_FROM) / 60 * PX) + 'px;height:' + Math.max(18, (bottom - top) / 60 * PX - 2) + 'px;left:calc(' + lane + ' * 100% / var(--lanes) + 2px);width:calc(100% / var(--lanes) - 4px)" title="' + esc(label) + '">' +
          '<strong>' + esc(label) + '</strong><span>' + (sel === 'all' ? esc(spaceLabel[b.space]) + ' · ' : '') + (b.full_day ? 'Full day' : pad(Math.floor(from / 60)) + ':' + pad(from % 60) + '–' + pad(Math.floor(to / 60)) + ':' + pad(to % 60)) + '</span></button>';
      });
      html += '</div></div>';
    }
    $('#adm-week').innerHTML = html + '</div>';
  }

  // Click an empty spot in the week to block time from that hour.
  $('#adm-week').addEventListener('click', function (e) {
    if (e.target.closest('.adm-ev')) return;
    var col = e.target.closest('.adm-week-col'); if (!col) return;
    var y = e.clientY - col.getBoundingClientRect().top, h = Math.floor(DAY_FROM / 60 + y / PX);
    openBlock(col.getAttribute('data-date'), pad(h) + ':00', pad(Math.min(h + 1, 24)) + ':00');
  });

  // ---------------------------------------------------------------- block time
  var blockDlg = $('#adm-block');
  function openBlock(date, from, to) {
    var f = $('#adm-block-form');
    f.reset();
    f.start_date.value = f.end_date.value = date || today();
    f.start_time.value = from || '08:00'; f.end_time.value = to || '20:00';
    var sel = $('#adm-week-space').value; f.space.value = sel === 'all' ? f.space.options[0].value : sel;
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
