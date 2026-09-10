# Midnight（即時制擴張版）板塊卡牌樓層分支／籌碼事件整理

本文件整理 `static_src/midnight.js`（搭配 `midnight_map.js`）目前對「板塊卡牌樓層探索」與
「籌碼事件」這兩套機制的**實際程式行為**，並比對是否受「夜王劇本」選擇影響。

**重要前提**：`midnight.js` 直接讀取跟 `night.js`（回合制）完全相同的規則資料模組
（`window.PriTestFields` = `fields_data_1~4.js`、`window.PriTestEventRulebook` =
`event_rulebook.js`），沒有另外複製一份文字。因此「樓層描寫／分歧選項文字／獎勵配置」這些
**內容本身**兩邊完全共用、不會有差異；有差異的只有「這份資料被拿去怎麼用」的流程機制
（回合制手動 GM 敘述 vs 即時制自動投票/自動指派）。

`fields_data_1~4.js` 四份檔案合計 12,677 行、涵蓋 A（出發地點）／Z（黃金樹之帳，即
`a_golden`）／2~10／K／J 共 14 種卡牌、每張卡下再細分數個「分歧（branches）」、每個分歧下
再有 1~5 個「樓層（floors）」，逐字轉錄規則書原文。本文件**不會逐卡逐樓層窮舉原文**（那等同
複製一份規則書），而是說明「機制怎麼運作」＋「資料結構長什麼樣子」＋「用具體範例示範一次」，
並列出所有籌碼事件的完整規則對應與程式位置，方便之後查閱或修改時定位。

---

## 1. 地圖上的點位總覽（`midnight_map.js` `buildPointRequests()`）

地圖用同一個 `meta.mapSeed` 決定性生成，點位分兩大類：

### 1.1 對應 `fields_data_*.js` 卡牌的板塊點（沿用樓層探索 pipeline）

| 卡牌 | 地點類型 | 數量 | 備註 |
|---|---|---|---|
| 2 | 大教會 | 2 | |
| 3 | 小砦 | 2 | |
| 4 | 大野營地 | 2 | |
| 5 | 遺跡 | 2 | |
| 6 | 坑道 | 2 | |
| 7 | 湖沼 | 2 | |
| 8 | 鍛造村（`type:"forge"`） | 1 | 樓層流程與其他卡牌相同，只是 `type` 標籤不同 |
| 9 | 封牢（`type:"evergaol"`） | 3 | **需持有「石劍鑰匙」消耗品才能按「進入」**（見 §6.1） |
| 10 | 魔術師塔（`type:"sorcerer"`） | 2 或 3（seed 決定） | **不走樓層 pipeline**，是獨立的解謎小遊戲（見 §6.2） |
| K | 教會 | 3（分區稀疏放置） | 樓層 1 的獎勵含「聖杯瓶使用上限 +1」（`chaliceBonus`，見 §4） |
| J | 堡壘 | 固定 1（地圖中央 `castleZone`，非隨機放置） | 用「面」而非「距離」判斷靠近，見 §1.3 |
| A（出發地點）／Z（黃金樹之帳） | — | 各 2（Day1/Day2 各一組固定位置） | 由 `midnight_map.js` 的 `assignDayPlan()` 指定，Z＝縮圈終點，見 §9 |

### 1.2 新增「籌碼」點（不對應 `fields_data_*.js` 卡牌，見 §7）

| 類型 | 數量 | 對應規則 |
|---|---|---|
| `merchant`（商人） | 2 | 讀 `event_rulebook.js` 的 `merchant` chip |
| `strong_enemy`（強敵） | 3 | 讀 `event_rulebook.js` 的 `strong_enemy` chip「強敵決定表」 |
| `random_event`（隨機事件） | 2 | 只自動化「聖甲蟲」分支，其餘規則書分支未接入（見 §7.3） |
| `blessing`（祝福） | 10 | **不是**讀 `event_rulebook.js`（該資料裡沒有 `blessing` id），是完全自訂硬編碼的回滿邏輯（見 §7.4） |

「霊脈」籌碼（規則書 §9 五種籌碼之一）**在 midnight.js 中完全沒有實作**，地圖上不會生成霊脈點
（`buildPointRequests()` 沒有對應項目）。

### 1.3 判定機制差異

- 一般板塊點／新籌碼點：`FIELD_TRIGGER_RADIUS = 1.6` 格內視為「靠近」。
- 王城（J，堡壘）：用「是否落在 `castleZone` 遮罩範圍內」的面判定（`Map_.isCastleZone()`），
  不是距離判定，因為王城是地圖中央一塊固定區域而非單點。
- 魔術師塔（sorcerer）、商人、強敵、隨機事件、祝福：各自獨立的 proximity 掃描
  （`updateNearbyChipPoint()`／`updateNearbyTower()`），跟一般板塊點的
  `updateNearbyFieldPoint()`（`NON_FIELD_POINT_TYPES` 排除表）互不干擾，避免同一格內多重
  提示互搶顯示。

---

## 2. 板塊樓層機制：完整運作流程

以「靠近一張一般板塊卡（含王城/教會/鍛造村/封牢，不含魔術師塔）」為例，完整流程如下
（對應 `fieldTrigger/{pointId}` 這個 RTDB 節點的 `status` 狀態機）：

