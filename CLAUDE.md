# CLAUDE.md

本文件提供 Claude Code（claude.ai/code）在此儲存庫中進行開發、修改、測試與文件撰寫時應遵循的規範。

---

# 1. 語言與溝通規範

## 1.1 回覆語言

* **所有回答、說明、分析、修改建議、錯誤說明、提交訊息（commit message）與新增文件，預設一律使用繁體中文。**
* 使用者以中文（繁體）或日文提出指示時，應正確理解其內容，並以**繁體中文**回覆。
* 除非使用者明確要求其他語言，否則不要使用簡體中文或日文作為主要回覆語言。
* 技術名稱、API 名稱、函式名稱、變數名稱、檔案名稱、Git 指令、JavaScript/Python 語法等應維持原文，不要為了翻譯而修改其實際識別字。
* 程式碼內的註解應依照本專案既有風格，可以使用英文或繁體中文；若新增一般說明性註解，優先使用繁體中文。

## 1.2 修改程式碼前

在提出指令、修改程式碼或實際執行修改之前：

1. 先以繁體中文說明準備修改的內容。
2. 確認相關程式碼與資料流。
3. 如果修改涉及已存在的遊戲規則，必須先閱讀對應的 `docs/*.md` 規則文件。
4. 不要只依照程式碼猜測規則；若規則文件已存在，應以規則文件為優先依據。
5. 修改完成後，說明修改內容以及建議的驗證方式。

---

# 2. 專案概述

這是一個桌上角色扮演遊戲（TRPG）「夜渡り / Elden Ring Nightreign TRPG」的 GM／玩家輔助工具，同時包含一個可以容納其他小型專案的首頁（`site_src/projects.py`）。

專案主要特徵：

* Python 在建置階段產生靜態 HTML。
* 實際遊戲邏輯全部在瀏覽器端執行。
* JavaScript 使用 Vanilla ES5。
* 遊戲狀態主要保存於 `localStorage`。
* 可選擇透過 Firebase Realtime Database 進行雲端遊戲同步。
* 沒有 npm / webpack 等建置框架。
* 沒有正式的自動化測試套件。
* 驗證方式主要為瀏覽器人工操作，或使用臨時 Playwright 腳本測試已建置的 `dist/`。

---

# 3. 常用指令

建置：

```bash
python generate.py
```

此指令會從 `site_src/` 與 `static_src/` 建立 `dist/`。

本機啟動：

```bash
python -m http.server 8000 --directory dist
```

Windows 若 `python` 不在 PATH：

```bash
py -3 generate.py
```

JavaScript 快速語法檢查：

```bash
node --check static_src/<file>.js
```

注意：

* 專案沒有 lint 指令。
* 專案沒有正式 test 指令。
* 沒有預先配置測試框架。
* 每次修改 `site_src/` 或 `static_src/` 後，都必須重新執行 `generate.py`。
* `dist/` 已加入 `.gitignore`，不會提交到 Git。
* 推送到 `main` 後，`.github/workflows/deploy.yml` 會執行 `python generate.py` 並部署至 GitHub Pages。

---

# 4. 手動驗證與 Playwright 測試

由於沒有正式測試框架，建議驗證 JavaScript 修改時遵循：

1. 執行 `python generate.py`。
2. 啟動本機 HTTP server。
3. 使用臨時 Playwright 腳本操作實際 UI。
4. 必要時直接讀取：

   * `window.PriTest*` 全域物件
   * `localStorage`
5. Playwright 腳本只作為臨時測試，不要提交進 Git。

## 4.1 Admin 頁面的密碼提示

`admin/index.html` 會透過：

```js
window.prompt("password")
```

要求密碼。

目前密碼為：

```text
night
```

相關邏輯位於 `games.js`。

Playwright 測試必須處理 dialog：

```js
page.on("dialog", async dialog => {
  await dialog.accept("night");
});
```

否則：

* Admin 操作會卡住。
* `requireAdmin()` 在拒絕或收到 `null` 時會重新導向 `../index.html`。
* 因此下一行可能出現：

