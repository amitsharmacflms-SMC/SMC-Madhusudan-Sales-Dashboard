/* =========================
  Full optimized dashboard.js
  - Single-file, no duplicate declarations
  - Includes: AVG columns in comparison, color coding (prev-col), compact rendering, LCP/CLS friendly
  - Drop-in replacement for static/js/dashboard.js
  ========================= */

/* -------------------- Config & helpers -------------------- */
let currentView = "product";
let fullData = [];
let originalKeys = [];
let currentGroupedData = [];
let currentSelectedFilters = {};

const baseTextCols = ["STATE","MANAGER_NAME","DISTRICT","PRODUCT","SKU","PARTY_NAME"];
const monthOrder = [
  "APR-23","MAY-23","JUN-23","AVG_Q1_2023-24","JUL-23","AUG-23","SEP-23","AVG_Q2_2023-24",
  "OCT-23","NOV-23","DEC-23","AVG_Q3_2023-24","JAN-24","FEB-24","MAR-24","AVG_Q4_2023-24","AVG_YEAR_2023-24",
  "APR-24","MAY-24","JUN-24","AVG_Q1_2024-25","JUL-24","AUG-24","SEP-24","AVG_Q2_2024-25","OCT-24","NOV-24","DEC-24","AVG_Q3_2024-25",
  "JAN-25","FEB-25","MAR-25","AVG_Q4_2024-25","AVG_YEAR_2024-25","APR-25","MAY-25","JUN-25","AVG_Q1_2025-26","JUL-25","AUG-25","SEP-25","AVG_Q2_2025-26","OCT-25","AVG_Q3_2025-26","AVG_YEAR_2025-26"
];

const norm = s => String(s||"").toUpperCase().trim();
const getVal = (row, key) => {
  if (!row || !key) return "";
  if (Object.prototype.hasOwnProperty.call(row, key)) return row[key];
  const uk = key.toUpperCase();
  const lk = key.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(row, uk)) return row[uk];
  if (Object.prototype.hasOwnProperty.call(row, lk)) return row[lk];
  const findKey = Object.keys(row).find(k => norm(k).replace(/[-_\s]/g,'') === norm(key).replace(/[-_\s]/g,''));
  return findKey ? row[findKey] : "";
};

/* overlay helpers (lightweight) */
let __overlayTimer = null;
function showOverlay(delay=150){ clearTimeout(__overlayTimer); __overlayTimer = setTimeout(()=>document.getElementById("overlayLoader").classList.remove("hidden"), delay); }
function hideOverlay(){ clearTimeout(__overlayTimer); document.getElementById("overlayLoader").classList.add("hidden"); }

/* small utilities */
function debounce(fn, wait=300){ let t; return (...a)=>{ clearTimeout(t); t = setTimeout(()=>fn(...a), wait); }; }
function runIdle(fn){ if("requestIdleCallback" in window) requestIdleCallback(fn, {timeout:300}); else setTimeout(fn, 200); }

/* -------------------- Initialization -------------------- */
document.addEventListener("DOMContentLoaded", ()=>{ initUI(); loadData(currentView); });

