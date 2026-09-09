# Midnight 測試模式整合／HUD折疊／樓層進入bug／獎勵清單再編 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 依 `docs/superpowers/specs/2026-09-09-midnight-hud-testmode-rewards-design.md` 完成5個各自獨立的 Midnight（即時制擴張版）UI/邏輯改動：測試模式密碼閘門與主控台化、上方資訊欄折疊排版、樓層進入bug修正＋戰鬥前置準備流程、獎勵清單分類再編、HUD區塊搬移。

**Architecture:** 全部改動集中在既有的 `static_src/midnight.js`（單一IIFE模組，透過 `window.PriTestMidnight` 之類命名空間掛載，內部函式互相直接呼叫，不使用ES6 module）、`site_src/midnight_page.py`（純字串HTML樣板，經 `generate.py` 轉出 `dist/midnight/index.html`）、`static_src/style.css`（單一全站共用CSS檔）、`site_src/i18n_data_{zh,ja,en}.py`（三語系字典，`i18n_data.py` 匯總）。不建立任何新檔案，全部是既有檔案內的定點修改，延續現有的「模組層級變數＋frame()主迴圈輪詢＋RTDB訂閱回呼」架構。

**Tech Stack:** Vanilla ES5、Python 3（建置期樣板字串）、Firebase Realtime Database（`GameStorage.rtSet`/`rtTransaction`）。**本專案沒有自動化測試框架**（見 `CLAUDE.md` §3），因此本計畫的「測試」步驟一律替換為：`node --check` 語法檢查 → `python generate.py` 建置 → 手動或臨時 Playwright 腳本在瀏覽器中操作驗證（Playwright腳本用完即丟，不提交進git，見 `CLAUDE.md` §4）。每個任務最後的「Run tests」步驟即指這套流程。

## Global Constraints

- 所有新增使用者可見文字必須是 `data-i18n` key 或 `window.I18N.t(key, params)` 呼叫，且必須同時在 `site_src/i18n_data_zh.py`／`i18n_data_ja.py`／`i18n_data_en.py` 三個檔案新增對應字串（`zh`為預設/fallback）。
- 每次修改 `static_src/*.js` 或 `site_src/*.py` 後，必須執行 `python generate.py` 重新建置，並用 `node --check static_src/midnight.js` 檢查語法。
- 不使用 `git commit --no-verify`，不省略既有hook。
- 所有新增註解使用繁體中文，且只在「WHY」非顯而易見時才寫（沿用 `CLAUDE.md` 既有風格），不要逐行翻譯程式在做什麼。
- 不新增任何自動化測試框架/套件；驗證一律走本文件「Run tests」步驟描述的手動/Playwright方式。
- 每個任務完成後都要能獨立建置成功（`python generate.py`不報錯）並可在瀏覽器手動驗證，即使其他任務尚未開始。

---

## Part 1：測試模式整合＋密碼閘門（對應設計文件 §1）

### Task 1: 測試模式勾選加上密碼閘門（`nightnight`）

**Files:**
- Modify: `static_src/midnight.js`（`handleTestModeToggle()`，約在 `midnight.js:528-531`）
- Test: 無自動化測試，見下方「Run tests」

**Interfaces:**
- Consumes：既有 `GameStorage.rtSet(gameId, "cloud", "meta/testMode", checked)`、既有 `el("midnight-lobby-test-mode-checkbox")`。
- Produces：`handleTestModeToggle()` 簽章不變（仍是無參數、綁定在checkbox的`change`事件），供 Task 2 沿用同一顆checkbox。

- [ ] **Step 1: 修改 `handleTestModeToggle()`**

把 `static_src/midnight.js` 裡的：

```js
  function handleTestModeToggle() {
    var checked = el("midnight-lobby-test-mode-checkbox").checked;
    GameStorage.rtSet(gameId, "cloud", "meta/testMode", checked);
  }
```

改成：

```js
  // 測試模式密碼閘門（2026-09-09新增，使用者明確規格：「按下測試模式按鍵需要輸入密碼
  // nightnight」）：只有「開啟」需要密碼，關閉不用。答錯/取消時checkbox要復原成未勾選，
  // 否則畫面會顯示已勾選但meta.testMode其實沒被寫入true，造成UI與實際狀態不一致。
  function handleTestModeToggle() {
    var checkbox = el("midnight-lobby-test-mode-checkbox");
    var checked = checkbox.checked;
    if (!checked) {
      GameStorage.rtSet(gameId, "cloud", "meta/testMode", false);
      return;
    }
    var input = window.prompt(window.I18N.t("midnight_test_mode_password_prompt"));
    if (input !== "nightnight") {
      checkbox.checked = false;
      return;
    }
    GameStorage.rtSet(gameId, "cloud", "meta/testMode", true);
  }
```

- [ ] **Step 2: 新增i18n key**

在 `site_src/i18n_data_zh.py` 找到 `"midnight_test_panel_title": "測試模式",` 那一行（約第1573行），在它上面新增：

```python
    "midnight_test_mode_password_prompt": "請輸入密碼以開啟測試模式",
```

同樣位置在 `site_src/i18n_data_ja.py` 新增：

```python
    "midnight_test_mode_password_prompt": "テストモードを有効にするにはパスワードを入力してください",
```

在 `site_src/i18n_data_en.py` 新增：

```python
    "midnight_test_mode_password_prompt": "Enter password to enable test mode",
```

- [ ] **Step 3: 語法檢查**

Run: `node --check static_src/midnight.js`
Expected: 無輸出（代表語法正確）。

- [ ] **Step 4: 建置**

Run: `python generate.py`
Expected: 無錯誤訊息，`dist/` 更新。

- [ ] **Step 5: 手動/Playwright驗證**

啟動 `python -m http.server 8000 --directory dist`，用Playwright或人工：
1. 開一個新遊戲、進入lobby，勾選「測試模式」checkbox。
2. 確認彈出 `window.prompt`；Playwright需先註冊 `page.on("dialog", async dialog => { await dialog.accept("wrongpass"); })` 測試答錯情境，確認checkbox彈開後恢復未勾選、且RTDB/localStorage的`meta.testMode`未被設為true。
3. 改成 `dialog.accept("nightnight")`，確認 `meta.testMode` 變成 `true`。
4. 取消勾選，確認不會跳出prompt，直接寫入`false`。

- [ ] **Step 6: Commit**

```bash
git add static_src/midnight.js site_src/i18n_data_zh.py site_src/i18n_data_ja.py site_src/i18n_data_en.py
git commit -m "$(cat <<'EOF'
feat(midnight): 測試模式開啟改為需輸入密碼nightnight

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Uwg3Xm2sYucPTLtW7MJRRr
EOF
)"
```

---

### Task 2: 測試面板改為選單式開關（不再由 `meta.testMode` 直接常駐顯示）

**Files:**
- Modify: `site_src/midnight_page.py`（`#midnight-test-panel` 區塊，約 `midnight_page.py:397-441`）
- Modify: `static_src/midnight.js`（`renderTestPanel()` 約 `midnight.js:548-555`；`bindInput()` 約 `midnight.js:1564`）

**Interfaces:**
- Consumes：既有 `meta.testMode`（Task 1沿用）、既有 `bindInput()` 內的 `el("btn-midnight-toggle-menu").addEventListener(...)` pattern（`panel.hidden = !panel.hidden`）。
- Produces：新增本地模組變數 `testConsoleOpen`（boolean，預設`false`），供 Task 3（立即縮圈按鈕）的X關閉按鈕沿用同一個變數。

- [ ] **Step 1: HTML新增入口按鈕與X關閉按鈕**

在 `site_src/midnight_page.py` 中，把 `#btn-midnight-toggle-menu` 後面（原本緊接著 `<!-- 測試模式面板 -->` 註解與 `<div id="midnight-test-panel" hidden>`）改成：

```html
          <button type="button" id="btn-midnight-open-character-sheet" data-i18n="midnight_character_sheet_open_button"></button>
          <button type="button" id="btn-midnight-toggle-menu" data-i18n="midnight_menu_button"></button>
          <!-- 測試主控台入口（2026-09-09改版）：只在meta.testMode為true時才顯示，取代
               原本「測試模式一開就常駐顯示整塊面板」的作法，見static/midnight.jsの
               renderTestPanel()。 -->
          <button type="button" id="btn-midnight-open-test-console" data-i18n="midnight_test_console_open_button" hidden></button>

          <div id="midnight-test-panel" hidden>
            <div class="wb-row">
              <h3 data-i18n="midnight_test_panel_title"></h3>
              <button type="button" id="btn-midnight-test-panel-close">×</button>
            </div>
            <p id="midnight-test-panel-last-pc"></p>
            <p id="midnight-test-panel-last-pc-defense"></p>
            <p id="midnight-test-panel-last-enemy"></p>
            <p id="midnight-test-panel-last-enemy-guard"></p>
            <div class="wb-row">
              <label data-i18n="midnight_test_mult_enemy_hp"></label>
              <input type="range" id="midnight-test-slider-enemy-hp" min="0.2" max="100" step="0.1" value="1">
              <input type="number" id="midnight-test-number-enemy-hp" class="midnight-test-number-input" min="0.2" max="100" step="0.1" value="1">
              <span id="midnight-test-slider-enemy-hp-value"></span>
            </div>
            <div class="wb-row">
              <label data-i18n="midnight_test_mult_enemy_atk"></label>
              <input type="range" id="midnight-test-slider-enemy-atk" min="0" max="20" step="0.1" value="1">
              <input type="number" id="midnight-test-number-enemy-atk" class="midnight-test-number-input" min="0" max="20" step="0.1" value="1">
              <span id="midnight-test-slider-enemy-atk-value"></span>
            </div>
            <div class="wb-row">
              <label data-i18n="midnight_test_mult_pc_dmg"></label>
              <input type="range" id="midnight-test-slider-pc-dmg" min="0.2" max="100" step="0.1" value="1">
              <input type="number" id="midnight-test-number-pc-dmg" class="midnight-test-number-input" min="0.2" max="100" step="0.1" value="1">
              <span id="midnight-test-slider-pc-dmg-value"></span>
            </div>
            <div class="wb-row">
              <label data-i18n="midnight_test_mult_enemy_guard"></label>
              <input type="range" id="midnight-test-slider-enemy-guard" min="0" max="10" step="0.1" value="1">
              <input type="number" id="midnight-test-number-enemy-guard" class="midnight-test-number-input" min="0" max="10" step="0.1" value="1">
              <span id="midnight-test-slider-enemy-guard-value"></span>
            </div>
            <!-- 立即縮圈（Task 3新增） -->
            <button type="button" id="btn-midnight-test-force-shrink" data-i18n="midnight_test_force_shrink_button"></button>
          </div>
```

