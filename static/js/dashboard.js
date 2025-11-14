/* dashboard.js — optimized, single IIFE, exposes _dash_helpers for debug */
(function(){
  'use strict';

  // ---------- Config ----------
  let currentView = 'product';
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

  // ---------- Helpers ----------
  const norm = s => String(s||'').toUpperCase().trim();
  const getVal = (row,key)=>{
    if(!row||!key) return '';
    if(Object.prototype.hasOwnProperty.call(row,key)) return row[key];
    const uk = key.toUpperCase(), lk = key.toLowerCase();
    if(Object.prototype.hasOwnProperty.call(row,uk)) return row[uk];
    if(Object.prototype.hasOwnProperty.call(row,lk)) return row[lk];
    const fk = Object.keys(row).find(k=>norm(k).replace(/[-_\s]/g,'')===norm(key).replace(/[-_\s]/g,''));
    return fk ? row[fk] : '';
  };

  let __overlayTimer = null;
  function showOverlay(delay=150){ clearTimeout(__overlayTimer); __overlayTimer = setTimeout(()=>document.getElementById('overlayLoader').classList.remove('hidden'), delay); }
  function hideOverlay(){ clearTimeout(__overlayTimer); document.getElementById('overlayLoader').classList.add('hidden'); }

  function debounce(fn, wait=350){ let t; return (...a)=>{ clearTimeout(t); t = setTimeout(()=>fn(...a), wait); }; }
  function runIdle(fn){ if('requestIdleCallback' in window) requestIdleCallback(fn, { timeout:300 }); else setTimeout(fn, 200); }

  // ---------- Init ----------
  document.addEventListener('DOMContentLoaded', ()=>{
    initUI();
    requestAnimationFrame(()=>{ loadData(currentView); });
  });

  function initUI(){
    const backBtn = document.getElementById('backBtn'); if(backBtn) backBtn.addEventListener('click', ()=>window.history.back());
    document.getElementById('toggleFiltersBtn').addEventListener('click', toggleFilters);
    document.getElementById('clearBtn').addEventListener('click', ()=>{ runIdle(clearFilters); });
    document.getElementById('exportBtn').addEventListener('click', ()=>{ showOverlay(120); runIdle(exportExcel); });
    document.getElementById('toggleViewBtn').addEventListener('click', ()=>{
      localStorage.removeItem('savedFilters'); localStorage.removeItem('default_avg_cols');
      currentView = currentView === 'product' ? 'sku' : 'product';
      document.getElementById('toggleViewBtn').textContent = currentView === 'product' ? 'Switch to SKU View' : 'Switch to Product View';
      loadData(currentView);
    });

    const themeBtn = document.getElementById('themeToggle');
    if(themeBtn){
      if(localStorage.getItem('theme')==='dark'){ document.documentElement.classList.add('dark-mode'); themeBtn.textContent='Light Mode'; }
      themeBtn.addEventListener('click', ()=>{
        const html = document.documentElement;
        if(html.classList.contains('dark-mode')){ html.classList.remove('dark-mode'); localStorage.setItem('theme','light'); themeBtn.textContent='Dark Mode'; }
        else { html.classList.add('dark-mode'); localStorage.setItem('theme','dark'); themeBtn.textContent='Light Mode'; }
      });
    }
  }

  let filtersVisible = window.innerWidth > 768;
  function toggleFilters(){
    const wrapper = document.getElementById('filtersWrapper');
    const btn = document.getElementById('toggleFiltersBtn');
    if(filtersVisible){
      wrapper.classList.remove('active'); wrapper.style.maxHeight = '0'; btn.textContent = 'Show Filters';
    } else {
      wrapper.classList.add('active'); wrapper.style.maxHeight = '600px'; btn.textContent = 'Hide Filters';
    }
    filtersVisible = !filtersVisible;
  }

  function clearFilters(){
    localStorage.removeItem('savedFilters');
    loadData(currentView);
  }

  // ---------- Build Filters ----------
  function buildFilters(){
    const filters = document.getElementById('filtersContainer');
    filters.innerHTML = '';
    const headers = originalKeys.map(k=>norm(k));
    const textCols = baseTextCols.filter(c => headers.includes(c));

    const order = currentView === 'product'
      ? ["SHOW COLUMNS","MONTH / YEAR","STATE","MANAGER_NAME","DISTRICT","PRODUCT","PARTY_NAME","COMPARISON","TOTAL"]
      : ["SHOW COLUMNS","MONTH / YEAR","STATE","MANAGER_NAME","DISTRICT","PRODUCT","SKU","PARTY_NAME","COMPARISON","TOTAL"];

    const colors = ["#fff7ed","#ecfdf5","#e0f2fe","#fdf2f8","#fef3c7","#e0f2fe","#f3e8ff","#fef2f2","#f3f4f6"];
    let ci = 0;

    function makeBox(title, vals = [], checkAll = false){
      const box = document.createElement('div');
      box.className = 'filter-box';
      box.style.background = colors[ci++ % colors.length];
      const allId = `all_${title.replace(/\s+/g, '_')}`;
      let optionsHtml = '';
      if(title === 'MONTH / YEAR' || title === 'COMPARISON'){
        optionsHtml = vals.map(v=>`<label><input type="checkbox" name="${title}" value="${v}"> ${String(v).toUpperCase()}</label>`).join('');
      } else {
        optionsHtml = vals.map(v=>`<label><input type="checkbox" name="${title}" value="${v}" ${checkAll? 'checked':''}> ${v}</label>`).join('');
      }
      box.innerHTML = `<strong>${title}</strong><label class="all-label"><input type="checkbox" data-all="${title}" id="${allId}" ${checkAll? 'checked':''}> All</label><div class="options" style="max-height:220px;overflow:auto;padding-right:6px;">${optionsHtml}</div>`;
      filters.appendChild(box);
    }

    const actualMonthYearCols = monthOrder.filter(m => originalKeys.map(k => k.toUpperCase()).includes(m.toUpperCase()));
    const actualComparisonCols = actualMonthYearCols.filter(c => !String(c).toUpperCase().startsWith('AVG_'));

    order.forEach(f=>{
      if(f === 'SHOW COLUMNS') makeBox(f, textCols, true);
      else if(f === 'MONTH / YEAR') makeBox(f, actualMonthYearCols, false);
      else if(f === 'COMPARISON') makeBox(f, actualComparisonCols, false);
      else if(f === 'TOTAL') makeBox(f, textCols, false);
      else if(textCols.includes(f)){
        const vals = [...new Set(fullData.map(r => String(getVal(r, f))).filter(Boolean))].sort();
        makeBox(f, vals, true);
      }
    });

    // All checkbox listeners
    filters.querySelectorAll('input[data-all]').forEach(cb => {
      cb.addEventListener('change', e => {
        const grp = e.target.dataset.all;
        const checked = e.target.checked;
        filters.querySelectorAll(`input[name='${grp}']`).forEach(i => (i.checked = checked));
        runIdle(applyFilters);
      });
    });

    // debounced apply
    filters.addEventListener('change', debounce(()=>{ runIdle(()=>applyFilters()); }, 300));
  }

  // ---------- Load Data ----------
  async function loadData(view){
    const loader = document.getElementById('loader'); loader.classList.remove('hidden'); loader.textContent = 'Loading data...'; showOverlay(100);
    try{
      const res = await fetch(`/get_data/${view}`);
      if(!res.ok) throw new Error('Server returned ' + res.status);
      const data = await res.json();
      if(!Array.isArray(data) || data.length === 0){ loader.textContent = 'No data found'; hideOverlay(); return; }

      // Normalize keys: keep both original and uppercase copies
      fullData = data.map(r => {
        const normalized = {};
        Object.keys(r).forEach(k => { normalized[k] = r[k]; normalized[k.toUpperCase()] = r[k]; });
        return normalized;
      });

      originalKeys = Object.keys(fullData[0] || {});

      // Detect avg columns and compute last 5 AVG_Q cols
      const avgColsInData = Object.keys(fullData[0] || {}).filter(k => k.toUpperCase().startsWith('AVG_Q'));
      const normalizeKey = k => String(k||'').toUpperCase().replace(/[-_]/g,'');
      const avgColsSorted = monthOrder.filter(m => avgColsInData.some(k => normalizeKey(k) === normalizeKey(m)));
      const last5AvgCols = avgColsSorted.slice(-5);

      // Build filters in idle time
      runIdle(()=>{
        buildFilters();

        // After UI build: apply saved filters or defaults
        setTimeout(()=>{
          const getInputs = title => Array.from(document.querySelectorAll(`#filtersContainer input[name='${title}']`));
          const saved = JSON.parse(localStorage.getItem('savedFilters') || '{}');
          const defaultSaved = JSON.parse(localStorage.getItem('defaultSavedFilters') || '{}');

          const hasAnySavedSelected = Object.values(saved).some(arr => Array.isArray(arr) && arr.length > 0);

          if(hasAnySavedSelected){
            // restore user saved filters
            Object.entries(saved).forEach(([title, values])=>{
              getInputs(title).forEach(cb => {
                cb.checked = values.some(v => String(v).toUpperCase() === String(cb.value).toUpperCase());
              });
              const allCb = document.getElementById(`all_${title.replace(/\s+/g,'_')}`);
              if(allCb){ const allOptions = getInputs(title); allCb.checked = allOptions.every(cb => cb.checked); }
            });
          } else if(Object.keys(defaultSaved).length){
            // apply previously stored defaults
            Object.entries(defaultSaved).forEach(([title, values])=>{
              getInputs(title).forEach(cb => { cb.checked = values.some(v => String(v).toUpperCase() === String(cb.value).toUpperCase()); });
              const allCb = document.getElementById(`all_${title.replace(/\s+/g,'_')}`);
              if(allCb){ const allOptions = getInputs(title); allCb.checked = allOptions.every(cb => cb.checked); }
            });
          } else {
            // NEW defaults: STATE all, PRODUCT only "ALL IN CASES", MONTH/YEAR = last5AvgCols, TOTAL = STATE
            document.querySelectorAll(`#filtersContainer input[type='checkbox']`).forEach(cb => cb.checked = false);
            getInputs('STATE').forEach(cb => cb.checked = true);
            getInputs('PRODUCT').forEach(cb => cb.checked = (String(cb.value).toUpperCase().trim() === 'ALL IN CASES'));
            getInputs('MONTH / YEAR').forEach(cb => { if(last5AvgCols.map(x=>x.toUpperCase()).includes(cb.value.toUpperCase())) cb.checked = true; });
            getInputs('TOTAL').forEach(cb => cb.checked = (String(cb.value).toUpperCase().trim() === 'STATE'));
            getInputs('COMPARISON').forEach(cb => cb.checked = false);

            function updateAllBox(title){ const allCb = document.getElementById(`all_${title.replace(/\s+/g,'_')}`); if(!allCb) return; const opts = getInputs(title); allCb.checked = opts.length > 0 && opts.every(cb => cb.checked); }
            updateAllBox('STATE'); updateAllBox('PRODUCT'); updateAllBox('MONTH / YEAR'); updateAllBox('TOTAL');

            // Save defaults separately
            const defaultSave = {};
            [...document.querySelectorAll('#filtersContainer .filter-box strong')].forEach(h => {
              const title = h.textContent.trim();
              defaultSave[title] = [...document.querySelectorAll(`input[name="${title}"]:checked`)].map(i => i.value);
            });
            localStorage.setItem('defaultSavedFilters', JSON.stringify(defaultSave));
            localStorage.setItem('default_avg_cols', JSON.stringify(last5AvgCols));
          }

          // hide skeleton & render
          const sk = document.getElementById('skeleton'); if(sk) sk.remove();
          applyFilters(false);

        }, 120);
      });

    } catch(err){
      console.error('Error loading data:', err);
      document.getElementById('loader').textContent = '⚠ Error loading data: ' + err.message;
    } finally {
      hideOverlay();
      setTimeout(()=>document.getElementById('loader').classList.add('hidden'), 400);
    }
  }

  // ---------- Apply filters ----------
  function applyFilters(save = true){
    showOverlay(120);
    requestAnimationFrame(()=>{
      try {
        const filters = document.getElementById('filtersContainer');
        const selected = {};
        [...filters.querySelectorAll('.filter-box strong')].forEach(h => {
          const title = h.textContent.trim();
          selected[title] = [...filters.querySelectorAll(`input[name="${title}"]:checked`)].map(i=>i.value);
        });

        if(Array.isArray(selected['TOTAL'])) selected['TOTAL'] = selected['TOTAL'].map(v => String(v).toUpperCase().trim());

        if(save) localStorage.setItem('savedFilters', JSON.stringify(selected));
        currentSelectedFilters = selected;

        const cascade = currentView === 'product'
          ? ['STATE','MANAGER_NAME','DISTRICT','PRODUCT','PARTY_NAME']
          : ['STATE','MANAGER_NAME','DISTRICT','PRODUCT','SKU','PARTY_NAME'];

        let filtered = [...fullData];
        cascade.forEach(f => {
          const sel = (selected[f] || []).map(s=>String(s).trim()).filter(Boolean);
          if(sel.length){
            filtered = filtered.filter(r => sel.some(s => String(getVal(r,f)).toUpperCase() === String(s).toUpperCase()));
          }
        });

        // smart cascade (disable irrelevant options)
        cascade.forEach(f => {
          const box = [...filters.querySelectorAll('.filter-box')].find(b => b.querySelector('strong')?.textContent.trim() === f);
          if(!box) return;
          const valid = new Set(filtered.map(r => String(getVal(r,f))).filter(Boolean));
          box.querySelectorAll(`input[name='${f}']`).forEach(cb => {
            const value = cb.value;
            const label = cb.closest('label');
            if(valid.has(value) || cb.checked){ cb.disabled = false; if(label) label.style.opacity = '1'; }
            else { cb.disabled = true; if(label) label.style.opacity = '0.4'; }
          });
          const allCb = document.getElementById(`all_${f.replace(/\s+/g,'_')}`);
          if(allCb){
            const options = box.querySelectorAll(`input[name='${f}']:not([disabled])`);
            const checkedOptions = box.querySelectorAll(`input[name='${f}']:checked:not([disabled])`);
            allCb.checked = (options.length > 0 && options.length === checkedOptions.length);
          }
        });

        renderTable(filtered, selected);

      } finally {
        hideOverlay();
      }
    });
  }

  // ---------- Render table ----------
  function renderTable(dataToRender, selected, alreadyGrouped = false){
    const tHead = document.getElementById('tableHead');
    const tBody = document.getElementById('tableBody');
    const tFoot = document.getElementById('tableFoot');

    const showCols = (selected['SHOW COLUMNS'] && selected['SHOW COLUMNS'].length) ? selected['SHOW COLUMNS'] : baseTextCols;
    const availableMonthCols = monthOrder.filter(m => originalKeys.map(k => k.toUpperCase()).includes(m.toUpperCase()));
    const monthCols = (selected['MONTH / YEAR'] && selected['MONTH / YEAR'].length) ? selected['MONTH / YEAR'] : availableMonthCols;
    const totalCols = selected['TOTAL'] || [];

    let colsToShow = [...showCols, ...monthCols].map(c => String(c)).filter((v,i,arr) => arr.indexOf(v) === i);
    if((selected['COMPARISON']||[]).length === 2 && !colsToShow.includes('COMPARISON')) colsToShow.push('COMPARISON');

    const normShowUpper = showCols.map(s => String(s).toUpperCase());
    const firstTextColIndex = colsToShow.findIndex(c => normShowUpper.includes(String(c).toUpperCase()));

    const isNumericCol = c => monthOrder.map(m => m.toUpperCase()).includes(String(c).toUpperCase()) || c === 'COMPARISON';
    tHead.innerHTML = '<tr>' + colsToShow.map(c => `<th class="${isNumericCol(c)?'sortable':''}" data-col="${c}">${c}${isNumericCol(c)?'<span class="sort-icon">↕️</span>':''}</th>`).join('') + '</tr>';
    addSorting(colsToShow);

    let grouped = dataToRender;
    if(!alreadyGrouped){
      const map = new Map();
      dataToRender.forEach(r => {
        const key = showCols.map(k => String(getVal(r,k))).join('|');
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
      grouped = [...map.values()];
    }
    currentGroupedData = grouped;

    let rowsHtml = '';
    if(Array.isArray(totalCols) && totalCols.length){
      const groups = {};
      grouped.forEach(row => {
        const gKeyParts = totalCols.map(k => {
          const tryVal = getVal(row,k) ?? getVal(row,String(k).toUpperCase()) ?? getVal(row,String(k).toLowerCase()) ?? '';
          return String(tryVal);
        });
        const key = gKeyParts.join('|');
        if(!groups[key]) groups[key] = [];
        groups[key].push(row);
      });

      Object.entries(groups).forEach(([gKey, rows]) => {
        rows.forEach(r => rowsHtml += buildRowHtml(r, colsToShow, selected));
        const subtotal = {};
        monthCols.forEach(m => subtotal[m] = rows.reduce((s, rr) => s + (Number(rr[m])||0), 0));
        const subCells = colsToShow.map((c, idx) => {
          if(c === 'COMPARISON' && (selected['COMPARISON']||[]).length === 2){
            const [a,b] = selected['COMPARISON'];
            const diff = (subtotal[b]||0) - (subtotal[a]||0);
            const cls = diff > 0 ? 'bg-pos' : (diff < 0 ? 'bg-neg' : '');
            return `<td class="numeric ${cls}">${diff}</td>`;
          }
          if(monthOrder.map(m=>m.toUpperCase()).includes(String(c).toUpperCase())){
            const val = subtotal[c] || 0;
            let prev = null;
            for(let j=idx-1;j>=0;j--){ if(monthOrder.map(m=>m.toUpperCase()).includes(String(colsToShow[j]).toUpperCase())){ prev = subtotal[colsToShow[j]]; break; } }
            const cls = (prev !== null) ? (val > prev ? 'bg-pos' : (val < prev ? 'bg-neg' : '')) : '';
            return `<td class="numeric ${cls}">${val}</td>`;
          }
          if(idx === firstTextColIndex && firstTextColIndex >= 0) return `<td class="subtotal-label">Subtotal</td>`;
          return `<td></td>`;
        }).join('');
        rowsHtml += `<tr class="subtotal-row">${subCells}</tr>`;
      });

    } else {
      grouped.forEach(r => rowsHtml += buildRowHtml(r, colsToShow, selected));
    }

    tBody.innerHTML = rowsHtml;

    // Grand totals
    tFoot.innerHTML = '';
    if(grouped.length){
      const totals = {};
      monthCols.forEach(m => totals[m] = grouped.reduce((s,r)=>s + (Number(r[m])||0), 0));
      const totalCells = colsToShow.map((c, idx) => {
        if(c === 'COMPARISON' && (selected['COMPARISON']||[]).length === 2){
          const [a,b] = selected['COMPARISON'];
          const diff = (totals[b]||0) - (totals[a]||0);
          const cls = diff > 0 ? 'bg-pos' : (diff < 0 ? 'bg-neg' : '');
          return `<td class="numeric ${cls}"><b>${diff}</b></td>`;
        }
        if(monthOrder.map(m=>m.toUpperCase()).includes(String(c).toUpperCase())){
          const val = totals[c] || 0;
          let prev = null;
          for(let j=idx-1;j>=0;j--){ if(monthOrder.map(m=>m.toUpperCase()).includes(String(colsToShow[j]).toUpperCase())){ prev = totals[colsToShow[j]]; break; } }
          const cls = (prev !== null) ? (val > prev ? 'bg-pos' : (val < prev ? 'bg-neg' : '')) : '';
          return `<td class="numeric ${cls}"><b>${val}</b></td>`;
        }
        if(idx === firstTextColIndex && firstTextColIndex >= 0) return `<td class="subtotal-label"><b>TOTAL</b></td>`;
        return `<td></td>`;
      }).join('');
      tFoot.innerHTML = `<tr class="grandtotal-row">${totalCells}</tr>`;
    }

    document.getElementById('dataTable').classList.remove('hidden');
    document.getElementById('dataTable').style.visibility = 'visible';
  }

  function buildRowHtml(row, colsToShow, selected){
    return colsToShow.map((c, idx) => {
      if(c === 'COMPARISON'){
        const compare = (selected['COMPARISON']||[]);
        if(compare.length === 2){
          const [a,b] = compare;
          const diff = (Number(row[b])||0) - (Number(row[a])||0);
          const cls = diff > 0 ? 'bg-pos' : (diff < 0 ? 'bg-neg' : '');
          return `<td class="numeric ${cls}">${diff}</td>`;
        }
        return `<td class="numeric"></td>`;
      }

      if(monthOrder.map(m=>m.toUpperCase()).includes(String(c).toUpperCase())){
        const num = Number(row[c]) || 0;
        let prevVal = null;
        for(let j = idx - 1; j >= 0; j--){
          if(monthOrder.map(m=>m.toUpperCase()).includes(String(colsToShow[j]).toUpperCase())){
            prevVal = Number(row[colsToShow[j]]) || 0; break;
          }
        }
        const cls = (prevVal !== null) ? (num > prevVal ? 'bg-pos' : (num < prevVal ? 'bg-neg' : '')) : '';
        return `<td class="numeric ${cls}">${num}</td>`;
      }

      const txt = row[c] ?? row[String(c).toUpperCase()] ?? row[String(c).toLowerCase()] ?? '';
      return `<td>${txt}</td>`;
    }).join('');
  }

  // ---------- Sorting ----------
  function addSorting(colsToShow){
    const table = document.getElementById('dataTable');
    const ths = table.querySelectorAll('th.sortable');
    ths.forEach(th => {
      th.onclick = () => {
        const col = th.getAttribute('data-col');
        const asc = !th.classList.contains('asc');

        table.querySelectorAll('th .sort-icon').forEach(icon => icon.textContent = '↕️');
        table.querySelectorAll('th').forEach(t => t.classList.remove('asc', 'desc'));

        th.classList.add(asc ? 'asc' : 'desc');
        const sortIcon = th.querySelector('.sort-icon');
        if(sortIcon) sortIcon.textContent = asc ? '⬆️' : '⬇️';

        let sortedGrouped = [...currentGroupedData];
        sortedGrouped.sort((a,b) => { const A = Number(a[col]) || 0; const B = Number(b[col]) || 0; return asc ? A - B : B - A; });

        renderTable(sortedGrouped, currentSelectedFilters, true);
      };
    });
  }

  // ---------- Export ----------
  async function exportExcel(){
    try{
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Dashboard Data');

      const table = document.getElementById('dataTable');
      const rows = Array.from(table.querySelectorAll('tr')).map(tr => Array.from(tr.querySelectorAll('th,td')).map(td => td.innerText.trim()));

      rows.forEach((r, i) => {
        const row = worksheet.addRow(r);
        if(i === 0) {
          row.eachCell(cell => {
            cell.font = { bold: true, color: { argb: '1E3A8A' } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'E0E7FF' } };
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
            cell.border = { top:{style:'thin'}, left:{style:'thin'}, bottom:{style:'thin'}, right:{style:'thin'} };
          });
        } else {
          row.eachCell(cell => {
            const val = String(cell.value ?? '');
            if(val.toUpperCase().includes('SUBTOTAL')){
              cell.fill = { type:'pattern', pattern:'solid', fgColor:{ argb:'E0F2FE' } };
              cell.font = { bold:true, color:{ argb:'1E3A8A' } };
              cell.alignment = { horizontal:'center', vertical:'middle' };
            } else if(val.toUpperCase().includes('TOTAL')){
              cell.fill = { type:'pattern', pattern:'solid', fgColor:{ argb:'F3E8FF' } };
              cell.font = { bold:true, color:{ argb:'4C1D95' } };
              cell.alignment = { horizontal:'center', vertical:'middle' };
            } else if(!isNaN(parseFloat(val))){
              const num = parseFloat(val);
              const bg = num > 0 ? 'D1FAE5' : 'FEE2E2';
              cell.fill = { type:'pattern', pattern:'solid', fgColor:{ argb:bg } };
              cell.alignment = { horizontal:'center', vertical:'middle' };
            } else {
              cell.alignment = { horizontal:'center', vertical:'middle' };
            }
          });
        }
      });

      worksheet.columns.forEach(col => col.width = 15);
      worksheet.views = [{ state: 'frozen', ySplit: 1 }];

      const buf = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const fileName = `${currentView}_export_${new Date().toISOString().split('T')[0]}.xlsx`;
      saveAs(blob, fileName);

    } catch(err){
      console.error('Export failed', err);
      alert('Export failed: ' + err.message);
    } finally {
      hideOverlay();
    }
  }

  // Expose a couple helper functions for debugging
  window._dash_helpers = { applyFilters, loadData };

})();
