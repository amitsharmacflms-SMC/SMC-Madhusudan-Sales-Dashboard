/* dashboard.js — Option B: LCP Optimized + INP Safe
   - Starts data fetch immediately (Preload)
   - Renders first 50 rows synchronously (LCP fix)
   - Chunks the rest (INP fix)
*/

/* =============================
   1. PRE-FETCHING (LCP OPTIMIZATION)
   Start fetching immediately, do not wait for DOMContentLoaded
============================= */
let fullDataPromise = null;
const initialView = "product"; // Default view

function startFetch(view) {
  return fetch(`/get_data/${view}`)
    .then(res => {
      if (!res.ok) throw new Error(res.status);
      return res.json();
    })
    .then(data => {
      if (!Array.isArray(data)) return [];
      // Mirror keys for fast lookup immediately
      return data.map(r => {
        const o = {};
        Object.keys(r).forEach(k => { o[k] = r[k]; o[k.toUpperCase()] = r[k]; });
        return o;
      });
    })
    .catch(err => {
      console.error("Fetch error:", err);
      return [];
    });
}

// Ignite the fetch immediately
fullDataPromise = startFetch(initialView);

/* =============================
   CONFIG / GLOBALS
============================= */
let filtersVisible = true;
let currentView = initialView;
let fullData = [];
let originalKeys = [];
let currentGroupedData = [];
let currentSelectedFilters = {};
let keyboardInteractionOngoing = false; 

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
function escapeHtml(s){
  return String(s == null ? "" : s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}
function getVal(row, key){
  if(!row || !key) return "";
  if(row[key] !== undefined) return row[key];
  const u = key.toUpperCase();
  return row[u] !== undefined ? row[u] : "";
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

// Revealed as soon as the first batch is rendered
function revealTableContainer(){
  const skeleton = document.getElementById("tableSkeleton");
  const container = document.getElementById("tableContainer");
  const loader = document.getElementById("loader");
  if(skeleton) skeleton.classList.add("hidden");
  if(container) container.classList.remove("hidden");
  if(loader){ loader.style.visibility = "hidden"; loader.textContent = ""; }
}

/* =============================
   IDLE + DEBOUNCE
============================= */
function runIdle(fn){
  if(typeof requestIdleCallback === "function"){
    requestIdleCallback(fn, { timeout: 400 });
  } else {
    setTimeout(fn, 50);
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
   KEYBOARD GUARD
============================= */
(function attachKeyboardGuard(){
  let lastKeyAt = 0;
  document.addEventListener("keydown", () => {
    keyboardInteractionOngoing = true;
    lastKeyAt = Date.now();
  }, { capture: true });
  document.addEventListener("keyup", () => {
    setTimeout(() => {
      if (Date.now() - lastKeyAt >= 200) keyboardInteractionOngoing = false;
    }, 250);
  }, { capture: true });
  document.addEventListener("focusin", (e) => {
    if(e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) {
      const type = e.target.type;
      if(type !== "checkbox" && type !== "radio" && type !== "button" && type !== "submit"){
        keyboardInteractionOngoing = true;
      }
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
  // Instead of calling loadData() which fetches again, we wait for the promise started at top of file
  initializeData(); 
});

async function initializeData() {
  showOverlay(80);
  try {
    fullData = await fullDataPromise; // Await the pre-fetched data
    originalKeys = Object.keys(fullData[0] || {});

    // Compute defaults
    const avgCols = originalKeys.filter(k => norm(k).startsWith("AVG_Q"));
    const orderedAvg = monthOrder.filter(m => avgCols.some(a => norm(a) === norm(m)));
    const last5Avg = orderedAvg.slice(-5);

    buildFilters();
    
    // Immediate initial render for LCP
    setTimeout(() => applySavedOrDefaults(last5Avg), 0);
    
  } catch(e) {
    console.error("Init error", e);
    const loader = document.getElementById("loader");
    if(loader) loader.textContent = "Error loading data";
  } finally {
    hideOverlay();
  }
}

/* =============================
   BIND UI
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
    // For view switch, we must fetch new data
    fullDataPromise = startFetch(currentView);
    initializeData();
  });

  const exportBtn = document.getElementById("exportBtn");
  if(exportBtn) exportBtn.addEventListener("click", ()=> { showOverlay(120); runIdle(exportExcel); });
  
  // Theme toggle omitted for brevity, assume same as before
}

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
   FILTER UI
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

    const strong = document.createElement("strong");
    strong.style.display = "block";
    strong.style.textTransform = "uppercase";
    strong.style.marginBottom = "6px";
    strong.style.textAlign = "center";
    strong.textContent = title;
    box.appendChild(strong);

    const allLabel = document.createElement("label");
    allLabel.style.display = "block";
    allLabel.style.marginBottom = "6px";
    const allCb = document.createElement("input");
    allCb.type = "checkbox";
    allCb.dataset.all = title;
    allLabel.appendChild(allCb);
    allLabel.appendChild(document.createTextNode(" All"));
    box.appendChild(allLabel);

    const options = document.createElement("div");
    options.className = "options";
    options.style.maxHeight = "220px";
    options.style.overflow = "auto";
    options.style.paddingRight = "6px";

    (values || []).forEach(v => {
      const lab = document.createElement("label");
      lab.style.display = "block";
      lab.style.margin = "3px 0";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.name = title;
      cb.value = v;
      if(checkAll) cb.checked = true;
      lab.appendChild(cb);
      lab.appendChild(document.createTextNode(" " + v));
      options.appendChild(lab);
    });

    box.appendChild(options);
    filters.appendChild(box);
  }

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

  filters.querySelectorAll("input[data-all]").forEach(cb => {
    cb.addEventListener("change", e => {
      const title = e.target.dataset.all;
      const checked = e.target.checked;
      Array.from(filters.querySelectorAll("input")).forEach(i => { if(i.name === title) i.checked = checked; });
      runIdle(() => applyFilters());
    });
  });

  filters.addEventListener("keydown", e => { e.stopPropagation(); }, { capture: true });

  filters.addEventListener("change", debounce(() => {
    if(!keyboardInteractionOngoing){
      runIdle(() => applyFilters());
    } else {
      setTimeout(() => runIdle(() => applyFilters()), 300);
    }
  }, 150));
}

/* =============================
   SAVED FILTERS / DEFAULTS
============================= */
function applySavedOrDefaults(last5Avg){
  const filters = document.getElementById("filtersContainer");
  if(!filters) return;

  const saved = JSON.parse(localStorage.getItem("savedFilters") || "{}");
  const hasSaved = Object.values(saved).some(v => Array.isArray(v) && v.length);

  function getInputs(name){ return Array.from(filters.querySelectorAll("input")).filter(i => i.name === name); }

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

    const saveObj = {};
    filters.querySelectorAll(".filter-box strong").forEach(h => {
      const t = h.textContent.trim();
      saveObj[t] = getInputs(t).filter(i => i.checked).map(i => i.value);
    });
    localStorage.setItem("savedFilters", JSON.stringify(saveObj));
    localStorage.setItem("default_avg_cols", JSON.stringify(last5Avg));
  }

  // Apply immediately (false = don't save again)
  applyFilters(false); 
}

/* =============================
   APPLY FILTERS
============================= */
function applyFilters(save = true){
  if(keyboardInteractionOngoing){
    setTimeout(() => { if(!keyboardInteractionOngoing) runIdle(() => applyFilters(save)); }, 220);
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
        const checkedInputs = Array.from(filters.querySelectorAll("input")).filter(i => i.name === t && i.checked);
        selected[t] = checkedInputs.map(i => i.value);
      });

      if(Array.isArray(selected["TOTAL"])) selected["TOTAL"] = selected["TOTAL"].map(v => norm(v));
      if(save) localStorage.setItem("savedFilters", JSON.stringify(selected));
      currentSelectedFilters = selected;

      const cascade = currentView === "product"
        ? ["STATE","MANAGER_NAME","DISTRICT","PRODUCT","PARTY_NAME"]
        : ["STATE","MANAGER_NAME","DISTRICT","PRODUCT","SKU","PARTY_NAME"];

      let filtered = fullData.slice();
      cascade.forEach(f => {
        const rawSel = selected[f];
        if(rawSel && rawSel.length > 0) {
          const selSet = new Set(rawSel.map(s => norm(s)));
          filtered = filtered.filter(r => selSet.has(norm(getVal(r, f))));
        }
      });

      cascade.forEach(f => {
        const box = Array.from(filters.querySelectorAll(".filter-box")).find(b => b.querySelector("strong")?.textContent.trim() === f);
        if(!box) return;
        const valid = new Set();
        for(let i=0; i<filtered.length; i++) valid.add(String(getVal(filtered[i], f)));
        const inputs = Array.from(box.querySelectorAll("input")).filter(i => i.name === f);
        inputs.forEach(cb => {
          const label = cb.parentElement;
          if(valid.has(cb.value) || cb.checked){
            cb.disabled = false; if(label) label.style.opacity = "1";
          } else {
            cb.disabled = true; if(label) label.style.opacity = "0.45";
          }
        });
      });

      // IMPORTANT: Do NOT use runIdle here for the table render call directly.
      // We will handle the "Top 50" sync render inside renderTable.
      renderTable(filtered, selected);

    } finally {
      hideOverlay();
    }
  });
}

/* =============================
   RENDERING (LCP OPTIMIZED)
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

  let colsToShow = [...showCols, ...monthCols].filter((v,i,a)=> a.indexOf(v) === i);
  const compareSel = selected["COMPARISON"] || [];
  const hasComparison = compareSel.length === 2;
  if(hasComparison && !colsToShow.includes("COMPARISON")) colsToShow.push("COMPARISON");

  // Header
  tHead.innerHTML = `<tr>${colsToShow.map(c => `<th style="white-space:nowrap;padding:8px 10px;font-weight:800;border-bottom:1px solid #ddd">${escapeHtml(c)}</th>`).join("")}</tr>`;

  // Grouping
  const grouped = (function group(){
    const map = new Map();
    dataToRender.forEach(r => {
      let key = "";
      for(const k of showCols) key += String(getVal(r,k)) + "|";
      if(!map.has(key)){
        const obj = {};
        showCols.forEach(k => obj[k] = getVal(r,k));
        monthCols.forEach(m => obj[m] = Number(getVal(r,m)) || 0);
        map.set(key, obj);
      } else {
        const obj = map.get(key);
        monthCols.forEach(m => obj[m] = obj[m] + (Number(getVal(r,m)) || 0);
      }
    });
    return Array.from(map.values());
  })();
  currentGroupedData = grouped;

  // Build rows array
  const rowsArr = [];
  if (Array.isArray(totalCols) && totalCols.length) {
    const groups = {};
    grouped.forEach(r => {
      const key = totalCols.map(tc => String(getVal(r, tc))).join("|");
      if(!groups[key]) groups[key] = [];
      groups[key].push(r);
    });
    Object.keys(groups).forEach(gk => {
      const groupRows = groups[gk];
      groupRows.forEach(r => rowsArr.push(buildRowHtml(r, colsToShow, monthCols, compareSel)));
      if(groupRows.length >= 2){
        const subtotal = {};
        monthCols.forEach(m => subtotal[m] = groupRows.reduce((s, rr) => s + (Number(rr[m]) || 0), 0));
        rowsArr.push(buildSubtotalRow(subtotal, colsToShow, monthCols, compareSel));
      }
    });
  } else {
    grouped.forEach(r => rowsArr.push(buildRowHtml(r, colsToShow, monthCols, compareSel)));
  }

  tBody.innerHTML = "";
  
  /* LCP FIX: Render first 50 rows SYNCHRONOUSLY immediately */
  const LCP_BATCH_SIZE = 50;
  const firstBatch = rowsArr.slice(0, LCP_BATCH_SIZE);
  const remaining = rowsArr.slice(LCP_BATCH_SIZE);

  if(firstBatch.length > 0) {
    tBody.innerHTML = firstBatch.join(""); // Paint immediately
  }

  // Reveal container NOW (improves LCP perception)
  table.classList.remove("hidden");
  revealTableContainer();

  // Render the rest in background (improves INP/TBT)
  if(remaining.length > 0) {
    renderRowsChunked(remaining, tBody, 200);
  }

  // Footer (Async)
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
            if(monthCols.includes(colsToShow[j])){ prev = totals[colsToShow[j]]; break; }
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
    addSorting(colsToShow);
  });
}

