// ============================================================================
// 煉金術士（atelier）第 5 階段規則檢查（不需要瀏覽器）。規則依據 docs/atelier_design.md §11。
//   工房主人的解鎖與切換、循環／熬煮／調色／結晶四種調和方式、共通介面（options、preview、回放、出手）、能力。
// 執行：node tools/atelier_check/phase5_check.js
// ============================================================================
"use strict";
var path = require("path");
var assert = require("assert");
var SRC = path.join(__dirname, "..", "..", "static_src");
global.PriTestAtelierData = require(path.join(SRC, "atelier_data.js"));
global.PriTestAtelierColors = require(path.join(SRC, "atelier_colors.js"));
global.PriTestAtelierHosts = require(path.join(SRC, "atelier_hosts.js"));
var C = require(path.join(SRC, "atelier_core.js"));
global.PriTestAtelierCore = C;
var M = {};
["board", "ring", "brew", "palette", "gravity"].forEach(function (id) {
  M[id] = require(path.join(SRC, "atelier_method_" + id + ".js"));
  C.registerMethod(id, M[id]);
});
var D = global.PriTestAtelierData, H = global.PriTestAtelierHosts;

var passed = 0;
function test(name, fn) { fn(); passed++; console.log("ok - " + name); }
var T0 = Date.UTC(2026, 10, 19, 3, 0, 0);
function mat(uid, el, cat, shape, q, power, hex) {
  return { uid: uid, hex: hex || "#808080", rgb: hex ? C.hexToRgb(hex) : [128, 128, 128], colorId: "sumi", element: el, category: cat,
    power: power || 2, quality: q || 50, traits: [], shape: shape, at: T0 };
}
// 沒有擅長倍率的銅之大釜（只驗證各方式的基本規則；擅長 ×1.2 由 phase2_check 驗證）
function cauldron() { var c = D.CAULDRONS.copper; return { id: "copper", pattern: c.pattern, qualityPerCell: c.qualityPerCell }; }
function lvSave(lv) { var s = C.newSave(T0); s.exp = (lv - 1) * D.EXP_PER_LV; return s; }

// ---------- 工房主人 ----------
test("工房主人：依等級解鎖；未解鎖不能切換；切換後 startSynthesis 用她的調和方式", function () {
  var s = lvSave(1);
  assert.strictEqual(C.hostUnlocked(s, "ruri"), true);
  assert.strictEqual(C.hostUnlocked(s, "akane"), false);
  assert.strictEqual(C.setHost(s, "akane"), false);
  s = lvSave(5);
  D.HOST_ORDER.forEach(function (id) { assert.strictEqual(C.hostUnlocked(s, id), true, id); });
  assert.strictEqual(C.setHost(s, "sui"), true);
  s.mats = [mat(1, "ice", "liquid", [[0, 0]]), mat(2, "wind", "plant", [[0, 0]]), mat(3, "wind", "plant", [[0, 0]])];
  var ss = C.startSynthesis(s, "heal", [1, 2, 3], "copper", T0);
  assert.strictEqual(ss.method, "brew");
  assert.deepStrictEqual(ss.ability, H.sui.ability);
  var old = C.newSave(T0); delete old.hosts.akane; old.hosts.ruri = { aff: 3, task: 1 };
  C.migrate(old);
  assert.deepStrictEqual(old.hosts.akane, { aff: 0, task: 0, tut: 0 });
  assert.deepStrictEqual(old.hosts.ruri, { aff: 3, task: 1, tut: 0 });
});