（`btn-midnight-test-force-shrink` 按鈕先在HTML中放好，Task 3再接上JS行為，避免這裡跟Task 3互搶同一段HTML的編輯範圍。）

- [ ] **Step 2: 修改 `renderTestPanel()` 加入 `testConsoleOpen` 判斷**

在 `static_src/midnight.js` 找到 `var lastPcDamageInfo = null;`（約第525行）那一段，在它下面新增模組變數：

```js
  var testConsoleOpen = false; // 本地only：測試主控台面板開關，不透過meta.testMode控制常駐顯示
```

然後把 `renderTestPanel()` 開頭：

```js
  function renderTestPanel() {
    var enabled = !!(meta && meta.testMode);
    var checkbox = el("midnight-lobby-test-mode-checkbox");
    if (checkbox) checkbox.checked = enabled;
    var panel = el("midnight-test-panel");
    if (!panel) return;
    panel.hidden = !enabled;
    if (!enabled) return;
```

改成：

```js
  function renderTestPanel() {
    var enabled = !!(meta && meta.testMode);
    var checkbox = el("midnight-lobby-test-mode-checkbox");
    if (checkbox) checkbox.checked = enabled;
    var openBtn = el("btn-midnight-open-test-console");
    if (openBtn) openBtn.hidden = !enabled;
    if (!enabled) testConsoleOpen = false; // 測試模式被關掉時，順便收掉還開著的主控台
    var panel = el("midnight-test-panel");
    if (!panel) return;
    panel.hidden = !(enabled && testConsoleOpen);
    if (!enabled || !testConsoleOpen) return;
```

- [ ] **Step 3: 在 `bindInput()` 新增按鈕綁定**

在 `static_src/midnight.js` 的 `bindInput()` 函式內，緊接著既有的：

```js
    el("btn-midnight-toggle-menu").addEventListener("click", function () {
      var panel = el("midnight-menu-panel");
      panel.hidden = !panel.hidden;
    });
```

之後新增：

```js
    el("btn-midnight-open-test-console").addEventListener("click", function () {
      testConsoleOpen = true;
      renderTestPanel();
    });
    el("btn-midnight-test-panel-close").addEventListener("click", function () {
      testConsoleOpen = false;
      renderTestPanel();
    });
```

- [ ] **Step 4: 新增i18n key**

在三個 `i18n_data_*.py` 對應語系檔案的 `midnight_test_panel_title` 附近新增：

`i18n_data_zh.py`：
```python
    "midnight_test_console_open_button": "測試主控台",
```

`i18n_data_ja.py`：
```python
    "midnight_test_console_open_button": "テストコンソール",
```

`i18n_data_en.py`：
```python
    "midnight_test_console_open_button": "Test Console",
```

- [ ] **Step 5: 語法檢查／建置**

Run: `node --check static_src/midnight.js` → 無輸出。
Run: `python generate.py` → 無錯誤。

- [ ] **Step 6: 手動驗證**

1. 用Playwright依`CLAUDE.md §4.2`建立測試遊戲、開啟admin密碼gate（`night`）、設定`storageMode:"local"`，並依`CLAUDE.md §4.3`帶`?game=<id>`進入`night/index.html`——不對，此為midnight頁面，改進入 `midnight/index.html?game=<id>`（若沒有專屬join流程，直接在localStorage寫入`meta.testMode:true`供本任務測試，因為這是「已經由App正常建立完整state後才修改特定欄位」，符合`CLAUDE.md §4.4`的允許做法）。
2. 確認`meta.testMode`為true時，右上角出現「測試主控台」按鈕，`#midnight-test-panel`預設仍是hidden。
3. 點擊按鈕，確認面板出現；點擊面板內的×，確認面板收合、按鈕仍在。
4. 把`meta.testMode`改回false，確認按鈕與面板都消失。

- [ ] **Step 7: Commit**

```bash
git add static_src/midnight.js site_src/midnight_page.py site_src/i18n_data_zh.py site_src/i18n_data_ja.py site_src/i18n_data_en.py
git commit -m "$(cat <<'EOF'
feat(midnight): 測試主控台改為選單式開關,不再隨測試模式常駐顯示

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Uwg3Xm2sYucPTLtW7MJRRr
EOF
)"
```

---

### Task 3: 測試主控台新增「立即縮圈」按鈕

**Files:**
- Modify: `static_src/midnight.js`（新增 `handleForceShrinkClick()`；`bindInput()`）

**Interfaces:**
- Consumes：既有 `meta.day2StartAt`／`meta.day3StartAt`／`meta.sessionStartAt`、既有常數 `PHASE_TOTAL_MS`（`midnight.js:56`）、既有 `GameStorage.rtSet`。
- Produces：`handleForceShrinkClick()`（無參數、無回傳值），供 Task 2 已放好的 `#btn-midnight-test-force-shrink` 按鈕綁定。

- [ ] **Step 1: 新增 `handleForceShrinkClick()`**

在 `static_src/midnight.js` 的 `handleRestartCycle()` 函式（約 `midnight.js:9950`）後面新增：

```js
  // 立即縮圈（2026-09-09新增，測試主控台專用）：不新增第二套計時系統，直接把目前這一天
  // 的StartAt往回撥PHASE_TOTAL_MS（跟computeDayStage()既有的時間衍生公式一致），讓
  // currentPhaseInfo()下一影格就算出這一天的最終半徑（stage:"done"/"waitingForDay2/3"）。
  // day3沒有地圖/縮圈可言，直接no-op。
  function handleForceShrinkClick() {
    if (!meta || !meta.testMode) return;
    if (meta.day3StartAt) return;
    var now = Date.now();
    if (meta.day2StartAt) {
      GameStorage.rtSet(gameId, "cloud", "meta/day2StartAt", now - PHASE_TOTAL_MS);
    } else {
      GameStorage.rtSet(gameId, "cloud", "meta/sessionStartAt", now - PHASE_TOTAL_MS);
    }
  }
```

- [ ] **Step 2: 綁定按鈕**

在 `bindInput()` 內，緊接著 Task 2 新增的 `btn-midnight-test-panel-close` 綁定之後，新增：

```js
    el("btn-midnight-test-force-shrink").addEventListener("click", handleForceShrinkClick);
```

- [ ] **Step 3: 新增i18n key**

`i18n_data_zh.py`：
```python
    "midnight_test_force_shrink_button": "立即縮圈",
```

`i18n_data_ja.py`：
```python
    "midnight_test_force_shrink_button": "即座に円を縮小",
```

`i18n_data_en.py`：
```python
    "midnight_test_force_shrink_button": "Force Shrink Circle",
```

- [ ] **Step 4: 語法檢查／建置**

Run: `node --check static_src/midnight.js` → 無輸出。
Run: `python generate.py` → 無錯誤。

- [ ] **Step 5: 手動驗證**

1. 開啟測試主控台（沿用Task 2驗證流程），確認面板底部有「立即縮圈」按鈕。
2. Day1進行中時點擊，確認地圖圈（`drawOutsideCircleMask`）立即跳到最終半徑、位置移到最終收縮點。
3. 進入Day2後重複驗證；Day3時確認按鈕點擊無效果（不報錯即可，因為Day3本來就不畫地圖圈）。

- [ ] **Step 6: Commit**

```bash
git add static_src/midnight.js site_src/i18n_data_zh.py site_src/i18n_data_ja.py site_src/i18n_data_en.py
git commit -m "$(cat <<'EOF'
feat(midnight): 測試主控台新增立即縮圈按鈕

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Uwg3Xm2sYucPTLtW7MJRRr
EOF
)"
```

---

### Task 4: 戰鬥中敵人HP數值僅測試模式顯示

**Files:**
- Modify: `static_src/midnight.js`（`renderCombatPanel()` 約 `midnight.js:9353-9369`）

**Interfaces:**
- Consumes：既有 `meta.testMode`、既有 `setBar()`（`midnight.js:9253`，簽章不變、不修改）。
- Produces：無新函式，純粹是`renderCombatPanel()`內部行為調整。

