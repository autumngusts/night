# 煉金術士（atelier）第 1 階段 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 做出可以實際玩的煉金術士核心：用相機、圖片或色彩散步取色，一次取多色，素材形狀由照片決定，並配對傳統色名；在瑠璃的工房用蘇菲範圍的色彩棋盤調和（形狀、旋轉、覆蓋、同色格、加成格、最後一推、品質依釜、特性成本上限），加上預覽、Undo、大釜冷卻、瑠璃的反應與 5 個任務、教學、色覺友善圖形。

**Architecture:** 規則全部放在純函式的 `atelier_core.js`，調和方式放在 `atelier_method_board.js`，透過 `Core.registerMethod()` 登記，將來新增工房只要加一個 method 檔。兩者都不碰 DOM、不讀寫 localStorage，之後照著移植成 Go。數值和配方放在 `atelier_data.js`，傳統色放在 `atelier_colors.js`，工房主人的能力、台詞、任務放在 `atelier_hosts.js`。相機只在 `atelier_camera.js`，畫面和存檔只在 `atelier.js`。

**Tech Stack:** Vanilla ES5 IIFE、Python 產生靜態 HTML（`generate.py`）、Node `assert` 的規則檢查、Playwright 的畫面檢查。

## Global Constraints

- 規則依據：`docs/atelier_design.md`（§2、§3、§4.2、§5、§7 是第 1 階段的範圍）。數值都是「暫定」，集中在 `atelier_data.js`，不要散落在程式裡。
- 前綴：JS `window.PriTestAtelier*`、i18n 鍵 `at_`、CSS class／id `at-`。遊戲樣式只放 `static_src/css/atelier.css`，**不要加進 `style.css`**。
- 名稱、角色、配方、畫面全部原創，不使用任何既有作品的名稱或素材。
- **不保存影像**：照片只在記憶體中縮成 32×32，分析完就丟掉；存檔只有顏色數值。
- 所有亂數都用 seed（O11）：`Core.makeRng(seed)`。只有畫面上台詞的挑選可以用 `Math.random`。
- 存檔鍵 `pritest-atelier-save-v1`；讀寫一律 try/catch，壞檔就重建。時間特性一律用 JST（UTC+9）。
- 首頁 test 分頁只顯示、不能點（`"link": False`），要自己輸入 `/atelier` 進入（比照 kyuka、shedan）。
- 載入順序：`atelier_data.js` → `atelier_colors.js` → `atelier_hosts.js` → `atelier_core.js` → `atelier_method_board.js` → `atelier_camera.js` → `atelier.js`。
- Playwright 一律用 `dispatchEvent` 觸發（CLAUDE.md §4.6），畫面每次操作都會整個重繪。
- 版本：`site_src/version.py` 遞增 minor（目前 `2.74.0` → `2.75.0`；如果約跑的 `2.75.0` 已經先推送，就用 `2.76.0`）。只推 `private`（`git push private main`），不要碰 `origin`。
- 回覆、註解、文件、commit message 用繁體中文。

## 檔案結構

| 檔案 | 責任 |
|---|---|
| `static_src/atelier_data.js` | 數值表：屬性、色相區間、類別、採色、棋盤加成、冷卻、特性、錬金釜、配方 |
| `static_src/atelier_colors.js` | 日本傳統色 42 色（id、hex、日／中文名、稀有度） |
| `static_src/atelier_hosts.js` | 工房主人：瑠璃的能力、台詞、5 個任務、教學 |
| `static_src/atelier_core.js` | 規則：色彩數學、k-means、形狀、素材、採集籃、存檔、等級、調和流程、特性、任務、反應 |
| `static_src/atelier_method_board.js` | 調和方式①色彩棋盤：create／canPlace／place／undo／evaluate／preview／done |
| `static_src/atelier_camera.js` | 相機、圖片、色彩散步 → 32×32 RGBA |
| `static_src/atelier.js` | 畫面、存檔、操作 |
| `static_src/css/atelier.css` | 樣式 |
| `site_src/atelier_page.py` | 頁面 |
| `site_src/i18n_atelier.py` | UI 字串 |
| `tools/atelier_check/core_check.js` | 規則檢查（Node） |
| `tools/atelier_check/ui_check.js` | 畫面檢查（Playwright） |

## 介面

```js
// atelier_core.js → window.PriTestAtelierCore（Node：module.exports）
Core.makeRng(seed) → () => 0..1               // seed：數字或字串
Core.hash(str) → uint32；Core.clamp(v, a, b)；Core.jstHour(ms) → 0..23
Core.hexToRgb("#RRGGBB") → [r,g,b]；Core.rgbToHex([r,g,b]) → "#RRGGBB"
Core.rgbToHsv([r,g,b]) → {h:0..360, s:0..1, v:0..1}；Core.rgbToLab([r,g,b]) → [L,a,b]；Core.deltaE(lab1, lab2)
Core.nearestColor([r,g,b]) → {color, dist}    // color＝PriTestAtelierColors 的一筆
Core.elementOf(hsv) → "fire"|"ice"|"bolt"|"wind"|"spirit"
Core.categoryOf(hsv, el) → "liquid"|"plant"|"mineral"|"essence"|"crystal"|"shadow"
Core.kmeans(pixels, k, seed) → {centers, labels}
Core.shapeFromGrid(grid, label, n) → [[x,y]]；Core.normalizeShape(cells)；Core.rotateShape(cells, times)
Core.analyze(rgba, w, h, seed) → [swatch]     // swatch＝{rgb, hex, frac, shape}，面積大到小
Core.timeTraits(nowMs) → [traitId]；Core.makeMaterial(swatch, nowMs, uid) → material
Core.newSave(nowMs) → save；Core.refillBasket(save, nowMs) → n；Core.capture(save, swatches, nowMs) → [material]|null
Core.level(save) → 1..20；Core.traitCap(save) → 成本上限；Core.canSynth(save, nowMs) → bool
Core.recipe(id) → recipe|null；Core.recipesFor(save) → [recipe]；Core.slotOk(need, material) → bool
Core.registerMethod(id, impl)；Core.method(id) → impl；Core.host(save) → host
Core.startSynthesis(save, recipeId, matUids, cauldronId, nowMs) → session|{error: "recipe"|"cooldown"|"count"|"slot"}
Core.effectLevels(recipe, gauges) → [{el, level, step, next}]
Core.traitChoices(session) → [traitId]；Core.traitsValid(save, session, traitIds) → bool
Core.finishSynthesis(save, session, traitIds, nowMs) → item|{error: "unplaced"|"traits"}
Core.currentTask(save) → task|null；Core.taskMet(task, item) → bool；Core.deliver(save, itemUid) → bool
Core.react(save, beforeEval, afterEval, placeInfo) → "levelup"|"bonus"|"match"|"overwrite"|"miss"|"hint"|"ok"

// atelier_method_board.js（Node：module.exports；瀏覽器：Core.registerMethod("board", impl)）
Board.create(recipe, mats, cauldron, ability) → session
Board.footprint(session, mi, x, y, rot) → [[x,y]]；Board.canPlace(session, mi, x, y, rot) → bool
Board.place(session, mi, x, y, rot) → {ok, recipe, cells, matchCells, bonusCells, overwritten}
Board.undo(session) → bool；Board.done(session) → bool
Board.evaluate(session, final) → {gauges, visible, covered, dominant, push, quality}
Board.preview(session, mi, x, y, rot) → {before, after, info, cells}|null

// material
{ uid, hex, rgb, colorId, element, category, power: 1..4, quality: 1..100, traits: [traitId], shape: [[x,y]], at }
// session（棋盤）
{ method: "board", recipe, mats, cauldron, ability, size, cells: [{color, bonus}], owner: [matIndex|-1], placed: [bool], history }
// item
{ uid, recipe, quality, effects: [{el, level, kind, n}], traits, gauges, at }
// save
{ v: 1, nextUid, mats, items, basket: {n, at}, cooldownUntil, exp, host: "ruri", hosts: {ruri: {aff, task}}, best: {recipeId: quality}, tutorial: 0..3, seen: {colorId: true}, log: [], offsetMs? }

// atelier_camera.js → window.PriTestAtelierCamera
Camera.supported() → bool；Camera.open(video) → Promise；Camera.close(video)；Camera.isOpen() → bool
Camera.grab(video) → RGBA；Camera.fromFile(file) → Promise<RGBA>；Camera.walkScene(seed) → {rgba, url}

// atelier.js → window.PriTestAtelier（給 Playwright 讀）
{ _debugState() → save, _debugUi() → ui }
```

---

### Task 1: 頁面骨架與登記

**Files:**
- Create: `site_src/atelier_page.py`, `site_src/i18n_atelier.py`, `static_src/css/atelier.css`, `static_src/atelier_data.js`, `static_src/atelier_colors.js`, `static_src/atelier_hosts.js`, `static_src/atelier_core.js`, `static_src/atelier_method_board.js`, `static_src/atelier_camera.js`, `static_src/atelier.js`（JS 先都是空的 IIFE）
- Modify: `generate.py`（import、`GAME_I18N_PREFIXES`、copy list、建立 `dist/atelier/index.html`、line 396 的清單）、`site_src/i18n_data.py`（import 並合併 zh／ja／en）、`site_src/projects.py`（PROJECTS 與 test 分頁）、`tools/split_css.py`（`GAMES` 加 `"atelier": ("at-",)`）

**Interfaces:**
- Produces: `ATELIER_SCRIPTS = ("atelier_data.js", "atelier_colors.js", "atelier_hosts.js", "atelier_core.js", "atelier_method_board.js", "atelier_camera.js", "atelier.js")`

- [ ] **Step 1: 寫頁面**（`site_src/atelier_page.py`）

```python
"""煉金術士（atelier）的頁面。規則依據 docs/atelier_design.md。

用相機採集真實世界的顏色，回到工房在色彩棋盤上調和道具（第 1 階段：瑠璃的工房）。
static/atelier_data.js（數值）→ atelier_colors.js（傳統色）→ atelier_hosts.js（工房主人）
→ atelier_core.js（規則）→ atelier_method_board.js（色彩棋盤）→ atelier_camera.js（取色）→ atelier.js（畫面、存檔）。
2026-11-19 依使用者需求新增；首頁 test 分頁只顯示、不能點，要自己輸入 /atelier 進入。
"""

from __future__ import annotations

from site_src.layout import page_shell

ATELIER_SCRIPTS: tuple[str, ...] = (
    "atelier_data.js",
    "atelier_colors.js",
    "atelier_hosts.js",
    "atelier_core.js",
    "atelier_method_board.js",
    "atelier_camera.js",
    "atelier.js",
)


def build_atelier_html() -> str:
    body = """    <div id="at-app" class="at-wrap">
      <noscript>這個頁面需要 JavaScript。</noscript>
    </div>
"""
    return page_shell(
        title="煉金術士",
        body=body,
        static_prefix="../static/",
        home_href="../index.html",
        extra_scripts=ATELIER_SCRIPTS,
        extra_styles=("css/atelier.css",),
        extra_i18n=("i18n/atelier.js",),
    )
```

- [ ] **Step 2: 字串檔**（`site_src/i18n_atelier.py`，全文）

```python
"""煉金術士（atelier）的 UI 字串（zh / ja / en）。由 i18n_data.py 合併；generate.py 依 at_ 前綴輸出成 static/i18n/atelier.js。
配方、特性、傳統色、工房主人台詞放在 static_src/atelier_*.js（{zh, ja, en}）。"""

from __future__ import annotations

_ROWS: tuple[tuple[str, str, str, str], ...] = (
    ("at_title", "煉金術士", "アトリエ", "Atelier"),
    ("at_tab_gather", "採色", "色あつめ", "Gather"),
    ("at_tab_box", "素材箱", "素材箱", "Materials"),
    ("at_tab_lab", "調和", "調合", "Synthesis"),
    ("at_tab_tasks", "委託", "依頼", "Requests"),
    ("at_level", "煉金 Lv{n}", "錬金 Lv{n}", "Alchemy Lv{n}"),
    ("at_aff", "好感度 {n}", "好感度 {n}", "Affinity {n}"),
    ("at_basket", "採集籃 {n}/{max}", "採集かご {n}/{max}", "Basket {n}/{max}"),
    ("at_basket_next", "{m} 分後回復 1", "あと {m} 分で 1 回復", "+1 in {m} min"),
    ("at_cam_open", "打開相機", "カメラを開く", "Open camera"),
    ("at_cam_close", "關閉相機", "カメラを閉じる", "Close camera"),
    ("at_cam_shot", "取色", "色を取る", "Capture"),
    ("at_cam_denied", "無法使用相機。可以改用圖片或色彩散步。", "カメラが使えません。画像か色さんぽを使ってね。", "Camera unavailable. Try an image or a color walk."),
    ("at_upload", "從圖片取色", "画像から取る", "From image"),
    ("at_walk", "色彩散步", "色さんぽ", "Color walk"),
    ("at_pick_hint", "選 1～{n} 個顏色採集（消耗 1 個採集籃）", "1～{n} 色えらんで採集（かごを 1 つ使う）", "Pick 1–{n} colors (uses 1 basket)"),
    ("at_collect", "採集", "採集する", "Collect"),
    ("at_collect_ok", "採集了 {n} 個素材", "素材を {n} 個手に入れた", "Collected {n} materials"),
    ("at_collect_fail_basket", "採集籃用完了，等它回復吧", "かごが空っぽ。回復を待ってね", "Basket is empty"),
    ("at_collect_fail_full", "素材箱滿了", "素材箱がいっぱい", "Material box is full"),
    ("at_box_empty", "還沒有素材，先去採色吧。", "まだ素材がないよ。色を集めに行こう。", "No materials yet."),
    ("at_items", "成品", "完成品", "Items"),
    ("at_items_empty", "還沒有成品。", "まだ完成品はない。", "No items yet."),
    ("at_el_fire", "火", "火", "Fire"),
    ("at_el_ice", "冰", "氷", "Ice"),
    ("at_el_bolt", "雷", "雷", "Bolt"),
    ("at_el_wind", "風", "風", "Wind"),
    ("at_el_spirit", "靈", "霊", "Spirit"),
    ("at_cat_liquid", "液體", "液体", "Liquid"),
    ("at_cat_plant", "植物", "植物", "Plant"),
    ("at_cat_mineral", "礦石", "鉱石", "Mineral"),
    ("at_cat_essence", "精華", "エッセンス", "Essence"),
    ("at_cat_crystal", "結晶", "結晶", "Crystal"),
    ("at_cat_shadow", "影", "影", "Shadow"),
    ("at_quality", "品質 {n}", "品質 {n}", "Quality {n}"),
    ("at_power", "屬性值 {n}", "属性値 {n}", "Power {n}"),
    ("at_cells", "{n} 格", "{n} マス", "{n} cells"),
    ("at_recipes", "配方", "レシピ", "Recipes"),
    ("at_recipe_locked", "Lv{n} 解鎖", "Lv{n} で解放", "Unlocks at Lv{n}"),
    ("at_slot", "第 {n} 格：{need}", "{n} 枠目：{need}", "Slot {n}: {need}"),
    ("at_any", "任意", "なんでも", "Any"),
    ("at_choose", "選擇素材", "素材をえらぶ", "Choose"),
    ("at_start", "開始調和", "調合開始", "Start"),
    ("at_back", "返回", "もどる", "Back"),
    ("at_cooldown", "大釜冷卻中：還有 {m} 分", "大釜を冷ましています：あと {m} 分", "Cauldron cooling: {m} min"),
    ("at_rotate", "旋轉", "回転", "Rotate"),
    ("at_undo", "復原", "元に戻す", "Undo"),
    ("at_tap_hint", "點格子預覽，再點一次放下", "マスをタップで予告、もう一度で投入", "Tap to preview, tap again to place"),
    ("at_gauge_next", "下一段 {n}", "次は {n}", "Next {n}"),
    ("at_gauge_max", "已達最高", "最大", "Max"),
    ("at_final_push", "最後一推：{el} +{n}", "最後のひと押し：{el} +{n}", "Final push: {el} +{n}"),
    ("at_traits", "選擇特性（成本 {used}/{cap}，最多 {max} 個）", "特性をえらぶ（コスト {used}/{cap}、最大 {max} 個）", "Traits (cost {used}/{cap}, up to {max})"),
    ("at_finish", "完成", "完成", "Finish"),
    ("at_result", "調和完成！", "調合成功！", "Synthesis complete!"),
    ("at_best", "最佳品質 {n}", "最高品質 {n}", "Best quality {n}"),
    ("at_fx_heal", "HP 回復 {n}", "HP 回復 {n}", "Heal {n}"),
    ("at_fx_cleanse", "解除異常 {n} 種", "状態異常を {n} 種回復", "Cleanse {n}"),
    ("at_fx_value", "價值 +{n}", "価値 +{n}", "Value +{n}"),
    ("at_fx_dye", "染色 Lv{n}", "染色 Lv{n}", "Dye Lv{n}"),
    ("at_fx_speed", "速度 +{n}", "速さ +{n}", "Speed +{n}"),
    ("at_fx_dmg", "傷害 {n}", "ダメージ {n}", "Damage {n}"),
    ("at_fx_stun", "麻痺 {n} 回合", "マヒ {n} ターン", "Stun {n} turns"),
    ("at_fx_light", "照明 Lv{n}", "照明 Lv{n}", "Light Lv{n}"),
    ("at_fx_guard", "減傷 {n}%", "被ダメージ -{n}%", "Guard {n}%"),
    ("at_fx_none", "沒有效果", "効果なし", "No effect"),
    ("at_task_now", "目前的委託", "いまの依頼", "Current request"),
    ("at_task_need", "{recipe}・品質 {q} 以上", "{recipe}・品質 {q} 以上", "{recipe}, quality {q}+"),
    ("at_task_lv", "・效果 Lv{n} 以上", "・効果 Lv{n} 以上", ", effect Lv{n}+"),
    ("at_task_done", "委託全部完成了，謝謝你。", "依頼はぜんぶ完了。ありがとう。", "All requests complete. Thank you!"),
    ("at_deliver", "交貨", "納品", "Deliver"),
    ("at_err_slot", "素材不符合格子的要求", "素材が枠の条件に合わない", "Material doesn't fit the slot"),
    ("at_err_cooldown", "大釜還在冷卻", "大釜はまだ冷めていない", "The cauldron is cooling"),
    ("at_err_recipe", "這個配方還不能用", "このレシピはまだ使えない", "Recipe locked"),
    ("at_err_count", "素材數量不對", "素材の数が合わない", "Wrong number of materials"),
    ("at_err_unplaced", "還有素材沒放進去", "まだ入れていない素材がある", "Place all materials first"),
    ("at_err_traits", "特性超過成本上限", "特性がコスト上限を超えている", "Traits exceed the cost limit"),
    ("at_err_image", "讀不到這張圖片", "画像を読み込めない", "Couldn't read the image"),
    ("at_dev", "開發用", "開発用", "Dev"),
    ("at_dev_time", "時間 +20 分", "時間 +20 分", "Time +20 min"),
    ("at_dev_cool", "跳過冷卻", "冷却スキップ", "Skip cooldown"),
    ("at_reset", "清除存檔", "セーブを消去", "Reset save"),
    ("at_reset_confirm", "確定清除？再按一次", "本当に消す？もう一度押す", "Really reset? Tap again"),
)

ATELIER_ZH: dict[str, str] = {k: zh for k, zh, _ja, _en in _ROWS}
ATELIER_JA: dict[str, str] = {k: ja for k, _zh, ja, _en in _ROWS}
ATELIER_EN: dict[str, str] = {k: en for k, _zh, _ja, en in _ROWS}

ATELIER_PROJECT: dict[str, dict[str, str]] = {
    "zh": {"project_atelier_name": "煉金術士", "project_atelier_desc": "用相機採集真實世界的顏色，回到工房在色彩棋盤上調和道具"},
    "ja": {"project_atelier_name": "アトリエ", "project_atelier_desc": "カメラで現実の色を集めて、アトリエの色彩盤でアイテムを調合"},
    "en": {"project_atelier_name": "Atelier", "project_atelier_desc": "Capture real-world colors with your camera and synthesize items on a color board"},
}
```

