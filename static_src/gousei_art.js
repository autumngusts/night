// 武俠合成／和風合成（gousei）：物體圖像與美術風格切換（使用者指定 2026-10-26：「增加美術，武俠合成內美術風格變換」）。
// 物體有八千多種，不逐一作畫：依「分類圖案」＋物體 id 雜湊的配色與擺放＋階段裝飾＋名稱首字，全部用程式畫 SVG。
//   icon(themeId, item, name, size)：物體圖示（目前風格；風格是 none 時回傳 ""）
//   STYLES / style() / setStyle(id)：風格清單與目前風格（存在這台瀏覽器 localStorage）
// 風格會依主題換名字與細節：武俠＝水墨／工筆彩繪／像素／印章；和風＝墨繪／浮世繪／像素／家紋。
(function () {
  "use strict";

  var STYLE_KEY = "pritest-gousei-art";
  var STYLES = ["gongbi", "ink", "pixel", "seal", "none"];
  var current = (function () {
    try { var s = localStorage.getItem(STYLE_KEY); return STYLES.indexOf(s) >= 0 ? s : "gongbi"; } catch (e) { return "gongbi"; }
  })();
  function style() { return current; }
  function setStyle(s) {
    if (STYLES.indexOf(s) < 0) return;
    current = s;
    try { localStorage.setItem(STYLE_KEY, s); } catch (e) { /* 只是記不住 */ }
  }

  // FNV-1a：同一個物體永遠同一組配色與擺放
  function hash(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return h >>> 0;
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  // ---------------- 分類圖案（100×100；m 主色、a 輔色、l 線條、d 深色細節） ----------------
  var MOTIF = {
    metal: [["m", "M22 62 L32 40 H68 L78 62 Z"], ["a", "M32 40 L38 30 H62 L68 40 Z"], ["l", "M30 52 H70"]],
    wood: [["d", "M48 86 V40"], ["m", "M50 18 C30 26 26 48 50 56 C74 48 70 26 50 18 Z"], ["a", "M30 50 C18 54 18 70 34 70 C44 66 42 56 30 50 Z"], ["a", "M70 50 C82 54 82 70 66 70 C56 66 58 56 70 50 Z"]],
    water: [["m", "M50 14 C40 32 30 44 30 58 A20 20 0 0 0 70 58 C70 44 60 32 50 14 Z"], ["l", "M18 82 Q30 74 42 82 T66 82 T90 82"], ["a", "M42 56 A9 9 0 0 0 50 66"]],
    fire: [["m", "M50 12 C62 30 76 40 72 62 A22 22 0 0 1 28 62 C26 46 38 40 40 26 C46 34 46 40 50 44 C54 34 52 24 50 12 Z"], ["a", "M50 46 C58 56 62 62 58 72 A9 9 0 0 1 42 72 C40 64 46 58 50 46 Z"]],
    earth: [["m", "M10 80 L36 40 L50 56 L64 32 L90 80 Z"], ["a", "M58 44 L64 32 L72 46 Z"], ["l", "M10 86 H90"]],
    thunder: [["m", "M56 10 L26 54 H46 L38 90 L74 42 H54 Z"]],
    wind: [["l", "M14 36 H62 A10 10 0 1 0 52 26"], ["l", "M14 52 H76 A12 12 0 1 1 64 64"], ["l", "M20 68 H48"]],
    nature: [["a", "M70 30 A12 12 0 1 1 69.9 30 Z"], ["m", "M6 84 L34 44 L48 62 L62 46 L94 84 Z"], ["l", "M14 22 Q24 16 34 22 T54 22"]],
    material: [["m", "M18 70 L30 50 H54 L62 70 Z"], ["a", "M44 50 L52 32 H74 L84 50 Z"], ["d", "M40 70 L48 84 H70 L62 70 Z"]],
    herb: [["d", "M50 88 C50 70 46 56 40 44"], ["m", "M40 44 C20 40 14 22 24 12 C40 14 48 28 40 44 Z"], ["a", "M48 60 C62 46 80 48 86 58 C76 70 60 70 48 60 Z"], ["l", "M24 14 L40 42 M84 58 L50 60"]],
    plant: [["d", "M50 88 V50"], ["m", "M50 50 C38 40 36 24 50 14 C64 24 62 40 50 50 Z"], ["a", "M50 62 C36 66 22 60 20 48 C34 44 46 50 50 62 Z"], ["a", "M50 62 C64 66 78 60 80 48 C66 44 54 50 50 62 Z"]],
    elixir: [["m", "M50 30 A14 14 0 1 1 49.9 30 Z"], ["m", "M50 50 C24 54 24 90 50 90 C76 90 76 54 50 50 Z"], ["d", "M44 14 H56 V22 H44 Z"], ["a", "M36 60 Q50 66 64 60"]],
    food: [["m", "M14 52 H86 C84 72 70 84 50 84 C30 84 16 72 14 52 Z"], ["a", "M24 52 C30 44 70 44 76 52 Z"], ["l", "M36 38 Q30 30 36 22 M50 38 Q44 28 50 18 M64 38 Q58 30 64 22"]],
    weapon: [["m", "M72 10 L80 18 L36 70 L28 62 Z"], ["d", "M22 58 L40 76 L36 80 L18 62 Z"], ["a", "M26 72 L14 86 L18 90 L32 78 Z"]],
    gear: [["m", "M50 22 L56 22 L58 30 L66 34 L73 29 L77 33 L72 40 L76 48 L84 50 V56 L76 58 L72 66 L77 73 L73 77 L66 72 L58 76 L56 84 H50 L48 76 L40 72 L33 77 L29 73 L34 66 L30 58 L22 56 V50 L30 48 L34 40 L29 33 L33 29 L40 34 L48 30 Z"], ["a", "M53 42 A11 11 0 1 1 52.9 42 Z"]],
    tool: [["d", "M30 84 L62 44 L68 50 L36 90 Z"], ["m", "M56 20 L84 48 L74 58 L46 30 Z"], ["a", "M56 20 L64 12 L92 40 L84 48 Z"]],
    martial: [["m", "M36 40 H66 A8 8 0 0 1 74 48 V66 A12 12 0 0 1 62 78 H40 A10 10 0 0 1 30 68 V46 A6 6 0 0 1 36 40 Z"], ["a", "M36 40 V30 A6 6 0 0 1 48 30 V40 M48 40 V28 A6 6 0 0 1 60 28 V40"], ["l", "M10 40 H24 M8 54 H22 M12 68 H24"]],
    art: [["m", "M50 50 L72 26 L80 34 Z"], ["m", "M50 50 L26 28 L20 36 Z"], ["a", "M50 50 L74 72 L66 80 Z"], ["a", "M50 50 L28 74 L22 66 Z"], ["d", "M44 44 H56 V56 H44 Z"]],
    person: [["m", "M50 20 A14 14 0 1 1 49.9 20 Z"], ["a", "M22 88 C22 62 34 54 50 54 C66 54 78 62 78 88 Z"], ["d", "M36 28 Q50 12 64 28 Q58 22 50 22 Q42 22 36 28 Z"]],
    sect: [["a", "M14 34 L50 14 L86 34 Z"], ["m", "M24 34 H76 V40 H24 Z"], ["m", "M30 40 V86 H40 V54 H60 V86 H70 V40 Z"], ["d", "M40 54 H60 V62 H40 Z"]],
    place: [["a", "M10 40 Q50 18 90 40 L84 44 Q50 26 16 44 Z"], ["m", "M22 44 H78 V50 H22 Z"], ["m", "M28 50 H36 V84 H28 Z M64 50 H72 V84 H64 Z"], ["d", "M18 84 H82 V90 H18 Z"]],
    beast: [["m", "M20 60 C20 36 40 22 60 26 C78 30 86 48 80 62 C74 76 56 80 42 74 L30 84 L32 70 C24 68 20 64 20 60 Z"], ["a", "M58 26 L70 10 L72 28 Z M40 30 L36 12 L50 24 Z"], ["d", "M60 46 A4 4 0 1 1 59.9 46 Z"]],
    yokai: [["m", "M50 22 C70 22 82 38 80 58 C78 76 64 86 50 86 C36 86 22 76 20 58 C18 38 30 22 50 22 Z"], ["a", "M24 30 L22 8 L40 24 Z M76 30 L78 8 L60 24 Z"], ["d", "M30 50 Q38 44 44 52 Q36 54 30 50 Z M70 50 Q62 44 56 52 Q64 54 70 50 Z"], ["l", "M42 70 Q50 76 58 70"]],
    treasure: [["m", "M50 14 L80 40 L50 88 L20 40 Z"], ["a", "M20 40 H80 L64 24 H36 Z"], ["l", "M50 14 L42 40 L50 88 L58 40 Z"]],
    concept: [["m", "M50 14 A36 36 0 0 1 50 86 A18 18 0 0 1 50 50 A18 18 0 0 0 50 14 Z"], ["l", "M50 14 A36 36 0 0 0 50 86"], ["d", "M50 28 A5 5 0 1 1 49.9 28 Z"], ["a", "M50 66 A5 5 0 1 1 49.9 66 Z"]],
    faith: [["m", "M12 26 Q50 16 88 26 L86 34 Q50 26 14 34 Z"], ["m", "M18 40 H82 V46 H18 Z"], ["m", "M28 34 H36 V88 H28 Z M64 34 H72 V88 H64 Z"], ["a", "M46 46 H54 V56 H46 Z"]],
    basic: [["m", "M50 18 A32 32 0 1 1 49.9 18 Z"]],
    junk: [["d", "M14 82 C20 66 30 62 40 66 C46 54 60 54 66 64 C76 60 86 70 86 82 Z"], ["a", "M30 52 L36 44 L40 52 Z M60 44 L66 38 L68 48 Z"], ["l", "M44 40 L48 30 M54 36 L58 26"]]
  };
  // 和風的分類對到同一組圖案
  var CAT_ALIAS = { food: "food" };
  // 初始物體有自己的圖案
  var BASIC = { metal: "metal", wood: "wood", water: "water", fire: "fire", earth: "earth", thunder: "thunder", wind: "wind" };
  function motifOf(item) {
    if (item.cat === "basic" || item.cat === "junk") return MOTIF[BASIC[item.id] || item.cat] || MOTIF.basic;
    return MOTIF[CAT_ALIAS[item.cat] || item.cat] || MOTIF.concept;
  }

  // ---------------- 像素濾鏡（整頁共用一份） ----------------
  // 濾鏡範圍要用整張 100×100（userSpaceOnUse）：預設依圖形外框，取樣格 (3,3) 會落在範圍外而整片消失
  function ensureDefs() {
    if (typeof document === "undefined" || document.getElementById("gsa-defs")) return;
    var box = document.createElement("div");
    box.id = "gsa-defs";
    box.setAttribute("aria-hidden", "true");
    box.style.cssText = "position:absolute;width:0;height:0;overflow:hidden";
    box.innerHTML = '<svg width="0" height="0"><defs>' +
      '<filter id="gsa-px" filterUnits="userSpaceOnUse" x="0" y="0" width="100" height="100"><feFlood x="3" y="3" height="1" width="1"/><feComposite width="7" height="7"/>' +
      '<feTile result="a"/><feComposite in="SourceGraphic" in2="a" operator="in"/><feMorphology operator="dilate" radius="3.5"/></filter>' +
      '<filter id="gsa-ink"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="3"/><feDisplacementMap in="SourceGraphic" scale="3"/></filter>' +
      '<pattern id="gsa-wave" width="20" height="10" patternUnits="userSpaceOnUse"><path d="M0 10 A10 10 0 0 1 20 10 M4 10 A6 6 0 0 1 16 10 M8 10 A2 2 0 0 1 12 10" fill="none" stroke="#2b5b9c" stroke-width="1.2" opacity="0.55"/></pattern>' +
      "</defs></svg>";
    document.body.appendChild(box);
  }

  function shapes(motif, colors, strokeW, extra) {
    return motif.map(function (s) {
      var role = s[0], d = s[1];
      if (role === "l") return '<path d="' + d + '" fill="none" stroke="' + colors.l + '" stroke-width="' + (strokeW + 2) + '" stroke-linecap="round" stroke-linejoin="round"' + (extra || "") + "/>";
      return '<path d="' + d + '" fill="' + colors[role] + '"' + (colors.stroke ? ' stroke="' + colors.stroke + '" stroke-width="' + strokeW + '" stroke-linejoin="round"' : "") + (extra || "") + "/>";
    }).join("");
  }
  // 階段裝飾：5 以上光環、8 以上雙環、11 以上加星
  function tierDeco(tier, color, h) {
    var s = "";
    if (tier >= 5) s += '<circle cx="50" cy="50" r="46" fill="none" stroke="' + color + '" stroke-width="2" opacity="0.8"/>';
    if (tier >= 8) s += '<circle cx="50" cy="50" r="41" fill="none" stroke="' + color + '" stroke-width="1" stroke-dasharray="3 3" opacity="0.8"/>';
    if (tier >= 11) for (var i = 0; i < 4; i++) {
      var a = (i * 90 + (h % 90)) * Math.PI / 180, x = 50 + Math.cos(a) * 44, y = 50 + Math.sin(a) * 44;
      s += '<path d="M' + x.toFixed(1) + " " + (y - 5).toFixed(1) + " L" + (x + 1.5).toFixed(1) + " " + (y - 1.5).toFixed(1) + " L" + (x + 5).toFixed(1) + " " + y.toFixed(1) + " L" + (x + 1.5).toFixed(1) + " " + (y + 1.5).toFixed(1) + " L" + x.toFixed(1) + " " + (y + 5).toFixed(1) + " L" + (x - 1.5).toFixed(1) + " " + (y + 1.5).toFixed(1) + " L" + (x - 5).toFixed(1) + " " + y.toFixed(1) + " L" + (x - 1.5).toFixed(1) + " " + (y - 1.5).toFixed(1) + ' Z" fill="' + color + '"/>';
    }
    return s;
  }
  var SERIF = "'Noto Serif TC','Noto Serif JP','Songti TC','PMingLiU','MS Mincho',serif";
  // 和風浮世繪的配色（藍、朱、黃土、松葉、紫）
  var UKIYO = [["#2b5b9c", "#d9a441"], ["#c0392b", "#2b5b9c"], ["#c98a2b", "#3d6b4a"], ["#3d6b4a", "#c0392b"], ["#6b3d7a", "#d9a441"]];
  var PIXEL = ["#ff5a5a", "#ffb03a", "#ffe066", "#5ad36b", "#4ab0ff", "#9b7bff", "#ff7bd0", "#61e3d9"];

  // item：{ id, cat, tier }；name：要顯示的名稱（用首字當落款）
  function icon(themeId, item, name, size, styleId) {
    var st = styleId || current;
    if (st === "none" || !item) return "";
    ensureDefs();
    var h = hash(themeId + ":" + item.id);
    var hue = h % 360;
    var motif = motifOf(item);
    var junk = item.cat === "junk";
    var tier = item.tier || 0;
    var rot = ((h >>> 9) % 17) - 8;
    var flip = (h >>> 13) % 2 && item.cat !== "basic" ? " scale(-1 1) translate(-100 0)" : "";
    var tf = ' transform="rotate(' + rot + ' 50 50)' + flip + '"';
    var ch = esc(String(name || "").charAt(0));
    var wafu = themeId === "wafu";
    var body = "";
    if (st === "ink") {
      // 水墨／墨繪：宣紙、墨韻圓相、朱印
      var gray = junk ? "#8a8579" : "#1d1b18";
      body = '<rect width="100" height="100" rx="12" fill="#f4eddc"/>' +
        '<circle cx="50" cy="50" r="40" fill="none" stroke="#2a2723" stroke-width="5" stroke-dasharray="' + (200 + h % 40) + ' 60" stroke-linecap="round" opacity="0.28" transform="rotate(' + (h % 360) + ' 50 50)" filter="url(#gsa-ink)"/>' +
        '<g transform="translate(14 12) scale(0.72)"><g' + tf + ' filter="url(#gsa-ink)">' + shapes(motif, { m: gray, a: "rgba(40,36,30,0.45)", d: "#000", l: gray }, 0) + "</g></g>" +
        (tier >= 5 ? '<circle cx="50" cy="50" r="46" fill="none" stroke="#1d1b18" stroke-width="1" opacity="0.5"/>' : "") +
        '<rect x="68" y="68" width="24" height="24" rx="' + (wafu ? 12 : 3) + '" fill="#c0392b"/>' +
        '<text x="80" y="86" font-size="17" text-anchor="middle" fill="#fbe9e4" font-family="' + SERIF + '" font-weight="700">' + ch + "</text>";
    } else if (st === "gongbi") {
      if (wafu) {
        // 浮世繪：粗黑輪廓、平塗、青海波
        var pal = UKIYO[h % UKIYO.length];
        body = '<rect width="100" height="100" rx="12" fill="#f3e7cc"/><rect y="62" width="100" height="38" fill="url(#gsa-wave)"/>' +
          '<g transform="translate(10 8) scale(0.8)"><g' + tf + ">" + shapes(motif, { m: junk ? "#9a9488" : pal[0], a: junk ? "#c8c1b2" : pal[1], d: "#1b1b1b", l: "#1b1b1b", stroke: "#1b1b1b" }, 3.5) + "</g></g>" +
          tierDeco(tier, "#c0392b", h);
      } else {
        // 工筆彩繪：絹底、金線勾勒、淡彩
        var main = junk ? "#a39c8e" : "hsl(" + hue + ",52%,48%)", acc = junk ? "#cfc8b9" : "hsl(" + ((hue + 40) % 360) + ",62%,66%)";
        body = '<defs><radialGradient id="gg' + h + '" cx="50%" cy="40%" r="70%"><stop offset="0" stop-color="#fbf3df"/><stop offset="1" stop-color="#e8d5aa"/></radialGradient></defs>' +
          '<rect width="100" height="100" rx="12" fill="url(#gg' + h + ')"/>' +
          '<g transform="translate(10 8) scale(0.8)"><g' + tf + ">" + shapes(motif, { m: main, a: acc, d: "#4a2f12", l: "#8a6a1f", stroke: "#8a6a1f" }, 2) + "</g></g>" +
          tierDeco(tier, "#b8860b", h);
      }
    } else if (st === "pixel") {
      var c1 = junk ? "#8d8d8d" : PIXEL[h % PIXEL.length], c2 = junk ? "#5a5a5a" : PIXEL[(h >>> 4) % PIXEL.length];
      body = '<rect width="100" height="100" rx="6" fill="#1d2033"/>' +
        '<g filter="url(#gsa-px)"><g transform="translate(10 8) scale(0.8)"><g' + tf + ">" + shapes(motif, { m: c1, a: c2, d: "#0b0c14", l: "#f4f4f4", stroke: "#0b0c14" }, 4) + "</g></g>" +
        (tier >= 5 ? '<rect x="4" y="4" width="92" height="92" fill="none" stroke="#ffe066" stroke-width="4"/>' : "") + "</g>" +
        (tier >= 8 ? '<rect x="80" y="6" width="10" height="10" fill="#ffe066"/>' : "");
    } else if (st === "seal") {
      if (wafu) {
        // 家紋：黑底圓、白色剪影、外環
        body = '<rect width="100" height="100" rx="12" fill="#efe6d2"/><circle cx="50" cy="50" r="44" fill="' + (junk ? "#77736a" : "#1f1d1a") + '"/>' +
          '<circle cx="50" cy="50" r="38" fill="none" stroke="#efe6d2" stroke-width="2"/>' +
          '<g transform="translate(22 22) scale(0.56)"><g' + tf + ">" + shapes(motif, { m: "#efe6d2", a: "#efe6d2", d: "#1f1d1a", l: "#efe6d2" }, 0) + "</g></g>" +
          (tier >= 8 ? '<circle cx="50" cy="50" r="47" fill="none" stroke="#c0392b" stroke-width="2.5"/>' : "");
      } else {
        // 印章：朱紅方印、刻名稱首字（陰刻）、角落小圖案
        var red = junk ? "#8a7d78" : "#b8322a";
        body = '<rect width="100" height="100" rx="12" fill="#f5efe2"/>' +
          '<rect x="10" y="10" width="80" height="80" rx="' + (6 + h % 8) + '" fill="' + red + '" filter="url(#gsa-ink)"/>' +
          '<rect x="16" y="16" width="68" height="68" rx="4" fill="none" stroke="#f5efe2" stroke-width="2"/>' +
          '<text x="50" y="66" font-size="46" text-anchor="middle" fill="#f5efe2" font-family="' + SERIF + '" font-weight="700">' + ch + "</text>" +
          '<g transform="translate(66 18) scale(0.16)">' + shapes(motif, { m: "#f5efe2", a: "#f5efe2", d: red, l: "#f5efe2" }, 0) + "</g>" +
          (tier >= 8 ? '<rect x="5" y="5" width="90" height="90" rx="14" fill="none" stroke="#b8860b" stroke-width="2"/>' : "");
      }
    }
    var px = size || 40;
    return '<svg class="gsa-icon gsa-' + st + '" viewBox="0 0 100 100" width="' + px + '" height="' + px + '" aria-hidden="true" focusable="false">' + body + "</svg>";
  }

  window.PriTestGouseiArt = { STYLES: STYLES, style: style, setStyle: setStyle, icon: icon, MOTIFS: Object.keys(MOTIF) };
})();
