// === DASHBOARD.JS — SEGMENT 1/3 (SAFE, NO BACKSLASHES) ===
// This segment contains only code that avoids regex escapes so it is safe for canvas.

/* =========================
   CONFIG / GLOBALS
========================= */
let currentView = "product";
let fullData = [];
let originalKeys = [];
let currentGroupedData = [];
let currentSelectedFilters = {};

// Text columns in table
const baseTextCols = [
  "STATE","MANAGER_NAME","DISTRICT","PRODUCT","SKU","PARTY_NAME"
];

// Ordered list of all months + AVG columns
const monthOrder = [
  "APR-23","MAY-23","JUN-23","AVG_Q1_2023-24","JUL-23","AUG-23","SEP-23","AVG_Q2_2023-24",
  "OCT-23","NOV-23","DEC-23","AVG_Q3_2023-24","JAN-24","FEB-24","MAR-24","AVG_Q4_2023-24","AVG_YEAR_2023-24",
  "APR-24","MAY-24","JUN-24","AVG_Q1_2024-25","JUL-24","AUG-24","SEP-24","AVG_Q2_2024-25",
  "OCT-24","NOV-24","DEC-24","AVG_Q3_2024-25","JAN-25","FEB-25","MAR-25","AVG_Q4_2024-25","AVG_YEAR_2024-25",
  "APR-25","MAY-25","JUN-25","AVG_Q1_2025-26","JUL-25","AUG-25","SEP-25","AVG_Q2_2025-26","OCT-25","AVG_Q3_2025-26","AVG_YEAR_2025-26"
];

// Normalization helper without regex escapes
const norm = (s) => String(s || "").toUpperCase().trim();

// Safe normalization removing dash, underscore, and space (no backslash needed)
function normalizeKeySimple(k){
  return String(k || "")
    .toUpperCase()
    .replace(/[-_ ]/g, ""); // safe because /[-_ ]/ uses no backslash escapes
}

// Safe key lookup (no regex escapes)
function getVal(row, key){
  if(!row || !key) return "";
  if(row.hasOwnProperty(key)) return row[key];

  const u = key.toUpperCase();
  const l = key.toLowerCase();

  if(row.hasOwnProperty(u)) return row[u];
  if(row.hasOwnProperty(l)) return row[l];

  const target = normalizeKeySimple(key);
  const match = Object.keys(row).find(k => normalizeKeySimple(k) === target);
  return match ? row[match] : "";
}

/* =========================
   OVERLAY HELPERS
========================= */
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