- [ ] **Step 3: 樣式**（`static_src/css/atelier.css`，全文）

```css
/* 煉金術士（atelier）。只放這個遊戲的樣式，前綴 at-。手機直式優先。 */
.at-wrap {
  --at-ink: #2b2433; --at-paper: #fbf6ec; --at-line: #d9cdb8; --at-accent: #1e50a2; --at-soft: #efe5d2;
  max-width: 46rem; margin: 0 auto; padding: 0.75rem 1rem 2rem; color: var(--at-ink); background: var(--at-paper);
  border-radius: 12px; box-sizing: border-box;
}
.at-wrap * { box-sizing: border-box; }
.at-wrap button { font: inherit; padding: 0.45rem 0.8rem; border: 1px solid var(--at-line); border-radius: 8px; background: #fff; color: var(--at-ink); cursor: pointer; }
.at-wrap button:disabled { opacity: 0.45; cursor: default; }
.at-wrap .at-main { background: var(--at-accent); color: #fff; border-color: var(--at-accent); }
.at-head { display: grid; grid-template-columns: 3rem 1fr; gap: 0.5rem; align-items: center; }
.at-avatar { width: 3rem; height: 3rem; border-radius: 50%; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 1.4rem; font-weight: bold; }
.at-bubble { grid-column: 1 / -1; margin: 0.25rem 0 0; padding: 0.6rem 0.8rem; background: #fff; border: 1px solid var(--at-line); border-radius: 10px; }
.at-tutorial { border-color: var(--at-accent); border-width: 2px; }
.at-tabs { display: flex; gap: 0.25rem; margin: 0.75rem 0; }
.at-tabs button { flex: 1; }
.at-tabs .at-on { background: var(--at-soft); border-color: var(--at-accent); font-weight: bold; }
.at-row { display: flex; flex-wrap: wrap; gap: 0.5rem; margin: 0.5rem 0; }
.at-msg { padding: 0.4rem 0.6rem; background: var(--at-soft); border-radius: 8px; }
.at-hint { font-size: 0.9rem; opacity: 0.8; }
.at-hidden { display: none; }
.at-video-slot { position: relative; width: 100%; max-width: 22rem; aspect-ratio: 1; overflow: hidden; border-radius: 10px; background: #000; }
.at-video { width: 100%; height: 100%; object-fit: cover; }
.at-reticle { position: absolute; inset: 0; border: 2px dashed rgba(255, 255, 255, 0.7); border-radius: 10px; pointer-events: none; z-index: 1; }
.at-file { display: inline-flex; align-items: center; padding: 0.45rem 0.8rem; border: 1px solid var(--at-line); border-radius: 8px; background: #fff; cursor: pointer; }
.at-file input { display: none; }
.at-scene { width: 8rem; height: 8rem; image-rendering: pixelated; border-radius: 8px; }
.at-swatches, .at-list { list-style: none; padding: 0; margin: 0.5rem 0; display: grid; gap: 0.4rem; }
.at-swatch { width: 100%; text-align: left; display: flex; flex-wrap: wrap; align-items: center; gap: 0.3rem; }
.at-swatch.at-on { outline: 3px solid var(--at-accent); }
.at-chip { width: 1.6rem; height: 1.6rem; border-radius: 50%; border: 1px solid var(--at-line); }
.at-mat-name { font-weight: bold; margin-right: 0.25rem; }
.at-tag { display: inline-block; padding: 0.1rem 0.4rem; border: 1px solid var(--at-line); border-radius: 999px; font-size: 0.8rem; background: #fff; }
.at-trait { background: #fff5d6; }
.at-list li { display: flex; flex-wrap: wrap; align-items: center; gap: 0.3rem; padding: 0.4rem; background: #fff; border: 1px solid var(--at-line); border-radius: 8px; }
.at-shape { display: inline-grid; gap: 1px; vertical-align: middle; }
.at-shape i { width: 0.9rem; height: 0.9rem; font-style: normal; font-size: 0.55rem; line-height: 0.9rem; text-align: center; color: rgba(255, 255, 255, 0.9); border-radius: 2px; }
.at-shape i.at-off { background: transparent; }
.at-slot { display: block; margin: 0.4rem 0; }
.at-slot select { width: 100%; padding: 0.4rem; }
.at-board { display: grid; gap: 3px; width: 100%; max-width: 22rem; margin: 0.5rem auto; }
.at-wrap .at-cell { aspect-ratio: 1; padding: 0; font-size: 1rem; color: var(--at-c); background: #fff; border: 2px solid var(--at-c); border-radius: 6px; }
.at-wrap .at-cell.at-bonus { box-shadow: inset 0 0 0 3px #f2c94c; }
.at-wrap .at-cell.at-filled { background: var(--at-c); color: rgba(255, 255, 255, 0.9); }
.at-wrap .at-cell.at-ghost { outline: 3px dashed var(--at-accent); outline-offset: -3px; }
.at-gauges { list-style: none; padding: 0; margin: 0.5rem 0; }
.at-gauges meter { width: 8rem; vertical-align: middle; }
.at-push { font-weight: bold; color: var(--at-accent); }
.at-tray { display: flex; flex-wrap: wrap; gap: 0.4rem; }
.at-tray .at-on { outline: 3px solid var(--at-accent); }
.at-result { padding: 0.8rem; background: #fff; border: 2px solid var(--at-accent); border-radius: 10px; }
.at-cooldown { padding: 0.8rem; background: var(--at-soft); border-radius: 10px; }
.at-dev { margin-top: 1.5rem; font-size: 0.85rem; opacity: 0.8; }
.at-dev button { margin: 0.25rem; }
```

- [ ] **Step 4: JS 骨架**：7 個 JS 檔先寫成空的 IIFE，讓 Node 的檢查可以先 `require`。`atelier_data.js` 匯出 `{}`、`atelier_colors.js` 匯出 `[]`、`atelier_hosts.js` 匯出 `{}`、`atelier_core.js` 匯出 `{}`、`atelier_method_board.js` 匯出 `{}`（瀏覽器端什麼都不做）。`atelier.js` 暫時只顯示標題：

```js
// 煉金術士（atelier）：畫面（Task 6 換成正式版）
(function () {
  "use strict";
  var app = document.getElementById("at-app");
  if (app) app.textContent = window.I18N ? window.I18N.t("at_title") : "Atelier";
})();
```

  其他 6 個檔案都用同一個寫法（把 `NAME` 換成 `Data`／`Colors`／`Hosts`／`Core`／`Camera`，`EMPTY` 換成 `{}` 或 `[]`）：

```js
(function () {
  "use strict";
  var api = EMPTY;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else window.PriTestAtelierNAME = api;
})();
```

  `atelier_method_board.js` 的 else 分支先留空（Task 3 才登記）。

- [ ] **Step 5: 登記**
  - `generate.py`：
    - 加 `from site_src.atelier_page import ATELIER_SCRIPTS, build_atelier_html`。
    - `GAME_I18N_PREFIXES` 加 `"atelier": ("at_",),`。
    - copy list 在 `*SHEDAN_SCRIPTS,` 後加 `*ATELIER_SCRIPTS,`。
    - 在 shedan 的建置後面加：

```python
    atelier_dir = DIST_DIR / "atelier"
    atelier_dir.mkdir(parents=True, exist_ok=True)
    (atelier_dir / "index.html").write_text(build_atelier_html(), encoding="utf-8")
```

    - line 396 的清單在 `"shedan"` 後加 `"atelier"`。
  - `site_src/i18n_data.py`：加 `from site_src.i18n_atelier import ATELIER_EN, ATELIER_JA, ATELIER_PROJECT, ATELIER_ZH`，三個語言的字典尾端各加 `**ATELIER_xx, **ATELIER_PROJECT["xx"]`。
  - `site_src/projects.py`：在 shedan 後面加卡片，並把 `"atelier"` 加到 test 分頁的 projects 尾端。

```python
    {
        "id": "atelier",
        "href": "atelier/index.html",
        "name_key": "project_atelier_name",
        "desc_key": "project_atelier_desc",
        # 使用者指定 2026-11-19：先在 PriTest 試作，test 分頁只顯示、不能點，要自己輸入 /atelier 進入
        "link": False,
    },
```

  - `tools/split_css.py`：`GAMES` 加 `"atelier": ("at-",),`。

- [ ] **Step 6: 建置並確認**

Run: `py -3 generate.py; py -3 tools/split_css.py --check`
Expected: 沒有錯誤；`dist/atelier/index.html` 和 `dist/static/i18n/atelier.js` 都存在；split_css 檢查通過。

- [ ] **Step 7: Commit**

```bash
git add site_src/atelier_page.py site_src/i18n_atelier.py static_src/css/atelier.css static_src/atelier*.js generate.py site_src/i18n_data.py site_src/projects.py tools/split_css.py
git commit -m "feat(atelier): 煉金術士頁面骨架與登記"
```

---

### Task 2: 數值表、傳統色、色彩數學、照片分析、素材與採集籃

**Files:**
- Modify: `static_src/atelier_data.js`, `static_src/atelier_colors.js`, `static_src/atelier_core.js`（換成全文）
- Create: `tools/atelier_check/core_check.js`

**Interfaces:**
- Produces: 「介面」一節列出的全部 `Core.*`。調和流程的部分（`startSynthesis` 以後）在 Task 3、Task 4 才測試。

- [ ] **Step 1: 數值表**（`static_src/atelier_data.js`，全文）

