# 射彈宇宙 第 1 階段 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 做出可以玩的單場戰鬥：滿版畫面＋導覽列切換，挑 4 位初始角色，彈弓射出、撞擊、Hit、連爆、7 屬性印記與反應、敵人倒數，分出勝負。

**Architecture:** 規則（`shedan_combat.js`）只吃碰撞事件、回傳指令，不碰 matter.js 與 DOM；物理（`shedan_physics.js`）包 matter.js，把碰撞轉成事件；畫面（`shedan_render.js`、`shedan.js`）負責 Canvas 與 HUD。規則與物理都能在 Node 直接測試。

**Tech Stack:** Vanilla ES5 IIFE、matter.js 0.19.0（vendor）、Canvas 2D、Python 建置（`generate.py`）、Node 檢查腳本＋Playwright（`tools/shedan_check/`）。

## Global Constraints

- 規則依據：`docs/shedan_game_design.md`（v1）；設計：`docs/superpowers/specs/2026-11-17-shedan-design.md`。
- id `shedan`；字串前綴 `sd_`；CSS 前綴 `.sd-`／`#sd-`；命名空間 `window.PriTestShedan*`。
- 每個模組 IIFE，掛 `window`（Node 時掛 `globalThis` 並 `module.exports`），照 `kyuka_core.js` 的寫法。
- 遊戲樣式只放 `static_src/css/shedan.css`，不碰 `style.css`。
- 首頁卡片放 test 分頁、`"link": False`。
- 戰場邏輯尺寸 540×960；場地外延伸星空；導覽列平時隱藏，`#sd-nav-toggle` 展開。
- 這階段只用初始 8 位角色（`initial: true`）與星區 1 的 16 種敵人的**基本數值**；射擊特性、友情技、技能、敵人特性留到第 2～3 階段（資料欄位先保留）。
- 推送 `main` 時遞增版本號（本階段 → `2.70.0`），commit 訊息註明版本號；只推 `private` remote。

---

## 檔案結構

| 檔案 | 職責 |
|---|---|
| `static_src/vendor/matter.min.js` | matter.js 0.19.0 |
| `static_src/shedan_rng.js` | `PriTestShedanRng`：`make(seed)`、`hashStr(s)`、`pick(rng, arr)`、`int(rng, lo, hi)` |
| `static_src/shedan_data.js` | `PriTestShedanData`：屬性、反應表、常數、`register(kind, list)` |
| `static_src/shedan_data_heroes.js` | 30 位角色（本階段讀 initial 8 人） |
| `static_src/shedan_data_enemies.js` | 星區 1 的 16 種敵人（之後補齊 50） |
| `static_src/shedan_combat.js` | `PriTestShedanCombat`：戰鬥狀態與規則 |
| `static_src/shedan_physics.js` | `PriTestShedanPhysics`：matter.js 世界 |
| `static_src/shedan_render.js` | `PriTestShedanRender`：Canvas 繪圖 |
| `static_src/shedan.js` | 畫面流程、輸入、導覽列切換 |
| `static_src/css/shedan.css` | 樣式 |
| `site_src/shedan_page.py`、`site_src/i18n_shedan.py` | 頁面、字串 |
| `tools/shedan_check/core_check.js` | 資料＋規則＋物理的 Node 檢查 |
| `tools/shedan_check/ui_check.js` | Playwright 流程檢查 |

## 介面約定（各 Task 共用）

