# midnight（即時制擴張版）戰鬥數值現況整理

本文件記錄 `static_src/midnight.js`（搭配 `character_drawer.js` / `enemies_data_1~4.js`）
實際使用的戰鬥數值來源。**2026-09-06 已完成「數值真正接入」改版**：敵人 HP／攻擊／防禦、
玩家 HP／FP 上限全部改用規則書既有的結構化資料計算。
本文件同時說明新增的「測試模式」——開局可勾選，右側會顯示敵我傷害資訊，並提供三條可即時
調整的倍率滑桿，方便反覆測試戰鬥節奏、微調時長。

`midnight.js` 與 `night.js`（回合制）仍是完全獨立的兩套系統、各自的 state 與 Firebase 路徑，
不會互相載入。`night.js` 的 Guard Count/HP-value 純函式邏輯（`docs/enemy_damage_rules.md` §5）
被複製了一份到 `midnight.js`（不能直接 import，因為兩邊不共用 script）。

---

## 1. 敵人數值：HP／攻擊力／防禦力

### 1.1 HP（血量）

`enemyRealHpMax(trig)`：讀 `enemies_data_1~4.js` 該敵人 family 在其等級的 HP 格數字串
（`family.base[level-1].hp`，例如 `"×4/×3"` 代表兩條 HP 行、共 7 格），加總所有 `×N` 得到
「實際 hp 格數」，`×10` 就是即時制的真實 HP 上限（使用者明確規格）。25 個 family 全部都有
這份資料（已用腳本逐一驗證無缺漏）。等級來源：一般地圖遇敵時從樓層敘述「XXX(頁)/Lv.N」解析
（`maybeAssignFieldEnemy()` 新增寫入 `fieldTrigger/{id}/level`）；強敵籌碼沿用既有 `level` 欄位。
找不到資料時退回 `FIELD_ENEMY_HP_FALLBACK = 30`（理論上不會發生）。

雜兵 HP（`MOB_HP_PER_ROW = 10`，血量＝樓層文字「+雜兵N」的 N×10）維持不變，未在這次改版範圍內。

### 1.2 攻擊力：先選招，再判斷個別/群體，最後除以 10

`pickEnemyAction(actions)`：從敵人實際「アクション決定表」（`enemy.actions[]`）依
`roll` 欄位的骰面寬度（1D6「1」~「6」寬度各 1，2D6「1~2」「9~10」等寬度＝高-低+1，
`"—"` 寬度 0 自動排除）加權抽出一招——這是真正依規則書骰面機率抽選，不是均勻亂數。

`resolveEnemyActionOutcome(familyBase, level, action)` 判斷這一招的傷害：
- `note` 文字命中「個別ダメージ:N」／「個別傷害:N」→ **個別傷害**，`amount = N`（note 裡通常
  直接寫死最終數字，不需要再套公式）。
- 否則命中「乱戦」／「亂戰」關鍵字 → **亂戰傷害**，`amount = family.base[level-1].dmg`（該等級
  基準值）`+ mod` 修正值（`mod` 格式如 `"＋120"`／`"－240"`／`"±0"`，可能附加
  `"＆「炎:1D」"` 屬性字尾，只取加減值部分）。
- 兩者都沒命中 → 不發明數值，這一招傷害視為 0，但仍會顯示招式名稱（CLAUDE.md §19）。

目標人數（使用者明確規格）：個別傷害固定 1 人（優先選「敵視最大」＝目前對這隻敵人累積傷害
最高者，沒有紀錄則隨機 1 人）；亂戰傷害隨機 1~3 人（人數不足時取全部在場玩家）。取代了舊版
「敵視/單體/多人」三層權重與「1~3 次連續下手」demo 佔位機制——一次攻擊事件只對應規則書「一招」，
只有一次反應判定窗口（2 秒）。

**UI**：驚嘆號警示閃爍時同時顯示招式名稱（`#midnight-incoming-attack-name`）；命中特效固定只用
刀光（拿掉原本 50% 機率出現的野獸爪痕動畫）。

**傷害換算**：`finalDamage = round(amount / 10 × 測試模式敵人攻擊倍率)`，過防禦/迴避判定後扣血。

**屬性/異常攻擊**：完全命中時，解析「這一招」`mod` 欄位裡的全部「屬性名:數值」標記（一招可能
同時附帶多個），全部套用蓄積。這裡順便修正一個既有 bug：舊版程式碼掃描的是 `action.note`，但
實際資料裡「屬性:數值」標記寫在 `action.mod`，`note` 裡從未出現過這個格式，導致舊版屬性攻擊
形同虛設（已用 grep 對照 `enemies_data_*.js` 驗證）。

### 1.3 防禦力：Guard Point／HP 價值

比照 `night.js` 既有機制（`docs/enemy_damage_rules.md` §5），沿用 `enemies_data_*.js` 既有的
`family.guardCount`（最大值）／`family.guardValueTable`：

- 玩家攻擊命中若帶有 `▲`（1 單位＝規則書 0.5 點）/`◆`（2 單位＝規則書 1 點）符號，累積到該
  地圖點的 `guardUnits`；每滿 `GUARD_REDUCTION_THRESHOLD×2 = 6` 單位（＝規則書 3 點，使用者
  明確規格）就讓現在的 Guard Point −1（下限 0）。
- Guard Point 歸零後記錄時間戳；經過 `GUARD_BREAK_RECOVER_MS = 5000`（5 秒，使用者明確規格）
  自動回復到最大值、累積歸零——純粹用時間差計算，不需要額外的「回復」寫入。
- **2026-09-06 使用者明確規格改版**：一次攻擊/戰技的總傷害，先查目前 Guard Point 對應的
  HP 價值，直接把 HP 價值當成「減傷率（百分比）」使用——`realDamage = round(總傷害 × (1 - HP價值/100))`，
  例：HP 價值 80 代表減傷 80%，1Hit/2Hit 若為 40/80，分別造成 8/16 點傷害（使用者提供並驗證過
  的 worked example）。**這是 midnight.js（即時制）刻意跟 `night.js`（回合制）分歧的地方**：
  `night.js` 沿用 `docs/enemy_damage_rules.md` §5.3 的格數制（`floor(總傷害/HP價值)` 換算成
  HP 損害格數）不變，只有 midnight.js 這裡改成直接的百分比減傷制，原因是格數制的「無條件捨去」
  在即時制單次小額攻擊下幾乎必然是 0（見下方 2026-09-06 稍早的除錯記錄），使用者確認即時制
  改用百分比減傷取代格數制。Guard Point 本身的累積/降低/回復機制不變（▲◆累積降低 Guard Point
  → 對應到更低 Guard Point 的 HP 價值 → 減傷率下降，也就是「破防才能降低減傷率」），只有
  「HP 價值最後拿去做什麼運算」這一步不同。

### 1.4「各骰面攻擊招式的差異」

現在敵人攻擊已經是真正依骰面機率從規則書「アクション決定表」抽選，每一招各自的傷害分類
（個別/亂戰）、基準值/修正值、附帶屬性都直接讀該招原始資料，不再是壓平成單一抽象攻擊。

---

## 2. 玩家數值：HP／FP／體力（stamina）

| 資源 | 上限公式 | 回復規則 |
| --- | --- | --- |
| HP（`demoStat`，`selfArenaHpMax(c)`） | `100 + (c.hp.max + totalFlatMaxStatBonus(c,"hp")) × 10`（使用者明確規格：「血量為基礎100再加上初期HPx10，升級造成的HP上升也疊加上去」；`c.hp.max` 已含角色類型初期值＋升級加點） | 無自動回復；聖杯瓶回 30，上限 3 瓶 |
| FP（`selfFpMax(c)`） | `10 + (c.fp.max + totalFlatMaxStatBonus(c,"fp")) × 10`（FP 基礎 10，疊加方式與 HP 相同，使用者明確規格） | 無被動回復；角色首次載入時一次性灌滿（見下方說明），特定角色能力/道具會回一點 |
| 體力（stamina，即時制專屬資源） | 固定 100 | 每秒 +5，長按防禦期間不回復 |

已用實測驗證：追蹤者（`resourceSlots.hp=5, fp=3`）進場後 HP 顯示 150/150
（=100+5×10）、FP 顯示 40/40（=10+3×10），與公式相符。

**已知修正**：FP 是本地端資源（不同步），舊版在角色資料首次抵達前用 bootstrap 預設值
（現在是 `FP_BASE=10`），若沒有額外處理，角色載入後只有 `fp.max` 會更新、`fp.current`
仍停在 bootstrap 值，畫面會出現「10/40」這種看起來像沒滿血的誤導畫面。已在
`onCharactersReceived()` 加入角色資料首次抵達時的一次性灌滿邏輯修正此問題。

---

## 3. 玩家攻擊/技能傷害與消耗判定（本次未變動，附註冷卻機制異動）

一般武器攻擊／武器戰技／魔術祈禱的傷害公式與消耗換算維持原樣（直接呼叫
`CharacterDrawer.computeWeaponDamage()`／既有 `*SkillPowerValue` fallback 鏈／
「骰子點數×2＝體力、■數×10＝FP/HP」），詳見程式內註解，不再贅述。

**技藝/技能改用時間冷卻**（使用者明確規格，取代原本的「使用次數」限制）：
- 技藝（art）：使用後 180 秒（`ART_COOLDOWN_MS`）冷卻，或換日（第二天/第三天開始）立即重置。
- 技能（skill）：使用後 60 秒（`SKILL_COOLDOWN_MS`）冷卻，同樣換日立即重置。
- 力量感應（送葬人被動）等既有旁路機制不受影響，冷卻中仍可用累積的 credit 免費使用技藝。

**武器估計傷害**：角色視窗點下武器後的詳細資訊裡，新增一行黃字（沿用既有
`.weapon-damage-tag` 樣式）顯示 `computeWeaponDamage()` 算出的 1Hit/2Hit 估計傷害。

---

## 4. 動作提示 UI

`combatActionEvents/{tokenId}` 改存最新兩筆 `{text, at}` 的陣列（原本只存一筆）。渲染時堆疊
顯示（舊的在上、新的在下），新訊息推入時套用滑入動畫（`.midnight-action-bubble-line`），
2 秒後個別淡出（沿用原本的顯示時限，不需要額外清除 RTDB 資料）。

---

## 5. 測試模式：即時觀察與調整倍率

開局的等待房新增「測試模式」勾選框，寫入 `meta.testMode`（同一場遊戲所有人共用）。勾選後畫面
右側會出現面板（改成 `#midnight-hud-top-right` flex column 的最後一個子元素，跟隨按鈕列/
小地圖列的實際高度自動接在下面，2026-09-06 修正「面板寫死 top 值擋住選單/角色按鈕」的版面
問題），顯示：

