# 劇本1敵人＋全角色技能：未結構化招式調查與實裝紀錄（2026-08-11）【已結案】

本文件記錄一次全面調查：劇本1「三首獸」的敵人（固定王 gladius ＋4隻強敵）與全部
角色類型（含黎明／暗影變體），在戰鬥機制中「有明確可計算的傷害／Guard削り值／
屬性或狀態異常數值，但程式尚未結構化、GM必須自行讀規則書手動套用」的招式與遺物
效果，並記錄本次實裝的內容、判斷依據，以及刻意不實裝的已知限制。

調查方法：先閱讀 `docs/enemy_damage_rules.md`／`docs/combat_flow_rules.md` 確認
符號規則（`□`/`▲`/`◆`/`■`）與傷害套用優先度，再對照 `enemy_auto_gm_data.js`／
`boss_auto_gm_data.js`（敵人）與 `night.js`／`character_drawer.js`（PC技能）的
既有結構化管線，逐一比對規則書原文與程式碼是否一致。

---

## 一、劇本1敵人（gladius + 4隻強敵）

結論：**幾乎全部已正確結構化**，僅發現1組遺漏。

- gladius、鈴玉狩獵、樹衛兵＆王都的騎兵、忌鬼：全部招式的傷害與目標規則皆已
  結構化（`boss_auto_gm_data.js`／commit `19a1b42`）。屬性附加值皆為`1D`/`2D`
  骰子形式，依全庫慣例由GM擲骰後手動輸入，不算未結構化。
- 亞人的女王＆亞人的劍聲：2招的固定屬性值（非骰子）被誤判為「數值未確定」而
  遺漏——「結晶散彈＆劍聖間距」（roll 3~4，亂戰傷害修正－120之外還有固定
  「魔:2」，`enemies_data_3.js:1817`）與「咆哮＆抓握攻擊」（roll 7~8，個別
  傷害240之外還有固定「魔:2」，`enemies_data_3.js:1837`）。

**實裝**：`enemy_auto_gm_data.js`為上述2招新增`elementAccum:[{label:"魔",amount:2}]`；
`night.js`的`handleAutoGmRollClick`新增`elementAccum`/`ailmentAccum`解析，延後到
GM於`#enemy-damage-modal`按下該PC的［確定］才真正寫入
`state.battle.attributeStatus.received`（`state.battle.pendingDefenseElementAccum`
暫存欄位，與HP損害同一「先算出、後確定」設計）；`auto_gm.js`本身未修改。

已知限制：其餘招式的`1D`/`2D`屬性附加值，維持全庫「GM手動擲骰、App不猜測」慣例。

---

## 二、全角色技能

依角色類型列出本次發現並實裝的項目：

- **追跡者**：新增`TRACKER_ASSAULT_WEDGE_QUICK_ENTRY`fake entry，讓tracker_dark
  「技藝強化（速擊）」可將「襲擊之楔」任選作「速擊」使用（共用`entry.id:"assault_wedge"`
  使用次數池，`quickVariant:true`旗標排除雙重▲判定；「戰鬥結束時額外回復1次」
  無對應生命週期機制，改留提醒文字）。
- **守護者**：修正guardian／guardian_dawn「技藝強化（HP回復）」同名不同本文
  被誤套用同一效果的bug（已依`c.typeId`區分）；實裝guardian_dawn「技能強化
  （防禦支援）」（旋風發動時全體+10 HP價值直到結束階段，沿用
  `_guardValueBonusUntilEndPhase`）。已知限制：「斧槍旋風」（+10亂戰傷害）
  本文寫「自身產生的亂戰傷害」，與全庫「亂戰傷害＝敵人→PC」慣例矛盾，語意
  需使用者確認後才實裝（**此項目已於後續對話中由使用者確認並實裝**：確認為
  「僅使自身受到的亂戰傷害個人分＋10」，見下方「最終進度」）。
- **鐵之眼**：蓄力攻擊「習得2個以上+10」改為實際檢查數量（新增
  `countLearnedActionRelicsByName`helper）；補上「後衛戰術」戰技/魔術+5部分
  （消耗品+5部分**已於後續對話中補上**，見下方「最終進度」）；「技藝強化
  （毒箭）」固定猛毒:8已實裝；修正iron_eye_dark「狀態異常達成的歡喜」zh
  字序bug導致選擇UI查表失敗。
- **淑女**：致命一擊「習得2個時+20並HP/FP各+1」已實裝；lady_dawn「攻擊連續時
  HP回復」對稱新增（比照既有FP版）。
- **無賴漢**：ruffian_dark「技能強化（敵人弱化）」-120已比照「圖騰・史黛拉」
  -300處理方式（旗標+提醒橫幅，**兩者皆已於後續對話中改為自動扣減**，見下方
  「最終進度」）；「技藝強化（堅陣）」+20 HP價值（上限100）已實裝。
- **復仇者**：「家族共鬥」戰技/魔術/祈禱+10已補上；「2Hit攻擊的達人（復仇者
  的咒爪）」+10復歸傷害因無單一PC目標追蹤機制，僅加提醒注記；avenger_dark
  靈體消滅瞬間HP/FP+2已實裝。
- **隱者**：冷氣風暴固定凍傷:2已修正；hermit_dawn三個混成魔法變化技能
  （橫掃雷擊/雷炎戰車/重力爆發）原本完全未接入UI，已新增
  `HERMIT_DAWN_HYBRID_MAGIC_ACTION_VARIANTS`（雷炎戰車固定火:3+雷:3一併結構化）。
- **執行者**：executor_dark「妖刀解放・癒」原本因與base版撞名完全無法選取，
  已新增對稱`EXECUTOR_YOTO_RELEASE_HEAL_*`entry組並接入所有比對點。
