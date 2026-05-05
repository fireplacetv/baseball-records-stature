#!/usr/bin/env python3
"""
Build JSON data files for the Baseball Record Stature visualizer.

Reads the Lahman SQL Server backup (.bak) from sources/ and produces
JSON files in data/ using a temporary Docker SQL Server container.

Usage:
  python build.py --all [--source path/to/lahman.bak]
  python build.py --stat HR [--source path/to/lahman.bak]
  python build.py --list

If --source is omitted the script looks for a single *.bak file in sources/.
Docker must be installed and running.
"""

import argparse
import configparser
import io
import json
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

from stats import STATS

ROOT       = Path(__file__).parent.parent
DATA_DIR   = ROOT / "data"
SOURCES_DIR = ROOT / "sources"
CONFIG_PATH = Path(__file__).parent / "config.ini"

# ── Docker / SQL Server constants ─────────────────────────────────────────
_CONTAINER = "lahman-extract"
_SA_PASS   = "Lahm@n_2024!"        # meets SQL Server complexity requirements
_DB        = "lahman"
_IMAGE     = "mcr.microsoft.com/mssql/server:2025-latest"


# ── Config ─────────────────────────────────────────────────────────────────
def load_config():
    cfg = configparser.ConfigParser()
    cfg.read(CONFIG_PATH)
    return cfg.get("lahman", "version", fallback="unknown")


# ── Source resolution ───────────────────────────────────────────────────────
def find_bak(source_arg):
    if source_arg:
        p = Path(source_arg)
        if not p.exists():
            sys.exit(f"ERROR: Source file not found: {source_arg}")
        return p.resolve()

    baks = sorted(SOURCES_DIR.glob("*.bak"))
    if not baks:
        sys.exit(
            f"ERROR: No .bak file found in {SOURCES_DIR}/\n"
            "Download the Lahman SQL Server backup from SABR:\n"
            "  https://sabr.app.box.com/s/y1prhc795jk8zvmelfd3jq7tl389y6cd\n"
            "Place the .bak file in sources/, or pass --source <path>."
        )
    if len(baks) > 1:
        names = ", ".join(b.name for b in baks)
        sys.exit(
            f"ERROR: Multiple .bak files in {SOURCES_DIR}/: {names}\n"
            "Use --source <path> to specify which one."
        )
    return baks[0].resolve()


# ── Docker helpers ──────────────────────────────────────────────────────────
def check_docker():
    r = subprocess.run(["docker", "info"], capture_output=True)
    if r.returncode != 0:
        sys.exit(
            "ERROR: Docker is not running or not installed.\n"
            "Install Docker Desktop (https://www.docker.com/products/docker-desktop/)\n"
            "and start it, then retry."
        )


def start_container():
    # Remove any leftover container from a prior run
    subprocess.run(["docker", "rm", "-f", _CONTAINER], capture_output=True)
    subprocess.run(
        [
            "docker", "run", "-d",
            "--name", _CONTAINER,
            "--platform", "linux/amd64",   # explicit for ARM Macs (Rosetta)
            "-e", "ACCEPT_EULA=Y",
            "-e", f"MSSQL_SA_PASSWORD={_SA_PASS}",
            _IMAGE,
        ],
        check=True,
        capture_output=True,
    )


def stop_container():
    subprocess.run(["docker", "rm", "-f", _CONTAINER], capture_output=True)


def find_sqlcmd():
    r = subprocess.run(
        ["docker", "exec", _CONTAINER, "find", "/opt", "-name", "sqlcmd", "-type", "f"],
        capture_output=True, text=True,
    )
    paths = [l.strip() for l in r.stdout.splitlines() if l.strip()]
    if not paths:
        sys.exit("ERROR: sqlcmd not found inside the SQL Server container.")
    return paths[0]