```js
// shedan_data.js
D.ELEMENTS        // ["solar","comet","plasma","gravity","nebula","photon","void"]
D.REACTIONS       // { "solar+comet": {id:"steam", radius:160, mult:3.0}, ... } 鍵用排序後的兩個屬性
D.reactionFor(a, b) // → {id, radius, mult, kind} ；a===b 回傳 null；含 gravity → collapse；其他 → resonance
D.C               // 常數：FIELD_W 540, FIELD_H 960, HERO_R 22, PULL_MAX 180, SPEED_MAX 22, AIR 0.012, REST 0.95, ...
D.HEROES, D.HERO_BY_ID, D.ENEMIES, D.ENEMY_BY_ID
// 角色 {id, name:{zh,ja,en}, element, atk, hp, gauge, img, initial, sector?}
// 敵人 {id, name:{zh,ja,en}, sector, size:"s"|"m"|"l", hp, atk, cd, weak:[], resist:[], trait}

// shedan_combat.js
var b = Combat.create({ heroes:[heroDef×4], enemies:[{def, x, y}], rng })
// b.party [{id, def, atk, element, x, y, gauge}]  b.hp b.hpMax
// b.enemies [{uid, def, hp, hpMax, r, x, y, cd, mark:null|{el, turns}, dead}]
// b.turn {index, hits, chain, maxChain, lastHitStep:{uid:step}}
Combat.beginShot(b)                       // 重設本發 Hit／連爆
Combat.onHit(b, {enemy:uid, speed, step}) // → cmds[]
Combat.endShot(b)                         // → {cmds, next:"hero"|"enemy"|"win"}
Combat.enemyTurn(b)                       // → {attacks:[{uid,dmg}], lose:bool}
// cmd: {type:"damage",uid,amount,source} {type:"explode",x,y,radius,amount,element,depth}
//      {type:"kill",uid} {type:"reaction",uid,id} {type:"pull",x,y,radius}
Combat.hitMult(hits), Combat.elemMult(def, el), Combat.speedFactor(speed)

// shedan_physics.js
var w = Physics.create({ Matter, enemies:b.enemies, party:b.party })
Physics.launch(w, heroIndex, vx, vy); Physics.step(w) // → events[]：{type:"hit",enemy,speed,step} {type:"stop"}
Physics.removeEnemy(w, uid); Physics.pull(w, x, y, radius); Physics.heroPos(w, i)
```

---

### Task 1: 頁面骨架、登記、滿版與導覽列切換

**Files:**
- Create: `site_src/shedan_page.py`、`site_src/i18n_shedan.py`、`static_src/css/shedan.css`、`static_src/shedan.js`（骨架）、`static_src/vendor/matter.min.js`
- Modify: `generate.py`（import、copy list、`GAME_I18N_PREFIXES`、`build_pages()`、`main()` 清單）、`site_src/i18n_data.py`、`tools/split_css.py`（`GAMES`）、`site_src/projects.py`（PROJECTS＋test 分頁）、`CLAUDE.md` §5.2.1

- [ ] Step 1：matter.min.js 從 cdnjs 0.19.0 下載放進 vendor（已在 Node 驗證可用）。
- [ ] Step 2：`shedan_page.py` 用 `page_shell(..., extra_scripts=SHEDAN_SCRIPTS, extra_styles=("css/shedan.css",), extra_i18n=("i18n/shedan.js",))`；`body` 為 `<div id="sd-app">`；`vendor/matter.min.js` 由 `SHEDAN_SCRIPTS` 第一項載入。
- [ ] Step 3：`shedan.js` 骨架：`document.body.classList.add("sd-body")`；建立 `#sd-nav-toggle`，點擊切換 `body.sd-nav-open`；點 `.site-header` 以外的地方收起。
- [ ] Step 4：`shedan.css`：`body.sd-body` 隱藏捲軸、`main` 滿版；`.site-header` 固定在頂端並 `translateY(-100%)`，`sd-nav-open` 時歸位；`#sd-nav-toggle` 固定左上。
- [ ] Step 5：登記（generate／i18n_data／split_css／projects／CLAUDE.md）。
- [ ] Step 6：`py -3 generate.py`；`py -3 tools/split_css.py --check`；確認 `dist/shedan/index.html` 存在、首頁 shedan 卡片為 `project-card-nolink`。
- [ ] Step 7：Commit `feat(shedan): 頁面骨架、滿版與導覽列切換`。

### Task 2: 亂數與資料

**Files:** Create `shedan_rng.js`、`shedan_data.js`、`shedan_data_heroes.js`、`shedan_data_enemies.js`、`tools/shedan_check/core_check.js`

- [ ] Step 1：先寫 `core_check.js` 的資料測試：角色 30、initial 8、7 屬性都有角色；星區 1 敵人 16；`reactionFor` 的 7 種情形（蒸氣爆、超導、電離雲、燎原、湮滅、坍縮、共鳴）且與順序無關；同種子的 rng 序列相同。
- [ ] Step 2：`node tools/shedan_check/core_check.js` → 失敗（模組不存在）。
- [ ] Step 3：實作四個檔案（數值照規則文件 §1～§6；角色攻擊／HP／量表依特性 ±20%；頭像 `g_###.webp` 編號分配）。
- [ ] Step 4：測試通過、`node --check`。
- [ ] Step 5：Commit `feat(shedan): 亂數與角色、敵人、反應資料`。

