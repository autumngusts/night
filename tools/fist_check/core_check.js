// 鐵拳教育規則引擎的自動對局檢查（node 直接跑，不需要瀏覽器）：
//   node tools/fist_check/core_check.js [局數] [格鬥反應準度 0〜1，預設 0.6]
// 每局隨機 1〜4 位老師，用 bot.js 打到勝利或失敗，檢查：不丟例外、不會卡住、數值不會變成負數或 NaN、
// 格子座標合法、各種操作的錯誤代碼（不能操作別人的老師、AP 不夠、權力之壁擋拳）。
"use strict";

global.window = global;
require("../../static_src/fist_data.js");
require("../../static_src/fist_core.js");
require("../../static_src/fist_fight.js");
var D = global.PriTestFistData;
var Core = global.PriTestFistCore;
var Fight = global.PriTestFistFight;
var botAction = require("./bot.js").botAction;

var games = Number(process.argv[2]) || 200;
var SKILL = process.argv[3] !== undefined ? Number(process.argv[3]) : 0.6; // bot 格鬥時的反應準度
var fails = 0;
var sum = { win: 0, lose: 0, stuck: 0, why: {}, ch: [0, 0, 0], byN: {} };

function assert(cond, msg) { if (!cond) throw new Error(msg); }

function check(st) {
  ["dark", "comp", "evid", "hope", "round"].forEach(function (k) { assert(typeof st[k] === "number" && isFinite(st[k]) && st[k] >= 0, k + " 異常 " + st[k]); });
  assert(st.dark <= D.MAX_DARK && st.comp <= D.MAX_COMP, "黑暗度／投訴超過上限");
  Core.teachers(st).forEach(function (h) {
    ["hp", "max", "ap", "heat", "cd", "pow", "talk", "sense"].forEach(function (k) { assert(typeof h[k] === "number" && isFinite(h[k]) && h[k] >= 0, "teacher." + k + " 異常 " + h[k]); });
    assert(h.hp <= h.max, "體力超過上限");
    assert(h.heat <= D.MAX_HEAT, "熱血超過上限");
    assert(Core.tileAt(h.x, h.y), "老師座標異常");
    if (h.down) assert(h.ap === 0 && h.done, "倒下的老師還有行動");
  });
  st.bullies.forEach(function (b) {
    assert(D.ENEMY[b.id] && Core.tileAt(b.x, b.y), "霸凌者異常");
    assert(b.hp > 0 && b.hp <= b.max, "霸凌者氣焰異常 " + b.hp);
    if (b.boss) assert(b.wall >= 0 && b.wall <= b.wallMax, "權力之壁異常");
  });
  assert(st.bullies.filter(function (b) { return b.boss; }).length <= 1, "權力者不只一個");
  st.victims.forEach(function (v) { assert(v.hp > 0 && v.hp <= v.max && Core.tileAt(v.x, v.y), "學生異常"); });
}

