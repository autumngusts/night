/* イヌスノー（狗雪）畫面特效（docs/inusnow_design.md §10、第 2 階段計畫 T8）：只負責畫面，不影響規則（可以用 Math.random）。
   粒子（甩雪、落地噴雪、旗門碎片、紙花、興奮度的光點）、降雪、雪痕、陰影貼圖、天空、雪面細節貼圖、名牌。 */
(function (root) {
  "use strict";

  function canvasTex(THREE, w, h, draw) {
    var c = document.createElement("canvas");
    c.width = w; c.height = h;
    draw(c.getContext("2d"), w, h);
    var tx = new THREE.CanvasTexture(c);
    tx.needsUpdate = true;
    return tx;
  }

  // 柔邊圓點（粒子用）
  function dotTex(THREE) {
    return canvasTex(THREE, 64, 64, function (g, w) {
      var gr = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
      gr.addColorStop(0, "rgba(255,255,255,1)");
      gr.addColorStop(0.45, "rgba(255,255,255,.75)");
      gr.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = gr; g.fillRect(0, 0, w, w);
    });
  }
  // 選手腳下的陰影
  function shadowTex(THREE) {
    return canvasTex(THREE, 128, 128, function (g, w) {
      var gr = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
      gr.addColorStop(0, "rgba(20,40,70,.55)");
      gr.addColorStop(0.6, "rgba(20,40,70,.22)");
      gr.addColorStop(1, "rgba(20,40,70,0)");
      g.fillStyle = gr; g.fillRect(0, 0, w, w);
    });
  }
  // 雪面細節（細顆粒＋壓雪紋），用世界座標重複貼
  function snowTex(THREE) {
    var tx = canvasTex(THREE, 256, 256, function (g, w, h) {
      g.fillStyle = "#ffffff"; g.fillRect(0, 0, w, h);
      for (var i = 0; i < 2600; i++) {
        var v = 228 + Math.floor(Math.random() * 27);
        g.fillStyle = "rgb(" + v + "," + v + "," + Math.min(255, v + 6) + ")";
        g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2);
      }
      g.globalAlpha = 0.07;
      g.fillStyle = "#7d93b2";
      for (var y = 0; y < h; y += 6) g.fillRect(0, y, w, 2);
      g.globalAlpha = 1;
    });
    tx.wrapS = tx.wrapT = THREE.RepeatWrapping;
    return tx;
  }

  // ---------------- 粒子 ----------------
  function Particles(THREE, scene, max) {
    var pos = new Float32Array(max * 3), col = new Float32Array(max * 3), size = new Float32Array(max), alpha = new Float32Array(max);
    var vel = new Float32Array(max * 3), life = new Float32Array(max), age = new Float32Array(max), grav = new Float32Array(max), size0 = new Float32Array(max), a0 = new Float32Array(max), grow = new Float32Array(max);
    var geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("aColor", new THREE.BufferAttribute(col, 3));
    geo.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    geo.setAttribute("aAlpha", new THREE.BufferAttribute(alpha, 1));
    var mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: dotTex(THREE) }, scale: { value: 400 } },
      vertexShader: "attribute vec3 aColor; attribute float aSize; attribute float aAlpha; varying vec3 vC; varying float vA;" +
        "uniform float scale; void main(){ vC=aColor; vA=aAlpha; vec4 mv=modelViewMatrix*vec4(position,1.0); gl_PointSize=aSize*scale/max(0.5,-mv.z); gl_Position=projectionMatrix*mv; }",
      fragmentShader: "uniform sampler2D map; varying vec3 vC; varying float vA; void main(){ vec4 t=texture2D(map, gl_PointCoord); if(t.a*vA<0.01) discard; gl_FragColor=vec4(vC, t.a*vA); }",
      transparent: true, depthWrite: false,
    });
    var pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    scene.add(pts);
    var next = 0;
    for (var i = 0; i < max; i++) { alpha[i] = 0; life[i] = 0; }
    return {
      // o：{x,y,z, vx,vy,vz, life, size, r,g,b（顏色 0～1）, a, grav（重力倍率）, grow}
      emit: function (o) {
        var k = next; next = (next + 1) % max;
        pos[k * 3] = o.x; pos[k * 3 + 1] = o.y; pos[k * 3 + 2] = o.z;
        vel[k * 3] = o.vx || 0; vel[k * 3 + 1] = o.vy || 0; vel[k * 3 + 2] = o.vz || 0;
        life[k] = o.life || 1; age[k] = 0; grav[k] = o.grav === undefined ? 1 : o.grav;
        size0[k] = o.size || 0.2; a0[k] = o.a === undefined ? 1 : o.a; grow[k] = o.grow || 0;
        col[k * 3] = o.r === undefined ? 1 : o.r; col[k * 3 + 1] = o.g === undefined ? 1 : o.g; col[k * 3 + 2] = o.b === undefined ? 1 : o.b;
      },
      update: function (dt, h) {
        mat.uniforms.scale.value = (h || 800) * 0.5;
        for (var i = 0; i < max; i++) {
          if (life[i] <= 0) continue;
          age[i] += dt;
          var t = age[i] / life[i];
          if (t >= 1) { life[i] = 0; alpha[i] = 0; continue; }
          vel[i * 3 + 1] -= 9.8 * grav[i] * dt;
          var dr = 1 - 1.6 * dt;
          vel[i * 3] *= dr; vel[i * 3 + 1] *= dr; vel[i * 3 + 2] *= dr;
          pos[i * 3] += vel[i * 3] * dt; pos[i * 3 + 1] += vel[i * 3 + 1] * dt; pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
          size[i] = size0[i] * (1 + grow[i] * t);
          alpha[i] = a0[i] * (t < 0.1 ? t / 0.1 : 1 - (t - 0.1) / 0.9);
        }
        geo.attributes.position.needsUpdate = true;
        geo.attributes.aSize.needsUpdate = true;
        geo.attributes.aAlpha.needsUpdate = true;
        geo.attributes.aColor.needsUpdate = true;
      },
      dispose: function () { geo.dispose(); mat.dispose(); scene.remove(pts); },
    };
  }

  // ---------------- 降雪（鏡頭周圍的盒子裡循環） ----------------
  function Snowfall(THREE, scene, count, box) {
    var pos = new Float32Array(count * 3), spd = new Float32Array(count), sway = new Float32Array(count);
    for (var i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * box; pos[i * 3 + 1] = Math.random() * box * 0.6; pos[i * 3 + 2] = (Math.random() - 0.5) * box;
      spd[i] = 0.8 + Math.random() * 1.4; sway[i] = Math.random() * 6.28;
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    var mat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.16, map: dotTex(THREE), transparent: true, opacity: 0.85, depthWrite: false });
    var pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    scene.add(pts);
    var t = 0;
    return {
      obj: pts,
      update: function (dt, cx, cy, cz, density) {
        t += dt;
        pts.visible = density > 0;
        mat.opacity = 0.85 * (density === undefined ? 1 : density);
        pts.position.set(cx, cy - box * 0.25, cz);
        for (var i = 0; i < count; i++) {
          pos[i * 3 + 1] -= spd[i] * dt;
          pos[i * 3] += Math.sin(t * 0.8 + sway[i]) * 0.3 * dt;
          if (pos[i * 3 + 1] < 0) { pos[i * 3 + 1] += box * 0.6; pos[i * 3] = (Math.random() - 0.5) * box; pos[i * 3 + 2] = (Math.random() - 0.5) * box; }
        }
        geo.attributes.position.needsUpdate = true;
      },
      dispose: function () { geo.dispose(); mat.dispose(); scene.remove(pts); },
    };
  }

  // ---------------- 雪痕（板子劃過的帶狀網格，越舊越淡） ----------------
  function Trail(THREE, scene, max, color, noFade) {
    var fade = !noFade;
    var pos = new Float32Array(max * 2 * 3), al = new Float32Array(max * 2);
    var idx = [];
    for (var i = 0; i < max - 1; i++) { var a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("aAlpha", new THREE.BufferAttribute(al, 1));
    geo.setIndex(idx);
    var mat = new THREE.ShaderMaterial({
      uniforms: { color: { value: new THREE.Color(color || 0x9fb6d4) } },
      vertexShader: "attribute float aAlpha; varying float vA; void main(){ vA=aAlpha; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }",
      fragmentShader: "uniform vec3 color; varying float vA; void main(){ gl_FragColor=vec4(color, vA*0.4); }",
      transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    var mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    scene.add(mesh);
    var pts = [], lastX = null, lastZ = null;
    function rebuild() {
      var n = pts.length;
      for (var i = 0; i < max; i++) {
        var p = pts[i < n ? i : n - 1];
        if (!p) { al[i * 2] = al[i * 2 + 1] = 0; continue; }
        var k = i * 6;
        pos[k] = p[0] - p[3] * p[5]; pos[k + 1] = p[1]; pos[k + 2] = p[2] - p[4] * p[5];
        pos[k + 3] = p[0] + p[3] * p[5]; pos[k + 4] = p[1]; pos[k + 5] = p[2] + p[4] * p[5];
        var f = i < n ? (fade ? (i / n) : 0.75) * p[6] : 0;
        al[i * 2] = al[i * 2 + 1] = f;
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.aAlpha.needsUpdate = true;
    }
    return {
      // x,y,z＝板子中心；hx,hz＝板頭方向；on＝是否在雪面上
      add: function (x, y, z, hx, hz, w, on) {
        if (lastX !== null) {
          var dx = x - lastX, dz = z - lastZ;
          if (dx * dx + dz * dz < 0.36) return;
        }
        lastX = x; lastZ = z;
        // 寬度方向＝板頭的垂直方向（刻滑時窄、橫滑時寬）
        pts.push([x, y + 0.03, z, -hz, hx, w, on ? 1 : 0]);
        if (pts.length > max) pts.shift();
        rebuild();
      },
      // 一次加入整條軌跡（溝痕：CPU 先滑過的線）
      bulk: function (list) {
        pts = list.slice(-max);
        rebuild();
      },
      reset: function () { pts = []; lastX = null; rebuild(); },
      dispose: function () { geo.dispose(); mat.dispose(); scene.remove(mesh); },
    };
  }

  // ---------------- 天空（漸層球＋太陽光暈） ----------------
  function Sky(THREE, scene, opts) {
    opts = opts || {};
    var geo = new THREE.SphereGeometry(5000, 32, 16);
    var mat = new THREE.ShaderMaterial({
      uniforms: {
        top: { value: new THREE.Color(opts.top || 0x2f74c8) }, mid: { value: new THREE.Color(opts.mid || 0x8fc1ee) }, bottom: { value: new THREE.Color(opts.bottom || 0xe6f0f8) },
        sunDir: { value: new THREE.Vector3(-0.5, 0.55, -0.65).normalize() }, sunCol: { value: new THREE.Color(0xfff3d6) },
      },
      vertexShader: "varying vec3 vP; void main(){ vP=normalize(position); vec4 p=projectionMatrix*modelViewMatrix*vec4(position,1.0); gl_Position=p.xyww; }",
      fragmentShader: "uniform vec3 top; uniform vec3 mid; uniform vec3 bottom; uniform vec3 sunDir; uniform vec3 sunCol; varying vec3 vP;" +
        "void main(){ float h=vP.y; vec3 c = h>0.12 ? mix(mid, top, smoothstep(0.12,0.75,h)) : mix(bottom, mid, smoothstep(-0.05,0.12,h));" +
        " float s=max(0.0, dot(normalize(vP), sunDir)); c += sunCol*(pow(s,600.0)*1.4 + pow(s,24.0)*0.28); gl_FragColor=vec4(c,1.0); }",
      side: THREE.BackSide, depthWrite: false,
    });
    var mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = -10;
    mesh.frustumCulled = false;
    scene.add(mesh);
    return { mesh: mesh, follow: function (cam) { mesh.position.copy(cam.position); }, dispose: function () { geo.dispose(); mat.dispose(); scene.remove(mesh); } };
  }

  // 名牌（Sprite）
  function nameTag(THREE, text, color) {
    var tx = canvasTex(THREE, 256, 64, function (g, w, h) {
      g.font = "bold 30px sans-serif";
      var tw = Math.min(w - 8, g.measureText(text).width + 28);
      var x0 = (w - tw) / 2;
      g.fillStyle = "rgba(10,25,45,.62)";
      if (g.roundRect) { g.beginPath(); g.roundRect(x0, 10, tw, 44, 22); g.fill(); } else g.fillRect(x0, 10, tw, 44);
      g.fillStyle = color || "#ffffff";
      g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText(text, w / 2, 33);
    });
    var sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tx, transparent: true, depthWrite: false }));
    sp.scale.set(1.5, 0.375, 1);
    return sp;
  }

  // 帶字的旗子／看板（終點拱門、公園看板）
  function bannerTex(THREE, text, bg, fg) {
    return canvasTex(THREE, 512, 96, function (g, w, h) {
      var gr = g.createLinearGradient(0, 0, w, 0);
      gr.addColorStop(0, bg[0]); gr.addColorStop(1, bg[1]);
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      g.fillStyle = "rgba(255,255,255,.18)";
      for (var x = -h; x < w; x += 36) { g.beginPath(); g.moveTo(x, h); g.lineTo(x + h, 0); g.lineTo(x + h + 12, 0); g.lineTo(x + 12, h); g.fill(); }
      g.font = "900 58px sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
      g.fillStyle = "rgba(0,0,0,.25)"; g.fillText(text, w / 2 + 3, h / 2 + 4);
      g.fillStyle = fg || "#ffffff"; g.fillText(text, w / 2, h / 2 + 1);
    });
  }

  root.PriTestInusnowFx = { Particles: Particles, Snowfall: Snowfall, Trail: Trail, Sky: Sky, nameTag: nameTag, bannerTex: bannerTex, shadowTex: shadowTex, snowTex: snowTex, dotTex: dotTex };
})(typeof window !== "undefined" ? window : globalThis);
