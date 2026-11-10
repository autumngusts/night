// 宵の怪談（yoi）：3D 剖面娃娃屋（three.js r149，第一次用到時才載入 #yo-app[data-three-src]）。
// 只負責「畫」：房間格局依 yoi_data.js 的格子座標程序生成（地板、半高牆、門洞、鏡子、水窪、結界的注連繩），
// 探索者是彩色小人偶，目前行動者腳下有光圈與手電筒；怪異事件時在目標房間浮現黑影。
// 規則與結果完全由 yoi_core.js 決定；這裡只讀 st。點地板會呼叫 onRoomClick(roomId)。
(function () {
  "use strict";

  var D = window.PriTestYoiData;
  var CELL = 4, WALL_H = 1.5, WALL_T = 0.14, DOOR_W = 1.3, LEVEL_H = 3.2;
  var loading = null;

  function available() {
    try {
      var c = document.createElement("canvas");
      return !!(window.WebGLRenderingContext && (c.getContext("webgl") || c.getContext("experimental-webgl")));
    } catch (e) { return false; }
  }
  function load() {
    if (window.THREE) return Promise.resolve(window.THREE);
    if (loading) return loading;
    var app = document.getElementById("yo-app"), src = app && app.getAttribute("data-three-src");
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

  function L(o) {
    var lang = (window.I18N && window.I18N.getLang && window.I18N.getLang()) || "zh";
    return o ? (o[lang] || o.zh || "") : "";
  }

  function mount(container, opts) {
    return load().then(function (THREE) { return create(THREE, container, opts || {}); });
  }

  function create(THREE, container, opts) {
    var renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputEncoding = THREE.sRGBEncoding;
    container.appendChild(renderer.domElement);
    renderer.domElement.className = "yo-canvas";

    var scene = new THREE.Scene();
    scene.background = new THREE.Color(0x07080d);
    scene.fog = new THREE.FogExp2(0x07080d, 0.035);
    var camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
    var ambient = new THREE.AmbientLight(0x6070a0, 0.55);
    var moon = new THREE.DirectionalLight(0x8da0d0, 0.5);
    moon.position.set(-8, 14, 6);
    scene.add(ambient, moon);

    var house = null;          // 目前舞台的 Group
    var built = { stage: null, lang: null };
    var plates = [];           // 可點擊的地板 mesh（userData.room）
    var roomObj = {};          // roomId → { plate, light, f, cx, cz }
    var floors = [];           // f → Group
    var dolls = [];            // 探索者人偶
    var ring = null, torch = null, ghost = null;
    var view = { floor: 0, highlight: {}, current: -1, ghostRoom: null, dread: 0 };
    var center = new THREE.Vector3();
    var orbit = { az: -0.6, el: 0.95, dist: 21 };
    var disposed = false, t0 = performance.now();

    function mat(color, extra) {
      var o = { color: color, roughness: 0.85, metalness: 0.05 };
      if (extra) Object.keys(extra).forEach(function (k) { o[k] = extra[k]; });
      return new THREE.MeshStandardMaterial(o);
    }
    function labelSprite(text, color) {
      var c = document.createElement("canvas"), g = c.getContext("2d");
      c.width = 256; c.height = 64;
      g.font = "bold 30px sans-serif";
      g.textAlign = "center"; g.textBaseline = "middle";
      g.fillStyle = "rgba(0,0,0,0.55)";
      var w = Math.min(250, g.measureText(text).width + 24);
      g.fillRect(128 - w / 2, 10, w, 44);
      g.fillStyle = color || "#e8e2d0";
      g.fillText(text, 128, 33);
      var tex = new THREE.CanvasTexture(c);
      tex.encoding = THREE.sRGBEncoding;
      var s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
      s.scale.set(3.2, 0.8, 1);
      return s;
    }

    function clearHouse() {
      if (!house) return;
      scene.remove(house);
      house.traverse(function (o) {
        if (o.geometry) o.geometry.dispose();
        if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); }
      });
      house = null; plates = []; roomObj = {}; floors = []; dolls = [];
    }

    function build(st) {
      clearHouse();
      var sg = D.STAGE_BY_ID[st.stage];
      house = new THREE.Group();
      scene.add(house);
      var byPos = {};
      sg.rooms.forEach(function (r) { byPos[r.f + ":" + r.x + ":" + r.y] = r; });
      var maxX = 0, maxY = 0;
      sg.rooms.forEach(function (r) { maxX = Math.max(maxX, r.x); maxY = Math.max(maxY, r.y); });
      center.set(maxX * CELL / 2, 0, maxY * CELL / 2);
      var wallMats = [mat(sg.wall), mat(sg.wall)], floorMat = mat(sg.floorColor);   // 牆材質每層各一份（下層會變半透明）
      [0, 1].forEach(function (f) { var g = new THREE.Group(); g.position.y = f * LEVEL_H; floors[f] = g; house.add(g); });

      sg.rooms.forEach(function (r) {
        var g = floors[r.f], cx = r.x * CELL, cz = r.y * CELL, wallMat = wallMats[r.f];
        var plate = new THREE.Mesh(new THREE.BoxGeometry(CELL - 0.06, 0.16, CELL - 0.06), floorMat.clone());
        plate.position.set(cx, -0.08, cz);
        plate.userData.room = r.id;
        g.add(plate); plates.push(plate);
        // 四面牆：相鄰（同層）就開門洞
        [[0, -1], [0, 1], [-1, 0], [1, 0]].forEach(function (d) {
          var nb = byPos[r.f + ":" + (r.x + d[0]) + ":" + (r.y + d[1])];
          var horiz = d[1] !== 0;   // 沿 x 方向延伸的牆
          var ox = cx + d[0] * CELL / 2, oz = cz + d[1] * CELL / 2;
          if (nb && (d[0] > 0 || d[1] > 0)) {
            // 只由一側畫共用牆，避免重疊；中間留門
            var seg = (CELL - DOOR_W) / 2;
            [-1, 1].forEach(function (s) {
              var w = new THREE.Mesh(horiz ? new THREE.BoxGeometry(seg, WALL_H, WALL_T) : new THREE.BoxGeometry(WALL_T, WALL_H, seg), wallMat);
              var off = s * (DOOR_W / 2 + seg / 2);
              w.position.set(horiz ? cx + off : ox, WALL_H / 2, horiz ? oz : cz + off);
              g.add(w);
            });
          } else if (!nb) {
            var full = new THREE.Mesh(horiz ? new THREE.BoxGeometry(CELL, WALL_H, WALL_T) : new THREE.BoxGeometry(WALL_T, WALL_H, CELL), wallMat);
            full.position.set(ox, WALL_H / 2, oz);
            g.add(full);
          }
        });
        // 房間燈
        var light = new THREE.PointLight(r.kekkai ? 0xff6a4a : 0xffc98a, 0.6, CELL * 1.6, 2);
        light.position.set(cx, 1.6, cz);
        g.add(light);
        // 擺設
        if (r.mirror) {
          var mirror = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 1.1), mat(0xbfd4e6, { metalness: 0.9, roughness: 0.1, emissive: 0x223344 }));
          mirror.position.set(cx - CELL / 2 + 0.12, 0.9, cz - 0.9);
          mirror.rotation.y = Math.PI / 2;
          g.add(mirror);
        }
        if (r.water) {
          var pool = new THREE.Mesh(new THREE.CircleGeometry(0.75, 20), mat(0x2b5f8a, { transparent: true, opacity: 0.7, roughness: 0.05, metalness: 0.4, emissive: 0x0a2236 }));
          pool.rotation.x = -Math.PI / 2;
          pool.position.set(cx + 0.9, 0.02, cz + 0.9);
          g.add(pool);
        }
        if (r.kekkai) {
          var rope = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.07, 8, 32), mat(0xe6d8b0, { emissive: 0x332a10 }));
          rope.position.set(cx, 1.35, cz);
          rope.rotation.x = Math.PI / 2;
          rope.userData.spin = true;
          g.add(rope);
          var altar = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.6, 0.6), mat(0x5a2a1a));
          altar.position.set(cx, 0.3, cz - CELL / 2 + 0.5);
          g.add(altar);
        }
        if (sg.stairs.some(function (p) { return p[0] === r.id || p[1] === r.id; })) {
          for (var i = 0; i < 4; i++) {
            var step = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.18 * (i + 1), 0.4), mat(0x4a3a2a));
            step.position.set(cx + CELL / 2 - 0.6, 0.09 * (i + 1), cz - 1.2 + i * 0.4);
            g.add(step);
          }
        }
        var lab = labelSprite(L(r.name), r.kekkai ? "#ffb39a" : null);
        lab.position.set(cx, WALL_H + 0.7, cz);
        g.add(lab);
        roomObj[r.id] = { plate: plate, light: light, f: r.f, cx: cx, cz: cz, baseColor: new THREE.Color(sg.floorColor) };
      });

      // 探索者人偶
      st.members.forEach(function (m) {
        var job = D.JOB_BY_ID[m.job];
        var doll = new THREE.Group();
        var body = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 0.5, 4, 10), mat(job.color, { emissive: job.color, emissiveIntensity: 0.15 }));
        body.position.y = 0.55;
        var head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 10), mat(0xf0dcc0));
        head.position.y = 1.15;
        doll.add(body, head);
        doll.userData.target = new THREE.Vector3();
        house.add(doll);
        dolls.push(doll);
      });
      ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.56, 28), new THREE.MeshBasicMaterial({ color: 0xfff1a8, transparent: true, opacity: 0.85, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2;
      house.add(ring);
      torch = new THREE.SpotLight(0xfff0c8, 1.4, 9, 0.55, 0.6, 1.5);
      house.add(torch, torch.target);
      // 怪異的黑影
      ghost = new THREE.Group();
      var shade = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 1.6, 4, 12), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.0, depthWrite: false }));
      shade.position.y = 1.2;
      var eyeMat = new THREE.MeshBasicMaterial({ color: 0xff3030, transparent: true, opacity: 0 });
      [-0.12, 0.12].forEach(function (x) { var e = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), eyeMat); e.position.set(x, 1.85, 0.36); ghost.add(e); });
      ghost.add(shade);
      ghost.userData = { shade: shade, eyes: eyeMat, a: 0 };
      house.add(ghost);
      built.stage = st.stage;
      built.lang = window.I18N && window.I18N.getLang ? window.I18N.getLang() : "zh";
    }

    var lastSt = null;
    function update(st, ui) {
      lastSt = st;
      var lang = window.I18N && window.I18N.getLang ? window.I18N.getLang() : "zh";
      if (built.stage !== st.stage || built.lang !== lang || dolls.length !== st.members.length) build(st);
      view.floor = ui.floor || 0;
      view.highlight = ui.highlight || {};
      view.current = ui.current;
      view.ghostRoom = ui.ghostRoom || null;
      view.dread = st.dread;
      floors.forEach(function (g, f) { g.visible = f === view.floor || (f < view.floor); });
      // 上層時下層半透明地留著當參考
      floors.forEach(function (g, f) {
        g.traverse(function (o) {
          if (o.isMesh && o.material && !o.userData.room) { o.material.transparent = f < view.floor; o.material.opacity = f < view.floor ? 0.25 : 1; }
          if (o.isSprite) o.visible = f === view.floor;
        });
      });
      // 搜索完的房間地板變暗
      Object.keys(roomObj).forEach(function (id) {
        var ro = roomObj[id], left = (st.decks[id] || []).length;
        ro.plate.material.color.copy(ro.baseColor).multiplyScalar(left ? 1 : 0.55);
        ro.plate.visible = ro.f === view.floor || ro.f < view.floor;
      });
      // 人偶位置：同房間的人排成小圓
      var groups = {};
      st.members.forEach(function (m, i) { if (!m.gone) (groups[m.room] = groups[m.room] || []).push(i); });
      st.members.forEach(function (m, i) {
        var d = dolls[i], ro = roomObj[m.room];
        d.visible = !m.gone && ro.f === view.floor;
        var list = groups[m.room] || [i], k = list.indexOf(i), n = list.length;
        var ang = (k / Math.max(1, n)) * Math.PI * 2, rad = n > 1 ? 0.75 : 0;
        d.userData.target.set(ro.cx + Math.cos(ang) * rad, ro.f * LEVEL_H, ro.cz + Math.sin(ang) * rad);
        d.rotation.z = m.down ? Math.PI / 2 : 0;
        d.userData.down = m.down;
      });
    }

    // ---- 視角操作：拖曳旋轉、滾輪縮放、點擊選房間 ----
    var drag = null;
    var el = renderer.domElement;
    el.addEventListener("pointerdown", function (e) { drag = { x: e.clientX, y: e.clientY, az: orbit.az, el: orbit.el, moved: false }; try { el.setPointerCapture(e.pointerId); } catch (x) {} });
    el.addEventListener("pointermove", function (e) {
      if (!drag) return;
      var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 6) drag.moved = true;
      orbit.az = drag.az - dx * 0.008;
      orbit.el = Math.max(0.35, Math.min(1.35, drag.el + dy * 0.006));
    });
    el.addEventListener("pointerup", function (e) {
      var d = drag; drag = null;
      if (!d || d.moved || !opts.onRoomClick) return;
      var rect = el.getBoundingClientRect();
      var p = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      var rc = new THREE.Raycaster();
      rc.setFromCamera(p, camera);
      var hits = rc.intersectObjects(plates.filter(function (x) { return x.visible && roomObj[x.userData.room].f === view.floor; }), false);
      if (hits.length) opts.onRoomClick(hits[0].object.userData.room);
    });
    el.addEventListener("wheel", function (e) { e.preventDefault(); orbit.dist = Math.max(9, Math.min(30, orbit.dist + e.deltaY * 0.01)); }, { passive: false });

    function resize() {
      var w = container.clientWidth || 600, h = container.clientHeight || 400;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    var ro = window.ResizeObserver ? new ResizeObserver(resize) : null;
    if (ro) ro.observe(container); else window.addEventListener("resize", resize);
    resize();

    function frame(now) {
      if (disposed) return;
      requestAnimationFrame(frame);
      var t = (now - t0) / 1000;
      var fy = view.floor * LEVEL_H;
      var target = new THREE.Vector3(center.x, fy, center.z);
      camera.position.set(target.x + Math.cos(orbit.az) * Math.cos(orbit.el) * orbit.dist,
        fy + Math.sin(orbit.el) * orbit.dist,
        target.z + Math.sin(orbit.az) * Math.cos(orbit.el) * orbit.dist);
      camera.lookAt(target);
      // 怪異度越高越暗、霧越濃，燈越會閃
      var dread = Math.min(12, view.dread);
      ambient.intensity = 0.55 - dread * 0.03;
      scene.fog.density = 0.03 + dread * 0.003;
      Object.keys(roomObj).forEach(function (id, i) {
        var r = roomObj[id];
        var flick = dread >= 4 ? (Math.sin(t * 13 + i * 7) > 0.92 - dread * 0.01 ? 0.15 : 1) : 1;
        r.light.intensity = (view.highlight[id] ? 1.3 : 0.6) * flick;
        var em = view.highlight[id] ? 0.25 + 0.15 * Math.sin(t * 4) : 0;
        r.plate.material.emissive = r.plate.material.emissive || new THREE.Color();
        r.plate.material.emissive.setRGB(em * 0.9, em * 0.8, em * 0.4);
      });
      if (house) house.traverse(function (o) { if (o.userData && o.userData.spin) o.rotation.z = t * 0.4; });
      dolls.forEach(function (d, i) {
        d.position.lerp(d.userData.target, 0.15);
        if (!d.userData.down) d.position.y += Math.abs(Math.sin(t * 2 + i)) * 0.04;
      });
      if (ring) {
        var cur = dolls[view.current];
        ring.visible = !!(cur && cur.visible);
        torch.visible = ring.visible;
        if (cur) {
          ring.position.set(cur.position.x, cur.position.y + 0.03, cur.position.z);
          ring.scale.setScalar(1 + 0.08 * Math.sin(t * 5));
          torch.position.set(cur.position.x, cur.position.y + 1.6, cur.position.z);
          torch.target.position.set(cur.position.x + Math.cos(t * 0.7) * 1.5, cur.position.y, cur.position.z + Math.sin(t * 0.7) * 1.5);
        }
      }
      if (ghost) {
        var gr = view.ghostRoom && roomObj[view.ghostRoom];
        var want = gr && gr.f === view.floor ? 1 : 0;
        ghost.userData.a += (want - ghost.userData.a) * 0.05;
        if (gr) ghost.position.set(gr.cx + Math.sin(t * 0.8) * 0.8, gr.f * LEVEL_H, gr.cz - 1 + Math.cos(t * 0.6) * 0.4);
        ghost.userData.shade.material.opacity = 0.82 * ghost.userData.a * (0.85 + 0.15 * Math.sin(t * 9));
        ghost.userData.eyes.opacity = ghost.userData.a;
        ghost.visible = ghost.userData.a > 0.02;
        ghost.lookAt(camera.position.x, ghost.position.y, camera.position.z);
      }
      renderer.render(scene, camera);
    }
    requestAnimationFrame(frame);

    return {
      update: update,
      dispose: function () {
        disposed = true;
        if (ro) ro.disconnect(); else window.removeEventListener("resize", resize);
        clearHouse();
        renderer.dispose();
        if (el.parentNode) el.parentNode.removeChild(el);
      }
    };
  }

  window.PriTestYoi3D = { available: available, mount: mount };
})();
