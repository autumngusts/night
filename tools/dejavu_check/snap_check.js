// DÉJÀ VU 連線對戰用的比賽快照檢查（node 直接跑，不需要瀏覽器）：
//   node tools/dejavu_check/snap_check.js [場數，預設 30]
// 檢查：
//   1. 比賽跑到任意一步存快照，換到另一場「同設定、但已經跑到別的步數」的比賽上還原，再跑完：結果與原本完全相同
//      （涵蓋較真／奔放、夜間、天氣變化、磨耗、計時賽、Déjà vu 指令重播）
//   2. 快照之後在原本那場下的戰略指令，還原端照樣套用時結果也一致（＝房主收到指令後的下一張快照能把大家對齊）
//   3. 快照是純 JSON 字串，大小合理（Firebase 每秒寫一次）
"use strict";

global.window = global;
require("../../static_src/dejavu_data.js");
require("../../static_src/dejavu_cars.js");
require("../../static_src/dejavu_bikes.js");
require("../../static_src/dejavu_courses.js");
require("../../static_src/dejavu_core.js");
var D = global.PriTestDejavuData;
var Core = global.PriTestDejavuCore;
var runs = Number(process.argv[2]) || 30;
var fails = 0, maxLen = 0;

function ok(cond, msg) { if (!cond) { fails++; console.log("✗ " + msg); } }

var r = Core.rng(20261027);
function pick(a) { return a[Math.floor(r() * a.length)]; }
function spec() {
  var car = pick(D.CARS);
  var sp = { car: car.id, tire: pick(["sport", "soft", "hard"]), aero: Math.floor(r() * 3), gear: 0, style: pick(D.STYLE_IDS), up: { eng: 0, wt: 0, brk: 0, hdl: 0 } };
  for (var i = 0; i < D.UPGRADE_POINTS; i++) { var u = pick(D.UPGRADES); if (sp.up[u] < D.UPGRADE_MAX) sp.up[u]++; }
  return sp;
}
function key(race) { return JSON.stringify(Core.results(race)); }

for (var k = 0; k < runs; k++) {
  var n = 2 + Math.floor(r() * 7);
  var cars = [];
  for (var i = 0; i < n; i++) cars.push({ spec: spec(), name: "#" + i, cpu: i >= 2 });
  var opts = {
    course: Core.fixedCourse(pick(D.COURSES).id), season: pick(["spring", "summer", "autumn", "winter"]), dir: r() < 0.5 ? "down" : "up",
    mode: r() < 0.85 ? "battle" : "attack", rule: r() < 0.5 ? "wild" : "real", seed: Math.floor(r() * 1e9), cars: cars, upPts: D.UPGRADE_POINTS,
    night: r() < 0.4, wx: r() < 0.5, wear: r() < 0.5
  };
  var tag = "#" + k + " " + opts.course.src + " " + opts.mode + "/" + opts.rule + (opts.night ? " 夜" : "") + (opts.wx ? " 天氣" : "") + (opts.wear ? " 磨耗" : "");

  // 原本那場：中途玩家 0、1 換戰略（模擬房主那邊收到的指令）
  var A = Core.createRace(opts);
  var cmdAt = 200 + Math.floor(r() * 1500), cmdStyle = pick(D.STYLE_IDS);
  var snapAt = 100 + Math.floor(r() * 3000);
  var snap = null;
  while (!A.done) {
    if (A.stepN === cmdAt) { Core.command(A, 0, cmdStyle); if (A.wild && A.cars[1].hand.length) Core.playCard(A, 1, 0); }
    if (A.stepN === snapAt) snap = Core.snapshot(A);
    Core.step(A);
  }
  if (!snap) snap = Core.snapshot(A);
  if (snap.length > maxLen && process.env.SNAP_DEBUG) { var so = JSON.parse(snap); console.log(tag, Object.keys(so).map(function (q) { return q + ":" + JSON.stringify(so[q]).length; }).join(" "), [].concat.apply([], so.cars.map(function (cc, ci) { return Object.keys(cc).map(function (q) { return ci + "." + q + ":" + (JSON.stringify(cc[q]) || "").length; }); })).filter(function (x) { return +x.split(":")[1] > 50; }).join(" ")); }
  maxLen = Math.max(maxLen, snap.length);
  var want = key(A);

  // 1. 還原到「已經跑過頭」的另一場（本機比房主快）
  var B = Core.createRace(opts);
  var ahead = snapAt + 50 + Math.floor(r() * 400);
  while (!B.done && B.stepN < ahead) Core.step(B);
  ok(Core.restore(B, snap), tag + " 還原失敗");
  // 快照之後的指令：還原端要照樣下（實際連線時由下一張快照帶來，這裡直接重播）
  while (!B.done) {
    if (B.stepN === cmdAt) { Core.command(B, 0, cmdStyle); if (B.wild && B.cars[1].hand.length) Core.playCard(B, 1, 0); }
    Core.step(B);
  }
  ok(key(B) === want, tag + " 跑過頭再還原：結果不同（快照步數 " + snapAt + "）");

  // 2. 還原到「還沒跑到」的另一場（本機比房主慢）
  var C = Core.createRace(opts);
  while (!C.done && C.stepN < Math.floor(snapAt / 3)) Core.step(C);
  Core.restore(C, snap);
  while (!C.done) {
    if (C.stepN === cmdAt) { Core.command(C, 0, cmdStyle); if (C.wild && C.cars[1].hand.length) Core.playCard(C, 1, 0); }
    Core.step(C);
  }
  ok(key(C) === want, tag + " 落後再還原：結果不同");

  // 3. Déjà vu（帶指令紀錄）的比賽也能還原
  var E = Core.createRace(Object.assign({}, opts, { cmds: A.log }));
  var snap2 = null;
  while (!E.done) { if (E.stepN === snapAt) snap2 = Core.snapshot(E); Core.step(E); }
  var F = Core.createRace(Object.assign({}, opts, { cmds: A.log }));
  while (!F.done && F.stepN < snapAt + 300) Core.step(F);
  if (snap2) { Core.restore(F, snap2); Core.runToEnd(F); ok(key(F) === key(E), tag + " Déjà vu 還原：結果不同"); }
  ok(key(E) === want, tag + " Déjà vu 重播與原本不同");
}

ok(maxLen < 60000, "快照太大：" + maxLen + " 字元");
console.log("快照最大 " + maxLen + " 字元");
console.log(fails ? "✗ " + fails + " 項失敗" : "✓ 快照還原 " + runs + " 場全部一致");
process.exit(fails ? 1 : 0);