/* =========================
   UTILS
========================= */
function debounce(fn, wait = 300){
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

function runIdle(fn){
  if(window.requestIdleCallback){
    requestIdleCallback(fn, { timeout: 300 });
  } else {
    setTimeout(fn, 200);
  }
}

/* =========================
   INITIALIZATION
========================= */
document.addEventListener("DOMContentLoaded", () => {
  initUI();
  loadData(currentView);
});

function initUI(){
  const backBtn = document.getElementById("backBtn");
  if(backBtn) backBtn.onclick = () => window.history.back();

  const toggleFiltersBtn = document.getElementById("toggleFiltersBtn");
  if(toggleFiltersBtn) toggleFiltersBtn.onclick = toggleFilters;

  const clearBtn = document.getElementById("clearBtn");
  if(clearBtn) clearBtn.onclick = () => runIdle(clearFilters);

  const exportBtn = document.getElementById("exportBtn");
  if(exportBtn) exportBtn.onclick = () => { showOverlay(120); runIdle(exportExcel); };

  const viewBtn = document.getElementById("toggleViewBtn");
  if(viewBtn){
    viewBtn.onclick = () => {
      localStorage.removeItem("savedFilters");
      localStorage.removeItem("default_avg_cols");
      currentView = currentView === "product" ? "sku" : "product";
      viewBtn.textContent = currentView === "product" ? "Switch to SKU View" : "Switch to Product View";
      loadData(currentView);
    };
  }

  const themeBtn = document.getElementById("themeToggle");
  if(themeBtn){
    if(localStorage.getItem("theme") === "dark"){
      document.documentElement.classList.add("dark-mode");
      themeBtn.textContent = "Light Mode";
    }
    themeBtn.onclick = () => {
      const doc = document.documentElement;
      if(doc.classList.contains("dark-mode")){
        doc.classList.remove("dark-mode");
        localStorage.setItem("theme", "light");
        themeBtn.textContent = "Dark Mode";
      } else {
        doc.classList.add("dark-mode");
        localStorage.setItem("theme", "dark");
        themeBtn.textContent = "Light Mode";
      }
    };
  }
}

/* =========================
   FILTER PANEL TOGGLE
========================= */
let filtersVisible = window.innerWidth > 768;

function toggleFilters(){
  const wrapper = document.getElementById("filtersWrapper");
  const btn = document.getElementById("toggleFiltersBtn");
  if(!wrapper || !btn) return;

  if(filtersVisible){
    wrapper.classList.remove("active");
    wrapper.style.maxHeight = "0";
    btn.textContent = "Show Filters";
  } else {
    wrapper.classList.add("active");
    wrapper.style.maxHeight = "600px";
    btn.textContent = "Hide Filters";
  }

  filtersVisible = !filtersVisible;
}

function clearFilters(){
  localStorage.removeItem("savedFilters");
  localStorage.removeItem("default_avg_cols");
  loadData(currentView);
}

// === END OF SEGMENT 1/3 ===

// Reply NEXT to insert Segment 2/3.

// === DASHBOARD.JS — SEGMENT 2/3 (SAFE, NO REGEX-ESCAPES) ===
// This section contains: buildFilters(), loadData(), applyFilters(), smart cascade filtering.

/* =========================
   BUILD FILTER UI
========================= */
function buildFilters(){
  const filters = document.getElementById("filtersContainer");
  if(!filters) return;
  filters.innerHTML = "";

  const headersUpper = originalKeys.map(k => k.toUpperCase());
  const textCols = baseTextCols.filter(c => headersUpper.includes(c));

  // Column order for filter boxes
  const order = currentView === "product"
    ? ["SHOW COLUMNS","MONTH / YEAR","STATE","MANAGER_NAME","DISTRICT","PRODUCT","PARTY_NAME","COMPARISON","TOTAL"]
    : ["SHOW COLUMNS","MONTH / YEAR","STATE","MANAGER_NAME","DISTRICT","PRODUCT","SKU","PARTY_NAME","COMPARISON","TOTAL"];

  const colors = ["#fff7ed","#ecfdf5","#e0f2fe","#fdf2f8","#fef3c7","#e0f2fe","#f3e8ff","#fef2f2","#f3f4f6"];
  let colorIndex = 0;

  function makeBox(title, values, checkAll){
    const box = document.createElement("div");
    box.className = "filter-box";
    box.style.background = colors[colorIndex % colors.length];
    box.style.border = "1px solid black";  // thin black outline
    colorIndex++;

    // Build options
    let html = "";
    for(const v of values){
      const up = String(v).toUpperCase();
      html += `<label><input type="checkbox" name="${title}" value="${v}" ${checkAll?"checked":""}> ${up}</label>`;
    }

    box.innerHTML = `
      <strong>${title}</strong>
      <label><input type="checkbox" data-all="${title}"> All</label>
      <div class="options" style="max-height:220px;overflow:auto;padding-right:6px;">${html}</div>
    `;

    filters.appendChild(box);
  }

  // detect only columns that exist in data
  const actualMonthCols = monthOrder.filter(m => headersUpper.includes(m));
  const comparisonCols = actualMonthCols.filter(c => !c.startsWith("AVG_"));

  const valsCache = {}; // store unique text column values

  for(const key of order){
    if(key === "SHOW COLUMNS"){
      makeBox(key, textCols, true);
      continue;
    }
    if(key === "MONTH / YEAR"){
      makeBox(key, actualMonthCols, false);
      continue;
    }
    if(key === "COMPARISON"){
      makeBox(key, comparisonCols, false);
      continue;
    }
    if(key === "TOTAL"){
      makeBox(key, textCols, false);
      continue;
    }

    if(textCols.includes(key)){
      if(!valsCache[key]){
        const set = new Set();
        for(const row of fullData){
          const v = getVal(row, key);
          if(v !== undefined && v !== null && v !== "") set.add(String(v));
        }
        valsCache[key] = Array.from(set).sort();
      }

      makeBox(key, valsCache[key], true);
    }
  }

  // ALL checkbox logic
  const allCbs = filters.querySelectorAll("input[data-all]");
  allCbs.forEach(cb => {
    cb.onclick = () => {
      const name = cb.getAttribute("data-all");
      const boxes = filters.querySelectorAll(`input[name='${name}']`);
      boxes.forEach(x => x.checked = cb.checked);
      runIdle(() => applyFilters());
    };
  });

  // Any filter change
  filters.onchange = debounce(() => runIdle(() => applyFilters()), 300);
}

/* =========================
   LOAD DATA FROM SERVER
========================= */
async function loadData(view){
  const loader = document.getElementById("loader");
  if(loader) loader.classList.remove("hidden");

  showOverlay(120);

  try{
    const res = await fetch(`/get_data/${view}`);
    if(!res.ok) throw new Error("Server returned " + res.status);

    const data = await res.json();
    if(!Array.isArray(data)) throw new Error("Invalid data format");

    // Normalize all rows
    fullData = data.map(r => {
      const out = {};
      for(const k in r){
        out[k] = r[k];
        out[k.toUpperCase()] = r[k]; // uppercase mirror
      }
      return out;
    });

    originalKeys = Object.keys(fullData[0] || {});

    // Detect AVG_Q* columns (simple normalization)
    const avgCols = originalKeys.filter(k => k.toUpperCase().startsWith("AVG_Q"));
    const mapped = avgCols.map(x => normalizeKeySimple(x));

    const sorted = monthOrder.filter(m => mapped.includes(normalizeKeySimple(m)));
    const last5 = sorted.slice(-5);

    // Build UI filters
    buildFilters();

    // Restore saved filters or apply defaults
    setTimeout(() => {
      const saved = JSON.parse(localStorage.getItem("savedFilters") || "{}");

      if(Object.keys(saved).length > 0){
        applySavedFilters(saved);
      } else {
        applyDefaultFilters(last5);
      }

      applyFilters(false);

    }, 500);

  } catch(err){
    console.error("loadData error", err);
    if(loader) loader.textContent = "Error loading data";
  } finally {
    hideOverlay();
    if(loader) setTimeout(() => loader.classList.add("hidden"), 400);
  }
}

/* =========================
   APPLY SAVED / DEFAULT FILTERS
========================= */
function applySavedFilters(saved){
  for(const title in saved){
    const values = saved[title].map(v => String(v).toUpperCase());
    const boxes = document.querySelectorAll(`#filtersContainer input[name='${title}']`);
    boxes.forEach(cb => {
      const up = String(cb.value).toUpperCase();
      cb.checked = values.includes(up);
    });
  }
}

function applyDefaultFilters(last5Avg){
  // Uncheck everything
  const all = document.querySelectorAll(`#filtersContainer input[type='checkbox']`);
  all.forEach(cb => cb.checked = false);

  // STATE all
  const st = document.querySelectorAll(`input[name='STATE']`);
  st.forEach(cb => cb.checked = true);

  // PRODUCT only ALL IN CASES
  const prod = document.querySelectorAll(`input[name='PRODUCT']`);
  prod.forEach(cb => cb.checked = (String(cb.value).toUpperCase() === "ALL IN CASES"));

  // MONTH/YEAR = last five AVG
  const my = document.querySelectorAll(`input[name='MONTH / YEAR']`);
  const set5 = last5Avg.map(x => x.toUpperCase());
  my.forEach(cb => {
    if(set5.includes(String(cb.value).toUpperCase())) cb.checked = true;
  });

  // TOTAL only STATE
  const tot = document.querySelectorAll(`input[name='TOTAL']`);
  tot.forEach(cb => cb.checked = (String(cb.value).toUpperCase() === "STATE"));

  // COMPARISON none
  const cmp = document.querySelectorAll(`input[name='COMPARISON']`);
  cmp.forEach(cb => cb.checked = false);

  // Save defaults
  const saveObj = {};
  const headers = document.querySelectorAll(`#filtersContainer .filter-box strong`);
  headers.forEach(h => {
    const t = h.textContent.trim();
    const sel = document.querySelectorAll(`input[name='${t}']:checked`);
    saveObj[t] = Array.from(sel).map(x => x.value);
  });

  localStorage.setItem("savedFilters", JSON.stringify(saveObj));
  localStorage.setItem("default_avg_cols", JSON.stringify(last5Avg));
}

/* =========================
   APPLY FILTERS + SMART CASCADE
========================= */
function applyFilters(save = true){
  showOverlay(80);

  const filters = document.getElementById("filtersContainer");
  if(!filters) return;

  const selected = {};
  const groups = filters.querySelectorAll(".filter-box strong");

  groups.forEach(h => {
    const t = h.textContent.trim();
    const cbs = filters.querySelectorAll(`input[name='${t}']:checked`);
    selected[t] = Array.from(cbs).map(x => x.value);
  });

  // Normalize TOTAL uppercase
  if(Array.isArray(selected["TOTAL"])){
    selected["TOTAL"] = selected["TOTAL"].map(v => v.toUpperCase());
  }

  if(save) localStorage.setItem("savedFilters", JSON.stringify(selected));
  currentSelectedFilters = selected;

  const cascade = currentView === "product"
    ? ["STATE","MANAGER_NAME","DISTRICT","PRODUCT","PARTY_NAME"]
    : ["STATE","MANAGER_NAME","DISTRICT","PRODUCT","SKU","PARTY_NAME"];

  let filtered = fullData.slice();

  for(const f of cascade){
    const sel = (selected[f] || []).map(x => x.toUpperCase());
    if(sel.length === 0) continue;
    filtered = filtered.filter(row => sel.includes(String(getVal(row, f)).toUpperCase()));
  }

  // smart cascade: disable irrelevant options
  for(const f of cascade){
    const box = Array.from(filters.querySelectorAll(".filter-box"))
      .find(b => b.querySelector("strong")?.textContent.trim() === f);
    if(!box) continue;

    const validSet = new Set(filtered.map(r => String(getVal(r, f))));

    const cbs = box.querySelectorAll(`input[name='${f}']`);
    cbs.forEach(cb => {
      const val = String(cb.value);
      const label = cb.parentElement;
      if(validSet.has(val) || cb.checked){
        cb.disabled = false;
        if(label) label.style.opacity = "1";
      } else {
        cb.disabled = true;
        if(label) label.style.opacity = "0.4";
      }
    });
  }

  renderTable(filtered, selected);
  hideOverlay();
}

// === END OF SEGMENT 2/3 ===
// Reply NEXT for final Segment 3/3 (renderTable, buildRowHtml, sorting, export).

// === DASHBOARD.JS — SEGMENT 2/3 (FILTERS + LOAD DATA + CASCADE) ===

/* =========================
   BUILD FILTER UI
========================= */
function buildFilters(){
  const filters = document.getElementById("filtersContainer");
  if(!filters) return;
  filters.innerHTML = "";

  const headersUpper = originalKeys.map(k => norm(k));
  const textColsFound = baseTextCols.filter(c => headersUpper.includes(c));

  const order = currentView === "product"
    ? ["SHOW COLUMNS","MONTH / YEAR","STATE","MANAGER_NAME","DISTRICT","PRODUCT","PARTY_NAME","COMPARISON","TOTAL"]
    : ["SHOW COLUMNS","MONTH / YEAR","STATE","MANAGER_NAME","DISTRICT","PRODUCT","SKU","PARTY_NAME","COMPARISON","TOTAL"];

  const colorCycle = ["#fff7ed","#ecfdf5","#e0f2fe","#fdf2f8","#fef3c7","#e0f2fe","#f3e8ff","#fef2f2","#f3f4f6"];
  let ci = 0;

  function makeBox(title, values, checkAll){
    const box = document.createElement("div");
    box.className = "filter-box";
    box.style.background = colorCycle[ci++ % colorCycle.length];
    box.style.border = "1px solid black"; // thin black outline

    const allId = "all_" + title.replace(/ /g, "_");

    let options = "";
    values.forEach(v => {
      const safe = String(v);
      const isChecked = checkAll ? "checked" : "";
      options += "<label><input type='checkbox' name='" + title + "' value='" + safe + "' " + isChecked + "> " + safe + "</label>";
    });

    box.innerHTML = "<strong>" + title + "</strong>" +
      "<label class='all-label'><input type='checkbox' id='" + allId + "' data-all='" + title + "' " + (checkAll?"checked":"") + "> All</label>" +
      "<div class='options' style='max-height:220px;overflow:auto;padding-right:6px'>" + options + "</div>";

    filters.appendChild(box);
  }

  // Detect month columns present
  const keysUpper = originalKeys.map(k => k.toUpperCase());
  const monthColsPresent = monthOrder.filter(m => keysUpper.includes(m.toUpperCase()));

  // Comparison allows only real months (including AVG now)
  const comparisonCols = monthColsPresent;

  order.forEach(section => {
    if(section === "SHOW COLUMNS"){
      makeBox(section, textColsFound, true);
    }
    else if(section === "MONTH / YEAR"){
      makeBox(section, monthColsPresent, false);
    }
    else if(section === "COMPARISON"){
      makeBox(section, comparisonCols, false);
    }
    else if(section === "TOTAL"){
      makeBox(section, textColsFound, false);
    }
    else if(textColsFound.includes(section)){
      const setVals = Array.from(new Set(fullData.map(r => getVal(r, section)))).filter(Boolean).sort();
      makeBox(section, setVals, true);
    }
  });

  // “All” checkboxes
  filters.querySelectorAll("input[data-all]").forEach(cb => {
    cb.addEventListener("change", e => {
      const title = e.target.dataset.all;
      const checked = e.target.checked;
      filters.querySelectorAll("input[name='" + title + "']").forEach(i => i.checked = checked);
      runIdle(applyFilters);
    });
  });

  // Any checkbox triggers filters (debounced)
  filters.addEventListener("change", debounce(() => runIdle(applyFilters), 300));
}

/* =========================
   LOAD DATA FROM SERVER
========================= */
async function loadData(view){
  const loader = document.getElementById("loader");
  if(loader) loader.textContent = "Loading data...";
  showOverlay(100);

  try{
    const res = await fetch("/get_data/" + view);
    if(!res.ok) throw new Error("Server returned " + res.status);
    const data = await res.json();

    fullData = data.map(row => {
      const updated = {};
      Object.keys(row).forEach(k => {
        updated[k] = row[k];
        updated[k.toUpperCase()] = row[k];
      });
      return updated;
    });

    originalKeys = Object.keys(fullData[0] || {});

    const avgCols = originalKeys.filter(k => k.toUpperCase().startsWith("AVG_Q"));

    // Find ordered AVG columns
    const orderedAvg = monthOrder.filter(m => avgCols.map(a => normalizeKeySimple(a)).includes(normalizeKeySimple(m)));
    const lastFiveAvg = orderedAvg.slice(-5);

    buildFilters();

    setTimeout(() => applySavedOrDefaults(lastFiveAvg), 500);

  } catch(err){
    console.error("Load error", err);
    if(loader) loader.textContent = "Error: " + err.message;
  } finally{
    hideOverlay();
    setTimeout(() => loader && loader.classList.add("hidden"), 400);
  }
}

/* =========================
   RESTORE SAVED FILTERS OR APPLY DEFAULT
========================= */
function applySavedOrDefaults(last5Avg){
  const filters = document.getElementById("filtersContainer");
  const saved = JSON.parse(localStorage.getItem("savedFilters") || "{}");

  const hasSaved = Object.values(saved).some(a => Array.isArray(a) && a.length);

  function getInputs(title){
    return Array.from(filters.querySelectorAll("input[name='" + title + "']"));
  }

  if(hasSaved){
    Object.entries(saved).forEach(([title, values]) => {
      getInputs(title).forEach(cb => {
        cb.checked = values.map(norm).includes(norm(cb.value));
      });

      const allBox = document.getElementById("all_" + title.replace(/ /g, "_"));
      if(allBox){
        const allOpt = getInputs(title);
        allBox.checked = allOpt.length && allOpt.every(cb => cb.checked);
      }
    });
  }
  else{
    // DEFAULT FILTER STATE
    document.querySelectorAll("#filtersContainer input[type='checkbox']").forEach(cb => cb.checked = false);

    getInputs("STATE").forEach(cb => cb.checked = true);

    getInputs("PRODUCT").forEach(cb => {
      cb.checked = norm(cb.value) === "ALL IN CASES";
    });

    getInputs("MONTH / YEAR").forEach(cb => {
      if(last5Avg.map(norm).includes(norm(cb.value))) cb.checked = true;
    });

    getInputs("TOTAL").forEach(cb => {
      cb.checked = norm(cb.value) === "STATE";
    });

    getInputs("COMPARISON").forEach(cb => cb.checked = false);

    function fixAll(title){
      const allCb = document.getElementById("all_" + title.replace(/ /g, "_"));
      if(allCb){
        const opts = getInputs(title);
        allCb.checked = opts.length && opts.every(o => o.checked);
      }
    }

    ["STATE","PRODUCT","MONTH / YEAR","TOTAL"].forEach(fixAll);

    const toSave = {};
    document.querySelectorAll("#filtersContainer .filter-box strong").forEach(h => {
      const t = h.textContent.trim();
      toSave[t] = getInputs(t).filter(cb => cb.checked).map(cb => cb.value);
    });

    localStorage.setItem("savedFilters", JSON.stringify(toSave));
    localStorage.setItem("default_avg_cols", JSON.stringify(last5Avg));
  }

  applyFilters(false);
}

/* =========================
   APPLY FILTERS + SMART CASCADE
========================= */
function applyFilters(save = true){
  showOverlay(120);

  requestAnimationFrame(() => {
    try{
      const filters = document.getElementById("filtersContainer");
      const selected = {};

      filters.querySelectorAll(".filter-box strong").forEach(h => {
        const title = h.textContent.trim();
        selected[title] = Array.from(filters.querySelectorAll("input[name='" + title + "']:checked")).map(i => i.value);
      });

      if(Array.isArray(selected["TOTAL"])){
        selected["TOTAL"] = selected["TOTAL"].map(t => norm(t));
      }

      if(save) localStorage.setItem("savedFilters", JSON.stringify(selected));


// === DASHBOARD.JS — SEGMENT 3/3 (RENDER TABLE + COLOR CODING + SORT + EXPORT) ===

/* =========================
   RENDER TABLE
========================= */
function renderTable(dataToRender, selected){
  const tHead = document.getElementById("tableHead");
  const tBody = document.getElementById("tableBody");
  const tFoot = document.getElementById("tableFoot");
  const table = document.getElementById("dataTable");

  if(!table) return;

  const showCols = selected["SHOW COLUMNS"]?.length ? selected["SHOW COLUMNS"] : baseTextCols;
  const monthCols = selected["MONTH / YEAR"]?.length ? selected["MONTH / YEAR"] : [];
  const totalCols = selected["TOTAL"] || [];

  let colsToShow = [...showCols, ...monthCols];

  const hasComparison = (selected["COMPARISON"] || []).length === 2;
  if(hasComparison && !colsToShow.includes("COMPARISON")){
    colsToShow.push("COMPARISON");
  }

  tHead.innerHTML = `<tr>${colsToShow.map(c => `<th>${c}</th>`).join("")}</tr>`;

  let grouped = groupByTextColumns(dataToRender, showCols, monthCols);
  currentGroupedData = grouped;

  let html = "";
  if(totalCols.length){
    html = renderGroupedRows(grouped, colsToShow, monthCols, selected);
  } else {
    grouped.forEach(r => html += buildRowHtml(r, colsToShow, selected));
  }

  tBody.innerHTML = html;
  tFoot.innerHTML = renderGrandTotal(grouped, colsToShow, monthCols, selected);

  table.classList.remove("hidden");
  table.style.visibility = "visible";
}

/* =========================
   GROUPING (STATE subtotals)
========================= */
function groupByTextColumns(data, textCols, monthCols){
  const map = new Map();

  data.forEach(row => {
    const key = textCols.map(k => getVal(row, k)).join("|");
    if(!map.has(key)){
      const obj = {};
      textCols.forEach(k => obj[k] = getVal(row, k));
      monthCols.forEach(m => obj[m] = Number(getVal(row, m)) || 0);
      map.set(key, obj);
    } else {
      const obj = map.get(key);
      monthCols.forEach(m => obj[m] += Number(getVal(row, m)) || 0);
    }
  });

  return Array.from(map.values());
}

/* =========================
   BUILD SINGLE ROW HTML
========================= */
function buildRowHtml(row, colsToShow, selected){
  let html = "<tr>";

  const comp = selected["COMPARISON"] || [];
  const hasComp = comp.length === 2;

  colsToShow.forEach((c, i) => {
    if(c === "COMPARISON"){
      if(hasComp){
        const a = Number(row[comp[0]]) || 0;
        const b = Number(row[comp[1]]) || 0;
        const diff = b - a;
        const cls = diff > 0 ? "bg-pos" : diff < 0 ? "bg-neg" : "";
        html += `<td class="numeric ${cls}">${diff}</td>`;
      } else html += `<td></td>`;
      return;
    }

    if(monthOrder.includes(c.toUpperCase())){
      const val = Number(row[c]) || 0;
      let prevVal = null;
      for(let j=i-1; j>=0; j--){
        if(monthOrder.includes(colsToShow[j].toUpperCase())){
          prevVal = Number(row[colsToShow[j]]) || 0;
          break;
        }
      }
      const cls = prevVal !== null ? (val > prevVal ? "bg-pos" : val < prevVal ? "bg-neg" : "") : "";
      html += `<td class="numeric ${cls}">${val}</td>`;
    }
    else{
      html += `<td>${row[c] || ""}</td>`;
    }
  });

  return html + "</tr>";
}

/* =========================
   RENDER GROUPS + SUBTOTALS
========================= */
function renderGroupedRows(rows, colsToShow, monthCols, selected){
  const groups = {};
  const totals = {};

  rows.forEach(r => {
    const key = selected["TOTAL"].join("|") === "STATE" ? r.STATE : "ALL";
    if(!groups[key]) groups[key] = [];
    groups[key].push(r);
  });

  let html = "";
  for(const g in groups){
    groups[g].forEach(r => html += buildRowHtml(r, colsToShow, selected));

    const subtotal = {};
    monthCols.forEach(m => subtotal[m] = groups[g].reduce((s, rr) => s + (Number(rr[m])||0), 0));

    html += buildSubtotalRow(subtotal, colsToShow, monthCols, selected);
  }

  return html;
}

function buildSubtotalRow(sub, colsToShow, monthCols, selected){
  let html = "<tr class='subtotal-row'>";

  const comp = selected["COMPARISON"] || [];
  const hasComp = comp.length === 2;

  colsToShow.forEach((c, i) => {
    if(c === "COMPARISON"){
      if(hasComp){
        const a = sub[comp[0]] || 0;
        const b = sub[comp[1]] || 0;
        const diff = b - a;
        const cls = diff > 0 ? "bg-pos" : diff < 0 ? "bg-neg" : "";
        html += `<td class="numeric ${cls}">${diff}</td>`;
      } else html += `<td></td>`;
      return;
    }

    if(monthCols.includes(c)){
      const val = sub[c] || 0;
      let prevVal = null;
      for(let j=i-1; j>=0; j--){
        if(monthCols.includes(colsToShow[j])){
          prevVal = sub[colsToShow[j]] || 0;
          break;
        }
      }
      const cls = prevVal !== null ? (val > prevVal ? "bg-pos" : val < prevVal ? "bg-neg" : "") : "";
      html += `<td class="numeric ${cls}">${val}</td>`;
    }
    else{
      html += i===0 ? `<td class='subtotal-label'>Subtotal</td>` : `<td></td>`;
    }
  });

  return html + "</tr>";
}

/* =========================
   GRAND TOTAL FOOTER
========================= */
function renderGrandTotal(rows, colsToShow, monthCols, selected){
  if(!rows.length) return "";

  const totals = {};
  monthCols.forEach(m => totals[m] = rows.reduce((s, r) => s + (Number(r[m])||0), 0));

  let html = "<tr class='grandtotal-row'>";

  const comp = selected["COMPARISON"] || [];
  const hasComp = comp.length === 2;

  colsToShow.forEach((c, i) => {
    if(c === "COMPARISON"){
      if(hasComp){
        const a = totals[comp[0]] || 0;
        const b = totals[comp[1]] || 0;
        const diff = b - a;
        const cls = diff > 0 ? "bg-pos" : diff < 0 ? "bg-neg" : "";
        html += `<td class="numeric ${cls}"><b>${diff}</b></td>`;
      } else html += `<td></td>`;
      return;
    }

    if(monthCols.includes(c)){
      const val = totals[c] || 0;
      let prevVal = null;
