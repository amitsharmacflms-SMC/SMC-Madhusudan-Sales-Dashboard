/* dashboard.js — full optimized Option C
   Replace static/js/dashboard.js with this file.
   Assumes your HTML provides:
     - <div id="tableSkeleton"> ... </div>
     - <div id="tableContainer" class="hidden"> ... <table id="dataTable"> ... </table> ... </div>
     - filters container: #filtersContainer inside #filtersWrapper
     - loader: #loader and overlay: #overlayLoader
     - Buttons with ids: backBtn, clearBtn, toggleFiltersBtn, toggleViewBtn, themeToggle, exportBtn
*/

/* =============================
   CONFIG / GLOBALS
============================= */
let currentView = "product";
let fullData = [];
let originalKeys = [];
let currentGroupedData = [];
let currentSelectedFilters = {};

const baseTextCols = ["STATE","MANAGER_NAME","DISTRICT","PRODUCT","SKU","PARTY_NAME"];
const monthOrder = [
  "APR-23","MAY-23","JUN-23","AVG_Q1_2023-24","JUL-23","AUG-23","SEP-23","AVG_Q2_2023-24",
  "OCT-23","NOV-23","DEC-23","AVG_Q3_2023-24","JAN-24","FEB-24","MAR-24","AVG_Q4_2023-24","AVG_YEAR_2023-24",
  "APR-24","MAY-24","JUN-24","AVG_Q1_2024-25","JUL-24","AUG-24","SEP-24","AVG_Q2_2024-25",
  "OCT-24","NOV-24","DEC-24","AVG_Q3_2024-25","JAN-25","FEB-25","MAR-25","AVG_Q4_2024-25","AVG_YEAR_2024-25",
  "APR-25","MAY-25","JUN-25","AVG_Q1_2025-26","JUL-25","AUG-25","SEP-25","AVG_Q2_2025-26","OCT-25","AVG_Q3_2025-26","AVG_YEAR_2025-26"
];

// normalize helpers
const norm = s => String(s||"").toUpperCase().trim();
const normalizeKeySimple = k => String(k||"").toUpperCase().replace(/[-_\s]/g, "");

// robust getter (tries exact, upper, lower, and normalized keys)
function getVal(row, key){
  if(!row || !key) return "";
  if(Object.prototype.hasOwnProperty.call(row, key)) return row[key];
  const u = key.toUpperCase(), l = key.toLowerCase();
  if(Object.prototype.hasOwnProperty.call(row, u)) return row[u];
  if(Object.prototype.hasOwnProperty.call(row, l)) return row[l];
  const target = normalizeKeySimple(key);
  const found = Object.keys(row).find(k => normalizeKeySimple(k) === target);
  return found ? row[found] : "";
}

/* =============================
   OVERLAY + SKELETON HELPERS
============================= */
let __overlayTimer = null;
function showOverlay(delay = 150){
  clearTimeout(__overlayTimer);
  __overlayTimer = setTimeout(() => {
    const el = document.getElementById("overlayLoader");
    if(el) el.classList.remove("hidden");
  }, delay);
}
function hideOverlay(){
  clearTimeout(__overlayTimer);
  const el = document.getElementById("overlayLoader");
  if(el) el && el.classList.add("hidden");
}

function revealTableContainer(){
  // called once table is ready
  const skeleton = document.getElementById("tableSkeleton");
  const container = document.getElementById("tableContainer");
  const loader = document.getElementById("loader");
  if(skeleton) skeleton.classList.add("hidden");
  if(container) container.classList.remove("hidden");
  if(loader){ loader.style.visibility = "hidden"; loader.textContent = ""; }
  // remove the paint placeholder if any
  const p = document.getElementById("instantPaint");
  if(p && p.parentNode) p.parentNode.removeChild(p);
}

/* =============================
   UTIL: debounce + idle
============================= */
function debounce(fn, wait=300){
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(()=>fn(...a), wait);
  };
}
function runIdle(fn){
  if("requestIdleCallback" in window) requestIdleCallback(fn, {timeout:300});
  else setTimeout(fn, 200);
}

