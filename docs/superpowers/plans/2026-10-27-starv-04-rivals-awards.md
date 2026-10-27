# starV 計畫 4：對手公司、排行榜、頒獎典禮 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 加入規格 §9（對手公司、宿敵明星、競爭試鏡、搶工作、月度排行榜、合作／惡鬥事件、興衰）與 §10（年度頒獎典禮，55 個獎項），以及業界分頁的對手、排行榜、典禮演出。

**Architecture:** 宿敵明星沿用名錄登記器（`kind: "rival"`，不進抽卡池），首批放在 `starv_roster_rivals_1.js`；對手公司、排行榜、頒獎、試鏡都寫在 `starv_core.js`。獎項與排行榜定義放在新資料檔 `starv_awards_data.js`（資料驅動，新增方向只補資料）。對手相關事件放在 `starv_events_2.js`（`addedIn: "v2"`），事件引擎補上 `rival` 旗標與 `rivalPower` 效果。UI：業界分頁加對手卡、排行榜、典禮紀錄；新檔 `starv_awards_ui.js` 負責頒獎典禮演出。存檔版本升到 3。

**Tech Stack:** Vanilla ES5、node 單元測試、Playwright。

## Global Constraints

- 規格 §9：市場保持 5 家對手；實力過低倒閉退場（旗下宿敵明星可能流入玩家候補名單），並有新公司遞補
- 規格 §9：A／S 級工作改為試鏡制，報名 1 天後公布結果；落選沒有懲罰，但該期間被佔用
- 規格 §9：看板工作每天有機率被對手拿走，工作先標示「X 社有興趣」
- 規格 §9：月度排行榜 4 種（單曲、收視率、票房、人氣）各前 10；拿下第 1 名獲得聲望
- 規格 §10：每年 12/30（`day % 360 === 359`）頒獎；入圍前 5 名（入圍本身加人氣）；得獎依分數加權隨機；獎座記在藝人身上；55 個獎項，16 個方向每個都至少有個人獎與作品獎
- 規格 §4：宿敵明星可以追加（ID `rv###` 永不重用）
- 規格 §7：對手事件需要對手名稱；文字佔位 `{rival}`（公司名）、`{star}`（宿敵明星名）
- 舊存檔（version 2）必須能讀：`migrate` 補上 `rivals`、`auditions`、`charts`、`awards`、`company.repYearStart`、藝人 `trophies`
- 計畫 1–3 的既有測試要繼續通過（`core_check.js` 已關閉隨機事件；對手的每日搶工作在舊測試中可能改變看板，必要時在測試中把 `BAL.snatchChance`、`BAL.snatchInterestChance` 設為 0）
- CLAUDE.md §5.2.1 前綴；推送前遞增版本號（新功能 → minor）

## 檔案結構

| 檔案 | 責任 |
| --- | --- |
| Modify `static_src/starv_roster.js` | `byRarity` 排除 `kind: "rival"`；新增 `rivals()` |
| Create `static_src/starv_roster_rivals_1.js` | 首批宿敵明星 10 位 |
| Modify `static_src/starv_data.js` | 對手公司名詞庫、對手與試鏡、排行榜、頒獎的平衡常數 |
| Create `static_src/starv_awards_data.js` | `D.CHARTS`（4 種排行榜）、`D.AWARDS`（55 獎項）、`D.CEREMONIES` |
| Create `static_src/starv_events_2.js` | 6 種對手事件（`addedIn: "v2"`、`rival: true`） |
| Modify `static_src/starv_core.js` | 對手公司、宿敵明星、試鏡、搶工作、排行榜、頒獎、對手事件、存檔版本 3 |
| Modify `tools/starv_check/core_check.js`、`tools/starv_check/sim.js` | 測試與模擬 |
| Create `static_src/starv_awards_ui.js` | 頒獎典禮演出（自動播放新一屆、重看歷屆） |
| Modify `static_src/starv_view_industry.js` | 對手公司卡、排行榜卡、典禮紀錄卡 |
| Modify `static_src/starv_view_jobs.js`、`static_src/starv_view_artists.js` | 試鏡／有興趣標示、「報名試鏡」、試鏡中行程文字 |
| Modify `static_src/starv_events_ui.js`、`static_src/starv_log.js`、`static_src/starv_view_company.js` | `{rival}`／`{star}`、`rivalPower` 效果文字、新日誌、debug 頒獎鈕 |
| Modify `site_src/starv_page.py`、`site_src/i18n_starv.py`、`static_src/css/starv.css`、`tools/starv_check/ui_check.js` | 登記、字串、樣式、流程 |

插入慣例同計畫 2、3。

---

### Task 1：宿敵明星名錄與對手公司

**Files:**
- Modify: `static_src/starv_roster.js`、`static_src/starv_data.js`、`static_src/starv_core.js`、`tools/starv_check/core_check.js`、`site_src/starv_page.py`、`tools/starv_check/sim.js`
- Create: `static_src/starv_roster_rivals_1.js`

**Interfaces:**
- Produces:
  - `Roster.byRarity(r)` 只回傳 `kind !== "rival"` 的角色；`Roster.rivals()` 回傳宿敵明星
  - 宿敵明星項目：與 SR/SSR 名錄相同欄位，另加 `kind: "rival"`
  - `D.RIVAL_NAME = { a: [{zh,ja}], b: [{zh,ja}] }`
  - `BAL`：`rivalCount: 5`、`rivalPowerStart: [80, 140]`、`rivalPowerNew: [80, 120]`、`rivalBankrupt: 40`、`rivalShockChance: 0.12`、`rivalPerfDiv: 400`、`rivalYearGrowth: 0.08`、`rivalStarJoinChance: 0.5`
  - `st.rivals[i] = { id:"r<n>", name:[ia, ib], power, stars:[{ rosterId, stats:{6}, fame, age }], founded }`
  - `Core.rivalById(st, id)`、`Core.rivalName(rival, lang) → string`、`Core.rivalStarName(star, lang)`
  - 每月：宿敵明星人氣 `+= round(power / 10 × 隨機 0.5～1.5)`
  - 每年（1/1，在 `yearly` 之後）：對手實力 ×0.97～1.09；`rivalShockChance` 機率醜聞 ×0.6（日誌 `rival_scandal`）；宿敵明星年齡 +1、能力 ×1.04（上限 999）；超過方向引退線就引退（日誌 `rival_star_retire`）並補一位沒被用過的宿敵明星；實力 < 40 的公司倒閉（日誌 `rival_bankrupt`），旗下明星各有 50% 機率進入玩家的入社流程（日誌 `rival_star_join`，接著是一般的 `join`／`waitlist`／`lost`），並成立新公司遞補（日誌 `rival_new`）
  - 內部：`industryGrowth(st) = 1 + floor(day / 360) × rivalYearGrowth`、`rivalScore(st, r, base) = base × power / 100 × industryGrowth × 隨機 0.6～1.4`、`rivalStarPerf(r, star, dir)`
  - `Core.VERSION === 3`；`migrate` 為舊存檔建立對手

- [ ] **Step 1：寫失敗測試**

`core_check.js` 的 `require("../../static_src/starv_roster_1.js");` 之後加入：

```js
require("../../static_src/starv_roster_rivals_1.js");
```

插在 `// ==== run ====` 之前：

```js
test("對手：初始 5 家、名字與宿敵明星不重複、不進抽卡池", function () {
  var st = Core.create({ seed: 3 });
  eq(st.rivals.length, 5);
  var names = {}, stars = {};
  st.rivals.forEach(function (r) {
    var n = Core.rivalName(r, "zh");
    assert(!names[n], "公司名重複 " + n); names[n] = 1;
    assert(r.power >= 80 && r.power <= 140, "實力 " + r.power);
    assert(r.stars.length >= 1 && r.stars.length <= 2, "明星數");
    r.stars.forEach(function (s) {
      assert(!stars[s.rosterId], "宿敵明星重複"); stars[s.rosterId] = 1;
      eq(Roster.byId(s.rosterId).kind, "rival");
      assert(Core.rivalStarName(s, "ja"), "明星名");
    });
  });
  assert(Roster.rivals().length >= 10, "宿敵明星名錄");
  assert(Roster.byRarity("SR").concat(Roster.byRarity("SSR")).every(function (e) { return e.kind !== "rival"; }), "不進抽卡池");
  eq(Core.rivalById(st, st.rivals[0].id), st.rivals[0]);
});

test("對手：每年成長、倒閉與遞補、明星流入候補", function () {
  var st = Core.create({ seed: 8 });
  st.board = []; st.boardRefreshDay = 99999;
  var dead = st.rivals[0], deadStars = dead.stars.map(function (s) { return s.rosterId; });
  dead.power = 10;
  var keep = st.rivals[1], p0 = keep.power, fame0 = keep.stars[0].fame;
  Core.advance(st, 360);
  eq(st.rivals.length, 5, "保持 5 家");
  assert(!Core.rivalById(st, dead.id), "倒閉");
  assert(st.log.some(function (e) { return e.type === "rival_bankrupt"; }) && st.log.some(function (e) { return e.type === "rival_new"; }), "日誌");
  assert(keep.stars[0].fame > fame0, "宿敵明星人氣成長");
  assert(keep.power !== p0, "實力變動");
  var joined = st.artists.concat(st.waitlist.map(function (w) { return w.artist; })).filter(function (a) { return deadStars.indexOf(a.rosterId) >= 0; }).length;
  var joinLogs = st.log.filter(function (e) { return e.type === "rival_star_join"; }).length;
  eq(joined, joinLogs, "流入的人數與日誌一致");
});

test("存檔版本 3：舊存檔補上對手", function () {
  var st = Core.create({ seed: 1 });
  delete st.rivals; st.version = 2;
  var m = Core.migrate(JSON.parse(JSON.stringify(st)));
  eq(m.version, 3); eq(m.rivals.length, 5);
});
```

- [ ] **Step 2：執行，確認失敗**

Run: `node tools/starv_check/core_check.js`
Expected: `Cannot find module '../../static_src/starv_roster_rivals_1.js'`

- [ ] **Step 3：名錄登記器排除宿敵明星**

`static_src/starv_roster.js` 中

```js
    byRarity: function (r) { return list.filter(function (e) { return e.rarity === r; }); }
```

換成：

```js
    // 宿敵明星（kind: "rival"）屬於對手公司，不進抽卡池
    byRarity: function (r) { return list.filter(function (e) { return e.rarity === r && e.kind !== "rival"; }); },
    rivals: function () { return list.filter(function (e) { return e.kind === "rival"; }); }
```

- [ ] **Step 4：建立 `static_src/starv_roster_rivals_1.js`**

