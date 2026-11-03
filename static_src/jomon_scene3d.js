// 繩文帝國（jomon）：Three.js 3D 村落場景。
// 全部模型都是程序建模（不載入外部模型檔）：地形（山、河、海）、森林、竪穴住居→高床→瓦葺→町家依時代換造型、
// 村落中心與時代建築（環濠、前方後圓墳、五重塔、大佛殿、鳳凰堂、天守……）、水田、集散地、兵營、柵與石垣、
// 走動的村民、在村裡列隊的士兵、出征與歸來的部隊、來襲的敵軍、晝夜循環與炊煙。
// 大量重複的物件（住居、樹、村民、士兵）用 InstancedMesh，數量再多也只有少數 draw call。
// 遊戲數值不在這裡：jomon.js 每 0.25 秒把畫面需要的數字（view）交給 update()，這裡只負責呈現。
// three.js 與其他遊戲共用 static/vendor/three.min.js（r149），網址由頁面放在 #jm-app[data-three-src]。
(function () {
  "use strict";

  var THREE = null;
  var loading = null;

  function supported() {
    try {
      var c = document.createElement("canvas");
      return !!(window.WebGLRenderingContext && (c.getContext("webgl2") || c.getContext("webgl")));
    } catch (e) {
      return false;
    }
  }

  function load(src) {
    if (THREE) return Promise.resolve(THREE);
    if (window.THREE && window.THREE.WebGLRenderer) {
      THREE = window.THREE;
      return Promise.resolve(THREE);
    }
    if (loading) return loading;
    loading = new Promise(function (resolve, reject) {
      if (!src) {
        reject(new Error("no three src"));
        return;
      }
      var s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.onload = function () {
        if (window.THREE && window.THREE.WebGLRenderer) {
          THREE = window.THREE;
          resolve(THREE);
        } else reject(new Error("THREE missing"));
      };
      s.onerror = function () {
        loading = null;
        reject(new Error("load failed"));
      };
      document.head.appendChild(s);
    });
    return loading;
  }

  // ---------------- 小工具 ----------------

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }
  function smooth(a, b, x) {
    var t = clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  }
  function lerp(a, b, k) {
    return a + (b - a) * k;
  }
  function makeRng(seed) {
    var a = seed >>> 0 || 1;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // 便宜的平滑雜訊（正弦疊加）
  function noise(x, z) {
    return (
      Math.sin(x * 1.13 + Math.sin(z * 0.71) * 1.7) * 0.5 +
      Math.sin(z * 0.93 + Math.sin(x * 0.57) * 1.3) * 0.35 +
      Math.sin((x + z) * 2.1 + 1.3) * 0.1 +
      Math.sin((x - z) * 3.7 + 0.4) * 0.05
    );
  }

  // ---------------- 地形 ----------------
  // 村子在原點；河流南北向流過東側；海在最東邊；西、北是森林與山。

  var WATER_Y = -0.6;
  var MAP = 440;

  function riverX(z) {
    return 64 + Math.sin(z / 38) * 13 + Math.sin(z / 17 + 1) * 3;
  }

  function height(x, z) {
    var r = Math.sqrt(x * x + z * z);
    // 基準高度 1.6：一般地面都在水面以上，低窪處（雜訊）只會形成少數小池塘
    var h = 1.6 + noise(x * 0.035, z * 0.035) * 1.5 * lerp(0.2, 1, smooth(22, 70, r));
    var eastFade = 1 - smooth(50, 130, x);
    var mt = smooth(100, 200, r) * (12 + 20 * (0.5 + 0.5 * noise(x * 0.02 + 3, z * 0.02 - 2))) * eastFade;
    mt += smooth(-60, -190, z) * 10 * eastFade * (0.6 + 0.4 * noise(x * 0.05, 4));
    h += mt;
    h += 7 * Math.exp(-((x - 42) * (x - 42) + (z + 84) * (z + 84)) / 260); // 採石的岩山
    h += 9 * Math.exp(-((x + 48) * (x + 48) + (z + 102) * (z + 102)) / 320); // 金山
    var d = Math.abs(x - riverX(z));
    if (d < 11) h = lerp(-2.4, h, smooth(3.8, 11, d));
    h = lerp(h, -7, smooth(132, 158, x));
    return h;
  }

  function slopeAt(x, z) {
    var e = 1.2;
    return Math.abs(height(x + e, z) - height(x - e, z)) + Math.abs(height(x, z + e) - height(x, z - e));
  }

  // ---------------- 材質與幾何快取 ----------------

  function Kit() {
    this.mats = {};
    this.geos = {};
  }
  Kit.prototype.mat = function (color, opts) {
    var key = color + "|" + JSON.stringify(opts || {});
    if (!this.mats[key]) {
      var o = { color: color, roughness: 0.92, metalness: 0, flatShading: true };
      Object.keys(opts || {}).forEach(function (k) {
        o[k] = opts[k];
      });
      this.mats[key] = new THREE.MeshStandardMaterial(o);
    }
    return this.mats[key];
  };
  Kit.prototype.geo = function (key, make) {
    if (!this.geos[key]) this.geos[key] = make();
    return this.geos[key];
  };
  Kit.prototype.dispose = function () {
    var self = this;
    Object.keys(this.mats).forEach(function (k) {
      self.mats[k].dispose();
    });
    Object.keys(this.geos).forEach(function (k) {
      self.geos[k].dispose();
    });
  };

  // 部件：{ geo, mat, m（相對於建築原點的矩陣） }
  function part(geo, mat, x, y, z, sx, sy, sz, ry, rx, rz) {
    var m = new THREE.Matrix4();
    var q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx || 0, ry || 0, rz || 0));
    m.compose(new THREE.Vector3(x || 0, y || 0, z || 0), q, new THREE.Vector3(sx == null ? 1 : sx, sy == null ? 1 : sy, sz == null ? 1 : sz));
    return { geo: geo, mat: mat, m: m };
  }

  // 常用幾何（單位大小，靠縮放調整）
  function G(kit) {
    return {
      box: kit.geo("box", function () {
        return new THREE.BoxGeometry(1, 1, 1);
      }),
      cyl: kit.geo("cyl", function () {
        return new THREE.CylinderGeometry(0.5, 0.5, 1, 10);
      }),
      cyl6: kit.geo("cyl6", function () {
        return new THREE.CylinderGeometry(0.5, 0.5, 1, 6);
      }),
      cone: kit.geo("cone", function () {
        return new THREE.ConeGeometry(0.5, 1, 10);
      }),
      cone8: kit.geo("cone8", function () {
        return new THREE.ConeGeometry(0.5, 1, 8);
      }),
      // 四角錐（寄棟／方形屋頂）：ConeGeometry 4 邊，轉 45°，底面為 1×1
      pyr: kit.geo("pyr", function () {
        var g = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4);
        g.rotateY(Math.PI / 4);
        return g;
      }),
      // 三角柱（切妻屋頂）：沿 x 軸，底寬 1（z 方向）、高 1、長 1
      prism: kit.geo("prism", function () {
        var shape = new THREE.Shape();
        shape.moveTo(-0.5, 0);
        shape.lineTo(0.5, 0);
        shape.lineTo(0, 1);
        shape.lineTo(-0.5, 0);
        var g = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false });
        g.translate(0, 0, -0.5);
        g.rotateY(Math.PI / 2);
        return g;
      }),
      sphere: kit.geo("sphere", function () {
        return new THREE.SphereGeometry(0.5, 10, 8);
      }),
      ico: kit.geo("ico", function () {
        return new THREE.IcosahedronGeometry(0.5, 0);
      }),
      ico1: kit.geo("ico1", function () {
        return new THREE.IcosahedronGeometry(0.5, 1);
      }),
      dodeca: kit.geo("dodeca", function () {
        return new THREE.DodecahedronGeometry(0.5, 0);
      }),
    };
  }

  // ---------------- 調色盤 ----------------

  var COL = {
    thatch: 0x9a7a45,
    thatchDark: 0x6e5530,
    earth: 0x7a5c3c,
    wood: 0x8b5a2b,
    woodDark: 0x4e3420,
    woodLight: 0xb88a55,
    plaster: 0xf1ebdc,
    tile: 0x4a4f57,
    tileDark: 0x34383e,
    bark: 0x6b4630,
    vermilion: 0xc8402c,
    gold: 0xd9b23a,
    stone: 0x9b978c,
    stoneDark: 0x77736a,
    grassMound: 0x5f8f3e,
    water: 0x3f86b8,
    rice: 0x9cc65a,
    riceWater: 0x6aa3a8,
    leaf: 0x3f7a35,
    leaf2: 0x4f8f3a,
    leafDark: 0x2f5f2c,
    trunk: 0x5a3d26,
    skin: 0xe0b48a,
    cloth: 0xd9ccb0,
  };

  // ---------------- 建築模型 ----------------

  // 一般住居（依時代分 5 種造型）
  function houseStyle(kit, age) {
    var g = G(kit);
    var P = [];
    if (age <= 1) {
      // 竪穴住居：圓錐茅草屋頂
      P.push(part(g.cyl, kit.mat(COL.earth), 0, 0.25, 0, 4.4, 0.5, 4.4));
      P.push(part(g.cone, kit.mat(COL.thatch), 0, 0.5 + 1.7, 0, 5.6, 3.4, 5.6));
      P.push(part(g.cone, kit.mat(COL.thatchDark), 0, 3.95, 0, 1.3, 0.7, 1.3));
      P.push(part(g.box, kit.mat(COL.woodDark), 0, 0.75, 2.2, 1.0, 1.1, 1.0));
      if (age === 1) P.push(part(g.box, kit.mat(COL.woodLight), 0, 1.3, 2.75, 1.3, 0.2, 0.5));
    } else if (age === 2) {
      // 切妻の茅葺き平地住居
      P.push(part(g.box, kit.mat(COL.woodLight), 0, 1, 0, 4.2, 2, 3.2));
      P.push(part(g.prism, kit.mat(COL.thatch), 0, 2, 0, 4.9, 2.2, 4.0));
      P.push(part(g.box, kit.mat(COL.woodDark), 0, 0.7, 1.62, 1.0, 1.4, 0.1));
    } else if (age <= 4) {
      // 瓦葺き：白壁＋寄棟
      P.push(part(g.box, kit.mat(COL.stoneDark), 0, 0.2, 0, 4.8, 0.4, 3.8));
      P.push(part(g.box, kit.mat(COL.plaster), 0, 1.4, 0, 4.4, 2.0, 3.4));
      P.push(part(g.box, kit.mat(COL.wood), 0, 2.45, 0, 4.5, 0.2, 3.5));
      P.push(part(g.pyr, kit.mat(COL.tile), 0, 2.55 + 0.9, 0, 6.0, 1.8, 4.8));
      P.push(part(g.box, kit.mat(COL.woodDark), 0, 1.0, 1.72, 1.1, 1.6, 0.08));
    } else if (age === 5) {
      // 檜皮葺きの屋敷
      P.push(part(g.box, kit.mat(COL.wood), 0, 0.5, 0, 5.2, 0.3, 4.2));
      P.push(part(g.box, kit.mat(COL.woodLight), 0, 1.6, 0, 4.6, 2.0, 3.6));
      P.push(part(g.pyr, kit.mat(COL.bark), 0, 2.6 + 0.9, 0, 6.4, 1.8, 5.2));
      P.push(part(g.box, kit.mat(COL.woodDark), 0, 1.2, 1.82, 1.2, 1.4, 0.08));
    } else if (age === 6) {
      // 武家の茅葺き屋敷
      P.push(part(g.box, kit.mat(COL.woodLight), 0, 1.2, 0, 4.8, 2.4, 3.8));
      P.push(part(g.pyr, kit.mat(COL.thatchDark), 0, 2.4 + 1.25, 0, 6.6, 2.5, 5.4));
      P.push(part(g.box, kit.mat(COL.woodDark), 0, 0.9, 1.92, 1.2, 1.6, 0.08));
    } else {
      // 町家：2 階建て、黒い格子、瓦の切妻
      P.push(part(g.box, kit.mat(COL.woodDark), 0, 1.25, 0, 4.4, 2.5, 3.6));
      P.push(part(g.prism, kit.mat(COL.tile), 0, 2.5, 0.6, 4.7, 0.8, 2.6));
      P.push(part(g.box, kit.mat(COL.plaster), 0, 3.4, -0.3, 4.2, 1.8, 2.8));
      P.push(part(g.prism, kit.mat(COL.tileDark), 0, 4.3, -0.3, 4.6, 1.4, 3.6));
      P.push(part(g.box, kit.mat(COL.wood), 0, 1.0, 1.82, 3.4, 1.4, 0.08));
    }
    return P;
  }

  // 家門口的燈（夜晚發光）：住居原點的相對位置
  function houseLightOffset(age) {
    if (age <= 1) return [0, 0.8, 2.75];
    if (age === 2) return [0, 0.8, 1.72];
    return [0, 1.1, age >= 7 ? 1.9 : 1.8];
  }

  function shedStyle(kit, kind) {
    var g = G(kit);
    var P = [];
    [-1.6, 1.6].forEach(function (x) {
      [-1.2, 1.2].forEach(function (z) {
        P.push(part(g.cyl6, kit.mat(COL.wood), x, 1.1, z, 0.25, 2.2, 0.25));
      });
    });
    P.push(part(g.prism, kit.mat(COL.thatch), 0, 2.1, 0, 4.2, 1.2, 3.4));
    if (kind === "food") {
      P.push(part(g.cyl, kit.mat(0xc9a35e), -0.7, 0.4, 0, 0.9, 0.8, 0.9));
      P.push(part(g.cyl, kit.mat(0xb08a4a), 0.6, 0.35, 0.3, 0.8, 0.7, 0.8));
      P.push(part(g.sphere, kit.mat(0xb6452f), 0.6, 0.85, 0.3, 0.5, 0.35, 0.5));
    } else if (kind === "wood") {
      for (var i = 0; i < 4; i++) P.push(part(g.cyl6, kit.mat(COL.bark), 0, 0.25 + Math.floor(i / 2) * 0.45, -0.6 + (i % 2) * 0.55, 0.45, 2.8, 0.45, 0, 0, Math.PI / 2));
    } else {
      P.push(part(g.dodeca, kit.mat(COL.stone), -0.6, 0.45, 0, 1.0, 0.9, 1.0));
      P.push(part(g.dodeca, kit.mat(0xd6b44a, { metalness: 0.3, roughness: 0.5 }), 0.7, 0.35, 0.2, 0.7, 0.7, 0.7));
    }
    return P;
  }

  function paddyStyle(kit) {
    var g = G(kit);
    return [
      part(g.box, kit.mat(COL.earth), 0, 0.05, 0, 6.6, 0.3, 5.6),
      part(g.box, kit.mat(COL.riceWater, { roughness: 0.3 }), 0, 0.22, 0, 6.0, 0.06, 5.0),
      part(g.box, kit.mat(COL.rice), 0, 0.42, -1.4, 5.6, 0.4, 0.5),
      part(g.box, kit.mat(COL.rice), 0, 0.42, 0, 5.6, 0.4, 0.5),
      part(g.box, kit.mat(COL.rice), 0, 0.42, 1.4, 5.6, 0.4, 0.5),
    ];
  }

  function barracksStyle(kit, kind, age) {
    var g = G(kit);
    var P = [];
    var roof = age >= 3 ? COL.tile : COL.thatch;
    if (kind === "barracks") {
      P.push(part(g.box, kit.mat(COL.woodLight), 0, 1.2, 0, 7, 2.4, 3.6));
      P.push(part(g.prism, kit.mat(roof), 0, 2.4, 0, 7.6, 1.8, 4.4));
      P.push(part(g.box, kit.mat(0xb33a2a), 3.9, 1.6, 0, 0.1, 3.2, 0.1));
      P.push(part(g.box, kit.mat(0xb33a2a), 3.9, 2.8, 0.5, 0.05, 0.8, 1.0));
    } else if (kind === "archery") {
      P.push(part(g.box, kit.mat(COL.woodLight), -2.2, 1.0, 0, 2.8, 2.0, 3.0));
      P.push(part(g.prism, kit.mat(roof), -2.2, 2.0, 0, 3.4, 1.2, 3.6));
      [1.2, 2.6, 4.0].forEach(function (x) {
        P.push(part(g.cyl, kit.mat(0xeeeeee), x, 1.0, 0, 0.9, 0.15, 0.9, 0, Math.PI / 2));
        P.push(part(g.cyl, kit.mat(0xc0392b), x, 1.0, 0.09, 0.4, 0.04, 0.4, 0, Math.PI / 2));
        P.push(part(g.cyl6, kit.mat(COL.wood), x, 0.4, -0.15, 0.12, 0.8, 0.12));
      });
    } else if (kind === "stable") {
      P.push(part(g.box, kit.mat(COL.wood), 0, 1.0, 0, 8, 2.0, 3.2));
      P.push(part(g.prism, kit.mat(roof), 0, 2.0, 0, 8.6, 1.2, 4.0));
      P.push(part(g.box, kit.mat(0x6b4a2e), -1.5, 0.9, 2.4, 1.6, 0.9, 0.5));
      P.push(part(g.box, kit.mat(0x6b4a2e), -0.75, 1.4, 2.4, 0.5, 0.6, 0.35));
    } else {
      // 工房：棚子＋投石機
      P.push(part(g.box, kit.mat(COL.woodDark), -2, 1.0, 0, 3.2, 2.0, 3.0));
      P.push(part(g.prism, kit.mat(roof), -2, 2.0, 0, 3.8, 1.2, 3.6));
      P.push(part(g.box, kit.mat(COL.wood), 2, 0.5, 0, 2.6, 0.4, 1.6));
      P.push(part(g.box, kit.mat(COL.wood), 2, 1.4, 0, 0.3, 1.8, 0.3));
      P.push(part(g.box, kit.mat(COL.woodDark), 2, 2.2, 0, 3.4, 0.2, 0.2, 0, 0, 0.5));
    }
    return P;
  }

  function towerStyle(kit, age) {
    var g = G(kit);
    var P = [];
    var h = 6 + Math.min(age, 6) * 0.3;
    [-0.9, 0.9].forEach(function (x) {
      [-0.9, 0.9].forEach(function (z) {
        P.push(part(g.cyl6, kit.mat(COL.wood), x, h / 2, z, 0.3, h, 0.3));
      });
    });
    P.push(part(g.box, kit.mat(COL.woodLight), 0, h, 0, 2.6, 0.25, 2.6));
    P.push(part(g.box, kit.mat(COL.woodLight), 0, h + 0.5, 0, 2.6, 0.8, 2.6));
    P.push(part(age >= 3 ? g.pyr : g.cone8, kit.mat(age >= 3 ? COL.tile : COL.thatch), 0, h + 1.6, 0, 3.4, 1.4, 3.4));
    return P;
  }

  function marketStyle(kit) {
    var g = G(kit);
    var P = [];
    var cols = [0xc0392b, 0x2e86c1, 0xd4ac0d, 0x27ae60];
    for (var i = 0; i < 4; i++) {
      var x = (i % 2) * 5 - 2.5;
      var z = Math.floor(i / 2) * 5 - 2.5;
      P.push(part(g.box, kit.mat(COL.woodLight), x, 0.5, z, 3, 1, 2));
      P.push(part(g.prism, kit.mat(cols[i]), x, 1.8, z, 3.4, 0.9, 2.8));
      [-1.4, 1.4].forEach(function (dx) {
        P.push(part(g.cyl6, kit.mat(COL.wood), x + dx, 0.9, z + 1.1, 0.15, 1.8, 0.15));
      });
    }
    return P;
  }

  // ---------------- 單體建築（Group）：村落中心、時代建築 ----------------

  function addParts(group, parts, castShadow) {
    parts.forEach(function (p) {
      var mesh = new THREE.Mesh(p.geo, p.mat);
      mesh.matrixAutoUpdate = false;
      mesh.matrix.copy(p.m);
      mesh.castShadow = castShadow !== false;
      mesh.receiveShadow = true;
      group.add(mesh);
    });
    return group;
  }

  function pitHouseParts(kit, x, z, s) {
    return houseStyle(kit, 0).map(function (p) {
      var m = new THREE.Matrix4().makeTranslation(x, 0, z).multiply(new THREE.Matrix4().makeScale(s, s, s)).multiply(p.m);
      return { geo: p.geo, mat: p.mat, m: m };
    });
  }

  function raisedStoreParts(kit, x, z, s, roofColor) {
    var g = G(kit);
    var P = [];
    s = s || 1;
    [-1, 1].forEach(function (dx) {
      [-0.8, 0.8].forEach(function (dz) {
        P.push(part(g.cyl6, kit.mat(COL.wood), x + dx * s, 1.0 * s, z + dz * s, 0.3 * s, 2.0 * s, 0.3 * s));
      });
    });
    P.push(part(g.box, kit.mat(COL.woodLight), x, 2.6 * s, z, 2.8 * s, 1.4 * s, 2.2 * s));
    P.push(part(g.prism, kit.mat(roofColor || COL.thatch), x, 3.3 * s, z, 3.8 * s, 1.8 * s, 3.2 * s));
    P.push(part(g.box, kit.mat(COL.woodDark), x + 1.2 * s, 1.0 * s, z, 0.3 * s, 2.0 * s, 0.6 * s, 0, 0, 0.5));
    return P;
  }

  // 殿舍：基壇＋柱＋牆＋屋頂（hip 寄棟 / gable 切妻）
  function hallParts(kit, o) {
    var g = G(kit);
    var P = [];
    var x = o.x || 0;
    var z = o.z || 0;
    var w = o.w;
    var d = o.d;
    var baseH = o.baseH == null ? 0.6 : o.baseH;
    var wallH = o.h;
    var y0 = o.y || 0;
    if (baseH > 0) P.push(part(g.box, kit.mat(o.baseColor || COL.stone), x, y0 + baseH / 2, z, w + 1.2, baseH, d + 1.2, o.ry || 0));
    P.push(part(g.box, kit.mat(o.wall || COL.plaster), x, y0 + baseH + wallH / 2, z, w, wallH, d, o.ry || 0));
    if (o.pillars) {
      var px = [-w / 2, -w / 6, w / 6, w / 2];
      px.forEach(function (dx) {
        [-d / 2, d / 2].forEach(function (dz) {
          var c = Math.cos(o.ry || 0);
          var sn = Math.sin(o.ry || 0);
          P.push(part(g.cyl6, kit.mat(o.pillars), x + dx * c + dz * sn, y0 + baseH + wallH / 2, z - dx * sn + dz * c, 0.35, wallH, 0.35));
        });
      });
    }
    var roofY = y0 + baseH + wallH;
    if (o.roof === "gable") P.push(part(g.prism, kit.mat(o.roofColor || COL.tile), x, roofY, z, w * 1.18, o.roofH || 2, d * 1.35, o.ry || 0));
    else P.push(part(g.pyr, kit.mat(o.roofColor || COL.tile), x, roofY + (o.roofH || 2) / 2, z, w * 1.35, o.roofH || 2, d * 1.4, o.ry || 0));
    if (o.ridge) P.push(part(g.box, kit.mat(COL.gold, { metalness: 0.5, roughness: 0.4 }), x, roofY + (o.roofH || 2) + 0.1, z, w * 0.5, 0.25, 0.25, o.ry || 0));
    return P;
  }

  function pagodaParts(kit, x, z, tiers, s) {
    var g = G(kit);
    var P = [];
    s = s || 1;
    P.push(part(g.box, kit.mat(COL.stone), x, 0.4 * s, z, 6 * s, 0.8 * s, 6 * s));
    var y = 0.8 * s;
    for (var i = 0; i < tiers; i++) {
      var k = 1 - i * 0.12;
      var h = 1.8 * s;
      P.push(part(g.box, kit.mat(COL.vermilion), x, y + h / 2, z, 3.6 * k * s, h, 3.6 * k * s));
      P.push(part(g.pyr, kit.mat(COL.tile), x, y + h + 0.5 * s, z, 6.4 * k * s, 1.0 * s, 6.4 * k * s));
      y += h + 0.9 * s;
    }
    P.push(part(g.cyl, kit.mat(COL.gold, { metalness: 0.6, roughness: 0.35 }), x, y + 2 * s, z, 0.3 * s, 4.5 * s, 0.3 * s));
    for (var j = 0; j < 5; j++) P.push(part(g.cyl, kit.mat(COL.gold, { metalness: 0.6, roughness: 0.35 }), x, y + 0.9 * s + j * 0.6 * s, z, 0.9 * s, 0.12 * s, 0.9 * s));
    return P;
  }

  function keepParts(kit, x, z, tiers, s) {
    var g = G(kit);
    var P = [];
    s = s || 1;
    // 石垣（梯形）
    var baseGeo = kit.geo("keepBase", function () {
      var gg = new THREE.CylinderGeometry(Math.SQRT1_2 * 0.78, Math.SQRT1_2, 1, 4);
      gg.rotateY(Math.PI / 4);
      return gg;
    });
    P.push(part(baseGeo, kit.mat(COL.stoneDark), x, 2.5 * s, z, 16 * s, 5 * s, 13 * s));
    var y = 5 * s;
    for (var i = 0; i < tiers; i++) {
      var k = 1 - i * 0.17;
      var h = 2.6 * s;
      P.push(part(g.box, kit.mat(COL.plaster), x, y + h / 2, z, 10 * k * s, h, 8 * k * s));
      P.push(part(g.box, kit.mat(COL.woodDark), x, y + h * 0.75, z, 10.1 * k * s, 0.35 * s, 8.1 * k * s));
      P.push(part(g.pyr, kit.mat(COL.tileDark), x, y + h + 0.8 * s, z, 13.5 * k * s, 1.6 * s, 11 * k * s));
      // 千鳥破風
      P.push(part(g.prism, kit.mat(COL.tileDark), x, y + h, z + 4 * k * s, 4 * k * s, 1.6 * s, 2.4 * s));
      y += h + 1.4 * s;
    }
    P.push(part(g.box, kit.mat(COL.gold, { metalness: 0.6, roughness: 0.35 }), x - 1.5 * s, y + 0.4 * s, z, 0.5 * s, 0.9 * s, 0.4 * s));
    P.push(part(g.box, kit.mat(COL.gold, { metalness: 0.6, roughness: 0.35 }), x + 1.5 * s, y + 0.4 * s, z, 0.5 * s, 0.9 * s, 0.4 * s));
    return P;
  }

  function toriiParts(kit, x, z, s, ry) {
    var g = G(kit);
    s = s || 1;
    var c = Math.cos(ry || 0);
    var sn = Math.sin(ry || 0);
    function at(dx) {
      return [x + dx * c, z - dx * sn];
    }
    var a = at(-2 * s);
    var b = at(2 * s);
    return [
      part(g.cyl, kit.mat(COL.vermilion), a[0], 2.6 * s, a[1], 0.55 * s, 5.2 * s, 0.55 * s),
      part(g.cyl, kit.mat(COL.vermilion), b[0], 2.6 * s, b[1], 0.55 * s, 5.2 * s, 0.55 * s),
      part(g.box, kit.mat(COL.woodDark), x, 5.4 * s, z, 6.4 * s, 0.45 * s, 0.6 * s, ry || 0),
      part(g.box, kit.mat(COL.vermilion), x, 4.5 * s, z, 5.2 * s, 0.35 * s, 0.4 * s, ry || 0),
    ];
  }

  function fenceRingParts(kit, cx, cz, r, n, h, color) {
    var g = G(kit);
    var P = [];
    for (var i = 0; i < n; i++) {
      var a = (i / n) * Math.PI * 2;
      P.push(part(g.cyl6, kit.mat(color || COL.wood), cx + Math.cos(a) * r, h / 2, cz + Math.sin(a) * r, 0.3, h, 0.3));
    }
    return P;
  }

  function fenceRectParts(kit, cx, cz, w, d, step, h) {
    var g = G(kit);
    var P = [];
    for (var x = -w / 2; x <= w / 2 + 0.01; x += step) {
      P.push(part(g.cyl6, kit.mat(COL.wood), cx + x, h / 2, cz - d / 2, 0.25, h, 0.25));
      P.push(part(g.cyl6, kit.mat(COL.wood), cx + x, h / 2, cz + d / 2, 0.25, h, 0.25));
    }
    for (var z = -d / 2 + step; z < d / 2; z += step) {
      P.push(part(g.cyl6, kit.mat(COL.wood), cx - w / 2, h / 2, cz + z, 0.25, h, 0.25));
      P.push(part(g.cyl6, kit.mat(COL.wood), cx + w / 2, h / 2, cz + z, 0.25, h, 0.25));
    }
    return P;
  }

  function pondParts(kit, x, z, sx, sz) {
    var g = G(kit);
    return [part(g.cyl, kit.mat(COL.water, { roughness: 0.15, metalness: 0.1 }), x, 0.08, z, sx, 0.1, sz), part(g.cyl, kit.mat(COL.stone), x, 0.03, z, sx + 0.8, 0.06, sz + 0.8)];
  }

  // 村落中心（依時代）
  function townCenterParts(kit, age, main) {
    var g = G(kit);
    var P = [];
    if (age <= 1) {
      P = P.concat(pitHouseParts(kit, 0, 0, 2.0));
      if (age === 1) P = P.concat(raisedStoreParts(kit, 8, -3, 1.0));
      if (main) {
        // 廣場的火堆
        P.push(part(g.cyl, kit.mat(COL.stoneDark), 0, 0.15, 9, 2.2, 0.3, 2.2));
        P.push(part(g.cyl6, kit.mat(COL.trunk), 0, 0.5, 9, 0.3, 1.4, 0.3, 0, 0.6, 0));
        P.push(part(g.cyl6, kit.mat(COL.trunk), 0, 0.5, 9, 0.3, 1.4, 0.3, 0, -0.6, 0));
      }
    } else if (age === 2) {
      P = P.concat(hallParts(kit, { w: 9, d: 6, h: 3, baseH: 0.8, baseColor: COL.earth, wall: COL.woodLight, roof: "gable", roofColor: COL.thatch, roofH: 3.6 }));
      P = P.concat(raisedStoreParts(kit, 8, -4, 1.0));
      P = P.concat(fenceRectParts(kit, 0, 0, 24, 18, 1.6, 2.4));
    } else if (age <= 4) {
      P = P.concat(hallParts(kit, { w: 12, d: 7, h: 3.4, baseH: 1.0, pillars: COL.vermilion, roof: "hip", roofColor: COL.tile, roofH: 3.6, ridge: true }));
      P = P.concat(hallParts(kit, { x: -9, z: 6, w: 5, d: 4, h: 2.4, baseH: 0.5, roof: "hip", roofColor: COL.tile, roofH: 2 }));
      P = P.concat(hallParts(kit, { x: 9, z: 6, w: 5, d: 4, h: 2.4, baseH: 0.5, roof: "hip", roofColor: COL.tile, roofH: 2 }));
    } else if (age === 5) {
      P = P.concat(hallParts(kit, { w: 12, d: 7, h: 3, baseH: 1.0, baseColor: COL.wood, wall: COL.woodLight, pillars: COL.wood, roof: "hip", roofColor: COL.bark, roofH: 3.4 }));
      P = P.concat(hallParts(kit, { x: -10, z: 4, w: 5, d: 4, h: 2.2, baseH: 0.8, baseColor: COL.wood, wall: COL.woodLight, roof: "hip", roofColor: COL.bark, roofH: 2 }));
      P = P.concat(hallParts(kit, { x: 10, z: 4, w: 5, d: 4, h: 2.2, baseH: 0.8, baseColor: COL.wood, wall: COL.woodLight, roof: "hip", roofColor: COL.bark, roofH: 2 }));
      if (main) P = P.concat(pondParts(kit, 0, 13, 12, 5));
    } else if (age === 6) {
      P = P.concat(hallParts(kit, { w: 13, d: 8, h: 3.2, baseH: 0.6, wall: COL.woodLight, roof: "hip", roofColor: COL.thatchDark, roofH: 4 }));
      P = P.concat(fenceRectParts(kit, 0, 0, 30, 24, 1.4, 2.6));
      P = P.concat(hallParts(kit, { z: 12, w: 4, d: 2.2, h: 2.4, baseH: 0, wall: COL.woodDark, roof: "gable", roofColor: COL.tile, roofH: 1.4 }));
    } else {
      P = P.concat(keepParts(kit, 0, 0, age >= 8 ? 5 : 3, main ? 1 : 0.6));
    }
    return P;
  }

  // 時代建築
  function landmarkParts(kit, model) {
    var g = G(kit);
    var P = [];
    switch (model) {
      case "kangou":
        P = P.concat(fenceRingParts(kit, 0, 0, 7, 28, 2.6));
        P.push(part(g.cyl, kit.mat(COL.water, { roughness: 0.15 }), 0, 0.05, 0, 19, 0.1, 19));
        P.push(part(g.cyl, kit.mat(COL.grassMound), 0, 0.12, 0, 15, 0.14, 15));
        P = P.concat(towerStyle(kit, 1));
        break;
      case "takayuka":
        P = P.concat(raisedStoreParts(kit, -4, -3, 1.1), raisedStoreParts(kit, 4, -3, 1.1), raisedStoreParts(kit, 0, 4, 1.3));
        break;
      case "kofun": {
        var mound = kit.mat(COL.grassMound);
        P.push(part(g.cyl, kit.mat(COL.water, { roughness: 0.15 }), 0, 0.05, 0, 34, 0.1, 22));
        P.push(part(g.cyl, mound, 4, 1.6, 0, 14, 3.2, 14));
        P.push(part(g.cyl, mound, 4, 4.0, 0, 9.5, 1.8, 9.5));
        P.push(part(G(kit).box, mound, -6, 1.3, 0, 12, 2.6, 8, 0));
        P.push(part(g.box, mound, -11.5, 1.3, 0, 3, 2.6, 13));
        for (var hn = 0; hn < 10; hn++) {
          var ha = (hn / 10) * Math.PI * 2;
          P.push(part(g.cyl6, kit.mat(0xc98a5a), 4 + Math.cos(ha) * 7, 4.8, Math.sin(ha) * 7, 0.6, 1.0, 0.6));
        }
        break;
      }
      case "forge":
        P = P.concat(hallParts(kit, { w: 8, d: 5, h: 2.6, baseH: 0.3, baseColor: COL.earth, wall: COL.woodLight, roof: "gable", roofColor: COL.thatch, roofH: 2.6 }));
        P.push(part(g.cyl, kit.mat(COL.stoneDark), 3, 3.5, -1, 1.2, 5, 1.2));
        P.push(part(g.box, kit.mat(0x3b3b3b, { metalness: 0.6, roughness: 0.4 }), -5.5, 0.6, 2, 1.4, 0.7, 0.8));
        break;
      case "pagoda":
        P = P.concat(pagodaParts(kit, 0, 0, 5, 1));
        P = P.concat(hallParts(kit, { x: 0, z: 11, w: 9, d: 5, h: 2.6, baseH: 0.8, pillars: COL.vermilion, roof: "hip", roofColor: COL.tile, roofH: 2.6, ridge: true }));
        break;
      case "granary":
        for (var gi = 0; gi < 4; gi++) P = P.concat(raisedStoreParts(kit, -7.5 + gi * 5, 0, 1.0, COL.tile));
        break;
      case "daibutsuden":
        P = P.concat(hallParts(kit, { w: 20, d: 13, h: 6, baseH: 1.2, pillars: COL.vermilion, roof: "hip", roofColor: COL.tile, roofH: 6, ridge: true }));
        P = P.concat(hallParts(kit, { y: 7.2, w: 16, d: 10, h: 3, baseH: 0, pillars: COL.vermilion, roof: "hip", roofColor: COL.tile, roofH: 3.4 }));
        P.push(part(g.cyl, kit.mat(COL.stone), 0, 0.8, 13, 2.2, 1.6, 2.2));
        break;
      case "gate":
        P = P.concat(hallParts(kit, { w: 14, d: 5, h: 3.4, baseH: 0.6, pillars: COL.vermilion, wall: COL.vermilion, roof: "hip", roofColor: COL.tile, roofH: 2 }));
        P = P.concat(hallParts(kit, { y: 6, w: 12, d: 4.4, h: 2.4, baseH: 0, pillars: COL.vermilion, wall: COL.plaster, roof: "hip", roofColor: COL.tile, roofH: 2.6, ridge: true }));
        P.push(part(g.box, kit.mat(0xb7a98f), 0, 0.05, 9, 4, 0.1, 10));
        break;
      case "phoenix":
        P = P.concat(pondParts(kit, 0, 4, 26, 18));
        P = P.concat(hallParts(kit, { z: -2, w: 8, d: 6, h: 3.4, baseH: 0.8, pillars: COL.vermilion, roof: "hip", roofColor: COL.tile, roofH: 3, ridge: true }));
        P = P.concat(hallParts(kit, { x: -9, z: -1, w: 8, d: 2.6, h: 2.6, baseH: 0.6, pillars: COL.vermilion, roof: "hip", roofColor: COL.tile, roofH: 1.6 }));
        P = P.concat(hallParts(kit, { x: 9, z: -1, w: 8, d: 2.6, h: 2.6, baseH: 0.6, pillars: COL.vermilion, roof: "hip", roofColor: COL.tile, roofH: 1.6 }));
        P.push(part(g.box, kit.mat(COL.gold, { metalness: 0.7, roughness: 0.3 }), 0, 8.3, -2, 1.2, 0.8, 0.3));
        break;
      case "yakata":
        P = P.concat(hallParts(kit, { w: 12, d: 8, h: 3, baseH: 0.6, wall: COL.woodLight, roof: "hip", roofColor: COL.bark, roofH: 3.4 }));
        P = P.concat(fenceRectParts(kit, 0, 0, 22, 18, 1.4, 2.4));
        P.push(part(g.box, kit.mat(0xffffff), 6.5, 3.5, 9, 0.1, 7, 0.1));
        P.push(part(g.box, kit.mat(0xffffff), 6.5, 6, 9.6, 0.05, 2, 1.2));
        break;
      case "shrine":
        P = P.concat(toriiParts(kit, 0, 14, 1.6, 0));
        P = P.concat(hallParts(kit, { z: -3, w: 11, d: 7, h: 3.2, baseH: 1.4, baseColor: COL.stone, pillars: COL.vermilion, wall: COL.vermilion, roof: "gable", roofColor: COL.bark, roofH: 3.6 }));
        P.push(part(g.box, kit.mat(0xb7a98f), 0, 0.05, 6, 3, 0.1, 14));
        break;
      case "bakufu":
        P = P.concat(hallParts(kit, { w: 14, d: 8, h: 3.2, baseH: 0.6, wall: COL.woodLight, roof: "hip", roofColor: COL.tile, roofH: 3.4 }));
        P = P.concat(hallParts(kit, { x: -11, z: 6, w: 6, d: 5, h: 2.4, baseH: 0.4, wall: COL.woodLight, roof: "hip", roofColor: COL.tile, roofH: 2.2 }));
        P = P.concat(hallParts(kit, { x: 11, z: 6, w: 6, d: 5, h: 2.4, baseH: 0.4, wall: COL.woodLight, roof: "hip", roofColor: COL.tile, roofH: 2.2 }));
        P = P.concat(fenceRectParts(kit, 0, 2, 34, 24, 1.4, 2.8));
        break;
      case "castle":
        P = P.concat(keepParts(kit, 0, 0, 4, 0.9));
        break;
      case "market":
        P = P.concat(marketStyle(kit).map(function (p) {
          return { geo: p.geo, mat: p.mat, m: new THREE.Matrix4().makeTranslation(-6, 0, 0).multiply(p.m) };
        }));
        P = P.concat(marketStyle(kit).map(function (p) {
          return { geo: p.geo, mat: p.mat, m: new THREE.Matrix4().makeTranslation(6, 0, 0).multiply(p.m) };
        }));
        P.push(part(g.box, kit.mat(0xb7a98f), 0, 0.05, 0, 26, 0.1, 4));
        break;
      case "bigcastle":
        P.push(part(g.box, kit.mat(COL.water, { roughness: 0.15 }), 0, 0.05, 0, 34, 0.1, 30));
        P.push(part(g.box, kit.mat(COL.grassMound), 0, 0.15, 0, 28, 0.2, 24));
        P = P.concat(keepParts(kit, 0, 0, 5, 1.05));
        break;
      case "road":
        P.push(part(g.box, kit.mat(0xb7a98f), 0, 0.06, 0, 4, 0.12, 30));
        for (var li = 0; li < 6; li++) {
          var lz = -12 + li * 5;
          P.push(part(g.box, kit.mat(COL.stone), 3, 0.7, lz, 0.5, 1.4, 0.5));
          P.push(part(g.box, kit.mat(0xffd27a, { emissive: 0xffa040, emissiveIntensity: 0.5 }), 3, 1.6, lz, 0.6, 0.5, 0.6));
        }
        P = P.concat(toriiParts(kit, 0, 14, 1.0, 0));
        break;
      default:
        P = P.concat(hallParts(kit, { w: 8, d: 6, h: 3, baseH: 0.6, roof: "hip", roofH: 2.6 }));
    }
    return P;
  }

  // 時代建築的大致半徑（挑選擺放位置用）
  var LANDMARK_RADIUS = { kangou: 10, takayuka: 8, kofun: 17, forge: 8, pagoda: 13, granary: 10, daibutsuden: 14, gate: 13, phoenix: 14, yakata: 12, shrine: 15, bakufu: 17, castle: 9, market: 13, bigcastle: 17, road: 15 };

  // ---------------- 人物 ----------------

  var JOB_COLOR = { food: 0xc0763a, wood: 0x5e7d3a, stone: 0x8d8a82, gold: 0xd4ac0d };
  var CLASS_COLOR = { spear: 0x2e5e9e, infantry: 0x8e2b2b, archer: 0x3c7a3a, cavalry: 0x6b3fa0, siege: 0x6b5a3a, unique: 0xd4a017 };
  var CARRY_COLOR = { food: 0xb5482f, wood: 0x7a5230, stone: 0xa09d95, gold: 0xf1c40f };

  // ---------------- 場景 ----------------

  function Scene(container) {
    this.container = container;
    this.kit = new Kit();
    this.view = null;
    this.age = -1;
    this.disposed = false;
    this.cam = { theta: -0.75, phi: 0.95, dist: 120, tx: 0, tz: 6, userAt: 0 };
    this.camGoal = null;
    this.autoRotate = false;
    this.agents = [];
    this.marchers = [];
    this.lastFrame = 0;
    this.clock = 0;
    this.gameSpeed = 1;
    this.init();
  }

  Scene.prototype.init = function () {
    var self = this;
    var w = this.container.clientWidth || 800;
    var h = this.container.clientHeight || 500;
    var renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.setSize(w, h);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer = renderer;
    renderer.domElement.className = "jm-canvas";
    this.container.appendChild(renderer.domElement);

    var scene = new THREE.Scene();
    this.scene = scene;
    scene.fog = new THREE.Fog(0xa9d4ec, 220, 520);

    var camera = new THREE.PerspectiveCamera(42, w / h, 0.5, 1500);
    this.camera = camera;

    // 光
    this.hemi = new THREE.HemisphereLight(0xdcefff, 0x5a6b3a, 0.55);
    scene.add(this.hemi);
    this.ambient = new THREE.AmbientLight(0xffffff, 0.18);
    scene.add(this.ambient);
    var sun = new THREE.DirectionalLight(0xfff1d6, 1.05);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    var sc = sun.shadow.camera;
    sc.left = -120;
    sc.right = 120;
    sc.top = 120;
    sc.bottom = -120;
    sc.near = 10;
    sc.far = 500;
    sun.shadow.bias = -0.0008;
    sun.shadow.normalBias = 0.4;
    scene.add(sun);
    scene.add(sun.target);
    this.sun = sun;
    this.fireLight = new THREE.PointLight(0xff9a40, 0, 60, 2);
    this.fireLight.position.set(0, 3, 9);
    scene.add(this.fireLight);

    this.buildSky();
    this.buildTerrain();
    this.buildWater();
    this.buildSlots();
    this.buildTrees();
    this.buildRocks();
    this.buildPeople();
    this.buildSmoke();

    this.dynamic = new THREE.Group();
    scene.add(this.dynamic);

    this.bindControls();
    this.onResize = function () {
      self.resize();
    };
    window.addEventListener("resize", this.onResize);
    if (window.ResizeObserver) {
      this.ro = new ResizeObserver(this.onResize);
      this.ro.observe(this.container);
    }
    this.loop = function (ts) {
      if (self.disposed) return;
      self.raf = requestAnimationFrame(self.loop);
      self.frame(ts);
    };
    this.raf = requestAnimationFrame(this.loop);
  };

  Scene.prototype.resize = function () {
    var w = this.container.clientWidth || 800;
    var h = this.container.clientHeight || 500;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };

  Scene.prototype.buildSky = function () {
    var geo = new THREE.SphereGeometry(900, 24, 12);
    var colors = new Float32Array(geo.attributes.position.count * 3);
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    var mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false });
    this.sky = new THREE.Mesh(geo, mat);
    this.scene.add(this.sky);
    this.skyTop = new THREE.Color();
    this.skyHorizon = new THREE.Color();
  };

  Scene.prototype.paintSky = function (top, horizon) {
    var geo = this.sky.geometry;
    var pos = geo.attributes.position;
    var col = geo.attributes.color;
    var c = new THREE.Color();
    for (var i = 0; i < pos.count; i++) {
      var y = pos.getY(i) / 900;
      c.copy(horizon).lerp(top, clamp(y * 1.6, 0, 1));
      if (y < 0) c.copy(horizon);
      col.setXYZ(i, c.r, c.g, c.b);
    }
    col.needsUpdate = true;
  };

  Scene.prototype.buildTerrain = function () {
    var seg = 150;
    var geo = new THREE.PlaneGeometry(MAP, MAP, seg, seg);
    geo.rotateX(-Math.PI / 2);
    var pos = geo.attributes.position;
    var colors = new Float32Array(pos.count * 3);
    var c = new THREE.Color();
    var grassA = new THREE.Color(0x6f9f45);
    var grassB = new THREE.Color(0x5a8a38);
    var dirt = new THREE.Color(0xa48a62);
    var sand = new THREE.Color(0xd8c79a);
    var rock = new THREE.Color(0x8a8577);
    var moss = new THREE.Color(0x6d7f4a);
    var riverbed = new THREE.Color(0x8f8263);
    for (var i = 0; i < pos.count; i++) {
      var x = pos.getX(i);
      var z = pos.getZ(i);
      var y = height(x, z);
      pos.setY(i, y);
      var r = Math.sqrt(x * x + z * z);
      var n = 0.5 + 0.5 * noise(x * 0.09, z * 0.09);
      c.copy(grassA).lerp(grassB, n);
      if (y > 7) c.lerp(moss, smooth(7, 14, y));
      if (y > 14) c.lerp(rock, smooth(14, 24, y));
      if (r < 20) c.lerp(dirt, (1 - smooth(10, 20, r)) * 0.8);
      if (y < 0.5) c.lerp(sand, smooth(0.5, -0.3, y));
      if (y < -0.8) c.copy(riverbed);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    var mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, flatShading: true });
    var mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.terrain = mesh;
    // 村子的道路（往四方延伸）
    this.roads = new THREE.Group();
    this.scene.add(this.roads);
  };

  Scene.prototype.buildWater = function () {
    var geo = new THREE.PlaneGeometry(MAP + 400, MAP + 400, 80, 80);
    geo.rotateX(-Math.PI / 2);
    this.waterBase = Float32Array.from(geo.attributes.position.array);
    var mat = new THREE.MeshStandardMaterial({ color: 0x3f86b8, roughness: 0.25, metalness: 0.15, transparent: true, opacity: 0.86, flatShading: true });
    var water = new THREE.Mesh(geo, mat);
    water.position.y = WATER_Y;
    water.receiveShadow = true;
    this.scene.add(water);
    this.water = water;
  };

  // 建築位置（固定亂數種子，村子由內往外長）
  Scene.prototype.buildSlots = function () {
    var rng = makeRng(20261103);
    var taken = [];
    function free(x, z, rad) {
      for (var i = 0; i < taken.length; i++) {
        var t = taken[i];
        var dx = t[0] - x;
        var dz = t[1] - z;
        if (dx * dx + dz * dz < (t[2] + rad) * (t[2] + rad)) return false;
      }
      return true;
    }
    function ok(x, z, rad) {
      if (Math.abs(x - riverX(z)) < 12 + rad) return false;
      if (x > 120) return false;
      var y = height(x, z);
      if (y < 0.6 || y > 7) return false;
      if (slopeAt(x, z) > 1.6) return false;
      return free(x, z, rad);
    }
    function reserve(x, z, rad) {
      taken.push([x, z, rad]);
    }
    // 主村落中心與廣場
    reserve(0, 2, 16);
    // 士兵列隊的練兵場（村落中心東南側）
    this.parade = [8, -10];
    reserve(18, -19, 12);
    // 時代建築的位置（避開東側的水田區）
    this.landmarkSpots = [
      [-30, 14, 13],
      [-6, -32, 12],
      [-34, -22, 13],
      [6, 36, 12],
      [-58, 4, 22],
      [-22, 46, 15],
      [-46, -48, 16],
      [-62, 40, 18],
    ];
    var self = this;
    this.landmarkSpots.forEach(function (s) {
      reserve(s[0], s[1], s[2]);
    });
    // 額外的村落中心
    var tcSpots = [];
    var tcCands = [
      [32, -40],
      [-20, 28],
      [-44, -8],
      [16, 58],
      [-12, -62],
      [-70, -24],
      [-40, 66],
      [36, 74],
      [-80, 14],
      [-30, -80],
      [-88, -50],
      [12, -90],
    ];
    tcCands.forEach(function (p) {
      if (ok(p[0], p[1], 9)) {
        tcSpots.push([p[0], p[1]]);
        reserve(p[0], p[1], 9);
      }
    });
    this.tcSpots = tcSpots;
    // 水田：河的西岸，棋盤格
    var paddies = [];
    for (var pz = -66; pz <= 90; pz += 6.4) {
      for (var px = 22; px < 110; px += 7.4) {
        if (px > riverX(pz) - 13) continue;
        var py = height(px, pz);
        if (py < 0.4 || py > 5 || !free(px, pz, 3.8)) continue;
        paddies.push([px, pz, Math.abs(px - 22) + Math.abs(pz - 10) * 0.8]);
      }
    }
    // 也可以在河的東岸（海邊之前）
    for (var qz = -60; qz <= 80; qz += 6.4) {
      for (var qx = riverX(qz) + 13; qx < 118; qx += 7.4) {
        var qy = height(qx, qz);
        if (qy < 0.4 || qy > 5 || !free(qx, qz, 3.8)) continue;
        paddies.push([qx, qz, 200 + Math.abs(qz)]);
      }
    }
    paddies.sort(function (a, b) {
      return a[2] - b[2];
    });
    paddies.forEach(function (p) {
      reserve(p[0], p[1], 3.6);
    });
    // 水田一律朝同一方向排列（第三欄原本是排序用的距離，換成旋轉角 0）
    this.paddySlots = paddies.map(function (p) {
      return [p[0], p[1], -Math.PI / 2];
    });
    // 集散地
    function cluster(cx, cz, n, rad, spread) {
      var out = [];
      var tries = 0;
      while (out.length < n && tries < 4000) {
        tries++;
        var a = rng() * Math.PI * 2;
        var r = Math.sqrt(rng()) * spread;
        var x = cx + Math.cos(a) * r;
        var z = cz + Math.sin(a) * r;
        if (!ok(x, z, rad)) continue;
        out.push([x, z, Math.atan2(-z, -x)]);
        reserve(x, z, rad);
      }
      out.sort(function (a2, b2) {
        return (a2[0] - cx) * (a2[0] - cx) + (a2[1] - cz) * (a2[1] - cz) - ((b2[0] - cx) * (b2[0] - cx) + (b2[1] - cz) * (b2[1] - cz));
      });
      return out;
    }
    this.campSlots = {
      foodcamp: cluster(18, 8, 10, 3.2, 30),
      woodcamp: cluster(-48, 0, 10, 3.2, 34),
      minecamp: cluster(18, -58, 10, 3.2, 36),
    };
    this.milSlots = {
      barracks: cluster(-14, 52, 8, 5, 26),
      archery: cluster(14, 46, 8, 5, 26),
      stable: cluster(-36, 34, 8, 5.5, 24),
      workshop: cluster(-50, -36, 6, 5, 22),
    };
    this.marketSlot = cluster(12, 22, 1, 7, 14)[0] || [14, 22, 0];
    // 住居：環狀由內往外
    var houses = [];
    var tries = 0;
    while (houses.length < 320 && tries < 30000) {
      tries++;
      var ring = 16 + Math.pow(rng(), 0.8) * 92;
      var ang = rng() * Math.PI * 2;
      var hx = Math.cos(ang) * ring;
      var hz = Math.sin(ang) * ring * 0.95;
      if (!ok(hx, hz, 3.1)) continue;
      houses.push([hx, hz, Math.atan2(-hz, -hx) + (rng() - 0.5) * 0.6, 0.85 + rng() * 0.3, ring]);
      reserve(hx, hz, 3.1);
    }
    houses.sort(function (a, b) {
      return a[4] - b[4];
    });
    this.houseSlots = houses;
    this.slotRng = rng;
  };

  Scene.prototype.buildTrees = function () {
    var kit = this.kit;
    var g = G(kit);
    var rng = makeRng(777);
    var trees = [];
    var tries = 0;
    while (trees.length < 1400 && tries < 20000) {
      tries++;
      var x = (rng() - 0.5) * (MAP - 20);
      var z = (rng() - 0.5) * (MAP - 20);
      var r = Math.sqrt(x * x + z * z);
      if (r < 24) continue;
      var y = height(x, z);
      if (y < 0.4 || y > 30) continue;
      if (Math.abs(x - riverX(z)) < 12) continue;
      // 森林密度：西邊與山邊多，村子附近少
      var dens = 0.08 + smooth(-20, -70, x) * 0.7 + smooth(90, 150, r) * 0.6;
      if (rng() > dens) continue;
      trees.push({ x: x, z: z, y: y, s: 0.8 + rng() * 0.7, kind: rng() < 0.55 ? 0 : 1, rot: rng() * 6.28 });
    }
    // 樹與建築位置的衝突：住居或水田蓋起來後，那裡的樹會被砍掉
    var self = this;
    trees.forEach(function (t) {
      t.block = [];
      self.houseSlots.forEach(function (s, i) {
        var dx = s[0] - t.x;
        var dz = s[1] - t.z;
        if (dx * dx + dz * dz < 26) t.block.push(["house", i]);
      });
      self.paddySlots.forEach(function (s, i) {
        var dx = s[0] - t.x;
        var dz = s[1] - t.z;
        if (dx * dx + dz * dz < 30) t.block.push(["paddy", i]);
      });
      ["foodcamp", "woodcamp", "minecamp"].forEach(function (k) {
        self.campSlots[k].forEach(function (s, i) {
          var dx = s[0] - t.x;
          var dz = s[1] - t.z;
          if (dx * dx + dz * dz < 22) t.block.push([k, i]);
        });
      });
      ["barracks", "archery", "stable", "workshop"].forEach(function (k) {
        self.milSlots[k].forEach(function (s, i) {
          var dx = s[0] - t.x;
          var dz = s[1] - t.z;
          if (dx * dx + dz * dz < 50) t.block.push([k, i]);
        });
      });
      self.tcSpots.forEach(function (s, i) {
        var dx = s[0] - t.x;
        var dz = s[1] - t.z;
        if (dx * dx + dz * dz < 150) t.block.push(["tc", i + 1]);
      });
      self.landmarkSpots.forEach(function (s, i) {
        var dx = s[0] - t.x;
        var dz = s[1] - t.z;
        if (dx * dx + dz * dz < (s[2] + 2) * (s[2] + 2)) t.block.push(["lm" + i, 0]);
      });
    });
    this.trees = trees;
    var n = trees.length;
    this.treeMeshes = [
      new THREE.InstancedMesh(g.cyl6, kit.mat(COL.trunk), n),
      new THREE.InstancedMesh(g.cone8, kit.mat(COL.leafDark), n),
      new THREE.InstancedMesh(g.cone8, kit.mat(COL.leaf), n),
      new THREE.InstancedMesh(g.ico1, kit.mat(COL.leaf2), n),
    ];
    var self2 = this;
    this.treeMeshes.forEach(function (m) {
      m.castShadow = true;
      m.receiveShadow = true;
      self2.scene.add(m);
    });
    this.treeVisibleKey = "";
    this.updateTrees({});
  };

  Scene.prototype.updateTrees = function (shown) {
    var key = JSON.stringify(shown);
    if (key === this.treeVisibleKey) return;
    this.treeVisibleKey = key;
    var mtx = new THREE.Matrix4();
    var q = new THREE.Quaternion();
    var v = new THREE.Vector3();
    var sc = new THREE.Vector3();
    var counts = [0, 0, 0, 0];
    var meshes = this.treeMeshes;
    this.trees.forEach(function (t) {
      var hidden = t.block.some(function (b) {
        return (shown[b[0]] || 0) > b[1];
      });
      if (hidden) return;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.rot);
      // 樹幹
      v.set(t.x, t.y + 1.0 * t.s, t.z);
      sc.set(0.5 * t.s, 2.0 * t.s, 0.5 * t.s);
      mtx.compose(v, q, sc);
      meshes[0].setMatrixAt(counts[0]++, mtx);
      if (t.kind === 0) {
        // 杉：兩層圓錐
        v.set(t.x, t.y + 3.2 * t.s, t.z);
        sc.set(3.4 * t.s, 3.6 * t.s, 3.4 * t.s);
        mtx.compose(v, q, sc);
        meshes[1].setMatrixAt(counts[1]++, mtx);
        v.set(t.x, t.y + 5.2 * t.s, t.z);
        sc.set(2.4 * t.s, 3.0 * t.s, 2.4 * t.s);
        mtx.compose(v, q, sc);
        meshes[2].setMatrixAt(counts[2]++, mtx);
      } else {
        // 廣葉樹：多面球
        v.set(t.x, t.y + 3.4 * t.s, t.z);
        sc.set(4.0 * t.s, 3.6 * t.s, 4.0 * t.s);
        mtx.compose(v, q, sc);
        meshes[3].setMatrixAt(counts[3]++, mtx);
      }
    });
    meshes.forEach(function (m, i) {
      m.count = counts[i];
      m.instanceMatrix.needsUpdate = true;
    });
  };

  Scene.prototype.buildRocks = function () {
    var kit = this.kit;
    var g = G(kit);
    var rng = makeRng(99);
    var group = new THREE.Group();
    function pile(cx, cz, n, color, spread, metal) {
      for (var i = 0; i < n; i++) {
        var a = rng() * 6.28;
        var r = rng() * spread;
        var x = cx + Math.cos(a) * r;
        var z = cz + Math.sin(a) * r;
        var s = 1 + rng() * 2.4;
        var mesh = new THREE.Mesh(g.dodeca, kit.mat(color, metal ? { metalness: 0.35, roughness: 0.45 } : null));
        mesh.position.set(x, height(x, z) + s * 0.25, z);
        mesh.scale.set(s, s * 0.8, s);
        mesh.rotation.set(rng(), rng() * 6, rng());
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        group.add(mesh);
      }
    }
    pile(42, -84, 26, COL.stone, 12);
    pile(42, -84, 10, COL.stoneDark, 9);
    this.goldGroup = new THREE.Group();
    group.add(this.goldGroup);
    var gr = makeRng(5);
    for (var i = 0; i < 14; i++) {
      var a = gr() * 6.28;
      var r = gr() * 9;
      var x = -48 + Math.cos(a) * r;
      var z = -100 + Math.sin(a) * r;
      var s = 1 + gr() * 1.8;
      var mesh = new THREE.Mesh(g.dodeca, kit.mat(i % 3 === 0 ? 0xe2b93b : COL.stoneDark, i % 3 === 0 ? { metalness: 0.5, roughness: 0.35 } : null));
      mesh.position.set(x, height(x, z) + s * 0.25, z);
      mesh.scale.set(s, s * 0.8, s);
      mesh.rotation.set(gr(), gr() * 6, gr());
      mesh.castShadow = true;
      this.goldGroup.add(mesh);
    }
    // 漿果樹叢（繩文的採集）
    var berry = new THREE.Group();
    for (var b = 0; b < 26; b++) {
      var ba = rng() * 6.28;
      var br = 26 + rng() * 22;
      var bx = 24 + Math.cos(ba) * br * 0.6;
      var bz = 10 + Math.sin(ba) * br;
      if (Math.abs(bx - riverX(bz)) < 12 || height(bx, bz) < 0.3) continue;
      var bush = new THREE.Mesh(g.ico, kit.mat(0x3e6e2e));
      bush.position.set(bx, height(bx, bz) + 0.6, bz);
      bush.scale.set(2, 1.4, 2);
      bush.castShadow = true;
      berry.add(bush);
      var fruit = new THREE.Mesh(g.sphere, kit.mat(0xb03a48));
      fruit.position.set(bx + 0.5, height(bx, bz) + 1.2, bz + 0.4);
      fruit.scale.set(0.5, 0.5, 0.5);
      berry.add(fruit);
    }
    group.add(berry);
    this.scene.add(group);
  };

  Scene.prototype.buildPeople = function () {
    var kit = this.kit;
    var g = G(kit);
    var MAXP = 140;
    this.peopleMax = MAXP;
    var bodyMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true });
    this.vBody = new THREE.InstancedMesh(g.cyl6, bodyMat, MAXP);
    this.vHead = new THREE.InstancedMesh(g.sphere, kit.mat(COL.skin), MAXP);
    this.vCarry = new THREE.InstancedMesh(g.box, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, flatShading: true }), MAXP);
    var MAXS = 260;
    this.soldierMax = MAXS;
    this.sBody = new THREE.InstancedMesh(g.cyl6, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, flatShading: true }), MAXS);
    this.sHead = new THREE.InstancedMesh(g.sphere, kit.mat(COL.skin), MAXS);
    this.sWeapon = new THREE.InstancedMesh(g.box, kit.mat(0x5a4a3a), MAXS);
    this.sHorse = new THREE.InstancedMesh(g.box, kit.mat(0x6b4a2e), MAXS);
    var self = this;
    // instanceColor 要在第一次繪製前就建立，否則著色器編譯時沒有 instance color，顏色會全白
    var white = new THREE.Color(0xffffff);
    [this.vBody, this.vCarry, this.sBody].forEach(function (m) {
      for (var i = 0; i < m.instanceMatrix.count; i++) m.setColorAt(i, white);
    });
    [this.vBody, this.vHead, this.vCarry, this.sBody, this.sHead, this.sWeapon, this.sHorse].forEach(function (m) {
      m.castShadow = true;
      m.count = 0;
      m.frustumCulled = false;
      self.scene.add(m);
    });
    // 旗幟（部隊的領頭）
    this.bannerMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, side: THREE.DoubleSide });
    this.banners = new THREE.InstancedMesh(g.box, this.bannerMat, 12);
    for (var bi = 0; bi < 12; bi++) this.banners.setColorAt(bi, white);
    this.banners.count = 0;
    this.banners.frustumCulled = false;
    this.scene.add(this.banners);
  };

  Scene.prototype.buildSmoke = function () {
    var cv = document.createElement("canvas");
    cv.width = cv.height = 64;
    var ctx = cv.getContext("2d");
    var grd = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
    grd.addColorStop(0, "rgba(255,255,255,0.9)");
    grd.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, 64, 64);
    var tex = new THREE.CanvasTexture(cv);
    var N = 90;
    var geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    var mat = new THREE.PointsMaterial({ size: 3.2, map: tex, transparent: true, opacity: 0.4, depthWrite: false, color: 0xdddddd });
    this.smoke = new THREE.Points(geo, mat);
    this.smoke.frustumCulled = false;
    this.scene.add(this.smoke);
    this.smokeP = [];
    for (var i = 0; i < N; i++) this.smokeP.push({ src: -1, x: 0, y: -100, z: 0, life: Math.random() * 6, vx: 0 });
    this.smokeSources = [];
  };

  // ---------------- 依 view 重建 ----------------

  Scene.prototype.instSet = function (key, parts, max) {
    // 依部件建立（或重用）InstancedMesh 組
    if (!this.sets) this.sets = {};
    var old = this.sets[key];
    if (old && old.parts === parts) return old;
    if (old) {
      old.meshes.forEach(function (m) {
        m.parent.remove(m);
        m.dispose();
      });
    }
    var self = this;
    var set = {
      parts: parts,
      max: max,
      meshes: parts.map(function (p) {
        var m = new THREE.InstancedMesh(p.geo, p.mat, max);
        m.castShadow = true;
        m.receiveShadow = true;
        m.count = 0;
        self.scene.add(m);
        return m;
      }),
      key: "",
    };
    this.sets[key] = set;
    return set;
  };

  Scene.prototype.placeSet = function (set, slots, n, sigKey) {
    n = Math.min(n, slots.length, set.max);
    var sig = n + "|" + sigKey;
    if (set.key === sig) return n;
    set.key = sig;
    var mtx = new THREE.Matrix4();
    var base = new THREE.Matrix4();
    var q = new THREE.Quaternion();
    var up = new THREE.Vector3(0, 1, 0);
    var v = new THREE.Vector3();
    var sc = new THREE.Vector3();
    for (var i = 0; i < n; i++) {
      var s = slots[i];
      q.setFromAxisAngle(up, (s[2] || 0) + Math.PI / 2);
      var k = s[3] || 1;
      v.set(s[0], height(s[0], s[1]) - 0.05, s[1]);
      sc.set(k, k, k);
      base.compose(v, q, sc);
      set.parts.forEach(function (p, j) {
        mtx.multiplyMatrices(base, p.m);
        set.meshes[j].setMatrixAt(i, mtx);
      });
    }
    set.meshes.forEach(function (m) {
      m.count = n;
      m.instanceMatrix.needsUpdate = true;
    });
    return n;
  };

  Scene.prototype.groupAt = function (parts, x, z, ry) {
    var grp = new THREE.Group();
    addParts(grp, parts);
    grp.position.set(x, height(x, z) - 0.05, z);
    grp.rotation.y = ry || 0;
    this.dynamic.add(grp);
    return grp;
  };

  Scene.prototype.rebuildStatic = function (v) {
    // 時代改變、時代建築或柵變化時，重建單體建築
    var self = this;
    var kit = this.kit;
    while (this.dynamic.children.length) {
      var c = this.dynamic.children.pop();
      c.traverse(function (o) {
        if (o.isInstancedMesh) o.dispose();
      });
    }
    // 主村落中心
    this.groupAt(townCenterParts(kit, v.age, true), 0, 0, 0);
    // 文明旗幟
    var pole = new THREE.Mesh(G(kit).cyl6, kit.mat(COL.woodDark));
    pole.scale.set(0.3, 12, 0.3);
    var flag = new THREE.Mesh(G(kit).box, new THREE.MeshStandardMaterial({ color: v.civColor || 0xc0392b, roughness: 0.7 }));
    flag.scale.set(3.2, 2, 0.1);
    var flagGroup = new THREE.Group();
    pole.position.set(0, 6, 0);
    flag.position.set(1.7, 10.8, 0);
    flagGroup.add(pole);
    flagGroup.add(flag);
    flagGroup.position.set(-7, height(-7, 9), 9);
    this.dynamic.add(flagGroup);
    this.flag = flag;
    // 時代建築：依模型大小挑位置（放得下的最小空位；都放不下就用最大的空位並縮小）
    var used = {};
    (v.landmarks || []).forEach(function (model) {
      var need = LANDMARK_RADIUS[model] || 10;
      var best = -1;
      self.landmarkSpots.forEach(function (sp, i) {
        if (used[i]) return;
        var fits = sp[2] >= need * 0.85;
        if (best < 0) {
          best = i;
          return;
        }
        var b = self.landmarkSpots[best];
        var bFits = b[2] >= need * 0.85;
        if (fits && (!bFits || sp[2] < b[2])) best = i;
        else if (!fits && !bFits && sp[2] > b[2]) best = i;
      });
      if (best < 0) return;
      used[best] = true;
      var spot = self.landmarkSpots[best];
      var k = Math.min(1, spot[2] / (need * 0.85));
      var grp = self.groupAt(landmarkParts(kit, model), spot[0], spot[1], Math.atan2(spot[0], spot[1]) + Math.PI);
      grp.scale.setScalar(k);
    });
    this.landmarkUsed = used;
    // 火堆光源位置
    this.smokeSources = [[0, v.age <= 1 ? 6 : 9, 9, 1.2]];
    this.buildWalls(v);
    this.staticKey = this.staticSig(v);
  };

  Scene.prototype.staticSig = function (v) {
    return [v.age, v.civColor, (v.landmarks || []).join(","), v.wallLevel, this.wallRadius(v)].join("|");
  };

  Scene.prototype.wallRadius = function (v) {
    var n = Math.min(v.houses, this.houseSlots.length);
    var r = 30;
    for (var i = 0; i < n; i++) r = Math.max(r, this.houseSlots[i][4] + 7);
    return Math.round(Math.min(r, 112) / 6) * 6;
  };

  Scene.prototype.buildWalls = function (v) {
    var lvl = v.wallLevel || 0;
    if (lvl <= 0) return;
    var kit = this.kit;
    var g = G(kit);
    var R = this.wallRadius(v);
    var group = new THREE.Group();
    var step = lvl >= 4 ? 3.0 : 1.4;
    var n = Math.floor((Math.PI * 2 * R) / step);
    var pts = [];
    for (var i = 0; i < n; i++) {
      var a = (i / n) * Math.PI * 2;
      // 四個門
      var gateGap = 0.05;
      var gate = [0, Math.PI / 2, Math.PI, Math.PI * 1.5].some(function (ga) {
        var d = Math.abs(((a - ga + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
        return d < gateGap;
      });
      if (gate) continue;
      var x = Math.cos(a) * R;
      var z = Math.sin(a) * R;
      var y = height(x, z);
      if (y < 0 || Math.abs(x - riverX(z)) < 8) continue;
      pts.push([x, y, z, a]);
    }
    var mtx = new THREE.Matrix4();
    var q = new THREE.Quaternion();
    var up = new THREE.Vector3(0, 1, 0);
    function inst(geo, mat, fn) {
      var m = new THREE.InstancedMesh(geo, mat, pts.length);
      pts.forEach(function (p, i) {
        fn(p, i);
        m.setMatrixAt(i, mtx);
      });
      m.castShadow = true;
      m.receiveShadow = true;
      group.add(m);
    }
    if (lvl <= 3) {
      inst(g.cyl6, kit.mat(COL.wood), function (p) {
        q.setFromAxisAngle(up, 0);
        mtx.compose(new THREE.Vector3(p[0], p[1] + 1.4, p[2]), q, new THREE.Vector3(0.45, 2.8 + (lvl >= 3 ? 0.6 : 0), 0.45));
      });
    }
    if (lvl >= 2 && lvl <= 3) {
      // 環濠：柵外側的水壕
      var ro = R + 3.2;
      var moat = new THREE.Mesh(new THREE.RingGeometry(ro - 1.5, ro + 1.5, 96), kit.mat(COL.water, { roughness: 0.15, side: THREE.DoubleSide }));
      moat.rotation.x = -Math.PI / 2;
      moat.position.y = 0.25;
      group.add(moat);
    }
    if (lvl === 3) {
      inst(g.box, kit.mat(COL.earth), function (p) {
        q.setFromAxisAngle(up, -p[3]);
        mtx.compose(new THREE.Vector3(p[0] * 0.97, p[1] + 0.4, p[2] * 0.97), q, new THREE.Vector3(1.8, 0.9, 1.8));
      });
    }
    if (lvl === 4) {
      inst(g.box, kit.mat(COL.plaster), function (p) {
        q.setFromAxisAngle(up, -p[3]);
        mtx.compose(new THREE.Vector3(p[0], p[1] + 1.2, p[2]), q, new THREE.Vector3(1.0, 2.4, 3.3));
      });
      inst(g.prism, kit.mat(COL.tile), function (p) {
        q.setFromAxisAngle(up, -p[3] + Math.PI / 2);
        mtx.compose(new THREE.Vector3(p[0], p[1] + 2.4, p[2]), q, new THREE.Vector3(3.4, 0.6, 1.6));
      });
    }
    if (lvl >= 5) {
      inst(g.box, kit.mat(COL.stoneDark), function (p) {
        q.setFromAxisAngle(up, -p[3]);
        mtx.compose(new THREE.Vector3(p[0], p[1] + 1.8, p[2]), q, new THREE.Vector3(2.4, 3.6 + (lvl >= 6 ? 1.2 : 0), 3.3));
      });
      inst(g.box, kit.mat(COL.plaster), function (p) {
        q.setFromAxisAngle(up, -p[3]);
        mtx.compose(new THREE.Vector3(p[0], p[1] + 4.2 + (lvl >= 6 ? 1.2 : 0), p[2]), q, new THREE.Vector3(0.8, 1.2, 3.3));
      });
    }
    this.dynamic.add(group);
    this.towerRing = R;
  };

  Scene.prototype.update = function (v) {
    if (this.disposed) return;
    var kit = this.kit;
    this.view = v;
    this.gameSpeed = v.paused ? 0 : v.speed || 1;
    var ageChanged = v.age !== this.age;
    if (ageChanged) {
      this.age = v.age;
      this.styles = {
        house: houseStyle(kit, v.age),
        food: shedStyle(kit, "food"),
        wood: shedStyle(kit, "wood"),
        mine: shedStyle(kit, "mine"),
        paddy: paddyStyle(kit),
        barracks: barracksStyle(kit, "barracks", v.age),
        archery: barracksStyle(kit, "archery", v.age),
        stable: barracksStyle(kit, "stable", v.age),
        workshop: barracksStyle(kit, "workshop", v.age),
        tower: towerStyle(kit, v.age),
        market: marketStyle(kit),
        tc: townCenterParts(kit, v.age, false),
      };
      this.goldGroup.visible = v.age >= 2;
      this.lightStyle = houseLightOffset(v.age);
    }
    if (ageChanged || this.staticSig(v) !== this.staticKey) this.rebuildStatic(v);

    var st = this.styles;
    var b = v.buildings;
    var shown = {};
    shown.house = this.placeSet(this.instSet("house", st.house, 320), this.houseSlots, this.visibleHouses(b.house), "h");
    shown.paddy = this.placeSet(this.instSet("paddy", st.paddy, 120), this.paddySlots, b.paddy, "p");
    shown.foodcamp = this.placeSet(this.instSet("food", st.food, 10), this.campSlots.foodcamp, b.foodcamp, "f");
    shown.woodcamp = this.placeSet(this.instSet("wood", st.wood, 10), this.campSlots.woodcamp, b.woodcamp, "w");
    shown.minecamp = this.placeSet(this.instSet("mine", st.mine, 10), this.campSlots.minecamp, b.minecamp, "m");
    shown.barracks = this.placeSet(this.instSet("barracks", st.barracks, 8), this.milSlots.barracks, b.barracks, "b");
    shown.archery = this.placeSet(this.instSet("archery", st.archery, 8), this.milSlots.archery, b.archery, "a");
    shown.stable = this.placeSet(this.instSet("stable", st.stable, 8), this.milSlots.stable, b.stable, "s");
    shown.workshop = this.placeSet(this.instSet("workshop", st.workshop, 6), this.milSlots.workshop, b.workshop, "k");
    this.placeSet(this.instSet("market", st.market, 1), [this.marketSlot], b.market > 0 ? 1 : 0, "mk");
    shown.tc = 1 + this.placeSet(this.instSet("tc", st.tc, 12), this.tcSpots, Math.max(0, b.tc - 1), "tc");
    Object.keys(this.landmarkUsed || {}).forEach(function (i) {
      shown["lm" + i] = 1;
    });
    // 望樓：沿著柵的圓周
    var R = this.towerRing || this.wallRadius(v);
    var towerSlots = [];
    var nt = Math.min(b.tower, 24);
    for (var i = 0; i < nt; i++) {
      var a = (i / Math.max(nt, 1)) * Math.PI * 2 + 0.3;
      var tx = Math.cos(a) * (R - 2.5);
      var tz = Math.sin(a) * (R - 2.5);
      if (Math.abs(tx - riverX(tz)) < 9) tx -= 12;
      towerSlots.push([tx, tz, a]);
    }
    this.placeSet(this.instSet("tower", st.tower, 24), towerSlots, nt, "t" + R);
    this.updateTrees(shown);
    this.updateHouseLights(shown.house);
    this.shown = shown;
    // 炊煙來源：村落中心＋部分住居
    var srcs = [[0, v.age <= 1 ? 6.5 : 9, 9, 1.4]];
    for (var h = 0; h < shown.house; h += 9) {
      var hs = this.houseSlots[h];
      srcs.push([hs[0], height(hs[0], hs[1]) + (v.age <= 1 ? 4.2 : 4), hs[1], 0.6]);
    }
    this.smokeSources = srcs.slice(0, 16);
    this.syncAgents(v);
    // 鏡頭建議距離：隨村子變大拉遠
    this.suggestDist = clamp(30 + this.wallRadius(v) * 1.5, 70, 260);
    if (!this.camInit) {
      this.camInit = true;
      this.cam.dist = this.suggestDist;
    }
  };

  // 住居數很大時只畫一部分（每棟代表多戶），最多 320 棟
  Scene.prototype.visibleHouses = function (n) {
    if (n <= 160) return n;
    return Math.min(320, Math.round(160 + Math.sqrt(n - 160) * 6));
  };

  Scene.prototype.updateHouseLights = function (n) {
    if (!this.houseLights) {
      var g = G(this.kit);
      this.lightMat = new THREE.MeshStandardMaterial({ color: 0x332211, emissive: 0xffb347, emissiveIntensity: 0, roughness: 1 });
      this.houseLights = new THREE.InstancedMesh(g.box, this.lightMat, 320);
      this.houseLights.count = 0;
      this.scene.add(this.houseLights);
    }
    var key = n + "|" + this.age;
    if (this.houseLightKey === key) return;
    this.houseLightKey = key;
    var mtx = new THREE.Matrix4();
    var base = new THREE.Matrix4();
    var q = new THREE.Quaternion();
    var up = new THREE.Vector3(0, 1, 0);
    var off = this.lightStyle || [0, 1, 2];
    for (var i = 0; i < n; i++) {
      var s = this.houseSlots[i];
      q.setFromAxisAngle(up, s[2] + Math.PI / 2);
      base.compose(new THREE.Vector3(s[0], height(s[0], s[1]), s[1]), q, new THREE.Vector3(s[3], s[3], s[3]));
      mtx.multiplyMatrices(base, new THREE.Matrix4().compose(new THREE.Vector3(off[0], off[1], off[2] + 0.06), new THREE.Quaternion(), new THREE.Vector3(0.7, 0.7, 0.08)));
      this.houseLights.setMatrixAt(i, mtx);
    }
    this.houseLights.count = n;
    this.houseLights.instanceMatrix.needsUpdate = true;
  };

  // ---------------- 村民與士兵 ----------------

  Scene.prototype.jobPoint = function (job, rng) {
    var a;
    var r;
    if (job === "food") {
      var sp = this.shown && this.shown.paddy;
      if (sp > 0 && rng() < 0.7) {
        var p = this.paddySlots[Math.floor(rng() * sp)];
        return [p[0] + (rng() - 0.5) * 5, p[1] + (rng() - 0.5) * 4];
      }
      a = rng() * 6.28;
      r = 26 + rng() * 20;
      return [24 + Math.cos(a) * r * 0.6, 10 + Math.sin(a) * r];
    }
    if (job === "wood") {
      var z = (rng() - 0.5) * 90;
      return [-62 - rng() * 14, z];
    }
    if (job === "stone") {
      a = rng() * 6.28;
      return [42 + Math.cos(a) * 9, -84 + Math.sin(a) * 9];
    }
    a = rng() * 6.28;
    return [-48 + Math.cos(a) * 8, -100 + Math.sin(a) * 8];
  };

  Scene.prototype.dropPoint = function (job, x, z) {
    var key = job === "food" ? "foodcamp" : job === "wood" ? "woodcamp" : "minecamp";
    var best = [0, 6];
    var bd = x * x + (z - 6) * (z - 6);
    var n = (this.shown && this.shown[key]) || 0;
    for (var i = 0; i < n; i++) {
      var s = this.campSlots[key][i];
      var d = (s[0] - x) * (s[0] - x) + (s[1] - z) * (s[1] - z);
      if (d < bd) {
        bd = d;
        best = [s[0], s[1]];
      }
    }
    return best;
  };

  Scene.prototype.syncAgents = function (v) {
    // 顯示人數：村民越多畫越多（上限 140）
    var total = Math.min(this.peopleMax, Math.max(v.villagers > 0 ? 3 : 0, Math.round(Math.sqrt(v.villagers) * 5)));
    var w = v.workers || {};
    var sum = (w.food || 0) + (w.wood || 0) + (w.stone || 0) + (w.gold || 0);
    var want = { food: 0, wood: 0, stone: 0, gold: 0 };
    if (sum > 0) {
      Object.keys(want).forEach(function (k) {
        want[k] = Math.round((total * (w[k] || 0)) / sum);
      });
    }
    var have = { food: 0, wood: 0, stone: 0, gold: 0 };
    var rng = this.slotRng;
    var keep = [];
    this.agents.forEach(function (a) {
      if (have[a.job] < want[a.job]) {
        have[a.job]++;
        keep.push(a);
      }
    });
    var self = this;
    Object.keys(want).forEach(function (job) {
      while (have[job] < want[job]) {
        have[job]++;
        var wp = self.jobPoint(job, rng);
        var dp = self.dropPoint(job, wp[0], wp[1]);
        keep.push({ job: job, work: wp, drop: dp, phase: rng() * 4, x: dp[0], z: dp[1], seed: rng() * 10 });
      }
    });
    this.agents = keep;
    // 每次更新時，讓部分村民換到最近的集散地
    this.agents.forEach(function (a) {
      if (rng() < 0.05) a.drop = self.dropPoint(a.job, a.work[0], a.work[1]);
    });
  };

  Scene.prototype.animatePeople = function (dt, t) {
    var mtx = new THREE.Matrix4();
    var q = new THREE.Quaternion();
    var up = new THREE.Vector3(0, 1, 0);
    var v3 = new THREE.Vector3();
    var sc = new THREE.Vector3();
    var col = new THREE.Color();
    var speed = 5.5;
    var nc = 0;
    var i;
    var spd = Math.min(this.gameSpeed, 4);
    for (i = 0; i < this.agents.length; i++) {
      var a = this.agents[i];
      var dx = a.work[0] - a.drop[0];
      var dz = a.work[1] - a.drop[1];
      var len = Math.sqrt(dx * dx + dz * dz) || 1;
      var walk = len / speed;
      var cycle = walk * 2 + 4;
      a.phase = (a.phase + dt * spd) % cycle;
      var p = a.phase;
      var x;
      var z;
      var carrying = false;
      var moving = true;
      var dir = 1;
      if (p < walk) {
        var k = p / walk;
        x = a.drop[0] + dx * k;
        z = a.drop[1] + dz * k;
      } else if (p < walk + 3) {
        x = a.work[0];
        z = a.work[1];
        moving = false;
      } else if (p < walk * 2 + 3) {
        var k2 = (p - walk - 3) / walk;
        x = a.work[0] - dx * k2;
        z = a.work[1] - dz * k2;
        carrying = true;
        dir = -1;
      } else {
        x = a.drop[0];
        z = a.drop[1];
        moving = false;
      }
      var y = Math.max(height(x, z), WATER_Y + 0.1);
      var bob = moving ? Math.abs(Math.sin(t * 9 + a.seed)) * 0.18 : Math.abs(Math.sin(t * 4 + a.seed)) * 0.08;
      q.setFromAxisAngle(up, Math.atan2(dx * dir, dz * dir));
      v3.set(x, y + 0.6 + bob, z);
      sc.set(0.7, 1.2, 0.7);
      mtx.compose(v3, q, sc);
      this.vBody.setMatrixAt(i, mtx);
      this.vBody.setColorAt(i, col.setHex(JOB_COLOR[a.job]));
      v3.set(x, y + 1.45 + bob, z);
      sc.set(0.55, 0.55, 0.55);
      mtx.compose(v3, q, sc);
      this.vHead.setMatrixAt(i, mtx);
      if (carrying || (!moving && p >= walk && p < walk + 3)) {
        v3.set(x, y + (carrying ? 1.9 : 0.4) + bob, z);
        sc.set(0.5, 0.4, 0.5);
        mtx.compose(v3, q, sc);
        this.vCarry.setMatrixAt(nc, mtx);
        this.vCarry.setColorAt(nc, col.setHex(CARRY_COLOR[a.job]));
        nc++;
      }
    }
    this.vBody.count = this.agents.length;
    this.vHead.count = this.agents.length;
    this.vCarry.count = nc;
    [this.vBody, this.vHead, this.vCarry].forEach(function (m) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    });

    // 士兵：在村裡列隊、出征、歸來、來襲
    var v = this.view;
    var si = 0;
    var bi = 0;
    var self = this;
    var smax = this.soldierMax;
    function soldier(x, z, cls, faceA, moving, enemy, seed) {
      if (si >= smax) return;
      var y = Math.max(height(x, z), WATER_Y + 0.1);
      var bob = moving ? Math.abs(Math.sin(t * 8 + seed)) * 0.2 : 0;
      var horse = cls === "cavalry" || (cls === "unique" && v.uniqueBase === "cavalry");
      var hy = horse ? 1.0 : 0;
      q.setFromAxisAngle(up, faceA);
      v3.set(x, y + 0.65 + hy + bob, z);
      sc.set(0.75, 1.25, 0.75);
      mtx.compose(v3, q, sc);
      self.sBody.setMatrixAt(si, mtx);
      self.sBody.setColorAt(si, col.setHex(enemy ? 0x5a1d1d : CLASS_COLOR[cls] || 0x777777));
      v3.set(x, y + 1.55 + hy + bob, z);
      sc.set(0.58, 0.58, 0.58);
      mtx.compose(v3, q, sc);
      self.sHead.setMatrixAt(si, mtx);
      // 武器：槍＝長桿、弓＝弧（以細長盒表示）、攻城＝大方塊
      if (cls === "siege") {
        v3.set(x, y + 0.8, z);
        sc.set(1.6, 1.2, 2.4);
      } else if (cls === "spear" || cls === "unique") {
        v3.set(x + Math.sin(faceA + 1.4) * 0.45, y + 1.6 + hy + bob, z + Math.cos(faceA + 1.4) * 0.45);
        sc.set(0.12, 3.2, 0.12);
      } else if (cls === "archer") {
        v3.set(x + Math.sin(faceA + 1.4) * 0.45, y + 1.2 + hy + bob, z + Math.cos(faceA + 1.4) * 0.45);
        sc.set(0.1, 1.9, 0.35);
      } else {
        v3.set(x + Math.sin(faceA + 1.4) * 0.45, y + 1.1 + hy + bob, z + Math.cos(faceA + 1.4) * 0.45);
        sc.set(0.12, 1.3, 0.12);
      }
      mtx.compose(v3, q, sc);
      self.sWeapon.setMatrixAt(si, mtx);
      if (horse) {
        v3.set(x, y + 0.75 + bob * 0.5, z);
        sc.set(0.9, 1.0, 2.4);
        mtx.compose(v3, q, sc);
      } else {
        mtx.makeScale(0, 0, 0);
      }
      self.sHorse.setMatrixAt(si, mtx);
      si++;
    }
    function banner(x, z, enemy) {
      if (bi >= 12) return;
      var y = Math.max(height(x, z), WATER_Y + 0.1);
      v3.set(x, y + 4.2, z);
      sc.set(0.15, 5, 1.2);
      q.identity();
      mtx.compose(v3, q, sc);
      self.banners.setMatrixAt(bi, mtx);
      self.banners.setColorAt(bi, col.setHex(enemy ? 0x222222 : v.civColor || 0xc0392b));
      bi++;
    }
    if (v) {
      // 村裡的士兵：在兵營前廣場列隊
      var home = v.soldiers || {};
      var classes = Object.keys(home).filter(function (c) {
        return home[c] > 0;
      });
      var totalHome = 0;
      classes.forEach(function (c) {
        totalHome += home[c];
      });
      var showHome = Math.min(120, Math.round(Math.sqrt(totalHome) * 4));
      var gx = self.parade[0];
      var gz = self.parade[1];
      var col0 = 0;
      classes.forEach(function (c) {
        var n = Math.max(1, Math.round((showHome * home[c]) / Math.max(1, totalHome)));
        for (var j = 0; j < n; j++) {
          var row = Math.floor(col0 / 12);
          var cc = col0 % 12;
          soldier(gx + cc * 1.6, gz - row * 1.8, c, Math.PI * 0.75, false, false, col0);
          col0++;
        }
      });
      // 出征與歸來
      (v.expeditions || []).forEach(function (ex) {
        var r0 = 22;
        var r1 = 205;
        var r = ex.phase === "go" ? lerp(r0, r1, ex.frac) : lerp(r1, r0, ex.frac);
        var n = Math.min(40, Math.max(3, Math.round(Math.sqrt(ex.n) * 3)));
        var dirX = Math.cos(ex.angle);
        var dirZ = Math.sin(ex.angle);
        var face = Math.atan2(dirX * (ex.phase === "go" ? 1 : -1), dirZ * (ex.phase === "go" ? 1 : -1));
        var back = ex.phase === "go" ? -1 : 1;
        for (var j = 0; j < n; j++) {
          var rr = r + back * Math.floor(j / 3) * 1.8;
          if (rr < 18 || rr > 210) continue;
          var off = ((j % 3) - 1) * 1.4;
          soldier(dirX * rr - dirZ * off, dirZ * rr + dirX * off, ex.classes[j % ex.classes.length] || "spear", face, true, false, j + ex.id);
        }
        if (r > 18 && r < 210) banner(dirX * r, dirZ * r, false);
      });
      // 來襲的敵軍
      if (v.raid) {
        var rd = v.raid;
        var rr0 = lerp(215, (self.towerRing || 40) + 6, rd.frac);
        var dx2 = Math.cos(rd.angle);
        var dz2 = Math.sin(rd.angle);
        var nn = Math.min(50, Math.max(4, Math.round(Math.sqrt(rd.n) * 3)));
        var face2 = Math.atan2(-dx2, -dz2);
        for (var e = 0; e < nn; e++) {
          var rr2 = rr0 + Math.floor(e / 4) * 1.8;
          var off2 = ((e % 4) - 1.5) * 1.4;
          soldier(dx2 * rr2 - dz2 * off2, dz2 * rr2 + dx2 * off2, rd.classes[e % rd.classes.length] || "spear", face2, true, true, e);
        }
        banner(dx2 * rr0, dz2 * rr0, true);
      }
    }
    [this.sBody, this.sHead, this.sWeapon, this.sHorse].forEach(function (m) {
      m.count = si;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    });
    this.banners.count = bi;
    this.banners.instanceMatrix.needsUpdate = true;
    if (this.banners.instanceColor) this.banners.instanceColor.needsUpdate = true;
  };

  // ---------------- 晝夜、水、煙 ----------------

  Scene.prototype.lighting = function () {
    var v = this.view;
    var tod = v ? v.timeOfDay : 0.3; // 0..1，0.25 = 正午附近
    var sunA = tod * Math.PI * 2;
    var elev = Math.sin(sunA); // >0 白天
    var day = smooth(-0.15, 0.25, elev);
    var dusk = Math.max(0, 1 - Math.abs(elev) * 3.5) * 0.9;
    this.sun.position.set(Math.cos(sunA) * 200, Math.max(25, elev * 260), 80);
    this.sun.intensity = 0.22 + day * 0.72;
    this.sun.color.setHex(0xfff1d6).lerp(new THREE.Color(0xff9a5a), dusk * 0.7);
    this.hemi.intensity = 0.22 + day * 0.28;
    this.ambient.intensity = 0.12 + day * 0.08;
    var top = new THREE.Color(0x0f1a33).lerp(new THREE.Color(0x3d7fc4), day);
    var hor = new THREE.Color(0x253252).lerp(new THREE.Color(v ? v.sky || 0xa9d4ec : 0xa9d4ec), day);
    hor.lerp(new THREE.Color(0xf0a070), dusk * 0.6);
    var key = top.getHexString() + hor.getHexString();
    if (key !== this.skyKey) {
      this.skyKey = key;
      this.paintSky(top, hor);
      this.scene.fog.color.copy(hor);
    }
    var night = 1 - day;
    this.night = night;
    if (this.lightMat) this.lightMat.emissiveIntensity = night * 1.6;
    this.fireLight.intensity = night * 2.2 * (0.85 + Math.random() * 0.3);
  };

  Scene.prototype.animateWater = function (t) {
    var pos = this.water.geometry.attributes.position;
    var base = this.waterBase;
    for (var i = 0; i < pos.count; i++) {
      var x = base[i * 3];
      var z = base[i * 3 + 2];
      pos.setY(i, Math.sin(x * 0.08 + t * 1.1) * 0.18 + Math.cos(z * 0.07 + t * 0.8) * 0.18);
    }
    pos.needsUpdate = true;
    this.water.geometry.computeVertexNormals();
  };

  Scene.prototype.animateSmoke = function (dt) {
    var src = this.smokeSources;
    if (!src.length) return;
    var arr = this.smoke.geometry.attributes.position.array;
    var wind = 0.6;
    for (var i = 0; i < this.smokeP.length; i++) {
      var p = this.smokeP[i];
      p.life -= dt;
      if (p.life <= 0) {
        var s = src[i % src.length];
        p.x = s[0] + (Math.random() - 0.5) * s[3];
        p.y = s[1];
        p.z = s[2] + (Math.random() - 0.5) * s[3];
        p.life = 4 + Math.random() * 3;
        p.vx = wind * (0.6 + Math.random() * 0.6);
      }
      p.y += dt * 1.6;
      p.x += dt * p.vx;
      arr[i * 3] = p.x;
      arr[i * 3 + 1] = p.y;
      arr[i * 3 + 2] = p.z;
    }
    this.smoke.geometry.attributes.position.needsUpdate = true;
  };

  // ---------------- 鏡頭 ----------------

  Scene.prototype.bindControls = function () {
    var self = this;
    var el = this.renderer.domElement;
    var drag = null;
    var pinch = null;
    function touched() {
      self.cam.userAt = performance.now();
    }
    el.addEventListener("contextmenu", function (e) {
      e.preventDefault();
    });
    el.addEventListener("pointerdown", function (e) {
      if (e.pointerType === "touch") return;
      drag = { x: e.clientX, y: e.clientY, pan: e.button === 2 || e.shiftKey };
      el.setPointerCapture(e.pointerId);
      touched();
    });
    el.addEventListener("pointermove", function (e) {
      if (!drag) return;
      var dx = e.clientX - drag.x;
      var dy = e.clientY - drag.y;
      drag.x = e.clientX;
      drag.y = e.clientY;
      if (drag.pan) self.pan(dx, dy);
      else self.rotate(dx, dy);
      touched();
    });
    el.addEventListener("pointerup", function () {
      drag = null;
    });
    el.addEventListener(
      "wheel",
      function (e) {
        e.preventDefault();
        self.cam.dist = clamp(self.cam.dist * (1 + Math.sign(e.deltaY) * 0.1), 25, 340);
        touched();
      },
      { passive: false }
    );
    // 觸控：一指旋轉、兩指縮放與平移
    el.addEventListener(
      "touchstart",
      function (e) {
        if (e.touches.length === 1) {
          drag = { x: e.touches[0].clientX, y: e.touches[0].clientY, pan: false };
          pinch = null;
        } else if (e.touches.length === 2) {
          drag = null;
          pinch = touchInfo(e);
        }
        touched();
      },
      { passive: true }
    );
    el.addEventListener(
      "touchmove",
      function (e) {
        if (e.touches.length === 1 && drag) {
          var dx = e.touches[0].clientX - drag.x;
          var dy = e.touches[0].clientY - drag.y;
          drag.x = e.touches[0].clientX;
          drag.y = e.touches[0].clientY;
          self.rotate(dx, dy);
          e.preventDefault();
        } else if (e.touches.length === 2 && pinch) {
          var now = touchInfo(e);
          self.cam.dist = clamp((self.cam.dist * pinch.d) / Math.max(10, now.d), 25, 340);
          self.pan(now.x - pinch.x, now.y - pinch.y);
          pinch = now;
          e.preventDefault();
        }
        touched();
      },
      { passive: false }
    );
    el.addEventListener("touchend", function () {
      drag = null;
      pinch = null;
    });
    el.addEventListener("dblclick", function () {
      self.resetView();
    });
    function touchInfo(e) {
      var a = e.touches[0];
      var b = e.touches[1];
      return { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 };
    }
  };

  Scene.prototype.rotate = function (dx, dy) {
    this.cam.theta -= dx * 0.006;
    this.cam.phi = clamp(this.cam.phi - dy * 0.005, 0.28, 1.4);
  };
  Scene.prototype.pan = function (dx, dy) {
    var k = this.cam.dist * 0.0016;
    var th = this.cam.theta;
    this.cam.tx = clamp(this.cam.tx - (Math.cos(th) * dx - Math.sin(th) * dy) * k, -170, 170);
    this.cam.tz = clamp(this.cam.tz - (-Math.sin(th) * dx - Math.cos(th) * dy) * k, -170, 170);
  };
  Scene.prototype.resetView = function () {
    this.cam.theta = -0.75;
    this.cam.phi = 0.95;
    this.cam.tx = 0;
    this.cam.tz = 6;
    this.cam.dist = this.suggestDist || 120;
  };
  Scene.prototype.setAutoRotate = function (on) {
    this.autoRotate = !!on;
  };
  // 拉近看某個方向（出征部隊等）
  Scene.prototype.focus = function (x, z, dist) {
    this.cam.tx = x;
    this.cam.tz = z;
    if (dist) this.cam.dist = dist;
    this.cam.userAt = performance.now();
  };

  Scene.prototype.frame = function (ts) {
    var dt = this.lastFrame ? Math.min(0.1, (ts - this.lastFrame) / 1000) : 0.016;
    this.lastFrame = ts;
    this.clock += dt;
    var t = this.clock;
    if (this.autoRotate) this.cam.theta += dt * 0.05;
    // 村子變大時，玩家 20 秒沒操作鏡頭就慢慢拉遠到看得到全村
    if (this.suggestDist && this.cam.dist < this.suggestDist && performance.now() - this.cam.userAt > 20000) {
      this.cam.dist = Math.min(this.suggestDist, this.cam.dist + (this.suggestDist - this.cam.dist) * dt * 0.6 + dt * 2);
    }
    var c = this.cam;
    var ty = 0;
    var x = c.tx + Math.sin(c.theta) * Math.sin(c.phi) * c.dist;
    var z = c.tz + Math.cos(c.theta) * Math.sin(c.phi) * c.dist;
    var y = ty + Math.cos(c.phi) * c.dist;
    var ground = height(x, z) + 4;
    this.camera.position.set(x, Math.max(y, ground), z);
    this.camera.lookAt(c.tx, ty, c.tz);
    this.sun.target.position.set(c.tx, 0, c.tz);
    this.lighting();
    this.sun.position.x += c.tx;
    this.sun.position.z += c.tz;
    this.animateWater(t);
    this.animateSmoke(dt);
    this.animatePeople(dt, t);
    if (this.flag) this.flag.rotation.y = Math.sin(t * 2) * 0.15;
    this.renderer.render(this.scene, this.camera);
  };

  Scene.prototype.dispose = function () {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.onResize);
    if (this.ro) this.ro.disconnect();
    this.scene.traverse(function (o) {
      if (o.isInstancedMesh) o.dispose();
    });
    this.kit.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentNode) this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
  };

  window.PriTestJomonScene = {
    supported: supported,
    load: load,
    create: function (container) {
      return new Scene(container);
    },
    height: height,
  };
})();
