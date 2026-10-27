# starV 計畫 3：重大事件、設施、業界趨勢 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 加入規格 §7（重大事件）與 §8（設施升級、業界趨勢、財務危機），以及對應的 UI：事件卡與頂部鈴鐺、公司分頁的設施、「業界」分頁的本季趨勢；並用平衡模擬檢查後期資金過剩的問題。

**Architecture:** 事件比照 SR/SSR 名錄做成可擴充的登記器：`starv_events.js`（`PriTestStarvEvents.add()`）＋分檔的事件資料 `starv_events_1.js`、`_2.js`…（使用者指定 2026-10-27：之後要擴充到上千種）；事件引擎、設施、趨勢都寫進 `starv_core.js`（需要用到核心的內部函式，例如 `genJob`、`addRep`、`removeArtist`）。UI 新增 `starv_events_ui.js`（事件卡、鈴鐺、自動彈出）與 `starv_view_industry.js`（業界分頁），公司分頁加上設施卡。存檔版本升到 2，`migrate` 補上趨勢。

**Tech Stack:** Vanilla ES5、node 單元測試、Playwright。

## Global Constraints

- 規格 §7：重大事件平均每 10～15 天 1 次（每日機率 `BAL.eventDailyChance = 0.08`）；期限 3 天，逾期或離線時套用 `defaultChoice`；同時最多 3 件，超過時最舊的自動處理；選項只顯示傾向（`hint`），不顯示數值；結果有隨機性，公關部每級讓壞結果權重 −10%
- 規格 §7：條件觸發至少包含：罷工（`strike_talk`）、人氣門檻（`fame_milestone`，1,000／5,000／20,000／50,000）、負債 3 個月（`finance_crisis`）、SSR 入社（`ssr_debut`）
- 規格 §5.2 財務危機三選項：賣合約、向銀行借款（有利息）、全員減薪（壓力增加）
- 規格 §8.2 設施：宿舍 Lv1–10（上限 5→100，不受公司等級限制）；其他設施最高 Lv5，且不能超過公司等級；資金升級、即時完成
- 規格 §8.3 趨勢：每季（90 天）2～3 個熱門方向 ×1.5、1 個低迷方向 ×0.7（工作量、酬勞、人氣）；偶爾出現持續一季的特殊潮流；下一季以「傳聞」預告
- 事件 v1 共 40 種，之後會擴充到上千種：事件分檔登記、ID 永不重用、核心不寫死事件數量；抽事件時依目標篩選鍵分組，對藝人的篩選次數只看篩選鍵種類、不隨事件數增加；存檔中找不到的事件 ID 在讀檔時丟棄
- 對手公司相關事件在計畫 4 加入（本計畫的挖角事件以「其他經紀公司」稱呼）
- 舊存檔（version 1）必須能讀：`migrate` 補上 `trend`、`events`、`loans`、`company.crisisOn`
- 計畫 1、2 的既有測試要繼續通過；`core_check.js` 為了讓舊測試維持確定性，在檔案開頭把隨機事件機率設為 0，事件測試自行開啟
- CLAUDE.md §5.2.1 的命名前綴（`sv-`、`sv_`、`PriTestStarv*`）
- 推送前遞增版本號（新功能 → minor）

## 檔案結構

| 檔案 | 責任 |
| --- | --- |
| Modify `static_src/starv_data.js` | 設施的名稱、說明、升級費用；特殊潮流；趨勢與事件的平衡常數 |
| Create `static_src/starv_events.js` | 事件登記器 → `PriTestStarvEvents`（同時維護 `D.EVENTS`、`D.EVENT_BY_ID`、`D.EVENT_CATS`） |
| Create `static_src/starv_events_1.js` | v1 的 40 種重大事件（之後的擴充放 `starv_events_2.js` …） |
| Modify `static_src/starv_core.js` | 設施升級、趨勢、事件引擎、借款、財務危機、條件觸發、指名工作、`removeArtist`、存檔版本 2 |
| Modify `tools/starv_check/core_check.js` | 新功能的單元測試 |
| Modify `tools/starv_check/sim.js` | 模擬中購買設施、檢查後期資金 |
| Create `static_src/starv_events_ui.js` | 事件卡彈窗、頂部鈴鐺、新事件自動彈出、效果摘要文字 |
| Create `static_src/starv_view_industry.js` | 「業界」分頁（本季趨勢、下季傳聞） |
| Modify `static_src/starv_ui.js` | `modalIsOpen()`、`addTopItem()`／`topItems()` |
| Modify `static_src/starv.js` | 頂部列放入 `UI.topItems()` |
| Modify `static_src/starv_view_company.js` | 設施卡、debug「觸發事件」按鈕 |
| Modify `static_src/starv_log.js` | 新日誌類型的文字 |
| Modify `site_src/starv_page.py`、`site_src/i18n_starv.py`、`static_src/css/starv.css`、`tools/starv_check/ui_check.js` | 登記、字串、樣式、流程檢查 |

插入慣例同計畫 2（`// ==== run ====`、`  // ==== exports ====`、`// ==== 之後的 task 在這行之前追加步驟 ====`、`    # ==== 之後的 task 在這行之前追加字串 ====`、CSS 附加在最後）。

---

### Task 1：設施升級

**Files:**
- Modify: `static_src/starv_data.js`、`static_src/starv_core.js`、`tools/starv_check/core_check.js`

**Interfaces:**
- Produces:
  - `D.FACILITIES[f]` 新增欄位：`name`、`desc`（`{zh,ja}`）、`base`、`growth`、`start`（初始等級）
  - `D.FACILITY_ORDER = ["dorm","practice","studio","photo","lounge","pr","scout"]`
  - `Core.facilityCap(st, f) → number`（目前能升到的最高等級）
  - `Core.facilityCost(st, f) → number | null`（升到下一級的費用；已達最高級回傳 null）
  - `Core.upgradeFacility(st, f) → null | "noFacility"|"max"|"level"|"money"`；成功時寫入 `facility_up` 日誌 `{ f, lv }`

- [ ] **Step 1：寫失敗測試**（插在 `// ==== run ====` 之前）

```js
test("設施：費用、等級上限、升級", function () {
  var st = Core.create({ seed: 1 });
  eq(Core.facilityCost(st, "dorm"), 30000, "宿舍 Lv1→2"); eq(Core.facilityCost(st, "practice"), 40000, "練習室 Lv0→1");
  eq(Core.facilityCap(st, "dorm"), 10); eq(Core.facilityCap(st, "practice"), 1, "公司 Lv1 只能到 Lv1");
  eq(Core.upgradeFacility(st, "nope"), "noFacility");
  st.company.money = 10000; eq(Core.upgradeFacility(st, "dorm"), "money");
  st.company.money = 1e9;
  eq(Core.upgradeFacility(st, "dorm"), null); eq(st.facilities.dorm, 2); eq(Core.capacity(st), 10);
  eq(Core.upgradeFacility(st, "practice"), null); eq(Core.upgradeFacility(st, "practice"), "level");
  st.company.level = 10;
  for (var i = 0; i < 10; i++) Core.upgradeFacility(st, "dorm");
  eq(st.facilities.dorm, 10); eq(Core.upgradeFacility(st, "dorm"), "max"); eq(Core.facilityCost(st, "dorm"), null);
  assert(st.log.some(function (e) { return e.type === "facility_up" && e.data.f === "dorm" && e.data.lv === 2; }), "日誌");
  D.FACILITY_ORDER.forEach(function (f) { assert(D.FACILITIES[f].name.zh && D.FACILITIES[f].desc.ja, "名稱說明 " + f); });
});
```

- [ ] **Step 2：執行，確認失敗**

Run: `node tools/starv_check/core_check.js`
Expected: `FAIL 設施：費用、等級上限、升級：Core.facilityCost is not a function`

- [ ] **Step 3：實作**

`static_src/starv_data.js`：把整個 `FACILITIES` 區塊

```js
  // 設施效果（§8.2；升級費用在計畫 3 補上）
  var FACILITIES = {
    dorm: { max: 10 },
    practice: { max: 5, trainGrowth: 0.1 },
    studio: { max: 5, stats: ["vocal"], dirs: ["singer", "band", "voice", "composer"], v: 0.04 },
    photo: { max: 5, stats: ["charm"], dirs: ["cm", "model", "influencer", "vtuber"], v: 0.04 },
    lounge: { max: 5, rest: 0.15, stress: 0.05 },
    pr: { max: 5, fameDecay: 0.1 },
    scout: { max: 5 }
  };
```

換成：

```js
  // 設施（§8.2）：升級費用 ＝ base × growth^(目前等級 − start)，取整到千
  function fac(o, name, desc) { o.name = T(name); o.desc = T(desc); return o; }
  var FACILITIES = {
    dorm: fac({ max: 10, start: 1, base: 30000, growth: 1.8 }, "宿舍|寮", "藝人人數上限；不受公司等級限制|タレントの人数上限。事務所レベルの制限なし"),
    practice: fac({ max: 5, start: 0, base: 40000, growth: 2, trainGrowth: 0.1 }, "練習室|練習室", "訓練效果 +10%／級；Lv1 解鎖演技、舞蹈高級課|トレーニング効果 +10%／Lv。Lv1 で演技・ダンスの上級レッスン解放"),
    studio: fac({ max: 5, start: 0, base: 50000, growth: 2, stats: ["vocal"], dirs: ["singer", "band", "voice", "composer"], v: 0.04 },
      "錄音室|レコーディングスタジオ", "歌唱課與歌手、樂團、聲優、配樂表現 +4%／級；Lv1 解鎖歌唱高級課|歌唱レッスンと歌手・バンド・声優・作曲の表現 +4%／Lv。Lv1 で歌唱の上級レッスン解放"),
    photo: fac({ max: 5, start: 0, base: 50000, growth: 2, stats: ["charm"], dirs: ["cm", "model", "influencer", "vtuber"], v: 0.04 },
      "攝影棚|撮影スタジオ", "魅力課與廣告、模特兒、網紅、虛擬主播表現 +4%／級；Lv1 解鎖魅力高級課|魅力レッスンと CM・モデル・インフルエンサー・VTuber の表現 +4%／Lv。Lv1 で魅力の上級レッスン解放"),
    lounge: fac({ max: 5, start: 0, base: 30000, growth: 2, rest: 0.15, stress: 0.05 }, "休息室|ラウンジ", "休息回復 +15%／級，壓力累積 −5%／級|休養の回復 +15%／Lv、ストレス蓄積 −5%／Lv"),
    pr: fac({ max: 5, start: 0, base: 60000, growth: 2, fameDecay: 0.1 }, "公關部|広報部", "人氣衰退 −10%／級，重大事件壞結果 −10%／級|人気の減少 −10%／Lv、重大イベントの悪い結果 −10%／Lv"),
    scout: fac({ max: 5, start: 0, base: 80000, growth: 2 }, "星探部|スカウト部", "一般試鏡 SR +0.3%、SSR +0.05%／級|一般オーディションの SR +0.3%・SSR +0.05%／Lv")
  };
  var FACILITY_ORDER = ["dorm", "practice", "studio", "photo", "lounge", "pr", "scout"];
```

並在 `root.PriTestStarvData = { … }` 物件中 `FACILITIES: FACILITIES,` 之後加上 `FACILITY_ORDER: FACILITY_ORDER,`。

`static_src/starv_core.js`：插在 `  // ==== exports ====` 之前：

```js
  // ==== 設施（§8.2） ====
  function facilityCap(st, f) {
    var F = D.FACILITIES[f];
    return f === "dorm" ? F.max : Math.min(F.max, st.company.level);
  }
  function facilityCost(st, f) {
    var F = D.FACILITIES[f];
    if (!F || st.facilities[f] >= F.max) return null;
    return Math.round(F.base * Math.pow(F.growth, st.facilities[f] - F.start) / 1000) * 1000;
  }
  function upgradeFacility(st, f) {
    var F = D.FACILITIES[f];
    if (!F || !F.base) return "noFacility";
    if (st.facilities[f] >= F.max) return "max";
    if (st.facilities[f] >= facilityCap(st, f)) return "level";
    var cost = facilityCost(st, f);
    if (st.company.money < cost) return "money";
    st.company.money -= cost;
    st.facilities[f]++;
    log(st, "facility_up", { f: f, lv: st.facilities[f] });
    return null;
  }
```

exports 區塊加入：

```js
  api.facilityCap = facilityCap;
  api.facilityCost = facilityCost;
  api.upgradeFacility = upgradeFacility;
```

- [ ] **Step 4：執行，確認通過**

Run: `node tools/starv_check/core_check.js`
Expected: `全部 54 個通過`

- [ ] **Step 5：commit**

```bash
node --check static_src/starv_data.js && node --check static_src/starv_core.js
git add static_src/starv_data.js static_src/starv_core.js tools/starv_check/core_check.js
git commit -m "feat(starv): 設施升級（費用、等級上限）"
```

---

### Task 2：業界趨勢與存檔版本 2

**Files:**
- Modify: `static_src/starv_data.js`、`static_src/starv_core.js`、`tools/starv_check/core_check.js`

**Interfaces:**
- Produces:
  - `D.SPECIAL_TRENDS`（陣列 `{ id, name, desc, dirs }`）、`D.SPECIAL_TREND_BY_ID`
  - `BAL.seasonDays = 90`、`BAL.trendHot = 1.5`、`BAL.trendCold = 0.7`、`BAL.specialTrendChance = 0.25`
  - `st.trend = { season, cur: { hot:[dir], cold: dir, special: id|null }, next: { … } }`
  - `Core.trendMult(st, dir) → 1.5 | 0.7 | 1`（特殊潮流的方向也算熱門）
  - 工作新增 `job.trend`（產生時的趨勢倍率），酬勞在產生時乘上、人氣在結算時乘上；熱門方向的工作在看板上出現機率 ×2、低迷 ×0.5
  - `genJob(st, over)`：`over` 可指定 `dir`、`tier`、`reservedFor`（指名工作：只有該藝人能接，不看人氣與熟練度門檻，角色固定主角）
  - 每季第一天寫入 `trend_new` 日誌 `{ season }`
  - `Core.VERSION === 2`；`migrate` 為沒有趨勢的舊存檔補上趨勢
  - `Core.seasonOf(day) → { year, season }`（season 1–4）

- [ ] **Step 1：寫失敗測試**

