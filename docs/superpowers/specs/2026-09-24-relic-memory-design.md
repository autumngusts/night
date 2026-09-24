# 遺物記憶（Relic Memory）設計

日期：2026-09-24
對象：midnight（`static_src/midnight.js`／`site_src/midnight_page.py`）

## 1. 功能概要

- 一局遊戲中，隊伍達成條件時全員各自累積「遺物記憶」。
- 遺物記憶分為 **小／中／大**，分別帶有 **1／2／3 個附帶效果**（`CharacterDrawer` 的 `ATTACHED_EFFECT_BLOCKS`，全 24 種）。同一個記憶內效果不重複。
- 遊戲結束（擊敗夜王後關閉勝利彈窗，或全員同意放棄遊戲）時，開啟「遺物記憶結算」視窗，一次展示本局獲得的全部遺物記憶；玩家輸入 5 位記憶密碼後，全部存入該密碼。
- 下次建立房間時，在等待房自己的席位輸入記憶密碼，從已保存的記憶中選擇最多 3 個帶入遊戲，效果在開局時套用。
- 帶入中的遺物記憶顯示在角色視窗「消耗品」的下一行，可隨時查看效果。
- 遊戲進行中**不顯示**本局獲得的記憶格子，只在獲得時跳 toast；結算時才一次展示。

## 2. 記憶密碼與 Firebase 儲存

### 2.1 密碼

- 格式：5 位大寫英數字 `^[A-Z0-9]{5}$`。
- 只有預先發行的 **20 組** 序號有效。序號以一次性腳本產生，**不提交進 Git**，由管理者在 Firebase Console 匯入：

```
relicMemoryCodes/<CODE>: true
```

### 2.2 資料結構

```
relicMemories/<CODE>/<memId>: {
  size: "s" | "m" | "l",
  effects: ["attack_dmg", "max_hp_up", ...],   // 1〜3 個附帶效果 id，互不重複
  createdAt: <ms>,
  favorite: false,
  source: "start" | "tiles" | "strong" | "day1" | "day2" | "boss"
}
```

- `memId`：`m` + 16 位 hex，客戶端產生。`database.rules.json` 對 `$memId` 有嚴格 `.validate`：`^m[0-9a-f]{16}$`。
- **上限 100 個**。保存時以 `relicMemories/<CODE>` 的 transaction 一次追加；超過 100 時，從 `favorite !== true` 中 `createdAt` 最舊者開始丟棄。若最愛已佔滿導致新記憶放不下，放不下的部分不存入，並在結算視窗顯示件數。
- 保存不做逐個挑選：全部一起存，不需要的之後用編輯模式刪除。

### 2.3 安全規則（`database.rules.json`）

新增與 `games` 同層的節點：

```json
"relicMemoryCodes": { ".read": false, ".write": false },
"relicMemories": {
  "$code": {
    ".read":  "auth != null && root.child('relicMemoryCodes').child($code).exists()",
    ".write": "auth != null && root.child('relicMemoryCodes').child($code).exists()",
    ".validate": "$code.matches(/^[A-Z0-9]{5}$/)",
    "$memId": {
      ".validate": "$memId.matches(/^m[0-9a-f]{16}$/)"
    }
  }
}
```

- 無效密碼的讀取會被拒絕，客戶端以此判斷「密碼無效」。
- 規則變更需手動 `firebase deploy --only database`（GitHub Actions 不會部署，見 CLAUDE.md §37）。
- `game_storage.js` 目前的 rt* API 綁定 `games/<gameId>/...` 路徑，需新增讀寫 `relicMemories/<CODE>` 的薄函式（沿用既有的 lazy-load Firebase／App Check／匿名登入流程）。

## 3. 本局獲得條件（隊伍共通，全員各得 1 個）

