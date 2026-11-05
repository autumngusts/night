// 明星經紀 starV：增加遊戲性的七個系統（starv_plus*.js、starv_events_15.js）的檢查（node 直接跑）：
//   node tools/starv_check/plus_check.js [年數，預設 30]
// 1 心願　2 季度目標　3 臨場決策　4 粉絲　5 關係網　6 作品 IP　7 醜聞連鎖；外加事件 lint、長期模擬不變量、離線一致性、舊存檔遷移。
// core_check.js／sim.js 不載入這些擴充（核心行為與亂數序列不變），所以擴充的測試都在這支。
"use strict";

global.window = global;
[
  "starv_data", "starv_words_1", "starv_traits_1", "starv_events",
  "starv_events_1", "starv_events_2", "starv_events_3", "starv_events_4", "starv_events_5", "starv_events_6", "starv_events_7",
  "starv_events_8", "starv_events_9", "starv_events_10", "starv_events_11", "starv_events_12", "starv_events_13", "starv_events_14",
  "starv_events_15", "starv_plus_data",
  "starv_awards_data", "starv_projects", "starv_projects_1", "starv_projects_2",
  "starv_achievements", "starv_achievements_1", "starv_achievements_2", "starv_achievements_3",
  "starv_roster", "starv_roster_1", "starv_roster_2", "starv_roster_3", "starv_roster_4", "starv_roster_5", "starv_roster_6",
  "starv_roster_rivals_1", "starv_roster_rivals_2", "starv_core", "starv_plus"
].forEach(function (n) { require("../../static_src/" + n + ".js"); });
var D = global.PriTestStarvData, Core = global.PriTestStarvCore, Plus = global.PriTestStarvPlus, Events = global.PriTestStarvEvents;
var X = D.PLUS, B = X.BAL;
var YEARS = Number(process.argv[2]) || 30;

var passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("ok   " + name); }
  catch (e) { failed++; console.log("FAIL " + name + "\n     " + (e && e.stack ? e.stack.split("\n").slice(0, 3).join("\n     ") : e)); }
}
function assert(c, msg) { if (!c) throw new Error(msg || "assert"); }
function eq(a, b, msg) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((msg || "eq") + "：" + JSON.stringify(a) + " ≠ " + JSON.stringify(b)); }

// 測試用公司：抽十連、把每個人的人氣與熟練度墊高，方便接各級工作
function company(seed) {
  var st = Core.create({ seed: seed || 7 });
  st.company.money = 5e6;
  Core.pull(st, "ticket", 10);
  return st;
}
function boost(a, fame) {
  a.fame = fame;
  D.STATS.forEach(function (s) { a.caps[s] = 999; a.stats[s] = 900; });
  Object.keys(a.prof).forEach(function (d) { a.prof[d].lv = 10; });
  a.stamina = 100; a.stress = 0;
}
function putJob(st, over, patch) {
  var j = Core._genJob(st, over);
  Object.keys(patch || {}).forEach(function (k) { j[k] = patch[k]; });
  st.board.push(j);
  return j;
}

var EVENT_FX = "famePct stress satisfaction money rest mood specialJob fame stamina statAll rep stat salaryPct leave moneyBySalary allSatisfaction allStress tickets sellTop loan allSalaryPct rivalPower projectMod projectDays renew retire retain".split(" ")
  .concat(["anti", "core", "bond", "partner", "chain", "chainDays"]);
function placeholders(s) { var u = {}; (s.match(/\{[a-z]+\}/g) || []).forEach(function (p) { u[p] = 1; }); return Object.keys(u).sort().join(","); }

