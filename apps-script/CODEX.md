# 給 Codex：定期整理長輩意見

你的角色：把長輩在婚禮小冊留下的意見，整理成新人看得懂的摘要。**你只整理，不做決定。**

## 每次要做的事

1. 讀取待處理的意見並產生摘要：

   ```bash
   python3 apps-script/feedback_digest.py digest --out "$ALIVE_DIR/docs/意見摘要/$(date +%F).md"
   ```

   - `ALIVE_DIR` 是新人的 Alive 專案資料夾（Dropbox `/Alive`）。摘要含長輩稱呼，屬 P／C 層級，**只存 Alive，不可提交到 alive-family-wedding 這個公開儲存庫。**
   - 只想看某天之後的新意見：加 `--since 2026-10-20`。
   - 沒有新意見時，摘要會寫「目前沒有需要處理的意見」，不必通知新人。

   - 摘要開頭的「會議先談這三項」與試算表「會議議程」頁使用同一套排序（看法最分歧者優先）。

2. 在摘要最後加一段「對照 Alive 資料」：
   - 預算類：用「項目代碼」（`B-001` 等）對照 `data/budget.csv`，列出目前 `建議預算`、`狀態`，以及長輩建議與它的差距。
   - 日期類：對照 `data/date_candidates.csv` 的候選日與禮俗註記。
   - 場合代碼對照：`proposal`＝P1/P2、`registration`＝P3、`engagement`＝P4、`wedding`＝P5/P6、`questions`＝一起商量。
   - 只陳述事實與差距，不寫「建議採納」。

3. 通知新人摘要已更新（附檔案路徑），等新人決定。

4. 新人決定後才做：
   - 依決定修改 Alive `data/`，再同步 `content.js`（更新 `version`、`updated`，在 `decisions` 補一筆），走原本的建置與驗證流程。
   - 每則意見回寫處理狀態：

     ```bash
     python3 apps-script/feedback_digest.py mark <意見編號> 採納 "已改進 content.js 版本 05"
     ```

     狀態只能是：待處理、採納、部分採納、不採納、已回覆。

## 規則

- **不可**因為長輩意見直接改 `content.js` 或 `data/`；一定先經新人決定。
- **不可**把候選、提案升成「已確認」。
- 多位長輩意見分歧時，照實列出，不要替任何一方下結論。
- token 只放環境變數 `ALIVE_FEEDBACK_TOKEN`；網址放 `ALIVE_FEEDBACK_ENDPOINT`。不寫進任何檔案、不貼進對話紀錄。
- 讀取失敗（`forbidden`）代表 token 錯誤或已更換，回報新人，不要重試猜測。

## 建議頻率

- 平常：每週一次（例如週日晚上）。
- 家庭會議或提親、訂婚前 3 天：每天一次。

macOS 排程範例（每週日 20:00，`crontab -e`）：

```cron
0 20 * * 0 cd ~/Code/alive-family-wedding && ALIVE_FEEDBACK_ENDPOINT=... ALIVE_FEEDBACK_TOKEN=... python3 apps-script/feedback_digest.py digest --out "$HOME/Library/CloudStorage/Dropbox/Alive/docs/意見摘要/$(date +\%F).md"
```

## 交給 Codex 的指令範本

> 請依 alive-family-wedding/apps-script/CODEX.md 整理長輩意見：執行 digest 存到 Alive/docs/意見摘要/，在摘要最後加「對照 Alive 資料」（budget.csv、date_candidates.csv），完成後告訴我檔案位置與「先看這幾項」的內容。不要修改 content.js 或 data/，也不要回寫處理狀態，等我決定。