```text
window.PriTestGames is undefined
```

這並不是單純的 `PriTestGames` 載入問題，而可能是因為沒有處理 password prompt。

## 4.2 建立測試用遊戲

從 Admin 頁面建立遊戲時：

```js
window.PriTestGames.create(name, scenarioId, storageMode)
```

注意：

* 匯出的函式名稱是 `create`，不是 `createGame`。
* Playwright 建立測試遊戲時，建議：

```js
storageMode: "local"
```

## 4.3 `night/index.html` 與 `characters/index.html`

這些頁面在沒有有效的：

```text
?game=<id>
```

時會直接重新導向：

```text
../index.html
```

並且可能因此完全跳過相關 `<script>`。

因此測試時必須：

1. 先建立遊戲。
2. 取得 game id。
3. 再使用：

```text
night/index.html?game=<id>
```

或：

```text
characters/index.html?game=<id>
```

進入頁面。

## 4.4 不要手工建立不完整 state

不要在第一次載入頁面前直接寫入：

```text
pritest-night-state-<gameId>
```

的部分 state 物件。

如果 state 缺少欄位，App 可能會悄悄使用預設值，導致測試結果與預期不一致。

建議流程：

1. 先讓 App 正常建立完整 state。
2. 透過正常 UI 操作建立基礎資料。
3. 從 `localStorage` 讀取完整 state。
4. 只修改需要測試的特定欄位。
5. 寫回 `localStorage`。
6. `page.reload()`。

## 4.5 取得武器／道具 ID

需要建立測試 fixture 時，使用：

```js
window.PriTestWeapons.list()
```

這會返回扁平陣列，每個項目都有：

```js
.category
```

不要使用：

```js
Weapons.categories()[i].items
```

因為 `categories()` 並不包含實際武器 instance。

Category 只包含：

* `basicStats`
* `innateSkills`

等規則 metadata。

---

# 5. 專案架構

## 5.1 建置流程

`generate.py` 主要負責兩件事。

### 第一部分：複製與產生靜態資源

將：

```text
static_src/*.js
style.css
```

複製至：

```text
dist/static/
```

並將：

```text
static_src/i18n.template.js
```

轉換成：

```text
dist/static/i18n.js
```

轉換時會把：

```text
__I18N_DATA__
```

替換成：

```python
site_src/i18n_data.py
```

中的 `STRINGS` JSON。

### 第二部分：產生 HTML

呼叫各個：

```text
site_src/*_page.py
```

的：

```text
build_*_html()
```

產生：

```text
dist/index.html
dist/night/index.html
dist/admin/index.html
dist/admin/scenarios/index.html
dist/characters/index.html
```

所有頁面共用：

```text
site_src/layout.py
```

中的：

```text
page_shell
```

因此共用：

* Header
* 語言切換器
* Footer
* Script 載入

各頁面則是彼此獨立的 HTML document，沒有 client-side router。

## 5.2 新增小型專案頁面

如果要新增一個 mini-project：

1. 建立：

```text
site_src/<name>_page.py
```

2. 實作：

```python
build_*_html()
```

3. 在 `generate.py` 的 `build_pages()` 註冊。
4. 在：

```text
site_src/projects.py
```

加入入口。
5. 在：

```text
site_src/i18n_data.py
```

加入對應 i18n keys。

---

# 6. 多語系（i18n）

所有 UI 使用者可見文字主要集中在：

```text
site_src/i18n_data.py
```

的：

```python
STRINGS
```

結構依語言分類：

```text
zh
ja
en
```

其中：

* `zh` 是預設語言。
* `zh` 是 fallback。
* 遊戲資料中的英文內容目前大部分沒有完整製作，因此 `en` 對遊戲資料可能 fallback 至 `ja`。

## 6.1 HTML

靜態 HTML 使用：

```html
data-i18n="key"
```

由：

```text
i18n.template.js
```

中的：

```js
applyI18n()
```

自動套用。

## 6.2 JavaScript

JavaScript 動態文字使用：

