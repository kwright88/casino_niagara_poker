#!/usr/bin/env python3
"""update_tournamentstats.py — Update tournamentstats.html with live 2026 results
and player leaderboard from recurring Casino Niagara tournaments.

Excludes festival / main events — only weekly recurring types:
  - Wednesday $300 NLH  (type: wed)
  - Sunday $400 NLH     (type: sun)
  - Last Sunday $550 NLH (type: sun550)

Data sources:
  - results_2026.xlsx  (event list + per-event summary, kept by update_results_2026.py)
  - players_2026.json  (per-event all-casher cache, built/updated here)

Cron: 0 12 * * * @ America/Toronto
"""

import json
import os
import re
import shutil
import subprocess
import time
from datetime import datetime

import openpyxl
import pytz
import requests
from playwright.sync_api import sync_playwright

# ── Configuration ──────────────────────────────────────────────────────────────

CHROME_BIN       = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
CDP_PORT         = 9880
TMP_PROFILE      = "/tmp/hm-stats-chrome"
OPENCLAW_CDP_URL = "http://127.0.0.1:9222"  # OpenClaw managed browser fallback

BASE_DIR         = os.path.dirname(os.path.abspath(__file__))
XLSX_PATH        = os.path.join(BASE_DIR, "results_2026.xlsx")
PLAYERS_JSON     = os.path.join(BASE_DIR, "players_2026.json")

GITHUB_DIR       = "/Users/kevinwright/Documents/GitHub/NiagaraBadBeat"
STATS_HTML       = os.path.join(GITHUB_DIR, "tournamentstats.html")

TELEGRAM_BOT_TOKEN = "8245519283:AAHkXNUjIelON7NmSpV3pvc269vlpBux-vg"
TELEGRAM_CHAT_ID   = "357628315"
TIMEZONE           = pytz.timezone("America/Toronto")
HM_BASE            = "https://pokerdb.thehendonmob.com"

RECURRING_TYPES = {'wed', 'sun', 'sun550'}

# ── Lookups ────────────────────────────────────────────────────────────────────

XLSX_HEADERS = [
    'Date ISO', 'Date Display', 'Event URL', 'Tournament (Raw)',
    'Tournament (Display)', 'Type', 'Entries', 'Prize Pool',
    '1st Place', 'Winner Name', 'Winner Country', 'Country Code', 'Winner URL'
]
COL = {h: i for i, h in enumerate(XLSX_HEADERS)}

COUNTRY_CODES = {
    'Canada': 'ca', 'Ukraine': 'ua', 'United States': 'us',
    'United Kingdom': 'gb', 'Australia': 'au', 'Germany': 'de',
    'France': 'fr', 'Russia': 'ru', 'China': 'cn', 'Romania': 'ro',
    'Poland': 'pl', 'Brazil': 'br', 'Mexico': 'mx', 'India': 'in',
    'Unknown': '',
}
KNOWN_COUNTRIES = sorted(COUNTRY_CODES.keys(), key=len, reverse=True)

TYPE_COLOR = {
    'wed':    'var(--wed)',
    'sun':    'var(--sun)',
    'sun550': 'var(--sun550)',
}

# ── Helpers ────────────────────────────────────────────────────────────────────

def fmt_date(date_iso):
    """'2026-01-04' → 'Jan 4'."""
    try:
        return datetime.strptime(date_iso, '%Y-%m-%d').strftime('%b %-d')
    except Exception:
        return date_iso


def parse_country(text):
    for c in KNOWN_COUNTRIES:
        if text.startswith(c):
            return c, COUNTRY_CODES.get(c, '')
    return '', ''


def send_telegram(msg):
    try:
        requests.post(
            f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage",
            json={'chat_id': TELEGRAM_CHAT_ID, 'text': msg},
            timeout=10
        )
    except Exception:
        pass


# ── Load event list ────────────────────────────────────────────────────────────

def load_events():
    """Load recurring-type events from results_2026.xlsx, sorted oldest-first."""
    events = []
    if not os.path.exists(XLSX_PATH):
        return events
    wb = openpyxl.load_workbook(XLSX_PATH)
    ws = wb.active
    for row in ws.iter_rows(min_row=2, values_only=True):
        if not row or not row[COL['Event URL']]:
            continue
        ev = {h: row[i] for i, h in enumerate(XLSX_HEADERS)}
        if ev.get('Type') in RECURRING_TYPES:
            events.append(ev)
    return sorted(events, key=lambda e: e.get('Date ISO') or '')


