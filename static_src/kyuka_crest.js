// 九華（kyuka）：櫻瓣花紋（docs/kyuka_design.md §7）。回傳 <svg> 字串。
// 九片花瓣，尖端有櫻花缺口；長度＝數值（最短保留約 2 成），顏色＝三華（魅・身・心），根部濃、尖端淡；
// 長的在後、短的在前；中央有花蕊；未解鎖的三華以含苞的灰色輪廓顯示。
(function () {
  "use strict";

  var D = window.PriTestKyukaData, Core = window.PriTestKyukaCore;
  if (!D || !Core) return;
  var uid = 0;

  function pt(cx, cy, r, deg) { var a = deg * Math.PI / 180; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; }
  function f(x) { return Math.round(x * 10) / 10; }
  function petalPath(r0, L, W) {
    return "M0," + f(-r0) +
      " C" + f(W * 0.95) + "," + f(-(r0 + (L - r0) * 0.22)) + " " + f(W * 1.05) + "," + f(-(r0 + (L - r0) * 0.78)) + " " + f(W * 0.42) + "," + f(-L) +
      " Q" + f(W * 0.2) + "," + f(-L * 0.97) + " 0," + f(-L * 0.885) +
      " Q" + f(-W * 0.2) + "," + f(-L * 0.97) + " " + f(-W * 0.42) + "," + f(-L) +
      " C" + f(-W * 1.05) + "," + f(-(r0 + (L - r0) * 0.78)) + " " + f(-W * 0.95) + "," + f(-(r0 + (L - r0) * 0.22)) + " 0," + f(-r0) + " Z";
  }
  function angleOf(i) { return -90 + (i - 1) * 40; }   // PETAL_ORDER 的第 2 項（美）在正上方

  // data = { v: {美:..}, hidden: {美:true,...} }；opts = { size, labels, values, mini }
  function render(data, opts) {
    opts = opts || {};
    var size = opts.size || 240, id = "kyc" + (++uid);
    var R = size / 2 - (opts.labels ? 30 : 3), r0 = R * 0.11, cx = size / 2, cy = size / 2;
    var out = ['<svg class="ky-crest" viewBox="0 0 ' + size + " " + size + '" role="img" aria-label="' + (opts.label || "九華花紋") + '"><defs>'];
    [0, 1, 2].forEach(function (gi) {
      out.push('<linearGradient id="' + id + "g" + gi + '" x1="0" y1="1" x2="0" y2="0">' +
        '<stop offset="0" style="stop-color:var(--ky-g' + gi + ');stop-opacity:1"/>' +
        '<stop offset="0.55" style="stop-color:var(--ky-g' + gi + ');stop-opacity:0.8"/>' +
        '<stop offset="1" style="stop-color:var(--ky-g' + gi + ');stop-opacity:0.3"/></linearGradient>');
    });
    out.push("</defs>");
    function len(x) { return r0 + (R - r0) * (0.22 + 0.78 * x / 99); }
    if (!opts.mini) {
      [25, 50, 75, 90, 99].forEach(function (t, ti) {
        out.push('<circle cx="' + cx + '" cy="' + cy + '" r="' + f(len(t)) + '" fill="none" stroke="var(--ky-line)"' + (ti === 4 ? "" : ' stroke-dasharray="2 4"') + "/>");
      });
    }
    var items = D.PETAL_ORDER.map(function (k, i) {
      var hidden = data.hidden && data.hidden[k];
      return { k: k, i: i, hidden: hidden, L: hidden ? r0 + (R - r0) * 0.36 : len(data.v[k]) };
    });
    items.slice().sort(function (a, b) { return b.L - a.L; }).forEach(function (it) {
      var W = it.L * (it.hidden ? 0.26 : 0.34);
      out.push('<g transform="translate(' + cx + "," + cy + ") rotate(" + (angleOf(it.i) + 90) + ')">');
      if (it.hidden) {
        out.push('<path d="' + petalPath(r0, it.L, W) + '" fill="var(--ky-bud)" stroke="var(--ky-muted)" stroke-width="' + (opts.mini ? 0.8 : 1.2) + '" stroke-dasharray="3 3"/>');
      } else {
        out.push('<path d="' + petalPath(r0, it.L, W) + '" fill="url(#' + id + "g" + D.GROUP_OF[it.k] + ')" stroke="var(--ky-bg)" stroke-width="' + (opts.mini ? 1 : 1.6) + '" stroke-linejoin="round"/>');
        out.push('<path d="M0,' + f(-r0 * 1.2) + " Q" + f(W * 0.12) + "," + f(-it.L * 0.5) + " 0," + f(-it.L * 0.8) + '" fill="none" stroke="var(--ky-bg)" stroke-width="' + (opts.mini ? 0.6 : 1.1) + '" stroke-opacity="0.7"/>');
      }
      out.push("</g>");
    });
    // 花蕊
    out.push('<circle cx="' + cx + '" cy="' + cy + '" r="' + f(r0 * 1.25) + '" fill="var(--ky-gold)" fill-opacity="0.25"/>');
    for (var i = 0; i < 9; i++) {
      var q = pt(cx, cy, r0 * 1.7, -70 + i * 40);
      out.push('<line x1="' + cx + '" y1="' + cy + '" x2="' + f(q[0]) + '" y2="' + f(q[1]) + '" stroke="var(--ky-gold)" stroke-width="' + (opts.mini ? 0.6 : 1) + '"/>');
      out.push('<circle cx="' + f(q[0]) + '" cy="' + f(q[1]) + '" r="' + (opts.mini ? 1.2 : 2.4) + '" fill="var(--ky-gold)"/>');
    }
    out.push('<circle cx="' + cx + '" cy="' + cy + '" r="' + f(r0 * 0.6) + '" fill="var(--ky-gold)"/>');
    if (opts.labels) {
      items.forEach(function (it) {
        var lp = pt(cx, cy, R + 16, angleOf(it.i));
        out.push('<text x="' + f(lp[0]) + '" y="' + f(lp[1] - (opts.values ? 6 : 0)) + '" class="ky-crest-key" text-anchor="middle" dominant-baseline="middle">' + it.k + "</text>");
        if (opts.values) {
          var t = it.hidden ? "？" : data.v[it.k] + " " + Core.grade(data.v[it.k]);
          out.push('<text x="' + f(lp[0]) + '" y="' + f(lp[1] + 9) + '" class="ky-crest-val" text-anchor="middle" dominant-baseline="middle">' + t + "</text>");
        }
      });
    }
    out.push("</svg>");
    return out.join("");
  }

  // 個體 → 花紋（依目前親密度隱藏未解鎖的三華）
  function forInstance(inst, opts) {
    var hidden = {};
    D.ORDER.forEach(function (k) { if (!Core.isVisible(inst, k)) hidden[k] = true; });
    return render({ v: inst.v, hidden: hidden }, opts);
  }

  window.PriTestKyukaCrest = { render: render, forInstance: forInstance };
})();
