# 煉金術士（atelier）第 5 階段 Implementation Plan（PriTest 部分）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> 使用者指定（2026-11-20）「繼續製作到結束」：本計畫只寫規格、介面與測試案例，完整程式碼以各 commit 為準。
> RMD 移植、B14 交換顏色、B7 排行榜需要伺服器，不在 PriTest 的範圍。

**Goal:** 加入 4 位工房主人（茜、翠、雫、黒曜）和她們的調和方式（循環、熬煮、調色、結晶），可以在工房分頁切換。

**Architecture:**
- 每種調和方式一個檔案：`atelier_method_ring.js`、`atelier_method_brew.js`、`atelier_method_palette.js`、`atelier_method_gravity.js`。都用 `Core.registerMethod()` 登記，實作共用介面加上 `options()`。
- 結晶派重用色彩棋盤的 `place`／`evaluate`，只多「落下」和「結晶」。
- 核心新增 `setHost`、`hostUnlocked`，以及通用的 `bestPlacement`（用 `options` 加 `preview` 計分）。工房主人的能力分別接在 `greatChance`、`captureEx` 和各調和方式中。
- 畫面依 `session.method` 選擇對應的繪製函式；回放也用同一套函式。

## Global Constraints

- 規則依據：`docs/atelier_design.md` §11。
- 第 1～4 階段的檢查必須維持通過，不能修改它們的期望值。
- 舊存檔由 `migrate()` 補上 `hosts.<id> = {aff: 0, task: 0, tut: 0}`。
- 台詞全部原創；沒有寫到的台詞鍵，退回到該工房主人的 `ok`。
- 版本 `2.79.0`。只推 `private main`。

## 介面（新增）

```js
Method.options(session, mi) → [[x, y, rot]]          // 這個素材所有合法的一手
Method.evaluate(...) 可以回傳 lost（損失格數 → 灰燼）
Core.hostUnlocked(save, id) → bool；Core.setHost(save, id) → bool
Core.bestPlacement(session, mi) → {x, y, rot, score}|null（方式有 bestPlacement 就用它，否則用 options＋preview）
Ring:    session.nodes = [{el, fill: [{mi, n}]}]；place(s, mi, startNode, 0, 0)
Brew:    session.temp；place(s, mi, heat 0..2, 0, 0)；evaluate 回傳 temp、boil
Palette: session.parts；place(s, mi, parts 1..3, 0, 0)；evaluate 回傳 mix（rgb）、target（rgb）、dE
Gravity: place(s, mi, x, 任意, rot) → 實際落下的 y；evaluate 回傳 lines
```

## 測試案例（`tools/atelier_check/phase5_check.js`）

1. 工房主人：解鎖等級；未解鎖不能切換；切換後 `startSynthesis` 使用該方式；舊存檔補上 hosts。
2. 循環：倒入的順序與溢流、同屬性 ×2、關閉節點 +2、環滿後損失（`lost`）、Undo、茜的火屬性品質 +10。
3. 熬煮：溫度變化（火候＋素材熱、0～120）、理想區間 ×2／×1／×0.5、品質、沸騰。
4. 調色：混色＝依份數加權平均、ΔE 越小加成越多、份數只能 1～3。
5. 結晶：落下的位置不重疊、超出時不能放、填滿一排 +3（黒曜 +1）、Undo。
6. 所有方式：`options` 列出的每一手 `canPlace` 都成立；`preview` 不改動 session；`replaySession` 重建的量表相同；`bestPlacement` 的分數不低於任何一個選項。
7. 能力：翠的大成功 +5%、雫的採色品質 +5。
8. 資料：每位工房主人的 method 已登記、任務的配方存在、台詞有 zh／ja。

## Tasks

- [ ] **Task 1：4 種調和方式＋工房主人資料＋核心**＋測試 1～8
- [ ] **Task 2：畫面**：
  - 工房分頁切換工房主人。
  - 各方式的繪製（節點環、溫度計、調色盤、棋盤）、回放共用。
  - 新增 `tools/atelier_check/ui5_check.js`。
- [ ] **Task 3：版本 2.79.0，跑全部檢查，推送**
