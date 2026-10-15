# 東正小遊戲（toushou）第 1 階段 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 PriTest 首頁新增獨立的派對遊戲「東正小遊戲（toushou）」，第 1 階段為單機傳遞模式。

**Architecture:** 純資料 `toushou_data.js` → 純邏輯引擎 `toushou_core.js`（`reduce(state, action)`，無 DOM、可在 Node 以 `new Function` 載入測試）→ UI `toushou.js`（渲染＋localStorage）。頁面由 `site_src/toushou_page.py` 經 `layout.page_shell` 產生。所有隨機性由 state 內的 PRNG 狀態驅動，供第 2 階段同步使用。

**Tech Stack:** Python 3（建置）、Vanilla ES5 IIFE、Node（單元檢查）、Playwright（重用 `tools/midnight_check/node_modules`）。

**Spec:** `docs/superpowers/specs/2026-10-15-toushou-game-design.md`

## 修訂（2026-10-15，資料擬稿審核通過後）——優先於下方各 task 的對應內容

資料依 `docs/toushou_data_draft.md`（已審核）與 spec §7 重做，以下差異覆蓋原 task：

- **Task 1**：`toushou_data.js` 只放共用部分（`C`、`text`、`registerCategory`、通用牌 g01～g12、`WIND_COMPOSITION`、`MISSIONS`、`HAND_SIZE`、`START_PRICE`）；
  類別資料拆到 `toushou_data_sengoku.js`、`_celebrity.js`、`_company.js`、`_region.js`、`_food.js`、`_anime.js`，內容照擬稿並補日文。
  `CATEGORIES` 為 11 類（id 見 spec §7.1），`TARGETS` 每類 6 個，含 `summary`、`hooks`；`NEWS_CARDS` 帶 `category`（通用牌為 `null`）。
  檢查改為：11 類、每類 6 標的、每標的 2～3 tags／3 hooks／summary、通用牌 12＋專屬牌 66、`jp_celebrity.excludeCommonCards` 含 `g05`。
- **Task 2**：測試用類別改為 `sengoku_event`／`jp_company`；`pickRandomTargets([...],99,…)` 期望 6；`pickRandomTargets` 與 `newGame` 保留 `summary`、`hooks`；
  牌堆＝通用牌＋本局出現類別的專屬牌，`k = max(1, ceil(人數×6 / 牌池張數))`。
- **Task 4**：新增 `cardPlayable(state, cardId) → bool`（spec §7.3）；`newsError(state, playerId, cardId, text, edited)` 多一個參數，
  未改寫打出不可直接打出的牌時回傳 `"ts_err_card_mismatch"`。
- **Task 6/7**：設定畫面列出 11 類；標的卡顯示 `summary`、`tags`、`hooks`；手牌文字以 `{target}` 代入目前標的名稱；
  不可直接打出的牌隱藏「直接打出」按鈕；新增 i18n `ts_err_card_mismatch`、`ts_hooks`、`ts_summary`。
- 執行方式：在本對話中直接執行（未分派子代理）。

## Global Constraints

- 所有 JS 為 Vanilla **ES5**（`var`、`function`，不用箭頭函式、`let/const`、template literal、class）；IIFE 掛到 `window`。
- 全域名稱：`window.PriTestToushouData`、`window.PriTestToushouCore`、`window.PriTestToushou`。
- localStorage key：`pritest-toushou-state`；所有讀寫包在 try/catch。
- i18n key 前綴 `ts_`；首頁 key `project_toushou_name` / `project_toushou_desc`。遊戲資料文字用 `{ ja, zh }`，顯示時 `zh` 用 zh，其他語言（ja/en）用 ja。
- 起始股價 **100**；股價下限 0；手牌 **5** 張；風向卡比例 利多 2：利空 2：中立 1。
- 彩池分配百分比：n=1 → [100]、n=2 → [100]、n=3 → [70,30]、n≥4 → [60,30,10]；並列合併名次比例平分；每人 `floor`，零頭給排序第一位（誤差最小、並列時座位最前）。
- 最低押注預設：全員一致時＝初始籌碼的 10%（floor，至少 1）；個別設定時＝100。
- 人數 2～10；標的數 1～20。
- 不修改 night／midnight 任何程式，不修改 `database.rules.json`。
- 每次修改 `site_src/` 或 `static_src/` 後執行 `py -3 generate.py`（Windows 上 `python` 是 Python 2，**一律用 `py -3`**）。
- Commit message 用繁體中文，結尾加：
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01GEL9yEmxj19zSU6yuqvmMY
  ```

### 與 spec 的實作層級調整（已知、刻意）

- spec §2 寫「規則引擎與渲染在同一個 `toushou.js`」；本計畫拆成 `toushou_core.js`（純邏輯）＋`toushou.js`（UI），以便在 Node 直接測試 reducer。對外行為不變，`window.PriTestToushou._debugState()` 仍存在。
- 消息牌只有約 20 張暫定範例，但 10 人需要 50 張開局手牌：牌堆以「每張牌複製 k 份」組成，`k = max(1, ceil(人數 × 6 / 牌數))`。
- 回歸測試依本 repo 慣例放在 `tools/toushou_check/` 並提交。

---

## File Structure

| 檔案 | 職責 |
| --- | --- |
| Create `static_src/toushou_data.js` | 類別、標的池、消息牌、任務卡、`text(obj, lang)` |
| Create `static_src/toushou_core.js` | PRNG、`newGame`、`reduce`、驗證函式、`settleTarget`、`evaluateMissions`、`finalStandings`、`pickRandomTargets` |
| Create `static_src/toushou.js` | 設定表單、各階段畫面、傳遞遮蔽、存讀檔 |
| Create `site_src/toushou_page.py` | `build_toushou_html()` |
| Modify `generate.py` | copy list、`build_pages()`、`main()` 清理清單 |
| Modify `site_src/projects.py` | 首頁入口 |
| Modify `site_src/i18n_data_zh.py` / `_ja.py` / `_en.py` | UI 文字 |
| Modify `static_src/style.css` | `.ts-*` 樣式（附加在檔尾） |
| Create `tools/toushou_check/core_check.js` | Node 單元檢查（資料＋引擎） |
| Create `tools/toushou_check/ui_check.js` | Playwright 整局流程檢查 |

---

### Task 1: 資料模組 `toushou_data.js` ＋ 檢查腳本骨架

**Files:**
- Create: `static_src/toushou_data.js`
- Create: `tools/toushou_check/core_check.js`

**Interfaces:**
- Produces: `window.PriTestToushouData = { CATEGORIES, TARGETS, NEWS_CARDS, WIND_COMPOSITION, MISSIONS, HAND_SIZE, START_PRICE, text }`
  - `CATEGORIES`: `[{ id, name:{ja,zh}, role:{ja,zh} }]`，id ∈ `history|person|company|scenery|item`
  - `TARGETS`: `[{ id, category, name:{ja,zh}, tags:[{ja,zh}] }]`
  - `NEWS_CARDS`: `[{ id, tone:"up"|"down"|"neutral", text:{ja,zh} }]`
  - `WIND_COMPOSITION`: `{ up:2, down:2, neutral:1 }`
  - `MISSIONS`: `[{ id, check, params, reward, text:{ja,zh} }]`（text 內可含 `{count}` 等 placeholder）
  - `text(obj, lang)` → string

- [ ] **Step 1: 寫失敗的檢查腳本**

`tools/toushou_check/core_check.js`：

```js
// ============================================================================
// toushou（東正小遊戲）資料與規則引擎的 Node 單元檢查。
// 不需要瀏覽器：用 new Function 在假的 window 上載入 static_src 的檔案。
// 刻意不用 vm.createContext：不同 realm 的物件 prototype 不同，assert.deepStrictEqual 會誤判。
// 執行：node tools/toushou_check/core_check.js
// ============================================================================
"use strict";
var fs = require("fs");
var path = require("path");
var assert = require("assert");

var SRC = path.join(__dirname, "..", "..", "static_src");

function load(files) {
  var win = {};
  files.forEach(function (f) {
    new Function("window", fs.readFileSync(path.join(SRC, f), "utf8"))(win);
  });
  return win;
}

var results = { pass: 0, fail: 0 };
function check(name, fn) {
  try {
    fn();
    results.pass++;
    console.log("  ok   " + name);
  } catch (err) {
    results.fail++;
    console.log("  FAIL " + name + "\n       " + (err && err.message));
  }
}

var hasCore = fs.existsSync(path.join(SRC, "toushou_core.js"));
var w = load(hasCore ? ["toushou_data.js", "toushou_core.js"] : ["toushou_data.js"]);
var D = w.PriTestToushouData;
var Core = w.PriTestToushouCore;

console.log("[data]");
check("data module loaded", function () { assert.ok(D, "PriTestToushouData missing"); });
check("five categories with role names", function () {
  assert.deepStrictEqual(D.CATEGORIES.map(function (c) { return c.id; }),
    ["history", "person", "company", "scenery", "item"]);
  D.CATEGORIES.forEach(function (c) { assert.ok(c.role.zh && c.role.ja, c.id); });
  assert.strictEqual(D.CATEGORIES[2].role.zh, "股東");
  assert.strictEqual(D.CATEGORIES[4].role.zh, "黃牛");
  assert.strictEqual(D.CATEGORIES[0].role.zh, "投資客");
});
check("every category has >= 8 targets with 2+ tags, unique ids", function () {
  var ids = {};
  D.CATEGORIES.forEach(function (c) {
    var list = D.TARGETS.filter(function (t) { return t.category === c.id; });
    assert.ok(list.length >= 8, c.id + " has " + list.length);
  });
  D.TARGETS.forEach(function (t) {
    assert.ok(!ids[t.id], "dup " + t.id); ids[t.id] = 1;
    assert.ok(t.name.zh && t.name.ja, t.id);
    assert.ok(t.tags.length >= 2, t.id);
  });
});
check(">= 20 news cards with valid tone", function () {
  assert.ok(D.NEWS_CARDS.length >= 20);
  D.NEWS_CARDS.forEach(function (c) {
    assert.ok(["up", "down", "neutral"].indexOf(c.tone) >= 0, c.id);
    assert.ok(c.text.zh && c.text.ja, c.id);
  });
});
check("8 missions with known checks", function () {
  var known = ["firstPlaceAtLeast", "exactHit", "categoryRiseAtLeast", "anyTargetCrash",
    "finalRank", "allInOnce", "contrarian", "ownNewsSwing"];
  assert.strictEqual(D.MISSIONS.length, 8);
  D.MISSIONS.forEach(function (m) {
    assert.ok(known.indexOf(m.check) >= 0, m.id);
    assert.ok(m.reward > 0, m.id);
  });
});
check("constants", function () {
  assert.strictEqual(D.HAND_SIZE, 5);
  assert.strictEqual(D.START_PRICE, 100);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(D.WIND_COMPOSITION)), { up: 2, down: 2, neutral: 1 });
});
check("text() picks zh for zh, ja otherwise", function () {
  var o = { ja: "J", zh: "Z" };
  assert.strictEqual(D.text(o, "zh"), "Z");
  assert.strictEqual(D.text(o, "ja"), "J");
  assert.strictEqual(D.text(o, "en"), "J");
  assert.strictEqual(D.text({ ja: "", zh: "Z" }, "ja"), "Z");
});

// [core] 區塊由後續 task 追加在此標記之後
// @@CORE_CHECKS@@

