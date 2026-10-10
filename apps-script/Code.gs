/**
 * 婚禮小冊・長輩意見收件（Google Apps Script，綁定在一份 Google 試算表上）
 *
 * - doPost：網頁「送出給新人」把意見寫進兩張工作表。
 *     「意見送出紀錄」：一次送出一列。
 *     「意見明細」：一則意見一列，最後兩欄「處理狀態／處理說明」給新人或 Codex 填。
 * - doGet：Codex 讀取（需要 token）。?token=…&view=opinions|submissions&format=json|csv&status=待處理&since=2026-10-01
 * - doPost action=mark：Codex 回寫處理狀態（需要 token）。
 *
 * 安裝步驟見 apps-script/README.md。程式只寫入本試算表，不寄信、不讀其他檔案。
 */

var SHEET_SUBMISSIONS = '意見送出紀錄';
var SHEET_OPINIONS = '意見明細';
var SHEET_SUMMARY = '意見整理';
var SHEET_CHARTS = '圖表';
var SHEET_AGENDA = '會議議程';
var SUB_HEADERS = ['送出時間', '送出編號', '稱呼', '頁面版本', '意見則數', '其他想說的話', '原本合計', '照意見合計', '檢視連結', '原始資料'];
var OP_HEADERS = ['送出時間', '送出編號', '意見編號', '稱呼', '頁面版本', '場合代碼', '場合', '類型', '項目代碼', '項目名稱', '看法代碼', '看法', '原本金額', '建議金額', '由誰負擔', '文字', '處理狀態', '處理說明'];
var STATUS = ['待處理', '採納', '部分採納', '不採納', '已回覆'];
var KIND_LABEL = { bok: '其他花費都沒意見', date: '日期', sched: '當天行程', prep: '準備清單', budget: '預算', add: '新增花費', compare: '方案傾向', q: '一起商量' };
var MAX_BODY = 60000;
var MAX_OPINIONS = 80;
var MAX_PER_MINUTE = 30;

/** 第一次安裝時手動執行一次：建立工作表、產生讀取用 token。 */
function setup() {
  var ss = SpreadsheetApp.getActive();
  ss.setSpreadsheetTimeZone('Asia/Taipei'); // 新試算表預設美國時區，送出時間會差 15 小時
  ensureSheet_(ss, SHEET_SUBMISSIONS, SUB_HEADERS);
  var op = ensureSheet_(ss, SHEET_OPINIONS, OP_HEADERS);
  var rule = SpreadsheetApp.newDataValidation().requireValueInList(STATUS, true).setAllowInvalid(false).build();
  op.getRange(2, OP_HEADERS.indexOf('處理狀態') + 1, op.getMaxRows() - 1, 1).setDataValidation(rule);
  buildSummary_(ss);
  buildCharts_(ss);
  buildAgenda_(ss);
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('READ_TOKEN')) props.setProperty('READ_TOKEN', Utilities.getUuid().replace(/-/g, ''));
  Logger.log('讀取用 token（給 Codex）：' + props.getProperty('READ_TOKEN'));
}

function doPost(e) {
  try {
    var body = e && e.postData && e.postData.contents || '';
    if (!body || body.length > MAX_BODY) return json_({ ok: false, error: 'too_large' });
    var data = JSON.parse(body);
    if (data && data.action === 'mark') return mark_(data);
    return receive_(data);
  } catch (err) {
    return json_({ ok: false, error: 'bad_request' });
  }
}

function receive_(d) {
  if (!d || d.v !== 1 || !Array.isArray(d.opinions)) return json_({ ok: false, error: 'bad_payload' });
  if (d.hp) return json_({ ok: true, id: '', count: 0 }); // 防機器人欄位被填：假裝成功，不寫入
  var id = str_(d.id, 40);
  if (!/^[a-z0-9]{6,40}$/.test(id)) return json_({ ok: false, error: 'bad_id' });
  var opinions = d.opinions.slice(0, MAX_OPINIONS);
  if (!opinions.length && !str_(d.message, 2000).trim()) return json_({ ok: false, error: 'empty' });

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var cache = CacheService.getScriptCache();
    if (cache.get('sub:' + id) || alreadySaved_(id)) return json_({ ok: true, id: id, count: opinions.length, duplicate: true });
    var minuteKey = 'rate:' + Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyyMMddHHmm');
    var n = Number(cache.get(minuteKey) || 0);
    if (n >= MAX_PER_MINUTE) return json_({ ok: false, error: 'busy' });
    cache.put(minuteKey, String(n + 1), 120);

    var ss = SpreadsheetApp.getActive();
    var subSheet = ensureSheet_(ss, SHEET_SUBMISSIONS, SUB_HEADERS);
    var opSheet = ensureSheet_(ss, SHEET_OPINIONS, OP_HEADERS);
    var now = new Date();
    var name = str_(d.name, 40);
    var version = str_(d.version, 60);
    subSheet.appendRow([now, id, safe_(name), safe_(version), opinions.length, safe_(str_(d.message, 2000)), num_(d.before), num_(d.after), safe_(str_(d.url, 8000)), safe_(JSON.stringify(d.raw || {}).slice(0, 40000))]);
    var rows = opinions.map(function (o, i) {
      return [now, id, id + '-' + (i + 1), safe_(name), safe_(version), safe_(str_(o.phaseId, 30)), safe_(str_(o.phaseLabel, 30)),
        KIND_LABEL[o.kind] || safe_(str_(o.kind, 20)), safe_(str_(o.targetId, 60)), safe_(str_(o.targetName, 200)),
        safe_(str_(o.choice, 30)), safe_(str_(o.choiceLabel, 60)), num_(o.baseAmount), num_(o.amount), safe_(str_(o.who, 40)),
        safe_(str_(o.text, 500)), '待處理', ''];
    });
    if (rows.length) {
      var start = opSheet.getLastRow() + 1;
      opSheet.getRange(start, 1, rows.length, OP_HEADERS.length).setValues(rows);
      var rule = SpreadsheetApp.newDataValidation().requireValueInList(STATUS, true).setAllowInvalid(false).build();
      opSheet.getRange(start, OP_HEADERS.indexOf('處理狀態') + 1, rows.length, 1).setDataValidation(rule);
    }
    cache.put('sub:' + id, '1', 21600);
    buildAgenda_(ss);
    return json_({ ok: true, id: id, count: rows.length });
  } finally {
    lock.releaseLock();
  }
}

