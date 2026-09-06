# midnight（即時制擴張版）戰鬥數值現況整理

本文件記錄 `static_src/midnight.js`（搭配 `character_drawer.js` / `enemies_data_1~4.js`）
實際使用的戰鬥數值來源。**2026-09-06 已完成「數值真正接入」改版**：敵人 HP／攻擊／防禦、
玩家 HP／FP 上限全部改用規則書既有的結構化資料計算，不再是技術驗證片的固定佔位值。
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
