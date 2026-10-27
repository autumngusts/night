# starV 計畫 6：大型企劃 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 加入規格 §12 的大型企劃：公司 Lv5 解鎖、同時 1 件、先投資、3～5 個階段各派不同方向的藝人、階段之間的分歧事件、最終依累計成績結算（大成功＝巨額收入、聲望、星探券；失敗＝虧損），作品可以入圍頒獎；並加上「企劃」分頁與完成結算畫面。

**Architecture:** 企劃定義比照事件與成就做成登記器（`starv_projects.js`＋分檔 `starv_projects_1.js`，之後擴充）。進度與結算寫在 `starv_core.js`（`st.project`）；派遣的藝人行程 `kind: "project"`，由核心每日推進。分歧事件放 `starv_events_4.js`（`trigger: "cond"`，新 fx：`projectMod`、`projectDays`）。企劃作品記在參與者的 `works` 裡（`project: id`），`jobTitle` 對企劃作品回傳企劃名，所以頒獎、日誌、作品列表都能直接顯示。完成後計入傳承點與新成就。UI 新增 `starv_view_projects.js`（企劃分頁，order 25）與完成結算彈窗。存檔版本升到 5。

**Tech Stack:** Vanilla ES5、node 單元測試、Playwright。

## Global Constraints

- 規格 §12：公司 Lv5 解鎖；同時只能進行 1 件；先投入資金；3～5 個階段，每階段有方向需求、派 1～5 人（期間被佔用）；階段之間有分歧事件；最終依累計成績結算，大成功＝大量收入、聲望、星探券、專屬稱號，失敗＝虧損；作品可以入圍頒獎
- 規格 §13：傳承點計入「已完成的大型企劃」（每件 +3）
- 企劃之後會擴充：登記器、分檔、ID 永不重用
- 舊存檔（version 4）必須能讀
- 3D 演出在計畫 7 接上（本計畫只在結算資料中保留演出需要的資訊：參與者、方向、結果）
- 計畫 1–5 的既有測試要繼續通過；CLAUDE.md §5.2.1 前綴；推送前遞增版本號

## 檔案結構

| 檔案 | 責任 |
| --- | --- |
| Create `static_src/starv_projects.js` | 企劃登記器 → `PriTestStarvProjects`（同步 `D.PROJECTS`、`D.PROJECT_BY_ID`） |
| Create `static_src/starv_projects_1.js` | v1 的 5 件企劃 |
| Create `static_src/starv_events_4.js` | 企劃分歧事件 3 種（`addedIn: "v4"`） |
| Create `static_src/starv_achievements_2.js` | 企劃成就 2 項（`addedIn: "v2"`） |
| Modify `static_src/starv_data.js` | 企劃的平衡常數 |
| Modify `static_src/starv_core.js` | 企劃進度與結算、`projectMod`／`projectDays` fx、`jobTitle` 支援企劃作品、傳承點、成就 `projects`、存檔版本 5 |
| Modify `tools/starv_check/core_check.js`、`tools/starv_check/sim.js` | 測試與模擬 |
| Create `static_src/starv_view_projects.js` | 企劃分頁與完成結算彈窗 |
| Modify `static_src/starv_view_artists.js`（不需改：`sv_task_project` 自動套用）、`static_src/starv_events_ui.js`、`static_src/starv_log.js` | fx 與日誌文字 |
| Modify `site_src/starv_page.py`、`site_src/i18n_starv.py`、`static_src/css/starv.css`、`tools/starv_check/ui_check.js` | 登記、字串、樣式、流程 |

插入慣例同前。插入新區塊時保留標記行。

---

### Task 1：企劃登記器、v1 資料、分歧事件

**Files:**
- Create: `static_src/starv_projects.js`、`static_src/starv_projects_1.js`、`static_src/starv_events_4.js`
- Modify: `tools/starv_check/core_check.js`、`site_src/starv_page.py`、`tools/starv_check/sim.js`

**Interfaces:**
- Produces:
  - `PriTestStarvProjects.add(list)`、`.all()`、`.byId(id)`；同步 `D.PROJECTS`、`D.PROJECT_BY_ID`
  - 企劃格式：`{ id, addedIn, name, desc, unlockLevel, cost, stages: [{ name, dirs: [dir], slots: [min, max], tier, days, branch: eventId|null }] }`
  - v1：`world_tour`（Lv5）、`own_variety`（Lv5）、`intl_film`（Lv6）、`music_fest`（Lv7）、`media_mix`（Lv8）
  - 事件 v4：`proj_injury`、`proj_sponsor`、`proj_buzz`（`target: "none"`、`trigger: "cond"`）；fx `projectMod`（加到下一階段的表現修正）、`projectDays`（加到下一階段的天數）

- [ ] **Step 1：寫失敗測試**

`core_check.js` 的 require 區：`require("../../static_src/starv_events_3.js");` 之後加 `require("../../static_src/starv_events_4.js");`；`require("../../static_src/starv_achievements_1.js");` 之前加：

```js
require("../../static_src/starv_projects.js");
require("../../static_src/starv_projects_1.js");
var Projects = global.PriTestStarvProjects;
```

在「事件資料：40 種、格式正確」的 FX 陣列最後加上 `"projectMod", "projectDays"`。

插在 `// ==== run ====` 之前：

```js
test("企劃資料：5 件、格式、分歧事件存在", function () {
  eq(Projects.all().filter(function (p) { return p.addedIn === "v1"; }).length, 5);
  Projects.all().forEach(function (p) {
    assert(p.name.zh && p.name.ja && p.desc.zh && p.desc.ja, p.id + " 文字");
    assert(p.unlockLevel >= 5 && p.cost > 0, p.id + " 解鎖與費用");
    assert(p.stages.length >= 3 && p.stages.length <= 5, p.id + " 階段數");
    p.stages.forEach(function (s, i) {
      assert(s.name.zh && s.name.ja, p.id + " 階段名 " + i);
      assert(s.dirs.length && s.dirs.every(function (d) { return D.DIR_BY_ID[d]; }), p.id + " 方向 " + i);
      assert(s.slots[0] >= 1 && s.slots[1] <= 5 && s.slots[0] <= s.slots[1], p.id + " 人數 " + i);
      assert(D.TIERS[s.tier] && s.days > 0, p.id + " 等級與天數 " + i);
      if (s.branch) assert(D.EVENT_BY_ID[s.branch] && D.EVENT_BY_ID[s.branch].trigger === "cond", p.id + " 分歧事件 " + s.branch);
    });
    eq(D.PROJECT_BY_ID[p.id], p);
  });
  var threw = false; try { Projects.add([Projects.byId("world_tour")]); } catch (e) { threw = true; } assert(threw, "重複 ID");
  eq(Events.all().filter(function (e) { return e.addedIn === "v4"; }).length, 3);
});
```

- [ ] **Step 2：執行，確認失敗**

Run: `node tools/starv_check/core_check.js`
Expected: `Cannot find module '../../static_src/starv_events_4.js'`

- [ ] **Step 3：建立 `static_src/starv_projects.js`**

