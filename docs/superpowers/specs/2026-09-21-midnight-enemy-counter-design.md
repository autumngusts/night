# midnight 戰鬥 防禦反擊型招式的反擊效果 設計文件

日期：2026-09-21
對象：`static_src/midnight.js`（即時制）／新增 `static_src/enemy_counter_rules.js`／新增 `tools/midnight_check/enemy_counter_check.js`
關聯文件：
- `docs/midnight_realtime_combat_numbers.md`（現行戰鬥數值與判定的權威紀錄）
- `docs/superpowers/specs/2026-09-21-midnight-sprite-combat-design.md`（sprite 動畫層，本設計沿用其 `meta.spriteMode` 閘門）

---

## 1. 背景

招式動畫補標（commit `eb43bfb`）把 430 個相異招式名裡的 426 名對應到 5 種攻擊動畫。
刻意留白的 4 名當中，有 3 名是**防禦反擊型**——它們沒有合適的攻擊動畫，因為它們的本質
不是「敵人打出一段攻擊軌跡」，而是「敵人擺出架式，等玩家出手再回敬」：

| 招式名 | 筆數 | mod | 目前動畫 |
|---|---|---|---|
| ガードカウンター | 3 | ＋120／－60／±0 | 未對應（退回 dmgKind 預設） |
| ハイガード＆ガードカウンター | 1 | －240 | 未對應 |
| バックラーパリィ | 1 | －60 | 未對應 |
| 弾き＆妖刀解放 | 1 | ＋120 | `line`（見 §3 說明） |

現行程式碼對這 4 名的處理與一般攻擊招式完全相同：抽到就發動一次 `enemyAttack`、
鎖定目標、跑 0.5 秒警示＋2 秒反應窗口。「反擊」這個語意在遊戲裡完全沒有表現。

## 2. 目標與非目標

### 目標

- 這 4 名招式發動後的 2 秒內，**對這隻敵人造成過攻擊的玩家會被快速反擊 1~2 下**。
- 反擊走既有的傷害鏈（Guard Point 減傷、屬性蓄積、遺物效果）不另開旁路。
- 判定邏輯與遊戲狀態解耦，可用純函式測試。

### 非目標（本設計明確不做）

- 不改規則書的傷害計算鏈（`resolveEnemyActionOutcome()`／`applyDamageToFieldEnemyHp()`）。
- 不新增 RTDB 欄位、不改 `enemyAttack` 的 schema。
- 不動這 4 名招式的動畫對應（維持 §1 表格現狀）。
- 不做敵方反擊的專屬 sprite 動畫（階段 2 素材產出後再議）。

## 3. 對象招式的判定

用招式名關鍵字 `/カウンター|パリィ|弾き/` 判定，命中上表 4 名共 6 筆。

`弾き` 是招架的和語，不加進關鍵字就撈不到 `弾き＆妖刀解放`。刻意寫成 `弾き` 而不是 `弾`，
是為了不把「魔力弾」「重力弾」「爆発光弾」等彈丸系招式掃進來——全 549 筆裡 `/弾き/`
只命中 `弾き＆妖刀解放` 這 1 筆（產生器的動畫關鍵字表用的是 `/弾/`，那是動畫分類，
與這裡無關，見下文）。

**傳入的不是字串**：`enemies_data_*.js` 的 `action.name` 是
`{ ja: "ガードカウンター", zh: "格擋反擊" }` 這種多語物件，`enemyAttack.actionName`
也原封不動載這個形狀（見 `maybeStartEnemyAttack()`）。`isCounterAction()` 因此以 `ja`
為準判定，同時也接受直接傳字串。把這裡當成字串處理會讓反擊永遠不發動。

補標時使用者對其他含防禦語彙的招式都明確給了攻擊動畫
（`盾撃`→single、`突撃指令＆防御態勢`→thrust、`時間差攻撃＆黄金の返報`→single、
`踏み込み＆盾ガード`→thrust、`薙ぎ払い＆防御態勢`→area），代表那些是「攻擊為主、
附帶防禦」的複合技，**不列入反擊對象**。關鍵字刻意收窄到 `カウンター`／`パリィ`
就是為了對齊這個判斷。

