// 黃牌 Yellow Card 平衡檢查：貪婪 AI（bot.js）跑完整局，統計 1～4 人的通關率、倒在哪一幕，以及各英雄的表現。
// 只當作調整數值的參考，不是正式測試。
//   node tools/yellow_check/balance_check.js [每種人數的局數]
"use strict";

var bot = require("./bot.js");
var D = bot.D;

var N = Number(process.argv[2]) || 20;
var CLS = D.CLASSES.map(function (c) { return c.id; });
var ORDER = [0, 1, 2, 3];
var byHero = {};
[1, 2, 3, 4].forEach(function (n) {
  var wins = 0, reach = {};
  for (var g = 0; g < N; g++) {
    var seats = [null, null, null, null];
    for (var i = 0; i < n; i++) seats[ORDER[i]] = { cls: CLS[(g * 3 + i) % CLS.length] };
    var r = bot.run(5000 + g * 7 + n, seats);
    if (r.phase === "win") wins++;
    seats.forEach(function (x) {
      if (!x) return;
      var b = byHero[x.cls] = byHero[x.cls] || { win: 0, n: 0, prog: 0 };
      b.n++; if (r.phase === "win") b.win++;
      b.prog += r.phase === "win" ? 15 : r.act * 5 + r.floor;
    });
    var k = r.phase === "win" ? "win" : "a" + (r.act + 1) + "f" + (r.floor + 1);
    reach[k] = (reach[k] || 0) + 1;
  }
  console.log(n + " 人：通關 " + wins + "/" + N + "  " + JSON.stringify(reach));
});
// 各英雄：參與的局中通關幾局、平均推進到第幾層（滿分 15）
Object.keys(byHero).forEach(function (k) {
  var b = byHero[k];
  console.log(k + "：通關 " + b.win + "/" + b.n + "  平均推進 " + (b.prog / b.n).toFixed(1) + " 層");
});
