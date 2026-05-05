/* Baseball Record Stature — main.js */
"use strict";

// ── Palette shared across bar charts ──────────────────────────────────────
const PALETTE = [
  "#8b1a1a", "#2c5f8a", "#3a7a3a", "#7a5c2a", "#5a2a7a",
  "#2a7a6a", "#7a2a4a", "#4a6a2a", "#2a4a7a", "#7a6a2a",
  "#5a7a2a", "#2a7a4a", "#7a3a2a", "#2a5a7a", "#6a2a7a",
];

function colorFor(index) {
  return PALETTE[index % PALETTE.length];
}

// ── Chart.js global defaults ───────────────────────────────────────────────
Chart.defaults.font.family = "Georgia, 'Times New Roman', serif";
Chart.defaults.font.size = 12;
Chart.defaults.color = "#1a1a18";

// ── Chart instances (destroy on reload) ───────────────────────────────────
let charts = {};

function destroyCharts() {
  for (const c of Object.values(charts)) {
    if (c) c.destroy();
  }
  charts = {};
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

  // Stature score
  for (const hs of Object.values(holderStats)) {
    hs.stature = hs.cumulativeGap + hs.cumulativeClimb;
  }

  return { gap, climb, holderOrder, holderStats };
}

// ── Chart 1: Area chart — career record vs active leader ──────────────────
function drawAreaChart(rows) {
  const ctx = document.getElementById("chart-area").getContext("2d");
  const labels = rows.map(r => r.year);

  charts.area = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Career Record",
          data: rows.map(r => r.career_record),
          fill: true,
          backgroundColor: "rgba(139,26,26,0.15)",
          borderColor: "rgba(139,26,26,0.85)",
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.1,
        },
        {
          label: "Active Leader",
          data: rows.map(r => r.active_leader_total),
          fill: true,
          backgroundColor: "rgba(44,95,138,0.15)",
          borderColor: "rgba(44,95,138,0.85)",
          borderWidth: 1.5,
          pointRadius: 0,
          tension: 0.1,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { position: "top", labels: { boxWidth: 14 } },
        tooltip: {
          callbacks: {
            title: items => `${items[0].label}`,
            afterBody: items => {
              const i = items[0].dataIndex;
              const r = rows[i];
              const lines = [];
              if (r.career_record_holder)
                lines.push(`Record holder: ${r.career_record_holder}`);
              if (r.active_leader)
                lines.push(`Active leader: ${r.active_leader}`);
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

// ── Bar chart helper ───────────────────────────────────────────────────────
function drawBarChart(canvasId, holderOrder, values, title, yLabel) {
  const ctx = document.getElementById(canvasId).getContext("2d");
  const colors = holderOrder.map((_, i) => colorFor(i));

  charts[canvasId] = new Chart(ctx, {
    type: "bar",
    data: {
      labels: holderOrder,
      datasets: [{
        label: yLabel,
        data: values,
        backgroundColor: colors.map(c => c + "cc"),
        borderColor: colors,
        borderWidth: 1,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        title: { display: false },
        tooltip: {
          callbacks: {
            label: item => `${yLabel}: ${Math.round(item.raw).toLocaleString()}`,
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { font: { size: 11 }, maxRotation: 35 },
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
      <td class="num"><strong>${Math.round(row.stature).toLocaleString()}</strong></td>
    `;
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
  destroyCharts();

  const rows = data.rows;
  const { holderOrder, holderStats } = computeMetrics(rows);

  drawAreaChart(rows);

  const gaps    = holderOrder.map(h => holderStats[h].cumulativeGap);
  const climbs  = holderOrder.map(h => holderStats[h].cumulativeClimb);
  const actives = holderOrder.map(h => holderStats[h].activeYears);

  drawBarChart("chart-gap",    holderOrder, gaps,    "Stature of Record (Cumulative Gap)",    "Cumulative Gap");
  drawBarChart("chart-climb",  holderOrder, climbs,  "Climb Over Previous Record",            "Cumulative Climb");
  drawBarChart("chart-active", holderOrder, actives, "Active Years Holding the Record",       "Active Years");

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