`弾き＆妖刀解放` 的動畫維持 `line` 不改：它被產生器的 `/弾/`（弾丸）關鍵字命中而分到
`line`，雖然 `弾き` 的原意是招架，但「妖刀解放」這個攻擊部分本來就適合 `line`，
與 `薙ぎ払い＆防御態勢`→`area` 一樣遵循「複合技以攻擊部分分類」的既有慣例。
動畫歸動畫、反擊歸反擊，兩者互不牽動。

## 4. 規格

| 項目 | 值 | 決定者 |
|---|---|---|
| 誘發窗口 | 招式發動（`warnAt`）起 **2000ms** | 使用者明確規格 |
| 反擊傷害 | 該招式 `dmgAmount` 的 **一半**（`Math.round(dmgAmount / 2)`），每一下都是這個值 | 使用者明確規格 |
| 反擊下數 | **1 或 2**，各 50% | 使用者明確規格 |
| 反應窗口 | 每一下 **1000ms**（一般攻擊是 2000/2500/3000ms） | 使用者明確規格 |
| 多人誘發 | 窗口內攻擊過的**每一位玩家各自被反擊** | 使用者明確規格 |
| 同一人重複攻擊 | **一次招式對同一位玩家只反擊一次** | 使用者明確規格 |
| 與原攻擊衝突 | **反擊優先，中斷原本的攻擊** | 使用者明確規格 |
| 生效條件 | `meta.spriteMode` 已勾選（點陣圖戰鬥模式） | 使用者明確規格 |

### 4.1 待裁示：第 2 下要不要再套「後續半額」

既有的多下攻擊有「首擊全額，後續每下半額」的規則
（`ENEMY_ATTACK_FOLLOWUP_HIT_DAMAGE_MULT = 0.5`，midnight.js:1132，使用者明確規格），
`resolveMyIncomingHit()` 對 `hitIndex > 0` 一律套用。反擊若照舊走這條路，
第 2 下會變成原招式的 **1/4** 而不是 1/2。

- **(a) 沿用**：反擊 2 下＝原招式的 1/2 ＋ 1/4 ＝ 0.75 倍，與既有多下攻擊的手感一致。
- **(b) 反擊不套用**：兩下都是 1/2，合計 1.0 倍，嚴格符合「每一下都是一半」的字面。

本文件暫定 **(a)**，因為它不需要在傷害鏈上開反擊專用的例外，與「不改傷害計算鏈」的
非目標一致。實作前需使用者確認。

## 5. 架構

### 5.1 判定層：`static_src/enemy_counter_rules.js`（新增）

比照 `midnight_sprite.js`／`enemy_action_anim_map.js` 的三層解耦約束——**這個模組不讀
任何遊戲狀態、不碰 DOM、不碰 RTDB**，只有純函式：

```js
window.PriTestEnemyCounterRules = {
  COUNTER_WINDOW_MS: 2000,           // 誘發窗口
  COUNTER_REACTION_WINDOW_MS: 1000,  // 每一下的反應窗口
  isCounterAction: function (actionName) {...},   // /カウンター|パリィ/
  counterDamage: function (dmgAmount) {...},      // Math.round(dmgAmount / 2)
  pickCounterHitCount: function (rand) {...}      // rand < 0.5 ? 1 : 2
};
```

`pickCounterHitCount()` 收 `rand` 參數而不是自己呼叫 `Math.random()`，是為了讓邊界可測
（比照既有的 `pickWeightedIndex(Math.random(), weights)` 寫法）。

### 5.2 資料層：不動

`out.enemyAttack` 已經帶齊 `attackId`／`actionName`／`dmgKind`／`dmgAmount`／`warnAt`
（見 `maybeStartEnemyAttack()`，midnight.js:8924），反擊需要的資訊全部在裡面。
**RTDB schema 零變更。**

