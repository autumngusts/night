# midnight 武器／戰技・魔術・祈禱 稽核

資料規模：武器 369 把 / 分類 32 個（其中盾 3 個）/ weapons_skills.js 251 條 / 各分類 innateSkills 99 條 / 其中 Action 類招式合計 294 條

## ① 結構化完整性

**武器的 category 參照解不開：0 筆**

**art id 參照解不開：0 筆**

**innate id 參照解不開：0 筆**

**隨機戰技抽選表的 id 參照解不開：0 筆**

**武器 id 重複：0 筆**

**未知的 skill ref kind：0 筆**

**盾缺 attachedEffect／reverseArt 欄位：0 筆**

**隨機戰技槽永遠抽不出東西（分類無抽選表／table 字母對不上）：0 筆**

**缺 zh 或 ja：0 筆**

**本文空白：0 筆**

**本文標記為未確認：0 筆**

**孤兒戰技（固定掛載與抽選表都到不了）：2 筆**
- art_magic_ray（魔力的光線）
- art_flame_sweep（炎的雜清）

結構化問題合計：2 筆

## ② midnight 可達性（招式按不按得到）

midnight.js 入口實況：每側戰技B／B1／B2 可定位 2 槽（共用清單 sideSkillButtonEntries：有）；左右手皆可施放的一般武器／盾戰技（weaponActionEntriesForSide：有，盾已納入）；右手另有〔戰技A〕專用鍵 → 右手上限 3 個、左手上限 2 個、杖／聖印 2 個。

**一般武器／盾裝在右手時，招式數超過上限 3 而按不到：0 把**

**一般武器／盾裝在左手時，招式數超過上限 2 而按不到：0 把**

**杖／聖印：第 3 個以後的魔術／祈禱按不到：0 把**

## ③ 招式效果套用度（castWeaponSkillEntry 實際處理範圍）

castWeaponSkillEntry() 目前會做的事：
- 消耗（體力／FP／HP）解析與扣除：有
- 主傷害 → damageCombatTarget()：有
- 祈禱火力提升 buff：有
- 咆哮系 2Hit buff：有
- 屬性／狀態異常蓄積（recordAttributeAccum）：有
- HP／FP 回復（healSelfHp／healSelfFp）：有
- 雜兵 □ 傷害（countMobDamageSquares）：有
- 回復 □ 解析（countHealSquares）：有

