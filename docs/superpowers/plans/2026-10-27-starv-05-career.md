# starV 計畫 5：生涯、名人堂、導師、圖鑑、成就、新紀元 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 加入規格 §11（合約與續約、滿意度、引退與挽留、名人堂、導師／製作人）、§13（新紀元與傳承點）、§14（圖鑑、SSR 小故事、成就、作品年表），以及新的「殿堂」分頁與引退紀念畫面。

**Architecture:** 合約、引退、名人堂、導師、新紀元寫在 `starv_core.js`；續約與引退走既有的重大事件引擎（新事件檔 `starv_events_3.js`、新 fx：`renew`、`retire`、`retain`）。成就比照事件做成登記器（`starv_achievements.js`＋分檔資料 `starv_achievements_1.js`，之後擴充）。傳承加成定義放在 `starv_data.js`。UI 新增 `starv_view_hall.js`（殿堂分頁：名人堂、導師、圖鑑、成就、年表、新紀元）與 `starv_career_ui.js`（引退紀念自動彈出），藝人詳情加上合約與獎座。存檔版本升到 4；新紀元時 `day` 歸零重新起算。

**Tech Stack:** Vanilla ES5、node 單元測試、Playwright。

## Global Constraints

- 規格 §11：合約 3 年（`BAL.contractDays = 1080`）；到期時續約，月薪依人氣調整；滿意度低可能拒絕續約
- 規格 §11：超過方向引退線後每年有機率提出引退；壓力長期過高、人氣長期低迷也會觸發；挽留選項（加薪、休假、保證主角）成功率依滿意度
- 規格 §11：引退時顯示生涯總結；評分 ≥ 門檻進入名人堂；主動解約不進名人堂；名人堂跨紀元保留
- 規格 §11：導師／製作人名額＝公司等級 ÷ 2（捨去），付月薪；導師：指定方向課程效果 +10～30%；製作人：指定方向工作評價 +0.5～1★、大成功率上升
- 規格 §13：公司 Lv10 後可發動新紀元；重置公司、資金、設施、在籍藝人、對手；保留圖鑑、名人堂、傳承點、成就、作品年表；可帶走 1 位藝人（能力 ×0.7、年齡不變）；傳承點購買永久加成（初始資金、初始宿舍、成長倍率、SSR 保底縮短到最低 100、對手起始實力），各有上限；每開一個新紀元對手強度 +10%
- 規格 §14：圖鑑（SR/SSR 剪影→取得、SSR 小故事有解鎖條件、R 只統計數量）、名人堂、作品年表、成就（v1 本計畫 20 項；計畫 9 擴充到 60）
- 成就之後會擴充：比照事件做成登記器、分檔、ID 永不重用、檢查函式以 `cond.type` 分派
- 舊存檔（version 3）必須能讀：`migrate` 補齊新欄位、為在籍藝人補上合約到期日
- 計畫 1–4 的既有測試要繼續通過（滿意度每月漂移、合約到期事件可能影響長時間推進的測試；失敗時先判斷是否為「規格變更造成的過時期望值」，依 CLAUDE.md §4.7 修正並註解）
- CLAUDE.md §5.2.1 前綴；推送前遞增版本號

## 檔案結構

| 檔案 | 責任 |
| --- | --- |
| Modify `static_src/starv_data.js` | 合約、滿意度、引退、名人堂、導師、新紀元的常數；`LEGACY_PERKS` |
| Create `static_src/starv_events_3.js` | 生涯事件：`contract_renewal`、`retire_offer`（`addedIn: "v3"`、`trigger: "cond"`） |
| Create `static_src/starv_achievements.js` | 成就登記器 → `PriTestStarvAchievements`（同步 `D.ACHIEVEMENTS`、`D.ACHIEVEMENT_BY_ID`） |
| Create `static_src/starv_achievements_1.js` | v1 的 20 項成就 |
| Modify `static_src/starv_roster_1.js` | SSR 的 `story`（小故事） |
| Modify `static_src/starv_core.js` | 合約、滿意度漂移、引退、名人堂、年表、導師／製作人、成就、圖鑑、新紀元、傳承加成、存檔版本 4 |
| Modify `tools/starv_check/core_check.js`、`tools/starv_check/sim.js` | 測試與模擬 |
| Create `static_src/starv_career_ui.js` | 引退紀念彈窗（`st.retireQueue` 自動彈出） |
| Create `static_src/starv_view_hall.js` | 殿堂分頁 |
| Modify `static_src/starv_view_artists.js` | 合約到期日、獎座 |
| Modify `static_src/starv_ui.js`、`static_src/starv.js` | 紀元日期（`sv_date_era`） |
| Modify `static_src/starv_events_ui.js`、`static_src/starv_log.js` | 新 fx 與日誌文字 |
| Modify `site_src/starv_page.py`、`site_src/i18n_starv.py`、`static_src/css/starv.css`、`tools/starv_check/ui_check.js` | 登記、字串、樣式、流程 |

插入慣例同計畫 2–4。**插入新區塊時，標記行（例如 `  // ==== exports ====`）必須保留**。

---

### Task 1：合約、滿意度漂移、續約事件

**Files:**
- Modify: `static_src/starv_data.js`、`static_src/starv_core.js`、`tools/starv_check/core_check.js`、`site_src/starv_page.py`、`tools/starv_check/sim.js`
- Create: `static_src/starv_events_3.js`

**Interfaces:**
- Produces:
  - `BAL`：`contractDays: 1080`、`renewSatLine: 50`、`renewRaise: 0.2`、`renewStandard: 0.1`、`satWorked: 2`、`satIdle: -2`、`satStress: -3`、`satMood: 1`
  - 藝人新欄位：`contractEnd`（建立時＝`st.day + contractDays`）、`renewPending`、`worksTotal`（累計工作數，`works` 只保留 50 件）、`retireAskedUntil`
  - 每月：最近 30 天有完成工作 +2、沒有 −2；壓力 > 70 −3；心情 ≥ 1 +1（0～100）
  - 每天：`contractEnd <= day` 而且沒有 `renewPending` → 觸發 `contract_renewal`（ctx 無）並設 `renewPending = true`
  - fx `renew: "raise"|"standard"|"release"`：`raise` 基本月薪 ×1.2、滿意度 +10、續約；`standard` 依滿意度：拒絕機率 ＝ clamp((50 − 滿意度) ÷ 50, 0, 1)，拒絕就離開，否則基本月薪 ×1.1 續約；`release` 不續約（離開，日誌 `left`）。續約時 `contractEnd += contractDays`，結果摘要 `out.renewed` 或 `out.refused`
  - 事件 `contract_renewal`（`addedIn: "v3"`、`trigger: "cond"`、`target: "any"`）：選項 0 加薪續約、1 照常續約（預設）、2 不續約
  - `migrate`：`contractEnd` 為 null 的藝人補上 `st.day + contractDays`

- [ ] **Step 1：寫失敗測試**

`core_check.js`：`require("../../static_src/starv_events_2.js");` 之後加 `require("../../static_src/starv_events_3.js");`

在「事件資料：40 種、格式正確」的 FX 陣列最後加上 `"renew", "retire", "retain"`。

插在 `// ==== run ====` 之前：

```js
test("合約：建立時 3 年、到期觸發續約、加薪／照常／拒絕", function () {
  var st = Core.create({ seed: 1 }), a = freshArtist(st, { salary: 2000, satisfaction: 90 });
  st.board = []; st.boardRefreshDay = 99999;
  eq(Core._genR(st).contractEnd, st.day + 1080, "新藝人");
  a.contractEnd = 5;
  Core.advance(st, 5);
  var e = st.events.pending.filter(function (x) { return x.id === "contract_renewal"; })[0];
  assert(e && e.aid === a.id && a.renewPending, "到期觸發");
  Core.advance(st, 1); eq(st.events.pending.filter(function (x) { return x.id === "contract_renewal"; }).length, 1, "不重複觸發");
  var r = Core.resolveEvent(st, e.uid, 0);
  assert(r.fx.renewed, "加薪續約"); eq(a.baseSalary, 2400); eq(a.contractEnd, 5 + 1080); eq(a.renewPending, false);
  var b = freshArtist(st, { satisfaction: 0 }); b.contractEnd = st.day;
  Core.advance(st, 1);
  e = st.events.pending.filter(function (x) { return x.aid === b.id; })[0];
  r = Core.resolveEvent(st, e.uid, 1);
  assert(r.fx.refused, "滿意度 0 一定拒絕"); eq(Core.artistById(st, b.id), null);
});

test("滿意度：每月依工作、壓力、心情漂移", function () {
  var st = Core.create({ seed: 1 });
  st.board = []; st.boardRefreshDay = 99999;
  var idle = freshArtist(st, { satisfaction: 50 }), busy = freshArtist(st, { satisfaction: 50, stress: 80, mood: 1 });
  busy.works.unshift({ title: [0, 0], dir: "singer", tier: "D", role: "support", result: "success", stars: 3, day: 20, isWork: false, pay: 1 });
  busy.stress = 80;
  Core.advance(st, 30);
  eq(idle.satisfaction, 48, "沒工作 −2");
  eq(busy.satisfaction, 50, "有工作 +2、壓力 −3、心情 +1");
});

test("存檔版本 4：補上合約到期日", function () {
  var st = Core.create({ seed: 1 }), a = freshArtist(st);
  delete a.contractEnd; st.version = 3;
  var m = Core.migrate(JSON.parse(JSON.stringify(st)));
  eq(m.version, 4); eq(m.artists[0].contractEnd, st.day + 1080);
});
```

在「存檔版本 3：舊存檔補上對手」測試中把 `eq(m.version, 3);` 改成 `eq(m.version, Core.VERSION);`，並在那行上方註解：`// 計畫 5 升到版本 4 後改成跟著 Core.VERSION（這個測試只關心對手有沒有補上）`。

- [ ] **Step 2：執行，確認失敗**

Run: `node tools/starv_check/core_check.js`
Expected: `Cannot find module '../../static_src/starv_events_3.js'`

- [ ] **Step 3：建立 `static_src/starv_events_3.js`**

```js
// 明星經紀 starV：重大事件 v3——生涯（續約、引退；規格 §11）。兩者都是條件觸發，由核心在合約到期、引退判定時推出。
// renew / retire / retain 是生涯專用的 fx，效果依藝人當下的滿意度決定（見 starv_core.js 的 applyFx）。
(function () {
  "use strict";

  var root = typeof window !== "undefined" ? window : globalThis;
  var T = root.PriTestStarvData.T;

  function O(fx) { return { w: 1, fx: fx, bad: false }; }
  function C(label, hint, fx) { return { label: T(label), hint: T(hint), outcomes: [O(fx)] }; }
  function E(id, title, text, choices, defaultChoice) {
    return { id: id, addedIn: "v3", category: "special", target: "any", trigger: "cond", weight: 10,
      title: T(title), text: T(text), choices: choices, defaultChoice: defaultChoice };
  }

  root.PriTestStarvEvents.add([
    E("contract_renewal", "合約到期|契約満了", "{name} 的合約到期了，要怎麼談續約？|{name} の契約が満了した。更新の条件はどうする？", [
      C("加薪續約|昇給して更新", "月薪↑ 滿意度↑ 一定續約|月給↑ 満足度↑ 必ず更新", { renew: "raise" }),
      C("照常續約|通常の条件で更新", "月薪小幅↑ 滿意度低可能拒絕|月給やや↑ 満足度が低いと断られる", { renew: "standard" }),
      C("不續約|更新しない", "藝人離開|タレントが去る", { renew: "release" })
    ], 1),
    E("retire_offer", "引退的念頭|引退の申し出", "{name} 說最近在考慮引退。|{name} が引退を考えていると打ち明けた。", [
      C("尊重決定|本人の意思を尊重", "引退（評分夠高就進名人堂）|引退（評価が高ければ殿堂入り）", { retire: true }),
      C("加薪挽留|昇給して引き留める", "成功率看滿意度|成功率は満足度次第", { retain: "raise" }),
      C("給一個月長假|一か月の長期休暇", "成功率看滿意度|成功率は満足度次第", { retain: "rest" })
    ], 2)
  ]);
})();
```

