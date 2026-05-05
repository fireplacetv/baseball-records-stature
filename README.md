# Baseball Record Stature

A static web page that visualizes the **stature** of all-time career baseball records over time. Select a stat from the dropdown; four charts and a summary table redraw to show how imposing the record was, year by year, and how each record holder compares.

**Live site:** `https://fireplacetv.github.io/baseball-records-stature/`

---

## Data Source

Data from the [Lahman Baseball Database](https://sabr.org/lahman-database/), maintained by SABR. Originally created by Sean Lahman. Licensed under [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/).

---

## Running the Processor Locally

The processor reads the Lahman SQL Server backup file and computes JSON data files into `data/`. It requires **Docker** to be installed and running.

### 1. Get the Lahman database

Download the SQL Server backup (`.bak`) from SABR:

> https://sabr.app.box.com/s/y1prhc795jk8zvmelfd3jq7tl389y6cd

Place the `.bak` file in the `sources/` folder (it is gitignored).

### 2. Install Python dependencies

```bash
cd processor
pip install -r requirements.txt
```

### 3. Build all data files

```bash
python build.py --all
```

The script will:
1. Start a temporary SQL Server Docker container
2. Restore the `.bak` file
3. Extract the required tables
4. Compute all stats and write to `data/`
5. Stop and remove the container

To compute a single stat:

```bash
python build.py --stat HR
```

To point to a `.bak` file outside `sources/`:

```bash
python build.py --all --source /path/to/lahman.bak
```

To list available stat codes:

```bash
python build.py --list
```

---

## Serving Locally

From the project root:

```bash
python -m http.server
```

Then open `http://localhost:8000` in your browser.

---

## GitHub Pages Setup

1. Go to repo **Settings → Pages**
2. Source: `main` branch, `/ (root)` folder
3. Save — the site will be live at `https://{username}.github.io/{repo-name}/`

---

## Triggering a Manual Data Refresh (GitHub Actions)

The Actions workflow requires a `.bak` file to be available. Because the file is not committed to the repo, you need to provide it as an artifact or set up a private storage source before using the workflow. For local updates, run the processor directly and commit the resulting `data/` files.

---

## Updating to a New Lahman Release

1. Download the new `.bak` from SABR
2. Place it in `sources/`
3. Update `processor/config.ini` — set `version` and `covers_through` to match the new release
4. Run `python build.py --all`
5. Commit the updated `data/` files to `main`

---

## Known Limitations

- The computed `data/*.json` files must be rebuilt manually each year when SABR publishes a new Lahman release.
- Lahman data lags the live season; stats reflect the most recently completed season in the database.
- Docker must be running when the processor is invoked.
