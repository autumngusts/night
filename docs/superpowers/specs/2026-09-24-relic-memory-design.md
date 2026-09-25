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
  effects: [{ id: "attack_dmg", value: 12 }, { id: "max_hp_up" }, ...],  // 1〜3 個，id 互不重複
  createdAt: <ms>,
  favorite: false,
  source: "start" | "tiles" | "strong" | "day1" | "day2" | "boss"
}
```

- `effects` 的每一項是 `{ id, value }`：`value` 是產生這顆記憶當下依效果的 `range`
  擲定的數值（§10.2），之後永遠是那個值；沒有範圍的效果不帶 `value`
  （RTDB 存 `null` 等同刪 key）。
- **舊格式相容**：2026-09-25 的範圍接線之前產生的記憶，`effects` 是純字串陣列
  （`["attack_dmg", ...]`）。所有讀取點都走 `RM.effectEntries()`／`RM.effectIdList()`
  （`character_drawer.js` 因為不載入 `midnight_relic_memory.js`，改用自己的
  `relicMemoryEffectId()` 就地判型），字串會被視為「沒有擲過值」的 `{ id, value: null }`。
  **不需要資料遷移**，既有記憶照常生效。

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
  `character/<token>/relicMemory` 也重置為 `{ earned: [小×1（非戰鬥模擬房）], seen: {} }`
  （只寫本地已有 `character/<token>` 的席位，避免替還沒初始化角色的席位寫出只有 `relicMemory` 的殘缺節點）。
- **重新開始一輪的基準**（final review 2026-09-24）：restart 不會清掉 `fieldProgress`、強敵的
  `fieldTrigger`／`fieldEnemyHp`、`finalCircleDay1/2`，若直接用目前數量判定，新一輪第一影格就會把
  tiles1..N／strong1..N／day1／day2 全部重發（可被刷）。因此 restart 寫入的新 meta 帶
  `relicMemoryBaseline: { tiles, strong, day1, day2 }`（當下的踏破板塊數、強敵擊殺數、day1/day2 最終圈是否已擊敗），
  判定改用 `RM.cycleGrantKeys(counts, baseline)`：里程碑用 `max(0, count − baseline)`，day1/day2 只在基準旗標
  不是 `true` 時發；沒有基準＝0／false（第一輪）。夜之王（boss）不看基準——restart 本來就會清掉 day3 夜王節點。
- restart 同時寫入 `meta.cycleStartedAt`（只有 restart 會寫）。其他裝置在 `onMetaReceived()` 看到它換值時呼叫
  `resetRelicMemoryCycleLocalState()`，重置本地旗標（獲得節流、結算彈窗、放棄投票節流、勝利彈窗關閉旗標）並關閉結算彈窗；
  按下 restart 的裝置直接呼叫同一個 helper。不用 `sessionStartAt` 換值判斷，因為時間損失（`advanceCircleTimerBy()`）
  與測試用立即縮圈也會改寫 `meta/sessionStartAt`。

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
- 投票（加入自己的票）以 transaction 對整個 `meta.abandonVote` 進行，只有投票仍存在且有 `at` 時才寫入，避免投票剛被清掉時寫出沒有 `proposedBy`/`at` 的孤兒投票；缺少 `at` 的投票物件一律忽略（提案時可直接覆寫）。
- **逾時**（final review 2026-09-24）：`ABANDON_VOTE_TIMEOUT_MS = 60000`。`Date.now() − vote.at` 超過時，任一裝置以 transaction（僅在 `cur.at === vote.at` 時）清除 `meta.abandonVote`（同一次投票只送一次），並顯示「放棄投票逾時，遊戲繼續」toast。進度列顯示剩餘秒數。
- **不阻擋已投票者**：只有尚未投票的玩家看到阻擋式彈窗（同意／反對）；已投票者（含提案者）改為畫面上方不攔截點擊的小卡片（`.midnight-abandon-vote-passive`），不影響即時戰鬥。
- **撤回**：提案者在投票期間可按「撤回提議」，以同一個 guarded transaction 清除投票。
- 觀戰者（沒有席位）不顯示「放棄遊戲」按鈕。

## 6. UI

### 6.1 角色視窗

- 「消耗品」下一行新增「遺物記憶」區塊（最多 3 格，只顯示帶入中的記憶）。
- 點擊格子，右側詳細欄顯示大小與效果名稱／本文（重用 `selectCharacterSheetItem` 既有模式，新 kind `"relicMemory"`）。
- 沒有帶入時整個區塊隱藏。

### 6.2 結算視窗

- 觸發：勝利彈窗按下確認後，或 `meta.gameAbandonedAt` 成立。
- 內容：本局獲得的全部記憶（大小＋效果），記憶密碼輸入欄、保存按鈕、關閉按鈕。
- 保存結果：成功件數、因上限丟棄的件數、因最愛佔滿未能存入的件數；密碼無效時顯示錯誤。
- 保存成功後按鈕變為已保存（文字改為「已保存」並停用），避免重複保存。
- 自己的角色資料尚未到達（reload 後）時不開啟，下一影格再試；開著時 earned 有變化就重建清單，保存的正是保存當下畫面顯示的清單。

### 6.3 等待房

- 自己的席位下方新增「記憶密碼」欄與「讀取」按鈕。
- 讀取成功後顯示保存的記憶清單：可勾選最多 3 個（帶入）。
- 「編輯模式」切換：每筆出現 ★（最愛切換）與刪除按鈕；刪除即時寫回 Firebase。
- 選擇結果寫入 `players/<slot>/relicMemoryLoadout`（`GameStorage.rtTransaction`；等待房階段角色物件尚未建立，因此掛在 slot 而不是 `character/<token>`），開局時由 `newCharacterForSlot()` 複製成 `c.relicMemoryLoadout`。密碼只存在本地（localStorage，便利用），不寫進遊戲 state。
- 已選但不在目前讀取的密碼資料裡的記憶（另一組密碼選的、接管席位繼承來的）列在清單最上方（勾選中，取消勾選即移除）；未讀取任何密碼時也會列出。
- 兩個密碼輸入欄以 JS 設定 placeholder（`midnight_relic_memory_code_placeholder`）。

## 7. i18n

新增字串放在 `site_src/i18n_data_zh.py`／`_ja.py`／`_en.py`，key 前綴 `midnight_relic_memory_*`。

## 8. 驗證

- `node --check` 所有修改的 JS。
- `node tools/midnight_check/relic_memory_unit_check.js`（純函式，不需瀏覽器）：範圍擲值
  （含 variant 的 `high`）、專用門檻只限第二條、記憶帶值與舊格式相容、武器類別家族繼承、
  固定遺物的效果對應、抽選池的排除條件。
- `node tools/midnight_check/relic_memory_pool_coverage_check.js`（Playwright）：抽選池的
  **全覆蓋**檢查，見 §10.12。
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

---

# 10. 遺物記憶效果目錄（2026-09-24 追加規格）

來源：`photo/enemyPic/memory/memory.txt`（使用者提供的 Nightreign 遺物效果目錄）。
共 **415 條隨機效果** ＋ **18 個固定配置遺物**。

## 10.1 與既有附帶效果的關係：並存

使用者明確指示**並存**。`CharacterDrawer.ATTACHED_EFFECT_BLOCKS` 的 24 種附帶效果維持原樣，
這份目錄是**另一套**效果池。因此 §1「遺物記憶帶 1／2／3 個附帶效果」的來源會從
「只有 24 種附帶效果」擴充成「24 種附帶效果 ＋ 本目錄」，`allAttachedEffectIds()`
不可直接被取代。

**2026-09-25 已實作**（§10.11）：`midnight.js` 的 `relicMemoryDrawPool()` ＝
`CharacterDrawer.allAttachedEffectIds()`（24）＋ `Catalog.drawableEffectIds()`（369）＝ **393 條**。

## 10.2 數值：抽到時才擲範圍，效果越好機率越低

目錄中多數效果的換算說明是範圍（例「最大HP+10~30」「物理攻撃力上昇2~5%」）。

- **抽到該效果、產生那一顆記憶的當下才擲範圍**，擲定後永遠是那個值
  （與 `weapon_affixes.js` 的 `rollAffixValue()` 同一套做法，見該檔頭註）。
- 擲法**不是均勻分布**。使用者明確規格（2026-09-24）：
  **「前 80% 內容機率 80%、後 20% 機率 20%」**。
  實作為 `midnight_relic_memory.js` 的 `rollRangeValue(min, max, rand)`：
  把 `[min, max]` 依**長度**切成前 80%／後 20% 兩段（切點 `floor(min + (max-min) * 0.8)`），
  以 80%／20% 的機率選一段，再在該段內均勻取一個整數。
  例：`[10,30]` 切點 26，80% 落在 10〜26、20% 落在 27〜30。
  不對稱的短範圍差別最明顯——`[1,6]` 擲出上限 6 的機率是 20%，均勻分布只有 16.7%。
- 範圍來自 `midnight_relic_memory_catalog.js` 的 `effect.range`／`effect.unit`，
  從 memory.txt 的 note 機械化解析而來，415 條中 82 條直接有值，再加上武器類別的家族
  繼承 69 條，合計 **151 條**有值。
  原始資料沒寫範圍、寫的是固定值、一條 note 裡有兩組範圍、或含負號的「低下」系，
  一律留 `null` 不擲（見該檔頭註）。
- **武器類別的家族繼承（2026-09-25 使用者確認）**：武器類別 133 條中只有「短剣」那一組
  附了 note，其餘 31 種原始資料留白。使用者確認**其餘 31 種與短剣同組共用同樣的數值**，
  由 `applyWeaponFamilyInheritance()` 在 `EFFECTS` 建好之後機械化補上：

  | 同型（以 id 尾綴判定） | 繼承內容 |
  | --- | --- |
  | `_atk`（○○の攻撃力+） | `[5, 8]` pct |
  | `_hp`（○○の攻撃でHP回復） | `[5, 10]` flat |
  | `_fp`（○○の攻撃でFP回復） | `[2, 3]` flat |
  | `_set3_atk`（3つ以上装備で攻撃力+） | 固定 10%，只繼承 note |
  | `_find`（潜在する力から見つけやすくなる） | 固定 10%，只繼承 note |

  共補上 123 條的 note（其中 69 條同時得到 range）。note 以「把來源 note 裡的『短剣』
  替換成該類別的日文名」產生，日文名取自該組 `_find` 的本文。
  盾（小盾／中盾／大盾）的 `_set3_hp` 與 杖／聖印 的 `_set3_fp` **不繼承**：原始資料
  本來就各自寫了固定值（+40／+25），繼承一律跳過 note 非空的條目。
  陣列中那 133 條的字面值沒有被改寫（note 參數仍是空字串），繼承來的條目帶
  `inheritedFrom` 指向短剣的來源 effect id，以保留「原始資料有沒有寫」的可追溯性。

## 10.3 角色專用效果：可跨角色，但遞減

目錄中有 65 條標記「専用【角色名】」的效果（10 個角色）。

- 這些效果**不限定只能抽給該角色**，別的角色也有機會抽到。
- **同一顆記憶已經抽到一條專用效果之後，後續每一次抽選只有 10% 的機率再抽到專用效果**
  （使用者明確規格 2026-09-24：「拿到一條後 第二條拿到的機率10%」），
  其餘 90% 從非專用的池子抽。實作為 `rollEffects(size, ids, rand, { isExclusive })` 的
  `EXCLUSIVE_REPEAT_CHANCE = 0.1`；不傳 `opts` 時維持舊的整池均勻抽。
- 中／大記憶才有機會出現兩條以上，因此這個門檻只在 `m`／`l` 有意義。
- **10% 門檻只限第二條**（使用者 2026-09-25 明確指示）。原本的實作一律套用到每一條（當時
  使用者的措辭只講到「第二條」），2026-09-25 確認採窄讀法：門檻只看
  `i === EXCLUSIVE_THRESHOLD_INDEX`（＝ 1，第 2 條）。
- **第 3 條必定不是專用效果**（使用者 2026-09-25 明確指示「第三條必不為角色專用效果」）。
  這不是機率門檻而是**硬性排除**：`i === EXCLUSIVE_FORBIDDEN_INDEX`（＝ 2）時一律從非專用池
  抽，跟第 1 條抽到什麼無關。先前的規格是「第 3 條不受限制、從整池均勻抽」，本次取代。
  這條排除**不擲骰**，所以第 3 條仍然只消耗 1 次 rand，§10.12 的受控亂數序列不變。
- 非專用效果在池中抽光時退回整池，否則記憶會湊不滿該有的條數。

## 10.4 惡效果：先建檔，暫不抽選

26 條標記「悪効果」的效果已建檔於
`static_src/midnight_relic_memory_catalog.js` 的 `EFFECTS`，帶 `bad: true`，
`phase: 2`（資料與顯示先行，效果未接入）。`drawableEffects()` 會把它們排除，
因此**目前不納入抽選**。抽選規則（是否強制附帶、出現機率、與記憶大小的關係）待使用者指定。

**抽選規則（2026-09-25 使用者指示）：先跳過。**「之後有需要會補上」，因此這一節維持
現狀不動——26 條照樣建檔、照樣被 `drawableEffects()` 排除，是否強制附帶、出現機率、
與記憶大小的關係全部留白。要開始抽選時，需要使用者補的是這三項規格。

其中兩條在補規格時需要一併確認：

- `bad_executor_skill_atk_up_cut_down`：唯一一條同時是惡效果與角色專用（執行者）。
- `bad_low_cut_rare_nullify`：列在惡效果清單中，但本文讀起來是有益效果。

## 10.5 出擊時攜帶道具：必須對應既有 consumables

目錄有 22 條「出撃時に『◯◯』を持つ」。使用者指示**道具要對應**到
`static_src/consumables.js` 的既有 18 筆，不另立一套道具資料。

已比對可直接對應的：星光の欠片／火炎壺／骨の毒投げ矢／スローイングダガー／
火花の香り／毒の噴霧／鉄壺の香薬／高揚の香り／酸の噴霧／石剣の鍵，
以及五種脂（火・魔力・雷・聖・盾）共同對應 `item_grease`。

`consumables.js` 目前**沒有**的：魔力壺／雷壺／聖水壺／結晶投げ矢／屑輝石／
塊の重力石／狂熱の香薬。另有 22 條「出撃時に『◯◯の結晶雫』を持つ」屬於
原作的聖杯瓶雫系統，midnight 只有單一聖杯瓶，全部需要新資料。

## 10.6 固定配置遺物：先建檔

18 個固定遺物已建檔於同檔案的 `FIXED_RELICS`，`phase: 2`。
不進隨機抽選：達成 `howto` 的條件就直接給整顆，三個效果是指定的、不擲骰。

### 10.6.1 效果名稱的對應（2026-09-25 使用者決定，全數解決）

`FIXED_RELICS.effects` 的每一項由 `resolveFixedRelicEffects()` 在載入時解析成：

```js
{ text: "致命の一撃強化+1", effectId: "rm_critical_up", high: true }
```

`text` 一律保留遺物自己的原文措辭（顯示用的是這個，不是池中那條的名稱），
`effectId` 指向 `EFFECTS`，`high` 是強化版旗標。完全同名的自動比對，對不上的列在
`FIXED_RELIC_EFFECT_ALIAS`。18 顆共 51 條效果，`effectId` 無一遺漏（回歸測試會抓）。

原本 13 條對不上的（`POOL_MISMATCH`，保留做歷史紀錄，每條帶 `resolution` 欄位）：

| 類別 | 條數 | 使用者 2026-09-25 的決定 | `resolution` |
| --- | --- | --- | --- |
| variant（「致命の一撃強化+1」對「致命の一撃強化」） | 4 | 對應到同一個 effect id，但**擲範圍時只擲後段**（必定高值） | `alias-high` |
| renamed（「物理カット率上昇」對「物理カット率+」） | 4 | 名稱對齊，直接對應到池中那條 | `alias` |
| missing — ジェスチャー「あぐら」により、発狂が蓄積 | 1 | **拿掉**（從「魔の夜」「魔の暗き夜」移除） | `removed` |
| missing — 其餘 4 條 | 4 | **補建成新效果** | `added` |

- variant 的「較高機率出現好效果」，使用者在「機率完全反轉／只擲後段／50-50」三個選項中
  選的是**只擲後段**：`rollRangeValue(min, max, rand, { high: true })` 跳過段落選擇，
  直接在後 20% 區間內均勻取值。例：致命の一撃強化 `[6,12]`、切點 10 → 一般最低 6，
  `+1` 版最低 11。四條 variant 對應的效果都有 range，旗標一定擲得出效果。
- 補建的 4 條（`rm_item_effect_to_allies`／`rm_melee_atk_up`／`rm_weapon_skill_atk_up`／
  `rm_ailment_gauge_atk_up`）帶 `relicOnly`，`note` 空、`range` null
  ——memory.txt 對它們連名稱都沒收錄，更沒有換算說明，不得自行推定（CLAUDE.md §42.4）。
  `stackable`／`use` 也是 `null`：效果台帳逐條決定時這 4 條還不存在。
- 「ジェスチャー」機制在 midnight 完全不存在（0 處），拿掉後「魔の夜」「魔の暗き夜」
  各剩 2 個效果。
- 「獣の夜」只有 2 個效果：使用者 2026-09-25 確認「就只有兩個固定」，**不是原始資料缺漏**，
  不需要補第 3 條。

因此 18 顆的效果合計是 51 條（54 − 獣の夜 1 − ジェスチャー 2），不是 54 條。

## 10.7 逐條決定的進行方式

「可否疊加」與「在 midnight 的用途」由使用者在效果台帳（Artifact）上逐條決定，
決定值保存在該 Artifact 的資料庫 `decisions/v1`，已於 2026-09-24 讀回並寫進
`static_src/midnight_relic_memory_catalog.js` 的 `EFFECTS`（415 條全數建檔）。

用途的四種分類：

| 分類 | 意義 |
| --- | --- |
| `adopt` 接上現有 | midnight 已有對應機制，接到既有注入點（多數可沿用 `weapon_affixes.js` 的 30 種 `kind`） |
| `new` 需新機制 | 要先新增資料欄位或事件 hook |
| `text` 僅顯示 | 只建檔顯示文字，效果由 GM／玩家處理 |
| `skip` 不採用 | 不納入這套系統 |

## 10.8 決定結果（2026-09-24 自效果台帳讀回）

415 條兩項全數決定完成。

| 用途 | 條數 |
| --- | --- |
| `adopt` 接上現有 | 348 |
| `new` 需新機制 | 40 |
| `text` 僅顯示（全部是 26 條悪効果） | 26 |
| `skip` 不採用 | 1（`rm_scholar_specimen_rune`／學者的標本） |

（`rm_milestone_ruins_arcane` 於同日補上 `new`，與同組另外 6 條一致。）

疊加：`false` 308 條、`true` 107 條。memory.txt 原本沒有 ◯／✕ 標記的
132 條已全部補齊，另有 2 條與原始標記不同（使用者更正）：

- `rm_combo_fp_regen`（攻撃連続時、FP回復）：◯ → ✕
- `rm_wp_bow_atk`（弓の攻撃力+）：✕ → ◯

與預設建議不同的用途共 23 條，其中兩類是成批的判斷差異，值得記下理由：

- **魔術／祈禱系統別 14 條**（輝剣・石掘り…）建議 `new`，使用者改為 `adopt`。
  代表不打算為武器／魔術資料新增「系統」欄位，而是以既有機制對應。
- **出擊時道具 4 條**（魔力壺／雷壺／聖水壺／結晶投げ矢）與 `rm_throwing_knife_atk_up`
  建議 `new`（`consumables.js` 沒有這些道具），使用者改為 `adopt`。
  代表這些要對應到既有的 `item_throwing_pot`／`item_throwing_dagger` 等，
  而不是新增道具資料（呼應 §10.5「道具要對應」）。
- **基礎能力值 3 條**（生命力／精神力／持久力 +1/2/3）建議 `adopt`，使用者改為 `new`。

`drawableEffects()` 回傳 388 條（415 − 26 悪効果 − 1 skip）。角色專用效果**不**排除，
依 §10.3 別的角色也有機會抽到。

## 10.9 仍待決定

1. ~~§10.2 的「武器類別只有短剣附了 note」~~ —— 2026-09-25 確認同組共用，已實作家族繼承。
2. ~~§10.6 的 `POOL_MISMATCH` 13 條，以及「獣の夜」缺少的第 3 個效果~~ —— 2026-09-25 全數決定，見 §10.6.1。
3. ~~§10.3 的 10% 門檻是否也套用到大記憶的第三條~~ —— 2026-09-25 確認只限第二條。
4. **悪効果的抽選規則**（是否強制附帶、出現機率、與記憶大小的關係）——使用者 2026-09-25
   指示「先跳過，之後有需要會補上」，見 §10.4。
5. **補建的 4 條效果**（§10.6.1）的 `stackable`／`use`／數值換算——它們在效果台帳逐條決定時
   還不存在，目前是 `null`。
6. ~~抽選池的擴充~~ —— 2026-09-25 完成，見 §10.11。
7. ~~`relicOnly` 是否該排除於抽選池~~ —— 池擴充時依欄位語意排除，見 §10.11。
8. **目錄效果的機制接入**：分 6 期，**已完成 338 條**（第 1 期 56／第 2 期 93／第 3 期 29／
   第 4 期 50／第 5 期 18／第 6 期 94），見 §10.13。抽選池 362 條中只剩 **24 條**仍然只會
   顯示名稱與數值（22 條結晶雫 ＋ 2 條需要踏破板塊的發盧恩出口），見 §10.15。

## 10.10 範圍接線（2026-09-25 完成）

記憶結構改成 `effects: [{ id, value }, ...]`（§2.2），`rollRangeValue()` 接進了記憶的
產生流程：

- `newMemory(size, effectIds, source, rand, now, opts)` 多了 `opts.rangeOf(id)`；有範圍的
  效果在產生那顆記憶的當下擲定一個值寫進 `value`，沒有範圍的不帶 `value`。
- `midnight.js` 的 `relicMemoryRangeOf()` 查 catalog 的 `effect.range`，三個
  `newMemory()` 呼叫端（開局小×1、里程碑發放、restart 重置）都傳了進去。
- 讀取點：`character_drawer.js` 的 `activeAttachedEffectIds()`（判定效果）、
  `midnight.js` 的耐性選擇、等待房的帶入清單複製、角色視窗與結算視窗的顯示。
  顯示會把擲定的值以單位附在效果名稱後面（`pct` →「（8%）」、`sec` →「（2s）」、
  其餘 →「（8）」）。
- 舊格式（純字串陣列）全程相容，不需要資料遷移（§2.2）。

**目前實際上還擲不出數值**：抽選池仍是 `CharacterDrawer.allAttachedEffectIds()` 的 24 種
附帶效果，它們沒有 `range`，所以 `relicMemoryRangeOf()` 一律回 `null`、行為與接線前完全
相同。等 §10.9 第 6 點的池擴充完成，同一條路徑就會開始擲值，不需要再動呼叫端。

`rollEffects()` 的 `opts.isExclusive` 同樣還沒有呼叫端傳入，一併等池擴充。
（**2026-09-25 已接上**，見 §10.11。）

---

## 10.11 抽選池的擴充（2026-09-25 完成）

`midnight.js` 三個 `newMemory()` 呼叫端（開局小 ×1、里程碑發放、restart 重置）的效果池
從 `CharacterDrawer.allAttachedEffectIds()`（24 種）換成 `relicMemoryDrawPool()`：

```
24 種附帶效果  ＋  Catalog.drawableEffectIds() 369 條  ＝  393 條
```

`drawableEffects()` 的排除條件從兩種加到三種：

| 排除 | 條數 | 依據 |
| --- | --- | --- |
| `bad`（悪効果） | 26 | 抽選規則未定，使用者指示先跳過（§10.4） |
| `use === "skip"` | 1 | 使用者明確決定不納入（`rm_scholar_specimen_rune`） |
| `relicOnly` | 23 | 欄位語意就是「只出現在固定配置遺物上」 |

- `relicOnly` 的排除**不是使用者明確規格**，是依欄位語意做的判斷。2026-09-25 的池擴充
  之前 midnight 根本沒在抽這份目錄，所以這 23 條（19 條既有 ＋ §10.6.1 補建的 4 條）
  從來沒有真的被抽到過，排除不改變任何既有行為。要讓固定遺物的效果也能隨機抽到，
  把 `drawableEffects()` 裡的 `!e.relicOnly` 拿掉即可。
- **角色專用效果不排除**（池中 47 條）：依 §10.3，別的角色也有機會抽到，只是同一顆記憶
  內的第 2 條會被 10% 門檻壓住。`opts.isExclusive` 已接上 `Catalog.isExclusiveEffect()`，
  實測第 1 條是專用時，第 2 條的專用率 1.7%，遠低於整池的 12.6%。
- **範圍擲值真正生效**：池中 149 條帶 `range`，抽到時當下擲定數值寫進 `effects[].value`
  （§10.10）。實測抽 400 顆大記憶 1200 條效果，482 條帶值，全部落在各自宣告的範圍內。
- 可否疊加：`character_drawer.js` 的 `attachedEffectStackable()` 先看 24 種附帶效果自己的
  `stackable`，查不到再查 catalog（可選查詢——catalog 只在 midnight 頁面載入，night 頁面
  沒有，查不到就走預設的「不可疊加」）。

**這一步沒有做的**：目錄那 369 條的**機制接入**（§10.9 第 8 點）。抽到它們現在只會在
角色視窗顯示名稱與擲定的數值，不會改變任何計算；24 種附帶效果照舊完全生效。因此池擴充
之後，一顆記憶約有 369/393 ≈ 94% 的機率抽到「目前只是文字」的效果——這是 §10.1「並存」
的直接後果，要讓它們真的有用，需要先做機制接入。

驗證出口：`window.PriTestMidnight._debugRelicMemoryPool()`（池的條數、帶範圍條數、
專用條數、`opts` 的鍵、完整 id 清單與各自的範圍）與 `_debugNewRelicMemory(size, randValues)`
（走真實的 `relicMemoryDrawPool()`／`relicMemoryRollOpts()` 生一顆記憶，可給受控亂數），
供 `relic_memory_drawer_check.js` 與 `relic_memory_pool_coverage_check.js` 斷言。

---

## 10.12 抽選池的全覆蓋檢查（`relic_memory_pool_coverage_check.js`）

回答的是「393 條效果套進小／中／大記憶時，條數對不對、**每一條**的數值對不對」。
「全覆蓋」指池裡每一條在三種大小下都被**實際抽到過至少一次**才開始核對，做法是持續抽到
集滿為止（coupon collector），集不滿就把漏掉的列出來當失敗。驗的是生產路徑——
`_debugNewRelicMemory()` 用的就是真實的池與 opts，測試沒有自己重現一份抽選邏輯。

2026-09-25 實測結果（小 2356 顆／中 1036 顆／大 597 顆湊齊覆蓋，全部 PASS）：

| 檢查 | 結果 |
| --- | --- |
| 條數 | 小恆 1、中恆 2、大恆 3 條 |
| 同一顆記憶內 id 重複 | 無 |
| `memId` 格式 | 全部符合 `^m[0-9a-f]{16}$` |
| 覆蓋 | 三種大小下 393 條全部被抽到過 |
| 數值 | 有 `range` 的必定擲出整數值且落在範圍內；沒有 `range` 的必定不帶 `value` |
| 帶範圍的 149 條 | 逐條核對實得值域都在宣告範圍內，且樣本足夠者兩端都搆得到（證明後 20% 段真的抽得到） |
| 位置 | 大記憶第 1／2／3 條每個位置都出現過帶值的效果 |
| 受控亂數 | 指定索引 → 前段最小 = 範圍下限、後段最大 = 範圍上限 |

**寫受控亂數測試的陷阱**（實作時踩過）：`newMemory()` 的 rand 消耗順序是
`rollEffects`（每條 1 次，第 2 條套門檻時多 1 次）→ **`randomHex16()` 的 16 次** →
才輪到 `rollRangeValue` 的選段與段內取值。`memId` 夾在中間是因為物件字面量由上到下求值、
`memId` 那一行排在 `effects` 前面。受控序列少算這 16 次就會循環取到錯位的值。
這一點已寫進 `midnight_relic_memory.js` 的 `newMemory()` 註解。


---

## 10.13 效果的機制接入（分 6 期）

池擴充（§10.11）只讓記憶「抽得到、顯示得出、擲得出數值」。要讓效果真的改變計算，得把
369 條逐條接到 midnight 的注入點。

### 10.13.1 一個會影響做法的事實

`midnight.js` 既有的注入點是**以 affix id 逐條列舉**的：

```js
if (ctx.ranged) pct += affixTotal(c, "rangedAtkUp");
```

`kind` 只是資料上的分類標籤，**不是自動分派**。所以「重用既有注入點」＝語意相同的效果可以
在同一個計算點加一行，不是「同 kind 就自動生效」。

好消息是使用者在效果台帳上的 `use` 決定已經精準反映了「midnight 有沒有對應機制」。
`levelStat` 是鐵證：標 `adopt` 的正好是威力補正（`POWER_MOD_STAT_MAP`）有的 5 種
（筋力／技量／知力／信仰／神秘），標 `new` 的正好是威力補正沒有的 3 種
（生命力／精神力／持久力）。

### 10.13.2 分期表

| 期 | 內容 | 條數 | 狀態 |
| --- | --- | --- | --- |
| **1** | 純數值加成：`atkPct` 29／`elementAtkPct` 5／`physicalAtkPct` 2／`maxStat` 3／`damageTaken` 1／`elementDamageTaken` 5／`staminaRegen` 3／`artCooldown` 3／`skillCooldown` 1／`castFpCost` 2／`staggerThreshold` 2 | 56 | **完成（2026-09-25）** |
| **2** | 語意成群：`onAttack` 48／`discovery` 32／`accumResist` 7／`overTime` 6 | 93 | **完成（2026-09-25）** |
| **3** | 能力值：`levelStat` 28／`poise` 1 | 29 | **完成（2026-09-25）** |
| **4** | 置換賦予：`weaponInfusion` 7／`onInfusion` 1／`spellSchool` 14／`grantWeaponSkill` 18／`grantSpell` 10 | 50 | **完成（2026-09-25）**；另有 2 條 `grantWeaponSkill` 缺招式資料，已排除出抽選池 |
| **5** | 出擊攜帶：`startItem` 22／`startFlask` 22 | 44 | **18／44（2026-09-25）**：18 條已接；4 條缺對應道具已改成不抽選，22 條結晶雫待補資料（§10.15） |
| **6** | 條件觸發與 `special`：`special` 75／`globalMilestone` 7／`onGuardSuccess` 5／`onDamaged` 2／`onWeaponSwap` 2／`flask` 2／`nearDeath` 1／`aggro` 1 | 95 | **94／95（2026-09-25）**：使用者補齊 33 條換算後全數接入，1 條缺資料已改成不抽選；另有 2 條需要「踏破板塊發盧恩」的事件出口（§10.15） |

### 10.13.3 第 1 期的做法

核心是 `midnight.js` 的 `RELIC_MEMORY_AFFIX_ALIAS`：把記憶的效果 id 對應到語意等價的
武器詞條 id，讓既有的 `affixTotal()` 一併算進去（`affixTotal()` 尾端加了
`relicMemoryBonusTotal(c, affixId)`）。對應值有兩種寫法：

| 寫法 | 意義 | 條數 |
| --- | --- | --- |
| `"executionUp"`（字串） | 併進既有詞條的同一個計算點，**所有既有注入點一行都不用改** | 18 |
| `{ key: "rmXxx" }`（物件） | 本檔自己的 bonus key（目錄有、詞條沒有），各自在計算點加了一行 | 14 |
| 武器類別對應表（另一套） | 24 條「○○の攻撃力+」共用一個注入點 | 24 |

- **可否疊加**照目錄上的 `stackable`：`true` 每顆記憶各算一次相加，`false` 只算第一次出現的。
- **武器類別的 24 條刻意不手寫對應表**：兩邊命名並不一致（`straight_sword` 對
  `straightsword`、`thrusting_sword` 對 `rapier`、`hammer` 對 `mace`、`reaper` 對 `scythe`…），
  手寫 24 行會打錯字且靜默失效。改用**日文類別名自動比對**——效果名「○○の攻撃力+」的
  ○○就是 `weapons.js` category 的 `name.ja`。新增武器類別時也會自動跟上。
- **兩個獨立的開關**：`affixOutgoingDamageMult()`／`affixIncomingDamageMult()` 原本開頭是
  `if (!c || !weaponAffixesEnabled()) return 1;`，那會把記憶的效果一起擋掉。改看
  `damageBonusSourcesActive(c)`＝詞條已開**或**帶了記憶。

### 10.13.4 第 1 期的實作取捨（不是規格另有規定）

- **炎的減傷**：詞條那邊刻意沒有炎的減傷（使用者給詞條的炎規格是「15% 機率不會蓄積」的
  抗性，見 `AFFIX_ACCUM_RESIST_BY_NAME`），但目錄的「炎カット率+」明確是減傷，因此在
  `affixElementCut()` 補上炎這一支，只有記憶的來源。
- **咆哮とブレス強化**：midnight 沒有「咆哮／吐息」這個招式分類，改用招式名稱判斷
  （`/咆哮|ブレス|吐息|吐き/`）。日後若武器／魔術資料加了招式分類欄位，改讀那個欄位。
- **冷卻的百分比減免掛在起算處**：冷卻是以「到期時刻」保存的（`_artCooldownUntil`／
  `_skillCooldownUntil`），在 `abilityBaseCooldownMs()`（冷卻長度的唯一出口，含各角色的
  override）縮短總長最直接，也不會跟既有的擊破秒數減免互相干擾。上限夾在 90%。
- **「自身を除く、周囲の味方のスタミナ回復速度上昇」**：受惠的是別人，所以每個人算自己的
  回復速度時去掃**其他席位**帶了幾條（`relicMemoryPartyStaminaRegen()`）。這條原始資料
  寫死 `+2`、沒有 range，所以在 alias 上以 `fixed: 2` 給值。
- **「通常攻撃の1段目強化」**：第 1 段＝這次攻擊前 `comboState[side].hitIndex` 還是 0，
  必須在 `cs.hitIndex` 被推進之前取。

### 10.13.5 驗證

`node tools/midnight_check/relic_memory_effect_check.js`（Playwright）：

- **alias 稽核**：alias 是純字串表，打錯字會**靜默失效**（效果永遠加 0，不會報錯），所以
  把每一條的健全性攤開來斷言——效果在不在目錄、抽不抽得到、併進既有詞條的那 18 條目標
  詞條在不在且是 phase 1、本檔自己的 14 個 key **沒有**跟詞條撞名、每一條都有數值可加。
- **覆蓋率**：第 1 期範圍的 56 條逐條確認都有注入點，且沒有接到範圍以外的效果。
- **實際數值**：32 條 alias 各自帶入後 `affixTotal()` 的值、`stackable` 的疊加與去重、
  24 條武器類別「對自己的類別生效／對別的類別不生效」、減傷與攻擊倍率的實得值。

2026-09-25 實測全部 PASS。回歸：`relic_memory_unit_check.js`、`relic_memory_drawer_check.js`、
`relic_memory_pool_coverage_check.js`、`relic_memory_emulator_check.js` 皆 ALL PASS
（emulator 的「保存後按鈕文字改為已保存」那一項偶發時序 flaky，第二次跑通過；
保存本身的斷言兩次都過）。


### 10.13.6 第 2 期的做法（93 條，2026-09-25 完成）

四群各用**一個**機制做完一整批，不是逐條寫。

#### `accumResist` 7 條 —— 異常蓄積上限

換算原文就是「○○異常蓄積上限+1」，跟 `receivedAccumThreshold()` 算的「觸發門檻」是同一件事，
所以直接加在該函式的 `delta` 上（`RM_ACCUM_RESIST_BY_NAME` 把效果 key 對到異常名）。
`ATTRIBUTE_STATUS_AILMENT_NAMES_JA` 正好是 7 種（猛毒／腐敗／出血／凍傷／発狂／睡眠／呪死），
**7 對 7 全中**。注意兩處名稱差異：目錄的「冷気」＝ midnight 的「凍傷」、「死」＝「呪死」。
這 7 條原始資料沒有 range（固定 +1），值寫在 alias 的 `fixed` 上。

#### `onAttack` 48 條 —— 武器類別的攻擊回復

「○○每攻擊20下 HP回復5~10／FP回復2~3」，24 類別 × (HP, FP)。第 1 期的武器類別對應表
擴充成通用的 `relicMemoryWeaponCategoryMaps()`，用四條正則抓日文類別名：

| 種類 | 正則 | 期別 |
| --- | --- | --- |
| `atk` | `^(.+)の攻撃力\+$` | 第 1 期 |
| `hp` | `^(.+)の攻撃でHP\d*回復$` | 第 2 期 |
| `fp` | `^(.+)の攻撃でFP\d*回復$` | 第 2 期 |
| `find` | `^潜在する力から、(.+)を見つけやすくなる$` | 第 2 期 |

`hp`／`fp` 的正則吃掉數字，是因為刀那條原文寫成「刀の攻撃でFP**2**回復」。

計數**分武器類別**（`relicMemoryCategoryAttackCount`），每 20 下觸發。**刻意不在離開戰鬥時
歸零**（`attackCountThisEncounter` 會）：原文只說「每攻擊20下」，沒說「一場戰鬥內」，取字面
窄讀就是單純累計；實務上也有差——midnight 一場戰鬥常常打不到 20 下，每場歸零的話這 48 條
幾乎永遠不會觸發。只有「重新開始一輪」時跟著其他本地狀態一起歸零。

#### `overTime` 6 條 —— 持續回復

節流用跟 `updateAffixOverTime()` 同一支 `affixTick()`，不另外發明計時。間隔各條不同
（`RM_OVER_TIME_INTERVAL_MS`：HP 持續回復 30 秒、FP 持續回復 10 秒…），因為換算原文各自寫死。

三條跨玩家的，各自用不同做法：

| 效果 | 做法 |
| --- | --- |
| 自身を除く、周囲の味方のスタミナ回復速度上昇（第 1 期） | 每個人算自己回復速度時掃**其他席位**（排除自己） |
| HP低下時、周囲の味方を含めHPをゆっくりと回復 | 同上，但**含自己**（原文「味方を含め」） |
| 敵を倒した時、自身を除く周囲の味方のHPを回復 | 擊破是瞬時事件，掃不到，所以廣播——`relicMemoryPartyHealEvents/<token>` 寫時間戳，對方比對上次看過的值，跟既有的 `abilityUseEvents` 完全同一套模式 |

取捨：「周囲で腐敗状態の発生時」與「HP低下時」的**隊友狀態沒有同步到 RTDB**，只有自己的
算得出來。前者因此只看自己的腐敗蓄積；後者對其他席位一律當作條件成立——寧可多回，也不要
整條效果永遠不發動。

#### `discovery` 32 條 —— 潛在之力的出現率

「潛在之力更容易出現○○+10%」。使用者 2026-09-25 明確選擇：**絕對＋10 個百分點**
（32 種均等時 3.125% → 13.125%），不是相對提升，也不是權重翻倍。

實作在 `character_drawer.js` 新增的 `pickCategoryIdWithBonus(categories, categoryBonus)`：
對象類別的機率固定成 `base + bonus`，其餘類別平分剩下的。`merchantDrawWeapon()` 多了第 4 個
可選參數 `categoryBonus`，**不傳就跟以前完全一樣**（`night.js` 不傳）。midnight 這邊由
`relicMemoryDiscoveryCategoryBonus()` 算出 `{ categoryId: 增分 }`。

這 32 條在效果台帳上全部是 `stackable: false`，所以同一條重複帶只算一次，不同類別各自累加。

實測（60000 次抽選）：沒加成時短劍 3.06%、帶一條後 13.21%（期望 13.13%）、其餘類別 2.93%
（期望 2.80%）。

### 10.13.7 第 2 期的驗證

`relic_memory_effect_check.js` 增加：

- 7 條異常蓄積上限各自 +1，且**不影響其他異常**的門檻。
- 48 條攻擊回復：24 HP ＋ 24 FP 全部對應到 category，對自己的類別生效、對別的類別不生效、
  HP 那條不會被當成 FP 回復。
- 6 條持續回復的 bonus key 都算得出值。
- 32 條出現率：加成表正確、`stackable:false` 不疊加、統計逼近期望機率。
- **累計覆蓋率 149 條**（第 1 期 56 ＋ 第 2 期 93），且沒有接到已完成期別以外的效果。

2026-09-25 實測全部 PASS，四支回歸腳本（unit／drawer／pool_coverage／emulator）也都 ALL PASS。


### 10.13.8 第 4 期已完成的 8 條（2026-09-25）

#### `weaponInfusion` 7 條 —— 出撃時の武器への属性／状態異常付加

「出撃時の武器に炎攻撃力を付加」「出撃時の武器に毒の状態異常を付加」等。

- **「出撃時の武器」＝ `weaponIds[0]`（開局自動裝備的主武器）**。這不是推定：既有程式在
  角色首次載入時就是用 `startingWeaponId = mine.weaponIds[0]` 決定主武器，附加也掛在同一處。
  原文是單數，取字面窄讀就是那一把，不是全部武器。
- **儲存完全重用 `_tempWeaponSkills`**（戰技的「この装備品にスキル『属性｜X』を追加する」
  用的那一套，見 `grantTempWeaponSkills()`）——那是 midnight「這把武器會附著什麼屬性／異常」
  的唯一來源（`midnightWeaponAccumEffects()`），不另外發明第二套附加機制。差別只在時效：
  戰技那套是 10 秒，這裡整場有效，所以 `until` 用一個永遠不會到期的值。
- 異常名用 midnight 的既有表記：目錄的「毒」→「猛毒」、「冷気」→「凍傷」。
- 同一種屬性重複帶只掛一條（附加就是附加，不疊加）。
- 「重新開始一輪」時旗標重置，下一輪重新掛一次。

#### `onInfusion` 1 條 —— 属性攻撃力が付加された時、属性攻撃力上昇

換算「附加屬性時 屬性攻擊力+8% 持續5s」。觸發時機有二：上面的開局附加，以及戰技的
`grantTempWeaponSkills()`。**只有附加「屬性」才觸發**，附加異常（出血等）不算。

---


### 10.13.9 第 3 期的做法（29 條，2026-09-25 完成）

使用者 2026-09-25 補齊了 §10.14.1 的兩塊缺口，整期就此做完。

#### 能力值在 midnight 的對應（使用者明確指定）

| 目錄的能力值 | midnight | 單位 |
| --- | --- | --- |
| 生命力 | HP 上限 | 基礎 4 條是**百分比**（+2~5%）；角色專用的互換是 flat（±20 / ±30） |
| 精神力 | FP 上限 | 同上 |
| 持久力 | 體力上限 | 同上 |
| 強靭度 | 威力補正「平衡」 | flat +1~3 |
| 筋力・技量・知力・信仰・神秘 | 威力補正的同名五項 | flat +1~3 |

「其餘屬性 ±10」對得上 midnight 的刻度：角色類型的 `powerMod` 本來就是 0／5／10 的級距
（`character_types.js`），±10 剛好是一整級，不是憑空的大數字。

使用者同時給了一條原則「FP・HP ±20／體力 ±15／其餘屬性 ±10」，但逐條列出的體力值
寫成 ±20。回報後使用者 2026-09-25 確認**以原則為準**，因此換算表的體力一律 ±15。

#### 換算表放在資料檔，不在 alias 表

注入點被拆成兩邊，所以換算表不能放在 `midnight.js`：

- 威力補正的唯一出口是 `character_drawer.js` 的 `computeArtPower()`／`statPowerModValue()`
  ——那支檔案連 night 頁面都會載入，**不能**依賴 `midnight.js`。
- HP／FP／體力上限在 `midnight.js` 的 `selfArenaHpMax()`／`selfFpMax()`／`updateStamina()`。

因此換算表放進 `midnight_relic_memory_catalog.js`（純資料檔），兩邊各自讀：

| 表 | 內容 |
| --- | --- |
| `POWER_MOD_STAT_OF` | 6 條「筋力+1~+3」系 → 威力補正的哪一項。加的量是那顆記憶擲定的 `value`。 |
| `STAT_SWAPS` | 20 條角色專用的能力值互換 → `{ hp, fp, stamina, powerMod: {...} }`，固定值不擲範圍。 |

`character_drawer.js` 新增 `relicMemoryActiveEntries(c)`（跟 `activeAttachedEffectIds()`
同一套 `stackable` 去重，但保留擲定的 value）與 `relicMemoryPowerModBonus(c, statKey)`，
後者加在既有四個 powerMod 來源（類型／護符／遺物／恩寵）旁邊，一行搞定。

#### 百分比與 flat 的疊法

flat 的互換疊在既有詞條那一層（`maxHpUp` 等同層，不是 ×10 的對象），百分比套在最外層：

```
HP 上限 = max(100, round((100 + hp.max×10 + 詞條 flat + 互換 flat) × (1 + 生命力%)))
```

下限的夾法（HP 100／FP 1／體力 10）完全沒動，所以負向的互換不會把人夾成 0。

### 10.13.10 第 4 期其餘的做法（42 條，2026-09-25 完成）

#### `spellSchool` 14 條 —— 系統別是既有欄位，不必新增

§10.14.2 當時的結論是「既有機制對應不上」，但那是拿**招式名稱**去比對。實查
`weapons_skills.js` 的 `kindLabel`（2026-09-12 就加的「（種類）｜（名稱）」的種類部分，
例：魔術「石掘り」、祈禱「竜餐」）——那本來就是系統名，**14 種全部對得上**，
資料裡另外還有「血盟」「溶岩」兩種目錄沒列的系統。唯一的名稱差異是目錄的
「カーリアの剣」＝ `kindLabel` 的「カーリア」。

因此不需要為 251 條招式新增欄位，也不必降級成「所有魔術 +N%」。做法：

- alias 的 bonus key 直接把系統名編進去（`"rmSchool:" + 日文系統名`），省得為 14 條各寫一個常數；
  冒號保證不會跟武器詞條的 id 撞名。
- `getEquippedWeaponSkillEntries()` 的 entry 加一個 `skillId` 欄位（既有欄位一個都沒動），
  `castWeaponSkillEntry()` 用它查 `kindLabel` 放進 `ctx.spellSchool`。
- `affixOutgoingDamageMult()` 在既有的 `sorcery || prayer` 分支裡加一行。

#### `grantWeaponSkill` 20 ／ `grantSpell` 10 —— 替換，不是追加

使用者 2026-09-25 明確指示「**直接替換欄位，不保持兩個戰技**」，所以不能用既有的
`c.weaponExtraSkills`（那是追加）。新增覆寫欄位 `c.relicMemorySkillSwap = { weaponId, skillId }`，
由 `midnight.js` 在開局決定（跟屬性附加同一個時機、同一把武器＝ `weaponIds[0]`），
`character_drawer.js` 新增 `weaponOwnSkillRefPairs()` 作為戰技枠的唯一出口，替換掉第 1 個枠。
`getEquippedWeaponSkillEntries()`（戰鬥用）與 `weaponOwnSkillDisplays()`（角色視窗顯示用）
都改走這支，兩邊看到的戰技一致。

實作取捨（不是規格另有規定，都寫在該函式的註解裡）：

- **只換第 1 個枠**：原文「戦技を『X』にする」是單數，換掉全部會讓有兩個枠的武器平白少一個。
- **盾不換**：盾的枠是 `attachedEffect`／`reverseArt`，那不是「戰技」。
- **武器本來沒有枠時**，X 就成為它唯一的招式——仍然只有一個，沒有違反「不保持兩個戰技」。
- **同時帶到好幾條置換時只採第一條**（這 30 條 `stackable` 全是 false）。
- 「重新開始一輪」時旗標與 `c.relicMemorySkillSwap` 一起清掉。

30 條指向的招式有 28 條在 `weapons_skills.js` 找得到；「嵐脚」「デターミネーション」找不到，
使用者指示「**先不進入抽選池**」，因此那兩條在目錄上帶新的 `d`（missingData）旗標，
由 `drawableEffects()` 排除。抽選池因此從 369 → 367 條（全池 393 → 391）。
招式資料補上之後把 `"d"` 拿掉即可，不必改其他地方。

### 10.13.11 第 3／4 期的驗證

`relic_memory_effect_check.js` 增加四組（2026-09-25 實測全部 PASS）：

- **能力值 29 條**：6 條威力補正各自只加到自己那一項、範圍都是 [1,3]；20 條互換逐條比對
  換算表（威力補正六項＋HP／FP／體力）；flat 真的改到 `selfArenaHpMax()`／`selfFpMax()`
  （250→230、60→80）與體力上限（100→120）；百分比三條各自只影響自己那一項；
  `stackable` true 相加、false 只算一次。
- **置換 28 條**：每一條指向的招式都存在（打錯字會靜默失效）；替換後枠數不變、原本第 1 條
  被換掉、兩條置換只採第一條；被排除的正好是缺資料那兩條。
- **系統別 14 條**：14 種系統名在 `kindLabel` 裡都找得到招式（0 條就代表永遠不會生效）；
  施放同系統倍率 1.10、施放別的系統或沒有系統別的招式不加成。
- **覆蓋率**：第 3 期 29 條、第 4 期其餘 42 條全部有注入點，累計 **228 條**。

回歸：`relic_memory_unit_check.js`（池的條數與 range 條數的期望值依 §4.7 一併更新：
range 151→155、池 369→367）、`relic_memory_drawer_check.js`、
`relic_memory_pool_coverage_check.js` 皆 ALL PASS。

---

### 10.13.12 第 6 期的做法（61 條，2026-09-25）

第 6 期是「條件觸發與 `special`」95 條，這一輪接了 **61 條**（其餘 34 條的原因見 §10.15）。
做法一樣是**一個機制做完一整群**，不是逐條寫。

#### 武器類別持有 3 把（29 條）—— 沿用既有的類別對應表

「短剣の武器種を3つ以上装備していると攻撃力+」24 種 ＋ 盾 3 種（最大HP+40）＋ 杖/聖印 2 種
（最大FP+25）。`RM_WEAPON_CATEGORY_PATTERNS` 從 4 條正則擴充成 7 條（新增 `set3atk`／
`set3hp`／`set3fp`），照樣用**日文類別名自動比對**，不手寫 29 行對應表。

一個取捨要記下來：原文的條件是「**装備**していると」，但 midnight 同時只裝左右手兩把，
3 把永遠湊不齊。換算 note 寫的是「○○武器 3 個以上**持有**」，所以數的是持有欄
（`c.weaponIds`）。note 是即時制換算的唯一依據（見 catalog 檔頭），優先於日文原文的字面。

條件成立時加成**不限用哪一把打**——原文就是「攻撃力+」，不是「該類別的攻擊力+」
（那是第 1 期的另外 24 條）。

#### 敵人異常狀態的 10 秒視窗（6 條）

「毒/腐敗/凍傷状態の敵に対する威力が+」與「周囲で毒腐敗/睡眠/発狂状態の発生時、攻撃力+」，
換算 note 全部寫成「敵人○○状態発生 10s 內 威力+8~12%」，所以是同一個機制：
`applyAttributeAccumEffect()`（PC 對敵人施加的屬性/異常真正觸發的唯一出口）記下時間戳，
`affixOutgoingDamageMult()` 查視窗。「周囲で凍傷状態の発生時、自身の姿を隠す」同一個視窗，
效果是敵視歸零（`aggroAccumMultiplier()` 回 0，跟既有的「敵視：0」同一個語意）。

**全裝置共用**（使用者 2026-09-25 明確規格「異常視窗同一敵人，全裝置共用異常狀態——
只要敵人被打出異常就開我的視窗」）：視窗的起算點不是本地事件，而是共享的
`attributeAccumTriggers`（RTDB，每台裝置都會收到）**次數變多**的那一刻。
`applyAttributeAccumEffect()` 只有贏得 transaction 的那一台會跑，掛在那裡隊友打出來的異常
開不了我的窗；改讀共享次數就自然涵蓋全隊，也不需要新增 RTDB 節點或改安全規則。
「同一敵人」靠 `targetKey` 區分——隊友在別的地圖點打出的異常不會開我這邊的視窗。
首次收到快照時只建立基準、不開窗（reload／中途加入時不該把既有的累計次數當成「剛發生」）。

#### 防禦／受擊／敵視（7 條）

| 效果 | 注入點 |
| --- | --- |
| ガードカウンター強化 | 併進既有詞條 `guardCounterUp`（語意完全相同，一行都不用改） |
| ガード成功時、HP回復／アーツゲージ蓄積 | `applyGuardSuccessRelics()`（防禦成功的唯一出口） |
| 刺突カウンター発生時、HP回復 | `consumeGuardCounterDiscount()`——換算 note 寫的是「防禦反擊成功時」，midnight 的防禦反擊就是「這一擊吃到了折扣」 |
| 攻撃を受けると攻撃力上昇 | 新的 `onRelicMemoryDamaged()`（跟 `onAffixDamaged()` 分開，因為那支有武器詞條開關） |
| ダメージを受けた直後、攻撃によりHPの一部を回復 | 同上記錄「受了多少」，1 秒內的下一次 `damageCombatTarget()` 回該傷害的 12~22%，只回一次 |
| ガード中、敵に狙われやすくなる | `aggroAccumMultiplier()`：+5% 不是既有 sources 的 10% 整數倍，所以加在倍率上 |

#### 聖杯瓶（2 條）與換武器（2 條）

聖杯瓶回復量是百分比，套在既有 flat 加成（遺物／護符／詞條）之後；「回復を周囲の味方に
分配」重用共感術那條路徑（對方 `demoStat` 的 transaction），只是比例不同。

換武器兩條掛在 `cycleEquippedWeapon()`：物理攻擊力那條只對**換上去的那一把**、只對物理、
5 秒；屬性附加那條重用 `_tempWeaponSkills`（同第 4 期的出撃時附加），隨機挑一種屬性，
5 秒、冷卻 10 秒，並且會一併觸發第 4 期的「属性が付加された時、属性攻撃力上昇」。

#### 全域里程碑（5 條）

「○○の強敵を倒す度」＝該類型的地圖點被踏破的次數。地圖點的 `card` 就是 `fields.js` 的
場地卡編號，所以直接比對 card，不另外建一套場地分類：

| 效果 | 條件 | 加成 |
| --- | --- | --- |
| 魔術師塔の仕掛けが解除される度 | `towerSolved` 的數量 | 最大FP +10／次 |
| 大教会の強敵を倒す度 | card_2 踏破數 | 最大HP +5%／次 |
| 大野営地の強敵を倒す度 | card_4 踏破數 | 最大體力 +5／次 |
| 遺跡の強敵を倒す度 | card_5 踏破數 | 神秘（威力補正）+2／次 |
| 封牢の囚を倒す度 | card_9 踏破數 | 攻撃力 +8%／次 |

「遺跡」那條的注入點在 `character_drawer.js`（威力補正的唯一出口），但次數只有 midnight
算得出來，所以 midnight 每影格把算好的值寫進 `c._rmMilestoneArcane`，
`relicMemoryPowerModBonus()` 讀那個欄位——跟第 3 期同一張換算表兩邊共用是同樣的結構。

#### 道具強化（7 條）與盧恩／商店（2 條）

`applyMidnightConsumableEffect()` 裡所有的傷害改走一個本地的 `rmItemDamage()`（內部仍是
`damageCombatTarget()`，只是先乘上百分比），不逐條在每個分支加判斷。三組道具：
投擲壺（一般版與 +1 版走同一個 key）／投擲ナイフ（原文是「ナイフ」，取字面窄讀只含投擲短劍
與蒼火的投擲刀）／調香瓶（另加持續時間 +3s）。「苔薬などのアイテム使用でHP回復」掛在
`item_bitter_medicine` 分支。

「致命の一撃で、ルーンを取得」接在既有遺物效果「致命一擊獲得盧恩」的**同一個閘門**上
（任一在場 PC 有其中之一就發，整場一次）；「ショップでの購入に必要なルーンが割引」換算是
「有 10~20% 機率免費」，所以每次購買擲一次，中了就不扣盧恩。

### 10.13.13 第 6 期的驗證

`relic_memory_effect_check.js` 增加四組（2026-09-25 實測全部 PASS）：

- **持有 3 把 29 條**：29 條全部對應到 category、category id 都存在；持有 2 把不到門檻、
  3 把拿到該類的固定值（10%／40HP／25FP）；湊滿別的類別不生效。
- **異常視窗 6 條**：各條只在對應異常觸發後生效、不符的異常與未觸發都是 0；
  「周囲で毒/腐敗」對兩種都成立；「凍傷で姿を隠す」只在凍傷觸發後成立。
- **道具 7 條與里程碑 5 條**：投擲壺／ナイフ／調香瓶各自只對自己那組生效、一般版與 +1 版
  相加；5 條里程碑的單次加成與「達成 3 次」的累計、對應的場地卡編號。
- **覆蓋率**：第 5／6 期逐類的接入數（`special` 46/75、`onGuardSuccess` 4/5、`onDamaged` 1/2、
  `aggro` 1/1、`flask` 2/2、`onWeaponSwap` 2/2、`globalMilestone` 5/7、`nearDeath` 0/1、
  `startItem` 0/22、`startFlask` 0/22），累計 **289 條**，仍僅顯示 78 條。

回歸：`relic_memory_unit_check.js`（第 3 條硬性排除的新斷言）、`relic_memory_drawer_check.js`、
`relic_memory_pool_coverage_check.js`、`ability_damage_check.js`、`character_ability_check.js`、
`consumable_talisman_runtime_check.js`、`battle_sim_check.js` 皆 ALL PASS。

---

### 10.13.14 第 5 期的做法（18 條，2026-09-25）

「出撃時に『◯◯』x N を持つ」22 條。使用者 2026-09-25 明確指示「大部分消耗道具的都有對應
道具請先找出，結晶雫後面補上」，因此這一輪只接**確定對得上 `consumables.js` 既有 18 筆**
的 18 條，不自行發明道具資料（CLAUDE.md §42.4）。

#### 對應方式

| 組 | 條數 | 對應 |
| --- | --- | --- |
| 同名直接對 | 9 | 星光の欠片／骨の毒投げ矢／スローイングダガー／石剣の鍵＋5 種調香瓶 |
| 屬性壺 | 4 | 火炎壺・魔力壺・雷壺・聖水壺 → 全部是既有的 `item_throwing_pot`，差別只在屬性 |
| 塗脂 | 5 | 火脂・魔力脂・雷脂・聖脂・盾脂 → 全部是既有的 `item_grease` |

屬性壺與屬性脂不需要新增 8 筆道具資料：midnight 的投擲壺與塗脂本來就把屬性記在
`c.consumableAttributeTags[instanceId]`（取得當下決定，見 `grantConsumableAttributeTag()`／
`applyGreaseAuto()`），所以發放時直接指定 tag 就好。盾脂不帶 tag——midnight 的塗脂本來就是
「裝備盾就塗盾、否則塗近戰武器」，盾脂＝沒有屬性的塗脂。

數量（x1／x2／x3）不另外寫一份表，直接從效果名末尾的「xN を持つ」解析，避免兩邊各寫一次
而對不上。

#### 發放時機與重複防護

跟第 4 期的「出撃時の武器への付加」同一個時機（角色資料首次回流），但**不能共用那段的
本地旗標**：道具會寫進 RTDB，用本地旗標的話重開頁面就會再發一次。因此改用角色物件上的
持久旗標 `c.relicMemoryStartItemsGranted`（同步到 RTDB），重新開始一輪時清掉、下一輪重發
（新的一輪就是新的一次出撃）。

這 22 條的 `stackable` 是 `true`，所以同一條帶兩顆就發兩份。

#### 驗證

`relic_memory_effect_check.js` 新增一組：對應表 18 條、目錄 22 條、沒對應的正好是那 4 條、
每個 `itemId` 都存在於 `consumables.js`、數量解析正確（聖水壺 x3／火炎壺 x2／酸の噴霧 x1）、
`stackable` 帶兩顆發兩份、屬性壺與屬性脂帶對 tag 而盾脂不帶。

---

### 10.13.15 第 6 期第 2 批：角色專用 27 條 ＋ 缺規格 6 條（2026-09-25）

使用者 2026-09-25 逐條補齊了 §10.15 當時列出的全部換算說明，這一批把它們接完。

#### 「アビリティ発動時」在 midnight 對應到什麼

midnight **沒有アビリティ按鈕**——`type.abilities[0]` 是各角色自己的特殊能力，各有既有的觸發點：

| 角色 | abilities[0] | midnight 的觸發點 |
| --- | --- | --- |
| 追蹤者 | 第六感 | `applySixthSenseTrigger()`（自動觸發） |
| 守護者 | 高防禦（ハイガード） | `_highGuardActive`——**狀態**不是事件，所以那條原文寫的是「発動**中**」 |
| 復仇者 | 死靈術 | `maybeRollNecromancyForSelf()` |
| 執行者 | 不撓 | `triggerUnyieldingStackIfApplicable()` |

因此 4 條「アビリティ」效果各自掛在對應的既有觸發點上，不新增第二套「アビリティ」機制。

#### 技能／技藝發動：一個出口接 13 條

`useCharacterAbility(kind)` 是 midnight 角色技能／技藝的唯一出口，所以 13 條全部掛在
`applyRelicMemoryAbilityUse(c, kind)` 一支裡，不逐條在各角色的程式裡加判斷。重用的既有機制：

- **武器附加屬性／異常**（炎・猛毒・腐敗）→ `_tempWeaponSkills`（同第 4 期的出撃時附加）。
- **隊友 HP 價值 ＋ 攻擊力**（學者兩條）→ `meta/partyGuardBonus*`／新增的
  `meta/relicMemoryPartyAtk*`，跟既有的「堅陣」「防禦支援」完全同一套 party-wide 廣播。
- **2 秒無敵**（淑女）→ `_sixthSenseGraceUntil`，那是 midnight 唯一的「這段時間不受傷害」機制。
- **敵人攻擊力 -80**（無賴漢）→ `fieldTrigger/<id>/nextGroupDamageReduceAmount`，同既有的
  「敵人弱化」一次性欄位。
- **技能使用次數 +1**（追蹤者／鐵之眼各一條）→ 既有遺物效果「技能使用次數＋1」的
  `_skillExtraCharges` 蓄積，帶幾條就多幾個上限。
- **技藝後技能立刻冷卻完**（葬儀屋）→ 直接把 `_skillCooldownUntil` 歸零。
- **持續型**（延燒／DOT／隊友每秒回復）→ 掛在既有的 `affixTick()` 節流上（`updateRelicMemoryDots()`），
  不另外發明計時器。

#### 幾個需要記下來的對應判斷

| 效果 | 判斷 |
| --- | --- |
| 學者「スキルの進捗率の低下を抑制」「スキルを自身に使用時、FP消費軽減」 | midnight 的**角色技能沒有體力／FP 消耗**（只有冷卻），有消耗的是**武器戰技**，所以這兩條掛在 `castWeaponSkillEntry()` 的消耗上；FP 那條再看本文有沒有「対象：自身」 |
| 葬儀屋「祈祷で自身に補助効果発生時」 | 「補助効果」在規則書就是「対象：自身」的祈禱，用本文判斷 |
| 守護者「斧槍タメ攻撃時、つむじ風」 | 掛在蓄力攻擊（`entry.kind === "charge"`）＋斧槍類別，跟既有的「斧槍旋風」遺物（2 次 2Hit 觸發）互不影響 |
| 隱者「属性痕を集めた時、対応する属性カット率上昇」 | midnight 的 `elementalMarks` 沒有記錄是哪一種屬性，所以視窗內對**所有屬性**一律生效（本實作的取捨） |
| 守護者「衝撃波」的 10/20/30 | 依**裝備中盾牌的稀有度**（C/U→10、R→20、L→30） |
| 「夜の侵入者を倒す度」 | 使用者指定對象是襲擊者戰士系／襲擊者魔術師系，重用既有的 `targetIsAttackerFamily()` |
| 「HP低下時、カット率上昇」 | 使用者確認 15~20% 是**觸發門檻**、6~12% 是效果值（HP 價值）。門檻只能取一個值，取範圍上限 **20%** |
| 盾脂 | 既有的「塗脂塗在盾上 → 10 秒內 HP 價值 +10」不變，新增「防禦成功時反擊 目前防禦價值 ×0.5 傷害」 |

#### 屬性壺／塗脂

使用者 2026-09-25 確認「給投擲壺／塗脂掛上屬性，拿到及使用就是其屬性」——這正是第 5 期
已經做的方式（發放時寫 `consumableAttributeTags`，使用時讀出來），不需要改動。


## 10.14 第 3〜4 期的規格缺口（2026-09-25 使用者補齊，已全數解決）

以下三塊當時卡住的規格，使用者在 2026-09-25 一次補完，對應的實作與驗證見
§10.13.9〜§10.13.11。這一節保留原本的缺口描述與使用者的答覆，作為「為什麼是這些數值」
的可追溯紀錄。

### 10.14.1 第 3 期：能力值（29 條）—— 已解決

midnight **沒有**艾爾登法環那 8 種能力值，只有 `POWER_MOD_STAT_MAP` 的**威力補正**
（力量／技巧／平衡／智力／信仰／神秘）與 HP／FP／體力三種資源。缺的是
「生命力／精神力／持久力／強靭度在 midnight 代表什麼」與「16 條角色專用互換的數值」。

**使用者 2026-09-25 的答覆（原文要旨）**：

- 基礎 4 條：`rm_stat_poise` ＝平衡 +1~3、`rm_stat_endurance` ＝體力 +2%~5%、
  `rm_stat_mind` ＝ FP +2%~5%、`rm_stat_vigor` ＝ HP +2%~5%。
- 原則：FP・HP ±20／體力 ±15／其餘屬性 ±10。
- 16 條角色專用互換逐條給值（鐵之眼 2／淑女 2／無賴漢 2／復仇者 2／隱者 2／執行者 2／
  學者 2／葬儀屋 2）。

逐條值與原則有一處不一致：原則寫體力 ±15，但逐條列出的體力值寫成 ±20。
回報後使用者確認**以原則為準**，因此實作採 ±15。

### 10.14.2 第 4 期剩下的 44 條 —— 已解決（42 條接入，2 條缺資料）

#### `spellSchool` 14 條

當時的判斷是「既有機制對應不上」，因為用**招式名稱**比對時 14 種系統裡有 7 種
在 251 條招式名中完全找不到。使用者 2026-09-25 的指示是
「魔法與祈禱有其種類，針對其種類分類並加乘其種類的傷害」。

實查後發現不必新增欄位：`weapons_skills.js` 的 `kindLabel` 本來就是系統名，14 種全中
（見 §10.13.10）。所以三個選項（新增欄位／降級成全體加成／不採用）都不必選。

#### `grantWeaponSkill` 20 ／ `grantSpell` 10

兩個問題的答覆：

1. **替換 vs 追加** —— 使用者：「直接替換欄位，不保持兩個戰技」。因此新增覆寫欄位
   `c.relicMemorySkillSwap`，不沿用追加用的 `weaponExtraSkills`。
2. **缺 2 條招式資料**（「嵐脚」「デターミネーション」）—— 使用者：「先不進入抽選池」。
   因此目錄上帶 `d`（missingData）旗標，由 `drawableEffects()` 排除。


## 10.15 仍未接入的 2 條（2026-09-25 第 7 期後重新盤點）

抽選池 361 條中，只剩 2 條抽到時仍然只會顯示名稱與數值。

### 10.15.1 結晶雫（22 條，`startFlask`）—— 已解決，見 §10.16

原本這裡記的是「22 種全部沒有資料，待補」。使用者 2026-09-25 補齊了 22 條的規格，
其中 21 條已實作（§10.16），剩下的「細枝の割れ雫」依使用者指示「不能抽到 建檔」，
加了 `d`（missingData）旗標由 `drawableEffects()` 排除，因此抽選池從 362 降為 **361** 條。

### 10.15.2 需要「踏破板塊時發盧恩」的事件出口（2 條）—— 已解決，見 §10.17

| 效果 | 換算 | 缺什麼 |
| --- | --- | --- |
| `rm_party_rune_up` | 踏破板塊時 自身與隊友的盧恩額外 +1 | midnight 發盧恩的出口 `grantRunesToTokens()` 同時服務多種來源，沒有「剛踏破板塊」這個事件出口 |
| `rm_milestone_fort_rune` | 小砦擊破後 盧恩 +1、發現力 +1（抽選時骰出的點數 +1） | 同上；另外「發現力」需要一個 midnight 沒有的「抽選時骰出的點數」加成欄位 |

這兩條**刻意不列進 `RELIC_MEMORY_AFFIX_ALIAS`**：alias 是「已接入」的唯一來源（稽核表會
逐條檢查），列上去會變成靜默失效。

### 10.15.3 已建檔但改成抽不到的 5 條（使用者 2026-09-25 指示）

`d`（missingData）旗標，由 `drawableEffects()` 排除，資料保留：

| 效果 | 原文 |
| --- | --- |
| `rm_start_crystal_dart` | 出撃時に「結晶投げ矢」x3 を持つ |
| `rm_start_glintstone_scrap` | 出撃時に「屑輝石」x2 を持つ |
| `rm_start_gravity_stone_chunk` | 出撃時に「塊の重力石」x2 を持つ |
| `rm_start_frenzy_perfume` | 出撃時に「狂熱の香薬」x1 を持つ |
| `rm_glintstone_gravity_atk_up` | 輝石、重力石アイテムの攻撃力上昇 8~15% |

五條共同的原因是 `consumables.js` 沒有對應道具。補上道具資料後把 `"d"` 拿掉即可。

因此抽選池從 367 → 362 條，再加上 2026-09-25 第 7 期把「細枝の割れ雫」也標成 `d`，
現在是 **361** 條，全池（含 24 種附帶效果）**385** 條。

---

## 10.16 第 7 期：結晶雫（21 條，2026-09-25 完成）

### 使用者明確規格（原文）

> 此類為特殊結晶雫
> 擁有時（只能存在一件），操作盤的聖杯瓶使用可以左右切換聖杯瓶或是結晶雫，結晶雫使用
> 時間如聖杯瓶，使用次數1，用完需回到祝福才能補充。
> 在角色視窗如果擁有結晶雫則顯示該內容

### 為什麼不走 `RELIC_MEMORY_AFFIX_ALIAS`

那張表的語意是「帶著這條效果就一直生效」——`relicMemoryBonusTotal()` 掃到就無條件把值
加進去。結晶雫不是這種東西：它是一件**要按下去才生效、而且只能按一次**的道具。所以另外
一張 `RM_CRYSTAL_TEARS`（`static_src/midnight.js`），`_debugRelicMemoryWiredIds()` 把它
一併算成「已接入來源」，稽核表才不會把這 21 條誤判成沒接。

### 資料與機制的分工

| 放哪裡 | 內容 |
| --- | --- |
| `midnight_relic_memory_catalog.js` | 22 條的名稱與 `note`（換算說明的顯示文字）。**note 不是 memory.txt 原文**——原始資料這 22 條全部留白，換算是使用者補的（同 §10.14.1 A 的前例） |
| `midnight.js` 的 `RM_CRYSTAL_TEARS` | `{ kind, value, element, ms, threshold }`——實際的數值與生命週期 |

雫的**名稱**不在兩邊各寫一次：由 `crystalTearName()` 從效果名
「出撃時に『緋色の結晶雫』を持つ」裡機械化解析出引號內那段（同 `RM_START_ITEM_COUNT_RE`
解析數量的做法）。

### 持有、次數與補充

| 欄位 | 位置 | 說明 |
| --- | --- | --- |
| `c.crystalTearId` | RTDB `character/<token>/crystalTearId` | 出撃時決定一次（`applyCrystalTearGrant()`），帶入的記憶中**第一條**雫效果——「只能存在一件」 |
| `c.crystalTearUsed` | RTDB 同上 | 用掉了沒有。`applyBlessingRestore()` 清掉＝「用完需回到祝福才能補充」，跟聖杯瓶使用回數補滿同一個時機 |
| `c._crystalTear` | 本地 | 生效中的時限型效果 `{ id, kind, value, element, ms, until }` |
| `c._crystalTearArmed` | 本地 | 等觸發型（泡雫 2 條）`{ id, kind, value, threshold }` |

發放共用 `relicMemoryStartItemsGranted` 這個持久旗標（第 5 期就有的「這次出撃發一次」），
重新開始一輪時那個旗標被清掉、下一輪重新決定；`resetRelicMemoryCycleLocalState()` 另外把
兩個本地欄位與 `flaskSlotIndex` 一起清掉。

**`_crystalTear` 必須列進 `LOCAL_ONLY_CHARACTER_FIELD_RE` 白名單。**
`commitCrystalTearUse()` 會先 `rtSet(crystalTearUsed)` 再設本地 buff，那個寫入的回流會把
`characters` 整份換掉——不加白名單的話實測「次數扣掉了、buff 0.5 秒後消失」，跟 2026-09-20
審查 H1 的「勇者的肉塊」完全同一個病灶。`crystal_tear_emulator_check.js` 有針對這點的斷言。

### 操作盤

聖杯瓶卡片外包一層 `#midnight-flask-wrap`（結構完全比照 `#midnight-consumable-wrap`，
HTML 不允許 button 巢狀 button），兩顆 ◀▶ 絕對定位貼在左右邊緣。目前選第幾格由本地的
`flaskSlotIndex`（0＝聖杯瓶、1＝結晶雫）決定，沒有雫時只有 1 格、切換鍵 disabled。
讀取條、「使用中」浮標、`FLASK_READ_MS` 全部沿用聖杯瓶既有的那一套——使用者明確規格
「結晶雫使用時間如聖杯瓶」；按下當時選的格子記在 `flaskReadingSlot`，讀取中切換卡片不會
改變這次喝的是什麼。剩餘次數徽章放**左上角**（消耗品卡片是右下角）：聖杯瓶格只有 48px 高，
放右下角會壓在品名第二行上。