```
（無 fieldTrigger）
   ↓ 有玩家按「進入」（handleEnterFieldPointClick）
status: "inviting"（3 秒邀請時限，FIELD_INVITE_TIME_LIMIT_MS）
   ↓ 附近玩家可按「加入」（handleAcceptFieldInviteClick），逾時後不論有誰加入都繼續
status: "active"（maybeAdvanceFieldInvite，此時才決定 branchIndex／floorIndex）
   ↓ 參與者各自等待 0.5 秒（FIELD_ENTER_WAIT_MS）
   ↓ 打字機播放樓層【描寫】文字（maybeStartFieldTypewriter，重用 night_gm_flow.js 的 typewriteInto）
   ↓ 播完後開始算 10 秒投票期（FIELD_VOTE_TIME_LIMIT_MS，maybeSetFieldVoteDeadline）
   ↓ 若敘述文字含「(→XXX)」分歧標記則需投票（maybeResolveFieldVote），否則直接視為單一結果
status: "resolved"（choiceIndex 確定）
   ↓ 掃描選中分歧段落文字裡的「「敵名(頁)/Lv.N」」引用（maybeAssignFieldEnemy）
   ├─ 無敵人引用＝和平通過 → 直接發放這一樓層的戰利品獎勵、推進樓層進度
   └─ 有敵人引用 → 指派敵人／等級／雜兵，進入即時戰鬥（沿用一般戰鬥 pipeline）
        ↓ 敵人 HP 歸零
      發放這一樓層的戰利品獎勵（maybeGrantFieldTileRewardOnClear）、推進樓層進度
```

### 2.1 分歧「變體」的挑選（跟劇本無關，見 §10 詳細分析）

`fields_data_*.js` 中每張卡的 `branches[]`（例如「大教會(1)」「大教會(2)」等變體版本）在規則書
原文裡是依「劇本＋花色」查 `varianceTable` 決定的（見 `docs/scenario_flow_rules.md`）。但
`midnight.js` 完全沒有「劇本」「花色」概念可用於這個決定，因此改用
`fieldSeededIndex(pt.id + ":branch", branches.length)`——用 `meta.mapSeed` 衍生的決定性亂數，
在這個點第一次被進入時挑一個分歧變體，之後同一張卡的所有樓層都固定沿用同一個
`branchIndex`（存進 `fieldProgress/{pointId}/branchIndex`，不會每層重挑）。

### 2.2 樓層文字中的「(→XXX)」選項：玩家投票，不是分歧變體

規則書樓層敘述文字中若含「(→潛行通過)(→正面突破)」這類標記（`night_gm_flow.js` 既有的
`parseChoiceLabels()` 解析），代表這一層本身有玩家選擇。這才是使用者需求裡「樓層中各選擇項」
真正對應的機制：

- 只有「目前在這個板塊事件裡的參與者」（`trig.participants`）需要投票，不是全場玩家。
- 全員一致才立即確定；10 秒逾時仍未達成共識時，優先採多數決（`pickFallbackChoice`），完全
  沒人投票才退回 `fieldSeededIndex()` 決定性亂數。
- 選項只有 0 或 1 個（沒有真正分歧）時，直接視為單一結果，不觸發投票 UI。

### 2.3 選中分歧後的敵人指派

只掃描**選中那個分歧段落**（`collectLinesForChoice()`：從標籤那一行開始、抓到下一個
depth≤1 為止的巢狀內文）裡的敵人引用文字，跟 `night_gm_flow.js` 的
`parseCombatEnemyRef`／`resolveCombatEnemyMatch` 用同一套解析邏輯比對
`enemies_data_1~4.js`：

- 找不到敵人引用＝這個分歧和平通過，不強行指派戰鬥。
- 找到多個候選時用 `fieldSeededIndex(pt.id + ":enemy", ...)` 決定性挑一個。
- 若文字帶「+雜兵N」後綴，額外建立 `fieldMobHp/{pointId}` 雜兵血量池（`N × MOB_HP_PER_ROW(10)`）。
- 敵人 HP 上限、等級、攻擊招式全部沿用 `docs/midnight_realtime_combat_numbers.md` 記載的
  即時制數值真正接入公式，不是佔位值。

---

## 3. 樓層資料結構（`fields_data_*.js`）與樓層數

每張卡的資料結構（`window.PriTestFields.get("card_" + id)`）：

```js
{
  id: "card_2",
  name: C(ja, zh),
  floorCount: 1,              // 這張卡固定樓層數（規則書「1〜5フロア」，本作品實際多為1~2）
  allFloorEffect: C(ja, zh),  // 全踏破效果原文，例如"盧恩：2／時間損耗：1"
  branches: [
    {
      name: C(ja, zh),        // 分歧變體名稱
      intro: C(ja, zh),       // 分歧介紹文字（找不到樓層【描寫】時的退回文字）
      floors: [
        {
          lines: [ ... ],     // 敘述/選項/機關等逐行資料，label==="描写/描寫"的行是主敘述
          reward: [ ... ],    // 這一層的獎勵配置（見§4）
        },
        // ...最多到 floorCount 層
      ],
    },
    // ...這張卡的所有分歧變體
  ],
}
```

`fieldFloorCountForCard()` 優先讀卡片本身的 `floorCount`（而非 `branches[0].floors.length`），
因為極少數卡（例如規則書「水辺の大教会」有「任意順序踏破 4 層中的 2 層即算全踏破」的
`freeFloorOrder` 特例）`floorCount` 跟 `floors.length` 不同。**midnight.js 不支援
`freeFloorOrder` 的任意順序彈性**，一律照陣列順序 0,1,2...走到 `floorCount` 為止才算全踏破，
是已知的簡化（不是算錯數字）。

