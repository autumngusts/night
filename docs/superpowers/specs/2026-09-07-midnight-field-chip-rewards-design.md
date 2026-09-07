# Midnight 板塊樓層／獎勵清單／籌碼事件 大改版 設計文件

日期：2026-09-07
範圍：`static_src/midnight.js`／`midnight_map.js`（即時制擴張版），不影響 `night.js`（回合制）。

## 0. 背景與既有機制盤點

本次改版前已完成的調查記錄於 `docs/midnight_field_chip_rules.md`（板塊樓層/籌碼機制現況整理）。
本文件在該份文件基礎上，設計 9 項使用者要求的優化。以下是設計中會重用的既有函式／資料，
先列出避免重複發明：

| 用途 | 既有函式／資料 | 位置 |
|---|---|---|
| 打字機敘述（可調速度） | `typewriteInto(el, text, {intervalMs})` | `night_gm_flow.js:51` |
| 突破判定/協力判定文字解析（`〈協力N×PC人數｜屬性〉`） | `parseBreakthroughCheckText(text)` | `night_floor_breakthrough.js:25`（純函式，需複製一份到 midnight.js，同 `MERCHANT_CONSUMABLE_IDS` 既有慣例） |
| GM 判斷類獎勵自動解決（`hpDamage`/`tieredChoice`/`diceHandChoice`/`note`） | `autoResolveJudgmentEntry(entry, entered, floorKey, entryIndex)` 的邏輯（不能直接呼叫，需要在 midnight.js 內移植等價邏輯，因為它依賴 `night.js` 專屬的 `state.gmFlow`/`state.turnRewards`） | `night_floor_breakthrough.js:469` |
| 潛在力量★ 抽選（得意武器／附帶效果） | `CharacterDrawer.potentialPowerDrawWeapon(c, starCount)`／`rollPotentialPowerAttachedEffect(c)`／`previewAttachedEffectSlot(c)`／`commitPotentialPowerWeapon(c, wr)`／`commitAttachedEffectChoice(c, effect, slotPreview)` | `character_drawer.js` |
| 戰技重抽 | `listRerollableWeaponSkillSlots(c)`／`rerollWeaponSkill(c, weaponId, slot)`／`commitWeaponSkillReroll(c, weaponId, slot, skillId)` | `character_drawer.js:2814~2848`（既有函式，目前沒有任何 UI 呼叫） |
| 強敵決定表／恐るべき強敵決定表（2 顆骰×12列） | `event_rulebook.js` `strong_enemy` chip `extraTables[0]`（一般）／`extraTables[1]`（恐るべき） | `event_rulebook.js:271` |
| 隨機事件決定表（劇本篩選重擲） | `rollRandomEventTable(table, scenarioNumber)`（已含「不符合當前劇本就重擲，上限30次」邏輯） | `night_gm_flow.js:1667` |
| 隨機事件的 10 種分支全文 | `event_rulebook.js` `random_event` chip `branches[]`（含「聖甲蟲／靈鷹の止まり木／女神像／埋もれ宝／隕石／歩く霊廟／夜の勢力／虫の大量発生（含蟻の大量発生的變體）／発狂地帯／襲撃」） | `event_rulebook.js:313~` |
| 夜の強敵決定表（劇本×日別查表） | `resolveNightBossTableRow(card, scenarioNumber)`／`rollNightBossEntry(row, colIndex)` | `night_gm_flow.js:3179/3216` |
| 各劇本固定卡牌配置（含花色/點數/分歧名稱提示） | `SCENARIOS[i].day1[]`／`day2[]`（每格 `{pos, suit, rank, name}`） | `scenarios.js` |
| 消耗品資料（石劍鑰匙/鍛造石，已是 midnight 專用道具化版本） | `item_stonesword_key`／`item_smithing_stone`（`noStackLimit:true`） | `consumables.js:172/182` |

---

## 1. 板塊樓層 pipeline 改版

### 1.1 時間常數調整

```js
FIELD_INVITE_TIME_LIMIT_MS = 10000;      // 現狀已是10秒，不變
FIELD_ENTER_WAIT_MS = 1000;              // 0.5s → 1s
FIELD_ENTER_WAIT_MS_SPECIAL = 5000;      // 新增：J（堡壘）/其他「非A,2~10,K,籌碼」板塊專用
FIELD_VOTE_TIME_LIMIT_MS = 10000;        // 不變
```