console.log("\n" + results.pass + " passed, " + results.fail + " failed");
process.exit(results.fail ? 1 : 0);
```

- [ ] **Step 2: 執行確認失敗**

Run: `node tools/toushou_check/core_check.js`
Expected: 拋出 `ENOENT ... toushou_data.js`（檔案不存在）。

- [ ] **Step 3: 實作 `static_src/toushou_data.js`**

```js
// 東正小遊戲（toushou）的純資料：類別、標的池、消息牌、任務卡。
// 這裡不放任何規則邏輯；規則在 toushou_core.js。
// NEWS_CARDS 為「暫定範例」，正式牌表由使用者提供後替換。
(function () {
  "use strict";

  function C(ja, zh) { return { ja: ja, zh: zh }; }

  // 依目前語言取文字：zh 用 zh，其他（ja/en）用 ja；缺值時互相 fallback。
  function text(obj, lang) {
    if (!obj) return "";
    if (lang === "zh") return obj.zh || obj.ja || "";
    return obj.ja || obj.zh || "";
  }

  var CATEGORIES = [
    { id: "history", name: C("歴史", "歷史"), role: C("投資家", "投資客") },
    { id: "person", name: C("人物", "人名"), role: C("投資家", "投資客") },
    { id: "company", name: C("企業", "公司行號"), role: C("株主", "股東") },
    { id: "scenery", name: C("風景", "風景"), role: C("投資家", "投資客") },
    { id: "item", name: C("物品", "物品"), role: C("転売屋", "黃牛") }
  ];

  function T(id, category, name, tags) {
    return { id: id, category: category, name: name, tags: tags };
  }

  var TARGETS = [
    T("h01", "history", C("春秋戦国", "春秋戰國"), [C("戦乱", "戰亂"), C("百家争鳴", "百家爭鳴")]),
    T("h02", "history", C("大航海時代", "大航海時代"), [C("探検", "探險"), C("交易", "貿易")]),
    T("h03", "history", C("産業革命", "工業革命"), [C("蒸気機関", "蒸汽機"), C("工場", "工廠")]),
    T("h04", "history", C("ルネサンス", "文藝復興"), [C("芸術", "藝術"), C("人文主義", "人文主義")]),
    T("h05", "history", C("シルクロード", "絲路"), [C("隊商", "商隊"), C("東西交流", "東西交流")]),
    T("h06", "history", C("ゴールドラッシュ", "淘金熱"), [C("一攫千金", "一夜致富"), C("移民", "移民")]),
    T("h07", "history", C("アポロ計画", "阿波羅計畫"), [C("宇宙", "太空"), C("冷戦", "冷戰")]),
    T("h08", "history", C("チューリップ・バブル", "鬱金香泡沫"), [C("投機", "投機"), C("崩壊", "崩盤")]),
    T("p01", "person", C("諸葛亮", "諸葛亮"), [C("軍師", "軍師"), C("知略", "智謀")]),
    T("p02", "person", C("ナポレオン", "拿破崙"), [C("皇帝", "皇帝"), C("遠征", "遠征")]),
    T("p03", "person", C("レオナルド・ダ・ヴィンチ", "達文西"), [C("万能", "全才"), C("発明", "發明")]),
    T("p04", "person", C("クレオパトラ", "埃及豔后"), [C("女王", "女王"), C("外交", "外交")]),
    T("p05", "person", C("織田信長", "織田信長"), [C("革新", "革新"), C("天下統一", "天下統一")]),
    T("p06", "person", C("ニコラ・テスラ", "特斯拉（發明家）"), [C("電気", "電力"), C("天才", "天才")]),
    T("p07", "person", C("武則天", "武則天"), [C("女帝", "女帝"), C("権力", "權力")]),
    T("p08", "person", C("シェイクスピア", "莎士比亞"), [C("劇作家", "劇作家"), C("名言", "名言")]),
    T("c01", "company", C("老舗の茶屋", "百年老茶行"), [C("伝統", "傳統"), C("観光", "觀光")]),
    T("c02", "company", C("新興AIスタートアップ", "新創AI公司"), [C("話題性", "話題性"), C("赤字", "燒錢")]),
    T("c03", "company", C("町の定食屋", "巷口便當店"), [C("常連", "老顧客"), C("安い", "便宜")]),
    T("c04", "company", C("宇宙旅行会社", "太空旅遊公司"), [C("夢", "夢想"), C("高リスク", "高風險")]),
    T("c05", "company", C("ゲームメーカー", "遊戲公司"), [C("新作", "新作"), C("延期", "延期")]),
    T("c06", "company", C("コンビニチェーン", "便利商店連鎖"), [C("24時間", "24小時"), C("新商品", "新商品")]),
    T("c07", "company", C("海運会社", "航運公司"), [C("運賃", "運價"), C("景気", "景氣")]),
    T("c08", "company", C("タピオカ店", "珍奶店"), [C("流行", "流行"), C("行列", "排隊")]),
    T("s01", "scenery", C("富士山", "富士山"), [C("雪化粧", "雪景"), C("登山", "登山")]),
    T("s02", "scenery", C("日月潭", "日月潭"), [C("湖", "湖泊"), C("サイクリング", "單車")]),
    T("s03", "scenery", C("グランドキャニオン", "大峽谷"), [C("絶景", "絕景"), C("砂漠", "荒漠")]),
    T("s04", "scenery", C("オーロラ", "極光"), [C("寒冷", "嚴寒"), C("運次第", "看運氣")]),
    T("s05", "scenery", C("万里の長城", "萬里長城"), [C("世界遺産", "世界遺產"), C("混雑", "人潮")]),
    T("s06", "scenery", C("モルディブの海", "馬爾地夫海灘"), [C("リゾート", "度假"), C("水没危機", "海平面上升")]),
    T("s07", "scenery", C("京都の紅葉", "京都楓葉"), [C("季節限定", "季節限定"), C("寺院", "寺院")]),
    T("s08", "scenery", C("阿里山の日の出", "阿里山日出"), [C("早起き", "早起"), C("雲海", "雲海")]),
    T("i01", "item", C("限定スニーカー", "限量球鞋"), [C("抽選", "抽籤"), C("コラボ", "聯名")]),
    T("i02", "item", C("コンサートチケット", "演唱會門票"), [C("完売", "秒殺"), C("転売", "轉售")]),
    T("i03", "item", C("最新スマホ", "最新手機"), [C("発売日", "首賣"), C("品薄", "缺貨")]),
    T("i04", "item", C("ヴィンテージ時計", "古董錶"), [C("希少", "稀有"), C("鑑定", "鑑定")]),
    T("i05", "item", C("トレカの初版", "初版卡牌"), [C("美品", "美品"), C("人気", "人氣")]),
    T("i06", "item", C("福袋", "福袋"), [C("中身不明", "內容未知"), C("お得", "划算")]),
    T("i07", "item", C("ゲーム機", "遊戲主機"), [C("新型", "新機型"), C("在庫", "庫存")]),
    T("i08", "item", C("高級マスクメロン", "頂級哈密瓜"), [C("贈答", "送禮"), C("旬", "當季")])
  ];

  function N(id, tone, ja, zh) { return { id: id, tone: tone, text: C(ja, zh) }; }

  // 暫定範例（正式牌表由使用者提供）
  var NEWS_CARDS = [
    N("n01", "up", "有名人が絶賛した", "名人公開大力推薦"),
    N("n02", "up", "大きな賞を受賞した", "獲得重量級大獎"),
    N("n03", "up", "SNSで大バズり", "在社群上爆紅"),
    N("n04", "up", "海外から大口の注文", "接到海外大訂單"),
    N("n05", "up", "限定コラボが決定", "宣布限定聯名合作"),
    N("n06", "up", "新発見があった", "出現驚人的新發現"),
    N("n07", "up", "政府の補助が決まった", "獲得政府補助"),
    N("n08", "down", "スキャンダル発覚", "爆出醜聞"),
    N("n09", "down", "偽物が大量に出回る", "市面出現大量仿冒品"),
    N("n10", "down", "責任者が辞任", "負責人突然請辭"),
    N("n11", "down", "安全性に疑問の声", "傳出安全疑慮"),
    N("n12", "down", "ライバルが急成長", "競爭對手急起直追"),
    N("n13", "down", "天災の影響を受けた", "受到天災影響"),
    N("n14", "down", "ブームが去ったとの噂", "傳聞熱潮已退"),
    N("n15", "neutral", "専門家の意見が割れている", "專家意見分歧"),
    N("n16", "neutral", "近く重大発表があるらしい", "據說近期將有重大宣布"),
    N("n17", "neutral", "大物投資家が動いたらしい", "傳聞大戶正在進場或出場"),
    N("n18", "neutral", "ドキュメンタリーが制作中", "紀錄片正在拍攝中"),
    N("n19", "neutral", "古い資料が見つかった", "找到一批舊資料"),
    N("n20", "neutral", "テレビの特集が組まれる", "電視即將推出專題")
  ];

  var WIND_COMPOSITION = { up: 2, down: 2, neutral: 1 };

  function M(id, check, params, reward, ja, zh) {
    return { id: id, check: check, params: params, reward: reward, text: C(ja, zh) };
  }

  // params 中 category 為 null 時，發任務時由引擎從本局標的的類別中隨機指定。
  var MISSIONS = [
    M("m_first", "firstPlaceAtLeast", { count: 2 }, 300,
      "第1位（同率含む）を{count}回以上取る", "拿到第 1 名（含並列）{count} 次以上"),
    M("m_exact", "exactHit", { within: 5 }, 300,
      "予想価格と最終株価の差が{within}以内を1回以上", "至少一次預測價與最終股價誤差 ≤ {within}"),
    M("m_catrise", "categoryRiseAtLeast", { category: null, price: 150 }, 200,
      "「{category}」の銘柄の最終株価が{price}以上になる", "「{category}」類標的中有最終股價 ≥ {price}"),
    M("m_crash", "anyTargetCrash", { price: 40 }, 200,
      "いずれかの銘柄の最終株価が{price}以下になる", "任一標的最終股價 ≤ {price}"),
    M("m_rank2", "finalRank", { rank: 2 }, 300,
      "最終チップ（任務報酬を除く）で第{rank}位", "最終籌碼（不含任務獎勵）為第 {rank} 名"),
    M("m_allin", "allInOnce", { pct: 80 }, 300,
      "手持ちの{pct}%以上を賭けて利益を出す（1回以上）", "至少一次押注 ≥ 當時籌碼的 {pct}% 且獲利"),
    M("m_contra", "contrarian", {}, 300,
      "過半数が騰落の方向を外した銘柄で、自分は当てる（1回以上）", "至少一次：過半數人猜錯漲跌方向，而自己猜對"),
    M("m_swing", "ownNewsSwing", { abs: 30 }, 200,
      "自分の発表で株価が一度に{abs}以上動く", "自己釋放的消息讓股價一次變動 ≥ {abs}")
  ];

  window.PriTestToushouData = {
    CATEGORIES: CATEGORIES,
    TARGETS: TARGETS,
    NEWS_CARDS: NEWS_CARDS,
    WIND_COMPOSITION: WIND_COMPOSITION,
    MISSIONS: MISSIONS,
    HAND_SIZE: 5,
    START_PRICE: 100,
    text: text
  };
})();
```

- [ ] **Step 4: 執行確認通過**

Run: `node --check static_src/toushou_data.js && node tools/toushou_check/core_check.js`
Expected: `7 passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
git add static_src/toushou_data.js tools/toushou_check/core_check.js
git commit -m "feat(toushou): 新增標的池／暫定消息牌／任務卡資料模組與檢查腳本"
```
（加上 Global Constraints 的兩行結尾）

---

### Task 2: 引擎 — PRNG、開局 `newGame`、隨機標的

**Files:**
- Create: `static_src/toushou_core.js`
- Modify: `tools/toushou_check/core_check.js`（在 `// @@CORE_CHECKS@@` 之後追加）

**Interfaces:**
- Consumes: `PriTestToushouData`（Task 1）
- Produces（`window.PriTestToushouCore`）：
  - `pickRandomTargets(categoryIds: string[], count: number, seed: number) → [{category, name:{ja,zh}, tags:[{ja,zh}], custom:false, sourceId}]`（不重複，池不足時回傳全部）
  - `newGame(config) → state`
    - `config = { players:[{name, chips}], targets:[{category, name, tags, custom}], missionsEnabled:bool, windEnabled:bool, minBet:int, seed:int }`
    - `name`／`tags` 允許兩種：資料物件 `{ja,zh}` 或純字串（手動輸入）。
  - `defaultMinBet(chipsMode: "same"|"each", chips: int) → int`
  - `roleFor(category) → {ja,zh}`
  - state 形狀（後續 task 共用）：

```js
{
  version: 1,
  phase: "missions" | "reveal_target" | "bet" | "news" | "vote" | "settle" | "final",
  config: { missionsEnabled, windEnabled, minBet },
  players: [{ id: "p0", name, chips, hand: [cardId], mission: null | { id, params } }],
  deck: [cardId], discard: [cardId], windDeck: ["up"|"down"|"neutral"],
  targets: [{ id: "t0", category, name, tags, custom }],
  targetIndex: 0,
  current: null | {
    price, bettors: [playerId], bets: { [pid]: { amount, predict, chipsBefore } }, pot,
    order: [playerId], turnIndex, wind, pending: null | { playerId, cardId, edited, text },
    news: [{ playerId, cardId, edited, text, wind, delta, priceAfter }]
  },
  history: [{ targetId, category, name, tags, finalPrice, pot, bets, ranks, payouts, news }],
  lastSettlement: null | <history entry>,
  rng: <uint32>
}
```

- [ ] **Step 1: 追加失敗的檢查**

在 `core_check.js` 的 `// @@CORE_CHECKS@@` 這行**之後**插入：

```js
console.log("[core: newGame]");
function baseConfig(n, extra) {
  var players = [];
  for (var i = 0; i < n; i++) players.push({ name: "P" + i, chips: 1000 });
  var cfg = {
    players: players,
    targets: Core.pickRandomTargets(["history", "company"], 3, 42),
    missionsEnabled: false, windEnabled: false, minBet: 100, seed: 12345
  };
  Object.keys(extra || {}).forEach(function (k) { cfg[k] = extra[k]; });
  return cfg;
}
check("core loaded", function () { assert.ok(Core, "PriTestToushouCore missing"); });
check("pickRandomTargets: unique, from chosen categories, deterministic", function () {
  var a = Core.pickRandomTargets(["history", "item"], 5, 7);
  var b = Core.pickRandomTargets(["history", "item"], 5, 7);
  assert.strictEqual(a.length, 5);
  assert.deepStrictEqual(a, b);
  var ids = a.map(function (t) { return t.sourceId; });
  assert.strictEqual(new Set(ids).size, 5);
  a.forEach(function (t) { assert.ok(t.category === "history" || t.category === "item"); });
  assert.strictEqual(Core.pickRandomTargets(["history"], 99, 1).length, 8);
});
check("newGame: players, hands of 5, phase reveal_target without missions", function () {
  var s = Core.newGame(baseConfig(3));
  assert.strictEqual(s.version, 1);
  assert.strictEqual(s.phase, "reveal_target");
  assert.strictEqual(s.players.length, 3);
  s.players.forEach(function (p, i) {
    assert.strictEqual(p.id, "p" + i);
    assert.strictEqual(p.chips, 1000);
    assert.strictEqual(p.hand.length, 5);
    assert.strictEqual(p.mission, null);
  });
  assert.strictEqual(s.targets.length, 3);
  assert.strictEqual(s.targets[0].id, "t0");
  assert.strictEqual(s.targetIndex, 0);
  assert.strictEqual(s.current, null);
  assert.deepStrictEqual(s.history, []);
});
check("newGame: deck copies cover 10 players", function () {
  var s = Core.newGame(baseConfig(10));
  s.players.forEach(function (p) { assert.strictEqual(p.hand.length, 5); });
  var total = s.deck.length + s.players.length * 5;
  assert.strictEqual(total, D.NEWS_CARDS.length * 3); // k = ceil(60/20) = 3
});
check("newGame: missions phase, unique missions, category resolved", function () {
  var s = Core.newGame(baseConfig(4, { missionsEnabled: true }));
  assert.strictEqual(s.phase, "missions");
  var ids = s.players.map(function (p) { return p.mission.id; });
  assert.strictEqual(new Set(ids).size, 4);
  s.players.forEach(function (p) {
    if (p.mission.id === "m_catrise") assert.ok(["history", "company"].indexOf(p.mission.params.category) >= 0);
  });
});
check("newGame: deterministic for same seed", function () {
  assert.deepStrictEqual(Core.newGame(baseConfig(4)), Core.newGame(baseConfig(4)));
});
check("newGame: string names and tags accepted", function () {
  var cfg = baseConfig(2);
  cfg.targets = [{ category: "item", name: "我的杯子", tags: ["舊", "可愛"], custom: true }];
  var s = Core.newGame(cfg);
  assert.strictEqual(s.targets[0].name, "我的杯子");
  assert.strictEqual(s.targets[0].custom, true);
});
check("defaultMinBet and roleFor", function () {
  assert.strictEqual(Core.defaultMinBet("same", 1000), 100);
  assert.strictEqual(Core.defaultMinBet("same", 5), 1);
  assert.strictEqual(Core.defaultMinBet("each", 1000), 100);
  assert.strictEqual(Core.roleFor("item").zh, "黃牛");
});
```

- [ ] **Step 2: 執行確認失敗**

Run: `node tools/toushou_check/core_check.js`
Expected: `FAIL core loaded`（以及其後的 core 檢查失敗）。

- [ ] **Step 3: 實作 `static_src/toushou_core.js`（本 task 部分）**