- 我方/敵人最近一次攻擊的實際傷害數字（本地端 only，供肉眼確認公式輸出是否合理）。
- 玩家攻擊力（`floor()` 換算前的原始總傷害）／玩家防禦價值（`currentGuardInfo()` 算出的
  百分比減免，沒有盾牌/雙手持握資格時顯示"-"）／敵人防禦價值（`applyDamageToFieldEnemyHp()`
  這次查表用的 HP 價值，已套用下方倍率）——2026-09-06 新增，供對照「為什麼這次攻擊沒有造成
  HP 損害」。
- 四條滑桿：`敵人HP倍率`／`敵人攻擊倍率`／`玩家傷害倍率`／`敵人防禦價值倍率`（預設 x1.0），
  寫入 `meta.testTuning.{enemyHpMult,enemyAtkMult,pcDmgMult,enemyGuardValueMult}`，同一場
  測試的所有人共用同一組倍率。分別乘進 `enemyRealHpMax()`、敵人攻擊最終傷害（÷10 之後）、
  `applyDamageToFieldEnemyHp()` 算出的實際 HP 損害、以及該函式查表拿到的 HP 價值本身——都是
  計算鏈最後一步的乘法，不影響規則本身的計算過程。

**歷史記錄（已解決）**：2026-09-06 使用者曾回報「一般攻擊在測試模式下都顯示 0」——當時
`applyDamageToFieldEnemyHp()` 沿用 `night.js` 的格數制 `floor(單次傷害 / HP價值)`，而
`guardValueTable`（例如一般敵人 guard 全滿時常見 60~80）是規則書為「一次行動階段的合計
傷害」設計的門檻，即時制單次一般攻擊常常遠小於這個數字，導致幾乎必然是 0，且跨過門檻時
會從 0 直接跳到一整格（×10）。使用者確認後，改成 §1.3 記錄的「HP 價值＝減傷率（百分比）」
公式取代格數制，不再有這個問題；上方「敵人防禦價值倍率」滑桿現在調的是這個減傷百分比本身
（例如 1.2x 會把 80% 減傷推到 96%），不是格數制時代的除數。

這組倍率是目前唯一還保留的「可調參數」，供反覆測試、逼近「每場戰鬥 1~3 分鐘」的目標時，
不需要每次改完常數就重新建置，可以直接在遊戲內即時試。實際要調到多少，仍建議照原本的思路
（固定幾組代表性 build，實測每秒輸出，再反推目標區間）決定，測試模式只是把「改常數→重新
generate.py→重整頁面」的迴圈縮短成「拖滑桿」。

---

## 6. 2026-09-06 二次優化：房間設定／進場動畫／戰鬥 UI／日夜強制流程

本次優化涵蓋 8 個項目，均為使用者明確規格，重點如下（詳細理由見對應函式上方註解）：

1. **測試模式滑桿範圍擴大＋可直接輸入數字**：敵人 HP／玩家傷害倍率 0.2x~100x、敵人攻擊
   倍率 0x~20x、敵人防禦價值倍率 0x~10x，每條滑桿旁新增 `<input type="number">`，兩者
   互相同步（`bindTestSliderInput()`／`renderTestPanel()`）。
2. **房間設定（夜王／地圖）**：等待房新增「夜王」下拉選單，直接重用 `scenarios.js` 既有
   10 個劇本（每個劇本固定對應一個 `bossId`），寫入 `meta.nightBossId`；開局那一刻
   （`maybeTriggerSessionStart()`）用 `meta.mapSeed` 決定性挑一個未選夜王，寫入
   `meta.resolvedNightBossId` 供第 8 項查表用。「地圖」選單目前只有「基本版」生效，
   「完整版」UI 層級 disabled（`midnight_page.py`），保留欄位未實作。
3. **開局 10 秒進場動畫**：`introActive()`／`renderIntroOverlay()`，全螢幕疊層擋住所有
   點擊操作，鍵盤移動另外在 `updateMovement()` 加 `introActive(now)` 判斷擋住。靈鷹本體
   是 inline SVG 剪影＋CSS `@keyframes` 漩渦位移動畫（沒有美術素材，跟劍/盾圖示同一種
   inline SVG 風格），地圖 canvas 透明度逐幀寫入 inline `opacity`（0→1）。
4. **進入戰鬥確認＋3 秒讀取**：`recomputeActiveEncounter()` 新增 `confirmedEncounterIds`
   本地紀錄——第一次遇到已解決的遭遇且本來就是 participant 時直接視為已在其中，否則
   （重新靠近、或原本不是 participant 想加入別人的戰鬥）顯示上方資訊欄的
   `#midnight-enter-battle-prompt`，按下後 `BATTLE_ENTER_LOADING_MS=3000` 讀取完才真正
   標記為 participant、設定 `activeEncounter`。
5. **戰鬥 UI**：拿掉敵人 HP 下方的連段文字（`midnight-combo-note` 已移除），改成攻擊按鈕
   在下次攻擊會是 2Hit 時顯示「Hit」（`attackButtonHitReady()`，沿用既有
   `ATTACK_COMBO_WINDOW_MS` 當作「闕值時間」）；迴避/防禦成功、受到傷害各自在對應按鈕
   上方顯示 1 秒後消失的浮動文字（`showActionFlash()`，`resolveMyIncomingHit()` 呼叫）。
6. **聖杯瓶**：`FLASK_READ_MS` 從 600 改為 1000；`resolveMyIncomingHit()` 內，玩家真正
   受到傷害（`kind==="hit"`或`"block"`）時也呼叫 `cancelFlaskReadingForOtherAction()`
   （原本只有「使用其他動作」會取消，沒有涵蓋「被打」）。
7. **長按攻擊顯示特殊攻擊**：跳躍攻擊／衝刺攻擊本身是 `night.js` 既有的習得 relic 效果
   （`kind:"Action"`），傷害公式直接重用 `CharacterDrawer.findLearnedActionRelicByName`／
   `countLearnedActionRelicsByName`（跟 `night.js` 的 `renderCombatSpecialAttackActions`
   同一套，見 `night.js:4817`），不重新發明數值。**跟 `night.js` 刻意分歧**：`night.js`
   有「前衛時才能跳躍攻擊／後衛時才能衝刺攻擊」的位置限制，但 midnight.js 完全沒有
   前衛/後衛狀態，因此不套用該限制，只要裝備近戰武器且有習得就能用。長按
   `ATTACK_SPECIAL_MENU_HOLD_MS=400ms` 顯示選單（`updateAttackHold()`），再點選單裡的
   按鈕才真正發動（`useSpecialAttack()`），跟戰技 B 的「長按滿時間直接自動施放」是不同的
   互動模式。
8. **第一天/第二天夜之強敵＋自動換日**：縮圈完全結束後（`waitingForDay2`/`waitingForDay3`
   stage），任一玩家（`localPos` 或 `remoteTokens`）進入最終小圓，寫入共享倒數
   `meta.finalCircleCountdownDayNAt`，10 秒後（`FINAL_CIRCLE_BOSS_COUNTDOWN_MS`）自動查
   `fields_data_1.js` 的 `a_golden` 卡片「夜の強敵決定表」（依 `meta.resolvedNightBossId`
   → `Scenarios.numberForId()` 查劇本行），敵人名稱→`enemyFamilyId` 的解析沿用
   `rollAndAssignStrongEnemy()` 完全相同的 `GmFlow.extractLevelAndNameTokens`／
   `resolveCombatEnemyMatch` 邏輯（`rollAndAssignFinalCircleBoss()`）。這幾個原本是
   `night_gm_flow.js` 模組內部私有的純函式（`resolveNightBossTableRow`／
   `rollNightBossEntry`／`parseNightBossCellEntries`），這次額外匯出到
   `window.PriTestNightGmFlow` 供 midnight.js 呼叫。撃退第一天夜之強敵後 20 秒
   （`FINAL_CIRCLE_BOSS_DAY_ADVANCE_MS`）自動開啟第二天（`updateAutoDayAdvance()`），
   原本手動的「進入第二天/第三天」按鈕已移除；第二天夜之強敵擊退後不自動進 day3，改成
   上方資訊欄的「使用祝福」（隨時可用）／「商人」／「準備開始夜王戰鬥」，全部已佔用
   席位都準備後才自動寫入 `meta.day3StartAt`（`maybeTriggerDay3FromReady()`，跟大廳
   `players/{slot}.ready` 是各自獨立的 `readyFinalBoss/{slot}` 欄位）。
   **已知簡化（未實作）**：規則書「劇本 8、9 的 2 日目夜之強敵由 1 日目擲骰值連動決定」
   （`night_gm_flow.js` 的 `NIGHT_BOSS_LINKED_SCENARIOS`）目前沒有套用，這兩個劇本的
   第二天夜之強敵會獨立重擲，不影響其餘 8 個劇本。

---

## 7. 2026-09-06 三次優化：Day3 夜之王完整戰鬥／進場動畫／獎勵清單／HUD 流程

本次優化涵蓋使用者第三輪追加的 8 個項目（編號沿用使用者原始需求，從 2 開始），重點如下：

1. **修正 `FINAL_CIRCLE_BOSS_DAY_ADVANCE_MS`**：第一天夜之強敵擊退後的系統倒數從 20 秒
   改為 10 秒（使用者明確規格「總計時10秒後才正式開始第二天倒計時」）。