反擊不寫回 RTDB，理由：
- `enemyAttack` 只有一格，多位玩家同時誘發會互相覆蓋。
- 寫回去會干擾 `maybeFinishEnemyAttack()` 的壽命計算與 `nextAttackAt` 排程。
- 既有設計本來就是「命中結果由各自的裝置決定」（`myIncomingAttack` 是本地狀態，
  見 midnight.js:8501 的註解），反擊沿用同一個模式即可。

### 5.3 判斷層：`midnight.js`

在 `damageCombatTarget()` 累積 `damageBySlot` 的那一段之後呼叫新函式：

```
maybeTriggerEnemyCounter(pointId)
  ├ spriteModeEnabled() 為 false            → return
  ├ trig = fieldTriggers[pointId]、atk = trig.enemyAttack
  ├ atk 不存在                              → return
  ├ now >= atk.warnAt + COUNTER_WINDOW_MS   → return（窗口過了）
  ├ !isCounterAction(atk.actionName)        → return
  ├ counterConsumedAttackId === atk.attackId→ return（本招式我已經被反擊過）
  ├ counterConsumedAttackId = atk.attackId
  └ myIncomingAttack = {
        pointId, attackId: atk.attackId, isCounter: true,
        hitIndex: 0, hitCount: pickCounterHitCount(Math.random()),
        phase: "warn", phaseEndAt: now + ENEMY_ATTACK_WARN_MS,
        actionName: atk.actionName, actionMod: atk.actionMod,
        dmgKind: atk.dmgKind, dmgAmount: counterDamage(atk.dmgAmount)
      }                                    ← 直接覆寫＝中斷原攻擊（§4「反擊優先」）
```

`counterConsumedAttackId` 是一個本地變數。`attackId` 的格式是 `pointId + ":" + Date.now()`，
必定唯一，所以下一次攻擊自然覆蓋，encounter 結束時不需要額外清理。

### 5.4 反應窗口狀態機的三處分支

這是本設計**最有風險的改動點**。窗口長度在兩個地方各算一次，反擊必須兩邊都改，
只改一邊會出現「第 1 下 1 秒、第 2 下 2 秒」的不一致。

新增共用函式 `incomingHitWindowMs(st)`：`st.isCounter` 時回
`COUNTER_REACTION_WINDOW_MS`，否則回 `enemyAttackHitWindowMs(st.hitIndex)`；
既有的 `turnStep` 遺物加成兩條路徑都照樣疊上去。

1. **`updateMyIncomingAttack()` 開頭**：
   `if (myIncomingAttack && myIncomingAttack.isCounter) { ...走反擊分支... }`
   —— 跳過 `targeted` 判斷與 `attackId` 比對。現行行為是「我不在 `targetSlots` 裡就把
   `myIncomingAttack` 清掉」，而反擊在 RTDB 上沒有實體，不擋就會被誤清。

   **反擊狀態的釋放**是這一段最容易寫錯的地方，兩個方向都會出事：
   - 反擊跑完（`phase: "done"`）就把 `myIncomingAttack` 設回 `null` → 下面的初始化立刻
     用同一個 `attackId` 把**被反擊中斷掉的原攻擊復活**，違反「反擊優先」。
   - 永遠抱著不放 → 之後所有攻擊都被開頭這個分支攔截，玩家再也不會被攻擊。

   正解是**以誘發來源的攻擊是否還活著為準**：`trig.enemyAttack` 仍存在且 `attackId`
   相同（且同一個地圖點）就繼續抱著（`phase: "done"` 之後也照樣抱著，原攻擊就此作廢）；
   一旦 RTDB 上的攻擊被 `maybeFinishEnemyAttack()` 清掉或換成新的 `attackId`，
   就把 `myIncomingAttack` 設回 `null` 並讓流程落到既有的一般路徑。
2. **`updateMyIncomingAttack()` 的 warn→window 轉換**（midnight.js:9004）：
   改呼叫 `incomingHitWindowMs(st)`。