```js
// 東正小遊戲（toushou）規則引擎。純邏輯，不碰 DOM。
// 所有狀態變更都經過 reduce(state, action)：先深複製再修改，回傳新 state。
// 隨機性只來自 state.rng（mulberry32），使同一串 action 在任何裝置上結果一致
// （第 2 階段多裝置同步需要這個特性）。
(function () {
  "use strict";

  var D = window.PriTestToushouData;

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  // mulberry32：推進 holder.rng 並回傳 [0,1) 的數
  function rand(holder) {
    holder.rng = (holder.rng + 0x6D2B79F5) >>> 0;
    var t = holder.rng;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function shuffle(holder, arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rand(holder) * (i + 1));
      var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
    }
    return a;
  }

  function pickRandomTargets(categoryIds, count, seed) {
    var holder = { rng: seed >>> 0 };
    var pool = D.TARGETS.filter(function (t) { return categoryIds.indexOf(t.category) >= 0; });
    return shuffle(holder, pool).slice(0, count).map(function (t) {
      return { category: t.category, name: clone(t.name), tags: clone(t.tags), custom: false, sourceId: t.id };
    });
  }

  function defaultMinBet(chipsMode, chips) {
    if (chipsMode === "same") return Math.max(1, Math.floor(chips / 10));
    return 100;
  }

  function roleFor(category) {
    for (var i = 0; i < D.CATEGORIES.length; i++) {
      if (D.CATEGORIES[i].id === category) return D.CATEGORIES[i].role;
    }
    return D.CATEGORIES[0].role;
  }

  function buildWindDeck(holder) {
    var arr = [];
    Object.keys(D.WIND_COMPOSITION).forEach(function (k) {
      for (var i = 0; i < D.WIND_COMPOSITION[k]; i++) arr.push(k);
    });
    return shuffle(holder, arr);
  }

  // 從牌堆抽 1 張；牌堆空時把棄牌堆洗回；兩者皆空回傳 null
  function drawCard(s) {
    if (!s.deck.length && s.discard.length) {
      s.deck = shuffle(s, s.discard);
      s.discard = [];
    }
    return s.deck.length ? s.deck.pop() : null;
  }

  function newGame(config) {
    var s = {
      version: 1,
      phase: "reveal_target",
      config: {
        missionsEnabled: !!config.missionsEnabled,
        windEnabled: !!config.windEnabled,
        minBet: config.minBet
      },
      players: [],
      deck: [],
      discard: [],
      windDeck: [],
      targets: [],
      targetIndex: 0,
      current: null,
      history: [],
      lastSettlement: null,
      rng: config.seed >>> 0
    };
    config.players.forEach(function (p, i) {
      s.players.push({ id: "p" + i, name: p.name, chips: p.chips, hand: [], mission: null });
    });
    config.targets.forEach(function (t, i) {
      s.targets.push({ id: "t" + i, category: t.category, name: t.name, tags: t.tags || [], custom: !!t.custom });
    });

    // 牌數不足 10 人開局時，每張牌複製 k 份
    var k = Math.max(1, Math.ceil(s.players.length * 6 / D.NEWS_CARDS.length));
    var ids = [];
    for (var c = 0; c < k; c++) {
      D.NEWS_CARDS.forEach(function (card) { ids.push(card.id); });
    }
    s.deck = shuffle(s, ids);
    for (var r = 0; r < D.HAND_SIZE; r++) {
      s.players.forEach(function (p) {
        var card = drawCard(s);
        if (card) p.hand.push(card);
      });
    }
    s.windDeck = buildWindDeck(s);

    if (s.config.missionsEnabled) {
      var cats = [];
      s.targets.forEach(function (t) { if (cats.indexOf(t.category) < 0) cats.push(t.category); });
      var missions = shuffle(s, D.MISSIONS);
      s.players.forEach(function (p, i) {
        var m = missions[i % missions.length];
        var params = clone(m.params);
        if (Object.prototype.hasOwnProperty.call(params, "category") && params.category === null) {
          params.category = cats[Math.floor(rand(s) * cats.length)];
        }
        p.mission = { id: m.id, params: params };
      });
      s.phase = "missions";
    }
    return s;
  }

  // @@CORE_MORE@@  （後續 task 在此標記之前追加函式）

  window.PriTestToushouCore = {
    pickRandomTargets: pickRandomTargets,
    defaultMinBet: defaultMinBet,
    roleFor: roleFor,
    newGame: newGame
    // @@CORE_EXPORTS@@
  };
})();
```

> 注意：`// @@CORE_MORE@@` 與 `// @@CORE_EXPORTS@@` 是給後續 task 定位用的標記，最後一個 task（Task 5）會把它們刪掉。

- [ ] **Step 4: 執行確認通過**

Run: `node --check static_src/toushou_core.js && node tools/toushou_check/core_check.js`
Expected: `15 passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
git add static_src/toushou_core.js tools/toushou_check/core_check.js
git commit -m "feat(toushou): 規則引擎開局（PRNG、發牌、任務、隨機標的）"
```

---

### Task 3: 引擎 — `reduce` 骨架、任務確認、開始下注、下注

**Files:**
- Modify: `static_src/toushou_core.js`
- Modify: `tools/toushou_check/core_check.js`

**Interfaces:**
- Consumes: Task 2 的 `newGame`、state 形狀、`drawCard`、`shuffle`、`rand`、`clone`
- Produces:
  - `reduce(state, action) → newState`；無效 action 時 `throw new Error(<i18n key>)`
  - actions：`{type:"missionsDone"}`、`{type:"startBetting"}`、`{type:"placeBet", playerId, amount, predict}`
  - `betError(state, playerId, amount, predict) → null | "ts_err_bet_min" | "ts_err_bet_max" | "ts_err_int" | "ts_err_predict" | "ts_err_not_your_turn"`
  - `nextBettor(state) → playerId | null`
  - 內部 `enterNewsTurn(s)`（Task 4 定義實作，本 task 先放佔位呼叫：全員下注完成後設 `phase="news"` 並呼叫它）

- [ ] **Step 1: 追加失敗的檢查**（接在 Task 2 的檢查之後）

```js
console.log("[core: bet]");
function started(n, extra) {
  var s = Core.newGame(baseConfig(n, extra));
  if (s.phase === "missions") s = Core.reduce(s, { type: "missionsDone" });
  return Core.reduce(s, { type: "startBetting" });
}
check("missionsDone moves to reveal_target", function () {
  var s = Core.newGame(baseConfig(2, { missionsEnabled: true }));
  s = Core.reduce(s, { type: "missionsDone" });
  assert.strictEqual(s.phase, "reveal_target");
});
check("reduce does not mutate input", function () {
  var s = Core.newGame(baseConfig(2));
  var snap = JSON.stringify(s);
  Core.reduce(s, { type: "startBetting" });
  assert.strictEqual(JSON.stringify(s), snap);
});
check("startBetting: price 100, all players bettors, pot 0", function () {
  var s = started(3);
  assert.strictEqual(s.phase, "bet");
  assert.strictEqual(s.current.price, 100);
  assert.deepStrictEqual(s.current.bettors, ["p0", "p1", "p2"]);
  assert.strictEqual(s.current.pot, 0);
  assert.strictEqual(Core.nextBettor(s), "p0");
});
check("betError validations", function () {
  var s = started(2);
  assert.strictEqual(Core.betError(s, "p1", 100, 100), "ts_err_not_your_turn");
  assert.strictEqual(Core.betError(s, "p0", 50, 100), "ts_err_bet_min");
  assert.strictEqual(Core.betError(s, "p0", 1001, 100), "ts_err_bet_max");
  assert.strictEqual(Core.betError(s, "p0", 100.5, 100), "ts_err_int");
  assert.strictEqual(Core.betError(s, "p0", 100, -1), "ts_err_predict");
  assert.strictEqual(Core.betError(s, "p0", 100, 1.5), "ts_err_predict");
  assert.strictEqual(Core.betError(s, "p0", 100, 0), null);
});
check("placeBet deducts chips, fills pot, advances bettor", function () {
  var s = started(2);
  s = Core.reduce(s, { type: "placeBet", playerId: "p0", amount: 300, predict: 120 });
  assert.strictEqual(s.players[0].chips, 700);
  assert.strictEqual(s.current.pot, 300);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(s.current.bets.p0)), { amount: 300, predict: 120, chipsBefore: 1000 });
  assert.strictEqual(Core.nextBettor(s), "p1");
  assert.throws(function () { Core.reduce(s, { type: "placeBet", playerId: "p0", amount: 100, predict: 1 }); }, /ts_err_not_your_turn/);
});
check("all bets placed -> news phase", function () {
  var s = started(2);
  s = Core.reduce(s, { type: "placeBet", playerId: "p0", amount: 100, predict: 100 });
  s = Core.reduce(s, { type: "placeBet", playerId: "p1", amount: 100, predict: 100 });
  assert.strictEqual(s.phase, "news");
});
check("poor player may go all-in below minBet; broke player skipped", function () {
  var s = Core.newGame(baseConfig(3));
  s.players[1].chips = 40;
  s.players[2].chips = 0;
  s = Core.reduce(s, { type: "startBetting" });
  assert.deepStrictEqual(s.current.bettors, ["p0", "p1"]);
  s = Core.reduce(s, { type: "placeBet", playerId: "p0", amount: 100, predict: 100 });
  assert.strictEqual(Core.betError(s, "p1", 30, 100), "ts_err_bet_min");
  assert.strictEqual(Core.betError(s, "p1", 40, 100), null);
});
check("everyone broke -> final", function () {
  var s = Core.newGame(baseConfig(2));
  s.players[0].chips = 0; s.players[1].chips = 0;
  s = Core.reduce(s, { type: "startBetting" });
  assert.strictEqual(s.phase, "final");
});
```

- [ ] **Step 2: 執行確認失敗**

Run: `node tools/toushou_check/core_check.js`
Expected: `[core: bet]` 區塊全部 FAIL（`Core.reduce is not a function`）。

- [ ] **Step 3: 實作**

在 `toushou_core.js` 的 `// @@CORE_MORE@@` **之前**插入：

```js
  function isInt(v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v; }

  function playerById(s, id) {
    for (var i = 0; i < s.players.length; i++) if (s.players[i].id === id) return s.players[i];
    return null;
  }

  function nextBettor(s) {
    if (s.phase !== "bet" || !s.current) return null;
    for (var i = 0; i < s.current.bettors.length; i++) {
      var id = s.current.bettors[i];
      if (!s.current.bets[id]) return id;
    }
    return null;
  }

  function betError(s, playerId, amount, predict) {
    if (nextBettor(s) !== playerId) return "ts_err_not_your_turn";
    var p = playerById(s, playerId);
    if (!isInt(amount)) return "ts_err_int";
    if (amount > p.chips) return "ts_err_bet_max";
    var min = Math.min(s.config.minBet, p.chips); // 籌碼不足最低押注時只能全押
    if (amount < min || amount < 1) return "ts_err_bet_min";
    if (!isInt(predict) || predict < 0) return "ts_err_predict";
    return null;
  }

  function startBetting(s) {
    var bettors = s.players.filter(function (p) { return p.chips > 0; }).map(function (p) { return p.id; });
    if (!bettors.length) {
      s.phase = "final";
      s.current = null;
      return;
    }
    s.current = {
      price: D.START_PRICE,
      bettors: bettors,
      bets: {},
      pot: 0,
      order: [],
      turnIndex: 0,
      wind: null,
      pending: null,
      news: []
    };
    s.phase = "bet";
  }

  function placeBet(s, a) {
    var err = betError(s, a.playerId, a.amount, a.predict);
    if (err) throw new Error(err);
    var p = playerById(s, a.playerId);
    s.current.bets[a.playerId] = { amount: a.amount, predict: a.predict, chipsBefore: p.chips };
    p.chips -= a.amount;
    s.current.pot += a.amount;
    if (nextBettor(s) === null) {
      s.current.order = shuffle(s, s.players.map(function (x) { return x.id; }));
      s.current.turnIndex = 0;
      s.phase = "news";
      enterNewsTurn(s);
    }
  }

  // 每個股東回合開始時呼叫：啟用風向卡就抽一張
  function enterNewsTurn(s) {
    s.current.pending = null;
    s.current.wind = null;
    if (!s.config.windEnabled) return;
    if (!s.windDeck.length) s.windDeck = buildWindDeck(s);
    s.current.wind = s.windDeck.pop();
  }

  function reduce(state, action) {
    var s = clone(state);
    switch (action.type) {
      case "missionsDone":
        if (s.phase !== "missions") throw new Error("ts_err_phase");
        s.phase = "reveal_target";
        break;
      case "startBetting":
        if (s.phase !== "reveal_target") throw new Error("ts_err_phase");
        startBetting(s);
        break;
      case "placeBet":
        if (s.phase !== "bet") throw new Error("ts_err_phase");
        placeBet(s, action);
        break;
      // @@REDUCE_CASES@@
      default:
        throw new Error("ts_err_phase");
    }
    return s;
  }

```

並把 exports 改成（在 `// @@CORE_EXPORTS@@` 之前補上新項目）：

```js
    newGame: newGame,
    reduce: reduce,
    betError: betError,
    nextBettor: nextBettor
    // @@CORE_EXPORTS@@
```

- [ ] **Step 4: 執行確認通過**

Run: `node --check static_src/toushou_core.js && node tools/toushou_check/core_check.js`
Expected: `23 passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
git add static_src/toushou_core.js tools/toushou_check/core_check.js
git commit -m "feat(toushou): 引擎下注流程（最低押注、全押、破產跳過）"
```

---

### Task 4: 引擎 — 釋放消息、風向卡、加減分

**Files:**
- Modify: `static_src/toushou_core.js`
- Modify: `tools/toushou_check/core_check.js`

**Interfaces:**
- Consumes: Task 3 的 `reduce`、`enterNewsTurn`、`drawCard`、`playerById`、`isInt`
- Produces:
  - actions：`{type:"releaseNews", playerId, cardId: string|null, edited: bool, text}`（phase `news` → `vote`）、`{type:"applyDelta", delta}`（`vote` → 下一位 `news`，最後一位之後 → `settle`）
  - `currentShareholder(state) → playerId | null`
  - `newsError(state, playerId, cardId, text) → null | "ts_err_not_your_turn" | "ts_err_card" | "ts_err_empty_news"`
  - `deltaError(state, delta) → null | "ts_err_int" | "ts_err_wind_up" | "ts_err_wind_down"`
  - 內部 `settleCurrent(s)`（Task 5 實作；本 task 先在檔案中定義為暫時版本：`s.phase = "settle";`）

- [ ] **Step 1: 追加失敗的檢查**

```js
console.log("[core: news]");
function toNews(n, extra) {
  var s = started(n, extra);
  s.players.forEach(function (p) {
    s = Core.reduce(s, { type: "placeBet", playerId: p.id, amount: 100, predict: 100 });
  });
  return s;
}
check("each player is shareholder exactly once, order is a permutation", function () {
  var s = toNews(4);
  assert.deepStrictEqual(s.current.order.slice().sort(), ["p0", "p1", "p2", "p3"]);
  assert.strictEqual(Core.currentShareholder(s), s.current.order[0]);
});
check("newsError validations", function () {
  var s = toNews(2);
  var sh = Core.currentShareholder(s);
  var other = sh === "p0" ? "p1" : "p0";
  assert.strictEqual(Core.newsError(s, other, null, "x"), "ts_err_not_your_turn");
  assert.strictEqual(Core.newsError(s, sh, null, "   "), "ts_err_empty_news");
  assert.strictEqual(Core.newsError(s, sh, "zzz", "x"), "ts_err_card");
  assert.strictEqual(Core.newsError(s, sh, null, "大消息"), null);
});
check("playing a card (direct or edited) discards and refills to 5; custom keeps hand", function () {
  var s = toNews(2);
  var sh = Core.currentShareholder(s);
  var p = s.players.filter(function (x) { return x.id === sh; })[0];
  var card = p.hand[0];
  var deckBefore = s.deck.length;
  s = Core.reduce(s, { type: "releaseNews", playerId: sh, cardId: card, edited: true, text: "改寫後" });
  var p2 = s.players.filter(function (x) { return x.id === sh; })[0];
  assert.strictEqual(s.phase, "vote");
  assert.strictEqual(p2.hand.length, 5);
  assert.strictEqual(s.deck.length, deckBefore - 1);
  assert.ok(s.discard.indexOf(card) >= 0);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(s.current.pending)), { playerId: sh, cardId: card, edited: true, text: "改寫後" });
  s = Core.reduce(s, { type: "applyDelta", delta: 15 });
  var sh2 = Core.currentShareholder(s);
  var handBefore = JSON.stringify(s.players.filter(function (x) { return x.id === sh2; })[0].hand);
  s = Core.reduce(s, { type: "releaseNews", playerId: sh2, cardId: null, edited: false, text: "純自訂" });
  assert.strictEqual(JSON.stringify(s.players.filter(function (x) { return x.id === sh2; })[0].hand), handBefore);
});
check("applyDelta updates price (floor 0) and accumulates target news", function () {
  var s = toNews(2);
  var sh = Core.currentShareholder(s);
  s = Core.reduce(s, { type: "releaseNews", playerId: sh, cardId: null, edited: false, text: "A" });
  s = Core.reduce(s, { type: "applyDelta", delta: -130 });
  assert.strictEqual(s.current.price, 0);
  assert.strictEqual(s.current.news.length, 1);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(s.current.news[0])),
    { playerId: sh, cardId: null, edited: false, text: "A", wind: null, delta: -130, priceAfter: 0 });
  assert.strictEqual(s.phase, "news");
  assert.strictEqual(s.current.turnIndex, 1);
});
check("after last shareholder -> settle", function () {
  var s = toNews(2);
  for (var i = 0; i < 2; i++) {
    s = Core.reduce(s, { type: "releaseNews", playerId: Core.currentShareholder(s), cardId: null, edited: false, text: "x" });
    s = Core.reduce(s, { type: "applyDelta", delta: 10 });
  }
  assert.strictEqual(s.phase, "settle");
});
check("delta must be integer", function () {
  var s = toNews(2);
  s = Core.reduce(s, { type: "releaseNews", playerId: Core.currentShareholder(s), cardId: null, edited: false, text: "x" });
  assert.strictEqual(Core.deltaError(s, 1.5), "ts_err_int");
  assert.throws(function () { Core.reduce(s, { type: "applyDelta", delta: 1.5 }); }, /ts_err_int/);
});
check("wind cards: drawn per turn, sign enforced, recorded", function () {
  var s = toNews(5, { windEnabled: true });
  var seen = {};
  for (var i = 0; i < 5; i++) {
    var w = s.current.wind;
    assert.ok(["up", "down", "neutral"].indexOf(w) >= 0);
    seen[w] = (seen[w] || 0) + 1;
    s = Core.reduce(s, { type: "releaseNews", playerId: Core.currentShareholder(s), cardId: null, edited: false, text: "x" });
    if (w === "up") { assert.strictEqual(Core.deltaError(s, -1), "ts_err_wind_up"); s = Core.reduce(s, { type: "applyDelta", delta: 5 }); }
    else if (w === "down") { assert.strictEqual(Core.deltaError(s, 1), "ts_err_wind_down"); s = Core.reduce(s, { type: "applyDelta", delta: -5 }); }
    else { assert.strictEqual(Core.deltaError(s, -7), null); s = Core.reduce(s, { type: "applyDelta", delta: 0 }); }
    assert.strictEqual(s.current.news[i].wind, w);
  }
  // 5 張風向卡剛好用完一副：2/2/1
  assert.deepStrictEqual(seen, { up: 2, down: 2, neutral: 1 });
});
```