```js
// 明星經紀 starV：宿敵明星首批（規格 §9、§4）。kind: "rival" → 屬於對手公司，不進抽卡池；
// 對手倒閉時可能流入玩家公司（以 rarity 當作入社的稀有度）。擴充時新增 starv_roster_rivals_2.js，ID rv### 永不重用。
(function () {
  "use strict";

  var root = typeof window !== "undefined" ? window : globalThis;
  var T = root.PriTestStarvData.T;

  function rv(id, rarity, name, gender, age, dir, apt, stats, look, bio, skill) {
    return { id: id, kind: "rival", rarity: rarity, addedIn: "v1", debut: false, name: T(name), gender: gender, age: age, dir: dir,
      subDirs: [], apt: apt, stats: stats, traits: [], skill: skill || null, look: look, bio: T(bio) };
  }
  function A(s) { var k = ["act", "vocal", "dance", "talk", "charm", "sense"], o = {}; s.split("").forEach(function (c, i) { o[k[i]] = c; }); return o; }
  function S(arr) { return { act: arr[0], vocal: arr[1], dance: arr[2], talk: arr[3], charm: arr[4], sense: arr[5] }; }
  function L(face, hair, hairColor, eye, outfit, acc, skin) { return { face: face, hair: hair, hairColor: hairColor, eye: eye, outfit: outfit, acc: acc, skin: skin }; }

  root.PriTestStarvRoster.add([
    rv("rv001", "SR", "黑澤凜|黒澤 凛", "f", 23, "singer", A("CABBAB"), S([40, 150, 70, 60, 110, 90]), L(1, 8, 0, 3, 7, 2, 0),
      "以冷豔歌聲橫掃排行榜的歌姬，從不在節目上笑。|クールな歌声でチャートを席巻する歌姫。番組で笑ったことがない。"),
    rv("rv002", "SR", "葉天朗|葉 天朗", "m", 26, "film", A("ACBBAB"), S([160, 40, 60, 70, 140, 80]), L(2, 4, 1, 4, 5, -1, 1),
      "影帝候選常客，拍戲時從不用替身。|主演男優賞の常連候補。スタントを一切使わない。"),
    rv("rv003", "SR", "月島光|月島 ひかり", "f", 19, "idol", A("CBASAC"), S([40, 110, 140, 70, 160, 40]), L(3, 10, 4, 4, 0, 0, 0),
      "國民偶像團體的絕對中心。|国民的アイドルグループの絶対的センター。"),
    rv("rv004", "SR", "嚴正浩|厳 正浩", "m", 31, "host", A("CCCSBA"), S([60, 50, 40, 170, 100, 130]), L(0, 1, 0, 0, 6, 1, 2),
      "收視保證的王牌主持人，毒舌出了名。|視聴率保証のエース司会者。毒舌で有名。"),
    rv("rv005", "SR", "Lumi|ルミ", "f", 21, "vtuber", A("BACABS"), S([70, 130, 40, 150, 60, 160]), L(1, 11, 7, 5, 4, 4, 0),
      "訂閱數破百萬的虛擬主播，真實身分成謎。|登録者百万人超えの VTuber。中の人は謎。"),
    rv("rv006", "SR", "Rex|レックス", "m", 24, "dancer", A("CCSBAB"), S([50, 60, 180, 60, 120, 90]), L(2, 3, 5, 3, 1, 5, 3),
      "街舞世界大賽冠軍，舞團的靈魂人物。|ストリートダンス世界大会の覇者。グループの中心人物。"),
    rv("rv007", "SR", "白川雪乃|白川 雪乃", "f", 28, "stage", A("SBABAB"), S([170, 100, 120, 60, 100, 70]), L(0, 7, 4, 1, 6, -1, 0),
      "劇場界的女王，一張票難求。|劇場界の女王。チケットは即日完売。"),
    rv("rv008", "SR", "趙大雷|趙 大雷", "m", 34, "comedy", A("BCCSBA"), S([90, 40, 50, 170, 70, 140]), L(3, 0, 0, 2, 3, -1, 2),
      "搞笑大賽三連霸的漫才師。|お笑いグランプリ三連覇の漫才師。"),
    rv("rv009", "SSR", "神宮寺皇|神宮寺 皇", "m", 29, "band", A("BSBBSA"), S([90, 190, 100, 80, 180, 150]), L(2, 5, 0, 3, 7, 5, 1),
      "傳奇樂團的主唱，演唱會門票秒殺。|伝説のバンドのボーカル。ライブのチケットは秒で完売。",
      { id: "rv_rockstar", name: T("搖滾之神|ロックの神"), desc: T("樂團表現 +20%|バンドの表現 +20%"), fx: { perfDirs: { dirs: ["band"], v: 1.2 } } }),
    rv("rv010", "SSR", "花宮麗華|花宮 麗華", "f", 25, "model", A("BBACSB"), S([100, 90, 140, 60, 200, 110]), L(3, 9, 3, 1, 7, 0, 0),
      "巴黎時裝週的常客，品牌搶著簽。|パリコレの常連。ブランドが奪い合う存在。",
      { id: "rv_runway", name: T("伸展台女王|ランウェイの女王"), desc: T("模特兒、廣告表現 +20%|モデル・CM の表現 +20%"), fx: { perfDirs: { dirs: ["model", "cm"], v: 1.2 } } })
  ]);
})();
```

- [ ] **Step 5：資料常數**

`static_src/starv_data.js`：在 `var UNKNOWN_NAME = …;` 之後加入：

```js
  // 對手公司名＝a + b（§9；全部虛構）
  var RIVAL_NAME = {
    a: TL(["銀河|ギャラクシー", "晨星|モーニングスター", "紅月|レッドムーン", "極光|オーロラ", "天狼|シリウス", "琥珀|アンバー",
      "蒼穹|ソウキュウ", "黑曜|オブシディアン", "白夜|ビャクヤ", "彩虹|レインボー", "流星|メテオ", "星辰|スターズ"]),
    b: TL(["娛樂|エンタテインメント", "經紀|プロダクション", "傳媒|メディア", "事務所|オフィス", "製作|プロ"])
  };
```

`root.PriTestStarvData = { … }` 中 `UNKNOWN_NAME: UNKNOWN_NAME,` 之後加入 `RIVAL_NAME: RIVAL_NAME,`

`BAL` 中 `logMax: 200, worksMax: 50` 之前加入：

```js
    rivalCount: 5, rivalPowerStart: [80, 140], rivalPowerNew: [80, 120], rivalBankrupt: 40, rivalShockChance: 0.12,
    rivalPerfDiv: 400, rivalYearGrowth: 0.08, rivalStarJoinChance: 0.5,
```

`site_src/starv_page.py` 的 `STARV_SCRIPTS`：`"starv_roster_1.js",` 之後加 `"starv_roster_rivals_1.js",`
`tools/starv_check/sim.js`：`require("../../static_src/starv_roster_1.js");` 之後加 `require("../../static_src/starv_roster_rivals_1.js");`

- [ ] **Step 6：核心**

`static_src/starv_core.js`：
1. `var VERSION = 2;` → `var VERSION = 3;`
2. `blankState` 中 `trend: null, events: { pending: [] }, loans: [],` 之後加入 `rivals: [], auditions: [], charts: null, awards: { history: [], unseen: null },`；`company:` 中 `crisisOn: false` 之後加 `, repYearStart: 0`
3. `ARTIST_DEFAULTS` 中 `baseSalary: null,` 之後加 `trophies: [],`
4. `create` 中 `initTrend(st);` 之後加 `initRivals(st);`
5. `migrate` 中 `if (!st.trend) initTrend(st);` 那行之後加 `if (!st.rivals.length) initRivals(st);   // version 2 → 3：補上對手公司`
6. 插在 `  // ==== exports ====` 之前：

```js
  // ==== 對手公司與宿敵明星（§9） ====
  function rivalName(r, lang) {
    lang = lang === "zh" ? "zh" : "ja";
    return D.RIVAL_NAME.a[r.name[0]][lang] + D.RIVAL_NAME.b[r.name[1]][lang];
  }
  function rivalStarName(s, lang) {
    var e = Roster.byId(s.rosterId);
    return e ? e.name[lang === "zh" ? "zh" : "ja"] : D.UNKNOWN_NAME[lang === "zh" ? "zh" : "ja"];
  }
  function rivalById(st, id) {
    for (var i = 0; i < st.rivals.length; i++) if (st.rivals[i].id === id) return st.rivals[i];
    return null;
  }
  function pickRivalName(st) {
    var used = {};
    st.rivals.forEach(function (r) { used[r.name[0]] = true; });
    var free = [];
    D.RIVAL_NAME.a.forEach(function (x, i) { if (!used[i]) free.push(i); });
    return [free.length ? pick(st, free) : rint(st, 0, D.RIVAL_NAME.a.length - 1), rint(st, 0, D.RIVAL_NAME.b.length - 1)];
  }
  // 沒被任何對手、也不在玩家公司（在籍或候補）的宿敵明星
  function freeRivalStars(st) {
    var used = {};
    st.rivals.forEach(function (r) { r.stars.forEach(function (s) { used[s.rosterId] = true; }); });
    st.artists.forEach(function (a) { if (a.rosterId) used[a.rosterId] = true; });
    st.waitlist.forEach(function (w) { if (w.artist.rosterId) used[w.artist.rosterId] = true; });
    return Roster.rivals().filter(function (e) { return !used[e.id]; });
  }
  function addRivalStar(st, r) {
    var free = freeRivalStars(st);
    if (!free.length) return null;
    var e = pick(st, free);
    var s = { rosterId: e.id, stats: clone(e.stats), fame: rint(st, 800, 3000), age: e.age };
    r.stars.push(s);
    return s;
  }
  function newRival(st, range) {
    var r = { id: newId(st, "r"), name: pickRivalName(st), power: rint(st, range[0], range[1]), stars: [], founded: st.day };
    st.rivals.push(r);
    var n = rint(st, 1, 2);
    for (var i = 0; i < n; i++) addRivalStar(st, r);
    return r;
  }
  function initRivals(st) {
    st.rivals = [];
    for (var i = 0; i < BAL.rivalCount; i++) newRival(st, BAL.rivalPowerStart);
  }
  function industryGrowth(st) { return 1 + Math.floor(st.day / BAL.daysPerYear) * BAL.rivalYearGrowth; }
  function rivalScore(st, r, base) { return base * r.power / 100 * industryGrowth(st) * (0.6 + rnd(st) * 0.8); }
  function rivalStarPerf(r, s, dir) {
    var w = dirById(dir).weights, v = 0;
    Object.keys(w).forEach(function (k) { v += s.stats[k] * w[k]; });
    return v * (1 + r.power / BAL.rivalPerfDiv);
  }

  function rivalMonth(st) {
    st.rivals.forEach(function (r) {
      r.stars.forEach(function (s) { s.fame = Math.min(99999, s.fame + Math.round(r.power / 10 * (0.5 + rnd(st)))); });
    });
  }

  function rivalYear(st) {
    st.rivals.forEach(function (r) {
      r.power = Math.round(r.power * (0.97 + rnd(st) * 0.12) * 10) / 10;
      if (rnd(st) < BAL.rivalShockChance) { r.power = Math.round(r.power * 0.6 * 10) / 10; log(st, "rival_scandal", { rival: r.id }); }
      r.stars = r.stars.filter(function (s) {
        s.age++;
        D.STATS.forEach(function (k) { s.stats[k] = Math.min(999, Math.round(s.stats[k] * 1.04)); });
        var e = Roster.byId(s.rosterId);
        if (e && s.age > dirById(e.dir).retire) { log(st, "rival_star_retire", { rival: r.id, rosterId: s.rosterId }); return false; }
        return true;
      });
      if (!r.stars.length) addRivalStar(st, r);
    });
    st.rivals.filter(function (r) { return r.power < BAL.rivalBankrupt; }).forEach(function (r) {
      st.rivals.splice(st.rivals.indexOf(r), 1);
      log(st, "rival_bankrupt", { rival: r.id, name: r.name.slice() });
      r.stars.forEach(function (s) {
        if (rnd(st) >= BAL.rivalStarJoinChance) return;
        var e = Roster.byId(s.rosterId);
        if (!e) return;
        log(st, "rival_star_join", { rosterId: e.id, name: r.name.slice() });
        var res = place(st, fromRoster(st, e), { rarity: e.rarity, rosterId: e.id });
        if (!res.lost) st.codex.owned[e.id] = true;
      });
      var nr = newRival(st, BAL.rivalPowerNew);
      log(st, "rival_new", { rival: nr.id });
    });
  }
```

7. `monthly` 中 `rotatePickup(st);` 之前加 `rivalMonth(st);`
8. `advanceDay` 中 `if (st.day % BAL.daysPerYear === 0) yearly(st);` 改成：

```js
    if (st.day % BAL.daysPerYear === 0) { yearly(st); rivalYear(st); }
```

9. `yearly` 的開頭加入 `st.company.repYearStart = st.company.rep;`
10. exports 區塊加入：

```js
  api.rivalById = rivalById;
  api.rivalName = rivalName;
  api.rivalStarName = rivalStarName;
```

- [ ] **Step 7：執行，確認通過**

Run: `node tools/starv_check/core_check.js`
Expected: `全部 71 個通過`（若「名錄：首批 SR 3、SSR 2，欄位完整」因宿敵明星的 SSR 檢查而失敗，代表 rv009／rv010 少了 skill；兩位都有 skill，應該通過）

- [ ] **Step 8：commit**

```bash
for f in starv_roster starv_roster_rivals_1 starv_data starv_core; do node --check static_src/$f.js || exit 1; done
git add static_src/starv_roster.js static_src/starv_roster_rivals_1.js static_src/starv_data.js static_src/starv_core.js tools/starv_check/core_check.js tools/starv_check/sim.js site_src/starv_page.py
git commit -m "feat(starv): 對手公司與宿敵明星（成長、醜聞、倒閉遞補）、存檔版本 3"
```

---

### Task 2：競爭試鏡與搶工作

**Files:**
- Modify: `static_src/starv_core.js`、`static_src/starv_data.js`、`tools/starv_check/core_check.js`

**Interfaces:**
- Produces:
  - `BAL`：`auditionTiers: ["A", "S"]`、`interestChance: 0.3`、`snatchChance: 0.01`、`snatchInterestChance: 0.06`、`auditionRivalWin: 2`
  - 工作新增 `job.audition`（A／S 級為 true；指名工作為 false）、`job.interest`（對手 id 或 null）
  - `takeJob` 對試鏡工作：從看板移除，加入 `st.auditions[i] = { id:"au<n>", job, members, left: 1 }`，成員行程 `{ kind: "audition", ref, days: 1, left: 1, stamina: 0, stress: 2 }`
  - 試鏡隔天結算：我方 `teamPerf × 隨機 0.85～1.15` 對上最強的對手分數（有該方向宿敵明星就用 `rivalStarPerf`，否則 `rivalScore(st, r, difficulty(job))`）；贏了直接開工（日誌 `audition_won { rival, title, dir }`），輸了工作被對手拿走、對手實力 +2（日誌 `audition_lost`）
  - 每天看板上非指名、非試鏡中的工作：有興趣的 6%、其他 1% 被對手拿走（日誌 `job_snatched { rival, title, dir }`）
  - 內部：`startJob(st, job, aids)`（`takeJob` 與試鏡贏了都用它）