### 3.1 範例（示範用，非窮舉）

`fields_data_4.js` 的 `card_k`（教會）第 1 層獎勵含：

```js
reward: [{ kind: "chaliceBonus", value: 1 }, ...]
```

對應規則書原文「PC全員は『聖杯瓶の使用回数：+1』を獲得」，`midnight.js` 會把這個獎勵發給
**這個板塊事件的所有參與者**：`c.flaskMax += 1; c.flaskCount += 1`（聖杯瓶上限與目前充能同時
增加，等同拿到新瓶並直接補滿）。

由於每張卡實際文字量龐大（14 種卡牌 × 數個分歧 × 1~5 樓層，逐字轉錄自規則書），**具體每一層
的敘述/選項/獎勵內容請直接查閱對應的 `fields_data_1~4.js` 原始資料**（`window.PriTestFields.get()`
可在瀏覽器 console 直接查詢，例如 `PriTestFields.get("card_2")`）——本文件的重點是「機制如何
運作」，不重覆轉錄規則書全文。

---

## 4. 樓層獎勵：種類與實際授予規則

規則書樓層 `reward[]` 欄位裡的 `kind` 共有 9 種「戰利品」（無需 GM 判斷即可自動授予）＋
5 種「需要 GM/玩家判斷」的類型（`hpDamage`／`tieredChoice`／`diceHandChoice`／
`bargainReveal`／`note`，見 `night_floor_breakthrough.js` 的 `isLootRewardEntry()` 分類）。

`night.js`（回合制）對兩種類型都有完整處理（戰利品自動 push 進獎勵清單、GM 判斷類型另開
縮小版彈窗）。**`midnight.js` 只處理「戰利品」類型，且戰利品 9 種裡也只有其中 5 種真正被授予**：

| `reward[].kind` | 是否為戰利品（`isLootRewardEntry`） | midnight.js 是否實際授予 | 授予方式（`grantLootRewardEntryToCharacter`） |
|---|---|---|---|
| `rune`（盧恩） | ✅ | ✅ | `c.runes += value` |
| `weaponStar`（武器★） | ✅ | ✅ | `CharacterDrawer.merchantDrawWeapon(c, value)` 抽武器，背包滿則略過 |
| `consumable`（消耗品） | ✅ | ✅ | 有指定 `itemId` 就給該項，否則從全部消耗品池隨機抽 1 個；背包滿則略過 |
| `talisman`（裝飾品） | ✅ | ✅ | 從全部裝飾品池隨機抽 1 個；背包滿則略過 |
| `chaliceBonus`（聖杯瓶上限） | ✅ | ✅ | `flaskMax`／`flaskCount` 各 +value |
| `potentialPower`（潛在力量★） | ✅ | ❌ 略過 | 角色物件無對應欄位，本次 milestone 未接入 |
| `stoneswordKey`（石劍鑰匙） | ✅ | ❌ 略過 | 同上 |
| `smithingStone`（鍛造石） | ✅（非 perPerson） | ❌ 略過 | 同上 |
| `weaponSkillReroll`（戰技重抽） | ✅ | ❌ 略過 | 同上 |
| `hpDamage`／`tieredChoice`／`diceHandChoice`／`bargainReveal`／`note` | ❌（GM 判斷類） | ❌ 完全未處理 | `reward.filter(isLootRewardEntry)` 直接濾掉，**不會顯示給任何人**，也不會留 log 提醒 |

換句話說：**若某樓層的獎勵其實需要 GM 判斷（例如分級選擇 tieredChoice、擲骰役判定
diceHandChoice），midnight.js 目前會直接靜默跳過，不會有任何提示**——這跟 `night.js` 的
「至少開一個縮小版彈窗讓 GM 手動判斷」不同，是即時制版本明確的範圍限縮（未實作，非 bug）。

授予對象：**這個板塊事件的所有參與者**（`trig.participants`），不是單一玩家。授予時機：
- 和平通過（無敵人）：分歧確定當下立即發放。
- 有戰鬥：敵人 HP 歸零那一刻發放（`maybeGrantFieldTileRewardOnClear`）。

授予後會在該角色物件寫入 `_lastTileRewardNote`（本地 toast 用），並用
`fieldTrigger/{pointId}/tileRewardGrantedBy` 的 transaction 做 first-writer-wins 防止多台
裝置重複發放。

---

## 5. 全踏破效果（`allFloorEffect`）

一張卡的所有樓層（`floorIndex` 走到 `floorCount`）都踏破後：

- `maybeAdvanceFieldProgressAfterFloorClear()` 標記 `fieldProgress/{pointId}/cleared = true`。
- `maybeGrantFieldFullClearReward()` 解析 `card.allFloorEffect` 原文裡的「盧恩：N」數字
  （`parseAllFloorEffectRuneAmount()`，跟 `night.js` 的 `parseAllFloorEffectAmount` 同款
  regex），發放給這個板塊事件的所有參與者。
- **時間損耗（タイムロス）部分完全不套用**：規則書全踏破效果同時包含「盧恩獲得＋時間損耗」，
  但 midnight 用縮圈倒數取代 night.js 的天數/時間損耗資源，沒有對應機制可套用，是已知的範圍
  限制（不是算錯數字）。
