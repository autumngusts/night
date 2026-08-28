# 武器技能結構化：困難項目補充清單（供審閱，2026-08-13）【已解決】

本文件原列出 `docs/weapon_skill_structuring_survey.md` 調查中發現、當初判斷為
「觸發條件不明、需要新機制才能實作」的3個項目。**這3項已在後續對話中經使用者
澄清規則並全數處理完畢**，以下記錄澄清內容與最終實作方式。

---

## 1. 運命の死の加護／命運之死的加護（`colossal_fate_of_death_grace`）

`weapons_categories.js:275-281`（巨型武器「馬利卡斯的黑劍」固有被動）

使用者澄清：本文「體力骰出目若包含「□□□」」＝**三個1點**（即角色戰鬥階段
開始時初次骰出的體力骰中，出現3個以上出目為1的骰子）。「HP損害：■」的實際
數值確認為**1點**。

實作：`night.js`新增`characterHasEquippedInnateSkillId(c, skillId)`（判斷
角色目前裝備的武器中是否有指定固有技能）與`triggerWeaponGraceDiceEffect(c, skillId)`
（自動套用效果並記錄／廣播）。在`rollDiceForCharacterActionPhase`的戰鬥階段
初次擲骰邏輯中，統計本次新骰出的體力骰（不含跨回合帶入的骰子）中出目為1的
數量，若≥3且角色裝備了此固有技能：

- 目標敵人：若場上僅有1個敵人選項，自動選定；若敵人不只1個但目前的
  `combatAttackTargetEnemyKey`（跨UI共用的目前選定敵人）屬於場上敵人之一，
  沿用該選擇；否則因無法判斷目標，改為顯示提醒文字交由GM手動處理。
- 有明確目標時：呼叫既有`damageEnemyHpForKey(enemyKey, 1)`直接扣1格HP（與
  「HP損害：N」的既有處理方式一致，非除以HP價值的總合/個別傷害）。
- 同時：寫入該角色的執行紀錄（`addActionBox`）、一般行動紀錄（`addLog`）、
  並透過`postSystemTurnMessage`＋`showThreatBroadcast`即時廣播到進度版。

## 2. 絶望の加護／絕望的加護（`curved_sword_despair_grace`）

`weapons_categories.js:464-470`（曲刀固有被動）

使用者確認：機制與運命之死的加護完全相同（同一觸發時機、同一`HP損害：1`
效果、同一自動套用方式），骰子花色條件雖然本文寫的是「◎◎」，但**實際門檻
與運命之死的加護一樣，同為3個1點**（並非依符號數量類比的2個——這點已由
使用者親自確認訂正）。

實作方式與上一項共用同一組函式（`characterHasEquippedInnateSkillId`／
`triggerWeaponGraceDiceEffect`），`night.js`內`rollDiceForCharacterActionPhase`
的combat分支中，`colossal_fate_of_death_grace`與`curved_sword_despair_grace`
皆使用`freshOnesCount >= 3`判斷。

## 3. 黒王の斥力波／黑王的斥力波（`great_curved_sword_black_king_repel`）

`weapons_categories.js:517-523`（Action招式）

使用者訂正本文為：

> 消耗：②②／FP■■　對象：敵人・雜兵　編隊：前衛時可使用　威力：10＋戰技
> 威力　效果：對雜兵造成「HP損害：■■」、對敵人造成【總合傷害：威力】與
> 「魔：4」。

原本記錄的版本（消耗ゾロ（2個）、雜兵HP損害：■、且動作後還有第二段獨立的
「對敵人HP/FP損害：■」）經確認**是資料謄寫錯誤**，訂正後的版本移除了「移動
至前衛」與「動作後第二段獨立■效果」，只剩下與其他已結構化招式相同的模式：
主傷害（總合傷害：威力／魔：4）走既有`computeSkillDamage`一般路徑自動解析，
雜兵`HP損害：■■`維持原樣文字（屬於`docs/weapon_skill_structuring_survey.md`
§二「刻意保留手動處理」的常見模式，本身不是缺口，不需要額外實作）。

已修改`weapons_categories.js`內此招式的body文字（zh/ja皆同步更正），消耗從
「ゾロ（2個）」改為「②②」（丸數字加總消耗，既有`classifyDiceCostToken`已
支援，無需額外程式改動）。

---

主文件：`docs/weapon_skill_structuring_survey.md`