（事件選項最多 3 個，所以挽留只提供「加薪」與「長假」兩種；規格的「保證主角」可以在之後的事件擴充中加入。）

- [ ] **Step 4：登記與資料常數**

`site_src/starv_page.py`：`"starv_events_2.js",` 之後加 `"starv_events_3.js",`；`tools/starv_check/sim.js`：`require("../../static_src/starv_events_2.js");` 之後加 `require("../../static_src/starv_events_3.js");`

`static_src/starv_data.js` 的 `BAL` 中 `logMax: 200, worksMax: 50` 之前加入：

```js
    contractDays: 1080, renewSatLine: 50, renewRaise: 0.2, renewStandard: 0.1, satWorked: 2, satIdle: -2, satStress: -3, satMood: 1,
```

- [ ] **Step 5：核心**

`static_src/starv_core.js`：
1. `var VERSION = 3;` → `var VERSION = 4;`
2. `ARTIST_DEFAULTS` 中 `trophies: [],` 之後加 `contractEnd: null, renewPending: false, worksTotal: 0, retireAskedUntil: 0,`
3. `baseArtist` 中 `a.joinedDay = st.day;` 之後加 `a.contractEnd = st.day + BAL.contractDays;`
4. `migrate` 中 `st.waitlist.forEach(function (w) { fillDefaults(w.artist, ARTIST_DEFAULTS); });` 之後加：

```js
    // version 3 → 4：合約（規格 §11）
    st.artists.concat(st.waitlist.map(function (w) { return w.artist; })).forEach(function (a) { if (a.contractEnd == null) a.contractEnd = st.day + BAL.contractDays; });
```

5. `resolveJob` 中 `if (a.works.length > BAL.worksMax) a.works.length = BAL.worksMax;` 之後加 `a.worksTotal++;`
6. `monthly` 中 `// 月薪隨人氣上升（規格 §5.2）` 那行之前加入：

```js
    // 滿意度漂移（規格 §11）：最近 30 天有沒有工作、壓力、心情
    st.artists.forEach(function (a) {
      var worked = a.works.some(function (w) { return w.day > st.day - BAL.daysPerMonth; });
      var d = worked ? BAL.satWorked : BAL.satIdle;
      if (a.stress > 70) d += BAL.satStress;
      if (a.mood >= 1) d += BAL.satMood;
      a.satisfaction = clamp(a.satisfaction + d, 0, 100);
    });
```

7. `applyFx` 中 `if (fx.leave) { … }` 那一行之後加入：

```js
      if (fx.renew) {
        var refuse = fx.renew === "release" ||
          (fx.renew === "standard" && rnd(st) < clamp((BAL.renewSatLine - a.satisfaction) / BAL.renewSatLine, 0, 1));
        a.renewPending = false;
        if (refuse) { removeArtist(st, a); out.refused = true; log(st, "left", leftInfo(a)); }
        else {
          a.baseSalary = Math.round(a.baseSalary * (1 + (fx.renew === "raise" ? BAL.renewRaise : BAL.renewStandard)) / 100) * 100;
          updateSalary(a);
          if (fx.renew === "raise") a.satisfaction = clamp(a.satisfaction + 10, 0, 100);
          a.contractEnd += BAL.contractDays;
          out.renewed = true;
        }
      }
```

8. 插在 `  // ==== exports ====` 之前（保留標記行）：

```js
  // ==== 合約（§11） ====
  function tickContracts(st) {
    st.artists.forEach(function (a) {
      if (a.contractEnd <= st.day && !a.renewPending) { a.renewPending = true; pushEvent(st, "contract_renewal", a.id); }
    });
  }
```

9. `advanceDay` 中 `tickEvents(st);` 之前加 `tickContracts(st);`

- [ ] **Step 6：執行，確認通過**

Run: `node tools/starv_check/core_check.js`
Expected: `全部 82 個通過`。若計畫 1–4 的測試失敗，逐一判斷是不是合約到期／滿意度漂移改變了結果：是的話依 CLAUDE.md §4.7 修正期望值並註解。

- [ ] **Step 7：commit**

```bash
for f in starv_events_3 starv_data starv_core; do node --check static_src/$f.js || exit 1; done
git add static_src/starv_events_3.js static_src/starv_data.js static_src/starv_core.js tools/starv_check/core_check.js site_src/starv_page.py tools/starv_check/sim.js
git commit -m "feat(starv): 合約與續約、滿意度漂移、存檔版本 4"
```

---

### Task 2：引退、挽留、名人堂、作品年表

**Files:**
- Modify: `static_src/starv_data.js`、`static_src/starv_core.js`、`tools/starv_check/core_check.js`

**Interfaces:**
- Produces:
  - `BAL`：`retireOldChance: 0.4`、`retireStressChance: 0.1`、`retireLowFameChance: 0.15`、`retireLowFame: 30`、`hofScore: 30`、`timelineMax: 300`
  - 每年 1/1（`yearly` 之後）：超過方向引退線 40%、壓力 ≥ 90 為 10%、入社 3 年以上而人氣 < 30 為 15% → 觸發 `retire_offer`（`retireAskedUntil > day` 的人跳過）
  - fx `retire: true` → 引退；`retain: "raise"|"rest"`：成功率＝滿意度 ÷ 100（`rest` 再 +0.1），成功時 `raise` 基本月薪 ×1.3、`rest` 休息 30 天＋壓力 −50，並設 `retireAskedUntil = day + 360`；失敗就引退。摘要 `out.retired`（名人堂摘要物件）或 `out.retained`
  - `Core.retireArtist(st, aid) → summary | null`（debug／測試用；也是事件內部使用的函式）
  - 名人堂摘要：`{ id:"h<n>", era, day, rosterId, nameSeed, gender, rarity, dir, age, years, works, best:{ title, dir, tier, stars }|null, trophies:[{award, year}], fame, look, score, hof }`；`score = 獎座 × 10 + 累計工作 × 0.5 + 人氣 ÷ 1000`，`≥ 30` 進名人堂
  - `st.hall`（只放 `hof: true` 的）、`st.retireQueue`（每次引退都放，UI 顯示後清掉）、`st.timeline[i] = { era, day, kind: "award"|"retire"|"hof"|"level"|"era", data }`（新的在前，最多 300）
  - 日誌 `retire { … summary 欄位 }`、`hof`
  - 年表在我方得獎（`holdAwards`）、引退、公司升到 Lv10 時寫入

- [ ] **Step 1：寫失敗測試**

```js
test("引退：超過引退線會提出、尊重決定進名人堂、挽留成功率看滿意度", function () {
  var st = Core.create({ seed: 3 });
  st.board = []; st.boardRefreshDay = 99999;
  var old = freshArtist(st, { age: 60, fame: 20000 });
  for (var i = 0; i < 4; i++) old.trophies.push({ award: "singer_f", year: 1 });
  old.worksTotal = 20; old.contractEnd = 99999;   // 避免 3 年後先因合約到期離開
  var tries = 0;
  while (!st.events.pending.some(function (x) { return x.id === "retire_offer"; }) && tries++ < 10) Core.advance(st, 360);
  var e = st.events.pending.filter(function (x) { return x.id === "retire_offer"; })[0];
  assert(e && e.aid === old.id, "提出引退");
  var r = Core.resolveEvent(st, e.uid, 0);
  assert(r.fx.retired && r.fx.retired.hof, "進名人堂");
  eq(Core.artistById(st, old.id), null); eq(st.hall.length, 1); eq(st.retireQueue.length, 1);
  assert(st.timeline.some(function (x) { return x.kind === "hof"; }), "年表");
  var keep = freshArtist(st, { satisfaction: 100, age: 70 });
  e = Core.triggerEvent(st, "retire_offer", keep.id);
  r = Core.resolveEvent(st, e.uid, 1);
  assert(r.fx.retained, "滿意度 100 一定挽留成功"); assert(keep.retireAskedUntil > st.day, "一年內不再問");
  var gone = freshArtist(st, { satisfaction: 0 });
  e = Core.triggerEvent(st, "retire_offer", gone.id);
  r = Core.resolveEvent(st, e.uid, 1);
  assert(r.fx.retired && !r.fx.retired.hof, "挽留失敗、評分不夠不進名人堂"); eq(st.hall.length, 1);
});

test("引退：retireArtist 摘要內容", function () {
  var st = Core.create({ seed: 1 }), a = freshArtist(st, { fame: 3000 });
  a.works.unshift({ title: [1, 2], dir: "singer", tier: "B", role: "lead", result: "great", stars: 5, day: 0, isWork: true, pay: 1 });
  a.worksTotal = 1;
  var s = Core.retireArtist(st, a.id);
  eq(s.best.tier, "B"); eq(s.works, 1); eq(s.dir, "singer"); eq(s.era, 1);
  eq(s.score, 0 + 0.5 + 3); eq(s.hof, false);
  eq(Core.retireArtist(st, "nope"), null);
});
```

- [ ] **Step 2：執行，確認失敗**

Run: `node tools/starv_check/core_check.js`
Expected: 2 個 FAIL

- [ ] **Step 3：實作**

`static_src/starv_data.js` 的 `BAL` 中 `contractDays: 1080, …` 之後加入：

```js
    retireOldChance: 0.4, retireStressChance: 0.1, retireLowFameChance: 0.15, retireLowFame: 30, hofScore: 30, timelineMax: 300,
```

`static_src/starv_core.js`：
1. `blankState` 中 `rivals: [], auditions: [], …` 那行之後加 `hall: [], retireQueue: [], timeline: [],`
2. 插在 `  // ==== exports ====` 之前：

```js
  // ==== 引退、名人堂、作品年表（§11、§14） ====
  function timeline(st, kind, data) {
    st.timeline.unshift({ era: st.era, day: st.day, kind: kind, data: data || {} });
    if (st.timeline.length > BAL.timelineMax) st.timeline.length = BAL.timelineMax;
  }

  function retireArtist(st, aid) {
    var a = artistById(st, aid);
    if (!a) return null;
    var best = null;
    a.works.forEach(function (w) { if (!best || workScore(w) > workScore(best)) best = w; });
    var s = {
      id: newId(st, "h"), era: st.era, day: st.day, rosterId: a.rosterId, nameSeed: a.nameSeed, gender: a.gender,
      rarity: a.rarity, dir: a.dir, age: a.age, years: Math.floor((st.day - a.joinedDay) / BAL.daysPerYear), works: a.worksTotal,
      best: best ? { title: best.title.slice(), dir: best.dir, tier: best.tier, stars: best.stars } : null,
      trophies: a.trophies.slice(), fame: a.fame, look: clone(a.look)
    };
    s.score = Math.round((s.trophies.length * 10 + s.works * 0.5 + s.fame / 1000) * 10) / 10;
    s.hof = s.score >= BAL.hofScore;
    removeArtist(st, a);
    st.retireQueue.push(s);
    log(st, "retire", { rosterId: s.rosterId, nameSeed: s.nameSeed, gender: s.gender, hof: s.hof, score: s.score });
    timeline(st, "retire", { hid: s.id, rosterId: s.rosterId, nameSeed: s.nameSeed, gender: s.gender });
    if (s.hof) {
      st.hall.push(s);
      log(st, "hof", { rosterId: s.rosterId, nameSeed: s.nameSeed, gender: s.gender });
      timeline(st, "hof", { hid: s.id, rosterId: s.rosterId, nameSeed: s.nameSeed, gender: s.gender });
    }
    return s;
  }

  function retireCheck(st) {
    st.artists.forEach(function (a) {
      if (a.retireAskedUntil > st.day) return;
      var p = 0;
      if (a.age > dirById(a.dir).retire) p = BAL.retireOldChance;
      else if (a.stress >= 90) p = BAL.retireStressChance;
      else if (st.day - a.joinedDay >= BAL.daysPerYear * 3 && a.fame < BAL.retireLowFame) p = BAL.retireLowFameChance;
      if (p && rnd(st) < p) { a.retireAskedUntil = st.day + BAL.daysPerYear; pushEvent(st, "retire_offer", a.id); }
    });
  }
```

