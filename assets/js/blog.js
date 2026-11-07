// Blog page: filter posts by type (News, Event, Story…). Without JavaScript every post simply shows.
(function () {
  var bar = document.querySelector('.blog-filter');
  if (!bar) return;
  bar.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-cat]'); if (!b) return;
    var cat = b.getAttribute('data-cat'), shown = 0;
    bar.querySelectorAll('button').forEach(function (x) { var on = x === b; x.classList.toggle('is-on', on); x.setAttribute('aria-pressed', on); });
    document.querySelectorAll('.news-card[data-cat]').forEach(function (c) {
      var ok = !cat || c.getAttribute('data-cat') === cat; c.hidden = !ok; if (ok) shown++;
    });
    document.querySelectorAll('.blog-year').forEach(function (y) { y.hidden = !y.querySelector('.news-card:not([hidden])'); });
    var jump = document.querySelector('.blog-jump'); if (jump) jump.hidden = !!cat;
    document.querySelector('.blog-empty').hidden = shown > 0;
  });
})();
