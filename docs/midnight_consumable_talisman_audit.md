# midnight（即時制擴張版）消耗品／裝飾品生效狀況稽核

本文件整理 `static_src/consumables.js`（18 項消耗品）與 `static_src/talismans.js`
（60 項裝飾品／護符）在 `midnight.js`（即時制）中「會不會真的發動」，以及尚未接上的缺口。
格式比照 `docs/midnight_relic_effects_audit.md`（遺物效果稽核）。

- 建立日期：2026-09-11（使用者要求「整理消耗品、裝飾品的實作效果」）
- 更新日期：2026-09-12（使用者逐項給出即時制規格後，**全部接上**，見 §5 實作批次）
- 回歸檢查：`cd tools/midnight_check && npm run test:consumable_talisman`（純 node，不需 Playwright）
- 調查方法：①以 itemId／護符 id 與 ja／zh 名稱反查 `midnight.js`；②追出 midnight 實際呼叫的
  `character_drawer.js` helper（`computeWeaponDamage`／`computeArtPower`／
  `totalFlatMaxStatBonus`／`talismanFlatSkillBonus`／`weaponAccumulationEffects`），
  再核對這些 helper 內部到底讀了哪些護符；③對未命中的條目以規則本文措辭分類原因。
- **重要限制**：這是「機制層級」的稽核與實作紀錄，不是 78 條逐一實測。回歸檢查驗證的是
  「接線存在」與少數關鍵數值常數，實際數值仍需在瀏覽器實際操作驗證；動工改某一條前
  請直接核對該條規則本文與對應程式碼。

**欄位上限**（`midnight.js:278-279`）：消耗品 4 格、裝飾品 2 格。裝飾品沒有「裝備」動作，
持有即生效（角色面板顯示 `midnight_talisman_always_active_note`）。

---

## 1. 結論摘要

**2026-09-12 更新：消耗品 18 項、裝飾品 60 項已全數接上生效路徑（未接上 0 筆）。**
本節以下保留 2026-09-11 首次稽核的分類結構，作為「當初缺什麼、怎麼補的」對照；
各條目實際的即時制數值與注入位置見 §5。

| 類別 | 首次稽核（09-11） | 現況（09-12） |
| --- | --- | --- |
| 消耗品 完整生效 | 8 | **18** |
| 消耗品 未接上 | 10 | **0** |
| 裝飾品 完整生效 | 12 | **60** |
| 裝飾品 部分生效 | 4 | **0** |
| 裝飾品 未接上 | 44 | **0** |

其中 4 處的判定基準是即時制沒有對應概念時的取捨（不是遺漏），見 §5.6。

---

## 2. 首次稽核（2026-09-11）的缺口分類

以下是 09-11 當時的盤點，保留原文供對照。每一組後面標註 09-12 的處理方式。

### 2.1 消耗品

- **已自動套用（6）**：星光的碎片、溫石、蒼火的投擲刀、骨毒投擲箭、火花之香、毒之噴霧。
- **持有即生效（2）**：石劍鑰匙（封牢進入權）、鍛造石（鍛造台費用）。
- **當時未接上（10）**：勇者的肉塊／高揚之香／酸之噴霧／鐵壺之香藥／塗脂（皆為「直到階段
  結束」buff）、龜首漬（體力骰）、扇投暗器／投擲壺（需擲骰）、投擲短劍（▲）、苔藥
  （需自身異常蓄積資料）。
  → **09-12 全部實作**，見 §5.2。

### 2.2 裝飾品

- **A 組 承受屬性／異常減免（10）**：頑健／免疫／正氣／斑色的角飾、死亡王子的懷袋、
  雷／炎／魔力／聖／珍珠龍紋章。→ §5.3
- **B 組 PC 防禦「HP 價值」（5）**：龍印盾紋章、大盾護符、樹幽羽護符、捧鬮之盾、
  青紫的七支刃。→ §5.3
- **C 組 固定傷害加成（4）**：戰士之壺碎片、魔術師球護符、信徒的誓布、友伴之壺。→ §5.3
- **D 組 遺物動作的追加傷害／回復（6）**：彎劍護符、爪之護符、斧之護符、青／綠／短劍的
  凶刃。→ §5.3