3. `applyFx` 中 Task 1 加的 `if (fx.renew) { … }` 區塊之後加入：

```js
      if (fx.retire) out.retired = retireArtist(st, a.id);
      else if (fx.retain) {
        var p = a.satisfaction / 100 + (fx.retain === "rest" ? 0.1 : 0);
        if (rnd(st) < p) {
          if (fx.retain === "raise") { a.baseSalary = Math.round(a.baseSalary * 1.3 / 100) * 100; updateSalary(a); }
          else if (!a.task) { a.task = { kind: "rest", days: 30, left: 30, stamina: 0, stress: 0, forced: true }; a.stress = clamp(a.stress - 50, 0, 100); }
          a.retireAskedUntil = st.day + BAL.daysPerYear;
          out.retained = true;
        } else out.retired = retireArtist(st, a.id);
      }
```

（`retireArtist` 會把藝人從公司移除；`applyFx` 之後若還有使用 `a` 的程式碼，`a` 只是已移除的物件，不會影響 state。）

4. `advanceDay` 中 `if (st.day % BAL.daysPerYear === 0) { yearly(st); rivalYear(st); }` 改成：

```js
    if (st.day % BAL.daysPerYear === 0) { yearly(st); rivalYear(st); retireCheck(st); }
```

5. `holdAwards` 中 `if (isOurs(noms[win])) wins++;` 改成：

```js
      if (isOurs(noms[win])) { wins++; timeline(st, "award", { award: aw.id, year: year, nominee: noms[win] }); }
```

6. `addRep` 中 `log(st, "level_up", { lv: st.company.level });` 之後加 `if (st.company.level === 10) timeline(st, "level", { lv: 10 });`

7. exports 區塊加 `api.retireArtist = retireArtist;`

- [ ] **Step 4：執行，確認通過**

Run: `node tools/starv_check/core_check.js`
Expected: `全部 84 個通過`

- [ ] **Step 5：commit**

```bash
node --check static_src/starv_core.js && node --check static_src/starv_data.js
git add static_src/starv_core.js static_src/starv_data.js tools/starv_check/core_check.js
git commit -m "feat(starv): 引退與挽留、名人堂、作品年表"
```

---

### Task 3：導師與製作人

**Files:**
- Modify: `static_src/starv_data.js`、`static_src/starv_core.js`、`tools/starv_check/core_check.js`

**Interfaces:**
- Produces:
  - `BAL`：`staffSalaryBase: 10000`、`staffSalaryPerTrophy: 1000`、`staffBonusBase: 0.1`、`staffBonusPerTrophy: 0.02`、`staffBonusMax: 0.3`、`producerGreatShift: 0.1`
  - `st.staff[i] = { hofId, role: "mentor"|"producer", dir, salary }`
  - `Core.staffSlots(st) → floor(level / 2)`
  - `Core.hireStaff(st, hofId, role, dir) → null | "noHof"|"hired"|"slots"|"role"|"dir"`；`Core.fireStaff(st, hofId)`
  - `Core.staffBonus(hallEntry) → 0.1 + 獎座 × 0.02（上限 0.3）`
  - 導師：主方向＝導師方向的藝人，課程與訓練成長 ×(1 + 加成)
  - 製作人：工作方向＝製作人方向時，大成功門檻 −0.1，並以 `0.5 + 加成` 的機率評價 +1★（上限 5）
  - 每月薪水計入 `month_end` 的 `salary`
  - 名人堂跨紀元保留，所以新紀元也能聘

- [ ] **Step 1：寫失敗測試**

```js
test("導師與製作人：名額、加成、月薪", function () {
  var st = Core.create({ seed: 1 });
  st.board = []; st.boardRefreshDay = 99999;
  var h = { id: "h900", era: 1, trophies: [{ award: "x", year: 1 }, { award: "y", year: 1 }], hof: true, dir: "singer", rosterId: null, nameSeed: 1, gender: "f" };
  st.hall.push(h);
  eq(Core.staffSlots(st), 0); eq(Core.hireStaff(st, "h900", "mentor", "singer"), "slots");
  st.company.level = 4; eq(Core.staffSlots(st), 2);
  eq(Core.hireStaff(st, "nope", "mentor", "singer"), "noHof"); eq(Core.hireStaff(st, "h900", "boss", "singer"), "role"); eq(Core.hireStaff(st, "h900", "mentor", "xx"), "dir");
  eq(Core.hireStaff(st, "h900", "mentor", "singer"), null); eq(Core.hireStaff(st, "h900", "producer", "film"), "hired");
  assert(Math.abs(Core.staffBonus(h) - 0.14) < 1e-9, "加成 0.1 + 2 × 0.02");
  var a = freshArtist(st), b = freshArtist(st);
  b.dir = "film";
  Core.schedule(st, a.id, { kind: "course", courseId: "vocal_1" }); Core.schedule(st, b.id, { kind: "course", courseId: "vocal_1" });
  Core.advance(st, 3);
  assert(a.stats.vocal > b.stats.vocal, "有導師的成長較多");
  var m0 = st.company.money; Core.advance(st, 27);
  var me = st.log.filter(function (e) { return e.type === "month_end"; }).pop();
  assert(me.data.salary >= 12000, "月薪含導師 10000 + 2 × 1000");
  Core.fireStaff(st, "h900"); eq(st.staff.length, 0);
});

test("製作人：大成功門檻下修、評價提高", function () {
  function avgStars(withProducer) {
    var st = Core.create({ seed: 5 }), total = 0;
    st.board = []; st.boardRefreshDay = 99999; st.company.level = 4;
    st.hall.push({ id: "h1", era: 1, trophies: [], hof: true, dir: "singer", rosterId: null, nameSeed: 1, gender: "f" });
    if (withProducer) Core.hireStaff(st, "h1", "producer", "singer");
    for (var i = 0; i < 60; i++) {
      var a = freshArtist(st); D.STATS.forEach(function (s) { a.stats[s] = 60; });   // 以成功為主，評價 +1★ 不容易被 5★ 上限吃掉
      var j = soloJob(st); Core.takeJob(st, j.id, [a.id]);
    }
    Core.advance(st, 2);
    st.log.forEach(function (e) { if (e.type === "job_done") total += e.data.stars; });
    return total / 60;
  }
  var base = avgStars(false), prod = avgStars(true);
  assert(prod > base + 0.3, "製作人讓平均評價提高 " + base + " → " + prod);
});
```

- [ ] **Step 2：執行，確認失敗**

Run: `node tools/starv_check/core_check.js`
Expected: 2 個 FAIL

- [ ] **Step 3：實作**

`static_src/starv_data.js` 的 `BAL` 中 `retireOldChance: …` 那行之後加入：

```js
    staffSalaryBase: 10000, staffSalaryPerTrophy: 1000, staffBonusBase: 0.1, staffBonusPerTrophy: 0.02, staffBonusMax: 0.3, producerGreatShift: 0.1,
```

`static_src/starv_core.js`：
1. `blankState` 中 `hall: [], retireQueue: [], timeline: [],` 之後加 `staff: [],`
2. 插在 `  // ==== exports ====` 之前：

```js
  // ==== 導師與製作人（§11） ====
  function hallById(st, id) {
    for (var i = 0; i < st.hall.length; i++) if (st.hall[i].id === id) return st.hall[i];
    return null;
  }
  function staffSlots(st) { return Math.floor(st.company.level / 2); }
  function staffBonus(h) { return Math.min(BAL.staffBonusMax, BAL.staffBonusBase + h.trophies.length * BAL.staffBonusPerTrophy); }
  function hireStaff(st, hofId, role, dir) {
    var h = hallById(st, hofId);
    if (!h) return "noHof";
    if (st.staff.some(function (s) { return s.hofId === hofId; })) return "hired";
    if (role !== "mentor" && role !== "producer") return "role";
    if (!dirById(dir)) return "dir";
    if (st.staff.length >= staffSlots(st)) return "slots";
    st.staff.push({ hofId: hofId, role: role, dir: dir, salary: BAL.staffSalaryBase + h.trophies.length * BAL.staffSalaryPerTrophy });
    log(st, "staff_hired", { hofId: hofId, role: role, dir: dir });
    return null;
  }
  function fireStaff(st, hofId) { st.staff = st.staff.filter(function (s) { return s.hofId !== hofId; }); }
  function staffFor(st, role, dir) {
    var best = 0;
    st.staff.forEach(function (s) {
      if (s.role !== role || s.dir !== dir) return;
      var h = hallById(st, s.hofId);
      if (h) best = Math.max(best, staffBonus(h));
    });
    return best;
  }
```

3. `growStat` 中 `var g = base * m * Math.sqrt((cap - cur) / cap);` 之前加入：

```js
    m *= 1 + staffFor(st, "mentor", a.dir);   // 導師（§11）：主方向相同的藝人成長加成
```

4. `resolveJob` 中把

```js
    var res = ratio >= D.RESULTS.great.min - shift ? "great" : ratio >= D.RESULTS.success.min ? "success" :
```

之前加入：

```js
    var prod = staffFor(st, "producer", job.dir);   // 製作人（§11）：大成功門檻下修、評價提高
    if (prod) shift += BAL.producerGreatShift;
```

並把 `var stars = rint(st, R.stars[0], R.stars[1]);` 換成：

```js
    var stars = rint(st, R.stars[0], R.stars[1]);
    if (prod && rnd(st) < 0.5 + prod) stars = Math.min(5, stars + 1);
```

5. `monthly` 中 `st.artists.forEach(function (a) { updateSalary(a); salary += a.salary; });` 之後加：

```js
    st.staff.forEach(function (s) { salary += s.salary; });
```

6. exports 區塊加入：

```js
  api.staffSlots = staffSlots;
  api.staffBonus = staffBonus;
  api.hireStaff = hireStaff;
  api.fireStaff = fireStaff;
```

- [ ] **Step 4：執行，確認通過**

Run: `node tools/starv_check/core_check.js`
Expected: `全部 86 個通過`

- [ ] **Step 5：commit**

```bash
node --check static_src/starv_core.js && node --check static_src/starv_data.js
git add static_src/starv_core.js static_src/starv_data.js tools/starv_check/core_check.js
git commit -m "feat(starv): 名人堂藝人轉任導師與製作人"
```

---

### Task 4：成就、圖鑑與 SSR 小故事

**Files:**
- Create: `static_src/starv_achievements.js`、`static_src/starv_achievements_1.js`
- Modify: `static_src/starv_core.js`、`static_src/starv_roster_1.js`、`tools/starv_check/core_check.js`、`site_src/starv_page.py`、`tools/starv_check/sim.js`

**Interfaces:**
- Produces:
  - `PriTestStarvAchievements.add(list)`、`.all()`、`.byId(id)`；同步 `D.ACHIEVEMENTS`、`D.ACHIEVEMENT_BY_ID`
  - 成就格式：`{ id, addedIn, name:{zh,ja}, desc:{zh,ja}, cond: { type, n }, reward: { tickets } }`
  - `cond.type`：`pulls`、`ssr`、`codexRate`（0～1）、`level`、`artists`、`money`、`jobs`、`greatS`、`chartTops`、`trophies`、`hof`、`groupJobs`、`era`
  - `st.achievements[id] = { day, era }`；每天檢查一次未解鎖的成就，解鎖時加星探券、日誌 `achievement { id }`
  - `st.stats` 新增 `greatS`（S 級大成功次數）、`chartTops`（我方第 1 名次數）、`trophies`（我方獲獎數）
  - `Core.codexStats(st) → { sr, srTotal, ssr, ssrTotal, r }`（不含宿敵明星）
  - SSR 名錄項目新增 `story:{zh,ja}`；SSR 藝人第一次得獎時 `st.codex.stories[rosterId] = true`（日誌 `story_unlocked`）

- [ ] **Step 1：寫失敗測試**

`core_check.js` 的 require 區（`starv_awards_data.js` 之後）加入：

```js
require("../../static_src/starv_achievements.js");
require("../../static_src/starv_achievements_1.js");
var Ach = global.PriTestStarvAchievements;
```

