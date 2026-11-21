/* イヌスノー（狗雪）3D 畫面（docs/inusnow_design.md §10、§17）：three.js r149，第一次用到時才載入 #inu-app[data-three-src]。
   只負責畫面；位置、方向都來自物理狀態或重播的 frame（[x, y, z, hx, hz, edge, crouch, air]）。
   第 2 階段：地形附加物（跳台、滑桿、箱子、波浪、護牆）、多位選手（CPU 幽靈、Cross 對手）、自由滑行的全雪場、
   特效（inusnow_fx.js：甩雪、落地噴雪、雪痕、降雪、旗門碎片、紙花、陰影、天空）、狗的技巧姿勢。 */
(function (root) {
  "use strict";

  var T = root.PriTestInusnowTerrain;
  var Core = root.PriTestInusnowCore;
  var D = root.PriTestInusnowData;
  var loading = null;

  function load() {
    if (root.THREE) return Promise.resolve(root.THREE);
    if (loading) return loading;
    var app = document.getElementById("inu-app"), src = app && app.getAttribute("data-three-src");
    loading = new Promise(function (resolve, reject) {
      if (!src) { reject(new Error("no three src")); return; }
      var s = document.createElement("script");
      s.src = src;
      s.onload = function () { resolve(root.THREE); };
      s.onerror = function () { loading = null; reject(new Error("three.js load failed")); };
      document.head.appendChild(s);
    });
    return loading;
  }

  function webglOk() {
    try {
      var c = document.createElement("canvas");
      return !!(root.WebGLRenderingContext && (c.getContext("webgl") || c.getContext("experimental-webgl")));
    } catch (e) { return false; }
  }

  var DIFF_COLOR = { novice: 0x3cb44b, easy: 0x3cb44b, intermediate: 0xd23c3c, advanced: 0x222222, expert: 0x222222, freeride: 0xe08a1e };
  var BOARD_COLORS = [0x2a6fd6, 0xe2453c, 0x27a35a, 0xf0a020, 0x8a4fd8, 0x1fb5c9, 0xe0569a, 0x5b6b7c];

  // 雪道遮罩：每個格點和最近雪道中心線的距離是否在寬度一半以內（光柵化＋擴張）
  function pisteMask(terrain) {
    var w = terrain.w, h = terrain.h, cell = terrain.cell;
    var mask = new Uint8Array(w * h);
    var list = terrain.json.pistes || [];
    list.forEach(function (p) {
      var r = Math.max(1, Math.round(p.width / 2 / cell));
      var pts = p.pts;
      for (var k = 0; k < pts.length - 1; k++) {
        var x0 = pts[k][0], z0 = pts[k][1], x1 = pts[k + 1][0], z1 = pts[k + 1][1];
        var n = Math.max(1, Math.ceil(Math.sqrt((x1 - x0) * (x1 - x0) + (z1 - z0) * (z1 - z0)) / (cell * 0.5)));
        for (var t = 0; t <= n; t++) {
          var ci = Math.round((x0 + (x1 - x0) * t / n) / cell), cj = Math.round((z0 + (z1 - z0) * t / n) / cell);
          for (var dj = -r; dj <= r; dj++) {
            for (var di = -r; di <= r; di++) {
              if (di * di + dj * dj > r * r) continue;
              var ii = ci + di, jj = cj + dj;
              if (ii >= 0 && ii < w && jj >= 0 && jj < h) mask[jj * w + ii] = 1;
            }
          }
        }
      }
    });
    return mask;
  }

  // 一塊地形網格：格點範圍 [i0, i1]×[j0, j1]，間距 step；skip(i, j) 為 true 的格子不畫。UV＝世界座標 ÷ 7（雪面細節貼圖）
  function terrainMesh(THREE, terrain, mask, i0, j0, i1, j1, step, drop, skip, mat) {
    var w = terrain.w, cell = terrain.cell, hs = terrain.hs;
    var nx = Math.floor((i1 - i0) / step) + 1, nz = Math.floor((j1 - j0) / step) + 1;
    var pos = new Float32Array(nx * nz * 3), col = new Float32Array(nx * nz * 3), uv = new Float32Array(nx * nz * 2);
    for (var b = 0; b < nz; b++) {
      for (var a = 0; a < nx; a++) {
        var i = i0 + a * step, j = j0 + b * step, k = (b * nx + a) * 3, q = (b * nx + a) * 2;
        var hgt = hs[j * w + i];
        pos[k] = i * cell; pos[k + 1] = hgt - drop; pos[k + 2] = j * cell;
        uv[q] = i * cell / 7; uv[q + 1] = j * cell / 7;
        var on = mask[j * w + i];
        // 雪道：白；雪道外：偏藍灰（新雪的陰影）。加一點由格點決定的明暗，讓起伏看得出來
        var nz2 = ((i * 73856093) ^ (j * 19349663)) >>> 0;
        var noise = ((nz2 % 1000) / 1000 - 0.5) * (on ? 0.03 : 0.07);
        var shade = (on ? 0.97 : 0.84) + noise;
        col[k] = shade * (on ? 0.985 : 0.9); col[k + 1] = shade * (on ? 0.995 : 0.95); col[k + 2] = Math.min(1, shade * (on ? 1.0 : 1.04));
      }
    }
    var idx = [];
    for (var bb = 0; bb < nz - 1; bb++) {
      for (var aa = 0; aa < nx - 1; aa++) {
        if (skip && skip(i0 + aa * step, j0 + bb * step, step)) continue;
        var p0 = bb * nx + aa, p1 = p0 + 1, p2 = p0 + nx, p3 = p2 + 1;
        idx.push(p0, p2, p1, p1, p2, p3);
      }
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx.length > 65535 * 3 ? new THREE.BufferAttribute(new Uint32Array(idx), 1) : idx);
    g.computeVertexNormals();
    return new THREE.Mesh(g, mat);
  }

  // ---------------- 狗＋雪板（設計 §5.1 外觀參數；可擺姿勢） ----------------
  function boardGeo(THREE) {
    var sh = new THREE.Shape(), hw = 0.17, hl = 0.75, r = 0.16;
    sh.moveTo(-hw, -hl + r);
    sh.quadraticCurveTo(-hw, -hl, 0, -hl - 0.02);
    sh.quadraticCurveTo(hw, -hl, hw, -hl + r);
    sh.lineTo(hw * 0.92, 0); sh.lineTo(hw, hl - r);
    sh.quadraticCurveTo(hw, hl, 0, hl + 0.02);
    sh.quadraticCurveTo(-hw, hl, -hw, hl - r);
    sh.lineTo(-hw * 0.92, 0); sh.lineTo(-hw, -hl + r);
    var g = new THREE.ExtrudeGeometry(sh, { depth: 0.035, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 1 });
    g.rotateX(Math.PI / 2);
    g.translate(0, 0.045, 0);
    return g;
  }

  function buildDog(THREE, breed, o) {
    o = o || {};
    var ghost = !!o.ghost;
    var L = breed.look, sc = L.size, fluff = L.fluff || 0;
    var grp = new THREE.Group();
    function mat(c, extra) {
      var m = new THREE.MeshLambertMaterial({ color: c });
      if (extra && extra.emissive) m.emissive = new THREE.Color(extra.emissive);
      if (ghost) { m.transparent = true; m.opacity = 0.36; m.depthWrite = false; }
      return m;
    }
    var m1 = mat(L.c1), m2 = mat(L.c2), mDark = mat(0x1d1d1d), mWhite = mat(0xffffff);
    var boardCol = ghost ? 0x88ccff : (o.board || BOARD_COLORS[0]);
    var look = o.look || {};
    var bindMat = mat(0x222831);
    if (look.ski) {
      // P5 雙板（設計 §20.10）：兩片細長的板、前端翹起、四隻腳的固定器
      [-0.11, 0.11].forEach(function (xx) {
        var sk = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.025, 1.45), mat(boardCol));
        sk.position.set(xx, 0.05, -0.05);
        grp.add(sk);
        var tip = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.025, 0.16), sk.material);
        tip.position.set(xx, 0.085, 0.72); tip.rotation.x = -0.6;
        grp.add(tip);
        var line = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.008, 1.2), mat(0xffffff));
        line.position.set(xx, 0.066, -0.05);
        grp.add(line);
        [-0.18, 0.18].forEach(function (zz) { var bd = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, 0.1), bindMat); bd.position.set(xx, 0.085, zz); grp.add(bd); });
      });
    } else {
      var board = new THREE.Mesh(boardGeo(THREE), mat(boardCol));
      grp.add(board);
      var stripe = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.012, 1.3), mat(0xffffff));
      stripe.position.set(0, 0.092, 0);
      grp.add(stripe);
      [-0.25, 0.25].forEach(function (zz) {
        var bd = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.05, 0.12), bindMat);
        bd.position.set(0, 0.11, zz);
        grp.add(bd);
      });
    }
    var dog = new THREE.Group();
    dog.scale.set(sc, sc, sc);
    var bodyLen = 0.55 * L.body, leg = 0.28 * L.leg;
    var body = new THREE.Group();
    body.position.y = leg + 0.17;
    dog.add(body);
    var torso = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 10), m1);
    torso.scale.set(0.9 + fluff * 0.12, 0.85 + fluff * 0.1, bodyLen / 0.4);
    body.add(torso);
    var belly = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), m2);
    belly.scale.set(0.9, 0.7, bodyLen / 0.36);
    belly.position.set(0, -0.07, 0.02);
    body.add(belly);
    var chest = new THREE.Mesh(new THREE.SphereGeometry(0.13 + fluff * 0.04, 10, 8), m2);
    chest.position.set(0, 0.02, bodyLen * 0.42);
    body.add(chest);
    if (fluff > 0.3) {
      for (var fz = 0; fz < 4; fz++) {
        var tuft = new THREE.Mesh(new THREE.SphereGeometry(0.09 * fluff + 0.03, 8, 6), fz % 2 ? m1 : m2);
        tuft.position.set((fz % 2 ? 1 : -1) * 0.14, 0.08, bodyLen * (0.3 - fz * 0.18));
        body.add(tuft);
      }
    }
    // P5 換裝：雪衣（背上的外套）
    if (look.coat && !ghost) {
      var coat = new THREE.Mesh(new THREE.SphereGeometry(0.212, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), mat(look.coat));
      coat.scale.set(0.92 + fluff * 0.12, 0.88 + fluff * 0.1, bodyLen / 0.4 * 0.86);
      coat.position.y = 0.01;
      body.add(coat);
      var trim = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.018, 4, 18), mat(0xffffff));
      trim.rotation.x = Math.PI / 2; trim.scale.set(0.92 + fluff * 0.12, bodyLen / 0.4 * 0.86, 1); trim.position.y = -0.04;
      body.add(trim);
    }
    // 圍巾（隊伍色）
    var scarf = new THREE.Mesh(new THREE.TorusGeometry(0.115, 0.035, 6, 14), mat(o.scarf || (ghost ? 0xaee0ff : 0xff5a3c)));
    scarf.rotation.x = Math.PI / 2 - 0.5;
    scarf.position.set(0, 0.11, bodyLen * 0.48);
    body.add(scarf);
    var tailEnd = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 0.02), scarf.material);
    tailEnd.position.set(0.09, 0.02, bodyLen * 0.42);
    tailEnd.rotation.z = -0.4;
    body.add(tailEnd);
    // 四肢（肩膀為支點）
    var legs = [];
    for (var i = 0; i < 4; i++) {
      var piv = new THREE.Group();
      var front = i < 2;
      piv.position.set(i % 2 ? 0.09 : -0.09, leg + 0.12, front ? bodyLen * 0.32 : -bodyLen * 0.32);
      var lg = new THREE.Mesh(new THREE.CylinderGeometry(0.045 + fluff * 0.01, 0.04, leg + 0.07, 7), front ? m1 : m2);
      lg.position.y = -(leg + 0.07) / 2;
      piv.add(lg);
      var paw = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), m2);
      paw.scale.set(1, 0.7, 1.25);
      paw.position.set(0, -(leg + 0.07), 0.02);
      piv.add(paw);
      // 狗靴
      var boot = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.055, 0.06, 7), mat(look.boots || 0x2b3440));
      boot.position.y = -(leg + 0.04);
      piv.add(boot);
      dog.add(piv);
      legs.push(piv);
    }
    // 頭
    var head = new THREE.Group();
    head.position.set(0, leg + 0.38, bodyLen * 0.55);
    var skull = new THREE.Mesh(new THREE.SphereGeometry(0.15, 14, 10), m1);
    skull.scale.set(1 + fluff * 0.1, 1, 1);
    head.add(skull);
    var cheek = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), m2);
    cheek.scale.set(1.2, 0.75, 0.9);
    cheek.position.set(0, -0.06, 0.06);
    head.add(cheek);
    var snout = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), m2);
    snout.scale.set(1, 0.85, 1.2 * L.snout);
    snout.position.set(0, -0.04, 0.13 * L.snout);
    head.add(snout);
    var nose = new THREE.Mesh(new THREE.SphereGeometry(0.028, 8, 6), mDark);
    nose.position.set(0, -0.015, 0.13 * L.snout + 0.09);
    head.add(nose);
    var mouth = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), mat(0xd9475c));
    mouth.scale.set(1, 0.35, 0.8);
    mouth.position.set(0, -0.085, 0.13 * L.snout + 0.04);
    mouth.visible = false;
    head.add(mouth);
    var ears = [];
    for (var e = 0; e < 2; e++) {
      var earPiv = new THREE.Group();
      var ear;
      if (L.ear === 0) {
        ear = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.14, 7), m1);
        ear.position.y = 0.06;
        earPiv.position.set(e ? 0.08 : -0.08, 0.1, -0.01);
      } else {
        ear = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), m1);
        ear.scale.set(0.45, 1.2, 0.9);
        ear.position.y = -0.07;
        earPiv.position.set(e ? 0.13 : -0.13, 0.04, -0.01);
      }
      earPiv.add(ear);
      head.add(earPiv);
      ears.push(earPiv);
      var eye = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 6), mDark);
      eye.position.set(e ? 0.06 : -0.06, 0.035, 0.125);
      head.add(eye);
    }
    // 雪鏡（鏡片＋鏡帶）
    var lens = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.065, 0.035), mat(look.goggle || 0xff9a1e, { emissive: 0x332211 }));
    lens.position.set(0, 0.045, 0.125);
    head.add(lens);
    // P5 換裝：毛帽（耳朵從帽子兩側露出）
    if (look.hat && !ghost) {
      var hm = mat(look.hat);
      var cap = new THREE.Mesh(new THREE.SphereGeometry(0.158, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.45), hm);
      cap.position.y = 0.03;
      head.add(cap);
      var rim = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.025, 6, 18), mat(0xffffff));
      rim.rotation.x = Math.PI / 2; rim.position.y = 0.06;
      head.add(rim);
      var pom = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), mat(0xffffff));
      pom.position.y = 0.2;
      head.add(pom);
    }
    var strap = new THREE.Mesh(new THREE.TorusGeometry(0.152, 0.012, 4, 18), mat(0x1c1c22));
    strap.rotation.y = Math.PI / 2; strap.rotation.z = Math.PI / 2;
    strap.position.set(0, 0.045, 0);
    head.add(strap);
    dog.add(head);
    // 尾巴
    var tailPiv = new THREE.Group();
    var tl = L.tail === 2 ? 0.07 : 0.24;
    var tail = new THREE.Mesh(new THREE.CylinderGeometry(0.035 + fluff * 0.03, 0.02, tl, 6), m1);
    tail.position.y = tl / 2;
    tailPiv.add(tail);
    if (L.tail === 0) { tailPiv.position.set(0, leg + 0.3, -bodyLen * 0.5); tailPiv.rotation.x = -0.5; }
    else { tailPiv.position.set(0, leg + 0.22, -bodyLen * 0.55); tailPiv.rotation.x = -2.2; }
    dog.add(tailPiv);
    grp.add(dog);
    grp.userData = { dog: dog, body: body, head: head, tail: tailPiv, tailBase: tailPiv.rotation.x, legs: legs, ears: ears, earL: L.ear, mouth: mouth, baseY: 0.02, sc: sc, leg: leg, bodyLen: bodyLen };
    return grp;
  }

  // 姿勢：p＝{crouch, edge, air, grab, bite, bark, shake, fall, zoom, speed, t}
  function pose(obj, p) {
    var u = obj.userData, t = p.t;
    var dog = u.dog, body = u.body, head = u.head, legs = u.legs;
    dog.scale.y = u.sc * (1 - 0.22 * p.crouch);
    body.rotation.set(0, 0, 0);
    head.rotation.set(0, 0, 0);
    dog.rotation.set(0, 0, 0);
    var legSwing = p.air ? 0.5 : 0;
    for (var i = 0; i < 4; i++) { legs[i].rotation.set(i < 2 ? -legSwing : legSwing, 0, 0); }
    // 速度越快耳朵越往後
    var earBack = Math.min(1, p.speed / 22) + (p.zoom ? 0.4 : 0);
    for (var e = 0; e < 2; e++) {
      if (u.earL === 0) u.ears[e].rotation.set(-0.6 * earBack, 0, (e ? -1 : 1) * 0.1);
      else u.ears[e].rotation.set(-0.9 * earBack + Math.sin(t * 9 + e) * 0.12 * (p.speed > 3 ? 1 : 0), 0, (e ? -1 : 1) * 0.25);
    }
    var wag = p.zoom ? 22 : 8 + p.speed * 0.4;
    u.tail.rotation.x = u.tailBase;
    u.tail.rotation.z = Math.sin(t * wag) * (p.zoom ? 0.9 : 0.5);
    u.mouth.visible = !!(p.bark || p.zoom);
    if (p.grab) {
      // 抓板：前腳伸向板子、身體前傾
      body.rotation.x = 0.45;
      legs[p.grab % 2].rotation.x = 1.2;
      legs[(p.grab + 1) % 2].rotation.x = 0.6;
      head.rotation.x = 0.35;
    }
    if (p.bite) {
      // 咬尾：頭轉向尾巴、身體捲起
      head.rotation.y = 2.3;
      body.rotation.y = 0.7;
      dog.rotation.y = 0.35;
      u.tail.rotation.z = 1.1;
    }
    if (p.bark) head.rotation.x = -0.6;
    if (p.shake) {
      // 甩雪：身體左右晃
      body.rotation.z = Math.sin(t * 40) * 0.45;
      head.rotation.z = Math.sin(t * 40 + 1) * 0.5;
    }
    if (p.fall) {
      dog.rotation.z = 1.25;
      dog.rotation.x = 0.3;
    }
  }

  // ---------------- 地形附加物的網格 ----------------
  function featureMeshes(THREE, tw, feats, group) {
    var snowMat = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true });
    feats.forEach(function (f) {
      if (f.k === "rail" || f.k === "box") {
        var len = f.len, dy = f.y1 - f.y0;
        var mid = new THREE.Vector3(f.x + f.tx * len / 2, (f.y0 + f.y1) / 2, f.z + f.tz * len / 2);
        var dir = new THREE.Vector3(f.tx * len, dy, f.tz * len);
        var q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
        var top;
        if (f.k === "rail") {
          top = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, dir.length(), 10), new THREE.MeshLambertMaterial({ color: 0xd8dde4, emissive: 0x23262b }));
          top.quaternion.copy(q);
          top.position.copy(mid);
        } else {
          top = new THREE.Mesh(new THREE.BoxGeometry(f.w, 0.1, dir.length()), new THREE.MeshLambertMaterial({ color: 0xff7a1a }));
          var q2 = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.clone().normalize());
          top.quaternion.copy(q2);
          top.position.copy(mid).add(new THREE.Vector3(0, -0.05, 0));
          var deck = new THREE.Mesh(new THREE.BoxGeometry(f.w * 0.94, 0.012, dir.length() * 0.98), new THREE.MeshLambertMaterial({ color: 0xffe2a8 }));
          deck.quaternion.copy(q2);
          deck.position.copy(mid).add(new THREE.Vector3(0, 0.002, 0));
          group.add(deck);
        }
        group.add(top);
        // 支柱
        for (var s = 0.6; s < len; s += 2.2) {
          var px = f.x + f.tx * s, pz = f.z + f.tz * s, gy = T.height(tw.base || tw, px, pz), ty = f.y0 + dy * s / len;
          var post = new THREE.Mesh(new THREE.BoxGeometry(0.08, ty - gy, 0.08), new THREE.MeshLambertMaterial({ color: 0x4a5563 }));
          post.position.set(px, (ty + gy) / 2 - 0.04, pz);
          group.add(post);
        }
        return;
      }
      // kicker／roller／bank／drop：在附加物的座標系裡取樣成網格
      var u0 = f.u0, u1 = f.u1, wM = f.k === "bank" ? f.d0 + f.dw + 4 : f.wMax;
      var w0 = f.k === "bank" ? (f.side > 0 ? f.d0 - 1 : -wM) : -wM, w1 = f.k === "bank" ? (f.side > 0 ? wM : -f.d0 + 1) : wM;
      if (f.k === "drop") u0 = -6;
      var du = f.k === "kicker" ? 0.5 : 1, dw = f.k === "bank" ? 1 : 0.5;
      var nu = Math.max(2, Math.ceil((u1 - u0) / du) + 1), nw = Math.max(2, Math.ceil((w1 - w0) / dw) + 1);
      var pos = new Float32Array(nu * nw * 3), col = new Float32Array(nu * nw * 3), idx = [];
      for (var a = 0; a < nu; a++) {
        var uu = u0 + (u1 - u0) * a / (nu - 1);
        for (var b = 0; b < nw; b++) {
          var ww = w0 + (w1 - w0) * b / (nw - 1);
          var x = f.x + f.tx * uu + (-f.tz) * ww, z = f.z + f.tz * uu + f.tx * ww;
          var off = T.offsetOf(f, uu, ww);
          var k = (a * nw + b) * 3;
          pos[k] = x; pos[k + 1] = T.height(tw, x, z) + (off > 0.01 ? 0.04 : -0.06); pos[k + 2] = z;
          var lip = f.k === "kicker" && !f.ramp && uu > -0.35 && off > 0.05;
          var c = lip ? [0.25, 0.55, 1] : f.ramp && off > 0.05 ? [1, 0.72, 0.45] : [0.96 - off * 0.03, 0.975 - off * 0.02, 1];
          col[k] = c[0]; col[k + 1] = c[1]; col[k + 2] = c[2];
        }
      }
      for (var a2 = 0; a2 < nu - 1; a2++) for (var b2 = 0; b2 < nw - 1; b2++) {
        var p0 = a2 * nw + b2, p1 = p0 + 1, p2 = p0 + nw, p3 = p2 + 1;
        idx.push(p0, p1, p2, p1, p3, p2);
      }
      var g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      g.setAttribute("color", new THREE.BufferAttribute(col, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      var mesh = new THREE.Mesh(g, snowMat);
      mesh.material.side = THREE.DoubleSide;
      group.add(mesh);
      // 跳台兩側的旗子
      if (f.k === "kicker" && !f.ramp) {
        [-1, 1].forEach(function (sd) {
          var fx = f.x + (-f.tz) * sd * (f.W / 2 + 0.8), fz = f.z + f.tx * sd * (f.W / 2 + 0.8);
          var pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.6, 5), new THREE.MeshLambertMaterial({ color: 0x333333 }));
          var fy = T.height(tw, fx, fz);
          pole.position.set(fx, fy + 1.3, fz);
          group.add(pole);
          var flag = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.45), new THREE.MeshLambertMaterial({ color: sd > 0 ? 0x1f8bff : 0xff4f6d, side: THREE.DoubleSide }));
          flag.position.set(fx + f.tx * 0.35, fy + 2.35, fz + f.tz * 0.35);
          flag.rotation.y = Math.atan2(f.tx, f.tz) + Math.PI / 2;
          flag.userData.wave = true;
          group.add(flag);
        });
      }
    });
  }

  function create(container, terrain, opts) {
    var THREE = root.THREE, FX = root.PriTestInusnowFx;
    var renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(root.devicePixelRatio || 1, 2));
    renderer.domElement.className = "inu-canvas";
    container.appendChild(renderer.domElement);
    var scene = new THREE.Scene();
    var fogCol = new THREE.Color(0xdde9f5);
    scene.background = fogCol;
    scene.fog = new THREE.Fog(fogCol, 280, 2600);
    var camera = new THREE.PerspectiveCamera(62, 1, 0.3, 9000);
    var hemi = new THREE.HemisphereLight(0xe6f1ff, 0x5f7088, 0.62);
    scene.add(hemi);
    var sun = new THREE.DirectionalLight(0xfff4e2, 0.85);
    sun.position.set(-0.5, 0.55, -0.65);
    scene.add(sun);
    var sky = FX.Sky(THREE, scene);
    var mode = opts.mode || "gs";
    var tw = opts.terrain || terrain;      // 有附加物時用包裝後的地形
    var pi = opts.piste ? T.piste(terrain, opts.piste) : null;
    var mask = pisteMask(terrain);
    var snowMap = FX.snowTex(THREE);
    var groundMat = new THREE.MeshLambertMaterial({ vertexColors: true, map: snowMap });
    if (opts.dream) groundMat.color.setHex(0xd2e6ff);      // P5 夢之雪（設計 §20.8）：雪面帶淡藍色
    var cell = terrain.cell;
    var ni0, nj0, ni1, nj1, minX, minZ, maxX, maxZ;
    if (pi) {
      minX = Infinity; minZ = Infinity; maxX = -Infinity; maxZ = -Infinity;
      pi.pts.forEach(function (p) { minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minZ = Math.min(minZ, p[1]); maxZ = Math.max(maxZ, p[1]); });
      var pad = 160;
      ni0 = Math.max(0, Math.floor((minX - pad) / cell)); nj0 = Math.max(0, Math.floor((minZ - pad) / cell));
      ni1 = Math.min(terrain.w - 1, Math.ceil((maxX + pad) / cell)); nj1 = Math.min(terrain.h - 1, Math.ceil((maxZ + pad) / cell));
      scene.add(terrainMesh(THREE, terrain, mask, ni0, nj0, ni1, nj1, 1, 0, null, groundMat));
      scene.add(terrainMesh(THREE, terrain, mask, 0, 0, terrain.w - 1 - ((terrain.w - 1) % 4), terrain.h - 1 - ((terrain.h - 1) % 4), 4, 0.6, function (i, j, st) {
        return i >= ni0 + 4 && i + st <= ni1 - 4 && j >= nj0 + 4 && j + st <= nj1 - 4;
      }, groundMat));
    } else {
      // 自由滑行：整個雪場用原解析度（太大時每 2 格）
      var stp = terrain.w * terrain.h > 260000 ? 2 : 1;
      var iw = terrain.w - 1 - ((terrain.w - 1) % stp), ih = terrain.h - 1 - ((terrain.h - 1) % stp);
      scene.add(terrainMesh(THREE, terrain, mask, 0, 0, iw, ih, stp, stp > 1 ? 0.15 : 0, null, groundMat));
      minX = 0; minZ = 0; maxX = terrain.sizeX; maxZ = terrain.sizeZ;
    }

    // 樹林：自由滑行用規則檔的清單（障礙）；其他賽事是景觀（seed 決定）
    var trees = [];
    if (opts.world) {
      opts.world.trees.list.forEach(function (tr) { trees.push([tr[0], T.height(terrain, tr[0], tr[1]), tr[1], tr[2]]); });
    } else {
      var rng = Core.makeRng(Core.hash("trees|" + terrain.id));
      for (var tries = 0; tries < 9000 && trees.length < 1800; tries++) {
        var tx = minX - 260 + rng() * (maxX - minX + 520), tz = minZ - 260 + rng() * (maxZ - minZ + 520);
        var ci = Math.round(tx / cell), cj = Math.round(tz / cell);
        if (ci < 1 || cj < 1 || ci >= terrain.w - 1 || cj >= terrain.h - 1) continue;
        var blocked = false;
        for (var dj = -1; dj <= 1 && !blocked; dj++) for (var di = -1; di <= 1; di++) if (mask[(cj + dj) * terrain.w + ci + di]) { blocked = true; break; }
        if (blocked) continue;
        trees.push([tx, T.height(terrain, tx, tz), tz, 0.7 + rng() * 0.7]);
      }
    }
    if (trees.length) {
      var parts = [
        [new THREE.ConeGeometry(2.3, 5.2, 8).translate(0, 3.2, 0), 0x2c5a3c],
        [new THREE.ConeGeometry(1.7, 4.2, 8).translate(0, 5.6, 0), 0x33684a],
        [new THREE.ConeGeometry(1.15, 2.2, 8).translate(0, 7.2, 0), 0xf4f8fc],
        [new THREE.CylinderGeometry(0.25, 0.32, 1.6, 6).translate(0, 0.8, 0), 0x5a4030],
      ];
      parts.forEach(function (pp) {
        var inst = new THREE.InstancedMesh(pp[0], new THREE.MeshLambertMaterial({ color: pp[1] }), trees.length);
        var mtx = new THREE.Matrix4();
        trees.forEach(function (t2, i) { mtx.makeScale(t2[3], t2[3] * (0.9 + (i % 5) * 0.06), t2[3]); mtx.setPosition(t2[0], t2[1] - 0.4, t2[2]); inst.setMatrixAt(i, mtx); });
        scene.add(inst);
      });
    }

    // 雪道邊的難度標示桿（比賽的雪道兩側，每 30 m）
    if (pi) {
      var poleGeo = new THREE.CylinderGeometry(0.06, 0.06, 1.6, 5);
      poleGeo.translate(0, 0.8, 0);
      var poles = [];
      for (var s = 0; s < pi.len; s += 30) {
        var a = T.at(pi, s);
        for (var sd = -1; sd <= 1; sd += 2) {
          var px = a.x + (-a.tz) * sd * (pi.width / 2 + 1.5), pz = a.z + a.tx * sd * (pi.width / 2 + 1.5);
          poles.push([px, T.height(terrain, px, pz), pz]);
        }
      }
      var poleMesh = new THREE.InstancedMesh(poleGeo, new THREE.MeshLambertMaterial({ color: DIFF_COLOR[pi.src.diff] || 0xd23c3c }), poles.length);
      var pm = new THREE.Matrix4();
      poles.forEach(function (p, i) { pm.makeTranslation(p[0], p[1], p[2]); poleMesh.setMatrixAt(i, pm); });
      scene.add(poleMesh);
      // Cross／Slopestyle：沿雪道的防護網（藍色）
      if (mode === "cross" || mode === "slope") {
        var netPts = [[], []];
        for (var s2 = 0; s2 < pi.len; s2 += 6) {
          var a2 = T.at(pi, s2);
          for (var k2 = 0; k2 < 2; k2++) {
            var sd2 = k2 ? 1 : -1, nx = a2.x + (-a2.tz) * sd2 * (pi.width / 2 + 2.5), nz = a2.z + a2.tx * sd2 * (pi.width / 2 + 2.5);
            netPts[k2].push(nx, tw === terrain ? T.height(terrain, nx, nz) : T.height(tw, nx, nz), nz);
          }
        }
        netPts.forEach(function (arr) {
          var n = arr.length / 3, pos = new Float32Array(n * 2 * 3), idx = [];
          for (var i = 0; i < n; i++) {
            pos[i * 6] = arr[i * 3]; pos[i * 6 + 1] = arr[i * 3 + 1]; pos[i * 6 + 2] = arr[i * 3 + 2];
            pos[i * 6 + 3] = arr[i * 3]; pos[i * 6 + 4] = arr[i * 3 + 1] + 1.1; pos[i * 6 + 5] = arr[i * 3 + 2];
            if (i < n - 1) { var q = i * 2; idx.push(q, q + 2, q + 1, q + 1, q + 2, q + 3); }
          }
          var g = new THREE.BufferGeometry();
          g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
          g.setIndex(idx);
          scene.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: mode === "cross" ? 0x1f6fff : 0xff7a1a, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false })));
        });
      }
    }

    // 地形附加物
    var featGroup = new THREE.Group();
    if (opts.feats && opts.feats.length) featureMeshes(THREE, tw, opts.feats, featGroup);
    scene.add(featGroup);

    // 旗門
    var gateGroup = new THREE.Group();
    var gateMats = [new THREE.MeshLambertMaterial({ color: 0xd8262b, side: THREE.DoubleSide }), new THREE.MeshLambertMaterial({ color: 0x1f5fd1, side: THREE.DoubleSide })];
    var gPoleGeo = new THREE.CylinderGeometry(0.04, 0.04, 1.9, 6);
    gPoleGeo.translate(0, 0.95, 0);
    var gateObjs = [];
    (opts.gates || []).forEach(function (g) {
      var grp = new THREE.Group();
      var m = gateMats[g.color];
      var hy = T.height(terrain, g.ix, g.iz), oy = T.height(terrain, g.ox, g.oz);
      var p1 = new THREE.Mesh(gPoleGeo, m); p1.position.set(g.ix, hy, g.iz); grp.add(p1);
      var p2 = new THREE.Mesh(gPoleGeo, m); p2.position.set(g.ox, oy, g.oz); grp.add(p2);
      [[g.ix, hy], [g.ox, oy]].forEach(function (q, qi) {
        var ox = (g.ox - g.ix) / D.GATES.width, oz = (g.oz - g.iz) / D.GATES.width;
        var dir = qi === 0 ? 1 : -1;
        var panel = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 0.55), m);
        var cx = (qi === 0 ? g.ix : g.ox) + ox * dir * 0.4, cz = (qi === 0 ? g.iz : g.oz) + oz * dir * 0.4;
        panel.position.set(cx, q[1] + 1.45, cz);
        panel.rotation.y = Math.atan2(ox, oz) + Math.PI / 2;
        panel.userData.wave = true;
        grp.add(panel);
      });
      grp.userData = { g: g, y: hy };
      gateGroup.add(grp);
      gateObjs.push(grp);
    });
    scene.add(gateGroup);

    // 出發小屋與終點拱門（帶字的看板）
    function arch(x, z, tx, tz, half, text, colors, h) {
      var rx = -tz, rz = tx, y = T.height(tw, x, z);
      var archMat = new THREE.MeshLambertMaterial({ color: colors[2] || 0xff7a1a });
      [-1, 1].forEach(function (sd) {
        var post = new THREE.Mesh(new THREE.BoxGeometry(0.6, h, 0.6), archMat);
        var ppx = x + rx * sd * half, ppz = z + rz * sd * half;
        post.position.set(ppx, T.height(tw, ppx, ppz) + h / 2, ppz);
        scene.add(post);
      });
      var banner = new THREE.Mesh(new THREE.BoxGeometry(half * 2 + 0.6, 1.3, 0.3), [archMat, archMat, archMat, archMat,
        new THREE.MeshBasicMaterial({ map: FX.bannerTex(THREE, text, colors) }), new THREE.MeshBasicMaterial({ map: FX.bannerTex(THREE, text, colors) })]);
      banner.position.set(x, y + h, z);
      banner.rotation.y = Math.atan2(rx, rz) - Math.PI / 2;
      scene.add(banner);
    }
    var f = opts.finish;
    if (f) arch(f.x, f.z, f.tx, f.tz, (pi ? pi.width : 30) / 2 + 2, "FINISH", ["#ff6a1a", "#ff2f6d", 0xff7a1a], 6);
    if (pi) {
      var st0 = T.at(pi, 2);
      arch(st0.x, st0.z, st0.tx, st0.tz, mode === "cross" ? 6.5 : 3.2, mode === "cross" ? "SNOWBOARD CROSS" : mode === "slope" ? "SLOPESTYLE" : "START", ["#1f6fff", "#22c3ff", 0x1f6fff], 3.6);
    }

    // 纜車：纜線＋塔＋站
    var liftMat = new THREE.LineBasicMaterial({ color: 0x333333 });
    var towerMat = new THREE.MeshLambertMaterial({ color: 0x7a828c });
    var stationMat = new THREE.MeshLambertMaterial({ color: 0x9b4a32 });
    (terrain.json.lifts || []).forEach(function (l) {
      var pts = [];
      for (var k = 0; k < l.pts.length - 1; k++) {
        var a0 = l.pts[k], b0 = l.pts[k + 1];
        var dl = Math.sqrt((b0[0] - a0[0]) * (b0[0] - a0[0]) + (b0[1] - a0[1]) * (b0[1] - a0[1]));
        var n = Math.max(1, Math.ceil(dl / 120));
        for (var t2 = 0; t2 < n; t2++) {
          var x = a0[0] + (b0[0] - a0[0]) * t2 / n, z = a0[1] + (b0[1] - a0[1]) * t2 / n, y = T.height(terrain, x, z);
          pts.push(new THREE.Vector3(x, y + 10, z));
          var tw2 = new THREE.Mesh(new THREE.BoxGeometry(0.5, 10, 0.5), towerMat);
          tw2.position.set(x, y + 5, z);
          scene.add(tw2);
        }
      }
      var last = l.pts[l.pts.length - 1];
      pts.push(new THREE.Vector3(last[0], T.height(terrain, last[0], last[1]) + 10, last[1]));
      scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), liftMat));
      [l.pts[0], last].forEach(function (e) {
        var stn = new THREE.Mesh(new THREE.BoxGeometry(6, 4, 6), stationMat);
        stn.position.set(e[0], T.height(terrain, e[0], e[1]) + 2, e[1]);
        scene.add(stn);
        var roof = new THREE.Mesh(new THREE.ConeGeometry(5, 2, 4), new THREE.MeshLambertMaterial({ color: 0xf2f6fa }));
        roof.position.set(e[0], T.height(terrain, e[0], e[1]) + 5, e[1]);
        roof.rotation.y = Math.PI / 4;
        scene.add(roof);
      });
    });

    // 自由滑行：骨頭、隱藏地點、纜車山腳站的光圈
    var boneObjs = {}, spotObjs = {}, liftRings = [];
    if (opts.world) {
      var boneMat = new THREE.MeshLambertMaterial({ color: 0xfff6dc, emissive: 0x6b5a20 });
      opts.world.bones.forEach(function (b) {
        var g = new THREE.Group();
        var shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.6, 8), boneMat);
        shaft.rotation.z = Math.PI / 2;
        g.add(shaft);
        [-1, 1].forEach(function (sd) { [-1, 1].forEach(function (s2) { var k = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), boneMat); k.position.set(sd * 0.32, s2 * 0.08, 0); g.add(k); }); });
        g.position.set(b.x, T.height(terrain, b.x, b.z) + 0.9, b.z);
        g.visible = !(opts.got && opts.got.bones && opts.got.bones.indexOf(b.id) >= 0);
        scene.add(g);
        boneObjs[b.id] = g;
      });
      opts.world.spots.forEach(function (sp) {
        var col = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.6, 40, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false }));
        col.position.set(sp.x, T.height(terrain, sp.x, sp.z) + 20, sp.z);
        col.visible = !(opts.got && opts.got.spots && opts.got.spots.indexOf(sp.id) >= 0);
        scene.add(col);
        spotObjs[sp.id] = col;
      });
      opts.world.lifts.forEach(function (lf) {
        var ring = new THREE.Mesh(new THREE.RingGeometry(D.FREE.liftR - 1.2, D.FREE.liftR, 40), new THREE.MeshBasicMaterial({ color: 0x29b6ff, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }));
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(lf.bottom[0], T.height(terrain, lf.bottom[0], lf.bottom[1]) + 0.3, lf.bottom[1]);
        scene.add(ring);
        liftRings.push(ring);
      });
    }

    // ---------------- 選手 ----------------
    var shadowMap = FX.shadowTex(THREE);
    function makeRider(breed, o) {
      var obj = buildDog(THREE, breed, o);
      scene.add(obj);
      var sh = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.9), new THREE.MeshBasicMaterial({ map: shadowMap, transparent: true, depthWrite: false, opacity: o.ghost ? 0.4 : 1 }));
      sh.rotation.x = -Math.PI / 2;
      scene.add(sh);
      var tag = null;
      if (o.name) { tag = FX.nameTag(THREE, o.name, o.tagColor); scene.add(tag); }
      return { obj: obj, shadow: sh, tag: tag, trail: o.trail ? FX.Trail(THREE, scene, 260, o.ghost ? 0xbfd3ea : 0x8ea7c8) : null, prevAir: 0, prev: null, spd: 0, ghost: !!o.ghost };
    }
    var player = makeRider(opts.breed, { board: opts.board || BOARD_COLORS[0], scarf: opts.scarf, trail: true, look: opts.look || null });
    var others = (opts.others || []).map(function (o, i) {
      return makeRider(o.breed, { ghost: o.ghost, board: BOARD_COLORS[(i + 1) % BOARD_COLORS.length], scarf: o.scarf, name: o.name, tagColor: o.tagColor, trail: !o.ghost });
    });
    // 第 1 階段相容：ghostBreed
    if (opts.ghostBreed) others.push(makeRider(opts.ghostBreed, { ghost: true }));

    // G1 溝痕：先出發的 CPU 軌跡畫成雪面上的灰色線
    (opts.ruts || []).forEach(function (frames) {
      var tr = FX.Trail(THREE, scene, 2600, 0x7f93ad, true), list = [];
      for (var i = 0; i < frames.length; i += 5) {
        var f2 = frames[i];
        // 空中段：透明度 0，讓跳台前後不會連成一條線
        list.push([f2[0], f2[1] + 0.03, f2[2], -f2[4], f2[3], 0.12, f2[7] ? 0 : 0.3]);
      }
      tr.bulk(list);
    });

    // ---------------- P3：嗅覺捷徑（樹＋腳印）、救難犬的被埋者、雪崩前緣、夜間照明 ----------------
    var footGroup = new THREE.Group();
    footGroup.visible = false;
    scene.add(footGroup);
    (opts.cuts || []).forEach(function (c) {
      if (c.trees && c.trees.length) {
        var tg = new THREE.ConeGeometry(2.0, 6.5, 7).translate(0, 3.6, 0);
        var ti = new THREE.InstancedMesh(tg, new THREE.MeshLambertMaterial({ color: 0x2a5236 }), c.trees.length);
        var m4 = new THREE.Matrix4();
        c.trees.forEach(function (tr, i) { m4.makeScale(tr[2], tr[2], tr[2]); m4.setPosition(tr[0], T.height(terrain, tr[0], tr[1]) - 0.3, tr[1]); ti.setMatrixAt(i, m4); });
        scene.add(ti);
      }
      // 腳印：嗅覺量表滿了才顯示 10 秒
      var dx = c.bx - c.ax, dz = c.bz - c.az, len = Math.sqrt(dx * dx + dz * dz), tx = dx / len, tz = dz / len;
      var pawMat = new THREE.MeshBasicMaterial({ color: 0xffb02e, transparent: true, opacity: 0.85, depthWrite: false });
      for (var u = 2, sd = 1; u < len; u += 1.6, sd = -sd) {
        var px = c.ax + tx * u + (-tz) * sd * 0.25, pz = c.az + tz * u + tx * sd * 0.25;
        var paw = new THREE.Mesh(new THREE.CircleGeometry(0.16, 8), pawMat);
        paw.rotation.x = -Math.PI / 2;
        paw.position.set(px, T.height(tw, px, pz) + 0.05, pz);
        footGroup.add(paw);
      }
    });
    var victimObjs = [];
    (opts.victims || []).forEach(function (v) {
      var g = new THREE.Group();
      var mound = new THREE.Mesh(new THREE.SphereGeometry(1.1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0xf2f7fc }));
      mound.scale.y = 0.45;
      g.add(mound);
      var pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.4, 5), new THREE.MeshLambertMaterial({ color: 0x333333 }));
      pole.position.set(0.4, 0.5, 0); pole.rotation.z = 0.35;
      g.add(pole);
      var flag = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.35), new THREE.MeshLambertMaterial({ color: 0x2ecc71, side: THREE.DoubleSide }));
      flag.position.set(0.55, 1.2, 0); flag.visible = false;
      g.add(flag);
      g.position.set(v.x, T.height(terrain, v.x, v.z) - 0.1, v.z);
      scene.add(g);
      victimObjs.push({ g: g, flag: flag });
    });
    var avWall = null;
    if (opts.avalanche && pi) {
      avWall = new THREE.Mesh(new THREE.BoxGeometry(pi.width + 60, 14, 6), new THREE.MeshLambertMaterial({ color: 0xf4f8fc, transparent: true, opacity: 0.88 }));
      scene.add(avWall);
    }
    var lamps = null;
    if (pi) {
      lamps = new THREE.Group();
      var lampMat = new THREE.MeshBasicMaterial({ color: 0xfff2c0 });
      var glowMat = new THREE.SpriteMaterial({ map: FX.dotTex(THREE), color: 0xffe7a0, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
      for (var ls = 0; ls < pi.len; ls += D.ENV.lampEvery) {
        var la = T.at(pi, ls);
        for (var lsd = -1; lsd <= 1; lsd += 2) {
          var lx = la.x + (-la.tz) * lsd * (pi.width / 2 + 3), lz = la.z + la.tx * lsd * (pi.width / 2 + 3), ly = T.height(terrain, lx, lz);
          var post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 7, 5), new THREE.MeshLambertMaterial({ color: 0x555b63 }));
          post.position.set(lx, ly + 3.5, lz); lamps.add(post);
          var bulb = new THREE.Mesh(new THREE.SphereGeometry(0.25, 6, 4), lampMat); bulb.position.set(lx, ly + 7, lz); lamps.add(bulb);
          var glow = new THREE.Sprite(glowMat); glow.scale.set(5, 5, 1); glow.position.set(lx, ly + 7, lz); lamps.add(glow);
        }
      }
      lamps.visible = false;
      scene.add(lamps);
    }
    // 天氣：霧的距離、降雪量、夜間（設計 §18.3）；換天氣時 5 秒內漸變
    var wx = { cur: null, from: null, to: null, t: 1, night: false };
    function wxParams(key, night) {
      var W = D.WEATHER[key] || D.WEATHER.clear, fm = opts.fogMul || 1;      // P5 雪鏡：霧的距離倍率
      var far = W.fog ? W.fog * fm : 2600, near = W.fog ? Math.max(5, W.fog * fm * 0.15) : 280;
      return { near: near, far: far, flakes: W.flakes, col: night ? [0.05, 0.08, 0.16] : W.fog && W.fog < 500 ? [0.86, 0.89, 0.93] : [0.87, 0.91, 0.96], night: night };
    }
    function applyWx(p) {
      scene.fog.near = p.near; scene.fog.far = p.far;
      scene.fog.color.setRGB(p.col[0], p.col[1], p.col[2]);
      scene.background = scene.fog.color;
      snowDensity = p.flakes;
      sky.mesh.visible = p.far > 600 && !p.night;
      hemi.intensity = p.night ? 0.32 : 0.62; sun.intensity = p.night ? 0.25 : 0.85;
      hemi.color.setHex(p.night ? 0x8fa6d8 : 0xe6f1ff);
      if (lamps) lamps.visible = p.night;
    }
    function setWeather(key, night, fade) {
      var to = wxParams(key, night);
      if (!wx.cur || !fade) { wx.cur = to; wx.t = 1; applyWx(to); return; }
      wx.from = wx.cur; wx.to = to; wx.t = 0; wx.fade = fade;
    }
    function stepWx(dt) {
      if (wx.t >= 1 || !wx.to) return;
      wx.t = Math.min(1, wx.t + dt / wx.fade);
      var a = wx.from, b = wx.to, k = wx.t;
      var p = { near: a.near + (b.near - a.near) * k, far: a.far + (b.far - a.far) * k, flakes: a.flakes + (b.flakes - a.flakes) * k,
        col: [a.col[0] + (b.col[0] - a.col[0]) * k, a.col[1] + (b.col[1] - a.col[1]) * k, a.col[2] + (b.col[2] - a.col[2]) * k], night: b.night };
      applyWx(p);
      if (wx.t >= 1) wx.cur = b;
    }

    var particles = FX.Particles(THREE, scene, 1800);
    var snowfall = FX.Snowfall(THREE, scene, 900, 70);
    var snowDensity = opts.snow === undefined ? 0.6 : opts.snow;
    setWeather(opts.weather ? opts.weather.weather : "clear", !!(opts.weather && opts.weather.night), 0);
    if (!opts.weather) snowDensity = 0.6;

    var up = new THREE.Vector3(0, 1, 0), nrm = new THREE.Vector3(), qTilt = new THREE.Quaternion(), qYaw = new THREE.Quaternion(), qLean = new THREE.Quaternion(), qSpin = new THREE.Quaternion();
    var fwd = new THREE.Vector3(0, 0, 1);
    var clock = 0;

    function place(r, fr, p, dt) {
      var obj = r.obj;
      var n = T.normal(tw, fr[0], fr[2]);
      nrm.set(n[0], n[1], n[2]);
      if (fr[7]) nrm.set(0, 1, 0);
      qTilt.setFromUnitVectors(up, nrm);
      qYaw.setFromAxisAngle(up, Math.atan2(fr[3], fr[4]));
      qLean.setFromAxisAngle(fwd, -fr[5] * 0.55);
      obj.quaternion.copy(qTilt).multiply(qYaw).multiply(qLean);
      if (p.fall) { qSpin.setFromAxisAngle(fwd, Math.sin(clock * 6) * 0.25); obj.quaternion.multiply(qSpin); }
      obj.position.set(fr[0], fr[1] + obj.userData.baseY, fr[2]);
      pose(obj, p);
      var gy = T.height(tw, fr[0], fr[2]);
      var hgt = fr[1] - gy;
      r.shadow.position.set(fr[0], gy + 0.05, fr[2]);
      r.shadow.rotation.z = -Math.atan2(fr[3], fr[4]);
      var ss = Math.max(0.35, 1 - hgt * 0.12);
      r.shadow.scale.set(ss, ss, 1);
      r.shadow.material.opacity = (r.ghost ? 0.4 : 1) * Math.max(0.2, 1 - hgt * 0.15);
      if (r.tag) r.tag.position.set(fr[0], fr[1] + 1.9 * obj.userData.sc, fr[2]);
      if (r.trail) r.trail.add(fr[0], fr[1], fr[2], fr[3], fr[4], 0.08 + Math.abs(fr[5]) * 0.1, !fr[7]);
    }

    // 甩雪：板子尾端、邊刃那一側
    function spray(r, fr, speed, edge, crouch, skid) {
      if (fr[7] || speed < 3) return;
      var amount = (Math.abs(edge) * 0.9 + (skid ? 1.2 : 0)) * Math.min(1, speed / 18);
      var n = Math.floor(amount * 4 + Math.random());
      var hx = fr[3], hz = fr[4], rx = -hz, rz = hx, sd = edge > 0 ? -1 : 1;
      for (var i = 0; i < n; i++) {
        var bx = fr[0] - hx * (0.3 + Math.random() * 0.4) + rx * sd * 0.18, bz = fr[2] - hz * (0.3 + Math.random() * 0.4) + rz * sd * 0.18;
        var sp = speed * (0.12 + Math.random() * 0.18);
        particles.emit({ x: bx, y: fr[1] + 0.08, z: bz, vx: rx * sd * sp + (Math.random() - 0.5) * 1.5 - hx * speed * 0.1, vy: 1.2 + Math.random() * 2.2, vz: rz * sd * sp + (Math.random() - 0.5) * 1.5 - hz * speed * 0.1,
          life: 0.5 + Math.random() * 0.5, size: 0.12 + Math.random() * 0.16, r: 1, g: 1, b: 1, a: 0.9, grav: 0.6, grow: 1.5 });
      }
    }
    function burst(x, y, z, count, opt) {
      opt = opt || {};
      for (var i = 0; i < count; i++) {
        var ang = Math.random() * Math.PI * 2, sp = (opt.speed || 4) * (0.4 + Math.random() * 0.8);
        var c = opt.colors ? opt.colors[i % opt.colors.length] : [1, 1, 1];
        particles.emit({ x: x, y: y + (opt.dy || 0.1), z: z, vx: Math.cos(ang) * sp, vy: (opt.up || 2.5) * (0.5 + Math.random()), vz: Math.sin(ang) * sp,
          life: (opt.life || 0.8) * (0.6 + Math.random() * 0.6), size: (opt.size || 0.2) * (0.6 + Math.random() * 0.8), r: c[0], g: c[1], b: c[2], a: opt.a || 0.95, grav: opt.grav === undefined ? 0.7 : opt.grav, grow: opt.grow || 0.8 });
      }
    }

    // ---------------- 鏡頭 ----------------
    var camMode = opts.camera || "chase";
    var camPos = new THREE.Vector3(), camLook = new THREE.Vector3(), smDir = [0, 1], camInit = false;
    var trauma = 0, fov = 62;
    var tvCams = [];
    if (pi) {
      for (var cs = 60; cs < pi.len; cs += 140) {
        var ca = T.at(pi, cs), sd3 = (tvCams.length % 2) ? 1 : -1;
        var cx2 = ca.x + (-ca.tz) * sd3 * (pi.width / 2 + 18), cz2 = ca.z + ca.tx * sd3 * (pi.width / 2 + 18);
        tvCams.push({ s: cs, p: new THREE.Vector3(cx2, T.height(terrain, cx2, cz2) + 7, cz2) });
      }
    }
    function updateCamera(fr, vel, dt, speed) {
      var vx = vel ? vel[0] : fr[3], vz = vel ? vel[2] : fr[4], vl = Math.sqrt(vx * vx + vz * vz);
      if (vl > 0.5) {
        var k = Math.min(1, dt * 3);
        smDir[0] += (vx / vl - smDir[0]) * k; smDir[1] += (vz / vl - smDir[1]) * k;
        var sl = Math.sqrt(smDir[0] * smDir[0] + smDir[1] * smDir[1]) || 1;
        smDir[0] /= sl; smDir[1] /= sl;
      }
      var tgt = new THREE.Vector3(), look = new THREE.Vector3(fr[0] + smDir[0] * 2.5, fr[1] + 0.5, fr[2] + smDir[1] * 2.5);
      var m = camMode;
      if (m === "tv" && !tvCams.length) m = "chase";
      if (m === "pov") {
        tgt.set(fr[0], fr[1] + 1.0, fr[2]);
        look.set(fr[0] + smDir[0] * 10, T.height(tw, fr[0] + smDir[0] * 10, fr[2] + smDir[1] * 10) + 0.5, fr[2] + smDir[1] * 10);
        camPos.copy(tgt); camLook.copy(look);
      } else if (m === "tv") {
        var nr = T.nearest(pi, fr[0], fr[2]), best = tvCams[0];
        for (var i = 0; i < tvCams.length; i++) if (tvCams[i].s <= nr.s + 70) best = tvCams[i];
        camPos.lerp(best.p, camInit ? Math.min(1, dt * 2) : 1); camLook.lerp(look, camInit ? Math.min(1, dt * 8) : 1);
      } else {
        var back = m === "air" ? 26 : 4.4 + Math.min(1.6, speed * 0.05), high = m === "air" ? 30 : 1.8 + (fr[7] ? 0.6 : 0);
        var bx = fr[0] - smDir[0] * back, bz = fr[2] - smDir[1] * back;
        var gy = T.height(tw, bx, bz);
        tgt.set(bx, Math.max(gy + 1.2, fr[1] + high), bz);
        camPos.lerp(tgt, camInit ? Math.min(1, dt * 6) : 1);
        camLook.lerp(look, camInit ? Math.min(1, dt * 10) : 1);
      }
      camInit = true;
      camera.position.copy(camPos);
      if (trauma > 0) {
        var s2 = trauma * trauma * 0.35;
        camera.position.x += (Math.random() - 0.5) * s2; camera.position.y += (Math.random() - 0.5) * s2; camera.position.z += (Math.random() - 0.5) * s2;
        trauma = Math.max(0, trauma - dt * 1.8);
      }
      camera.lookAt(camLook);
      // 速度越快視角越廣
      var targetFov = 62 + Math.min(16, speed * 0.32) + (m === "pov" ? 8 : 0);
      fov += (targetFov - fov) * Math.min(1, dt * 3);
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }

    function resize() {
      var w = container.clientWidth || root.innerWidth, h = container.clientHeight || root.innerHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    resize();

    var waving = [];
    scene.traverse(function (o) { if (o.userData && o.userData.wave) waving.push(o); });

    // 每個選手的影格：速度、空中→落地
    function riderFx(r, fr, dt, info) {
      if (r.prev) {
        var dx = fr[0] - r.prev[0], dy = fr[1] - r.prev[1], dz = fr[2] - r.prev[2];
        var sp = Math.sqrt(dx * dx + dy * dy + dz * dz) / Math.max(dt, 1e-3);
        r.spd += (sp - r.spd) * Math.min(1, dt * 8);
      }
      if (!r.ghost) {
        spray(r, fr, info && info.speed !== undefined ? info.speed : r.spd, fr[5], fr[6], info && info.skid);
        if (r.prevAir && !fr[7]) burst(fr[0], fr[1], fr[2], 26, { speed: 3.5, up: 2.2, size: 0.22 });
      }
      r.prevAir = fr[7];
      r.prev = fr.slice();
    }

    return {
      // fr＝玩家 frame；vel＝速度（鏡頭用）；oth＝其他選手的 frame 陣列（沒有就 null）；info＝玩家狀態（姿勢與特效）
      render: function (fr, vel, oth, dt, info) {
        dt = dt || 1 / 60;
        clock += dt;
        info = info || {};
        var speed = vel ? Math.sqrt(vel[0] * vel[0] + vel[1] * vel[1] + vel[2] * vel[2]) : player.spd;
        info.speed = speed;
        place(player, fr, { crouch: fr[6], edge: fr[5], air: fr[7], grab: info.grab, bite: info.bite, bark: info.bark, shake: info.shake, fall: info.fall, zoom: info.zoom, speed: speed, t: clock }, dt);
        riderFx(player, fr, dt, info);
        if (info.zoom && speed > 2) {
          for (var z = 0; z < 2; z++) particles.emit({ x: fr[0] + (Math.random() - 0.5) * 0.6, y: fr[1] + 0.4 + Math.random() * 0.5, z: fr[2] + (Math.random() - 0.5) * 0.6, vx: -vel[0] * 0.15, vy: 0.6, vz: -vel[2] * 0.15, life: 0.6, size: 0.16, r: 1, g: 0.85, b: 0.25, a: 1, grav: -0.2, grow: -0.5 });
        }
        if (Array.isArray(oth)) {
          for (var i = 0; i < others.length; i++) {
            var o = oth[i], r = others[i];
            r.obj.visible = r.shadow.visible = !!o;
            if (r.tag) r.tag.visible = !!o;
            if (!o) continue;
            var oi = (info.others && info.others[i]) || {};
            place(r, o, { crouch: o[6], edge: o[5], air: o[7], speed: r.spd, t: clock + i, fall: oi.fall, zoom: oi.zoom }, dt);
            riderFx(r, o, dt, oi);
          }
        } else if (others.length) {
          // 第 1 階段相容：oth 是一個幽靈 frame
          var gr = others[others.length - 1];
          gr.obj.visible = gr.shadow.visible = !!oth;
          if (oth) place(gr, oth, { crouch: oth[6], edge: oth[5], air: oth[7], speed: gr.spd, t: clock }, dt);
        }
        for (var w = 0; w < waving.length; w++) waving[w].rotation.x = Math.sin(clock * 5 + w) * 0.18;
        for (var b in boneObjs) if (boneObjs[b].visible) { boneObjs[b].rotation.y = clock * 1.8; boneObjs[b].position.y += Math.sin(clock * 3 + (+b)) * 0.004; }
        for (var lr = 0; lr < liftRings.length; lr++) liftRings[lr].material.opacity = 0.25 + Math.sin(clock * 3) * 0.12;
        footGroup.visible = !!info.scent;
        stepWx(dt);
        if (avWall && info.front !== undefined) {
          var fa = T.at(pi, Math.max(0, info.front));
          avWall.position.set(fa.x, T.height(terrain, fa.x, fa.z) + 4, fa.z);
          avWall.rotation.y = Math.atan2(fa.tx, fa.tz);
          for (var ap = 0; ap < 6; ap++) particles.emit({ x: fa.x + (-fa.tz) * (Math.random() - 0.5) * (pi.width + 50), y: T.height(terrain, fa.x, fa.z) + Math.random() * 10, z: fa.z + fa.tx * (Math.random() - 0.5) * (pi.width + 50), vx: fa.tx * 8, vy: 3 + Math.random() * 4, vz: fa.tz * 8, life: 1.6, size: 1.2 + Math.random(), r: 1, g: 1, b: 1, a: 0.8, grav: 0.2, grow: 1.5 });
          var fdx = fa.x - fr[0], fdz = fa.z - fr[2];
          if (fdx * fdx + fdz * fdz < 3600) trauma = Math.min(1, trauma + dt * 1.5);
        }
        if (info.victims) info.victims.forEach(function (v, i) { if (victimObjs[i]) victimObjs[i].flag.visible = v.found; });
        updateCamera(fr, vel, dt, speed);
        sky.follow(camera);
        particles.update(dt, renderer.domElement.height);
        snowfall.update(dt, camera.position.x, camera.position.y, camera.position.z, snowDensity);
        renderer.render(scene, camera);
      },
      // 已通過的旗門：碎片飛散後消失
      gatePassed: function (n, perfect) {
        var g = gateObjs[n];
        if (!g || !g.visible) return;
        var gg = g.userData.g;
        var col = perfect ? [[1, 0.85, 0.2], [1, 1, 0.6], [1, 0.6, 0.1]] : gg.color ? [[0.2, 0.45, 1], [0.6, 0.8, 1]] : [[1, 0.25, 0.25], [1, 0.7, 0.7]];
        burst(gg.ix, g.userData.y + 1.2, gg.iz, perfect ? 60 : 24, { colors: col, speed: perfect ? 6 : 3.5, up: 3, size: perfect ? 0.26 : 0.2, life: 1, grav: 0.5 });
        if (perfect) trauma = Math.min(1, trauma + 0.25);
        g.visible = false;
      },
      resetGates: function () { gateObjs.forEach(function (g) { g.visible = true; }); player.trail && player.trail.reset(); },
      // 一次性的特效：land／sketchy／fall／finish／trick／bone／spot／zoom／bump
      fx: function (kind, at) {
        var x = at ? at[0] : player.obj.position.x, y = at ? at[1] : player.obj.position.y, z = at ? at[2] : player.obj.position.z;
        if (kind === "sketchy") { burst(x, y, z, 40, { speed: 4.5, up: 2.5 }); trauma = Math.min(1, trauma + 0.35); }
        else if (kind === "fall" || kind === "tree") { burst(x, y, z, 80, { speed: 5.5, up: 3.5, size: 0.3 }); trauma = Math.min(1, trauma + 0.7); }
        else if (kind === "land") { trauma = Math.min(1, trauma + 0.15); }
        else if (kind === "bump") { burst(x, y + 0.3, z, 18, { speed: 3, up: 1.5, colors: [[1, 1, 1], [0.8, 0.9, 1]] }); trauma = Math.min(1, trauma + 0.3); }
        else if (kind === "trick") { burst(x, y + 0.6, z, 40, { colors: [[1, 0.85, 0.25], [0.4, 0.9, 1], [1, 0.45, 0.7]], speed: 4, up: 2.5, grav: 0.3, life: 1.1 }); }
        else if (kind === "zoom") { burst(x, y + 0.5, z, 50, { colors: [[1, 0.8, 0.2], [1, 0.95, 0.5]], speed: 5, up: 2, grav: -0.1 }); trauma = Math.min(1, trauma + 0.2); }
        else if (kind === "finish") {
          var cols = [[1, 0.3, 0.35], [1, 0.8, 0.2], [0.25, 0.7, 1], [0.4, 0.9, 0.45], [0.85, 0.45, 1]];
          for (var k = 0; k < 4; k++) burst(x + (Math.random() - 0.5) * 6, y + 4 + Math.random() * 2, z + (Math.random() - 0.5) * 6, 70, { colors: cols, speed: 7, up: 4, grav: 0.25, life: 2.2, size: 0.25, grow: 0 });
        }
        else if (kind === "bone") {
          burst(x, y + 0.8, z, 40, { colors: [[1, 0.95, 0.7], [1, 0.8, 0.3]], speed: 3, up: 3, grav: 0.2 });
          if (at && at.id !== undefined && boneObjs[at.id]) boneObjs[at.id].visible = false;
        }
        else if (kind === "spot") {
          burst(x, y + 1, z, 90, { colors: [[1, 0.9, 0.3], [1, 1, 1]], speed: 6, up: 5, grav: 0.2, life: 1.8 });
          if (at && at.id !== undefined && spotObjs[at.id]) spotObjs[at.id].visible = false;
        }
      },
      hideBone: function (id) { if (boneObjs[id]) boneObjs[id].visible = false; },
      teleported: function () { camInit = false; if (player.trail) player.trail.reset(); player.prev = null; player.prevAir = 0; },
      setSnow: function (d) { snowDensity = d; },
      setWeather: setWeather,
      setCamera: function (m) { camMode = m; camInit = false; },
      resize: resize,
      dispose: function () {
        particles.dispose(); snowfall.dispose(); sky.dispose();
        // 釋放場景裡所有的 geometry／material／texture（重複比賽時 GPU 記憶體不累積）
        scene.traverse(function (o) {
          if (o.geometry) o.geometry.dispose();
          var ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
          ms.forEach(function (m) { if (m.map) m.map.dispose(); m.dispose(); });
        });
        snowMap.dispose(); shadowMap.dispose();
        renderer.dispose();
        if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
      },
    };
  }

  root.PriTestInusnow3D = { load: load, webglOk: webglOk, create: create, BOARD_COLORS: BOARD_COLORS };
})(typeof window !== "undefined" ? window : globalThis);