- **E 組 體力骰（4）**：綠琥珀勳章、綠龜護符、大山羊護符、憐憫的雫滴。→ §5.4
- **F 組 消耗轉換（4）**：卡利亞徽章、原輝石之刃、拉塔岡的肖像、戈弗雷的肖像。→ §5.4
- **G 組 階段／回合生命週期（2）**：神肌的襁褓、古王護符。→ §5.4
- **H 組 觸發型回復（4）**：掠奪的浮雕、精靈之角、血之君主的歡喜、廢散者的歡喜。→ §5.4
- **I 組 消耗品／獎勵相關（4）**：調香師的護符、緋色種子勳章、金聖甲蟲、銀聖甲蟲。→ §5.3
- **J 組 無通用機制（1）**：咆哮遺物勳章。→ §5.5
- **部分生效需修正（4）**：大槌護符（▲沒轉成傷害）、貪婪者的烙印（盧恩沒接）、
  捧鬮之劍與赤羽的七支刃（HP 刻度錯誤）。→ §5.1

---

## 3. midnight 既有機制的確認結果（2026-09-12 檢查）

### 3.1 掉落物（丟棄／撿取）

**原本就已完整運作**，不需要新增機制：角色面板丟棄 → `dropInventoryItem()` 在自己座標
建立 `groundItems/{id}` → 地圖上畫閃爍黃光點（`drawGroundItemMarker()`，W/T/C 字樣）→
靠近 `GROUND_ITEM_PICKUP_RADIUS` 內，左上 HUD（隊友血條下方）彈出提示與撿取鈕，
`pickedUpBy` 的 first-writer-wins transaction 避免兩人同時撿到同一個。
武器／消耗品／裝飾品三類都能丟，石劍鑰匙與鍛造石是 `noStackLimit` 消耗品、撿取時合併堆疊。

**這次補的只有「詳細資訊」**：提示框原本只顯示名稱，現在加上規則本文
（`groundItemDetailText()`，同樣經過 `midnight_text_adapt.js` 轉換）、剩餘使用次數，
以及投擲壺的屬性標記。武器因為沒有單一 body 欄位，只顯示武器種類一行摘要。

### 3.2 雜兵

**原本就已存在**（2026-09-06 死靈術前置工程）：`fieldMobHp/{pointId}`，HP ＝樓層文字
「+雜兵N」的 N × `MOB_HP_PER_ROW`(=100)，單一合併血量池；攻擊一律先扣雜兵、溢出才打
敵人本體；雜兵歸零觸發復仇者的死靈術。

使用者 2026-09-12 確認**維持 N×100 公式**（不改成 L補×2），這次只補兩件事：
- **血條 UI**：`#midnight-mob-hp-row`，位置在敵人血條上排，沒有雜兵或已歸零時整列隱藏。
- **對雜兵傷害的接線**：規則書的「對雜兵 HP 損害：1」＝`MOB_DAMAGE_PER_RULEBOOK_POINT`
  ＝100（使用者確認「等於打掉 1 隻雜兵」）。

---

## 4. 三個跨條目的共用機制（這次新增）

後續要加同型效果時請掛在這三者上，不要再開第四套：

| 機制 | 位置 | 用途 |
| --- | --- | --- |
| 持續回復（HoT） | `startHealOverTime()` / `tickHealOverTime()` | 溫石的 10 秒回血。以發動者裝置的本地清單逐格寫入目標的 `demoStat`，因此對隊友也有效 |
| 消耗品時限 buff | `consumableAttackHitBonus()` / `consumableSkillDamageBonus()` / `consumableGuardBonusPct()` / `ironPotImmuneActive()` / `acidSprayDamageReduce()` | 「直到階段結束」＝10 秒（`CONSUMABLE_BUFF_MS`）。這組 helper 是唯一讀取入口，各計算點只呼叫它們 |
| 可切換護符 | `c.talismanToggles` / `talismanToggleOn()` / `appendTalismanToggle()` | 規則原文寫「**可**將…」的選擇權效果，做成角色視窗上的開關，預設關（原始消耗） |

---

