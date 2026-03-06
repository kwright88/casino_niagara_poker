// index.js — page bootstrap for modular homepage scripts
(function () {
  if (typeof window.initLiveSection === 'function') {
    window.initLiveSection();
  }
  if (typeof window.initBadBeatSummary === 'function') {
    window.initBadBeatSummary();
  }
})();
