// 大名幸村（yukimura）：3D 畫面（three.js r149，進入戰場才載入 #yk-app[data-three-src]）。
// 只負責畫面：每一影格向 opts.getView() 拿狀態（單機／房主是模擬中的 s，其他人是房主快照解出來的 view），
// 顯示位置用指數平滑追上；fx（特效事件）依 id 只播一次。
// 所有模型都用基本幾何體在程式裡組出（武者、足輕、妖怪、首領、城、樹、燈籠……），不需要外部素材；
// 敵人與投射物把各部件合併成一個幾何體（頂點色），再用 InstancedMesh 一次畫完，手機上也跑得動。
(function () {
  "use strict";

  var D = window.PriTestYukimuraData;
  var TK = window.PriTestYukimuraTenka;   // 天下布武（救出令的村姑插圖）
  var AR = D.ARENA;
  var loading = null;
  var T = null;

  function available() {
    try {
      var c = document.createElement("canvas");
      return !!(window.WebGLRenderingContext && (c.getContext("webgl") || c.getContext("experimental-webgl")));
    } catch (e) { return false; }
  }
  function load() {
    if (window.THREE) return Promise.resolve(window.THREE);
    if (loading) return loading;
    var app = document.getElementById("yk-app"), src = app && app.getAttribute("data-three-src");
    loading = new Promise(function (resolve, reject) {
      if (!src) { reject(new Error("no three src")); return; }
      var s = document.createElement("script");
      s.src = src;
      s.onload = function () { resolve(window.THREE); };
      s.onerror = function () { loading = null; reject(new Error("three.js load failed")); };
      document.head.appendChild(s);
    });
    return loading;
  }
  function hash(a, b) { var h = Math.imul(a * 374761393 + b * 668265263, 1274126177); h ^= h >>> 13; return ((Math.imul(h, 1103515245) >>> 0) % 100000) / 100000; }

  // ---------------- 幾何體合併（頂點色）----------------
  var _m = null, _q = null, _e = null, _v = null, _s = null;
  function prim(kind, a, b, c, d) {
    if (kind === "box") return new T.BoxGeometry(a, b, c);
    if (kind === "cyl") return new T.CylinderGeometry(a, b, c, d || 10);
    if (kind === "sph") return new T.SphereGeometry(a, b || 10, c || 8);
    if (kind === "cone") return new T.ConeGeometry(a, b, c || 10);
    if (kind === "tor") return new T.TorusGeometry(a, b, 6, c || 14, d || Math.PI * 2);
    if (kind === "oct") return new T.OctahedronGeometry(a, 0);
    if (kind === "ico") return new T.IcosahedronGeometry(a, b || 0);
    if (kind === "dodec") return new T.DodecahedronGeometry(a, 0);
    return new T.BoxGeometry(a, b, c);
  }
  // part(geo, color, [x,y,z], [rx,ry,rz], [sx,sy,sz])
  function part(g, color, p, r, sc) { return { g: g, c: color, p: p || [0, 0, 0], r: r || [0, 0, 0], s: sc || [1, 1, 1] }; }
  function merge(parts) {
    var pos = [], nor = [], col = [];
    parts.forEach(function (pt) {
      var g = pt.g.index ? pt.g.toNonIndexed() : pt.g.clone();
      _e.set(pt.r[0], pt.r[1], pt.r[2]);
      _q.setFromEuler(_e);
      _m.compose(_v.set(pt.p[0], pt.p[1], pt.p[2]), _q, _s.set(pt.s[0], pt.s[1], pt.s[2]));
      g.applyMatrix4(_m);
      var P = g.attributes.position.array, N = g.attributes.normal.array, cc = new T.Color(pt.c);
      for (var i = 0; i < P.length; i += 3) {
        pos.push(P[i], P[i + 1], P[i + 2]);
        nor.push(N[i], N[i + 1], N[i + 2]);
        col.push(cc.r, cc.g, cc.b);
      }
      g.dispose();
    });
    var out = new T.BufferGeometry();
    out.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
    out.setAttribute("normal", new T.Float32BufferAttribute(nor, 3));
    out.setAttribute("color", new T.Float32BufferAttribute(col, 3));
    out.computeBoundingSphere();
    return out;
  }

  // ---------------- 敵人模型 ----------------
  // 人形的共通骨架：腳、軀幹、頭、手臂；opt 再加帽子、武器等
  function humanoid(o) {
    var sk = o.skin || 0xe0b890, cl = o.cloth || 0x6a5a40, pa = o.pants || 0x3a3a3a, h = o.h || 1;
    var L = [
      part(prim("box", 0.18, 0.5 * h, 0.2), pa, [-0.13, 0.25 * h, 0]),
      part(prim("box", 0.18, 0.5 * h, 0.2), pa, [0.13, 0.25 * h, 0]),
      part(prim("box", 0.5, 0.55 * h, 0.32), cl, [0, 0.78 * h, 0]),
      part(prim("sph", 0.2, 10, 8), sk, [0, 1.22 * h, 0.01]),
      part(prim("box", 0.14, 0.5 * h, 0.16), cl, [-0.33, 0.8 * h, 0.04], [0.3, 0, 0.1]),
      part(prim("box", 0.14, 0.5 * h, 0.16), cl, [0.33, 0.8 * h, 0.04], [0.3, 0, -0.1])
    ];
    if (o.belt) L.push(part(prim("box", 0.52, 0.08, 0.34), o.belt, [0, 0.55 * h, 0]));
    // 2026-11-06 精緻化：脖子、手掌、草鞋、衣襟
    L.push(part(prim("cyl", 0.08, 0.09, 0.12, 6), sk, [0, 1.06 * h, 0]));
    L.push(part(prim("sph", 0.075, 6, 5), sk, [-0.36, 0.56 * h, 0.12]), part(prim("sph", 0.075, 6, 5), sk, [0.36, 0.56 * h, 0.12]));
    L.push(part(prim("box", 0.19, 0.06, 0.3), 0x4a3524, [-0.13, 0.03, 0.04]), part(prim("box", 0.19, 0.06, 0.3), 0x4a3524, [0.13, 0.03, 0.04]));
    L.push(part(prim("box", 0.06, 0.4 * h, 0.02), 0xf0ead8, [-0.06, 0.86 * h, 0.165], [0, 0, 0.35]), part(prim("box", 0.06, 0.4 * h, 0.02), 0xf0ead8, [0.06, 0.86 * h, 0.165], [0, 0, -0.35]));
    if (o.eyes !== false) L.push(part(prim("box", 0.05, 0.04, 0.02), 0x111111, [-0.07, 1.25 * h, 0.19]), part(prim("box", 0.05, 0.04, 0.02), 0x111111, [0.07, 1.25 * h, 0.19]));
    return L;
  }
  function quad(o) {
    var c = o.c, s = o.s || 1;
    return [
      part(prim("box", 0.45 * s, 0.42 * s, 1.0 * s), c, [0, 0.62 * s, 0]),
      part(prim("box", 0.34 * s, 0.32 * s, 0.4 * s), c, [0, 0.82 * s, 0.6 * s]),
      part(prim("box", 0.2 * s, 0.16 * s, 0.22 * s), o.snout || c, [0, 0.74 * s, 0.86 * s]),
      part(prim("box", 0.12 * s, 0.42 * s, 0.12 * s), c, [-0.16 * s, 0.21 * s, 0.36 * s]),
      part(prim("box", 0.12 * s, 0.42 * s, 0.12 * s), c, [0.16 * s, 0.21 * s, 0.36 * s]),
      part(prim("box", 0.12 * s, 0.42 * s, 0.12 * s), c, [-0.16 * s, 0.21 * s, -0.36 * s]),
      part(prim("box", 0.12 * s, 0.42 * s, 0.12 * s), c, [0.16 * s, 0.21 * s, -0.36 * s]),
      part(prim("box", 0.05 * s, 0.05 * s, 0.02 * s), 0x111111, [-0.1 * s, 0.9 * s, 0.81 * s]),
      part(prim("box", 0.05 * s, 0.05 * s, 0.02 * s), 0x111111, [0.1 * s, 0.9 * s, 0.81 * s])
    ];
  }
  function horns(c, y, sp) { return [part(prim("cone", 0.06, 0.28, 6), c, [-sp, y, 0.02], [0, 0, 0.35]), part(prim("cone", 0.06, 0.28, 6), c, [sp, y, 0.02], [0, 0, -0.35])]; }
  function spear(len, x, c) { return [part(prim("cyl", 0.025, 0.025, len, 5), 0x6a4a2a, [x, 0.9, 0.2]), part(prim("cone", 0.05, 0.25, 5), c || 0xd8d8e0, [x, 0.9 + len / 2 + 0.12, 0.2])]; }
  // 2026-11-06 天下布武限定妖怪（再追加 20 種）
  function eyes2(y, z, sp, c, r) { return [part(prim("sph", r || 0.05, 6, 5), c || 0x111111, [-sp, y, z]), part(prim("sph", r || 0.05, 6, 5), c || 0x111111, [sp, y, z])]; }
  var TK_YOKAI = {
    kamaitachi: function () { var L = quad({ c: 0xc8a070, s: 0.7, snout: 0xe0c090 }); L.push(part(prim("cyl", 0.04, 0.08, 0.6, 5), 0xc8a070, [0, 0.55, -0.55], [-0.8, 0, 0])); [-1, 1].forEach(function (sd) { L.push(part(prim("tor", 0.2, 0.03, 8, Math.PI * 0.7), 0xe8ecf4, [sd * 0.28, 0.5, 0.35], [0, Math.PI / 2, 0])); }); return L; },
    noppera: function () { var L = humanoid({ cloth: 0x6a6a7a, pants: 0x4a4a5a, skin: 0xf4ece4, eyes: false }); L.push(part(prim("sph", 0.21, 10, 8, 0), 0x18120e, [0, 1.27, -0.04], [0, 0, 0], [1, 0.85, 1])); return L; },
    azukiarai: function () { var h = 0.7; return humanoid({ cloth: 0x8a7a5a, pants: 0x6a5a40, skin: 0xd8b890, h: h }).concat([part(prim("cyl", 0.22, 0.16, 0.16, 10), 0x8a6a3a, [0, 0.45, 0.32]), part(prim("cyl", 0.2, 0.2, 0.02, 10), 0x7a2a2a, [0, 0.53, 0.32]), part(prim("sph", 0.21, 10, 8, 0), 0xdddddd, [0, 1.22 * h + 0.05, -0.04], [0, 0, 0], [1, 0.7, 1])]); },
    hyosube: function () { var h = 0.75; return humanoid({ cloth: 0x7a6a50, pants: 0x7a6a50, skin: 0xd0a080, h: h }).concat([part(prim("sph", 0.38, 10, 8), 0x8a7050, [0, 0.62, 0], [0, 0, 0], [1, 1.1, 0.9]), part(prim("sph", 0.22, 10, 8, 0), 0x6a5038, [0, 1.0, -0.02], [0, 0, 0], [1.1, 0.9, 1.1])], eyes2(0.97, 0.18, 0.07)); },
    chochin: function () { var L = [part(prim("cyl", 0.36, 0.36, 0.7, 12), 0xf0d0a0, [0, 1.0, 0]), part(prim("cyl", 0.3, 0.36, 0.08, 12), 0x2a2a2a, [0, 1.38, 0]), part(prim("cyl", 0.36, 0.3, 0.08, 12), 0x2a2a2a, [0, 0.62, 0]), part(prim("box", 0.26, 0.28, 0.03), 0xc02020, [0, 1.0, 0.35])]; for (var i = 0; i < 4; i++) L.push(part(prim("tor", 0.365, 0.012, 12), 0xc0a070, [0, 0.78 + i * 0.15, 0], [Math.PI / 2, 0, 0])); L.push(part(prim("sph", 0.1, 8, 6), 0xffffff, [-0.12, 1.12, 0.33]), part(prim("sph", 0.05, 6, 5), 0x111111, [-0.12, 1.12, 0.41]), part(prim("box", 0.24, 0.05, 0.03), 0xe03040, [0.02, 0.86, 0.36])); return L; },
    ittanmomen: function () { var L = []; for (var i = 0; i < 6; i++) L.push(part(prim("box", 0.4, 0.04, 0.42), 0xf6f4ee, [0, 1.5 - i * 0.12 + Math.sin(i) * 0.1, -i * 0.38], [0.25 + Math.sin(i * 1.3) * 0.25, 0, 0])); return L.concat(eyes2(1.56, 0.2, 0.08)); },
    tanuki: function () { var L = quad({ c: 0x8a6a48, s: 0.85, snout: 0xd8c0a0 }); L.push(part(prim("sph", 0.36, 10, 8), 0xe8d8b8, [0, 0.5, 0.15]), part(prim("cyl", 0.12, 0.06, 0.5, 6), 0x6a4a30, [0, 0.6, -0.6], [-0.9, 0, 0]), part(prim("box", 0.36, 0.1, 0.06), 0x2a1a10, [0, 0.82, 0.69]), part(prim("box", 0.36, 0.06, 0.36), 0x5a8a40, [0, 0.98, 0.5])); return L; },
    bakeneko: function () { var L = quad({ c: 0xe8e0d0, s: 0.75, snout: 0xf0e8e0 }); L.push(part(prim("cone", 0.07, 0.16, 4), 0xe8e0d0, [-0.1, 0.84, 0.48]), part(prim("cone", 0.07, 0.16, 4), 0xe8e0d0, [0.1, 0.84, 0.48]), part(prim("cyl", 0.04, 0.03, 0.6, 5), 0xe8a040, [-0.08, 0.75, -0.55], [-0.6, 0, 0.3]), part(prim("cyl", 0.04, 0.03, 0.6, 5), 0xe8a040, [0.08, 0.75, -0.55], [-0.6, 0, -0.3]), part(prim("box", 0.08, 0.04, 0.03), 0xe0c020, [-0.08, 0.68, 0.66]), part(prim("box", 0.08, 0.04, 0.03), 0xe0c020, [0.08, 0.68, 0.66])); return L; },
    yamauba: function () { return humanoid({ cloth: 0x6a5a4a, pants: 0x4a3a30, skin: 0xd0b8a0, belt: 0x8a2020 }).concat([part(prim("sph", 0.24, 10, 8, 0), 0xe8e8e8, [0, 1.25, -0.05], [0, 0, 0], [1.1, 1, 1.1]), part(prim("box", 0.3, 0.55, 0.06), 0xe8e8e8, [0, 1.0, -0.2]), part(prim("box", 0.04, 0.4, 0.1), 0xd8dce8, [0.4, 0.55, 0.3], [0.5, 0, 0])], eyes2(1.24, 0.19, 0.07, 0xd02020, 0.035)); },
    aobozu: function () { return humanoid({ cloth: 0x2a4a8a, pants: 0x1a3a6a, skin: 0x4a7ac0, eyes: false, belt: 0xe8e0c0 }).concat([part(prim("sph", 0.09, 8, 6), 0xffffff, [0, 1.25, 0.17]), part(prim("sph", 0.045, 6, 5), 0x111111, [0, 1.25, 0.25]), part(prim("cyl", 0.025, 0.025, 1.6, 5), 0x6a4a2a, [0.4, 0.8, 0.15])]); },
    hannya: function () { return humanoid({ cloth: 0xe8e0d0, pants: 0xb03050, skin: 0xf0f0e8, belt: 0x2a2a2a }).concat(horns(0xf0e8c0, 1.42, 0.12), [part(prim("box", 0.24, 0.05, 0.03), 0xc02020, [0, 1.13, 0.19]), part(prim("sph", 0.21, 10, 8, 0), 0x111111, [0, 1.28, -0.06], [0, 0, 0], [1, 0.8, 1])], eyes2(1.26, 0.19, 0.07, 0xd0a020, 0.035)); },
    kyokotsu: function () { return [part(prim("cyl", 0.42, 0.36, 0.55, 10), 0x7a5a38, [0, 0.28, 0]), part(prim("tor", 0.42, 0.03, 10), 0x3a3a3a, [0, 0.45, 0], [Math.PI / 2, 0, 0]), part(prim("cone", 0.32, 1.0, 8), 0xeef2f8, [0, 1.05, 0], [Math.PI, 0, 0]), part(prim("sph", 0.22, 10, 8), 0xeeeadc, [0, 1.55, 0])].concat(eyes2(1.56, 0.18, 0.07, 0x220000, 0.05), [part(prim("cyl", 0.02, 0.02, 1.4, 4), 0x6a5a40, [0, 1.6, 0.45], [0.3, 0, 0])]); },
    konakijiji: function () { var h = 0.72; return humanoid({ cloth: 0x4a6a3a, pants: 0x3a5a2a, skin: 0xd8b090, h: h, belt: 0x8a6a3a }).concat([part(prim("box", 0.36, 0.3, 0.06), 0xe8e0c0, [0, 0.62, 0.17]), part(prim("cone", 0.18, 0.2, 8), 0xf0f0f0, [0, 0.82, 0.18], [Math.PI, 0, 0]), part(prim("cyl", 0.025, 0.025, 1.0, 5), 0x6a4a2a, [0.32, 0.45, 0.15])]); },
    raiju: function () { var L = quad({ c: 0x3a5ac0, s: 0.9, snout: 0x5a7ad0 }); for (var i = 0; i < 4; i++) L.push(part(prim("box", 0.08, 0.2, 0.08), 0xffe040, [0, 1.0, -0.4 + i * 0.25], [0.4, 0, 0])); L.push(part(prim("box", 0.06, 0.4, 0.06), 0xffe040, [0, 0.9, -0.75], [-0.7, 0, 0.4]), part(prim("box", 0.06, 0.3, 0.06), 0xffe040, [0, 1.1, -0.95], [-0.2, 0, -0.5])); return L; },
    jorogumo: function () { var L = [part(prim("sph", 0.55, 12, 8), 0x2a2030, [0, 0.55, -0.35], [0, 0, 0], [1, 0.7, 1.2]), part(prim("box", 0.5, 0.06, 0.4), 0xe0b020, [0, 0.9, -0.35])]; for (var i = 0; i < 8; i++) { var sd = i < 4 ? -1 : 1, k = i % 4; L.push(part(prim("cyl", 0.03, 0.03, 0.9, 4), 0x1a1420, [sd * 0.55, 0.42, -0.6 + k * 0.25], [0, 0, sd * 1.0])); } var up = humanoid({ cloth: 0xb02060, pants: 0xb02060, skin: 0xf6e0d0, belt: 0xe8c040 }).slice(2).map(function (pt) { pt.p = [pt.p[0], pt.p[1] + 0.25, pt.p[2] + 0.1]; return pt; }); return L.concat(up, [part(prim("sph", 0.21, 10, 8, 0), 0x111111, [0, 1.5, 0.07], [0, 0, 0], [1, 0.9, 1])]); },
    tsurube: function () { return [part(prim("sph", 0.75, 14, 10), 0xd8b090, [0, 1.6, 0]), part(prim("sph", 0.78, 14, 10, 0), 0x18120e, [0, 1.75, -0.12], [0, 0, 0], [1, 0.8, 1])].concat(eyes2(1.7, 0.66, 0.25, 0x111111, 0.1), [part(prim("box", 0.5, 0.12, 0.05), 0x8a1a1a, [0, 1.25, 0.66]), part(prim("cyl", 0.02, 0.02, 2.5, 4), 0x6a5a40, [0, 3.3, 0])]); },
    baku: function () { var L = quad({ c: 0x4a4a52, s: 1.2, snout: 0x5a5a62 }); L.push(part(prim("box", 0.56, 0.3, 0.7), 0xe8e8e8, [0, 0.76, -0.05]), part(prim("cyl", 0.07, 0.05, 0.6, 6), 0x5a5a62, [0, 0.6, 1.25], [0.4, 0, 0]), part(prim("cone", 0.06, 0.2, 5), 0xf0e8d0, [-0.12, 0.7, 1.1], [1.2, 0, 0]), part(prim("cone", 0.06, 0.2, 5), 0xf0e8d0, [0.12, 0.7, 1.1], [1.2, 0, 0])); return L; },
    onimusha: function () { return humanoid({ cloth: 0x3a1a1a, pants: 0x2a1010, skin: 0xb03030, h: 1.15, belt: 0xd0a030 }).concat(horns(0xf0e0b0, 1.6, 0.13), [part(prim("box", 0.62, 0.5, 0.4), 0x5a1010, [0, 1.0, 0]), part(prim("box", 0.18, 0.4, 0.36), 0x5a1010, [-0.42, 1.3, 0], [0, 0, 0.3]), part(prim("box", 0.18, 0.4, 0.36), 0x5a1010, [0.42, 1.3, 0], [0, 0, -0.3]), part(prim("box", 0.07, 1.4, 0.12), 0xd8dce8, [0.45, 0.9, 0.3], [0.3, 0, 0])], eyes2(1.42, 0.2, 0.07, 0xffe040, 0.035)); },
    omukade: function () { var L = []; for (var i = 0; i < 9; i++) { var z = 0.6 - i * 0.32, c = i % 2 ? 0x6a1a10 : 0x8a2a14; L.push(part(prim("sph", 0.3, 8, 6), c, [Math.sin(i * 0.8) * 0.15, 0.35, z], [0, 0, 0], [1.2, 0.7, 1])); L.push(part(prim("cyl", 0.025, 0.025, 0.8, 4), 0xe0a020, [Math.sin(i * 0.8) * 0.15, 0.25, z], [0, 0, Math.PI / 2])); } L.push(part(prim("cone", 0.05, 0.3, 4), 0xe0a020, [-0.15, 0.4, 0.9], [1.4, 0, 0]), part(prim("cone", 0.05, 0.3, 4), 0xe0a020, [0.15, 0.4, 0.9], [1.4, 0, 0])); return L.concat(eyes2(0.5, 0.86, 0.1, 0xffe040, 0.05)); },
    umibozu: function () { return [part(prim("sph", 1.1, 16, 12, 0), 0x14161e, [0, 0.9, 0], [0, 0, 0], [1, 1.25, 1]), part(prim("cyl", 1.15, 1.25, 0.3, 16), 0x2a3a5a, [0, 0.1, 0])].concat(eyes2(1.8, 0.9, 0.35, 0xf0f0e0, 0.14), eyes2(1.8, 1.02, 0.35, 0x111111, 0.06)); }
  };
  var EMODELS = {
    // 2026-11-06 天下布武限定妖怪
    hitotsume: function () { var h = 0.75; return humanoid({ cloth: 0x3a6aa8, pants: 0x2a4a78, skin: 0xf0d0b8, h: h, eyes: false, belt: 0xe0c040 }).concat([part(prim("sph", 0.1, 10, 8), 0xffffff, [0, 1.22 * h + 0.02, 0.15]), part(prim("sph", 0.05, 8, 6), 0x111111, [0, 1.22 * h + 0.02, 0.23]), part(prim("box", 0.08, 0.03, 0.02), 0xc04040, [0, 1.22 * h - 0.1, 0.19])]); },
    kasaobake: function () { return [part(prim("cone", 0.62, 0.55, 12), 0x9a2a5a, [0, 1.15, 0]), part(prim("cone", 0.63, 0.06, 12), 0xf0e0b0, [0, 0.9, 0]), part(prim("cyl", 0.03, 0.03, 0.5, 5), 0x6a4a2a, [0, 1.55, 0]), part(prim("cyl", 0.05, 0.05, 0.85, 6), 0x8a6a3a, [0, 0.45, 0]), part(prim("box", 0.18, 0.06, 0.26), 0x5a3a20, [0, 0.04, 0.06]), part(prim("sph", 0.11, 10, 8), 0xffffff, [0, 1.1, 0.48]), part(prim("sph", 0.055, 8, 6), 0x111111, [0, 1.1, 0.57]), part(prim("box", 0.1, 0.22, 0.03), 0xe03040, [0, 0.88, 0.5], [0.3, 0, 0])]; },
    rokurokubi: function () { return humanoid({ cloth: 0x8a3a6a, pants: 0x8a3a6a, skin: 0xf6e0d0, belt: 0xe8c040, eyes: false }).filter(function (pt, i) { return i !== 3; }).concat([part(prim("cyl", 0.06, 0.07, 1.1, 6), 0xf6e0d0, [0.1, 1.6, 0], [0, 0, -0.18]), part(prim("sph", 0.2, 10, 8), 0xf6e0d0, [0.22, 2.2, 0.02]), part(prim("sph", 0.215, 10, 8, 0), 0x111111, [0.22, 2.24, -0.03], [0, 0, 0], [1, 0.9, 1]), part(prim("box", 0.05, 0.03, 0.02), 0x111111, [0.15, 2.22, 0.19]), part(prim("box", 0.05, 0.03, 0.02), 0x111111, [0.29, 2.22, 0.19]), part(prim("box", 0.06, 0.02, 0.02), 0xc02030, [0.22, 2.12, 0.19])]); },
    nue: function () { return quad({ c: 0x8a6a30, s: 1.25, snout: 0xc8a070 }).concat([0, 1, 2, 3].map(function (i) { return part(prim("box", 0.58, 0.06, 0.08), 0x2a1a10, [0, 0.95, -0.4 + i * 0.25]); }), [part(prim("cyl", 0.06, 0.1, 1.0, 6), 0x3a7a3a, [0, 0.9, -0.95], [-1.0, 0, 0]), part(prim("sph", 0.12, 8, 6), 0x3a7a3a, [0, 1.25, -1.35]), part(prim("cone", 0.08, 0.2, 5), 0xe0d0b0, [-0.15, 1.3, 0.75], [0, 0, 0.3]), part(prim("cone", 0.08, 0.2, 5), 0xe0d0b0, [0.15, 1.3, 0.75], [0, 0, -0.3])]); },
    nurikabe: function () { return [part(prim("box", 1.7, 1.9, 0.5), 0x9a968a, [0, 1.05, 0]), part(prim("box", 1.75, 0.08, 0.52), 0x7a766a, [0, 1.4, 0]), part(prim("box", 1.75, 0.08, 0.52), 0x7a766a, [0, 0.75, 0]), part(prim("box", 0.18, 0.1, 0.02), 0x111111, [-0.32, 1.65, 0.26]), part(prim("box", 0.18, 0.1, 0.02), 0x111111, [0.32, 1.65, 0.26]), part(prim("box", 0.24, 0.12, 0.3), 0x6a665a, [-0.5, 0.06, 0.05]), part(prim("box", 0.24, 0.12, 0.3), 0x6a665a, [0.5, 0.06, 0.05])]; },
    gashadokuro: function () {
      var B = 0xeeeadc, L = [part(prim("sph", 0.55, 12, 10), B, [0, 2.6, 0.1]), part(prim("box", 0.42, 0.22, 0.4), B, [0, 2.15, 0.25]), part(prim("sph", 0.13, 8, 6), 0x220000, [-0.2, 2.65, 0.55]), part(prim("sph", 0.13, 8, 6), 0x220000, [0.2, 2.65, 0.55]), part(prim("cyl", 0.08, 0.08, 1.2, 6), B, [0, 1.5, 0])];
      for (var i = 0; i < 5; i++) L.push(part(prim("tor", 0.42 - i * 0.03, 0.04, 12, Math.PI * 1.4), B, [0, 1.9 - i * 0.16, 0.05], [Math.PI / 2, 0, -Math.PI * 0.2]));
      [-1, 1].forEach(function (sd) { L.push(part(prim("cyl", 0.07, 0.06, 1.3, 6), B, [sd * 0.75, 1.55, 0.25], [0.5, 0, sd * 0.5]), part(prim("cyl", 0.06, 0.05, 1.1, 6), B, [sd * 1.0, 0.85, 0.75], [1.1, 0, sd * 0.2]), part(prim("box", 0.22, 0.08, 0.22), B, [sd * 1.05, 0.45, 1.05])); L.push(part(prim("cyl", 0.08, 0.06, 1.0, 6), B, [sd * 0.25, 0.5, 0])); });
      L.push(part(prim("box", 0.7, 0.18, 0.35), B, [0, 0.95, 0]));
      return L;
    },
    ikki: function () { return humanoid({ cloth: 0x8a7050, pants: 0x5a4a3a }).concat([part(prim("cone", 0.38, 0.18, 12), 0xc8b070, [0, 1.42, 0]), part(prim("cyl", 0.02, 0.02, 1.4, 5), 0x6a4a2a, [0.36, 0.9, 0.2], [0.2, 0, 0]), part(prim("box", 0.18, 0.04, 0.02), 0x888888, [0.36, 1.6, 0.34])]); },
    ashigaru: function () { return humanoid({ cloth: 0x4a5468, pants: 0x2a2e38, belt: 0xa03030 }).concat([part(prim("cone", 0.4, 0.14, 12), 0x2a2a2a, [0, 1.4, 0])], spear(1.4, 0.36)); },
    yari: function () { return humanoid({ cloth: 0x5a4a6a, pants: 0x2a2838, belt: 0xd0b040 }).concat([part(prim("cone", 0.4, 0.14, 12), 0x3a2a2a, [0, 1.4, 0])], spear(2.2, 0.36, 0xe0e0f0)); },
    nobushi: function () { return humanoid({ cloth: 0x6a5a48, pants: 0x3a3028, skin: 0xc89870 }).concat([part(prim("box", 0.08, 0.2, 0.08), 0x111111, [0, 1.42, -0.1]), part(prim("box", 0.05, 0.05, 0.9), 0xc8c8d0, [0.36, 0.7, 0.45]), part(prim("box", 0.54, 0.1, 0.36), 0x2a2a2a, [0, 0.56, 0])]); },
    gaikotsu: function () { return humanoid({ cloth: 0xe8e4d0, pants: 0xd8d4c0, skin: 0xf0ecd8, eyes: false }).concat([part(prim("box", 0.07, 0.06, 0.02), 0x111111, [-0.07, 1.24, 0.19]), part(prim("box", 0.07, 0.06, 0.02), 0x111111, [0.07, 1.24, 0.19]), part(prim("sph", 0.23, 10, 6, 0), 0x6a5040, [0, 1.3, 0], [0, 0, 0], [1, 0.6, 1]), part(prim("box", 0.05, 0.05, 0.8), 0x8a6a4a, [0.36, 0.75, 0.4])]); },
    onibi: function () { return [part(prim("sph", 0.32, 10, 8), 0xff8020, [0, 0.9, 0]), part(prim("cone", 0.26, 0.6, 8), 0xffc040, [0, 1.3, 0]), part(prim("sph", 0.16, 8, 6), 0xffffa0, [0, 0.9, 0.18]), part(prim("box", 0.06, 0.06, 0.02), 0x301000, [-0.08, 0.98, 0.3]), part(prim("box", 0.06, 0.06, 0.02), 0x301000, [0.08, 0.98, 0.3])]; },
    yurei: function () { return [part(prim("cone", 0.42, 1.3, 10), 0xeef2f8, [0, 0.65, 0], [Math.PI, 0, 0]), part(prim("sph", 0.22, 10, 8), 0xe8eef0, [0, 1.4, 0]), part(prim("box", 0.48, 0.5, 0.1), 0x111111, [0, 1.36, -0.12]), part(prim("cone", 0.08, 0.12, 3), 0xffffff, [0, 1.6, 0.12]), part(prim("box", 0.1, 0.1, 0.5), 0xeef2f8, [-0.2, 1.05, 0.3]), part(prim("box", 0.1, 0.1, 0.5), 0xeef2f8, [0.2, 1.05, 0.3])]; },
    yukinko: function () { return [part(prim("cone", 0.36, 0.8, 10), 0xd8e4f0, [0, 0.4, 0]), part(prim("sph", 0.2, 10, 8), 0xffe0d0, [0, 0.92, 0]), part(prim("cone", 0.28, 0.28, 10), 0xc8d8f0, [0, 1.12, 0]), part(prim("sph", 0.05), 0xff7070, [-0.1, 0.88, 0.16]), part(prim("sph", 0.05), 0xff7070, [0.1, 0.88, 0.16])]; },
    yukidaruma: function () { return [part(prim("sph", 0.55, 12, 10), 0xf8fbff, [0, 0.55, 0]), part(prim("sph", 0.38, 12, 10), 0xf8fbff, [0, 1.3, 0]), part(prim("cyl", 0.25, 0.3, 0.32, 10), 0x7a5030, [0, 1.75, 0]), part(prim("cone", 0.06, 0.25, 6), 0xff8020, [0, 1.3, 0.48], [Math.PI / 2, 0, 0]), part(prim("sph", 0.05), 0x111111, [-0.13, 1.42, 0.33]), part(prim("sph", 0.05), 0x111111, [0.13, 1.42, 0.33]), part(prim("box", 0.7, 0.04, 0.04), 0x6a4a2a, [0, 0.95, 0], [0, 0, 0.5])]; },
    ookami: function () { return quad({ c: 0x8a8a90, snout: 0x9a9aa0 }).concat([part(prim("cone", 0.06, 0.16, 4), 0x8a8a90, [-0.1, 1.05, 0.55]), part(prim("cone", 0.06, 0.16, 4), 0x8a8a90, [0.1, 1.05, 0.55]), part(prim("cone", 0.08, 0.5, 6), 0xa0a0a8, [0, 0.72, -0.72], [-1.1, 0, 0])]); },
    kuma: function () { return quad({ c: 0x1e1a1a, s: 1.35 }).concat([part(prim("tor", 0.18, 0.04, 10, Math.PI), 0xf0f0e0, [0, 0.95, 0.53], [0, 0, Math.PI]), part(prim("sph", 0.08), 0x1e1a1a, [-0.17, 1.33, 0.75]), part(prim("sph", 0.08), 0x1e1a1a, [0.17, 1.33, 0.75])]); },
    kappa: function () { return humanoid({ cloth: 0x4a9a50, pants: 0x3a8040, skin: 0x5ab060 }).concat([part(prim("cyl", 0.17, 0.17, 0.04, 10), 0xd8e8f0, [0, 1.41, 0]), part(prim("sph", 0.36, 10, 8), 0x7a6a30, [0, 0.82, -0.2], [0, 0, 0], [1, 1.1, 0.5]), part(prim("cone", 0.07, 0.16, 4), 0xe0c040, [0, 1.2, 0.24], [Math.PI / 2, 0, 0])]); },
    tengu: function () { return humanoid({ cloth: 0x2a2a3a, pants: 0x1a1a2a, skin: 0x3a3a48 }).concat([part(prim("cone", 0.07, 0.22, 5), 0xe0c040, [0, 1.2, 0.26], [Math.PI / 2, 0, 0]), part(prim("box", 0.1, 0.1, 0.1), 0x111111, [0, 1.45, 0]), part(prim("box", 0.9, 0.5, 0.05), 0x18181f, [-0.55, 1.0, -0.15], [0, 0.3, 0.3]), part(prim("box", 0.9, 0.5, 0.05), 0x18181f, [0.55, 1.0, -0.15], [0, -0.3, -0.3]), part(prim("box", 0.18, 0.1, 0.02), 0xf0f0f0, [0, 0.95, 0.17])]); },
    namahage: function () { return humanoid({ cloth: 0xb8a060, pants: 0x9a8448, skin: 0xc02020, h: 1.15 }).concat([part(prim("cone", 0.55, 1.0, 10), 0xc8b070, [0, 0.95, 0]), part(prim("box", 0.36, 0.1, 0.06), 0xf0f0f0, [0, 1.3, 0.2]), part(prim("box", 0.08, 0.06, 0.02), 0xffe040, [-0.08, 1.48, 0.21]), part(prim("box", 0.08, 0.06, 0.02), 0xffe040, [0.08, 1.48, 0.21]), part(prim("box", 0.35, 0.22, 0.03), 0xd0d0d8, [0.42, 1.0, 0.3], [0, 0, 0.3])], horns(0xf0e8c0, 1.68, 0.12), [part(prim("sph", 0.24, 8, 6), 0x222222, [0, 1.5, -0.08])]); },
    teppo: function () { return humanoid({ cloth: 0x3a4a3a, pants: 0x2a302a, belt: 0x806030 }).concat([part(prim("cone", 0.4, 0.14, 12), 0x2a2a2a, [0, 1.4, 0]), part(prim("cyl", 0.035, 0.04, 1.2, 6), 0x2a2a2a, [0.28, 0.95, 0.5], [Math.PI / 2, 0, 0]), part(prim("box", 0.06, 0.1, 0.4), 0x6a4a2a, [0.28, 0.92, 0.0])]); },
    kiba: function () {
      var h = quad({ c: 0x6a4428, s: 1.3, snout: 0x5a3a20 });
      var r = humanoid({ cloth: 0x8a2020, pants: 0x5a1818, belt: 0xe0c040 }).map(function (p) { p.p = [p.p[0], p.p[1] + 0.85, p.p[2] - 0.05]; return p; });
      return h.concat(r, [part(prim("box", 0.05, 0.05, 0.6), 0x6a4a2a, [0, 0.95, -0.7], [-0.6, 0, 0]), part(prim("cyl", 0.02, 0.02, 1.3, 4), 0x3a2a1a, [0, 2.3, -0.25]), part(prim("box", 0.02, 0.6, 0.4), 0xe0c040, [0, 2.6, -0.45])]);
    },
    ninja: function () { return humanoid({ cloth: 0x18181f, pants: 0x101018, skin: 0x18181f }).concat([part(prim("box", 0.36, 0.06, 0.02), 0xe0c8a8, [0, 1.25, 0.19]), part(prim("box", 0.6, 0.05, 0.1), 0x8a1a1a, [0, 1.12, -0.2], [0, 0, 0.6]), part(prim("box", 0.04, 0.04, 0.7), 0xc8c8d0, [0, 1.1, -0.18], [0, 0, 0.7])]); },
    gama: function () { return [part(prim("sph", 0.8, 14, 10), 0x7a6a3a, [0, 0.62, 0], [0, 0, 0], [1.1, 0.75, 1.2]), part(prim("sph", 0.6, 12, 8), 0x9a8a50, [0, 0.5, 0.35], [0, 0, 0], [1, 0.6, 1]), part(prim("sph", 0.16), 0xe8d040, [-0.32, 1.1, 0.55]), part(prim("sph", 0.16), 0xe8d040, [0.32, 1.1, 0.55]), part(prim("box", 0.1, 0.1, 0.05), 0x111111, [-0.32, 1.1, 0.7]), part(prim("box", 0.1, 0.1, 0.05), 0x111111, [0.32, 1.1, 0.7]), part(prim("box", 0.9, 0.04, 0.05), 0x4a2a1a, [0, 0.62, 0.95])]; },
    tsuchigumo: function () {
      var L = [part(prim("sph", 0.42, 12, 8), 0x3a2a24, [0, 0.62, -0.3], [0, 0, 0], [1, 0.8, 1.2]), part(prim("sph", 0.26, 10, 8), 0x4a3a30, [0, 0.58, 0.3]), part(prim("box", 0.36, 0.06, 0.03), 0xe02020, [0, 0.66, 0.54])];
      for (var i = 0; i < 4; i++) { var z = -0.2 + i * 0.16; L.push(part(prim("box", 0.9, 0.05, 0.05), 0x2a1a14, [-0.5, 0.5, z], [0, 0.3 - i * 0.2, -0.6]), part(prim("box", 0.9, 0.05, 0.05), 0x2a1a14, [0.5, 0.5, z], [0, -0.3 + i * 0.2, 0.6])); }
      return L;
    },
    kasha: function () { return [part(prim("tor", 0.42, 0.08, 16), 0x5a3a20, [-0.36, 0.5, 0], [0, Math.PI / 2, 0]), part(prim("tor", 0.42, 0.08, 16), 0x5a3a20, [0.36, 0.5, 0], [0, Math.PI / 2, 0]), part(prim("box", 0.6, 0.3, 0.8), 0x6a3020, [0, 0.7, 0]), part(prim("cone", 0.38, 0.8, 8), 0xff6020, [0, 1.2, 0]), part(prim("sph", 0.24, 10, 8), 0x2a2a2a, [0, 1.0, 0.45]), part(prim("cone", 0.07, 0.15, 4), 0x2a2a2a, [-0.12, 1.24, 0.45]), part(prim("cone", 0.07, 0.15, 4), 0x2a2a2a, [0.12, 1.24, 0.45]), part(prim("sph", 0.04), 0xffe040, [-0.08, 1.02, 0.66]), part(prim("sph", 0.04), 0xffe040, [0.08, 1.02, 0.66])]; },
    kitsune: function () { return quad({ c: 0xe08a30, s: 0.9, snout: 0xf8f0e0 }).concat([part(prim("cone", 0.07, 0.2, 4), 0xe08a30, [-0.1, 0.98, 0.5]), part(prim("cone", 0.07, 0.2, 4), 0xe08a30, [0.1, 0.98, 0.5]), part(prim("cone", 0.16, 0.7, 8), 0xf0a040, [0, 0.8, -0.7], [-1.0, 0, 0]), part(prim("cone", 0.09, 0.2, 6), 0xffffff, [0, 1.06, -0.98], [-1.0, 0, 0])]); },
    akaoni: function () { return humanoid({ cloth: 0xd03028, pants: 0xe0b030, skin: 0xd03028, h: 1.3, belt: 0x222222 }).concat(horns(0xf0e8c0, 1.85, 0.12), [part(prim("cyl", 0.07, 0.14, 1.3, 8), 0x2a2a2a, [0.45, 1.1, 0.3], [0.4, 0, -0.2]), part(prim("box", 0.3, 0.06, 0.03), 0xffffff, [0, 1.48, 0.2]), part(prim("sph", 0.24, 8, 6), 0x222222, [0, 1.7, -0.05])]); },
    tetsuoni: function () { return humanoid({ cloth: 0x5a6068, pants: 0x3a4048, skin: 0x7a8088, h: 1.3, belt: 0xa0a8b0 }).concat(horns(0xc0c8d0, 1.85, 0.12), [part(prim("box", 0.62, 0.4, 0.4), 0x4a5058, [0, 1.1, 0]), part(prim("box", 0.24, 0.12, 0.3), 0x6a7078, [-0.4, 1.3, 0]), part(prim("box", 0.24, 0.12, 0.3), 0x6a7078, [0.4, 1.3, 0]), part(prim("cyl", 0.1, 0.16, 1.4, 6), 0x3a3a3a, [0.48, 1.1, 0.3], [0.4, 0, -0.2])]); },
    kogane: function () { return humanoid({ cloth: 0xe0b020, pants: 0xb08818, skin: 0xe8c890, belt: 0xa02020 }).concat([part(prim("sph", 0.24, 10, 6), 0xf0c830, [0, 1.3, 0], [0, 0, 0], [1, 0.7, 1]), part(prim("tor", 0.12, 0.025, 8, Math.PI), 0xffe060, [0, 1.52, 0.12]), part(prim("box", 0.05, 0.05, 0.9), 0xffe080, [0.36, 0.75, 0.45])]); },
    yogan: function () { return humanoid({ cloth: 0x3a2a24, pants: 0x2a1e1a, skin: 0x4a3028, h: 1.15 }).concat([part(prim("box", 0.52, 0.06, 0.34), 0xff6020, [0, 0.95, 0], [0, 0, 0.3]), part(prim("box", 0.52, 0.06, 0.34), 0xffa030, [0, 0.7, 0], [0, 0, -0.3]), part(prim("sph", 0.06), 0xffc040, [-0.07, 1.4, 0.2]), part(prim("sph", 0.06), 0xffc040, [0.07, 1.4, 0.2]), part(prim("dodec", 0.22), 0x3a2a24, [0, 1.62, 0])]); },
    kodama: function () { return [part(prim("cyl", 0.16, 0.22, 0.5, 8), 0xf0f0e8, [0, 0.3, 0]), part(prim("sph", 0.26, 10, 8), 0xf8f8f0, [0, 0.78, 0]), part(prim("box", 0.06, 0.08, 0.02), 0x222222, [-0.09, 0.82, 0.24]), part(prim("box", 0.06, 0.08, 0.02), 0x222222, [0.09, 0.82, 0.24]), part(prim("box", 0.08, 0.05, 0.02), 0x222222, [0, 0.68, 0.25])]; },
    // ---- 首領 ----
    yukijo: function () { return [part(prim("cone", 0.7, 1.6, 12), 0xe8f2ff, [0, 0.8, 0]), part(prim("cyl", 0.22, 0.3, 0.5, 10), 0xc8dcff, [0, 1.7, 0]), part(prim("sph", 0.22, 12, 10), 0xf8fbff, [0, 2.1, 0]), part(prim("box", 0.5, 1.0, 0.12), 0x101018, [0, 1.8, -0.15]), part(prim("cone", 0.06, 0.3, 4), 0xa0e0ff, [-0.15, 2.4, 0]), part(prim("cone", 0.06, 0.42, 4), 0xa0e0ff, [0, 2.45, 0]), part(prim("cone", 0.06, 0.3, 4), 0xa0e0ff, [0.15, 2.4, 0]), part(prim("box", 0.8, 0.12, 0.12), 0x7ab0f0, [0, 1.3, 0]), part(prim("box", 0.05, 0.03, 0.02), 0x3060c0, [-0.07, 2.12, 0.21]), part(prim("box", 0.05, 0.03, 0.02), 0x3060c0, [0.07, 2.12, 0.21])]; },
    enma: function () { return humanoid({ cloth: 0x8a1010, pants: 0x2a1010, skin: 0xc03020, h: 1.2, belt: 0xe0b030 }).concat([part(prim("box", 0.42, 0.36, 0.36), 0x111111, [0, 1.75, 0]), part(prim("box", 0.44, 0.08, 0.38), 0xe0b030, [0, 1.62, 0]), part(prim("box", 0.3, 0.28, 0.1), 0x2a1a1a, [0, 1.3, 0.2]), part(prim("box", 0.8, 0.9, 0.12), 0x5a0808, [0, 0.95, -0.2]), part(prim("box", 0.08, 0.5, 0.04), 0xe0b030, [0.38, 1.0, 0.3])]); },
    tetsuguma: function () { return quad({ c: 0x2a2224, s: 1.4 }).concat([part(prim("box", 0.7, 0.3, 1.1), 0x6a7078, [0, 1.02, 0]), part(prim("box", 0.5, 0.2, 0.36), 0x7a8088, [0, 1.3, 0.82]), part(prim("cone", 0.08, 0.3, 4), 0xc0c8d0, [0, 1.15, 0.2]), part(prim("cone", 0.08, 0.3, 4), 0xc0c8d0, [0, 1.15, -0.2]), part(prim("cone", 0.08, 0.3, 4), 0xc0c8d0, [0, 1.15, -0.55])]); },
    okappa: function () { return EMODELS.kappa().concat([part(prim("box", 0.05, 0.05, 1.2), 0x6a4a2a, [0.4, 0.9, 0.4])]); },
    benkei: function () { return humanoid({ cloth: 0xe0b020, pants: 0x3a3a3a, skin: 0xc89870, h: 1.2, belt: 0x6a1a1a }).concat([part(prim("sph", 0.3, 10, 8), 0xf0f0f0, [0, 1.48, -0.04], [0, 0, 0], [1, 1, 1.1]), part(prim("box", 0.24, 0.12, 0.02), 0xc89870, [0, 1.44, 0.26]), part(prim("cyl", 0.03, 0.03, 2.2, 5), 0x4a2a1a, [0.42, 1.0, 0.3], [0.2, 0, 0]), part(prim("box", 0.06, 0.5, 0.16), 0xd8d8e0, [0.42, 2.15, 0.52], [0.2, 0, 0]), part(prim("cyl", 0.02, 0.02, 1.6, 4), 0x3a2a1a, [-0.25, 1.2, -0.3], [0, 0, 0.4]), part(prim("cyl", 0.02, 0.02, 1.6, 4), 0x3a2a1a, [0.25, 1.2, -0.3], [0, 0, -0.4]), part(prim("cyl", 0.02, 0.02, 1.6, 4), 0x3a2a1a, [0, 1.3, -0.3])]); },
    onamahage: function () { return EMODELS.namahage(); },
    daitengu: function () { return humanoid({ cloth: 0xa82020, pants: 0xf0f0f0, skin: 0xd03020, h: 1.2 }).concat([part(prim("cyl", 0.04, 0.06, 0.45, 6), 0xd03020, [0, 1.42, 0.38], [Math.PI / 2, 0, 0]), part(prim("sph", 0.3, 8, 6), 0xf8f8f8, [0, 1.58, -0.1]), part(prim("box", 0.1, 0.12, 0.1), 0x111111, [0, 1.75, 0.05]), part(prim("box", 1.3, 0.7, 0.05), 0x2a2a2a, [-0.75, 1.2, -0.25], [0, 0.3, 0.3]), part(prim("box", 1.3, 0.7, 0.05), 0x2a2a2a, [0.75, 1.2, -0.25], [0, -0.3, -0.3]), part(prim("cone", 0.32, 0.5, 8), 0x3a8a3a, [0.45, 1.2, 0.35], [0, 0, -0.4])]); },
    karakuri: function () { return humanoid({ cloth: 0x2a3a7a, pants: 0x1a2448, skin: 0x8a8a90, h: 1.3, belt: 0xe0b030 }).concat([part(prim("sph", 0.3, 10, 6), 0x1a1a2a, [0, 1.65, 0], [0, 0, 0], [1, 0.7, 1]), part(prim("tor", 0.32, 0.04, 12, Math.PI), 0xf0c840, [0, 1.95, 0.08], [0, 0, 0]), part(prim("cyl", 0.25, 0.25, 0.08, 10), 0xc0a040, [0, 1.0, 0.24], [Math.PI / 2, 0, 0]), part(prim("cyl", 0.06, 0.08, 1.4, 6), 0x2a2a2a, [0.5, 1.2, 0.4], [Math.PI / 2, 0, 0]), part(prim("box", 0.3, 0.12, 0.36), 0x2a3a7a, [-0.42, 1.36, 0]), part(prim("box", 0.3, 0.12, 0.36), 0x2a3a7a, [0.42, 1.36, 0])]); },
    ozutsuoni: function () { return EMODELS.akaoni().concat([part(prim("cyl", 0.18, 0.22, 1.5, 10), 0x2a2a2a, [0.5, 1.6, 0.3], [1.2, 0, 0]), part(prim("tor", 0.2, 0.04, 10), 0xc0a040, [0.5, 1.9, 0.95], [1.2, 0, 0])]); },
    arahabaki: function () {
      // 遮光器土偶（龜岡式）：粗壯的身軀、巨大的護目鏡眼、冠
      return [
        part(prim("sph", 0.55, 14, 10), 0x9a6a48, [0, 1.0, 0], [0, 0, 0], [1, 1.1, 0.8]),
        part(prim("sph", 0.42, 14, 10), 0xa87a58, [0, 1.85, 0], [0, 0, 0], [1.15, 1, 0.9]),
        part(prim("sph", 0.2, 12, 8), 0x7a4a30, [-0.18, 1.88, 0.3], [0, 0, 0], [1.2, 0.55, 0.6]),
        part(prim("sph", 0.2, 12, 8), 0x7a4a30, [0.18, 1.88, 0.3], [0, 0, 0], [1.2, 0.55, 0.6]),
        part(prim("box", 0.24, 0.03, 0.02), 0xffa040, [-0.18, 1.88, 0.42]), part(prim("box", 0.24, 0.03, 0.02), 0xffa040, [0.18, 1.88, 0.42]),
        part(prim("tor", 0.24, 0.05, 10), 0x8a5a38, [0, 2.28, 0], [Math.PI / 2, 0, 0]),
        part(prim("sph", 0.2, 10, 6), 0x9a6a48, [-0.62, 1.2, 0], [0, 0, 0], [0.7, 1.2, 0.7]), part(prim("sph", 0.2, 10, 6), 0x9a6a48, [0.62, 1.2, 0], [0, 0, 0], [0.7, 1.2, 0.7]),
        part(prim("sph", 0.26, 10, 6), 0x9a6a48, [-0.28, 0.35, 0], [0, 0, 0], [0.8, 1.3, 0.8]), part(prim("sph", 0.26, 10, 6), 0x9a6a48, [0.28, 0.35, 0], [0, 0, 0], [0.8, 1.3, 0.8]),
        part(prim("tor", 0.3, 0.025, 12), 0x5a3a28, [0, 1.15, 0.38]), part(prim("tor", 0.2, 0.025, 12), 0x5a3a28, [0, 0.85, 0.42])
      ];
    }
  };

  // ---------------- 場景裝飾 ----------------
  var PROPS = {
    pine: function () { return [part(prim("cyl", 0.12, 0.18, 1.4, 6), 0x5a3a28, [0, 0.7, 0]), part(prim("cone", 1.0, 1.4, 7), 0x2e5a34, [0, 1.6, 0]), part(prim("cone", 0.75, 1.1, 7), 0x356a3c, [0, 2.3, 0]), part(prim("cone", 0.45, 0.8, 7), 0x3c7444, [0, 2.9, 0])]; },
    snowpine: function () { return [part(prim("cyl", 0.12, 0.18, 1.2, 6), 0x5a3a28, [0, 0.6, 0]), part(prim("cone", 1.0, 1.4, 7), 0x2a4a34, [0, 1.5, 0]), part(prim("cone", 0.8, 0.5, 7), 0xf4f8ff, [0, 1.95, 0]), part(prim("cone", 0.7, 1.1, 7), 0x2e5238, [0, 2.3, 0]), part(prim("cone", 0.45, 0.6, 7), 0xf8fbff, [0, 2.85, 0])]; },
    juhyo: function () { return [part(prim("cone", 0.8, 2.4, 7), 0xf0f6ff, [0, 1.2, 0]), part(prim("sph", 0.6, 8, 6), 0xffffff, [0.2, 1.4, 0.1]), part(prim("sph", 0.45, 8, 6), 0xf6faff, [-0.25, 2.0, 0])]; },
    cedar: function () { return [part(prim("cyl", 0.16, 0.24, 2.2, 6), 0x6a3a24, [0, 1.1, 0]), part(prim("cone", 0.8, 3.0, 8), 0x2a4a2a, [0, 3.0, 0]), part(prim("cone", 0.6, 2.0, 8), 0x2e522e, [0, 4.0, 0])]; },
    sakura: function () { return [part(prim("cyl", 0.12, 0.2, 1.4, 6), 0x5a3a30, [0, 0.7, 0]), part(prim("sph", 1.0, 8, 6), 0xf6b8c8, [0, 1.9, 0], [0, 0, 0], [1.2, 0.8, 1.2]), part(prim("sph", 0.7, 8, 6), 0xf8c8d6, [0.5, 2.2, 0.3]), part(prim("sph", 0.6, 8, 6), 0xf4a8bc, [-0.5, 2.1, -0.3])]; },
    maple: function () { return [part(prim("cyl", 0.1, 0.16, 1.2, 6), 0x5a3a28, [0, 0.6, 0]), part(prim("sph", 0.9, 8, 6), 0xd84a2a, [0, 1.7, 0], [0, 0, 0], [1.1, 0.8, 1.1]), part(prim("sph", 0.6, 8, 6), 0xe8782a, [0.4, 2.0, 0.2])]; },
    deadtree: function () { return [part(prim("cyl", 0.08, 0.16, 2, 5), 0x3a2a24, [0, 1, 0], [0, 0, 0.1]), part(prim("cyl", 0.04, 0.06, 0.9, 4), 0x3a2a24, [0.3, 1.6, 0], [0, 0, -0.8]), part(prim("cyl", 0.04, 0.06, 0.8, 4), 0x3a2a24, [-0.25, 1.3, 0], [0, 0, 0.9])]; },
    bamboo: function () { var L = []; for (var i = 0; i < 4; i++) { var x = (i % 2) * 0.4 - 0.2, z = (i > 1 ? 0.3 : -0.2); L.push(part(prim("cyl", 0.07, 0.07, 3.6, 6), 0x7aa84a, [x, 1.8, z]), part(prim("cone", 0.3, 0.8, 5), 0x5a9a3a, [x, 3.6, z])); } return L; },
    rock: function () { return [part(prim("dodec", 0.7), 0x8a8a84, [0, 0.35, 0], [0.3, 0.5, 0], [1.2, 0.7, 1]), part(prim("dodec", 0.4), 0x9a9a94, [0.6, 0.2, 0.2], [0.1, 0.3, 0.4], [1, 0.7, 1])]; },
    lavarock: function () { return [part(prim("dodec", 0.8), 0x2a2220, [0, 0.4, 0], [0.3, 0.5, 0], [1.2, 0.8, 1]), part(prim("box", 0.6, 0.05, 0.1), 0xff5020, [0, 0.62, 0.55], [0, 0.4, 0.2])]; },
    pillar: function () { return [part(prim("cone", 0.7, 3.4, 6), 0xe0ded4, [0, 1.7, 0]), part(prim("cone", 0.45, 2.2, 6), 0xd0cec4, [0.6, 1.1, 0.3])]; },
    grave: function () { return [part(prim("box", 0.3, 0.9, 0.2), 0x9a9a98, [0, 0.45, 0]), part(prim("box", 0.5, 0.15, 0.36), 0x8a8a88, [0, 0.07, 0]), part(prim("box", 0.04, 1.1, 0.02), 0xd8c8a0, [0.25, 0.55, -0.15])]; },
    jizo: function () { return [part(prim("cyl", 0.22, 0.26, 0.6, 8), 0x9a9a98, [0, 0.3, 0]), part(prim("sph", 0.2, 10, 8), 0xa0a09e, [0, 0.8, 0]), part(prim("box", 0.48, 0.24, 0.05), 0xd02020, [0, 0.55, 0.15])]; },
    kazaguruma: function () { return [part(prim("cyl", 0.02, 0.02, 1, 4), 0x6a4a2a, [0, 0.5, 0]), part(prim("box", 0.36, 0.08, 0.02), 0xe04060, [0, 1, 0.03], [0, 0, 0.6]), part(prim("box", 0.36, 0.08, 0.02), 0x40a0e0, [0, 1, 0.03], [0, 0, -0.9]), part(prim("box", 0.36, 0.08, 0.02), 0xe0d040, [0, 1, 0.03], [0, 0, 2.2])]; },
    torii: function () { return [part(prim("cyl", 0.16, 0.18, 3.2, 8), 0xd03020, [-1.3, 1.6, 0]), part(prim("cyl", 0.16, 0.18, 3.2, 8), 0xd03020, [1.3, 1.6, 0]), part(prim("box", 3.6, 0.22, 0.32), 0x1a1a1a, [0, 3.3, 0]), part(prim("box", 3.0, 0.18, 0.24), 0xd03020, [0, 2.7, 0])]; },
    lantern: function () { return [part(prim("cyl", 0.12, 0.16, 0.8, 6), 0x9a9a98, [0, 0.4, 0]), part(prim("box", 0.5, 0.4, 0.5), 0xfff0b0, [0, 1.0, 0]), part(prim("cone", 0.45, 0.35, 4), 0x8a8a88, [0, 1.38, 0], [0, Math.PI / 4, 0])]; },
    toro: function () { return PROPS.lantern(); },
    shrine: function () { return [part(prim("box", 2.4, 1.6, 2.0), 0xa04030, [0, 0.8, 0]), part(prim("cone", 2.1, 1.2, 4), 0x3a3a40, [0, 2.2, 0], [0, Math.PI / 4, 0], [1.1, 1, 0.95]), part(prim("box", 2.6, 0.2, 2.2), 0x5a5a5a, [0, 0.1, 0])]; },
    pagoda: function () { var L = []; for (var i = 0; i < 5; i++) { var w = 2.6 - i * 0.35; L.push(part(prim("box", w * 0.6, 0.9, w * 0.6), 0xa04030, [0, 0.5 + i * 1.2, 0]), part(prim("cone", w * 0.8, 0.45, 4), 0x2a2a30, [0, 1.1 + i * 1.2, 0], [0, Math.PI / 4, 0])); } L.push(part(prim("cyl", 0.05, 0.05, 1.5, 4), 0xc0a040, [0, 6.8, 0])); return L; },
    house: function () { return [part(prim("box", 2.4, 1.4, 1.8), 0xd8ccb0, [0, 0.7, 0]), part(prim("box", 2.5, 0.12, 1.9), 0x5a3a28, [0, 0.4, 0]), part(prim("cone", 1.9, 1.1, 4), 0x3a3a40, [0, 1.95, 0], [0, Math.PI / 4, 0], [1.05, 1, 0.8])]; },
    magariya: function () { return [part(prim("box", 3.0, 1.3, 1.8), 0xc8b898, [0, 0.65, 0]), part(prim("box", 1.4, 1.3, 1.6), 0xc8b898, [1.0, 0.65, 1.4]), part(prim("cone", 2.3, 1.6, 4), 0x9a8048, [0, 2.0, 0], [0, Math.PI / 4, 0], [1.05, 1, 0.65]), part(prim("cone", 1.2, 1.3, 4), 0x9a8048, [1.0, 1.9, 1.5], [0, Math.PI / 4, 0], [0.8, 1, 1.1])]; },
    kura: function () { return [part(prim("box", 1.8, 2.0, 1.6), 0xf0ece0, [0, 1.0, 0]), part(prim("box", 1.82, 0.6, 1.62), 0x3a3a40, [0, 0.3, 0]), part(prim("cone", 1.5, 0.8, 4), 0x2a2a30, [0, 2.4, 0], [0, Math.PI / 4, 0], [1, 1, 0.9])]; },
    castle: function () {
      var L = [part(prim("box", 7, 2.2, 7), 0x6a6a68, [0, 1.1, 0], [0, 0, 0], [1, 1, 1])];
      [[5.2, 3.0], [4.2, 5.1], [3.2, 7.0], [2.3, 8.7]].forEach(function (f, i) {
        L.push(part(prim("box", f[0], 1.6, f[0] * 0.85), 0xf2eee4, [0, f[1], 0]), part(prim("cone", f[0] * 0.85, 0.8, 4), 0x2a2e38, [0, f[1] + 1.1, 0], [0, Math.PI / 4, 0], [1, 1, 0.85]));
      });
      L.push(part(prim("box", 0.5, 0.5, 0.2), 0xe0c040, [-0.9, 10.0, 0]), part(prim("box", 0.5, 0.5, 0.2), 0xe0c040, [0.9, 10.0, 0]));
      return L;
    },
    anvil: function () { return [part(prim("box", 0.8, 0.3, 0.4), 0x3a3a40, [0, 0.75, 0]), part(prim("box", 0.3, 0.45, 0.3), 0x2a2a30, [0, 0.38, 0]), part(prim("box", 0.6, 0.15, 0.45), 0x2a2a30, [0, 0.08, 0])]; },
    furnace: function () { return [part(prim("cyl", 0.9, 1.1, 2, 8), 0x7a5a4a, [0, 1, 0]), part(prim("cyl", 0.4, 0.5, 1, 8), 0x5a4a3a, [0, 2.4, 0]), part(prim("box", 0.5, 0.5, 0.2), 0xff8030, [0, 0.6, 0.95])]; },
    rice: function () { return [part(prim("box", 3.2, 0.06, 2.4), 0x7a9ab0, [0, 0.03, 0]), part(prim("box", 3.4, 0.14, 0.14), 0x6a5a3a, [0, 0.07, 1.25]), part(prim("box", 3.4, 0.14, 0.14), 0x6a5a3a, [0, 0.07, -1.25])].concat([0, 1, 2, 3, 4].map(function (i) { return part(prim("cone", 0.12, 0.4, 4), 0x9ac050, [-1.2 + i * 0.6, 0.25, 0]); })); },
    kakashi: function () { return [part(prim("cyl", 0.04, 0.04, 1.6, 4), 0x6a4a2a, [0, 0.8, 0]), part(prim("box", 1.1, 0.06, 0.06), 0x6a4a2a, [0, 1.2, 0]), part(prim("box", 0.5, 0.5, 0.2), 0x6a7aa0, [0, 1.1, 0]), part(prim("sph", 0.18, 8, 6), 0xf0e8d8, [0, 1.55, 0]), part(prim("cone", 0.35, 0.16, 10), 0xc8b070, [0, 1.75, 0])]; },
    tanabata: function () { return [part(prim("cyl", 0.04, 0.05, 3.2, 5), 0x7aa84a, [0, 1.6, 0]), part(prim("cyl", 0.35, 0.15, 1.6, 8), 0xe04080, [0, 2.4, 0]), part(prim("cyl", 0.3, 0.12, 1.4, 8), 0x40a0e0, [0.4, 2.2, 0.2]), part(prim("sph", 0.22, 8, 6), 0xe0c040, [0, 3.25, 0])]; },
    cliff: function () { return [part(prim("dodec", 1.4), 0x7a7462, [0, 1.0, 0], [0.2, 0.6, 0], [1, 1.5, 0.9]), part(prim("cone", 0.7, 1.2, 5), 0x3a5a3a, [0.3, 2.6, 0])]; },
    islet: function () { return [part(prim("dodec", 1.0), 0xc8c0a8, [0, 0.4, 0], [0.2, 0.4, 0], [1, 0.8, 1]), part(prim("cone", 0.5, 1.2, 6), 0x2e5a34, [0, 1.4, 0]), part(prim("cone", 0.4, 0.9, 6), 0x356a3c, [0.4, 1.2, 0.3])]; }
  };

  // ---------------- 投射物、拾取物 ----------------
  var SHOTS = {
    arrow: function () { return [part(prim("cyl", 0.02, 0.02, 0.9, 4), 0x8a6a3a, [0, 0, 0], [0, 0, Math.PI / 2]), part(prim("cone", 0.05, 0.16, 4), 0xd0d0d8, [0.5, 0, 0], [0, 0, -Math.PI / 2]), part(prim("box", 0.14, 0.08, 0.01), 0xffffff, [-0.4, 0, 0])]; },
    bullet: function () { return [part(prim("sph", 0.12, 6, 4), 0x2a2a2a, [0, 0, 0]), part(prim("cyl", 0.05, 0.1, 0.6, 5), 0xffd060, [-0.35, 0, 0], [0, 0, Math.PI / 2])]; },
    star: function () { return [part(prim("box", 0.5, 0.02, 0.1), 0x8a8a98, [0, 0, 0]), part(prim("box", 0.1, 0.02, 0.5), 0x8a8a98, [0, 0, 0]), part(prim("box", 0.38, 0.02, 0.1), 0x9a9aa8, [0, 0, 0], [0, Math.PI / 4, 0]), part(prim("box", 0.1, 0.02, 0.38), 0x9a9aa8, [0, 0, 0], [0, Math.PI / 4, 0])]; },
    kunai: function () { return [part(prim("cone", 0.06, 0.4, 4), 0xc8c8d0, [0.2, 0, 0], [0, 0, -Math.PI / 2]), part(prim("cyl", 0.025, 0.025, 0.2, 4), 0x2a2a2a, [-0.1, 0, 0], [0, 0, Math.PI / 2]), part(prim("tor", 0.04, 0.012, 6), 0x2a2a2a, [-0.22, 0, 0], [0, Math.PI / 2, 0])]; },
    bomb: function () { return [part(prim("sph", 0.28, 10, 8), 0x222222, [0, 0, 0]), part(prim("cyl", 0.03, 0.03, 0.16, 4), 0xc0a060, [0, 0.3, 0]), part(prim("sph", 0.06, 6, 4), 0xff9020, [0, 0.4, 0])]; },
    ball: function () { return [part(prim("sph", 0.4, 10, 8), 0x3a3a3a, [0, 0, 0])]; },
    bird: function () { return [part(prim("cone", 0.12, 0.5, 4), 0xffffff, [0.05, 0, 0], [0, 0, -Math.PI / 2], [1, 1, 0.3]), part(prim("box", 0.15, 0.01, 0.6), 0xf8f8f0, [0, 0.03, 0], [0, 0, 0])]; },
    fan: function () { return [part(prim("cyl", 0.5, 0.5, 0.03, 12, 1), 0x2a2a30, [0, 0, 0], [0, 0, 0], [1, 1, 1]), part(prim("cyl", 0.36, 0.36, 0.04, 12), 0xe0b030, [0, 0.01, 0])]; },
    horse: function () { return EMODELS.kiba(); },
    ice: function () { return [part(prim("cone", 0.22, 1.2, 6), 0xbfe8ff, [0, 0, 0], [Math.PI, 0, 0])]; },
    rainarrow: function () { return [part(prim("cyl", 0.02, 0.02, 1.0, 4), 0x8a6a3a, [0, 0.5, 0]), part(prim("cone", 0.05, 0.16, 4), 0xd0d0d8, [0, -0.05, 0], [Math.PI, 0, 0])]; },
    orb: function () { return [part(prim("sph", 0.2, 8, 6), 0xff5050, [0, 0, 0])]; },
    crescent: function () { return [part(prim("tor", 0.85, 0.12, 16, Math.PI), 0x9fd4ff, [0, 0, 0], [Math.PI / 2, 0, -Math.PI / 2], [1, 1, 0.35]), part(prim("tor", 0.7, 0.06, 16, Math.PI), 0x4aa0ff, [-0.08, 0, 0], [Math.PI / 2, 0, -Math.PI / 2], [1, 1, 0.3])]; },
    spear: function () { return [part(prim("cyl", 0.035, 0.035, 1.8, 5), 0x6a4a2a, [-0.5, 0, 0], [0, 0, Math.PI / 2]), part(prim("cone", 0.09, 0.5, 4), 0xe8ecf4, [0.6, 0, 0], [0, 0, -Math.PI / 2]), part(prim("box", 0.06, 0.18, 0.18), 0xd0a040, [0.3, 0, 0]), part(prim("box", 0.6, 0.02, 0.2), 0xffffff, [-1.5, 0, 0], [0, 0, 0], [1, 1, 0.6])]; },
    kama: function () { return [part(prim("cyl", 0.03, 0.03, 0.5, 5), 0x5a3a22, [0, 0, 0], [0, 0, Math.PI / 2]), part(prim("tor", 0.32, 0.05, 10, Math.PI * 0.75), 0xdde2ea, [0.25, 0, 0], [Math.PI / 2, 0, 0], [1, 1, 0.4]), part(prim("tor", 0.08, 0.015, 6), 0x8a8a90, [-0.3, 0, 0], [0, Math.PI / 2, 0])]; },
    hamaya: function () { return [part(prim("cyl", 0.03, 0.03, 1.2, 5), 0xf0e0b0, [0, 0, 0], [0, 0, Math.PI / 2]), part(prim("cone", 0.08, 0.26, 4), 0xffe060, [0.7, 0, 0], [0, 0, -Math.PI / 2]), part(prim("box", 0.24, 0.16, 0.02), 0xffffff, [-0.55, 0, 0]), part(prim("box", 0.14, 0.04, 0.03), 0xd02020, [-0.2, 0, 0]), part(prim("sph", 0.16, 8, 6), 0xfff0a0, [0.75, 0, 0])]; },
    nagi: function () { return [part(prim("cyl", 0.03, 0.03, 1.4, 5), 0x5a3a22, [-0.3, 0, 0], [0, 0, Math.PI / 2]), part(prim("box", 0.7, 0.04, 0.18), 0xe8ecf4, [0.6, 0, 0.05], [0, 0.25, 0])]; },
    bolt: function () { return [part(prim("box", 0.18, 1.2, 0.18), 0xfff080, [0, 0.6, 0], [0, 0, 0.35]), part(prim("box", 0.16, 1.2, 0.16), 0xfff8c0, [0.1, 1.7, 0], [0, 0, -0.4]), part(prim("box", 0.14, 1.2, 0.14), 0xfff080, [-0.05, 2.8, 0], [0, 0, 0.35])]; },
    ofuda: function () { return [part(prim("box", 0.24, 0.5, 0.02), 0xf8f0d8, [0, 0, 0]), part(prim("box", 0.04, 0.36, 0.025), 0xd02020, [0, 0, 0])]; },
    // 2026-11-06 新武器的投射物
    dart: function () { return [part(prim("cyl", 0.012, 0.012, 0.5, 4), 0xc8c8d0, [0, 0, 0], [0, 0, Math.PI / 2]), part(prim("cone", 0.05, 0.12, 6), 0x7ab030, [-0.28, 0, 0], [0, 0, Math.PI / 2])]; },
    fireball: function () { return [part(prim("sph", 0.22, 10, 8), 0xffa040, [0, 0, 0]), part(prim("cone", 0.18, 0.5, 8), 0xff6020, [-0.3, 0, 0], [0, 0, Math.PI / 2]), part(prim("sph", 0.1, 8, 6), 0xfff0a0, [0.05, 0.02, 0])]; },
    chakram: function () { return [part(prim("tor", 0.42, 0.06, 20), 0xd8dce8, [0, 0, 0], [Math.PI / 2, 0, 0]), part(prim("tor", 0.3, 0.02, 16), 0xe0b030, [0, 0, 0], [Math.PI / 2, 0, 0])].concat([0, 1, 2, 3, 4, 5, 6, 7].map(function (i) { var a = i * Math.PI / 4; return part(prim("cone", 0.06, 0.16, 4), 0xeef0f8, [Math.cos(a) * 0.5, 0, Math.sin(a) * 0.5], [0, -a, -Math.PI / 2]); })); },
    pebble: function () { return [part(prim("dodec", 0.14), 0x8a8478, [0, 0, 0]), part(prim("dodec", 0.08), 0x6a665c, [0.1, 0.06, 0])]; },
    leaf: function () { return [part(prim("sph", 0.25, 8, 4), 0x5ab040, [0, 0, 0], [0, 0, 0], [1, 0.12, 0.5]), part(prim("box", 0.45, 0.02, 0.02), 0x2a6a20, [0, 0.03, 0])]; },
    mirror: function () { return [part(prim("cyl", 0.06, 0.06, 1.6, 6), 0xfff4c0, [0, 0, 0], [0, 0, Math.PI / 2]), part(prim("cyl", 0.3, 0.3, 0.05, 16), 0xe8c060, [0.8, 0, 0], [0, 0, Math.PI / 2]), part(prim("cyl", 0.22, 0.22, 0.06, 16), 0xfffbe8, [0.82, 0, 0], [0, 0, Math.PI / 2])]; },
    ironball: function () { return [part(prim("sph", 0.32, 12, 10), 0x34343a, [0, 0, 0])].concat([0, 1, 2, 3, 4, 5].map(function (i) { var a = i * Math.PI / 3; return part(prim("cone", 0.07, 0.18, 5), 0x5a5a62, [Math.cos(a) * 0.33, 0, Math.sin(a) * 0.33], [0, -a, -Math.PI / 2]); })).concat([part(prim("cone", 0.07, 0.18, 5), 0x5a5a62, [0, 0.33, 0]), part(prim("cone", 0.07, 0.18, 5), 0x5a5a62, [0, -0.33, 0], [Math.PI, 0, 0])]); }
  };
  var VIS2SHOT = { tachi: "crescent", yari: "spear", kusarigama: "kama", hamaya: "hamaya", naginata: "nagi", kaminari: "bolt", yumi: "arrow", teppo: "bullet", shuriken: "star", kunai: "kunai", horoku: "bomb", ozutsu: "ball", shikigami: "bird", tessen: "fan", kiba: "horse", tsurara: "ice", yanoame: "rainarrow", fukiya: "dart", kitsunebi: "fireball", enbu: "chakram", tsubute: "pebble", konoha: "leaf", kagami: "mirror" };
  var PICKS = {
    gem0: function () { return [part(prim("oct", 0.2), 0x40a0ff, [0, 0, 0])]; },
    gem1: function () { return [part(prim("oct", 0.26), 0x40e070, [0, 0, 0])]; },
    gem2: function () { return [part(prim("oct", 0.34), 0xff4060, [0, 0, 0])]; },
    coin: function () { return [part(prim("cyl", 0.22, 0.22, 0.05, 12), 0xf0c030, [0, 0, 0], [Math.PI / 2, 0, 0]), part(prim("box", 0.08, 0.08, 0.06), 0x806010, [0, 0, 0])]; },
    food: function () { return [part(prim("cone", 0.28, 0.38, 3), 0xf8f8f0, [0, 0, 0], [0, 0, 0]), part(prim("box", 0.3, 0.14, 0.04), 0x1a2a1a, [0, -0.08, 0.1])]; },
    chest: function () { return [part(prim("box", 0.9, 0.55, 0.6), 0x8a1a1a, [0, 0, 0]), part(prim("box", 0.94, 0.12, 0.64), 0xe0b030, [0, 0.2, 0]), part(prim("box", 0.16, 0.18, 0.04), 0xe0b030, [0, 0.05, 0.31]), part(prim("cyl", 0.3, 0.3, 0.9, 10, 1), 0x8a1a1a, [0, 0.28, 0], [0, 0, Math.PI / 2], [1, 1, 0.66])]; },
    lantern: function () { return PROPS.lantern(); },
    anvil: function () { return PROPS.anvil(); },
    hokora: function () { return [part(prim("box", 1.3, 0.3, 1.1), 0x8a8a84, [0, 0.15, 0]), part(prim("box", 0.8, 0.8, 0.7), 0xb04030, [0, 0.7, 0]), part(prim("box", 0.42, 0.5, 0.05), 0x2a1a10, [0, 0.62, 0.36]), part(prim("cone", 0.85, 0.5, 4), 0x2a2a30, [0, 1.35, 0], [0, Math.PI / 4, 0], [1.05, 1, 0.9]), part(prim("box", 0.06, 0.06, 0.4), 0xffffff, [0, 1.0, 0.38], [0, 0, 0.4]), part(prim("cyl", 0.06, 0.06, 1.4, 6), 0xd03020, [-0.75, 0.7, 0.6]), part(prim("cyl", 0.06, 0.06, 1.4, 6), 0xd03020, [0.75, 0.7, 0.6]), part(prim("box", 1.8, 0.1, 0.12), 0xd03020, [0, 1.45, 0.6])]; },
    warashi: function () { return humanoid({ cloth: 0xd03040, pants: 0xd03040, skin: 0xf8e0d0, h: 0.7 }).concat([part(prim("box", 0.44, 0.26, 0.34), 0x111111, [0, 0.95, -0.03])]); },
    // 救出令的村姑（著物＋頭巾＋背後的竹籠）
    musume: function () { return humanoid({ cloth: 0xe07a9a, pants: 0xe07a9a, skin: 0xf8e0d0, h: 0.9, belt: 0xf0d060 }).concat([part(prim("box", 0.46, 0.2, 0.4), 0x2a1a14, [0, 1.17, -0.06]), part(prim("box", 0.44, 0.08, 0.42), 0xf4f0e8, [0, 1.3, 0]), part(prim("cyl", 0.2, 0.16, 0.4, 8), 0xb08a50, [0, 0.85, -0.32])]); }
  };
  var IMG_BASE = (function () { var a = document.getElementById("yk-app"); return (a && a.getAttribute("data-img")) || "../static/images/jikan/"; })();

  // ---------------- 大名武者（Group，有動畫）----------------
  function mat(c, o) { var m = new T.MeshStandardMaterial({ color: c, roughness: 0.55, metalness: 0.15 }); Object.keys(o || {}).forEach(function (k) { m[k] = o[k]; }); return m; }
  function addR(parent, child, rx, ry, rz) { child.rotation.set(rx || 0, ry || 0, rz || 0); parent.add(child); return child; }
  function mesh(g, m, x, y, z) { var me = new T.Mesh(g, m); me.position.set(x || 0, y || 0, z || 0); me.castShadow = true; return me; }
  function buildSamurai(d, weaponArch) {
    var g = new T.Group(), body = new T.Group();
    g.add(body);
    var cMain = mat(d.color), cAcc = mat(d.accent, { metalness: 0.5, roughness: 0.35 }), cDark = mat(0x1a1a1e), cSkin = mat(0xe8c8a0), cLace = mat(0xe8e0d0);
    // 腳（脛當）
    var legL = new T.Group(), legR = new T.Group();
    legL.position.set(-0.15, 0.62, 0); legR.position.set(0.15, 0.62, 0);
    legL.add(mesh(new T.BoxGeometry(0.2, 0.6, 0.22), cDark, 0, -0.32, 0)); legR.add(mesh(new T.BoxGeometry(0.2, 0.6, 0.22), cDark, 0, -0.32, 0));
    legL.add(mesh(new T.BoxGeometry(0.22, 0.32, 0.06), cAcc, 0, -0.38, 0.12)); legR.add(mesh(new T.BoxGeometry(0.22, 0.32, 0.06), cAcc, 0, -0.38, 0.12));
    // 2026-11-06 精緻化：草鞋、佩楯（大腿護甲）、脛當的綁繩
    [legL, legR].forEach(function (lg) {
      lg.add(mesh(new T.BoxGeometry(0.22, 0.06, 0.34), mat(0x6a5030), 0, -0.63, 0.05));
      lg.add(mesh(new T.BoxGeometry(0.2, 0.025, 0.25), cLace, 0, -0.58, 0.05));
      lg.add(mesh(new T.BoxGeometry(0.24, 0.24, 0.05), cMain, 0, -0.04, 0.13));
      for (var hb = 0; hb < 3; hb++) lg.add(mesh(new T.BoxGeometry(0.25, 0.018, 0.055), cLace, 0, -0.12 + hb * 0.08, 0.135));
      lg.add(mesh(new T.BoxGeometry(0.23, 0.02, 0.24), cLace, 0, -0.26, 0));
    });
    body.add(legL, legR);
    // 草摺（裙甲）
    var skirt = mesh(new T.CylinderGeometry(0.32, 0.44, 0.38, 8, 1, true), cMain, 0, 0.72, 0);
    skirt.material = cMain.clone(); skirt.material.side = T.DoubleSide;
    body.add(skirt);
    for (var i = 0; i < 3; i++) addR(body, mesh(new T.TorusGeometry(0.34 + i * 0.04, 0.012, 4, 16), cLace, 0, 0.84 - i * 0.12, 0), Math.PI / 2);
    // 草摺的垂板（7 片，每片 3 段綁繩）
    for (var kz = 0; kz < 7; kz++) {
      var ka = kz / 7 * Math.PI * 2, kp = new T.Group();
      kp.position.set(Math.sin(ka) * 0.4, 0.72, Math.cos(ka) * 0.4); kp.rotation.set(0, ka, 0);
      var plate = mesh(new T.BoxGeometry(0.2, 0.36, 0.035), cMain, 0, 0, 0); plate.rotation.x = 0.18; kp.add(plate);
      for (var kl = 0; kl < 3; kl++) { var ln = mesh(new T.BoxGeometry(0.21, 0.016, 0.04), cLace, 0, 0.12 - kl * 0.11, 0.02 - kl * 0.02); ln.rotation.x = 0.18; kp.add(ln); }
      body.add(kp);
    }
    // 胴
    var torso = mesh(new T.BoxGeometry(0.62, 0.62, 0.4), cMain, 0, 1.18, 0);
    body.add(torso);
    for (var j = 0; j < 4; j++) body.add(mesh(new T.BoxGeometry(0.64, 0.025, 0.42), cLace, 0, 0.94 + j * 0.15, 0));
    body.add(mesh(new T.BoxGeometry(0.2, 0.2, 0.02), cAcc, 0, 1.25, 0.21));
    // 胸板、鋲、腰帶、腰間的脇差
    body.add(mesh(new T.BoxGeometry(0.5, 0.12, 0.05), cAcc, 0, 1.44, 0.2));
    for (var rv = 0; rv < 4; rv++) body.add(mesh(new T.SphereGeometry(0.022, 6, 4), cAcc, -0.18 + rv * 0.12, 1.44, 0.23));
    body.add(mesh(new T.BoxGeometry(0.66, 0.08, 0.44), mat(0x2a2030), 0, 0.9, 0));
    var waki = new T.Group();
    waki.position.set(-0.3, 0.9, 0.12); waki.rotation.set(0.2, 0.3, 1.25);
    waki.add(mesh(new T.CylinderGeometry(0.028, 0.032, 0.62, 6), cDark, 0, -0.18, 0));
    waki.add(mesh(new T.CylinderGeometry(0.06, 0.06, 0.02, 10), cAcc, 0, 0.14, 0));
    waki.add(mesh(new T.CylinderGeometry(0.025, 0.025, 0.2, 6), mat(0xe8e0d0), 0, 0.25, 0));
    body.add(waki);
    // 袖（肩甲）
    var sodeL = mesh(new T.BoxGeometry(0.1, 0.42, 0.36), cMain, -0.42, 1.3, 0), sodeR = mesh(new T.BoxGeometry(0.1, 0.42, 0.36), cMain, 0.42, 1.3, 0);
    sodeL.rotation.z = 0.25; sodeR.rotation.z = -0.25;
    body.add(sodeL, sodeR);
    [sodeL, sodeR].forEach(function (sd) { for (var sl = 0; sl < 4; sl++) sd.add(mesh(new T.BoxGeometry(0.105, 0.016, 0.37), cLace, 0, 0.15 - sl * 0.1, 0)); sd.add(mesh(new T.BoxGeometry(0.11, 0.04, 0.38), cAcc, 0, 0.2, 0)); });
    // 手臂
    var armL = new T.Group(), armR = new T.Group();
    armL.position.set(-0.4, 1.42, 0); armR.position.set(0.4, 1.42, 0);
    armL.add(mesh(new T.BoxGeometry(0.15, 0.55, 0.16), cDark, 0, -0.3, 0)); armR.add(mesh(new T.BoxGeometry(0.15, 0.55, 0.16), cDark, 0, -0.3, 0));
    // 籠手（前臂的鐵片）與手
    [armL, armR].forEach(function (am) {
      am.add(mesh(new T.BoxGeometry(0.16, 0.24, 0.05), cAcc, 0, -0.42, 0.07));
      for (var kt = 0; kt < 3; kt++) am.add(mesh(new T.BoxGeometry(0.165, 0.014, 0.17), cLace, 0, -0.34 - kt * 0.08, 0));
      am.add(mesh(new T.SphereGeometry(0.075, 8, 6), mat(0x2a2224), 0, -0.6, 0.02));
    });
    body.add(armL, armR);
    // 武器（右手）
    var wpn = new T.Group();
    var steel = mat(0xe0e4ea, { metalness: 0.9, roughness: 0.2 }), wood = mat(0x5a3a22);
    var ak = weaponArch || "tachi";
    if (ak === "yari" || ak === "naginata" || ak === "hata") {
      wpn.add(mesh(new T.CylinderGeometry(0.025, 0.025, 2.2, 6), wood, 0, 0.4, 0));
      wpn.add(mesh(ak === "naginata" ? new T.BoxGeometry(0.05, 0.5, 0.12) : new T.ConeGeometry(0.06, 0.4, 4), steel, 0, 1.65, 0));
      if (ak === "hata") wpn.add(mesh(new T.BoxGeometry(0.02, 0.7, 0.45), cMain, 0, 1.15, -0.24));
    } else if (ak === "yumi" || ak === "yanoame" || ak === "hamaya") {
      addR(wpn, mesh(new T.TorusGeometry(0.8, 0.02, 4, 16, Math.PI * 0.8), wood, 0, 0, 0), 0, Math.PI / 2, Math.PI * 0.6);
    } else if (ak === "teppo" || ak === "ozutsu") {
      addR(wpn, mesh(new T.CylinderGeometry(0.03, 0.04, 1.3, 6), cDark, 0, 0.1, 0.3), Math.PI / 2);
      wpn.add(mesh(new T.BoxGeometry(0.06, 0.1, 0.4), wood, 0, 0.05, -0.3));
    } else if (ak === "tessen") {
      addR(wpn, mesh(new T.CylinderGeometry(0.4, 0.4, 0.02, 10, 1, false, 0, Math.PI), cAcc, 0, 0.1, 0), Math.PI / 2);
    } else if (ak === "kanabo") {   // 金棒：粗棒＋鐵鋲
      wpn.add(mesh(new T.CylinderGeometry(0.09, 0.04, 1.3, 8), mat(0x2a2a2e, { metalness: 0.6, roughness: 0.4 }), 0, 0.6, 0));
      for (var st2 = 0; st2 < 10; st2++) { var sa2 = st2 * 2.4; wpn.add(mesh(new T.ConeGeometry(0.025, 0.07, 4), steel, Math.cos(sa2) * 0.085, 0.75 + (st2 % 5) * 0.09, Math.sin(sa2) * 0.085)); }
    } else if (ak === "tekkyu") {   // 鐵球：鎖鏈＋刺球
      wpn.add(mesh(new T.CylinderGeometry(0.03, 0.03, 0.3, 6), wood, 0, 0.1, 0));
      wpn.add(mesh(new T.CylinderGeometry(0.012, 0.012, 0.5, 4), steel, 0, 0.5, 0));
      wpn.add(mesh(new T.SphereGeometry(0.15, 10, 8), cDark, 0, 0.8, 0));
    } else if (ak === "shakujo") {   // 錫杖：杖頭的環
      wpn.add(mesh(new T.CylinderGeometry(0.025, 0.025, 2.0, 6), wood, 0, 0.4, 0));
      wpn.add(mesh(new T.TorusGeometry(0.16, 0.02, 6, 16), cAcc, 0, 1.52, 0));
      for (var rg = 0; rg < 4; rg++) wpn.add(mesh(new T.TorusGeometry(0.05, 0.012, 4, 10), cAcc, -0.12 + rg * 0.08, 1.4, 0));
    } else if (ak === "kagami") {   // 八咫鏡：銅鏡
      addR(wpn, mesh(new T.CylinderGeometry(0.24, 0.24, 0.04, 18), mat(0xc89a40, { metalness: 0.4, roughness: 0.35 }), 0, 0.35, 0), Math.PI / 2);
      addR(wpn, mesh(new T.CylinderGeometry(0.18, 0.18, 0.045, 18), mat(0xfff8e0, { metalness: 0.2, roughness: 0.1, emissive: new T.Color(0x806838) }), 0, 0.35, 0.005), Math.PI / 2);
    } else if (ak === "fukiya") {
      wpn.add(mesh(new T.CylinderGeometry(0.025, 0.025, 1.2, 6), mat(0x8a7a40), 0, 0.5, 0));
    } else if (ak === "enbu") {
      addR(wpn, mesh(new T.TorusGeometry(0.3, 0.04, 6, 20), steel, 0, 0.3, 0), 0, Math.PI / 2, 0);
    } else if (ak === "nito") {   // 二刀：右手＋左手各一把
      wpn.add(mesh(new T.BoxGeometry(0.04, 1.0, 0.07), steel, 0, 0.55, 0));
      wpn.add(mesh(new T.CylinderGeometry(0.06, 0.06, 0.02, 10), cAcc, 0, 0.05, 0));
      wpn.add(mesh(new T.CylinderGeometry(0.03, 0.03, 0.24, 6), cDark, 0, -0.1, 0));
      var w2 = new T.Group();
      w2.add(mesh(new T.BoxGeometry(0.04, 0.75, 0.07), steel, 0, 0.42, 0));
      w2.add(mesh(new T.CylinderGeometry(0.05, 0.05, 0.02, 10), cAcc, 0, 0.04, 0));
      w2.add(mesh(new T.CylinderGeometry(0.03, 0.03, 0.2, 6), cDark, 0, -0.08, 0));
      w2.position.set(0, -0.58, 0.08); w2.rotation.x = 0.9;
      armL.add(w2);
    } else {
      wpn.add(mesh(new T.BoxGeometry(0.04, 1.1, 0.07), steel, 0, 0.6, 0));
      wpn.add(mesh(new T.BoxGeometry(0.16, 0.03, 0.12), cAcc, 0, 0.05, 0));
      wpn.add(mesh(new T.CylinderGeometry(0.03, 0.03, 0.26, 6), cDark, 0, -0.1, 0));
    }
    wpn.position.set(0, -0.58, 0.08);
    wpn.rotation.x = 0.9;
    armR.add(wpn);
    // 頭與兜
    var head = new T.Group();
    head.position.set(0, 1.66, 0);
    head.add(mesh(new T.SphereGeometry(0.2, 12, 10), cSkin, 0, 0, 0));
    var menpo = mesh(new T.BoxGeometry(0.3, 0.14, 0.1), cDark, 0, -0.08, 0.15);   // 面頰
    head.add(menpo);
    // 眼睛、眉、面頰的鬚與喉垂
    var eyeM = mat(0x141014);
    head.add(mesh(new T.BoxGeometry(0.05, 0.025, 0.02), eyeM, -0.07, 0.03, 0.19), mesh(new T.BoxGeometry(0.05, 0.025, 0.02), eyeM, 0.07, 0.03, 0.19));
    head.add(mesh(new T.BoxGeometry(0.06, 0.015, 0.02), eyeM, -0.07, 0.07, 0.185), mesh(new T.BoxGeometry(0.06, 0.015, 0.02), eyeM, 0.07, 0.07, 0.185));
    menpo.add(mesh(new T.BoxGeometry(0.18, 0.02, 0.02), mat(0xe8e0d0), 0, 0.02, 0.055));
    menpo.add(mesh(new T.BoxGeometry(0.26, 0.1, 0.04), cMain, 0, -0.1, 0.0));
    for (var yg = 0; yg < 2; yg++) menpo.add(mesh(new T.BoxGeometry(0.27, 0.012, 0.045), cLace, 0, -0.07 - yg * 0.04, 0));
    var kabuto = mesh(new T.SphereGeometry(0.27, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), cDark, 0, 0.04, 0);
    head.add(kabuto);
    // 兜的眉庇、天邊（頂上的環）、筋（縱線）
    var visor = mesh(new T.CylinderGeometry(0.28, 0.3, 0.05, 14, 1, true, -Math.PI * 0.35, Math.PI * 0.7), cDark, 0, 0.05, 0);
    visor.material = cDark.clone(); visor.material.side = T.DoubleSide;
    kabuto.add(visor);
    kabuto.add(mesh(new T.TorusGeometry(0.05, 0.015, 6, 12), cAcc, 0, 0.26, 0));
    for (var sj = 0; sj < 8; sj++) { var sja = sj / 8 * Math.PI * 2, sjm = mesh(new T.TorusGeometry(0.272, 0.006, 3, 12, Math.PI / 2), cAcc, 0, 0, 0); sjm.rotation.set(0, sja, Math.PI / 2); kabuto.add(sjm); }
    var shikoro = mesh(new T.CylinderGeometry(0.29, 0.4, 0.22, 12, 1, true, Math.PI * 0.25, Math.PI * 1.5), cMain, 0, -0.04, 0);
    shikoro.material = cMain.clone(); shikoro.material.side = T.DoubleSide;   // 2026-11-06 修正：錣（護頸）原本轉到臉的正面，改回後方與兩側
    head.add(shikoro);
    head.add(mesh(new T.BoxGeometry(0.12, 0.14, 0.03), cMain, -0.29, 0.02, 0.12), mesh(new T.BoxGeometry(0.12, 0.14, 0.03), cMain, 0.29, 0.02, 0.12));   // 吹返
    // 前立
    var crest = new T.Group();
    crest.position.set(0, 0.2, 0.22);
    var gold = mat(d.accent, { metalness: 0.85, roughness: 0.25, emissive: new T.Color(d.accent).multiplyScalar(0.15) });
    if (d.crest === "moon") { var mo = mesh(new T.TorusGeometry(0.42, 0.035, 6, 20, Math.PI * 0.9), gold, 0, 0.0, 0); mo.rotation.set(0, 0, Math.PI * 1.05); mo.position.y = 0.44; crest.add(mo); }
    else if (d.crest === "horns") { var h1 = mesh(new T.BoxGeometry(0.04, 0.5, 0.02), gold, -0.14, 0.22, 0), h2 = mesh(new T.BoxGeometry(0.04, 0.5, 0.02), gold, 0.14, 0.22, 0); h1.rotation.z = 0.35; h2.rotation.z = -0.35; crest.add(h1, h2); }
    else if (d.crest === "sun") addR(crest, mesh(new T.CylinderGeometry(0.16, 0.16, 0.02, 16), gold, 0, 0.2, 0), Math.PI / 2);
    else if (d.crest === "rokumon") { for (var r = 0; r < 6; r++) addR(crest, mesh(new T.CylinderGeometry(0.045, 0.045, 0.02, 10), gold, (r % 3 - 1) * 0.1, 0.08 + Math.floor(r / 3) * 0.1, 0), Math.PI / 2); var a1 = mesh(new T.BoxGeometry(0.03, 0.55, 0.03), mat(0x3a2a1a), -0.22, 0.3, -0.05), a2 = mesh(new T.BoxGeometry(0.03, 0.55, 0.03), mat(0x3a2a1a), 0.22, 0.3, -0.05); a1.rotation.z = 0.45; a2.rotation.z = -0.45; crest.add(a1, a2); }
    else if (d.crest === "antler") { [-1, 1].forEach(function (sd) { var b = mesh(new T.BoxGeometry(0.04, 0.6, 0.04), mat(0x2a1e14), sd * 0.18, 0.3, -0.05); b.rotation.z = -sd * 0.5; crest.add(b); var b2 = mesh(new T.BoxGeometry(0.03, 0.3, 0.03), mat(0x2a1e14), sd * 0.3, 0.4, -0.05); b2.rotation.z = sd * 0.4; crest.add(b2); }); }
    else if (d.crest === "ai") { crest.add(mesh(new T.TorusGeometry(0.13, 0.03, 6, 14), gold, 0, 0.2, 0)); crest.add(mesh(new T.BoxGeometry(0.03, 0.22, 0.02), gold, 0, 0.2, 0)); }
    else if (d.crest === "fan") addR(crest, mesh(new T.CylinderGeometry(0.24, 0.24, 0.02, 12, 1, false, -Math.PI / 2, Math.PI), gold, 0, 0.12, 0), Math.PI / 2);
    else if (d.crest === "star") crest.add(mesh(new T.OctahedronGeometry(0.14, 0), gold, 0, 0.18, 0));
    else if (d.crest === "flame") { crest.add(mesh(new T.ConeGeometry(0.1, 0.4, 6), mat(0xff6020, { emissive: new T.Color(0x802000) }), 0, 0.24, 0)); }
    else if (d.crest === "ebosi") { kabuto.visible = false; shikoro.visible = false; crest.add(mesh(new T.CylinderGeometry(0.12, 0.2, 0.55, 8), cDark, 0, 0.12, -0.22)); }
    // 女武將：不戴兜，鉢卷＋長髮馬尾
    if (d.crest === "hachi") {
      kabuto.visible = false; shikoro.visible = false; menpo.visible = false;
      var hair = mat(0x18120e);
      head.add(mesh(new T.SphereGeometry(0.215, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), hair, 0, 0.01, -0.01));
      head.add(mesh(new T.BoxGeometry(0.14, 0.62, 0.08), hair, 0, -0.28, -0.2));
      addR(head, mesh(new T.TorusGeometry(0.205, 0.03, 6, 18), mat(d.accent), 0, 0.07, 0), Math.PI / 2 - 0.15);
      head.add(mesh(new T.BoxGeometry(0.03, 0.25, 0.1), mat(d.accent), 0.08, -0.05, -0.22));
    }
    // 忍者：頭巾、不背指物
    if (d.crest === "zukin") {
      kabuto.visible = false; shikoro.visible = false;
      head.add(mesh(new T.SphereGeometry(0.23, 12, 10), cMain, 0, 0.01, -0.01));
      head.add(mesh(new T.BoxGeometry(0.3, 0.05, 0.04), cSkin, 0, 0.02, 0.21));
      head.add(mesh(new T.BoxGeometry(0.06, 0.3, 0.02), mat(d.accent), 0.12, -0.1, -0.22));
    }
    head.add(crest);
    body.add(head);
    // 背旗（指物）
    var pole = mesh(new T.CylinderGeometry(0.02, 0.02, 1.7, 5), mat(0x3a2a1a), 0, 1.75, -0.28);
    var flag = mesh(new T.BoxGeometry(0.02, 0.85, 0.5), mat(d.color, { side: T.DoubleSide }), 0, 2.1, -0.54);
    var emb = mesh(new T.CylinderGeometry(0.13, 0.13, 0.03, 12), gold, 0.015, 2.15, -0.54);
    emb.rotation.z = Math.PI / 2;
    body.add(pole, flag, emb);
    if (d.crest === "zukin") { pole.visible = false; flag.visible = false; emb.visible = false; }
    g.userData = { body: body, legL: legL, legR: legR, armL: armL, armR: armR, head: head, flag: flag, phase: 0 };
    return g;
  }

  function labelSprite(text, color) {
    var c = document.createElement("canvas");
    c.width = 256; c.height = 64;
    var x = c.getContext("2d");
    x.font = "bold 30px sans-serif";
    x.textAlign = "center";
    x.lineWidth = 6;
    x.strokeStyle = "rgba(0,0,0,0.75)";
    x.strokeText(text, 128, 42);
    x.fillStyle = color || "#fff";
    x.fillText(text, 128, 42);
    var tex = new T.CanvasTexture(c);
    var sp = new T.Sprite(new T.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    sp.scale.set(2.4, 0.6, 1);
    sp.renderOrder = 10;
    return sp;
  }

  // ---------------- 主體 ----------------
  // opts：{ getView(), me（自己的 pid）, quality, onFrame(dt) }
  function create(box, opts) {
    T = window.THREE;
    _m = new T.Matrix4(); _q = new T.Quaternion(); _e = new T.Euler(); _v = new T.Vector3(); _s = new T.Vector3();
    var low = opts.quality === "low";
    var W0 = box.clientWidth || 800, H0 = box.clientHeight || 500;
    var renderer = new T.WebGLRenderer({ antialias: !low, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, low ? 1 : 1.75));
    renderer.setSize(W0, H0);
    // 顏色都是直接寫的 sRGB 十六進位值：用線性輸出＋不做色調映射，畫出來才是原本設計的顏色
    renderer.outputEncoding = T.LinearEncoding;
    renderer.shadowMap.enabled = !low;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    renderer.domElement.className = "yk-canvas";
    box.appendChild(renderer.domElement);

    var v0 = opts.getView();
    var MAP = D.MAPS[v0.map] || D.MAPS[0], STG = D.STAGES[v0.stage] || D.STAGES[0];
    var scene = new T.Scene();
    var sky = new T.Color(MAP.sky), fogC = new T.Color(MAP.fog);
    scene.background = sky;
    scene.fog = new T.Fog(fogC, 26, 60);
    var camera = new T.PerspectiveCamera(42, W0 / H0, 0.5, 200);
    var hemi = new T.HemisphereLight(0xffffff, new T.Color(MAP.g[1]), 0.5);
    scene.add(hemi);
    var sun = new T.DirectionalLight(0xfff2dd, 0.62);
    sun.castShadow = !low;
    sun.shadow.mapSize.set(1024, 1024);
    var sc = sun.shadow.camera; sc.left = -22; sc.right = 22; sc.top = 22; sc.bottom = -22; sc.near = 1; sc.far = 80;
    sun.shadow.bias = -0.0008;
    scene.add(sun, sun.target);
    var amb = new T.AmbientLight(0xffffff, 0.08);
    scene.add(amb);

    // 地面：頂點色的雜訊（三色）＋場外較暗
    var size = AR * 2 + 50, seg = low ? 60 : 110;
    var gg = new T.PlaneGeometry(size, size, seg, seg);
    gg.rotateX(-Math.PI / 2);
    var gp = gg.attributes.position, gcol = [], c0 = new T.Color(MAP.g[0]), c1 = new T.Color(MAP.g[1]), c2 = new T.Color(MAP.g[2]), tmp = new T.Color();
    for (var i = 0; i < gp.count; i++) {
      var x = gp.getX(i), z = gp.getZ(i);
      var n = (Math.sin(x * 0.21 + v0.map) * Math.cos(z * 0.17) + Math.sin(x * 0.07 - z * 0.09) * 0.8 + hash(Math.floor(x * 2), Math.floor(z * 2)) * 0.5) / 2.3;
      tmp.copy(c0).lerp(c1, clamp01(n + 0.5));
      if (hash(Math.floor(x / 3), Math.floor(z / 3) + 7) > 0.88) tmp.lerp(c2, 0.55);
      var out = Math.max(Math.abs(x), Math.abs(z)) - AR;
      if (out > 0) { tmp.multiplyScalar(Math.max(0.55, 1 - out * 0.03)); gp.setY(i, Math.min(3, out * 0.12) * (0.6 + hash(Math.floor(x), Math.floor(z)) * 0.8)); }
      gcol.push(tmp.r, tmp.g, tmp.b);
    }
    gg.setAttribute("color", new T.Float32BufferAttribute(gcol, 3));
    gg.computeVertexNormals();
    var ground = new T.Mesh(gg, new T.MeshLambertMaterial({ vertexColors: true }));
    ground.receiveShadow = true;
    scene.add(ground);
    // 戰場邊界：竹柵
    var fence = [];
    for (var f = -AR; f <= AR; f += 2) {
      fence.push(part(prim("cyl", 0.08, 0.08, 1.2, 5), 0x6a5a3a, [f, 0.6, -AR - 0.5]), part(prim("cyl", 0.08, 0.08, 1.2, 5), 0x6a5a3a, [f, 0.6, AR + 0.5]));
      fence.push(part(prim("cyl", 0.08, 0.08, 1.2, 5), 0x6a5a3a, [-AR - 0.5, 0.6, f]), part(prim("cyl", 0.08, 0.08, 1.2, 5), 0x6a5a3a, [AR + 0.5, 0.6, f]));
    }
    [[0, -AR - 0.5, 0], [0, AR + 0.5, 0], [-AR - 0.5, 0, Math.PI / 2], [AR + 0.5, 0, Math.PI / 2]].forEach(function (q) {
      fence.push(part(prim("box", AR * 2 + 1, 0.08, 0.06), 0x7a6a48, [q[0], 0.9, q[1]], [0, q[2], 0]), part(prim("box", AR * 2 + 1, 0.08, 0.06), 0x7a6a48, [q[0], 0.4, q[1]], [0, q[2], 0]));
    });
    var fenceM = new T.Mesh(merge(fence), new T.MeshLambertMaterial({ vertexColors: true }));
    scene.add(fenceM);
    // 河流
    (v0.rivers || []).forEach(function (r) {
      var rm = new T.Mesh(new T.PlaneGeometry(AR * 3, r.w), new T.MeshStandardMaterial({ color: 0x3a7ab0, transparent: true, opacity: 0.78, roughness: 0.15, metalness: 0.2 }));
      rm.rotation.x = -Math.PI / 2;
      rm.rotation.z = -r.a;
      rm.position.set(r.x, 0.04, r.z);
      rm.receiveShadow = true;
      scene.add(rm);
    });

    // 裝飾（依地圖權重散布；中心附近留空）
    var propGroups = [];
    var wtot = 0, plist = Object.keys(MAP.prop || {});
    plist.forEach(function (k) { wtot += MAP.prop[k]; });
    var propCount = low ? 140 : 260, placed = {};
    plist.forEach(function (k) { placed[k] = []; });
    for (var pi = 0; pi < propCount; pi++) {
      var rr = hash(pi, v0.map * 31 + 5) * wtot, key = plist[0];
      for (var q = 0; q < plist.length; q++) { rr -= MAP.prop[plist[q]]; if (rr <= 0) { key = plist[q]; break; } }
      var single = key === "castle" || key === "pagoda";
      if (single && placed[key].length >= 1) continue;
      var px, pz;
      if (single) { px = (hash(pi, 9) > 0.5 ? 1 : -1) * (AR + 9); pz = (hash(pi, 11) - 0.5) * AR; }
      else {
        var edge = hash(pi, 3) < 0.35;
        px = (hash(pi, 1) - 0.5) * (edge ? AR * 2 + 30 : AR * 2 - 4);
        pz = (hash(pi, 2) - 0.5) * (edge ? AR * 2 + 30 : AR * 2 - 4);
        if (edge && Math.max(Math.abs(px), Math.abs(pz)) < AR + 2) { if (Math.abs(px) > Math.abs(pz)) px = (px < 0 ? -1 : 1) * (AR + 3 + hash(pi, 4) * 12); else pz = (pz < 0 ? -1 : 1) * (AR + 3 + hash(pi, 4) * 12); }
        if (px * px + pz * pz < 36) continue;
      }
      placed[key].push([px, pz, hash(pi, 6) * 6.28, 0.8 + hash(pi, 7) * 0.5]);
    }
    plist.forEach(function (k) {
      if (!placed[k].length || !PROPS[k]) return;
      var geo = merge(PROPS[k]());
      var im = new T.InstancedMesh(geo, new T.MeshLambertMaterial({ vertexColors: true }), placed[k].length);
      placed[k].forEach(function (p, idx) {
        var sc2 = k === "castle" ? 1.6 : p[3];
        _m.compose(_v.set(p[0], 0, p[1]), _q.setFromEuler(_e.set(0, p[2], 0)), _s.set(sc2, sc2, sc2));
        im.setMatrixAt(idx, _m);
      });
      im.castShadow = !low; im.receiveShadow = true;
      scene.add(im);
      propGroups.push(im);
    });

    // 天氣粒子（雪／火山灰）
    var weather = null;
    if (MAP.snow || MAP.ash || STG.feat === "blizzard" || STG.feat === "eruption") {
      var wn = low ? 500 : 1400, wp = new Float32Array(wn * 3);
      for (var wi = 0; wi < wn; wi++) { wp[wi * 3] = (Math.random() - 0.5) * 50; wp[wi * 3 + 1] = Math.random() * 20; wp[wi * 3 + 2] = (Math.random() - 0.5) * 50; }
      var wg = new T.BufferGeometry();
      wg.setAttribute("position", new T.BufferAttribute(wp, 3));
      weather = new T.Points(wg, new T.PointsMaterial({ color: MAP.ash || STG.feat === "eruption" ? 0x8a6a5a : 0xffffff, size: MAP.ash ? 0.12 : 0.16, transparent: true, opacity: 0.85, depthWrite: false }));
      scene.add(weather);
    }

    // 雨（雨天／雷雨才顯示）
    var rainN = low ? 400 : 1000, rainP = new Float32Array(rainN * 3);
    for (var ri = 0; ri < rainN; ri++) { rainP[ri * 3] = (Math.random() - 0.5) * 50; rainP[ri * 3 + 1] = Math.random() * 20; rainP[ri * 3 + 2] = (Math.random() - 0.5) * 50; }
    var rainG = new T.BufferGeometry();
    rainG.setAttribute("position", new T.BufferAttribute(rainP, 3));
    var rain = new T.Points(rainG, new T.PointsMaterial({ color: 0x9ab8e0, size: 0.13, transparent: true, opacity: 0.8, depthWrite: false }));
    rain.visible = false;
    scene.add(rain);
    var stormT = 0;

    // ---- 實例化的群體 ----
    function pool(geo, cap, matOpts) {
      var m = new T.MeshLambertMaterial(Object.assign({ vertexColors: true }, matOpts || {}));
      var im = new T.InstancedMesh(geo, m, cap);
      im.count = 0;
      im.frustumCulled = false;
      im.instanceMatrix.setUsage(T.DynamicDrawUsage);
      var wc = new T.Color(1, 1, 1);
      for (var ci = 0; ci < cap; ci++) im.setColorAt(ci, wc);
      scene.add(im);
      return im;
    }
    var ePools = {}, eCap = 260;
    function ePool(m) {
      if (ePools[m]) return ePools[m];
      var fn = EMODELS[m] || TK_YOKAI[m] || EMODELS.ashigaru;
      var p = pool(merge(fn()), m === "kiba" || m === "kuma" || m === "akaoni" || m === "tetsuoni" ? 120 : eCap, m === "yurei" || m === "onibi" ? { transparent: true, opacity: 0.78, emissive: new T.Color(m === "onibi" ? 0x803010 : 0x202838) } : null);
      p.castShadow = !low;
      ePools[m] = p;
      return p;
    }
    var sPools = {};
    function sPool(k) {
      if (sPools[k]) return sPools[k];
      var p = pool(merge((SHOTS[k] || SHOTS.orb)()), k === "horse" ? 40 : 300, k === "orb" ? { emissive: new T.Color(0x801010) } : k === "ice" ? { emissive: new T.Color(0x204060) } : k === "crescent" ? { emissive: new T.Color(0x5080b0), transparent: true, opacity: 0.88 } : k === "hamaya" || k === "bolt" || k === "mirror" ? { emissive: new T.Color(0x806020) } : k === "fireball" ? { emissive: new T.Color(0xa04010) } : k === "spear" || k === "kama" || k === "nagi" ? { emissive: new T.Color(0x303038) } : null);
      sPools[k] = p;
      return p;
    }
    var pickPools = {};
    function pkPool(k) {
      if (pickPools[k]) return pickPools[k];
      var p = pool(merge(PICKS[k]()), k.slice(0, 3) === "gem" ? 340 : 120, k.slice(0, 3) === "gem" ? { emissive: new T.Color(k === "gem0" ? 0x103060 : k === "gem1" ? 0x105020 : 0x601020) } : k === "coin" ? { emissive: new T.Color(0x503800) } : null);
      if (k === "chest" || k === "lantern" || k === "anvil" || k === "warashi" || k === "hokora" || k === "musume") p.castShadow = !low;
      pickPools[k] = p;
      return p;
    }
    var bulletPool = sPool("orb");

    // ---- 方向指示針：畫面外的隊友、首領、寶箱、祠 ----
    var pinLayer = document.createElement("div");
    pinLayer.className = "yk-pins";
    box.appendChild(pinLayer);
    var pins = {}, _pv = new T.Vector3();
    function pinEl(key, cls, label) {
      var p = pins[key];
      if (!p) {
        p = pins[key] = document.createElement("div");
        p.innerHTML = '<span class="yk-pin-arr">➤</span><span class="yk-pin-ic"></span><span class="yk-pin-d"></span>';
        pinLayer.appendChild(p);
      }
      p.className = "yk-pin " + cls;
      if (p.children[1].textContent !== label) p.children[1].textContent = label;
      p._seen = frameNo;
      return p;
    }
    function updatePins(v, me) {
      if (!me) return;
      var W = box.clientWidth, H = box.clientHeight, list = [];
      Object.keys(v.P).forEach(function (pid) {
        if (pid === opts.me) return;
        var P = v.P[pid], d = D.DAIMYO[P.dm] || D.DAIMYO[0];
        list.push({ key: "p" + pid, x: P.x, z: P.z, cls: P.down ? "yk-pin-down" : "yk-pin-ally", label: P.down ? "💀" : D.L(d.name).charAt(0), color: P.down ? null : "#" + ("000000" + d.color.toString(16)).slice(-6) });
      });
      v.E.forEach(function (e) { if (e.boss) list.push({ key: "b" + e.id, x: e.x, z: e.z, cls: "yk-pin-boss", label: "👹" }); else if (e.bty) list.push({ key: "b" + e.id, x: e.x, z: e.z, cls: "yk-pin-chest", label: "💰" }); });
      v.D.forEach(function (d) { if (d.k === "chest") list.push({ key: "c" + d.id, x: d.x, z: d.z, cls: "yk-pin-chest", label: "🎁" }); else if (d.k === "hokora") list.push({ key: "h" + d.id, x: d.x, z: d.z, cls: "yk-pin-hokora", label: "⛩" }); else if (d.k === "musume") list.push({ key: "m" + d.id, x: d.x, z: d.z, cls: "yk-pin-musume", label: "", img: IMG_BASE + TK.musumeImg(d.img) + ".webp" }); });
      list.forEach(function (t) {
        _pv.set(t.x, 1, t.z).project(camera);
        var behind = _pv.z > 1;
        var nx = behind ? -_pv.x : _pv.x, ny = behind ? -_pv.y : _pv.y;
        if (!behind && Math.abs(nx) < 0.94 && Math.abs(ny) < 0.9) return;   // 在畫面內就不顯示
        var ang = Math.atan2(-ny, nx), m = 30;
        var cx = W / 2, cy = H / 2, dx = Math.cos(ang), dy = Math.sin(ang);
        var kx = dx ? (W / 2 - m) / Math.abs(dx) : 1e9, ky = dy ? (H / 2 - m) / Math.abs(dy) : 1e9, k2 = Math.min(kx, ky);
        var p = pinEl(t.key, t.cls, t.label);
        p.style.left = (cx + dx * k2) + "px"; p.style.top = (cy + dy * k2) + "px";
        if (t.color) p.style.setProperty("--yk-pin-c", t.color); else p.style.removeProperty("--yk-pin-c");
        if (t.img && p._img !== t.img) { p._img = t.img; p.children[1].style.backgroundImage = "url(" + t.img + ")"; }
        p.children[0].style.transform = "rotate(" + (ang * 180 / Math.PI) + "deg)";
        var dist = Math.round(Math.sqrt((t.x - me.x) * (t.x - me.x) + (t.z - me.z) * (t.z - me.z)));
        var ds = dist + "m";
        if (p.children[2].textContent !== ds) p.children[2].textContent = ds;
      });
      Object.keys(pins).forEach(function (k3) { if (pins[k3]._seen !== frameNo) { pinLayer.removeChild(pins[k3]); delete pins[k3]; } });
    }
    // ---- 救出令的村姑：頭上顯示插圖（時間管理大師）＋救出進度環 ----
    var musumeSp = {}, texLoader = new T.TextureLoader();
    function updateMusume(v) {
      var seen = {};
      v.D.forEach(function (d) {
        if (d.k !== "musume") return;
        seen[d.id] = 1;
        var m = musumeSp[d.id];
        if (!m) {
          var tex = texLoader.load(IMG_BASE + TK.musumeImg(d.img) + ".webp");
          var sp = new T.Sprite(new T.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
          sp.scale.set(1.5, 1.5, 1); sp.renderOrder = 11;
          var ring = new T.Mesh(new T.RingGeometry(2.2, 2.4, 40), new T.MeshBasicMaterial({ color: 0xff70a0, transparent: true, opacity: 0.75, side: T.DoubleSide, depthWrite: false }));
          ring.rotation.x = -Math.PI / 2;
          var help = labelSprite("🆘 HELP!", "#ff9ac0");
          m = musumeSp[d.id] = { sp: sp, ring: ring, help: help };
          scene.add(sp); scene.add(ring); scene.add(help);
        }
        var bob = Math.sin(tAcc * 4) * 0.08;
        m.sp.position.set(d.x, 2.9 + bob, d.z);
        m.help.position.set(d.x, 3.95 + bob, d.z);
        m.ring.position.set(d.x, 0.05, d.z);
        var q = v.q, pr = q && q.k === "rescue" ? Math.min(1, (q.h || 0) / (q.n || 4)) : 0;
        m.ring.material.color.setHex(pr > 0 ? 0x60ff90 : 0xff70a0);
        m.ring.scale.setScalar(1 - pr * 0.5);
      });
      Object.keys(musumeSp).forEach(function (id) {
        if (seen[id]) return;
        var m = musumeSp[id];
        [m.sp, m.ring, m.help].forEach(function (o) { scene.remove(o); if (o.material.map) o.material.map.dispose(); o.material.dispose(); if (o.geometry && o !== m.sp && o !== m.help) o.geometry.dispose(); });
        delete musumeSp[id];
      });
    }
    // 敵人腳下的深色影子（白色地面上也看得清楚）；首領另外有紅圈
    var shadowGeo = new T.CircleGeometry(1, 18);
    shadowGeo.rotateX(-Math.PI / 2);
    var shadowPool = new T.InstancedMesh(shadowGeo, new T.MeshBasicMaterial({ color: 0x10080a, transparent: true, opacity: 0.42, depthWrite: false }), 320);
    shadowPool.count = 0; shadowPool.frustumCulled = false; shadowPool.renderOrder = 1;
    shadowPool.instanceMatrix.setUsage(T.DynamicDrawUsage);
    scene.add(shadowPool);

    // ---- 首領（獨立網格）----
    var bossMeshes = {};
    function bossMesh(e) {
      if (bossMeshes[e.id]) return bossMeshes[e.id];
      var fn = EMODELS[e.m] || TK_YOKAI[e.m] || EMODELS.akaoni;
      var me = new T.Mesh(merge(fn()), new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.2 }));
      me.castShadow = true;
      var aura = new T.Mesh(new T.RingGeometry(0.9, 1.05, 32), new T.MeshBasicMaterial({ color: 0xff3030, transparent: true, opacity: 0.6, side: T.DoubleSide, depthWrite: false }));
      aura.rotation.x = -Math.PI / 2;
      aura.position.y = 0.06;
      me.add(aura);
      me.userData.aura = aura;
      scene.add(me);
      bossMeshes[e.id] = { mesh: me, x: e.x, z: e.z, a: 0 };
      return bossMeshes[e.id];
    }

    // ---- 玩家 ----
    var pMeshes = {};
    function playerMesh(P) {
      var pm = pMeshes[P.pid];
      var arch = P.W && P.W[0] ? D.ARCHES[D.WEAPONS[P.W[0].id].a].k : "tachi";
      if (pm && pm.dm === P.dm) return pm;
      if (pm) { scene.remove(pm.g); }
      var d = D.DAIMYO[P.dm] || D.DAIMYO[0];
      var g = buildSamurai(d, arch);
      var lbl = labelSprite(P.pid === opts.me ? "▼ " + D.L(d.name) : (P.name || D.L(d.name)), P.pid === opts.me ? "#ffe680" : "#ffffff");
      lbl.position.y = 2.9;
      g.add(lbl);
      var ring = new T.Mesh(new T.RingGeometry(0.55, 0.68, 28), new T.MeshBasicMaterial({ color: P.pid === opts.me ? 0xffd040 : 0x60c0ff, transparent: true, opacity: 0.7, side: T.DoubleSide, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.05;
      g.add(ring);
      var aura = new T.Mesh(new T.RingGeometry(0.2, 1, 40), new T.MeshBasicMaterial({ color: 0xffe080, transparent: true, opacity: 0, side: T.DoubleSide, depthWrite: false }));
      aura.rotation.x = -Math.PI / 2; aura.position.y = 0.07;
      g.add(aura);
      var revive = new T.Mesh(new T.RingGeometry(1.0, 1.2, 32, 1, 0, 0.01), new T.MeshBasicMaterial({ color: 0x60ff90, transparent: true, opacity: 0.9, side: T.DoubleSide, depthWrite: false }));
      revive.rotation.x = -Math.PI / 2; revive.position.y = 0.08;
      g.add(revive);
      g.traverse(function (o) { if (o.isMesh && o !== ring && o !== aura && o !== revive) o.castShadow = true; });
      scene.add(g);
      pm = pMeshes[P.pid] = { g: g, dm: P.dm, x: P.x, z: P.z, a: 0, ring: ring, aura: aura, revive: revive, lbl: lbl };
      return pm;
    }
    var orbPool = sPool("ofuda");
    var flameMat = new T.MeshBasicMaterial({ color: 0xff7020, transparent: true, opacity: 0.55, depthWrite: false, blending: T.AdditiveBlending });
    var flameGeo = new T.ConeGeometry(1, 1, 16, 1, true);
    flameGeo.rotateZ(Math.PI / 2); flameGeo.translate(0.5, 0, 0);

    // ---- 區域、預警 ----
    var zoneMeshes = {}, warnMeshes = {};
    var ringGeo = new T.RingGeometry(0.86, 1, 40), discGeo = new T.CircleGeometry(1, 32);
    function zoneMesh(z) {
      if (zoneMeshes[z.id]) return zoneMeshes[z.id];
      var g = new T.Group();
      if (z.k === "pool") {
        g.add(new T.Mesh(discGeo, new T.MeshBasicMaterial({ color: 0xff4010, transparent: true, opacity: 0.7, depthWrite: false })));
        g.children[0].rotation.x = -Math.PI / 2; g.children[0].position.y = 0.05;
      } else if (z.k === "kiri") {   // 毒霧：紫綠色的霧團
        var fogM = new T.MeshBasicMaterial({ color: 0x7ab040, transparent: true, opacity: 0.16, depthWrite: false });
        var fd = new T.Mesh(discGeo, fogM); fd.rotation.x = -Math.PI / 2; fd.position.y = 0.05; g.add(fd);
        var puffM = new T.MeshBasicMaterial({ color: 0x9a6ac0, transparent: true, opacity: 0.15, depthWrite: false });
        for (var pf = 0; pf < 6; pf++) { var pa = pf * 1.047; var pu = new T.Mesh(new T.SphereGeometry(0.55, 8, 6), puffM); pu.position.set(Math.cos(pa) * 0.55, 0.4 + (pf % 2) * 0.25, Math.sin(pa) * 0.55); pu.scale.set(1, 0.6, 1); g.add(pu); }
      } else if (z.k === "hata") {
        var dsk = new T.Mesh(discGeo, new T.MeshBasicMaterial({ color: z.c || 0xe0c040, transparent: true, opacity: 0.22, depthWrite: false }));
        dsk.rotation.x = -Math.PI / 2; dsk.position.y = 0.05;
        g.add(dsk);
        var pole = new T.Mesh(new T.CylinderGeometry(0.04, 0.04, 2.6, 5), new T.MeshLambertMaterial({ color: 0x3a2a1a }));
        pole.position.y = 1.3;
        var fl = new T.Mesh(new T.BoxGeometry(0.03, 1.6, 0.7), new T.MeshLambertMaterial({ color: z.c || 0xe0c040 }));
        fl.position.set(0, 1.8, 0.37);
        g.add(pole, fl);
        g.userData.noScale = [pole, fl];
      } else {
        for (var i = 0; i < 4; i++) { var sp = new T.Mesh(new T.TetrahedronGeometry(0.16), new T.MeshLambertMaterial({ color: 0x5a5a62 })); sp.position.set((i % 2 - 0.5) * 0.4, 0.1, (Math.floor(i / 2) - 0.5) * 0.4); g.add(sp); }
        g.userData.noScale = g.children.slice();
      }
      scene.add(g);
      zoneMeshes[z.id] = g;
      return g;
    }
    function warnMesh(w) {
      if (warnMeshes[w.id]) return warnMeshes[w.id];
      var g = new T.Group();
      var col = w.k === "vent" ? 0xe0d040 : w.k === "lava" ? 0xff5010 : 0xff2020;
      var rg = new T.Mesh(ringGeo, new T.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.85, side: T.DoubleSide, depthWrite: false }));
      var fillM = new T.Mesh(discGeo, new T.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.25, depthWrite: false }));
      rg.rotation.x = fillM.rotation.x = -Math.PI / 2;
      rg.position.y = 0.06; fillM.position.y = 0.055;
      g.add(rg, fillM);
      g.userData.fill = fillM;
      if (w.k === "lava" || w.k === "cannon") {
        var ball = new T.Mesh(new T.SphereGeometry(0.4, 10, 8), new T.MeshBasicMaterial({ color: w.k === "lava" ? 0xff6020 : 0x2a2a2a }));
        g.add(ball);
        g.userData.ball = ball;
      }
      scene.add(g);
      warnMeshes[w.id] = g;
      return g;
    }

    // ---- 特效 ----
    var fxSeen = {}, fxLive = [];
    var fxGeo = {
      ring: new T.RingGeometry(0.8, 1, 48), disc: discGeo, sph: new T.SphereGeometry(1, 14, 10),
      arc: new T.RingGeometry(0.35, 1, 24, 1, -1.25, 2.5), box: new T.BoxGeometry(1, 1, 1), cyl: new T.CylinderGeometry(0.12, 0.12, 1, 6, 1, true)
    };
    function fxMat(c, op, add) { return new T.MeshBasicMaterial({ color: c, transparent: true, opacity: op, side: T.DoubleSide, depthWrite: false, blending: add ? T.AdditiveBlending : T.NormalBlending }); }
    function spawnFx(f) {
      var o = null, life = 0.35, kind = f.k, col = f.c === 2 ? 0xffd040 : 0xffffff;
      var mine = f.o === opts.me;
      if (kind === "slash") { o = new T.Mesh(fxGeo.arc, fxMat(f.c === 2 ? 0xffd040 : 0xe8f4ff, 0.85, true)); o.rotation.x = -Math.PI / 2; o.rotation.z = f.a; o.position.set(f.x, 0.7, f.z); o.scale.setScalar(f.r); life = 0.22; }
      else if (kind === "thrust" || kind === "beam") { o = new T.Mesh(fxGeo.box, fxMat(kind === "beam" ? 0xfff0a0 : 0xe8f4ff, 0.8, true)); o.position.set(f.x + Math.cos(f.a) * f.r / 2, 0.8, f.z + Math.sin(f.a) * f.r / 2); o.rotation.y = -f.a; o.scale.set(f.r, 0.12, kind === "beam" ? 0.5 : 0.25); life = kind === "beam" ? 0.3 : 0.18; }
      else if (kind === "chain") { o = new T.Mesh(fxGeo.box, fxMat(0xa0c8ff, 0.95, true)); o.position.set(f.x + Math.cos(f.a) * f.r / 2, 0.9, f.z + Math.sin(f.a) * f.r / 2); o.rotation.y = -f.a; o.scale.set(Math.max(0.3, f.r), 0.08, 0.12); life = 0.22; }
      else if (kind === "whip") { o = new T.Mesh(fxGeo.box, fxMat(0xd0d0e0, 0.85, true)); o.position.set(f.x + Math.cos(f.a) * f.r / 2, 0.7, f.z + Math.sin(f.a) * f.r / 2); o.rotation.y = -f.a; o.scale.set(f.r, 0.08, 0.8); life = 0.2; }
      else if (kind === "spin" || kind === "wave" || kind === "pulse" || kind === "lvl" || kind === "ult" || kind === "revive" || kind === "bossin") {
        o = new T.Mesh(fxGeo.ring, fxMat(kind === "pulse" ? 0xffb040 : kind === "wave" ? 0xa0e0ff : kind === "lvl" ? 0xffe060 : kind === "ult" ? 0xff6040 : kind === "revive" ? 0x60ff90 : kind === "bossin" ? 0xff2020 : 0xe8f4ff, 0.8, true));
        o.rotation.x = -Math.PI / 2; o.position.set(f.x, 0.3, f.z); o.userData.grow = f.r; life = kind === "ult" || kind === "bossin" ? 0.8 : kind === "lvl" ? 0.6 : 0.3;
      }
      else if (kind === "bolt") { o = new T.Mesh(fxGeo.cyl, fxMat(0xc0d8ff, 0.95, true)); o.position.set(f.x, 6, f.z); o.scale.set(f.c === 2 ? 2 : 1.2, 12, f.c === 2 ? 2 : 1.2); life = 0.18; flash(f.x, f.z, 0x8ab0ff); }
      else if (kind === "boom" || kind === "steam" || kind === "venom" || kind === "blast" || kind === "lava" || kind === "vent" || kind === "bossdie" || kind === "frostbolt" || kind === "ice") {
        var bc = kind === "steam" ? 0xffffff : kind === "venom" ? 0x80e040 : kind === "vent" ? 0xe8e060 : kind === "frostbolt" || kind === "ice" ? 0xa0e0ff : kind === "lava" ? 0xff5010 : 0xff9030;
        o = new T.Mesh(fxGeo.sph, fxMat(bc, 0.7, kind !== "steam")); o.position.set(f.x, 0.4, f.z); o.userData.grow = f.r; life = kind === "bossdie" ? 1 : 0.4;
        if (kind === "boom" || kind === "bossdie" || kind === "lava") flash(f.x, f.z, 0xff9040);
      }
      else if (kind === "die") { o = new T.Mesh(fxGeo.sph, fxMat(f.c ? 0xff8030 : 0xc8c0b0, 0.55)); o.position.set(f.x, 0.6, f.z); o.userData.grow = Math.max(0.6, f.r * 1.4); life = 0.32; }
      else if (kind === "chest" || kind === "pick" || kind === "break") { o = new T.Mesh(fxGeo.cyl, fxMat(kind === "chest" ? 0xffd040 : f.c === 3 ? 0xff80c0 : 0x80ff80, 0.6, true)); o.position.set(f.x, 1.5, f.z); o.scale.set(4, 3, 4); life = 0.5; }
      else if (kind === "warnline") { o = new T.Mesh(fxGeo.box, fxMat(0xff2020, 0.35)); o.position.set(f.x + Math.cos(f.a) * f.r / 2, 0.08, f.z + Math.sin(f.a) * f.r / 2); o.rotation.y = -f.a; o.scale.set(f.r, 0.02, 2); life = 0.8; }
      else if (kind === "crit" && opts.quality !== "low") { o = labelSprite(String(f.c || f.r), "#ffd040"); o.position.set(f.x, 2, f.z); o.scale.set(1.8, 0.45, 1); o.userData.rise = 1; life = 0.6; }
      else if (kind === "down") { o = new T.Mesh(fxGeo.ring, fxMat(0xff3030, 0.8, true)); o.rotation.x = -Math.PI / 2; o.position.set(f.x, 0.2, f.z); o.userData.grow = 2; life = 0.6; }
      if (!o) return;
      if (kind === "crit") { o.material.opacity = 1; }
      scene.add(o);
      fxLive.push({ o: o, t: 0, life: life, base: o.material.opacity, mine: mine });
    }
    var flashLight = new T.PointLight(0xffffff, 0, 14);
    scene.add(flashLight);
    var flashT = 0;
    function flash(x, z, c) { flashLight.position.set(x, 3, z); flashLight.color.setHex(c); flashLight.intensity = 2.2; flashLight.distance = 14; flashT = 0.15; }

    // ---- 平滑位置 ----
    var smooth = {};
    function sm(id, x, z, k) {
      var o = smooth[id];
      if (!o) { o = smooth[id] = { x: x, z: z, a: 0, seen: 0, ph: Math.random() * 6 }; }
      var dx = x - o.x, dz = z - o.z;
      if (dx * dx + dz * dz > 64) { o.x = x; o.z = z; }
      else { o.x += dx * k; o.z += dz * k; }
      if (dx * dx + dz * dz > 0.0004) o.a = Math.atan2(dx, dz);
      o.seen = frameNo;
      return o;
    }

    var camX = 0, camZ = 0, frameNo = 0, last = performance.now(), raf = 0, dead = false, tAcc = 0;
    var white = new T.Color(1, 1, 1), tint = new T.Color();
    function frame(now) {
      if (dead) return;
      raf = requestAnimationFrame(frame);
      var dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      tAcc += dt;
      frameNo++;
      if (opts.onFrame) opts.onFrame(dt);
      var v = opts.getView();
      if (!v) return;
      var k = 1 - Math.pow(0.0005, dt);   // 平滑係數
      var me = v.P[opts.me] || v.P[Object.keys(v.P)[0]];

      // 相機
      if (me) {
        var mx = me.x, mz = me.z;
        camX += (mx - camX) * Math.min(1, dt * 8); camZ += (mz - camZ) * Math.min(1, dt * 8);
      }
      var asp = renderer.domElement.width / Math.max(1, renderer.domElement.height);
      var dist = asp < 0.8 ? 22 : asp < 1.2 ? 19 : 16.5;
      camera.position.set(camX, dist * 0.95, camZ + dist * 0.62);
      camera.lookAt(camX, 0, camZ + 0.6);
      sun.position.set(camX + 12, 30, camZ + 8);
      sun.target.position.set(camX, 0, camZ);

      // 關卡特色的光線／霧
      var fe = v.fe || {};
      var night = (fe.on && fe.k === "darkness") || MAP.night;
      var bliz = fe.on && fe.k === "blizzard";
      var wxk = v.wx && v.wx.k || "clear", foggy = wxk === "fog";
      var camD = dist * 1.13, tgtFar = camD + (night ? 9 : bliz ? 14 : foggy ? 12 : wxk === "storm" ? 26 : 45), tgtNear = camD + (night ? -8 : bliz ? -5 : foggy ? -6 : 8);
      scene.fog.far += (tgtFar - scene.fog.far) * dt * 2;
      scene.fog.near += (tgtNear - scene.fog.near) * dt * 2;
      var lightK = night ? 0.35 : wxk === "storm" ? 0.6 : wxk === "rain" ? 0.8 : 1;
      // 雨、雷雨
      rain.visible = wxk === "rain" || wxk === "storm";
      if (rain.visible) {
        var rp = rain.geometry.attributes.position.array;
        for (var r2 = 0; r2 < rp.length; r2 += 3) {
          rp[r2 + 1] -= 26 * dt; rp[r2] += 2 * dt;
          if (rp[r2 + 1] < 0 || Math.abs(rp[r2] - camX) > 26 || Math.abs(rp[r2 + 2] - camZ) > 26) { rp[r2 + 1] = 16 + Math.random() * 4; rp[r2] = camX + (Math.random() - 0.5) * 50; rp[r2 + 2] = camZ + (Math.random() - 0.5) * 50; }
        }
        rain.geometry.attributes.position.needsUpdate = true;
      }
      if (wxk === "storm") { stormT -= dt; if (stormT <= 0) { stormT = 2 + Math.random() * 4; flash(camX + (Math.random() - 0.5) * 20, camZ + (Math.random() - 0.5) * 16, 0xd0e0ff); flashLight.distance = 60; } }
      hemi.intensity += (0.5 * lightK - hemi.intensity) * dt * 2;
      sun.intensity += ((night ? 0.2 : 0.62) - sun.intensity) * dt * 2;
      if (night) { scene.fog.color.lerp(new T.Color(0x0a0c18), dt * 2); scene.background.lerp(new T.Color(0x0a0c18), dt * 2); }
      else {
        var fogTo = bliz ? new T.Color(0xf0f4f8) : foggy ? new T.Color(0xd8dcdc) : wxk === "storm" ? new T.Color(0x505868) : wxk === "rain" ? new T.Color(0x8a96a4) : fogC;
        scene.fog.color.lerp(fogTo, dt * 2); scene.background.lerp(fogTo, dt * 2);
      }
      if (v.freeze) { amb.color.setHex(0x80c0ff); amb.intensity = 0.5; } else { amb.color.setHex(0xffffff); amb.intensity = night ? 0.2 : 0.08; }
      if (weather) {
        var wpA = weather.geometry.attributes.position.array, wspd = bliz ? 9 : 3, wwx = (fe.wx || 0) + (bliz ? 6 : 0.5);
        for (var wi2 = 0; wi2 < wpA.length; wi2 += 3) {
          wpA[wi2 + 1] -= wspd * dt * (0.6 + (wi2 % 7) * 0.08);
          wpA[wi2] += wwx * dt;
          if (wpA[wi2 + 1] < 0) { wpA[wi2 + 1] = 18 + Math.random() * 3; wpA[wi2] = camX + (Math.random() - 0.5) * 50; wpA[wi2 + 2] = camZ + (Math.random() - 0.5) * 50; }
          if (Math.abs(wpA[wi2] - camX) > 26) wpA[wi2] = camX + (Math.random() - 0.5) * 50;
          if (Math.abs(wpA[wi2 + 2] - camZ) > 26) wpA[wi2 + 2] = camZ + (Math.random() - 0.5) * 50;
        }
        weather.geometry.attributes.position.needsUpdate = true;
        weather.material.opacity = bliz ? 1 : 0.7;
      }

      // 敵人
      Object.keys(ePools).forEach(function (m) { ePools[m].count = 0; });
      shadowPool.count = 0;
      var bossSeen = {};
      for (var i = 0; i < v.E.length; i++) {
        var e = v.E[i];
        var o = sm(e.id, e.x, e.z, k);
        if (e.boss) {
          bossSeen[e.id] = 1;
          var bm = bossMesh(e);
          bm.mesh.position.set(o.x, Math.abs(Math.sin(tAcc * 3)) * 0.12, o.z);
          bm.mesh.rotation.y = o.a;
          bm.mesh.scale.setScalar(e.s || 2.4);
          bm.mesh.userData.aura.material.opacity = 0.4 + Math.sin(tAcc * 6) * 0.2;
          var hfl = (e.hf > 0) ? 1 : 0;
          bm.mesh.material.emissive.setHex(hfl ? 0x803030 : 0x000000);
          continue;
        }
        if (Math.abs(o.x - camX) > 30 || Math.abs(o.z - camZ) > 26) continue;
        var p = ePool(e.m);
        var idx = p.count;
        if (idx >= p.instanceMatrix.count) continue;
        o.ph += dt * 8;
        var bob = Math.abs(Math.sin(o.ph)) * 0.08, sc3 = e.s || 1;
        var fly = e.m === "onibi" || e.m === "tengu" || e.m === "yurei" ? 0.6 + Math.sin(o.ph * 0.5) * 0.2 : 0;
        var tilt = Math.sin(o.ph) * 0.08;
        _m.compose(_v.set(o.x, bob + fly, o.z), _q.setFromEuler(_e.set(0, o.a, tilt)), _s.set(sc3, sc3 * (1 - bob * 0.5), sc3));
        p.setMatrixAt(idx, _m);
        if (shadowPool.count < 320) {
          var shR = (D.ENEMIES[e.k] ? D.ENEMIES[e.k].r : 0.5) * sc3 * 1.25 + 0.1;
          _m.compose(_v.set(o.x, 0.03, o.z), _q.identity(), _s.set(shR, 1, shR));
          shadowPool.setMatrixAt(shadowPool.count++, _m);
        }
        var sf = e.sf || 0;
        if (e.hf > 0 || sf & 4) tint.setRGB(3, 3, 3);
        else if (sf & 64) tint.setRGB(1.4, 1.4, 0.6);
        else if (sf & 8) tint.setRGB(0.6, 0.85, 1.5);
        else if (sf & 16) tint.setRGB(1.6, 0.8, 0.5);
        else if (sf & 32) tint.setRGB(0.8, 1.4, 0.6);
        else if (e.bty) tint.setRGB(1.8, 1.45, 0.4);
        else if (e.el) tint.setRGB(1.3, 1.1, 0.7);
        else tint.copy(white);
        if (v.freeze) tint.setRGB(0.7, 0.9, 1.6);
        p.setColorAt(idx, tint);
        p.count++;
      }
      shadowPool.instanceMatrix.needsUpdate = true;
      Object.keys(ePools).forEach(function (m) { var p = ePools[m]; p.instanceMatrix.needsUpdate = true; if (p.instanceColor) p.instanceColor.needsUpdate = true; });
      Object.keys(bossMeshes).forEach(function (id) { if (!bossSeen[id]) { scene.remove(bossMeshes[id].mesh); delete bossMeshes[id]; } });

      // 玩家
      var pSeen = {};
      Object.keys(v.P).forEach(function (pid) {
        var P = v.P[pid];
        pSeen[pid] = 1;
        var pm = playerMesh(P);
        var isMe = pid === opts.me;
        var px = P.x, pz = P.z;
        if (!isMe) { pm.x += (P.x - pm.x) * k; pm.z += (P.z - pm.z) * k; px = pm.x; pz = pm.z; }
        var moving = Math.abs(px - (pm.lx === undefined ? px : pm.lx)) + Math.abs(pz - (pm.lz === undefined ? pz : pm.lz)) > 0.002;
        pm.lx = px; pm.lz = pz;
        var ud = pm.g.userData;
        pm.g.position.set(px, 0, pz);
        var ta = Math.atan2(P.fx || 0, P.fz || 1);
        var da = ((ta - pm.a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
        pm.a += da * Math.min(1, dt * 12);
        ud.body.rotation.y = pm.a;
        ud.phase += dt * (moving ? 11 : 2);
        var sw = moving ? Math.sin(ud.phase) * 0.6 : 0;
        ud.legL.rotation.x = sw; ud.legR.rotation.x = -sw;
        ud.armL.rotation.x = -sw * 0.6;
        ud.armR.rotation.x = -0.5 + Math.sin(ud.phase * 0.5) * 0.1;
        ud.body.position.y = moving ? Math.abs(Math.sin(ud.phase)) * 0.06 : Math.sin(ud.phase) * 0.015;
        ud.flag.rotation.y = Math.sin(tAcc * 4 + px) * 0.15;
        if (P.down) { ud.body.rotation.x = -Math.PI / 2 + 0.2; ud.body.position.y = 0.25; } else ud.body.rotation.x = 0;
        // 無敵閃爍
        pm.ring.material.color.setHex(P.iv && !P.down ? 0xffffff : isMe ? 0xffd040 : 0x60c0ff);
        pm.ring.material.opacity = P.iv && !P.down ? 0.95 : 0.7;
        // 采配光環、復活進度
        var buff = P.buf && (P.buf.muso || P.buf.kek || P.buf.kaze || P.buf.kaen);
        pm.aura.material.opacity = buff ? 0.35 + Math.sin(tAcc * 8) * 0.15 : 0;
        pm.aura.material.color.setHex(P.buf && P.buf.kaen ? 0xff5020 : P.buf && P.buf.kek ? 0x80c0ff : 0xffe080);
        pm.aura.scale.setScalar(P.buf && P.buf.kaen ? 4.5 : 1.6);
        if (P.down) {
          pm.revive.visible = true;
          pm.revive.geometry.dispose();
          pm.revive.geometry = new T.RingGeometry(1.6, 1.85, 32, 1, 0, Math.max(0.01, (P.rv || 0) / 3 * Math.PI * 2));
        } else pm.revive.visible = false;
      });
      Object.keys(pMeshes).forEach(function (pid) { if (!pSeen[pid]) { scene.remove(pMeshes[pid].g); delete pMeshes[pid]; } });

      // 繞身符、念珠、火炎（由武器清單＋時間算，不經過網路）
      Object.keys(sPools).forEach(function (kk) { sPools[kk].count = 0; });
      var flames = [];
      Object.keys(v.P).forEach(function (pid) {
        var P = v.P[pid], pm = pMeshes[pid];
        if (!pm || P.down) return;
        (P.W || []).forEach(function (w) {
          var W = D.WEAPONS[w.id];
          if (!W) return;
          var kind = W.kind;
          if (kind === "orbit" && w.ot) {
            var n = 2 + (w.lv >= 2 ? 1 : 0) + (w.lv >= 5 ? 1 : 0) + (w.lv >= 8 ? 1 : 0) + (W.v === 5 ? 1 : 0) + (w.evo ? 1 : 0);
            var rad = 2.3 * (w.lv >= 4 ? 1.2 : 1) * (w.lv >= 8 ? 1.15 : 1);
            var heavy = D.ARCHES[W.a].k === "tekkyu", op = heavy ? sPool("ironball") : orbPool;
            if (heavy) rad *= 1.2;
            for (var q = 0; q < n && op.count < 290; q++) {
              var a = v.t * 3.2 + q * Math.PI * 2 / n;
              _m.compose(_v.set(pm.g.position.x + Math.cos(a) * rad, heavy ? 0.7 : 1.0, pm.g.position.z + Math.sin(a) * rad), _q.setFromEuler(heavy ? _e.set(tAcc * 4, a, 0) : _e.set(-0.9, -a + Math.PI / 2, 0)), _s.set(heavy ? 1.3 : 1.5, heavy ? 1.3 : 1.5, heavy ? 1.3 : 1.5));
              op.setMatrixAt(op.count++, _m);
            }
          } else if (kind === "flame" && w.ft) flames.push(pm);
          else if (kind === "aura") {
            if (!pm.juzu) {
              pm.juzu = new T.Mesh(new T.RingGeometry(0.1, 1, 40), new T.MeshBasicMaterial({ color: 0xc8a0ff, transparent: true, opacity: 0.18, depthWrite: false, side: T.DoubleSide }));
              pm.juzu.rotation.x = -Math.PI / 2; pm.juzu.position.y = 0.06;
              pm.g.add(pm.juzu);
            }
            pm.juzu.scale.setScalar(2.1 * (w.lv >= 4 ? 1.2 : 1) * (w.lv >= 8 ? 1.15 : 1) * (W.v === 3 ? 1.3 : 1));
            pm.juzu.material.opacity = 0.14 + Math.sin(tAcc * 5) * 0.06;
          }
        });
      });
      orbPool.instanceMatrix.needsUpdate = true;
      if (!frame.flames) frame.flames = [];
      while (frame.flames.length < flames.length) { var fm = new T.Mesh(flameGeo, flameMat); scene.add(fm); frame.flames.push(fm); }
      frame.flames.forEach(function (fm, i2) {
        var pm2 = flames[i2];
        fm.visible = !!pm2;
        if (!pm2) return;
        fm.position.set(pm2.g.position.x, 0.9, pm2.g.position.z);
        fm.rotation.set(0, pm2.a - Math.PI / 2, 0);
        var fl2 = 3.6 + Math.sin(tAcc * 30) * 0.3;
        fm.scale.set(fl2, 1.2 + Math.sin(tAcc * 25) * 0.2, 1.2);
      });

      // 投射物
      for (var si = 0; si < v.S.length; si++) {
        var sh = v.S[si];
        var sk = VIS2SHOT[sh.k] || "orb";
        var sp = sPool(sk);
        if (sp === orbPool) continue;
        if (sp.count >= sp.instanceMatrix.count) continue;
        var so = sm("s" + sh.id, sh.x, sh.z, Math.min(1, k * 2));
        var sy = sk === "bolt" ? Math.max(0, (sh.dl !== undefined && sh.dl >= 0 ? sh.dl : 0.1)) * 30 : sk === "ice" || sk === "rainarrow" ? 0.5 + Math.max(0, (sh.dl !== undefined && sh.dl >= 0 ? sh.dl : 0.3)) * 18 : sk === "horse" ? 0 : 0.9 + (sh.h || 0);
        var rotY = -(sh.a || 0), rotX = 0;
        if (sk === "star" || sk === "fan") rotY = tAcc * 18;
        if (sk === "kama" || sk === "chakram") rotY = tAcc * 16;
        if (sk === "leaf" || sk === "pebble") { rotY = tAcc * 10 + sh.id; rotX = tAcc * 6; }
        if (sk === "fireball") rotX = Math.sin(tAcc * 9 + sh.id) * 0.3;
        var ssc = sk === "horse" ? 1.1 : sk === "ball" ? 1 : sk === "crescent" ? 1.5 : sk === "bolt" ? 1.4 : 1.2;
        _m.compose(_v.set(so.x, sy, so.z), _q.setFromEuler(_e.set(rotX, rotY, 0)), _s.set(ssc, ssc, ssc));
        sp.setMatrixAt(sp.count++, _m);
      }
      // 敵彈
      for (var bi = 0; bi < v.B.length; bi++) {
        var b = v.B[bi];
        if (bulletPool.count >= bulletPool.instanceMatrix.count) break;
        var bo = sm("b" + b.id, b.x, b.z, Math.min(1, k * 2));
        var bs = b.k === "orb" ? 1.3 : 0.8;
        _m.compose(_v.set(bo.x, 0.9, bo.z), _q.identity(), _s.set(bs, bs, bs));
        bulletPool.setMatrixAt(bulletPool.count++, _m);
      }
      Object.keys(sPools).forEach(function (kk) { sPools[kk].instanceMatrix.needsUpdate = true; });

      // 經驗珠、道具
      Object.keys(pickPools).forEach(function (kk) { pickPools[kk].count = 0; });
      for (var gi = 0; gi < v.G.length; gi++) {
        var gm = v.G[gi];
        if (Math.abs(gm.x - camX) > 28 || Math.abs(gm.z - camZ) > 24) continue;
        var gpool = pkPool(gm.v >= 20 ? "gem2" : gm.v >= 5 ? "gem1" : "gem0");
        if (gpool.count >= gpool.instanceMatrix.count) continue;
        var go = sm("g" + gm.id, gm.x, gm.z, Math.min(1, k * 2));
        _m.compose(_v.set(go.x, 0.35 + Math.sin(tAcc * 3 + gm.id) * 0.08, go.z), _q.setFromEuler(_e.set(0, tAcc * 2 + gm.id, 0)), _s.set(1, 1, 1));
        gpool.setMatrixAt(gpool.count++, _m);
      }
      for (var di = 0; di < v.D.length; di++) {
        var dr = v.D[di];
        var dk = dr.k;
        if (!PICKS[dk]) continue;
        var dpool = pkPool(dk);
        if (dpool.count >= dpool.instanceMatrix.count) continue;
        var dob = sm("d" + dr.id, dr.x, dr.z, Math.min(1, k * 2));
        var dy = dk === "coin" ? 0.4 : dk === "food" ? 0.45 + Math.sin(tAcc * 3 + dr.id) * 0.1 : dk === "chest" ? 0.3 : 0;
        var ds = dk === "chest" && dr.big ? 1.4 : dk === "food" ? 1.1 : dk === "hokora" ? 1 + (dr.p || 0) * 0.08 : 1;
        _m.compose(_v.set(dob.x, dy, dob.z), _q.setFromEuler(_e.set(0, dk === "coin" || dk === "food" ? tAcc * 2.5 + dr.id : dk === "warashi" ? dob.a : 0, 0)), _s.set(ds, ds, ds));
        dpool.setMatrixAt(dpool.count++, _m);
      }
      Object.keys(pickPools).forEach(function (kk) { pickPools[kk].instanceMatrix.needsUpdate = true; });

      // 區域、預警
      var zSeen = {};
      (v.Z || []).forEach(function (z) {
        zSeen[z.id] = 1;
        var zm = zoneMesh(z);
        zm.position.set(z.x, 0, z.z);
        if (z.k === "pool" || z.k === "hata") zm.children[0].scale.setScalar(z.r);
        if (z.k === "kiri") { zm.scale.set(z.r, 1 + Math.sin(tAcc * 2 + z.id) * 0.1, z.r); zm.rotation.y = tAcc * 0.4; }
        if (z.k === "hata") zm.children[2].rotation.y = Math.sin(tAcc * 3) * 0.3;
        if (z.k === "pool") zm.children[0].material.opacity = 0.5 + Math.sin(tAcc * 6) * 0.15;
      });
      Object.keys(zoneMeshes).forEach(function (id) { if (!zSeen[id]) { scene.remove(zoneMeshes[id]); delete zoneMeshes[id]; } });
      var wSeen = {};
      (v.W || []).forEach(function (w) {
        wSeen[w.id] = 1;
        var wm = warnMesh(w);
        var prog = w.p !== undefined ? w.p : 1 - w.t / w.T;
        wm.position.set(w.x, 0, w.z);
        wm.children[0].scale.setScalar(w.r);
        wm.userData.fill.scale.setScalar(Math.max(0.01, w.r * prog));
        wm.children[0].material.opacity = 0.5 + Math.sin(tAcc * 18) * 0.35;
        if (wm.userData.ball) wm.userData.ball.position.y = (1 - prog) * 14 + 0.3;
      });
      Object.keys(warnMeshes).forEach(function (id) { if (!wSeen[id]) { scene.remove(warnMeshes[id]); delete warnMeshes[id]; } });

      // 特效（依 id 只播一次）
      (v.fx || []).forEach(function (f) {
        if (fxSeen[f.id]) return;
        fxSeen[f.id] = tAcc;
        if (Math.abs(f.x - camX) > 32 || Math.abs(f.z - camZ) > 28) return;
        if (f.k === "die" && fxLive.length > 160) return;
        spawnFx(f);
      });
      if (frameNo % 120 === 0) Object.keys(fxSeen).forEach(function (id) { if (tAcc - fxSeen[id] > 5) delete fxSeen[id]; });
      for (var fi = fxLive.length - 1; fi >= 0; fi--) {
        var L2 = fxLive[fi];
        L2.t += dt;
        var pr = L2.t / L2.life;
        if (pr >= 1) { scene.remove(L2.o); if (L2.o.material && L2.o.material.map) L2.o.material.map.dispose(); if (L2.o.material) L2.o.material.dispose(); fxLive.splice(fi, 1); continue; }
        L2.o.material.opacity = L2.base * (1 - pr);
        if (L2.o.userData.grow) L2.o.scale.setScalar(L2.o.userData.grow * (0.3 + pr * 0.9));
        if (L2.o.userData.rise) L2.o.position.y += dt * 2;
      }
      if (flashT > 0) { flashT -= dt; flashLight.intensity = Math.max(0, flashT / 0.15) * 2.2; }
      // 清掉沒用到的平滑資料
      if (frameNo % 90 === 0) Object.keys(smooth).forEach(function (id) { if (frameNo - smooth[id].seen > 60) delete smooth[id]; });

      updateMusume(v);
      if (frameNo % 2 === 0) updatePins(v, me);
      renderer.render(scene, camera);
    }
    raf = requestAnimationFrame(frame);

    function resize() {
      var w = box.clientWidth || 800, h = box.clientHeight || 500;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    window.addEventListener("resize", resize);
    resize();
    return {
      resize: resize,
      toWorldDir: function () { return 0; },
      destroy: function () {
        if (pinLayer.parentNode) pinLayer.parentNode.removeChild(pinLayer);
        dead = true;
        cancelAnimationFrame(raf);
        window.removeEventListener("resize", resize);
        scene.traverse(function (o) { if (o.geometry) o.geometry.dispose(); if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); } });
        renderer.dispose();
        if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
    };
  }
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

  // 大名的 3D 肖像（角色選擇用的小預覽；共用一個 renderer）
  var pv = null;
  function portrait(dm, size) {
    if (!window.THREE) return null;
    T = window.THREE;
    if (!_m) { _m = new T.Matrix4(); _q = new T.Quaternion(); _e = new T.Euler(); _v = new T.Vector3(); _s = new T.Vector3(); }
    if (!pv) {
      var r = new T.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      var sc = new T.Scene();
      sc.add(new T.HemisphereLight(0xffffff, 0x404040, 0.9));
      var dl = new T.DirectionalLight(0xffffff, 0.9); dl.position.set(2, 4, 3); sc.add(dl);
      var cam = new T.PerspectiveCamera(30, 1, 0.1, 50);
      cam.position.set(1.4, 1.9, 5.6); cam.lookAt(0, 1.35, 0); cam.updateMatrixWorld();
      pv = { r: r, sc: sc, cam: cam, g: null };
    }
    var d = D.DAIMYO[dm] || D.DAIMYO[0];
    if (pv.g) { pv.sc.remove(pv.g); pv.g.traverse(function (o) { if (o.geometry) o.geometry.dispose(); }); }
    pv.g = buildSamurai(d, D.ARCHES[D.WEAPONS[d.start].a].k);
    pv.g.rotation.y = 0.35;
    pv.sc.add(pv.g);
    pv.r.setSize(size, size, false);
    pv.cam.aspect = 1; pv.cam.updateProjectionMatrix();
    pv.r.render(pv.sc, pv.cam);
    return pv.r.domElement.toDataURL("image/png");
  }

  window.PriTestYukimura3D = { available: available, load: load, create: create, portrait: portrait };
})();
