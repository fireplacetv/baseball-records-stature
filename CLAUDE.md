# Baseball Record Stature — Agent Instructions

## Project Overview

Build a static web page that visualizes the **stature** of all-time career baseball records over time, sourcing data from the [Lahman Baseball Database](https://github.com/chadwickbureau/baseballdatabank) — a freely redistributable dataset. Users select a stat from a dropdown; the page redraws four charts and a summary table for that stat.

A companion Python processor downloads the Lahman database and computes one JSON file per stat into `data/`. The web page reads only from those JSON files — no runtime API calls.

---

## Architecture

```
project/
├── CLAUDE.md
├── index.html              # single-page app
├── assets/
│   ├── main.js
│   └── style.css
├── data/
│   ├── _index.json         # stat list for dropdown
│   └── {stat_code}.json    # one file per stat (e.g. HR.json, 3B.json)
├── processor/
│   ├── build.py            # main entry point
│   ├── stats.py            # stat definitions (hardcoded list)
│   ├── config.ini          # download URL and version metadata; update annually
│   └── requirements.txt
├── .github/
│   └── workflows/
│       └── update-data.yml
├── .gitignore
└── README.md
```

**No build step. No framework. No bundler.** Vanilla HTML/CSS/JS. Charts via Chart.js loaded from CDN.

---

## GitHub Pages Hosting

### Deployment

The site is served directly from the `main` branch root via GitHub Pages. Enable it in repo Settings → Pages → Source: `main` / `/ (root)`.

The live URL will be `https://{username}.github.io/{repo-name}/`. All fetch paths for JSON data files must be **relative** (e.g., `./data/HR.json`, not `/data/HR.json`) so they resolve correctly under the repo subdirectory.

### `.gitignore`

```
__pycache__/
*.pyc
.env
processor/venv/
processor/lahman/         # downloaded CSV source files; do not commit
```

The `data/` directory must **not** be gitignored. Computed JSON files are committed to the repo — they are the site's data layer. The raw Lahman CSVs are downloaded at processing time and should not be committed (they're large and already available upstream).

### Data Update Workflow (GitHub Actions)

Create `.github/workflows/update-data.yml`. This workflow downloads the latest Lahman release, runs the processor, and commits any changed JSON files back to `main`.

```yaml
name: Update Baseball Data

on:
  schedule:
    - cron: '0 8 1 11 *'   # annually: November 1 — after Lahman's post-season update
  workflow_dispatch:          # allow manual trigger from Actions tab

jobs:
  build:
    runs-on: ubuntu-latest
    permissions:
      contents: write

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-python@v5
        with:
          python-version: '3.11'
          cache: 'pip'
          cache-dependency-path: processor/requirements.txt

      - name: Install dependencies
        run: pip install -r processor/requirements.txt

      - name: Build data files
        run: python processor/build.py --all

      - name: Commit updated data
        run: |
          git config user.name  "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add data/
          git diff --cached --quiet || git commit -m "chore: update data from Lahman [skip ci]"
          git push
```

The schedule runs once a year in November, after the Lahman database is typically updated with the completed season. The `workflow_dispatch` trigger lets you run it manually at any time.

### First Deploy Checklist

1. Run `python processor/build.py --all` locally to populate `data/`
2. Commit everything including `data/` to `main` (but not `processor/lahman/`)
3. Enable GitHub Pages in repo settings (source: `main`, root)
4. Confirm the live URL loads and charts render
5. Trigger the Actions workflow manually once to verify it can commit

---

## Data Source

### Lahman Baseball Database

**Canonical source (manual download):**
```
https://sabr.org/lahman-database/
```
Files are hosted on SABR's Box account at:
```
https://sabr.app.box.com/s/y1prhc795jk8zvmelfd3jq7tl389y6cd
```
Sean Lahman donated the database to SABR in 2024. The current version (2025) covers complete statistics from 1871 through the 2025 season, including Negro Leagues data licensed from Seamheads.com. Contact: lahmandb@sabr.org.

**Automated download:** configured in `processor/config.ini` (see Config File section below). The processor reads the download URL from that file at runtime. Box shared folders do not expose a stable direct-download zip endpoint, so the URL in `config.ini` must point to a direct-download link for a zip file. See the Config File section for how to obtain and update this link when SABR publishes a new release.

The database is released under a **Creative Commons Attribution-ShareAlike 3.0 Unported license**. Computed `data/*.json` files may be committed to a public GitHub repo and served via GitHub Pages without restriction, provided attribution to Sean Lahman and SABR is included (see README).

The processor downloads the zip at runtime, extracts to `processor/lahman/`, and reads these files:

| File | Purpose |
|------|---------|
| `core/People.csv` | Player names and `playerID` |
| `core/Batting.csv` | Season batting stats per player |
| `core/Pitching.csv` | Season pitching stats per player |
| `core/Appearances.csv` | Games appeared per player per season |

### Active Player Detection

A player is considered **active in year Y** if they appear in `Appearances.csv` for `yearID == Y` with `G_all > 0`. Use `Appearances.csv` as the authoritative source — it covers all players regardless of stat category and is more complete than filtering the batting or pitching tables alone.

