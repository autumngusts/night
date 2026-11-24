// 少女藥師的獨語（yakushi）案件資料完整性與可破關檢查。規則依據 docs/yakushi_game_design.md §11。
// 執行：node tools/yakushi_check/cases_check.js
"use strict";
var path = require("path"), assert = require("assert"), fs = require("fs");
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
  function obtainable() {
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
      (d.patients || []).forEach(function (p) { if (!got[p.gives]) { got[p.gives] = true; changed = true; } });
    }
    return got;
  }
  var got = obtainable();

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
    assert.ok(d.rebuttals.length >= 2 && d.rebuttals.length <= 3, "辯解 2～3 輪");
  });

  test(d.id + "：鑑定用的證物，真藥材一定在候選裡且候選停在群組", function () {
    Object.keys(d.cards).forEach(function (id) {
      var c = d.cards[id];
      if (!c.herb) return;
      var tags = (c.tags || []).slice();
      Object.keys(d.cards).forEach(function (k) { if (d.cards[k].of === id) tags = tags.concat(d.cards[k].tags || []); });
      var cand = Herbs.filter(tags).map(function (h) { return h.id; });
      assert.ok(cand.indexOf(c.herb) >= 0, id + "：全部線索標籤下真藥材 " + c.herb + " 不在候選（缺標籤）");
      var only = Herbs.filter(c.tags || []).map(function (h) { return h.id; });
      assert.ok(only.length >= 2, id + "：只靠證物本身就鎖定了，沒有易混的樂趣");
    });
  });

  test(d.id + "：必要行動不超過時辰", function () {
    // 必要行動＝提供正解／辯解第一張可用卡的查看點成本 + 起點以外要去的場所數 + 必要的試藥數
    var needCards = {};
    Core.SLOTS.forEach(function (s) { needCards[d.solution[s]] = true; });
    d.rebuttals.forEach(function (r) { var c = r.accepts.filter(function (x) { return got[x]; })[0]; needCards[c] = true; });
    var spots = {}, places = {};
    function need(cid) {
      if (cid.indexOf("herb:") === 0) {
        var ev = Object.keys(d.cards).filter(function (k) { return "herb:" + d.cards[k].herb === cid; })[0];
        return need(ev);
      }
      d.places.forEach(function (p) { p.spots.forEach(function (s) {
        if (s.gives.indexOf(cid) >= 0 && !spots[s.id]) {
          spots[s.id] = s.cost == null ? 1 : s.cost; places[p.id] = true;
          (s.requires || []).forEach(need);
        }
      }); });
    }
    Object.keys(needCards).forEach(need);
    var tests = (d.tests || []).filter(function (t) { return needCards[t.gives]; }).length;
    var cost = Object.keys(spots).reduce(function (a, k) { return a + spots[k]; }, 0) + Object.keys(places).filter(function (p) { return p !== d.startPlace; }).length + tests;
    assert.ok(cost <= d.hours, d.id + "：必要行動 " + cost + " 超過時辰 " + d.hours);
  });
});

console.log("\n" + passed + " passed");
