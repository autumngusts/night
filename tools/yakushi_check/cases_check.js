// 少女藥師的獨語（yakushi）案件資料完整性與可破關檢查。規則依據 docs/yakushi_game_design.md §11。
// 執行：node tools/yakushi_check/cases_check.js
"use strict";
var path = require("path"), assert = require("assert");
var SRC = path.join(__dirname, "..", "..", "static_src");
var Herbs = require(path.join(SRC, "yakushi_herbs.js"));
global.PriTestYakushiHerbs = Herbs;
["poison", "mineral", "animal", "tonic", "clear", "boudoir"].forEach(function (c) { require(path.join(SRC, "yakushi_herbs_" + c + ".js")); });
var Cast = require(path.join(SRC, "yakushi_cast.js"));
var Core = require(path.join(SRC, "yakushi_core.js"));
global.PriTestYakushiCore = Core;
var passed = 0;
function test(name, fn) { fn(); passed++; console.log("ok - " + name); }

var defs = [];
[0, 1, 2, 3].forEach(function (n) {
  var d = require(path.join(SRC, "yakushi_case_" + n + ".js"));
  if (d && d.id) defs.push(d);
});
var REQUIRED = Number(process.env.YS_CASES || 1);   // Task 8：1；Task 9：4

test("已登記案件數 ≥ " + REQUIRED, function () { assert.ok(defs.length >= REQUIRED, "只有 " + defs.length + " 案"); });

test("人物：12 人，案件 cast 都存在", function () {
  assert.strictEqual(Cast.list().length, 12);
  defs.forEach(function (d) { d.cast.forEach(function (c) { assert.ok(Cast.get(c), d.id + " cast " + c); }); });
});

