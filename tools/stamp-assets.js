#!/usr/bin/env node
// 幫 index.html 引用的 CSS／JS 加上內容雜湊（?v=xxxxxxxx）。
// GitHub Pages 會讓手機快取檔案約 10 分鐘；沒有版本號時，手機可能拿到「新頁面＋舊程式」而壞掉。
// 改過 app.js、content.js、config.js 或 styles.css 後執行：node tools/stamp-assets.js
// 只檢查不改：node tools/stamp-assets.js --check（版本號過期時結束碼為 1）
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const root = path.join(__dirname, '..');
const file = path.join(root, 'index.html');
const html = fs.readFileSync(file, 'utf8');
const assets = ['styles.css', 'config.js', 'content.js', 'app.js'];
let out = html;
for (const a of assets) {
  const v = crypto.createHash('sha1').update(fs.readFileSync(path.join(root, a))).digest('hex').slice(0, 8);
  const re = new RegExp(`((?:href|src)=")${a.replace('.', '\\.')}(?:\\?v=[0-9a-f]+)?(")`, 'g');
  if (!re.test(out)) { console.error(`index.html 沒有引用 ${a}`); process.exit(1); }
  out = out.replace(re, `$1${a}?v=${v}$2`);
}
if (process.argv.includes('--check')) {
  if (out !== html) { console.error('index.html 的版本號過期，請執行 node tools/stamp-assets.js'); process.exit(1); }
  console.log('版本號正確');
} else {
  fs.writeFileSync(file, out);
  console.log(out === html ? '版本號已是最新' : '已更新 index.html 的版本號');
}
