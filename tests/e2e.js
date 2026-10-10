// 端對端測試：長輩手機送出 → 收件程式（Code.gs）→ 試算表 → 會議議程 → Codex 摘要 → 回寫狀態。
// 需要 Node 18+、Python 3、playwright（NODE_PATH 指到裝有 playwright 的 node_modules）。
// 用法：NODE_PATH=... node tests/e2e.js　　（Chromium 路徑可用 CHROMIUM 環境變數指定）
'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), { execFile } = require('child_process');
// 模擬器和測試在同一個行程，必須用非同步執行 Python，否則會互相卡住
const py = (args, env) => new Promise((resolve, reject) => execFile('python3', args, { env }, (err, stdout, stderr) => err ? reject(Object.assign(err, { stdout, stderr })) : resolve(stdout)));
const { chromium, devices } = require('playwright');
const { serve } = require('./gas_server');

const ROOT = path.join(__dirname, '..');
const GAS_PORT = 8790, SITE_PORT = 8791;
const ENDPOINT = 'https://script.google.com/macros/s/TESTDEPLOY/exec';
let failures = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failures++; };

function siteServer() {
  return new Promise(r => http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p === '/') p = '/index.html';
    if (p === '/config.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); return res.end(`window.SITE_CONFIG={sheetEndpoint:${JSON.stringify(ENDPOINT)}};`); }
    const f = path.join(ROOT, p);
    if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[path.extname(f)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type + '; charset=utf-8' }); fs.createReadStream(f).pipe(res);
  }).listen(SITE_PORT, '127.0.0.1', r));
}

// 把瀏覽器打到 script.google.com 的請求轉給本機模擬器（模擬器會 302，Node fetch 會跟隨）
async function wire(context, { dropFirst = false } = {}) {
  let dropped = false;
  await context.route('https://script.google.com/**', async route => {
    const req = route.request(); const u = new URL(req.url());
    const res = await fetch(`http://127.0.0.1:${GAS_PORT}${u.pathname}${u.search}`, { method: req.method(), body: req.postData() || undefined });
    const body = await res.text();
    if (dropFirst && !dropped) { dropped = true; return route.abort('connectionreset'); } // 伺服器已收到，但手機沒收到回應
    route.fulfill({ status: res.status, headers: { 'content-type': res.headers.get('content-type'), 'access-control-allow-origin': '*' }, body });
  });
}

async function opine(page, rowText, choice, { amount, text, who } = {}) {
  await page.locator('.budget-row', { hasText: rowText }).first().locator('.opinion-button').click();
  await page.click(`#sheet .choice:has-text("${choice}")`);
  if (amount !== undefined) await page.fill('#sheet-amount-input', String(amount));
  if (who) await page.click(`#sheet-who-list .choice:has-text("${who}")`);
  if (text) await page.fill('#sheet-text', text);
  await page.click('#sheet-form button[type=submit]');
}
async function dateOpinion(page, phase, choice, text) {
  await page.locator(`#date-${phase} .opinion-button`).click();
  await page.click(`#sheet .choice:has-text("${choice}")`);
  if (text) await page.fill('#sheet-text', text);
  await page.click('#sheet-form button[type=submit]');
}
async function okay(page, scope) { await page.locator(scope).first().locator('.pair-ok').click(); }
async function pick(page, nth) { await page.locator('#compare-wedding .pick').nth(nth).click(); }
async function answerFirstQuestion(page, text) {
  await page.locator('.question').first().locator('.opinion-button').click();
  await page.fill('#sheet-text', text);
  await page.click('#sheet-form button[type=submit]');
}
async function send(page, name) {
  await page.fill('#name', name);
  await page.click('#sheet-button');
}