### 21 條的注入點

全部接到既有計算點，沒有為單一條開新架構（CLAUDE.md §42.11）：

| 雫 | 換算 | 注入點 |
| --- | --- | --- |
| 緋色の結晶雫 | 回復 HP 上限的 50% | `healSelfHp()` |
| 青色の結晶雫 | FP 回復 50 | `healSelfFp()` |
| 緋湧きの結晶雫 | 20s HP 回復 60 | 既有的 `startHealOverTime()`（溫石同一支 ticker） |
| 緑湧きの結晶雫 | 20s 體力回復 60 | `updateStamina()` 的 `extraRegenPerSec`（＝3/秒，由總量÷時間算，不寫死） |
| 緋溢れの結晶雫 | 20s HP 上限與 HP +30 | `selfArenaHpMax()` 的 flat 層；到期由 `updateCrystalTear()` 把現在 HP 夾回上限 |
| 真珠色の硬雫 | 20s HP 價值 +20 | `consumableGuardBonusPct()` |
| 斑彩色の硬雫 | 20s 屬性蓄積值上限 +2、狀態異常全回復 | `receivedAccumThreshold()`；後半清空 `receivedAttributeAccum` 的 7 種異常（**屬性不清**——原文寫的是「状態異常全回復」，取字面窄讀） |
| 鉛色の硬雫 | 20s 減傷 20% | `resolveMyIncomingHit()` 的獨立乘法層（**不併進 `activeTempGuardPct()`**——那支是取 max，會被逆襲的 80% 整個蓋掉） |
| 魔／炎／雷／聖 纏いの割れ雫 | 20s 該屬性攻擊力 +10% | `affixOutgoingDamageMult()` 的 `ctx.element` 分支 |
| 岩棘の割れ雫 | 10s 20% 機率攻擊帶▲ | `damageCombatTarget()` 裡多記一次 `recordGuardReductionForPoint(pointId, "▲")`（同雙手持握 2Hit 補▲的做法，不影響傷害） |
| 大棘の割れ雫 | 20s 蓄力攻擊 +10% | `affixOutgoingDamageMult()` 的 `ctx.charge` |
| 連棘の割れ雫 | 20s 2hit 攻擊 +10% | 同上的 `ctx.twoHit` |
| 風の結晶雫 | Perfect〜Great 減傷 100%、受到傷害 +20% | 前半在 `resolveMyIncomingHit()` 把 `spriteDodgeJudge()` 判到的 great 提成 100（純函式本身不改，測試會直接呼叫它）；後半在 `affixIncomingDamageMult()` |
| 緋色の泡雫 | HP 20% 以下時 HP 補 30，一次觸發結束 | `_crystalTearArmed`，每影格由 `updateCrystalTear()` 檢查 |
| 緋色渦の泡雫 | 10s 內被攻擊的傷害 40% 回復 HP | `resolveMyIncomingHit()` 算完最終 damage 後，跟 `onRelicMemoryDamaged()` 同一處 |
| 真珠色の泡雫 | 限一次 受到傷害時減傷 80% | `consumeCrystalTearOnceCut()`，只在這一擊真的會造成傷害時才消耗 |
| 青色の秘雫 | 10s 內 FP 消耗 0 | `computeMidnightSkillCostRaw()` 的 `noFp`（跟隱者「聖幕」同一個判斷） |
| 破裂した結晶雫 | 自身扣 HP 的一半，造成同等傷害 ×4 | `spendSelfHp()` ＋ `damageCombatTarget()`。「HP 的一半」取**目前 HP**（原文「自身扣HP的一半」＝手上的血，不是上限），傷害基準同一個數 |

