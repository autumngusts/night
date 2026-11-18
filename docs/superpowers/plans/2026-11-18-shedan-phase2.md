# 射彈宇宙 第 2 階段 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 30 位角色都有自己的射擊特性、友情技、技能；戰場加上星座連線、殘影重播、引力井／黑洞、可破壞小行星。

**Architecture:** 角色效果全部寫成資料（`trait`／`friend`／`skill` 的類型＋參數），規則層（`shedan_combat.js`）依類型分派，不為單一角色寫特例；需要改變物理的效果由規則層回傳「射擊選項」或指令給物理層（`shedan_physics.js`）。星座、殘響、冰霜軌跡這類「位置判定」統一走 `Combat.onPos()`。

**Tech Stack:** 同第 1 階段（Vanilla ES5、matter.js 0.19.0、Canvas 2D、Node＋Playwright 檢查）。

## Global Constraints

- 規則依據：`docs/shedan_game_design.md` §4.1～§4.3、§8、§8.1（2026-11-18 第 2 階段補充）。數值全部從資料或常數讀，不在流程程式裡硬編。
- 沿用第 1 階段的命名、檔案分工、IIFE 寫法與 `sd-` 前綴。
- 選隊畫面暫時開放全部 30 人（解鎖機制在第 5 階段）。
- 推送時版本 `2.71.0`；只推 `private` remote。

## 介面約定（新增）

```js
// 資料：每位角色
hero.trait = { kind: "pierce" | "spark" | ..., ...參數 }
hero.friend = { kind: "cross" | "beam" | "bolts" | "blast" | "strike" | "chain" | "net" | "zoneAt" | "markAll"
              | "meteor" | "push" | "wellAt" | "iceWall" | "shield" | "heal" | "voidGate", ...參數, name:{zh,ja,en} }
hero.skill = { kind: ..., ...參數, name:{zh,ja,en} }

// 規則（shedan_combat.js）
Combat.create({heroes, enemies, field:{stars:[{x,y}], wells:[{x,y,radius,hole}], rocks:[{x,y}]}})
Combat.canSkill(b) → bool
Combat.beginShot(b, {skill: bool, dir:{x,y}}) → {cmds, launch:{speedMult, radius, pierce, pierceFirst, restitution, airMult, wellAt?}}
Combat.onHit(b, ev) / onAlly(b, {ally}) / onWall(b, {x,y}) / onRock(b, {rock}) / onDebris(b, {enemy, speed, debris})
Combat.onPos(b, {x, y, step}) → cmds      // 星點、殘響、冰霜軌跡、透鏡技能吸引
Combat.onGhost(b, {enemy, step}) → cmds
Combat.endShot(b) → {next, cmds}          // 超新星、電容、星座
Combat.enemyTurn(b) → 加上護盾（冰晶護盾／方舟座）減傷

// 新指令
{type:"well", x, y, radius, hole}  {type:"wall", x1, y1, x2, y2}  {type:"debris", x, y, n, el}
{type:"laser", x1, y1, x2, y2}     {type:"bolt", fromX, fromY, uid} {type:"star", index}
{type:"constellation", id, n}      {type:"heal", amount}  {type:"shield", ratio}  {type:"push", uid, x, y}
{type:"pierceOff"}                 {type:"rockBreak", id}

// 物理（shedan_physics.js）
Physics.create({Matter, battle, heroPos, field})
Physics.launch(w, i, vx, vy, opts)        // opts = beginShot 回傳的 launch
Physics.addWell(w, {x,y,radius,hole}) / addWall(w, x1,y1,x2,y2) / spawnDebris(w, x, y, n, el)
Physics.setPierce(w, bool) / redirect(w, x, y)
// 事件新增：{type:"wall", x, y} {type:"rock", rock} {type:"debris", enemy, speed, debris}
```

---

### Task 1: 角色效果資料＋選隊開放 30 人

**Files:** Modify `static_src/shedan_data_heroes.js`、`static_src/shedan.js`（選隊）、`site_src/i18n_shedan.py`；Modify `tools/shedan_check/core_check.js`

