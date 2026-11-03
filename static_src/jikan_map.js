// 時間管理大師（jikan）：街道圖。外出邂逅時在城鎮裡走動，走進店家、碰到路上的女孩就會發生邂逅。
// 地圖是 32×28 格的俯視城鎮（北邊鐵路與車站、中間兩條大街、南邊河川、公園與神社），
// 底圖在開啟時畫進離屏 canvas，每一影格只畫鏡頭範圍、角色、電車、時段光影與招牌。
// 對外只回報事件（spot／npc／out／home），邂逅機率與劇情由 jikan.js 決定。
(function () {
  "use strict";

  var W = 32, H = 28, T = 32;
  var VIEW_TILES = 12;          // 鏡頭寬度（格）
  var STEP_MS = 150;            // 走一格的時間
  var WALK = { R: 1, "=": 1, P: 1, H: 1, E: 1, G: 1, M: 1, J: 1, D: 1 };
  var HOME = [29, 23];
  var STATION_AREA = { x0: 6, x1: 25, y0: 3, y1: 6 };

  // 建築（x, y, w, h 為格；doors 是可以走進去的入口格，走進去就觸發該地點）
  var BUILDINGS = [
    { id: "station", x: 9, y: 3, w: 14, h: 2, doors: [[15, 4], [16, 4]], spot: "station", roof: "#7c8aa4", wall: "#eef1f6", awn: "#3c6db5", kind: "station", label: "星見台站" },
    { id: "bus", x: 7, y: 3, w: 2, h: 2, doors: [[8, 4]], spot: "bus", roof: "#3f8f86", wall: "#d9efe9", kind: "shelter" },
    { id: "conv", x: 23, y: 3, w: 2, h: 2, doors: [[24, 4]], spot: "conv", roof: "#f1f3f4", wall: "#ffffff", awn: "#27a36a", kind: "shop" },
    { id: "laundry", x: 0, y: 3, w: 3, h: 3, doors: [[2, 5]], spot: "laundry", roof: "#8ec8e2", wall: "#eef7fb", awn: "#4a9fd0", kind: "shop" },
    { id: "records", x: 29, y: 3, w: 3, h: 3, doors: [[29, 5]], spot: "records", roof: "#3c3453", wall: "#5a4f78", awn: "#b06cff", kind: "shop" },
    { id: "gym", x: 0, y: 10, w: 3, h: 3, doors: [[2, 12]], spot: "gym", roof: "#d8684a", wall: "#f6ded3", awn: "#2f3a4a", kind: "shop" },
    { id: "books", x: 7, y: 10, w: 3, h: 3, doors: [[8, 12]], spot: "books", roof: "#8d5b3e", wall: "#f3e4d0", awn: "#2f6b4f", kind: "shop" },
    { id: "catcafe", x: 11, y: 10, w: 3, h: 3, doors: [[12, 12]], spot: "catcafe", roof: "#f0a2b5", wall: "#fff1f4", awn: "#e2668a", kind: "shop" },
    { id: "museum", x: 18, y: 10, w: 4, h: 3, doors: [[19, 12], [20, 12]], spot: "museum", roof: "#d8d0c0", wall: "#f7f3ea", kind: "museum" },
    { id: "flower", x: 23, y: 10, w: 2, h: 3, doors: [[23, 12]], spot: "flower", roof: "#f4bfcf", wall: "#fff6f8", awn: "#5aa15a", kind: "shop" },
    { id: "beans", x: 29, y: 10, w: 3, h: 3, doors: [[30, 12]], spot: "beans", roof: "#6a4733", wall: "#efe1d2", awn: "#a0522d", kind: "shop" },
    { id: "used", x: 0, y: 17, w: 3, h: 2, doors: [[1, 18]], spot: "used", roof: "#c08f5e", wall: "#f4e7d3", awn: "#7a5230", kind: "stall" },
    { id: "library", x: 7, y: 17, w: 6, h: 2, doors: [[9, 17], [10, 17]], spot: "library", roof: "#9c5f45", wall: "#ead7c4", kind: "museum" },
    { id: "roof", x: 29, y: 17, w: 3, h: 2, doors: [[29, 17]], spot: "roof", roof: "#6f86a6", wall: "#cfd9e6", kind: "tower" },
    { id: "shrine", x: 19, y: 25, w: 5, h: 2, doors: [[21, 25]], spot: "shrine", roof: "#4b3b3b", wall: "#c8402f", kind: "shrine" },
    { id: "home", x: 28, y: 24, w: 3, h: 2, doors: [], spot: null, roof: "#e98a6b", wall: "#fff3e6", kind: "home", label: "你家" }
  ];
  var TREES = [[13, 17], [13, 18], [1, 23], [2, 26], [0, 25], [7, 23], [13, 24], [12, 27], [7, 27], [13, 26], [1, 27],
    [31, 24], [31, 27], [28, 27], [30, 27], [17, 26], [25, 26], [17, 24], [25, 24]];
  var BENCHES = [[10, 19], [21, 22], [2, 22], [30, 19]];   // 河堤的長椅（走上去＝河堤）
  var FOUNTAIN = { x: 9, y: 24, w: 3, h: 3 };               // 公園噴水池（周圍一圈＝公園）
  var TORII = [21, 23];

  // ---------- 格子 ----------
  var grid = [], zone = {}, bAt = {};
  (function build() {
    var x, y;
    for (y = 0; y < H; y++) { grid.push([]); for (x = 0; x < W; x++) grid[y].push("#"); }
    function rect(x0, y0, x1, y1, ch) { for (var yy = y0; yy <= y1; yy++) for (var xx = x0; xx <= x1; xx++) grid[yy][xx] = ch; }
    rect(0, 0, W - 1, 1, "L"); rect(0, 2, W - 1, 2, "F");
    rect(6, 5, 25, 6, "P");
    rect(0, 23, 14, 27, "G"); rect(28, 23, 31, 27, "G"); rect(17, 23, 25, 27, "J");
    rect(18, 17, 24, 18, "M");
    rect(0, 19, W - 1, 19, "E"); rect(0, 20, W - 1, 21, "W"); rect(0, 22, W - 1, 22, "E");
    rect(0, 7, W - 1, 8, "R"); rect(0, 14, W - 1, 15, "R");
    rect(4, 3, 5, H - 1, "R"); rect(26, 3, 27, H - 1, "R"); rect(15, 7, 16, H - 1, "R");
    [4, 5, 15, 16, 26, 27].forEach(function (c) { grid[20][c] = "H"; grid[21][c] = "H"; });
    rect(FOUNTAIN.x, FOUNTAIN.y, FOUNTAIN.x + FOUNTAIN.w - 1, FOUNTAIN.y + FOUNTAIN.h - 1, "O");
    for (y = 3; y < 19; y++) for (x = 0; x < W; x++) if (grid[y][x] === "#" && nearRoad(x, y)) grid[y][x] = "=";
    rect(10, 10, 10, 12, "="); rect(22, 10, 22, 12, "=");   // 店與店之間的小巷
    BUILDINGS.forEach(function (b) {
      for (var yy = b.y; yy < b.y + b.h; yy++) for (var xx = b.x; xx < b.x + b.w; xx++) { grid[yy][xx] = "B"; bAt[xx + "," + yy] = b; }
      b.doors.forEach(function (d) { grid[d[1]][d[0]] = "D"; zone[d[0] + "," + d[1]] = b.spot; });
    });
    TREES.forEach(function (p) { grid[p[1]][p[0]] = "T"; });
    for (y = 17; y <= 18; y++) for (x = 18; x <= 24; x++) zone[x + "," + y] = "night";
    BENCHES.forEach(function (p) { zone[p[0] + "," + p[1]] = "river"; });
    for (y = FOUNTAIN.y - 1; y <= FOUNTAIN.y + FOUNTAIN.h; y++) for (x = FOUNTAIN.x - 1; x <= FOUNTAIN.x + FOUNTAIN.w; x++)
      if (grid[y][x] === "G") zone[x + "," + y] = "park";
    function nearRoad(x, y) {
      return [[1, 0], [-1, 0], [0, 1], [0, -1]].some(function (d) {
        var xx = x + d[0], yy = y + d[1];
        return yy >= 0 && yy < H && xx >= 0 && xx < W && grid[yy][xx] === "R";
      });
    }
  })();

  function tileAt(x, y) { return (x < 0 || y < 0 || x >= W || y >= H) ? "#" : grid[y][x]; }
  function walkable(x, y) { return !!WALK[tileAt(x, y)]; }
  function inStation(x, y) { return x >= STATION_AREA.x0 && x <= STATION_AREA.x1 && y >= STATION_AREA.y0 && y <= STATION_AREA.y1; }

  // ---------- 小工具 ----------
  function seeded(seed) {
    var s = seed >>> 0;
    return function () { s = (s + 0x6D2B79F5) >>> 0; var t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function shade(hex, amt) {
    var n = parseInt(hex.slice(1), 16);
    var r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    function f(c) { return Math.max(0, Math.min(255, Math.round(amt < 0 ? c * (1 + amt) : c + (255 - c) * amt))); }
    return "rgb(" + f(r) + "," + f(g) + "," + f(b) + ")";
  }
  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h); ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r); ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
  }
  function bfs(sx, sy, tx, ty, block) {
    if (sx === tx && sy === ty) return [];
    var prev = {}, q = [[sx, sy]], k0 = sx + "," + sy; prev[k0] = null;
    while (q.length) {
      var p = q.shift();
      var dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (var i = 0; i < 4; i++) {
        var x = p[0] + dirs[i][0], y = p[1] + dirs[i][1], k = x + "," + y;
        if (prev.hasOwnProperty(k) || !walkable(x, y) || (block && block[k] && !(x === tx && y === ty))) continue;
        prev[k] = p;
        if (x === tx && y === ty) {
          var path = [[x, y]], c = p;
          while (c && !(c[0] === sx && c[1] === sy)) { path.unshift(c); c = prev[c[0] + "," + c[1]]; }
          return path;
        }
        q.push([x, y]);
      }
    }
    return null;
  }

  // ---------- 底圖 ----------
  var baseCache = null;
  function buildBase(scale) {
    var cv = document.createElement("canvas");
    cv.width = W * T * scale; cv.height = H * T * scale;
    var c = cv.getContext("2d");
    c.scale(scale, scale);
    var rnd = seeded(20261103);
    var x, y;
    for (y = 0; y < H; y++) for (x = 0; x < W; x++) drawGround(c, x, y, rnd);
    drawRails(c); drawRoadMarks(c); drawWater(c); drawBridges(c); drawFountain(c);
    drawStreetFurniture(c, rnd);
    BUILDINGS.forEach(function (b) { drawBuilding(c, b); });
    TREES.forEach(function (p) { drawTree(c, p[0] * T + T / 2, p[1] * T + T / 2, rnd); });
    drawTorii(c);
    return cv;
  }

  var GROUND = { R: "#5a606e", "=": "#e7dac4", P: "#ece1d0", E: "#9fcf82", G: "#8fce6e", M: "#cdbda5", J: "#e6dece", F: "#cfcac2", L: "#8b8278", "#": "#d8ccb5", B: "#d8ccb5", D: "#e7dac4", T: "#8fce6e", O: "#8fce6e", W: "#4aa3d8", H: "#4aa3d8" };
  function drawGround(c, x, y, rnd) {
    var t = grid[y][x], px = x * T, py = y * T, i;
    var base = t;
    if (t === "T") base = (y >= 23 && x >= 17 && x <= 25) ? "J" : (y <= 18 ? "=" : "G");
    if (t === "D") base = (y >= 23) ? "J" : "=";
    c.fillStyle = GROUND[base] || "#d8ccb5";
    c.fillRect(px, py, T, T);
    if (base === "R") {
      for (i = 0; i < 5; i++) { c.fillStyle = "rgba(255,255,255," + (0.03 + rnd() * 0.04) + ")"; c.fillRect(px + rnd() * T, py + rnd() * T, 2, 2); }
    } else if (base === "=" || base === "M") {
      c.strokeStyle = base === "M" ? "rgba(120,95,70,.18)" : "rgba(150,125,95,.22)"; c.lineWidth = 1;
      c.beginPath(); c.moveTo(px, py + T / 2 + 0.5); c.lineTo(px + T, py + T / 2 + 0.5);
      c.moveTo(px + ((y % 2) ? T / 2 : 0) + 0.5, py); c.lineTo(px + ((y % 2) ? T / 2 : 0) + 0.5, py + T / 2);
      c.moveTo(px + ((y % 2) ? 0 : T / 2) + 0.5, py + T / 2); c.lineTo(px + ((y % 2) ? 0 : T / 2) + 0.5, py + T);
      c.stroke();
      // 路緣石
      c.fillStyle = "#b9ab95";
      if (tileAt(x, y + 1) === "R") c.fillRect(px, py + T - 3, T, 3);
      if (tileAt(x, y - 1) === "R") c.fillRect(px, py, T, 3);
      if (tileAt(x + 1, y) === "R") c.fillRect(px + T - 3, py, 3, T);
      if (tileAt(x - 1, y) === "R") c.fillRect(px, py, 3, T);
    } else if (base === "P") {
      c.strokeStyle = "rgba(170,140,110,.25)"; c.lineWidth = 1;
      c.strokeRect(px + 0.5, py + 0.5, T - 1, T - 1);
      c.fillStyle = (x + y) % 2 ? "rgba(214,190,160,.35)" : "rgba(255,255,255,.25)";
      c.beginPath(); c.moveTo(px + T / 2, py + 4); c.lineTo(px + T - 4, py + T / 2); c.lineTo(px + T / 2, py + T - 4); c.lineTo(px + 4, py + T / 2); c.closePath(); c.fill();
    } else if (base === "G" || base === "E") {
      for (i = 0; i < 6; i++) { c.fillStyle = "rgba(40,110,40," + (0.12 + rnd() * 0.12) + ")"; c.fillRect(px + rnd() * (T - 2), py + rnd() * (T - 3), 1.5, 3); }
      if (rnd() < 0.18) { c.fillStyle = ["#ffd1dc", "#fff6a8", "#ffffff", "#d6c3ff"][Math.floor(rnd() * 4)]; c.beginPath(); c.arc(px + 4 + rnd() * (T - 8), py + 4 + rnd() * (T - 8), 2, 0, Math.PI * 2); c.fill(); }
      if (base === "E") { c.fillStyle = "#dcc9a0"; c.fillRect(px, py + T * 0.38, T, T * 0.24); c.fillStyle = "rgba(255,255,255,.18)"; c.fillRect(px, py + T * 0.38, T, 2); }
    } else if (base === "J") {
      for (i = 0; i < 8; i++) { c.fillStyle = "rgba(120,110,95," + (0.12 + rnd() * 0.15) + ")"; c.beginPath(); c.arc(px + rnd() * T, py + rnd() * T, 1 + rnd(), 0, Math.PI * 2); c.fill(); }
      if (x === 21 && (y === 23 || y === 24)) { c.fillStyle = "#cfc4ae"; rr(c, px + 6, py + 3, T - 12, T - 6, 4); c.fill(); }
    } else if (base === "F") {
      c.fillStyle = "#f2c94c"; c.fillRect(px, py + T - 9, T, 4);
      c.fillStyle = "rgba(0,0,0,.08)"; c.fillRect(px, py + T - 2, T, 2);
    }
  }
  function drawRails(c) {
    c.fillStyle = "#7d7369"; c.fillRect(0, 0, W * T, 2 * T);
    for (var row = 0; row < 2; row++) {
      var cy = row * T + T / 2;
      for (var x = 0; x < W * T; x += 10) { c.fillStyle = "#5b4636"; c.fillRect(x, cy - 11, 6, 22); }
      c.fillStyle = "#c9ccd2"; c.fillRect(0, cy - 8, W * T, 3); c.fillRect(0, cy + 5, W * T, 3);
      c.fillStyle = "rgba(255,255,255,.5)"; c.fillRect(0, cy - 8, W * T, 1); c.fillRect(0, cy + 5, W * T, 1);
    }
    // 月台屋簷柱
    for (var px = 9 * T; px <= 23 * T; px += 2 * T) { c.fillStyle = "#8a93a3"; c.fillRect(px - 2, 2 * T + 4, 4, 14); }
    c.fillStyle = "rgba(124,138,164,.85)"; c.fillRect(9 * T, 2 * T, 14 * T, 6);
  }
  function drawRoadMarks(c) {
    c.fillStyle = "rgba(255,255,255,.85)";
    var xs = [[4, 5], [15, 16], [26, 27]], ys = [[7, 8], [14, 15]], i, x, y;
    function isCross(tx, ty) { return xs.some(function (a) { return tx >= a[0] && tx <= a[1]; }) && ys.some(function (a) { return ty >= a[0] && ty <= a[1]; }); }
    // 中央虛線
    ys.forEach(function (a) { for (x = 0; x < W; x++) if (!isCross(x, a[0]) && grid[a[0]][x] === "R") for (i = 0; i < 2; i++) c.fillRect(x * T + i * 16 + 3, a[1] * T - 1, 9, 2); });
    xs.forEach(function (a) { for (y = 3; y < H; y++) if (!isCross(a[0], y) && grid[y][a[0]] === "R") for (i = 0; i < 2; i++) c.fillRect(a[1] * T - 1, y * T + i * 16 + 3, 2, 9); });
    // 斑馬線
    xs.forEach(function (a) {
      ys.forEach(function (b) {
        [a[0] - 1, a[1] + 1].forEach(function (tx) {
          if (tileAt(tx, b[0]) !== "R") return;
          for (var yy = b[0] * T + 3; yy < (b[1] + 1) * T - 3; yy += 7) c.fillRect(tx * T + 6, yy, T - 12, 4);
        });
        [b[0] - 1, b[1] + 1].forEach(function (ty) {
          if (tileAt(a[0], ty) !== "R") return;
          for (var xx = a[0] * T + 3; xx < (a[1] + 1) * T - 3; xx += 7) c.fillRect(xx, ty * T + 6, 4, T - 12);
        });
      });
    });
  }
  function drawWater(c) {
    var g = c.createLinearGradient(0, 20 * T, 0, 22 * T);
    g.addColorStop(0, "#3f97cf"); g.addColorStop(0.5, "#5cb6e6"); g.addColorStop(1, "#3f97cf");
    c.fillStyle = g; c.fillRect(0, 20 * T, W * T, 2 * T);
    c.fillStyle = "#7a9a5a"; c.fillRect(0, 20 * T, W * T, 3); c.fillRect(0, 22 * T - 3, W * T, 3);
    c.strokeStyle = "rgba(255,255,255,.35)"; c.lineWidth = 1.5;
    for (var x = 0; x < W * T; x += 46) { c.beginPath(); c.moveTo(x, 20 * T + 18 + (x % 3) * 6); c.quadraticCurveTo(x + 8, 20 * T + 14 + (x % 3) * 6, x + 16, 20 * T + 18 + (x % 3) * 6); c.stroke(); }
  }
  function drawBridges(c) {
    [[4, 5], [15, 16], [26, 27]].forEach(function (a) {
      var x0 = a[0] * T, w = 2 * T, y0 = 20 * T - 4, h = 2 * T + 8;
      c.fillStyle = "rgba(0,0,0,.2)"; c.fillRect(x0 + 4, y0 + 6, w, h);
      c.fillStyle = "#c79e70"; c.fillRect(x0, y0, w, h);
      c.strokeStyle = "rgba(110,75,45,.35)"; c.lineWidth = 1;
      for (var y = y0 + 4; y < y0 + h; y += 6) { c.beginPath(); c.moveTo(x0, y + 0.5); c.lineTo(x0 + w, y + 0.5); c.stroke(); }
      c.fillStyle = "#8a6444"; c.fillRect(x0 - 2, y0, 5, h); c.fillRect(x0 + w - 3, y0, 5, h);
      c.fillStyle = "#e8c690"; for (var py = y0; py <= y0 + h; py += 16) { c.fillRect(x0 - 3, py, 7, 4); c.fillRect(x0 + w - 4, py, 7, 4); }
    });
  }
  function drawFountain(c) {
    var cx = (FOUNTAIN.x + 1.5) * T, cy = (FOUNTAIN.y + 1.5) * T;
    c.fillStyle = "#e9e2d6"; c.beginPath(); c.arc(cx, cy, 1.45 * T, 0, Math.PI * 2); c.fill();
    c.fillStyle = "rgba(0,0,0,.12)"; c.beginPath(); c.arc(cx + 3, cy + 4, 1.3 * T, 0, Math.PI * 2); c.fill();
    c.fillStyle = "#cfc5b5"; c.beginPath(); c.arc(cx, cy, 1.3 * T, 0, Math.PI * 2); c.fill();
    var g = c.createRadialGradient(cx - 8, cy - 8, 4, cx, cy, 1.15 * T);
    g.addColorStop(0, "#9fdcff"); g.addColorStop(1, "#3c9bd6");
    c.fillStyle = g; c.beginPath(); c.arc(cx, cy, 1.15 * T, 0, Math.PI * 2); c.fill();
    c.fillStyle = "#e9e2d6"; c.beginPath(); c.arc(cx, cy, 0.38 * T, 0, Math.PI * 2); c.fill();
    c.fillStyle = "#bfe8ff"; c.beginPath(); c.arc(cx, cy, 0.22 * T, 0, Math.PI * 2); c.fill();
  }
  function drawStreetFurniture(c, rnd) {
    // 花台（車站前廣場）
    [[7, 6], [11, 6], [20, 6], [24, 6]].forEach(function (p) {
      var px = p[0] * T + 4, py = p[1] * T + 18;
      c.fillStyle = "#b48a65"; rr(c, px, py, T - 8, 10, 3); c.fill();
      for (var i = 0; i < 5; i++) { c.fillStyle = ["#ff8fb3", "#ffd166", "#ffffff", "#c7a0ff"][i % 4]; c.beginPath(); c.arc(px + 4 + i * 5, py + 2 + rnd() * 3, 2.5, 0, Math.PI * 2); c.fill(); }
    });
    // 廣場中央的時計台底座
    var cx = 16 * T, cy = 5.5 * T;
    c.fillStyle = "rgba(255,255,255,.5)"; c.beginPath(); c.arc(cx, cy + 6, 26, 0, Math.PI * 2); c.fill();
    c.strokeStyle = "rgba(190,150,120,.5)"; c.lineWidth = 2; c.beginPath(); c.arc(cx, cy + 6, 22, 0, Math.PI * 2); c.stroke();
    // 夜市攤位
    for (var x = 18; x <= 24; x++) {
      var colors = ["#e74c3c", "#f39c12", "#e84393", "#16a085", "#d35400", "#8e44ad", "#c0392b"];
      var col = colors[x - 18];
      drawStall(c, x * T + 2, 17 * T + 1, col, false);
      drawStall(c, x * T + 2, 18 * T + T - 12, colors[(x - 15) % 7], true);
    }
    // 長椅
    BENCHES.forEach(function (p) {
      var px = p[0] * T + 5, py = p[1] * T + (p[1] === 19 ? 3 : T - 11);
      c.fillStyle = "rgba(0,0,0,.18)"; c.fillRect(px + 2, py + 3, T - 10, 9);
      c.fillStyle = "#a0683f"; c.fillRect(px, py, T - 10, 8);
      c.fillStyle = "#c98b56"; c.fillRect(px, py, T - 10, 3);
    });
  }
  function drawStall(c, x, y, col, bottom) {
    var w = T - 4, h = 11;
    c.fillStyle = "rgba(0,0,0,.18)"; c.fillRect(x + 2, y + 3, w, h);
    for (var i = 0; i < 4; i++) { c.fillStyle = i % 2 ? "#ffffff" : col; c.fillRect(x + i * w / 4, y, w / 4, h); }
    c.fillStyle = "rgba(0,0,0,.12)"; c.fillRect(x, bottom ? y : y + h - 2, w, 2);
  }
  function drawTree(c, cx, cy, rnd) {
    c.fillStyle = "rgba(0,0,0,.2)"; c.beginPath(); c.ellipse(cx + 4, cy + 9, 13, 7, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = "#6b4a2f"; c.fillRect(cx - 2, cy + 2, 4, 8);
    var sakura = rnd() < 0.3;
    var cols = sakura ? ["#e98fb0", "#f6b8cd", "#ffd9e6"] : ["#3f8f4a", "#57a95c", "#7cc874"];
    c.fillStyle = cols[0]; c.beginPath(); c.arc(cx, cy - 2, 13, 0, Math.PI * 2); c.fill();
    c.fillStyle = cols[1]; c.beginPath(); c.arc(cx - 3, cy - 5, 9.5, 0, Math.PI * 2); c.fill();
    c.fillStyle = cols[2]; c.beginPath(); c.arc(cx - 5, cy - 8, 4.5, 0, Math.PI * 2); c.fill();
  }
  function drawTorii(c) {
    var x = TORII[0] * T, y = TORII[1] * T;
    c.fillStyle = "rgba(0,0,0,.2)"; c.fillRect(x + 5, y + 8, T - 6, 6);
    c.fillStyle = "#c8402f"; c.fillRect(x + 4, y + 6, 4, 22); c.fillRect(x + T - 8, y + 6, 4, 22);
    c.fillStyle = "#2e2a2a"; c.fillRect(x - 2, y + 2, T + 4, 5);
    c.fillStyle = "#c8402f"; c.fillRect(x, y + 9, T, 3);
  }

  function doorSide(b, d) {
    if (d[1] === b.y + b.h - 1 && walkable(d[0], d[1] + 1)) return "s";
    if (d[1] === b.y && walkable(d[0], d[1] - 1)) return "n";
    if (d[0] === b.x && walkable(d[0] - 1, d[1])) return "w";
    return "e";
  }
  function drawBuilding(c, b) {
    var x = b.x * T, y = b.y * T, w = b.w * T, h = b.h * T;
    var fh = b.kind === "tower" ? T * 0.9 : T * 0.62;   // 立面高度（俯視斜角）
    // 影子
    c.fillStyle = "rgba(20,15,30,.22)"; rr(c, x + 6, y + 8, w, h, 4); c.fill();
    // 立面
    c.fillStyle = b.wall; c.fillRect(x, y + h - fh, w, fh);
    c.fillStyle = "rgba(0,0,0,.08)"; c.fillRect(x, y + h - 3, w, 3);
    var i, wx;
    if (b.kind === "museum") {
      for (wx = x + 6; wx < x + w - 4; wx += 12) { c.fillStyle = "#ffffff"; c.fillRect(wx, y + h - fh + 4, 5, fh - 7); c.fillStyle = "rgba(0,0,0,.08)"; c.fillRect(wx + 4, y + h - fh + 4, 1, fh - 7); }
    } else if (b.kind === "shrine") {
      for (wx = x + 6; wx < x + w; wx += 18) { c.fillStyle = "#a8291e"; c.fillRect(wx, y + h - fh + 2, 5, fh - 4); }
      c.fillStyle = "#f6e7c8"; c.fillRect(x + 4, y + h - fh + 6, w - 8, 4);
    } else if (b.kind !== "shelter") {
      var rows = b.kind === "tower" ? 2 : 1;
      for (var r = 0; r < rows; r++) for (wx = x + 5; wx < x + w - 8; wx += 13) {
        var wy = y + h - fh + 5 + r * 12;
        c.fillStyle = "#9cc6e6"; c.fillRect(wx, wy, 8, 7);
        c.fillStyle = "rgba(255,255,255,.55)"; c.fillRect(wx, wy, 3, 7);
      }
    }
    // 屋頂
    var rh = h - fh;
    if (b.kind === "shelter") {
      c.fillStyle = "rgba(63,143,134,.82)"; rr(c, x + 2, y + 4, w - 4, h - 12, 5); c.fill();
      c.fillStyle = "rgba(255,255,255,.35)"; c.fillRect(x + 6, y + 8, w - 12, 3);
      c.fillStyle = "#7a5a3a"; c.fillRect(x + 8, y + h - 12, w - 16, 6);
      c.fillStyle = "#e85d75"; c.beginPath(); c.arc(x + 6, y + h - 6, 5, 0, Math.PI * 2); c.fill();
    } else {
      var g = c.createLinearGradient(0, y, 0, y + rh);
      g.addColorStop(0, shade(b.roof, 0.18)); g.addColorStop(1, shade(b.roof, -0.12));
      c.fillStyle = g;
      if (b.kind === "shrine") {
        c.beginPath(); c.moveTo(x - 6, y + rh); c.quadraticCurveTo(x + 2, y + rh - 4, x + 4, y + 2); c.lineTo(x + w - 4, y + 2);
        c.quadraticCurveTo(x + w - 2, y + rh - 4, x + w + 6, y + rh); c.closePath(); c.fill();
        c.fillStyle = "#d4a73a"; c.fillRect(x + 8, y + rh / 2 - 1, w - 16, 3);
      } else if (b.kind === "home") {
        c.fillRect(x, y, w, rh);
        c.fillStyle = shade(b.roof, -0.25); c.fillRect(x, y + rh / 2 - 1, w, 2);
        c.fillStyle = "#8c5a44"; c.fillRect(x + w - 16, y - 2, 7, 10);
      } else {
        c.fillRect(x, y, w, rh);
        c.strokeStyle = shade(b.roof, -0.3); c.lineWidth = 2; c.strokeRect(x + 1, y + 1, w - 2, rh - 2);
        if (b.kind === "station") {
          c.fillStyle = "rgba(200,230,255,.55)";
          for (wx = x + 10; wx < x + w - 10; wx += 22) c.fillRect(wx, y + 6, 14, rh - 12);
        } else if (b.kind === "tower") {
          c.fillStyle = shade(b.roof, -0.2); c.fillRect(x + 6, y + 6, 12, 10); c.fillRect(x + w - 22, y + 8, 14, 8);
          c.strokeStyle = "rgba(255,255,255,.6)"; c.lineWidth = 2; c.beginPath(); c.arc(x + w / 2, y + rh / 2 + 4, 9, 0, Math.PI * 2); c.stroke();
        } else if (b.kind === "museum") {
          c.fillStyle = "rgba(255,255,255,.35)"; c.beginPath(); c.moveTo(x + 4, y + rh - 2); c.lineTo(x + w / 2, y + 4); c.lineTo(x + w - 4, y + rh - 2); c.closePath(); c.fill();
        } else {
          c.fillStyle = "rgba(255,255,255,.18)"; c.fillRect(x + 4, y + 4, w - 8, 4);
          c.fillStyle = "rgba(0,0,0,.12)"; c.fillRect(x + 8, y + 12, 10, 8);
        }
      }
    }
    // 遮陽棚
    if (b.awn) {
      var ay = y + h - fh - 6;
      for (i = 0; i * 8 < w; i++) { c.fillStyle = i % 2 ? "#ffffff" : b.awn; c.fillRect(x + i * 8, ay, Math.min(8, w - i * 8), 8); }
      c.fillStyle = b.awn;
      for (i = 0; i * 8 < w; i++) { c.beginPath(); c.arc(x + i * 8 + 4, ay + 8, 4, 0, Math.PI); c.fill(); }
    }
    // 入口
    b.doors.forEach(function (d) {
      var side = doorSide(b, d), dx = d[0] * T, dy = d[1] * T;
      if (side === "s") {
        c.fillStyle = "#3b2f2a"; c.fillRect(dx + 8, dy + T - fh + 6, T - 16, fh - 6);
        c.fillStyle = "rgba(255,230,170,.65)"; c.fillRect(dx + 10, dy + T - fh + 8, T - 20, 4);
        c.fillStyle = "#b9533c"; c.fillRect(dx + 6, dy + T - 3, T - 12, 3);
      } else {
        c.fillStyle = b.kind === "shrine" ? "#d4a73a" : "#3b2f2a";
        c.fillRect(dx + 7, dy + 1, T - 14, 7);
        c.fillStyle = "#b9533c"; c.fillRect(dx + 6, dy - 3, T - 12, 3);
      }
    });
  }

  // ---------- 夜晚燈光圖層 ----------
  var lightCache = null;
  var LAMPS = [];
  (function lamps() {
    for (var y = 3; y < H; y++) for (var x = 0; x < W; x++) {
      var t = grid[y][x];
      if ((t === "=" && (x * 3 + y * 5) % 7 === 0) || (t === "E" && x % 5 === 2) || (t === "P" && (y === 6) && x % 5 === 1)) LAMPS.push([x, y]);
    }
    LAMPS.push([21, 24]); LAMPS.push([12, 23]); LAMPS.push([6, 26]); LAMPS.push([29, 23]);
  })();
  function glow(c, x, y, r, col, a) {
    var g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, "rgba(" + col + "," + a + ")"); g.addColorStop(1, "rgba(" + col + ",0)");
    c.fillStyle = g; c.fillRect(x - r, y - r, r * 2, r * 2);
  }
  function buildLights() {
    var cv = document.createElement("canvas");
    cv.width = W * T; cv.height = H * T;
    var c = cv.getContext("2d");
    LAMPS.forEach(function (p) { glow(c, p[0] * T + T / 2, p[1] * T + T / 2, T * 1.5, "255,214,140", 0.3); glow(c, p[0] * T + T / 2, p[1] * T + T / 2, T * 0.35, "255,240,200", 0.6); });
    BUILDINGS.forEach(function (b) {
      var x = b.x * T, y = b.y * T, w = b.w * T, h = b.h * T;
      var col = b.kind === "records" ? "190,120,255" : b.kind === "shrine" ? "255,150,80" : "255,226,160";
      if (b.id === "records") col = "190,120,255";
      for (var wx = x + 6; wx < x + w - 4; wx += 13) glow(c, wx + 4, y + h - 6, 11, col, 0.45);
      b.doors.forEach(function (d) { glow(c, d[0] * T + T / 2, d[1] * T + T / 2, T * 1.1, col, 0.5); });
      if (b.kind === "station") glow(c, x + w / 2, y + h, T * 4, "200,225,255", 0.45);
    });
    for (var x = 18; x <= 24; x++) { glow(c, x * T + T / 2, 17.5 * T, T * 1.1, "255,120,70", 0.7); glow(c, x * T + T / 2, 18.6 * T, T * 0.9, "255,170,80", 0.5); }
    glow(c, 21.5 * T, 25 * T, T * 2.2, "255,140,70", 0.5);
    return cv;
  }

  // ---------- 角色 ----------
  var HAIRS = ["#3a2a28", "#6b3f2a", "#c9a35a", "#e8d9c8", "#2b2d55", "#a85a8c", "#f2a7c3", "#5a6b4a", "#d9792f", "#c2c7d6"];
  var DRESS = ["#f28fb0", "#8fb7f2", "#f7d26a", "#b49af2", "#8fd6b4", "#f2a28f", "#ffffff", "#5b6b8f"];
  function drawChar(c, x, y, o) {
    var bob = o.moving ? Math.sin(o.t / 70) * 1.6 : Math.sin(o.t / 400) * 0.6;
    c.fillStyle = "rgba(0,0,0,.25)"; c.beginPath(); c.ellipse(x, y + 12, 9, 4, 0, 0, Math.PI * 2); c.fill();
    // 身體
    c.fillStyle = o.body; c.beginPath();
    if (o.girl) { c.moveTo(x - 8, y + 11 + bob * 0.3); c.lineTo(x + 8, y + 11 + bob * 0.3); c.lineTo(x + 5, y - 1 + bob); c.lineTo(x - 5, y - 1 + bob); }
    else { rr(c, x - 7, y - 1 + bob, 14, 12, 4); }
    c.closePath(); c.fill();
    c.strokeStyle = "rgba(0,0,0,.18)"; c.lineWidth = 1; c.stroke();
    // 頭
    var hy = y - 8 + bob;
    if (o.girl) { c.fillStyle = o.hair; rr(c, x - 9, hy - 6, 18, 18, 7); c.fill(); }
    c.fillStyle = "#ffe3d0"; c.beginPath(); c.arc(x, hy, 7.5, 0, Math.PI * 2); c.fill();
    c.fillStyle = o.hair; c.beginPath();
    var dir = o.dir || "s";
    if (dir === "n") { c.arc(x, hy, 8, 0, Math.PI * 2); }
    else { c.arc(x, hy - 1, 8, Math.PI * 1.02, Math.PI * 1.98); c.lineTo(x + 8, hy + 1); c.quadraticCurveTo(x, hy - 3, x - 8, hy + 1); }
    c.fill();
    if (dir !== "n") {
      c.fillStyle = "#2a1d1d";
      var ex = dir === "w" ? -2 : dir === "e" ? 2 : 0;
      c.fillRect(x - 3.5 + ex, hy + 1, 2, 2.5); c.fillRect(x + 1.5 + ex, hy + 1, 2, 2.5);
      if (o.girl) { c.fillStyle = "rgba(255,120,150,.45)"; c.fillRect(x - 5.5 + ex, hy + 4, 2.5, 1.5); c.fillRect(x + 3 + ex, hy + 4, 2.5, 1.5); }
    }
    if (o.girl && o.bow) { c.fillStyle = o.bow; c.beginPath(); c.arc(x + 5, hy - 6, 2.6, 0, Math.PI * 2); c.arc(x + 9, hy - 7, 2.6, 0, Math.PI * 2); c.fill(); }
  }

  // ---------- 對外：開啟一次外出 ----------
  var current = null;
  function open(container, opts) {
    if (current) current.destroy();
    var spots = (window.PriTestJikanData || {}).SPOT_BY_ID || {};
    var slot = opts.slot || 0;
    var steps = opts.steps || 40, maxSteps = steps;
    var pos = (opts.pos && walkable(opts.pos[0], opts.pos[1])) ? opts.pos.slice() : HOME.slice();
    var visited = {};
    var dead = false;

    container.innerHTML = "";
    var wrap = document.createElement("div"); wrap.className = "jk-map";
    var cv = document.createElement("canvas"); cv.className = "jk-map-canvas";
    cv.setAttribute("role", "img"); cv.setAttribute("aria-label", "街道圖：點擊地面移動，走進店家或碰到路上的女孩就會發生邂逅");
    var hud = document.createElement("div"); hud.className = "jk-map-hud";
    var pad = document.createElement("div"); pad.className = "jk-map-pad";
    pad.innerHTML = '<button type="button" data-d="0,-1" aria-label="上">▲</button><button type="button" data-d="-1,0" aria-label="左">◀</button>' +
      '<button type="button" data-d="1,0" aria-label="右">▶</button><button type="button" data-d="0,1" aria-label="下">▼</button>';
    var homeBtn = document.createElement("button"); homeBtn.type = "button"; homeBtn.className = "jk-map-home";
    wrap.appendChild(cv); wrap.appendChild(hud);
    container.appendChild(wrap);
    var ctrl = document.createElement("div"); ctrl.className = "jk-map-ctrl";
    ctrl.appendChild(pad); ctrl.appendChild(homeBtn);
    container.appendChild(ctrl);
    var ctx = cv.getContext("2d");

    var dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    var cssW = 0, cssH = 0, scale = 1;
    function resize() {
      cssW = Math.max(240, wrap.clientWidth || 360);
      cssH = Math.round(Math.min(cssW * 0.92, Math.max(260, window.innerHeight * 0.58)));
      cv.style.height = cssH + "px";
      cv.width = Math.round(cssW * dpr); cv.height = Math.round(cssH * dpr);
      scale = cssW / (VIEW_TILES * T);
    }
    resize();
    if (!baseCache) baseCache = buildBase(dpr * scale > 1.25 ? 2 : 1);
    if (!lightCache) lightCache = buildLights();
    var baseScale = baseCache.width / (W * T);

    // 路上的女孩
    var rnd = Math.random;
    var npcs = [];
    function freeTile(near, minDist) {
      for (var tries = 0; tries < 400; tries++) {
        var x, y;
        if (near) { x = near.x0 + Math.floor(rnd() * (near.x1 - near.x0 + 1)); y = near.y0 + Math.floor(rnd() * (near.y1 - near.y0 + 1)); }
        else { x = Math.floor(rnd() * W); y = Math.floor(rnd() * H); }
        var t = tileAt(x, y);
        if (!WALK[t] || t === "D" || zone[x + "," + y]) continue;
        if (Math.abs(x - pos[0]) + Math.abs(y - pos[1]) < minDist) continue;
        if (npcs.some(function (n) { return n.x === x && n.y === y; })) continue;
        return [x, y];
      }
      return null;
    }
    var nStation = 2, nTown = slot === 2 ? 2 : 3;
    var i;
    for (i = 0; i < nStation + nTown; i++) {
      var st = i < nStation;
      var p = freeTile(st ? STATION_AREA : null, 5);
      if (!p) continue;
      npcs.push({ x: p[0], y: p[1], px: p[0], py: p[1], from: null, t0: 0, fresh: st, home: p.slice(), dir: "s",
        hair: HAIRS[Math.floor(rnd() * HAIRS.length)], body: DRESS[Math.floor(rnd() * DRESS.length)],
        bow: rnd() < 0.5 ? ["#ff5e93", "#ffffff", "#7457e8", "#ffd166"][Math.floor(rnd() * 4)] : null, next: 400 + rnd() * 900 });
    }

    var player = { x: pos[0], y: pos[1], from: null, t0: 0, dir: "s", path: [] };
    var cam = { x: 0, y: 0 };
    function camTarget() {
      var vw = cssW / scale, vh = cssH / scale;
      var px = player.rx * T + T / 2, py = player.ry * T + T / 2;
      return { x: Math.max(0, Math.min(W * T - vw, px - vw / 2)), y: Math.max(0, Math.min(H * T - vh, py - vh / 2)) };
    }
    player.rx = player.x; player.ry = player.y;
    var ct = camTarget(); cam.x = ct.x; cam.y = ct.y;
    var target = null;

    function updHud() {
      var stName = ["白天", "傍晚", "夜晚"][slot];
      hud.innerHTML = '<span class="jk-map-chip">' + ["☀️", "🌇", "🌙"][slot] + " " + stName + '</span><span class="jk-map-chip">🚶 剩 <b>' + steps + "</b> / " + maxSteps + " 步</span>";
      homeBtn.textContent = steps === maxSteps ? "← 不出門了（返回）" : "🏠 回家（結束這個時段）";
    }
    updHud();

    function emit(ev) {
      if (dead || !opts.onEvent) return false;
      return !!opts.onEvent(ev);
    }
    function npcSpot(n) {
      if (inStation(n.x, n.y)) return spots.station || null;
      var best = null, bd = 6;
      Object.keys(zone).forEach(function (k) {
        var id = zone[k]; if (!id) return;
        var xy = k.split(","), d = Math.abs(+xy[0] - n.x) + Math.abs(+xy[1] - n.y);
        if (d < bd) { bd = d; best = id; }
      });
      return best ? spots[best] || null : null;
    }
    function checkNpc() {
      for (var j = 0; j < npcs.length; j++) {
        var n = npcs[j];
        if (Math.abs(n.x - player.x) + Math.abs(n.y - player.y) <= 1) {
          player.path = []; target = null;
          return emit({ type: "npc", npc: { fresh: n.fresh }, spot: npcSpot(n) });
        }
      }
      return false;
    }
    function arrive() {
      steps--;
      if (opts.onMove) opts.onMove([player.x, player.y], steps);
      updHud();
      if (checkNpc()) return;
      var id = zone[player.x + "," + player.y];
      if (id && !visited[id]) {
        visited[id] = true;
        if (emit({ type: "spot", spot: spots[id] || { id: id, name: id } })) return;
      }
      if (steps <= 0) { player.path = []; emit({ type: "out" }); }
    }
    function stepTo(nx, ny, now) {
      if (!walkable(nx, ny)) return false;
      if (npcs.some(function (n) { return n.x === nx && n.y === ny; })) { checkNpcAt(nx, ny); return false; }
      player.dir = nx > player.x ? "e" : nx < player.x ? "w" : ny > player.y ? "s" : "n";
      player.from = [player.x, player.y]; player.t0 = now; player.x = nx; player.y = ny;
      return true;
    }
    function checkNpcAt() { checkNpc(); }
    function goTo(tx, ty) {
      var npcHit = null;
      npcs.forEach(function (n) { if (n.x === tx && n.y === ty) npcHit = n; });
      var b = bAt[tx + "," + ty];
      if (b && b.doors.length) {
        var best = null;
        b.doors.forEach(function (d) { var pth = bfs(player.x, player.y, d[0], d[1]); if (pth && (!best || pth.length < best.length)) best = pth; });
        if (best) { player.path = best; target = best.length ? best[best.length - 1] : null; }
        return;
      }
      if (!walkable(tx, ty)) return;
      var block = {};
      npcs.forEach(function (n) { if (n !== npcHit) block[n.x + "," + n.y] = 1; });
      var pth = bfs(player.x, player.y, tx, ty, block);
      if (!pth) return;
      if (npcHit) pth.pop();   // 走到她旁邊
      player.path = pth; target = [tx, ty];
      if (!pth.length && npcHit) checkNpc();
    }

    // 輸入
    function onPointer(e) {
      if (dead) return;
      var r = cv.getBoundingClientRect();
      var wx = (e.clientX - r.left) / scale + cam.x, wy = (e.clientY - r.top) / scale + cam.y;
      goTo(Math.floor(wx / T), Math.floor(wy / T));
      e.preventDefault();
    }
    cv.addEventListener("pointerdown", onPointer);
    function dirStep(dx, dy) {
      if (dead) return;
      player.path = [[player.x + dx, player.y + dy]]; target = null;
      if (!walkable(player.x + dx, player.y + dy)) { player.path = []; player.dir = dx > 0 ? "e" : dx < 0 ? "w" : dy > 0 ? "s" : "n"; }
    }
    pad.addEventListener("click", function (e) {
      var bt = e.target.closest ? e.target.closest("button") : e.target;
      if (!bt || !bt.getAttribute("data-d")) return;
      var d = bt.getAttribute("data-d").split(",");
      dirStep(+d[0], +d[1]);
    });
    function onKey(e) {
      if (dead) return;
      var tag = (e.target && e.target.tagName) || "";
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      var k = e.key, d = null;
      if (k === "ArrowUp" || k === "w" || k === "W") d = [0, -1];
      else if (k === "ArrowDown" || k === "s" || k === "S") d = [0, 1];
      else if (k === "ArrowLeft" || k === "a" || k === "A") d = [-1, 0];
      else if (k === "ArrowRight" || k === "d" || k === "D") d = [1, 0];
      if (!d) return;
      e.preventDefault();
      if (!player.from && !player.path.length) dirStep(d[0], d[1]);
      else player.path = [[player.x + d[0], player.y + d[1]]];
    }
    document.addEventListener("keydown", onKey);
    homeBtn.addEventListener("click", function () { if (!dead) emit({ type: "home", moved: steps < maxSteps }); });
    window.addEventListener("resize", resize);

    // 迴圈
    var train = { x: -999, row: 0, next: 1800, cars: 5, dir: 1, col: "#4a7fd0" };
    var raf = 0, last = 0;
    function frame(now) {
      if (dead) return;
      raf = requestAnimationFrame(frame);
      var dt = last ? Math.min(60, now - last) : 16; last = now;
      // 玩家移動
      if (player.from) {
        var k = (now - player.t0) / STEP_MS;
        if (k >= 1) { player.from = null; player.rx = player.x; player.ry = player.y; arrive(); if (dead) return; }
        else { player.rx = player.from[0] + (player.x - player.from[0]) * k; player.ry = player.from[1] + (player.y - player.from[1]) * k; }
      }
      if (!player.from && player.path.length && steps > 0) {
        var nx = player.path.shift();
        if (!stepTo(nx[0], nx[1], now)) { player.path = []; target = null; }
      }
      if (!player.from && !player.path.length) target = null;
      // 女孩們閒逛
      npcs.forEach(function (n) {
        if (n.from) {
          var kk = (now - n.t0) / (STEP_MS * 2.2);
          if (kk >= 1) { n.from = null; n.px = n.x; n.py = n.y; }
          else { n.px = n.from[0] + (n.x - n.from[0]) * kk; n.py = n.from[1] + (n.y - n.from[1]) * kk; }
          return;
        }
        n.next -= dt;
        if (n.next > 0) return;
        n.next = 500 + Math.random() * 1100;
        var dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        var d = dirs[Math.floor(Math.random() * 4)];
        var tx = n.x + d[0], ty = n.y + d[1], t = tileAt(tx, ty);
        if (!WALK[t] || t === "D" || zone[tx + "," + ty]) return;
        if (Math.abs(tx - n.home[0]) + Math.abs(ty - n.home[1]) > (n.fresh ? 7 : 5)) return;
        if (n.fresh && !inStation(tx, ty) && ty > 9) return;
        if ((tx === player.x && ty === player.y) || npcs.some(function (o) { return o !== n && o.x === tx && o.y === ty; })) return;
        n.dir = d[0] > 0 ? "e" : d[0] < 0 ? "w" : d[1] > 0 ? "s" : "n";
        n.from = [n.x, n.y]; n.t0 = now; n.x = tx; n.y = ty;
      });
      if (!player.from && !dead && npcs.some(function (n) { return !n.from && Math.abs(n.x - player.x) + Math.abs(n.y - player.y) <= 1; })) {
        if (checkNpc()) return;
      }
      // 電車
      train.next -= dt;
      if (train.next <= 0 && train.x < -900) { train.dir = Math.random() < 0.5 ? 1 : -1; train.row = train.dir > 0 ? 1 : 0; train.x = train.dir > 0 ? -train.cars * 3 * T : W * T; train.col = ["#4a7fd0", "#e2668a", "#27a36a", "#f0a030"][Math.floor(Math.random() * 4)]; }
      if (train.x > -900) {
        train.x += train.dir * dt * 0.35;
        if ((train.dir > 0 && train.x > W * T + 10) || (train.dir < 0 && train.x < -train.cars * 3 * T - 10)) { train.x = -999; train.next = 6000 + Math.random() * 7000; }
      }
      // 鏡頭
      var tg = camTarget();
      cam.x += (tg.x - cam.x) * Math.min(1, dt / 120); cam.y += (tg.y - cam.y) * Math.min(1, dt / 120);
      draw(now);
    }

    function draw(now) {
      var s = scale * dpr;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.fillStyle = "#2a1838"; ctx.fillRect(0, 0, cv.width, cv.height);
      var vw = cssW / scale, vh = cssH / scale;
      ctx.drawImage(baseCache, cam.x * baseScale, cam.y * baseScale, vw * baseScale, vh * baseScale, 0, 0, cv.width, cv.height);
      ctx.setTransform(s, 0, 0, s, -cam.x * s, -cam.y * s);
      // 水面閃光
      ctx.strokeStyle = "rgba(255,255,255,.45)"; ctx.lineWidth = 1.2;
      for (var wx = Math.floor(cam.x / 40) * 40; wx < cam.x + vw + 40; wx += 40) {
        var ph = (now / 900 + wx * 0.07) % (Math.PI * 2);
        ctx.globalAlpha = 0.25 + 0.25 * Math.sin(ph);
        ctx.beginPath(); ctx.moveTo(wx + Math.sin(ph) * 6, 20 * T + 30 + (wx % 3) * 7); ctx.lineTo(wx + 10 + Math.sin(ph) * 6, 20 * T + 30 + (wx % 3) * 7); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      drawTrain(ctx, now);
      // 目的地
      if (target) {
        var pr = 6 + Math.sin(now / 150) * 2;
        ctx.strokeStyle = "rgba(255,94,147,.9)"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(target[0] * T + T / 2, target[1] * T + T / 2, pr, 0, Math.PI * 2); ctx.stroke();
      }
      // 時段光影
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      if (slot === 1) {
        ctx.fillStyle = "rgba(255,128,60,.18)"; ctx.fillRect(0, 0, cv.width, cv.height);
        ctx.fillStyle = "rgba(110,50,140,.10)"; ctx.fillRect(0, 0, cv.width, cv.height);
      } else if (slot === 2) {
        ctx.fillStyle = "rgba(14,18,56,.6)"; ctx.fillRect(0, 0, cv.width, cv.height);
      }
      if (slot > 0) {
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = slot === 2 ? 0.95 : 0.35;
        ctx.drawImage(lightCache, cam.x, cam.y, vw, vh, 0, 0, cv.width, cv.height);
        ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
      }
      ctx.setTransform(s, 0, 0, s, -cam.x * s, -cam.y * s);
      // 招牌
      drawLabels(ctx, now);
      // 角色（畫在光影之上，夜裡也看得清楚）
      var ents = npcs.map(function (n) { return { n: n, y: n.py }; });
      ents.push({ p: true, y: player.ry });
      ents.sort(function (a, b) { return a.y - b.y; });
      ents.forEach(function (e) {
        if (e.p) {
          drawChar(ctx, player.rx * T + T / 2, player.ry * T + T / 2, { body: "#4a6fd1", hair: "#3a2c2a", dir: player.dir, t: now, moving: !!player.from });
          ctx.fillStyle = "#ffffff"; ctx.strokeStyle = "#4a6fd1"; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.moveTo(player.rx * T + T / 2, player.ry * T - 9); ctx.lineTo(player.rx * T + T / 2 - 4, player.ry * T - 15); ctx.lineTo(player.rx * T + T / 2 + 4, player.ry * T - 15); ctx.closePath(); ctx.fill(); ctx.stroke();
        } else {
          var n = e.n, cx = n.px * T + T / 2, cy = n.py * T + T / 2;
          if (n.fresh) glowSoft(ctx, cx, cy, now);
          drawChar(ctx, cx, cy, { body: n.body, hair: n.hair, girl: true, bow: n.bow, dir: n.dir, t: now + n.home[0] * 300, moving: !!n.from });
          var by = cy - 26 + Math.sin(now / 300 + n.home[0]) * 2;
          ctx.font = "12px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
          ctx.fillText(n.fresh ? "✨" : "💗", cx, by);
        }
      });
    }
    function glowSoft(c, x, y, now) {
      var a = 0.25 + 0.15 * Math.sin(now / 250);
      var g = c.createRadialGradient(x, y, 2, x, y, 20);
      g.addColorStop(0, "rgba(255,170,210," + a + ")"); g.addColorStop(1, "rgba(255,170,210,0)");
      c.fillStyle = g; c.fillRect(x - 20, y - 20, 40, 40);
    }
    function drawTrain(c) {
      if (train.x < -900) return;
      var y = train.row * T + 4, len = 3 * T - 4;
      for (var k = 0; k < train.cars; k++) {
        var x = train.x + k * 3 * T;
        c.fillStyle = "rgba(0,0,0,.25)"; rr(c, x + 3, y + 5, len, T - 8, 6); c.fill();
        c.fillStyle = "#eef2f7"; rr(c, x, y, len, T - 8, 6); c.fill();
        c.fillStyle = train.col; c.fillRect(x, y + T - 18, len, 4);
        c.fillStyle = slot === 2 ? "#ffe9a8" : "#9cc6e6";
        for (var wx = x + 8; wx < x + len - 8; wx += 12) c.fillRect(wx, y + 5, 8, 7);
        c.fillStyle = "rgba(0,0,0,.15)"; c.fillRect(x + len / 2 - 1, y, 2, T - 8);
      }
    }
    function drawLabels(c, now) {
      c.textAlign = "center"; c.textBaseline = "middle";
      BUILDINGS.forEach(function (b) {
        var sp = b.spot ? spots[b.spot] : null;
        var name = b.label || (sp ? sp.name : "");
        if (!name) return;
        var closed = sp && sp.open && sp.open.indexOf(slot) < 0;
        var done = sp && visited[sp.id];
        labelAt(c, (b.x + b.w / 2) * T, b.y * T + (b.h * T - (b.kind === "tower" ? T * 0.9 : T * 0.62)) / 2 + 2, (sp ? sp.ic + " " : (b.kind === "home" ? "🏠 " : "")) + name + (closed ? "・打烊" : ""), closed || done, b.id === "station");
      });
      [["night", 21.5, 16.6], ["river", 10.5, 18.6], ["park", 10.5, 23.2], ["river", 21.5, 23.4]].forEach(function (z) {
        var sp = spots[z[0]]; if (!sp) return;
        var closed = sp.open && sp.open.indexOf(slot) < 0;
        labelAt(c, z[1] * T, z[2] * T, sp.ic + " " + sp.name + (closed ? "・打烊" : ""), closed || visited[sp.id], false);
      });
      // 車站的提示
      var sx = 16 * T, sy = 4.2 * T + Math.sin(now / 260) * 2;
      c.font = "14px system-ui, sans-serif"; c.globalAlpha = 0.7 + 0.3 * Math.sin(now / 200);
      c.fillText("✨", sx - 26, sy); c.fillText("✨", sx + 26, sy - 3);
      c.globalAlpha = 1;
    }
    function labelAt(c, x, y, text, dim, big) {
      c.font = (big ? "bold 12px " : "bold 10px ") + '"PingFang TC","Noto Sans TC","Microsoft JhengHei",system-ui,sans-serif';
      var w = c.measureText(text).width + 12, h = big ? 18 : 15;
      c.globalAlpha = dim ? 0.55 : 0.95;
      c.fillStyle = big ? "rgba(42,24,56,.88)" : "rgba(255,255,255,.92)";
      rr(c, x - w / 2, y - h / 2, w, h, h / 2); c.fill();
      c.strokeStyle = big ? "rgba(255,170,210,.9)" : "rgba(232,69,124,.55)"; c.lineWidth = 1; c.stroke();
      c.fillStyle = big ? "#ffffff" : "#2a1b2e";
      c.fillText(text, x, y + 0.5);
      c.globalAlpha = 1;
    }

    raf = requestAnimationFrame(frame);
    var api = {
      destroy: function () {
        if (dead) return;
        dead = true; cancelAnimationFrame(raf);
        document.removeEventListener("keydown", onKey);
        window.removeEventListener("resize", resize);
        if (current === api) current = null;
      },
      // 測試用：查詢狀態、直接走到某格
      state: function () { return { pos: [player.x, player.y], steps: steps, npcs: npcs.map(function (n) { return { x: n.x, y: n.y, fresh: n.fresh }; }), visited: Object.keys(visited) }; },
      goTo: goTo
    };
    current = api;
    return api;
  }

  window.PriTestJikanMap = {
    open: open,
    HOME: HOME,
    W: W, H: H,
    tileAt: tileAt,
    walkable: walkable,
    doorsOf: function (spotId) { var out = []; Object.keys(zone).forEach(function (k) { if (zone[k] === spotId) out.push(k.split(",").map(Number)); }); return out; },
    current: function () { return current; }
  };
})();