```js
window.I18N.t(key, params)
```

支援：

```text
{param}
```

形式的 interpolation。

## 6.3 遊戲資料

角色類型、武器、敵人等 data module 通常直接保存：

```js
{
  ja: "...",
  zh: "..."
}
```

並透過各檔案中的：

```js
C(ja, zh)
```

helper 建立。

render 時依目前語言選擇文字。

---

# 7. JavaScript 模組

所有 `static_src/*.js` 模組都使用 IIFE，並將 namespace 掛載至：

```js
window
```

例如：

```js
window.PriTestGames
window.PriTestCharacterDrawer
```

**Script 載入順序非常重要。**

載入順序由：

* `generate.py` 的 copy list
* 各頁面的 `extra_scripts`

共同決定。

---

# 8. 基礎模組

## Infrastructure

主要包括：

```text
i18n.template.js
games.js
game_storage.js
firebase_config.js
qrcode.js
```

### `games.js`

負責：

* 遊戲 CRUD
* Admin password gate
* Import / Export
* Share
* Base64url JSON 編碼
* QR sharing

### `game_storage.js`

負責雲端同步。

如果：

```js
storageMode !== "cloud"
```

則基本上是 no-op abstraction layer。

如果：

```js
storageMode === "cloud"
```

則：

* lazy-load Firebase SDK
* 啟用 App Check
* 將 state mirror 到 Realtime Database

### `firebase_config.js`

包含：

* Firebase project config
* `PRITEST_APPCHECK_SITE_KEY`

這些值會直接出現在 client-side JavaScript。

這在 Firebase 架構中是正常的，**不能將其視為 secret key**。

### `qrcode.js`

第三方 QR Code library 的 vendored 版本。

---

# 9. 規則與資料模組

主要資料模組：

```text
character_types.js
weapons.js
weapon_rulebook.js
talismans.js
consumables.js
enemies.js
fields.js
event_rulebook.js
night_bosses.js
night_boss_rulebook.js
worldview.js
scenarios.js
```

這些主要包含靜態規則資料與雙語文字，而不是頁面邏輯。

---

# 10. 頁面邏輯

主要頁面模組：

```text
admin.js
admin_scenarios.js
characters.js
character_drawer.js
night.js
```

## `admin.js`

負責：

* Game list
* 遊戲管理

## `admin_scenarios.js`

負責：

* Scenario editor
* Card deck editor

## `characters.js`

負責：

* Character roster
* Character gallery
* Character creation

## `character_drawer.js`

負責：

* Character detail
* Stat computation
* Damage computation

## `night.js`

負責：

* 實際遊戲 session
* 戰鬥
* 回合
* 地圖
* 敵人
* Event
* State persistence

---

# 11. `character_drawer.js`：角色模型與數值計算

`character_drawer.js` 是共用角色資料與數值計算核心。

主要負責：

* `newCharacter`
* Stat steppers
* Character CRUD
* Damage calculation
* Bonus calculation

其中：

```js
computeArtPower
```

是核心的 power modifier 計算。

它會綜合：

* Character type 的 `powerMod`
* Talisman bonus
* Relic effect bonus

並同時影響：

* Weapon attack damage
* Skill damage
* Sorcery damage
* Incantation damage

因此如果修正 `computeArtPower()`，通常會自動反映至所有相關傷害計算。

其他重要函式包括：

```text
computeWeaponDamage
talismanFlatMaxStatBonus
relicFlatMaxStatBonus
attachedFlatMaxStatBonus
totalFlatMaxStatBonus
```

---

# 12. 三種獨立 Bonus 系統

角色有三套彼此獨立的 bonus system。

## 12.1 Learned Relic Effects

欄位：

```js
learnedRelicEffects
```

特徵：

* 依角色類型而定。
* ID 格式：

```text
<typeId>-r<group>-<index>
```

* 受角色等級與 `relicMaxLearnable` 限制。

## 12.2 Learned Attached Effects

欄位：

```js
learnedAttachedEffects
```

特徵：