def wait_for_sqlserver(sqlcmd):
    print("  Waiting for SQL Server to start", end="", flush=True)
    for _ in range(150):  # up to 5 minutes (slower on ARM Macs via Rosetta)
        r = subprocess.run(
            ["docker", "exec", _CONTAINER,
             sqlcmd, "-S", "localhost", "-U", "SA", "-P", _SA_PASS,
             "-C", "-Q", "SELECT 1", "-b"],
            capture_output=True,
        )
        if r.returncode == 0:
            print(" ready.")
            return
        print(".", end="", flush=True)
        time.sleep(2)
    sys.exit("\nERROR: SQL Server did not become ready within 5 minutes.")


def run_sql(sqlcmd, query, db=None, extra_flags=None):
    cmd = [
        "docker", "exec", _CONTAINER,
        sqlcmd, "-S", "localhost", "-U", "SA", "-P", _SA_PASS,
        "-C", "-b", "-Q", query,
    ]
    if db:
        cmd += ["-d", db]
    if extra_flags:
        cmd += extra_flags
    r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if r.returncode != 0:
        raise RuntimeError(f"SQL error:\n{r.stderr.strip()}\n{r.stdout.strip()}")
    return r.stdout


def query_df(sqlcmd, query, columns, db=_DB):
    """Run a SELECT and return a DataFrame with the given column names."""
    r = subprocess.run(
        [
            "docker", "exec", _CONTAINER,
            sqlcmd, "-S", "localhost", "-U", "SA", "-P", _SA_PASS,
            "-C", "-b", "-s", "|", "-y", "0",
            "-d", db,
            "-Q", f"SET NOCOUNT ON; {query}",
        ],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
    )
    if r.returncode != 0:
        raise RuntimeError(f"SQL error:\n{r.stderr.strip()}\n{r.stdout.strip()}")

    lines = [
        l for l in r.stdout.splitlines()
        if l.strip() and not l.strip().startswith("(")
    ]
    if not lines:
        return pd.DataFrame(columns=columns)

    return pd.read_csv(
        io.StringIO("\n".join(lines)),
        sep="|", header=None, names=columns,
        na_values=["NULL", ""], low_memory=False,
    )


# ── Backup restore ──────────────────────────────────────────────────────────
def get_logical_names(sqlcmd, container_path):
    """Return (data_logical_names, log_logical_names) from RESTORE FILELISTONLY."""
    r = subprocess.run(
        [
            "docker", "exec", _CONTAINER,
            sqlcmd, "-S", "localhost", "-U", "SA", "-P", _SA_PASS,
            "-C", "-s", "|", "-y", "0",
            "-Q", f"RESTORE FILELISTONLY FROM DISK = N'{container_path}'",
        ],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
    )
    data_names, log_names = [], []
    for line in r.stdout.splitlines():
        parts = line.split("|")
        if len(parts) < 3:
            continue
        name  = parts[0].strip()
        ftype = parts[2].strip()
        if not name or ftype not in ("D", "L"):
            continue
        (data_names if ftype == "D" else log_names).append(name)
    if not data_names:
        sys.exit(
            "ERROR: Could not read file list from the .bak file.\n"
            "Ensure the file is a valid SQL Server backup."
        )
    return data_names, log_names


def restore_database(sqlcmd, bak_path: Path):
    container_bak = "/tmp/lahman.bak"
    print("  Copying .bak into container...")
    subprocess.run(
        ["docker", "cp", str(bak_path), f"{_CONTAINER}:{container_bak}"],
        check=True,
    )

    data_names, log_names = get_logical_names(sqlcmd, container_bak)

    move_parts = [
        f"MOVE N'{n}' TO N'/var/opt/mssql/data/lahman_{i}.mdf'"
        for i, n in enumerate(data_names)
    ] + [
        f"MOVE N'{n}' TO N'/var/opt/mssql/data/lahman_log_{i}.ldf'"
        for i, n in enumerate(log_names)
    ]

    restore_sql = (
        f"RESTORE DATABASE [{_DB}] FROM DISK = N'{container_bak}' "
        f"WITH {', '.join(move_parts)}, REPLACE, STATS = 10"
    )

    print("  Restoring database (this may take a minute)...")
    run_sql(sqlcmd, restore_sql)
    print("  Database restored.")