defs.forEach(function (d) {
  // 可取得的卡：查看點（依 requires 迭代）、正確鑑定、試藥、調藥
  function obtainable(noPatients) {   // noPatients：不算任何病人的 gives（病人被太醫接手、失去證言時）
    var got = {}; (d.startCards || []).forEach(function (c) { got[c] = true; });
    var changed = true;
    while (changed) {
      changed = false;
      d.places.forEach(function (p) { p.spots.forEach(function (s) {
        if ((s.requires || []).every(function (c) { return got[c]; })) s.gives.forEach(function (c) { if (!got[c]) { got[c] = true; changed = true; } });
      }); });
      Object.keys(d.cards).forEach(function (id) {
        var c = d.cards[id];
        if (c.herb && got[id] && !got["herb:" + c.herb]) { got["herb:" + c.herb] = true; changed = true; }
      });
      (d.tests || []).forEach(function (t) { if (t.gives && got[t.evidence] && !got[t.gives]) { got[t.gives] = true; changed = true; } });
      if (!noPatients) (d.patients || []).forEach(function (p) { if (!got[p.gives]) { got[p.gives] = true; changed = true; } });
    }
    return got;
  }
  var got = obtainable();
  var gotNoPatient = obtainable(true);

  test(d.id + "：所有引用的卡、藥材、場所都存在", function () {
    function card(id) { assert.ok(Core.cardInfo(d, id), d.id + " 卡不存在 " + id); }
    d.places.forEach(function (p) { p.spots.forEach(function (s) { s.gives.forEach(card); (s.requires || []).forEach(card); }); });
    assert.ok(d.places.some(function (p) { return p.id === d.startPlace; }), "startPlace");
    Object.keys(d.cards).forEach(function (id) {
      var c = d.cards[id];
      if (c.herb) assert.ok(Herbs.get(c.herb), id + " herb " + c.herb);
      if (c.of) assert.ok(d.cards[c.of], id + " of " + c.of);
    });
    (d.tests || []).forEach(function (t) { card(t.evidence); if (t.gives) card(t.gives); assert.ok(Herbs.METHODS.indexOf(t.method) >= 0); });
    d.medicineBox.forEach(function (h) { assert.ok(Herbs.get(h), "藥箱 " + h); });
    (d.patients || []).forEach(function (p) {
      card(p.gives);
      p.remedy.forEach(function (h) { assert.ok(d.medicineBox.indexOf(h) >= 0, p.id + " 解方不在藥箱 " + h); });
      assert.ok(p.remedy.length >= 1 && p.remedy.length <= 3);
    });
    Core.SLOTS.forEach(function (s) { card(d.solution[s]); });
    d.rebuttals.forEach(function (r) { r.accepts.forEach(card); });
    if (d.deep) d.deep.options.forEach(function (o) { card(o.card); assert.ok(o.key && o.key !== "main" && o.key !== "none"); });
  });

  test(d.id + "：正解、每輪辯解、深層選項都拿得到（可破關）", function () {
    Core.SLOTS.forEach(function (s) { assert.ok(got[d.solution[s]], d.id + " 正解 " + s + " 拿不到 " + d.solution[s]); });
    d.rebuttals.forEach(function (r, i) {
      assert.ok(r.accepts.some(function (c) { return got[c]; }), d.id + " 第 " + (i + 1) + " 輪辯解沒有可出示的卡");
    });
    if (d.deep) d.deep.options.forEach(function (o) { assert.ok(got[o.card], d.id + " 深層 " + o.key + " 拿不到"); });
  });

  test(d.id + "：病人被太醫接手（失去證言）也不會卡關", function () {
    // §5.3「不會失敗」：正解與每輪辯解至少一張可出示的卡，都要能不靠任何病人的 gives 取得
    Core.SLOTS.forEach(function (s) { assert.ok(gotNoPatient[d.solution[s]], d.id + " 正解 " + s + " 只能靠病人取得：" + d.solution[s]); });
    d.rebuttals.forEach(function (r, i) {
      assert.ok(r.accepts.some(function (c) { return gotNoPatient[c]; }), d.id + " 第 " + (i + 1) + " 輪辯解只能靠病人的證言反駁");
    });
  });

  test(d.id + "：辯解為 2～3 輪", function () {
    assert.ok(d.rebuttals.length >= 2 && d.rebuttals.length <= 3, d.id + "：辯解 2～3 輪，實際 " + d.rebuttals.length);
  });

  test(d.id + "：鑑定用的證物，真藥材可由取得的線索唯一鎖定，且證物本身只能縮到群組", function () {
    Object.keys(d.cards).forEach(function (id) {
      var c = d.cards[id];
      if (!c.herb) return;
      var tags = (c.tags || []).slice();
      Object.keys(d.cards).forEach(function (k) { if (d.cards[k].of === id && got[k]) tags = tags.concat(d.cards[k].tags || []); });
      var all = Herbs.filter(tags).map(function (h) { return h.id; });
      assert.deepStrictEqual(all, [c.herb], d.id + "：" + id + " 用全部可取得的線索標籤後候選應只剩 " + c.herb + "，實際 [" + all.join(",") + "]");
      var only = Herbs.filter(c.tags || []).map(function (h) { return h.id; });
      assert.ok(only.length >= 2, d.id + "：" + id + "：只靠證物本身就鎖定了，沒有易混的樂趣");
      var herb = Herbs.get(c.herb);
      if (herb.group) Herbs.byGroup(herb.group).forEach(function (h) {
        assert.ok(only.indexOf(h.id) >= 0, d.id + "：" + id + " 證物本身標籤沒有涵蓋同群組的 " + h.id + "（候選未停在群組）");
      });
    });
  });

  test(d.id + "：必要行動不超過時辰", function () {
    // 估計：每張必要的卡取最便宜的來源（查看點含 requires、試藥、調藥免費、起始卡免費）；
    // 辯解每輪取最便宜的可出示卡；herb: 卡另算證物與其可取得的 of 線索卡。
    // 仍忽略：猜錯鑑定、多餘試藥、體力（stamina）消耗等，實際遊玩會比估計多。
    function evOf(herbId) {
      var ev = Object.keys(d.cards).filter(function (k) { return d.cards[k].herb === herbId && got[k]; })[0];
      assert.ok(ev, d.id + "：herb:" + herbId + " 沒有可取得的證物卡");
      return ev;
    }
    function sources(cid) {
      var out = [];
      if ((d.startCards || []).indexOf(cid) >= 0) out.push({ t: "free", needs: [] });
      d.places.forEach(function (p) { p.spots.forEach(function (sp) {
        if (sp.gives.indexOf(cid) >= 0) out.push({ t: "spot", sp: sp, place: p.id, cost: sp.cost == null ? 1 : sp.cost, needs: sp.requires || [] });
      }); });
      (d.tests || []).forEach(function (t) { if (t.gives === cid) out.push({ t: "test", test: t, cost: 1, needs: [t.evidence] }); });
      (d.patients || []).forEach(function (pt) { if (pt.gives === cid) out.push({ t: "free", needs: [] }); });
      return out;
    }
    function deps(cid) {   // herb: 卡 → 證物＋其可取得的 of 線索卡
      var ev = evOf(cid.slice(5)), r = [ev];
      Object.keys(d.cards).forEach(function (k) { if (d.cards[k].of === ev && got[k]) r.push(k); });
      return r;
    }
    function pick(cid, seen) {   // 回傳最便宜來源與其估計成本
      var sn = Object.assign({}, seen); sn[cid] = true;
      var best = null, bc = Infinity;
      sources(cid).forEach(function (src) {
        var c = (src.cost || 0) + src.needs.reduce(function (a, x) { return a + est(x, sn); }, 0);
        if (c < bc) { bc = c; best = src; }
      });
      return { src: best, cost: bc, seen: sn };
    }
    function est(cid, seen) {
      if (seen[cid]) return Infinity;
      if (cid.indexOf("herb:") === 0) return deps(cid).reduce(function (a, x) { return a + est(x, seen); }, 0);
      return pick(cid, seen).cost;
    }
    var spots = {}, places = {}, tests = {};
    function add(cid, seen) {
      if (cid.indexOf("herb:") === 0) return deps(cid).forEach(function (x) { add(x, seen); });
      var pk = pick(cid, seen), best = pk.src;
      assert.ok(best, d.id + "：卡 " + cid + " 沒有任何來源");
      if (best.t === "spot") { spots[best.sp.id] = best.cost; places[best.place] = true; }
      if (best.t === "test") tests[best.test.evidence + "|" + best.test.method] = 1;
      best.needs.forEach(function (x) { add(x, pk.seen); });
    }
    Core.SLOTS.forEach(function (sl) { add(d.solution[sl], {}); });
    d.rebuttals.forEach(function (r) {
      var opts = r.accepts.filter(function (x) { return got[x]; });
      opts.sort(function (a, b) { return est(a, {}) - est(b, {}); });
      add(opts[0], {});
    });
    var sum = function (o) { return Object.keys(o).reduce(function (a, k) { return a + o[k]; }, 0); };
    var cost = sum(spots) + sum(tests) + Object.keys(places).filter(function (p) { return p !== d.startPlace; }).length;
    assert.ok(cost <= d.hours, d.id + "：必要行動 " + cost + " 超過時辰 " + d.hours);
  });
});

console.log("\n" + passed + " passed");