- 全踏破後 `fieldTrigger` 節點**不清空**（維持存在），讓地圖圖示能持續判斷
  `fieldEnemyHp<=0` 顯示已清除記號；未全踏破則清空 `fieldTrigger`／`fieldEnemyHp`，讓玩家
  之後重新按「進入」時，從 `fieldProgress` 記錄的下一個 `floorIndex` 繼續（不會重新抽分歧、
  不會回到第 0 層），對應規則書「中途離開再回來、從未踏破樓層繼續」的既有精神。

---

## 6. 特殊點位的差異行為

### 6.1 封牢（evergaol，卡 9）

`handleEnterFieldPointClick()` 對 `type === "evergaol"` 額外檢查
`characterHasConsumable(characters[myTokenId], "item_stonesword_key")`——沒有持有「石劍
鑰匙」消耗品的角色按「進入」會被擋下並跳 toast 提示，不會建立 `fieldTrigger`。其餘樓層流程
（分歧/選項/獎勵）跟一般板塊完全相同。

### 6.2 魔術師塔（sorcerer，卡 10）

**完全不使用**上述樓層 pipeline（`NON_FIELD_POINT_TYPES` 明確排除），是獨立的算術解謎小遊戲：
`handleTowerEnterClick()` → 3 秒邀請 → `startTowerPuzzle()` 隨機出一道「兩個 1~12 的數字
＋加/減/乘」算式，解對即標記 `towerSolved`。這是這次里程碑新增的示範互動，**不是規則書內容**
（規則書魔術師塔實際內容仍在 `fields_data_*.js` 的 `card_10` 裡，但 midnight.js 沒有讀取它）。

### 6.3 王城（castleZone，J＝堡壘）

用面（`isCastleZone`）而非距離判斷靠近，用合成點物件 `{id, card:"J", x, y}`（取遮罩重心座標）
餵給既有的樓層 pipeline，因此王城本身的分歧/選項/獎勵流程跟一般板塊卡完全相同，只有「怎麼
判斷玩家靠近」不同。

### 6.4 教會（K）

只是普通板塊卡，唯一值得一提的是樓層 1 的獎勵含聖杯瓶上限加成（見 §3.1 範例）。

---

## 7. 四種新籌碼事件的規則對應與程式位置

以下對照 `docs/scenario_flow_rules.md` §9 的規則書原文，逐一列出 midnight.js 的實作程度。

### 7.1 商人籌碼（`type: "merchant"`）

規則書內容（自動成功）：PC 個人消費盧恩購買武器／消耗品／鍛冶合。

midnight.js 實作（`handleMerchantEnterClick`／`openMerchantModal`／
`renderMerchantConsumableList`／`renderMerchantForgeList`）：
- 按「進入」→ 0.5 秒讀取條（`FIELD_ENTER_WAIT_MS`，跟板塊卡「進入」讀取節奏統一）→ 開純本地
  modal（不是共享的 fieldTrigger 狀態機，商人是「個人各自決定」的規則書精神，天然適合本地
  modal，不需要跨裝置同步）。
- 「裝備品購入」：消費盧恩：1，用 `CharacterDrawer.merchantDrawWeapon()` 抽武器（沿用既有
  抽武器規則），對應規則書「ルーン消費後、ランダムに任意の消耗品を1個獲得」——**這部分
  midnight.js 只抽武器，沒有連帶再送一個消耗品**，是跟規則書原文有落差的已知簡化。
- 「消耗品購入」：固定清單 `MERCHANT_CONSUMABLE_IDS`（暖石／烏龜脖子醃菜／投擲壺／星光碎片／
  投擲匕首，跟規則書 203~204 頁列舉的 5 項一致），對應 `night.js` 同名常數。
- 「鍛冶合」費用 `MERCHANT_FORGE_COST_RUNES = 1`：**規則書 148 頁實際費用未轉錄進本專案**，
  這個常數是暫時比照唯一有確認數字的「裝備購入：盧恩1」訂的佔位值，**不是規則書確認的
  數字**，之後有正式頁碼資料時應直接取代。
- 第二天夜之強敵擊退後，商人可直接從上方資訊欄開啟（不受地圖位置限制），對應規則書「石劍
  之鑰／同商人效果，可循環使用」的精神。

### 7.2 強敵籌碼（`type: "strong_enemy"`）

規則書內容：協力力 11×PC人數 突破判定；GM 擲骰查「強敵決定表（319頁）」決定敵人；撃破後獲得
撃破ルーン。

midnight.js 實作（`rollAndAssignStrongEnemy`／`maybeGrantStrongEnemyReward`）：
- **跳過突破判定（無「協力力」門檻）**，玩家靠近就直接自動查表決定敵人（`event_rulebook.js`
  的 `strong_enemy` chip `extraTables[0]`，跟 `night_gm_flow.js` 的
  `rollStrongEnemyTable`／`extractLevelAndNameTokens`／`resolveCombatEnemyMatch` 完全同一套
  解析），生成一個 `status:"resolved"` 的 `fieldTrigger`，直接可以「進入戰鬥」。
- 找不到對應敵人資料時整體放棄（不硬湊，`CLAUDE.md §19` 同精神），保留這個點但沒有戰鬥可打。
- 撃破後獎勵：固定 `盧恩8 ＋ 潛在力量★★`（`STRONG_ENEMY_REWARD_RUNES=8`／
  `STRONG_ENEMY_REWARD_POTENTIAL_STARS=2`，取自 `event_rulebook.js` 原文「撃破ルーン：8」
  「潜在する力：★★」的 1 日目/一般值），發給這場戰鬥所有 `participants`。**不區分 2 日目
  「⑧恐るべき強敵」應有的 12 盧恩／★★★ 更高獎勵**——地圖上的 3 個 `strong_enemy`
  籌碼點固定套用一般值，沒有 2 日目升級機制（那是「劃在最終小圓的夜之強敵」才有的機制，
  見 §9，兩者在 midnight.js 是不同的兩套系統）。