- [ ] **Step 1: 修改 `renderCombatPanel()`**

把：

```js
    setBar("midnight-enemy-hp-fill", "midnight-enemy-hp-value", hp, max);
```

改成：

```js
    setBar("midnight-enemy-hp-fill", "midnight-enemy-hp-value", hp, max);
    // 敵人HP數值只在測試模式顯示（2026-09-09新增，使用者明確規格），非測試模式只留
    // 血量條本身——不修改setBar()本體，因為它也共用給自己的HP/FP/體力條，不能連坐隱藏。
    var enemyHpValueEl = el("midnight-enemy-hp-value");
    if (enemyHpValueEl && !(meta && meta.testMode)) enemyHpValueEl.textContent = "";
```

- [ ] **Step 2: 語法檢查／建置**

Run: `node --check static_src/midnight.js` → 無輸出。
Run: `python generate.py` → 無錯誤。

- [ ] **Step 3: 手動驗證**

1. `meta.testMode` 為false時進入一場戰鬥，確認`#midnight-enemy-hp-value`顯示空白、但血條本身（`#midnight-enemy-hp-fill`寬度）仍正確反映比例。
2. 開啟測試模式後同樣進入戰鬥，確認數值文字（例如`18/20`）恢復顯示。

- [ ] **Step 4: Commit**

```bash
git add static_src/midnight.js
git commit -m "$(cat <<'EOF'
feat(midnight): 戰鬥中敵人HP數值改為僅測試模式顯示

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Uwg3Xm2sYucPTLtW7MJRRr
EOF
)"
```

---

## Part 2：上方資訊欄折疊排版與HUD疊層順序（對應設計文件 §2）

### Task 5: banner群組折疊CSS＋收合/展開按鈕（HTML+CSS，不含JS邏輯）

**Files:**
- Modify: `site_src/midnight_page.py`（`#midnight-field-banner` 約 `midnight_page.py:146-168`；`#midnight-map-icon-row` 約 `midnight_page.py:392-395`）
- Modify: `static_src/style.css`（`style.css:5328-5347` 共用選擇器群組附近）

**Interfaces:**
- Consumes：既有共用選擇器群組（`#midnight-field-enter-prompt` 等，`style.css:5328`）。
- Produces：新增CSS class `.midnight-field-overlay-collapsed`（供Task 6 JS切換）、新增DOM id `btn-midnight-hud-collapse`／`btn-midnight-hud-expand`（供Task 6 JS綁定）。

- [ ] **Step 1: HTML新增收合按鈕（放在banner內）**

在 `site_src/midnight_page.py` 的 `#midnight-field-banner` 區塊，找到：

```html
        <div id="midnight-field-banner" hidden>
          <p id="midnight-field-banner-name"></p>
```

改成：

```html
        <div id="midnight-field-banner" hidden>
          <button type="button" id="btn-midnight-hud-collapse" aria-label="collapse">&#9654;</button>
          <p id="midnight-field-banner-name"></p>
```

（`&#9654;` 是「▶」字元。之所以只放在`#midnight-field-banner`而不是共用選擇器群組的每一個元素裡，是因為只有banner／late-claim-prompt這類「進行中內容」需要折疊；`#midnight-field-enter-prompt`（尚未進入）／`#midnight-field-invite-prompt`（等待接受邀請）本身內容很短，不需要折疊功能——與Task 6折疊邏輯只針對banner與late-claim-prompt呼應。）

- [ ] **Step 2: HTML新增展開按鈕（放在HUD右上，地圖按鈕列內）**

找到：

```html
          <div id="midnight-map-icon-row">
            <canvas id="midnight-minimap-canvas" hidden></canvas>
            <button type="button" id="btn-midnight-map-icon" data-i18n="midnight_map_icon_label"></button>
          </div>
```

改成：

```html
          <div id="midnight-map-icon-row">
            <!-- 折疊後的展開入口（2026-09-09新增）：放在地圖按鈕左側、盧恩數值下方，
                 只在banner群組折疊中才顯示，見static/midnight.jsのrenderFieldOverlay()。 -->
            <button type="button" id="btn-midnight-hud-expand" aria-label="expand" hidden>&#9664;</button>
            <canvas id="midnight-minimap-canvas" hidden></canvas>
            <button type="button" id="btn-midnight-map-icon" data-i18n="midnight_map_icon_label"></button>
          </div>
```

（`&#9664;` 是「◀」字元。）

- [ ] **Step 3: CSS新增折疊樣式**

在 `static_src/style.css` 的共用選擇器群組（`#midnight-field-enter-prompt, ... { ... }`，約第5328-5347行）後面新增：

```css
/* 上方資訊欄折疊（2026-09-09新增，使用者明確規格）：折疊時把banner壓成一條薄線，
   z-index降到低於#midnight-hud-top-left/right（500），讓HUD角落面板疊在上面；
   展開時完全恢復原本樣式（不覆寫position/z-index，交回上面共用選擇器群組的預設值）。 */
#midnight-field-banner.midnight-field-overlay-collapsed,
#midnight-field-late-claim-prompt.midnight-field-overlay-collapsed {
  z-index: 400;
  padding: 0.15rem 0.6rem;
  max-width: 200px;
}

#midnight-field-banner.midnight-field-overlay-collapsed > *:not(#btn-midnight-hud-collapse),
#midnight-field-late-claim-prompt.midnight-field-overlay-collapsed > * {
  display: none;
}

#midnight-field-banner.midnight-field-overlay-collapsed #btn-midnight-hud-collapse {
  display: none;
}

#btn-midnight-hud-collapse {
  float: right;
  margin-left: 0.4rem;
  line-height: 1;
}
```

（`#midnight-field-late-claim-prompt`折疊時內部全部子元素都隱藏，因為它沒有收合按鈕本身——它的折疊/展開統一由banner的按鈕代管，見Task 6。）

- [ ] **Step 4: 建置**

Run: `python generate.py` → 無錯誤。（此任務不含JS邏輯變更，`node --check`留到Task 6。）

- [ ] **Step 5: 視覺驗證**

用瀏覽器開發者工具手動對`#midnight-field-banner`加上`midnight-field-overlay-collapsed` class（`document.getElementById("midnight-field-banner").classList.add("midnight-field-overlay-collapsed")`），確認視覺上壓成一條薄線且原本按鈕消失；移除class後確認恢復。

- [ ] **Step 6: Commit**

```bash
git add site_src/midnight_page.py static_src/style.css
git commit -m "$(cat <<'EOF'
feat(midnight): 新增上方資訊欄折疊用的HTML/CSS(收合▶/展開◀按鈕)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Uwg3Xm2sYucPTLtW7MJRRr
EOF
)"
```

---

### Task 6: 折疊/展開JS邏輯串接

**Files:**
- Modify: `static_src/midnight.js`（`renderFieldOverlay()` 約 `midnight.js:9033-9068`；`bindInput()`）

**Interfaces:**
- Consumes：Task 5的 `.midnight-field-overlay-collapsed` class、`#btn-midnight-hud-collapse`、`#btn-midnight-hud-expand`。
- Produces：新增模組變數 `fieldOverlayCollapsed`（boolean，供其他任務讀取目前折疊狀態，若未來需要時可重用，本次計畫內部不再有其他消費者）。

- [ ] **Step 1: 新增模組變數與toggle函式**

在 `static_src/midnight.js` 中，`var nearbyFieldPoint = null;`（約`midnight.js:696`）附近新增：

```js
  var fieldOverlayCollapsed = false; // 本地only：上方資訊欄banner群組折疊狀態
```

在 `renderFieldOverlay()` 函式（`midnight.js:9033`）前面新增一個獨立函式：

```js
  // 折疊/展開上方資訊欄（2026-09-09新增）：只切換本地旗標＋重繪，renderFieldOverlay()
  // 每影格都會被updateNearbyFieldPoint()呼叫，下一影格就會套用最新的class/按鈕狀態。
  function setFieldOverlayCollapsed(collapsed) {
    fieldOverlayCollapsed = collapsed;
    renderFieldOverlay();
    var expandBtn = el("btn-midnight-hud-expand");
    if (expandBtn) expandBtn.hidden = !collapsed;
  }
```

- [ ] **Step 2: 在 `renderFieldOverlay()` 套用class**

在 `renderFieldOverlay()` 函式內找到既有這一行（緊接在函式開頭`var pt = ...`／`var enterPrompt = ...`／`var invitePrompt = ...`之後）：

```js
    var banner = el("midnight-field-banner");
```

在它後面新增：

```js
    var banner = el("midnight-field-banner");
    banner.classList.toggle("midnight-field-overlay-collapsed", fieldOverlayCollapsed);
    var lateClaimBoxForCollapse = el("midnight-field-late-claim-prompt");
    if (lateClaimBoxForCollapse) lateClaimBoxForCollapse.classList.toggle("midnight-field-overlay-collapsed", fieldOverlayCollapsed);
```

（`var banner = el(...)`本身不重複宣告，只是在既有這行下方緊接著新增另外兩行；`lateClaimBoxForCollapse`用另一個變數名稱是因為函式後面已經有`var lateClaimBox = el("midnight-field-late-claim-prompt");`這個既有變數用於別的用途，避免同名衝突。）

- [ ] **Step 3: 綁定按鈕**

