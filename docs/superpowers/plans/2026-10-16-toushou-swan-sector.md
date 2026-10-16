# 東正小遊戲 進階2：黑天鵝事件卡＋板塊連動 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增可選的黑天鵝事件卡（19 種事件＋7 張平靜）與板塊連動起始價。

**Architecture:** 事件卡資料放 `toushou_data.js`；所有效果在 `toushou_core.js` 的既有節點套用（`startBetting` 起始價、`placeBet` 完成時抽卡與決定股東順序、`newsError` 封口令、`commitDelta` 加減分與價格事件、`settleCurrent`／`settleTarget` 結算事件）。UI 只負責顯示與開局勾選。

**Tech Stack:** Vanilla ES5、`py -3 generate.py`、Node 檢查、Playwright。

## Global Constraints

- 規格：`docs/superpowers/specs/2026-10-16-toushou-swan-sector-design.md`。
- 兩個開關 `blackSwanEnabled`／`sectorLinkEnabled` 預設關；舊存檔缺欄位視為關、`current.startPrice` 缺少時視為 100。
- **事件未啟用時 PRNG 的消耗順序必須和現在完全相同**（既有檢查與存檔重現性）。
- round＝四捨五入、.5 遠離 0；避免產生 `-0`。
- 計算順序：原始 → 事件修正 → 熔斷 → 價格下限 0 → 價格事件 → （最後一則）謠言 → 結算事件。
- i18n：`zh`、`ja` 都加；事件名稱與說明放在資料檔（`C(ja, zh)`）。
- commit 繁體中文＋兩行 attribution；推送只用 `git push private main` 且先徵求同意。

---

### Task 1: 資料＋規則引擎＋core_check

**Files:**
- Modify: `static_src/toushou_data.js`（`SWAN_CARDS`、`SWAN_COMPOSITION`、export）
- Modify: `static_src/toushou_core.js`
- Test: `tools/toushou_check/core_check.js`（新增 `[core: swan & sector]`，放在 `[core: settle]` 區段之後、`[core: missions]` 之前）

**Interfaces（Produces）:**
- `D.SWAN_CARDS[]`：`{ id, group, name: {ja,zh}, text: {ja,zh} }`；`D.SWAN_COMPOSITION = { calm: 7 }`（其他各 1）。
- `Core.swanById(id)`、`Core.sectorStartPrice(s, category) -> { price, from }`、`Core.modifyDelta(event, idx, n, delta, prevDelta) -> number`、`Core.gagActive(s) -> bool`、`Core.settleTarget(bets, finalPrice, seatOrder, opts?)`（`opts.reverse`、`opts.bonus`）。
- state：`config.blackSwanEnabled`、`config.sectorLinkEnabled`、`swanDeck`、`current.startPrice / sectorFrom / event / gap / shortcoverUsed`；`news[i].rawDelta / priceEvent / priceBeforeEvent`；`history[i].startPrice / sectorFrom / event / gap / rumorIndex / rumorDelta / cancelled / bonus`。

- [ ] **Step 1: 資料**

