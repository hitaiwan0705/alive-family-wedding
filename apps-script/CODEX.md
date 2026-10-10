# 給 Codex：長輩意見整合與交接

你的角色：把長輩在婚禮小冊留下的意見**整理**給新人看，新人決定後再**落地**到 Alive 與網頁。**你只整理、只照決定做，不替新人或兩家下結論。**

```
長輩在網頁留意見 ─→ Google 試算表「婚禮小冊・長輩意見」
        ↓ ① 整理（digest）              ← Codex
  Alive/docs/意見摘要/日期.md
        ↓ ② 決定（採納／部分採納／不採納／已回覆） ← 新人
        ↓ ③ 落地：Alive data/ → Wedding_Family.md → content.js → 網頁 ← Codex
        ↓ ④ 回寫處理狀態（mark）         ← Codex
  長輩打開網頁，看到「依○○的意見」已更新
```

## 0. 一次性設定：怎麼拿到意見

兩種方式擇一，**都不可**把資料或 token 寫進 alive-family-wedding（公開儲存庫）。

| 方式 | 需要 | 適合 |
|---|---|---|
| A. token 自動讀取 | 環境變數 `ALIVE_FEEDBACK_ENDPOINT`＝`config.js` 的 `sheetEndpoint`；`ALIVE_FEEDBACK_TOKEN`＝Apps Script「專案設定 → 指令碼屬性 → `READ_TOKEN`」（或 `setup()` 執行記錄裡那串） | 定期自動整理、回寫處理狀態 |
| B. 下載 CSV | 新人在試算表開「意見明細」分頁 →「檔案 → 下載 → 逗號分隔值（.csv）」，「意見送出紀錄」同樣下載一份，放進 `Alive/docs/意見摘要/raw/` | 沒有設定 token、網路連不到 `script.google.com` 時 |

## 1. 整理：產生摘要（只整理，不決定）

```bash
# A. token
python3 apps-script/feedback_digest.py digest --out "$ALIVE_DIR/docs/意見摘要/$(date +%F).md"
# B. CSV（不需 token）
python3 apps-script/feedback_digest.py digest \
  --from-csv "$ALIVE_DIR/docs/意見摘要/raw/意見明細.csv" \
  --submissions-csv "$ALIVE_DIR/docs/意見摘要/raw/意見送出紀錄.csv" \
  --out "$ALIVE_DIR/docs/意見摘要/$(date +%F).md"
```

- 只看某天之後：加 `--since 2026-10-20`。全部（含已處理）：加 `--status all`。
- 摘要開頭「會議先談這三項」與試算表「會議議程」同一套排序（同一項目 2 則以上、看法最分歧者優先）。
- 摘要含長輩稱呼，只存 Alive（P／C 層級）。沒有新意見時不必通知新人。

然後在摘要最後加一段 **「對照 Alive 資料」**，只陳述事實與差距，不寫「建議採納」：

| 試算表「類型」 | 用「項目代碼」對照 | 寫什麼 |
|---|---|---|
| 預算、新增花費 | `B-001` 等 → `data/budget.csv` | 目前建議預算、狀態、長輩建議金額與差距 |
| 日期 | `date:proposal` 等 → `data/date_candidates.csv` | 候選日、禮俗註記、`文字` 欄的建議日期 |
| 當天行程、準備清單 | `sched:`／`prep:` → `data/process.csv`、`occasions.yaml` | 長輩想增減的步驟或物品 |
| 方案傾向 | `compare:wedding` → 午宴／晚宴方案 | 各方案則數 |
| 一起商量 | `q:雜湊` → `content.js` 的 `questions`（以題目文字對應） | 「看法」欄是選項，「文字」欄是補充 |

場合代碼：`proposal`＝P1/P2、`registration`＝P3、`engagement`＝P4、`wedding`＝P5/P6、`questions`＝一起商量。「由誰負擔」欄已停用（男方與新人是同一筆錢），會是空的。

## 2. 落地：新人決定後才做

