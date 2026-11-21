# イヌスノー（inusnow）第 4 階段 Implementation Plan

> 依 `docs/inusnow_design.md` §19 實作。Steps 用 checkbox（`- [ ]`）追蹤。實作與規格不同的地方記在設計文件 §0.7。

**Goal:** 即時同場（Firebase 房間）：4 人平行大曲道（Q4）、8 人同時 Slopestyle、觀戰與房間內競猜；M6 雪橇犬接力（單人＋房間）；R5 精彩重播與分享片段。

**Architecture:**
- 規則（確定性、加進 `core_check` 的原始碼掃描）：
  - `inusnow_core.js`：平行大曲道的賽道（`lanes(pi)`、`newRun` 的 `opts.lane`／`opts.from`／`opts.to`、旗門的 `w`）。
  - `inusnow_relay.js`（`PriTestInusnowRelay`）：4 棒的定義、每一棒的比賽物件、CPU 隊伍的模擬、團隊時間。
  - `inusnow_highlight.js`（`PriTestInusnowHighlight`）：從紀錄找出最快 10 秒、最大的一跳、最高分的技巧、Cross 的超車；分享碼的片段。
  - `inusnow_room.js`（`PriTestInusnowRoom`）：房間比賽的出賽表、遠端選手的重播與外插、結算、彩池（單勝）。不碰網路。
- 連線：`inusnow_net.js`（`PriTestInusnowNet`），比照 `saigo_net.js`，路徑 `games/<roomId>/rtState/inu/...`，用 `game_storage.js` 的 `rtSet`／`rtSubscribe`／`rtTransaction`／`rtSetWithOnDisconnect`。測試時可以換成假的 GS（`window.PriTestInusnowFakeGS`，比照 zombie）。
- 畫面：`inusnow_ui4.js`（在 `inusnow.js` 之前載入，用 P3 的 `UI` 介面）：首頁「連線」分頁（建房、用連結加入）、大廳、房間比賽（賽事種類 `room`）、房間成績；單人的「接力」賽事種類；成績畫面的「精彩重播」。

## Global Constraints

- 第 1～3 階段的全部限制；單人模式的結果與第 3 階段完全相同（`core_check` 不變）。
- 每台裝置只模擬自己的狗；別人的狗用對方寫上來的輸入紀錄重算，結果一致才派彩（§19.1）。
- 房間狗幣（`bal/<pid>`）和單機的狗幣分開，一律用 transaction。
- `database.rules.json` 不用改（寫在 `rtState` 底下）。

## 檔案結構

| 檔案 | 內容 |
|---|---|
| `static_src/inusnow_relay.js` | 接力規則 |
| `static_src/inusnow_highlight.js` | 精彩片段 |
| `static_src/inusnow_room.js` | 房間比賽規則（不碰網路） |
| `static_src/inusnow_net.js` | Firebase 房間協定 |
| `static_src/inusnow_ui4.js` | 連線分頁、大廳、房間比賽、接力、精彩重播 |
| `tools/inusnow_check/p4_check.js` | 規則檢查（由 `core_check.js` 呼叫） |
| `tools/inusnow_check/ui_p4_check.js` | 畫面檢查：單人接力、精彩重播、兩個瀏覽器的房間（假 Firebase） |

## Task

- [x] T1 數值表：`ROOM`（人數、段長 30 步、外插 1.5 秒、斷線 3 秒、起跑延遲、房間狗幣、彩池還原率）、`RELAY`、`HIGHLIGHT`
- [x] T2 Core：平行大曲道的賽道與旗門（`laneW`、`opts.lane`）、雪道區間（`opts.from`／`opts.to`）；標準大曲道不變
- [x] T3 `inusnow_relay.js`：4 棒、CPU 隊伍、團隊時間
- [x] T4 `inusnow_highlight.js`：4 種片段、分享碼片段 `|h:a-b`（`parseShare` 相容）
- [x] T5 `inusnow_room.js`：出賽表（賽道分配、第 2 趟換賽道）、遠端選手（分段紀錄 → 重播 → 外插）、斷線判定、結算重算、單勝彩池
- [x] T6 `inusnow_net.js`：房間（meta、on、pl、cfg、m/<no>、rec、done、bets、bal）、換房主
- [x] T7 `inusnow_ui4.js`：連線分頁、大廳（名字、犬種、騎／看、準備、房主設定）、房間比賽（自己的狗＋其他人的狗、名次）、觀戰者下注、成績與派彩、第 2 趟
- [x] T8 接力（單人）：選自己跑哪一棒、其他棒 CPU、CPU 隊伍、成績；房間接力（每人一棒）
- [x] T9 精彩重播：成績畫面按鈕、依序播放、分享片段
- [x] T10 檢查、設計文件 §A.1／§0.7／§15、版本 2.85.0

## 自我檢查

- `core_check.js`（含 p3、p4）、`ui_check.js`、`ui_p3_check.js`、`ui_p4_check.js`、`split_css.py --check` 全部通過。
