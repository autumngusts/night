// 鐵拳教育：搜打撤模式的美術（全部用程式畫 SVG，不需要外部圖檔；使用者指定 2026-10-26）。
//   tileBg(art)：地點的俯視插圖（data URI，給 CSS background-image 用；同一種只畫一次）
//   face(c, size)：學生頭像。特徵（年級領帶色、髮型、髮色、眼鏡、配件、社團徽章）和推理線索一一對應
// 插圖的 viewBox 都是 120×80，顏色固定（地圖是一張插畫，深色模式只在外框調暗）。
(function () {
  "use strict";

  function rect(x, y, w, h, fill, extra) { return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" fill="' + fill + '"' + (extra || "") + "/>"; }
  function circ(x, y, r, fill, extra) { return '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" fill="' + fill + '"' + (extra || "") + "/>"; }
  function line(x1, y1, x2, y2, stroke, w, extra) { return '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" stroke="' + stroke + '" stroke-width="' + (w || 1) + '"' + (extra || "") + "/>"; }
  function path(d, fill, extra) { return '<path d="' + d + '" fill="' + fill + '"' + (extra || "") + "/>"; }
  function rep(n, fn) { var s = ""; for (var i = 0; i < n; i++) s += fn(i); return s; }

  // 地板
  function wood(c1, c2) { return rect(0, 0, 120, 80, c1) + rep(8, function (i) { return line(0, i * 10 + 5, 120, i * 10 + 5, c2, 0.6); }); }
  function tiles(c1, c2, step) { step = step || 12; return rect(0, 0, 120, 80, c1) + rep(Math.ceil(120 / step), function (i) { return line(i * step, 0, i * step, 80, c2, 0.5); }) + rep(Math.ceil(80 / step), function (i) { return line(0, i * step, 120, i * step, c2, 0.5); }); }
  function grass(c1, c2) { return rect(0, 0, 120, 80, c1) + rep(26, function (i) { var x = (i * 37) % 118, y = (i * 23) % 76; return path("M" + x + " " + (y + 4) + "l2 -4l2 4", "none", ' stroke="' + c2 + '" stroke-width="0.8"'); }); }
  function desk(x, y) { return rect(x, y, 10, 7, "#c89b62", ' rx="1"') + rect(x + 2, y + 8, 6, 3, "#7b5a3a", ' rx="1"'); }
  function windowRow(y) { return rep(5, function (i) { return rect(6 + i * 23, y, 18, 4, "#bfe3f5", ' stroke="#8aa" stroke-width="0.5"'); }); }
  function tree(x, y, r) { return circ(x, y, r, "#3f8f4e") + circ(x - r * 0.35, y - r * 0.3, r * 0.55, "#56a862"); }
  function shelf(x, y, w, colors) { return rect(x, y, w, 6, "#8a6a48") + rep(Math.floor(w / 3), function (i) { return rect(x + 1 + i * 3, y + 1, 2, 4, colors[i % colors.length]); }); }

  var DRAW = {
    classroom: function () {
      var s = wood("#e8d2a8", "#d6bd8f") + rect(30, 3, 60, 8, "#2f5a44", ' rx="1"') + rect(50, 13, 20, 6, "#a8784a");
      for (var r = 0; r < 3; r++) for (var c = 0; c < 5; c++) s += desk(8 + c * 22, 26 + r * 17);
      return s;
    },
    hall: function () { return tiles("#e2ded4", "#cfc9bb", 16) + windowRow(2) + rect(0, 70, 120, 10, "#b8b2a2") + rep(4, function (i) { return rect(8 + i * 30, 72, 14, 6, "#8f7f6a", ' rx="1"'); }); },
    lobby: function () { return tiles("#ddd6c6", "#c4bba7", 20) + rep(6, function (i) { return rect(4 + i * 19, 6, 15, 30, "#9cb4c9", ' stroke="#6c8296" stroke-width="0.6"') + rep(4, function (j) { return line(4 + i * 19, 6 + j * 7.5, 19 + i * 19, 6 + j * 7.5, "#6c8296", 0.5); }); }) + rect(40, 55, 40, 20, "#b04a3a", ' rx="2"'); },
    stairs: function () { return rect(0, 0, 120, 80, "#cfc8b8") + rep(9, function (i) { return rect(20, 6 + i * 8, 80, 6, i % 2 ? "#bdb5a2" : "#d9d2c1") + line(20, 12 + i * 8, 100, 12 + i * 8, "#8f8774", 0.8); }) + line(18, 4, 18, 78, "#6b5a45", 2) + line(102, 4, 102, 78, "#6b5a45", 2); },
    wc: function () { return tiles("#d6e6ea", "#b6cbd0", 10) + rep(4, function (i) { return rect(4 + i * 29, 4, 25, 32, "#9fb7c2", ' stroke="#6d8791" stroke-width="0.8"') + circ(16 + i * 29, 22, 5, "#f4f7f8", ' stroke="#9ab" stroke-width="0.6"'); }) + rect(10, 56, 100, 10, "#eef3f4", ' stroke="#9ab" stroke-width="0.6"') + rep(3, function (i) { return circ(30 + i * 30, 61, 3, "#cde"); }); },
    office: function () { var s = wood("#d9c7a5", "#c5b08b"); for (var r = 0; r < 2; r++) for (var c = 0; c < 4; c++) s += rect(8 + c * 28, 12 + r * 32, 22, 14, "#9e8a6c", ' rx="1"') + rect(12 + c * 28, 14 + r * 32, 8, 6, "#f5f5f0") + rect(22 + c * 28, 15 + r * 32, 5, 4, "#3a3a3a"); return s + circ(110, 70, 6, "#4d8f55"); },
    nurse: function () { return tiles("#f3f1ec", "#e1ddd3", 14) + rep(3, function (i) { return rect(8 + i * 38, 10, 28, 44, "#ffffff", ' stroke="#bcc" stroke-width="0.8"') + rect(10 + i * 38, 12, 24, 8, "#cfe6f4") + rect(8 + i * 38, 38, 28, 16, "#a8d5c9"); }) + rect(50, 62, 20, 14, "#fff", ' stroke="#c33" stroke-width="0.8"') + rect(58, 64, 4, 10, "#d33") + rect(55, 67, 10, 4, "#d33"); },
    counsel: function () { return wood("#e6d5bb", "#d3bf9f") + rect(35, 25, 50, 30, "#b98f6a", ' rx="4"') + circ(30, 40, 7, "#7a9a6f") + circ(90, 40, 7, "#7a9a6f") + rect(52, 34, 16, 12, "#f6f0e2") + tree(108, 12, 7) + rect(8, 6, 20, 14, "#f4e2b8", ' stroke="#a88" stroke-width="0.5"'); },
    store: function () { return tiles("#efe6d2", "#d9cdb2", 15) + shelf(6, 8, 50, ["#e85d4a", "#f3c13a", "#4aa3df", "#7cc36b"]) + shelf(64, 8, 50, ["#f39c4a", "#9b59b6", "#e85d4a"]) + shelf(6, 24, 50, ["#3fb6a8", "#f3c13a"]) + rect(30, 52, 60, 14, "#c48a52", ' rx="2"') + rect(70, 54, 10, 8, "#333"); },
    archive: function () { return tiles("#d9d3c4", "#c2baa6", 12) + rep(4, function (i) { return rect(6, 6 + i * 18, 108, 12, "#8f8f86", ' stroke="#666" stroke-width="0.5"') + rep(9, function (j) { return rect(9 + j * 12, 8 + i * 18, 9, 8, ["#c9b98f", "#b7c9d6", "#d6b7b7"][(i + j) % 3]); }); }); },
    lab: function () { var s = tiles("#dfe7e4", "#c4d0cc", 14); for (var r = 0; r < 2; r++) for (var c = 0; c < 3; c++) s += rect(8 + c * 38, 14 + r * 32, 30, 16, "#3a4a55", ' rx="1"') + circ(16 + c * 38, 22 + r * 32, 2.5, "#7fd1e8") + rect(24 + c * 38, 18 + r * 32, 3, 8, "#e9f2f5"); return s + rect(40, 2, 40, 7, "#2f5a44"); },
    music: function () { return wood("#e4d0ad", "#cfb98f") + path("M10 10 h40 l10 18 h-50 z", "#222") + rep(7, function (i) { return rect(12 + i * 5, 26, 4, 3, "#fff"); }) + rep(3, function (r) { return rep(6, function (c) { return circ(20 + c * 16, 46 + r * 11, 3.5, "#9c7c58"); }); }) + rect(80, 6, 30, 16, "#fff", ' stroke="#555" stroke-width="0.5"') + rep(5, function (i) { return line(82, 9 + i * 3, 108, 9 + i * 3, "#555", 0.4); }); },
    library: function () { return wood("#e3cfa9", "#cfb98f") + shelf(4, 4, 112, ["#b03a2e", "#2e6db0", "#3f8f4e", "#d4a017", "#7b5cd6"]) + shelf(4, 14, 112, ["#2e6db0", "#d4a017", "#b03a2e", "#3f8f4e"]) + rep(2, function (i) { return rect(18 + i * 50, 38, 34, 16, "#a8784a", ' rx="2"') + rep(3, function (j) { return circ(24 + i * 50 + j * 11, 60, 3, "#6b5034"); }); }); },
    broadcast: function () { return rect(0, 0, 120, 80, "#4a4f5a") + rep(10, function (i) { return line(0, i * 8, 120, i * 8, "#555b67", 0.6); }) + rect(10, 30, 100, 22, "#2b2e35", ' rx="2"') + rep(12, function (i) { return rect(14 + i * 8, 34, 3, 12, "#888") + rect(14 + i * 8, 38 + (i * 7) % 8, 3, 3, ["#e74c3c", "#2ecc71", "#f1c40f"][i % 3]); }) + circ(60, 64, 5, "#ccc") + rect(59, 54, 2, 6, "#ccc") + circ(100, 12, 4, "#e74c3c"); },
    principal: function () { return rect(0, 0, 120, 80, "#6b2e2e") + rect(8, 8, 104, 64, "#8a3b3b", ' stroke="#c9a14a" stroke-width="1.5"') + rect(30, 18, 60, 22, "#4a2a18", ' rx="2"') + rect(52, 44, 16, 12, "#2a1a10", ' rx="3"') + rect(36, 22, 12, 8, "#f5f0e0") + circ(78, 26, 3, "#c9a14a") + rep(2, function (i) { return rect(14 + i * 82, 58, 10, 10, "#3d6b3d", ' rx="5"'); }); },
    artroom: function () { return wood("#eadbc0", "#d5c3a2") + rep(3, function (i) { return path("M" + (14 + i * 36) + " 60 l10 -40 l10 40", "none", ' stroke="#7b5a3a" stroke-width="2"') + rect(12 + i * 36, 20, 24, 20, "#fffdf6", ' stroke="#ccc" stroke-width="0.5"') + circ(20 + i * 36, 28, 4, ["#e85d4a", "#4aa3df", "#f3c13a"][i]) + circ(28 + i * 36, 33, 3, ["#7cc36b", "#9b59b6", "#e85d4a"][i]); }) + rep(6, function (i) { return circ(10 + i * 20, 72, 2, ["#e85d4a", "#4aa3df", "#f3c13a", "#7cc36b"][i % 4], ' opacity="0.7"'); }); },
    roof: function () { return tiles("#b9bcc0", "#a3a7ab", 20) + rect(0, 0, 120, 4, "#6c7177") + rect(0, 76, 120, 4, "#6c7177") + rep(13, function (i) { return line(i * 10, 0, i * 10, 4, "#9aa0a6", 1) + line(i * 10, 76, i * 10, 80, "#9aa0a6", 1); }) + path("M90 30 q8 -10 16 0", "none", ' stroke="#888" stroke-width="1"') + rect(20, 50, 8, 8, "#8a8f94"); },
    tank: function () { return tiles("#b9bcc0", "#a3a7ab", 20) + circ(60, 38, 26, "#9fb2be", ' stroke="#6d7f8a" stroke-width="2"') + circ(60, 38, 18, "#b6c6d0") + rep(4, function (i) { return rect(32 + i * 18, 62, 3, 14, "#6d7f8a"); }) + rect(0, 0, 120, 4, "#6c7177"); },
    escape: function () { return rect(0, 0, 120, 80, "#a9adb2") + rect(70, 0, 50, 80, "#7d8287") + rep(10, function (i) { return line(74, 4 + i * 8, 116, 4 + i * 8, "#4f5459", 2); }) + line(72, 0, 72, 80, "#c0392b", 2) + line(118, 0, 118, 80, "#c0392b", 2) + rect(10, 30, 40, 20, "#2ecc71", ' rx="2"') + path("M20 40 h18 l-5 -5 M38 40 l-5 5", "none", ' stroke="#fff" stroke-width="2"'); },
    gate: function () { return rect(0, 0, 120, 80, "#cfc6b4") + rect(0, 44, 120, 36, "#a7a09a") + rect(0, 0, 14, 80, "#8d8273") + rect(106, 0, 14, 80, "#8d8273") + rep(9, function (i) { return line(16 + i * 11, 30, 16 + i * 11, 50, "#555", 1.5); }) + line(14, 30, 106, 30, "#555", 2) + line(14, 50, 106, 50, "#555", 2) + tree(8, 12, 7) + tree(112, 12, 7); },
    garden: function () { return grass("#8bc77a", "#6ea85f") + path("M0 40 q60 -30 120 0 v6 q-60 -30 -120 0 z", "#e2d6b8") + circ(60, 40, 10, "#9fc6de", ' stroke="#ccc" stroke-width="2"') + tree(18, 16, 9) + tree(102, 18, 9) + tree(24, 66, 8) + tree(96, 64, 8); },
    field: function () { return rect(0, 0, 120, 80, "#cfae7f") + rep(10, function (i) { return circ((i * 47) % 116 + 2, (i * 29) % 76 + 2, 0.8, "#b89566"); }) + rect(10, 10, 100, 60, "none", ' stroke="#fff" stroke-width="1.2"') + line(60, 10, 60, 70, "#fff", 1) + circ(60, 40, 10, "none", ' stroke="#fff" stroke-width="1"'); },
    track: function () { return grass("#7bbf6a", "#62a453") + rect(0, 18, 120, 44, "#c75b3c") + rep(5, function (i) { return line(0, 22 + i * 9, 120, 22 + i * 9, "#f0e6dc", 0.8); }) + rect(100, 18, 3, 44, "#fff"); },
    court: function () { return rect(0, 0, 120, 80, "#2f7a9a") + rect(6, 6, 108, 68, "#d9824a") + rect(6, 6, 108, 68, "none", ' stroke="#fff" stroke-width="1.2"') + line(60, 6, 60, 74, "#fff", 1) + circ(60, 40, 9, "none", ' stroke="#fff" stroke-width="1"') + path("M6 22 h18 v36 h-18", "none", ' stroke="#fff" stroke-width="1"') + path("M114 22 h-18 v36 h18", "none", ' stroke="#fff" stroke-width="1"'); },
    bikes: function () { return rect(0, 0, 120, 80, "#b3aca0") + rect(0, 0, 120, 12, "#5e6f7a") + rep(6, function (i) { var x = 12 + i * 18; return circ(x, 34, 5, "none", ' stroke="#333" stroke-width="1.2"') + circ(x, 54, 5, "none", ' stroke="#333" stroke-width="1.2"') + line(x, 34, x, 54, ["#c0392b", "#2980b9", "#27ae60", "#8e44ad"][i % 4], 1.5); }); },
    flower: function () { return grass("#86c274", "#6aa65c") + rep(4, function (r) { return rep(10, function (c) { return circ(8 + c * 11, 10 + r * 9, 2.5, ["#e85d8a", "#f3c13a", "#ffffff", "#e8743a"][(r + c) % 4]); }); }) + rect(0, 46, 120, 3, "#8a6a48") + tree(100, 64, 10) + rect(10, 58, 30, 14, "#a08566"); },
    pool: function () { return tiles("#e9eef0", "#cfd8dc", 10) + rect(8, 8, 104, 64, "#4fb3d9", ' stroke="#2f8bb0" stroke-width="2"') + rep(5, function (i) { return line(8, 18 + i * 12, 112, 18 + i * 12, "#e9f6fb", 0.8, ' stroke-dasharray="4 3"'); }) + path("M20 30 q5 -3 10 0 t10 0", "none", ' stroke="#bde6f5" stroke-width="1"'); },
    locker: function () { return tiles("#d8d6cf", "#c2bfb5", 12) + rep(10, function (i) { return rect(4 + i * 11.2, 4, 10, 30, "#6f8fa8", ' stroke="#4f6b80" stroke-width="0.6"') + rect(11 + i * 11.2, 18, 1.5, 4, "#ddd"); }) + rect(20, 52, 80, 8, "#a8784a", ' rx="1"'); },
    club: function () { return wood("#dcc8a4", "#c7b08a") + rep(4, function (i) { return rect(4 + i * 29, 4, 26, 30, "#f4ecda", ' stroke="#a99a7f" stroke-width="0.8"') + circ(17 + i * 29, 16, 5, ["#e85d4a", "#4aa3df", "#f3c13a", "#7cc36b"][i]); }) + rect(10, 50, 100, 6, "#a8784a") + circ(30, 66, 6, "#d97a2b") + rect(70, 60, 20, 12, "#333", ' rx="2"'); },
    gym: function () { return wood("#e3bd82", "#cfa56a") + rect(4, 4, 112, 72, "none", ' stroke="#fff" stroke-width="1.4"') + line(60, 4, 60, 76, "#fff", 1) + circ(60, 40, 10, "none", ' stroke="#fff" stroke-width="1"') + rect(4, 28, 12, 24, "none", ' stroke="#c0392b" stroke-width="1"') + rect(104, 28, 12, 24, "none", ' stroke="#c0392b" stroke-width="1"') + rect(40, 0, 40, 4, "#7b2d26"); },
    storage: function () { return rect(0, 0, 120, 80, "#a99c86") + rep(6, function (i) { return line(0, i * 14, 120, i * 14, "#958871", 0.6); }) + rep(3, function (i) { return rect(8 + i * 14, 6, 12, 40, "#e8e0cf", ' stroke="#888" stroke-width="0.5"'); }) + circ(70, 20, 7, "#e8743a") + circ(86, 26, 6, "#fff", ' stroke="#c33" stroke-width="0.8"') + circ(100, 18, 6, "#2d6cb5") + rect(60, 50, 50, 22, "#3b5f8a", ' rx="2"') + rep(4, function (i) { return line(62, 54 + i * 5, 108, 54 + i * 5, "#2a4566", 0.8); }); },
    dojo: function () { return rect(0, 0, 120, 80, "#c7b07a") + rep(3, function (r) { return rep(4, function (c) { return rect(4 + c * 28, 4 + r * 24, 26, 22, (r + c) % 2 ? "#cdd38a" : "#c4cb7c", ' stroke="#8a8d4a" stroke-width="0.8"'); }); }) + rect(48, 30, 24, 20, "#f8f4ea") + rect(48, 38, 24, 3, "#222"); },
    back: function () { return rect(0, 0, 120, 80, "#9a9286") + rep(6, function (r) { return rep(7, function (c) { return rect(c * 18 + (r % 2) * 9, r * 7, 17, 6, "#8a7b6a", ' stroke="#776a5b" stroke-width="0.4"'); }); }) + rect(0, 42, 120, 38, "#7f8a6c") + rep(3, function (i) { return rect(14 + i * 34, 56, 14, 18, "#4a5560", ' rx="2"'); }) + circ(100, 62, 4, "#c9c3b5"); },
    alley: function () { return rect(0, 0, 120, 80, "#8b8478") + rect(0, 0, 18, 80, "#6d5f52") + rect(102, 0, 18, 80, "#6d5f52") + rep(10, function (i) { return line(18, i * 8, 102, i * 8 + 4, "#7c756b", 0.5); }) + rect(24, 10, 12, 16, "#3f4a52", ' rx="2"') + rect(80, 50, 14, 18, "#3f4a52", ' rx="2"') + circ(60, 40, 6, "#5e5850"); },
    oldgate: function () { return grass("#76a066", "#5c8a50") + path("M0 46 L120 34 L120 46 L0 58 z", "#b3a58d") + tree(16, 16, 10) + tree(50, 10, 8) + tree(96, 68, 11) + rect(98, 20, 4, 18, "#6b5034") + rect(92, 16, 16, 6, "#c9a14a"); },
    oldhall: function () { return wood("#7d6a55", "#6a5845") + rep(5, function (i) { return rect(6 + i * 23, 2, 18, 5, "#5c6f73", ' stroke="#3a4446" stroke-width="0.6"') + line(6 + i * 23, 2, 24 + i * 23, 7, "#3a4446", 0.6); }) + rep(6, function (i) { return path("M" + (10 + i * 19) + " " + (30 + (i * 13) % 30) + " l6 2 l-4 5", "none", ' stroke="#4f4234" stroke-width="0.8"'); }) + rect(0, 0, 120, 80, "#222", ' opacity="0.18"'); },
    oldroom: function () { var s = wood("#7a6550", "#685442"); for (var r = 0; r < 2; r++) for (var c = 0; c < 4; c++) s += '<g transform="rotate(' + ((r * 4 + c) * 23 % 40 - 20) + " " + (16 + c * 27) + " " + (30 + r * 26) + ')">' + desk(11 + c * 27, 26 + r * 26) + "</g>"; return s + rect(30, 2, 60, 7, "#3a4a40") + path("M95 60 l12 8 l-6 6 z", "#d8d0c0") + rect(0, 0, 120, 80, "#1c1c1c", ' opacity="0.22"'); },
    shrine: function () { return grass("#5f8f55", "#4c7a44") + path("M30 30 h60 M36 30 v40 M84 30 v40 M28 38 h64", "none", ' stroke="#b8342b" stroke-width="4"') + rect(50, 46, 20, 18, "#8a6a48") + path("M46 46 l14 -8 l14 8 z", "#5c4a36") + tree(10, 10, 9) + tree(110, 12, 9) + rect(0, 0, 120, 80, "#1c2a1c", ' opacity="0.15"'); },
    hill: function () { return grass("#6f9b5f", "#577f4a") + path("M0 70 C30 50 50 60 70 40 S110 20 120 14 L120 24 C100 34 90 44 74 54 S36 70 10 80 L0 80 z", "#bba985") + tree(20, 20, 11) + tree(56, 14, 9) + tree(98, 58, 12) + tree(30, 56, 7); }
  };

  var cache = {};
  function tileBg(art) {
    if (cache[art]) return cache[art];
    var body = (DRAW[art] || DRAW.hall)();
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 80" preserveAspectRatio="xMidYMid slice">' + body + "</svg>";
    cache[art] = 'url("data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg) + '")';
    return cache[art];
  }

  // ---------------- 學生頭像 ----------------
  var HAIR = { black: "#2a2422", brown: "#7a4a2a", blond: "#e8c25a" };
  var TIE = { 1: "#3f9b4f", 2: "#2f6fc0", 3: "#c0392b" };
  var CLUB_BADGE = { none: "", basket: "🏀", baseball: "⚾", band: "🎸", art: "🎨", kendo: "🗡️" };
  var SKIN = ["#f6d7b8", "#efc9a4", "#e3b48a", "#f9e0c8"];

  // c：{ grade, hair, color, glasses, acc, club, n }；mood 給臉的表情（"shy" "bright" "blunt" "calm" "angry"）
  function face(c, size, mood) {
    var hc = HAIR[c.color] || HAIR.black, skin = SKIN[(c.n || 0) % SKIN.length];
    var s = "";
    // 背後的長髮、馬尾
    if (c.hair === "long") s += path("M14 20 Q12 44 18 50 L46 50 Q52 44 50 20 Z", hc);
    if (c.hair === "pony") s += path("M46 22 Q58 26 54 44 Q50 36 46 30 Z", hc);
    // 制服與領帶
    s += path("M8 64 Q10 48 32 47 Q54 48 56 64 Z", "#28324a");
    s += path("M24 47 L32 56 L40 47 Z", "#f5f5f5");
    s += path("M30 52 L34 52 L35 62 L32 64 L29 62 Z", TIE[c.grade] || TIE[1]);
    // 臉
    s += rect(28, 38, 8, 8, skin);
    s += '<ellipse cx="32" cy="28" rx="15" ry="16" fill="' + skin + '"/>';
    // 頭髮（前面）
    if (c.hair === "short") s += path("M16 26 Q16 10 32 10 Q48 10 48 26 Q44 17 32 17 Q22 17 16 26 Z", hc);
    else if (c.hair === "long") s += path("M16 28 Q15 9 32 9 Q49 9 48 28 Q46 16 34 15 Q26 20 16 28 Z", hc);
    else if (c.hair === "pony") s += path("M16 26 Q16 10 32 10 Q48 10 48 26 Q42 15 32 15 Q22 15 16 26 Z", hc) + circ(47, 22, 2.2, "#c0392b");
    else if (c.hair === "buzz") s += path("M17 24 Q18 11 32 11 Q46 11 47 24 Q40 17 32 17 Q24 17 17 24 Z", hc, ' opacity="0.75"');
    else if (c.hair === "bob") s += path("M15 34 Q13 9 32 9 Q51 9 49 34 L45 34 Q46 18 32 17 Q18 18 19 34 Z", hc);
    else if (c.hair === "curly") s += rep(7, function (i) { return circ(18 + i * 4.7, 14 + Math.abs(3 - i) * 1.6, 5, hc); }) + circ(16, 22, 4, hc) + circ(48, 22, 4, hc);
    // 眼睛、眉毛、嘴
    var angry = mood === "angry";
    s += circ(26, 29, 1.8, "#222") + circ(38, 29, 1.8, "#222");
    s += angry ? line(22, 23, 29, 26, "#222", 1.5) + line(42, 23, 35, 26, "#222", 1.5) : line(23, 24, 29, 24, hc, 1.2) + line(35, 24, 41, 24, hc, 1.2);
    if (c.acc !== "mask") {
      if (angry) s += path("M27 38 Q32 35 37 38", "none", ' stroke="#7a3a2a" stroke-width="1.4"');
      else if (mood === "bright") s += path("M27 36 Q32 41 37 36", "none", ' stroke="#7a3a2a" stroke-width="1.4"');
      else if (mood === "shy") s += line(30, 37, 34, 37, "#7a3a2a", 1.2) + circ(23, 33, 2, "#f2a0a0", ' opacity="0.7"') + circ(41, 33, 2, "#f2a0a0", ' opacity="0.7"');
      else s += line(29, 37, 35, 37, "#7a3a2a", 1.3);
    }
    // 眼鏡
    if (c.glasses) s += circ(26, 29, 4.2, "none", ' stroke="#333" stroke-width="1.3"') + circ(38, 29, 4.2, "none", ' stroke="#333" stroke-width="1.3"') + line(30, 29, 34, 29, "#333", 1.2);
    // 配件
    if (c.acc === "pin") s += rect(38, 14, 8, 2.6, "#ff6fa8", ' rx="1.2" transform="rotate(-20 42 15)"');
    else if (c.acc === "earring") s += circ(17, 34, 1.8, "#f1c40f", ' stroke="#b8860b" stroke-width="0.6"');
    else if (c.acc === "phones") s += path("M12 46 Q12 54 22 54 M52 46 Q52 54 42 54", "none", ' stroke="#555" stroke-width="2"') + rect(9, 42, 6, 7, "#e74c3c", ' rx="2"') + rect(49, 42, 6, 7, "#e74c3c", ' rx="2"');
    else if (c.acc === "mask") s += path("M21 32 Q32 30 43 32 L42 40 Q32 44 22 40 Z", "#f4f6f8", ' stroke="#bcc" stroke-width="0.6"');
    else if (c.acc === "plaster") s += rect(37, 33, 7, 3, "#f0c98a", ' transform="rotate(-25 40 34)"') + rect(39, 31, 3, 7, "#f0c98a", ' transform="rotate(-25 40 34)"');
    // 社團徽章
    var badge = CLUB_BADGE[c.club];
    var b = badge ? '<circle cx="54" cy="56" r="8" fill="#fff" stroke="#999" stroke-width="0.8"/><text x="54" y="59.5" font-size="10" text-anchor="middle">' + badge + "</text>" : "";
    return '<svg class="fr-face" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="' + (size || 40) + '" height="' + (size || 40) + '" aria-hidden="true">' + s + b + "</svg>";
  }

  window.PriTestFistRaidArt = { tileBg: tileBg, face: face, ARTS: Object.keys(DRAW) };
})();
