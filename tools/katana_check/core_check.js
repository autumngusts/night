// ============================================================================
// katana（神前鍛刀對決）規則引擎的 Node 檢查。
// 執行：node tools/katana_check/core_check.js
// 檢查：工序順序與驗證、理想做法與粗心做法的分數差距、確定性亂數、試斬與互擊能分出勝負、
//       冶金模型的定性性質（使用者指定「盡可能精確」）、特殊材料與異國刀種的組合。
// ============================================================================
"use strict";
var fs = require("fs");
var path = require("path");
var assert = require("assert");

var SRC = path.join(__dirname, "..", "..", "static_src");
var win = {};
["katana_data.js", "katana_core.js"].forEach(function (f) {
  new Function("window", fs.readFileSync(path.join(SRC, f), "utf8"))(win);
});
var D = win.PriTestKatanaData;
var Core = win.PriTestKatanaCore;
var M = Core.metal;

function mid(w) { return Math.round((w.lo + w.hi) / 2); }

// 理想玩家：依注意事項的標準做法。opt 可覆寫材料、刀種與各工序
function idealInput(state, pi, stepId, opt) {
  opt = opt || {};
  var b = state.players[pi].blade;
  var bt = Core.byId(D.BLADE_TYPES, b.type || opt.type || "uchigatana");
  var x;
  switch (stepId) {
    case "material": x = { kawagane: "tama1", kawaKg: 7, shingane: "hocho", shinKg: 2, type: "uchigatana" }; break;
    case "kowari": x = { picks: Core.kowariPieces(state, pi).map(function (pc) {
      if (pc.spots === "many") return "discard";
      return pc.look === "coarse" ? "shin" : "kawa";
    }) }; break;
    case "tsumi": x = { temp: mid(Core.heatWindow(b, "tsumi")), ash: true }; break;
    case "shitakitae": x = { folds: 7, shinFolds: 4, hammer: { acc: 0.9, strikes: 8, cold: 0, reheats: 0 } }; break;
    case "uwakitae": x = { folds: 6, pattern: "itame", hammer: { acc: 0.9, strikes: 8, cold: 0, reheats: 0 } }; break;
    case "tsukurikomi": x = { construction: b.shinId === "none" ? "maru" : "kobuse", temp: mid(Core.heatWindow(b, "weld")) }; break;
    case "sunobe": x = { length: Math.round((bt.ideal[0] + bt.ideal[1]) / 2), hammer: { acc: 0.9, strikes: 8, cold: 0 } }; break;
    case "hizukuri":
      var tk = Core.byId(D.TSUKURI, bt.tsukuri[0]), ks = Core.byId(D.KISSAKI, bt.kissaki[0]), st = Core.byId(D.SORI_TYPES, bt.soriType[0]);
      x = { tsukuri: tk.id, kissaki: ks.id, mune: "iori", soriType: st.id, kasane: (bt.kasane[0] + bt.kasane[1]) / 2,
        mihaba: Math.round((bt.width[0] + bt.width[1]) / 2), forgeSori: bt.forgeSori };
      break;
    case "tsuchioki": x = bt.ht === "through" ? { hamon: "none", edgeClay: "thin", spineClay: "thin", ashi: false, norm: 2 }
      : { hamon: "gunome", edgeClay: "thin", spineClay: "thick", ashi: true, norm: 2 }; break;
    case "yakiire": x = { temp: mid(Core.heatWindow(b, "quench")), media: "warm", dark: true }; break;
    case "aitori":
      // 依刀種目標硬度挑回火溫度（避開 250〜400℃ 脆性區以外的最接近者）
      var target = (bt.hrc[0] + bt.hrc[1]) / 2, best = null;
      for (var tt = 150; tt <= 520; tt += 10) {
        if (tt > 240 && tt < 400) continue;
        var d = Math.abs(b.hardEdge - M.temperDrop(tt, 1) - target);
        if (!best || d < best.d) best = { t: tt, d: d };
      }
      x = { temp: best.t, hours: 1, soriAdjust: 0 }; break;
    case "togi": x = { order: D.STONES.map(function (s) { return s.id; }), edge: "standard" }; break;
    case "mei": x = { yasurime: "katte", nakagojiri: "kuri", mei: "試作" }; break;
  }
  // 折返時溫度依折返次數決定（0 次＝只延展）
  if (stepId === "shitakitae" || stepId === "uwakitae") {
    if (opt[stepId]) Object.keys(opt[stepId]).forEach(function (k) { x[k] = opt[stepId][k]; });
    x.temp = mid(Core.heatWindow(b, "fold", { folds: x.folds }));
    if (opt[stepId] && opt[stepId].temp) x.temp = opt[stepId].temp;
    return x;
  }
  if (opt[stepId]) Object.keys(opt[stepId]).forEach(function (k) { x[k] = opt[stepId][k]; });
  return x;
}

