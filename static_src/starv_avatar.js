// 明星經紀 starV：藝人 2D 頭像（SVG 字串；規格 §3.5）。
// 純函式：同一組 look 一定畫出同一張圖，結果以字串快取。不使用 id（漸層、clipPath），同一頁可以重複插入。
// 3D 模型（計畫 7）讀取同一組外觀參數，所以兩邊長相一致。
(function () {
  "use strict";

  var root = typeof window !== "undefined" ? window : globalThis;
  var D = root.PriTestStarvData;
  var cache = {};
  var DEFAULT_LOOK = { face: 0, hair: 0, hairColor: 0, eye: 0, outfit: 0, acc: -1, skin: 0 };
  var OUTFITS = ["#ff5fa8", "#7c4dff", "#26a69a", "#ffd66b", "#4dd0e1", "#ef5350", "#f5f5f5", "#37474f"];
  var FACES = [[22, 25], [21, 24], [23, 24], [20, 26]];   // 臉的 rx, ry
  var INK = "#2b2238";

  function at(list, i) { var n = list.length; return list[((i % n) + n) % n]; }

  // 後髮：0 短髮（沒有）、1 鮑伯、2 長髮、3 雙馬尾
  function backHair(len, c) {
    if (len === 1) return '<path d="M24 46 Q22 74 34 76 L66 76 Q78 74 76 46 Z" fill="' + c + '"/>';
    if (len === 2) return '<path d="M24 44 Q18 90 30 100 L70 100 Q82 90 76 44 Z" fill="' + c + '"/>';
    if (len === 3) {
      return '<circle cx="21" cy="58" r="9" fill="' + c + '"/><circle cx="79" cy="58" r="9" fill="' + c + '"/>' +
        '<path d="M18 60 Q12 80 20 88 Q24 76 24 62 Z M82 60 Q88 80 80 88 Q76 76 76 62 Z" fill="' + c + '"/>';
    }
    return "";
  }

  // 瀏海：0 齊瀏海、1 斜瀏海、2 中分
  function bangs(style, c) {
    if (style === 1) return '<path d="M26 48 Q24 18 50 18 Q76 18 74 48 Q72 36 66 32 Q52 42 30 40 Q28 44 26 48 Z" fill="' + c + '"/>';
    if (style === 2) return '<path d="M26 50 Q24 18 50 18 Q76 18 74 50 Q70 32 52 28 L50 34 L48 28 Q30 32 26 50 Z" fill="' + c + '"/>';
    return '<path d="M26 48 Q24 18 50 18 Q76 18 74 48 L73 40 Q50 34 27 40 Z" fill="' + c + '"/>';
  }

  function eyes(style) {
    var y = 51;
    function both(fn) { return fn(41) + fn(59); }
    switch (style) {
      case 1: return both(function (x) {
        return '<ellipse cx="' + x + '" cy="' + y + '" rx="2.6" ry="4" fill="' + INK + '"/><circle cx="' + (x + 1) + '" cy="' + (y - 1.5) + '" r="1" fill="#fff"/>';
      });
      case 2: return both(function (x) {
        return '<path d="M' + (x - 3.5) + " " + (y + 1) + " Q" + x + " " + (y - 3.5) + " " + (x + 3.5) + " " + (y + 1) + '" stroke="' + INK + '" stroke-width="1.6" fill="none" stroke-linecap="round"/>';
      });
      case 3: return both(function (x) {
        return '<path d="M' + (x - 4) + " " + y + " Q" + x + " " + (y - 4) + " " + (x + 4) + " " + (y - 1) + " Q" + x + " " + (y + 3) + " " + (x - 4) + " " + y + ' Z" fill="' + INK + '"/>';
      });
      case 4: return both(function (x) {
        return '<ellipse cx="' + x + '" cy="' + y + '" rx="3.4" ry="4.4" fill="#3a2a5a"/><circle cx="' + (x + 1.2) + '" cy="' + (y - 1.8) + '" r="1.4" fill="#fff"/>' +
          '<circle cx="' + (x - 1.2) + '" cy="' + (y + 1.6) + '" r="0.7" fill="#fff"/>';
      });
      case 5: return both(function (x) {
        return '<path d="M' + (x - 3.5) + " " + y + " L" + (x + 3.5) + " " + y + '" stroke="' + INK + '" stroke-width="1.8" stroke-linecap="round"/>' +
          '<path d="M' + (x - 3) + " " + (y + 0.5) + " Q" + x + " " + (y + 3) + " " + (x + 3) + " " + (y + 0.5) + '" fill="' + INK + '"/>';
      });
      default: return both(function (x) {
        return '<circle cx="' + x + '" cy="' + y + '" r="3" fill="' + INK + '"/><circle cx="' + (x + 1) + '" cy="' + (y - 1) + '" r="0.9" fill="#fff"/>';
      });
    }
  }

  function accessory(i) {
    switch (i) {
      case 0: return '<path d="M62 22 L72 16 L72 28 Z M62 22 L52 16 L52 28 Z" fill="#ff4f8b"/><circle cx="62" cy="22" r="2.4" fill="#ffd0e0"/>';
      case 1: return '<g fill="none" stroke="#222" stroke-width="1.4"><circle cx="41" cy="51" r="5.5"/><circle cx="59" cy="51" r="5.5"/><path d="M46.5 51 L53.5 51"/></g>';
      case 2: return '<circle cx="27" cy="60" r="2" fill="#ffd66b"/><circle cx="73" cy="60" r="2" fill="#ffd66b"/>';
      case 3: return '<path d="M34 26 L36 30.2 L40.6 30.8 L37.2 33.9 L38.1 38.4 L34 36.2 L29.9 38.4 L30.8 33.9 L27.4 30.8 L32 30.2 Z" fill="#ffd66b"/>';
      case 4: return '<path d="M24 50 Q24 14 50 14 Q76 14 76 50" fill="none" stroke="#333" stroke-width="3.5"/>' +
        '<rect x="19" y="44" width="8" height="14" rx="3" fill="#a66bff"/><rect x="73" y="44" width="8" height="14" rx="3" fill="#a66bff"/>';
      case 5: return '<ellipse cx="46" cy="20" rx="24" ry="8" fill="#c62828"/><circle cx="46" cy="12" r="2" fill="#c62828"/>';
    }
    return "";
  }

  function svg(look, opts) {
    look = look || DEFAULT_LOOK;
    opts = opts || {};
    var bg = opts.bg || "#7c4dff";
    var key = [look.face, look.hair, look.hairColor, look.eye, look.outfit, look.acc, look.skin, bg].join("|");
    if (cache[key]) return cache[key];
    var skin = at(D.LOOK.skins, look.skin), hc = at(D.LOOK.hairColors, look.hairColor), out = at(OUTFITS, look.outfit);
    var f = at(FACES, look.face), hair = ((look.hair % 12) + 12) % 12;
    var html = [
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" class="sv-ava-svg" aria-hidden="true">',
      '<rect width="100" height="100" fill="' + bg + '"/>',
      '<circle cx="78" cy="18" r="30" fill="#fff" opacity="0.14"/><circle cx="12" cy="92" r="26" fill="#000" opacity="0.12"/>',
      backHair(Math.floor(hair / 3), hc),
      '<path d="M14 100 Q18 76 50 74 Q82 76 86 100 Z" fill="' + out + '"/>',
      look.outfit % 2 ? '<path d="M42 75 L50 88 L58 75 Z" fill="' + skin + '"/>' : '<path d="M40 75 Q50 84 60 75 Z" fill="' + skin + '"/>',
      '<rect x="44" y="64" width="12" height="12" fill="' + skin + '"/>',
      '<ellipse cx="' + (50 - f[0]) + '" cy="52" rx="3" ry="4.5" fill="' + skin + '"/><ellipse cx="' + (50 + f[0]) + '" cy="52" rx="3" ry="4.5" fill="' + skin + '"/>',
      '<ellipse cx="50" cy="48" rx="' + f[0] + '" ry="' + f[1] + '" fill="' + skin + '"/>',
      bangs(hair % 3, hc),
      eyes(((look.eye % 6) + 6) % 6),
      '<ellipse cx="36" cy="58" rx="3.2" ry="1.8" fill="#ff7a9a" opacity="0.35"/><ellipse cx="64" cy="58" rx="3.2" ry="1.8" fill="#ff7a9a" opacity="0.35"/>',
      '<path d="M46 62 Q50 65 54 62" stroke="#b5485d" stroke-width="1.5" fill="none" stroke-linecap="round"/>',
      look.acc >= 0 ? accessory(look.acc % 6) : "",
      "</svg>"
    ].join("");
    cache[key] = html;
    return html;
  }

  root.PriTestStarvAvatar = { svg: svg, OUTFITS: OUTFITS };
})();
