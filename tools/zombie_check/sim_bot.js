// 末日據點：不開瀏覽器，用簡單的機器人跑完整局（夜晚自動結算），檢查流程不會卡住並量平衡。
// 執行：node tools/zombie_check/sim_bot.js [場數]
"use strict";
var fs = require("fs"), path = require("path");
global.window = global;
global.I18N = { getLang: function () { return "zh"; } };
var SRC = path.join(__dirname, "..", "..", "static_src");
["zombie_data.js", "zombie_night.js", "zombie_core.js"].forEach(function (f) { eval.call(global, fs.readFileSync(path.join(SRC, f), "utf8")); });
var D = window.PriTestZombieData, Core = window.PriTestZombieCore, Night = window.PriTestZombieNight;

// 機器人：最強搜索 1〜2 人外出（選還沒搜刮爛、危險度看進度），其餘修建／治療／製作
function botPlan(s, pid) {
  var mine = Core.alive(s).filter(function (v) { return v.owner === pid; });
  var hurt = mine.filter(function (v) { return v.hp <= 5; }).length;
  var sorted = mine.slice().sort(function (a, b) { return Core.stat(b, "scv") - Core.stat(a, "scv"); });
  var nsc = Math.min(2, sorted.filter(Core.canScavenge).length);
  var ring = s.day < s.len * 0.3 ? 2 : 3;
  var ds = D.ARCH_IDS.filter(function (a) { return D.ARCH[a].ring <= ring; }).sort(function (a, b) { return s.districts[a].dep - s.districts[b].dep || D.ARCH[b].ring - D.ARCH[a].ring; });
  Core.applyIntent(s, pid, { a: "district", d: ds[0] });
  var need = ["wall", "tower", "purifier", "garden", "traps", "workshop", "wire", "infirmary"].filter(function (b) { return Core.canBuild(s, b); });
  var wallsLow = s.walls.some(function (w) { return w < Core.WALL_HP[s.bld.wall] * 0.6; });
  Core.applyIntent(s, pid, { a: "build", b: wallsLow || !need.length ? "repair" : need[0] });
  Core.applyIntent(s, pid, { a: "craft", r: s.items.molotov < 3 ? "molotov" : "bandage" });
  var k = 0;
  sorted.forEach(function (v) {
    var job = "build";
    if (Core.canScavenge(v) && k < nsc) { job = "scavenge"; k++; }
    else if (hurt && Core.stat(v, "med") >= 2) { job = "heal"; hurt = 0; }
    else if (v.sta < 4) job = "rest";
    else if (Math.random() < 0.25) job = "craft";
    Core.applyIntent(s, pid, { a: "assign", sid: v.id, job: job });
    if (v.inf && s.items.serum) Core.applyIntent(s, pid, { a: "treat", sid: v.id, how: "serum" });
    else if (v.inf && v.inf.hid) Core.applyIntent(s, pid, { a: "treat", sid: v.id, how: "reveal" });
  });
  var free = s.weapons.filter(function (w) { return !s.surv.some(function (v) { return v.weapon === w.uid; }); });
  mine.forEach(function (v) { if (!v.weapon && free.length) Core.applyIntent(s, pid, { a: "equip", sid: v.id, w: free.shift().uid }); });
}
function play(len, seed, np) {
  var players = []; for (var i = 0; i < (np || 1); i++) players.push({ pid: "p" + i, name: "P" + i });
  var s = Core.newGame({ seed: seed, city: seed % 2 ? "tw" : "jp", len: len, players: players });
  var guard = 0;
  while (!s.end && guard++ < 2000) {
    if (s.phase === "plan") {
      if (s.gate) Core.applyIntent(s, players[0].pid, { a: "gate", c: 0 }) || Core.applyIntent(s, players[0].pid, { a: "gate", c: D.EVENT_BY_ID[s.gate.id].ch.length - 1 });
      players.forEach(function (p) { botPlan(s, p.pid); Core.applyIntent(s, p.pid, { a: "ready", v: true }); });
    } else if (s.phase === "explore") {
      players.forEach(function (p) {
        var c = Core.currentCard(s, p.pid);
        if (!c) return;
        var ok = c.ch.map(function (o, j) { return Core.reqOk(s, s.explore[p.pid], o.req) ? j : -1; }).filter(function (j) { return j >= 0; });
        Core.applyIntent(s, p.pid, { a: "answer", c: ok[Math.floor(Math.random() * ok.length)] });
      });
    } else if (s.phase === "night") {
      var sim = Night.create(s.night);
      var res = sim.runToEnd();
      if (play.trace) play.trace.push({ day: s.day, n: s.night.n, kills: res.kills, core: res.core, ammo: s.res.ammo, used: res.ammoUsed, food: s.res.food, water: s.res.water, alive: Core.alive(s).length, walls: Math.round(s.walls.reduce(function (a, b) { return a + b; }, 0)), bld: JSON.stringify(s.bld).replace(/"/g, "") });
      Core.endNight(s, res);
    } else if (s.phase === "dawn") {
      players.forEach(function (p) { Core.applyIntent(s, p.pid, { a: "ready", v: true }); });
    }
  }
  if (!s.end) throw new Error("卡住了：" + s.phase + " day " + s.day + " " + JSON.stringify(s.explore).slice(0, 300));
  JSON.parse(JSON.stringify(s));
  return s;
}
if (require.main !== module) { module.exports = { play: play, botPlan: botPlan }; return; }
var runs = +process.argv[2] || 60;
[[10, 1], [30, 1], [10, 3]].forEach(function (cfg) {
  var ends = {}, days = 0, sc = 0;
  for (var i = 0; i < runs; i++) {
    var s = play(cfg[0], (i * 2654435761 + cfg[0] * 7 + cfg[1]) >>> 0, cfg[1]);
    ends[s.end.kind] = (ends[s.end.kind] || 0) + 1; days += s.end.day; sc += s.end.score;
  }
  console.log(cfg[0] + " 天・" + cfg[1] + " 人：結局 " + JSON.stringify(ends) + "、平均撐到第 " + (days / runs).toFixed(1) + " 天、平均分數 " + Math.round(sc / runs));
});
