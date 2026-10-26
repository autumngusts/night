// 鐵拳教育：格鬥引擎檢查（node 直接跑，不需要瀏覽器）：
//   node tools/fist_check/fight_check.js
// 檢查：一定會結束、結果換算回規則數值不會超出範圍、權力之壁擋傷害、見切讓對手暈、閃避後必會心、
// 踢能打斷蓄力、必殺技、撤退；並印出不同反應程度的 bot 平均表現（調數值用）。
"use strict";

global.window = global;
require("../../static_src/fist_data.js");
require("../../static_src/fist_fight.js");
var D = global.PriTestFistData;
var F = global.PriTestFistFight;
var simFight = require("./bot.js").simFight;

var fails = 0;
function check(name, fn) {
  try { fn(); console.log("OK  " + name); } catch (e) { fails++; console.error("NG  " + name + "：" + e.message); }
}
function assert(c, m) { if (!c) throw new Error(m); }
function run(e, sec, each) { for (var i = 0; i < sec * 60 && !e.over; i++) { e.tick(1 / 60); if (each) each(e); } }
function eng(foes, extra) {
  var o = { pow: 3, talk: 1, ult: "barrage", heat: 0, hp: 10, max: 10, foes: foes, seed: 5 };
  Object.keys(extra || {}).forEach(function (k) { o[k] = extra[k]; });
  return F.createEngine(o);
}
var LACKEY = { u: 1, id: "lackey", hp: 3, max: 3, atk: 1 };
var SENIOR = { u: 2, id: "senior", hp: 7, max: 7, atk: 3 };

check("什麼都不做會因時間到或倒下結束", function () {
  var e = eng([SENIOR, { u: 3, id: "delinquent", hp: 5, max: 5, atk: 2 }]);
  run(e, 20);
  assert(e.over && (e.why === "time" || e.why === "down"), "沒有結束 " + e.why);
  var r = e.result();
  assert(r.hits.length === 0 && r.taken >= 0 && r.taken <= 10, "結果異常 " + JSON.stringify(r));
});

check("連打能擊倒，結果換算成規則數值", function () {
  var e = eng([LACKEY]);
  run(e, 10, function (x) { x.input("punch"); });
  assert(e.why === "clear", "應該全員擊倒 " + e.why);
  var r = e.result();
  assert(r.hits.length === 1 && r.hits[0].d === 3 && r.hits[0].b === 1, "擊倒要回報全部氣焰 " + JSON.stringify(r));
  assert(r.fist === true && r.combo >= 2, "要記錄拳腳與連段");
});

check("沒打倒時傷害不會回報成擊倒", function () {
  var e = eng([{ u: 9, id: "x", hp: 99, max: 99, atk: 0 }], { time: 2 });
  run(e, 5, function (x) { x.input("punch"); });
  var r = e.result();
  assert(r.hits[0].d > 0 && r.hits[0].d < 99, "部分傷害 " + JSON.stringify(r));
});

check("權力之壁擋下所有傷害", function () {
  var e = eng([{ u: 4, id: "queen", hp: 10, max: 10, atk: 2, boss: true, wall: 3 }], { time: 3, heat: 5 });
  var walls = 0;
  run(e, 5, function (x) { x.input("punch"); x.input("ult"); walls += x.events.filter(function (v) { return v.k === "wall"; }).length; x.events.length = 0; });
  assert(e.result().hits.length === 0, "壁還在時不能有傷害");
  assert(walls > 0, "要有擋下的演出事件");
});

check("見切：在出手前一瞬間擋下，對手暈眩且不受傷", function () {
  var e = eng([SENIOR], { time: 6 });
  var parried = false;
  run(e, 6, function (x) {
    var f = x.foes[0];
    if (f.phase === "wind" && f.timer < 0.1) x.input("guardOn");
    if (x.events.some(function (v) { return v.k === "parry"; })) { parried = true; x.input("guardOff"); }
    x.events.length = 0;
  });
  assert(parried, "沒有發生見切");
  assert(e.me.taken === 0, "見切不該受傷 " + e.me.taken);
});

check("太早擋只能減傷", function () {
  var e = eng([SENIOR], { time: 4 });
  run(e, 0.95);
  e.input("guardOn");
  var blocked = false;
  run(e, 4, function (x) { if (x.events.some(function (v) { return v.k === "block"; })) blocked = true; x.events.length = 0; });
  assert(blocked && e.me.taken > 0 && e.me.taken < 3 * 6 * 2, "減傷異常 " + e.me.taken);
});