```js
  // 黑天鵝事件卡（進階2）。group：delta／price／flow／settle／calm。{k} 於顯示時代入
  function SW(id, group, ja, zh, jaText, zhText) {
    return { id: id, group: group, name: C(ja, zh), text: C(jaText, zhText) };
  }
  var SWAN_CARDS = [
    SW("circuit", "delta", "サーキットブレーカー", "熔斷", "各発表の増減は −10〜+10 に制限", "每一則的加減分限制在 −10～＋10"),
    SW("hype", "delta", "テーマ株騒動", "題材炒作", "1件目の増減が2倍", "第 1 則的加減分 ×2"),
    SW("whale", "delta", "大口参入", "主力進場", "最後の発表の増減が2倍", "最後一則的加減分 ×2"),
    SW("exhausted", "delta", "材料出尽くし", "利多出盡", "最後の発表の増減の正負が逆転", "最後一則的加減分正負反轉"),
    SW("fomo", "delta", "個人投資家の熱狂", "散戶狂熱", "プラスの増減が1.5倍", "為正的加減分 ×1.5"),
    SW("panic", "delta", "パニック売り", "恐慌拋售", "マイナスの増減が1.5倍", "為負的加減分 ×1.5"),
    SW("lull", "delta", "閑散相場", "量縮盤整", "すべての増減が半分", "每一則的加減分減半"),
    SW("momentum", "delta", "モメンタム", "動能效應", "2件目以降、直前の増減の半分が上乗せ", "第 2 則起，再加上前一則加減分的一半"),
    SW("exright", "price", "権利落ち予告", "預告除權", "{k}件目の後、株価が100に戻る", "第 {k} 則之後，價格回到 100"),
    SW("shortcover", "price", "買い戻し", "空頭回補", "初めて60を割ったとき即 +20", "第一次跌破 60 時立刻 +20"),
    SW("gap", "price", "窓開け", "跳空開盤", "株価が −20〜+20 ランダムに動く", "價格隨機變動 −20～＋20"),
    SW("limit", "price", "値幅制限", "漲跌停板", "株価は開始価格 ±50 の範囲内", "價格限制在起始價 ±50 以內"),
    SW("rumor", "price", "デマ発覚", "謠言破滅", "最後に1件の発表がデマと判明し、その増減が取り消される", "最後隨機揭穿 1 則消息，扣回它的加減分"),
    SW("extra", "flow", "臨時株主総会", "股東臨時會", "最初の株主が最後にもう1件発表する", "第一位股東在最後再發一則"),
    SW("gag", "flow", "箝口令", "封口令", "1件目は手札をそのまま出すのみ（改変・自作不可）", "第 1 則只能直接打出手牌（不能改寫或自訂）"),
    SW("reverse", "flow", "逆順発言", "逆序發言", "賭け後のチップが少ない順に発表", "依下注後剩餘籌碼由少到多發言"),
    SW("cancel", "settle", "取引取消", "交易取消", "最終株価が開始価格 ±5 以内なら全員の賭け金を返却", "最終價與起始價相差 5 以內則全員退回押注"),
    SW("upset", "settle", "大番狂わせ", "爆冷門", "誤差が大きい順に配当", "依誤差由大到小分配彩池"),
    SW("bailout", "settle", "救済資金", "紓困加碼", "銀行が彩池の50%を上乗せ", "銀行加碼彩池 50%"),
    SW("calm", "calm", "平穏", "平靜", "何も起きない", "沒有事件")
  ];
  var SWAN_COMPOSITION = { calm: 7 }; // 未列出的事件各 1 張
```

export 加 `SWAN_CARDS`、`SWAN_COMPOSITION`。

- [ ] **Step 2: 失敗的檢查**（見 Step 4 實作後的 `core_check` 區段；先貼上並執行，確認 FAIL）

