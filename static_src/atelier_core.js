// 煉金術士（atelier）：規則核心。不碰 DOM、不讀寫 localStorage；畫面（atelier.js）只呼叫這裡。
// 規則依據 docs/atelier_design.md。將來移植到 RMD 時照這個檔案改寫成 Go。
// 調和方式（棋盤等）由 atelier_method_*.js 用 registerMethod() 登記，核心只透過介面呼叫。
(function () {
  "use strict";
  var root = typeof window !== "undefined" ? window : globalThis;
  var D = root.PriTestAtelierData, COLORS = root.PriTestAtelierColors, HOSTS = root.PriTestAtelierHosts;
  var JST = 9 * 3600000;
  var methods = {};

  // ---------- 共用 ----------
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function hash(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h >>> 0;
  }
  // mulberry32；seed 可以是數字或字串（O11：所有亂數都可重現）
  function makeRng(seed) {
    var a = typeof seed === "number" ? seed >>> 0 : hash(String(seed));
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function jstHour(ms) { return new Date(ms + JST).getUTCHours(); }
  function inRange(h, from, to) { return from <= to ? (h >= from && h < to) : (h >= from || h < to); }

  // ---------- 色彩數學 ----------
  function hexToRgb(hex) {
    var n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgbToHex(rgb) {
    return "#" + rgb.map(function (c) { var s = Math.round(c).toString(16); return s.length < 2 ? "0" + s : s; }).join("").toUpperCase();
  }
  function rgbToHsv(rgb) {
    var r = rgb[0] / 255, g = rgb[1] / 255, b = rgb[2] / 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, h = 0;
    if (d > 0) {
      if (max === r) h = 60 * (((g - b) / d) % 6);
      else if (max === g) h = 60 * ((b - r) / d + 2);
      else h = 60 * ((r - g) / d + 4);
    }
    if (h < 0) h += 360;
    return { h: h, s: max === 0 ? 0 : d / max, v: max };
  }
  function rgbToLab(rgb) {
    function lin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
    var r = lin(rgb[0]), g = lin(rgb[1]), b = lin(rgb[2]);
    var x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
    var y = r * 0.2126 + g * 0.7152 + b * 0.0722;
    var z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
    function f(t) { return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116; }
    var fx = f(x), fy = f(y), fz = f(z);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  }
  function deltaE(a, b) { return Math.sqrt((a[0] - b[0]) * (a[0] - b[0]) + (a[1] - b[1]) * (a[1] - b[1]) + (a[2] - b[2]) * (a[2] - b[2])); }
  var colorLabs = null;
  function nearestColor(rgb) {
    if (!colorLabs) colorLabs = COLORS.map(function (c) { return rgbToLab(hexToRgb(c.hex)); });
    var lab = rgbToLab(rgb), best = 0, bestD = Infinity;
    for (var i = 0; i < COLORS.length; i++) {
      var d = deltaE(lab, colorLabs[i]);
      if (d < bestD) { bestD = d; best = i; }
    }
    return { color: COLORS[best], dist: bestD };
  }
  function elementOf(hsv) {
    if (hsv.s < D.ACHROMATIC_SAT) return "spirit";
    for (var i = 0; i < D.HUE_SECTORS.length; i++) {
      var s = D.HUE_SECTORS[i];
      if (inRange(hsv.h, s.from, s.to)) return s.el;
    }
    return "spirit";
  }
  function categoryOf(hsv, el) {
    if (hsv.v < D.SHADOW_VAL) return "shadow";
    if (hsv.v > D.CRYSTAL_VAL && hsv.s < D.CRYSTAL_SAT) return "crystal";
    return D.CATEGORY_BY_ELEMENT[el];
  }

  // ---------- 照片分析（O1 多色、C1 形狀） ----------
  // pixels：[[r,g,b], ...]；回傳 {centers, labels}
  function kmeans(pixels, k, seed) {
    var rng = makeRng("kmeans:" + seed), n = pixels.length, centers = [], labels = new Array(n), i, j;
    function d2(p, c) { var a = p[0] - c[0], b = p[1] - c[1], e = p[2] - c[2]; return a * a + b * b + e * e; }
    centers.push(pixels[Math.floor(rng() * n)].slice());
    while (centers.length < k) {           // k-means++
      var dist = pixels.map(function (p) { return Math.min.apply(null, centers.map(function (c) { return d2(p, c); })); });
      var sum = dist.reduce(function (a, b) { return a + b; }, 0);
      if (sum === 0) break;                // 顏色比 k 少
      var r = rng() * sum;
      for (i = 0; i < n; i++) { r -= dist[i]; if (r <= 0) break; }
      centers.push(pixels[Math.min(i, n - 1)].slice());
    }
    for (var it = 0; it < D.KMEANS_ITER; it++) {
      for (i = 0; i < n; i++) {
        var best = 0, bd = Infinity;
        for (j = 0; j < centers.length; j++) { var dd = d2(pixels[i], centers[j]); if (dd < bd) { bd = dd; best = j; } }
        labels[i] = best;
      }
      var acc = centers.map(function () { return [0, 0, 0, 0]; });
      for (i = 0; i < n; i++) { var a = acc[labels[i]]; a[0] += pixels[i][0]; a[1] += pixels[i][1]; a[2] += pixels[i][2]; a[3]++; }
      for (j = 0; j < centers.length; j++) if (acc[j][3]) centers[j] = [acc[j][0] / acc[j][3], acc[j][1] / acc[j][3], acc[j][2] / acc[j][3]];
    }
    return { centers: centers, labels: labels };
  }
  // 色塊在 8×8 格上的最大連通區，從最靠近重心的格子 BFS 取 n 格，正規化成 [[x,y]]
  function shapeFromGrid(grid, label, n) {
    var G = D.GRID, seen = {}, best = [], x, y;
    for (y = 0; y < G; y++) for (x = 0; x < G; x++) {
      var key = x + "," + y;
      if (grid[y * G + x] !== label || seen[key]) continue;
      var comp = [], q = [[x, y]]; seen[key] = true;
      while (q.length) {
        var c = q.shift(); comp.push(c);
        [[0, -1], [1, 0], [0, 1], [-1, 0]].forEach(function (d) {
          var nx = c[0] + d[0], ny = c[1] + d[1], k2 = nx + "," + ny;
          if (nx < 0 || ny < 0 || nx >= G || ny >= G || seen[k2] || grid[ny * G + nx] !== label) return;
          seen[k2] = true; q.push([nx, ny]);
        });
      }
      if (comp.length > best.length) best = comp;
    }
    if (!best.length) return [[0, 0]];
    var cx = 0, cy = 0;
    best.forEach(function (c) { cx += c[0]; cy += c[1]; });
    cx /= best.length; cy /= best.length;
    var start = best.slice().sort(function (a, b) {
      var da = (a[0] - cx) * (a[0] - cx) + (a[1] - cy) * (a[1] - cy), db = (b[0] - cx) * (b[0] - cx) + (b[1] - cy) * (b[1] - cy);
      return da - db || a[1] - b[1] || a[0] - b[0];
    })[0];
    var inComp = {}; best.forEach(function (c) { inComp[c[0] + "," + c[1]] = true; });
    var out = [], taken = {}, q2 = [start]; taken[start[0] + "," + start[1]] = true;
    while (q2.length && out.length < n) {
      var p = q2.shift(); out.push(p);
      [[0, -1], [1, 0], [0, 1], [-1, 0]].forEach(function (d) {
        var k3 = (p[0] + d[0]) + "," + (p[1] + d[1]);
        if (inComp[k3] && !taken[k3]) { taken[k3] = true; q2.push([p[0] + d[0], p[1] + d[1]]); }
      });
    }
    return normalizeShape(out);
  }
  function normalizeShape(cells) {
    var mx = Math.min.apply(null, cells.map(function (c) { return c[0]; }));
    var my = Math.min.apply(null, cells.map(function (c) { return c[1]; }));
    return cells.map(function (c) { return [c[0] - mx, c[1] - my]; })
      .sort(function (a, b) { return a[1] - b[1] || a[0] - b[0]; });
  }
  function rotateShape(cells, times) {
    var out = cells;
    for (var i = 0; i < ((times % 4) + 4) % 4; i++) out = normalizeShape(out.map(function (c) { return [-c[1], c[0]]; }));
    return out;
  }
  // rgba：RGBA 陣列（長度 w*h*4，w＝h＝SRC_SIZE）。回傳色塊 [{rgb, hex, frac, shape}]，面積大到小
  function analyze(rgba, w, h, seed) {
    var pixels = [], i;
    for (i = 0; i < w * h; i++) pixels.push([rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]]);
    var km = kmeans(pixels, D.K, seed), G = D.GRID, cw = w / G, ch = h / G, grid = [];
    for (var gy = 0; gy < G; gy++) for (var gx = 0; gx < G; gx++) {
      var votes = {};
      for (var y = Math.floor(gy * ch); y < Math.floor((gy + 1) * ch); y++)
        for (var x = Math.floor(gx * cw); x < Math.floor((gx + 1) * cw); x++) {
          var l = km.labels[y * w + x]; votes[l] = (votes[l] || 0) + 1;
        }
      var bl = -1, bv = -1;
      Object.keys(votes).forEach(function (k) { if (votes[k] > bv || (votes[k] === bv && +k < bl)) { bv = votes[k]; bl = +k; } });
      grid.push(bl);
    }
    var counts = km.centers.map(function () { return 0; });
    km.labels.forEach(function (l) { counts[l]++; });
    var out = [];
    km.centers.forEach(function (c, j) {
      var frac = counts[j] / pixels.length;
      if (frac < D.MIN_FRAC) return;
      var n = clamp(Math.round(1 + frac * D.SHAPE_SCALE), D.SHAPE_MIN, D.SHAPE_MAX);
      var rgb = c.map(Math.round);
      out.push({ rgb: rgb, hex: rgbToHex(rgb), frac: frac, shape: shapeFromGrid(grid, j, n) });
    });
    return out.sort(function (a, b) { return b.frac - a.frac; });
  }

  // ---------- 素材（O4、O6、C2） ----------
  function timeTraits(now) {
    var h = jstHour(now);
    return D.TIME_TRAITS.filter(function (t) { return inRange(h, t.from, t.to); }).map(function (t) { return t.trait; });
  }
  function makeMaterial(swatch, now, uid) {
    var hsv = rgbToHsv(swatch.rgb), el = elementOf(hsv), near = nearestColor(swatch.rgb);
    var purity = 1 - Math.min(near.dist, D.PURITY_RANGE) / D.PURITY_RANGE;
    var quality = clamp(Math.round(15 + 45 * hsv.s + 40 * purity), 1, 100);
    var traits = timeTraits(now);
    if (D.RARITY_TRAIT[near.color.rarity]) traits.push(D.RARITY_TRAIT[near.color.rarity]);
    if (quality >= D.VIVID_QUALITY) traits.push("vivid");
    return {
      uid: uid, hex: swatch.hex, rgb: swatch.rgb, colorId: near.color.id, element: el,
      category: categoryOf(hsv, el), power: 1 + Math.min(3, Math.floor(hsv.s * 4)),
      quality: quality, traits: traits, shape: swatch.shape, at: now
    };
  }

  // ---------- 存檔、採集籃（O5）、冷卻（C11） ----------
  function newSave(now) {
    return { v: 1, nextUid: 1, mats: [], items: [], basket: { n: D.BASKET_MAX, at: now }, cooldownUntil: 0,
      exp: 0, host: "ruri", hosts: { ruri: { aff: 0, task: 0 } }, best: {}, tutorial: 0, seen: {}, log: [] };
  }
  function refillBasket(save, now) {
    var b = save.basket;
    if (b.n >= D.BASKET_MAX) { b.at = now; return b.n; }
    var gained = Math.floor((now - b.at) / D.BASKET_REFILL_MS);
    if (gained > 0) {
      b.n = Math.min(D.BASKET_MAX, b.n + gained);
      b.at = b.n >= D.BASKET_MAX ? now : b.at + gained * D.BASKET_REFILL_MS;
    }
    return b.n;
  }
  // 選 1～PICK_MAX 個色塊，消耗 1 籃 → 回傳新增的素材；失敗回傳 null
  function capture(save, swatches, now) {
    refillBasket(save, now);
    if (!swatches.length || swatches.length > D.PICK_MAX || save.basket.n <= 0) return null;
    if (save.mats.length + swatches.length > D.MAT_MAX) return null;
    if (save.basket.n >= D.BASKET_MAX) save.basket.at = now;
    save.basket.n--;
    var added = swatches.map(function (s) { var m = makeMaterial(s, now, save.nextUid++); save.mats.push(m); save.seen[m.colorId] = true; return m; });
    return added;
  }
  function level(save) { return Math.min(D.LV_MAX, 1 + Math.floor(save.exp / D.EXP_PER_LV)); }
  function traitCap(save) { return D.TRAIT_CAP_BASE + D.TRAIT_CAP_PER_LV * level(save); }
  function canSynth(save, now) { return now >= save.cooldownUntil; }
  function recipe(id) { for (var i = 0; i < D.RECIPES.length; i++) if (D.RECIPES[i].id === id) return D.RECIPES[i]; return null; }
  function recipesFor(save) { var lv = level(save); return D.RECIPES.filter(function (r) { return r.lv <= lv; }); }
  function slotOk(need, mat) { return need === "*" || need === mat.category; }

  // ---------- 調和 ----------
  function registerMethod(id, impl) { methods[id] = impl; }
  function host(save) { return HOSTS[save.host]; }
  // matUids 依配方 needs 的順序；檢查失敗回傳 {error}
  function startSynthesis(save, recipeId, matUids, cauldronId, now) {
    var r = recipe(recipeId);
    if (!r || r.lv > level(save)) return { error: "recipe" };
    if (!canSynth(save, now)) return { error: "cooldown" };
    if (matUids.length !== r.needs.length) return { error: "count" };
    var mats = [];
    for (var i = 0; i < matUids.length; i++) {
      var m = null;
      for (var j = 0; j < save.mats.length; j++) if (save.mats[j].uid === matUids[i]) m = save.mats[j];
      if (!m || mats.indexOf(m) >= 0 || !slotOk(r.needs[i], m)) return { error: "slot", slot: i };
      mats.push(m);
    }
    var h = host(save);
    return methods[h.method].create(r, mats, D.CAULDRONS[cauldronId], h.ability);
  }
  function effectLevels(r, gauges) {
    return r.gauges.map(function (g) {
      var lv = 0;
      g.steps.forEach(function (s, i) { if ((gauges[g.el] || 0) >= s.at) lv = i + 1; });
      return { el: g.el, level: lv, step: lv ? g.steps[lv - 1] : null, next: g.steps[lv] ? g.steps[lv].at : null };
    });
  }
  // 可選的特性：還看得到（沒被完全覆蓋）的素材帶有的特性，去重
  function traitChoices(session) {
    var ev = methods[session.method].evaluate(session, true), out = [];
    session.mats.forEach(function (m, i) {
      if (!ev.visible[i]) return;
      m.traits.forEach(function (t) { if (out.indexOf(t) < 0) out.push(t); });
    });
    return out;
  }
  function traitsValid(save, session, traitIds) {
    if (traitIds.length > D.MAX_TRAITS) return false;
    var choices = traitChoices(session), cost = 0;
    for (var i = 0; i < traitIds.length; i++) {
      if (choices.indexOf(traitIds[i]) < 0 || traitIds.indexOf(traitIds[i]) !== i) return false;
      cost += D.TRAITS[traitIds[i]].cost;
    }
    return cost <= traitCap(save);
  }
  // 完成調和：扣素材、加成品、經驗、冷卻、好感度；回傳 item 或 {error}
  function finishSynthesis(save, session, traitIds, now) {
    var impl = methods[session.method];
    if (!impl.done(session)) return { error: "unplaced" };
    if (!traitsValid(save, session, traitIds)) return { error: "traits" };
    var ev = impl.evaluate(session, true), q = ev.quality, boost = 0;
    traitIds.forEach(function (t) { q += D.TRAITS[t].quality || 0; boost += D.TRAITS[t].boost || 0; });
    var effects = effectLevels(session.recipe, ev.gauges).map(function (e) {
      return { el: e.el, level: e.level, kind: e.step ? e.step.kind : null, n: e.step ? Math.round(e.step.n * (1 + boost / 100)) : 0 };
    });
    var item = { uid: save.nextUid++, recipe: session.recipe.id, quality: clamp(Math.round(q), 1, 100),
      effects: effects, traits: traitIds.slice(), gauges: ev.gauges, at: now };
    var used = session.mats.map(function (m) { return m.uid; });
    save.mats = save.mats.filter(function (m) { return used.indexOf(m.uid) < 0; });
    save.items.push(item);
    save.exp += D.EXP_PER_SYNTH;
    save.cooldownUntil = now + D.COOLDOWN_MS;
    save.hosts[save.host].aff = Math.min(100, save.hosts[save.host].aff + D.AFF_PER_SYNTH);
    if (!save.best[item.recipe] || item.quality > save.best[item.recipe]) save.best[item.recipe] = item.quality;
    if (save.tutorial < 3) save.tutorial++;
    return item;
  }

  // ---------- 工房主人的任務與反應 ----------
  function currentTask(save) { var h = host(save); return h.tasks[save.hosts[save.host].task] || null; }
  function taskMet(task, item) {
    if (!task || item.recipe !== task.recipe || item.quality < task.minQuality) return false;
    return !task.minLevel || item.effects.some(function (e) { return e.level >= task.minLevel; });
  }
  function deliver(save, itemUid) {
    var task = currentTask(save), item = null;
    save.items.forEach(function (it) { if (it.uid === itemUid) item = it; });
    if (!item || !taskMet(task, item)) return false;
    save.items = save.items.filter(function (it) { return it !== item; });
    var hs = save.hosts[save.host];
    hs.task++; hs.aff = Math.min(100, hs.aff + D.AFF_PER_TASK); save.exp += task.exp;
    return true;
  }
  // 依放置前後的評估與這一手的資訊，回傳工房主人台詞的鍵（A3）
  function react(save, before, after, info) {
    var r = info.recipe;
    var lvB = effectLevels(r, before.gauges), lvA = effectLevels(r, after.gauges);
    for (var i = 0; i < lvA.length; i++) if (lvA[i].level > lvB[i].level) return "levelup";
    if (info.bonusCells > 0) return "bonus";
    if (info.matchCells * 2 >= info.cells) return "match";
    if (info.overwritten > 0) return "overwrite";
    if (info.matchCells === 0) return save.hosts[save.host].aff >= D.AFF_HINT ? "hint" : "miss";
    return "ok";
  }

  var api = {
    clamp: clamp, hash: hash, makeRng: makeRng, jstHour: jstHour,
    hexToRgb: hexToRgb, rgbToHex: rgbToHex, rgbToHsv: rgbToHsv, rgbToLab: rgbToLab, deltaE: deltaE,
    nearestColor: nearestColor, elementOf: elementOf, categoryOf: categoryOf,
    kmeans: kmeans, shapeFromGrid: shapeFromGrid, normalizeShape: normalizeShape, rotateShape: rotateShape, analyze: analyze,
    timeTraits: timeTraits, makeMaterial: makeMaterial,
    newSave: newSave, refillBasket: refillBasket, capture: capture, level: level, traitCap: traitCap,
    canSynth: canSynth, recipe: recipe, recipesFor: recipesFor, slotOk: slotOk,
    registerMethod: registerMethod, method: function (id) { return methods[id]; }, host: host,
    startSynthesis: startSynthesis, effectLevels: effectLevels, traitChoices: traitChoices, traitsValid: traitsValid,
    finishSynthesis: finishSynthesis, currentTask: currentTask, taskMet: taskMet, deliver: deliver, react: react
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else window.PriTestAtelierCore = api;
})();