/** Codex 回寫：{action:'mark', token, opinionId, status, note} */
function mark_(d) {
  if (!tokenOk_(d.token)) return json_({ ok: false, error: 'forbidden' });
  if (STATUS.indexOf(d.status) < 0) return json_({ ok: false, error: 'bad_status' });
  var sheet = ensureSheet_(SpreadsheetApp.getActive(), SHEET_OPINIONS, OP_HEADERS);
  var last = sheet.getLastRow();
  if (last < 2) return json_({ ok: false, error: 'not_found' });
  var ids = sheet.getRange(2, 3, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (ids[i][0] === d.opinionId) {
      sheet.getRange(i + 2, OP_HEADERS.indexOf('處理狀態') + 1, 1, 2).setValues([[d.status, safe_(str_(d.note, 1000))]]);
      buildAgenda_(SpreadsheetApp.getActive());
      return json_({ ok: true });
    }
  }
  return json_({ ok: false, error: 'not_found' });
}

function doGet(e) {
  var p = e && e.parameter || {};
  if (p.ping) return json_({ ok: true, service: 'alive-feedback', v: 1 }); // 連線檢查，不回傳任何資料
  if (!tokenOk_(p.token)) return json_({ ok: false, error: 'forbidden' });
  var view = p.view === 'submissions' ? SHEET_SUBMISSIONS : SHEET_OPINIONS;
  var headers = view === SHEET_SUBMISSIONS ? SUB_HEADERS : OP_HEADERS;
  var sheet = ensureSheet_(SpreadsheetApp.getActive(), view, headers);
  var last = sheet.getLastRow();
  var values = last > 1 ? sheet.getRange(2, 1, last - 1, headers.length).getValues() : [];
  var since = p.since ? new Date(p.since) : null;
  var rows = values.filter(function (r) {
    if (since && !(r[0] instanceof Date && r[0] >= since)) return false;
    if (p.status && view === SHEET_OPINIONS && r[headers.indexOf('處理狀態')] !== p.status) return false;
    return true;
  }).map(function (r) {
    return r.map(function (v) { return v instanceof Date ? Utilities.formatDate(v, 'Asia/Taipei', "yyyy-MM-dd'T'HH:mm:ssXXX") : v; });
  });
  if (p.format === 'csv') {
    var csv = [headers].concat(rows).map(function (r) { return r.map(csvCell_).join(','); }).join('\r\n');
    return ContentService.createTextOutput(csv).setMimeType(ContentService.MimeType.CSV);
  }
  return json_({ ok: true, view: view, headers: headers, rows: rows.map(function (r) {
    var o = {}; headers.forEach(function (h, i) { o[h] = r[i]; }); return o;
  }) });
}

/** 安裝後手動執行一次：寫入一筆測試意見，並標成「已回覆」，確認整條流程可用（可直接刪除那幾列）。 */
function testSubmit() {
  var id = 'test' + Utilities.getUuid().replace(/-/g, '').slice(0, 12);
  var res = JSON.parse(receive_({ v: 1, id: id, name: '安裝測試', version: 'test', message: '這是安裝測試，可以刪除', before: 0, after: 0, url: '', raw: {}, hp: '',
    opinions: [{ phaseId: 'test', phaseLabel: '測試', kind: 'q', targetId: 'q:test', targetName: '安裝測試', choiceLabel: '回答', text: '看到這列代表收件正常' }] }).getContent());
  if (res.ok) mark_({ token: PropertiesService.getScriptProperties().getProperty('READ_TOKEN'), opinionId: id + '-1', status: '已回覆', note: '安裝測試，可刪除' });
  Logger.log(JSON.stringify(res));
}

/** 「意見整理」工作表：全部用公式，意見明細一更新就跟著變。 */
function buildSummary_(ss) {
  var sh = ss.getSheetByName(SHEET_SUMMARY) || ss.insertSheet(SHEET_SUMMARY, 0);
  sh.clear();
  SUMMARY.forEach(function (row, i) {
    row.forEach(function (v, j) {
      if (v === '') return;
      var cell = sh.getRange(i + 1, j + 1);
      if (String(v).charAt(0) === '=') cell.setFormula(v); else cell.setValue(v);
    });
  });
  SUMMARY_TITLES.forEach(function (r) { sh.getRange(r, 1).setFontWeight('bold').setFontSize(12); });
  sh.setColumnWidth(1, 220);
}

/** 選單：打開試算表時出現「婚禮小冊」選單。 */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('婚禮小冊')
    .addItem('更新會議議程', 'refreshAgenda')
    .addItem('重建意見整理與圖表', 'setup')
    .addToUi();
}
function refreshAgenda() { buildAgenda_(SpreadsheetApp.getActive()); }

/** 在「意見明細」改處理狀態時，自動更新會議議程。 */
function onEdit(e) {
  if (!e || !e.range) return;
  var sh = e.range.getSheet();
  if (sh.getName() !== SHEET_OPINIONS) return;
  var col = OP_HEADERS.indexOf('處理狀態') + 1;
  if (e.range.getColumn() <= col && e.range.getLastColumn() >= col) buildAgenda_(sh.getParent());
}