**威力無法自動解算、只顯示規則原文的 Action 招式：53 條**
（其中 0 條含「體型：L／LL」條件——bareGuardSymbolSkillValue 刻意回傳 null，屬設計上正確行為，非缺口）
- 暗殺之法（art_assassin_method／weapons_skills.js）：消耗：①／hP■　對象：自身　編隊：前衛・後衛皆可使用　效果：自身敵視:0。
- 疾風步（art_quickstep／weapons_skills.js）：消耗：①／FP■　對象：自身　編隊：前衛・後衛皆可使用　效果：對象增加一個耐力骰。
- 輝石彗粒（art_glintstone_shard／weapons_skills.js）：消耗：③／FP1　對象：敵人　編隊：前後衛可發動　威力：２５＋戰技威力　效果：對象總和傷害與 魔：２賦予。
- 岩石劍（art_boulder_stance／weapons_skills.js）：消耗：①／FP■　對象：自身　編隊：前衛・後衛皆可使用　效果：直到結束階段為止，此裝備進行2Hit攻擊時，該傷害「＋▲」。
- 黃金劍技（art_golden_sword_technique／weapons_skills.js）：消耗：③③③／FP■　對象：自身　編隊：前衛・後衛皆可使用　效果：此裝備品到結束階段為止追加技能「四連擊」。四連擊｜消耗：③③③　對象：敵人　編隊：前衛・後衛皆可使用　效果：此裝備
- 弔唁墓標（art_mourning_tombstone／weapons_skills.js）：消耗：FP■　對象：自身與任意1名PC　編隊：前衛・後衛皆可使用　效果：對自身與任意裝備狀態的武器1個，直到結束階段為止，追加技能「屬性｜聖（154頁）」。
- 眠霧（art_sleeping_mist／weapons_skills.js）：消耗：③／FP■　對象：敵人　編隊：前衛可使用　效果：對敵人造成「睡眠：2」。回合結束前武器附帶屬性｜睡眠。
- 夜與焰之構（art_night_and_flame_stance／weapons_skills.js）：消耗：FP■　對象：自身　編隊：前衛・後衛皆可使用　效果：直到本階段結束為止，此裝備品可使用效果「魔力的光線」與效果「炎的雜清」。
- 米埃洛斯的絕叫（art_miyr_scream／weapons_skills.js）：消耗：①／FP■　對象：敵人　編隊：前衛時可使用　效果：直到階段結束為止，對象「HP價值：－10」。此動作後，直到回合結束為止，此裝備品進行2Hit攻擊時，總合傷害「＋5＋▲」。
- 滅亡靈炎（art_ruin_spirit_flame／weapons_skills.js）：消耗：FP■　對象：自身　編隊：前衛・後衛皆可使用　效果：直到結束階段為止，為此裝備品追加技能「屬性｜魔（154頁）」與「異常狀態｜凍傷（154頁）」。
- 血之斬擊（art_blood_slash／weapons_skills.js）：消耗：④／HP■／FP■　對象：敵人　編隊：前衛・後衛皆可使用　威力：25＋神秘補正　效果：對敵人造成【總合傷害：威力】與「出血：2」。
- 切腹（art_seppuku／weapons_skills.js）：消耗：HP■　對象：自身　編隊：前衛・後衛皆可使用　效果：對自身造成【總合傷害：威力＋▲】。此動作後，直到結束階段為止，此裝備品追加技能「狀態異常｜出血（154頁）」。
- 血之斬擊（art_blood_slash_twinblade／weapons_skills.js）：消耗：④／HP■／FP■　對象：敵人　編隊：前衛・後衛皆可使用　威力：25＋神秘補正　效果：對敵人造成【總合傷害：威力】與「出血：2」。
- 戰吼（art_war_cry／weapons_skills.js）：消耗：FP■　對象：自身　編隊：前衛・後衛皆可使用　效果：直到結束階段為止，此裝備2Hit攻擊造成的總合傷害「＋5」。若自身裝備狀態下持有護符「咆哮的勳章（201頁）」，總合傷害再
- 聖律（art_holy_law／weapons_skills.js）：消耗：FP■　對象：自身　編隊：前衛・後衛皆可使用　效果：直到結束階段為止，此裝備追加「屬性｜聖（155頁）」。
- 共享聖律（art_holy_law_share／weapons_skills.js）：消耗：①／FP■■　對象：自身與1名PC　編隊：前衛・後衛皆可使用　效果：自身選擇1個裝備狀態的武器。對象PC也選擇1個裝備狀態的武器。直到階段結束為止，所選武器追加技能「屬性｜聖
- 野蠻咆哮（art_savage_roar／weapons_skills.js）：消耗：FP■　對象：自身　編隊：前衛・後衛皆可使用　效果：直到結束階段為止，此裝備品2Hit攻擊的總合傷害「＋5＋▲」。若自身裝備護符「咆哮的勳章（201頁）」，總合傷害再「＋5（
- 連續射擊（art_continuous_shot／weapons_skills.js）：消耗：FP■　對象：自身　編隊：前衛・後衛皆可使用　效果：將此裝備的2Hit攻擊變更為「骰子消耗：②②」。
- 回復（prayer_heal／weapons_skills.js）：消耗：③③／FP■■　對象：自身與1名PC　編隊：前衛・後衛皆可使用　效果：對目標套用信仰值份的「HP回復：□□□」。
- 緊急回復（prayer_urgent_heal／weapons_skills.js）：消耗：③／FP■　對象：自身　編隊：前衛・後衛皆可使用　效果：對目標套用「HP回復：□□□」。
- 魔力武器（spell_magic_weapon／weapons_skills.js）：消耗：FP■　對象：自身　編隊：前衛・後衛皆可使用　效果：自身任選1個裝備狀態的武器。直到結束階段為止，為所選武器追加技能「屬性｜魔（154頁）」。此效果不重複。魔術學院雷亞魯卡利
- 魔力之盾（spell_magic_shield／weapons_skills.js）：消耗：FP■　對象：自身　編隊：前衛・後衛皆可使用　效果：對象任選1個裝備狀態的盾牌。直到結束階段為止，該盾牌防禦的HP價值最終「＋10」（上限100）。此效果不重複。魔術學院雷亞
- 夜巫女之霧（spell_night_maidens_mist／weapons_skills.js）：消耗：①①／FP■■　對象：敵人・雜兵　編隊：前衛時可使用　效果：自身與敵人、雜兵各自承受「HP損害：■■」。魔術街薩利亞的夜之魔術之一。於前方產生侵蝕生命的銀霧，包含施術者在內，
- 永遠的暗黑（spell_eternal_darkness／weapons_skills.js）：消耗：①／FP■　對象：敵人　編隊：前衛・後衛皆可使用　效果：直到結束階段為止，敵人動作產生的「屬性」蓄積值無效化。魔術街薩利亞的禁忌魔術。產生黑暗，吸引魔術與祈禱。
- 冰結武器（spell_frozen_armament／weapons_skills.js）：消耗：FP■　對象：自身　編隊：前衛・後衛皆可使用　效果：自身任選1個裝備狀態的武器。直到結束階段結束為止，為所選武器追加技能「異常狀態｜凍傷（154頁）」。此效果不重複。年邁的雪
- 大回復（prayer_great_heal／weapons_skills.js）：消耗：③③／FP■■■　對象：自身與PC1名　編隊：前衛・後衛皆可使用　效果：對象套用「HP回復：□×5」。信仰二指者的祈禱，其中的高位版本。連同周圍夥伴大幅回復HP。
- 王者的回復（prayer_kings_heal／weapons_skills.js）：消耗：③③／FP■×4　對象：自身與PC1名　編隊：前衛・後衛皆可使用　效果：對象套用「HP回復：□×7」。二指特別授予被認可為王者之器的褪色者的祈禱。連同周圍夥伴，大幅回復HP。
- 魔力防護（prayer_magic_barrier／weapons_skills.js）：消耗：FP■　對象：自身　編隊：前衛・後衛皆可使用　效果：直到結束階段為止，對象不承受敵人的「魔」屬性蓄積值。信仰二指者的祈禱。提升魔力減傷率。
- 聖防護（prayer_holy_barrier／weapons_skills.js）：消耗：FP■　對象：自身　編隊：前衛・後衛皆可使用　效果：直到結束階段為止，對象不承受敵人的「聖」屬性蓄積值。信仰二指者的祈禱。提升聖減傷率。
- 炎防護（prayer_flame_barrier／weapons_skills.js）：消耗：FP■　對象：自身　編隊：前衛・後衛皆可使用　效果：直到結束階段為止，對象不承受敵人的「炎」屬性蓄積值。信仰二指者的祈禱。提升炎減傷率。
- 雷防護（prayer_lightning_barrier／weapons_skills.js）：消耗：FP■　對象：自身　編隊：前衛・後衛皆可使用　效果：直到結束階段為止，對象不承受敵人的「雷」屬性蓄積值。信仰二指者的祈禱。提升雷減傷率。
- 王者的聖防護（prayer_kings_holy_barrier／weapons_skills.js）：消耗：FP■■　對象：PC全員　編隊：前衛・後衛皆可使用　效果：直到結束階段為止，對象不承受敵人的「聖」屬性蓄積值。二指授予百智卿基甸的祈禱。連同周圍夥伴，大幅提升聖減傷率。
- 以黃金樹之名（prayer_erdtree_vow／weapons_skills.js）：消耗：FP■■　對象：自身與任選1名PC　編隊：前衛・後衛皆可使用　效果：直到結束階段為止，對象進行攻擊的傷害「1Hit：＋5／2Hit：＋10」，戰技傷害「＋5」，未進行防禦時「
- 黃金魔力防護（prayer_golden_magic_barrier／weapons_skills.js）：消耗：FP■■　對象：PC全員　編隊：前衛・後衛皆可使用　效果：直到結束階段為止，對象不承受敵人的「魔」屬性蓄積值。黃金樹信仰祈禱之一。連同周圍夥伴，大幅提升魔力減傷率。
- 黃金雷防護（prayer_golden_lightning_barrier／weapons_skills.js）：消耗：FP■■　對象：PC全員　編隊：前衛・後衛皆可使用　效果：直到結束階段為止，對象不承受敵人的「雷」屬性蓄積值。黃金樹信仰祈禱之一。連同周圍夥伴，大幅提升雷減傷率。
- 黃金樹的回復（prayer_erdtree_heal／weapons_skills.js）：消耗：③／FP×4　對象：自身與PC1名　編隊：前衛・後衛皆可使用　效果：對象套用「HP回復：□×5」。古老的黃金樹祈禱之一。連同周圍夥伴，大量回復HP。
- 黃金樹的恩惠（prayer_erdtree_bounty／weapons_skills.js）：消耗：③／FP■■■　對象：PC1名　編隊：前衛・後衛皆可使用　效果：直到結束階段為止，每個階段開始時對象套用「HP回復：□□」（請注意結束階段開始時也會回復HP）。古老的黃金樹祈
- 聖律之劍（prayer_law_of_regression_blade／weapons_skills.js）：消耗：④／FP■　對象：自身　編隊：前衛・後衛皆可使用　效果：自身任選1個裝備狀態的武器。直到結束階段為止，為所選武器追加技能「屬性｜聖（154頁）」。此效果不重複。黃金律原理主義
- 不易之盾（prayer_unchanging_shield／weapons_skills.js）：消耗：FP■　對象：自身　編隊：前衛・後衛皆可使用　效果：對象任選1個裝備狀態的盾牌。直到結束階段為止，該盾牌防禦的HP價值最終「＋10」（上限100）。此外防禦時傷害所含的屬性與
- 回歸性原理（prayer_regression／weapons_skills.js）：消耗：①①①／FP■■■　對象：PC全員　編隊：前衛・後衛皆可使用　效果：將對象承受敵人的所有「屬性蓄積值／異常狀態蓄積值」歸零，並結束敵人對對象的所有持續效果。黃金律原理主義的祈
- 雷之武器（prayer_lightning_weapon／weapons_skills.js）：消耗：FP■　對象：自身　編隊：前衛・後衛皆可使用　效果：自身任選1個裝備狀態的武器。直到結束階段結束為止，為所選武器追加技能「屬性｜雷（154頁）」。此效果不重複。王都古龍信仰祈
- 龍雷之加護（prayer_dragon_lightning_blessing／weapons_skills.js）：消耗：FP■　對象：自身　編隊：前衛・後衛皆可使用　效果：直到結束階段為止，對象不承受敵人的所有「異常狀態」蓄積。王都古龍信仰祈禱之一，其中的高位版本。召喚雷電，纏繞於施術者身上。
- 毒之刃（prayer_poison_blade／weapons_skills.js）：消耗：FP■　對象：自身　編隊：前衛・後衛皆可使用　效果：自身任選1個裝備狀態的武器。直到結束階段結束為止，為所選武器追加技能「異常狀態｜猛毒（154頁）」。此效果不重複。侍奉腐敗
- 黑炎之刃（prayer_black_flame_blade／weapons_skills.js）：消耗：FP■　對象：自身　編隊：前衛・後衛皆可使用　效果：自身任選1個裝備狀態的武器。直到結束階段為止，為所選武器追加技能「屬性｜炎（154頁）」。此效果不重複。神肌使徒的黑炎祈禱
- 黑炎守護（prayer_black_flame_protection／weapons_skills.js）：消耗：FP■　對象：自身　編隊：前衛・後衛皆可使用　效果：直到結束階段為止，對象「HP價值：＋10」（對防禦的HP價值無效）。神肌使徒的黑炎祈禱之一。
- 獸之生命（prayer_beast_vitality／weapons_skills.js）：消耗：③／FP■■　對象：自身　編隊：前衛・後衛皆可使用　效果：直到戰鬥結束為止，每個階段開始時對象套用「HP回復：□」（請注意結束階段開始時也會回復HP）。獸之司祭古朗格授予的祈
- 血炎之刃（prayer_bloodflame_blade／weapons_skills.js）：消耗：FP■■　對象：自身　編隊：前衛・後衛皆可使用　效果：自身任選1個裝備狀態的武器。直到結束階段為止，為所選武器追加技能「屬性｜炎（154頁）」與「異常狀態｜出血（154頁）」
- 聖域（art_sanctuary／weapons_skills.js）：消耗：③／FP　對象：自身與PC1名　編隊：前衛・後衛皆可使用　效果：對象套用「HP回復：□」。
- 鐵壁之盾（art_stalwart_shield／weapons_skills.js）：消耗：FP　對象：自身　編隊：前衛・後衛皆可使用　效果：直到結束階段結束為止，此裝備品防禦的HP價值最終「＋10」（上限100）。此效果不重複。
- 復仇的誓言（colossal_vow_of_vengeance／weapons_categories.js:colossal）：消耗：FP■■　對象：自身　編隊：前衛・後衛皆可使用　效果：對象追加1個體力骰。此動作後，直到結束階段為止，對象「最大HP：＋□□」（現在HP不回復）。此技能的效果不重複。
- 靈障招喚（greataxe_ghost_affliction_call／weapons_categories.js:greataxe）：消耗：④／FP■　對象：敵人　編隊：前衛時可使用　威力：無　效果：直到階段結束為止，將對象視為「HP價值：－10」。此效果不重複。
- 軍旗之下（halberd_under_the_banner／weapons_categories.js:halberd）：消耗：③／FP■■　對象：敵人　編隊：前衛・後衛皆可使用　效果：對敵人造成【總合傷害：（此階段中，曾造成過一次以上總合傷害的PC人數）×20】。
- 傳染的憤怒（large_shield_contagious_fury／weapons_categories.js:large_shield）：消耗：FP　對象：自身　編隊：前衛・後衛皆可使用　效果：自身任選1個裝備狀態的武器。直到階段結束為止，所選武器造成的攻擊傷害「1Hit：＋5／2Hit：＋10」，戰技傷害「＋5」。