2. **Day3「夜之王」完整即時制戰鬥**：套用房間設定選好的夜王（`meta.resolvedNightBossId`），
   `meta.day3StartAt` 一旦設定（既有「全員按準備」流程觸發）就用固定 id `"day3Boss"`
   建立 `fieldTrigger`/`fieldEnemyHp`（`rollAndAssignDay3Boss()`），刻意沿用跟一般強敵
   籌碼完全相同的 shape（sentinel `enemyFamilyId="night_boss"`，`enemyId=`夜王 id），
   因此既有「進入戰鬥→3秒讀取」流程、攻擊排程（`maybeStartEnemyAttack`/
   `maybeFinishEnemyAttack`）、反應窗口／命中判定（`updateMyIncomingAttack`/
   `resolveMyIncomingHit`）、Guard Point／HP 損害管線（`recordGuardReductionForPoint`/
   `applyDamageToFieldEnemyHp`）全部原樣沿用，只在資料來源分流的幾個點新增夜王分支：
   - `guardDataForTrig(trig)`／`bossHpMax(bossId)`：讀 `night_boss_rulebook.js` 已結構化
     的 `guardCount`/`guardValueTable`/`hpBoxes`（跟一般敵人 family 同構或已加總換算，
     不需要另外解析格數字串）。
   - `pickAndResolveBossAction(bossId, trig)`：**直接呼叫 night.js 既有的自動化 GM 純函式
     模組 `window.PriTestAutoGm`**（`auto_gm.js`／`boss_auto_gm_data.js`，回合制原本用來
     自動判定夜王招式的模組），沿用同一套「依骰面找對應行、formAware 夜王依目前形態找
     對應範圍、`guardBroken` 後行動激化＋N 骰」邏輯，不重新發明夜王招式解析規則。
     roster/aggro/front 用 `bossAutoGmBattleState()` 換算成該模組期待的陣列形狀。
   - `renderFieldEncounterPanel()`：夜王分支改讀 `night_bosses.js` 的圖片名冊（跟房間設定
     「夜王」選單同一份資料），不是 `window.PriTestEnemies`。

   **誠實劃定的「完整版」邊界（不自行發明數值，CLAUDE.md §19）**：
   - 亂戰傷害一律視為「每個被選中的人各自承受這個數字」，不做規則書「N人份加權共享
     同一個傷害池」的精確配分（`window.PriTestAutoGm` 雖有 `splitGroupSharesWeighted()`
     可用，但該模組自身註解已說明目前資料全是「重量一致」的單一權重群組，等效於均分，
     這裡選擇不均分、維持跟一般敵人現有 UX 一致）。
   - 一招若同時有亂戰傷害＋額外個別傷害兩種效果，只採用亂戰傷害；即時制沒有前衛/後衛
     概念，`targetRule` 的 `frontAll`/`backAll`/`majorityAreaAggroMax` 等一律退化成
     「全體現有參與者」（`bossAutoGmBattleState()` 把 `front` 陣列全設 `true`）。
   - `row.conditions`（例如 `special_levitate` 等純敘述性特殊效果、規則書數值/門檻無法
     從既有資料確認的機制，如毒性の卵、発狂の種、瓦礫生成等）一律不自動計算，改成在
     警示疊層顯示規則書原文 note（新增 `#midnight-incoming-attack-note`），交由玩家自行
     判斷，比照 CLAUDE.md「■」處理方式。
   - **形態轉換**：gladius（合體/分裂）用動作觸發（`row.conditions` 含
     `"form_change_at_end_phase"` 就立即切換，不重灌 HP/Guard，即時制沒有階段可以等）；
     harmonia／stragedes／nameless（第一/第二形態）用 HP 歸零觸發（`maybeResetBossFormOnDefeat()`，
     切換形態時全回復 HP/Guard、清空屬性異常蓄積，只有第二形態 HP 歸零才是真正擊敗）。
     所有夜王一律用**單一聚合 HP 池**（`hpBoxes` 加總×10）取代規則書原本的多列 HP UI——
     這是唯一無法忠實呈現的細節僅限 gladius 分裂形態「傷害÷3同時套用到3個個體、任一
     個體歸零就轉回合體」，其餘 9 隻夜王的核心戰鬥迴圈（選招/傷害/Guard/形態轉換）完整
     忠實呈現。
   - `handleRestartCycle()` 新增清除 `fieldTrigger`/`fieldEnemyHp`/`attributeAccum` 的
     `day3Boss` 節點（這幾個節點不像 `meta.*` 會隨整個覆寫自動清空）。

3. **進場動畫不完全覆蓋、靈鷹沿地圖外圈繞兩圈**：`#midnight-intro-overlay` 背景改成
   半透明（原本不透明擋住底下地圖），靈鷹／3個隊員小圓點的軌跡從抽象 CSS keyframe
   改成 `positionIntroFlyers()` 逐幀依真實地圖座標（`map.dayPlan.day1.start` 換算成
   canvas 螢幕座標）計算：前 80% 進度沿地圖外圈（半徑＝畫面尺寸 62%）順時針繞兩圈
   （720度），後 20% 收斂降落到起始地點。

4. **樓層獎勵清單**：`weapon`/`consumable`/`talisman` 三種 kind 改成兩段式（先「抽選」
   按鈕、抽完才顯示結果並鎖住按鈕），武器抽選結果改呼叫既有 `renderWeaponSheetDetail()`
   （稀有度色點/傷害估算/戰技完整資訊），消耗品/裝飾品新增顯示效果本文
   （`Consumables.localizedText(item.body)`/`Talismans.localizedText(item.body)`），
   新增「丟棄」按鈕（`discardRewardEntry()`，只標記已處理不套用效果）。`potentialPower`
   兩顆抽選按鈕也改成抽完就 disable，不能重抽。

5. **強敵參與限制**：`rollAndAssignFinalCircleBoss()` 的 `participants` 改成只納入
   `slotsInsideFinalCircle(phaseInfo)`（實際在最終小圓內的席位），取代原本無條件
   `occupiedSlots()`（全體）；`handleBlessingEnterClick`/`handleMerchantEnterClick`/
   `handleTowerEnterClick`/靈鳥飛行/拾取掉落物等所有「靠近籌碼→進入」入口都新增
   `activeEncounter` 守衛，戰鬥中無法開啟其他籌碼互動。

6. **Day1／Day2 夜之強敵戰後 HUD**：Day1 新增專屬區塊（`#midnight-hud-day1-rewards-row`，
   只有祝福＋離去，沒有商人），Day2 既有區塊新增「離去」按鈕——兩者的「離去」都只是
   本地端旗標（`day1RewardsDismissed`/`day2RewardsDismissed`），不影響 Day2 既有的
   「準備開始夜王戰鬥」列（party-wide gate，不受離去影響）。

7. **黃光提示**：地圖按鈕的 `mapIconNudge` 新增「換日」觸發點（`lastKnownDayForMapNudge`
   邊緣偵測），角色按鈕新增 `renderCharacterIcon()`（沿用跟遺物學習區塊相同的
   `learned < relicMaxLearnable(level)` 判斷式），CSS 直接重用同一個
   `midnight-map-icon-nudge-pulse` keyframe。

8. **暫停繼續讀取條**：新增 `#midnight-resume-countdown-row`（上方資訊欄），JS 逐幀依
   `RESUME_COUNTDOWN_MS` 算 `style.width` 百分比（不套用寫死 0.5 秒的
   `.midnight-loading-fill-animate`），跟原本的 `#midnight-pause-overlay` 全螢幕文字
   倒數並存。

---

## 9. 2026-09-10 新增：「L補」（等級補正）——即時制專屬換算，取代先前「無通用resolver」的簡化

`fields_data_1~4.js`／`event_rulebook.js` 大量敵人等級／撃破ルーン標注都帶有「+L補正」
「＋L補」後綴（例如「Lv.2+L補」「撃破ルーン：8 + L補正」）。先前因為全專案沒有通用的
resolver，依 CLAUDE.md §19 一律略過不套用（見本文件先前版本 §1.2 註解、`midnight.js`
`METEOR_ENEMY_LEVEL` 等常數旁的既有說明）。使用者這次提供了即時制專屬的明確換算公式，
已改為真正套用（回合制 `night.js` 的 `fieldLevelCorrectionForSlot()`——依樓層在盤面的
欄位位置決定——維持不變，是完全不同的兩套 L 補公式，各自服務各自的系統）：

- **公式**：每次「開始縮圈」L 補 +1。第1天縮圈1次＝1、縮圈2次＝2；第2天縮圈1次＝3、
  縮圈2次＝4；第2天結束後（含 Day3）維持 4，沒有更多縮圈可以推進。純函式
  `currentLBonus(phaseInfo)`，直接由已經共享同步的 `meta.sessionStartAt`／
  `meta.day2StartAt`／`meta.day3StartAt` 推出的 `phaseInfo.day`/`stage` 決定，不需要另外
  用 RTDB 計數器，天生不會有多裝置競速累加的問題。
- **套用範圍**：只套用在規則書文字本身確實標注「L補」的敵人/獎勵，不擴大套用到其他
  敵人：一般板塊樓層敵人引用（`scanLinesForEnemyMatches`，沿用 `night_gm_flow.js`
  `parseCombatEnemyRef()` 既有的 `needsLevelCorrection` 偵測）、強敵籌碼決定表
  （`rollAndAssignStrongEnemy()`）、隨機事件「襲撃」分支的忌み鬼／兆し／調律の魔物
  （`renderAmbushBossBranch()`）。隕石（メテオ）敵人本身等級固定 Lv.8 沒有 L補正，但
  撃破ルーン文字有，因此只有 `maybeGrantMeteorReward()` 的盧恩數字套用、敵人等級不套用。
  強敵籌碼自身的擊破獎勵（`STRONG_ENEMY_REWARD_RUNES`／`TERRIFYING_STRONG_ENEMY_REWARD_RUNES`）
  跟調律の魔物的撃破ルーン（固定3）規則書文字都沒有「L補」字樣，維持不套用。
- **凍結時機**：L 值在敵人指派當下（`fieldTrigger` 建立那一刻）算好、跟 `level` 一起
  一次性寫入 `trig.lBonus`／`trig.level`，不是每影格重算——避免戰鬥途中剛好跨過縮圈
  開始的時間點導致敵人數值中途變動。
- **HP／Guard 效果**（使用者明確規格）：L 補正後的等級直接影響 `enemyRealHpMax()`
  既有的「格數 × 100」公式（2026-09-08 已經從 ×10 改為 ×100，見上方 §1.1 舊註解／
  `enemyRealHpMax()` 程式內註解，本文件標題雖仍留著舊版章節但程式碼已是 ×100）；另外
  `currentGuardCountForTrig()` 把 `trig.lBonus` 直接加到目前 Guard Point 上，上限夾在
  `guardMax`（該敵人 family 自己的 `guardCount` 上限，不會因為 L 補正而墊高上限本身），
  效果是「更難把 Guard Point 打到低於原本上限」。

---

## 10. 2026-09-10 新增：夜王〔開場〕〔結局〕敘述接上開局動畫／勝利彈窗

`static_src/worldview.js` 原本就有 10 個劇本各自的〔開場〕〔結局〕完整敘述文字（`night_king_1`
〜`night_king_10` section），`night.js`（回合制）開局會自動播放〔開場〕
（`night_gm_flow.js` 的 `maybeShowOpeningNarration()`），但一直沒有對應的〔結局〕播放時機、
`midnight.js` 也完全沒有讀取這份資料——先前 `#midnight-day3-boss-intro-overlay`（Day3 王戰
進場前的「前言敘述」欄位）雖然已經預留了 UI，卻是去讀 `night_boss_rulebook.js` 一個從未
填過資料的 `boss.intro` 欄位，導致這段文字永遠隱藏。