```js
console.log("[core: swan & sector]");
function swanStarted(n, ev, extra) {
  var s = started(n, Object.assign({ blackSwanEnabled: true }, extra || {}));
  s.swanDeck = s.swanDeck.concat([ev]); // 下一張抽到 ev
  return s;
}
function betAll(s, amounts) {
  s.players.forEach(function (p, i) {
    s = Core.reduce(s, { type: "placeBet", playerId: p.id, amount: amounts ? amounts[i] : 100, predict: 100 });
  });
  return s;
}
function hostPlay(s, deltas) {
  deltas.forEach(function (d) { s = Core.reduce(release(s), { type: "applyDelta", delta: d }); });
  return s;
}
function lastNews(s) { return s.phase === "settle" ? s.history[s.history.length - 1].news : s.current.news; }

check("swan deck: 19 events x1 + 7 calm; disabled -> empty; data bilingual", function () {
  assert.strictEqual(D.SWAN_CARDS.length, 20);
  D.SWAN_CARDS.forEach(function (c) { bilingual(c.name, c.id); bilingual(c.text, c.id); });
  var s = Core.newGame(baseConfig(3, { blackSwanEnabled: true }));
  assert.strictEqual(s.swanDeck.length, 26);
  assert.strictEqual(s.swanDeck.filter(function (x) { return x === "calm"; }).length, 7);
  assert.deepStrictEqual(Core.newGame(baseConfig(3)).swanDeck, []);
});
check("disabled features keep old behaviour (same rng order, start 100, no event)", function () {
  var a = betAll(started(3));
  var b = betAll(started(3, { blackSwanEnabled: false, sectorLinkEnabled: false }));
  assert.deepStrictEqual(a, b);
  assert.strictEqual(a.current.startPrice, 100);
  assert.strictEqual(a.current.event, null);
});
check("sectorStartPrice: latest same category, half away from zero, floor 0", function () {
  var s = started(2);
  s.history = [{ category: "x", finalPrice: 160 }, { category: "y", finalPrice: 10 }];
  assert.deepStrictEqual(Core.sectorStartPrice(s, "x"), { price: 130, from: 160 });
  assert.deepStrictEqual(Core.sectorStartPrice(s, "z"), { price: 100, from: null });
  s.history.push({ category: "x", finalPrice: 40 });
  assert.strictEqual(Core.sectorStartPrice(s, "x").price, 70);
  s.history.push({ category: "x", finalPrice: 45 });
  assert.strictEqual(Core.sectorStartPrice(s, "x").price, 72);
  s.history.push({ category: "x", finalPrice: 0 });
  assert.strictEqual(Core.sectorStartPrice(s, "x").price, 50);
});
check("sector link applied at startBetting only when enabled", function () {
  function secondStart(extra) {
    var cfg = baseConfig(2, extra);
    cfg.targets = [cfg.targets[0], JSON.parse(JSON.stringify(cfg.targets[0]))];
    var s = Core.reduce(Core.newGame(cfg), { type: "startBetting" });
    s = hostPlay(betAll(s), [60, 0]);
    return Core.reduce(Core.reduce(s, { type: "nextTarget" }), { type: "startBetting" });
  }
  var on = secondStart({ sectorLinkEnabled: true });
  assert.strictEqual(on.current.startPrice, 130);
  assert.strictEqual(on.current.price, 130);
  assert.strictEqual(on.current.sectorFrom, 160);
  assert.strictEqual(secondStart({}).current.startPrice, 100);
});
check("modifyDelta table", function () {
  var m = Core.modifyDelta;
  assert.strictEqual(m(null, 0, 3, 7, 0), 7);
  assert.strictEqual(m("calm", 0, 3, 7, 0), 7);
  assert.strictEqual(m("circuit", 1, 3, 40, 0), 10);
  assert.strictEqual(m("circuit", 1, 3, -40, 0), -10);
  assert.strictEqual(m("hype", 0, 3, 7, 0), 14);
  assert.strictEqual(m("hype", 1, 3, 7, 0), 7);
  assert.strictEqual(m("whale", 2, 3, -7, 0), -14);
  assert.strictEqual(m("whale", 1, 3, -7, 0), -7);
  assert.strictEqual(m("exhausted", 2, 3, 9, 0), -9);
  assert.ok(!Object.is(m("exhausted", 2, 3, 0, 0), -0));
  assert.strictEqual(m("fomo", 0, 3, 5, 0), 8);
  assert.strictEqual(m("fomo", 0, 3, -5, 0), -5);
  assert.strictEqual(m("panic", 0, 3, -5, 0), -8);
  assert.strictEqual(m("panic", 0, 3, 5, 0), 5);
  assert.strictEqual(m("lull", 0, 3, 5, 0), 3);
  assert.strictEqual(m("lull", 0, 3, -5, 0), -3);
  assert.strictEqual(m("momentum", 0, 3, 10, 30), 10);
  assert.strictEqual(m("momentum", 1, 3, 10, 30), 25);
  assert.strictEqual(m("momentum", 1, 3, 10, -5), 7);
});
check("delta events recorded with rawDelta; wind zero happens before modifier (vote)", function () {
  var s = hostPlay(betAll(swanStarted(3, "hype")), [20, 5, 5]);
  var n = s.history[0].news;
  assert.strictEqual(n[0].delta, 40);
  assert.strictEqual(n[0].rawDelta, 20);
  assert.ok(!("rawDelta" in n[1]));
  assert.strictEqual(s.history[0].finalPrice, 150);
  assert.strictEqual(s.history[0].event, "hype");
  var v = release(betAll(swanStarted(2, "fomo", { deltaMode: "vote" })));
  v = Core.reduce(v, { type: "castVote", playerId: "p0", value: 10 });
  v = Core.reduce(v, { type: "castVote", playerId: "p1", value: 10 });
  assert.strictEqual(v.current.news[0].delta, 15);
  assert.strictEqual(v.current.news[0].rawDelta, 10);
});
check("exright / shortcover / limit price events", function () {
  var s = hostPlay(betAll(swanStarted(3, "exright")), [30, 30, 5]);
  var n = s.history[0].news;
  assert.strictEqual(n[1].priceEvent, "exright");
  assert.strictEqual(n[1].priceBeforeEvent, 160);
  assert.strictEqual(n[1].priceAfter, 100);
  assert.strictEqual(s.history[0].finalPrice, 105);
  s = hostPlay(betAll(swanStarted(3, "shortcover")), [-50, -30, 0]);
  n = s.history[0].news;
  assert.strictEqual(n[0].priceEvent, "shortcover");
  assert.strictEqual(n[0].priceAfter, 70);
  assert.ok(!n[1].priceEvent);
  assert.strictEqual(s.history[0].finalPrice, 40);
  s = hostPlay(betAll(swanStarted(2, "limit")), [80, -200]);
  n = s.history[0].news;
  assert.strictEqual(n[0].priceAfter, 150);
  assert.strictEqual(n[0].priceEvent, "limit");
  assert.strictEqual(n[1].priceAfter, 50);
});
check("gap moves price after bets, start price unchanged", function () {
  var s = betAll(swanStarted(3, "gap"));
  assert.ok(s.current.gap >= -20 && s.current.gap <= 20);
  assert.strictEqual(s.current.price, 100 + s.current.gap);
  assert.strictEqual(s.current.startPrice, 100);
  s = hostPlay(s, [0, 0, 0]);
  assert.strictEqual(s.history[0].gap, s.history[0].finalPrice - 100);
});
check("rumor removes one news delta before settlement", function () {
  var s = hostPlay(betAll(swanStarted(3, "rumor")), [30, -10, 4]);
  var h = s.history[0];
  assert.ok(h.rumorIndex >= 0 && h.rumorIndex < 3);
  assert.strictEqual(h.rumorDelta, h.news[h.rumorIndex].delta);
  assert.strictEqual(h.finalPrice, 124 - h.rumorDelta);
});
check("extra: first shareholder speaks again at the end", function () {
  var s = betAll(swanStarted(3, "extra"));
  assert.strictEqual(s.current.order.length, 4);
  assert.strictEqual(s.current.order[3], s.current.order[0]);
  s = hostPlay(s, [1, 1, 1, 1]);
  assert.strictEqual(s.history[0].news.length, 4);
  assert.strictEqual(s.history[0].finalPrice, 104);
});
check("reverse: order by remaining chips ascending, ties by seat", function () {
  var s = betAll(swanStarted(4, "reverse"), [100, 300, 200, 100]);
  assert.deepStrictEqual(s.current.order, ["p1", "p2", "p0", "p3"]);
});
check("gag: first news must be a playable card unless none playable", function () {
  var s = betAll(swanStarted(3, "gag"));
  var sh = Core.currentShareholder(s);
  var p = player(s, sh);
  var playable = D.NEWS_CARDS.filter(function (c) { return c.category === null && Core.cardPlayable(s, c.id); })[0].id;
  var other = D.NEWS_CARDS.filter(function (c) { return c.category !== null && !Core.cardPlayable(s, c.id); })[0].id;
  p.hand = [playable, other];
  assert.strictEqual(Core.gagActive(s), true);
  assert.strictEqual(Core.newsError(s, sh, null, "x", false), "ts_err_gag");
  assert.strictEqual(Core.newsError(s, sh, playable, "x", true), "ts_err_gag");
  assert.strictEqual(Core.newsError(s, sh, playable, "x", false), null);
  p.hand = [other];
  assert.strictEqual(Core.gagActive(s), false);
  assert.strictEqual(Core.newsError(s, sh, null, "x", false), null);
  p.hand = [playable];
  s = Core.reduce(Core.reduce(s, { type: "releaseNews", playerId: sh, cardId: playable, edited: false, text: "x" }), { type: "applyDelta", delta: 0 });
  assert.strictEqual(Core.gagActive(s), false);
});
check("cancel refunds within 5; not when 6 away", function () {
  var s = hostPlay(betAll(swanStarted(3, "cancel"), [100, 200, 300]), [5, 0, 0]);
  var h = s.history[0];
  assert.strictEqual(h.cancelled, true);
  assert.deepStrictEqual(h.ranks, {});
  assert.deepStrictEqual(h.payouts, { p0: 100, p1: 200, p2: 300 });
  assert.deepStrictEqual(s.players.map(function (p) { return p.chips; }), [1000, 1000, 1000]);
  s = hostPlay(betAll(swanStarted(3, "cancel")), [6, 0, 0]);
  assert.strictEqual(s.history[0].cancelled, false);
});
check("upset reverses ranking; bailout adds 50% bonus", function () {
  var b = { p0: { amount: 100, predict: 100 }, p1: { amount: 100, predict: 150 }, p2: { amount: 100, predict: 120 } };
  var r = Core.settleTarget(b, 100, ["p0", "p1", "p2"], { reverse: true });
  assert.strictEqual(r.ranks.p1, 1);
  assert.strictEqual(r.payouts.p1, 210);
  var bo = Core.settleTarget(b, 100, ["p0", "p1", "p2"], { bonus: 150 });
  assert.strictEqual(bo.pot, 450);
  assert.strictEqual(bo.payouts.p0 + bo.payouts.p1 + bo.payouts.p2, 450);
  var s = hostPlay(betAll(swanStarted(3, "bailout"), [100, 100, 101]), [0, 0, 0]);
  assert.strictEqual(s.history[0].bonus, 150);
  assert.strictEqual(s.history[0].pot, 451);
  var u = hostPlay(betAll(swanStarted(3, "upset")), [0, 0, 0]);
  assert.strictEqual(u.history[0].event, "upset");
});
check("old state without new fields still plays", function () {
  var s = started(2);
  delete s.config.blackSwanEnabled;
  delete s.config.sectorLinkEnabled;
  delete s.swanDeck;
  delete s.current.startPrice;
  s = hostPlay(betAll(s), [10, 10]);
  assert.strictEqual(s.history[0].finalPrice, 120);
  assert.strictEqual(s.history[0].startPrice, 100);
});
```

