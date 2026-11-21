// イヌスノー（狗雪）第 5 階段規則檢查：由 core_check.js 在最後呼叫（也可以單獨執行 node tools/inusnow_check/p5_check.js）
// 依據 docs/inusnow_design.md §20；計畫 2026-11-21-inusnow-phase5.md。
"use strict";
var fs = require("fs");
var path = require("path");
var assert = require("assert");

var SRC = path.join(__dirname, "..", "..", "static_src");
var D = require(path.join(SRC, "inusnow_data.js"));
var T = require(path.join(SRC, "inusnow_terrain.js"));
var Phys = require(path.join(SRC, "inusnow_phys.js"));
var Core = require(path.join(SRC, "inusnow_core.js"));
var SLP = require(path.join(SRC, "inusnow_slope.js"));
require(path.join(SRC, "inusnow_env.js"));
var Prog = require(path.join(SRC, "inusnow_prog.js"));

function ok(msg) { console.log("ok - " + msg); }
function loadResort(id) {
  var json = JSON.parse(fs.readFileSync(path.join(SRC, "inusnow", "data", id + ".json"), "utf8"));
  return T.load(json).then(function (t) { return { json: json, t: t }; });
}
function gs(t, pid, seed, dog) {
  var run = Core.newRun(t, { piste: pid, seed: seed, dog: dog, snow: "groomed", runNo: 0 });
  while (run.status === "run") Core.stepRun(run, Core.autopilot(run, 0.5));
  return run;
}