check("閃過之後下一擊必定會心", function () {
  var e = eng([{ u: 5, id: "y", hp: 99, max: 99, atk: 2 }], { time: 8 });
  var dodged = false, crit = null;
  run(e, 8, function (x) {
    var f = x.foes[0];
    if (!dodged && f.phase === "wind" && f.timer < 0.1) x.input("dodge");
    x.events.forEach(function (v) {
      if (v.k === "dodge") dodged = true;
      if (v.k === "hit" && dodged && crit === null) crit = v.crit;
    });
    x.events.length = 0;
    if (dodged && crit === null && x.me.atkCd === 0) x.input("punch");
  });
  assert(dodged && crit === true, "閃避後應會心 dodged=" + dodged + " crit=" + crit);
});

check("踢能打斷蓄力", function () {
  var e = eng([{ u: 6, id: "z", hp: 99, max: 99, atk: 2 }], { time: 6 });
  var interrupted = false;
  run(e, 6, function (x) {
    if (x.foes[0].phase === "wind" && x.foes[0].timer > 0.4) x.input("kick");
    if (x.events.some(function (v) { return v.k === "interrupt"; })) interrupted = true;
    x.events.length = 0;
  });
  assert(interrupted && e.me.taken === 0, "應打斷且不受傷 taken=" + e.me.taken);
});

check("必殺技：熱血滿才能用、只能用一次、打全體", function () {
  var e0 = eng([LACKEY, SENIOR], { heat: 4 });
  run(e0, 1);
  e0.input("ult");
  assert(!e0.me.ult, "熱血不夠不能放");
  var e = eng([LACKEY, SENIOR], { heat: 5 });
  run(e, 1);
  e.input("ult");
  assert(e.me.ult && e.freeze > 0, "要放出必殺並停格演出");
  var hp = e.foes.map(function (f) { return f.hp; });
  e.input("ult");
  assert(e.foes[0].phase === "down" && hp[1] === 70 - 60, "百裂鐵拳 力3×2×10=60 " + hp);
  var r = e.result();
  assert(r.ult === true, "結果要帶 ult");
});

check("真心話算說服（how=talk，不算拳腳）", function () {
  var e = eng([LACKEY], { ult: "truth", talk: 3, heat: 5 });
  run(e, 1);
  e.input("ult");
  var r = e.result();
  assert(r.hits[0].how === "talk" && r.fist === false, JSON.stringify(r));
});

check("撤退立刻結束", function () {
  var e = eng([SENIOR]);
  run(e, 1.5);
  e.input("retreat");
  assert(e.over && e.why === "retreat");
});

check("倒下時回報全部體力", function () {
  var e = eng([{ u: 7, id: "w", hp: 99, max: 99, atk: 9 }], { hp: 3, max: 10, time: 30 });
  run(e, 30);
  assert(e.why === "down" && e.result().taken === 3, e.why + " " + JSON.stringify(e.result()));
});

// 不同反應程度的平均表現（調數值參考，不判定）
[["不良少年＋跟班", [{ u: 1, id: "delinquent", hp: 5, max: 5, atk: 2 }, { u: 2, id: "lackey", hp: 3, max: 3, atk: 1 }], { pow: 3, hp: 12, max: 12 }],
 ["學長×2", [{ u: 1, id: "senior", hp: 7, max: 7, atk: 3 }, { u: 2, id: "senior", hp: 7, max: 7, atk: 3 }], { pow: 2, hp: 8, max: 8 }]].forEach(function (c) {
  [0, 0.5, 0.9].forEach(function (skill) {
    var dealt = 0, taken = 0, clear = 0, n = 60;
    for (var i = 0; i < n; i++) {
      var foes = c[1].map(function (f) { return Object.assign({}, f); });
      var st = { bullies: foes.map(function (f) { return { u: f.u, id: f.id, hp: f.hp, max: f.max, x: 0, y: 0 }; }) };
      var h = { x: 0, y: 0, pow: c[2].pow, talk: 1, hp: c[2].hp, max: c[2].max, heat: 0, cls: "pe" };
      var r = simFight(F, D, st, h, skill, i + 1);
      dealt += r.hits.reduce(function (s, x) { return s + x.d; }, 0);
      taken += r.taken;
      if (r.hits.filter(function (x) { return x.d >= D.ENEMY[foes.filter(function (f) { return f.u === x.b; })[0].id].hp; }).length === foes.length) clear++;
    }
    console.log("  " + c[0] + " 反應 " + skill + "：平均造成 " + (dealt / n).toFixed(1) + "、受到 " + (taken / n).toFixed(1) + "、全滅率 " + Math.round(100 * clear / n) + "%");
  });
});

console.log(fails ? "FAIL " + fails : "OK fight_check");
process.exit(fails ? 1 : 0);