/* =============================
   INIT UI
============================= */
document.addEventListener("DOMContentLoaded", () => {
  bindUI();
  loadData(currentView);
});

function bindUI(){
  const backBtn = document.getElementById("backBtn");
  if(backBtn) backBtn.addEventListener("click", ()=>window.history.back());

  const clearBtn = document.getElementById("clearBtn");
  if(clearBtn) clearBtn.addEventListener("click", ()=>runIdle(clearFilters));

  const toggleFiltersBtn = document.getElementById("toggleFiltersBtn");
  if(toggleFiltersBtn) toggleFiltersBtn.addEventListener("click", toggleFilters);

  const toggleViewBtn = document.getElementById("toggleViewBtn");
  if(toggleViewBtn) toggleViewBtn.addEventListener("click", ()=>{
    localStorage.removeItem("savedFilters");
    localStorage.removeItem("default_avg_cols");
    currentView = currentView === "product" ? "sku" : "product";
    toggleViewBtn.textContent = currentView === "product" ? "Switch to SKU View" : "Switch to Product View";
    loadData(currentView);
  });

  const themeToggle = document.getElementById("themeToggle");
  if(themeToggle){
    if(localStorage.getItem("theme")==="dark"){
      document.documentElement.classList.add("dark-mode");
      themeToggle.textContent = "Light Mode";
    }
    themeToggle.addEventListener("click", ()=>{
      const html = document.documentElement;
      if(html.classList.contains("dark-mode")){
        html.classList.remove("dark-mode");
        localStorage.setItem("theme","light");
        themeToggle.textContent = "Dark Mode";
      } else {
        html.classList.add("dark-mode");
        localStorage.setItem("theme","dark");
        themeToggle.textContent = "Light Mode";
      }
    });
  }

  const exportBtn = document.getElementById("exportBtn");
  if(exportBtn) exportBtn.addEventListener("click", ()=>{ showOverlay(120); runIdle(exportExcel); });
}

/* =============================
   FILTER PANEL TOGGLE
============================= */
function toggleFilters() {
  const wrapper = document.getElementById("filtersWrapper");
  const btn = document.getElementById("toggleFiltersBtn");
  if (!wrapper || !btn) return;

  if (filtersVisible) {
    wrapper.style.maxHeight = "0px";
    btn.textContent = "Show Filters";
  } else {
    wrapper.style.maxHeight = "500px";   // Fixed value for stable animation
    btn.textContent = "Hide Filters";
  }
  filtersVisible = !filtersVisible;
}

