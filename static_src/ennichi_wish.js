// ============================================================================
// 緣日樂園：繪馬許願（規格 §6.4）。客人參拜或買繪馬時掛上願望；完成加口碑、7 天沒完成撤下。
// ============================================================================
(function () {
  "use strict";
  var D = window.PriTestEnnichiData, C = D.C;
  var T = {
    build: C("好想在這裡玩{name}！", "ここで{name}がしたい！"),
    sell: C("想吃到{name}～（還差 {n} 份）", "{name}が食べたい〜（あと {n} 個）"),
    upgrade: C("希望{name}可以裝上{mod}", "{name}に{mod}が付いたらいいな"),
    queue: C("{name}可以不要排那麼久嗎……", "{name}の行列、もう少し短くならないかな……"),
    shelter: C("下雨天想要有個躲雨的地方", "雨の日に雨宿りできる場所がほしい"),
  };

  function fill(t, v) {
    function rep(str, lang) {
      return str.replace("{name}", v.name ? v.name[lang] : "").replace("{mod}", v.mod ? v.mod[lang] : "").replace("{n}", v.n != null ? String(v.n) : "");
    }
    return { zh: rep(t.zh, "zh"), ja: rep(t.ja, "ja") };
  }

  function active(s) { return s.wishes.filter(function (w) { return !w.done; }); }

  function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

  function candidates(s, g) {
    var Core = window.PriTestEnnichiCore, out = [], have = {}, k;
    for (k in s.structs) have[s.structs[k].type] = 1;
    var lv = Core.popLevel(s);
    for (var t in D.BUILD) {
      var b = D.BUILD[t];
      if ((b.kind === "ride" || b.kind === "stall") && b.lv <= lv && !have[t]) out.push({ kind: "build", target: t, n: 0, text: fill(T.build, { name: b.name }) });
    }
    ["takoyaki", "ringoame", "wataame", "ramune"].forEach(function (id) {
      out.push({ kind: "sell", target: id, n: D.WISH.SELL_N, text: fill(T.sell, { name: D.ITEMS[id].name, n: D.WISH.SELL_N }) });
    });
    for (k in s.structs) {
      var st = s.structs[k], bb = D.BUILD[st.type];
      if (bb.slots && st.build === 0) for (var sl in bb.slots) if (!st.mods[sl]) out.push({ kind: "upgrade", target: { sid: st.id, slot: sl }, n: 0, text: fill(T.upgrade, { name: bb.name, mod: D.ITEMS[bb.slots[sl].mod].name }) });
      if (bb.kind === "ride" && st.lastWait > 15) out.push({ kind: "queue", target: st.id, n: 0, text: fill(T.queue, { name: bb.name }) });
    }
    var wet = s.today && D.WEATHER[s.today.weather] && D.WEATHER[s.today.weather].wet;
    if (wet && !have.shelter) out.push({ kind: "shelter", target: "shelter", n: 0, text: fill(T.shelter, {}) });
    var act = active(s);
    return out.filter(function (c) { return !act.some(function (w) { return w.kind === c.kind && same(w.target, c.target); }); });
  }

  function maybeMake(s, g, force) {
    var Core = window.PriTestEnnichiCore;
    if (active(s).length >= D.WISH.MAX) return null;
    if (!force && Core.rnd(s) >= D.WISH.CHANCE) return null;
    var cs = candidates(s, g);
    if (!cs.length) return null;
    var c = cs[Core.rint(s, cs.length)];
    var w = { id: s.nextWish++, kind: c.kind, target: c.target, n: c.n, prog: 0, day: s.day, gid: g ? g.id : 0, photo: g ? g.photo : null, text: c.text, done: false };
    s.wishes.push(w);
    return w;
  }

  function progressSale(s, item) {
    active(s).forEach(function (w) { if (w.kind === "sell" && w.target === item) w.prog++; });
  }

  function met(s, w) {
    var k;
    if (w.kind === "build" || w.kind === "shelter") {
      for (k in s.structs) if (s.structs[k].type === w.target && s.structs[k].build === 0) return true;
      return false;
    }
    if (w.kind === "upgrade") { var st = s.structs[w.target.sid]; return !!(st && st.mods[w.target.slot]); }
    if (w.kind === "sell") return w.prog >= w.n;
    if (w.kind === "queue") { var q = s.structs[w.target]; return !!(q && s.day > w.day && q.lastWait <= D.WISH.QUEUE_OK); }
    return false;
  }

  // 只保留未完成的與最近 5 個完成的（維持原本順序）
  function trim(s) {
    var doneIds = s.wishes.filter(function (w) { return w.done; }).slice(-5).map(function (w) { return w.id; });
    s.wishes = s.wishes.filter(function (w) { return !w.done || doneIds.indexOf(w.id) >= 0; });
  }

  function check(s) {
    var Murmur = window.PriTestEnnichiMurmur;
    active(s).forEach(function (w) {
      if (!met(s, w)) return;
      w.done = true;
      s.rep += D.WISH.REWARD[w.kind];
      if (s.today) s.today.wishesDone++;
      var g = null;
      for (var i = 0; i < s.guests.length; i++) if (s.guests[i].id === w.gid) g = s.guests[i];
      if (Murmur) Murmur.say(s, g || { id: w.gid, photo: w.photo }, "recommend", "wish", {});
    });
    trim(s);
  }

  function expire(s) {
    var keep = [];
    s.wishes.forEach(function (w) {
      if (!w.done && s.day - w.day >= D.WISH.EXPIRE) s.rep = Math.max(0, s.rep - D.WISH.PENALTY);
      else keep.push(w);
    });
    s.wishes = keep;
    trim(s);
  }

  window.PriTestEnnichiWish = { TEMPLATES: T, active: active, candidates: candidates, maybeMake: maybeMake, progressSale: progressSale, check: check, expire: expire };
})();
