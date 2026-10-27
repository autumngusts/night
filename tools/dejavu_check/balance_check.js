// DÉJÀ VU 平衡檢查（node 直接跑）：各固定山路 × 季節 × 車手風格，統計平均時間、打滑次數、退賽率。
//   node tools/dejavu_check/balance_check.js [每組場數，預設 20]
"use strict";
global.window = global;
require("../../static_src/dejavu_data.js");
require("../../static_src/dejavu_cars.js");
require("../../static_src/dejavu_bikes.js");
require("../../static_src/dejavu_courses.js");
require("../../static_src/dejavu_core.js");
var D = global.PriTestDejavuData, Core = global.PriTestDejavuCore;
var runs = Number(process.argv[2]) || 20;
var cars = process.env.CARS ? process.env.CARS.split(",") : ["ae86", "fd3s", "gc8", "ek9", "plaid", "gt3"];

D.COURSES.forEach(function (co) {
  var course = Core.fixedCourse(co.id);
  var info = Core.trackInfo(Core.buildTrack(course, { season: "summer", seed: 1 }));
  console.log("\n== " + co.id + " len " + Math.round(info.len) + "m corners " + info.corners + " hairpins " + info.hairpins + " drop " + Math.round(info.drop) + "m cross " + info.cross);
  D.SEASON_IDS.forEach(function (se) {
    D.STYLE_IDS.forEach(function (sty) {
      var agg = {};
      for (var n = 0; n < runs; n++) {
        var race = Core.createRace({ course: course, season: se, mode: "attack", seed: 1000 + n,
          cars: cars.map(function (id) { return { spec: { car: id, style: sty, tire: se === "winter" ? "snow" : "sport" } }; }) });
        Core.runToEnd(race);
        Core.results(race).forEach(function (r) {
          var a = agg[r.car] || (agg[r.car] = { t: 0, fin: 0, spins: 0, dnf: 0 });
          if (r.state === "fin") { a.t += r.time; a.fin++; } else a.dnf++;
          a.spins += r.spins;
        });
      }
      var line = se + "/" + sty + ": ";
      Object.keys(agg).forEach(function (k) {
        var a = agg[k];
        line += k.split(" ")[0].slice(0, 10) + " " + (a.fin ? (a.t / a.fin).toFixed(1) : "-") + "s sp" + (a.spins / runs).toFixed(2) + (a.dnf ? " dnf" + a.dnf : "") + " | ";
      });
      console.log(line);
    });
  });
});
