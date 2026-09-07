# Midnight 板塊樓層／獎勵清單／籌碼事件 大改版 設計文件

日期：2026-09-07
範圍：`static_src/midnight.js`／`midnight_map.js`（即時制擴張版），不影響 `night.js`（回合制）。

> **修訂記錄**：本文件第一版由背景研究 agent 起草，經使用者與主對話逐項確認、並由本對話重新
> 驗證所有引用的既有函式/資料結構後修正定稿。與研究草稿的主要差異：§2 改用卡牌名稱比對
> （非花色點數比對，理由見 §2.1）、§3 獎勵分類改讀 `perPerson` 旗標本體（非依 kind 寫死）、
> §4 六種謜題全部改為參數化模板即時生成、§8.2 补齊虫の大量発生／発狂地帯完整設計、§1.5
> 後補領獎機制擴大並排除可重複使用籌碼。

## 0. 背景與既有機制盤點

現況整理見 `docs/midnight_field_chip_rules.md`。以下是本次設計會重用的既有函式／資料
（已逐一在程式中核對存在，位置與簽名均為實際確認過的內容）：

| 用途 | 既有函式／資料 | 位置（已核對） |
|---|---|---|
| 打字機敘述（可調速度） | `typewriteInto(el, text, opts)` | `night_gm_flow.js:51` |
| 突破/協力判定文字解析（`〈協力N×PC人數｜屬性〉`） | `parseBreakthroughCheckText(text)` | `night_floor_breakthrough.js:25`（純函式，需複製一份到 midnight.js，同既有 `MERCHANT_CONSUMABLE_IDS` 慣例） |
| GM 判斷類獎勵處理參考實作 | `judgeDiceHand(entry, values)` / `autoResolveJudgmentEntry(entry, entered, floorKey, entryIndex)` | `night_floor_breakthrough.js:250` / `:469`（邏輯需移植，不能直接呼叫——依賴 `night.js` 專屬的 `state.gmFlow`） |
| 潛在力量★ 抽選（武器／附帶效果） | `potentialPowerDrawWeapon(c, starCount)` / `commitPotentialPowerWeapon(c, result, attributeTag)` / `rollPotentialPowerAttachedEffect(c)` / `previewAttachedEffectSlot(c)` / `commitAttachedEffectChoice(c, effect, preview)` | `character_drawer.js:2857/3015/3049/3073/3084` |
| 戰技重抽 | `listRerollableWeaponSkillSlots(c)` / `rerollWeaponSkill(c, weaponId, slot)` / `commitWeaponSkillReroll(c, weaponId, slot, skillId)` | `character_drawer.js:2817/2835/2845`（既有函式，目前沒有任何 UI 呼叫過） |
| 強敵決定表／恐るべき強敵決定表（2 顆骰×12列） | `event_rulebook.js` `strong_enemy` chip `extraTables[0]`（一般）／`extraTables[1]`（恐るべき） | `event_rulebook.js:271` |
| 隨機事件決定表（含劇本篩選重擲，上限 30 次） | `rollRandomEventTable(table, scenarioNumber)` | `night_gm_flow.js:1667` |
| 隨機事件的完整 10 個分支原文 | `event_rulebook.js` `random_event` chip `branches[]` | `event_rulebook.js:317~923` |
| 夜の強敵決定表（劇本×日別查表） | `resolveNightBossTableRow(card, scenarioNumber)` / `rollNightBossEntry(row, colIndex)` | `night_gm_flow.js:3179/3216` |
| **各劇本、各天、各位置實際板塊變體名稱**（含花色/點數） | `SCENARIOS[i].day1[]` / `day2[]`，每筆 `{pos, suit, rank, name:{ja,zh,en}}` | `scenarios.js:14~`（已核對：`name` 欄位就是 `fields_data_*.js` 對應卡牌 `branches[].name` 的同款字串，例如 `card_2` 分支有 `"大教會（聖）"`/`"大教會（1）"`/`"大教會（2）"`等，`scenarios.js` 劇本1 day1 pos1 正好是 `"大教會（聖）"`） |
| 消耗品資料（石劍鑰匙/鍛造石） | `item_stonesword_key` / `item_smithing_stone`（`noStackLimit:true`） | `consumables.js:172/182` |
| 武器稀有度強化（C→U→R） | `getEffectiveWeaponRarity(c, weaponId)` / `upgradeWeaponRarity(c, weaponId)` / `canUpgradeWeaponRarity(c, weaponId)` | `character_drawer.js:4129/4135/4146` |
| 屬性/異常蓄積（含「発狂」） | `ATTRIBUTE_STATUS_AILMENT_NAMES_JA`（已含 `"発狂"`）＋既有蓄積 helper | `midnight.js`（既有，§8.2 発狂地帯直接沿用） |

---

## 1. 板塊樓層 pipeline 改版

### 1.1 時間常數調整

```js
FIELD_INVITE_TIME_LIMIT_MS = 10000;      // 3s → 10s
FIELD_ENTER_WAIT_MS = 1000;              // 0.5s → 1s（A／2~10／K／籌碼點適用）
FIELD_ENTER_WAIT_MS_CASTLE = 5000;       // 新增：僅 J（堡壘）適用
```

> **「Q」澄清**：使用者原文「A,2~10,K,籌碼 以外的板塊＝J,Q」，經核對 `fields_data_1~4.js`／
> `midnight_map.js` 現有卡牌清單，`Q`（地變，`floorCount:4`）雖然規則書資料裡確實存在
> （`fields_data_4.js` 有 `card_q`），但這次**確認不加入地圖**（使用者決定：基礎版地圖暫不
> 涵蓋 Q，之後如果要加入需另外設計「怎麼安排 Q 卡出現時機」，本次範圍只把 5 秒等待套用在
> J 一種）。

