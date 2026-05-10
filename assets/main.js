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

const DATASET_LINE = 0;   // career record line
const DATASET_BAR  = 1;   // active leader bars
const DEFAULT_LINE_COLOR = "rgba(20,20,20,0.75)";

// ── Minor year-tick plugin ─────────────────────────────────────────────────
// Draws small 4px ticks at every non-decade year on the x-axis
const yearTicksPlugin = {
  id: "yearTicks",
  afterDraw(chart) {
    const xAxis = chart.scales.x;
    if (!xAxis) return;
    const ctx = chart.ctx;
    const y0 = xAxis.bottom;
    ctx.save();
    ctx.strokeStyle = "rgba(26,26,24,0.3)";
    ctx.lineWidth = 0.75;
    const minYr = Math.ceil(xAxis.min);
    const maxYr = Math.floor(xAxis.max);
    for (let yr = minYr; yr <= maxYr; yr++) {
      if (yr % 10 === 0) continue;
      const x = xAxis.getPixelForValue(yr);
      ctx.beginPath();
      ctx.moveTo(x, y0);
      ctx.lineTo(x, y0 + 4);
      ctx.stroke();
    }
    ctx.restore();
  },
};

// Bar opacity (hex alpha suffix appended to color)
const ALPHA_SELECTED = "ff";   // selected player
const ALPHA_DIMMED   = "1a";   // non-selected when something is selected
const ALPHA_HOLDER   = "dd";   // active leader is also the all-time holder
const ALPHA_OTHER    = "80";   // active leader, not the holder
const TRANSPARENT    = "rgba(0,0,0,0)";

// ── Chart.js global defaults ───────────────────────────────────────────────
Chart.defaults.font.family = "Georgia, 'Times New Roman', serif";
Chart.defaults.font.size = 12;
Chart.defaults.color = "#1a1a18";

// ── Chart instance + interaction state ────────────────────────────────────
let charts = {};
let currentRows = null;
let currentGap = null;
let currentPersonColorIndex = null;
let selectedPlayer = null;
let tooltipEl = null;         // resolved once on DOMContentLoaded
let hoverTooltipEl = null;    // small hover tooltip at active-leader bar top
let hoverTooltipEl2 = null;   // small hover tooltip at career-record line
let leaderLineEl = null;      // thin connector from tooltip 2 to the line
let lockedIndex = null;       // non-null when user has clicked to pin the tooltip

function buildBarBg(rows, personColorIndex, highlightedPlayer) {
  return rows.map(r => {
    if (!r.active_leader) return TRANSPARENT;
    const color = colorFor(personColorIndex[r.active_leader]);
    if (highlightedPlayer) {
      return color + (r.active_leader === highlightedPlayer ? ALPHA_SELECTED : ALPHA_DIMMED);
    }
    return color + (r.active_leader === r.career_record_holder ? ALPHA_HOLDER : ALPHA_OTHER);
  });
}

function highlightPlayer(player) {
  if (!charts.area || !currentRows) return;
  charts.area.data.datasets[DATASET_BAR].backgroundColor =
    buildBarBg(currentRows, currentPersonColorIndex, player);
  charts.area.update("none");
}

function selectPlayer(name) {
  selectedPlayer = selectedPlayer === name ? null : name;
  document.querySelectorAll("#summary-table tbody tr").forEach(tr => {
    tr.classList.toggle("selected", tr.dataset.player === selectedPlayer);
  });
  highlightPlayer(selectedPlayer);
}

// ── Metrics computation ────────────────────────────────────────────────────
function computeMetrics(rows) {
  const gap = rows.map(r =>
    (r.career_record != null && r.active_leader_total != null)
      ? r.career_record - r.active_leader_total
      : null
  );

  // only counted when active leader is extending the record
  const climb = rows.map((r, i) => {
    if (i === 0) return 0;
    if (r.career_record_holder !== r.active_leader) return 0;
    if (r.career_record == null) return 0;
    const prev = rows[i - 1].career_record;
    if (prev == null) return 0;
    return r.career_record - prev;
  });

  const holderOrder = [];
  const holderFirstYear = {};
  const holderLastYear = {};
  const holderStretches = {};
  let prevHolder = null;
  for (const r of rows) {
    const h = r.career_record_holder;
    if (!h) { prevHolder = null; continue; }
    if (!holderFirstYear[h]) {
      holderOrder.push(h);
      holderFirstYear[h] = r.year;
    }
    holderLastYear[h] = r.year;
    if (h !== prevHolder) {
      if (!holderStretches[h]) holderStretches[h] = [];
      holderStretches[h].push([r.year, r.year]);
    } else {
      holderStretches[h][holderStretches[h].length - 1][1] = r.year;
    }
    prevHolder = h;
  }

  const holderStats = {};
  for (const h of holderOrder) {
    holderStats[h] = {
      name: h,
      firstYear: holderFirstYear[h],
      lastYear: holderLastYear[h],
      yearsLabel: (holderStretches[h] || [])
        .map(([s, e]) => s === e ? String(s) : `${s}–${e}`)
        .join("<br>"),
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

    if (
      r.active_leader === h &&
      r.active_leader_total != null &&
      r.career_record != null &&
      r.active_leader_total === r.career_record
    ) {
      hs.activeYears++;
    }
  });

  // normalized for cross-stat comparability
  for (const hs of Object.values(holderStats)) {
    hs.stature = hs.peakRecord > 0
      ? (hs.cumulativeGap + hs.cumulativeClimb) / hs.peakRecord
      : 0;
  }

  return { gap, holderOrder, holderStats };
}

