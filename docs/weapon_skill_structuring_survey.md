# 武器技能／夜渡技能・技藝／魔術・祈禱：未結構化調查與實裝紀錄（2026-08-13）

本文件延續 `docs/history/2026-08-11-combat_move_structuring_scenario1_and_classes.md`
的調查方法，改把範圍聚焦在**武器固有技能／被動**（`weapons_categories.js`、
`weapons_skills.js`）與**夜渡技能・技藝**（`character_types.js`）中，魔術（sorcery）
／祈禱（incantation）相關的招式，找出「有明確可計算數值但程式尚未結構化」的項目。

調查方法：先閱讀 `docs/enemy_damage_rules.md` §2（符號規則）與 `CLAUDE.md` §17-19、
§36，再對照 `character_drawer.js` 的實際計算管線（`computeWeaponDamage`／
`computeSkillDamage`／`computeArtPower`／`fixedSkillPowerValue`／
`weaponAccumulationEffects`）與 `weapons_categories.js`／`weapons_skills.js`／
`character_types.js` 內含 `■`（或其他未串接數值）的招式本文，逐一確認是否已被
既有管線正確處理。

補充文件（原「困難項目」清單，已於後續對話中經使用者澄清並全數處理完畢）：
`docs/weapon_skill_structuring_difficult_items.md`。

---

## 一、已實裝

### 1. 雜兵 `□` 傷害解析（本次新增）

發現：`colossal_collapse_wave`（"崩壊波"／"崩壞波"，`weapons_categories.js`）、
`colossal_star_call`（"星呼び"／"呼星"，`weapons_categories.js`）、
`spell_crystal_burst`（"結晶散弾"／"結晶散彈"，`weapons_skills.js`，輝石魔術）、
`prayer_radagons_rings_of_light`（"ラダゴンの光輪"／"拉達岡的光輪"，
`weapons_skills.js`，黃金律祈禱）這4個Action招式，本文皆含
`モブに「HP損害：□」`或`「HP損害：□□」`——`□`是可計算的個數（1個=1點），
不是不可知的`■`，但原本從未被解析套用，一律以原文顯示交由GM手動處理。
（主傷害「對敵人造成【總合傷害：...】」部分，這4招原本就已透過
`computeSkillDamage`正確結構化，僅雜兵傷害的`□`部分遺漏。）

實裝：

- `character_drawer.js`新增`countMobDamageSquares(text)`（比照既有
  `countHealSquares`寫法），regex比對`(?:モブ|雜兵)[^」]*?HP損害[：:]\s*(□+)`
  取出`□`個數，並加入`window.PriTestCharacterDrawer`匯出物件。
- `night.js`的`renderCombatSkillAction`泛用分支（`else if (isActive)`）：
  - 若該招式`□`個數>0且戰場上已有雜兵列（`state.battle.mobHpRows`），且雜兵列
    數量>1時顯示選單讓GM/玩家選擇要扣哪一列（只有1列時自動鎖定該列，不顯示
    選單）。
  - 確定時呼叫既有`adjustMobHpRow(rowIdx, squares)`（GM手動勾選雜兵HP格的同一
    函式，自動完成`renderMobHpList`／`saveState`／戰鬥結束判定）。
  - 若戰場上尚未加入任何雜兵列（無法自動判斷目標），退回原本行為：把原文
    顯示在行動紀錄中交由GM手動處理。
- 新增i18n key（zh/ja/en三語系）：`combat_attack_target_mob_row_label`。

因為判斷依據是本文文字regex而非個別`entry.id`白名單，此修正同時涵蓋武器固有
技能與魔術/祈禱技能（`weapons_skills.js`）兩個資料檔，未來若規則書再新增同型
招式，也會自動被涵蓋，不需要逐一加白名單。

### 2. 武器固有威力補正加成（本次新增）

發現：`curved_sword_power_mod_up`（"威力補正（技巧）＋5"，`weapons_categories.js`，
武器固有被動，套用於獸人的彎刀／蛇神的彎刀／熔岩刀等曲刀類武器）本文為固定
數字「威力補正「技量：＋5」」，但`computeArtPower`原本只加總「角色類型
powerMod ＋ 護符加成 ＋ 遺物效果加成」三項，從未讀取武器固有技能帶來的威力
補正加成，導致裝備這些武器時傷害威力少算了5點。

實裝：

- `character_drawer.js`：從既有`weaponInnatePowerAdjustment`（處理「武器威力
  ＋N」固定加成）抽出共用的`resolveWeaponInnateSkillById(id)`查找函式。
- 新增`weaponInnatePowerModAdjustment(weapon, statKey)`，regex句型比照既有
  `talismanPowerModBonus`（「威力補正「N：+5」」同一句型），非匯出（與
  `weaponInnatePowerAdjustment`一致，僅供`computeArtPower`內部使用）。
- `computeArtPower`的powerMod加總式補上這一項。

已確認整個`weapons_categories.js`只有這一處武器固有技能使用「威力補正」字樣，
改動範圍明確、不影響其他武器。

