/**
 * results-table.js — Shared results table renderer for calendar.html and stats.html.
 *
 * Usage:
 *   <script src="results-table.js"></script>
 *   <script>
 *     ResultsTable.init({
 *       tbodyId:    'results-tbody',
 *       tableId:    'results-table',         // optional — enables sort
 *       timestampId: 'results-last-updated', // optional — shows last_updated
 *       dataUrl:    'data/results.json',     // or 'data/stats.json'
 *       filterFn:   null,                    // optional — fn(result) → bool
 *     });
 *   </script>
 */
var ResultsTable = (function () {
  'use strict';

  var TYPE_COLOR = {
    wed: 'var(--wed)', sun: 'var(--sun)', sun550: 'var(--sun550)', main: 'var(--main)', wed275: 'var(--wed275)', fri240: 'var(--fri240)', mon175: 'var(--mon175)', tue225: 'var(--tue225)', fri_bounty: 'var(--fri_bounty)'
  };

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function getBase() {
    return (typeof BASE !== 'undefined' && BASE) ? BASE : '';
  }

  var SEASON_COLOR = {
    winter: '#5B9BD5',
    spring: '#6BBF59',
    summer: '#F5A623',
    fall:   '#E07B39'
  };

  function getSeasonColor(ev) {
    // Prefer explicit season field; fall back to title string match
    var season = ev.season;
    if (!season) {
      var t = (ev.tournament || '').toLowerCase();
      if (t.indexOf('winter') !== -1) season = 'winter';
      else if (t.indexOf('spring') !== -1) season = 'spring';
      else if (t.indexOf('summer') !== -1) season = 'summer';
      else if (t.indexOf('fall')   !== -1) season = 'fall';
    }
    return season ? (SEASON_COLOR[season] || null) : null;
  }

  function buildRow(ev, showYear, useSeasonColors) {
    var color = TYPE_COLOR[ev.type] || 'var(--wed)';
    if (useSeasonColors && ev.type === 'main') {
      var seasonColor = getSeasonColor(ev);
      if (seasonColor) color = seasonColor;
    }
    var entriesTd = ev.entries
      ? '<td class="rt-entries">' + esc(String(ev.entries)) + '</td>'
      : '<td class="rt-unknown">\u2014</td>';
    var poolTd = ev.prize_pool
      ? '<td class="rt-pool">' + esc(ev.prize_pool) + '</td>'
      : '<td class="rt-unknown">\u2014</td>';
    var firstTd = ev.first_place
      ? '<td class="rt-first">' + esc(ev.first_place) + '</td>'
      : '<td class="rt-unknown">\u2014</td>';
    var winnerTd;
    if (ev.winner_name && ev.winner_name.toLowerCase() !== 'unknown') {
      var flag = ev.country_code
        ? '<img class="flag-img" src="' + getBase() + 'flags/' + esc(ev.country_code) + '.png" alt="' + esc(ev.country_code.toUpperCase()) + '" onerror="this.src=\'https://flagcdn.com/20x15/\'+this.alt.toLowerCase()+\'.png\';this.onerror=null"> '
        : '';
      var nameInner = ev.winner_url
        ? '<a class="rt-winner-link" href="' + esc(ev.winner_url) + '" target="_blank">' + esc(ev.winner_name) + '</a>'
        : esc(ev.winner_name);
      winnerTd = '<td class="td-l rt-winner">' + flag + nameInner + '</td>';
    } else {
      winnerTd = '<td class="td-l rt-unknown">\u2014</td>';
    }
    var dateText = esc(ev.date);
    if (showYear && ev.date_iso) dateText += ' \'' + esc(ev.date_iso.slice(2, 4));
    return (
      '<tr data-type="' + esc(ev.type || '') + '">' +
        '<td class="td-l rt-date">' + dateText + '</td>' +
        '<td class="td-l"><span class="rt-type">' +
          '<span class="rt-dot" style="background:' + color + '"></span>' +
          '<a class="rt-link" href="' + esc(ev.event_url) + '" target="_blank">' + esc(ev.tournament) + '</a>' +
        '</span></td>' +
        entriesTd + poolTd + firstTd + winnerTd +
      '</tr>'
    );
  }

  // ── Sort helpers ────────────────────────────────────────────────────────
  var MONTH_NUM = {Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12};

  function parseDateNum(text) {
    var m = text.match(/(\w{3})\s+(\d+)/);
    return m ? (MONTH_NUM[m[1]] || 0) * 100 + parseInt(m[2]) : 0;
  }

  function parseMoneyNum(text) {
    var digits = text.replace(/[^\d]/g, '');
    return digits ? parseInt(digits) : -1;
  }

  function init(opts) {
    var tbodyId         = opts.tbodyId;
    var tableId         = opts.tableId || null;
    var tsId            = opts.timestampId || null;
    var dataUrl         = opts.dataUrl;
    var filterFn        = opts.filterFn || null;
    var onLoad          = opts.onLoad || null;
    var showYear        = opts.showYear || false;
    var useSeasonColors = opts.seasonColors || false;

    var sortCol = 'date';
    var sortDir = 1; // 1 = desc for date (newest first by default)
    var rows = [];

    function render() {
      var sorted = rows.slice().sort(function (a, b) {
        var av = a[sortCol], bv = b[sortCol];
        if (typeof av === 'string') {
          if (av < bv) return -sortDir;
          if (av > bv) return sortDir;
        } else if (av !== bv) {
          return (av - bv) * sortDir;
        }
        if (sortCol !== 'date') return a.date - b.date;
        return 0;
      });
      var tbody = document.getElementById(tbodyId);
      if (tbody) sorted.forEach(function (r) { tbody.appendChild(r.el); });
    }

    function updateHeaders() {
      if (!tableId) return;
      var table = document.getElementById(tableId);
      if (!table) return;
      table.querySelectorAll('thead th[data-col]').forEach(function (th) {
        th.classList.remove('sort-asc', 'sort-desc');
        if (th.dataset.col === sortCol) {
          th.classList.add(sortDir === 1 ? 'sort-asc' : 'sort-desc');
        }
      });
    }

    // Attach sort handlers
    if (tableId) {
      var table = document.getElementById(tableId);
      if (table) {
        table.querySelectorAll('thead th[data-col]').forEach(function (th) {
          th.addEventListener('click', function () {
            var col = th.dataset.col;
            if (col === sortCol) { sortDir *= -1; }
            else { sortCol = col; sortDir = ['date','tournament','winner'].includes(col) ? 1 : -1; }
            updateHeaders();
            render();
          });
        });
      }
    }

    fetch(dataUrl, {cache: 'no-cache'})
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var results = data.results || [];
        if (filterFn) results = results.filter(filterFn);

        var tbody = document.getElementById(tbodyId);
        if (tbody) {
          tbody.innerHTML = results.length
            ? results.map(function(ev) { return buildRow(ev, showYear, useSeasonColors); }).join('')
            : '<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:20px;">No results yet</td></tr>';

          var trs = Array.prototype.slice.call(tbody.querySelectorAll('tr'));
          rows = trs.map(function (tr, idx) {
            var cells = tr.querySelectorAll('td');
            var ev = results[idx] || {};
            var dateSort = ev.date_iso
              ? parseInt(ev.date_iso.replace(/-/g, ''))
              : parseDateNum(cells[0] ? cells[0].textContent : '');
            return {
              el:         tr,
              date:       dateSort,
              tournament: (cells[1] ? cells[1].textContent : '').trim().toLowerCase(),
              entries:    parseInt(((cells[2] ? cells[2].textContent : '').replace(/[^\d]/g, ''))) || -1,
              pool:       parseMoneyNum(cells[3] ? cells[3].textContent : ''),
              first:      parseMoneyNum(cells[4] ? cells[4].textContent : ''),
              winner:     (cells[5] ? cells[5].textContent : '').trim().toLowerCase(),
            };
          });
          updateHeaders();
        }

        if (tsId) {
          var tsEl = document.getElementById(tsId);
          if (tsEl) tsEl.textContent = data.last_updated || '\u2013';
        }

        if (onLoad) onLoad(data);
      })
      .catch(function () {
        var tbody = document.getElementById(tbodyId);
        if (tbody) {
          tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:20px;">Unable to load results</td></tr>';
        }
      });
  }

  return { init: init };
})();