驗算：hype [20,5,5]：40→140、145、150 ✓。exright n=3：⌈3/2⌉=2，第 2 則後 160→100，再 +5＝105 ✓。shortcover：100−50＝50 <60 → 70，−30 → 40（已用過）→ 40 ✓。limit：+80 → 180 夾 150；−200 → 0 夾 50 ✓。extra：4 則 +1 → 104 ✓。reverse 下注 100/300/200/100 → 剩 900/700/800/900 → p1(700)、p2(800)、p0(900)、p3(900) ✓。cancel [5,0,0] → 105，差 5 → 退回 ✓。upset：誤差 p0 0、p2 20、p1 50 → 反排 p1、p2、p0；3 人 70/30 → p1 210 ✓。bailout pot 301 → bonus 150、總 451 ✓。

- [ ] **Step 3: 執行確認失敗** — `node tools/toushou_check/core_check.js`，新區段 FAIL。

- [ ] **Step 4: 實作 core**

```js
  function roundHalf(x) { var r = x < 0 ? -Math.round(-x) : Math.round(x); return r === 0 ? 0 : r; }

  function buildSwanDeck(holder) {
    var arr = [];
    D.SWAN_CARDS.forEach(function (c) {
      var k = D.SWAN_COMPOSITION[c.id] || 1;
      for (var i = 0; i < k; i++) arr.push(c.id);
    });
    return shuffle(holder, arr);
  }

  function swanById(id) {
    for (var i = 0; i < D.SWAN_CARDS.length; i++) if (D.SWAN_CARDS[i].id === id) return D.SWAN_CARDS[i];
    return null;
  }

  function sectorStartPrice(s, category) {
    for (var i = s.history.length - 1; i >= 0; i--) {
      if (s.history[i].category === category) {
        var f = s.history[i].finalPrice;
        return { price: Math.max(0, D.START_PRICE + roundHalf((f - D.START_PRICE) * 0.5)), from: f };
      }
    }
    return { price: D.START_PRICE, from: null };
  }

  // 事件對單則加減分的修正（spec 2.5 步驟 2～3）
  function modifyDelta(event, idx, n, delta, prevDelta) {
    var d = delta;
    if (event === "hype" && idx === 0) d = d * 2;
    else if (event === "whale" && idx === n - 1) d = d * 2;
    else if (event === "exhausted" && idx === n - 1) d = -d;
    else if (event === "fomo" && d > 0) d = roundHalf(d * 1.5);
    else if (event === "panic" && d < 0) d = roundHalf(d * 1.5);
    else if (event === "lull") d = roundHalf(d / 2);
    else if (event === "momentum" && idx > 0) d = d + roundHalf(prevDelta / 2);
    if (event === "circuit") d = Math.max(-10, Math.min(10, d));
    return d === 0 ? 0 : d;
  }
```