`maybeStartFieldTypewriter()` 呼叫等待判斷時，改成依 `pt.card` 選擇上述兩個常數其中之一
（`pt.card === "J"` 用 special，其餘一般板塊卡維持 1 秒）。

> **澄清**：原始需求寫「A,2~10,K,籌碼以外的板塊＝J,Q」。經比對 `fields_data_1~4.js` 與
> `midnight_map.js` 的既有卡牌 id 清單，本作品只實作了 `A／2~10／K／J` 共 12 種板塊，**沒有
> `Q` 這張卡**（規則書亦無此編號）。因此本設計把「特殊 5 秒等待」的範圍認定為**僅 J（堡壘）
> 一種**；若你之後確認還有其他應歸類的板塊，之後再擴充 `FIELD_ENTER_WAIT_MS_SPECIAL` 的
> 判斷條件即可，不影響其餘設計。

打字機速度：呼叫 `typewriteInto()` 時額外傳 `{ intervalMs: 56 }`（預設 28ms 的 2 倍＝變慢 0.5 倍）。

### 1.2 邀請階段：顯示已加入名單＋「立即進入」

`renderFieldVoteOrResult()`（或新增 `renderFieldInviteStatus()`）在 `trig.status === "inviting"` 時：
- 渲染 `trig.participants` 目前已加入的玩家名字列表。
- 顯示「立即進入」按鈕（任一已加入者可按），點擊後：

```js
function handleForceEnterFieldClick(pt) {
  var trig = fieldTriggers[pt.id];
  if (!trig || trig.status !== "inviting" || !trig.participants[mySlot]) return;
  GameStorage.rtSet(gameId, "cloud", "fieldTrigger/" + pt.id + "/inviteDeadline", Date.now());
}
```

不新增狀態機分支——`maybeAdvanceFieldInvite()` 既有的「`Date.now() >= trig.inviteDeadline`」判斷
會在下一輪 `updateNearbyFieldPoint()` 自然觸發，不需要改動判斷邏輯本身。

### 1.3 投票階段：即時票型分布＋全員投完立即判定

- `renderFieldVoteOrResult()` 新增：依 `trig.votes` 即時渲染各選項目前票數（長條/數字皆可，沿用
  既有 CSS class 風格）。
- `maybeResolveFieldVote()` 邏輯調整：目前「全員都投但沒共識」要等到 `timedOut` 才多數決。改為
  **只要全員都投了（`allVoted`），不論是否逾時，立即判定**——一致就直接用該項，不一致就立即套用
  `pickFallbackChoice()`（多數決）。也就是把原本 `else return;`（全員投完但未逾時、沒共識時的
  「繼續等」分支）拿掉，改成立即呼叫 `pickFallbackChoice`。

### 1.4 中途加入（「參加探索」）

新增獨立於原邀請機制的第二套加入流程，只在 `trig` 已存在（`inviting`/`active`/`resolved`
皆可）且 `mySlot` 不在 `trig.participants` 時觸發：

- `updateNearbyFieldPoint()` 偵測到此情況時，顯示 `[參加探索]` 按鈕（跟原本的
  `[加入]`/`inviteWait` UI 分開渲染，因為原邀請 3 秒視窗可能早已結束）。
- 按下後啟動本地 2 秒計時器（`FIELD_LATE_JOIN_WAIT_MS = 2000`），逾時後才真正
  `GameStorage.rtSet(..., "fieldTrigger/" + pt.id + "/participants/" + mySlot, true)`。
- 此時玩家會合併看到當前 `status` 對應的畫面（敘述中/投票中/戰鬥中皆自然銜接，因為渲染函式本來
  就是依 `trig.status` 決定顯示什麼，只是原本 `participants` 檢查會排除他，現在他加入後就能看到）。
- **投票視窗仍在 `active` 且未 `resolved`**：新加入者可以投票（`participantSlots(trig)` 動態
  讀 `trig.participants`，本來就會自動納入新成員，不需要特別處理）。
- **已經 `resolved`（含戰鬥中/已和平通過）**：新加入者只是加入 `participants`，不會回頭觸發投票。

