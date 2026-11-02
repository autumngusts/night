// 令和之野望（reiwa）：美術繪製模組 —— 東北地形勢力圖、城池 3D 模型、伐掠合戰場景。
// 純繪製，不改動 state；遊戲規則在 reiwa_core.js，互動在 reiwa.js。
// 地圖的海岸線／山脈／河川是依東北實際地形手繪的簡化輪廓，配合 reiwa_data.js 的示意城池座標微調過，
// 不是精確的地理資料。城池 3D 是自寫的小型正投影引擎（光照＋畫家演算法），不依賴外部函式庫。
(function () {
  "use strict";

  var NS = "http://www.w3.org/2000/svg";

  // ===================== 共用輔助 =====================

  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function f1(n) {
    return Math.round(n * 10) / 10;
  }

  function hexToRgb(hex) {
    var h = String(hex || "#888888").replace("#", "");
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function rgbStr(rgb, k) {
    var m = k === undefined ? 1 : k;
    return (
      "rgb(" +
      Math.max(0, Math.min(255, Math.round(rgb[0] * m))) +
      "," +
      Math.max(0, Math.min(255, Math.round(rgb[1] * m))) +
      "," +
      Math.max(0, Math.min(255, Math.round(rgb[2] * m))) +
      ")"
    );
  }

  // 以 Catmull-Rom 曲線通過所有點，轉成三次貝茲曲線（開放曲線；呼叫端負責 M / L 的接續）
  function smoothSegment(pts, startWithMove) {
    var n = pts.length;
    var d = (startWithMove ? "M" : "L") + f1(pts[0][0]) + "," + f1(pts[0][1]);
    for (var i = 0; i < n - 1; i++) {
      var p0 = pts[Math.max(0, i - 1)];
      var p1 = pts[i];
      var p2 = pts[i + 1];
      var p3 = pts[Math.min(n - 1, i + 2)];
      d +=
        "C" +
        f1(p1[0] + (p2[0] - p0[0]) / 6) +
        "," +
        f1(p1[1] + (p2[1] - p0[1]) / 6) +
        " " +
        f1(p2[0] - (p3[0] - p1[0]) / 6) +
        "," +
        f1(p2[1] - (p3[1] - p1[1]) / 6) +
        " " +
        f1(p2[0]) +
        "," +
        f1(p2[1]);
    }
    return d;
  }

  // 多段曲線接成一條路徑：段與段之間保留轉角（半島尖端、國境與海岸交會處）
  function pathFromSegments(segments, closed) {
    var d = "";
    segments.forEach(function (seg, idx) {
      if (seg.line) d += (idx === 0 ? "M" : "L") + f1(seg.line[0]) + "," + f1(seg.line[1]);
      else d += smoothSegment(seg, idx === 0);
    });
    return d + (closed ? "Z" : "");
  }

  function reverse(pts) {
    return pts.slice().reverse();
  }

  // 依字串產生固定的亂數種子（同一座城每次畫出來的樹木配置都一樣）
  function seededRandom(seedText) {
    var h = 2166136261;
    var s = String(seedText || "rw");
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul ? Math.imul(h, 16777619) : (h * 16777619) | 0;
    }
    var state = h >>> 0;
    return function () {
      state = (state + 0x6d2b79f5) >>> 0;
      var t = state;
      t = Math.imul ? Math.imul(t ^ (t >>> 15), t | 1) : (t ^ (t >>> 15)) * (t | 1);
      t ^= t + (Math.imul ? Math.imul(t ^ (t >>> 7), t | 61) : (t ^ (t >>> 7)) * (t | 61));
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function isCjk(text) {
    return /[　-鿿＀-￯]/.test(String(text));
  }

  // 直書文字：中日文逐字往下排；英文則整串旋轉 90 度
  function verticalText(x, y, text, size, cls) {
    var str = String(text);
    if (!isCjk(str)) {
      return (
        '<text class="' + cls + '" x="' + x + '" y="' + y + '" font-size="' + size + '" text-anchor="middle" transform="rotate(90 ' + x + " " + y + ')">' + esc(str) + "</text>"
      );
    }
    var chars = str.split("");
    var total = chars.length * size * 1.1;
    var out = "";
    chars.forEach(function (ch, i) {
      out +=
        '<text class="' + cls + '" x="' + x + '" y="' + f1(y - total / 2 + size * (i + 0.85) * 1.1) + '" font-size="' + size + '" text-anchor="middle">' + esc(ch) + "</text>";
    });
    return out;
  }

  // ===================== 東北勢力圖 =====================

  var MAP_VIEWBOX = { x: 0, y: -62, w: 360, h: 532 };

  // 日本海側海岸：念珠關（出羽／越後交界）往北到津輕半島龍飛崎
  var COAST_WEST = [
    [62, 295], [57, 279], [51, 260], [53, 240], [59, 222], [62, 206], [67, 192], [80, 176], [92, 160], [95, 147],
    [90, 136], [77, 132], [64, 126], [61, 115], [70, 106], [86, 103], [93, 90], [98, 72], [104, 52], [110, 34],
    [118, 16], [130, 0], [143, -15], [155, -30],
  ];
  // 龍飛崎 → 陸奧灣 → 下北半島（斧形）→ 太平洋側三陸海岸 → 牡鹿半島 → 仙台灣 → 磐城（常陸交界）
  var COAST_EAST = [
    [155, -30], [162, -24], [167, -12], [174, 0], [182, 6], [192, 7], [201, 3], [206, -6], [205, -16], [197, -24],
    [186, -29], [178, -37], [184, -45], [198, -48], [212, -52], [226, -56], [240, -54], [252, -48], [254, -36],
    [251, -20], [252, 0], [256, 22], [262, 42], [268, 58], [275, 74], [283, 92], [289, 112], [294, 132], [299, 152],
    [306, 172], [302, 189], [307, 205], [299, 219], [302, 236], [295, 250], [290, 258], [297, 272], [285, 278],
    [271, 282], [256, 285], [245, 292], [239, 305], [238, 320], [244, 336], [258, 346], [272, 357], [279, 378],
    [283, 400], [288, 420], [292, 446],
  ];
  // 東北南界（陸奧・出羽 與 常陸・下野・越後 的交界，示意）
  var SOUTH_BORDER = [
    [292, 446], [262, 452], [232, 456], [200, 459], [170, 456], [148, 443], [135, 421], [128, 396], [122, 369],
    [110, 343], [90, 318], [62, 295],
  ];
  var NIIGATA_COAST = [[62, 295], [56, 312], [44, 336], [30, 362], [14, 392], [-5, 420], [-30, 440]];
  var IBARAKI_COAST = [[292, 446], [294, 465], [298, 490], [305, 540]];
  var HOKKAIDO = [[-30, -90], [-30, -50], [12, -55], [48, -51], [82, -47], [108, -51], [128, -58], [142, -90]];

  // 山岳：[x, y, 大小]；大小 ≥ 1.3 的畫上山頂積雪
  var MOUNTAINS = [
    [128, 20, 1.5], // 岩木山
    [118, 60, 1.0], [108, 72, 0.8], // 白神山地
    [176, 44, 1.2], [188, 50, 0.9], // 八甲田
    [195, 96, 0.9], [186, 108, 0.8], [196, 120, 1.0], // 奧羽山脈北段
    [213, 126, 1.5], // 岩手山
    [190, 140, 0.9], [184, 168, 1.0], [178, 186, 0.8], [172, 214, 0.9],
    [172, 232, 1.2], // 栗駒山
    [180, 252, 0.8], [189, 268, 0.9], [186, 300, 0.8],
    [182, 322, 1.3], // 藏王
    [176, 340, 0.8], [186, 356, 1.1], // 吾妻山
    [176, 371, 1.3], // 磐梯山
    [94, 213, 1.6], // 鳥海山
    [96, 270, 1.2], [104, 284, 0.8], // 月山
    [100, 305, 1.0], [114, 322, 1.0], // 朝日・飯豐
    [138, 418, 0.9], [160, 434, 0.8], // 那須連峰
    [270, 164, 0.8], [266, 188, 1.0], [275, 210, 0.8], [256, 214, 0.7], // 北上高地
    [242, 392, 0.9], [244, 424, 0.8], [232, 438, 0.6], // 阿武隈高地
    [228, 92, 0.7], [208, 76, 0.7],
  ];

  var RIVERS = [
    // 北上川
    [[232, 98], [229, 128], [225, 165], [221, 200], [219, 230], [230, 254], [248, 268], [262, 282]],
    // 最上川
    [[150, 342], [141, 322], [146, 292], [131, 268], [114, 258], [94, 250], [74, 243], [55, 240]],
    // 雄物川
    [[142, 216], [128, 190], [118, 166], [101, 150], [93, 146]],
    // 米代川
    [[168, 86], [148, 94], [118, 96], [92, 96]],
    // 岩木川
    [[136, 44], [150, 36], [149, 16], [141, 0], [134, -4]],
    // 阿武隈川
    [[197, 440], [207, 416], [217, 386], [225, 356], [232, 336], [240, 324]],
    // 阿賀野川（流向越後）
    [[164, 398], [140, 394], [112, 381], [82, 366], [44, 347]],
    // 馬淵川
    [[244, 104], [252, 82], [262, 60]],
  ];

  var LAKES = [
    { cx: 183, cy: 77, rx: 7, ry: 6 }, // 十和田湖
    { cx: 168, cy: 140, rx: 3.5, ry: 3.5 }, // 田澤湖
    { cx: 187, cy: 396, rx: 9, ry: 6 }, // 豬苗代湖
    { cx: 91, cy: 112, rx: 4, ry: 7 }, // 八郎潟
  ];

  var ISLANDS = [
    [[34, 222], [38, 219], [41, 223], [37, 226]], // 飛島
    [[301, 280], [305, 277], [307, 282], [303, 285]], // 金華山
  ];

  // Voronoi：以半平面裁切求每座城的領地（邊附帶「是和哪一座城的分界」標記，用來畫勢力國境）
  function clipHalfPlane(poly, a, b, c, label) {
    var out = [];
    var n = poly.length;
    for (var i = 0; i < n; i++) {
      var P = poly[i];
      var Q = poly[(i + 1) % n];
      var pv = a * P.x + b * P.y - c;
      var qv = a * Q.x + b * Q.y - c;
      var pIn = pv <= 1e-9;
      var qIn = qv <= 1e-9;
      if (pIn) {
        out.push({ x: P.x, y: P.y, lab: P.lab });
        if (!qIn) {
          var t = pv / (pv - qv);
          out.push({ x: P.x + (Q.x - P.x) * t, y: P.y + (Q.y - P.y) * t, lab: label });
        }
      } else if (qIn) {
        var t2 = pv / (pv - qv);
        out.push({ x: P.x + (Q.x - P.x) * t2, y: P.y + (Q.y - P.y) * t2, lab: P.lab });
      }
    }
    return out;
  }

  function voronoiCells(sites) {
    var box = [
      { x: -60, y: -120, lab: -1 },
      { x: 420, y: -120, lab: -1 },
      { x: 420, y: 560, lab: -1 },
      { x: -60, y: 560, lab: -1 },
    ];
    return sites.map(function (s, i) {
      var poly = box.map(function (p) {
        return { x: p.x, y: p.y, lab: p.lab };
      });
      sites.forEach(function (o, j) {
        if (i === j || poly.length === 0) return;
        var a = o.x - s.x;
        var b = o.y - s.y;
        var c = (o.x * o.x + o.y * o.y - s.x * s.x - s.y * s.y) / 2;
        poly = clipHalfPlane(poly, a, b, c, j);
      });
      return poly;
    });
  }

  var mapGeoCache = null;

  function mapGeometry(D) {
    if (mapGeoCache) return mapGeoCache;
    var tohoku = pathFromSegments([COAST_WEST, COAST_EAST, SOUTH_BORDER], true);
    var outside = pathFromSegments(
      [NIIGATA_COAST, { line: [-30, 540] }, { line: [305, 540] }, reverse(IBARAKI_COAST), SOUTH_BORDER],
      true
    );
    var sites = D.NODES.map(function (n) {
      return { x: n.x, y: n.y };
    });
    var cells = voronoiCells(sites);
    var cellPaths = cells.map(function (poly) {
      return poly.length
        ? "M" +
            poly
              .map(function (p) {
                return f1(p.x) + "," + f1(p.y);
              })
              .join("L") +
            "Z"
        : "";
    });
    var borders = [];
    cells.forEach(function (poly, i) {
      for (var k = 0; k < poly.length; k++) {
        var j = poly[k].lab;
        if (j > i) {
          var q = poly[(k + 1) % poly.length];
          borders.push({ i: i, j: j, d: "M" + f1(poly[k].x) + "," + f1(poly[k].y) + "L" + f1(q.x) + "," + f1(q.y) });
        }
      }
    });
    mapGeoCache = {
      tohoku: tohoku,
      outside: outside,
      hokkaido: pathFromSegments([HOKKAIDO], true),
      border: pathFromSegments([SOUTH_BORDER], false),
      cellPaths: cellPaths,
      borders: borders,
      rivers: RIVERS.map(function (r) {
        return smoothSegment(r, true);
      }),
      islands: ISLANDS.map(function (pts) {
        return pathFromSegments([pts.concat([pts[0]])], true);
      }),
    };
    return mapGeoCache;
  }

  function mountainGlyph(x, y, s) {
    var w = 6.5 * s;
    var h = 7.5 * s;
    var base =
      "M" + f1(x - w) + "," + f1(y) +
      "Q" + f1(x - w * 0.45) + "," + f1(y - h * 0.55) + " " + f1(x) + "," + f1(y - h) +
      "Q" + f1(x + w * 0.45) + "," + f1(y - h * 0.55) + " " + f1(x + w) + "," + f1(y) + "Z";
    var shadeD =
      "M" + f1(x) + "," + f1(y - h) +
      "Q" + f1(x + w * 0.45) + "," + f1(y - h * 0.55) + " " + f1(x + w) + "," + f1(y) +
      "L" + f1(x + w * 0.15) + "," + f1(y) +
      "Q" + f1(x + w * 0.2) + "," + f1(y - h * 0.5) + " " + f1(x) + "," + f1(y - h) + "Z";
    var out = '<path class="rw-map-mtn" d="' + base + '"/><path class="rw-map-mtn-shade" d="' + shadeD + '"/>';
    if (s >= 1.3) {
      out +=
        '<path class="rw-map-mtn-snow" d="M' + f1(x - w * 0.24) + "," + f1(y - h * 0.68) +
        "L" + f1(x) + "," + f1(y - h) +
        "L" + f1(x + w * 0.26) + "," + f1(y - h * 0.66) +
        "L" + f1(x + w * 0.08) + "," + f1(y - h * 0.72) +
        "L" + f1(x - w * 0.08) + "," + f1(y - h * 0.64) + 'Z"/>';
    }
    return out;
  }

  function seigaihaPattern(id) {
    function ring(cx, cy) {
      return (
        '<circle cx="' + cx + '" cy="' + cy + '" r="10" class="rw-map-wave-fill"/>' +
        '<circle cx="' + cx + '" cy="' + cy + '" r="10" class="rw-map-wave-line"/>' +
        '<circle cx="' + cx + '" cy="' + cy + '" r="7" class="rw-map-wave-line"/>' +
        '<circle cx="' + cx + '" cy="' + cy + '" r="4" class="rw-map-wave-line"/>'
      );
    }
    return (
      '<pattern id="' + id + '" width="20" height="10" patternUnits="userSpaceOnUse">' +
      ring(10, 0) + ring(0, 5) + ring(20, 5) + ring(10, 10) +
      "</pattern>"
    );
  }

  // 地圖上的城池圖示：本城三層天守、一般城兩層，腳下是勢力色的領地圓盤與旗印
  function mapCastleGlyph(capital) {
    var g =
      '<path class="rw-g-stone" d="M-6.5,3 L6.5,3 L5,-0.6 L-5,-0.6Z"/>' +
      '<rect class="rw-g-wall" x="-4.2" y="-4.2" width="8.4" height="3.8"/>' +
      '<rect class="rw-g-win" x="-2.9" y="-3" width="1.3" height="1.1"/><rect class="rw-g-win" x="-0.65" y="-3" width="1.3" height="1.1"/><rect class="rw-g-win" x="1.6" y="-3" width="1.3" height="1.1"/>' +
      '<path class="rw-g-roof" d="M-6.4,-3.8 Q0,-5.4 6.4,-3.8 L4,-6.8 L-4,-6.8Z"/>' +
      '<rect class="rw-g-wall" x="-2.6" y="-9.2" width="5.2" height="2.6"/>' +
      '<path class="rw-g-roof" d="M-4.2,-8.8 Q0,-10 4.2,-8.8 L1.8,-11.8 L-1.8,-11.8Z"/>';
    if (capital) {
      g +=
        '<rect class="rw-g-wall" x="-1.5" y="-13.6" width="3" height="2.1"/>' +
        '<path class="rw-g-roof" d="M-2.7,-13.2 Q0,-14.2 2.7,-13.2 L1,-15.8 L-1,-15.8Z"/>' +
        '<circle class="rw-g-gold" cx="-1.1" cy="-16" r="0.55"/><circle class="rw-g-gold" cx="1.1" cy="-16" r="0.55"/>';
    } else {
      g += '<circle class="rw-g-gold" cx="-1.9" cy="-12" r="0.45"/><circle class="rw-g-gold" cx="1.9" cy="-12" r="0.45"/>';
    }
    return g;
  }

  // opts：{ state, selected, playerFaction, targets: {nodeId:true}, nodeName(id), factionColor(fid), labels, onSelect(id) }
  function renderMap(opts) {
    var D = window.PriTestReiwaData;
    var geo = mapGeometry(D);
    var st = opts.state;
    var lb = opts.labels || {};
    var vb = MAP_VIEWBOX;
    var s = [];

    s.push("<defs>");
    s.push(seigaihaPattern("rw-map-wave"));
    s.push(
      '<linearGradient id="rw-map-landgrad" x1="0" y1="0" x2="0.35" y2="1">' +
        '<stop offset="0" class="rw-map-land-s1"/><stop offset="0.55" class="rw-map-land-s2"/><stop offset="1" class="rw-map-land-s3"/></linearGradient>'
    );
    s.push(
      '<radialGradient id="rw-map-vig" cx="0.5" cy="0.45" r="0.75"><stop offset="0.55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#0b1a24" stop-opacity="0.35"/></radialGradient>'
    );
    s.push('<clipPath id="rw-map-clip"><path d="' + geo.tohoku + '"/></clipPath>');
    s.push(
      '<filter id="rw-map-grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="7"/>' +
        '<feColorMatrix type="matrix" values="0 0 0 0 0.36  0 0 0 0 0.26  0 0 0 0 0.12  0 0 0 0.32 0"/></filter>'
    );
    s.push('<filter id="rw-map-shadow" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="0.6" dy="1" stdDeviation="0.7" flood-color="#1b130a" flood-opacity="0.5"/></filter>');
    s.push("</defs>");

    // 海
    s.push('<rect class="rw-map-sea" x="' + vb.x + '" y="' + vb.y + '" width="' + vb.w + '" height="' + vb.h + '"/>');
    s.push('<rect fill="url(#rw-map-wave)" opacity="0.55" x="' + vb.x + '" y="' + vb.y + '" width="' + vb.w + '" height="' + vb.h + '"/>');

    // 淺灘光暈 → 境外陸地 → 東北本土
    [geo.tohoku, geo.outside, geo.hokkaido].forEach(function (d) {
      s.push('<path class="rw-map-shallow" d="' + d + '"/>');
    });
    s.push('<path class="rw-map-land-out" d="' + geo.outside + '"/>');
    s.push('<path class="rw-map-land-out" d="' + geo.hokkaido + '"/>');
    geo.islands.forEach(function (d) {
      s.push('<path class="rw-map-shallow rw-map-shallow-thin" d="' + d + '"/><path class="rw-map-island" d="' + d + '"/>');
    });
    s.push('<path fill="url(#rw-map-landgrad)" d="' + geo.tohoku + '"/>');
    s.push('<rect clip-path="url(#rw-map-clip)" filter="url(#rw-map-grain)" x="0" y="-62" width="320" height="530" opacity="0.9"/>');

    // 領地（Voronoi，依城主著色）
    s.push('<g clip-path="url(#rw-map-clip)">');
    D.NODES.forEach(function (nd, i) {
      var owner = st.nodes[nd.id].owner;
      var cls = "rw-map-terr" + (owner === opts.playerFaction ? " rw-map-terr-mine" : "");
      s.push('<path class="' + cls + '" fill="' + esc(opts.factionColor(owner)) + '" d="' + geo.cellPaths[i] + '"/>');
    });
    s.push("</g>");

    // 令制國名（大字淡墨）
    s.push('<text class="rw-map-province" x="122" y="232" text-anchor="middle">' + esc(lb.dewa || "") + "</text>");
    s.push('<text class="rw-map-province" x="248" y="206" text-anchor="middle">' + esc(lb.mutsu || "") + "</text>");
    s.push('<text class="rw-map-region-out" x="54" y="392" text-anchor="middle">' + esc(lb.echigo || "") + "</text>");

    // 河川、湖泊
    geo.rivers.forEach(function (d) {
      s.push('<path class="rw-map-river" d="' + d + '"/><path class="rw-map-river-hi" d="' + d + '"/>');
    });
    LAKES.forEach(function (lk) {
      s.push('<ellipse class="rw-map-lake" cx="' + lk.cx + '" cy="' + lk.cy + '" rx="' + lk.rx + '" ry="' + lk.ry + '"/>');
    });

    // 山岳（由後往前畫，前面的山會壓住後面的）
    MOUNTAINS.slice()
      .sort(function (a, b) {
        return a[1] - b[1];
      })
      .forEach(function (m) {
        s.push(mountainGlyph(m[0], m[1], m[2]));
      });

    // 海岸線、東北南界
    s.push('<path class="rw-map-coast" d="' + geo.tohoku + '"/>');
    s.push('<path class="rw-map-coast rw-map-coast-out" d="' + geo.outside + '"/>');
    s.push('<path class="rw-map-coast rw-map-coast-out" d="' + geo.hokkaido + '"/>');
    s.push('<path class="rw-map-region-border" d="' + geo.border + '"/>');

    // 郡界（同勢力淡）與勢力國境（不同勢力濃）
    s.push('<g clip-path="url(#rw-map-clip)">');
    geo.borders.forEach(function (b) {
      var oa = st.nodes[D.NODES[b.i].id].owner;
      var ob = st.nodes[D.NODES[b.j].id].owner;
      if (oa === ob) s.push('<path class="rw-map-gun-border" d="' + b.d + '"/>');
    });
    geo.borders.forEach(function (b) {
      var oa = st.nodes[D.NODES[b.i].id].owner;
      var ob = st.nodes[D.NODES[b.j].id].owner;
      if (oa !== ob) s.push('<path class="rw-map-fac-border-glow" d="' + b.d + '"/><path class="rw-map-fac-border" d="' + b.d + '"/>');
    });
    s.push("</g>");

    // 街道
    D.EDGES.forEach(function (e) {
      var a = D.nodeById(e[0]);
      var b = D.nodeById(e[1]);
      var hot = opts.selected && (e[0] === opts.selected || e[1] === opts.selected);
      var d = "M" + a.x + "," + a.y + "L" + b.x + "," + b.y;
      s.push('<path class="rw-map-road-under' + (hot ? " rw-map-road-hot-under" : "") + '" d="' + d + '"/>');
      s.push('<path class="rw-map-road' + (hot ? " rw-map-road-hot" : "") + '" d="' + d + '"/>');
    });

    // 海名、羅盤、標題框
    s.push(verticalText(34, 165, lb.seaJapan || "", 11, "rw-map-sea-label"));
    s.push(verticalText(336, 300, lb.seaPacific || "", 11, "rw-map-sea-label"));
    s.push('<text class="rw-map-sea-label rw-map-sea-small" x="104" y="-30" text-anchor="middle">' + esc(lb.strait || "") + "</text>");
    s.push('<text class="rw-map-sea-label rw-map-sea-tiny" x="188" y="-9" text-anchor="middle">' + esc(lb.mutsuBay || "") + "</text>");
    s.push(compassRose(318, -22, 15, lb.north || "N"));
    s.push(
      '<g class="rw-map-cartouche"><rect x="11" y="-44" width="34" height="88" rx="2" class="rw-map-cart-box"/><rect x="14" y="-41" width="28" height="82" rx="1" class="rw-map-cart-inner"/>' +
        verticalText(28, 0, lb.cartouche || "", 10, "rw-map-cart-text") +
        "</g>"
    );

    // 城池
    var nodeList = D.NODES.slice().sort(function (a, b) {
      return a.y - b.y;
    });
    nodeList.forEach(function (nd) {
      var node = st.nodes[nd.id];
      var color = opts.factionColor(node.owner);
      var capital = nd.profile === "capital";
      var mine = node.owner === opts.playerFaction;
      var sel = nd.id === opts.selected;
      var target = opts.targets && opts.targets[nd.id];
      var name = opts.nodeName(nd.id);
      var cls = "rw-mnode" + (mine ? " rw-mnode-mine" : "") + (sel ? " rw-mnode-sel" : "") + (target ? " rw-mnode-target" : "");
      var sc = capital ? 1.18 : 1;
      var labelW = isCjk(name) ? name.length * 6.5 + 6 : name.length * 3.5 + 6;
      var g = '<g class="' + cls + '" data-node="' + nd.id + '" transform="translate(' + nd.x + "," + nd.y + ')">';
      g += "<title>" + esc(name + "（" + (opts.factionName ? opts.factionName(node.owner) : node.owner) + "）") + "</title>";
      g += '<circle class="rw-mnode-hit" r="12" cy="-2"/>';
      if (sel) g += '<ellipse class="rw-mnode-pulse" cx="0" cy="3.4" rx="10" ry="4.4"/>';
      if (target) g += '<ellipse class="rw-mnode-target-ring" cx="0" cy="3.4" rx="10.5" ry="4.6"/>';
      g += '<ellipse class="rw-mnode-disc" cx="0" cy="3.4" rx="' + f1(7.4 * sc) + '" ry="' + f1(3.1 * sc) + '" fill="' + esc(color) + '"/>';
      if (mine) g += '<ellipse class="rw-mnode-mine-ring" cx="0" cy="3.4" rx="' + f1(8.6 * sc) + '" ry="' + f1(3.8 * sc) + '"/>';
      g += '<g class="rw-mnode-castle" filter="url(#rw-map-shadow)" transform="scale(' + sc + ')">' + mapCastleGlyph(capital) + "</g>";
      // 旗印
      var mark = opts.marks && opts.marks[nd.id];
      if (mark && mark.siege) {
        // 圍城：城四周一圈圍城方的小旗
        for (var si = 0; si < 6; si++) {
          var ang = (si / 6) * Math.PI * 2;
          var fx = f1(Math.cos(ang) * 11);
          var fy = f1(Math.sin(ang) * 5.5 + 2.5);
          g += '<path class="rw-mnode-siege-flag" fill="' + esc(mark.siege) + '" d="M' + fx + "," + fy + " l0,-5 l2.4,0.9 l-2.4,0.9" + '"/>';
        }
      }
      if (mark && mark.intel) g += '<text class="rw-mnode-intel" x="-9" y="-8">👁</text>';
      g += '<line class="rw-mnode-pole" x1="6.6" y1="2" x2="6.6" y2="-13"/>';
      g += '<path class="rw-mnode-flag" fill="' + esc(color) + '" d="M6.6,-13 L12.4,-13 L12.4,-7.6 L6.6,-7.6Z"/>';
      // 名牌
      g +=
        '<g transform="translate(0,12.6)"><rect class="rw-mnode-plate" x="' + f1(-labelW / 2) + '" y="-4.6" width="' + f1(labelW) + '" height="7.4" rx="1.6"/>' +
        '<text class="rw-mnode-label" y="1.3" text-anchor="middle">' + esc(name) + "</text></g>";
      g += "</g>";
      s.push(g);
    });

    // 進軍箭頭（回合摘要重播）：依序延遲動畫；攻陷時箭頭末端畫上旗印
    if (opts.arrows && opts.arrows.length) {
      s.push('<defs><marker id="rw-map-arrowhead" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="4" markerHeight="4" orient="auto"><path d="M0,0 L10,5 L0,10Z" fill="#2a1a0e"/></marker></defs>');
      opts.arrows.forEach(function (a, i) {
        var A = D.nodeById(a.from);
        var B = D.nodeById(a.to);
        if (!A || !B) return;
        var mx = (A.x + B.x) / 2 + (B.y - A.y) * 0.18;
        var my = (A.y + B.y) / 2 - (B.x - A.x) * 0.18;
        var d = "M" + A.x + "," + A.y + " Q" + f1(mx) + "," + f1(my) + " " + B.x + "," + B.y;
        var delay = (0.3 + i * 0.45).toFixed(2) + "s";
        s.push('<path class="rw-map-arrow-under" d="' + d + '" style="animation-delay:' + delay + '"/>');
        s.push('<path class="rw-map-arrow" d="' + d + '" stroke="' + esc(a.color) + '" marker-end="url(#rw-map-arrowhead)" style="animation-delay:' + delay + '"/>');
        if (a.captured) s.push('<text class="rw-map-arrow-capture" x="' + B.x + '" y="' + (B.y - 14) + '" text-anchor="middle" style="animation-delay:' + (0.3 + i * 0.45 + 0.6).toFixed(2) + 's">🚩</text>');
      });
    }

    // 外框
    s.push('<rect class="rw-map-frame" x="' + (vb.x + 1.5) + '" y="' + (vb.y + 1.5) + '" width="' + (vb.w - 3) + '" height="' + (vb.h - 3) + '"/>');
    s.push('<rect class="rw-map-frame-inner" x="' + (vb.x + 5) + '" y="' + (vb.y + 5) + '" width="' + (vb.w - 10) + '" height="' + (vb.h - 10) + '"/>');
    s.push('<rect fill="url(#rw-map-vig)" pointer-events="none" x="' + vb.x + '" y="' + vb.y + '" width="' + vb.w + '" height="' + vb.h + '"/>');

    var svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", vb.x + " " + vb.y + " " + vb.w + " " + vb.h);
    svg.setAttribute("class", "rw-map");
    svg.setAttribute("role", "img");
    svg.innerHTML = s.join("");
    svg.addEventListener("click", function (ev) {
      var tgt = ev.target;
      var g = tgt && tgt.closest ? tgt.closest("[data-node]") : null;
      if (g && opts.onSelect) opts.onSelect(g.getAttribute("data-node"));
    });
    return svg;
  }

  function compassRose(cx, cy, r, northLabel) {
    var pts = [];
    for (var i = 0; i < 16; i++) {
      var ang = (i / 16) * Math.PI * 2 - Math.PI / 2;
      var rr = i % 4 === 0 ? r : i % 2 === 0 ? r * 0.55 : r * 0.3;
      pts.push(f1(cx + Math.cos(ang) * rr) + "," + f1(cy + Math.sin(ang) * rr));
    }
    return (
      '<g class="rw-map-compass"><circle cx="' + cx + '" cy="' + cy + '" r="' + f1(r * 0.82) + '" class="rw-map-compass-ring"/>' +
      '<polygon points="' + pts.join(" ") + '" class="rw-map-compass-star"/>' +
      '<path d="M' + cx + "," + f1(cy - r) + "L" + f1(cx + r * 0.16) + "," + cy + "L" + f1(cx - r * 0.16) + "," + cy + 'Z" class="rw-map-compass-n"/>' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="1.4" class="rw-map-compass-n"/>' +
      '<text x="' + cx + '" y="' + f1(cy - r - 2.5) + '" text-anchor="middle" class="rw-map-compass-label">' + esc(northLabel) + "</text></g>"
    );
  }

  // ===================== 城池 3D =====================
  // 座標：x 往右、y 往上、z 往鏡頭；鏡頭繞 y 軸旋轉（yaw）後再俯角（pitch）正投影。

  var LIGHT = (function () {
    var l = [-0.45, 0.85, 0.42];
    var m = Math.sqrt(l[0] * l[0] + l[1] * l[1] + l[2] * l[2]);
    return [l[0] / m, l[1] / m, l[2] / m];
  })();

  function newell(pts) {
    var nx = 0;
    var ny = 0;
    var nz = 0;
    for (var i = 0; i < pts.length; i++) {
      var a = pts[i];
      var b = pts[(i + 1) % pts.length];
      nx += (a[1] - b[1]) * (a[2] + b[2]);
      ny += (a[2] - b[2]) * (a[0] + b[0]);
      nz += (a[0] - b[0]) * (a[1] + b[1]);
    }
    var m = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    return [nx / m, ny / m, nz / m];
  }

  function centroid(pts) {
    var c = [0, 0, 0];
    pts.forEach(function (p) {
      c[0] += p[0];
      c[1] += p[1];
      c[2] += p[2];
    });
    return [c[0] / pts.length, c[1] / pts.length, c[2] / pts.length];
  }

  function Scene() {
    this.faces = [];
  }

  // o：{ center（物體中心，用來把法向量翻成朝外）, layer（0 地面 → 1 平面貼圖 → 2 立體物）, noCull（旗幟等雙面）, decals, dyn(t) }
  Scene.prototype.face = function (pts, color, o) {
    o = o || {};
    var f = {
      pts: pts,
      rgb: hexToRgb(color),
      layer: o.layer === undefined ? 2 : o.layer,
      noCull: !!o.noCull,
      decals: o.decals || null,
      dyn: o.dyn || null,
      glow: !!o.glow,
    };
    if (!f.dyn) {
      var n = newell(pts);
      if (o.center) {
        var c = centroid(pts);
        if (n[0] * (c[0] - o.center[0]) + n[1] * (c[1] - o.center[1]) + n[2] * (c[2] - o.center[2]) < 0) n = [-n[0], -n[1], -n[2]];
      } else if (n[1] < 0) {
        n = [-n[0], -n[1], -n[2]];
      }
      f.n = n;
    }
    this.faces.push(f);
    return f;
  };

  // 牆面上的窗：在四邊形面內依 u/v 比例切出小矩形
  function windowDecals(BL, BR, TL, cols, color, v0, v1) {
    var out = [];
    function at(u, v) {
      return [
        BL[0] + (BR[0] - BL[0]) * u + (TL[0] - BL[0]) * v,
        BL[1] + (BR[1] - BL[1]) * u + (TL[1] - BL[1]) * v,
        BL[2] + (BR[2] - BL[2]) * u + (TL[2] - BL[2]) * v,
      ];
    }
    for (var c = 0; c < cols; c++) {
      var u0 = (c + 0.3) / cols;
      var u1 = (c + 0.7) / cols;
      out.push({ pts: [at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)], rgb: hexToRgb(color) });
    }
    return out;
  }

  Scene.prototype.box = function (x0, x1, y0, y1, z0, z1, color, o) {
    o = o || {};
    var c = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2];
    var sides = [
      [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]],
      [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]],
      [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]],
      [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]],
    ];
    var self = this;
    sides.forEach(function (q, idx) {
      var decals = null;
      if (o.windows) {
        var len = idx < 2 ? Math.abs(x1 - x0) : Math.abs(z1 - z0);
        var cols = Math.max(1, Math.round(len / (o.windowSpacing || 1.15)));
        decals = windowDecals(q[0], q[1], q[3], cols, o.windowColor || "#2c2420", o.windowV0 || 0.4, o.windowV1 || 0.72);
      }
      self.face(q, o.sideColor || color, { center: c, decals: decals, layer: o.layer });
    });
    if (!o.noTop) self.face([[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], o.topColor || color, { center: c, layer: o.layer });
  };

  // 截頭錐（石垣、屋頂、土丘、松樹）：底面 w0×d0 於 y0，頂面 w1×d1 於 y1
  Scene.prototype.frustum = function (cx, cz, y0, y1, w0, d0, w1, d1, color, o) {
    o = o || {};
    var c = [cx, (y0 + y1) / 2, cz];
    var b = [
      [cx - w0 / 2, y0, cz + d0 / 2], [cx + w0 / 2, y0, cz + d0 / 2], [cx + w0 / 2, y0, cz - d0 / 2], [cx - w0 / 2, y0, cz - d0 / 2],
    ];
    var t = [
      [cx - w1 / 2, y1, cz + d1 / 2], [cx + w1 / 2, y1, cz + d1 / 2], [cx + w1 / 2, y1, cz - d1 / 2], [cx - w1 / 2, y1, cz - d1 / 2],
    ];
    for (var i = 0; i < 4; i++) {
      var j = (i + 1) % 4;
      var q = [b[i], b[j], t[j], t[i]];
      var degenerate = w1 < 0.02 && d1 < 0.02;
      this.face(degenerate ? [b[i], b[j], t[j]] : q, o.sideColors ? o.sideColors[i] : color, { center: c, layer: o.layer });
    }
    if (w1 > 0.05 && d1 > 0.05 && !o.noTop) this.face(t, o.topColor || color, { center: c, layer: o.layer });
  };

  Scene.prototype.flat = function (pts, color, layer, decals) {
    this.face(pts, color, { layer: layer, decals: decals });
  };

  function hipRoof(scene, cx, cz, y, w, d, h, color, ridgeRatio) {
    scene.frustum(cx, cz, y, y + h, w, d, w * (ridgeRatio || 0.5), 0.04, color);
  }

  // 旗幟：隨時間擺動的雙面四邊形
  function addFlag(scene, x, y, z, dirX, dirZ, color, phase) {
    scene.box(x - 0.05, x + 0.05, y, y + 2.5, z - 0.05, z + 0.05, "#3b2d20", { noTop: true });
    scene.face(null, color, {
      noCull: true,
      dyn: function (t) {
        var w = 0.95;
        var sway = Math.sin(t * 3.2 + phase) * 0.22;
        var sway2 = Math.sin(t * 3.2 + phase + 1.2) * 0.3;
        return [
          [x, y + 2.4, z],
          [x + dirX * w + sway * dirZ, y + 2.4, z + dirZ * w + sway * dirX],
          [x + dirX * w + sway2 * dirZ, y + 0.9, z + dirZ * w + sway2 * dirX],
          [x, y + 0.9, z],
        ];
      },
    });
  }

  function addPine(scene, x, z, y0, s) {
    scene.box(x - 0.1 * s, x + 0.1 * s, y0, y0 + 0.5 * s, z - 0.1 * s, z + 0.1 * s, "#5b4128", { noTop: true });
    scene.frustum(x, z, y0 + 0.35 * s, y0 + 1.5 * s, 1.3 * s, 1.3 * s, 0.01, 0.01, "#3f6b3a");
    scene.frustum(x, z, y0 + 1.05 * s, y0 + 2.2 * s, 0.95 * s, 0.95 * s, 0.01, 0.01, "#4f7f45");
  }

  function addHouse(scene, x, z, rot) {
    var w = rot ? 0.9 : 1.3;
    var d = rot ? 1.3 : 0.9;
    scene.box(x - w / 2, x + w / 2, 0, 0.6, z - d / 2, z + d / 2, "#e9dfcb", { noTop: true });
    scene.frustum(x, z, 0.6, 1.05, w + 0.25, d + 0.25, rot ? 0.04 : w * 0.7, rot ? d * 0.7 : 0.04, "#5a5550");
  }

  // params：{ tiers, defense, profile, color, seed }
  function buildCastleScene(params) {
    var sc = new Scene();
    var rnd = seededRandom(params.seed);
    var profile = params.profile;
    var color = params.color || "#b23c2f";
    var capital = profile === "capital";
    var coastal = profile === "coastal";
    var mountain = profile === "mountain";
    var G = 12;
    var R = 6.4;
    var groundTop = mountain ? "#6f8f4e" : "#7fa35a";

    // 地台（立體模型的底座）
    sc.box(-G, G, -0.9, 0, -G, G, groundTop, { sideColor: "#7a5f40", layer: 0 });
    if (coastal) {
      sc.flat([[-G, 0.01, -G], [G, 0.01, -G], [G, 0.01, -8.6], [-G, 0.01, -8.6]], "#3f86b8", 1, [
        { pts: [[-9, 0.02, -11], [-5, 0.02, -11], [-5, 0.02, -10.8], [-9, 0.02, -10.8]], rgb: hexToRgb("#bfe0f2") },
        { pts: [[2, 0.02, -10], [7, 0.02, -10], [7, 0.02, -9.8], [2, 0.02, -9.8]], rgb: hexToRgb("#bfe0f2") },
      ]);
      sc.flat([[-G, 0.01, -8.6], [G, 0.01, -8.6], [G, 0.01, -7.6], [-G, 0.01, -7.6]], "#e3d3a0", 1);
      // 小船
      sc.box(5.5, 8.3, 0.02, 0.4, -11.2, -10.4, "#6b4a2e");
      sc.face(null, "#f3efe4", {
        noCull: true,
        dyn: function (t) {
          var b = Math.sin(t * 1.6) * 0.15;
          return [[6.9, 0.4, -10.8], [6.9, 2.3 + b, -10.8], [8.0, 0.6, -10.8]];
        },
      });
    }

    var baseY = 0;
    if (mountain) {
      sc.frustum(0, 0, 0, 1.6, 17.5, 17.5, 15.2, 15.2, "#7b6a48", { topColor: "#6f8f4e" });
      baseY = 1.6;
    }

    // 水田（平原）／城下町（本城）
    if (!mountain && !coastal) {
      [[-10.6, -10.6], [8.2, -10.6], [-10.6, 8.2]].forEach(function (p) {
        var x = p[0];
        var z = p[1];
        sc.flat([[x, 0.01, z], [x + 2.4, 0.01, z], [x + 2.4, 0.01, z + 2.4], [x, 0.01, z + 2.4]], "#a9c46c", 1, [
          { pts: [[x + 1.15, 0.02, z], [x + 1.25, 0.02, z], [x + 1.25, 0.02, z + 2.4], [x + 1.15, 0.02, z + 2.4]], rgb: hexToRgb("#7d9a4a") },
        ]);
      });
    }
    if (capital) {
      [[-4.2, 10.6, 0], [-2.4, 10.6, 0], [2.4, 10.6, 0], [4.2, 10.6, 0], [-10.6, 4, 1], [-10.6, 2, 1], [10.6, 4, 1], [10.6, 2, 1], [10.6, -1.5, 1]].forEach(function (h) {
        addHouse(sc, h[0], h[1], h[2]);
      });
    }

    // 護城河（築城 3）：沿海城以海為壕，背面不挖
    if (params.defense >= 3) {
      var mi = R + 2.0;
      var mo = R + 3.4;
      var wc = "#3f7fae";
      var y = baseY + 0.015;
      var sides = [
        [[-mo, y, mo], [mo, y, mo], [mi, y, mi], [-mi, y, mi]],
        [[mo, y, mo], [mo, y, -mo], [mi, y, -mi], [mi, y, mi]],
        [[-mo, y, -mo], [-mo, y, mo], [-mi, y, mi], [-mi, y, -mi]],
      ];
      if (!coastal) sides.push([[mo, y, -mo], [-mo, y, -mo], [-mi, y, -mi], [mi, y, -mi]]);
      sides.forEach(function (q) {
        sc.flat(q, wc, 1);
      });
      // 土橋
      sc.flat([[-0.9, y + 0.02, mo], [0.9, y + 0.02, mo], [0.9, y + 0.02, mi], [-0.9, y + 0.02, mi]], "#8a6a45", 1);
    }

    // 城牆
    var wallBase = baseY;
    if (params.defense >= 2) {
      // 石垣台
      sc.frustum(0, 0, baseY, baseY + 0.55, 2 * R + 1.4, 2 * R + 1.4, 2 * R + 0.9, 2 * R + 0.9, "#9a9284", { noTop: true });
      wallBase = baseY + 0.55;
    }
    function wallSeg(x0, x1, z0, z1) {
      if (params.defense <= 0) {
        sc.box(x0, x1, wallBase, wallBase + 0.6, z0, z1, "#8b6a42");
        return;
      }
      sc.box(x0, x1, wallBase, wallBase + 0.85, z0, z1, "#f1ece0", { noTop: true });
      var cx = (x0 + x1) / 2;
      var cz = (z0 + z1) / 2;
      var w = Math.abs(x1 - x0);
      var d = Math.abs(z1 - z0);
      sc.frustum(cx, cz, wallBase + 0.85, wallBase + 1.15, w + 0.3, d + 0.3, w > d ? w : 0.06, w > d ? 0.06 : d, "#3d4650");
    }
    var tk = params.defense <= 0 ? 0.12 : 0.22;
    wallSeg(-R, R, -R - tk, -R + tk);
    wallSeg(-R - tk, -R + tk, -R, R);
    wallSeg(R - tk, R + tk, -R, R);
    wallSeg(-R, -1.2, R - tk, R + tk);
    wallSeg(1.2, R, R - tk, R + tk);

    // 城門
    if (params.defense >= 1) {
      sc.box(-1.3, 1.3, wallBase, wallBase + 1.45, R - 0.5, R + 0.5, "#5b4330", { windows: true, windowColor: "#2a1d14", windowSpacing: 2.6, windowV0: 0.05, windowV1: 0.62 });
      hipRoof(sc, 0, R, wallBase + 1.45, 3.2, 1.6, 0.6, "#363e47", 0.65);
    }

    // 角櫓（築城 2 起）
    if (params.defense >= 2) {
      [[-R, -R], [R, -R], [-R, R], [R, R]].forEach(function (p) {
        sc.box(p[0] - 0.85, p[0] + 0.85, wallBase, wallBase + 1.35, p[1] - 0.85, p[1] + 0.85, "#f4efe4", { windows: true, windowSpacing: 0.9, noTop: true });
        hipRoof(sc, p[0], p[1], wallBase + 1.3, 2.3, 2.3, 0.75, "#3a434d", 0.35);
      });
    }

    // 天守：石垣台座 + 依石高疊層
    var tiers = Math.max(1, Math.min(5, params.tiers || 1));
    var roofColor = capital ? "#4f8a78" : "#39424c";
    sc.frustum(0, 0, baseY, baseY + 1.5, 7.2, 6.2, 6.2, 5.2, "#a39a8a", { topColor: "#8d8577" });
    var y = baseY + 1.5;
    var dims = [];
    for (var i = 0; i < tiers; i++) {
      dims.push({ w: 5.3 - i * 0.92, d: 4.3 - i * 0.74, h: 1.32 - i * 0.06 });
    }
    dims.forEach(function (tier, idx) {
      sc.box(-tier.w / 2, tier.w / 2, y, y + tier.h, -tier.d / 2, tier.d / 2, "#f6f1e6", { windows: true, noTop: true });
      var top = y + tier.h;
      var next = dims[idx + 1];
      if (next) {
        sc.frustum(0, 0, top - 0.12, top + 0.42, tier.w + 1.0, tier.d + 1.0, next.w + 0.1, next.d + 0.1, roofColor);
        y = top + 0.42;
      } else {
        hipRoof(sc, 0, 0, top - 0.12, tier.w + 1.1, tier.d + 1.1, 1.05, roofColor, 0.55);
        // 金鯱
        var rx = ((tier.w + 1.1) * 0.55) / 2;
        var ry = top - 0.12 + 1.05;
        sc.box(-rx - 0.12, -rx + 0.12, ry, ry + 0.4, -0.1, 0.1, "#e2b23a");
        sc.box(rx - 0.12, rx + 0.12, ry, ry + 0.4, -0.1, 0.1, "#e2b23a");
      }
    });

    // 旗幟：城門兩側與四角（築城越高旗越多）
    var flagY = wallBase;
    var flags = [[-1.7, R + 0.6], [1.7, R + 0.6]];
    if (params.defense >= 1) flags.push([-R - 0.4, R + 0.4], [R + 0.4, R + 0.4]);
    if (params.defense >= 2 || capital) flags.push([-R - 0.4, -R - 0.4], [R + 0.4, -R - 0.4]);
    flags.forEach(function (p, idx) {
      addFlag(sc, p[0], flagY, p[1], 1, 0, color, idx * 0.9);
    });

    // 松樹
    var treeCount = mountain ? 14 : coastal ? 6 : 8;
    var placed = 0;
    var guard = 0;
    while (placed < treeCount && guard < 200) {
      guard++;
      var tx = (rnd() * 2 - 1) * (G - 0.8);
      var tz = (rnd() * 2 - 1) * (G - 0.8);
      var limit = params.defense >= 3 ? R + 3.9 : R + 1.4;
      if (Math.abs(tx) < limit && Math.abs(tz) < limit) continue;
      if (coastal && tz < -7.2) continue;
      if (capital && tz > 9 && Math.abs(tx) < 5.5) continue;
      if (capital && Math.abs(tx) > 9.5 && tz > -2.5 && tz < 5) continue;
      if (!mountain && !coastal && ((tx < -8 && tz < -8) || (tx > 7.8 && tz < -8) || (tx < -8 && tz > 7.8))) continue;
      var ty = mountain && Math.abs(tx) < 7.6 && Math.abs(tz) < 7.6 ? 1.6 : 0;
      addPine(sc, tx, tz, ty, 0.75 + rnd() * 0.45);
      placed++;
    }
    return sc;
  }

  function drawScene(scene, view, t) {
    var ca = Math.cos(view.yaw);
    var sa = Math.sin(view.yaw);
    var cp = Math.cos(view.pitch);
    var sp = Math.sin(view.pitch);
    var k = view.scale;
    var cx = view.cx;
    var cy = view.cy;
    function proj(p) {
      var x = p[0] * ca + p[2] * sa;
      var z = -p[0] * sa + p[2] * ca;
      return [cx + x * k, cy - (p[1] * cp - z * sp) * k, z * cp + p[1] * sp];
    }
    function viewDot(n) {
      return (-n[0] * sa + n[2] * ca) * cp + n[1] * sp;
    }
    function shadeK(n, doubleSided) {
      var d = n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2];
      if (doubleSided) d = Math.abs(d);
      return 0.58 + 0.5 * Math.max(0, d);
    }
    function pathOf(pp) {
      var d = "M";
      for (var i = 0; i < pp.length; i++) d += (i ? "L" : "") + f1(pp[i][0]) + "," + f1(pp[i][1]);
      return d + "Z";
    }
    var list = [];
    scene.faces.forEach(function (f) {
      var pts = f.dyn ? f.dyn(t) : f.pts;
      var n = f.dyn ? newell(pts) : f.n;
      if (!f.noCull && viewDot(n) <= 0.0005) return;
      var pp = pts.map(proj);
      var depth = 0;
      pp.forEach(function (p) {
        depth += p[2];
      });
      list.push({ f: f, pp: pp, n: n, depth: depth / pp.length });
    });
    list.sort(function (a, b) {
      return a.f.layer - b.f.layer || a.depth - b.depth;
    });
    var out = "";
    list.forEach(function (it) {
      var kk = shadeK(it.n, it.f.noCull);
      var fill = rgbStr(it.f.rgb, kk);
      var stroke = rgbStr(it.f.rgb, kk * 0.86);
      out += '<path d="' + pathOf(it.pp) + '" fill="' + fill + '" stroke="' + stroke + '" stroke-width="0.45" stroke-linejoin="round"/>';
      if (it.f.decals) {
        it.f.decals.forEach(function (dc) {
          out += '<path d="' + pathOf(dc.pts.map(proj)) + '" fill="' + rgbStr(dc.rgb, kk) + '"/>';
        });
      }
    });
    return out;
  }

  var castleView = {
    yaw: 0.65,
    pitch: 0.52,
    scale: 8.3,
    cx: 160,
    cy: 138,
    svg: null,
    g: null,
    scene: null,
    running: false,
    dragging: false,
    lastX: 0,
    lastDraw: 0,
    lastTs: 0,
  };

  function reducedMotion() {
    return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  function castleFrame(ts) {
    var v = castleView;
    if (!v.svg || !v.svg.isConnected) {
      v.running = false;
      return;
    }
    var dt = v.lastTs ? Math.min(0.1, (ts - v.lastTs) / 1000) : 0;
    v.lastTs = ts;
    if (!v.dragging && !reducedMotion()) v.yaw += dt * 0.22;
    if (ts - v.lastDraw > 33) {
      v.lastDraw = ts;
      v.g.innerHTML = drawScene(v.scene, v, reducedMotion() ? 0 : ts / 1000);
    }
    window.requestAnimationFrame(castleFrame);
  }

  // params：{ tiers, defense, profile, color, seed, hint }
  function castleStage(params) {
    var svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 320 200");
    svg.setAttribute("class", "rw-c3");
    svg.setAttribute("role", "img");
    svg.innerHTML =
      "<defs>" +
      '<linearGradient id="rw-c3-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="rw-c3-sky1"/><stop offset="0.7" class="rw-c3-sky2"/><stop offset="1" class="rw-c3-sky3"/></linearGradient>' +
      '<radialGradient id="rw-c3-shadow" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#000" stop-opacity="0.35"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>' +
      "</defs>" +
      '<rect width="320" height="200" fill="url(#rw-c3-sky)"/>' +
      '<circle class="rw-c3-sun" cx="262" cy="40" r="16"/>' +
      '<g class="rw-c3-cloud"><ellipse cx="60" cy="38" rx="22" ry="6"/><ellipse cx="74" cy="33" rx="13" ry="6"/><ellipse cx="210" cy="60" rx="18" ry="4.5"/></g>' +
      '<path class="rw-c3-far" d="M0,118 L28,96 L52,108 L84,84 L118,104 L150,92 L182,108 L214,86 L246,100 L276,90 L320,110 L320,200 L0,200Z"/>' +
      '<path class="rw-c3-near" d="M0,132 L40,116 L80,126 L120,114 L170,128 L220,116 L270,126 L320,118 L320,200 L0,200Z"/>' +
      '<ellipse cx="160" cy="176" rx="150" ry="22" fill="url(#rw-c3-shadow)"/>' +
      '<g class="rw-c3-scene"></g>';
    var v = castleView;
    v.svg = svg;
    v.g = svg.querySelector(".rw-c3-scene");
    v.scene = buildCastleScene(params);
    v.g.innerHTML = drawScene(v.scene, v, 0);

    svg.addEventListener("pointerdown", function (ev) {
      v.dragging = true;
      v.lastX = ev.clientX;
      if (svg.setPointerCapture) svg.setPointerCapture(ev.pointerId);
    });
    svg.addEventListener("pointermove", function (ev) {
      if (!v.dragging) return;
      v.yaw += (ev.clientX - v.lastX) * 0.012;
      v.lastX = ev.clientX;
      if (reducedMotion()) v.g.innerHTML = drawScene(v.scene, v, 0);
    });
    function stop() {
      v.dragging = false;
    }
    svg.addEventListener("pointerup", stop);
    svg.addEventListener("pointercancel", stop);
    svg.addEventListener("lostpointercapture", stop);

    if (!v.running) {
      v.running = true;
      v.lastTs = 0;
      window.requestAnimationFrame(castleFrame);
    }
    return svg;
  }

  // ===================== 伐掠合戰場景 =====================

  var SKIN = "#e8c39e";
  var ARMOR = "#3a302b";
  var WOOD = "#6b4a2b";
  var METAL = "#d4dbe0";
  var INK = "#231d19";

  function legs() {
    return '<path d="M-1.2,-8 L-3,0 M1.2,-8 L2.8,0" stroke="' + INK + '" stroke-width="1.9" stroke-linecap="round" fill="none"/>';
  }
  function torso(heavy) {
    var w = heavy ? 3.8 : 3.1;
    return (
      '<path d="M-' + w + ",-16.6 L" + w + ",-16.6 L" + (w + 0.6) + ",-8 L-" + (w + 0.6) + ',-8Z" fill="' + ARMOR + '"/>' +
      '<path d="M-' + (w + 0.6) + ",-10.2 L" + (w + 0.6) + ",-10.2 L" + (w + 0.9) + ",-7.6 L-" + (w + 0.9) + ',-7.6Z" fill="var(--rw-fc)"/>' +
      '<path d="M-' + (w - 0.6) + ",-14.6 L" + (w - 0.6) + ',-14.6" stroke="var(--rw-fc)" stroke-width="0.8"/>'
    );
  }
  function head(cx, cy) {
    return '<circle cx="' + (cx || 0.4) + '" cy="' + (cy || -18.7) + '" r="2.15" fill="' + SKIN + '"/>';
  }
  function jingasa(dy) {
    var y = -19.4 + (dy || 0);
    return '<path d="M-4.4,' + y + " L4.8," + y + " L0.3," + (y - 3.9) + 'Z" fill="#2b2522"/>';
  }
  function kabuto(dy) {
    var y = -19.2 + (dy || 0);
    return (
      '<path d="M-2.6,' + y + " Q0.3," + (y - 3.8) + " 3.2," + y + 'Z" fill="#2b2522"/>' +
      '<path d="M0.3,' + (y - 2.6) + " L-2.2," + (y - 6) + " M0.3," + (y - 2.6) + " L2.8," + (y - 6) + '" stroke="#d9ad34" stroke-width="0.85" fill="none"/>'
    );
  }
  function sashimono(dy) {
    var o = dy || 0;
    return (
      '<line x1="-2.7" y1="' + (-11 + o) + '" x2="-2.7" y2="' + (-31.5 + o) + '" stroke="#3b2d20" stroke-width="0.7"/>' +
      '<rect x="-8.6" y="' + (-31.5 + o) + '" width="5.9" height="8.8" fill="var(--rw-fc)" stroke="#1f1a16" stroke-width="0.4"/>' +
      '<circle cx="-5.65" cy="' + (-27.1 + o) + '" r="1.6" fill="none" stroke="#fff" stroke-opacity="0.75" stroke-width="0.55"/>'
    );
  }
  function arm(x1, y1, x2, y2) {
    return '<path d="M' + x1 + "," + y1 + " L" + x2 + "," + y2 + '" stroke="' + ARMOR + '" stroke-width="1.6" stroke-linecap="round"/>';
  }

  var FIGURES = {
    spear: function () {
      return (
        sashimono() + legs() + torso() + head() + jingasa() + arm(1, -14.5, 5.5, -13) +
        '<path d="M-6,-6 L16,-21.5" stroke="' + WOOD + '" stroke-width="0.95"/><path d="M15.6,-21.2 L19.6,-24 L16.8,-20.2Z" fill="' + METAL + '"/>'
      );
    },
    naginata: function () {
      return (
        sashimono() + legs() + torso() + head() + kabuto() + arm(1, -14.5, 5, -12.5) +
        '<path d="M-5,-4 L10.5,-19.5" stroke="' + WOOD + '" stroke-width="1"/><path d="M10.2,-19.2 Q13.6,-23.2 17.2,-22 Q14.2,-19.8 11.6,-17.8Z" fill="' + METAL + '"/>'
      );
    },
    archer: function () {
      return (
        sashimono() + legs() + torso() + head() + jingasa() + arm(1, -14.6, 6, -15.4) + arm(-0.5, -14.6, 1.5, -15.4) +
        '<path d="M6.4,-25.5 Q12.6,-15.6 6.4,-5.6" stroke="' + WOOD + '" stroke-width="1.15" fill="none"/>' +
        '<path d="M6.4,-25.5 L1.2,-15.5 L6.4,-5.6" stroke="#efe9dc" stroke-width="0.35" fill="none"/>' +
        '<path d="M1.2,-15.5 L11,-15.5" stroke="#4a3a28" stroke-width="0.55"/><path d="M11,-15.5 L9.6,-16.4 L9.6,-14.6Z" fill="' + METAL + '"/>'
      );
    },
    gun: function () {
      return (
        sashimono() + legs() + torso() + head() + jingasa() + arm(1, -14.2, 5, -14.6) + arm(-0.6, -13.6, 2.2, -13.8) +
        '<path d="M-2.2,-13.4 L14.6,-15.6" stroke="#3b2a1a" stroke-width="1.55" stroke-linecap="round"/><path d="M-2.4,-13.4 L-4.4,-11.6" stroke="' + WOOD + '" stroke-width="1.6" stroke-linecap="round"/>' +
        '<circle cx="14.9" cy="-15.6" r="0.6" fill="#1a1410"/>'
      );
    },
    ashigaru: function () {
      return (
        sashimono() + legs() + torso(true) + head() + kabuto() +
        '<rect x="3.4" y="-19.4" width="4.8" height="18.8" fill="#8b6a40" stroke="#4a3620" stroke-width="0.5"/>' +
        '<path d="M3.4,-13 L8.2,-13 M3.4,-6.6 L8.2,-6.6" stroke="#4a3620" stroke-width="0.6"/>' +
        '<circle cx="5.8" cy="-16.2" r="1.3" fill="var(--rw-fc)"/>' +
        '<path d="M-2,-12 L-6,-22" stroke="' + METAL + '" stroke-width="0.8"/>'
      );
    },
    ninja: function () {
      return (
        '<path d="M-1,-7 L-3.6,-3.4 L-2.4,0 M1,-7 L3.8,-3.8 L5,0" stroke="#15151a" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" fill="none"/>' +
        '<path d="M-2.8,-14.6 L3.6,-15.8 L3.8,-7 L-3,-7Z" fill="#1d1d24"/>' +
        '<rect x="-3.1" y="-10.4" width="7" height="1.5" fill="var(--rw-fc)"/>' +
        '<path d="M-1,-16 Q-5,-17.2 -8,-14.8" stroke="var(--rw-fc)" stroke-width="1.1" fill="none" stroke-linecap="round"/>' +
        '<circle cx="1.4" cy="-17.6" r="2.2" fill="#1d1d24"/><path d="M1.8,-17.9 L3.5,-17.9" stroke="' + SKIN + '" stroke-width="0.75"/>' +
        '<path d="M-4.4,-19.6 L2.6,-8.6" stroke="' + METAL + '" stroke-width="0.8"/>' +
        arm(2.6, -13.6, 7, -11.6) + '<path d="M7,-11.6 L9.4,-12.6 L8.4,-10.8Z" fill="' + METAL + '"/>'
      );
    },
    cavalry: function () {
      return (
        '<path d="M-8,-10.5 Q-11.4,-8.6 -10.8,-4" stroke="#3a2716" stroke-width="1.3" fill="none" stroke-linecap="round"/>' +
        '<path d="M-5,-6.5 L-6.6,0 M-2.4,-6.5 L-2,0 M3,-6.5 L2.2,0 M5.6,-6.5 L7.2,0" stroke="#4b331f" stroke-width="1.25" stroke-linecap="round"/>' +
        '<ellipse cx="0" cy="-9.4" rx="8.2" ry="3.7" fill="#6b4a2e"/>' +
        '<path d="M5.4,-11 L9.2,-16.6 L11.8,-15.6 L8.6,-9.2Z" fill="#6b4a2e"/><path d="M9.2,-16.6 L13.8,-15 L13.2,-13.2 L10.6,-13.6Z" fill="#5d3f26"/>' +
        '<path d="M8.6,-16.4 L7,-13.6" stroke="#2a1b10" stroke-width="0.8"/>' +
        '<path d="M-4.4,-12.6 L3.4,-12.6 L3.9,-8.6 L-4.9,-8.6Z" fill="var(--rw-fc)"/>' +
        sashimono(-2.6) +
        '<path d="M-2.5,-20.6 L2.5,-20.6 L2.9,-12.8 L-2.9,-12.8Z" fill="' + ARMOR + '"/>' + head(0.5, -22.8) + kabuto(-4) +
        arm(1, -18.4, 5, -17.4) + '<path d="M-4.6,-14.6 L15.4,-25.6" stroke="' + WOOD + '" stroke-width="0.9"/><path d="M15,-25.3 L18.8,-27.4 L16.2,-24.2Z" fill="' + METAL + '"/>'
      );
    },
    navy: function () {
      return (
        '<path d="M-13.6,3.2 q2,-1.6 4,0 t4,0 t4,0 t4,0 t4,0 t4,0 t4,0" stroke="#9cc6e0" stroke-width="0.8" fill="none"/>' +
        '<line x1="-9" y1="-3" x2="-9" y2="-17" stroke="#3b2d20" stroke-width="0.6"/><rect x="-14.4" y="-17" width="5.4" height="4.4" fill="var(--rw-fc)"/>' +
        '<path d="M-2.7,-12.2 L2.7,-12.2 L3.1,-2.6 L-3.1,-2.6Z" fill="' + ARMOR + '"/>' + head(0.4, -14.3) + jingasa(4.4) +
        arm(1.4, -10, 6, -6) + '<path d="M3.2,-11 L10.6,3.4" stroke="' + WOOD + '" stroke-width="0.95"/>' +
        '<path d="M-11.4,-3.2 L12.6,-3.2 Q10.6,1.6 6.2,2.2 L-8,2.2 Q-10.6,1 -11.4,-3.2Z" fill="#6b4a2e" stroke="#3d2a18" stroke-width="0.4"/>' +
        '<path d="M-10.8,-2 L12,-2" stroke="var(--rw-fc)" stroke-width="1"/>'
      );
    },
  };

  var RANGED = { archer: true, gun: true };

  function figureDefs() {
    var out = "";
    Object.keys(FIGURES).forEach(function (k) {
      out += '<g id="rw-bt-fig-' + k + '">' + FIGURES[k]() + "</g>";
    });
    return out;
  }

  var FORMATION = [[0, 2], [-17, -6], [-19, 9], [-35, -1], [-38, 11]];

  // 一個兵種部隊（5 人陣形）；side：atk 面向右、def 鏡像面向左
  function squadMarkup(type, side, color, fallenCount, frontX, baseY, opts) {
    opts = opts || {};
    var spread = type === "cavalry" || type === "navy" ? 1.45 : 1;
    var sign = side === "atk" ? 1 : -1;
    var scl = opts.scale || 1.32;
    var members = FORMATION.map(function (p, idx) {
      return { x: frontX + sign * p[0] * spread, y: baseY + p[1], idx: idx };
    });
    // 前排先倒下
    var fallenSet = {};
    for (var i = 0; i < fallenCount; i++) fallenSet[i] = true;
    var sorted = members.slice().sort(function (a, b) {
      return a.y - b.y;
    });
    var out = '<g class="rw-bt-squad' + (opts.animate ? " rw-bt-adv-" + side : "") + '" style="--rw-fc:' + esc(color) + '">';
    sorted.forEach(function (m) {
      var fall = fallenSet[m.idx];
      out +=
        '<g transform="translate(' + f1(m.x) + "," + f1(m.y) + ") scale(" + f1(sign * scl * 100) / 100 + "," + scl + ')">' +
        '<g class="rw-bt-fig' + (opts.animate ? " rw-bt-bob" : "") + (fall ? " rw-bt-fallen" : "") + '" style="animation-delay:' + (fall ? "" : f1(m.idx * 0.04) + "s") + '"><use href="#rw-bt-fig-' + type + '"/></g></g>';
    });
    out += "</g>";
    return out;
  }

  function battleCastle(x, y, color, burning) {
    var out =
      '<g class="rw-bt-castle" style="--rw-fc:' + esc(color) + '">' +
      '<path d="M' + (x - 60) + "," + (y + 14) + " Q" + (x - 20) + "," + (y - 8) + " " + (x + 70) + "," + (y - 4) + " L" + (x + 70) + "," + (y + 30) + " L" + (x - 70) + "," + (y + 30) + 'Z" class="rw-bt-hill"/>' +
      '<path d="M' + (x - 30) + "," + (y + 2) + " L" + (x + 30) + "," + (y + 2) + " L" + (x + 24) + "," + (y - 12) + " L" + (x - 24) + "," + (y - 12) + 'Z" fill="#8f877a" stroke="#5d564c" stroke-width="0.6"/>' +
      '<rect x="' + (x - 19) + '" y="' + (y - 26) + '" width="38" height="14" fill="#f3eee2" stroke="#6b645a" stroke-width="0.5"/>' +
      '<path d="M' + (x - 26) + "," + (y - 25) + " Q" + x + "," + (y - 31) + " " + (x + 26) + "," + (y - 25) + " L" + (x + 16) + "," + (y - 35) + " L" + (x - 16) + "," + (y - 35) + 'Z" fill="#39424c"/>' +
      '<rect x="' + (x - 13) + '" y="' + (y - 45) + '" width="26" height="11" fill="#f3eee2" stroke="#6b645a" stroke-width="0.5"/>' +
      '<path d="M' + (x - 19) + "," + (y - 44) + " Q" + x + "," + (y - 49) + " " + (x + 19) + "," + (y - 44) + " L" + (x + 9) + "," + (y - 53) + " L" + (x - 9) + "," + (y - 53) + 'Z" fill="#39424c"/>' +
      '<rect x="' + (x - 8) + '" y="' + (y - 61) + '" width="16" height="9" fill="#f3eee2" stroke="#6b645a" stroke-width="0.5"/>' +
      '<path d="M' + (x - 13) + "," + (y - 60) + " Q" + x + "," + (y - 64) + " " + (x + 13) + "," + (y - 60) + " L" + (x + 4) + "," + (y - 69) + " L" + (x - 4) + "," + (y - 69) + 'Z" fill="#39424c"/>' +
      '<circle cx="' + (x - 4) + '" cy="' + (y - 69.5) + '" r="1.3" fill="#e2b23a"/><circle cx="' + (x + 4) + '" cy="' + (y - 69.5) + '" r="1.3" fill="#e2b23a"/>';
    [-14, -5, 4, 13].forEach(function (dx) {
      out += '<rect x="' + (x + dx - 2) + '" y="' + (y - 22) + '" width="3" height="3" fill="#2c2420"/>';
    });
    [-7, 0, 7].forEach(function (dx) {
      out += '<rect x="' + (x + dx - 1.5) + '" y="' + (y - 41) + '" width="3" height="3" fill="#2c2420"/>';
    });
    [-34, 34].forEach(function (dx) {
      out +=
        '<line x1="' + (x + dx) + '" y1="' + (y + 2) + '" x2="' + (x + dx) + '" y2="' + (y - 34) + '" stroke="#3b2d20" stroke-width="0.9"/>' +
        '<path class="rw-bt-banner" d="M' + (x + dx) + "," + (y - 34) + " l" + (dx < 0 ? -9 : 9) + ",0 l0,22 l" + (dx < 0 ? 9 : -9) + ',0Z" fill="var(--rw-fc)"/>';
    });
    if (burning) {
      out +=
        '<g class="rw-bt-fire"><path d="M' + (x - 10) + "," + (y - 26) + " q4,-14 8,-4 q2,-10 7,-2 q4,-9 6,6Z\" fill=\"#ff8a2b\"/>" +
        '<path d="M' + (x - 6) + "," + (y - 26) + ' q3,-8 5,-2 q2,-6 4,1Z" fill="#ffd166"/></g>' +
        '<g class="rw-bt-smoke"><circle cx="' + (x - 4) + '" cy="' + (y - 78) + '" r="9"/><circle cx="' + (x + 8) + '" cy="' + (y - 92) + '" r="12"/><circle cx="' + (x - 10) + '" cy="' + (y - 104) + '" r="10"/></g>';
    }
    return out + "</g>";
  }

  function battleCamp(x, y, color) {
    var out = '<g class="rw-bt-camp" style="--rw-fc:' + esc(color) + '">';
    [0, 22, 44, 66].forEach(function (dx, i) {
      out +=
        '<line x1="' + (x + dx) + '" y1="' + (y + 22) + '" x2="' + (x + dx) + '" y2="' + (y - 30 - (i % 2) * 6) + '" stroke="#3b2d20" stroke-width="0.9"/>' +
        '<path class="rw-bt-banner" style="animation-delay:' + i * 0.3 + 's" d="M' + (x + dx) + "," + (y - 30 - (i % 2) * 6) + " l8,0 l0,24 l-8,0Z\" fill=\"var(--rw-fc)\"/>";
    });
    out +=
      '<path d="M' + (x - 6) + "," + y + " L" + (x + 74) + "," + y + " L" + (x + 74) + "," + (y + 22) + " L" + (x - 6) + "," + (y + 22) + 'Z" fill="#f2ede1" stroke="#7a7062" stroke-width="0.5"/>' +
      '<path d="M' + (x - 6) + "," + (y + 7) + " L" + (x + 74) + "," + (y + 7) + " M" + (x - 6) + "," + (y + 15) + " L" + (x + 74) + "," + (y + 15) + '" stroke="var(--rw-fc)" stroke-width="2.2"/>' +
      '<circle cx="' + (x + 34) + '" cy="' + (y + 11) + '" r="6.5" fill="#f2ede1" stroke="var(--rw-fc)" stroke-width="1.6"/><circle cx="' + (x + 34) + '" cy="' + (y + 11) + '" r="2.6" fill="var(--rw-fc)"/>';
    return out + "</g>";
  }

  function infoPlate(x, y, w, align, color, title, line) {
    var tx = align === "end" ? x + w - 8 : x + 8;
    return (
      '<g class="rw-bt-plate"><rect x="' + x + '" y="' + y + '" width="' + w + '" height="30" rx="5" class="rw-bt-plate-bg"/>' +
      '<rect x="' + (align === "end" ? x + w - 4 : x) + '" y="' + y + '" width="4" height="30" rx="2" fill="' + esc(color) + '"/>' +
      '<text x="' + tx + '" y="' + (y + 12.5) + '" text-anchor="' + align + '" class="rw-bt-plate-title">' + esc(title) + "</text>" +
      '<text x="' + tx + '" y="' + (y + 24.5) + '" text-anchor="' + align + '" class="rw-bt-plate-line">' + esc(line) + "</text></g>"
    );
  }

  function stamp(x, y, text, cls, size) {
    return (
      '<g class="rw-bt-stamp ' + cls + '"><rect x="' + (x - size) + '" y="' + (y - size * 0.62) + '" width="' + size * 2 + '" height="' + size * 1.24 + '" rx="3"/>' +
      '<text x="' + x + '" y="' + f1(y + size * 0.3) + '" text-anchor="middle" font-size="' + f1(size * (isCjk(text) ? 0.78 : 0.42)) + '">' + esc(text) + "</text></g>"
    );
  }

  function fallenOf(amount, loss) {
    if (!amount || !loss) return 0;
    if (loss >= amount) return 5;
    return Math.max(1, Math.min(4, Math.round((loss / amount) * 5)));
  }

  // opts：{ phase: "intro"|"round"|"final", round, roundIndex, rounds, attackerColor, defenderColor, captured,
  //         attackerName, defenderName, nodeName, typeName(tid), typeIcon(tid), labels{advantage, stampCaptured, stampRepelled, round, deployed, troops}, attackerTotal, defenderTotal }
  function battleScene(opts) {
    var D = window.PriTestReiwaData;
    var lb = opts.labels || {};
    var s = [];
    var groundY = 182;
    s.push("<defs>");
    s.push(
      '<linearGradient id="rw-bt-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#263556"/><stop offset="0.5" stop-color="#8b5a6b"/><stop offset="0.8" stop-color="#e2895a"/><stop offset="1" stop-color="#f6c987"/></linearGradient>'
    );
    s.push('<linearGradient id="rw-bt-ground" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6d6b3c"/><stop offset="1" stop-color="#3e3f22"/></linearGradient>');
    s.push('<radialGradient id="rw-bt-flash-g" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#fffbe6"/><stop offset="0.4" stop-color="#ffd166" stop-opacity="0.9"/><stop offset="1" stop-color="#ff7b2b" stop-opacity="0"/></radialGradient>');
    s.push(figureDefs());
    s.push("</defs>");

    s.push('<rect width="400" height="210" fill="url(#rw-bt-sky)"/>');
    s.push('<circle cx="300" cy="104" r="22" fill="#ffe2a6" opacity="0.85"/>');
    s.push('<path d="M0,128 L36,104 L70,118 L112,92 L150,112 L196,96 L240,114 L282,98 L330,116 L370,102 L400,112 L400,210 L0,210Z" fill="#5d4a66" opacity="0.75"/>');
    s.push('<path d="M0,140 L50,124 L104,136 L160,122 L214,138 L268,126 L322,138 L400,128 L400,210 L0,210Z" fill="#40384d" opacity="0.9"/>');
    s.push('<rect x="0" y="148" width="400" height="62" fill="url(#rw-bt-ground)"/>');
    s.push('<path d="M0,149 Q100,145 200,149 T400,148" stroke="#8d8a52" stroke-width="1" fill="none" opacity="0.6"/>');
    for (var gi = 0; gi < 26; gi++) {
      var gx = (gi * 61) % 400;
      var gy = 156 + ((gi * 37) % 50);
      s.push('<path d="M' + gx + "," + gy + " l1.4,-4 M" + (gx + 2.2) + "," + gy + ' l0.4,-3.4" stroke="#8e9a52" stroke-width="0.7" opacity="0.6"/>');
    }

    var phase = opts.phase;
    var castleColor = phase === "final" && opts.captured ? opts.attackerColor : opts.defenderColor;
    s.push(battleCastle(352, 150, castleColor, phase === "final" && opts.captured));
    if (!(phase === "final" && opts.captured)) s.push(battleCamp(14, 128, opts.attackerColor));

    if (phase === "intro") {
      var atkTypes = [];
      var defTypes = [];
      (opts.rounds || []).forEach(function (r) {
        if (r.attackerType) atkTypes.push(r.attackerType);
        if (r.defenderType) defTypes.push(r.defenderType);
      });
      atkTypes.slice(0, 5).forEach(function (tid, i) {
        s.push(
          '<g style="--rw-fc:' + esc(opts.attackerColor) + '" transform="translate(' + (112 + i * 17 - (i % 2) * 6) + "," + (groundY + (i % 2) * 9 - 4) + ') scale(1.05)"><use href="#rw-bt-fig-' + tid + '"/></g>'
        );
      });
      defTypes.slice(0, 5).forEach(function (tid, i) {
        s.push(
          '<g style="--rw-fc:' + esc(opts.defenderColor) + '" transform="translate(' + (292 - i * 17 + (i % 2) * 6) + "," + (groundY + (i % 2) * 9 - 4) + ') scale(-1.05,1.05)"><use href="#rw-bt-fig-' + tid + '"/></g>'
        );
      });
      s.push(stamp(200, 108, lb.deployed || "", "rw-bt-stamp-intro", 26));
      s.push(infoPlate(8, 8, 150, "start", opts.attackerColor, opts.attackerName, (lb.troops || "") + " " + opts.attackerTotal));
      s.push(infoPlate(242, 8, 150, "end", opts.defenderColor, opts.defenderName + "・" + opts.nodeName, (lb.troops || "") + " " + opts.defenderTotal));
    } else if (phase === "round") {
      var r = opts.round;
      var aT = r.attackerType;
      // 預備隊應戰：守方這格沒排兵，以城兵（具足兵造型）出城迎擊
      var dT = r.defenderType || (r.reserve ? "ashigaru" : null);
      if (aT) s.push(squadMarkup(aT, "atk", opts.attackerColor, fallenOf(r.attackerAmount, r.attackerLoss), 186, groundY, { animate: true }));
      if (dT) s.push(squadMarkup(dT, "def", opts.defenderColor, fallenOf(r.defenderAmount, r.defenderLoss), 214, groundY, { animate: true }));

      // 遠程兵種的齊射
      [["atk", aT, 140, 1], ["def", dT, 260, -1]].forEach(function (sv) {
        if (!sv[1] || !RANGED[sv[1]]) return;
        var shots = "";
        for (var k = 0; k < 4; k++) {
          var sy = 160 + k * 6;
          if (sv[1] === "archer") shots += '<path d="M' + sv[2] + "," + sy + " l" + 9 * sv[3] + ',-2" stroke="#2b2015" stroke-width="0.7"/>';
          else shots += '<circle cx="' + sv[2] + '" cy="' + sy + '" r="0.9" fill="#ffcf6b"/>';
        }
        s.push('<g class="rw-bt-shot rw-bt-shot-' + sv[0] + '">' + shots + "</g>");
        if (sv[1] === "gun") {
          s.push('<g class="rw-bt-smoke-puff"><circle cx="' + (sv[2] + 18 * sv[3]) + '" cy="164" r="5"/><circle cx="' + (sv[2] + 12 * sv[3]) + '" cy="170" r="4"/><circle cx="' + (sv[2] + 22 * sv[3]) + '" cy="172" r="4.5"/></g>');
        }
      });

      // 交鋒閃光與塵煙
      if (aT && dT) {
        s.push('<g class="rw-bt-dust"><circle cx="192" cy="184" r="9"/><circle cx="208" cy="186" r="10"/><circle cx="200" cy="178" r="7"/></g>');
        s.push(
          '<g class="rw-bt-flash"><circle cx="200" cy="166" r="22" fill="url(#rw-bt-flash-g)"/><polygon points="200,146 204,160 218,156 207,166 220,176 204,172 200,188 196,172 180,176 193,166 182,156 196,160" fill="#fff6d0"/></g>'
        );
      }

      var mulA = aT && r.defenderType ? D.matchupMultiplier(aT, r.defenderType) : 1;
      var tn = opts.tacticName || function (x) {
        return x;
      };
      var aTac = aT && r.attackerTactic && r.attackerTactic !== "normal" ? "［" + tn(r.attackerTactic) + "］" : "";
      var dTac = r.defenderType && r.defenderTactic && r.defenderTactic !== "normal" ? "［" + tn(r.defenderTactic) + "］" : "";
      s.push(
        infoPlate(8, 8, 150, "start", opts.attackerColor, opts.attackerName, aT ? opts.typeIcon(aT) + " " + opts.typeName(aT) + " ×" + r.attackerAmount + aTac : "—")
      );
      s.push(
        infoPlate(
          242,
          8,
          150,
          "end",
          opts.defenderColor,
          opts.defenderName,
          r.reserve ? "🏯 " + (lb.reserve || "") + " ×" + r.defenderAmount : r.defenderType ? opts.typeIcon(r.defenderType) + " " + opts.typeName(r.defenderType) + " ×" + r.defenderAmount + dTac : "—"
        )
      );
      if (r.retreatAfter) s.push(stamp(200, 92, lb.stampRetreat || "", "rw-bt-stamp-lose", 18));
      s.push('<text x="200" y="22" text-anchor="middle" class="rw-bt-round-label">' + esc(lb.round || "") + "</text>");
      if (mulA > 1) s.push(stamp(178, 56, lb.advantage || "", "rw-bt-stamp-adv", 15));
      else if (mulA < 1) s.push(stamp(222, 56, lb.advantage || "", "rw-bt-stamp-adv", 15));
      if (r.attackerLoss) s.push('<text x="150" y="128" text-anchor="middle" class="rw-bt-loss">-' + r.attackerLoss + "</text>");
      if (r.defenderLoss) s.push('<text x="250" y="128" text-anchor="middle" class="rw-bt-loss">-' + r.defenderLoss + "</text>");
    } else {
      // 終局：勝方部隊在城前列陣
      var winColor = opts.captured ? opts.attackerColor : opts.defenderColor;
      var types = [];
      (opts.rounds || []).forEach(function (rr) {
        var tid = opts.captured ? rr.attackerType : rr.defenderType;
        if (tid) types.push(tid);
      });
      types.slice(0, 5).forEach(function (tid, i) {
        var x = opts.captured ? 214 + i * 18 - (i % 2) * 5 : 300 - i * 18 + (i % 2) * 5;
        var flip = opts.captured ? 1 : -1;
        s.push(
          '<g style="--rw-fc:' + esc(winColor) + '" transform="translate(' + x + "," + (groundY + (i % 2) * 9 - 4) + ") scale(" + 1.05 * flip + ',1.05)"><g class="rw-bt-cheer" style="animation-delay:' + i * 0.12 + 's"><use href="#rw-bt-fig-' + tid + '"/></g></g>'
        );
      });
      var finalText = opts.retreated ? lb.stampRetreat || "" : opts.captured ? lb.stampCaptured || "" : lb.stampRepelled || "";
      s.push(stamp(150, 100, finalText, opts.playerWon ? "rw-bt-stamp-win" : "rw-bt-stamp-lose", 34));
      s.push(infoPlate(8, 8, 150, "start", opts.attackerColor, opts.attackerName, (lb.troops || "") + " " + opts.attackerTotal));
      s.push(infoPlate(242, 8, 150, "end", opts.defenderColor, opts.defenderName + "・" + opts.nodeName, (lb.troops || "") + " " + opts.defenderTotal));
    }

    var svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 400 210");
    svg.setAttribute("class", "rw-bt");
    svg.setAttribute("role", "img");
    svg.innerHTML = s.join("");
    return svg;
  }

  window.PriTestReiwaArt = {
    renderMap: renderMap,
    castleStage: castleStage,
    battleScene: battleScene,
    _buildCastleScene: buildCastleScene,
  };
})();