`newGame`：config 加 `blackSwanEnabled: !!config.blackSwanEnabled, sectorLinkEnabled: !!config.sectorLinkEnabled`；`s.swanDeck = s.config.blackSwanEnabled ? buildSwanDeck(s) : [];`（放在 `s.windDeck = buildWindDeck(s);` 之後，未啟用時不消耗 PRNG）。

`startBetting`：

```js
    var target = s.targets[s.targetIndex];
    var sp = s.config.sectorLinkEnabled ? sectorStartPrice(s, target.category) : { price: D.START_PRICE, from: null };
    s.current = {
      price: sp.price, startPrice: sp.price, sectorFrom: sp.from,
      event: null, gap: null, shortcoverUsed: false,
      bettors: ..., (其餘不變)
    };
```

`placeBet` 完成時：

```js
    if (nextBettor(s) === null) {
      var c = s.current;
      if (s.config.blackSwanEnabled) {
        if (!s.swanDeck || !s.swanDeck.length) s.swanDeck = buildSwanDeck(s);
        c.event = s.swanDeck.pop();
        if (c.event === "gap") {
          c.gap = Math.floor(rand(s) * 41) - 20;
          c.price = Math.max(0, startPriceOf(c) + c.gap);
        }
      }
      if (c.event === "reverse") {
        c.order = s.players.map(function (x, i) { return { id: x.id, chips: x.chips, seat: i }; })
          .sort(function (a, b) { return a.chips - b.chips || a.seat - b.seat; })
          .map(function (x) { return x.id; });
      } else {
        c.order = shuffle(s, s.players.map(function (x) { return x.id; }));
      }
      if (c.event === "extra") c.order.push(c.order[0]);
      c.turnIndex = 0;
      s.phase = "news";
      enterNewsTurn(s);
    }
```