插在 `// ==== run ====` 之前：

```js
test("成就：20 項、格式、解鎖給券", function () {
  var TYPES = ["pulls", "ssr", "codexRate", "level", "artists", "money", "jobs", "greatS", "chartTops", "trophies", "hof", "groupJobs", "era"];
  eq(Ach.all().filter(function (x) { return x.addedIn === "v1"; }).length, 20);
  Ach.all().forEach(function (x) {
    assert(x.name.zh && x.name.ja && x.desc.zh && x.desc.ja, x.id + " 文字");
    assert(TYPES.indexOf(x.cond.type) >= 0, x.id + " cond");
    eq(D.ACHIEVEMENT_BY_ID[x.id], x);
  });
  var threw = false; try { Ach.add([Ach.byId("first_pull")]); } catch (e) { threw = true; } assert(threw, "重複 ID");
  var st = Core.create({ seed: 1 }), t0 = st.company.tickets;
  st.board = []; st.boardRefreshDay = 99999;
  Core.pull(st, "ticket", 10);
  Core.advance(st, 1);
  assert(st.achievements.first_pull, "抽 10 次"); assert(st.company.tickets > t0 - 10, "獎勵星探券");
  assert(st.log.some(function (e) { return e.type === "achievement" && e.data.id === "first_pull"; }), "日誌");
});

test("圖鑑：統計與 SSR 小故事", function () {
  var st = Core.create({ seed: 1 });
  st.board = []; st.boardRefreshDay = 99999;
  Core._grantEntry(st, Roster.byId("ssr001")); Core._grantEntry(st, Roster.byId("sr001"));
  var c = Core.codexStats(st);
  eq(c.ssr, 1); eq(c.ssrTotal, Roster.byRarity("SSR").length); eq(c.sr, 1); eq(c.srTotal, Roster.byRarity("SR").length);
  Roster.byRarity("SSR").forEach(function (e) { assert(e.story && e.story.zh && e.story.ja, e.id + " 小故事"); });
  var a = st.artists.filter(function (x) { return x.rosterId === "ssr001"; })[0];
  a.fame = 50000;
  for (var i = 0; i < 3; i++) a.works.unshift({ title: [0, i], dir: "idol", tier: "S", role: "lead", result: "great", stars: 5, day: 300, isWork: true, pay: 1 });
  st.day = 359; Core.holdAwards(st);
  if (a.trophies.length) assert(st.codex.stories.ssr001, "得獎解鎖小故事");
  else assert(!st.codex.stories.ssr001, "沒得獎不解鎖");
});
```

- [ ] **Step 2：執行，確認失敗**

Run: `node tools/starv_check/core_check.js`
Expected: `Cannot find module '../../static_src/starv_achievements.js'`

- [ ] **Step 3：建立 `static_src/starv_achievements.js`**

```js
// 明星經紀 starV：成就登記器（規格 §14）。成就之後會擴充（計畫 9 到 60 項、之後更多）：
// 資料分檔（starv_achievements_1.js、_2.js …）各自 add()；ID 永不重用。判定由核心依 cond.type 分派，資料不寫邏輯。
(function () {
  "use strict";

  var root = typeof window !== "undefined" ? window : globalThis;
  var D = root.PriTestStarvData;
  var list = [];
  var map = {};

  function add(items) {
    items.forEach(function (x) {
      if (map[x.id]) throw new Error("starV achievements: 重複的 ID " + x.id);
      map[x.id] = x;
      list.push(x);
    });
  }

  D.ACHIEVEMENTS = list;
  D.ACHIEVEMENT_BY_ID = map;
  root.PriTestStarvAchievements = {
    add: add,
    all: function () { return list.slice(); },
    byId: function (id) { return map[id] || null; }
  };
})();
```

- [ ] **Step 4：建立 `static_src/starv_achievements_1.js`**

```js
// 明星經紀 starV：成就 v1（20 項）。cond.type 見 starv_core.js 的 ACH_CHECKS。
(function () {
  "use strict";

  var root = typeof window !== "undefined" ? window : globalThis;
  var T = root.PriTestStarvData.T;

  function A(id, name, desc, type, n, tickets) {
    return { id: id, addedIn: "v1", name: T(name), desc: T(desc), cond: { type: type, n: n }, reward: { tickets: tickets } };
  }

  root.PriTestStarvAchievements.add([
    A("first_pull", "星探出動|スカウト始動", "累計招募 10 次|累計 10 回スカウト", "pulls", 10, 2),
    A("pulls_100", "百人面試官|百人面接官", "累計招募 100 次|累計 100 回スカウト", "pulls", 100, 5),
    A("first_ssr", "命運的相遇|運命の出会い", "第一次招募到 SSR|初めて SSR をスカウト", "ssr", 1, 5),
    A("codex_half", "星光收藏家|スターコレクター", "SR／SSR 圖鑑收集一半|SR／SSR 図鑑を半分収集", "codexRate", 0.5, 10),
    A("level_3", "小有名氣|ちょっと有名", "公司升到 Lv3|事務所 Lv3 到達", "level", 3, 3),
    A("level_6", "業界中堅|業界の中堅", "公司升到 Lv6|事務所 Lv6 到達", "level", 6, 6),
    A("level_10", "頂尖經紀公司|トップ事務所", "公司升到 Lv10|事務所 Lv10 到達", "level", 10, 10),
    A("artists_20", "大家庭|大家族", "旗下藝人達到 20 人|所属タレント 20 人", "artists", 20, 3),
    A("artists_100", "百星齊聚|百花繚乱", "旗下藝人達到 100 人|所属タレント 100 人", "artists", 100, 10),
    A("money_1m", "百萬富翁|百万長者", "資金達到 100 萬|資金 100 万到達", "money", 1000000, 5),
    A("jobs_100", "勤勉經紀|勤勉なマネジメント", "累計完成 100 件工作|累計 100 件の仕事", "jobs", 100, 3),
    A("jobs_1000", "千錘百鍊|千錘百錬", "累計完成 1,000 件工作|累計 1,000 件の仕事", "jobs", 1000, 8),
    A("great_s", "巨星的證明|大スターの証", "S 級工作大成功|S ランクの仕事で大成功", "greatS", 1, 8),
    A("chart_top", "排行榜冠軍|チャート 1 位", "第一次拿下排行榜第 1 名|初めてランキング 1 位", "chartTops", 1, 3),
    A("chart_top_12", "常勝軍|常勝軍団", "累計拿下排行榜第 1 名 12 次|ランキング 1 位を累計 12 回", "chartTops", 12, 8),
    A("first_trophy", "第一座獎座|初めてのトロフィー", "第一次在頒獎典禮得獎|授賞式で初受賞", "trophies", 1, 5),
    A("trophies_50", "獎座牆|トロフィーの壁", "累計得獎 50 座|累計 50 冠", "trophies", 50, 10),
    A("hof_1", "傳說的開始|伝説の始まり", "第一位藝人進入名人堂|初めての殿堂入り", "hof", 1, 5),
    A("group_100", "最佳拍檔|最高の相棒", "一個組合合作 100 次|一つのユニットで共演 100 回", "groupJobs", 100, 5),
    A("era_2", "新紀元|新時代", "開創第 2 紀元|第 2 紀元を開く", "era", 2, 10)
  ]);
})();
```

- [ ] **Step 5：SSR 小故事**

`static_src/starv_roster_1.js`：在 `ssr001` 的 `bio: T(…)` 之後加入：

```js
      ,
      story: T("詩織第一次站上巨蛋那天，台下的螢光棒海裡，有一支是商店街的老闆舉著的。十年前他把冠軍獎盃遞給她時說：『等妳唱到巨蛋，我一定去。』她在安可時唱了那首比賽時的歌，聲音只顫抖了一下。|詩織が初めてドームに立った日、客席のペンライトの海に、商店街の店主が振る一本があった。十年前、優勝トロフィーを渡しながら彼は言った。『ドームで歌う日が来たら、必ず行く』。アンコールで彼女はあの大会の曲を歌った。声が震えたのは一度だけだった。")
```

在 `ssr002` 的 `bio: T(…)` 之後加入：

```js
      ,
      story: T("領獎那晚，記者問蓮：「哪一張臉才是真正的你？」他想了很久，說：「今天站在這裡、手在發抖的這張吧。」那是他出道以來，第一次在鏡頭前沒有演任何人。|授賞式の夜、記者が蓮に聞いた。「どの顔が本当のあなたですか」。彼は長く考えてから答えた。「今日ここに立って、手が震えているこの顔でしょう」。デビュー以来初めて、カメラの前で誰も演じなかった瞬間だった。")
```

（兩處都是在 `bio: T("…")` 的右括號之後、物件的 `}` 之前，以逗號開頭加上新欄位。）

- [ ] **Step 6：核心**

`static_src/starv_core.js`：
1. `blankState` 中 `stats: { pulls: 0, jobsDone: 0 },` 改成 `stats: { pulls: 0, jobsDone: 0, greatS: 0, chartTops: 0, trophies: 0 },`；`codex: { owned: {}, recruitedR: 0 },` 改成 `codex: { owned: {}, recruitedR: 0, stories: {} },`；`staff: [],` 之後加 `achievements: {},`
2. `resolveJob` 中 `st.stats.jobsDone++;` 之後加 `if (res === "great" && job.tier === "S") st.stats.greatS++;`
3. `updateCharts` 中 `log(st, "chart_top", { chart: c.id, aid: top.aid });` 之後加 `st.stats.chartTops++;`
4. `awardPrize` 中 `if (won && isOurs(n)) {` 區塊內第一行加 `st.stats.trophies++;`；並在 `if (won) { a.trophies.push({ award: aw.id, year: year }); a.satisfaction = clamp(a.satisfaction + 10, 0, 100); }` 之後加入：

```js
        if (won && a.rarity === "SSR" && a.rosterId && !st.codex.stories[a.rosterId]) {
          st.codex.stories[a.rosterId] = true;
          log(st, "story_unlocked", { rosterId: a.rosterId });
        }
```

5. 插在 `  // ==== exports ====` 之前：

```js
  // ==== 圖鑑與成就（§14） ====
  function codexStats(st) {
    var c = { sr: 0, ssr: 0, srTotal: Roster.byRarity("SR").length, ssrTotal: Roster.byRarity("SSR").length, r: st.codex.recruitedR };
    Object.keys(st.codex.owned).forEach(function (id) {
      var e = Roster.byId(id);
      if (!e || e.kind === "rival") return;
      if (e.rarity === "SR") c.sr++; else if (e.rarity === "SSR") c.ssr++;
    });
    return c;
  }
  var ACH_CHECKS = {
    pulls: function (st) { return st.stats.pulls; },
    ssr: function (st) { return codexStats(st).ssr; },
    codexRate: function (st) { var c = codexStats(st); return (c.sr + c.ssr) / Math.max(1, c.srTotal + c.ssrTotal); },
    level: function (st) { return st.company.level; },
    artists: function (st) { return st.artists.length; },
    money: function (st) { return st.company.money; },
    jobs: function (st) { return st.stats.jobsDone; },
    greatS: function (st) { return st.stats.greatS; },
    chartTops: function (st) { return st.stats.chartTops; },
    trophies: function (st) { return st.stats.trophies; },
    hof: function (st) { return st.hall.length; },
    groupJobs: function (st) { return st.groups.reduce(function (m, g) { return Math.max(m, g.jobs); }, 0); },
    era: function (st) { return st.era; }
  };
  function checkAchievements(st) {
    (D.ACHIEVEMENTS || []).forEach(function (x) {
      if (st.achievements[x.id]) return;
      var f = ACH_CHECKS[x.cond.type];
      if (!f || f(st) < x.cond.n) return;
      st.achievements[x.id] = { day: st.day, era: st.era };
      st.company.tickets += x.reward.tickets || 0;
      log(st, "achievement", { id: x.id });
    });
  }
```

6. `advanceDay` 最後（`autoPlan(st);` 之後）加 `checkAchievements(st);`
7. exports 區塊加 `api.codexStats = codexStats;`

