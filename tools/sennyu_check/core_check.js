// ============================================================================
// 潛入晶片（sennyu）規則引擎檢查（node，不需要瀏覽器）：
//   1. 所有場景引用（next、mini.win/lose、BONDS／EVENTS／SNOOPS／HANDLER）都存在
//   2. 隨機自動玩 N 輪（隨機行動、隨機選項、小遊戲隨機勝負）不會丟例外，且一定走到結局
//   3. 印出結局分布、平均行動數、各場景有沒有被走到
// 執行：node tools/sennyu_check/core_check.js [輪數]
// ============================================================================
"use strict";
var path = require("path");
var assert = require("assert");
globalThis.window = globalThis;
["sennyu_data.js", "sennyu_story_1.js", "sennyu_story_2.js", "sennyu_story_bond.js", "sennyu_story_event.js", "sennyu_core.js"].forEach(function (f) {
  require(path.join(__dirname, "..", "..", "static_src", f));
});
var D = window.PriTestSennyuData, C = window.PriTestSennyuCore, S = window.PriTestSennyuScenes;

// ---- 1. 靜態引用 ----
var refs = [];
function walk(sid, seg) {
  if (!seg) return;
  if (typeof seg.next === "string" && seg.next.charAt(0) !== "@") refs.push([sid, seg.next]);
  if (seg.mini) ["win", "lose"].forEach(function (k) {
    var t = seg.mini[k];
    if (typeof t === "string") { if (t.charAt(0) !== "@") refs.push([sid, t]); } else walk(sid, t);
  });
  (seg.choices || []).forEach(function (c) { walk(sid, c); walk(sid, c.ok); walk(sid, c.ng); });
}
Object.keys(S).forEach(function (k) { walk(k, S[k]); });
D.CHAPTERS.forEach(function (c) { refs.push(["CHAPTERS", c.open]); if (c.fin) refs.push(["CHAPTERS", c.fin]); (c.mains || []).forEach(function (m) { refs.push(["CHAPTERS", m.sid]); }); });
Object.keys(D.BONDS).forEach(function (n) { D.BONDS[n].forEach(function (b) { refs.push(["BONDS", b.sid]); }); });
D.EVENTS.forEach(function (e) { refs.push(["EVENTS", e.sid]); });
D.HANDLER.forEach(function (e) { refs.push(["HANDLER", e.sid]); });
Object.keys(D.SNOOPS).forEach(function (k) { D.SNOOPS[k].forEach(function (s) { refs.push(["SNOOPS", s]); }); });
Object.keys(D.ENDINGS).forEach(function (e) { refs.push(["ENDINGS", "end_" + e.slice(2)]); });
["work", "rest", "h_generic", "gate_fail"].forEach(function (s) { refs.push(["core", s]); });
var missing = refs.filter(function (r) { return !S[r[1]]; });
assert.deepStrictEqual(missing, [], "找不到的場景：" + JSON.stringify(missing));
console.log("場景數：", Object.keys(S).length, "引用數：", refs.length, "→ 全部存在");

