# 長輩意見收件：Google 試算表＋Apps Script

網頁按「送出給新人」→ 意見寫進一份 Google 試算表 → Codex 用 token 讀取（也可以回寫處理狀態）。

```
長輩手機 ──POST──▶ Apps Script 網頁應用程式 ──寫入──▶ Google 試算表（意見送出紀錄／意見明細）
Codex   ──GET（token）──▶ 同一個網址 ──讀出 JSON／CSV
```

## 一次性設定（約 10 分鐘，需用新人的 Google 帳號）

1. 打開雲端硬碟裡已建立的試算表「婚禮小冊・長輩意見」（已含四張工作表與使用說明）。
   要重建時：`python3 apps-script/build_template.py` 產生 .xlsx，上傳到雲端硬碟並轉成 Google 試算表。
2. 選單「擴充功能 → Apps Script」，刪掉預設內容，貼上本資料夾的 `Code.gs` 全部內容，按儲存。
3. 上方函式選單選 `setup`，按「執行」。第一次會要求授權：選自己的帳號 →「進階」→「前往（不安全）」→ 允許。
   - 這是因為程式是你自己寫的、尚未經 Google 審核；它只會讀寫這一份試算表。
   - 執行完到「執行記錄」複製 **讀取用 token**（給 Codex 用，不要放進網頁或 GitHub）。
   - `setup` 也會重建「意見整理」工作表的公式（上傳轉檔時的公式若顯示 #ERROR!，執行後就會正常）。
4. 右上「部署 → 新增部署作業」→ 類型選「網頁應用程式」：
   - 執行身分：**我**
   - 誰可以存取：**所有人**（長輩不用登入 Google 才能送出）
   - 按「部署」，複製「網頁應用程式網址」（`https://script.google.com/macros/s/…/exec`）。
5. 把網址填進儲存庫的 `config.js` 的 `sheetEndpoint`，提交後 GitHub Pages 會更新。網頁上的主要按鈕就會變成「送出給新人」。

6. 回到 Apps Script，函式選 `testSubmit` →「執行」。「意見明細」出現一列「安裝測試」、處理狀態為「已回覆」，就代表整條流程正常（這列可以刪除）。
7. 連線檢查：瀏覽器打開 `網址?ping=1`，看到 `{"ok":true,"service":"alive-feedback"...}` 即可。

之後若修改 `Code.gs`，要用「部署 → 管理部署作業 → 編輯 → 版本：新版本」，網址才會不變。

## 試算表欄位

**意見明細**（一則意見一列；Codex 主要讀這張）

| 欄位 | 說明 |
|---|---|
| 送出時間、送出編號、意見編號 | 意見編號＝送出編號-序號，回寫狀態時用 |
| 稱呼、頁面版本 | 長輩填的稱呼；送出時看的 `content.js` 版本 |
| 場合代碼、場合 | `phases[].id` 與名稱；回答討論題時為 `questions` |
| 類型 | 日期／當天行程／準備清單／預算／新增花費／方案傾向／一起商量／其他花費都沒意見 |
| 項目代碼、項目名稱 | 預算為 `Budget_ID`；討論題為 `q:雜湊` 與題目原文 |
| 看法代碼、看法 | 例如 `less`／太多，可以少一點 |
| 原本金額、建議金額、由誰負擔 | 僅預算類有值 |
| 文字 | 長輩打字或語音輸入的內容 |
| 處理狀態、處理說明 | 預設「待處理」；可選 待處理／採納／部分採納／不採納／已回覆 |

**意見整理**（全部是公式）：總覽數字、每筆預算的看法、每場日期的看法、午宴／晚宴傾向、依類型統計、待處理清單。版面定義在 `build_template.py`，執行它會同步更新 `Code.gs` 的 `SUMMARY`。

**會議議程**：只看「待處理」，同一項目 2 則以上，依看法分歧程度（1 −最多人選的看法比例）排序，列出前三項與其他待處理；每次收到意見、回寫狀態、或在「意見明細」改處理狀態時自動更新，也可從選單「婚禮小冊 → 更新會議議程」手動更新。`feedback_digest.py` 的「會議先談這三項」用同一套規則。

**圖表**：每筆花費的看法（堆疊長條）、每場日期的看法（堆疊長條）、午宴／晚宴傾向（圓餅），可在家庭會議投影。左側 A–F 欄是自動計算的圖表資料。由 `setup()` 建立；版面同樣定義在 `build_template.py`。

**意見送出紀錄**（一次送出一列）：含其他想說的話、預算合計（原本／照意見）、可在網頁上檢視的連結、原始資料 JSON。

## 給 Codex：整理摘要

`feedback_digest.py` 會讀「待處理」的意見，依場合與項目分組（看法統計、建議金額範圍與中位數、長輩原話、意見編號），產生 Markdown 摘要與決定清單；`mark` 指令回寫處理狀態。沒有 token 時，可從試算表下載「意見明細」CSV，用 `digest --from-csv` 離線整理。完整工作流程與規則見 [`CODEX.md`](CODEX.md)。

## 給 Codex：讀取與回寫（API）

```bash
# 待處理的意見（JSON）
curl -L "$ENDPOINT?token=$TOKEN&view=opinions&status=待處理"
# 全部意見（CSV）
curl -L "$ENDPOINT?token=$TOKEN&view=opinions&format=csv"
# 某日之後的送出紀錄
curl -L "$ENDPOINT?token=$TOKEN&view=submissions&since=2026-10-15"
# 回寫處理結果
curl -L -X POST "$ENDPOINT" -H 'Content-Type: text/plain' \
  -d '{"action":"mark","token":"'$TOKEN'","opinionId":"<意見編號>","status":"採納","note":"已改進 content.js 版本 05"}'
```

- `ENDPOINT` 就是 `config.js` 的網址；`TOKEN` 只放在 Codex 的環境變數，不要提交進儲存庫。
- 沒有 token 時一律回 `{"ok":false,"error":"forbidden"}`，所以網址公開也讀不到內容。
- 採納流程：讀「待處理」→ 改 `content.js`（更新 `version`、`decisions`）→ 回寫狀態。

## 自動測試

`tests/e2e.js` 在本機跑完整流程：三位長輩用手機送出（含斷線重送）→ `Code.gs`（以 `tests/gas_server.js` 模擬 Apps Script 與 302 轉址）→ 試算表 → 會議議程 → `feedback_digest.py` 摘要 → 回寫狀態。

```bash
NODE_PATH=<含 playwright 的 node_modules> node tests/e2e.js
```

限制：試算表公式（意見整理、圖表資料）不在模擬器內計算，已另外用真實 Google 試算表驗證過。

## 防護與限制

- 同一次送出用「送出編號」去重；網路不穩重送不會重複寫入。
- 每分鐘最多 30 次送出；單次最多 80 則意見；隱藏欄位擋簡單機器人。
- 以 `= + - @` 開頭的文字會加上 `'`，避免被試算表當成公式。
- 送出的網址是公開的，任何人理論上都能寫入垃圾資料；若遇到，可在 Apps Script 停用部署或重新部署換網址。
