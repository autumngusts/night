// 大名幸村「天下布武」：新本陣（軍略樹）與符文格的畫面（2026-11-06 依使用者需求新增）。
// 由 yukimura.js 呼叫：Tree(ctx)、Board(ctx) 回傳一個 DOM 節點。
// ctx：{ el, btn, t, L, hex, statText, get()（讀存檔）, save(tp), rerender() }
// 存檔（localStorage "pritest-yukimura-tenka"）：{ kg, tree{nodeId: lv}, inv[{u,k}], board[{u,k,x,y,rot}], nu, heat, games, wins, best }
(function () {
  "use strict";

  var TK = window.PriTestYukimuraTenka;
  var CELL = 34;   // 符文格一格的像素

  function nodeCost(n, lv) { return Math.round(n.cost * (1 + 0.6 * lv)); }
  function nodeOpen(tree, n) { return !n.req.length || n.req.some(function (r) { return (tree[r] | 0) > 0; }); }
  function spentOn(tree) {
    var sum = 0;
    TK.TREE.forEach(function (n) { for (var i = 0; i < (tree[n.id] | 0); i++) sum += nodeCost(n, i); });
    return sum;
  }
  function nodeText(ctx, n) {
    if (n.eff) return ctx.statText(n.eff[0], n.eff[1]) + " / Lv";
    return ctx.L(TK.SP_TEXT[n.sp]);
  }

  // ---------------- 軍略樹 ----------------
  function Tree(ctx) {
    var el = ctx.el, t = ctx.t, L = ctx.L;
    var tp = ctx.get(), tree = tp.tree;
    var wrap = el("div", { class: "yk-tk-treebox" });
    var cols = 7, rows = 7, GX = 64, GY = 70;
    var area = el("div", { class: "yk-tk-tree", style: "width:" + (cols * GX) + "px;height:" + (rows * GY) + "px" });
    // 連線
    var lines = [];
    TK.TREE.forEach(function (n) {
      n.req.forEach(function (r) {
        var a = TK.NODE[r];
        var on = (tree[r] | 0) > 0;
        lines.push('<line x1="' + (a.x * GX + GX / 2) + '" y1="' + (a.y * GY + GY / 2) + '" x2="' + (n.x * GX + GX / 2) + '" y2="' + (n.y * GY + GY / 2) + '" class="' + (on ? "yk-tk-ln-on" : "yk-tk-ln") + '"/>');
      });
    });
    area.appendChild(el("div", { class: "yk-tk-lines", html: '<svg width="' + (cols * GX) + '" height="' + (rows * GY) + '" xmlns="http://www.w3.org/2000/svg">' + lines.join("") + "</svg>" }));
    var sel = ctx.sel && TK.NODE[ctx.sel] ? TK.NODE[ctx.sel] : TK.NODE.root;
    TK.TREE.forEach(function (n) {
      var lv = tree[n.id] | 0, open = nodeOpen(tree, n), max = lv >= n.max;
      var cls = "yk-tk-node" + (max ? " yk-tk-max" : lv ? " yk-tk-some" : open ? " yk-tk-open" : " yk-tk-lock") + (n === sel ? " yk-on" : "");
      area.appendChild(el("button", { type: "button", class: cls, style: "left:" + (n.x * GX + GX / 2) + "px;top:" + (n.y * GY + GY / 2) + "px", title: L(n.name),
        onclick: function () { ctx.sel = n.id; ctx.rerender(); } }, [el("span", { class: "yk-tk-ic" }, [n.icon]), el("span", { class: "yk-tk-lv" }, [lv + "/" + n.max])]));
    });
    wrap.appendChild(el("div", { class: "yk-tk-scroll" }, [area]));
    // 選中節點的說明與購買
    var lv = tree[sel.id] | 0, open = nodeOpen(tree, sel), cost = nodeCost(sel, lv);
    var reqNames = sel.req.map(function (r) { return L(TK.NODE[r].name); }).join(t("yk_tk_or"));
    wrap.appendChild(el("div", { class: "yk-tk-detail" }, [
      el("div", null, [el("strong", null, [sel.icon, " ", L(sel.name)]), " ", el("span", { class: "yk-chip" }, ["Lv " + lv + " / " + sel.max])]),
      el("div", { class: "yk-small" }, [nodeText(ctx, sel)]),
      sel.req.length ? el("div", { class: "yk-small yk-muted" }, [t("yk_tk_req", { r: reqNames })]) : null,
      el("div", { class: "yk-actions" }, [
        lv >= sel.max ? el("span", { class: "yk-chip yk-good" }, [t("yk_max")])
          : !open ? el("span", { class: "yk-chip" }, ["🔒 " + t("yk_tk_locked")])
          : ctx.btn("🎖️ " + cost + " " + t("yk_tk_learn"), function () {
            var p2 = ctx.get();
            if (p2.kg < cost || (p2.tree[sel.id] | 0) >= sel.max || !nodeOpen(p2.tree, sel)) return;
            p2.kg -= cost; p2.tree[sel.id] = (p2.tree[sel.id] | 0) + 1;
            ctx.save(p2); ctx.rerender();
          }, "yk-btn yk-primary", { disabled: tp.kg < cost })
      ])
    ]));
    wrap.appendChild(el("div", { class: "yk-actions" }, [ctx.btn(t("yk_tk_reset"), function () {
      if (!window.confirm(t("yk_tk_reset_q"))) return;
      var p2 = ctx.get();
      p2.kg += spentOn(p2.tree); p2.tree = {};
      // 符文格縮小：放不下的符文退回背包
      var size = TK.boardSize(p2.tree);
      p2.board = p2.board.filter(function (p) { return TK.evalBoard([p], size).ok; });
      if (!TK.evalBoard(p2.board, size).ok) p2.board = [];
      ctx.save(p2); ctx.rerender();
    }, "yk-link")]));
    return wrap;
  }

  // ---------------- 符文：形狀小圖 ----------------
  function shapeSvg(k, rot, px, ctx) {
    var R = TK.RUNE[k], cells = TK.runeCells(k, rot), w = 0, h = 0;
    cells.forEach(function (c) { w = Math.max(w, c[0] + 1); h = Math.max(h, c[1] + 1); });
    var col = ctx.hex(R.color), s = px;
    var rects = cells.map(function (c) { return '<rect x="' + (c[0] * s + 1) + '" y="' + (c[1] * s + 1) + '" width="' + (s - 2) + '" height="' + (s - 2) + '" rx="3" fill="' + col + '"/>'; }).join("");
    return '<svg width="' + (w * s) + '" height="' + (h * s) + '" xmlns="http://www.w3.org/2000/svg">' + rects + "</svg>";
  }
  function runeDesc(ctx, k) {
    var R = TK.RUNE[k], parts = (R.st || []).map(function (b) { return ctx.statText(b[0], b[1]); });
    if (R.sp) parts.push(ctx.L(TK.RUNE_SP[R.sp]));
    return parts.join("・");
  }
  // 錨點：形狀裡 row-major 的第一格（點哪一格，那一格就放在那裡）
  function anchor(k, rot) {
    var cells = TK.runeCells(k, rot), a = cells[0];
    cells.forEach(function (c) { if (c[1] < a[1] || (c[1] === a[1] && c[0] < a[0])) a = c; });
    return a;
  }

  // ---------------- 符文格 ----------------
  function Board(ctx) {
    var el = ctx.el, t = ctx.t, L = ctx.L;
    var tp = ctx.get(), size = TK.boardSize(tp.tree), W = size[0], H = size[1];
    var b = TK.evalBoard(tp.board, size);
    if (!b.ok) { tp.board = []; ctx.save(tp); b = TK.evalBoard(tp.board, size); }
    ctx.rot = ctx.rot | 0;
    var placedU = {};
    tp.board.forEach(function (p) { placedU[p.u] = 1; });
    if (ctx.pick && (placedU[ctx.pick] || !tp.inv.some(function (r) { return r.u === ctx.pick; }))) ctx.pick = null;
    var pickItem = ctx.pick ? tp.inv.filter(function (r) { return r.u === ctx.pick; })[0] : null;
    var wrap = el("div", { class: "yk-tk-boardbox" });

    // 格子
    var gridEl = el("div", { class: "yk-tk-board", style: "width:" + (W * CELL) + "px;height:" + (H * CELL) + "px" });
    var cellsEl = [];
    function previewAt(x, y) {
      cellsEl.forEach(function (c) { c.classList.remove("yk-tk-pv-ok", "yk-tk-pv-ng"); });
      if (!pickItem) return;
      var a = anchor(pickItem.k, ctx.rot), ox = x - a[0], oy = y - a[1];
      var ok = TK.canPlace(tp.board, size, pickItem.k, ox, oy, ctx.rot, -1);
      TK.runeCells(pickItem.k, ctx.rot).forEach(function (c) {
        var cx = ox + c[0], cy = oy + c[1];
        if (cx >= 0 && cy >= 0 && cx < W && cy < H) cellsEl[cy * W + cx].classList.add(ok ? "yk-tk-pv-ok" : "yk-tk-pv-ng");
      });
    }
    function tapCell(x, y) {
      var idx = b.grid[y * W + x];
      var p2 = ctx.get();
      if (idx >= 0) {   // 拿起已放的符文
        var p = p2.board[idx];
        p2.board.splice(idx, 1);
        ctx.pick = p.u; ctx.rot = p.rot | 0;
        ctx.save(p2); ctx.rerender();
        return;
      }
      if (!pickItem) return;
      var a = anchor(pickItem.k, ctx.rot), ox = x - a[0], oy = y - a[1];
      if (!TK.canPlace(p2.board, size, pickItem.k, ox, oy, ctx.rot, -1)) { ctx.flash = t("yk_tk_cant"); ctx.rerender(); return; }
      p2.board.push({ u: pickItem.u, k: pickItem.k, x: ox, y: oy, rot: ctx.rot });
      ctx.pick = null;
      ctx.save(p2); ctx.rerender();
    }
    for (var y = 0; y < H; y++) {
      for (var x = 0; x < W; x++) {
        (function (x, y) {
          var idx = b.grid[y * W + x], R = idx >= 0 ? TK.RUNE[tp.board[idx].k] : null;
          var c = el("button", { type: "button", class: "yk-tk-cell" + (R ? " yk-tk-filled" : ""), style: "left:" + (x * CELL) + "px;top:" + (y * CELL) + "px" + (R ? ";background:" + ctx.hex(R.color) : ""),
            title: R ? L(R.name) : "", onclick: function () { tapCell(x, y); } }, [R ? R.icon : ""]);
          c.addEventListener("pointerenter", function () { previewAt(x, y); });
          cellsEl.push(c);
          gridEl.appendChild(c);
        })(x, y);
      }
    }
    gridEl.addEventListener("pointerleave", function () { previewAt(-99, -99); });
    // 列／欄填滿的標示
    var fullRows = [], fullCols = [];
    for (y = 0; y < H; y++) { var fr = true; for (x = 0; x < W; x++) if (b.grid[y * W + x] < 0) fr = false; if (fr) fullRows.push(y); }
    for (x = 0; x < W; x++) { var fc = true; for (y = 0; y < H; y++) if (b.grid[y * W + x] < 0) fc = false; if (fc) fullCols.push(x); }
    fullRows.forEach(function (ry) { gridEl.appendChild(el("span", { class: "yk-tk-rowmark", style: "top:" + (ry * CELL + CELL / 2) + "px;left:" + (W * CELL + 4) + "px" }, ["✓"])); });
    fullCols.forEach(function (cx) { gridEl.appendChild(el("span", { class: "yk-tk-colmark", style: "left:" + (cx * CELL + CELL / 2) + "px;top:" + (H * CELL + 2) + "px" }, ["✓"])); });

    var lo = TK.loadout(tp);
    var stat = el("div", { class: "yk-tk-boardinfo" }, [
      el("div", null, [el("strong", null, [t("yk_tk_board_size", { w: W, h: H })])]),
      el("div", { class: "yk-small" }, [t("yk_tk_filled", { n: b.filled, m: W * H })]),
      el("div", { class: "yk-small" }, [t("yk_tk_lines", { n: b.lines }), "：", TK.LINE_BONUS.map(function (x) { return ctx.statText(x[0], x[1]); }).join("・"), " ×", String(b.lines)]),
      el("div", { class: "yk-small" + (b.perfect ? " yk-good" : " yk-muted") }, [(b.perfect ? "🌟 " : "☆ ") + t("yk_tk_perfect"), "：", TK.PERFECT_BONUS.map(function (x) { return ctx.statText(x[0], x[1]); }).join("・")]),
      el("div", { class: "yk-small yk-muted" }, [t("yk_tk_board_note")]),
      el("div", { class: "yk-small" }, [t("yk_tk_carry", { n: lo.runes.length })])
    ]);
    wrap.appendChild(el("div", { class: "yk-tk-boardrow" }, [el("div", { class: "yk-tk-boardpad" }, [gridEl]), stat]));

    // 手上的符文（選中後點格子放下）
    var ctrl = el("div", { class: "yk-actions" }, [
      pickItem ? el("span", { class: "yk-tk-hand", html: shapeSvg(pickItem.k, ctx.rot, 16, ctx) }) : null,
      pickItem ? el("span", { class: "yk-small" }, [L(TK.RUNE[pickItem.k].name)]) : el("span", { class: "yk-small yk-muted" }, [t("yk_tk_pick_hint")]),
      ctx.btn("↻ " + t("yk_tk_rotate"), function () { ctx.rot = (ctx.rot + 1) % 4; ctx.rerender(); }, "yk-btn", { disabled: !pickItem }),
      pickItem ? ctx.btn("♻️ " + t("yk_tk_scrap", { n: scrapValue(pickItem.k) }), function () {
        if (!window.confirm(t("yk_tk_scrap_q"))) return;
        var p2 = ctx.get();
        p2.inv = p2.inv.filter(function (r) { return r.u !== pickItem.u; });
        p2.kg += scrapValue(pickItem.k);
        ctx.pick = null; ctx.save(p2); ctx.rerender();
      }, "yk-btn") : null,
      ctx.btn(t("yk_tk_clear"), function () { var p2 = ctx.get(); p2.board = []; ctx.save(p2); ctx.rerender(); }, "yk-link")
    ]);
    wrap.appendChild(ctrl);
    if (ctx.flash) { wrap.appendChild(el("p", { class: "yk-small yk-bad" }, [ctx.flash])); ctx.flash = ""; }

    // 背包
    var inv = el("div", { class: "yk-tk-inv" });
    var sorted = tp.inv.slice().sort(function (a, c) { var A = TK.RUNE[a.k], B = TK.RUNE[c.k]; return B.r - A.r || A.i - B.i; });
    sorted.forEach(function (r) {
      var R = TK.RUNE[r.k];
      if (!R) return;
      var used = !!placedU[r.u];
      inv.appendChild(el("button", { type: "button", class: "yk-tk-rune yk-r" + R.r + (used ? " yk-tk-used" : "") + (ctx.pick === r.u ? " yk-on" : ""),
        onclick: function () { if (used) return; ctx.pick = ctx.pick === r.u ? null : r.u; ctx.rerender(); } }, [
        el("span", { class: "yk-tk-shape", html: shapeSvg(r.k, 0, 11, ctx) }),
        el("span", { class: "yk-tk-rune-b" }, [el("span", null, [el("strong", null, [L(R.name)]), " ", el("span", { class: "yk-chip" }, ["★".repeat(R.r)]), used ? el("span", { class: "yk-chip yk-good" }, [t("yk_tk_in_use")]) : null]),
          el("span", { class: "yk-small" }, [runeDesc(ctx, r.k)])])
      ]));
    });
    wrap.appendChild(el("h3", null, [t("yk_tk_inv", { n: tp.inv.length })]));
    wrap.appendChild(el("div", { class: "yk-actions" }, [
      ctx.btn("🎴 " + t("yk_tk_draw", { n: DRAW_COST }), function () {
        var p2 = ctx.get();
        if (p2.kg < DRAW_COST) return;
        p2.kg -= DRAW_COST;
        var k = rollRune(Math.random, 0);
        addRune(p2, k);
        ctx.save(p2);
        ctx.flash = "";
        ctx.drew = k;
        ctx.rerender();
      }, "yk-btn yk-primary", { disabled: tp.kg < DRAW_COST }),
      ctx.drew ? el("span", { class: "yk-chip yk-good" }, ["＋ " + L(TK.RUNE[ctx.drew].name)]) : null
    ]));
    ctx.drew = null;
    wrap.appendChild(inv);
    return wrap;
  }

  var DRAW_COST = 40;
  function scrapValue(k) { var R = TK.RUNE[k]; return R ? [0, 12, 25, 50][R.r] : 0; }
  // 依稀有度抽一個符文；bonus（0〜1）越高越容易出高稀有
  function rollRune(rand, bonus) {
    var r = rand(), b = Math.max(0, Math.min(1, bonus || 0));
    var rar = r < 0.08 + 0.2 * b ? 3 : r < 0.4 + 0.25 * b ? 2 : 1;
    var pool = TK.RUNES.filter(function (x) { return x.r === rar; });
    return pool[Math.floor(rand() * pool.length)].k;
  }
  function addRune(tp, k) {
    tp.nu = (tp.nu | 0) + 1;
    tp.inv.push({ u: "r" + tp.nu, k: k });
  }

  window.PriTestYukimuraTenkaUI = { Tree: Tree, Board: Board, shapeSvg: shapeSvg, runeDesc: runeDesc, rollRune: rollRune, addRune: addRune, nodeCost: nodeCost, DRAW_COST: DRAW_COST };
})();