- **學者**：scholar_dark「技能強化（衝擊波的緩和）」（探求可代替迴避，HP價值
  100）已實裝；5個通用消耗品的scholar_dark版+1 HP回復已補上。
- **送葬人**：undertaker_dawn「祈禱輔助強化火力提升」修正雙重bug——未限定
  觸發條件即無條件套用武器加成、戰技/魔術/祈禱+10從未捕捉（新增
  `c._prayerFirepowerActive`旗標）；「技藝強化（HP回復）」目標PC選單已補上；
  「衝刺攻擊」習得2個以上+15已實裝。**送葬人LV1被動「力量感應」已於後續對話
  中確認為正確實裝**，並將0消耗「不祥一擊」改為逐項複製顯示（見下方「最終
  進度」）。

---

## 三、未實裝／刻意保留手動處理的項目（彙整，撰寫本文件當下狀態）

| 項目 | 原因 | 現況（見下方最終進度） |
|---|---|---|
| guardian_dawn「斧槍旋風」PC自身產生亂戰傷害+10 | 與「亂戰傷害＝敵人→PC」慣例矛盾，需使用者確認語意 | ✅ 已確認並實裝 |
| iron_eye「後衛戰術」消耗品傷害+5 | `applyConsumableEffect`改動面過大，優先度較低 | ✅ 已補上 |
| ruffian系「圖騰・史黛拉」/「技能強化（敵人弱化）」自動扣減 | 原僅提醒橫幅，數值由GM手動套用 | ✅ 已改為自動扣減 |
| avenger「2Hit攻擊的達人（復仇者的咒爪）」復歸傷害+10 | 無單一目標追蹤機制，僅提醒注記 | 維持現狀（設計限制） |
| 全部`1D`/`2D`骰子屬性/異常附加值 | 全庫慣例：需GM實際擲骰才能定值 | 維持現狀（設計慣例） |

## 四、修改檔案清單

- `static_src/night.js`：`handleAutoGmRollClick`（elementAccum解析）、
  `handleEnemyDamageConfirmForCharacter`（延後套用）、`defaultBattleState`／
  `loadBattleState`（新state欄位）、`computeSkillDamage`（多個flatBonus）、
  `renderCombatSkillAction`／`renderCombatDefenseAction`（多個fake entry
  注入點）、`renderCombatSpecialAttackActions`／`renderFatalStrikeAction`
  （習得數量判定）、`applyConsumableEffect`（5個消耗品+1）。
- `static_src/character_drawer.js`：新增`countLearnedActionRelicsByName`、
  `relicEffectAppliesTo`新增2個具名條件、`RELIC_CHOICE_CONFIG_BY_NAME`新增
  1個別名key。
- `static_src/enemy_auto_gm_data.js`：亞人的女王＆亞人的劍聖2招新增
  `elementAccum`。
- `site_src/i18n_data_{zh,ja,en}.py`：新增約10個對應的三語系UI文字key。

## 五、驗證方式

本機環境無node.js，無法用`node --check`。改用：自訂括號平衡掃描（排除字串/
註解）確認修改檔案的`(){}[]`配對與修改前一致；`py -3 generate.py`建置成功；
Playwright載入admin／night／characters／admin/scenarios四頁確認零`pageerror`
且新增匯出函式存在。

**尚未做的驗證**：逐一為每個角色類型建立測試角色、進入實際戰鬥並操作新增的
UI選項（例如實際點擊「妖刀解放・癒」按鈕、選擇「速擊」變體等）從未執行過。

---

## 最終進度（封存時補記，2026-08-13）

此文件已於封存時確認狀態為「已結案」。本次僅為文件搬遷＋精簡，**未做任何新的
程式碼變更**——以下記錄的是本文件結案後、在後續對話中另外完成的追蹤事項，
供未來查閱時知道最新狀態：

1. **guardian_dawn「斧槍旋風」**（原§三未實裝項目）：已由使用者確認語意為
   「僅使自身受到的亂戰傷害（分割後個人份）＋10」，並已實裝（觸發於斧槍
   2Hit攻擊×2或蓄力攻擊，`c._halberdWhirlwindActive`旗標，於
   `handleEnemyDamageConfirmForCharacter`確定時套用）。
2. **iron_eye「後衛戰術」消耗品傷害+5**（原§三未實裝項目）：已補上
   （`applyConsumableEffect`內5個造成直接數值傷害的消耗品，於自身位於後衛時
   +5）。
3. **ruffian系「圖騰・史黛拉」/「技能強化（敵人弱化）」**：原僅提醒橫幅、
   數值由GM手動扣減，已改為透過`state.battle._nextDefenseMeleeDmgReduction`
   累加、於`handleAutoGmRollClick`自動扣減，不再需要GM手動套用。
4. **送葬人LV1被動「力量感應」**：確認已正確實裝（其他PC使用技藝時累積
   0消耗「不祥一擊」使用權，且該0消耗使用本身不會再次觸發連鎖）；UI呈現
   方式已從「1個按鈕+剩餘次數」改為每累積1點即複製1整列技藝，並加註
   「（0消耗）」。
5. §五「尚未做的驗證」（逐class實際UI互動測試）**仍然成立**，不可誤認已
   完成——本機環境仍無Node.js，僅能以建置成功＋語法/括號平衡掃描把關。

後續的武器/夜渡技能/魔術/祈禱結構化調查（`docs/weapon_skill_structuring_survey.md`
與 `docs/weapon_skill_structuring_difficult_items.md`）是另一次獨立調查，
方法相同但範圍不同，不併入本文件。