1. **改 Alive `data/`**（依意見類型：`budget.csv`、`date_candidates.csv`、`occasions.yaml`、`process.csv`、`decisions.csv`、`project.yaml`、`current_followups.csv`、`proposal_travel.csv`），在 `decisions.csv` 記一筆，來源寫「長輩意見表 意見編號 ○○」。
2. 重建 `build/Wedding_Family.md`，跑原本的驗證（Critical／High 為 0）。
3. **同步網頁 `content.js`**：只取 Visibility＝F；預算合計必須等於 `Wedding_Family.md` 的「本版可見預估合計」；`version` 加一版、`updated` 改日期；`decisions` 補一筆，說明寫「依○○的意見」，讓長輩看到意見有被採用。
4. 執行 `node tools/stamp-assets.js`（更新版本號，避免長輩手機用到舊快取），再跑 `tests/e2e.js`，開 PR 合併到 `main`。
5. **回寫處理狀態**（每則意見一行）：

   ```bash
   python3 apps-script/feedback_digest.py mark <意見編號> 採納 "已更新家庭討論版 08"
   ```

   狀態只能是：待處理、採納、部分採納、不採納、已回覆。沒有 token 時，請新人在「意見明細」最後兩欄手動填。

## 3. 單則意見交接單（新人已經決定時）

新人或其他工具已決定、甚至已改了網頁時，用這個格式寫到 `Alive/docs/意見摘要/日期_主題.md`，Codex 依單落地，不再重新判斷：

```markdown
# 意見交接：<主題>
- 意見編號：<試算表意見編號>
- 提出者：<稱呼／身分>　原話：「<文字欄原文>」
- 新人決定：採納／部分採納／不採納（<日期>）
- 網頁已改：<content.js 版本與改了哪些段落；沒改就寫「未改」>
- 請 Codex 更新 Alive：<要改的 ID 與檔案>
- 回寫：mark <意見編號> <狀態> "<處理說明>"
```

## 網頁用語與揭露規則

- 只放 Visibility＝F 的內容。資金來源與周轉、私人帳目、家族內部談話（P／C 層級）不可出現在網頁或這個儲存庫。
- 這是新人自己的婚禮企劃：一律寫「**擬定**」，不寫「新人決定／新人安排」；候選、提案不可升成「已確認」。
- 預算只列**男方家**；男方與新人是同一筆錢，不寫負擔分配（不使用 `split`／`parties`）；不提女方家的預算，也不寫「訂婚宴由誰主辦」這類基本禮俗。
- 「一起商量」：`{ q, scope, choices }`，`scope` 為 `both`（兩家一起商量）或 `couple`（擬定・請您一起出主意）；一題只問一件事；不要和日期卡、方案比較、預算列重複提問。

## 規則

- **不可**因為長輩意見直接改 `content.js` 或 `data/`；一定先經新人決定（或依新人寫好的交接單）。
- 多位長輩意見分歧時，照實列出，不替任何一方下結論。
- token 只放環境變數；不寫進任何檔案、不貼進對話紀錄。讀取失敗（`forbidden`）代表 token 錯誤或已更換，回報新人，不要重試猜測。

## 建議頻率

- 平常：每週一次（例如週日晚上）。
- 家庭會議或提親、訂婚前 3 天：每天一次。

macOS 排程範例（每週日 20:00，`crontab -e`）：

```cron
0 20 * * 0 cd ~/Code/alive-family-wedding && ALIVE_FEEDBACK_ENDPOINT=... ALIVE_FEEDBACK_TOKEN=... python3 apps-script/feedback_digest.py digest --out "$HOME/Library/CloudStorage/Dropbox/Alive/docs/意見摘要/$(date +\%F).md"
```

## 交給 Codex 的指令範本

**① 例行整理**

> 請依 alive-family-wedding/apps-script/CODEX.md 第 1 節整理長輩意見：產生摘要存到 Alive/docs/意見摘要/，最後加「對照 Alive 資料」。完成後告訴我檔案位置與「會議先談這三項」。不要修改 data/、content.js，也不要回寫處理狀態，等我決定。

**② 我決定後落地**

> 依 CODEX.md 第 2 節落地以下決定：<意見編號：採納／部分採納（怎麼改）／不採納（原因）>。改 Alive data/ 並重建驗證，同步 content.js（只取 F、合計要對上），執行 stamp-assets 與 e2e，開 PR 合併，最後回寫每則處理狀態。完成後列出改了哪些檔案與網頁版本。

**③ 依交接單落地**

> 請讀 Alive/docs/意見摘要/<交接單檔名>，依 CODEX.md 第 3 節落地：只做交接單寫的更新，網頁已改的部分不要覆蓋；完成後回寫處理狀態並告訴我結果。