```js
// 煉金術士（atelier）：數值表與規則資料。規則依據 docs/atelier_design.md；標示「暫定」的數值都集中在這裡。
(function () {
  "use strict";
  var data = {
    // §3 屬性（5 種）。icon 是色覺友善用的圖形（B15），棋盤格與素材都會同時顯示顏色與圖形
    ELEMENTS: [
      { id: "fire", color: "#e0523a", icon: "▲" },
      { id: "ice", color: "#3a7be0", icon: "◆" },
      { id: "bolt", color: "#e0b83a", icon: "✦" },
      { id: "wind", color: "#3ab36a", icon: "●" },
      { id: "spirit", color: "#9a5ae0", icon: "✚" }
    ],
    // 色相（0～360）→ 屬性；from > to 表示跨過 0 度
    HUE_SECTORS: [
      { from: 330, to: 40, el: "fire" },
      { from: 40, to: 75, el: "bolt" },
      { from: 75, to: 165, el: "wind" },
      { from: 165, to: 260, el: "ice" },
      { from: 260, to: 330, el: "spirit" }
    ],
    ACHROMATIC_SAT: 0.15,            // 飽和度低於此值 → 靈（無彩色）
    CATEGORY_BY_ELEMENT: { fire: "mineral", bolt: "mineral", ice: "liquid", wind: "plant", spirit: "essence" },
    SHADOW_VAL: 0.25,                // 明度低於此值 → 影
    CRYSTAL_VAL: 0.85, CRYSTAL_SAT: 0.3,   // 明度高、飽和度低 → 結晶
    CATEGORIES: ["liquid", "plant", "mineral", "essence", "crystal", "shadow"],

    // §2 採色（O1、C1、O5、O6）
    SRC_SIZE: 32,                    // 照片縮成 32×32 再分析
    GRID: 8,                         // 形狀判定用的 8×8 格
    K: 5,                            // k-means 取 5 個主色
    KMEANS_ITER: 8,
    MIN_FRAC: 0.03,                  // 面積少於 3% 的色塊捨棄
    PICK_MAX: 3,                     // 一次採色最多選 3 色
    SHAPE_MIN: 1, SHAPE_MAX: 6,      // 素材形狀 1～6 格（暫定）
    SHAPE_SCALE: 10,                 // 格數＝round(1 + 面積比 × 10)（暫定）
    PURITY_RANGE: 40,                // 與最近傳統色的 ΔE 超過 40 視為純度 0（暫定）
    BASKET_MAX: 6,                   // 採集籃（O5，暫定）
    BASKET_REFILL_MS: 20 * 60000,    // 每 20 分回復 1（暫定）
    MAT_MAX: 60,                     // 素材箱上限（暫定）

    // §4 調和（蘇菲範圍：形狀、旋轉、覆蓋、同色格、加成格、最後一推、品質依釜）
    BONUS: 2, BONUS_MATCH: 4,        // 加成格：一般 +2、同色 +4（暫定）
    FINAL_PUSH_RATE: 0.5,            // 最後一推：量表 × 佔比 × 0.5（暫定）
    COOLDOWN_MS: 10 * 60000,         // C11 大釜冷卻 10 分（暫定）
    MAX_TRAITS: 3,
    TRAIT_CAP_BASE: 10, TRAIT_CAP_PER_LV: 5,   // C4 特性成本上限＝10＋等級×5（暫定）
    EXP_PER_LV: 100, LV_MAX: 20,
    EXP_PER_SYNTH: 30,
    AFF_PER_SYNTH: 2, AFF_PER_TASK: 10, AFF_HINT: 30,

    // 錬金釜。pattern：. 一般格、小寫＝該屬性的色格、大寫＝同色加成格、* 無色加成格
    // 屬性代號：f 火、i 冰、b 雷、w 風、s 靈
    CAULDRONS: {
      copper: {
        name: { zh: "銅之大釜", ja: "銅の大釜", en: "Copper Cauldron" },
        qualityPerCell: 0.6,
        pattern: ["f.*.i", ".F.I.", "*.s.*", ".W.B.", "w.*.b"]
      }
    },
    // 配方：needs＝各素材格要求的類別（* 任意）；gauges＝量表與門檻（第 n 段達成就是效果 Lv n）
    RECIPES: [
      { id: "heal", lv: 1, needs: ["liquid", "plant", "*"],
        name: { zh: "治癒藥水", ja: "いやしの薬", en: "Healing Draught" },
        gauges: [
          { el: "wind", steps: [{ at: 6, kind: "heal", n: 20 }, { at: 12, kind: "heal", n: 40 }, { at: 20, kind: "heal", n: 70 }] },
          { el: "ice", steps: [{ at: 8, kind: "cleanse", n: 1 }, { at: 16, kind: "cleanse", n: 2 }] }
        ] },
      { id: "ink", lv: 1, needs: ["*", "*"],
        name: { zh: "色彩墨水", ja: "いろどりインク", en: "Color Ink" },
        gauges: [
          { el: "spirit", steps: [{ at: 5, kind: "value", n: 30 }, { at: 10, kind: "value", n: 60 }, { at: 16, kind: "value", n: 100 }] },
          { el: "fire", steps: [{ at: 6, kind: "dye", n: 1 }, { at: 12, kind: "dye", n: 2 }] }
        ] },
      { id: "neutral", lv: 1, needs: ["liquid", "mineral", "*"],
        name: { zh: "中和劑", ja: "中和剤", en: "Neutralizer" },
        gauges: [
          { el: "ice", steps: [{ at: 6, kind: "value", n: 20 }, { at: 12, kind: "value", n: 45 }, { at: 20, kind: "value", n: 80 }] },
          { el: "bolt", steps: [{ at: 8, kind: "speed", n: 1 }, { at: 16, kind: "speed", n: 2 }] }
        ] },
      { id: "bomb", lv: 2, needs: ["mineral", "essence", "*"],
        name: { zh: "色彩炸彈", ja: "いろどり爆弾", en: "Color Bomb" },
        gauges: [
          { el: "fire", steps: [{ at: 8, kind: "dmg", n: 30 }, { at: 16, kind: "dmg", n: 60 }, { at: 24, kind: "dmg", n: 100 }] },
          { el: "bolt", steps: [{ at: 8, kind: "stun", n: 1 }, { at: 18, kind: "stun", n: 2 }] }
        ] },
      { id: "lamp", lv: 3, needs: ["crystal", "mineral", "*", "*"],
        name: { zh: "結晶燈", ja: "結晶ランプ", en: "Crystal Lamp" },
        gauges: [
          { el: "bolt", steps: [{ at: 10, kind: "light", n: 1 }, { at: 20, kind: "light", n: 2 }, { at: 30, kind: "light", n: 3 }] },
          { el: "spirit", steps: [{ at: 10, kind: "value", n: 50 }, { at: 22, kind: "value", n: 120 }] }
        ] },
      { id: "charm", lv: 3, needs: ["plant", "essence", "*", "*"],
        name: { zh: "風之護符", ja: "風のお守り", en: "Wind Charm" },
        gauges: [
          { el: "wind", steps: [{ at: 10, kind: "guard", n: 10 }, { at: 20, kind: "guard", n: 20 }, { at: 30, kind: "guard", n: 35 }] },
          { el: "spirit", steps: [{ at: 10, kind: "speed", n: 1 }, { at: 22, kind: "speed", n: 2 }] }
        ] }
    ],
    // 特性（C4）：cost＝成本；quality＝品質加值；boost＝效果數值 +%
    TRAITS: {
      morning_dew: { cost: 6, quality: 5, name: { zh: "朝露", ja: "朝露", en: "Morning Dew" } },
      dusk: { cost: 6, boost: 10, name: { zh: "黃昏", ja: "黄昏", en: "Dusk" } },
      night: { cost: 8, boost: 15, name: { zh: "夜之帳", ja: "夜の帳", en: "Nightfall" } },
      hue_grace: { cost: 10, quality: 8, name: { zh: "色之恩惠", ja: "色の恵み", en: "Hue's Grace" } },
      hue_blessing: { cost: 18, boost: 25, name: { zh: "色之祝福", ja: "色の祝福", en: "Hue's Blessing" } },
      vivid: { cost: 12, quality: 10, name: { zh: "鮮豔", ja: "あざやか", en: "Vivid" } }
    },
    // O4 時間特性（JST 小時，含 from、不含 to；from > to 表示跨午夜）
    TIME_TRAITS: [
      { from: 5, to: 9, trait: "morning_dew" },
      { from: 17, to: 19, trait: "dusk" },
      { from: 22, to: 4, trait: "night" }
    ],
    RARITY_TRAIT: { 2: "hue_grace", 3: "hue_blessing" },
    VIVID_QUALITY: 80
  };
  if (typeof module !== "undefined" && module.exports) module.exports = data;
  else window.PriTestAtelierData = data;
})();
```

- [ ] **Step 2: 傳統色**（`static_src/atelier_colors.js`，全文）

```js
// 煉金術士（atelier）：日本傳統色（C2）。[id, hex, 日文名, 中文名, 稀有度 1～3]
// 第 1 階段先收 42 色；第 2 階段擴充到約 250 色（圖鑑）。hex 為一般通行的參考值。
(function () {
  "use strict";
  var rows = [
    ["akane", "#B7282E", "茜色", "茜色", 2], ["beni", "#D7003A", "紅", "紅", 2], ["shu", "#EB6101", "朱色", "朱色", 1],
    ["kaki", "#ED6D3D", "柿色", "柿色", 1], ["daidai", "#EE7800", "橙色", "橙色", 1], ["yamabuki", "#F8B500", "山吹色", "棣棠色", 2],
    ["kiiro", "#FFD900", "黄色", "黃色", 1], ["kariyasu", "#F5E56B", "刈安色", "刈安色", 2], ["uguisu", "#928C36", "鶯色", "鶯色", 2],
    ["moegi", "#AACF53", "萌黄", "萌黃", 1], ["wakakusa", "#C3D825", "若草色", "若草色", 1], ["wakatake", "#68BE8D", "若竹色", "若竹色", 1],
    ["tokiwa", "#007B43", "常磐色", "常盤色", 2], ["rokusho", "#47885E", "緑青", "綠青", 2], ["seiji", "#7EBEA5", "青磁色", "青瓷色", 2],
    ["asagi", "#00A3AF", "浅葱色", "淺蔥色", 2], ["mizu", "#BCE2E8", "水色", "水色", 1], ["sora", "#A0D8EF", "空色", "空色", 1],
    ["hanada", "#2792C3", "縹色", "縹色", 2], ["ruri", "#1E50A2", "瑠璃色", "瑠璃色", 3], ["gunjo", "#4C6CB3", "群青色", "群青色", 2],
    ["ai", "#165E83", "藍色", "藍色", 1], ["kon", "#223A70", "紺色", "紺色", 1], ["kikyo", "#5654A2", "桔梗色", "桔梗色", 2],
    ["sumire", "#7058A3", "菫色", "堇色", 2], ["fuji", "#BBBCDE", "藤色", "藤色", 1], ["murasaki", "#884898", "紫", "紫", 2],
    ["botan", "#E7609E", "牡丹色", "牡丹色", 2], ["sakura", "#FEF4F4", "桜色", "櫻色", 1], ["momo", "#F09199", "桃色", "桃色", 1],
    ["toki", "#F4B3C2", "鴇色", "鴇色", 2], ["sango", "#F5B1AA", "珊瑚色", "珊瑚色", 2], ["azuki", "#96514D", "小豆色", "紅豆色", 1],
    ["kuri", "#762F07", "栗色", "栗色", 1], ["odo", "#C39143", "黄土色", "黃土色", 1], ["kinari", "#FBFAF5", "生成り色", "生成色", 1],
    ["shiro", "#FFFFFF", "白", "白", 1], ["nibi", "#727171", "鈍色", "鈍色", 1], ["sumi", "#595857", "墨", "墨", 1],
    ["shikkoku", "#0D0015", "漆黒", "漆黑", 3], ["kin", "#E6B422", "金色", "金色", 3], ["gin", "#AFAFB0", "銀色", "銀色", 3]
  ];
  var list = rows.map(function (r) {
    return { id: r[0], hex: r[1], name: { ja: r[2], zh: r[3], en: r[0] }, rarity: r[4] };
  });
  if (typeof module !== "undefined" && module.exports) module.exports = list;
  else window.PriTestAtelierColors = list;
})();
```

- [ ] **Step 3: 寫失敗的測試**（`tools/atelier_check/core_check.js`；Task 3、Task 4 會在最後一行 `console.log` 之前繼續加測試）

```js
// ============================================================================
// 煉金術士（atelier）規則核心檢查（不需要瀏覽器）。規則依據 docs/atelier_design.md。
// 執行：node tools/atelier_check/core_check.js
// ============================================================================
"use strict";
var path = require("path");
var assert = require("assert");
var SRC = path.join(__dirname, "..", "..", "static_src");
global.PriTestAtelierData = require(path.join(SRC, "atelier_data.js"));
global.PriTestAtelierColors = require(path.join(SRC, "atelier_colors.js"));
global.PriTestAtelierHosts = require(path.join(SRC, "atelier_hosts.js"));
var C = require(path.join(SRC, "atelier_core.js"));
global.PriTestAtelierCore = C;
var Board = require(path.join(SRC, "atelier_method_board.js"));
C.registerMethod("board", Board);
var D = global.PriTestAtelierData;

var passed = 0;
function test(name, fn) { fn(); passed++; console.log("ok - " + name); }
var T0 = Date.UTC(2026, 10, 19, 3, 0, 0);   // JST 12:00（沒有時間特性）

// 測試用：w×h 的 RGBA，左右兩半不同顏色
function split(left, right, w) {
  var a = new Uint8ClampedArray(w * w * 4);
  for (var y = 0; y < w; y++) for (var x = 0; x < w; x++) {
    var c = x < w / 2 ? left : right, i = (y * w + x) * 4;
    a[i] = c[0]; a[i + 1] = c[1]; a[i + 2] = c[2]; a[i + 3] = 255;
  }
  return a;
}
function mat(uid, el, cat, shape, q, power) {
  return { uid: uid, hex: "#000000", rgb: [0, 0, 0], colorId: "sumi", element: el, category: cat,
    power: power || 2, quality: q || 50, traits: [], shape: shape, at: T0 };
}

// ---------- 色彩數學 ----------
test("HSV：純紅、純綠、灰", function () {
  var r = C.rgbToHsv([255, 0, 0]);
  assert.strictEqual(r.h, 0); assert.strictEqual(r.s, 1); assert.strictEqual(r.v, 1);
  assert.strictEqual(Math.round(C.rgbToHsv([0, 255, 0]).h), 120);
  assert.strictEqual(C.rgbToHsv([128, 128, 128]).s, 0);
});

test("Lab：白 L≈100、黑 L＝0", function () {
  assert(Math.abs(C.rgbToLab([255, 255, 255])[0] - 100) < 0.5);
  assert.strictEqual(Math.round(C.rgbToLab([0, 0, 0])[0]), 0);
});

test("傳統色：瑠璃色本身的最近色就是瑠璃色，距離 0", function () {
  var n = C.nearestColor(C.hexToRgb("#1E50A2"));
  assert.strictEqual(n.color.id, "ruri");
  assert(n.dist < 1e-9);
});

test("色相 → 屬性（含跨 0 度與無彩色）", function () {
  assert.strictEqual(C.elementOf({ h: 350, s: 0.8, v: 0.8 }), "fire");
  assert.strictEqual(C.elementOf({ h: 10, s: 0.8, v: 0.8 }), "fire");
  assert.strictEqual(C.elementOf({ h: 60, s: 0.8, v: 0.8 }), "bolt");
  assert.strictEqual(C.elementOf({ h: 120, s: 0.8, v: 0.8 }), "wind");
  assert.strictEqual(C.elementOf({ h: 220, s: 0.8, v: 0.8 }), "ice");
  assert.strictEqual(C.elementOf({ h: 290, s: 0.8, v: 0.8 }), "spirit");
  assert.strictEqual(C.elementOf({ h: 120, s: 0.05, v: 0.8 }), "spirit");
});

test("類別：暗 → 影、亮且淡 → 結晶、其他依屬性", function () {
  assert.strictEqual(C.categoryOf({ h: 0, s: 0.9, v: 0.1 }, "fire"), "shadow");
  assert.strictEqual(C.categoryOf({ h: 0, s: 0.1, v: 0.95 }, "spirit"), "crystal");
  assert.strictEqual(C.categoryOf({ h: 200, s: 0.8, v: 0.7 }, "ice"), "liquid");
  assert.strictEqual(C.categoryOf({ h: 120, s: 0.8, v: 0.7 }, "wind"), "plant");
});

// ---------- 照片分析 ----------
test("左右兩色的照片 → 2 個色塊，各約 50%，形狀 6 格", function () {
  var sw = C.analyze(split([200, 30, 30], [30, 60, 200], 32), 32, 32, "t1");
  assert.strictEqual(sw.length, 2);
  sw.forEach(function (s) {
    assert(Math.abs(s.frac - 0.5) < 0.01);
    assert.strictEqual(s.shape.length, 6);
  });
  var hexes = sw.map(function (s) { return s.hex; }).sort();
  assert.deepStrictEqual(hexes, ["#1E3CC8", "#C81E1E"]);
});

test("同一張照片、同一個 seed，結果完全相同（O11）", function () {
  var px = split([10, 200, 90], [240, 220, 40], 32);
  assert.deepStrictEqual(C.analyze(px, 32, 32, "same"), C.analyze(px, 32, 32, "same"));
});

test("形狀：連通、正規化到 (0,0)、旋轉 4 次回到原形", function () {
  var G = D.GRID, grid = [];
  for (var i = 0; i < G * G; i++) grid.push(i % G < 3 ? 1 : 0);   // 左邊 3 欄是 label 1
  var shape = C.shapeFromGrid(grid, 1, 5);
  assert.strictEqual(shape.length, 5);
  assert.strictEqual(Math.min.apply(null, shape.map(function (c) { return c[0]; })), 0);
  assert.strictEqual(Math.min.apply(null, shape.map(function (c) { return c[1]; })), 0);
  assert.deepStrictEqual(C.rotateShape(shape, 4), C.normalizeShape(shape));
  assert.deepStrictEqual(C.rotateShape([[0, 0], [1, 0], [2, 0]], 1), [[0, 0], [0, 1], [0, 2]]);
});

// ---------- 素材 ----------
test("素材：純度高的瑠璃色品質高，帶稀有色特性；時間特性依 JST", function () {
  var m = C.makeMaterial({ rgb: C.hexToRgb("#1E50A2"), hex: "#1E50A2", frac: 0.3, shape: [[0, 0]] }, T0, 1);
  assert.strictEqual(m.colorId, "ruri");
  assert.strictEqual(m.element, "ice");
  assert.strictEqual(m.category, "liquid");
  assert(m.quality >= 80, "quality " + m.quality);
  assert(m.traits.indexOf("hue_blessing") >= 0);
  assert(m.traits.indexOf("vivid") >= 0);
  assert.deepStrictEqual(C.timeTraits(Date.UTC(2026, 10, 18, 21, 0, 0)), ["morning_dew"]);   // JST 06:00
  assert.deepStrictEqual(C.timeTraits(Date.UTC(2026, 10, 18, 14, 0, 0)), ["night"]);         // JST 23:00
  assert.deepStrictEqual(C.timeTraits(T0), []);
});

test("採集籃：每次消耗 1，用完不能採；20 分回復 1，不超過上限", function () {
  var s = C.newSave(T0), sw = { rgb: [200, 30, 30], hex: "#C81E1E", frac: 0.5, shape: [[0, 0]] };
  for (var i = 0; i < D.BASKET_MAX; i++) assert(C.capture(s, [sw], T0));
  assert.strictEqual(C.capture(s, [sw], T0), null);
  assert.strictEqual(C.refillBasket(s, T0 + D.BASKET_REFILL_MS * 2 + 1000), 2);
  assert.strictEqual(C.refillBasket(s, T0 + D.BASKET_REFILL_MS * 100), D.BASKET_MAX);
  assert.strictEqual(C.capture(s, [sw, sw, sw, sw], T0), null, "一次最多 3 色");
  assert.strictEqual(s.mats.length, D.BASKET_MAX);
  assert(s.seen.akane || s.seen.beni || Object.keys(s.seen).length === 1);
});

console.log("\n" + passed + " passed");
```

