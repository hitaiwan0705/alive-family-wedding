# 給家人的婚禮小冊

這個儲存庫只放家庭可見的靜態網頁（GitHub Pages）。婚禮專案的完整資料、試算表、賓客名單與財務模型留在私人的 Alive 專案，不放進來。

## 頁面內容（家庭討論版 04，對應 Alive v6）

- 一眼看完：提親 → 登記 → 訂婚 → 結婚，四件事的日期、狀態與預算小計
- 每一件事：建議日期與候選日、婚顧提醒、當天行程（示意時間）、要準備的東西、這一場的預算
- 結婚一段另有「午宴／晚宴」三種迎娶排法的時間與多出費用比較，長輩可表態傾向（`phases[].compare`）
- 每個月要做什麼：2026-10 到 2027-08 的時間表，會自動標示「這個月」
- 預算總覽：依四件事、依負擔方（男方家／新人／女方家）的金額與比例
- 送出建議、已確認的事、資料來源

## 長輩怎麼留意見（互動設計）

分工：**內容由 Codex 維護 `content.js`；本儲存庫的 `index.html`、`app.js`、`styles.css` 只負責呈現與收集意見。** 互動層不寫死任何日期、金額或說明文字。

1. 頁首「怎麼留意見？三個步驟」說明整個流程。
2. 全頁只有一種入口：**「我有意見」** 按鈕，出現在每一場的日期、當天行程、準備清單和每一筆預算旁。午宴／晚宴比較則是一鍵「我比較傾向這個」。
3. 按下後跳出同一種視窗：先**點一個看法**（例如「太多，可以少一點」「這天不方便」），需要時才出現「建議多少錢」或「改由誰負擔」，最後可打字或用鍵盤麥克風說。只有看法或文字其中一個是必填。
4. 記下後畫面底部出現提示「已記下（還沒傳出）」，可以按「復原」；卡片上會標出「我的意見」，底部常駐「已記下 N 則意見｜傳給新人」。
5. 最下面「傳意見給新人」三步驟：檢查清單（可修改、刪除）→ 稱呼 → 綠色「用 LINE 傳給新人」。Email、複製文字收在「沒有 LINE？其他方式」。

技術說明：

- 意見只存在長輩自己的瀏覽器（localStorage `alive-wedding-draft-v2`，會自動讀入 v1 舊草稿），不會上傳，也不會改到 `content.js`。
- LINE 訊息前半是可讀的意見清單，後半是 `#p=` 連結（新人用）。新人點開進入唯讀檢視，頂端「複製提案資料」可取得 JSON，交給 Codex 判斷是否採納。

## 給 Codex：`content.js` 欄位約定

`app.js` 只讀下列欄位；缺少的選填欄位會自動略過。

| 欄位 | 必填 | 說明 |
|---|---|---|
| `title`、`version`、`updated`、`notice` | 是 | 頁首資訊；`version` 會寫進長輩的意見，用來判斷意見是針對哪一版 |
| `parties` | 是 | 負擔方代碼與名稱，固定 `groom`／`couple`／`bride` |
| `phases[].id`、`label`、`short`、`when`、`status` | 是 | `id` 不要更改，否則舊的意見連結對不上 |
| `phases[].target` | 選填 | `YYYY-MM-DD`，用於首頁「下一件事」倒數 |
| `phases[].candidates`、`place`、`why`、`avoid` | 選填 | 日期卡內容 |
| `phases[].schedule[]` | 選填 | `{time, title, detail, who}`；`scheduleNote` 為行程下方註記 |
| `phases[].prepare[]` | 選填 | `{group, items:[{text, who}]}` |
| `phases[].budget[]` | 選填 | `{id, name, amount, low, high, split, note, status}`；`private: true` 不列金額；`locked: true` 不開放意見。`id` 沿用 Alive `Budget_ID`，不要更改 |
| `phases[].budgetNote` | 選填 | 該場沒有預算項目時顯示 |
| `phases[].compare` | 選填 | 方案比較：`title`、`intro`、`options[]`（`id`、`name`、`sub`、`times`、`costs[{item, low, mid, high}]`、`points`）、`conclusion`、`unknown`、`sources` |
| `budgetNotes[]` | 選填 | 預算總覽下方註記 |
| `months[]` | 選填 | `{month:'YYYY-MM', focus, tasks:[{text, who}]}` |
| `questions[]`、`decisions[]`、`sources[]` | 選填 | 討論題、已確認紀錄、資料來源 |
| `feedback.email` | 選填 | 設定後才出現 Email 寄出 |

## 揭露原則

- 只放 Alive `data/` 中 Visibility = F 的內容。C／P 層級（個人資金、借款、蜜月、三姑位置、私下談話）不得出現在這裡。
- 這是公開儲存庫，GitHub Pages 網址任何人拿到都能看；`index.html` 已加 `noindex` 減少被搜尋引擎收錄，但這不是存取控制。
- 「已確認」與「建議」必須分開；收到的建議不會自動改成已確認。
- 兩家看同一份頁面，不另做男方版／女方版；大聘等金額照實寫明尚未談定的部分。

## 本機瀏覽

直接開啟 `index.html` 即可。沒有外部相依套件或追蹤碼。
