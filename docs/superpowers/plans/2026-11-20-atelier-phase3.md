# 煉金術士（atelier）第 3 階段 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> 使用者指定（2026-11-20）「繼續製作到結束」：第 3 階段以後的計畫只寫規格、介面與測試案例，完整程式碼以各 commit 為準。

**Goal:** 加入進階棋盤（混色、互補色抵銷、轉色、觸媒）、大成功與過熱、特性合成、瑠璃出手、每週挑戰棋盤、調和回放。

**Architecture:**
- 進階規則全部放在 `atelier_method_board.js`：`create(recipe, mats, cauldron, ability, opts)` 接收 `opts = {rules: {mix, complement}, catalyst: {id, el}}`，`evaluate` 依規則計算。
- 大成功、特性合成、最佳位置、每週挑戰、觸媒的庫存與製作放在 `atelier_core.js`。
- 回放資料由 `place` 記錄在 `session.moves`，完成時存進成品。

**Tech Stack:** Vanilla ES5、Node `assert`、Playwright。

## Global Constraints

- 規則依據：`docs/atelier_design.md` §9。數值都是暫定，集中在 `atelier_data.js`。
- 第 1、2 階段的檢查（`core_check` 23、`phase2_check` 22、`ui_check`、`ui2_check`）必須維持通過，不能修改它們的期望值。
- 進階規則只有在「Lv3 以上且 `settings.advanced` 開啟」時才生效；舊存檔由 `migrate()` 補上 `settings`、`catalysts`、`weekly`。
- 大成功的亂數一律用 seed（O11）。
- 版本 `2.77.0`。只推 `private main`。

## 介面（新增／變更）

```js
// 數值（atelier_data.js）
ADVANCED_LV: 3, MIX_PAIRS: [["fire","ice","spirit"],["bolt","ice","wind"],["fire","bolt","fire"]], MIX_BONUS: 1,
COMPLEMENT: {fire:"wind", wind:"fire", bolt:"spirit", spirit:"bolt"}, COMPLEMENT_PENALTY: 1,
CATALYSTS: {expand:{ash:6}, tint:{ash:5, needsEl:true}, double:{ash:8, needsEl:true}},
OVERHEAT_RATIO: 0.9, OVERHEAT_PENALTY: 10,
GREAT_BASE: 0.05, GREAT_PER_AFF: 0.001, GREAT_ALL_LV: 0.05, GREAT_QUALITY: 15, GREAT_EFFECT: 1.2, QUALITY_CAP_GREAT: 120,
TRAIT_FUSION: [["morning_dew","dusk","twilight"],["hue_grace","vivid","hue_crown"],["night","daily_hue","star_hue"]],
HELP_AFF: 40, WEEKLY_EXP: 20

// 棋盤（atelier_method_board.js）
Board.create(recipe, mats, cauldron, ability, opts?) → session（新增 rules, catalyst, moves）
Board.place(...) 也會 push session.moves；Board.undo 會 pop
Board.evaluate(...) 回傳新增 mix（混色加分合計）、clash（互補色的格數）、overheat（bool）
Board.bestPlacement(session, mi) → {x, y, rot, score}|null

// 核心（atelier_core.js）
Core.advancedOn(save) → bool；Core.setAdvanced(save, on)
Core.makeCatalyst(save, id) → bool（扣灰燼、catalysts[id]++）
Core.startSynthesis(save, recipeId, uids, cauldronId, now, opts?)   // opts = {catalyst: {id, el}}；錯誤新增 "catalyst"
Core.fuseTraits(ids) → [traitId]；traitsValid／finishSynthesis 以合成後的特性計算成本與效果
Core.greatChance(save, session) → 0..1；finishSynthesis 新增 item.great、item.overheat、item.replay
Core.weekKey(now) → "YYYY-MM-DD"（JST 週一）；Core.weeklyChallenge(now) → {key, recipe, mats}
Core.startChallenge(save, now) → session；Core.finishChallenge(save, session, now) → {score, best, first}
Core.helpAvailable(save, session) → bool；Core.useHelp(save, session) → info|null
Core.replaySession(replay, recipeId, ability) → session（重建後依序 place）
```

## 測試案例（`tools/atelier_check/phase3_check.js`）

1. 混色：火、冰相鄰 → 靈 +1；同一個素材自己相鄰的格子不算；規則關閉時不算。
2. 互補色：火素材放在風色格 → 這一格 0 分，火量表 −1，最低 0。
3. 擴張觸媒 → size+1；染色觸媒 → 中央 3×3 的一般格變色，加成格與色格不變；倍化觸媒 → 同色格多加一次屬性值。
4. 觸媒製作：灰燼不足或 Lv 不足就失敗；完成時消耗，中途放棄不消耗；庫存 0 時 `startSynthesis` 回傳 error "catalyst"。
5. 過熱：覆蓋 90% 以上時 `evaluate().overheat === true`，完成品質 −10。
6. 大成功：機率公式；同一個 seed 結果固定；大成功時品質上限 120、效果 ×1.2。
7. 特性合成：朝露＋黃昏 → 晨昏，成本以 14 計算；沒有組合時不變。
8. 瑠璃出手：好感度不足時不能用；`bestPlacement` 的分數 ≥ 任何一個合法位置；每次調和只能用 1 次。
9. 每週挑戰：同一週結果相同、隔週不同；不消耗素材、不產生成品；最佳分數保存；第一次完成時經驗 +20。
10. 回放：完成後 `item.replay.moves` 和實際放置相同；`replaySession` 重建出相同的量表；Undo 會刪掉最後一手。
11. 遷移：舊存檔補上 `settings`、`catalysts`、`weekly`。

## Tasks

- [ ] **Task 1：棋盤進階規則**（混色、互補色、觸媒、過熱、moves、bestPlacement）＋測試 1～3、5、8（bestPlacement 部分）、10（moves 部分）
- [ ] **Task 2：核心**（advanced 開關、觸媒製作與消耗、大成功、特性合成、瑠璃出手、每週挑戰、回放、migrate）＋其餘測試
- [ ] **Task 3：畫面**：
  - 工房分頁：進階棋盤開關、製作觸媒（含指定屬性）。
  - 調和：選觸媒、顯示過熱警告和混色／互補色、特性合成的預覽、「請瑠璃幫忙」、大成功的演出、回放播放器。
  - 委託分頁加入每週挑戰。
  - 新增 `tools/atelier_check/ui3_check.js`。
- [ ] **Task 4：版本 2.77.0，跑全部檢查，推送**