```js
test("趨勢：初始、季節更替、倍率", function () {
  var st = Core.create({ seed: 5 });
  var c = st.trend.cur;
  assert(c.hot.length >= 2 && c.hot.length <= 3, "熱門數"); assert(c.hot.indexOf(c.cold) < 0, "低迷不能是熱門");
  c.hot.forEach(function (d, i) { assert(D.DIR_BY_ID[d] && c.hot.indexOf(d) === i, "熱門方向不重複"); });
  eq(Core.trendMult(st, c.hot[0]), 1.5); eq(Core.trendMult(st, c.cold), 0.7);
  var next = JSON.stringify(st.trend.next);
  Core.advance(st, 90);
  eq(JSON.stringify(st.trend.cur), next, "下一季的傳聞成真"); eq(st.trend.season, 1);
  assert(st.log.some(function (e) { return e.type === "trend_new"; }), "日誌");
  var s2 = Core.seasonOf(90); eq(s2.year, 1); eq(s2.season, 2); eq(Core.seasonOf(360).year, 2);
});

test("趨勢：特殊潮流的方向也算熱門、工作帶趨勢倍率", function () {
  var st = Core.create({ seed: 5 });
  st.trend.cur = { hot: ["film", "drama"], cold: "anchor", special: "vtuber_boom" };
  eq(Core.trendMult(st, "vtuber"), 1.5); eq(Core.trendMult(st, "host"), 1);
  st.board = []; Core._refreshBoard(st);
  st.board.forEach(function (j) { eq(j.trend, Core.trendMult(st, j.dir), "job.trend " + j.dir); });
  var n = { hot: 0, cold: 0 };
  for (var i = 0; i < 3000; i++) { var j = Core._genJob(st); if (j.dir === "film") n.hot++; if (j.dir === "anchor") n.cold++; }
  assert(n.hot > n.cold * 2.5, "熱門出現較多 " + JSON.stringify(n));
});

test("指名工作：只有指定藝人能接、不看門檻", function () {
  var st = Core.create({ seed: 1 }), a = freshArtist(st), b = freshArtist(st);
  var j = Core._genJob(st, { dir: "film", tier: "C", reservedFor: a.id });
  st.board.push(j);
  eq(j.role, "lead"); eq(j.minFame, 0); eq(j.minProf, 1); eq(j.tier, "C"); eq(j.dir, "film");
  eq(Core.eligible(st, b, j), "reserved"); eq(Core.eligible(st, a, j), null);
});

test("存檔版本 2：舊存檔補上趨勢", function () {
  var st = Core.create({ seed: 1 });
  delete st.trend; st.version = 1;
  var m = Core.migrate(JSON.parse(JSON.stringify(st)));
  eq(m.version, 2); assert(m.trend && m.trend.cur.hot.length >= 2 && m.trend.next, "補上 trend");
});
```

- [ ] **Step 2：執行，確認失敗**

Run: `node tools/starv_check/core_check.js`
Expected: 4 個 FAIL（`Cannot read properties of undefined (reading 'cur')` 等）

- [ ] **Step 3：實作**

`static_src/starv_data.js`：在 `FACILITY_ORDER` 那行之後加入：

```js
  // 特殊潮流（§8.3）：持續一季，dirs 視同熱門方向
  function trendSp(id, name, desc, dirs) { return { id: id, name: T(name), desc: T(desc), dirs: dirs }; }
  var SPECIAL_TRENDS = [
    trendSp("vtuber_boom", "虛擬主播熱潮|VTuber ブーム", "直播平台爆發，虛擬主播、聲優與配樂需求大增。|配信プラットフォームが急成長。VTuber・声優・作曲の需要が急増。", ["vtuber", "voice", "composer"]),
    trendSp("audition_boom", "選秀節目大爆發|オーディション番組ブーム", "選秀節目收視長紅，偶像與舞團炙手可熱。|オーディション番組が高視聴率。アイドルとダンスグループが引っ張りだこ。", ["idol", "dancer"]),
    trendSp("cinema_revival", "電影復興|映画ルネサンス", "國片票房接連破紀錄，電影與配樂工作湧現。|邦画の興行記録が続々更新。映画と劇伴の仕事が急増。", ["film", "composer"]),
    trendSp("variety_gold", "綜藝黃金期|バラエティ黄金期", "週末綜藝大戰，主持人與搞笑藝人搶手。|週末バラエティ戦争。司会とお笑い芸人が大人気。", ["host", "comedy"]),
    trendSp("fashion_year", "時尚年|ファッションイヤー", "國際品牌接連進駐，模特兒與廣告代言機會變多。|海外ブランドが続々進出。モデルと CM のチャンスが増える。", ["model", "cm"]),
    trendSp("band_revival", "樂團復興|バンドリバイバル", "Live House 一票難求，樂團與歌手再度走紅。|ライブハウスのチケットが即完。バンドと歌手が再ブレイク。", ["band", "singer"])
  ];
```

在 `root.PriTestStarvData = { … }` 中 `FACILITY_ORDER: FACILITY_ORDER,` 之後加入 `SPECIAL_TRENDS: SPECIAL_TRENDS, SPECIAL_TREND_BY_ID: index(SPECIAL_TRENDS),`。

在 `BAL` 物件中 `logMax: 200, worksMax: 50` 之前加入：

```js
    seasonDays: 90, trendHot: 1.5, trendCold: 0.7, specialTrendChance: 0.25, trendBoardHot: 2, trendBoardCold: 0.5,
```

`static_src/starv_core.js`：
1. `var VERSION = 1;` 改成 `var VERSION = 2;`
2. `blankState` 回傳物件中 `log: [], logSeq: 0, nextId: 1` 之前加入：

```js
      trend: null, events: { pending: [] }, loans: [],
```

並在 `company:` 物件的 `safeLine: BAL.startSafeLine` 之後加上 `, crisisOn: false`。

3. `create` 中 `rotatePickup(st);` 之後加入 `initTrend(st);`（必須在 `refreshBoard(st);` 之前，產生工作時要用到趨勢）
4. `migrate` 中 `st.version = VERSION;` 之前加入：

```js
    if (!st.trend) initTrend(st);   // version 1 → 2：補上業界趨勢
```

5. 把整個 `genJob` 函式換成：

```js
  // over（可省略）：{ dir, tier, reservedFor }。reservedFor＝指名工作：只有該藝人能接，主角、不看人氣與熟練度門檻
  function genJob(st, over) {
    over = over || {};
    var tier = over.tier;
    if (!tier) {
      var weights = {}, hasS = st.board.some(function (j) { return j.tier === "S"; });
      D.TIER_ORDER.forEach(function (t) {
        if (D.TIERS[t].unlock > st.company.level) return;
        if (t === "S" && hasS) return;
        weights[t] = D.TIERS[t].w;
      });
      tier = wpick(st, weights);
    }
    var T = D.TIERS[tier];
    var d = over.dir ? dirById(over.dir) : null;
    if (!d) {
      var dw = {};
      D.DIRS.forEach(function (x) {
        var m = trendMult(st, x.id);
        dw[x.id] = m > 1 ? BAL.trendBoardHot : m < 1 ? BAL.trendBoardCold : 1;
      });
      d = dirById(wpick(st, dw));
    }
    var group = !over.reservedFor && d.group && rnd(st) < BAL.groupJobChance;
    var role = over.reservedFor ? "lead" : group ? "group" : wpick(st, { lead: 25, support: 45, cameo: 30 });
    var R = D.ROLES[role];
    var days = rint(st, T.days[0], T.days[1]);
    var slots = group ? rint(st, 2, 5) : 1;
    var mid = (T.days[0] + T.days[1]) / 2;
    var trend = trendMult(st, d.id);
    var pay = T.pay * R.pay * (days / mid) * (0.8 + rnd(st) * 0.4) * (group ? slots * 0.7 : 1) * trend;
    var job = {
      id: newId(st, "j"), dir: d.id, tier: tier, role: role, days: days, slots: slots,
      pay: Math.max(100, Math.round(pay / 100) * 100), fame: Math.round(T.fame * R.fame), rep: T.rep,
      minFame: T.minFame, minProf: T.minProf, isWork: tier !== "D", trend: trend,
      title: [rint(st, 0, d.title.a.length - 1), rint(st, 0, d.title.b.length - 1)],
      expires: st.day + BAL.jobLifeDays
    };
    if (over.reservedFor) { job.reservedFor = over.reservedFor; job.minFame = 0; job.minProf = 1; }
    return job;
  }
```

6. `eligible` 中 `if (a.task) return "busy";` 之後加入：

```js
    if (job.reservedFor && job.reservedFor !== a.id) return "reserved";
```

7. `resolveJob` 中

```js
      a.fame = clamp(a.fame + Math.round(job.fame * R.fame * fxMult(a, "fame")), 0, 99999);
```

換成：

```js
      a.fame = clamp(a.fame + Math.round(job.fame * R.fame * fxMult(a, "fame") * (job.trend || 1)), 0, 99999);
```

8. 插在 `  // ==== exports ====` 之前：

```js
  // ==== 業界趨勢（§8.3） ====
  function rollTrend(st) {
    var ids = D.DIRS.map(function (d) { return d.id; }), hot = [], n = rint(st, 2, 3), cold;
    while (hot.length < n) { var x = pick(st, ids); if (hot.indexOf(x) < 0) hot.push(x); }
    do { cold = pick(st, ids); } while (hot.indexOf(cold) >= 0);
    var special = rnd(st) < BAL.specialTrendChance ? pick(st, D.SPECIAL_TRENDS).id : null;
    return { hot: hot, cold: cold, special: special };
  }
  function initTrend(st) {
    st.trend = { season: Math.floor(st.day / BAL.seasonDays), cur: rollTrend(st), next: rollTrend(st) };
  }
  function seasonTick(st) {
    if (st.day % BAL.seasonDays !== 0) return;
    st.trend.season = st.day / BAL.seasonDays;
    st.trend.cur = st.trend.next;
    st.trend.next = rollTrend(st);
    log(st, "trend_new", { season: st.trend.season });
  }
  function trendMult(st, dir) {
    var c = st.trend && st.trend.cur;
    if (!c) return 1;
    var sp = c.special ? D.SPECIAL_TREND_BY_ID[c.special] : null;
    if (c.hot.indexOf(dir) >= 0 || (sp && sp.dirs.indexOf(dir) >= 0)) return BAL.trendHot;
    if (c.cold === dir) return BAL.trendCold;
    return 1;
  }
  function seasonOf(day) {
    var s = Math.floor(day / BAL.seasonDays);
    return { year: Math.floor(s / 4) + 1, season: (s % 4) + 1 };
  }
```

9. `advanceDay` 中 `tickBoard(st);` 之前加入 `seasonTick(st);`（新一季先換趨勢，再刷新看板）

10. exports 區塊加入：

```js
  api.trendMult = trendMult;
  api.seasonOf = seasonOf;
```

並把 `api._genJob = genJob;` 保持不變（測試以 `Core._genJob(st, over)` 呼叫）。

- [ ] **Step 4：執行，確認通過**

Run: `node tools/starv_check/core_check.js`
Expected: `全部 58 個通過`

若計畫 1 的「離線：一次結算與逐日結算結果相同」或其他測試失敗，原因只可能是趨勢改變了亂數消耗順序而測試寫死了某個值；逐一確認失敗原因後修正測試期望值，並在測試旁註解「計畫 3 加入趨勢後亂數順序改變」。

- [ ] **Step 5：commit**

```bash
node --check static_src/starv_data.js && node --check static_src/starv_core.js
git add static_src/starv_data.js static_src/starv_core.js tools/starv_check/core_check.js
git commit -m "feat(starv): 業界趨勢（每季熱門／低迷、特殊潮流）、指名工作、存檔版本 2"
```

---

### Task 3：重大事件登記器與 v1 資料

**Files:**
- Create: `static_src/starv_events.js`、`static_src/starv_events_1.js`
- Modify: `tools/starv_check/core_check.js`、`site_src/starv_page.py`、`tools/starv_check/sim.js`

**Interfaces:**
- Consumes: `D.T`
- Produces:
  - `PriTestStarvEvents.add(list)`（ID 重複就丟錯）、`.all()`、`.byId(id) → event|null`、`.byTarget(key) → [event]`（只含 random 觸發）、`.CATS`
  - 登記時同步維護 `D.EVENTS`（陣列）、`D.EVENT_BY_ID`、`D.EVENT_CATS = ["scandal","chance","poach","net","health","company","special"]`，核心以這三個欄位讀取
  - 事件格式：`{ id, addedIn, category, target, trigger: "random"|"cond", weight, title:{zh,ja}, text:{zh,ja}, choices:[{ label, hint, outcomes:[{ w, fx, bad }] }], defaultChoice }`
  - `target`：`none`（公司事件）或篩選鍵 `any`／`famous`／`rookie`／`music`／`dance`／`stream`／`stressed`／`unhappy`／`lowmood`／`idle`
  - 文字中的佔位：`{name}`（目標藝人）、`{n}`（條件事件的數字，例如人氣門檻）
  - `fx` 可用鍵（Task 4 的 `applyFx` 實作）：公司 `money`、`tickets`、`rep`、`loan:{amount, monthly, months}`、`sellTop`；藝人 `fame`、`famePct`、`stress`、`stamina`、`satisfaction`、`mood`、`salaryPct`、`statAll`、`stat:{能力:值}`、`rest`（天）、`specialJob`、`leave`、`moneyBySalary`（月薪倍數的違約金收入）；全員 `allStress`、`allSatisfaction`、`allSalaryPct`
  - 載入順序：`starv_data.js` → `starv_events.js` → `starv_events_1.js`（→ 之後的 `_2.js` …）→ `starv_roster.js`

- [ ] **Step 1：寫失敗測試**

`core_check.js` 的 `require("../../static_src/starv_data.js");` 之後加入：

```js
require("../../static_src/starv_events.js");
require("../../static_src/starv_events_1.js");
var Events = global.PriTestStarvEvents;
```

插在 `// ==== run ====` 之前：

