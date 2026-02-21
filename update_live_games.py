#!/usr/bin/env python3
"""update_live_games.py — Scrape Casino Niagara live games from Bravo Poker Live
and update the Live section of pokerroom.html, then push to GitHub.

Strategy:
  - Normal runs: headless Playwright with saved session cookies (fast, no Chrome window)
  - Session expired: re-login via real Chrome CDP, save fresh state, scrape headlessly

Cron: 10 12-23,0-4 * * *  (runs at :10 past the hour, 12pm–4am ET)
"""

import os
import re
import subprocess
import time
import shutil
from datetime import datetime

import pytz
from playwright.sync_api import sync_playwright

# ── Configuration ──────────────────────────────────────────────────────────────

BRAVO_EMAIL    = "kevinwright88@gmail.com"
BRAVO_PASSWORD = "Golfb51988"
LOGIN_URL      = "https://www.bravopokerlive.com/login/"
VENUE_URL      = "https://www.bravopokerlive.com/venues/casino-niagara/"

CHROME_BIN       = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
CDP_PORT         = 9877
TMP_PROFILE      = "/tmp/bravo-live-chrome"
OPENCLAW_CDP_URL = "http://127.0.0.1:9222"  # OpenClaw managed browser

BASE_DIR         = os.path.dirname(os.path.abspath(__file__))
STATE_FILE       = os.path.join(BASE_DIR, ".bravo_state.json")
GITHUB_DIR       = "/Users/kevinwright/Documents/GitHub/NiagaraBadBeat"
POKERROOM_GITHUB = os.path.join(GITHUB_DIR, "pokerroom.html")

PHONE    = "(905) 353-7000"
TIMEZONE = pytz.timezone("America/Toronto")

# ── Helpers ────────────────────────────────────────────────────────────────────

def get_timestamp():
    now = datetime.now(TIMEZONE)
    return now.strftime("%-I:%M %p · %b %-d, %Y")


def parse_game(raw):
    """'1-3 NL Holdem $100 - $300' → ('1/3 NL Hold'em', '$100 – $300 Buy-in')"""
    m = re.search(r'\$[\d,]+\s*-\s*\$[\d,]+', raw)
    if m:
        limits = m.group(0).replace(' - ', '\u2013') + ' Buy-in'
        name   = raw[:m.start()].strip()
    else:
        limits = ''
        name   = raw.strip()
    name = re.sub(r'^(\d+)-(\d+)\s+', r'\1/\2 ', name)
    name = re.sub(r'\bNL Holdem\b', "NL Hold\u2019em", name, flags=re.IGNORECASE)
    name = re.sub(r'\bMTS\b', '(Match the Stack)', name)
    return name.strip(), limits


def build_live_card(games):
    if not games:
        rows = '      <div class="live-table-row empty">\n        <div class="ltr-game" style="color:var(--muted);font-style:italic;">No active games</div>\n      </div>'
    else:
        parts = []
        for raw_name, tables in games:
            display, limits = parse_game(raw_name)
            lim = f'\n            <div class="ltr-limits">{limits}</div>' if limits else ''
            parts.append(f'      <div class="live-table-row">\n          <div>\n            <div class="ltr-game">{display}</div>{lim}\n          </div>\n          <div class="ltr-right">\n            <div class="ltr-count">{tables}</div>\n            <div class="ltr-count-label">Tables</div>\n          </div>\n        </div>')
        rows = '\n'.join(parts)
    return f'      <!-- Live Games -->\n      <div class="live-table-card">\n        <div class="live-table-card-header"><span class="lh-icon">🟢</span> Live Games</div>\n{rows}\n      </div>'


def build_waitlist_card(waitlist):
    waitlist = [(g, n) for g, n in waitlist if 'Table Change' not in g]
    if not waitlist:
        rows = '      <div class="live-table-row empty">\n        <div class="ltr-game" style="color:var(--muted);font-style:italic;">No waiting lists</div>\n      </div>'
    else:
        parts = []
        for raw_name, waiting in waitlist:
            display, limits = parse_game(raw_name)
            lim = f'\n            <div class="ltr-limits">{limits}</div>' if limits else ''
            parts.append(f'      <div class="live-table-row">\n          <div>\n            <div class="ltr-game">{display}</div>{lim}\n          </div>\n          <div class="ltr-right">\n            <div class="ltr-waiting-count">{waiting}</div>\n            <div class="ltr-count-label">Waiting</div>\n          </div>\n        </div>')
        rows = '\n'.join(parts)
    return f'      <!-- Waiting Lists -->\n      <div class="live-table-card">\n        <div class="live-table-card-header"><span class="lh-icon">📋</span> Waiting Lists</div>\n{rows}\n      </div>'