### 換算假設（待使用者確認）

**「風の結晶雫」使用者沒有給持續秒數**，其餘 21 條都有。目前採同批多數的 20 秒
（`RM_CRYSTAL_TEAR_DEFAULT_MS`），規格確認後只要改這一個常數。

### 不實作的 1 條

「細枝の割れ雫」（死亡時にルーンを落とさなくなる）：midnight 全檔沒有任何「死亡時扣
`c.runes`」的處理，沒有事件出口可以掛。使用者明確指示「不能抽到 建檔」，因此目錄那條加了
`d` 旗標、由 `drawableEffects()` 排除，資料保留。

### 驗證

| 腳本 | 驗什麼 | 需要 emulator |
| --- | --- | --- |
| `tools/midnight_check/crystal_tear_check.js` | 換算表與目錄對得起來（21/22、細枝抽不到、每條都有 note 與可解析的名稱）、「只能存在一件」、每一條生效時各計算點實得值（期望值從表自己的 value 推，不硬編） | 否 |
| `tools/midnight_check/crystal_tear_emulator_check.js` | 實機流程：出撃時取得 → ◀▶ 切換 → 讀取條走完扣次數 → buff 沒被回流洗掉 → 角色視窗顯示 → 祝福回復後可再用 | 是 |

第 5／6 期的 `relic_memory_effect_check.js` 有三處期望值跟著改（CLAUDE.md §4.7）：
`startFlask` 從 `[22, 0]` 改成 `[21, 21]`、`totalWired` 338 → 359、`stillOpen` 24 → 2，
並把 `startFlask` 加進「已完成期別」清單。