### Task 3: 戰鬥規則

**Files:** Create `shedan_combat.js`；Modify `core_check.js`

- [ ] Step 1：新增測試：
  - `hitMult(0)=1`、`hitMult(10)=1.1`、`hitMult(25)=1.2`
  - 弱點 ×1.5、抗性 ×0.5；`speedFactor` clamp 0.4～1.0
  - 同一敵人 6 步內的第二次撞擊不算 Hit
  - 撞擊附加印記；不同屬性再撞觸發對應反應並消耗印記
  - 擊破 → explode（半徑 = r×2.5、傷害 = hpMax×30%）→ 波及擊破 → 連鎖 depth+1，`maxChain` 記錄
  - 虛空印記的敵人被擊破不爆炸、全隊量表增加
  - 敵人回合：倒數 −1，歸零者攻擊並重置；冰彗印記倒數 +1 只生效一次；灼燒在敵人回合開始造成傷害
  - HP 歸零 → `lose`；敵人全滅 → `endShot().next === "win"`
- [ ] Step 2：執行 → 失敗。
- [ ] Step 3：實作 `shedan_combat.js`（爆炸以佇列處理，避免遞迴過深）。
- [ ] Step 4：測試通過。
- [ ] Step 5：Commit `feat(shedan): 戰鬥規則（Hit、印記反應、連爆、敵人回合）`。

### Task 4: 物理

**Files:** Create `shedan_physics.js`；Modify `core_check.js`

- [ ] Step 1：測試（Node 直接載入 vendor matter）：
  - 角色朝正上方敵人射出 → 產生 `hit` 事件、`speed > 0`
  - 不撞任何東西時最終產生 `stop`（停止判定：速度 < 0.4 持續 20 步，或 12 秒上限）
  - 高速射出不會穿出場地（牆厚 200，1 frame 兩個子步）
  - `removeEnemy` 後不再產生該敵人的 hit；`pull` 改變敵人位置
- [ ] Step 2：執行 → 失敗。
- [ ] Step 3：實作：零重力；敵人 `isStatic`（被 pull／rime 之後再改）；角色之間不碰撞（`collisionFilter`）但停住的隊友保留為感應區（第 2 階段友情技用）；`collisionStart` 收集事件。
- [ ] Step 4：測試通過。
- [ ] Step 5：Commit `feat(shedan): matter.js 物理場地與碰撞事件`。

### Task 5: 畫面、輸入與完整一場戰鬥

**Files:** Create `shedan_render.js`；Modify `shedan.js`、`shedan.css`、`i18n_shedan.py`；Create `tools/shedan_check/ui_check.js`

- [ ] Step 1：`shedan.js` 流程：選隊畫面（initial 8 人，選 4 人）→ 戰鬥（種子 RNG 從星區 1 抽 4～6 隻敵人、隨機位置不重疊）→ 勝利／失敗畫面（再戰一場、回選隊）。
- [ ] Step 2：輸入：在 canvas 上 `pointerdown` 後拖曳，向量 = 起點 − 目前點，長度 clamp `PULL_MAX`，放開射出；顯示預測線（直線）；導覽列展開時忽略。
- [ ] Step 3：主迴圈：`requestAnimationFrame` → `Physics.step` ×2 → 事件交給 `Combat` → 執行 cmds（扣血、爆炸特效、移除、吸引）→ `stop` 時 `endShot` → 換下一位或敵人回合。
- [ ] Step 4：`shedan_render.js`：星空背景（填滿整個 canvas）、9:16 場地框、敵人（依屬性色的發光圓＋HP 條＋倒數＋印記圖示）、角色（頭像圓形裁切）、爆炸粒子、Hit／連爆數字浮現。
- [ ] Step 5：HUD：隊伍 HP 條、回合、目前角色、Hit 數、最大連爆。
- [ ] Step 6：`ui_check.js`：手機（390×844）與桌機（1280×800）滿版且無捲軸；`☰` 展開／收起；選 4 人開戰；`dispatchEvent` 模擬拖曳射出 → 敵人 HP 總和下降；強制勝利（`window.PriTestShedanApp._debug`）出現勝利畫面；無 console error。
- [ ] Step 7：`py -3 generate.py`、啟 server、執行 ui_check、看截圖。
- [ ] Step 8：版本號 `2.70.0`；Commit `feat(shedan): v2.70.0 射彈宇宙第 1 階段：單場戰鬥`；push private main。