## 5. 2026-09-12 實作批次

### 5.1 護符修正（4 條）

| 護符 | 修正內容 |
| --- | --- |
| 大槌護符 | 「2Hit特典：總合傷害+▲」的 ▲ 依 CLAUDE.md §18 換算成 `dmg.artPower` 加進 2Hit 傷害（原本只轉成削韌）。削韌用的 symbol 保持不變 |
| 貪婪者的烙印 | 「最大HP-2」原本就生效；補上「板塊踏破全樓層時個人盧恩+1」（`maybeGrantFullClearReward()` 內逐人判斷） |
| 捧鬮之劍 | `talismanFlatHitBonus()` 新增 `hpOverride` 參數，`computeWeaponDamage()` 把既有的 hpOverride 傳進去。原本讀 `c.hp`（midnight 從不寫），「滿血」恆為真＝無條件常駐 |
| 赤羽的七支刃 | 同一修正；門檻改由 `hpOverride.lowHpThreshold` 指定，midnight 傳 30（`LOW_HP_TALISMAN_THRESHOLD_MIDNIGHT`），night.js 不傳則沿用規則書的 3 |

### 5.2 消耗品（10 條補實作 ＋ 3 條數值調整）

數值調整（使用者明確指定）：

| 消耗品 | 新數值 |
| --- | --- |
| 星光的碎片 | FP +30 / Lv2 +60 |
| 溫石 | 自身＋**HP 最少的**其他 PC，10 秒內持續回血 +20 / Lv2 +40 |
| 蒼火的投擲刀 | 傷害 20 |

補實作：

| 消耗品 | 即時制實作 |
| --- | --- |
| 龜首漬 | 體力 +10；Lv2 追加 HP 回復 20 |
| 扇投暗器 | 10 段 × 10 點（合計 100），逐段走 `damageCombatTarget()` 以保留雜兵溢出鏈與最低傷害規則；Lv2 追加 15 |
| 投擲壺 | 屬性在**取得當下**記入 `c.consumableAttributeTags[instanceId]`（欄位規約同 night.js），使用時讀出並累積 1。未標示時預設「炎」 |
| 投擲短劍 | 0 威力的「▲」＝傷害 0、削韌照算；Lv2 追加 15 |
| 苔藥 | 清除自身**蓄積值最高**的 1 種異常狀態（沒有 picker UI 時的既有簡化慣例）；Lv2 追加 HP 回復 20 |
| 勇者的肉塊 | 10 秒內攻擊 1Hit+5／2Hit+10、戰技+5；Lv2 追加 HP 回復 20 |
| 調香瓶｜高揚之香 | 全體 PC 10 秒內同上加成 ＋ HP 價值+10；Lv2 數值 ×2。對象是全隊，因此寫在 `meta.partyUpliftUntil/Level`（比照既有的 `partyGuardBonusPct()`） |
| 調香瓶｜酸之噴霧 | 10 秒內敵人所有傷害 −12（規則書 −120 ÷ 10，見 `ACID_SPRAY_DAMAGE_REDUCE`），套用在防禦減傷百分比**之前**；Lv2 追加自身 HP 價值+10 |
| 調香瓶｜鐵壺之香藥 | 10 秒內不受 HP 損害（屬性／異常照常累積，符合規則書但書）；Lv1 代價＝立刻少 1 顆骰子份的體力 |
| 塗脂 | 有盾→盾脂（HP 價值+10，10 秒）；否則→武器脂（近戰武器追加「屬性｜炎」，10 秒）。無選擇 UI，依既有簡化慣例自動判斷 |

**已知限制**：勇者的肉塊／龜首漬／苔藥的等級 2 還有一句「最大HP：+□□，直到**戰鬥**結束」
——midnight 沒有對應的「戰鬥結束」界線（探索中隨時可能開打），因此只套用同句中可以一次
算完的「HP 回復：□□」＝+20，最大HP 部分留在 toast 的規則原文裡，不自行發明時限。

順帶修掉一個既有 bug：個人獎勵清單的 `consumable` 分支原本無視 `entry.itemId` 一律隨機抽，
導致 fields_data 裡指定品項的消耗品獎勵（例如各種屬性的投擲壺）永遠拿不到。

