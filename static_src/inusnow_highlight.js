/* イヌスノー（狗雪）R5 精彩重播（docs/inusnow_design.md §19.4）。
   從一趟的 frames（每步一格，Core.frameOf）與事件找出：最快的 10 秒、最大的一跳、分數最高的技巧、Cross 的超車。
   不碰 DOM、不讀寫 localStorage；只用 + − × ÷、Math.sqrt、Math.floor、Math.abs（設計 §11）。 */
(function (root) {
  "use strict";

  var D = root.PriTestInusnowData || (typeof require === "function" ? require("./inusnow_data.js") : null);
  var T = root.PriTestInusnowTerrain || (typeof require === "function" ? require("./inusnow_terrain.js") : null);
  var H = D.HIGHLIGHT, HZ = D.PHYS.hz;

  function clampSeg(a, b, n) {
    if (a < 0) a = 0;
    if (b > n - 1) b = n - 1;
    return [a, b];
  }

  // o：{frames, terrain, events, tricks?（Slopestyle）, me?（Cross 的選手 index，預設 0）}
  // → [{kind: "fast"|"jump"|"trick"|"pass", a, b（步）, val}]，依時間排序
  function find(o) {
    var fr = o.frames, n = fr.length, out = [];
    if (n < 2) return out;
    // 最快的 10 秒：水平移動距離的滑動視窗
    var W = H.fastSec * HZ;
    if (n > W + 1) {
      var cum = [0];
      for (var i = 1; i < n; i++) {
        var dx = fr[i][0] - fr[i - 1][0], dz = fr[i][2] - fr[i - 1][2];
        cum.push(cum[i - 1] + Math.sqrt(dx * dx + dz * dz));
      }
      var best = -1, bi = 0;
      for (var a = 0; a + W < n; a += 6) {
        var d = cum[a + W] - cum[a];
        if (d > best) { best = d; bi = a; }
      }
      out.push({ kind: "fast", a: bi, b: bi + W, val: Math.floor(best / H.fastSec * 3.6 * 10 + 0.5) / 10 });
    }
    // 最大的一跳：滯空區間裡離地最高
    var jb = null, k = 0;
    while (k < n) {
      if (!fr[k][7]) { k += 1; continue; }
      var s0 = k, top = 0;
      while (k < n && fr[k][7]) {
        var gy = T.height(o.terrain, fr[k][0], fr[k][2]);
        var h = fr[k][1] - gy;
        if (h > top) top = h;
        k += 1;
      }
      if (k - s0 >= H.jumpMinSteps && (!jb || top > jb.val)) jb = { a: s0, b: k, val: top };
    }
    if (jb && jb.val >= H.jumpMinH) {
      var sj = clampSeg(jb.a - H.before, jb.b + H.after, n);
      out.push({ kind: "jump", a: sj[0], b: sj[1], val: Math.floor(jb.val * 10 + 0.5) / 10 });
    }
    // 分數最高的技巧（Slopestyle）：trick 事件的步數
    if (o.tricks && o.tricks.length && o.events) {
      var bt = null;
      for (var e = 0; e < o.events.length; e++) {
        var ev = o.events[e];
        if (ev.e !== "trick") continue;
        var tr = o.tricks[ev.n];
        if (tr && (!bt || tr.pts > bt.val)) bt = { k: ev.k, val: tr.pts };
      }
      if (bt && bt.val > 0) {
        var st = clampSeg(bt.k - H.trickBefore, bt.k + H.after, n);
        out.push({ kind: "trick", a: st[0], b: st[1], val: bt.val });
      }
    }
    // Cross 的超車：自己的 pass 事件裡最後一次（最接近終點的）
    if (o.events && o.kind === "cross") {
      var me = o.me || 0, lp = null;
      for (var q = 0; q < o.events.length; q++) if (o.events[q].e === "pass" && o.events[q].r === me) lp = o.events[q];
      if (lp) {
        var sp = clampSeg(lp.k - H.passBefore, lp.k + H.after, n);
        out.push({ kind: "pass", a: sp[0], b: sp[1], val: 0 });
      }
    }
    out.sort(function (x, y) { return x.a - y.a; });
    return out;
  }

  // 分享碼的片段：§13 的分享碼＋"|h:<起步>-<終步>"
  function withClip(code, a, b) { return code + "|h:" + (a | 0) + "-" + (b | 0); }
  function clipOf(code) {
    var m = String(code || "").match(/\|h:(\d+)-(\d+)\s*$/);
    if (!m) return null;
    var a = parseInt(m[1], 10), b = parseInt(m[2], 10);
    return b > a ? { a: a, b: b } : null;
  }
  function stripClip(code) { return String(code || "").replace(/\|h:\d+-\d+\s*$/, ""); }

  var Highlight = { find: find, withClip: withClip, clipOf: clipOf, stripClip: stripClip };
  root.PriTestInusnowHighlight = Highlight;
  if (typeof module !== "undefined" && module.exports) module.exports = Highlight;
})(typeof window !== "undefined" ? window : globalThis);