### 1.5 落後獎勵追蹤（per-player reward ledger）

新增 RTDB 節點 `fieldProgress/{pointId}/perPlayerRewards/{seq}`：每次
`maybeGrantFieldTileReward()` / `maybeGrantFieldFullClearReward()` / §3 新增的潛在力量等
「per-player 保證獲得」獎勵發放時，除了發給當下 `trig.participants` 外，同時 push 一筆
`{ entries: [...], grantedAt }` 進這個節點（累加、不覆蓋，`seq` 遞增）。

「per-player 保證獲得」的判斷：`rune`／`weaponStar`／`consumable`／`talisman`／`chaliceBonus`／
`potentialPower`——即現有 `LOOT_REWARD_KINDS` 中，非「固定數量、先到先得」的種類。
`stoneswordKey`／`smithingStone`（走 §3 的「固定數量共享池」）不記錄進這個 ledger，因為
它們的規則就是「搶完就沒有」，落後玩家本來就不該追討。

**領取機制**：
- 玩家靠近「自己從未參與過、但已有進度（`fieldProgress` 存在）」的板塊點（不論該點是否已全
  踏破、卡牌是否顯示 ✕）時，顯示 `[領取獎勵]` 按鈕。
- 按下後 2 秒（沿用 `FIELD_LATE_JOIN_WAIT_MS`），把 `perPlayerRewards` 中「這個 tokenId 尚未
  領過」的所有 entries 一次發給他（用 `fieldProgress/{pointId}/claimedBy/{tokenId} = true` 標記
  已處理，避免重複發放；不需要逐筆 seq 標記，因為一次全部結清）。
- HP/FP 消耗、戰鬥本身不追溯（維持現狀，這些不記錄進 ledger）。

---

## 2. 分歧「變體」挑選：劇本連動

### 2.1 資料來源：`scenarios.js` 既有的劇本卡牌配置

`SCENARIOS[i].day1[]`／`day2[]` 每筆 `{pos, suit, rank, name}` 已經是「這個劇本在這一天、這個
位置放的是哪張牌（含花色）、規則書怎麼稱呼這個變體」的權威資料（例：`tricephalos` 劇本 day1
pos1 是 `{suit:"C", rank:"2", name:"大教會（聖）"}`）。

### 2.2 建立「劇本＋卡牌點數」→ 候選變體池

新增函式 `scenarioVariantCandidatesForRank(scenarioId, rank)`：

```js
function scenarioVariantCandidatesForRank(scenarioId, rank) {
  var Scenarios = window.PriTestScenarios;
  var scenario = Scenarios.get(scenarioId); // 需確認scenarios.js是否已有get(id)，若無則list().filter
  if (!scenario) return [];
  var out = [];
  ["day1", "day2"].forEach(function (dayKey) {
    (scenario[dayKey] || []).forEach(function (slot) {
      if (slot.rank === rank) out.push(slot); // 保留day1/day2兩邊、不同花色都各自收錄
    });
  });
  return out;
}
```

依使用者確認「若區分一日二日有不同的花色，則兩者都能套用抽選查看」：不分天，把 day1／day2
所有符合這個點數（rank）的項目都收進候選池（同一個 rank 在 day1/day2 可能是不同花色、不同
變體名稱，例如上面 tricephalos 例子的「大教會（聖）」vs day2 的「大教會（無印）」都會進池）。

### 2.3 用候選池決定 `pickFieldBranchIndex()`

```js
function pickFieldBranchIndex(pt) {
  var branches = fieldCardBranches(pt.card);
  if (!branches.length) return 0;
  var scenarioId = resolveNightBossScenarioId();
  var candidates = scenarioId ? scenarioVariantCandidatesForRank(scenarioId, pt.card.toUpperCase()) : [];
  if (candidates.length) {
    var picked = candidates[fieldSeededIndex(pt.id + ":scenario_variant", candidates.length)];
    var resolvedIndex = matchBranchIndexByNameHint(branches, picked.name);
    if (resolvedIndex !== null) return resolvedIndex;
    // name含"隨機"／比對不到明確分支：退回varianceTable真正查表（見2.4）
    var viaVariance = resolveBranchViaVarianceTable(pt.card, scenarioId, picked.suit);
    if (viaVariance !== null) return viaVariance;
  }
  return fieldSeededIndex(pt.id + ":branch", branches.length); // 無劇本資料/比對失敗：退回現行純隨機
}
```

