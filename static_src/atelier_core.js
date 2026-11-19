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
  function jstDate(ms) { return new Date(ms + JST).toISOString().slice(0, 10); }
  function dayDiff(d1, d2) { return Math.round((Date.parse(d2) - Date.parse(d1)) / 86400000); }

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
  // opts（第 4 階段）：{ k, minFrac }（B3 放大鏡）
  function analyze(rgba, w, h, seed, opts) {
    opts = opts || {};
    var pixels = [], i, minFrac = opts.minFrac || D.MIN_FRAC;
    for (i = 0; i < w * h; i++) pixels.push([rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]]);
    var km = kmeans(pixels, opts.k || D.K, seed), G = D.GRID, cw = w / G, ch = h / G, grid = [];
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
      if (frac < minFrac) return;
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
  // opts（第 2 階段）：{ streakBonus: C9 連續採色的品質加值, wb: O2 白平衡有效, daily: O3 拍到今日之色 }
  function makeMaterial(swatch, now, uid, opts) {
    opts = opts || {};
    var hsv = rgbToHsv(swatch.rgb), el = elementOf(hsv), near = nearestColor(swatch.rgb);
    var purity = 1 - Math.min(near.dist, D.PURITY_RANGE) / D.PURITY_RANGE;
    var quality = clamp(Math.round(15 + 45 * hsv.s + 40 * purity), 1, 100);
    if (opts.streakBonus) quality = clamp(quality + opts.streakBonus, 1, 100);
    if (opts.wb) quality = clamp(Math.round(quality * D.WB_QUALITY_MULT), 1, 100);
    var traits = timeTraits(now);
    if (opts.daily) traits.push("daily_hue");
    if (opts.harmony) traits.push("harmony");                               // §10.1 B1
    if (isSeasonColor(near.color.id, now)) traits.push("season");          // §10.7 B12
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
    return migrate({ v: 1, nextUid: 1, mats: [], items: [], basket: { n: D.BASKET_MAX, at: now }, cooldownUntil: 0,
      exp: 0, host: "ruri", hosts: { ruri: { aff: 0, task: 0 } }, best: {}, tutorial: 0, seen: {}, log: [] });
  }
  // 第 1 階段的存檔補上第 2 階段的欄位（原有資料不動）
  function migrate(save) {
    var def = { ideas: {}, made: {}, ash: 0, cauldrons: { copper: 1 }, shelf: 0, streak: { n: 0, date: "" },
      daily: { date: "" }, wb: null, best: {}, seen: {}, log: [], tutorial: 0,
      settings: { advanced: true }, catalysts: { expand: 0, tint: 0, double: 0 },
      weekly: { key: "", best: 0, plays: 0 },
      coins: 0, coinsEarned: 0, tools: {}, coloring: {}, pagesDone: {}, deco: [null, null, null], visitDate: "",
      titles: {}, title: "", greatCount: 0 };
    Object.keys(def).forEach(function (k) { if (save[k] === undefined) save[k] = def[k]; });
    if (!save.cauldrons.copper) save.cauldrons.copper = 1;
    Object.keys(HOSTS || {}).forEach(function (id) {                         // §11 第 5 階段
      if (!save.hosts[id]) save.hosts[id] = { aff: 0, task: 0, tut: 0 };
      if (save.hosts[id].tut === undefined) save.hosts[id].tut = 0;
    });
    if (!HOSTS || !HOSTS[save.host]) save.host = "ruri";
    return save;
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
  // C9 連續採色：同一天不變、隔天 +1、中斷時減半再加今天
  function updateStreak(save, now) {
    var today = jstDate(now), st = save.streak;
    if (st.date === today) return st.n;
    st.n = !st.date ? 1 : dayDiff(st.date, today) === 1 ? st.n + 1 : Math.floor(st.n / 2) + 1;
    st.date = today;
    return st.n;
  }
  function streakBonus(n) { return Math.min(D.STREAK_CAP, Math.max(0, n - 1) * D.STREAK_STEP); }
  // 選 1～PICK_MAX 個色塊，消耗 1 籃。回傳 {mats, newColors, daily, streak, exp} 或 {error: "pick"|"basket"|"full"}
  // extra（第 4 階段）：{ harmony: 這張照片有配色, rainbow: 這張照片是虹（多給 1 個虹之欠片） }
  function captureEx(save, swatches, now, extra) {
    extra = extra || {};
    refillBasket(save, now);
    if (!swatches.length || swatches.length > D.PICK_MAX) return { error: "pick" };
    if (save.basket.n <= 0) return { error: "basket" };
    if (save.mats.length + swatches.length > matMax(save)) return { error: "full" };
    if (save.basket.n >= D.BASKET_MAX) save.basket.at = now;
    save.basket.n--;
    var n = updateStreak(save, now), wb = wbActive(save, now), today = jstDate(now);
    var res = { mats: [], newColors: [], daily: false, streak: n, exp: 0 };
    swatches.forEach(function (s) {
      var hit = isDailyHit(s.rgb, now);
      var m = makeMaterial(s, now, save.nextUid++, { wb: wb, streakBonus: streakBonus(n) + (host(save).ability.captureQuality || 0),
        daily: hit, harmony: !!extra.harmony });
      save.mats.push(m);
      if (!save.seen[m.colorId]) { save.seen[m.colorId] = true; res.newColors.push(m.colorId); res.exp += D.DEX_EXP; }
      if (hit && save.daily.date !== today) { save.daily = { date: today }; res.daily = true; res.exp += D.DAILY_EXP; }
      res.mats.push(m);
    });
    if (extra.rainbow && save.mats.length < matMax(save)) {                // §10.2 B2 虹之欠片
      var R = D.RAINBOW_MAT;
      res.rainbow = { uid: save.nextUid++, hex: R.hex, rgb: hexToRgb(R.hex), colorId: null, rainbow: true, element: "spirit",
        category: "essence", power: R.power, quality: R.quality, traits: ["rainbow"], shape: [[0, 0]], at: now };
      save.mats.push(res.rainbow);
    }
    res.harmony = extra.harmony || null;
    save.exp += res.exp;
    return res;
  }
  // 第 1 階段的介面：成功回傳新增的素材，失敗回傳 null
  function capture(save, swatches, now) { var r = captureEx(save, swatches, now); return r.error ? null : r.mats; }

  // ---------- O3 每日色彩、O2 白平衡、C2 圖鑑 ----------
  function dailyColor(now) {
    var pool = COLORS.filter(function (c) { return c.rarity < 3; });
    return pool[hash("daily:" + jstDate(now)) % pool.length];
  }
  function isDailyHit(rgb, now) {
    var d = dailyColor(now);
    return nearestColor(rgb).color.id === d.id || deltaE(rgbToLab(rgb), rgbToLab(hexToRgb(d.hex))) <= D.DAILY_TOLERANCE;
  }
  // 拍白紙：取中央一半的平均色，算出讓三個通道一樣亮的增益
  function whiteBalanceGains(rgba, w, h) {
    var sum = [0, 0, 0], n = 0;
    for (var y = Math.floor(h / 4); y < Math.ceil(h * 3 / 4); y++) for (var x = Math.floor(w / 4); x < Math.ceil(w * 3 / 4); x++) {
      var i = (y * w + x) * 4; sum[0] += rgba[i]; sum[1] += rgba[i + 1]; sum[2] += rgba[i + 2]; n++;
    }
    var avg = sum.map(function (v) { return Math.max(1, v / n); }), top = Math.max(avg[0], avg[1], avg[2]);
    return avg.map(function (a) { return clamp(top / a, D.WB_GAIN_MIN, D.WB_GAIN_MAX); });
  }
  function applyGains(rgba, gains) {
    var out = new Uint8ClampedArray(rgba.length);
    for (var i = 0; i < rgba.length; i += 4) {
      out[i] = rgba[i] * gains[0]; out[i + 1] = rgba[i + 1] * gains[1]; out[i + 2] = rgba[i + 2] * gains[2]; out[i + 3] = rgba[i + 3];
    }
    return out;
  }
  function setWhiteBalance(save, gains, now) { save.wb = { gains: gains, until: now + D.WB_VALID_MS }; }
  function wbActive(save, now) { return !!(save.wb && now < save.wb.until); }
  function dexGroup(color) {
    var hsv = rgbToHsv(hexToRgb(color.hex)), h = hsv.h;
    if (hsv.s < 0.12 || (hsv.s < 0.25 && hsv.v < 0.3)) return "mono";
    if ((h < 50 || h >= 345) && hsv.v < 0.6 && hsv.s > 0.3) return "brown";
    if (h >= 330 || h < 15) return "red";
    if (h < 45) return "orange";
    if (h < 70) return "yellow";
    if (h < 170) return "green";
    if (h < 250) return "blue";
    return "purple";
  }
  function dexGroups() {
    return D.DEX_GROUPS.map(function (g) { return { id: g, colors: COLORS.filter(function (c) { return dexGroup(c) === g; }) }; });
  }
  function dexProgress(save) {
    return { seen: COLORS.filter(function (c) { return save.seen[c.id]; }).length, total: COLORS.length };
  }

  // ---------- C3 配方發想 ----------
  function seenElCount(save, el) {
    return COLORS.filter(function (c) { return save.seen[c.id] && elementOf(rgbToHsv(hexToRgb(c.hex))) === el; }).length;
  }
  function ideaMet(save, idea) {
    if (idea.seen) return !!save.seen[idea.seen];
    if (idea.seenCount) return dexProgress(save).seen >= idea.seenCount;
    if (idea.seenEl) return seenElCount(save, idea.seenEl.el) >= idea.seenEl.n;
    if (idea.made) return (save.made[idea.made] || 0) > 0;
    if (idea.quality) return (save.best[idea.quality.recipe] || 0) >= idea.quality.n;
    return false;
  }
  function recipeKnown(save, r) { return !r.idea || !!save.ideas[r.id]; }
  // now（第 4 階段）：季節限定配方只在當季可用；沒有傳 now 時一律不可用
  function recipeAvailable(save, r, now) {
    if (r.season && (now === undefined || seasonOf(now) !== r.season)) return false;
    return r.lv <= level(save) && recipeKnown(save, r);
  }
  // 檢查所有還沒發想的配方，回傳這次新想到的配方 id
  function checkIdeas(save) {
    var out = [];
    D.RECIPES.forEach(function (r) {
      if (r.idea && !save.ideas[r.id] && ideaMet(save, r.idea)) { save.ideas[r.id] = true; out.push(r.id); }
    });
    return out;
  }

  // ---------- C5 錬金釜、B6 升級、C10 灰燼 ----------
  function cauldronLv(save, id) { return save.cauldrons[id] || 0; }
  function canUnlockCauldron(save, id) {
    var c = D.CAULDRONS[id];
    return !!c && !cauldronLv(save, id) && !!c.unlock && level(save) >= c.unlock.lv && save.ash >= c.unlock.ash;
  }
  function unlockCauldron(save, id) {
    if (!canUnlockCauldron(save, id)) return false;
    save.ash -= D.CAULDRONS[id].unlock.ash; save.cauldrons[id] = 1;
    return true;
  }
  function upgradeCost(save, id) {
    var lv = cauldronLv(save, id);
    return lv && lv < D.CAULDRON_LV_MAX ? D.CAULDRON_UPGRADE_ASH[lv - 1] : null;
  }
  function upgradeCauldron(save, id) {
    var cost = upgradeCost(save, id);
    if (cost === null || save.ash < cost) return false;
    save.ash -= cost; save.cauldrons[id]++;
    return true;
  }
  // 調和實際使用的釜：品質上升率加上升級；擅長的配方量表 ×affinityMult
  function effectiveCauldron(save, id) {
    var c = D.CAULDRONS[id], lv = cauldronLv(save, id);
    if (!c || !lv) return null;
    return { id: id, lv: lv, name: c.name, pattern: c.pattern, affinity: c.affinity, affinityMult: D.AFFINITY_MULT,
      qualityPerCell: Math.round((c.qualityPerCell + (lv - 1) * D.CAULDRON_LV_QUALITY) * 100) / 100 };
  }
  function matMax(save) { return D.MAT_MAX + (save.shelf || 0) * D.SHELF_STEP; }
  function shelfCost(save) { var c = D.SHELF_ASH[save.shelf]; return c === undefined ? null : c; }
  function upgradeShelf(save) {
    var cost = shelfCost(save);
    if (cost === null || save.ash < cost) return false;
    save.ash -= cost; save.shelf++;
    return true;
  }

  // ---------- O9 成品再投入、B9 素材升華 ----------
  function itemAsMaterial(item) {
    var r = recipe(item.recipe), best = null, maxLv = 0, sumLv = 0, e = null;
    Object.keys(item.gauges).forEach(function (k) { if (best === null || item.gauges[k] > item.gauges[best]) best = k; });
    item.effects.forEach(function (x) { sumLv += x.level; maxLv = Math.max(maxLv, x.level); });
    D.ELEMENTS.forEach(function (x) { if (x.id === best) e = x; });
    return { uid: item.uid, hex: e.color, rgb: hexToRgb(e.color), colorId: null, element: best, category: r.cat,
      power: Math.min(4, 2 + maxLv), quality: item.quality, traits: item.traits.slice(),
      shape: D.ITEM_SHAPES[clamp(2 + sumLv, 3, 6)], at: item.at, fromItem: item.recipe };
  }
  function findMat(save, uid) {
    var i;
    for (i = 0; i < save.mats.length; i++) if (save.mats[i].uid === uid) return save.mats[i];
    for (i = 0; i < save.items.length; i++) if (save.items[i].uid === uid && !displayed(save, uid)) return itemAsMaterial(save.items[i]);
    return null;
  }
  // 同屬性的素材 3 個 → 1 個：顏色取品質最高者、形狀取最大者、特性合併（最多 MAX_TRAITS）
  function sublimate(save, uids, now) {
    if (uids.length !== D.SUBLIMATE_N) return { error: "count" };
    var ms = uids.map(function (u) { return save.mats.filter(function (m) { return m.uid === u; })[0]; });
    if (ms.some(function (m) { return !m; }) || uids.some(function (u, i) { return uids.indexOf(u) !== i; })) return { error: "missing" };
    if (ms.some(function (m) { return m.element !== ms[0].element; })) return { error: "element" };
    var base = ms.slice().sort(function (a, b) { return b.quality - a.quality; })[0];
    var big = ms.slice().sort(function (a, b) { return b.shape.length - a.shape.length; })[0];
    var traits = [];
    ms.forEach(function (m) { m.traits.forEach(function (t) { if (traits.indexOf(t) < 0) traits.push(t); }); });
    var out = { uid: save.nextUid++, hex: base.hex, rgb: base.rgb, colorId: base.colorId, element: base.element, category: base.category,
      power: Math.max.apply(null, ms.map(function (m) { return m.power; })), quality: clamp(base.quality + D.SUBLIMATE_BONUS, 1, 100),
      traits: traits.slice(0, D.MAX_TRAITS), shape: big.shape, at: now, sublimated: true };
    save.mats = save.mats.filter(function (m) { return uids.indexOf(m.uid) < 0; });
    save.mats.push(out);
    return out;
  }
  function level(save) { return Math.min(D.LV_MAX, 1 + Math.floor(save.exp / D.EXP_PER_LV)); }
  function traitCap(save) { return D.TRAIT_CAP_BASE + D.TRAIT_CAP_PER_LV * level(save); }
  function canSynth(save, now) { return now >= save.cooldownUntil; }
  function recipe(id) { for (var i = 0; i < D.RECIPES.length; i++) if (D.RECIPES[i].id === id) return D.RECIPES[i]; return null; }
  function recipesFor(save, now) { return D.RECIPES.filter(function (r) { return recipeAvailable(save, r, now); }); }
  function slotOk(need, mat) { return need === "*" || need === mat.category; }

  // ---------- 第 5 階段：工房主人（§11.1） ----------
  function hostUnlocked(save, id) { var h = HOSTS[id]; return !!h && (!h.unlock || level(save) >= h.unlock.lv); }
  function setHost(save, id) {
    if (!hostUnlocked(save, id)) return false;
    save.host = id;
    if (!save.hosts[id]) save.hosts[id] = { aff: 0, task: 0, tut: 0 };
    return true;
  }

  // ---------- 第 3 階段：進階棋盤、觸媒（§9.1） ----------
  function advancedOn(save) { return level(save) >= D.ADVANCED_LV && !!save.settings.advanced; }
  function setAdvanced(save, on) { save.settings.advanced = !!on; }
  function makeCatalyst(save, id) {
    var c = D.CATALYSTS[id];
    if (!c || level(save) < D.ADVANCED_LV || save.ash < c.ash) return false;
    save.ash -= c.ash; save.catalysts[id] = (save.catalysts[id] || 0) + 1;
    return true;
  }
  function catalystOk(save, cat) {
    var c = cat && D.CATALYSTS[cat.id];
    if (!c || level(save) < D.ADVANCED_LV || !(save.catalysts[cat.id] > 0)) return false;
    if (!c.needsEl) return true;
    return D.ELEMENTS.some(function (e) { return e.id === cat.el; });
  }
  // ---------- O8 特性合成（§9.3） ----------
  function fuseTraits(ids) {
    var out = ids.slice();
    D.TRAIT_FUSION.forEach(function (f) {
      var a = out.indexOf(f[0]), b = out.indexOf(f[1]);
      if (a < 0 || b < 0) return;
      out = out.filter(function (t) { return t !== f[0] && t !== f[1]; });
      out.push(f[2]);
    });
    return out;
  }
  function traitCost(ids) { return fuseTraits(ids).reduce(function (a, t) { return a + D.TRAITS[t].cost; }, 0); }
  // ---------- B5 大成功（§9.2） ----------
  function greatChance(save, session, ev) {
    ev = ev || methods[session.method].evaluate(session, true);
    var all = effectLevels(session.recipe, ev.gauges).every(function (e) { return e.level >= 1; });
    return D.GREAT_BASE + save.hosts[save.host].aff * D.GREAT_PER_AFF + (all ? D.GREAT_ALL_LV : 0) + ((session.ability || {}).greatBonus || 0);
  }
  // ---------- C7 瑠璃出手（§9.4） ----------
  // 調和方式有自己的 bestPlacement 就用它；否則用 options＋preview 計分（與棋盤相同的分數）
  function placementScore(session, ev) {
    var score = ev.quality / 1000;
    session.recipe.gauges.forEach(function (g) {
      var top = g.steps[g.steps.length - 1].at, v = ev.gauges[g.el], lv = 0;
      g.steps.forEach(function (st, i) { if (v >= st.at) lv = i + 1; });
      score += lv * 10 + Math.min(v, top) / top;
    });
    return score;
  }
  function bestPlacement(session, mi) {
    var impl = methods[session.method];
    if (impl.bestPlacement) return impl.bestPlacement(session, mi);
    var best = null;
    impl.options(session, mi).forEach(function (o) {
      var pv = impl.preview(session, mi, o[0], o[1], o[2]);
      if (!pv) return;
      var sc = placementScore(session, pv.after);
      if (!best || sc > best.score) best = { x: o[0], y: o[1], rot: o[2], score: sc };
    });
    return best;
  }
  function helpAvailable(save, session) {
    var impl = methods[session.method];
    return save.hosts[save.host].aff >= D.HELP_AFF && !session.helped && !!(impl.bestPlacement || impl.options) && !impl.done(session);
  }
  function useHelp(save, session, mi) {
    if (!helpAvailable(save, session)) return null;
    var impl = methods[session.method], bp = bestPlacement(session, mi);
    if (!bp) return null;
    var info = impl.place(session, mi, bp.x, bp.y, bp.rot);
    if (info.ok) session.helped = true;
    return info.ok ? info : null;
  }
  // ---------- B7 每週挑戰（§9.5） ----------
  function weekKey(now) {
    var dow = (new Date(now + JST).getUTCDay() + 6) % 7;   // 週一＝0
    return jstDate(now - dow * 86400000);
  }
  function hsvToRgb(h, s2, v) {
    var c = v * s2, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c, r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; } else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; } else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
    return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
  }
  function randomShape(rng, n) {
    var cells = [[0, 0]], has = { "0,0": true }, guard = 0;
    while (cells.length < n && guard++ < 200) {
      var c = cells[Math.floor(rng() * cells.length)], d = [[0, -1], [1, 0], [0, 1], [-1, 0]][Math.floor(rng() * 4)];
      var k = (c[0] + d[0]) + "," + (c[1] + d[1]);
      if (!has[k]) { has[k] = true; cells.push([c[0] + d[0], c[1] + d[1]]); }
    }
    return normalizeShape(cells);
  }
  function weeklyChallenge(now) {
    var key = weekKey(now), rng = makeRng("weekly:" + key);
    var pool = D.RECIPES.filter(function (r) { return r.lv <= 2 && !r.season && !r.tool; });
    var r = pool[Math.floor(rng() * pool.length)], noon = Date.parse(key + "T03:00:00Z");
    var mats = r.needs.map(function (n, i) {
      var rgb = hsvToRgb(rng() * 360, 0.5 + rng() * 0.5, 0.45 + rng() * 0.5);
      var m = makeMaterial({ rgb: rgb, hex: rgbToHex(rgb), frac: 0, shape: randomShape(rng, 2 + Math.floor(rng() * 4)) }, noon, -(i + 1));
      return m;
    });
    return { key: key, recipe: r.id, mats: mats };
  }
  function baseCauldron(id) {
    var c = D.CAULDRONS[id];
    return { id: id, lv: 1, name: c.name, pattern: c.pattern, affinity: c.affinity, affinityMult: D.AFFINITY_MULT, qualityPerCell: c.qualityPerCell };
  }
  function startChallenge(save, now) {
    var wc = weeklyChallenge(now), h = host(save);
    var s = methods[h.method].create(recipe(wc.recipe), wc.mats, baseCauldron("copper"), h.ability);
    s.challenge = wc.key;
    return s;
  }
  function challengeScore(session) {
    var ev = methods[session.method].evaluate(session, true);
    return ev.quality + 10 * effectLevels(session.recipe, ev.gauges).reduce(function (a, e) { return a + e.level; }, 0);
  }
  function finishChallenge(save, session, now) {
    if (!session.challenge || !methods[session.method].done(session)) return { error: "unplaced" };
    var w = save.weekly, score = challengeScore(session);
    if (w.key !== session.challenge) { save.weekly = w = { key: session.challenge, best: 0, plays: 0 }; }
    w.plays++;
    var first = w.plays === 1;
    if (first) save.exp += D.WEEKLY_EXP;
    w.best = Math.max(w.best, score);
    return { score: score, best: w.best, first: first };
  }
  // ---------- B8 調和回放（§9.6） ----------
  function replaySession(item) {
    var rp = item.replay, impl = methods[rp.method || "board"];
    var mats = rp.mats.map(function (m, i) {
      return { uid: -(i + 1), hex: m.hex, element: m.element, shape: m.shape, power: m.power, quality: m.quality, traits: [], category: "*" };
    });
    var s = impl.create(recipe(item.recipe), mats, rp.cauldron, rp.ability, { rules: rp.rules, catalyst: rp.cat });
    rp.moves.forEach(function (mv) { impl.place(s, mv[0], mv[1], mv[2], mv[3]); });
    return s;
  }

  // ---------- 第 4 階段：配色、虹、觀察道具（§10.1～10.3） ----------
  function hueDiff(a, b) { var d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; }
  function harmonyOf(swatches) {
    var hs = swatches.map(function (s) { return rgbToHsv(s.rgb); }).filter(function (h) { return h.s >= D.HARMONY_SAT; })
      .map(function (h) { return h.h; });
    var n = hs.length, i, j, k, T = D.HARMONY_TOL;
    function near(d, target) { return Math.abs(d - target) <= T; }
    for (i = 0; i < n; i++) for (j = i + 1; j < n; j++) for (k = j + 1; k < n; k++)
      if (near(hueDiff(hs[i], hs[j]), 120) && near(hueDiff(hs[j], hs[k]), 120) && near(hueDiff(hs[i], hs[k]), 120)) return "triad";
    for (i = 0; i < n; i++) for (j = i + 1; j < n; j++) if (hueDiff(hs[i], hs[j]) >= 180 - T) return "complementary";
    for (i = 0; i < n; i++) for (j = i + 1; j < n; j++) for (k = j + 1; k < n; k++) {
      var ds = [hueDiff(hs[i], hs[j]), hueDiff(hs[j], hs[k]), hueDiff(hs[i], hs[k])];
      if (Math.max.apply(null, ds) <= D.ANALOG_SPAN && Math.min.apply(null, ds) >= D.ANALOG_MIN) return "analogous";
    }
    return null;
  }
  function rainbowOf(rgba) {
    var sectors = [], total = rgba.length / 4, i;
    for (i = 0; i < 12; i++) sectors.push(0);
    for (i = 0; i < total; i++) {
      var hsv = rgbToHsv([rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]]);
      if (hsv.s >= D.RAINBOW_SAT && hsv.v >= D.RAINBOW_VAL) sectors[Math.floor(hsv.h / 30) % 12]++;
    }
    return sectors.filter(function (c) { return c / total >= D.RAINBOW_SECTOR_FRAC; }).length >= D.RAINBOW_SECTORS;
  }
  function shiftHue(rgba, deg) {
    var out = new Uint8ClampedArray(rgba.length);
    for (var i = 0; i < rgba.length; i += 4) {
      var hsv = rgbToHsv([rgba[i], rgba[i + 1], rgba[i + 2]]), rgb = hsvToRgb((hsv.h + deg + 360) % 360, hsv.s, hsv.v);
      out[i] = rgb[0]; out[i + 1] = rgb[1]; out[i + 2] = rgb[2]; out[i + 3] = rgba[i + 3];
    }
    return out;
  }
  function analyzeOpts(save) { return save.tools && save.tools.loupe ? { k: D.LOUPE.k, minFrac: D.LOUPE.minFrac } : {}; }

  // ---------- §10.7 季節 ----------
  function seasonOf(now) { return D.SEASON_BY_MONTH[new Date(now + JST).getUTCMonth() + 1]; }
  function isSeasonColor(colorId, now) { return D.SEASONS[seasonOf(now)].colors.indexOf(colorId) >= 0; }

  // ---------- §10.4 著色繪本 ----------
  function page(id) { return D.PAGES.filter(function (pg) { return pg.id === id; })[0] || null; }
  function colorById(id) { return COLORS.filter(function (c) { return c.id === id; })[0] || null; }
  function pageProgress(save, pageId) {
    var pg = page(pageId), filled = save.coloring[pageId] || {};
    return { filled: pg.regions.filter(function (r) { return filled[r.id]; }).length, total: pg.regions.length };
  }
  function colorRegion(save, pageId, regionId, matUid) {
    var pg = page(pageId);
    if (!pg) return { error: "page" };
    var region = pg.regions.filter(function (r) { return r.id === regionId; })[0];
    if (!region) return { error: "region" };
    var filled = save.coloring[pageId] = save.coloring[pageId] || {};
    if (filled[regionId]) return { error: "filled" };
    var m = save.mats.filter(function (x) { return x.uid === matUid; })[0];
    if (!m || !m.colorId) return { error: "material" };
    if (dexGroup(colorById(m.colorId)) !== region.group) return { error: "group" };
    filled[regionId] = m.hex;
    save.mats = save.mats.filter(function (x) { return x !== m; });
    var pr = pageProgress(save, pageId), done = pr.filled === pr.total && !save.pagesDone[pageId];
    if (done) { save.pagesDone[pageId] = true; save.exp += D.PAGE_REWARD.exp; save.ash += D.PAGE_REWARD.ash; }
    return { ok: true, done: done };
  }

  // ---------- §10.5 工房裝飾 ----------
  function displayed(save, uid) { return save.deco.indexOf("item:" + uid) >= 0; }
  function decoOptions(save) {
    var out = [];
    D.PAGES.forEach(function (pg) { if (save.pagesDone[pg.id]) out.push({ ref: "page:" + pg.id, kind: "page", id: pg.id }); });
    save.items.forEach(function (it) { out.push({ ref: "item:" + it.uid, kind: "item", id: it.uid }); });
    return out;
  }
  function decoValid(save, ref) { return decoOptions(save).some(function (o) { return o.ref === ref; }); }
  function decoTaste(save, ref) {
    var h = host(save), likes = h.likes || { groups: [], elements: [] }, dislikes = h.dislikes || { groups: [], elements: [] };
    if (!ref || !decoValid(save, ref)) return 0;
    var parts = ref.split(":"), key;
    if (parts[0] === "page") {
      key = page(parts[1]).theme;
      return likes.groups.indexOf(key) >= 0 ? 1 : dislikes.groups.indexOf(key) >= 0 ? -1 : 0;
    }
    var it = save.items.filter(function (x) { return x.uid === +parts[1]; })[0];
    key = itemAsMaterial(it).element;
    return likes.elements.indexOf(key) >= 0 ? 1 : dislikes.elements.indexOf(key) >= 0 ? -1 : 0;
  }
  // 放上裝飾（ref＝null 時拿下）。回傳瑠璃的反應：like／dislike／ok；不合法時 null
  function setDeco(save, slot, ref) {
    if (slot < 0 || slot >= D.DECO_SLOTS) return null;
    if (ref !== null) {
      if (!decoValid(save, ref)) return null;
      if (save.deco.some(function (r, i) { return i !== slot && r === ref; })) return null;
    }
    save.deco[slot] = ref;
    if (ref === null) return "ok";
    var taste = decoTaste(save, ref);
    return taste > 0 ? "like" : taste < 0 ? "dislike" : "ok";
  }
  // 每天第一次開啟：每個喜歡的裝飾讓好感度 +1
  function dailyVisit(save, now) {
    var date = jstDate(now);
    if (save.visitDate === date) return null;
    save.visitDate = date;
    save.deco = save.deco.map(function (r) { return r && decoValid(save, r) ? r : null; });
    var likes = save.deco.filter(function (r) { return r && decoTaste(save, r) > 0; }).length, hs = save.hosts[save.host];
    hs.aff = Math.min(100, hs.aff + likes);
    return { aff: likes };
  }

  // ---------- §10.6 店鋪與行情 ----------
  function hotElement(now) { return D.ELEMENTS[hash("hot:" + weekKey(now)) % D.ELEMENTS.length].id; }
  function priceOf(item, now) {
    var r = recipe(item.recipe), base = D.RECIPE_PRICE[r.id] || 30, el = itemAsMaterial(item).element;
    var mult = (el === hotElement(now) ? D.HOT_MULT : 1) * (r.season && r.season === seasonOf(now) ? D.SEASON_MULT : 1);
    return Math.round(base * (0.5 + item.quality / 100) * mult);
  }
  function sell(save, uid, now) {
    var it = save.items.filter(function (x) { return x.uid === uid; })[0];
    if (!it || displayed(save, uid)) return null;
    var price = priceOf(it, now);
    save.items = save.items.filter(function (x) { return x !== it; });
    save.coins += price; save.coinsEarned += price;
    return price;
  }
  function buyCatalyst(save, id) {
    var cost = D.CATALYST_COINS[id];
    if (cost === undefined || level(save) < D.ADVANCED_LV || save.coins < cost) return false;
    save.coins -= cost; save.catalysts[id] = (save.catalysts[id] || 0) + 1;
    return true;
  }
  function buyBasket(save, now) {
    refillBasket(save, now);
    if (save.basket.n >= D.BASKET_MAX || save.coins < D.BASKET_COINS) return false;
    save.coins -= D.BASKET_COINS; save.basket.n++;
    if (save.basket.n >= D.BASKET_MAX) save.basket.at = now;
    return true;
  }

  // ---------- §10.8 稱號 ----------
  function titleMet(save, c) {
    var made = Object.keys(save.made).reduce(function (a, k) { return a + save.made[k]; }, 0);
    var best = Object.keys(save.best).reduce(function (a, k) { return Math.max(a, save.best[k]); }, 0);
    var pages = Object.keys(save.pagesDone).length, dex = dexProgress(save);
    if (c.made) return made >= c.made;
    if (c.dex) return dex.seen >= c.dex;
    if (c.dexAll) return dex.seen >= dex.total;
    if (c.quality) return best >= c.quality;
    if (c.great) return save.greatCount >= c.great;
    if (c.weekly) return save.weekly.plays >= c.weekly;
    if (c.pages) return pages >= c.pages;
    if (c.pagesAll) return pages >= D.PAGES.length;
    if (c.coins) return save.coinsEarned >= c.coins;
    if (c.aff) return save.hosts[save.host].aff >= c.aff;
    return false;
  }
  function checkTitles(save) {
    var out = [];
    D.TITLES.forEach(function (t) { if (!save.titles[t.id] && titleMet(save, t.cond)) { save.titles[t.id] = true; out.push(t.id); } });
    return out;
  }
  function setTitle(save, id) {
    if (id && !save.titles[id]) return false;
    save.title = id || "";
    return true;
  }

  // ---------- 調和 ----------
  function registerMethod(id, impl) { methods[id] = impl; }
  function host(save) { return HOSTS[save.host]; }
  // matUids 依配方 needs 的順序；檢查失敗回傳 {error}
  // opts（第 3 階段）：{ catalyst: {id, el} }
  function startSynthesis(save, recipeId, matUids, cauldronId, now, opts) {
    opts = opts || {};
    var r = recipe(recipeId);
    if (!r || !recipeAvailable(save, r, now)) return { error: "recipe" };
    if (!canSynth(save, now)) return { error: "cooldown" };
    if (matUids.length !== r.needs.length) return { error: "count" };
    var cauldron = effectiveCauldron(save, cauldronId);
    if (!cauldron) return { error: "cauldron" };
    var mats = [];
    for (var i = 0; i < matUids.length; i++) {
      var m = findMat(save, matUids[i]);
      if (!m || matUids.indexOf(matUids[i]) !== i || !slotOk(r.needs[i], m)) return { error: "slot", slot: i };
      mats.push(m);
    }
    if (opts.catalyst && !catalystOk(save, opts.catalyst)) return { error: "catalyst" };
    var h = host(save), adv = advancedOn(save);
    return methods[h.method].create(r, mats, cauldron, h.ability, {
      rules: adv ? { mix: true, complement: true, great: true } : {},
      catalyst: opts.catalyst ? { id: opts.catalyst.id, el: opts.catalyst.el || null } : null
    });
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
    var choices = traitChoices(session);
    for (var i = 0; i < traitIds.length; i++) {
      if (choices.indexOf(traitIds[i]) < 0 || traitIds.indexOf(traitIds[i]) !== i) return false;
    }
    return traitCost(traitIds) <= traitCap(save);   // O8：成本以合成後的特性計算
  }
  // 完成調和：扣素材、加成品、經驗、冷卻、好感度；回傳 item 或 {error}
  function finishSynthesis(save, session, traitIds, now) {
    var impl = methods[session.method];
    if (!impl.done(session)) return { error: "unplaced" };
    if (!traitsValid(save, session, traitIds)) return { error: "traits" };
    var ev = impl.evaluate(session, true), q = ev.quality, boost = 0, traits = fuseTraits(traitIds);
    traits.forEach(function (t) { q += D.TRAITS[t].quality || 0; boost += D.TRAITS[t].boost || 0; });
    var rules = session.rules || {}, overheat = !!(rules.great && ev.overheat), great = false;
    if (overheat) q -= D.OVERHEAT_PENALTY;                                      // §9.2 過熱
    if (rules.great) {                                                          // §9.2 大成功（seed 可重現）
      great = makeRng("great:" + save.nextUid + ":" + session.recipe.id)() < greatChance(save, session, ev);
      if (great) q += D.GREAT_QUALITY;
    }
    var mult = (1 + boost / 100) * (great ? D.GREAT_EFFECT : 1);
    var effects = effectLevels(session.recipe, ev.gauges).map(function (e) {
      return { el: e.el, level: e.level, kind: e.step ? e.step.kind : null, n: e.step ? Math.round(e.step.n * mult) : 0 };
    });
    var item = { uid: save.nextUid++, recipe: session.recipe.id, quality: clamp(Math.round(q), 1, great ? D.QUALITY_CAP_GREAT : 100),
      effects: effects, traits: traits, gauges: ev.gauges, at: now, great: great, overheat: overheat,
      replay: { method: session.method, cauldron: session.cauldron, ability: session.ability, rules: rules, cat: session.catalyst || null,
        mats: session.mats.map(function (m) { return { hex: m.hex, element: m.element, shape: m.shape, power: m.power, quality: m.quality }; }),
        moves: (session.moves || []).slice() } };
    if (session.catalyst) save.catalysts[session.catalyst.id]--;
    if (great) save.greatCount = (save.greatCount || 0) + 1;
    if (session.recipe.tool && effects.some(function (e) { return e.level >= 1; })) save.tools[session.recipe.tool] = true;   // §10.3
    var used = session.mats.map(function (m) { return m.uid; }), ash = 0;
    if (ev.lost !== undefined) ash = ev.lost;                                  // §11：循環派環滿後流掉的量
    else session.mats.forEach(function (m, i) { ash += m.shape.length - ev.visible[i]; });   // C10：被蓋掉的格子變成灰燼
    if (item.quality < D.ASH_LOW_QUALITY) ash += D.ASH_FAIL_BONUS;
    item.ash = ash;
    save.ash += ash;
    save.made[item.recipe] = (save.made[item.recipe] || 0) + 1;
    save.mats = save.mats.filter(function (m) { return used.indexOf(m.uid) < 0; });
    save.items = save.items.filter(function (it) { return used.indexOf(it.uid) < 0; });   // O9：投入的成品也會用掉
    save.items.push(item);
    save.exp += D.EXP_PER_SYNTH;
    save.cooldownUntil = now + D.COOLDOWN_MS;
    save.hosts[save.host].aff = Math.min(100, save.hosts[save.host].aff + D.AFF_PER_SYNTH);
    if (!save.best[item.recipe] || item.quality > save.best[item.recipe]) save.best[item.recipe] = item.quality;
    if (save.host === "ruri") { if (save.tutorial < 3) save.tutorial++; }
    else if (save.hosts[save.host].tut < host(save).tutorial.length) save.hosts[save.host].tut++;
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
    if (!item || !taskMet(task, item) || displayed(save, itemUid)) return false;
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
    clamp: clamp, hash: hash, makeRng: makeRng, jstHour: jstHour, jstDate: jstDate, dayDiff: dayDiff, migrate: migrate,
    updateStreak: updateStreak, streakBonus: streakBonus, captureEx: captureEx,
    dailyColor: dailyColor, isDailyHit: isDailyHit, whiteBalanceGains: whiteBalanceGains, applyGains: applyGains,
    setWhiteBalance: setWhiteBalance, wbActive: wbActive, dexGroup: dexGroup, dexGroups: dexGroups, dexProgress: dexProgress,
    ideaMet: ideaMet, recipeKnown: recipeKnown, recipeAvailable: recipeAvailable, checkIdeas: checkIdeas,
    cauldronLv: cauldronLv, canUnlockCauldron: canUnlockCauldron, unlockCauldron: unlockCauldron, upgradeCost: upgradeCost,
    upgradeCauldron: upgradeCauldron, effectiveCauldron: effectiveCauldron, matMax: matMax, shelfCost: shelfCost, upgradeShelf: upgradeShelf,
    itemAsMaterial: itemAsMaterial, findMat: findMat, sublimate: sublimate,
    advancedOn: advancedOn, setAdvanced: setAdvanced, makeCatalyst: makeCatalyst, catalystOk: catalystOk,
    fuseTraits: fuseTraits, traitCost: traitCost, greatChance: greatChance, helpAvailable: helpAvailable, useHelp: useHelp,
    weekKey: weekKey, hsvToRgb: hsvToRgb, weeklyChallenge: weeklyChallenge, startChallenge: startChallenge,
    challengeScore: challengeScore, finishChallenge: finishChallenge, replaySession: replaySession, baseCauldron: baseCauldron,
    hueDiff: hueDiff, harmonyOf: harmonyOf, rainbowOf: rainbowOf, shiftHue: shiftHue, analyzeOpts: analyzeOpts,
    seasonOf: seasonOf, isSeasonColor: isSeasonColor, page: page, colorById: colorById, pageProgress: pageProgress, colorRegion: colorRegion,
    displayed: displayed, decoOptions: decoOptions, decoTaste: decoTaste, setDeco: setDeco, dailyVisit: dailyVisit,
    hotElement: hotElement, priceOf: priceOf, sell: sell, buyCatalyst: buyCatalyst, buyBasket: buyBasket,
    titleMet: titleMet, checkTitles: checkTitles, setTitle: setTitle,
    hostUnlocked: hostUnlocked, setHost: setHost, bestPlacement: bestPlacement, placementScore: placementScore,
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
