# midnight（即時制擴張版）遺物效果生效狀況稽核

本文件整理 `static_src/character_types.js` 的**遺物效果**（`type.relicEffectGroups`）在
`midnight.js`（即時制）中「會不會真的發動」，以及尚未接上的缺口。

- 建立日期：2026-09-10（使用者要求「整理 midnight 中所有遺物效果會發動的效果」）
- 資料範圍：20 個角色類型（10 種基本＋10 種暗黑／黎明變體），共 **353 筆**遺物效果
  （Passive 302、Action 51）。
- 調查方法：①以效果名稱（ja／zh）反查 `midnight.js` 原始碼；②以**呼叫可達性分析**
  找出「midnight 直接或間接會執行到、且會讀取 `c.learnedRelicEffects` 的
  `character_drawer.js` 函式」；③以規則本文的措辭分類剩餘項目。
  分析腳本保存在 `tools/midnight_check/relic_effect_audit.js`（純 node，可重跑）。

**重要限制**：本文件是「機制層級」的稽核，不是逐條 353 筆的逐一實測。
第 2 節列出的路徑是實際核對過原始碼確認的；第 3 節的分類統計是依規則本文措辭自動歸類，
個別條目仍可能歸錯類，實際修改某一條效果前請直接核對該條的規則本文與對應程式碼。

---

## 1. 結論摘要

**2026-09-12 更新：353 筆遺物效果已全數接上生效路徑（未接上 0 筆）。**
（可用 `npm run audit:relic_gaps` 重新產生 `docs/midnight_relic_effects_gaps_by_type.md` 確認。）
依生效路徑分類：

| 分類 | 筆數 |
| --- | --- |
| midnight.js 直接以名稱判斷 | 289 |
| 通用被動解析（威力補正／最大HP・FP／判定骰） | 37 |
| 2Hit攻擊的達人（消耗覆寫，冷卻10秒） | 16 |
| `variantEntry`（角色面板／戰鬥中可切換的替代招式） | 10 |
| CharacterDrawer 內建（發現力＋） | 1 |
| **尚未接上** | **0** |

實作批次：2026-09-10（聖杯瓶回復量提升、學習能力）→ 09-11（2Hit攻擊的達人、共通17項＋
10個基本角色專屬）→ 09-12（暗黑／黎明變體與剩餘 25 筆）。各批的數值與注入位置見
`docs/midnight_realtime_combat_numbers.md` §15〜§18。

**仍有兩條是「邏輯已備妥但實際上不會觸發」，不是漏做**：
- 靈體消滅時 HP／FP 回復：midnight 沒有任何會扣減靈體 HP 的路徑（靈體只會攻擊、不會被打）。
- 防禦成功時（異常狀態／屬性）蓄積無效：midnight 本來就只在「完全命中」時才累積，
  防禦成功時本來就不會蓄積，此效果已被既有行為涵蓋。

**以下第 2～4 節是 2026-09-10 第一次稽核當下的紀錄，保留作為「當時的狀況與判斷依據」**；
其中 §4.1（Action 類）·§4.3（2Hit 達人）·§4.4（技藝／技能強化）·§4.6（聖杯瓶）
都已在 2026-09-11 那一批實作完成，見 §5b。

---

## 2. 目前確實會發動的 5 條路徑

### 2.1 midnight.js 直接以名稱判斷

`midnight.js` 只對 5 個效果名稱做了專屬處理（其餘同名條目分散在 20 個角色類型上，
合計 51 筆）：

| 效果名稱 | kind | midnight 生效位置 |
| --- | --- | --- |
| 跳躍攻擊 | Action | `availableSpecialAttackEntries()` ／ `handleAttackClick()`（長按攻擊鍵的特殊攻擊選單） |
| 衝刺攻擊 | Action | 同上 |
| 雙手持握的達人 | Passive | `currentGuardInfo()`（單手持武器也能取得防禦價值） |
| 冰塊之棺 | Passive | `handleDodgeClick()` |
| 聖杯瓶回復量提升 | Passive | `commitFlaskHeal()`（**2026-09-10 本次新增**，見 §5） |

### 2.2 威力補正（`relicPowerModBonus` → `computeArtPower`）