# ── Table loading ───────────────────────────────────────────────────────────
def detect_people_table(sqlcmd):
    """Return 'People' or 'Master' depending on which exists."""
    for tbl in ("People", "Master"):
        try:
            run_sql(sqlcmd, f"SELECT TOP 1 playerID FROM dbo.[{tbl}]", db=_DB)
            return tbl
        except RuntimeError:
            pass
    sys.exit("ERROR: Neither People nor Master table found in the Lahman database.")


def load_tables(sqlcmd):
    print("  Loading People...")
    people_tbl = detect_people_table(sqlcmd)
    people = query_df(
        sqlcmd,
        f"SELECT playerID, nameFirst, nameLast FROM dbo.[{people_tbl}]",
        ["playerID", "nameFirst", "nameLast"],
    )
    people["name"] = (
        people["nameFirst"].fillna("") + " " + people["nameLast"].fillna("")
    ).str.strip()
    name_map = people.set_index("playerID")["name"].to_dict()

    print("  Loading Batting...")
    batting = query_df(
        sqlcmd,
        "SELECT playerID, yearID, teamID, HR, H, [2B], [3B], RBI, R, SB, BB, SO "
        "FROM dbo.Batting",
        ["playerID", "yearID", "teamID", "HR", "H", "2B", "3B", "RBI", "R", "SB", "BB", "SO"],
    )

    print("  Loading Pitching...")
    pitching = query_df(
        sqlcmd,
        "SELECT playerID, yearID, teamID, W, SO, SV, G FROM dbo.Pitching",
        ["playerID", "yearID", "teamID", "W", "SO", "SV", "G"],
    )

    print("  Loading Appearances...")
    appearances = query_df(
        sqlcmd,
        "SELECT playerID, yearID, G_all FROM dbo.Appearances",
        ["playerID", "yearID", "G_all"],
    )

    print(
        f"  {len(name_map)} players, "
        f"{batting['yearID'].nunique()} batting seasons, "
        f"{pitching['yearID'].nunique()} pitching seasons"
    )
    return name_map, batting, pitching, appearances


# ── Stat computation ────────────────────────────────────────────────────────
def active_players_by_year(appearances: pd.DataFrame) -> dict:
    active = appearances[appearances["G_all"] > 0]
    return active.groupby("yearID")["playerID"].apply(set).to_dict()


