# イヌスノー（inusnow）第 3 階段 Implementation Plan

> 依 `docs/inusnow_design.md` §17.7、§18 實作。Steps 用 checkbox（`- [ ]`）追蹤。

**Goal:** G2 嗅覺捷徑（P2 留下）；雪質、天氣、夜間、G3 新雪分佈、G5 天候變化；競猜（票種、賠率、狗幣、B1 時間預測、B2 賽前資訊、B5 即時勝率）；教練模式；M1 救難犬；M3 世界盃；M5 雪崩逃脫；R1 每日雪況。

**Architecture:** 規則檔（確定性、加進 `core_check` 的原始碼掃描）：
`inusnow_env.js`（雪況與天氣 → 物理環境）、`inusnow_bet.js`（出賽表、賠率、票、結算）、`inusnow_mission.js`（救難犬、雪崩逃脫）、`inusnow_season.js`（世界盃、每日雪況）。
嗅覺捷徑寫在 `inusnow_cross.js`／`inusnow_free.js`（共用 `Env.shortcuts`）。
畫面：`inusnow.js` 開放 `window.PriTestInusnowUI`（共用工具、畫面登記、賽事種類登記），新畫面放 `inusnow_ui3.js`。

## Global Constraints

- 第 1、2 階段的全部限制；大曲道練習模式在「標準雪況」（壓雪・晴・白天）時結果與第 1 階段完全相同（`core_check` 的 golden 紀錄）。
- 狗幣只是遊戲內點數，不能購買、不能換現金（D10）。
- 賠率模擬次數瀏覽器負擔大：100 次改成 `BET.oddsSims`（暫定 40），分批執行並顯示進度（§0.6 記錄）。

## Task

- [x] T1 數值表：WEATHER、地區與月份權重、BET、COACH、RESCUE、AVALANCHE、CUP、DAILY、SCENT、深雪
- [x] T2 `inusnow_env.js`＋物理（`env.surf`、`muAdd`、`wind`、`cold`、`brake`、粉雪摔倒 60 步）；大曲道／Slopestyle／Cross 接上雪況
- [x] T3 G2 嗅覺捷徑（Cross、自由滑行）：捷徑、樹、深雪、嗅覺量表、腳印
- [x] T4 `inusnow_bet.js`：出賽表、調子、適性、模擬、機率與賠率、票種與買法、結算、時間預測
- [x] T5 教練模式（大曲道、Slopestyle）：路線、目標轉體、興奮度時機、指令「衝！」「穩住！」
- [x] T6 `inusnow_mission.js`：救難犬、雪崩逃脫
- [x] T7 `inusnow_season.js`：世界盃（8 站、24 隻、積分）、每日雪況與今日挑戰
- [x] T8 3D：霧、夜間照明、天候變化、捷徑樹林與腳印、被埋者與雪崩前緣
- [x] T9 UI：首頁分頁（雪場／世界盃／競猜／今日雪況）、雪況設定、競猜與觀戰（B5）、教練、救難、雪崩、成績（`inusnow_ui3.js`）
- [x] T10 `p3_check.js`（由 core_check 呼叫）／`ui_p3_check.js`；設計文件 §A.1、§0.6；版本（和第 4 階段一起推送，2.85.0）

## 自我檢查

- `core_check.js`、`ui_check.js`、`split_css.py --check` 全部通過。