`maybeStartFieldTypewriter()` 依 `pt.card === "J"` 判斷用哪個等待常數。

**打字機速度**：`typewriteInto()` 呼叫時傳入比預設慢一倍的 `intervalMs`（沿用該函式既有的
`opts.intervalMs` 參數，不需要新增函式簽名）。

### 1.2 邀請階段：顯示已加入名單＋「立即進入」

`renderFieldVoteOrResult()` 新增邀請中的渲染分支：
- 列出 `trig.participants` 目前已加入的玩家名字。
- 已加入者可按「立即進入」，直接把 `inviteDeadline` 改成 `Date.now()`：

```js
function handleForceEnterFieldClick(pt) {
  var trig = fieldTriggers[pt.id];
  if (!trig || trig.status !== "inviting" || !trig.participants[mySlot]) return;
  GameStorage.rtSet(gameId, "cloud", "fieldTrigger/" + pt.id + "/inviteDeadline", Date.now());
}
```

不新增狀態機分支：`maybeAdvanceFieldInvite()` 既有的 `Date.now() >= trig.inviteDeadline`
判斷會在下一輪 `updateNearbyFieldPoint()` 自然觸發。

### 1.3 投票階段：即時票型分布＋全員投完立即判定

- 新增即時票數分布渲染（依 `trig.votes` 統計各選項目前票數）。
- `maybeResolveFieldVote()`：拿掉「全員都投但沒共識時等到 `timedOut` 才多數決」的
  `else return;` 分支，改成只要 `allVoted` 就立即判定（一致採該項，不一致立即
  `pickFallbackChoice()` 多數決），不再等待 `voteDeadline`。

### 1.4 中途加入（「參加探索」）

新增第二套加入流程，只在 `fieldTrigger` 已存在（`inviting`/`active`/`resolved` 皆可）且
`mySlot` 不在 `participants` 中時觸發：

- 顯示 `[參加探索]` 按鈕（跟原本的 `[加入]` UI 分開渲染，因為原 10 秒邀請視窗可能早已結束）。
- 按下後本地等待 `FIELD_LATE_JOIN_WAIT_MS = 2000`，逾時後才 `rtSet` 把自己加進
  `fieldTrigger/{id}/participants/{mySlot}`。
- **仍在投票階段（`active` 且未 `resolved`）**：加入後跟現有玩家一起投票——
  `participantSlots(trig)` 本來就即時讀 `trig.participants`，不需要額外處理。
- **已經 `resolved`（含戰鬥中/已和平通過）**：加入後只是併入 `participants`，直接看到目前畫面
  （敘述/戰鬥），不會回頭觸發打字機或投票。

### 1.5 落後獎勵追蹤與後補領獎（perPlayerRewards ledger）

**範圍**：只適用於「一次性完成、之後維持已清除狀態」的內容——一般板塊樓層／強敵籌碼／
隨機事件（各分支的戰鬥或判定結果）／Day1/2 最終小圓夜之強敵／Day3 夜之王。
**明確排除祝福、商人這類「可重複使用、沒有清除狀態」的籌碼**——這兩者本來就是任何人
隨時可用，不存在「已被別人領走」的概念，不需要後補領獎機制。

**perPerson 判斷（依你的規格，直接讀資料本體的旗標，不依 kind 寫死）**：
```js
function isPerPersonRewardEntry(entry) {
  return entry.perPerson !== false; // 未標記或明確 true 都視為每人各自一份；只有明確 false 才是固定共享
}
```
`fields_data_*.js`／`event_rulebook.js` 的 reward entry 若標記 `perPerson: false`，代表這是
「固定數量、全隊共用一份、先搶先贏」（例如教會商人的鍛石兌換、某些 `stoneswordKey`/
`smithingStone` 條目）；沒有標記或標記 `true` 的都視為「每個參與者各自獨立獲得一份」。

**RTDB 結構**：`fieldProgress/{pointId}/perPlayerRewards/{seq}` 記錄每次發放的
`{ entries: [...perPerson的entries], grantedAt }`（累加、不覆蓋）；`固定共享`（`perPerson:false`）
的獎勵改走 §3.2 的共享池機制，不進這個 ledger（因為規則本來就是「搶完就沒有」，後補玩家
不該追討）。

強敵籌碼／隨機事件／Day1-2 夜之強敵／Day3 夜之王 撃破時發放的固定值獎勵（`STRONG_ENEMY_
REWARD_RUNES` 等）視為 `perPerson:true`（規則書原文本來就是「PC 各自獲得」），同樣寫入
對應點位的 `perPlayerRewards` ledger。

**領取機制**：
- 玩家靠近「自己從未加入過、但這個點已有 `fieldTrigger`/`fieldProgress` 記錄」的一次性內容時
  （不論目前是否已全清），顯示 `[領取獎勵]` 按鈕。
- 按下後等待 2 秒（`FIELD_LATE_JOIN_WAIT_MS`），把該點 `perPlayerRewards` 中「自己
  （`myTokenId`）尚未領過」的全部 entries 一次授予，並寫入
  `fieldProgress/{pointId}/claimedBy/{myTokenId} = true` 標記已處理（同一 tokenId 之後不會
  再顯示這個按鈕、也不會重複授予）。