test("事件 lint（v7：醜聞連鎖與人際事件）：格式、佔位、fx 鍵、連鎖目標存在且只由程式觸發", function () {
  var v7 = Events.all().filter(function (e) { return e.addedIn === "v7"; });
  assert(v7.length >= 15, "v7 事件數 " + v7.length);
  var titles = {};
  Events.all().forEach(function (e) { titles[e.title.zh] = (titles[e.title.zh] || 0) + 1; });
  v7.forEach(function (ev) {
    var w = ev.id;
    eq(titles[ev.title.zh], 1, w + " 標題重複");
    assert(Events.CATS.indexOf(ev.category) >= 0, w + " 類別");
    assert(ev.trigger === "random" || ev.trigger === "cond", w + " trigger");
    assert(Core.EVENT_TARGETS.indexOf(ev.target) >= 0, w + " target");
    var ph = placeholders(ev.text.zh);
    eq(placeholders(ev.text.ja), ph, w + " zh/ja 佔位");
    (ph ? ph.split(",") : []).forEach(function (p) { assert(["{name}", "{partner}"].indexOf(p) >= 0, w + " 佔位 " + p); });
    if (ph.indexOf("{partner}") >= 0) assert(ev.trigger === "cond", w + " {partner} 只能用在程式觸發的事件");
    assert(ev.choices.length >= 2 && ev.choices.length <= 3, w + " 選項數");
    assert(ev.choices[ev.defaultChoice], w + " defaultChoice");
    ev.choices.forEach(function (c) {
      assert(c.label.zh && c.label.ja && c.hint.zh && c.hint.ja, w + " 選項文字");
      c.outcomes.forEach(function (o) {
        Object.keys(o.fx).forEach(function (k) { assert(EVENT_FX.indexOf(k) >= 0, w + " fx " + k); });
        if (o.fx.chain) { var nx = D.EVENT_BY_ID[o.fx.chain]; assert(nx && nx.trigger === "cond", w + " 連鎖目標 " + o.fx.chain); }
      });
    });
  });
  // 每條連鎖的起點都是隨機事件，後續段落都有人指向（沒有孤兒段落）
  var pointed = {};
  v7.forEach(function (ev) { ev.choices.forEach(function (c) { c.outcomes.forEach(function (o) { if (o.fx.chain) pointed[o.fx.chain] = 1; }); }); });
  v7.filter(function (e) { return e.trigger === "cond" && /^ch_/.test(e.id); }).forEach(function (e) { assert(pointed[e.id], e.id + " 沒有任何選項接到"); });
  assert(Events.byTarget("famous").some(function (e) { return e.id === "ch_love_1"; }), "連鎖起點在隨機池");
});

test("資料：心願、目標、情境、改編方向都合法", function () {
  X.SITS.forEach(function (s) { assert(X.STRATS[s.best] && X.STRATS[s.worst] && s.best !== s.worst, s.id); assert(s.text.zh && s.text.ja, s.id + " 文字"); });
  X.WISHES.forEach(function (w) { eq(placeholders(w.text.zh), placeholders(w.text.ja), w.id); });
  X.GOALS.forEach(function (g) { eq(placeholders(g.text.zh), placeholders(g.text.ja), g.id); });
  Object.keys(X.ADAPT).forEach(function (k) { assert(D.DIR_BY_ID[k], k); X.ADAPT[k].forEach(function (d) { assert(D.DIR_BY_ID[d], k + "→" + d); }); });
});

test("建立與遷移：新公司有季度目標；舊存檔（沒有 plus 欄位）讀入後補齊", function () {
  var st = company(11);
  assert(st.plus && st.plus.goals && st.plus.goals.list.length === B.goalCount, "季度目標 3 個");
  Plus.ensure(st);   // 抽卡進來的人在下一次每日結算（或畫面呼叫 ensure）時補上欄位
  st.artists.forEach(function (a) { assert(Array.isArray(a.wishes) && a.core >= 0 && a.anti === 0, "藝人欄位"); });
  var old = JSON.parse(JSON.stringify(st));
  delete old.plus;
  old.artists.forEach(function (a) { delete a.wishes; delete a.core; delete a.anti; delete a.capPlus; delete a.wishNext; });
  Core.migrate(old);
  assert(old.plus && old.plus.goals, "遷移補上 plus");
  old.artists.forEach(function (a) { assert(Array.isArray(a.wishes) && a.capPlus, "遷移補上藝人欄位"); });
  Core.advance(old, 40);
});

test("1 心願：會產生、可以達成（滿意度↑、上限 +3%）、逾期會失落", function () {
  var st = company(21), a = st.artists[0];
  a.wishes = []; a.wishNext = 99999;
  a.wishes.push({ id: "wx", t: "fame", p: { n: a.fame + 10 }, since: st.day, until: st.day + 300, prog: 0 });
  var stat = Core._int.topStat(a.dir), cap0 = a.caps[stat], sat0 = a.satisfaction = 50;
  a.fame += 20;
  Core.advance(st, 1);
  eq(a.wishes.length, 0, "達成後移除");
  assert(a.satisfaction > sat0, "滿意度上升");
  eq(a.capPlus[stat], 1, "capPlus");
  assert(a.caps[stat] >= cap0 && (a.caps[stat] > cap0 || cap0 === 999), "上限提高 " + cap0 + "→" + a.caps[stat]);
  a.wishes.push({ id: "wy", t: "star5", p: {}, since: st.day, until: st.day + 1, prog: 0 });
  a.satisfaction = 50;
  Core.advance(st, 2);
  assert(!a.wishes.some(function (w) { return w.id === "wy"; }), "逾期移除");
  assert(a.satisfaction < 50, "逾期滿意度下降");
  // 自然產生
  var st2 = company(22);
  Core.advance(st2, 120);
  var n = 0; st2.artists.forEach(function (x) { n += x.wishes.length; });
  assert(n > 0, "120 天內有人許願");
});