`function startPriceOf(c) { return isInt(c.startPrice) ? c.startPrice : D.START_PRICE; }`

封口令：

```js
  function gagActive(s) {
    if (s.phase !== "news" || !s.current || s.current.event !== "gag" || s.current.turnIndex !== 0) return false;
    var p = playerById(s, currentShareholder(s));
    return !!p && p.hand.some(function (id) { return cardPlayable(s, id); });
  }
```

`newsError` 在 `ts_err_not_your_turn` 檢查之後加：`if (gagActive(s) && (cardId === null || cardId === undefined || edited)) return "ts_err_gag";`

`commitDelta`：

```js
  function commitDelta(s, delta, extra) {
    var c = s.current;
    var n = c.order.length;
    var idx = c.turnIndex;
    var prev = c.news.length ? c.news[c.news.length - 1].delta : 0;
    var finalDelta = modifyDelta(c.event, idx, n, delta, prev);
    c.price = Math.max(0, c.price + finalDelta);
    var entry = { playerId: c.pending.playerId, cardId: c.pending.cardId, edited: c.pending.edited,
      text: c.pending.text, wind: c.wind, delta: finalDelta, priceAfter: c.price };
    if (finalDelta !== delta) entry.rawDelta = delta;
    Object.keys(extra || {}).forEach(function (k) { entry[k] = extra[k]; });
    // 價格事件（spec 2.5 步驟 5）
    var before = c.price;
    var pe = null;
    if (c.event === "exright" && idx === Math.ceil(n / 2) - 1) {
      c.price = D.START_PRICE; pe = "exright";
    } else if (c.event === "shortcover" && !c.shortcoverUsed && c.price < 60) {
      c.shortcoverUsed = true; c.price += 20; pe = "shortcover";
    } else if (c.event === "limit") {
      var sp = startPriceOf(c);
      var clamped = Math.min(sp + 50, Math.max(Math.max(0, sp - 50), c.price));
      if (clamped !== c.price) { c.price = clamped; pe = "limit"; }
    }
    if (pe) { entry.priceEvent = pe; entry.priceBeforeEvent = before; entry.priceAfter = c.price; }
    c.news.push(entry);
    c.votes = {};
    c.turnIndex += 1;
    if (c.turnIndex >= c.order.length) {
      c.pending = null;
      if (c.event === "rumor" && c.news.length) {
        c.rumorIndex = Math.floor(rand(s) * c.news.length);
        c.rumorDelta = c.news[c.rumorIndex].delta;
        c.price = Math.max(0, c.price - c.rumorDelta);
      }
      settleCurrent(s);
    } else {
      s.phase = "news";
      enterNewsTurn(s);
    }
  }
```

