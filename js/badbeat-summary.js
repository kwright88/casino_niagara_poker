window.initBadBeatSummary = function initBadBeatSummary() {
  // ── BBJ Amount — fetch from data/badbeat.json ─────────────────────────────
  (function () {
    fetch('data/badbeat.json', {cache: 'no-cache'})
      .then(function(r){ if(!r.ok) throw new Error('HTTP '+r.status); return r.json(); })
      .then(function(d) {
        var s = d.summary;
        if (!s) return;
        var valEl  = document.getElementById('bbj-amount-val');
        var asofEl = document.getElementById('bbj-amount-asof');
        if (valEl && s.currentJackpot != null) {
          valEl.style.opacity = '';
          valEl.textContent = '$' + s.currentJackpot.toLocaleString('en-CA', {minimumFractionDigits:2, maximumFractionDigits:2});
        }
        if (asofEl) {
          var asof = s.currentDate || '';
          if (s.currentTime) asof += ' at ' + s.currentTime;
          asofEl.textContent = asof ? 'as of ' + asof : '';
        }
      })
      .catch(function() {
        var el = document.getElementById('bbj-amount-val');
        if (el) { el.style.opacity = ''; el.textContent = '—'; }
      });
  })();
};