// 粗心玩家：溫度亂來、鍛太多次、跳砥石
function sloppyInput(state, pi, stepId) {
  var x = idealInput(state, pi, stepId);
  switch (stepId) {
    case "material": x.kawagane = "tama2"; x.kawaKg = 4; break;
    case "kowari": x.picks = x.picks.map(function () { return "kawa"; }); break;
    case "tsumi": x.temp = 1050; x.ash = false; break;
    case "shitakitae": x.temp = 1420; x.folds = 10; x.hammer = { acc: 0.3, strikes: 8, cold: 4, reheats: 0 }; break;
    case "uwakitae": x.temp = 1100; x.folds = 10; x.pattern = "ayasugi"; x.hammer = { acc: 0.3, strikes: 8, cold: 3, reheats: 0 }; break;
    case "tsukurikomi": x.construction = "shihozume"; x.temp = 1000; break;
    case "sunobe": x.hammer = { acc: 0.2, strikes: 8, cold: 4 }; break;
    case "hizukuri": x.kasane = 5; x.mihaba = 36; break;
    case "tsuchioki": x.hamon = "hitatsura"; x.spineClay = "thin"; x.ashi = false; x.norm = 0; break;
    case "yakiire": x.temp = 900; x.media = "brine"; break;
    case "aitori": x.temp = 0; break;
    case "togi": x.order = ["kongo", "uchigumori", "binsui", "migaki"]; x.edge = "flat"; break;
    case "mei": x.mei = ""; break;
  }
  return x;
}

function forgeAll(state, inputFn) {
  var order = [];
  while (state.phase === "forge") {
    var pi = Core.currentForger(state);
    var stepId = D.STEPS[state.players[pi].step].id;
    order.push(pi);
    var r = Core.applyStep(state, pi, stepId, inputFn(state, pi, stepId));
    assert.ok(r.ok, stepId + " failed: " + r.error);
  }
  return order;
}

// 單人以指定材料／刀種鍛完一把
function forgeOne(seed, opt) {
  var s = Core.newGame({ names: ["x"], seed: seed, mode: opt.mode });
  forgeAll(s, function (st, pi, id) {
    var x = idealInput(st, pi, id, opt);
    if (id === "material") ["kawagane", "shingane", "type", "kawaKg", "shinKg"].forEach(function (k) { if (opt[k] !== undefined) x[k] = opt[k]; });
    return x;
  });
  return s.players[0];
}

function summary(b) {
  return JSON.stringify({ C: b.kawaC, imp: b.impurity, kg: b.steelKg, folds: b.folds, layers: b.layers, G: b.grain, flaws: b.flaws,
    sori: b.sori, soriQ: b.soriQuench, hrc: b.hardEdge, spine: b.hardSpine, edgeM: b.edgeM, spineM: b.spineM, RA: b.retainedAus,
    Ms: b.ms, clar: b.hamonClarity, bound: b.hamonBoundary, crack: b.crackRisk });
}

