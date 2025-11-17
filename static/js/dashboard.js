/* =========================================================
   SMC ERP SALES DASHBOARD — CLEAN OPTIMIZED REWRITE
   Part 1/2 — Initialization, Filters, Data Loading
========================================================= */

/* ---------- GLOBAL STATE ---------- */
let currentView = "product";
let fullData = [];
let originalKeys = [];
let currentSelected = {};
let groupedData = [];

/* ---------- CONSTANTS ---------- */
const baseTextCols = [
  "STATE", "MANAGER_NAME", "DISTRICT", "PRODUCT", "SKU", "PARTY_NAME"
];

const monthOrder = [
  "APR-23","MAY-23","JUN-23","AVG_Q1_2023-24","JUL-23","AUG-23","SEP-23","AVG_Q2_2023-24",
  "OCT-23","NOV-23","DEC-23","AVG_Q3_2023-24","JAN-24","FEB-24","MAR-24","AVG_Q4_2023-24",
  "AVG_YEAR_2023-24",
  "APR-24","MAY-24","JUN-24","AVG_Q1_2024-25","JUL-24","AUG-24","SEP-24","AVG_Q2_2024-25","OCT-24",
  "NOV-24","DEC-24","AVG_Q3_2024-25","JAN-25","FEB-25","MAR-25","AVG_Q4_2024-25","AVG_YEAR_2024-25",
  "APR-25","MAY-25","JUN-25","AVG_Q1_2025-26","JUL-25","AUG-25","SEP-25","AVG_Q2_2025-26",
  "OCT-25","AVG_Q3_2025-26","AVG_YEAR_2025-26"
];

const norm = x => String(x || "").toUpperCase().trim();

function getVal(row, k) {
  if (row[k] !== undefined) return row[k];
  const up = k.toUpperCase();
  if (row[up] !== undefined) return row[up];
  return "";
}

/* =========================================================
   INIT UI
========================================================= */
document.addEventListener("DOMContentLoaded", () => {
  initUI();
  loadData();
});

function initUI() {
  document.getElementById("backBtn").onclick = () => history.back();
  document.getElementById("clearBtn").onclick = () => {
    localStorage.clear();
    loadData();
  };
  document.getElementById("exportBtn").onclick = exportExcel;
  document.getElementById("toggleFiltersBtn").onclick = toggleFilters;
  document.getElementById("toggleViewBtn").onclick = toggleViewMode;
}

function toggleViewMode() {
  currentView = currentView === "product" ? "sku" : "product";
  document.getElementById("toggleViewBtn").textContent =
    currentView === "product" ? "Switch to SKU View" : "Switch to Product View";
  localStorage.removeItem("savedFilters");
  loadData();
}

/* =========================================================
   SHOW / HIDE FILTERS
========================================================= */
function toggleFilters() {
  const wrap = document.getElementById("filtersWrapper");
  wrap.style.display = wrap.style.display === "none" ? "block" : "none";
}

/* =========================================================
   LOAD DATA FROM BACKEND
========================================================= */
async function loadData() {
  document.getElementById("loader").textContent = "Loading...";

  const res = await fetch(`/get_data/${currentView}`);
  const data = await res.json();

  fullData = data.map(row => {
    const obj = {};
    for (const k in row) {
      obj[k] = row[k];
      obj[k.toUpperCase()] = row[k];
    }
    return obj;
  });

  originalKeys = Object.keys(fullData[0] || {});

  buildFilters();
  applyDefaultFilters();
  applyFilters();
}

/* =========================================================
   FILTER PANEL GENERATION
========================================================= */
function buildFilters() {
  const box = document.getElementById("filtersContainer");
  box.innerHTML = "";

  const monthCols = monthOrder.filter(m => originalKeys.includes(m));

  buildFilterBox("STATE", unique(fullData.map(r => getVal(r, "STATE"))));
  buildFilterBox("MANAGER_NAME", unique(fullData.map(r => getVal(r, "MANAGER_NAME"))));
  buildFilterBox("DISTRICT", unique(fullData.map(r => getVal(r, "DISTRICT"))));
  buildFilterBox("PRODUCT", unique(fullData.map(r => getVal(r, "PRODUCT"))));
  buildFilterBox("MONTH", monthCols);
}

