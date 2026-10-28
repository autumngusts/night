# starV 計畫 10：內容大擴充 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 使用者指定（2026-10-28）：重大事件擴充到 500 種、SR 100 位、SSR 33 位（以近代既有作品角色為原型）、大型企劃 30 件、特性 100 種（可以加少量新效果鍵）。

**Architecture:** 內容全部放新資料檔，經既有登記器追加；資料品質由 lint 測試把關（格式、效果鍵白名單、佔位符、預設選項、重複標題）。核心只改兩處：特性的 6 個新效果鍵、匯出事件目標鍵清單供 lint 使用；企劃分頁只列出已解鎖與接下來 3 件。

**Tech Stack:** Vanilla ES5、node、Playwright。

## Global Constraints

- 數量（使用者指定）：重大事件合計 500、SR 100、SSR 33、大型企劃 30、特性 100
- **角色原型（使用者指定「以既有作品角色為原型」）**：名字、簡介、小故事一律原創，不使用原作的角色名、台詞或設定原文；只借用性格、境遇、角色類型作為致敬。每位 SR／SSR 上一行寫註解 `// 原型：<作品>（<角色類型或角色>）`，方便日後替換
- 規格 §3.3 稀有度規則（能力合計、主方向適性、特質數）、§3.2 fx 白名單、§4 ID 永不重用（新 SR 從 `sr031`、SSR 從 `ssr013`）由既有名錄測試把關
- 規格 §7：每個事件 2～3 個選項、只寫傾向（hint）、`defaultChoice` 選比較保守的；壞結果標 `bad: true`
- 規格 §12：企劃階段的 `dirs` 是方向 id、`slots` 為 1～5、`branch` 指向 trigger 為 `cond` 的分歧事件
- 不修改其他遊戲；CLAUDE.md §5.2.1 前綴；推送前遞增版本號；測試頁面按鈕一律用 `dispatchEvent`
- 新資料檔都要登記到三處（頁面 `STARV_SCRIPTS`、`core_check.js`、`sim.js`），插在同類檔案的最後一個之後

## 新的特性效果鍵（Task 1）

| 鍵 | 型別 | 作用位置 | 意義 |
| --- | --- | --- | --- |
| `growthStats` | `{ stats: [...], v }` | `growStat` | 指定能力的成長 ×v |
| `salary` | 數字 | `updateSalary` | 月薪 ×v |
| `satDrift` | 數字（可負） | `monthly` 滿意度漂移 | 每月滿意度加減（多個特性相加） |
| `badLuck` | 數字 | `resolveEvent` | 以該藝人為目標的事件，壞結果權重 ×v |
| `fameDecay` | 數字 | `monthly` 人氣衰退 | 人氣衰退率 ×v |
| `chem` | 數字 | `chemistry` | 組合默契 × 成員 chem 的平均 |

fx 白名單＝`D.TRAITS` 用到的鍵＋`greatShift`（既有名錄測試的算法），所以特性用了新鍵之後，SSR 專屬技能也可以用。

## 檔案結構

| 檔案 | 內容 |
| --- | --- |
| Create `static_src/starv_traits_1.js` | 特性 75 種（合計 100） |
| Create `static_src/starv_roster_4.js`、`starv_roster_5.js` | SR 各 35 位（sr031～sr065、sr066～sr100） |
| Create `static_src/starv_roster_6.js` | SSR 21 位（ssr013～ssr033） |
| Create `static_src/starv_projects_2.js` | 大型企劃 25 件（合計 30） |
| Create `static_src/starv_events_6.js` | 企劃分歧事件 10 種（cond） |
| Create `static_src/starv_events_7.js`～`starv_events_14.js` | 隨機事件 429 種（見下表） |
| Modify `static_src/starv_core.js` | 6 個新效果鍵、`api.EVENT_TARGETS` |
| Modify `static_src/starv_view_projects.js`、`site_src/i18n_starv.py` | 企劃列表只列已解鎖＋接下來 3 件 |
| Modify `site_src/starv_page.py`、`tools/starv_check/core_check.js`、`tools/starv_check/sim.js` | 登記 |
| Modify `tools/starv_check/core_check.js` | lint 與數量測試 |