`settleTarget(bets, finalPrice, seatOrder, opts)`：`opts = opts || {}`；`pot += opts.bonus || 0`（在 parts 加總後）；排序改為
`var cmp = opts.reverse ? err(b) - err(a) : err(a) - err(b); return cmp || seatOrder.indexOf(a) - seatOrder.indexOf(b);`。

`settleCurrent`：

```js
    var c = s.current;
    var target = s.targets[s.targetIndex];
    var seat = s.players.map(function (p) { return p.id; });
    var sp = startPriceOf(c);
    var cancelled = c.event === "cancel" && Math.abs(c.price - sp) <= 5;
    var bonus = 0;
    var r;
    if (cancelled) {
      r = { pot: 0, ranks: {}, payouts: {} };
      seat.forEach(function (id) {
        if (c.bets[id] && c.bets[id].amount > 0) { r.payouts[id] = c.bets[id].amount; r.pot += c.bets[id].amount; }
      });
    } else {
      if (c.event === "bailout") {
        var base = 0;
        seat.forEach(function (id) { if (c.bets[id]) base += c.bets[id].amount; });
        bonus = Math.floor(base * 0.5);
      }
      r = settleTarget(c.bets, c.price, seat, { reverse: c.event === "upset", bonus: bonus });
    }
```

`entry` 加：`startPrice: sp, sectorFrom: c.sectorFrom === undefined ? null : c.sectorFrom, event: c.event || null, gap: c.gap === undefined ? null : c.gap, rumorIndex: c.rumorIndex === undefined ? null : c.rumorIndex, rumorDelta: c.rumorDelta === undefined ? null : c.rumorDelta, cancelled: cancelled, bonus: bonus`。

export：`swanById`、`sectorStartPrice`、`modifyDelta`、`gagActive`。

- [ ] **Step 5: 執行通過** — `node --check static_src/toushou_core.js static_src/toushou_data.js; node tools/toushou_check/core_check.js` → `66 passed, 0 failed`。

- [ ] **Step 6: Commit** — `feat(toushou): 規則引擎新增黑天鵝事件卡（19 種＋平靜）與板塊連動`

---

### Task 2: i18n＋UI＋ui_check

**Files:** `site_src/i18n_data_zh.py`、`site_src/i18n_data_ja.py`、`static_src/toushou.js`、`static_src/style.css`、`tools/toushou_check/ui_check.js`

- [ ] **Step 1: i18n**

zh：