# ── Player cache ───────────────────────────────────────────────────────────────

def load_player_cache():
    if os.path.exists(PLAYERS_JSON):
        with open(PLAYERS_JSON, 'r') as f:
            return json.load(f)
    return {}


def save_player_cache(cache):
    with open(PLAYERS_JSON, 'w') as f:
        json.dump(cache, f, indent=2)


# ── Scraping ───────────────────────────────────────────────────────────────────

POSITION_RE = re.compile(r'^(\d+)(st|nd|rd|th)$', re.IGNORECASE)
PRIZE_RE    = re.compile(r'C\$\s*([\d,]+)')


def scrape_event_players(page, event_url):
    """Visit an event page and return all cashers as a list of dicts."""
    page.goto(event_url, wait_until='load')
    try:
        page.wait_for_selector('table', timeout=12000)
    except Exception:
        return []

    players = []
    all_rows = page.locator('table tr')

    for i in range(all_rows.count()):
        cells = all_rows.nth(i).locator('td')
        if cells.count() < 4:
            continue

        pos_text = cells.nth(0).inner_text().strip()
        m = POSITION_RE.match(pos_text)
        if not m:
            continue
        pos_num = int(m.group(1))

        # Country (cell 1)
        country_name, country_cc = parse_country(cells.nth(1).inner_text().strip())

        # Name + URL (cell 2)
        name_cell  = cells.nth(2)
        name       = name_cell.inner_text().strip()
        if not name or name.lower() == 'unknown':
            continue

        player_url = ''
        player_id  = None
        name_link  = name_cell.locator('a').first
        if name_link.count() > 0:
            href = name_link.get_attribute('href') or ''
            if href:
                player_url = href if href.startswith('http') else HM_BASE + '/' + href.lstrip('/')
                id_m = re.search(r'n=(\d+)', player_url)
                if id_m:
                    player_id = int(id_m.group(1))

        # Prize (cell 3)
        prize_m = PRIZE_RE.search(cells.nth(3).inner_text())
        prize_cad = int(prize_m.group(1).replace(',', '')) if prize_m else 0
        if prize_cad == 0:
            continue

        players.append({
            'id':           player_id,
            'name':         name,
            'country':      country_name,
            'country_code': country_cc,
            'player_url':   player_url,
            'position':     pos_num,
            'prize_cad':    prize_cad,
        })

    time.sleep(0.8)
    return players