- [ ] **Step 1：寫失敗測試**

在 `core_check.js` 的 `withEvents` 定義之後加入（舊測試會自己建立看板工作，避免被對手搶走）：

```js
// 計畫 4 加入對手每天搶工作：舊測試預設關閉，搶工作的測試自己打開
var SNATCH = [D.BAL.snatchChance, D.BAL.snatchInterestChance];
D.BAL.snatchChance = 0; D.BAL.snatchInterestChance = 0;
```

插在 `// ==== run ====` 之前：

```js
test("試鏡：A/S 是試鏡制、隔天公布、贏了開工輸了被搶", function () {
  var st = Core.create({ seed: 1 });
  st.company.level = 6; st.board = []; st.boardRefreshDay = 99999;
  var hi = freshArtist(st, { fame: 99999 }), lo = freshArtist(st, { fame: 99999 });
  D.STATS.forEach(function (s) { hi.stats[s] = 999; hi.caps[s] = 999; lo.stats[s] = 1; });
  hi.prof.singer.lv = 10; lo.prof.singer.lv = 10;
  var j1 = soloJob(st, { tier: "A", audition: true, minFame: 1500, minProf: 5, days: 3 });
  var j2 = soloJob(st, { tier: "A", audition: true, minFame: 1500, minProf: 5, days: 3 });
  eq(Core.takeJob(st, j1.id, [hi.id]), null); eq(Core.takeJob(st, j2.id, [lo.id]), null);
  eq(st.auditions.length, 2); eq(hi.task.kind, "audition"); eq(st.activeJobs.length, 0);
  Core.advance(st, 1);
  eq(st.auditions.length, 0, "隔天公布");
  eq(st.activeJobs.length, 1, "贏的開工"); eq(st.activeJobs[0].job.id, j1.id); eq(hi.task.kind, "job");
  eq(lo.task, null, "輸的沒事");
  assert(st.log.some(function (e) { return e.type === "audition_won"; }) && st.log.some(function (e) { return e.type === "audition_lost"; }), "日誌");
  var gen = Core._genJob(st, { tier: "S" }); eq(gen.audition, true);
  eq(Core._genJob(st, { tier: "S", reservedFor: hi.id }).audition, false, "指名工作不用試鏡");
  eq(Core._genJob(st, { tier: "C" }).audition, false);
});

test("搶工作：有興趣的工作比較容易被搶", function () {
  D.BAL.snatchChance = SNATCH[0]; D.BAL.snatchInterestChance = SNATCH[1];
  try {
    var st = Core.create({ seed: 2 }), n = { hot: 0, cold: 0 };
    st.boardRefreshDay = 99999;
    for (var round = 0; round < 40; round++) {
      st.board = [];
      for (var i = 0; i < 20; i++) { var j = Core._genJob(st, { tier: "C" }); j.interest = i < 10 ? st.rivals[0].id : null; j.expires = st.day + 999; st.board.push(j); }
      Core.advance(st, 5);
      st.board.forEach(function (j) { if (j.interest) n.hot++; else n.cold++; });
    }
    assert(n.hot < n.cold, "有興趣的留下較少 " + JSON.stringify(n));
    assert(st.log.some(function (e) { return e.type === "job_snatched"; }), "日誌");
  } finally { D.BAL.snatchChance = 0; D.BAL.snatchInterestChance = 0; }
});
```

並把 `soloJob` 輔助函式中的 `j.minFame = 0; j.minProf = 1; j.isWork = false;` 改成 `j.minFame = 0; j.minProf = 1; j.isWork = false; j.audition = false; j.interest = null;`（舊測試的工作一律不是試鏡制）。

- [ ] **Step 2：執行，確認失敗**

Run: `node tools/starv_check/core_check.js`
Expected: 2 個 FAIL

- [ ] **Step 3：實作**

`static_src/starv_data.js` 的 `BAL` 中 `rivalCount: 5, …` 那行之前加入：

```js
    auditionTiers: ["A", "S"], interestChance: 0.3, snatchChance: 0.01, snatchInterestChance: 0.06, auditionRivalWin: 2,
```

`static_src/starv_core.js`：
1. `genJob` 中 `if (over.reservedFor) { job.reservedFor = over.reservedFor; job.minFame = 0; job.minProf = 1; }` 之後加入：

```js
    job.audition = !over.reservedFor && BAL.auditionTiers.indexOf(tier) >= 0;
    job.interest = !over.reservedFor && st.rivals && st.rivals.length && rnd(st) < BAL.interestChance ? pick(st, st.rivals).id : null;
```

2. 把 `takeJob` 中從 `st.board.splice(st.board.indexOf(job), 1);` 到 `return null;`（函式結尾前）這一段換成：

```js
    st.board.splice(st.board.indexOf(job), 1);
    if (job.audition) {
      var au = { id: newId(st, "au"), job: job, members: aids.slice(), left: 1 };
      st.auditions.push(au);
      aids.forEach(function (id) { artistById(st, id).task = { kind: "audition", ref: au.id, days: 1, left: 1, stamina: 0, stress: 2 }; });
      return null;
    }
    startJob(st, job, aids);
    return null;
  }

  function startJob(st, job, aids) {
    var aj = { id: newId(st, "w"), job: job, members: aids.slice(), left: job.days, eventMod: 0 };
    st.activeJobs.push(aj);
    var load = D.TIERS[job.tier].load;
    aids.forEach(function (id) {
      artistById(st, id).task = {
        kind: "job", ref: aj.id, days: job.days, left: job.days,
        stamina: Math.min(BAL.jobStaminaMax, job.days * BAL.jobStaminaPerDay * load),
        stress: Math.min(BAL.jobStressMax, job.days * BAL.jobStressPerDay * load)
      };
    });
    return aj;
```

（換完後 `startJob` 以原本 `takeJob` 的結尾 `}` 收尾。）

3. `tickArtists` 中 `if (t.kind !== "job" && t.left <= 0)` 改成 `if (t.kind !== "job" && t.kind !== "audition" && t.left <= 0)`

4. 插在 `  // ==== exports ====` 之前：

```js
  // ==== 競爭試鏡與搶工作（§9） ====
  function bestRivalFor(st, job) {
    var best = null;
    st.rivals.forEach(function (r) {
      var score = rivalScore(st, r, difficulty(job));
      r.stars.forEach(function (s) {
        var e = Roster.byId(s.rosterId);
        if (e && e.dir === job.dir) score = Math.max(score, rivalStarPerf(r, s, job.dir));
      });
      if (!best || score > best.score) best = { rival: r, score: score };
    });
    return best;
  }

  function tickAuditions(st) {
    var due = [];
    st.auditions.forEach(function (au) { au.left--; if (au.left <= 0) due.push(au); });
    due.forEach(function (au) {
      st.auditions.splice(st.auditions.indexOf(au), 1);
      var members = au.members.map(function (id) { return artistById(st, id); }).filter(Boolean);
      members.forEach(function (a) { a.task = null; });
      if (!members.length) return;
      var ours = teamPerf(st, members, au.job) * (BAL.randLo + rnd(st) * (BAL.randHi - BAL.randLo));
      var rv = bestRivalFor(st, au.job);
      var data = { rival: rv ? rv.rival.id : null, title: au.job.title.slice(), dir: au.job.dir, aids: au.members.slice() };
      if (!rv || ours >= rv.score) {
        startJob(st, au.job, members.map(function (a) { return a.id; }));
        log(st, "audition_won", data);
      } else {
        rv.rival.power += BAL.auditionRivalWin;
        log(st, "audition_lost", data);
      }
    });
  }

  function snatchJobs(st) {
    if (!st.rivals.length) return;
    st.board = st.board.filter(function (j) {
      if (j.reservedFor) return true;
      if (rnd(st) >= (j.interest ? BAL.snatchInterestChance : BAL.snatchChance)) return true;
      var r = (j.interest && rivalById(st, j.interest)) || pick(st, st.rivals);
      log(st, "job_snatched", { rival: r.id, title: j.title.slice(), dir: j.dir });
      return false;
    });
  }
```

5. `advanceDay` 中 `tickJobs(st);` 之後加入 `tickAuditions(st);`；`tickBoard(st);` 之前加入 `snatchJobs(st);`

- [ ] **Step 4：執行，確認通過**

Run: `node tools/starv_check/core_check.js`
Expected: `全部 73 個通過`

- [ ] **Step 5：commit**

```bash
node --check static_src/starv_core.js && node --check static_src/starv_data.js
git add static_src/starv_core.js static_src/starv_data.js tools/starv_check/core_check.js
git commit -m "feat(starv): A/S 級競爭試鏡、對手搶工作"
```

---

### Task 3：排行榜與獎項資料

**Files:**
- Create: `static_src/starv_awards_data.js`
- Modify: `static_src/starv_core.js`、`static_src/starv_data.js`、`tools/starv_check/core_check.js`、`site_src/starv_page.py`、`tools/starv_check/sim.js`

**Interfaces:**
- Produces:
  - `D.CHARTS = [{ id, name, dirs|null }]`（`single`、`ratings`、`boxoffice`、`popularity`）
  - `D.CEREMONIES = [{ id, name }]`、`D.AWARDS = [{ id, ceremony, name, dirs|null, kind: "person"|"work"|"rookie"|"group"|"company", gender?: "m"|"f", by?: "fame", filter?: "veteran" }]`、`D.AWARD_BY_ID`
  - `BAL`：`tierWeight: { D:1, C:2, B:4, A:8, S:16 }`、`chartBase: 25`、`chartFameDiv: 100`、`chartFameBase: 15`、`chartFillers: 2`、`chartTopRep: 50`、`chartTopFame: 100`
  - `st.charts = { day, lists: { <chartId>: [entry] } }`，entry：`{ kind: "artist", aid, score }` | `{ kind: "rstar", rival, rosterId, score }` | `{ kind: "rgen", rival, nameSeed, gender, score }`
  - 每月 1 日（`monthly` 中）更新排行榜；我方拿下第 1 名：聲望 +50、該藝人人氣 +100（日誌 `chart_top { chart, aid }`）；對手第 1 名：實力 +1
  - `Core.updateCharts(st)`（測試與 UI 用）
  - 內部：`workScore(w) = stars × tierWeight[tier] × ROLES[role].fame`、`recentWorks(a, fromDay, dirs)`、`topSum(scores, n)`

- [ ] **Step 1：寫失敗測試**

`core_check.js` 的 `require("../../static_src/starv_events_1.js");` 之後加入 `require("../../static_src/starv_awards_data.js");`

插在 `// ==== run ====` 之前：

```js
test("獎項資料：55 個、每個方向都有個人獎與作品獎", function () {
  eq(D.AWARDS.length, 55, "獎項數");
  var seen = {}, cer = {};
  D.CEREMONIES.forEach(function (c) { cer[c.id] = 1; assert(c.name.zh && c.name.ja, "典禮名"); });
  D.AWARDS.forEach(function (aw) {
    assert(!seen[aw.id], "重複 " + aw.id); seen[aw.id] = 1;
    assert(cer[aw.ceremony], aw.id + " 典禮"); assert(aw.name.zh && aw.name.ja, aw.id + " 名稱");
    assert(["person", "work", "rookie", "group", "company"].indexOf(aw.kind) >= 0, aw.id + " kind");
    (aw.dirs || []).forEach(function (d) { assert(D.DIR_BY_ID[d], aw.id + " 方向 " + d); });
    eq(D.AWARD_BY_ID[aw.id], aw);
  });
  D.DIRS.forEach(function (d) {
    var has = function (k) { return D.AWARDS.some(function (aw) { return aw.kind === k && aw.dirs && aw.dirs.indexOf(d.id) >= 0; }); };
    assert(has("person"), d.id + " 沒有個人獎"); assert(has("work"), d.id + " 沒有作品獎");
  });
  eq(D.CHARTS.length, 4);
});

test("排行榜：前 10、我方第 1 名加聲望", function () {
  var st = Core.create({ seed: 1 }), a = freshArtist(st, { fame: 50 });
  for (var i = 0; i < 3; i++) a.works.unshift({ title: [0, 0], dir: "singer", tier: "S", role: "lead", result: "great", stars: 5, day: st.day, isWork: true, pay: 1 });
  st.day = 10;
  var rep0 = st.company.rep;
  Core.updateCharts(st);
  ["single", "ratings", "boxoffice", "popularity"].forEach(function (id) {
    var l = st.charts.lists[id];
    assert(l.length > 0 && l.length <= 10, id + " 筆數");
    for (var k = 1; k < l.length; k++) assert(l[k - 1].score >= l[k].score, id + " 排序");
  });
  eq(st.charts.lists.single[0].kind, "artist", "S 級 5★ 主打三首拿下單曲榜第 1");
  assert(st.company.rep >= rep0 + 50, "聲望");
  assert(st.log.some(function (e) { return e.type === "chart_top" && e.data.chart === "single"; }), "日誌");
});
```