```js
test("事件資料：40 種、格式正確", function () {
  var FX = ["money", "tickets", "rep", "loan", "sellTop", "fame", "famePct", "stress", "stamina", "satisfaction", "mood", "salaryPct",
    "statAll", "stat", "rest", "specialJob", "leave", "moneyBySalary", "allStress", "allSatisfaction", "allSalaryPct"];
  var TARGETS = ["none", "any", "famous", "rookie", "music", "dance", "stream", "stressed", "unhappy", "lowmood", "idle"];
  eq(D.EVENTS.length, Events.all().length, "D.EVENTS 與登記器一致");
  eq(Events.all().filter(function (e) { return e.addedIn === "v1"; }).length, 40, "v1 事件數");
  var seen = {};
  D.EVENTS.forEach(function (ev) {
    assert(!seen[ev.id], "重複 " + ev.id); seen[ev.id] = 1;
    assert(D.EVENT_BY_ID[ev.id] === ev, "EVENT_BY_ID");
    assert(D.EVENT_CATS.indexOf(ev.category) >= 0, ev.id + " 分類");
    assert(TARGETS.indexOf(ev.target) >= 0, ev.id + " target");
    assert(ev.trigger === "random" || ev.trigger === "cond", ev.id + " trigger");
    assert(ev.title.zh && ev.title.ja && ev.text.zh && ev.text.ja, ev.id + " 文字");
    assert(ev.choices.length >= 2 && ev.choices.length <= 3, ev.id + " 選項數");
    assert(ev.choices[ev.defaultChoice], ev.id + " defaultChoice");
    ev.choices.forEach(function (c, i) {
      assert(c.label.zh && c.label.ja && c.hint.zh && c.hint.ja, ev.id + " 選項文字 " + i);
      assert(c.outcomes.length >= 1, ev.id + " 結果");
      c.outcomes.forEach(function (o) {
        assert(o.w > 0, ev.id + " 權重");
        Object.keys(o.fx).forEach(function (k) { assert(FX.indexOf(k) >= 0, ev.id + " 不支援的 fx " + k); });
        if (o.fx.stat) Object.keys(o.fx.stat).forEach(function (s) { assert(D.STATS.indexOf(s) >= 0, ev.id + " stat " + s); });
      });
    });
  });
  ["strike_talk", "fame_milestone", "finance_crisis", "ssr_debut"].forEach(function (id) { eq(D.EVENT_BY_ID[id].trigger, "cond", id); });
});

test("事件登記器：重複 ID 丟錯、依目標分組", function () {
  var threw = false;
  try { Events.add([Events.byId("charity")]); } catch (e) { threw = true; }
  assert(threw, "重複 ID 沒有丟錯");
  eq(Events.byId("nope"), null);
  var famous = Events.byTarget("famous");
  assert(famous.length > 0 && famous.every(function (e) { return e.target === "famous" && e.trigger === "random"; }), "byTarget");
  assert(Events.byTarget("any").every(function (e) { return e.trigger === "random"; }), "條件事件不在 byTarget 裡");
});
```

- [ ] **Step 2：執行，確認失敗**

Run: `node tools/starv_check/core_check.js`
Expected: `Cannot find module '../../static_src/starv_events.js'`

- [ ] **Step 3a：建立 `static_src/starv_events.js`**

```js
// 明星經紀 starV：重大事件登記器（規格 §7；使用者指定 2026-10-27：事件之後要擴充到上千種）。
// 事件資料分檔（starv_events_1.js、_2.js …），各自呼叫 add() 追加；ID 永不重用，重複就丟錯。
// 登記時同步維護 PriTestStarvData 的 EVENTS／EVENT_BY_ID／EVENT_CATS，核心只讀這三個欄位。
// byTarget(key) 先依目標篩選鍵分好組，抽隨機事件時每個篩選鍵只需對藝人算一次。
(function () {
  "use strict";

  var root = typeof window !== "undefined" ? window : globalThis;
  var D = root.PriTestStarvData;
  var CATS = ["scandal", "chance", "poach", "net", "health", "company", "special"];
  var list = [];
  var map = {};
  var byTarget = {};

  function add(events) {
    events.forEach(function (ev) {
      if (map[ev.id]) throw new Error("starV events: 重複的 ID " + ev.id);
      map[ev.id] = ev;
      list.push(ev);
      if (ev.trigger === "random") (byTarget[ev.target] || (byTarget[ev.target] = [])).push(ev);
    });
  }

  D.EVENTS = list;
  D.EVENT_BY_ID = map;
  D.EVENT_CATS = CATS;
  root.PriTestStarvEvents = {
    add: add,
    all: function () { return list.slice(); },
    byId: function (id) { return map[id] || null; },
    byTarget: function (key) { return (byTarget[key] || []).slice(); },
    targets: function () { return Object.keys(byTarget); },
    CATS: CATS
  };
})();
```

- [ ] **Step 3b：建立 `static_src/starv_events_1.js`**

