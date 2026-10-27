// 黃牌 Yellow Card 的貪婪 AI（balance_check.js／path_check.js 共用）。
// 決策本身在 static_src/yellow_ai.js（遊戲裡的 AI 隊友也用同一份）；這裡只負責整局跑完。
//   run(seed, seats, opts) → { phase, act, floor, plays: { seat: { cardId: 次數 } } }
//   opts.path：{ seat: pathId }——該英雄的戰利品只拿這條成長方向的卡、升級也優先升這條方向（測試特化路線）
//   opts.torment／opts.endless：苦痛等級、無盡模式（無盡模式最多跑到 opts.maxAct 幕）
//   opts.hard：高難度地圖（2026-10-27）
"use strict";

global.window = global;
require("../../static_src/yellow_data.js");
require("../../static_src/yellow_core.js");
require("../../static_src/yellow_ai.js");
var D = global.PriTestYellowData;
var Core = global.PriTestYellowCore;
var AI = global.PriTestYellowAI;

function run(seed, seats, opts) {
  opts = opts || {};
  var st = Core.create({ seed: seed, seats: seats, torment: opts.torment, endless: opts.endless, hard: opts.hard });
  opts.tmod = true;
  var plays = {};
  var guard = 0;
  while (st.phase !== "win" && st.phase !== "lose" && guard++ < 60000) {
    if (opts.maxAct && st.act >= opts.maxAct) break;
    // 下一個要行動的英雄：地圖＝還沒選目的地、戰鬥＝還沒結束回合、其他＝有待選擇
    var h = Core.heroes(st).filter(function (x) {
      if (st.phase === "map") return !x.dest || !!st.tmodPick;
      if (st.phase === "battle") return !x.down && !x.done;
      return !!x.pend;
    })[0];
    if (!h) break;
    var a = AI.next(st, h.seat, opts);
    if (!a) break;
    if (a.t === "play") {
      var pl = plays[h.seat] = plays[h.seat] || {};
      pl[a.id] = (pl[a.id] || 0) + 1;
    }
    var err = Core.apply(st, h.ctrl, a);
    if (err && a.t === "choose") Core.apply(st, h.ctrl, AI.fallback(h.seat));
    else if (err && a.t === "play") Core.apply(st, h.ctrl, { t: "end", s: h.seat });
  }
  return { phase: st.phase, act: st.act, floor: st.floor, plays: plays, st: st };
}

module.exports = { run: run, Core: Core, D: D, AI: AI };
