# 射彈宇宙 第 3 階段 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 補齊 50 種敵人與它們的特性，加上 3 隻部位破壞 Boss；試作版可以直接選擇星區 1～3 的一般戰鬥或 3 場 Boss 戰。

**Architecture:** 敵人特性與第 2 階段的角色效果一樣寫成「鍵＋參數」，由規則層依鍵分派；需要動到物理的效果（移動、隱形穿透、減速／彈開射出者、自帶引力井、生成小行星、召喚）回傳指令給物理層。Boss 的本體與部位都是 `b.enemies` 裡的獨立靶，以 `owner` 連結（巨蟒的身體也用同一套）。

**Tech Stack:** 同前（Vanilla ES5、matter.js 0.19.0、Canvas 2D、Node＋Playwright）。

## Global Constraints

- 規則依據：`docs/shedan_game_design.md` §6、§6.1、§7、§7.1（2026-11-18 第 3 階段補充）。
- 敵人資料只放在 `shedan_data_enemies.js`；Boss 放 `D.BOSSES`（不算在 50 種內）；部位、分裂體、殘影等衍生靶用 `D.SPAWN_DEFS`。
- 精英與星蝕使徒的出現留到第 4 階段（地圖）；一般戰鬥的抽選排除 `eclipse`。
- 版本 `2.72.0`；只推 `private`。

## 介面約定（新增）

```js
// 敵人執行期欄位
e.owner      // 部位／巨蟒身體所屬的本體 uid（本體死亡時一起消失）
e.role       // "body" | "part" | undefined
e.hidden     // 霧隱者隱形
e.shielded   // 護盾母體護盾尚在
e.partner    // 雙子球／引力雙星的另一隻
e.hitThisShot

// 新指令
{type:"spawn", uid}                 // 新敵人已加入 b.enemies，物理要建立剛體
{type:"shooterVel", mult, rotate}   // 射出者速度倍率／旋轉（弧度）
{type:"enemySensor", uid, on}       // 隱形切換
{type:"well", x, y, radius, owner}  // 敵人自帶的引力井（owner 死亡時移除）
{type:"addRock", id, x, y}          // 礦採母艦生成小行星
{type:"teamDamage", amount}         // 雷雲、水雷等直接扣隊伍 HP

// 規則
Combat.create({..., boss: bossId})  // Boss 戰
Combat.spawnEnemy(b, def, x, y, extra) → enemy
Physics.addEnemy(w, e) / addRock(w, r) / scaleShooter(w, mult, rotate) / setEnemySensor(w, uid, on) / removeWellsOf(w, owner)
```

---

### Task 1: 敵人 50 種＋Boss 資料
- [ ] 測試：星區 1／2／3 = 16／17／17；每種的 `trait` 是規則層認得的鍵；Boss 3 隻各有本體與部位；數值依 §6.1 的星區倍率。
- [ ] 實作 `shedan_data_enemies.js`；Commit。

### Task 2: 規則層：敵人特性與 Boss
- [ ] 測試（每個特性鍵至少一個）：減傷類（armored、explosionOnly、shieldAllies、aura、selfShield 與破盾、absorbLight、protect）、被撞反應（chill、deflect、shock、mine、repel、echoSpawn、shiftWeak）、隱蔽不觸發被撞反應、擊破時（split、parasite 宿主、acidPool、drainOnDeath、oblivion、selfDestruct 半徑 ×2）、敵人回合（hop、glide、charge、escort、binary、repair、lightning、entropy、randomCd、spawn／nest／summon／rift 與 10 隻上限、devour、armorBreak、eclipse、selfDestruct 攻擊後消失）、linked 分攤、phase 隱形、mirror、serpent 頭部 ×2 與身體連帶、Boss（部位爆炸、全部位破壞 10%、本體死亡勝利、鑽臂生成小行星、護盾產生器減傷、核心引力井與倒數 +2、砲塔攻擊）。
- [ ] 實作；Commit。

### Task 3: 物理層
- [ ] 測試：addEnemy 後會撞到；隱形敵人可穿過；鏡面艦彈性 1；磁石吸引；scaleShooter；敵人引力井隨擊破移除；addRock。
- [ ] 實作；Commit。

### Task 4: 畫面與整合
- [ ] 選隊畫面加「戰場」選擇：星區 1／2／3、Boss 1／2／3。
- [ ] 戰鬥生成：依星區抽敵（swarm、linked、binary 成組；parasite 貼宿主；serpent 帶身體）；Boss 戰。
- [ ] 繪圖：隱形半透明、護盾外圈、連結線、Boss 部位、暗物質不顯示 HP、酸液區。
- [ ] `ui_check.js`：6 種戰場各跑一輪（每發發動技能），沒有 console error；Boss 戰強制擊破本體會勝利。
- [ ] 版本 `2.72.0`，Commit，push。