---

## 10.17 最後 2 條盧恩效果＋互斥組（2026-09-25 完成）

### 使用者明確規格（原文）

> rm_milestone_fort_rune：小砦最後階完成擊倒敵人後, 盧恩+1 & 未來抽選潛在能力與稀有度時骰出的點數+1
> rm_party_rune_up：板塊完成探索全踏破時 全隊的盧恩額外+1
>
> 初始武器帶屬性 帶戰技 等等 一個遺物記憶只能抽到一條
> 結晶雫 一個遺物記憶只能帶一條
> 玩家裝備裝上不同科的不可重複效果時 只會發動前面一個的效果

### `rm_party_rune_up`

- 注入點：`maybeGrantFieldFullClearReward()`——全踏破盧恩的唯一出口（護符「貪婪者的烙印」同一處），
  只在搶到 `fullClearRewardGrantedBy` 的那台裝置執行，不會重複發。
- 這個板塊的**參加者**中有人帶這條 → 全體參加者的全踏破盧恩各 +1（寫進同一筆 `pendingRewards` 的 rune）。
- 多人帶／同一人帶多顆都只 +1（`stackable:false`，同「致命の一撃でルーン取得」的「任一在場 PC 有就發」）。
- 觸發條件是「全踏破」本身，因此全踏破效果寫「盧恩：0」的板塊也照發 +1；貪婪者烙印維持原本「板塊沒有盧恩就不發」。