def build_error_card():
    return (
        '      <!-- Data Unavailable -->\n'
        '      <div class="live-table-card" style="grid-column:1/-1;">\n'
        '        <div class="live-table-card-header"><span class="lh-icon">⚠️</span> Live Data Unavailable</div>\n'
        '        <div class="live-table-row">\n'
        '          <div style="line-height:1.8;">\n'
        '            <div class="ltr-game">Unable to retrieve live game data</div>\n'
        '            <div class="ltr-limits">Contact the poker room directly for up-to-date table info:</div>\n'
        f'            <div class="ltr-limits" style="margin-top:4px;"><a href="tel:+19053537000" style="color:var(--gold3);text-decoration:none;font-weight:600;">{PHONE}</a></div>\n'
        '          </div>\n'
        '        </div>\n'
        '      </div>'
    )


# ── Scraping ───────────────────────────────────────────────────────────────────

def scrape_with_state(state_file):
    """Headless scrape using saved session state. Raises if not logged in."""
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(storage_state=state_file)
        page = ctx.new_page()
        page.set_default_timeout(20000)
        page.goto(VENUE_URL, wait_until='load')
        page.wait_for_timeout(1500)

        if '/login' in page.url:
            browser.close()
            raise RuntimeError("Session expired — need to re-login")

        games, waitlist = _extract_tables(page)
        ctx.storage_state(path=state_file)  # Refresh state with updated cookies
        browser.close()
        return games, waitlist


def login_and_scrape():
    """Full login via real Chrome CDP. Saves fresh state. Returns (games, waitlist)."""
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
            ctx = browser.contexts[0] if browser.contexts else browser.new_context()
            page = ctx.new_page()
            page.set_default_timeout(25000)

            # Login
            page.goto(LOGIN_URL, wait_until='load')
            page.wait_for_timeout(2000)
            page.fill('input[name="Email"]', BRAVO_EMAIL)
            page.fill('input[name="Password"]', BRAVO_PASSWORD)
            page.keyboard.press('Enter')
            page.wait_for_load_state('networkidle', timeout=15000)

            if '/login' in page.url:
                raise RuntimeError(f"Login failed — still on {page.url}")

            # Navigate to venue
            page.goto(VENUE_URL, wait_until='load')
            page.wait_for_timeout(2000)

            if '/login' in page.url:
                raise RuntimeError("Redirected to login after navigating to venue")

            games, waitlist = _extract_tables(page)

            # Save fresh session state for future headless runs
            ctx.storage_state(path=STATE_FILE)
            print(f"  Session state saved to {STATE_FILE}")
            browser.close()
            return games, waitlist
    finally:
        proc.terminate()
        time.sleep(0.5)
        try:
            shutil.rmtree(TMP_PROFILE)
        except Exception:
            pass


def scrape_with_openclaw_browser():
    """Final fallback: connect to OpenClaw managed browser via CDP and login."""
    # Ensure the OpenClaw browser is running
    subprocess.run(
        ['openclaw', 'browser', '--browser-profile', 'openclaw', 'start'],
        capture_output=True
    )
    time.sleep(3)

    with sync_playwright() as p:
        browser = p.chromium.connect_over_cdp(OPENCLAW_CDP_URL)
        ctx = browser.new_context()
        page = ctx.new_page()
        page.set_default_timeout(25000)
        try:
            page.goto(LOGIN_URL, wait_until='load')
            page.wait_for_timeout(2000)
            page.fill('input[name="Email"]', BRAVO_EMAIL)
            page.fill('input[name="Password"]', BRAVO_PASSWORD)
            page.keyboard.press('Enter')
            page.wait_for_load_state('networkidle', timeout=15000)

            if '/login' in page.url:
                raise RuntimeError(f"Login failed — still on {page.url}")

            page.goto(VENUE_URL, wait_until='load')
            page.wait_for_timeout(2000)

            if '/login' in page.url:
                raise RuntimeError("Redirected to login after navigating to venue")

            games, waitlist = _extract_tables(page)

            ctx.storage_state(path=STATE_FILE)
            print(f"  Session state saved to {STATE_FILE}")
            return games, waitlist
        finally:
            page.close()
            ctx.close()