function errorCodes() {
  var st = Core.create({ seed: 7, seats: [{ cls: "pe", ctrl: "a" }, { cls: "lit", ctrl: "b" }, null, null] });
  assert(Core.apply(st, "a", { t: "move", s: 0, x: 1, y: 1 }) === "phase", "故事階段不能行動");
  assert(Core.apply(st, "zzz", { t: "go" }) === "not_yours", "旁觀者不能開始");
  assert(Core.apply(st, "a", { t: "go" }) === null, "開始上課");
  assert(Core.apply(st, "a", { t: "move", s: 1, x: 1, y: 1 }) === "not_yours", "不能動別人的老師");
  assert(Core.apply(st, "a", { t: "move", s: 0, x: 6, y: 4 }) === "far", "步數限制");
  // 移動花步數不花 AP：辦公室(1,2) → (3,1) 3 步，再 → (3,3) 2 步 → 步數用完
  assert(Core.apply(st, "a", { t: "move", s: 0, x: 3, y: 1 }) === null, "移動");
  var h0 = Core.teacher(st, 0);
  assert(h0.steps === 2 && h0.ap === 3, "移動扣步數不扣 AP " + h0.steps + "/" + h0.ap);
  assert(st.log[st.log.length - 1].fx === 1 && st.log[st.log.length - 1].fy === 2, "移動紀錄要有起點（跑步動畫用）");
  Core.apply(st, "a", { t: "move", s: 0, x: 3, y: 3 });
  assert(Core.apply(st, "a", { t: "move", s: 0, x: 3, y: 2 }) === "no_steps", "步數用完");
  assert(Core.apply(st, "a", { t: "skill", s: 0 }) === null && h0.steps === 4, "衝刺：步數 +4");
  assert(Core.apply(st, "a", { t: "rest", s: 0 }) === "not_here", "只能在辦公室或保健室休息");
  assert(Core.apply(st, "a", { t: "ult", s: 0 }) === "in_fight", "打人的必殺技要在格鬥畫面裡放");
  assert(Core.apply(st, "b", { t: "ult", s: 1 }) === "no_heat", "熱血不夠");
  assert(Core.apply(st, "a", { t: "search", s: 0 }) === "no_target", "沒有霸凌者不能蒐證");
  assert(Core.apply(st, "a", { t: "fight", s: 0, r: {} }) === "no_target", "沒有霸凌者不能開打");

  // 權力之壁：直接生出權力者測試（國文老師在辦公室 1,2）
  var b = { u: 999, id: "queen", hp: 10, max: 10, x: 1, y: 2, stun: false, boss: true, wall: 2, wallMax: 2 };
  st.bullies.push(b);
  var before = st.comp;
  assert(Core.apply(st, "b", { t: "fight", s: 1, r: { hits: [{ b: 999, d: 5 }], fist: true, combo: 3 } }) === null && b.hp === 10, "壁還在時打不到本體");
  assert(st.comp === before, "打權力者不投訴");
  assert(Core.apply(st, "b", { t: "expose", s: 1 }) === "no_evid", "沒有證據不能揭發");
  st.evid = 2;
  assert(Core.apply(st, "b", { t: "expose", s: 1 }) === null && b.wall === 0, "揭發 −2");
  Core.teacher(st, 1).ap = 3;
  assert(Core.apply(st, "b", { t: "fight", s: 1, r: { hits: [{ b: 999, d: 4 }], fist: true } }) === null && b.hp === 6, "壁破了打得到");

  // 格鬥結果：沒有證據要投訴、傷害與受傷都要夾在範圍內、熱血增加
  var st2 = Core.create({ seed: 3, seats: [{ cls: "pe", ctrl: "a" }, null, null, null] });
  Core.apply(st2, "a", { t: "go" });
  st2.bullies.push({ u: 500, id: "senior", hp: 7, max: 7, x: 1, y: 2, stun: false });
  st2.bullies.push({ u: 501, id: "lackey", hp: 3, max: 3, x: 6, y: 4, stun: false });
  var h = Core.teacher(st2, 0);
  Core.apply(st2, "a", { t: "fight", s: 0, r: { hits: [{ b: 500, d: 2 }, { b: 501, d: 3 }], taken: 99, combo: 9, fist: true } });
  assert(st2.comp === 1, "沒證據開打要投訴 +1");
  assert(Core.bully(st2, 500).hp === 5 && Core.bully(st2, 501).hp === 3, "只能打到同格的霸凌者");
  assert(st2.log.some(function (e) { return e.k === "hitT" && e.d === 12; }) && st2.log.some(function (e) { return e.k === "downT"; }), "受到的傷害夾在體力以內，歸零就倒下");
  var st3 = Core.create({ seed: 4, seats: [{ cls: "counselor", ctrl: "a" }, null, null, null] });
  Core.apply(st3, "a", { t: "go" });
  st3.bullies.push({ u: 600, id: "delinquent", hp: 5, max: 5, x: 1, y: 2, stun: false });
  var c3 = Core.teacher(st3, 0);
  c3.heat = 5;
  st3.comp = 3;
  Core.apply(st3, "a", { t: "fight", s: 0, r: { hits: [{ b: 600, d: 5, how: "talk" }], ult: true, fist: false } });
  assert(!Core.bully(st3, 600) && st3.comp === 2 && c3.heat === 0 && st3.hope >= 1, "真心話：算說服、投訴 −1、熱血歸零");
  // 單人 4 AP；AP 用完但還有步數不會自動結束
  assert(c3.ap === 3 && c3.steps === 6, "單人 4 AP、6 步");
}

function playOne(g) {
  var n = 1 + (g % 4);
  var pool = D.CLASSES.map(function (c) { return c.id; });
  var seats = [null, null, null, null];
  for (var i = 0; i < n; i++) seats[i] = { cls: pool.splice((g * 7 + i * 3) % pool.length, 1)[0], ctrl: "p" + i };
  var st = Core.create({ seed: g * 7919 + 1, seats: seats, hostCtrl: "p0" });
  var steps = 0;
  while (st.phase !== "win" && st.phase !== "lose") {
    if (++steps > 20000) { sum.stuck++; throw new Error("卡住了 phase=" + st.phase + " ch=" + st.chapter + " round=" + st.round); }
    if (st.phase === "story") { assert(Core.apply(st, "p0", { t: "go" }) === null, "go 失敗"); continue; }
    if (st.phase === "perk") {
      Core.teachers(st).forEach(function (h) { if (!st.perkPicked[h.seat]) Core.apply(st, h.ctrl, { t: "perk", s: h.seat, k: st.perkOpts[h.seat][0] }); });
      continue;
    }
    var h = Core.active(st).filter(function (x) { return !x.done; })[0];
    assert(h, "play 階段卻沒有可以行動的老師");
    var a = botAction(Core, D, st, h.seat, { Fight: Fight, skill: SKILL });
    var err = Core.apply(st, h.ctrl, a);
    if (err) assert(Core.apply(st, h.ctrl, { t: "end", s: h.seat, on: true }) === null, "end 失敗：" + err);
    check(st);
  }
  sum.byN[n] = sum.byN[n] || { win: 0, lose: 0 };
  sum.byN[n][st.phase]++;
  sum[st.phase]++;
  sum.ch[st.chapter]++;
  if (st.loseWhy) sum.why[st.loseWhy] = (sum.why[st.loseWhy] || 0) + 1;
}

try { errorCodes(); console.log("錯誤代碼檢查 OK"); } catch (e) { fails++; console.error("錯誤代碼檢查失敗：", e.stack); }
for (var g = 0; g < games; g++) {
  try { playOne(g); } catch (e) { fails++; if (fails < 6) console.error("第 " + g + " 局：", e.stack); }
}
console.log(JSON.stringify(sum));
console.log(fails ? "FAIL " + fails : "OK " + games + " 局");
process.exit(fails ? 1 : 0);