### 5.3 護符 A／B／C／D／I 組（29 條）

| 組 | 注入點 | 說明 |
| --- | --- | --- |
| A（10） | `recordReceivedAttributeAccum()` | 先判斷無效化（`TALISMAN_NULLIFY_RECEIVED`），再判斷 −1（`TALISMAN_REDUCE_RECEIVED`） |
| B（5） | `talismanGuardBonusPct()` → `currentGuardInfo(hitIndex)` | 「僅第1次／第2次以後」換算成敵人連擊的 `st.hitIndex`（0＝第1下）。這是即時制換算，不是規則書本身有的條件 |
| C（4） | `CharacterDrawer.talismanSkillDamageBonus()`（新增並匯出）／`companionJarBonus()` | 戰技／魔術／祈禱 +5 用與 `attachedSkillDamageBonus` 相同的 kind 分類；友伴之壺 +5 加在 5 種投擲類消耗品的傷害上 |
| D（6） | `availableSpecialAttackEntries()`（爪／斧）、`handleAttackClick()`（彎劍）、`handleExecutionClick()`（三把凶刃） | 彎劍護符的「防禦反擊使用時」＝這一擊確實吃到防禦反擊折扣，判斷條件同既有的防禦反擊強化（斧槍） |
| I（4） | `flaskHealBonusAmount()`／`applyMidnightConsumableEffect()` 的 `applyLevel2`／`goldScarabAdjusted()`／`potentialPowerDrawWeapon()` | 金聖甲蟲只掛在夜之強敵的擊破獎勵（midnight 裡符合「boss」層級的戰鬥），不套用到強敵籌碼 |

### 5.4 護符 E／F／G／H 組（14 條，使用者指定的即時制對應）

| 護符 | 即時制實作 |
| --- | --- |
| 綠琥珀勳章 | 體力 ≤20 時回復速度 +1／秒 |
| 綠龜護符 / 大山羊護符 | 體力上限各 +10 |
| 憐憫的雫滴 | 體力上限 −10，且每 10 秒回復 HP 1（絕對值） |
| 卡利亞徽章 | 角色視窗開關；開啟時戰技的 FP 消耗整筆改為 HP |
| 原輝石之刃 | 同上，對象是魔術／祈禱 |
| 戈弗雷的肖像 | 同上；開啟時魔術／祈禱多付 1 顆 1 點的體力，傷害 +10 |
| 拉塔岡的肖像 | 魔術／祈禱消耗的體力 −1（常駐） |
| 神肌的襁褓 | 5 秒內執行 2 次 2Hit → HP 回復 10（觸發後重新計數） |
| 古王護符 | 由魔術／祈禱產生的持續時間 ×2（目前 midnight 只有「祈禱火力提升」一個這類時限） |
| 掠奪的浮雕 / 精靈之角 | 總合傷害 130 以上時回 HP／FP 10，觸發後各自冷卻 30 秒 |
| 血之君主的歡喜 / 廢散者的歡喜 | 任一 PC 造成出血／腐敗蓄積時（不看有沒有跨過閾值）自身回 HP 與 FP 各 10。掛在 `onAttributeAccumReceived()`，因為 `attributeAccum` 是全隊共享狀態，天然涵蓋「任一名 PC」 |

### 5.5 咆哮遺物勳章（J 組）

全專案指名這個護符的規則本文共 **3 條戰技**：`art_war_cry`（戰吼）、`art_savage_roar`
（野蠻咆哮）、`great_weapon_kings_roar`（王的咆哮）。句型都是「直到結束階段為止，此裝備
2Hit 攻擊的總合傷害『＋X』。若自身裝備護符『咆哮的勳章』，總合傷害再『＋Y』。」

這個 buff 本身在 midnight 原本也沒有實作（`castWeaponSkillEntry()` 只算傷害，不處理戰技
帶來的持續效果），因此這次連同底層 buff 一起補上：`maybeApplyRoarArtBuff()` 解析本文取得
X（與持有護符時的 Y），「直到結束階段」＝10 秒，只對施放時那把武器有效
（`roarTwoHitBonus()`）。