規則本文形如「將自身『力量』的威力補正設為『+5』」的 **15 筆**。
`midnight.js` 的 `computeMidnightSkillDamage()` 與 `computeSideAttackInfo()` 都會呼叫
`CharacterDrawer.computeArtPower()`，該函式內部呼叫 `relicPowerModBonus()`，
因此這類效果會同時反映在一般攻擊、武器戰技、魔術／祈禱的傷害上。

### 2.3 最大 HP／FP（`relicFlatMaxStatBonus` → `totalFlatMaxStatBonus`）

規則本文含「最大HP」「最大FP」的 **11 筆**。midnight 的 `selfArenaHpMax()` ／ `selfFpMax()`
都是「基礎值 +（角色上限 + `totalFlatMaxStatBonus()`）× 10」，該 helper 內部會加總
裝飾品／遺物／附帶效果三套 bonus（CLAUDE.md §12），因此遺物的最大值加成有效。

### 2.4 判定骰數（`getCheckStatBonus`）

規則本文形如「將自身『精神：+1』」的**學習能力（精神／運氣／體能）**共 **11 筆**。
**2026-09-10 本次新增**：先前 midnight 的 7 處判定（聖甲蟲／女神像／靈廟／蟲群／追逐／
埋藏寶物協力判定／通用步驟判定）全部只讀 `type.checkValues`，這個遺物效果完全不生效。
已改為共用 `effectiveCheckDiceCount(c, statKey)`（內部呼叫
`CharacterDrawer.getCheckStatBonus()`，與 `night_floor_breakthrough.js` 的
`effectiveCheckValue()` 同一套算法），角色視窗顯示的判定值也改用同一來源。

### 2.5 武器傷害內建的遺物判斷（`computeWeaponDamage`）

`CharacterDrawer.computeWeaponDamage()` 內部本身就會讀遺物效果（例如與武器種類連動的
加成），midnight 的一般攻擊與武器詳細資訊都經過它，因此這部分沿用 night.js 的既有行為。

---

## 3. 呼叫可達性分析結果（機制層級的確定事實）

`character_drawer.js` 中會讀取 `c.learnedRelicEffects` 的函式共 **29 個**。
以 midnight 直接呼叫的 53 個 `CharacterDrawer.*` 為起點做傳遞閉包（可達 100 個函式）後：

**midnight 執行得到（19 個）**：
`relicPowerModBonus`、`relicFlatMaxStatBonus`、`computeWeaponDamage`、
`findLearnedRelicEffectByName`、`findLearnedActionRelicByName`、
`countLearnedActionRelicsByName`、`countLearnedRelicEffectsByName`、`getCheckStatBonus`、
`getFlaskHealBonus`、`getSkillUsesBonus`、`getEquippedWeaponSkillEntries`、
`attachedEffectAppliesTo`、`potentialPowerDrawWeapon`、`relicCandidateFor`、
`relicAllUnlearned`、`relicEffectForKey`、`learnRelicEffect`、`renderAbilitySections`、
`newCharacter`

**midnight 完全執行不到（10 個）**：
`findTwoHitMasteryOverride`、`getPassiveAggroBonus`、`getCombatSkillEntries`、
`autoResolveWeaponDraw`、`handleRelicRoll`、`renderRelicSection`、`renderRelicCandidates`、
`renderRelicLearnedList`、`renderRelicAllList`、`init`

後 7 個是 night.js 的角色卡／戰鬥視窗 UI，midnight 有自己的對應介面，不算缺口。
真正的缺口是前 3 個，見 §4.3／§4.5。

---

## 4. 尚未接上的缺口與原因

### 4.1 Action 類遺物（26 筆）

midnight 的長按攻擊選單（`availableSpecialAttackEntries()`）**只接受跳躍攻擊與衝刺攻擊
兩個名稱**，其餘 Action 類遺物（蓄力攻擊、致命一擊等）沒有任何發動入口。
補實作的方向應該是把該選單改成「列出所有已習得的 Action 類遺物」，
但每個效果的消耗與傷害本文格式不一，需要逐一確認能否用既有的
`computeMidnightSkillCost()` ／ `fixedSkillPowerValue()` 解析，**不宜一次全開**。

### 4.2 回合制概念（112 筆，最大宗）

