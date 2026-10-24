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
    assert(h.gold === undefined, "已經沒有金幣（2026-10-23 拿掉商店與金幣）");
    assert(h.relics.every(function (id, i) { return D.RELIC[id] && h.relics.indexOf(id) === i; }), "遺物重複或不存在");
  });
  st.enemies.forEach(function (e) {
    assert(isFinite(e.hp) && e.hp >= 0 && e.hp <= e.max, "enemy hp 異常 " + e.id + " " + e.hp);
    assert(["near", "far"].indexOf(e.ring) >= 0 && e.sec >= 0 && e.sec < st.secs.length, "enemy 位置異常");
  });
}

// 把敵人都打到剩 1 血、一擊就能清場（測試獎勵流程用）。
// 2026-10-23 加入「分裂」的敵人（倒下時生出小怪，戰鬥不會馬上結束），所以先換成不會分裂的骷髏兵
function weakenAll(st) {
  st.enemies.forEach(function (e) { if (D.ENEMY[e.id].split) e.id = "skel"; e.hp = 1; e.blk = 0; });
}
function rand(arr, r) { return arr[Math.floor(r() * arr.length)]; }
// 全員選目的地（依序選 want 裡第一個有的，沒有就選第一個）
function goFloor(st, want) {
  Core.heroes(st).forEach(function (h) {
    var i = want ? h.dests.indexOf(want) : -1;
    if (i < 0) i = 0;
    Core.apply(st, "local", { t: "dest", s: h.seat, i: i });
  });
}

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
      var hm = Core.heroes(st).filter(function (x) { return !x.dest; })[0];
      assert(!Core.apply(st, "local", { t: "dest", s: hm.seat, i: Math.floor(Math.random() * hm.dests.length) }), "dest 失敗");
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
          // 指定範圍卡：範圍圈放在隨機一個可打的敵人身上
          if (d.tgt === "area") { if (!vt.e.length) return null; var ps = Core.layout(st).e[rand(vt.e, Math.random)]; tg = { x: ps.x, y: ps.y }; }
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
    } else if (st.phase === "reward") {
      var h = Core.heroes(st).filter(function (x) { return x.pend; })[0];
      var p = h.pend, c;
      if (p.k === "card") c = Math.random() < 0.8 ? { id: rand(p.opts, Math.random) } : { skip: true };
      else if (p.k === "rest") c = { kind: Math.random() < 0.5 ? "heal" : "upgrade" };
      else if (p.k === "altar") c = rand([{ kind: "accept" }, { kind: "accept" }, { skip: true }], Math.random);
      else if (p.k === "sanctum") c = rand([{ kind: "perk" }, { id: p.opts[0] }, { skip: true }], Math.random);
      else if (p.k === "relic") c = Math.random() < 0.9 ? { id: rand(p.opts, Math.random) } : { skip: true };
      else if (p.k === "upgrade") { var up = h.deck.filter(function (x) { return !x.up; }); c = up.length ? { u: up[0].u } : { back: true }; }
      else if (p.k === "remove") c = h.deck.length > 5 ? { u: h.deck[0].u } : { back: true };
      var err2 = Core.apply(st, "local", { t: "choose", s: h.seat, c: c });
      // 祭壇：牌組只剩 5 張不能刪、最大生命不夠不能獻 → 改成跳過
      if (err2 === "bad_choice" && (p.k === "altar" || p.k === "sanctum")) err2 = Core.apply(st, "local", { t: "choose", s: h.seat, c: { skip: true } });
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
  goFloor(st);
  assert(st.phase === "battle", "全員選好目的地後應進戰鬥");
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
  // 每位英雄：起始 8 張、三條成長方向各至少 5 張（2026-10-22 新增指定範圍卡後部分方向為 6 張）
  D.CLASSES.forEach(function (c) {
    assert(c.start.length === 8, c.id + " 起始牌組應 8 張");
    c.paths.forEach(function (p) {
      var n = D.CARDS.filter(function (x) { return x.cls === c.id && x.path === p.id; }).length;
      assert(n >= 5, c.id + "/" + p.id + " 應至少 5 張，實際 " + n);
    });
  });
  // 遺物：舊靴最大生命 +10；鐵護符開戰護盾
  var st2 = Core.create({ seed: 11, seats: [{ cls: "mage" }, null, null, null] });
  var mg = st2.heroes[0];
  var mx = mg.max;
  mg.relics.push("old_boots"); mg.max += 10;
  assert(mg.max === mx + 10, "舊靴應 +10 最大生命");
  mg.relics.push("iron_charm");
  goFloor(st2);
  assert(mg.blk >= 8, "鐵護符：開戰應有 8 護盾，實際 " + mg.blk);
  // 祭壇（2026-10-23 分成 5 種）：血之祭壇＝獻上最大生命換遺物（不夠不能獻）
  st2.phase = "reward";
  mg.pend = { k: "altar", a: "blood", relic: "fang" };
  var mx2 = mg.max;
  assert(!Core.apply(st2, "local", { t: "choose", s: 0, c: { kind: "accept" } }) && mg.max === mx2 - D.ALTAR_HP && mg.relics.indexOf("fang") >= 0, "血之祭壇：獻上最大生命換遺物");
  assert(st2.phase === "map", "選完後前往下一層");
  st2.phase = "reward";
  mg.pend = { k: "altar", a: "blood", relic: "thorn_ring" };
  var keepMax = mg.max;
  mg.max = D.ALTAR_HP; mg.hp = Math.min(mg.hp, mg.max);
  assert(Core.apply(st2, "local", { t: "choose", s: 0, c: { kind: "accept" } }) === "bad_choice", "最大生命不夠不能獻");
  Core.apply(st2, "local", { t: "choose", s: 0, c: { skip: true } });
  mg.max = keepMax; mg.hp = keepMax;
  // 淨化祭壇：最多移除兩張（第二張可以不刪）；刪卡可以返回祭壇
  st2.phase = "reward";
  mg.pend = { k: "altar", a: "purify" };
  var deckN = mg.deck.length;
  assert(!Core.apply(st2, "local", { t: "choose", s: 0, c: { kind: "accept" } }) && mg.pend.k === "remove", "淨化祭壇：選刪卡");
  assert(!Core.apply(st2, "local", { t: "choose", s: 0, c: { back: true } }) && mg.pend.k === "altar" && mg.pend.a === "purify", "刪卡可以返回祭壇");
  Core.apply(st2, "local", { t: "choose", s: 0, c: { kind: "accept" } });
  assert(!Core.apply(st2, "local", { t: "choose", s: 0, c: { u: mg.deck[0].u } }) && mg.deck.length === deckN - 1 && mg.pend && mg.pend.k === "remove", "淨化祭壇：刪完一張還能再刪一張");
  assert(!Core.apply(st2, "local", { t: "choose", s: 0, c: { u: mg.deck[0].u } }) && mg.deck.length === deckN - 2 && !mg.pend, "淨化祭壇：最多兩張");
  // 交換祭壇：刪一張換最大生命
  st2.phase = "reward";
  mg.pend = { k: "altar", a: "trade" };
  var mx3 = mg.max;
  Core.apply(st2, "local", { t: "choose", s: 0, c: { kind: "accept" } });
  assert(!Core.apply(st2, "local", { t: "choose", s: 0, c: { u: mg.deck[0].u } }) && mg.max === mx3 + D.ALTAR_NUM.trade, "交換祭壇：最大生命 +" + D.ALTAR_NUM.trade);
  // 戰神祭壇：現在失去生命，下一場開戰力量 +3；契約祭壇：下一場魔力不夠改付生命
  st2.phase = "reward";
  mg.pend = { k: "altar", a: "war" };
  var hp3 = mg.hp;
  assert(!Core.apply(st2, "local", { t: "choose", s: 0, c: { kind: "accept" } }) && mg.hp === hp3 - D.ALTAR_NUM.war && mg.nextB.str === D.ALTAR_NUM.warStr, "戰神祭壇");
  st2.phase = "reward";
  mg.pend = { k: "altar", a: "pact" };
  assert(!Core.apply(st2, "local", { t: "choose", s: 0, c: { kind: "accept" } }) && mg.nextB.blood === D.ALTAR_NUM.pact && mg.nextB.str === D.ALTAR_NUM.warStr + 1, "契約祭壇（與戰神的力量疊加）");
  goFloor(st2);
  assert(mg.str >= D.ALTAR_NUM.warStr + 1 && !mg.nextB && mg.pw.bloodMana === D.ALTAR_NUM.pact, "祭壇的效果延續到下一場戰鬥，開戰後清掉");
  mg.mana = 0; mg.hp = mg.max;
  var pu = (st2.uid += 1);
  mg.hand.push({ u: pu, id: "pal_defend" });
  var hpB = mg.hp;
  assert(Core.canPlay(st2, mg, mg.hand[mg.hand.length - 1]) && !Core.apply(st2, "local", { t: "play", s: 0, u: pu, tg: null }) && mg.hp === hpB - D.CARD.pal_defend.cost * D.ALTAR_NUM.pact, "契約：魔力不夠改付生命");
  // 指定範圍卡（tgt:"area"）：判定圓與範圍圈重疊且在射程內的敵人才會被打到
  var st3 = Core.create({ seed: 21, seats: [{ cls: "mage" }, { cls: "ranger" }, null, null] });
  goFloor(st3);
  var mg3 = st3.heroes[0];
  st3.enemies = st3.enemies.slice(0, 1);
  var a = st3.enemies[0], b = JSON.parse(JSON.stringify(a));
  b.u = 7777; a.id = b.id = "skel"; a.sec = b.sec = 0; a.ring = "near"; b.ring = "far";
  a.hp = a.max = b.hp = b.max = 99; a.blk = b.blk = 0; a.st.vuln = b.st.vuln = 0;
  st3.enemies.push(b);
  mg3.mana = 9; mg3.str = 0; mg3.st.weak = 0;
  var pos3 = Core.layout(st3).e;
  assert(Math.abs(pos3[a.u].r - D.ENEMY_R.m) < 1e-9, "骷髏兵應為中體型");
  assert(Core.layout(Object.assign({}, st3, { enemies: [{ u: 1, id: "giant", sec: 0, ring: "far" }] })).e[1].r === D.ENEMY_R.boss, "Boss 判定圓應最大");
  mg3.hand = [{ u: 9101, id: "mag_firebomb" }, { u: 9102, id: "mag_firebomb" }, { u: 9103, id: "mag_firebomb" }];
  // 放在戰場外、放在沒有敵人的地方：都不能出牌
  assert(Core.apply(st3, "local", { t: "play", s: 0, u: 9101, tg: { x: 0, y: 0 } }) === "bad_target", "範圍圈放在戰場外應失敗");
  assert(Core.apply(st3, "local", { t: "play", s: 0, u: 9101, tg: { x: 50, y: 95 } }) === "bad_target", "範圍圈內沒有敵人應失敗");
  assert(Core.apply(st3, "local", { t: "play", s: 0, u: 9101, tg: null }) === "bad_target", "沒有位置應失敗");
  assert(mg3.mana === 9 && mg3.hand.length === 3, "失敗時不扣魔力也不丟牌");
  // 放在內圈敵人正上方：只打到內圈那隻（外圈那隻距離 15.5 > 10 + 1.9）
  assert(!Core.apply(st3, "local", { t: "play", s: 0, u: 9101, tg: { x: pos3[a.u].x, y: pos3[a.u].y } }), "範圍圈放在敵人身上應成功");
  assert(a.hp === 90 && b.hp === 99, "火焰炸彈只應打到圈內的敵人，實際 " + a.hp + "/" + b.hp);
  assert(a.st.burn > 0 && !b.st.burn, "燃燒也只施加在圈內");
  // 放在兩隻中間：兩隻都打到
  var mx3 = (pos3[a.u].x + pos3[b.u].x) / 2, my3 = (pos3[a.u].y + pos3[b.u].y) / 2;
  assert(!Core.apply(st3, "local", { t: "play", s: 0, u: 9102, tg: { x: mx3, y: my3 } }), "放在兩隻中間應成功");
  assert(a.hp === 81 && b.hp === 90, "兩隻都應受到 9 傷害，實際 " + a.hp + "/" + b.hp);
  // 射程：遊俠爆裂箭（遠距離限定）放在內圈敵人身上，圈內沒有外圈敵人 → 不能出牌
  var rg3 = st3.heroes[1];
  rg3.mana = 3; rg3.str = 0; rg3.pw = {}; rg3.st.weak = 0; rg3.hand = [{ u: 9104, id: "ran_blast" }];
  pos3 = Core.layout(st3).e;
  assert(Core.apply(st3, "local", { t: "play", s: 1, u: 9104, tg: { x: pos3[a.u].x, y: pos3[a.u].y } }) === "bad_target", "遠距離限定的範圍卡不應打到內圈");
  assert(!Core.apply(st3, "local", { t: "play", s: 1, u: 9104, tg: { x: pos3[b.u].x, y: pos3[b.u].y } }) && b.hp === 83, "爆裂箭打外圈應 7 傷害，實際 " + b.hp);
  var lastPlay = st3.log.filter(function (x) { return x.t === "play"; }).pop();
  assert(typeof lastPlay.x === "number" && lastPlay.ar === "s", "指定範圍卡的紀錄要記下範圍圈位置");
  // 敵人攻擊的傷害紀錄要有出手者（畫面畫彈道用）
  var st4 = Core.create({ seed: 5, seats: [{ cls: "paladin" }, null, null, null] });
  goFloor(st4);
  st4.enemies.forEach(function (x) { x.ring = "near"; x.st.stun = 0; x.intent = [{ k: "atk", n: 30 }]; });
  Core.apply(st4, "local", { t: "end", s: 0 });
  assert(st4.log.some(function (x) { return x.t === "dmg" && x.to.k === "h" && x.src && x.src.k === "e"; }), "敵人攻擊的傷害紀錄應帶 src");

  // 冒險結構（Hellcard 式）：3 幕 × 4 層＝12 層，每幕最後一層是 Boss
  assert(D.ACTS.length * D.FLOORS.length === 12 && D.FLOORS.filter(function (f) { return f === "boss"; }).length === 1, "應為 12 層、3 場 Boss 戰");
  // 每位英雄各自從兩個目的地選；自己扇形區的敵人依目的地變化；選好前不開戰
  var st5 = Core.create({ seed: 33, seats: [{ cls: "paladin" }, { cls: "mage" }, null, null] });
  var p0 = st5.heroes[0], p1 = st5.heroes[1];
  assert(p0.dests.length === 2 && p0.dests[0] !== p0.dests[1], "每位英雄應有兩個不同的目的地");
  p0.dests = ["elite", "camp"]; p1.dests = ["camp", "smithy"];
  Core.apply(st5, "local", { t: "dest", s: 0, i: 0 });
  assert(st5.phase === "map", "還有英雄沒選時不應開戰");
  assert(Core.apply(st5, "local", { t: "dest", s: 1, i: 5 }) === "bad_vote", "不存在的目的地應失敗");
  Core.apply(st5, "local", { t: "dest", s: 1, i: 0 });
  assert(st5.phase === "battle", "全員選好應開戰");
  var sec0 = st5.enemies.filter(function (e) { return e.sec === Core.secOf(st5, 0); });
  assert(sec0.length === 1 && D.ENEMY[sec0[0].id].elite, "選菁英的英雄那一區應是菁英");
  assert(st5.enemies.filter(function (e) { return e.sec === Core.secOf(st5, 1); }).every(function (e) { return !D.ENEMY[e.id].elite; }), "選營火的區不應有菁英");
  // 打贏：只領目的地的獎勵（2026-10-23 仿 Hellcard，不再固定選卡）：菁英＝遺物＋選卡、營火＝休息
  var relics0 = p0.relics.length;
  weakenAll(st5);
  p0.hand = [{ u: 9501, id: "pri_doom" }]; p0.mana = 3; p0.str = 99;
  Core.apply(st5, "local", { t: "play", s: 0, u: 9501, tg: null });
  assert(st5.phase === "reward", "清光敵人應進入戰利品");
  assert(p0.relics.length === relics0 + 1 && p0.pend.k === "card" && !p0.queue.length, "菁英：得到遺物，再選卡");
  assert(p1.pend.k === "rest" && !p1.queue.length, "營火：只有休息，沒有選卡");
  Core.apply(st5, "local", { t: "choose", s: 0, c: { skip: true } });
  Core.apply(st5, "local", { t: "choose", s: 1, c: { kind: "heal" } });
  assert(st5.phase === "map" && st5.floor === 1, "全員選完應前往下一層");
  // 鍛造所的升級可以跳過
  p0.pend = { k: "upgrade" }; st5.phase = "reward";
  assert(!Core.apply(st5, "local", { t: "choose", s: 0, c: { back: true } }) && !p0.pend, "目的地的升級可以跳過");
  // 各目的地的獎勵：戰利品＝卡三選一、寶物庫＝遺物三選一、鍛造所＝升級兩張、祭壇＝刪卡或獻生命
  ["spoils", "treasure", "smithy", "altar", "sanctum"].forEach(function (dk) {
    var sd = Core.create({ seed: 34, seats: [{ cls: "paladin" }, null, null, null] });
    var hd = sd.heroes[0];
    hd.dests = [dk, "camp"];
    Core.apply(sd, "local", { t: "dest", s: 0, i: 0 });
    weakenAll(sd);
    hd.hand = [{ u: 9601, id: "pri_doom" }]; hd.mana = 3; hd.str = 99;
    Core.apply(sd, "local", { t: "play", s: 0, u: 9601, tg: null });
    var ks = [hd.pend && hd.pend.k].concat(hd.queue.map(function (q) { return q.k; })).join(",");
    var want = { spoils: "card", treasure: "relic", smithy: "upgrade,upgrade", altar: "altar", sanctum: "sanctum" }[dk];
    assert(ks === want, dk + " 的獎勵應為 " + want + "，實際 " + ks);
    if (dk === "spoils") assert(hd.pend.opts.length === 3, "戰利品三選一");
    if (dk === "treasure") assert(hd.pend.opts.length === 3, "寶物庫遺物三選一");
    if (dk === "altar") assert(D.ALTAR[hd.pend.a], "祭壇有種類");
    if (dk === "sanctum") {
      assert(hd.pend.opts.length === 2 && hd.pend.opts.every(function (id) { return D.CARD[id].cls === "paladin" && D.CARD[id].rar === "rare"; }), "職業聖地：兩張本職業稀有卡");
      assert(!Core.apply(sd, "local", { t: "choose", s: 0, c: { kind: "perk" } }) && hd.perk === 1, "職業聖地：強化被動");
      goFloor(sd);
      assert(hd.pw.plate === D.CLASS.paladin.passive.n + D.CLASS.paladin.perk, "聖戰士被動 3 → 5");
    }
  });

  // ---- 2026-10-23 Hellcard 差異補完 ----
  // #1 倒下的英雄戰後不會自動復活；有人倒下時選項一定有復活神殿，選了打贏就復活
  var rv = Core.create({ seed: 41, seats: [{ cls: "paladin" }, { cls: "mage" }, null, null] });
  goFloor(rv, "spoils");
  var dead = rv.heroes[1];
  dead.hp = 1; Core.apply(rv, "local", { t: "end", s: 1 });
  dead.hp = 0; dead.down = true; dead.done = true;
  weakenAll(rv);
  var ru = (rv.uid += 1);
  rv.heroes[0].hand = [{ u: ru, id: "pri_doom" }]; rv.heroes[0].mana = 3; rv.heroes[0].str = 99;
  Core.apply(rv, "local", { t: "play", s: 0, u: ru, tg: null });
  assert(dead.down && !dead.pend, "一般戰鬥打贏不會自動復活，倒下的英雄沒有獎勵");
  while (rv.heroes[0].pend) Core.apply(rv, "local", { t: "choose", s: 0, c: { skip: true, back: true } });
  assert(rv.phase === "map" && dead.dest === "fallen" && rv.heroes[0].dests.indexOf("shrine") >= 0, "有人倒下：選項有復活神殿、倒下的英雄不用選");
  goFloor(rv, "shrine");
  assert(rv.phase === "battle" && dead.down && dead.done && !dead.hand.length, "倒下的英雄不參戰");
  weakenAll(rv);
  ru = (rv.uid += 1);
  rv.heroes[0].hand = [{ u: ru, id: "pri_doom" }]; rv.heroes[0].mana = 3; rv.heroes[0].str = 99;
  Core.apply(rv, "local", { t: "play", s: 0, u: ru, tg: null });
  assert(!dead.down && dead.hp === Math.ceil(dead.max * D.SHRINE_PCT / 100), "復活神殿：以 " + D.SHRINE_PCT + "% 生命復活");

  // #2 局外進度：等級不夠的卡不會出現在獎勵；出發遺物
  var lockN = D.CARDS.filter(function (c) { return c.lv; }).length;
  assert(lockN === D.CLASSES.length * 3 * 4, "每條方向有 4 張要解鎖的卡，實際 " + lockN);
  var lk = Core.create({ seed: 42, seats: [{ cls: "mage", lv: 0, art: "iron_charm" }, null, null, null] });
  assert(lk.heroes[0].relics.indexOf("iron_charm") >= 0, "出發遺物");
  assert(Core.create({ seed: 42, seats: [{ cls: "mage", art: "crown" }, null, null, null] }).heroes[0].relics.length === 0, "不在出發清單上的遺物不能帶");
  for (var li = 0; li < 40; li++) {
    lk.heroes[0].dests = ["spoils", "camp"]; lk.heroes[0].dest = null; lk.phase = "map";
    Core.apply(lk, "local", { t: "dest", s: 0, i: 0 });
    weakenAll(lk);
    var lu = (lk.uid += 1);
    lk.heroes[0].hand = [{ u: lu, id: "pri_doom" }]; lk.heroes[0].mana = 3; lk.heroes[0].str = 99;
    Core.apply(lk, "local", { t: "play", s: 0, u: lu, tg: null });
    assert(lk.heroes[0].pend.opts.every(function (id) { return !D.CARD[id].lv; }), "Lv0 的獎勵不會有要解鎖的卡");
    Core.apply(lk, "local", { t: "choose", s: 0, c: { skip: true } });
    lk.floor = 0;
  }

  // #5 無盡模式的苦痛修正：第四幕起每 2 層三選一，選完才開戰；持續的層數過了就消失
  var tmS = Core.create({ seed: 43, seats: [{ cls: "paladin" }, null, null, null], endless: true });
  tmS.act = 3; tmS.floor = 0;
  tmS.phase = "reward"; tmS.heroes[0].pend = null;
  tmS.floor = -1; Core.apply(tmS, "local", { t: "choose", s: 0, c: { skip: true } });
  tmS.heroes[0].pend = { k: "relic", opts: ["fang"] };
  Core.apply(tmS, "local", { t: "choose", s: 0, c: { skip: true } });
  assert(tmS.phase === "map" && tmS.floor === 0 && tmS.tmodPick && tmS.tmodPick.length === 3, "第四幕第 1 層：苦痛修正三選一");
  Core.apply(tmS, "local", { t: "dest", s: 0, i: 0 });
  assert(tmS.phase === "map", "還沒選苦痛修正不會開戰");
  var pick0 = tmS.tmodPick[0];
  assert(Core.apply(tmS, "nobody", { t: "tmod", i: 0 }) === "not_yours", "不在隊伍裡的人不能選");
  assert(!Core.apply(tmS, "local", { t: "tmod", i: 0 }) && tmS.phase === "battle" && tmS.tmods.length === 1, "選完苦痛修正就開戰");
  assert(Core.tmodVal(tmS, pick0.id) === D.TMOD[pick0.id].n * pick0.pw, "苦痛修正的效果值");

  // #6 影響隊友的遺物：單人不會出現；三枚貝殼；守護戒指
  var solo = Core.create({ seed: 44, seats: [{ cls: "paladin" }, null, null, null] });
  for (var si = 0; si < 60; si++) {
    solo.heroes[0].dests = ["treasure", "camp"]; solo.heroes[0].dest = null; solo.phase = "map";
    Core.apply(solo, "local", { t: "dest", s: 0, i: 0 });
    weakenAll(solo);
    var su = (solo.uid += 1);
    solo.heroes[0].hand = [{ u: su, id: "pri_doom" }]; solo.heroes[0].mana = 3; solo.heroes[0].str = 99;
    Core.apply(solo, "local", { t: "play", s: 0, u: su, tg: null });
    var sp = solo.heroes[0].pend;
    assert(!sp || sp.opts.every(function (id) { return !D.RELIC[id].team; }), "單人不會出現影響隊友的遺物");
    if (sp) Core.apply(solo, "local", { t: "choose", s: 0, c: { id: sp.opts[0] } });
    solo.floor = 0;
  }
  var tr = Core.create({ seed: 45, seats: [{ cls: "paladin" }, { cls: "mage" }, null, null] });
  tr.heroes[0].relics.push("seashell", "guard_ring");
  goFloor(tr);
  var ally = tr.heroes[1];
  ally.hp = 20;
  var atkE = tr.enemies[0];
  tr.heroes[0].blk = 0;
  var lost = 0;
  (function () { var hp0 = tr.heroes[0].hp; Core.apply(tr, "local", { t: "end", s: 0 }); Core.apply(tr, "local", { t: "end", s: 1 }); lost = hp0 - tr.heroes[0].hp; })();
  void atkE;
  assert(tr.log.some(function (e) { return e.t === "blk" && e.to && e.to.s === 1; }) || tr.phase !== "battle", "守護戒指：隊友得到護盾");
  if (lost > 1) assert(tr.log.some(function (e) { return e.t === "heal" && e.to && e.to.s === 1; }), "三枚貝殼：隊友回復");

  // #7 鍊金術師：每打 3 張牌做出一瓶藥水；時空術士：時能每回合累積、每 3 點 +1 魔力
  var al = Core.create({ seed: 46, seats: [{ cls: "alchemist" }, null, null, null] });
  goFloor(al);
  var ah = al.heroes[0];
  al.enemies.forEach(function (e) { e.hp = e.max = 500; });
  ah.hand = []; ah.mana = 9;
  var potionsBefore = 0;
  for (var ai2 = 0; ai2 < 3; ai2++) { var au = (al.uid += 1); ah.hand.push({ u: au, id: "alc_coat" }); Core.apply(al, "local", { t: "play", s: 0, u: au, tg: null }); }
  assert(ah.hand.filter(function (c) { return D.CARD[c.id].rar === "token"; }).length === potionsBefore + 1 && ah.rg === 0, "鍊金術師：3 張牌做出一瓶藥水");
  var ch = Core.create({ seed: 47, seats: [{ cls: "chrono" }, null, null, null] });
  goFloor(ch);
  var chh = ch.heroes[0];
  ch.enemies.forEach(function (e) { e.hp = e.max = 500; e.intent = []; });
  assert(chh.flux === 1 && chh.mana === D.MANA, "時空術士：第一回合時能 1、魔力 3");
  Core.apply(ch, "local", { t: "end", s: 0 });
  ch.enemies.forEach(function (e) { e.intent = []; });
  Core.apply(ch, "local", { t: "end", s: 0 });
  assert(chh.flux === 3 && chh.mana === D.MANA + 1, "時空術士：時能 3 → 魔力 +1，實際 " + chh.flux + "/" + chh.mana);
  // 苦痛 8：卡牌獎勵只剩兩個選項
  var t8 = Core.create({ seed: 35, seats: [{ cls: "paladin" }, null, null, null], torment: 8 });
  t8.heroes[0].dests = ["spoils", "camp"];
  Core.apply(t8, "local", { t: "dest", s: 0, i: 0 });
  weakenAll(t8);
  t8.heroes[0].hand = [{ u: 9602, id: "pri_doom" }]; t8.heroes[0].mana = 3; t8.heroes[0].str = 99;
  Core.apply(t8, "local", { t: "play", s: 0, u: 9602, tg: null });
  assert(t8.heroes[0].pend.k === "card" && t8.heroes[0].pend.opts.length === 2, "苦痛 8：卡牌獎勵兩個選項");

  // ---- 新英雄的機制 ----
  function battleWith(cls, seed) {
    var sx = Core.create({ seed: seed, seats: [{ cls: cls }, { cls: "paladin" }, null, null] });
    goFloor(sx);
    sx.enemies.forEach(function (e) { e.hp = e.max = 200; e.blk = 0; e.ring = "near"; e.st = { weak: 0, vuln: 0, poison: 0, burn: 0, stun: 0 }; });
    var hx = sx.heroes[0];
    hx.mana = 20; hx.str = 0; hx.st.weak = 0;
    return { st: sx, h: hx, e: sx.enemies[0] };
  }
  function give(b, id) { b.st.uid += 1; var c = { u: b.st.uid, id: id }; b.h.hand.push(c); return c.u; }
  // 武僧：攻擊牌給氣；氣不夠時「消耗氣」的效果不發動，夠了才發動
  var m = battleWith("monk", 41);
  // 每張攻擊牌給的氣從英雄資料讀（2026-10-23 平衡調整 1 → 2）
  var chiN = D.CLASS.monk.passive.n;
  assert(m.h.pw.chiAtk === chiN && m.h.chi === 0, "武僧開戰時沒有氣");
  Core.apply(m.st, "local", { t: "play", s: 0, u: give(m, "mon_crush"), tg: { e: m.e.u } });
  assert(m.e.hp === 193 && m.h.chi === chiN, "崩拳：氣不夠時只打 7，之後獲得 " + chiN + " 氣，實際 " + m.e.hp + "/" + m.h.chi);
  m.h.chi = 3;
  Core.apply(m.st, "local", { t: "play", s: 0, u: give(m, "mon_crush"), tg: { e: m.e.u } });
  assert(m.e.hp === 179 && m.h.chi === 3 - 2 + chiN, "崩拳：消耗 2 氣再打 7，實際 " + m.e.hp + "/" + m.h.chi);
  // 德魯伊：變身、狼形打內圈 +2、姿態加成、熊形每回合護盾
  var dr = battleWith("druid", 42);
  var drawn0 = dr.h.hand.length;
  Core.apply(dr.st, "local", { t: "play", s: 0, u: give(dr, "dru_wolf"), tg: { e: dr.e.u } });
  // 狼形牌是「先變身再攻擊」：6＋狼形打內圈加成（2026-10-23 平衡調整 2 → 3，期望值改從 D.FORMS 讀）
  var wolfN = D.FORMS.wolf.n;
  assert(dr.h.form === "wolf" && dr.e.hp === 200 - (6 + wolfN) && dr.h.hand.length === drawn0 + 1, "狼形：變身後打 " + (6 + wolfN) + "、變身抽 1 張，實際 " + dr.e.hp);
  Core.apply(dr.st, "local", { t: "play", s: 0, u: give(dr, "dru_claw"), tg: { e: dr.e.u } });
  // 姿態加成的 +3 是另一段攻擊，兩段都吃狼形打內圈加成：(6+n)+(3+n)
  var hp0 = 200 - (6 + wolfN);
  assert(dr.e.hp === hp0 - (9 + 2 * wolfN), "爪擊在狼形應打 " + (9 + 2 * wolfN) + "，實際 " + (hp0 - dr.e.hp));
  dr.h.form = "bear"; dr.h.blk = 0;
  dr.st.enemies.forEach(function (e) { e.intent = [{ k: "blk", n: 0 }]; });
  dr.st.heroes[1].done = true; Core.apply(dr.st, "local", { t: "end", s: 0 });
  assert(dr.st.phase === "battle" && dr.h.blk >= D.FORMS.bear.blk, "熊形：每回合開始時護盾 " + D.FORMS.bear.blk + "，實際 " + dr.h.blk);
  // 時空術士：延遲傷害在下回合開始時才發動；回溯拿回剛打出的牌
  var ch = battleWith("chrono", 43);
  Core.apply(ch.st, "local", { t: "play", s: 0, u: give(ch, "chr_bomb"), tg: { e: ch.e.u } });
  assert(ch.e.hp === 200 && ch.h.later.length === 1, "延時炸彈當下不造成傷害");
  ch.st.enemies.forEach(function (e) { e.intent = [{ k: "blk", n: 0 }]; });
  ch.st.heroes[1].done = true; Core.apply(ch.st, "local", { t: "end", s: 0 });
  assert(ch.e.hp === 186 && ch.h.later.length === 0, "延時炸彈：下回合開始時 14 傷害，實際 " + ch.e.hp);
  ch.h.mana = 20;
  var boltU = give(ch, "chr_bolt");
  Core.apply(ch.st, "local", { t: "play", s: 0, u: boltU, tg: { e: ch.e.u } });
  Core.apply(ch.st, "local", { t: "play", s: 0, u: give(ch, "chr_loop"), tg: null });
  assert(ch.h.hand.some(function (c) { return c.u === boltU; }), "時間迴路：拿回剛打出的時之箭");
  // 鍊金術師：開戰多一瓶藥水；給隊友的藥水進隊友手牌，打出後消耗
  var al = battleWith("alchemist", 44);
  assert(al.h.hand.some(function (c) { return D.CARD[c.id].rar === "token"; }), "開戰時手牌有一瓶藥水");
  var mate = al.st.heroes[1], mateHand = mate.hand.length;
  Core.apply(al.st, "local", { t: "play", s: 0, u: give(al, "alc_pass"), tg: { s: 1 } });
  var pot = mate.hand.filter(function (c) { return c.id === "alc_p_heal"; })[0];
  assert(pot && mate.hand.length === mateHand + 1, "遞藥：隊友手牌多一瓶治療藥水");
  mate.hp = 50; mate.mana = 3;
  Core.apply(al.st, "local", { t: "play", s: 1, u: pot.u, tg: null });
  assert(mate.hp === 58 && mate.exh.some(function (c) { return c.u === pot.u; }), "治療藥水回 8 並消耗");
  // 賭徒：擲骰 2～6（幸運 +1）、下注
  var gb = battleWith("gambler", 45);
  for (var gi = 0; gi < 20; gi++) {
    var before = gb.e.hp;
    Core.apply(gb.st, "local", { t: "play", s: 0, u: give(gb, "gam_dice"), tg: { e: gb.e.u } });
    var rl = gb.st.log.filter(function (x) { return x.t === "roll"; }).pop();
    assert(rl.n >= 2 && rl.n <= 6 && before - gb.e.hp === rl.n * 2, "擲骰：骰子 2～6、傷害＝骰子×2");
    gb.e.hp = 200; gb.h.mana = 20;
  }
  // 天降橫財（沒有金幣後改成賭運）：贏了魔力 +1、抽 2，輸了抽 1
  var hand0 = gb.h.hand.length, mana0 = gb.h.mana;
  Core.apply(gb.st, "local", { t: "play", s: 0, u: give(gb, "gam_windfall"), tg: null });
  var won = gb.h.mana === mana0;  // 費用 1、贏了 +1
  assert(won ? gb.h.hand.length === hand0 + 2 : gb.h.hand.length === hand0 + 1 && gb.h.mana === mana0 - 1, "天降橫財：贏了魔力 +1 抽 2、輸了抽 1");
  // 升級會加成巢狀效果（消耗氣、延遲、姿態加成）
  assert(Core.cardDef({ id: "mon_crush", up: true }).fx[1].fx[0].n === 10, "崩拳+ 消耗氣的傷害也要加成");
  assert(Core.cardDef({ id: "chr_bomb", up: true }).fx[0].fx[0].n === 19, "延時炸彈+ 延遲傷害也要加成");
  assert(Core.cardDef({ id: "dru_claw", up: true }).forms.wolf[0].n === 4, "爪擊+ 狼形加成也要加成");

  // 每位英雄的起始牌組都要有打得到外圈的攻擊（否則單人遇到外圈的遠程敵人會打不完）
  D.CLASSES.forEach(function (c) {
    var ok = c.start.some(function (id) { var d = D.CARD[id]; return d.type === "atk" && (d.rng === "any" || d.rng === "far" || d.tgt === "area"); });
    assert(ok, c.id + " 的起始牌組打不到外圈");
  });
  // 取回操作：只有開局時的操作者可以拿回被代打的英雄
  var rc = Core.create({ seed: 77, seats: [{ cls: "paladin", ctrl: "cA" }, { cls: "mage", ctrl: "cB" }, null, null], hostCtrl: "cA" });
  assert(Core.apply(rc, "cB", { t: "reclaim", s: 1 }) === "not_yours", "自己在操作時不用取回");
  assert(!Core.apply(rc, "cA", { t: "take", s: 1 }) && rc.heroes[1].ctrl === "cA", "房主代打");
  assert(Core.apply(rc, "cX", { t: "reclaim", s: 1 }) === "not_yours", "別人不能取回");
  assert(!Core.apply(rc, "cB", { t: "reclaim", s: 1 }) && rc.heroes[1].ctrl === "cB", "原本的玩家取回");

  // ---- Hellcard 追加功能（2026-10-23） ----
  // 換區：拉到自己的區域、推到下一區、聚集；首領不會動；單人沒有效果
  var sh = Core.create({ seed: 91, seats: [{ cls: "paladin" }, { cls: "mage" }, { cls: "ranger" }, null] });
  goFloor(sh);
  var shE = sh.enemies.filter(function (e) { return e.sec !== 0; })[0];
  shE.ring = "far"; shE.hp = shE.max = 200;
  var hookU = (sh.uid += 1);
  sh.heroes[0].hand.push({ u: hookU, id: "pal_hook" }); sh.heroes[0].mana = 9;
  assert(!Core.apply(sh, "local", { t: "play", s: 0, u: hookU, tg: { e: shE.u } }), "聖光鎖鏈出牌失敗");
  assert(shE.sec === Core.secOf(sh, 0) && shE.ring === "near", "聖光鎖鏈：拉近並拉到自己的區域，實際 sec=" + shE.sec + " ring=" + shE.ring);
  var kickU = (sh.uid += 1);
  sh.heroes[2].hand.push({ u: kickU, id: "ran_kick" }); sh.heroes[2].mana = 9;
  assert(!Core.apply(sh, "local", { t: "play", s: 2, u: kickU, tg: { e: shE.u } }), "踢退出牌失敗");
  assert(shE.sec === (Core.secOf(sh, 0) + 1) % 3 && shE.ring === "far", "踢退：擊退並推到下一區，實際 sec=" + shE.sec);
  // 聚集：同一圈的敵人全部到目標的區域
  sh.enemies.forEach(function (e, i) { e.ring = "far"; e.sec = i % 3; e.hp = e.max = 200; });
  var tgt = sh.enemies[0];
  var gravU = (sh.uid += 1);
  sh.heroes[1].hand.push({ u: gravU, id: "mag_gravity" }); sh.heroes[1].mana = 9;
  assert(!Core.apply(sh, "local", { t: "play", s: 1, u: gravU, tg: { e: tgt.u } }), "引力反轉出牌失敗");
  assert(sh.enemies.every(function (e) { return e.sec === tgt.sec; }), "引力反轉：外圈的敵人都聚到目標的區域");
  // 單人：只有一區，換區沒有效果
  var solo = Core.create({ seed: 92, seats: [{ cls: "paladin" }, null, null, null] });
  goFloor(solo);
  var soloU = (solo.uid += 1);
  solo.enemies[0].ring = "far"; solo.enemies[0].hp = solo.enemies[0].max = 200;
  solo.heroes[0].hand.push({ u: soloU, id: "pal_hook" }); solo.heroes[0].mana = 9;
  assert(!Core.apply(solo, "local", { t: "play", s: 0, u: soloU, tg: { e: solo.enemies[0].u } }) && solo.enemies[0].sec === 0, "單人換區沒有效果");

  // 荊棘：沒打死就反傷（護盾先擋），打死就不會
  var th = Core.create({ seed: 93, seats: [{ cls: "berserker" }, null, null, null] });
  goFloor(th);
  th.enemies = [];
  th.uid += 1;
  var gol = { u: th.uid, id: "golem", hp: 100, max: 100, blk: 0, str: 0, st: { weak: 0, vuln: 0, poison: 0, burn: 0, stun: 0 }, sec: 0, ring: "near", pi: 0, last: -1, intent: [{ k: "blk", n: 0 }] };
  th.enemies.push(gol);
  var tb = th.heroes[0];
  tb.blk = 1; tb.mana = 9; tb.str = 0;
  var hp0 = tb.hp;
  var chopU = (th.uid += 1);
  tb.hand.push({ u: chopU, id: "ber_chop" });
  Core.apply(th, "local", { t: "play", s: 0, u: chopU, tg: { e: gol.u } });
  assert(tb.blk === 0 && tb.hp === hp0 - 2, "荊棘 3：護盾 1 先擋、扣 2 生命，實際 hp " + hp0 + "→" + tb.hp + " blk " + tb.blk);
  gol.hp = 1;
  var hp1 = tb.hp;
  var chop2 = (th.uid += 1);
  tb.hand.push({ u: chop2, id: "ber_chop" });
  Core.apply(th, "local", { t: "play", s: 0, u: chop2, tg: { e: gol.u } });
  assert(tb.hp === hp1, "打死就不會被荊棘反傷");

  // 手牌上限 10：滿了就不再抽（牌留在抽牌堆）
  var hm = Core.create({ seed: 94, seats: [{ cls: "mage" }, null, null, null] });
  goFloor(hm);
  var hh = hm.heroes[0];
  while (hh.hand.length < D.HAND_MAX) { hm.uid += 1; hh.hand.push({ u: hm.uid, id: "mag_bolt" }); }
  var drawBefore = hh.draw.length;
  hm.uid += 1; var drawU = hm.uid;
  var drawCard = D.CARDS.filter(function (c) { return c.cls === "mage" && c.fx.some(function (f) { return f.o === "draw"; }) && c.cost <= 1 && c.tgt === "self"; })[0];
  if (drawCard) {
    hh.hand[0] = { u: drawU, id: drawCard.id }; hh.mana = 9;
    Core.apply(hm, "local", { t: "play", s: 0, u: drawU, tg: null });
    assert(hh.hand.length <= D.HAND_MAX, "手牌不會超過上限，實際 " + hh.hand.length);
  }
  assert(drawBefore >= 0);

  // 苦痛等級：4 起始多一張悔恨、6 最大生命 −10%、5 營火 20%、8 金幣 −25%（只檢查有套用）
  var tm = Core.create({ seed: 95, seats: [{ cls: "paladin" }, null, null, null], torment: 6 });
  assert(tm.torment === 6 && tm.heroes[0].deck.some(function (c) { return c.id === "t_regret"; }), "苦痛 4：起始牌組有悔恨");
  assert(tm.heroes[0].max === Math.round(D.CLASS.paladin.hp * 0.9), "苦痛 6：最大生命 −10%");
  assert(Core.restPct(tm, tm.heroes[0]) === 20 && Core.restPct(Core.create({ seed: 1, seats: [{ cls: "paladin" }, null, null, null] }), tm.heroes[0]) === 30, "苦痛 5：營火 20%");
  // 苦痛 1：一般敵人血量比較高（同一個 seed 比較）
  var t0 = Core.create({ seed: 96, seats: [{ cls: "paladin" }, null, null, null] }), t1 = Core.create({ seed: 96, seats: [{ cls: "paladin" }, null, null, null], torment: 1 });
  goFloor(t0); goFloor(t1);
  assert(t1.enemies[0].max > t0.enemies[0].max, "苦痛 1：敵人血量 +10%，實際 " + t0.enemies[0].max + "→" + t1.enemies[0].max);

  // 無盡模式：第三幕首領打完不結束，進入第四幕（敵人池輪回第一幕、血量更高）
  var en = Core.create({ seed: 97, seats: [{ cls: "paladin" }, null, null, null], endless: true });
  en.act = 2; en.floor = 3;
  en.heroes.forEach(function (h) { if (h) { h.dests = ["boss"]; h.dest = null; } });
  Core.apply(en, "local", { t: "dest", s: 0, i: 0 });
  assert(en.phase === "battle" && en.battleKind === "boss", "無盡：第三幕首領戰");
  en.enemies.forEach(function (e) { e.hp = 0; });
  var killU = (en.uid += 1);
  en.heroes[0].hand.push({ u: killU, id: "pal_defend" }); en.heroes[0].mana = 9;
  Core.apply(en, "local", { t: "play", s: 0, u: killU, tg: null });
  assert(en.phase === "reward", "無盡：第三幕首領打完是獎勵而不是通關，實際 " + en.phase);
  // 一般模式則通關
  var fin = Core.create({ seed: 97, seats: [{ cls: "paladin" }, null, null, null] });
  fin.act = 2; fin.floor = 3; fin.heroes[0].dests = ["boss"]; fin.heroes[0].dest = null;
  Core.apply(fin, "local", { t: "dest", s: 0, i: 0 });
  fin.enemies.forEach(function (e) { e.hp = 0; });
  var finU = (fin.uid += 1);
  fin.heroes[0].hand.push({ u: finU, id: "pal_defend" }); fin.heroes[0].mana = 9;
  Core.apply(fin, "local", { t: "play", s: 0, u: finU, tg: null });
  assert(fin.phase === "win", "一般模式：第三幕首領打完就通關");
  // 第四幕的敵人來自第一幕的敵人池，而且比第一幕強
  var e4 = Core.create({ seed: 98, seats: [{ cls: "paladin" }, null, null, null], endless: true });
  e4.act = 3; e4.floor = 0;
  goFloor(e4);
  var e1 = Core.create({ seed: 98, seats: [{ cls: "paladin" }, null, null, null] });
  goFloor(e1);
  assert(Core.actDef(e4) === D.ACTS[0] && Core.loopOf(e4) === 1, "第四幕輪回第一幕的敵人池");
  assert(e4.enemies[0].max > e1.enemies[0].max, "第四幕的敵人比第一幕強：" + e1.enemies[0].max + "→" + e4.enemies[0].max);

  // ---- 2026-10-23 第三批：新敵人機制、每幕多位首領、催化（鍊金術師）、頌歌（吟遊詩人） ----
  // 測試用：把戰場換成指定的敵人（近戰放內圈，否則攻擊會變成前進）
  function setFoes(st, list) {
    st.enemies = list.map(function (x) {
      st.uid += 1;
      var hp = x.hp || 500;
      return { u: st.uid, id: x.id, hp: hp, max: x.max || hp, blk: 0, str: 0, st: { weak: 0, vuln: 0, poison: 0, burn: 0, stun: 0 },
        sec: 0, ring: x.ring || (D.ENEMY[x.id].kind === "melee" ? "near" : "far"), pi: 0, last: -1, intent: x.intent || [] };
    });
    return st.enemies;
  }
  function playCard(st, seat, id, tg) {
    var u = (st.uid += 1);
    st.heroes[seat].hand.push({ u: u, id: id });
    st.heroes[seat].mana = 9;
    return Core.apply(st, "local", { t: "play", s: seat, u: u, tg: tg || null });
  }
  var mx = Core.create({ seed: 61, seats: [{ cls: "paladin" }, { cls: "bard" }, null, null] });
  goFloor(mx);
  var mh = mx.heroes[0];
  mh.str = 0;
  // 分裂：裂殖腐泥倒下時生出 2 隻小腐泥，戰鬥繼續
  var sl = setFoes(mx, [{ id: "bigslime", hp: 1 }])[0];
  playCard(mx, 0, "pal_strike", { e: sl.u });
  assert(mx.phase === "battle" && mx.enemies.length === 2 && mx.enemies.every(function (e) { return e.id === "slimelet"; }), "分裂：裂殖腐泥倒下生出 2 隻小腐泥，實際 " + mx.enemies.map(function (e) { return e.id; }));
  // 受庇護：場上還有其他敵人時傷害減半；其他敵人都倒下後傷害正常
  var wd = setFoes(mx, [{ id: "lich", hp: 100 }, { id: "skel", hp: 1 }]);
  var lich = wd[0];
  assert(Core.warded(mx, lich), "巫妖：有骷髏兵在場時受庇護");
  playCard(mx, 0, "pal_strike", { e: lich.u });
  assert(lich.hp === 100 - Math.ceil(7 / 2), "受庇護：斬擊 7 減半，實際 " + (100 - lich.hp));
  playCard(mx, 0, "pal_strike", { e: wd[1].u });
  assert(!Core.warded(mx, lich), "骷髏兵倒下後不再受庇護");
  var lh = lich.hp;
  playCard(mx, 0, "pal_strike", { e: lich.u });
  assert(lh - lich.hp === 7, "庇護失效後傷害正常");
  // 第二階段：骨龍生命降到一半以下時換行動、力量 +2、清除自己的負面狀態（只換一次）
  var dr = setFoes(mx, [{ id: "bonedragon", hp: 56, max: 100 }])[0];
  dr.st.poison = 5;
  playCard(mx, 0, "pal_strike", { e: dr.u });
  assert(dr.ph === 1 && dr.str === 2 && dr.st.poison === 0 && mx.log.some(function (e) { return e.t === "phase"; }), "第二階段：骨龍變身");
  assert(JSON.stringify(dr.intent) === JSON.stringify(D.ENEMY.bonedragon.phase.pat[0]), "第二階段：換成第二套行動");
  playCard(mx, 0, "pal_strike", { e: dr.u });
  assert(dr.str === 2, "第二階段只換一次");
  // 成長：熔岩巨像每過一回合力量 +1
  var co = setFoes(mx, [{ id: "colossus", hp: 500 }])[0];
  Core.heroes(mx).forEach(function (h) { Core.apply(mx, "local", { t: "end", s: h.seat }); });
  assert(co.str === 1, "成長：熔岩巨像每回合力量 +1，實際 " + co.str);
  // 吸血：吸血鬼打掉多少生命就回復多少
  var vp = setFoes(mx, [{ id: "vampire", hp: 10, max: 30, intent: [{ k: "atk", n: 5, drain: true }] }])[0];
  mh.blk = 0; mh.hp = mh.max;
  var b1 = mx.heroes[1]; b1.blk = 99;
  vp.sec = Core.secOf(mx, 0);
  Core.heroes(mx).forEach(function (h) { Core.apply(mx, "local", { t: "end", s: h.seat }); });
  assert(vp.hp === 15 && mh.hp === mh.max - 5, "吸血：打掉 5 生命回復 5，實際 " + vp.hp);
  // 破甲：紀律官先把護盾歸零再攻擊
  var ef = setFoes(mx, [{ id: "enforcer", hp: 500, intent: [{ k: "shatter" }, { k: "atk", n: 9 }] }])[0];
  ef.sec = Core.secOf(mx, 0);
  mh.hp = mh.max;
  Core.heroes(mx).forEach(function (h) { h.done = false; });
  mh.blk = 0;
  playCard(mx, 0, "pal_defend");
  assert(mh.blk > 0, "防禦有護盾");
  Core.heroes(mx).forEach(function (h) { Core.apply(mx, "local", { t: "end", s: h.seat }); });
  assert(mh.hp === mh.max - 9 && mx.log.some(function (e) { return e.t === "shatter"; }), "破甲：護盾歸零後吃滿 9 傷害，實際 −" + (mh.max - mh.hp));
  // 淨化：惡魔祭司清除全體敵人的負面狀態
  var pr = setFoes(mx, [{ id: "priestess", hp: 500, intent: [{ k: "purge", all: true }] }, { id: "guard", hp: 500, intent: [] }]);
  pr.forEach(function (e) { e.st.poison = 6; e.st.vuln = 2; });
  Core.heroes(mx).forEach(function (h) { Core.apply(mx, "local", { t: "end", s: h.seat }); });
  assert(pr.every(function (e) { return e.st.poison === 0 && e.st.vuln === 0; }), "淨化：全體敵人的中毒、易傷清除");
  // 頌歌：給隊友魔力、抽牌、力量
  setFoes(mx, [{ id: "skel", hp: 500 }]);
  Core.heroes(mx).forEach(function (h) { h.done = false; h.down = false; h.hp = h.max; });
  mh.mana = 0;
  var hand0 = mh.hand.length;
  playCard(mx, 1, "bar_elegy", { s: 0 });
  assert(mh.mana === 1, "鼓點：隊友魔力 +1");
  playCard(mx, 1, "bar_chant", { s: 0 });
  assert(mh.hand.length === hand0 + 2, "靈感：隊友抽 2 張");
  playCard(mx, 1, "bar_lullaby", { s: 0 });
  assert(mh.str === 2, "激勵：隊友力量 +2");
  assert(!D.CARDS.some(function (c) { return c.cls === "bard" && c.path === "anthem" && JSON.stringify(c.fx).indexOf("heal") >= 0; }), "頌歌方向沒有治療");
  assert(!D.CARDS.some(function (c) { return c.cls === "alchemist" && c.path === "catalyst" && JSON.stringify(c.fx).indexOf("poison") >= 0; }), "催化方向沒有毒");

  // 催化：依手上的藥水數造成傷害、升級版藥水、催化劑減少做藥需要的張數
  var ca = Core.create({ seed: 62, seats: [{ cls: "alchemist" }, null, null, null] });
  goFloor(ca);
  var cah = ca.heroes[0];
  cah.str = 0;
  var cfoe = setFoes(ca, [{ id: "skel", hp: 500 }])[0];
  cah.hand = [{ u: (ca.uid += 1), id: "alc_p_heal" }, { u: (ca.uid += 1), id: "alc_p_str" }];
  playCard(ca, 0, "alc_catalyst", { e: cfoe.u });
  // 期望值從卡牌資料算（平衡調整會改每瓶的傷害）
  var perPotion = D.CARD.alc_catalyst.fx[0].n;
  assert(cfoe.hp === 500 - perPotion * 2, "瓶中雷：" + perPotion + " × 2 瓶，實際 " + (500 - cfoe.hp));
  playCard(ca, 0, "alc_recipe");
  assert(cah.hand.filter(function (c) { return D.POTIONS.indexOf(c.id) >= 0; }).every(function (c) { return c.up; }), "精煉：手上的藥水全部升級");
  playCard(ca, 0, "alc_fog");
  assert(cah.hand.filter(function (c) { return D.POTIONS.indexOf(c.id) >= 0 && c.up; }).length === 3, "濃縮：做出升級版藥水");
  playCard(ca, 0, "alc_corrode");
  assert(Core.reagentNeed(cah) === D.CLASS.alchemist.extra.reagent - 1, "催化劑：做藥需要的張數 −1");

  // 每幕有 3 位首領：幕開始時抽好（st.boss），首領戰出現的就是牠
  D.ACTS.forEach(function (a) { assert(a.bosses.length === 3 && a.bosses.every(function (b) { return D.ENEMY[b] && D.ENEMY[b].boss; }), "每幕 3 位首領"); });
  var seen = {};
  for (var bs = 0; bs < 30; bs++) {
    var bst = Core.create({ seed: 300 + bs, seats: [{ cls: "paladin" }, null, null, null] });
    assert(D.ACTS[0].bosses.indexOf(bst.boss) >= 0, "第一幕的首領在名單內");
    seen[bst.boss] = 1;
    if (bs === 0) {
      bst.floor = 3; bst.heroes[0].dests = ["boss"]; bst.heroes[0].dest = null;
      Core.apply(bst, "local", { t: "dest", s: 0, i: 0 });
      assert(bst.enemies.some(function (e) { return e.id === bst.boss; }), "首領戰出現的是 st.boss");
    }
  }
  assert(Object.keys(seen).length === 3, "30 局內三位首領都出現過：" + Object.keys(seen));

  // ---- 2026-10-24 新英雄（忍者、劍豪、陰陽師、海賊、舞孃、咒術師；docs/yellow_new_heroes.md） ----
  // 期望值盡量從資料讀（被動數值、彈藥上限）；敵人傷害用 Core.enemyHitValue 算（會乘上幕數倍率）
  function duo(cls, seed) {
    var s6 = Core.create({ seed: seed, seats: [{ cls: cls }, { cls: "paladin" }, null, null] });
    goFloor(s6);
    var h6 = s6.heroes[0];
    h6.str = 0; h6.st.weak = 0; h6.hp = h6.max;
    s6.heroes[1].blk = 999;
    return { st: s6, h: h6 };
  }
  function endRound(s6) { Core.heroes(s6).forEach(function (h) { h.done = false; }); Core.heroes(s6).forEach(function (h) { Core.apply(s6, "local", { t: "end", s: h.seat }); }); }
  function foesAt(s6, list) { var fs = setFoes(s6, list); fs.forEach(function (e) { e.sec = Core.secOf(s6, 0); }); return fs; }

  // 忍者：影步（第 3 張起攻擊 +n）、背刺、手裡劍、替身、影分身
  var nj = duo("ninja", 71), njh = nj.h, combo = D.CLASS.ninja.passive.n;
  var kunai = D.CARD.nin_kunai.fx[0].n, back = D.CARD.nin_back.fx[0].n, backX = D.CARD.nin_back.fx[1].fx[0].n;
  var nf = foesAt(nj.st, [{ id: "skel", hp: 500, intent: [] }, { id: "skel", hp: 500, intent: [] }])[0];
  njh.combo = 0;
  ["nin_kunai", "nin_kunai", "nin_kunai"].forEach(function (id) { playCard(nj.st, 0, id, { e: nf.u }); });
  assert(nf.hp === 500 - (kunai * 3 + combo), "影步：第 3 張攻擊 +" + combo + "，實際 " + (500 - nf.hp));
  njh.combo = 0; nf.hp = 500;
  playCard(nj.st, 0, "nin_back", { e: nf.u });
  assert(nf.hp === 500 - back - backX, "背刺：目標不打我時 " + back + "＋" + backX + "，實際 " + (500 - nf.hp));
  njh.combo = 0; nf.hp = 500; nf.intent = [{ k: "atk", n: 5 }];
  playCard(nj.st, 0, "nin_back", { e: nf.u });
  assert(nf.hp === 500 - back, "背刺：目標要打我時只有 " + back + "，實際 " + (500 - nf.hp));
  var tk0 = njh.hand.filter(function (c) { return c.id === "nin_shuriken"; }).length;
  playCard(nj.st, 0, "nin_case");
  assert(njh.hand.filter(function (c) { return c.id === "nin_shuriken"; }).length === tk0 + 2, "手裡劍匣：2 張手裡劍放進手牌");
  njh.combo = 0; nf.hp = 500;
  playCard(nj.st, 0, "nin_shadowclone");
  playCard(nj.st, 0, "nin_kunai", { e: nf.u });
  assert(nf.hp === 500 - kunai * 2, "影分身：下一張攻擊牌發動兩次，實際 " + (500 - nf.hp));
  playCard(nj.st, 0, "nin_sub");
  assert(njh.dodge === 1, "替身術：替身 1");
  njh.blk = 0; njh.hp = njh.max;
  endRound(nj.st);
  assert(njh.hp === njh.max && njh.dodge === 0 && nj.st.log.some(function (e) { return e.t === "dodge"; }), "替身：抵銷一次攻擊，實際 −" + (njh.max - njh.hp));

  // 劍豪：一之太刀、劍意（居合斬加倍）、斬鐵、見切、後之先
  var ks = duo("kensei", 72), ksh = ks.h, first = D.CLASS.kensei.passive.n;
  var kf = foesAt(ks.st, [{ id: "skel", hp: 500, intent: [] }, { id: "skel", hp: 500, intent: [] }])[0];
  ksh.atkN = 0;
  playCard(ks.st, 0, "ken_tachi", { e: kf.u });
  playCard(ks.st, 0, "ken_tachi", { e: kf.u });
  assert(kf.hp === 500 - (7 + first) - 7, "一之太刀：只有第一張攻擊牌 +" + first + "，實際 " + (500 - kf.hp));
  kf.hp = 500;
  playCard(ks.st, 0, "ken_breath");
  playCard(ks.st, 0, "ken_iai", { e: kf.u });
  assert(kf.hp === 500 - (14 + 5 * 2) && ksh.edge === 0, "居合斬：劍意 5 加倍，實際 " + (500 - kf.hp));
  kf.hp = 500; kf.blk = 10;
  playCard(ks.st, 0, "ken_zantetsu", { e: kf.u });
  assert(kf.hp === 488 && kf.blk === 10, "斬鐵：無視護盾，實際 " + (500 - kf.hp) + " 護盾 " + kf.blk);
  kf.hp = 500; kf.blk = 0; kf.intent = [{ k: "atk", n: 5 }];
  playCard(ks.st, 0, "ken_gonosen", { e: kf.u });
  assert(kf.hp === 488, "後之先：目標要打我時 6＋6，實際 " + (500 - kf.hp));
  kf.hp = 500;
  playCard(ks.st, 0, "ken_kyouka");
  endRound(ks.st);
  assert(kf.hp === 494 && ks.st.log.some(function (e) { return e.t === "parry"; }), "見切：被攻擊時反擊 6，實際 " + (500 - kf.hp));
  assert(ksh.parry === 0, "見切在自己下回合開始時歸零");

  // 陰陽師：相生（木 → 火）、陰陽調和的護盾、式神、結界
  var om = duo("onmyoji", 73), omh = om.h, genBlk = D.CLASS.onmyoji.passive.n;
  var fireN = D.CARD.onm_fire.fx[0].n, fireGen = D.CARD.onm_fire.fx[1].fx[0].n;
  var of = foesAt(om.st, [{ id: "skel", hp: 500, intent: [] }, { id: "skel", hp: 500, intent: [] }])[0];
  omh.lastEl = null; omh.blk = 0;
  playCard(om.st, 0, "onm_wood");
  playCard(om.st, 0, "onm_fire", { e: of.u });
  assert(of.hp === 500 - fireN - fireGen && omh.blk === genBlk && omh.genN === 1, "相生：木 → 火，火符 " + fireN + "＋" + fireGen + "、護盾 " + genBlk + "，實際 " + (500 - of.hp) + "/" + omh.blk);
  of.hp = 500;
  playCard(om.st, 0, "onm_fire", { e: of.u });
  assert(of.hp === 500 - fireN, "火 → 火不是相生，實際 " + (500 - of.hp));
  playCard(om.st, 0, "onm_call");
  playCard(om.st, 0, "onm_kekkai");
  var kekN = D.CARD.onm_kekkai.fx[0].n;
  assert(omh.shiki === 1 && omh.kek === kekN, "式神召喚、結界 3");
  of.intent = [{ k: "atk", n: 9 }];
  var hit9 = Core.enemyHitValue(om.st, of, 9, 0);
  omh.blk = 0; omh.hp = omh.max; of.hp = 500;
  endRound(om.st);
  assert(omh.hp === omh.max - Math.max(0, hit9 - kekN), "結界：每下減 " + kekN + "，實際 −" + (omh.max - omh.hp) + "（原本 " + hit9 + "）");
  assert(om.st.log.some(function (e) { return e.t === "shikiAtk"; }), "式神在回合結束時攻擊");

  // 海賊：開戰彈藥、彈藥不夠不能出、掠奪、連環槍
  var pi = duo("pirate", 74), pih = pi.h;
  assert(pih.ammo === D.CLASS.pirate.extra.ammoStart, "海賊開戰 " + D.CLASS.pirate.extra.ammoStart + " 彈藥，實際 " + pih.ammo);
  var pf = foesAt(pi.st, [{ id: "skel", hp: 500, ring: "far", intent: [] }, { id: "skel", hp: 1, ring: "near", intent: [] }]);
  pih.ammo = 0;
  assert(playCard(pi.st, 0, "pir_musket", { e: pf[0].u }) === "cannot_play", "沒有彈藥不能開火槍");
  pih.ammo = 3;
  playCard(pi.st, 0, "pir_chain", { e: pf[0].u });
  assert(pf[0].hp === 500 - 18 && pih.ammo === 0, "連環槍：3 發 × 6，實際 " + (500 - pf[0].hp));
  playCard(pi.st, 0, "pir_plunder", { e: pf[1].u });
  assert(pih.mana === 9, "劫掠：打倒目標回 1 魔力，實際 " + pih.mana);

  // 舞孃：換牌型累積節拍（＋舞步護盾）、魅惑（改打別的敵人；首領免疫）
  var dc = duo("dancer", 75), dch = dc.h, bb = D.CLASS.dancer.passive.n;
  var df = foesAt(dc.st, [{ id: "skel", hp: 500, intent: [] }, { id: "skel", hp: 500, intent: [] }]);
  dch.lastType = null; dch.beat = 0; dch.blk = 0;
  playCard(dc.st, 0, "dan_fan", { e: df[0].u });
  playCard(dc.st, 0, "dan_step");
  var stepB = D.CARD.dan_step.fx[0].n;
  assert(dch.beat === 1 && dch.blk === stepB + bb, "節拍：攻擊 → 技能 +1，舞步護盾 " + bb + "，實際 " + dch.beat + "/" + dch.blk);
  playCard(dc.st, 0, "dan_step");
  assert(dch.beat === 1, "技能 → 技能不加節拍");
  df[0].hp = df[1].hp = 500;
  df[0].intent = [{ k: "atk", n: 6 }];
  playCard(dc.st, 0, "dan_glance", { e: df[0].u });
  assert(df[0].st.charm === 1, "拋媚眼：魅惑 1");
  dch.blk = 0; dch.hp = dch.max;
  endRound(dc.st);
  assert(dch.hp === dch.max && df[1].hp < 500 && dc.st.log.some(function (e) { return e.t === "charmHit"; }), "魅惑：改打另一隻敵人，實際 英雄 −" + (dch.max - dch.hp) + " 另一隻 −" + (500 - df[1].hp));
  var bossC = setFoes(dc.st, [{ id: "giant", hp: 500 }, { id: "skel", hp: 500 }])[0];
  playCard(dc.st, 0, "dan_glance", { e: bossC.u });
  assert(!(bossC.st.charm > 0), "首領免疫魅惑");

  // 咒術師：受傷累積咒力、綁定、消耗咒力、束縛
  var jj = duo("jujutsu", 76), jjh = jj.h, ceHit = D.CLASS.jujutsu.passive.n;
  var jf = foesAt(jj.st, [{ id: "skel", hp: 500, intent: [] }, { id: "skel", hp: 500, intent: [] }])[0];
  jjh.ce = 0;
  playCard(jj.st, 0, "juj_doll", { e: jf.u });
  playCard(jj.st, 0, "juj_stab");
  assert(jjh.ce === ceHit && jf.hp === 497, "自刺：咒力 +" + ceHit + "，綁定的敵人也受 3，實際 " + jjh.ce + "/" + (500 - jf.hp));
  jf.hp = 500; jjh.ce = 2;
  var cnt = D.CARD.juj_counter.fx[0].n + D.CARD.juj_counter.fx[1].fx[0].n, nail = D.CARD.juj_nail.fx[0].n;
  playCard(jj.st, 0, "juj_counter", { e: jf.u });
  assert(jf.hp === 500 - cnt && jjh.ce === 0, "反咒：消耗 2 咒力再加傷害，共 " + cnt + "，實際 " + (500 - jf.hp));
  playCard(jj.st, 0, "juj_silent");
  var skl = { u: (jj.st.uid += 1), id: "juj_ward" };
  jjh.hand.push(skl);
  assert(!Core.canPlay(jj.st, jjh, skl), "縛・寡言：本回合不能再打技能牌");
  jjh.noSkl = false; jf.hp = 500;
  playCard(jj.st, 0, "juj_onestrike");
  playCard(jj.st, 0, "juj_nail", { e: jf.u });
  assert(jf.hp === 500 - nail * 2, "縛・一擊：下一張牌發動兩次，實際 " + (500 - jf.hp));
  assert(playCard(jj.st, 0, "juj_nail", { e: jf.u }) === "cannot_play", "縛・一擊：之後不能再出牌");

  // AI 隊友：ctrl 為 ai 的英雄由 AI.next 決定行動，整局跑得完（不會卡住）
  require("../../static_src/yellow_ai.js");
  var A = global.PriTestYellowAI;
  var ag = Core.create({ seed: 99, seats: [{ cls: "priest", ctrl: "ai" }, { cls: "berserker", ctrl: "ai" }, null, null] });
  var guardN = 0;
  while (ag.phase !== "win" && ag.phase !== "lose" && guardN++ < 20000 && ag.act < 1) {
    var who = Core.heroes(ag).filter(function (x) { return ag.phase === "map" ? !x.dest : ag.phase === "battle" ? !x.down && !x.done : !!x.pend; })[0];
    if (!who) break;
    var act = A.next(ag, who.seat);
    assert(act, "AI 有該做的事卻沒有回傳 action");
    var er = Core.apply(ag, "ai", act);
    if (er && act.t === "choose") er = Core.apply(ag, "ai", A.fallback(who.seat));
    else if (er && act.t === "play") er = Core.apply(ag, "ai", { t: "end", s: who.seat });
    assert(!er, "AI 的 action 被拒絕：" + er + " " + JSON.stringify(act));
  }
  assert(ag.act >= 1 || ag.phase === "lose", "AI 隊伍至少打完第一幕或戰敗，實際 act " + ag.act + " " + ag.phase);
  assert(Core.apply(ag, "local", { t: "end", s: 0 }) === "not_yours", "AI 的英雄不能由別人操作");

  // 他人的英雄不能操作
  assert(Core.apply(st, "someone", { t: "end", s: 0 }) === "not_yours", "不能操作別人的英雄");
})();

console.log(JSON.stringify(summary));
if (fails) { console.log("失敗 " + fails + " 局"); process.exit(1); }
console.log("OK " + games + " 局");