def scrape_with_chrome_cdp(events_to_scrape, player_cache):
    """Launch Chrome via CDP and scrape player data for missing events."""
    if os.path.exists(TMP_PROFILE):
        shutil.rmtree(TMP_PROFILE)

    proc = subprocess.Popen([
        CHROME_BIN,
        f'--remote-debugging-port={CDP_PORT}',
        f'--user-data-dir={TMP_PROFILE}',
        '--no-first-run', '--no-default-browser-check',
        '--disable-default-apps', '--window-position=3000,3000',
        'about:blank'
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(2)

    try:
        with sync_playwright() as p:
            browser = p.chromium.connect_over_cdp(f'http://localhost:{CDP_PORT}')
            ctx     = browser.contexts[0] if browser.contexts else browser.new_context()
            page    = ctx.new_page()
            page.set_default_timeout(20000)
            _do_player_scrapes(page, events_to_scrape, player_cache)
            browser.close()
    finally:
        proc.terminate()
        time.sleep(0.5)
        try:
            shutil.rmtree(TMP_PROFILE)
        except Exception:
            pass


def scrape_with_openclaw_browser(events_to_scrape, player_cache):
    """Fallback: use the OpenClaw managed browser via CDP."""
    subprocess.run(
        ['openclaw', 'browser', '--browser-profile', 'openclaw', 'start'],
        capture_output=True
    )
    time.sleep(3)

    with sync_playwright() as p:
        browser = p.chromium.connect_over_cdp(OPENCLAW_CDP_URL)
        ctx     = browser.new_context()
        page    = ctx.new_page()
        page.set_default_timeout(20000)
        try:
            _do_player_scrapes(page, events_to_scrape, player_cache)
        finally:
            page.close()
            ctx.close()


def _do_player_scrapes(page, events_to_scrape, player_cache):
    """Core loop: scrape player data for each event and update cache in-place."""
    for ev in events_to_scrape:
        url     = ev['Event URL']
        display = ev.get('Tournament (Display)', '')
        date_d  = ev.get('Date Display', '')
        print(f"    Scraping players: {date_d} {display}…")
        try:
            players = scrape_event_players(page, url)
            print(f"      → {len(players)} cashers")
            if players:
                player_cache[url] = players
            # Don't cache empty results — retry next run in case results aren't posted yet
        except Exception as e:
            print(f"      Warning: failed ({e})")


def run_player_scrapes(events_to_scrape, player_cache):
    """Try Chrome CDP; fall back to OpenClaw browser if it fails."""
    try:
        scrape_with_chrome_cdp(events_to_scrape, player_cache)
    except Exception as e:
        print(f"  Chrome CDP failed ({e}), falling back to OpenClaw browser…")
        scrape_with_openclaw_browser(events_to_scrape, player_cache)


# ── Player aggregation ─────────────────────────────────────────────────────────

def aggregate_players(events, player_cache):
    """
    Build per-player stats from cache.
    Returns dict keyed by player_id (int) or 'name:<name>' for unknown IDs.
    """
    stats = {}

    for ev in events:
        url      = ev.get('Event URL')
        entries  = int(ev.get('Entries') or 0)
        date_iso = ev.get('Date ISO', '')
        evt_name = ev.get('Tournament (Display)', '')

        for p in player_cache.get(url, []):
            pid = p.get('id')
            key = pid if pid else f"name:{p['name']}"

            if key not in stats:
                stats[key] = {
                    'id':           pid or 0,
                    'name':         p['name'],
                    'country':      p.get('country', ''),
                    'country_code': p.get('country_code', ''),
                    'player_url':   p.get('player_url', ''),
                    'cashes':       0,
                    'wins':         0,
                    'final_tables': 0,
                    'total_cad':    0,
                    'scores':       [],   # (prize, date_iso, evt_name, entries, url)
                    'cash_dates':   [],   # all dates they cashed
                    'ft_dates':     [],   # dates of top-9 finishes
                }

            s = stats[key]
            s['cashes']    += 1
            s['total_cad'] += p['prize_cad']
            s['scores'].append((p['prize_cad'], date_iso, evt_name, entries, url))
            s['cash_dates'].append(date_iso)
            if p['position'] == 1:
                s['wins'] += 1
            if p['position'] <= 9:
                s['final_tables'] += 1
                s['ft_dates'].append(date_iso)

    return stats


# ── Awards ─────────────────────────────────────────────────────────────────────

def compute_streak(player_dates, all_event_dates):
    """Longest consecutive run of event dates where player appears."""
    date_set = set(player_dates)
    best, best_run, current = 0, [], []
    for d in all_event_dates:
        if d in date_set:
            current.append(d)
            if len(current) > best:
                best, best_run = len(current), current[:]
        else:
            current = []
    return best, best_run


def player_html(s):
    cc   = s.get('country_code', '')
    name = s['name']
    url  = s.get('player_url', '')
    flag = f'<img class="flag-img" src="https://flagcdn.com/20x15/{cc}.png" alt="{cc.upper()}"> ' if cc else ''
    inner = f'<a href="{url}" target="_blank">{name}</a>' if url else name
    return f'{flag}{inner}'


def tiebreak(candidates, stats):
    return max(candidates, key=lambda k: stats[k]['total_cad'])


def compute_awards(stats, events, player_cache, all_event_dates):
    awards = []
    if not stats:
        return awards

    def event_winner(ev):
        """Return player dict (from cache) who won this event, or None."""
        return next((p for p in player_cache.get(ev.get('Event URL'), []) if p['position'] == 1), None)

    def find_key(p):
        pid = p.get('id')
        return pid if pid else f"name:{p['name']}"

    # ── Most Cashes ──
    max_cashes = max(s['cashes'] for s in stats.values())
    cands = [k for k, s in stats.items() if s['cashes'] == max_cashes]
    w = tiebreak(cands, stats) if len(cands) > 1 else cands[0]
    awards.append(('🏆', 'Most Cashes', player_html(stats[w]),
                   f"{max_cashes} cash{'es' if max_cashes != 1 else ''} in 2026"))

    # ── Most Money Won ──
    w = max(stats, key=lambda k: stats[k]['total_cad'])
    s = stats[w]
    awards.append(('💰', 'Most Money Won', player_html(s),
                   f"C${s['total_cad']:,} across {s['cashes']} cash{'es' if s['cashes'] != 1 else ''}"))

    # ── Biggest Single Score ──
    best_prize, best_key, best_date, best_evt = 0, None, '', ''
    for k, s in stats.items():
        for prize, date_iso, evt_name, _, _ in s['scores']:
            if prize > best_prize:
                best_prize, best_key, best_date, best_evt = prize, k, date_iso, evt_name
    if best_key:
        d = fmt_date(best_date)
        awards.append(('🎯', 'Biggest Single Score', player_html(stats[best_key]),
                       f"C${best_prize:,} — {d} {best_evt}"))

    # ── Best Average Cash (min 2 cashes) ──
    multi = {k: s for k, s in stats.items() if s['cashes'] >= 2}
    if multi:
        w = max(multi, key=lambda k: multi[k]['total_cad'] / multi[k]['cashes'])
        s = stats[w]
        avg = s['total_cad'] // s['cashes']
        wins_label = f", {s['wins']} win{'s' if s['wins'] != 1 else ''}" if s['wins'] > 0 else ''
        awards.append(('📈', 'Best Average Cash', player_html(s),
                       f"C${avg:,} avg · {s['cashes']} cashes{wins_label}"))

    # ── Final Tablist (most final table appearances) ──
    max_ft = max((s['final_tables'] for s in stats.values()), default=0)
    if max_ft > 0:
        cands = [k for k, s in stats.items() if s['final_tables'] == max_ft]
        w = tiebreak(cands, stats) if len(cands) > 1 else cands[0]
        awards.append(('🎪', 'Final Tablist', player_html(stats[w]),
                       f"{max_ft} final table{'s' if max_ft != 1 else ''} in 2026 (top-9 finishes)"))

    # ── Largest Field Conquered ──
    events_with_entries = [(int(ev.get('Entries') or 0), ev) for ev in events]
    if events_with_entries:
        big_entries, big_ev = max(events_with_entries, key=lambda x: x[0])
        if big_entries > 0:
            wp = event_winner(big_ev)
            if wp:
                key = find_key(wp)
                if key in stats:
                    d = fmt_date(big_ev.get('Date ISO', ''))
                    awards.append(('📋', 'Largest Field Conquered', player_html(stats[key]),
                                   f"Won with {big_entries} entries — {d}"))

    # ── International Winner (first non-Canadian winner) ──
    for ev in events:
        wp = event_winner(ev)
        if wp and wp.get('country_code', '').lower() not in ('ca', ''):
            key = find_key(wp)
            if key in stats:
                country = stats[key].get('country', 'International')
                awards.append(('🌍', 'International Winner', player_html(stats[key]),
                               f"Only {country} winner in 2026"))
            break

    # ── First Winner of 2026 ──
    if events:
        wp = event_winner(events[0])
        if wp:
            key = find_key(wp)
            if key in stats:
                d = fmt_date(events[0].get('Date ISO', ''))
                awards.append(('🔰', 'First Winner of 2026', player_html(stats[key]),
                               f"{d} — opened the year"))

    # ── Longest Cash Streak ──
    best_streak, best_streak_key, best_streak_dates = 0, None, []
    for k, s in stats.items():
        streak, dates = compute_streak(s['cash_dates'], all_event_dates)
        if streak > best_streak or (streak == best_streak and best_streak_key and s['total_cad'] > stats[best_streak_key]['total_cad']):
            best_streak, best_streak_key, best_streak_dates = streak, k, dates
    if best_streak_key and best_streak >= 2:
        start = fmt_date(best_streak_dates[0])
        end   = fmt_date(best_streak_dates[-1])
        s = stats[best_streak_key]
        tiebreak_note = f" · Won tiebreaker (C${s['total_cad']:,})" if best_streak > 0 else ''
        awards.append(('🔥', 'Longest Cash Streak', player_html(s),
                       f"{best_streak} in a row · {start} &amp; {end}{tiebreak_note}"))

    # ── Longest Final Table Streak ──
    best_ft_streak, best_ft_key, best_ft_dates = 0, None, []
    for k, s in stats.items():
        streak, dates = compute_streak(s['ft_dates'], all_event_dates)
        if streak > best_ft_streak or (streak == best_ft_streak and best_ft_key and s['total_cad'] > stats[best_ft_key]['total_cad']):
            best_ft_streak, best_ft_key, best_ft_dates = streak, k, dates
    if best_ft_key and best_ft_streak >= 2:
        start = fmt_date(best_ft_dates[0])
        end   = fmt_date(best_ft_dates[-1])
        s = stats[best_ft_key]
        awards.append(('⚡', 'Longest Final Table Streak', player_html(s),
                       f"{best_ft_streak} consecutive top-9 finishes · {start} &amp; {end}"))

    return awards


# ── HTML generation ────────────────────────────────────────────────────────────

def build_results_row(ev):
    date_display = ev.get('Date Display') or ''
    event_url    = ev.get('Event URL') or '#'
    display      = ev.get('Tournament (Display)') or ''
    typ          = ev.get('Type') or 'wed'
    entries      = ev.get('Entries') or ''
    prize_pool   = ev.get('Prize Pool') or ''
    first_place  = ev.get('1st Place') or ''
    winner_name  = ev.get('Winner Name') or ''
    winner_cc    = (ev.get('Country Code') or '').lower()
    winner_url   = ev.get('Winner URL') or ''
    color        = TYPE_COLOR.get(typ, 'var(--wed)')

    def cell(val, css):
        return f'<td class="{css}">{val}</td>' if val else '<td style="color:var(--muted)">—</td>'

    entries_td = cell(entries, 'rt-entries')
    pool_td    = cell(prize_pool, 'rt-pool')
    first_td   = cell(first_place, 'rt-first')

    if winner_name and winner_name.lower() != 'unknown':
        flag = f'<img class="flag-img" src="https://flagcdn.com/20x15/{winner_cc}.png" alt="{winner_cc.upper()}"> ' if winner_cc else ''
        link = f'<a class="rt-winner-link" href="{winner_url}" target="_blank">{winner_name}</a>' if winner_url else winner_name
        winner_td = f'<td class="td-l">{flag}{link}</td>'
    else:
        winner_td = '<td class="td-l" style="color:var(--muted);font-style:italic;">—</td>'

    return (
        f'        <tr>\n'
        f'          <td class="td-l rt-date">{date_display}</td>\n'
        f'          <td class="td-l"><span class="rt-type"><span class="rt-dot" style="background:{color}"></span>'
        f'<a class="rt-link" href="{event_url}" target="_blank">{display}</a></span></td>\n'
        f'          {entries_td}\n'
        f'          {pool_td}\n'
        f'          {first_td}\n'
        f'          {winner_td}\n'
        f'        </tr>'
    )


def build_players_js(stats):
    """Generate the PLAYERS JS array lines."""
    sorted_players = sorted(stats.values(), key=lambda s: -s['total_cad'])
    lines = []
    for s in sorted_players:
        pid   = s.get('id') or 0
        name  = s['name'].replace('"', '\\"')
        cc    = s.get('country_code', 'ca') or 'ca'
        lines.append(f'  [{pid}, "{name}", "{cc}", 1, {s["cashes"]}, {s["wins"]}, {s["total_cad"]}],')
    return '\n'.join(lines)


def build_award_card(icon, title, winner_html, detail):
    return (
        f'    <div class="award-card">\n'
        f'      <div class="award-icon">{icon}</div>\n'
        f'      <div class="award-title">{title}</div>\n'
        f'      <div class="award-winner">{winner_html}</div>\n'
        f'      <div class="award-detail">{detail}</div>\n'
        f'    </div>'
    )


def update_html(events, stats, awards, timestamp):
    with open(STATS_HTML, 'r', encoding='utf-8') as f:
        content = f.read()

    # ── Results tbody ──
    results_rows = '\n'.join(build_results_row(ev) for ev in events)
    new_tbody = f'\n{results_rows}\n      '
    content = re.sub(
        r'(<table class="results-table">.*?<tbody>)(.*?)(</tbody>)',
        lambda m: m.group(1) + new_tbody + m.group(3),
        content, count=1, flags=re.DOTALL
    )

    # ── Awards grid (anchored by <!-- Leaderboard --> comment) ──
    awards_html = '\n\n'.join(build_award_card(*a) for a in awards)
    content = re.sub(
        r'(<div class="awards-grid">)(.*?)(</div>\s*\n\s*<!-- Leaderboard -->)',
        lambda m: m.group(1) + '\n\n' + awards_html + '\n\n  ' + m.group(3),
        content, count=1, flags=re.DOTALL
    )

    # ── PLAYERS JS array ──
    players_js = build_players_js(stats)
    content = re.sub(
        r'(const PLAYERS = \[)(.*?)(\];)',
        lambda m: m.group(1) + '\n' + players_js + '\n' + m.group(3),
        content, count=1, flags=re.DOTALL
    )

    # ── Timestamps ──
    content = re.sub(r'Static snapshot, updated \d{4}-\d{2}-\d{2}',
                     f'Static snapshot, updated {timestamp}', content)
    content = re.sub(r'Static snapshot · Updated \d{4}-\d{2}-\d{2}',
                     f'Static snapshot · Updated {timestamp}', content)

    with open(STATS_HTML, 'w', encoding='utf-8') as f:
        f.write(content)


# ── Git push ───────────────────────────────────────────────────────────────────

def git_push(timestamp):
    subprocess.run(['git', 'add', 'tournamentstats.html'],
                   cwd=GITHUB_DIR, check=True, capture_output=True)
    diff = subprocess.run(['git', 'diff', '--cached', '--quiet'], cwd=GITHUB_DIR)
    if diff.returncode == 0:
        print("  No changes to commit.")
        return False
    subprocess.run(
        ['git', 'commit', '-m', f'Tournament stats update — {timestamp}'],
        cwd=GITHUB_DIR, check=True, capture_output=True
    )
    subprocess.run(['git', 'push'], cwd=GITHUB_DIR, check=True, capture_output=True)
    return True


# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    now       = datetime.now(TIMEZONE)
    timestamp = now.strftime('%Y-%m-%d')
    print(f"[{now.strftime('%Y-%m-%d %H:%M')}] Tournament stats update starting…")

    # ── Step 1: Load event list ──
    events = load_events()
    if not events:
        print("  No recurring events in results_2026.xlsx. Exiting.")
        return
    print(f"  Loaded {len(events)} recurring events.")

    # ── Step 2: Load player cache ──
    player_cache = load_player_cache()
    print(f"  Player cache: {len(player_cache)} events cached.")

    # ── Step 3: Scrape missing events ──
    needs_scrape = [ev for ev in events if ev['Event URL'] not in player_cache]
    print(f"  Events needing player scrape: {len(needs_scrape)}")
    if needs_scrape:
        run_player_scrapes(needs_scrape, player_cache)
        save_player_cache(player_cache)
        print("  Player cache saved.")

    # ── Step 4: Aggregate player stats ──
    stats = aggregate_players(events, player_cache)
    print(f"  Aggregated stats: {len(stats)} unique players.")

    # ── Step 5: Compute awards ──
    all_event_dates = [ev['Date ISO'] for ev in events if ev.get('Date ISO')]
    awards = compute_awards(stats, events, player_cache, all_event_dates)
    print(f"  Awards computed: {len(awards)}.")

    # ── Step 6: Update HTML ──
    update_html(events, stats, awards, timestamp)
    print("  tournamentstats.html updated.")

    # ── Step 7: Git push ──
    pushed = git_push(timestamp)
    if pushed:
        print("  Pushed to GitHub. ✓")

    print("Done.")


if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        import traceback
        err = f"❌ update_tournamentstats.py failed:\n{traceback.format_exc()[-600:]}"
        print(err)
        send_telegram(err)
        raise