```js
// 明星經紀 starV：大型企劃登記器（規格 §12）。企劃之後會擴充：資料分檔（starv_projects_1.js、_2.js …）各自 add()，ID 永不重用。
(function () {
  "use strict";

  var root = typeof window !== "undefined" ? window : globalThis;
  var D = root.PriTestStarvData;
  var list = [];
  var map = {};

  function add(items) {
    items.forEach(function (p) {
      if (map[p.id]) throw new Error("starV projects: 重複的 ID " + p.id);
      map[p.id] = p;
      list.push(p);
    });
  }

  D.PROJECTS = list;
  D.PROJECT_BY_ID = map;
  root.PriTestStarvProjects = {
    add: add,
    all: function () { return list.slice(); },
    byId: function (id) { return map[id] || null; }
  };
})();
```

- [ ] **Step 4：建立 `static_src/starv_projects_1.js`**

```js
// 明星經紀 starV：大型企劃 v1（5 件）。每個階段派 slots 範圍內的藝人，藝人的主方向或副方向要在 dirs 裡；
// 難度以 tier 的難度基準 × 1.1 計算；branch＝該階段結束後觸發的分歧事件（starv_events_4.js）。
(function () {
  "use strict";

  var root = typeof window !== "undefined" ? window : globalThis;
  var T = root.PriTestStarvData.T;

  function S(name, dirs, slots, tier, days, branch) { return { name: T(name), dirs: dirs, slots: slots, tier: tier, days: days, branch: branch || null }; }
  function P(id, name, desc, unlockLevel, cost, stages) { return { id: id, addedIn: "v1", name: T(name), desc: T(desc), unlockLevel: unlockLevel, cost: cost, stages: stages }; }
  var LIVE = ["singer", "idol", "dancer", "band"];

  root.PriTestStarvProjects.add([
    P("world_tour", "世界巡迴演唱會|ワールドツアー", "從排練到巨蛋終場，帶著旗下的歌手與偶像走遍世界。|リハーサルからドームのファイナルまで、歌手とアイドルを連れて世界を巡る。", 5, 300000, [
      S("排練|リハーサル", LIVE, [2, 5], "B", 10),
      S("亞洲站|アジア公演", LIVE, [3, 5], "A", 15, "proj_injury"),
      S("歐美站|欧米公演", LIVE, [3, 5], "A", 15, "proj_buzz"),
      S("巨蛋終場|ドームファイナル", LIVE, [3, 5], "S", 10)
    ]),
    P("own_variety", "自家冠名綜藝|冠バラエティ番組", "公司自己製作的綜藝節目，從企劃會議一路做到正式開播。|事務所が自ら制作するバラエティ。企画会議から本放送まで。", 5, 200000, [
      S("企劃會議|企画会議", ["host", "comedy", "anchor"], [1, 2], "B", 6),
      S("試播|パイロット版", ["host", "comedy", "influencer", "idol"], [2, 4], "A", 10, "proj_sponsor"),
      S("正式開播|本放送", ["host", "comedy", "influencer", "idol"], [2, 4], "A", 20, "proj_buzz")
    ]),
    P("intl_film", "國際影展合拍片|国際映画祭の合作映画", "和海外製作公司合拍，目標是國際影展的紅毯。|海外の制作会社と合作し、国際映画祭のレッドカーペットを目指す。", 6, 400000, [
      S("選角讀本|キャスティングと本読み", ["film", "drama", "stage"], [1, 3], "B", 8),
      S("海外拍攝|海外ロケ", ["film", "drama", "stage", "voice"], [2, 4], "A", 20, "proj_injury"),
      S("後製配樂|ポストプロダクション", ["composer", "voice"], [1, 2], "A", 10),
      S("影展首映|映画祭プレミア", ["film", "drama", "model", "cm"], [1, 3], "S", 5, "proj_sponsor")
    ]),
    P("music_fest", "大型音樂祭|大型音楽フェス", "連續三天的戶外音樂祭，從招商到壓軸之夜。|三日間の野外フェス。協賛集めから大トリの夜まで。", 7, 500000, [
      S("招商|協賛集め", ["cm", "model", "influencer"], [1, 2], "B", 8, "proj_sponsor"),
      S("DAY 1|DAY 1", ["singer", "band", "idol"], [3, 5], "A", 5),
      S("DAY 2|DAY 2", ["dancer", "idol", "vtuber"], [3, 5], "A", 5, "proj_injury"),
      S("壓軸之夜|大トリの夜", ["singer", "band"], [2, 5], "S", 5)
    ]),
    P("media_mix", "跨媒體企劃|メディアミックス企画", "原創動畫：劇本、配音、主題曲到首播活動一手包辦。|オリジナルアニメ：脚本、アフレコ、主題歌から初回放送イベントまで。", 8, 600000, [
      S("劇本與分鏡|脚本と絵コンテ", ["composer", "voice"], [1, 3], "A", 12),
      S("配音錄製|アフレコ", ["voice"], [2, 5], "A", 15, "proj_injury"),
      S("主題曲|主題歌", ["singer", "idol", "band"], [1, 3], "S", 8),
      S("首播活動|初回放送イベント", ["voice", "vtuber", "influencer"], [2, 4], "S", 6, "proj_buzz")
    ])
  ]);
})();
```

- [ ] **Step 5：建立 `static_src/starv_events_4.js`**

```js
// 明星經紀 starV：重大事件 v4——大型企劃的分歧（規格 §12）。由核心在企劃階段結束時推出，ctx.project＝企劃 id。
// projectMod 加到下一階段的表現修正，projectDays 加到下一階段的天數。
(function () {
  "use strict";

  var root = typeof window !== "undefined" ? window : globalThis;
  var T = root.PriTestStarvData.T;

  function O(w, fx, bad) { return { w: w, fx: fx, bad: !!bad }; }
  function C(label, hint, outcomes) { return { label: T(label), hint: T(hint), outcomes: outcomes }; }
  function E(id, title, text, choices, defaultChoice) {
    return { id: id, addedIn: "v4", category: "special", target: "none", trigger: "cond", weight: 10,
      title: T(title), text: T(text), choices: choices, defaultChoice: defaultChoice };
  }

  root.PriTestStarvEvents.add([
    E("proj_injury", "主演受傷|主演の負傷", "企劃進行中，主要成員之一受了傷。|企画の途中で、主要メンバーの一人が負傷した。", [
      C("換角繼續|代役で続行", "下一階段表現↓|次の段階の表現↓", [O(1, { projectMod: -0.1 })]),
      C("延期等他康復|回復を待って延期", "下一階段天數↑ 花錢|次の段階の日数↑ 出費", [O(1, { projectDays: 7, money: -20000 })])
    ], 1),
    E("proj_sponsor", "贊助商加碼|スポンサーの増額", "贊助商願意加碼，條件是在作品裡放更多置入。|スポンサーが増額を申し出た。条件は作中のタイアップを増やすこと。", [
      C("接受|受ける", "資金↑ 下一階段表現↓|資金↑ 次の段階の表現↓", [O(1, { money: 80000, projectMod: -0.05 })]),
      C("婉拒|断る", "沒有變化|変化なし", [O(1, {})])
    ], 1),
    E("proj_buzz", "宣傳爆紅|宣伝がバズった", "企劃的預告在網路上爆紅，大家都在討論。|企画の予告がネットでバズり、話題になっている。", [
      C("加碼宣傳|宣伝を追加", "花錢 下一階段表現大幅↑|出費 次の段階の表現大幅↑", [O(7, { money: -30000, projectMod: 0.15 }), O(3, { money: -30000, projectMod: 0.03 }, true)]),
      C("維持原計畫|計画どおり進める", "下一階段表現小幅↑|次の段階の表現やや↑", [O(1, { projectMod: 0.05 })])
    ], 1)
  ]);
})();
```