隨機事件的分配（合計 429；加上既有 61 與企劃分歧 10 ＝ 500）：

| 檔案 | 類別 | 數量 | addedIn |
| --- | --- | --- | --- |
| `starv_events_7.js` | scandal 醜聞 | 65 | v6 |
| `starv_events_8.js` | chance 機會（工作、合作、媒體） | 45 | v6 |
| `starv_events_9.js` | chance 機會（成長、粉絲、生活） | 45 | v6 |
| `starv_events_10.js` | poach 挖角 | 30 | v6 |
| `starv_events_11.js` | net 網路 | 65 | v6 |
| `starv_events_12.js` | health 健康 | 60 | v6 |
| `starv_events_13.js` | company 公司（target 多為 `none`） | 69 | v6 |
| `starv_events_14.js` | special 特殊（其中 30 種 `rival: true` 的對手互動，部分 `needStar: true`） | 50 | v6 |

## 事件撰寫規則（lint 會檢查的部分以 ✔ 標示）

- ✔ id：小寫英數與底線、全域不重複；標題（zh）全域不重複
- ✔ `category` 在 `PriTestStarvEvents.CATS`；`trigger` 為 `random` 或 `cond`；`weight > 0`
- ✔ `target` 在 `Core.EVENT_TARGETS`（含 `none`）；`target: "none"` 的文字不能出現 `{name}`
- ✔ 文字佔位只能用 `{name}`、`{n}`、`{rival}`、`{star}`，zh 與 ja 用到的佔位要一致；出現 `{rival}` 的隨機事件要 `rival: true`，出現 `{star}` 的要 `needStar: true`
- ✔ 2～3 個選項；`label`、`hint` 都有 zh／ja；每個選項至少 1 個 outcome，`w > 0`
- ✔ fx 鍵只能用：`famePct stress satisfaction money rest mood specialJob fame stamina statAll rep stat salaryPct leave moneyBySalary allSatisfaction allStress tickets sellTop loan allSalaryPct rivalPower projectMod projectDays`（`renew`／`retire`／`retain` 只給既有生涯事件）；`stat` 的鍵要在 `D.STATS`；`projectMod`／`projectDays` 只能出現在 `cond` 事件
- ✔ `defaultChoice` 指向存在的選項
- 數值尺度參考既有事件：`famePct` ±0.03～0.25、`fame` 30～300、`stress` ±5～25、`money` ±5,000～100,000、`statAll` 2～10、`rest` 3～14 天、`tickets` 1～5；`leave`、`sellTop` 只能出現在壞結果或明確的選項裡
- 文體：一句情境（含名字），選項寫行動、hint 寫傾向（「人氣↑ 壓力↑」「看運氣」）。日文自然口語，不直譯

---

### Task 1：特性 6 個新效果鍵與 75 種新特性

**Files:**
- Create: `static_src/starv_traits_1.js`
- Modify: `static_src/starv_core.js`、`site_src/starv_page.py`、`tools/starv_check/core_check.js`、`tools/starv_check/sim.js`

**Interfaces:**
- Produces：`D.TRAITS.length === 100`、`D.TRAIT_BY_ID` 同步；核心支援 `growthStats`／`salary`／`satDrift`／`badLuck`／`fameDecay`／`chem`

- [ ] **Step 1：寫失敗測試**

`core_check.js` 的 `// ==== 雲端存檔（計畫 8） ====` 之前加：