| 時機 | 獲得 |
| --- | --- |
| 進入遊戲（sessionStartAt 成立） | 小 ×1（必定） |
| 隊伍累計踏破板塊每 3 個 | 1 個：小 80%／中 20% |
| 隊伍累計擊殺強敵每 3 隻 | 1 個：小 80%／中 20% |
| 擊敗第一天夜之強敵 | 1 個：中 60%／大 40% |
| 擊敗第二天夜之強敵 | 中 ×1 ＋ 1 個：中 60%／大 40% |
| 擊敗夜王 | 大 ×1 ＋ 50% 機率再得大 ×1 |

判定來源（重用既有判定，不新增第二套）：

- 板塊踏破：`fieldProgress[pointId].cleared === true` 的地圖點數。
- 強敵擊殺：`type === "strong_enemy"` 的地圖點其 fieldTrigger 已 resolved 且 HP 歸零（與既有「後補領獎」判定相同）。
- 第一／二天夜之強敵：`finalCircleBossDefeated(1)`／`finalCircleBossDefeated(2)`。
- 夜王：`day3BossDefeated()`。

### 3.1 同步方式

- 隊伍層級：`meta.relicMemoryGrants` 為以 grantKey 為鍵的物件 `{ <grantKey>: { kind, at } }`
  （grantKey 例如 `tiles1`、`strong1`、`day1`、`day2`、`boss`），以 transaction 對單一 key 做
  first-writer-wins 寫入，避免多台裝置重複追加同一個 key。
- 個人層級：每台裝置只處理自己的 `myTokenId`。角色物件上用**單一子節點**
  `character/<token>/relicMemory: { earned: Memory[], seen: { <grantKey>: true } }` 保存——
  `earned` 是自己擲出的記憶清單，`seen` 是已經處理過的 grantKey 集合（取代原本規劃的數字游標
  `relicMemoryGrantCursor`，因為 `meta.relicMemoryGrants` 本身是鍵值物件而非陣列，用 key 集合
  比游標索引更直接）。對照 `meta.relicMemoryGrants` 找出尚未在 `seen` 裡的 key，各自擲大小與
  效果後一次寫回。
  - **fix round 1（2026-09-24 review）**：`earned`／`seen` 原本規劃各自是角色物件上的 top-level
    欄位（`c.relicMemoryEarned`／`c.relicMemoryGrantSeen`），對整個 `character/<token>` 做
    transaction。實測發現戰鬥中 consumables／冷卻等其他子路徑的一般 `rtSet()` 頻繁發生，
    跟這個大範圍 transaction 同時作用在同一節點時 Firebase SDK 會丟出 `Error: set` 讓
    transaction 失敗、發放被跳過。改成上述的單一子節點 `character/<token>/relicMemory`，
    transaction 範圍縮小到不會再跟其他子路徑寫入互撞。
- 中途加入：佔用席位當下把 `relicMemory.seen` 灌滿當時已存在的所有 grantKey，只取得之後的事件；
  「進入遊戲必得小 ×1」例外，全員都有。
- **戰鬥模擬房**（`battleSimEnabled()`）不產生獲得事件，但可以帶入記憶。
- 重新開始一輪（`handleRestartCycle()`）時一併清空 `meta.relicMemoryGrants`，各角色的
  `character/<token>/relicMemory` 也重置為 `{ earned: [小×1（非戰鬥模擬房）], seen: {} }`。

## 4. 效果套用

- 開局時把等待房選定的記憶（最多 3 個）複製到角色的 `c.relicMemoryLoadout`（`[{ memId, size, effects }]`）。
- `CharacterDrawer` 新增 `activeAttachedEffectIds(c)`：回傳「`learnedAttachedEffects` ＋ 帶入記憶的效果」。
- **重複計算**：各附帶效果可否疊加將由使用者之後逐一指定。此版先以效果定義上的 `stackable` 旗標（預設 `false`）控制：`false` 的效果重複時只算 1 次；`true` 的效果依出現次數疊加。之後只需修改旗標與該效果的加算處理。
- 所有「判定效果」的讀取點改用該 helper：`character_drawer.js` 的計算系（`attachedFlatMaxStatBonus`、`attachedSkillDamageBonus` 等）與 `midnight.js`（跳躍／衝刺攻擊等）。習得上限、置換、習得 UI 仍只看 `learnedAttachedEffects`。`night.js` 不修改。
- `status_resist`／`element_resist`：開局時呼叫既有 `assignAttachedResistChoiceIfNeeded` 隨機決定。

