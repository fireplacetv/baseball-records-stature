/* Baseball Record Stature — main.js */
"use strict";

// ── Palette shared across bar charts ──────────────────────────────────────
const PALETTE = [
  "#E69F00", // orange
  "#56B4E9", // sky blue
  "#009E73", // bluish green
  "#0072B2", // blue
  "#D55E00", // vermillion
  "#CC79A7", // reddish purple
  "#F0E442", // yellow
  "#000000", // black
];

function colorFor(index) {
  return PALETTE[index % PALETTE.length];
}

// ── Chart.js global defaults ───────────────────────────────────────────────
Chart.defaults.font.family = "Georgia, 'Times New Roman', serif";
Chart.defaults.font.size = 12;
Chart.defaults.color = "#1a1a18";

// ── Chart instance + interaction state ────────────────────────────────────
let charts = {};
let currentRows = null;
let currentPersonColorIndex = null;
let selectedPlayer = null;

function buildBarBg(rows, personColorIndex, highlightedPlayer) {
  return rows.map(r => {
    if (!r.active_leader) return "rgba(0,0,0,0)";
    const color = colorFor(personColorIndex[r.active_leader]);
    if (highlightedPlayer) {
      return r.active_leader === highlightedPlayer ? color + "ff" : color + "1a";
    }
    return color + (r.active_leader === r.career_record_holder ? "dd" : "80");
  });
}

function highlightPlayer(player) {
  if (!charts.area || !currentRows) return;
  charts.area.data.datasets[1].backgroundColor =
    buildBarBg(currentRows, currentPersonColorIndex, player);
  charts.area.update("none");
}

function selectPlayer(name) {
  selectedPlayer = selectedPlayer === name ? null : name;
  document.querySelectorAll("#summary-table tbody tr").forEach(tr => {
    const cellName = tr.querySelector("td")?.textContent?.trim();
    tr.classList.toggle("selected", cellName === selectedPlayer);
  });
  highlightPlayer(selectedPlayer);
}

// ── Metrics computation ────────────────────────────────────────────────────
function computeMetrics(rows) {
  // Gap per year
  const gap = rows.map(r =>
    (r.career_record != null && r.active_leader_total != null)
      ? r.career_record - r.active_leader_total
      : null
  );

  // Climb per year — only when active leader is extending the record
  const climb = rows.map((r, i) => {
    if (i === 0) return 0;
    if (r.career_record_holder !== r.active_leader) return 0;
    if (r.career_record == null) return 0;
    const prev = rows[i - 1].career_record;
    if (prev == null) return 0;
    return r.career_record - prev;
  });

  // Collect record holders in chronological order
  const holderOrder = [];
  const holderFirstYear = {};
  const holderLastYear = {};
  for (const r of rows) {
    const h = r.career_record_holder;
    if (!h) continue;
    if (!holderFirstYear[h]) {
      holderOrder.push(h);
      holderFirstYear[h] = r.year;
    }
    holderLastYear[h] = r.year;
  }

  // Per-holder aggregates
  const holderStats = {};
  for (const h of holderOrder) {
    holderStats[h] = {
      name: h,
      firstYear: holderFirstYear[h],
      lastYear: holderLastYear[h],
      peakRecord: 0,
      cumulativeGap: 0,
      cumulativeClimb: 0,
      activeYears: 0,
    };
  }

  rows.forEach((r, i) => {
    const h = r.career_record_holder;
    if (!h || !holderStats[h]) return;
    const hs = holderStats[h];

    if (r.career_record != null && r.career_record > hs.peakRecord)
      hs.peakRecord = r.career_record;

    if (gap[i] != null) hs.cumulativeGap += gap[i];
    if (climb[i] != null) hs.cumulativeClimb += climb[i];

    // Active years: holder was playing and held record with gap == 0
    if (
      r.active_leader === h &&
      r.active_leader_total != null &&
      r.career_record != null &&
      r.active_leader_total === r.career_record
    ) {
      hs.activeYears++;
    }
  });

  // Stature score — normalized by holder's peak record for cross-stat comparability
  for (const hs of Object.values(holderStats)) {
    hs.stature = hs.peakRecord > 0
      ? (hs.cumulativeGap + hs.cumulativeClimb) / hs.peakRecord
      : 0;
  }

  return { gap, climb, holderOrder, holderStats };
}