// ── External tooltip ───────────────────────────────────────────────────────
function formatTooltipLines(r, gap) {
  const lines = [];
  if (r.career_record_holder)
    lines.push(`Record: ${r.career_record?.toLocaleString()} — ${r.career_record_holder}`);
  if (r.active_leader)
    lines.push(`Active: ${r.active_leader_total?.toLocaleString()} — ${r.active_leader}`);
  if (gap != null) lines.push(`Gap: ${gap.toLocaleString()}`);
  return lines;
}

function hideHoverTooltips() {
  if (hoverTooltipEl)  hoverTooltipEl.style.opacity  = "0";
  if (hoverTooltipEl2) hoverTooltipEl2.style.opacity = "0";
  if (leaderLineEl)    leaderLineEl.style.opacity    = "0";
}

function externalTooltip({ chart, tooltip }) {
  if (!tooltipEl) return;

  const hoverI   = tooltip.dataPoints?.[0]?.dataIndex;
  const hovering = lockedIndex === null && tooltip.opacity !== 0
                   && hoverI != null && currentRows != null;

  if (!hovering) {
    hideHoverTooltips();
  } else {
    const hr   = currentRows[hoverI];
    const rect = chart.canvas.getBoundingClientRect();
    const barEl  = chart.getDatasetMeta(DATASET_BAR).data[hoverI];
    const lineEl = chart.getDatasetMeta(DATASET_LINE).data[hoverI];
    const barX   = rect.left + (barEl?.x  ?? tooltip.caretX);
    const barTop = rect.top  + (barEl?.y  ?? tooltip.caretY);
    const lineY  = rect.top  + (lineEl?.y ?? tooltip.caretY);
    const lineX  = rect.left + (lineEl?.x ?? tooltip.caretX);
    const gap2   = (hr.career_record != null && hr.active_leader_total != null)
      ? hr.career_record - hr.active_leader_total : null;

    // Tooltip 1 — active leader at bar top
    let top1 = null;
    if (hoverTooltipEl && hr.active_leader && hr.active_leader_total != null) {
      hoverTooltipEl.innerHTML =
        `<div>${hr.active_leader}</div>` +
        `<div>${hr.active_leader_total.toLocaleString()}</div>`;
      const tt1W = hoverTooltipEl.offsetWidth;
      const tt1H = hoverTooltipEl.offsetHeight;
      top1 = clamp(barTop - tt1H - 8, 4, window.innerHeight - tt1H - 4);
      hoverTooltipEl.style.left    = clamp(barX  - tt1W / 2, 4, window.innerWidth  - tt1W - 4) + "px";
      hoverTooltipEl.style.top     = top1 + "px";
      hoverTooltipEl.style.opacity = "1";
    } else if (hoverTooltipEl) {
      hoverTooltipEl.style.opacity = "0";
    }

    // Tooltip 2 — career leader at line, only when gap > 0 (different person)
    if (hoverTooltipEl2 && gap2 != null && gap2 > 0 && hr.career_record_holder) {
      hoverTooltipEl2.innerHTML =
        `<div>${hr.career_record_holder}</div>` +
        `<div>${hr.career_record.toLocaleString()}</div>`;
      const tt2W = hoverTooltipEl2.offsetWidth;
      const tt2H = hoverTooltipEl2.offsetHeight;
      let top2 = clamp(lineY - tt2H - 8, 4, window.innerHeight - tt2H - 4);

      // Push up if it overlaps tooltip 1
      if (top1 !== null && top2 + tt2H + 4 > top1) {
        top2 = Math.max(4, top1 - tt2H - 4);
      }

      hoverTooltipEl2.style.left    = clamp(lineX - tt2W / 2, 4, window.innerWidth  - tt2W - 4) + "px";
      hoverTooltipEl2.style.top     = top2 + "px";
      hoverTooltipEl2.style.opacity = "1";

      // Thin connector from tooltip 2 arrow tip down to the line
      if (leaderLineEl) {
        const connTop    = top2 + tt2H + 5; // 5px = arrow height
        const connHeight = lineY - connTop;
        if (connHeight > 0) {
          leaderLineEl.style.left    = (lineX - 0.5) + "px";
          leaderLineEl.style.top     = connTop + "px";
          leaderLineEl.style.height  = connHeight + "px";
          leaderLineEl.style.opacity = "1";
        } else {
          leaderLineEl.style.opacity = "0";
        }
      }
    } else {
      if (hoverTooltipEl2) hoverTooltipEl2.style.opacity = "0";
      if (leaderLineEl)    leaderLineEl.style.opacity    = "0";
    }
  }

  // Locked tooltip — stays pinned to clicked year
  if (lockedIndex === null) {
    tooltipEl.style.opacity = "0";
    return;
  }
  const i = lockedIndex;

  if (!currentRows) return;
  const r = currentRows[i];

  tooltipEl.innerHTML =
    `<div class="tt-year">${r.year}</div>` +
    formatTooltipLines(r, currentGap?.[i])
      .map(l => `<div class="tt-row">${l}</div>`)
      .join("");

  const rect   = chart.canvas.getBoundingClientRect();
  const barEl  = chart.getDatasetMeta(DATASET_BAR).data[i];
  const lineEl = chart.getDatasetMeta(DATASET_LINE).data[i];

  const barX  = rect.left + (barEl?.x  ?? tooltip.caretX);
  const lineY = rect.top  + (lineEl?.y ?? tooltip.caretY);

  const ttW = tooltipEl.offsetWidth;
  const ttH = tooltipEl.offsetHeight;
  const GAP = 10;

  // anchor on whichever side has more horizontal room
  const toLeft = (window.innerWidth - barX - GAP) < (barX - GAP);
  tooltipEl.classList.toggle("tt-left",  toLeft);
  tooltipEl.classList.toggle("tt-right", !toLeft);

  const left = clamp(toLeft ? barX - ttW - GAP : barX + GAP, 4, window.innerWidth  - ttW - 4);
  const top  = clamp(lineY - ttH / 2,                        4, window.innerHeight - ttH - 4);

  tooltipEl.style.left    = left + "px";
  tooltipEl.style.top     = top  + "px";
  tooltipEl.style.opacity = "1";
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// ── Chart 1: Combo — line (career record) + color-coded bars (active leader) ─

// Order is load-bearing: record holders are assigned palette slots first
// so colors stay stable for them across stats; active-only leaders fill in after.
function buildPersonColorIndex(rows) {
  const index = {};
  let next = 0;
  for (const r of rows) {
    if (r.career_record_holder && !(r.career_record_holder in index))
      index[r.career_record_holder] = next++;
  }
  for (const r of rows) {
    if (r.active_leader && !(r.active_leader in index))
      index[r.active_leader] = next++;
  }
  return index;
}

function holderSegmentColor(ctx) {
  const i = ctx.p0DataIndex;
  if (!currentRows || i < 0 || i >= currentRows.length) return DEFAULT_LINE_COLOR;
  const holder = currentRows[i].career_record_holder;
  if (!holder || !currentPersonColorIndex || !(holder in currentPersonColorIndex))
    return DEFAULT_LINE_COLOR;
  return colorFor(currentPersonColorIndex[holder]);
}

function lineDatasetConfig(rows) {
  return {
    type: "line",
    label: "Career Record",
    data: rows.map(r => ({ x: r.year, y: r.career_record })),
    fill: false,
    borderColor: DEFAULT_LINE_COLOR,
    borderWidth: 2.5,
    pointRadius: 0,
    stepped: true,
    order: 2,
    segment: { borderColor: holderSegmentColor },
  };
}

function barDatasetConfig(rows, barBg) {
  return {
    type: "bar",
    label: "Active Leader",
    data: rows.map(r => ({ x: r.year, y: r.active_leader_total })),
    backgroundColor: barBg,
    borderWidth: 0,
    barPercentage: 0.9,
    order: 1,
  };
}

function handleAreaChartClick(evt, _elements, chart) {
  const points = chart.getElementsAtEventForMode(evt, "index", { intersect: false }, true);
  if (!points.length || !currentRows) return;
  const i = points[0].index;

  if (lockedIndex === i) {
    lockedIndex = null;
    tooltipEl.classList.remove("tt-locked");
  } else {
    lockedIndex = i;
    tooltipEl.classList.add("tt-locked");
  }

  const holder = currentRows[i]?.active_leader;
  if (holder) selectPlayer(holder);
}

function areaChartOptions() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    onClick: handleAreaChartClick,
    plugins: {
      legend: { display: false },
      tooltip: { enabled: false, external: externalTooltip },
    },
    scales: {
      x: {
        type: "linear",
        min: 1870,
        offset: false,
        grid: {
          offset: false,
          color: "rgba(0,0,0,0.06)",
        },
        ticks: {
          stepSize: 10,
          font: { size: 11 },
          callback: v => v.toString(),
        },
      },
      y: {
        grid: { color: "rgba(0,0,0,0.06)" },
        ticks: {
          font: { family: "'Courier New', monospace", size: 11 },
          callback: v => v.toLocaleString(),
        },
      },
    },
  };
}