/* =============================
   BUILD FILTER UI (robust)
============================= */
function buildFilters(){
  const filters = document.getElementById("filtersContainer");
  if(!filters) return;
  filters.innerHTML = "";

  const headers = originalKeys.map(k => norm(k));
  const textCols = baseTextCols.filter(c => headers.includes(c));

  const order = currentView === "product"
    ? ["SHOW COLUMNS","MONTH / YEAR","STATE","MANAGER_NAME","DISTRICT","PRODUCT","PARTY_NAME","COMPARISON","TOTAL"]
    : ["SHOW COLUMNS","MONTH / YEAR","STATE","MANAGER_NAME","DISTRICT","PRODUCT","SKU","PARTY_NAME","COMPARISON","TOTAL"];

  const colors = ["#fff7ed","#ecfdf5","#e0f2fe","#fdf2f8","#fef3c7","#e0f2fe","#f3e8ff","#fef2f2","#f3f4f6"];
  let ci = 0;

  function makeBox(title, values, checkAll=false){
    const box = document.createElement("div");
    box.className = "filter-box";
    box.style.background = colors[ci++ % colors.length];
    box.style.border = "1px solid #000"; // thin black outline as requested
    box.style.borderRadius = "8px";
    box.style.padding = "8px";
    box.style.minWidth = "160px";
    box.style.maxWidth = "320px";

    const safeVals = values.map(v => String(v));
    const optionsHtml = safeVals.map(v => `<label style="display:block;margin:3px 0;"><input type="checkbox" name="${title}" value="${v}" ${checkAll?"checked":""}> ${v}</label>`).join("");

    box.innerHTML = `<strong style="display:block;text-transform:uppercase;margin-bottom:6px;text-align:center">${title}</strong>
      <label style="display:block;margin-bottom:6px;"><input type="checkbox" data-all="${title}"> All</label>
      <div class="options" style="max-height:220px;overflow:auto;padding-right:6px;">${optionsHtml}</div>`;

    filters.appendChild(box);
  }

  // month cols present, preserve monthOrder ordering
  const keysUpper = originalKeys.map(k => k.toUpperCase());
  const actualMonthCols = monthOrder.filter(m => keysUpper.includes(m.toUpperCase()));

  // comparison includes avg columns as well (user requested)
  const comparisonCols = actualMonthCols.slice();

  order.forEach(o => {
    if(o === "SHOW COLUMNS") makeBox(o, textCols, true);
    else if(o === "MONTH / YEAR") makeBox(o, actualMonthCols, false);
    else if(o === "COMPARISON") makeBox(o, comparisonCols, false);
    else if(o === "TOTAL") makeBox(o, textCols, false);
    else if(textCols.includes(o)){
      // gather distinct
      const set = new Set();
      fullData.forEach(r => {
        const v = getVal(r, o);
        if(v !== undefined && v !== null && String(v).trim() !== "") set.add(String(v));
      });
      makeBox(o, Array.from(set).sort(), true);
    }
  });

  // data-all listeners
  filters.querySelectorAll("input[data-all]").forEach(cb => {
    cb.addEventListener("change", e => {
      const title = e.target.dataset.all;
      const checked = e.target.checked;
      filters.querySelectorAll(`input[name='${title}']`).forEach(i => i.checked = checked);
      runIdle(applyFilters);
    });
  });

  // on any change, apply (debounced)
  filters.addEventListener("change", debounce(() => runIdle(applyFilters), 250));
}

/* =============================
   LOAD DATA
============================= */
async function loadData(view){
  const loader = document.getElementById("loader");
  if(loader){ loader.style.visibility = "visible"; loader.textContent = "Loading data..."; }
  showOverlay(80);

  try {
    const res = await fetch(`/get_data/${view}`);
    if(!res.ok) throw new Error("Server returned " + res.status);
    const data = await res.json();
    if(!Array.isArray(data)) throw new Error("Data is not an array");

    // normalize: mirror uppercase keys
    fullData = data.map(r => {
      const o = {};
      Object.keys(r).forEach(k => { o[k] = r[k]; o[k.toUpperCase()] = r[k]; });
      return o;
    });

    originalKeys = Object.keys(fullData[0] || {});

    // find avg columns present
    const avgCols = originalKeys.filter(k => norm(k).startsWith("AVG_Q"));
    const orderedAvg = monthOrder.filter(m => avgCols.map(a => normalizeKeySimple(a)).includes(normalizeKeySimple(m)));
    const last5Avg = orderedAvg.slice(-5);

    buildFilters();

    // Apply saved or default after filters rendered
    setTimeout(()=> applySavedOrDefaults(last5Avg), 300);

  } catch(err){
    console.error("loadData error", err);
    if(loader) loader.textContent = "Error loading data";
  } finally {
    hideOverlay();
    if(loader) setTimeout(()=> loader.style.visibility = "hidden", 300);
  }
}