```js
// 明星經紀 starV：重大事件 v1（40 種；規格 §7）。只放資料；觸發、選擇、效果套用在 starv_core.js。
// 擴充時新增 starv_events_2.js …（同樣的 E/C/O 寫法，addedIn 改成新的版本標籤），並登記到 starv_page.py。
// 每個事件 2～3 個選項，選項只寫傾向（hint），實際效果由 outcomes 依權重抽一個（bad＝壞結果，公關部會壓低它的權重）。
// defaultChoice＝逾期或離線時自動選的選項，一律挑比較保守的。
(function () {
  "use strict";

  var root = typeof window !== "undefined" ? window : globalThis;
  var D = root.PriTestStarvData;
  var T = D.T;

  function O(w, fx, bad) { return { w: w, fx: fx || {}, bad: !!bad }; }
  function C(label, hint, outcomes) { return { label: T(label), hint: T(hint), outcomes: outcomes }; }
  function E(id, category, target, title, text, choices, defaultChoice, trigger) {
    return { id: id, addedIn: "v1", category: category, target: target, trigger: trigger || "random", weight: 10,
      title: T(title), text: T(text), choices: choices, defaultChoice: defaultChoice };
  }

  var EVENTS = [
    // ---- 醜聞 ----
    E("love_rumor", "scandal", "famous", "戀愛緋聞|熱愛報道", "{name} 和圈外人約會的照片被週刊拍到了。|{name} の一般人とのデート写真が週刊誌に撮られた。", [
      C("公開承認|交際を認める", "人氣↕ 壓力↓|人気↕ ストレス↓", [O(6, { famePct: -0.1, stress: -15, satisfaction: 5 }, true), O(4, { famePct: 0.1, stress: -10 })]),
      C("否認到底|否定し続ける", "人氣維持 壓力↑|人気維持 ストレス↑", [O(6, { stress: 15 }), O(4, { famePct: -0.25, stress: 20 }, true)]),
      C("冷處理|ノーコメント", "人氣小幅↓|人気やや↓", [O(7, { famePct: -0.05 }), O(3, { famePct: -0.15 }, true)])
    ], 2),
    E("old_post", "scandal", "famous", "舊貼文被翻出|過去の投稿が発掘", "{name} 多年前的失言貼文被網友翻出來，正在延燒。|{name} の数年前の失言投稿が掘り起こされ、炎上中。", [
      C("直播道歉|配信で謝罪", "人氣小幅↓ 壓力↑|人気やや↓ ストレス↑", [O(7, { famePct: -0.05, stress: 10 }), O(3, { famePct: 0.05 })]),
      C("不回應|反応しない", "可能延燒|延焼のおそれ", [O(5, { famePct: -0.1 }), O(5, { famePct: -0.25, satisfaction: -5 }, true)])
    ], 1),
    E("diva_rumor", "scandal", "famous", "耍大牌傳聞|わがまま疑惑", "傳出 {name} 在片場耍大牌，劇組人員匿名爆料。|{name} が現場でわがままだったと、スタッフが匿名で暴露。", [
      C("帶點心向劇組道歉|差し入れを持って謝罪", "花錢 人氣小幅↓|出費 人気やや↓", [O(8, { money: -5000, famePct: -0.03 }), O(2, { money: -5000, famePct: 0.03 })]),
      C("發聲明澄清|声明で否定", "看運氣|運次第", [O(6, {}), O(4, { famePct: -0.12, stress: 10 }, true)])
    ], 1),
    E("night_out", "scandal", "famous", "深夜聚會被拍|深夜の会食を撮られる", "{name} 深夜和朋友聚會的照片流出，被說不夠自律。|{name} の深夜の会食写真が流出、自己管理が甘いと批判。", [
      C("禁足一週|一週間の謹慎", "休息 滿意度↓|休養 満足度↓", [O(1, { rest: 7, satisfaction: -10, stress: -10 })]),
      C("說是工作聚會|仕事の打ち合わせと説明", "看運氣|運次第", [O(5, {}), O(5, { famePct: -0.15 }, true)])
    ], 1),
    E("plagiarism", "scandal", "music", "抄襲疑雲|盗作疑惑", "{name} 的新歌被指和某首老歌太像。|{name} の新曲がある古い曲に似すぎていると指摘された。", [
      C("委託專家鑑定|専門家に鑑定を依頼", "花錢 澄清機會大|出費 潔白の可能性大", [O(7, { money: -20000, famePct: 0.05 }), O(3, { money: -20000, famePct: -0.1 }, true)]),
      C("低調等風頭過|静かにやり過ごす", "人氣↓|人気↓", [O(5, { famePct: -0.08 }), O(5, { famePct: -0.2, stress: 15 }, true)])
    ], 1),
    E("stalker", "scandal", "famous", "私生飯騷擾|過激なファン", "有私生飯一直跟蹤 {name}，讓 {name} 很不安。|過激なファンが {name} をつけ回し、本人はおびえている。", [
      C("加強保全|警備を強化", "花錢 壓力↓|出費 ストレス↓", [O(1, { money: -15000, stress: -10, satisfaction: 5 })]),
      C("先忍耐|しばらく我慢", "壓力↑ 心情↓|ストレス↑ 気分↓", [O(1, { stress: 20, mood: -1 })])
    ], 1),

    // ---- 機會 ----
    E("director_call", "chance", "any", "名導指名試鏡|名監督から指名", "知名導演看了 {name} 的作品，指名要見面試鏡。|有名監督が {name} の出演作を見て、オーディションに指名してきた。", [
      C("接受指名|指名を受ける", "看板出現指名工作|指名の仕事がボードに", [O(1, { specialJob: true, satisfaction: 5 })]),
      C("婉拒|辞退する", "沒有變化|変化なし", [O(1, {})])
    ], 1),
    E("brand_offer", "chance", "famous", "品牌代言邀約|ブランドのオファー", "化妝品牌想找 {name} 當新品代言人。|化粧品ブランドが新商品のモデルに {name} を起用したいそうだ。", [
      C("接下代言|オファーを受ける", "資金↑ 人氣↑ 壓力↑|資金↑ 人気↑ ストレス↑", [O(1, { money: 30000, fame: 50, stress: 10 })]),
      C("婉拒|辞退する", "沒有變化|変化なし", [O(1, {})])
    ], 1),
    E("variety_guest", "chance", "idle", "綜藝臨時邀約|バラエティの急な出演依頼", "綜藝節目的來賓臨時開天窗，製作人問 {name} 能不能救火。|バラエティのゲストが急遽欠席。{name} に代役の打診が来た。", [
      C("馬上出發|すぐ向かう", "人氣↑ 體力↓|人気↑ 体力↓", [O(7, { fame: 40, stamina: -15 }), O(3, { fame: 90, stamina: -15 })]),
      C("婉拒|断る", "沒有變化|変化なし", [O(1, {})])
    ], 1),
    E("master_class", "chance", "any", "大師課名額|マスタークラスの枠", "傳奇老師開了大師課，剛好空出一個名額給 {name}。|伝説の講師のマスタークラスに {name} の枠が一つ空いた。", [
      C("報名|申し込む", "花錢 能力全面↑|出費 全能力↑", [O(1, { money: -30000, statAll: 8 })]),
      C("放棄|見送る", "沒有變化|変化なし", [O(1, {})])
    ], 1),
    E("overseas", "chance", "any", "海外交流邀請|海外研修の誘い", "海外劇團邀請 {name} 去交流十天。|海外の劇団から {name} に十日間の研修の誘い。", [
      C("參加|参加する", "花錢 離開十天 能力↑ 人氣↑|出費 十日不在 能力↑ 人気↑", [O(1, { money: -20000, rest: 10, statAll: 12, fame: 60 })]),
      C("婉拒|断る", "沒有變化|変化なし", [O(1, {})])
    ], 1),
    E("charity", "chance", "any", "慈善活動邀請|チャリティーの依頼", "公益團體邀請 {name} 擔任慈善晚會的嘉賓。|福祉団体から {name} にチャリティーイベントのゲスト依頼。", [
      C("參加|参加する", "聲望↑ 人氣↑ 體力↓|評判↑ 人気↑ 体力↓", [O(1, { rep: 40, fame: 30, stamina: -10 })]),
      C("婉拒|断る", "沒有變化|変化なし", [O(1, {})])
    ], 1),
    E("photo_book", "chance", "famous", "寫真集企劃|写真集の企画", "出版社想幫 {name} 出第一本寫真集。|出版社が {name} のファースト写真集を出したいそうだ。", [
      C("出版|出版する", "資金↑ 人氣↑ 壓力↑|資金↑ 人気↑ ストレス↑", [O(7, { money: 40000, famePct: 0.05, stress: 5 }), O(3, { money: 15000, stress: 10 }, true)]),
      C("不出|見送る", "沒有變化|変化なし", [O(1, {})])
    ], 1),
    E("song_gift", "chance", "music", "作曲家贈曲|作曲家から楽曲提供", "知名作曲家說很欣賞 {name}，想寫一首歌送給 {name}。|有名作曲家が {name} を気に入り、一曲書きたいと言っている。", [
      C("感激收下|ありがたく受け取る", "歌唱↑ 創意↑ 人氣↑|歌唱↑ センス↑ 人気↑", [O(1, { stat: { vocal: 10, sense: 5 }, fame: 30 })]),
      C("婉拒|丁重に断る", "沒有變化|変化なし", [O(1, {})])
    ], 1),

    // ---- 挖角 ----
    E("poach_offer", "poach", "famous", "高薪挖角|高額の引き抜き", "其他經紀公司開出兩倍月薪，想挖走 {name}。|他の事務所が月給倍額で {name} を引き抜こうとしている。", [
      C("加薪留人|昇給して引き留める", "月薪↑ 滿意度↑|月給↑ 満足度↑", [O(1, { salaryPct: 0.3, satisfaction: 15 })]),
      C("放人換違約金|違約金をもらって手放す", "失去藝人 資金↑|タレントを失う 資金↑", [O(1, { leave: true, moneyBySalary: 6 })]),
      C("談感情|情に訴える", "看滿意度|満足度次第", [O(5, { satisfaction: -5 }), O(5, { leave: true }, true)])
    ], 2),
    E("indie_dream", "poach", "unhappy", "想自立門戶|独立したい", "{name} 私下透露想離開公司自己發展。|{name} が事務所を辞めて独立したいと漏らしている。", [
      C("加薪|昇給する", "月薪↑ 滿意度↑|月給↑ 満足度↑", [O(1, { salaryPct: 0.2, satisfaction: 20 })]),
      C("給一週假|一週間の休暇", "休息 滿意度↑|休養 満足度↑", [O(1, { rest: 7, satisfaction: 10, stress: -20 })]),
      C("不理會|放っておく", "可能真的走掉|本当に辞めるかも", [O(5, { satisfaction: -10 }), O(5, { leave: true }, true)])
    ], 1),
    E("scout_rival", "poach", "rookie", "新人被盯上|新人が狙われている", "其他經紀公司的星探在打聽 {name} 的合約條件。|他事務所のスカウトが {name} の契約条件を探っている。", [
      C("先簽長約|長期契約を結ぶ", "花錢 滿意度↑|出費 満足度↑", [O(1, { money: -10000, satisfaction: 10 })]),
      C("無視|気にしない", "多半沒事|たぶん大丈夫", [O(8, {}), O(2, { leave: true }, true)])
    ], 1),
    E("manager_quit", "poach", "none", "王牌經紀人被挖角|敏腕マネージャーの引き抜き", "公司最能幹的經紀人收到其他公司的邀請。|事務所で一番の敏腕マネージャーが他社から誘われている。", [
      C("加薪留住|昇給して引き留める", "花錢|出費", [O(1, { money: -30000 })]),
      C("讓他走|送り出す", "全員滿意度↓ 聲望↓|全員の満足度↓ 評判↓", [O(1, { allSatisfaction: -5, rep: -20 })])
    ], 1),

    // ---- 網路 ----
    E("viral_old", "net", "any", "舊影片爆紅|昔の動画がバズる", "{name} 出道前的影片突然在網路上爆紅。|{name} のデビュー前の動画が突然バズった。", [
      C("趁勢宣傳|波に乗って宣伝", "花錢 人氣大漲 壓力↑|出費 人気急上昇 ストレス↑", [O(1, { money: -5000, famePct: 0.3, fame: 30, stress: 10 })]),
      C("低調|静観する", "人氣↑|人気↑", [O(1, { famePct: 0.1, fame: 10 })])
    ], 1),
    E("meme", "net", "any", "被做成迷因|ミーム化", "{name} 的某個表情被網友做成迷因瘋傳。|{name} のある表情がミームになって拡散中。", [
      C("自嘲回應|自虐で乗っかる", "人氣↑|人気↑", [O(7, { fame: 80 }), O(3, { fame: 20, stress: 5 })]),
      C("要求下架|削除を求める", "看運氣|運次第", [O(5, {}), O(5, { famePct: -0.1 }, true)]),
      C("無視|スルーする", "人氣小幅↑|人気やや↑", [O(1, { fame: 20 })])
    ], 2),
    E("stream_accident", "net", "stream", "直播事故|配信事故", "{name} 直播時忘了關麥克風，私下的抱怨全被聽到了。|{name} が配信でマイクを切り忘れ、愚痴が全部流れた。", [
      C("誠懇道歉|誠実に謝る", "壓力↑|ストレス↑", [O(1, { stress: 10 })]),
      C("當成梗|ネタにする", "看運氣|運次第", [O(6, { fame: 100 }), O(4, { famePct: -0.15 }, true)]),
      C("不回應|反応しない", "人氣小幅↓|人気やや↓", [O(1, { famePct: -0.05 })])
    ], 2),
    E("fan_war", "net", "famous", "粉絲大戰|ファン同士の対立", "{name} 的粉絲和別家粉絲在網路上吵翻了。|{name} のファンが他のファンとネットで大喧嘩。", [
      C("出面安撫|仲裁に入る", "壓力↑ 人氣↑|ストレス↑ 人気↑", [O(1, { stress: 10, satisfaction: 5, fame: 20 })]),
      C("不介入|関わらない", "看運氣|運次第", [O(6, {}), O(4, { famePct: -0.1 }, true)])
    ], 1),
    E("fake_news", "net", "famous", "假新聞|フェイクニュース", "網路上流傳 {name} 即將引退的假消息。|{name} が引退するというデマがネットに出回っている。", [
      C("提告造謠者|デマの発信者を訴える", "花錢 聲望↑|出費 評判↑", [O(1, { money: -20000, rep: 20 })]),
      C("發文澄清|投稿で否定", "壓力小幅↑|ストレスやや↑", [O(1, { stress: 5 })])
    ], 1),
    E("challenge_trend", "net", "any", "挑戰影片風潮|チャレンジ動画ブーム", "網路上正流行一個舞蹈挑戰，粉絲許願 {name} 也拍一支。|ダンスチャレンジが流行中。ファンが {name} にもやってほしいと熱望。", [
      C("跟風拍一支|撮ってみる", "人氣↑ 體力↓|人気↑ 体力↓", [O(1, { fame: 50, stamina: -10 })]),
      C("不拍|撮らない", "沒有變化|変化なし", [O(1, {})])
    ], 1),

    // ---- 健康 ----
    E("overwork", "health", "stressed", "過勞警訊|過労のサイン", "{name} 最近臉色很差，經紀人擔心是過勞。|{name} の顔色が悪い。マネージャーは過労を心配している。", [
      C("強制休假|休暇を取らせる", "休息 壓力大降|休養 ストレス大幅↓", [O(1, { rest: 5, stress: -30 })]),
      C("硬撐|続行する", "看運氣|運次第", [O(5, { stress: 10 }), O(5, { stamina: -40, stress: 20 }, true)])
    ], 0),
    E("throat", "health", "music", "喉嚨發炎|喉の炎症", "{name} 的喉嚨發炎，聲音有點沙啞。|{name} が喉を傷めて声がかすれている。", [
      C("好好休養|しっかり休む", "休息|休養", [O(1, { rest: 4 })]),
      C("吃藥上陣|薬を飲んで続ける", "看運氣|運次第", [O(6, { stress: 5 }), O(4, { stat: { vocal: -5 }, stress: 10 }, true)])
    ], 0),
    E("injury", "health", "dance", "練舞扭傷|練習中のねんざ", "{name} 練舞時扭到腳。|{name} がダンスの練習中に足をひねった。", [
      C("休養一週|一週間休む", "休息|休養", [O(1, { rest: 7 })]),
      C("繼續練|練習を続ける", "看運氣|運次第", [O(5, { stamina: -30 }), O(5, { stat: { dance: -10 }, stamina: -30 }, true)])
    ], 0),
    E("insomnia", "health", "any", "失眠|不眠", "{name} 最近一直睡不好。|{name} が最近よく眠れていない。", [
      C("安排心理諮商|カウンセリングを手配", "花錢 壓力↓ 心情↑|出費 ストレス↓ 気分↑", [O(1, { money: -8000, stress: -25, mood: 1 })]),
      C("讓他自己調適|本人に任せる", "看運氣|運次第", [O(5, { stress: -5 }), O(5, { mood: -1, stress: 10 }, true)])
    ], 0),
    E("diet", "health", "any", "極端節食|過度なダイエット", "{name} 為了上鏡好看在極端節食。|{name} がカメラ映えのために過度なダイエットをしている。", [
      C("請營養師|栄養士をつける", "花錢 體力↑|出費 体力↑", [O(1, { money: -10000, stamina: 20 })]),
      C("尊重本人|本人の意思を尊重", "看運氣|運次第", [O(5, { stat: { charm: 3 } }), O(5, { stamina: -30, mood: -1 }, true)])
    ], 0),
    E("slump", "health", "lowmood", "低潮期|スランプ", "{name} 陷入低潮，練習也提不起勁。|{name} がスランプに陥り、練習にも身が入らない。", [
      C("放假去旅行|旅行に行かせる", "花錢 休息 心情大好|出費 休養 気分大幅↑", [O(1, { money: -15000, rest: 3, mood: 2, stress: -20 })]),
      C("加練突破|練習で乗り越える", "看運氣|運次第", [O(5, { statAll: 3, stress: 15 }), O(5, { mood: -1, stress: 10 }, true)])
    ], 0),

    // ---- 公司 ----
    E("investor", "company", "none", "投資人提議|投資家の提案", "有投資人想入股公司，條件是要更重視商業案。|投資家が出資を申し出た。条件は商業案件を重視すること。", [
      C("接受投資|出資を受ける", "資金大增 聲望↓|資金大幅↑ 評判↓", [O(1, { money: 200000, rep: -30 })]),
      C("婉拒|断る", "沒有變化|変化なし", [O(1, {})])
    ], 1),
    E("staff_trip", "company", "none", "員工旅遊|社員旅行", "大家最近都很累，有人提議辦一次員工旅遊。|みんな疲れ気味。社員旅行をしようという声が上がった。", [
      C("舉辦|開催する", "花錢 全員壓力↓ 滿意度↑|出費 全員ストレス↓ 満足度↑", [O(1, { money: -30000, allStress: -15, allSatisfaction: 8 })]),
      C("今年先不辦|今年は見送る", "沒有變化|変化なし", [O(1, {})])
    ], 1),
    E("tax_audit", "company", "none", "稅務稽查|税務調査", "國稅局通知要來查帳。|税務署から調査の通知が届いた。", [
      C("全力配合|全面的に協力", "花錢|出費", [O(1, { money: -20000 })]),
      C("請會計師處理|税理士に任せる", "看運氣|運次第", [O(7, { money: -10000 }), O(3, { money: -60000 }, true)])
    ], 1),
    E("tv_deal", "company", "none", "電視台合作提案|テレビ局との提携案", "電視台提議簽下整季的通告合作。|テレビ局からワンシーズン分の出演提携の提案。", [
      C("簽約|契約する", "資金↑ 全員壓力↑|資金↑ 全員ストレス↑", [O(1, { money: 50000, allStress: 10 })]),
      C("不簽|見送る", "沒有變化|変化なし", [O(1, {})])
    ], 1),
    E("industry_dinner", "company", "none", "業界餐會|業界の会食", "大型經紀公司的社長邀請你參加業界餐會。|大手事務所の社長から業界の会食に誘われた。", [
      C("出席|出席する", "花錢 聲望↑|出費 評判↑", [O(1, { money: -10000, rep: 60 })]),
      C("不去|欠席する", "沒有變化|変化なし", [O(1, {})])
    ], 1),
    E("talent_show", "company", "none", "選秀節目合作|オーディション番組との提携", "選秀節目想和公司合作，提供優先簽約權。|オーディション番組が提携を持ちかけてきた。優先契約権つき。", [
      C("合作|提携する", "花錢 星探券↑|出費 スカウト券↑", [O(1, { money: -20000, tickets: 3 })]),
      C("婉拒|断る", "沒有變化|変化なし", [O(1, {})])
    ], 1),

    // ---- 條件觸發 ----
    E("strike_talk", "special", "any", "罷工談判|ストライキの話し合い", "{name} 壓力爆表罷工了，說想和社長好好談談。|{name} がストレスの限界でストライキ。社長と話がしたいそうだ。", [
      C("加薪|昇給する", "月薪↑ 滿意度↑|月給↑ 満足度↑", [O(1, { salaryPct: 0.15, satisfaction: 15 })]),
      C("好好聊聊|じっくり話す", "滿意度小幅↑ 壓力↓|満足度やや↑ ストレス↓", [O(1, { satisfaction: 5, stress: -10 })]),
      C("嚴厲訓話|厳しく叱る", "滿意度↓ 能力小幅↑|満足度↓ 能力やや↑", [O(1, { satisfaction: -15, statAll: 2 })])
    ], 1, "cond"),
    E("fame_milestone", "special", "any", "人氣突破門檻|人気が大台に", "{name} 的人氣突破 {n}！粉絲團想辦見面會。|{name} の人気が {n} を突破！ファンクラブがファンミーティングを開きたいそうだ。", [
      C("辦見面會|ファンミーティングを開く", "花錢 人氣↑ 滿意度↑|出費 人気↑ 満足度↑", [O(1, { money: -10000, famePct: 0.1, satisfaction: 10 })]),
      C("改天再說|また今度", "沒有變化|変化なし", [O(1, {})])
    ], 1, "cond"),
    E("finance_crisis", "special", "none", "財務危機|財務危機", "公司已經連續三個月赤字，銀行打電話來關切了。|三か月連続の赤字。銀行から問い合わせの電話が来た。", [
      C("賣掉一份合約|契約を一つ売る", "失去月薪最高的待命藝人 資金↑|待機中で月給最高のタレントを失う 資金↑", [O(1, { sellTop: true })]),
      C("向銀行借款|銀行から借りる", "資金↑ 之後每月還款|資金↑ 以後毎月返済", [O(1, { loan: { amount: 200000, monthly: 12000, months: 20 } })]),
      C("全員減薪|全員の給料カット", "全員月薪↓ 壓力↑ 滿意度↓|全員月給↓ ストレス↑ 満足度↓", [O(1, { allSalaryPct: -0.2, allStress: 15, allSatisfaction: -10 })])
    ], 2, "cond"),
    E("ssr_debut", "special", "any", "大型新人入社|大型新人の入所", "{name} 入社的消息一傳開，媒體就搶著要專訪。|{name} の入所が知れ渡り、メディアが取材を申し込んできた。", [
      C("安排專訪|取材を受ける", "人氣↑ 體力↓|人気↑ 体力↓", [O(1, { fame: 100, stamina: -10 })]),
      C("先低調|しばらく伏せる", "沒有變化|変化なし", [O(1, {})])
    ], 1, "cond")
  ];

  root.PriTestStarvEvents.add(EVENTS);
})();
```

- [ ] **Step 4：登記載入順序**

`site_src/starv_page.py` 的 `STARV_SCRIPTS`：在 `"starv_data.js",` 之後依序加 `"starv_events.js",`、`"starv_events_1.js",`

`tools/starv_check/sim.js` 的 `require("../../static_src/starv_data.js");` 之後加：

```js
require("../../static_src/starv_events.js");
require("../../static_src/starv_events_1.js");
```

- [ ] **Step 5：執行，確認通過**

Run: `node tools/starv_check/core_check.js`
Expected: `全部 60 個通過`

- [ ] **Step 6：commit**

```bash
node --check static_src/starv_events.js && node --check static_src/starv_events_1.js
git add static_src/starv_events.js static_src/starv_events_1.js tools/starv_check/core_check.js tools/starv_check/sim.js site_src/starv_page.py
git commit -m "feat(starv): 重大事件登記器與 v1 的 40 種事件"
```

---

### Task 4：事件引擎、借款、財務危機、條件觸發

**Files:**
- Modify: `static_src/starv_core.js`、`static_src/starv_data.js`、`tools/starv_check/core_check.js`