### 3. 戰鬥階段初次擲骰觸發的固有被動（原列為困難項目，已於後續對話中澄清並實裝）

`colossal_fate_of_death_grace`（"運命の死の加護"／"命運之死的加護"，馬利卡斯的
黑劍固有被動）、`curved_sword_despair_grace`（"絶望の加護"／"絕望的加護"，曲刀
固有被動）：本文原本包含骰子花色條件（"□□□"／"◎◎"）與不可知的`HP損害：■`，
經使用者澄清：花色條件即為「新骰出的體力骰中出目為1的數量」，兩者門檻皆為
3個1點（使用者確認），效果數值確認為固定「HP損害：1」。

實裝：`night.js`新增`characterHasEquippedInnateSkillId(c, skillId)`（判斷角色
是否裝備了含指定固有技能的武器）與`triggerWeaponGraceDiceEffect(c, skillId)`
（自動判定目標敵人、透過既有`damageEnemyHpForKey`扣1格HP、寫入執行紀錄與一般
log、並用`postSystemTurnMessage`＋`showThreatBroadcast`廣播到進度版），掛在
`rollDiceForCharacterActionPhase`的戰鬥階段初次擲骰邏輯中（只看新骰出的骰子，
不含跨回合帶入）。目標敵人若無法唯一判斷（多個敵人且無目前選定對象）則退回
提醒文字。

另外，`great_curved_sword_black_king_repel`（"黒王の斥力波"／"黑王的斥力波"）
原本記錄的本文含資料謄寫錯誤（多出一段「動作後對敵人HP/FP損害：■」與移動
效果），經使用者訂正後已修改`weapons_categories.js`內的body文字，訂正後版本
與其他已結構化招式同一模式（主傷害走既有管線、雜兵`■■`尾段維持GM手動），
不需要額外程式邏輯。

新增i18n key（zh/ja/en三語系）：`weapon_grace_dice_trigger_note`、
`weapon_grace_dice_applied_note`、`weapon_grace_dice_unresolved_target_note`、
`log_weapon_grace_dice_trigger`。

---

## 二、刻意保留手動處理的項目（非缺口，符合CLAUDE.md §19）

以下項目**經確認為正確現狀**，不是待辦事項：

| 項目 | 說明 |
|---|---|
| 雜兵`HP損害：■`／`■■`尾段 | 約50處出現在`weapons_categories.js`／`character_types.js`，附掛在主傷害（總合傷害）已正確結構化的Action招式上，僅雜兵附帶傷害是不可知的`■`。符合CLAUDE.md §19「■不得自行發明數值」，正確做法就是維持GM手動處理。 |
| 守護者「高防禦狀態」HP損害減輕`■` | `night.js`內已有明確comment（約`■は数値未確定のためGM手動反映、注記のみ残す`）確認為刻意保留。 |
| 依敵人體型（體型/サイズ）才生效的裸`▲`/`◆`技能 | `bareGuardSymbolSkillValue`（`character_drawer.js`）在本文含「體型/サイズ」條件時故意回傳null，因為GM需先判斷實際敵人體型才能套用，屬設計上的正確行為。 |
| 全部`1D`/`2D`骰子屬性/異常附加值 | 全庫一貫慣例，需GM實際擲骰才能定值，App不猜測。 |

---

## 三、修改檔案清單

- `static_src/character_drawer.js`：新增`countMobDamageSquares`、
  `resolveWeaponInnateSkillById`、`weaponInnatePowerModAdjustment`；
  `computeArtPower`加總式補上武器固有威力補正；`window.PriTestCharacterDrawer`
  匯出新增`countMobDamageSquares`／`resolveWeaponInnateSkillById`。
- `static_src/night.js`：`renderCombatSkillAction`泛用分支新增雜兵列目標選單
  與`adjustMobHpRow`套用邏輯；新增`characterHasEquippedInnateSkillId`／
  `triggerWeaponGraceDiceEffect`並掛在`rollDiceForCharacterActionPhase`的
  戰鬥階段初次擲骰邏輯中。
- `static_src/weapons_categories.js`：訂正`great_curved_sword_black_king_repel`
  的body文字（移除謄寫錯誤的第二段■效果，消耗改為「②②」，雜兵傷害改為
  「■■」）。
- `site_src/i18n_data_{zh,ja,en}.py`：新增`combat_attack_target_mob_row_label`、
  `weapon_grace_dice_trigger_note`、`weapon_grace_dice_applied_note`、
  `weapon_grace_dice_unresolved_target_note`、`log_weapon_grace_dice_trigger`。

## 四、驗證方式

本機環境無Node.js，無法用`node --check`。改用：自訂括號平衡掃描（排除字串/
註解）確認修改檔案的`(){}[]`配對正確；`py -3 generate.py`建置成功；三語系
i18n key一致性檢查。

**尚未做的驗證**：實際在瀏覽器中裝備含`curved_sword_power_mod_up`的武器確認
威力+5、裝備含雜兵`□`傷害招式的武器並在戰場加入雜兵列後實際發動技能確認扣血
數量正確——本機環境無Node.js/Playwright可用，建議之後有疑慮時人工驗證。