/* =============================
   SAVED FILTERS OR DEFAULTS
============================= */
function applySavedOrDefaults(last5Avg){
  const filters = document.getElementById("filtersContainer");
  if(!filters) return;

  const saved = JSON.parse(localStorage.getItem("savedFilters") || "{}");
  const hasSaved = Object.values(saved).some(v => Array.isArray(v) && v.length);

  function getInputs(name){ return Array.from(filters.querySelectorAll(`input[name='${name}']`)); }

  if(hasSaved){
    Object.entries(saved).forEach(([title, vals]) => {
      getInputs(title).forEach(cb => { cb.checked = vals.map(v=>norm(v)).includes(norm(cb.value)); });
      const allBox = filters.querySelector(`#filtersContainer input[id='all_${title.replace(/ /g,"_")}']`);
      if(allBox){
        const allOpts = getInputs(title);
        allBox.checked = allOpts.length && allOpts.every(o => o.checked);
      }
    });
  } else {
    // reset all
    filters.querySelectorAll("input[type='checkbox']").forEach(cb => cb.checked = false);

    // 1) STATE = ALL
    getInputs("STATE").forEach(cb => cb.checked = true);

    // 2) PRODUCT = only ALL IN CASES
    getInputs("PRODUCT").forEach(cb => cb.checked = (norm(cb.value) === "ALL IN CASES"));

    // 3) MONTH / YEAR = last 5 AVG_Q columns
    const last5set = last5Avg.map(x => norm(x));
    getInputs("MONTH / YEAR").forEach(cb => { if(last5set.includes(norm(cb.value))) cb.checked = true; });

    // 4) TOTAL = STATE
    getInputs("TOTAL").forEach(cb => { cb.checked = (norm(cb.value) === "STATE"); });

    // 5) COMPARISON = none
    getInputs("COMPARISON").forEach(cb => cb.checked = false);

    // save defaults
    const saveObj = {};
    filters.querySelectorAll(".filter-box strong").forEach(h => {
      const t = h.textContent.trim();
      saveObj[t] = getInputs(t).filter(i => i.checked).map(i => i.value);
    });
    localStorage.setItem("savedFilters", JSON.stringify(saveObj));
    localStorage.setItem("default_avg_cols", JSON.stringify(last5Avg));
  }

  applyFilters(false);
}

/* =============================
   APPLY FILTERS + SMART CASCADE
============================= */
function applyFilters(save=true){
  showOverlay(80);
  requestAnimationFrame(()=>{
    try {
      const filters = document.getElementById("filtersContainer");
      if(!filters) return;
      const selected = {};
      filters.querySelectorAll(".filter-box strong").forEach(h => {
        const t = h.textContent.trim();
        const checked = Array.from(filters.querySelectorAll(`input[name='${t}']:checked`)).map(i => i.value);
        selected[t] = checked;
      });

      if(Array.isArray(selected["TOTAL"])) selected["TOTAL"] = selected["TOTAL"].map(v => norm(v));
      if(save) localStorage.setItem("savedFilters", JSON.stringify(selected));
      currentSelectedFilters = selected;

      const cascade = currentView === "product"
        ? ["STATE","MANAGER_NAME","DISTRICT","PRODUCT","PARTY_NAME"]
        : ["STATE","MANAGER_NAME","DISTRICT","PRODUCT","SKU","PARTY_NAME"];

      let filtered = fullData.slice();
      cascade.forEach(f => {
        const sel = (selected[f] || []).map(s => norm(s));
        if(sel.length) filtered = filtered.filter(r => sel.includes(norm(getVal(r, f))));
      });

      // smart disable (keep visible but disabled)
      cascade.forEach(f => {
        const box = Array.from(filters.querySelectorAll(".filter-box")).find(b => b.querySelector("strong")?.textContent.trim() === f);
        if(!box) return;
        const valid = new Set(filtered.map(r => String(getVal(r, f))));
        box.querySelectorAll(`input[name='${f}']`).forEach(cb => {
          const label = cb.parentElement;
          if(valid.has(cb.value) || cb.checked){
            cb.disabled = false; if(label) label.style.opacity = "1";
          } else {
            cb.disabled = true; if(label) label.style.opacity = "0.45";
          }
        });
      });

      renderTable(filtered, selected);
    } finally {
      hideOverlay();
    }
  });
}