(async () => {
  const { server: gas } = await serve(GAS_PORT);
  await siteServer();
  await fetch(`http://127.0.0.1:${GAS_PORT}/admin?fn=setup`);
  const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  const errors = [];
  const elder = async (name, opts, steps) => {
    const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'zh-TW' });
    await wire(ctx, opts);
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(`${name}: ${e.message}`));
    await page.goto(`http://127.0.0.1:${SITE_PORT}/index.html`);
    await steps(page);
    return { ctx, page };
  };

  // 大姑：大聘太多（20 萬）、提親日期不方便、傾向晚宴、回答第一題
  const a = await elder('大姑', {}, async p => {
    await opine(p, '大聘', '太多，可以少一點', { amount: 200000, text: '女方家可能會退一部分' });
    await dateOpinion(p, 'proposal', '這天不方便', '10/25 比較好');
    await pick(p, 1);
    await answerFirstQuestion(p, '10/24 可以，上午出發');
    await send(p, '大姑');
    await p.waitForSelector('#sent-panel:not([hidden])');
  });
  check(await a.page.locator('#sent-panel').isVisible(), '大姑：看到「已送到新人那裡」');
  check(await a.page.locator('.opinion-item').count() === 0, '大姑：送出後清單清空');

  // 舅舅：大聘剛好、喜餅各半、傾向午宴、提親日期可以
  await elder('舅舅', {}, async p => {
    // 「我有意見」視窗不再列「金額剛好」：同意要直接按旁邊的「合理，OK」
    await p.locator('.budget-row', { hasText: '大聘' }).first().locator('.opinion-button').click();
    check(await p.locator('#sheet .choice:has-text("金額剛好")').count() === 0, '「我有意見」視窗只列不同意見（沒有「金額剛好」）');
    await p.click('#sheet-close');
    await okay(p, '.budget-row:has-text("大聘")');
    check(await p.locator('.budget-row:has-text("大聘") .pair-ok').first().getAttribute('aria-pressed') === 'true', '按「合理，OK」後按鈕呈現已選');
    await opine(p, '喜餅（', '想改由誰負擔', { who: '各半' });
    await pick(p, 0);
    await okay(p, '#date-proposal');
    await okay(p, '#date-registration');
    await okay(p, '#date-registration'); // 再按一次＝取消
    check(await p.locator('#date-registration .pair-ok').getAttribute('aria-pressed') === 'false', '再按一次「合理，OK」會取消');
    await send(p, '舅舅');
    await p.waitForSelector('#sent-panel:not([hidden])');
  });

  // 點「太多」卻填了比原本高的金額：提示顯示差額，記下時看法跟著金額改成「不太夠」
  const m = await elder('混淆', {}, async p => {
    await p.locator('.budget-row', { hasText: '提親交通' }).first().locator('.opinion-button').click();
    await p.click('#sheet .choice:has-text("太多，可以少一點")');
    await p.fill('#sheet-amount-input', '25000');
    check((await p.textContent('#sheet-amount-hint')).includes('比原本多 5,000 元'), '金額提示顯示「比原本多 5,000 元」');
    await p.click('#sheet-form button[type=submit]');
  });
  check(await m.page.evaluate(() => JSON.parse(localStorage.getItem('alive-wedding-draft-v2')).e['B-036'].f) === 'more', '金額比原本高時，看法自動改為「不太夠，要多一點」');
  await m.ctx.close();

  // 阿姨：第一次送出時網路斷線（伺服器其實收到了），再按一次 → 不可重複寫入
  const c = await elder('阿姨', { dropFirst: true }, async p => {
    await opine(p, '大聘', '太多，可以少一點', { amount: 250000 });
    await pick(p, 1);
    await p.locator('#budget-wedding .bok').click();
    await send(p, '阿姨');
    await p.waitForFunction(() => document.getElementById('feedback-status').textContent.includes('沒有送出去'));
  });
  check(await c.page.locator('.opinion-item').count() === 3, '阿姨：送出失敗時意見仍保留（3 則）');
  await c.page.click('#sheet-button');
  await c.page.waitForSelector('#sent-panel:not([hidden])');
  check(true, '阿姨：重按後顯示已送出');

  const dump = await (await fetch(`http://127.0.0.1:${GAS_PORT}/admin/dump`)).json();
  const op = dump.sheets['意見明細'].rows.slice(1).filter(r => r && r[0]);
  const sub = dump.sheets['意見送出紀錄'].rows.slice(1).filter(r => r && r[0]);
  check(sub.length === 3, `意見送出紀錄 3 筆（實際 ${sub.length}）`);
  check(op.length === 4 + 4 + 3, `意見明細 11 則，重送未重複（實際 ${op.length}）`);
  const H = dump.sheets['意見明細'].rows[0];
  const col = h => H.indexOf(h);
  const big = op.filter(r => r[col('項目代碼')] === 'B-001');
  check(big.length === 3 && big.some(r => r[col('建議金額')] === 200000) && big.some(r => r[col('原本金額')] === 360000), '大聘 3 則，建議金額與原本金額正確寫入');
  check(big.some(r => r[col('看法代碼')] === 'ok' && r[col('看法')] === '金額剛好') && op.some(r => r[col('項目代碼')] === 'date:proposal' && r[col('看法')] === '這天可以'), '「合理，OK」寫入試算表的看法仍是「金額剛好」「這天可以」（欄位不變）');
  check(!op.some(r => r[col('項目代碼')] === 'date:registration'), '取消的「合理，OK」不會送出');
  check(op.some(r => r[col('類型')] === '其他花費都沒意見' && r[col('場合')] === '結婚'), '「其他花費都沒意見」有寫入');
  check(op.some(r => r[col('由誰負擔')] === '男方、女方各半'), '「由誰負擔」有寫入');
  check(op.every(r => r[col('處理狀態')] === '待處理'), '新意見預設「待處理」');
  check(['意見整理', '圖表', '會議議程'].every(n => dump.order.includes(n)) && dump.sheets['圖表'].charts === 3, 'setup 建立整理、圖表（3 張）、會議議程');
  check(dump.timeZone === 'Asia/Taipei', 'setup 把試算表時區設為台北');

  // 會議議程：提親日期（可以 1／不方便 1）分歧最大，接著大聘與方案（2:1）
  const agenda = dump.sheets['會議議程'].rows;
  const topRows = agenda.slice(4, 7).map(r => `${r[1]}|${r[2]}|${r[5]}`);
  console.log('      議程前三：' + topRows.join('  /  '));
  check(topRows[0] && topRows[0].startsWith('提親|日期|意見分歧大'), '議程第 1 項是提親日期（意見分歧大）');
  check(topRows.slice(1).every(t => /大聘|方案比較/.test(t)), '議程第 2、3 項是大聘與午宴／晚宴');
  check(!topRows.some(t => t.startsWith('一起商量')), '只有一則的回答不會排進前三');

  // Codex 摘要：與議程同一套排序
  const env = { ...process.env, ALIVE_FEEDBACK_ENDPOINT: `http://127.0.0.1:${GAS_PORT}/macros/s/TESTDEPLOY/exec`, ALIVE_FEEDBACK_TOKEN: dump.token };
  const digest = await py([path.join(ROOT, 'apps-script/feedback_digest.py'), 'digest'], env);
  const top = digest.split('## 會議先談這三項')[1] || '';
  check(/1\. 【提親】日期/.test(top), '摘要「會議先談這三項」第 1 項與議程相同');
  check(digest.includes('20 萬（大姑）、25 萬（阿姨）'), '摘要列出建議金額與長輩稱呼');
  check(digest.includes('共 **11 則**意見，來自 3 位'), '摘要總數正確（11 則、3 位）');
  const wrongToken = await py([path.join(ROOT, 'apps-script/feedback_digest.py'), 'digest'], { ...env, ALIVE_FEEDBACK_TOKEN: 'wrong' }).then(() => false, e => String(e.stderr).includes('forbidden'));
  check(wrongToken, '錯誤 token 讀不到資料');

  // 新人決定：提親日期兩則都標「已回覆」→ 議程更新
  const ids = op.filter(r => r[col('類型')] === '日期').map(r => r[col('意見編號')]);
  for (const id of ids) await py([path.join(ROOT, 'apps-script/feedback_digest.py'), 'mark', id, '已回覆', '提親改 10/25'], env);
  const dump2 = await (await fetch(`http://127.0.0.1:${GAS_PORT}/admin/dump`)).json();
  const op2 = dump2.sheets['意見明細'].rows.slice(1).filter(r => r && r[0]);
  check(op2.filter(r => r[col('處理狀態')] === '已回覆').length === 2, '回寫後 2 則變「已回覆」並有處理說明');
  check(!dump2.sheets['會議議程'].rows.slice(4, 7).some(r => r[1] === '提親'), '回寫後議程自動移除已處理的提親日期');
  check(errors.length === 0, '網頁沒有錯誤' + (errors.length ? '：' + errors.join('; ') : ''));

  await browser.close(); gas.close();
  console.log(failures ? `\n${failures} 項失敗` : '\n全部通過');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