在 `bindInput()` 內新增：

```js
    el("btn-midnight-hud-collapse").addEventListener("click", function () {
      setFieldOverlayCollapsed(true);
    });
    el("btn-midnight-hud-expand").addEventListener("click", function () {
      setFieldOverlayCollapsed(false);
    });
```

- [ ] **Step 4: 語法檢查／建置**

Run: `node --check static_src/midnight.js` → 無輸出。
Run: `python generate.py` → 無錯誤。

- [ ] **Step 5: 手動驗證**

1. 靠近地圖上的一個點觸發`#midnight-field-banner`顯示，確認banner右上角「▶」按鈕存在。
2. 點擊「▶」，確認banner變薄線、按鈕消失，`#midnight-hud-top-right`地圖按鈕左側出現「◀」。
3. 點擊「◀」，確認banner恢復、「◀」消失。
4. 用late-claim情境（依`CLAUDE.md §4.4`正常流程走出一個`fieldProgress.perPlayerRewards`未領取狀態）確認同樣的折疊/展開行為對`#midnight-field-late-claim-prompt`也生效。

- [ ] **Step 6: Commit**

```bash
git add static_src/midnight.js
git commit -m "$(cat <<'EOF'
feat(midnight): 接上上方資訊欄折疊/展開的JS邏輯

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Uwg3Xm2sYucPTLtW7MJRRr
EOF
)"
```

---

## Part 3：樓層進入bug修正＋戰鬥前置準備流程（對應設計文件 §3）

### Task 7: 修正最後一層進入邀請閃爍消失bug

**Files:**
- Modify: `static_src/midnight.js`（`updateNearbyFieldPoint()` 約 `midnight.js:4329-4335`；`renderFieldOverlay()` 約 `midnight.js:9150`）

**Interfaces:**
- Consumes：既有 `fieldEnterAttempted[pt.id]`（`midnight.js:4548/4557`，不修改其寫入邏輯）。

- [ ] **Step 1: 修正 `updateNearbyFieldPoint()` 的後補領獎判斷**

把：

```js
      if (!nearbyLateJoinPoint && progress0) {
        var alreadyClaimed0 = progress0.claimedBy && progress0.claimedBy[myTokenId];
        var neverJoined0 = !(trig0 && trig0.participants && trig0.participants[mySlot]);
        if (neverJoined0 && !alreadyClaimed0) {
          nearbyLateClaimPoint = found;
        }
      }
```

改成：

```js
      // fix(2026-09-09)：剛按下[進入]的當下，本地fieldTriggers快取可能還沒反映
      // handleEnterFieldPointClick()剛寫入的trig（RTDB監聽回填有延遲），這段窗口內
      // trig0會被誤判成null、neverJoined0誤判成true，導致late-claim-prompt跟banner
      // 搶同一個固定位置閃爍。用既有的fieldEnterAttempted[pt.id]（本來就代表「我剛按過
      // 這個點的進入」）排除這個窗口。
      if (!nearbyLateJoinPoint && progress0 && !fieldEnterAttempted[found.id]) {
        var alreadyClaimed0 = progress0.claimedBy && progress0.claimedBy[myTokenId];
        var neverJoined0 = !(trig0 && trig0.participants && trig0.participants[mySlot]);
        if (neverJoined0 && !alreadyClaimed0) {
          nearbyLateClaimPoint = found;
        }
      }
```

- [ ] **Step 2: 在 `renderFieldOverlay()` 補上第二層保險**

找到（Task 6已經把這一行的`var banner`合併過，這裡以功能定位描述）banner顯示分支：

```js
    banner.hidden = false;
    var bannerFloorLabel = window.I18N.t("midnight_field_floor_progress_label", {
```

在 `banner.hidden = false;` 後面新增一行：

```js
    banner.hidden = false;
    el("midnight-field-late-claim-prompt").hidden = true; // fix(2026-09-09)：banner顯示時強制排除late-claim-prompt同時出現，作為第二層保險
    var bannerFloorLabel = window.I18N.t("midnight_field_floor_progress_label", {
```

同時在函式更前面、`trig.status === "inviting"`分支裡 `amParticipant` 為true那段（顯示邀請倒數banner的地方）也要加同樣一行——找到：

```js
        invitePrompt.hidden = true;
        banner.hidden = false;
        el("midnight-field-banner-name").textContent = locationName;
```

改成：

```js
        invitePrompt.hidden = true;
        banner.hidden = false;
        el("midnight-field-late-claim-prompt").hidden = true; // fix(2026-09-09)：同上，邀請倒數期間也要排除
        el("midnight-field-banner-name").textContent = locationName;
```

- [ ] **Step 3: 語法檢查／建置**

Run: `node --check static_src/midnight.js` → 無輸出。
Run: `python generate.py` → 無錯誤。

- [ ] **Step 4: 手動驗證**

1. 用Playwright依`CLAUDE.md §4.4`正常流程把某個板塊打穿到只剩最後一層（透過UI操作，不手動寫入不完整state）。
2. 靠近該點按「進入」，確認`#midnight-field-banner`／讀取條正常顯示、不再閃爍消失，能正常走完打字機/投票流程進入最後一層戰鬥。
3. 確認`#midnight-field-late-claim-prompt`在banner顯示期間不會同時可見。
4. 確認非最後一層（例如第一層，沒有`fieldProgress`）的一般進入流程行為不受影響。

- [ ] **Step 5: Commit**

```bash
git add static_src/midnight.js
git commit -m "$(cat <<'EOF'
fix(midnight): 修正最後一層進入邀請與後補領獎提示搶位導致banner閃爍消失的bug

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Uwg3Xm2sYucPTLtW7MJRRr
EOF
)"
```

---

### Task 8: 遭遇戰鬥前新增識別資訊＋5秒準備流程

**Files:**
- Modify: `site_src/midnight_page.py`（新增 `#midnight-battle-prep-banner`，緊接在 `#midnight-strong-enemy-banner` 之後，約 `midnight_page.py:180` 附近）
- Modify: `static_src/style.css`（把新id加入共用選擇器群組，`style.css:5328`）
- Modify: `static_src/midnight.js`（`recomputeActiveEncounter()` 約 `midnight.js:4411-4461`；`frame()` 約 `midnight.js:10451`）

**Interfaces:**
- Consumes：既有 `window.PriTestEnemies.get()`／`bossRulebookData()`（`renderFieldEncounterPanel()`，`midnight.js:9457-9505`，僅讀取邏輯搬用，不改動原函式）、既有 `BOSS_ENEMY_FAMILY_SENTINEL` 常數、既有 `setMapExpanded()`（本任務不修改它，只是延後`activeEncounter`成立的時機點，讓既有`frame()`裡的呼叫自然延後生效）。
- Produces：新增模組變數 `battlePrepCandidate`／`battlePrepUntil`；新增函式 `updateBattlePrep(now)`／`renderBattlePrepBanner()`，供 `frame()` 呼叫。

- [ ] **Step 1: HTML新增準備banner**

在 `site_src/midnight_page.py` 的 `#midnight-strong-enemy-banner` 區塊（約`midnight_page.py:173-180`）後面新增：

```html
        <!-- 遭遇戰鬥前置準備（2026-09-09新增，使用者明確規格）：敵人/強敵/夜之強敵/夜王
             這4種會進入戰鬥的encounter，第一次遭遇時先顯示識別資訊5秒、讀完顯示「準備
             進入戰鬥」，這段期間地圖不會被強制收合。見static/midnight.jsの
             updateBattlePrep()/renderBattlePrepBanner()。 -->
        <div id="midnight-battle-prep-banner" hidden>
          <p id="midnight-battle-prep-name"></p>
          <p id="midnight-battle-prep-detail"></p>
          <div class="midnight-loading-track">
            <span id="midnight-battle-prep-loading-fill" class="midnight-loading-fill"></span>
          </div>
          <p id="midnight-battle-prep-status"></p>
        </div>
```

- [ ] **Step 2: CSS把新id加入共用選擇器群組**

在 `static_src/style.css` 找到：

```css
#midnight-field-enter-prompt,
#midnight-field-invite-prompt,
#midnight-field-banner,
#midnight-field-late-join-prompt,
#midnight-field-late-claim-prompt,
#midnight-strong-enemy-banner {
```

改成：

```css
#midnight-field-enter-prompt,
#midnight-field-invite-prompt,
#midnight-field-banner,
#midnight-field-late-join-prompt,
#midnight-field-late-claim-prompt,
#midnight-strong-enemy-banner,
#midnight-battle-prep-banner {
```

- [ ] **Step 3: 新增模組變數與準備流程函式**

在 `static_src/midnight.js`，`var pendingBattleReentry = null;`／`var battleEnteringUntil = null;`（`recomputeActiveEncounter()`上方，需自行搜尋這兩個var的宣告處，通常跟`activeEncounter`宣告在同一段）附近新增：

```js
  var BATTLE_PREP_DURATION_MS = 5000; // 使用者明確規格：識別資訊+讀條共5秒
  var battlePrepCandidate = null; // 目前正在跑5秒準備流程的encounter candidate
  var battlePrepUntil = null; // 準備流程結束時間戳；null代表沒有正在準備
```

在 `recomputeActiveEncounter()`（`midnight.js:4411`）中，找到：

