# 煉金術士（atelier）第 4 階段 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> 使用者指定（2026-11-20）「繼續製作到結束」：本計畫只寫規格、介面與測試案例，完整程式碼以各 commit 為準。

**Goal:** 加入配色獎勵、虹素材、觀察道具、著色繪本、工房裝飾、店鋪與行情、季節色彩祭、稱號。

**Architecture:**
- 規則照舊放在 `atelier_core.js`。
- 繪本的線稿、季節主題色、稱號條件、配方價格放在 `atelier_data.js`；瑠璃的喜好放在 `atelier_hosts.js`。
- 畫面新增「繪本」分頁；店鋪、裝飾、稱號放在「工房」分頁。

**Tech Stack:** Vanilla ES5、Node `assert`、Playwright。

## Global Constraints

- 規則依據：`docs/atelier_design.md` §10。數值都是暫定。
- 第 1～3 階段的檢查必須維持通過，不能修改它們的期望值。
- 舊存檔由 `migrate()` 補上 `coins`、`coinsEarned`、`tools`、`coloring`、`pagesDone`、`deco`、`visitDate`、`titles`、`title`、`greatCount`。
- 繪本的線稿全部原創（簡單的矩形組合）。
- 版本 `2.78.0`。只推 `private main`。

## 介面（新增）

```js
Core.harmonyOf(swatches) → "triad"|"complementary"|"analogous"|null
Core.rainbowOf(rgba) → bool
Core.shiftHue(rgba, deg) → RGBA；Core.analyze(rgba, w, h, seed, opts?)   // opts = {k, minFrac}
Core.analyzeOpts(save) → {k, minFrac}（有放大鏡時 7 色、1.5%）
Core.captureEx(save, swatches, now, extra?)   // extra = {harmony, rainbow}；回傳新增 rainbow（虹之欠片）、season（季節色數）
Core.seasonOf(now) → "spring"|"summer"|"autumn"|"winter"；Core.isSeasonColor(colorId, now) → bool
Core.recipeAvailable(save, r, now?)   // 季節限定配方要傳 now 且季節相符
Core.colorRegion(save, pageId, regionId, matUid) → {ok, done}|{error: "page"|"region"|"material"|"group"|"filled"}
Core.pageProgress(save, pageId) → {filled, total}
Core.decoOptions(save) → [{ref, kind, label}]；Core.setDeco(save, slot, ref|null) → "like"|"dislike"|"ok"|null
Core.decoTaste(save, ref) → 1（喜歡）|-1（不喜歡）|0；Core.dailyVisit(save, now) → {aff}|null
Core.hotElement(now) → elementId；Core.priceOf(item, now) → 銀幣；Core.sell(save, uid, now) → 銀幣|null
Core.buyCatalyst(save, id) → bool；Core.buyBasket(save, now) → bool
Core.checkTitles(save) → [titleId]；Core.setTitle(save, id) → bool
```

## 測試案例（`tools/atelier_check/phase4_check.js`）

1. 配色：三角、互補、類似各舉一例；灰色系不算；同時符合時以三角優先。
2. 調和特性：有配色的照片採到的素材都帶「調和」。
3. 虹：12 色相條紋的圖判定為虹；兩色的圖不是。採集時多 1 個虹之欠片，每張照片只有 1 個。
4. 放大鏡：`analyzeOpts` 回傳 7 色、1.5%；5 色條紋的圖抓得出 7 個以下且比預設多。濾色：色相 +30°。
5. 觀察道具：做出放大鏡（效果 Lv1 以上）後 `tools.loupe === true`；效果 Lv0 不算。
6. 季節：11 月是秋、1 月是冬；拍到主題色帶「季節之彩」；季節配方只在當季可以調和。
7. 繪本：色系不符、已填過的區域會被拒絕；填色會用掉素材；全部填完時經驗 +30、灰燼 +5、`pagesDone`。
8. 裝飾：3 個位置；喜歡／不喜歡的判定；放著的成品不能賣；每天第一次開啟時好感度增加，同一天第二次沒有。
9. 店鋪：價格公式（品質、流行屬性、季節）；賣出後成品消失、銀幣增加、`coinsEarned` 累計；買觸媒和採集籃要扣銀幣，銀幣不足時失敗；採集籃滿了不能買。
10. 稱號：各條件達成後 `checkTitles` 回傳新的稱號，第二次不重複；`setTitle` 只能選已取得的稱號。
11. 遷移：舊存檔補上新欄位。

## Tasks

- [ ] **Task 1：數值**（線稿 4 頁、季節、稱號、價格、新特性、新配方 6 種：放大鏡、濾色眼鏡、4 種季節配方）＋**核心**＋測試 1～11
- [ ] **Task 2：畫面**：
  - 採色頁：顯示配色結果、虹的提示、濾色開關、季節主題色。
  - 繪本分頁：SVG 填色。
  - 工房分頁：店鋪（賣出、行情、買觸媒、補採集籃）、裝飾、稱號。
  - 頁首顯示稱號。
  - 新增 `tools/atelier_check/ui4_check.js`。
- [ ] **Task 3：版本 2.78.0，跑全部檢查，推送**
