  // DATA and SUMMARY are populated from data/badbeat.json on page load (see fetch at bottom).
  // DATA: array of { date, time, jackpot, change, collected, nextBBJ } — one entry per scrape.
  // SUMMARY: { currentJackpot, currentDate, currentTime, lastHitDate, lastHitAmount }
  // Both are written by bad_beat.py and pushed to GitHub on each scrape.
  let DATA = [];
  let SUMMARY = {};

  // ── Toggle history ────────────────────────────────────────────────────────
  // Shows/hides the collapsible daily data log table below the chart.
  function toggleHistory(btn) {
    const body = document.getElementById("history-body");
    const open = body.classList.toggle("open");
    btn.setAttribute("aria-expanded", open);
  }

  // ── Formatters ────────────────────────────────────────────────────────────
  // fmt: null → em dash, otherwise Canadian dollar format (e.g. $12,749.30)
  const fmt = (n) => n == null ? "—" : "$" + n.toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // fmtChange: returns { txt, cls } for colour-coded daily change column.
  // Negative = jackpot was hit (red), zero = no change (muted), positive = growing (green).
  const fmtChange = (n) => {
    if (n == null) return { txt: "—", cls: "" };
    if (n < 0)     return { txt: fmt(n), cls: "change-neg" };
    if (n === 0)   return { txt: "$0.00", cls: "change-zero" };
    return { txt: "+" + fmt(n), cls: "change-pos" };
  };

  // fmtDate: converts 'YYYY-MM-DD' → 'Jan 4, 2026' for the Last BBJ Hit stat card.
  const fmtDate = (d) => {
    const [y, m, day] = d.split("-");
    return new Date(y, m - 1, day).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" });
  };

  // ── Slot-machine roll-up for the hero jackpot amount ─────────────────────
  // Animates from $0 to the target value over `duration` ms using a quartic
  // ease-out curve — fast at the start, slows near the end like a slot machine.
  function rollUpAmount(el, target, duration) {
    const ease = t => 1 - Math.pow(1 - t, 4); // quartic ease-out
    let startTs = null;
    el.textContent = fmt(0);
    function frame(ts) {
      if (!startTs) startTs = ts;
      const progress = Math.min((ts - startTs) / duration, 1);
      el.textContent = fmt(target * ease(progress));
      if (progress < 1) requestAnimationFrame(frame);
      else el.textContent = fmt(target); // snap to exact final value
    }
    requestAnimationFrame(frame);
  }

  function _init() {
    // ── Summary cards ───────────────────────────────────────────────────────
    document.getElementById("hero-date").textContent = SUMMARY.currentDate;
    document.getElementById("hero-time").textContent = SUMMARY.currentTime || "";
    var heroEl = document.getElementById("hero-amount");
    heroEl.style.opacity = '';
    // Short delay before starting the roll-up so the page has visually settled
    setTimeout(() => rollUpAmount(heroEl, SUMMARY.currentJackpot, 2200), 350);
    document.getElementById("stat-hit-date").textContent = fmtDate(SUMMARY.lastHitDate);
    document.getElementById("stat-hit-amount").textContent = fmt(SUMMARY.lastHitAmount);

    // ── Build per-day buckets ──────────────────────────────────────────────
    // The scraper runs twice daily (7am + 11:45am), so some days have two entries.
    // We group by date here so the chart shows one point per day and the table
    // can decide how many rows to display per day.
    const dateOrder = []; // preserves chronological insertion order
    const byDate = new Map();
    DATA.forEach(e => {
      if (!byDate.has(e.date)) { dateOrder.push(e.date); byDate.set(e.date, []); }
      byDate.get(e.date).push(e);
    });

    // Most-recent entry per day — used for the chart and avg daily calc.
    // Using the later reading gives a better end-of-day picture.
    const dailyLatest = dateOrder.map(d => byDate.get(d).at(-1));

    // ── Avg daily increase since last hit ───────────────────────────────────
    // Finds the most recent jackpot hit (negative change), then averages the
    // positive daily deltas after that point. Only positive days are included —
    // flat days (dedup skipped) don't distort the average downward.
    const lastResetDailyIdx = dailyLatest.reduce((acc, d, i) =>
      (d.change !== null && d.change < 0) ? i : acc, -1);
    const postResetGrowth = [];
    for (let i = Math.max(lastResetDailyIdx + 1, 1); i < dailyLatest.length; i++) {
      const delta = dailyLatest[i].jackpot - dailyLatest[i - 1].jackpot;
      if (delta > 0) postResetGrowth.push(delta);
    }
    const avgDaily = postResetGrowth.length > 0
      ? postResetGrowth.reduce((s, v) => s + v, 0) / postResetGrowth.length
      : null;
    document.getElementById("stat-avg-daily").textContent = avgDaily != null ? fmt(avgDaily) : "—";
    document.getElementById("stat-avg-sub").textContent =
      postResetGrowth.length === 1 ? "1 day of data" : `${postResetGrowth.length} days of data`;

    // ── Table: group by day; show both entries only when amounts differ ─────
    // If both scrapes for a day returned the same jackpot (dedup), show one row.
    // If they differ (jackpot grew between morning and afternoon), show both rows
    // with a time sub-label so the user can see the intra-day movement.
    const tbody = document.getElementById("data-tbody");
    [...dateOrder].reverse().forEach(date => { // reverse = newest first
      const entries = byDate.get(date);
      const first = entries[0], last = entries[entries.length - 1];
      const showBoth = entries.length > 1 && first.jackpot !== last.jackpot;
      const rowsToShow = showBoth ? [...entries].reverse() : [last];

      rowsToShow.forEach(row => {
        const isReset = row.change !== null && row.change < 0; // jackpot dropped = was hit
        const ch = fmtChange(row.change);
        const tr = document.createElement("tr");
        if (isReset) tr.className = "jackpot-hit"; // red row highlight for hit days
        // Show time sub-label only when displaying multiple entries for a day
        const dateCell = (showBoth && row.time)
          ? `${row.date}<br><small style="color:var(--muted);font-size:11px;">${row.time}</small>`
          : row.date;
        tr.innerHTML = `
          <td>${dateCell}</td>
          <td>${fmt(row.jackpot)}</td>
          <td class="${ch.cls}">${ch.txt}</td>
          <td>${fmt(row.collected)}</td>
          <td>${fmt(row.nextBBJ)}</td>
        `;
        tbody.appendChild(tr);
      });
    });

    // ── Chart (Chart.js) — one point per day ────────────────────────────────
    // Uses the most-recent entry per day. Points are gold by default;
    // red on days where the jackpot dropped (was hit). The line segment
    // leading into a hit day also turns red for visual clarity.
    const chartLabels   = dateOrder;
    const chartJackpots = dailyLatest.map(d => d.jackpot);
    // Gold dot normally; red dot on hit days
    const pointColors   = dailyLatest.map(d =>
      (d.change !== null && d.change < 0) ? "#c0392b" : "#d4af37");

    const ctx = document.getElementById("jackpotChart").getContext("2d");
    // Gold-to-transparent gradient fill under the line
    const gradient = ctx.createLinearGradient(0, 0, 0, 260);
    gradient.addColorStop(0, "rgba(212,175,55,0.35)");
    gradient.addColorStop(1, "rgba(212,175,55,0.02)");

    new Chart(ctx, {
      type: "line",
      data: {
        labels: chartLabels,
        datasets: [{
          label: "Jackpot Total",
          data: chartJackpots,
          borderColor: "#d4af37",
          backgroundColor: gradient,
          borderWidth: 2.5,
          pointRadius: 6,
          pointHoverRadius: 9,
          pointBackgroundColor: pointColors,
          pointBorderColor: "#0d1b2a",
          pointBorderWidth: 2,
          fill: true,
          tension: 0.3,
          // Per-segment colour: turn the line red on the segment ending at a hit point
          segment: {
            borderColor: (ctx) => {
              const i = ctx.p1DataIndex;
              return (dailyLatest[i] && dailyLatest[i].change !== null && dailyLatest[i].change < 0)
                ? "#c0392b" : "#d4af37";
            }
          }
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: "rgba(13,27,42,0.95)",
            borderColor: "rgba(212,175,55,0.4)",
            borderWidth: 1,
            titleColor: "#d4af37",
            bodyColor: "#e8e0cf",
            padding: 12,
            callbacks: { label: (ctx) => "  Jackpot: " + fmt(ctx.parsed.y) }
          }
        },
        scales: {
          x: {
            grid: { color: "rgba(255,255,255,0.05)" },
            ticks: { color: "#8a9bb0", font: { size: 11 } },
            border: { color: "rgba(255,255,255,0.1)" }
          },
          y: {
            grid: { color: "rgba(255,255,255,0.05)" },
            ticks: {
              color: "#8a9bb0",
              font: { size: 11 },
              // Abbreviate large values on y-axis: $15000 → $15k
              callback: (v) => "$" + (v >= 1000 ? (v/1000).toFixed(0) + "k" : v)
            },
            border: { color: "rgba(255,255,255,0.1)" }
          }
        }
      }
    });
  } // end _init

  // ── Fetch data/badbeat.json then initialize ────────────────────────────────
  // cache: 'no-cache' ensures the latest data is always fetched, not a browser-cached copy.
  fetch('data/badbeat.json', {cache: 'no-cache'})
    .then(r => r.json())
    .then(d => {
      DATA = d.data;
      SUMMARY = d.summary;
      _init();
    })
    .catch(() => {
      // If the fetch fails entirely, show an em dash in the hero rather than leaving "Loading…"
      const hero = document.getElementById('hero-amount');
      if (hero) { hero.style.opacity = ''; hero.textContent = '—'; }
    });