`matchBranchIndexByNameHint(branches, nameHint)`：`nameHint` 例如「大教會（聖）」，去掉卡牌
本名只留「（聖）」這類後綴，跟 `branches[i].name`（localizedText）做包含比對；命中就回傳該
index，含「隨機」二字或找不到比對就回傳 `null`（交給 2.4 的 varianceTable 真查表，或最終
退回純隨機）。

### 2.4 `varianceTable` 真查表（`name` 含「隨機」時）

沿用規則書 `varianceTable.rows`（`[劇本欄, 花色欄, 內容(1D)欄]`），用劇本編號比對劇本欄、
`picked.suit` 比對花色欄，找到對應列後用 `fieldSeededIndex` 骰 1D 決定最終內容字串，再拿這個
字串去 `matchBranchIndexByNameHint()` 一次。若這一步也找不到就回傳 `null`，最終由呼叫端退回
純隨機（不阻塞流程）。

### 2.5 J（堡壘）與 A（出發地點）／Z（黃金樹之帳）

- J 對應 `fields_data_4.js card_j`，同樣走上述機制（`rank: "J"`，若 `scenarios.js` 沒有記錄
  堡壘的資料列則直接退回純隨機，堡壘本身較可能沒有分歧變體）。
- A／Z 本來就有各自的 `nightBossFixedLevel`／夜之強敵決定表查詢邏輯（§8 已涵蓋一半），
  出發地點的 `varianceTable`（`a_start` 卡）改用 §2.4 的真查表邏輯（`start.suit`／
  `SCENARIOS[i].start.suit` 已存在於 `scenarios.js`）。

---

## 3. 獎勵清單優化

### 3.1 背包已滿：黃字提示取代靜默隱藏

`renderRewardDetail()`／`grantLootRewardEntryToCharacter()` 判斷背包滿時，改成顯示
`midnight_inventory_full_note`（黃字樣式，沿用既有 `.toast`/`.warning-text` class）而不是
直接不出現確認按鈕；按鈕仍保留（可選擇先去角色面板丟棄再回來按，或直接無視）。

### 3.2 固定數量獎勵：共享池、先搶先贏

新增 RTDB 節點 `fieldTrigger/{pointId}/sharedRewards/{rewardId}`（結構同 `pendingRewards`
entry，但**只有一份**，所有 `participants` 共享）。

發放時機（樓層戰利品含 `stoneswordKey`／`smithingStone`，或未來任何 `perParty:false` 的固定
數量品項）：

```js
function pushSharedReward(pointId, entry) {
  var rewardId = "srw" + Date.now() + Math.floor(Math.random() * 100000);
  entry.resolved = false;
  GameStorage.rtSet(gameId, "cloud", "fieldTrigger/" + pointId + "/sharedRewards/" + rewardId, entry);
}
```

所有 `participants` 的畫面都渲染同一份 `fieldTrigger/{pointId}/sharedRewards`；任一人按
「領取」時用 `rtTransaction` 鎖定 `.../sharedRewards/{rewardId}/resolvedBy`
（first-writer-wins，同 `tileRewardGrantedBy` 既有手法），成功者才真正把物品寫進自己角色，
其餘人畫面上該項目立即變成「已被 XXX 領取」（唯讀）。

### 3.3 潛在力量★：雙抽同時揭示、二選一

改寫 `renderPotentialPowerRewardDetail()`：不再是「武器」「效果」各自獨立按鈕，改成單一
「抽選」按鈕，按下同時呼叫 `potentialPowerDrawWeapon()` 與 `rollPotentialPowerAttachedEffect()`
（+`previewAttachedEffectSlot()`），兩個結果並排顯示，上方黃字 `midnight_reward_potential_choose_note`
＝「請從下方選項中獲得一項」。選其中一個確認後，另一個結果作廢（不寫回角色）。

### 3.4 石劍鑰匙／鍛造石：走共享池，領到後進消耗品欄