- [ ] **Step 6：登記**

`site_src/starv_page.py`：`"starv_events_3.js",` 之後加 `"starv_events_4.js",`；`"starv_achievements.js",` 之前加 `"starv_projects.js",`、`"starv_projects_1.js",`
`tools/starv_check/sim.js`：`require("../../static_src/starv_events_3.js");` 之後加 `require("../../static_src/starv_events_4.js");`；`require("../../static_src/starv_achievements.js");` 之前加：

```js
require("../../static_src/starv_projects.js");
require("../../static_src/starv_projects_1.js");
```

- [ ] **Step 7：執行，確認通過**

Run: `node tools/starv_check/core_check.js`
Expected: `全部 91 個通過`

- [ ] **Step 8：commit**

```bash
for f in starv_projects starv_projects_1 starv_events_4; do node --check static_src/$f.js || exit 1; done
git add static_src/starv_projects.js static_src/starv_projects_1.js static_src/starv_events_4.js tools/starv_check/core_check.js site_src/starv_page.py tools/starv_check/sim.js
git commit -m "feat(starv): 大型企劃登記器、5 件企劃、企劃分歧事件"
```

---

### Task 2：企劃的進行與結算

**Files:**
- Modify: `static_src/starv_data.js`、`static_src/starv_core.js`、`tools/starv_check/core_check.js`

**Interfaces:**
- Produces:
  - `BAL`：`projectDiffMult: 1.1`、`projectResult: { great: { min: 1.3, money: 3, rep: 500, tickets: 10, fame: 800, stars: 5 }, success: { min: 1.0, money: 1.8, rep: 250, tickets: 5, fame: 400, stars: 4 }, normal: { min: 0.75, money: 1, rep: 100, tickets: 2, fame: 150, stars: 3 }, fail: { min: 0, money: 0.3, rep: 0, tickets: 0, fame: 0, stars: 1 } }`、`projectBranchChance: 1`、`projectLegacy: 3`
  - `st.project = null | { id, stage, startedDay, mod, extraDays, results: [{ ratio, result, members }], active: null | { members:[aid], left } }`、`st.projectQueue`（完成結算，UI 顯示後清掉）、`st.stats.projects`、`st.stats.projectsGreat`
  - `Core.startProject(st, id) → null | "noProject"|"level"|"busyProject"|"money"`
  - `Core.assignStage(st, aids) → null | "noProject"|"stageBusy"|"slots"|"noArtist"|"busy"|"dir"`（成員的主方向或副方向要在該階段的 dirs 裡；行程 `{ kind: "project", days, left, stamina, stress }`）
  - `Core.abortProject(st)`（投資不退）
  - 每天：進行中的階段 `left--`，到 0 結算：每位成員以「自己在 dirs 中的方向」計算 `perfScore`，平均 ×(1 + 組合默契) ×(1 + `mod`) ×隨機 0.85～1.15，除以 `TIERS[tier].diff × 1.1`；成員人氣、熟練度、滿意度依結果增減；`mod` 歸零；有 `branch` 就觸發分歧事件（ctx `{ project }`）
  - 最後一階段結束：平均比率分級 → 資金（投資 × 倍率）、聲望、星探券、參與者人氣與作品（`{ project: id, dir, tier: "S", role: "lead", result, stars, day, isWork: true, pay: 0, title: [0, 0] }`），寫入 `st.projectQueue` 與年表 `project`、日誌 `project_done`；`st.project = null`
  - `projectMod`、`projectDays` fx 作用在 `st.project`
  - `Core.jobTitle(w, lang)`：`w.project` 存在時回傳企劃名
  - `legacyPoints` 加上 `stats.projects × 3`；成就 cond `projects`（`stats.projects`）、`projectsGreat`
  - `Core.VERSION === 5`

- [ ] **Step 1：寫失敗測試**

```js
function projectTeam(st, dirs, n, stat) {
  var out = [];
  for (var i = 0; i < n; i++) {
    var a = freshArtist(st); a.dir = dirs[i % dirs.length];
    D.STATS.forEach(function (s) { a.stats[s] = stat; a.caps[s] = 999; });
    out.push(a);
  }
  return out;
}

test("企劃：開始條件、派遣檢查、階段推進、結算", function () {
  var st = Core.create({ seed: 1 });
  st.board = []; st.boardRefreshDay = 99999;
  eq(Core.startProject(st, "nope"), "noProject");
  eq(Core.startProject(st, "own_variety"), "level");
  st.company.level = 5; st.company.money = 1000;
  eq(Core.startProject(st, "own_variety"), "money");
  st.company.money = 1e7;
  eq(Core.startProject(st, "own_variety"), null);
  eq(st.company.money, 1e7 - 200000); eq(Core.startProject(st, "world_tour"), "busyProject");
  var team = projectTeam(st, ["host", "comedy"], 4, 600);
  var bad = freshArtist(st); bad.dir = "film";
  eq(Core.assignStage(st, [team[0].id, team[1].id, team[2].id]), "slots", "企劃會議 1～2 人");
  eq(Core.assignStage(st, [bad.id]), "dir");
  eq(Core.assignStage(st, [team[0].id, team[1].id]), null);
  eq(team[0].task.kind, "project"); eq(Core.assignStage(st, [team[2].id]), "stageBusy");
  Core.advance(st, 6);
  eq(st.project.stage, 1); eq(st.project.results.length, 1); eq(team[0].task, null, "階段結束成員自由");
  for (var s = 1; s < 3; s++) {
    while (st.events.pending.length) Core.resolveEvent(st, st.events.pending[0].uid, D.EVENT_BY_ID[st.events.pending[0].id].defaultChoice);
    eq(Core.assignStage(st, [team[0].id, team[1].id, team[2].id]), null, "階段 " + s);
    Core.advance(st, D.PROJECT_BY_ID.own_variety.stages[s].days + (st.project ? st.project.extraDays : 0) + 7);
  }
  eq(st.project, null, "完成");
  eq(st.projectQueue.length, 1); eq(st.stats.projects, 1);
  var q = st.projectQueue[0];
  assert(["great", "success"].indexOf(q.result) >= 0, "能力 600 至少成功：" + q.result);
  assert(team[0].works.some(function (w) { return w.project === "own_variety"; }), "作品紀錄");
  eq(Core.jobTitle(team[0].works.filter(function (w) { return w.project; })[0], "zh"), "自家冠名綜藝");
  assert(st.timeline.some(function (x) { return x.kind === "project"; }), "年表");
  eq(Core.legacyPoints(st), 3, "傳承點 +3");
});

test("企劃：分歧事件影響下一階段、放棄不退款", function () {
  var st = Core.create({ seed: 2 });
  st.board = []; st.boardRefreshDay = 99999; st.company.level = 5; st.company.money = 1e7;
  Core.startProject(st, "world_tour");
  var team = projectTeam(st, ["singer", "idol"], 6, 300);   // 第 3 階段換一批人：前兩階段的人體力耗盡會強制休息
  Core.assignStage(st, [team[0].id, team[1].id]); Core.advance(st, 10);
  eq(st.project.stage, 1); eq(st.events.pending.length, 0, "排練沒有分歧");
  Core.assignStage(st, [team[0].id, team[1].id, team[2].id]); Core.advance(st, 15);
  var e = st.events.pending.filter(function (x) { return x.id === "proj_injury"; })[0];
  assert(e && e.ctx.project === "world_tour", "亞洲站後受傷事件");
  Core.resolveEvent(st, e.uid, 1);
  eq(st.project.extraDays, 7, "延期 7 天");
  eq(Core.assignStage(st, [team[3].id, team[4].id, team[5].id]), null);
  eq(team[3].task.days, 15 + 7, "下一階段天數 +7");
  var m0 = st.company.money; Core.abortProject(st);
  eq(st.project, null); eq(st.company.money, m0, "不退款"); eq(team[3].task, null, "成員解除行程");
});

test("存檔版本 5", function () {
  var st = Core.create({ seed: 1 }); st.version = 4; delete st.projectQueue;
  var m = Core.migrate(JSON.parse(JSON.stringify(st)));
  eq(m.version, 5); assert(Array.isArray(m.projectQueue));
});
```

