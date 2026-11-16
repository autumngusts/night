// 百鬼轉珠（tama）：妖怪的 SVG 圖（全部在這裡以程式繪製的原創圖，不使用外部圖檔）。
// PriTestTamaArt.enemy(key) 回傳 <svg> 字串（viewBox 0 0 120 120）；畫面依容器大小縮放。
(function () {
  "use strict";

  function svg(inner, defs) {
    return '<svg class="tm-art" viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
      (defs ? "<defs>" + defs + "</defs>" : "") + inner + "</svg>";
  }
  // 發光的妖怪眼睛
  function eye(x, y, r, color) {
    return '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" fill="' + (color || "#fff6c8") + '"/>' +
      '<circle cx="' + x + '" cy="' + (y + r * 0.1) + '" r="' + (r * 0.45) + '" fill="#1b0f12"/>';
  }
  function grad(id, a, b) {
    return '<radialGradient id="' + id + '" cx="50%" cy="40%" r="65%"><stop offset="0%" stop-color="' + a + '"/><stop offset="100%" stop-color="' + b + '"/></radialGradient>';
  }
  function lgrad(id, a, b) {
    return '<linearGradient id="' + id + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="' + a + '"/><stop offset="100%" stop-color="' + b + '"/></linearGradient>';
  }

  var ART = {
    // 鬼火：搖曳的火焰魂
    onibi: function () {
      return svg(
        '<path d="M60 12 C72 34 92 44 88 74 C85 98 70 108 60 108 C46 108 32 98 32 76 C32 58 46 52 46 36 C54 44 56 30 60 12Z" fill="url(#tmOnA)"/>' +
        '<path d="M60 44 C68 58 78 64 76 82 C74 96 66 100 60 100 C52 100 44 94 44 82 C44 70 54 66 60 44Z" fill="#ffe08a" opacity="0.85"/>' +
        eye(52, 78, 5) + eye(68, 78, 5) +
        '<path d="M54 90 Q60 95 66 90" stroke="#5a1a0a" stroke-width="2.5" fill="none" stroke-linecap="round"/>',
        lgrad("tmOnA", "#ffb14a", "#d6331f"));
    },
    // 木靈：白色小人、黑洞般的眼口、頭上一片葉
    kodama: function () {
      return svg(
        '<path d="M60 30 C80 30 90 44 88 60 C86 72 76 76 72 78 L74 104 L64 104 L60 86 L56 104 L46 104 L48 78 C44 76 34 72 32 60 C30 44 40 30 60 30Z" fill="#eef2e6" stroke="#9fb08e" stroke-width="2"/>' +
        '<ellipse cx="50" cy="54" rx="5" ry="7" fill="#1d241a"/><ellipse cx="70" cy="54" rx="5" ry="7" fill="#1d241a"/>' +
        '<ellipse cx="60" cy="68" rx="4" ry="5" fill="#1d241a"/>' +
        '<path d="M60 30 C58 18 66 10 78 12 C76 22 70 28 60 30Z" fill="#58a04a"/><path d="M60 30 L72 15" stroke="#2f6a2a" stroke-width="1.5"/>');
    },
    // 河童：綠色身體、頭上的盤子、黃色嘴、龜殼
    kappa: function () {
      return svg(
        '<ellipse cx="60" cy="88" rx="30" ry="22" fill="#5b7a3a"/><path d="M38 84 Q60 70 82 84" stroke="#3b5226" stroke-width="3" fill="none"/>' +
        '<circle cx="60" cy="52" r="26" fill="url(#tmKpA)"/>' +
        '<ellipse cx="60" cy="30" rx="18" ry="6" fill="#dfeff2" stroke="#8fb5bd" stroke-width="2"/>' +
        '<path d="M42 32 L36 22 M50 28 L48 18 M70 28 L72 18 M78 32 L84 22" stroke="#24331a" stroke-width="3" stroke-linecap="round"/>' +
        eye(50, 50, 6) + eye(70, 50, 6) +
        '<path d="M50 62 Q60 74 70 62 Q60 66 50 62Z" fill="#f2c23a" stroke="#a3781a" stroke-width="1.5"/>' +
        '<path d="M32 72 L18 80 M88 72 L102 80" stroke="#6f9a46" stroke-width="7" stroke-linecap="round"/>',
        grad("tmKpA", "#9fd06a", "#4f8a34"));
    },
    // 提燈妖怪：破紙燈籠、一隻大眼、長舌
    chochin: function () {
      return svg(
        '<rect x="48" y="10" width="24" height="8" rx="2" fill="#2a1a12"/><rect x="48" y="102" width="24" height="8" rx="2" fill="#2a1a12"/>' +
        '<ellipse cx="60" cy="60" rx="34" ry="44" fill="url(#tmChA)" stroke="#7a2a12" stroke-width="2"/>' +
        '<path d="M28 42 H92 M26 60 H94 M28 78 H92" stroke="#b5532a" stroke-width="1.5" opacity="0.6"/>' +
        '<path d="M70 28 L80 38 L72 40Z" fill="#2a1a12" opacity="0.7"/>' +
        eye(60, 50, 12) +
        '<path d="M44 72 Q60 84 76 72 Z" fill="#3a0d0d"/><path d="M56 76 Q60 104 66 96 Q64 84 64 76Z" fill="#e0526a"/>',
        grad("tmChA", "#fff0c0", "#f08a3a"));
    },
    // 唐傘妖怪：紫色紙傘、一眼、舌頭、一隻腳
    karakasa: function () {
      return svg(
        '<path d="M14 64 Q60 -6 106 64 Q96 58 86 64 Q76 56 66 64 Q60 58 54 64 Q44 56 34 64 Q24 58 14 64Z" fill="url(#tmKrA)" stroke="#3a1a4a" stroke-width="2"/>' +
        '<path d="M60 14 L36 62 M60 14 L84 62 M60 14 L60 62" stroke="#3a1a4a" stroke-width="1.2" opacity="0.6"/>' +
        eye(60, 42, 9) +
        '<path d="M60 62 L60 96" stroke="#c9a46a" stroke-width="5"/><path d="M60 96 Q50 104 48 112 L72 112 Q70 104 60 96Z" fill="#e8d6b0"/>' +
        '<path d="M64 52 Q74 70 70 76 Q66 70 62 54Z" fill="#e0526a"/>',
        lgrad("tmKrA", "#b07ad8", "#5a2a7a"));
    },
    // 一反木綿：長長的白布在空中飄
    ittan: function () {
      return svg(
        '<path d="M22 30 Q50 18 74 26 Q92 32 100 22 L104 34 Q94 46 76 42 Q60 40 56 58 Q50 80 70 92 Q84 100 78 112 L66 110 Q70 102 58 96 Q36 84 42 58 Q46 40 24 42Z" fill="url(#tmItA)" stroke="#c8c2a8" stroke-width="2"/>' +
        eye(34, 34, 4.5, "#ffe48a") + eye(46, 31, 4.5, "#ffe48a"),
        lgrad("tmItA", "#ffffff", "#e8e0c8"));
    },
    // 化貓：紫黑色的貓、兩條尾巴、發光的眼睛
    bakeneko: function () {
      return svg(
        '<path d="M86 92 Q112 72 104 40 Q100 60 84 78Z" fill="#3a2a4a"/><path d="M80 96 Q112 96 112 64 Q104 86 78 88Z" fill="#4a3460"/>' +
        '<ellipse cx="58" cy="86" rx="30" ry="22" fill="#3a2a4a"/>' +
        '<path d="M30 40 L36 14 L50 32 Q58 28 66 32 L80 14 L86 40 Q90 62 58 68 Q26 62 30 40Z" fill="url(#tmBkA)"/>' +
        '<path d="M40 44 Q46 40 52 44 Q46 50 40 44Z" fill="#f4e04a"/><path d="M64 44 Q70 40 76 44 Q70 50 64 44Z" fill="#f4e04a"/>' +
        '<path d="M45 42 V47 M70 42 V47" stroke="#1a1020" stroke-width="2"/>' +
        '<path d="M52 56 Q58 60 64 56" stroke="#e8a0c0" stroke-width="2" fill="none"/>' +
        '<path d="M30 54 H14 M30 58 L16 62 M86 54 H102 M86 58 L100 62" stroke="#c8b8e0" stroke-width="1.2"/>',
        grad("tmBkA", "#6a4a8a", "#2a1a3a"));
    },
    // 天狗：紅臉長鼻、頭襟、羽扇
    tengu: function () {
      return svg(
        '<path d="M14 40 Q4 70 26 86 L36 60Z" fill="#2f5a2a"/><path d="M16 46 L32 66 M12 58 L30 72" stroke="#1a3a16" stroke-width="1.5"/>' +
        '<path d="M28 34 Q20 70 40 96 Q60 108 80 96 Q100 70 92 34Z" fill="#1d1d24"/>' +
        '<ellipse cx="60" cy="58" rx="24" ry="28" fill="url(#tmTgA)"/>' +
        '<rect x="50" y="18" width="20" height="14" rx="3" fill="#111"/>' +
        '<path d="M42 48 L54 52 M78 48 L66 52" stroke="#2a0a0a" stroke-width="3" stroke-linecap="round"/>' +
        eye(48, 56, 4) + eye(72, 56, 4) +
        '<path d="M56 60 Q60 58 64 60 L66 92 Q60 96 58 90Z" fill="#d23a2a" stroke="#8a1a12" stroke-width="1.5"/>' +
        '<path d="M48 78 Q52 84 56 80 M64 80 Q68 84 72 78" stroke="#eee" stroke-width="2" fill="none"/>',
        grad("tmTgA", "#f06a4a", "#b02a1a"));
    },
    // 海坊主：從浪裡浮出的巨大黑色光頭
    umibozu: function () {
      return svg(
        '<path d="M14 100 Q14 22 60 18 Q106 22 106 100Z" fill="url(#tmUmA)"/>' +
        '<ellipse cx="44" cy="58" rx="9" ry="6" fill="#d8f2ff"/><ellipse cx="76" cy="58" rx="9" ry="6" fill="#d8f2ff"/>' +
        '<circle cx="44" cy="59" r="3" fill="#0a1a2a"/><circle cx="76" cy="59" r="3" fill="#0a1a2a"/>' +
        '<path d="M6 100 Q20 88 34 100 Q48 88 62 100 Q76 88 90 100 Q104 88 116 100 V116 H6Z" fill="#3a7ab8"/>' +
        '<path d="M6 108 Q20 98 34 108 Q48 98 62 108 Q76 98 90 108 Q104 98 116 108" stroke="#cfeaff" stroke-width="2" fill="none"/>',
        grad("tmUmA", "#3a5a7a", "#0d1a2a"));
    },
    // 雷獸：黃色的獸、尾巴和背上的閃電
    raiju: function () {
      return svg(
        '<path d="M80 40 L96 18 L90 40 L106 30 L92 60Z" fill="#fff07a" stroke="#c8a01a" stroke-width="1.5"/>' +
        '<path d="M86 78 Q112 70 108 46 Q98 66 84 68Z" fill="#e8c03a"/>' +
        '<ellipse cx="60" cy="78" rx="30" ry="20" fill="url(#tmRjA)"/>' +
        '<circle cx="40" cy="58" r="20" fill="url(#tmRjA)"/>' +
        '<path d="M26 44 L22 28 L36 40Z M46 40 L54 26 L56 42Z" fill="#c8a01a"/>' +
        eye(34, 56, 4.5, "#bff4ff") + eye(48, 56, 4.5, "#bff4ff") +
        '<path d="M34 68 L38 64 L42 68 L46 64" stroke="#5a3a0a" stroke-width="2" fill="none"/>' +
        '<path d="M40 96 V106 M54 98 V108 M70 98 V108 M82 94 V104" stroke="#c8a01a" stroke-width="5" stroke-linecap="round"/>',
        grad("tmRjA", "#ffe680", "#d8a020"));
    },
    // 大百足（頭目）：盤成弧形的大蜈蚣
    omukade: function () {
      var segs = "", legs = "";
      for (var i = 0; i < 9; i++) {
        var a = Math.PI * (0.15 + i * 0.105), x = 60 + Math.cos(a) * 38, y = 70 - Math.sin(a) * 40;
        var lx = Math.cos(a) * 18, ly = Math.sin(a) * 18;
        legs += '<path d="M' + (x - lx).toFixed(1) + " " + (y + ly).toFixed(1) + " L" + (x + lx * 1.1).toFixed(1) + " " + (y - ly * 1.1 + 10).toFixed(1) + '" stroke="#e8a030" stroke-width="2.5"/>';
        segs += '<ellipse cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" rx="11" ry="9" fill="url(#tmOmA)" stroke="#2a0a0a" stroke-width="1.5"/>';
      }
      return svg(legs + segs +
        '<ellipse cx="96" cy="86" rx="16" ry="13" fill="#8a1a1a" stroke="#2a0a0a" stroke-width="2"/>' +
        '<path d="M106 92 Q118 100 110 108 M100 98 Q104 112 96 112" stroke="#f0c040" stroke-width="3" fill="none"/>' +
        eye(92, 82, 4, "#ffef6a") + eye(102, 82, 4, "#ffef6a"),
        grad("tmOmA", "#5a4a2a", "#1d140a"));
    },
    // 餓者髑髏（頭目）：巨大骷髏與骨手
    gasha: function () {
      return svg(
        '<path d="M22 46 Q16 18 60 12 Q104 18 98 46 Q100 64 88 74 L86 88 L34 88 L32 74 Q20 64 22 46Z" fill="url(#tmGsA)" stroke="#6a6252" stroke-width="2"/>' +
        '<path d="M34 46 Q44 36 54 48 Q52 62 40 60 Q32 56 34 46Z M86 46 Q76 36 66 48 Q68 62 80 60 Q88 56 86 46Z" fill="#14101a"/>' +
        '<circle cx="44" cy="51" r="3" fill="#b06aff"/><circle cx="76" cy="51" r="3" fill="#b06aff"/>' +
        '<path d="M56 62 L60 70 L64 62Z" fill="#14101a"/>' +
        '<path d="M38 80 H82 M44 76 V88 M52 76 V88 M60 76 V88 M68 76 V88 M76 76 V88" stroke="#3a3428" stroke-width="2"/>' +
        '<path d="M6 112 L20 92 L24 104 L30 90 L32 104 L40 94 L38 112Z M114 112 L100 92 L96 104 L90 90 L88 104 L80 94 L82 112Z" fill="#ddd6c0" stroke="#6a6252" stroke-width="1.5"/>',
        grad("tmGsA", "#f4eedc", "#b8ae94"));
    },
    // 九尾狐（頭目）：金色狐狸、身後展開九條尾巴
    kyubi: function () {
      var tails = "";
      for (var i = 0; i < 9; i++) {
        var a = Math.PI * (0.12 + i * 0.095), x = 60 + Math.cos(a) * 52, y = 82 - Math.sin(a) * 58;
        tails += '<path d="M60 82 Q' + (60 + Math.cos(a) * 30).toFixed(1) + " " + (82 - Math.sin(a) * 20).toFixed(1) + " " + x.toFixed(1) + " " + y.toFixed(1) +
          '" stroke="url(#tmKyT)" stroke-width="11" stroke-linecap="round" fill="none"/>' +
          '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="5" fill="#fff8e0"/>';
      }
      return svg(tails +
        '<ellipse cx="60" cy="96" rx="22" ry="16" fill="#f2c060"/>' +
        '<path d="M38 66 L40 40 L52 56 Q60 52 68 56 L80 40 L82 66 Q80 88 60 92 Q40 88 38 66Z" fill="url(#tmKyA)"/>' +
        '<path d="M44 66 Q50 62 54 68 M66 68 Q70 62 76 66" stroke="#7a1a1a" stroke-width="2.5" fill="none"/>' +
        '<path d="M56 54 L60 46 L64 54Z" fill="#d23a2a"/>' +
        '<ellipse cx="60" cy="82" rx="3" ry="2.5" fill="#2a1a12"/>',
        grad("tmKyA", "#fff2c0", "#e8a83a") + '<linearGradient id="tmKyT" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#e8a83a"/><stop offset="100%" stop-color="#fff2c0"/></linearGradient>');
    }
  };

  // 各個 SVG 的漸層 id 是固定字串；同一畫面重複出現同一種妖怪時共用同一份定義，外觀一樣，不影響顯示。
  window.PriTestTamaArt = {
    enemy: function (key) { return ART[key] ? ART[key]() : ""; },
    keys: function () { return Object.keys(ART); }
  };
})();