### `rm_milestone_fort_rune`

- 次數：`RM_MILESTONE_CARDS.rmMilestoneFortRune = "3"`（小砦＝card_3），跟其他 5 條里程碑同一套
  （`fieldProgress[id].cleared` 的數量，誰踏破都算）。
- 盧恩：`updateRelicMemoryFortRunes()` 每影格比對次數與角色的持久欄位 `relicMemoryFortRuneCount`，差額 × 1 發給自己
  （`grantRunesToTokens()`＋toast）。第一次看到時只建立基準不補發（中途加入）；restart 不清 `fieldProgress`，次數不倒退，不會重發。
- 發現力：`relicMemoryFortDiscoveryBonus()`＝每踏破一個小砦 +1。接在
  - `affixDiscoveryBonus()`（詞條「発見力上昇」的既有出口：商人與獎勵清單的武器稀有度擲骰）；
  - `CharacterDrawer.potentialPowerDrawWeapon(c, starCount, rarityBonus)`（新增可省略的第 3 參數，night.js 不傳、行為不變）。
  注意：詞條「発見力上昇」本身**沒有**接到潛在之力（既有行為，這次未改）。

### 互斥組

- `midnight_relic_memory_catalog.js` 的 `exclusiveGroup(id)`：
  `weaponInfusion`／`grantWeaponSkill`／`grantSpell` → `"startWeapon"`；`startFlask` → `"crystalTear"`；其餘 null。