- **重構**：`night_gm_flow.js` 的 `extractOpeningText()` 內部改成用 label 文字（"オープニング"／
  "エンディング"）比對取段落，不再用「第 N 個 label」這種位置索引——逐一核對後發現大多數
  劇本在開場跟結局中間還夾了第三個 label「夜の王（3日目のボス戦闘）」（王戰場景描寫，不是
  結局），位置索引會在多數劇本誤取到這段。新增 `extractEndingText()`／純函式版本
  `resolveNightKingNarrationText(bossId, "opening"|"ending")` 並匯出給 `midnight.js` 直接呼叫
  （不重新複製一份 worldview.js 解析邏輯，CLAUDE.md §10）。
- **Day1 開局進場動畫**：`#midnight-intro-overlay` 新增 `#midnight-intro-boss-text`，在
  `renderIntroBossText()`（進場動畫剛開始顯示的那一刻算一次，不是每影格）用
  `bossIdForResolvedScenario(meta.resolvedNightBossId)` 換算出的 bossId 呼叫上述函式，顯示在
  既有「靈鷹正載著眾人飛向夜之地圖……」文字上方。找不到資料時整段隱藏，不自行編造。
- **Day3 王戰進場前言**（修正既有但從未生效的功能）：`updateDay3BossIntroOverlay()` 改成呼叫
  `resolveNightKingNarrationText(trig.enemyId, "opening")`（`trig.enemyId` 對 day3Boss 而言
  本來就是 bossId，見 `rollAndAssignDay3Boss()`），不再依賴不存在的 `boss.intro` 欄位。
- **Day3 勝利彈窗**（全新功能）：`day3BossDefeated()` 是既有但先前完全沒有呼叫端的純函式，
  新增 `updateGameVictoryModal()`／`#midnight-game-victory-modal`，擊敗後顯示對應劇本的
  〔結局〕全文，關閉只是本地端旗標（`gameVictoryDismissed`，同 `day1RewardsDismissed` 既有
  模式），不影響共享的 `fieldTrigger`/`fieldEnemyHp`。`handleRestartCycle()` 重置這個旗標。
- **腳本載入**：`midnight_page.py` 的 `extra_scripts` 原本沒有 `worldview.js`（`night_gm_flow.js`
  內部讀 `window.PriTestWorldview`，缺少這個腳本會讓整段功能靜默失敗、回傳 null），已補上，
  順序排在 `night_gm_flow.js` 之前。
- 10 個夜王的開場/結局文字長度落差很大（例如 nameless 開場超過 1000 字，其餘多數僅一兩百字），
  相關容器（`#midnight-intro-boss-text`／`#midnight-day3-boss-intro-text`／
  `#midnight-game-victory-text`）都加了 `max-height`+`overflow-y:auto`，避免長文字把版面撐爆。

---

## 11. 2026-09-10 修復：Day3 夜之王完全不會自動攻擊（根因：`<script>` 載入順序）

使用者回報「進入夜王戰後，夜王沒有自動攻擊」，用瀏覽器實機重現後（見下方「除錯用debug hook」）
在 console 抓到每次都會噴出的例外：

```
TypeError: Cannot read properties of undefined (reading 'localizedText')
    at Object.rollEnemyAction (auto_gm.js:110:27)
    at pickAndResolveBossAction (midnight.js:...)
```

**根因**：`auto_gm.js` 檔案頂部用 `var Enemies = window.PriTestEnemies;` 在模組載入當下
（`<script>` 標籤執行的那一刻）就把值取一次快照，不是每次使用時才讀 `window.PriTestEnemies`。
`site_src/midnight_page.py` 的 `extra_scripts` 把 `"auto_gm.js"` 排在
`"enemies_data_1~4.js"`／`"enemies.js"` **之前**（`night_page.py` 的順序是正確的：`enemies.js`
在 `auto_gm.js` 之前），導致 `auto_gm.js` 執行那一刻 `window.PriTestEnemies` 還不存在，
`Enemies` 永遠是 `undefined`——不管後來 `enemies.js` 有沒有載入完成都救不回來（`var` 只在
宣告當下賦值一次）。

**為什麼表現成「完全不攻擊」而不是「偶爾出錯」**：`midnight.js` 的
`maybeStartEnemyAttack()` 把整個選招/算傷害流程包在 `GameStorage.rtTransaction()` 的 updater
函式裡，這個函式對 Day3 夜王一定會呼叫 `pickAndResolveBossAction()` → `AutoGm.rollEnemyAction()`
→ `Enemies.localizedText(bossInfo.name)`，因此**每一次**都會拋出例外，transaction 的 promise
變成 reject 而不是 resolve，導致 `.then(){ enemyAttackStartAttempted[pt.id] = false; }`
永遠不會執行——本地節流旗標 `enemyAttackStartAttempted[pt.id]` 卡在 `true`，
`maybeStartEnemyAttack()` 從此对這個地圖點直接提前 return，永遠不會再嘗試。10 隻夜王共用
同一套 `pickAndResolveBossAction()`，因此這是全部 10 隻都會發生的系統性 bug，不是特定夜王
的資料問題（先前用純靜態分析誤以為 gnoster/gnoster 缺少 `groupDamage`/`individualDamage`
欄位的少數行可能是原因，實際核對後那些是規則書「■」placeholder 的既有正確設計，見 §1 舊
註解，不是這次的真因）。

**修復**：`midnight_page.py` 把 `"auto_gm.js"` 移到 `"enemies.js"` 之後，跟 `night_page.py`
既有的正確順序一致。純腳本載入順序調整，沒有動任何戰鬥規則/數值。

**除錯用 debug hook**（`window.PriTestMidnight`，見 `midnight.js` 該物件旁註解，Playwright
測試專用、不對外公開文件化）：這次除錯過程中發現瀏覽器自動化工具驅動的分頁若不在前景
（`document.hidden===true`），Chrome 會節流/暫停 `requestAnimationFrame`，導致 `frame()`
幾乎不會被呼叫、遊戲卡在原地不動——這是測試環境的既有限制，不是遊戲本身的 bug。因此新增：
- `_tick()`：手動呼叫一次 `frameInner(Date.now())`，繞過 rAF 節流直接推進一影格。
- `_debugTakeover(slot)`：跳過 `window.prompt()` 密碼輸入直接接管席位（重構出
  `performTakeover()` 供 `handleTakeover()`／這個debug hook共用，不重複邏輯）。

這兩個 hook 讓之後要在無頭/背景分頁環境重現類似「進到後期天數才會發生」的 bug 時，
不需要真的等 10~20 分鐘的縮圈時間，可以直接改寫 `meta.day2StartAt`/`meta.day3StartAt`
等欄位＋手動 tick 快速跳到想測試的階段。

---

## 12. 2026-09-10 優化：開場鳥圖示／banner 疊層／迴避防禦配色／weaponStar 獎勵／規則文本轉換

本次涵蓋使用者明確要求的 5 個項目，其中第 4 項另外連帶修正了 `night.js`（回合制）側的
同源錯誤。

### 12.1 開場動畫的鳥改用流程簡介那隻🦅、放大 3 倍

`site_src/midnight_page.py` 的 `#midnight-intro-bird-wrap` 內容從 inline SVG 剪影
（`#midnight-intro-bird-svg`，已整組移除）換成 `#midnight-intro-bird-glyph`，內容是跟流程簡介
示意畫布 `#midnight-flow-intro-demo-bird` 完全相同的 🦅 字符，`font-size: 4.2rem`
＝那邊 `1.4rem` 的 3 倍。飛行軌跡（`positionIntroFlyers()` 逐幀寫入 inline `left/top`，
順時針繞地圖外圈兩圈後降落到起始地點）完全不變。

### 12.2 樓層資訊 banner 與左上／右上 HUD 的疊層優先權

使用者明確規格：「banner 平時高於左上角色與右上導覽；戰鬥時左上／右上才蓋過 banner，戰鬥結束、
離開等等會回復正常；若點了左上角色 HUD 或右上導覽 HUD 會暫時蓋過 banner，3 秒後跳回」。

2026-09-10 稍早的修正是把 `#midnight-hud-top-left/right` 一律拉到 `z-index: 620`（高於 banner
群組的 600），這次改成兩段式：

- 平時：兩塊回到 `500`（跟其餘角落 HUD 同高）→ banner（600）在上。
- 戰鬥中，或剛點過這兩塊 HUD 的 3 秒內：`midnight.js` 的 `updateHudStackingUI()` 在
  `<html>` 掛上 `midnight-hud-above-banner`，CSS 才把兩塊拉到 620。

實作沿用既有的 `html.midnight-top-banner-collapsed` 同一套「單一全域旗標 → html class →
CSS 選擇器」慣例，z-index 數值全部留在 `style.css`，JS 不寫 inline z-index。
「戰鬥中」直接讀既有的 `activeEncounter`（`recomputeActiveEncounter()` 維護），因此敵人被打倒、
逃離、離開觸發範圍都會自動回復，不需要另外寫一套結束偵測。點擊偵測用 capture 階段的
`pointerdown` 掛在角落容器上，不逐顆按鈕綁——那兩塊的內容是 JS 動態重繪的。

`#midnight-menu-panel`（展開的導覽選單）刻意維持恆定 620：它只在玩家主動展開時顯示，
展開期間不該因為 3 秒計時到期就被 banner 蓋掉半截。

### 12.3 迴避／防禦按鈕改為草綠色

`#btn-midnight-dodge` / `#btn-midnight-block` 背景 `#7cb342`、邊框 `#4e7a22`，停用狀態用同色系
暗灰綠。這兩顆是「反應」類動作，跟同一排的攻擊／戰技／技藝（瀏覽器預設灰）區分開來，方便在
受擊反應窗口（2 秒）內一眼找到。

### 12.4 `weaponStar` 獎勵與 `potentialPower` 的 value 語意

**midnight 側的 bug**：`fields_data_*.js` 與 `TOWER_DICE_HAND_REWARDS` 的武器獎勵用的 kind 是
`"weaponStar"`，但個人待領取清單這條路徑（`pushPendingReward()` → `rewardEntryLabel()` /
`computeRewardDraw()` / `renderRewardDetail()`）原本只認得 `"weapon"`，導致清單上直接顯示未翻譯的
原始字串 `weaponStar`、按下抽選回傳空結果。共享獎勵那條路徑（`drawSharedRewardData()` 等）本來
就有處理，只有個人這條漏掉。已補齊，並順帶修正兩條路徑都忽略 `entry.categoryId` 的問題
（改用 `CharacterDrawer.drawWeaponFromCategory()`），`attributeTag` 也會寫進 `weaponAttributeTags`。

