# 東正小遊戲（toushou）第 2 階段：多裝置連線 設計規格

日期：2026-10-15
狀態：已與使用者確認
前置：`docs/superpowers/specs/2026-10-15-toushou-game-design.md`（第 1 階段，規則不變）

---

## 1. 目標

同一局遊戲可以由多台裝置共同進行；單機傳遞模式維持可用。
**統一模型**：每台裝置「擁有」一或多個座位。單機模式＝一台裝置擁有全部座位；連線模式下，沒被認領的座位由主持人裝置擁有。
同一台裝置擁有多個座位時，需要保密的步驟沿用第 1 階段的遮蔽畫面輪流操作。

## 2. 房間

- 開局設定新增「連線模式」開關。開啟時按鈕改為「建立房間」：
  1. `PriTestGameStorage.generateCloudGameId()` 產生 `g` + 32 hex 的房間 id。
  2. 以 `rtSet(id, "cloud", "toushou", { stateJson, hostId, seats: {} })` 建立房間，**等寫入完成**再更新網址為 `?room=<id>`（`history.replaceState`，不重新載入）。
- 主持人畫面有可收合的「房間」面板：QR Code（`PriTestQRCode.renderToCanvas`）、連結、各座位的認領狀態。
- 開啟 `?room=<id>` 的裝置訂閱房間；座位清單中點選空座位即可認領（`rtTransaction` 寫 `seats/<playerId>`，只有空位才成功），也可以釋放自己的座位。
- 裝置 id：`localStorage["pritest-toushou-client"]`（`c` + 16 hex）。重新整理或重開連結會自動回到原座位。
- 房間不存在或已結束 → 顯示訊息與「回到設定」。

## 3. 雲端資料

```
games/<roomId>/rtState/toushou = {
  stateJson: "<JSON.stringify(state)>",   // RTDB 會刪掉空陣列/空物件/null，所以整份 state 存成字串
  hostId: "<clientId>",
  seats: { "<playerId>": "<clientId>" }
}
```

- 所有遊戲操作：`rtTransaction(roomId, "cloud", "toushou/stateJson", fn)`，`fn` 解析目前字串 → `Core.reduce` → 回傳新字串；
  `reduce` 拋錯時中止 transaction（回傳 `undefined`），並在畫面顯示錯誤。
- 不修改 `database.rules.json`（`rtState` 已允許）。
- 秘密資訊（下注、手牌、任務）只在擁有該座位的裝置顯示；雲端資料對持有房間連結者可讀，**無法防止用開發者工具偷看**（派對遊戲可接受，已告知使用者）。

## 4. 操作權限（在 UI 端檢查）

| 階段／操作 | 誰可以操作 | 其他裝置顯示 |
| --- | --- | --- |
| 看任務 `missionSeen` | 擁有該座位的裝置，各座位同時進行 | 已確認 x / n |
| 下注 `placeBet` | 擁有該座位的裝置，不限順序 | 已下注 x / n |
| 釋放消息 `releaseNews` | 擁有本回合股東座位的裝置 | 等待 ○○ 釋放消息 |
| `startBetting`／`applyDelta`／`nextTarget`／放棄本局 | 主持人裝置 | 即時同步的標的卡與消息面 |
| 整局結算後「回到設定」 | 任何裝置（只影響自己） | — |

## 5. 規則引擎修改（`toushou_core.js`）

- **下注不限順序**：`betError` 改為檢查「是本標的的下注者且尚未下注」；`nextBettor` 保留（回傳座位順序第一個未下注者，單機 UI 用）。全員下注完成時的處理不變。
- **任務逐人確認**：新增 action `{ type: "missionSeen", playerId }` 與 `state.missionsSeen = { [playerId]: true }`；全員確認後進入 `reveal_target`。移除 `missionsDone`。
- 新增 `pendingBettors(state)`、`pendingMissionViewers(state)` 供 UI 顯示進度。

## 6. UI 修改（`toushou.js`）

- 抽象出「後端」：本機（`localStorage`）與雲端（transaction＋訂閱）兩種，`dispatch(action)` 對兩者一致。
- `mySeats()`：單機＝全部；連線＝我認領的座位＋（若我是主持人）未被認領的座位。
- 遠端更新觸發重繪時，保留輸入框內容與焦點（依元素 id 暫存）；本機操作成功後清除暫存。
- 單機模式的存檔 key 不變；連線模式不寫 `pritest-toushou-state`，只在 `localStorage["pritest-toushou-room"]` 記錄最近的房間 id（重新開啟頁面時自動回到房間）。

## 7. 驗證

1. `node tools/toushou_check/core_check.js`（含新增的引擎檢查）。
2. `tools/toushou_check/ui_check.js`（單機整局，維持通過）。
3. 新增 `tools/toushou_check/multi_device_check.js`：使用 Firebase Local Emulator（`sessionStorage.pritestRtdbEmulator = "1"`），
   3 個瀏覽器 context 當 3 台裝置：主持人建房 → 另兩台以連結加入並認領座位 → 同時下注 → 各自釋放消息 → 主持人輸入加減分 → 跑完整局，
   檢查三台裝置的 state 一致、秘密資訊只出現在擁有者畫面、重新整理後回到原座位。