- [ ] **Step 2：執行，確認失敗**

Run: `node tools/starv_check/core_check.js`
Expected: `Cannot find module '../../static_src/starv_awards_data.js'`

- [ ] **Step 3：建立 `static_src/starv_awards_data.js`**

```js
// 明星經紀 starV：排行榜與頒獎典禮的定義（規格 §9、§10）。資料驅動：新增方向時只要在 dirs 補上，核心不需要改。
// kind：person 個人／work 作品／rookie 新人／group 團體／company 公司。gender 限定男女；by:"fame" 依人氣；filter:"veteran" 資深。
(function () {
  "use strict";

  var root = typeof window !== "undefined" ? window : globalThis;
  var D = root.PriTestStarvData;
  var T = D.T;

  var CHARTS = [
    { id: "single", name: T("單曲榜|シングルチャート"), dirs: ["singer", "band", "idol", "composer", "dancer"] },
    { id: "ratings", name: T("收視率榜|視聴率ランキング"), dirs: ["drama", "host", "comedy", "anchor", "vtuber", "influencer"] },
    { id: "boxoffice", name: T("票房榜|興行収入ランキング"), dirs: ["film", "stage", "voice", "cm", "model"] },
    { id: "popularity", name: T("人氣榜|人気ランキング"), dirs: null }
  ];

  var CEREMONIES = [
    { id: "film", name: T("金影獎|金影賞") },
    { id: "tv", name: T("金視獎|金視賞") },
    { id: "melody", name: T("金韻獎|金韻賞") },
    { id: "stage", name: T("舞台藝術獎|舞台芸術賞") },
    { id: "media", name: T("新媒體大賞|ニューメディア大賞") },
    { id: "fashion", name: T("時尚廣告大賞|ファッション広告大賞") },
    { id: "special", name: T("年度特別獎|年間特別賞") }
  ];

  function A(id, ceremony, name, dirs, kind, extra) {
    var o = { id: id, ceremony: ceremony, name: T(name), dirs: dirs, kind: kind };
    Object.keys(extra || {}).forEach(function (k) { o[k] = extra[k]; });
    return o;
  }
  var M = { gender: "m" }, F = { gender: "f" };
  var AWARDS = [
    A("film_actor", "film", "最佳男主角|最優秀主演男優賞", ["film"], "person", M),
    A("film_actress", "film", "最佳女主角|最優秀主演女優賞", ["film"], "person", F),
    A("film_sup_actor", "film", "最佳男配角|最優秀助演男優賞", ["film"], "person", M),
    A("film_sup_actress", "film", "最佳女配角|最優秀助演女優賞", ["film"], "person", F),
    A("film_best", "film", "最佳影片|最優秀作品賞", ["film"], "work"),
    A("film_jury", "film", "評審團特別獎|審査員特別賞", ["film", "stage"], "work"),
    A("film_rookie", "film", "最佳新人|新人賞", ["film"], "rookie"),
    A("film_score", "film", "最佳原創配樂|最優秀音楽賞", ["composer"], "work"),

    A("drama_actor", "tv", "戲劇男主角獎|ドラマ主演男優賞", ["drama"], "person", M),
    A("drama_actress", "tv", "戲劇女主角獎|ドラマ主演女優賞", ["drama"], "person", F),
    A("drama_sup", "tv", "戲劇配角獎|ドラマ助演賞", ["drama"], "person"),
    A("drama_best", "tv", "最佳戲劇|最優秀ドラマ賞", ["drama"], "work"),
    A("host_best", "tv", "最佳主持人|最優秀司会者賞", ["host"], "person"),
    A("variety_best", "tv", "最佳綜藝節目|最優秀バラエティ賞", ["host", "comedy"], "work"),
    A("anchor_best", "tv", "最佳主播|最優秀キャスター賞", ["anchor"], "person"),
    A("news_best", "tv", "最佳新聞節目|最優秀報道番組賞", ["anchor"], "work"),
    A("comedy_best", "tv", "搞笑大賞|お笑い大賞", ["comedy"], "person"),
    A("drama_rookie", "tv", "戲劇新人獎|ドラマ新人賞", ["drama"], "rookie"),
    A("variety_rookie", "tv", "綜藝新人獎|バラエティ新人賞", ["host", "comedy", "anchor"], "rookie"),

    A("singer_m", "melody", "最佳男歌手|最優秀男性歌手賞", ["singer"], "person", M),
    A("singer_f", "melody", "最佳女歌手|最優秀女性歌手賞", ["singer"], "person", F),
    A("idol_best", "melody", "最佳偶像|最優秀アイドル賞", ["idol"], "person"),
    A("band_vocal", "melody", "最佳樂團主唱|最優秀バンドボーカル賞", ["band"], "person"),
    A("composer_best", "melody", "最佳作曲|最優秀作曲賞", ["composer"], "person"),
    A("dance_group", "melody", "最佳舞團|最優秀ダンスグループ賞", ["dancer"], "group"),
    A("band_best", "melody", "最佳樂團|最優秀バンド賞", ["band"], "group"),
    A("duet_best", "melody", "最佳合唱|最優秀デュエット賞", ["singer", "idol"], "group"),
    A("album", "melody", "年度專輯|年間最優秀アルバム賞", ["band", "singer"], "work"),
    A("single", "melody", "年度單曲|年間最優秀シングル賞", ["singer", "idol"], "work"),
    A("concert_best", "melody", "最佳演唱會|最優秀ライブ賞", ["idol", "dancer", "singer"], "work"),
    A("music_rookie", "melody", "最佳新人|最優秀新人賞", ["singer", "idol", "band"], "rookie"),

    A("stage_actor", "stage", "最佳舞台劇演員|最優秀舞台俳優賞", ["stage"], "person"),
    A("stage_best", "stage", "最佳舞台劇|最優秀舞台作品賞", ["stage"], "work"),
    A("choreo_best", "stage", "最佳編舞|最優秀振付賞", ["dancer"], "person"),
    A("stage_rookie", "stage", "劇場新人獎|劇場新人賞", ["stage"], "rookie"),

    A("vtuber_best", "media", "年度虛擬主播|年間最優秀 VTuber 賞", ["vtuber"], "person"),
    A("influencer_best", "media", "年度網紅|年間最優秀インフルエンサー賞", ["influencer"], "person"),
    A("voice_best", "media", "最佳聲優|最優秀声優賞", ["voice"], "person"),
    A("voice_work", "media", "最佳配音作品|最優秀アニメ作品賞", ["voice"], "work"),
    A("channel_best", "media", "年度最佳頻道|年間最優秀チャンネル賞", ["vtuber", "influencer"], "work"),
    A("game_stream", "media", "最佳遊戲直播|最優秀ゲーム配信賞", ["vtuber"], "work"),
    A("media_rookie", "media", "新星獎|新星賞", ["vtuber", "influencer", "voice"], "rookie"),

    A("cm_face", "fashion", "年度代言人|年間最優秀 CM タレント賞", ["cm"], "person"),
    A("cm_work", "fashion", "最佳廣告作品|最優秀 CM 作品賞", ["cm"], "work"),
    A("model_best", "fashion", "年度模特兒|年間最優秀モデル賞", ["model"], "person"),
    A("runway_best", "fashion", "最佳時裝秀|最優秀ファッションショー賞", ["model"], "work"),
    A("cover_star", "fashion", "年度封面人物|年間カバースター賞", ["model", "cm"], "person"),
    A("model_rookie", "fashion", "伸展台新人獎|ランウェイ新人賞", ["model"], "rookie"),

    A("artist_of_year", "special", "年度藝人大賞|年間最優秀タレント大賞", null, "person"),
    A("rookie_of_year", "special", "年度最佳新人|年間最優秀新人賞", null, "rookie"),
    A("group_of_year", "special", "最佳組合|最優秀ユニット賞", null, "group"),
    A("agency_of_year", "special", "年度經紀公司|年間最優秀事務所賞", null, "company"),
    A("buzz_award", "special", "最具話題獎|話題賞", null, "person", { by: "fame" }),
    A("fan_choice", "special", "人氣票選獎|ファン投票賞", null, "person", { by: "fame" }),
    A("lifetime", "special", "終身成就獎|功労賞", null, "person", { filter: "veteran" })
  ];

  var BY_ID = {};
  AWARDS.forEach(function (aw) { BY_ID[aw.id] = aw; });
  D.CHARTS = CHARTS;
  D.CEREMONIES = CEREMONIES;
  D.AWARDS = AWARDS;
  D.AWARD_BY_ID = BY_ID;
})();
```

- [ ] **Step 4：登記載入順序、常數**

`site_src/starv_page.py`：`"starv_events_1.js",` 之後加 `"starv_awards_data.js",`；`tools/starv_check/sim.js`：`require("../../static_src/starv_events_1.js");` 之後加 `require("../../static_src/starv_awards_data.js");`

`static_src/starv_data.js` 的 `BAL` 中 `auditionTiers: …` 那行之前加入：

```js
    tierWeight: { D: 1, C: 2, B: 4, A: 8, S: 16 }, chartBase: 25, chartFameDiv: 100, chartFameBase: 15, chartFillers: 2, chartTopRep: 50, chartTopFame: 100,
```

- [ ] **Step 5：核心**

插在 `  // ==== exports ====` 之前：

```js
  // ==== 月度排行榜（§9） ====
  function workScore(w) { return w.stars * BAL.tierWeight[w.tier] * (D.ROLES[w.role] ? D.ROLES[w.role].fame : 1); }
  function recentWorks(a, fromDay, dirs) {
    return a.works.filter(function (w) { return w.day > fromDay && (!dirs || dirs.indexOf(w.dir) >= 0); });
  }
  function topSum(scores, n) {
    return scores.sort(function (x, y) { return y - x; }).slice(0, n).reduce(function (s, v) { return s + v; }, 0);
  }

  function updateCharts(st) {
    var from = st.day - BAL.daysPerMonth, lists = {};
    D.CHARTS.forEach(function (c) {
      var entries = [];
      st.artists.forEach(function (a) {
        var s = c.dirs ? topSum(recentWorks(a, from, c.dirs).map(workScore), 3) : a.fame / BAL.chartFameDiv;
        if (s > 0) entries.push({ kind: "artist", aid: a.id, score: s });
      });
      st.rivals.forEach(function (r) {
        r.stars.forEach(function (s) {
          var e = Roster.byId(s.rosterId);
          if (!e || (c.dirs && c.dirs.indexOf(e.dir) < 0)) return;
          entries.push({ kind: "rstar", rival: r.id, rosterId: s.rosterId, score: c.dirs ? rivalScore(st, r, BAL.chartBase) : s.fame / BAL.chartFameDiv });
        });
        for (var k = 0; k < BAL.chartFillers; k++) {
          entries.push({ kind: "rgen", rival: r.id, nameSeed: rint(st, 0, 999999), gender: rnd(st) < 0.5 ? "f" : "m",
            score: rivalScore(st, r, c.dirs ? BAL.chartBase * 0.6 : BAL.chartFameBase) });
        }
      });
      entries.sort(function (x, y) { return y.score - x.score; });
      lists[c.id] = entries.slice(0, 10);
      var top = lists[c.id][0];
      if (top && top.kind === "artist") {
        var a = artistById(st, top.aid);
        addRep(st, BAL.chartTopRep);
        if (a) a.fame = Math.min(99999, a.fame + BAL.chartTopFame);
        log(st, "chart_top", { chart: c.id, aid: top.aid });
      } else if (top && top.rival) {
        var r = rivalById(st, top.rival);
        if (r) r.power += 1;
      }
    });
    st.charts = { day: st.day, lists: lists };
  }
```

`monthly` 中 `rivalMonth(st);` 之後加 `updateCharts(st);`；exports 區塊加 `api.updateCharts = updateCharts;`

- [ ] **Step 6：執行，確認通過**

Run: `node tools/starv_check/core_check.js`
Expected: `全部 75 個通過`

- [ ] **Step 7：commit**