/**
 * 「會議議程」：只看「待處理」；同一項目 2 則以上，依看法分歧程度排序，取前三項。
 * 分歧程度 = 1 −（最多人選的看法則數 ÷ 總則數）。討論題以回答文字比較。
 * 規則與 feedback_digest.py 的 agenda() 相同。
 */
function agendaGroups_(rows) {
  var H = OP_HEADERS, idx = function (h) { return H.indexOf(h); };
  var groups = {}, order = [];
  rows.forEach(function (r) {
    if (r[idx('處理狀態')] !== '待處理' || r[idx('類型')] === KIND_LABEL.bok) return;
    var key = [r[idx('場合')], r[idx('類型')], r[idx('項目代碼')], r[idx('項目名稱')]].join('\u0001');
    if (!groups[key]) { groups[key] = { phase: r[idx('場合')], kind: r[idx('類型')], name: r[idx('項目名稱')], items: [] }; order.push(key); }
    groups[key].items.push(r);
  });
  return order.map(function (k) {
    var g = groups[k], counts = {}, people = {};
    g.items.forEach(function (r) {
      var view = g.kind === KIND_LABEL.q ? String(r[idx('文字')] || '').trim() : (r[idx('看法')] || '（只寫文字）');
      counts[view] = (counts[view] || 0) + 1;
      people[r[idx('稱呼')] || '（未留名）'] = 1;
    });
    var views = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; });
    var max = views.length ? counts[views[0]] : 0;
    var amounts = g.items.map(function (r) { return Number(r[idx('建議金額')]); }).filter(function (n) { return n > 0; });
    var quotes = g.items.filter(function (r) { return String(r[idx('文字')] || '').trim(); })
      .map(function (r) { return (r[idx('稱呼')] || '（未留名）') + '：' + String(r[idx('文字')]).trim(); });
    return {
      phase: g.phase, kind: g.kind, name: g.name, total: g.items.length, people: Object.keys(people).length,
      divergence: g.items.length ? 1 - max / g.items.length : 0,
      views: views.map(function (v) { return v + ' ×' + counts[v]; }).join('、'),
      amounts: amounts.length ? (Math.min.apply(null, amounts) === Math.max.apply(null, amounts) ? wanText_(amounts[0]) : wanText_(Math.min.apply(null, amounts)) + '–' + wanText_(Math.max.apply(null, amounts))) : '',
      quotes: quotes.slice(0, 3).join('\n'),
      ids: g.items.map(function (r) { return r[idx('意見編號')]; }).join(' ')
    };
  });
}
function agendaRank_(groups) {
  return groups.filter(function (g) { return g.total >= 2; }).sort(function (a, b) {
    var ka = a.phase + a.name, kb = b.phase + b.name;
    return (b.divergence - a.divergence) || (b.total - a.total) || (b.people - a.people) || (ka < kb ? -1 : ka > kb ? 1 : 0);
  });
}
function divergenceLabel_(d) { return d >= 0.5 ? '意見分歧大' : d > 0 ? '有不同意見' : '看法一致'; }
function wanText_(n) { return n >= 10000 ? (Math.round(n / 100) / 100) + ' 萬' : n + ' 元'; }