function renderRowsChunked(rowsArr, container, chunkSize = 150){
  if(!Array.isArray(rowsArr) || !container) return;
  let i = 0;
  function appendChunk(){
    const frag = document.createDocumentFragment();
    const end = Math.min(i + chunkSize, rowsArr.length);
    for(; i < end; i++){
      const temp = document.createElement('tbody');
      temp.innerHTML = rowsArr[i];
      if(temp.firstElementChild) frag.appendChild(temp.firstElementChild);
    }
    container.appendChild(frag);
    if(i < rowsArr.length){
      if(typeof requestIdleCallback === "function") requestIdleCallback(appendChunk, { timeout: 300 });
      else setTimeout(appendChunk, 16);
    }
  }
  appendChunk(); // Start first background chunk
}

/* Build row HTML helper (Same as before) */
function buildRowHtml(row, colsToShow, monthCols, compareSel){
  const hasComparison = (compareSel || []).length === 2;
  let html = "<tr>";
  colsToShow.forEach((c, idx) => {
    if(c === "COMPARISON"){
      if(hasComparison){
        const a = Number(row[compareSel[0]]) || 0;
        const b = Number(row[compareSel[1]]) || 0;
        const diff = b - a; const cls = diff > 0 ? "bg-pos" : (diff < 0 ? "bg-neg" : "");
        html += `<td class="numeric ${cls}" style="padding:6px 8px;font-weight:700">${diff}</td>`;
      } else html += `<td style="padding:6px 8px"></td>`;
      return;
    }
    const isMonth = monthCols.some(m => m.toUpperCase() === String(c).toUpperCase());
    if(isMonth){
      const val = Number(row[c]) || 0;
      let prevVal = null;
      for(let j = idx - 1; j >= 0; j--){
        const prevCol = colsToShow[j];
        if(monthCols.some(m => m.toUpperCase() === String(prevCol).toUpperCase())){ prevVal = Number(row[prevCol]) || 0; break; }
      }
      const cls = (prevVal !== null) ? (val > prevVal ? "bg-pos" : (val < prevVal ? "bg-neg" : "")) : "";
      html += `<td class="numeric ${cls}" style="padding:6px 8px;font-weight:700">${val}</td>`;
      return;
    }
    html += `<td style="padding:6px 8px">${escapeHtml(getVal(row, c))}</td>`;
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
      let prev = null;
      for(let j = idx-1; j>=0; j--){
        if(monthCols.includes(colsToShow[j])){ prev = sub[colsToShow[j]] || 0; break; }
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
      if(keyboardInteractionOngoing) return; 
      const asc = !th.classList.contains("asc");
      ths.forEach(h => h.classList.remove("asc","desc"));
      th.classList.add(asc ? "asc":"desc");
      const sorted = [...currentGroupedData].sort((a,b)=>{
        const A = Number(a[col]) || 0; const B = Number(b[col]) || 0;
        return asc ? A - B : B - A;
      });
      renderTable(sorted, currentSelectedFilters);
    });
  });
}

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
  fullDataPromise = startFetch(currentView);
  initializeData();
  const btn = document.getElementById("toggleFiltersBtn");
  if(btn) btn.textContent = "Hide Filters";
  const wrapper = document.getElementById("filtersWrapper");
  if(wrapper) wrapper.style.maxHeight = "600px";
  filtersVisible = true;
}

async function exportExcel(){
  try {
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
  } finally { hideOverlay(); }
}
hideOverlay();