- HP/FP 消耗、戰鬥過程本身不追溯（沿用現狀）。

---

## 2. 分歧「變體」挑選：劇本連動

### 2.1 比對依據：卡牌名稱而非花色/點數

`scenarios.js` 的 `SCENARIOS[i].day1[]`／`day2[]` 每筆是「這個劇本在這一天、這個位置放的是
哪張牌」，含 `{pos, suit, rank, name}`。**原始構想是用 `rank` 對應 `pt.card`**，但實際核對後
發現同一個 `rank` 在不同劇本可能對應完全不同的板塊類型——例如劇本 1 day2 pos5 是
`{rank:"J", name:"砦（隨機）"}`，但 `rank:"J"` 在 midnight 的基礎地圖規則裡固定代表「堡壘」
（`FIELD_CARD_NAMES.J = 堡壘`），"砦"（小砦）實際對應的是 `rank:"3"`。這代表 `scenarios.js`
的 `rank` 欄位反映的是「該劇本這一局實際抽到的花色牌面」，不是「板塊類型」——兩者在
不同劇本可能不一致，用 `rank` 比對會選錯完全不同種類的板塊。

**改用卡牌名稱字串比對**：`fields_data_*.js` 每張卡的 `branches[].name` 都是「卡牌本名＋
變體後綴」格式（例如 `card_2` 大教會的分支名稱是 `"大教會（1）"`／`"大教會（聖）"`／
`"丘上的大教會"`等），跟 `scenarios.js` 的 `name` 欄位用的是同一種字串慣例。因此比對依據
改成：從 `scenarios.js` 該劇本 `day1`+`day2` 全部項目中，篩出 `name.zh` 以
`fieldLocationName(pt)`（該卡牌本名，如「大教會」）開頭的項目，收集成候選池。

### 2.2 建立候選池與挑選

```js
// 注意：比對邏輯全程只用 .zh 欄位（不透過 localizedText()），因為這是後端資料比對，
// 不是 UI 顯示——localizedText() 會依目前介面語言回傳 ja/zh/en，若混用會導致日文/英文
// UI 的玩家配對到錯誤結果（fields_data與scenarios.js的.zh字串保證一致，用它當比對key
// 最穩定，不受玩家個人語言設定影響，遊戲邏輯本應與顯示語言脫鉤）。
function scenarioVariantCandidatesForCard(scenarioId, card) {
  var Scenarios = window.PriTestScenarios;
  var scenario = Scenarios.get ? Scenarios.get(scenarioId) : Scenarios.list().filter(function (s) { return s.id === scenarioId; })[0];
  if (!scenario) return [];
  var data = fieldCardData(card);
  var baseName = data ? data.name.zh : ""; // 卡牌本名（.zh固定），如"大教會"
  if (!baseName) return [];
  var out = [];
  ["day1", "day2"].forEach(function (dayKey) {
    (scenario[dayKey] || []).forEach(function (slot) {
      if (slot.name && slot.name.zh && slot.name.zh.indexOf(baseName) === 0) out.push(slot);
    });
  });
  return out;
}
```

不分天：day1／day2 兩邊符合這個卡牌本名的項目都收進同一個候選池（依你的確認：「若區分一日
二日有不同的花色，則兩者都能套用抽選查看」）。

```js
function pickFieldBranchIndex(pt) {
  var branches = fieldCardBranches(pt.card);
  if (!branches.length) return 0;
  var scenarioId = resolveNightBossScenarioId();
  var candidates = scenarioId ? scenarioVariantCandidatesForCard(scenarioId, pt.card) : [];
  if (candidates.length) {
    // 依你的規格：同一張卡不同地點的板塊都需要重抽——用pt.id（而非card本身）當seed key，
    // 確保地圖上兩個「大教會」實體各自獨立抽選，不共用同一個結果。
    var picked = candidates[fieldSeededIndex(pt.id + ":scenario_variant", candidates.length)];
    var resolvedIndex = matchBranchIndexByName(branches, picked.name.zh);
    if (resolvedIndex !== null) return resolvedIndex;
  }
  return fieldSeededIndex(pt.id + ":branch", branches.length); // 找不到劇本資料或比對失敗：退回現行純隨機
}

function matchBranchIndexByName(branches, nameHintZh) {
  for (var i = 0; i < branches.length; i++) {
    if (branches[i].name && branches[i].name.zh === nameHintZh) return i; // 同樣固定比對.zh，不經localizedText
  }
  return null; // 找不到完全相同名稱就不勉強比對，交由呼叫端退回純隨機
}
```

用**完全相同字串**比對（不是子字串），避免「大教會（1）」誤配到「大教會（12）」這類前綴重疊
問題（目前資料沒有這種情況，但用完全比對更安全）。找不到就整體退回現行的
`fieldSeededIndex(pt.id + ":branch", ...)` 純隨機（不阻塞流程、不猜規則）。

### 2.3 J（堡壘）與 A（出發地點）

- J：套用同一套機制（`fieldLocationName` 對 J 卡回傳「堡壘」，候選池篩選邏輯不變）。
- A（出發地點）：`a_start` 卡本身也有 `branches`，套用同一套機制（`fieldLocationName` 對
  A 卡回傳「出發地點」）。

### 2.4 Z（黃金樹之帳）與夜之強敵/夜之王

Z 不透過這套「分歧變體」機制（它本來就沒有 `branches` 多選，是走 §8 已有的
「夜の強敵決定表」查表邏輯，不受本節影響）。

---

## 3. 獎勵清單優化

### 3.1 背包已滿：黃字提示取代靜默略過