// ---- 2. 隨機自動玩 ----
var N = +process.argv[2] || 400;
var endings = {}, seen = {}, turns = 0, intelCount = 0;
var imgs = [];
for (var i = 0; i < 143; i++) imgs.push("g_" + ("00" + i).slice(-3) + ".webp");
function r(n) { return Math.floor(Math.random() * n); }
for (var g = 0; g < N; g++) {
  var cand = C.candidates(g * 7919 + 1, imgs);
  assert.strictEqual(cand.length, 5);
  var c0 = cand[r(5)];
  var st = C.newGame({ img: c0.img, arch: c0.arch, name: c0.name, seed: g + 1 });
  var guard = 0;
  while (!(st.ending && !st.cur)) {
    if (++guard > 20000) throw new Error("卡住了：" + JSON.stringify(st.cur));
    if (st.cur) {
      seen[st.cur.sid] = true;
      var ph = st.cur.phase;
      if (ph === "lines") C.advance(st);
      else if (ph === "choice") {
        var vis = C.visibleChoices(st, C.seg(st)).filter(function (x) { return !x.why; });
        assert.ok(vis.length, "沒有可選的選項：" + st.cur.sid + " " + JSON.stringify(st.cur.path));
        C.choose(st, vis[r(vis.length)].i, Math.random() < 0.3);
      } else if (ph === "mini") {
        var m = st.mini;
        if (m.kind === "inbox") {
          while (!m.done) {
            var q = C.inboxQ(st), ok = q.opts.map(function (o, k) { return o.time <= m.time ? k : -1; }).filter(function (k) { return k >= 0; });
            C.inboxPick(st, ok[r(ok.length)], false);
          }
          C.miniEnd(st, m.win);
        } else if (m.kind === "sneak") {
          // 隨機走幾步再隨機決定勝負（地圖可解性由 sneak 檢查負責）
          for (var k = 0; k < 5 && !m.done && !m.alert; k++) C.sneakMove(st, [1, -1, 0, 0, 0][r(5)], [0, 0, 1, -1, 0][r(5)]);
          C.miniEnd(st, Math.random() < 0.7);
        } else C.miniEnd(st, Math.random() < 0.6);
      } else throw new Error("未知的 phase " + ph);
    } else {
      var acts = C.actions(st).filter(function (a) { return !a.why; });
      assert.ok(acts.length, "沒有可做的行動 ch" + st.ch);
      // 偏向主線，讓模擬比較像真人
      var mains = acts.filter(function (a) { return a.kind === "main" && a.id !== "fin"; });
      var a = mains.length && Math.random() < 0.35 ? mains[0] : acts[r(acts.length)];
      assert.ok(C.doAction(st, a.id), "doAction 失敗 " + a.id);
    }
  }
  endings[st.ending] = (endings[st.ending] || 0) + 1;
  turns += st.turns;
  intelCount += Object.keys(st.intel).length;
  JSON.parse(JSON.stringify(st));   // 存檔一定要能序列化
}
console.log("自動玩 " + N + " 輪，平均行動數 " + (turns / N).toFixed(1) + "，平均情報 " + (intelCount / N).toFixed(1) + "/" + D.INTEL.length);
D.ENDING_ORDER.forEach(function (e) { console.log("  " + D.ENDINGS[e].title + "：" + (endings[e] || 0)); });
var unseen = Object.keys(S).filter(function (k) { return !seen[k]; });
console.log("沒被走到的場景（" + unseen.length + "）：", unseen.join(", "));

// ---- 3. 潛入地圖可解（不靠藉口／擊暈） ----
Object.keys(D.MAPS).forEach(function (id) {
  var map = D.MAPS[id], tk = Object.keys(map.targets), start;
  map.rows.forEach(function (row, y) { var x = row.indexOf("S"); if (x >= 0) start = [x, y]; });
  map.guards.forEach(function (gd, gi) { C.guardCells(gd).forEach(function (c) { assert.notStrictEqual(C.tile(map, c[0], c[1]), "#", id + " 警衛 " + gi + " 走進牆裡"); }); });
  function seenAt(x, y, t) { return map.guards.some(function (gd, gi) { return C.sees(map, C.guardAt(map, gi, t), x, y); }); }
  var q = [[start[0], start[1], 0, 0]], vis = {}, best = null;
  while (q.length) {
    var s = q.shift(), x = s[0], y = s[1], t = s[2], mask = s[3];
    if (mask === (1 << tk.length) - 1 && x === start[0] && y === start[1] && t > 0) { best = t; break; }
    if (t >= map.turns) continue;
    [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) {
      var nx = x + d[0], ny = y + d[1], nt = t + 1;
      if (C.tile(map, nx, ny) === "#" || seenAt(nx, ny, nt)) return;
      var nm = mask, k = tk.indexOf(nx + "," + ny);
      if (k >= 0) nm |= 1 << k;
      var key = nx + "," + ny + "," + nt + "," + nm;
      if (vis[key]) return;
      vis[key] = 1;
      q.push([nx, ny, nt, nm]);
    });
  }
  assert.ok(best, id + " 無解");
  console.log("潛入地圖 " + id + "：最短 " + best + " 回合（上限 " + map.turns + "）");
});
console.log("OK");