並在「存檔版本 4：補上合約到期日」測試中把 `eq(m.version, 4);` 改成 `eq(m.version, Core.VERSION);`，上方註解 `// 計畫 6 升到版本 5 後改成跟著 Core.VERSION（這個測試只關心合約）`。

- [ ] **Step 2：執行，確認失敗**

Run: `node tools/starv_check/core_check.js`
Expected: 3 個 FAIL

- [ ] **Step 3：實作**

`static_src/starv_data.js` 的 `BAL` 中 `logMax: 200, worksMax: 50` 之前加入：

```js
    projectDiffMult: 1.1, projectBranchChance: 1, projectLegacy: 3,
    projectResult: {
      great: { min: 1.3, money: 3, rep: 500, tickets: 10, fame: 800, stars: 5 },
      success: { min: 1.0, money: 1.8, rep: 250, tickets: 5, fame: 400, stars: 4 },
      normal: { min: 0.75, money: 1, rep: 100, tickets: 2, fame: 150, stars: 3 },
      fail: { min: 0, money: 0.3, rep: 0, tickets: 0, fame: 0, stars: 1 }
    },
```

`static_src/starv_core.js`：
1. `var VERSION = 4;` → `var VERSION = 5;`
2. `blankState` 中 `legacy: { points: 0, perks: {} },` 之後加 `project: null, projectQueue: [],`；`stats:` 物件中 `trophies: 0` 之後加 `, projects: 0, projectsGreat: 0`
3. `jobTitle` 函式開頭（`lang = …` 那行之後）加入：

```js
    if (job.project) { var pj = D.PROJECT_BY_ID && D.PROJECT_BY_ID[job.project]; return pj ? pj.name[lang] : String(job.project); }
```

4. `tickArtists` 中 `if (t.kind !== "job" && t.kind !== "audition" && t.left <= 0)` 改成 `if (t.kind !== "job" && t.kind !== "audition" && t.kind !== "project" && t.left <= 0)`
5. `legacyPoints` 的 `return` 改成：

```js
    return hofThisEra * BAL.legacyHof + st.stats.trophies + st.stats.chartTops + st.stats.projects * BAL.projectLegacy;
```

6. `ACH_CHECKS` 的 `era: …` 那行之前加入：

```js
    projects: function (st) { return st.stats.projects; },
    projectsGreat: function (st) { return st.stats.projectsGreat; },
```

7. `applyFx` 中 `if (fx.rivalPower && e.ctx && e.ctx.rival) {` 那一段之前加入：

```js
    if (st.project && (fx.projectMod || fx.projectDays)) {
      if (fx.projectMod) { st.project.mod += fx.projectMod; out.projectMod = fx.projectMod; }
      if (fx.projectDays) { st.project.extraDays += fx.projectDays; out.projectDays = fx.projectDays; }
    }
```

8. 插在 `  // ==== exports ====` 之前：