```js
    var amParticipant = !!(trig.participants && trig.participants[mySlot]);
    if (confirmedEncounterIds[candidate.id] === undefined && amParticipant) {
      confirmedEncounterIds[candidate.id] = true;
    }
    if (confirmedEncounterIds[candidate.id]) {
      pendingBattleReentry = null;
      activeEncounter = candidate;
      return;
    }
```

改成：

```js
    var amParticipant = !!(trig.participants && trig.participants[mySlot]);
    // 2026-09-09新增：第一次遭遇（confirmedEncounterIds尚未設定過）時，不再直接
    // confirmedEncounterIds=true，改先跑5秒識別資訊準備流程（updateBattlePrep()），
    // 讓地圖不會瞬間收合。re-entry（confirmedEncounterIds已經設過、這次是重新靠近）
    // 維持原有的pendingBattleReentry 3秒讀條流程，不受影響。
    if (confirmedEncounterIds[candidate.id] === undefined && amParticipant) {
      if (!battlePrepCandidate || battlePrepCandidate.id !== candidate.id) {
        battlePrepCandidate = candidate;
        battlePrepUntil = Date.now() + BATTLE_PREP_DURATION_MS;
      }
      return;
    }
    if (confirmedEncounterIds[candidate.id]) {
      pendingBattleReentry = null;
      activeEncounter = candidate;
      return;
    }
```

- [ ] **Step 4: 新增 `updateBattlePrep()` 與 `renderBattlePrepBanner()`**

在 `recomputeActiveEncounter()` 函式後面（`handleEnterBattleClick()`之前）新增：

```js
  // 遭遇戰鬥前置準備（2026-09-09新增）：5秒跑完後才把battlePrepCandidate正式提升成
  // confirmedEncounterIds/activeEncounter，讓recomputeActiveEncounter()下一影格接手
  // 既有流程（含frame()裡「activeEncounter存在就setMapExpanded(false)」的既有邏輯，
  // 這裡完全不重複那段收合地圖的程式碼）。
  function updateBattlePrep(now) {
    if (!battlePrepCandidate) return;
    // 離開範圍/敵人已死/已經是participant以外的原因喪失候選資格時作廢，避免殘留。
    var stillValid = (encounterEnemyPoint() && encounterEnemyPoint().id === battlePrepCandidate.id) ||
      (nearbyFieldPoint && nearbyFieldPoint.id === battlePrepCandidate.id) ||
      (nearbyFinalCircleBoss && nearbyFinalCircleBoss.id === battlePrepCandidate.id) ||
      (nearbyDay3Boss && nearbyDay3Boss.id === battlePrepCandidate.id);
    if (!stillValid) {
      battlePrepCandidate = null;
      battlePrepUntil = null;
      return;
    }
    if (now < battlePrepUntil) return;
    confirmedEncounterIds[battlePrepCandidate.id] = true;
    battlePrepCandidate = null;
    battlePrepUntil = null;
    recomputeActiveEncounter();
  }

  // 識別資訊來源沿用renderFieldEncounterPanel()同一套資料查詢（window.PriTestEnemies.get()／
  // bossRulebookData()／window.PriTestNightBosses），不新增第二套敵人資料解析。
  function battlePrepIdentityText(trig) {
    if (!trig) return { name: "", detail: "" };
    if (trig.enemyFamilyId === BOSS_ENEMY_FAMILY_SENTINEL) {
      var bossInfo = bossRulebookData(trig.enemyId);
      return { name: bossInfo ? window.PriTestEnemies.localizedText(bossInfo.name) : trig.enemyId, detail: "" };
    }
    var data = trig.enemyFamilyId && window.PriTestEnemies ? window.PriTestEnemies.get(trig.enemyFamilyId, trig.enemyId) : null;
    if (!data) return { name: "", detail: "" };
    var parts = [];
    parts.push(window.I18N.t("midnight_strong_enemy_kind_label", { kind: window.PriTestEnemies.localizedText(data.familyName) }));
    if (data.enemy.size) parts.push(window.I18N.t("midnight_strong_enemy_size_label", { size: data.enemy.size }));
    return { name: window.PriTestEnemies.localizedText(data.enemy.name), detail: parts.join("　") };
  }

  function renderBattlePrepBanner(now) {
    var box = el("midnight-battle-prep-banner");
    if (!box) return;
    if (!battlePrepCandidate) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    var trig = fieldTriggers[battlePrepCandidate.id];
    var identity = battlePrepIdentityText(trig);
    el("midnight-battle-prep-name").textContent = identity.name;
    el("midnight-battle-prep-detail").textContent = identity.detail;
    var elapsed = BATTLE_PREP_DURATION_MS - Math.max(0, battlePrepUntil - now);
    var pct = Math.max(0, Math.min(100, (elapsed / BATTLE_PREP_DURATION_MS) * 100));
    el("midnight-battle-prep-loading-fill").style.width = pct + "%";
    el("midnight-battle-prep-status").textContent =
      pct >= 100 ? window.I18N.t("midnight_battle_prep_ready_note") : "";
  }
```

- [ ] **Step 5: 在 `frame()` 呼叫新函式**

在 `static_src/midnight.js` 的 `frame()` 函式（`midnight.js:10451`）中，找到：

```js
    updateBattleEnterLoading(now);
    renderEnterBattlePrompt();
```

改成：

```js
    updateBattleEnterLoading(now);
    updateBattlePrep(now);
    renderEnterBattlePrompt();
    renderBattlePrepBanner(now);
```

- [ ] **Step 6: 新增i18n key**

`i18n_data_zh.py`：
```python
    "midnight_battle_prep_ready_note": "準備進入戰鬥",
```

`i18n_data_ja.py`：
```python
    "midnight_battle_prep_ready_note": "戦闘準備完了",
```

`i18n_data_en.py`：
```python
    "midnight_battle_prep_ready_note": "Preparing for battle",
```

- [ ] **Step 7: 語法檢查／建置**

Run: `node --check static_src/midnight.js` → 無輸出。
Run: `python generate.py` → 無錯誤。

- [ ] **Step 8: 手動驗證**

1. 靠近一個尚未挑戰過的強敵籌碼並加入，確認`#midnight-battle-prep-banner`先顯示名稱/種類/體型，讀條5秒跑完顯示「準備進入戰鬥」，這5秒內地圖仍展開、可移動；讀完後自動收合地圖進入戰鬥（`#midnight-strong-enemy-banner`原本的持續顯示邏輯不受影響，準備流程結束後兩者不會同時搶顯示，因為`activeEncounter`成立後`amParticipant`已是true，`renderStrongEnemyOverlay()`會接手顯示）。
2. 對一般板塊敵人遭遇（floor breakthrough後遇到敵人）／夜之強敵／夜王重複上述驗證。
3. 逃離戰鬥後重新靠近同一場戰鬥，確認走的是原本的`pendingBattleReentry`3秒按鈕式讀條，不會再跑一次5秒識別banner。

- [ ] **Step 9: Commit**

```bash
git add static_src/midnight.js site_src/midnight_page.py static_src/style.css site_src/i18n_data_zh.py site_src/i18n_data_ja.py site_src/i18n_data_en.py
git commit -m "$(cat <<'EOF'
feat(midnight): 遭遇戰鬥前新增識別資訊+5秒準備流程,延後地圖收合時機

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Uwg3Xm2sYucPTLtW7MJRRr
EOF
)"
```

---

## Part 4：獎勵清單分類再編＋GM判斷類報酬併入清單（對應設計文件 §4）

### Task 9: 獎勵清單UI改成共有／個人上下兩段

**Files:**
- Modify: `site_src/midnight_page.py`（`#midnight-reward-modal` 約 `midnight_page.py:917-926`）
- Modify: `static_src/midnight.js`（`renderRewardModal()` 約 `midnight.js:8154-8226`）

**Interfaces:**
- Consumes：既有 `pendingRewards`／`collectUnresolvedSharedRewards()`／`claimSharedReward()`／`rewardEntryLabel()`／`selectedRewardId`／`renderRewardDetail()`（簽章全部不變）。
- Produces：`renderRewardModal()` 對外行為不變（仍是無參數，供既有呼叫端沿用），只改內部DOM輸出目標。

- [ ] **Step 1: HTML拆成兩個`<ul>`**

把 `site_src/midnight_page.py` 的：

```html
        <div id="midnight-reward-modal" hidden>
          <div id="midnight-reward-box">
            <h3 data-i18n="midnight_reward_title"></h3>
            <div id="midnight-reward-split">
              <ul id="midnight-reward-list"></ul>
              <div id="midnight-reward-detail"></div>
            </div>
            <button type="button" id="btn-midnight-reward-close" data-i18n="midnight_reward_close_button"></button>
          </div>
        </div>
```

改成：

```html
        <div id="midnight-reward-modal" hidden>
          <div id="midnight-reward-box">
            <h3 data-i18n="midnight_reward_title"></h3>
            <div id="midnight-reward-split">
              <div id="midnight-reward-list-wrap">
                <h4 data-i18n="midnight_reward_shared_section_title"></h4>
                <ul id="midnight-reward-list-shared"></ul>
                <h4 data-i18n="midnight_reward_section_title"></h4>
                <ul id="midnight-reward-list-personal"></ul>
              </div>
              <div id="midnight-reward-detail"></div>
            </div>
            <button type="button" id="btn-midnight-reward-close" data-i18n="midnight_reward_close_button"></button>
          </div>
        </div>
```