- 抽選：`rollEffects()` 的 `opts.exclusiveGroup`——同一顆記憶內已抽到的組不再出現（只過濾候選、不擲骰，
  §10.12 的受控亂數序列不變）。
- 帶入：`relicMemoryFirstGroupEffectId(c, group)`＝帶入順序（記憶順序→記憶內順序）第一條。
  - 屬性附加：只有第一條是屬性附加時才附加那一種（原本會把所有不同屬性都附加上去）。
  - 戰技／魔術置換：只有第一條是置換時才置換。
  - 結晶雫：取第一條（原本就是）。
- 角色視窗的記憶詳細中，被壓掉的效果加註「（同類效果只發動第一條，此條未發動）」。
- 「出撃時の武器」三種**合為一組**是依使用者把「帶屬性 帶戰技 等等」並列的措辭判斷。

### 驗證

`relic_memory_effect_check.js` 新增「盧恩 2 條＋互斥組」一節，並依 CLAUDE.md §4.7 改了過時期望值：
「炎＋出血一起帶 → 掛上 2 條」改為只發動第一條（炎）、`special` 73→74、`globalMilestone` 6→7、
`totalWired` 359→361、`stillOpen` 2→0；`relic_memory_drawer_check.js` 的 opts 鍵加上 `exclusiveGroup`。