```js
test("特性：100 種、id 不重複、文字齊全、新效果鍵會作用", function () {
  eq(D.TRAITS.length, 100, "特性數");
  var seen = {};
  D.TRAITS.forEach(function (t) {
    assert(/^[a-z0-9_]+$/.test(t.id) && !seen[t.id], "特性 id " + t.id); seen[t.id] = 1;
    eq(D.TRAIT_BY_ID[t.id], t, t.id + " 索引");
    assert(t.name.zh && t.name.ja && t.desc.zh && t.desc.ja, t.id + " 文字");
    assert(Object.keys(t.fx).length >= 1, t.id + " 效果");
  });
  var st = Core.create({ seed: 4 });
  st.board = []; st.boardRefreshDay = 99999;
  // salary：月薪 ×v
  var a = freshArtist(st, { salary: 2000 }), b = freshArtist(st, { salary: 2000 });
  a.traits = ["t_frugal"]; Core._updateSalary(a); Core._updateSalary(b);
  assert(a.salary < b.salary, "salary 鍵：月薪較低 " + a.salary + " / " + b.salary);
  // growthStats：指定能力成長較快
  var g1 = freshArtist(st), g2 = freshArtist(st);
  g1.traits = ["t_vocal_gift"];
  Core._growStat(st, g1, "vocal", 10, "course"); Core._growStat(st, g2, "vocal", 10, "course");
  assert(g1.stats.vocal > g2.stats.vocal, "growthStats 鍵");
  // chem：組合默契加成
  st.groups = [{ id: "g1", name: "", members: [g1.id, g2.id], jobs: 50 }];
  var base = Core.chemistry(st, [g1.id, g2.id]);
  g1.traits = ["t_team_player"]; g2.traits = ["t_team_player"];
  assert(Core.chemistry(st, [g1.id, g2.id]) > base, "chem 鍵");
});
```

- [ ] **Step 2：執行，確認失敗**

Run：`node tools/starv_check/core_check.js` → Expected：特性數 預期 100，實際 25。

- [ ] **Step 3：核心支援新鍵**

`static_src/starv_core.js`：

1. `fxGreatShift` 函式之後加：

```js
  // 特性的新效果鍵（計畫 10）
  function fxStatMult(a, stat) {
    var m = 1;
    fxList(a).forEach(function (f) { if (f.growthStats && f.growthStats.stats.indexOf(stat) >= 0) m *= f.growthStats.v; });
    return m;
  }
  function fxSum(a, key) {
    var s = 0;
    fxList(a).forEach(function (f) { if (typeof f[key] === "number") s += f[key]; });
    return s;
  }
```

   （`fxList` 等是函式宣告，`updateSalary` 在檔案前段也能呼叫。）

2. `updateSalary` 的計算行改為（乘上 `salary` 鍵）：

```js
    a.salary = Math.round(a.baseSalary * (1 + Math.sqrt(Math.max(0, a.fame)) / BAL.salaryFameDiv) * fxMult(a, "salary") / 100) * 100;
```

3. `growStat` 的 `var m = …` 那一串乘式最後（`facilityGrowth(st, stat, src);` 之前）加 `fxStatMult(a, stat) *`。
4. `monthly`：人氣衰退 `var rate = (…) * prMult;` 改為 `var rate = (inPeak(a) ? BAL.fameDecay : BAL.fameDecayOffPeak) * prMult * fxMult(a, "fameDecay");`；滿意度漂移在 `if (a.mood >= 1) d += BAL.satMood;` 之後加 `d += fxSum(a, "satDrift");`
5. `chemistry`：

```js
  function chemistry(st, aids) {
    var g = groupOf(st, aids);
    if (!g) return 0;
    var m = 0, n = 0;
    aids.forEach(function (id) { var a = artistById(st, id); if (a) { m += fxMult(a, "chem"); n++; } });
    return Math.min(BAL.chemistryMax, g.jobs * BAL.chemistryPerJob) * (n ? m / n : 1);
  }
```

   （保留原本找組合的寫法；若原函式不是用 `groupOf`，照原寫法取得 `g`，只把回傳值乘上平均 chem。）

6. `resolveEvent` 的權重行改為：

```js
    var target = e.aid ? artistById(st, e.aid) : null, luck = target ? fxMult(target, "badLuck") : 1;
    ch.outcomes.forEach(function (o, k) { w[k] = o.w * (o.bad ? (1 - st.facilities.pr * BAL.prBadCut) * luck : 1); });
```

