# イヌスノー（inusnow）第 5 階段 Implementation Plan

> 依 `docs/inusnow_design.md` §20 實作。實作與規格不同的地方記在設計文件 §0.8。

**Goal:** 技術等級與能力點、裝備（雪板、固定器、雪鏡、雪衣、雙板）、打蠟、雪場解鎖、收集章與稱號、主人好感度、犬種主場、換裝、公園編輯器、真實季節、溫泉與在地美食、疲勞、雙板物理與 3D。

**Architecture:**
- 規則：`inusnow_prog.js`（`PriTestInusnowProg`，確定性、不碰 DOM／localStorage）：經驗與升級、能力點、有效選手（犬種＋能力點＋主場＋疲勞＋美食＋裝備＋打蠟＋好感）、選手規格字串（`spec`，重播與分享用）、解鎖、季節、公園碼。
- 物理：`dog.gear`（轉向、空氣阻力、轉體、抓地、初速、蹲低減阻、雙板、μ 倍率）、`dog.zoomMul`；沒有這些欄位時與第 4 階段完全相同。
- Slopestyle：`opts.park`（自訂公園，4～8 個地形）。
- 畫面：`inusnow_ui5.js`（犬舍、商店分頁；設定畫面的溫泉、美食、公園編輯器；成績的經驗與解鎖）；`inusnow.js` 加 hook（選手、外觀、雪場鎖、成績的獎勵、紀錄的 `spec`、`/ski` 紀錄鍵）；`inusnow_3d.js` 的雙板與換裝、雪鏡的霧距、夢之雪的色調。

## Task

- [x] T1 數值表：`PROG`、`GEAR`、`WAX`、`UNLOCK`、`AFF`、`HOME`、`FOOD`、`ONSEN`、`COSMETIC`、`FATIGUE`、`SKI`、`PARKED`
- [x] T2 物理與 Core：裝備與雙板（反腳＝摔倒）、打蠟 μ、興奮度倍率、教練指令的好感倍率；標準選手不變
- [x] T3 `inusnow_prog.js`
- [x] T4 Slopestyle 自訂公園
- [x] T5 3D：雙板、換裝（雪衣、雪鏡、毛帽、狗靴）、雪鏡霧距、夢之雪
- [x] T6 `inusnow_ui5.js`：犬舍、商店、雪場鎖與季節、溫泉與美食、成績獎勵、公園編輯器、稱號與主場章
- [x] T7 `inusnow.js` hook：有效選手、`spec` 紀錄與分享碼、`/ski` 紀錄鍵
- [x] T8 `p5_check.js`、`ui_p5_check.js`；設計文件 §A.1／§0.8／§15；版本 2.86.0

## 自我檢查

- `core_check.js`（含 p3～p5）、`ui_check.js`、`ui_p3_check.js`、`ui_p4_check.js`、`ui_p5_check.js`、`split_css.py --check` 全部通過。