## 10.18 抽選池只用目錄；24 種附帶效果移出（2026-09-25）

使用者 2026-09-25 明確說明：`CharacterDrawer` 的 24 種附帶效果「是另外的遊戲中附帶效果，後面再補上缺漏；
與遺物記憶的附帶效果互無關連」。§10.1 的「並存」原本被理解成兩池相接（24＋目錄），這裡更正為：

- `relicMemoryDrawPool()`＝`Catalog.drawableEffectIds()`（361 條），**不含** 24 種附帶效果。
- 已存在 Firebase、效果是那 24 種 id 的舊記憶不遷移，帶入時仍經 `activeAttachedEffectIds()` 照舊處理。
- 24 種附帶效果在 midnight 的缺漏（多數只在 night.js 實作）屬於「遊戲中附帶效果」那套系統，之後另外補，
  不在遺物記憶範圍。
- `_debugRelicMemoryPool().attached` 改為「池裡混進幾種附帶效果」（應為 0）；`relic_memory_drawer_check.js`
  依 CLAUDE.md §4.7 改期望值（舊：池＝24＋目錄、attached＝24）。

## 10.19 結算存入後消失（避免重複存入）＋完整流程 E2E（2026-09-25）

### 使用者明確規格

> 遊戲結束時能按照遊戲內容派發遺物記憶 內容大小都以抽選好, 查看內容後可以輸入序號來存入,存入後消失.(避免重複存入)
> 再次開啟其他遊戲輸入序號後能看到上次的記憶 選擇最大三種進入遊戲能使用效果成功