- [ ] **Step 2: 修改 `renderRewardModal()`**

把 `static_src/midnight.js` 的：

```js
    modal.hidden = false;
    var listEl = el("midnight-reward-list");
    listEl.innerHTML = "";
    unresolvedIds.forEach(function (id) {
      var entry = list[id];
      var li = document.createElement("li");
      var btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = rewardEntryLabel(entry);
      btn.addEventListener("click", function () {
        selectedRewardId = id;
        renderRewardDetail(id, entry);
      });
      li.appendChild(btn);
      listEl.appendChild(li);
    });
    sharedEntries.forEach(function (shared) {
      var li = document.createElement("li");
      var btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = rewardEntryLabel(shared.entry);
      btn.addEventListener("click", function () {
        claimSharedReward(shared.pointId, shared.rewardId);
      });
      li.appendChild(btn);
      var note = document.createElement("span");
      note.className = "warning-text";
      note.textContent = window.I18N.t("midnight_reward_shared_note");
      li.appendChild(note);
      listEl.appendChild(li);
    });
```

改成：

```js
    modal.hidden = false;
    var personalListEl = el("midnight-reward-list-personal");
    var sharedListEl = el("midnight-reward-list-shared");
    personalListEl.innerHTML = "";
    sharedListEl.innerHTML = "";
    unresolvedIds.forEach(function (id) {
      var entry = list[id];
      var li = document.createElement("li");
      var btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = rewardEntryLabel(entry);
      btn.addEventListener("click", function () {
        selectedRewardId = id;
        renderRewardDetail(id, entry);
      });
      li.appendChild(btn);
      personalListEl.appendChild(li);
    });
    sharedEntries.forEach(function (shared) {
      var li = document.createElement("li");
      var btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = rewardEntryLabel(shared.entry);
      btn.addEventListener("click", function () {
        claimSharedReward(shared.pointId, shared.rewardId);
      });
      li.appendChild(btn);
      var note = document.createElement("span");
      note.className = "warning-text";
      note.textContent = window.I18N.t("midnight_reward_shared_note");
      li.appendChild(note);
      sharedListEl.appendChild(li);
    });
```

- [ ] **Step 3: 新增i18n key**

`i18n_data_zh.py`（在 `midnight_reward_title` 附近新增）：
```python
    "midnight_reward_shared_section_title": "共有",
    "midnight_reward_section_title": "個人",
```

`i18n_data_ja.py`：
```python
    "midnight_reward_shared_section_title": "共有",
    "midnight_reward_section_title": "個人",
```

`i18n_data_en.py`：
```python
    "midnight_reward_shared_section_title": "Shared",
    "midnight_reward_section_title": "Personal",
```

- [ ] **Step 4: 語法檢查／建置**

Run: `node --check static_src/midnight.js` → 無輸出。
Run: `python generate.py` → 無錯誤。

- [ ] **Step 5: 手動驗證**

1. 觸發一筆共享報酬（例如教會鍛造石共享池）與一筆個人抽選報酬同時待處理，開啟獎勵清單，確認上段「共有」／下段「個人」各自列出正確項目。
2. 點擊共有項目仍可直接領取；點擊個人項目仍會在右側顯示抽選/確認detail。

- [ ] **Step 6: Commit**

```bash
git add static_src/midnight.js site_src/midnight_page.py site_src/i18n_data_zh.py site_src/i18n_data_ja.py site_src/i18n_data_en.py
git commit -m "$(cat <<'EOF'
feat(midnight): 獎勵清單改為共有/個人上下兩段顯示

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Uwg3Xm2sYucPTLtW7MJRRr
EOF
)"
```

---

### Task 10: `computeRewardDraw()` 新增 `stoneswordKey`／`smithingStone`／`weaponSkillReroll`／`hpDamage`／`note` 五種kind

**Files:**
- Modify: `static_src/midnight.js`（`computeRewardDraw()` 約 `midnight.js:7902-7967`；`renderRewardDetail()` 約 `midnight.js:8060-8152`）

**Interfaces:**
- Consumes：既有 `grantLootRewardEntryToCharacter()`（`midnight.js:7277-7291`，僅參考邏輯搬用，原函式本身在Task 11會被移除呼叫但函式定義先保留，避免任務間互相卡住）、既有 `selfArenaHpMax()`。
- Produces：`computeRewardDraw(entry)` 對這5種kind回傳 `{label, apply}`（`hpDamage`／`note`額外標記 `needsDrawStep:false`，讓`renderRewardDetail()`不要求先按「抽選」按鈕，直接顯示確認/丟棄，比照`rune`/`chaliceBonus`既有模式）。

- [ ] **Step 1: 確認 `renderRewardDetail()` 判斷 `needsDrawStep` 的既有邏輯**

先讀 `static_src/midnight.js:8060` 附近 `renderRewardDetail()` 開頭，確認目前用什麼條件判斷「這個kind需不需要先按抽選按鈕」（例如 `entry.kind === "weapon" || entry.kind === "talisman" || entry.kind === "consumable" || entry.kind === "potentialPower"`）。把這個條件列表記下來，本步驟只是確認、不修改。

- [ ] **Step 2: `computeRewardDraw()` 新增5種kind**

在 `static_src/midnight.js` 的 `computeRewardDraw()` 函式內，`if (entry.kind === "chaliceBonus") { ... }` 區塊後面（`if (entry.kind === "talisman") {` 之前）新增：

```js
    if (entry.kind === "stoneswordKey" || entry.kind === "smithingStone") {
      var itemId = entry.kind === "stoneswordKey" ? "item_stonesword_key" : "item_smithing_stone";
      var value = entry.value || 1;
      var itemData = window.PriTestConsumables.get(itemId);
      return {
        label: (itemData ? window.PriTestConsumables.localizedText(itemData.name) : itemId) + " x" + value,
        apply: function (c) {
          c.consumables = c.consumables || [];
          var existing = c.consumables.filter(function (inst) { return inst.itemId === itemId; })[0];
          if (existing) {
            existing.usesRemaining = (existing.usesRemaining || 0) + value;
          } else {
            var instId = window.PriTestCharacterDrawer.makeConsumableInstanceId(itemId, c);
            c.consumables.push({ id: instId, itemId: itemId, usesRemaining: value });
          }
        },
      };
    }
    if (entry.kind === "weaponSkillReroll") {
      var rerollValue = entry.value || 1;
      return {
        label: window.I18N.t("midnight_reward_label_weapon_skill_reroll", { value: rerollValue }),
        apply: function (c) {
          c._weaponRerollCredits = (c._weaponRerollCredits || 0) + rerollValue;
        },
      };
    }
    if (entry.kind === "hpDamage") {
      return {
        label: window.I18N.t("midnight_reward_label_hp_damage", { value: entry.value || 0 }),
        apply: function (c) {
          var max = selfArenaHpMax(c);
          GameStorage.rtTransaction(gameId, "cloud", "demoStat/" + myTokenId, function (cur) {
            var current = cur === null ? max : cur;
            return Math.max(0, current - (entry.value || 0));
          });
        },
      };
    }
    if (entry.kind === "note") {
      return {
        label: entry.text || "",
        apply: function () {},
      };
    }
```

- [ ] **Step 3: 讓`renderRewardDetail()`把這5種kind視為「不需要先按抽選」**

依Step 1確認到的條件式，把判斷「needsDrawStep」的地方（原本只認`weapon`/`talisman`/`consumable`，`potentialPower`是另外獨立分支處理）**維持不變**——因為`stoneswordKey`/`smithingStone`/`weaponSkillReroll`/`hpDamage`/`note`本來就不在那個清單裡，預設就會走`computeRewardDraw()`直接產生draft、顯示確認/丟棄按鈕的既有路徑（跟`rune`/`chaliceBonus`完全一樣）。**本步驟不需要修改程式碼**，只需要在Step 5用實際畫面確認這個既有行為符合預期。

- [ ] **Step 4: 新增i18n key**

`i18n_data_zh.py`：
```python
    "midnight_reward_label_hp_damage": "受到{value}點傷害",
```

`i18n_data_ja.py`：
```python
    "midnight_reward_label_hp_damage": "{value}ダメージを受ける",
```

`i18n_data_en.py`：
```python
    "midnight_reward_label_hp_damage": "Take {value} damage",
```

（`midnight_reward_label_weapon_skill_reroll` 已存在，見 `grantLootRewardEntryToCharacter()` 既有i18n key，不需要新增。）

- [ ] **Step 5: 語法檢查／建置／手動驗證**

Run: `node --check static_src/midnight.js` → 無輸出。
Run: `python generate.py` → 無錯誤。

手動：在瀏覽器console呼叫 `pendingRewards` 相關RTDB路徑手動寫入一筆 `{kind:"hpDamage", value:5}` 測試entry（透過已建立角色的正常pendingRewards路徑，不是寫不完整state），開啟獎勵清單確認顯示「受到5點傷害」且有確認/丟棄按鈕，按確認後角色HP確實減少5點。對`note`／`stoneswordKey`／`smithingStone`／`weaponSkillReroll`重複驗證。

- [ ] **Step 6: Commit**

```bash
git add static_src/midnight.js site_src/i18n_data_zh.py site_src/i18n_data_ja.py site_src/i18n_data_en.py
git commit -m "$(cat <<'EOF'
feat(midnight): computeRewardDraw新增stoneswordKey/smithingStone/weaponSkillReroll/hpDamage/note

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Uwg3Xm2sYucPTLtW7MJRRr
EOF
)"
```

