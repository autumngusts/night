// 鐵拳教育：搜打撤模式的自動對局檢查（node 直接跑）：
//   node tools/fist_check/raid_check.js [局數，預設 300] [格鬥反應準度 0〜1，預設 0.6]
// 用簡單 bot 從新的辦公桌開始連續潛入，檢查：不丟例外、不會卡住、數值合法、背包不超重、位置都在開放區域、
// 案件資料一致（主謀唯一、筆記的特徵值合法）；印出撤離率、失敗原因、平均帶出的證據值、章節推進、鑰匙、破案。
"use strict";

global.window = global;
require("../../static_src/fist_data.js");
require("../../static_src/fist_raid_data.js");
require("../../static_src/fist_raid_text.js");
require("../../static_src/fist_raid_core.js");
require("../../static_src/fist_fight.js");
var D = global.PriTestFistData;
var R = global.PriTestFistRaidData;
var Core = global.PriTestFistRaidCore;
var Fight = global.PriTestFistFight;
var simFight = require("./bot.js").simFight;

var RAIDS = Number(process.argv[2]) || 300;
var SKILL = process.argv[3] !== undefined ? Number(process.argv[3]) : 0.6;

function assert(c, m) { if (!c) throw new Error(m); }

function check(st) {
  var me = st.me;
  ["hp", "max", "heat", "cd"].forEach(function (k) { assert(typeof me[k] === "number" && isFinite(me[k]) && me[k] >= 0, "me." + k + " 異常 " + me[k]); });
  assert(me.hp <= me.max, "體力超過上限");
  assert(me.heat <= D.MAX_HEAT, "熱血超過上限");
  assert(Core.used(me.bag) <= me.bagMax, "背包超重");
  assert(st.alert >= 0 && st.alert <= 100, "察覺度異常 " + st.alert);
  assert(Core.open(st, me.at), "老師在不開放的地點 " + me.at);
  me.path.forEach(function (id) { assert(Core.open(st, id), "路線經過上鎖區域 " + id); });
  assert(st.exits.length >= 1, "沒有撤離點");
  st.exits.forEach(function (id) { assert(Core.open(st, id), "撤離點在上鎖區域"); });
  st.bullies.forEach(function (b) {
    assert(D.ENEMY[b.id] && Core.open(st, b.at), "霸凌者位置異常 " + b.at);
    assert(b.hp > 0 && b.hp <= b.max, "霸凌者氣焰異常 " + b.hp);
    if (b.boss) assert(b.wall >= 0 && b.wall <= b.wallMax, "權力之壁異常");
  });
  st.students.forEach(function (x) { assert(Core.open(st, x.at) && st.cs.cast[x.s], "學生位置異常"); });
  assert(Core.witnesses(st).length <= R.MAX_WITNESS, "證人太多");
  st.victims.forEach(function (v) { assert(v.hp > 0 && v.hp <= v.max && !st.cs.cast[v.s].role, "學生心靈異常／主謀共犯當了受害者"); });
  var cs = st.cs;
  assert(cs.cast.filter(function (c) { return c.role === "mm"; }).length === 1 && cs.cast[cs.mm].role === "mm", "主謀不唯一");
  cs.notes.forEach(function (n) { assert(R.ATTR[n.a] && n.v >= 0 && n.v < R.ATTR[n.a].vals.length, "筆記特徵值異常"); });
}

function nearest(st, ids) {
  return ids.filter(function (id) { return Core.route(st, st.me.at, id); }).sort(function (a, b) { return Core.dist(st.me.at, a) - Core.dist(st.me.at, b); })[0] || null;
}
function evidVal(bag) { return bag.reduce(function (s, id) { return s + (R.ITEM[id].kind === "evid" ? R.ITEM[id].val : 0); }, 0); }

// bot 的推理：每個特徵取筆記裡最多人說的值，符合最多的人就是嫌犯（線索 4 條以上、領先第二名才指認）
function suspect(cs) {
  if (cs.solved || cs.notes.length < 4) return -1;
  var vote = {};
  cs.notes.forEach(function (n) { var k = n.a + ":" + n.v; vote[k] = (vote[k] || 0) + (n.how === "talk" ? 1 : 2); });
  var best = {};
  Object.keys(vote).forEach(function (k) { var a = k.split(":")[0]; if (!best[a] || vote[k] > vote[best[a]]) best[a] = k; });
  var scores = cs.cast.map(function (c, i) {
    if (cs.refused[i] || cs.confessed[i]) return -1;
    return Object.keys(best).filter(function (a) { return R.ATTR[a].vals[Number(best[a].split(":")[1])] === c[a]; }).length;
  });
  var top = Math.max.apply(null, scores);
  var who = scores.filter(function (s) { return s === top; });
  return who.length === 1 && top >= 3 ? scores.indexOf(top) : -1;
}

