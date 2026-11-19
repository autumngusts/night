# 射彈宇宙 第 5 階段 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 局外成長與存檔：星艦據點（星塵、角色解鎖、起始遺物、難度階層）、每日星圖、遠征存檔與續玩。

**Architecture:** 局外規則（星塵結算、解鎖、難度、每日種子、存檔的序列化／還原）是純函式，放在 `shedan_run.js`（之後與遠征一起移植成 Go）；`localStorage` 的讀寫只在畫面層（`shedan.js`）。難度效果由遠征層傳給 `Combat.create`（`difficulty`）。

## Global Constraints

- 規則依據：`docs/shedan_game_design.md` §12、§12.1。
- 存檔鍵：`pritest-shedan-meta-v1`、`pritest-shedan-run-v1`；讀檔一律 try/catch，壞檔忽略。
- 版本 `2.74.0`；只推 `private`。

## 介面

```js
Run.newMeta() → {stardust, heroes:[id], startRelics:[id], cleared:-1, best:0, daily:{date:score}}
Run.unlockHero(meta, id) / Run.unlockStartRelic(meta, id) → bool（星塵不足、已解鎖時 false）
Run.stardust(run) → n
Run.settle(meta, run) → {stardust, newBest, unlockedDifficulty}
Run.dailySeed(dateStr) / Run.todayStr(date)
Run.create({seed, heroes, pool, relics, difficulty, daily})
Run.serialize(run) → JSON 字串；Run.restore(str) → run（敵人 def 以 id 還原）
Combat.create({..., difficulty})
```

### Task 1: 局外規則與存檔序列化（shedan_run.js＋combat 難度）
- [ ] 測試：新 meta 只有 8 人；解鎖扣星塵、不足／重複不行；起始遺物只限普通；星塵公式＋吸收器；通關解鎖下一難度（最高 5）；最佳分數與每日紀錄（只留 14 天）；每日種子相同日期相同；難度 1～5 的效果（HP、精英 2 隻、倒數、價格、Boss 部位）；序列化→還原後 `reachable`、下一場 `battleSetup` 與原本相同。
- [ ] 實作；Commit。

### Task 2: 畫面
- [ ] 選隊畫面：未解鎖角色顯示鎖頭與價格；「開始遠征」旁可選難度與起始遺物；「每日星圖」（只能選初始 8 人）；有存檔時顯示「繼續遠征」。
- [ ] 星艦據點：星塵、角色解鎖、起始遺物解鎖、最佳分數、每日紀錄。
- [ ] 遠征結束：顯示獲得星塵、新解鎖的難度；寫入 meta、刪除 run 存檔。
- [ ] 每次回到地圖存 run；重新整理後可續玩（戰鬥中重整 → 從該場開頭重來）。
- [ ] `ui_check.js`：解鎖流程、存檔續玩（地圖中與戰鬥中重整）、每日星圖、難度選擇；先前全部檢查照樣通過。
- [ ] 版本 `2.74.0`，Commit，push。
