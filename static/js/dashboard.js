/* dashboard.js — Self-Repairing Version
   - Auto-creates missing table sections (Head/Body/Foot)
   - Prevents blank screen issues
   - Keeps all previous fixes (Speed, Z-Index, Filters)
*/

/* =============================
   1. GLOBAL CONFIG
============================= */
let fullDataPromise = null;
let currentView = "product"; 
let fullData = [];
let originalKeys = [];
let currentGroupedData = [];
let currentRenderTaskId = 0;
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
   2. DATA FETCHING
============================= */
function startFetch(view) {
  return fetch(`/get_data/${view}`)
    .then(res => {
      if (!res.ok) throw new Error(res.status);
      return res.json();
    })
    .then(data => {
      if (!Array.isArray(data)) return [];
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
fullDataPromise = startFetch(currentView);

/* =============================
   3. INITIALIZATION
============================= */
document.addEventListener("DOMContentLoaded", () => {
  bindUI();
  initializeData();
});

async function initializeData() {
  showOverlay(50);
  try {
    fullData = await fullDataPromise;
    originalKeys = Object.keys(fullData[0] || {});

    const avgCols = originalKeys.filter(k => String(k).toUpperCase().startsWith("AVG_Q"));
    const orderedAvg = monthOrder.filter(m => avgCols.some(a => a.toUpperCase() === m.toUpperCase()));
    const last5Avg = orderedAvg.slice(-5);

    buildFilters();
    setTimeout(() => applySavedOrDefaults(last5Avg), 0);

  } catch(e) {
    console.error("Init Error", e);
  } finally {
    hideOverlay();
  }
}

/* =============================
   4. UI BINDING
============================= */
function bindUI(){
  const safeBind = (id, event, fn) => {
    const el = document.getElementById(id);
    if(el) el.addEventListener(event, fn);
  };
  safeBind("backBtn", "click", ()=> window.history.back());
  safeBind("clearBtn", "click", clearFilters);
  safeBind("toggleFiltersBtn", "click", toggleFilters);
  safeBind("toggleViewBtn", "click", switchView);
  safeBind("exportBtn", "click", () => { showOverlay(100); setTimeout(exportExcel, 100); });
}

function switchView(){
  localStorage.removeItem("savedFilters");
  localStorage.removeItem("default_avg_cols");
  const btn = document.getElementById("toggleViewBtn");
  currentView = currentView === "product" ? "sku" : "product";
  if(btn) btn.textContent = currentView === "product" ? "Switch to SKU View" : "Switch to Product View";
  
  fullDataPromise = startFetch(currentView);
  initializeData();
}

function toggleFilters(){
  const wrapper = document.getElementById("filtersWrapper");
  const btn = document.getElementById("toggleFiltersBtn");
  if(!wrapper) return;
  if(wrapper.style.maxHeight === "0px" || !wrapper.style.maxHeight){
    wrapper.style.maxHeight = "600px";
    if(btn) btn.textContent = "Hide Filters";
  } else {
    wrapper.style.maxHeight = "0px";
    if(btn) btn.textContent = "Show Filters";
  }
}

/* =============================
   5. FILTERS
============================= */
function buildFilters(){
  const container = document.getElementById("filtersContainer");
  if(!container) return;
  container.innerHTML = "";

  const headers = originalKeys.map(k => k.toUpperCase());
  const textCols = baseTextCols.filter(c => headers.includes(c));
  
  const order = currentView === "product"
    ? ["SHOW COLUMNS","MONTH / YEAR","STATE","MANAGER_NAME","DISTRICT","PRODUCT","PARTY_NAME","COMPARISON","TOTAL"]
    : ["SHOW COLUMNS","MONTH / YEAR","STATE","MANAGER_NAME","DISTRICT","PRODUCT","SKU","PARTY_NAME","COMPARISON","TOTAL"];

  const colors = ["#fff7ed","#ecfdf5","#e0f2fe","#fdf2f8","#fef3c7","#e0f2fe","#f3e8ff","#fef2f2","#f3f4f6"];
  let ci = 0;

  order.forEach(title => {
    let values = [];
    let checkAll = false;

    if(title === "SHOW COLUMNS") { values = textCols; checkAll = true; }
    else if(title === "MONTH / YEAR") { values = monthOrder.filter(m => headers.includes(m.toUpperCase())); }
    else if(title === "COMPARISON") { values = monthOrder.filter(m => headers.includes(m.toUpperCase())); }
    else if(title === "TOTAL") { values = textCols; }
    else if(textCols.includes(title)) {
       const s = new Set();
       fullData.forEach(r => { const v = r[title] || r[title.toUpperCase()]; if(v) s.add(String(v)); });
       values = Array.from(s).sort();
       checkAll = true;
    }

    const box = document.createElement("div");
    box.className = "filter-box";
    box.style.cssText = `background:${colors[ci++ % colors.length]};border:1px solid #ccc;border-radius:6px;padding:8px;min-width:130px;`;
    box.innerHTML = `<div style="text-align:center;font-weight:bold;margin-bottom:5px;text-transform:uppercase">${title}</div>`;
    
    const labelAll = document.createElement("label");
    labelAll.style.display = "block";
    labelAll.style.fontWeight = "600";
    labelAll.innerHTML = `<input type="checkbox" data-all="${title}"> All`;
    box.appendChild(labelAll);

    const optsDiv = document.createElement("div");
    optsDiv.className = "options";
    optsDiv.style.cssText = "max-height:200px;overflow-y:auto;";

    values.forEach(v => {
      const l = document.createElement("label");
      l.style.display = "block";
      l.style.fontSize = "13px";
      const chk = document.createElement("input");
      chk.type = "checkbox";
      chk.name = title;
      chk.value = v;
      if(checkAll) chk.checked = true;
      l.appendChild(chk);
      l.appendChild(document.createTextNode(" " + v));
      optsDiv.appendChild(l);
    });
    box.appendChild(optsDiv);
    container.appendChild(box);
  });

  container.querySelectorAll("input[data-all]").forEach(cb => {
    cb.addEventListener("change", (e) => {
      const t = e.target.dataset.all;
      container.querySelectorAll(`input[name="${t}"]`).forEach(c => c.checked = e.target.checked);
      triggerFilterUpdate();
    });
  });

  container.addEventListener("change", (e) => {
    if(e.target.dataset.all) return;
    triggerFilterUpdate();
  });
}

let _filterDebounce = null;
function triggerFilterUpdate(){
  clearTimeout(_filterDebounce);
  _filterDebounce = setTimeout(() => applyFilters(true), 150);
}

/* =============================
   6. APPLY FILTERS
============================= */
function applySavedOrDefaults(last5Avg){
  const container = document.getElementById("filtersContainer");
  if(!container) return;

  const saved = JSON.parse(localStorage.getItem("savedFilters") || "{}");
  const hasSaved = Object.keys(saved).length > 0;

  if(hasSaved){
    Object.entries(saved).forEach(([key, arr]) => {
      const inputs = container.querySelectorAll(`input[name="${key}"]`);
      inputs.forEach(i => i.checked = arr.includes(i.value));
    });
  } else {
    container.querySelectorAll("input").forEach(i => i.checked = false);
    container.querySelectorAll(`input[name="STATE"]`).forEach(i=>i.checked=true);
    container.querySelectorAll(`input[name="PRODUCT"]`).forEach(i=>{ if(String(i.value).toUpperCase() === "ALL IN CASES") i.checked = true; });
    container.querySelectorAll(`input[name="MONTH / YEAR"]`).forEach(i=>{ if(last5Avg.includes(i.value)) i.checked = true; });
    container.querySelectorAll(`input[name="TOTAL"]`).forEach(i=>{ if(i.value === "STATE") i.checked = true; });
  }
  applyFilters(false);
}

function applyFilters(save = true){
  showOverlay(50);
  requestAnimationFrame(() => {
    const container = document.getElementById("filtersContainer");
    if(!container) return; 

    const selected = {};
    container.querySelectorAll(".filter-box").forEach(box => {
      const title = box.querySelector("div").innerText;
      const checked = Array.from(box.querySelectorAll(".options input:checked")).map(i => i.value);
      selected[title] = checked;
    });

    if(save) localStorage.setItem("savedFilters", JSON.stringify(selected));

    let result = fullData;
    const filtersToApply = currentView === "product" 
       ? ["STATE","MANAGER_NAME","DISTRICT","PRODUCT","PARTY_NAME"]
       : ["STATE","MANAGER_NAME","DISTRICT","PRODUCT","SKU","PARTY_NAME"];

    filtersToApply.forEach(key => {
      const valid = selected[key];
      if(valid && valid.length > 0){
        const s = new Set(valid.map(x => String(x).toUpperCase()));
        result = result.filter(row => {
          const val = row[key] || row[key.toUpperCase()];
          return s.has(String(val).toUpperCase());
        });
      }
    });

    filtersToApply.forEach(key => {
       const available = new Set(result.map(r => String(r[key]||r[key.toUpperCase()])));
       const inputs = container.querySelectorAll(`input[name="${key}"]`);
       inputs.forEach(i => {
         const p = i.parentElement;
         if(available.has(i.value) || i.checked) { i.disabled=false; p.style.opacity=1; }
         else { i.disabled=true; p.style.opacity=0.5; }
       });
    });

    renderTable(result, selected);
  });
}

/* =============================
   7. RENDER TABLE (Fixed: Auto-Creates Missing Elements)
============================= */
function renderTable(data, selected){
  currentRenderTaskId++;
  const thisTaskId = currentRenderTaskId;

  const table = document.getElementById("dataTable");
  if(!table) {
      console.error("Missing <table> with id='dataTable'");
      return;
  }

  // --- AUTO REPAIR HTML STRUCTURE ---
  let tHead = document.getElementById("tableHead");
  if(!tHead) { tHead = table.createTHead(); tHead.id = "tableHead"; }

  let tBody = document.getElementById("tableBody");
  if(!tBody) { tBody = document.createElement("tbody"); tBody.id = "tableBody"; table.appendChild(tBody); }

  let tFoot = document.getElementById("tableFoot");
  if(!tFoot) { tFoot = table.createTFoot(); tFoot.id = "tableFoot"; }
  // ----------------------------------

  // Fix Order
  if(table.firstElementChild !== tHead) table.prepend(tHead);

  // Determine Columns
  const showCols = (selected["SHOW COLUMNS"]?.length) ? selected["SHOW COLUMNS"] : baseTextCols;
  const monthCols = (selected["MONTH / YEAR"]?.length) ? selected["MONTH / YEAR"] : [];
  const totalCols = selected["TOTAL"] || [];
  const compareSel = selected["COMPARISON"] || [];
  
  let cols = [...showCols, ...monthCols].filter((item, pos, self) => self.indexOf(item) === pos);
  const hasComparison = (compareSel.length === 2);
  if(hasComparison && !cols.includes("COMPARISON")) cols.push("COMPARISON");

  // Render Header
  const thHTML = cols.map(c => `
    <th style="
      position: sticky; 
      top: 0; 
      z-index: 9999; 
      background-color: #e0f2fe; 
      color: #000;
      border-bottom: 2px solid #999;
      padding: 10px;
      white-space: nowrap;
      box-shadow: 0 2px 2px -1px rgba(0,0,0,0.1);
    ">${String(c).replace(/_/g, " ")}</th>
  `).join("");
  tHead.innerHTML = `<tr>${thHTML}</tr>`;

  // Group Data
  const groupedMap = new Map();
  data.forEach(row => {
    const key = showCols.map(k => row[k] || row[k.toUpperCase()] || "").join("|");
    if(!groupedMap.has(key)){
      const entry = {};
      showCols.forEach(k => entry[k] = row[k]||row[k.toUpperCase()]);
      monthCols.forEach(m => entry[m] = Number(row[m]||row[m.toUpperCase()]||0));
      groupedMap.set(key, entry);
    } else {
      const entry = groupedMap.get(key);
      monthCols.forEach(m => entry[m] += Number(row[m]||row[m.toUpperCase()]||0));
    }
  });
  const groupedData = Array.from(groupedMap.values());
  currentGroupedData = groupedData;

  // Build Rows
  let allRowsHTML = [];
  if(totalCols.length > 0){
    const subGroups = {};
    groupedData.forEach(row => {
      const k = totalCols.map(tc => row[tc]).join("|");
      if(!subGroups[k]) subGroups[k] = [];
      subGroups[k].push(row);
    });
    Object.values(subGroups).forEach(gRows => {
      gRows.forEach(r => allRowsHTML.push(buildRow(r, cols, monthCols, compareSel)));
      if(gRows.length > 1){
         const sub = {};
         monthCols.forEach(m => sub[m] = gRows.reduce((acc, curr) => acc + (curr[m]||0), 0));
         allRowsHTML.push(buildSubtotal(sub, cols, monthCols, compareSel));
      }
    });
  } else {
    allRowsHTML = groupedData.map(r => buildRow(r, cols, monthCols, compareSel));
  }

  // Inject Rows
  tBody.innerHTML = "";
  
  // Safe DOM Reveal
  const elContainer = document.getElementById("tableContainer");
  const elSkeleton = document.getElementById("tableSkeleton");
  const elLoader = document.getElementById("loader");

  if(elContainer) elContainer.classList.remove("hidden");
  if(elSkeleton) elSkeleton.classList.add("hidden");
  if(elLoader) { elLoader.style.visibility = "hidden"; elLoader.textContent = ""; }

  // 1. Sync Render (First 50)
  const batchSize = 50;
  if(allRowsHTML.length > 0){
    tBody.innerHTML = allRowsHTML.slice(0, batchSize).join("");
  }

  // 2. Async Render (Rest)
  if(allRowsHTML.length > batchSize){
    let idx = batchSize;
    function renderNextChunk(){
      if(currentRenderTaskId !== thisTaskId) return; 
      const chunkEnd = Math.min(idx + 200, allRowsHTML.length);
      const chunkStr = allRowsHTML.slice(idx, chunkEnd).join("");
      tBody.insertAdjacentHTML('beforeend', chunkStr);
      idx = chunkEnd;
      if(idx < allRowsHTML.length){
        requestAnimationFrame(renderNextChunk);
      } else {
        hideOverlay();
      }
    }
    requestAnimationFrame(renderNextChunk);
  } else {
    hideOverlay();
  }

  // Footer
  if(groupedData.length > 0){
    const grand = {};
    monthCols.forEach(m => grand[m] = groupedData.reduce((a,b) => a + (b[m]||0), 0));
    
    const footerHTML = cols.map((c, i) => {
      if(i===0) return `<td style="font-weight:bold;padding:10px;">GRAND TOTAL</td>`;
      if(c === "COMPARISON" && hasComparison){
        const v1 = grand[compareSel[0]] || 0;
        const v2 = grand[compareSel[1]] || 0;
        const d = v2 - v1;
        return `<td style="font-weight:bold;padding:10px;color:${d>=0?'green':'red'}">${d}</td>`;
      }
      if(monthCols.includes(c)){
        return `<td style="font-weight:bold;padding:10px;">${grand[c]}</td>`;
      }
      return `<td></td>`;
    }).join("");
    tFoot.innerHTML = `<tr style="background:#eee;border-top:2px solid #000">${footerHTML}</tr>`;
  } else {
    tFoot.innerHTML = "";
  }
  
  addSorting(cols);
}

/* =============================
   8. HTML BUILDERS
============================= */
function buildRow(row, cols, monthCols, compareSel){
  const hasComp = (compareSel.length === 2);
  let tds = cols.map((c, i) => {
    if(c === "COMPARISON"){
      if(hasComp){
        const v1 = row[compareSel[0]]||0;
        const v2 = row[compareSel[1]]||0;
        const d = v2 - v1;
        const bg = d > 0 ? "#d1fae5" : (d < 0 ? "#fee2e2" : "");
        return `<td style="background:${bg};font-weight:bold;text-align:center;">${d}</td>`;
      }
      return `<td></td>`;
    }
    if(monthCols.includes(c)){
      const val = row[c] || 0;
      let prevVal = null;
      for(let j=i-1; j>=0; j--){ if(monthCols.includes(cols[j])){ prevVal = row[cols[j]]; break; } }
      let bg = "";
      if(prevVal !== null){ bg = val > prevVal ? "#ecfdf5" : (val < prevVal ? "#fef2f2" : ""); }
      return `<td style="background:${bg};text-align:center;">${val}</td>`;
    }
    return `<td style="padding:8px;">${row[c] || ""}</td>`;
  });
  return `<tr>${tds.join("")}</tr>`;
}

function buildSubtotal(sub, cols, monthCols, compareSel){
  const hasComp = (compareSel.length === 2);
  let tds = cols.map((c, i) => {
    if(i === 0) return `<td style="font-weight:bold;padding:8px;background:#fafafa">Subtotal</td>`;
    if(c === "COMPARISON" && hasComp){
        const v1 = sub[compareSel[0]]||0;
        const v2 = sub[compareSel[1]]||0;
        return `<td style="font-weight:bold;text-align:center;">${v2-v1}</td>`;
    }
    if(monthCols.includes(c)){
        return `<td style="font-weight:bold;text-align:center;background:#fafafa">${sub[c]}</td>`;
    }
    return `<td style="background:#fafafa"></td>`;
  });
  return `<tr class="subtotal-row">${tds.join("")}</tr>`;
}

function addSorting(cols){
  const ths = document.querySelectorAll("#tableHead th");
  ths.forEach((th, idx) => {
    th.style.cursor = "pointer";
    th.addEventListener("click", () => {
       const colKey = cols[idx];
       const isNumeric = monthOrder.includes(colKey) || colKey === "COMPARISON";
       if(!isNumeric) return; 
       
       const isAsc = th.dataset.order === "asc";
       th.dataset.order = isAsc ? "desc" : "asc";
       
       currentGroupedData.sort((a,b) => {
         let va = a[colKey]||0;
         let vb = b[colKey]||0;
         return isAsc ? va - vb : vb - va;
       });
       
       // Re-render logic needed here if you want sorting to be instant
       const saved = JSON.parse(localStorage.getItem("savedFilters") || "{}");
       renderTable(currentGroupedData, saved);
    });
  });
}

/* =============================
   9. UTILS
============================= */
function clearFilters(){
  localStorage.removeItem("savedFilters");
  localStorage.removeItem("default_avg_cols");
  currentRenderTaskId++; 
  initializeData(); 
}

function showOverlay(t){ 
  const el = document.getElementById("overlayLoader");
  if(el) { el.classList.remove("hidden"); }
}
function hideOverlay(){
  const el = document.getElementById("overlayLoader");
  if(el) el.classList.add("hidden");
}

async function exportExcel(){
  hideOverlay();
}