```js
  // ==== 大型企劃（§12） ====
  function startProject(st, id) {
    var p = D.PROJECT_BY_ID && D.PROJECT_BY_ID[id];
    if (!p) return "noProject";
    if (st.company.level < p.unlockLevel) return "level";
    if (st.project) return "busyProject";
    if (st.company.money < p.cost) return "money";
    st.company.money -= p.cost;
    st.project = { id: id, stage: 0, startedDay: st.day, mod: 0, extraDays: 0, results: [], active: null };
    log(st, "project_start", { project: id });
    return null;
  }

  function stageDirFor(a, stage) {
    if (stage.dirs.indexOf(a.dir) >= 0) return a.dir;
    for (var i = 0; i < a.subDirs.length; i++) if (stage.dirs.indexOf(a.subDirs[i]) >= 0) return a.subDirs[i];
    return null;
  }

  function assignStage(st, aids) {
    var pr = st.project;
    if (!pr) return "noProject";
    if (pr.active) return "stageBusy";
    var stage = D.PROJECT_BY_ID[pr.id].stages[pr.stage];
    if (!aids || aids.length < stage.slots[0] || aids.length > stage.slots[1]) return "slots";
    var i;
    for (i = 0; i < aids.length; i++) if (aids.indexOf(aids[i]) !== i) return "slots";
    for (i = 0; i < aids.length; i++) {
      var a = artistById(st, aids[i]);
      if (!a) return "noArtist";
      if (a.task) return "busy";
      if (!stageDirFor(a, stage)) return "dir";
    }
    var days = stage.days + pr.extraDays, load = D.TIERS[stage.tier].load;
    pr.extraDays = 0;
    pr.active = { members: aids.slice(), left: days };
    aids.forEach(function (id) {
      artistById(st, id).task = { kind: "project", days: days, left: days,
        stamina: Math.min(BAL.jobStaminaMax, days * BAL.jobStaminaPerDay * load), stress: Math.min(BAL.jobStressMax, days * BAL.jobStressPerDay * load) };
    });
    return null;
  }

  function abortProject(st) {
    if (!st.project) return;
    if (st.project.active) st.project.active.members.forEach(function (id) { var a = artistById(st, id); if (a && a.task && a.task.kind === "project") a.task = null; });
    log(st, "project_abort", { project: st.project.id });
    st.project = null;
  }

  function classifyProject(ratio) {
    var R = BAL.projectResult;
    return ratio >= R.great.min ? "great" : ratio >= R.success.min ? "success" : ratio >= R.normal.min ? "normal" : "fail";
  }

  function resolveStage(st) {
    var pr = st.project, p = D.PROJECT_BY_ID[pr.id], stage = p.stages[pr.stage];
    var members = pr.active.members.map(function (id) { return artistById(st, id); }).filter(Boolean);
    var ratio = 0;
    if (members.length) {
      var sum = 0;
      members.forEach(function (a) { sum += perfScore(st, a, { dir: stageDirFor(a, stage) || a.dir }); });
      var perf = sum / members.length * (1 + chemistry(st, pr.active.members)) * (1 + pr.mod) * (BAL.randLo + rnd(st) * (BAL.randHi - BAL.randLo));
      ratio = perf / (D.TIERS[stage.tier].diff * BAL.projectDiffMult);
    }
    var res = ratio >= D.RESULTS.great.min ? "great" : ratio >= D.RESULTS.success.min ? "success" : ratio >= D.RESULTS.normal.min ? "normal" : "fail";
    var R = D.RESULTS[res], tierIdx = D.TIER_ORDER.indexOf(stage.tier);
    members.forEach(function (a) {
      a.task = null;
      a.fame = clamp(a.fame + Math.round(D.TIERS[stage.tier].fame * R.fame), 0, 99999);
      addProf(a, stageDirFor(a, stage) || a.dir, R.xp * (tierIdx + 1));
      a.satisfaction = clamp(a.satisfaction + R.sat, 0, 100);
      postTask(st, a);
    });
    pr.results.push({ ratio: Math.round(ratio * 100) / 100, result: res, members: pr.active.members.slice() });
    pr.active = null;
    pr.mod = 0;
    log(st, "project_stage", { project: pr.id, stage: pr.stage, result: res });
    pr.stage++;
    if (pr.stage >= p.stages.length) { finishProject(st); return; }
    if (stage.branch && rnd(st) < BAL.projectBranchChance) pushEvent(st, stage.branch, null, { project: pr.id });
  }

  function finishProject(st) {
    var pr = st.project, p = D.PROJECT_BY_ID[pr.id];
    var avg = pr.results.reduce(function (s, r) { return s + Math.min(2, r.ratio); }, 0) / pr.results.length;
    var res = classifyProject(avg), R = BAL.projectResult[res];
    var money = Math.round(p.cost * R.money);
    st.company.money += money;
    st.company.tickets += R.tickets;
    if (R.rep) addRep(st, R.rep);
    var seen = {}, members = [];
    pr.results.forEach(function (r) { r.members.forEach(function (id) { if (!seen[id]) { seen[id] = true; members.push(id); } }); });
    members.forEach(function (id) {
      var a = artistById(st, id);
      if (!a) return;
      a.fame = clamp(a.fame + R.fame, 0, 99999);
      a.works.unshift({ project: p.id, title: [0, 0], dir: a.dir, tier: "S", role: "lead", result: res, stars: R.stars, day: st.day, isWork: true, pay: 0 });
      if (a.works.length > BAL.worksMax) a.works.length = BAL.worksMax;
      a.worksTotal++;
    });
    st.stats.projects++;
    if (res === "great") st.stats.projectsGreat++;
    var summary = { id: newId(st, "pq"), project: p.id, result: res, ratio: Math.round(avg * 100) / 100, money: money, invested: p.cost,
      tickets: R.tickets, rep: R.rep, members: members, stages: pr.results.map(function (r) { return r.result; }) };
    st.projectQueue.push(summary);
    timeline(st, "project", { project: p.id, result: res });
    log(st, "project_done", { project: p.id, result: res, money: money });
    st.project = null;
  }

  function tickProject(st) {
    var pr = st.project;
    if (!pr || !pr.active) return;
    pr.active.left--;
    if (pr.active.left <= 0) resolveStage(st);
  }
```

9. `advanceDay` 中 `tickAuditions(st);` 之後加 `tickProject(st);`
10. exports 區塊加入：

```js
  api.startProject = startProject;
  api.assignStage = assignStage;
  api.abortProject = abortProject;
```

11. `migrate` 中 `if (!st.legacy) …` 那行之前加：`if (!st.projectQueue) st.projectQueue = [];`（`fillDefaults` 已補，這行是保險）

- [ ] **Step 4：執行，確認通過**

Run: `node tools/starv_check/core_check.js`
Expected: `全部 94 個通過`

- [ ] **Step 5：commit**

```bash
node --check static_src/starv_core.js && node --check static_src/starv_data.js
git add static_src/starv_core.js static_src/starv_data.js tools/starv_check/core_check.js
git commit -m "feat(starv): 大型企劃的派遣、階段結算、分歧與最終結算、存檔版本 5"
```

---

### Task 3：企劃成就與模擬

**Files:**
- Create: `static_src/starv_achievements_2.js`
- Modify: `tools/starv_check/core_check.js`、`tools/starv_check/sim.js`、`site_src/starv_page.py`

**Interfaces:**
- Produces:
  - 成就 v2：`first_project`（完成 1 件大型企劃，券 5）、`great_project`（大型企劃大成功，券 10）
  - sim：積極經營在公司 Lv ≥ 企劃解鎖等級、資金 ≥ 費用 × 2 時開始可做的最貴企劃；每天若階段空著，就從空閒藝人中挑「在 dirs 裡、能力合計最高」的人，人數取 `slots[1]`（不足則取能湊到的人數，少於 `slots[0]` 就等）；分歧事件照預設處理；表格加上 `proj`（累計完成數）；WARN：「積極經營 30 年沒有完成任何大型企劃」

- [ ] **Step 1：寫失敗測試**

`core_check.js` 的 `require("../../static_src/starv_achievements_1.js");` 之後加 `require("../../static_src/starv_achievements_2.js");`

插在 `// ==== run ====` 之前：

```js
test("成就 v2：企劃", function () {
  eq(Ach.all().filter(function (x) { return x.addedIn === "v2"; }).length, 2);
  var st = Core.create({ seed: 1 }); st.stats.projects = 1; st.board = []; st.boardRefreshDay = 99999;
  Core.advance(st, 1);
  assert(st.achievements.first_project && !st.achievements.great_project, "完成 1 件");
});
```

- [ ] **Step 2：執行，確認失敗**

Run: `node tools/starv_check/core_check.js`
Expected: `Cannot find module '../../static_src/starv_achievements_2.js'`

- [ ] **Step 3：建立 `static_src/starv_achievements_2.js`**

```js
// 明星經紀 starV：成就 v2——大型企劃。
(function () {
  "use strict";

  var root = typeof window !== "undefined" ? window : globalThis;
  var T = root.PriTestStarvData.T;

  function A(id, name, desc, type, n, tickets) {
    return { id: id, addedIn: "v2", name: T(name), desc: T(desc), cond: { type: type, n: n }, reward: { tickets: tickets } };
  }

  root.PriTestStarvAchievements.add([
    A("first_project", "大製作|ビッグプロジェクト", "完成第一件大型企劃|初めての大型企画を完遂", "projects", 1, 5),
    A("great_project", "傳說級企劃|伝説の企画", "大型企劃大成功|大型企画で大成功", "projectsGreat", 1, 10)
  ]);
})();
```

在 Task 4 的「成就：20 項、格式、解鎖給券」測試中，TYPES 陣列最後加上 `"projects", "projectsGreat"`。