**`potentialPower` 的 value 語意（連帶修正 night.js）**：使用者 2026-09-10 明確確認——
「潛在之力★★」＝「★2 稀有度」**一次**抽選。`value` 是決定武器稀有度時要擲的 D6 顆數
（跟 `weaponStar` 相同），**不是抽選次數**。

`night_floor_breakthrough.js` 的 `buildFloorRewardTurnRewards()` 與 `night.js` 的
`handleTurnRewardAdd()` 原本把 `potentialPower` 跟 `consumable`/`talisman`/`weaponSkillReroll`
放在同一個「依 value 拆成 N 筆 value:1」的分支，等於把 ★2 降成兩次 ★1 抽選——傳給
`CharacterDrawer.potentialPowerDrawWeapon(c, starCount)` 的 `starCount` 從 2 掉到 1，
`lookupRarityBySum()` 的合計值分布改變、稀有度期望值下降。兩處都已改成「每人 1 筆、value 保持
原值」。`weaponSkillReroll` 的 value 確實是「可再抽選的次數」，維持拆分不變。

midnight.js 的 `renderPotentialPowerRewardDetail()` 本來就是把 `entry.value` 當 starCount 傳，
語意正確，不需要改，只補上註解避免未來被「順手改回去」。

### 12.5 規則文本轉換層（`static_src/midnight_text_adapt.js`）

使用者明確規格：「詳細資訊中雖然是原本文本的詳細，但是本規則多數套用情況不同，故在文本中也
盡量改換成應用在本規則內能夠讀懂的文本」。使用者另外確認了三個做法上的決定：

1. **做法＝混合**：以術語轉換表覆蓋全部資料，再對少數「轉換後仍讀不懂」的條目做重點覆寫。
   不在 `character_types.js` / `weapons_skills.js` / `consumables.js` / `talismans.js` 每一條
   加 `midnightBody` 欄位（條目數以千計）。
2. **不寫具體秒數**：即時制的持續時間／冷卻由 `midnight.js` 的常數決定，規則書本身沒有
   「1 回合＝N 秒」的換算依據，因此一律改寫成非數值敘述（「接下來的一小段時間內」）。
3. **只改顯示文字**：不動任何傷害／消耗／冷卻計算。

模組內容分三層：

- **術語轉換表**（zh / ja 各一套，en 走 ja fallback）：階段（行動／特殊／防禦／結束）、
  回合、編隊（前衛／後衛）、體力骰等回合制用語換成即時制說法。
- **補充圖例**：偵測到骰子消耗／使用次數／敵視／`■` 時，在本文最後補一行說明。換算依據全部
  取自既有常數與本文件（骰子 1 個＝體力 2、`■` 1 個＝10、使用次數→時間冷卻、敵視＝累積傷害
  最高者被優先鎖定），沒有發明新數值。
- **重點覆寫**（`BODY_OVERRIDES`，依效果**名稱**比對，沿用 `RELIC_CHOICE_CONFIG_BY_NAME` 的
  既有慣例——遺物效果的 id 是 `<typeId>-r<group>-<index>` 這種依角色類型產生的組合鍵，同一個
  效果在不同角色類型下 id 並不相同）：目前 3 個「本規則結構上不成立」的被動——體力骰帶入、
  防禦階段體力骰回復、回合中裝備變更免費——如實說明在本規則中不生效。

套用位置：角色視窗右側詳細資訊（`appendNameBody()` 是技能／技藝／被動／遺物效果／附帶效果／
消耗品／裝飾品的共同出口）、武器詳細（本文／連擊特典／戰技／戰技B）、獎勵抽選詳細、遺物習得
候補、消耗品與技藝 toast。

**重要限制**：`mnText()` 只能用在 `textContent` 賦值那一刻。`computeMidnightSkillCost()` /
`computeMidnightSkillDamage()` / `CharacterDrawer.parseActionCost()` 等解析函式吃的是規則書原文
的既有 pattern（「骰子消耗：3」「HP回復：□□」），餵轉換後的字串進去會直接失配、把消耗與傷害
算錯。程式內註解已寫明這一點。

### 12.6 回歸測試

- `tools/midnight_check/optimize_2026_09_10_check.js`（`npm run test:optimize_2026_09_10`，
  Firebase Local Emulator 版）：涵蓋上述 5 項共 27 個斷言，含端對端的「戰鬥中 HUD 蓋過 banner
  → 敵人 HP 歸零後回復」與「weaponStar 抽選後武器真的進 `weaponIds`」。
- `tools/night_check/reward_value_semantics_check.js`（純 node，不需要 Playwright／emulator，
  只需先 `python generate.py`）：驗證 `floorRewardEntryToTurnRewards()` 對 `potentialPower`
  （★數，不可拆）／`weaponSkillReroll`（次數，要拆）／`weaponStar`（★數，正規化成 `weapon`）／
  `consumable`（個數，要拆）四種 value 語意的處理，避免這次的修正未來被改回去。

---

## 13. 2026-09-10 第二批優化：瀕死鎖定／按鈕版位／圓形冷卻／夜之強敵獎勵／連續攻擊

使用者明確要求的 8 個項目。

### 13.1 瀕死狀態下鎖住所有動作按鍵

各 handler 本來就有 `isSelfDowned()` 守衛（點下去靜默無效），但按鈕視覺上仍是可按的。
新增 `canActNow()`（`mySlot && !isPaused() && !isSelfDowned()`）作為所有動作類按鈕 `disabled`
的共同條件，涵蓋左右手攻擊／戰技／魔術祈禱／迴避／防禦／特殊防禦／高防禦／元素操控／
角色技藝與技能／聖杯瓶／消耗品／左右手換武器／逃離戰鬥。
角色視窗與選單按鈕**刻意不鎖**——使用者原始規格是「期間無法移動與使用任何物品，
僅能查看角色資訊與開啟選單」。

### 13.2 右下／左下 HUD 按鈕寬度固定

原本按鈕寬度完全由文字撐開，而文字在戰鬥中會變動（攻擊鍵連段第 3 擊變「Hit」、戰技鍵變成
「戰技(武器戰技名)」、技藝/技能鍵附加「(12s)」），每次變動都讓整排 `flex-wrap` 重排，
玩家正要按的按鈕會跑位。改成固定寬度（桌面 5.6rem／窄畫面 4.6rem）＋文字單行省略號。
`.midnight-action-flash`（浮在按鈕上方的[成功迴避]/[受到傷害]提示）刻意排除在省略規則外，
按鈕本身也不設 `overflow:hidden`，否則那個提示會被裁掉。

### 13.3 冷卻改用圓形背景計時盤

`abilityLabelWithCooldown()`（把「(12s)」接在按鈕文字後面）移除，改成
`applyCooldownDial(btn, c, cooldownField, totalMs)`：掛上 `.midnight-cooldown-dial` 並逐幀寫入
CSS 變數 `--mn-cd`（已經過的百分比）。CSS 用 `conic-gradient` 從 12 點鐘方向順時針掃，
已經過的區段透明（露出按鈕原本底色）、未經過的區段蓋一層淡色 —— 視覺上是「淡色順時針褪去、
轉完一圈恢復原本顏色」。放在 `::before` 而非 `background`，才不會蓋掉按鈕自己的背景色
（例如迴避／防禦的草綠色）。冷卻總長度用 `abilityCooldownTotalMs()`，跟
`useCharacterAbility()` 算 `baseCooldownMs` 是同一行判斷，不重複定義。

### 13.4 夜之強敵：使用祝福開窗、擊破獎勵

**使用祝福**：HUD 的 `handleHudBlessingUseClick()` 原本只做 `applyBlessingRestore()` ＋開放升級
額度＋toast，沒有開任何視窗——但升級用的等級±列住在 `#midnight-blessing-modal` 裡，而地圖籌碼版
的祝福視窗只有靠近祝福籌碼時才打得開，等於玩家拿到升級額度卻找不到地方用。補上
`openBlessingModal(true)`（新增 `allowWithoutChip` 參數跳過 `nearbyBlessing` 守衛），跟籌碼版走
同一個視窗、同一套升級流程。

**擊破獎勵**：在此之前夜之強敵（`finalCircleDay1`／`finalCircleDay2`）擊破後**完全沒有任何獎勵**
——`maybeGrantStrongEnemyReward()` 只掛在 strong_enemy 籌碼的掃描路徑上，這條全域判定的戰鬥
從來沒接上獎勵。新增 `maybeGrantFinalCircleBossReward()`，獎勵直接讀
`fields_data_1.js` 的 `a_golden`（黃金樹之帳）對應 branch 的樓層 `reward` 陣列，不另外編數字：

| | 獎勵 |
| --- | --- |
| 第 1 天 | 附帶效果×1 ＋ 擊破盧恩 10 |
| 第 2 天 | 附帶效果×1 ＋ 擊破盧恩 15 ＋ 石劍鑰匙×1 |

發放沿用 `maybeGrantStrongEnemyReward()` 同一套 first-writer-wins transaction
（`fieldTrigger/{id}/rewardGrantedBy`），push 對象是 participants 內所有玩家。
**呼叫位置**：必須放在 `updateFinalCircleBoss()` 那道「trig 已 resolved 就 return」的早期
return 之前，否則有席位的玩家永遠執行不到。

資料裡的「附帶效果×1」原本是 `kind:"note"`、本文寫「請使用潛在之力視窗的附帶效果抽選功能處理」
——那是給回合制 GM 看的指示，midnight 沒有 GM。使用者明確選擇「新增獎勵 kind，直接抽附帶效果」，
因此新增 `kind:"attachedEffect"`（`renderAttachedEffectRewardDetail()`），完全重用
`CharacterDrawer.rollPotentialPowerAttachedEffect()` ／ `commitAttachedEffectChoice()` 這兩支既有
helper，不新增第三套附帶效果抽選機制（CLAUDE.md §26）。判斷哪一筆 note 要轉成 attachedEffect
是用「本文含『付帯効果』／『附帶效果』」，不是寫死索引。

### 13.5 敵人連續攻擊、刀光方向、招式名稱

**連續命中**：2026-09-06 曾把 `hitCount` 寫死成 1（見 §1.2）。使用者 2026-09-10 明確要求恢復，
並指定兩組機率：

| 敵人 | 1 下 | 2 下 | 3 下 |
| --- | --- | --- | --- |
| 一般敵人 | 60% | 40% | — |
| 強敵／封牢／特殊強敵／夜之強敵／夜之王 | 50% | 30% | 20% |

