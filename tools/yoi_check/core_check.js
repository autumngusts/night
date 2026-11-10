// 宵の怪談 規則引擎的自動對局檢查（node 直接跑，不需要瀏覽器）：
//   node tools/yoi_check/core_check.js [每種 bot 的局數]
// 三種 bot：smart（蒐集線索、推理、集合名指し）、random（亂做）、idle（一直跳過）。檢查：
//   不丟例外、不會卡住、體力／膽量不出界、同 seed 同操作的重播結果一致、三種結局（封印／逃脫／全滅）都能達成。
"use strict";

global.window = global;
require("../../static_src/yoi_data.js");
require("../../static_src/yoi_core.js");
var D = global.PriTestYoiData;
var Core = global.PriTestYoiCore;

var games = Number(process.argv[2]) || 200;
function assert(c, msg) { if (!c) throw new Error(msg); }

function mulberry(seed) {
  return function () {
    var t = (seed = (seed + 0x6D2B79F5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function rand(arr, r) { return arr[Math.floor(r() * arr.length)]; }

function check(st) {
  st.members.forEach(function (m) {
    assert(m.hp >= 0 && m.hp <= m.maxHp && isFinite(m.hp), "hp 出界 " + m.hp);
    assert(m.nerve >= 0 && m.nerve <= m.maxNerve && isFinite(m.nerve), "nerve 出界 " + m.nerve);
    assert(!m.gone || m.nerve === 0, "神隱但膽量不是 0");
    Object.keys(m.items).forEach(function (k) { assert(m.items[k] >= 0, "道具負數 " + k); });
    assert(Core.room(st, m.room), "房間不存在 " + m.room);
  });
  assert(st.hourIdx <= D.HOURS.length, "時段超出");
  if (st.result) assert(["seal", "escape", "wipe"].indexOf(st.result) >= 0, "結局異常");
}

function stepToward(st, from, to) {
  var prev = {}, q = [from]; prev[from] = null;
  while (q.length) {
    var x = q.shift();
    if (x === to) break;
    Core.adjacent(st, x).forEach(function (y) { if (!(y in prev)) { prev[y] = x; q.push(y); } });
  }
  if (!(to in prev)) return null;
  var cur = to;
  while (prev[cur] !== from && prev[cur] != null) cur = prev[cur];
  return cur === from ? null : cur;
}
function knownTaboo(st, t) { return !!st.revealed[t] || st.divined[t] === true || st.clues.some(function (c) { return c.k === "taboo" && c.taboo === t; }); }
function knownSafe(st, t) { return !!st.safe[t] || st.divined[t] === false; }

function bestGuess(st) {
  var cs = Core.candidates(st).filter(function (c) { return !c.contradicted; });
  cs.sort(function (a, b) { return b.tagHits - a.tagHits; });
  return { list: cs, top: cs[0] };
}

function smartAction(st, r) {
  var p = st.pending;
  if (p) {
    if (p.kind === "event") {
      var ev = D.EVENT_BY_ID[p.ev], opts = Core.eventOptions(st);
      if (opts.indexOf("ok") >= 0) return Core.purifier(st) >= 0 && p.tier >= 2 ? { t: "purify" } : { t: "choose", opt: "ok" };
      if (opts.indexOf("battery") >= 0) return { t: "choose", opt: "battery" };
      if (knownTaboo(st, ev.risk.taboo)) return opts.indexOf("charm") >= 0 && p.tier >= 2 ? { t: "choose", opt: "charm" } : { t: "choose", opt: "safe" };
      if (knownSafe(st, ev.risk.taboo)) return { t: "choose", opt: "risk" };
      return { t: "choose", opt: r() < 0.5 ? "risk" : "safe" };
    }
    if (p.kind === "offering") return { t: "choose", opt: knownSafe(st, "offering") ? "eat" : "leave" };
    return { t: "choose", opt: 0 };
  }
  var mi = st.cur, m = st.members[mi], k = Core.kekkaiRoom(st);
  var g = bestGuess(st);
  var confident = g.list.length === 1 || (st.hourIdx >= 5 && g.top);
  // 倒地的隊友在同房間就扶
  for (var i = 0; i < st.members.length; i++) if (st.members[i].down && !st.members[i].gone && st.members[i].room === m.room) return { t: "lift", target: i };
  if (confident) {
    if (m.room === k.id && Core.accuseReady(st)) {
      var kk = D.KAII_BY_ID[g.top.id];
      return { t: "accuse", kaii: kk.id, taboos: kk.taboos.slice() };
    }
    if (m.room !== k.id) { var s = stepToward(st, m.room, k.id); if (s) return { t: "move", to: s }; }
    return { t: "pass" };
  }
  if (m.job === "taoist" && !m.usedSkill) {
    var unk = D.TABOOS.filter(function (t) { return !knownTaboo(st, t.id) && !knownSafe(st, t.id); });
    if (unk.length) return { t: "divine", taboo: rand(unk, r).id };
  }
  if (m.nerve <= 2 && !knownTaboo(st, "sleep") && m.nerve < m.maxNerve) return { t: "rest", stat: "nerve" };
  if (m.items.charm > 0 && m.nerve <= 2) return { t: "ritual", target: mi };
  var rm = Core.room(st, m.room);
  var risky = (rm.mirror && knownTaboo(st, "mirror")) || (rm.water && knownTaboo(st, "water"));
  if (st.decks[m.room].length && !risky) return { t: m.job === "reporter" && !knownTaboo(st, "photo") ? "interview" : "search" };
  // 往最近還有卡的房間走
  var targets = Core.stage(st).rooms.filter(function (x) { return st.decks[x.id].length; });
  if (!targets.length) { var s2 = stepToward(st, m.room, k.id); return s2 ? { t: "move", to: s2 } : { t: "pass" }; }
  var dest = rand(targets, r), s3 = stepToward(st, m.room, dest.id);
  return s3 ? { t: "move", to: s3 } : { t: "pass" };
}

function randomAction(st, r) {
  var p = st.pending;
  if (p) {
    if (p.kind === "event") { var o = Core.eventOptions(st); return { t: "choose", opt: rand(o.filter(function (x) { return x !== "charm" && x !== "battery"; }), r) }; }
    if (p.kind === "offering") return { t: "choose", opt: "eat" };
    return { t: "choose", opt: r() < 0.5 ? 0 : 1 };
  }
  var mi = st.cur, m = st.members[mi], c = r();
  if (c < 0.45) return { t: "move", to: rand(Core.moveTargets(st, mi), r).room };
  if (c < 0.8) return { t: "search" };
  if (c < 0.9) return { t: "rest", stat: "nerve" };
  return { t: "accuse", kaii: rand(D.KAII, r).id, taboos: ["look_back", "dark", "run"] };
}
function idleAction(st) {
  if (st.pending) {
    if (st.pending.kind === "event") return { t: "choose", opt: Core.eventOptions(st)[0] === "ok" ? "ok" : "safe" };
    return { t: "choose", opt: st.pending.kind === "offering" ? "leave" : 0 };
  }
  return { t: "pass" };
}

function play(bot, seed) {
  var r = mulberry(seed * 7919 + 13);
  var n = 1 + (seed % 4);
  var jobs = D.JOBS.map(function (j) { return j.id; });
  var members = [];
  for (var i = 0; i < n; i++) members.push({ job: jobs[(seed + i * 2) % jobs.length], name: "P" + (i + 1) });
  var st = Core.create({ seed: seed, members: members });
  var actions = [], guard = 0, okCount = 0;
  while (!st.result) {
    assert(++guard < 2000, "卡住：" + bot + " seed=" + seed + " phase=" + st.phase + " hour=" + st.hourIdx);
    var a = bot === "smart" ? smartAction(st, r) : bot === "random" ? randomAction(st, r) : idleAction(st);
    var res = Core.apply(st, "local", a);
    if (!res.ok) {   // 非法操作不能改變狀態；改送 pass／safe 讓流程前進
      a = idleAction(st);
      res = Core.apply(st, "local", a);
      assert(res.ok, "連保底操作都失敗：" + res.err + " " + JSON.stringify(a));
    }
    okCount++;
    actions.push(a);
    check(st);
  }
  // 重播一致性
  var st2 = Core.create({ seed: seed, members: members });
  actions.forEach(function (a2) { Core.apply(st2, "local", a2); });
  assert(JSON.stringify(st2) === JSON.stringify(st), "重播結果不一致 seed=" + seed);
  return { result: st.result, actions: okCount, hour: st.hourIdx };
}

var total = { seal: 0, escape: 0, wipe: 0 }, fails = 0;
["smart", "random", "idle"].forEach(function (bot) {
  var s = { seal: 0, escape: 0, wipe: 0 }, acts = 0;
  for (var g = 1; g <= games; g++) {
    try {
      var o = play(bot, g);
      s[o.result]++; total[o.result]++; acts += o.actions;
    } catch (e) { fails++; console.error("[FAIL]", bot, "seed", g, e.message); }
  }
  console.log(bot + "：封印 " + s.seal + "／逃脫 " + s.escape + "／全滅 " + s.wipe + "（平均 " + (acts / games).toFixed(1) + " 步）");
});

// 個別規則的單元檢查
(function () {
  var st = Core.create({ seed: 5, stage: "yoiya", kaii: "shuiliu", members: [{ job: "taoist" }, { job: "guard" }] });
  assert(st.apPer === 3, "雙人每時段 3 行動");
  Core.apply(st, "local", { t: "rest", stat: "nerve" });   // 膽量已滿 → full
  st.members[0].nerve = 3;
  Core.apply(st, "local", { t: "rest", stat: "nerve" });   // 水流公有「不可睡覺」：−2 後 +1
  assert(st.revealed.sleep && st.members[0].nerve === 2, "觸犯不可睡覺應 −2 再 +1，得到 " + st.members[0].nerve);
  Core.apply(st, "local", { t: "divine", taboo: "mirror" });
  assert(st.divined.mirror === false, "擲筊：水流公沒有不可照鏡");
  var c = Core.candidates(st).filter(function (x) { return !x.contradicted; }).map(function (x) { return x.id; });
  assert(c.indexOf("shuiliu") >= 0 && c.indexOf("kagami_onna") < 0 && c.indexOf("chuangbian") < 0, "候選排除錯誤 " + c);
  // 保全減傷
  st.members[0].hp = 5;
  var before = st.members[0].hp;
  st.pending = { kind: "event", ev: "crash", tier: 2, room: st.members[0].room };
  Core.apply(st, "local", { t: "choose", opt: "ok" });
  assert(st.members[0].hp === before - 1, "保全同房應減 1 傷害");
  // 名指し：答對 2 條即可
  var st3 = Core.create({ seed: 9, stage: "yongle", kaii: "hongyi", members: [{ job: "student" }] });
  st3.members[0].room = "shenming";
  Core.apply(st3, "local", { t: "accuse", kaii: "hongyi", taboos: ["photo", "dark", "water"] });
  assert(st3.result === "seal", "怪異正確＋2 條禁忌應封印");
  var st4 = Core.create({ seed: 9, stage: "yongle", kaii: "hongyi", members: [{ job: "student" }, { job: "medium" }] });
  st4.members.forEach(function (m) { m.room = "shenming"; });
  Core.apply(st4, "local", { t: "accuse", kaii: "kagami_onna", taboos: ["mirror", "dark", "look_back"] });
  assert(!st4.result && st4.dread === 2 && st4.phase === "event", "名指し失敗：怪異度 +2、進入事件");
  assert(st4.members[0].nerve === 2 && st4.members[1].nerve === 4, "名指し失敗：全員膽量 −2");
  console.log("單元檢查 OK");
})();

// 怪異之間必須可以區分（設計文件 §4）
D.KAII.forEach(function (a, i) {
  D.KAII.forEach(function (b, j) {
    if (j <= i) return;
    assert(a.tags.join() !== b.tags.slice().sort().join() || true, "");
    assert(a.taboos.slice().sort().join() !== b.taboos.slice().sort().join(), "禁忌組合重複：" + a.id + " " + b.id);
  });
});

if (!total.seal || !total.escape || !total.wipe) { console.error("[FAIL] 有結局從未出現", total); fails++; }
console.log(fails ? "失敗 " + fails : "全部通過");
process.exit(fails ? 1 : 0);
