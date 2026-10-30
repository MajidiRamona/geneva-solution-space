// Reservations page: live availability, time selection, price estimate and the booking request.
// Rules and prices come from window.GSS_BOOKING (written by build.py from content/pages/reservations.json).
// All dates and times are Geneva time, whatever the visitor's own time zone.
(function () {
  var CFG = window.GSS_BOOKING;
  var root = document.getElementById('bk');
  if (!CFG || !root) return;

  var TZ = 'Europe/Zurich';
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var loadedAt = Date.now();
  var $ = function (sel, el) { return (el || root).querySelector(sel); };
  var $$ = function (sel, el) { return Array.prototype.slice.call((el || root).querySelectorAll(sel)); };

  // ---------------------------------------------------------------- dates
  function pad(n) { return String(n).padStart(2, '0'); }
  function hm(min) { return pad(Math.floor(min / 60)) + ':' + pad(min % 60); }
  function toMin(t) { return +t.slice(0, 2) * 60 + +t.slice(3, 5); }
  function noon(date) { return new Date(date + 'T12:00:00Z'); }
  function addDays(date, n) { var d = noon(date); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function weekday(date) { return DOW[noon(date).getUTCDay()]; }
  function fmtDate(date, opts) { return new Intl.DateTimeFormat('en-GB', Object.assign({ timeZone: 'UTC' }, opts)).format(noon(date)); }
  var longDate = function (d) { return fmtDate(d, { weekday: 'long', day: 'numeric', month: 'long' }); };
  var shortDate = function (d) { return fmtDate(d, { weekday: 'short', day: 'numeric', month: 'short' }); };
  var chf = function (n) { return 'CHF ' + Number(n).toLocaleString('de-CH'); };

  // Geneva wall-clock time of an instant, as "YYYY-MM-DD" + minutes.
  var genevaFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  function geneva(t) {
    var p = {}; genevaFmt.formatToParts(new Date(t)).forEach(function (x) { p[x.type] = x.value; });
    return { date: p.year + '-' + p.month + '-' + p.day, min: +p.hour * 60 + +p.minute };
  }
  var serverOffset = 0; // corrected from the server clock once availability loads
  function earliest() { return geneva(Date.now() + serverOffset + CFG.booking.min_notice_hours * 3600000); }
  function today() { return geneva(Date.now() + serverOffset).date; }
  function lastDate() { return addDays(today(), CFG.booking.max_advance_days); }

  // ---------------------------------------------------------------- state
  var spaces = {}; CFG.spaces.forEach(function (s) { spaces[s.key] = s; });
  var t0 = today();
  var S = {
    space: CFG.spaces[0].key, month: t0.slice(0, 7), date: null, start: null, end: null,
    fullDay: false, endDate: null, firstTime: false, step: 1, notice: null,
  };
  var busy = {};     // "space|YYYY-MM-DD" -> [[startMin, endMin, label, kind], ...]
  var loaded = {};   // "space|YYYY-MM" -> true | Promise
  var sp = function () { return spaces[S.space]; };

  // ---------------------------------------------------------------- availability
  function monthRange(month) {
    var first = month + '-01', y = +month.slice(0, 4), m = +month.slice(5, 7);
    return [first, new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)];
  }
  function load(space, month) {
    var key = space + '|' + month;
    if (loaded[key]) return loaded[key] === true ? Promise.resolve() : loaded[key];
    var r = monthRange(month);
    loaded[key] = fetch('/api/availability?space=' + space + '&from=' + r[0] + '&to=' + r[1])
      .then(function (res) { if (!res.ok) throw new Error(res.status); return res.json(); })
      .then(function (data) {
        if (data.now) serverOffset = Date.parse(data.now) - Date.now();
        for (var d = r[0]; d <= r[1]; d = addDays(d, 1)) busy[space + '|' + d] = [];
        data.busy.forEach(function (b) { busy[space + '|' + b.date].push([toMin(b.start), toMin(b.end), b.label || null, b.kind || 'pending']); });
        Object.keys(busy).forEach(function (k) { busy[k].sort(function (a, b) { return a[0] - b[0]; }); });
        loaded[key] = true;
      })
      .catch(function (e) { delete loaded[key]; throw e; });
    return loaded[key];
  }
  function reload(space, month) { delete loaded[space + '|' + month]; return load(space, month); }
  function isLoaded(space, date) { return loaded[space + '|' + date.slice(0, 7)] === true; }

  function isOpenDay(date, s) { s = s || sp(); return s.open_days.indexOf(weekday(date)) !== -1; }
  function slotFree(date, min, s) {
    s = s || sp();
    var e = earliest();
    if (date < e.date || (date === e.date && min < e.min)) return false;
    return !(busy[s.key + '|' + date] || []).some(function (b) { return b[0] < min + 60 && b[1] > min; });
  }
  function slotsOf(date, s) {
    s = s || sp(); var out = [];
    for (var m = toMin(s.open); m < toMin(s.close); m += 60) out.push(m);
    return out;
  }
  // "closed" | "out" | "full" | "partial" | "free" | "loading"
  function dayState(date) {
    if (date < today() || date > lastDate()) return 'out';
    if (!isOpenDay(date)) return 'closed';
    if (!isLoaded(S.space, date)) return 'loading';
    var slots = slotsOf(date), free = slots.filter(function (m) { return slotFree(date, m); }).length;
    if (!free) return (busy[S.space + '|' + date] || []).length ? 'full' : 'out'; // nothing booked: just too soon
    return free === slots.length ? 'free' : 'partial';
  }
  function dayFullyFree(date) { return dayState(date) === 'free'; }
  function rangeFree(date, from, to) {
    for (var m = from; m < to; m += 60) if (!slotFree(date, m)) return false;
    return true;
  }

  // ---------------------------------------------------------------- what is in the way
  // A busy entry is [startMin, endMin, label, kind]; kind is approved | pending | blocked.
  // Only approved bookings carry their event title; requests and staff blocks stay anonymous.
  function entries(date) { return busy[S.space + '|' + date] || []; }
  function clashesIn(date, from, to) { return entries(date).filter(function (b) { return b[0] < to && b[1] > from; }); }
  function span(b) { return hm(b[0]) + '–' + hm(Math.min(b[1], 1440)); }
  function tag(b) { return b[3] === 'approved' ? 'Confirmed' : b[3] === 'blocked' ? 'Reserved' : 'Awaiting confirmation'; }
  function what(b) { return b[3] === 'approved' ? (b[2] || 'Booked') : b[3] === 'blocked' ? 'Reserved by our team' : 'Requested'; }
  // One plain sentence about a clash, e.g. "“Open Lab” has the Ground Floor from 17:00 to 23:00."
  function sentence(b) {
    var t = hm(b[0]) + ' to ' + hm(Math.min(b[1], 1440));
    if (b[3] === 'blocked') return 'Our team has reserved the ' + sp().label + ' from ' + t + '.';
    if (b[3] === 'pending') return 'Someone has requested ' + t + ' and is waiting for confirmation. If it is declined, the time opens up again.';
    return (b[2] ? '“' + b[2] + '” has the ' : 'The ' + sp().label + ' is booked for an event ') + (b[2] ? sp().label + ' ' : '') + 'from ' + t + '.';
  }

  // The free start closest to `near` that fits `len` minutes on that day, or null.
  function freeWindow(date, len, near) {
    var s = sp(), best = null;
    if (!isOpenDay(date) || !isLoaded(S.space, date)) return null;
    for (var m = toMin(s.open); m + len <= toMin(s.close); m += 60)
      if (rangeFree(date, m, m + len) && (best == null || Math.abs(m - near) < Math.abs(best - near))) best = m;
    return best;
  }
  // One-tap fixes: same day nearby, the same hours on a later day, then the nearest free time.
  function suggest(date, start, len) {
    var out = [], seen = {}, m, d, i;
    function add(a) { var k = a.date + '|' + a.start; if (!seen[k] && out.length < 4) { seen[k] = 1; out.push(a); } }
    m = freeWindow(date, len, start);
    if (m != null) add({ date: date, start: m, end: m + len });
    for (i = 1, d = addDays(date, 1); i <= 28 && d <= lastDate(); i++, d = addDays(d, 1))
      if (isOpenDay(d) && isLoaded(S.space, d) && rangeFree(d, start, start + len)) { add({ date: d, start: start, end: start + len }); break; }
    for (i = 1, d = addDays(date, 1); i <= 28 && out.length < 3 && d <= lastDate(); i++, d = addDays(d, 1)) {
      m = freeWindow(d, len, start);
      if (m != null) add({ date: d, start: m, end: m + len });
    }
    return out.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : a.start - b.start; });
  }
  // Days after `date` that still have free hours (for fully booked days).
  function nextOpenDays(date) {
    var out = [];
    for (var i = 1, d = addDays(date, 1); i <= 28 && out.length < 3 && d <= lastDate(); i++, d = addDays(d, 1)) {
      var st = dayState(d);
      if (st === 'free' || st === 'partial') out.push({ date: d, pick: true });
    }
    return out;
  }

  // ---------------------------------------------------------------- price (mirrors netlify/functions/_lib/rules.ts)
  function openDaysBetween(a, b) { var n = 0; for (var d = a; d <= b; d = addDays(d, 1)) if (isOpenDay(d)) n++; return n; }
  function quote() {
    var s = sp(); if (!S.date) return null;
    var lines = [], base, oneDay;
    if (S.fullDay) {
      var days = openDaysBetween(S.date, S.endDate || S.date);
      base = days * s.rate_day; oneDay = s.rate_day;
      lines.push([days + (days > 1 ? ' days' : ' day') + ' × ' + chf(s.rate_day), base]);
    } else {
      if (S.start == null) return null;
      var hours = (S.end - S.start) / 60, hourly = hours * s.rate_hour;
      base = Math.min(hourly, s.rate_day); oneDay = base;
      lines.push([hours + (hours > 1 ? ' hours' : ' hour') + ' × ' + chf(s.rate_hour), hourly]);
      if (hourly > s.rate_day) lines.push(['Day rate cap', s.rate_day - hourly]);
    }
    var discount = S.firstTime ? Math.round(oneDay * CFG.booking.first_time_discount_percent / 100) : 0;
    if (discount) lines.push(['First-time discount (' + CFG.booking.first_time_discount_percent + '%' + (S.fullDay && S.endDate && S.endDate !== S.date ? ', one day' : '') + ')', -discount]);
    return { lines: lines, total: base - discount };
  }
  function whenText() {
    if (!S.date) return '';
    if (S.fullDay) return S.endDate && S.endDate !== S.date ? shortDate(S.date) + ' – ' + shortDate(S.endDate) + ', full days' : longDate(S.date) + ', full day';
    return S.start == null ? longDate(S.date) : longDate(S.date) + ', ' + hm(S.start) + '–' + hm(S.end);
  }
  function hasTime() { return !!S.date && (S.fullDay || S.start != null); }

  // ---------------------------------------------------------------- month calendar
  var grid = $('#bk-grid'), title = $('#bk-month');
  function renderMonth() {
    var y = +S.month.slice(0, 4), m = +S.month.slice(5, 7);
    title.textContent = MONTHS[m - 1] + ' ' + y;
    $('#bk-prev').disabled = S.month <= today().slice(0, 7);
    $('#bk-next').disabled = S.month >= lastDate().slice(0, 7);
    var html = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(function (d) { return '<span class="cal-dow" aria-hidden="true">' + d + '</span>'; }).join('');
    var first = S.month + '-01', offset = (noon(first).getUTCDay() + 6) % 7;
    for (var i = 0; i < offset; i++) html += '<span class="cal-pad"></span>';
    var days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    var label = { free: 'available', partial: 'some hours free', full: 'fully booked', closed: 'closed', out: 'not bookable', loading: 'loading' };
    for (var d = 1; d <= days; d++) {
      var date = S.month + '-' + pad(d), st = dayState(date);
      var cls = 'cal-day is-' + st;
      if (date === today()) cls += ' is-today';
      if (date === S.date) cls += ' is-selected';
      if (S.fullDay && S.endDate && date > S.date && date <= S.endDate) cls += date === S.endDate ? ' is-selected is-range-end' : ' is-in-range';
      // Fully booked days stay clickable so people can see what is on and jump to a free day.
      var disabled = st === 'out' || st === 'closed' || st === 'loading';
      var on = (st === 'full' || st === 'partial') ? entries(date).map(function (b) { return span(b) + ' ' + what(b); }).join('\n') : '';
      html += '<button type="button" class="' + cls + '" data-date="' + date + '"' + (disabled ? ' disabled' : '') + (on ? ' title="' + esc(on) + '"' : '') +
        ' aria-label="' + longDate(date) + ', ' + label[st] + '"' + (date === S.date ? ' aria-pressed="true"' : '') + '><span>' + d + '</span><i aria-hidden="true"></i></button>';
    }
    grid.innerHTML = html;
    grid.setAttribute('aria-busy', isLoaded(S.space, S.month + '-01') ? 'false' : 'true');
  }

  function showMonth() {
    renderMonth();
    var space = S.space, month = S.month;
    $('#bk-cal-error').hidden = true;
    load(space, month).then(function () {
      if (S.space === space && S.month === month) { renderMonth(); renderDay(); }
    }).catch(function () {
      if (S.space === space && S.month === month) $('#bk-cal-error').hidden = false;
    });
    // Prefetch the next month so paging feels instant.
    var y = +month.slice(0, 4), m = +month.slice(5, 7), next = m === 12 ? (y + 1) + '-01' : y + '-' + pad(m + 1);
    if (next <= lastDate().slice(0, 7)) load(space, next).catch(function () {});
  }

  grid.addEventListener('click', function (e) {
    var b = e.target.closest('.cal-day'); if (!b || b.disabled) return;
    pickDate(b.getAttribute('data-date'));
  });
  $('#bk-prev').addEventListener('click', function () { shiftMonth(-1); });
  $('#bk-next').addEventListener('click', function () { shiftMonth(1); });
  function shiftMonth(n) {
    var y = +S.month.slice(0, 4), m = +S.month.slice(5, 7) - 1 + n;
    S.month = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
    showMonth();
  }

  function pickDate(date) {
    S.notice = null;
    // In whole-day mode, a later date extends the booking over several days.
    if (S.fullDay && S.date && date > S.date && !S.endDate) {
      for (var d = S.date; d <= date; d = addDays(d, 1)) {
        if (isOpenDay(d) && !dayFullyFree(d)) {
          var b = entries(d)[0], last = addDays(d, -1);
          while (last > S.date && !isOpenDay(last)) last = addDays(last, -1);
          S.notice = {
            title: shortDate(d) + ' is not free all day',
            text: b ? sentence(b) : 'Bookings for that day are not open yet.',
            alts: last > S.date ? [{ date: S.date, endDate: last, full: true, text: shortDate(S.date) + ' – ' + shortDate(last) + ' · full days' }] : [],
          };
          renderAll(); return;
        }
      }
      S.endDate = date; renderAll(); return;
    }
    S.date = date; S.endDate = null; S.start = S.end = null;
    if (S.fullDay && !dayFullyFree(date)) S.fullDay = false;
    if (dayState(date) === 'full') {
      var later = nextOpenDays(date);
      S.notice = { title: longDate(date) + ' is fully booked', text: later.length ? 'You can see what is on below. These days still have free hours:' : 'You can see what is on below. Try a later month on the calendar.', alts: later };
    }
    renderAll();
    if (window.matchMedia('(max-width: 1100px)').matches) $('#bk-day').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ---------------------------------------------------------------- day timeline
  var dragAnchor = null;
  function renderDay() {
    var box = $('#bk-day'), s = sp();
    if (!S.date) {
      box.innerHTML = '<div class="bk-empty"><p class="eyebrow">Step 1</p><p>Choose a day on the calendar to see the free hours.</p></div>';
      return;
    }
    var canFull = dayFullyFree(S.date), today_ = entries(S.date);
    var head = '<div class="bk-day-head"><div><p class="eyebrow">' + s.label + ' · ' + s.open + '–' + s.close + '</p><h3>' + longDate(S.date) + '</h3></div>' +
      '<button type="button" class="bk-switch" role="switch" id="bk-fullday" aria-checked="' + S.fullDay + '"' + (canFull ? '' : ' disabled aria-describedby="bk-agenda"') + '><span class="bk-switch-track"><span></span></span>Whole day</button></div>';
    if (today_.length) {
      head += '<div class="bk-agenda" id="bk-agenda"><p>Already on this day' + (canFull ? '' : ' · whole-day booking not possible') + '</p><ul>' + today_.map(function (b) {
        return '<li class="is-' + b[3] + '"><time>' + span(b) + '</time><span>' + esc(what(b)) + '</span><em>' + tag(b) + '</em></li>';
      }).join('') + '</ul></div>';
    }
    if (S.fullDay) {
      var multi = S.endDate && S.endDate !== S.date;
      box.innerHTML = head + '<div class="bk-fullday-card"><strong>' + (multi ? shortDate(S.date) + ' – ' + shortDate(S.endDate) : 'Full day') + '</strong><span>' + s.open + '–' + s.close + (multi ? ' each open day' : '') + '</span>' +
        '<p>' + (multi ? '<button type="button" class="bk-link" id="bk-oneday">Back to a single day</button>' : 'Need several days in a row? Pick the last day on the calendar.') + '</p></div>';
    } else {
      var open = toMin(s.open);
      var rows = slotsOf(S.date).map(function (m) {
        var free = slotFree(S.date, m), sel = S.start != null && m >= S.start && m < S.end;
        var b = clashesIn(S.date, m, m + 60)[0];
        var cls = 'bk-slot' + (sel ? ' is-selected' : '') + (free ? '' : b ? ' is-booked is-' + b[3] : ' is-unavailable');
        if (sel && m === S.start) cls += ' is-first'; if (sel && m + 60 === S.end) cls += ' is-last';
        var text = sel ? 'Selected' : free ? 'Available' : b ? '' : 'Too soon', aria = text.toLowerCase();
        if (!free && b) {
          // A booking spanning several hours reads as one block: its name on the first hour only.
          var starts = b[0] >= m || m === open;
          if (!starts) cls += ' is-cont';
          if (b[1] > m + 60) cls += ' has-next';
          text = starts ? what(b) + ' · ' + span(b) : '';
          aria = 'taken, ' + what(b) + ' ' + span(b) + ', ' + tag(b).toLowerCase() + '. Select for other times';
        }
        // Booked hours stay focusable: selecting one explains the clash and offers other times.
        return '<button type="button" class="' + cls + '" data-min="' + m + '"' + (free || b ? '' : ' disabled') + (b && !free ? ' aria-disabled="true"' : '') +
          ' aria-pressed="' + sel + '" aria-label="' + hm(m) + ' to ' + hm(m + 60) + ', ' + esc(aria) + '">' +
          '<span class="bk-slot-time">' + hm(m) + '</span><span class="bk-slot-bar"><span class="bk-slot-label">' + esc(text) + '</span></span></button>';
      }).join('');
      var hint = S.start == null ? 'Choose a start time, then an end time' + (window.matchMedia('(pointer: fine)').matches ? ', or drag across the hours.' : '.') :
        'Choose a later hour to change the end, or a time inside your selection to start again.';
      box.innerHTML = head + '<p class="bk-hint">' + hint + '</p><div class="bk-slots" id="bk-slots">' + rows + '</div>';
    }
  }

  // A click after the current selection extends it; any other click starts a new one there.
  function selectSlot(m) {
    var s = sp(), minLen = s.min_hours * 60;
    S.notice = null;
    if (S.start != null && m >= S.end) {
      if (rangeFree(S.date, S.start, m + 60)) S.end = m + 60;
      else {
        var c = clashesIn(S.date, S.end, m + 60)[0], len = m + 60 - S.start, alts = [];
        if (c && c[0] > S.end) alts.push({ date: S.date, start: S.start, end: c[0], text: 'Keep ' + hm(S.start) + '–' + hm(c[0]) });
        S.notice = {
          title: 'That would run into another booking',
          text: (c ? sentence(c) + ' ' : '') + 'Your booking can last until ' + hm(c ? c[0] : S.end) + ' at the latest, or pick a time that fits:',
          alts: alts.concat(suggest(S.date, S.start, len)).slice(0, 4),
        };
      }
    } else {
      S.start = m; S.end = m + minLen;
      if (S.end > toMin(s.close) || !rangeFree(S.date, S.start, S.end)) {
        var c2 = clashesIn(S.date, m, m + minLen)[0], fix = suggest(S.date, m, minLen);
        S.start = S.end = null;
        S.notice = {
          title: 'Not enough free time from ' + hm(m),
          text: (c2 ? sentence(c2) + ' ' : 'We close at ' + s.close + '. ') + 'Bookings are at least ' + s.min_hours + ' hour' + (s.min_hours > 1 ? 's' : '') + '.' + (fix.length ? ' These times work:' : ''),
          alts: fix,
        };
      }
    }
    renderAll();
  }

  // Someone tapped an hour that is already taken: say by what, and offer the nearest times that work.
  function explainBooked(m) {
    var b = clashesIn(S.date, m, m + 60)[0]; if (!b) return;
    var len = S.start != null ? S.end - S.start : sp().min_hours * 60, near = S.start != null ? S.start : m;
    var alts = suggest(S.date, near, len);
    S.notice = {
      title: span(b) + ' is taken',
      text: sentence(b) + (alts.length ? ' Here are the nearest free times:' : ' There is no free time nearby; try another day on the calendar.'),
      alts: alts,
    };
    renderAll();
    var box = $('#bk-notice'); if (box.getBoundingClientRect().top < 0) box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  var dragged = false;
  root.addEventListener('click', function (e) {
    var t = e.target;
    if (dragged) { dragged = false; return; }
    var slot = t.closest('.bk-slot');
    if (slot && slot.classList.contains('is-booked')) explainBooked(+slot.getAttribute('data-min'));
    else if (slot && !slot.disabled) selectSlot(+slot.getAttribute('data-min'));
    if (t.closest('#bk-fullday')) {
      S.fullDay = !S.fullDay; S.endDate = null; S.start = S.end = null; S.notice = null; renderAll();
      $('#bk-fullday').focus();
    }
    if (t.closest('#bk-oneday')) { S.endDate = null; renderAll(); }
    var alt = t.closest('[data-alt]');
    if (alt && S.notice && S.notice.alts) {
      var a = S.notice.alts[+alt.getAttribute('data-alt')];
      S.notice = null; S.month = a.date.slice(0, 7);
      if (a.pick) { showMonth(); pickDate(a.date); return; }
      S.date = a.date; S.fullDay = !!a.full; S.start = a.full ? null : a.start; S.end = a.full ? null : a.end;
      S.endDate = a.endDate || null;
      showMonth(); renderAll();
      var picked = $('#bk-day'); if (picked) picked.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  });

  // Drag across hours with a mouse or pen (on touch screens, tap a start and an end instead).
  root.addEventListener('pointerdown', function (e) {
    dragged = false;
    var slot = e.target.closest('.bk-slot');
    if (!slot || slot.disabled || slot.classList.contains('is-booked') || e.button > 0 || e.pointerType === 'touch') return;
    dragAnchor = +slot.getAttribute('data-min');
  });
  root.addEventListener('pointermove', function (e) {
    if (dragAnchor == null || !e.buttons) return;
    var el = document.elementFromPoint(e.clientX, e.clientY), slot = el && el.closest('.bk-slot');
    if (!slot || slot.disabled || slot.classList.contains('is-booked')) return;
    var m = +slot.getAttribute('data-min'), a = Math.min(dragAnchor, m), b = Math.max(dragAnchor, m) + 60;
    if (m === dragAnchor || !rangeFree(S.date, a, b)) return;
    if (S.start === a && S.end === Math.max(b, a + sp().min_hours * 60)) return;
    e.preventDefault();
    dragged = true;
    S.start = a; S.end = Math.max(b, a + sp().min_hours * 60); S.notice = null;
    if (!rangeFree(S.date, S.start, S.end)) S.end = b;
    renderAll();
  });
  document.addEventListener('pointerup', function () { dragAnchor = null; });

  // ---------------------------------------------------------------- summary
  function renderSummary() {
    var s = sp(), q = quote();
    $('#bk-sum-space').textContent = s.label;
    $('#bk-sum-when').textContent = hasTime() ? whenText() : 'Choose a day and time';
    $('#bk-sum-when').classList.toggle('is-muted', !hasTime());
    $('#bk-sum-lines').innerHTML = q ? q.lines.map(function (l) {
      return '<li><span>' + l[0] + '</span><span>' + (l[1] < 0 ? '−' + chf(-l[1]) : chf(l[1])) + '</span></li>';
    }).join('') : '';
    $('#bk-sum-total').textContent = q ? chf(q.total) : '—';
    var next = $('#bk-next-step');
    next.hidden = S.step > 2;
    next.disabled = S.step === 1 && !hasTime();
    next.textContent = S.step === 1 ? 'Continue' : 'Review request';
    $('#bk-back').hidden = S.step === 1 || S.step > 3;
    $('#bk-summary').hidden = S.step === 4;
  }

  // ---------------------------------------------------------------- steps
  function goStep(n) {
    if (n === 2 && !hasTime()) return;
    if (n === 3 && !validDetails()) return;
    S.step = n;
    $$('.bk-panel').forEach(function (p) { p.hidden = +p.getAttribute('data-step') !== n; });
    $$('.bk-steps li').forEach(function (li, i) {
      li.classList.toggle('is-current', i + 1 === n); li.classList.toggle('is-done', i + 1 < n);
      var btn = li.querySelector('button'); btn.disabled = i + 1 >= n || n === 4;
      if (i + 1 === n) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
    });
    if (n === 3) renderReview();
    renderSummary();
    var top = root.getBoundingClientRect().top;
    if (top < 0) root.scrollIntoView({ behavior: 'smooth', block: 'start' });
    var focusEl = $('.bk-panel[data-step="' + n + '"] h3, .bk-panel[data-step="' + n + '"] h2');
    if (focusEl) { focusEl.setAttribute('tabindex', '-1'); focusEl.focus({ preventScroll: true }); }
  }
  $('#bk-next-step').addEventListener('click', function () { goStep(S.step + 1); });
  $('#bk-back').addEventListener('click', function () { goStep(S.step - 1); });
  $$('.bk-steps button').forEach(function (b, i) { b.addEventListener('click', function () { goStep(i + 1); }); });

  // ---------------------------------------------------------------- details form
  var form = $('#bk-form');
  function fieldError(name, msg) {
    var input = form.elements[name]; if (!input) return;
    var label = input.closest('label'), err = label.querySelector('.bk-err');
    if (!err) { err = document.createElement('span'); err.className = 'bk-err'; err.id = 'err-' + name; label.appendChild(err); }
    err.textContent = msg || ''; err.hidden = !msg;
    input.setAttribute('aria-invalid', msg ? 'true' : 'false');
    if (msg) input.setAttribute('aria-describedby', err.id); else input.removeAttribute('aria-describedby');
  }
  function validDetails() {
    var first = null;
    ['name', 'email', 'event', 'participants', 'plan'].forEach(function (n) {
      var el = form.elements[n], msg = '';
      if (!el.checkValidity()) {
        if (el.validity.valueMissing) msg = 'This field is required.';
        else if (el.validity.typeMismatch) msg = 'Please enter a valid email address.';
        else if (el.validity.rangeOverflow) msg = sp().label + ' holds up to ' + sp().capacity + ' people.';
        else if (el.validity.tooShort) msg = 'Please add a little more detail.';
        else msg = el.validationMessage;
      }
      fieldError(n, msg);
      if (msg && !first) first = el;
    });
    if (first) { first.focus(); return false; }
    return true;
  }
  form.addEventListener('input', function (e) {
    if (e.target.getAttribute('aria-invalid') === 'true' && e.target.checkValidity()) fieldError(e.target.name, '');
    if (e.target.name === 'first_time') { S.firstTime = e.target.checked; renderSummary(); }
  });
  form.addEventListener('submit', function (e) { e.preventDefault(); goStep(3); });

  // ---------------------------------------------------------------- review & send
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function renderReview() {
    var f = form.elements;
    var rows = [['Space', sp().label], ['When', whenText()], ['Event', f.event.value], ['Participants', f.participants.value],
      ['Name', f.name.value], ['Email', f.email.value], ['Phone', f.phone.value], ['Organization', f.organization.value],
      ['First booking with us', S.firstTime ? 'Yes' : 'No'], ['Plans', f.plan.value]];
    $('#bk-review').innerHTML = rows.filter(function (r) { return r[1]; }).map(function (r) {
      return '<div><dt>' + r[0] + '</dt><dd>' + esc(r[1]).replace(/\n/g, '<br>') + '</dd></div>';
    }).join('');
    $('#bk-send-error').hidden = true;
  }

  var sendBtn = $('#bk-send');
  $('#bk-confirm').addEventListener('submit', function (e) {
    e.preventDefault();
    var rules = $('#bk-rules');
    if (!rules.checked) { $('#bk-rules-err').hidden = false; rules.focus(); return; }
    $('#bk-rules-err').hidden = true;
    var f = form.elements;
    var body = {
      space: S.space, date: S.date, full_day: S.fullDay, end_date: S.endDate || S.date,
      start: S.start == null ? null : hm(S.start), end: S.end == null ? null : hm(S.end),
      name: f.name.value, email: f.email.value, phone: f.phone.value, organization: f.organization.value,
      event: f.event.value, participants: +f.participants.value, plan: f.plan.value, first_time: S.firstTime,
      rules: true, website: f.website.value, elapsed: Date.now() - loadedAt,
    };
    sendBtn.disabled = true; sendBtn.classList.add('is-loading');
    fetch('/api/book', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (res) { return res.json().catch(function () { return {}; }).then(function (data) { return { status: res.status, data: data }; }); })
      .then(function (r) {
        if (r.status === 201 || (r.status === 200 && r.data.ok)) return done(r.data);
        if (r.status === 409 || (r.data.field === 'time')) {
          var month = S.date.slice(0, 7);
          return reload(S.space, month).then(function () {
            var alts = r.status === 409 ? alternatives() : [];
            var hit = r.status === 409 ? requestedClashes()[0] : null;
            S.notice = r.status === 409 ?
              { title: 'This time was just taken', text: (hit ? sentence(hit) + ' ' : '') + 'Your details are saved, so pick another time and send again.' + (alts.length ? ' Nearest free times:' : ''), alts: alts } :
              { text: r.data.error };
            if (r.status === 409) { S.start = S.end = null; S.fullDay = false; S.endDate = null; }
            S.month = month; renderMonth(); goStep(1); renderAll();
          });
        }
        if (r.data.errors) {
          goStep(2);
          Object.keys(r.data.errors).forEach(function (k) { fieldError(k, r.data.errors[k]); });
          return;
        }
        throw new Error(r.data.error || 'error');
      })
      .catch(function (err) {
        var box = $('#bk-send-error');
        box.innerHTML = (err && err.message && err.message !== 'error' && err.message.indexOf('fetch') === -1 ? esc(err.message) : 'Something went wrong while sending.') +
          ' Please try again, or email <a href="mailto:' + CFG.email + '">' + CFG.email + '</a>.';
        box.hidden = false;
      })
      .then(function () { sendBtn.disabled = false; sendBtn.classList.remove('is-loading'); });
  });

  // Nearest free times of the same length, from the chosen day onwards.
  function alternatives() {
    if (!S.fullDay) return suggest(S.date, S.start, S.end - S.start);
    var out = [], s = sp();
    for (var i = 0, d = S.date; i < 21 && out.length < 3 && d <= lastDate(); i++, d = addDays(d, 1))
      if (isOpenDay(d) && isLoaded(S.space, d) && dayFullyFree(d)) out.push({ date: d, start: toMin(s.open), end: toMin(s.close), full: true });
    return out;
  }
  // The bookings that overlap the time currently being requested.
  function requestedClashes() {
    if (!S.fullDay) return clashesIn(S.date, S.start, S.end);
    var out = [];
    for (var d = S.date; d <= (S.endDate || S.date); d = addDays(d, 1)) out = out.concat(entries(d));
    return out;
  }

  function done(data) {
    $('#bk-ref').textContent = data.reference;
    $('#bk-done-when').textContent = sp().label + ' · ' + whenText();
    $('#bk-done-email').textContent = form.elements.email.value;
    var a = $('#bk-ics');
    a.hidden = !data.starts_at;
    if (data.starts_at) {
      var ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Geneva Solution Space//Bookings//EN', 'BEGIN:VEVENT',
      'UID:' + data.reference + '@genevasolutionspace.org', 'DTSTAMP:' + stamp(new Date()),
      'DTSTART:' + stamp(new Date(data.starts_at)), 'DTEND:' + stamp(new Date(data.ends_at)),
      'SUMMARY:[Pending] ' + form.elements.event.value.replace(/[,;\\]/g, ' ') + ' · ' + sp().label,
      'LOCATION:' + CFG.location.replace(/[,;]/g, function (c) { return '\\' + c; }), 'STATUS:TENTATIVE',
      'DESCRIPTION:Booking request ' + data.reference + ' (awaiting confirmation)', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
      a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
      a.download = data.reference + '.ics';
    }
    S.step = 4;
    goStep(4);
    busy = {}; loaded = {}; // the new booking now occupies the space
  }
  function stamp(d) { return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); }

  $('#bk-again').addEventListener('click', function () {
    form.reset(); $('#bk-rules').checked = false;
    S.date = S.endDate = null; S.start = S.end = null; S.fullDay = false; S.firstTime = false; S.notice = null;
    goStep(1); showMonth(); renderAll();
  });

  // ---------------------------------------------------------------- space switch (tabs above)
  document.querySelectorAll('.space-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var key = btn.getAttribute('data-space');
      if (key === S.space) return;
      S.space = key;
      document.querySelectorAll('.space-btn').forEach(function (b) { var on = b === btn; b.classList.toggle('is-active', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); });
      document.querySelectorAll('.space-desc').forEach(function (p) { p.hidden = p.getAttribute('data-for') !== key; });
      var photo = document.getElementById('space-photo');
      if (photo) { photo.src = photo.getAttribute('data-' + key); photo.alt = photo.getAttribute('data-' + key + '-alt') || ''; }
      // Keep the chosen day if the new space is open then; times are re-checked against its bookings.
      if (S.date && !isOpenDay(S.date)) S.date = null;
      S.start = S.end = null; S.fullDay = false; S.endDate = null; S.notice = null;
      form.elements.participants.max = sp().capacity;
      if (S.step > 1) goStep(1);
      showMonth(); renderAll();
    });
  });

  // ---------------------------------------------------------------- notices
  function renderNotice() {
    var box = $('#bk-notice'), n = S.notice;
    box.hidden = !n;
    if (!n) return;
    box.innerHTML = (n.title ? '<p class="bk-notice-title">' + esc(n.title) + '</p>' : '') + '<p>' + esc(n.text) + '</p>' +
      (n.alts && n.alts.length ? '<div class="bk-alts">' + n.alts.map(function (a, i) {
        var label = a.text || (a.pick ? shortDate(a.date) : (a.date === S.date ? 'Same day' : shortDate(a.date)) + ' · ' + (a.full ? 'full day' : hm(a.start) + '–' + hm(a.end)));
        return '<button type="button" class="bk-chip" data-alt="' + i + '">' + esc(label) + '</button>';
      }).join('') + '</div>' : '');
  }

  function renderAll() { renderMonth(); renderDay(); renderNotice(); renderSummary(); }

  root.classList.add('is-ready');
  // /reservations/?space=fablab opens with that space chosen (linked from The Space page).
  var wanted = new URLSearchParams(location.search).get('space'), tab = wanted && document.querySelector('.space-btn[data-space="' + wanted + '"]');
  if (tab && wanted !== S.space) tab.click();
  form.elements.participants.max = sp().capacity;
  showMonth();
  renderAll();
})();