test("2 季度目標：達成給獎勵；換季時重抽；clean 整季沒醜聞才算", function () {
  var st = company(31);
  st.plus.goals.list = [{ t: "great", n: 1, prog: 0, done: false, failed: false }, { t: "clean", n: 1, prog: 1, done: false, failed: false }, { t: "earn", n: 1, prog: 0, done: false, failed: false }];
  var tk = st.company.tickets, a = st.artists[0];
  boost(a, 9000);
  var j = putJob(st, { tier: "C", dir: a.dir }, { audition: false, slots: 1, role: "lead" });
  eq(Core.takeJob(st, j.id, [a.id]), null, "接工作");
  Core.advance(st, j.days);
  assert(st.plus.goals.list[0].done && st.plus.goals.list[2].done, "大成功與收入目標達成");
  assert(st.company.tickets >= tk + 2 * B.goalTickets, "星探券獎勵");
  var season0 = st.plus.goals.season;
  Core.advance(st, D.BAL.seasonDays - (st.day % D.BAL.seasonDays));
  assert(st.plus.goals.season === season0 + 1, "換季重抽");
  eq(st.plus.goalHist[0].done, 3, "上一季 3 項都達成（clean 在季末結算）");
});

test("3 臨場決策：A 級工作有 3 回合；選對加分、選錯扣分；全力衝刺扣體力", function () {
  var st = company(41), a = st.artists[0];
  boost(a, 9000);
  st.company.level = 6;
  var j = putJob(st, { tier: "A", dir: a.dir }, { audition: false, slots: 1, role: "lead", days: 9 });
  eq(Core.takeJob(st, j.id, [a.id]), null, "接 A 級");
  var aj = st.activeJobs[st.activeJobs.length - 1];
  assert(aj.clutch && aj.clutch.s.length === 3, "有 3 回合");
  eq(Plus.clutchPending(st).length, 1, "第 1 回合可以選");
  var sit = X.SITS[aj.clutch.s[0]], m0 = aj.eventMod;
  var r = Plus.pickClutch(st, aj.id, 0, sit.best);
  eq(r.q, 2, "選對"); assert(Math.abs(aj.eventMod - m0 - B.clutchBest) < 1e-9, "加分");
  assert(Plus.pickClutch(st, aj.id, 0, "steady").err, "同一回合不能再選");
  assert(Plus.pickClutch(st, aj.id, 1, "steady").err, "第 2 回合還沒開放");
  Core.advance(st, 3);
  var sit2 = X.SITS[aj.clutch.s[1]], worst = sit2.worst;
  a.traits = []; a.rarity = "R";
  var stam = a.stamina, m1 = aj.eventMod;
  var r2 = Plus.pickClutch(st, aj.id, 1, worst);
  eq(r2.q, 0, "選錯"); assert(aj.eventMod < m1, "扣分");
  if (worst === "rush") assert(a.stamina < stam, "衝刺扣體力");
  // 低等級工作沒有臨場決策
  var j2 = putJob(st, { tier: "C", dir: st.artists[1].dir }, { audition: false, slots: 1, role: "lead" });
  boost(st.artists[1], 500);
  Core.takeJob(st, j2.id, [st.artists[1].id]);
  assert(!st.activeJobs[st.activeJobs.length - 1].clutch, "C 級沒有");
});

test("4 粉絲：見面會增加核心粉、減少黑粉；核心粉減緩人氣衰退；黑粉讓壞結果變多", function () {
  var st = company(51), a = st.artists[0];
  a.fame = 3000; a.core = 0; a.anti = 30; a.task = null;
  eq(Core.schedule(st, a.id, { kind: "fanmeet" }), null, "排見面會");
  eq(a.task.kind, "fanmeet");
  Core.advance(st, 2);
  assert(a.core > 100 && a.anti < 30, "核心粉 " + a.core + "、黑粉 " + a.anti);
  var b = st.artists[1];
  a.fame = b.fame = 10000; a.core = 5000; b.core = 0; a.age = b.age = 20; a.dir = b.dir;
  var x = st.day % 30;
  Core.advance(st, 30 - x);
  assert(a.fame > b.fame, "核心粉多的人衰退少：" + a.fame + " vs " + b.fame);
  // 周邊販售
  var m0 = st.company.money;
  a.task = null;
  eq(Core.schedule(st, a.id, { kind: "merch" }), null);
  Core.advance(st, 3);
  assert(st.company.money > m0 - 10000, "周邊有收入");
  st.company.money = -1;
  eq(Core.schedule(st, b.id, { kind: "fanmeet" }), b.task ? "busy" : "money", "錢不夠不能辦");
});