function decide(st) {
  var me = st.me, t = Core.here(st);
  var bs = Core.hereBullies(st);
  var bag = me.bag;
  if (st.dialog) return { t: "closeDialog" };
  if (me.hp <= me.max * 0.45) {
    var med = bag.indexOf("onigiri") >= 0 ? "onigiri" : bag.indexOf("bandage") >= 0 ? "bandage" : null;
    if (med) return { t: "use", i: med };
  }
  var free = me.bagMax - Core.used(bag);
  var hasToken = bag.some(function (id) { return R.ITEM[id].kind === "token" || R.ITEM[id].kind === "key"; });
  var leave = st.lock || st.alert >= 72 || free <= 0 || hasToken || me.hp <= 3;
  if (leave) {
    if (Core.isExit(st, t.id)) return bs.length ? { t: "fight" } : { t: "extract" };
    return { t: "move", to: nearest(st, st.exits) };
  }
  var fl = st.floor[t.id] || [];
  for (var i = 0; i < fl.length; i++) if (R.ITEM[fl[i]].size <= free) return { t: "take", i: fl[i] };
  var boss = Core.boss(st);
  if (boss && boss.at === me.at) {
    if (Core.walled(boss)) {
      var e = bag.filter(function (id) { return R.ITEM[id].kind === "evid"; })[0];
      if (e) return { t: "expose", i: e };
    } else if (me.hp >= me.max * 0.6) return { t: "fight" };
  }
  if (bs.length) {
    if (!st.proof[t.id] && !bs.some(function (b) { return b.boss; })) return { t: "photo" };
    if (bs.some(function (b) { return !Core.walled(b); }) && me.hp > me.max * 0.4) return { t: "fight" };
  }
  // 學生：嫌犯就指認，沒說過話的就聊
  var sus = suspect(st.cs);
  var stu = Core.studentsAt(st, me.at);
  for (var j = 0; j < stu.length; j++) {
    if (stu[j].s === sus) return { t: "accuse", u: stu[j].u };
    if (!st.talked[stu[j].s] && !st.cs.refused[stu[j].s]) return { t: "chat", u: stu[j].u };
  }
  var spots = st.spots[t.id] || [];
  if (spots.some(function (s) { return !s.done; }) && !bs.some(function (b) { return b.stun <= 0; })) return { t: "search" };
  if (t.type === "office" && me.hp < me.max * 0.6) return { t: "rest" };
  if (sus >= 0) {
    var x = st.students.filter(function (y) { return y.s === sus; })[0];
    if (x && me.hp > me.max * 0.6) return { t: "move", to: x.at };
  }
  if (boss && Core.walled(boss) && evidVal(bag) >= Math.min(boss.wall, 6) && me.hp > me.max * 0.6) return { t: "move", to: boss.at };
  if (boss && !Core.walled(boss) && me.hp > me.max * 0.7) return { t: "move", to: boss.at };
  var talk = st.students.filter(function (y) { return !st.talked[y.s] && !st.cs.refused[y.s] && Core.dist(me.at, y.at) <= 3; })[0];
  if (talk) return { t: "move", to: talk.at };
  var bossAt = boss ? boss.at : null;
  var targets = R.TILES.filter(function (x2) { return x2.id !== bossAt && x2.id !== t.id && Core.open(st, x2.id) && (st.spots[x2.id] || []).some(function (s) { return !s.done; }); })
    .map(function (x2) { return x2.id; });
  var tg = nearest(st, targets);
  if (tg) return { t: "move", to: tg };
  return { t: "move", to: nearest(st, st.exits) };
}

