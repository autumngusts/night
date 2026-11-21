# イヌスノー（inusnow）第 2 階段 Implementation Plan

> **For agentic workers:** 依 `docs/inusnow_design.md` §16、§17 實作。Steps 用 checkbox（`- [ ]`）追蹤。

**Goal:** 在第 1 階段的大曲道上，加上 Slopestyle（跳台、滑桿、轉體、抓板、評審、狗專屬技巧）、CPU 選手與「比賽模式」、Snowboard Cross（6 隻同場、碰撞）、S2 興奮度、G1 溝痕、M2 自由滑行、犬種 24 種；同時把畫面升級成有特效與動畫的版本（使用者 2026-11-21 要求「更精美的 UIUX、特效、動畫」）。

**Architecture:** 新賽事各自一個規則檔（`inusnow_slope.js`、`inusnow_cross.js`、`inusnow_free.js`），都遵守 §11 的確定性限制並加進 `core_check.js` 的原始碼掃描。地形附加物（跳台、波浪、護牆）用 `Terrain.withFeatures(terrain, feats)` 疊加解析形狀，不改格網。畫面特效（雪花、甩雪粒子、雪痕、陰影、鏡頭震動、轉場）全部只在 `inusnow_3d.js`／`inusnow.js`／CSS，用 `Math.random` 沒關係。

**Tech Stack:** 同第 1 階段（Vanilla ES5 IIFE、three.js r149、Node `assert`、Playwright）。

## Global Constraints

- 第 1 階段的全部限制（前綴、確定性、存檔鍵、付款分頁、只推 `private`）。
- Slopestyle／Cross 的雪道選段不連網：`tools/inusnow_data/add_events.js` 讀已提交的雪場 JSON 與格網高度，依 §17.1 選段後寫回 JSON（`events.slope`、`events.cross`、`<原id>sl`／`<原id>cx` 雪道）。大曲道雪道不變，所以第 1 階段的紀錄仍然有效（`dataVer` 不用遞增）。
- 紀錄格式向下相容：`z`（興奮度發動）時 code +476；第 1 階段的紀錄重播結果不變。
- 物理只在新輸入（`z`）或新的環境參數（`env.spinMul`、`env.grip`、溝痕）出現時才改變行為；大曲道練習模式的結果與第 1 階段完全相同（`core_check.js` 用舊的重播比對）。

## 檔案結構（新增／修改）

| 檔案 | 責任 |
|---|---|
| `static_src/inusnow_data.js` | 追加 `SLOPE`、`CROSS`、`ZOOM`、`RUT`、`FREE`、`CPU_AI`、24 犬種（含 `nose`）、`CPU` 名冊 24 隻 |
| `static_src/inusnow_terrain.js` | `withFeatures(terrain, feats)`；`height`／`normal` 疊加附加物 |
| `static_src/inusnow_phys.js` | 興奮度（`st.zoom`、`st.zoomT`、輸入 `z`）、`env.spinMul`、`env.rut`、`env.obstacles` |
| `static_src/inusnow_core.js` | `z` 的編碼、`zoomTick`、`raceSeed`、`cpuRoster`、`simCpuGs`、`makeRuts`、存檔追加欄位 |
| `static_src/inusnow_slope.js` | `makePark`、`newSlope`、`stepSlope`、技巧判定與計分、評審、CPU AI、重播 |
| `static_src/inusnow_cross.js` | `makeCross`、`newCross`、`stepCross`（6 隻同場、軟牆、碰撞）、CPU AI |
| `static_src/inusnow_free.js` | 樹（障礙）、骨頭、隱藏地點、雪道章、纜車上山 |
| `static_src/inusnow_fx.js` | 畫面特效：粒子、雪痕、雪花、陰影貼圖、天空（只負責畫面） |
| `static_src/inusnow_3d.js` | 附加物網格、多位選手、特效接線、技巧姿勢、自由滑行的全雪場地形 |
| `static_src/inusnow.js` | 賽事選擇、練習／比賽、HUD（速度表、興奮度、名次、技巧彈出）、成績（名次表、評審）、自由滑行小地圖 |
| `tools/inusnow_data/add_events.js` | Slopestyle 與 Cross 的選段（離線） |
| `tools/inusnow_check/core_check.js`、`ui_check.js` | 新規則與新畫面的檢查 |

## Task

- [x] T1 數值表與 24 犬種、CPU 名冊
- [x] T2 `withFeatures`、物理追加（興奮度、轉體倍率、溝痕）、紀錄 `z`
- [x] T3 `add_events.js` 選段，更新 8 個雪場 JSON 與 `index.json`
- [x] T4 Slopestyle 規則與 CPU；`core_check` 追加
- [x] T5 CPU 大曲道、比賽模式、溝痕；`core_check` 追加
- [x] T6 Cross 規則與 CPU；`core_check` 追加
- [x] T7 自由滑行規則；`core_check` 追加
- [ ] （延後）G2 嗅覺捷徑 → P3 開頭（設計 §0.5）
- [x] T8 3D：附加物、多選手、特效模組、姿勢
- [x] T9 UI：賽事選擇、HUD、成績、小地圖、轉場動畫；CSS
- [x] T10 `ui_check` 追加；設計文件 §A.1 更新、版本 2.83.0

## 自我檢查

- `node tools/inusnow_check/core_check.js`：第 1 階段的檢查全過＋新規則全過。
- `node tools/inusnow_check/ui_check.js`：各賽事都能用 `dispatchEvent` 走完。
- `py -3 tools/split_css.py --check` 通過。