分組判斷在 `isEliteEncounterPoint()`，全部用既有識別方式，不新增資料欄位：夜之王＝
`DAY3_BOSS_POINT_ID`；夜之強敵＝`finalCircleDay1/2`；強敵／封牢＝`pt.type`（`strong_enemy`／
`evergaol`）；特殊強敵＝既有的 `meta.terrifyingStrongEnemyPointId`（Day2「⑧恐るべき強敵」）；
另外把隨機事件「隕石」分支的王戰（`random_event` 且已指派 `enemyFamilyId`）也算進上位敵人——
它走的是跟強敵完全相同的戰鬥流程。
每一下各自有一個反應窗口，沿用早已存在但閒置的 `ENEMY_ATTACK_HIT_WINDOW_MS`（2.0／2.5／3.0 秒）。

**每一下的傷害**（使用者明確規格）：首擊全額，第 2 下以後每下半額
（`ENEMY_ATTACK_FOLLOWUP_HIT_DAMAGE_MULT = 0.5`），乘在「÷10 換算成即時制傷害」之後、
測試模式倍率之前，維持既有計算鏈順序不變。

**刀光方向**：原本只有單一寫死的 115deg 漸層，每次攻擊看起來完全一樣。改成 6 種變體
（角度＋落點各異），`triggerAttackEffect()` 每次隨機挑一種。純視覺、不影響判定，因此用本地
`Math.random()`，不同玩家看到的角度不同不會造成規則不一致。

**招式名稱不閃爍**：`#midnight-incoming-attack-name` 移除跟 ⚠ 圖示共用的閃爍 animation——
招式名稱是要「讀」的資訊，閃爍讓人來不及看清；⚠ 圖示本身的閃爍保留。

### 13.6 戰鬥中仍可打開角色視窗

`closeHudPanelsIfNightBossCombat()` 原本也會呼叫 `closeCharacterSheetModal()`，而該函式是由
`recomputeActiveEncounter()` **每影格**呼叫的，等於夜王／夜之強敵戰鬥期間角色視窗一打開就立刻
被關掉、完全無法查看裝備。改成只收起選單面板（那是暫停／流浪祝福等會打斷戰鬥節奏的操作入口）。

### 13.7 瀕死拯救值條配色

原本的淡藍 `#8fd6f5` 在深色 HUD 底（`rgba(10,12,18,0.72)`）上偏灰，又跟 FP 藍 `#4a8fd8`／
施法紫 `#b98af0` 容易混淆（使用者回報「暗色模式下可能不清楚」）。改成高飽和青色 `#29e0ff`
＋外發光，數值文字同色。倒扣顯示（`required - progress`，從滿條扣到 0＝可以再起）維持不變。

### 13.8 夜之強敵戰後的行動鎖定提示

Day1／Day2 夜之強敵擊退後的祝福／商人／離去區塊還開著時，地圖移動本來就已經被鎖住
（`rewardsMovementLocked()`，2026-09-08 既有行為），但畫面上沒有任何說明。新增
`#midnight-rewards-lock-banner`（「離去後才能開始行動……」），顯示條件直接沿用
`rewardsMovementLocked()`，兩者永遠一致，不會出現「banner 說被鎖住但其實能動」的落差。
跟其他上方 banner 同一組固定定位／折疊行為（已加入 `TOP_BANNER_IDS`）。

### 13.9 回歸測試

`tools/midnight_check/optimize_2026_09_10b_check.js`（`npm run test:optimize_2026_09_10b`）：
31 個斷言，涵蓋上述 8 項。其中連續命中的機率分布用新增的測試用 debug hook
（`_debugPickEnemyAttackHitCount` ／ `_debugIsEliteEncounterPoint`，沿用 `_debugTakeover` 等既有
慣例）各取樣 4000 次驗證，因為那段邏輯平常包在 `rtTransaction` 的 updater 裡、每 2~4 秒才跑
一次，靠實際遊玩取樣根本測不出分布。

**測試撰寫上的已知陷阱**：驗證「夜王級戰鬥」時要用 `finalCircleDay1` 而不是 `day3Boss`。
`updateFinalCircleBoss()` 對 `finalCircleDay*` 不需要任何座標接近判定（stage 是 waitingForDay2
且 trig resolved 就會設 `nearbyFinalCircleBoss`），而 `day3Boss` 那條路徑會跟
`recomputeActiveEncounter()` 的候選優先序（`nearbyFieldPoint` 排在 `nearbyDay3Boss` 之前）互相
干擾，實測會隨地圖種子／出生點不同而時好時壞。`activeEncounterIsNightBoss()` 是依「點 id」
判斷（`day3Boss` 或 `finalCircleDay*`），所以兩者走的是同一條程式碼路徑，驗證效力相同。

---

## 14. 2026-09-10 修復：Day3 夜之王戰鬥偶發卡關（根因：遭遇候選優先序）

**現象**（使用者回報）：Day3 王戰開始時，玩家人若剛好停在地圖上某個板塊點旁邊，王戰就開不
起來——`activeEncounter` 一直是那個板塊點，永遠不會變成 `day3Boss`。是否發生取決於地圖種子
與玩家當下位置，因此表現成「時好時壞」的偶發卡關（本專案的回歸測試也曾因此隨機 SKIP）。

**根因**：`recomputeActiveEncounter()` 的候選優先序原本是

```js
var candidate = nearbyFieldPoint || encounterEnemyPoint() || nearbyCastlePoint || nearbyFinalCircleBoss || nearbyDay3Boss;
```

夜之王排在最後。只要腳邊有任何一個板塊點／籌碼點／王城範圍，它就一直贏得候選權，
`nearbyDay3Boss` 永遠輪不到。

**修正**（兩半）：

1. **候選優先序**：把 `nearbyDay3Boss` 提到最前面。它只在「`meta.day3StartAt` 已設定、王還
   活著、自己有席位」時才非 null（見 `updateDay3Boss()`），因此提前不影響其他任何時期。
   **刻意只提夜之王、不動 `nearbyFinalCircleBoss` 的位置**：夜之強敵有一條明確的既有規則
   「縮圈完後，仍在卡牌樓層探索的不受進入夜之強敵影響，直到該名也正式進入夜之強敵戰鬥」
   （見 `slotsInsideFinalCircle()` 說明），而「地圖點排在夜之強敵前面」正是實現那條規則的
   機制，改動會破壞它。Day3 沒有對應的規則——王戰一開始就是全員的。

2. **防止意外**（使用者原話「先修防止意外」）：王戰進行中，`updateNearbyFieldPoint()` 與
   `updateNearbyCastle()` 不再把板塊點／王城認定為 nearby（走跟「觀戰者／靈鳥飛行中」相同的
   既有清空分支，不另寫一套）。只做第 1 點的話，上方資訊欄仍會在王戰中繼續跳出板塊「進入」
   按鈕，玩家一按就會在最終王戰裡開啟一層樓層探索（邀請→打字機→投票→指派敵人的完整流程）。
   Day3 本來就沒有板塊探索的概念（既有程式已這樣認定，見 `finishRevive()` 的
   `phaseInfo.day !== 3` 判斷）。

**順帶修正的測試盲點**：`_debugState()` 原本只匯出 `recomputeActiveEncounter()` 5 個候選來源
中的 3 個（缺 `nearbyCastlePoint`／`nearbyFinalCircleBoss`／`nearbyDay3Boss`）。先前寫的回歸
測試讀這些欄位時拿到的永遠是 `undefined`，相關斷言等於空轉。三個欄位都已補上匯出。

**回歸測試**：`tools/midnight_check/day3_boss_priority_check.js`
（`npm run test:day3_boss_priority`），7 個斷言。測試刻意先用 `walkNear()` 把角色走到板塊點
旁邊（＝重現當初會卡住的前提）才開啟王戰，並額外驗證上述第 1 點沒有把夜之強敵的既有規則
一起改壞（站在板塊點旁時不會被強制拉進夜之強敵戰鬥）。

---

## 15. 2026-09-10 第三批優化：瀕死救起／獎勵共享分流／技能傷害倍率／武器戰技詳細

使用者明確要求的 6 個項目。

### 15.1 修復：瀕死被隊友救起（根因：席位面板不會因 `nearDeath` 重繪）

**現象**：使用者回報「瀕死被救起時應該原地繼續、原本在戰鬥的仍留在戰鬥」。用兩台裝置
實機重現後發現，真正的問題是**根本救不起來**——瀕死者的隊友畫面上完全不會出現
⚠ 警示與 [指定] 按鈕。

**根因**：瀕死狀態存在 `character/{tokenId}/nearDeath`，但畫這三樣東西的
`renderOccupiedSlotCard()` 只由 `renderLobby()` ／ `renderPlayersPanel()` 呼叫，而
`onCharactersReceived()` 原本沒有重繪席位面板（只重繪角色面板與角色視窗）。
HP 歸零的流程是「`demoStat` transaction commit →`.then()`→`maybeTriggerNearDeath()`
寫 `nearDeath`」兩筆分開且順序固定的寫入，因此 `onDemoStatsReceived()` 觸發的那次重繪
**必定發生在 `nearDeath` 抵達之前**，之後除非剛好有別人受傷再觸發一次 `demoStat` 變動，
否則按鈕永遠不會長出來。結果是瀕死者只能等 15 秒逾時強制復歸——那條路徑會消耗流浪祝福、
把人傳送到最近的祝福點、也就脫離了原本的戰鬥，正好是使用者看到的現象。

**修正**：`onCharactersReceived()` 補上 `renderPlayersPanel()`（未開局時走 `renderLobby()`，
沿用 `onPlayersReceived()` 既有的分流寫法）。隊友復歸傷害救起的既有行為本身沒有問題
（`finishRevive(tokenId, false)` 不移動位置、只回半血、不消耗流浪祝福），修好可見性後
「原地繼續、仍在戰鬥」就自然成立，已用回歸測試驗證。

### 15.2 獎勵分流：`perPerson` 依規則書原文逐筆稽核

使用者明確指正：「規則書並不是每筆獎勵都 perPerson。寫『每人各獲得』就是 perPerson；
『消耗品獲得 2 個』就是 false，三個人總共拿兩份」。

- 稽核方式：`floor.lines` 就是規則書原文，對每筆 reward 取出含該獎勵關鍵字的「句」，
  判斷關鍵字之前是否有配布語（それぞれ／各自／全員／1人につき／PC人数と同じ数）。
  「全員」有配布（PC全員は〜を1つ獲得）與條件（行為判定に全員成功時のみ）兩種用法，
  後者不計入。「そうするごとに」承接前一句的配布語（商人的「1人につき1回、ルーン1で鍛石1つ」）。