function buildFilterBox(title, values) {
  const container = document.getElementById("filtersContainer");
  const box = document.createElement("div");

  box.className = "filter-box";
  box.style.padding = "6px";
  box.style.minWidth = "160px";

  let html = `<strong>${title}</strong>`;

  values.forEach(v => {
    html += `<label><input type="checkbox" name="${title}" value="${v}"> ${v}</label>`;
  });

  box.innerHTML = html;
  box.onchange = applyFilters;
  container.appendChild(box);
}

function unique(arr) {
  return [...new Set(arr.filter(Boolean))].sort();
}

/* =========================================================
   DEFAULT FILTER SELECTION (State=ALL, Product=ALL IN CASES, last 5 AVG)
========================================================= */
function applyDefaultFilters() {
  // 1) All states
  document.querySelectorAll("input[name='STATE']").forEach(cb => cb.checked = true);

  // 2) Default PRODUCT = ALL IN CASES only
  document.querySelectorAll("input[name='PRODUCT']").forEach(cb => {
    if (norm(cb.value) === "ALL IN CASES") cb.checked = true;
  });

  // 3) Month → last 5 AVG columns
  const monthChecks = [...document.querySelectorAll("input[name='MONTH']")];
  const last5 = monthChecks.filter(cb => norm(cb.value).startsWith("AVG_")).slice(-5);

  last5.forEach(cb => cb.checked = true);
}

/* =========================================================
   APPLY FILTERS + SMART REDUCTION
========================================================= */
function applyFilters() {
  let data = [...fullData];

  function fieldMatch(field) {
    const sel = [...document.querySelectorAll(`input[name='${field}']:checked`)]
      .map(cb => norm(cb.value));

    if (!sel.length) return; // no filter on this field

    data = data.filter(row => sel.includes(norm(getVal(row, field))));
  }

  ["STATE", "MANAGER_NAME", "DISTRICT", "PRODUCT"].forEach(fieldMatch);

  const selMonths = [...document.querySelectorAll("input[name='MONTH']:checked")].map(cb => cb.value);
  currentSelected = { months: selMonths };

  groupedData = groupBy(data, selMonths);
  renderTable(groupedData, selMonths);
}

/* =========================================================
   GROUP BY TEXT COLUMNS + SUM MONTHS
========================================================= */
function groupBy(rows, monthCols) {
  const groups = new Map();

  rows.forEach(r => {
    const key = `${getVal(r, "STATE")}|${getVal(r, "MANAGER_NAME")}|${getVal(r, "DISTRICT")}|${getVal(r, "PRODUCT")}`;

    if (!groups.has(key)) {
      const obj = {
        STATE: getVal(r, "STATE"),
        MANAGER_NAME: getVal(r, "MANAGER_NAME"),
        DISTRICT: getVal(r, "DISTRICT"),
        PRODUCT: getVal(r, "PRODUCT")
      };
      monthCols.forEach(m => obj[m] = Number(getVal(r, m)) || 0);
      groups.set(key, obj);
    } else {
      const obj = groups.get(key);
      monthCols.forEach(m => obj[m] += Number(getVal(r, m)) || 0);
    }
  });

  return [...groups.values()];
}

/* =========================================================
   STOP — PART 1 ENDS HERE
   Reply: “Send dashboard.js Part 2”
========================================================= */


/* ------------------------------------------------------------
   SUBTOTAL ROW
------------------------------------------------------------ */
function subtotalRow(rows, cols) {
  let html = "<tr class='subtotal-row'>";

  cols.forEach(col => {
    if (monthOrder.includes(norm(col))) {
      const total = rows.reduce((s, r) => s + (Number(r[col]) || 0), 0);
      html += `<td class="numeric subtotal-cell">${total}</td>`;
    } else {
      html += `<td class="subtotal-label">Subtotal</td>`;
    }
  });

  html += "</tr>";
  return html;
}

/* ------------------------------------------------------------
   GRAND TOTAL ROW
------------------------------------------------------------ */
function grandTotalRow(rows, cols) {
  let html = "<tr class='grandtotal-row'>";

  cols.forEach(col => {
    if (monthOrder.includes(norm(col))) {
      const total = rows.reduce((s, r) => s + (Number(r[col]) || 0), 0);
      html += `<td class="numeric grandtotal-cell"><b>${total}</b></td>`;
    } else {
      html += `<td class="grandtotal-label"><b>TOTAL</b></td>`;
    }
  });

  html += "</tr>";
  return html;
}