`grantLootRewardEntryToCharacter()`／獎勵清單彈窗的「領取」handler，背包已滿時不再直接
`return null` 略過，改為：
- 樓層戰利品自動授予流程（`grantTileLootToParticipants`）：該筆略過，但額外把
  `midnight_inventory_full_note`（黃字）加進通知文字，讓玩家知道有東西沒拿到。
- 獎勵清單彈窗（`confirmRewardEntry`）：按下「領取」時背包已滿，直接在彈窗內顯示黃字
  `midnight_inventory_full_note`，不關閉彈窗（讓玩家可以先去角色面板丟棄再回來按）。

### 3.2 固定數量獎勵（`perPerson:false`）：共享池、先搶先贏

新增 RTDB 節點 `fieldTrigger/{pointId}/sharedRewards/{rewardId}`：

```js
function pushSharedReward(pointId, entry) {
  var rewardId = "srw" + Date.now() + Math.floor(Math.random() * 100000);
  entry.resolved = false;
  GameStorage.rtSet(gameId, "cloud", "fieldTrigger/" + pointId + "/sharedRewards/" + rewardId, entry);
}
```

所有 `participants`（含後補加入者）都看得到同一份 `sharedRewards` 清單；任一人按「領取」時
用 `rtTransaction` 鎖定 `.../sharedRewards/{rewardId}/resolvedBy`（first-writer-wins，跟既有
`tileRewardGrantedBy` 同款手法）——成功者才真正把物品寫進自己角色，其餘人畫面上該項目立即
變成「已被 OO 領取」（唯讀，不能再按）。

**UI 必須明確標註**：共享池的每一筆獎勵項目旁都要顯示黃字
`midnight_reward_shared_note`＝「共有獎勵，非全員獲得」，避免玩家誤以為跟其他 per-player
獎勵一樣人人都能拿一份。

`stoneswordKey`／`smithingStone`／其餘任何品項，**一律依該筆 reward entry 實際的
`perPerson` 旗標決定路徑**（不依 kind 寫死）：`perPerson:false` 才走這條共享池路徑；
`perPerson:true`（或未標記）走 §1.5 的 ledger（每人各自一份＋可後補領取）。依你的說明，
同樣是鍛造石，不同板塊的資料可能標記不同（例如坑道類板塊多為 `perPerson:true`
個人各自領取，教會商人兌換則是 `perPerson:false` 共享池），因此**判斷必須逐筆讀取資料，
不能對「鍛造石」這個 kind 本身做任何全域假設**。

### 3.3 潛在力量★：雙抽同時揭示、二選一

`renderPotentialPowerRewardDetail()` 改寫：按下單一「抽選」按鈕時，同時呼叫
`potentialPowerDrawWeapon(c, starCount)` 與 `rollPotentialPowerAttachedEffect(c)` +
`previewAttachedEffectSlot(c)`，兩個結果並排顯示，上方黃字
`midnight_reward_potential_choose_note`＝「請從下方選項中獲得一項」。玩家點選其中一個結果
才呼叫對應的 `commitPotentialPowerWeapon()`／`commitAttachedEffectChoice()`；未選的另一個
作廢、不寫回角色。

### 3.4 石劍鑰匙／鍛造石：依 perPerson 走共享池或個人領取

授予邏輯本體（把 `item_stonesword_key`／`item_smithing_stone` 塞進 `c.consumables`，
`noStackLimit:true`，比照現有 `handlePickupGroundItem()` 的疊加邏輯：已有同 itemId 就
`usesRemaining += value`，否則新增 instance）兩條路徑共用同一段程式碼：

- `perPerson:false`：走 §3.2 共享池「領取」handler，領到才授予。
- `perPerson:true`（或未標記）：走 §1.5 ledger——樓層戰利品自動發放流程直接授予給當下
  `participants`，並記錄進 `perPlayerRewards`，供後補加入者之後領取。

### 3.5 戰技重抽：全新鍛造台 UI

新增 `#midnight-weapon-reroll-modal`（跟商人的鍛冶合稀有度強化面板完全分開，兩者是不同功能）：

1. 展開 `listRerollableWeaponSkillSlots(characters[myTokenId])`，逐一顯示武器名＋目前戰技
   詳情（沿用既有武器詳情渲染 pattern）。
2. 選定一項後，該武器卡片「貼」到畫面中「鍛造台」下方空格（純 UI 呈現的高亮卡片）。
3. `[使用]`：呼叫 `rerollWeaponSkill(c, weaponId, slot)`，並排顯示新舊戰技/魔術/祈禱比較表
   （限同武器種類，`rerollWeaponSkill` 本身已保證這點）。玩家再選：
   - `[套用]`：呼叫 `commitWeaponSkillReroll(c, weaponId, slot, skillId)` 寫回角色。
   - `[保留並離開]`：放棄這次結果（不寫回角色），同時觸發跟原本「離開」相同的二段式確認——
     第一次按只顯示黃字「再按一下放棄使用鍛造台」（不關閉 modal）；同一按鈕 3 秒內再按一次
     才真正 `closeWeaponRerollModal()`；逾時（3 秒內沒有第二次點擊）視同取消提醒，狀態重置，
     下次按 `[保留並離開]` 重新從第一次點擊開始算。

`weaponSkillReroll` 這個 kind 的 `value` 決定可重抽次數，視為 `perPerson:true` 的一次性使用權
（進 §1.5 ledger，不走共享池）。

### 3.6 GM 判斷類（`hpDamage`／`tieredChoice`／`diceHandChoice`／`bargainReveal`／`note`）自動套用