**屬性／狀態異常蓄積（固定值）：0 條招式的本文寫了，但 midnight 不會套用**

**屬性／狀態異常蓄積（1D／2D，需擲骰）：0 條招式的本文寫了，但 midnight 不會套用**

**HP／FP 回復（□，可計算）：0 條招式的本文寫了，但 midnight 不會套用**

**雜兵 HP 損害（□，可計算）：0 條招式的本文寫了，但 midnight 不會套用**

**敵視變更：2 條招式的本文寫了，但 midnight 不會套用**
- 暗殺之法（art_assassin_method／weapons_skills.js）：敵視:0
- 夏布利利的吶喊（prayer_howl_of_shabriri／weapons_skills.js）：敵視：＋3

**蓄積值加成（「蓄積值：＋N」）：0 條招式的本文寫了，但 midnight 不會套用**

**HP 價值變更（Guard／HP-value）：5 條招式的本文寫了，但 midnight 不會套用**
- 米埃洛斯的絕叫（art_miyr_scream／weapons_skills.js）：「HP價值：－10」
- 以黃金樹之名（prayer_erdtree_vow／weapons_skills.js）：「HP價值：＋10」
- 黑炎守護（prayer_black_flame_protection／weapons_skills.js）：「HP價值：＋10」
- 格雷歐爾的咆哮（prayer_greyolls_roar／weapons_skills.js）：「HP價值：-10」
- 靈障招喚（greataxe_ghost_affliction_call／weapons_categories.js:greataxe）：「HP價值：－10」