### 存入後消失

- 存入成功時把該批 memId 寫進 `character/<token>/relicMemory/savedIds/<memId>: true`（RTDB，reload／接管席位後仍在）。
- `myEarnedRelicMemories()` 一律濾掉 `savedIds` 內的記憶：結算清單清空、保存按鈕停用、狀態顯示「已經全部保存過了」。
  換另一組序號也存不進去（原本 `mergeIntoStore()` 只防同一組序號內重複）。
- `processMyRelicMemoryGrants()` 的 transaction 會原樣保留 `savedIds`（否則被洗掉又能重存）。
- 重新開始一輪時 `relicMemory` 整個重寫，`savedIds` 一併清掉（新一輪的記憶 memId 都是新的）。

### 勝利路徑的結算重試（E2E 發現的既有 bug）

reload（接管席位）後若在角色資料到達前就按下勝利確認，`openRelicMemorySettle()` 直接返回、勝利彈窗卻已關閉，
結算視窗永遠不會出現。`updateRelicMemorySettle()` 原本只替「放棄」路徑每影格重試，現在勝利路徑
（`gameVictoryDismissed && day3BossDefeated()`）也一樣重試。

### 驗證：`tools/midnight_check/relic_memory_full_flow_check.js`（emulator）

1. 第 1 場：以真實判定來源墊出遊戲內容（3 板塊踏破、第一／二天夜之強敵、夜王）→ 各來源的大小符合 §3 獲得表、
   條數＝大小、效果全部是目錄中已接入者、同一顆內互斥組最多一條 → 勝利確認 → 結算列出全部 → 存入 → 清單消失、
   Firebase 件數與內容一致 → reload＋接管 → 結算為空、不能再存、換序號也存不進去。
2. 第 2 場：等待房輸入序號 → 列出上次存入的全部記憶 → 選 3 個（第 4 個選不進去）→ 開局後帶入的正是那 3 個、
   所有效果都有接入點；另放一顆已知數值的記憶驗證 HP 上限 +20、物理攻擊 ×1.05 真的反映在計算點上。

`crystal_tear_emulator_check.js` 補上 `PRITEST_EMU_PORT`（原本固定連 9000）。

### 序號

20 組正式序號以一次性腳本產生（字元集排除易混淆的 0/O/1/I/L），**不提交進 Git**，
由管理者匯入正式環境 `relicMemoryCodes/<CODE>: true`（§2.1）。