3. **`resolveMyIncomingHit()` 的下一擊排程**（midnight.js:9239）：
   改呼叫 `incomingHitWindowMs(st)`。

`resolveMyIncomingHit()` 其餘部分不改，反擊因此自動享有既有的迴避／防禦／屬性蓄積／
遺物效果全鏈路。

### 5.5 警示階段沿用 0.5 秒

反擊同樣先跑 `ENEMY_ATTACK_WARN_MS`（0.5 秒）的 ⚠ 警示才進入反應窗口，理由是
`triggerAttackEffect()`（刀光特效）掛在 warn→window 的轉換上，跳過警示就沒有攻擊表現。
因此反擊每一下的總長是 0.5＋1.0＝1.5 秒，仍明顯短於一般攻擊的 0.5＋2.0＝2.5 秒。

## 6. 迴圈與邊界

- **不會無限反擊**：反擊透過 `myIncomingAttack` 結算，不經過 `damageCombatTarget()`，
  所以反擊不可能再誘發反擊——這是結構上的保證，不是靠旗標擋。
- **`dmgAmount === 0`**：規則書沒寫傷害的招式，一半仍是 0。會播反擊表現但不扣血，
  符合 CLAUDE.md §19「不發明數值」。
- **瀕死中的玩家**：瀕死時無法攻擊，`damageCombatTarget()` 不會被呼叫，因此不會誘發反擊。
- **舊房間**：`meta.spriteMode` 為 `undefined` 時 `spriteModeEnabled()` 回 `false`，
  既有房間的戰鬥行為完全不變。

## 7. 驗證

### 7.1 新增 `tools/midnight_check/enemy_counter_check.js`

- `isCounterAction()` 對 `enemies_data_1~4.js` 全 549 筆執行，命中集合固定為
  §1 表格的 4 名 6 筆；且明確斷言 `盾撃`／`突撃指令＆防御態勢`／`踏み込み＆盾ガード`／
  `時間差攻撃＆黄金の返報`／`薙ぎ払い＆防御態勢` **不**命中。
- `counterDamage()`：偶數、奇數（`Math.round` 的進位方向）、0。
- `pickCounterHitCount()`：`0`→1、`0.499`→1、`0.5`→2、`0.999`→2。
- `isCounterAction()` 直接吃 `action.name` 多語物件（實際執行時傳進來的形狀），
  確認 6 筆命中；並斷言 `{ zh: ... }`（缺 `ja`）與 `{}` 回 `false`。
- 結線的靜態斷言：`enemyAttackHitWindowMs(st.hitIndex)` 的直呼已完全消失、
  `incomingHitWindowMs(st)` 出現 3 次（定義 1＋呼叫 2）、`enemyAttackHitWindowMs(`
  出現 3 次（定義 1＋`incomingHitWindowMs` 內 1＋`enemyAttackTotalDurationMs` 內 1；
  最後這個算的是 RTDB 上 `enemyAttack` 的壽命，反擊不寫 RTDB，故維持原樣）。
  這一組就是防止 §5.4「只改一處」迴歸的網子。

### 7.2 迴歸

- `sprite_action_map_check.js` 全 OK（本設計不動對照表）。
- `graces_check.js` 全過。
- `python generate.py` 後 `dist/midnight/index.html` 內 `enemy_counter_rules.js`
  的 script 順序在 `midnight.js` 之前。

### 7.3 只有人類能做的驗證

瀏覽器實機確認：勾選點陣圖戰鬥模式 → 遇到上述 4 名招式 → 2 秒內攻擊 → 是否被反擊 1~2 下、
反應窗口是否明顯比平常短、原本的攻擊是否被中斷。

## 8. i18n

反擊發生時需要在 `#midnight-incoming-attack-name` 標示這是反擊（例如前綴「反擊！」）。
`site_src/i18n_data_ja.py`／`i18n_data_zh.py`／`i18n_data_en.py` 三個檔案各補一個 key。
