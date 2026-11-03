// 繩文帝國（jomon）：即時戰鬥的 3D 演出（使用者採用的提案 1）。
// 勝負由 jomon_core.js 的即時戰鬥逐回合計算（每 0.8 秒一回合）；這裡依每回合的殘存人數呈現：
// 兩軍布陣 → 近戰部隊衝鋒交戰、弓兵與鐵砲射擊（箭矢／火光）、攻城兵器投石 → 倒下的士兵留在戰場 → 勝方歡呼、敗方潰逃。
// 地形：原野（field）、木柵（palisade）、城塞（fort）、村落防衛（village）。
// three.js 由 jomon_scene3d.js 的 load() 載入（共用 static/vendor/three.min.js）。
(function () {
  "use strict";

  var THREE = null;

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
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

  var MAX_FIG = 520;
  var MAX_SHOT = 220;
  var SIDE_MAX = 240;
  var MELEE = { spear: 1, infantry: 1, cavalry: 1, beast: 1, militia: 1, unique: 1 };
  var CLASS_COLOR = { spear: 0x2e5e9e, infantry: 0x8e2b2b, archer: 0x3c7a3a, cavalry: 0x6b3fa0, siege: 0x6b5a3a, unique: 0xd4a017, militia: 0x9a7a55, beast: 0x5a3d26 };

  function Battle(container, threeLib) {
    THREE = threeLib;
    this.container = container;
    this.rng = makeRng(77);
    this.figs = [];
    this.shots = [];
    this.clock = 0;
    this.sig = "";
    this.theta = 0.35;
    this.disposed = false;
    this.init();
  }

  Battle.prototype.init = function () {
    var self = this;
    var w = this.container.clientWidth || 640;
    var h = this.container.clientHeight || 360;
    var r = new THREE.WebGLRenderer({ antialias: true });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    r.setSize(w, h);
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.domElement.className = "jm-battle-canvas";
    this.container.appendChild(r.domElement);
    this.renderer = r;
    var scene = new THREE.Scene();
    scene.background = new THREE.Color(0xa9d4ec);
    scene.fog = new THREE.Fog(0xa9d4ec, 90, 220);
    this.scene = scene;
    this.camera = new THREE.PerspectiveCamera(40, w / h, 0.5, 600);
    scene.add(new THREE.HemisphereLight(0xdcefff, 0x5a6b3a, 0.5));
    var sun = new THREE.DirectionalLight(0xfff1d6, 0.95);
    sun.position.set(-40, 80, 50);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    var sc = sun.shadow.camera;
    sc.left = -70;
    sc.right = 70;
    sc.top = 50;
    sc.bottom = -50;
    sc.far = 260;
    scene.add(sun);
    this.terrainGroup = new THREE.Group();
    scene.add(this.terrainGroup);

    var box = new THREE.BoxGeometry(1, 1, 1);
    var cyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 6);
    var sph = new THREE.SphereGeometry(0.5, 8, 6);
    this.geo = { box: box, cyl: cyl, sph: sph };
    function inst(geo, color, n) {
      var m = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: color, roughness: 0.85, flatShading: true }), n);
      var white = new THREE.Color(0xffffff);
      for (var i = 0; i < n; i++) m.setColorAt(i, white);
      m.count = 0;
      m.castShadow = true;
      m.frustumCulled = false;
      scene.add(m);
      return m;
    }
    this.mBody = inst(cyl, 0xffffff, MAX_FIG);
    this.mHead = inst(sph, 0xe0b48a, MAX_FIG);
    this.mWeapon = inst(box, 0xffffff, MAX_FIG);
    this.mHorse = inst(box, 0x6b4a2e, MAX_FIG);
    this.mShot = inst(box, 0xffffff, MAX_SHOT);
    this.mShot.castShadow = false;
    this.mFlag = inst(box, 0xffffff, 2);

    // 煙塵與火光
    var cv = document.createElement("canvas");
    cv.width = cv.height = 64;
    var ctx = cv.getContext("2d");
    var grd = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
    grd.addColorStop(0, "rgba(255,255,255,0.9)");
    grd.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, 64, 64);
    var tex = new THREE.CanvasTexture(cv);
    this.dustN = 120;
    var dg = new THREE.BufferGeometry();
    dg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(this.dustN * 3), 3));
    this.dust = new THREE.Points(dg, new THREE.PointsMaterial({ size: 4, map: tex, transparent: true, opacity: 0.35, depthWrite: false, color: 0xcab89a }));
    this.dust.frustumCulled = false;
    scene.add(this.dust);
    this.dustP = [];
    for (var i = 0; i < this.dustN; i++) this.dustP.push({ x: 0, y: -50, z: 0, life: 0 });
    this.flashN = 40;
    var fg = new THREE.BufferGeometry();
    fg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(this.flashN * 3), 3));
    this.flash = new THREE.Points(fg, new THREE.PointsMaterial({ size: 3, map: tex, transparent: true, opacity: 0.9, depthWrite: false, color: 0xffb040, blending: THREE.AdditiveBlending }));
    this.flash.frustumCulled = false;
    scene.add(this.flash);
    this.flashP = [];
    for (var j = 0; j < this.flashN; j++) this.flashP.push({ x: 0, y: -50, z: 0, life: 0 });

    // 拖曳旋轉
    var drag = null;
    r.domElement.addEventListener("pointerdown", function (e) {
      drag = e.clientX;
      r.domElement.setPointerCapture(e.pointerId);
    });
    r.domElement.addEventListener("pointermove", function (e) {
      if (drag == null) return;
      self.theta = clamp(self.theta - (e.clientX - drag) * 0.006, -1.2, 1.2);
      drag = e.clientX;
    });
    r.domElement.addEventListener("pointerup", function () {
      drag = null;
    });
    this.onResize = function () {
      var w2 = self.container.clientWidth || 640;
      var h2 = self.container.clientHeight || 360;
      self.renderer.setSize(w2, h2);
      self.camera.aspect = w2 / h2;
      self.camera.updateProjectionMatrix();
    };
    window.addEventListener("resize", this.onResize);
    this.loop = function (ts) {
      if (self.disposed) return;
      self.raf = requestAnimationFrame(self.loop);
      self.frame(ts);
    };
    this.raf = requestAnimationFrame(this.loop);
  };

  Battle.prototype.buildTerrain = function (kind, playerSide) {
    var g = this.terrainGroup;
    while (g.children.length) g.remove(g.children[0]);
    var rng = makeRng(kind.length * 97 + 3);
    var geo = new THREE.PlaneGeometry(220, 150, 60, 40);
    geo.rotateX(-Math.PI / 2);
    var pos = geo.attributes.position;
    var col = new Float32Array(pos.count * 3);
    var c = new THREE.Color();
    for (var i = 0; i < pos.count; i++) {
      var x = pos.getX(i);
      var z = pos.getZ(i);
      var y = Math.sin(x * 0.07) * 0.5 + Math.cos(z * 0.09) * 0.5;
      if (Math.abs(z) > 45) y += (Math.abs(z) - 45) * 0.25;
      pos.setY(i, y);
      c.setHex(0x6f9f45).lerp(new THREE.Color(0x587f36), 0.5 + 0.5 * Math.sin(x * 0.3 + z * 0.2));
      if (Math.abs(x) < 14) c.lerp(new THREE.Color(0x9c8a63), 0.45 * (1 - Math.abs(x) / 14));
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    geo.computeVertexNormals();
    var ground = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true }));
    ground.receiveShadow = true;
    g.add(ground);
    var box = this.geo.box;
    var cyl = this.geo.cyl;
    function mesh(geo2, color, x, y, z, sx, sy, sz, ry) {
      var m = new THREE.Mesh(geo2, new THREE.MeshStandardMaterial({ color: color, roughness: 0.9, flatShading: true }));
      m.position.set(x, y, z);
      m.scale.set(sx, sy, sz);
      m.rotation.y = ry || 0;
      m.castShadow = true;
      m.receiveShadow = true;
      g.add(m);
      return m;
    }
    // 周圍的樹
    var cone = new THREE.ConeGeometry(0.5, 1, 7);
    for (var t = 0; t < 70; t++) {
      var tx = (rng() - 0.5) * 200;
      var tz = (rng() < 0.5 ? -1 : 1) * (48 + rng() * 25);
      mesh(cyl, 0x5a3d26, tx, 1, tz, 0.5, 2, 0.5);
      mesh(cone, rng() < 0.5 ? 0x2f5f2c : 0x3f7a35, tx, 3.6, tz, 3.4, 4.5, 3.4);
    }
    var defX = playerSide === "B" ? 1 : 1; // 守方永遠在右側（+x）
    if (kind === "palisade" || kind === "fort" || kind === "village") {
      // 木柵（中間留門）
      for (var pz = -30; pz <= 30; pz += 1.3) {
        if (Math.abs(pz) < 4) continue;
        mesh(cyl, 0x8b5a2b, 16 * defX, 1.6, pz, 0.45, 3.2, 0.45);
      }
    }
    if (kind === "fort") {
      mesh(box, 0x77736a, 21, 1.2, -18, 4, 2.4, 22);
      mesh(box, 0x77736a, 21, 1.2, 18, 4, 2.4, 22);
      // 櫓
      [-20, 20].forEach(function (z) {
        mesh(box, 0x8b5a2b, 22, 4.5, z, 3, 5, 3);
        mesh(new THREE.ConeGeometry(Math.SQRT1_2, 1, 4), 0x4a4f57, 22, 8, z, 5, 2, 5, Math.PI / 4);
      });
      // 本丸
      mesh(box, 0x77736a, 48, 2.5, 0, 14, 5, 14);
      mesh(box, 0xf1ebdc, 48, 7, 0, 9, 4, 9);
      mesh(new THREE.ConeGeometry(Math.SQRT1_2, 1, 4), 0x34383e, 48, 10.5, 0, 13, 3, 13, Math.PI / 4);
    }
    if (kind === "village") {
      for (var hn = 0; hn < 9; hn++) {
        var hx = 40 + (hn % 3) * 9 + rng() * 2;
        var hz = -18 + Math.floor(hn / 3) * 14 + rng() * 3;
        mesh(cyl, 0x7a5c3c, hx, 0.3, hz, 4, 0.6, 4);
        mesh(cone, 0x9a7a45, hx, 2.3, hz, 5.2, 3.4, 5.2);
      }
      [-26, 26].forEach(function (z) {
        mesh(cyl, 0x8b5a2b, 20, 3.5, z, 0.5, 7, 0.5);
        mesh(box, 0xb88a55, 20, 7, z, 3, 0.8, 3);
      });
    }
  };

  // 依兵力配置人偶（新的戰鬥或兵種組成改變時重建）
  Battle.prototype.setup = function (v) {
    var self = this;
    this.figs = [];
    this.buildTerrain(v.terrain || "field", v.player);
    var sides = [
      { key: "A", groups: v.A, dir: 1, x0: -22 },
      { key: "B", groups: v.B, dir: -1, x0: 22 },
    ];
    sides.forEach(function (sd) {
      var groups = sd.groups.filter(function (g) {
        return !g.immortal;
      });
      var want = groups.map(function (g) {
        return clamp(Math.round(Math.sqrt(g.n0) * 4), 3, 90);
      });
      var tot = want.reduce(function (a, b) {
        return a + b;
      }, 0);
      var k = tot > SIDE_MAX ? SIDE_MAX / tot : 1;
      // 近戰在前、弓在中、攻城在後
      var order = groups
        .map(function (g, i) {
          return { g: g, i: i, shown: Math.max(1, Math.round(want[i] * k)) };
        })
        .sort(function (a, b) {
          var ra = a.g.base === "siege" ? 2 : a.g.base === "archer" ? 1 : 0;
          var rb = b.g.base === "siege" ? 2 : b.g.base === "archer" ? 1 : 0;
          return ra - rb;
        });
      var depth = 0;
      order.forEach(function (o) {
        var cols = Math.min(16, Math.max(4, Math.ceil(Math.sqrt(o.shown * 2.5))));
        var rows = Math.ceil(o.shown / cols);
        for (var j = 0; j < o.shown; j++) {
          var row = Math.floor(j / cols);
          var cc = j % cols;
          var hx = sd.x0 - sd.dir * (depth + row * 1.9);
          var hz = (cc - (cols - 1) / 2) * 1.7 + (self.rng() - 0.5) * 0.4;
          self.figs.push({ side: sd.key, gi: o.i, cls: o.g.cls, base: o.g.base, hx: hx, hz: hz, x: hx, z: hz, dir: sd.dir, dead: -1, seed: self.rng() * 10, tx: 0, tz: 0 });
        }
        depth += rows * 1.9 + 2.5;
      });
      // 每組的人偶索引
    });
    this.groupFigs = { A: {}, B: {} };
    this.figs.forEach(function (f, idx) {
      var gmap = self.groupFigs[f.side];
      (gmap[f.gi] = gmap[f.gi] || []).push(idx);
    });
    this.towers = (v.B || []).some(function (g) {
      return g.immortal;
    });
  };

  Battle.prototype.update = function (v) {
    this.view = v;
    var sig = [v.key, v.A.length, v.B.length, v.terrain].join("|");
    if (sig !== this.sig) {
      this.sig = sig;
      this.setup(v);
      this.startClock = this.clock;
    }
    // 依殘存比例讓人偶倒下
    var self = this;
    ["A", "B"].forEach(function (side) {
      var groups = v[side];
      groups.forEach(function (g, gi) {
        var idxs = self.groupFigs[side][gi];
        if (!idxs || g.immortal) return;
        var target = g.n0 > 0 ? Math.ceil((idxs.length * g.n) / g.n0) : 0;
        if (g.n <= 0) target = 0;
        var aliveIdx = idxs.filter(function (i) {
          return self.figs[i].dead < 0;
        });
        while (aliveIdx.length > target) {
          var pick = aliveIdx.splice(Math.floor(self.rng() * aliveIdx.length), 1)[0];
          self.figs[pick].dead = self.clock;
          self.dustAt(self.figs[pick].x, self.figs[pick].z, 2);
        }
      });
    });
  };

  Battle.prototype.dustAt = function (x, z, n) {
    for (var i = 0; i < n; i++) {
      var p = this.dustP[Math.floor(Math.random() * this.dustN)];
      p.x = x + (Math.random() - 0.5) * 2;
      p.y = 0.6;
      p.z = z + (Math.random() - 0.5) * 2;
      p.life = 1.2 + Math.random();
    }
  };
  Battle.prototype.flashAt = function (x, y, z) {
    var p = this.flashP[Math.floor(Math.random() * this.flashN)];
    p.x = x;
    p.y = y;
    p.z = z;
    p.life = 0.25;
  };

  Battle.prototype.fire = function (from, to, kind) {
    if (this.shots.length >= MAX_SHOT) return;
    var dx = to.x - from.x;
    var dz = to.z - from.z;
    var dist = Math.sqrt(dx * dx + dz * dz);
    this.shots.push({ x0: from.x, z0: from.z, x1: to.x + (Math.random() - 0.5) * 2, z1: to.z + (Math.random() - 0.5) * 2, t: 0, dur: kind === "gun" ? 0.25 : 0.5 + dist * 0.025, h: kind === "gun" ? 0.5 : kind === "stone" ? 6 + dist * 0.12 : 3 + dist * 0.1, kind: kind });
  };

  Battle.prototype.frame = function (ts) {
    var dt = this.last ? Math.min(0.1, (ts - this.last) / 1000) : 0.016;
    this.last = ts;
    this.clock += dt;
    var v = this.view;
    var t = this.clock;
    if (!v) {
      this.renderer.render(this.scene, this.camera);
      return;
    }
    var speedK = v.paused ? 0 : 1;
    var elapsed = t - (this.startClock || 0);
    var advance = clamp(elapsed / 3.2, 0, 1); // 前 3.2 秒衝鋒接近
    var self = this;
    var mtx = new THREE.Matrix4();
    var q = new THREE.Quaternion();
    var up = new THREE.Vector3(0, 1, 0);
    var zAxis = new THREE.Vector3(0, 0, 1);
    var vec = new THREE.Vector3();
    var sc = new THREE.Vector3();
    var col = new THREE.Color();
    var aliveA = [];
    var aliveB = [];
    var n = 0;
    var playerColor = v.civColor || 0xc0392b;
    this.figs.forEach(function (f) {
      if (n >= MAX_FIG) return;
      var melee = MELEE[f.base];
      var won = v.over && ((v.winner === "A" && f.side === "A") || (v.winner === "B" && f.side === "B"));
      var lost = v.over && !won;
      var x = f.hx;
      var z = f.hz;
      if (f.dead < 0) {
        if (melee && !v.over) {
          // 衝向中線，交戰時在前線晃動
          // 有柵／城塞時，前線在柵（x≈16）：攻方衝到柵前，守方守在柵後
          var walled = v.terrain !== "field";
          var front = walled ? (f.dir > 0 ? 13 : 18) : f.dir > 0 ? -2.2 : 2.2;
          var goal = front + (f.hx - (f.dir > 0 ? -22 : 22)) * 0.35;
          if (walled && f.side === "B") goal = Math.max(front, goal);
          x = lerp(f.hx, goal, advance) + Math.sin(t * 7 + f.seed) * 0.35 * advance;
          z = f.hz * lerp(1, 0.75, advance) + Math.cos(t * 5 + f.seed) * 0.3 * advance;
        } else if (lost && melee) {
          x = f.hx - f.dir * Math.min(40, (t - (self.overAt || t)) * 8);
        }
        f.x = x;
        f.z = z;
        (f.side === "A" ? aliveA : aliveB).push(f);
      } else {
        x = f.x;
        z = f.z;
      }
      var deadK = f.dead >= 0 ? clamp((t - f.dead) / 0.45, 0, 1) : 0;
      var bob = f.dead < 0 ? (won ? Math.abs(Math.sin(t * 10 + f.seed)) * 0.8 : melee && advance > 0 && !v.over ? Math.abs(Math.sin(t * 9 + f.seed)) * 0.25 : 0) : 0;
      var horse = f.base === "cavalry";
      var hy = horse ? 1 : 0;
      var face = f.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
      if (lost && f.dead < 0 && melee) face += Math.PI;
      var tilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), (deadK * Math.PI) / 2);
      q.setFromAxisAngle(up, face).multiply(tilt);
      var enemyCol = f.side !== v.player;
      var baseCol = enemyCol ? 0x5a1d1d : playerColor;
      col.setHex(CLASS_COLOR[f.cls] || 0x777777).lerp(new THREE.Color(baseCol), 0.45);
      if (f.dead >= 0) col.multiplyScalar(0.45);
      vec.set(x, 0.65 + hy * (1 - deadK) + bob - deadK * 0.3, z);
      sc.set(0.75, 1.25, 0.75);
      mtx.compose(vec, q, sc);
      self.mBody.setMatrixAt(n, mtx);
      self.mBody.setColorAt(n, col);
      var headOff = new THREE.Vector3(0, 0.9, 0).applyQuaternion(q);
      vec.set(x + headOff.x, 0.65 + hy * (1 - deadK) + bob - deadK * 0.3 + headOff.y, z + headOff.z);
      sc.set(0.58, 0.58, 0.58);
      mtx.compose(vec, q, sc);
      self.mHead.setMatrixAt(n, mtx);
      // 武器
      var wcol = v.gun && f.base === "archer" ? 0x2b2b2b : v.metal || 0x5a4a3a;
      if (f.base === "siege") {
        vec.set(x, 0.9, z);
        sc.set(2.2, 1.6, 2.2);
        wcol = 0x6b5a3a;
      } else if (f.base === "archer") {
        vec.set(x + f.dir * 0.45, 1.25 + hy + bob, z + 0.4);
        sc.set(v.gun ? 1.1 : 0.1, v.gun ? 0.14 : 1.8, v.gun ? 0.14 : 0.35);
      } else if (f.base === "spear" || f.base === "unique") {
        vec.set(x + f.dir * 0.3, 1.7 + hy + bob, z + 0.45);
        sc.set(0.12, 3.2, 0.12);
      } else {
        vec.set(x + f.dir * 0.5, 1.2 + hy + bob, z + 0.45);
        sc.set(0.12, 1.3, 0.12);
      }
      if (f.dead >= 0) sc.set(0, 0, 0);
      mtx.compose(vec, f.base === "spear" && f.dead < 0 && advance > 0.9 && !v.over ? new THREE.Quaternion().setFromAxisAngle(zAxis, -f.dir * 1.2) : new THREE.Quaternion(), sc);
      self.mWeapon.setMatrixAt(n, mtx);
      self.mWeapon.setColorAt(n, col.setHex(wcol));
      if (horse) {
        vec.set(x, 0.75 - deadK * 0.4, z);
        sc.set(2.4, 1.0, 0.9);
        mtx.compose(vec, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), (deadK * Math.PI) / 2), sc);
      } else mtx.makeScale(0, 0, 0);
      self.mHorse.setMatrixAt(n, mtx);
      n++;
    });
    [this.mBody, this.mHead, this.mWeapon, this.mHorse].forEach(function (m) {
      m.count = n;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    });
    if (v.over && !this.overAt) this.overAt = t;
    if (!v.over) this.overAt = 0;

    // 射擊：弓兵、鐵砲、攻城兵器、箭塔
    if (!v.over && advance > 0.2 && speedK) {
      [
        [aliveA, aliveB],
        [aliveB, aliveA],
      ].forEach(function (pair) {
        var shooters = pair[0].filter(function (f) {
          return f.base === "archer" || f.base === "siege";
        });
        if (!shooters.length || !pair[1].length) return;
        var rate = Math.min(14, shooters.length * 0.25) * dt;
        var k = rate;
        while (k > 0) {
          if (Math.random() < k) {
            var s = shooters[Math.floor(Math.random() * shooters.length)];
            var tg = pair[1][Math.floor(Math.random() * pair[1].length)];
            var kind = s.base === "siege" ? "stone" : v.gun ? "gun" : "arrow";
            self.fire(s, tg, kind);
            if (kind === "gun") self.flashAt(s.x + s.dir * 1.2, 1.4, s.z + 0.4);
          }
          k -= 1;
        }
      });
      if (this.towers && aliveA.length && Math.random() < dt * 3) {
        var tz = Math.random() < 0.5 ? -26 : 26;
        this.fire({ x: 20, z: tz }, aliveA[Math.floor(Math.random() * aliveA.length)], "arrow");
      }
      // 前線的煙塵
      if (Math.random() < dt * 8) this.dustAt((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 30, 1);
    }
    var sn = 0;
    for (var i = this.shots.length - 1; i >= 0; i--) {
      var sh = this.shots[i];
      sh.t += dt * (speedK || 0.2);
      var k2 = sh.t / sh.dur;
      if (k2 >= 1) {
        if (sh.kind === "stone") this.dustAt(sh.x1, sh.z1, 4);
        this.shots.splice(i, 1);
        continue;
      }
      var px = lerp(sh.x0, sh.x1, k2);
      var pz = lerp(sh.z0, sh.z1, k2);
      var py = 1.5 + Math.sin(k2 * Math.PI) * sh.h;
      var ny = 1.5 + Math.sin(Math.min(1, k2 + 0.02) * Math.PI) * sh.h;
      var dir = new THREE.Vector3(sh.x1 - sh.x0, (ny - py) * 50, sh.z1 - sh.z0).normalize();
      q.setFromUnitVectors(zAxis, dir);
      vec.set(px, py, pz);
      if (sh.kind === "stone") sc.set(0.7, 0.7, 0.7);
      else if (sh.kind === "gun") sc.set(0.08, 0.08, 0.6);
      else sc.set(0.06, 0.06, 1.1);
      mtx.compose(vec, q, sc);
      this.mShot.setMatrixAt(sn, mtx);
      this.mShot.setColorAt(sn, col.setHex(sh.kind === "stone" ? 0x77736a : sh.kind === "gun" ? 0xffd27a : 0x3a2a1a));
      sn++;
    }
    this.mShot.count = sn;
    this.mShot.instanceMatrix.needsUpdate = true;
    if (this.mShot.instanceColor) this.mShot.instanceColor.needsUpdate = true;

    // 旗
    var fn = 0;
    [
      ["A", -1],
      ["B", 1],
    ].forEach(function (p) {
      var side = p[0];
      vec.set(p[1] * 34, 4, -22);
      sc.set(0.15, 6, 2.2);
      mtx.compose(vec, new THREE.Quaternion(), sc);
      self.mFlag.setMatrixAt(fn, mtx);
      self.mFlag.setColorAt(fn, col.setHex(side === v.player ? playerColor : 0x222222));
      fn++;
    });
    this.mFlag.count = fn;
    this.mFlag.instanceMatrix.needsUpdate = true;
    if (this.mFlag.instanceColor) this.mFlag.instanceColor.needsUpdate = true;

    // 粒子
    var arr = this.dust.geometry.attributes.position.array;
    this.dustP.forEach(function (p, i) {
      p.life -= dt;
      if (p.life > 0) {
        p.y += dt * 1.2;
        arr[i * 3] = p.x;
        arr[i * 3 + 1] = p.y;
        arr[i * 3 + 2] = p.z;
      } else arr[i * 3 + 1] = -50;
    });
    this.dust.geometry.attributes.position.needsUpdate = true;
    var farr = this.flash.geometry.attributes.position.array;
    this.flashP.forEach(function (p, i) {
      p.life -= dt;
      farr[i * 3] = p.x;
      farr[i * 3 + 1] = p.life > 0 ? p.y : -50;
      farr[i * 3 + 2] = p.z;
    });
    this.flash.geometry.attributes.position.needsUpdate = true;

    var th = this.theta + Math.sin(t * 0.15) * 0.08;
    this.camera.position.set(Math.sin(th) * 58, 32, Math.cos(th) * 58);
    this.camera.lookAt(0, 0, 2);
    this.renderer.render(this.scene, this.camera);
  };

  Battle.prototype.dispose = function () {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.onResize);
    this.scene.traverse(function (o) {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
    this.renderer.dispose();
    if (this.renderer.domElement.parentNode) this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
  };

  window.PriTestJomonBattle3D = {
    create: function (container, threeLib) {
      return new Battle(container, threeLib);
    },
  };
})();
