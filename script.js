// Mobile navigation toggle
(function () {
  var toggle = document.getElementById('nav-toggle');
  var links = document.getElementById('nav-links');
  if (!toggle || !links) return;
  toggle.addEventListener('click', function () {
    var open = links.classList.toggle('open');
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  });
  links.addEventListener('click', function (e) {
    if (e.target.tagName === 'A') {
      links.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
    }
  });
})();

// Ticker: duplicate the list once so the marquee loops seamlessly
(function () {
  var track = document.querySelector('.ticker-track');
  var list = track && track.querySelector('.ticker-list');
  if (!list) return;
  var clone = list.cloneNode(true);
  clone.setAttribute('aria-hidden', 'true');
  track.appendChild(clone);
})();


// Section reveals
(function () {
  var els = document.querySelectorAll('.reveal');
  if (!els.length) return;
  if (!('IntersectionObserver' in window) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) { document.documentElement.classList.add('no-io'); return; }
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
  }, { rootMargin: '0px 0px -10% 0px', threshold: 0.05 });
  els.forEach(function (el) { io.observe(el); });
})();

// Stats count up once
(function () {
  var stats = document.querySelectorAll('.stat-n');
  if (!stats.length || !('IntersectionObserver' in window) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return; io.unobserve(e.target);
      e.target.childNodes.forEach(function (node) {
        if (node.nodeType !== 3 || !/\d/.test(node.textContent)) return;
        var target = parseInt(node.textContent.replace(/\D/g, ''), 10), start = null, dur = 1100;
        function step(t) { if (start === null) start = t; var p = Math.min(1, (t - start) / dur); p = 1 - Math.pow(1 - p, 3); node.textContent = String(Math.round(target * p)); if (p < 1) requestAnimationFrame(step); }
        requestAnimationFrame(step);
      });
    });
  }, { threshold: 0.4 });
  stats.forEach(function (s) { io.observe(s); });
})();

// Partner list highlights the matching logo on the wheel
(function () {
  var ring = document.querySelector('.ring'); if (!ring) return;
  document.querySelectorAll('.partner-list li[data-partner]').forEach(function (li) {
    var logo = ring.querySelector('.logo[data-partner="' + li.getAttribute('data-partner') + '"]'); if (!logo) return;
    li.addEventListener('mouseenter', function () { logo.classList.add('is-linked'); ring.classList.add('is-paused'); });
    li.addEventListener('mouseleave', function () { logo.classList.remove('is-linked'); ring.classList.remove('is-paused'); });
  });
})();


// Partner detail panel inside the wheel: opens from a wheel logo or a list name
(function () {
  var panel = document.getElementById('partner-panel'), dataEl = document.getElementById('partner-data'), wheel = document.querySelector('.wheel');
  if (!panel || !dataEl || !wheel) return;
  var data = JSON.parse(dataEl.textContent), ring = wheel.querySelector('.ring'), current = null;
  function clearActive() {
    document.querySelectorAll('.partner-list li.is-active').forEach(function (li) { li.classList.remove('is-active'); });
    wheel.querySelectorAll('.logo.is-linked').forEach(function (l) { l.classList.remove('is-linked'); });
  }
  function open(slug) {
    var p = data[slug]; if (!p) return;
    clearActive(); current = slug;
    var logo = document.getElementById('pd-logo'); logo.src = p.logo; logo.alt = p.name + ' logo';
    document.getElementById('pd-name').textContent = p.name; document.getElementById('pd-desc').textContent = p.desc;
    var a = document.getElementById('pd-link');
    if (p.url) { a.href = p.url; a.textContent = 'Visit ' + (p.domain || p.url.replace(/^https?:\/\//, '').replace(/\/$/, '')) + ' ↗'; a.hidden = false; } else { a.hidden = true; }
    var li = document.querySelector('.partner-list li[data-partner="' + slug + '"]'); if (li) li.classList.add('is-active');
    var lg = wheel.querySelector('.logo[data-partner="' + slug + '"]'); if (lg) lg.classList.add('is-linked');
    wheel.classList.add('is-dimmed'); if (ring) ring.classList.add('is-paused');
    panel.hidden = false;
    if (window.matchMedia('(max-width: 860px)').matches) panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  function close() {
    if (panel.hidden) return;
    panel.hidden = true; current = null; clearActive();
    wheel.classList.remove('is-dimmed'); if (ring) ring.classList.remove('is-paused');
  }
  panel.addEventListener('click', function (e) { if (e.target.closest('[data-close]')) close(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
  document.addEventListener('click', function (e) {
    if (panel.hidden) return;
    if (e.target.closest('.partner-panel, .partner-btn, .ring .logo')) return;
    close();
  });
  document.querySelectorAll('.partner-btn[data-open]').forEach(function (b) { b.addEventListener('click', function () { var s = b.getAttribute('data-open'); s === current ? close() : open(s); }); });
  wheel.querySelectorAll('.ring .logo[data-partner]').forEach(function (l) {
    l.addEventListener('click', function (e) { e.preventDefault(); var s = l.getAttribute('data-partner'); s === current ? close() : open(s); });
  });
})();