### 7.3 隨機事件籌碼（`type: "random_event"`，畫面顯示為「聖甲蟲」）

規則書內容：GM 擲骰查「ランダムイベント決定表」決定要發生哪個事件（該表本身內容因寫真判讀
困難、信賴度中等，見 `docs/scenario_flow_rules.md` §9 附註）。

midnight.js 實作（`findScarabBranch`／`handleScarabCheckClick`）：
- **只自動化了規則書隨機事件表其中一個分支——「聖甲蟲」**，其餘分支未接入（規則書原始隨機
  事件表內容本身在這個 repo 也還沒有完整轉錄）。
- 玩家可選一項能力值（`checkValues`）進行檢定：擲對應顆數 1D6，總和 ≥
  `SCARAB_CHECK_TARGET(13)` 即成功。
- 成功獎勵：`pushPendingReward(myTokenId, { kind: "talisman" })`（進入獎勵清單彈窗，玩家可
  抽一個裝飾品，見 §7.5）。
- 每個玩家對同一個聖甲蟲點只能嘗試一次（`fieldTrigger/{id}/attempted/{slot}`）。

### 7.4 祝福籌碼（`type: "blessing"`）

規則書內容：PC 全員可執行「祝福での休息」——全員可升級，且不論是否升級都回滿 HP／FP／加護／
聖杯瓶使用次數／夜渡りスキル使用次數，結束後發生時間損耗。

midnight.js 實作（`handleBlessingEnterClick`／`applyBlessingRestore`／`handleBlessingUseClick`）：
- **這是唯一一個完全不讀取 `event_rulebook.js`（該檔案裡沒有 `blessing` id）的籌碼**，
  行為是直接硬編碼實作（跟 `night.js` 的 `renderEventChipBlessing` 一樣，因為規則書內容本身
  就是通用文字、不需要查表）。
- 套用範圍**只有玩家自己**，不是全隊：因為 `stamina`／`fp` 是本地端不同步資源，這個 client
  沒辦法改到其他玩家畫面上的本地變數（見 `docs/midnight_realtime_combat_numbers.md` §2 資源
  設計說明）。HP（`demoStat`）／聖杯瓶充能是共享同步值，可以正常回滿。
- 「時間損耗」部分同樣不套用（同 §5 的縮圈取代機制說明）。
- 可重複使用、無次數限制（使用者明確規格「循環使用，沒有設時間限制」），每次視窗關閉後
  升級額度作廢，下次要重新按「使用祝福」。

### 7.5 獎勵清單彈窗（撃殺敵人／聖甲蟲成功共用）

跟樓層戰利品（§4，敘述完直接發放）不同，「殺敵/聖甲蟲成功」的獎勵走的是需要玩家主動「抽選」
確認的彈窗流程（`pushPendingReward` → `pendingRewards/{tokenId}/{rewardId}` →
`renderRewardModal`）：
- `computeRewardDraw(entry)` 支援 `rune`／`talisman`／`weapon`／`consumable` 四種抽選結果
  （`potentialPower` 另有專屬的 `renderPotentialPowerRewardDetail`，兩顆按鈕、抽完各自鎖住
  不能重抽）。
- 玩家可選擇「確認收下」（`confirmRewardEntry`，真正把抽到的東西寫進角色物件）或「丟棄」
  （`discardRewardEntry`，只標記已處理、不套用效果）。

### 7.6 霊脈籌碼：未實作

`event_rulebook.js` 有 `spirit_vein` 資料（自動成功、可任意傳送到已知的其他板塊、傳送後開圖
鄰接格），但 `midnight_map.js` 的 `buildPointRequests()` 完全沒有生成這個類型的點，`midnight.js`
也搜尋不到任何 `霊脈`／`靈脈`／`spiritVein` 相關程式碼。**這是規則書五種籌碼裡唯一完全缺席
的一種**，不是隱藏在其他機制底下，是真的沒有實作。

---

## 8. Day1／Day2「夜之強敵」（最終小圓）與 Day3「夜之王」

這兩個是跟一般板塊/籌碼完全不同的獨立系統（沒有地圖上的固定點，靠縮圈階段/準備流程觸發），
但同樣走「跟一般強敵籌碼相同的 `fieldTrigger` shape」以重用既有戰鬥 pipeline：

### 8.1 Day1／Day2 最終小圓夜之強敵

- 觸發條件：該天縮圈完全結束（`waitingForDay2`／`waitingForDay3` stage）後，任一玩家進入
  最終小圓，系統倒數 10 秒（`FINAL_CIRCLE_BOSS_COUNTDOWN_MS`）後自動查表指派。
- 查表依據：`a_golden` 卡的 `extraTables`「夜の強敵決定表：1日目／2日目」——**這張表以
  「劇本編號」為列、「1日目/2日目」為欄**，`resolveNightBossTableRow(card, scenarioNumber)`
  先用劇本編號選列，再用 1D6（`rollNightBossEntry`）在該列的骰值區間裡選最終敵人（見 §10）。
- 等級固定讀該分支敘述行本身標注的數字（Day1 固定 Lv.10、Day2 固定 Lv.15，`nightBossFixedLevel()`
  從資料裡動態解析，不是寫死常數）。