`grantLootRewardEntryToCharacter` 新增 `stoneswordKey`／`smithingStone` 分支——但因為這兩種
改走 §3.2 共享池，不是走這個「直接授予」函式，而是在共享池的「領取」handler 裡呼叫類似邏輯：
把 `item_stonesword_key`／`item_smithing_stone` 塞進 `c.consumables`（`noStackLimit:true`，
跟現有 `handlePickupGroundItem()` 的疊加邏輯一致：已有同 itemId 就 `usesRemaining += value`，
否則新增 instance）。

### 3.5 戰技重抽：鍛造台 UI（全新畫面）

新增 modal（例如 `#midnight-weapon-reroll-modal`）：
1. 展開 `listRerollableWeaponSkillSlots(characters[myTokenId])`（有隨機戰技槽的武器清單），
   每項顯示武器名＋目前戰技（呼叫既有 `renderWeaponSkillRefEntry` 展示詳情，沿用
   `night_potential_power.js` 的既有 pattern）。
2. 選定一項後，該武器「貼」到畫面中「鍛造台」下方空格（純 UI 呈現，一個高亮卡片）。
3. `[使用]`：呼叫 `rerollWeaponSkill(c, weaponId, slot)`，顯示新舊戰技比較表（沿用
   `potential_power_effect_will_replace_note` 同款「舊→新」對照卡片 pattern）。玩家再選
   `[套用]`（呼叫 `commitWeaponSkillReroll`，寫回角色）或 `[保留]`（放棄這次重抽結果，
   不寫回，可以重新選其他武器）。
4. `[離開]`：第一次按只顯示黃字提醒「再按一下放棄使用鍛造台」（不關閉），第二次按才真正
   `closeWeaponRerollModal()`。

這個獎勵發放方式：跟潛在力量★一樣是「per-player 保證獲得」的一次性使用權（`weaponSkillReroll`
kind，`value` 決定可以重抽幾次），不是共享池。

### 3.6 GM 判斷類（hpDamage／tieredChoice／diceHandChoice／bargainReveal／note）自動套用

在 midnight.js 內移植（非直接呼叫，因為 night.js 版本綁定 `state.gmFlow`/`state.turnRewards`）
等價邏輯，掛在 `maybeGrantFieldTileReward()` 流程內，對 `floor.reward` 裡這 5 種 kind 逐一處理：

- **`hpDamage`**：隨機一位 `trig.participants` 扣 `entry.value` 點 HP（`demoStat` transaction）。
- **`tieredChoice`**：用 §1.3 投票判定出的 `choiceIndex` 對應的 label，去比對
  `entry.tiers[].label`（跟 `night.js` 用「已選路線標籤」比對 tier 是同個精神，只是 midnight
  的「已選路線」來源是玩家投票結果而非 GM 敘述路徑）；找到對應 tier 後，該 tier 的
  `rewards[]` 遞迴丟回 `maybeGrantFieldTileReward` 同一套處理（含可能再次是 GM 判斷類，遞迴
  處理）。比對不到就整個 tier 陣列跳過（不硬猜）。
- **`diceHandChoice`**：`diceCount`（預設12）顆 1D6，呼叫既有役判定邏輯——**此函式
  （`judgeDiceHand`）位於 `night_floor_breakthrough.js`，屬純函式，複製一份到 midnight.js**
  （同 `parseBreakthroughCheckText` 的既有慣例）。判定出的役對應 `rewards[]` 同上遞迴處理。
- **`note`**：只顯示 toast／寫進角色 `_lastTileRewardNote`，不套用任何數值。
- **`bargainReveal`**（依你的規格）：
  - 顯示一個新 modal，一次列出全部 6 個 `deals`，每項顯示 `[標題：X　良い効果：X]`（good
    效果先顯示、bad 效果暫時隱藏）。
  - 玩家（`trig.participants` 任一人，多人可各自獨立操作、各自選各自的，因為這是「PC 各自
    選擇」的規則精神）點選其中一項後，才顯示該項的「悪い効果」文字。
  - 確認後，`good`／`bad` 兩段文字**都**直接寫進該玩家角色的 `_lastTileRewardNote`／log
    （可長期查閱），凡是文字裡符合既有可解析格式的（例如「最大HP：+□□□」可用既有
    `sumMaxStatDeltaFromText` 解析並真正疊加進 `totalFlatMaxStatBonus` 相關欄位）才真正套用
    數值；無法結構化解析的部分（例如「直到夜之王戰鬥第2回合為止」這種有生命週期的效果、
    「隨機選一種威力補正-5」這種需要玩家再次選擇的效果）保留文字紀錄，交由玩家在後續戰鬥中
    自行對照套用（沿用 CLAUDE.md §17/§19 對「□」與非結構化規則文字的既有處理原則，不發明
    尚未支援的機制）。

