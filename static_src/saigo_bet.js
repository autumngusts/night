// 賽狗賽狗（saigo）：下注——馬券式的 7 種票、三種買法（普通／BOX／壓住＝軸流し）、展開組合、結算與派彩表。
// 票（ticket）：{ type, method: "normal" | "box" | "key", picks: [gate...], key: gate | null, stake: 每注金額, odds: { combo: 賠率 } }
// 組合字串與 Core.odds() 的鍵一致：無順序的票用小到大排序（"1-4"），有順序的照名次（"4-1-2"）。
(function () {
  "use strict";

  var D = window.PriTestSaigoData;
  var Core = window.PriTestSaigoCore;
  var TYPE = {};
  D.BET_TYPES.forEach(function (b) { TYPE[b.id] = b; });

  function sortNum(a) { return a.slice().sort(function (x, y) { return x - y; }); }
  function uniq(a) { var o = {}, r = []; a.forEach(function (x) { if (!o[x]) { o[x] = 1; r.push(x); } }); return r; }
  function combos(arr, k) {
    var out = [];
    (function rec(start, cur) {
      if (cur.length === k) { out.push(cur.slice()); return; }
      for (var i = start; i < arr.length; i++) { cur.push(arr[i]); rec(i + 1, cur); cur.pop(); }
    })(0, []);
    return out;
  }
  function perms(arr, k) {
    var out = [];
    (function rec(cur, used) {
      if (cur.length === k) { out.push(cur.slice()); return; }
      for (var i = 0; i < arr.length; i++) {
        if (used[i]) continue;
        used[i] = 1; cur.push(arr[i]); rec(cur, used); cur.pop(); used[i] = 0;
      }
    })([], {});
    return out;
  }

  // 票 → 組合字串陣列
  function expand(tk) {
    var bt = TYPE[tk.type];
    if (!bt) return [];
    var picks = uniq(tk.picks || []);
    if (bt.pick === 1) return sortNum(picks).map(String);
    var list = [];
    if (tk.method === "normal") {
      if (picks.length !== bt.pick) return [];
      list = [bt.ordered ? picks : sortNum(picks)];
    } else if (tk.method === "box") {
      if (picks.length < bt.pick) return [];
      list = bt.ordered ? perms(picks, bt.pick) : combos(sortNum(picks), bt.pick);
    } else if (tk.method === "key") {
      // 壓住（軸流し）：有順序的票＝軸固定第 1 名；無順序的票＝組合裡一定有軸
      var key = tk.key, others = picks.filter(function (x) { return x !== key; });
      if (key === null || key === undefined || others.length < bt.pick - 1) return [];
      var rest = bt.ordered ? perms(others, bt.pick - 1) : combos(sortNum(others), bt.pick - 1);
      list = rest.map(function (r) { var c = [key].concat(r); return bt.ordered ? c : sortNum(c); });
    }
    return uniq(list.map(function (c) { return c.join("-"); }));
  }

  // 這個組合在這個名次下中不中
  function hit(type, combo, order) {
    var c = String(combo).split("-").map(Number), o = order;
    switch (type) {
      case "win": return c[0] === o[0];
      case "place": return c[0] === o[0] || c[0] === o[1];
      case "quinella": return sortNum([o[0], o[1]]).join("-") === combo;
      case "exacta": return c[0] === o[0] && c[1] === o[1];
      case "wide": var top3 = [o[0], o[1], o[2]]; return top3.indexOf(c[0]) >= 0 && top3.indexOf(c[1]) >= 0;
      case "trio": return sortNum([o[0], o[1], o[2]]).join("-") === combo;
      case "trifecta": return c[0] === o[0] && c[1] === o[1] && c[2] === o[2];
    }
    return false;
  }

  // 建立票：把展開的組合與當下賠率一起記下（固定賠率）
  function makeTicket(card, type, method, picks, key, stake) {
    var o = Core.odds(card)[type] || {};
    var tk = { type: type, method: TYPE[type] && TYPE[type].pick === 1 ? "normal" : method, picks: uniq(picks), key: key === undefined ? null : key, stake: Math.max(100, Math.floor(stake / 100) * 100) };
    tk.combos = expand(tk);
    tk.odds = {};
    tk.combos.forEach(function (c) { tk.odds[c] = o[c] || 1.1; });
    tk.cost = tk.combos.length * tk.stake;
    return tk;
  }

  // 結算：每張票的中獎組合與派彩
  function settle(tickets, order) {
    var spent = 0, won = 0;
    var rows = (tickets || []).map(function (tk) {
      spent += tk.cost;
      var hits = tk.combos.filter(function (c) { return hit(tk.type, c, order); });
      var pay = 0;
      hits.forEach(function (c) { pay += Math.floor(tk.stake * tk.odds[c]); });
      won += pay;
      return { tk: tk, hits: hits, pay: pay };
    });
    return { rows: rows, spent: spent, won: won };
  }

  // 派彩表（每 100 元）：每種票的中獎組合
  function payoutTable(card, order) {
    var od = Core.odds(card);
    return D.BET_TYPES.map(function (bt) {
      var keys = Object.keys(od[bt.id]).filter(function (c) { return hit(bt.id, c, order); });
      if (bt.id === "place" || bt.id === "wide") keys.sort();
      return { type: bt.id, list: keys.map(function (c) { return { combo: c, pay: Math.floor(100 * od[bt.id][c]) }; }) };
    });
  }

  // 顯示用：組合字串 → 「3-5-1」（枠號從 1 開始）；無順序用「=」連接
  function comboLabel(type, combo) {
    var bt = TYPE[type], c = String(combo).split("-").map(function (x) { return Number(x) + 1; });
    return c.join(bt && !bt.ordered ? "=" : "→");
  }

  window.PriTestSaigoBet = {
    TYPE: TYPE, expand: expand, hit: hit, makeTicket: makeTicket, settle: settle, payoutTable: payoutTable, comboLabel: comboLabel
  };
})();