- [ ] 測試：30 人都有 `trait.kind`、`friend.kind`、`skill.kind`，且都是規則層認得的類型（`Combat.FRIEND_KINDS` 等）；友情技、技能都有 zh/ja/en 名稱。
- [ ] 資料照規則文件 §4.1～§4.3 填入。
- [ ] 選隊畫面列出 30 人（依屬性排序），卡片顯示技能名稱。
- [ ] Commit。

### Task 2: 規則層：射擊特性、友情技、技能

**Files:** Modify `static_src/shedan_combat.js`、`tools/shedan_check/core_check.js`

- [ ] 測試（每種類型至少一個代表角色）：火花爆炸、印記擴散、隨機印記、印記轉化、斬殺、治療、量表吸取、撞擊電弧、撞擊牽引、重量推開、撞牆凍結／電弧／吸引、冰霜軌跡、殘響；
  友情技：十字雷射、直線雷射、追蹤彈、爆發（含附加印記）、重擊、連鎖閃電、雷網、球狀閃電、全場灼燒、隕石、推開、引力井／冰牆指令、冰晶護盾、治療、虛空門；每位隊友每發一次；
  技能：量表滿才能發動且發動後歸 0、立即型（冰河、永凍、星雲帷幕、歸零）、撞擊型（熾核、耀斑、聚焦、處決、潮汐鎖、隱蔽、日珥、絕對零度、折射、聖域）、擊破型（坍縮核、深淵、吞噬）、結束型（超新星、電容）、射擊選項（彗星衝、星雲膨脹、光速、偏折、事件視界）。
- [ ] 實作（依類型分派；狀態掛在 `b.shot`，`beginShot` 重設）。
- [ ] 測試通過、Commit。

### Task 3: 物理層：射擊選項、撞牆事件、引力井、小行星與碎片、冰牆、轉向

**Files:** Modify `static_src/shedan_physics.js`、`tools/shedan_check/core_check.js`

- [ ] 測試：撞牆產生 `wall` 事件（含座標）；穿透時穿過敵人仍產生 `hit`；穿透第一個；半徑放大；引力井讓軌跡彎曲；黑洞吞碎片、彈出角色；小行星被撞產生 `rock`、`breakRock` 後產生碎片，碎片撞敵人產生 `debris`、6 秒後消失；冰牆擋住角色；`redirect` 後速度大小不變、方向朝目標。
- [ ] 實作、測試通過、Commit。

### Task 4: 規則層：星座、殘影、小行星、碎片、護盾

**Files:** Modify `static_src/shedan_combat.js`、`tools/shedan_check/core_check.js`

- [ ] 測試：依序點亮 3／4／5 個星點的效果（隕石雨 5 發、護盾 −50%、全隊量表滿）；同一發同一星點只算一次；小行星耐久 3 → `rockBreak`；碎片傷害攻 ×0.4 且計 Hit；殘影傷害攻 ×0.5、不計 Hit、不留印記、6 子步間隔；護盾在敵人攻擊時生效一次。
- [ ] 實作、測試通過、Commit。

### Task 5: 畫面：技能鍵、轉向、場地機關、殘影、特效；整合檢查

**Files:** Modify `static_src/shedan.js`、`static_src/shedan_render.js`、`static_src/css/shedan.css`、`site_src/i18n_shedan.py`、`tools/shedan_check/ui_check.js`、`site_src/version.py`

- [ ] 戰場生成：依 §8.1 用種子產生星點、引力井／黑洞、小行星。
- [ ] 技能鍵（HUD，量表滿才亮）、技能名稱橫幅；離子技能的點擊轉向。
- [ ] 繪圖：星點（點亮與連線）、引力井／黑洞、小行星（耐久裂痕）、碎片、冰牆、雷射、追蹤彈、殘影、殘響。
- [ ] `ui_check.js`：選第 9 位以後的角色（確認 30 人）；用 debug 墊滿量表後發動技能，量表歸 0；戰場有星點；全程沒有 console error。
- [ ] `node tools/shedan_check/core_check.js`、`ui_check.js` 全部通過，看截圖。
- [ ] 版本 `2.71.0`，Commit，push private main。
