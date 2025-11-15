// dashboard.js — Consolidated & Fixed (Full Auto-Fix)
// Features: filters, smart cascade, grouping, subtotal, totals, comparison, color-coding, export, sorting.
// Put this in static/js/dashboard.js and load with <script defer src=".../dashboard.js"></script>

(() => {
  "use strict";

  /* =========================
     CONFIG / GLOBALS
  ========================== */
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

  /* Normalization helpers */
  const norm = s => String(s || "").toUpperCase().trim();
  function normalizeKeySimple(k){
    return String(k || "").toUpperCase().replace(/[-_ ]/g, "");
  }
  function getVal(row, key){
    if(!row || !key) return "";
    if(Object.prototype.hasOwnProperty.call(row, key)) return row[key];
    const u = key.toUpperCase();
    const l = key.toLowerCase();
    if(Object.prototype.hasOwnProperty.call(row, u)) return row[u];
    if(Object.prototype.hasOwnProperty.call(row, l)) return row[l];
    const target = normalizeKeySimple(key);
    const match = Object.keys(row).find(k => normalizeKeySimple(k) === target);
    return match ? row[match] : "";
  }

  /* Overlay helpers */
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

  /* Utils */
  function debounce(fn, wait = 300){
    let t;
    return (...a) => { clearTimeout(t); t = setTimeout(()=>fn(...a), wait); };
  }
  function runIdle(fn){
    if(window.requestIdleCallback) requestIdleCallback(fn, {timeout:300});
    else setTimeout(fn, 200);
  }

  /* Initialization */
  document.addEventListener("DOMContentLoaded", () => {
    initUI();
    loadData(currentView);
  });

  function initUI(){
    const backBtn = document.getElementById("backBtn");
    if(backBtn) backBtn.addEventListener("click", () => window.history.back());

    const toggleFiltersBtn = document.getElementById("toggleFiltersBtn");
    if(toggleFiltersBtn) toggleFiltersBtn.addEventListener("click", toggleFilters);

    const clearBtn = document.getElementById("clearBtn");
    if(clearBtn) clearBtn.addEventListener("click", ()=>runIdle(clearFilters));

    const exportBtn = document.getElementById("exportBtn");
    if(exportBtn) exportBtn.addEventListener("click", ()=>{ showOverlay(120); runIdle(exportExcel); });

    const viewBtn = document.getElementById("toggleViewBtn");
    if(viewBtn){
      viewBtn.addEventListener("click", ()=>{
        localStorage.removeItem("savedFilters");
        localStorage.removeItem("default_avg_cols");
        currentView = currentView === "product" ? "sku" : "product";
        viewBtn.textContent = currentView === "product" ? "Switch to SKU View" : "Switch to Product View";
        loadData(currentView);
      });
    }

    const themeBtn = document.getElementById("themeToggle");
    if(themeBtn){
      if(localStorage.getItem("theme")==="dark"){ document.documentElement.classList.add("dark-mode"); themeBtn.textContent = "Light Mode"; }
      themeBtn.addEventListener("click", ()=>{
        const html = document.documentElement;
        if(html.classList.contains("dark-mode")){ html.classList.remove("dark-mode"); localStorage.setItem("theme","light"); themeBtn.textContent="Dark Mode"; }
        else { html.classList.add("dark-mode"); localStorage.setItem("theme","dark"); themeBtn.textContent="Light Mode"; }
      });
    }
  }

  /* Filter panel toggle */
  let filtersVisible = window.innerWidth > 768;
  function toggleFilters(){
    const wrapper = document.getElementById("filtersWrapper");
    const btn = document.getElementById("toggleFiltersBtn");
    if(!wrapper || !btn) return;
    if(filtersVisible){ wrapper.classList.remove("active"); wrapper.style.maxHeight = "0"; btn.textContent = "Show Filters"; }
    else { wrapper.classList.add("active"); wrapper.style.maxHeight = "600px"; btn.textContent = "Hide Filters"; }
    filtersVisible = !filtersVisible;
  }

  function clearFilters(){
    localStorage.removeItem("savedFilters");
    localStorage.removeItem("default_avg_cols");
    loadData(currentView);
  }

  /* =========================
     BUILD FILTER UI
     (single, robust function; thin black outline applied inline)
  ========================== */
  function buildFilters(){
    const filters = document.getElementById("filtersContainer");
    if(!filters) return;
    filters.innerHTML = "";

    const headersUpper = originalKeys.map(k => k.toUpperCase());
    const textCols = baseTextCols.filter(c => headersUpper.includes(c));

    const order = currentView === "product"
      ? ["SHOW COLUMNS","MONTH / YEAR","STATE","MANAGER_NAME","DISTRICT","PRODUCT","PARTY_NAME","COMPARISON","TOTAL"]
      : ["SHOW COLUMNS","MONTH / YEAR","STATE","MANAGER_NAME","DISTRICT","PRODUCT","SKU","PARTY_NAME","COMPARISON","TOTAL"];

    const colorCycle = ["#fff7ed","#ecfdf5","#e0f2fe","#fdf2f8","#fef3c7","#e0f2fe","#f3e8ff","#fef2f2","#f3f4f6"];
    let ci = 0;

    function makeBox(title, values=[], checkAll=false){
      const box = document.createElement("div");
      box.className = "filter-box";
      box.style.background = colorCycle[ci++ % colorCycle.length];
      box.style.border = "1px solid #000"; // thin black outline requested
      box.style.borderRadius = "8px";
      box.style.padding = "6px";
      box.style.minWidth = "160px";
      box.style.maxWidth = "320px";
      box.style.boxSizing = "border-box";

      const header = document.createElement("strong");
      header.textContent = title;
      header.style.display = "block";
      header.style.textAlign = "center";
      header.style.marginBottom = "6px";
      header.style.fontWeight = "800";
      box.appendChild(header);

      const allLabel = document.createElement("label");
      allLabel.style.display = "block";
      allLabel.style.marginBottom = "6px";
      const allCb = document.createElement("input");
      allCb.setAttribute("type", "checkbox");
      allCb.dataset.all = title;
      allCb.style.marginRight = "6px";
      if(checkAll) allCb.checked = true;
      allLabel.appendChild(allCb);
      allLabel.appendChild(document.createTextNode("All"));
      box.appendChild(allLabel);

      const opts = document.createElement("div");
      opts.className = "options";
      opts.style.maxHeight = "220px";
      opts.style.overflow = "auto";
      opts.style.paddingRight = "6px";

      values.forEach(v => {
        const lbl = document.createElement("label");
        lbl.style.display = "block";
        lbl.style.margin = "2px 0";
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.name = title;
        cb.value = v;
        cb.style.marginRight = "6px";
        if(checkAll) cb.checked = true;
        lbl.appendChild(cb);
        // show uppercase for month/year and comparison to match earlier UI
        lbl.appendChild(document.createTextNode(String(v)));
        opts.appendChild(lbl);
      });

      box.appendChild(opts);
      filters.appendChild(box);
    }

    const actualMonthYearCols = monthOrder.filter(m => headersUpper.includes(m.toUpperCase()));
    const comparisonCols = actualMonthYearCols.slice(); // include AVG columns too for comparison (user requested)

    // prepare values for other text columns
    const cache = {};
    for(const k of order){
      if(k === "SHOW COLUMNS"){
        makeBox(k, textCols, true);
      } else if(k === "MONTH / YEAR"){
        makeBox(k, actualMonthYearCols, false);
      } else if(k === "COMPARISON"){
        makeBox(k, comparisonCols, false);
      } else if(k === "TOTAL"){
        makeBox(k, textCols, false);
      } else if(textCols.includes(k)){
        if(!cache[k]){
          const set = new Set();
          for(const r of fullData){
            const val = getVal(r, k);
            if(val !== undefined && val !== null && val !== "") set.add(String(val));
          }
          cache[k] = Array.from(set).sort();
        }
        makeBox(k, cache[k], true);
      }
    }

    // add listeners for "All" checkboxes and change handlers
    filters.querySelectorAll("input[data-all]").forEach(cb => {
      cb.addEventListener("change", e => {
        const title = e.target.dataset.all;
        const checked = e.target.checked;
        filters.querySelectorAll(`input[name='${title}']`).forEach(i => { i.checked = checked; });
        runIdle(() => applyFilters());
      });
    });

    filters.addEventListener("change", debounce(() => runIdle(() => applyFilters()), 250));
  }

  /* =========================
     LOAD DATA (from /get_data/<view>)
  ========================== */
  async function loadData(view){
    const loader = document.getElementById("loader");
    if(loader){ loader.classList.remove("hidden"); loader.textContent = "Loading data..."; }
    showOverlay(80);

    try{
      const res = await fetch(`/get_data/${view}`);
      if(!res.ok) throw new Error("Server returned " + res.status);
      const data = await res.json();
      if(!Array.isArray(data)) throw new Error("Invalid data");

      fullData = data.map(r => {
        const out = {};
        Object.keys(r).forEach(k => { out[k] = r[k]; out[k.toUpperCase()] = r[k]; });
        return out;
      });

      originalKeys = Object.keys(fullData[0] || {});

      // compute last 5 avg columns for defaults
      const avgCols = originalKeys.filter(k => k.toUpperCase().startsWith("AVG_Q"));
      const avgNormalized = avgCols.map(a => normalizeKeySimple(a));
      const orderedAvg = monthOrder.filter(m => avgNormalized.includes(normalizeKeySimple(m)));
      const last5Avg = orderedAvg.slice(-5);

      buildFilters();

      // restore saved filters or apply defaults
      setTimeout(() => {
        const saved = JSON.parse(localStorage.getItem("savedFilters") || "{}");
        if(Object.keys(saved).length) restoreSavedFilters(saved);
        else applyDefaultFilters(last5Avg);
        applyFilters(false);
      }, 400);

    } catch(err){
      console.error("loadData error", err);
      if(loader) loader.textContent = "Error loading data";
    } finally {
      hideOverlay();
      if(loader) setTimeout(()=>loader.classList.add("hidden"), 350);
    }
  }

  function restoreSavedFilters(saved){
    const filters = document.getElementById("filtersContainer");
    if(!filters) return;
    Object.entries(saved).forEach(([title, values]) => {
      const uvals = values.map(v => String(v).toUpperCase());
      Array.from(filters.querySelectorAll(`input[name='${title}']`)).forEach(cb => {
        cb.checked = uvals.includes(String(cb.value).toUpperCase());
      });
      // update all checkbox
      const allBox = filters.querySelector(`input[data-all='${title}']`);
      if(allBox){
        const options = Array.from(filters.querySelectorAll(`input[name='${title}']`));
        allBox.checked = options.length && options.every(o => o.checked);
      }
    });
  }

  function applyDefaultFilters(last5Avg){
    const filters = document.getElementById("filtersContainer");
    if(!filters) return;
    Array.from(filters.querySelectorAll("input[type='checkbox']")).forEach(cb => cb.checked = false);

    // STATE = ALL
    Array.from(filters.querySelectorAll("input[name='STATE']")).forEach(cb => cb.checked = true);

    // PRODUCT = ONLY ALL IN CASES
    Array.from(filters.querySelectorAll("input[name='PRODUCT']")).forEach(cb => {
      cb.checked = String(cb.value).toUpperCase() === "ALL IN CASES";
    });

    // MONTH / YEAR = only last5Avg
    const set5 = last5Avg.map(x => norm(x));
    Array.from(filters.querySelectorAll("input[name='MONTH / YEAR']")).forEach(cb => {
      cb.checked = set5.includes(String(cb.value).toUpperCase());
    });

    // TOTAL = STATE
    Array.from(filters.querySelectorAll("input[name='TOTAL']")).forEach(cb => {
      cb.checked = String(cb.value).toUpperCase() === "STATE";
    });

    // COMPARISON = none
    Array.from(filters.querySelectorAll("input[name='COMPARISON']")).forEach(cb => cb.checked = false);

    // update All boxes
    ["STATE","PRODUCT","MONTH / YEAR","TOTAL"].forEach(title => {
      const allBox = document.querySelector(`#filtersContainer input[data-all='${title}']`);
      if(allBox){
        const opts = Array.from(document.querySelectorAll(`#filtersContainer input[name='${title}']`));
        allBox.checked = opts.length && opts.every(o => o.checked);
      }
    });

    // save defaults
    const saveObj = {};
    Array.from(document.querySelectorAll("#filtersContainer .filter-box strong")).forEach(h => {
      const t = h.textContent.trim();
      const sel = Array.from(document.querySelectorAll(`#filtersContainer input[name='${t}']:checked`)).map(i => i.value);
      saveObj[t] = sel;
    });
    localStorage.setItem("savedFilters", JSON.stringify(saveObj));
    localStorage.setItem("default_avg_cols", JSON.stringify(last5Avg));
  }

  /* =========================
     APPLY FILTERS + SMART CASCADE (keeps disabled options visible)
  ========================== */
  function applyFilters(save = true){
    showOverlay(80);

    const filters = document.getElementById("filtersContainer");
    if(!filters) { hideOverlay(); return; }

    const selected = {};
    Array.from(filters.querySelectorAll(".filter-box strong")).forEach(h => {
      const title = h.textContent.trim();
      selected[title] = Array.from(filters.querySelectorAll(`input[name='${title}']:checked`)).map(i => i.value);
    });

    if(Array.isArray(selected["TOTAL"])) selected["TOTAL"] = selected["TOTAL"].map(v => String(v).toUpperCase());

    if(save) localStorage.setItem("savedFilters", JSON.stringify(selected));
    currentSelectedFilters = selected;

    const cascade = currentView === "product"
      ? ["STATE","MANAGER_NAME","DISTRICT","PRODUCT","PARTY_NAME"]
      : ["STATE","MANAGER_NAME","DISTRICT","PRODUCT","SKU","PARTY_NAME"];

    let filtered = fullData.slice();

    for(const f of cascade){
      const sel = (selected[f] || []).map(s => String(s).toUpperCase()).filter(Boolean);
      if(sel.length) filtered = filtered.filter(r => sel.includes(String(getVal(r, f)).toUpperCase()));
    }

    // disable irrelevant options instead of hiding
    for(const f of cascade){
      const box = Array.from(filters.querySelectorAll(".filter-box")).find(b => b.querySelector("strong")?.textContent.trim() === f);
      if(!box) continue;
      const valid = new Set(filtered.map(r => String(getVal(r,f))).filter(Boolean));
      Array.from(box.querySelectorAll(`input[name='${f}']`)).forEach(cb => {
        const val = String(cb.value);
        const label = cb.parentElement;
        if(valid.has(val) || cb.checked){ cb.disabled = false; if(label) label.style.opacity = "1"; }
        else { cb.disabled = true; if(label) label.style.opacity = "0.35"; }
      });
      // update All checkbox
      const allBox = box.querySelector("input[data-all]");
      if(allBox){
        const options = Array.from(box.querySelectorAll(`input[name='${f}']:not([disabled])`));
        const checked = options.filter(i => i.checked);
        allBox.checked = options.length > 0 && checked.length === options.length;
      }
    }

    renderTable(filtered, selected);
    hideOverlay();
  }

  /* =========================
     RENDER TABLE + HELPERS
  ========================== */
  function renderTable(dataToRender, selected){
    const tHead = document.getElementById("tableHead");
    const tBody = document.getElementById("tableBody");
    const tFoot = document.getElementById("tableFoot");
    const table = document.getElementById("dataTable");
    if(!table || !tHead || !tBody) return;

    // keep rows compact for lower LCP/CLS and user request
    table.classList.add("compact");
    // compute visible columns
    const showCols = (selected["SHOW COLUMNS"] && selected["SHOW COLUMNS"].length) ? selected["SHOW COLUMNS"] : baseTextCols;
    const availableMonthCols = monthOrder.filter(m => originalKeys.map(k => k.toUpperCase()).includes(m.toUpperCase()));
    const monthCols = (selected["MONTH / YEAR"] && selected["MONTH / YEAR"].length) ? selected["MONTH / YEAR"] : availableMonthCols;
    const totalCols = selected["TOTAL"] || [];

    let colsToShow = [...showCols, ...monthCols].map(c => String(c));
    colsToShow = colsToShow.filter((v,i,a) => a.indexOf(v) === i);

    const hasComparison = (selected["COMPARISON"] || []).length === 2;
    if(hasComparison && !colsToShow.includes("COMPARISON")) colsToShow.push("COMPARISON");

    // build header
    tHead.innerHTML = "<tr>" + colsToShow.map(c => {
      const isNumeric = monthOrder.map(m => m.toUpperCase()).includes(String(c).toUpperCase()) || c === "COMPARISON";
      return `<th class="${isNumeric?'sortable':''}" data-col="${c}" style="text-align:center">${c}${isNumeric?'<span class="sort-icon">↕️</span>':''}</th>`;
    }).join("") + "</tr>";
    addSorting(colsToShow);

    // grouping
    const grouped = groupByTextColumns(dataToRender, showCols, monthCols);
    currentGroupedData = grouped;

    // build rows
    let rowsHtml = "";
    if(Array.isArray(totalCols) && totalCols.length){
      // grouping by TOTAL (only STATE supported logically; if multiple fields selected, we treat combined key)
      const groups = {};
      grouped.forEach(r => {
        const keyParts = totalCols.map(k => String(getVal(r, k)) || "");
        const key = keyParts.join("|");
        if(!groups[key]) groups[key] = [];
        groups[key].push(r);
      });

      Object.entries(groups).forEach(([gKey, rows]) => {
        rows.forEach(r => rowsHtml += buildRowHtml(r, colsToShow, selected));
        // subtotal
        const subtotal = {};
        monthCols.forEach(m => subtotal[m] = rows.reduce((s, rr) => s + (Number(rr[m])||0), 0));
        rowsHtml += buildSubtotalRow(subtotal, colsToShow, monthCols, selected);
      });
    } else {
      grouped.forEach(r => rowsHtml += buildRowHtml(r, colsToShow, selected));
    }

    tBody.innerHTML = rowsHtml;

    // grand totals
    if(grouped.length){
      tFoot.innerHTML = "<tr class='grandtotal-row'>" + colsToShow.map((c, idx) => {
        if(c === "COMPARISON" && hasComparison){
          const a = selected["COMPARISON"][0];
          const b = selected["COMPARISON"][1];
          const totalsA = grouped.reduce((s, r) => s + (Number(r[a])||0), 0);
          const totalsB = grouped.reduce((s, r) => s + (Number(r[b])||0), 0);
          const diff = totalsB - totalsA;
          const cls = diff > 0 ? "bg-pos" : "bg-neg";
          return `<td class="numeric ${cls}"><b>${diff}</b></td>`;
        }
        if(monthOrder.map(m => m.toUpperCase()).includes(String(c).toUpperCase())){
          const totalVal = grouped.reduce((s, r) => s + (Number(r[c])||0), 0);
          // compute previous visible numeric column for color logic
          let prev = null;
          for(let j = idx-1; j >= 0; j--){
            if(monthOrder.map(m => m.toUpperCase()).includes(String(colsToShow[j]).toUpperCase())){
              prev = grouped.reduce((s, r) => s + (Number(r[colsToShow[j]])||0), 0);
              break;
            }
          }
          const cls = (prev !== null) ? (totalVal > prev ? "bg-pos" : "bg-neg") : "";
          return `<td class="numeric ${cls}"><b>${totalVal}</b></td>`;
        }
        // first text column -> show TOTAL label
        const firstTextIndex = colsToShow.findIndex(c2 => baseTextCols.map(x => x.toUpperCase()).includes(String(c2).toUpperCase()));
        if(idx === firstTextIndex && firstTextIndex >= 0) return `<td class="subtotal-label"><b>TOTAL</b></td>`;
        return "<td></td>";
      }).join("") + "</tr>";
    } else {
      tFoot.innerHTML = "";
    }

    table.classList.remove("hidden");
    table.style.visibility = "visible";
  }

  function groupByTextColumns(data, textCols, monthCols){
    const map = new Map();
    data.forEach(r => {
      const key = textCols.map(k => String(getVal(r, k))).join("|");
      if(!map.has(key)){
        const obj = {};
        textCols.forEach(k => obj[k] = getVal(r, k));
        monthCols.forEach(m => obj[m] = Number(getVal(r, m)) || 0);
        map.set(key, obj);
      } else {
        const obj = map.get(key);
        monthCols.forEach(m => obj[m] = obj[m] + (Number(getVal(r, m)) || 0));
      }
    });
    return Array.from(map.values());
  }

  function buildRowHtml(row, colsToShow, selected){
    const comp = selected["COMPARISON"] || [];
    const hasComp = comp.length === 2;
    let html = "<tr style='height:26px'>"; // decreased row height

    colsToShow.forEach((c, idx) => {
      if(c === "COMPARISON"){
        if(hasComp){
          const a = Number(row[comp[0]]) || 0;
          const b = Number(row[comp[1]]) || 0;
          const diff = b - a;
          const cls = diff > 0 ? "bg-pos" : "bg-neg";
          html += `<td class="numeric ${cls}">${diff}</td>`;
        } else html += "<td class='numeric'></td>";
        return;
      }

      if(monthOrder.map(m => m.toUpperCase()).includes(String(c).toUpperCase())){
        const val = Number(row[c]) || 0;
        // find previous visible numeric column in the row
        let prevVal = null;
        for(let j = idx-1; j >= 0; j--){
          if(monthOrder.map(m => m.toUpperCase()).includes(String(colsToShow[j]).toUpperCase())){
            prevVal = Number(row[colsToShow[j]]) || 0;
            break;
          }
        }
        // color logic: > previous => green, <= previous => red (user requested >0 green, <=0 red relative to previous)
        const cls = (prevVal !== null) ? (val > prevVal ? "bg-pos" : "bg-neg") : "";
        html += `<td class="numeric ${cls}">${val}</td>`;
        return;
      }

      // text column
      const txt = row[c] || "";
      html += `<td>${txt}</td>`;
    });

    html += "</tr>";
    return html;
  }

  function buildSubtotalRow(sub, colsToShow, monthCols, selected){
    const comp = selected["COMPARISON"] || [];
    const hasComp = comp.length === 2;
    let html = "<tr class='subtotal-row' style='height:28px;font-weight:700'>";

    colsToShow.forEach((c, idx) => {
      if(c === "COMPARISON"){
        if(hasComp){
          const a = sub[comp[0]] || 0;
          const b = sub[comp[1]] || 0;
          const diff = b - a;
          const cls = diff > 0 ? "bg-pos" : "bg-neg";
          html += `<td class="numeric ${cls}">${diff}</td>`;
        } else html += "<td></td>";
        return;
      }
      if(monthCols.includes(c)){
        const val = sub[c] || 0;
        let prev = null;
        for(let j=idx-1; j>=0; j--){
          if(monthCols.includes(colsToShow[j])){ prev = sub[colsToShow[j]] || 0; break; }
        }
        const cls = (prev !== null) ? (val > prev ? "bg-pos" : "bg-neg") : "";
        html += `<td class="numeric ${cls}">${val}</td>`;
        return;
      }
      // first text column -> show Subtotal label
      const firstTextIndex = colsToShow.findIndex(c2 => baseTextCols.map(x => x.toUpperCase()).includes(String(c2).toUpperCase()));
      if(idx === firstTextIndex && firstTextIndex >= 0) html += `<td class='subtotal-label'>Subtotal</td>`;
      else html += "<td></td>";
    });

    html += "</tr>";
    return html;
  }

  /* =========================
     Sorting helpers
  ========================== */
  function addSorting(colsToShow){
    const table = document.getElementById("dataTable");
    if(!table) return;
    Array.from(table.querySelectorAll("th.sortable")).forEach(th => {
      th.style.cursor = "pointer";
      th.onclick = () => {
        const col = th.dataset.col;
        const asc = !th.classList.contains("asc");
        // reset
        Array.from(table.querySelectorAll("th")).forEach(t => t.classList.remove("asc","desc"));
        th.classList.add(asc ? "asc" : "desc");
        Array.from(table.querySelectorAll("th .sort-icon")).forEach(i => i.textContent = "↕️");
        const icon = th.querySelector(".sort-icon");
        if(icon) icon.textContent = asc ? "⬆️" : "⬇️";

        // perform numeric sort if possible
        let sorted = currentGroupedData.slice();
        sorted.sort((a,b) => {
          const A = Number(a[col]) || 0;
          const B = Number(b[col]) || 0;
          return asc ? A - B : B - A;
        });
        // re-render using alreadyGrouped = true (we will use grouped data directly)
        renderTable(sorted, currentSelectedFilters);
      };
    });
  }

  /* =========================
     Export to Excel (ExcelJS)
  ========================== */
  async function exportExcel(){
    try{
      if(typeof ExcelJS === "undefined" || typeof saveAs === "undefined"){
        alert("Export libraries not loaded. Make sure ExcelJS & FileSaver are included.");
        return;
      }
      showOverlay(80);
      const workbook = new ExcelJS.Workbook();
      const ws = workbook.addWorksheet("Dashboard");
      const table = document.getElementById("dataTable");
      if(!table){ alert("No table to export"); return; }
      const rows = Array.from(table.querySelectorAll("tr")).map(tr => Array.from(tr.querySelectorAll("th,td")).map(td => td.innerText.trim()));
      rows.forEach((r, idx) => {
        const row = ws.addRow(r);
        if(idx === 0) row.eachCell(cell => {
          cell.font = { bold:true };
          cell.alignment = { horizontal: "center" };
        });
      });
      ws.columns.forEach(c => c.width = 18);
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      saveAs(blob, `dashboard_export_${new Date().toISOString().split("T")[0]}.xlsx`);
    } catch(err){
      console.error("Export failed", err);
      alert("Export failed: " + err.message);
    } finally {
      hideOverlay();
    }
  }

  /* =========================
     Expose helper to console (optional)
  ========================== */
  window.__dashboardHelpers = {
    reload: () => loadData(currentView),
    applyFilters: () => applyFilters(true)
  };

  // ensure overlay hidden on load
  hideOverlay();

})();