## 5. 放棄遊戲（全員同意制）

- HUD 與遊戲失敗彈窗新增「放棄遊戲」按鈕。
- 按下後寫入 `meta.abandonVote = { proposedBy, votes: { <token>: true|false } }`，所有已佔用席位的玩家看到投票彈窗（同意／反對）。
- 需要同意的名單是**在線的已佔用席位**（`readyGateSlots()`：已佔用席位中先取在線者，全部離線時才退回全部已佔用席位），離線席位不計入、也不會卡住投票——跟夜之王 Day3 開始準備閘門（`maybeTriggerDay3FromReady()`）用同一套 presence-aware 名單。
- 全員（`readyGateSlots()` 名單）同意 → transaction 寫入 `meta.gameAbandonedAt`，全員進入結算視窗，遊戲結束。
- 任一人反對 → 清除 `meta.abandonVote`，遊戲繼續。
- 提案者本人視為已同意。

## 6. UI

### 6.1 角色視窗

- 「消耗品」下一行新增「遺物記憶」區塊（最多 3 格，只顯示帶入中的記憶）。
- 點擊格子，右側詳細欄顯示大小與效果名稱／本文（重用 `selectCharacterSheetItem` 既有模式，新 kind `"relicMemory"`）。
- 沒有帶入時整個區塊隱藏。

### 6.2 結算視窗

- 觸發：勝利彈窗按下確認後，或 `meta.gameAbandonedAt` 成立。
- 內容：本局獲得的全部記憶（大小＋效果），記憶密碼輸入欄、保存按鈕、關閉按鈕。
- 保存結果：成功件數、因上限丟棄的件數、因最愛佔滿未能存入的件數；密碼無效時顯示錯誤。
- 保存成功後按鈕變為已保存，避免重複保存。

### 6.3 等待房

- 自己的席位下方新增「記憶密碼」欄與「讀取」按鈕。
- 讀取成功後顯示保存的記憶清單：可勾選最多 3 個（帶入）。
- 「編輯模式」切換：每筆出現 ★（最愛切換）與刪除按鈕；刪除即時寫回 Firebase。
- 選擇結果寫入 `players/<slot>/relicMemoryLoadout`（`GameStorage.rtTransaction`；等待房階段角色物件尚未建立，因此掛在 slot 而不是 `character/<token>`），開局時由 `newCharacterForSlot()` 複製成 `c.relicMemoryLoadout`。密碼只存在本地（localStorage，便利用），不寫進遊戲 state。

## 7. i18n

新增字串放在 `site_src/i18n_data_zh.py`／`_ja.py`／`_en.py`，key 前綴 `midnight_relic_memory_*`。

## 8. 驗證

- `node --check` 所有修改的 JS。
- 新增臨時／回歸腳本 `tools/midnight_check/relic_memory_check.js`（Playwright，一律 `dispatchEvent`，見 CLAUDE.md §4.6）：
  1. 開局取得小 ×1。
  2. 模擬板塊踏破 3 個 → 事件追加一次、每名玩家各多 1 個。
  3. 保存：超過 100 時丟棄最舊非最愛；最愛不被丟棄。
  4. 帶入含 `max_hp_up` 的記憶 → HP 上限 +1；含 `attack_dmg` → 一般攻擊傷害反映。
  5. 放棄投票：一人反對即取消；全員同意進入結算。
- Firebase 部分需要真正的雲端環境；本地驗證時以已部署規則＋測試用序號進行。

## 9. 範圍外

- 各附帶效果的 `stackable` 實際指定（使用者之後提出）。
- 記憶的交換／轉移、密碼更換。