- 盧恩與聖杯瓶使用回數沿用 `night.js` 既有分類
  （`TURN_REWARD_ALL_TARGET_KINDS = ["chaliceBonus", "rune"]` ＝全體一律付與）固定為每人一份，
  不靠文字判斷。
- 結果：614 筆可分流獎勵中，48 筆與原本標記不符已修正（`fields_data_3/4.js`）。
  `midnight.js` 的 `isPerPersonRewardEntry()` 也從「未標記＝每人一份」改為
  「未標記＝依 kind 的既定值」（rune／chaliceBonus／potentialPower／attachedEffect 每人一份，
  其餘實體物品為固定數量的共有物）。
- `pushSharedReward()` 新增「個數語意的 kind（consumable／talisman／stoneswordKey／
  smithingStone／weaponSkillReroll）依 value 拆成 N 筆」——不拆的話「消耗品 2 個」只會
  產生 1 筆可投票項目、憑空少一份。`weaponStar`／`potentialPower` 的 value 是★數，
  **絕對不拆**（見 §12.4 的同款教訓）。
- 夜之強敵（黃金樹之帳）擊破獎勵 `maybeGrantFinalCircleBossReward()` 也改走同一套分流，
  原本無條件對每個 participant 各發一份，等於把「石劍鑰匙×1」發成人數倍數。
- 回歸測試：`tools/midnight_check/reward_perperson_check.js`（純 node，
  `npm run test:reward_perperson`）重新用規則書原文算一次並比對資料，防止之後被改回去。

### 15.3 戰技／魔術／祈禱 ×2、角色技藝／技能 ×3

使用者明確規格，並指定「只在實際造成傷害時乘，顯示維持原值」。因此倍率不進
`computeMidnightSkillDamage()` ／ `computeMidnightAbilityDamage()`（那兩支同時服務武器
詳細資訊與 toast 顯示），只乘在呼叫 `damageCombatTarget()` 的那一行：

| 倍率 | 常數 | 套用位置 |
| --- | --- | --- |
| ×2 | `WEAPON_SKILL_DAMAGE_MULT` | `castWeaponSkillEntry()`（戰技A／戰技B／杖・聖印的魔術祈禱共用這唯一入口） |
| ×3 | `CHARACTER_ABILITY_DAMAGE_MULT` | `useCharacterAbility()`（`character_types.js` 的角色專屬技藝／技能） |

**不套用**：一般攻擊、跳躍／衝刺特殊攻擊（習得型 Action 遺物，屬一般攻擊系）、消耗品、
召喚靈體、坩堝諸相・獸的襲擊／咆哮（變身中取代一般攻擊鍵的固定值動作）。

### 15.4 武器詳細資訊改為「依 weaponId 解析」，獎勵抽選也看得到戰技

`renderWeaponSheetDetail()` 的〔戰技〕區塊原本用
`CharacterDrawer.getEquippedWeaponSkillEntries(c)`——那支只掃 `c.equippedWeaponIds`，
因此**獎勵剛抽到的新武器（尚未持有）與角色視窗裡未裝備的武器，戰技永遠是空的**，
杖／聖印的魔術・祈禱也一樣看不到。新增 `weaponOwnSkillDisplays(c, weaponId, override)`
改以 weaponId 解析武器自身的戰技（重用 `collectWeaponSkillRefs` ／ `weaponSkillSlotKey` ／
`resolveRandomSkillDisplay` ／ `resolveWeaponSkillDisplay`，後兩支原本就有匯出，
前兩支這次新增匯出），random 戰技枠未決定時顯示「戰技：尚未決定（可在鍛造台決定）」
而不是靜默略過。

連帶：
- 共享獎勵池項目可以點選，右側顯示完整資訊（武器走同一支 `renderWeaponSheetDetail()`）。
- 「潛在之力」的得意武器卡片從只顯示名稱改為完整武器資訊，並用抽到的 random 戰技
  （`potentialPowerDrawWeapon()` 回傳的 `skillId`）當 override，讓玩家在按[選擇這個]
  之前就看得到會拿到哪個戰技。
- 獎勵清單左側選中的項目會高亮（`.midnight-reward-item-selected`，個人清單與共享池共用）。

### 15.5 鍛造台顯示完整新舊戰技

選定武器後的固定卡片改為附上完整武器資訊；新舊戰技比較欄從單一 `<p>` 的 textContent
改成由 JS 組出的節點（名稱＋種類＋規則本文＋Action 類的估計傷害黃字，重用
`appendWeaponSheetSkillEntry()`）。舊戰技為 null（該枠原本就沒決定過）時顯示「尚未決定」。

### 15.6 遺物效果稽核

見 `docs/midnight_relic_effects_audit.md`（本次新增）。結論：353 筆遺物效果中，
目前在 midnight 真正會發動的約 88 筆。本批順帶補上兩個「規則書寫明的無條件被動 ＋
既有 helper 已寫好解析」的缺漏：聖杯瓶回復量提升（`getFlaskHealBonus`）、
學習能力（精神／運氣／體能）（`getCheckStatBonus`，7 處判定與角色視窗顯示共用新的
`effectiveCheckDiceCount()`）。

### 15.7 回歸測試

`tools/midnight_check/optimize_2026_09_10c_check.js`（`npm run test:optimize_2026_09_10c`）：
13 個斷言，涵蓋上述 §15.1／§15.3／§15.4。其中傷害倍率是端對端驗證——先把共用標靶
（`demoStat/sharedTarget`，初始只有 20）改成 100000，再比對 toast 顯示值與實際扣血量。

---

## 16. 2026-09-11：遺物效果「2Hit攻擊的達人」接上攻擊消耗（冷卻10秒版）

使用者明確規格：規則書的「此效果1個階段中僅能發揮1次」＝即時制的**冷卻 10 秒**
（`TWO_HIT_MASTERY_COOLDOWN_MS`）。

- 消耗覆寫值沿用 `CharacterDrawer.findTwoHitMasteryOverride()`（既有純函式），
  該 helper 這次新增回傳 `hitType`，因為鐵眼「2Hit攻擊的達人（弓）」效果名寫 2Hit、
  本文改的卻是 1Hit 消耗。night.js 只用 `value`／`label`，行為不變。
- 發動條件：對應 hit 類型 ＋ 冷卻結束 ＋ **換算後更便宜**。最後一項是即時制專屬的取捨：
  規則書的消耗是骰子出目組合（換一種付法），midnight 直接把出目總和 ×2 當體力，
  換算後鐵眼（弓）與淑女（短劍）兩條反而更貴，無條件套用會讓有益的遺物變成懲罰。
  詳細理由與逐筆對照見 `docs/midnight_relic_effects_audit.md` §4.3。
- 冷卻存在 `character/{tokenId}/_twoHitMasteryCooldownUntil`（比照 `_skillCooldownUntil`），
  發動時 `showToast()` 提示效果名與變更後的消耗表記。
- 回歸測試：`tools/midnight_check/relic_two_hit_mastery_check.js`
  （`npm run test:relic_two_hit_mastery`），4 個斷言。
- 附帶產出：`docs/midnight_relic_effects_gaps_by_type.md`（依角色類型列出 245 筆尚未接上的
  遺物效果，供後續規劃），產生器 `tools/midnight_check/relic_effect_gaps_table.js`。

---

## 17. 2026-09-11 第二批：敵人體崩狀態／最低傷害／大批遺物效果接入

### 17.1 敵人「體崩」狀態（新機制）

使用者明確規格。累積來源沿用 Guard Point 下降用的同一組 ▲◆ 單位（▲=1／◆=2），但另存
`fieldTrigger/{id}/staggerUnits`——`guardUnits` 會在破防 5 秒後被回復流程歸零，體崩累積
不能跟著歸零。

| 項目 | 值 | 出處 |
| --- | --- | --- |
| 閥值 | 36 單位（＝6 次 Guard Point 下降） | 使用者 2026-09-11 選定 |
| 持續 | 3 秒（`STAGGER_DURATION_MS`） | 使用者明確規格 |
| 加速 | HP 百分比 **大於 40%、小於 60%** 時累積 ×3 | 使用者明確規格 |
| 效果 | Guard Point 一律以最低（0）計算＝減傷最少；期間敵人不發動任何攻擊 | 使用者明確規格 |
| 顯示 | 敵人圖片上方綠底「體崩中！！」橫幅 | 使用者明確規格 |

實作位置：`recordGuardReductionForPoint()`（累積與進入體崩）、`currentGuardCountForTrig()`
（Guard 視為 0，優先於 `guardBrokenAt` 與 L 補正）、`maybeStartEnemyAttack()`
（把 `nextAttackAt` 推遲到體崩結束，跟「終曲」的禁閉同一種處理，不是靜默跳過）、
`renderStaggerOverlay()`（每影格渲染，不能放進有 `lastRenderedEncounterKey` 快取的
`renderFieldEncounterPanel()`）。`staggerSeq` 每次進入體崩 +1，供致命一擊的
「同一次體崩只能一個人按一次」判定使用。

### 17.2 敵人最低遭受傷害 1 點

`applyDamageToFieldEnemyHp()`：減傷率 100%（HP 價值 100）或四捨五入後歸零時，至少扣 1。
原始 `amount` 本來就是 0（例如無法解算威力的招式）時不套用——那代表「這次本來就沒有傷害」，
不是被減傷吃掉。

### 17.3 遺物效果大批接入

新增 `RELIC` 名稱表與 `hasRelic()` / `countRelic()` 查詢層，加成注入既有計算點
（`computeSideAttackInfo()` / `computeMidnightSkillDamage()` / `computeCharacterAbilityDamage()` /
`updateStamina()` / `commitFlaskHeal()` / `resolveMyIncomingHit()` / `recordAttributeAccum()` 等），
不另建平行管線。重點如下：

- **蓄力攻擊**：接進既有的長按攻擊選單（跟跳躍／衝刺同一條路徑）。傷害＝1Hit＋10
  （習得 2 個以上再 +10），消耗＝該武器 1Hit 的骰子點數 **+1**（＝體力 +2，使用者確認）。
- **致命一擊**：體崩中才出現在敵人圖片上，需習得＋裝備近戰武器，整隊同一次體崩只有一人
  能按一次（`executionUsedSeq` first-writer-wins）。傷害 120（習得 2 個 +20 並回 HP/FP □）。
  規則書的「消耗：豹子（3個）」是骰池專有條件，即時制沒有骰池、使用者規格也只寫「按下即
  造成傷害」，因此不收費用。連動的「致命一擊獲得盧恩」＝全體 PC 盧恩 +1、一場戰鬥限一次。