```bash
node --check static_src/starv_awards_data.js && node --check static_src/starv_core.js && node --check static_src/starv_data.js
git add static_src/starv_awards_data.js static_src/starv_core.js static_src/starv_data.js tools/starv_check/core_check.js site_src/starv_page.py tools/starv_check/sim.js
git commit -m "feat(starv): 月度排行榜與 55 個獎項的資料"
```

---

### Task 4：年度頒獎典禮

**Files:**
- Modify: `static_src/starv_core.js`、`static_src/starv_data.js`、`tools/starv_check/core_check.js`

**Interfaces:**
- Produces:
  - `BAL`：`awardBase: { person: 40, work: 14, rookie: 25, group: 25, company: 30 }`、`awardFameDiv: 1000`、`awardRepDiv: 50`、`awardHistoryMax: 10`、`awardPrize: { money: { person: 30000, work: 30000, rookie: 20000, group: 30000, company: 100000 }, tickets: 2, rep: 80, fame: 300, nomFame: 80, groupFame: 200, rivalPower: 3 }`
  - `Core.holdAwards(st)`：每年 12/30（`day % 360 === 359`）自動舉辦；對每個獎項算入圍者（我方＋對手），取前 5 名，依分數平方加權抽得獎者
  - 入圍者：`{ kind: "artist", aid }`、`{ kind: "rstar", rival, rosterId }`、`{ kind: "rgen", rival, nameSeed, gender }`、`{ kind: "work", aid, title, dir }`、`{ kind: "rwork", rival, dir, title }`、`{ kind: "group", gid }`、`{ kind: "rgroup", rival }`、`{ kind: "company" }`、`{ kind: "rcompany", rival }`，皆有 `score`
  - 分數：個人＝今年該方向作品分數前 3 名合計 ＋ 人氣 ÷ 1000（`by: "fame"` 改用人氣 × 3 ÷ 1000）；新人＝入社 360 天內者的個人分數；作品＝單件作品分數（非作品型 ×0.5，同名作品取最高）；團體＝組合成員個人分數平均 ＋ 合作次數；公司＝今年聲望增加 ÷ 50；資深（`veteran`）＝ 35 歲以上或入社 10 年以上者，分數＝全部作品前 3 名 ＋ 獎座數 × 10；對手：`rivalScore(st, r, awardBase[kind])`（有符合方向與性別的宿敵明星時改用宿敵明星、基準 ×1.2）
  - 得獎（我方）：資金、星探券、聲望、藝人人氣 +300、獎座 `a.trophies.push({ award, year })`、滿意度 +10；團體得獎成員各 +200 人氣；入圍（我方個人）人氣 +80；對手得獎實力 +3
  - `st.awards = { history: [{ year, results: [{ award, nominees, winner }] }], unseen: year | null }`（保留 10 年）
  - 日誌 `awards { year, wins }`

- [ ] **Step 1：寫失敗測試**

```js
test("頒獎：所有獎項都有結果、強者多半得獎、獎品與歷史", function () {
  var st = Core.create({ seed: 1 });
  st.board = []; st.boardRefreshDay = 99999;
  var star = freshArtist(st, { fame: 30000, gender: "f" });
  star.dir = "film";
  for (var i = 0; i < 5; i++) star.works.unshift({ title: [i, i], dir: "film", tier: "S", role: "lead", result: "great", stars: 5, day: 300, isWork: true, pay: 1 });
  st.day = 359;
  var m0 = st.company.money;
  Core.holdAwards(st);
  var h = st.awards.history[0];
  eq(h.year, 1); eq(st.awards.unseen, 1);
  h.results.forEach(function (r) {
    assert(D.AWARD_BY_ID[r.award], "獎項"); assert(r.nominees.length >= 1 && r.nominees.length <= 5, r.award + " 入圍數");
    assert(r.nominees[r.winner], r.award + " 得獎者");
  });
  var mine = h.results.filter(function (r) { var n = r.nominees[r.winner]; return n.kind === "artist" || n.kind === "work"; });
  assert(mine.length >= 1, "強者至少拿到一座");
  assert(star.trophies.length >= 1 && st.company.money > m0, "獎座與獎金");
  assert(h.results.some(function (r) { return r.award === "film_actress"; }), "女主角獎有結果");
  assert(!h.results.filter(function (r) { return r.award === "film_actor"; })[0].nominees.some(function (n) { return n.aid === star.id; }), "女性不會入圍男主角");
  assert(st.log.some(function (e) { return e.type === "awards"; }), "日誌");
});

test("頒獎：每年 12/30 自動舉辦、歷史保留 10 年", function () {
  var st = Core.create({ seed: 2 });
  st.board = []; st.boardRefreshDay = 99999;
  freshArtist(st);
  Core.advance(st, 359);
  eq(st.awards.history.length, 1, "第 1 年 12/30");
  for (var y = 0; y < 11; y++) Core.advance(st, 360);
  eq(st.awards.history.length, 10, "保留 10 年"); eq(st.awards.history[0].year, 12);
});
```

- [ ] **Step 2：執行，確認失敗**

Run: `node tools/starv_check/core_check.js`
Expected: 2 個 FAIL（`Core.holdAwards is not a function`）

- [ ] **Step 3：實作**

`static_src/starv_data.js` 的 `BAL` 中 `tierWeight: …` 那行之前加入：

```js
    awardBase: { person: 40, work: 14, rookie: 25, group: 25, company: 30 }, awardFameDiv: 1000, awardRepDiv: 50, awardHistoryMax: 10,
    awardPrize: { money: { person: 30000, work: 30000, rookie: 20000, group: 30000, company: 100000 }, tickets: 2, rep: 80, fame: 300, nomFame: 80, groupFame: 200, rivalPower: 3 },
```

`static_src/starv_core.js` 插在 `  // ==== exports ====` 之前：

```js
  // ==== 年度頒獎典禮（§10） ====
  function personScore(a, from, dirs) { return topSum(recentWorks(a, from, dirs).map(workScore), 3) + a.fame / BAL.awardFameDiv; }

  function awardCandidates(st, aw, from) {
    var out = [], dirs = aw.dirs, base = BAL.awardBase[aw.kind];
    function genderOk(g) { return !aw.gender || aw.gender === g; }
    if (aw.kind === "person" || aw.kind === "rookie") {
      st.artists.forEach(function (a) {
        if (!genderOk(a.gender)) return;
        if (aw.kind === "rookie" && st.day - a.joinedDay > BAL.daysPerYear) return;
        var s;
        if (aw.filter === "veteran") {
          if (!(a.age >= 35 || st.day - a.joinedDay >= BAL.daysPerYear * 10)) return;
          s = topSum(a.works.map(workScore), 3) + a.trophies.length * 10;
        } else if (aw.by === "fame") s = a.fame * 3 / BAL.awardFameDiv;
        else if (!recentWorks(a, from, dirs).length) return;
        else s = personScore(a, from, dirs);
        if (s > 0) out.push({ kind: "artist", aid: a.id, score: s });
      });
      st.rivals.forEach(function (r) {
        var star = aw.kind === "person" ? r.stars.filter(function (s) {
          var e = Roster.byId(s.rosterId);
          return e && genderOk(e.gender) && (!dirs || dirs.indexOf(e.dir) >= 0);
        })[0] : null;
        if (star) out.push({ kind: "rstar", rival: r.id, rosterId: star.rosterId, score: rivalScore(st, r, base * 1.2) });
        else out.push({ kind: "rgen", rival: r.id, nameSeed: rint(st, 0, 999999), gender: aw.gender || (rnd(st) < 0.5 ? "f" : "m"), score: rivalScore(st, r, base) });
      });
    } else if (aw.kind === "work") {
      var best = {};
      st.artists.forEach(function (a) {
        recentWorks(a, from, dirs).forEach(function (w) {
          var key = w.dir + ":" + w.title.join(","), s = workScore(w) * (w.isWork ? 1 : 0.5);
          if (!best[key] || best[key].score < s) best[key] = { kind: "work", aid: a.id, title: w.title.slice(), dir: w.dir, score: s };
        });
      });
      Object.keys(best).forEach(function (k) { out.push(best[k]); });
      st.rivals.forEach(function (r) {
        var d = dirById(dirs ? pick(st, dirs) : pick(st, D.DIRS).id);
        out.push({ kind: "rwork", rival: r.id, dir: d.id, title: [rint(st, 0, d.title.a.length - 1), rint(st, 0, d.title.b.length - 1)], score: rivalScore(st, r, base) });
      });
    } else if (aw.kind === "group") {
      st.groups.forEach(function (g) {
        var members = g.members.map(function (id) { return artistById(st, id); }).filter(Boolean);
        if (!members.length || (dirs && !members.some(function (a) { return dirs.indexOf(a.dir) >= 0; }))) return;
        var s = members.reduce(function (sum, a) { return sum + personScore(a, from, null); }, 0) / members.length + g.jobs;
        if (s > 0) out.push({ kind: "group", gid: g.id, score: s });
      });
      st.rivals.forEach(function (r) { out.push({ kind: "rgroup", rival: r.id, score: rivalScore(st, r, base) }); });
    } else if (aw.kind === "company") {
      out.push({ kind: "company", score: (st.company.rep - st.company.repYearStart) / BAL.awardRepDiv });
      st.rivals.forEach(function (r) { out.push({ kind: "rcompany", rival: r.id, score: rivalScore(st, r, base) }); });
    }
    return out.filter(function (n) { return n.score > 0; });
  }

  function isOurs(n) { return n.kind === "artist" || n.kind === "work" || n.kind === "group" || n.kind === "company"; }

  function awardPrize(st, aw, n, won, year) {
    var P = BAL.awardPrize;
    if (n.kind === "artist" || n.kind === "work") {
      var a = artistById(st, n.aid);
      if (a) {
        a.fame = Math.min(99999, a.fame + (won ? P.fame : n.kind === "artist" ? P.nomFame : 0));
        if (won) { a.trophies.push({ award: aw.id, year: year }); a.satisfaction = clamp(a.satisfaction + 10, 0, 100); }
      }
    }
    if (n.kind === "group" && won) {
      var g = null;
      st.groups.forEach(function (x) { if (x.id === n.gid) g = x; });
      if (g) g.members.forEach(function (id) {
        var m = artistById(st, id);
        if (m) { m.fame = Math.min(99999, m.fame + P.groupFame); m.trophies.push({ award: aw.id, year: year }); }
      });
    }
    if (won && isOurs(n)) {
      st.company.money += P.money[aw.kind];
      st.company.tickets += P.tickets;
      addRep(st, P.rep);
    }
    if (won && n.rival) { var r = rivalById(st, n.rival); if (r) r.power += P.rivalPower; }
  }

  function holdAwards(st) {
    var year = dateOf(st.day).year, from = st.day - BAL.daysPerYear, results = [], wins = 0;
    D.AWARDS.forEach(function (aw) {
      var noms = awardCandidates(st, aw, from).sort(function (x, y) { return y.score - x.score; }).slice(0, 5);
      if (!noms.length) return;
      var w = {};
      noms.forEach(function (n, i) { w[i] = n.score * n.score; });
      var win = Number(wpick(st, w));
      results.push({ award: aw.id, nominees: noms, winner: win });
      if (isOurs(noms[win])) wins++;
      noms.forEach(function (n, i) { awardPrize(st, aw, n, i === win, year); });
    });
    st.awards.history.unshift({ year: year, results: results });
    if (st.awards.history.length > BAL.awardHistoryMax) st.awards.history.length = BAL.awardHistoryMax;
    st.awards.unseen = year;
    log(st, "awards", { year: year, wins: wins });
  }
```

`advanceDay` 中 `if (st.day % BAL.daysPerYear === 0) { yearly(st); rivalYear(st); }` 之前加入：

```js
    if (st.day % BAL.daysPerYear === BAL.daysPerYear - 1) holdAwards(st);
```

exports 區塊加入 `api.holdAwards = holdAwards;`

- [ ] **Step 4：執行，確認通過**

Run: `node tools/starv_check/core_check.js`
Expected: `全部 77 個通過`

- [ ] **Step 5：commit**

```bash
node --check static_src/starv_core.js && node --check static_src/starv_data.js
git add static_src/starv_core.js static_src/starv_data.js tools/starv_check/core_check.js
git commit -m "feat(starv): 年度頒獎典禮（55 獎項、入圍與得獎、獎座、歷屆紀錄）"
```

---

### Task 5：對手事件

**Files:**
- Create: `static_src/starv_events_2.js`
- Modify: `static_src/starv_core.js`、`tools/starv_check/core_check.js`、`site_src/starv_page.py`、`tools/starv_check/sim.js`