---

## 4. 魔術師塔重做

拿掉現有「兩數四則運算」，改為隨機挑一種題型（各題型各準備若干題庫，開局隨機挑一題，不含
規則書依據，純遊戲性補充，比照現行「不是規則書內容」的既有定位）：

- **猜數字（4位數字 AB 猜謎）**：系統產生 4 個不重複數字，玩家輸入猜測，回饋 `nA nB`
  （n=位置與數字皆對／數字對位置錯的個數），全部猜對（4A）過關。
- **邏輯應用題**：準備一個小題庫模組（`midnight.js` 內新增常數陣列，10~15 題，涵蓋雞兔同籠／
  秤重找次品／過橋時間／邏輯消去法／動態逆向思考等經典題型），每題 `{ prompt, answer }`，
  隨機抽一題，玩家輸入數字答案比對。

沿用現行 `towerSolved`／`towerInvites` 既有的邀請/開始/結算流程，只替換 `startTowerPuzzle()`
內部出題邏輯，不動外層 pipeline。

---

## 5. 教會（K）聖杯瓶獎勵走獎勵清單

`grantLootRewardEntryToCharacter` 的 `chaliceBonus` 分支不再「立即發放」，改成跟其他
per-player 獎勵一樣先記錄進 §1.5 的 `perPlayerRewards` ledger／推入 `pendingRewards`，
由玩家在獎勵清單彈窗主動按「領取」才真正 `flaskMax`/`flaskCount` +N。

---

## 6. 商人「鍛冶合」費用改為消耗鍛造石

```js
var FORGE_COST_C_TO_U = 1; // 鍛造石數量
var FORGE_COST_U_TO_R = 2;
```

`renderMerchantForgeList()`／對應 handler 改為檢查
`characterConsumableCount(c, "item_smithing_stone")` 是否足額，成功後扣除對應數量（消耗
`usesRemaining`，`noStackLimit` instance 用完即移除）。UI 顯示「持有鍛造石：N」取代原本的
盧恩顯示。

---

## 7. 強敵籌碼「⑧恐るべき強敵」

新增：進入 Day2 時（`meta.dayNumber === 2` 或等價判斷），用
`fieldSeededIndex("day2_terrifying_strong_enemy", 3)` 從地圖上 3 個 `strong_enemy` 點中
決定性挑 1 個，標記為 `meta.terrifyingStrongEnemyPointId`。

`rollAndAssignStrongEnemy(pt)` 判斷：若 `pt.id === meta.terrifyingStrongEnemyPointId` 且
已進入 Day2，改用 `extraTables[1]`（恐るべき強敵決定表）查表，撃破獎勵改為
`盧恩12／潛在力量★★★`（新常數 `TERRIFYING_STRONG_ENEMY_REWARD_RUNES=12`／
`_POTENTIAL_STARS=3`）；其餘 2 個點維持 `extraTables[0]` 與現行 8/★★ 獎勵。

**時機處理**：若這個點在 Day1 就已經被撃破（`fieldTriggers[pt.id].status==="resolved"`
且 HP 已 0），Day2 判斷時直接跳過（不會「已擊敗的敵人突然變成恐るべき強敵」），只從**Day2
仍存活/未觸發**的點中挑選——`fieldSeededIndex` 挑選時先過濾掉已撃破的點，若 3 個都已撃破則
不指定（`meta.terrifyingStrongEnemyPointId = null`，Day2 沒有恐るべき強敵可打，不硬湊）。

---

## 8. 隨機事件籌碼：完整轉錄（10 種分支全機制化）

### 8.1 決定機制

