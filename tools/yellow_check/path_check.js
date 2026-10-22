// 黃牌 Yellow Card 成長方向（特化路線）檢查：每位英雄 × 三條方向，讓英雄只拿那條方向的獎勵卡、
// 升級也優先升那條方向，和一位固定隊友（貪婪 AI）兩人通關。統計：
//   通關率、平均推進層數（滿分 15）、該路線的卡佔英雄出牌的比例、最常打出的路線卡
// 用來找出「太弱／太強」或「其實沒在用那條路線的卡」的方向。只當作調整數值的參考。
//   node tools/yellow_check/path_check.js [每條路線的局數，預設 10] [只測某英雄 id]
"use strict";

var bot = require("./bot.js");
var D = bot.D;

var N = Number(process.argv[2]) || 10;
var ONLY = process.argv[3] || null;
var PARTNERS = ["paladin", "mage", "ranger"];

D.CLASSES.forEach(function (hero) {
  if (ONLY && hero.id !== ONLY) return;
  console.log("== " + hero.name.zh + " (" + hero.id + ")");
  hero.paths.forEach(function (p) {
    var wins = 0, prog = 0, pathPlays = 0, allPlays = 0, top = {};
    for (var g = 0; g < N; g++) {
      var partner = PARTNERS.filter(function (x) { return x !== hero.id; })[g % 2];
      var seats = [{ cls: hero.id }, { cls: partner }, null, null];
      var r = bot.run(9000 + g * 13, seats, { path: { 0: p.id } });
      if (r.phase === "win") wins++;
      prog += r.phase === "win" ? 15 : r.act * 5 + r.floor;
      var pl = r.plays[0] || {};
      Object.keys(pl).forEach(function (id) {
        allPlays += pl[id];
        if (D.CARD[id].path === p.id) { pathPlays += pl[id]; top[id] = (top[id] || 0) + pl[id]; }
      });
    }
    var tops = Object.keys(top).sort(function (a, b) { return top[b] - top[a]; }).slice(0, 3).map(function (id) { return D.CARD[id].name.zh + "×" + top[id]; });
    console.log("  " + p.name.zh + "：通關 " + wins + "/" + N + "  推進 " + (prog / N).toFixed(1) +
      "  路線卡出牌比例 " + (allPlays ? Math.round(pathPlays / allPlays * 100) : 0) + "%  " + tops.join("、"));
  });
});