`site_src/starv_page.py`：`"starv_achievements_1.js",` 之後加 `"starv_achievements_2.js",`；`tools/starv_check/sim.js`：`require("../../static_src/starv_achievements_1.js");` 之後加 `require("../../static_src/starv_achievements_2.js");`

- [ ] **Step 4：sim 加入企劃**

在 `sim.js` 的 `runScenario` 函式之前加入：

```js
// 積極經營：做得起就開最貴的企劃；階段空著就派「在 dirs 裡、能力合計最高」的空閒藝人
function runProject(st) {
  if (!st.project) {
    var can = D.PROJECTS.filter(function (p) { return st.company.level >= p.unlockLevel && st.company.money >= p.cost * 2; })
      .sort(function (x, y) { return y.cost - x.cost; })[0];
    if (can) Core.startProject(st, can.id);
    return;
  }
  if (st.project.active) return;
  var stage = D.PROJECT_BY_ID[st.project.id].stages[st.project.stage];
  var pool = st.artists.filter(function (a) {
    return !a.task && (stage.dirs.indexOf(a.dir) >= 0 || a.subDirs.some(function (d) { return stage.dirs.indexOf(d) >= 0; }));
  }).sort(function (x, y) { return power(y) - power(x); });
  if (pool.length >= stage.slots[0]) Core.assignStage(st, pool.slice(0, stage.slots[1]).map(function (a) { return a.id; }));
}
function power(a) { var s = 0; D.STATS.forEach(function (k) { s += a.stats[k]; }); return s; }
```

在迴圈中 `if (name === "active") activeAssign(st);` 之前加入 `if (name === "active") runProject(st);`（先讓企劃挑人，剩下的人再接一般工作）

`rows.push({ … })` 中加入 `proj: st.stats.projects,`（新紀元會把統計歸零；只看本紀元）

平衡期望區塊加入：

```js
if (YEARS >= 30 && !active.st.timeline.some(function (x) { return x.kind === "project"; })) warn("積極經營 30 年沒有完成任何大型企劃");
```

- [ ] **Step 5：執行**

```bash
node tools/starv_check/core_check.js
node tools/starv_check/sim.js 30
```

Expected：`全部 95 個通過`；sim `不變量全部通過`。若出現 WARN「沒有完成任何大型企劃」或資金過剩 WARN，只調 `BAL.projectResult` 的 `money` 倍率或企劃 `cost`（每次一項），結果寫進 commit message。

- [ ] **Step 6：commit**

```bash
node --check static_src/starv_achievements_2.js
git add static_src/starv_achievements_2.js tools/starv_check/core_check.js tools/starv_check/sim.js site_src/starv_page.py
git commit -m "feat(starv): 企劃成就、模擬加入大型企劃"
```

---

### Task 4：UI——企劃分頁與完成結算

**Files:**
- Create: `static_src/starv_view_projects.js`
- Modify: `static_src/starv_events_ui.js`、`static_src/starv_log.js`、`site_src/starv_page.py`、`site_src/i18n_starv.py`、`static_src/css/starv.css`、`tools/starv_check/ui_check.js`

**Interfaces:**
- Produces:
  - 分頁 `{ id: "projects", order: 25, icon: "🎪", labelKey: "sv_tab_projects" }`
  - 沒有進行中企劃：企劃卡 `.sv-proj-card`，開始鈕 `data-act="proj-start-<id>"`（未解鎖顯示所需等級）
  - 進行中：階段清單 `.sv-proj-stage`（完成的顯示結果）、目前階段的派遣清單（勾選框 `.sv-proj-pick input[data-aid]`）、派遣鈕 `data-act="proj-assign"`、放棄 `data-act="proj-abort"` → `data-act="proj-abort-confirm"`
  - 完成結算彈窗 class `sv-proj-result`，`data-act="proj-result-close"`（`st.projectQueue` 自動彈出）
  - 行程文字 `sv_task_project`；fx 文字 `projectMod`、`projectDays`；日誌 `project_start`、`project_stage`、`project_done`、`project_abort`

- [ ] **Step 1：在 `ui_check.js` 追加步驟**

```js
step("企劃：開始 → 派遣 → 完成結算", async function (page) {
  await page.evaluate(function () {
    window.PriTestStarv.app.act(function (s) {
      s.company.level = Math.max(s.company.level, 5); s.company.money = 1e7; s.events.pending = [];
      // 前一個步驟開了新紀元（不帶人），先補幾位藝人
      while (s.artists.length < 5) s.artists.push(window.PriTestStarvCore._genR(s));
      s.artists.forEach(function (a) { a.task = null; a.dir = "host"; window.PriTestStarvData.STATS.forEach(function (k) { a.stats[k] = 600; a.caps[k] = 999; }); });
    });
  });
  await tab(page, "projects");
  await noRawKeys(page, "企劃分頁");
  await act(page, "proj-start-own_variety");
  for (var stage = 0; stage < 3; stage++) {
    await clearEvents(page);
    await page.waitForSelector(".sv-proj-pick input[data-aid]");
    var ids = await page.$$eval(".sv-proj-pick input[data-aid]", function (xs) { return xs.map(function (x) { return x.getAttribute("data-aid"); }); });
    var need = await page.evaluate(function () { var s = window.PriTestStarv.state(); return window.PriTestStarvData.PROJECT_BY_ID[s.project.id].stages[s.project.stage].slots[0]; });
    for (var i = 0; i < need; i++) await page.check('.sv-proj-pick input[data-aid="' + ids[i] + '"]');
    await act(page, "proj-assign");
    await noRawKeys(page, "企劃進行中");
    await page.evaluate(function () { window.PriTestStarv.app.skip(30); });
  }
  await clearEvents(page);
  await page.waitForSelector(".sv-proj-result");
  await noRawKeys(page, "企劃結算");
  await act(page, "proj-result-close");
  var s = await st(page);
  assert.strictEqual(s.project, null); assert.strictEqual(s.projectQueue.length, 0); assert.strictEqual(s.stats.projects, 1);
});
```

並把「三種語言…」步驟的 tabs 陣列改成 `["artists", "jobs", "projects", "industry", "gacha", "hall", "company"]`。

- [ ] **Step 2：執行，確認失敗**

Run: `py -3 generate.py && node tools/starv_check/ui_check.js`
Expected: `FAIL 三種語言…`（還沒有 `projects` 分頁）

- [ ] **Step 3：追加字串**