在 `maybeGrantFieldTileReward()` 流程內新增分類處理（邏輯移植自 `night_floor_breakthrough.js`
對應函式，改綁 midnight 自己的 state，不直接呼叫 night.js 版本）：

- **`hpDamage`**：`trig.participants` 中隨機一位扣 `entry.value` 點 HP（`demoStat` transaction）。
- **`tieredChoice`**：用 §1.3 投票判定出的 `choiceIndex` 對應的選項標籤，去比對
  `entry.tiers[].label`；找到對應 tier 後，該 tier 的 `rewards[]` 遞迴丟回同一套獎勵處理
  （可能再次含 GM 判斷類，遞迴處理）。比對不到就整個 tier 跳過（不硬猜）。
- **`diceHandChoice`**：複製 `judgeDiceHand()`（純函式）到 midnight.js，擲 `entry.diceCount`
  （預設 12）顆 1D6 判定役，對應 `rewards[]` 同上遞迴處理。
- **`note`**：只顯示 toast／寫進 `_lastTileRewardNote`，不套用任何數值。
- **`bargainReveal`**（依你的規格）：
  - 新增 modal，一次列出全部（通常 6 個）`deals`，每項先顯示「標題＋良い效果」（bad 效果
    暫時隱藏）。
  - `trig.participants` 中任一人可各自獨立選擇一項（多人各自選各自的，符合規則書「PC 各自
    選擇」精神），選定後才顯示該項的「悪い效果」文字。
  - 確認後，`good`／`bad` 兩段文字都寫進該玩家 `_lastTileRewardNote`／log；文字中符合既有
    可解析格式的（例如「最大HP：+□□□」用既有 □ 解析並真正疊加進對應 flat bonus 欄位）
    才真正套用數值；無法結構化解析的部分（有生命週期限制、或需要玩家在特定時機再次選擇的
    效果，例如「與夜之王戰鬥時第2回合開始」這類條件觸發）保留文字紀錄，交由玩家在後續戰鬥
    自行對照套用（沿用 CLAUDE.md §17/§19 對「□」與非結構化規則文字的既有處理原則）。

---

## 4. 魔術師塔重做

### 4.1 題型：全部改為參數化模板即時生成

拿掉現有「兩數四則運算」，改為每次隨機挑一種題型，該題型的參數/答案**在執行當下即時生成並
自動算出**（不是固定題庫抽選）：

| 題型 | 生成邏輯 |
|---|---|
| 猜數字（4 位不重複數字，幾A幾B） | 隨機生成 4 個不重複數字（0-9）當答案；玩家每次輸入 4 位猜測，即時算出 A（位置與數字皆對）／B（數字對位置錯）並顯示，全部猜對（4A）過關 |
| 雞兔同籠 | 隨機生成頭數 `H`（8~20）與腳數範圍內的合法腳數 `F`（需滿足 `2H ≤ F ≤ 4H` 且 `F` 為偶數），算出雞 `x=(4H-F)/2`、兔 `y=H-x`；題目顯示「共 H 隻雞兔、F 隻腳，求雞兔各幾隻」，玩家輸入雞的數量比對 |
| 秤重找次品 | 隨機生成物品數 `N`（8~27）與較輕/較重次品的方向；顯示「N 顆球中有 1 顆較輕/較重的，用天秤最少秤幾次能找出」，答案用 `ceil(log3(N))` 算出，玩家輸入次數比對 |
| 過橋問題 | 隨機生成 4 人的過橋耗時（1~10 分鐘，各不相同），答案用固定的「兩人先過、快者返回」貪心演算法算出最短總時間，玩家輸入分鐘數比對 |
| 邏輯消去法 | 隨機生成 N 個角色（3~5 人）與 N 條線索（每人對應唯一身份/位置，線索排除法可唯一解出），玩家從清單中選出「符合所有線索」的答案；生成時用簡單模板（例如「A 不是最高的」「B 比 C 矮」...）直接構造保證有唯一解的線索組合，不用通用 constraint solver |
| 動態逆向思考 | 隨機生成一個簡單數列規則（等差/等比/平方數列其一），顯示前 4 項，玩家推算第 5 項（或倒推第 0 項），答案由生成規則直接算出 |

沿用現行 `towerSolved`／`towerInvites` 既有的邀請/開始/結算流程，只替換 `startTowerPuzzle()`
內部出題邏輯（改成 6 選 1 題型 dispatch），不動外層 pipeline。

### 4.2 解謎成功後的獎勵：12 骰牌型判定

謎題解開（`towerSolved[pt.id] = true`）後，`trig.participants`（這次一起解謎的每位玩家）
**各自獨立**進行以下流程（`perPerson:true`，每人各擲各的，互不影響）：

1. 按下開始後，畫面播放「12 顆骰子向上翻轉 5 圈後落回原位」的動畫效果，落地後顯示各自出目。
2. 玩家有**一次**重骰機會：可任意勾選其中幾顆骰子（選定後變色標示），按
   `[指定任意骰子並重骰一次]` 只重擲被選中的骰子（未選中的維持原出目）；也可以不選任何骰子、
   直接按 `[確定牌型]` 略過重骰。
3. `[確定牌型]` 後，用 `judgeDiceHand()`（複製自 `night_floor_breakthrough.js:250` 的純函式，
   同既有「複製一份純函式」慣例）依下列**由上至下**優先順序判定牌型並授予對應獎勵（走 §1.5
   ledger，直接授予，不需要再走共享池）：

