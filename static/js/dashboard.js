/* dashboard.js — Option A: Chunked rendering + INP-safe + production-ready
   Replace static/js/dashboard.js with this file.
   Assumptions (IDs present in HTML):
     - #tableSkeleton, #tableContainer, #dataTable (with thead#tableHead tbody#tableBody tfoot#tableFoot)
     - #filtersWrapper, #filtersContainer
     - #overlayLoader, #loader
     - buttons: backBtn, clearBtn, toggleFiltersBtn, toggleViewBtn, themeToggle, exportBtn
*/

/* =============================
   CONFIG / GLOBALS
============================= */
let filtersVisible = true;
let currentView = "product";
let fullData = [];
let originalKeys = [];
let currentGroupedData = [];
let currentSelectedFilters = {};
let keyboardInteractionOngoing = false; // guard to prevent keyboard-triggered heavy ops

const baseTextCols = ["STATE","MANAGER_NAME","DISTRICT","PRODUCT","SKU","PARTY_NAME"];
const monthOrder = [
  "APR-23","MAY-23","JUN-23","AVG_Q1_2023-24","JUL-23","AUG-23","SEP-23","AVG_Q2_2023-24",
  "OCT-23","NOV-23","DEC-23","AVG_Q3_2023-24","JAN-24","FEB-24","MAR-24","AVG_Q4_2023-24","AVG_YEAR_2023-24",
  "APR-24","MAY-24","JUN-24","AVG_Q1_2024-25","JUL-24","AUG-24","SEP-24","AVG_Q2_2024-25",
  "OCT-24","NOV-24","DEC-24","AVG_Q3_2024-25","JAN-25","FEB-25","MAR-25","AVG_Q4_2024-25","AVG_YEAR_2024-25",
  "APR-25","MAY-25","JUN-25","AVG_Q1_2025-26","JUL-25","AUG-25","SEP-25","AVG_Q2_2025-26","OCT-25","AVG_Q3_2025-26","AVG_YEAR_2025-26"
];

/* =============================
   UTIL: safe helpers
============================= */
const norm = s => String(s||"").toUpperCase().trim();
const normalizeKeySimple = k => String(k||"").toUpperCase().replace(/[-_\s]/g, "");