- [ ] **Step 2: 執行確認失敗**

Run: `node tools/toushou_check/core_check.js`
Expected: `[core: news]` 區塊 FAIL（`Core.currentShareholder is not a function`）。

- [ ] **Step 3: 實作**

在 `// @@CORE_MORE@@` 之前（`reduce` 函式**之前**）插入：

```js
  function currentShareholder(s) {
    if ((s.phase !== "news" && s.phase !== "vote") || !s.current) return null;
    return s.current.order[s.current.turnIndex] || null;
  }

  function newsError(s, playerId, cardId, text) {
    if (s.phase !== "news" || currentShareholder(s) !== playerId) return "ts_err_not_your_turn";
    if (cardId !== null && cardId !== undefined) {
      var p = playerById(s, playerId);
      if (p.hand.indexOf(cardId) < 0) return "ts_err_card";
    }
    if (typeof text !== "string" || !text.trim()) return "ts_err_empty_news";
    return null;
  }

  function deltaError(s, delta) {
    if (!isInt(delta)) return "ts_err_int";
    if (s.current && s.current.wind === "up" && delta < 0) return "ts_err_wind_up";
    if (s.current && s.current.wind === "down" && delta > 0) return "ts_err_wind_down";
    return null;
  }

  function releaseNews(s, a) {
    var cardId = a.cardId === undefined ? null : a.cardId;
    var err = newsError(s, a.playerId, cardId, a.text);
    if (err) throw new Error(err);
    if (cardId !== null) {
      var p = playerById(s, a.playerId);
      p.hand.splice(p.hand.indexOf(cardId), 1);
      s.discard.push(cardId);
      var drawn = drawCard(s);
      if (drawn) p.hand.push(drawn);
    }
    s.current.pending = { playerId: a.playerId, cardId: cardId, edited: !!a.edited, text: a.text.trim() };
    s.phase = "vote";
  }

  function applyDelta(s, a) {
    var err = deltaError(s, a.delta);
    if (err) throw new Error(err);
    var c = s.current;
    c.price = Math.max(0, c.price + a.delta);
    c.news.push({
      playerId: c.pending.playerId,
      cardId: c.pending.cardId,
      edited: c.pending.edited,
      text: c.pending.text,
      wind: c.wind,
      delta: a.delta,
      priceAfter: c.price
    });
    c.turnIndex += 1;
    if (c.turnIndex >= c.order.length) {
      c.pending = null;
      settleCurrent(s);
    } else {
      s.phase = "news";
      enterNewsTurn(s);
    }
  }

  // Task 5 會換成真正的結算
  function settleCurrent(s) {
    s.phase = "settle";
  }

```

在 `reduce` 的 `// @@REDUCE_CASES@@` 之前加：

```js
      case "releaseNews":
        if (s.phase !== "news") throw new Error("ts_err_phase");
        releaseNews(s, action);
        break;
      case "applyDelta":
        if (s.phase !== "vote") throw new Error("ts_err_phase");
        applyDelta(s, action);
        break;
```

exports 在 `// @@CORE_EXPORTS@@` 之前加（前一項後補逗號）：

```js
    currentShareholder: currentShareholder,
    newsError: newsError,
    deltaError: deltaError
```

- [ ] **Step 4: 執行確認通過**

Run: `node --check static_src/toushou_core.js && node tools/toushou_check/core_check.js`
Expected: `30 passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
git add static_src/toushou_core.js tools/toushou_check/core_check.js
git commit -m "feat(toushou): 引擎釋放消息（手牌／改寫／自訂）、風向卡與加減分"
```

---

### Task 5: 引擎 — 彩池結算、下一標的、任務判定、最終排名

**Files:**
- Modify: `static_src/toushou_core.js`
- Modify: `tools/toushou_check/core_check.js`

**Interfaces:**
- Consumes: Task 4 的 `settleCurrent` 佔位
- Produces:
  - `settleTarget(bets: {[pid]:{amount,predict}}, finalPrice: int, seatOrder: [pid]) → { pot, ranks:{[pid]:int}, payouts:{[pid]:int} }`
  - action `{type:"nextTarget"}`（`settle` → `reveal_target` 或 `final`）
  - `evaluateMissions(state) → [{ playerId, missionId, params, achieved: bool, reward: int }]`（只計啟用任務且 `p.mission` 存在者）
  - `finalStandings(state) → [{ playerId, name, chips, bonus, total, rank }]`（依 total 由大到小；同分同名次）
  - `missionText(missionId) → {ja,zh}`（UI 用）
  - 歷史項目 `{ targetId, category, name, tags, finalPrice, pot, bets, ranks, payouts, news }`；同時寫入 `s.lastSettlement`

- [ ] **Step 1: 追加失敗的檢查**

```js
console.log("[core: settle]");
var SEAT = ["p0", "p1", "p2", "p3", "p4"];
function bets(list) {
  var o = {};
  list.forEach(function (b, i) { if (b) o["p" + i] = { amount: b[0], predict: b[1] }; });
  return o;
}
function sumValues(o) { return Object.keys(o).reduce(function (a, k) { return a + o[k]; }, 0); }
check("n=1: own stake back", function () {
  var r = Core.settleTarget(bets([[200, 50]]), 130, SEAT);
  assert.strictEqual(r.payouts.p0, 200);
});
check("n=2: winner takes all", function () {
  var r = Core.settleTarget(bets([[100, 120], [300, 90]]), 118, SEAT);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(r.payouts)), { p0: 400, p1: 0 });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(r.ranks)), { p0: 1, p1: 2 });
});
check("n=3: 70/30", function () {
  var r = Core.settleTarget(bets([[100, 100], [100, 110], [100, 200]]), 112, SEAT);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(r.payouts)), { p1: 210, p0: 90, p2: 0 });
});
check("n=4: 60/30/10 with floor remainder to first", function () {
  // pot = 101+100+100+100 = 401 → 60%=240.6→240, 30%=120.3→120, 10%=40.1→40, 餘 1 給第 1 名
  var r = Core.settleTarget(bets([[101, 100], [100, 90], [100, 80], [100, 0]]), 100, SEAT);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(r.payouts)), { p0: 241, p1: 120, p2: 40, p3: 0 });
  assert.strictEqual(sumValues(r.payouts), r.pot);
});
check("ties merge shares: two tied first split 90%", function () {
  // pot 400：p0/p1 誤差都是 10 → (60+30)/2=45% 各 180；p2 第 3 名 10% = 40；p3 0
  var r = Core.settleTarget(bets([[100, 110], [100, 90], [100, 130], [100, 300]]), 100, SEAT);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(r.payouts)), { p0: 180, p1: 180, p2: 40, p3: 0 });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(r.ranks)), { p0: 1, p1: 1, p2: 3, p3: 4 });
});
check("tie remainder goes to earliest seat", function () {
  // pot 301, n=3 都誤差 0 → 100% / 3 = 100.33 → 各 100，餘 1 給 p0
  var r = Core.settleTarget(bets([[101, 100], [100, 100], [100, 100]]), 100, SEAT);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(r.payouts)), { p0: 101, p1: 100, p2: 100 });
});
check("pot conservation over random cases", function () {
  for (var k = 0; k < 200; k++) {
    var list = [];
    var n = 1 + (k % 5);
    for (var i = 0; i < n; i++) list.push([1 + ((k * 37 + i * 101) % 997), (k * 13 + i * 29) % 250]);
    var r = Core.settleTarget(bets(list), (k * 7) % 220, SEAT);
    assert.strictEqual(sumValues(r.payouts), r.pot, "case " + k);
  }
});

function playTarget(s, plan) {
  // plan: { bets: [[amount,predict],...], deltas: [..] }
  s = Core.reduce(s, { type: "startBetting" });
  s.current.bettors.forEach(function (id, i) {
    s = Core.reduce(s, { type: "placeBet", playerId: id, amount: plan.bets[i][0], predict: plan.bets[i][1] });
  });
  plan.deltas.forEach(function (d) {
    s = Core.reduce(s, { type: "releaseNews", playerId: Core.currentShareholder(s), cardId: null, edited: false, text: "n" });
    s = Core.reduce(s, { type: "applyDelta", delta: d });
  });
  return s;
}
check("settle pays chips, writes history, nextTarget advances then final", function () {
  var s = Core.newGame(baseConfig(2));
  s = playTarget(s, { bets: [[100, 120], [100, 80]], deltas: [10, 10] }); // 最終 120
  assert.strictEqual(s.phase, "settle");
  assert.strictEqual(s.players[0].chips, 1100);
  assert.strictEqual(s.players[1].chips, 900);
  assert.strictEqual(s.history.length, 1);
  assert.strictEqual(s.history[0].finalPrice, 120);
  assert.strictEqual(s.history[0].news.length, 2);
  assert.strictEqual(s.lastSettlement.targetId, "t0");
  s = Core.reduce(s, { type: "nextTarget" });
  assert.strictEqual(s.phase, "reveal_target");
  assert.strictEqual(s.targetIndex, 1);
  assert.strictEqual(s.current, null);
  s = playTarget(s, { bets: [[100, 100], [100, 100]], deltas: [0, 0] });
  s = Core.reduce(s, { type: "nextTarget" });
  s = playTarget(s, { bets: [[100, 100], [100, 100]], deltas: [0, 0] });
  s = Core.reduce(s, { type: "nextTarget" });
  assert.strictEqual(s.phase, "final");
});

console.log("[core: missions]");
function missionState(missionId, params) {
  var s = Core.newGame(baseConfig(3));
  s.players[0].mission = { id: missionId, params: params };
  return s;
}
function evalP0(s) { return Core.evaluateMissions(s).filter(function (r) { return r.playerId === "p0"; })[0]; }
check("firstPlaceAtLeast / exactHit / allInOnce / contrarian / ownNewsSwing", function () {
  var s = missionState("m_first", { count: 2 });
  s.config.missionsEnabled = true;
  // 標的 1：最終 130。p0 預測 130（誤差 0、方向漲、押 80%）；彩池 1400 × 70% = 980 > 800 → 獲利
  s = playTarget(s, { bets: [[800, 130], [300, 70], [300, 80]], deltas: [10, 10, 10] });
  s = Core.reduce(s, { type: "nextTarget" });
  // 標的 2：最終 100+0。p0 預測 100 → 第 1 名
  s = playTarget(s, { bets: [[100, 100], [100, 140], [100, 60]], deltas: [0, 0, 0] });
  var r = evalP0(s);
  assert.strictEqual(r.achieved, true);
  assert.strictEqual(r.reward, 300);
  s.players[0].mission = { id: "m_exact", params: { within: 5 } };
  assert.strictEqual(evalP0(s).achieved, true);
  s.players[0].mission = { id: "m_allin", params: { pct: 80 } };
  assert.strictEqual(evalP0(s).achieved, true);
  // 標的 1：p1/p2 猜跌（70/80），實際漲 → 過半猜錯，p0 猜漲正確
  s.players[0].mission = { id: "m_contra", params: {} };
  assert.strictEqual(evalP0(s).achieved, true);
  s.players[0].mission = { id: "m_swing", params: { abs: 30 } };
  assert.strictEqual(evalP0(s).achieved, false);
});
check("categoryRiseAtLeast / anyTargetCrash / finalRank", function () {
  var s = missionState("m_catrise", { category: "history", price: 150 });
  s.config.missionsEnabled = true;
  s.history = [
    { category: "history", finalPrice: 160, bets: {}, ranks: {}, payouts: {}, news: [] },
    { category: "company", finalPrice: 30, bets: {}, ranks: {}, payouts: {}, news: [] }
  ];
  assert.strictEqual(evalP0(s).achieved, true);
  s.players[0].mission = { id: "m_catrise", params: { category: "company", price: 150 } };
  assert.strictEqual(evalP0(s).achieved, false);
  s.players[0].mission = { id: "m_crash", params: { price: 40 } };
  assert.strictEqual(evalP0(s).achieved, true);
  s.players[0].chips = 500; s.players[1].chips = 900; s.players[2].chips = 100;
  s.players[0].mission = { id: "m_rank2", params: { rank: 2 } };
  assert.strictEqual(evalP0(s).achieved, true);
});
check("missions ignored when disabled; finalStandings adds bonus and ranks", function () {
  var s = missionState("m_crash", { price: 40 });
  s.history = [{ category: "item", finalPrice: 10, bets: {}, ranks: {}, payouts: {}, news: [] }];
  s.players[0].chips = 800; s.players[1].chips = 1000; s.players[2].chips = 1000;
  assert.deepStrictEqual(Core.evaluateMissions(s), []);
  s.config.missionsEnabled = true;
  var st = Core.finalStandings(s);
  st.forEach(function (r) { assert.strictEqual(r.total, 1000); assert.strictEqual(r.rank, 1); });
  // 同分時依座位序排列
  assert.deepStrictEqual(st.map(function (r) { return r.playerId; }), ["p0", "p1", "p2"]);
  assert.strictEqual(st[0].bonus, 200);
  assert.strictEqual(st[0].chips, 800);
  s.players[1].chips = 1001;
  st = Core.finalStandings(s);
  assert.strictEqual(st[0].playerId, "p1");
  assert.strictEqual(st[1].rank, 2);
  assert.strictEqual(st[2].rank, 2);
});
```