// ---------- 循環 ----------
test("循環：順時針倒入與溢流、同屬性 ×2、關閉節點 +2、環滿後損失、Undo", function () {
  var r = C.recipe("heal");                         // 節點：風 冰 火 風 冰 雷 風 靈
  assert.deepStrictEqual(M.ring.nodeElements(r), ["wind", "ice", "fire", "wind", "ice", "bolt", "wind", "spirit"]);
  var s = M.ring.create(r, [mat(1, "wind", "plant", [[0, 0], [1, 0], [2, 0]], 50, 2), mat(2, "fire", "mineral", [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0], [6, 0]], 50, 4)], cauldron(), {});
  var info = M.ring.place(s, 0, 0, 0, 0);          // 量 6：風節點 4（×2）＋冰節點 2
  assert.strictEqual(info.cells, 6);
  assert.strictEqual(info.matchCells, 4);
  assert.strictEqual(info.bonusCells, 1);
  var ev = M.ring.evaluate(s, false);
  assert.strictEqual(ev.gauges.wind, 4 * 2 + 2 + D.RING_CLOSE_BONUS);
  info = M.ring.place(s, 1, 7, 0, 0);              // 量 28（7 格×4）：剩下的容量 26 全部填滿，多的 2 損失
  var free = 8 * D.RING_CAP - 6;
  assert.strictEqual(info.cells, free);
  assert.strictEqual(M.ring.evaluate(s, true).lost, 28 - free);
  assert(M.ring.undo(s));
  assert.strictEqual(M.ring.evaluate(s, false).lost, 0);
  assert.deepStrictEqual(s.moves, [[0, 0, 0, 0]]);
  assert.strictEqual(M.ring.canPlace(s, 1, 8, 0), false);
  assert.strictEqual(M.ring.canPlace(s, 1, 3, 1), false);
});

test("循環：茜的能力讓火屬性素材品質 +10；損失的量變成灰燼", function () {
  var s = lvSave(2);
  C.setHost(s, "akane");
  s.mats = [mat(1, "fire", "liquid", [[0, 0]], 50, 1), mat(2, "fire", "plant", [[0, 0]], 50, 1), mat(3, "wind", "plant", [[0, 0]], 50, 1)];
  var ss = C.startSynthesis(s, "heal", [1, 2, 3], "copper", T0);
  M.ring.place(ss, 0, 0, 0, 0); M.ring.place(ss, 1, 1, 0, 0); M.ring.place(ss, 2, 2, 0, 0);
  var ev = M.ring.evaluate(ss, true);
  assert.strictEqual(ev.quality, Math.round((60 + 60 + 50) / 3));
  var item = C.finishSynthesis(s, ss, [], T0);
  assert.strictEqual(item.ash, ev.lost + (item.quality < D.ASH_LOW_QUALITY ? D.ASH_FAIL_BONUS : 0));
  assert.strictEqual(s.hosts.akane.tut, 1, "茜的教學計數");
  assert.strictEqual(s.tutorial, 0, "瑠璃的教學計數不動");
});

// ---------- 熬煮 ----------
test("熬煮：溫度＝火候＋素材熱（0～120）；理想區間 ×2、差 10 以內 ×1、更遠 ×0.5；沸騰", function () {
  var r = C.recipe("heal");
  var s = M.brew.create(r, [mat(1, "fire", "mineral", [[0, 0], [1, 0]], 50, 2), mat(2, "ice", "liquid", [[0, 0]], 50, 2),
    mat(3, "wind", "plant", [[0, 0]], 50, 3)], cauldron(), {});
  assert.strictEqual(s.temp, 20);
  var i1 = M.brew.place(s, 0, 2, 0);                 // 20+25+10 = 55：火的理想 70～100，差 15 → ×0.5
  assert.strictEqual(i1.temp, 55); assert.strictEqual(i1.mult, 0.5);
  var i2 = M.brew.place(s, 1, 0, 0);                 // 55−15−10 = 30：冰 10～40 → ×2
  assert.strictEqual(i2.temp, 30); assert.strictEqual(i2.mult, 2);
  var i3 = M.brew.place(s, 2, 1, 0);                 // 30+10 = 40：風 40～70 → ×2
  assert.strictEqual(i3.mult, 2);
  var ev = M.brew.evaluate(s, false);
  assert.strictEqual(ev.gauges.fire, Math.round(2 * 2 * 0.5));
  assert.strictEqual(ev.gauges.ice, 4);
  assert.strictEqual(ev.gauges.wind, 6);
  assert.strictEqual(ev.inZone, 2);
  assert.strictEqual(ev.quality, Math.round(50 + cauldron().qualityPerCell * 2 * 3));
  assert.strictEqual(ev.boil, false);
  var hot = M.brew.create(r, [mat(1, "fire", "mineral", [[0, 0]]), mat(2, "fire", "mineral", [[0, 0]]), mat(3, "fire", "mineral", [[0, 0]])], cauldron(), {});
  M.brew.place(hot, 0, 2, 0); M.brew.place(hot, 1, 2, 0); M.brew.place(hot, 2, 2, 0);
  assert.strictEqual(hot.temp, D.BREW_MAX);
  assert.strictEqual(M.brew.evaluate(hot, true).boil, true);
  assert(M.brew.undo(hot));
  assert.strictEqual(hot.temp, 90);
});