7. 匯出：`api._genR = genR;` 之後加 `api._updateSalary = updateSalary;`、`api._growStat = growStat;`（若已存在就略過）。

- [ ] **Step 4：建立 `static_src/starv_traits_1.js`**

檔頭與寫法：

```js
// 明星經紀 starV：特性 v2（75 種，合計 100；規格 §3.2）。fx 只用 core 支援的修正鍵：
// growth growthCourse growthTrain stress stamina fame perf pay eventRate perfDirs，以及計畫 10 新增的
// growthStats{stats,v} salary satDrift badLuck fameDecay chem。id 一律以 t_ 開頭，永不重用。
(function () {
  "use strict";

  var root = typeof window !== "undefined" ? window : globalThis;
  var D = root.PriTestStarvData;
  var T = D.T;

  function dirs(list, v) { return { dirs: list, v: v }; }
  function stats(list, v) { return { stats: list, v: v }; }
  function trait(id, name, desc, fx) { return { id: id, name: T(name), desc: T(desc), fx: fx }; }

  [
    // 測試會用到的三個（id 不可改）
    trait("t_frugal", "勤儉|倹約家", "月薪 -15%|月給 -15%", { salary: 0.85 }),
    trait("t_vocal_gift", "天生好嗓|天性の喉", "歌唱成長 +30%|歌唱の成長 +30%", { growthStats: stats(["vocal"], 1.3) }),
    trait("t_team_player", "團隊精神|チームプレイヤー", "組合默契 +30%|ユニットの相性 +30%", { chem: 1.3 })
    // … 其餘 72 種
  ].forEach(function (t) {
    if (D.TRAIT_BY_ID[t.id]) throw new Error("starV traits: 重複的 ID " + t.id);
    D.TRAITS.push(t);
    D.TRAIT_BY_ID[t.id] = t;
  });
})();
```

其餘 72 種的設計分配（每種一句描述，zh／ja；正負面都要有，約 1/4 是有缺點的特性）：

- 單一能力成長（`growthStats`）：6 項能力各 2 種（強弱不同或附帶缺點）＝12
- 雙能力成長組合：8
- 方向表現（`perfDirs`，避免與既有 25 種完全相同的方向組合）：16
- 月薪（`salary`）：4（含 1 種月薪偏高但表現佳）
- 滿意度（`satDrift`）：6（含 2 種負值）
- 事件運（`badLuck`）：5（含 2 種 > 1 的倒楣體質）
- 人氣衰退（`fameDecay`）：5（含 1 種 > 1 的過氣快）
- 組合（`chem`）：4（含 1 種 < 1 的獨行俠）
- 體力／壓力／課程／訓練的複合：12

- [ ] **Step 5：登記並執行**

`site_src/starv_page.py`：`"starv_words_1.js",` 之後加 `"starv_traits_1.js",`；`core_check.js`、`sim.js`：`require("../../static_src/starv_words_1.js");` 之後加 `require("../../static_src/starv_traits_1.js");`

```bash
node --check static_src/starv_traits_1.js && node --check static_src/starv_core.js
node tools/starv_check/core_check.js
node tools/starv_check/sim.js 30
```

Expected：`core_check` 全部通過（107）；sim 不變量通過（R 的特性改從 100 種抽，平衡可能小幅變動，WARN 只記錄不必修）。

- [ ] **Step 6：commit**

```bash
git add static_src/starv_traits_1.js static_src/starv_core.js site_src/starv_page.py tools/starv_check/core_check.js tools/starv_check/sim.js
git commit -m "feat(starv): 特性擴充到 100 種、6 個新效果鍵（指定能力成長、月薪、滿意度、事件運、人氣衰退、默契）"
```

---

### Task 2：SR 70 位（合計 100）

**Files:**
- Create: `static_src/starv_roster_4.js`（sr031～sr065）、`static_src/starv_roster_5.js`（sr066～sr100）
- Modify: 三處登記、`tools/starv_check/core_check.js`

- [ ] **Step 1：改測試數量（先寫測試）**

