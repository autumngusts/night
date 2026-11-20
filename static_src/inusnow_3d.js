/* イヌスノー（狗雪）3D 畫面（docs/inusnow_design.md §10）：three.js r149，第一次用到時才載入 #inu-app[data-three-src]。
   只負責畫面；位置、方向都來自物理狀態或重播的 frame（[x, y, z, hx, hz, edge, crouch, air]）。 */
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

  // 一塊地形網格：格點範圍 [i0, i1]×[j0, j1]，間距 step；skip(i, j) 為 true 的格子不畫
  function terrainMesh(THREE, terrain, mask, i0, j0, i1, j1, step, drop, skip) {
    var w = terrain.w, cell = terrain.cell, hs = terrain.hs;
    var nx = Math.floor((i1 - i0) / step) + 1, nz = Math.floor((j1 - j0) / step) + 1;
    var pos = new Float32Array(nx * nz * 3), col = new Float32Array(nx * nz * 3);
    for (var b = 0; b < nz; b++) {
      for (var a = 0; a < nx; a++) {
        var i = i0 + a * step, j = j0 + b * step, k = (b * nx + a) * 3;
        var hgt = hs[j * w + i];
        pos[k] = i * cell; pos[k + 1] = hgt - drop; pos[k + 2] = j * cell;
        var on = mask[j * w + i];
        // 雪道：白（壓雪的細紋）；雪道外：偏藍灰。加一點由格點決定的明暗，讓起伏看得出來
        var nz2 = ((i * 73856093) ^ (j * 19349663)) >>> 0;
        var noise = ((nz2 % 1000) / 1000 - 0.5) * (on ? 0.035 : 0.06);
        var shade = (on ? 0.9 : 0.78) + noise;
        col[k] = shade * (on ? 0.98 : 0.9); col[k + 1] = shade * (on ? 0.99 : 0.94); col[k + 2] = shade;
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
    g.setIndex(idx);
    g.computeVertexNormals();
    return new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true }));
  }

  // 程序生成的狗＋單板（設計 §5.1 外觀參數）。朝 +z。
  function buildDog(THREE, breed, ghost) {
    var L = breed.look, sc = L.size;
    var grp = new THREE.Group();
    function mat(c) {
      var m = new THREE.MeshLambertMaterial({ color: c });
      if (ghost) { m.transparent = true; m.opacity = 0.38; m.depthWrite = false; }
      return m;
    }
    var m1 = mat(L.c1), m2 = mat(L.c2), mBoard = mat(ghost ? 0x88ccff : 0x2a6fd6), mDark = mat(0x222222);
    var board = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.05, 1.5), mBoard);
    board.position.y = 0.03;
    grp.add(board);
    var dog = new THREE.Group();
    dog.scale.set(sc, sc, sc);
    var bodyLen = 0.55 * L.body, leg = 0.28 * L.leg;
    var body = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), m1);
    body.scale.set(0.9, 0.85, bodyLen / 0.4);
    body.position.y = leg + 0.17;
    dog.add(body);
    var belly = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), m2);
    belly.scale.set(0.9, 0.7, bodyLen / 0.36);
    belly.position.set(0, leg + 0.1, 0.02);
    dog.add(belly);
    for (var i = 0; i < 4; i++) {
      var lg = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.04, leg, 6), i < 2 ? m1 : m2);
      lg.position.set(i % 2 ? 0.09 : -0.09, leg / 2 + 0.05, i < 2 ? bodyLen * 0.32 : -bodyLen * 0.32);
      dog.add(lg);
    }
    var head = new THREE.Group();
    head.position.set(0, leg + 0.38, bodyLen * 0.55);
    var skull = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8), m1);
    head.add(skull);
    var snout = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), m2);
    snout.scale.set(1, 0.85, 1.2 * L.snout);
    snout.position.set(0, -0.04, 0.13 * L.snout);
    head.add(snout);
    var nose = new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 4), mDark);
    nose.position.set(0, -0.02, 0.13 * L.snout + 0.09);
    head.add(nose);
    for (var e = 0; e < 2; e++) {
      var ear = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.13, 6), m1);
      if (L.ear === 0) { ear.position.set(e ? 0.08 : -0.08, 0.14, -0.01); }
      else { ear.position.set(e ? 0.13 : -0.13, 0.02, -0.01); ear.rotation.z = e ? -2.5 : 2.5; }
      head.add(ear);
      var eye = new THREE.Mesh(new THREE.SphereGeometry(0.02, 6, 4), mDark);
      eye.position.set(e ? 0.06 : -0.06, 0.03, 0.12);
      head.add(eye);
    }
    // 雪鏡
    var goggle = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.05, 0.03), mat(0xff8a00));
    goggle.position.set(0, 0.04, 0.12);
    head.add(goggle);
    dog.add(head);
    var tail = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.02, L.tail === 2 ? 0.06 : 0.22, 5), m1);
    if (L.tail === 0) { tail.position.set(0, leg + 0.36, -bodyLen * 0.5); tail.rotation.x = 0.4; }
    else { tail.position.set(0, leg + 0.24, -bodyLen * 0.6); tail.rotation.x = -0.9; }
    dog.add(tail);
    grp.add(dog);
    grp.userData = { dog: dog, head: head, tail: tail, baseY: 0.06 };
    return grp;
  }

  function create(container, terrain, opts) {
    var THREE = root.THREE;
    var renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(root.devicePixelRatio || 1, 2));
    renderer.domElement.className = "inu-canvas";
    container.appendChild(renderer.domElement);
    var scene = new THREE.Scene();
    var sky = new THREE.Color(0x9cc8ec);
    scene.background = sky;
    scene.fog = new THREE.Fog(0xcfe2f2, 250, 2600);
    var camera = new THREE.PerspectiveCamera(62, 1, 0.3, 6000);
    scene.add(new THREE.HemisphereLight(0xdfeeff, 0x6f7f92, 0.55));
    var sun = new THREE.DirectionalLight(0xfff6e8, 0.8);
    sun.position.set(-0.6, 0.8, -0.5);
    scene.add(sun);

    var pi = T.piste(terrain, opts.piste);
    var mask = pisteMask(terrain);
    // 近景：大曲道周圍（10 m 原解析度）；遠景：整個格網（40 m），近景範圍內的格子不畫
    var minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    pi.pts.forEach(function (p) { minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minZ = Math.min(minZ, p[1]); maxZ = Math.max(maxZ, p[1]); });
    var pad = 160, cell = terrain.cell;
    var ni0 = Math.max(0, Math.floor((minX - pad) / cell)), nj0 = Math.max(0, Math.floor((minZ - pad) / cell));
    var ni1 = Math.min(terrain.w - 1, Math.ceil((maxX + pad) / cell)), nj1 = Math.min(terrain.h - 1, Math.ceil((maxZ + pad) / cell));
    var near = terrainMesh(THREE, terrain, mask, ni0, nj0, ni1, nj1, 1, 0, null);
    scene.add(near);
    var far = terrainMesh(THREE, terrain, mask, 0, 0, terrain.w - 1 - ((terrain.w - 1) % 4), terrain.h - 1 - ((terrain.h - 1) % 4), 4, 0.6, function (i, j, st) {
      return i >= ni0 + 4 && i + st <= ni1 - 4 && j >= nj0 + 4 && j + st <= nj1 - 4;
    });
    scene.add(far);

    // 樹林：雪道外、離大曲道 260 m 以內（seed 決定位置）
    var rng = Core.makeRng(Core.hash("trees|" + terrain.id));
    var treeGeo = new THREE.ConeGeometry(2.2, 8, 7);
    treeGeo.translate(0, 4, 0);
    var trees = [];
    for (var tries = 0; tries < 9000 && trees.length < 1800; tries++) {
      var tx = minX - 260 + rng() * (maxX - minX + 520), tz = minZ - 260 + rng() * (maxZ - minZ + 520);
      var ci = Math.round(tx / cell), cj = Math.round(tz / cell);
      if (ci < 1 || cj < 1 || ci >= terrain.w - 1 || cj >= terrain.h - 1) continue;
      var blocked = false;
      for (var dj = -1; dj <= 1 && !blocked; dj++) for (var di = -1; di <= 1; di++) if (mask[(cj + dj) * terrain.w + ci + di]) { blocked = true; break; }
      if (blocked) continue;
      trees.push([tx, T.height(terrain, tx, tz), tz, 0.7 + rng() * 0.7]);
    }
    if (trees.length) {
      var inst = new THREE.InstancedMesh(treeGeo, new THREE.MeshLambertMaterial({ color: 0x2f5a3a }), trees.length);
      var mtx = new THREE.Matrix4();
      trees.forEach(function (t, i) { mtx.makeScale(t[3], t[3] * (0.9 + (i % 5) * 0.06), t[3]); mtx.setPosition(t[0], t[1] - 0.5, t[2]); inst.setMatrixAt(i, mtx); });
      scene.add(inst);
    }

    // 雪道邊的難度標示桿（大曲道兩側，每 30 m）
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
      // 兩根旗竿各一面小旗（GS 的旗門板）
      [[g.ix, hy], [g.ox, oy]].forEach(function (q, qi) {
        var ox = (g.ox - g.ix) / D.GATES.width, oz = (g.oz - g.iz) / D.GATES.width;
        var dir = qi === 0 ? 1 : -1;
        var panel = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 0.55), m);
        var cx = (qi === 0 ? g.ix : g.ox) + ox * dir * 0.4, cz = (qi === 0 ? g.iz : g.oz) + oz * dir * 0.4;
        panel.position.set(cx, q[1] + 1.45, cz);
        panel.rotation.y = Math.atan2(ox, oz) + Math.PI / 2;
        grp.add(panel);
      });
      gateGroup.add(grp);
      gateObjs.push(grp);
    });
    scene.add(gateGroup);

    // 終點拱門
    var f = opts.finish;
    if (f) {
      var fy = T.height(terrain, f.x, f.z), rx = -f.tz, rz = f.tx, half = pi.width / 2 + 2;
      var archMat = new THREE.MeshLambertMaterial({ color: 0xff7a1a });
      [-1, 1].forEach(function (sd) {
        var post = new THREE.Mesh(new THREE.BoxGeometry(0.6, 6, 0.6), archMat);
        post.position.set(f.x + rx * sd * half, T.height(terrain, f.x + rx * sd * half, f.z + rz * sd * half) + 3, f.z + rz * sd * half);
        scene.add(post);
      });
      var banner = new THREE.Mesh(new THREE.BoxGeometry(half * 2, 1.2, 0.3), archMat);
      banner.position.set(f.x, fy + 6, f.z);
      banner.rotation.y = Math.atan2(rx, rz);
      scene.add(banner);
    }

    // 纜車（只當景觀）：離地 10 m 的纜線＋每 120 m 一根塔
    var liftMat = new THREE.LineBasicMaterial({ color: 0x333333 });
    var towerMat = new THREE.MeshLambertMaterial({ color: 0x777777 });
    (terrain.json.lifts || []).forEach(function (l) {
      var pts = [];
      for (var k = 0; k < l.pts.length - 1; k++) {
        var a0 = l.pts[k], b0 = l.pts[k + 1];
        var dl = Math.sqrt((b0[0] - a0[0]) * (b0[0] - a0[0]) + (b0[1] - a0[1]) * (b0[1] - a0[1]));
        var n = Math.max(1, Math.ceil(dl / 120));
        for (var t2 = 0; t2 < n; t2++) {
          var x = a0[0] + (b0[0] - a0[0]) * t2 / n, z = a0[1] + (b0[1] - a0[1]) * t2 / n, y = T.height(terrain, x, z);
          pts.push(new THREE.Vector3(x, y + 10, z));
          var tw = new THREE.Mesh(new THREE.BoxGeometry(0.5, 10, 0.5), towerMat);
          tw.position.set(x, y + 5, z);
          scene.add(tw);
        }
      }
      var last = l.pts[l.pts.length - 1];
      pts.push(new THREE.Vector3(last[0], T.height(terrain, last[0], last[1]) + 10, last[1]));
      scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), liftMat));
    });

    // 選手與幽靈
    var rider = buildDog(THREE, opts.breed, false);
    scene.add(rider);
    var ghost = null;
    if (opts.ghostBreed) { ghost = buildDog(THREE, opts.ghostBreed, true); ghost.visible = false; scene.add(ghost); }

    var up = new THREE.Vector3(0, 1, 0), nrm = new THREE.Vector3(), qTilt = new THREE.Quaternion(), qYaw = new THREE.Quaternion(), qLean = new THREE.Quaternion();
    var fwd = new THREE.Vector3();
    function placeDog(obj, f) {
      var n = T.normal(terrain, f[0], f[2]);
      nrm.set(n[0], n[1], n[2]);
      if (f[7]) nrm.set(0, 1, 0);
      qTilt.setFromUnitVectors(up, nrm);
      qYaw.setFromAxisAngle(up, Math.atan2(f[3], f[4]));
      fwd.set(0, 0, 1);
      qLean.setFromAxisAngle(fwd, -f[5] * 0.55);
      obj.quaternion.copy(qTilt).multiply(qYaw).multiply(qLean);
      obj.position.set(f[0], f[1] + obj.userData.baseY, f[2]);
      var dg = obj.userData.dog;
      dg.scale.y = dg.scale.x * (1 - 0.28 * f[6]);
      obj.userData.tail.rotation.z = Math.sin(Date.now() / 120) * 0.5;
    }

    // 鏡頭
    var camMode = opts.camera || "chase";
    var camPos = new THREE.Vector3(), camLook = new THREE.Vector3(), smDir = [0, 1], camInit = false;
    var tvCams = [];
    for (var cs = 60; cs < pi.len; cs += 140) {
      var ca = T.at(pi, cs), sd2 = (tvCams.length % 2) ? 1 : -1;
      var cx2 = ca.x + (-ca.tz) * sd2 * (pi.width / 2 + 18), cz2 = ca.z + ca.tx * sd2 * (pi.width / 2 + 18);
      tvCams.push({ s: cs, p: new THREE.Vector3(cx2, T.height(terrain, cx2, cz2) + 7, cz2) });
    }
    function updateCamera(f, vel, dt) {
      var vx = vel ? vel[0] : f[3], vz = vel ? vel[2] : f[4], vl = Math.sqrt(vx * vx + vz * vz);
      if (vl > 0.5) {
        var k = Math.min(1, dt * 3);
        smDir[0] += (vx / vl - smDir[0]) * k; smDir[1] += (vz / vl - smDir[1]) * k;
        var sl = Math.sqrt(smDir[0] * smDir[0] + smDir[1] * smDir[1]) || 1;
        smDir[0] /= sl; smDir[1] /= sl;
      }
      var tgt = new THREE.Vector3(), look = new THREE.Vector3(f[0] + smDir[0] * 2.5, f[1] + 0.5, f[2] + smDir[1] * 2.5);
      if (camMode === "pov") {
        tgt.set(f[0], f[1] + 1.0, f[2]);
        look.set(f[0] + smDir[0] * 10, T.height(terrain, f[0] + smDir[0] * 10, f[2] + smDir[1] * 10) + 0.5, f[2] + smDir[1] * 10);
        camPos.copy(tgt); camLook.copy(look);
      } else if (camMode === "tv") {
        var nr = T.nearest(pi, f[0], f[2]), best = tvCams[0];
        for (var i = 0; i < tvCams.length; i++) if (tvCams[i].s <= nr.s + 70) best = tvCams[i];
        camPos.lerp(best.p, camInit ? Math.min(1, dt * 2) : 1); camLook.lerp(look, camInit ? Math.min(1, dt * 8) : 1);
      } else {
        var back = camMode === "air" ? 26 : 4.2, high = camMode === "air" ? 30 : 1.7;
        var bx = f[0] - smDir[0] * back, bz = f[2] - smDir[1] * back;
        var gy = T.height(terrain, bx, bz);
        tgt.set(bx, Math.max(gy + 1.2, f[1] + high), bz);
        camPos.lerp(tgt, camInit ? Math.min(1, dt * 6) : 1);
        camLook.lerp(look, camInit ? Math.min(1, dt * 10) : 1);
      }
      camInit = true;
      camera.position.copy(camPos);
      camera.lookAt(camLook);
    }

    function resize() {
      var w = container.clientWidth || root.innerWidth, h = container.clientHeight || root.innerHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    resize();

    return {
      // f＝選手 frame；vel＝速度（鏡頭用）；gf＝幽靈 frame（沒有就 null）
      render: function (f, vel, gf, dt) {
        placeDog(rider, f);
        if (ghost) {
          ghost.visible = !!gf;
          if (gf) placeDog(ghost, gf);
        }
        updateCamera(f, vel, dt || 1 / 60);
        renderer.render(scene, camera);
      },
      // 已通過的旗門變淡
      gatePassed: function (n) { if (gateObjs[n]) gateObjs[n].visible = false; },
      resetGates: function () { gateObjs.forEach(function (g) { g.visible = true; }); },
      setCamera: function (m) { camMode = m; camInit = false; },
      resize: resize,
      dispose: function () {
        renderer.dispose();
        if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
      },
    };
  }

  root.PriTestInusnow3D = { load: load, webglOk: webglOk, create: create };
})(typeof window !== "undefined" ? window : globalThis);