// ---------------- 冶金模型的定性性質 ----------------
var tam = { C: 0.7, Mn: 0.01, Si: 0.02, Ni: 0, Cr: 0, W: 0, Mo: 0, V: 0, P: 0.02, S: 0.004 };
var aog = { C: 1.1, Mn: 0.25, Si: 0.15, Ni: 0, Cr: 0.35, W: 1.2, Mo: 0, V: 0, P: 0.02, S: 0.004 };
// 固相線：碳越多越低；端點與 Fe–C 狀態圖一致
assert.ok(Math.abs(M.solidus(0, 0) - 1538) < 1 && Math.abs(M.solidus(2.11, 0) - 1148) < 3);
assert.ok(M.solidus(1.2, 0) < M.solidus(0.7, 0));
// 擴散係數隨溫度上升（1300℃ 約 2.8e-10 m²/s）
assert.ok(M.diffC(1300) > 2e-10 && M.diffC(1300) < 4e-10 && M.diffC(1350) > M.diffC(1300));
// Ac3：0.7%C 約 740℃（Andrews 式）；Ms：0.7%C 約 240℃
assert.ok(Math.abs(M.ac3(tam) - 740) < 10, "Ac3 " + M.ac3(tam));
assert.ok(Math.abs(M.msTemp(tam, 0.7) - 243) < 10);
// 麻田散鐵硬度：0.2%C 約 HRC 44、0.6%C 約 HRC 64
assert.ok(Math.abs(M.hrcMartensite(0.2) - 44) < 2 && Math.abs(M.hrcMartensite(0.6) - 64) < 2);
// 淬透性：青紙（Cr・W・Mn）遠深於玉鋼
assert.ok(M.idealDiameter(aog, 0.8, 7) > 3 * M.idealDiameter(tam, 0.7, 7));
// 過共析鋼：溫度越高溶入碳越多
var hyp = { C: 1.2, Mn: 0.01, Si: 0.02, Ni: 0, Cr: 0, W: 0, Mo: 0, V: 0 };
assert.ok(M.austenite(hyp, 850).Cd > M.austenite(hyp, 760).Cd);
assert.strictEqual(M.austenite(hyp, 700).fa, 0);
// 回火：溫度越高硬度降越多；250〜400℃ 有回火脆性
assert.ok(M.temperDrop(300, 1) > M.temperDrop(180, 1) && M.temperDrop(180, 1) > 1);
// 脫碳：高溫加熱脫碳較多
assert.ok(M.decarbFrac(1350, 15, 100, 0.55) > M.decarbFrac(1200, 15, 100, 0.55));

// ---------------- 兩人輪流：理想 vs 粗心 ----------------
var state = Core.newGame({ names: ["理想", "粗心"], seed: "check-1", mode: "serious" });
assert.strictEqual(state.phase, "forge");
assert.strictEqual(Core.currentForger(state), 0);
assert.strictEqual(Core.applyStep(state, 0, "kowari", {}).ok, false); // 錯的工序 id 被拒絕
var order = forgeAll(state, function (st, pi, id) { return pi === 0 ? idealInput(st, pi, id) : sloppyInput(st, pi, id); });
assert.deepStrictEqual(order.slice(0, 4), [0, 1, 0, 1]);
assert.strictEqual(order.length, D.STEPS.length * 2);
assert.strictEqual(state.phase, "judge");

var good = state.players[0].blade, bad = state.players[1].blade;
var jg = Core.judge(good), jb = Core.judge(bad);
console.log("ideal :", summary(good));
console.log("        judge", JSON.stringify(jg.scores), jg.total, D.GRADES[jg.grade].name.zh, JSON.stringify(Core.stats(good)));
console.log("sloppy:", summary(bad));
console.log("        judge", JSON.stringify(jb.scores), jb.total, D.GRADES[jb.grade].name.zh, JSON.stringify(Core.stats(bad)));
assert.ok(jg.total >= 75, "ideal should score >= 75, got " + jg.total);
assert.ok(jb.total <= 45, "sloppy should score <= 45, got " + jb.total);
assert.ok(good.kawaC >= 0.55 && good.kawaC <= 0.8, "ideal carbon in range: " + good.kawaC);
assert.ok(good.sori >= 13 && good.sori <= 20, "uchigatana sori: " + good.sori);
assert.ok(good.hardEdge >= 57 && good.hardSpine <= 35, "differential hardening: " + good.hardEdge + "/" + good.hardSpine);

// 確定性：同 seed 同輸入 → 同結果
var s2 = Core.newGame({ names: ["理想", "粗心"], seed: "check-1", mode: "serious" });
forgeAll(s2, function (st, pi, id) { return pi === 0 ? idealInput(st, pi, id) : sloppyInput(st, pi, id); });
assert.deepStrictEqual(s2.players, state.players);

// 研磨順序分數
assert.strictEqual(Core.polishScore(D.STONES.map(function (s) { return s.id; })), 1);
assert.ok(Core.polishScore(["migaki", "kongo"]) < 0.2);

// 試斬
Core.startCut(state);
var guard = 0;
while (Core.cutTurn(state) && guard++ < 100) Core.applyCut(state, 0.85, false);
assert.strictEqual(state.cut.target, D.TARGETS.length);
console.log("cut points:", Core.cutPoints(state, "p1"), Core.cutPoints(state, "p2"), "hp:", JSON.stringify(state.cut.hp));
assert.ok(Core.cutPoints(state, "p1") >= Core.cutPoints(state, "p2"));

