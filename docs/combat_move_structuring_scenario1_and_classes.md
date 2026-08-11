# 劇本1敵人＋全角色技能：未結構化招式調查與實裝紀錄（2026-08-11）

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

- **gladius**（固定最終王）：合體/分裂形態共6招，傷害與目標規則全部已結構化
  （`boss_auto_gm_data.js`）。屬性附加值皆為`1D`/`2D`骰子形式，依全庫慣例由GM
  擲骰後手動輸入，不算未結構化。
- **鈴玉狩獵、樹衛兵＆王都的騎兵、忌鬼**：全部招式的傷害與目標規則已結構化
  （commit `19a1b42`）。屬性附加值同樣皆為骰子形式。
- **亞人的女王＆亞人的劍聲**：發現2招的固定屬性值（非骰子）被註解誤判為「數值
  未確定」而遺漏：
  - 「結晶散彈＆劍聖間距」（roll 3~4）：亂戰傷害修正－120之外，還有固定「魔:2」
    （`enemies_data_3.js:1817`），原本只結構化了－120。
  - 「咆哮＆抓握攻擊」（roll 7~8）：個別傷害240之外，還有固定「魔:2」
    （`enemies_data_3.js:1837`），原本只結構化了240。

### 實裝內容

1. `enemy_auto_gm_data.js`：上述2招的`groupDamage`/`individualDamage`各自新增
   `elementAccum: [{ label: "魔", amount: 2 }]`。
2. `night.js`：`handleAutoGmRollClick`新增`elementAccum`/`ailmentAccum`欄位的
   解析邏輯，將固定屬性/異常值套用到實際受到該次乱戰/個別傷害的PC身上；套用
   時機延後到GM於`#enemy-damage-modal`按下該PC的［確定］才真正寫入
   `state.battle.attributeStatus.received`（與HP損害一致的「先算出、後確定」
   設計，且此數值不可由GM於UI調整——`state.battle.pendingDefenseElementAccum`
   暫存欄位）。
3. `auto_gm.js`本身未修改（它是唯讀計算模組，不寫入state；elementAccum資料直接
   由night.js讀取原始structuredRow）。

已知限制（規則書要求GM擲骰，非bug）：全部其餘招式的`1D`/`2D`屬性附加值，維持
全庫一貫的「GM手動擲骰、App不猜測」處理方式。

---

## 二、全角色技能

以下依角色類型列出本次發現並實裝的項目。「已知限制」列出調查中發現但刻意不
自動化的項目及原因。

### 追跡者（tracker／tracker_dark）

**技藝強化（速擊）**（tracker_dark專屬）：可將「襲擊之楔」任選作為「速擊」
使用（總合傷害60+▲、復歸傷害60，戰鬥結束時額外回復1次使用次數），原本UI完全
沒有這個選項。

實裝：新增`TRACKER_ASSAULT_WEDGE_QUICK_ENTRY`fake entry（`night.js`），與原版
「襲擊之楔」共用`entry.id:"assault_wedge"`（因此共用同一使用次數池與「技藝強化
（燃燒）」加成），以`quickVariant:true`旗標排除原版專屏的雙重▲判定。「戰鬥
結束時額外回復1次」缺乏對應的生命週期機制，改為使用時記錄提醒文字讓GM手動
補回。

### 守護者（guardian／guardian_dawn）

**技藝強化（HP回復）bug修正**：guardian版是「救世之翼」發動後全體PC全滿血，
guardian_dawn版是「HP回復：□×5」（+5，非全滿）——兩版同名但本文不同，程式
原本不分版本一律套用全滿血，guardian_dawn角色會被誤套用。已依`c.typeId`區分。

**技能強化（防禦支援）**（guardian_dawn）：夜渡技能「旋風」發揮效果時，全體
已入場PC「HP價值：+10」直到結束階段為止（不重複）。已實裝（沿用消耗品「盾
塗脂」的`_guardValueBonusUntilEndPhase`機制）。