function initUI(){
  const backBtn = document.getElementById("backBtn"); if(backBtn) backBtn.addEventListener("click", ()=>window.history.back());
  const toggleFiltersBtn = document.getElementById("toggleFiltersBtn"); if(toggleFiltersBtn) toggleFiltersBtn.addEventListener("click", toggleFilters);
  const clearBtn = document.getElementById("clearBtn"); if(clearBtn) clearBtn.addEventListener("click", ()=>runIdle(clearFilters));
  const exportBtn = document.getElementById("exportBtn"); if(exportBtn) exportBtn.addEventListener("click", ()=>{ showOverlay(120); runIdle(exportExcel); });
  const toggleViewBtn = document.getElementById("toggleViewBtn"); if(toggleViewBtn) toggleViewBtn.addEventListener("click", ()=>{
    localStorage.removeItem("savedFilters");
    localStorage.removeItem("default_avg_cols");
    currentView = currentView === "product" ? "sku" : "product";
    toggleViewBtn.textContent = currentView === "product" ? "Switch to SKU View" : "Switch to Product View";
    loadData(currentView);
  });

  const themeBtn = document.getElementById("themeToggle");
  if(themeBtn){ if(localStorage.getItem("theme")==="dark"){ document.documentElement.classList.add("dark-mode"); themeBtn.textContent = "Light Mode"; }
    themeBtn.addEventListener("click", ()=>{ const html = document.documentElement; if(html.classList.contains("dark-mode")){ html.classList.remove("dark-mode"); localStorage.setItem("theme","light"); themeBtn.textContent="Dark Mode"; } else { html.classList.add("dark-mode"); localStorage.setItem("theme","dark"); themeBtn.textContent="Light Mode"; } }); }
}

/* toggle filters */
let filtersVisible = window.innerWidth > 768;
function toggleFilters(){ const wrapper = document.getElementById("filtersWrapper"); const btn = document.getElementById("toggleFiltersBtn"); if(!wrapper || !btn) return; if(filtersVisible){ wrapper.classList.remove("active"); wrapper.style.maxHeight = "0"; btn.textContent = "Show Filters"; } else { wrapper.classList.add("active"); wrapper.style.maxHeight = "600px"; btn.textContent = "Hide Filters"; } filtersVisible = !filtersVisible; }

function clearFilters(){ localStorage.removeItem("savedFilters"); localStorage.removeItem("default_avg_cols"); loadData(currentView); }

/* -------------------- Build Filters -------------------- */
function buildFilters(){
  const filters = document.getElementById("filtersContainer"); if(!filters) return; filters.innerHTML = "";
  const headers = originalKeys.map(k=>norm(k));
  const textCols = baseTextCols.filter(c => headers.includes(c));
  const order = currentView === "product" ? ["SHOW COLUMNS","MONTH / YEAR","STATE","MANAGER_NAME","DISTRICT","PRODUCT","PARTY_NAME","COMPARISON","TOTAL"] : ["SHOW COLUMNS","MONTH / YEAR","STATE","MANAGER_NAME","DISTRICT","PRODUCT","SKU","PARTY_NAME","COMPARISON","TOTAL"];
  const colors = ["#fff7ed","#ecfdf5","#e0f2fe","#fdf2f8","#fef3c7","#e0f2fe","#f3e8ff","#fef2f2","#f3f4f6"]; let ci = 0;

  function makeBox(title, vals = [], checkAll = false){
    const box = document.createElement("div"); box.className = "filter-box"; box.style.background = colors[ci++ % colors.length]; box.style.border = "1px solid #000"; // thin black outline per request
    const allId = `all_${title.replace(/\s+/g,"_")}`;
    let optionsHtml = "";
    if(title === "MONTH / YEAR" || title === "COMPARISON"){
      optionsHtml = vals.map(v => `<label><input type=\"checkbox\" name=\"${title}\" value=\"${v}\"> ${String(v).toUpperCase()}</label>`).join("");
    } else {
      optionsHtml = vals.map(v => `<label><input type=\"checkbox\" name=\"${title}\" value=\"${v}\" ${checkAll?"checked":""}> ${v}</label>`).join("");
    }
    box.innerHTML = `<strong>${title}</strong><label class=\"all-label\"><input type=\"checkbox\" data-all=\"${title}\" id=\"${allId}\" ${checkAll?"checked":""}> All</label><div class=\"options\" style=\"max-height:220px;overflow:auto;padding-right:6px;\">${optionsHtml}</div>`;
    filters.appendChild(box);
  }

  const actualMonthYearCols = monthOrder.filter(m => originalKeys.map(k=>k.toUpperCase()).includes(m.toUpperCase()));
  // include AVG columns in comparison as well (same ordering)
  const actualComparisonCols = actualMonthYearCols.slice();

  order.forEach(f => {
    if(f === "SHOW COLUMNS") makeBox(f, textCols, true);
    else if(f === "MONTH / YEAR") makeBox(f, actualMonthYearCols, false);
    else if(f === "COMPARISON") makeBox(f, actualComparisonCols, false);
    else if(f === "TOTAL") makeBox(f, textCols, false);
    else if(textCols.includes(f)){
      const vals = [...new Set(fullData.map(r => String(getVal(r,f))).filter(Boolean))].sort();
      makeBox(f, vals, true);
    }
  });

  // All checkbox listeners
  filters.querySelectorAll("input[data-all]").forEach(cb => cb.addEventListener("change", e => { const grp = e.target.dataset.all; const checked = e.target.checked; filters.querySelectorAll(`input[name='${grp}']`).forEach(i => i.checked = checked); runIdle(applyFilters); }));

  // change -> apply filters (debounced)
  filters.addEventListener("change", debounce(()=>{ runIdle(()=>applyFilters()); }, 250));
}