| 牌型（判定條件） | 優先序 | 獎勵 |
|---|---|---|
| 【7骰同值】12 個出目中，某一數值出目達 7 個以上 | 1 | 杖：★★×1／武器：★★★×1／護符：★×1／星光的碎片×2 |
| 【大骰】12 個出目全為 4／5／6 | 2 | 杖：★★×1／武器：★★×1／護符：★×1／星光的碎片×1 |
| 【小骰】12 個出目全為 1／2／3 | 3 | 杖：★★×1／武器：★★×1／星光的碎片×1 |
| 【順子】1～6 每個數值至少各出現 1 次 | 4 | 杖：★★×1／武器：★★×1／武器：★×1／星光的碎片×1 |
| 以上皆不符合 | 5（預設） | 杖：★×1／武器：★×1／星光的碎片×1 |

**「杖」為類別限定抽選**：現有 `merchantDrawWeapon(c, starCount)`／`potentialPowerDrawWeapon(c, starCount)`
都不接受指定武器類別（前者隨機類別、後者依角色類型偏好），需要新增一個小工具函式
`drawWeaponFromCategory(c, categoryId, starCount)`——內部邏輯直接複用
`pickWeaponByRoll(categoryId, rarity, itemDie)`／`lookupRarityBySum()`／`rollD6()`
（`character_drawer.js:2712/2721`，皆為既有純函式），只是固定 `categoryId="staff"`、不隨機
選類別，不重新發明抽選規則本身。「武器」則沿用現有 `merchantDrawWeapon()` 隨機類別抽選。
「護符」沿用現有裝飾品隨機抽選（同 §3 潛在力量獎勵的抽法）。「星光的碎片」對應
`item_shard_of_starlight`（已在 `MERCHANT_CONSUMABLE_IDS` 清單中）。

---

## 5. 教會（K）聖杯瓶獎勵走獎勵清單

`grantLootRewardEntryToCharacter()` 的 `chaliceBonus` 分支不再立即發放，改成跟其他
`perPerson:true` 獎勵一樣先記錄進 §1.5 的 `perPlayerRewards` ledger／推入 `pendingRewards`
（依你的要求：「也需顯示在獎勵清單讓各人領取」），由玩家在獎勵清單彈窗主動按「領取」才真正
`flaskMax`/`flaskCount` +N。

---

## 6. 商人「鍛冶合」費用改為消耗鍛造石

```js
var FORGE_COST_C_TO_U = 1; // 消耗鍛造石數量
var FORGE_COST_U_TO_R = 2;
```

移除現有的 `MERCHANT_FORGE_COST_RUNES`（盧恩費用佔位值，已確認不是規則書數字）。
`renderMerchantForgeList()`／`handleMerchantForgeWeapon()` 改為：
- 檢查 `characterConsumableCount(c, "item_smithing_stone")` 是否達到目前升級所需數量
  （C→U 需 1、U→R 需 2，依 `getEffectiveWeaponRarity()` 目前等級決定）。
- 足額時扣除對應數量（消耗 `usesRemaining`，用完即移除該 instance），呼叫既有
  `upgradeWeaponRarity()`。
- UI 顯示「持有鍛造石：N」取代原本的盧恩顯示。

---

## 7. 強敵籌碼「⑧恐るべき強敵」（Day2）

進入 Day2 時，用 `fieldSeededIndex("day2_terrifying_strong_enemy", ...)` 從地圖上**尚未被
擊敗**的 `strong_enemy` 點中決定性挑 1 個，標記為 `meta.terrifyingStrongEnemyPointId`
（若 3 個點在 Day1 就已全數擊敗，則設為 `null`，Day2 沒有恐るべき強敵可打，不硬湊）。

`rollAndAssignStrongEnemy(pt)` 新增判斷：若 `pt.id === meta.terrifyingStrongEnemyPointId`
且目前已進入 Day2，改用 `extraTables[1]`（恐るべき強敵決定表）查表，撃破獎勵改用新常數
`TERRIFYING_STRONG_ENEMY_REWARD_RUNES=12`／`_POTENTIAL_STARS=3`；其餘 2 個點維持
`extraTables[0]` 與現行 8 盧恩／★★ 獎勵。

---

## 8. 隨機事件籌碼：完整轉錄（10 分支全機制化）

### 8.1 決定機制

新增 `rollAndAssignRandomEvent(pt)`（跟 `rollAndAssignStrongEnemy` 同款寫法）：呼叫
`rollRandomEventTable(findEventChip("random_event").extraTables[0], scenarioNumber)`（已內建
「不符合當前劇本就重擲，上限30次」邏輯，見 §8.3），取得對應的 `branches[]` 索引。

**特例（依你的規格）**：解出「霊鷹の止まり木」時，**直接替換成「聖甲蟲」分支**（沿用現有
`findScarabBranch()` 全部邏輯），不走靈鷹止まり木本身的場地移動機制。

### 8.2 各分支設計（10 分支，含完整轉錄的虫の大量発生／発狂地帯）