```python
    # ---- 大型企劃 ----
    ("sv_tab_projects", "企劃", "企画"),
    ("sv_task_project", "企劃", "企画"),
    ("sv_proj_intro", "大型企劃需要先投資，分成幾個階段，每個階段派不同方向的藝人。最後依累計成績結算：大成功能拿回好幾倍，失敗就會虧損。同時只能進行一件。", "大型企画は先に投資し、いくつかの段階に分かれ、段階ごとに別分野のタレントを派遣する。最後に通算成績で精算：大成功なら数倍、失敗すれば赤字。同時に一件だけ。"),
    ("sv_proj_locked", "公司 Lv{lv} 解鎖", "事務所 Lv{lv} で解放"),
    ("sv_proj_cost", "投資 {m}", "投資 {m}"),
    ("sv_proj_stages", "{n} 個階段", "{n} 段階"),
    ("sv_proj_start", "開始企劃", "企画を始める"),
    ("sv_proj_stage_info", "{dirs}・{min}～{max} 人・{tier} 級・{days} 天", "{dirs}・{min}～{max} 人・{tier} ランク・{days} 日"),
    ("sv_proj_now", "目前階段", "現在の段階"),
    ("sv_proj_running", "進行中：{names}（剩 {n} 天）", "進行中：{names}（残り {n} 日）"),
    ("sv_proj_pick", "選 {min}～{max} 位（主方向或副方向要符合）", "{min}～{max} 人を選ぶ（メインかサブが一致）"),
    ("sv_proj_none_free", "目前沒有符合方向的空閒藝人", "条件に合う空いているタレントがいない"),
    ("sv_proj_assign", "派遣", "派遣する"),
    ("sv_proj_mod", "下一階段修正 {v}%", "次の段階の補正 {v}%"),
    ("sv_proj_abort", "放棄企劃", "企画を中止"),
    ("sv_proj_abort_confirm", "確定放棄（投資不會退還）", "中止する（投資は戻らない）"),
    ("sv_proj_result_title", "企劃完成：{name}", "企画完了：{name}"),
    ("sv_proj_result_great", "大成功！", "大成功！"),
    ("sv_proj_result_success", "成功", "成功"),
    ("sv_proj_result_normal", "還算順利", "まずまず"),
    ("sv_proj_result_fail", "失敗了…", "失敗…"),
    ("sv_proj_result_money", "收入 {m}（投資 {c}）", "収入 {m}（投資 {c}）"),
    ("sv_proj_result_stages", "各階段：{list}", "各段階：{list}"),
    ("sv_err_noProject", "沒有這個企劃", "企画がありません"),
    ("sv_err_busyProject", "已經有進行中的企劃", "進行中の企画があります"),
    ("sv_err_stageBusy", "這個階段已經在進行了", "この段階はすでに進行中です"),
    ("sv_fx_projectMod", "企劃下一階段 {v}%", "企画の次の段階 {v}%"),
    ("sv_fx_projectDays", "企劃下一階段 +{n} 天", "企画の次の段階 +{n} 日"),
    ("sv_log_project_start", "開始大型企劃「{title}」", "大型企画「{title}」を開始"),
    ("sv_log_project_stage", "「{title}」第 {n} 階段：{result}", "「{title}」第 {n} 段階：{result}"),
    ("sv_log_project_done", "「{title}」完成：{result}！收入 {pay}", "「{title}」完了：{result}！収入 {pay}"),
    ("sv_log_project_abort", "放棄了「{title}」", "「{title}」を中止した"),
    ("sv_tl_project", "大型企劃「{title}」{result}", "大型企画「{title}」{result}"),
```

- [ ] **Step 4：fx 與日誌文字**

`static_src/starv_events_ui.js` 的 `fxLines` 中 `if (fx.retained && ev) …` 那行之後加入：

```js
    if (fx.projectMod) out.push(t("sv_fx_projectMod", { v: signed(Math.round(fx.projectMod * 100)) }));
    if (fx.projectDays) out.push(t("sv_fx_projectDays", { n: fx.projectDays }));
```

`static_src/starv_log.js` 的 `text` 函式中 `else if (e.type === "new_era") p.era = d.era;` 之後加入：

```js
    else if (/^project_/.test(e.type)) {
      var pj = D.PROJECT_BY_ID && D.PROJECT_BY_ID[d.project];
      p.title = pj ? UI.L(pj.name) : String(d.project);
      if (d.stage != null) p.n = d.stage + 1;
      if (d.result) p.result = t(e.type === "project_done" ? "sv_proj_result_" + d.result : "sv_result_" + d.result);
      if (d.money != null) p.pay = UI.money(d.money);
    }
```

`static_src/starv_view_hall.js` 的 `tlText` 中 `if (x.kind === "era") …` 那行之後加入：

```js
    if (x.kind === "project") {
      var pj = D.PROJECT_BY_ID && D.PROJECT_BY_ID[d.project];
      return t("sv_tl_project", { title: pj ? UI.L(pj.name) : d.project, result: t("sv_proj_result_" + d.result) });
    }
```

（`starv_view_hall.js` 也要加進本 Task 的 Files 與 commit。）

- [ ] **Step 5：建立 `static_src/starv_view_projects.js`**