`site_src/starv_page.py`：`"starv_awards_data.js",` 之後加 `"starv_achievements.js",`、`"starv_achievements_1.js",`；`tools/starv_check/sim.js`：`require("../../static_src/starv_awards_data.js");` 之後加：

```js
require("../../static_src/starv_achievements.js");
require("../../static_src/starv_achievements_1.js");
```

- [ ] **Step 7：執行，確認通過**

Run: `node tools/starv_check/core_check.js`
Expected: `全部 88 個通過`

- [ ] **Step 8：commit**

```bash
for f in starv_achievements starv_achievements_1 starv_roster_1 starv_core; do node --check static_src/$f.js || exit 1; done
git add static_src/starv_achievements.js static_src/starv_achievements_1.js static_src/starv_roster_1.js static_src/starv_core.js tools/starv_check/core_check.js site_src/starv_page.py tools/starv_check/sim.js
git commit -m "feat(starv): 成就登記器與 20 項成就、圖鑑統計、SSR 小故事"
```

---

### Task 5：新紀元與傳承加成

**Files:**
- Modify: `static_src/starv_data.js`、`static_src/starv_core.js`、`tools/starv_check/core_check.js`

**Interfaces:**
- Produces:
  - `D.LEGACY_PERKS = [{ id, name, desc, max, cost }]`（`cost` 為各等級的價格陣列）：`money`（初始資金 +5 萬／級，最高 5）、`tickets`（初始星探券 +5／級，最高 4）、`dorm`（初始宿舍 +1 級，最高 3）、`growth`（成長 +5%／級，最高 5，立即生效）、`pity`（保底 −10 抽／級，最高 5，立即生效；最低 100）、`rival`（新紀元對手起始實力 −8%／級，最高 3）
  - `BAL`：`eraRivalBoost: 0.1`、`legacyHof: 5`、`carryStatMult: 0.7`
  - `st.legacy = { points, perks: { <id>: 等級 } }`、`st.eraStartAt`（新紀元開始的現實時間，UI 用）
  - `Core.legacyPoints(st)`＝本紀元名人堂人數 × 5 ＋ 本紀元獲獎數 ＋ 本紀元排行榜第 1 名次數
  - `Core.buyPerk(st, id) → null | "noPerk"|"max"|"points"`
  - `Core.newEra(st, carryAid?) → null | "level"|"noArtist"`：公司 Lv10 才能發動；`st` 就地換成新紀元：`era + 1`、`day = 0`；保留 `hall`、`codex`、`achievements`、`legacy`（加上本紀元的傳承點）、`timeline`、`company.name`、`seed`、`lastTickAt`、`nextId`、`logSeq`；套用 money／tickets／dorm 加成；對手起始實力 ×(1 + 0.1 ×(era − 1)) ×(1 − 0.08 × rival 等級)，且實力回歸目標同樣乘上紀元倍率；帶走的藝人能力 ×0.7、行程清空、合約重新 3 年、保留獎座；寫入年表 `era` 與日誌 `new_era`
  - `pityMax(st)`＝150 − 10 × pity 等級（最低 100）；`growStat` 乘上 `1 + 0.05 × growth 等級`

- [ ] **Step 1：寫失敗測試**

```js
test("新紀元：條件、保留與重置、帶走藝人、傳承點", function () {
  var st = Core.create({ seed: 1, name: "星光" });
  st.board = []; st.boardRefreshDay = 99999;
  var a = freshArtist(st, { fame: 5000 });
  a.stats.vocal = 300; a.trophies.push({ award: "singer_f", year: 1 });
  freshArtist(st);
  st.hall.push({ id: "h1", era: 1, trophies: [], hof: true, dir: "film", rosterId: null, nameSeed: 1, gender: "m" });
  st.achievements.first_pull = { day: 1, era: 1 }; st.codex.owned.sr001 = true;
  st.stats.trophies = 3; st.stats.chartTops = 2;
  eq(Core.newEra(st), "level");
  st.company.level = 10; st.company.money = 9e9; st.facilities.dorm = 8; st.day = 999;
  eq(Core.legacyPoints(st), 5 + 3 + 2);
  eq(Core.newEra(st, "nope"), "noArtist");
  eq(Core.newEra(st, a.id), null);
  eq(st.era, 2); eq(st.day, 0); eq(st.company.level, 1); eq(st.company.money, 50000); eq(st.facilities.dorm, 1);
  eq(st.company.name, "星光"); eq(st.hall.length, 1); assert(st.achievements.first_pull && st.codex.owned.sr001, "保留成就與圖鑑");
  eq(st.legacy.points, 10); eq(st.artists.length, 1, "只帶走一人");
  var c = st.artists[0];
  eq(c.stats.vocal, 210, "能力 ×0.7"); eq(c.trophies.length, 1); eq(c.task, null); eq(c.contractEnd, 1080);
  eq(st.rivals.length, 5); assert(st.timeline.some(function (x) { return x.kind === "era"; }), "年表");
  eq(st.stats.trophies, 0, "本紀元統計重新起算");
});

test("傳承加成：購買、上限、效果", function () {
  var st = Core.create({ seed: 2 });
  st.legacy.points = 100;
  eq(Core.buyPerk(st, "nope"), "noPerk");
  for (var i = 0; i < 5; i++) eq(Core.buyPerk(st, "pity"), null);
  eq(Core.buyPerk(st, "pity"), "max");
  eq(Core.pityLeft(st), 100, "保底 150 − 50");
  st.legacy.points = 0; eq(Core.buyPerk(st, "money"), "points");
  st.legacy.points = 100; Core.buyPerk(st, "money"); Core.buyPerk(st, "dorm"); Core.buyPerk(st, "tickets");
  st.company.level = 10;
  Core.newEra(st);
  eq(st.company.money, 100000); eq(st.facilities.dorm, 2); eq(st.company.tickets, 15);
  var avg = st.rivals.reduce(function (s, r) { return s + r.power; }, 0) / 5;
  assert(avg >= 80 * 1.1 && avg <= 140 * 1.1, "第 2 紀元對手 ×1.1：" + avg);
});
```

- [ ] **Step 2：執行，確認失敗**

Run: `node tools/starv_check/core_check.js`
Expected: 2 個 FAIL

- [ ] **Step 3：實作**

`static_src/starv_data.js`：在 `var RIVAL_NAME = …;` 區塊之後加入：

```js
  // 傳承加成（§13）：cost[lv]＝從 lv 升到 lv+1 的傳承點
  function perk(id, name, desc, max, cost) { return { id: id, name: T(name), desc: T(desc), max: max, cost: cost }; }
  var LEGACY_PERKS = [
    perk("money", "創業資金|創業資金", "新紀元的初始資金 +5 萬／級|新紀元の初期資金 +5 万／Lv", 5, [3, 4, 5, 6, 8]),
    perk("tickets", "星探人脈|スカウトの人脈", "新紀元的初始星探券 +5／級|新紀元の初期スカウト券 +5／Lv", 4, [3, 4, 6, 8]),
    perk("dorm", "祖傳宿舍|受け継いだ寮", "新紀元的初始宿舍 +1 級|新紀元の初期寮 +1 Lv", 3, [5, 8, 12]),
    perk("growth", "名門教育|名門の指導", "所有藝人成長 +5%／級（立即生效）|全タレントの成長 +5%／Lv（即時）", 5, [4, 6, 8, 10, 12]),
    perk("pity", "星探的直覺|スカウトの勘", "SSR 保底 −10 抽／級（立即生效，最低 100）|SSR 確定 −10 回／Lv（即時、最低 100）", 5, [4, 6, 8, 10, 12]),
    perk("rival", "業界地位|業界での地位", "新紀元的對手起始實力 −8%／級|新紀元のライバル初期勢力 −8%／Lv", 3, [5, 8, 12])
  ];
```

`root.PriTestStarvData = { … }` 中 `RIVAL_NAME: RIVAL_NAME,` 之後加 `LEGACY_PERKS: LEGACY_PERKS, LEGACY_PERK_BY_ID: index(LEGACY_PERKS),`

`BAL` 中 `staffSalaryBase: …` 那行之後加入：

```js
    eraRivalBoost: 0.1, legacyHof: 5, carryStatMult: 0.7,
```

`static_src/starv_core.js`：
1. `blankState` 中 `achievements: {},` 之後加 `legacy: { points: 0, perks: {} },`
2. `pityMax` 函式換成：

```js
  function perkLv(st, id) { return (st.legacy && st.legacy.perks[id]) || 0; }
  function pityMax(st) { return Math.max(100, BAL.pityMax - 10 * perkLv(st, "pity")); }   // 傳承加成（§13）
```

3. `growStat` 中 Task 3 加的 `m *= 1 + staffFor(st, "mentor", a.dir);` 之後加 `m *= 1 + 0.05 * perkLv(st, "growth");`
4. 把 `newRival` 中 `power: rint(st, range[0], range[1])` 換成 `power: Math.round(rint(st, range[0], range[1]) * eraRivalMult(st) * (1 - 0.08 * perkLv(st, "rival")))`
5. `rivalYear` 中 `r.power += (BAL.rivalPowerTarget - r.power) * BAL.rivalRevert;` 換成 `r.power += (BAL.rivalPowerTarget * eraRivalMult(st) - r.power) * BAL.rivalRevert;`
6. 插在 `  // ==== exports ====` 之前：

```js
  // ==== 新紀元與傳承加成（§13） ====
  function eraRivalMult(st) { return 1 + BAL.eraRivalBoost * ((st.era || 1) - 1); }
  function legacyPoints(st) {
    var hofThisEra = st.hall.filter(function (h) { return h.era === st.era; }).length;
    return hofThisEra * BAL.legacyHof + st.stats.trophies + st.stats.chartTops;
  }
  function buyPerk(st, id) {
    var p = D.LEGACY_PERK_BY_ID[id];
    if (!p) return "noPerk";
    var lv = perkLv(st, id);
    if (lv >= p.max) return "max";
    if (st.legacy.points < p.cost[lv]) return "points";
    st.legacy.points -= p.cost[lv];
    st.legacy.perks[id] = lv + 1;
    return null;
  }

  function newEra(st, carryAid) {
    if (st.company.level < 10) return "level";
    var carry = null;
    if (carryAid) { carry = artistById(st, carryAid); if (!carry) return "noArtist"; }
    var keep = {
      hall: st.hall, codex: st.codex, achievements: st.achievements, timeline: st.timeline,
      legacy: { points: st.legacy.points + legacyPoints(st), perks: st.legacy.perks },
      era: st.era + 1, seed: st.seed, lastTickAt: st.lastTickAt, nextId: st.nextId, logSeq: st.logSeq, name: st.company.name
    };
    var fresh = blankState({ seed: keep.seed, now: keep.lastTickAt, name: keep.name });
    Object.keys(st).forEach(function (k) { delete st[k]; });
    Object.keys(fresh).forEach(function (k) { st[k] = fresh[k]; });
    ["hall", "codex", "achievements", "timeline", "legacy", "era", "nextId", "logSeq"].forEach(function (k) { st[k] = keep[k]; });
    st.company.money += 50000 * perkLv(st, "money");
    st.company.tickets += 5 * perkLv(st, "tickets");
    st.facilities.dorm += perkLv(st, "dorm");
    rotatePickup(st);
    initTrend(st);
    initRivals(st);
    refreshBoard(st);
    if (carry) {
      D.STATS.forEach(function (s) { carry.stats[s] = Math.round(carry.stats[s] * BAL.carryStatMult * 10) / 10; });
      carry.task = null; carry.policy = "idle"; carry.joinedDay = 0; carry.contractEnd = BAL.contractDays;
      carry.renewPending = false; carry.retireAskedUntil = 0; carry.works = [];
      st.artists.push(carry);
    }
    timeline(st, "era", { era: st.era, carry: carry ? { rosterId: carry.rosterId, nameSeed: carry.nameSeed, gender: carry.gender } : null });
    log(st, "new_era", { era: st.era });
    return null;
  }
```

7. exports 區塊加入：

```js
  api.legacyPoints = legacyPoints;
  api.buyPerk = buyPerk;
  api.newEra = newEra;
```