// safe CSS.escape with fallback
function cssEscape(s){
  try { return CSS.escape(String(s)); } catch(e) { return String(s).replace(/["'\\]/g, "\\$&"); }
}

function escapeHtml(s){
  return String(s == null ? "" : s)
    .replace(/&/g,"&amp;")
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;");
}

// robust getter (tries exact, upper, lower, normalized)
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
  if(el) el.classList.add("hidden");
}

function revealTableContainer(){
  const skeleton = document.getElementById("tableSkeleton");
  const container = document.getElementById("tableContainer");
  const loader = document.getElementById("loader");
  if(skeleton) skeleton.classList.add("hidden");
  if(container) container.classList.remove("hidden");
  if(loader){ loader.style.visibility = "hidden"; loader.textContent = ""; }
  const p = document.getElementById("instantPaint");
  if(p && p.parentNode) p.parentNode.removeChild(p);
}

/* =============================
   IDLE + DEBOUNCE
============================= */
function runIdle(fn){
  if(typeof requestIdleCallback === "function"){
    requestIdleCallback(fn, { timeout: 400 });
  } else {
    setTimeout(fn, 200);
  }
}
function debounce(fn, wait = 250){
  let t;
  return function(...a){
    clearTimeout(t);
    t = setTimeout(()=> fn.apply(this, a), wait);
  };
}

/* =============================
   KEYBOARD GUARD (improves INP)
   - keyboardInteractionOngoing prevents heavy work during user keyboard activity
============================= */
(function attachKeyboardGuard(){
  let lastKeyAt = 0;
  document.addEventListener("keydown", () => {
    keyboardInteractionOngoing = true;
    lastKeyAt = Date.now();
  }, { capture: true });

  document.addEventListener("keyup", () => {
    // set a small delay before turning off the flag to allow quick key sequences
    const ts = Date.now();
    setTimeout(() => {
      if (Date.now() - lastKeyAt >= 200) keyboardInteractionOngoing = false;
    }, 250);
  }, { capture: true });

  // also monitor focusin/focusout for inputs (some accessibility interactions)
  document.addEventListener("focusin", (e) => {
    if(e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) {
      // don't immediately block (we still want text typing to be allowed)
      keyboardInteractionOngoing = true;
    }
  }, true);
  document.addEventListener("focusout", (e) => {
    keyboardInteractionOngoing = false;
  }, true);
})();

/* =============================
   INIT
============================= */
document.addEventListener("DOMContentLoaded", () => {
  bindUI();
  loadData(currentView);
});

/* =============================
   BIND UI (buttons)
============================= */
function bindUI(){
  const backBtn = document.getElementById("backBtn");
  if(backBtn) backBtn.addEventListener("click", ()=> window.history.back());

  const clearBtn = document.getElementById("clearBtn");
  if(clearBtn) clearBtn.addEventListener("click", () => runIdle(clearFilters));

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
  if(exportBtn) exportBtn.addEventListener("click", ()=> { showOverlay(120); runIdle(exportExcel); });
}

/* =============================
   FILTER PANEL TOGGLE
============================= */
function toggleFilters(){
  const wrapper = document.getElementById("filtersWrapper");
  const btn = document.getElementById("toggleFiltersBtn");
  if(!wrapper || !btn) return;
  if(filtersVisible){
    wrapper.style.maxHeight = "0px";
    btn.textContent = "Show Filters";
  } else {
    wrapper.style.maxHeight = "600px";
    btn.textContent = "Hide Filters";
  }
  filtersVisible = !filtersVisible;
}

/* =============================
   BUILD FILTER UI (robust + compact)
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

  function makeBox(title, values = [], checkAll = false){
    const box = document.createElement("div");
    box.className = "filter-box";
    box.style.background = colors[ci++ % colors.length];
    box.style.border = "1px solid #000";
    box.style.borderRadius = "8px";
    box.style.padding = "6px";
    box.style.minWidth = "120px";
    box.style.maxWidth = "140px";

    // build safe options
    const safeVals = (values || []).map(v => String(v));
    const optionsHtml = safeVals.map(v => `<label style="display:block;margin:3px 0;"><input type="checkbox" name="${escapeAttr(title)}" value="${escapeHtml(v)}" ${checkAll ? "checked" : ""}> ${escapeHtml(v)}</label>`).join("");

    box.innerHTML = `<strong style="display:block;text-transform:uppercase;margin-bottom:6px;text-align:center">${escapeHtml(title)}</strong>
      <label style="display:block;margin-bottom:6px;"><input type="checkbox" data-all="${escapeAttr(title)}"> All</label>
      <div class="options" style="max-height:220px;overflow:auto;padding-right:6px">${optionsHtml}</div>`;

    filters.appendChild(box);
  }

  // find actual month columns (preserve order)
  const keysUpper = originalKeys.map(k => (k||"").toUpperCase());
  const actualMonthCols = monthOrder.filter(m => keysUpper.includes(m.toUpperCase()));
  const comparisonCols = actualMonthCols.slice();

  order.forEach(o => {
    if(o === "SHOW COLUMNS") makeBox(o, textCols, true);
    else if(o === "MONTH / YEAR") makeBox(o, actualMonthCols, false);
    else if(o === "COMPARISON") makeBox(o, comparisonCols, false);
    else if(o === "TOTAL") makeBox(o, textCols, false);
    else if(textCols.includes(o)){
      const set = new Set();
      fullData.forEach(r => {
        const v = getVal(r, o);
        if(v !== undefined && v !== null && String(v).trim() !== "") set.add(String(v));
      });
      makeBox(o, Array.from(set).sort(), true);
    }
  });

  // attach 'All' toggles
  filters.querySelectorAll("input[data-all]").forEach(cb => {
    cb.addEventListener("change", e => {
      const title = e.target.dataset.all;
      const checked = e.target.checked;
      try {
        filters.querySelectorAll(`input[name="${cssEscape(title)}"]`).forEach(i => i.checked = checked);
      } catch(err){
        filters.querySelectorAll("input").forEach(i => { if(i.name === title) i.checked = checked; });
      }
      // schedule apply on idle
      runIdle(() => applyFilters());
    });
  });

  // prevent heavy operations firing during rapid key presses (keyboard guard)
  filters.addEventListener("keydown", e => {
    // stop heavy bubbling; keep default to allow native focus navigation
    e.stopPropagation();
  }, { capture: true });

  // on any change: debounce + schedule on idle
  filters.addEventListener("change", debounce(() => {
    if(keyboardInteractionOngoing){
      // if keyboard currently used, postpone; apply when idle after short delay
      setTimeout(()=> {
        if(!keyboardInteractionOngoing) runIdle(() => applyFilters());
      }, 220);
    } else {
      runIdle(() => applyFilters());
    }
  }, 220));
}

/* handy escapeAttr used above */
function escapeAttr(s){ return (String(s||"")).replace(/"/g, "&quot;"); }

/* =============================
   LOAD DATA FROM SERVER
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

    // produce uppercase mirror keys so getVal works easily
    fullData = data.map(r => {
      const o = {};
      Object.keys(r).forEach(k => { o[k] = r[k]; o[k.toUpperCase()] = r[k]; });
      return o;
    });

    originalKeys = Object.keys(fullData[0] || {});

    // compute default avg cols
    const avgCols = originalKeys.filter(k => norm(k).startsWith("AVG_Q"));
    const orderedAvg = monthOrder.filter(m => avgCols.map(a => normalizeKeySimple(a)).includes(normalizeKeySimple(m)));
    const last5Avg = orderedAvg.slice(-5);

    buildFilters();
    // apply saved/defaults after filters exist
    setTimeout(()=> applySavedOrDefaults(last5Avg), 250);

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

  function getInputs(name){
    try { return Array.from(filters.querySelectorAll(`input[name="${cssEscape(name)}"]`)); }
    catch(e) { return Array.from(filters.querySelectorAll("input")).filter(i => i.name === name); }
  }

  if(hasSaved){
    Object.entries(saved).forEach(([title, vals]) => {
      getInputs(title).forEach(cb => { cb.checked = vals.map(v=>norm(v)).includes(norm(cb.value)); });
    });
  } else {
    filters.querySelectorAll("input[type='checkbox']").forEach(cb => cb.checked = false);

    getInputs("STATE").forEach(cb => cb.checked = true);
    getInputs("PRODUCT").forEach(cb => cb.checked = (norm(cb.value) === "ALL IN CASES"));

    const last5set = last5Avg.map(x => norm(x));
    getInputs("MONTH / YEAR").forEach(cb => { if(last5set.includes(norm(cb.value))) cb.checked = true; });

    getInputs("TOTAL").forEach(cb => { cb.checked = (norm(cb.value) === "STATE"); });
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

  // apply filters but don't save because these are defaults
  applyFilters(false);
}

/* =============================
   APPLY FILTERS + SMART CASCADE
   This will schedule heavy render on idle to keep interactions snappy.
============================= */
function applyFilters(save = true){
  // If keyboard is being used, postpone immediate heavy work
  if(keyboardInteractionOngoing){
    // schedule after a short delay — willIdle will pick it up when user stops
    setTimeout(() => {
      if(!keyboardInteractionOngoing) runIdle(() => applyFilters(save));
    }, 220);
    return;
  }

  showOverlay(80);

  requestAnimationFrame(()=> {
    try {
      const filters = document.getElementById("filtersContainer");
      if(!filters) return;
      const selected = {};
      filters.querySelectorAll(".filter-box strong").forEach(h => {
        const t = h.textContent.trim();
        let checked = [];
        try {
          checked = Array.from(filters.querySelectorAll(`input[name="${cssEscape(t)}"]:checked`)).map(i => i.value);
        } catch(e) {
          checked = Array.from(filters.querySelectorAll("input")).filter(i => i.name === t && i.checked).map(i => i.value);
        }
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

      // smart disable: keep visible but disabled if not valid in cascade
      cascade.forEach(f => {
        const box = Array.from(filters.querySelectorAll(".filter-box")).find(b => b.querySelector("strong")?.textContent.trim() === f);
        if(!box) return;
        const valid = new Set(filtered.map(r => String(getVal(r, f))));
        let inputs = [];
        try {
          inputs = Array.from(box.querySelectorAll(`input[name="${cssEscape(f)}"]`));
        } catch(e) {
          inputs = Array.from(box.querySelectorAll("input")).filter(i => i.name === f);
        }
        inputs.forEach(cb => {
          const label = cb.parentElement;
          if(valid.has(cb.value) || cb.checked){
            cb.disabled = false; if(label) label.style.opacity = "1";
          } else {
            cb.disabled = true; if(label) label.style.opacity = "0.45";
          }
        });
      });

      // schedule heavy render on idle to keep the main thread free while user interacts
      runIdle(() => renderTable(filtered, selected));
    } finally {
      hideOverlay();
    }
  });
}

/* =============================
   RENDERING (chunked)
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
  colsToShow = colsToShow.filter((v,i,a)=> a.indexOf(v) === i);

  // add COMPARISON if selected
  const compareSel = selected["COMPARISON"] || [];
  const hasComparison = compareSel.length === 2;
  if(hasComparison && !colsToShow.includes("COMPARISON")) colsToShow.push("COMPARISON");

  // header
  const headerHtml = `<tr>${colsToShow.map(c => `<th style="white-space:nowrap;padding:8px 10px;font-weight:800;border-bottom:1px solid #ddd">${escapeHtml(c)}</th>`).join("")}</tr>`;
  tHead.innerHTML = headerHtml;

  // grouping & aggregation
  const grouped = (function group(){
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

  // build rows into array of strings
  const rowsArr = [];

  if (Array.isArray(totalCols) && totalCols.length) {
    // group by requested total column(s)
    const groups = {};
    grouped.forEach(r => {
      const keyParts = totalCols.map(tc => String(getVal(r, tc)));
      const key = keyParts.join("|");
      if(!groups[key]) groups[key] = [];
      groups[key].push(r);
    });

    Object.keys(groups).forEach(gk => {
      const groupRows = groups[gk];
      groupRows.forEach(r => rowsArr.push(buildRowHtml(r, colsToShow, monthCols, compareSel)));
      if(groupRows.length >= 2){
        const subtotal = {};
        monthCols.forEach(m => {
          subtotal[m] = groupRows.reduce((s, rr) => s + (Number(rr[m]) || 0), 0);
        });
        rowsArr.push(buildSubtotalRow(subtotal, colsToShow, monthCols, compareSel));
      }
    });
  } else {
    grouped.forEach(r => rowsArr.push(buildRowHtml(r, colsToShow, monthCols, compareSel)));
  }

  // clear current table body, then append rows in chunks
  tBody.innerHTML = "";
  renderRowsChunked(rowsArr, tBody, 200);

  // compute grand total (from original filtered dataset)
  runIdle(() => {
    if(dataToRender.length){
      const totals = {};
      monthCols.forEach(m => totals[m] = dataToRender.reduce((s,r)=> s + (Number(getVal(r, m))||0), 0));
      const totalCells = colsToShow.map((c, idx) => {
        if(c === "COMPARISON" && hasComparison){
          const a = totals[compareSel[0]] || 0;
          const b = totals[compareSel[1]] || 0;
          const diff = b - a; const cls = diff > 0 ? "bg-pos" : (diff < 0 ? "bg-neg" : "");
          return `<td class="numeric ${cls}" style="font-weight:800;padding:8px 10px;border-top:2px solid #222">${diff}</td>`;
        }
        if(monthCols.includes(c)){
          const val = totals[c] || 0;
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
        if(idx === 0) return `<td style="font-weight:800;padding:8px 10px;border-top:2px solid #222">GRAND TOTAL</td>`;
        return `<td style="padding:8px 10px;border-top:2px solid #222"></td>`;
      }).join("");
      tFoot.innerHTML = `<tr class="grandtotal-row">${totalCells}</tr>`;
    } else {
      tFoot.innerHTML = "";
    }
  });

  // finalize
  table.classList.remove("hidden");
  addSorting(colsToShow);
  revealTableContainer();
}

/* Append rows array into container in small chunks to avoid long frames */
function renderRowsChunked(rowsArr, container, chunkSize = 150){
  if(!Array.isArray(rowsArr) || !container) return;
  let i = 0;
  function appendChunk(){
    const frag = document.createDocumentFragment();
    const end = Math.min(i + chunkSize, rowsArr.length);
    for(; i < end; i++){
      // create a temporary wrapper to parse string to node
      const temp = document.createElement('tbody');
      temp.innerHTML = rowsArr[i];
      const rowNode = temp.firstElementChild; // <tr>
      if(rowNode) frag.appendChild(rowNode);
    }
    container.appendChild(frag);

    if(i < rowsArr.length){
      if(typeof requestIdleCallback === "function"){
        requestIdleCallback(appendChunk, { timeout: 300 });
      } else {
        setTimeout(appendChunk, 16);
      }
    }
  }
  appendChunk();
}

/* Build a row as HTML string */
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

    if(monthCols.map(m=>m.toUpperCase()).includes(String(c).toUpperCase())){
      const val = Number(row[c]) || 0;
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

    const txt = row[c] ?? row[String(c).toUpperCase()] ?? "";
    html += `<td style="padding:6px 8px">${escapeHtml(txt)}</td>`;
  });
  html += "</tr>";
  return html;
}

/* Subtotal row as HTML string */
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
   SORTING (lightweight)
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
    th.addEventListener("click", () => {
      if(keyboardInteractionOngoing) return; // don't run sort while keyboard in use
      const asc = !th.classList.contains("asc");
      ths.forEach(h => h.classList.remove("asc","desc"));
      th.classList.add(asc ? "asc":"desc");
      const sorted = [...currentGroupedData].sort((a,b)=>{
        const A = Number(a[col]) || 0; const B = Number(b[col]) || 0;
        return asc ? A - B : B - A;
      });
      runIdle(()=> renderTable(sorted, currentSelectedFilters));
    });
  });
}

/* =============================
   EXPORT (ExcelJS + FileSaver expected on page)
============================= */
async function exportExcel(){
  try {
    const table = document.getElementById("dataTable");
    if(!table) { alert("No table to export"); return; }

    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet("Dashboard");
    // gather visible rows and header
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
    alert("Export failed: " + (err && err.message ? err.message : err));
  } finally {
    hideOverlay();
  }
}

/* =============================
   CLEAR FILTERS
============================= */
function clearFilters(){
  localStorage.removeItem("savedFilters");
  localStorage.removeItem("default_avg_cols");

  const filters = document.getElementById("filtersContainer");
  if(filters){
    filters.querySelectorAll("input[type='checkbox']").forEach(cb => {
      cb.checked = false;
      cb.disabled = false;
      if(cb.parentElement) cb.parentElement.style.opacity = "1";
    });
  }

  loadData(currentView);

  const btn = document.getElementById("toggleFiltersBtn");
  if(btn) btn.textContent = "Hide Filters";
  const wrapper = document.getElementById("filtersWrapper");
  if(wrapper) wrapper.style.maxHeight = "600px";
  filtersVisible = true;
}

/* =============================
   FINISH / DEBUG
============================= */
if(window.matchMedia && window.matchMedia("(max-width:768px)").matches){
  console.log("mobile optimizations active");
}
hideOverlay();

window._dashboard_internal = {
  reload: ()=> loadData(currentView),
  getState: ()=> ({ view: currentView, filters: currentSelectedFilters })
};