例：「回合結束時，體力骰帶入1個」「防禦階段開始時體力骰回復」「前衛時…」。
即時制沒有階段／回合／體力骰／前衛後衛，這些效果在規則結構上就不成立。
`static_src/midnight_text_adapt.js` 已經對其中 3 個做了「本規則中不生效」的重點覆寫
（`BODY_OVERRIDES`），其餘只做術語轉換。
**建議**：需要的話擴充 `BODY_OVERRIDES`，讓玩家在角色視窗就看得出哪些效果在即時制無效，
而不是預設全部沉默失效。

### 4.3 攻擊消耗變更（22 筆）— **2026-09-11 已實作**

「2Hit攻擊的達人（大劍）＝將『大劍』的2Hit攻擊消耗變更為『45』」這類效果，
`character_drawer.js` 已有現成的 `findTwoHitMasteryOverride(c, category)`，night.js 也
已接上（`night.js:4484`），但 midnight 的 `computeSideAttackInfo()` 原本只用
`parseAttackCost()`，完全沒有查這個 override。

**使用者 2026-09-11 明確規格**：規則書的「此效果1個階段中僅能發揮1次」＝即時制的
**冷卻 10 秒**。已依此實作（見 §5 與 `midnight.js` 的 `twoHitMasteryPoints()`）。

實作時遇到的一個換算問題，處理方式一併記錄於此：規則書的「消耗」是骰子出目組合
（例：②③＝手上有 2 跟 3 這兩顆骰子就能支付），回合制的 night.js 因此把它做成
**GM 可切換的「另一種付法」**，因為在骰池裡「用哪幾顆骰子」比「總點數多寡」更重要。
midnight 沒有骰池，出目總和直接 ×2 換算成體力，這個「另一種付法」就退化成單純的點數比較。
逐筆換算後，13 筆中有 2 筆反而更貴：

| 效果 | 對象 | 基本消耗 | 覆寫後 |
| --- | --- | --- | --- |
| 鐵眼「2Hit攻擊的達人（弓）」 | 1Hit | ③＝3 點 | 「23」＝5 點（更貴） |
| 淑女「2Hit攻擊的達人（短劍）」 | 2Hit | ①①＝2 點 | 「6」＝6 點（更貴） |

規則書把這個遺物寫成好處（淑女那條原文是「**可**將…變更為」），若無條件套用會變成
「習得有益的遺物反而多扣體力」。因此實作上採「**只有換算後更便宜時才發動**」，
變貴時視為不發動、也不消耗冷卻。**這是即時制換算下的取捨，不是規則書本身的但書**；
若之後確認要無條件套用，只需拿掉 `twoHitMasteryPoints()` 裡 `mastery.value < basePoints`
那一行比較。

另外，復仇者「2Hit攻擊的達人（復仇者的咒爪）」的本文指的是**特定武器名**而不是武器分類，
`findTwoHitMasteryOverride()` 是以分類名比對，因此這一條在 night.js 與 midnight 都不會
發揮——這是既有的上游限制，本次沒有一併處理。

### 4.4 角色技藝／技能強化（15 筆）

例：「為技藝『襲擊之楔』對敵人的傷害追加『總合傷害：+50』與『火：3D』」。
這類效果要在 `useCharacterAbility()` 的傷害結算點依「被強化的技藝名稱」加成。
機制上可行（`computeMidnightAbilityDamage()` 已經是單一出口），
但每條效果的加成內容不同（固定值／屬性蓄積／回復），需要逐條確認，屬於中等規模工作。

### 4.5 敵視（`getPassiveAggroBonus`）

規則書的敵視是回合制的固定值機制；midnight 的敵視是「對這隻敵人累積傷害最高者」
（`fieldTrigger/{id}/damageBySlot`）。兩者刻度不同，把遺物的敵視加成折算成「傷害累積量」
需要使用者指定換算率，不自行發明。

### 4.6 聖杯瓶其他效果（24 筆中除回復量提升外）

例：「聖杯瓶可回復FP」（改為回 FP 而非 HP）、「一口氣飲盡」（一次用掉多次數、回滿）。
兩者都需要新的 UI 選擇（要回 HP 還是 FP／要不要一口氣喝），
不是單純的數值加成，因此本次未實作。

---

## 5. 2026-09-10 本次已補實作的缺漏