> 最後一個 check 的說明：p0 籌碼 800＋任務 200＝1000，與另外兩人同分，三人並列第 1。

- [ ] **Step 2: 執行確認失敗**

Run: `node tools/toushou_check/core_check.js`
Expected: `[core: settle]` 與 `[core: missions]` FAIL（`Core.settleTarget is not a function`）。

- [ ] **Step 3: 實作**

把 Task 4 的暫時版 `settleCurrent` **整個替換**為：

```js
  var SHARES = { 1: [100], 2: [100], 3: [70, 30] };
  var SHARES_DEFAULT = [60, 30, 10];

  function settleTarget(bets, finalPrice, seatOrder) {
    var parts = seatOrder.filter(function (id) { return bets[id] && bets[id].amount > 0; });
    var pot = 0;
    parts.forEach(function (id) { pot += bets[id].amount; });
    var shares = SHARES[parts.length] || SHARES_DEFAULT;
    // 依誤差排序；Array.prototype.sort 不保證穩定，所以用座位序當第二鍵
    var sorted = parts.slice().sort(function (a, b) {
      var ea = Math.abs(bets[a].predict - finalPrice);
      var eb = Math.abs(bets[b].predict - finalPrice);
      if (ea !== eb) return ea - eb;
      return seatOrder.indexOf(a) - seatOrder.indexOf(b);
    });
    var ranks = {};
    var payouts = {};
    var pos = 0;
    var paid = 0;
    while (pos < sorted.length) {
      var err = Math.abs(bets[sorted[pos]].predict - finalPrice);
      var group = [];
      while (pos + group.length < sorted.length &&
        Math.abs(bets[sorted[pos + group.length]].predict - finalPrice) === err) {
        group.push(sorted[pos + group.length]);
      }
      var pct = 0;
      for (var i = pos; i < pos + group.length; i++) pct += shares[i] || 0;
      var each = Math.floor(pot * pct / (100 * group.length));
      group.forEach(function (id) {
        ranks[id] = pos + 1;
        payouts[id] = each;
        paid += each;
      });
      pos += group.length;
    }
    if (sorted.length) payouts[sorted[0]] += pot - paid;
    return { pot: pot, ranks: ranks, payouts: payouts };
  }

  function settleCurrent(s) {
    var c = s.current;
    var target = s.targets[s.targetIndex];
    var seat = s.players.map(function (p) { return p.id; });
    var r = settleTarget(c.bets, c.price, seat);
    Object.keys(r.payouts).forEach(function (id) { playerById(s, id).chips += r.payouts[id]; });
    var entry = {
      targetId: target.id,
      category: target.category,
      name: target.name,
      tags: target.tags,
      finalPrice: c.price,
      pot: r.pot,
      bets: c.bets,
      ranks: r.ranks,
      payouts: r.payouts,
      news: c.news
    };
    s.history.push(entry);
    s.lastSettlement = clone(entry);
    s.phase = "settle";
  }

  function nextTarget(s) {
    s.current = null;
    s.targetIndex += 1;
    s.phase = s.targetIndex >= s.targets.length ? "final" : "reveal_target";
  }

  function missionDef(id) {
    for (var i = 0; i < D.MISSIONS.length; i++) if (D.MISSIONS[i].id === id) return D.MISSIONS[i];
    return null;
  }

  function missionText(id) {
    var m = missionDef(id);
    return m ? m.text : { ja: "", zh: "" };
  }

  // 自己有押注、且依 (P 相對 100) 判斷的漲跌方向與實際相符
  function guessedDirection(bet, finalPrice) {
    if (finalPrice === 100) return bet.predict === 100;
    return (bet.predict > 100) === (finalPrice > 100) && bet.predict !== 100;
  }

  var MISSION_CHECKS = {
    firstPlaceAtLeast: function (s, pid, p) {
      return s.history.filter(function (h) { return h.ranks[pid] === 1; }).length >= p.count;
    },
    exactHit: function (s, pid, p) {
      return s.history.some(function (h) {
        return h.bets[pid] && Math.abs(h.bets[pid].predict - h.finalPrice) <= p.within;
      });
    },
    categoryRiseAtLeast: function (s, pid, p) {
      return s.history.some(function (h) { return h.category === p.category && h.finalPrice >= p.price; });
    },
    anyTargetCrash: function (s, pid, p) {
      return s.history.some(function (h) { return h.finalPrice <= p.price; });
    },
    finalRank: function (s, pid, p) {
      var me = playerById(s, pid).chips;
      var higher = s.players.filter(function (x) { return x.chips > me; }).length;
      return higher + 1 === p.rank;
    },
    allInOnce: function (s, pid, p) {
      return s.history.some(function (h) {
        var b = h.bets[pid];
        return b && b.amount * 100 >= b.chipsBefore * p.pct && (h.payouts[pid] || 0) > b.amount;
      });
    },
    contrarian: function (s, pid) {
      return s.history.some(function (h) {
        var ids = Object.keys(h.bets);
        if (!h.bets[pid]) return false;
        var wrong = ids.filter(function (id) { return !guessedDirection(h.bets[id], h.finalPrice); }).length;
        return wrong * 2 > ids.length && guessedDirection(h.bets[pid], h.finalPrice);
      });
    },
    ownNewsSwing: function (s, pid, p) {
      return s.history.some(function (h) {
        return h.news.some(function (n) { return n.playerId === pid && Math.abs(n.delta) >= p.abs; });
      });
    }
  };

  function evaluateMissions(s) {
    if (!s.config.missionsEnabled) return [];
    return s.players.filter(function (p) { return p.mission; }).map(function (p) {
      var def = missionDef(p.mission.id);
      var ok = !!(def && MISSION_CHECKS[def.check](s, p.id, p.mission.params));
      return { playerId: p.id, missionId: p.mission.id, params: p.mission.params, achieved: ok, reward: ok ? def.reward : 0 };
    });
  }

  function finalStandings(s) {
    var bonus = {};
    evaluateMissions(s).forEach(function (r) { bonus[r.playerId] = r.reward; });
    var rows = s.players.map(function (p, i) {
      var b = bonus[p.id] || 0;
      return { playerId: p.id, name: p.name, chips: p.chips, bonus: b, total: p.chips + b, seat: i };
    });
    rows.sort(function (a, b) { return b.total - a.total || a.seat - b.seat; });
    rows.forEach(function (r) {
      r.rank = rows.filter(function (x) { return x.total > r.total; }).length + 1;
      delete r.seat;
    });
    return rows;
  }

```

> 注意 `guessedDirection`：預測價 100（持平）只有在最終正好 100 時算猜對；最終 100 時只有預測 100 算對。

`reduce` 的 `// @@REDUCE_CASES@@` 之前加：

```js
      case "nextTarget":
        if (s.phase !== "settle") throw new Error("ts_err_phase");
        nextTarget(s);
        break;
```

exports 加：

```js
    settleTarget: settleTarget,
    evaluateMissions: evaluateMissions,
    finalStandings: finalStandings,
    missionText: missionText
```

最後**刪除**三個定位標記行：`// @@CORE_MORE@@ ...`、`// @@REDUCE_CASES@@`、`// @@CORE_EXPORTS@@`（確認 exports 物件最後一項後沒有多餘逗號）。`core_check.js` 中的 `// @@CORE_CHECKS@@` 也一併刪除。

- [ ] **Step 4: 執行確認通過**

Run: `node --check static_src/toushou_core.js && node tools/toushou_check/core_check.js`
Expected: `41 passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
git add static_src/toushou_core.js tools/toushou_check/core_check.js
git commit -m "feat(toushou): 引擎彩池結算、任務判定與最終排名"
```

---

### Task 6: 頁面接線 ＋ i18n ＋ 設定畫面

**Files:**
- Create: `site_src/toushou_page.py`
- Create: `static_src/toushou.js`
- Modify: `generate.py`（import、copy list 末尾、`build_pages()`、`main()` 清理 tuple）
- Modify: `site_src/projects.py`
- Modify: `site_src/i18n_data_zh.py`、`site_src/i18n_data_ja.py`、`site_src/i18n_data_en.py`
- Modify: `static_src/style.css`（檔尾附加）

**Interfaces:**
- Consumes: `PriTestToushouData`、`PriTestToushouCore`（全部 exports）、`window.I18N.t / getLang`、事件 `i18n:change`
- Produces:
  - `window.PriTestToushou = { _debugState(), _reset() }`
  - DOM：`#ts-app` 容器；設定畫面元素 id：`#ts-player-count`、`.ts-player-name`（每列）、`input[name=ts-chips-mode]`（`same`/`each`）、`#ts-chips-same`、`.ts-player-chips`、`#ts-target-count`、`.ts-cat`（checkbox，value=類別 id）、`#ts-btn-randomize`、`#ts-btn-add-target`、`.ts-target-row`（內含 `.ts-target-name`、`.ts-target-cat`、`.ts-target-tags`、`.ts-target-del`）、`#ts-missions`、`#ts-wind`、`#ts-min-bet`、`#ts-btn-start`、`#ts-setup-error`
  - UI 內部函式（Task 7 使用）：`render()`、`dispatch(action)`、`save()`、`el(tag, attrs, children)`、`t(key, params)`、`lt(obj)`、`targetName(target)`、`targetTags(target)`

- [ ] **Step 1: 新增 `site_src/toushou_page.py`**

```python
"""東正小遊戲（toushou）のページを組み立てる。

ゲームロジックはすべてブラウザ側：
static/toushou_data.js（資料）→ static/toushou_core.js（規則引擎）→ static/toushou.js（UI）。
"""

from __future__ import annotations

from site_src.layout import page_shell

BODY = """    <div class="ts-wrap">
      <h1 data-i18n="ts_title"></h1>
      <div id="ts-app"></div>
    </div>
"""


def build_toushou_html() -> str:
    return page_shell(
        title="Toushou",
        body=BODY,
        static_prefix="../static/",
        home_href="../index.html",
        extra_scripts=("toushou_data.js", "toushou_core.js", "toushou.js"),
    )
```

- [ ] **Step 2: 修改 `generate.py`**

1. import 區（`from site_src.night_page import build_night_html` 之後）加：
   ```python
   from site_src.toushou_page import build_toushou_html
   ```
2. `build_static_assets()` 的 copy tuple，在 `"midnight.js",` 之後加：
   ```python
           "toushou_data.js",
           "toushou_core.js",
           "toushou.js",
   ```
3. `build_pages()` 末尾加：
   ```python
       toushou_dir = DIST_DIR / "toushou"
       toushou_dir.mkdir(parents=True, exist_ok=True)
       (toushou_dir / "index.html").write_text(build_toushou_html(), encoding="utf-8")
   ```
4. `main()` 的清理 tuple 改為：
   ```python
       for name in ("index.html", "night", "admin", "characters", "midnight", "toushou", "static"):
   ```

- [ ] **Step 3: 修改 `site_src/projects.py`**，在 `PROJECTS` 末尾加：

```python
    {
        "id": "toushou",
        "href": "toushou/index.html",
        "name_key": "project_toushou_name",
        "desc_key": "project_toushou_desc",
    },
```

- [ ] **Step 4: i18n**

在 `site_src/i18n_data_zh.py` 的 `STRINGS_ZH` dict 末尾（最後的 `}` 之前）加：

```python
    "project_toushou_name": "東正小遊戲",
    "project_toushou_desc": "猜價格派對遊戲：押注、輪流當股東放消息、全場決定漲跌",
    "ts_title": "東正小遊戲",
    "ts_setup_heading": "開局設定",
    "ts_player_count": "人數",
    "ts_player_name": "名稱",
    "ts_player_default": "玩家{n}",
    "ts_chips_mode": "初始籌碼",
    "ts_chips_same": "全員一致",
    "ts_chips_each": "個別設定",
    "ts_chips": "籌碼",
    "ts_target_count": "標的數（隨機產生用）",
    "ts_target_count_players": "依人數",
    "ts_categories": "標的類別",
    "ts_targets": "標的",
    "ts_btn_randomize": "隨機產生",
    "ts_btn_add_target": "新增標的",
    "ts_target_name": "名稱",
    "ts_target_tags": "特徵標籤（以逗號分隔）",
    "ts_btn_delete": "刪除",
    "ts_missions_enabled": "啟用任務卡",
    "ts_wind_enabled": "啟用風向卡",
    "ts_min_bet": "最低押注",
    "ts_btn_start": "開始遊戲",
    "ts_err_setup_names": "請填寫所有玩家名稱",
    "ts_err_setup_chips": "籌碼必須是 1 以上的整數",
    "ts_err_setup_targets": "至少需要 1 個標的，且每個標的都要有名稱",
    "ts_err_setup_categories": "至少勾選 1 個類別",
    "ts_err_setup_pool": "隨機標的不足，只產生了 {n} 個，請手動補足或調整",
    "ts_err_bet_min": "押注低於最低押注",
    "ts_err_bet_max": "押注超過目前籌碼",
    "ts_err_int": "請輸入整數",
    "ts_err_predict": "預測價必須是 0 以上的整數",
    "ts_err_not_your_turn": "還沒輪到這位玩家",
    "ts_err_card": "手牌中沒有這張牌",
    "ts_err_empty_news": "消息內容不可空白",
    "ts_err_wind_up": "風向為利多，只能輸入 0 以上",
    "ts_err_wind_down": "風向為利空，只能輸入 0 以下",
    "ts_err_phase": "目前階段無法進行此操作",
    "ts_handoff": "請把裝置交給 {name}",
    "ts_handoff_hint": "其他人請不要看畫面",
    "ts_btn_i_am": "我是 {name}，顯示",
    "ts_btn_done_hide": "完成並遮蔽",
    "ts_mission_heading": "你的秘密任務",
    "ts_mission_reward": "達成獎勵 {n}",
    "ts_target_heading": "標的 {i} / {total}",
    "ts_price": "股價",
    "ts_btn_start_betting": "開始下注",
    "ts_bet_heading": "{name} 的秘密下注",
    "ts_bet_amount": "押注額",
    "ts_bet_predict": "預測最終股價",
    "ts_bet_chips_left": "目前籌碼 {n}（最低押注 {min}）",
    "ts_btn_confirm_bet": "確定押注",
    "ts_skipped_broke": "籌碼為 0，本標的不參與押注：{names}",
    "ts_news_heading": "{role}：{name}",
    "ts_wind": "風向",
    "ts_wind_up": "利多",
    "ts_wind_down": "利空",
    "ts_wind_neutral": "中立",
    "ts_hand": "你的手牌",
    "ts_btn_play": "直接打出",
    "ts_btn_edit": "改寫",
    "ts_news_custom": "消息內容",
    "ts_btn_release": "釋放消息",
    "ts_news_board": "消息面",
    "ts_news_none": "尚無消息",
    "ts_vote_heading": "全場討論：這則消息讓股價加減多少？",
    "ts_delta": "加減分",
    "ts_btn_apply_delta": "確定",
    "ts_settle_heading": "{name} 結算",
    "ts_final_price": "最終股價 {n}",
    "ts_pot": "彩池 {n}",
    "ts_col_player": "玩家",
    "ts_col_bet": "押注",
    "ts_col_predict": "預測",
    "ts_col_error": "誤差",
    "ts_col_rank": "名次",
    "ts_col_payout": "取回",
    "ts_col_profit": "盈虧",
    "ts_btn_next_target": "下一個標的",
    "ts_btn_to_final": "整局結算",
    "ts_final_heading": "整局結算",
    "ts_col_chips": "籌碼",
    "ts_col_bonus": "任務獎勵",
    "ts_col_total": "總分",
    "ts_mission_achieved": "達成",
    "ts_mission_failed": "未達成",
    "ts_history_heading": "各標的回顧",
    "ts_btn_replay": "同設定再玩一局",
    "ts_btn_back_setup": "回到設定",
    "ts_btn_abandon": "放棄本局",
    "ts_confirm_abandon": "確定要放棄本局嗎？",
    "ts_custom_tag": "自訂",
    "ts_edited_tag": "改寫",
```

