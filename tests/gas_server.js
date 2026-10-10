// 在本機模擬 Google Apps Script 網頁應用程式：載入 apps-script/Code.gs，試算表放在記憶體裡。
// 與真的 Apps Script 一樣：doGet/doPost 回 302，轉址到另一個網址才拿到內容。
// 用法：node tests/gas_server.js [port]　　管理用：GET /admin?fn=setup、GET /admin/dump
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), http = require('http');

function makeSheet(name, ss) {
  const rows = [];
  const sh = {
    name, rows, charts: [],
    getName: () => name, getParent: () => ss,
    getLastRow: () => { let n = rows.length; while (n && !(rows[n - 1] || []).some(v => v !== '' && v !== undefined)) n--; return n; },
    getMaxRows: () => 1000, setFrozenRows() {}, setColumnWidth() {}, clear() { rows.length = 0; },
    getCharts() { return this.charts.slice(); }, removeChart(c) { this.charts = this.charts.filter(x => x !== c); }, insertChart(c) { this.charts.push(c); },
    newChart() { const spec = { opts: {} }; const b = { setChartType(t) { spec.type = t; return b; }, addRange(r) { spec.range = r; return b; }, setNumHeaders() { return b; }, setPosition(r, c) { spec.pos = [r, c]; return b; }, setOption(k, v) { spec.opts[k] = v; return b; }, build() { return spec; } }; return b; },
    getRange(r, c, nr = 1, nc = 1) {
      if (typeof r === 'string') return { a1: r };
      const range = {
        getSheet: () => sh, getColumn: () => c, getLastColumn: () => c + nc - 1,
        setValues(v) { for (let i = 0; i < nr; i++) { rows[r - 1 + i] = rows[r - 1 + i] || []; for (let j = 0; j < nc; j++) rows[r - 1 + i][c - 1 + j] = v[i][j]; } return range; },
        getValues() { const out = []; for (let i = 0; i < nr; i++) { const row = []; for (let j = 0; j < nc; j++) row.push((rows[r - 1 + i] || [])[c - 1 + j] ?? ''); out.push(row); } return out; },
        setFormula(f) { rows[r - 1] = rows[r - 1] || []; rows[r - 1][c - 1] = f; return range; },
        setValue(v) { rows[r - 1] = rows[r - 1] || []; rows[r - 1][c - 1] = v; return range; },
        setFontWeight() { return range; }, setFontSize() { return range; }, setDataValidation() { return range; }
      };
      return range;
    },
    appendRow(r) { rows[sh.getLastRow()] = r.slice(); }
  };
  return sh;
}

function createRuntime() {
  const sheets = {}, order = [];
  const ss = {
    getSheetByName: n => sheets[n] || null,
    setSpreadsheetTimeZone: tz => { ss.timeZone = tz; },
    insertSheet: (n, i) => { sheets[n] = makeSheet(n, ss); i === undefined ? order.push(n) : order.splice(i, 0, n); return sheets[n]; }
  };
  const props = {}, cache = {};
  const ctx = {
    Charts: { ChartType: { BAR: 'BAR', PIE: 'PIE' } },
    SpreadsheetApp: { getActive: () => ss, newDataValidation: () => ({ requireValueInList() { return this; }, setAllowInvalid() { return this; }, build() { return {}; } }), getUi: () => ({ createMenu: () => ({ addItem() { return this; }, addToUi() {} }) }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => { props[k] = v; } }) },
    CacheService: { getScriptCache: () => ({ get: k => cache[k] || null, put: (k, v) => { cache[k] = v; } }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: { getUuid: () => require('crypto').randomUUID(), formatDate: d => d.toISOString() },
    ContentService: { createTextOutput: t => ({ t, mime: 'json', getContent() { return this.t; }, setMimeType(m) { this.mime = m; return this; } }), MimeType: { JSON: 'json', CSV: 'csv' } },
    Logger: { log: () => {} }, console
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8'), ctx);
  return { ctx, sheets, order, props, ss };
}

function serve(port, rt = createRuntime()) {
  const outputs = new Map(); let n = 0;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    const redirect = out => { const k = String(++n); outputs.set(k, out); res.writeHead(302, { Location: `http://127.0.0.1:${port}/echo?k=${k}` }); res.end(); };
    if (url.pathname.endsWith('/exec') && req.method === 'POST') {
      let body = ''; req.on('data', c => { body += c; });
      req.on('end', () => redirect(rt.ctx.doPost({ postData: { contents: body } })));
      return;
    }
    if (url.pathname.endsWith('/exec')) return redirect(rt.ctx.doGet({ parameter: Object.fromEntries(url.searchParams) }));
    if (url.pathname === '/echo') {
      const out = outputs.get(url.searchParams.get('k'));
      res.writeHead(out ? 200 : 404, { 'Content-Type': out && out.mime === 'csv' ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
      return res.end(out ? out.t : '');
    }
    if (url.pathname === '/admin') { rt.ctx[url.searchParams.get('fn')](); res.writeHead(200); return res.end('ok'); }
    if (url.pathname === '/admin/dump') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ order: rt.order, timeZone: rt.ss.timeZone, token: rt.props.READ_TOKEN, sheets: Object.fromEntries(Object.entries(rt.sheets).map(([k, v]) => [k, { rows: v.rows, charts: v.charts.length }])) }));
    }
    res.writeHead(404); res.end();
  });
  return new Promise(r => server.listen(port, '127.0.0.1', () => r({ server, rt })));
}

module.exports = { createRuntime, serve };
if (require.main === module) serve(Number(process.argv[2] || 8790)).then(() => console.log('gas mock ready'));
