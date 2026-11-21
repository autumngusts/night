/* イヌスノー（狗雪）第 5 階段：成長與收集（docs/inusnow_design.md §20）。
   技術等級與能力點、有效選手（犬種＋能力點＋主場＋疲勞＋美食＋裝備＋打蠟＋好感）、選手規格字串（重播與分享）、
   雪場解鎖、真實季節、好感度與照顧、溫泉與美食、公園碼。
   直接改傳進來的 save 物件（存檔由畫面負責），不碰 DOM、不讀寫 localStorage；只用 + − × ÷、Math.floor（設計 §11）。 */
(function (root) {
  "use strict";

  var D = root.PriTestInusnowData || (typeof require === "function" ? require("./inusnow_data.js") : null);
  var Core = root.PriTestInusnowCore || (typeof require === "function" ? require("./inusnow_core.js") : null);
  var PR = D.PROG, STATS = ["bal", "pow", "brv", "tec", "siz", "cld"];

  function newDog() { return { lv: 1, exp: 0, pts: 0, add: { bal: 0, pow: 0, brv: 0, tec: 0, siz: 0, cld: 0 }, aff: 0, groom: "", races: 0, raceDay: "", food: null }; }
  function dogOf(save, b) {
    if (!save.dogs || typeof save.dogs !== "object") save.dogs = {};
    if (!save.dogs[b]) save.dogs[b] = newDog();
    var d = save.dogs[b];
    if (!d.add) d.add = newDog().add;
    return d;
  }
  function need(lv) { return PR.levelBase * lv; }
  // 經驗（§20.1）：o＝{finished, place, tricks360, stamps, mission}
  function expFor(o) {
    var n = 0;
    if (o.finished) n += o.mission ? PR.mission : PR.finish;
    if (o.place >= 1 && o.place <= 3) n += PR.place[o.place - 1];
    n += (o.tricks360 || 0) * PR.trick360 + (o.stamps || 0) * PR.stamp;
    return n;
  }
  function addExp(save, b, n) {
    var d = dogOf(save, b), up = 0;
    d.exp += n;
    save.totalExp = (save.totalExp || 0) + n;
    while (d.lv < PR.lvMax && d.exp >= need(d.lv)) { d.exp -= need(d.lv); d.lv += 1; d.pts += PR.pts; up += 1; }
    return up;
  }
  function capOf(b, k) { var c = Core.breed(b).stats[k] + PR.addMax; return c > PR.statMax ? PR.statMax : c; }
  function allocate(save, b, k) {
    var d = dogOf(save, b);
    if (STATS.indexOf(k) < 0 || d.pts <= 0 || Core.breed(b).stats[k] + d.add[k] + 1 > capOf(b, k)) return false;
    d.add[k] += 1; d.pts -= 1;
    return true;
  }

  // 主場（§20.5）
  function isHome(b, resort) {
    var reg = D.REGION[resort], list = reg ? D.HOME.region[reg] : null;
    return !!list && list.indexOf(b) >= 0;
  }
  // 疲勞：同一天（JST）連續 FATIGUE.races 場以上
  function tired(d, date) { return d.raceDay === date && d.races >= D.FATIGUE.races; }

  // 裝備（§20.2、§20.10）→ dog.gear（沒有效果時 null）
  function findItem(list, id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return list[0]; }
  function gearOf(save) {
    var gs = save.gear || {}, out = {}, any = false;
    function mul(k, v) { if (v && v !== 1) { out[k] = (out[k] || 1) * v; any = true; } }
    var parts = gs.ski ? [findItem(D.GEAR.ski, gs.skiId || "ski-M")] : [findItem(D.GEAR.board, gs.board || "std")];
    parts.push(findItem(D.GEAR.bind, gs.bind || "b0"));
    parts.forEach(function (it) { mul("turn", it.turn); mul("drag", it.drag); mul("spin", it.spin); mul("grip", it.grip); });
    if (gs.ski) {
      var S = D.SKI;
      mul("grip", S.grip); mul("turn", S.turn); mul("spin", S.spin);
      out.startV = S.startV; out.crouchDrag = S.crouchDrag; out.ski = true; any = true;
    }
    return any ? out : null;
  }
  function jacketCld(save) { return findItem(D.GEAR.jacket, (save.gear || {}).jacket || "j0").cld || 0; }
  function fogMul(save) { return findItem(D.GEAR.goggle, (save.gear || {}).goggle || "g0").fog || 1; }
  // 打蠟（§20.3）：選了而且有庫存才有效
  function waxMu(save, snow) {
    var w = save.wax || {};
    if (!w.sel || !(w.stock && w.stock[w.sel] > 0)) return 1;
    return w.sel === snow ? D.WAX.good : D.WAX.bad;
  }

  // 有效選手：ctx＝{resort, snow, date}
  function effDog(save, b, ctx) {
    ctx = ctx || {};
    var base = Core.breed(b), d = dogOf(save, b), s = {}, i;
    for (i = 0; i < STATS.length; i++) s[STATS[i]] = base.stats[STATS[i]] + (d.add[STATS[i]] || 0);
    var bonus = (isHome(b, ctx.resort) ? D.HOME.bonus : 0) - (tired(d, ctx.date) ? D.FATIGUE.minus : 0);
    for (i = 0; i < STATS.length; i++) s[STATS[i]] += bonus;
    if (d.food && STATS.indexOf(d.food.stat) >= 0) s[d.food.stat] += D.FOOD.bonus;
    s.cld += jacketCld(save);
    for (i = 0; i < STATS.length; i++) { if (s[STATS[i]] > PR.statMax + 20) s[STATS[i]] = PR.statMax + 20; if (s[STATS[i]] < 1) s[STATS[i]] = 1; }
    var dog = { id: base.id, name: base.name, look: base.look, nose: base.nose, stats: s };
    var g = gearOf(save), mu = waxMu(save, ctx.snow || "groomed");
    if (mu !== 1) { g = g || {}; g.mu = mu; }
    if (g) dog.gear = g;
    if (d.aff > 0) dog.zoomMul = 1 + d.aff / D.AFF.zoomDiv;
    return dog;
  }
  function isBase(dog) {
    var b = Core.breed(dog.id);
    if (dog.gear || dog.zoomMul) return false;
    for (var i = 0; i < STATS.length; i++) if (dog.stats[STATS[i]] !== b.stats[STATS[i]]) return false;
    return true;
  }
  // 選手規格字串（重播、幽靈、分享碼用）："<犬種>~<6 項能力>~<裝備 k:v,…>~<zoomMul>"；標準選手＝""
  var GK = ["turn", "drag", "spin", "grip", "startV", "crouchDrag", "ski", "mu"];
  function spec(dog) {
    if (!dog || isBase(dog)) return "";
    var g = dog.gear || {}, gp = [];
    GK.forEach(function (k) { if (g[k] !== undefined) gp.push(k + ":" + (k === "ski" ? 1 : g[k])); });
    return dog.id + "~" + STATS.map(function (k) { return dog.stats[k]; }).join(",") + "~" + gp.join(",") + "~" + (dog.zoomMul || "");
  }
  function fromSpec(str, fallback) {
    var a = String(str || "").split("~");
    if (a.length !== 4) return Core.breed(fallback || "shiba");
    var base = Core.breed(a[0]), st = a[1].split(","), s = {};
    if (st.length !== 6) return base;
    for (var i = 0; i < 6; i++) { var v = +st[i]; if (!(v >= 0 && v <= 200)) return base; s[STATS[i]] = v; }
    var dog = { id: base.id, name: base.name, look: base.look, nose: base.nose, stats: s };
    var bad = false;
    if (a[2]) {
      var g = {};
      a[2].split(",").forEach(function (p) {
        var kv = p.split(":"), v = +kv[1];
        if (GK.indexOf(kv[0]) < 0) return;
        if (kv[0] === "ski") { g.ski = true; return; }
        if (!(v >= 0 && v <= 3)) bad = true;          // 壞掉的分享碼：整個退回犬種本身
        g[kv[0]] = v;
      });
      dog.gear = g;
    }
    if (a[3]) { var zm = +a[3]; if (!(zm >= 1 && zm <= 2)) bad = true; dog.zoomMul = zm; }
    return bad ? base : dog;
  }

  // 比賽結束：疲勞、好感、美食與蠟的消耗
  function afterRace(save, b, date, usedWax) {
    var d = dogOf(save, b);
    if (d.raceDay !== date) { d.raceDay = date; d.races = 0; }
    d.races += 1;
    d.aff = Math.min(D.AFF.max, d.aff + D.AFF.race);
    d.food = null;
    var w = save.wax || {};
    if (usedWax && w.sel && w.stock && w.stock[w.sel] > 0) w.stock[w.sel] -= 1;
  }
  function care(save, b, kind, date, resort) {
    var d = dogOf(save, b);
    if (kind === "groom") { if (d.groom === date) return "done"; d.groom = date; }
    else if (kind === "feed") { if ((save.coins || 0) < D.AFF.feed) return "coins"; save.coins -= D.AFF.feed; }
    else if (kind === "onsen") {
      if (D.ONSEN.resorts.indexOf(resort) < 0) return "none";
      if ((save.coins || 0) < D.ONSEN.price) return "coins";
      save.coins -= D.ONSEN.price; d.races = 0;
    } else if (kind === "food") {
      var it = D.FOOD.items[resort];
      if (!it) return "none";
      if ((save.coins || 0) < D.FOOD.price) return "coins";
      save.coins -= D.FOOD.price; d.food = { stat: it.stat, resort: resort };
      return null;
    }
    d.aff = Math.min(D.AFF.max, d.aff + D.AFF.care);
    return null;
  }
  // 教練指令的倍率（§20.4）
  function coachMul(save, b) { return 1 + dogOf(save, b).aff / D.AFF.coachDiv; }

  // 真實季節（§20.8）：date＝"YYYY-MM-DD"（JST）
  function season(date) {
    var m = +date.slice(5, 7), dd = +date.slice(8, 10);
    if (m >= 5 && m <= 11) return "dream";
    if ((m === 3 && dd >= 21) || m === 4) return "spring";
    return "regular";
  }
  // 雪場解鎖（§20.3）
  function unlockedList(save, date) {
    if (date && season(date) === "dream") return D.RESORTS.slice();
    var u = save.unlocked && save.unlocked.length ? save.unlocked.slice() : D.UNLOCK.start.slice();
    D.UNLOCK.start.forEach(function (r) { if (u.indexOf(r) < 0) u.push(r); });
    return u;
  }
  function isUnlocked(save, resort, date) { return unlockedList(save, date).indexOf(resort) >= 0; }
  // podium＝這一場（已開放雪場的比賽模式）拿到前 3 名；回傳新開放的雪場
  function checkUnlock(save, podium) {
    var u = unlockedList(save, null), out = [];
    function next() { for (var i = 0; i < D.UNLOCK.order.length; i++) if (u.indexOf(D.UNLOCK.order[i]) < 0) return D.UNLOCK.order[i]; return null; }
    if (podium) { var n = next(); if (n) { u.push(n); out.push(n); } }
    for (var g = 0; g < 10; g++) {
      var extra = u.length - D.UNLOCK.start.length, nx = next();
      if (!nx || (save.totalExp || 0) < D.UNLOCK.exp * (extra + 1)) break;
      u.push(nx); out.push(nx);
    }
    save.unlocked = u;
    return out;
  }
  // 收集章與稱號（§20.3、§20.5）
  function stampTitle(save, resort, have, total, b) {
    if (!total || have < total) return false;
    save.titles = save.titles || {};
    if (save.titles[resort] && (save.titles[resort].home || !isHome(b, resort))) return false;
    save.titles[resort] = { at: have, home: isHome(b, resort), breed: b };
    return true;
  }

  // ---------------- 公園碼（§20.7） ----------------
  // list＝[{kind, s, lat}]；回傳錯誤代碼或 null
  function validatePark(list, len) {
    var P2 = D.PARKED, SL = D.SLOPE, G = D.GATES;
    if (!list || list.length < P2.min || list.length > P2.max) return "count";
    var maxS = len - G.finishMargin - SL.finishAfter - SL.rail.len;
    var ss = list.slice().sort(function (a, b) { return a.s - b.s; });
    for (var i = 0; i < ss.length; i++) {
      var it = ss[i];
      if (P2.kinds.indexOf(it.kind) < 0) return "kind";
      if (it.s % P2.step !== 0 || it.s < P2.gap || it.s > maxS) return "range";
      if (it.lat % 1 !== 0 || it.lat < -P2.lat || it.lat > P2.lat) return "lat";
      if (i && it.s - ss[i - 1].s < P2.gap) return "gap";
    }
    var scoring = ss.filter(function (x) { return x.kind !== "roller"; }).length;
    return scoring ? null : "scoring";
  }
  function parkCode(resort, piste, list) {
    return ["inup1", resort, piste, list.map(function (x) { return x.kind + "@" + x.s + "@" + x.lat; }).join(",")].join("|");
  }
  function parseParkCode(str) {
    var a = String(str || "").trim().split("|");
    if (a.length !== 4 || a[0] !== "inup1" || !a[3]) return null;
    var list = a[3].split(",").map(function (p) { var q = p.split("@"); return { kind: q[0], s: +q[1], lat: +q[2] }; });
    for (var i = 0; i < list.length; i++) if (!isFinite(list[i].s) || !isFinite(list[i].lat)) return null;
    return { resort: a[1], piste: a[2], list: list };
  }

  var Prog = { STATS: STATS, newDog: newDog, dogOf: dogOf, need: need, expFor: expFor, addExp: addExp, capOf: capOf, allocate: allocate, isHome: isHome, tired: tired,
    findItem: findItem, gearOf: gearOf, fogMul: fogMul, waxMu: waxMu, effDog: effDog, isBase: isBase, spec: spec, fromSpec: fromSpec,
    afterRace: afterRace, care: care, coachMul: coachMul, season: season, unlockedList: unlockedList, isUnlocked: isUnlocked, checkUnlock: checkUnlock,
    stampTitle: stampTitle, validatePark: validatePark, parkCode: parkCode, parseParkCode: parseParkCode };
  root.PriTestInusnowProg = Prog;
  if (typeof module !== "undefined" && module.exports) module.exports = Prog;
})(typeof window !== "undefined" ? window : globalThis);