已知限制：**「斧槍旋風」**（guardian_dawn）本文寫「將自身產生的亂戰傷害
「+10」」——但本App與規則書其餘處，「亂戰傷害」一律是「敵人→PC」方向的固定
用語（GM對PC造成的範圍傷害），此處卻描述「PC自己產生亂戰傷害」，語意與既有
機制矛盾。查遍全書其餘「產生的亂戰傷害」用例（如ruffian_dark「技能強化（敵人
弱化）」）皆為「敵人產生的」而非「自身（PC）產生的」。依CLAUDE.md原則，規則
與既有架構衝突時不應自行猜測數值，此項**刻意未實裝**，建議之後找到更清晰的
規則書照片或請使用者確認語意後再處理。

### 鐵之眼（iron_eye／iron_eye_dark）

**蓄力攻擊「習得2個以上+10」**：兩版皆有此條款，原本固定只加+10，未檢查實際
習得數量。新增`CharacterDrawer.countLearnedActionRelicsByName`（新helper，
比照`countLearnedRelicEffectsByName`但篩選`kind:"Action"`）並套用判定。

**後衛戰術**（iron_eye）：武器1Hit/2Hit部分原已用`relicEffectAppliesTo`處理，
但「戰技・魔術產生的傷害+5」（後衛時）從未套用，已在`computeSkillDamage`補上
（不含消耗品部分，見下方限制）。

**技藝強化（毒箭）**（iron_eye_dark）：技藝「一擊必殺」對敵人傷害追加固定
「猛毒：8」，原本完全未捕捉。已實裝：若目前已在武器攻擊分頁選過對象敵人
（`combatAttackTargetEnemyKey`），自動蓄積；未選擇對象時退回顯示原文注記。

**命名bug修正**：iron_eye_dark版「狀態異常達成的歡喜」zh字序與iron_eye版
「異常狀態達成的歡喜」相反，導致選擇UI查表失敗（`RELIC_CHOICE_CONFIG_BY_NAME`
用zh優先比對，找不到對應key）。已補上這個別名key。

已知限制：「後衛戰術」的「消耗品傷害+5」部分未實裝——`applyConsumableEffect`
內傷害由多個獨立分支各自計算，逐一加入位置相關條件判斷的改動面過大，本次
優先處理範圍明確的技能/戰技/魔術部分，消耗品部分留待後續。

### 淑女（lady／lady_dawn）

**致命一擊「習得2個時+20，並HP/FP回復各+1」**：兩版皆有，原本固定只有120
傷害與附帶效果`crit_up`的+10，未檢查習得數量與回復部分。已用
`countLearnedActionRelicsByName`+直接HP/FP回復實裝。

**攻擊連續時，HP回復**（lady_dawn專屬）：與既有「攻擊連續時，FP回復」完全
相同的觸發條件（1次行動階段消耗4個體力骰），只是回復對象改為HP，原本只有FP
版存在。已新增對稱的`maybeApplyHpRecoveryOnAttack`並掛上相同觸發點。

### 無賴漢（ruffian／ruffian_dark）

**技能強化（敵人弱化）**（ruffian_dark）：以［Action］使用「逆襲」時，下個
防禦階段敵人產生的亂戰傷害（分割前）－120。已比照既有「圖騰・史黛拉」的－300
處理方式（`state.battle`旗標＋防禦分頁提醒橫幅，數值由GM手動套用——這也是
「圖騰・史黛拉」－300本身的既有實作方式，並非本次新降低的標準）。

**技藝強化（堅陣）**（ruffian_dark）：使用「圖騰・史黛拉」時，全體PC
「HP價值：+20」（上限100）直到結束階段為止。已實裝（沿用
`_guardValueBonusUntilEndPhase`機制，上限100由既有消耗端計算自然滿足）。

### 復仇者（avenger／avenger_dark）

**家族共鬥**：武器1Hit/2Hit部分已有處理，但戰技・魔術・祈禱傷害+10從未套用。
已在`computeSkillDamage`補上（判定條件：召喚的靈體存在且HP>0）。