// ── Chart 1: Combo — line (career record) + color-coded bars (active leader) ─
function drawAreaChart(rows) {
  const labels = rows.map(r => r.year);

  const personColorIndex = {};
  let nextIdx = 0;
  for (const r of rows) {
    if (r.career_record_holder && !(r.career_record_holder in personColorIndex))
      personColorIndex[r.career_record_holder] = nextIdx++;
  }
  for (const r of rows) {
    if (r.active_leader && !(r.active_leader in personColorIndex))
      personColorIndex[r.active_leader] = nextIdx++;
  }

  currentRows = rows;
  currentPersonColorIndex = personColorIndex;
  const barBg = buildBarBg(rows, personColorIndex, null);

  if (charts.area) {
    const c = charts.area;
    c.data.labels = labels;
    c.data.datasets[0].data = rows.map(r => r.career_record);
    c.data.datasets[1].data = rows.map(r => r.active_leader_total);
    c.data.datasets[1].backgroundColor = barBg;
    c.options.plugins.tooltip.callbacks.afterBody = items => {
      const i = items[0].dataIndex;
      const r = rows[i];
      const lines = [];
      if (r.career_record_holder)
        lines.push(`Record: ${r.career_record?.toLocaleString()} — ${r.career_record_holder}`);
      if (r.active_leader)
        lines.push(`Active leader: ${r.active_leader_total?.toLocaleString()} — ${r.active_leader}`);
      const g = r.career_record != null && r.active_leader_total != null
        ? r.career_record - r.active_leader_total : null;
      if (g != null) lines.push(`Gap: ${g.toLocaleString()}`);
      return lines;
    };
    c.update();
    return;
  }

  const ctx = document.getElementById("chart-area").getContext("2d");
  charts.area = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          type: "line",
          label: "Career Record",
          data: rows.map(r => r.career_record),
          fill: false,
          borderColor: "rgba(20,20,20,0.75)",
          borderWidth: 2.5,
          pointRadius: 0,
          stepped: true,
          order: 2,
          segment: {
            borderColor: ctx => {
              const i = ctx.p0DataIndex;
              if (!currentRows || i < 0 || i >= currentRows.length) return "rgba(20,20,20,0.75)";
              const holder = currentRows[i].career_record_holder;
              if (!holder || !currentPersonColorIndex || !(holder in currentPersonColorIndex))
                return "rgba(20,20,20,0.75)";
              return colorFor(currentPersonColorIndex[holder]);
            },
          },
        },
        {
          type: "bar",
          label: "Active Leader",
          data: rows.map(r => r.active_leader_total),
          backgroundColor: barBg,
          borderWidth: 0,
          order: 1,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      onClick: (evt, _elements, chart) => {
        const points = chart.getElementsAtEventForMode(evt, "index", { intersect: false }, true);
        if (!points.length || !currentRows) return;
        const holder = currentRows[points[0].index]?.career_record_holder;
        if (holder) selectPlayer(holder);
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: items => `${items[0].label}`,
            label: () => null,
            afterBody: items => {
              const i = items[0].dataIndex;
              const r = rows[i];
              const lines = [];
              if (r.career_record_holder)
                lines.push(`Record: ${r.career_record?.toLocaleString()} — ${r.career_record_holder}`);
              if (r.active_leader)
                lines.push(`Active leader: ${r.active_leader_total?.toLocaleString()} — ${r.active_leader}`);
              const g = r.career_record != null && r.active_leader_total != null
                ? r.career_record - r.active_leader_total : null;
              if (g != null) lines.push(`Gap: ${g.toLocaleString()}`);
              return lines;
            },
          },
        },
      },
      scales: {
        x: {
          grid: { color: "rgba(0,0,0,0.06)" },
          ticks: { maxTicksLimit: 20, font: { size: 11 } },
        },
        y: {
          grid: { color: "rgba(0,0,0,0.06)" },
          ticks: {
            font: { family: "'Courier New', monospace", size: 11 },
            callback: v => v.toLocaleString(),
          },
        },
      },
    },
  });
}