8. `migrate` 中 `st.version = VERSION;` 之前加：

```js
    if (!st.legacy) st.legacy = { points: 0, perks: {} };
```

（`fillDefaults` 已會補上；這行是保險，避免舊存檔的 `legacy` 為 null 時 `perkLv` 出錯。）

- [ ] **Step 4：執行，確認通過**

Run: `node tools/starv_check/core_check.js`
Expected: `全部 90 個通過`

- [ ] **Step 5：commit**

```bash
node --check static_src/starv_core.js && node --check static_src/starv_data.js
git add static_src/starv_core.js static_src/starv_data.js tools/starv_check/core_check.js
git commit -m "feat(starv): 新紀元與傳承加成"
```

---

### Task 6：模擬——引退、名人堂、新紀元

**Files:**
- Modify: `tools/starv_check/sim.js`（必要時 `static_src/starv_data.js`）

**Interfaces:**
- Produces: 表格加上 `hof`（名人堂人數）、`ret`（累計引退數，日誌 `retire` 不受 log 上限影響：改用 `st.timeline` 的 `retire` 計數）；積極經營情境在公司 Lv10 後的第一個 1/1 發動新紀元（帶走能力合計最高的藝人），之後照常經營；WARN：「積極經營 30 年沒有人進名人堂」、「積極經營 30 年沒有進入第 2 紀元」；不變量：`st.era >= 1`、名人堂項目都有 `score`

- [ ] **Step 1：修改 sim.js**

在 `runScenario` 的 `for (var day = 1; …)` 迴圈中，`if (name === "active") activeAssign(st);` 之後加入：

```js
    if (name === "active" && st.company.level >= 10 && st.day % 360 === 0 && st.era === 1) {
      var bestA = null;
      st.artists.forEach(function (a) { var s = 0; D.STATS.forEach(function (k) { s += a.stats[k]; }); if (!bestA || s > bestA.s) bestA = { a: a, s: s }; });
      Core.newEra(st, bestA ? bestA.a.id : null);
    }
```

`checkState` 最後加：

```js
  if (!(st.era >= 1)) fail(tag + " era 異常");
  st.hall.forEach(function (h) { if (typeof h.score !== "number") fail(tag + " 名人堂缺 score"); });
```

`rows.push({ … })` 中加入 `era: st.era, hof: st.hall.length, ret: st.timeline.filter(function (x) { return x.kind === "retire"; }).length,`

平衡期望區塊加入：

```js
if (YEARS >= 30 && !active.st.hall.length) warn("積極經營 30 年沒有人進名人堂");
if (YEARS >= 30 && active.st.era < 2) warn("積極經營 30 年沒有進入第 2 紀元");
```

（新紀元會把 `day` 歸零，sim 迴圈仍以自己的 `day` 變數計年，所以每 360 天的列印不受影響；`st.day % 360 === 0` 判斷用 `st.day`，在新紀元內一樣是每年 1/1。）

- [ ] **Step 2：執行並依 WARN 調整**

Run: `node tools/starv_check/sim.js 30`

可調：`BAL.hofScore`（沒人進名人堂 → 調低）、`BAL.retireOldChance`。每次只改一項，重跑 sim 與 core_check；最後的數值與結果寫進 commit message。

- [ ] **Step 3：commit**

```bash
git add tools/starv_check/sim.js static_src/starv_data.js
git commit -m "test(starv): 模擬加入引退、名人堂、新紀元（附調整後數值）"
```

---

### Task 7：UI——藝人詳情的合約與獎座、引退紀念、紀元日期、新的 fx 與日誌文字

**Files:**
- Create: `static_src/starv_career_ui.js`
- Modify: `static_src/starv_view_artists.js`、`static_src/starv_ui.js`、`static_src/starv_events_ui.js`、`static_src/starv_log.js`、`site_src/starv_page.py`、`site_src/i18n_starv.py`、`static_src/css/starv.css`、`tools/starv_check/ui_check.js`

**Interfaces:**
- Produces:
  - 藝人詳情：`sv_contract`（合約到期日）、獎座區（`.sv-trophies`）
  - 引退紀念彈窗 class `sv-retire`，`data-act="retire-close"`；`st.retireQueue` 有東西且沒有其他彈窗時自動彈出，一次一位，看完從佇列移除
  - `UI.dateText(day)` 在第 2 紀元以後顯示「第 N 紀元」前綴（`sv_date_era`）
  - fx 文字：`renewed`、`refused`、`retired`（含是否進名人堂）、`retained`
  - 日誌：`retire`、`hof`、`staff_hired`、`achievement`、`story_unlocked`、`new_era`

- [ ] **Step 1：在 `ui_check.js` 追加步驟**

```js
step("生涯：藝人詳情的合約與獎座、引退紀念", async function (page) {
  var aid = (await st(page)).artists[0].id;
  await tab(page, "artists");
  await page.dispatchEvent('.sv-acard[data-aid="' + aid + '"]', "click");
  await page.waitForSelector(".sv-modal-detail .sv-trophies");
  await noRawKeys(page, "藝人詳情（生涯）");
  await act(page, "modal-close");
  await page.evaluate(function (id) { window.PriTestStarv.app.act(function (s) { window.PriTestStarvCore.retireArtist(s, id); }); }, aid);
  await page.waitForSelector(".sv-retire");
  await noRawKeys(page, "引退紀念");
  await act(page, "retire-close");
  var s = await st(page);
  assert.strictEqual(s.retireQueue.length, 0, "看完清掉");
  assert.ok(!s.artists.some(function (a) { return a.id === aid; }), "已引退");
});
```

- [ ] **Step 2：執行，確認失敗**

Run: `py -3 generate.py && node tools/starv_check/ui_check.js`
Expected: `FAIL 生涯：藝人詳情的合約與獎座、引退紀念：…`

- [ ] **Step 3：追加字串**

```python
    # ---- 生涯 ----
    ("sv_date_era", "第 {era} 紀元・{date}", "第 {era} 紀元・{date}"),
    ("sv_contract", "合約到 {date}", "契約満了 {date}"),
    ("sv_contract_soon", "（即將到期）", "（まもなく満了）"),
    ("sv_trophies_none", "還沒有獎座", "トロフィーはまだない"),
    ("sv_trophy_item", "第 {year} 年 {award}", "{year}年目 {award}"),
    ("sv_retire_title", "引退紀念", "引退記念"),
    ("sv_retire_hof", "🏛️ 進入名人堂！", "🏛️ 殿堂入り！"),
    ("sv_retire_thanks", "謝謝你一路以來的努力。", "これまで本当にお疲れさま。"),
    ("sv_retire_years", "在公司 {n} 年・{age} 歲引退", "在籍 {n} 年・{age} 歳で引退"),
    ("sv_retire_works", "作品 {n} 件", "出演作 {n} 本"),
    ("sv_retire_best", "代表作：{title}（{stars}）", "代表作：{title}（{stars}）"),
    ("sv_retire_score", "生涯評分 {n}", "キャリア評価 {n}"),
    ("sv_fx_renewed", "續約成功", "契約更新"),
    ("sv_fx_refused", "{name} 拒絕續約，離開了公司", "{name} は更新を断り、事務所を去った"),
    ("sv_fx_retired", "{name} 引退了", "{name} が引退した"),
    ("sv_fx_retired_hof", "{name} 引退，進入名人堂！", "{name} が引退し、殿堂入り！"),
    ("sv_fx_retained", "{name} 決定再拚一陣子！", "{name} はもう少し頑張ることにした！"),
    ("sv_log_retire", "{name} 引退了", "{name} が引退"),
    ("sv_log_hof", "{name} 進入名人堂", "{name} が殿堂入り"),
    ("sv_log_staff_hired", "聘請 {name} 擔任{role}", "{name} を{role}に迎えた"),
    ("sv_log_achievement", "達成成就「{title}」", "実績「{title}」を達成"),
    ("sv_log_story_unlocked", "{name} 的小故事解鎖了", "{name} のストーリーが解放された"),
    ("sv_log_new_era", "第 {era} 紀元開始了！", "第 {era} 紀元が始まった！"),
    ("sv_role_mentor", "導師", "メンター"),
    ("sv_role_producer", "製作人", "プロデューサー"),
```

- [ ] **Step 4：UI 修改**

`static_src/starv_ui.js` 的 `dateText` 換成：

```js
  // 第 2 紀元以後在日期前加上紀元（規格 §15.2）
  function dateText(day) {
    var d = Core.dateOf(day), s = t("sv_date", { y: d.year, m: d.month, d: d.day });
    var st = window.PriTestStarv && window.PriTestStarv.state && window.PriTestStarv.state();
    return st && st.era > 1 ? t("sv_date_era", { era: st.era, date: s }) : s;
  }
```

在 `function rivalName(st, id) {` 之前加入：

```js
  function hallName(h) { return Core.artistName({ rosterId: h.rosterId || null, nameSeed: h.nameSeed || 0, gender: h.gender || "f" }, lang()); }
```

並在 `window.PriTestStarvUI` 物件中 `rivalName: rivalName,` 之後加 `hallName: hallName,`。

`static_src/starv_view_artists.js`：
1. 在 `function worksList(a) {` 之前加入：

```js
  function trophyList(a) {
    if (!a.trophies.length) return el("p", { class: "sv-muted sv-trophies", text: t("sv_trophies_none") });
    return el("ul", { class: "sv-trophies" }, a.trophies.slice().reverse().map(function (x) {
      var aw = D.AWARD_BY_ID && D.AWARD_BY_ID[x.award];
      return el("li", { text: "🏆 " + t("sv_trophy_item", { year: x.year, award: aw ? UI.L(aw.name) : x.award }) });
    }));
  }
```

2. `openDetail` 中 `el("div", { class: "sv-small sv-muted", text: t("sv_age", { n: a.age }) + "・" + t("sv_salary", { m: UI.money(a.salary) }) }),` 之後加入：

```js
          el("div", { class: "sv-small sv-muted", text: t("sv_contract", { date: UI.dateText(a.contractEnd) }) + (a.contractEnd - st.day <= 90 ? t("sv_contract_soon") : "") }),
```

3. `box.appendChild(section(t("sv_works"), worksList(a)));` 之前加 `box.appendChild(section(t("sv_trophies"), trophyList(a)));`

`static_src/starv_events_ui.js` 的 `fxLines` 中 `if (fx.rivalPower) …` 之後加入：

```js
    if (fx.renewed) out.push(t("sv_fx_renewed"));
    if (fx.refused && ev) out.push(t("sv_fx_refused", { name: ev.name }));
    if (fx.retired && ev) out.push(t(fx.retired.hof ? "sv_fx_retired_hof" : "sv_fx_retired", { name: ev.name }));
    if (fx.retained && ev) out.push(t("sv_fx_retained", { name: ev.name }));
```

`static_src/starv_log.js` 的 `text` 函式中 `else if (e.type === "awards") { … }` 之後加入：

```js
    else if (e.type === "staff_hired") {
      var hh = null;
      st.hall.forEach(function (x) { if (x.id === d.hofId) hh = x; });
      p.name = hh ? UI.hallName(hh) : "—"; p.role = t("sv_role_" + d.role);
    } else if (e.type === "achievement") { var ac = D.ACHIEVEMENT_BY_ID && D.ACHIEVEMENT_BY_ID[d.id]; p.title = ac ? UI.L(ac.name) : d.id; }
    else if (e.type === "new_era") p.era = d.era;
```

（`retire`、`hof`、`story_unlocked` 的 `{name}` 由既有的 `who(st, d)` 以 `rosterId`／`nameSeed` 還原，不需要另外處理。）

- [ ] **Step 5：建立 `static_src/starv_career_ui.js`**