- [ ] **Step 4: 跑測試確認失敗**

Run: `node tools/atelier_check/core_check.js`
Expected: FAIL（`C.registerMethod is not a function`）

- [ ] **Step 5: 實作規則核心**（`static_src/atelier_core.js`，全文。調和流程那幾段在 Task 3、Task 4 用到）

```js
// 煉金術士（atelier）：規則核心。不碰 DOM、不讀寫 localStorage；畫面（atelier.js）只呼叫這裡。
// 規則依據 docs/atelier_design.md。將來移植到 RMD 時照這個檔案改寫成 Go。
// 調和方式（棋盤等）由 atelier_method_*.js 用 registerMethod() 登記，核心只透過介面呼叫。
(function () {
  "use strict";
  var root = typeof window !== "undefined" ? window : globalThis;
  var D = root.PriTestAtelierData, COLORS = root.PriTestAtelierColors, HOSTS = root.PriTestAtelierHosts;
  var JST = 9 * 3600000;
  var methods = {};

  // ---------- 共用 ----------
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function hash(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h >>> 0;
  }
  // mulberry32；seed 可以是數字或字串（O11：所有亂數都可重現）
  function makeRng(seed) {
    var a = typeof seed === "number" ? seed >>> 0 : hash(String(seed));
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function jstHour(ms) { return new Date(ms + JST).getUTCHours(); }
  function inRange(h, from, to) { return from <= to ? (h >= from && h < to) : (h >= from || h < to); }

  // ---------- 色彩數學 ----------
  function hexToRgb(hex) {
    var n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgbToHex(rgb) {
    return "#" + rgb.map(function (c) { var s = Math.round(c).toString(16); return s.length < 2 ? "0" + s : s; }).join("").toUpperCase();
  }
  function rgbToHsv(rgb) {
    var r = rgb[0] / 255, g = rgb[1] / 255, b = rgb[2] / 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, h = 0;
    if (d > 0) {
      if (max === r) h = 60 * (((g - b) / d) % 6);
      else if (max === g) h = 60 * ((b - r) / d + 2);
      else h = 60 * ((r - g) / d + 4);
    }
    if (h < 0) h += 360;
    return { h: h, s: max === 0 ? 0 : d / max, v: max };
  }
  function rgbToLab(rgb) {
    function lin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
    var r = lin(rgb[0]), g = lin(rgb[1]), b = lin(rgb[2]);
    var x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
    var y = r * 0.2126 + g * 0.7152 + b * 0.0722;
    var z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
    function f(t) { return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116; }
    var fx = f(x), fy = f(y), fz = f(z);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  }
  function deltaE(a, b) { return Math.sqrt((a[0] - b[0]) * (a[0] - b[0]) + (a[1] - b[1]) * (a[1] - b[1]) + (a[2] - b[2]) * (a[2] - b[2])); }
  var colorLabs = null;
  function nearestColor(rgb) {
    if (!colorLabs) colorLabs = COLORS.map(function (c) { return rgbToLab(hexToRgb(c.hex)); });
    var lab = rgbToLab(rgb), best = 0, bestD = Infinity;
    for (var i = 0; i < COLORS.length; i++) {
      var d = deltaE(lab, colorLabs[i]);
      if (d < bestD) { bestD = d; best = i; }
    }
    return { color: COLORS[best], dist: bestD };
  }
  function elementOf(hsv) {
    if (hsv.s < D.ACHROMATIC_SAT) return "spirit";
    for (var i = 0; i < D.HUE_SECTORS.length; i++) {
      var s = D.HUE_SECTORS[i];
      if (inRange(hsv.h, s.from, s.to)) return s.el;
    }
    return "spirit";
  }
  function categoryOf(hsv, el) {
    if (hsv.v < D.SHADOW_VAL) return "shadow";
    if (hsv.v > D.CRYSTAL_VAL && hsv.s < D.CRYSTAL_SAT) return "crystal";
    return D.CATEGORY_BY_ELEMENT[el];
  }

  // ---------- 照片分析（O1 多色、C1 形狀） ----------
  // pixels：[[r,g,b], ...]；回傳 {centers, labels}
  function kmeans(pixels, k, seed) {
    var rng = makeRng("kmeans:" + seed), n = pixels.length, centers = [], labels = new Array(n), i, j;
    function d2(p, c) { var a = p[0] - c[0], b = p[1] - c[1], e = p[2] - c[2]; return a * a + b * b + e * e; }
    centers.push(pixels[Math.floor(rng() * n)].slice());
    while (centers.length < k) {           // k-means++
      var dist = pixels.map(function (p) { return Math.min.apply(null, centers.map(function (c) { return d2(p, c); })); });
      var sum = dist.reduce(function (a, b) { return a + b; }, 0);
      if (sum === 0) break;                // 顏色比 k 少
      var r = rng() * sum;
      for (i = 0; i < n; i++) { r -= dist[i]; if (r <= 0) break; }
      centers.push(pixels[Math.min(i, n - 1)].slice());
    }
    for (var it = 0; it < D.KMEANS_ITER; it++) {
      for (i = 0; i < n; i++) {
        var best = 0, bd = Infinity;
        for (j = 0; j < centers.length; j++) { var dd = d2(pixels[i], centers[j]); if (dd < bd) { bd = dd; best = j; } }
        labels[i] = best;
      }
      var acc = centers.map(function () { return [0, 0, 0, 0]; });
      for (i = 0; i < n; i++) { var a = acc[labels[i]]; a[0] += pixels[i][0]; a[1] += pixels[i][1]; a[2] += pixels[i][2]; a[3]++; }
      for (j = 0; j < centers.length; j++) if (acc[j][3]) centers[j] = [acc[j][0] / acc[j][3], acc[j][1] / acc[j][3], acc[j][2] / acc[j][3]];
    }
    return { centers: centers, labels: labels };
  }
  // 色塊在 8×8 格上的最大連通區，從最靠近重心的格子 BFS 取 n 格，正規化成 [[x,y]]
  function shapeFromGrid(grid, label, n) {
    var G = D.GRID, seen = {}, best = [], x, y;
    for (y = 0; y < G; y++) for (x = 0; x < G; x++) {
      var key = x + "," + y;
      if (grid[y * G + x] !== label || seen[key]) continue;
      var comp = [], q = [[x, y]]; seen[key] = true;
      while (q.length) {
        var c = q.shift(); comp.push(c);
        [[0, -1], [1, 0], [0, 1], [-1, 0]].forEach(function (d) {
          var nx = c[0] + d[0], ny = c[1] + d[1], k2 = nx + "," + ny;
          if (nx < 0 || ny < 0 || nx >= G || ny >= G || seen[k2] || grid[ny * G + nx] !== label) return;
          seen[k2] = true; q.push([nx, ny]);
        });
      }
      if (comp.length > best.length) best = comp;
    }
    if (!best.length) return [[0, 0]];
    var cx = 0, cy = 0;
    best.forEach(function (c) { cx += c[0]; cy += c[1]; });
    cx /= best.length; cy /= best.length;
    var start = best.slice().sort(function (a, b) {
      var da = (a[0] - cx) * (a[0] - cx) + (a[1] - cy) * (a[1] - cy), db = (b[0] - cx) * (b[0] - cx) + (b[1] - cy) * (b[1] - cy);
      return da - db || a[1] - b[1] || a[0] - b[0];
    })[0];
    var inComp = {}; best.forEach(function (c) { inComp[c[0] + "," + c[1]] = true; });
    var out = [], taken = {}, q2 = [start]; taken[start[0] + "," + start[1]] = true;
    while (q2.length && out.length < n) {
      var p = q2.shift(); out.push(p);
      [[0, -1], [1, 0], [0, 1], [-1, 0]].forEach(function (d) {
        var k3 = (p[0] + d[0]) + "," + (p[1] + d[1]);
        if (inComp[k3] && !taken[k3]) { taken[k3] = true; q2.push([p[0] + d[0], p[1] + d[1]]); }
      });
    }
    return normalizeShape(out);
  }
  function normalizeShape(cells) {
    var mx = Math.min.apply(null, cells.map(function (c) { return c[0]; }));
    var my = Math.min.apply(null, cells.map(function (c) { return c[1]; }));
    return cells.map(function (c) { return [c[0] - mx, c[1] - my]; })
      .sort(function (a, b) { return a[1] - b[1] || a[0] - b[0]; });
  }
  function rotateShape(cells, times) {
    var out = cells;
    for (var i = 0; i < ((times % 4) + 4) % 4; i++) out = normalizeShape(out.map(function (c) { return [-c[1], c[0]]; }));
    return out;
  }
  // rgba：RGBA 陣列（長度 w*h*4，w＝h＝SRC_SIZE）。回傳色塊 [{rgb, hex, frac, shape}]，面積大到小
  function analyze(rgba, w, h, seed) {
    var pixels = [], i;
    for (i = 0; i < w * h; i++) pixels.push([rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]]);
    var km = kmeans(pixels, D.K, seed), G = D.GRID, cw = w / G, ch = h / G, grid = [];
    for (var gy = 0; gy < G; gy++) for (var gx = 0; gx < G; gx++) {
      var votes = {};
      for (var y = Math.floor(gy * ch); y < Math.floor((gy + 1) * ch); y++)
        for (var x = Math.floor(gx * cw); x < Math.floor((gx + 1) * cw); x++) {
          var l = km.labels[y * w + x]; votes[l] = (votes[l] || 0) + 1;
        }
      var bl = -1, bv = -1;
      Object.keys(votes).forEach(function (k) { if (votes[k] > bv || (votes[k] === bv && +k < bl)) { bv = votes[k]; bl = +k; } });
      grid.push(bl);
    }
    var counts = km.centers.map(function () { return 0; });
    km.labels.forEach(function (l) { counts[l]++; });
    var out = [];
    km.centers.forEach(function (c, j) {
      var frac = counts[j] / pixels.length;
      if (frac < D.MIN_FRAC) return;
      var n = clamp(Math.round(1 + frac * D.SHAPE_SCALE), D.SHAPE_MIN, D.SHAPE_MAX);
      var rgb = c.map(Math.round);
      out.push({ rgb: rgb, hex: rgbToHex(rgb), frac: frac, shape: shapeFromGrid(grid, j, n) });
    });
    return out.sort(function (a, b) { return b.frac - a.frac; });
  }

  // ---------- 素材（O4、O6、C2） ----------
  function timeTraits(now) {
    var h = jstHour(now);
    return D.TIME_TRAITS.filter(function (t) { return inRange(h, t.from, t.to); }).map(function (t) { return t.trait; });
  }
  function makeMaterial(swatch, now, uid) {
    var hsv = rgbToHsv(swatch.rgb), el = elementOf(hsv), near = nearestColor(swatch.rgb);
    var purity = 1 - Math.min(near.dist, D.PURITY_RANGE) / D.PURITY_RANGE;
    var quality = clamp(Math.round(15 + 45 * hsv.s + 40 * purity), 1, 100);
    var traits = timeTraits(now);
    if (D.RARITY_TRAIT[near.color.rarity]) traits.push(D.RARITY_TRAIT[near.color.rarity]);
    if (quality >= D.VIVID_QUALITY) traits.push("vivid");
    return {
      uid: uid, hex: swatch.hex, rgb: swatch.rgb, colorId: near.color.id, element: el,
      category: categoryOf(hsv, el), power: 1 + Math.min(3, Math.floor(hsv.s * 4)),
      quality: quality, traits: traits, shape: swatch.shape, at: now
    };
  }

  // ---------- 存檔、採集籃（O5）、冷卻（C11） ----------
  function newSave(now) {
    return { v: 1, nextUid: 1, mats: [], items: [], basket: { n: D.BASKET_MAX, at: now }, cooldownUntil: 0,
      exp: 0, host: "ruri", hosts: { ruri: { aff: 0, task: 0 } }, best: {}, tutorial: 0, seen: {}, log: [] };
  }
  function refillBasket(save, now) {
    var b = save.basket;
    if (b.n >= D.BASKET_MAX) { b.at = now; return b.n; }
    var gained = Math.floor((now - b.at) / D.BASKET_REFILL_MS);
    if (gained > 0) {
      b.n = Math.min(D.BASKET_MAX, b.n + gained);
      b.at = b.n >= D.BASKET_MAX ? now : b.at + gained * D.BASKET_REFILL_MS;
    }
    return b.n;
  }
  // 選 1～PICK_MAX 個色塊，消耗 1 籃 → 回傳新增的素材；失敗回傳 null
  function capture(save, swatches, now) {
    refillBasket(save, now);
    if (!swatches.length || swatches.length > D.PICK_MAX || save.basket.n <= 0) return null;
    if (save.mats.length + swatches.length > D.MAT_MAX) return null;
    if (save.basket.n >= D.BASKET_MAX) save.basket.at = now;
    save.basket.n--;
    var added = swatches.map(function (s) { var m = makeMaterial(s, now, save.nextUid++); save.mats.push(m); save.seen[m.colorId] = true; return m; });
    return added;
  }
  function level(save) { return Math.min(D.LV_MAX, 1 + Math.floor(save.exp / D.EXP_PER_LV)); }
  function traitCap(save) { return D.TRAIT_CAP_BASE + D.TRAIT_CAP_PER_LV * level(save); }
  function canSynth(save, now) { return now >= save.cooldownUntil; }
  function recipe(id) { for (var i = 0; i < D.RECIPES.length; i++) if (D.RECIPES[i].id === id) return D.RECIPES[i]; return null; }
  function recipesFor(save) { var lv = level(save); return D.RECIPES.filter(function (r) { return r.lv <= lv; }); }
  function slotOk(need, mat) { return need === "*" || need === mat.category; }

  // ---------- 調和 ----------
  function registerMethod(id, impl) { methods[id] = impl; }
  function host(save) { return HOSTS[save.host]; }
  // matUids 依配方 needs 的順序；檢查失敗回傳 {error}
  function startSynthesis(save, recipeId, matUids, cauldronId, now) {
    var r = recipe(recipeId);
    if (!r || r.lv > level(save)) return { error: "recipe" };
    if (!canSynth(save, now)) return { error: "cooldown" };
    if (matUids.length !== r.needs.length) return { error: "count" };
    var mats = [];
    for (var i = 0; i < matUids.length; i++) {
      var m = null;
      for (var j = 0; j < save.mats.length; j++) if (save.mats[j].uid === matUids[i]) m = save.mats[j];
      if (!m || mats.indexOf(m) >= 0 || !slotOk(r.needs[i], m)) return { error: "slot", slot: i };
      mats.push(m);
    }
    var h = host(save);
    return methods[h.method].create(r, mats, D.CAULDRONS[cauldronId], h.ability);
  }
  function effectLevels(r, gauges) {
    return r.gauges.map(function (g) {
      var lv = 0;
      g.steps.forEach(function (s, i) { if ((gauges[g.el] || 0) >= s.at) lv = i + 1; });
      return { el: g.el, level: lv, step: lv ? g.steps[lv - 1] : null, next: g.steps[lv] ? g.steps[lv].at : null };
    });
  }
  // 可選的特性：還看得到（沒被完全覆蓋）的素材帶有的特性，去重
  function traitChoices(session) {
    var ev = methods[session.method].evaluate(session, true), out = [];
    session.mats.forEach(function (m, i) {
      if (!ev.visible[i]) return;
      m.traits.forEach(function (t) { if (out.indexOf(t) < 0) out.push(t); });
    });
    return out;
  }
  function traitsValid(save, session, traitIds) {
    if (traitIds.length > D.MAX_TRAITS) return false;
    var choices = traitChoices(session), cost = 0;
    for (var i = 0; i < traitIds.length; i++) {
      if (choices.indexOf(traitIds[i]) < 0 || traitIds.indexOf(traitIds[i]) !== i) return false;
      cost += D.TRAITS[traitIds[i]].cost;
    }
    return cost <= traitCap(save);
  }
  // 完成調和：扣素材、加成品、經驗、冷卻、好感度；回傳 item 或 {error}
  function finishSynthesis(save, session, traitIds, now) {
    var impl = methods[session.method];
    if (!impl.done(session)) return { error: "unplaced" };
    if (!traitsValid(save, session, traitIds)) return { error: "traits" };
    var ev = impl.evaluate(session, true), q = ev.quality, boost = 0;
    traitIds.forEach(function (t) { q += D.TRAITS[t].quality || 0; boost += D.TRAITS[t].boost || 0; });
    var effects = effectLevels(session.recipe, ev.gauges).map(function (e) {
      return { el: e.el, level: e.level, kind: e.step ? e.step.kind : null, n: e.step ? Math.round(e.step.n * (1 + boost / 100)) : 0 };
    });
    var item = { uid: save.nextUid++, recipe: session.recipe.id, quality: clamp(Math.round(q), 1, 100),
      effects: effects, traits: traitIds.slice(), gauges: ev.gauges, at: now };
    var used = session.mats.map(function (m) { return m.uid; });
    save.mats = save.mats.filter(function (m) { return used.indexOf(m.uid) < 0; });
    save.items.push(item);
    save.exp += D.EXP_PER_SYNTH;
    save.cooldownUntil = now + D.COOLDOWN_MS;
    save.hosts[save.host].aff = Math.min(100, save.hosts[save.host].aff + D.AFF_PER_SYNTH);
    if (!save.best[item.recipe] || item.quality > save.best[item.recipe]) save.best[item.recipe] = item.quality;
    if (save.tutorial < 3) save.tutorial++;
    return item;
  }

  // ---------- 工房主人的任務與反應 ----------
  function currentTask(save) { var h = host(save); return h.tasks[save.hosts[save.host].task] || null; }
  function taskMet(task, item) {
    if (!task || item.recipe !== task.recipe || item.quality < task.minQuality) return false;
    return !task.minLevel || item.effects.some(function (e) { return e.level >= task.minLevel; });
  }
  function deliver(save, itemUid) {
    var task = currentTask(save), item = null;
    save.items.forEach(function (it) { if (it.uid === itemUid) item = it; });
    if (!item || !taskMet(task, item)) return false;
    save.items = save.items.filter(function (it) { return it !== item; });
    var hs = save.hosts[save.host];
    hs.task++; hs.aff = Math.min(100, hs.aff + D.AFF_PER_TASK); save.exp += task.exp;
    return true;
  }
  // 依放置前後的評估與這一手的資訊，回傳工房主人台詞的鍵（A3）
  function react(save, before, after, info) {
    var r = info.recipe;
    var lvB = effectLevels(r, before.gauges), lvA = effectLevels(r, after.gauges);
    for (var i = 0; i < lvA.length; i++) if (lvA[i].level > lvB[i].level) return "levelup";
    if (info.bonusCells > 0) return "bonus";
    if (info.matchCells * 2 >= info.cells) return "match";
    if (info.overwritten > 0) return "overwrite";
    if (info.matchCells === 0) return save.hosts[save.host].aff >= D.AFF_HINT ? "hint" : "miss";
    return "ok";
  }

  var api = {
    clamp: clamp, hash: hash, makeRng: makeRng, jstHour: jstHour,
    hexToRgb: hexToRgb, rgbToHex: rgbToHex, rgbToHsv: rgbToHsv, rgbToLab: rgbToLab, deltaE: deltaE,
    nearestColor: nearestColor, elementOf: elementOf, categoryOf: categoryOf,
    kmeans: kmeans, shapeFromGrid: shapeFromGrid, normalizeShape: normalizeShape, rotateShape: rotateShape, analyze: analyze,
    timeTraits: timeTraits, makeMaterial: makeMaterial,
    newSave: newSave, refillBasket: refillBasket, capture: capture, level: level, traitCap: traitCap,
    canSynth: canSynth, recipe: recipe, recipesFor: recipesFor, slotOk: slotOk,
    registerMethod: registerMethod, method: function (id) { return methods[id]; }, host: host,
    startSynthesis: startSynthesis, effectLevels: effectLevels, traitChoices: traitChoices, traitsValid: traitsValid,
    finishSynthesis: finishSynthesis, currentTask: currentTask, taskMet: taskMet, deliver: deliver, react: react
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else window.PriTestAtelierCore = api;
})();
```

  實作重點（讀程式前先看）：
  - `kmeans` 的起始點用 k-means++，亂數來自 `makeRng("kmeans:" + seed)`，所以同一張照片配同一個 seed，結果一定相同。
  - `analyze` 先把 32×32 投票成 8×8 格，再用 `shapeFromGrid` 取形狀。格數＝`round(1 + 面積比 × SHAPE_SCALE)`，夾在 1～6 之間。
  - `capture` 在採集籃從滿的狀態被用掉時，會把回復計時的起點設成現在，避免「滿的時候放著，用掉後立刻回復」。