`test("名錄：SR 30、SSR 12、宿敵 20，欄位完整", …)` 改名為 `名錄：SR 100、SSR 33、宿敵 20，欄位完整`，第一行改為：

```js
  eq(Roster.byRarity("SR").length, 100, "SR 數"); eq(Roster.byRarity("SSR").length, 33, "SSR 數");
```

（Task 2 完成時 SSR 還是 12 → 本測試要到 Task 3 才會全過；Task 2 的驗收看 SR 數與「稀有度規則」測試。）

- [ ] **Step 2：建立兩個名錄檔**

寫法與 `starv_roster_2.js` 相同（`sr(id, name, gender, age, dir, subDirs, apt, stats, traits, look, bio)`，`addedIn: "v3"`），每位上一行寫原型註解，例如：

```js
    // 原型：《羅馬假期》（出走的公主）
    sr("sr031", "白鷺玲奈|白鷺 玲奈", "f", 22, "film", ["model"], "ACCBAB", [78, 20, 30, 40, 75, 35], ["camera", "t_frugal"], L(0, 9, 3, 1, 5, 4, 0),
      "被保護得太好的千金，某天甩掉保鑣，在街頭被選角導演攔下。|箱入りの令嬢。ある日ボディガードをまいて、街角でキャスティング監督に呼び止められた。"),
```

分配：16 個方向各 4～5 位（合計 70），男女約各半，年齡符合方向巔峰區間；特質可以用新特性；能力合計 200～300、主方向最高權重的能力適性 A 以上（名錄測試把關）。原型取材範圍：20 世紀以後的小說、電影、漫畫、動畫、遊戲中家喻戶曉的角色類型（偵探、怪盜、魔法少女、機甲駕駛員、偶像、天才廚師、運動少年、武俠、科幻、職人劇……），**名字與文字原創**。

- [ ] **Step 3：登記、執行、commit**

`"starv_roster_3.js",` 之後加 `"starv_roster_4.js",`、`"starv_roster_5.js",`；`core_check.js`、`sim.js` 對應 require。

```bash
node --check static_src/starv_roster_4.js && node --check static_src/starv_roster_5.js
node tools/starv_check/core_check.js
```

Expected：只剩「SSR 數 預期 33」一個失敗。

```bash
git add static_src/starv_roster_4.js static_src/starv_roster_5.js site_src/starv_page.py tools/starv_check/core_check.js tools/starv_check/sim.js
git commit -m "feat(starv): SR 擴充到 100 位（以近代作品角色類型為原型的原創角色）"
```

---

### Task 3：SSR 21 位（合計 33）

**Files:**
- Create: `static_src/starv_roster_6.js`（ssr013～ssr033）
- Modify: 三處登記

- [ ] **Step 1：建立名錄檔**

寫法與 `starv_roster_3.js` 相同（`ssr(id, name, gender, age, dir, subDirs, apt, stats, traits, skill, look, bio, story)`，`addedIn: "v3"`），每位：原型註解、能力合計 350～450、主方向 S、特質 2、專屬技能（fx 只用白名單鍵，可用新鍵，例如 `growthStats`、`chem`、`badLuck`）、bio 一句、得獎後解鎖的小故事 80～150 字（zh／ja 各一）。16 個方向都至少有 1 位 SSR（現有 12 位只涵蓋 12 個方向：drama、cm、anchor、influencer 優先補）。

- [ ] **Step 2：登記、執行、commit**

`"starv_roster_5.js",` 之後加 `"starv_roster_6.js",`；core_check／sim 對應 require。

```bash
node --check static_src/starv_roster_6.js && node tools/starv_check/core_check.js
```

Expected：全部通過（107）。

```bash
git add static_src/starv_roster_6.js site_src/starv_page.py tools/starv_check/core_check.js tools/starv_check/sim.js
git commit -m "feat(starv): SSR 擴充到 33 位（專屬技能與小故事）"
```

---

### Task 4：事件 lint、企劃分歧事件 10、大型企劃 25