module.exports = function () {
  var src = fs.readFileSync(path.join(SRC, "inusnow_prog.js"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.ok(!src.match(/Math\.(sin|cos|tan|atan|pow|exp|log|random|hypot)\b|localStorage|document\./g), "inusnow_prog.js 只用允許的函式");
  ok("P5 規則檔只用 + − × ÷、floor；不碰 DOM／localStorage");
  // 2026-11-21 QA：同名的 @keyframes 會互相覆蓋（曾經讓倒數、GO 的大字看不見）
  var css = fs.readFileSync(path.join(SRC, "css", "inusnow.css"), "utf8"), seen = {}, dup = [];
  (css.match(/@keyframes\s+([\w-]+)/g) || []).forEach(function (m) { var k = m.split(/\s+/)[1]; if (seen[k]) dup.push(k); seen[k] = 1; });
  assert.deepStrictEqual(dup, [], "inusnow.css 沒有重複的 @keyframes");
  var Env = require(path.join(SRC, "inusnow_env.js"));
  for (var q = 0; q < 200; q++) { var cq = Env.conditions(q, "hirafu", 7, {}); assert.ok(cq.weather === "clear" && !cq.change, "夢之雪只有晴天"); }
  assert.strictEqual(Env.conditions(3, "hirafu", 7, { weather: "fog" }).weather, "fog", "指定的天氣照指定");
  assert.strictEqual(Prog.fromSpec("husky~60,70,80,60,60,95~crouchDrag:abc~").gear, undefined, "壞掉的 spec 退回犬種本身");
  ok("CSS 沒有重複的 keyframes；夢之雪的天氣；壞掉的 spec");

  // 等級與能力點
  var save = Core.newSave();
  assert.strictEqual(Prog.spec(Prog.effDog(save, "border", { resort: "zao", date: "2026-01-10" })), "", "初始的選手（非主場）＝標準選手");
  assert.strictEqual(Prog.addExp(save, "border", 99), 0);
  assert.strictEqual(Prog.addExp(save, "border", 1 + 200), 2, "100 → Lv2、再 200 → Lv3");
  var d = Prog.dogOf(save, "border");
  assert.ok(d.lv === 3 && d.pts === 6, "每級 3 點");
  for (var i = 0; i < 6; i++) Prog.allocate(save, "border", "tec");
  assert.strictEqual(d.add.tec, 6, "分配能力點");
  var d2 = Prog.dogOf(save, "poodle"); d2.pts = 40;
  var n = 0; while (Prog.allocate(save, "poodle", "tec")) n++;
  assert.strictEqual(n, 5, "能力上限 100（玩具貴賓技巧 95＋5）");
  assert.strictEqual(Prog.expFor({ finished: true, place: 1, tricks360: 3 }), 56, "經驗＝完賽 20＋第 1 名 30＋360° 技巧 ×2");
  ok("技術等級：升級、能力點、上限、經驗");

  // 主場、疲勞、美食、雪衣
  var sh = Prog.effDog(save, "shiba", { resort: "happo", date: "2026-01-10" });
  assert.strictEqual(sh.stats.bal, Core.breed("shiba").stats.bal + 2, "柴犬在長野＝主場 +2");
  var dd = Prog.dogOf(save, "shiba");
  for (var r = 0; r < 5; r++) Prog.afterRace(save, "shiba", "2026-01-10", false);
  assert.strictEqual(Prog.effDog(save, "shiba", { resort: "zao", date: "2026-01-10" }).stats.pow, Core.breed("shiba").stats.pow - 3, "連續 5 場＝疲勞 −3");
  assert.strictEqual(Prog.effDog(save, "shiba", { resort: "zao", date: "2026-01-11" }).stats.pow, Core.breed("shiba").stats.pow, "隔天清除");
  save.coins = 100;
  assert.strictEqual(Prog.care(save, "shiba", "onsen", "2026-01-10", "nozawa"), null);
  assert.ok(dd.races === 0 && save.coins === 80, "溫泉清除疲勞（20 狗幣）");
  assert.strictEqual(Prog.care(save, "shiba", "food", "2026-01-10", "teine"), null);
  assert.strictEqual(Prog.effDog(save, "shiba", { resort: "zao" }).stats.pow, Core.breed("shiba").stats.pow + 4, "成吉思汗烤肉：力量 +4");
  Prog.afterRace(save, "shiba", "2026-01-12", false);
  assert.strictEqual(dd.food, null, "美食用掉");
  assert.strictEqual(Prog.care(save, "shiba", "groom", "2026-01-12"), null);
  assert.strictEqual(Prog.care(save, "shiba", "groom", "2026-01-12"), "done", "梳毛一天 1 次");
  save.gear = { jacket: "j2" };
  assert.strictEqual(Prog.effDog(save, "husky", { resort: "zao" }).stats.cld, Core.breed("husky").stats.cld + 20, "雪衣耐寒 +20");
  ok("主場、疲勞與溫泉、美食、梳毛、雪衣（好感 " + dd.aff + "）");

  // 季節、解鎖
  assert.strictEqual(Prog.season("2026-01-15"), "regular");
  assert.strictEqual(Prog.season("2026-03-25"), "spring");
  assert.strictEqual(Prog.season("2026-07-01"), "dream");
  var s2 = Core.newSave();
  assert.deepStrictEqual(Prog.unlockedList(s2, "2026-01-10"), ["happo", "naeba", "teine"], "一開始 3 個雪場");
  assert.strictEqual(Prog.unlockedList(s2, "2026-07-10").length, 8, "夢之雪：全部開放");
  assert.deepStrictEqual(Prog.checkUnlock(s2, true), ["yakebitai"], "前 3 名 → 下一個");
  s2.totalExp = 300;
  assert.deepStrictEqual(Prog.checkUnlock(s2, false), ["hirafu"], "累積經驗 → 下一個");
  ok("真實季節、雪場解鎖");

  return loadResort("happo").then(function (rr) {
    var t = rr.t, pid = rr.json.events.gs.piste, seed = Core.courseSeed("happo", pid), base = Core.breed("husky");
    // 裝備：標準選手不變；短板轉向快；打蠟
    var g0 = gs(t, pid, seed, base);
    var stDog = Prog.effDog(Core.newSave(), "husky", { resort: "zao" });
    assert.strictEqual(gs(t, pid, seed, stDog).time, g0.time, "標準裝備＝第 4 階段");
    var sv = Core.newSave(); sv.gear = { board: "S-soft" };
    var mods = Phys.dogMods(Prog.effDog(sv, "husky", { resort: "zao" }));
    assert.ok(Math.abs(mods.turn / Phys.dogMods(base).turn - 1.06) < 1e-9, "短板：轉向 +6%");
    sv.wax = { sel: "groomed", stock: { groomed: 2 } };
    var wd = Prog.effDog(sv, "husky", { resort: "zao", snow: "groomed" });
    assert.strictEqual(wd.gear.mu, 0.9, "選對的蠟 μ ×0.9");
    assert.strictEqual(Prog.effDog(sv, "husky", { resort: "zao", snow: "ice" }).gear.mu, 1.05, "選錯 ×1.05");
    var gw = gs(t, pid, seed, wd);
    Prog.afterRace(sv, "husky", "2026-01-10", true);
    assert.strictEqual(sv.wax.stock.groomed, 1, "打蠟消耗 1 個");
    // 規格字串：重播一致
    var sp = Prog.spec(wd), back = Prog.fromSpec(sp);
    assert.deepStrictEqual(back.stats, wd.stats, "規格字串還原能力");
    var rp = Core.replay(t, { piste: pid, seed: seed, dog: back, snow: "groomed", runNo: 0 }, Core.encode(gw.inputs), 1);
    // 分享碼＋spec＋精彩片段
    var HLm = require(path.join(SRC, "inusnow_highlight.js"));
    var sc = HLm.withClip(Core.shareCode({ resort: "happo", piste: pid, seed: seed, runNo: 0, breed: "husky", rec: Core.encode(gw.inputs) }) + "|d:" + sp, 10, 200);
    var ps = Core.parseShare(sc);
    assert.ok(ps && ps.spec === sp && HLm.clipOf(sc).b === 200, "分享碼同時帶 spec 與片段");
    assert.strictEqual(Core.replay(t, { piste: pid, seed: seed, dog: Prog.fromSpec(ps.spec, ps.breed), snow: "groomed", runNo: 0 }, ps.rec, 1).time, gw.time, "用分享碼重播一致");
    assert.strictEqual(rp.time, gw.time, "用規格字串重播的時間一致（" + gw.time.toFixed(2) + " vs 標準 " + g0.time.toFixed(2) + "）");
    // 雙板：初速 +1、不能反腳
    var sk = Core.newSave(); sk.gear = { ski: true, skiId: "ski-M" };
    var skd = Prog.effDog(sk, "husky", { resort: "zao" });
    var st = Phys.create(t, T.at(T.piste(t, pid), 6), skd);
    assert.ok(Math.abs(Phys.speed(st) - (D.PHYS.startSpeed + 1)) < 1e-9, "雙板出發初速 +1");
    st.v = [-st.h[0] * 8, 0, -st.h[1] * 8];
    var ev = Phys.step(st, { s: 0, c: 0, j: 0, g: 0 }, { terrain: t, snow: "groomed" });
    assert.ok(ev.indexOf("fall") >= 0, "雙板反向滑行＝摔倒");
    var sb = Phys.create(t, T.at(T.piste(t, pid), 6), base);
    sb.v = [-sb.h[0] * 8, 0, -sb.h[1] * 8];
    assert.ok(Phys.step(sb, { s: 0, c: 0, j: 0, g: 0 }, { terrain: t, snow: "groomed" }).indexOf("fall") < 0, "單板可以反腳");
    var gsk = gs(t, pid, seed, skd);
    assert.strictEqual(gsk.status, "finish", "雙板自動駕駛完賽（" + (gsk.time ? gsk.time.toFixed(2) : gsk.reason) + "）");
    // 好感度：興奮度累積倍率
    var af = Core.newSave(); Prog.dogOf(af, "husky").aff = 100;
    var ad = Prog.effDog(af, "husky", { resort: "zao" });
    assert.strictEqual(ad.zoomMul, 1.25, "好感 100：興奮度 ×1.25");
    var sz = Phys.create(t, T.at(T.piste(t, pid), 6), ad);
    Core.zoomGain(sz, 10);
    assert.strictEqual(sz.zoom, 12.5, "興奮度累積倍率");
    ok("裝備、打蠟、規格字串重播、雙板（初速、反腳摔倒、完賽）、好感度");

    // 公園編輯器
    var spid = rr.json.events.slope.piste, plen = T.piste(t, spid).len;
    var list = [{ kind: "box", s: 60, lat: 0 }, { kind: "kickerS", s: 120, lat: -3 }, { kind: "roller", s: 170, lat: 0 }, { kind: "kickerM", s: 220, lat: 2 }, { kind: "rail", s: 280, lat: 0 }];
    assert.strictEqual(Prog.validatePark(list, plen), null, "合法的公園");
    assert.strictEqual(Prog.validatePark(list.slice(0, 3), plen), "count", "少於 4 個");
    assert.strictEqual(Prog.validatePark([{ kind: "box", s: 60, lat: 0 }, { kind: "rail", s: 90, lat: 0 }, { kind: "kickerS", s: 150, lat: 0 }, { kind: "kickerM", s: 200, lat: 0 }], plen), "gap", "間隔 < 40 m");
    assert.strictEqual(Prog.validatePark([{ kind: "box", s: 62, lat: 0 }, { kind: "rail", s: 120, lat: 0 }, { kind: "kickerS", s: 170, lat: 0 }, { kind: "kickerM", s: 220, lat: 0 }], plen), "range", "不是 5 m 的倍數");
    var code = Prog.parkCode("happo", spid, list), pc = Prog.parseParkCode(code);
    assert.deepStrictEqual(pc.list, list, "公園碼往返");
    var sr = SLP.simCpu(t, { piste: spid, seed: 9, snow: "groomed", runNo: 0, park: list }, D.CPU[2], 9, 0);
    assert.strictEqual(sr.status, "finish", "自訂公園 CPU 完賽");
    var run0 = SLP.newSlope(t, { piste: spid, seed: 9, dog: base, snow: "groomed", runNo: 0, park: list });
    assert.strictEqual(run0.featScore.length, 4, "計分地形 4 個（波浪不計分）");
    ok("公園編輯器：檢查、公園碼、自訂公園（CPU " + sr.score + " 分）");
  });
};

if (require.main === module) {
  module.exports().then(function () { console.log("inusnow p5_check OK"); }).catch(function (e) { console.error(e); process.exit(1); });
}