* 少量固定 universal effects。
* 使用 2d6 決定。
* 上限：

```js
MAX_ATTACHED_EFFECTS
```

## 12.3 Talismans

欄位：

```js
talismanIds
```

每個裝備中的 Talisman 都具有單一 passive effect。

**計算任何 total stat 時，必須分別檢查這三套資料。**

不要假設它們是同一套系統。

---

# 13. `night.js`：遊戲 Session Engine

`night.js` 是實際遊戲流程的核心 state machine。

負責：

* Dice pools
* Action phase
* Extra phase
* Defense phase
* Front / Back row
* Combat board
* Combat modal
* Attack
* Skill
* Defense
* Flask
* Consumable
* Move
* Equip
* Enemy HP
* Turn rewards
* Event chips
* Near-death
* Revival

所有 session state 都放在單一：

```js
state
```

物件中。

每次 mutation 都透過：

```js
saveState()
```

儲存至：

```text
localStorage["pritest-night-state-<gameId>"]
```

角色則另外儲存於：

```text
localStorage["pritest-characters-<gameId>"]
```

透過：

```js
saveRosterCharacters()
```

保存。

---

# 14. 修改敵人 HP、Guard、Stagger 或屬性異常前

**必須先閱讀：**

```text
docs/enemy_damage_rules.md
```

此文件是敵人傷害規則的轉錄，包含：

* 傷害 notation grammar
* 傷害套用的 5 優先順序
* Guard Count
* Guard Reduction
* HP-value 計算公式
* Attribute threshold
* Ailment threshold
* 已實作功能
* 尚未實作功能

截至 2026-08-09：

已實作：

```text
Guard Count / HP-value
applyGuardedDamageToEnemy
#battle-guard-calc-block
```

適用於：

* 一般敵人
* Gladius
* Maris

尚未完成：

* Gladius split-form 的三段 HP 分配
* Gladius 自動型態轉換

**不要在沒有閱讀 `docs/enemy_damage_rules.md` 的情況下直接修改相關程式。**

---

# 15. 修改 Scenario / Field 流程前

**必須先閱讀：**

```text
docs/scenario_flow_rules.md
```

內容包括：

* Day 1 → Day 2 → Day 3 流程
* Field exploration
* Floor breakthrough
* Field movement
* Adjacent checks
* Climbing checks
* Event chip resolution

截至 2026-08-09：

此文件整體具有高可信度。

較清楚的照片批次已釐清：

* Floor breakthrough sub-steps
* 五種 Event chip

目前仍未完全確認：

* Flee 後 HP increase 的精確文字
* `強敵決定表`
* `隨機イベント決定表`

目前已實作：

* Breakthrough 自動擲骰
* Climbing 自動擲骰
* 自動計算 target number
* GM 手動按 Pass / Fail

已自動化：

* Event chip placement
* 靈脈 chip
* 祝福 chip
* 商人 chip

尚未完成：

* 強敵 chip
* 隨機 chip
* `varianceTable` branch-selection system

---

# 16. 修改戰鬥流程前

**必須先閱讀：**

```text
docs/combat_flow_rules.md
```

內容包括：

* Action phase
* Extra phase
* Defense phase
* End phase
* Front / Back area
* Aggro
* Combat start
* Public / private information
* Normal combat
* Simplified combat
* Boss combat
* Mob combat
* Pre-combat procedure
* Post-combat procedure

截至 2026-08-09：

文件整體具有高可信度，較清晰的照片批次已取代早期模糊版本。

已實作：

```text
state.actionPhase
front/back positioning
aggro
guard-break
TIME_LOSS_ROW_DEFS
ROLL_EFFECTS
```

尚未完整接入：

* Normal vs simplified combat distinction
* Boss vs mob level comparison

目前已精確確認的 Mob combat 判定為：

```text
PC 平均等級
vs.
Enemy level + level correction
```

此比較會決定 Normal 或 Simplified combat。

---

# 17. 戰鬥文字中的特殊符號

以下符號是戰鬥、遺物、Talisman、Consumable 計算中的核心 placeholder。