**Interfaces:**
- Produces:
  - 事件可以有 `rival: true`：觸發時 `ctx.rival` 設為隨機一家對手的 id；若有 `needStar: true`，`ctx.star` 設為該對手的一位宿敵明星（rosterId）
  - 新 fx：`rivalPower`（加到 `ctx.rival` 那家對手）；`applyFx` 回傳 `fx.rivalPower`、`fx.rival`
  - 6 種事件（`addedIn: "v2"`）：`rival_collab`、`paparazzi`、`schedule_clash`、`rival_challenge`、`joint_brand`、`rival_poach`
  - 事件資料測試的 fx 白名單加入 `rivalPower`

- [ ] **Step 1：寫失敗測試**

`core_check.js`：`require("../../static_src/starv_events_1.js");` 之後加 `require("../../static_src/starv_events_2.js");`

在「事件資料：40 種、格式正確」測試中，FX 陣列最後加上 `"rivalPower"`。

插在 `// ==== run ====` 之前：

```js
test("對手事件：帶公司與明星、影響對手實力", function () {
  eq(Events.all().filter(function (e) { return e.addedIn === "v2"; }).length, 6, "v2 事件數");
  var st = Core.create({ seed: 4 }), a = freshArtist(st, { fame: 500 });
  var e = Core.triggerEvent(st, "rival_collab", a.id);
  var r = Core.rivalById(st, e.ctx.rival);
  assert(r, "ctx.rival"); var p0 = r.power;
  var res = Core.resolveEvent(st, e.uid, 0);
  eq(r.power, p0 + 5); eq(res.fx.rivalPower, 5); eq(res.fx.rival, r.id);
  var e2 = Core.triggerEvent(st, "rival_challenge", a.id);
  assert(e2.ctx.star && Roster.byId(e2.ctx.star).kind === "rival", "ctx.star");
});
```

- [ ] **Step 2：執行，確認失敗**

Run: `node tools/starv_check/core_check.js`
Expected: `Cannot find module '../../static_src/starv_events_2.js'`

- [ ] **Step 3：建立 `static_src/starv_events_2.js`**

```js
// 明星經紀 starV：重大事件 v2——對手公司互動（6 種；規格 §7、§9）。
// rival: true → 觸發時抽一家對手放進 ctx.rival；needStar: true → 另外放一位該公司的宿敵明星到 ctx.star。
// 文字佔位 {rival}＝對手公司名、{star}＝宿敵明星名。
(function () {
  "use strict";

  var root = typeof window !== "undefined" ? window : globalThis;
  var T = root.PriTestStarvData.T;

  function O(w, fx, bad) { return { w: w, fx: fx || {}, bad: !!bad }; }
  function C(label, hint, outcomes) { return { label: T(label), hint: T(hint), outcomes: outcomes }; }
  function E(id, category, target, title, text, choices, defaultChoice, extra) {
    var ev = { id: id, addedIn: "v2", category: category, target: target, trigger: "random", weight: 10, rival: true,
      title: T(title), text: T(text), choices: choices, defaultChoice: defaultChoice };
    Object.keys(extra || {}).forEach(function (k) { ev[k] = extra[k]; });
    return ev;
  }

  root.PriTestStarvEvents.add([
    E("rival_collab", "chance", "famous", "聯合演出邀約|合同出演の打診", "{rival}提議讓 {name} 和他們的藝人聯合演出。|{rival}が {name} と自社タレントの共演を持ちかけてきた。", [
      C("答應|引き受ける", "人氣↑ 資金↑ 對手也變強|人気↑ 資金↑ 相手も強くなる", [O(1, { fame: 60, money: 20000, rivalPower: 5 })]),
      C("婉拒|断る", "沒有變化|変化なし", [O(1, {})])
    ], 1),
    E("paparazzi", "scandal", "famous", "對手放狗仔|ライバルの差し金", "週刊爆料 {name} 的負面消息，消息來源據說是{rival}。|{name} の悪い噂が週刊誌に。情報源は{rival}らしい。", [
      C("反擊爆料|暴露で反撃", "對手變弱 但可能兩敗俱傷|相手が弱る　ただし共倒れも", [O(5, { rivalPower: -10, famePct: -0.05 }), O(5, { famePct: -0.15, rivalPower: -5 }, true)]),
      C("發聲明澄清|声明で否定", "花錢 壓力↑|出費 ストレス↑", [O(1, { money: -10000, stress: 5 })]),
      C("無視|無視する", "看運氣|運次第", [O(6, {}), O(4, { famePct: -0.1 }, true)])
    ], 2),
    E("schedule_clash", "chance", "any", "搶檔期|スケジュールの奪い合い", "{rival}的新作和 {name} 的作品撞期了。|{rival}の新作が {name} の作品と公開日が重なった。", [
      C("硬碰硬|正面から勝負", "看運氣|運次第", [O(5, { fame: 80, rivalPower: -5 }), O(5, { famePct: -0.1, stress: 10 }, true)]),
      C("讓檔|日程をずらす", "沒有變化|変化なし", [O(1, {})])
    ], 1),
    E("rival_challenge", "special", "famous", "宿敵下戰帖|ライバルからの挑戦状", "{rival}的{star}在節目上公開向 {name} 下戰帖。|{rival}の{star}が番組で {name} に挑戦状を叩きつけた。", [
      C("應戰|受けて立つ", "看板出現指名工作|指名の仕事がボードに", [O(1, { specialJob: true, stress: 10 })]),
      C("不理會|相手にしない", "人氣小幅↓|人気やや↓", [O(1, { famePct: -0.05 })])
    ], 1, { needStar: true }),
    E("joint_brand", "company", "none", "聯名活動|コラボ企画", "{rival}想和公司一起辦聯名活動。|{rival}が共同キャンペーンを提案してきた。", [
      C("合作|組む", "資金↑ 聲望↑ 對手也變強|資金↑ 評判↑ 相手も強くなる", [O(1, { money: 40000, rep: 20, rivalPower: 5 })]),
      C("婉拒|断る", "沒有變化|変化なし", [O(1, {})])
    ], 1),
    E("rival_poach", "poach", "famous", "對手公開挖角|ライバルの公然の引き抜き", "{rival}在記者會上公開說想簽下 {name}。|{rival}が会見で {name} を獲得したいと公言した。", [
      C("加薪留人|昇給して引き留める", "月薪↑ 滿意度↑|月給↑ 満足度↑", [O(1, { salaryPct: 0.3, satisfaction: 15 })]),
      C("放人換違約金|違約金をもらって手放す", "失去藝人 資金↑ 對手變強|タレントを失う 資金↑ 相手が強くなる", [O(1, { leave: true, moneyBySalary: 6, rivalPower: 10 })]),
      C("談感情|情に訴える", "看滿意度|満足度次第", [O(5, { satisfaction: -5 }), O(5, { leave: true, rivalPower: 10 }, true)])
    ], 2)
  ]);
})();
```

- [ ] **Step 4：事件引擎支援對手**

`static_src/starv_core.js`：
1. `pushEvent` 中 `var e = { uid: newId(st, "e"), … };` 之後加入：

```js
    var ev = D.EVENT_BY_ID[id];
    if (ev.rival && st.rivals.length && !e.ctx.rival) {
      var withStar = st.rivals.filter(function (r) { return r.stars.length; });
      var rv = ev.needStar && withStar.length ? pick(st, withStar) : pick(st, st.rivals);
      e.ctx.rival = rv.id;
      if (ev.needStar && rv.stars.length) e.ctx.star = pick(st, rv.stars).rosterId;
    }
```

2. `applyFx` 中 `return out;` 之前加入：

```js
    if (fx.rivalPower && e.ctx && e.ctx.rival) {
      var rr = rivalById(st, e.ctx.rival);
      if (rr) { rr.power = Math.max(1, rr.power + fx.rivalPower); out.rivalPower = fx.rivalPower; out.rival = rr.id; }
    }
```

`site_src/starv_page.py`：`"starv_events_1.js",` 之後加 `"starv_events_2.js",`；`tools/starv_check/sim.js`：`require("../../static_src/starv_events_1.js");` 之後加 `require("../../static_src/starv_events_2.js");`

- [ ] **Step 5：執行，確認通過**

Run: `node tools/starv_check/core_check.js`
Expected: `全部 78 個通過`

- [ ] **Step 6：commit**

```bash
node --check static_src/starv_events_2.js && node --check static_src/starv_core.js
git add static_src/starv_events_2.js static_src/starv_core.js tools/starv_check/core_check.js site_src/starv_page.py tools/starv_check/sim.js
git commit -m "feat(starv): 對手公司互動事件（聯演、狗仔、搶檔、下戰帖、聯名、挖角）"
```

---

### Task 6：模擬與頒獎平衡

**Files:**
- Modify: `tools/starv_check/sim.js`（必要時 `static_src/starv_data.js`）

**Interfaces:**
- Produces: sim 每 5 年的表格加上 `wins`（當年得獎數）與 `rivals`（對手實力平均）；新 WARN：「積極經營 30 年從未得獎」、「積極經營第 20 年後單屆得獎 > 60%（33 座）」、「對手數量不是 5」（不變量，算 ERROR）

- [ ] **Step 1：修改 sim.js**

在 `checkState` 函式中最後加入：

```js
  if (st.rivals.length !== D.BAL.rivalCount) fail(tag + " 對手數量 " + st.rivals.length);
```

在 `runScenario` 的 `rows.push({ … })` 物件中加入：

```js
          wins: st.awards.history.length ? st.awards.history[0].results.filter(function (r) { var n = r.nominees[r.winner]; return ["artist", "work", "group", "company"].indexOf(n.kind) >= 0; }).length : 0,
          rivals: Math.round(st.rivals.reduce(function (s, r) { return s + r.power; }, 0) / st.rivals.length),
```

在平衡期望區塊加入：

```js
var activeWins = active.rows.reduce(function (s, r) { return s + r.wins; }, 0);
if (YEARS >= 30 && activeWins === 0) warn("積極經營 30 年從未得獎");
active.rows.forEach(function (r) { if (r.year >= 20 && r.wins > 33) warn("積極經營第 " + r.year + " 年得獎 " + r.wins + " 座（> 60%）"); });
```

- [ ] **Step 2：執行模擬並依 WARN 調整**

Run: `node tools/starv_check/sim.js 30`

只調 `BAL.awardBase` 的各項（從未得獎 → 調低；後期包辦 → 調高 `rivalYearGrowth` 或 `awardBase.person`／`work`），每次只改一項並重跑 `node tools/starv_check/sim.js 30` 與 `node tools/starv_check/core_check.js`。最後的數值與各情境的得獎數寫進 commit message。

- [ ] **Step 3：commit**

```bash
git add tools/starv_check/sim.js static_src/starv_data.js
git commit -m "test(starv): 模擬加入得獎數與對手實力（附調整後數值）"
```

---

### Task 7：UI——試鏡標示、對手事件文字、日誌

**Files:**
- Modify: `static_src/starv_view_jobs.js`、`static_src/starv_view_artists.js`、`static_src/starv_events_ui.js`、`static_src/starv_log.js`、`site_src/i18n_starv.py`、`static_src/css/starv.css`、`tools/starv_check/ui_check.js`

**Interfaces:**
- Produces:
  - 工作卡：試鏡制顯示 `.sv-chip-audition`「試鏡制」；對手有興趣顯示 `.sv-chip-interest`「{rival} 有興趣」；指名工作顯示 `.sv-chip-reserved`「指名」
  - 選角的簽約鈕在試鏡工作上顯示「報名試鏡」
  - 藝人卡的行程：`sv_task_audition`
  - 事件卡：`{rival}`、`{star}` 佔位；效果 `rivalPower` 的文字
  - 新日誌文字：`rival_scandal`、`rival_star_retire`、`rival_bankrupt`、`rival_star_join`、`rival_new`、`audition_won`、`audition_lost`、`job_snatched`、`chart_top`、`awards`
  - `UI.rivalName(st, id)`（找不到時回傳「已退出的公司」）

- [ ] **Step 1：在 `ui_check.js` 追加步驟**

```js
step("工作：試鏡制與對手有興趣的標示", async function (page) {
  await page.evaluate(function () {
    window.PriTestStarv.app.act(function (s) {
      var C = window.PriTestStarvCore;
      var j = C._genJob(s, { tier: "C" }); j.audition = true; j.interest = s.rivals[0].id; s.board.unshift(j);
    });
  });
  await tab(page, "jobs");
  await page.waitForSelector(".sv-chip-audition");
  await page.waitForSelector(".sv-chip-interest");
  await noRawKeys(page, "試鏡標示");
});
```

- [ ] **Step 2：執行，確認失敗**

Run: `py -3 generate.py && node tools/starv_check/ui_check.js`
Expected: `FAIL 工作：試鏡制與對手有興趣的標示：…`