**Files:**
- Create: `static_src/starv_events_6.js`、`static_src/starv_projects_2.js`
- Modify: `static_src/starv_core.js`（`api.EVENT_TARGETS`）、`static_src/starv_view_projects.js`、`site_src/i18n_starv.py`、三處登記、`tools/starv_check/core_check.js`

- [ ] **Step 1：寫 lint 與企劃測試**

`core_check.js` 的 `// ==== 雲端存檔（計畫 8） ====` 之前加：

```js
var EVENT_FX = "famePct stress satisfaction money rest mood specialJob fame stamina statAll rep stat salaryPct leave moneyBySalary allSatisfaction allStress tickets sellTop loan allSalaryPct rivalPower projectMod projectDays renew retire retain".split(" ");
var CAREER_ONLY = ["renew", "retire", "retain"];
function placeholders(s) { return (s.match(/\{[a-z]+\}/g) || []).sort().join(","); }

test("事件 lint：格式、目標、佔位符、選項、fx 鍵、預設選項、標題不重複", function () {
  var ids = {}, titles = {};
  Events.all().forEach(function (ev) {
    var where = ev.id;
    assert(/^[a-z0-9_]+$/.test(ev.id), where + " id 格式");
    assert(!titles[ev.title.zh], where + " 標題重複：" + ev.title.zh + "（" + titles[ev.title.zh] + "）"); titles[ev.title.zh] = ev.id;
    assert(Events.CATS.indexOf(ev.category) >= 0, where + " 類別");
    assert(ev.trigger === "random" || ev.trigger === "cond", where + " trigger");
    assert(ev.weight > 0, where + " weight");
    assert(Core.EVENT_TARGETS.indexOf(ev.target) >= 0, where + " target " + ev.target);
    assert(ev.title.zh && ev.title.ja && ev.text.zh && ev.text.ja, where + " 文字");
    var ph = placeholders(ev.text.zh);
    eq(placeholders(ev.text.ja), ph, where + " zh/ja 佔位不一致");
    (ph ? ph.split(",") : []).forEach(function (p) { assert(["{name}", "{n}", "{rival}", "{star}"].indexOf(p) >= 0, where + " 不明佔位 " + p); });
    if (ev.target === "none") assert(ph.indexOf("{name}") < 0, where + " target none 不能用 {name}");
    if (ev.trigger === "random" && ph.indexOf("{rival}") >= 0) assert(ev.rival, where + " 用 {rival} 要 rival: true");
    if (ev.trigger === "random" && ph.indexOf("{star}") >= 0) assert(ev.rival && ev.needStar, where + " 用 {star} 要 needStar: true");
    assert(ev.choices.length >= 2 && ev.choices.length <= 3, where + " 選項數 " + ev.choices.length);
    ev.choices.forEach(function (c, i) {
      assert(c.label.zh && c.label.ja && c.hint.zh && c.hint.ja, where + " 選項 " + i + " 文字");
      assert(c.outcomes.length >= 1, where + " 選項 " + i + " 沒有結果");
      c.outcomes.forEach(function (o) {
        assert(o.w > 0, where + " 權重");
        Object.keys(o.fx).forEach(function (k) {
          assert(EVENT_FX.indexOf(k) >= 0, where + " fx 不支援 " + k);
          if (CAREER_ONLY.indexOf(k) >= 0) assert(ev.id === "contract_renewal" || ev.id === "retire_offer", where + " 生涯專用 fx " + k);
          if (k === "projectMod" || k === "projectDays") assert(ev.trigger === "cond", where + " 企劃 fx 只能在 cond 事件");
          if (k === "stat") Object.keys(o.fx.stat).forEach(function (s) { assert(D.STATS.indexOf(s) >= 0, where + " stat 鍵 " + s); });
        });
      });
    });
    assert(ev.choices[ev.defaultChoice], where + " defaultChoice");
  });
});

test("大型企劃：30 件、階段格式、分歧事件存在、解鎖等級與費用範圍", function () {
  eq(D.PROJECTS.length, 30, "企劃數");
  var titles = {};
  D.PROJECTS.forEach(function (p) {
    assert(/^[a-z0-9_]+$/.test(p.id), p.id + " id");
    assert(!titles[p.name.zh], p.id + " 名稱重複"); titles[p.name.zh] = 1;
    assert(p.name.zh && p.name.ja && p.desc.zh && p.desc.ja, p.id + " 文字");
    assert(p.unlockLevel >= 3 && p.unlockLevel <= 10, p.id + " 解鎖等級 " + p.unlockLevel);
    assert(p.cost >= 100000 && p.cost <= 2000000, p.id + " 費用 " + p.cost);
    assert(p.stages.length >= 2 && p.stages.length <= 5, p.id + " 階段數");
    p.stages.forEach(function (s, i) {
      var w = p.id + " 階段 " + i;
      assert(s.name.zh && s.name.ja, w + " 名稱");
      assert(s.dirs.length >= 1 && s.dirs.every(function (d) { return D.DIR_BY_ID[d]; }), w + " 方向");
      assert(s.slots[0] >= 1 && s.slots[0] <= s.slots[1] && s.slots[1] <= 5, w + " 人數");
      assert(D.TIER_ORDER.indexOf(s.tier) >= 0, w + " 等級 " + s.tier);
      assert(s.days >= 3 && s.days <= 30, w + " 天數");
      if (s.branch) { var ev = D.EVENT_BY_ID[s.branch]; assert(ev && ev.trigger === "cond", w + " 分歧事件 " + s.branch); }
    });
  });
  var levels = {};
  D.PROJECTS.forEach(function (p) { levels[p.unlockLevel] = (levels[p.unlockLevel] || 0) + 1; });
  assert(Object.keys(levels).length >= 6, "解鎖等級分散在 6 個以上的等級");
});
```