| 分支 | 判定 | 自動化設計 |
|---|---|---|
| 聖甲蟲 | 個人 13｜任選能力值 | 現有機制，不動 |
| 女神像 | 個人 10｜精神（自願，需先付 FP 損害■） | 顯示描寫，任一參與者可選擇「挑戰」並判定；FP 損害■ 交由玩家自行套用（同 CLAUDE §19，■ 不猜值）；1 人成功即算成功；成功後若隊伍含追跡者/無頼漢/守護者/執行者，額外顯示「消費技能破壞、獲得鍊石×3」選項（沿用既有技能次數扣除機制）；無人成功則事件結束、無獎勵 |
| 埋もれ宝 | 協力12×PC人數｜運試し | 全參與者各自判定加總比對；成功則擲「1D×3次」查 `event_rulebook.js` 的「チェスト内容決定表」（1=鍛石／2=石劍鑰匙／3=消耗品★／4-5=武器★★／6=武器★★★），逐一轉成 loot entry 走 §1.5 ledger；失敗無獎勵、事件結束 |
| 隕石 | 王戰（撃破盧恩8+L補正，潛在力量★★★★） | 顯示描寫後提供「(→隕石)／遠離（事件結束）」選項（沿用 §1.3 投票機制當作 2 選 1）；選擇前往後，重用**現有 `scanLinesForEnemyMatches`／`maybeAssignFieldEnemy` pipeline**（結構本來就是「描寫＋敵名bullet」，跟一般樓層完全同構）解析出「降る星の成獣／Lv.8」並開戰；本表項目本身已由 `rollRandomEventTable` 的劇本篩選限定僅劇本1/2/7/8出現 |
| 歩く霊廟 | 個人 11｜體能 | 判定成功或失敗都獲得「自身持有武器中任選 1 個」的複製品（UI：從 `c.weaponIds` 選一把，直接複製該武器 id 進背包，背包滿則走 §3.1 黃字提示）；失敗額外扣 HP□□（沿用既有 □ 解析工具，此處為損害方向） |
| 夜の勢力 | 協力11×PC人數｜體能，王戰、需連續n回 | 沿用王戰 pipeline，用「夜の勢力決定表」（1D6，6列）決定敵人＋戰鬥類型（雜兵/王戰）＋所需回合數n。新增 `trig.requiredRounds`／`trig.completedRounds`：每次擊敗後若未達 n 回，立即重新指派同一隻敵人滿血再戰（無 interval），達成後才視為撃破、發放潛在力量★★＋「夜の恩寵」——見下方風險項，「夜の恩寵」與 midnight 計時制技藝冷卻的對應方式需要你確認（§9-1） |
| 虫の大量発生（蟻の大量発生變體） | 協力12×PC人數｜體能 | 描寫後進入「地面の蟲たち」：PC 各自 12｜運試し，失敗者各自損失盧恩10（盧恩9以下則全失，等級不降），無論成敗都進「知性の蟲を追う」；該階段 PC 各自可選「HP損害□+12｜體能」或「FP損害□+12｜精神」，半數以上成功→「討伐獎勵」：（若地面階段有人失敗過）取回全部損失盧恩＋PC全員獲得撃破盧恩3＋獲得恩寵「知の集約」（戰鬥結束時代表擲1D，出目⚀則PC各自額外獲得盧恩1，此為戰鬥結束時的一次性判定，非持續效果，可直接實作）；半數以上失敗→蟲逃脫、一無所獲、事件結束 |
| 発狂地帯 | 協力11×PC人數｜精神 | 描寫後進入「狂い火」：PC各自12｜任選判定值，無論成敗都到「狂い火の塔1」，成功者承受發狂2D／失敗者發狂3D（**直接用 midnight 既有「発狂」屬性異常蓄積機制**，`ATTRIBUTE_STATUS_AILMENT_NAMES_JA` 已含此項，不需要新機制）；「狂い火の塔1」提供「離開（需突破判定）／探索塔」2選1；探索塔進「狂い火の塔2」重複一次同款12｜任選判定值＋發狂2D/3D，無論成敗進「狂い火の塔3」；塔3依序做3次協力判定（運試し／體能／精神，各11×PC人數），成功2次以上→PC各自獲得潛力★★×2、再承受發狂2D；成功1次→同樣獲得潛力★★×2、但承受發狂3D；全部失敗→承受發狂3D（時間損耗1不適用，同既有全踏破效果的簡化原則，midnight無對應資源） |
| 襲撃 | 依「襲擊事件決定表」查表決定敵人（1D6，6列，各自劇本限定重擲） | 沿用 `rollRandomEventTable` 同款「劇本篩選+重擲」邏輯查出 6 種之一（忌み鬼／兆し／調律の魔物／三つ首の獣／霧の裂け目／安寧者たち），除「調律の魔物」外其餘走王戰 pipeline＋各自固定獎勵/恩寵文字（沿用既有 □ 解析＋ CLAUDE §19 對非結構化恩寵文字的處理）；「調律の魔物」的「取引抽選表」（6 個 good/bad 配對、選擇後持續整個劇本、部分效果連動 Day3 夜之王戰鬥第2回合）**直接複用 §3.6 的 `bargainReveal` 自動套用邏輯**（資料結構完全相同：good/bad 配對、可解析部分自動套用、不可解析部分留文字紀錄），不需要另外設計第二套取引機制 |

### 8.3 劇本篩選（呼應第9項）

`event_rulebook.js` 的「隨機事件決定表」本身多筆條目帶「※僅限劇本X」重擲條件（隕石限
1/2/7/8，歩く霊廟限4/7/8，夜の勢力限1/4/6，蟻の大量発生限4/5/9/10，発狂地帯限3/5/8/9；
「襲擊事件決定表」同樣逐項帶劇本限定）——`rollRandomEventTable()` 已內建這個重擲邏輯，
只要正確傳入 `scenarioNumber`（`resolveNightBossScenarioId()` → `Scenarios.numberForId()`）
即自動生效，不需要 midnight.js 額外處理篩選規則本身。

---