在 `site_src/i18n_data_ja.py` 的 `STRINGS_JA` 末尾加：

```python
    "project_toushou_name": "東正ミニゲーム",
    "project_toushou_desc": "株価予想パーティーゲーム：賭けて、順番に株主として情報を流し、全員で騰落を決める",
    "ts_title": "東正ミニゲーム",
    "ts_setup_heading": "ゲーム設定",
    "ts_player_count": "人数",
    "ts_player_name": "名前",
    "ts_player_default": "プレイヤー{n}",
    "ts_chips_mode": "初期チップ",
    "ts_chips_same": "全員同じ",
    "ts_chips_each": "個別に設定",
    "ts_chips": "チップ",
    "ts_target_count": "銘柄数（ランダム生成用）",
    "ts_target_count_players": "人数と同じ",
    "ts_categories": "銘柄カテゴリ",
    "ts_targets": "銘柄",
    "ts_btn_randomize": "ランダム生成",
    "ts_btn_add_target": "銘柄を追加",
    "ts_target_name": "名前",
    "ts_target_tags": "特徴タグ（カンマ区切り）",
    "ts_btn_delete": "削除",
    "ts_missions_enabled": "任務カードを使う",
    "ts_wind_enabled": "風向きカードを使う",
    "ts_min_bet": "最低ベット",
    "ts_btn_start": "ゲーム開始",
    "ts_err_setup_names": "全員の名前を入力してください",
    "ts_err_setup_chips": "チップは1以上の整数にしてください",
    "ts_err_setup_targets": "銘柄が1つ以上必要で、すべてに名前が必要です",
    "ts_err_setup_categories": "カテゴリを1つ以上選んでください",
    "ts_err_setup_pool": "ランダム銘柄が足りず{n}個のみ生成しました。手動で追加してください",
    "ts_err_bet_min": "最低ベットを下回っています",
    "ts_err_bet_max": "手持ちチップを超えています",
    "ts_err_int": "整数を入力してください",
    "ts_err_predict": "予想価格は0以上の整数にしてください",
    "ts_err_not_your_turn": "まだこのプレイヤーの番ではありません",
    "ts_err_card": "手札にないカードです",
    "ts_err_empty_news": "情報の内容が空です",
    "ts_err_wind_up": "風向きが好材料なので0以上のみ入力できます",
    "ts_err_wind_down": "風向きが悪材料なので0以下のみ入力できます",
    "ts_err_phase": "現在の段階ではこの操作はできません",
    "ts_handoff": "{name} に端末を渡してください",
    "ts_handoff_hint": "他の人は画面を見ないでください",
    "ts_btn_i_am": "{name} です、表示する",
    "ts_btn_done_hide": "完了して隠す",
    "ts_mission_heading": "あなたの秘密任務",
    "ts_mission_reward": "達成報酬 {n}",
    "ts_target_heading": "銘柄 {i} / {total}",
    "ts_price": "株価",
    "ts_btn_start_betting": "ベット開始",
    "ts_bet_heading": "{name} の秘密ベット",
    "ts_bet_amount": "ベット額",
    "ts_bet_predict": "最終株価の予想",
    "ts_bet_chips_left": "手持ち {n}（最低ベット {min}）",
    "ts_btn_confirm_bet": "ベット確定",
    "ts_skipped_broke": "チップ0のためこの銘柄は不参加：{names}",
    "ts_news_heading": "{role}：{name}",
    "ts_wind": "風向き",
    "ts_wind_up": "好材料",
    "ts_wind_down": "悪材料",
    "ts_wind_neutral": "中立",
    "ts_hand": "あなたの手札",
    "ts_btn_play": "そのまま出す",
    "ts_btn_edit": "書き換える",
    "ts_news_custom": "情報の内容",
    "ts_btn_release": "情報を流す",
    "ts_news_board": "材料",
    "ts_news_none": "まだ情報はありません",
    "ts_vote_heading": "全員で相談：この情報で株価をいくら動かす？",
    "ts_delta": "増減",
    "ts_btn_apply_delta": "確定",
    "ts_settle_heading": "{name} 精算",
    "ts_final_price": "最終株価 {n}",
    "ts_pot": "ポット {n}",
    "ts_col_player": "プレイヤー",
    "ts_col_bet": "ベット",
    "ts_col_predict": "予想",
    "ts_col_error": "誤差",
    "ts_col_rank": "順位",
    "ts_col_payout": "受取",
    "ts_col_profit": "損益",
    "ts_btn_next_target": "次の銘柄",
    "ts_btn_to_final": "最終精算",
    "ts_final_heading": "最終精算",
    "ts_col_chips": "チップ",
    "ts_col_bonus": "任務報酬",
    "ts_col_total": "合計",
    "ts_mission_achieved": "達成",
    "ts_mission_failed": "未達成",
    "ts_history_heading": "銘柄ごとの振り返り",
    "ts_btn_replay": "同じ設定でもう一度",
    "ts_btn_back_setup": "設定に戻る",
    "ts_btn_abandon": "このゲームを放棄",
    "ts_confirm_abandon": "このゲームを放棄しますか？",
    "ts_custom_tag": "自作",
    "ts_edited_tag": "書き換え",
```

在 `site_src/i18n_data_en.py` 的 `STRINGS_EN` 末尾加（其餘 `ts_*` key 會 fallback 到 zh）：

```python
    "project_toushou_name": "Toushou",
    "project_toushou_desc": "Price-guessing party game: bet, take turns leaking news as the insider, and decide the price together",
```

- [ ] **Step 5: 新增 `static_src/toushou.js`（設定畫面與基礎設施）**

```js
// 東正小遊戲（toushou）UI。規則全部在 toushou_core.js，這裡只負責畫面、輸入與存讀檔。
// 傳遞遮蔽（ui.revealedFor 等）刻意不存進 state：重新整理後回到遮蔽畫面，避免洩漏秘密資訊。
(function () {
  "use strict";

  var D = window.PriTestToushouData;
  var Core = window.PriTestToushouCore;
  var STORAGE_KEY = "pritest-toushou-state";
  var app = document.getElementById("ts-app");

  var state = null;
  var draft = null; // 設定畫面的草稿（不存檔）
  var lastConfig = null; // 「同設定再玩一局」用
  var ui = { revealedFor: null, missionIndex: 0, editing: null, selectedCard: null, error: "" };

  function t(key, params) { return window.I18N.t(key, params); }
  function lang() { return window.I18N.getLang(); }
  function lt(obj) { return typeof obj === "string" ? obj : D.text(obj, lang()); }
  function targetName(target) { return lt(target.name); }
  function targetTags(target) { return (target.tags || []).map(lt); }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === "text") node.textContent = v;
      else if (k === "class") node.className = v;
      else if (k.indexOf("on") === 0) node.addEventListener(k.slice(2), v);
      else if (v === true) node.setAttribute(k, "");
      else node.setAttribute(k, v);
    });
    (children || []).forEach(function (c) {
      if (c === null || c === undefined) return;
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return node;
  }

  function save() {
    try {
      if (state) localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      else localStorage.removeItem(STORAGE_KEY);
    } catch (e) { /* 私密模式等：只是不存檔 */ }
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var s = JSON.parse(raw);
      if (!s || s.version !== 1 || !s.players || !s.phase) return null;
      return s;
    } catch (e) {
      return null;
    }
  }

  function resetUi() {
    ui.revealedFor = null;
    ui.editing = null;
    ui.selectedCard = null;
    ui.error = "";
  }

  function dispatch(action) {
    try {
      state = Core.reduce(state, action);
    } catch (e) {
      ui.error = t(e.message);
      render();
      return false;
    }
    resetUi();
    save();
    render();
    return true;
  }

  // ---------------- 設定畫面 ----------------

  function newDraft() {
    var players = [];
    for (var i = 0; i < 4; i++) players.push({ name: t("ts_player_default", { n: i + 1 }), chips: 1000 });
    return {
      players: players,
      chipsMode: "same",
      chipsSame: 1000,
      targetCountMode: "players",
      targetCount: 4,
      categories: D.CATEGORIES.map(function (c) { return c.id; }),
      targets: [],
      missionsEnabled: true,
      windEnabled: false,
      minBet: 100,
      minBetEdited: false,
      error: ""
    };
  }

  function syncMinBet() {
    if (draft.minBetEdited) return;
    draft.minBet = Core.defaultMinBet(draft.chipsMode, draft.chipsSame);
  }

  function setPlayerCount(n) {
    n = Math.max(2, Math.min(10, n));
    while (draft.players.length < n) {
      draft.players.push({ name: t("ts_player_default", { n: draft.players.length + 1 }), chips: draft.chipsSame });
    }
    draft.players.length = n;
  }

  function randomizeTargets() {
    var count = draft.targetCountMode === "players" ? draft.players.length : draft.targetCount;
    if (!draft.categories.length) {
      draft.error = t("ts_err_setup_categories");
      return;
    }
    var seed = Math.floor(Math.random() * 4294967296);
    draft.targets = Core.pickRandomTargets(draft.categories, count, seed);
    draft.error = draft.targets.length < count ? t("ts_err_setup_pool", { n: draft.targets.length }) : "";
  }

  function intOf(v) {
    var n = Number(v);
    return isFinite(n) && Math.floor(n) === n ? n : NaN;
  }

  function buildConfig() {
    if (draft.players.some(function (p) { return !String(p.name).trim(); })) return { error: "ts_err_setup_names" };
    var chips = draft.players.map(function (p) {
      return draft.chipsMode === "same" ? intOf(draft.chipsSame) : intOf(p.chips);
    });
    if (chips.some(function (c) { return !(c >= 1); })) return { error: "ts_err_setup_chips" };
    var minBet = intOf(draft.minBet);
    if (!(minBet >= 1)) return { error: "ts_err_setup_chips" };
    if (!draft.targets.length) randomizeTargets();
    if (!draft.targets.length || draft.targets.some(function (tg) { return !lt(tg.name).trim(); })) {
      return { error: "ts_err_setup_targets" };
    }
    return {
      config: {
        players: draft.players.map(function (p, i) { return { name: String(p.name).trim(), chips: chips[i] }; }),
        targets: draft.targets.map(function (tg) {
          return { category: tg.category, name: tg.name, tags: tg.tags, custom: !!tg.custom };
        }),
        missionsEnabled: draft.missionsEnabled,
        windEnabled: draft.windEnabled,
        minBet: minBet,
        seed: Math.floor(Math.random() * 4294967296)
      }
    };
  }

  function startGame(config) {
    lastConfig = config;
    state = Core.newGame(config);
    resetUi();
    ui.missionIndex = 0;
    save();
    render();
  }

  function renderSetup() {
    if (!draft) {
      draft = newDraft();
      syncMinBet();
    }
    var box = el("section", { class: "ts-panel" }, [el("h2", { text: t("ts_setup_heading") })]);

    box.appendChild(el("label", { class: "ts-field" }, [
      t("ts_player_count"),
      el("input", {
        id: "ts-player-count", type: "number", min: "2", max: "10", value: String(draft.players.length),
        onchange: function (e) { setPlayerCount(intOf(e.target.value) || 2); render(); }
      })
    ]));

    box.appendChild(el("div", { class: "ts-field" }, [
      t("ts_chips_mode"),
      el("label", {}, [el("input", {
        type: "radio", name: "ts-chips-mode", value: "same", checked: draft.chipsMode === "same",
        onchange: function () { draft.chipsMode = "same"; syncMinBet(); render(); }
      }), t("ts_chips_same")]),
      el("label", {}, [el("input", {
        type: "radio", name: "ts-chips-mode", value: "each", checked: draft.chipsMode === "each",
        onchange: function () { draft.chipsMode = "each"; syncMinBet(); render(); }
      }), t("ts_chips_each")]),
      draft.chipsMode === "same" ? el("input", {
        id: "ts-chips-same", type: "number", min: "1", value: String(draft.chipsSame),
        oninput: function (e) {
          draft.chipsSame = e.target.value;
          syncMinBet();
          var mb = document.getElementById("ts-min-bet");
          if (mb && !draft.minBetEdited) mb.value = String(draft.minBet);
        }
      }) : null
    ]));

    var list = el("ol", { class: "ts-player-list" });
    draft.players.forEach(function (p) {
      list.appendChild(el("li", {}, [
        el("input", { class: "ts-player-name", type: "text", value: p.name, "aria-label": t("ts_player_name"),
          oninput: function (e) { p.name = e.target.value; } }),
        draft.chipsMode === "each" ? el("input", { class: "ts-player-chips", type: "number", min: "1",
          value: String(p.chips), "aria-label": t("ts_chips"),
          oninput: function (e) { p.chips = e.target.value; } }) : null
      ]));
    });
    box.appendChild(list);

    var cats = el("div", { class: "ts-field" }, [t("ts_categories")]);
    D.CATEGORIES.forEach(function (c) {
      cats.appendChild(el("label", {}, [el("input", {
        class: "ts-cat", type: "checkbox", value: c.id, checked: draft.categories.indexOf(c.id) >= 0,
        onchange: function (e) {
          if (e.target.checked) draft.categories.push(c.id);
          else draft.categories = draft.categories.filter(function (x) { return x !== c.id; });
        }
      }), lt(c.name)]));
    });
    box.appendChild(cats);

    box.appendChild(el("div", { class: "ts-field" }, [
      t("ts_target_count"),
      el("label", {}, [el("input", {
        type: "checkbox", checked: draft.targetCountMode === "players",
        onchange: function (e) { draft.targetCountMode = e.target.checked ? "players" : "custom"; render(); }
      }), t("ts_target_count_players")]),
      draft.targetCountMode === "custom" ? el("input", {
        id: "ts-target-count", type: "number", min: "1", max: "20", value: String(draft.targetCount),
        oninput: function (e) { draft.targetCount = Math.max(1, Math.min(20, intOf(e.target.value) || 1)); }
      }) : null,
      el("button", { id: "ts-btn-randomize", type: "button", text: t("ts_btn_randomize"),
        onclick: function () { randomizeTargets(); render(); } }),
      el("button", { id: "ts-btn-add-target", type: "button", text: t("ts_btn_add_target"),
        onclick: function () {
          draft.targets.push({ category: draft.categories[0] || "history", name: "", tags: [], custom: true });
          render();
        } })
    ]));

    var tlist = el("ol", { class: "ts-target-list" });
    draft.targets.forEach(function (tg, idx) {
      var catSel = el("select", { class: "ts-target-cat",
        onchange: function (e) { tg.category = e.target.value; } });
      D.CATEGORIES.forEach(function (c) {
        catSel.appendChild(el("option", { value: c.id, selected: c.id === tg.category, text: lt(c.name) }));
      });
      tlist.appendChild(el("li", { class: "ts-target-row" }, [
        el("input", { class: "ts-target-name", type: "text", value: lt(tg.name), "aria-label": t("ts_target_name"),
          oninput: function (e) { tg.name = e.target.value; tg.custom = true; } }),
        catSel,
        el("input", { class: "ts-target-tags", type: "text", value: (tg.tags || []).map(lt).join(", "),
          "aria-label": t("ts_target_tags"),
          oninput: function (e) {
            tg.tags = e.target.value.split(/[,，、]/).map(function (x) { return x.trim(); }).filter(Boolean);
            tg.custom = true;
          } }),
        el("button", { class: "ts-target-del", type: "button", text: t("ts_btn_delete"),
          onclick: function () { draft.targets.splice(idx, 1); render(); } })
      ]));
    });
    box.appendChild(el("div", { class: "ts-field" }, [t("ts_targets"), tlist]));

    box.appendChild(el("label", { class: "ts-field" }, [el("input", {
      id: "ts-missions", type: "checkbox", checked: draft.missionsEnabled,
      onchange: function (e) { draft.missionsEnabled = e.target.checked; }
    }), t("ts_missions_enabled")]));
    box.appendChild(el("label", { class: "ts-field" }, [el("input", {
      id: "ts-wind", type: "checkbox", checked: draft.windEnabled,
      onchange: function (e) { draft.windEnabled = e.target.checked; }
    }), t("ts_wind_enabled")]));
    box.appendChild(el("label", { class: "ts-field" }, [t("ts_min_bet"), el("input", {
      id: "ts-min-bet", type: "number", min: "1", value: String(draft.minBet),
      oninput: function (e) { draft.minBet = e.target.value; draft.minBetEdited = true; }
    })]));

    box.appendChild(el("p", { id: "ts-setup-error", class: "ts-error", text: draft.error || "" }));
    box.appendChild(el("button", { id: "ts-btn-start", type: "button", class: "ts-primary", text: t("ts_btn_start"),
      onclick: function () {
        var r = buildConfig();
        if (r.error) { draft.error = t(r.error); render(); return; }
        draft.error = "";
        startGame(r.config);
      } }));
    return box;
  }

  // ---------------- 遊戲中畫面（Task 7 實作） ----------------

  function renderGame() {
    return el("section", { class: "ts-panel" }, [el("p", { text: state.phase })]);
  }

  function render() {
    app.innerHTML = "";
    app.appendChild(state ? renderGame() : renderSetup());
  }

  window.PriTestToushou = {
    _debugState: function () { return state ? JSON.parse(JSON.stringify(state)) : null; },
    _reset: function () { state = null; draft = null; resetUi(); save(); render(); }
  };

  window.addEventListener("i18n:change", render);
  state = load();
  render();
})();
```

