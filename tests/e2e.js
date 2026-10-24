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
async function qChoice(page, nth, label) { await page.locator('.question').nth(nth).locator(`.q-choice:has-text("${label}")`).click(); }
async function pick(page, nth) { await page.locator('#compare-wedding .pick').nth(nth).click(); }
async function answerFirstQuestion(page, text) {
  await page.locator('.question').nth(1).locator('.opinion-button').click();
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
    page.on('console', m => { if (m.text().includes('[小冊] 頁面缺少')) errors.push(`${name}: ${m.text()}`); });
    await page.goto(`http://127.0.0.1:${SITE_PORT}/index.html`);
    if (name === '大姑') {
      const current = await page.evaluate(() => window.WEDDING.phases[0]);
      check(current.status.startsWith('提親日期已確認') && current.why.includes('女方父親確認'), '提親日期顯示已與女方父親確認');
      check(current.schedule.some(x => x.time === '12:00–14:00') && current.schedule.some(x => x.time === '14:00–16:00'), '提親行程列出午餐與談正事時段');
      check(await page.locator('#talk-proposal .talk-steps > li').count() === (current.talk.steps || []).length && await page.locator('#talk-proposal').innerText().then(t => t.includes('可以這樣說')), '提親討論小抄顯示順序與說法');
      check(!/萬|退回|底線/.test(JSON.stringify(current.talk)), '討論小抄不寫金額、退回或底線');
      const memoIds = current.memos.members.map(x => x.id);
      check(await page.locator('#memos-proposal [role=tab]').count() === memoIds.length && await page.locator('#memos-proposal [role=tabpanel]:not([hidden])').count() === 1, '每個人的備忘錄一次顯示一位');
      await page.locator(`#memo-tab-${memoIds[4]}`).click();
      check(await page.locator(`#memo-${memoIds[4]}`).isVisible() && !(await page.locator(`#memo-${memoIds[0]}`).isVisible()), '點稱謂切換到那個人的備忘錄');
      await page.evaluate(id => { location.hash = `#memo-${id}`; }, memoIds[3]);
      await page.waitForTimeout(200);
      check(await page.locator(`#memo-${memoIds[3]}`).isVisible(), '用 #memo- 連結直接打開那個人的備忘錄');
      await page.evaluate(() => history.replaceState(null, '', location.pathname));
      check(current.guides.some(g => g.template) && await page.locator('#guides-proposal .record-template').count() === 1, '討論與紀錄原則附紀錄格式');
      check(!/萬|退回|底線|老婆|有主見/.test(JSON.stringify([current.talk, current.guides, current.memos])), '小抄、原則與備忘錄不寫金額、底線或私下評語');
      const tripText = JSON.stringify(current);
      check(!/計程車/.test(tripText) && !/09\d{2}[-\s]?\d{3}[-\s]?\d{3}|[A-Z]{2,3}-\d{4}/.test(tripText), '提親行程不再寫計程車，也沒有司機電話或車牌');
      check(current.schedule.some(x => x.link && x.link.url.startsWith('https://')) && await page.locator('#phase-proposal a.map-link[target=_blank]').count() === 1, '提親行程附餐廳地圖連結（另開新頁）');
      check(!JSON.stringify(current).match(/待核|媽咪|老爹|尚禮|詩音|擬10\/1[3-7]/), '提親內容沒有內部備註、家人暱稱或過期日期');
    }
    await steps(page);
    return { ctx, page };
  };

  // 大姑：大聘太多（20 萬）、訂婚日期不方便、傾向晚宴、用文字回答一題
  const a = await elder('大姑', {}, async p => {
    await opine(p, '大聘', '太多，可以少一點', { amount: 200000, text: '女方家可能會退一部分' });
    await dateOpinion(p, 'engagement', '這天不方便', '3/27 比較好');
    await pick(p, 1);
    await answerFirstQuestion(p, '10/24 可以，上午出發');
    await send(p, '大姑');
    await p.waitForSelector('#sent-panel:not([hidden])');
  });
  check(await a.page.locator('#sent-panel').isVisible(), '大姑：看到「已送到新人那裡」');
  check(await a.page.locator('#filled-at').inputValue() === '尚未填寫', '送出後清空，填寫時間不殘留');
  await a.page.fill('#name', '大姑姑'); await a.page.waitForTimeout(100);
  check(await a.page.locator('#filled-at').inputValue() === '尚未填寫', '只改稱呼不算填寫意見');
  check((await a.page.locator('#sent-text').textContent()).includes('台北時間'), '送出確認顯示台北完整時間');
  check(await a.page.locator('#filled-at').getAttribute('readonly') !== null, '填寫時間由系統記錄，不要求長輩手填');
  check(await a.page.locator('.opinion-item').count() === 0, '大姑：送出後清單清空');

  // 舅舅：大聘剛好、喜餅可以不用、傾向午宴、訂婚日期可以
  await elder('舅舅', {}, async p => {
    // 「我有意見」視窗不再列「金額剛好」：同意要直接按旁邊的「合理，OK」
    await p.locator('.budget-row', { hasText: '大聘' }).first().locator('.opinion-button').click();
    check(await p.locator('#sheet .choice:has-text("金額剛好")').count() === 0, '「我有意見」視窗只列不同意見（沒有「金額剛好」）');
    await p.click('#sheet-close');
    await okay(p, '.budget-row:has-text("大聘")');
    check(await p.locator('.budget-row:has-text("大聘") .pair-ok').first().getAttribute('aria-pressed') === 'true', '按「合理，OK」後按鈕呈現已選');
    await p.locator('.budget-row', { hasText: '喜餅（' }).first().locator('.opinion-button').click();
    check(await p.locator('#sheet .choice:has-text("想改由誰負擔")').count() === 0 && await p.locator('#sheet-who').count() === 0, '預算意見不再有「改由誰負擔」');
    await p.click('#sheet .choice:has-text("這項可以不用")');
    await p.click('#sheet-form button[type=submit]');
    await pick(p, 0);
    check(await p.locator('.question .scope-both').count() > 0 && await p.locator('.question .scope-couple').count() > 0, '「一起商量」每題標出兩家商量或擬定');
    await qChoice(p, 0, '合適');
    check(await p.locator('.question').nth(0).locator('.q-choice.on').textContent() === '✓ 合適', '「一起商量」選項一按就記下');
    check(await p.locator('#date-proposal .opinion-button').count() === 0, '已確認的提親日期不再請長輩表態');
    await okay(p, '#date-engagement');
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
    await qChoice(p, 0, '合適');
    await pick(p, 1);
    await p.locator('#budget-wedding .bok').click();
    await send(p, '阿姨');
    await p.waitForFunction(() => document.getElementById('feedback-status').textContent.includes('沒有送出去'));
  });
  check(await c.page.locator('.opinion-item').count() === 4, '阿姨：送出失敗時意見仍保留（4 則）');
  await c.page.click('#sheet-button');
  await c.page.waitForSelector('#sent-panel:not([hidden])');
  check(true, '阿姨：重按後顯示已送出');

  const dump = await (await fetch(`http://127.0.0.1:${GAS_PORT}/admin/dump`)).json();
  const op = dump.sheets['意見明細'].rows.slice(1).filter(r => r && r[0]);
  const sub = dump.sheets['意見送出紀錄'].rows.slice(1).filter(r => r && r[0]);
  check(sub.length === 3, `意見送出紀錄 3 筆（實際 ${sub.length}）`);
  check(op.length === 4 + 5 + 4, `意見明細 13 則，重送未重複（實際 ${op.length}）`);
  const H = dump.sheets['意見明細'].rows[0];
  const col = h => H.indexOf(h);
  const big = op.filter(r => r[col('項目代碼')] === 'B-001');
  check(big.length === 3 && big.some(r => r[col('建議金額')] === 200000) && big.some(r => r[col('原本金額')] === 360000), '大聘 3 則，建議金額與原本金額正確寫入');
  check(big.some(r => r[col('看法代碼')] === 'ok' && r[col('看法')] === '金額剛好') && op.some(r => r[col('項目代碼')] === 'date:engagement' && r[col('看法')] === '這天可以'), '「合理，OK」寫入試算表的看法仍是「金額剛好」「這天可以」（欄位不變）');
  check(!op.some(r => r[col('項目代碼')] === 'date:registration'), '取消的「合理，OK」不會送出');
  const qRows = op.filter(r => r[col('類型')] === '一起商量' && r[col('看法')] === '合適');
  check(qRows.length === 2 && qRows.every(r => String(r[col('項目名稱')]).includes('10 人')), '「一起商量」選項寫入試算表「看法」欄（2 則「合適」）');
  check(op.some(r => r[col('類型')] === '其他花費都沒意見' && r[col('場合')] === '結婚'), '「其他花費都沒意見」有寫入');
  check(op.every(r => r[col('由誰負擔')] === ''), '「由誰負擔」欄保留但不再寫入');
  check(op.some(r => r[col('項目代碼')] === 'B-005' && r[col('看法')] === '這項可以不用'), '喜餅「這項可以不用」有寫入');
  check(op.every(r => r[col('處理狀態')] === '待處理'), '新意見預設「待處理」');
  check(['意見整理', '圖表', '會議議程'].every(n => dump.order.includes(n)) && dump.sheets['圖表'].charts === 3, 'setup 建立整理、圖表（3 張）、會議議程');
  check(dump.timeZone === 'Asia/Taipei', 'setup 把試算表時區設為台北');

  // 會議議程：訂婚日期（可以 1／不方便 1）分歧最大，接著大聘與方案（2:1）
  const agenda = dump.sheets['會議議程'].rows;
  const topRows = agenda.slice(4, 7).map(r => `${r[1]}|${r[2]}|${r[5]}`);
  console.log('      議程前三：' + topRows.join('  /  '));
  check(topRows[0] && topRows[0].startsWith('訂婚|日期|意見分歧大'), '議程第 1 項是訂婚日期（意見分歧大）');
  check(topRows.slice(1).every(t => /大聘|方案比較/.test(t)), '議程第 2、3 項是大聘與午宴／晚宴');
  check(!topRows.some(t => t.startsWith('一起商量')), '只有一則的回答不會排進前三');

  // Codex 摘要：與議程同一套排序
  const env = { ...process.env, ALIVE_FEEDBACK_ENDPOINT: `http://127.0.0.1:${GAS_PORT}/macros/s/TESTDEPLOY/exec`, ALIVE_FEEDBACK_TOKEN: dump.token };
  const digest = await py([path.join(ROOT, 'apps-script/feedback_digest.py'), 'digest'], env);
  const top = digest.split('## 會議先談這三項')[1] || '';
  check(/1\. 【訂婚】日期/.test(top), '摘要「會議先談這三項」第 1 項與議程相同');
  check(digest.includes('20 萬（大姑）、25 萬（阿姨）'), '摘要列出建議金額與長輩稱呼');
  check(digest.includes('共 **13 則**意見，來自 3 位'), '摘要總數正確（13 則、3 位）');
  check(digest.includes('2 位回答：合適 ×2'), '摘要列出「一起商量」選項分布');
  const wrongToken = await py([path.join(ROOT, 'apps-script/feedback_digest.py'), 'digest'], { ...env, ALIVE_FEEDBACK_TOKEN: 'wrong' }).then(() => false, e => String(e.stderr).includes('forbidden'));
  check(wrongToken, '錯誤 token 讀不到資料');

  // 新人決定：訂婚日期兩則都標「已回覆」→ 議程更新
  const ids = op.filter(r => r[col('類型')] === '日期').map(r => r[col('意見編號')]);
  for (const id of ids) await py([path.join(ROOT, 'apps-script/feedback_digest.py'), 'mark', id, '已回覆', '日期請命理老師確認'], env);
  const dump2 = await (await fetch(`http://127.0.0.1:${GAS_PORT}/admin/dump`)).json();
  const op2 = dump2.sheets['意見明細'].rows.slice(1).filter(r => r && r[0]);
  check(op2.filter(r => r[col('處理狀態')] === '已回覆').length === 2, '回寫後 2 則變「已回覆」並有處理說明');
  check(!dump2.sheets['會議議程'].rows.slice(4, 7).some(r => r[1] === '訂婚' && r[2] === '日期'), '回寫後議程自動移除已處理的訂婚日期');
  // 手機快取：index.html 引用的檔案要帶最新的內容雜湊，否則可能「新頁面＋舊程式」而打不開意見視窗
  const stamp = await new Promise(r => execFile(process.execPath, [path.join(ROOT, 'tools/stamp-assets.js'), '--check'], (err, out, errOut) => r({ ok: !err, msg: (out + errOut).trim() })));
  check(stamp.ok, 'index.html 的檔案版本號是最新的' + (stamp.ok ? '' : `（${stamp.msg}）`));
  // 舊版程式＋新版頁面（或相反）時，意見視窗仍要打得開
  const mix = await browser.newContext({ ...devices['iPhone 13'], locale: 'zh-TW' });
  const mp = await mix.newPage();
  await mp.route('**/index.html', async r => { const res = await r.fetch(); r.fulfill({ response: res, body: (await res.text()).replace(/<p class="hint" id="sheet-amount-hint"><\/p>/, '') }); });
  await mp.goto(`http://127.0.0.1:${SITE_PORT}/index.html`);
  await mp.locator('.add-item').first().click();
  check(await mp.evaluate(() => document.getElementById('sheet').open) && await mp.isVisible('#sheet-text'), '頁面少了元素時，意見視窗仍打得開、可以打字');
  await mp.fill('#sheet-name', '時間測試');
  await mp.fill('#sheet-text', '確認時間會寫進文字與連結');
  await mp.click('#sheet-form button[type=submit]');
  const filled = await mp.locator('#filled-at').inputValue();
  check(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}（台北時間）/.test(filled), '填寫時間包含年月日與時分秒');
  const link = await mp.locator('#line-button').getAttribute('href');
  check(decodeURIComponent(link).includes('填寫時間：'+filled), 'LINE文字保留完整填寫時間');
  const proposalLink = await mp.evaluate(() => proposalUrl());
  await mp.goto(proposalLink);
  await mp.reload(); // 模擬接收者首次打開連結，不只是同頁改 hash
  check((await mp.locator('#proposal-meta').textContent()).includes(filled), '意見連結顯示原填寫時間，不只日期');
  await mp.locator('#feedback').scrollIntoViewIfNeeded();
  await mp.screenshot({path:process.env.ALIVE_SCREENSHOT || '/tmp/alive-feedback-time.png'});
  const legacy = await mp.evaluate(() => { const p=decode(location.hash.slice(3));p.t='2026-10-10';return location.origin+location.pathname+'#p='+encode(p); });
  await mp.goto(legacy);
  await mp.reload();
  check((await mp.locator('#proposal-meta').textContent()).includes('舊紀錄未提供時分'), '舊意見不補造時分');
  await mix.close();
  check(errors.length === 0, '網頁沒有錯誤' + (errors.length ? '：' + errors.join('; ') : ''));

  await browser.close(); gas.close();
  console.log(failures ? `\n${failures} 項失敗` : '\n全部通過');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