| 效果 | 先前狀況 | 修正 |
| --- | --- | --- |
| 聖杯瓶回復量提升（24 筆中的 8 筆） | midnight 固定回 30，完全不看遺物 | `commitFlaskHeal()` 改為 `FLASK_HEAL_AMOUNT + flaskHealBonusAmount(c)`，□→即時制數值沿用既有 `BLOCK_SQUARE_COUNT_TO_RESOURCE_MULT`（＝10），與 night.js `night.js:7075` 同一份 `getFlaskHealBonus()` |
| 學習能力（精神／運氣／體能）（11 筆） | 7 處判定全部只讀 `type.checkValues`，加成無效 | 新增 `effectiveCheckDiceCount(c, statKey)`，全部 7 處與角色視窗顯示改用它，內部呼叫既有 `getCheckStatBonus()` |

兩者都是「規則書寫明的無條件被動 ＋ 既有 helper 已經寫好解析」的情況，
沒有新增任何自行推測的數值。

### 2026-09-11 追加：2Hit攻擊的達人（22 筆中實際可發揮的 13 筆）

| 項目 | 內容 |
| --- | --- |
| 使用者規格 | 規則書「此效果1個階段中僅能發揮1次」＝**冷卻 10 秒**（`TWO_HIT_MASTERY_COOLDOWN_MS`） |
| 消耗覆寫 | 沿用 `CharacterDrawer.findTwoHitMasteryOverride()`，不重新解析規則本文 |
| 1Hit／2Hit 的判別 | 該 helper 新增回傳 `hitType`（鐵眼「2Hit攻擊的達人（弓）」效果名是 2Hit 但本文改的是 1Hit 消耗）。night.js 只用 `value`／`label`，行為不變 |
| 發動條件 | 對應的 hit 類型 ＋ 冷卻結束 ＋ 換算後更便宜（理由見 §4.3） |
| 冷卻儲存 | `character/{tokenId}/_twoHitMasteryCooldownUntil`，比照既有的 `_skillCooldownUntil` |
| 提示 | 發動時 `showToast()` 顯示效果名與變更後的消耗表記 |
| 回歸測試 | `tools/midnight_check/relic_two_hit_mastery_check.js`（`npm run test:relic_two_hit_mastery`），4 個斷言 |

---

## 5b. 2026-09-11 第二批：大量遺物效果接入

使用者 2026-09-11 提出的清單（共通 17 項＋10 個基本角色的專屬效果）已全數實作，
詳細的數值與注入位置見 `docs/midnight_realtime_combat_numbers.md` §17。
這一批另外發現兩個先前稽核誤判為「未接上」、實際早就能用的機制：

- **`variantEntry`**：隱者「混成魔法」的 4 種變體（漩渦烈焰／聖光燈火／聖幕／冷氣風暴）、
  執行者「妖刀解放・攻」、隱者「冰塊之棺」等，早就透過 `learnedVariantEntries()` 與角色面板的
  招式切換接上了（傷害由本文的【總合傷害：N】解析）。這一批只補上它們「傷害以外」的部分
  （屬性蓄積、雜兵傷害、聖幕的免FP消耗、聖光燈火的雙人回復）。
- **發現力＋**：`CharacterDrawer.potentialPowerDrawWeapon()` 內部本來就有判斷，而 midnight
  會呼叫該函式，因此一直是生效的。

稽核腳本（`relic_effect_audit.js` / `relic_effect_gaps_table.js`）已同步把這兩類與
「2Hit攻擊的達人」列為已生效。統計從「245 筆未接上」降到 **25 筆**，
且剩下的幾乎都是使者清單沒有列到的暗黑／黎明變體專屬效果。

---

## 6. 後續建議優先序

1. **§4.3 的 2Hit 攻擊的達人**：只差一個使用者決定（即時制的「1階段1次」等價限制），
   決定後實作量很小（`computeSideAttackInfo()` 一處）。
2. **§4.4 的技藝／技能強化**：影響玩家體感最大（直接加傷害），但要逐條確認。
3. **§4.2 的回合制概念**：不需要改數值，只要擴充 `midnight_text_adapt.js` 的
   `BODY_OVERRIDES`，讓玩家知道哪些效果在即時制不生效即可。
4. **§4.1 的 Action 類遺物**：逐一確認消耗／傷害本文能否被既有 parser 解析。