---

### Task 11: 板塊戰利品改走`pendingRewards`（移除直接授予路徑）

**Files:**
- Modify: `static_src/midnight.js`（`grantTileLootToParticipants()` 約 `midnight.js:7316-7342`；`claimLateFieldTriggerRewards()` 約 `midnight.js:4632-4654`；`claimSharedReward()` 約 `midnight.js:7411-7426`）

**Interfaces:**
- Consumes：Task 10新增的 `computeRewardDraw()` 五種kind、既有 `pushPendingReward(tokenId, entry)`（`midnight.js:7767`附近，簽章不變）。
- Produces：`grantLootRewardEntryToCharacter()` 保留原樣不刪除（仍供其他既有呼叫端使用，例如 `maybeGrantFieldTileReward()` 內若有其他分支——若逐一確認後發現完全沒有其他呼叫端，才在本任務最後一步移除該函式，避免留下死代碼）。

- [ ] **Step 1: 確認 `grantLootRewardEntryToCharacter()` 現有全部呼叫端**

Run: `grep -n "grantLootRewardEntryToCharacter(" static_src/midnight.js`

記下所有出現行號（預期是函式定義本身＋`grantTileLootToParticipants()`／`claimLateFieldTriggerRewards()`／`claimSharedReward()`共3處呼叫，若有更多需要一併處理）。

- [ ] **Step 2: 修改 `grantTileLootToParticipants()`**

把：

```js
  function grantTileLootToParticipants(trig, lootEntries) {
    Object.keys(trig.participants || {}).forEach(function (slot) {
      var p = players[slot];
      if (!p) return;
      var c = characters[p.tokenId];
      if (!c) return;
      var labels = [];
      var anyFull = false;
      lootEntries.forEach(function (entry) {
        var label = grantLootRewardEntryToCharacter(c, entry);
        if (label) labels.push(label);
        else if (
          entry.kind === "weaponStar" ||
          entry.kind === "talisman" ||
          entry.kind === "consumable" ||
          entry.kind === "stoneswordKey" ||
          entry.kind === "smithingStone"
        )
          anyFull = true;
      });
      var text = labels.length ? window.I18N.t("midnight_reward_toast_prefix") + labels.join("、") : "";
      if (anyFull) text = text + (text ? "　" : "") + window.I18N.t("midnight_inventory_full_note");
      if (!text) return;
      c._lastTileRewardNote = { text: text, at: Date.now() };
      GameStorage.rtSet(gameId, "cloud", "character/" + p.tokenId, c);
    });
  }
```

改成：

```js
  // 2026-09-09改版：不再直接授予+背景toast，改推進pendingRewards佇列，統一由玩家自己
  // 開啟獎勵清單抽選/確認取得（設計文件§4.3）。weaponStar這裡沿用kind名稱"weaponStar"，
  // pushPendingReward()本身不檢查inventory是否已滿——已滿的判斷延後到玩家實際按「確認」
  // 那一刻，由renderRewardDetail()既有的hasInventorySpace()判斷擋下並提示，不在這裡預判。
  function grantTileLootToParticipants(trig, lootEntries) {
    Object.keys(trig.participants || {}).forEach(function (slot) {
      var p = players[slot];
      if (!p) return;
      lootEntries.forEach(function (entry) {
        pushPendingReward(p.tokenId, entry);
      });
    });
  }
```

- [ ] **Step 3: 修改 `claimLateFieldTriggerRewards()`**

把：

```js
      var trig = fieldTriggers[pointId] || {};
      var ledger = trig.perPlayerRewards || {};
      var c = characters[myTokenId];
      if (!c) return;
      var labels = [];
      Object.keys(ledger).forEach(function (seq) {
        (ledger[seq].entries || []).forEach(function (entry) {
          var label = grantLootRewardEntryToCharacter(c, entry);
          if (label) labels.push(label);
        });
      });
      if (labels.length) {
        c._lastTileRewardNote = { text: window.I18N.t("midnight_reward_toast_prefix") + labels.join("、"), at: Date.now() };
      }
      GameStorage.rtSet(gameId, "cloud", "character/" + myTokenId, c);
    });
```

改成：

```js
      var trig = fieldTriggers[pointId] || {};
      var ledger = trig.perPlayerRewards || {};
      Object.keys(ledger).forEach(function (seq) {
        (ledger[seq].entries || []).forEach(function (entry) {
          pushPendingReward(myTokenId, entry);
        });
      });
    });
```

- [ ] **Step 4: 修改 `claimSharedReward()`**

把：

```js
      var trig = fieldTriggers[pointId];
      var entry = trig && trig.sharedRewards && trig.sharedRewards[rewardId];
      var c = characters[myTokenId];
      if (!entry || !c) return;
      var label = grantLootRewardEntryToCharacter(c, entry);
      if (label) {
        c._lastTileRewardNote = { text: window.I18N.t("midnight_reward_toast_prefix") + label, at: Date.now() };
      }
      GameStorage.rtSet(gameId, "cloud", "character/" + myTokenId, c);
    });
```

改成：

```js
      var trig = fieldTriggers[pointId];
      var entry = trig && trig.sharedRewards && trig.sharedRewards[rewardId];
      if (!entry) return;
      pushPendingReward(myTokenId, entry);
    });
```

（`claimSharedReward()`本身是「先搶先贏鎖定`resolvedBy`」的共享池項目，改成推進`pendingRewards`後，玩家仍是在按下「領取」的當下就搶到這筆獎勵的所有權，只是把「決定內容」的抽選步驟延後到獎勵清單裡處理，跟設計文件§4.5「共享池項目維持先搶先贏，只是視覺上移到清單上段」一致——共享池的「先搶先贏」語意在`resolvedBy` transaction那一刻就已經確定，不受這裡的改動影響。）

- [ ] **Step 5: 若確認無其他呼叫端，移除 `grantLootRewardEntryToCharacter()`**

依Step 1的搜尋結果，若三處呼叫都已在Step 2-4改掉、且沒有其他呼叫端，把 `grantLootRewardEntryToCharacter()` 函式整個刪除（`midnight.js:7227-7304`附近）。若搜尋結果顯示還有其他呼叫端（例如埋もれ宝§6.5的`grantTileLootToParticipants({participants:soloParticipants}, ...)`屬於間接呼叫、已隨Step 2一起改掉，不用另外處理），則保留函式並在函式上方註解標明「僅供歷史參考，目前無呼叫端」——但優先選擇整個刪除，避免死代碼（`CLAUDE.md`沒有硬性禁止刪除未使用函式的規則，且函式本身不小，刪除比保留更符合YAGNI）。

- [ ] **Step 6: 語法檢查／建置**

Run: `node --check static_src/midnight.js` → 無輸出。
Run: `python generate.py` → 無錯誤。

- [ ] **Step 7: 手動驗證**

1. 用Playwright正常流程打穿一個含有戰利品（武器/消耗品/護符/盧恩/鍛造石/石劍鑰匙其中至少3種）的板塊樓層，確認角色資料（`characters[tokenId]`）不再瞬間變化，而是`pendingRewards[tokenId]`多出對應筆數。
2. 開啟獎勵清單，確認能逐一看到這些戰利品、抽選/確認後角色資料才真正更新。
3. 觸發一次埋もれ宝（solo）與一次共享池項目（教會鍛造石），確認兩者都改走個人/共享的`pendingRewards`／`sharedRewards`清單，不再有背景toast瞬間跳出戰利品文字。

- [ ] **Step 8: Commit**

```bash
git add static_src/midnight.js
git commit -m "$(cat <<'EOF'
feat(midnight): 板塊戰利品改走pendingRewards佇列,移除背景直接授予+toast路徑

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Uwg3Xm2sYucPTLtW7MJRRr
EOF
)"
```

---

### Task 12: GM判斷類報酬（hpDamage/note）改走`pendingRewards`

**Files:**
- Modify: `static_src/midnight.js`（`resolveJudgmentRewardEntries()` 約 `midnight.js:7497-7540`）

**Interfaces:**
- Consumes：Task 10新增的 `computeRewardDraw()` 對 `hpDamage`／`note` 的處理、既有 `pushPendingReward()`、既有 `participantSlots()`。

- [ ] **Step 1: 修改 `resolveJudgmentRewardEntries()`**

把：

```js
      if (entry.kind === "hpDamage") {
        // note文字常描述「行為判定失敗時」「ランダム2人」等條件，這些條件App無法自動判斷
        // （不是真正的機率/擲骰資料），因此統一比照brief既定設計：隨機挑1名參與者套用固定
        // 傷害值，note純粹留作GM/玩家自行理解情境用，不逐一解析每種條件文字。
        var slots = participantSlots(trig);
        if (slots.length) {
          var pickedSlot = slots[Math.floor(Math.random() * slots.length)];
          var tokenId = players[pickedSlot] && players[pickedSlot].tokenId;
          if (tokenId) {
            GameStorage.rtTransaction(gameId, "cloud", "demoStat/" + tokenId, function (cur) {
              var max = selfArenaHpMax(characters[tokenId]);
              var current = cur === null ? max : cur;
              return Math.max(0, current - (entry.value || 0));
            });
          }
        }
      } else if (entry.kind === "tieredChoice") {
```