function runRaid(p, seed) {
  var cls = D.CLASSES[seed % D.CLASSES.length].id;
  var take = [];
  var room = Core.bagMax(p) - 2;
  p.stash.forEach(function (id, i) { if (R.ITEM[id].kind === "sup" && take.length < 2 && room > 0) { take.push(i); room -= 1; } });
  var st = Core.create(p, { cls: cls, take: take, seed: seed * 7919 + 13 });
  check(st);
  var dt = 0.1, steps = 0, fights = 0;
  while (st.phase === "raid") {
    steps += 1;
    assert(steps < 30000, "卡住了（" + st.t.toFixed(0) + " 秒）");
    if (st.fight) {
      var foes = st.fight.us.map(function (u) { return Core.bully(st, u); }).filter(Boolean);
      var r = simFight(Fight, D, { bullies: foes.map(function (b) { return { u: b.u, id: b.id, x: 0, y: 0, hp: b.hp, max: b.max, boss: b.boss, wall: b.wall, stun: b.stun > 0 }; }) },
        { x: 0, y: 0, cls: st.cls, pow: st.me.pow, talk: st.me.talk, heat: st.me.heat, hp: st.me.hp, max: st.me.max }, SKILL, seed + steps);
      assert(Core.applyFight(st, r) === null, "applyFight 失敗");
      fights += 1;
    } else if (!st.me.act && !st.me.path.length) {
      var a = decide(st);
      if (a.t === "move" && !a.to) a = { t: "stop" };
      Core.act(st, a);
    }
    Core.tick(st, dt);
    st.events.length = 0;
    check(st);
  }
  var out = Core.settle(p, st);
  assert(Core.stashUsed(p) <= R.STASH, "倉庫超過上限");
  return { st: st, out: out, fights: fights, cls: cls };
}

var sum = { raids: 0, why: {}, value: 0, extracts: 0, t: 0, fights: 0, chAt: [], byCls: {}, rescued: 0, broke: 0, comp: 0, wrong: 0, solved: [], keys: [] };
var careers = 0, fails = 0;
var p = Core.newProfile();
for (var n = 1; n <= RAIDS; n++) {
  try {
    var res = runRaid(p, n);
    sum.raids += 1;
    sum.why[res.st.result] = (sum.why[res.st.result] || 0) + 1;
    sum.t += res.st.t;
    sum.fights += res.fights;
    sum.rescued += res.st.stats.rescued;
    sum.broke += res.st.stats.broke;
    sum.comp += res.st.stats.comp;
    sum.wrong += res.st.stats.wrong;
    var bc = sum.byCls[res.cls] = sum.byCls[res.cls] || { n: 0, ok: 0 };
    bc.n += 1;
    if (res.st.result === "extract") { sum.extracts += 1; sum.value += res.out.value; bc.ok += 1; }
    if (res.out.ch) sum.chAt.push(n);
    if (res.out.solved) sum.solved.push(n);
    res.out.keys.forEach(function (k) { sum.keys.push(k + "@" + n); });
    // bot 的辦公桌：證據全部換聲望，能買就買
    for (var i = p.stash.length - 1; i >= 0; i--) if (R.ITEM[p.stash[i]].kind === "evid") Core.submit(p, i);
    ["bag", "hp", "eye", "pocket"].forEach(function (k) { Core.buy(p, k); });
    // 存檔來回一次（JSON）確認讀得回來
    p = Core.loadProfile(JSON.parse(JSON.stringify(p)));
    if (res.out.won) { careers += 1; p = Core.newProfile(); }
  } catch (err) {
    fails += 1;
    console.log("第 " + n + " 局失敗：" + err.stack);
    if (fails > 5) break;
  }
}

function pct(a, b) { return b ? Math.round(100 * a / b) + "%" : "-"; }
console.log("潛入 " + sum.raids + " 局（格鬥反應 " + SKILL + "）");
console.log("  結果：" + Object.keys(sum.why).map(function (k) { return k + " " + pct(sum.why[k], sum.raids); }).join("、"));
console.log("  平均時間 " + (sum.t / sum.raids).toFixed(0) + " 秒、格鬥 " + (sum.fights / sum.raids).toFixed(1) + " 場、救出 " + (sum.rescued / sum.raids).toFixed(1) +
  "、崩潰 " + (sum.broke / sum.raids).toFixed(1) + "、投訴 " + (sum.comp / sum.raids).toFixed(1) + "、冤枉 " + (sum.wrong / sum.raids).toFixed(2));
console.log("  撤離成功時平均帶出證據值 " + (sum.extracts ? (sum.value / sum.extracts).toFixed(1) : "-"));
console.log("  推進章節在第 " + sum.chAt.join("、") + " 局；通關 " + careers + " 次");
console.log("  破案在第 " + sum.solved.join("、") + " 局；鑰匙 " + sum.keys.join("、"));
console.log("  各老師撤離率：" + Object.keys(sum.byCls).map(function (k) { return k + " " + pct(sum.byCls[k].ok, sum.byCls[k].n); }).join("、"));
console.log(fails ? "有 " + fails + " 局出錯" : "全部通過");
process.exit(fails ? 1 : 0);