def _extract_tables(page):
    """Extract (games, waitlist) from an already-loaded venue page."""
    games = []
    live_tbl = page.locator('table:has(th:text("Current Live Games"))')
    if live_tbl.count() > 0:
        rows = live_tbl.first.locator('tbody tr')
        for i in range(rows.count()):
            cells = rows.nth(i).locator('td')
            if cells.count() >= 2:
                name, tables = cells.nth(0).inner_text().strip(), cells.nth(1).inner_text().strip()
                if name and tables:
                    games.append((name, tables))

    waitlist = []
    wait_tbl = page.locator('table:has(th:text("Current Waiting List"))')
    if wait_tbl.count() > 0:
        rows = wait_tbl.first.locator('tbody tr')
        for i in range(rows.count()):
            cells = rows.nth(i).locator('td')
            if cells.count() >= 2:
                name, waiting = cells.nth(0).inner_text().strip(), cells.nth(1).inner_text().strip()
                if name and waiting:
                    waitlist.append((name, waiting))

    return games, waitlist


def scrape_bravo():
    """Try headless first; fall back to Chrome CDP login; final fallback = OpenClaw browser."""
    if os.path.exists(STATE_FILE):
        try:
            print("  Trying headless with saved session…")
            return scrape_with_state(STATE_FILE)
        except RuntimeError as e:
            print(f"  Headless failed ({e}), falling back to Chrome CDP login…")

    try:
        print("  Running full Chrome CDP login…")
        return login_and_scrape()
    except Exception as e:
        print(f"  Chrome CDP failed ({e}), falling back to OpenClaw browser…")

    print("  Running OpenClaw browser fallback…")
    return scrape_with_openclaw_browser()


# ── HTML update ────────────────────────────────────────────────────────────────

def update_pokerroom(grid_html, timestamp):
    with open(POKERROOM_GITHUB, 'r', encoding='utf-8') as f:
        content = f.read()

    new_section = (
        '  <!-- Live Games -->\n'
        '  <div class="live-section">\n'
        '    <div class="live-section-header">\n'
        '      <p class="section-title">Live Right Now</p>\n'
        f'      <span class="live-timestamp"><span class="live-dot"></span>As of {timestamp}</span>\n'
        '    </div>\n'
        '    <div class="live-tables-grid">\n\n'
        f'{grid_html}\n\n'
        '    </div>\n'
        '  </div>\n\n'
        '  '
    )

    pattern = r'  <!-- Live Games -->.*?(?=  <!-- Amenities -->)'
    new_content = re.sub(pattern, new_section, content, count=1, flags=re.DOTALL)

    if new_content == content:
        raise RuntimeError("Live section pattern not found in pokerroom.html")

    with open(POKERROOM_GITHUB, 'w', encoding='utf-8') as f:
        f.write(new_content)


# ── Git push ───────────────────────────────────────────────────────────────────

def git_push(timestamp):
    subprocess.run(['git', 'add', 'pokerroom.html'], cwd=GITHUB_DIR, check=True, capture_output=True)
    diff = subprocess.run(['git', 'diff', '--cached', '--quiet'], cwd=GITHUB_DIR)
    if diff.returncode == 0:
        print("  No changes to commit.")
        return
    subprocess.run(['git', 'commit', '-m', f'Live games update — {timestamp}'],
                   cwd=GITHUB_DIR, check=True, capture_output=True)
    subprocess.run(['git', 'push'], cwd=GITHUB_DIR, check=True, capture_output=True)


# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    timestamp = get_timestamp()
    print(f"[{timestamp}] Live games update starting…")

    try:
        games, waitlist = scrape_bravo()
        print(f"  Scraped: {len(games)} game(s), {len(waitlist)} waiting list(s)")
        grid_html = build_live_card(games) + '\n\n' + build_waitlist_card(waitlist)
    except Exception as e:
        print(f"  Scrape failed: {e}")
        grid_html = build_error_card()

    try:
        update_pokerroom(grid_html, timestamp)
        print("  pokerroom.html updated.")
    except Exception as e:
        print(f"  HTML update error: {e}")
        return

    try:
        git_push(timestamp)
        print("  Pushed to GitHub. ✓")
    except subprocess.CalledProcessError as e:
        print(f"  Git push failed: {e.stderr.decode() if e.stderr else e}")


if __name__ == '__main__':
    main()
