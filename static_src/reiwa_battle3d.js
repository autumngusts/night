// 令和之野望（reiwa）：Three.js 3D 合戰演出（使用者指定 2026-11-02：征討時兩軍在簡易 3D 戰場上同時交戰，看完再顯示結果）。
// 勝負由 reiwa_core.js 的合戰規則先算好（report.rounds），這裡只負責把 5 路部隊「同時開戰」的過程演出來：
//   布陣 → 遠程齊射 → 全軍突擊 → 白兵戰（依損耗比例倒下）→ 攻陷／擊退／撤退。
// three.js 與 starV／賽狗共用 static/vendor/three.min.js（r149），網址由頁面放在 #rw-app[data-three-src]，
// 第一次開戰時才動態載入；不支援 WebGL 或載入失敗時由 reiwa.js 退回 2D 翻牌演出。
(function () {
  "use strict";

  var THREE = null;
  var loading = null;

  // ---------------- 載入與支援判斷 ----------------

  function supported() {
    try {
      var c = document.createElement("canvas");
      return !!(window.WebGLRenderingContext && (c.getContext("webgl2") || c.getContext("webgl")));
    } catch (e) {
      return false;
    }
  }

  function load() {
    if (THREE) return Promise.resolve(THREE);
    if (window.THREE && window.THREE.WebGLRenderer) {
      THREE = window.THREE;
      return Promise.resolve(THREE);
    }
    if (loading) return loading;
    loading = new Promise(function (resolve, reject) {
      var app = document.getElementById("rw-app");
      var src = app && app.getAttribute("data-three-src");
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
        } else {
          reject(new Error("THREE missing"));
        }
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
  function smooth(t) {
    t = clamp(t, 0, 1);
    return t * t * (3 - 2 * t);
  }
  function seg(t, a, b) {
    return smooth((t - a) / (b - a));
  }
  function lerp(a, b, k) {
    return a + (b - a) * k;
  }
  function setSrgb(tex) {
    if ("colorSpace" in tex && THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
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

  var T_VOLLEY = 1.4;
  var T_CHARGE = 3.0;
  var T_CLASH = 5.0;
  var T_MELEE_END = 8.0;
  var T_OUTCOME_END = 10.6;
  var T_DONE = 11.0;
  var LANE_Z = [-12, -6, 0, 6, 12];
  var RANGED = { archer: true, gun: true };

  // ---------------- 主要演出 ----------------

  // opts：{ report, attackerColor, defenderColor, attackerName, defenderName, nodeName, profile, season, defenseLevel,
  //         playerWon, typeIcon(tid), typeName(tid), labels{...}, startAtEnd, onDone() }
  function play(container, opts) {
    var report = opts.report;
    var lb = opts.labels || {};
    var rng = makeRng(report.rounds.length * 7919 + (report.plunderGold || 0) * 31 + 17);
    var season = opts.season || 0;
    var reduced = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

    // ---- 版面：canvas + HUD ----
    container.innerHTML = "";
    container.classList.add("rw-b3d");
    var canvasHost = document.createElement("div");
    canvasHost.className = "rw-b3d-canvas";
    container.appendChild(canvasHost);
    var hud = document.createElement("div");
    hud.className = "rw-b3d-hud";
    hud.innerHTML =
      '<div class="rw-b3d-plate rw-b3d-plate-atk"><i></i><b></b><span></span></div>' +
      '<div class="rw-b3d-plate rw-b3d-plate-def"><i></i><b></b><span></span></div>' +
      '<div class="rw-b3d-hint"></div>' +
      '<div class="rw-b3d-phase"></div>' +
      '<div class="rw-b3d-controls"></div>';
    container.appendChild(hud);
    function setPlate(cls, color, title, line) {
      var p = hud.querySelector(cls);
      p.querySelector("i").style.background = color;
      p.querySelector("b").textContent = title;
      p.querySelector("span").textContent = line;
    }
    var atkTotal = 0;
    var defTotal = 0;
    report.rounds.forEach(function (r) {
      atkTotal += r.attackerAmount || 0;
      defTotal += r.defenderAmount || 0;
    });
    setPlate(".rw-b3d-plate-atk", opts.attackerColor, opts.attackerName, (lb.troops || "") + " " + atkTotal);
    setPlate(".rw-b3d-plate-def", opts.defenderColor, opts.defenderName, (lb.troops || "") + " " + defTotal);
    hud.querySelector(".rw-b3d-hint").textContent = lb.drag || "";
    var phaseEl = hud.querySelector(".rw-b3d-phase");
    var controls = hud.querySelector(".rw-b3d-controls");

    // ---- three.js 基本設定 ----
    var renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // r149 沿用舊版色彩處理（不設定輸出編碼）；若日後換成 r152+ 的 three.js，CanvasTexture 會改用 colorSpace
    canvasHost.appendChild(renderer.domElement);

    var SKY = [0xbfd9ea, 0x9fcbe8, 0xe8c9a0, 0xc9d6e2][season];
    var GROUND = [0x5f8f3e, 0x4f8034, 0x8a7a3a, 0xc9d3d8][season];
    var scene = new THREE.Scene();
    scene.background = new THREE.Color(SKY);
    scene.fog = new THREE.Fog(SKY, 70, 150);
    var camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.5, 400);

    var hemi = new THREE.HemisphereLight(0xdfe9f2, season === 3 ? 0x8a96a0 : 0x4a3e28, 0.55);
    scene.add(hemi);
    var sun = new THREE.DirectionalLight(season === 2 ? 0xffd9a8 : 0xfff4e0, 0.72);
    sun.position.set(-30, 50, 25);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -50;
    sun.shadow.camera.right = 50;
    sun.shadow.camera.top = 35;
    sun.shadow.camera.bottom = -35;
    sun.shadow.camera.near = 10;
    sun.shadow.camera.far = 140;
    scene.add(sun);

    // ---- 材質與幾何共用 ----
    var matCache = {};
    function mat(hex, extra) {
      var key = hex + (extra ? JSON.stringify(extra) : "");
      if (!matCache[key]) {
        var o = { color: hex };
        if (extra) Object.keys(extra).forEach(function (k) { o[k] = extra[k]; });
        matCache[key] = new THREE.MeshLambertMaterial(o);
      }
      return matCache[key];
    }
    var geoCache = {};
    function geo(key, make) {
      if (!geoCache[key]) geoCache[key] = make();
      return geoCache[key];
    }
    function mesh(g, m, shadow) {
      var me = new THREE.Mesh(g, m);
      if (shadow !== false) me.castShadow = true;
      return me;
    }
    var textures = [];

    // ---- 地形 ----
    var groundGeo = new THREE.PlaneGeometry(160, 110, 80, 55);
    groundGeo.rotateX(-Math.PI / 2);
    var pos = groundGeo.attributes.position;
    var colors = [];
    var base = new THREE.Color(GROUND);
    for (var i = 0; i < pos.count; i++) {
      var x = pos.getX(i);
      var z = pos.getZ(i);
      // 戰場中央（|z|<18、x 在兩軍之間）保持平坦，外圍起伏
      var flat = Math.abs(z) < 18 && x > -42 && x < 30 ? 0 : 1;
      var h = flat * (Math.sin(x * 0.11) * 1.2 + Math.cos(z * 0.13) * 1.1 + Math.sin((x + z) * 0.05) * 1.6 + 1.2);
      if (opts.profile === "mountain") {
        var dx = x - 37;
        var dz = z;
        var r = Math.sqrt(dx * dx + dz * dz);
        if (r < 16) h = Math.max(h, (1 - r / 16) * 5.5 + 0.5);
      }
      pos.setY(i, Math.max(0, h));
      var v = 0.88 + rng() * 0.18;
      colors.push(base.r * v, base.g * v, base.b * v);
    }
    groundGeo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    groundGeo.computeVertexNormals();
    var ground = new THREE.Mesh(groundGeo, new THREE.MeshLambertMaterial({ vertexColors: true }));
    ground.receiveShadow = true;
    scene.add(ground);
    function groundHeight(x, z) {
      if (opts.profile === "mountain") {
        var r = Math.sqrt((x - 37) * (x - 37) + z * z);
        if (r < 16) return (1 - r / 16) * 5.5 + 0.5;
      }
      return 0;
    }

    // 戰場上的土路（5 路行軍道）
    LANE_Z.forEach(function (z) {
      var road = new THREE.Mesh(geo("road", function () {
        var g = new THREE.PlaneGeometry(56, 2.6);
        g.rotateX(-Math.PI / 2);
        return g;
      }), mat(season === 3 ? 0xcfd6d9 : 0xa08a62, { transparent: true, opacity: 0.45 }));
      road.position.set(-6, 0.03, z);
      road.receiveShadow = true;
      scene.add(road);
    });

    if (opts.profile === "coastal") {
      var sea = new THREE.Mesh(new THREE.PlaneGeometry(70, 140), new THREE.MeshLambertMaterial({ color: 0x3f7fae }));
      sea.rotation.x = -Math.PI / 2;
      sea.position.set(78, 0.4, 0);
      scene.add(sea);
    }

    // 遠山
    for (var m = 0; m < 14; m++) {
      var ang = (m / 14) * Math.PI * 2;
      var dist = 95 + rng() * 25;
      var hgt = 16 + rng() * 22;
      var mtn = new THREE.Mesh(new THREE.ConeGeometry(18 + rng() * 10, hgt, 6), mat(season === 3 ? 0xdfe6ea : 0x7d8f9c));
      mtn.position.set(Math.cos(ang) * dist, hgt / 2 - 2, Math.sin(ang) * dist);
      scene.add(mtn);
    }

    // 樹木（避開行軍道與城、陣）
    var treeLeaf = [0xf2b6c8, 0x3f7a3a, 0xc8642c, 0x3f5f45][season];
    for (var tr = 0; tr < 60; tr++) {
      var tx = -70 + rng() * 140;
      var tz = -50 + rng() * 100;
      if (Math.abs(tz) < 17 && tx > -48 && tx < 52) continue;
      var tree = new THREE.Group();
      var trunk = mesh(geo("trunk", function () { return new THREE.CylinderGeometry(0.18, 0.25, 1.4, 5); }), mat(0x5b4128));
      trunk.position.y = 0.7;
      tree.add(trunk);
      var leaf = mesh(geo("leaf", function () { return new THREE.ConeGeometry(1.3, 2.8, 6); }), mat(treeLeaf));
      leaf.position.y = 2.6;
      tree.add(leaf);
      if (season === 3) {
        var snowcap = mesh(geo("snowcap", function () { return new THREE.ConeGeometry(0.75, 1.2, 6); }), mat(0xffffff));
        snowcap.position.y = 3.5;
        tree.add(snowcap);
      }
      var sc = 0.8 + rng() * 0.7;
      tree.scale.set(sc, sc, sc);
      tree.position.set(tx, 0, tz);
      scene.add(tree);
    }

    // ---- 旗幟（大型：陣、城） ----
    var bigFlags = [];
    function banner(x, z, color, h) {
      var g = new THREE.Group();
      var pole = mesh(geo("pole", function () { return new THREE.CylinderGeometry(0.06, 0.06, 1, 5); }), mat(0x3b2d20));
      pole.scale.y = h;
      pole.position.y = h / 2;
      g.add(pole);
      var fg = new THREE.PlaneGeometry(1.1, 2.6, 6, 1);
      var flagMat = new THREE.MeshLambertMaterial({ color: color, side: THREE.DoubleSide });
      var flag = new THREE.Mesh(fg, flagMat);
      flag.castShadow = true;
      flag.position.set(0.55, h - 1.4, 0);
      g.add(flag);
      g.position.set(x, groundHeight(x, z), z);
      scene.add(g);
      var item = { flag: flag, base: fg.attributes.position.array.slice(), mat: flagMat, phase: rng() * 6 };
      bigFlags.push(item);
      return item;
    }

    // 攻方本陣：陣幕＋旗
    var camp = new THREE.Group();
    var curtainTex = (function () {
      var c = document.createElement("canvas");
      c.width = 256;
      c.height = 64;
      var g2 = c.getContext("2d");
      g2.fillStyle = "#f2ede1";
      g2.fillRect(0, 0, 256, 64);
      g2.fillStyle = opts.attackerColor;
      g2.fillRect(0, 14, 256, 8);
      g2.fillRect(0, 42, 256, 8);
      g2.beginPath();
      g2.arc(128, 32, 18, 0, Math.PI * 2);
      g2.fillStyle = "#f2ede1";
      g2.fill();
      g2.lineWidth = 5;
      g2.strokeStyle = opts.attackerColor;
      g2.stroke();
      var tex = new THREE.CanvasTexture(c);
      setSrgb(tex);
      textures.push(tex);
      return tex;
    })();
    [-9, 9].forEach(function (z) {
      var cur = mesh(new THREE.PlaneGeometry(14, 2.2), new THREE.MeshLambertMaterial({ map: curtainTex, side: THREE.DoubleSide }));
      cur.position.set(-37, 1.1, z * 0.0 + (z < 0 ? -7 : 7));
      cur.rotation.y = Math.PI / 2;
      camp.add(cur);
    });
    scene.add(camp);
    for (var bf = 0; bf < 5; bf++) banner(-40, -12 + bf * 6, opts.attackerColor, 5.5);

    // ---- 守方城池 ----
    var castle = new THREE.Group();
    var cx = 37;
    var cy = groundHeight(cx, 0);
    var stoneMat = mat(0x9a9284);
    var wallMat = mat(0xf4efe4);
    var roofMat = mat(0x39424c);
    var baseStone = mesh(new THREE.CylinderGeometry(6.2, 7.6, 3, 4), stoneMat);
    baseStone.rotation.y = Math.PI / 4;
    baseStone.position.y = 1.5;
    castle.add(baseStone);
    var tierY = 3;
    for (var ti = 0; ti < 3; ti++) {
      var w = 7.4 - ti * 1.9;
      var hh = 2.4 - ti * 0.3;
      var body = mesh(new THREE.BoxGeometry(w, hh, w * 0.85), wallMat);
      body.position.y = tierY + hh / 2;
      castle.add(body);
      var roof = mesh(new THREE.CylinderGeometry(0.4, (w + 1.6) * 0.72, 1.4, 4), roofMat);
      roof.rotation.y = Math.PI / 4;
      roof.scale.z = 0.85;
      roof.position.y = tierY + hh + 0.55;
      castle.add(roof);
      tierY += hh + 0.9;
    }
    var shachi = mesh(new THREE.BoxGeometry(0.3, 0.6, 0.3), mat(0xe2b23a));
    shachi.position.y = tierY + 0.2;
    castle.add(shachi);
    castle.position.set(cx, cy, 0);
    scene.add(castle);
    // 城牆（依築城等級）
    var lvl = Math.max(0, opts.defenseLevel || 0);
    if (lvl >= 1) {
      [-1, 1].forEach(function (sgn) {
        var wall = mesh(new THREE.BoxGeometry(1, 2.2 + lvl * 0.4, 12), wallMat);
        wall.position.set(27, 1.1 + lvl * 0.2, sgn * 9.5);
        scene.add(wall);
        var cap = mesh(new THREE.BoxGeometry(1.4, 0.35, 12.2), roofMat);
        cap.position.set(27, 2.3 + lvl * 0.4, sgn * 9.5);
        scene.add(cap);
      });
      var gate = mesh(new THREE.BoxGeometry(1.6, 3.6, 7), mat(0x5b4330));
      gate.position.set(27, 1.8, 0);
      scene.add(gate);
    }
    var castleFlags = [];
    [-6, 6].forEach(function (z) {
      castleFlags.push(banner(31, z, opts.defenderColor, 6.5));
    });
    if (lvl >= 2) {
      [-14, 14].forEach(function (z) {
        castleFlags.push(banner(27, z, opts.defenderColor, 5));
      });
    }

    // ---- 士兵模型 ----
    var SKIN = 0xe8c39e;
    var ARMOR = 0x3a302b;
    var WOOD = 0x6b4a2b;
    var METAL = 0xcfd6dc;

    function weaponFor(type) {
      var g = new THREE.Group();
      if (type === "ashigaru") {
        var shaft = mesh(geo("spear", function () { return new THREE.CylinderGeometry(0.03, 0.03, 3.4, 4); }), mat(WOOD));
        shaft.rotation.x = 1.05;
        shaft.position.set(0.2, 1.15, 0.65);
        g.add(shaft);
        var tip = mesh(geo("tip", function () { return new THREE.ConeGeometry(0.07, 0.35, 4); }), mat(METAL));
        tip.rotation.x = 1.05;
        tip.position.set(0.2, 1.15 + Math.cos(1.05) * 1.8, 0.65 + Math.sin(1.05) * 1.8);
        g.add(tip);
      } else if (type === "naginata") {
        var pole = mesh(geo("naginataPole", function () { return new THREE.CylinderGeometry(0.035, 0.035, 2.1, 4); }), mat(WOOD));
        pole.rotation.x = 0.7;
        pole.position.set(0.25, 1.25, 0.45);
        g.add(pole);
        var blade = mesh(geo("naginataBlade", function () { return new THREE.BoxGeometry(0.05, 0.6, 0.14); }), mat(METAL));
        blade.rotation.x = 0.7;
        blade.position.set(0.25, 1.25 + Math.cos(0.7) * 1.3, 0.45 + Math.sin(0.7) * 1.3);
        g.add(blade);
      } else if (type === "gun") {
        var barrel = mesh(geo("gun", function () { return new THREE.CylinderGeometry(0.04, 0.05, 1.3, 5); }), mat(0x2b2018));
        barrel.rotation.x = Math.PI / 2;
        barrel.position.set(0.12, 1.2, 0.55);
        g.add(barrel);
      } else if (type === "archer") {
        var bow = mesh(geo("bow", function () { return new THREE.TorusGeometry(0.62, 0.03, 4, 10, Math.PI); }), mat(WOOD));
        bow.rotation.z = Math.PI / 2;
        bow.position.set(0.1, 1.15, 0.38);
        g.add(bow);
      } else if (type === "ninja") {
        var blade2 = mesh(geo("katana", function () { return new THREE.BoxGeometry(0.04, 0.05, 0.9); }), mat(METAL));
        blade2.position.set(0.25, 0.95, 0.55);
        blade2.rotation.x = -0.4;
        g.add(blade2);
      } else if (type === "cavalry") {
        var lance = mesh(geo("lance", function () { return new THREE.CylinderGeometry(0.03, 0.03, 3.6, 4); }), mat(WOOD));
        lance.rotation.x = 1.25;
        lance.position.set(0.3, 2.2, 1.1);
        g.add(lance);
      }
      return g;
    }

    function makeSoldier(type, color, side) {
      var root = new THREE.Group();
      var body = new THREE.Group();
      root.add(body);
      var ninja = type === "ninja";
      var cav = type === "cavalry";
      var dark = ninja ? 0x1d1d24 : ARMOR;
      var lift = 0;
      if (cav) {
        var horse = new THREE.Group();
        var hb = mesh(geo("horseBody", function () { return new THREE.BoxGeometry(0.55, 0.6, 1.5); }), mat(0x6b4a2e));
        hb.position.y = 1.05;
        horse.add(hb);
        var neck = mesh(geo("horseNeck", function () { return new THREE.BoxGeometry(0.3, 0.8, 0.35); }), mat(0x6b4a2e));
        neck.position.set(0, 1.5, 0.75);
        neck.rotation.x = 0.5;
        horse.add(neck);
        var hhead = mesh(geo("horseHead", function () { return new THREE.BoxGeometry(0.26, 0.28, 0.6); }), mat(0x5d3f26));
        hhead.position.set(0, 1.85, 1.0);
        horse.add(hhead);
        var cloth = mesh(geo("horseCloth", function () { return new THREE.BoxGeometry(0.6, 0.3, 0.9); }), mat(new THREE.Color(color).getHex()));
        cloth.position.set(0, 1.2, -0.1);
        horse.add(cloth);
        [[-0.18, 0.5], [0.18, 0.5], [-0.18, -0.55], [0.18, -0.55]].forEach(function (p) {
          var leg = mesh(geo("horseLeg", function () { return new THREE.CylinderGeometry(0.06, 0.05, 0.85, 4); }), mat(0x4b331f));
          leg.position.set(p[0], 0.42, p[1]);
          horse.add(leg);
        });
        body.add(horse);
        lift = 0.95;
      } else {
        var legs = mesh(geo("legs", function () { return new THREE.BoxGeometry(0.34, 0.7, 0.24); }), mat(0x231d19));
        legs.position.y = 0.35;
        body.add(legs);
      }
      var torso = mesh(geo("torso", function () { return new THREE.BoxGeometry(0.5, 0.6, 0.32); }), mat(dark));
      torso.position.y = 1.0 + lift;
      body.add(torso);
      var sash = mesh(geo("sash", function () { return new THREE.BoxGeometry(0.53, 0.12, 0.35); }), mat(new THREE.Color(color).getHex()));
      sash.position.y = 0.78 + lift;
      body.add(sash);
      var head = mesh(geo("head", function () { return new THREE.SphereGeometry(0.17, 8, 6); }), mat(ninja ? 0x1d1d24 : SKIN));
      head.position.y = 1.45 + lift;
      body.add(head);
      if (!ninja) {
        var hat = mesh(geo("hat", function () { return new THREE.ConeGeometry(0.32, 0.22, 8); }), mat(0x2b2522));
        hat.position.y = 1.62 + lift;
        body.add(hat);
        var pole = mesh(geo("sashimonoPole", function () { return new THREE.CylinderGeometry(0.015, 0.015, 1.1, 3); }), mat(0x3b2d20));
        pole.position.set(0, 1.75 + lift, -0.2);
        body.add(pole);
        var flag = mesh(geo("sashimono", function () { return new THREE.PlaneGeometry(0.36, 0.55); }), mat(new THREE.Color(color).getHex(), { side: THREE.DoubleSide }));
        flag.position.set(0.19, 2.0 + lift, -0.2);
        flag.rotation.y = Math.PI / 2;
        body.add(flag);
      }
      var weapon = weaponFor(type);
      weapon.position.y = lift * 0.2;
      body.add(weapon);
      if (ninja) body.scale.set(0.95, 0.88, 0.95);
      root.rotation.y = side === "atk" ? Math.PI / 2 : -Math.PI / 2;
      return { root: root, body: body, weapon: weapon };
    }

    // ---- 文字看板（CanvasTexture sprite） ----
    function textSprite(text, fg, bg, size) {
      var c = document.createElement("canvas");
      var g2 = c.getContext("2d");
      var font = "bold 44px 'Yu Mincho','Hiragino Mincho ProN','Noto Serif JP','Noto Serif TC',serif";
      g2.font = font;
      var w = Math.ceil(g2.measureText(text).width) + 36;
      c.width = w;
      c.height = 68;
      g2.font = font;
      if (bg) {
        g2.fillStyle = bg;
        var r = 14;
        g2.beginPath();
        g2.moveTo(r, 0);
        g2.lineTo(w - r, 0);
        g2.quadraticCurveTo(w, 0, w, r);
        g2.lineTo(w, 68 - r);
        g2.quadraticCurveTo(w, 68, w - r, 68);
        g2.lineTo(r, 68);
        g2.quadraticCurveTo(0, 68, 0, 68 - r);
        g2.lineTo(0, r);
        g2.quadraticCurveTo(0, 0, r, 0);
        g2.fill();
      }
      g2.textAlign = "center";
      g2.textBaseline = "middle";
      g2.lineWidth = 8;
      g2.strokeStyle = "rgba(20,10,5,0.75)";
      if (!bg) g2.strokeText(text, w / 2, 36);
      g2.fillStyle = fg;
      g2.fillText(text, w / 2, 36);
      var tex = new THREE.CanvasTexture(c);
      setSrgb(tex);
      textures.push(tex);
      var sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
      var s = size || 1;
      sp.scale.set((w / 68) * 1.1 * s, 1.1 * s, 1);
      sp.renderOrder = 10;
      return sp;
    }

    var softTex = (function () {
      var c = document.createElement("canvas");
      c.width = 64;
      c.height = 64;
      var g2 = c.getContext("2d");
      var grad = g2.createRadialGradient(32, 32, 0, 32, 32, 32);
      grad.addColorStop(0, "rgba(255,255,255,1)");
      grad.addColorStop(1, "rgba(255,255,255,0)");
      g2.fillStyle = grad;
      g2.fillRect(0, 0, 64, 64);
      var tex = new THREE.CanvasTexture(c);
      textures.push(tex);
      return tex;
    })();
    function puff(color, opacity) {
      var sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTex, color: color, transparent: true, opacity: opacity, depthWrite: false }));
      scene.add(sp);
      return sp;
    }

    // ---- 部隊配置 ----
    function visibleCount(amount) {
      return clamp(Math.ceil(amount / 14), amount > 0 ? 2 : 0, 14);
    }
    function fallenCount(n, amount, loss) {
      if (!amount || !loss) return 0;
      if (loss >= amount) return n;
      return clamp(Math.round((n * loss) / amount), 1, n - 1);
    }

    var squads = [];
    var lanes = [];
    report.rounds.forEach(function (r) {
      var z = LANE_Z[r.slot] !== undefined ? LANE_Z[r.slot] : 0;
      var lane = { z: z, round: r, atk: null, def: null, dust: [], sparks: [] };
      if (r.attackerType) lane.atk = buildSquad("atk", r.attackerType, r.attackerAmount, r.attackerLoss, opts.attackerColor, z);
      var defType = r.defenderType || (r.reserve ? "ashigaru" : null);
      if (defType) lane.def = buildSquad("def", defType, r.defenderAmount, r.defenderLoss, opts.defenderColor, z, r.reserve);
      if (lane.atk && lane.def) {
        for (var d = 0; d < 7; d++) lane.dust.push({ sp: puff(season === 3 ? 0xffffff : 0xc9b48a, 0), seed: rng() });
        for (var k = 0; k < 4; k++) lane.sparks.push({ sp: puff(0xffd166, 0), seed: rng() });
      }
      // 相剋：克制方頭上蓋「克制」
      if (r.edge) {
        var stampSp = textSprite(lb.advantage || "", "#fff3e0", "rgba(192,57,43,0.92)", 0.9);
        stampSp.material.opacity = 0;
        scene.add(stampSp);
        lane.stamp = { sp: stampSp, squad: r.edge > 0 ? lane.atk : lane.def };
      }
      lanes.push(lane);
    });

    function buildSquad(side, type, amount, loss, color, z, reserve) {
      var n = visibleCount(amount);
      var fall = fallenCount(n, amount, loss);
      var cav = type === "cavalry";
      var spacing = cav ? 1.7 : 1.0;
      var cols = Math.min(4, n);
      var sign = side === "atk" ? 1 : -1;
      var startX = side === "atk" ? -20 : reserve ? 24 : 19;
      var men = [];
      for (var i2 = 0; i2 < n; i2++) {
        var row = Math.floor(i2 / cols);
        var col = i2 % cols;
        var s = makeSoldier(type, color, side);
        s.offX = -sign * row * spacing + (rng() - 0.5) * 0.3;
        s.offZ = (col - (cols - 1) / 2) * spacing * 0.95 + (rng() - 0.5) * 0.25;
        s.jitter = rng() * 6;
        s.row = row;
        scene.add(s.root);
        men.push(s);
      }
      // 前排先倒下
      for (var f = 0; f < fall; f++) {
        men[f].fallAt = T_CLASH + 0.3 + rng() * (T_MELEE_END - T_CLASH - 0.8);
        men[f].fallDir = rng() < 0.5 ? 1 : -1;
      }
      var label = textSprite((opts.typeIcon(type) || "") + " " + (reserve ? lb.reserve || "" : opts.typeName(type)) + " ×" + amount, "#ffffff", hexToRgba(color, 0.85), 0.8);
      scene.add(label);
      var lossLabel = loss ? textSprite("-" + loss, "#ff6b5b", null, 1.2) : null;
      if (lossLabel) {
        lossLabel.material.opacity = 0;
        scene.add(lossLabel);
      }
      var sq = { side: side, type: type, men: men, z: z, x: startX, startX: startX, label: label, lossLabel: lossLabel, reserve: !!reserve, sign: sign, survivors: n - fall };
      squads.push(sq);
      return sq;
    }

    function hexToRgba(hex, a) {
      var c = new THREE.Color(hex);
      return "rgba(" + Math.round(c.r * 255) + "," + Math.round(c.g * 255) + "," + Math.round(c.b * 255) + "," + a + ")";
    }

    // 遠程齊射：箭矢（弓）／鐵砲的閃光與硝煙
    var arrows = [];
    var muzzle = [];
    lanes.forEach(function (lane) {
      [["atk", lane.atk, lane.def], ["def", lane.def, lane.atk]].forEach(function (pair) {
        var sq = pair[1];
        if (!sq || !RANGED[sq.type]) return;
        var target = pair[2];
        for (var a = 0; a < 7; a++) {
          var t0 = T_VOLLEY + rng() * 1.1;
          if (sq.type === "archer") {
            var arrow = mesh(geo("arrow", function () {
              var g = new THREE.CylinderGeometry(0.02, 0.02, 0.8, 3);
              g.rotateZ(Math.PI / 2);
              return g;
            }), mat(0x2b2015), false);
            arrow.visible = false;
            scene.add(arrow);
            arrows.push({ mesh: arrow, sq: sq, target: target, t0: t0, dur: 0.9, dz: (rng() - 0.5) * 3, dx: (rng() - 0.5) * 2 });
          } else {
            muzzle.push({ flash: puff(0xffe08a, 0), smoke: puff(0xe9e4da, 0), sq: sq, t0: t0, dz: (rng() - 0.5) * 3 });
          }
        }
      });
    });

    // 城池起火（攻陷時）
    var fires = [];
    if (report.captured) {
      for (var fi = 0; fi < 10; fi++) fires.push({ sp: puff(fi % 2 ? 0xff8a2b : 0x3b3640, 0), seed: rng(), smoke: fi % 2 === 0 });
    }

    // 雪（冬季）
    var snow = null;
    if (season === 3) {
      var sg = new THREE.BufferGeometry();
      var sp = [];
      for (var sn = 0; sn < 900; sn++) sp.push(-60 + rng() * 120, rng() * 40, -40 + rng() * 80);
      sg.setAttribute("position", new THREE.Float32BufferAttribute(sp, 3));
      snow = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 0.35, transparent: true, opacity: 0.85, depthWrite: false }));
      scene.add(snow);
    }

    // ---- 每幀更新 ----
    var outcome = report.retreated ? "retreat" : report.captured ? "captured" : "repelled";
    var meetX = { atk: -1.1, def: 1.1 };

    function squadX(sq, t, lane) {
      var other = sq === lane.atk ? lane.def : lane.atk;
      var advanceStart = sq.type === "cavalry" ? T_CHARGE + 0.6 : RANGED[sq.type] ? T_CHARGE + 0.25 : T_CHARGE;
      var target = other ? meetX[sq.side] : sq.side === "atk" ? 4 : sq.startX;
      var x = lerp(sq.startX, target, seg(t, advanceStart, T_CLASH));
      if (t > T_MELEE_END) {
        var k = seg(t, T_MELEE_END + 0.2, T_OUTCOME_END);
        if (sq.side === "atk") x = lerp(x, outcome === "captured" ? 24 : -30, k);
        else if (outcome === "captured") x = lerp(x, 46, k);
      }
      return x;
    }

    // t：合戰時間軸（秒）；clock：實際經過時間，用於結束後仍持續的環境動畫（旗、火、雪）
    function update(t, clock) {
      // 旗幟飄動
      bigFlags.forEach(function (f) {
        var p = f.flag.geometry.attributes.position;
        for (var i3 = 0; i3 < p.count; i3++) {
          var bx = f.base[i3 * 3];
          p.setZ(i3, Math.sin(clock * 3 + f.phase + bx * 3) * 0.18 * (bx + 0.55));
        }
        p.needsUpdate = true;
      });
      // 攻陷後城旗換色
      if (outcome === "captured") {
        var swap = t > T_MELEE_END + 1.6;
        castleFlags.forEach(function (f) {
          f.mat.color.set(swap ? opts.attackerColor : opts.defenderColor);
        });
      }

      lanes.forEach(function (lane) {
        [lane.atk, lane.def].forEach(function (sq) {
          if (!sq) return;
          sq.x = squadX(sq, t, lane);
          var moving = (t > T_CHARGE && t < T_CLASH) || (t > T_MELEE_END + 0.2 && t < T_OUTCOME_END && (sq.side === "atk" || outcome === "captured"));
          var turnBack = sq.side === "atk" && outcome !== "captured" && t > T_MELEE_END + 0.2;
          var fleeing = sq.side === "def" && outcome === "captured" && t > T_MELEE_END + 0.2;
          sq.men.forEach(function (s, idx) {
            var fallen = s.fallAt !== undefined && t >= s.fallAt;
            var x = sq.x + s.offX;
            var z = sq.z + s.offZ;
            if (!fallen && t > T_CLASH && t < T_MELEE_END && lane.atk && lane.def) {
              x += Math.sin(t * 7 + s.jitter) * 0.25 * sq.sign;
              s.weapon.rotation.x = Math.sin(t * 9 + s.jitter) * 0.35;
            } else {
              s.weapon.rotation.x = 0;
            }
            if (fallen) {
              if (s.deadX === undefined) {
                s.deadX = x;
                s.deadZ = z;
              }
              x = s.deadX;
              z = s.deadZ;
              var k2 = clamp((t - s.fallAt) / 0.45, 0, 1);
              s.body.rotation.x = -1.45 * k2;
              s.body.rotation.z = 0.25 * s.fallDir * k2;
              s.body.position.y = -0.1 * k2;
            } else {
              s.body.rotation.x = 0;
              s.body.rotation.z = 0;
              var bob = moving ? Math.abs(Math.sin(t * 10 + s.jitter)) * 0.18 : 0;
              var cheer = sq.side === (outcome === "captured" ? "atk" : "def") && t > T_OUTCOME_END - 0.2 ? Math.abs(Math.sin(t * 6 + s.jitter)) * 0.35 : 0;
              s.body.position.y = bob + cheer;
            }
            s.root.position.set(x, groundHeight(x, z), z);
            var face = sq.side === "atk" ? Math.PI / 2 : -Math.PI / 2;
            if (!fallen && (turnBack || fleeing)) face = -face;
            s.root.rotation.y = face;
            s.root.visible = !(fleeing && !fallen && t > T_OUTCOME_END - 0.3);
          });
          sq.label.position.set(sq.x - sq.sign * 1.2, 4.2, sq.z);
          sq.label.material.opacity = t < T_CLASH ? 1 : t < T_MELEE_END ? 0.35 : 0.7;
          if (sq.lossLabel) {
            var k3 = seg(t, T_CLASH + 1.2, T_CLASH + 1.7);
            sq.lossLabel.position.set(sq.x, 3.2 + k3 * 1.2, sq.z + (sq.side === "atk" ? -1.6 : 1.6));
            sq.lossLabel.material.opacity = k3;
          }
        });
        // 塵煙與火花
        var fighting = lane.atk && lane.def && t > T_CLASH - 0.2 && t < T_MELEE_END + 0.3;
        lane.dust.forEach(function (d) {
          var ph = (t * 0.7 + d.seed * 3) % 1;
          d.sp.position.set((d.seed - 0.5) * 4, 0.6 + ph * 2.2, lane.z + Math.sin(d.seed * 20) * 1.6);
          var s2 = 1.6 + ph * 2.8;
          d.sp.scale.set(s2, s2, 1);
          d.sp.material.opacity = fighting ? (1 - ph) * 0.45 : 0;
        });
        lane.sparks.forEach(function (sp2) {
          var ph = (t * 2.3 + sp2.seed * 5) % 1;
          sp2.sp.position.set((sp2.seed - 0.5) * 2.4, 1.4 + sp2.seed, lane.z + (sp2.seed - 0.5) * 2);
          var s3 = 0.4 + (1 - ph) * 0.8;
          sp2.sp.scale.set(s3, s3, 1);
          sp2.sp.material.opacity = fighting && ph < 0.35 ? 1 - ph * 2.5 : 0;
        });
        if (lane.stamp && lane.stamp.squad) {
          var k4 = seg(t, T_CHARGE + 1.2, T_CHARGE + 1.6);
          lane.stamp.sp.position.set(lane.stamp.squad.x, 5.6, lane.stamp.squad.z);
          lane.stamp.sp.material.opacity = t > T_MELEE_END ? 0 : k4;
        }
      });

      // 箭矢
      arrows.forEach(function (a) {
        var k = (t - a.t0) / a.dur;
        if (k < 0 || k > 1 || !a.target) {
          a.mesh.visible = false;
          return;
        }
        a.mesh.visible = true;
        var x0 = a.sq.x;
        var x1 = a.target.x + a.dx;
        var x = lerp(x0, x1, k);
        var y = 1.6 + Math.sin(k * Math.PI) * 6;
        a.mesh.position.set(x, y, a.sq.z + a.dz * k);
        // 箭身沿 x 軸：先依速度方向仰角（rotation.z），往 -x 飛時再繞 y 轉半圈
        var vy = (Math.cos(k * Math.PI) * 6 * Math.PI) / a.dur;
        var vx = Math.abs(x1 - x0) / a.dur;
        a.mesh.rotation.z = Math.atan2(vy, vx);
        a.mesh.rotation.y = x1 > x0 ? 0 : Math.PI;
      });
      // 鐵砲
      muzzle.forEach(function (m2) {
        var k = t - m2.t0;
        var x = m2.sq.x + m2.sq.sign * 1.0;
        m2.flash.position.set(x, 1.2, m2.sq.z + m2.dz);
        m2.flash.scale.set(0.9, 0.9, 1);
        m2.flash.material.opacity = k > 0 && k < 0.12 ? 1 : 0;
        var ks = clamp(k / 1.4, 0, 1);
        m2.smoke.position.set(x + m2.sq.sign * ks * 0.8, 1.3 + ks * 1.2, m2.sq.z + m2.dz);
        var s4 = 0.6 + ks * 2.4;
        m2.smoke.scale.set(s4, s4, 1);
        m2.smoke.material.opacity = k > 0 && k < 1.4 ? (1 - ks) * 0.7 : 0;
      });
      // 城池火焰
      fires.forEach(function (f) {
        var on = t > T_MELEE_END + 0.8;
        var ph = (clock * (f.smoke ? 0.35 : 1.2) + f.seed * 4) % 1;
        // 火焰放在面向鏡頭（攻方）的一側，避免被天守擋住
        f.sp.position.set(cx - 4.5 + (f.seed - 0.5) * 3, cy + (f.smoke ? 8 + ph * 9 : 3 + f.seed * 5 + ph * 2), (f.seed - 0.5) * 7);
        var s5 = f.smoke ? 3 + ph * 4 : 1.5 + (1 - ph) * 1.5;
        f.sp.scale.set(s5, s5, 1);
        f.sp.material.opacity = on ? (f.smoke ? 0.55 * (1 - ph) : 0.9 * (1 - ph)) : 0;
      });
      // 雪
      if (snow) {
        var sp3 = snow.geometry.attributes.position;
        for (var i4 = 0; i4 < sp3.count; i4++) {
          var y2 = sp3.getY(i4) - 0.05;
          sp3.setY(i4, y2 < 0 ? 40 : y2);
        }
        sp3.needsUpdate = true;
      }

      // 階段字幕
      var phase;
      if (t < T_VOLLEY) phase = lb.phaseDeploy;
      else if (t < T_CHARGE) phase = lb.phaseVolley;
      else if (t < T_CLASH) phase = lb.phaseCharge;
      else if (t < T_MELEE_END) phase = lb.phaseMelee;
      else phase = outcome === "captured" ? lb.stampCaptured : outcome === "retreat" ? lb.stampRetreat : lb.stampRepelled;
      if (phaseEl.textContent !== phase) {
        phaseEl.textContent = phase || "";
        phaseEl.className = "rw-b3d-phase rw-b3d-phase-pop" + (t >= T_MELEE_END ? (opts.playerWon ? " rw-b3d-win" : " rw-b3d-lose") : "");
      }
    }

    // ---- 鏡頭 ----
    var orbit = { yaw: 0, pitch: 0, dragging: false, lx: 0, ly: 0 };
    var CAM_KEYS = [
      { t: 0, pos: [-46, 36, 50], look: [0, 0, 0] },
      { t: T_VOLLEY, pos: [-34, 22, 40], look: [0, 1, 0] },
      { t: T_CLASH, pos: [-18, 15, 32], look: [0, 1, 0] },
      { t: T_MELEE_END, pos: [-20, 17, 34], look: [2, 1, 0] },
      outcome === "captured" ? { t: T_OUTCOME_END, pos: [4, 18, 34], look: [26, 3, 0] } : { t: T_OUTCOME_END, pos: [-28, 18, 34], look: [-12, 1, 0] },
    ];
    var tmpLook = new THREE.Vector3();
    function updateCamera(t) {
      var a = CAM_KEYS[0];
      var b = CAM_KEYS[CAM_KEYS.length - 1];
      for (var i5 = 0; i5 < CAM_KEYS.length - 1; i5++) {
        if (t >= CAM_KEYS[i5].t && t <= CAM_KEYS[i5 + 1].t) {
          a = CAM_KEYS[i5];
          b = CAM_KEYS[i5 + 1];
          break;
        }
      }
      if (t > CAM_KEYS[CAM_KEYS.length - 1].t) a = b;
      var k = a === b ? 1 : smooth((t - a.t) / (b.t - a.t));
      var px = lerp(a.pos[0], b.pos[0], k);
      var py = lerp(a.pos[1], b.pos[1], k);
      var pz = lerp(a.pos[2], b.pos[2], k);
      tmpLook.set(lerp(a.look[0], b.look[0], k), lerp(a.look[1], b.look[1], k), lerp(a.look[2], b.look[2], k));
      // 拖曳：繞注視點旋轉
      var dx = px - tmpLook.x;
      var dz = pz - tmpLook.z;
      var dy = py - tmpLook.y;
      var rad = Math.sqrt(dx * dx + dz * dz);
      var ang = Math.atan2(dz, dx) + orbit.yaw;
      var elev = Math.atan2(dy, rad) + orbit.pitch;
      elev = clamp(elev, 0.12, 1.35);
      var dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      camera.position.set(tmpLook.x + Math.cos(ang) * Math.cos(elev) * dist, tmpLook.y + Math.sin(elev) * dist, tmpLook.z + Math.sin(ang) * Math.cos(elev) * dist);
      camera.lookAt(tmpLook);
    }
    var dom = renderer.domElement;
    dom.style.touchAction = "pan-y";
    dom.addEventListener("pointerdown", function (ev) {
      orbit.dragging = true;
      orbit.lx = ev.clientX;
      orbit.ly = ev.clientY;
      if (dom.setPointerCapture) dom.setPointerCapture(ev.pointerId);
    });
    dom.addEventListener("pointermove", function (ev) {
      if (!orbit.dragging) return;
      orbit.yaw += (ev.clientX - orbit.lx) * 0.006;
      orbit.pitch -= (ev.clientY - orbit.ly) * 0.004;
      orbit.lx = ev.clientX;
      orbit.ly = ev.clientY;
    });
    function stopDrag() {
      orbit.dragging = false;
    }
    dom.addEventListener("pointerup", stopDrag);
    dom.addEventListener("pointercancel", stopDrag);

    // ---- 尺寸 ----
    function resize() {
      var w2 = container.clientWidth || 640;
      var h2 = Math.round((w2 * 9) / 16);
      renderer.setSize(w2, h2, false);
      renderer.domElement.style.width = "100%";
      renderer.domElement.style.height = "auto";
      camera.aspect = w2 / h2;
      camera.updateProjectionMatrix();
    }
    resize();
    window.addEventListener("resize", resize);

    // ---- 控制列 ----
    var speed = 1;
    var time = opts.startAtEnd || reduced ? T_DONE : 0;
    var done = false;
    var disposed = false;
    function button(label, onClick, cls) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "rw-b3d-btn" + (cls ? " " + cls : "");
      b.textContent = label;
      b.addEventListener("click", onClick);
      controls.appendChild(b);
      return b;
    }
    var speedBtns = [1, 2, 4].map(function (sp4) {
      return button(sp4 + "×", function () {
        speed = sp4;
        speedBtns.forEach(function (bt, i6) {
          bt.classList.toggle("rw-b3d-on", [1, 2, 4][i6] === sp4);
        });
      }, sp4 === 1 ? "rw-b3d-on" : "");
    });
    var skipBtn = button(lb.skip || "⏭", function () {
      time = T_DONE;
    });
    var replayBtn = button(lb.replay || "↺", function () {
      time = 0;
      done = false;
      squads.forEach(function (sq) {
        sq.men.forEach(function (s) {
          s.deadX = undefined;
        });
      });
      replayBtn.style.display = "none";
      skipBtn.style.display = "";
    });
    replayBtn.style.display = "none";

    function finish() {
      if (done) return;
      done = true;
      setPlate(".rw-b3d-plate-atk", opts.attackerColor, opts.attackerName, (lb.troops || "") + " " + report.attackerRemainingTotal);
      setPlate(".rw-b3d-plate-def", opts.defenderColor, opts.defenderName, (lb.troops || "") + " " + report.defenderNodeRemainingTotal);
      skipBtn.style.display = "none";
      replayBtn.style.display = "";
      if (opts.onDone) opts.onDone();
    }

    var last = 0;
    function frame(now) {
      if (disposed) return;
      if (!container.isConnected) {
        dispose();
        return;
      }
      // 每幀最多推進 0.2 秒：低幀率裝置會跳格，但合戰時間軸不會被拖慢
      var dt = last ? Math.min(0.2, (now - last) / 1000) : 0;
      last = now;
      if (!done) time = Math.min(T_DONE, time + dt * speed);
      var tt = Math.min(time, T_DONE);
      update(tt, now / 1000);
      updateCamera(tt);
      renderer.render(scene, camera);
      if (!done && time >= T_DONE) finish();
      window.requestAnimationFrame(frame);
    }
    window.requestAnimationFrame(frame);

    function dispose() {
      if (disposed) return;
      disposed = true;
      window.removeEventListener("resize", resize);
      scene.traverse(function (o) {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          (Array.isArray(o.material) ? o.material : [o.material]).forEach(function (mm) {
            mm.dispose();
          });
        }
      });
      textures.forEach(function (tx) {
        tx.dispose();
      });
      renderer.dispose();
      if (renderer.forceContextLoss) renderer.forceContextLoss();
    }

    var ctrl = {
      dispose: dispose,
      skip: function () {
        time = T_DONE;
      },
      isDone: function () {
        return done;
      },
      // 測試用：跳到時間點並暫停（speed 0）
      seek: function (sec) {
        time = clamp(sec, 0, T_DONE);
        speed = 0;
      },
    };
    lastController = ctrl;
    return ctrl;
  }

  var lastController = null;

  window.PriTestReiwaBattle3D = {
    supported: supported,
    load: load,
    play: function (container, opts) {
      if (!THREE) throw new Error("call load() first");
      return play(container, opts);
    },
    // Playwright 驗證用：把目前的合戰跳到指定秒數並暫停
    _debugSeek: function (sec) {
      if (lastController) lastController.seek(sec);
    },
  };
})();
