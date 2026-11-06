// Blog post pages: reading progress bar, "On this page" highlighting, copy-link button.
(function () {
  var article = document.querySelector('.post-prose');
  if (!article) return;

  var bar = document.querySelector('.post-progress span');
  function progress() {
    var r = article.getBoundingClientRect(), total = r.height - window.innerHeight * 0.6;
    var done = Math.min(1, Math.max(0, -r.top / (total > 0 ? total : 1)));
    if (bar) bar.style.transform = 'scaleX(' + done + ')';
  }

  // Highlight the section being read in the table of contents.
  var links = Array.prototype.slice.call(document.querySelectorAll('.post-toc a'));
  var heads = links.map(function (a) { return document.getElementById(decodeURIComponent(a.getAttribute('href').slice(1))); });
  function current() {
    var i = -1;
    heads.forEach(function (h, n) { if (h && h.getBoundingClientRect().top < 140) i = n; });
    links.forEach(function (a, n) { a.classList.toggle('is-current', n === i); });
  }

  var queued = false;
  window.addEventListener('scroll', function () {
    if (queued) return;
    queued = true;
    requestAnimationFrame(function () { queued = false; progress(); current(); });
  }, { passive: true });
  progress(); current();

  var copy = document.querySelector('.post-copy');
  if (copy) copy.addEventListener('click', function () {
    var url = copy.getAttribute('data-url'), done = function () { copy.textContent = 'Link copied ✓'; setTimeout(function () { copy.textContent = 'Copy link'; }, 2200); };
    if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, function () { window.prompt('Copy this link:', url); });
    else window.prompt('Copy this link:', url);
  });
})();