```python
    "ts_swan_enabled": "啟用黑天鵝事件卡",
    "ts_sector_enabled": "啟用板塊連動（同類別標的的起始價受上一個影響）",
    "ts_swan_heading": "黑天鵝事件",
    "ts_start_price": "起始價：{n}",
    "ts_sector_note": "板塊連動：上一個同類別標的最終 {prev}",
    "ts_gap_note": "跳空 {gap}",
    "ts_news_modified": "原始 {raw} → {final}（{event}）",
    "ts_news_price_event": "{event} → {price}",
    "ts_rumor_note": "謠言破滅：{name} 的消息「{text}」被揭穿，扣回 {delta}",
    "ts_cancel_note": "交易取消：全員退回押注",
    "ts_bailout_note": "紓困加碼：銀行加碼 {n}",
    "ts_upset_note": "爆冷門：依誤差由大到小排名",
    "ts_gag_hint": "封口令：這一則只能直接打出手牌",
    "ts_err_gag": "封口令：這一則只能直接打出手牌",
```

ja：

```python
    "ts_swan_enabled": "ブラックスワンカードを使う",
    "ts_sector_enabled": "セクター連動（同カテゴリ銘柄の開始価格が前の銘柄の影響を受ける）",
    "ts_swan_heading": "ブラックスワン",
    "ts_start_price": "開始価格：{n}",
    "ts_sector_note": "セクター連動：前の同カテゴリ銘柄の最終 {prev}",
    "ts_gap_note": "窓開け {gap}",
    "ts_news_modified": "元 {raw} → {final}（{event}）",
    "ts_news_price_event": "{event} → {price}",
    "ts_rumor_note": "デマ発覚：{name} の発表「{text}」が取り消され {delta} を戻す",
    "ts_cancel_note": "取引取消：全員の賭け金を返却",
    "ts_bailout_note": "救済資金：銀行が {n} 上乗せ",
    "ts_upset_note": "大番狂わせ：誤差が大きい順に順位付け",
    "ts_gag_hint": "箝口令：この発表は手札をそのまま出すことしかできません",
    "ts_err_gag": "箝口令：手札をそのまま出してください",
```

- [ ] **Step 2: 設定**：`newDraft` 加 `blackSwanEnabled: false, sectorLinkEnabled: false`；在風向卡勾選框後加 `#ts-swan`、`#ts-sector` 兩個勾選框；`buildConfig` 回傳兩個欄位。

- [ ] **Step 3: 標的卡**：`targetCard(target, price, news)` 增加參數 `info`（`state.current` 或 `state.lastSettlement`）：
  - `info.startPrice` 不是 100 或 `info.sectorFrom !== null` 時顯示 `ts_start_price`＋`ts_sector_note`。
  - `info.event` 有值時顯示 `#ts-swan-badge`：`ts_swan_heading`：名稱＋說明（`{k}` 代入 ⌈n/2⌉，n＝`info.order` 長度或 `info.news` 長度）；`gap` 時附 `ts_gap_note`。
- [ ] **Step 4: 消息面**：`rawDelta` 存在時加 `.ts-news-mod`（`ts_news_modified`，event 名稱取 `Core.swanById(event).name`）；`priceEvent` 時加 `ts_news_price_event`。`newsBoard(news, event)` 多一個參數。
- [ ] **Step 5: 結算**：`renderSettle` 與整局回顧顯示 rumor／cancel／bailout／upset 註記；`settleTable` 名次為 undefined 時顯示「—」。
- [ ] **Step 6: 下注**：預測價預設值＝`state.current.startPrice || D.START_PRICE`。
- [ ] **Step 7: 出牌**：`Core.gagActive(state)` 為真時不顯示改寫按鈕、自訂輸入與釋放按鈕，改顯示 `ts_gag_hint`。
- [ ] **Step 8: ui_check 第三局**：回到設定 → 加減分方式選 host → 勾選 `#ts-swan`、`#ts-sector` → 只留第一個類別 → 重抽標的 → 開始；跑 2 個標的（每則：有 `.ts-btn-play` 就直接出牌，否則自訂），每則加減分 +20；檢查 `#ts-swan-badge` 存在、第 2 個標的 `current.startPrice` 等於 `Core.sectorStartPrice` 的結果、預測價輸入框預設值＝起始價。
- [ ] **Step 9: 建置與執行**：`py -3 generate.py`、`node tools/toushou_check/ui_check.js` → OK；`multi_device_check` 維持 OK。
- [ ] **Step 10: Commit** — `feat(toushou): 黑天鵝事件卡與板塊連動的介面（開局勾選、事件顯示、消息與結算註記）`
