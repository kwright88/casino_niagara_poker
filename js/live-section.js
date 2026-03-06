window.initLiveSection = function initLiveSection() {
  // ── Live Section — fetch from data/live_games.json ───────────────────────
  (function () {
    function esc(s) {
      return String(s)
        .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
        .replace(/"/g,'&quot;');
    }

    function tableRow(name, limits, countVal, countLabel, countClass) {
      var limDiv = limits ? '<div class="ltr-limits">'+esc(limits)+'</div>' : '';
      return (
        '<div class="live-table-row">'+
          '<div><div class="ltr-game">'+esc(name)+'</div>'+limDiv+'</div>'+
          '<div class="ltr-right">'+
            '<div class="'+countClass+'">'+esc(String(countVal))+'</div>'+
            '<div class="ltr-count-label">'+countLabel+'</div>'+
          '</div>'+
        '</div>'
      );
    }

    function liveCard(games) {
      var rows = (!games || !games.length)
        ? '<div class="live-table-row empty"><div class="ltr-game ltr-empty-label">No active games</div></div>'
        : games.map(function(g){ return tableRow(g.name,g.limits,g.tables,'Tables','ltr-count'); }).join('');
      return '<div class="live-table-card"><div class="live-table-card-header"><span class="lh-icon">🟢</span> Live Games</div>'+rows+'</div>';
    }

    function waitlistCard(waitlist) {
      var rows = (!waitlist || !waitlist.length)
        ? '<div class="live-table-row empty"><div class="ltr-game ltr-empty-label">No waiting lists</div></div>'
        : waitlist.map(function(w){ return tableRow(w.name,w.limits,w.waiting,'Waiting','ltr-waiting-count'); }).join('');
      return '<div class="live-table-card"><div class="live-table-card-header"><span class="lh-icon">📋</span> Waiting Lists</div>'+rows+'</div>';
    }

    function errorCard() {
      return (
        '<div class="live-table-card live-error-full">'+
          '<div class="live-table-card-header"><span class="lh-icon">⚠️</span> Live Data Unavailable</div>'+
          '<div class="live-table-row"><div class="live-error-body">'+
            '<div class="ltr-game">Unable to retrieve live game data</div>'+
            '<div class="ltr-limits">Contact the poker room directly for up-to-date table info:</div>'+
            '<div class="ltr-limits ltr-note"><a href="tel:+19053537000" class="ltr-contact-link">(905) 353-7000</a></div>'+
            '<div class="ltr-limits ltr-note">or check the <a href="https://www.bravopokerlive.com/venues/casino-niagara/" target="_blank" class="ltr-contact-link">Bravo Poker App or Website</a></div>'+
          '</div></div>'+
        '</div>'
      );
    }

    function tournamentCard(t) {
      if (!t) return '';
      var name = t.name || '';
      var nameSuffix = name ? '<span class="lt-sep"> - </span><span class="lt-subtitle">'+esc(name)+'</span>' : '';
      var stats = [['🎯 Level',t.level],['Blinds',t.blinds],['⏱ Time Left',t.time_left]];
      if (t.num_entrants) stats.push(['Total Entries', t.num_entrants.toLocaleString()]);
      if (t.num_remaining) stats.push(['Players Left', t.num_remaining.toLocaleString()]);
      if (t.prize_pool != null) stats.push(['Prize Pool','$'+parseInt(t.prize_pool).toLocaleString()]);
      var statHtml = stats.map(function(p){
        return '<div class="tc-clock-stat"><span class="tc-clock-val">'+esc(String(p[1]))+'</span><span class="tc-clock-label">'+esc(p[0])+'</span></div>';
      }).join('');
      var paused = (t.clock_state==='P') ? ' <span class="tc-paused-badge">⏸ PAUSED</span>' : '';
      return (
        '<div class="live-tournament-wrapper">'+
          '<div class="live-table-card live-tournament-card">'+
            '<div class="live-table-card-header"><span class="lh-icon">🏆</span> Live Tournament'+paused+nameSuffix+'</div>'+
            '<div class="tc-clock-grid">'+statHtml+'</div>'+
          '</div>'+
        '</div>'
      );
    }

    function renderSection(data) {
      var gridHtml = data.error ? errorCard() : liveCard(data.games)+waitlistCard(data.waitlist);
      var tourneyHtml = data.tournament ? tournamentCard(data.tournament) : '';
      var staleBadge = data.stale
        ? ' <span style="color:#f4b400;font-weight:700;">(Stale)</span>'
        : '';
      return (
        '<div class="live-section-header">'+
          '<p class="section-title">Live Right Now <span class="live-call-cta">— Call <a href="tel:+19053537000">(905) 353-7000</a> to get on the list</span></p>'+
          '<span class="live-timestamp"><span class="live-dot"></span>As of '+esc(data.timestamp||'–')+staleBadge+'</span>'+
        '</div>'+
        '<div class="live-tables-grid">'+gridHtml+'</div>'+
        tourneyHtml
      );
    }

    var container = document.getElementById('live-section-container');
    if (!container) return;

    fetch('data/live_games.json', {cache: 'no-cache'})
      .then(function(r){ return r.json(); })
      .then(function(data){ container.innerHTML = renderSection(data); })
      .catch(function(){
        container.innerHTML = (
          '<div class="live-section-header">'+
            '<p class="section-title">Live Right Now <span class="live-call-cta">— Call <a href="tel:+19053537000">(905) 353-7000</a> to get on the list</span></p>'+
            '<span class="live-timestamp" style="opacity:0.5">Unavailable</span>'+
          '</div>'+
          '<div class="live-tables-grid">'+errorCard()+'</div>'
        );
      });
  })();
};