```js
// 明星經紀 starV：「企劃」分頁（大型企劃的選擇、派遣、進度、完成結算；規格 §12）。
(function () {
  "use strict";

  var D = window.PriTestStarvData;
  var Core = window.PriTestStarvCore;
  var UI = window.PriTestStarvUI;
  var t = UI.t, el = UI.el;
  var view = { pick: {}, confirmAbort: false };
  var showing = null;

  function report(err) { if (err) UI.toast(t("sv_err_" + err), "bad"); }
  function stageInfo(s) {
    return t("sv_proj_stage_info", { dirs: s.dirs.map(function (d) { return UI.dirIcon(d); }).join(""), min: s.slots[0], max: s.slots[1], tier: s.tier, days: s.days });
  }

  function listView(st, App) {
    return el("div", { class: "sv-proj-list" }, D.PROJECTS.map(function (p) {
      var locked = st.company.level < p.unlockLevel;
      return el("div", { class: "sv-card sv-proj-card" + (locked ? " sv-proj-locked" : "") }, [
        el("h3", { text: UI.L(p.name) }),
        el("p", { class: "sv-small sv-muted", text: UI.L(p.desc) }),
        el("div", { class: "sv-row" }, [
          el("span", { class: "sv-chip", text: t("sv_proj_cost", { m: UI.money(p.cost) }) }),
          el("span", { class: "sv-chip", text: t("sv_proj_stages", { n: p.stages.length }) })
        ]),
        el("ol", { class: "sv-proj-stages" }, p.stages.map(function (s) { return el("li", { class: "sv-small", text: UI.L(s.name) + "：" + stageInfo(s) }); })),
        locked ? el("div", { class: "sv-warn sv-small", text: t("sv_proj_locked", { lv: p.unlockLevel }) })
          : el("div", { class: "sv-row sv-row-end" }, [UI.btn(t("sv_proj_start"), function () {
            report(App.act(function (s) { return Core.startProject(s, p.id); }));
          }, st.company.money >= p.cost ? "sv-btn-primary" : "sv-btn-ghost", { "data-act": "proj-start-" + p.id })])
      ]);
    }));
  }

  function names(st, ids) { return ids.map(function (id) { var a = Core.artistById(st, id); return a ? UI.name(a) : "—"; }).join("、"); }

  function activeView(st, App) {
    var pr = st.project, p = D.PROJECT_BY_ID[pr.id], wrap = el("div", {});
    wrap.appendChild(el("div", { class: "sv-card" }, [
      el("h3", { text: UI.L(p.name) }),
      el("ol", { class: "sv-proj-stages" }, p.stages.map(function (s, i) {
        var r = pr.results[i];
        return el("li", { class: "sv-proj-stage" + (i === pr.stage ? " sv-proj-current" : "") }, [
          el("b", { text: UI.L(s.name) }), " ",
          r ? el("span", { class: "sv-res sv-res-" + r.result, text: t("sv_result_" + r.result) }) : null,
          el("div", { class: "sv-small sv-muted", text: stageInfo(s) })
        ]);
      })),
      pr.mod ? el("div", { class: "sv-small sv-warn", text: t("sv_proj_mod", { v: Math.round(pr.mod * 100) }) }) : null
    ]));
    var stage = p.stages[pr.stage], card = el("div", { class: "sv-card" }, [el("h3", { text: t("sv_proj_now") + "：" + UI.L(stage.name) })]);
    if (pr.active) card.appendChild(el("p", { text: t("sv_proj_running", { names: names(st, pr.active.members), n: pr.active.left }) }));
    else {
      var free = st.artists.filter(function (a) { return !a.task && (stage.dirs.indexOf(a.dir) >= 0 || a.subDirs.some(function (d) { return stage.dirs.indexOf(d) >= 0; })); });
      Object.keys(view.pick).forEach(function (id) { if (!free.some(function (a) { return a.id === id; })) delete view.pick[id]; });
      card.appendChild(el("p", { class: "sv-small", text: t("sv_proj_pick", { min: stage.slots[0], max: stage.slots[1] }) }));
      card.appendChild(free.length ? el("div", { class: "sv-group-pick sv-proj-pick" }, free.map(function (a) {
        var box = el("input", { type: "checkbox", "data-aid": a.id, checked: !!view.pick[a.id],
          onchange: function () { if (box.checked) view.pick[a.id] = true; else delete view.pick[a.id]; } });
        return el("label", { class: "sv-pick" }, [box, UI.avatar(a, 32), el("span", { text: UI.name(a) + " " + UI.dirIcon(a.dir) })]);
      })) : el("p", { class: "sv-muted", text: t("sv_proj_none_free") }));
      card.appendChild(el("div", { class: "sv-row sv-row-end" }, [UI.btn(t("sv_proj_assign"), function () {
        var err = App.act(function (s) { return Core.assignStage(s, Object.keys(view.pick)); });
        if (err) report(err); else view.pick = {};
      }, "sv-btn-primary", { "data-act": "proj-assign" })]));
    }
    wrap.appendChild(card);
    wrap.appendChild(el("div", { class: "sv-row sv-row-end" }, [view.confirmAbort
      ? UI.btn(t("sv_proj_abort_confirm"), function () { view.confirmAbort = false; App.act(function (s) { Core.abortProject(s); }); }, "sv-btn-danger", { "data-act": "proj-abort-confirm" })
      : UI.btn(t("sv_proj_abort"), function () { view.confirmAbort = true; App.render(); }, "sv-btn-ghost", { "data-act": "proj-abort" })]));
    return wrap;
  }

  function openResult(App, q) {
    showing = q.id;
    var p = D.PROJECT_BY_ID[q.project];
    UI.openModal(function (box, close) {
      var st = App.st();
      box.appendChild(UI.modalHead(t("sv_proj_result_title", { name: p ? UI.L(p.name) : q.project }), close));
      box.appendChild(el("h2", { class: "sv-proj-result-head sv-res-text-" + q.result, text: t("sv_proj_result_" + q.result) }));
      box.appendChild(el("ul", { class: "sv-report-list" }, [
        el("li", { text: t("sv_proj_result_money", { m: UI.money(q.money), c: UI.money(q.invested) }) }),
        el("li", { text: t("sv_report_tickets", { v: "+" + q.tickets }) }),
        el("li", { text: t("sv_report_rep", { v: "+" + UI.num(q.rep) }) }),
        el("li", { text: t("sv_proj_result_stages", { list: q.stages.map(function (r) { return t("sv_result_" + r); }).join(" → ") }) })
      ]));
      box.appendChild(el("div", { class: "sv-group-avatars" }, q.members.map(function (id) { var a = Core.artistById(st, id); return a ? UI.avatar(a, 44) : null; })));
      box.appendChild(el("div", { class: "sv-row sv-row-end" }, [UI.btn(t("sv_close"), close, "sv-btn-primary", { "data-act": "proj-result-close" })]));
    }, { cls: "sv-proj-result", onClose: function () {
      showing = null;
      App.act(function (s) { s.projectQueue = s.projectQueue.filter(function (x) { return x.id !== q.id; }); });
    } });
  }

  UI.addExtra(function (App) {
    var st = App.st();
    if (!st.projectQueue || !st.projectQueue.length || showing || UI.modalIsOpen()) return null;
    var q = st.projectQueue[0];
    setTimeout(function () { if (!showing && !UI.modalIsOpen()) openResult(App, q); }, 0);
    return null;
  });

  UI.register({
    id: "projects", order: 25, icon: "🎪", labelKey: "sv_tab_projects",
    render: function (c, App) {
      var st = App.st();
      c.appendChild(el("p", { class: "sv-small sv-muted", text: t("sv_proj_intro") }));
      c.appendChild(st.project ? activeView(st, App) : listView(st, App));
    }
  });
})();
```

`site_src/starv_page.py`：`"starv_view_jobs.js",` 之後加 `"starv_view_projects.js",`

附加到 `starv.css`：

```css
/* ---- 大型企劃 ---- */
.sv-proj-list { display: grid; gap: 0.8rem; }
.sv-proj-card { border-color: rgba(255, 95, 168, 0.4); }
.sv-proj-locked { opacity: 0.55; }
.sv-proj-stages { margin: 0.5rem 0; padding-left: 1.4rem; line-height: 1.7; }
.sv-proj-stage { padding: 0.25rem 0; }
.sv-proj-current { color: var(--sv-gold); }
.sv-proj-result { text-align: center; }
.sv-proj-result .sv-report-list { text-align: left; }
.sv-proj-result-head { font-size: 1.8em; margin: 0.4rem 0; }
.sv-res-text-great { color: var(--sv-gold); text-shadow: 0 0 18px rgba(255, 214, 107, 0.6); }
.sv-res-text-success { color: var(--sv-good); }
.sv-res-text-fail { color: var(--sv-bad); }
```

- [ ] **Step 6：建置並執行全部檢查**

```bash
py -3 generate.py && py -3 tools/split_css.py --check
for f in static_src/starv*.js; do node --check "$f" || exit 1; done
node tools/starv_check/core_check.js
node tools/starv_check/sim.js 30
node tools/starv_check/ui_check.js
```

Expected：`core_check` 全部 95 個通過；`sim` 不變量全部通過；`ui_check` 全部 20 個步驟通過。

- [ ] **Step 7：檢視截圖**

用 Read 打開 `tools/starv_check/shots/tab-projects.png`，確認企劃卡、階段清單沒有溢出；底部 7 個分頁鈕沒有擠壓變形。

- [ ] **Step 8：commit**

```bash
git add static_src/starv_view_projects.js static_src/starv_view_hall.js static_src/starv_events_ui.js static_src/starv_log.js site_src/starv_page.py site_src/i18n_starv.py static_src/css/starv.css tools/starv_check/ui_check.js
git commit -m "feat(starv): 企劃分頁（選擇、派遣、進度、完成結算）"
```