// 互擊（加入對手刀）
Core.startClash(state, ["sato"]);
guard = 0;
while (!state.clash.winner && guard++ < 200) Core.clashRound(state);
assert.ok(state.clash.winner, "clash must end");
console.log("clash winner:", state.clash.winner, "rounds:", state.clash.round, "placing:", Core.clashPlacing(state).join(","));
var rank = Core.finalRanking(state);
assert.strictEqual(rank.length, 2);

// ---------------- 驗證 ----------------
var s3 = Core.newGame({ names: ["a"], seed: "x" });
assert.strictEqual(Core.applyStep(s3, 0, "material", { kawagane: "tama1", kawaKg: 1, shingane: "hocho", shinKg: 2, type: "uchigatana" }).error, "kt_err_range");
assert.strictEqual(Core.applyStep(s3, 0, "material", { kawagane: "tama1", kawaKg: 5, shingane: "hocho", shinKg: 2, type: "nope" }).error, "kt_err_pick");
Core.applyStep(s3, 0, "material", { kawagane: "tama1", kawaKg: 5, shingane: "none", shinKg: 0, type: "uchigatana" });
assert.strictEqual(Core.applyStep(s3, 0, "kowari", { picks: new Array(12).fill("discard") }).error, "kt_err_kowari_min");
assert.throws(function () { Core.newGame({ names: [] }); });

// ---------------- 特殊材料・異國刀種 ----------------
// 棒鋼不需小割・積沸（自動略過）
var shiro = forgeOne("sp-shiro", { kawagane: "shirogami", shitakitae: { folds: 0 }, uwakitae: { folds: 0 } });
assert.ok(shiro.log.some(function (e) { return e.step === "kowari" && e.skipped; }));
assert.ok(shiro.log.some(function (e) { return e.step === "tsumi" && e.skipped; }));
console.log("白紙→打刀:", summary(shiro.blade), Core.judge(shiro.blade).total);

// 青紙淬透深：同樣置土，刃文不如玉鋼清楚
var ao = forgeOne("sp-ao", { kawagane: "aogami", shitakitae: { folds: 0 }, uwakitae: { folds: 0 } });
console.log("青紙→打刀:", summary(ao.blade), Core.judge(ao.blade).total);
assert.ok(ao.blade.spineM > good.spineM, "aogami hardens deeper under clay");
var s60 = forgeOne("sp-60", { kawagane: "s1060", shitakitae: { folds: 0 }, uwakitae: { folds: 0 } });
console.log("1060→打刀:", summary(s60.blade), Core.judge(s60.blade).total);
assert.ok(s60.blade.hamonClarity < shiro.blade.hamonClarity, "Mn-rich 1060 hamon blurrier than shirogami");

// 玉鋼 → 闊劍：雙刃對稱 → 淬火不產生反；整體淬火＋彈簧回火
var bs = forgeOne("sp-bs", { type: "broadsword", shingane: "none" });
console.log("玉鋼→闊劍:", summary(bs.blade), Core.judge(bs.blade).total);
assert.ok(Math.abs(bs.blade.soriQuench) < 0.5, "double-edged quench sori ~0: " + bs.blade.soriQuench);
assert.ok(bs.blade.hardEdge < 56, "spring temper: " + bs.blade.hardEdge);

// 烏茲鋼 → 彎刀：不折返、950℃ 以下延展 → 紋路保留；折返則消失
var wz = forgeOne("sp-wz", { kawagane: "wootz", type: "shamshir", shingane: "none", shitakitae: { folds: 0 }, uwakitae: { folds: 0 } });
console.log("烏茲→彎刀:", summary(wz.blade), Core.judge(wz.blade).total, Core.judge(wz.blade).scores.jigane);
assert.ok(wz.blade.patternIntact, "wootz pattern kept");
assert.ok(wz.blade.sori >= 40, "shamshir forged curve: " + wz.blade.sori);
var wz2 = forgeOne("sp-wz2", { kawagane: "wootz", type: "shamshir", shingane: "none", shitakitae: { folds: 3 }, uwakitae: { folds: 0 } });
assert.ok(!wz2.blade.patternIntact && wz2.blade.flaws.indexOf("patternLost") >= 0);

// 大馬士革 → 打刀：層數影響紋路分數
var dm = forgeOne("sp-dm", { kawagane: "damascus", shitakitae: { folds: 3 }, uwakitae: { folds: 1 } });
console.log("大馬士革→打刀:", summary(dm.blade), Core.judge(dm.blade).total);
assert.strictEqual(dm.blade.layers, 15 * 16);