**絕對不要自行猜測其數值。**

---

## 17.1 `□`

`□` 代表可以直接計算的數值。

在 cap / max context 中：

```text
□ = +1
```

例如：

```text
最大HP+□□□
```

代表：

```text
+3
```

由：

```js
sumMaxStatDeltaFromText
```

解析。

在一次性治療 context：

```text
HP回復：□□
```

代表：

```text
HP 回復 2
```

由：

```js
countHealSquares
```

解析。

因此：

> `□` 必須轉換成實際數值，不可以原樣留在數值計算中。

---

# 18. `▲` / `◆`

在傷害文字中：

```text
總合傷害：50+▲
```

`▲` / `◆` 代表角色自身的 power modifier。

必須透過：

```text
computeArtPower
fixedSkillPowerValue
```

等機制計算。

**不要把它們當作單純文字刪掉。**

但是在：

```text
【追加効果】
```

中，兩者有完全不同的意思：

```text
▲ = 0.5 Guard Reduction
◆ = 1 Guard Reduction
```

這與 power modifier 無關。

因此修改相關程式前，必須先閱讀：

```text
docs/enemy_damage_rules.md
```

尤其是 §2 / §5。

---

# 19. `■`

`■` 是真正具有 context-dependent 意義的 placeholder。

例如：

* 某武器的 HP-value
* 依 GM 之前擲出的骰子而定的數值
* Mob 固定但尚未被系統追蹤的 HP chunk

App **絕對不可以自行發明 `■` 的數值**。

目前 `night.js` 的既有做法是：

1. 將 rulebook body text 放入 action log。
2. 提醒 GM 手動處理。

例如：

```js
lines.push(CharacterTypes.localizedText(effect.body))
```

或：

```text
consumable_effect_*_note
```

等 i18n key。

因此：

> 不要為 `■` 加入自行猜測的 arithmetic。

如果未來規則證實某個 `■` 其實有固定值，應該修改：

```text
character_types.js
consumables.js
```

中的規則文字，例如使用實際數量的 `□`。

**不要在 JavaScript 中硬編碼猜測值。**

---

# 20. 「直到結束階段」效果

大量 Relic、Attached Effect、Consumable 的效果會寫成：

```text
直到結束階段為止
```

這類效果通常是：

* 自己的 buff
* Party-wide buff
* Damage bonus
* Defense bonus
* Flag

其效果必須在：

```text
Action phase
Extra phase
Defense phase
```

發生切換時立即消失，而不是等到整場戰鬥結束。

---

# 21. Phase Reset Checklist

既有做法是在角色物件上保存：

```js
c._xxxActive
```

或：

```js
c._xxxUntilEndPhase
```

例如：

```text
heroMeatHitBonus
finaleAttackBuffBonus
ominousStrikeHitBonus
```

等 helper 會讀取這些欄位。

但是：

**設定 flag 只是功能的一半。**

真正重要的是：

```js
setActionPhase()
```

裡面有：

```js
rosterCharacters.forEach(...)
```

會在**每一次 phase transition** 重設這些欄位：

```text
0
false
null
```

如果新增一個「直到結束階段」效果：

> 必須同時在 phase reset loop 中加入 reset。

這是本專案最常見的 bug 來源之一。

否則 buff 可能會錯誤地持續超過原本規則允許的 phase。

---

# 22. Round 級別效果

部分效果不是持續到 phase 結束，而是持續整個 round。

例如：

```text
_wingsOfSalvationActive
```

這類 flag 的生命週期不同。

它們可能只在：

```text
新的 combat phase 從 defense phase 重新開始
```

時清除。

因此新增效果時，必須先確認 rulebook 的生命週期：

* Phase
* Round
* Battle
* Session

再決定 reset 位置。

**不要只因為名稱相似，就把所有效果都放到同一個 reset。**

---

# 23. 需要玩家選擇目標的 Relic Effects

部分 Relic 在習得時要求：

```text
選擇 1 種屬性
選擇 1 種異常
選擇 1 種武器
```

