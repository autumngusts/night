// 深夜居酒屋（izakaya）：即時尖峰（週五、週六 20:00 前後，約 90 秒）。房主用固定步長 step(s, dt) 推進；
// 玩家意圖：rc＝開始做、rt＝起鍋、rs＝上菜。每個工作站有負責的職位（連線分工），單機一人全包。
// 串燒與炸物超過烹調時間 1.7 倍會燒焦，回到待做。結束後把營收與滿意度併入當晚結算。
(function () {
  "use strict";
  var D = window.PriTestIzakayaData;
  function Core() { return window.PriTestIzakayaCore; }

  var STATIONS = ["grill", "fry", "pot", "cold", "bar"];
  var SLOTS = { grill: 3, fry: 2, pot: 2, cold: 2, bar: 2 };
  var STATION_ROLE = { grill: "chef", fry: "chef", pot: "buyer", cold: "buyer", bar: "bar" };
  var STAFF_STATION = { fast: "grill", memo: "cold", bar: "bar" };
  var BURN = { grill: 1.7, fry: 1.7 };

  function start(s) {
    var n = 4 + s.maxStar, seats = [], st = {};
    for (var i = 0; i < n; i++) seats.push({ id: i, gid: "", items: [], pat: 0, max: 0 });
    STATIONS.forEach(function (k) { st[k] = []; for (var j = 0; j < SLOTS[k]; j++) st[k].push(null); });
    s.rush = { t: 0, dur: 90, seats: seats, st: st, next: 2, stats: { served: 0, burnt: 0, left: 0, rev: 0, sats: [] } };
  }
  function interval(s) { return Math.max(5, 9 - (s.order.length - 1)); }
  function cookTime(s, d) {
    var t = D.DISHES[d].cook * (s.order.length === 1 ? 0.8 : 1), stf = Core().staffNow(s);
    if (stf && stf.ability === "fast" && D.DISHES[d].st === "grill") t *= 0.8;
    return t;
  }
  function spawn(s) {
    var R = s.rush, free = R.seats.filter(function (x) { return !x.gid; });
    if (!free.length) return;
    var K = Core(), seat = free[K.rint(s, free.length)];
    var food = s.board.filter(function (k) { return D.DISHES[k].cat !== "drink"; }), drink = s.board.filter(function (k) { return D.DISHES[k].cat === "drink"; });
    var items = [];
    if (food.length) items.push({ d: food[K.rint(s, food.length)], s: "wait" });
    if (drink.length && K.rnd(s) < 0.8) items.push({ d: drink[K.rint(s, drink.length)], s: "wait" });
    if (!items.length) return;
    seat.gid = s.pool[K.rint(s, s.pool.length)].id;
    seat.items = items;
    seat.max = seat.pat = 35 + K.rint(s, 11);
  }
  function leave(s, seat, sat) { s.rush.stats.sats.push(sat); seat.gid = ""; seat.items = []; seat.pat = seat.max = 0; }
  function step(s, dt) {
    var R = s.rush;
    if (!R) return;
    R.t += dt;
    R.next -= dt;
    while (R.next <= 0 && R.t < R.dur) { spawn(s); R.next += interval(s); }
    R.seats.forEach(function (seat) {
      if (!seat.gid) return;
      seat.pat -= dt;
      if (seat.pat <= 0) {
        R.stats.left++;
        STATIONS.forEach(function (k) { R.st[k] = R.st[k].map(function (sl) { return sl && sl.seat === seat.id ? null : sl; }); });
        leave(s, seat, 20);
      }
    });
    var stf = Core().staffNow(s), auto = stf ? STAFF_STATION[stf.ability] : null;
    STATIONS.forEach(function (k) {
      R.st[k].forEach(function (sl, i) {
        if (!sl) return;
        var el = R.t - sl.t0;
        if (auto === k && el >= sl.cook) { takeOut(s, k, i); return; }
        if (BURN[k] && el >= sl.cook * BURN[k]) {
          R.stats.burnt++;
          var seat = R.seats[sl.seat];
          if (seat.items[sl.k]) seat.items[sl.k].s = "wait";
          R.st[k][i] = null;
        }
      });
    });
    if (stf && stf.ability === "host") R.seats.forEach(function (seat) { seat.items.forEach(function (it, k) { if (it.s === "ready") serveItem(s, seat, k); }); });
    if (R.t >= R.dur) finish(s);
  }
  function takeOut(s, k, i) {
    var R = s.rush, sl = R.st[k][i];
    if (!sl || R.t - sl.t0 < sl.cook) return false;
    var seat = R.seats[sl.seat];
    if (seat.items[sl.k]) seat.items[sl.k].s = "ready";
    R.st[k][i] = null;
    return true;
  }
  function serveItem(s, seat, k) {
    var R = s.rush, it = seat.items[k];
    if (!it || it.s !== "ready") return false;
    it.s = "done"; R.stats.rev += D.DISHES[it.d].price;
    if (seat.items.every(function (x) { return x.s === "done"; })) {
      R.stats.served++;
      leave(s, seat, Math.round(60 + 40 * Math.max(0, seat.pat) / seat.max));
    }
    return true;
  }
  function intent(s, pid, it) {
    var R = s.rush, K = Core();
    if (!R || !it) return false;
    if (it.a === "rc") {
      var seat = R.seats[it.seat], item = seat && seat.items[it.k];
      if (!item || item.s !== "wait") return false;
      var st = D.DISHES[item.d].st;
      if (!K.hasRole(s, pid, STATION_ROLE[st])) return false;
      var free = R.st[st].indexOf(null);
      if (free < 0 || !K.makeOne(s, item.d)) return false;
      R.st[st][free] = { seat: seat.id, k: it.k, d: item.d, t0: R.t, cook: cookTime(s, item.d) };
      item.s = "cook";
      return true;
    }
    if (it.a === "rt") {
      if (!R.st[it.st] || !K.hasRole(s, pid, STATION_ROLE[it.st])) return false;
      return takeOut(s, it.st, it.slot);
    }
    if (it.a === "rs") {
      if (!K.hasRole(s, pid, "hall")) return false;
      var se = R.seats[it.seat];
      return !!se && serveItem(s, se, it.k);
    }
    return false;
  }
  function finish(s) {
    var R = s.rush, n = s.night;
    R.seats.forEach(function (seat) { if (seat.gid) leave(s, seat, 40); });
    s.cash += R.stats.rev;
    R.stats.sats.forEach(function (sat) { s.rep = Math.max(0, s.rep + Core().repDelta(sat)); n.satSum += sat; n.satN++; });
    n.rev += R.stats.rev;
    n.rushStats = R.stats;
    s.rush = null;
    n.i++;
    Core().enterGroup(s);
  }

  window.PriTestIzakayaRush = { STATIONS: STATIONS, SLOTS: SLOTS, STATION_ROLE: STATION_ROLE, start: start, step: step, intent: intent, finish: finish };
})();
