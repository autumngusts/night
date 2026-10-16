# 東正小遊戲（toushou）進階 1：全員投票決定加減分 設計規格

日期：2026-10-16
狀態：已與使用者確認
前置：
- `docs/superpowers/specs/2026-10-15-toushou-game-design.md`（第 1 階段規則）
- `docs/superpowers/specs/2026-10-15-toushou-multidevice-design.md`（第 2 階段多裝置連線）

---

## 1. 目標

釋放消息後的加減分，除了原本「主持人輸入全場共識」之外，新增「全員秘密投票、取平均」的方式。
原本的主持人輸入方式保留，作為開局設定的選項。

## 2. 開局設定

| 設定 | 選項 | 預設 |
| --- | --- | --- |
| 加減分方式 `deltaMode` | `host`（主持人輸入）／`vote`（全員投票） | 連線模式：`vote`；單機模式：`host` |
| 每票上限 `voteCap` | 整數 10～200（只在 `vote` 時顯示） | 100 |

- 切換「連線模式」開關時，若使用者尚未手動改過加減分方式，預設值跟著切換。
- 每一票必須是 −`voteCap`～＋`voteCap` 的整數（含兩端）。

## 3. 流程（`deltaMode = "vote"`）

1. 股東釋放消息 → 進入 `vote` 階段（與現在相同）。
2. **全員（包含股東）秘密投票**，各投一個整數，不限順序、可同時進行。
   - 連線模式：擁有該座位的裝置投票；未被認領的座位由主持人裝置代投（沿用 `mySeats()`）。
   - 同一裝置擁有多個座位（單機模式或主持人代投）：沿用遮蔽畫面輪流投票。
   - 其他裝置只顯示「已投票 x / n」，不顯示票的內容。
3. 全員投完後自動計票：
   1. `avg = 所有票總和 / 票數`。
   2. 四捨五入取整，.5 往遠離 0 的方向進位（2.5→3、−2.5→−3）。
   3. 風向卡限制：`up` 且結果 < 0、或 `down` 且結果 > 0 → 結果為 0。`neutral` 或無風向卡不限制。
   4. 以結果作為加減分，套用與現在 `applyDelta` 相同的後續處理（價格下限 0、寫入消息面、換下一位股東或進入結算）。
4. 消息面的該則消息額外記錄並顯示：每位投票者的票、平均值（顯示到小數第 1 位）、最終加減分。
   若因風向卡被歸 0，顯示說明。

**略過未投票者**：主持人裝置可按「略過未投票者」，以已投出的票立即計票。至少需要 1 票，否則不能略過。

`deltaMode = "host"` 時流程與現在完全相同（主持人輸入整數，風向卡在輸入時限制正負，無上下限）。

## 4. 規則引擎修改（`toushou_core.js`）

- `config.deltaMode`（預設 `"host"`）、`config.voteCap`（預設 100）。舊存檔缺少欄位時視為 `"host"`。
- `releaseNews` 進入 `vote` 階段時，`current.votes = {}`。
- 新增 action：
  - `{ type: "castVote", playerId, value }`：只在 `deltaMode = "vote"` 且 `phase = "vote"` 時有效；
    `playerId` 須為本局玩家且尚未投票；`value` 為整數且 |value| ≤ `voteCap`。全員投完時自動計票。
  - `{ type: "skipPendingVoters" }`：`deltaMode = "vote"`、`phase = "vote"`、至少 1 票時，以現有票計票。
- `applyDelta` 只在 `deltaMode = "host"` 時有效。
- 新增函式：`voteError(state, playerId, value)`、`pendingVoters(state)`、`tallyVotes(votes, wind)` → `{ avg, raw, delta, windZeroed }`。
- 消息紀錄 `news[i]` 在投票模式下額外有 `votes`（`{ playerId: value }`）、`avg`、`windZeroed`。
- 任務卡判定讀 `news[i].delta`，不需修改。
- 新增錯誤 i18n key：`ts_err_vote_mode`、`ts_err_vote_range`、`ts_err_already_voted`、`ts_err_no_votes`。

## 5. UI 修改（`toushou.js`）

- 開局設定加入兩個欄位（第 2 節）。
- `vote` 階段：
  - `host` 模式：維持原畫面。
  - `vote` 模式：輪到自己擁有的座位時顯示投票輸入框與「確認投票」；其他狀態顯示「已投票 x / n」；
    主持人裝置在有人未投票時多一個「略過未投票者」按鈕。
- 消息面顯示每則消息的票與平均。
- 遠端更新時保留輸入值（沿用第 2 階段的機制）。

## 6. i18n

`zh`、`ja` 新增所需 `ts_*` key；`en` 暫時 fallback 到 `zh`（語系完善另案處理）。

## 7. 驗證

1. `tools/toushou_check/core_check.js` 新增：平均與四捨五入（含負數 .5）、風向歸 0、上限檢查、重複投票、略過（0 票不可略過）、host 模式拒絕 `castVote`、vote 模式拒絕 `applyDelta`、舊存檔無 `deltaMode` 時為 host。
2. `tools/toushou_check/ui_check.js`：維持 host 模式整局通過，並新增單機 vote 模式（遮蔽畫面輪流投票）至少一個標的。
3. `tools/toushou_check/multi_device_check.js`：改為 vote 模式，三台裝置各自投票；驗證其他裝置看不到票的內容、計票結果一致；另測一次主持人「略過未投票者」。