**Interfaces:**
- Consumes: `D.EVENTS`、`genJob(st, over)`、`addRep`
- Produces:
  - `BAL`：`eventDailyChance: 0.08`、`eventDeadlineDays: 3`、`eventMax: 3`、`prBadCut: 0.1`、`famousFame: 200`、`rookieDays: 60`、`fameMilestones: [1000, 5000, 20000, 50000]`、`sellContractMonths: 6`
  - `st.events.pending[i] = { uid:"e<n>", id, aid|null, ctx:{}, day, deadline }`
  - `Core.triggerEvent(st, id, aid?, ctx?) → pending | null`
  - `Core.triggerRandomEvent(st) → pending | null`（依目標篩選與權重抽一件）
  - `Core.resolveEvent(st, uid, choiceIdx) → { err: "noEvent"|"choice" } | { outcome, fx, bad }`；`fx` 是實際套用的變化摘要（`money`、`tickets`、`rep`、`fame`、`stress`、`stamina`、`satisfaction`、`mood`、`salary`、`statAll`、`stat`、`rest`、`job`（指名工作 id）、`leave`、`loan`、`sold`（被賣掉的人：`{ rarity, rosterId, nameSeed, gender }`）、`allStress`、`allSatisfaction`、`allSalaryPct`）
  - 日誌：`event_new { uid, ev, aid }`、`event_resolved`／`event_auto { uid, ev, aid, choice, outcome, fx }`、`loan_paid { amount }`（併入 `month_end` 的 `loan` 欄位）、`left { rarity, rosterId, nameSeed, gender }`（藝人因事件離開）
  - `st.loans[i] = { monthly, months }`；`month_end` 日誌新增 `loan` 欄位
  - 內部：`removeArtist(st, a)`（從在籍、組合、進行中工作移除；`dismiss` 改用它）
  - 條件觸發：罷工 → `strike_talk`；SSR 入社（進入在籍）→ `ssr_debut`；工作結算人氣跨過門檻 → `fame_milestone`（ctx `{ n }`）；負債月數 ≥ 3 且 `company.crisisOn` 為 false → `finance_crisis`（負債清零時重置）

- [ ] **Step 1：讓舊測試維持確定性**

`core_check.js` 在 `var Roster = global.PriTestStarvRoster;` 之後加入：

```js
// 計畫 3 加入隨機重大事件（每天 8%）。計畫 1、2 的測試寫死了人氣、壓力等數值，
// 所以預設關閉隨機事件；事件相關測試用 withEvents() 暫時打開。
var EVENT_CHANCE = D.BAL.eventDailyChance;
D.BAL.eventDailyChance = 0;
function withEvents(fn) { D.BAL.eventDailyChance = EVENT_CHANCE; try { fn(); } finally { D.BAL.eventDailyChance = 0; } }
```

- [ ] **Step 2：寫失敗測試**

```js
test("事件：觸發、選擇、套用效果", function () {
  var st = Core.create({ seed: 1 }), a = freshArtist(st, { fame: 500 });
  var e = Core.triggerEvent(st, "charity", a.id);
  eq(st.events.pending.length, 1); eq(e.deadline, st.day + 3);
  var rep0 = st.company.rep, r = Core.resolveEvent(st, e.uid, 0);
  eq(st.events.pending.length, 0); eq(r.fx.rep, 40); eq(r.fx.fame, 30); eq(a.fame, 530); eq(a.stamina, 90);
  eq(st.company.rep, rep0 + 40);
  eq(Core.resolveEvent(st, e.uid, 0).err, "noEvent");
  var e2 = Core.triggerEvent(st, "charity", a.id); eq(Core.resolveEvent(st, e2.uid, 9).err, "choice");
  assert(st.log.some(function (x) { return x.type === "event_resolved" && x.data.ev === "charity"; }), "日誌");
});

test("事件：逾期自動選預設、最多 3 件", function () {
  var st = Core.create({ seed: 1 }), a = freshArtist(st, { fame: 500 });
  Core.triggerEvent(st, "brand_offer", a.id);
  Core.advance(st, 3);
  eq(st.events.pending.length, 0, "第 3 天逾期");
  var auto = st.log.filter(function (x) { return x.type === "event_auto"; });
  eq(auto.length, 1); eq(auto[0].data.choice, 1, "brand_offer 的預設是婉拒");
  for (var i = 0; i < 4; i++) Core.triggerEvent(st, "insomnia", a.id);
  eq(st.events.pending.length, 3, "最多 3 件");
});

test("事件：離開、違約金、指名工作、全員效果", function () {
  var st = Core.create({ seed: 1 }), a = freshArtist(st, { fame: 500, salary: 2000 }), b = freshArtist(st);
  Core.createGroup(st, "G", [a.id, b.id]);
  var m0 = st.company.money, e = Core.triggerEvent(st, "poach_offer", a.id), r = Core.resolveEvent(st, e.uid, 1);
  assert(r.fx.leave, "離開"); eq(Core.artistById(st, a.id), null); eq(st.company.money, m0 + 12000, "月薪 × 6");
  eq(st.groups.length, 0, "組合剩一人就解散");
  e = Core.triggerEvent(st, "director_call", b.id); r = Core.resolveEvent(st, e.uid, 0);
  var j = st.board.filter(function (x) { return x.id === r.fx.job; })[0];
  assert(j && j.reservedFor === b.id && j.dir === b.dir, "指名工作");
  var c = freshArtist(st, { stress: 0, satisfaction: 50 });
  e = Core.triggerEvent(st, "staff_trip"); Core.resolveEvent(st, e.uid, 0);
  eq(c.satisfaction, 58); eq(b.stress, 0, "壓力不會低於 0");
});

test("事件：財務危機（借款、賣合約）與條件觸發", function () {
  var st = Core.create({ seed: 1 }), a = freshArtist(st, { salary: 3000 }), b = freshArtist(st, { salary: 2000 });
  st.board = []; st.boardRefreshDay = 99999;
  st.company.money = -1e6;
  Core.advance(st, 90);
  var crisis = st.events.pending.filter(function (x) { return x.id === "finance_crisis"; });
  eq(crisis.length, 1, "負債 3 個月觸發一次");
  Core.advance(st, 30);
  eq(st.events.pending.filter(function (x) { return x.id === "finance_crisis"; }).length + st.log.filter(function (x) { return x.data && x.data.ev === "finance_crisis" && x.type === "event_auto"; }).length, 1, "不重複觸發");
  var st2 = Core.create({ seed: 2 }), c = freshArtist(st2, { salary: 3000 });
  st2.board = []; st2.boardRefreshDay = 99999;
  var e = Core.triggerEvent(st2, "finance_crisis"), m0 = st2.company.money;
  Core.resolveEvent(st2, e.uid, 1);
  eq(st2.company.money, m0 + 200000); eq(st2.loans.length, 1);
  var before = st2.company.money; Core.advance(st2, 30);
  eq(before - st2.company.money, 3000 + 1000 + 12000, "月薪 + 營運費 + 還款");
  e = Core.triggerEvent(st2, "finance_crisis"); m0 = st2.company.money;
  Core.resolveEvent(st2, e.uid, 0);
  eq(Core.artistById(st2, c.id), null, "賣掉合約"); eq(st2.company.money, m0 + 3000 * 6);
  var st3 = Core.create({ seed: 3 }), d = freshArtist(st3, { stress: 97 });
  Core.schedule(st3, d.id, { kind: "train" }); Core.advance(st3, 2);
  eq(st3.events.pending[0].id, "strike_talk"); eq(st3.events.pending[0].aid, d.id);
  Core._grantEntry(st3, Roster.byId("ssr001"));
  assert(st3.events.pending.some(function (x) { return x.id === "ssr_debut"; }), "SSR 入社");
});

test("事件：人氣跨過門檻", function () {
  var st = Core.create({ seed: 1 }), a = freshArtist(st, { fame: 995 }), j = soloJob(st);
  D.STATS.forEach(function (s) { a.stats[s] = 300; });
  Core.takeJob(st, j.id, [a.id]); Core.advance(st, 2);
  var e = st.events.pending.filter(function (x) { return x.id === "fame_milestone"; })[0];
  assert(e && e.ctx.n === 1000 && e.aid === a.id, "fame_milestone");
});

test("事件：讀檔丟棄找不到的事件", function () {
  var st = Core.create({ seed: 1 }), a = freshArtist(st);
  Core.triggerEvent(st, "charity", a.id);
  st.events.pending.push({ uid: "e999", id: "removed_event", aid: null, ctx: {}, day: 0, deadline: 3 });
  var m = Core.migrate(JSON.parse(JSON.stringify(st)));
  eq(m.events.pending.length, 1); eq(m.events.pending[0].id, "charity");
});

test("事件：隨機發生頻率、公關部壓低壞結果", function () {
  withEvents(function () {
    var st = Core.create({ seed: 4 }), n = 0;
    freshArtist(st); freshArtist(st, { fame: 500 });
    st.board = []; st.boardRefreshDay = 99999;
    Core.advance(st, 360);
    st.log.forEach(function (x) { if (x.type === "event_new") n++; });
    assert(n >= 15 && n <= 50, "一年 " + n + " 件（預期約 29）");
  });
  function badRate(pr) {
    var st = Core.create({ seed: 9 }), a = freshArtist(st, { fame: 500 }), bad = 0;
    st.facilities.pr = pr;
    for (var i = 0; i < 2000; i++) { var e = Core.triggerEvent(st, "old_post", a.id); if (Core.resolveEvent(st, e.uid, 1).bad) bad++; a.fame = 500; }
    return bad / 2000;
  }
  var r0 = badRate(0), r5 = badRate(5);
  assert(r0 > 0.45 && r0 < 0.55 && r5 > 0.28 && r5 < 0.39, "壞結果比例 pr0=" + r0 + " pr5=" + r5);
});
```

- [ ] **Step 3：執行，確認失敗**

Run: `node tools/starv_check/core_check.js`
Expected: 7 個 FAIL（`Core.triggerEvent is not a function`）

- [ ] **Step 4：實作**

`static_src/starv_data.js` 的 `BAL` 中 `seasonDays: 90, …` 那行之後加入：

```js
    eventDailyChance: 0.08, eventDeadlineDays: 3, eventMax: 3, prBadCut: 0.1, famousFame: 200, rookieDays: 60,
    fameMilestones: [1000, 5000, 20000, 50000], sellContractMonths: 6,
```

`static_src/starv_core.js`：

1. 把整個 `dismiss` 函式換成：

```js
  // 從公司移除（解約、被挖角、賣合約共用）：組合剩一人就解散；在進行中工作裡就退出，工作沒人了就取消
  function removeArtist(st, a) {
    st.artists.splice(st.artists.indexOf(a), 1);
    st.groups.forEach(function (g) { g.members = g.members.filter(function (id) { return id !== a.id; }); });
    st.groups = st.groups.filter(function (g) { return g.members.length >= 2; });
    st.activeJobs.forEach(function (aj) { aj.members = aj.members.filter(function (id) { return id !== a.id; }); });
    st.activeJobs = st.activeJobs.filter(function (aj) { return aj.members.length > 0; });
  }
  function leftInfo(a) { return { rarity: a.rarity, rosterId: a.rosterId, nameSeed: a.nameSeed, gender: a.gender }; }

  function dismiss(st, aid) {
    var a = artistById(st, aid);
    if (!a) return "noArtist";
    if (a.task) return "busy";
    st.company.money -= a.salary * BAL.dismissSalaryMonths;
    removeArtist(st, a);
    log(st, "dismiss", leftInfo(a));
    return null;
  }
```

2. `place` 中

```js
    if (st.artists.length < capacity(st)) { st.artists.push(a); log(st, "join", { aid: a.id, rarity: a.rarity }); }
```

換成：

```js
    if (st.artists.length < capacity(st)) {
      st.artists.push(a);
      log(st, "join", { aid: a.id, rarity: a.rarity });
      if (a.rarity === "SSR") pushEvent(st, "ssr_debut", a.id);
    }
```

3. `postTask` 中 `log(st, "strike", { aid: a.id });` 之後加入 `pushEvent(st, "strike_talk", a.id);`

4. `resolveJob` 中把

```js
      a.fame = clamp(a.fame + Math.round(job.fame * R.fame * fxMult(a, "fame") * (job.trend || 1)), 0, 99999);
```

換成：

```js
      var fame0 = a.fame;
      a.fame = clamp(a.fame + Math.round(job.fame * R.fame * fxMult(a, "fame") * (job.trend || 1)), 0, 99999);
      BAL.fameMilestones.forEach(function (n) { if (fame0 < n && a.fame >= n) pushEvent(st, "fame_milestone", a.id, { n: n }); });
```

5. 把整個 `monthly` 函式換成：

```js
  function monthly(st) {
    var salary = 0, upkeep = BAL.upkeepPerLevel * st.company.level, div = 0, loan = 0;
    st.artists.forEach(function (a) { salary += a.salary; });
    st.dividends.forEach(function (d) { div += Math.round(d.pay * BAL.dividendRate * d.stars / 3); d.months--; });
    st.dividends = st.dividends.filter(function (d) { return d.months > 0; });
    st.loans.forEach(function (l) { loan += l.monthly; l.months--; });
    st.loans = st.loans.filter(function (l) { return l.months > 0; });
    st.company.money += div - salary - upkeep - loan;
    var prMult = 1 - st.facilities.pr * D.FACILITIES.pr.fameDecay;
    st.artists.forEach(function (a) {
      var rate = (inPeak(a) ? BAL.fameDecay : BAL.fameDecayOffPeak) * prMult;
      a.fame = Math.round(a.fame * (1 - rate));
    });
    st.company.debtMonths = st.company.money < 0 ? st.company.debtMonths + 1 : 0;
    if (!st.company.debtMonths) st.company.crisisOn = false;
    if (st.company.debtMonths >= BAL.debtCrisisMonths && !st.company.crisisOn) {
      st.company.crisisOn = true;
      pushEvent(st, "finance_crisis");
    }
    rotatePickup(st);
    log(st, "month_end", { salary: salary, upkeep: upkeep, dividends: div, loan: loan });
  }
```

6. 插在 `  // ==== exports ====` 之前：