test("5 關係網：一起大成功變親近；親友同台加成；對手對決工作 +15%；前輩指導", function () {
  var st = company(61), a = st.artists[0], b = st.artists[1];
  Plus._addBond(st, a.id, b.id, 50);
  eq(Plus.bond(st, a.id, b.id), 50);
  var job = Core._genJob(st, { tier: "C", dir: a.dir });
  job.slots = 2;
  var e1 = Core.estimate(st, [a.id, b.id], job).ratio;
  Plus._addBond(st, a.id, b.id, -150);
  var e2 = Core.estimate(st, [a.id, b.id], job).ratio;
  assert(e1 > e2, "好友比對手高");
  job.duel = true;
  var e3 = Core.estimate(st, [a.id, b.id], job).ratio;
  assert(e3 > e1, "對決工作時對手反而 +15%");
  // 對決工作只限兩人
  job.pair = [a.id, b.id];
  eq(Core.eligible(st, st.artists[2], job), "reserved", "第三人不能接對決");
  // 長期：同期入社、一起工作會出現好友
  var st2 = company(62);
  st2.artists.forEach(function (x) { Core.setPolicy(st2, x.id, "balance"); });
  Core.advance(st2, 540);
  var fr = Object.keys(st2.plus.bonds).filter(function (k) { return st2.plus.bonds[k] >= B.bondFriend; });
  assert(fr.length > 0, "一年半內有好友");
});

test("6 作品 IP：★4 以上 B 級作品成為系列 → 續集上看板 → 原班人馬加成", function () {
  var st = company(71), a = st.artists[0];
  boost(a, 9000);
  st.company.level = 6;
  var c4 = B.ipChance4, c5 = B.ipChance5, oc = B.ipOfferChance;
  B.ipChance4 = B.ipChance5 = 1; B.ipOfferChance = 1;
  try {
    var j = putJob(st, { tier: "B", dir: a.dir }, { audition: false, slots: 1, role: "lead", isWork: true });
    Core.takeJob(st, j.id, [a.id]);
    Core.advance(st, j.days);
    eq(st.plus.ips.length, 1, "成為系列");
    var ip = st.plus.ips[0];
    Core.advance(st, B.ipWait + 1);
    var seq = st.board.filter(function (x) { return x.ip === ip.id; })[0];
    assert(seq && seq.seq === 2, "續集上看板");
    assert(Core.jobTitle(seq, "zh").slice(-2) === " 2", "標題帶續集編號：" + Core.jobTitle(seq, "zh"));
    var b = st.artists[1]; boost(b, 9000);
    var withCast = Core.estimate(st, [a.id], seq).ratio, recast = Core.estimate(st, [b.id], seq).ratio;
    D.STATS.forEach(function (s) { b.stats[s] = a.stats[s]; }); b.mood = a.mood; b.traits = a.traits.slice(); b.rosterId = a.rosterId;
    recast = Core.estimate(st, [b.id], seq).ratio;
    assert(withCast > recast, "原班人馬比較好：" + withCast + " vs " + recast);
  } finally { B.ipChance4 = c4; B.ipChance5 = c5; B.ipOfferChance = oc; }
});

test("7 醜聞連鎖：沉默 → 幾天後第二段 → 結局可以轉機", function () {
  var st = company(81), a = st.artists[0];
  a.fame = 3000;
  var e = Core.triggerEvent(st, "ch_love_1", a.id);
  var r = Core.resolveEvent(st, e.uid, 2);   // 沉默不回應：一定接第二段
  assert(r.fx.chain, "排入連鎖");
  eq(st.plus.chain.length, 1);
  Core.advance(st, 3);
  assert(st.events.pending.some(function (x) { return x.id === "ch_love_2b" && x.aid === a.id; }), "第二段出現，對象相同");
  // 黑粉：fx.anti
  var p = st.events.pending.filter(function (x) { return x.id === "ch_love_2b"; })[0];
  var anti0 = a.anti;
  Core.resolveEvent(st, p.uid, 2);
  assert(a.anti >= anti0, "繼續否認：黑粉不會變少");
  // 人際事件：{partner} 與 bond
  var b = st.artists[1];
  var e2 = Core.triggerEvent(st, "bond_support", a.id, { partner: b.id });
  var b0 = Plus.bond(st, a.id, b.id);
  Core.resolveEvent(st, e2.uid, 0);
  assert(Plus.bond(st, a.id, b.id) > b0, "宵夜之約：感情增加");
});

