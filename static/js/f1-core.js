/* f1-core.js — Unified F1 engine (put in /static/js/f1-core.js) */
/* Provides: F1.init, F1.refresh, F1.export */

const F1 = (function(){
  // internal state
  let cfg = null;
  let RAW = [], MERGED = [], FILTERED = [], ITEMS = [];
  let pool = [], poolSize = 0;
  let container = null, headerRow = null, body = null, frozenLayer = null;
  const ROW_H = 46, BUFFER = 8;
  const NUMERIC = ['opening','qty_recd','qty_sale','closing'];

  // basic util
  const pad2 = n => String(n).padStart(2,'0');
  const fmt = v => (v==null || isNaN(+v)) ? '' : Number(v).toLocaleString();
  function esc(s){ if(s==null) return ''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function parseDMY(s){
    if(!s) return null;
    const m = String(s).trim().match(/(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/);
    if(m) return new Date(+m[3], +m[2]-1, +m[1]);
    const iso = new Date(s); return isNaN(iso) ? null : iso;
  }

  // create worker helper (merging)
  function createMergeWorker(){
    const code = `
      self.onmessage = function(ev){
        try{
          const rows = ev.data.rows;
          const map = new Map();
          for(const r of rows){
            const o = {};
            for(const k in r) o[String(k).trim().toLowerCase()] = r[k];
            const state = (o.state||'')+'';
            const depot = (o.depot||'')+'';
            const date = (o.date||'')+'';
            const sku = (o.sku_name||'')+'';
            const key = state + '||' + depot + '||' + date + '||' + sku;
            if(!map.has(key)) map.set(key, { state, depot, date, sku_name:sku, opening:Number(o.opening)||0, qty_recd:Number(o.qty_recd)||0, qty_sale:Number(o.qty_sale)||0, closing:Number(o.closing)||0 });
            else {
              const g = map.get(key);
              g.opening += Number(o.opening)||0;
              g.qty_recd += Number(o.qty_recd)||0;
              g.qty_sale += Number(o.qty_sale)||0;
              g.closing += Number(o.closing)||0;
            }
          }
          self.postMessage({ ok:true, merged:Array.from(map.values()) });
        } catch(err) {
          self.postMessage({ ok:false, error:String(err) });
        }
      };
    `;
    const blob = new Blob([code], { type:'application/javascript' });
    return new Worker(URL.createObjectURL(blob));
  }

  // init header DOM
  function buildHeader(columns, colWidths){
    headerRow.innerHTML = '';
    columns.forEach(col => {
      const th = document.createElement('div');
      th.className = 'f1-cell';
      th.dataset.col = col.key;
      th.style.width = (colWidths[col.key] || col.width) + 'px';
      th.innerText = col.label;
      th.style.position = 'relative';
      const handle = document.createElement('div'); handle.className='f1-resize'; handle.dataset.col = col.key;
      th.appendChild(handle);
      headerRow.appendChild(th);
    });
  }

  // init resize behavior with autosave
  function initResize(colWidthsKey){
    let current = null;
    document.addEventListener('mousedown', (ev)=>{
      const h = ev.target.closest('.f1-resize'); if(!h) return;
      current = { col: h.dataset.col, startX: ev.clientX, startW: Number(h.parentNode.style.width || h.parentNode.offsetWidth) };
      document.body.style.cursor = 'col-resize';
      ev.preventDefault();
    });
    window.addEventListener('mousemove', (ev)=>{
      if(!current) return;
      const delta = ev.clientX - current.startX;
      const newW = Math.max(60, Math.round(current.startW + delta));
      cfg.colWidths[current.col] = newW;
      // update header + visible rows
      document.querySelectorAll(`[data-col="${current.col}"]`).forEach(el => { el.style.width = newW + 'px'; el.style.minWidth = newW + 'px'; });
    });
    window.addEventListener('mouseup', ()=>{
      if(current){
        try{ localStorage.setItem(colWidthsKey, JSON.stringify(cfg.colWidths || {})); } catch(e){}
        current = null; document.body.style.cursor = '';
      }
    });
  }

  // merge rows either sync or via worker
  function mergeRowsThen(cb){
    try {
      const w = createMergeWorker();
      w.onmessage = (ev)=>{
        if(ev.data && ev.data.ok){
          MERGED = ev.data.merged.map(r => {
            r._parsed_date = parseDMY(r.date);
            r._month = r._parsed_date ? `${r._parsed_date.getFullYear()}-${pad2(r._parsed_date.getMonth()+1)}` : '';
            return r;
          });
          w.terminate();
          cb();
        } else {
          // fallback
          MERGED = (function(rows){
            const m = new Map();
            rows.forEach(r=>{
              const key = `${r.state}||${r.depot}||${r.date}||${r.sku_name}`;
              if(!m.has(key)) m.set(key, {...r});
              else {
                const g = m.get(key);
                g.opening += r.opening; g.qty_recd += r.qty_recd; g.qty_sale += r.qty_sale; g.closing += r.closing;
              }
            });
            return Array.from(m.values());
          })(RAW);
          MERGED.forEach(r=>{ r._parsed_date = parseDMY(r.date); r._month = r._parsed_date ? `${r._parsed_date.getFullYear()}-${pad2(r._parsed_date.getMonth()+1)}` : ''; });
          cb();
        }
      };
      w.postMessage({ rows: RAW });
    } catch (e) {
      // fallback sync
      MERGED = (function(rows){
        const m = new Map();
        rows.forEach(r=>{
          const key = `${r.state}||${r.depot}||${r.date}||${r.sku_name}`;
          if(!m.has(key)) m.set(key, {...r});
          else {
            const g = m.get(key);
            g.opening += r.opening; g.qty_recd += r.qty_recd; g.qty_sale += r.qty_sale; g.closing += r.closing;
          }
        });
        return Array.from(m.values());
      })(RAW);
      MERGED.forEach(r=>{ r._parsed_date = parseDMY(r.date); r._month = r._parsed_date ? `${r._parsed_date.getFullYear()}-${pad2(r._parsed_date.getMonth()+1)}` : ''; });
      cb();
    }
  }

  // Build ITEMS for normal (date-wise) or month summary
  function buildItemsNormal(){
    const rows = FILTERED.slice().sort((a,b)=> {
      if(a.state !== b.state) return a.state.localeCompare(b.state);
      if(a.depot !== b.depot) return a.depot.localeCompare(b.depot);
      const da = a._parsed_date? a._parsed_date.getTime():0;
      const db = b._parsed_date? b._parsed_date.getTime():0;
      if(da !== db) return da-db;
      return a.sku_name.localeCompare(b.sku_name);
    });
    const out = [];
    let i=0;
    while(i<rows.length){
      const ST = rows[i].state, DP = rows[i].depot;
      const block = []; let j=i;
      while(j<rows.length && rows[j].state===ST && rows[j].depot===DP){ block.push(rows[j]); j++; }
      let k=0;
      while(k<block.length){
        const dateVal = block[k].date;
        const group = []; let m=k;
        while(m<block.length && block[m].date === dateVal){ group.push(block[m]); m++; }
        group.forEach(r => out.push({ type:'row', data:r }));
        const sub = group.reduce((acc,r)=>{ acc.open += r.opening; acc.rec += r.qty_recd; acc.sale += r.qty_sale; acc.close += r.closing; return acc; }, {open:0,rec:0,sale:0,close:0});
        out.push({ type:'subtotal', data:{ labelDate: group[0]._parsed_date || group[0].date, sub } });
        k = m;
      }
      const depotAcc = block.reduce((acc,r)=>{ acc.open+=r.opening; acc.rec+=r.qty_recd; acc.sale+=r.qty_sale; acc.close+=r.closing; return acc; }, {open:0,rec:0,sale:0,close:0});
      out.push({ type:'depotTotal', data:depotAcc, depot:DP });
      // state total if end
      if(j>=rows.length || rows[j].state !== ST){
        const stateAcc = rows.filter(x=>x.state===ST).reduce((acc,r)=>{ acc.open+=r.opening; acc.rec+=r.qty_recd; acc.sale+=r.qty_sale; acc.close+=r.closing; return acc; }, {open:0,rec:0,sale:0,close:0});
        out.push({ type:'stateTotal', data: stateAcc, state: ST });
      }
      i = j;
    }
    const overall = out.reduce((acc,it)=>{ if(it.type === 'row'){ acc.open += it.data.opening; acc.rec += it.data.qty_recd; acc.sale += it.data.qty_sale; acc.close += it.data.closing; } else if(it.type==='subtotal'){ acc.open+=it.data.sub.open; acc.rec+=it.data.sub.rec; acc.sale+=it.data.sub.sale; acc.close+=it.data.sub.close; } else if(it.type==='depotTotal' || it.type==='stateTotal'){ acc.open+=it.data.open; acc.rec+=it.data.rec; acc.sale+=it.data.sale; acc.close+=it.data.close; } return acc; }, {open:0,rec:0,sale:0,close:0});
    out.push({ type:'overall', data: overall });
    return out;
  }

  function buildItemsMonth(){
    // group by state+depot+sku
    const map = new Map();
    FILTERED.forEach(r=>{
      const key = `${r.state}||${r.depot}||${r.sku_name}`;
      if(!map.has(key)) map.set(key, { state:r.state, depot:r.depot, sku_name:r.sku_name, openings:[{d:r._parsed_date,o:r.opening}], rec:r.qty_recd, sale:r.qty_sale });
      else { const g = map.get(key); if(r._parsed_date) g.openings.push({d:r._parsed_date,o:r.opening}); g.rec+=r.qty_recd; g.sale += r.qty_sale; }
    });
    const rows = Array.from(map.values()).map(g=>{
      const opens = g.openings.filter(x=>x.d).sort((a,b)=>a.d-b.d);
      const opening = opens.length ? opens[0].o : 0;
      const rec = g.rec || 0; const sale = g.sale || 0;
      const closing = opening + rec - sale;
      return { state:g.state, depot:g.depot, sku_name:g.sku_name, opening, qty_recd:rec, qty_sale:sale, closing };
    });
    rows.sort((a,b)=>{ if(a.state!==b.state) return a.state.localeCompare(b.state); if(a.depot!==b.depot) return a.depot.localeCompare(b.depot); return a.sku_name.localeCompare(b.sku_name); });
    const out = [];
    let i=0;
    while(i<rows.length){
      const ST = rows[i].state, DP = rows[i].depot;
      const block = []; let j=i;
      while(j<rows.length && rows[j].state===ST && rows[j].depot===DP){ block.push(rows[j]); j++; }
      block.forEach(r=> out.push({ type:'row', data:r }));
      const depotAcc = block.reduce((acc,t)=>{ acc.open+=t.opening; acc.rec+=t.qty_recd; acc.sale+=t.qty_sale; acc.close+=t.closing; return acc; }, {open:0,rec:0,sale:0,close:0});
      out.push({ type:'depotTotal', data:depotAcc, depot:DP });
      if(j>=rows.length || rows[j].state !== ST){
        const stateAcc = rows.filter(x=>x.state===ST).reduce((acc,t)=>{ acc.open+=t.opening; acc.rec+=t.qty_recd; acc.sale+=t.qty_sale; acc.close+=t.closing; return acc; }, {open:0,rec:0,sale:0,close:0});
        out.push({ type:'stateTotal', data:stateAcc, state:ST });
      }
      i = j;
    }
    const overall = out.reduce((acc,it)=>{ if(it.type==='row'){ acc.open += it.data.opening; acc.rec+=it.data.qty_recd; acc.sale+=it.data.qty_sale; acc.close+=it.data.closing; } else if(it.type==='depotTotal' || it.type==='stateTotal'){ acc.open+=it.data.open; acc.rec+=it.data.rec; acc.sale+=it.data.sale; acc.close+=it.data.close; } return acc; }, {open:0,rec:0,sale:0,close:0});
    out.push({ type:'overall', data: overall });
    return out;
  }

  // Virtualization: create pool
  function createPool(visCount, columns){
    // clear previous
    pool.forEach(n=> n.remove());
    pool = [];
    poolSize = Math.max(3, visCount + BUFFER*2);
    for(let i=0;i<poolSize;i++){
      const row = document.createElement('div'); row.className='f1-row';
      columns.forEach(col => {
        const cell = document.createElement('div');
        cell.className = 'f1-cell';
        cell.dataset.col = col.key;
        cell.style.width = (cfg.colWidths[col.key] || col.width) + 'px';
        if(col.frozen) cell.classList.add('f1-frozen');
        row.appendChild(cell);
      });
      body.appendChild(row);
      pool.push(row);
    }
  }

  // paint visible window
  function paintWindow(first){
    const total = ITEMS.length;
    for(let i=0;i<pool.length;i++){
      const idx = first + i;
      const row = pool[i];
      if(idx <0 || idx >= total){ row.style.display='none'; continue; }
      row.style.display='flex';
      row.style.top = (idx * ROW_H) + 'px';
      const it = ITEMS[idx];
      // fill cells
      const cells = Array.from(row.children);
      for(let c=0;c<cells.length;c++){
        const col = cfg.columns[c];
        const cell = cells[c];
        cell.classList.remove('f1-subtotal','f1-depot-total','f1-state-total','f1-overall-total');
        if(it.type === 'row'){
          const d = it.data;
          if(col.key === 'date') cell.textContent = d._parsed_date ? (d._parsed_date.getUTCDate().toString().padStart(2,'0') + '-' + (d._parsed_date.getUTCMonth()+1).toString().padStart(2,'0') + '-' + d._parsed_date.getUTCFullYear()) : d.date || '';
          else if(col.key === 'sku_name') { cell.textContent = d.sku_name || ''; cell.style.textAlign='left'; }
          else cell.textContent = (NUMERIC.includes(col.key) ? fmt(d[col.key]) : (d[col.key]||''));
        } else if(it.type === 'subtotal'){
          if(col.key === cfg.columns[0].key){ cell.textContent = `subtotal of Date (${ it.data.labelDate instanceof Date ? (it.data.labelDate.getUTCDate().toString().padStart(2,'0') + '-' + (it.data.labelDate.getUTCMonth()+1).toString().padStart(2,'0') + '-' + it.data.labelDate.getUTCFullYear()) : it.data.labelDate })`; cell.classList.add('f1-subtotal'); }
          else if(NUMERIC.includes(col.key)) { const v = ({opening:it.data.sub.open, qty_recd:it.data.sub.rec, qty_sale:it.data.sub.sale, closing:it.data.sub.close})[col.key]; cell.textContent = fmt(v); }
          else cell.textContent = '';
        } else if(it.type==='depotTotal' || it.type==='stateTotal' || it.type==='overall'){
          const css = it.type === 'depotTotal' ? 'f1-depot-total' : (it.type==='stateTotal' ? 'f1-state-total' : 'f1-overall-total');
          if(col.key === cfg.columns[0].key) { cell.textContent = it.type==='depotTotal' ? `GRAND TOTAL OF ${it.depot||''}` : (it.type==='stateTotal' ? `GRAND TOTAL OF ${it.state||''}` : 'OVERALL GRAND TOTAL'); cell.classList.add(css); }
          else if(NUMERIC.includes(col.key)) { cell.textContent = fmt(it.data[col.key === 'opening' ? 'open' : (col.key === 'qty_recd' ? 'rec' : (col.key === 'qty_sale' ? 'sale' : 'close')) ]); }
          else cell.textContent = '';
        }
      }
    }
  }

  function onScroll(){
    const first = Math.max(0, Math.floor(body.scrollTop / ROW_H) - BUFFER);
    paintWindow(first);
  }

  // public API
  return {
    init: function(options){
      // options: containerSelector, apiUrl, columns (array of {key,label,width,frozen}), colWidthsKey
      cfg = options;
      container = document.querySelector(cfg.container);
      if(!container) throw new Error('container not found: ' + cfg.container);
      headerRow = container.querySelector('.f1-table-head .f1-thead') || container.querySelector('.f1-table-head-inner') || (function(){ const el = document.createElement('div'); el.className='f1-thead'; container.querySelector('.f1-table-head').appendChild(el); return el; })();
      // prepare header area and body
      headerRow = container.querySelector('.f1-table-head-inner') || (function(){ const el = document.createElement('div'); el.className='f1-table-head-inner f1-thead'; container.querySelector('.f1-table-head').appendChild(el); return el; })();
      body = container.querySelector('.f1-body');
      if(!body){
        body = document.createElement('div'); body.className='f1-body'; container.appendChild(body);
      }
      // default colWidths
      cfg.colWidths = Object.assign({}, cfg.colWidths || {}, JSON.parse(localStorage.getItem(cfg.colWidthsKey || 'f1_col_widths') || '{}'));
      // build header
      buildHeader(cfg.columns, cfg.colWidths);
      initResize(cfg.colWidthsKey || 'f1_col_widths');
      // fetch and process data
      fetch(cfg.apiUrl).then(r=>r.json()).then(rows=>{
        RAW = rows.map(r => {
          const o = {};
          for(const k in r) o[String(k).trim().toLowerCase()] = r[k];
          o.opening = Number(o.opening)||0; o.qty_recd = Number(o.qty_recd)||0; o.qty_sale = Number(o.qty_sale)||0; o.closing = Number(o.closing)||0;
          o._parsed_date = parseDMY(o.date); o._month = o._parsed_date ? `${o._parsed_date.getFullYear()}-${pad2(o._parsed_date.getMonth()+1)}` : '';
          return o;
        });
        mergeRowsThen(()=>{
          // initial filters populate callback if provided
          if(typeof cfg.onReady === 'function') cfg.onReady({ merged: MERGED });
          // apply initial filter
          FILTERED = MERGED.slice();
          // decide mode and build items
          ITEMS = cfg.forceMonthMode ? buildItemsMonth() : buildItemsNormal();
          // setup pool
          body.innerHTML = ''; // clear
          // spacer
          const spacer = document.createElement('div'); spacer.style.height = (ITEMS.length * ROW_H) + 'px'; spacer.style.position='relative';
          body.appendChild(spacer);
          const visible = Math.max(3, Math.ceil(body.clientHeight / ROW_H));
          createPool(visible, cfg.columns);
          body.onscroll = onScroll;
          paintWindow(0);
        });
      }).catch(err => { console.error('F1 fetch error', err); if(cfg.onError) cfg.onError(err); });
    },
    refresh: function(){ if(cfg) this.init(cfg); },
    export: function(filename){
      if(typeof XLSX === 'undefined') { alert('XLSX missing'); return; }
      const hdr = cfg.columns.map(c=>c.label);
      const aoa = [hdr];
      ITEMS.forEach(it=>{
        if(it.type === 'row'){ const d = it.data; aoa.push(cfg.columns.map(c => { if(c.key==='date') return d._parsed_date ? (d._parsed_date.getUTCDate().toString().padStart(2,'0') + '-' + (d._parsed_date.getUTCMonth()+1).toString().padStart(2,'0') + '-' + d._parsed_date.getUTCFullYear()) : d.date || ''; if(NUMERIC.includes(c.key)) return d[c.key]; return d[c.key] || ''; })); }
        else if(it.type === 'subtotal'){ aoa.push(cfg.columns.map(c => c.key==='quantity' ? it.data.sub.total : (c.key === cfg.columns[0].key ? `Subtotal (${it.data.labelDate})` : ''))); }
        else if(it.type === 'depotTotal' || it.type==='stateTotal' || it.type==='overall'){ aoa.push(cfg.columns.map(c => { if(c.key===cfg.columns[0].key) return it.type==='depotTotal' ? `GRAND TOTAL OF ${it.depot||''}` : (it.type==='stateTotal' ? `GRAND TOTAL OF ${it.state||''}` : 'OVERALL GRAND TOTAL'); if(NUMERIC.includes(c.key)) return it.data[c.key==='opening' ? 'open' : (c.key==='qty_recd' ? 'rec' : (c.key==='qty_sale' ? 'sale' : 'close'))]; return ''; })); }
      });
      const wb = XLSX.utils.book_new(); const ws = XLSX.utils.aoa_to_sheet(aoa); XLSX.utils.book_append_sheet(wb, ws, 'Export'); XLSX.writeFile(wb, filename || `export_${new Date().toISOString().slice(0,10)}.xlsx`);
    }
  };
})();