```js
  // ==== 重大事件（§7） ====
  var MUSIC_DIRS = ["singer", "band", "composer", "idol", "voice"];
  var DANCE_DIRS = ["dancer", "idol", "stage", "model"];
  var STREAM_DIRS = ["vtuber", "influencer"];
  var EVENT_FILTERS = {
    any: function () { return true; },
    famous: function (st, a) { return a.fame >= BAL.famousFame; },
    rookie: function (st, a) { return st.day - a.joinedDay <= BAL.rookieDays; },
    music: function (st, a) { return MUSIC_DIRS.indexOf(a.dir) >= 0; },
    dance: function (st, a) { return DANCE_DIRS.indexOf(a.dir) >= 0; },
    stream: function (st, a) { return STREAM_DIRS.indexOf(a.dir) >= 0; },
    stressed: function (st, a) { return a.stress >= 60; },
    unhappy: function (st, a) { return a.satisfaction < 50; },
    lowmood: function (st, a) { return a.mood <= 0; },
    idle: function (st, a) { return !a.task; }
  };

  function pushEvent(st, id, aid, ctx) {
    if (!D.EVENT_BY_ID || !D.EVENT_BY_ID[id]) return null;
    var e = { uid: newId(st, "e"), id: id, aid: aid || null, ctx: ctx || {}, day: st.day, deadline: st.day + BAL.eventDeadlineDays };
    st.events.pending.push(e);
    log(st, "event_new", { uid: e.uid, ev: id, aid: e.aid });
    while (st.events.pending.length > BAL.eventMax) autoResolve(st, st.events.pending[0]);
    return e;
  }

  // 依目標篩選鍵分組：每個篩選鍵只對藝人算一次，事件數量變多（上千種）時成本主要看篩選鍵種類
  function triggerRandomEvent(st) {
    var Events = root.PriTestStarvEvents;
    if (!Events) return null;
    var pool = {}, targets = {};
    Events.targets().forEach(function (key) {
      var list = null;
      if (key !== "none") {
        var f = EVENT_FILTERS[key];
        list = f ? st.artists.filter(function (a) { return f(st, a); }) : [];
        if (!list.length) return;
      }
      Events.byTarget(key).forEach(function (ev) { pool[ev.id] = ev.weight; targets[ev.id] = list; });
    });
    if (!Object.keys(pool).length) return null;
    var id = wpick(st, pool);
    return pushEvent(st, id, targets[id] ? pick(st, targets[id]).id : null);
  }

  function bumpStat(a, s, v) { a.stats[s] = clamp(Math.round((a.stats[s] + v) * 10) / 10, 0, a.caps[s]); }

  // 指名工作的等級：比藝人目前人氣夠格的最高等級再高一級，但不超過公司已解鎖的等級
  function tierUp(st, a) {
    var idx = 0, maxIdx = 0;
    D.TIER_ORDER.forEach(function (t, i) {
      if (D.TIERS[t].minFame <= a.fame) idx = i;
      if (D.TIERS[t].unlock <= st.company.level) maxIdx = i;
    });
    return D.TIER_ORDER[Math.min(idx + 1, maxIdx)];
  }

  function applyFx(st, e, fx) {
    var a = e.aid ? artistById(st, e.aid) : null, out = {};
    function add(k, v) { if (v) out[k] = (out[k] || 0) + v; }
    function bump(obj, k, v, lo, hi) { var v0 = obj[k]; obj[k] = clamp(obj[k] + v, lo, hi); return obj[k] - v0; }
    if (fx.money) { st.company.money += fx.money; add("money", fx.money); }
    if (fx.tickets) { st.company.tickets += fx.tickets; add("tickets", fx.tickets); }
    if (fx.rep) {
      if (fx.rep > 0) addRep(st, fx.rep); else st.company.rep = Math.max(0, st.company.rep + fx.rep);
      add("rep", fx.rep);
    }
    if (fx.loan) {
      st.company.money += fx.loan.amount;
      st.loans.push({ monthly: fx.loan.monthly, months: fx.loan.months });
      add("money", fx.loan.amount);
      out.loan = { monthly: fx.loan.monthly, months: fx.loan.months };
    }
    if (a) {
      if (fx.moneyBySalary) { var m = a.salary * fx.moneyBySalary; st.company.money += m; add("money", m); }
      var df = (fx.fame || 0) + Math.round(a.fame * (fx.famePct || 0));
      if (df) add("fame", bump(a, "fame", df, 0, 99999));
      ["stress", "stamina", "satisfaction"].forEach(function (k) { if (fx[k]) add(k, bump(a, k, fx[k], 0, 100)); });
      if (fx.mood) add("mood", bump(a, "mood", fx.mood, -2, 2));
      if (fx.salaryPct) { var s0 = a.salary; a.salary = Math.round(a.salary * (1 + fx.salaryPct) / 100) * 100; add("salary", a.salary - s0); }
      if (fx.statAll) { D.STATS.forEach(function (s) { bumpStat(a, s, fx.statAll); }); out.statAll = fx.statAll; }
      if (fx.stat) { Object.keys(fx.stat).forEach(function (s) { bumpStat(a, s, fx.stat[s]); }); out.stat = fx.stat; }
      if (fx.rest && !a.task) { a.task = { kind: "rest", days: fx.rest, left: fx.rest, stamina: 0, stress: 0, forced: true }; out.rest = fx.rest; }
      if (fx.specialJob) { var j = genJob(st, { dir: a.dir, tier: tierUp(st, a), reservedFor: a.id }); st.board.push(j); out.job = j.id; }
      if (fx.leave) { removeArtist(st, a); out.leave = true; log(st, "left", leftInfo(a)); }
    }
    ["allStress", "allSatisfaction"].forEach(function (k) {
      if (!fx[k]) return;
      var key = k === "allStress" ? "stress" : "satisfaction";
      st.artists.forEach(function (x) { bump(x, key, fx[k], 0, 100); });
      out[k] = fx[k];
    });
    if (fx.allSalaryPct) {
      st.artists.forEach(function (x) { x.salary = Math.max(100, Math.round(x.salary * (1 + fx.allSalaryPct) / 100) * 100); });
      out.allSalaryPct = fx.allSalaryPct;
    }
    if (fx.sellTop) {
      var top = null;
      st.artists.forEach(function (x) { if (!x.task && (!top || x.salary > top.salary)) top = x; });
      if (top) {
        var gain = top.salary * BAL.sellContractMonths;
        st.company.money += gain; add("money", gain);
        removeArtist(st, top);
        out.sold = leftInfo(top);
        log(st, "left", leftInfo(top));
      }
    }
    return out;
  }

  function resolveEvent(st, uid, idx, auto) {
    var i, e = null;
    for (i = 0; i < st.events.pending.length; i++) if (st.events.pending[i].uid === uid) e = st.events.pending[i];
    if (!e) return { err: "noEvent" };
    var ev = D.EVENT_BY_ID[e.id], ch = ev.choices[idx];
    if (!ch) return { err: "choice" };
    st.events.pending.splice(st.events.pending.indexOf(e), 1);
    var w = {};
    ch.outcomes.forEach(function (o, k) { w[k] = o.w * (o.bad ? 1 - st.facilities.pr * BAL.prBadCut : 1); });
    var k = Number(wpick(st, w)), o = ch.outcomes[k];
    var fx = applyFx(st, e, o.fx);
    log(st, auto ? "event_auto" : "event_resolved", { uid: uid, ev: e.id, aid: e.aid, choice: idx, outcome: k, fx: fx });
    return { outcome: k, fx: fx, bad: o.bad };
  }
  function autoResolve(st, e) { resolveEvent(st, e.uid, D.EVENT_BY_ID[e.id].defaultChoice, true); }

  function tickEvents(st) {
    st.events.pending.filter(function (e) { return e.deadline <= st.day; }).forEach(function (e) { autoResolve(st, e); });
    if (st.artists.length && rnd(st) < BAL.eventDailyChance) triggerRandomEvent(st);
  }
```

7. `advanceDay` 中 `autoPlan(st);` 之前加入 `tickEvents(st);`

7b. `migrate` 中 `if (!st.trend) initTrend(st);` 那一行之後加入：

```js
    // 事件資料被移除或改名時，存檔裡待處理的舊事件直接丟掉（不讓存檔壞掉）
    st.events.pending = st.events.pending.filter(function (e) { return !!(D.EVENT_BY_ID && D.EVENT_BY_ID[e.id]); });
```

8. exports 區塊加入：

```js
  api.triggerEvent = pushEvent;
  api.triggerRandomEvent = triggerRandomEvent;
  api.resolveEvent = function (st, uid, idx) { return resolveEvent(st, uid, idx, false); };
```

- [ ] **Step 5：執行，確認通過**

Run: `node tools/starv_check/core_check.js`
Expected: `全部 67 個通過`

註：「財務危機」測試中藝人月薪 3000＋2000、資金 −100 萬，連續 3 個月負債後第 90 天觸發；之後 30 天內 3 天期限到了會自動處理（預設是全員減薪），且 `crisisOn` 保持 true，所以只會有一件。「隨機發生頻率」：每天 8% × 360 天 ≈ 29 件，有 3 天期限的自動處理不影響觸發。「公關部」：old_post 的選項 1 好壞權重 5:5，公關部 Lv5 時壞結果權重 ×0.5 → 2.5 /（5 + 2.5）≈ 33%。

- [ ] **Step 6：commit**

```bash
node --check static_src/starv_core.js && node --check static_src/starv_data.js
git add static_src/starv_core.js static_src/starv_data.js tools/starv_check/core_check.js
git commit -m "feat(starv): 重大事件引擎、借款與財務危機、條件觸發事件"
```

---

### Task 5：平衡模擬：購買設施、檢查後期資金

**Files:**
- Modify: `tools/starv_check/sim.js`（必要時 `static_src/starv_data.js`、規格文件）

**Interfaces:**
- Consumes: `Core.upgradeFacility`、`facilityCost`、`facilityCap`、`D.FACILITY_ORDER`
- Produces: sim 的 auto／active 情境每月先買設施再抽卡；新增 WARN：「積極經營 30 年資金 > 2,000 萬（後期資金過剩）」、「自動方針 10 年內宿舍不到 Lv5」

- [ ] **Step 1：修改 sim.js**

在 `runScenario` 的 `if (name !== "idle" && day % 30 === 1) {` 區塊最前面（`while (st.company.money > 150000 …` 之前）加入：

```js
      buyFacilities(st);
```

在 `runScenario` 函式之前加入：

```js
// 每月先升級設施：宿舍優先（資金 ≥ 費用 × 1.5 + 5 萬），其他設施在資金 ≥ 費用 × 3 時升級
function buyFacilities(st) {
  var cost;
  while ((cost = Core.facilityCost(st, "dorm")) !== null && st.facilities.dorm < Core.facilityCap(st, "dorm") &&
    st.company.money >= cost * 1.5 + 50000) Core.upgradeFacility(st, "dorm");
  D.FACILITY_ORDER.forEach(function (f) {
    if (f === "dorm") return;
    while ((cost = Core.facilityCost(st, f)) !== null && st.facilities[f] < Core.facilityCap(st, f) && st.company.money >= cost * 3) {
      if (Core.upgradeFacility(st, f)) break;
    }
  });
}
```

在 `rows.push({ … })` 的物件中加入 `dorm: st.facilities.dorm,`；在平衡期望（`if (idle.st.company.level > 3) …`）之後加入：

```js
if (YEARS >= 30 && active.st.company.money > 20000000) warn("積極經營 30 年資金 " + active.st.company.money + "（後期資金過剩，預期 ≤ 2,000 萬）");
if (auto.rows.length > 2 && auto.rows[2].dorm < 5) warn("自動方針 10 年宿舍只到 Lv" + auto.rows[2].dorm + "（預期 ≥ 5）");
```

- [ ] **Step 2：執行模擬**

Run: `node tools/starv_check/sim.js 30`
Expected: 最後一行 `不變量全部通過`。記下三個情境的表格與 WARN。

- [ ] **Step 3：依 WARN 調整**

只改 `static_src/starv_data.js` 的數值，每次調整後重跑 `node tools/starv_check/sim.js 30` 與 `node tools/starv_check/core_check.js`：
- 「後期資金過剩」：依序嘗試 ① 提高 `FACILITIES.*.base`（最多 ×2）② 提高 `BAL.upkeepPerLevel`（最多 3000）③ 降低 `TIERS.A.pay`／`TIERS.S.pay`（最多 −30%）。每次只改一項
- 「宿舍升級太慢」：降低 `FACILITIES.dorm.base` 或 `growth`
- 若 `core_check.js` 有測試寫死被調整的數值（例如宿舍費用 30000、營運費 1000），一併更新期望值並註解「依 sim 平衡調整（計畫 3）」
- 調整到的數值若是規格明寫的（§5.2 營運費、§6.2 難度與酬勞），同步修改 `docs/superpowers/specs/2026-10-27-starv-design.md` 對應段落，並在該段落註明調整日期與原因

把最後採用的數值與三個情境的 30 年結果，寫進 commit message。

- [ ] **Step 4：commit**

```bash
git add tools/starv_check/sim.js static_src/starv_data.js tools/starv_check/core_check.js docs/superpowers/specs/2026-10-27-starv-design.md
git commit -m "test(starv): 模擬加入設施購買與後期資金檢查（附調整後數值）"
```

---

### Task 6：事件卡、頂部鈴鐺、日誌文字

**Files:**
- Create: `static_src/starv_events_ui.js`
- Modify: `static_src/starv_ui.js`、`static_src/starv.js`、`static_src/starv_log.js`、`site_src/starv_page.py`、`site_src/i18n_starv.py`、`static_src/css/starv.css`、`tools/starv_check/ui_check.js`

**Interfaces:**
- Consumes: `Core.resolveEvent`、`D.EVENT_BY_ID`
- Produces:
  - `UI.modalIsOpen() → bool`、`UI.addTopItem(fn(App) → Node|null)`、`UI.topItems()`
  - `PriTestStarvEventsUI.open(App, uid)`、`.fxLines(st, fx) → [string]`
  - 頂部鈴鐺 `data-act="event-bell"`（有待處理事件時才出現，顯示件數）
  - 事件彈窗 class `sv-event`；選項 `data-act="event-choice-<i>"`，預設選項另有 `data-default`；結果畫面的關閉鈕 `data-act="event-result-close"`
  - 新事件在沒有其他彈窗時自動彈出（每件只自動彈一次）

- [ ] **Step 1：在 `ui_check.js` 追加步驟與輔助函式**

在 `function shot(…)` 之後加入：

```js
// 處理掉畫面上所有待處理的事件（一律選預設選項），避免事件卡擋住後面的步驟
async function clearEvents(page) {
  for (var i = 0; i < 6; i++) {
    var pending = await page.evaluate(function () { var s = window.PriTestStarv.state(); return s && s.events ? s.events.pending.length : 0; });
    if (!pending) return;
    if (!(await page.$(".sv-event"))) await act(page, "event-bell");
    await page.dispatchEvent(".sv-event [data-default]", "click");
    await act(page, "event-result-close");
  }
}
// 隨機事件會讓流程不穩定：測試時關掉每日隨機事件（條件事件照常），重新整理後要再設一次
async function quietEvents(page) {
  await page.evaluate(function () { if (window.PriTestStarvData) window.PriTestStarvData.BAL.eventDailyChance = 0; });
}
```