改成：

```js
      if (entry.kind === "hpDamage") {
        // note文字常描述「行為判定失敗時」「ランダム2人」等條件，這些條件App無法自動判斷
        // （不是真正的機率/擲骰資料），因此統一比照既定設計：隨機挑1名參與者，但2026-09-09
        // 改為不再直接扣血，改推進該玩家的pendingRewards佇列（設計文件§4.4），由玩家自己
        // 開獎勵清單按「確認」時才真正扣血（見computeRewardDraw()的hpDamage分支）。
        var slots = participantSlots(trig);
        if (slots.length) {
          var pickedSlot = slots[Math.floor(Math.random() * slots.length)];
          var tokenId = players[pickedSlot] && players[pickedSlot].tokenId;
          if (tokenId) {
            pushPendingReward(tokenId, { kind: "hpDamage", value: entry.value || 0 });
          }
        }
      } else if (entry.kind === "tieredChoice") {
```

再把：

```js
      } else if (entry.kind === "note") {
        Object.keys(trig.participants || {}).forEach(function (slot) {
          var p = players[slot];
          var c = p && characters[p.tokenId];
          if (!c) return;
          c._lastTileRewardNote = { text: window.PriTestFields.localizedText(entry.note), at: Date.now() };
          GameStorage.rtSet(gameId, "cloud", "character/" + p.tokenId, c);
        });
      } else {
```

改成：

```js
      } else if (entry.kind === "note") {
        // 2026-09-09改版：不再直接寫_lastTileRewardNote背景toast，改推進每個參加者的
        // pendingRewards佇列（設計文件§4.4），開獎勵清單才看得到文字內容。
        Object.keys(trig.participants || {}).forEach(function (slot) {
          var p = players[slot];
          if (!p) return;
          pushPendingReward(p.tokenId, { kind: "note", text: window.PriTestFields.localizedText(entry.note) });
        });
      } else {
```

- [ ] **Step 2: 語法檢查／建置**

Run: `node --check static_src/midnight.js` → 無輸出。
Run: `python generate.py` → 無錯誤。

- [ ] **Step 3: 手動驗證**

1. 觸發一個既有事件分支中含有`hpDamage`的段落（例如`fields_data_3.js`規則書原文中「嫌な予感・成功1回」帶`hpDamage`＋`note`的情境，透過正常UI判定流程走到），確認判定當下不再立即扣血，而是被選中的那位玩家的`pendingRewards`多出一筆`hpDamage`項目，開啟獎勵清單確認才真正扣血。
2. 確認`note`型entry會讓所有participants各自的`pendingRewards`都多出對應的note項目，開啟才看得到文字，不再有背景瞬間toast。
3. 觸發一個`tieredChoice`/`diceHandChoice`分支下巢狀帶戰利品＋`hpDamage`/`note`混合的段落，確認遞迴解析後兩種類型都正確進到`pendingRewards`（戰利品類entry本身在Task 11已經改走`pushPendingReward`的呼叫端一起生效）。

- [ ] **Step 4: Commit**

```bash
git add static_src/midnight.js
git commit -m "$(cat <<'EOF'
feat(midnight): GM判斷類報酬(hpDamage/note)改走pendingRewards,不再立即套用

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Uwg3Xm2sYucPTLtW7MJRRr
EOF
)"
```

---

## Part 5：HUD區塊搬移（對應設計文件 §5）

### Task 13: 6個區塊從`#midnight-hud-top-left`搬到`#midnight-hud-top-right`

**Files:**
- Modify: `site_src/midnight_page.py`（`#midnight-hud-top-left`／`#midnight-hud-top-right` 約 `midnight_page.py:297-442`）

**Interfaces:**
- Consumes：既有 `renderEnterBattlePrompt()`／`updateResumeCountdownHud()`／`renderFinalCircleCountdown()`／`renderFinalCircleRewardsHud()` 等函式（全部透過`el(id)`存取，不修改任何JS）。

- [ ] **Step 1: 搬移HTML區塊**

在 `site_src/midnight_page.py` 中，把 `#midnight-hud-top-left` 內以下6個區塊（依§5.2清單）：

```html
          <div id="midnight-enter-battle-prompt" hidden>
            <button type="button" id="btn-midnight-enter-battle" data-i18n="midnight_enter_battle_button"></button>
            <div id="midnight-enter-battle-loading-bar" class="midnight-loading-track" hidden>
              <span id="midnight-enter-battle-loading-fill" class="midnight-loading-fill"></span>
            </div>
          </div>
          <div id="midnight-resume-countdown-row" hidden>
            <p id="midnight-resume-countdown-text"></p>
            <div id="midnight-resume-countdown-bar" class="midnight-loading-track">
              <span id="midnight-resume-countdown-fill" class="midnight-loading-fill"></span>
            </div>
          </div>
          <p id="midnight-final-circle-countdown" hidden></p>
          <div id="midnight-hud-day1-rewards-row" hidden>
            <button type="button" id="btn-midnight-hud-blessing-day1" data-i18n="midnight_hud_blessing_button"></button>
            <button type="button" id="btn-midnight-hud-day1-leave" data-i18n="midnight_hud_leave_button"></button>
          </div>
          <button type="button" id="btn-midnight-hud-blessing" data-i18n="midnight_hud_blessing_button" hidden></button>
          <div id="midnight-hud-merchant-row" hidden>
            <button type="button" id="btn-midnight-open-merchant-hud" data-i18n="midnight_hud_merchant_button"></button>
            <button type="button" id="btn-midnight-hud-day2-leave" data-i18n="midnight_hud_leave_button"></button>
          </div>
          <div id="midnight-hud-ready-final-row" hidden>
            <button type="button" id="btn-midnight-ready-final-boss"></button>
            <span id="midnight-ready-final-note"></span>
          </div>
```

整段剪下，從`#midnight-hud-top-left`（原本緊接在`<div id="midnight-hud-top-left">`開頭標籤之後）移除。

- [ ] **Step 2: 貼到`#midnight-hud-top-right`**

把Step 1剪下的整段，貼到 `#midnight-hud-top-right` 內、`<span class="midnight-rune-value">...</span>` 區塊**之前**（即成為`#midnight-hud-top-right`的第一批子元素，符合「盧恩上方顯示這些提示、盧恩本身維持在其下」的既有flex column文件流排列——若使用者實際看到後偏好盧恩仍在最上面，之後可再調整順序，本任務先維持「新搬入內容在前、原有右上角內容在後」的最小改動順序）。

- [ ] **Step 3: 建置**

Run: `python generate.py` → 無錯誤。

- [ ] **Step 4: 手動驗證**

1. 逐一觸發6種情境：
   - 逃離戰鬥後重新靠近同一場戰鬥（`#midnight-enter-battle-prompt`）
   - 暫停遊戲後按繼續（`#midnight-resume-countdown-row`）
   - Day1/Day2縮圈到底進入夜之強敵倒數（`#midnight-final-circle-countdown`）
   - Day1夜之強敵戰後（`#midnight-hud-day1-rewards-row`）
   - Day2夜之強敵戰後（`#btn-midnight-hud-blessing`／`#midnight-hud-merchant-row`）
   - 全員準備進入最終王戰（`#midnight-hud-ready-final-row`）
2. 確認以上6種畫面元件都改顯示在畫面右上角，樣式沒有明顯跑版（文字被裁切、按鈕重疊等），且原本點擊/倒數行為正常運作。
3. 確認左上角HUD只剩：自己HP/FP/體力數值條、聖杯瓶剩餘數、隊友血量卡片、附近掉落物提示。

- [ ] **Step 5: Commit**

```bash
git add site_src/midnight_page.py
git commit -m "$(cat <<'EOF'
feat(midnight): 6個HUD提示區塊(進入戰鬥/暫停讀條/強敵倒數/戰後選項/準備王戰)由左上搬到右上

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Uwg3Xm2sYucPTLtW7MJRRr
EOF
)"
```

---

## Final：整體驗收

**Files:** 無新增，純驗證。

- [ ] **Step 1: 完整建置**

Run: `node --check static_src/midnight.js` → 無輸出。
Run: `python generate.py` → 無錯誤。

- [ ] **Step 2: 端到端手動驗證（依設計文件各章節「驗證方式」逐條重新走一次）**

依序重新執行 Task 1、4、6、8、9、11、12、13 各自的「手動驗證」步驟，確認彼此沒有互相干擾（例如：測試模式ON時進入戰鬥的識別banner讀條是否正常顯示、獎勵清單分段UI在HUD折疊狀態下開啟是否正常、6個搬移後的HUD區塊與折疊按鈕/展開按鈕位置是否互相重疊）。

- [ ] **Step 3: 更新設計文件狀態（非必要but建議）**

若過程中發現與 `docs/superpowers/specs/2026-09-09-midnight-hud-testmode-rewards-design.md` 描述有出入之處（例如某個ID命名在實作時因既有衝突而調整），在該設計文件對應章節補充一行「實作備註」，保持文件與程式碼一致。

- [ ] **Step 4: 最終Commit（若Step 3有變更）**

```bash
git add docs/superpowers/specs/2026-09-09-midnight-hud-testmode-rewards-design.md
git commit -m "$(cat <<'EOF'
docs(midnight): 補充設計文件實作備註

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Uwg3Xm2sYucPTLtW7MJRRr
EOF
)"
```