參考：本文含「HP損害：■」的 Action 招式 83 條——依 CLAUDE.md §19，■ 不得自行發明數值，維持顯示規則原文交由 GM 處理即為正確現狀，不列為缺口。

## ④ 缺口一覽（依性質分類）

下面是把 ①〜③ 的結果整理成「要不要動工」的判斷。**規則數值未確認的項目一律不列為要實作**（CLAUDE.md §4／§19）。

**A. 參照解不開的 skill ref（確定是 bug、與規則無關）**
- 目前 0 筆。（2026-09-12 已修：weapons_data.js 曾有 4 筆把 colossal 的固有技能寫成 kind:"art"，而 kind:"art" 只查 weapons_skills.js，查不到就整條丟掉，導致那 4 把特大武器的招式在 night/midnight 都不存在。）

**B. 招式配對狀況：2 條沒有配對到任何武器／抽選表**
- B-1 重複轉錄 0 條：ja 名稱與「已配對的另一條」完全相同＝同一條規則書項目被轉記了兩次，其中一份是永遠抽不到的死資料。刪除前要先核對規則書，確認不是「同名的兩條不同項目」。
- B-2 子能力 2 條：名稱被其他招式的本文以「…」引用（例：夜與焰之構賦予「魔力的光線」「炎的雜清」），本來就不該有自己的配對——非缺口，現狀正確。
- 　　art_magic_ray（魔力の光線 / 魔力的光線）
- 　　art_flame_sweep（炎の雑払い / 炎的雜清）
- B-3 真正未配對 0 條：既非重複也沒被引用，是抽選表／武器資料還沒謄完。需要規則書照片才能補，程式不用改。