- [ ] **Step 6: CSS**（附加到 `static_src/style.css` 檔尾）

```css
/* ===== 東正小遊戲（toushou） ===== */
.ts-panel {
  border: 1px solid #ccc;
  border-radius: 8px;
  padding: 1rem;
  margin-bottom: 1rem;
}
.ts-field {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  margin: 0.5rem 0;
}
.ts-field input[type="number"] {
  width: 6rem;
}
.ts-player-list li,
.ts-target-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin: 0.25rem 0;
}
.ts-target-name {
  flex: 1 1 10rem;
  min-width: 0;
}
.ts-target-tags {
  flex: 2 1 12rem;
  min-width: 0;
}
.ts-error {
  color: #c0392b;
  min-height: 1.2em;
}
.ts-primary {
  font-weight: bold;
  padding: 0.5rem 1.25rem;
}
.ts-mask {
  text-align: center;
  padding: 2rem 1rem;
}
.ts-target-card h2 {
  margin: 0 0 0.25rem;
}
.ts-tags span {
  display: inline-block;
  border: 1px solid #999;
  border-radius: 999px;
  padding: 0 0.6rem;
  margin: 0 0.25rem 0.25rem 0;
  font-size: 0.9em;
}
.ts-price {
  font-size: 1.6rem;
  font-weight: bold;
}
.ts-news-board {
  list-style: none;
  padding: 0;
}
.ts-news-board li {
  border-left: 4px solid #999;
  padding: 0.25rem 0.5rem;
  margin: 0.25rem 0;
}
.ts-news-board li.ts-up { border-left-color: #2e8b57; }
.ts-news-board li.ts-down { border-left-color: #c0392b; }
.ts-hand {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  padding: 0;
  list-style: none;
}
.ts-hand li {
  border: 1px solid #999;
  border-radius: 6px;
  padding: 0.5rem;
  flex: 1 1 12rem;
}
.ts-hand li.ts-up { border-color: #2e8b57; }
.ts-hand li.ts-down { border-color: #c0392b; }
.ts-hand li.ts-selected { outline: 3px solid #4a8fd8; }
.ts-news-text {
  width: 100%;
  min-height: 4rem;
  font: inherit;
}
.ts-wind-badge {
  display: inline-block;
  font-weight: bold;
  padding: 0 0.5rem;
  border-radius: 4px;
  border: 1px solid currentColor;
}
.ts-table-wrap {
  overflow-x: auto;
}
.ts-table {
  border-collapse: collapse;
  width: 100%;
}
.ts-table th,
.ts-table td {
  border-bottom: 1px solid #ddd;
  padding: 0.25rem 0.5rem;
  text-align: right;
  white-space: nowrap;
}
.ts-table th:first-child,
.ts-table td:first-child {
  text-align: left;
}
.ts-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 1rem;
}
```

- [ ] **Step 7: 建置與手動確認**

Run:
```bash
node --check static_src/toushou.js && py -3 generate.py
```
Expected: `Generated site into ...`，`dist/toushou/index.html` 存在。

再執行 `py -3 -m http.server 8000 --directory dist`，開啟 `http://localhost:8000/`：首頁出現「東正小遊戲」卡片 → 點進去顯示設定畫面；改人數會增減玩家列；按「隨機產生」出現 4 個標的；切換語言後文字跟著變；按「開始遊戲」後畫面顯示 `missions`（暫時的 phase 文字）。

- [ ] **Step 8: Commit**

```bash
git add site_src/toushou_page.py static_src/toushou.js generate.py site_src/projects.py site_src/i18n_data_zh.py site_src/i18n_data_ja.py site_src/i18n_data_en.py static_src/style.css
git commit -m "feat(toushou): 新增頁面、首頁入口、i18n 與開局設定畫面"
```

---

### Task 7: 遊戲中畫面（任務、標的、下注、消息、表決、結算、整局）

**Files:**
- Modify: `static_src/toushou.js`（替換 Task 6 的暫時 `renderGame`）

**Interfaces:**
- Consumes: Task 6 的 `el / t / lt / targetName / targetTags / dispatch / save / render / ui / state / lastConfig / startGame / resetUi / draft`；Core 的 `nextBettor / currentShareholder / betError / newsError / deltaError / roleFor / evaluateMissions / finalStandings / missionText`
- Produces（Playwright 用 DOM id）：
  - 遮蔽：`#ts-mask`、`#ts-btn-reveal`、`#ts-btn-hide`
  - 任務：`#ts-mission-text`
  - 標的卡：`.ts-target-card`、`#ts-price`、`#ts-news-board`（`li` 每則消息）
  - `#ts-btn-start-betting`
  - 下注：`#ts-bet-amount`、`#ts-bet-predict`、`#ts-btn-confirm-bet`
  - 消息：`#ts-wind`（風向徽章）、`.ts-hand li`（`data-card` 屬性）、`.ts-btn-play`、`.ts-btn-edit`、`#ts-news-text`、`#ts-btn-release`
  - 表決：`#ts-delta`、`#ts-btn-apply-delta`
  - 結算：`#ts-settle-table`、`#ts-btn-next-target`
  - 整局：`#ts-final-table`、`#ts-btn-replay`、`#ts-btn-back-setup`
  - `#ts-btn-abandon`、`#ts-game-error`

- [ ] **Step 1: 以下列程式碼替換 Task 6 的 `renderGame` 函式（整段）**

```js
  function playerName(id) {
    for (var i = 0; i < state.players.length; i++) if (state.players[i].id === id) return state.players[i].name;
    return id;
  }

  function cardById(id) {
    for (var i = 0; i < D.NEWS_CARDS.length; i++) if (D.NEWS_CARDS[i].id === id) return D.NEWS_CARDS[i];
    return null;
  }

  function fillParams(textObj, params) {
    var s = lt(textObj);
    Object.keys(params || {}).forEach(function (k) {
      var v = params[k];
      if (k === "category") {
        D.CATEGORIES.forEach(function (c) { if (c.id === v) v = lt(c.name); });
      }
      s = s.split("{" + k + "}").join(String(v));
    });
    return s;
  }

  function windLabel(w) { return w ? t("ts_wind_" + w) : ""; }

  // 遮蔽畫面：未確認身分時顯示「請交給 ○○」，確認後呼叫 content()
  function masked(playerId, content) {
    if (ui.revealedFor === playerId) return content();
    var name = playerName(playerId);
    return el("div", { id: "ts-mask", class: "ts-panel ts-mask" }, [
      el("h2", { text: t("ts_handoff", { name: name }) }),
      el("p", { text: t("ts_handoff_hint") }),
      el("button", { id: "ts-btn-reveal", type: "button", class: "ts-primary", text: t("ts_btn_i_am", { name: name }),
        onclick: function () { ui.revealedFor = playerId; render(); } })
    ]);
  }

  function newsBoard(news) {
    if (!news.length) return el("p", { id: "ts-news-board", text: t("ts_news_none") });
    var ul = el("ul", { id: "ts-news-board", class: "ts-news-board" });
    news.forEach(function (n) {
      var sign = n.delta > 0 ? "+" + n.delta : String(n.delta);
      var tag = n.cardId === null ? t("ts_custom_tag") : (n.edited ? t("ts_edited_tag") : "");
      ul.appendChild(el("li", { class: n.delta > 0 ? "ts-up" : (n.delta < 0 ? "ts-down" : "") }, [
        el("strong", { text: playerName(n.playerId) }),
        n.wind ? " [" + windLabel(n.wind) + "]" : "",
        tag ? " (" + tag + ")" : "",
        "：" + n.text + "　" + sign + " → " + n.priceAfter
      ]));
    });
    return ul;
  }

  function targetCard(target, price, news) {
    var cat = null;
    D.CATEGORIES.forEach(function (c) { if (c.id === target.category) cat = c; });
    var tags = el("div", { class: "ts-tags" });
    targetTags(target).forEach(function (tg) { tags.appendChild(el("span", { text: tg })); });
    return el("section", { class: "ts-panel ts-target-card" }, [
      el("p", { text: t("ts_target_heading", { i: state.targetIndex + 1, total: state.targets.length }) + "　" + (cat ? lt(cat.name) : "") }),
      el("h2", { text: targetName(target) }),
      tags,
      el("p", {}, [t("ts_price") + "：", el("span", { id: "ts-price", class: "ts-price", text: String(price) })]),
      el("h3", { text: t("ts_news_board") }),
      newsBoard(news || [])
    ]);
  }

  function errorLine() {
    return el("p", { id: "ts-game-error", class: "ts-error", text: ui.error || "" });
  }

  function renderMissions() {
    var p = state.players[ui.missionIndex];
    return masked(p.id, function () {
      var def = null;
      D.MISSIONS.forEach(function (m) { if (m.id === p.mission.id) def = m; });
      return el("section", { class: "ts-panel" }, [
        el("h2", { text: t("ts_mission_heading") }),
        el("p", { id: "ts-mission-text", text: fillParams(Core.missionText(p.mission.id), p.mission.params) }),
        el("p", { text: t("ts_mission_reward", { n: def ? def.reward : 0 }) }),
        el("button", { id: "ts-btn-hide", type: "button", class: "ts-primary", text: t("ts_btn_done_hide"),
          onclick: function () {
            ui.revealedFor = null;
            if (ui.missionIndex + 1 >= state.players.length) {
              ui.missionIndex = 0;
              dispatch({ type: "missionsDone" });
            } else {
              ui.missionIndex += 1;
              render();
            }
          } })
      ]);
    });
  }

  function renderBet() {
    var pid = Core.nextBettor(state);
    var me = state.players.filter(function (p) { return p.id === pid; })[0];
    var skipped = state.players.filter(function (p) { return state.current.bettors.indexOf(p.id) < 0; })
      .map(function (p) { return p.name; });
    var info = skipped.length ? el("p", { text: t("ts_skipped_broke", { names: skipped.join("、") }) }) : null;
    var body = masked(pid, function () {
      var min = Math.min(state.config.minBet, me.chips);
      var amount = el("input", { id: "ts-bet-amount", type: "number", min: String(min), max: String(me.chips), value: String(min) });
      var predict = el("input", { id: "ts-bet-predict", type: "number", min: "0", value: "100" });
      return el("section", { class: "ts-panel" }, [
        el("h2", { text: t("ts_bet_heading", { name: me.name }) }),
        el("p", { text: t("ts_bet_chips_left", { n: me.chips, min: min }) }),
        el("label", { class: "ts-field" }, [t("ts_bet_amount"), amount]),
        el("label", { class: "ts-field" }, [t("ts_bet_predict"), predict]),
        errorLine(),
        el("button", { id: "ts-btn-confirm-bet", type: "button", class: "ts-primary", text: t("ts_btn_confirm_bet"),
          onclick: function () {
            var a = Number(amount.value);
            var pr = Number(predict.value);
            var err = Core.betError(state, pid, a, pr);
            if (err) { ui.error = t(err); render(); return; }
            dispatch({ type: "placeBet", playerId: pid, amount: a, predict: pr });
          } })
      ]);
    });
    return el("div", {}, [info, body]);
  }

  function renderNews() {
    var pid = Core.currentShareholder(state);
    var target = state.targets[state.targetIndex];
    var role = lt(Core.roleFor(target.category));
    var me = state.players.filter(function (p) { return p.id === pid; })[0];
    var windBadge = state.current.wind
      ? el("p", {}, [t("ts_wind") + "：", el("span", { id: "ts-wind", class: "ts-wind-badge", text: windLabel(state.current.wind) })])
      : null;
    var heading = el("h2", { text: t("ts_news_heading", { role: role, name: me.name }) });
    var body = masked(pid, function () {
      var textArea = el("textarea", { id: "ts-news-text", class: "ts-news-text", "aria-label": t("ts_news_custom") });
      if (ui.editing !== null) textArea.value = ui.editing;
      textArea.addEventListener("input", function () { ui.editing = textArea.value; });
      var hand = el("ul", { class: "ts-hand" });
      me.hand.forEach(function (cardId, idx) {
        var card = cardById(cardId);
        var selected = ui.selectedCard === idx;
        hand.appendChild(el("li", { "data-card": cardId, class: (card ? "ts-" + card.tone : "") + (selected ? " ts-selected" : "") }, [
          el("p", { text: card ? lt(card.text) : cardId }),
          el("button", { class: "ts-btn-play", type: "button", text: t("ts_btn_play"),
            onclick: function () {
              dispatch({ type: "releaseNews", playerId: pid, cardId: cardId, edited: false, text: card ? lt(card.text) : cardId });
            } }),
          el("button", { class: "ts-btn-edit", type: "button", text: t("ts_btn_edit"),
            onclick: function () {
              ui.selectedCard = idx;
              ui.editing = card ? lt(card.text) : "";
              render();
            } })
        ]));
      });
      return el("section", { class: "ts-panel" }, [
        el("h3", { text: t("ts_hand") }),
        hand,
        el("label", {}, [t("ts_news_custom"), textArea]),
        errorLine(),
        el("button", { id: "ts-btn-release", type: "button", class: "ts-primary", text: t("ts_btn_release"),
          onclick: function () {
            var text = textArea.value;
            var cardId = ui.selectedCard === null ? null : me.hand[ui.selectedCard];
            var err = Core.newsError(state, pid, cardId, text);
            if (err) { ui.error = t(err); render(); return; }
            dispatch({ type: "releaseNews", playerId: pid, cardId: cardId, edited: cardId !== null, text: text });
          } })
      ]);
    });
    return el("div", {}, [heading, windBadge, body]);
  }

  function renderVote() {
    var pending = state.current.pending;
    var delta = el("input", { id: "ts-delta", type: "number", step: "1", value: "0" });
    return el("section", { class: "ts-panel" }, [
      el("p", {}, [el("strong", { text: playerName(pending.playerId) }),
        state.current.wind ? " [" + windLabel(state.current.wind) + "]" : "", "：" + pending.text]),
      el("h3", { text: t("ts_vote_heading") }),
      el("label", { class: "ts-field" }, [t("ts_delta"), delta]),
      errorLine(),
      el("button", { id: "ts-btn-apply-delta", type: "button", class: "ts-primary", text: t("ts_btn_apply_delta"),
        onclick: function () {
          var d = Number(delta.value);
          var err = Core.deltaError(state, d);
          if (err) { ui.error = t(err); render(); return; }
          dispatch({ type: "applyDelta", delta: d });
        } })
    ]);
  }

  function settleTable(h) {
    var table = el("table", { class: "ts-table" });
    table.appendChild(el("tr", {}, ["ts_col_player", "ts_col_bet", "ts_col_predict", "ts_col_error", "ts_col_rank", "ts_col_payout", "ts_col_profit"]
      .map(function (k) { return el("th", { text: t(k) }); })));
    state.players.forEach(function (p) {
      var b = h.bets[p.id];
      if (!b) return;
      var pay = h.payouts[p.id] || 0;
      var profit = pay - b.amount;
      table.appendChild(el("tr", {}, [p.name, b.amount, b.predict, Math.abs(b.predict - h.finalPrice), h.ranks[p.id], pay,
        (profit > 0 ? "+" : "") + profit].map(function (v) { return el("td", { text: String(v) }); })));
    });
    return table;
  }

  function renderSettle() {
    var h = state.lastSettlement;
    var last = state.targetIndex + 1 >= state.targets.length;
    return el("section", { class: "ts-panel" }, [
      el("h2", { text: t("ts_settle_heading", { name: lt(h.name) }) }),
      el("p", { text: t("ts_final_price", { n: h.finalPrice }) + "　" + t("ts_pot", { n: h.pot }) }),
      el("div", { id: "ts-settle-table", class: "ts-table-wrap" }, [settleTable(h)]),
      el("div", { class: "ts-actions" }, [
        el("button", { id: "ts-btn-next-target", type: "button", class: "ts-primary",
          text: t(last ? "ts_btn_to_final" : "ts_btn_next_target"),
          onclick: function () { dispatch({ type: "nextTarget" }); } })
      ])
    ]);
  }

  function renderFinal() {
    var standings = Core.finalStandings(state);
    var missions = {};
    Core.evaluateMissions(state).forEach(function (r) { missions[r.playerId] = r; });
    var table = el("table", { class: "ts-table" });
    table.appendChild(el("tr", {}, ["ts_col_rank", "ts_col_player", "ts_col_chips", "ts_col_bonus", "ts_col_total"]
      .map(function (k) { return el("th", { text: t(k) }); })));
    standings.forEach(function (r) {
      table.appendChild(el("tr", {}, [r.rank, r.name, r.chips, r.bonus, r.total]
        .map(function (v) { return el("td", { text: String(v) }); })));
    });
    var missionList = null;
    if (state.config.missionsEnabled) {
      missionList = el("ul", {});
      state.players.forEach(function (p) {
        var r = missions[p.id];
        if (!r) return;
        missionList.appendChild(el("li", { text: p.name + "：" + fillParams(Core.missionText(r.missionId), r.params) +
          "（" + t(r.achieved ? "ts_mission_achieved" : "ts_mission_failed") + "）" }));
      });
    }
    var review = el("div", {}, [el("h3", { text: t("ts_history_heading") })]);
    state.history.forEach(function (h) {
      review.appendChild(el("details", {}, [
        el("summary", { text: lt(h.name) + "　" + t("ts_final_price", { n: h.finalPrice }) }),
        newsBoard(h.news),
        el("div", { class: "ts-table-wrap" }, [settleTable(h)])
      ]));
    });
    return el("section", { class: "ts-panel" }, [
      el("h2", { text: t("ts_final_heading") }),
      el("div", { id: "ts-final-table", class: "ts-table-wrap" }, [table]),
      missionList,
      review,
      el("div", { class: "ts-actions" }, [
        lastConfig ? el("button", { id: "ts-btn-replay", type: "button", class: "ts-primary", text: t("ts_btn_replay"),
          onclick: function () {
            var cfg = JSON.parse(JSON.stringify(lastConfig));
            cfg.seed = Math.floor(Math.random() * 4294967296);
            startGame(cfg);
          } }) : null,
        el("button", { id: "ts-btn-back-setup", type: "button", text: t("ts_btn_back_setup"),
          onclick: function () { state = null; resetUi(); save(); render(); } })
      ])
    ]);
  }

  function renderGame() {
    var wrap = el("div", {});
    var phase = state.phase;
    if (phase === "missions") {
      wrap.appendChild(renderMissions());
    } else if (phase === "final") {
      wrap.appendChild(renderFinal());
      return wrap;
    } else {
      var target = state.targets[state.targetIndex];
      var price = state.current ? state.current.price : D.START_PRICE;
      var news = state.current ? state.current.news : [];
      if (phase === "settle") news = state.lastSettlement.news;
      if (phase === "settle") price = state.lastSettlement.finalPrice;
      wrap.appendChild(targetCard(target, price, news));
      if (phase === "reveal_target") {
        wrap.appendChild(el("button", { id: "ts-btn-start-betting", type: "button", class: "ts-primary",
          text: t("ts_btn_start_betting"), onclick: function () { dispatch({ type: "startBetting" }); } }));
      } else if (phase === "bet") {
        wrap.appendChild(renderBet());
      } else if (phase === "news") {
        wrap.appendChild(renderNews());
      } else if (phase === "vote") {
        wrap.appendChild(renderVote());
      } else if (phase === "settle") {
        wrap.appendChild(renderSettle());
      }
    }
    wrap.appendChild(el("div", { class: "ts-actions" }, [
      el("button", { id: "ts-btn-abandon", type: "button", text: t("ts_btn_abandon"),
        onclick: function () {
          if (!window.confirm(t("ts_confirm_abandon"))) return;
          state = null; resetUi(); save(); render();
        } })
    ]));
    return wrap;
  }
```

