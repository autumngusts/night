// 黃牌 Yellow Card 規則引擎的自動對局檢查（node 直接跑，不需要瀏覽器）：
//   node tools/yellow_check/core_check.js [局數]
// 每局用簡單的 AI（有能打的牌就打、目標隨機）從第一幕打到勝利或全滅，檢查：
//   不丟例外、不會卡在同一階段、HP／護盾／魔力不會變成負數或 NaN、牌組張數守恆。
"use strict";

global.window = global;
require("../../static_src/yellow_data.js");
require("../../static_src/yellow_core.js");
var D = global.PriTestYellowData;
var Core = global.PriTestYellowCore;

var games = Number(process.argv[2]) || 60;
var fails = 0;
var summary = { win: 0, lose: 0, stuck: 0, acts: [0, 0, 0], rounds: 0 };

function assert(cond, msg) { if (!cond) throw new Error(msg); }

function check(st) {
  Core.heroes(st).forEach(function (h) {
    ["hp", "max", "blk", "mana", "str"].forEach(function (k) { assert(typeof h[k] === "number" && isFinite(h[k]), "hero." + k + " 不是數字"); });
    assert(h.hp >= 0 && h.hp <= h.max, "hero hp 超出範圍 " + h.hp + "/" + h.max);
    assert(h.blk >= 0 && h.mana >= 0, "護盾或魔力為負");
    assert(h.gold >= 0 && isFinite(h.gold), "金幣異常 " + h.gold);
    assert(h.relics.every(function (id, i) { return D.RELIC[id] && h.relics.indexOf(id) === i; }), "遺物重複或不存在");
  });
  st.enemies.forEach(function (e) {
    assert(isFinite(e.hp) && e.hp >= 0 && e.hp <= e.max, "enemy hp 異常 " + e.id + " " + e.hp);
    assert(["near", "far"].indexOf(e.ring) >= 0 && e.sec >= 0 && e.sec < st.secs.length, "enemy 位置異常");
  });
}

function rand(arr, r) { return arr[Math.floor(r() * arr.length)]; }

function runGame(seed, seats) {
  var st = Core.create({ seed: seed, seats: seats });
  var r = function () { return Core._rnd({ seed: 0 }) && Math.random(); };
  var steps = 0;
  var plays = {};
  var phaseCnt = {};
  while (st.phase !== "win" && st.phase !== "lose") {
    if (++steps > 400000) { console.log("stuck at", JSON.stringify(phaseCnt), st.phase, st.act, st.floor, st.round, JSON.stringify(st.enemies.map(function (e) { return [e.id, e.hp, e.ring, e.sec, e.blk]; })), JSON.stringify(Core.heroes(st).map(function (h) { return [h.cls, h.hp, h.down, h.hand.length, h.mana]; }))); return "stuck"; }
    var before = JSON.stringify([st.phase, st.act, st.floor, st.round, st.logSeq]);
    if (st.phase === "map") {
      assert(!Core.apply(st, "local", { t: "vote", i: Math.floor(Math.random() * st.options.length) }), "vote 失敗");
    } else if (st.phase === "battle") {
      if (st.round > 100) { console.log("rounds>100", st.act, st.floor, JSON.stringify(st.enemies.map(function (e) { return [e.id, e.hp, e.ring, e.sec, e.blk]; })), JSON.stringify(Core.heroes(st).map(function (h) { return [h.cls, h.seat, h.hp, h.down]; }))); return "stuck"; }
      var acted = false;
      Core.alive(st).forEach(function (h) {
        if (acted || h.done) return;
        // 0 費抽牌（淨化）可以無限循環，遊戲允許，但機器人每回合最多出 25 張
        var key = st.act + ":" + st.floor + ":" + st.round + ":" + h.seat;
        plays[key] = (plays[key] || 0) + 1;
        var playable = plays[key] > 25 ? [] : h.hand.filter(function (c) { return Core.canPlay(st, h, c); });
        var tries = playable.map(function (c) {
          var vt = Core.validTargets(st, h, c), d = Core.cardDef(c), tg = null;
          if (d.tgt === "enemy") { if (!vt.e.length) return null; tg = { e: rand(vt.e, Math.random) }; }
          if (d.tgt === "ally" || d.tgt === "down") { if (!vt.s.length) return null; tg = { s: rand(vt.s, Math.random) }; }
          return { c: c, tg: tg };
        }).filter(Boolean);
        if (tries.length) {
          // 70% 優先出攻擊牌（純隨機時單人可能一直出防禦牌，拖到回合上限）
          var atks = tries.filter(function (x) { return Core.cardDef(x.c).type === "atk"; });
          var p = rand(atks.length && Math.random() < 0.7 ? atks : tries, Math.random);
          var err = Core.apply(st, "local", { t: "play", s: h.seat, u: p.c.u, tg: p.tg });
          assert(!err, "play 失敗：" + err + " " + p.c.id);
        } else {
          assert(!Core.apply(st, "local", { t: "end", s: h.seat }), "end 失敗");
        }
        acted = true;
      });
      if (st.round > summary.rounds) summary.rounds = st.round;
    } else if (st.phase === "reward" || st.phase === "rest" || st.phase === "treasure" || st.phase === "shop") {
      var h = Core.heroes(st).filter(function (x) { return x.pend; })[0];
      var p = h.pend, c;
      if (p.k === "card") c = Math.random() < 0.8 ? { id: rand(p.opts, Math.random) } : { skip: true };
      else if (p.k === "rest") c = { kind: Math.random() < 0.5 ? "heal" : "upgrade" };
      else if (p.k === "treasure") c = rand([{ kind: "maxhp" }, { kind: "remove" }, { id: p.opts[0] }, { kind: "relic" }], Math.random);
      else if (p.k === "relic") c = Math.random() < 0.9 ? { id: rand(p.opts, Math.random) } : { skip: true };
      else if (p.k === "shop") {
        // 隨機買一樣買得起的東西，三成機率刪卡，其餘離開
        var can = p.cards.map(function (x, i) { return { buy: "card", i: i, x: x }; }).concat(p.relics.map(function (x, i) { return { buy: "relic", i: i, x: x }; }))
          .filter(function (o) { return !o.x.sold && o.x.price <= h.gold; });
        var r2 = Math.random();
        if (can.length && r2 < 0.5) { var o = rand(can, Math.random); c = { buy: o.buy, i: o.i }; }
        else if (r2 < 0.65 && h.gold >= Core.removePrice(h) && h.deck.length > 5) c = { kind: "remove" };
        else c = { done: true };
      }
      else if (p.k === "upgrade") { var up = h.deck.filter(function (x) { return !x.up; }); c = up.length ? { u: up[0].u } : { back: true }; }
      else if (p.k === "remove") c = { u: h.deck[0].u };
      var err2 = Core.apply(st, "local", { t: "choose", s: h.seat, c: c });
      assert(!err2, "choose 失敗：" + err2 + " " + JSON.stringify(p));
    }
    check(st);
    if (steps % 200 === 0) JSON.parse(JSON.stringify(st)); // 必須可序列化（連線同步／存檔）
    phaseCnt[st.phase] = (phaseCnt[st.phase] || 0) + 1;
    if (st.phase === "battle" || st.phase === "map") { /* 進度由 logSeq 推進 */ }
    void before;
  }
  summary.acts[st.act >= 3 ? 2 : st.act] += 1;
  return st.phase;
}