例如：

```text
屬性蓄積值＋1
屬性達成的歡喜
異常狀態達成的歡喜
```

這些功能由：

```js
RELIC_CHOICE_CONFIG_BY_NAME
```

管理。

它會將 Relic 的 zh / ja 名稱映射至：

```js
{
  field,
  options
}
```

---

# 24. `assignRelicChoiceIfNeeded`

使用：

```js
assignRelicChoiceIfNeeded(c, effect, pickedOption)
```

處理選擇。

Learn candidate card 會：

1. 顯示 `<select>`。
2. 預設值為「隨機決定」。
3. 顯示在「習得」按鈕旁。
4. 玩家選擇後保存至角色物件。

例如：

```js
c.relicAccumElementChoice
c.relicJoyElementChoice
c.relicJoyAilmentChoice
```

即使使用者沒有手動選擇，也可以依預設值隨機選擇。

已習得效果列表會再次 render `<select>`，因此玩家之後仍可修改選擇。

---

# 25. `night.js` 使用 Relic Choice

如果 `night.js` 需要知道角色選了哪一種：

```text
element
ailment
```

直接讀取角色欄位，例如：

```js
c.relicAccumElementChoice
c.relicJoyElementChoice
c.relicJoyAilmentChoice
```

比對名稱時必須同時考慮：

```js
.zh
.ja
```

因為 accumulation label 或 log text 的語言不一定與保存的 choice 相同。

---

# 26. Attached Effect Resistance Choice

Universal attached effect：

```text
status_resist
element_resist
```

目前使用：

```js
assignAttachedResistChoiceIfNeeded
```

這是較舊的 random-only pattern。

它沒有 picker UI，因為目前不會阻塞其他功能。

如果未來修改這部分：

> 優先將其改造成與 `RELIC_CHOICE_CONFIG_BY_NAME` 相同的 pattern，而不是再建立第三套選擇機制。

---

# 27. Consumables

Consumable 主要分成：

```text
consumables.js
night.js
```

## 27.1 `consumables.js`

這是純 reference data。

主要包含：

* Name
* Body text

不要在這裡放實際 effect logic。

---

# 28. Consumable 實際效果

所有 Consumable 的 mechanical effect 都位於：

```js
night.js
```

的：

```js
applyConsumableEffect
```

---

# 29. `CONSUMABLE_TARGET_KIND`

```js
CONSUMABLE_TARGET_KIND
```

負責決定每個 Consumable 的 target。

目前包括：

```text
self
enemy
otherPc
ailment
grease
allPc
```

其中：

### `self`

對自己使用。

### `enemy`

對敵人使用。

會重用：

```js
resolveSelectedEnemyOptions()
combatAttackTargetEnemyKey
```

等攻擊 target 邏輯。

### `otherPc`

選擇其他玩家角色。

### `ailment`

只顯示玩家目前實際累積的 ailment。

資料來源：

```text
state.battle.attributeStatus.received
```

### `grease`

武器／盾牌塗脂。

### `allPc`

對所有玩家角色使用。

---

# 30. `renderCombatConsumableAction`

```js
renderCombatConsumableAction
```

負責：

* 顯示 Consumable action UI
* 根據 target kind 顯示正確 picker
* 提供 target 選擇

---

# 31. `applyConsumableEffect`

所有 Consumable 的實際 state mutation 都應集中在：

```js
applyConsumableEffect(c, itemId, applyLevel2, target)
```

其返回值：

```js
{
  total,
  lines
}
```

並由 action log 使用。

新增 Consumable 時，不要建立完全獨立的處理機制。

---

# 32. Consumable Level 2 Effect

Consumable 的：

```text
等級2效果
```

有些需要其他條件才會觸發。

目前特殊規則：

如果玩家具有 Scholar 的：

```text
carried_knowledge
```

則依 rulebook：

> 永遠觸發 Level 2 effect。

此時：

```js
applyLevel2
```

會真正套用。

否則：

* 不要自行套用 Level 2。
* 將 Level 2 的 rulebook text 放進 `lines`。
* 讓 GM 手動處理。