- [ ] **Step 6: 跑測試確認通過**

Run: `node tools/atelier_check/core_check.js`
Expected: 10 passed

- [ ] **Step 7: Commit**

```bash
git add static_src/atelier_data.js static_src/atelier_colors.js static_src/atelier_core.js tools/atelier_check/core_check.js
git commit -m "feat(atelier): 數值表、傳統色、照片多色分析、素材形狀與採集籃"
```

---

### Task 3: 調和方式①色彩棋盤

**Files:**
- Modify: `static_src/atelier_method_board.js`（換成全文）, `tools/atelier_check/core_check.js`

**Interfaces:**
- Consumes: `Core.rotateShape`、`Core.recipe`、`PriTestAtelierData.CAULDRONS／BONUS／BONUS_MATCH／FINAL_PUSH_RATE`
- Produces: 「介面」一節的 `Board.*`；瀏覽器端用 `Core.registerMethod("board", impl)` 登記

- [ ] **Step 1: 寫失敗的測試**（加在 `core_check.js` 最後一行 `console.log` 之前）

```js
// ---------- 棋盤 ----------
function session(mats, ability) {
  return Board.create(C.recipe("heal"), mats, D.CAULDRONS.copper, ability || {});
}

test("棋盤：銅之大釜 5×5，色格與加成格依 pattern", function () {
  var s = session([mat(1, "wind", "plant", [[0, 0]])]);
  assert.strictEqual(s.size, 5);
  assert.deepStrictEqual(s.cells[0], { color: "fire", bonus: false });
  assert.deepStrictEqual(s.cells[2], { color: null, bonus: true });
  assert.deepStrictEqual(s.cells[6], { color: "fire", bonus: true });
});

test("放置：超出邊界或重複放置不行", function () {
  var s = session([mat(1, "wind", "plant", [[0, 0], [1, 0]])]);
  assert.strictEqual(Board.canPlace(s, 0, 4, 0, 0), false);
  assert.strictEqual(Board.canPlace(s, 0, 4, 0, 1), true);     // 旋轉後變直的就放得下
  assert(Board.place(s, 0, 3, 0, 0).ok);
  assert.strictEqual(Board.place(s, 0, 0, 0, 0).ok, false);
});

test("量表：一般格 power、同色格 ×2、加成格 +2／同色 +4", function () {
  // (0,4) 是風色格 w；(1,3) 是風色加成格 W；(1,1) 是火色加成格 F
  var s = session([mat(1, "wind", "plant", [[0, 0]], 50, 2), mat(2, "wind", "plant", [[0, 0]], 50, 2),
    mat(3, "wind", "plant", [[0, 0]], 50, 2), mat(4, "wind", "plant", [[0, 0]], 50, 2)]);
  Board.place(s, 0, 1, 0, 0);   // 一般格：2
  Board.place(s, 1, 0, 4, 0);   // 同色格：2+2＝4
  Board.place(s, 2, 1, 3, 0);   // 同色加成格：2+2+4＝8
  Board.place(s, 3, 1, 1, 0);   // 異色加成格：2+2＝4
  var ev = Board.evaluate(s, false);
  assert.strictEqual(ev.gauges.wind, 2 + 4 + 8 + 4);
  assert.strictEqual(ev.covered, 4);
});

test("瑠璃的能力：同色格每格再 +1", function () {
  var s = session([mat(1, "wind", "plant", [[0, 0]], 50, 2)], { matchBonus: 1 });
  Board.place(s, 0, 0, 4, 0);
  assert.strictEqual(Board.evaluate(s, false).gauges.wind, 5);
});

test("覆蓋：被蓋掉的格子不再計算；完全被蓋掉的素材 visible＝0；Undo 還原", function () {
  var s = session([mat(1, "fire", "mineral", [[0, 0]]), mat(2, "wind", "plant", [[0, 0], [1, 0]])]);
  Board.place(s, 0, 1, 0, 0);
  var info = Board.place(s, 1, 0, 0, 0);
  assert.strictEqual(info.overwritten, 1);
  var ev = Board.evaluate(s, false);
  assert.strictEqual(ev.visible[0], 0);
  assert.strictEqual(ev.gauges.fire, 0);
  assert(Board.undo(s));
  assert.strictEqual(Board.evaluate(s, false).visible[0], 1);
  assert.strictEqual(s.placed[1], false);
});

test("最後一推：佔比最多的屬性 × 佔比 × 0.5", function () {
  var s = session([mat(1, "wind", "plant", [[0, 0], [1, 0], [2, 0]], 50, 2), mat(2, "fire", "mineral", [[0, 0]], 50, 2)]);
  Board.place(s, 0, 1, 2, 0);    // (1,2) 一般、(2,2) 靈色格（異色）、(3,2) 一般 → 6
  Board.place(s, 1, 0, 1, 0);    // (0,1) 一般 → 2
  var ev = Board.evaluate(s, true);
  assert.strictEqual(ev.dominant, "wind");
  assert.strictEqual(ev.push, Math.round(6 * 0.75 * D.FINAL_PUSH_RATE));
  assert.strictEqual(ev.gauges.wind, 6 + ev.push);
});

test("品質：看得到的素材平均＋每格 × 釜的品質上升率", function () {
  var s = session([mat(1, "wind", "plant", [[0, 0], [1, 0]], 40), mat(2, "wind", "plant", [[0, 0]], 60)]);
  Board.place(s, 0, 1, 2, 0);
  Board.place(s, 1, 0, 0, 0);
  assert.strictEqual(Board.evaluate(s, true).quality, Math.round(50 + 0.6 * 3));
});

test("預覽不改動 session", function () {
  var s = session([mat(1, "wind", "plant", [[0, 0]])]);
  var p = Board.preview(s, 0, 0, 4, 0);
  assert.strictEqual(p.after.gauges.wind > p.before.gauges.wind, true);
  assert.strictEqual(s.placed[0], false);
  assert.strictEqual(s.owner[20], -1);
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `node tools/atelier_check/core_check.js`
Expected: FAIL（`Board.create is not a function`）

- [ ] **Step 3: 實作**（`static_src/atelier_method_board.js`，全文）

```js
// 煉金術士（atelier）：調和方式①「色彩棋盤」（瑠璃的工房；蘇菲範圍的難度）。
// 規則依據 docs/atelier_design.md §4。純規則，不碰 DOM。
// 介面（所有調和方式共用）：create／canPlace／place／undo／evaluate／preview／done
(function () {
  "use strict";
  var root = typeof window !== "undefined" ? window : globalThis;
  var D = root.PriTestAtelierData;
  var CODE = { f: "fire", i: "ice", b: "bolt", w: "wind", s: "spirit" };

  function shapeOps() { return root.PriTestAtelierCore; }
  function create(recipe, mats, cauldron, ability) {
    var size = cauldron.pattern.length, cells = [];
    cauldron.pattern.forEach(function (row) {
      for (var x = 0; x < row.length; x++) {
        var ch = row[x], low = ch.toLowerCase();
        cells.push({ color: CODE[low] || null, bonus: ch === "*" || (CODE[low] && ch !== low) });
      }
    });
    return { method: "board", recipe: recipe, mats: mats, cauldron: cauldron, ability: ability || {},
      size: size, cells: cells, owner: cells.map(function () { return -1; }),
      placed: mats.map(function () { return false; }), history: [] };
  }
  function footprint(s, mi, x, y, rot) {
    return shapeOps().rotateShape(s.mats[mi].shape, rot).map(function (c) { return [c[0] + x, c[1] + y]; });
  }
  function canPlace(s, mi, x, y, rot) {
    if (mi < 0 || mi >= s.mats.length || s.placed[mi]) return false;
    return footprint(s, mi, x, y, rot).every(function (c) { return c[0] >= 0 && c[1] >= 0 && c[0] < s.size && c[1] < s.size; });
  }
  // 放下素材（可以覆蓋已放的素材，被覆蓋的格子就不再屬於原本的素材）
  function place(s, mi, x, y, rot) {
    if (!canPlace(s, mi, x, y, rot)) return { ok: false };
    var m = s.mats[mi], info = { ok: true, recipe: s.recipe, cells: 0, matchCells: 0, bonusCells: 0, overwritten: 0 };
    s.history.push({ owner: s.owner.slice(), placed: s.placed.slice() });
    footprint(s, mi, x, y, rot).forEach(function (c) {
      var idx = c[1] * s.size + c[0], cell = s.cells[idx];
      if (s.owner[idx] >= 0) info.overwritten++;
      s.owner[idx] = mi;
      info.cells++;
      if (cell.color === m.element) info.matchCells++;
      if (cell.bonus) info.bonusCells++;
    });
    s.placed[mi] = true;
    return info;
  }
  function undo(s) {
    var h = s.history.pop();
    if (!h) return false;
    s.owner = h.owner; s.placed = h.placed;
    return true;
  }
  function done(s) { return s.placed.every(Boolean); }
  // final＝true 時加上「最後一推」
  function evaluate(s, final) {
    var gauges = {}, visible = s.mats.map(function () { return 0; }), byEl = {}, covered = 0;
    D.ELEMENTS.forEach(function (e) { gauges[e.id] = 0; byEl[e.id] = 0; });
    s.owner.forEach(function (o, idx) {
      if (o < 0) return;
      var m = s.mats[o], cell = s.cells[idx], match = cell.color === m.element, add = m.power;
      if (match) add += m.power + (s.ability.matchBonus || 0);
      if (cell.bonus) add += match ? D.BONUS_MATCH : D.BONUS;
      gauges[m.element] += add;
      visible[o]++; byEl[m.element]++; covered++;
    });
    var dominant = null, push = 0;
    if (final && covered > 0) {
      D.ELEMENTS.forEach(function (e) { if (!dominant || byEl[e.id] > byEl[dominant]) dominant = e.id; });
      push = Math.round(gauges[dominant] * (byEl[dominant] / covered) * D.FINAL_PUSH_RATE);
      gauges[dominant] += push;
    }
    var used = s.mats.filter(function (m, i) { return visible[i] > 0; });
    if (!used.length) used = s.mats;
    var avg = used.reduce(function (a, m) { return a + m.quality; }, 0) / used.length;
    var quality = Math.max(1, Math.min(100, Math.round(avg + s.cauldron.qualityPerCell * covered)));
    return { gauges: gauges, visible: visible, covered: covered, dominant: dominant, push: push, quality: quality };
  }
  // O7 放置預覽：不改動 session，回傳放下前後的評估
  function preview(s, mi, x, y, rot) {
    if (!canPlace(s, mi, x, y, rot)) return null;
    var copy = { method: s.method, recipe: s.recipe, mats: s.mats, cauldron: s.cauldron, ability: s.ability, size: s.size,
      cells: s.cells, owner: s.owner.slice(), placed: s.placed.slice(), history: [] };
    var before = evaluate(copy, false), info = place(copy, mi, x, y, rot);
    return { before: before, after: evaluate(copy, done(copy)), info: info, cells: footprint(s, mi, x, y, rot) };
  }

  var impl = { create: create, footprint: footprint, canPlace: canPlace, place: place, undo: undo, done: done, evaluate: evaluate, preview: preview };
  if (typeof module !== "undefined" && module.exports) module.exports = impl;
  else window.PriTestAtelierCore.registerMethod("board", impl);
})();
```

- [ ] **Step 4: 跑測試確認通過**

Run: `node tools/atelier_check/core_check.js`
Expected: 18 passed

- [ ] **Step 5: Commit**

```bash
git add static_src/atelier_method_board.js tools/atelier_check/core_check.js
git commit -m "feat(atelier): 色彩棋盤：形狀、旋轉、覆蓋、同色格、加成格、最後一推、品質、預覽與 Undo"
```

---

### Task 4: 工房主人瑠璃、調和流程、特性成本、任務與反應

**Files:**
- Modify: `static_src/atelier_hosts.js`（換成全文）, `tools/atelier_check/core_check.js`

**Interfaces:**
- Consumes: Task 2 的 `Core.startSynthesis`、`finishSynthesis`、`traitChoices`、`traitsValid`、`currentTask`、`deliver`、`react`；Task 3 的 `Board.*`
- Produces: `window.PriTestAtelierHosts.ruri = { id, color, glyph, name, title, method: "board", ability: {matchBonus: 1}, abilityText, lines: {greet, levelup, bonus, match, overwrite, miss, hint, ok, finish_good, finish_bad, cooldown}, tasks: [5 筆], tutorial: [3 段] }`

- [ ] **Step 1: 寫失敗的測試**（加在 `core_check.js` 最後一行 `console.log` 之前）

```js
// ---------- 調和流程 ----------
function readySave() {
  var s = C.newSave(T0);
  s.mats = [mat(11, "ice", "liquid", [[0, 0], [1, 0]], 60, 3), mat(12, "wind", "plant", [[0, 0], [0, 1]], 60, 3),
    mat(13, "wind", "plant", [[0, 0]], 60, 3)];
  s.mats[0].traits = ["vivid"]; s.mats[1].traits = ["hue_grace", "dusk"];
  s.nextUid = 100;
  return s;
}