/* ------------------------------------------------------------
   COLOR CODING (AFTER RENDER)
   + GREEN if > previous month
   + RED if < previous month
------------------------------------------------------------ */
function applyColorCoding() {
  const table = document.getElementById("dataTable");
  if (!table) return;

  const rows = table.querySelectorAll("tbody tr");

  rows.forEach(tr => {
    const tds = tr.querySelectorAll("td");
    for (let i = 1; i < tds.length; i++) {
      const prev = Number(tds[i - 1].textContent) || 0;
      const curr = Number(tds[i].textContent) || 0;

      if (!isNaN(prev) && !isNaN(curr)) {
        if (curr > prev) tds[i].classList.add("bg-pos");
        else if (curr < prev) tds[i].classList.add("bg-neg");
      }
    }
  });
}

/* ------------------------------------------------------------
   SORTING (NUMERIC COLUMN SORT)
------------------------------------------------------------ */
function addSorting(cols) {
  const head = document.querySelectorAll("#tableHead th");
  if (!head.length) return;

  head.forEach((th, idx) => {
    const col = cols[idx];

    const isNum = monthOrder.includes(norm(col));
    if (!isNum) return;

    th.style.cursor = "pointer";

    th.onclick = () => {
      const asc = !th.classList.contains("asc");

      head.forEach(h => h.classList.remove("asc", "desc"));
      th.classList.add(asc ? "asc" : "desc");

      currentFiltered.sort((a, b) => {
        const A = Number(a[col]) || 0;
        const B = Number(b[col]) || 0;
        return asc ? A - B : B - A;
      });

      renderTable();
    };
  });
}

/* ------------------------------------------------------------
   EXPORT TO EXCEL
------------------------------------------------------------ */
async function exportExcel() {
  const table = document.getElementById("dataTable");
  if (!table) return alert("No data available.");

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Dashboard");

  const rows = [...table.querySelectorAll("tr")].map(tr =>
    [...tr.querySelectorAll("th,td")].map(td => td.innerText.trim())
  );

  rows.forEach((r, i) => {
    const row = ws.addRow(r);
    row.eachCell((cell, colNum) => {
      cell.border = {
        top: {style:"thin"},
        left: {style:"thin"},
        bottom: {style:"thin"},
        right: {style:"thin"}
      };

      if (i === 0) {
        cell.font = { bold:true };
      }

      const val = cell.value;
      const num = Number(val);

      if (!isNaN(num)) {
        cell.alignment = { horizontal:"center" };
        if (num > 0) cell.fill = { type:"pattern", pattern:"solid", fgColor:{ argb:"D1FAE5" }};
        if (num < 0) cell.fill = { type:"pattern", pattern:"solid", fgColor:{ argb:"FEE2E2" }};
      }

      if (String(val).toUpperCase() === "SUBTOTAL") {
        cell.font = { bold:true };
        cell.fill = { type:"pattern", pattern:"solid", fgColor:{ argb:"E0F2FE" }};
      }
      if (String(val).toUpperCase() === "TOTAL") {
        cell.font = { bold:true };
        cell.fill = { type:"pattern", pattern:"solid", fgColor:{ argb:"F3E8FF" }};
      }
    });
  });

  ws.columns.forEach(col => col.width = 16);

  const buf = await wb.xlsx.writeBuffer();
  saveAs(new Blob([buf]), "dashboard.xlsx");
}

/* ------------------------------------------------------------
   MOBILE PERFORMANCE MODE
------------------------------------------------------------ */
if (window.matchMedia("(max-width:768px)").matches) {
  console.log("Mobile performance mode ON");

  const originalRender = renderTable;
  renderTable = function () {
    requestAnimationFrame(() => originalRender());
  };
}

/* ------------------------------------------------------------
   FINAL TABLE REVEAL (LCP Optimization)
------------------------------------------------------------ */
document.addEventListener("DOMContentLoaded", () => {
  const sk = document.getElementById("tableSkeleton");
  const table = document.getElementById("tableContainer");
  if (sk) sk.classList.add("hidden");
  if (table) table.classList.remove("hidden");
});