- [ ] **Step 3：追加字串**

```python
    # ---- 對手、試鏡、排行榜、頒獎 ----
    ("sv_rival_gone", "已退出的公司", "撤退した事務所"),
    ("sv_job_audition", "試鏡制", "オーディション制"),
    ("sv_job_interest", "{rival} 有興趣", "{rival} が狙っている"),
    ("sv_job_reserved", "指名", "指名"),
    ("sv_cast_audition", "報名試鏡", "オーディションに応募"),
    ("sv_task_audition", "試鏡", "オーディション"),
    ("sv_fx_rivalPower", "{rival} 實力 {v}", "{rival} の勢力 {v}"),
    ("sv_log_rival_scandal", "{rival} 爆發醜聞，實力大跌", "{rival} がスキャンダルで失速"),
    ("sv_log_rival_star_retire", "{rival} 的 {star} 宣布引退", "{rival} の {star} が引退を発表"),
    ("sv_log_rival_bankrupt", "{rival} 經營不善，退出業界", "{rival} が経営難で業界から撤退"),
    ("sv_log_rival_star_join", "原 {rival} 的 {star} 想加入我們！", "元 {rival} の {star} がうちに来たいそうだ！"),
    ("sv_log_rival_new", "新的經紀公司 {rival} 成立了", "新しい事務所 {rival} が設立された"),
    ("sv_log_audition_won", "{names} 在「{title}」的試鏡中勝出！", "{names} が「{title}」のオーディションに合格！"),
    ("sv_log_audition_lost", "「{title}」的試鏡輸給了 {rival}", "「{title}」のオーディションで {rival} に敗れた"),
    ("sv_log_job_snatched", "{rival} 拿走了「{title}」", "{rival} が「{title}」を持っていった"),
    ("sv_log_chart_top", "{name} 拿下{chart}第 1 名！", "{name} が{chart}で 1 位！"),
    ("sv_log_awards", "第 {year} 年頒獎典禮：我們拿下 {wins} 座", "{year}年目の授賞式：うちは {wins} 冠"),
```

- [ ] **Step 4：UI 修改**

`static_src/starv_ui.js`：在 `function courseName(id) {` 之前加入：

```js
  function rivalName(st, id) {
    var r = id ? Core.rivalById(st, id) : null;
    return r ? Core.rivalName(r, lang()) : t("sv_rival_gone");
  }
```

並在 `window.PriTestStarvUI = {` 物件中 `courseName: courseName,` 之後加入 `rivalName: rivalName,`。

`static_src/starv_view_jobs.js` 的 `jobCard` 中把

```js
        job.isWork ? el("span", { class: "sv-chip sv-chip-work", text: t("sv_job_work") }) : null
```

換成：

```js
        el("div", { class: "sv-chips sv-job-tags" }, [
          job.isWork ? el("span", { class: "sv-chip sv-chip-work", text: t("sv_job_work") }) : null,
          job.audition ? el("span", { class: "sv-chip sv-chip-audition", text: t("sv_job_audition") }) : null,
          job.reservedFor ? el("span", { class: "sv-chip sv-chip-reserved", text: t("sv_job_reserved") }) : null,
          job.interest ? el("span", { class: "sv-chip sv-chip-interest", text: t("sv_job_interest", { rival: UI.rivalName(st, job.interest) }) }) : null
        ])
```

並把選角的簽約鈕文字 `UI.btn(t("sv_cast_sign"), function () {` 換成 `UI.btn(t(job.audition ? "sv_cast_audition" : "sv_cast_sign"), function () {`。

`static_src/starv_view_artists.js` 不需要修改：`taskLabel` 以 `t("sv_task_" + a.task.kind)` 組字，新字串 `sv_task_audition` 會自動套用。

`static_src/starv_events_ui.js`：
1. `fill` 函式換成：

```js
  function fill(text, vars) {
    return text.replace(/\{name\}/g, vars.name).replace(/\{n\}/g, vars.n == null ? "" : UI.num(vars.n))
      .replace(/\{rival\}/g, vars.rival || "").replace(/\{star\}/g, vars.star || "");
  }
```

2. `open` 中 `box.appendChild(el("p", { class: "sv-ev-text", text: fill(UI.L(ev.text), { name: name, n: (e || result).ctx.n }) }));` 換成：

```js
      var ctx = (e || result).ctx;
      var starName = ctx.star ? Core.rivalStarName({ rosterId: ctx.star }, UI.lang()) : "";
      box.appendChild(el("p", { class: "sv-ev-text", text: fill(UI.L(ev.text), { name: name, n: ctx.n, rival: ctx.rival ? UI.rivalName(st, ctx.rival) : "", star: starName }) }));
```

3. `fxLines` 中 `if (fx.allSalaryPct) …` 那行之後加入：

```js
    if (fx.rivalPower) out.push(t("sv_fx_rivalPower", { rival: UI.rivalName(st, fx.rival), v: signed(fx.rivalPower) }));
```

`static_src/starv_log.js` 的 `text` 函式中，`facility_up` 那行之後加入：

```js
    else if (/^rival_|^audition_|^job_snatched$/.test(e.type)) {
      p.rival = d.name ? Core.rivalName({ name: d.name }, UI.lang()) : d.rival ? UI.rivalName(st, d.rival) : "";
      if (d.rosterId) p.star = Core.rivalStarName({ rosterId: d.rosterId }, UI.lang());
      if (d.title) p.title = Core.jobTitle({ dir: d.dir, title: d.title }, UI.lang());
      if (d.aids) p.names = d.aids.map(function (id) { return artistLabel(st, id); }).join("、");
    } else if (e.type === "chart_top") {
      var ch = null;
      D.CHARTS.forEach(function (c) { if (c.id === d.chart) ch = c; });
      p.chart = ch ? UI.L(ch.name) : d.chart;
    } else if (e.type === "awards") { p.year = d.year; p.wins = d.wins; }
```

（倒閉的公司已不在 `st.rivals` 裡，所以 `rival_bankrupt`／`rival_star_join` 的日誌另外存了 `name`；有 `name` 時優先用 `Core.rivalName({ name })` 還原公司名。）

附加到 `starv.css`：

```css
/* ---- 試鏡與對手標示 ---- */
.sv-job-tags { margin-top: 0.25rem; }
.sv-chip-audition { border-color: var(--sv-gold); color: var(--sv-gold); font-size: 0.72em; }
.sv-chip-interest { border-color: var(--sv-bad); color: #ffb3c0; font-size: 0.72em; }
.sv-chip-reserved { border-color: var(--sv-pink); color: var(--sv-pink); font-size: 0.72em; }
```

- [ ] **Step 5：建置並執行**

```bash
py -3 generate.py && py -3 tools/split_css.py --check
for f in starv_ui starv_view_jobs starv_events_ui starv_log; do node --check static_src/$f.js || exit 1; done
node tools/starv_check/ui_check.js
```

Expected: `全部 15 個步驟通過`

- [ ] **Step 6：commit**

```bash
git add static_src/starv_ui.js static_src/starv_view_jobs.js static_src/starv_events_ui.js static_src/starv_log.js site_src/i18n_starv.py static_src/css/starv.css tools/starv_check/ui_check.js
git commit -m "feat(starv): 試鏡與對手標示、對手事件文字、對手與排行榜日誌"
```

---

### Task 8：UI——業界分頁（對手、排行榜、典禮紀錄）與頒獎典禮演出

**Files:**
- Create: `static_src/starv_awards_ui.js`
- Modify: `static_src/starv_view_industry.js`、`static_src/starv_view_company.js`、`site_src/starv_page.py`、`site_src/i18n_starv.py`、`static_src/css/starv.css`、`tools/starv_check/ui_check.js`

**Interfaces:**
- Consumes: `st.rivals`、`st.charts`、`st.awards`、`Core.holdAwards`、`Core.updateCharts`
- Produces:
  - `PriTestStarvAwardsUI.open(App, year)`（播放某一屆）、`.nomineeName(st, n)`
  - 新一屆（`st.awards.unseen`）在沒有其他彈窗時自動播放，看完把 `unseen` 設為 null
  - 典禮彈窗 class `sv-ceremony`；`data-act`：`ceremony-next`、`ceremony-skip`、`ceremony-close`
  - 業界分頁：對手卡 `.sv-rival`、排行榜卡 `.sv-chart`（分頁鈕 `data-act="chart-<id>"`）、典禮紀錄 `data-act="ceremony-replay-<year>"`
  - debug：`data-act="debug-awards"`（立即舉辦一屆）

- [ ] **Step 1：在 `ui_check.js` 追加步驟**

```js
step("業界：對手公司與排行榜", async function (page) {
  await page.evaluate(function () { window.PriTestStarv.app.act(function (s) { window.PriTestStarvCore.updateCharts(s); }); });
  await tab(page, "industry");
  var n = await page.$$eval(".sv-rival", function (x) { return x.length; });
  assert.strictEqual(n, 5, "對手卡數");
  await page.waitForSelector(".sv-chart li");
  await act(page, "chart-popularity");
  await noRawKeys(page, "業界：對手與排行榜");
});

step("頒獎典禮：舉辦 → 自動播放 → 跳過 → 重看", async function (page) {
  await tab(page, "company");
  await act(page, "debug-awards");
  await page.waitForSelector(".sv-ceremony");
  await noRawKeys(page, "典禮");
  await act(page, "ceremony-next");
  await act(page, "ceremony-skip");
  await page.waitForSelector('[data-act="ceremony-close"]');
  await noRawKeys(page, "典禮結果");
  await act(page, "ceremony-close");
  var s = await st(page);
  assert.strictEqual(s.awards.unseen, null, "看完清掉 unseen");
  await tab(page, "industry");
  await act(page, "ceremony-replay-" + s.awards.history[0].year);
  await page.waitForSelector(".sv-ceremony");
  await act(page, "ceremony-skip");
  await act(page, "ceremony-close");
});
```

- [ ] **Step 2：執行，確認失敗**

Run: `py -3 generate.py && node tools/starv_check/ui_check.js`
Expected: `FAIL 業界：對手公司與排行榜：…`

- [ ] **Step 3：追加字串**

```python
    ("sv_rivals_title", "對手經紀公司", "ライバル事務所"),
    ("sv_rival_power", "實力 {n}", "勢力 {n}"),
    ("sv_rival_stars", "王牌：{names}", "看板：{names}"),
    ("sv_rival_nostar", "目前沒有王牌", "看板タレントなし"),
    ("sv_charts_title", "月度排行榜", "月間ランキング"),
    ("sv_charts_empty", "第一次月結後就會公布", "最初の月末に発表されます"),
    ("sv_charts_when", "{date} 公布", "{date} 発表"),
    ("sv_chart_score", "{n} 分", "{n} pt"),
    ("sv_ours", "我們", "うち"),
    ("sv_ceremony_title", "第 {year} 年頒獎典禮", "{year}年目 授賞式"),
    ("sv_ceremony_nominees", "入圍", "ノミネート"),
    ("sv_ceremony_winner", "得獎", "受賞"),
    ("sv_ceremony_next", "揭曉下一個", "次の発表へ"),
    ("sv_ceremony_skip", "跳到結果", "結果まで飛ばす"),
    ("sv_ceremony_summary", "我們拿下 {n} 座獎", "うちは {n} 冠"),
    ("sv_ceremony_none", "今年沒有得獎，明年再接再厲！", "今年は受賞なし。来年こそ！"),
    ("sv_ceremony_progress", "{i} / {n}", "{i} / {n}"),
    ("sv_ceremony_history", "歷屆頒獎典禮", "歴代の授賞式"),
    ("sv_ceremony_replay", "第 {year} 年（我們 {n} 座）", "{year}年目（うち {n} 冠）"),
    ("sv_ceremony_empty", "每年 12 月 30 日舉辦", "毎年 12 月 30 日に開催"),
    ("sv_rgroup", "{rival} 的組合", "{rival} のユニット"),
    ("sv_debug_awards", "立即舉辦頒獎典禮", "授賞式を今すぐ開催"),
    ("sv_trophies", "獎座", "トロフィー"),
```

- [ ] **Step 4：建立 `static_src/starv_awards_ui.js`**

