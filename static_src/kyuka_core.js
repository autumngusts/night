// 九華（kyuka）：規則核心。抽選（稀有度、9V）、花瓣解鎖、型判定、升級成長、標籤。
// 不碰 DOM、不讀寫 localStorage；畫面（kyuka.js）只呼叫這裡。將來移植到 RMD 時，只要照這個檔案改寫成 Go／TypeScript。
// 規則依據 docs/kyuka_design.md。瀏覽器掛在 window.PriTestKyukaCore；Node 測試（tools/kyuka_check/）用 require 載入。
(function () {
  "use strict";

  var root = typeof window !== "undefined" ? window : globalThis;
  var D = root.PriTestKyukaData || (typeof require === "function" ? require("./kyuka_data.js") : null);

  // ---------------- 亂數 ----------------
  function makeRng(seed) {
    var a = (seed == null ? Math.floor(Math.random() * 4294967296) : seed) >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  // FNV-1a：把標籤名稱等字串變成數字，與個體的種子組合
  function hashStr(s) {
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h >>> 0;
  }
  function randInt(rng, lo, hi) { return lo + Math.floor(rng() * (hi - lo + 1)); }

  // ---------------- 抽選（§3、§4） ----------------
  function rollRarity(rng, minRarity) {
    var start = minRarity ? D.RARITIES.indexOf(minRarity) : 0;
    var pool = D.RARITIES.slice(start), total = 0;
    pool.forEach(function (r) { total += D.RARITY[r].rate; });
    var x = rng() * total;
    for (var i = 0; i < pool.length; i++) {
      x -= D.RARITY[pool[i]].rate;
      if (x < 0) return pool[i];
    }
    return pool[pool.length - 1];
  }
  function heroesOf(rarity) { return D.HEROES.filter(function (h) { return h.rarity === rarity; }); }

  function groupSums(v) { return D.GROUPS.map(function (g) { return g.keys.reduce(function (a, k) { return a + v[k]; }, 0); }); }

  // 解鎖順序：招募當下三華合計由高到低（同分依魅→身→心）。之後成長也不改變順序。
  function revealOrder(v) {
    var sums = groupSums(v);
    return [0, 1, 2].sort(function (a, b) { return sums[b] - sums[a] || a - b; });
  }

  // 依角色本體產生一個個體
  function makeInstance(hero, rng, seq) {
    var r = D.RARITY[hero.rarity], v = {};
    D.ORDER.forEach(function (k) { v[k] = randInt(rng, r.floor, D.MAX_V); });
    var v0 = {};
    D.ORDER.forEach(function (k) { v0[k] = v[k]; });
    return {
      uid: (seq != null ? seq : Math.floor(rng() * 1e9)).toString(36) + "-" + Math.floor(rng() * 1e6).toString(36),
      heroId: hero.id, rarity: hero.rarity, seed: Math.floor(rng() * 4294967296) >>> 0,
      v: v, v0: v0, level: 1, affection: 0, order: revealOrder(v)
    };
  }

  // 單抽：先決定稀有度，再從該稀有度的角色中隨機一人
  function pull(rng, minRarity, seq) {
    var rarity = rollRarity(rng, minRarity), list = heroesOf(rarity);
    return makeInstance(list[Math.floor(rng() * list.length)], rng, seq);
  }
  // 十連：第 10 抽保底 SR 以上（暫定）
  function pull10(rng, seqStart) {
    var out = [];
    for (var i = 0; i < 10; i++) {
      var hasSR = out.some(function (x) { return D.RARITIES.indexOf(x.rarity) >= 2; });
      out.push(pull(rng, i === 9 && !hasSR ? "SR" : null, seqStart != null ? seqStart + i : null));
    }
    return out;
  }

  // ---------------- 解鎖（§4） ----------------
  function visibleCount(inst) {
    var n = D.RARITY[inst.rarity].visible;
    D.UNLOCK_AT.forEach(function (t) { if (inst.affection >= t) n++; });
    return Math.min(3, n);
  }
  // 回傳目前可見的三華索引
  function visibleGroups(inst) { return inst.order.slice(0, visibleCount(inst)); }
  function isVisible(inst, key) { return visibleGroups(inst).indexOf(D.GROUP_OF[key]) >= 0; }
  // 下一個解鎖門檻（已全部可見則為 null）
  function nextUnlock(inst) {
    if (visibleCount(inst) >= 3) return null;
    for (var i = 0; i < D.UNLOCK_AT.length; i++) if (inst.affection < D.UNLOCK_AT[i]) return D.UNLOCK_AT[i];
    return null;
  }
  function setAffection(inst, value) {
    var before = visibleCount(inst);
    inst.affection = Math.max(0, Math.min(100, Math.round(value)));
    var after = visibleCount(inst);
    return after > before ? inst.order.slice(before, after) : [];   // 新解鎖的三華
  }

  // ---------------- 型（§6） ----------------
  function type81(v) {
    var o = D.ORDER.map(function (k, i) { return { k: k, v: v[k], i: i }; })
      .sort(function (a, b) { return b.v - a.v || a.i - b.i; });
    var main = o[0].k, gap = o[0].v - o[1].v;
    var sub = gap >= D.PURE_GAP ? main : o[1].k;
    return { main: main, sub: sub, pure: main === sub, gap: gap, name: D.TYPE81[main][D.ORDER.indexOf(sub)] };
  }

  function grade(x) {
    for (var i = 0; i < D.GRADES.length; i++) if (x >= D.GRADES[i].min) return D.GRADES[i].g;
    return "D";
  }

  // ---------------- 升級（§5） ----------------
  // 每升一級，九項各自以稀有度的成長率 +1（上限 99）。回傳這一級成長的項目。
  function levelUp(inst, rng) {
    if (inst.level >= D.MAX_LEVEL) return null;
    inst.level++;
    var p = D.RARITY[inst.rarity].growth, grew = [];
    D.ORDER.forEach(function (k) {
      if (inst.v[k] < D.MAX_V && rng() < p) { inst.v[k]++; grew.push(k); }
    });
    return grew;
  }

  // ---------------- 標籤（§9） ----------------
  // 以「個體種子＋標籤類別」決定，權重參考招募當下的 9V（v0），所以任何時候讀都一樣，也不受成長影響。
  function tag(inst, tagId) {
    var def = null;
    D.TAGS.forEach(function (t) { if (t.id === tagId) def = t; });
    if (!def) return null;
    var rng = makeRng((inst.seed ^ hashStr(tagId)) >>> 0), total = 0;
    var ws = def.values.map(function (x) { var w = x.w(inst.v0); total += w; return w; });
    var r = rng() * total;
    for (var i = 0; i < ws.length; i++) { r -= ws[i]; if (r < 0) return def.values[i].v; }
    return def.values[def.values.length - 1].v;
  }

  var api = {
    makeRng: makeRng, hashStr: hashStr, rollRarity: rollRarity, makeInstance: makeInstance, pull: pull, pull10: pull10,
    groupSums: groupSums, revealOrder: revealOrder, visibleCount: visibleCount, visibleGroups: visibleGroups,
    isVisible: isVisible, nextUnlock: nextUnlock, setAffection: setAffection, type81: type81, grade: grade,
    levelUp: levelUp, tag: tag
  };
  root.PriTestKyukaCore = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