**2Hit攻擊的達人（復仇者的咒爪）**：使用武器「復仇者的咒爪」2Hit攻擊時，2Hit
特典中另有「復歸傷害：+10」。由於本App所有「復歸傷害」皆為GM手動反映（無單一
PC目標追蹤機制），已加入使用該武器2Hit攻擊時的提醒注記，不強行捏造自動套用
對象。

**靈體消滅時HP/FP回復**（avenger_dark）：自身召喚的靈體（含「死靈術」召喚的
死靈）HP歸零消滅瞬間，各自獨立判定觸發HP/FP回復+2。已在兩處HP扣減入口（
`c.spiritSummonHp`與`c.deathSpirits`）加上「歸零瞬間」偵測與回復。

### 隱者（hermit／hermit_dawn）

**冷氣風暴凍傷值**：hermit的「混成魔法」變化技能之一，本文含固定「凍傷：2」
（非骰子），但原本只有總合傷害25被結構化解析，凍傷完全遺漏。已修正（同
`combatAttackTargetEnemyKey`模式）。

**hermit_dawn三個混成魔法變化技能完全未接入戰鬥UI**：橫掃雷擊（雷:1D）、雷炎
戰車（火:3+雷:3，兩個固定值）、重力爆發（魔:1D）——這3個是hermit_dawn專屬的
「混成魔法」替代技能，原本的`HERMIT_HYBRID_MAGIC_ACTION_VARIANTS`只涵蓋base
hermit版本的4個技能名稱，hermit_dawn玩家完全選不到這3個技能。已新增平行的
`HERMIT_DAWN_HYBRID_MAGIC_ACTION_VARIANTS`並接入相同注入點；其中「雷炎戰車」
的固定火:3+雷:3也一併結構化，另外2個維持骰子形式的GM手動處理慣例。

### 執行者（executor／executor_dark）

**妖刀解放・癒完全未接入戰鬥UI**（executor_dark）：與base版「妖刀解放・攻」
撞名為近似效果（皆是「妖刀」的代替Defense＋新增Action），但消耗、數值皆不同
（消去妖刀蓄積2個非1個、總合傷害100+◆非50+▲、額外HP回復+5、習得2個以上
+50非+25）。原本的`EXECUTOR_YOTO_RELEASE_*`系列fake entry與所有比對點都只
認「妖刀解放・攻」，executor_dark玩家完全選不到。已新增對稱的
`EXECUTOR_YOTO_RELEASE_HEAL_*`entry組，並在Action清單注入、Defense清單注入、
按鈕禁用條件（消耗2個蓄積）、消費邏輯、+50加成判定、防禦確認文字/log等全部
比對點加入對應分支。

### 學者（scholar／scholar_dark）

**技能強化（衝擊波的緩和）**（scholar_dark）：夜渡技能「探求」可改以
［Defense］代替「迴避」執行，視為「HP價值：100」——與鐵眼「標記」的迴避
替代效果數值、語意完全相同。已新增`SCHOLAR_DARK_INQUIRY_SHOCKWAVE_DEFENSE_ENTRY`
並重用「標記」既有的`marking_defense_note`文字與判定路徑。

**使用通用消耗品時HP回復**（scholar_dark）：為5個通用消耗品（勇者的肉塊／
龜首漬／星光的碎片／苔藥＝relic本文寫作「苔玉」但App內僅有此1個含「苔」字的
消耗品／溫石＝relic本文寫作「溫暖石」）的效果追加「對目標施加HP回復+1」。已
在`applyConsumableEffect`的5個對應分支各自補上+1（含「道具效果擴大」延伸出的
另一位目標PC）。

### 送葬人（undertaker／undertaker_dawn）

**祈禱輔助強化火力提升bug修正＋補完**（undertaker_dawn）：發現雙重問題——
(1) 這個relic effect名稱原本不在`relicEffectAppliesTo`的具名條件清單中，該
函式對未列出名稱一律回傳true＝無條件套用，導致玩家只要習得此效果，武器
1Hit/2Hit加成就會**無條件永久生效**，完全不需要先用祈禱觸發「火力提升」
狀態；(2)「戰技・魔術・祈禱傷害+10」的部分則完全沒有被`computeSkillDamage`
捕捉，從未套用。已修正為：新增`c._prayerFirepowerActive`戰鬥級旗標（使用
含「直到階段結束為止／直到結束階段為止」文字的祈禱技能時觸發，持續至戰鬥
結束才清除——與`_unyieldingStacks`同一reset時機），`relicEffectAppliesTo`
與`computeSkillDamage`皆改為讀取此旗標才生效。