`rollAndAssignFinalCircleBoss` 同款寫法，新增 `rollAndAssignRandomEvent(pt)`：
呼叫 `rollRandomEventTable(findEventChip("random_event").extraTables[0], scenarioNumber)`
（既有函式，已含劇本篩選重擲），取得 `result.rowIndex`（對應 `branches[rowIndex+1]`）。

**特例**：若解出的分支是「霊鷹の止まり木」，依你的規格**直接替換成「聖甲蟲」分支**（沿用
現有 `findScarabBranch()` 全部邏輯），不走靈鷹止まり木本身的機制。

其餘 9 種分支（聖甲蟲已有；女神像／埋もれ宝／隕石／歩く霊廟／夜の勢力／虫の大量発生／
蟻の大量発生／発狂地帯／襲撃）逐一設計如下。共同基礎設施先建立：

**通用「行為判定」元件**（generalize 自現有 `handleScarabCheckClick`）：

```js
function performAbilityCheck(statKey, targetValue) {
  var type = characterTypeOf(myTokenId);
  var diceCount = type && type.checkValues ? type.checkValues[statKey] || 0 : 0;
  var dice = rollDice(diceCount);
  var sum = sumDice(dice);
  return { sum: sum, success: sum >= targetValue, dice: dice };
}
```

**通用「協力判定」元件**（複製 `parseBreakthroughCheckText` 到 midnight.js，解析
`〈協力N×PC人數｜屬性〉`得到 `{target, perPC, stat}`，`perPC` 時 `target *= trig.participants長度`；
判定方式：所有參與者各自擲對應屬性骰加總比對同一目標值，或依文字指定用途取「任一人成功即算」，
依各分支原文個別判斷）。

### 8.2 各分支設計

| 分支 | 判定 | 自動化設計 |
|---|---|---|
| 聖甲蟲 | 個人 13｜任選能力值 | 現有機制，不動 |
| 女神像 | 個人 10｜精神（自願） | 顯示描寫，任一參與者可選擇「挑戰」（付 FP 損害■，交由玩家自行套用同 CLAUDE §19）並判定；1人成功即算成功，成功者所屬隊伍若含追跡者/無頼漢/守護者/執行者角色則額外顯示「消費技能可破壞、獲得鍊石×3」選項（複用既有技能次數扣除機制） |
| 埋もれ宝 | 協力12×PC人數｜運試し | 全參與者各自判定加總比對，成功則用「1D×3次」查 `event_rulebook.js` 的「チェスト内容決定表」（鍛石/石劍鑰匙/消耗品★/武器★★/武器★★★，見 §0 表列），逐一轉成戰利品 entry 走 §1.5 ledger |
| 隕石 | 王戰（撃破ルーン8+L補正，潛在力量★★★★） | 描寫敘述後，`(→隕石)` 分支重用**現有 `scanLinesForEnemyMatches`／`maybeAssignFieldEnemy` pipeline**（跟一般樓層完全同一套，因為結構本來就是「描寫＋敵名bullet」），敵人固定「降る星の成獣／Lv.8」 |
| 歩く霊廟 | 個人 11｜體能 | 判定成功或失敗都獲得「自身持有武器中任選1個」的複製品（UI：從 `c.weaponIds` 選一把，`grantLootRewardEntryToCharacter` style 直接複製該武器 id 進背包，背包滿則走 §3.1 黃字提示）；失敗額外扣 HP□□（用既有 `sumMaxStatDeltaFromText`/`countHealSquares` 同款 □ 解析，此處為「損害」方向） |
| 夜の勢力 | 協力11×PC人數｜體能，王戰、需連續n回 | 沿用王戰 pipeline，額外用「夜の勢力決定表」（1D6，6列）決定敵人＋戰鬥類型（ザコ/ボス）＋n回。**連續n回機制**：新增 `trig.requiredRounds`／`trig.completedRounds` 欄位，每次擊敗後若 `completedRounds < requiredRounds` 立即重新指派同一隻敵人滿血再戰一次（無 interval），直到達成 n 回才視為撃破、發放潛在力量★★＋夜の恩寵（新增角色欄位 `_nightBlessing:true`，供技藝冷卻邏輯查詢：有此旗標時技藝改用「祝福於休息」才回復，但 midnight 冷卻是計時制非規則書「使用次數」制，這點需要在實作階段跟你確認技藝冷卻機制如何對應「夜之恩寵」——先記錄為已知待確認項，見 §9 風險清單） |
| 虫の大量発生（蟻の大量発生變體） | 協力12×PC人數｜體能 | 只讀到部分原文（見下方風險備註），依既有「地面の蟲たち」分支結構，比照隕石/夜之勢力模式重用王戰/雜兵戰鬥 pipeline，具體判定與獎勵待實作階段完整讀取 `event_rulebook.js` 該分支全文後定案 |
| 発狂地帯 | 未讀取到具體原文 | 待實作階段讀取 `event_rulebook.js` 該分支完整內容後設計（目前僅確認決定表有此項、僅限劇本3/5/8/9） |
| 襲撃 | 依「襲擊事件決定表」查表決定敵人（含劇本篩選重擲，格式同強敵決定表） | 沿用強敵決定表同款查表 pipeline（`rollStrongEnemyTable` 風格），決定敵人後走王戰/雜兵戰鬥 pipeline |