```js
// 明星經紀 starV：頒獎典禮演出（規格 §10）。新一屆在沒有其他彈窗時自動播放；也可以從業界分頁重看歷屆。
// 一次揭曉一個獎項（可以跳到結果），最後列出我們拿到的獎。
(function () {
  "use strict";

  var D = window.PriTestStarvData;
  var Core = window.PriTestStarvCore;
  var Roster = window.PriTestStarvRoster;
  var UI = window.PriTestStarvUI;
  var t = UI.t, el = UI.el;
  var OURS = { artist: 1, work: 1, group: 1, company: 1 };

  function groupName(st, gid) { var g = null; st.groups.forEach(function (x) { if (x.id === gid) g = x; }); return g ? g.name : "—"; }
  function nomineeName(st, n) {
    var lang = UI.lang();
    if (n.kind === "artist") { var a = Core.artistById(st, n.aid); return a ? UI.name(a) : "—"; }
    if (n.kind === "rstar") return Core.rivalStarName({ rosterId: n.rosterId }, lang);
    if (n.kind === "rgen") return Core.artistName({ rosterId: null, nameSeed: n.nameSeed, gender: n.gender }, lang);
    if (n.kind === "work") { var w = Core.artistById(st, n.aid); return Core.jobTitle(n, lang) + (w ? "（" + UI.name(w) + "）" : ""); }
    if (n.kind === "rwork") return Core.jobTitle(n, lang);
    if (n.kind === "group") return groupName(st, n.gid);
    if (n.kind === "rgroup") return t("sv_rgroup", { rival: UI.rivalName(st, n.rival) });
    if (n.kind === "company") return st.company.name || t("sv_company_default");
    if (n.kind === "rcompany") return UI.rivalName(st, n.rival);
    return "—";
  }
  function nomineeOrg(st, n) { return OURS[n.kind] ? t("sv_ours") : UI.rivalName(st, n.rival); }
  function nomineeAvatar(st, n) {
    if (n.kind === "artist" || n.kind === "work") { var a = Core.artistById(st, n.aid); return a ? UI.avatar(a, 36) : null; }
    if (n.kind === "rstar") { var e = Roster.byId(n.rosterId); return e ? UI.avatar(e, 36) : null; }
    return el("span", { class: "sv-ava sv-ava-r sv-ava-ghost", style: "--sv-size:36px" });
  }

  function open(App, year) {
    var step = 0;
    UI.openModal(function (box, close) {
      var st = App.st(), h = null;
      st.awards.history.forEach(function (x) { if (x.year === year) h = x; });
      if (!h) { close(); return; }
      var results = h.results;
      box.appendChild(UI.modalHead("🏆 " + t("sv_ceremony_title", { year: year }), close));
      if (step < results.length) {
        var r = results[step], aw = D.AWARD_BY_ID[r.award], cer = null;
        D.CEREMONIES.forEach(function (c) { if (aw && c.id === aw.ceremony) cer = c; });
        box.appendChild(el("div", { class: "sv-small sv-muted", text: (cer ? UI.L(cer.name) : "") + "・" + t("sv_ceremony_progress", { i: step + 1, n: results.length }) }));
        box.appendChild(el("h3", { class: "sv-award-name", text: aw ? UI.L(aw.name) : r.award }));
        box.appendChild(el("ul", { class: "sv-noms" }, r.nominees.map(function (n, i) {
          return el("li", { class: "sv-nom" + (i === r.winner ? " sv-nom-win" : "") + (OURS[n.kind] ? " sv-nom-ours" : "") }, [
            nomineeAvatar(st, n),
            el("div", { class: "sv-grow" }, [el("b", { text: nomineeName(st, n) }), el("div", { class: "sv-small sv-muted", text: nomineeOrg(st, n) })]),
            i === r.winner ? el("span", { class: "sv-chip sv-nom-badge", text: "🏆 " + t("sv_ceremony_winner") }) : null
          ]);
        })));
        box.appendChild(el("div", { class: "sv-row sv-row-end" }, [
          UI.btn(t("sv_ceremony_skip"), function () { step = results.length; UI.refreshModal(); }, "sv-btn-ghost", { "data-act": "ceremony-skip" }),
          UI.btn(t("sv_ceremony_next"), function () { step++; UI.refreshModal(); }, "sv-btn-primary", { "data-act": "ceremony-next" })
        ]));
        return;
      }
      var mine = results.filter(function (x) { return OURS[x.nominees[x.winner].kind]; });
      box.appendChild(el("h3", { text: mine.length ? t("sv_ceremony_summary", { n: mine.length }) : t("sv_ceremony_none") }));
      if (mine.length) box.appendChild(el("ul", { class: "sv-noms" }, mine.map(function (x) {
        var aw = D.AWARD_BY_ID[x.award], n = x.nominees[x.winner];
        return el("li", { class: "sv-nom sv-nom-win sv-nom-ours" }, [nomineeAvatar(st, n), el("div", { class: "sv-grow" }, [el("b", { text: aw ? UI.L(aw.name) : x.award }), el("div", { class: "sv-small", text: nomineeName(st, n) })])]);
      })));
      box.appendChild(el("div", { class: "sv-row sv-row-end" }, [UI.btn(t("sv_close"), close, "sv-btn-primary", { "data-act": "ceremony-close" })]));
    }, { live: true, cls: "sv-modal-wide sv-ceremony", onClose: function () {
      var st = App.st();
      if (st.awards.unseen === year) App.act(function (s) { s.awards.unseen = null; });
    } });
  }

  // 新一屆自動播放（沒有其他彈窗時）
  UI.addExtra(function (App) {
    var st = App.st();
    if (!st.awards || st.awards.unseen == null || UI.modalIsOpen()) return null;
    var y = st.awards.unseen;
    setTimeout(function () { if (!UI.modalIsOpen() && App.st().awards.unseen === y) open(App, y); }, 0);
    return null;
  });

  window.PriTestStarvAwardsUI = { open: open, nomineeName: nomineeName, ours: function (n) { return !!OURS[n.kind]; } };
})();
```

- [ ] **Step 5：業界分頁加卡片**

`static_src/starv_view_industry.js`：
1. 檔案開頭的 `var t = UI.t, el = UI.el;` 之後加入：

```js
  var Roster = window.PriTestStarvRoster;
  var chartTab = "single";
```

2. 在 `UI.register({` 之前加入：

```js
  function rivalsCard(st) {
    var max = Math.max.apply(null, st.rivals.map(function (r) { return r.power; }).concat([100]));
    return el("div", { class: "sv-card" }, [el("h3", { text: "🏢 " + t("sv_rivals_title") })].concat(st.rivals.map(function (r) {
      var names = r.stars.map(function (s) { return Core.rivalStarName(s, UI.lang()); }).join("、");
      return el("div", { class: "sv-rival" }, [
        el("div", { class: "sv-row" }, [el("b", { class: "sv-grow", text: Core.rivalName(r, UI.lang()) }), el("span", { class: "sv-small", text: t("sv_rival_power", { n: Math.round(r.power) }) })]),
        UI.bar(r.power, max, "sv-bar-rival"),
        el("div", { class: "sv-rival-stars" }, r.stars.map(function (s) { var e = Roster.byId(s.rosterId); return e ? UI.avatar(e, 32) : null; }).concat([
          el("span", { class: "sv-small sv-muted", text: names ? t("sv_rival_stars", { names: names }) : t("sv_rival_nostar") })
        ]))
      ]);
    })));
  }

  function entryName(st, n) { return window.PriTestStarvAwardsUI.nomineeName(st, n); }
  function chartsCard(st, App) {
    var card = el("div", { class: "sv-card sv-chart" }, [el("h3", { text: "📊 " + t("sv_charts_title") })]);
    card.appendChild(el("div", { class: "sv-subtabs" }, D.CHARTS.map(function (c) {
      return UI.btn(UI.L(c.name), function () { chartTab = c.id; App.render(); }, chartTab === c.id ? "sv-btn-primary" : "sv-btn-ghost", { "data-act": "chart-" + c.id });
    })));
    if (!st.charts) { card.appendChild(el("p", { class: "sv-muted", text: t("sv_charts_empty") })); return card; }
    card.appendChild(el("div", { class: "sv-small sv-muted", text: t("sv_charts_when", { date: UI.dateText(st.charts.day) }) }));
    card.appendChild(el("ol", { class: "sv-chart-list" }, (st.charts.lists[chartTab] || []).map(function (n) {
      var ours = n.kind === "artist";
      return el("li", { class: ours ? "sv-chart-ours" : "" }, [
        el("span", { class: "sv-grow", text: entryName(st, n) }),
        el("span", { class: "sv-small sv-muted", text: ours ? t("sv_ours") : UI.rivalName(st, n.rival) }),
        el("span", { class: "sv-small", text: t("sv_chart_score", { n: Math.round(n.score) }) })
      ]);
    })));
    return card;
  }

  function historyCard(st, App) {
    var A = window.PriTestStarvAwardsUI;
    var rows = st.awards.history.map(function (h) {
      var n = h.results.filter(function (r) { return A.ours(r.nominees[r.winner]); }).length;
      return UI.btn(t("sv_ceremony_replay", { year: h.year, n: n }), function () { A.open(App, h.year); }, "sv-btn-ghost", { "data-act": "ceremony-replay-" + h.year });
    });
    return el("div", { class: "sv-card" }, [
      el("h3", { text: "🏆 " + t("sv_ceremony_history") }),
      rows.length ? el("div", { class: "sv-row" }, rows) : el("p", { class: "sv-muted", text: t("sv_ceremony_empty") })
    ]);
  }
```

3. render 中 `c.appendChild(rumorCard(st));` 之後加入：

```js
      c.appendChild(chartsCard(st, App));
      c.appendChild(rivalsCard(st));
      c.appendChild(historyCard(st, App));
```

`static_src/starv_view_company.js` 的 `debugCard` 中 `debug-event` 那個按鈕之後加入：

```js
        , UI.btn(t("sv_debug_awards"), function () { App.act(function (s) { Core.holdAwards(s); }); }, "", { "data-act": "debug-awards" })
```

（`debug-event` 那個按鈕原本是陣列最後一個元素、沒有結尾逗號，所以以逗號開頭。）

`site_src/starv_page.py`：`"starv_events_ui.js",` 之後加 `"starv_awards_ui.js",`（必須在 `starv_view_industry.js` 實際 render 之前載入；所有腳本在 `starv.js` 第一次 render 前都已載入完畢，順序只要在 `starv.js` 之前即可）

附加到 `starv.css`：

```css
/* ---- 對手、排行榜、頒獎典禮 ---- */
.sv-rival { padding: 0.5rem 0; border-top: 1px solid var(--sv-line); }
.sv-bar-rival > span { background: linear-gradient(90deg, #ff9a76, var(--sv-bad)); }
.sv-rival-stars { display: flex; align-items: center; gap: 0.35rem; margin-top: 0.3rem; flex-wrap: wrap; }
.sv-chart-list { margin: 0.5rem 0 0; padding-left: 1.6rem; }
.sv-chart-list li { padding: 0.25rem 0; border-top: 1px dashed var(--sv-line); }
.sv-chart-list li > * { display: inline-block; margin-right: 0.5rem; }
.sv-chart-ours { color: var(--sv-gold); font-weight: 700; }
.sv-ceremony { background: radial-gradient(ellipse at 50% 0%, rgba(255, 214, 107, 0.25), transparent 60%), linear-gradient(160deg, #2a1d56, #120c2c); }
.sv-award-name { font-size: 1.35em; margin: 0.3rem 0 0.6rem; color: var(--sv-gold); text-shadow: 0 0 18px rgba(255, 214, 107, 0.5); }
.sv-noms { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.4rem; }
.sv-nom { display: flex; align-items: center; gap: 0.6rem; padding: 0.45rem 0.7rem; border-radius: 12px; background: var(--sv-glass); border: 1px solid transparent; }
.sv-nom-ours { border-color: rgba(255, 95, 168, 0.5); }
.sv-nom-win { border-color: var(--sv-gold); background: rgba(255, 214, 107, 0.14); animation: sv-pop 0.35s ease-out; }
.sv-nom-badge { border-color: var(--sv-gold); color: var(--sv-gold); }
```

- [ ] **Step 6：建置並執行全部檢查**

```bash
py -3 generate.py && py -3 tools/split_css.py --check
for f in static_src/starv*.js; do node --check "$f" || exit 1; done
node tools/starv_check/core_check.js
node tools/starv_check/sim.js 30
node tools/starv_check/ui_check.js
```

Expected：`core_check` 全部 78 個通過；`sim` 不變量全部通過；`ui_check` 全部 17 個步驟通過。

- [ ] **Step 7：檢視截圖**

用 Read 打開 `tools/starv_check/shots/tab-industry.png`，確認對手卡的實力條、排行榜清單、典禮紀錄鈕沒有溢出。

- [ ] **Step 8：commit**

```bash
git add static_src/starv_awards_ui.js static_src/starv_view_industry.js static_src/starv_view_company.js site_src/starv_page.py site_src/i18n_starv.py static_src/css/starv.css tools/starv_check/ui_check.js
git commit -m "feat(starv): 業界分頁（對手、排行榜、歷屆典禮）、頒獎典禮演出"
```
