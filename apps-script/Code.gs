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
  ensureSheet_(ss, SHEET_SUBMISSIONS, SUB_HEADERS);
  var op = ensureSheet_(ss, SHEET_OPINIONS, OP_HEADERS);
  var rule = SpreadsheetApp.newDataValidation().requireValueInList(STATUS, true).setAllowInvalid(false).build();
  op.getRange(2, OP_HEADERS.indexOf('處理狀態') + 1, op.getMaxRows() - 1, 1).setDataValidation(rule);
  buildSummary_(ss);
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
// ---- 產生區塊結束 ----