- `participants` 只納入「當下實際在最終小圓內」的席位（`slotsInsideFinalCircle`），仍在其他
  板塊探索的玩家不受影響。
- 已知簡化：規則書劇本 8、9 的「2 日目夜之強敵由 1 日目擲骰值連動決定」規則
  （`NIGHT_BOSS_LINKED_SCENARIOS`）**未套用**，這兩個劇本的 2 日目會獨立重新擲骰。

### 8.2 Day3 夜之王

- 觸發條件：`meta.day3StartAt` 設定後（全員按準備），對全體在場玩家開啟。
- 敵人直接就是房間設定選定/決定性挑選出的 `meta.resolvedNightBossId`（見 §10.1），**不經過
  任何決定表**——夜王本身是唯一的，不像強敵需要查表決定「是哪一隻」。
- 等級固定 16；查不到規則書資料（例如自訂劇本沒有對應夜王資料）就整體放棄，不硬湊假夜王。
- 戰鬥數值（Guard／HP／招式）讀 `night_boss_rulebook.js` 已結構化資料，招式判定重用
  `night.js` 既有的自動化 GM 模組 `window.PriTestAutoGm`。

---

## 9. 夜王劇本選擇是否影響樓層的選擇項與獎勵？（結論）

### 結論

**不影響。** 一般板塊卡牌（2~10、K、J、A、Z 出發地點/黃金樹之帳本身的「哪一天在哪」除外）的
樓層分歧變體挑選、樓層內「(→XXX)」選項投票、樓層戰利品獎勵、全踏破獎勵，全部只依賴
`meta.mapSeed` 做決定性亂數挑選，**程式碼裡完全沒有讀取 `meta.nightBossId`／
`meta.resolvedNightBossId` 來決定分歧、選項或獎勵**（見 §2.1 已說明：`pickFieldBranchIndex()`
只用 `fieldSeededIndex(pt.id + ":branch", ...)`，不查 `varianceTable`，也不比對劇本編號）。

即使 `fields_data_*.js` 裡某些卡（例如出發地點 `a_start`）本身在規則書原文中**確實**帶有
「依劇本／花色決定內容」的 `varianceTable`（規則書規格如此），`midnight.js` 的
`fieldCardBranches()`／`pickFieldBranchIndex()` 也完全不讀取這個欄位，一律當成「這張卡有
N 個分歧變體，隨機挑一個」處理——這是即時制版本刻意的簡化（見 `midnight.js:3920` 附近程式
註解「規則書原本是依劇本/花色查varianceTable決定，這裡沒有『劇本』『花色』這些概念」）。

### 唯一受劇本影響的兩處（都跟一般板塊樓層無關）

1. **Day1／Day2「最終小圓夜之強敵」是誰**（§8.1）：`rollAndAssignFinalCircleBoss()` 呼叫
   `resolveNightBossTableRow(card, scenarioNumber)`，用選定劇本的編號去查 `a_golden` 卡的
   「夜の強敵決定表」對應列，因此不同劇本會遇到不同的夜之強敵候選（表格內容依劇本而不同）。
2. **Day3「夜之王」本體是哪一隻**（§8.2）：`meta.resolvedNightBossId` 直接對應房間設定選的
   劇本固定的 `bossId`（`scenarios.js` 既有「每個劇本固定對應一個 bossId」的資料），選不同
   劇本＝挑戰不同的夜之王。

換句話說：**劇本／夜王選擇只決定「你最終會打誰」（Day1/2 強敵種類、Day3 王本體），不會改變
沿途探索板塊卡牌時看到的樓層敘述、分歧選項或獎勵配置**——這些完全是同一份、跟劇本無關的
共用地圖內容。

### 程式證據索引

| 主張 | 程式位置 |
|---|---|
| 一般板塊分歧挑選只用 mapSeed，不查 varianceTable/劇本 | `midnight.js` `pickFieldBranchIndex()`（約行 3923）、`fieldCardBranches()`（約行 3896） |
| 樓層選項投票只跟「這個事件的參與者」有關，跟劇本無關 | `midnight.js` `maybeResolveFieldVote()`（約行 4277） |
| 樓層獎勵只讀 `floor.reward`，不查劇本 | `midnight.js` `maybeGrantFieldTileReward()`（約行 5583） |
| Day1/2 最終小圓強敵依劇本編號查表 | `midnight.js` `rollAndAssignFinalCircleBoss()`（約行 4641），呼叫 `night_gm_flow.js` `resolveNightBossTableRow()`（約行 3179） |
| Day3 夜王直接對應劇本固定 bossId | `midnight.js` `resolveNightBossScenarioId()`（約行 455）、`rollAndAssignDay3Boss()`（約行 4742） |
| 全域搜尋確認 `midnight.js` 中 `scenarioId`/`nightBossId` 的所有引用點 | 僅出現在房間設定（§1.2/§10.1）與上述兩處查表邏輯，共 7 處引用、無其他用途 |

---

## 10. 已知簡化／未實作事項總表（彙整自本文件各節）