test("開始調和：類別不合、冷卻中、等級不足都會被擋下", function () {
  var s = readySave();
  assert.strictEqual(C.startSynthesis(s, "heal", [12, 11, 13], "copper", T0).error, "slot");
  assert.strictEqual(C.startSynthesis(s, "bomb", [11, 12, 13], "copper", T0).error, "recipe");
  s.cooldownUntil = T0 + 1;
  assert.strictEqual(C.startSynthesis(s, "heal", [11, 12, 13], "copper", T0).error, "cooldown");
});

test("完成調和：特性成本上限、成品、扣素材、經驗、冷卻、好感度、最佳紀錄", function () {
  var s = readySave(), ss = C.startSynthesis(s, "heal", [11, 12, 13], "copper", T0);
  assert.strictEqual(ss.method, "board");
  assert.strictEqual(C.finishSynthesis(s, ss, [], T0).error, "unplaced");
  Board.place(ss, 0, 3, 0, 0);   // 冰 2 格：(3,0) 一般、(4,0) 冰色格
  Board.place(ss, 1, 0, 3, 0);   // 風 2 格：(0,3) 一般、(0,4) 風色格
  Board.place(ss, 2, 1, 3, 0);   // 風色加成格
  assert.deepStrictEqual(C.traitChoices(ss).sort(), ["dusk", "hue_grace", "vivid"]);
  assert.strictEqual(C.traitCap(s), 15);
  assert.strictEqual(C.traitsValid(s, ss, ["vivid", "hue_grace"]), false, "12＋10 超過 15");
  assert.strictEqual(C.traitsValid(s, ss, ["vivid", "night"]), false, "沒有的特性不能選");
  assert.strictEqual(C.finishSynthesis(s, ss, ["hue_grace", "dusk"], T0).error, "traits", "10＋6 超過 15");
  var item = C.finishSynthesis(s, ss, ["dusk"], T0);
  assert.strictEqual(item.recipe, "heal");
  assert.strictEqual(s.mats.length, 0);
  assert.strictEqual(s.items.length, 1);
  assert.strictEqual(s.exp, D.EXP_PER_SYNTH);
  assert.strictEqual(s.cooldownUntil, T0 + D.COOLDOWN_MS);
  assert.strictEqual(s.hosts.ruri.aff, D.AFF_PER_SYNTH);
  assert.strictEqual(s.best.heal, item.quality);
  var heal = item.effects[0];
  assert.strictEqual(heal.el, "wind");
  assert(heal.level >= 1);
  assert.strictEqual(heal.n, Math.round(D.RECIPES[0].gauges[0].steps[heal.level - 1].n * 1.1), "黃昏 +10%");
});

test("任務：符合條件才能交貨，交貨後進到下一個任務", function () {
  var s = C.newSave(T0);
  s.items = [{ uid: 5, recipe: "heal", quality: 20, effects: [], traits: [] }, { uid: 6, recipe: "heal", quality: 35, effects: [], traits: [] }];
  assert.strictEqual(C.currentTask(s).id, "r1");
  assert.strictEqual(C.deliver(s, 5), false);
  assert.strictEqual(C.deliver(s, 6), true);
  assert.strictEqual(C.currentTask(s).id, "r2");
  assert.strictEqual(s.hosts.ruri.aff, D.AFF_PER_TASK);
});

test("瑠璃的反應：效果升級 > 加成格 > 同色 > 覆蓋 > 沒對上（好感度高時給提示）", function () {
  var s = C.newSave(T0), r = C.recipe("heal");
  var g0 = { gauges: { wind: 0 } }, g1 = { gauges: { wind: 6 } };
  assert.strictEqual(C.react(s, g0, g1, { recipe: r, cells: 1, matchCells: 0, bonusCells: 0, overwritten: 0 }), "levelup");
  assert.strictEqual(C.react(s, g0, g0, { recipe: r, cells: 2, matchCells: 0, bonusCells: 1, overwritten: 0 }), "bonus");
  assert.strictEqual(C.react(s, g0, g0, { recipe: r, cells: 2, matchCells: 1, bonusCells: 0, overwritten: 0 }), "match");
  assert.strictEqual(C.react(s, g0, g0, { recipe: r, cells: 3, matchCells: 1, bonusCells: 0, overwritten: 1 }), "overwrite");
  assert.strictEqual(C.react(s, g0, g0, { recipe: r, cells: 3, matchCells: 0, bonusCells: 0, overwritten: 0 }), "miss");
  s.hosts.ruri.aff = D.AFF_HINT;
  assert.strictEqual(C.react(s, g0, g0, { recipe: r, cells: 3, matchCells: 0, bonusCells: 0, overwritten: 0 }), "hint");
});