// ---------- 調色 ----------
test("調色：依份數加權平均、越接近目標色加成越多、份數 1～3", function () {
  var r = C.recipe("heal");
  var target = M.palette.target(r);
  var exact = C.rgbToHex(target);
  var s = M.palette.create(r, [mat(1, "wind", "plant", [[0, 0]], 50, 2, exact), mat(2, "ice", "liquid", [[0, 0]], 50, 2, exact)], cauldron(), {});
  assert.strictEqual(M.palette.canPlace(s, 0, 0, 0), false);
  assert.strictEqual(M.palette.canPlace(s, 0, 4, 0), false);
  M.palette.place(s, 0, 3, 0); M.palette.place(s, 1, 1, 0);
  var ev = M.palette.evaluate(s, true);
  assert(ev.dE < 1);
  assert.strictEqual(ev.gaugeBonus, 5);
  assert.strictEqual(ev.gauges.wind, 2 * 3 + 5);
  assert.strictEqual(ev.gauges.ice, 2 * 1 + 5);
  assert.strictEqual(ev.quality, 50 + 15);
  var far = M.palette.create(r, [mat(1, "fire", "mineral", [[0, 0]], 50, 2, "#FF0000"), mat(2, "fire", "mineral", [[0, 0]], 50, 2, "#FF0000")], cauldron(), {});
  M.palette.place(far, 0, 1, 0); M.palette.place(far, 1, 2, 0);
  var ev2 = M.palette.evaluate(far, true);
  assert(ev2.dE > 30);
  assert.strictEqual(ev2.gaugeBonus, 0); assert.strictEqual(ev2.qualityBonus, 0);
  var mixS = M.palette.create(r, [mat(1, "fire", "mineral", [[0, 0]], 50, 2, "#000000"), mat(2, "fire", "mineral", [[0, 0]], 50, 2, "#FFFFFF")], cauldron(), {});
  M.palette.place(mixS, 0, 1, 0); M.palette.place(mixS, 1, 3, 0);
  assert.deepStrictEqual(M.palette.mixOf(mixS), [191, 191, 191]);
});

// ---------- 結晶 ----------
test("結晶：落到不重疊的最低位置、放不下時不能放、填滿一排 +3（黒曜 +1）", function () {
  var r = C.recipe("heal"), row = [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]];
  var s = M.gravity.create(r, [mat(1, "wind", "plant", row), mat(2, "ice", "liquid", [[0, 0], [0, 1]]), mat(3, "wind", "plant", row)], cauldron(), { lineBonus: 1 });
  assert.strictEqual(M.gravity.dropY(s, 0, 0, 0), 4);
  var before = M.gravity.evaluate(s, false).gauges.wind;
  var info = M.gravity.place(s, 0, 0, 0, 0);
  assert.strictEqual(info.dropY, 4);
  assert.strictEqual(info.lines, 1, "第 5 排填滿");
  var ev = M.gravity.evaluate(s, false);
  assert.strictEqual(ev.lines, 1);
  var plain = M.board.create(r, [mat(1, "wind", "plant", row)], cauldron(), {});
  M.board.place(plain, 0, 0, 4, 0);
  assert.strictEqual(ev.gauges.wind, M.board.evaluate(plain, false).gauges.wind + D.GRAVITY_LINE_BONUS + 1);
  assert(before === 0);
  assert.strictEqual(M.gravity.dropY(s, 1, 2, 0), 2, "直的 2 格落在第 3、4 排");
  assert.strictEqual(M.gravity.canPlace(s, 1, 5, 0, 0), false, "超出棋盤");
  M.gravity.place(s, 1, 2, 0, 0);
  assert(M.gravity.undo(s));
  assert.strictEqual(s.placed[1], false);
  assert.strictEqual(s.owner[2 * 5 + 2], -1);
});