| 項目 | 狀態 | 影響範圍 |
|---|---|---|
| 霊脈籌碼 | ❌ 完全未實作 | 地圖上不會生成霊脈點 |
| 樓層 `freeFloorOrder`（任意順序踏破部分樓層即算全踏破） | ❌ 未支援 | 少數卡（如水辺の大教会）一律照固定順序走到 `floorCount`，不支援任意順序 |
| 樓層獎勵：`potentialPower`／`stoneswordKey`／`smithingStone`／`weaponSkillReroll` | ❌ 靜默略過 | 這 4 種戰利品類型的樓層獎勵不會實際發放 |
| 樓層獎勵：GM 判斷類（`hpDamage`／`tieredChoice`／`diceHandChoice`／`bargainReveal`／`note`） | ❌ 完全未處理、無提示 | 這些獎勵配置會被無聲濾掉 |
| 全踏破效果的「時間損耗」部分 | ❌ 不套用 | 只發放盧恩，縮圈計時取代時間損耗機制 |
| 商人「裝備品購入」連帶消耗品 | ❌ 未實作 | 只抽武器，沒有規則書原文「消費後再隨機獲得消耗品」 |
| 商人「鍛冶合」費用 | ⚠️ 佔位值 | `MERCHANT_FORGE_COST_RUNES=1` 非規則書確認數字 |
| 強敵籌碼撃破獎勵不分 1/2 日目高低 | ⚠️ 簡化 | 固定用 1 日目值，沒有 2 日目「恐るべき強敵」的高倍獎勵 |
| 隨機事件（ランダムイベント）籌碼 | ⚠️ 只做了聖甲蟲分支 | 規則書其餘分支未接入，該表本身內容信賴度也中等 |
| 劇本 8／9 的「2日目夜之強敵連動 1日目擲骰」規則 | ❌ 未套用 | 這兩個劇本的 2 日目會獨立重擲，其餘 8 個劇本不受影響 |
| 祝福籌碼的回復範圍 | ⚠️ 只回復自己 | stamina/FP 是本地端資源，無法從單一 client 改到其他玩家畫面 |
| 祝福籌碼的時間損耗 | ❌ 不套用 | 同全踏破效果的簡化原因 |

---

## 11. 2026-09-10 新增：「完整版」4張新地圖（cassel／ice／kasan／red）與地變特殊規則

使用者提供4張新地圖原畫＋標註版（`photo/midnight/map_{cassel,ice,kasan,red}_annotated.png`），
資料與生成邏輯獨立在新檔案 `static_src/midnight_map_variants.js`，`midnight_map.js` 的
`generateMap(seed, mapVariantSetting)` 依 `meta.mapVariant`（房間設定「地圖」選單，"basic"|"full"）
決定要不要套用。

- **地圖選擇**：`mapVariantSetting==="full"` 時，用跟其餘地圖生成同一個 `mulberry32(mapSeed)`
  序列的第一次 `rand()` 呼叫決定（`pickVariantId()`）：80% 機率均分抽出這4張新地圖其中一張
  （各20%），其餘20%退回原版基礎地圖——使用者明確規格「選擇完整版則會有80%從中抽出一張」。
- **地形資料來源**：紅線（可走邊界）／橘線（特殊事件範圍，見下）用跟原版
  `FIXED_GRID_ROWS`/`CASTLE_ZONE_ROWS` 同一套 Python 影像處理方法論（顏色比對＋
  binary_dilation／binary_fill_holes／binary_erosion＋取最大連通元件＋downsample成48格），
  不是肉眼描格子。A／Z／F／Q座標則是肉眼讀取標註圖文字標籤位置換算，跟原版
  `SPIRIT_BIRD_LINKS` 一樣屬於「第一輪肉眼描、日後可能需要修正」等級的精確度，尤其F的
  來源/目的地配對是依曲線方向人工判斷。
- **Day2終點強制指定**（使用者規格「第二天的終點以下有所不同」）：`assignDayPlan()` 新增
  `forcedDay2EndId` 參數，4張新地圖各自指定一個必須當Day2終點的Z候選（cassel：中心靠左下；
  ice／red：各自橘線範圍內那個Z；kasan：上方橘線範圍內那個Z）。
- **橘線特殊事件範圍（hazardZone）**（2026-09-10使用者更新規格：「生成板塊更改為額外生成
  4,可怖強敵，兩者只要其一通過即可開始Q，另外還有祝福x2」）：`placeHazardZonePoints()`
  在這個範圍內額外放置卡4／強敵（兩者標記 `hazardMember:true`）／Q（`type:"hazard_q"`，
  共3個）／祝福×2，是疊加在一般2~7地點需求之上（不是取代），因此這4張地圖的4卡牌會有3個。
  舊規格的「5」已依使用者指示移除，不再額外生成。cassel／ice的標註圖上有明確畫Q文字座標
  （對應各自 `qNames[0]`，即下面Q板塊內容一節的★分歧），直接採用；其餘Q（含kasan／red
  全部3個，因為這兩張沒有任何標註）由程式在範圍內自由決定位置。一般點位（`pointEligible`）
  已經扣掉這個範圍，不會跟一般籌碼重疊生成。
- **Q板塊開放判定**（2026-09-10使用者更新規格，從「三選二」放寬成「二選一」）：
  `hazardQUnlocked()` 檢查地圖上2個 `hazardMember` 點（4／強敵）裡有幾個 `isPointCleared()`，
  未滿1個時 `updateNearbyFieldPoint()` 直接不把該點納入 `nearbyFieldPoint`（沒有「進入」
  按鍵），顯示一次toast。「進入時間5s」由既有通用的5秒遭遇準備流程（`updateBattlePrep()`）
  自然滿足，沒有另外做一套。