---

## Supported Stats

The dropdown is populated from a **hardcoded list** in `processor/stats.py` and mirrored to `data/_index.json`. Do not dynamically discover stats — only include stats that are meaningful as cumulative career counting records.

```python
STATS = [
    # Batting
    {"code": "HR",   "label": "Home Runs",          "table": "batting",  "column": "HR"},
    {"code": "H",    "label": "Hits",                "table": "batting",  "column": "H"},
    {"code": "2B",   "label": "Doubles",             "table": "batting",  "column": "2B"},
    {"code": "3B",   "label": "Triples",             "table": "batting",  "column": "3B"},
    {"code": "RBI",  "label": "Runs Batted In",      "table": "batting",  "column": "RBI"},
    {"code": "R",    "label": "Runs Scored",         "table": "batting",  "column": "R"},
    {"code": "SB",   "label": "Stolen Bases",        "table": "batting",  "column": "SB"},
    {"code": "BB_B", "label": "Walks (Batter)",      "table": "batting",  "column": "BB"},
    {"code": "SO_B", "label": "Strikeouts (Batter)", "table": "batting",  "column": "SO"},
    # Pitching
    {"code": "W",    "label": "Wins",                "table": "pitching", "column": "W"},
    {"code": "SO_P", "label": "Strikeouts (Pitcher)","table": "pitching", "column": "SO"},
    {"code": "SV",   "label": "Saves",               "table": "pitching", "column": "SV"},
    {"code": "G_P",  "label": "Games Pitched",       "table": "pitching", "column": "G"},
]
```

Do not include rate stats (ERA, AVG, OBP, WHIP). They are not meaningful as cumulative career records.

For batting stats, **sum across all `teamID` rows** for a given `playerID`/`yearID` pair — players traded mid-season have multiple rows per year.

---

## Config File

Create `processor/config.ini`. This is the single place users update when SABR publishes a new annual release.

```ini
[lahman]
# Direct-download URL for the Lahman database zip file.
# Update this each year when SABR publishes a new release.
# To get a direct-download link from the SABR Box folder:
#   1. Go to https://sabr.app.box.com/s/y1prhc795jk8zvmelfd3jq7tl389y6cd
#   2. Locate the CSV zip file for the current year
#   3. Click the "..." menu on the file → "Share" → "Create shared link"
#      or use the direct download option to obtain a URL ending in ?dl=1 or similar
# The URL must point directly to a zip file, not a Box folder page.
download_url = https://sabr.app.box.com/s/y1prhc795jk8zvmelfd3jq7tl389y6cd
```

The processor reads `download_url` at startup using Python's `configparser`. If the URL is unreachable or returns non-zip content, the processor should exit with a clear error message directing the user to update `config.ini`.

`config.ini` is committed to the repo. Do not put secrets or credentials in it.

---

## Processor

### Entry Point

```
python processor/build.py [--stat HR] [--all] [--list]
```

- `--stat HR` — compute one stat and write `data/HR.json`
- `--all` — compute all stats and write `data/_index.json`
- `--list` — print available stat codes and exit

### Processing Logic

For each stat, iterate over all years from the first year the stat appears through the most recent year in the data. For each year Y:

1. **Career totals through Y**: Group the relevant table by `playerID`, filter to `yearID <= Y`, sum the stat column.

2. **Career record**: The player with the highest career total through Y (active or retired).

3. **Active leader**: Filter career totals to players present in `Appearances` for year Y (`G_all > 0`), then find the max.

4. **Yearly leader**: The player with the highest value for the stat in season Y alone.

5. **Single-season record**: The highest single-season value for the stat in any year ≤ Y.

Resolve `playerID` to display name using `People.csv`: `nameFirst + " " + nameLast`.

### Performance Note

Computing career totals from scratch for every year is O(years²) on the data. Use pandas with a cumulative groupby approach or precompute a career-totals-through-year matrix to keep runtime reasonable across 150+ years and 13 stats.

### Output Schema

`data/{stat_code}.json`:

```json
{
  "stat": "HR",
  "label": "Home Runs",
  "generated_at": "2025-11-01T08:00:00Z",
  "lahman_version": "2024",
  "rows": [
    {
      "year": 1871,
      "career_record": 4,
      "career_record_holder": "Lip Pike",
      "active_leader": "Lip Pike",
      "active_leader_total": 4,
      "yearly_leader": "Lip Pike",
      "yearly_total": 4,
      "single_season_record": 4,
      "single_season_record_holder": "Lip Pike"
    }
  ]
}
```

Field definitions:
- `career_record` — highest career cumulative total as of end of that year (any player)
- `career_record_holder` — player holding that all-time record
- `active_leader` — highest career total among players who appeared that year
- `active_leader_total` — their career total through that year
- `yearly_leader` — single-season leader for that year
- `yearly_total` — their single-season total
- `single_season_record` / `single_season_record_holder` — all-time single-season high as of that year

Use `null` for any field that cannot be determined.

`data/_index.json`:

```json
[
  {"code": "HR",  "label": "Home Runs"},
  {"code": "H",   "label": "Hits"}
]
```

---

## Metric Definitions