// ---------- 共通介面 ----------
test("所有方式：options 都 canPlace、preview 不改動、replaySession 重建相同量表、bestPlacement 不低於任何選項", function () {
  ["board", "ring", "brew", "palette", "gravity"].forEach(function (id) {
    var r = C.recipe("heal");
    var mats = [mat(1, "ice", "liquid", [[0, 0], [1, 0]], 60, 3, "#3A7BE0"), mat(2, "wind", "plant", [[0, 0], [0, 1]], 60, 2, "#3AB36A"),
      mat(3, "fire", "plant", [[0, 0]], 60, 2, "#E0523A")];
    var s = M[id].create(r, mats, cauldron(), {});
    var opts = M[id].options ? M[id].options(s, 0) : null;
    if (opts) {
      assert(opts.length > 0, id);
      opts.forEach(function (o) { assert(M[id].canPlace(s, 0, o[0], o[1], o[2]), id + " " + o); });
    }
    var snapshot = JSON.stringify(s);
    var bp = C.bestPlacement(s, 0);
    assert.strictEqual(JSON.stringify(s), snapshot, id + " preview 改動了 session");
    (opts || []).forEach(function (o) {
      var pv = M[id].preview(s, 0, o[0], o[1], o[2]);
      assert(C.placementScore(s, pv.after) <= bp.score + 1e-9, id);
    });
    [0, 1, 2].forEach(function (mi) {
      var b = C.bestPlacement(s, mi);
      assert(M[id].place(s, mi, b.x, b.y, b.rot).ok, id + " place " + mi);
    });
    var gauges = M[id].evaluate(s, true).gauges;
    var item = { recipe: "heal", replay: { method: id, cauldron: cauldron(), ability: {}, rules: {}, cat: null,
      mats: mats.map(function (m) { return { hex: m.hex, element: m.element, shape: m.shape, power: m.power, quality: m.quality }; }), moves: s.moves.slice() } };
    assert.deepStrictEqual(M[id].evaluate(C.replaySession(JSON.parse(JSON.stringify(item))), true).gauges, gauges, id + " 回放");
  });
});

test("出手：其他工房主人也能請她幫忙（用 options 計分）", function () {
  var s = lvSave(3);
  C.setHost(s, "sui");
  s.hosts.sui.aff = D.HELP_AFF;
  s.mats = [mat(1, "ice", "liquid", [[0, 0]]), mat(2, "wind", "plant", [[0, 0]]), mat(3, "wind", "plant", [[0, 0]])];
  var ss = C.startSynthesis(s, "heal", [1, 2, 3], "copper", T0);
  assert.strictEqual(C.helpAvailable(s, ss), true);
  assert(C.useHelp(s, ss, 0).ok);
  assert.strictEqual(ss.placed[0], true);
});

// ---------- 能力 ----------
test("能力：翠的大成功 +5%、雫的採色品質 +5", function () {
  var s = lvSave(3);
  s.mats = [mat(1, "ice", "liquid", [[0, 0]]), mat(2, "wind", "plant", [[0, 0]]), mat(3, "wind", "plant", [[0, 0]])];
  var base = C.startSynthesis(s, "heal", [1, 2, 3], "copper", T0);
  C.setHost(s, "sui");
  var sui = C.startSynthesis(s, "heal", [1, 2, 3], "copper", T0);
  assert.strictEqual(Math.round((C.greatChance(s, sui) - C.greatChance(s, base)) * 1000) / 1000, 0.05);
  var s2 = lvSave(4), sw = { rgb: C.hexToRgb("#7B8D42"), hex: "#7B8D42", frac: 0.3, shape: [[0, 0]] };
  var q0 = C.captureEx(s2, [sw], T0).mats[0].quality;
  C.setHost(s2, "shizuku");
  var q1 = C.captureEx(s2, [sw], T0).mats[0].quality;
  assert.strictEqual(q1, Math.min(100, q0 + 5));
});

// ---------- 資料 ----------
test("資料：每位工房主人的 method 已登記、任務配方存在、台詞與教學有 zh／ja、HOST_ORDER 完整", function () {
  assert.deepStrictEqual(Object.keys(H).sort(), D.HOST_ORDER.slice().sort());
  D.HOST_ORDER.forEach(function (id) {
    var h = H[id];
    assert(C.method(h.method), id);
    assert(h.lines.ok && h.lines.greet, id);
    Object.keys(h.lines).forEach(function (k) { h.lines[k].forEach(function (l) { assert(l.zh && l.ja, id + " " + k); }); });
    h.tasks.forEach(function (t) { assert(C.recipe(t.recipe) && !C.recipe(t.recipe).season, id + " " + t.id); });
    h.tutorial.forEach(function (l) { assert(l.zh && l.ja, id); });
    assert(h.likes && h.dislikes, id);
  });
});

console.log("\n" + passed + " passed");
