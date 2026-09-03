// ============================================================================
// midnight（即時制擴張版・技術驗證片）地圖生成模組。
// ============================================================================
// 設計原則（見 docs/superpowers/plans... 不適用，這是全新專案，沒有既有規則文件）：
// 地圖不透過網路傳輸整張資料，只傳一個亂數種子（seed），每台裝置各自用同一個演算法
// 重新生成同一張地圖——只要種子與演算法一致，各裝置算出來的地圖保證逐格相同。
// 因此這裡的PRNG必須是「可種子化、決定性」的（跟一般的window.Math.random()不同，
// Math.random()無法指定種子，每次呼叫結果不可重現）。
(function () {
  "use strict";

  // mulberry32：輕量、決定性、品質足夠此用途的可種子化PRNG。輸入32位元整數種子，
  // 每次呼叫回傳[0,1)浮點數，同一種子＋同樣呼叫次數必定產生同樣序列。
  function mulberry32(seed) {
    var state = seed >>> 0;
    return function () {
      state = (state + 0x6d2b79f5) | 0;
      var t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  var GRID_SIZE = 48; // 48x48格
  var CELL_PX = 16; // 每格在canvas上的像素邊長（世界座標，非螢幕縮放後像素）
  var LANDMARK_COUNT = 6;

  function countWallNeighbors(grid, w, h, cx, cy) {
    var count = 0;
    for (var dy = -1; dy <= 1; dy++) {
      for (var dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        var x = cx + dx;
        var y = cy + dy;
        if (x < 0 || y < 0 || x >= w || y >= h) {
          count++; // 邊界外一律當成牆，確保地圖外圍封閉
          continue;
        }
        if (grid[y * w + x]) count++;
      }
    }
    return count;
  }

  // 標準的cellular automata洞窟生成：先隨機灑牆壁，再重複套用「鄰居牆多就變牆、
  // 鄰居牆少就變地板」規則使其平滑成自然的洞窟形狀。這是這個repo第一次需要「地形
  // 隨機生成」，沒有既有演算法可沿用，選用cellular automata是因為實作簡單、參數少、
  // 決定性容易保證（不依賴任何外部隨機庫）。
  function generateMap(seed) {
    var rand = mulberry32(seed);
    var w = GRID_SIZE;
    var h = GRID_SIZE;
    var grid = new Uint8Array(w * h); // 1=牆 0=地板
    for (var i = 0; i < grid.length; i++) {
      grid[i] = rand() < 0.45 ? 1 : 0;
    }
    for (var pass = 0; pass < 4; pass++) {
      var next = new Uint8Array(w * h);
      for (var y = 0; y < h; y++) {
        for (var x = 0; x < w; x++) {
          var idx = y * w + x;
          if (x === 0 || y === 0 || x === w - 1 || y === h - 1) {
            next[idx] = 1; // 地圖最外圍固定是牆
            continue;
          }
          var wallCount = countWallNeighbors(grid, w, h, x, y);
          if (wallCount >= 5) next[idx] = 1;
          else if (wallCount <= 2) next[idx] = 0;
          else next[idx] = grid[idx];
        }
      }
      grid = next;
    }
    var landmarks = placeLandmarks(grid, w, h, rand, LANDMARK_COUNT);
    return { seed: seed, width: w, height: h, cellPx: CELL_PX, grid: grid, landmarks: landmarks };
  }

  function placeLandmarks(grid, w, h, rand, count) {
    var out = [];
    var guard = 0;
    while (out.length < count && guard < 3000) {
      guard++;
      var x = Math.floor(rand() * w);
      var y = Math.floor(rand() * h);
      if (grid[y * w + x] === 0) out.push({ id: "lm" + out.length, x: x, y: y });
    }
    return out;
  }

  function isWalkable(map, x, y) {
    var gx = Math.floor(x);
    var gy = Math.floor(y);
    if (gx < 0 || gy < 0 || gx >= map.width || gy >= map.height) return false;
    return map.grid[gy * map.width + gx] === 0;
  }

  // 找一個可行走的隨機出生點（用同一個seed衍生的rand，各裝置算出相同結果，避免
  // 「大家都生成同一張地圖，但出生點卻各算各的」這種不一致）。
  function findWalkableSpawn(map, rand) {
    var guard = 0;
    while (guard < 5000) {
      guard++;
      var x = Math.floor(rand() * map.width);
      var y = Math.floor(rand() * map.height);
      if (isWalkable(map, x, y)) return { x: x + 0.5, y: y + 0.5 };
    }
    return { x: map.width / 2, y: map.height / 2 };
  }

  window.PriTestMidnightMap = {
    GRID_SIZE: GRID_SIZE,
    CELL_PX: CELL_PX,
    mulberry32: mulberry32,
    generateMap: generateMap,
    isWalkable: isWalkable,
    findWalkableSpawn: findWalkableSpawn,
  };
})();