```js
// 明星經紀 starV：引退紀念（規格 §11）。st.retireQueue 有人時、畫面上沒有其他彈窗就自動彈出，一次一位，看完移出佇列。
(function () {
  "use strict";

  var Core = window.PriTestStarvCore;
  var UI = window.PriTestStarvUI;
  var t = UI.t, el = UI.el;
  var showing = null;

  function open(App, s) {
    showing = s.id;
    UI.openModal(function (box, close) {
      var look = { look: s.look, rarity: s.rarity, dir: s.dir };
      box.appendChild(UI.modalHead(t("sv_retire_title"), close));
      box.appendChild(el("div", { class: "sv-retire-hero" }, [
        UI.avatar(look, 120),
        el("h2", { text: UI.hallName(s) }),
        s.hof ? el("div", { class: "sv-retire-hof", text: t("sv_retire_hof") }) : null,
        el("p", { class: "sv-muted", text: t("sv_retire_thanks") })
      ]));
      box.appendChild(el("ul", { class: "sv-report-list" }, [
        el("li", { text: UI.dirIcon(s.dir) + " " + UI.dirName(s.dir) + "・" + t("sv_retire_years", { n: s.years, age: s.age }) }),
        el("li", { text: t("sv_retire_works", { n: s.works }) }),
        s.best ? el("li", { text: t("sv_retire_best", { title: Core.jobTitle(s.best, UI.lang()), stars: new Array(s.best.stars + 1).join("★") }) }) : null,
        el("li", { text: t("sv_trophies") + " " + s.trophies.length }),
        el("li", { text: t("sv_retire_score", { n: s.score }) })
      ]));
      box.appendChild(el("div", { class: "sv-row sv-row-end" }, [UI.btn(t("sv_close"), close, "sv-btn-primary", { "data-act": "retire-close" })]));
    }, { cls: "sv-retire", onClose: function () {
      showing = null;
      App.act(function (st) { st.retireQueue = st.retireQueue.filter(function (x) { return x.id !== s.id; }); });
    } });
  }

  UI.addExtra(function (App) {
    var st = App.st();
    if (!st.retireQueue || !st.retireQueue.length || showing || UI.modalIsOpen()) return null;
    var s = st.retireQueue[0];
    setTimeout(function () { if (!showing && !UI.modalIsOpen()) open(App, s); }, 0);
    return null;
  });
})();
```

`site_src/starv_page.py`：`"starv_awards_ui.js",` 之後加 `"starv_career_ui.js",`

附加到 `starv.css`：

```css
/* ---- 生涯 ---- */
.sv-trophies { list-style: none; margin: 0; padding: 0; }
.sv-trophies li { padding: 0.2rem 0; color: var(--sv-gold); font-size: 0.88em; }
.sv-retire { text-align: center; }
.sv-retire .sv-report-list { text-align: left; }
.sv-retire-hero { display: flex; flex-direction: column; align-items: center; gap: 0.3rem; padding: 0.5rem 0; }
.sv-retire-hero h2 { margin: 0.3rem 0 0; }
.sv-retire-hof { font-weight: 800; color: var(--sv-gold); text-shadow: 0 0 16px rgba(255, 214, 107, 0.6); animation: sv-glow 1.2s ease-in-out infinite alternate; }
```

- [ ] **Step 6：建置並執行**

```bash
py -3 generate.py && py -3 tools/split_css.py --check
for f in starv_ui starv_view_artists starv_events_ui starv_log starv_career_ui; do node --check static_src/$f.js || exit 1; done
node tools/starv_check/ui_check.js
```

Expected: `全部 18 個步驟通過`

- [ ] **Step 7：commit**

```bash
git add static_src/starv_career_ui.js static_src/starv_view_artists.js static_src/starv_ui.js static_src/starv_events_ui.js static_src/starv_log.js site_src/starv_page.py site_src/i18n_starv.py static_src/css/starv.css tools/starv_check/ui_check.js
git commit -m "feat(starv): 藝人合約與獎座、引退紀念、紀元日期、生涯事件與日誌文字"
```

---

### Task 8：UI——殿堂分頁（名人堂、導師、圖鑑、成就、年表、新紀元）

**Files:**
- Create: `static_src/starv_view_hall.js`
- Modify: `site_src/starv_page.py`、`site_src/i18n_starv.py`、`static_src/css/starv.css`、`tools/starv_check/ui_check.js`

**Interfaces:**
- Produces: 分頁 `{ id: "hall", order: 50, icon: "🏛️" }`，子分頁 `data-act="hall-sub-<id>"`（`hall`、`codex`、`ach`、`timeline`、`era`）
  - 名人堂：每位一張卡；聘請 `data-act="hire-<hofId>"`（角色 select `data-act="hire-role-<hofId>"`、方向 select `data-act="hire-dir-<hofId>"`）、解聘 `data-act="fire-<hofId>"`；顯示名額 `staffSlots`
  - 圖鑑：SR/SSR 卡（未取得顯示剪影 `.sv-codex-locked`）；SSR 已解鎖小故事時可點開 `data-act="story-<rosterId>"`
  - 成就：已達成／未達成清單
  - 年表：`st.timeline` 依時間列出
  - 新紀元：傳承點、本紀元可得點數、加成商店 `data-act="perk-<id>"`；Lv10 時出現帶走藝人的 select（`data-act="era-carry"`）與 `data-act="era-start"` → `data-act="era-confirm"`

- [ ] **Step 1：在 `ui_check.js` 追加步驟**

```js
step("殿堂：圖鑑、成就、名人堂聘請、新紀元", async function (page) {
  await tab(page, "hall");
  await noRawKeys(page, "殿堂：名人堂");
  for (var k of ["codex", "ach", "timeline", "era", "hall"]) { await act(page, "hall-sub-" + k); await noRawKeys(page, "殿堂：" + k); }
  var hof = await page.evaluate(function () {
    var A = window.PriTestStarv.app;
    return A.act(function (s) {
      s.company.level = 10;
      s.hall.push({ id: "h_ui", era: s.era, day: s.day, rosterId: null, nameSeed: 42, gender: "f", rarity: "R", dir: "singer", age: 40, years: 10, works: 80, best: null, trophies: [{ award: "singer_f", year: 1 }], fame: 1000, look: s.artists[0].look, score: 50, hof: true });
      return "h_ui";
    });
  });
  await page.waitForSelector('[data-act="hire-' + hof + '"]');
  await act(page, "hire-" + hof);
  var s = await st(page);
  assert.strictEqual(s.staff.length, 1, "聘請");
  await act(page, "hall-sub-era");
  await act(page, "era-start");
  await act(page, "era-confirm");
  s = await st(page);
  assert.strictEqual(s.era, 2, "進入第 2 紀元");
  assert.ok(s.hall.some(function (h) { return h.id === "h_ui"; }), "名人堂保留");
  await noRawKeys(page, "新紀元之後");
});
```

並把「三種語言…」步驟中的 `var tabs = ["artists", "jobs", "industry", "gacha", "company"];` 改成 `var tabs = ["artists", "jobs", "industry", "gacha", "hall", "company"];`

- [ ] **Step 2：執行，確認失敗**

Run: `py -3 generate.py && node tools/starv_check/ui_check.js`
Expected: `FAIL 三種語言…`（還沒有 `hall` 分頁）

- [ ] **Step 3：追加字串**

```python
    # ---- 殿堂 ----
    ("sv_tab_hall", "殿堂", "殿堂"),
    ("sv_hall_sub_hall", "名人堂", "殿堂入り"),
    ("sv_hall_sub_codex", "圖鑑", "図鑑"),
    ("sv_hall_sub_ach", "成就", "実績"),
    ("sv_hall_sub_timeline", "年表", "年表"),
    ("sv_hall_sub_era", "新紀元", "新紀元"),
    ("sv_hall_empty", "還沒有人進入名人堂。生涯評分 {n} 以上的藝人引退時會被收錄。", "まだ殿堂入りはいない。キャリア評価 {n} 以上で引退すると殿堂入りする。"),
    ("sv_hall_entry", "第 {era} 紀元・{dir}・評分 {score}", "第 {era} 紀元・{dir}・評価 {score}"),
    ("sv_staff_slots", "導師／製作人名額 {n} / {cap}（公司等級 ÷ 2）", "メンター／プロデューサー枠 {n} / {cap}（事務所レベル ÷ 2）"),
    ("sv_staff_hire", "聘請", "迎える"),
    ("sv_staff_fire", "解聘", "契約終了"),
    ("sv_staff_now", "擔任{role}（{dir}）・月薪 {m}・加成 +{p}%", "{role}（{dir}）・月給 {m}・効果 +{p}%"),
    ("sv_staff_hint", "導師：該方向課程與訓練成長提高；製作人：該方向工作評價與大成功率提高。", "メンター：その分野のレッスン・トレーニングの成長が上がる。プロデューサー：その分野の仕事の評価と大成功率が上がる。"),
    ("sv_err_noHof", "找不到這位名人堂藝人", "殿堂入りタレントが見つかりません"),
    ("sv_err_hired", "已經聘請了", "すでに迎えています"),
    ("sv_err_role", "職位無效", "無効な役職です"),
    ("sv_codex_summary", "SR {sr} / {srTotal}・SSR {ssr} / {ssrTotal}・累計招募 R {r} 人", "SR {sr} / {srTotal}・SSR {ssr} / {ssrTotal}・R 累計 {r} 人"),
    ("sv_codex_story", "閱讀小故事", "ストーリーを読む"),
    ("sv_codex_story_locked", "小故事：讓這位藝人在頒獎典禮得獎就會解鎖", "ストーリー：授賞式で受賞すると解放"),
    ("sv_ach_summary", "已達成 {n} / {total}", "達成 {n} / {total}"),
    ("sv_ach_reward", "獎勵：星探券 {n}", "報酬：スカウト券 {n}"),
    ("sv_timeline_empty", "得獎、引退、名人堂、公司升到 Lv10、新紀元都會記錄在這裡", "受賞・引退・殿堂入り・Lv10 到達・新紀元がここに記録される"),
    ("sv_tl_award", "{name} 拿下「{award}」", "{name} が「{award}」を受賞"),
    ("sv_tl_retire", "{name} 引退", "{name} が引退"),
    ("sv_tl_hof", "{name} 進入名人堂", "{name} が殿堂入り"),
    ("sv_tl_level", "公司升到 Lv10", "事務所が Lv10 に到達"),
    ("sv_tl_era", "第 {era} 紀元開始", "第 {era} 紀元が始まった"),
    ("sv_era_points", "傳承點 {n}", "継承ポイント {n}"),
    ("sv_era_gain", "現在開創新紀元可以得到 {n} 點（名人堂 ×5＋得獎數＋排行榜第 1 名次數）", "今新紀元を開くと {n} pt（殿堂入り ×5＋受賞数＋ランキング 1 位回数）"),
    ("sv_era_need", "公司升到 Lv10 才能開創新紀元", "新紀元は事務所 Lv10 から"),
    ("sv_era_desc", "公司、資金、設施、在籍藝人、對手全部重置；名人堂、圖鑑、成就、年表、傳承點保留。可以帶走 1 位藝人（能力 ×0.7）。每個新紀元對手會變強 10%。", "事務所・資金・設備・所属タレント・ライバルはリセット。殿堂・図鑑・実績・年表・継承ポイントは引き継ぐ。タレント 1 人を連れていける（能力 ×0.7）。新紀元ごとにライバルが 10% 強くなる。"),
    ("sv_era_carry", "帶走的藝人", "連れていくタレント"),
    ("sv_era_carry_none", "不帶人", "連れていかない"),
    ("sv_era_start", "開創新紀元", "新紀元を開く"),
    ("sv_era_confirm", "確定開創第 {era} 紀元（無法復原）", "第 {era} 紀元を開く（元に戻せません）"),
    ("sv_perk_lv", "Lv{lv} / {max}", "Lv{lv} / {max}"),
    ("sv_perk_buy", "升級（{n} 點）", "強化（{n} pt）"),
    ("sv_perk_max", "已滿級", "最大"),
    ("sv_err_noPerk", "找不到這個加成", "強化項目が見つかりません"),
    ("sv_err_points", "傳承點不足", "継承ポイントが足りません"),
```

- [ ] **Step 4：建立 `static_src/starv_view_hall.js`**