- [ ] **Step 2：執行，確認 lint 對既有事件通過、企劃測試失敗**

`static_src/starv_core.js` 匯出區 `api.triggerRandomEvent = triggerRandomEvent;` 之後加 `api.EVENT_TARGETS = Object.keys(EVENT_FILTERS).concat(["none"]);`

Run：`node tools/starv_check/core_check.js`
Expected：事件 lint 通過（若既有事件違反規則，先修正既有資料再繼續，並在 commit 訊息註明）；企劃測試 FAIL（企劃數 預期 30，實際 5）。

- [ ] **Step 3：建立 `static_src/starv_events_6.js`（企劃分歧 10 種）**

寫法與 `starv_events_4.js` 相同（`target: "none"`、`trigger: "cond"`、`addedIn: "v6"`），fx 以 `projectMod`（±0.03～0.2）、`projectDays`（3～10）、`money` 為主。主題：外景天候、劇本大改、主創意見分歧、媒體試映會、海外版權洽談、器材故障、粉絲應援、競品同檔、名導客串、預算追加。id 以 `proj_` 開頭。

- [ ] **Step 4：建立 `static_src/starv_projects_2.js`（25 件）**

寫法與 `starv_projects_1.js` 相同（`P(id, name, desc, unlockLevel, cost, stages)`、`S(name, dirs, slots, tier, days, branch)`，`addedIn: "v2"`）。解鎖等級 3～10 分散（Lv3～4 的小企劃 2～3 階段、費用 10～20 萬；Lv9～10 的超大企劃 4～5 階段、費用 100～200 萬），每件 1～2 個階段帶 `branch`（用既有 3 種與 events_6 的 10 種）。題材涵蓋 16 個方向：電視劇季播、晨間劇、音樂劇、虛擬演唱會、時尚週、搞笑大賽、新聞特別節目、聲優廣播劇、偶像出道企劃、樂團巡迴、電影配樂、網紅聯名商品、運動會綜藝、紅白級年末歌謠祭、國際廣告大片……

- [ ] **Step 5：企劃列表只列已解鎖＋接下來 3 件**

`static_src/starv_view_projects.js` 的 `listView`：