---

# 33. Consumable「塗脂」

「塗脂」是目前最複雜的 Consumable 類型之一。

它可能設定：

```js
c._greaseWeaponId
c._greaseElementRef
```

這些資料會被：

```js
weaponAccumulationEffects
```

讀取，以產生暫時性的 attack accumulation skill。

同時：

```js
relicEffectAppliesTo
```

中的：

```text
武器脂的達人
```

會讀取相關欄位，以判斷 flat hit-damage bonus 是否有效。

盾牌塗脂則會設定：

```js
c._greaseShieldId
```

並在 defense / guard confirm handler 中與：

```js
c._guardValueBonusUntilEndPhase
```

共同使用。

這些欄位都必須在 phase reset loop 中正確清除。

---

# 34. 新增第 17 個 Consumable

如果未來新增第 17 個 Consumable，應遵循現有三段式設計：

1. 在：

```js
CONSUMABLE_TARGET_KIND
```

加入 target kind。

2. 如果需要特殊選擇，加入對應 picker UI。

3. 在：

```js
applyConsumableEffect
```

加入一個 `else if` branch。

**不要為單一 Consumable 發明新的獨立架構。**

---

# 35. 特殊 Ability / Relic 行為

部分特殊能力不是單純的數值加成，而會改變：

* 技能行為
* Action mode
* Position requirement
* Resource requirement
* Buff
* 特殊 action

這些目前通常透過：

```js
entry.id
```

在：

```js
renderCombatSkillAction
renderCombatDefenseAction
```

等 combat rendering function 中判斷。

這是目前既有架構的一部分。

---

# 36. Fake Ability Entry

如果某個 Relic / Talisman effect 需要改變技能行為，而不只是增加固定數值：

> 優先建立 fake ability entry，而不是把完整行為硬編碼進 UI。

Fake entry 應維持與：

```text
character_types.js
```

中的 ability 相同結構：

```js
{
  id,
  kind,
  name,
  body
}
```

可參考：

```text
CRUCIBLE_BEAST_ACTIONS
```

的 template。

接著將 fake entry conditionally concat 至 entries list。

如此即可繼續使用既有：

* Cost parsing
* Damage parsing
* Generic action pipeline

而不需要另外建立一套特殊流程。

---

# 37. Firebase Realtime Database 安全規則

Firebase 設定位於：

```text
database.rules.json
```

部署方式：

```bash
firebase deploy --only database
```

或直接貼至 Firebase Console 的 Rules。

**注意：**

`generate.py` 與 GitHub Actions deploy 不會自動部署 Firebase database rules。

因此 Firebase rules 必須另外推送。

---

# 38. Firebase Rules 的存取模型

目前 rules 限制：

```text
games/$gameId
```

必須：

* authenticated read/write
* `$gameId` 必須符合 App 自己的 ID 格式
* 不接受未知 child keys

Game ID 格式：

```regex
^g[0-9a-f]{32}$
```

系統刻意沒有實作：

```text
per-owner write access
```

因為目前設計中：

* 持有不可預測的 128-bit `gameId`
* 即代表可以存取該遊戲

同一個 party 中：

* 玩家
* GM

都會寫入相同 game。

不需要每個人建立獨立帳號。

---

# 39. Firebase App Check

`game_storage.js` 會啟用：

```text
firebase-app-check-compat.js
```

並使用：

```text
reCAPTCHA v3
```

以及：

```js
PRITEST_APPCHECK_SITE_KEY
```

App Check 的用途是：

> 阻止複製公開 Firebase config 的非 App client 直接大量呼叫 Firebase API。

它是：

```text
abuse / quota-drain protection
```

而不是：

```text
access control
```

如果：

```js
PRITEST_APPCHECK_SITE_KEY
```

為空：

> App Check 不會產生作用。

---

# 40. GitHub Branch Protection

以下設定位於 GitHub 平台，而非 repository 本身：

```text
.github/CODEOWNERS
branch protection on main
```

一般情況下：