```js
// 明星經紀 starV：「殿堂」分頁（名人堂與導師／製作人、圖鑑、成就、作品年表、新紀元；規格 §11、§13、§14）。
(function () {
  "use strict";

  var D = window.PriTestStarvData;
  var Core = window.PriTestStarvCore;
  var Roster = window.PriTestStarvRoster;
  var UI = window.PriTestStarvUI;
  var t = UI.t, el = UI.el;
  var SUBS = ["hall", "codex", "ach", "timeline", "era"];
  var view = { sub: "hall", hire: {}, carry: "", confirm: false };

  function report(err) { if (err) UI.toast(t("sv_err_" + err), "bad"); }
  function dirOpts() { return D.DIRS.map(function (d) { return { value: d.id, label: d.icon + " " + UI.L(d.name) }; }); }

  function hallView(st, App) {
    var wrap = el("div", {});
    wrap.appendChild(el("p", { class: "sv-small", text: t("sv_staff_slots", { n: st.staff.length, cap: Core.staffSlots(st) }) }));
    wrap.appendChild(el("p", { class: "sv-small sv-muted", text: t("sv_staff_hint") }));
    if (!st.hall.length) { wrap.appendChild(el("div", { class: "sv-card sv-muted", text: t("sv_hall_empty", { n: D.BAL.hofScore }) })); return wrap; }
    wrap.appendChild(el("div", { class: "sv-hall-grid" }, st.hall.slice().reverse().map(function (h) {
      var staff = null;
      st.staff.forEach(function (s) { if (s.hofId === h.id) staff = s; });
      var choice = view.hire[h.id] || (view.hire[h.id] = { role: "mentor", dir: h.dir });
      var body = [
        UI.avatar({ look: h.look, rarity: h.rarity, dir: h.dir }, 64),
        el("b", { text: UI.hallName(h) }),
        el("div", { class: "sv-small sv-muted", text: t("sv_hall_entry", { era: h.era, dir: UI.dirName(h.dir), score: h.score }) }),
        el("div", { class: "sv-small sv-warn", text: "🏆 " + h.trophies.length })
      ];
      if (staff) {
        body.push(el("div", { class: "sv-small", text: t("sv_staff_now", { role: t("sv_role_" + staff.role), dir: UI.dirName(staff.dir), m: UI.money(staff.salary), p: Math.round(Core.staffBonus(h) * 100) }) }));
        body.push(UI.btn(t("sv_staff_fire"), function () { App.act(function (s) { Core.fireStaff(s, h.id); }); }, "sv-btn-ghost", { "data-act": "fire-" + h.id }));
      } else {
        body.push(UI.select([{ value: "mentor", label: t("sv_role_mentor") }, { value: "producer", label: t("sv_role_producer") }], choice.role,
          function (v) { choice.role = v; }, { "data-act": "hire-role-" + h.id }));
        body.push(UI.select(dirOpts(), choice.dir, function (v) { choice.dir = v; }, { "data-act": "hire-dir-" + h.id }));
        body.push(UI.btn(t("sv_staff_hire"), function () { report(App.act(function (s) { return Core.hireStaff(s, h.id, choice.role, choice.dir); })); }, "sv-btn-gold", { "data-act": "hire-" + h.id }));
      }
      return el("div", { class: "sv-card sv-hall-card" }, body);
    })));
    return wrap;
  }

  function openStory(e) {
    UI.openModal(function (box, close) {
      box.appendChild(UI.modalHead(UI.L(e.name), close));
      box.appendChild(el("div", { class: "sv-retire-hero" }, [UI.avatar(e, 120)]));
      box.appendChild(el("p", { class: "sv-story", text: UI.L(e.story) }));
    }, { cls: "sv-story-modal" });
  }

  function codexView(st) {
    var c = Core.codexStats(st);
    var list = Roster.byRarity("SSR").concat(Roster.byRarity("SR"));
    return el("div", {}, [
      el("p", { class: "sv-small", text: t("sv_codex_summary", c) }),
      el("div", { class: "sv-codex-grid" }, list.map(function (e) {
        var owned = !!st.codex.owned[e.id];
        if (!owned) return el("div", { class: "sv-codex-card sv-codex-locked" }, [el("span", { class: "sv-ava sv-ava-ghost", style: "--sv-size:56px" }), UI.rarity(e.rarity), el("div", { text: "？？？" })]);
        var story = e.story && st.codex.stories[e.id];
        return el("div", { class: "sv-codex-card" }, [
          UI.avatar(e, 56), UI.rarity(e.rarity), el("b", { text: UI.L(e.name) }),
          el("div", { class: "sv-small sv-muted", text: UI.dirIcon(e.dir) + " " + UI.dirName(e.dir) }),
          e.story ? (story ? UI.btn(t("sv_codex_story"), function () { openStory(e); }, "sv-btn-gold", { "data-act": "story-" + e.id })
            : el("div", { class: "sv-small sv-muted", text: t("sv_codex_story_locked") })) : null
        ]);
      }))
    ]);
  }

  function achView(st) {
    var all = D.ACHIEVEMENTS || [], done = all.filter(function (x) { return st.achievements[x.id]; }).length;
    return el("div", {}, [
      el("p", { class: "sv-small", text: t("sv_ach_summary", { n: done, total: all.length }) }),
      el("ul", { class: "sv-ach-list" }, all.map(function (x) {
        var got = st.achievements[x.id];
        return el("li", { class: got ? "sv-ach-done" : "" }, [
          el("span", { class: "sv-ach-icon", text: got ? "🏅" : "🔒" }),
          el("div", { class: "sv-grow" }, [el("b", { text: UI.L(x.name) }), el("div", { class: "sv-small sv-muted", text: UI.L(x.desc) })]),
          el("span", { class: "sv-small", text: t("sv_ach_reward", { n: x.reward.tickets || 0 }) })
        ]);
      }))
    ]);
  }

  function tlText(st, x) {
    var d = x.data || {};
    if (x.kind === "award") {
      var aw = D.AWARD_BY_ID[d.award];
      return t("sv_tl_award", { name: window.PriTestStarvAwardsUI.nomineeName(st, d.nominee), award: aw ? UI.L(aw.name) : d.award });
    }
    if (x.kind === "retire" || x.kind === "hof") return t("sv_tl_" + x.kind, { name: UI.hallName(d) });
    if (x.kind === "level") return t("sv_tl_level");
    if (x.kind === "era") return t("sv_tl_era", { era: d.era });
    return x.kind;
  }
  function timelineView(st) {
    if (!st.timeline.length) return el("p", { class: "sv-muted", text: t("sv_timeline_empty") });
    return el("ul", { class: "sv-log-list" }, st.timeline.map(function (x) {
      var dt = Core.dateOf(x.day);
      return el("li", { class: "sv-log-line" }, [
        el("span", { class: "sv-log-day", text: t("sv_date_era", { era: x.era, date: t("sv_date", { y: dt.year, m: dt.month, d: dt.day }) }) }),
        el("span", { text: tlText(st, x) })
      ]);
    }));
  }

  function eraView(st, App) {
    var wrap = el("div", {});
    wrap.appendChild(el("div", { class: "sv-card" }, [
      el("h3", { text: t("sv_era_points", { n: st.legacy.points }) }),
      el("p", { class: "sv-small", text: t("sv_era_gain", { n: Core.legacyPoints(st) }) })
    ].concat(D.LEGACY_PERKS.map(function (p) {
      var lv = st.legacy.perks[p.id] || 0;
      return el("div", { class: "sv-fac" }, [
        el("div", { class: "sv-grow" }, [el("b", { text: UI.L(p.name) }), " ", el("span", { class: "sv-chip", text: t("sv_perk_lv", { lv: lv, max: p.max }) }),
          el("div", { class: "sv-small sv-muted", text: UI.L(p.desc) })]),
        lv >= p.max ? el("span", { class: "sv-small sv-muted", text: t("sv_perk_max") })
          : UI.btn(t("sv_perk_buy", { n: p.cost[lv] }), function () { report(App.act(function (s) { return Core.buyPerk(s, p.id); })); },
            st.legacy.points >= p.cost[lv] ? "sv-btn-gold" : "sv-btn-ghost", { "data-act": "perk-" + p.id })
      ]);
    }))));
    var card = el("div", { class: "sv-card" }, [el("h3", { text: t("sv_hall_sub_era") }), el("p", { class: "sv-small", text: t("sv_era_desc") })]);
    if (st.company.level < 10) card.appendChild(el("p", { class: "sv-warn", text: t("sv_era_need") }));
    else {
      card.appendChild(el("label", { class: "sv-field" }, [el("span", { class: "sv-small", text: t("sv_era_carry") }),
        UI.select([{ value: "", label: t("sv_era_carry_none") }].concat(st.artists.map(function (a) { return { value: a.id, label: UI.name(a) }; })),
          view.carry, function (v) { view.carry = v; }, { "data-act": "era-carry" })]));
      card.appendChild(el("div", { class: "sv-row sv-row-end" }, [view.confirm
        ? UI.btn(t("sv_era_confirm", { era: st.era + 1 }), function () {
          view.confirm = false;
          report(App.act(function (s) { return Core.newEra(s, view.carry || null); }));
          view.carry = "";
        }, "sv-btn-danger", { "data-act": "era-confirm" })
        : UI.btn(t("sv_era_start"), function () { view.confirm = true; App.render(); }, "sv-btn-primary", { "data-act": "era-start" })]));
    }
    wrap.appendChild(card);
    return wrap;
  }

  UI.register({
    id: "hall", order: 50, icon: "🏛️", labelKey: "sv_tab_hall",
    render: function (c, App) {
      var st = App.st();
      c.appendChild(el("div", { class: "sv-subtabs" }, SUBS.map(function (k) {
        return UI.btn(t("sv_hall_sub_" + k), function () { view.sub = k; view.confirm = false; App.render(); }, view.sub === k ? "sv-btn-primary" : "sv-btn-ghost", { "data-act": "hall-sub-" + k });
      })));
      var body = { hall: hallView, codex: codexView, ach: achView, timeline: timelineView, era: eraView }[view.sub];
      c.appendChild(body(st, App));
    }
  });
})();
```

`site_src/starv_page.py`：`"starv_view_gacha.js",` 之後加 `"starv_view_hall.js",`

附加到 `starv.css`：

```css
/* ---- 殿堂 ---- */
.sv-hall-grid, .sv-codex-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(10rem, 1fr)); gap: 0.6rem; }
.sv-hall-card, .sv-codex-card { display: flex; flex-direction: column; align-items: center; gap: 0.25rem; text-align: center; }
.sv-hall-card .sv-select { width: 100%; }
.sv-codex-card { padding: 0.7rem 0.5rem; border-radius: var(--sv-radius); background: var(--sv-glass); border: 1px solid var(--sv-line); }
.sv-codex-locked { opacity: 0.45; filter: grayscale(1); }
.sv-ach-list { list-style: none; margin: 0; padding: 0; }
.sv-ach-list li { display: flex; align-items: center; gap: 0.6rem; padding: 0.45rem 0; border-top: 1px solid var(--sv-line); opacity: 0.55; }
.sv-ach-list li.sv-ach-done { opacity: 1; }
.sv-ach-icon { font-size: 1.4rem; }
.sv-story { line-height: 1.9; white-space: pre-wrap; }
```

- [ ] **Step 5：建置並執行全部檢查**

```bash
py -3 generate.py && py -3 tools/split_css.py --check
for f in static_src/starv*.js; do node --check "$f" || exit 1; done
node tools/starv_check/core_check.js
node tools/starv_check/sim.js 30
node tools/starv_check/ui_check.js
```

Expected：`core_check` 全部 90 個通過；`sim` 不變量全部通過；`ui_check` 全部 19 個步驟通過。

- [ ] **Step 6：檢視截圖**

用 Read 打開 `tools/starv_check/shots/tab-hall.png`，確認子分頁鈕、名人堂卡片、圖鑑剪影沒有溢出。

- [ ] **Step 7：commit**

```bash
git add static_src/starv_view_hall.js site_src/starv_page.py site_src/i18n_starv.py static_src/css/starv.css tools/starv_check/ui_check.js
git commit -m "feat(starv): 殿堂分頁（名人堂與導師、圖鑑、成就、年表、新紀元）"
```