test("資料完整性：每個配方的量表屬性存在、每個工房主人的 method 已登記、台詞都有 zh／ja", function () {
  var els = D.ELEMENTS.map(function (e) { return e.id; });
  D.RECIPES.forEach(function (r) {
    r.gauges.forEach(function (g) { assert(els.indexOf(g.el) >= 0, r.id); });
    r.needs.forEach(function (n) { assert(n === "*" || D.CATEGORIES.indexOf(n) >= 0, r.id + " " + n); });
  });
  Object.keys(global.PriTestAtelierHosts).forEach(function (id) {
    var h = global.PriTestAtelierHosts[id];
    assert(C.method(h.method), id + " method");
    Object.keys(h.lines).forEach(function (k) { h.lines[k].forEach(function (l) { assert(l.zh && l.ja, id + " " + k); }); });
    h.tasks.forEach(function (t) { assert(C.recipe(t.recipe), t.id); });
  });
  Object.keys(D.TRAITS).forEach(function (t) { assert(D.TRAITS[t].cost > 0); });
  D.TIME_TRAITS.concat([{ trait: D.RARITY_TRAIT[2] }, { trait: D.RARITY_TRAIT[3] }, { trait: "vivid" }])
    .forEach(function (t) { assert(D.TRAITS[t.trait], t.trait); });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `node tools/atelier_check/core_check.js`
Expected: FAIL（`Cannot read properties of undefined (reading 'method')`，因為還沒有瑠璃）

- [ ] **Step 3: 實作**（`static_src/atelier_hosts.js`，全文）

```js
// 煉金術士（atelier）：工房主人。第 1 階段只有瑠璃（色彩棋盤派）。
// 新增工房主人時：在這裡加一筆、指定 method（對應 atelier_method_*.js 登記的 id），不改核心。
// 台詞 {zh, ja}；en 沿用 ja（比照其他遊戲資料的 fallback）。
(function () {
  "use strict";
  function L(zh, ja) { return { zh: zh, ja: ja }; }
  var hosts = {
    ruri: {
      id: "ruri", color: "#1E50A2", glyph: "瑠",
      name: { zh: "瑠璃", ja: "瑠璃", en: "Ruri" },
      title: L("色彩棋盤派", "色彩盤派"),
      method: "board",
      ability: { matchBonus: 1 },           // 同色格每格再 +1
      abilityText: L("同色格的加成每格再 +1。", "同じ色のマスの加算が 1 マスごとに +1。"),
      lines: {
        greet: [L("歡迎來到我的工房。今天想調和什麼？", "わたしのアトリエへようこそ。今日は何を調合する？"),
          L("外面的顏色，帶回來了嗎？", "外の色、持って帰ってきた？")],
        levelup: [L("啊，效果升級了！", "あっ、効果が上がった！"), L("就是這樣，很漂亮。", "そう、それ。きれい。")],
        bonus: [L("放在發光的格子上，很聰明。", "光ってるマスに置いたね、さすが。")],
        match: [L("顏色對上了，釜裡的光變強了。", "色がそろった。釜の光が強くなったよ。")],
        overwrite: [L("蓋掉前面的素材了……這樣好嗎？", "前の素材を上書きしちゃった……いいの？")],
        miss: [L("嗯……顏色好像不太合。", "うーん……色が合ってないみたい。")],
        hint: [L("試試把它轉個方向，放到同色的格子上？", "向きを変えて、同じ色のマスに置いてみたら？")],
        ok: [L("嗯，慢慢來。", "うん、ゆっくりでいいよ。")],
        finish_good: [L("好棒的成品！可以拿去交貨了。", "いい出来！納品できるね。")],
        finish_bad: [L("下次一定能做得更好。", "次はもっと上手にできるよ。")],
        cooldown: [L("大釜還在冷卻，先去採色吧。", "大釜はまだ冷めてないよ。先に色を集めてきて。")]
      },
      // 專屬任務（依序解鎖）
      tasks: [
        { id: "r1", recipe: "heal", minQuality: 30, minLevel: 0, exp: 40, text: L("先做一瓶治癒藥水給我看看。", "まずはいやしの薬を一つ見せて。") },
        { id: "r2", recipe: "ink", minQuality: 40, minLevel: 1, exp: 50, text: L("我需要能用的色彩墨水，效果至少 Lv1。", "使える色インクがほしいな。効果 Lv1 以上で。") },
        { id: "r3", recipe: "neutral", minQuality: 50, minLevel: 1, exp: 60, text: L("中和劑，品質 50 以上。", "中和剤、品質 50 以上でお願い。") },
        { id: "r4", recipe: "heal", minQuality: 60, minLevel: 2, exp: 80, text: L("治癒藥水，回復效果 Lv2。試試最後一推。", "いやしの薬、回復 Lv2 で。最後のひと押しを狙ってみて。") },
        { id: "r5", recipe: "bomb", minQuality: 60, minLevel: 2, exp: 100, text: L("色彩炸彈……小心一點喔。", "いろどり爆弾……気をつけてね。") }
      ],
      // B16 教學（前 3 次調和時顯示）
      tutorial: [
        L("先選配方，再依格子要求放入素材。素材的形狀，是你拍到的色塊形狀。", "レシピを選んで、枠に合う素材を入れてね。素材の形は、撮った色のかたち。"),
        L("把素材放到同色的格子上，量表會漲得更多；發光的格子還有加成。按「旋轉」可以改變方向。", "同じ色のマスに置くとゲージが大きく伸びるよ。光るマスはボーナス。「回転」で向きを変えられる。"),
        L("全部放完後，佔最多格的屬性會再加一次，這叫「最後一推」。", "全部置いたら、一番多い属性がもう一度加算される。これが「最後のひと押し」。")
      ]
    }
  };
  if (typeof module !== "undefined" && module.exports) module.exports = hosts;
  else window.PriTestAtelierHosts = hosts;
})();
```

- [ ] **Step 4: 跑測試確認通過**

Run: `node tools/atelier_check/core_check.js`
Expected: 23 passed

- [ ] **Step 5: Commit**

```bash
git add static_src/atelier_hosts.js tools/atelier_check/core_check.js
git commit -m "feat(atelier): 工房主人瑠璃：能力、台詞、任務、教學；調和流程與特性成本上限"
```

---

### Task 5: 相機與取色來源

**Files:**
- Modify: `static_src/atelier_camera.js`（換成全文）

**Interfaces:**
- Consumes: `PriTestAtelierData.SRC_SIZE`、`PriTestAtelierCore.makeRng`
- Produces: 「介面」一節的 `Camera.*`

- [ ] **Step 1: 實作**（全文；只會在瀏覽器執行，由 Task 6 的畫面檢查一併驗證）

```js
// 煉金術士（atelier）：相機與取色來源。只負責把畫面變成 SRC_SIZE×SRC_SIZE 的 RGBA，分析交給 atelier_core.js。
// 不保存任何影像（隱私）；照片只在記憶體中縮成 32×32 後就丟掉。
(function () {
  "use strict";
  var D = window.PriTestAtelierData;
  var stream = null;

  function supported() { return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia); }
  // 開後鏡頭；iOS 需要 playsinline + muted 才能在頁面內播放
  function open(video) {
    return navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false }).then(function (s) {
      stream = s;
      video.setAttribute("playsinline", "");
      video.muted = true;
      video.srcObject = s;
      return video.play();
    });
  }
  function close(video) {
    if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
    stream = null;
    if (video) video.srcObject = null;
  }
  function isOpen() { return !!stream; }
  // 取中央正方形，縮成 N×N
  function sample(src, sw, sh) {
    var N = D.SRC_SIZE, c = document.createElement("canvas");
    c.width = N; c.height = N;
    var g = c.getContext("2d"), side = Math.min(sw, sh);
    g.drawImage(src, (sw - side) / 2, (sh - side) / 2, side, side, 0, 0, N, N);
    return g.getImageData(0, 0, N, N).data;
  }
  function grab(video) { return sample(video, video.videoWidth, video.videoHeight); }
  function fromFile(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(sample(img, img.naturalWidth, img.naturalHeight)); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("image")); };
      img.src = url;
    });
  }
  // B17 色彩散步：沒有相機時，用 seed 畫出隨機的色塊風景
  function walkScene(seed) {
    var rng = window.PriTestAtelierCore.makeRng("walk:" + seed), N = D.SRC_SIZE, c = document.createElement("canvas");
    c.width = N; c.height = N;
    var g = c.getContext("2d");
    function hsl() { return "hsl(" + Math.floor(rng() * 360) + "," + Math.floor(30 + rng() * 60) + "%," + Math.floor(25 + rng() * 55) + "%)"; }
    g.fillStyle = hsl(); g.fillRect(0, 0, N, N);
    var n = 2 + Math.floor(rng() * 3);
    for (var i = 0; i < n; i++) {
      g.fillStyle = hsl();
      var w = 6 + Math.floor(rng() * 16), h = 6 + Math.floor(rng() * 16);
      g.fillRect(Math.floor(rng() * (N - w)), Math.floor(rng() * (N - h)), w, h);
    }
    return { rgba: g.getImageData(0, 0, N, N).data, url: c.toDataURL() };
  }

  window.PriTestAtelierCamera = { supported: supported, open: open, close: close, isOpen: isOpen, grab: grab, fromFile: fromFile, walkScene: walkScene };
})();
```

- [ ] **Step 2: 語法檢查**

Run: `node --check static_src/atelier_camera.js`
Expected: 沒有輸出

- [ ] **Step 3: Commit**

```bash
git add static_src/atelier_camera.js
git commit -m "feat(atelier): 相機、圖片與色彩散步的取色來源（不保存影像）"
```

---

### Task 6: 畫面、存檔與畫面檢查

**Files:**
- Modify: `static_src/atelier.js`（換成全文）
- Create: `tools/atelier_check/ui_check.js`

**Interfaces:**
- Consumes: Task 2～5 的全部介面；`window.I18N.t／getLang／setLang` 與 `i18n:change` 事件
- Produces: `window.PriTestAtelier = { _debugState, _debugUi }`

- [ ] **Step 1: 寫失敗的畫面檢查**（`tools/atelier_check/ui_check.js`，port 8973）

```js
// 煉金術士（atelier）Playwright 流程檢查：
//   清空存檔 → 從圖片取色（左瑠璃色、右若竹色）→ 選 2 色採集 → 再採 1 色（採集籃 6→4）
//   → 調和：教學台詞 → 選治癒藥水 → 依格子要求選素材 → 棋盤：點一次預覽、再點一次放下 → Undo → 放完
//   → 最後一推 → 選特性 → 完成 → 成品、扣素材、冷卻 → 開發面板跳過冷卻 → 委託交貨
//   → 語言切換 → 手機寬度不橫向捲動 → 沒有 console error
// 前置：py -3 generate.py ； py -3 -m http.server 8973 --directory dist
// 執行：node tools/atelier_check/ui_check.js
// 注意（CLAUDE.md §4.6）：HUD 會整個重繪，一律用 dispatchEvent 觸發，不用 page.click。
"use strict";
var path = require("path"), assert = require("assert");
var chromium = require(require.resolve("playwright", { paths: [path.join(__dirname, "..", "midnight_check")] })).chromium;
var BASE = (process.env.ATELIER_ROOT || "http://localhost:8973/") + "atelier/index.html";

(async function () {
  var browser = await chromium.launch();
  var page = await browser.newPage({ viewport: { width: 375, height: 800 } }), errors = [];
  page.on("pageerror", function (e) { errors.push(String(e)); });
  page.on("console", function (m) { if (m.type() === "error") errors.push(m.text()); });
  async function state() { return page.evaluate(function () { return JSON.parse(JSON.stringify(window.PriTestAtelier._debugState())); }); }
  async function tap(sel) { await page.dispatchEvent(sel, "click"); }

  await page.goto(BASE);
  await page.evaluate(function () { localStorage.removeItem("pritest-atelier-save-v1"); });
  await page.reload();
  var s = await state();
  assert.strictEqual(s.mats.length, 0);
  assert.strictEqual(s.basket.n, 6);

  // 測試圖片：左半瑠璃色（冰／液體）、右半若竹色（風／植物）
  var png = await page.evaluate(function () {
    var c = document.createElement("canvas"); c.width = 64; c.height = 64;
    var g = c.getContext("2d");
    g.fillStyle = "#1E50A2"; g.fillRect(0, 0, 32, 64);
    g.fillStyle = "#68BE8D"; g.fillRect(32, 0, 32, 64);
    return c.toDataURL("image/png").split(",")[1];
  });
  var file = { name: "two.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") };
  async function uploadAndPick(n) {
    await page.setInputFiles("#at-file", file);
    await page.waitForSelector("#at-swatches");
    for (var i = 0; i < n; i++) await tap('[data-at-pick="' + i + '"]');
    await tap("#at-collect");
  }
  await uploadAndPick(2);
  await uploadAndPick(1);
  s = await state();
  assert.strictEqual(s.mats.length, 3);
  assert.strictEqual(s.basket.n, 4);
  var cats = s.mats.map(function (m) { return m.category; }).sort();
  assert(cats.indexOf("liquid") >= 0 && cats.indexOf("plant") >= 0, "應有液體與植物：" + cats);
  assert(s.mats.some(function (m) { return m.colorId === "ruri"; }), "瑠璃色應配對到傳統色 ruri");

  // 調和：教學、選配方、選素材
  await tap('[data-at-tab="lab"]');
  assert(await page.$("#at-line.at-tutorial"), "前 3 次調和要顯示教學");
  await tap('[data-at-recipe="heal"]');
  var liquid = s.mats.filter(function (m) { return m.category === "liquid"; })[0].uid;
  var plant = s.mats.filter(function (m) { return m.category === "plant"; })[0].uid;
  var other = s.mats.filter(function (m) { return m.uid !== liquid && m.uid !== plant; })[0].uid;
  await page.selectOption('[data-at-slot="0"]', String(liquid));
  await page.selectOption('[data-at-slot="1"]', String(plant));
  await page.selectOption('[data-at-slot="2"]', String(other));
  await tap("#at-start");
  await page.waitForSelector("#at-board");

  // 找一個放得下的位置：點一次預覽（出現虛線），再點一次放下
  async function placeSelected() {
    var pos = await page.evaluate(function () {
      var ui = window.PriTestAtelier._debugUi(), s = ui.session, B = window.PriTestAtelierCore.method(s.method);
      for (var y = 0; y < s.size; y++) for (var x = 0; x < s.size; x++) if (B.canPlace(s, ui.sel, x, y, ui.rot)) return x + "," + y;
      return null;
    });
    assert(pos, "應有可放置的位置");
    await tap('[data-at-cell="' + pos + '"]');
    assert(await page.$(".at-ghost"), "第 1 次點擊應出現預覽");
    await tap('[data-at-cell="' + pos + '"]');
  }
  await tap("#at-rot");
  await placeSelected();
  var placed = await page.evaluate(function () { return window.PriTestAtelier._debugUi().session.placed.slice(); });
  assert.deepStrictEqual(placed, [true, false, false]);
  await tap("#at-undo");
  placed = await page.evaluate(function () { return window.PriTestAtelier._debugUi().session.placed.slice(); });
  assert.deepStrictEqual(placed, [false, false, false]);
  for (var k = 0; k < 3; k++) await placeSelected();
  await page.waitForSelector("#at-traits");
  assert(await page.$("#at-push"), "放完後要顯示最後一推");
  var trait = await page.$("[data-at-trait]");
  if (trait) await page.check("[data-at-trait]");
  await tap("#at-finish");
  await page.waitForSelector("#at-result");
  s = await state();
  assert.strictEqual(s.items.length, 1);
  assert.strictEqual(s.mats.length, 0);
  assert(s.cooldownUntil > Date.now());
  assert.strictEqual(s.tutorial, 1);
  assert.strictEqual(s.hosts.ruri.aff, 2);

  // 冷卻中 → 開發面板跳過
  await tap("#at-result-close");
  await page.waitForSelector("#at-cooldown");
  await tap("#at-dev-cool");
  await page.waitForSelector("#at-recipes");

  // 委託：品質 30 以上的治癒藥水可以交貨
  await tap('[data-at-tab="tasks"]');
  var itemQ = s.items[0].quality, uid = s.items[0].uid;
  var btn = '[data-at-deliver="' + uid + '"]';
  if (itemQ >= 30) {
    await tap(btn);
    s = await state();
    assert.strictEqual(s.hosts.ruri.task, 1);
    assert.strictEqual(s.items.length, 0);
  } else {
    assert(await page.$eval(btn, function (b) { return b.disabled; }), "品質不足不能交貨");
  }

  // 語言切換
  await page.evaluate(function () { window.I18N.setLang("ja"); });
  assert.strictEqual((await page.textContent('[data-at-tab="gather"]')).trim(), "色あつめ");
  await page.evaluate(function () { window.I18N.setLang("zh"); });

  // 手機寬度不橫向捲動
  var over = await page.evaluate(function () { return document.documentElement.scrollWidth - document.documentElement.clientWidth; });
  assert(over <= 0, "橫向捲動 " + over + "px");

  // 色彩散步（沒有相機時）
  await tap('[data-at-tab="gather"]');
  await tap("#at-walk");
  await page.waitForSelector("#at-swatches");
  assert(await page.$("#at-scene"));

  assert.deepStrictEqual(errors, []);
  await browser.close();
  console.log("ui_check ok");
})().catch(function (e) { console.error(e); process.exit(1); });
```

- [ ] **Step 2: 跑檢查確認失敗**

Run: `py -3 generate.py`，另開一個終端機執行 `py -3 -m http.server 8973 --directory dist`，然後 `node tools/atelier_check/ui_check.js`
Expected: FAIL（`window.PriTestAtelier` 是 undefined）

- [ ] **Step 3: 實作畫面**（`static_src/atelier.js`，全文）

```js
// 煉金術士（atelier）：畫面、存檔、相機操作。規則全部在 atelier_core.js／atelier_method_board.js。
(function () {
  "use strict";
  var D = window.PriTestAtelierData, C = window.PriTestAtelierCore, H = window.PriTestAtelierHosts;
  var CAM = window.PriTestAtelierCamera, COLORS = window.PriTestAtelierColors;
  var KEY = "pritest-atelier-save-v1";
  var app = document.getElementById("at-app");
  if (!app) return;

  var save = load();
  var ui = { tab: "gather", swatches: null, picks: [], scene: null, recipe: null, slots: [], session: null,
    sel: -1, rot: 0, ghost: null, traits: [], result: null, line: null, dev: false, resetArm: false, msg: "" };

  // ---------- 共用 ----------
  function now() { return Date.now() + (save.offsetMs || 0); }
  function lang() { return (window.I18N && window.I18N.getLang && window.I18N.getLang()) || "zh"; }
  function t(k, p) { return window.I18N ? window.I18N.t(k, p) : k; }
  function loc(o) { var l = lang(); return o[l] || (l === "en" && o.ja) || o.zh || o.ja || ""; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function el(id) { for (var i = 0; i < D.ELEMENTS.length; i++) if (D.ELEMENTS[i].id === id) return D.ELEMENTS[i]; return null; }
  function colorOf(id) { for (var i = 0; i < COLORS.length; i++) if (COLORS[i].id === id) return COLORS[i]; return null; }
  function host() { return H[save.host]; }
  function say(key) { var arr = host().lines[key] || host().lines.ok; ui.line = arr[Math.floor(Math.random() * arr.length)]; }
  function load() {
    try {
      var s = JSON.parse(localStorage.getItem(KEY));
      if (s && s.v === 1 && Array.isArray(s.mats)) return s;
    } catch (e) { /* 壞檔就重建 */ }
    return C.newSave(Date.now());
  }
  function persist() { try { localStorage.setItem(KEY, JSON.stringify(save)); } catch (e) { /* 容量不足時只保留記憶體中的狀態 */ } }

  // 素材形狀的小圖（色覺友善：同時顯示屬性圖形）
  function shapeHtml(m, cls) {
    var w = 0, h = 0;
    m.shape.forEach(function (c) { w = Math.max(w, c[0] + 1); h = Math.max(h, c[1] + 1); });
    var on = {}; m.shape.forEach(function (c) { on[c[0] + "," + c[1]] = true; });
    var out = '<span class="at-shape ' + (cls || "") + '" style="grid-template-columns:repeat(' + w + ',1fr)">';
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++)
      out += on[x + "," + y] ? '<i style="background:' + m.hex + '">' + el(m.element).icon + "</i>" : "<i class=\"at-off\"></i>";
    return out + "</span>";
  }
  function matHtml(m) {
    var c = colorOf(m.colorId), e = el(m.element);
    return '<span class="at-mat-name">' + esc(loc(c.name)) + "</span>" +
      '<span class="at-tag" style="border-color:' + e.color + '">' + e.icon + " " + t("at_el_" + m.element) + "</span>" +
      '<span class="at-tag">' + t("at_cat_" + m.category) + "</span>" +
      '<span class="at-tag">' + t("at_quality", { n: m.quality }) + "</span>" +
      '<span class="at-tag">' + t("at_power", { n: m.power }) + "</span>" +
      m.traits.map(function (tr) { return '<span class="at-tag at-trait">' + esc(loc(D.TRAITS[tr].name)) + "</span>"; }).join("");
  }
  function fxText(e) { return e.kind ? t("at_fx_" + e.kind, { n: e.n }) : t("at_fx_none"); }

  // ---------- 畫面 ----------
  function render() {
    C.refillBasket(save, now());
    var h = host(), hs = save.hosts[save.host];
    var tutorial = ui.tab === "lab" && save.tutorial < h.tutorial.length ? h.tutorial[save.tutorial] : null;
    var line = tutorial || ui.line || h.lines.greet[0];
    var html = '<header class="at-head">' +
      '<div class="at-avatar" style="background:' + h.color + '">' + h.glyph + "</div>" +
      '<div class="at-who"><b>' + esc(loc(h.name)) + "</b> <small>" + esc(loc(h.title)) + "</small><br><small>" +
      t("at_level", { n: C.level(save) }) + "・" + t("at_aff", { n: hs.aff }) + "</small></div>" +
      '<p id="at-line" class="at-bubble' + (tutorial ? " at-tutorial" : "") + '">' + esc(loc(line)) + "</p></header>" +
      '<nav class="at-tabs">' + ["gather", "box", "lab", "tasks"].map(function (k) {
        return '<button type="button" data-at-tab="' + k + '" class="' + (ui.tab === k ? "at-on" : "") + '">' + t("at_tab_" + k) + "</button>";
      }).join("") + "</nav>";
    if (ui.msg) html += '<p class="at-msg" id="at-msg">' + esc(ui.msg) + "</p>";
    html += '<section class="at-body">' + ({ gather: renderGather, box: renderBox, lab: renderLab, tasks: renderTasks })[ui.tab]() + "</section>";
    html += renderDev();
    var video = app.querySelector("#at-video");
    app.innerHTML = html;
    // 相機播放中時保留同一個 <video>，避免每次重繪都斷線
    var slot = app.querySelector("#at-video-slot");
    if (slot) {
      if (!video) { video = document.createElement("video"); video.id = "at-video"; video.className = "at-video"; }
      slot.appendChild(video);
      if (CAM.isOpen() && video.paused) video.play().catch(function () { /* 重新掛上後自動播放失敗時，等使用者再按一次 */ });
    }
  }

  function renderGather() {
    var b = save.basket, mins = b.n >= D.BASKET_MAX ? 0 : Math.ceil((b.at + D.BASKET_REFILL_MS - now()) / 60000);
    var out = '<p class="at-basket" id="at-basket">' + t("at_basket", { n: b.n, max: D.BASKET_MAX }) +
      (mins > 0 ? "　" + t("at_basket_next", { m: mins }) : "") + "</p>" +
      '<div id="at-video-slot" class="at-video-slot' + (CAM.isOpen() ? "" : " at-hidden") + '"><span class="at-reticle"></span></div>' +
      '<div class="at-row">' +
      (CAM.supported() ? (CAM.isOpen()
        ? '<button type="button" id="at-cam-shot" class="at-main">' + t("at_cam_shot") + '</button><button type="button" id="at-cam-close">' + t("at_cam_close") + "</button>"
        : '<button type="button" id="at-cam-open" class="at-main">' + t("at_cam_open") + "</button>") : "") +
      '<label class="at-file">' + t("at_upload") + '<input type="file" id="at-file" accept="image/*"></label>' +
      '<button type="button" id="at-walk">' + t("at_walk") + "</button></div>";
    if (ui.scene) out += '<img class="at-scene" id="at-scene" alt="" src="' + ui.scene + '">';
    if (ui.swatches) {
      out += '<p class="at-hint">' + t("at_pick_hint", { n: D.PICK_MAX }) + '</p><ul class="at-swatches" id="at-swatches">';
      ui.swatches.forEach(function (s, i) {
        var m = C.makeMaterial(s, now(), 0), on = ui.picks.indexOf(i) >= 0;
        out += '<li><button type="button" data-at-pick="' + i + '" class="at-swatch' + (on ? " at-on" : "") + '">' +
          '<span class="at-chip" style="background:' + s.hex + '"></span>' + shapeHtml(m) + matHtml(m) +
          '<span class="at-tag">' + Math.round(s.frac * 100) + "%</span></button></li>";
      });
      out += '</ul><button type="button" id="at-collect" class="at-main"' + (ui.picks.length && b.n > 0 ? "" : " disabled") + ">" + t("at_collect") + "</button>";
    }
    return out;
  }

  function renderBox() {
    var out = "<h3>" + t("at_tab_box") + " (" + save.mats.length + "/" + D.MAT_MAX + ')</h3><ul class="at-list" id="at-mats">';
    if (!save.mats.length) out += "<li>" + t("at_box_empty") + "</li>";
    save.mats.forEach(function (m) { out += '<li data-at-uid="' + m.uid + '">' + shapeHtml(m) + matHtml(m) + "</li>"; });
    out += "</ul><h3>" + t("at_items") + '</h3><ul class="at-list" id="at-items">';
    if (!save.items.length) out += "<li>" + t("at_items_empty") + "</li>";
    save.items.forEach(function (it) { out += "<li>" + itemHtml(it) + "</li>"; });
    return out + "</ul>";
  }
  function itemHtml(it) {
    return '<span class="at-mat-name">' + esc(loc(C.recipe(it.recipe).name)) + "</span>" +
      '<span class="at-tag">' + t("at_quality", { n: it.quality }) + "</span>" +
      it.effects.map(function (e) { return '<span class="at-tag" style="border-color:' + el(e.el).color + '">' + el(e.el).icon + " " + esc(fxText(e)) + "</span>"; }).join("") +
      it.traits.map(function (tr) { return '<span class="at-tag at-trait">' + esc(loc(D.TRAITS[tr].name)) + "</span>"; }).join("");
  }

  function renderLab() {
    if (ui.result) {
      return '<div id="at-result" class="at-result"><h3>' + t("at_result") + "</h3><p>" + itemHtml(ui.result) + "</p><p>" +
        t("at_best", { n: save.best[ui.result.recipe] }) + '</p><button type="button" id="at-result-close" class="at-main">' + t("at_back") + "</button></div>";
    }
    if (ui.session) return renderBoard();
    var left = save.cooldownUntil - now();
    if (left > 0) return '<p id="at-cooldown" class="at-cooldown">' + t("at_cooldown", { m: Math.ceil(left / 60000) }) + "</p>";
    if (!ui.recipe) {
      return "<h3>" + t("at_recipes") + '</h3><ul class="at-list" id="at-recipes">' + D.RECIPES.map(function (r) {
        var locked = r.lv > C.level(save);
        return '<li><button type="button" data-at-recipe="' + r.id + '"' + (locked ? " disabled" : "") + ">" + esc(loc(r.name)) +
          (locked ? " — " + t("at_recipe_locked", { n: r.lv }) : (save.best[r.id] ? " — " + t("at_best", { n: save.best[r.id] }) : "")) + "</button></li>";
      }).join("") + "</ul>";
    }
    var r = C.recipe(ui.recipe), out = "<h3>" + esc(loc(r.name)) + '</h3><div id="at-slots">';
    r.needs.forEach(function (need, i) {
      out += '<label class="at-slot">' + t("at_slot", { n: i + 1, need: need === "*" ? t("at_any") : t("at_cat_" + need) }) +
        '<select data-at-slot="' + i + '"><option value="">' + t("at_choose") + "</option>";
      save.mats.forEach(function (m) {
        if (!C.slotOk(need, m)) return;
        var usedElsewhere = ui.slots.some(function (u, j) { return j !== i && u === m.uid; });
        if (usedElsewhere) return;
        out += '<option value="' + m.uid + '"' + (ui.slots[i] === m.uid ? " selected" : "") + ">" +
          esc(loc(colorOf(m.colorId).name)) + " / " + el(m.element).icon + " / " + t("at_quality", { n: m.quality }) + " / " + t("at_cells", { n: m.shape.length }) + "</option>";
      });
      out += "</select></label>";
    });
    var ready = r.needs.every(function (n, i) { return ui.slots[i]; });
    return out + '</div><div class="at-row"><button type="button" id="at-back">' + t("at_back") + '</button><button type="button" id="at-start" class="at-main"' +
      (ready ? "" : " disabled") + ">" + t("at_start") + "</button></div>";
  }

  function renderBoard() {
    var s = ui.session, impl = C.method(s.method), ghost = ui.ghost;
    var ev = ghost ? ghost.after : impl.evaluate(s, impl.done(s));
    var ghostSet = {}; if (ghost) ghost.cells.forEach(function (c) { ghostSet[c[0] + "," + c[1]] = true; });
    var out = '<div class="at-board" id="at-board" style="grid-template-columns:repeat(' + s.size + ',1fr)">';
    for (var y = 0; y < s.size; y++) for (var x = 0; x < s.size; x++) {
      var idx = y * s.size + x, cell = s.cells[idx], o = s.owner[idx], cls = "at-cell";
      var bg = cell.color ? el(cell.color).color : "";
      var inner = cell.color ? el(cell.color).icon : "";
      if (cell.bonus) cls += " at-bonus";
      if (o >= 0) { cls += " at-filled"; bg = s.mats[o].hex; inner = el(s.mats[o].element).icon; }
      if (ghostSet[x + "," + y]) cls += " at-ghost";
      out += '<button type="button" class="' + cls + '" data-at-cell="' + x + "," + y + '" style="--at-c:' + (bg || "var(--at-line)") + '">' + inner + "</button>";
    }
    out += '</div><ul class="at-gauges" id="at-gauges">';
    C.effectLevels(s.recipe, ev.gauges).forEach(function (g) {
      var e = el(g.el), val = ev.gauges[g.el], top = s.recipe.gauges.filter(function (x) { return x.el === g.el; })[0].steps.slice(-1)[0].at;
      out += '<li><span style="color:' + e.color + '">' + e.icon + " " + t("at_el_" + g.el) + "</span> " +
        '<meter min="0" max="' + top + '" value="' + Math.min(val, top) + '"></meter> <b>' + val + "</b> Lv" + g.level +
        " <small>" + (g.next ? t("at_gauge_next", { n: g.next }) : t("at_gauge_max")) + "</small></li>";
    });
    out += "</ul>";
    if (ev.push) out += '<p class="at-push" id="at-push">' + t("at_final_push", { el: t("at_el_" + ev.dominant), n: ev.push }) + "</p>";
    out += '<p class="at-hint">' + t("at_quality", { n: ev.quality }) + "　" + t("at_tap_hint") + "</p>";
    if (!impl.done(s)) {
      out += '<div class="at-tray" id="at-tray">' + s.mats.map(function (m, i) {
        if (s.placed[i]) return "";
        var shown = { shape: C.rotateShape(m.shape, i === ui.sel ? ui.rot : 0), hex: m.hex, element: m.element };
        return '<button type="button" data-at-mat="' + i + '" class="' + (i === ui.sel ? "at-on" : "") + '">' + shapeHtml(shown) + "</button>";
      }).join("") + "</div>";
    }
    out += '<div class="at-row"><button type="button" id="at-rot"' + (ui.sel < 0 ? " disabled" : "") + ">" + t("at_rotate") + "</button>" +
      '<button type="button" id="at-undo"' + (s.history.length ? "" : " disabled") + ">" + t("at_undo") + "</button>" +
      '<button type="button" id="at-abort">' + t("at_back") + "</button></div>";
    if (impl.done(s)) {
      var choices = C.traitChoices(s), used = ui.traits.reduce(function (a, k) { return a + D.TRAITS[k].cost; }, 0);
      out += '<div id="at-traits"><p>' + t("at_traits", { used: used, cap: C.traitCap(save), max: D.MAX_TRAITS }) + "</p>" +
        choices.map(function (k) {
          return '<label class="at-tag"><input type="checkbox" data-at-trait="' + k + '"' + (ui.traits.indexOf(k) >= 0 ? " checked" : "") + "> " +
            esc(loc(D.TRAITS[k].name)) + " (" + D.TRAITS[k].cost + ")</label>";
        }).join("") + '</div><button type="button" id="at-finish" class="at-main"' +
        (C.traitsValid(save, s, ui.traits) ? "" : " disabled") + ">" + t("at_finish") + "</button>";
    }
    return out;
  }

  function renderTasks() {
    var task = C.currentTask(save);
    if (!task) return '<p id="at-task">' + t("at_task_done") + "</p>";
    var out = '<div id="at-task"><h3>' + t("at_task_now") + "</h3><p>" + esc(loc(task.text)) + "</p><p><small>" +
      t("at_task_need", { recipe: loc(C.recipe(task.recipe).name), q: task.minQuality }) +
      (task.minLevel ? t("at_task_lv", { n: task.minLevel }) : "") + '</small></p></div><ul class="at-list">';
    save.items.forEach(function (it) {
      var ok = C.taskMet(task, it);
      out += "<li>" + itemHtml(it) + ' <button type="button" data-at-deliver="' + it.uid + '"' + (ok ? "" : " disabled") + ">" + t("at_deliver") + "</button></li>";
    });
    return out + "</ul>";
  }

  function renderDev() {
    var out = '<details class="at-dev"' + (ui.dev ? " open" : "") + '><summary id="at-dev-toggle">' + t("at_dev") + "</summary>" +
      '<button type="button" id="at-dev-time">' + t("at_dev_time") + '</button><button type="button" id="at-dev-cool">' + t("at_dev_cool") + "</button>" +
      '<button type="button" id="at-reset">' + t(ui.resetArm ? "at_reset_confirm" : "at_reset") + "</button></details>";
    return out;
  }

  // ---------- 操作 ----------
  function showSwatches(rgba, sceneUrl) {
    ui.swatches = C.analyze(rgba, D.SRC_SIZE, D.SRC_SIZE, String(now()));
    ui.picks = []; ui.scene = sceneUrl || null; ui.msg = "";
    render();
  }
  function startSession() {
    var res = C.startSynthesis(save, ui.recipe, ui.slots.slice(), "copper", now());
    if (res.error) { ui.msg = t("at_err_" + res.error); say(res.error === "cooldown" ? "cooldown" : "miss"); render(); return; }
    ui.session = res; ui.sel = 0; ui.rot = 0; ui.ghost = null; ui.traits = []; ui.msg = "";
    render();
  }
  function tapCell(x, y) {
    var s = ui.session, impl = C.method(s.method);
    if (ui.sel < 0) return;
    if (ui.ghost && ui.ghost.x === x && ui.ghost.y === y) {   // 第 2 次點同一格：放下
      var before = impl.evaluate(s, false), info = impl.place(s, ui.sel, x, y, ui.rot);
      if (info.ok) {
        say(C.react(save, before, impl.evaluate(s, impl.done(s)), info));
        ui.sel = s.placed.indexOf(false); ui.rot = 0;
      }
      ui.ghost = null;
    } else {
      var p = impl.preview(s, ui.sel, x, y, ui.rot);
      ui.ghost = p ? { x: x, y: y, cells: p.cells, after: p.after } : null;
    }
    render();
  }

  app.addEventListener("click", function (ev) {
    var b = ev.target.closest("button, summary");
    if (!b || b.disabled) return;
    var d = b.dataset, s = ui.session;
    if (d.atTab) { ui.tab = d.atTab; ui.msg = ""; if (ui.tab !== "gather") CAM.close(app.querySelector("#at-video")); render(); return; }
    if (b.id === "at-cam-open") {
      CAM.open(app.querySelector("#at-video")).then(render, function () { ui.msg = t("at_cam_denied"); render(); });
      render(); return;
    }
    if (b.id === "at-cam-close") { CAM.close(app.querySelector("#at-video")); render(); return; }
    if (b.id === "at-cam-shot") { showSwatches(CAM.grab(app.querySelector("#at-video"))); return; }
    if (b.id === "at-walk") { var w = CAM.walkScene(now()); showSwatches(w.rgba, w.url); return; }
    if (d.atPick !== undefined) {
      var i = +d.atPick, at = ui.picks.indexOf(i);
      if (at >= 0) ui.picks.splice(at, 1); else if (ui.picks.length < D.PICK_MAX) ui.picks.push(i);
      render(); return;
    }
    if (b.id === "at-collect") {
      var got = C.capture(save, ui.picks.map(function (k) { return ui.swatches[k]; }), now());
      if (!got) ui.msg = t(save.basket.n <= 0 ? "at_collect_fail_basket" : "at_collect_fail_full");
      else { ui.swatches = null; ui.scene = null; ui.picks = []; ui.msg = t("at_collect_ok", { n: got.length }); persist(); }
      render(); return;
    }
    if (d.atRecipe) { ui.recipe = d.atRecipe; ui.slots = []; render(); return; }
    if (b.id === "at-back") { ui.recipe = null; ui.slots = []; render(); return; }
    if (b.id === "at-start") { startSession(); return; }
    if (d.atCell) { var xy = d.atCell.split(","); tapCell(+xy[0], +xy[1]); return; }
    if (d.atMat !== undefined) { ui.sel = +d.atMat; ui.rot = 0; ui.ghost = null; render(); return; }
    if (b.id === "at-rot") {
      ui.rot = (ui.rot + 1) % 4;
      if (ui.ghost) { var p = C.method(s.method).preview(s, ui.sel, ui.ghost.x, ui.ghost.y, ui.rot); ui.ghost = p ? { x: ui.ghost.x, y: ui.ghost.y, cells: p.cells, after: p.after } : null; }
      render(); return;
    }
    if (b.id === "at-undo") { C.method(s.method).undo(s); ui.sel = s.placed.indexOf(false); ui.rot = 0; ui.ghost = null; ui.traits = []; render(); return; }
    if (b.id === "at-abort") { ui.session = null; ui.ghost = null; render(); return; }
    if (b.id === "at-finish") {
      var item = C.finishSynthesis(save, s, ui.traits, now());
      if (item.error) { ui.msg = t("at_err_" + item.error); render(); return; }
      ui.result = item; ui.session = null; ui.recipe = null; ui.slots = [];
      say(item.quality >= 50 ? "finish_good" : "finish_bad");
      persist(); render(); return;
    }
    if (b.id === "at-result-close") { ui.result = null; render(); return; }
    if (d.atDeliver) { if (C.deliver(save, +d.atDeliver)) { say("finish_good"); persist(); } render(); return; }
    if (b.id === "at-dev-toggle") { ui.dev = !ui.dev; return; }
    if (b.id === "at-dev-time") { save.offsetMs = (save.offsetMs || 0) + 20 * 60000; persist(); render(); return; }
    if (b.id === "at-dev-cool") { save.cooldownUntil = 0; persist(); render(); return; }
    if (b.id === "at-reset") {
      if (!ui.resetArm) { ui.resetArm = true; render(); return; }
      try { localStorage.removeItem(KEY); } catch (e) { /* 忽略 */ }
      save = C.newSave(Date.now()); ui.resetArm = false; ui.session = null; ui.result = null; ui.recipe = null; render();
    }
  });
  app.addEventListener("change", function (ev) {
    var x = ev.target;
    if (x.id === "at-file" && x.files && x.files[0]) {
      CAM.fromFile(x.files[0]).then(function (rgba) { showSwatches(rgba); }, function () { ui.msg = t("at_err_image"); render(); });
      return;
    }
    if (x.dataset.atSlot !== undefined) { ui.slots[+x.dataset.atSlot] = x.value ? +x.value : undefined; render(); return; }
    if (x.dataset.atTrait) {
      var k = x.dataset.atTrait, at = ui.traits.indexOf(k);
      if (x.checked && at < 0) ui.traits.push(k); else if (!x.checked && at >= 0) ui.traits.splice(at, 1);
      render();
    }
  });
  window.addEventListener("i18n:change", render);
  setInterval(function () { if (ui.tab === "gather" || (ui.tab === "lab" && !ui.session)) { if (!CAM.isOpen()) render(); } }, 30000);

  window.PriTestAtelier = { _debugState: function () { return save; }, _debugUi: function () { return ui; } };
  render();
})();
```

  實作重點：
  - 每次操作都會整個重繪 `#at-app`。相機開著時，同一個 `<video>` 會重新掛回 `#at-video-slot`，所以串流不會中斷。
  - 棋盤上點一次格子會顯示預覽（`.at-ghost` 與量表的預估值），再點同一格才放下（O7）。
  - 前 3 次調和時，台詞框（`#at-line.at-tutorial`）顯示教學（B16）。
  - 格子、素材、量表都同時顯示屬性圖形（B15）。

- [ ] **Step 4: 全部檢查**

Run: `py -3 generate.py; py -3 tools/split_css.py --check; node --check static_src/atelier.js; node tools/atelier_check/core_check.js; node tools/atelier_check/ui_check.js`
Expected: 全部通過，最後印出 `23 passed` 和 `ui_check ok`

- [ ] **Step 5: 實機確認**：部署後用手機開 `/atelier`，允許相機 → 對著有顏色的東西按「取色」→ 選色採集 → 調和一次。確認以下幾點：
  - iOS Safari 和 Android Chrome 都能在頁面內播放相機畫面。
  - 切換分頁後相機會關閉。
  - 顏色名稱合理。

- [ ] **Step 6: Commit**

```bash
git add static_src/atelier.js tools/atelier_check/ui_check.js
git commit -m "feat(atelier): 煉金術士畫面：採色、素材箱、色彩棋盤調和、委託、開發面板與畫面檢查"
```

---

### Task 7: 版本與推送

- [ ] **Step 1:** `site_src/version.py` 的 `VERSION` 遞增 minor（見 Global Constraints）
- [ ] **Step 2:** 再跑一次 Task 6 Step 4 的全部檢查
- [ ] **Step 3: Commit 並推送**

```bash
git add site_src/version.py
git commit -m "feat(atelier): v2.75.0 煉金術士第 1 階段：相機多色採集、照片決定形狀、傳統色、瑠璃的色彩棋盤調和"
git push private main
```

  如果版本號是 `2.76.0`，commit message 也要跟著改。

---

## 自我檢查（對照 docs/atelier_design.md 第 1 階段）

| 設計 | Task |
|---|---|
| §2 相機、圖片、色彩散步（B17），不保存影像 | 5、6 |
| §2 O1 多色（k-means）、C1 照片決定形狀、C2 傳統色 42 色、O6 純度、屬性、類別、屬性值 | 2 |
| §2 O4 時間特性、稀有色特性、鮮豔、O5 採集籃、素材箱上限 | 2、6 |
| §3 工房主人與調和方式的介面、瑠璃的能力、A3 反應、好感度、5 個任務 | 3、4、6 |
| §4.2 錬金釜 pattern、旋轉、覆蓋、同色格、加成格、最後一推、品質、效果段數 | 3 |
| §4.2 C4 特性成本上限、O7 預覽／Undo／最佳紀錄、C11 冷卻、經驗與等級 | 2、4、6 |
| §5 B15 色覺友善圖形、B16 教學 | 4、6 |
| §7 存檔鍵、壞檔重建、開發面板（時間 +20 分、跳過冷卻、清除存檔） | 6 |
| 第 2 階段以後（C3、C5、O2、O3、§4.3 進階棋盤、B 系列等） | 不在本計畫 |

