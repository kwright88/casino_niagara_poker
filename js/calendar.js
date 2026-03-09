  // ─────────────────────────────────────────────────────────────────────────────
  //  Calendar engine
  //
  //  Renders a 3-month carousel of tournament dates. Data comes from two sources:
  //    - data/calendar_config.json  (blackout dates + special event overrides)
  //    - Schedule rules baked into JS (Wed $300, Sun $400, Last Sun $550)
  //
  //  Recurring tournaments are auto-generated from day-of-week rules.
  //  Special events (multi-day main events) are defined in calendar_config.json
  //  and override normal day rules. Blackout dates dim/cross out regular events.
  // ─────────────────────────────────────────────────────────────────────────────

  const _today = new Date();
  const BASE_YEAR  = _today.getFullYear();
  const BASE_MONTH = _today.getMonth(); // 0-indexed (0 = January)

  // currentOffset: which month is displayed relative to the current month.
  // 0 = this month, 1 = next month, 2 = month after that. Max 3 months shown.
  let currentOffset = 0;

  const MONTH_NAMES = [
    'January','February','March','April','May','June',
    'July','August','September','October','November','December'
  ];

  // BLACKOUT_DATES: Set of 'YYYY-MM-DD' strings loaded from calendar_config.json.
  // On a blackout date, the regular tournament pill is shown dimmed with a red ✕.
  // SPECIAL_EVENTS: map of 'YYYY-MM-DD' → event array, also from calendar_config.json.
  // Special events replace the normal schedule entirely for that day (e.g. main event flights).
  let BLACKOUT_DATES = new Set();
  let SPECIAL_EVENTS = {};

  // Canonical date key used as a lookup string throughout this file.
  function dateKey(y, m, d) {
    return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  // Returns the day-of-month of the last Sunday in the given month.
  // Used to distinguish "Last Sunday $550" from regular "Sunday $400".
  function getLastSunday(year, month) {
    const last = new Date(year, month + 1, 0); // last day of month
    while (last.getDay() !== 0) last.setDate(last.getDate() - 1);
    return last.getDate();
  }

  // Build the array of cell objects for a given month.
  // Returns: [{ empty: true }, ..., { d, isToday, events: [...] }]
  // Event priority (highest wins): blackout > special event > regular schedule.
  function buildMonth(year, month) {
    const lastSun     = getLastSunday(year, month);
    const firstDow    = new Date(year, month, 1).getDay(); // 0 = Sunday, day the month starts on
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const cells = [];

    // Pad the start of the grid with empty cells so day 1 falls on the right column
    for (let i = 0; i < firstDow; i++) cells.push({ empty: true });

    for (let d = 1; d <= daysInMonth; d++) {
      const dow   = new Date(year, month, d).getDay(); // 0=Sun, 3=Wed
      const key   = dateKey(year, month, d);
      const isToday = (year === _today.getFullYear() &&
                       month === _today.getMonth() &&
                       d     === _today.getDate());

      let events = [];

      if (BLACKOUT_DATES.has(key)) {
        // Blackout: show the pill at reduced opacity with a red ✕ overlay.
        // Only Wed and Sun get blackout pills — other days have nothing to cancel.
        if (dow === 3) {
          events = [{ type:'wed', label:'Wednesday $300', sub:"12:30 PM · NL Hold'em", blackout:true }];
        } else if (dow === 0) {
          const label = d === lastSun ? 'Last Sunday $550' : 'Sunday $400';
          const type  = d === lastSun ? 'sun550' : 'sun';
          events = [{ type, label, sub:"12:30 PM · NL Hold'em", blackout:true }];
        }
      } else if (SPECIAL_EVENTS[key]) {
        // Special event (e.g. main event flight) replaces any recurring event for this day
        events = SPECIAL_EVENTS[key];
      } else if (dow === 0) {
        // Sunday: last Sunday of month gets the $550, all others get the $400
        if (d === lastSun) {
          events = [{ type:'sun550', label:'Last Sunday $550', sub:"12:30 PM · NL Hold'em" }];
        } else {
          events = [{ type:'sun', label:'Sunday $400', sub:"12:30 PM · NL Hold'em" }];
        }
      } else if (dow === 3) {
        // Wednesday $300
        events = [{ type:'wed', label:'Wednesday $300', sub:"12:30 PM · NL Hold'em" }];
      }

      cells.push({ d, isToday, events });
    }

    return cells;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  //  Render
  // ─────────────────────────────────────────────────────────────────────────────

  // Render the calendar grid for the given month offset.
  // direction: 1 = slide right (going forward), -1 = slide left (going back), 0 = no animation.
  function renderMonth(offset, direction) {
    const ref   = new Date(BASE_YEAR, BASE_MONTH + offset, 1);
    const year  = ref.getFullYear();
    const month = ref.getMonth();
    const cells = buildMonth(year, month);

    document.getElementById('cal-month-title').textContent = `${MONTH_NAMES[month]} ${year}`;

    // Sync carousel dot indicators to current offset
    document.querySelectorAll('.cal-dot').forEach((dot, i) => {
      dot.classList.toggle('active', i === offset);
    });

    // Disable prev/next buttons at the ends of the 3-month window
    document.getElementById('cal-prev').disabled = (offset === 0);
    document.getElementById('cal-next').disabled = (offset === 2);

    const grid = document.getElementById('cal-grid');

    // Remove stale animation classes, force a reflow, then re-add — this
    // ensures the CSS transition fires even when navigating in the same direction twice.
    grid.classList.remove('anim-right', 'anim-left');
    void grid.offsetWidth; // triggers reflow

    grid.innerHTML = cells.map(cell => {
      if (cell.empty) return '<div class="cal-cell empty"></div>';

      const cls = ['cal-cell'];
      if (cell.isToday) cls.push('today');

      const pills = cell.events.map(ev => {
        const dimAttr    = ev.dim     ? ' style="opacity:0.65"' : '';
        const blackoutCl = ev.blackout ? ' blackout' : '';
        const tipAttr    = ev.blackout ? ' data-tip="Events on this date are cancelled"' : '';
        return `<span class="tourney ${ev.type}${blackoutCl}"${dimAttr}${tipAttr}>${ev.label}<br>` +
               `<span class="time">${ev.sub}</span></span>`;
      }).join('');

      return `<div class="${cls.join(' ')}"><div class="day-num">${cell.d}</div>${pills}</div>`;
    }).join('');

    if (direction === 1)  grid.classList.add('anim-right');
    if (direction === -1) grid.classList.add('anim-left');

    // Pills are recreated on every render — event listeners must be re-attached each time
    attachPillEvents();
  }

  // ─────────────────────────────────────────────────────────────────────────────
  //  Carousel controls
  // ─────────────────────────────────────────────────────────────────────────────

  document.getElementById('cal-prev').addEventListener('click', () => {
    if (currentOffset > 0) { currentOffset--; renderMonth(currentOffset, -1); }
  });

  document.getElementById('cal-next').addEventListener('click', () => {
    if (currentOffset < 2) { currentOffset++; renderMonth(currentOffset, 1); }
  });

  // Dot click — jump directly to a month
  document.querySelectorAll('.cal-dot').forEach(dot => {
    dot.addEventListener('click', () => {
      const idx = parseInt(dot.dataset.idx, 10);
      if (idx === currentOffset) return;
      const dir = idx > currentOffset ? 1 : -1;
      currentOffset = idx;
      renderMonth(currentOffset, dir);
    });
  });

  // Left/right arrow key navigation
  document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' && currentOffset < 2) { currentOffset++; renderMonth(currentOffset,  1); }
    else if (e.key === 'ArrowLeft'  && currentOffset > 0) { currentOffset--; renderMonth(currentOffset, -1); }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  //  Highlight / dim system
  //
  //  Hovering or clicking a tournament pill (or detail card) highlights all
  //  instances of that tournament type and dims the others.
  //
  //  pinnedType: when set, hover events are ignored and the highlight stays
  //  locked until the user clicks the same type again or clicks outside.
  // ─────────────────────────────────────────────────────────────────────────────

  const TYPES = ['wed', 'sun', 'sun550', 'main'];
  let pinnedType = null;

  // Get all calendar pills of a given type (re-queried each time since grid is re-rendered)
  function getPills(type) {
    return document.querySelectorAll(`#cal-grid .tourney.${type}`);
  }
  // Get the detail card for a tournament type (static DOM — only queried once per call)
  function getCard(type) {
    return document.querySelector(`.detail-card[data-type="${type}"]`);
  }
  // Get all results table rows of a given type
  function getResultRows(type) {
    return document.querySelectorAll(`#results-tbody tr[data-type="${type}"]`);
  }

  // Highlight the active type and dim all others (pills, detail cards, and results rows)
  function applyHighlight(type) {
    TYPES.forEach(t => {
      const dim = t !== type;
      getPills(t).forEach(el => {
        el.classList.toggle('hl-active', !dim);
        el.classList.toggle('hl-dim',    dim);
      });
      const card = getCard(t);
      if (card) {
        card.classList.toggle('hl-active', !dim);
        card.classList.toggle('hl-dim',    dim);
      }
      // Results table rows
      getResultRows(t).forEach(el => {
        el.classList.toggle('hl-active', !dim);
        el.classList.toggle('hl-dim',    dim);
      });
    });
  }

  function clearHighlight() {
    document.querySelectorAll('.tourney, .detail-card').forEach(el => {
      el.classList.remove('hl-active', 'hl-dim', 'hl-pinned');
    });
    document.querySelectorAll('#results-tbody tr[data-type]').forEach(el => {
      el.classList.remove('hl-active', 'hl-dim', 'hl-pinned');
    });
  }

  // Resolve a tournament type from either a detail card (data-type attr) or a pill (CSS class)
  function getTypeFromEl(el) {
    if (el.dataset.type) return el.dataset.type;
    for (const t of TYPES) if (el.classList.contains(t)) return t;
    return null;
  }

  // Attach hover/click events to all pills in the current grid.
  // Must be called after every renderMonth() because the grid's innerHTML is replaced.
  function attachPillEvents() {
    document.querySelectorAll('#cal-grid .tourney').forEach(el => {
      el.style.cursor = 'pointer';
      el.addEventListener('mouseenter', () => {
        if (pinnedType) return; // don't override a pinned selection on hover
        const t = getTypeFromEl(el);
        if (t) applyHighlight(t);
      });
      el.addEventListener('mouseleave', () => {
        if (pinnedType) return;
        clearHighlight();
      });
      el.addEventListener('click', (e) => {
        e.stopPropagation(); // prevent the document click handler from immediately clearing
        const t = getTypeFromEl(el);
        if (!t) return;
        if (pinnedType === t) {
          // Clicking the same type again unpins it
          pinnedType = null;
          clearHighlight();
        } else {
          pinnedType = t;
          clearHighlight();
          applyHighlight(t);
          getPills(t).forEach(p => p.classList.add('hl-pinned'));
          const card = getCard(t);
          if (card) card.classList.add('hl-pinned');
          getResultRows(t).forEach(r => r.classList.add('hl-pinned'));
        }
      });

      // Blackout tooltip: body-level div, shown on hover (desktop) or tap (mobile).
      // Desktop: tooltip follows the mouse cursor (near-mouse mode).
      // Mobile: tap shows a fixed bottom-centre toast and auto-hides after 2.2s.
      // The (hover:hover) media query gates the mouse listeners to real pointers only.
      if (el.classList.contains('blackout')) {
        if (window.matchMedia('(hover: hover)').matches) {
          el.addEventListener('mouseenter', (e) => showBlackoutTipNearMouse(e));
          el.addEventListener('mousemove',  (e) => positionTipNearMouse(e));
          el.addEventListener('mouseleave', hideBlackoutTip);
        } else {
          // Touch device: delay so the toast appears after the tap highlight settles
          el.addEventListener('touchstart', () => {
            setTimeout(() => {
              showBlackoutTip(el);
              setTimeout(hideBlackoutTip, 2200);
            }, 350);
          }, { passive: true });
        }
      }
    });
  }

  // ── Blackout tooltip ──────────────────────────────────────────────────────────
  // A single <div> appended to <body> and repositioned on demand.
  // Using a body-level element means it's never clipped by parent overflow:hidden.
  const _bTip = (() => {
    const el = document.createElement('div');
    el.id = 'blackout-tip';
    document.body.appendChild(el);
    return el;
  })();

  // Mobile / tap: fixed bottom-centre
  function showBlackoutTip(pill) {
    _bTip.textContent = pill.dataset.tip || 'Events on this date are cancelled';
    _bTip.classList.remove('near-mouse');
    _bTip.style.left = '';
    _bTip.style.top  = '';
    _bTip.classList.add('visible');
  }

  // Desktop: appears near the cursor and follows it
  function showBlackoutTipNearMouse(e) {
    _bTip.textContent = e.currentTarget.dataset.tip || 'Events on this date are cancelled';
    _bTip.classList.add('near-mouse');
    positionTipNearMouse(e);
    _bTip.classList.add('visible');
  }

  function positionTipNearMouse(e) {
    const pad  = 14;
    const tipW = _bTip.offsetWidth  || 220;
    const tipH = _bTip.offsetHeight || 36;
    let x = e.clientX + pad;
    let y = e.clientY + pad;
    if (x + tipW > window.innerWidth  - 8) x = e.clientX - tipW - pad;
    if (y + tipH > window.innerHeight - 8) y = e.clientY - tipH - pad;
    _bTip.style.left = x + 'px';
    _bTip.style.top  = y + 'px';
  }

  function hideBlackoutTip() {
    _bTip.classList.remove('visible', 'near-mouse');
    _bTip.style.left = '';
    _bTip.style.top  = '';
  }

  // Detail card hover/click — same highlight behaviour as pills, but cards are static DOM
  // so these listeners are attached once (not re-attached on each renderMonth call).
  document.querySelectorAll('.detail-card[data-type]').forEach(el => {
    el.style.cursor = 'pointer';
    el.addEventListener('mouseenter', () => {
      if (pinnedType) return;
      const t = getTypeFromEl(el);
      if (t) applyHighlight(t);
    });
    el.addEventListener('mouseleave', () => {
      if (pinnedType) return;
      clearHighlight();
    });
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const t = getTypeFromEl(el);
      if (!t) return;
      if (pinnedType === t) {
        pinnedType = null;
        clearHighlight();
      } else {
        pinnedType = t;
        clearHighlight();
        applyHighlight(t);
        getPills(t).forEach(p => p.classList.add('hl-pinned'));
        const card = getCard(t);
        if (card) card.classList.add('hl-pinned');
        getResultRows(t).forEach(r => r.classList.add('hl-pinned'));
      }
    });
  });

  // Clicking anywhere outside a pill or card clears the pinned highlight
  document.addEventListener('click', () => {
    pinnedType = null;
    clearHighlight();
  });

  // ─────────────────────────────────────────────────────────────────────────────
  //  Running Now + Countdown
  //
  //  Shows two cards above the calendar:
  //    1. "Running Now" — shown when a tournament is currently live
  //    2. "Next Tournament" countdown — always shown, counting down to the next event
  //
  //  Live detection uses two methods in priority order:
  //    Primary:  data/live_games.json → tournament.level != null means Bravo clock is active
  //    Fallback: schedule-based — if today is a tournament day and it's 12:30pm–9pm,
  //              assume it's running (used when live_games.json is stale or unavailable)
  // ─────────────────────────────────────────────────────────────────────────────

  const TOURNAMENT_HOUR = 12;
  const TOURNAMENT_MIN  = 30;
  // If live data is unavailable, treat the tournament as running until this hour
  const CLOCK_FALLBACK_END_HOUR = 21; // 9pm

  // Live state — polled from live_games.json every 5 minutes
  let _liveFetchOk  = false; // true once we have a successful, non-error JSON fetch
  let _liveRunning  = false; // true if Bravo's clock API reports an active tournament
  let _liveTourName = '';    // tournament name from live data (empty if Bravo didn't provide one)

  // Fetch latest live state from live_games.json.
  // Called on init and then every 5 minutes via setInterval.
  function fetchLiveState() {
    fetch('data/live_games.json', {cache: 'no-cache'})
      .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(d => {
        if (d.error) { _liveFetchOk = false; return; } // scrape failed — don't trust tournament field
        const t = d.tournament;
        _liveFetchOk  = true;
        _liveRunning  = !!(t && t.level != null); // level is null when no tournament is running
        _liveTourName = (t && t.name) ? t.name.trim() : '';
      })
      .catch(() => { _liveFetchOk = false; });
  }

  // Schedule-based fallback: returns true if today is a tournament day and
  // the current time is within the expected running window (12:30pm – 9pm).
  // Only used when the live JSON fetch has failed.
  function isClockFallbackLive() {
    const now = new Date();
    const key = dateKey(now.getFullYear(), now.getMonth(), now.getDate());
    if (BLACKOUT_DATES.has(key)) return false;
    const ev = getTournamentForDay(now.getFullYear(), now.getMonth(), now.getDate());
    if (!ev) return false;
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), TOURNAMENT_HOUR, TOURNAMENT_MIN);
    const end   = new Date(now.getFullYear(), now.getMonth(), now.getDate(), CLOCK_FALLBACK_END_HOUR, 0);
    return now >= start && now < end;
  }

  // Returns the tournament scheduled for a given day, or null if none.
  // Checks special events first, then applies day-of-week rules.
  function getTournamentForDay(year, month, day) {
    const key = dateKey(year, month, day);
    if (SPECIAL_EVENTS[key]) {
      return { type: 'main', label: SPECIAL_EVENTS[key][0].label };
    }
    const dow = new Date(year, month, day).getDay();
    if (dow === 3) return { type: 'wed', label: "Wednesday $300 NL Hold'em" };
    if (dow === 0) {
      const lastSun = getLastSunday(year, month);
      if (day === lastSun) return { type: 'sun550', label: "Last Sunday $550 NL Hold'em" };
      return { type: 'sun', label: "Sunday $400 NL Hold'em" };
    }
    return null;
  }

  // Scan forward up to 14 days from today + startOffset to find the next tournament.
  // startOffset = 0 checks today first; startOffset = 1 skips today (used when live).
  // Skips blackout dates. Returns { event, start: Date } or null if none found.
  function findUpcomingTournament(startOffset) {
    const now = new Date();
    const y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
    for (let offset = startOffset; offset <= 14; offset++) {
      const dt  = new Date(y, m, d + offset);
      const key = dateKey(dt.getFullYear(), dt.getMonth(), dt.getDate());
      if (BLACKOUT_DATES.has(key)) continue;
      const ev = getTournamentForDay(dt.getFullYear(), dt.getMonth(), dt.getDate());
      if (ev) {
        const start = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate(), TOURNAMENT_HOUR, TOURNAMENT_MIN);
        return { event: ev, start };
      }
    }
    return null;
  }

  function pad2(n) { return String(n).padStart(2, '0'); }

  // HTML-escape helper for values interpolated into innerHTML strings
  function _esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function formatCountdownDate(dt) {
    return dt.toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric' });
  }

  // Update only the countdown numbers without rebuilding the full card DOM.
  // Called every second when _cdState hasn't changed (avoids expensive innerHTML replacement).
  function updateCountdownInPlace(start) {
    const el = document.getElementById('cd-days');
    if (!el) return false;
    const diff = start - new Date();
    if (diff <= 0) return false;
    const s = Math.floor(diff / 1000);
    el.textContent = Math.floor(s / 86400);
    document.getElementById('cd-hours').textContent = pad2(Math.floor((s % 86400) / 3600));
    document.getElementById('cd-mins').textContent  = pad2(Math.floor((s % 3600) / 60));
    document.getElementById('cd-secs').textContent  = pad2(s % 60);
    return true;
  }

  // _cdState: a string key encoding the current display state (live flag + next tournament start time).
  // If the state hasn't changed between ticks, only the numbers are updated (not the full HTML).
  let _cdState = null;

  // Main countdown tick — called every second by setInterval.
  // Decides whether to show a "Running Now" card, a countdown card, or both.
  function tickCountdown() {
    const outer = document.getElementById('cd-outer');
    if (!outer) return;

    const now = new Date();

    // Use live JSON if we have a clean fetch; fall back to schedule-based logic otherwise
    const isLive = _liveFetchOk ? _liveRunning : isClockFallbackLive();

    // If live, skip today when finding the next event (it's already running).
    // If not live but today's start time has passed, also skip today.
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), TOURNAMENT_HOUR, TOURNAMENT_MIN);
    const next = findUpcomingTournament(isLive || now >= todayStart ? 1 : 0);
    if (!next) { outer.style.display = 'none'; _cdState = null; return; }

    const stateKey = (isLive ? 'L' : '') + next.start.getTime();
    if (_cdState === stateKey) {
      // State unchanged — just update the ticking numbers to avoid DOM thrashing
      updateCountdownInPlace(next.start);
      return;
    }
    _cdState = stateKey;

    // ── Build "Running Now" card ──────────────────────────────────────────
    // Shown when a tournament is live. Displays the tournament name with the
    // type-colour CSS class (wed/sun/sun550/main) for colour-coded styling.
    let html = '';
    if (isLive) {
      const todayEv = getTournamentForDay(now.getFullYear(), now.getMonth(), now.getDate());
      const name    = _liveTourName || (todayEv ? todayEv.label : 'Tournament');
      const type    = todayEv ? todayEv.type : '';
      html += `<div class="countdown-box cd-running-card">
        <div class="cd-live-row"><span class="cd-live-dot"></span><span class="cd-live-label">Live</span></div>
        <div class="cd-live-name ${_esc(type)}">${_esc(name)}</div>
        <div class="cd-running-text">Running now!</div>
      </div>`;
    }

    // ── Build countdown card ──────────────────────────────────────────────
    // Always shown (alongside or instead of the running card).
    // The cd-days/cd-hours/cd-mins/cd-secs IDs are targeted by updateCountdownInPlace().
    const diff = next.start - now;
    if (diff <= 0) { outer.style.display = 'none'; _cdState = null; return; }
    const s = Math.floor(diff / 1000);
    html += `<div class="countdown-box cd-countdown-card">
      <div class="cd-eyebrow">Next Tournament</div>
      <div class="cd-name ${_esc(next.event.type)}">${_esc(next.event.label)}</div>
      <div class="cd-units">
        <div class="cd-unit"><span class="cd-num" id="cd-days">${Math.floor(s / 86400)}</span><span class="cd-unit-label">Days</span></div>
        <div class="cd-unit"><span class="cd-num" id="cd-hours">${pad2(Math.floor((s % 86400) / 3600))}</span><span class="cd-unit-label">Hours</span></div>
        <div class="cd-unit"><span class="cd-num" id="cd-mins">${pad2(Math.floor((s % 3600) / 60))}</span><span class="cd-unit-label">Mins</span></div>
        <div class="cd-unit"><span class="cd-num" id="cd-secs">${pad2(s % 60)}</span><span class="cd-unit-label">Secs</span></div>
      </div>
      <div class="cd-sub">Starts 12:30 PM · ${formatCountdownDate(next.start)}</div>
    </div>`;

    outer.style.display = 'flex';
    outer.innerHTML = html;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  //  Init — fetch calendar_config.json, then render
  //
  //  calendar_config.json structure:
  //    { "blackout_dates": ["YYYY-MM-DD", ...], "special_events": { "YYYY-MM-DD": [...] } }
  //  Managed manually (or by rotate_season_card.py for main event entries).
  //  If the fetch fails, the calendar renders with no blackouts/specials (graceful degradation).
  // ─────────────────────────────────────────────────────────────────────────────
  fetch('data/calendar_config.json', {cache: 'no-cache'})
    .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(cfg => {
      BLACKOUT_DATES = new Set(cfg.blackout_dates || []);
      SPECIAL_EVENTS = cfg.special_events || {};
    })
    .catch(() => {}) // silently ignore — calendar still renders without config
    .finally(() => {
      renderMonth(0, 0);              // render current month immediately
      fetchLiveState();               // kick off first live state fetch
      setInterval(fetchLiveState, 5 * 60 * 1000); // re-fetch live state every 5 min
      tickCountdown();                // render countdown immediately
      setInterval(tickCountdown, 1000); // tick every second
    });