function buildAgenda_(ss) {
  var sh = ss.getSheetByName(SHEET_AGENDA) || ss.insertSheet(SHEET_AGENDA, 0);
  var op = ensureSheet_(ss, SHEET_OPINIONS, OP_HEADERS);
  var last = op.getLastRow();
  var rows = last > 1 ? op.getRange(2, 1, last - 1, OP_HEADERS.length).getValues() : [];
  var groups = agendaGroups_(rows);
  var ranked = agendaRank_(groups);
  var top = ranked.slice(0, 3);
  var rest = groups.filter(function (g) { return top.indexOf(g) < 0; });
  var out = [];
  out.push(['這次家庭會議要決定的事', '', '', '', '', '', '', '', '', '']);
  out.push(['自動產生：' + Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd HH:mm') + '。只看「待處理」的意見；同一項目 2 則以上，依看法分歧程度排序。會議決定後，到「意見明細」改處理狀態，這一頁會自動更新。', '', '', '', '', '', '', '', '', '']);
  out.push(['', '', '', '', '', '', '', '', '', '']);
  out.push(['順序', '場合', '項目', '則數', '人數', '分歧程度', '看法分布', '建議金額', '長輩原話', '意見編號']);
  if (!top.length) out.push(['', '目前沒有 2 則以上的待處理意見，不需要排議程。', '', '', '', '', '', '', '', '']);
  top.forEach(function (g, i) {
    out.push([i + 1, g.phase, g.name, g.total, g.people, divergenceLabel_(g.divergence), g.views, g.amounts, g.quotes, g.ids]);
  });
  out.push(['', '', '', '', '', '', '', '', '', '']);
  out.push(['其他待處理（還沒排進議程）', '', '', '', '', '', '', '', '', '']);
  out.push(['', '場合', '項目', '則數', '人數', '分歧程度', '看法分布', '建議金額', '長輩原話', '意見編號']);
  if (!rest.length) out.push(['', '（沒有）', '', '', '', '', '', '', '', '']);
  rest.forEach(function (g) {
    out.push(['', g.phase, g.name, g.total, g.people, divergenceLabel_(g.divergence), g.views, g.amounts, g.quotes, g.ids]);
  });
  sh.clear();
  sh.getRange(1, 1, out.length, 10).setValues(out.map(function (r) { return r.map(function (v) { return typeof v === 'string' ? safe_(v) : v; }); }));
  sh.getRange(1, 1).setFontWeight('bold').setFontSize(16);
  sh.getRange(4, 1, 1, 10).setFontWeight('bold');
  sh.getRange(5 + Math.max(top.length, 1) + 1, 1, 2, 10).setFontWeight('bold');
  sh.setColumnWidth(3, 180); sh.setColumnWidth(7, 220); sh.setColumnWidth(9, 280);
}

/** 「圖表」工作表：A–F 欄放公式整理的資料，右邊畫三張圖（可投影）。每次 setup 會重建。 */
function buildCharts_(ss) {
  var sh = ss.getSheetByName(SHEET_CHARTS) || ss.insertSheet(SHEET_CHARTS, 1);
  sh.getCharts().forEach(function (c) { sh.removeChart(c); });
  sh.clear();
  CHART_DATA.forEach(function (entry) {
    var row = entry[0];
    entry[1].forEach(function (v, j) {
      if (v === '') return; // 留空，讓 UNIQUE 能往下展開
      var cell = sh.getRange(row, j + 1);
      if (String(v).charAt(0) === '=') cell.setFormula(v); else cell.setValue(v);
    });
  });
  sh.getRange(1, 1).setFontWeight('bold').setFontSize(16);
  [4, 33, 43].forEach(function (r) { sh.getRange(r, 1, 1, 6).setFontWeight('bold'); });
  sh.setColumnWidth(1, 200);
  CHARTS.forEach(function (c) {
    var builder = sh.newChart()
      .setChartType(c.type === 'PIE' ? Charts.ChartType.PIE : Charts.ChartType.BAR)
      .addRange(sh.getRange(c.range))
      .setNumHeaders(1)
      .setPosition(c.row, c.col, 0, 0)
      .setOption('title', c.title)
      .setOption('colors', c.colors)
      .setOption('width', 760)
      .setOption('height', 420)
      .setOption('legend', { position: c.type === 'PIE' ? 'right' : 'top' });
    if (c.stacked) builder = builder.setOption('isStacked', true);
    sh.insertChart(builder.build());
  });
}

// ---------- 工具 ----------
function ensureSheet_(ss, name, headers) {
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}
function alreadySaved_(id) {
  var sh = SpreadsheetApp.getActive().getSheetByName(SHEET_SUBMISSIONS);
  if (!sh || sh.getLastRow() < 2) return false;
  var from = Math.max(2, sh.getLastRow() - 199);
  var ids = sh.getRange(from, 2, sh.getLastRow() - from + 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) if (ids[i][0] === id) return true;
  return false;
}
function tokenOk_(t) {
  var real = PropertiesService.getScriptProperties().getProperty('READ_TOKEN');
  return !!real && typeof t === 'string' && t === real;
}
function str_(v, max) { return typeof v === 'string' ? v.slice(0, max) : (typeof v === 'number' ? String(v) : ''); }
function num_(v) { var n = Number(v); return v === '' || v === null || v === undefined || !isFinite(n) ? '' : Math.round(n); }
/** 避免以 = + - @ 開頭的文字被試算表當成公式執行 */
function safe_(s) { return /^[=+\-@\t\r]/.test(s) ? "'" + s : s; }
function csvCell_(v) { var s = String(v === null || v === undefined ? '' : v); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

// ---- 由 build_template.py 產生，請勿手動修改 ----
var SUMMARY = [["婚禮小冊・長輩意見整理", ""], ["這一頁全部是公式，「意見明細」有新資料就會自動更新，請不要在這一頁打字。要標記處理結果，請到「意見明細」最後兩欄。", ""], ["", ""], ["總覽", ""], ["送出次數", "=MAX(0,COUNTA('意見送出紀錄'!B:B)-1)"], ["意見則數", "=MAX(0,COUNTA('意見明細'!C:C)-1)"], ["留意見的人數", "=MAX(0,COUNTUNIQUE('意見明細'!D:D)-1)"], ["待處理", "=COUNTIF('意見明細'!Q:Q,\"待處理\")"], ["已採納（含部分採納）", "=COUNTIF('意見明細'!Q:Q,\"採納\")+COUNTIF('意見明細'!Q:Q,\"部分採納\")"], ["不採納", "=COUNTIF('意見明細'!Q:Q,\"不採納\")"], ["最近一次送出", "=IF(COUNTA('意見送出紀錄'!A:A)<2,\"（還沒有）\",TEXT(MAX('意見送出紀錄'!A:A),\"yyyy-mm-dd hh:mm\"))"], ["", ""], ["預算：每一筆花費的看法（則數）", ""], ["=IFERROR(QUERY('意見明細'!A:R,\"select J, count(C) where H = '預算' group by J pivot L label J '項目'\",1),\"（還沒有資料）\")", ""], ["", ""], ["", ""], ["", ""], ["", ""], ["", ""], ["", ""], ["", ""], ["", ""], ["", ""], ["", ""], ["", ""], ["", ""], ["", ""], ["", ""], ["", ""], ["", ""], ["", ""], ["", ""], ["", ""], ["", ""], ["", ""], ["", ""], ["", ""], ["", ""], ["", ""], ["日期：每一場的看法（則數）", ""], ["=IFERROR(QUERY('意見明細'!A:R,\"select G, count(C) where H = '日期' group by G pivot L label G '場合'\",1),\"（還沒有資料）\")", ""], ["", ""], ["", ""], ["", ""], ["", ""], ["", ""], ["", ""], ["", ""], ["", ""], ["午宴／晚宴：比較傾向（則數）", ""], ["=IFERROR(QUERY('意見明細'!A:R,\"select L, count(C) where H = '方案傾向' group by L label L '方案', count(C) '則數'\",1),\"（還沒有資料）\")", ""], ["", ""], ["", ""], ["", ""], ["", ""], ["", ""], ["", ""], ["依類型（則數）", ""], ["=IFERROR(QUERY('意見明細'!A:R,\"select H, count(C) where H <> '' group by H order by count(C) desc label H '類型', count(C) '則數'\",1),\"（還沒有資料）\")", ""], ["", ""], ["", ""], ["", ""], ["", ""], ["", ""], ["", ""], ["", ""], ["", ""], ["", ""], ["", ""], ["", ""], ["", ""], ["待處理清單（最新在上）", ""], ["=IFERROR(QUERY('意見明細'!A:R,\"select A, D, G, J, L, N, P where Q = '待處理' order by A desc label A '送出時間', D '稱呼', G '場合', J '項目', L '看法', N '建議金額', P '文字' format A 'yyyy-mm-dd hh:mm'\",1),\"（目前沒有待處理的意見）\")", ""]];
var SUMMARY_TITLES = [1, 4, 13, 40, 50, 58, 72];
var CHART_DATA = [[1, ["婚禮小冊・意見圖表"]], [2, ["家庭會議可以直接投影這一頁。左邊 A–F 欄是圖表用的資料（自動計算），請不要修改。"]], [4, ["項目", "太多，可以少一點", "不太夠，要多一點", "金額剛好", "這項可以不用", "想改由誰負擔"]], [5, ["=IFERROR(UNIQUE(FILTER('意見明細'!J:J,'意見明細'!H:H=\"預算\")),)", "=IF($A5=\"\",,COUNTIFS('意見明細'!$J:$J,$A5,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,B$4))", "=IF($A5=\"\",,COUNTIFS('意見明細'!$J:$J,$A5,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,C$4))", "=IF($A5=\"\",,COUNTIFS('意見明細'!$J:$J,$A5,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,D$4))", "=IF($A5=\"\",,COUNTIFS('意見明細'!$J:$J,$A5,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,E$4))", "=IF($A5=\"\",,COUNTIFS('意見明細'!$J:$J,$A5,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,F$4))"]], [6, ["", "=IF($A6=\"\",,COUNTIFS('意見明細'!$J:$J,$A6,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,B$4))", "=IF($A6=\"\",,COUNTIFS('意見明細'!$J:$J,$A6,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,C$4))", "=IF($A6=\"\",,COUNTIFS('意見明細'!$J:$J,$A6,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,D$4))", "=IF($A6=\"\",,COUNTIFS('意見明細'!$J:$J,$A6,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,E$4))", "=IF($A6=\"\",,COUNTIFS('意見明細'!$J:$J,$A6,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,F$4))"]], [7, ["", "=IF($A7=\"\",,COUNTIFS('意見明細'!$J:$J,$A7,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,B$4))", "=IF($A7=\"\",,COUNTIFS('意見明細'!$J:$J,$A7,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,C$4))", "=IF($A7=\"\",,COUNTIFS('意見明細'!$J:$J,$A7,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,D$4))", "=IF($A7=\"\",,COUNTIFS('意見明細'!$J:$J,$A7,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,E$4))", "=IF($A7=\"\",,COUNTIFS('意見明細'!$J:$J,$A7,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,F$4))"]], [8, ["", "=IF($A8=\"\",,COUNTIFS('意見明細'!$J:$J,$A8,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,B$4))", "=IF($A8=\"\",,COUNTIFS('意見明細'!$J:$J,$A8,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,C$4))", "=IF($A8=\"\",,COUNTIFS('意見明細'!$J:$J,$A8,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,D$4))", "=IF($A8=\"\",,COUNTIFS('意見明細'!$J:$J,$A8,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,E$4))", "=IF($A8=\"\",,COUNTIFS('意見明細'!$J:$J,$A8,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,F$4))"]], [9, ["", "=IF($A9=\"\",,COUNTIFS('意見明細'!$J:$J,$A9,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,B$4))", "=IF($A9=\"\",,COUNTIFS('意見明細'!$J:$J,$A9,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,C$4))", "=IF($A9=\"\",,COUNTIFS('意見明細'!$J:$J,$A9,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,D$4))", "=IF($A9=\"\",,COUNTIFS('意見明細'!$J:$J,$A9,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,E$4))", "=IF($A9=\"\",,COUNTIFS('意見明細'!$J:$J,$A9,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,F$4))"]], [10, ["", "=IF($A10=\"\",,COUNTIFS('意見明細'!$J:$J,$A10,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,B$4))", "=IF($A10=\"\",,COUNTIFS('意見明細'!$J:$J,$A10,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,C$4))", "=IF($A10=\"\",,COUNTIFS('意見明細'!$J:$J,$A10,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,D$4))", "=IF($A10=\"\",,COUNTIFS('意見明細'!$J:$J,$A10,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,E$4))", "=IF($A10=\"\",,COUNTIFS('意見明細'!$J:$J,$A10,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,F$4))"]], [11, ["", "=IF($A11=\"\",,COUNTIFS('意見明細'!$J:$J,$A11,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,B$4))", "=IF($A11=\"\",,COUNTIFS('意見明細'!$J:$J,$A11,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,C$4))", "=IF($A11=\"\",,COUNTIFS('意見明細'!$J:$J,$A11,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,D$4))", "=IF($A11=\"\",,COUNTIFS('意見明細'!$J:$J,$A11,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,E$4))", "=IF($A11=\"\",,COUNTIFS('意見明細'!$J:$J,$A11,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,F$4))"]], [12, ["", "=IF($A12=\"\",,COUNTIFS('意見明細'!$J:$J,$A12,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,B$4))", "=IF($A12=\"\",,COUNTIFS('意見明細'!$J:$J,$A12,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,C$4))", "=IF($A12=\"\",,COUNTIFS('意見明細'!$J:$J,$A12,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,D$4))", "=IF($A12=\"\",,COUNTIFS('意見明細'!$J:$J,$A12,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,E$4))", "=IF($A12=\"\",,COUNTIFS('意見明細'!$J:$J,$A12,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,F$4))"]], [13, ["", "=IF($A13=\"\",,COUNTIFS('意見明細'!$J:$J,$A13,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,B$4))", "=IF($A13=\"\",,COUNTIFS('意見明細'!$J:$J,$A13,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,C$4))", "=IF($A13=\"\",,COUNTIFS('意見明細'!$J:$J,$A13,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,D$4))", "=IF($A13=\"\",,COUNTIFS('意見明細'!$J:$J,$A13,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,E$4))", "=IF($A13=\"\",,COUNTIFS('意見明細'!$J:$J,$A13,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,F$4))"]], [14, ["", "=IF($A14=\"\",,COUNTIFS('意見明細'!$J:$J,$A14,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,B$4))", "=IF($A14=\"\",,COUNTIFS('意見明細'!$J:$J,$A14,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,C$4))", "=IF($A14=\"\",,COUNTIFS('意見明細'!$J:$J,$A14,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,D$4))", "=IF($A14=\"\",,COUNTIFS('意見明細'!$J:$J,$A14,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,E$4))", "=IF($A14=\"\",,COUNTIFS('意見明細'!$J:$J,$A14,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,F$4))"]], [15, ["", "=IF($A15=\"\",,COUNTIFS('意見明細'!$J:$J,$A15,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,B$4))", "=IF($A15=\"\",,COUNTIFS('意見明細'!$J:$J,$A15,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,C$4))", "=IF($A15=\"\",,COUNTIFS('意見明細'!$J:$J,$A15,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,D$4))", "=IF($A15=\"\",,COUNTIFS('意見明細'!$J:$J,$A15,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,E$4))", "=IF($A15=\"\",,COUNTIFS('意見明細'!$J:$J,$A15,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,F$4))"]], [16, ["", "=IF($A16=\"\",,COUNTIFS('意見明細'!$J:$J,$A16,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,B$4))", "=IF($A16=\"\",,COUNTIFS('意見明細'!$J:$J,$A16,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,C$4))", "=IF($A16=\"\",,COUNTIFS('意見明細'!$J:$J,$A16,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,D$4))", "=IF($A16=\"\",,COUNTIFS('意見明細'!$J:$J,$A16,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,E$4))", "=IF($A16=\"\",,COUNTIFS('意見明細'!$J:$J,$A16,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,F$4))"]], [17, ["", "=IF($A17=\"\",,COUNTIFS('意見明細'!$J:$J,$A17,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,B$4))", "=IF($A17=\"\",,COUNTIFS('意見明細'!$J:$J,$A17,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,C$4))", "=IF($A17=\"\",,COUNTIFS('意見明細'!$J:$J,$A17,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,D$4))", "=IF($A17=\"\",,COUNTIFS('意見明細'!$J:$J,$A17,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,E$4))", "=IF($A17=\"\",,COUNTIFS('意見明細'!$J:$J,$A17,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,F$4))"]], [18, ["", "=IF($A18=\"\",,COUNTIFS('意見明細'!$J:$J,$A18,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,B$4))", "=IF($A18=\"\",,COUNTIFS('意見明細'!$J:$J,$A18,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,C$4))", "=IF($A18=\"\",,COUNTIFS('意見明細'!$J:$J,$A18,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,D$4))", "=IF($A18=\"\",,COUNTIFS('意見明細'!$J:$J,$A18,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,E$4))", "=IF($A18=\"\",,COUNTIFS('意見明細'!$J:$J,$A18,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,F$4))"]], [19, ["", "=IF($A19=\"\",,COUNTIFS('意見明細'!$J:$J,$A19,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,B$4))", "=IF($A19=\"\",,COUNTIFS('意見明細'!$J:$J,$A19,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,C$4))", "=IF($A19=\"\",,COUNTIFS('意見明細'!$J:$J,$A19,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,D$4))", "=IF($A19=\"\",,COUNTIFS('意見明細'!$J:$J,$A19,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,E$4))", "=IF($A19=\"\",,COUNTIFS('意見明細'!$J:$J,$A19,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,F$4))"]], [20, ["", "=IF($A20=\"\",,COUNTIFS('意見明細'!$J:$J,$A20,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,B$4))", "=IF($A20=\"\",,COUNTIFS('意見明細'!$J:$J,$A20,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,C$4))", "=IF($A20=\"\",,COUNTIFS('意見明細'!$J:$J,$A20,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,D$4))", "=IF($A20=\"\",,COUNTIFS('意見明細'!$J:$J,$A20,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,E$4))", "=IF($A20=\"\",,COUNTIFS('意見明細'!$J:$J,$A20,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,F$4))"]], [21, ["", "=IF($A21=\"\",,COUNTIFS('意見明細'!$J:$J,$A21,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,B$4))", "=IF($A21=\"\",,COUNTIFS('意見明細'!$J:$J,$A21,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,C$4))", "=IF($A21=\"\",,COUNTIFS('意見明細'!$J:$J,$A21,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,D$4))", "=IF($A21=\"\",,COUNTIFS('意見明細'!$J:$J,$A21,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,E$4))", "=IF($A21=\"\",,COUNTIFS('意見明細'!$J:$J,$A21,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,F$4))"]], [22, ["", "=IF($A22=\"\",,COUNTIFS('意見明細'!$J:$J,$A22,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,B$4))", "=IF($A22=\"\",,COUNTIFS('意見明細'!$J:$J,$A22,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,C$4))", "=IF($A22=\"\",,COUNTIFS('意見明細'!$J:$J,$A22,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,D$4))", "=IF($A22=\"\",,COUNTIFS('意見明細'!$J:$J,$A22,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,E$4))", "=IF($A22=\"\",,COUNTIFS('意見明細'!$J:$J,$A22,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,F$4))"]], [23, ["", "=IF($A23=\"\",,COUNTIFS('意見明細'!$J:$J,$A23,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,B$4))", "=IF($A23=\"\",,COUNTIFS('意見明細'!$J:$J,$A23,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,C$4))", "=IF($A23=\"\",,COUNTIFS('意見明細'!$J:$J,$A23,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,D$4))", "=IF($A23=\"\",,COUNTIFS('意見明細'!$J:$J,$A23,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,E$4))", "=IF($A23=\"\",,COUNTIFS('意見明細'!$J:$J,$A23,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,F$4))"]], [24, ["", "=IF($A24=\"\",,COUNTIFS('意見明細'!$J:$J,$A24,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,B$4))", "=IF($A24=\"\",,COUNTIFS('意見明細'!$J:$J,$A24,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,C$4))", "=IF($A24=\"\",,COUNTIFS('意見明細'!$J:$J,$A24,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,D$4))", "=IF($A24=\"\",,COUNTIFS('意見明細'!$J:$J,$A24,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,E$4))", "=IF($A24=\"\",,COUNTIFS('意見明細'!$J:$J,$A24,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,F$4))"]], [25, ["", "=IF($A25=\"\",,COUNTIFS('意見明細'!$J:$J,$A25,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,B$4))", "=IF($A25=\"\",,COUNTIFS('意見明細'!$J:$J,$A25,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,C$4))", "=IF($A25=\"\",,COUNTIFS('意見明細'!$J:$J,$A25,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,D$4))", "=IF($A25=\"\",,COUNTIFS('意見明細'!$J:$J,$A25,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,E$4))", "=IF($A25=\"\",,COUNTIFS('意見明細'!$J:$J,$A25,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,F$4))"]], [26, ["", "=IF($A26=\"\",,COUNTIFS('意見明細'!$J:$J,$A26,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,B$4))", "=IF($A26=\"\",,COUNTIFS('意見明細'!$J:$J,$A26,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,C$4))", "=IF($A26=\"\",,COUNTIFS('意見明細'!$J:$J,$A26,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,D$4))", "=IF($A26=\"\",,COUNTIFS('意見明細'!$J:$J,$A26,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,E$4))", "=IF($A26=\"\",,COUNTIFS('意見明細'!$J:$J,$A26,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,F$4))"]], [27, ["", "=IF($A27=\"\",,COUNTIFS('意見明細'!$J:$J,$A27,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,B$4))", "=IF($A27=\"\",,COUNTIFS('意見明細'!$J:$J,$A27,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,C$4))", "=IF($A27=\"\",,COUNTIFS('意見明細'!$J:$J,$A27,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,D$4))", "=IF($A27=\"\",,COUNTIFS('意見明細'!$J:$J,$A27,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,E$4))", "=IF($A27=\"\",,COUNTIFS('意見明細'!$J:$J,$A27,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,F$4))"]], [28, ["", "=IF($A28=\"\",,COUNTIFS('意見明細'!$J:$J,$A28,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,B$4))", "=IF($A28=\"\",,COUNTIFS('意見明細'!$J:$J,$A28,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,C$4))", "=IF($A28=\"\",,COUNTIFS('意見明細'!$J:$J,$A28,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,D$4))", "=IF($A28=\"\",,COUNTIFS('意見明細'!$J:$J,$A28,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,E$4))", "=IF($A28=\"\",,COUNTIFS('意見明細'!$J:$J,$A28,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,F$4))"]], [29, ["", "=IF($A29=\"\",,COUNTIFS('意見明細'!$J:$J,$A29,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,B$4))", "=IF($A29=\"\",,COUNTIFS('意見明細'!$J:$J,$A29,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,C$4))", "=IF($A29=\"\",,COUNTIFS('意見明細'!$J:$J,$A29,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,D$4))", "=IF($A29=\"\",,COUNTIFS('意見明細'!$J:$J,$A29,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,E$4))", "=IF($A29=\"\",,COUNTIFS('意見明細'!$J:$J,$A29,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,F$4))"]], [30, ["", "=IF($A30=\"\",,COUNTIFS('意見明細'!$J:$J,$A30,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,B$4))", "=IF($A30=\"\",,COUNTIFS('意見明細'!$J:$J,$A30,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,C$4))", "=IF($A30=\"\",,COUNTIFS('意見明細'!$J:$J,$A30,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,D$4))", "=IF($A30=\"\",,COUNTIFS('意見明細'!$J:$J,$A30,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,E$4))", "=IF($A30=\"\",,COUNTIFS('意見明細'!$J:$J,$A30,'意見明細'!$H:$H,\"預算\",'意見明細'!$L:$L,F$4))"]], [33, ["場合", "這天可以", "這天不方便", "想建議別的日子"]], [34, ["=IFERROR(UNIQUE(FILTER('意見明細'!G:G,'意見明細'!H:H=\"日期\")),)", "=IF($A34=\"\",,COUNTIFS('意見明細'!$G:$G,$A34,'意見明細'!$H:$H,\"日期\",'意見明細'!$L:$L,B$33))", "=IF($A34=\"\",,COUNTIFS('意見明細'!$G:$G,$A34,'意見明細'!$H:$H,\"日期\",'意見明細'!$L:$L,C$33))", "=IF($A34=\"\",,COUNTIFS('意見明細'!$G:$G,$A34,'意見明細'!$H:$H,\"日期\",'意見明細'!$L:$L,D$33))"]], [35, ["", "=IF($A35=\"\",,COUNTIFS('意見明細'!$G:$G,$A35,'意見明細'!$H:$H,\"日期\",'意見明細'!$L:$L,B$33))", "=IF($A35=\"\",,COUNTIFS('意見明細'!$G:$G,$A35,'意見明細'!$H:$H,\"日期\",'意見明細'!$L:$L,C$33))", "=IF($A35=\"\",,COUNTIFS('意見明細'!$G:$G,$A35,'意見明細'!$H:$H,\"日期\",'意見明細'!$L:$L,D$33))"]], [36, ["", "=IF($A36=\"\",,COUNTIFS('意見明細'!$G:$G,$A36,'意見明細'!$H:$H,\"日期\",'意見明細'!$L:$L,B$33))", "=IF($A36=\"\",,COUNTIFS('意見明細'!$G:$G,$A36,'意見明細'!$H:$H,\"日期\",'意見明細'!$L:$L,C$33))", "=IF($A36=\"\",,COUNTIFS('意見明細'!$G:$G,$A36,'意見明細'!$H:$H,\"日期\",'意見明細'!$L:$L,D$33))"]], [37, ["", "=IF($A37=\"\",,COUNTIFS('意見明細'!$G:$G,$A37,'意見明細'!$H:$H,\"日期\",'意見明細'!$L:$L,B$33))", "=IF($A37=\"\",,COUNTIFS('意見明細'!$G:$G,$A37,'意見明細'!$H:$H,\"日期\",'意見明細'!$L:$L,C$33))", "=IF($A37=\"\",,COUNTIFS('意見明細'!$G:$G,$A37,'意見明細'!$H:$H,\"日期\",'意見明細'!$L:$L,D$33))"]], [38, ["", "=IF($A38=\"\",,COUNTIFS('意見明細'!$G:$G,$A38,'意見明細'!$H:$H,\"日期\",'意見明細'!$L:$L,B$33))", "=IF($A38=\"\",,COUNTIFS('意見明細'!$G:$G,$A38,'意見明細'!$H:$H,\"日期\",'意見明細'!$L:$L,C$33))", "=IF($A38=\"\",,COUNTIFS('意見明細'!$G:$G,$A38,'意見明細'!$H:$H,\"日期\",'意見明細'!$L:$L,D$33))"]], [39, ["", "=IF($A39=\"\",,COUNTIFS('意見明細'!$G:$G,$A39,'意見明細'!$H:$H,\"日期\",'意見明細'!$L:$L,B$33))", "=IF($A39=\"\",,COUNTIFS('意見明細'!$G:$G,$A39,'意見明細'!$H:$H,\"日期\",'意見明細'!$L:$L,C$33))", "=IF($A39=\"\",,COUNTIFS('意見明細'!$G:$G,$A39,'意見明細'!$H:$H,\"日期\",'意見明細'!$L:$L,D$33))"]], [40, ["", "=IF($A40=\"\",,COUNTIFS('意見明細'!$G:$G,$A40,'意見明細'!$H:$H,\"日期\",'意見明細'!$L:$L,B$33))", "=IF($A40=\"\",,COUNTIFS('意見明細'!$G:$G,$A40,'意見明細'!$H:$H,\"日期\",'意見明細'!$L:$L,C$33))", "=IF($A40=\"\",,COUNTIFS('意見明細'!$G:$G,$A40,'意見明細'!$H:$H,\"日期\",'意見明細'!$L:$L,D$33))"]], [43, ["方案", "則數"]], [44, ["=IFERROR(UNIQUE(FILTER('意見明細'!L:L,'意見明細'!H:H=\"方案傾向\")),)", "=IF($A44=\"\",,COUNTIFS('意見明細'!$L:$L,$A44,'意見明細'!$H:$H,\"方案傾向\"))"]], [45, ["", "=IF($A45=\"\",,COUNTIFS('意見明細'!$L:$L,$A45,'意見明細'!$H:$H,\"方案傾向\"))"]], [46, ["", "=IF($A46=\"\",,COUNTIFS('意見明細'!$L:$L,$A46,'意見明細'!$H:$H,\"方案傾向\"))"]], [47, ["", "=IF($A47=\"\",,COUNTIFS('意見明細'!$L:$L,$A47,'意見明細'!$H:$H,\"方案傾向\"))"]], [48, ["", "=IF($A48=\"\",,COUNTIFS('意見明細'!$L:$L,$A48,'意見明細'!$H:$H,\"方案傾向\"))"]], [49, ["", "=IF($A49=\"\",,COUNTIFS('意見明細'!$L:$L,$A49,'意見明細'!$H:$H,\"方案傾向\"))"]], [50, ["", "=IF($A50=\"\",,COUNTIFS('意見明細'!$L:$L,$A50,'意見明細'!$H:$H,\"方案傾向\"))"]]];
var CHARTS = [{"range": "A4:F30", "type": "BAR", "title": "每一筆花費的看法（則數）", "stacked": true, "row": 1, "col": 8, "colors": ["#713b43", "#c08a3e", "#3e5949", "#9a9a9a", "#4a6fa5"]}, {"range": "A33:D40", "type": "BAR", "title": "每一場日期的看法（則數）", "stacked": true, "row": 24, "col": 8, "colors": ["#3e5949", "#713b43", "#c08a3e"]}, {"range": "A43:B50", "type": "PIE", "title": "午宴／晚宴：比較傾向", "stacked": false, "row": 46, "col": 8, "colors": ["#713b43", "#3e5949", "#c08a3e", "#4a6fa5"]}];
// ---- 產生區塊結束 ----