function updateAreaChart(chart, rows, barBg) {
  chart.data.datasets[DATASET_LINE].data = rows.map(r => ({ x: r.year, y: r.career_record }));
  chart.data.datasets[DATASET_BAR].data = rows.map(r => ({ x: r.year, y: r.active_leader_total }));
  chart.data.datasets[DATASET_BAR].backgroundColor = barBg;
  chart.update();
}

function drawAreaChart(rows) {
  currentRows = rows;
  currentPersonColorIndex = buildPersonColorIndex(rows);
  const barBg = buildBarBg(rows, currentPersonColorIndex, null);

  if (charts.area) {
    updateAreaChart(charts.area, rows, barBg);
    return;
  }

  const ctx = document.getElementById("chart-area").getContext("2d");
  charts.area = new Chart(ctx, {
    type: "bar",
    data: {
      datasets: [lineDatasetConfig(rows), barDatasetConfig(rows, barBg)],
    },
    options: areaChartOptions(),
    plugins: [yearTicksPlugin],
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
    tr.dataset.player = row.name;
    tr.innerHTML = `
      <td>${row.name}</td>
      <td class="num">${row.yearsLabel}</td>
      <td class="num">${row.peakRecord.toLocaleString()}</td>
      <td class="num">${Math.round(row.cumulativeGap).toLocaleString()}</td>
      <td class="num">${Math.round(row.cumulativeClimb).toLocaleString()}</td>
      <td class="num">${row.activeYears}</td>
      <td class="num"><strong>${row.stature.toFixed(2)}</strong></td>
    `;
    if (row.name === selectedPlayer) tr.classList.add("selected");
    tbody.appendChild(tr);
  }
}

function initTableSorting() {
  const thByKey = new Map(
    [...document.querySelectorAll("#summary-table th[data-key]")]
      .map(th => [th.dataset.key, th])
  );

  thByKey.forEach((th, key) => {
    th.addEventListener("click", () => {
      if (sortKey === key) {
        sortDir = -sortDir;
        th.className = sortDir === 1 ? "sort-asc" : "sort-desc";
      } else {
        if (sortKey) thByKey.get(sortKey).className = "";
        sortKey = key;
        sortDir = 1;
        th.className = "sort-asc";
      }
      renderTable();
    });
  });

  document.querySelectorAll("#summary-table .th-info").forEach(el => {
    el.addEventListener("click", e => e.stopPropagation());
  });

  document.querySelector("#summary-table tbody").addEventListener("click", e => {
    const tr = e.target.closest("tr");
    if (tr?.dataset.player) selectPlayer(tr.dataset.player);
  });
}

// ── Main render ────────────────────────────────────────────────────────────
function renderAll(data) {
  document.getElementById("chart-title").textContent = data.label;
  selectedPlayer = null;
  lockedIndex = null;
  if (tooltipEl) {
    tooltipEl.style.opacity = "0";
    tooltipEl.classList.remove("tt-locked");
  }
  hideHoverTooltips();
  const rows = data.rows;
  const { gap, holderOrder, holderStats } = computeMetrics(rows);
  currentGap = gap;

  drawAreaChart(rows);

  tableData = holderOrder.map(h => holderStats[h]);
  sortKey = null;
  sortDir = 1;
  document.querySelectorAll("#summary-table th[data-key]").forEach(th => {
    th.classList.remove("sort-asc", "sort-desc");
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

function setActiveButton(code) {
  document.querySelectorAll(".stat-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.code === code);
  });
}

async function loadStat(code) {
  setActiveButton(code);
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
  tooltipEl       = document.getElementById("chart-tooltip");
  hoverTooltipEl  = document.getElementById("chart-hover-tooltip");
  hoverTooltipEl2 = document.getElementById("chart-hover-tooltip-2");
  leaderLineEl    = document.getElementById("chart-leader-line");
  initTableSorting();

  const index = await loadIndex();
  if (!index) return;

  const battingRow  = document.getElementById("batting-row");
  const pitchingRow = document.getElementById("pitching-row");

  for (const { code, label, table } of index) {
    const btn = document.createElement("button");
    btn.className = "stat-btn";
    btn.dataset.code = code;
    btn.textContent = label;
    btn.addEventListener("click", () => loadStat(code));
    (table === "pitching" ? pitchingRow : battingRow).appendChild(btn);
  }

  const defaultCode = index[Math.floor(Math.random() * index.length)].code;
  await loadStat(defaultCode);
});