**B-old. 參考：原本的整批孤兒清單**
- 孤兒戰技 2 條：本文已謄寫在 weapons_skills.js，但沒有任何武器固定掛載、也不在任何隨機抽選表裡，所以玩家永遠取得不到。多數是 spell_*／prayer_*，對照杖的「隨機魔術（A）（B）決定表」各 30 列、聖印的（A）（B）（C）各 35/35/33 列，推測是抽選表本身還沒謄完。需要規則書照片才能補，程式不用改。

**C. midnight 施放入口（2026-09-12 補齊）**
- 盾的裏戰技／附帶效果：已可施放（weaponActionEntriesForSide() 不再排除 isShield，左右手皆可）。
- 左手一般武器的戰技：已可施放（戰技B／B1／B2 在該側非杖/聖印時改顯示該側武器的戰技）。
- 同一把武器的多個戰技：右手上限 3 個、左手 2 個。目前超過上限而按不到的武器：右手 0 把／左手 0 把／杖聖印 0 把。

**D. 招式本文的附帶效果套用狀況（2026-09-12 補齊，剩下的為未動工）**
- 敵視變更：2 條
- HP 價值變更（Guard／HP-value）：5 條
- 威力本身就解算不出來、只 showToast 規則原文的：53 條——其中多數是「直到結束階段為止…」的 buff 型招式（附加屬性、防護、HP價值、追加技能），即時制要先決定換算規則才能實作（既有通則：階段 → 10 秒，見 midnight_text_adapt.js）。