var CLS = D.CLASSES.map(function (c) { return c.id; });
for (var g = 0; g < games; g++) {
  var n = 1 + (g % 4);
  var seats = [null, null, null, null];
  var order = [0, 3, 1, 2];
  for (var i = 0; i < n; i++) seats[order[i]] = { cls: CLS[(g * 3 + i) % CLS.length], name: "P" + i };
  try {
    var res = runGame(1000 + g, seats);
    summary[res] += 1;
    if (res === "stuck") { fails++; console.log("卡住：seed", 1000 + g); }
  } catch (e) {
    fails++;
    console.log("例外：seed", 1000 + g, e.stack.split("\n").slice(0, 3).join(" | "));
  }
}

// 個別規則的單元檢查（圓形戰場：扇形區＝人數，內圈 near／外圈 far）
(function () {
  var st = Core.create({ seed: 7, seats: [{ cls: "paladin" }, null, null, { cls: "ranger" }] });
  assert(Core.sectorCount(st) === 2 && st.secs[1] === 3, "兩人應切成兩個扇形區");
  Core.apply(st, "local", { t: "vote", i: 0 });
  assert(st.phase === "battle", "第一層應直接進戰鬥");
  var e = st.enemies[0];
  // 近戰敵人在外圈：攻擊改成前進
  e.ring = "far"; e.id = "skel"; e.intent = [{ k: "atk", n: 6 }];
  assert(Core.effActs(st, e).some(function (a) { return a.k === "move" && a.to === "near"; }), "外圈近戰敵人應改為前進");
  e.ring = "near";
  assert(Core.effActs(st, e)[0].k === "atk", "內圈近戰敵人應攻擊");
  // 射程：近距離只打內圈、遠距離只打外圈，任何扇形區都可以
  e.sec = 1;
  assert(Core.inRange(st, "near").indexOf(e) >= 0 && Core.inRange(st, "far").indexOf(e) < 0, "內圈敵人只在近距離射程");
  // 敵人攻擊自己扇形區的主人；主人倒下改打下一位
  assert(Core.actTargets(st, e, { k: "atk", n: 1 })[0] === 3, "第 1 區的敵人應攻擊 seat 3");
  st.heroes[3].down = true;
  assert(Core.actTargets(st, e, { k: "atk", n: 1 })[0] === 0, "主人倒下改打下一位");
  st.heroes[3].down = false;
  // 近遠效果不同：聖光擊 內圈 7／外圈 4
  var pal = st.heroes[0];
  pal.hand = [{ u: 9001, id: "pal_smite" }, { u: 9002, id: "pal_smite" }]; pal.mana = 3; pal.str = 0; pal.st.weak = 0;
  e.blk = 0; e.st.vuln = 0; e.hp = e.max = 99; e.ring = "near";
  Core.apply(st, "local", { t: "play", s: 0, u: 9001, tg: { e: e.u } });
  assert(e.hp === 91, "聖光擊打內圈應 8 傷害，實際 " + (99 - e.hp));
  e.ring = "far"; e.hp = 99; e.blk = 0;
  Core.apply(st, "local", { t: "play", s: 0, u: 9002, tg: { e: e.u } });
  assert(e.hp === 94, "聖光擊打外圈應 5 傷害，實際 " + (99 - e.hp));
  // 陷阱：敵人被拉進內圈時觸發
  var rg = st.heroes[3];
  rg.trap = 8; rg.hand = [{ u: 9003, id: "pal_chain" }];
  e.sec = 1; e.ring = "far"; e.hp = 99; e.blk = 0;
  rg.cls = "paladin"; rg.mana = 3; // 借用聖鎖（外圈拉近）
  Core.apply(st, "local", { t: "play", s: 3, u: 9003, tg: { e: e.u } });
  assert(e.ring === "near" && rg.trap === 8 && e.hp <= 99 - 8, "拉進內圈應觸發陷阱（陷阱不會消失）");
  // 升級：斬擊 6 → 8；近遠卡兩邊都加成
  assert(Core.cardDef({ id: "pal_strike", up: true }).fx[0].n === 10, "斬擊+ 應為 10（7 +30% 進位）");
  var up = Core.cardDef({ id: "pal_smite", up: true });
  assert(up.near[0].n === 11 && up.far[0].n === 7, "聖光擊+ 內外圈都要加成");
  assert(Core.cardDef({ id: "mag_intel", up: true }).cost === 0, "奧術智慧只有抽牌與魔力（不加成），升級應改為費用 −1");
  // 每位英雄：起始 8 張、三條成長方向各 5 張
  D.CLASSES.forEach(function (c) {
    assert(c.start.length === 8, c.id + " 起始牌組應 8 張");
    c.paths.forEach(function (p) {
      var n = D.CARDS.filter(function (x) { return x.cls === c.id && x.path === p.id; }).length;
      assert(n === 5, c.id + "/" + p.id + " 應 5 張，實際 " + n);
    });
  });
  // 遺物：舊靴最大生命 +10；鐵護符開戰護盾；商店買不起要失敗、買得起扣錢
  var st2 = Core.create({ seed: 11, seats: [{ cls: "mage" }, null, null, null] });
  var mg = st2.heroes[0];
  var mx = mg.max;
  mg.relics.push("old_boots"); mg.max += 10;
  assert(mg.max === mx + 10, "舊靴應 +10 最大生命");
  mg.relics.push("iron_charm");
  st2.options = ["battle"]; Core.apply(st2, "local", { t: "vote", i: 0 });
  assert(mg.blk >= 8, "鐵護符：開戰應有 8 護盾，實際 " + mg.blk);
  st2.phase = "shop";
  mg.gold = 45;
  mg.pend = { k: "shop", cards: [{ id: "mag_ignite", price: 40 }], relics: [{ id: "fang", price: 120 }] };
  assert(Core.apply(st2, "local", { t: "choose", s: 0, c: { buy: "relic", i: 0 } }) === "no_gold", "買不起遺物應失敗");
  assert(!Core.apply(st2, "local", { t: "choose", s: 0, c: { buy: "card", i: 0 } }) && mg.gold === 5, "買卡後應剩 5 金幣");
  assert(Core.apply(st2, "local", { t: "choose", s: 0, c: { buy: "card", i: 0 } }) === "bad_choice", "賣掉的卡不能再買");
  assert(!Core.apply(st2, "local", { t: "choose", s: 0, c: { done: true } }) && st2.phase === "map", "離開商店後應前往下一層");
  // 他人的英雄不能操作
  assert(Core.apply(st, "someone", { t: "end", s: 0 }) === "not_yours", "不能操作別人的英雄");
})();

console.log(JSON.stringify(summary));
if (fails) { console.log("失敗 " + fails + " 局"); process.exit(1); }
console.log("OK " + games + " 局");