All metrics are computed **in JavaScript from the JSON data** — not in the processor.

Given the `rows` array sorted by `year` ascending:

### Gap (per year)
```
gap[year] = career_record[year] - active_leader_total[year]
```
Zero when the active leader IS the all-time career leader.

### Climb (per year)
```
climb[year] = career_record[year] - career_record[year - 1]
              only when career_record_holder[year] == active_leader[year]
```
Counts only seasons when the active leader is actively extending the record. Zero otherwise.

### Record Holders List
Scan `career_record_holder` across rows in order. Collect distinct holders in the order they first took the record, noting first year and last year held.

### Per-Holder Metrics

For each record holder H, over years Y where `career_record_holder[Y] == H`:

**Cumulative Gap**
```
cumulative_gap[H] = sum of gap[Y]
```

**Cumulative Climb**
```
cumulative_climb[H] = sum of climb[Y]
```

**Active Years as All-Time Leader**
```
active_years[H] = count of Y where:
    career_record_holder[Y] == H
    AND active_leader[Y] == H
    AND active_leader_total[Y] == career_record[Y]  (gap == 0)
```
Seasons where H was still playing AND held the record with no gap.

**Total Stature Score**
```
stature[H] = cumulative_gap[H] + cumulative_climb[H]
```

---

## Frontend

### Dropdown

On page load, fetch `./data/_index.json` and populate a `<select>`. Default to `HR`. On change, fetch `./data/{stat_code}.json`, recompute all metrics, redraw all charts and the table.

### Chart 1 — Area Chart: Career Record vs Active Leader

- X axis: year
- Two filled area series (not stacked on top of each other):
  - **Career Record** (upper line)
  - **Active Leader** (lower line)
- The shaded gap between them is the visual story
- Tooltip: Year, Career Record Holder + total, Active Leader + total, Gap

### Chart 2 — Bar Chart: Cumulative Gap

- X axis: record holders in chronological order
- Y axis: cumulative gap
- Title: "Stature of Record (Cumulative Gap)"
- Assign consistent colors per holder from a fixed palette; reuse the same colors in Charts 3 and 4

### Chart 3 — Bar Chart: Climb Over Previous Record

- X axis / colors: same as Chart 2
- Y axis: cumulative climb
- Title: "Climb Over Previous Record"

### Chart 4 — Bar Chart: Active Years as All-Time Leader

- X axis / colors: same as Chart 2
- Y axis: active years count
- Title: "Active Years Holding the Record"

### Summary Table

`Player | Years Held | Peak Record | Cumulative Gap | Cumulative Climb | Active Years | Stature Score`

Chronological order by default; click column headers to re-sort.

### Layout

Single column, charts stacked vertically. Dropdown sticky at top. Mobile-friendly.

---

## Visual Design Direction

**Editorial / archival.** Think Baseball Encyclopedia meets mid-century data visualization — not SaaS dashboard.

- Serif or slab-serif for headings; tabular monospace for numbers
- Muted, aged palette: off-white background, dark ink text, one strong accent color (deep red or deep green)
- No rounded corners, no drop shadows, no gradients on UI chrome
- Charts should feel like printed charts: clean axes, no chart junk, grid lines light and receding
- The area chart is the hero — give it the most vertical space

---

## Non-Goals (Do Not Build)

- No web scraping of any kind
- No user accounts, no server, no database
- No pitcher vs. batter filtering
- No career-length normalization or era adjustment
- No single-season record visualization (data captured but not charted)
- No animation beyond Chart.js defaults
- No React, Vue, or any framework
- No CSS preprocessor
- No custom domain configuration

---

## README

Include a `README.md` covering:
1. Live site link (`https://{username}.github.io/{repo-name}/`)
2. Data source attribution: "Data from the Lahman Baseball Database, maintained by SABR (sabr.org/lahman-database). Originally created by Sean Lahman. Licensed under CC BY-SA 3.0."
3. How to run the processor locally: `python processor/build.py --all`
4. How to serve the page locally: `python -m http.server` from project root
5. How to enable GitHub Pages (Settings → Pages → main / root)
6. How to trigger a manual data refresh (Actions tab → Update Baseball Data → Run workflow)
7. How to update the data source URL when SABR publishes a new release: edit `processor/config.ini`, update `download_url` to the new direct-download link, update `version` and `covers_through`, commit, then run the workflow
8. Known limitation: Lahman data lags the live season; stats reflect the most recently completed season in the database

---

## Implementation Order

1. `processor/config.ini` — download URL and version metadata
2. `processor/stats.py` — hardcoded STATS list
3. `processor/build.py` — read config, download Lahman zip, extract, compute all stats, write JSON
3. Run locally; verify `HR.json`, `3B.json`, and `_index.json` look correct
4. `index.html` — dropdown + layout shell, relative `./data/` fetch paths
5. Metric computation functions in `assets/main.js`
6. Chart 1 (area chart) — do first, it's the most complex
7. Charts 2, 3, 4 (bar charts)
8. Summary table with sort
9. Wire dropdown to reload everything
10. `.github/workflows/update-data.yml`
11. `.gitignore`
12. `README.md`