## 9. 已知風險與待確認項（實作階段需注意，不阻塞開發順序）

1. **夜の勢力「夜の恩寵」對應 midnight 的哪一層冷卻（已確認）**：規則書原文「技（アーツ）
   改用『祝福での休息』回復使用次數」對應 midnight 的**技能（skill，60秒計時冷卻）**，不是
   技藝（art，180秒）。具體套用方式：
   - 「n回」戰鬥結束當下：`trig.participants` 全員的技能冷卻**立即歸零**（可馬上再用一次）。
   - 之後持續的「夜の恩寵」被動：取得此恩寵的角色，之後改成「技能冷卻在該角色使用祝福籌碼時
     直接歸零」，**不再受 60 秒計時器限制**（新增角色旗標 `_nightBlessing:true`，供技能
     可用性判斷式與 `handleBlessingUseClick()` 一併查詢／重置這類角色的技能冷卻）。
2. **bargainReveal／調律の魔物取引：已確認的 4 個具體 deal 效果 midnight 換算**（其餘 deals
   若有其他非結構化效果，實作時比照下列精神逐條處理，找不到明確換算就保留文字紀錄）：
   - 「後に大成したい」：良好效果原文「『夜之王』戰鬥第2回合行動階段開始時，最大HP:+□□□」
     → midnight 換算為「**打贏Day2夜之強敵、能進入夜之王戰鬥時，自身最大HP +30**」（觸發時機
     從「夜之王戰鬥第2回合」改為「Day2夜之強敵撃破後即將進入Day3」，因為 midnight 沒有回合
     概念，見既有 Day2→Day3 銜接流程 §8 之外的 `maybeTriggerDay3FromReady()`）；不良效果原文
     「最大FP:−□、最大加護:−□」→ midnight 換算為「**FP −10**」（midnight 沒有「加護」對應
     資源，該部分效果略過不套用）。
   - 「全力で戦いたい」：良好效果原文「自身最大HP:+□、任選威力補正:+5」→ midnight 換算為
     「**自身最大HP +10，任選威力補正+5**」（威力補正部分沿用原文不變）；不良效果原文
     「『夜之王』所有HP行最大HP:+□（多PC累積）」→ midnight 換算為「**Day3夜之王的聚合HP池
     （未乘上×10倍率前的原始格數）+20，多名PC各自選擇此效果時累積相加**」。
   - 兩個體力骰相關 deal（原文分別描述行動/額外階段開始時體力骰「□」變成「⚀」的不良效果、
     防禦階段開始獲得體力骰1個的良好效果）→ midnight 沒有「體力骰」機制，換算為直接調整
     `STAMINA_REGEN_PER_SEC` 個人化倍率：不良效果＝**耐力回復速度從 5/秒降為 4/秒**；良好
     效果＝**耐力回復速度從 5/秒升為 6/秒**（皆為該角色個人的常數覆寫，不影響其他玩家）。
3. **調律の魔物 bargain 效果連動 Day3 夜之王戰鬥「第2回合行動階段」的觸發時機換算**：已在
   上方第 2 點「後に大成したい」換算中一併解決（改為「Day2夜之強敵撃破後」觸發），其餘若有
   類似「第N回合」措辭的效果，比照同一精神換算成 midnight 既有的天/夜之強敵撃破等離散事件
   節點，不強行模擬「回合」。
4. **「立即進入」按鈕沒有額外防呆**：連續按沒有副作用（只是把 `inviteDeadline` 往前提），
   不是 bug，但實作時可視情況加簡單的按鈕 disable 避免誤觸感。

---

## 10. 驗證方式

沿用 CLAUDE.md §4 既有流程：`python generate.py` → 本機 server → Playwright（多分頁模擬
2~3 名玩家）驗證：
1. 板塊樓層：邀請/立即進入/投票即時分布/全員投完立即判定/中途加入/後補領獎，各自建立最小
   重現場景驗證（含驗證祝福/商人不受影響——靠近時仍是原本的直接互動，不會冒出領取獎勵按鈕）。
2. 分歧變體：固定 `meta.mapSeed`＋固定劇本，驗證同一劇本重複開局時同一張卡選到的變體具
   一致性；驗證地圖上同一種卡牌的兩個實體各自獨立抽選（不共用同一結果）。
3. 獎勵清單：背包滿黃字提示、共享池搶先領取（含黃字「共有獎勵，非全員獲得」標註）、鍛造石
   依 perPerson 分別走共享池/個人領取兩種路徑、潛在力量雙抽二選一、戰技重抽鍛造台 UI 完整
   流程（含 `[保留並離開]` 二段式確認）、GM 判斷類自動套用（含 bargainReveal 六選一與調律
   の魔物取引共用同一套邏輯，逐一核對 §9 已列出的 4 個具體 deal 換算數值）。
4. 魔術師塔：6 種題型各測一輪，確認參數/答案每次不同且能正確判定；解謎成功後的 12 骰牌型
   抽選（含重骰一次、5 種牌型判定優先序、「杖」類別限定抽選）。
5. 商人：驗證鍛造石數量不足時無法升級、消耗數量正確（1/2）。
6. 強敵⑧恐るべき強敵：固定 seed 驗證 Day2 選中的點確實套用高倍表與高倍獎勵；驗證 Day1
   已擊敗的點不會被選中。
7. 隨機事件：10 分支逐一驗證（含発狂地帯的發狂蓄積、虫の大量発生的盧恩損失/取回、隕石的
   劇本限定重擲、襲撃的調律の魔物取引流程）。