/* =============================
   RENDERING (table, rows, groupings)
============================= */
function renderTable(dataToRender, selected){
  const tHead = document.getElementById("tableHead");
  const tBody = document.getElementById("tableBody");
  const tFoot = document.getElementById("tableFoot");
  const table = document.getElementById("dataTable");
  if(!table) return;

  const showCols = (selected["SHOW COLUMNS"] && selected["SHOW COLUMNS"].length) ? selected["SHOW COLUMNS"] : baseTextCols;
  const monthColsAvailable = monthOrder.filter(m => originalKeys.map(k=>k.toUpperCase()).includes(m.toUpperCase()));
  const monthCols = (selected["MONTH / YEAR"] && selected["MONTH / YEAR"].length) ? selected["MONTH / YEAR"] : monthColsAvailable;
  const totalCols = selected["TOTAL"] || [];

  // compose ordered columns
  let colsToShow = [...showCols, ...monthCols];
  // dedupe while preserving order
  colsToShow = colsToShow.filter((v,i,a)=> a.indexOf(v) === i);

  // add COMPARISON if selected
  const compareSel = selected["COMPARISON"] || [];
  const hasComparison = compareSel.length === 2;
  if(hasComparison && !colsToShow.includes("COMPARISON")) colsToShow.push("COMPARISON");

  /* --- header --- */
  const headerHtml = `<tr>${colsToShow.map(c => `<th style="white-space:nowrap;padding:8px 10px;font-weight:800;border-bottom:1px solid #ddd">${c}</th>`).join("")}</tr>`;
  tHead.innerHTML = headerHtml;

  /* --- grouping & aggregation --- */
  const grouped = (function group(){
    // group by showCols values and aggregate monthCols numerically
    const map = new Map();
    dataToRender.forEach(r => {
      const key = showCols.map(k => String(getVal(r,k))).join("|");
      if(!map.has(key)){
        const obj = {};
        showCols.forEach(k => obj[k] = getVal(r,k));
        monthCols.forEach(m => obj[m] = Number(getVal(r,m)) || 0);
        map.set(key, obj);
      } else {
        const obj = map.get(key);
        monthCols.forEach(m => obj[m] = obj[m] + (Number(getVal(r,m)) || 0));
      }
    });
    return Array.from(map.values());
  })();
  currentGroupedData = grouped;

  /* --- rows HTML --- */
  let rowsHtml = "";
  if(Array.isArray(totalCols) && totalCols.length){
    // group by requested total column (we only implement STATE grouping default)
    const groups = {};
    grouped.forEach(r => {
      // build group key robustly
      const key = (selected["TOTAL"].join("|").toUpperCase() === "STATE") ? String(r.STATE || "") : "ALL";
      if(!groups[key]) groups[key] = [];
      groups[key].push(r);
    });

    Object.keys(groups).forEach(gk => {
      groups[gk].forEach(r => rowsHtml += buildRowHtml(r, colsToShow, monthCols, compareSel));
      // subtotal
      const subtotal = {};
      monthCols.forEach(m => subtotal[m] = groups[gk].reduce((s, rr)=> s + (Number(rr[m])||0), 0));
      // Only show subtotal if group has 2 or more rows
if (groups[gk].length >= 2) {
    const subtotal = {};
    monthCols.forEach(m => {
        subtotal[m] = groups[gk].reduce((s, rr) => s + (Number(rr[m]) || 0), 0);
    });
    rowsHtml += buildSubtotalRow(subtotal, colsToShow, monthCols, compareSel);
}


  } else {
    grouped.forEach(r => rowsHtml += buildRowHtml(r, colsToShow, monthCols, compareSel));
  }

  tBody.innerHTML = rowsHtml;

  /* --- grand total footer --- */
  if(grouped.length){
    const totals = {};
    monthCols.forEach(m => totals[m] = grouped.reduce((s,r)=> s + (Number(r[m])||0), 0));
    const totalCells = colsToShow.map((c, idx) => {
      if(c === "COMPARISON" && hasComparison){
        const a = totals[compareSel[0]] || 0;
        const b = totals[compareSel[1]] || 0;
        const diff = b - a; const cls = diff > 0 ? "bg-pos" : (diff < 0 ? "bg-neg" : "");
        return `<td class="numeric ${cls}" style="font-weight:800;padding:8px 10px;border-top:2px solid #222">${diff}</td>`;
      }
      if(monthCols.includes(c)){
        const val = totals[c] || 0;
        // determine prev visible month to color-code
        let prev = null;
        for(let j = idx-1; j>=0; j--){
          if(monthCols.includes(colsToShow[j])){
            prev = totals[colsToShow[j]];
            break;
          }
        }
        const cls = prev !== null ? (val > prev ? "bg-pos" : (val < prev ? "bg-neg" : "")) : "";
        return `<td class="numeric ${cls}" style="font-weight:800;padding:8px 10px;border-top:2px solid #222">${val}</td>`;
      }
      if(idx === 0) return `<td style="font-weight:800;padding:8px 10px;border-top:2px solid #222">TOTAL</td>`;
      return `<td style="padding:8px 10px;border-top:2px solid #222"></td>`;
    }).join("");
    tFoot.innerHTML = `<tr class="grandtotal-row">${totalCells}</tr>`;
  } else {
    tFoot.innerHTML = "";
  }

  // mark table visible and reveal skeleton -> table container
  table.classList.remove("hidden");
  // small visual tweaks: reduced row height handled via CSS; ensure compact look
  // attach sorting listeners for numeric columns
  addSorting(colsToShow);

  // reveal container (skeleton -> table)
  revealTableContainer();
}

/* helper: build single row */
function buildRowHtml(row, colsToShow, monthCols, compareSel){
  const hasComparison = (compareSel || []).length === 2;
  let html = "<tr>";
  colsToShow.forEach((c, idx) => {
    if(c === "COMPARISON"){
      if(hasComparison){
        const a = Number(row[compareSel[0]]) || 0;
        const b = Number(row[compareSel[1]]) || 0;
        const diff = b - a;
        const cls = diff > 0 ? "bg-pos" : (diff < 0 ? "bg-neg" : "");
        html += `<td class="numeric ${cls}" style="padding:6px 8px;font-weight:700">${diff}</td>`;
      } else html += `<td style="padding:6px 8px"></td>`;
      return;
    }

    // numeric month columns coloring logic
    if(monthCols.map(m=>m.toUpperCase()).includes(String(c).toUpperCase())){
      const val = Number(row[c]) || 0;
      // find previous visible month index
      let prevVal = null;
      for(let j = idx - 1; j >= 0; j--){
        if(monthCols.map(m=>m.toUpperCase()).includes(String(colsToShow[j]).toUpperCase())){
          prevVal = Number(row[colsToShow[j]]) || 0;
          break;
        }
      }
      const cls = (prevVal !== null) ? (val > prevVal ? "bg-pos" : (val < prevVal ? "bg-neg" : "")) : "";
      html += `<td class="numeric ${cls}" style="padding:6px 8px;font-weight:700">${val}</td>`;
      return;
    }

    // text column
    const txt = row[c] ?? row[String(c).toUpperCase()] ?? "";
    html += `<td style="padding:6px 8px">${txt}</td>`;
  });
  html += "</tr>";
  return html;
}

function buildSubtotalRow(sub, colsToShow, monthCols, compareSel){
  const hasComparison = (compareSel || []).length === 2;
  let html = "<tr class='subtotal-row' style='font-weight:700;background:#fafafa'>";
  colsToShow.forEach((c, idx) => {
    if(c === "COMPARISON"){
      if(hasComparison){
        const a = sub[compareSel[0]] || 0;
        const b = sub[compareSel[1]] || 0;
        const diff = b - a; const cls = diff > 0 ? "bg-pos" : (diff < 0 ? "bg-neg" : "");
        html += `<td class="numeric ${cls}" style="padding:6px 8px">${diff}</td>`;
      } else html += `<td style="padding:6px 8px"></td>`;
      return;
    }
    if(monthCols.includes(c)){
      const val = sub[c] || 0;
      // prev visible
      let prev = null;
      for(let j = idx-1; j>=0; j--){
        if(monthCols.includes(colsToShow[j])){
          prev = sub[colsToShow[j]] || 0;
          break;
        }
      }
      const cls = prev !== null ? (val > prev ? "bg-pos" : (val < prev ? "bg-neg" : "")) : "";
      html += `<td class="numeric ${cls}" style="padding:6px 8px;font-weight:700">${val}</td>`;
      return;
    }
    html += (idx === 0) ? `<td class='subtotal-label' style="padding:6px 8px">Subtotal</td>` : `<td style="padding:6px 8px"></td>`;
  });
  html += "</tr>";
  return html;
}

/* =============================
   SORTING
============================= */
function addSorting(colsToShow){
  const table = document.getElementById("dataTable");
  if(!table) return;
  const ths = table.querySelectorAll("thead th");
  ths.forEach((th, idx) => {
    const col = colsToShow[idx];
    const isNumeric = monthOrder.map(m=>m.toUpperCase()).includes(String(col).toUpperCase()) || col === "COMPARISON";
    if(!isNumeric) return;
    th.style.cursor = "pointer";
    th.addEventListener("click", ()=>{
      const asc = !th.classList.contains("asc");
      // reset classes
      ths.forEach(h => h.classList.remove("asc","desc"));
      th.classList.add(asc ? "asc":"desc");
      const sorted = [...currentGroupedData].sort((a,b)=>{
        const A = Number(a[col]) || 0; const B = Number(b[col]) || 0;
        return asc ? A - B : B - A;
      });
      // re-render using already-grouped data (no re-group)
      renderTable(sorted, currentSelectedFilters);
    });
  });
}

/* =============================
   EXPORT (ExcelJS required to be loaded on page)
============================= */
async function exportExcel(){
  try{
    const table = document.getElementById("dataTable");
    if(!table) { alert("No table to export"); return; }

    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet("Dashboard");
    const rows = Array.from(table.querySelectorAll("tr")).map(tr => Array.from(tr.querySelectorAll("th,td")).map(td => td.innerText.trim()));
    rows.forEach((r, i) => {
      const row = ws.addRow(r);
      if(i === 0){
        row.eachCell(cell => {
          cell.font = { bold:true, color:{ argb:"1E3A8A" } };
          cell.fill = { type:"pattern", pattern:"solid", fgColor:{ argb:"E0E7FF" } };
        });
      } else {
        row.eachCell((cell, idx) => {
          const v = cell.value;
          const n = parseFloat(v);
          if(!isNaN(n)){
            const bg = n > 0 ? "D1FAE5" : n < 0 ? "FEE2E2" : "FFFFFF";
            cell.fill = { type:"pattern", pattern:"solid", fgColor:{ argb:bg } };
            cell.alignment = { horizontal:"center" };
          }
        });
      }
    });
    ws.columns.forEach(c => c.width = 14);
    ws.views = [{ state:"frozen", ySplit:1 }];
    const buf = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    saveAs(blob, `dashboard_export_${new Date().toISOString().slice(0,10)}.xlsx`);
  } catch(err){
    console.error("export error", err);
    alert("Export failed: " + (err.message || err));
  } finally {
    hideOverlay();
  }
}

function clearFilters() {
  localStorage.removeItem("savedFilters");
  localStorage.removeItem("default_avg_cols");

  // RESET UI FILTER CHECKBOXES
  const filters = document.getElementById("filtersContainer");
  if (filters) {
    filters.querySelectorAll("input[type='checkbox']").forEach(cb => {
      cb.checked = false;
      cb.disabled = false;
      cb.parentElement.style.opacity = "1";
    });
  }

  // RELOAD DATA
  loadData(currentView);

  // Reset filter button text
  const btn = document.getElementById("toggleFiltersBtn");
  if (btn) btn.textContent = "Hide Filters";

  // Expand filters
  const wrapper = document.getElementById("filtersWrapper");
  if (wrapper) wrapper.style.maxHeight = "600px";
  filtersVisible = true;
}




/* =============================
   MOBILE OPTIMIZATIONS & FINAL TOUCH
============================= */
if(window.matchMedia && window.matchMedia("(max-width:768px)").matches){
  // small adjustments handled in CSS; keep JS light
  console.log("mobile optimizations active");
}

// ensure overlay hidden at load
hideOverlay();

// expose for debugging if needed
window._dashboard_internal = {
  reload: ()=> loadData(currentView),
  getState: ()=> ({ view: currentView, filters: currentSelectedFilters })
};