**技藝強化（HP回復）**（undertaker_dawn）：使用技藝「不祥一擊」時，對自身
以外任意1名PC施加HP回復+2，原本完全未接入。已新增目標PC選擇下拉選單（未選擇
時預設套用清單中第1位其他PC，比照「咆哮」治癒選項的既定寫法）。

**衝刺攻擊「習得2個以上+15」**（undertaker_dawn專屬條款，base undertaker
沒有）：已用`countLearnedActionRelicsByName`實裝。

---

## 三、未實裝／刻意保留手動處理的項目（彙整）

| 項目 | 原因 |
|---|---|
| guardian_dawn「斧槍旋風」PC自身產生亂戰傷害+10 | 與既有「亂戰傷害＝敵人→PC」的全庫慣例矛盾，語意需先向使用者確認 |
| iron_eye「後衛戰術」消耗品傷害+5 | `applyConsumableEffect`傷害由多個獨立分支個別計算，改動面過大，優先度較低 |
| avenger「2Hit攻擊的達人（復仇者的咒爪）」復歸傷害+10 | 本App所有「復歸傷害」皆GM手動反映，無單一目標追蹤機制，僅補上提醒注記 |
| 全部`1D`/`2D`骰子屬性/異常附加值（gladius、4隻強敵、hermit系列等） | 全庫一貫慣例：需GM實際擲骰才能定值，App不猜測 |

---

## 四、修改檔案清單

- `static_src/night.js`：`handleAutoGmRollClick`（elementAccum解析）、
  `handleEnemyDamageConfirmForCharacter`（延後套用）、`defaultBattleState`／
  `loadBattleState`（新state欄位）、`computeSkillDamage`（多個flatBonus）、
  `renderCombatSkillAction`／`renderCombatDefenseAction`（多個fake entry
  注入點）、`renderCombatSpecialAttackActions`（蓄力攻擊/衝刺攻擊計數）、
  `renderFatalStrikeAction`（致命一擊計數）、`applyConsumableEffect`（5個
  消耗品+1）、多個新增fake entry常數與helper函式。
- `static_src/character_drawer.js`：新增`countLearnedActionRelicsByName`、
  `relicEffectAppliesTo`新增2個具名條件、`RELIC_CHOICE_CONFIG_BY_NAME`新增
  1個別名key。
- `static_src/enemy_auto_gm_data.js`：亞人的女王＆亞人的劍聖2招新增
  `elementAccum`。
- `site_src/i18n_data_{zh,ja,en}.py`：新增約10個對應的三語系UI文字key。

## 五、驗證方式

由於本機環境沒有安裝node.js，無法使用CLAUDE.md建議的`node --check`。改用：

1. 自訂括號平衡掃描（排除字串/註解）確認所有修改檔案的`(){}[]`配對與修改前
   基準一致。
2. `py -3 generate.py`建置成功。
3. 使用Playwright在建置後的`dist/`上實際載入 admin／night／characters／
   admin/scenarios 四個頁面（含建立測試遊戲），確認：
   - 零 `pageerror`（無JS語法錯誤、無頂層執行期例外）。
   - `window.PriTestNightCore`、`window.PriTestAutoGm.rollEnemyAction`、
     `window.PriTestCharacterDrawer.countLearnedActionRelicsByName`等本次
     新增/修改的匯出函式皆正確存在。
   - 僅有既有的敵人圖片404（與本次修改無關）。

**尚未做的驗證**：逐一為每個角色類型建立測試角色、進入實際戰鬥並操作新增的
UI選項（例如實際點擊「妖刀解放・癒」按鈕、選擇「速擊」變體等）。建議之後
針對特定class有疑慮時，再個別以Playwright腳本或人工操作驗證。
