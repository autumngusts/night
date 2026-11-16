// ============================================================================
// 百鬼轉珠（tama）平衡模擬（不需要瀏覽器）：
//   機器人每回合隨機試 N 條轉珠路徑（長度 8〜20 步，約等於 5 秒內人手的移動量），挑消除組最多的一條；
//   生命低於 40% 時優先多消心珠。CD 好了就用技能（轉換類在轉珠前用）。
//   從開局 5 人開始依序挑戰 1-1〜3-4；失敗就回去刷最後通關的關卡拿經驗，再重試。
//   印出每關的挑戰次數、刷關次數、平均回合數與隊伍等級，用來調整 docs/tama_game_design.md §4〜§7 的數值。
// 執行：node tools/tama_check/balance_sim.js [機器人每回合嘗試的路徑數，預設 120] [種子]
// ============================================================================
"use strict";
var path = require("path");
var D = require(path.join(__dirname, "..", "..", "static_src", "tama_data.js"));
global.PriTestTamaData = D;
var C = require(path.join(__dirname, "..", "..", "static_src", "tama_core.js"));

var TRIES = +(process.argv[2] || 120);
var rng = C.makeRng(+(process.argv[3] || 42));

function botMove(st) {
  var low = st.hp < st.hpMax * 0.4, best = null, bestScore = -1;
  for (var t = 0; t < TRIES; t++) {
    var b = C.cloneBoard(st.board);
    var r = Math.floor(rng() * C.ROWS), c = Math.floor(rng() * C.COLS), pr = -1, pc = -1;
    var len = 8 + Math.floor(rng() * 13);
    for (var k = 0; k < len; k++) {
      var nr, nc, guard = 0;
      do {
        nr = r + Math.floor(rng() * 3) - 1; nc = c + Math.floor(rng() * 3) - 1;
      } while ((nr === r && nc === c) || nr < 0 || nr >= C.ROWS || nc < 0 || nc >= C.COLS || (nr === pr && nc === pc) && guard++ < 20);
      var tmp = b[r][c]; b[r][c] = b[nr][nc]; b[nr][nc] = tmp;
      pr = r; pc = c; r = nr; c = nc;
    }
    var g = C.findGroups(b), score = g.length;
    g.forEach(function (x) { if (low && x.color === "heart") score += 1.5; });
    if (score > bestScore) { bestScore = score; best = b; }
  }
  return best;
}

function useSkills(st) {
  st.members.forEach(function (m, i) {
    if (m.cd > 0) return;
    var s = D.HERO_BY_ID[m.id].as;
    if (s.t === "heal" && st.hp > st.hpMax * 0.6) return;
    if (s.t === "jamheal") {
      var jams = 0; st.board.forEach(function (row) { row.forEach(function (o) { if (o === "jam") jams++; }); });
      if (!jams && st.hp > st.hpMax * 0.7) return;
    }
    C.useSkill(st, i);
  });
}

function play(stageId, team) {
  var st = C.createBattle(stageId, team, Math.floor(rng() * 1e9));
  while (!st.over && st.turn < 200) {
    useSkills(st);
    if (st.over) break;
    st.board = botMove(st);
    var res = C.resolve(st.board, st.rng);
    st.board = res.board;
    C.playerTurn(st, res.groups);
  }
  return { win: st.over === "win", turns: st.turn };
}

// 編隊：依（稀有度、等級）挑前 5 名，最強的當隊長
var roster = {};
D.STARTERS.forEach(function (id) { roster[id] = { lv: 1, exp: 0 }; });
function team() {
  return Object.keys(roster).sort(function (a, b) {
    var ha = D.HERO_BY_ID[a], hb = D.HERO_BY_ID[b];
    return (hb.rarity * 100 + roster[b].lv) - (ha.rarity * 100 + roster[a].lv);
  }).slice(0, 5).map(function (id) { return { id: id, lv: roster[id].lv }; });
}
function reward(stageId, t, first) {
  var s = D.STAGE_BY_ID[stageId];
  t.forEach(function (m) { C.gainExp(roster[m.id], s.exp); });
  if (first) s.recruit.forEach(function (id) { roster[id] = { lv: 1, exp: 0 }; });
}

var lastCleared = null;
console.log("stage | 挑戰 | 刷關 | 通關回合 | 隊伍等級");
D.STAGE_ORDER.forEach(function (id) {
  var attempts = 0, grinds = 0, res;
  while (true) {
    attempts++;
    var t = team();
    res = play(id, t);
    if (res.win) { reward(id, t, true); break; }
    if (attempts > 60) { console.log(id + " | 卡關（超過 60 次）"); process.exit(1); }
    if (lastCleared) {
      for (var g = 0; g < 3; g++) {
        var tg = team(), rg = play(lastCleared, tg);
        grinds++;
        if (rg.win) reward(lastCleared, tg, false);
      }
    }
  }
  lastCleared = id;
  var lv = team().map(function (m) { return m.id + ":" + m.lv; }).join(" ");
  console.log(id + " | " + attempts + " | " + grinds + " | " + res.turns + " | " + lv);
});