- **時限型技藝強化**：「技藝強化（攻擊力強化／攻擊力提升／出血攻擊力強化）」三者結構相同，
  共用 `_relicAtkBuffUntil`（10 秒），效果為攻擊 1Hit+5／2Hit+10、戰技魔術祈禱 +10。
- **體力系**：「防禦階段開始時體力骰回復」→ 體力上限 +10；「回合結束時體力骰帶入1個」→
  體力 ≤10% 時回復 +2/秒；「連續攻擊時體力回復」→ 每攻擊 5 次 +5 體力；
  「連續攻擊時FP回復」→ 10 秒內攻擊累計消耗 40 體力時 FP +10。
- **開關型**：「聖杯瓶可回復FP」「一口氣飲盡」在角色視窗該效果的詳細資訊上方提供切換鈕
  （`appendRelicToggle()`，寫入 `_flaskFpMode` / `_flaskGulpMode`）。
- **選擇型**：「屬性蓄積值＋1」「屬性達成的歡喜」的習得選擇改為彈出視窗（每個選項一顆
  按鈕＋一顆隨機），選項資料仍取自既有的 `RELIC_CHOICE_CONFIG_BY_NAME`。
  「屬性達成的歡喜」的觸發改在 `onAttributeAccumReceived()` 各裝置各自判斷，才能符合
  規則書「不論由哪位PC累積」。
- **道具效果擴大**：對隊友的部分改用「寫一則指示到對方角色節點、由對方裝置自己套用」
  （`_sharedItemEffect`，跟既有 `_lastTileRewardNote` 同一種模式），因為 FP／體力／
  `_xxxUntil` buff 都是各自裝置的本地狀態，我的裝置寫不進去。
- **判定必過**：「最大加護提升」依使用者規格改成「自身的判定必定成功」
  （`checkSucceeded()`，只套用單人判定，協力判定不套用）。

### 17.4 已知不套用（刻意）

- **防禦成功時異常狀態蓄積無效**：midnight 的既有實作本來就只在「完全命中（kind==="hit"）」
  時才累積屬性／異常，防禦成功時本來就不會蓄積，這個遺物等於已被既有行為涵蓋，沒有另外加碼。
- **防禦反擊強化（斧槍）**：使用者把「防禦反擊」改成「下一次攻擊體力 -25%」的折扣制，
  原規則的「反擊傷害 +15」在折扣制下沒有對應的數值出口，維持不生效。
- **2Hit攻擊的達人（復仇者的咒爪）**：本文指的是特定**武器名**而非武器分類，而
  `findTwoHitMasteryOverride()` 是以分類名比對，這條在 night.js 與 midnight 都不會發揮
  （既有上游限制）。

### 17.5 回歸測試

`tools/midnight_check/relic_batch_2026_09_11_check.js`（`npm run test:relic_batch_2026_09_11`）：
18 個斷言，涵蓋體崩累積／加速倍率／持續時間／橫幅／停止攻擊／致命一擊全流程／最低傷害 1 點／
體力上限 +10／聖杯瓶回 FP 開關。

---

## 18. 2026-09-12：剩餘遺物效果全數接入（未接上 25 → 0）

使用者 2026-09-12 針對前一版缺口表逐條給了即時制對應規格，本批全部實作完成。
`npm run audit:relic_gaps` 產生的缺口表現在是 **0 筆**（353 筆全部都有生效路徑）。

### 18.1 A 組：異常狀態達成的歡喜（6 筆）

跟已實作的「屬性達成的歡喜」是同一支 `maybeApplyAttributeJoyRelic()`，差別只在
選擇欄位（`relicJoyAilmentChoice`）與回復量（□□＝20，屬性版是 □＝10）。
兩者同時習得時各自用自己的選擇與回復量結算，去重用的 `joyTriggeredCount` key
加上 `element` / `ailment` 前綴分開記。

### 18.2 B 組（使用者指定的即時制對應）

| 效果 | 即時制對應（使用者指定） | 實作位置 |
| --- | --- | --- |
| 連續攻擊時，產生總合傷害 | 10 秒內攻擊消耗 40/50/60/70 體力 → 總合傷害 +10/+20/+30/+40 | `comboBigDamageBonus()` → `relicAttackHitBonus()` |
| 斧槍旋風 | 10 秒內斧槍 2Hit 兩次 → 對雜兵 ■，副作用自身 HP −10（2026-09-12 追加） | `maybeApplyHalberdWhirlwind()` |
| 技能強化（防禦支援） | 旋風後 10 秒內全體 PC 減傷 10% | `meta.partyDamageReduce*` → `resolveMyIncomingHit()` |
| 盾構戰鬥的達人 | 刺突系＋盾時體力上限 +10 | `shieldFormationActive()` → `updateStamina()` |
| 致命一擊後，消失身影 | 致命一擊後體力 +10、該擊不計敵視 | `suppressAggroOnce` → `damageCombatTarget()` |
| 攻擊連續時，HP回復 | 10 秒內攻擊消耗 40 體力 → HP 回復 □ | `recordAttackForRelics()` |
| 技能強化（敵人弱化） | 逆襲後，敵人**下一個攻擊動作**亂戰傷害 −120 | `fieldTrigger.nextGroupDamageReduceAmount` |
| 技藝強化（堅陣） | 圖騰・史黛拉後 10 秒內全體 PC「HP價值 +20」 | `meta.partyGuardBonus*` → `currentGuardInfo()` |
| 祈禱輔助強化火力提升 | 用祈禱時進入火力提升，時限由 10 秒延長為 **60 秒** | `maybeApplyPrayerFirepower()`（共用 `_relicAtkBuffUntil`） |

`attackStaminaWindow` 改成純粹的 10 秒滑動視窗：現在有三個效果共用它
（連續攻擊時FP回復／攻擊連續時HP回復／連續攻擊時產生總合傷害），任何一個觸發就清空
會害其他兩個算錯，改用各自的「上次觸發時間」節流。

### 18.3 C 組

- 技能強化（血祭）／技藝強化（毒箭）：在 `applyRelicAbilityPostEffect()` 依 abilityId 追加屬性蓄積。
- 技能強化（僅微無敵）：接成特殊防禦選項（`availableSpecialDefenseOption()` 的
  `restageDefense` 分支）。規則書沒寫消耗，改成佔用「技能」冷卻，避免無限免費完全無敵。
- 靈體消滅時 HP／FP 回復：`maybeApplySpiritDeathRelics()`。**2026-09-12 補上觸發路徑**：
  使用者明確規格「復仇者有靈體時，受到傷害優先先扣除靈體，靈體陣亡後才開始扣復仇者」，
  因此 `resolveMyIncomingHit()` 在所有減傷算完、真正扣自己 HP 之前呼叫
  `absorbDamageWithSpirit()`——先扣靈體、溢出的部分才扣自己；靈體 HP 歸零當下清除靈體
  並觸發這兩個遺物效果。只套用在「受到敵人傷害」這條路徑，技能的 HP 代價／圈外扣血等
  自己造成的消耗不經過這裡（規則書寫的是「受到傷害」）。
- 技藝強化（以自身HP交換回復）：原文是「**可任選**」，因此做成角色視窗的開關
  （`_artHpExchangeMode`），開啟時使用不死行軍才會把自身 HP 設為 □ 並讓其他 PC 各回復 □×5。
- 使用通用消耗品時HP回復：5 種通用消耗品使用後自身 HP +□。
- 聖潔燈火／雷擊之步：這兩條在 `character_types.js` **缺 `variantEntry` 欄位**（隱者本體的
  4 個變體都有），導致習得後沒有任何發動入口。已補上資料——聖潔燈火共用隱者本體
  「聖光燈火」的 id（`hybrid_magic_holy_light`，`applyRelicAbilityPostEffect()` 已有處理），
  雷擊之步是 `kind:"Defense"`，自動接到特殊防禦選項。
- 防禦成功時，屬性蓄積無效：midnight 既有實作本來就只在「完全命中」時才累積屬性／異常，
  防禦成功時本來就不會蓄積，此效果已被既有行為涵蓋（無需額外程式碼）。
- 防禦反擊強化（斧槍）：改為「吃到防禦反擊折扣的那一擊，若揮的是斧槍則總合傷害 +15」
  （見 §17 的更正）。

### 18.4 混成魔法變體快速切換鈕

使用者明確規格「混成魔法按鈕旁邊多個切換按鈕，可以更快速選得想要發動的變體（需學習
該遺物效果才顯示）」。`#btn-midnight-skill-variant` 按一下循環到下一個已習得的變體，
寫的是跟角色視窗完全相同的 `c._selectedSkillVariantIndex`，不是另一套狀態；
沒有習得任何變體時自動隱藏。

### 18.5 回歸測試

`tools/midnight_check/relic_batch_2026_09_12_check.js`（`npm run test:relic_batch_2026_09_12`）：
11 個斷言（異常狀態達成的歡喜的 HP/FP +20、盾構戰鬥的達人的體力上限、防禦支援與堅陣的
party-wide 欄位、變體切換鈕的顯示/循環/隱藏）。

---

## 19. 2026-09-12 追加：靈體代受傷害／斧槍旋風副作用

使用者明確規格的兩個追加調整：

1. **靈體代受傷害**：復仇者有召喚中的靈體時，受到的傷害優先扣靈體 HP，靈體陣亡後溢出的
   部分才扣復仇者本人。實作 `absorbDamageWithSpirit()`，呼叫點在 `resolveMyIncomingHit()`
   裡「所有減傷（防禦百分比／逆襲・恍惚的暫時減傷／救世之翼／防禦支援）都算完之後、
   真正扣 demoStat 之前」。靈體 HP 歸零當下清除 `summonedSpirit` 並觸發
   「靈體消滅時 HP／FP 回復」兩個遺物效果（各 +□□＝20）。
   只套用在「受到敵人傷害」這條路徑——技能的 HP 代價、圈外扣血等自己造成的 HP 消耗
   不經過這裡（規則書寫的是「受到傷害」）。

2. **斧槍旋風的副作用**：觸發時除了對雜兵造成 ■ 之外，對自己造成 HP −10
   （`HALBERD_WHIRLWIND_SELF_DAMAGE`，走既有的 `spendSelfHp()`，因此 HP 歸零時會正常
   觸發瀕死判定）。

回歸測試：`relic_batch_2026_09_12_check.js` 增加到 17 個斷言，新增的 6 個涵蓋
「傷害全由靈體吸收時本人 HP 不變」「靈體陣亡後正確回傳溢出量」「陣亡後靈體被清除」
「靈體消滅時 HP 回復 +20」。測試用 debug hook：`_debugAbsorbDamageWithSpirit()`。