def compute_stat(stat_def, name_map, batting, pitching, active_by_year, lahman_version):
    code  = stat_def["code"]
    label = stat_def["label"]
    table = batting if stat_def["table"] == "batting" else pitching
    col   = stat_def["column"]

    print(f"  Computing {code} ({label})...")

    if col not in table.columns:
        print(f"    WARNING: column '{col}' not found; skipping.")
        return None

    df = table[["playerID", "yearID", col]].copy()
    df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)
    season = df.groupby(["playerID", "yearID"])[col].sum().reset_index()
    season.columns = ["playerID", "yearID", "val"]

    years = sorted(season["yearID"].unique())
    if not years:
        return None

    all_years = list(range(min(years), max(years) + 1))
    pivot = season.pivot_table(
        index="playerID", columns="yearID", values="val", aggfunc="sum", fill_value=0
    )
    pivot = pivot.reindex(columns=all_years, fill_value=0)
    cumulative = pivot.cumsum(axis=1)

    rows = []
    ss_record = 0
    ss_record_holder = None

    for year in all_years:
        career_through = cumulative[year].copy()
        career_through = career_through[career_through > 0]

        if career_through.empty:
            rows.append({
                "year": year,
                "career_record": None, "career_record_holder": None,
                "active_leader": None, "active_leader_total": None,
                "yearly_leader": None, "yearly_total": None,
                "single_season_record": None, "single_season_record_holder": None,
            })
            continue

        cr_player = career_through.idxmax()
        cr_total  = int(career_through[cr_player])

        active_set    = active_by_year.get(year, set())
        active_career = career_through[career_through.index.isin(active_set)]
        if not active_career.empty:
            al_player = active_career.idxmax()
            al_total  = int(active_career[al_player])
        else:
            al_player = al_total = None

        year_rows = season[season["yearID"] == year]
        if not year_rows.empty:
            yl_idx    = year_rows["val"].idxmax()
            yl_player = year_rows.loc[yl_idx, "playerID"]
            yl_total  = int(year_rows.loc[yl_idx, "val"])
            if yl_total > ss_record:
                ss_record = yl_total
                ss_record_holder = yl_player
        else:
            yl_player = yl_total = None

        rows.append({
            "year": year,
            "career_record": cr_total,
            "career_record_holder": name_map.get(cr_player, cr_player),
            "active_leader": name_map.get(al_player, al_player) if al_player else None,
            "active_leader_total": al_total,
            "yearly_leader": name_map.get(yl_player, yl_player) if yl_player else None,
            "yearly_total": yl_total,
            "single_season_record": ss_record if ss_record > 0 else None,
            "single_season_record_holder": (
                name_map.get(ss_record_holder, ss_record_holder) if ss_record_holder else None
            ),
        })

    return {
        "stat": code,
        "label": label,
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "lahman_version": lahman_version,
        "rows": rows,
    }


def write_json(path: Path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as f:
        json.dump(data, f, separators=(",", ":"))
    print(f"    Wrote {path.relative_to(ROOT)}")


# ── Entry point ─────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(
        description="Build baseball record stature data files from a Lahman .bak file."
    )
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--all",  action="store_true", help="Compute all stats")
    group.add_argument("--stat", metavar="CODE",      help="Compute one stat by code")
    group.add_argument("--list", action="store_true", help="List available stat codes and exit")
    parser.add_argument(
        "--source", metavar="PATH",
        help="Path to Lahman .bak file (default: auto-detect from sources/)",
    )
    args = parser.parse_args()

    if args.list:
        for s in STATS:
            print(f"  {s['code']:<8}  {s['label']}")
        return

    lahman_version = load_config()
    bak_path = find_bak(args.source)
    print(f"Source: {bak_path}")

    check_docker()

    try:
        print("Starting SQL Server container...")
        start_container()
        sqlcmd = find_sqlcmd()
        wait_for_sqlserver(sqlcmd)
        restore_database(sqlcmd, bak_path)

        print("Loading tables...")
        name_map, batting, pitching, appearances = load_tables(sqlcmd)
        active_by_year = active_players_by_year(appearances)

        if args.stat:
            stat_def = next((s for s in STATS if s["code"] == args.stat), None)
            if stat_def is None:
                sys.exit(
                    f"ERROR: Unknown stat code '{args.stat}'. "
                    "Use --list to see available codes."
                )
            result = compute_stat(stat_def, name_map, batting, pitching, active_by_year, lahman_version)
            if result:
                write_json(DATA_DIR / f"{args.stat}.json", result)

        elif args.all:
            index = []
            for stat_def in STATS:
                result = compute_stat(
                    stat_def, name_map, batting, pitching, active_by_year, lahman_version
                )
                if result:
                    write_json(DATA_DIR / f"{stat_def['code']}.json", result)
                    index.append({"code": stat_def["code"], "label": stat_def["label"]})
            write_json(DATA_DIR / "_index.json", index)
            print(f"\nDone. {len(index)} stats written to data/")

    finally:
        print("Stopping SQL Server container...")
        stop_container()


if __name__ == "__main__":
    main()