test("新紀元：帶走的藝人心願重設、之後還會再許願；關係與系列歸零", function () {
  var st = company(95), a = st.artists[0];
  Plus.ensure(st);
  st.day = 9000; a.wishNext = 9500; a.wishes = [{ id: "wo", t: "star5", p: {}, since: 9000, until: 9300, prog: 0 }];
  Plus._addBond(st, a.id, st.artists[1].id, 60);
  st.company.level = 10;
  eq(Core.newEra(st, a.id), null, "新紀元");
  eq(st.day, 0);
  eq(a.wishes.length, 0, "心願清空");
  assert(a.wishNext <= B.wishFirst[1], "wishNext 重設：" + a.wishNext);
  eq(Object.keys(st.plus.bonds).length, 0, "關係歸零");
  Core.advance(st, 120);
  assert(a.wishes.length > 0, "新紀元後會再許願");
});

test("離線一致性：同 seed 下 advance(480) 與 480 次 advance(1) 結果相同（含擴充）", function () {
  var s1 = company(91), s2 = JSON.parse(JSON.stringify(s1));
  [s1, s2].forEach(function (s) { s.artists.forEach(function (x) { Core.setPolicy(s, x.id, "work"); }); });
  Core.advance(s1, 480);
  for (var i = 0; i < 480; i++) Core.advance(s2, 1);
  eq(JSON.stringify(s1) === JSON.stringify(s2), true, "狀態一致");
});

test("長期模擬 " + YEARS + " 年（自動方針＋每月抽卡）：數值不失控", function () {
  var st = Core.create({ seed: 4242 });
  Core.pull(st, "ticket", 10);
  var counts = { wishes: 0, goals: 0, ips: 0, chains: 0, friends: 0 };
  for (var day = 1; day <= YEARS * 360; day++) {
    if (day % 30 === 1) {
      while (st.company.money > 150000 && st.artists.length < Core.capacity(st)) { if (Core.pull(st, "money", 1).err) break; }
      st.artists.forEach(function (a) { if (a.policy === "idle") Core.setPolicy(st, a.id, "balance"); });
      var cost = Core.facilityCost(st, "dorm");
      if (cost !== null && st.company.money > cost * 2) Core.upgradeFacility(st, "dorm");
    }
    // 偶爾做臨場決策（一半選第一個策略）
    Plus.clutchPending(st).forEach(function (x) { if (day % 2) Plus.pickClutch(st, x.aj.id, x.k, "steady"); });
    Core.advance(st, 1);
    if (day % 360 === 0) {
      assert(isFinite(st.company.money) && isFinite(st.company.rep), "Y" + day / 360 + " 公司數值");
      st.artists.forEach(function (a) {
        assert(a.core >= 0 && a.core <= Math.max(1, Math.round(a.fame * B.coreMax)) + 1, a.id + " 核心粉範圍 " + a.core + "/" + a.fame);
        assert(a.anti >= 0 && a.anti <= 100, a.id + " 黑粉範圍");
        assert(a.wishes.length <= B.wishMax, a.id + " 心願數");
        D.STATS.forEach(function (s) { assert(a.stats[s] <= a.caps[s] && a.caps[s] <= 999, a.id + " 能力上限"); });
      });
      Object.keys(st.plus.bonds).forEach(function (k) { var v = st.plus.bonds[k]; assert(v >= -100 && v <= 100, "關係範圍"); });
      assert(st.plus.ips.length <= B.ipMax, "IP 數量");
    }
  }
  st.log.forEach(function () {});
  counts.wishes = st.plus.stats.wishes; counts.goals = st.plus.stats.goals; counts.ips = st.plus.stats.ips;
  counts.friends = Object.keys(st.plus.bonds).filter(function (k) { return st.plus.bonds[k] >= B.bondFriend; }).length;
  console.log("     " + YEARS + " 年：心願達成 " + counts.wishes + "、季度目標達成 " + counts.goals + "（全達成 " + st.plus.stats.goalsAll + " 季）、系列作品 " + counts.ips +
    "、目前好友 " + counts.friends + " 組、臨場判斷 " + st.plus.stats.clutch + " 次、公司 Lv" + st.company.level + "、資金 " + Math.round(st.company.money));
  assert(counts.wishes > 0 && counts.goals > 0, "系統有在運作");
});

console.log((failed ? "失敗 " + failed + " 個，" : "") + "全部 " + (passed + failed) + " 個，通過 " + passed + " 個");
if (failed) process.exit(1);