```js
  function listView(st, App) {
    var open = D.PROJECTS.filter(function (p) { return st.company.level >= p.unlockLevel; });
    var locked = D.PROJECTS.filter(function (p) { return st.company.level < p.unlockLevel; })
      .sort(function (x, y) { return x.unlockLevel - y.unlockLevel; });
    var shown = open.concat(locked.slice(0, 3)), hidden = locked.length - Math.min(3, locked.length);
    var wrap = el("div", { class: "sv-proj-list" }, shown.map(function (p) {
```

（原本 `D.PROJECTS.map(function (p) {` 的內容不動，只把資料來源換成 `shown`，並把回傳的 `el("div", { class: "sv-proj-list" }, …)` 存進 `wrap`。）函式最後：

```js
    if (hidden > 0) wrap.appendChild(el("p", { class: "sv-small sv-muted", text: t("sv_proj_more_locked", { n: hidden }) }));
    return wrap;
  }
```

`site_src/i18n_starv.py` 追加：`("sv_proj_more_locked", "還有 {n} 件企劃會在公司等級更高時出現", "あと {n} 件の企画は事務所のレベルが上がると現れる"),`

- [ ] **Step 6：登記、執行、commit**

`"starv_events_5.js",` 之後加 `"starv_events_6.js",`；`"starv_projects_1.js",` 之後加 `"starv_projects_2.js",`；core_check／sim 對應 require。

```bash
for f in static_src/starv*.js; do node --check "$f" || exit 1; done
node tools/starv_check/core_check.js
```

Expected：全部通過（109）。

```bash
git add static_src/starv_events_6.js static_src/starv_projects_2.js static_src/starv_core.js static_src/starv_view_projects.js site_src/i18n_starv.py site_src/starv_page.py tools/starv_check/core_check.js tools/starv_check/sim.js
git commit -m "feat(starv): 大型企劃擴充到 30 件、企劃分歧事件 10 種、事件 lint 測試"
```

---

### Task 5～12：隨機事件 429 種（每個檔案一個 task）

每個 task 建立一個事件檔（依「隨機事件的分配」表），流程相同：

- [ ] **Step 1：建立 `static_src/starv_events_N.js`**

寫法與 `starv_events_1.js` 相同（`O`／`C`／`E` helper，`addedIn: "v6"`；`starv_events_14.js` 的對手互動用 `starv_events_2.js` 的 `rival: true`／`needStar: true` 寫法）。依本計畫「事件撰寫規則」撰寫，目標鍵要分散（不要全部 `any`），每個檔案內的題材不重複。

- [ ] **Step 2：登記**

接在前一個事件檔之後加進三處登記。

- [ ] **Step 3：執行**

```bash
node --check static_src/starv_events_N.js && node tools/starv_check/core_check.js
```

Expected：事件 lint 通過、全部通過。

- [ ] **Step 4：commit**

```bash
git add static_src/starv_events_N.js site_src/starv_page.py tools/starv_check/core_check.js tools/starv_check/sim.js
git commit -m "feat(starv): 重大事件 v6——<類別>（<數量> 種）"
```

最後一個（`starv_events_14.js`）完成後，在 `core_check.js` 的事件 lint 測試之後加數量測試並確認通過：

```js
test("事件：合計 500 種", function () {
  eq(Events.all().length, 500, "事件數");
  var cats = {};
  Events.all().forEach(function (e) { cats[e.category] = (cats[e.category] || 0) + 1; });
  Events.CATS.forEach(function (c) { assert(cats[c] >= 30, c + " 至少 30 種：" + cats[c]); });
});
```

---

### Task 13：全部檢查

- [ ] **Step 1**

```bash
py -3 generate.py && py -3 tools/split_css.py --check
for f in static_src/starv*.js; do node --check "$f" || exit 1; done
node tools/starv_check/core_check.js
node tools/starv_check/sim.js 30
node tools/starv_check/ui_check.js
```

Expected：`core_check` 全部通過（110）；sim 不變量通過；`ui_check` 26 步驟通過（三種語言沒有漏翻、企劃分頁）。

- [ ] **Step 2：檢視 `tools/starv_check/shots/tab-projects.png`，確認企劃列表只顯示已解鎖＋3 件與「還有 N 件」提示。有修正就 commit。**