採**解析本文**而不是寫死 3 個 id，之後規則資料修訂或新增同句型的戰技會自動跟著生效。
解析時必須先切掉括號註記「（合計＋10＋▲）」——那是總和的說明而不是另一筆加成，
不切會讓野蠻咆哮從 +17 變成 +34（實測發現並已修正，回歸檢查含此案例）。

### 5.6 刻意的即時制簡化（4 處）

這些不是遺漏，是即時制沒有對應概念時的取捨，之後若要改判定基準改這幾處即可：

1. **B 組的「僅第1次／第2次以後」**：換算成敵人連擊的第幾下（`st.hitIndex`）。
2. **塗脂的對象選擇**：規則書要玩家選武器或盾，midnight 自動判斷（有盾就塗盾），
   屬性固定「炎」（沿用 night.js 投擲壺未指定時的既有預設）。
3. **苔藥的異常選擇**：自動取蓄積值最高的那一種。
4. **古王護符**：midnight 目前只有一個由咒文產生的時限 buff 可以延長。

---

## 6. 回歸檢查

兩支腳本分工不同，都要跑：

### 6.1 靜態掃描（秒級，無外部依賴）

```bash
cd tools/midnight_check && npm run test:consumable_talisman
```

`consumable_talisman_check.js` 檢查三件事：
① 18 個消耗品與 60 個裝飾品每一條都有接入點（防止整條被改掉後無聲失效）；
② 咆哮系戰技的本文解析器對 zh／ja 兩種句型都算出正確數值；
③ 使用者這批明確指定的數值常數沒有被改回舊值。
判的是**接線存在**，不是數值正確。

### 6.2 實機測試（Playwright ＋ Firebase Local Emulator）

```bash
py -3 generate.py
py -3 -m http.server 8931 --directory dist
npx firebase emulators:start --only database,auth --project elden-ring-nightreign
cd tools/midnight_check && PRITEST_BASE_URL=http://localhost:8931 npm run test:consumable_talisman_runtime
```

`consumable_talisman_runtime_check.js` 真的開瀏覽器跑遊戲，透過 `midnight.js` 的 `_debug*`
入口呼叫內部函式並讀回**算出來的數值**，共 34 項斷言，涵蓋：消耗品數值（星光碎片／龜首漬／
勇者的肉塊／酸之噴霧／鐵壺之香藥／塗脂／苔藥）、A 組承受蓄積減免、B 組 HP 價值的
第1下／第2下判定、C／F 組的戰技消耗與傷害（含三個可切換護符的開／關兩種狀態）、
捧鬮之劍與赤羽七支刃的 HP 刻度修正（含「修正前的錯誤行為不再出現」的反向斷言）、
大槌護符的 ▲、咆哮系戰技 ＋ 咆哮遺物勳章、E 組體力上限、雜兵血條與掉落物詳細資訊的 DOM。

2026-09-12 實測結果：**34 / 34 通過**。

**測試腳本的已知陷阱**：midnight 的角色資料會被 RTDB 快照覆寫
（`onCharactersReceived`），而 `_debugSetTalismans()` 會 rtSet 觸發一次快照。因此
「只在本地改 `equippedWeaponIdL`」的設定會在下一個 `page.evaluate()` 之前被洗掉。
腳本用頁面上的全域 `window.__ptEquip(kind)` 在每個需要裝備的區塊開頭重新裝一次來迴避。
這是測試手法的限制，不是功能 bug——正式流程的換裝走 `setEquippedWeapon()`，本來就會 rtSet。

### 6.3 midnight.js 的 `_debug*` 測試入口

這批新增的入口（`_debugSetTalismans`／`_debugSetTalismanToggle`／`_debugApplyConsumable`／
`_debugSideAttackInfo`／`_debugSkillCost`／`_debugSkillDamage`／`_debugGuardInfo`／
`_debugRecordReceivedAccum`／`_debugConsumableBuffs`／`_debugRoarArtBuff`／
`_debugStaminaMax`）跟既有的 `_debugRecordGuardReduction`／`_debugAbsorbDamageWithSpirit`
同樣性質：把內部純函式開一個口給測試腳本呼叫，不改變正式流程。