- **Q板塊內容**（2026-09-10使用者明確規格「Q的板塊資訊參照night的Q來執行」＋「完整重現，
  並且生成地變是有三張Q的板塊」）：`fields_data_4.js` 本來就有 `card_q`（「地變」，
  `cardLabel:"Q"`）的完整規則資料，含cassel/ice/kasan/red四個地區各3個分歧（intro敘述／
  `specialRule`／樓層／王戰），只是先前一直沒有被引用。這次把Q從「強敵籌碼」特例
  （`NON_FIELD_POINT_TYPES` 排除項）改成跟一般2~10/K地點完全同一套
  `fieldCardData()`/`updateNearbyFieldPoint()` pipeline，不再是套用 `event_rulebook.js`
  強敵決定表隨機roll一隻敵人：
  - `midnight_map_variants.js` 每個地圖META新增 `qNames`（3個zh分歧名稱，對應
    `card_q.branches[*].name.zh`）；cassel/ice的 `qNames[0]`（★）固定在標註圖上的
    `qPoint`，其餘由 `placeHazardZonePoints()` 自由放置，各自附上 `hazardQName`。
  - `pickFieldBranchIndex()` 新增：若 `pt.hazardQName` 存在，直接用
    `matchBranchIndexByName()` 比對出對應分歧，不落入一般卡牌的劇本比對/亂數退回邏輯。
  - `fieldFloorCountForCard()` 改吃 `pt`（原本只吃 `card`）：`card_q` 卡面雖有
    `floorCount:4` 欄位，但那只是「山嶺(山頂)」分歧的樓層數，其餘11個分歧樓層陣列長度
    實際是3——Q改用「已指定分歧」的實際 `floors.length`，避免3層的分歧被誤判成有第4層
    可踏破，一般卡牌不受影響（仍優先讀card.floorCount）。
  - 樓層敘述、「(→XXX)」分歧選擇、敵人名稱解析（含指定王戰，如ice山頂的「山嶺の氷竜
    ／Lv.15」）、獎勵發放，全部沿用一般地點既有pipeline，不是另外寫一套。
- **王城（J）**：cassel這張地圖的標註圖上沒有畫王城橘線範圍（`CASTLE_ROWS`全0），
  `mapHasCastle()` 判斷為空時整個不畫J堡壘圖示，避免在地圖正中央（`computeMaskCentroid()`
  對全0遮罩的退回值）出現一個看起來能用、實際上點了沒反應的假圖示。
- **地圖背景圖片**：`static_src/images/maps/map_{cassel,ice,kasan,red}.jpg`（複製自
  `photo/midnight/` 同名非標註版），`MAP_BACKGROUND_IMAGES`／`currentMapImage()`依
  `map.variantId` 切換要畫哪一張，不是套用濾鏡模擬。

### 11.1 地變特殊規則（4種，各對應一張新地圖）

實際效果邏輯集中在 `midnight.js` 的 `applyMapSpecialRuleTick()`（週期性效果）與個別掛勾點：

| 地圖 | `specialRule` id | 規則 | 實作狀態 |
|---|---|---|---|
| cassel | `cassel_hidden_city` | 「迷惘的隱藏都市」：每隨機30~60秒縮圈時間-5秒 | 完整實作（`maybeApplyCasselTimeLoss()`，直接把當天StartAt往前撥5秒，跟測試主控台既有的「立即縮圈」同一種手法） |
| red | `red_miasma` | 「朱紅腐敗的瘴氣」：每30秒PC全員累積「腐敗：1D」，且不會像一般異常那樣達閾值後歸零 | 完整實作（`maybeApplyRedMiasmaTick()`，本地only直接疊加`receivedAttributeAccum`，刻意不透過會在閾值觸發後歸零的`recordReceivedAttributeAccum()`共用函式，因為規格明確要求「不會解除」） |
| ice | `ice_blizzard` | 「暴風雪的視野」：戰鬥中每隨機30~45秒5秒內無法攻擊/使用技能；「凍寒的暴風雪」：凍傷非戰鬥時也累積且戰鬥結束不重置 | 兩段都已實作。前半段`isIceBlizzardBlinded()`，已掛在攻擊/戰技/技藝/技能/特殊攻擊等所有輸出手段上。後半段2026-09-10新增`maybeApplyIceFrostbiteTick()`：規則書沒有標示蓄積速率數字，依使用者指示「以及red的腐敗」比照`maybeApplyRedMiasmaTick()`同一套機制（每30秒PC全員累積「凍傷：1D」，本地only疊加`receivedAttributeAccum`不歸零），跟只在戰鬥中(activeEncounter)才計時的前半段不同，這是地圖全域效果 |
| kasan | `kasan_lava` | 「熔岩」：每次樓層踏破，PC全員無條件承受「HP損害：■」 | 只顯示提醒toast（`midnight_kasan_lava_floor_note`），不自動扣血——■是規則書未標示數值的占位符，依CLAUDE.md §19交由GM/玩家自行判斷，不自行發明數字 |

---

*本文件依 2026-09-10 當下的 `static_src/midnight.js`／`midnight_map.js`／
`midnight_map_variants.js`／`fields_data_1~4.js`／`event_rulebook.js`／`night_gm_flow.js`
程式內容整理，若之後相關程式有修改，應同步檢查本文件是否仍準確。§11 為 2026-09-10 新增
章節，同日內另有一次更新：Q板塊內容改走一般地點pipeline（含3張Q／card_q完整重現）、
hazard開放判定放寬為「4/強敵二選一」（移除5）、ice凍傷非戰鬥累積補上實作。*