// ── Summary table ──────────────────────────────────────────────────────────
let tableData = [];
let sortKey = null;
let sortDir = 1; // 1 = asc, -1 = desc

function renderTable() {
  const tbody = document.querySelector("#summary-table tbody");
  tbody.innerHTML = "";

  const sorted = [...tableData].sort((a, b) => {
    if (!sortKey) return 0;
    const av = a[sortKey], bv = b[sortKey];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === "string") return sortDir * av.localeCompare(bv);
    return sortDir * (av - bv);
  });

  for (const row of sorted) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${row.name}</td>
      <td class="num">${row.firstYear}–${row.lastYear}</td>
      <td class="num">${row.peakRecord.toLocaleString()}</td>
      <td class="num">${Math.round(row.cumulativeGap).toLocaleString()}</td>
      <td class="num">${Math.round(row.cumulativeClimb).toLocaleString()}</td>
      <td class="num">${row.activeYears}</td>
      <td class="num"><strong>${row.stature.toFixed(2)}</strong></td>
    `;
    if (row.name === selectedPlayer) tr.classList.add("selected");
    tr.addEventListener("click", () => selectPlayer(row.name));
    tbody.appendChild(tr);
  }
}

function initTableSorting() {
  const headers = document.querySelectorAll("#summary-table th[data-key]");
  headers.forEach(th => {
    th.addEventListener("click", () => {
      const key = th.dataset.key;
      if (sortKey === key) {
        sortDir = -sortDir;
        th.className = sortDir === 1 ? "sort-asc" : "sort-desc";
      } else {
        if (sortKey) {
          document.querySelector(`th[data-key="${sortKey}"]`).className = "";
        }
        sortKey = key;
        sortDir = 1;
        th.className = "sort-asc";
      }
      renderTable();
    });
  });
}

// ── Main render ────────────────────────────────────────────────────────────
function renderAll(data) {
  selectedPlayer = null;
  const rows = data.rows;
  const { holderOrder, holderStats } = computeMetrics(rows);

  drawAreaChart(rows);

  tableData = holderOrder.map(h => holderStats[h]);
  sortKey = null;
  sortDir = 1;
  document.querySelectorAll("#summary-table th[data-key]").forEach(th => {
    th.className = "";
  });
  renderTable();
}

// ── Data loading ───────────────────────────────────────────────────────────
function setStatus(msg, isError = false) {
  const el = document.getElementById("status");
  el.textContent = msg;
  el.className = "visible" + (isError ? " error" : "");
}

function clearStatus() {
  const el = document.getElementById("status");
  el.className = "";
}

async function loadStat(code) {
  setStatus(`Loading ${code}…`);
  try {
    const resp = await fetch(`./data/${code}.json`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    clearStatus();
    renderAll(data);
  } catch (e) {
    setStatus(`Failed to load ${code}: ${e.message}. Run the processor to generate data files.`, true);
  }
}

async function loadIndex() {
  try {
    const resp = await fetch("./data/_index.json");
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
  } catch (e) {
    setStatus(`Could not load stat index: ${e.message}. Run: python processor/build.py --all`, true);
    return null;
  }
}

// ── Boot ───────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  initTableSorting();

  const index = await loadIndex();
  if (!index) return;

  const select = document.getElementById("stat-select");
  for (const { code, label } of index) {
    const opt = document.createElement("option");
    opt.value = code;
    opt.textContent = label;
    select.appendChild(opt);
  }

  select.value = index.some(s => s.code === "HR") ? "HR" : index[0].code;

  select.addEventListener("change", () => loadStat(select.value));

  await loadStat(select.value);
});