/* -------------------- Load Data -------------------- */
async function loadData(view){
  const loader = document.getElementById("loader"); if(loader) loader.classList.remove("hidden"); if(loader) loader.textContent = "Loading data..."; showOverlay(80);
  try{
    const res = await fetch(`/get_data/${view}`);
    if(!res.ok) throw new Error("Server returned " + res.status);
    const data = await res.json();
    if(!Array.isArray(data) || data.length === 0){ if(loader) loader.textContent = "No data found"; hideOverlay(); return; }

    // keep both original and uppercase keys for resilient lookups
    fullData = data.map(r => { const normalized = {}; Object.keys(r).forEach(k => { normalized[k] = r[k]; normalized[k.toUpperCase()] = r[k]; }); return normalized; });
    originalKeys = Object.keys(fullData[0] || {});

    // detect avg columns
    const avgColsInData = Object.keys(fullData[0] || {}).filter(k => k.toUpperCase().startsWith("AVG_Q"));
    const normalizeKey = k => String(k||"").toUpperCase().replace(/[-_]/g,"");
    const avgColsSorted = monthOrder.filter(m => avgColsInData.some(k => normalizeKey(k) === normalizeKey(m)));
    const last5AvgCols = avgColsSorted.slice(-5);

    buildFilters();

    // apply saved filters or defaults
    setTimeout(()=>{
      const getInputs = title => Array.from(document.querySelectorAll(`#filtersContainer input[name='${title}']`));
      const saved = JSON.parse(localStorage.getItem("savedFilters") || "{}");
      const defaults = JSON.parse(localStorage.getItem("default_avg_cols") || "[]");
      const hasAnySavedSelected = Object.values(saved).some(arr => Array.isArray(arr) && arr.length > 0);

      if(hasAnySavedSelected){
        Object.entries(saved).forEach(([title, values]) => { getInputs(title).forEach(cb => cb.checked = values.some(v => String(v).toUpperCase() === String(cb.value).toUpperCase()); const allCb = document.getElementById(`all_${title.replace(/\s+/g,'_')}`); if(allCb){ const allOptions = getInputs(title); allCb.checked = allOptions.every(cb => cb.checked); } });
      } else {
        // DEFAULTS per user's request:
        // 1) STATE = all
        // 2) PRODUCT = only "ALL IN CASES" (if present)
        // 3) MONTH / YEAR = last5AvgCols
        // 4) TOTAL = STATE

        // Uncheck all first
        document.querySelectorAll(`#filtersContainer input[type='checkbox']`).forEach(cb=>cb.checked=false);

        // 1) STATE all
        getInputs("STATE").forEach(cb => cb.checked = true);

        // 2) PRODUCT only All In Cases
        getInputs("PRODUCT").forEach(cb => { cb.checked = String(cb.value).toUpperCase().trim() === "ALL IN CASES"; });

        // 3) MONTH / YEAR = last5AvgCols
        const last5Upper = last5AvgCols.map(x=>String(x).toUpperCase());
        getInputs("MONTH / YEAR").forEach(cb => { if(last5Upper.includes(cb.value.toUpperCase())) cb.checked = true; });

        // 4) TOTAL = STATE
        getInputs("TOTAL").forEach(cb => { cb.checked = String(cb.value).toUpperCase().trim() === "STATE"; });

        // COMPARISON = none
        getInputs("COMPARISON").forEach(cb => cb.checked = false);

        // update All boxes
        function updateAllBox(title){ const allCb = document.getElementById(`all_${title.replace(/\s+/g,'_')}`); if(!allCb) return; const opts = getInputs(title); allCb.checked = opts.length>0 && opts.every(cb => cb.checked); }
        updateAllBox("STATE"); updateAllBox("PRODUCT"); updateAllBox("MONTH / YEAR"); updateAllBox("TOTAL");

        // save defaults
        const defaultSave = {};
        [...document.querySelectorAll("#filtersContainer .filter-box strong")].forEach(h => { const title = h.textContent.trim(); defaultSave[title] = [...document.querySelectorAll(`input[name='${title}']:checked`)].map(i => i.value); });
        localStorage.setItem("savedFilters", JSON.stringify(defaultSave));
        localStorage.setItem("default_avg_cols", JSON.stringify(last5AvgCols));
      }

      // finally render
      applyFilters(false);
    }, 450);

  } catch(err){ console.error("Error loading data:", err); const loaderEl = document.getElementById("loader"); if(loaderEl) loaderEl.textContent = "⚠ Error loading data: " + err.message; }
  finally{ hideOverlay(); setTimeout(()=>{ const loaderEl = document.getElementById("loader"); if(loaderEl) loaderEl.classList.add("hidden"); }, 300); }
}

/* -------------------- Apply Filters (smart cascade) -------------------- */
function applyFilters(save=true){ showOverlay(80); requestAnimationFrame(()=>{
  try{
    const filters = document.getElementById("filtersContainer"); if(!filters) return; const selected = {};
    [...filters.querySelectorAll(".filter-box strong")].forEach(h => { const title = h.textContent.trim(); selected[title] = [...filters.querySelectorAll(`input[name='${title}']:checked`)].map(i=>i.value); });

    // normalize TOTAL selections
    if(Array.isArray(selected["TOTAL"])) selected["TOTAL"] = selected["TOTAL"].map(v => String(v).toUpperCase().trim());
    if(save) localStorage.setItem("savedFilters", JSON.stringify(selected));
    currentSelectedFilters = selected;

    const cascade = currentView === "product" ? ["STATE","MANAGER_NAME","DISTRICT","PRODUCT","PARTY_NAME"] : ["STATE","MANAGER_NAME","DISTRICT","PRODUCT","SKU","PARTY_NAME"];

    let filtered = [...fullData];
    cascade.forEach(f => { const sel = (selected[f] || []).map(s=>String(s).trim()).filter(Boolean); if(sel.length) filtered = filtered.filter(r => { const val = String(getVal(r,f)); return sel.some(s => String(s).toUpperCase() === val.toUpperCase()); }); });

    // smart cascade: disable irrelevant options but keep visible
    cascade.forEach(f => {
      const box = [...filters.querySelectorAll(".filter-box")].find(b => b.querySelector("strong")?.textContent.trim() === f);
      if(!box) return;
      const valid = new Set(filtered.map(r => String(getVal(r,f))).filter(Boolean));
      box.querySelectorAll(`input[name='${f}']`).forEach(cb => { const value = cb.value; const label = cb.closest("label"); if(valid.has(value) || cb.checked){ cb.disabled = false; if(label) label.style.opacity = "1"; } else { cb.disabled = true; if(label) label.style.opacity = "0.4"; } });
      const allCb = document.getElementById(`all_${f.replace(/\s+/g,'_')}`);
      if(allCb){ const options = box.querySelectorAll(`input[name='${f}']:not([disabled])`); const checkedOptions = box.querySelectorAll(`input[name='${f}']:checked:not([disabled])`); allCb.checked = (options.length>0 && options.length === checkedOptions.length); }
    });

    renderTable(filtered, selected);
  } finally{ hideOverlay(); }
}); }

/* -------------------- Render Table -------------------- */
function renderTable(dataToRender, selected, alreadyGrouped = false){
  const tHead = document.getElementById("tableHead"); const tBody = document.getElementById("tableBody"); const tFoot = document.getElementById("tableFoot");
  const showCols = (selected["SHOW COLUMNS"] && selected["SHOW COLUMNS"].length) ? selected["SHOW COLUMNS"] : baseTextCols;
  const availableMonthCols = monthOrder.filter(m => originalKeys.map(k=>k.toUpperCase()).includes(m.toUpperCase()));
  const monthCols = (selected["MONTH / YEAR"] && selected["MONTH / YEAR"].length) ? selected["MONTH / YEAR"] : availableMonthCols;
  const totalCols = selected["TOTAL"] || [];

  let colsToShow = [...showCols, ...monthCols].map(c => String(c)); colsToShow = colsToShow.filter((v,i,arr)=>arr.indexOf(v)===i);
  if((selected["COMPARISON"]||[]).length === 2 && !colsToShow.includes("COMPARISON")) colsToShow.push("COMPARISON");

  const normShowUpper = showCols.map(s=>String(s).toUpperCase());
  const firstTextColIndex = colsToShow.findIndex(c => normShowUpper.includes(String(c).toUpperCase()));

  const isNumericCol = c => monthOrder.map(m=>m.toUpperCase()).includes(String(c).toUpperCase()) || c === "COMPARISON";
  tHead.innerHTML = "<tr>" + colsToShow.map(c => `<th class=\"${isNumericCol(c)?'sortable':''}\" data-col=\"${c}\">${c}${isNumericCol(c)?'<span class=\"sort-icon\">↕️</span>':''}</th>`).join("") + "</tr>";
  addSorting(colsToShow);

  let grouped = dataToRender;
  if(!alreadyGrouped){
    const map = new Map();
    dataToRender.forEach(r => { const key = showCols.map(k => String(getVal(r,k))).join("|"); if(!map.has(key)){ const obj = {}; showCols.forEach(k=>obj[k]=getVal(r,k)); monthCols.forEach(m=>obj[m]=Number(getVal(r,m))||0); map.set(key,obj); } else { const obj = map.get(key); monthCols.forEach(m=>obj[m]=obj[m]+(Number(getVal(r,m))||0)); } });
    grouped = [...map.values()];
  }
  currentGroupedData = grouped;

  let rowsHtml = "";
  if(Array.isArray(totalCols) && totalCols.length){
    const groups = {};
    grouped.forEach(row => { const key = totalCols.map(k=>String(getVal(row,k))||"").join("|"); if(!groups[key]) groups[key]=[]; groups[key].push(row); });
    Object.entries(groups).forEach(([gKey, rows]) => {
      rows.forEach(r => rowsHtml += buildRowHtml(r, colsToShow, selected));
      const subtotal = {}; monthCols.forEach(m => subtotal[m] = rows.reduce((s,rr)=>s + (Number(rr[m])||0),0));
      const subCells = colsToShow.map((c, idx) => {
        if(c === "COMPARISON" && (selected["COMPARISON"]||[]).length === 2){ const [a,b] = selected["COMPARISON"]; const diff = (subtotal[b]||0) - (subtotal[a]||0); const cls = diff > 0 ? 'bg-pos' : (diff < 0 ? 'bg-neg' : ''); return `<td class=\"numeric ${cls}\">${diff}</td>`; }
        if(monthOrder.map(m=>m.toUpperCase()).includes(String(c).toUpperCase())){ const val = subtotal[c]||0; let prev = null; for(let j=idx-1;j>=0;j--){ if(monthOrder.map(m=>m.toUpperCase()).includes(String(colsToShow[j]).toUpperCase())){ prev = subtotal[colsToShow[j]]; break; } } const cls = (prev !== null) ? (val > prev ? 'bg-pos' : (val < prev ? 'bg-neg' : '')) : ''; return `<td class=\"numeric ${cls}\">${val}</td>`; }
        if(idx === firstTextColIndex && firstTextColIndex >= 0) return `<td class=\"subtotal-label\">Subtotal</td>`; return `<td></td>`;
      }).join("");
      rowsHtml += `<tr class=\"subtotal-row\">${subCells}</tr>`;
    });
  } else {
    grouped.forEach(r => rowsHtml += buildRowHtml(r, colsToShow, selected));
  }

  tBody.innerHTML = rowsHtml;

  // grand totals
  tFoot.innerHTML = "";
  if(grouped.length){
    const totals = {}; monthCols.forEach(m=>totals[m]=grouped.reduce((s,r)=>s+(Number(r[m])||0),0));
    const totalCells = colsToShow.map((c, idx) => {
      if(c === "COMPARISON" && (selected["COMPARISON"]||[]).length === 2){ const [a,b] = selected["COMPARISON"]; const diff = (totals[b]||0) - (totals[a]||0); const cls = diff > 0 ? 'bg-pos' : (diff < 0 ? 'bg-neg' : ''); return `<td class=\"numeric ${cls}\"><b>${diff}</b></td>`; }
      if(monthOrder.map(m=>m.toUpperCase()).includes(String(c).toUpperCase())){ const val = totals[c]||0; let prev = null; for(let j=idx-1;j>=0;j--){ if(monthOrder.map(m=>m.toUpperCase()).includes(String(colsToShow[j]).toUpperCase())){ prev = totals[colsToShow[j]]; break; } } const cls = (prev !== null) ? (val > prev ? 'bg-pos' : (val < prev ? 'bg-neg' : '')) : ''; return `<td class=\"numeric ${cls}\"><b>${val}</b></td>`; }
      if(idx === firstTextColIndex && firstTextColIndex >= 0) return `<td class=\"subtotal-label\"><b>TOTAL</b></td>`; return `<td></td>`;
    }).join("");
    tFoot.innerHTML = `<tr class=\"grandtotal-row\">${totalCells}</tr>`;
  }

  const tableEl = document.getElementById("dataTable"); if(tableEl){ tableEl.classList.remove("hidden"); tableEl.style.visibility = ""; }
}

/* -------------------- buildRowHtml (with prev-col coloring) -------------------- */
function buildRowHtml(row, colsToShow, selected){
  const cells = colsToShow.map((c, idx) => {
    if(c === "COMPARISON"){
      const compare = (selected["COMPARISON"]||[]);
      if(compare.length === 2){ const [a,b] = compare; const diff = (Number(row[b])||0) - (Number(row[a])||0); const cls = diff > 0 ? 'bg-pos' : (diff < 0 ? 'bg-neg' : ''); return `<td class=\"numeric ${cls}\">${diff}</td>`; } else return `<td class=\"numeric\"></td>`;
    }

    if(monthOrder.map(m=>m.toUpperCase()).includes(String(c).toUpperCase())){
      const num = Number(row[c]) || 0;
      // find previous visible numeric column
      let prevVal = null;
      for(let j = idx - 1; j >= 0; j--){
        if(monthOrder.map(m=>m.toUpperCase()).includes(String(colsToShow[j]).toUpperCase())){ prevVal = Number(row[colsToShow[j]]) || 0; break; }
      }
      const cls = (prevVal !== null) ? (num > prevVal ? 'bg-pos' : (num < prevVal ? 'bg-neg' : '')) : '';
      return `<td class=\"numeric ${cls}\">${num}</td>`;
    }

    const txt = row[c] ?? row[String(c).toUpperCase()] ?? row[String(c).toLowerCase()] ?? "";
    return `<td>${txt}</td>`;
  });
  return `<tr>${cells.join("")}</tr>`;
}

/* -------------------- Sorting -------------------- */
function addSorting(colsToShow){
  const table = document.getElementById("dataTable"); if(!table) return; const ths = table.querySelectorAll("th.sortable");
  ths.forEach(th => { th.onclick = ()=>{
    const col = th.getAttribute("data-col"); const asc = !th.classList.contains("asc");
    table.querySelectorAll("th .sort-icon").forEach(icon => icon.textContent = '↕️');
    table.querySelectorAll("th").forEach(t => t.classList.remove("asc","desc"));
    th.classList.add(asc?"asc":"desc"); const sortIcon = th.querySelector('.sort-icon'); if(sortIcon) sortIcon.textContent = asc? '⬆️' : '⬇️';
    let sortedGrouped = [...currentGroupedData];
    sortedGrouped.sort((a,b)=>{ const A = Number(a[col])||0; const B = Number(b[col])||0; return asc? A - B : B - A; });
    renderTable(sortedGrouped, currentSelectedFilters, true);
  }; });
}

/* -------------------- Export to Excel -------------------- */
async function exportExcel(){
  try{
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Dashboard Data");
    const table = document.getElementById("dataTable");
    if(!table) return;
    const rows = Array.from(table.querySelectorAll("tr")).map(tr => Array.from(tr.querySelectorAll("th,td")).map(td => td.innerText.trim()));
    rows.forEach((r,i)=>{ const row = worksheet.addRow(r); if(i===0){ row.eachCell(cell=>{ cell.font={bold:true,color:{argb:"1E3A8A"}}; cell.fill={type:"pattern",pattern:"solid",fgColor:{argb:"E0E7FF"}}; cell.alignment={horizontal:"center",vertical:"middle"}; cell.border={top:{style:"thin"},left:{style:"thin"},bottom:{style:"thin"},right:{style:"thin"}}; }); } else { row.eachCell((cell)=>{ const val = String(cell.value ?? ""); if(val.toUpperCase().includes("SUBTOTAL")){ cell.fill={type:"pattern",pattern:"solid",fgColor:{argb:"E0F2FE"}}; cell.font={bold:true,color:{argb:"1E3A8A"}}; cell.alignment={horizontal:"center",vertical:"middle"}; } else if(val.toUpperCase().includes("TOTAL")){ cell.fill={type:"pattern",pattern:"solid",fgColor:{argb:"F3E8FF"}}; cell.font={bold:true,color:{argb:"4C1D95"}}; cell.alignment={horizontal:"center",vertical:"middle"}; } else if(!isNaN(parseFloat(val))){ const num = parseFloat(val); const bg = num > 0 ? "D1FAE5" : "FEE2E2"; cell.fill={type:"pattern",pattern:"solid",fgColor:{argb:bg}}; cell.alignment={horizontal:"center",vertical:"middle"}; } else { cell.alignment={horizontal:"center",vertical:"middle"}; } }); } });
    worksheet.columns.forEach(col=>col.width=15);
    worksheet.views = [{ state: 'frozen', ySplit: 1 }];
    const buf = await workbook.xlsx.writeBuffer(); const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }); const fileName = `${currentView}_export_${new Date().toISOString().split("T")[0]}.xlsx`; saveAs(blob, fileName);
  } catch(err){ console.error("Export failed", err); alert("Export failed: " + err.message); } finally{ hideOverlay(); }
}

/* ensure overlay hidden */
hideOverlay();

/* mobile perf tweaks */
const isMobile = window.matchMedia("(max-width: 768px)").matches;
if(isMobile){ console.log("Mobile optimizations applied"); const fContainer = document.getElementById("filtersContainer"); if(fContainer) fContainer.style.scrollBehavior = "smooth"; }

/* End of dashboard.js */