> 「直接打出」按鈕送出牌面文字（依目前語言）；「改寫」把牌面文字帶入輸入框並標記該牌，按「釋放消息」時以 `edited: true` 送出。不選牌直接按「釋放消息」就是純自訂。

- [ ] **Step 2: 語法檢查與建置**

Run: `node --check static_src/toushou.js && py -3 generate.py`
Expected: 無錯誤。

- [ ] **Step 3: 手動走一局**（`py -3 -m http.server 8000 --directory dist`）

確認：任務逐人遮蔽顯示 → 標的卡 → 下注逐人遮蔽，輸入低於最低押注時出現錯誤 → 股東回合顯示手牌、「改寫」會帶入文字 → 表決輸入加減分後，消息出現在標的卡的「消息面」→ 最後一位結束後顯示結算表 → 「下一個標的」→ 全部結束後顯示整局結算與任務達成。重新整理頁面後，進度保留且回到遮蔽畫面。

- [ ] **Step 4: Commit**

```bash
git add static_src/toushou.js
git commit -m "feat(toushou): 遊戲中各階段畫面（傳遞遮蔽、下注、消息面、表決、結算）"
```

---

### Task 8: Playwright 整局檢查

**Files:**
- Create: `tools/toushou_check/ui_check.js`

**Interfaces:**
- Consumes: Task 6/7 的 DOM id、`window.PriTestToushou._debugState()`、`window.PriTestToushouCore.settleTarget`
- 前置：`py -3 generate.py`，並另開 `py -3 -m http.server 8941 --directory dist`。Playwright 從 `tools/midnight_check/node_modules` 載入（不另外安裝）。

- [ ] **Step 1: 寫檢查腳本**

```js
// ============================================================================
// toushou（東正小遊戲）Playwright 整局流程檢查：3 人 × 3 標的，含任務卡、改寫手牌、
// 純自訂消息、直接出牌、重新整理還原。
// 前置：
//   1. py -3 generate.py
//   2. py -3 -m http.server 8941 --directory dist
// 執行：node tools/toushou_check/ui_check.js
// 規則依據：docs/superpowers/specs/2026-10-15-toushou-game-design.md
// toushou 沒有每幀重繪的元素，所以這裡可以用 page.click（與 midnight §4.6 不同）。
// ============================================================================
"use strict";
var path = require("path");
var assert = require("assert");
var chromium = require(require.resolve("playwright", { paths: [path.join(__dirname, "..", "midnight_check")] })).chromium;

var BASE = process.env.TOUSHOU_BASE || "http://localhost:8941/toushou/index.html";

function debugState(page) { return page.evaluate(function () { return window.PriTestToushou._debugState(); }); }

(async function main() {
  var browser = await chromium.launch();
  var page = await browser.newPage();
  page.on("dialog", function (d) { d.accept(); });
  var errors = [];
  page.on("pageerror", function (e) { errors.push(String(e)); });

  await page.goto(BASE);
  await page.evaluate(function () { localStorage.clear(); localStorage.setItem("pritest-lang", "zh"); });
  await page.reload();

  // ---- 設定：3 人、標的數依人數、任務卡開 ----
  await page.fill("#ts-player-count", "3");
  await page.dispatchEvent("#ts-player-count", "change");
  assert.strictEqual(await page.locator(".ts-player-name").count(), 3);
  await page.click("#ts-btn-randomize");
  assert.strictEqual(await page.locator(".ts-target-row").count(), 3);
  await page.click("#ts-btn-start");

  var s = await debugState(page);
  assert.strictEqual(s.phase, "missions");
  assert.strictEqual(s.players.length, 3);

  // ---- 任務逐人查看 ----
  for (var i = 0; i < 3; i++) {
    await page.click("#ts-btn-reveal");
    assert.ok((await page.textContent("#ts-mission-text")).length > 0);
    await page.click("#ts-btn-hide");
  }
  s = await debugState(page);
  assert.strictEqual(s.phase, "reveal_target");

  for (var round = 0; round < 3; round++) {
    await page.click("#ts-btn-start-betting");

    // ---- 下注：先試一次低於最低押注 ----
    for (var b = 0; b < 3; b++) {
      await page.click("#ts-btn-reveal");
      if (round === 0 && b === 0) {
        await page.fill("#ts-bet-amount", "1");
        await page.click("#ts-btn-confirm-bet");
        assert.ok((await page.textContent("#ts-game-error")).length > 0, "min bet error shown");
      }
      await page.fill("#ts-bet-amount", String(100 + b * 50));
      await page.fill("#ts-bet-predict", String(90 + b * 20));
      await page.click("#ts-btn-confirm-bet");
    }
    s = await debugState(page);
    assert.strictEqual(s.phase, "news");
    assert.strictEqual(s.current.pot, 100 + 150 + 200);

    // ---- 三位股東：改寫／純自訂／直接出牌 ----
    for (var k = 0; k < 3; k++) {
      var before = await debugState(page);
      var sh = before.current.order[before.current.turnIndex];
      await page.click("#ts-btn-reveal");
      if (k === 0) {
        await page.locator(".ts-btn-edit").first().click();
        var prefilled = await page.inputValue("#ts-news-text");
        assert.ok(prefilled.length > 0, "edit prefills card text");
        await page.fill("#ts-news-text", prefilled + "（改寫）");
        await page.click("#ts-btn-release");
      } else if (k === 1) {
        await page.fill("#ts-news-text", "純自訂消息" + round);
        await page.click("#ts-btn-release");
      } else {
        await page.locator(".ts-btn-play").first().click();
      }
      var mid = await debugState(page);
      assert.strictEqual(mid.phase, "vote");
      var hand = mid.players.filter(function (p) { return p.id === sh; })[0].hand;
      assert.strictEqual(hand.length, 5, "hand refilled / kept at 5");
      if (k === 0) assert.strictEqual(mid.current.pending.edited, true);
      if (k === 1) assert.strictEqual(mid.current.pending.cardId, null);

      await page.fill("#ts-delta", String(k === 0 ? 20 : -5));
      await page.click("#ts-btn-apply-delta");
      assert.strictEqual(await page.locator("#ts-news-board li").count(), k + 1, "news accumulates on target card");
    }

    // ---- 每位玩家恰好當一次股東 ----
    s = await debugState(page);
    assert.strictEqual(s.phase, "settle");
    var h = s.history[round];
    assert.deepStrictEqual(h.news.map(function (n) { return n.playerId; }).sort(), ["p0", "p1", "p2"]);
    assert.strictEqual(h.finalPrice, 110);

    // ---- 結算與 Core.settleTarget 一致、彩池守恆 ----
    var expected = await page.evaluate(function (hist) {
      return window.PriTestToushouCore.settleTarget(hist.bets, hist.finalPrice, ["p0", "p1", "p2"]);
    }, h);
    assert.deepStrictEqual(h.payouts, expected.payouts);
    var sum = Object.keys(h.payouts).reduce(function (a, id) { return a + h.payouts[id]; }, 0);
    assert.strictEqual(sum, h.pot);
    assert.strictEqual(await page.locator("#ts-settle-table tr").count(), 4);

    // ---- 第 1 個標的結算後重新整理，state 完整還原 ----
    if (round === 0) {
      await page.reload();
      var restored = await debugState(page);
      assert.deepStrictEqual(restored, s);
    }
    await page.click("#ts-btn-next-target");
  }

  s = await debugState(page);
  assert.strictEqual(s.phase, "final");
  assert.strictEqual(await page.locator("#ts-final-table tr").count(), 4);
  var totalChips = s.players.reduce(function (a, p) { return a + p.chips; }, 0);
  assert.strictEqual(totalChips, 3000, "chips conserved across the game");

  assert.deepStrictEqual(errors, []);
  await browser.close();
  console.log("toushou ui_check: OK");
})().catch(function (err) {
  console.error(err);
  process.exit(1);
});
```

> 預測價 90／110／130、最終價 110（+20 −5 −5）：p1 誤差 0 第 1 名拿 70%、p0 與 p2 誤差皆 20 並列第 2 名，合併 30% 平分。期望值不硬編，以頁面內的 `Core.settleTarget` 計算（CLAUDE.md §4.7）。

- [ ] **Step 2: 執行**

Run（另一個終端先啟動 `py -3 -m http.server 8941 --directory dist`）：
```bash
py -3 generate.py && node tools/toushou_check/ui_check.js
```
Expected: `toushou ui_check: OK`

若失敗：依錯誤訊息修正 `static_src/toushou.js`（不要為了讓測試通過而放寬斷言），重新 `py -3 generate.py` 後再跑一次。

- [ ] **Step 3: 同時再跑一次單元檢查**

Run: `node tools/toushou_check/core_check.js`
Expected: `41 passed, 0 failed`

- [ ] **Step 4: Commit**

```bash
git add tools/toushou_check/ui_check.js
git commit -m "test(toushou): 新增 Playwright 整局流程檢查"
```