* 非 repository owner 的修改需要 PR。

Repository owner 仍可直接 push。

---

# 41. 修改文件的優先順序

如果需求涉及遊戲規則，應遵循：

```text
規則文件
↓
既有資料結構
↓
既有 helper / abstraction
↓
既有 UI / state flow
↓
新增程式碼
```

不要直接在 `night.js` 中硬編碼新的規則，而應先確認：

1. `docs/*.md` 是否已有規則。
2. 是否已有 data module。
3. 是否已有 helper。
4. 是否已有 state 欄位。
5. 是否已有 generic pipeline。
6. 是否可以重用現有機制。

---

# 42. 最重要的開發原則

修改此專案時，請始終遵循以下原則：

1. **所有對使用者的回答與說明使用繁體中文。**
2. 修改程式碼前先用繁體中文說明修改內容。
3. 修改遊戲規則前，先閱讀對應的 `docs/*.md`。
4. 不要自行猜測規則書沒有確認的數值。
5. `□` 是可計算 placeholder，必須解析。
6. `▲` / `◆` 的意義依 context 而不同，不能一概而論。
7. `■` 不得自行發明數值，應交由 GM 依規則書處理。
8. 新增「直到結束階段」效果時，必須同步加入 phase reset。
9. 新增 Round-level effect 時，確認其正確 lifecycle。
10. 優先重用現有 helper、state、generic pipeline。
11. 不要為單一效果建立第三套特殊架構。
12. 不要在 data module 與 `night.js` 重複定義相同規則。
13. 新增 Consumable 時遵循現有三段式模式。
14. 特殊技能行為優先使用 fake ability entry 接入既有 pipeline。
15. 不要手動建立不完整的 `localStorage` state 作為測試資料。
16. 使用 Playwright 測試 Admin 時，必須處理 password dialog。
17. 修改後重新執行 `generate.py`。
18. 至少使用 `node --check` 檢查大型 JavaScript 修改的語法。
19. 沒有正式 test suite 時，使用實際瀏覽器流程進行人工或 Playwright 驗證。
20. 所有新增或修改的說明文件，除非另有指定，均使用**繁體中文**。

---

# 43. 文件參考規範

當 `docs/` 中存在相關規則文件時，Claude Code 應將其視為開發時的重要依據。

目前特別重要的文件：

```text
docs/enemy_damage_rules.md
docs/scenario_flow_rules.md
docs/combat_flow_rules.md
```

對應關係：

| 修改內容                        | 修改前必讀文件                       |
| --------------------------- | ----------------------------- |
| Enemy HP / Guard / Stagger  | `docs/enemy_damage_rules.md`  |
| Attribute / Ailment buildup | `docs/enemy_damage_rules.md`  |
| Scenario flow               | `docs/scenario_flow_rules.md` |
| Field movement              | `docs/scenario_flow_rules.md` |
| Floor breakthrough          | `docs/scenario_flow_rules.md` |
| Event chips                 | `docs/scenario_flow_rules.md` |
| Turn / Phase progression    | `docs/combat_flow_rules.md`   |
| Front / Back / Aggro        | `docs/combat_flow_rules.md`   |
| Time Loss / Roll Effects    | `docs/combat_flow_rules.md`   |
| Combat start / end          | `docs/combat_flow_rules.md`   |

如果未來新增其他 `docs/*.md` 規則文件，也應依其內容納入對應功能的修改流程。

---

# 44. 最終要求

Claude Code 在此專案中的主要工作原則可以簡化為：

> **理解規則 → 閱讀文件 → 確認既有架構 → 重用既有機制 → 最小幅度修改 → 建置 → 驗證。**

任何遊戲規則相關修改，都不得只依照直覺或程式碼表面行為進行。

如果規則文件、既有程式碼與需求描述存在衝突：

1. 先指出衝突。
2. 以繁體中文說明。
3. 優先確認規則文件與實際需求。
4. 不要自行猜測規則。
5. 在規則未確認前，不應加入可能造成錯誤遊戲結果的硬編碼數值。