### 8.3 劇本篩選（呼應第9項）

`event_rulebook.js` 的「隨機事件決定表」本身多筆條目帶「※僅限劇本X」重擲條件（隕石限
1/2/7/8，歩く霊廟限4/7/8，夜の勢力限1/4/6，蟻の大量発生限4/5/9/10，発狂地帯限3/5/8/9）——
`rollRandomEventTable()` 已經內建這個重擲邏輯，**只要正確傳入 `scenarioNumber` 就自動生效**，
不需要 midnight.js 額外處理。

---

## 9. 已知風險與待確認項（實作階段需注意）

1. **夜の勢力「夜の恩寵」如何對應 midnight 的技藝冷卻制**：規則書原文是「技藝改用『祝福での
   休息』回復使用次數」，但 midnight 技藝是 180 秒計時冷卻制（非使用次數制），兩者機制不同。
   實作前需要跟你確認：是否單純解讀為「該角色的技藝冷卻在下次使用祝福籌碼時強制清零」（利用
   既有祝福機制），還是需要新的角色旗標邏輯。
2. **虫の大量発生／発狂地帯**：目前只確認了分支存在、部分判定文字，完整內文尚未在本次調查中
   讀取（`event_rulebook.js` 該區塊很長，需要在實作階段完整讀取後才能定案細節，不影響其餘 8
   個分支的設計與開發順序）。
3. **bargainReveal 的「□」數值自動套用範圍**：§3.6 提到部分效果文字可用既有 □ 解析工具自動
   套用，部分（有生命週期限制、或需要玩家二次選擇的）只能留文字紀錄——實作時需要逐條 6 個
   deals 檢視文字才能決定哪些可以真正結構化。
4. **「立即進入」按鈕的濫用防呆**：目前設計沒有限制「立即進入」只能按一次或設冷卻，理論上
   可以被連續按（但因為只是把 `inviteDeadline` 往前提，重複按沒有額外效果，不算 bug，僅記錄
   於此供實作時留意是否要加簡單的按鈕 disable）。

---

## 10. 驗證方式

沿用 CLAUDE.md §4 既有流程：`python generate.py` → 本機 server → Playwright（多分頁模擬
2~3 名玩家）驗證：
1. 板塊樓層：邀請/立即進入/投票即時分布/全員投完立即判定/中途加入/落後獎勵領取，各自建立
   最小重現場景驗證。
2. 分歧變體：固定 `meta.mapSeed`＋固定劇本，驗證同一劇本重複開局時同一 rank 卡牌選到的變體
   具一致性（決定性）。
3. 獎勵清單：背包滿提示、固定數量共享池搶先、潛在力量雙抽二選一、戰技重抽鍛造台 UI、GM 判斷
   類自動套用（含 bargainReveal 六選一）。
4. 魔術師塔：猜數字/邏輯題各測一輪。
5. 商人鍛造石消耗。
6. 強敵⑧恐るべき強敵：固定 seed 驗證 Day2 挑選出的點確實套用高倍獎勵。
7. 隨機事件：針對聖甲蟲/隕石/夜之勢力/歩く霊廟優先驗證（機制較完整），虫の大量発生/発狂地帯
   待內文補齊後再測。