在 `main()` 的 `await page.reload();` 之後加入 `await quietEvents(page);`；在 for 迴圈中 `try {` 之後、`await steps[i][1](page);` 之前加入 `await clearEvents(page);`。

在「重新整理後從存檔繼續」步驟的 `await page.waitForSelector(".sv-top");` 之後加入 `await quietEvents(page);`。

追加步驟：

```js
step("事件：觸發 → 鈴鐺 → 選擇 → 結果", async function (page) {
  await page.evaluate(function () {
    var App = window.PriTestStarv.app;
    App.act(function (s) { window.PriTestStarvCore.triggerEvent(s, "charity", s.artists[0].id); });
  });
  await page.waitForSelector(".sv-event");
  await noRawKeys(page, "事件卡");
  await act(page, "modal-close");
  await act(page, "event-bell");
  await page.waitForSelector(".sv-event");
  var rep0 = (await st(page)).company.rep;
  await act(page, "event-choice-0");
  await page.waitForSelector('[data-act="event-result-close"]');
  await noRawKeys(page, "事件結果");
  await act(page, "event-result-close");
  var s = await st(page);
  assert.strictEqual(s.events.pending.length, 0);
  assert.ok(s.company.rep >= rep0 + 40, "聲望 +40");
});
```

- [ ] **Step 2：執行，確認失敗**

Run: `py -3 generate.py && node tools/starv_check/ui_check.js`
Expected: `FAIL 事件：觸發 → 鈴鐺 → 選擇 → 結果：…`

- [ ] **Step 3：追加字串**

```python
    # ---- 重大事件 ----
    ("sv_ev_bell", "🔔 {n}", "🔔 {n}"),
    ("sv_ev_deadline", "{n} 天內要決定（逾期自動選「{def}」）", "{n} 日以内に決める（期限切れは「{def}」）"),
    ("sv_ev_result", "結果", "結果"),
    ("sv_ev_result_bad", "事情不太順利…", "うまくいかなかった…"),
    ("sv_ev_result_good", "處理完成", "対応完了"),
    ("sv_ev_nothing", "沒有特別的變化", "特に変化なし"),
    ("sv_ev_company", "公司事務", "事務所の案件"),
    ("sv_evcat_scandal", "醜聞", "スキャンダル"),
    ("sv_evcat_chance", "機會", "チャンス"),
    ("sv_evcat_poach", "挖角", "引き抜き"),
    ("sv_evcat_net", "網路", "ネット"),
    ("sv_evcat_health", "健康", "健康"),
    ("sv_evcat_company", "公司", "事務所"),
    ("sv_evcat_special", "特別", "特別"),
    ("sv_fx_money", "資金 {v}", "資金 {v}"),
    ("sv_fx_tickets", "星探券 {v}", "スカウト券 {v}"),
    ("sv_fx_rep", "聲望 {v}", "評判 {v}"),
    ("sv_fx_fame", "人氣 {v}", "人気 {v}"),
    ("sv_fx_stress", "壓力 {v}", "ストレス {v}"),
    ("sv_fx_stamina", "體力 {v}", "体力 {v}"),
    ("sv_fx_satisfaction", "滿意度 {v}", "満足度 {v}"),
    ("sv_fx_mood", "心情 {v}", "気分 {v}"),
    ("sv_fx_salary", "月薪 {v}", "月給 {v}"),
    ("sv_fx_statAll", "全能力 {v}", "全能力 {v}"),
    ("sv_fx_stat", "{stat} {v}", "{stat} {v}"),
    ("sv_fx_rest", "休息 {n} 天", "{n} 日休養"),
    ("sv_fx_job", "看板上出現了指名工作", "ボードに指名の仕事が出た"),
    ("sv_fx_leave", "{name} 離開了公司", "{name} が事務所を去った"),
    ("sv_fx_sold", "賣掉了 {name} 的合約", "{name} の契約を売った"),
    ("sv_fx_loan", "借款：之後每月還 {m}，共 {n} 個月", "借入：以後毎月 {m} を {n} か月返済"),
    ("sv_fx_allStress", "全員壓力 {v}", "全員のストレス {v}"),
    ("sv_fx_allSatisfaction", "全員滿意度 {v}", "全員の満足度 {v}"),
    ("sv_fx_allSalaryPct", "全員月薪 {v}%", "全員の月給 {v}%"),
    ("sv_log_event_new", "新事件：「{title}」", "新しいイベント：「{title}」"),
    ("sv_log_event_resolved", "「{title}」→ {choice}", "「{title}」→ {choice}"),
    ("sv_log_event_auto", "「{title}」逾期，自動選擇「{choice}」", "「{title}」期限切れ、自動で「{choice}」"),
    ("sv_log_left", "{name} 離開了公司", "{name} が事務所を去った"),
```

- [ ] **Step 4：`starv_ui.js` 加上彈窗狀態與頂部項目登記**

`starv_ui.js` 的 `var reportHandler = null;` 之後加入 `var topItems = [];`；
`window.PriTestStarvUI = { … }` 物件中 `showReport: …` 那一行之後加入：

```js
    , modalIsOpen: function () { return !!open; },
    addTopItem: function (fn) { topItems.push(fn); },
    topItems: function () { return topItems.slice(); }
```

（注意：`showReport` 那行原本是物件的最後一個屬性、沒有結尾逗號，所以新屬性以逗號開頭。）

- [ ] **Step 5：`starv.js` 頂部列放入登記的項目**

把 `topBar()` 中

```js
        el("span", { class: "sv-chip sv-chip-ticket", text: t("sv_tickets", { n: c.tickets }) })
      ]),
```

換成：

```js
        el("span", { class: "sv-chip sv-chip-ticket", text: t("sv_tickets", { n: c.tickets }) })
      ].concat(UI.topItems().map(function (fn) { return fn(App); }))),
```

- [ ] **Step 6：建立 `static_src/starv_events_ui.js`**

```js
// 明星經紀 starV：重大事件的畫面（事件卡、頂部鈴鐺、新事件自動彈出、效果摘要；規格 §7）。
// 選項只顯示傾向（hint），選完才顯示實際變化。新事件只在沒有其他彈窗時自動彈出一次；
// 關掉沒選的事件留在鈴鐺裡，期限到了由 Core 自動套用預設選項。
(function () {
  "use strict";

  var D = window.PriTestStarvData;
  var Core = window.PriTestStarvCore;
  var UI = window.PriTestStarvUI;
  var t = UI.t, el = UI.el;
  var shown = {};

  function signed(v, fmt) { return (v >= 0 ? "+" : "−") + (fmt ? fmt(Math.abs(v)) : Math.abs(v)); }
  function leftName(info) { return Core.artistName({ rosterId: info.rosterId || null, nameSeed: info.nameSeed || 0, gender: info.gender || "f" }, UI.lang()); }

  function fxLines(st, fx, ev) {
    var out = [];
    if (fx.money) out.push(t("sv_fx_money", { v: signed(fx.money, UI.money) }));
    if (fx.tickets) out.push(t("sv_fx_tickets", { v: signed(fx.tickets) }));
    if (fx.rep) out.push(t("sv_fx_rep", { v: signed(fx.rep, UI.num) }));
    ["fame", "stress", "stamina", "satisfaction", "mood"].forEach(function (k) {
      if (fx[k]) out.push(t("sv_fx_" + k, { v: signed(fx[k], UI.num) }));
    });
    if (fx.salary) out.push(t("sv_fx_salary", { v: signed(fx.salary, UI.money) }));
    if (fx.statAll) out.push(t("sv_fx_statAll", { v: signed(fx.statAll) }));
    if (fx.stat) Object.keys(fx.stat).forEach(function (s) { out.push(t("sv_fx_stat", { stat: UI.statName(s), v: signed(fx.stat[s]) })); });
    if (fx.rest) out.push(t("sv_fx_rest", { n: fx.rest }));
    if (fx.job) out.push(t("sv_fx_job"));
    if (fx.leave && ev) out.push(t("sv_fx_leave", { name: ev.name }));
    if (fx.sold) out.push(t("sv_fx_sold", { name: leftName(fx.sold) }));
    if (fx.loan) out.push(t("sv_fx_loan", { m: UI.money(fx.loan.monthly), n: fx.loan.months }));
    if (fx.allStress) out.push(t("sv_fx_allStress", { v: signed(fx.allStress) }));
    if (fx.allSatisfaction) out.push(t("sv_fx_allSatisfaction", { v: signed(fx.allSatisfaction) }));
    if (fx.allSalaryPct) out.push(t("sv_fx_allSalaryPct", { v: signed(Math.round(fx.allSalaryPct * 100)) }));
    return out;
  }

  function fill(text, vars) {
    return text.replace(/\{name\}/g, vars.name).replace(/\{n\}/g, vars.n == null ? "" : UI.num(vars.n));
  }

  function open(App, uid) {
    shown[uid] = true;
    var result = null, name = "";
    UI.openModal(function (box, close) {
      var st = App.st(), e = null;
      st.events.pending.forEach(function (x) { if (x.uid === uid) e = x; });
      if (!e && !result) { close(); return; }
      var ev = D.EVENT_BY_ID[(e || result).id];
      var a = e && e.aid ? Core.artistById(st, e.aid) : null;
      if (a) name = UI.name(a);
      box.appendChild(UI.modalHead(UI.L(ev.title), close));
      box.appendChild(el("div", { class: "sv-ev-meta" }, [
        el("span", { class: "sv-chip sv-evcat-" + ev.category, text: t("sv_evcat_" + ev.category) }),
        a ? UI.avatar(a, 40) : null,
        el("b", { text: a ? name : (ev.target === "none" ? t("sv_ev_company") : name) })
      ]));
      box.appendChild(el("p", { class: "sv-ev-text", text: fill(UI.L(ev.text), { name: name, n: (e || result).ctx.n }) }));
      if (result) {
        var lines = fxLines(st, result.fx, { name: name });
        box.appendChild(el("div", { class: "sv-ev-result" + (result.bad ? " sv-ev-bad" : "") }, [
          el("h3", { text: t(result.bad ? "sv_ev_result_bad" : "sv_ev_result_good") }),
          el("div", { class: "sv-small sv-muted", text: UI.L(ev.choices[result.choice].label) }),
          lines.length ? el("ul", {}, lines.map(function (l) { return el("li", { text: l }); })) : el("p", { class: "sv-muted", text: t("sv_ev_nothing") })
        ]));
        box.appendChild(el("div", { class: "sv-row sv-row-end" }, [UI.btn(t("sv_close"), close, "sv-btn-primary", { "data-act": "event-result-close" })]));
        return;
      }
      box.appendChild(el("p", { class: "sv-small sv-warn", text: t("sv_ev_deadline", { n: Math.max(0, e.deadline - st.day), def: UI.L(ev.choices[ev.defaultChoice].label) }) }));
      box.appendChild(el("div", { class: "sv-ev-choices" }, ev.choices.map(function (c, i) {
        return el("button", {
          type: "button", class: "sv-ev-choice", "data-act": "event-choice-" + i, "data-default": i === ev.defaultChoice ? "1" : null,
          onclick: function () {
            var r = App.act(function (s) { return Core.resolveEvent(s, uid, i); });
            if (r.err) { UI.toast(t("sv_err_" + r.err), "bad"); close(); return; }
            result = { id: ev.id, ctx: e.ctx, choice: i, fx: r.fx, bad: r.bad };
            UI.refreshModal();
          }
        }, [el("b", { text: UI.L(c.label) }), el("span", { class: "sv-small sv-muted", text: UI.L(c.hint) })]);
      })));
    }, { live: true, cls: "sv-event" });
  }

  // 頂部鈴鐺：有待處理事件才出現，點了打開最早的一件
  UI.addTopItem(function (App) {
    var st = App.st(), list = st.events ? st.events.pending : [];
    if (!list.length) return null;
    return el("button", { type: "button", class: "sv-chip sv-bell", "data-act": "event-bell", text: t("sv_ev_bell", { n: list.length }),
      onclick: function () { open(App, list[0].uid); } });
  });

  // 每次重畫時檢查：有還沒彈過的新事件、而且畫面上沒有其他彈窗 → 自動彈出
  UI.addExtra(function (App) {
    var st = App.st();
    if (!st.events || UI.modalIsOpen()) return null;
    var e = st.events.pending.filter(function (x) { return !shown[x.uid]; })[0];
    if (e) setTimeout(function () { if (!UI.modalIsOpen()) open(App, e.uid); }, 0);
    return null;
  });

  window.PriTestStarvEventsUI = { open: open, fxLines: fxLines };
})();
```

- [ ] **Step 7：`starv_log.js` 加上新日誌類型**

在 `else if (e.type === "birthday_year") p.year = d.year;` 之後加入：

```js
    else if (e.type === "event_new" || e.type === "event_resolved" || e.type === "event_auto") {
      var ev2 = D.EVENT_BY_ID && D.EVENT_BY_ID[d.ev];
      p.title = ev2 ? UI.L(ev2.title) : String(d.ev);
      p.choice = ev2 && d.choice != null ? UI.L(ev2.choices[d.choice].label) : "";
    }
```

並把 `p.salary = UI.money(d.salary); p.upkeep = UI.money(d.upkeep); p.div = UI.money(d.dividends);` 那行之後的 `month_end` 處理改為同時帶上還款：在同一個 `else if (e.type === "month_end")` 區塊內加上 `p.loan = UI.money(d.loan || 0);`，並把字串 `sv_log_month_end` 改為（`i18n_starv.py` 中原有那一行）：

```python
    ("sv_log_month_end", "月結：月薪 {salary}・營運費 {upkeep}・還款 {loan}・分紅 {div}", "月末：月給 {salary}・運営費 {upkeep}・返済 {loan}・印税 {div}"),
```

- [ ] **Step 8：登記腳本並追加樣式**

`STARV_SCRIPTS`：在 `"starv_log.js",` 之前加 `"starv_events_ui.js",`

附加到 `starv.css`：

