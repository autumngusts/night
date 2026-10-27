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
  // afUsed：詞綴「不屈」視為已觸發（2026-10-26），否則血量 1 的敵人第一下不會死
  st.enemies.forEach(function (e) { if (D.ENEMY[e.id].split) e.id = "skel"; e.hp = 1; e.blk = 0; e.afUsed = true; });
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
  // 2026-10-27 新增戰場狀態（開戰時依 D.FIELD_PCT 隨機出現）：會改變傷害、抽牌數等期望值，
  // 單元檢查一律關掉，只在下面「戰場狀態」那一段明確指定；最後還原給整局隨機測試以外的檢查用
  var fieldPct = D.FIELD_PCT.slice();
  for (var fp = 0; fp < D.FIELD_PCT.length; fp++) D.FIELD_PCT[fp] = 0;
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
  // 舊期望「菁英區只有 1 隻」已過時：2026-10-24 使用者指定菁英區＝菁英＋1～2 隻一般敵人
  var el0 = sec0.filter(function (e) { return D.ENEMY[e.id].elite; });
  // 2026-10-26 再改：護衛依幕數 0～1／1～2／2～3，第一幕是菁英＋0～1 隻
  assert(el0.length === 1 && sec0.length >= 1 && sec0.length <= 2, "選菁英的英雄那一區應是 1 隻菁英＋0～1 隻隨從，實際 " + sec0.length + " 隻");
  var sec1 = st5.enemies.filter(function (e) { return e.sec === Core.secOf(st5, 1); });
  assert(sec1.every(function (e) { return !D.ENEMY[e.id].elite; }), "選營火的區不應有菁英");
  // 一般區第一幕 1～3 隻（2026-10-24 的 2～3／3～4／4～5 已過時：2026-10-26 使用者指定改成 1～3／2～4／4～5）
  assert(sec1.length >= 1 && sec1.length <= 3, "第一幕一般區應有 1～3 隻，實際 " + sec1.length);
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
  // 2026-10-26 一般敵人第一幕 ×0.8 後蝙蝠每下只剩 1 傷害（一半捨去＝0 回復），這裡固定原本強度驗證貝殼
  tr.enemies.forEach(function (x) { x.wk = 1; });
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
  e4.act = 3; e4.floor = 0; e4.regs[3] = "grave";
  goFloor(e4);
  var e1 = Core.create({ seed: 98, seats: [{ cls: "paladin" }, null, null, null] });
  e1.regs[0] = "grave";
  goFloor(e1);
  // 舊期望「actDef(e4) === D.ACTS[0]」：2026-10-24 起每幕從同難度的區域抽，第四幕抽的是 tier 0 的區域
  assert(Core.actDef(e4).tier === 0 && Core.loopOf(e4) === 1, "第四幕輪回第一幕（tier 0）的區域");
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
  // （2026-10-24 新區域是精簡版，每區 2 位首領；原本三幕仍是 3 位）
  D.REGIONS.forEach(function (a) { assert(a.bosses.length === (D.ACTS.indexOf(a) >= 0 ? 3 : 2) && a.bosses.every(function (b) { return D.ENEMY[b] && D.ENEMY[b].boss; }), "首領數：" + a.id); });
  var seen = {}, seenRg = {};
  for (var bs = 0; bs < 30; bs++) {
    var bst = Core.create({ seed: 300 + bs, seats: [{ cls: "paladin" }, null, null, null] });
    assert(Core.actDef(bst).tier === 0 && Core.actDef(bst).bosses.indexOf(bst.boss) >= 0, "第一幕的首領在抽到的區域名單內");
    seenRg[bst.regs[0]] = 1;
    if (Core.actDef(bst).id !== "grave") continue;
    seen[bst.boss] = 1;
    if (bs === 0) {
      bst.floor = 3; bst.heroes[0].dests = ["boss"]; bst.heroes[0].dest = null;
      Core.apply(bst, "local", { t: "dest", s: 0, i: 0 });
      assert(bst.enemies.some(function (e) { return e.id === bst.boss; }), "首領戰出現的是 st.boss");
    }
  }
  assert(Object.keys(seen).length === 3, "墓地的三位首領都出現過：" + Object.keys(seen));
  assert(Object.keys(seenRg).length === 3, "30 局內第一幕的三個區域都抽到過：" + Object.keys(seenRg));

  // ---- 2026-10-24 新區域：每幕隨機區域、戲法、偷牌、爆炸、喝采、空襲 ----
  D.REGIONS.forEach(function (r) {
    [].concat.apply([], r.packs).concat(r.elites, r.bosses, [r.minion]).forEach(function (id) { assert(D.ENEMY[id], r.id + " 的敵人不存在：" + id); });
  });
  // 進下一幕時重抽該幕的區域（tier 對應幕數）
  var rgs = Core.create({ seed: 401, seats: [{ cls: "paladin" }, null, null, null] });
  rgs.floor = D.FLOORS.length - 1; rgs.act = 0;
  Core.nextFloor(rgs);
  assert(rgs.act === 1 && D.REGION[rgs.regs[1]].tier === 1 && Core.actDef(rgs).bosses.indexOf(rgs.boss) >= 0, "第二幕抽 tier 1 的區域與首領");
  var rx = duo("paladin", 402), rxh = rx.h;
  rxh.blk = 0;
  // 戲法：換到另一位英雄的區域、內外圈對調
  var cl = foesAt(rx.st, [{ id: "clown", hp: 500, ring: "near", intent: [{ k: "swap" }] }])[0];
  var sec0 = cl.sec;
  endRound(rx.st);
  assert(cl.sec !== sec0 && cl.ring === "far", "戲法：換區且內圈→外圈，實際 sec " + sec0 + "→" + cl.sec + " " + cl.ring);
  // 偷牌：抽牌堆少 n 張、放在小偷身上；打倒小偷就還回棄牌堆
  // 舊期望「進消耗堆、整場拿不回來」已過時：2026-10-25 牌被偷光的英雄無法行動、戰鬥卡死，改成打倒小偷還回來
  var mk = foesAt(rx.st, [{ id: "monkey", hp: 500, intent: [{ k: "steal", n: 2 }] }])[0];
  var tot0 = rxh.draw.length + rxh.disc.length + rxh.hand.length, ex0 = rxh.exh.length;
  endRound(rx.st);
  assert(rxh.exh.length === ex0 && mk.loot.length === 2 && rxh.draw.length + rxh.disc.length + rxh.hand.length === tot0 - 2, "偷牌：拿走 2 張放在小偷身上");
  var disc0 = rxh.disc.length;
  foesAt(rx.st, [mk, { id: "skel", hp: 500, intent: [] }].map(function (x) { return x.u ? { id: x.id, hp: 1, ring: "near", intent: [] } : x; }));
  rx.st.enemies[0].loot = mk.loot;
  playCard(rx.st, 0, "pal_strike", { e: rx.st.enemies[0].u });
  assert(rxh.disc.length === disc0 + 2 + 1, "打倒小偷：2 張被偷的牌回到棄牌堆（加上剛打出的牌），實際 " + (rxh.disc.length - disc0));
  // 偷牌至少留一手牌（2026-10-27：被偷光時英雄不能行動、小偷的攻擊被護盾擋住，戰鬥會永遠打不完）
  var mk2 = foesAt(rx.st, [{ id: "monkey", hp: 500, intent: [{ k: "steal", n: 9 }] }])[0];
  rxh.hand = []; rxh.exh = []; rxh.draw = rxh.deck.slice(0, D.HAND_SIZE + 2).map(function (c) { return { u: c.u, id: c.id }; }); rxh.disc = [];
  Core.runEnemyAct(rx.st, mk2, { k: "steal", n: 9 });
  assert(rxh.draw.length + rxh.disc.length === D.HAND_SIZE && (mk2.loot || []).length === 2, "偷牌：最多偷到只剩 " + D.HAND_SIZE + " 張，實際剩 " + (rxh.draw.length + rxh.disc.length));
  // 空襲：無視護盾
  var dr = foesAt(rx.st, [{ id: "drone", hp: 500, intent: [{ k: "atk", n: 6, pierce: true }] }])[0];
  rxh.blk = 50; rxh.hp = rxh.max;
  var pv = Core.enemyHitValue(rx.st, dr, 6, rxh.seat);
  endRound(rx.st);
  assert(rxh.hp === rxh.max - pv, "空襲：護盾 50 也擋不住 " + pv + "，實際生命 " + rxh.hp + "/" + rxh.max);
  // 爆炸：倒下時打所在區域的英雄（護盾可擋），其他區域的英雄不受影響
  var fw = foesAt(rx.st, [{ id: "firework", hp: 1, intent: [] }, { id: "skel", hp: 500, intent: [] }])[0];
  rxh.blk = 0; rxh.hp = rxh.max; rx.st.heroes[1].blk = 0; var hp1 = rx.st.heroes[1].hp;
  var bv = Core.enemyHitValue(rx.st, fw, D.ENEMY.firework.burst, rxh.seat);
  playCard(rx.st, 0, "pal_strike", { e: fw.u });
  assert(rxh.hp === rxh.max - bv && rx.st.heroes[1].hp === hp1, "爆炸：只有所在區域的英雄受到 " + bv + " 傷害，實際 " + rxh.hp + "/" + rxh.max + "、隊友 " + rx.st.heroes[1].hp + "/" + hp1);
  // 喝采：其他敵人倒下時力量 +rally
  var gl = foesAt(rx.st, [{ id: "gladiator", hp: 500, intent: [] }, { id: "skel", hp: 1, intent: [] }]);
  playCard(rx.st, 0, "pal_strike", { e: gl[1].u });
  assert(gl[0].str === D.ENEMY.gladiator.rally, "喝采：同伴倒下力量 +" + D.ENEMY.gladiator.rally + "，實際 " + gl[0].str);
  // 爆炸傷害經由綁定（link）連帶打倒最後一隻敵人：戰鬥要馬上結束，不能留下 0 血的敵人（2026-10-24 修正）
  var fl = foesAt(rx.st, [{ id: "firework", hp: 1, intent: [] }, { id: "skel", hp: 1, intent: [] }]);
  fl[1].st.link = 2; fl[1].lk = rxh.seat;
  rxh.blk = 0; rxh.hp = rxh.max;
  playCard(rx.st, 0, "pal_strike", { e: fl[0].u });
  assert(rx.st.phase !== "battle" && !rx.st.enemies.length, "爆炸→綁定連帶擊倒最後一隻：戰鬥應結束，實際 " + rx.st.phase + " / " + rx.st.enemies.length + " 隻");

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

  // ---- 2026-10-25 魔力型、範圍控制、首領抗暈、防無限輪轉 ----
  // 起始牌組各有一張範圍控制卡
  [["mage", "mag_ring"], ["chrono", "chr_bubble"], ["alchemist", "alc_tear"], ["dancer", "dan_lure"]].forEach(function (p) {
    assert(D.CLASS[p[0]].start.indexOf(p[1]) >= 0, p[0] + " 的起始牌組應有 " + p[1]);
  });
  // 首領：暈眩不疊加、暈眩結束後免疫到下一回合結束，再下一回合又能暈
  var bz = duo("chrono", 251);
  var bossF = setFoes(bz.st, [{ id: bz.st.boss, hp: 900, intent: [] }])[0];
  playCard(bz.st, 0, "chr_freeze", { e: bossF.u });
  playCard(bz.st, 0, "chr_freeze", { e: bossF.u });
  assert(bossF.st.stun === 1, "首領的暈眩不疊加，實際 " + bossF.st.stun);
  endRound(bz.st);
  assert(bossF.st.stun === 0 && bossF.stImm > 0, "首領暈眩結束後應免疫");
  playCard(bz.st, 0, "chr_freeze", { e: bossF.u });
  assert(bossF.st.stun === 0, "免疫中的首領不會被暈眩");
  bossF.intent = []; bossF.hp = 900;
  endRound(bz.st);
  playCard(bz.st, 0, "chr_freeze", { e: bossF.u });
  assert(bossF.st.stun === 1, "免疫過了一回合後又能暈眩，實際 " + bossF.st.stun);
  // 一般敵人照舊可以疊加
  var mobF = setFoes(bz.st, [{ id: "skel", hp: 500, intent: [] }])[0];
  playCard(bz.st, 0, "chr_freeze", { e: mobF.u });
  playCard(bz.st, 0, "chr_freeze", { e: mobF.u });
  assert(mobF.st.stun === 2, "一般敵人的暈眩照舊疊加，實際 " + mobF.st.stun);
  // 法力回流：每回合第 3 張牌 +1 魔力，只觸發一次
  var mf = duo("mage", 252);
  setFoes(mf.st, [{ id: "skel", hp: 500, intent: [] }]);
  mf.h.pw.manaCombo = 1; mf.h.combo = 0;
  function playNoRefill(s6, seat, id) { var u = (s6.uid += 1); s6.heroes[seat].hand.push({ u: u, id: id }); return Core.apply(s6, "local", { t: "play", s: seat, u: u, tg: null }); }
  mf.h.mana = 5;
  playNoRefill(mf.st, 0, "mag_barrier"); playNoRefill(mf.st, 0, "mag_barrier");
  assert(mf.h.mana === 3, "前兩張不給魔力");
  playNoRefill(mf.st, 0, "mag_barrier");
  assert(mf.h.mana === 3, "第 3 張：花 1 得 1，實際 " + mf.h.mana);
  playNoRefill(mf.st, 0, "mag_barrier");
  assert(mf.h.mana === 2, "第 4 張不再給魔力，實際 " + mf.h.mana);
  // 周天：回合開始 3 氣換 1 魔力
  var mk2 = duo("monk", 253);
  setFoes(mk2.st, [{ id: "skel", hp: 500, intent: [] }]);
  mk2.h.pw.chiMana = 1; mk2.h.chi = 4;
  endRound(mk2.st);
  assert(mk2.h.chi === 1 && mk2.h.mana === D.MANA + 1, "周天：4 氣換 1 魔力剩 1 氣，實際 氣 " + mk2.h.chi + " 魔力 " + mk2.h.mana);
  // 蓄時：時能 +2（每 3 點回合開始多 1 魔力）
  var cs = duo("chrono", 254);
  setFoes(cs.st, [{ id: "skel", hp: 500, intent: [] }]);
  cs.h.flux = 0;
  playCard(cs.st, 0, "chr_store");
  assert(cs.h.flux === 2, "蓄時：時能 +2，實際 " + cs.h.flux);
  endRound(cs.st);
  assert(cs.h.flux === 3 && cs.h.mana === D.MANA + 1, "時能 3：回合開始多 1 魔力，實際 時能 " + cs.h.flux + " 魔力 " + cs.h.mana);
  // 終曲・激昂：每 4 旋律讓全隊各 +1 魔力
  var bt = duo("bard", 255);
  setFoes(bt.st, [{ id: "skel", hp: 500, intent: [] }]);
  bt.h.mel = 8;
  var ally0 = bt.st.heroes[1].mana;
  playCard(bt.st, 0, "bar_tempo");
  assert(bt.h.mana === 9 - 1 + 2 && bt.st.heroes[1].mana === ally0 + 2 && bt.h.mel === 0, "終曲・激昂：8 旋律 → 全隊 +2 魔力");
  // 2026-10-26 使用者指定：取消「回合中只洗一次牌」，回合中抽牌堆空了照常把棄牌堆洗回去
  var lp = duo("mage", 256);
  setFoes(lp.st, [{ id: "skel", hp: 500, intent: [] }]);
  lp.h.mana = 9;
  for (var li = 0; li < 2; li++) {
    lp.h.hand = [{ u: (lp.st.uid += 1), id: "mag_blink" }];
    lp.h.draw = []; lp.h.disc = [{ u: (lp.st.uid += 1), id: "mag_bolt" }];
    playNoRefill(lp.st, 0, "mag_blink");
    assert(lp.h.hand.some(function (c) { return c.id === "mag_bolt"; }), "回合中第 " + (li + 1) + " 次洗牌也要抽得到牌");
  }
  // 回溯不會拿回其他回溯牌（時間迴路 ×2＋預支時間曾能無限產生魔力）
  var rc = duo("chrono", 257);
  setFoes(rc.st, [{ id: "skel", hp: 500, intent: [] }]);
  rc.h.hand = []; rc.h.draw = [];
  rc.h.disc = [{ u: (rc.st.uid += 1), id: "chr_bolt" }, { u: (rc.st.uid += 1), id: "chr_loop" }];
  playNoRefill(rc.st, 0, "chr_loop");
  assert(rc.h.hand.length === 1 && rc.h.hand[0].id === "chr_bolt", "時間迴路不會拿回另一張時間迴路");
  // ---- 敵人詞綴（2026-10-26）----
  function afFoe(seed, af, extra) {
    var s = duo("paladin", seed);
    var list = setFoes(s.st, [Object.assign({ id: "skel", hp: 40, intent: [{ k: "atk", n: 6 }] }, extra || {})]);
    list[0].af = af;
    return { st: s.st, h: s.h, e: list[0] };
  }
  // 迅捷：攻擊次數 +1
  var sw = afFoe(301, "swift");
  assert(Core.effActs(sw.st, sw.e)[0].h === 2, "迅捷：攻擊 1 下變 2 下");
  // 不屈：第一次致命傷剩 1，第二次照常倒下
  var ud = afFoe(302, "undying");
  Core.hitEnemy(ud.st, ud.e, 999, true);
  assert(ud.e.hp === 1 && ud.e.afUsed, "不屈：剩 1 生命");
  Core.hitEnemy(ud.st, ud.e, 999, true);
  assert(ud.e.hp === 0, "不屈只觸發一次");
  // 再生：回合開始回復最大血量 10%（至少 1）
  var rg = afFoe(303, "regen", { intent: [] });
  rg.e.max = 40; rg.e.hp = 20;
  Core.enemyTurn(rg.st, rg.e);
  var rgWant = 20 + Math.max(1, Math.floor(40 * D.AFFIX_NUM.regen));
  assert(rg.e.hp === rgWant, "再生：回到 " + rgWant + "，實際 " + rg.e.hp);
  // 毒牙：打掉生命才中毒；被護盾完全擋住不中毒
  var vn = afFoe(304, "venom");
  vn.h.blk = 0; vn.h.st.poison = 0;
  Core.runEnemyAct(vn.st, vn.e, { k: "atk", n: 6 });
  assert(vn.h.st.poison === D.AFFIX_NUM.venom, "毒牙：中毒 " + D.AFFIX_NUM.venom);
  var vb = afFoe(305, "venom");
  vb.h.blk = 99; vb.h.st.poison = 0;
  Core.runEnemyAct(vb.st, vb.e, { k: "atk", n: 6 });
  assert(vb.h.st.poison === 0, "毒牙：被護盾擋住就不中毒");
  // 穩固：推開、換區都無效
  var an = afFoe(306, "anchor", { ring: "near" });
  Core.moveEnemy(an.st, an.e, "far");
  assert(an.e.ring === "near", "穩固：不會被推開");
  var an4 = Core.create({ seed: 307, seats: [{ cls: "paladin" }, { cls: "mage" }, null, null] });
  var a4 = setFoes(an4, [{ id: "skel", hp: 40 }])[0];
  a4.af = "anchor";
  Core.shiftEnemy(an4, a4, 1);
  assert(a4.sec === 0, "穩固：不會被換區");
  // 開場抽詞綴：強韌／堅甲／狂暴在 rollAffixes 生效；首領不帶、菁英必帶、同 seed 相同
  function rollWith(seed, ids, act) {
    var s = Core.create({ seed: seed, seats: [{ cls: "paladin" }, null, null, null] });
    s.act = act || 0;
    setFoes(s, ids.map(function (id) { return { id: id, hp: 100 }; }));
    Core.rollAffixes(s);
    return s.enemies;
  }
  var bossId = D.ENEMIES.filter(function (x) { return x.boss; })[0].id;
  var eliteId = D.ENEMIES.filter(function (x) { return x.elite && !x.boss; })[0].id;
  for (var ai = 0; ai < 30; ai++) {
    var rs = rollWith(400 + ai, [bossId, eliteId, "skel"], 2);
    assert(!rs[0].af, "首領不會有詞綴");
    assert(rs[1].af && D.AFFIX[rs[1].af], "菁英一定有詞綴");
  }
  assert(JSON.stringify(rollWith(450, ["skel", "skel", "skel", "skel", "skel"], 2).map(function (x) { return x.af || ""; })) ===
         JSON.stringify(rollWith(450, ["skel", "skel", "skel", "skel", "skel"], 2).map(function (x) { return x.af || ""; })), "同 seed 抽到的詞綴相同");
  var cnt = 0, tot = 0;
  for (var aj = 0; aj < 200; aj++) rollWith(500 + aj, ["skel", "skel", "skel", "skel", "skel"], 2).forEach(function (x) { tot++; if (x.af) cnt++; });
  var pct3 = D.AFFIX_PCT[2] / 100;
  assert(Math.abs(cnt / tot - pct3) < 0.07, "第三幕約 " + D.AFFIX_PCT[2] + "% 帶詞綴，實際 " + (cnt / tot).toFixed(2));
  var tg = Core.create({ seed: 601, seats: [{ cls: "paladin" }, null, null, null] });
  var tgE = setFoes(tg, [{ id: "skel", hp: 100 }])[0];
  Core.applyAffix(tg, tgE, "tough");
  assert(tgE.max === Math.round(100 * D.AFFIX_NUM.tough) && tgE.hp === tgE.max, "強韌：血量 ×" + D.AFFIX_NUM.tough);
  var ar = setFoes(tg, [{ id: "skel", hp: 100 }])[0];
  Core.applyAffix(tg, ar, "armor");
  assert(ar.blk === Math.floor(100 * D.AFFIX_NUM.armor), "堅甲：護盾＝最大血量 " + D.AFFIX_NUM.armor * 100 + "%");
  var fu = setFoes(tg, [{ id: "skel", hp: 100 }])[0];
  Core.applyAffix(tg, fu, "fury");
  assert(fu.str === D.AFFIX_NUM.fury[0], "狂暴：第一幕力量 +" + D.AFFIX_NUM.fury[0]);

  // ---- 戰場狀態（2026-10-27）：數值都從 D.FIELD_NUM 讀 ----
  var FN = D.FIELD_NUM;
  function fieldDuo(seed, id, foes) {
    var s = duo("paladin", seed);
    var list = setFoes(s.st, foes);
    Core.setField(s.st, id);
    s.h.blk = 0; s.h.hp = s.h.max;
    return { st: s.st, h: s.h, e: list };
  }
  // 雷暴：預告區的敵人與該區英雄各受傷害，其他區不受影響；結束後換預告區
  var sm = fieldDuo(401, "storm", [{ id: "skel", hp: 40, ring: "near" }, { id: "skel", hp: 40, ring: "near" }]);
  sm.st.field.sec = Core.secOf(sm.st, 0);
  sm.e[1].sec = Core.secOf(sm.st, 1);
  endRound(sm.st);
  assert(sm.e[0].hp === 40 - FN.storm, "雷暴：預告區的敵人受 " + FN.storm + "，實際 " + sm.e[0].hp);
  assert(sm.e[1].hp === 40, "雷暴：其他區的敵人不受影響");
  assert(sm.h.hp === sm.h.max - FN.storm, "雷暴：預告區的英雄受 " + FN.storm + "，實際 " + (sm.h.max - sm.h.hp));
  assert(typeof sm.st.field.sec === "number" && sm.st.field.sec >= 0 && sm.st.field.sec < 2, "雷暴：每回合重新預告一個區");
  // 熔岩地：內圈敵人燃燒（敵人回合當下就結算一次）；近戰攻擊 +2
  var lv = fieldDuo(402, "lava", [{ id: "skel", hp: 40, ring: "near" }, { id: "skel", hp: 40, ring: "far" }]);
  endRound(lv.st);
  assert(lv.e[0].hp === 40 - FN.lava, "熔岩地：內圈敵人燒掉 " + FN.lava + "，實際 " + (40 - lv.e[0].hp));
  assert(lv.e[1].hp === 40, "熔岩地：外圈敵人不受影響");
  var lvHit = Core.enemyHitValue(lv.st, lv.e[0], 6, 0);
  Core.setField(lv.st, null);
  var lvBase = Core.enemyHitValue(lv.st, lv.e[0], 6, 0);
  Core.setField(lv.st, "lava");
  assert(lvHit > lvBase, "熔岩地：近戰敵人的攻擊變高（" + lvBase + " → " + lvHit + "）");
  // 血月：英雄傷害 ×1.25、敵人傷害也變高
  var mn = fieldDuo(403, "moon", [{ id: "skel", hp: 40, ring: "near" }]);
  mn.h.fld = null;
  var mnBase = Core.heroHitValue(mn.h, 20, "near", null);
  mn.h.fld = "moon";
  assert(Core.heroHitValue(mn.h, 20, "near", null) === Math.floor(mnBase * FN.moon), "血月：英雄傷害 ×" + FN.moon);
  var mnE = Core.enemyHitValue(mn.st, mn.e[0], 20, 0);
  Core.setField(mn.st, null);
  assert(mnE > Core.enemyHitValue(mn.st, mn.e[0], 20, 0), "血月：敵人傷害也變高");
  // 沙塵：打外圈 -2、外圈敵人攻擊變低；內圈不受影響
  var ds = fieldDuo(404, "dust", [{ id: "skel", hp: 40, ring: "far" }]);
  ds.h.fld = null;
  var dsFar = Core.heroHitValue(ds.h, 10, "far", null), dsNear = Core.heroHitValue(ds.h, 10, "near", null);
  ds.h.fld = "dust";
  assert(Core.heroHitValue(ds.h, 10, "far", null) === dsFar - FN.dust, "沙塵：打外圈 -" + FN.dust);
  assert(Core.heroHitValue(ds.h, 10, "near", null) === dsNear, "沙塵：打內圈不變");
  var dsE = Core.enemyHitValue(ds.st, ds.e[0], 10, 0);
  Core.setField(ds.st, null);
  assert(dsE < Core.enemyHitValue(ds.st, ds.e[0], 10, 0), "沙塵：外圈敵人的攻擊變低");
  // 強風：敵人回合結束後外圈敵人順時針移一區，內圈不動
  var wd = fieldDuo(405, "wind", [{ id: "skel", hp: 40, ring: "far" }, { id: "skel", hp: 40, ring: "near" }]);
  endRound(wd.st);
  assert(wd.e[0].sec === 1, "強風：外圈敵人移到下一區，實際 " + wd.e[0].sec);
  assert(wd.e[1].sec === 0, "強風：內圈敵人不動");
  // 漲潮：第 tideRound 回合開始時外圈敵人已經在內圈（之前不動）
  var td = fieldDuo(406, "tide", [{ id: "skel", hp: 400, ring: "far" }]);
  for (var tr = 1; tr < FN.tideRound - 1; tr++) endRound(td.st);
  assert(td.e[0].ring === "far", "漲潮：第 " + FN.tideRound + " 回合前不動");
  endRound(td.st);
  assert(td.st.round === FN.tideRound && td.e[0].ring === "near", "漲潮：第 " + FN.tideRound + " 回合開始時被沖進內圈，實際 " + td.e[0].ring + " / 回合 " + td.st.round);
  // 聖泉：新回合開始時英雄、敵人都回復
  var sp = fieldDuo(407, "spring", [{ id: "skel", hp: 20, max: 40, ring: "near" }]);
  sp.h.hp = sp.h.max - 10;
  endRound(sp.st);
  assert(sp.h.hp === sp.h.max - 10 + FN.springHero, "聖泉：英雄回復 " + FN.springHero + "，實際 " + (sp.h.hp - (sp.h.max - 10)));
  assert(sp.e[0].hp === 20 + Math.max(1, Math.floor(40 * FN.springFoe)), "聖泉：敵人回復最大血量 " + FN.springFoe * 100 + "%");
  // 冰原：一般敵人暈眩多 1 回合、菁英不變；英雄少抽 1 張
  var eliteId = D.ENEMIES.filter(function (x) { return x.elite; })[0].id;
  var ic = fieldDuo(408, "ice", [{ id: "skel", hp: 40, ring: "near" }, { id: eliteId, hp: 40, ring: "far" }]);
  Core.addStatus(ic.st, ic.e[0], "stun", 1, null);
  Core.addStatus(ic.st, ic.e[1], "stun", 1, null);
  assert(ic.e[0].st.stun === 1 + FN.iceStun, "冰原：一般敵人暈眩 " + (1 + FN.iceStun));
  assert(ic.e[1].st.stun === 1, "冰原：菁英暈眩照常 1");
  ic.h.hand = []; ic.h.disc = []; ic.h.draw = ic.h.deck.map(function (c) { return { u: c.u, id: c.id }; });
  Core.startHeroTurn(ic.st, ic.h);
  assert(ic.h.hand.length === D.HAND_SIZE - FN.iceDraw, "冰原：抽 " + (D.HAND_SIZE - FN.iceDraw) + " 張，實際 " + ic.h.hand.length);
  // 開戰抽戰場狀態：依幕數機率、單人不會抽到強風、可序列化
  for (var fp2 = 0; fp2 < fieldPct.length; fp2++) D.FIELD_PCT[fp2] = fieldPct[fp2];
  var fGot = 0, fTot = 0;
  for (var fs = 0; fs < 160; fs++) {
    var fst = Core.create({ seed: 5000 + fs, seats: [{ cls: "paladin" }, null, null, null] });
    goFloor(fst);
    if (fst.phase !== "battle") continue;
    fTot++;
    if (fst.field) { fGot++; assert(D.FIELD[fst.field.id] && !D.FIELD[fst.field.id].multi, "單人不會抽到只限多人的戰場狀態：" + fst.field.id); }
    JSON.parse(JSON.stringify(fst));
  }
  assert(Math.abs(fGot / fTot - D.FIELD_PCT[0] / 100) < 0.12, "第一幕約 " + D.FIELD_PCT[0] + "% 有戰場狀態，實際 " + (fGot / fTot).toFixed(2));
  for (var fp3 = 0; fp3 < D.FIELD_PCT.length; fp3++) D.FIELD_PCT[fp3] = 0;

  // ---- 雙人連攜卡（2026-10-27）----
  // 每職業剛好 2 組
  var duoDeg = {};
  D.DUO_CARDS.forEach(function (c) { c.duo.forEach(function (k) { duoDeg[k] = (duoDeg[k] || 0) + 1; }); });
  assert(D.DUO_CARDS.length === 19 && D.CLASSES.every(function (c) { return duoDeg[c.id] === 2; }), "連攜卡：19 組、每職業剛好 2 組");
  // 搭檔看得到的狀態（資源、護盾、力量、手牌數、生命…）有沒有變化
  function snap(x) { return JSON.stringify([x.blk, x.str, x.trap, x.sp, x.mel, x.chi, x.flux, x.edge, x.kek, x.ammo, x.beat, x.ce, x.dodge, x.hp, x.hand.length, x.taunt]); }
  function duoGame(a, b, seed) {
    var g = Core.create({ seed: seed, seats: [{ cls: a }, { cls: b }, null, null] });
    goFloor(g);
    Core.heroes(g).forEach(function (x) { x.hp = x.max - 20; x.hand = []; x.draw = x.deck.map(function (c) { return { u: c.u, id: c.id }; }); });
    var foes = setFoes(g, [{ id: "skel", hp: 500, ring: "near" }, { id: "skel", hp: 500, ring: "far" }]);
    return { st: g, foes: foes };
  }
  // 19 張 × 兩個方向：出牌者打出後，搭檔一定得到效果（紀錄 duo、搭檔狀態或敵人狀態有變化）
  D.DUO_CARDS.forEach(function (c, ci) {
    [0, 1].forEach(function (dir) {
      var a = c.duo[dir], b = c.duo[1 - dir];
      var g = duoGame(a, b, 700 + ci * 2 + dir);
      var holder = g.st.heroes[0], mate = g.st.heroes[1];
      var tgt = g.foes[c.rng === "far" ? 1 : 0];
      var before = snap(mate), foeBefore = JSON.stringify(tgt.st), seq = g.st.logSeq;
      var err = playCard(g.st, 0, c.id, c.tgt === "enemy" ? { e: tgt.u } : null);
      assert(!err, c.id + "（" + a + " 出牌）出牌失敗：" + err);
      var duoLog = g.st.log.filter(function (e) { return e.i > seq && e.t === "duo"; });
      assert(duoLog.length === 1 && duoLog[0].to.s === mate.seat, c.id + "（" + a + " 出牌）應連攜到 " + b);
      assert(snap(mate) !== before || JSON.stringify(tgt.st) !== foeBefore, c.id + "：" + b + " 的連攜效果沒有作用");
      void holder;
    });
  });
  // 搭檔倒下：只有出牌者的部分
  var dd = duoGame("dancer", "kensei", 760);
  dd.st.heroes[1].down = true;
  var ddSeq = dd.st.logSeq, edgeBefore = dd.st.heroes[1].edge || 0;
  playCard(dd.st, 0, "duo_swordance", { e: dd.foes[0].u });
  assert(!dd.st.log.some(function (e) { return e.i > ddSeq && e.t === "duo"; }) && (dd.st.heroes[1].edge || 0) === edgeBefore, "搭檔倒下時不連攜");
  assert(dd.foes[0].hp < 500, "搭檔倒下時出牌者的傷害照常");
  // 升級：搭檔的效果也強化
  var upDef = Core.cardDef({ id: "duo_swordance", up: true });
  assert(upDef.duoFx.kensei[0].n > D.CARD.duo_swordance.duoFx.kensei[0].n, "升級後搭檔的劍意也變多");
  // 獎勵：首領戰後必出、而且是這兩人的組合；沒有搭檔就不會出現
  var rw = duoGame("dancer", "kensei", 761);
  var opts = Core.rewardCards(rw.st, rw.st.heroes[0], "boss");
  var duoOpt = opts.filter(function (id) { return D.CARD[id].duo; });
  assert(duoOpt.length === 1 && D.CARD[duoOpt[0]].duo.indexOf("kensei") >= 0, "首領獎勵一定有舞孃＋劍豪的連攜卡：" + opts.join(","));
  assert(opts.length === 4, "連攜卡是第 4 個選項（成長方向的三張不變）");
  var solo = Core.create({ seed: 762, seats: [{ cls: "dancer" }, null, null, null] });
  goFloor(solo);
  assert(!Core.rewardCards(solo, solo.heroes[0], "boss").some(function (id) { return D.CARD[id].duo; }), "單人不會出現連攜卡");
  var nomate = duoGame("dancer", "mage", 763);
  assert(!Core.rewardCards(nomate.st, nomate.st.heroes[0], "boss").some(function (id) { return D.CARD[id].duo; }), "沒有搭檔職業就不會出現連攜卡");
  // 一般戰利品約 25%
  var dn = 0;
  for (var di = 0; di < 400; di++) if (Core.rewardCards(rw.st, rw.st.heroes[0], "spoils").some(function (id) { return D.CARD[id].duo; })) dn++;
  assert(Math.abs(dn / 400 - D.DUO_PCT.spoils / 100) < 0.07, "一般戰利品約 " + D.DUO_PCT.spoils + "% 有連攜卡，實際 " + (dn / 400).toFixed(2));

  // ---- 每日挑戰（2026-10-27）：只由日期決定 ----
  var dsA = Core.dailySetup("2026-10-27"), dsB = Core.dailySetup("2026-10-27");
  assert(JSON.stringify(dsA) === JSON.stringify(dsB), "每日挑戰：同一天的設定相同");
  assert(dsA.heroes.length === 4 && new Set(dsA.heroes).size === 4 && dsA.heroes.every(function (id) { return D.CLASS[id]; }), "每日挑戰：4 位不重複的英雄");
  assert(dsA.tmods.length >= 2 && dsA.tmods.length <= 3, "每日挑戰：2～3 個苦痛修正");
  var dsDiff = 0;
  for (var dd2 = 1; dd2 <= 20; dd2++) if (JSON.stringify(Core.dailySetup("2026-11-" + (dd2 < 10 ? "0" : "") + dd2).heroes) !== JSON.stringify(dsA.heroes)) dsDiff++;
  assert(dsDiff >= 18, "每日挑戰：不同天的英雄大多不同");
  // 同一天同人數：整局狀態完全相同（同 seed、同英雄、同修正）
  var dg1 = Core.createDaily("2026-10-27", 3), dg2 = Core.createDaily("2026-10-27", 3);
  assert(JSON.stringify(dg1) === JSON.stringify(dg2), "每日挑戰：同一天同人數的開局完全相同");
  assert(Core.heroes(dg1).map(function (h) { return h.cls; }).sort().join() === dsA.heroes.slice(0, 3).sort().join(), "每日挑戰：3 人時是當天英雄的前 3 位");
  assert(dg1.daily === "2026-10-27" && dg1.tmods.length === dsA.tmods.length && dg1.torment === 0 && !dg1.endless, "每日挑戰：日期、修正、苦痛 0、非無盡");
  assert(Core.heroes(dg1).every(function (h) { return h.lv === 99 && !h.relics.length; }), "每日挑戰：卡牌全解鎖、沒有出發遺物");
  // 修正整局有效：推進很多層也不會消失；回合數會累計
  for (var df = 0; df < 8; df++) Core.nextFloor(dg2);
  assert(dg2.tmods.length === dsA.tmods.length, "每日挑戰：修正整局有效");
  var dt = duoGame("paladin", "priest", 790);
  var dt0 = dt.st.turns;
  endRound(dt.st); endRound(dt.st);
  assert(dt.st.turns === dt0 + 2, "整局回合數會累計");
  // 成績比較：通關＞推進；同樣時回合少的好
  assert(Core.dailyBetter({ win: true, act: 2, floor: 3, turns: 99 }, { win: false, act: 2, floor: 3, turns: 10 }), "通關比沒通關好");
  assert(Core.dailyBetter({ win: false, act: 1, floor: 2, turns: 50 }, { win: false, act: 1, floor: 1, turns: 10 }), "推進得遠比較好");
  assert(Core.dailyBetter({ win: true, act: 2, floor: 3, turns: 60 }, { win: true, act: 2, floor: 3, turns: 70 }), "同樣通關時回合少的好");
  assert(!Core.dailyBetter({ win: true, act: 2, floor: 3, turns: 70 }, { win: true, act: 2, floor: 3, turns: 60 }), "回合多的不是新紀錄");

  // 敵人狂怒（2026-10-27 修正僵局）：第 ENRAGE.round 回合起每回合力量增加
  var en = duoGame("paladin", "priest", 791);
  en.foes.forEach(function (e) { e.intent = []; });
  en.st.round = D.ENRAGE.round - 2;
  var enStr = en.foes[0].str;
  endRound(en.st);
  assert(en.foes[0].str === enStr, "狂怒前力量不變");
  endRound(en.st);
  assert(en.foes[0].str === enStr + D.ENRAGE.str, "第 " + D.ENRAGE.round + " 回合起每回合力量 +" + D.ENRAGE.str);

  // ---- 高難度地圖（2026-10-27）：一般冒險不會抽到 hard 區域；高難度每幕都是 hard 區域 ----
  function regsThrough(st) {
    for (var k = 0; k < D.FLOORS.length * D.ACTS.length - 1; k++) Core.nextFloor(st);
    return st.regs.map(function (id) { return D.REGION[id]; });
  }
  for (var hs = 0; hs < 12; hs++) {
    var nrm = regsThrough(Core.create({ seed: 900 + hs, seats: [{ cls: "paladin" }, null, null, null] }));
    assert(nrm.length === 3 && nrm.every(function (r) { return r && !r.hard; }), "一般冒險不會抽到高難度區域：" + nrm.map(function (r) { return r && r.id; }));
    var hd = regsThrough(Core.create({ seed: 900 + hs, seats: [{ cls: "paladin" }, null, null, null], hard: true }));
    assert(hd.length === 3 && hd.every(function (r, i) { return r && r.hard && r.tier === i; }), "高難度每幕都是同 tier 的高難度區域：" + hd.map(function (r) { return r && r.id; }));
  }
  // 繁殖：每 every 回合在自己的區域生出一隻
  var hb = duoGame("paladin", "priest", 800);
  var brood = setFoes(hb.st, [{ id: "h_brood", hp: 500, ring: "far" }])[0];
  brood.intent = [];
  var every = D.ENEMY.h_brood.breed.every;
  for (var bi = 0; bi < every - 1; bi++) { hb.st.enemies.forEach(function (e) { e.intent = []; }); endRound(hb.st); }
  assert(hb.st.enemies.length === 1, "繁殖：還沒到回合數不生");
  hb.st.enemies.forEach(function (e) { e.intent = []; });
  endRound(hb.st);
  assert(hb.st.enemies.length === 2 && hb.st.enemies[1].id === D.ENEMY.h_brood.breed.id && hb.st.enemies[1].sec === brood.sec, "繁殖：第 " + every + " 回合在同一區生出 " + D.ENEMY.h_brood.breed.id);
  function hgame(seed) { var g = duoGame("paladin", "priest", seed); g.h = g.st.heroes[0]; return g; }
  // 寒氣：打掉生命時英雄下回合魔力減少；被護盾擋住不算
  var fc = hgame(801);
  var guard = setFoes(fc.st, [{ id: "f_guard", hp: 500, ring: "near" }])[0];
  fc.h.blk = 0; fc.h.debt = 0;
  Core.runEnemyAct(fc.st, guard, { k: "atk", n: 8 });
  assert(fc.h.debt === D.ENEMY.f_guard.chill, "寒氣：下回合魔力 -" + D.ENEMY.f_guard.chill);
  fc.h.blk = 999; fc.h.debt = 0;
  Core.runEnemyAct(fc.st, guard, { k: "atk", n: 8 });
  assert(fc.h.debt === 0, "寒氣：被護盾完全擋住不算");
  // 堅壁：敵人回合開始清掉護盾後得到 fortify
  var fk = hgame(802);
  var bot2 = setFoes(fk.st, [{ id: "k_bot", hp: 500, ring: "near", intent: [] }])[0];
  bot2.blk = 50;
  Core.enemyTurn(fk.st, bot2);
  assert(bot2.blk === D.ENEMY.k_bot.fortify, "堅壁：回合開始後護盾＝" + D.ENEMY.k_bot.fortify + "，實際 " + bot2.blk);
  // 嗜血：吸血攻擊打掉生命時力量增加
  var fv = hgame(803);
  var bat = setFoes(fv.st, [{ id: "v_bat", hp: 5, max: 500, ring: "far" }])[0];
  fv.h.blk = 0;
  Core.runEnemyAct(fv.st, bat, { k: "atk", n: 5, drain: true });
  assert(bat.str === D.ENEMY.v_bat.thirst && bat.hp > 5, "嗜血：吸血成功後力量 +" + D.ENEMY.v_bat.thirst);
  // 虛隱：外圈受到的傷害減半、內圈照常
  var fx2 = hgame(804);
  var wisp = setFoes(fx2.st, [{ id: "x_wisp", hp: 100, ring: "far" }])[0];
  Core.hitEnemy(fx2.st, wisp, 10, true);
  assert(wisp.hp === 95, "虛隱：外圈 10 傷害只受 5，實際 " + (100 - wisp.hp));
  wisp.ring = "near";
  Core.hitEnemy(fx2.st, wisp, 10, true);
  assert(wisp.hp === 85, "虛隱：內圈照常受傷");
  // 光環：其他活著的敵人攻擊變高，自己不算
  var fa2 = hgame(805);
  var pair = setFoes(fa2.st, [{ id: "skel", hp: 100, ring: "near" }, { id: "c_seraph", hp: 100, ring: "far" }]);
  var withAura = Core.enemyHitValue(fa2.st, pair[0], 10, 0), selfAura = Core.enemyHitValue(fa2.st, pair[1], 10, 0);
  pair[1].hp = 0;
  var noAura = Core.enemyHitValue(fa2.st, pair[0], 10, 0);
  pair[1].hp = 100;
  assert(withAura > noAura, "光環：天使活著時其他敵人的攻擊變高（" + noAura + " → " + withAura + "）");
  assert(selfAura === noAura, "光環：不加在自己身上");

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
  for (var fp4 = 0; fp4 < fieldPct.length; fp4++) D.FIELD_PCT[fp4] = fieldPct[fp4];
})();

console.log(JSON.stringify(summary));
if (fails) { console.log("失敗 " + fails + " 局"); process.exit(1); }
console.log("OK " + games + " 局");