// 流星刀
var mt = forgeOne("sp-mt", { kawagane: "meteor" });
console.log("流星刀:", summary(mt.blade), Core.judge(mt.blade).total);
var mc = Core.byId(D.KAWAGANE, "meteor").comp, tc = Core.byId(D.KAWAGANE, "tama1").comp;
assert.ok(M.msTemp(mc, 0.6) < M.msTemp(tc, 0.6) - 50, "Ni lowers Ms");

// 廓爾喀刀：火造內彎
var kk = forgeOne("sp-kk", { type: "kukri", kawaKg: 4 });
console.log("玉鋼→廓爾喀:", summary(kk.blade), Core.judge(kk.blade).total);
assert.ok(kk.blade.sori < 0);

// 過熱淬火：晶粒粗、淬裂風險高
var oh = forgeOne("sp-oh", { yakiire: { temp: 900 } });
assert.ok(oh.blade.grain < good.grain && oh.blade.crackRisk > good.crackRisk);
// 回火脆性溫區的韌性低於 180℃
var tme = forgeOne("check-1", { aitori: { temp: 300 } });
var ok180 = forgeOne("check-1", { aitori: { temp: 200 } });
console.log("TME:", tme.blade.temperTemp, Core.stats(tme.blade).toughness, ok180.blade.temperTemp, Core.stats(ok180.blade).toughness, tme.blade.flaws, ok180.blade.flaws);
assert.ok(Core.stats(tme.blade).toughness < Core.stats(ok180.blade).toughness, "TME window");

// 多 seed 統計：理想做法的分數
var totals = [];
for (var k = 0; k < 40; k++) totals.push(Core.judge(forgeOne("stat-" + k, {}).blade).total);
totals.sort(function (a, b) { return a - b; });
console.log("ideal totals over 40 seeds: min", totals[0], "median", totals[20], "max", totals[39]);
assert.ok(totals[20] >= 80);

// ---------------- 模式 ----------------
// 表演模式：非玉鋼打日本刀不扣地鐵；淬裂風險減半；加熱窗口較寬
var shS = forgeOne("sp-shiro", { mode: "show", kawagane: "shirogami", shitakitae: { folds: 0 }, uwakitae: { folds: 0 } });
var shR = forgeOne("sp-shiro", { mode: "serious", kawagane: "shirogami", shitakitae: { folds: 0 }, uwakitae: { folds: 0 } });
console.log("白紙打刀 表演/較真 地鐵:", Core.judge(shS.blade).scores.jigane, Core.judge(shR.blade).scores.jigane, "crack", shS.blade.crackRisk, shR.blade.crackRisk);
assert.ok(Core.judge(shS.blade).scores.jigane >= Core.judge(shR.blade).scores.jigane + 2.9);
assert.ok(shS.blade.crackRisk < shR.blade.crackRisk);
var wS = Core.heatWindow(shS.blade, "quench"), wR = Core.heatWindow(shR.blade, "quench");
assert.ok(wS.hi - wS.lo > wR.hi - wR.lo);
// 淬火延遲：同樣溫度，晚 6 秒入水 → 空冷 150℃，淬不硬
var late = forgeOne("check-1", { yakiire: { delay: 6000 } });
assert.ok(late.blade.hardEdge < good.hardEdge - 5, "late plunge: " + late.blade.hardEdge);
// 小遊戲：土線歪 → 刃文清晰度下降；火造不準 → 尺寸偏離
var messy = forgeOne("check-1", { tsuchioki: { clayAcc: 0.2 }, hizukuri: { hammer: { acc: 0.1, strikes: 10 } } });
assert.ok(messy.blade.hamonClarity < good.hamonClarity);
assert.ok(messy.blade.mihaba !== 31 || messy.blade.kasane !== 7.3);

// ---------------- 所有刀種都能打完、審查分在合理範圍 ----------------
D.BLADE_TYPES.forEach(function (bt) {
  var shin = bt.edges === 2 || bt.ht === "through" ? "none" : "hocho";
  var pl = forgeOne("type-" + bt.id, { type: bt.id, shingane: shin, kawaKg: 10 });
  var j = Core.judge(pl.blade);
  console.log("  " + bt.id + ": " + j.total + " sugata " + j.scores.sugata + " sori " + pl.blade.sori + " HRC " + pl.blade.hardEdge + " flaws " + pl.blade.flaws.join("/"));
  assert.ok(j.total >= 55, bt.id + " ideal total " + j.total);
  assert.ok(j.scores.sugata >= 14, bt.id + " sugata " + j.scores.sugata);
});

console.log("katana core_check OK");