```css
/* ---- 重大事件 ---- */
.sv-bell { cursor: pointer; font: inherit; color: var(--sv-text); border-color: var(--sv-pink); background: rgba(255, 95, 168, 0.2); animation: sv-bell 1.6s ease-in-out infinite; }
@keyframes sv-bell { 50% { box-shadow: 0 0 14px rgba(255, 95, 168, 0.7); } }
.sv-event { border-color: rgba(255, 95, 168, 0.5); }
.sv-ev-meta { display: flex; align-items: center; gap: 0.5rem; }
.sv-ev-text { line-height: 1.75; font-size: 1.02em; }
.sv-ev-choices { display: grid; gap: 0.5rem; margin-top: 0.6rem; }
.sv-ev-choice {
  font: inherit;
  color: var(--sv-text);
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.15rem;
  padding: 0.65rem 0.9rem;
  text-align: left;
  border-radius: 12px;
  background: var(--sv-glass-strong);
  border: 1px solid var(--sv-line);
  cursor: pointer;
}
.sv-ev-choice:hover { border-color: var(--sv-gold); box-shadow: 0 0 14px rgba(255, 214, 107, 0.25); }
.sv-ev-result { margin-top: 0.6rem; padding: 0.7rem 0.9rem; border-radius: 12px; background: rgba(105, 240, 174, 0.1); border: 1px solid rgba(105, 240, 174, 0.45); }
.sv-ev-result.sv-ev-bad { background: rgba(255, 107, 129, 0.1); border-color: rgba(255, 107, 129, 0.5); }
.sv-ev-result h3 { margin: 0 0 0.2rem; }
.sv-ev-result ul { margin: 0.4rem 0 0; padding-left: 1.2rem; line-height: 1.7; }
.sv-evcat-scandal { border-color: var(--sv-bad); }
.sv-evcat-chance { border-color: var(--sv-gold); }
.sv-evcat-poach { border-color: var(--sv-purple); }
.sv-evcat-net { border-color: var(--sv-cyan); }
.sv-evcat-health { border-color: var(--sv-good); }
.sv-evcat-special { border-color: var(--sv-pink); }
```

- [ ] **Step 9：建置並執行**

```bash
py -3 generate.py && py -3 tools/split_css.py --check
node --check static_src/starv_events_ui.js && node --check static_src/starv_ui.js && node --check static_src/starv.js && node --check static_src/starv_log.js
node tools/starv_check/ui_check.js
```

Expected: `全部 12 個步驟通過`

- [ ] **Step 10：commit**

```bash
git add static_src/starv_events_ui.js static_src/starv_ui.js static_src/starv.js static_src/starv_log.js site_src/starv_page.py site_src/i18n_starv.py static_src/css/starv.css tools/starv_check/ui_check.js
git commit -m "feat(starv): 重大事件卡、頂部鈴鐺、新事件自動彈出"
```

---

### Task 7：設施卡、業界分頁、debug 觸發事件

**Files:**
- Create: `static_src/starv_view_industry.js`
- Modify: `static_src/starv_view_company.js`、`static_src/starv_log.js`、`site_src/starv_page.py`、`site_src/i18n_starv.py`、`static_src/css/starv.css`、`tools/starv_check/ui_check.js`

**Interfaces:**
- Consumes: `Core.upgradeFacility`、`facilityCost`、`facilityCap`、`trendMult`、`seasonOf`、`triggerRandomEvent`；`D.FACILITY_ORDER`、`D.SPECIAL_TREND_BY_ID`
- Produces:
  - 公司分頁設施卡：每個設施一列，升級鈕 `data-act="fac-up-<id>"`
  - debug：`data-act="debug-event"`（觸發一件隨機事件）
  - 業界分頁 `{ id: "industry", order: 40 }`：本季熱門 `.sv-trend-hot`、低迷 `.sv-trend-cold`、特殊潮流 `.sv-trend-special`、下季傳聞 `.sv-trend-rumor`
  - 日誌 `facility_up`、`trend_new` 的文字

- [ ] **Step 1：在 `ui_check.js` 追加步驟**

```js
step("公司：升級宿舍", async function (page) {
  await tab(page, "company");
  await act(page, "debug-money");
  await act(page, "fac-up-dorm");
  var s = await st(page);
  assert.strictEqual(s.facilities.dorm, 2);
  await noRawKeys(page, "設施");
});

step("業界：本季趨勢與傳聞", async function (page) {
  await tab(page, "industry");
  await noRawKeys(page, "業界分頁");
  var n = await page.$$eval(".sv-trend-hot", function (x) { return x.length; });
  assert.ok(n >= 2, "熱門方向 " + n);
  assert.ok(await page.$(".sv-trend-cold"), "低迷方向");
  assert.ok(await page.$(".sv-trend-rumor"), "下季傳聞");
});
```

並把「三種語言…」步驟中的 `var tabs = ["artists", "jobs", "gacha", "company"];` 改成 `var tabs = ["artists", "jobs", "industry", "gacha", "company"];`。

- [ ] **Step 2：執行，確認失敗**

Run: `py -3 generate.py && node tools/starv_check/ui_check.js`
Expected: `FAIL 公司：升級宿舍：…`

- [ ] **Step 3：追加字串**

```python
    # ---- 設施與業界 ----
    ("sv_fac_title", "設施", "設備"),
    ("sv_fac_lv", "Lv{lv} / {cap}", "Lv{lv} / {cap}"),
    ("sv_fac_up", "升級（{cost}）", "強化（{cost}）"),
    ("sv_fac_max", "已達最高等級", "最大レベル"),
    ("sv_fac_need_level", "公司升級後才能再升", "事務所レベルを上げると強化可能"),
    ("sv_fac_dorm_cap", "目前上限 {n} 人", "現在の上限 {n} 人"),
    ("sv_err_max", "已達最高等級", "最大レベルです"),
    ("sv_err_level", "需要更高的公司等級", "事務所レベルが足りません"),
    ("sv_err_noFacility", "找不到這個設施", "設備が見つかりません"),
    ("sv_err_noEvent", "這件事已經處理過了", "このイベントは処理済みです"),
    ("sv_err_choice", "選項無效", "無効な選択です"),
    ("sv_err_reserved", "這是指名其他藝人的工作", "他のタレントへの指名の仕事です"),
    ("sv_debug_event", "觸發隨機事件", "ランダムイベント発生"),
    ("sv_tab_industry", "業界", "業界"),
    ("sv_season", "第 {y} 年・第 {s} 季", "{y}年目・第 {s} 四半期"),
    ("sv_trend_title", "本季業界趨勢", "今期の業界トレンド"),
    ("sv_trend_hot", "熱門（工作量、酬勞、人氣 ×1.5）", "好調（仕事量・ギャラ・人気 ×1.5）"),
    ("sv_trend_cold", "低迷（×0.7）", "低迷（×0.7）"),
    ("sv_trend_special", "特殊潮流", "特別なブーム"),
    ("sv_trend_rumor_title", "業界傳聞", "業界のうわさ"),
    ("sv_trend_rumor", "聽說下一季 {dirs} 會升溫…", "来期は {dirs} が盛り上がるらしい…"),
    ("sv_trend_rumor_special", "還有人在傳「{name}」要來了。", "「{name}」が来るといううわさも。"),
    ("sv_trend_ends", "{n} 天後換季", "{n} 日後に次の四半期"),
    ("sv_log_facility_up", "{fac} 升到 Lv{lv}", "{fac} が Lv{lv} に"),
    ("sv_log_trend_new", "新的一季開始了，看看業界趨勢吧", "新しい四半期が始まった。業界トレンドをチェックしよう"),
```

- [ ] **Step 4：公司分頁加上設施卡與 debug 鈕**

`static_src/starv_view_company.js`：

1. 在 `function saveCard(st, App) {` 之前加入：

```js
  function facilitiesCard(st, App) {
    var D = window.PriTestStarvData;
    return el("div", { class: "sv-card" }, [el("h3", { text: t("sv_fac_title") })].concat(D.FACILITY_ORDER.map(function (f) {
      var F = D.FACILITIES[f], lv = st.facilities[f], cap = Core.facilityCap(st, f), cost = Core.facilityCost(st, f);
      var action;
      if (cost === null) action = el("span", { class: "sv-small sv-muted", text: t("sv_fac_max") });
      else if (lv >= cap) action = el("span", { class: "sv-small sv-muted", text: t("sv_fac_need_level") });
      else action = UI.btn(t("sv_fac_up", { cost: UI.money(cost) }), function () {
        var err = App.act(function (s) { return Core.upgradeFacility(s, f); });
        if (err) UI.toast(t("sv_err_" + err), "bad");
      }, st.company.money >= cost ? "sv-btn-gold" : "sv-btn-ghost", { "data-act": "fac-up-" + f });
      return el("div", { class: "sv-fac" }, [
        el("div", { class: "sv-grow" }, [
          el("div", {}, [el("b", { text: UI.L(F.name) }), " ", el("span", { class: "sv-chip", text: t("sv_fac_lv", { lv: lv, cap: F.max }) })]),
          el("div", { class: "sv-small sv-muted", text: UI.L(F.desc) + (f === "dorm" ? "・" + t("sv_fac_dorm_cap", { n: Core.capacity(st) }) : "") })
        ]),
        action
      ]);
    })));
  }
```

2. `debugCard` 中 `UI.btn(t("sv_debug_skip", { n: 30 }), …)` 那個按鈕之後加入：

```js
        , UI.btn(t("sv_debug_event"), function () { App.act(function (s) { Core.triggerRandomEvent(s); }); }, "", { "data-act": "debug-event" })
```

（該按鈕原本是陣列最後一個元素、沒有結尾逗號，所以以逗號開頭。）

3. render 中 `c.appendChild(infoCard(st, App));` 之後加入 `c.appendChild(facilitiesCard(st, App));`

`static_src/starv_log.js` 在 Task 6 加入的 `event_*` 區塊之後加入：

```js
    else if (e.type === "facility_up") { var F2 = D.FACILITIES[d.f]; p.fac = F2 ? UI.L(F2.name) : d.f; p.lv = d.lv; }
```

- [ ] **Step 5：建立 `static_src/starv_view_industry.js`**

```js
// 明星經紀 starV：「業界」分頁（本季趨勢、特殊潮流、下季傳聞；規格 §8.3）。
// 對手公司、排行榜、頒獎典禮在計畫 4 加進這個分頁。
(function () {
  "use strict";

  var D = window.PriTestStarvData;
  var Core = window.PriTestStarvCore;
  var UI = window.PriTestStarvUI;
  var t = UI.t, el = UI.el;

  function dirChip(id, cls) {
    var d = D.DIR_BY_ID[id];
    return el("span", { class: "sv-chip " + cls, style: "--sv-dc:" + d.color, text: d.icon + " " + UI.L(d.name) });
  }

  function trendCard(st) {
    var c = st.trend.cur, sp = c.special ? D.SPECIAL_TREND_BY_ID[c.special] : null, s = Core.seasonOf(st.day);
    var left = D.BAL.seasonDays - (st.day % D.BAL.seasonDays);
    return el("div", { class: "sv-card sv-trend" }, [
      el("h3", { text: t("sv_trend_title") }),
      el("div", { class: "sv-small sv-muted", text: t("sv_season", { y: s.year, s: s.season }) + "・" + t("sv_trend_ends", { n: left }) }),
      el("div", { class: "sv-trend-row" }, [el("span", { class: "sv-small", text: "🔥 " + t("sv_trend_hot") }), el("div", { class: "sv-chips" }, c.hot.map(function (id) { return dirChip(id, "sv-trend-hot"); }))]),
      el("div", { class: "sv-trend-row" }, [el("span", { class: "sv-small", text: "🧊 " + t("sv_trend_cold") }), el("div", { class: "sv-chips" }, [dirChip(c.cold, "sv-trend-cold")])]),
      sp ? el("div", { class: "sv-trend-special" }, [
        el("div", { class: "sv-small sv-warn", text: "✨ " + t("sv_trend_special") }),
        el("b", { text: UI.L(sp.name) }),
        el("p", { class: "sv-small", text: UI.L(sp.desc) }),
        el("div", { class: "sv-chips" }, sp.dirs.map(function (id) { return dirChip(id, "sv-trend-hot"); }))
      ]) : null
    ]);
  }

  function rumorCard(st) {
    var n = st.trend.next, sp = n.special ? D.SPECIAL_TREND_BY_ID[n.special] : null;
    var dirs = n.hot.map(function (id) { return UI.dirName(id); }).join("、");
    return el("div", { class: "sv-card sv-trend-rumor" }, [
      el("h3", { text: "🗞️ " + t("sv_trend_rumor_title") }),
      el("p", { text: t("sv_trend_rumor", { dirs: dirs }) }),
      sp ? el("p", { class: "sv-small", text: t("sv_trend_rumor_special", { name: UI.L(sp.name) }) }) : null
    ]);
  }

  UI.register({
    id: "industry", order: 40, icon: "📈", labelKey: "sv_tab_industry",
    render: function (c, App) {
      var st = App.st();
      c.appendChild(trendCard(st));
      c.appendChild(rumorCard(st));
    }
  });
})();
```

- [ ] **Step 6：登記腳本並追加樣式**

`STARV_SCRIPTS`：在 `"starv_view_gacha.js",` 之前加 `"starv_view_industry.js",`

附加到 `starv.css`：

```css
/* ---- 設施與業界 ---- */
.sv-fac { display: flex; align-items: center; gap: 0.6rem; padding: 0.5rem 0; border-top: 1px solid var(--sv-line); }
.sv-trend-row { display: flex; flex-direction: column; gap: 0.3rem; margin-top: 0.6rem; }
.sv-trend-hot { border-color: var(--sv-dc); background: color-mix(in srgb, var(--sv-dc) 25%, transparent); }
.sv-trend-cold { opacity: 0.7; border-style: dashed; }
.sv-trend-special { margin-top: 0.8rem; padding: 0.7rem 0.9rem; border-radius: 12px; border: 1px solid rgba(255, 214, 107, 0.55); background: linear-gradient(120deg, rgba(255, 214, 107, 0.15), rgba(255, 95, 168, 0.12)); }
.sv-trend-special p { margin: 0.3rem 0; line-height: 1.6; }
.sv-trend-rumor { border-style: dashed; }
```

- [ ] **Step 7：建置並執行全部檢查**

```bash
py -3 generate.py && py -3 tools/split_css.py --check
for f in static_src/starv*.js; do node --check "$f" || exit 1; done
node tools/starv_check/core_check.js
node tools/starv_check/sim.js 30
node tools/starv_check/ui_check.js
```

Expected：`core_check` 全部 67 個通過；`sim` 不變量全部通過；`ui_check` 全部 14 個步驟通過。

- [ ] **Step 8：檢視截圖**

用 Read 打開 `tools/starv_check/shots/tab-industry.png`、`tab-company.png`，確認趨勢卡的方向色塊、特殊潮流的金框、設施列的升級鈕沒有溢出。

- [ ] **Step 9：commit**

```bash
git add static_src/starv_view_industry.js static_src/starv_view_company.js static_src/starv_log.js site_src/starv_page.py site_src/i18n_starv.py static_src/css/starv.css tools/starv_check/ui_check.js
git commit -m "feat(starv): 公司設施卡、業界分頁（趨勢與傳聞）、debug 觸發事件"
```
