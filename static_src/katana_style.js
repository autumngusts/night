// 神前鍛刀對決（katana）：美術風格與對刀場的戰鬥場景（使用者指定 2026-10-26：
//   「神前刀光也同樣增加美術風格，最後的戰鬥也附帶許多美術背景以及特效」）。
// **只是畫面**：不用對刀場引擎的亂數、不改對刀場狀態（同 katana_arena_pov.js 的原則），勝負、連線同步、重播、批次測試都不受影響。
//   LOOKS / look() / setLook(id) / applyLook(root)：整個遊戲的美術風格（#kt-app 上的 class＋對刀場畫布解析度），存在 localStorage
//   STAGES / stagePref() / setStagePref(id) / stageFor(seed)：戰鬥場景；「auto」依對局種子決定（連線時大家看到同一個場景）
//   createScene(stageId)：一場對刀的場景演出（背景、地面、天氣粒子、撞擊反應、地面龜裂、開場字幕、決著演出、刀視角的天空）
(function () {
  "use strict";

  function N(zh, ja, en) { return { zh: zh, ja: ja, en: en }; }
  var TAU = Math.PI * 2;

  // ---------------- 美術風格 ----------------
  var LOOK_KEY = "pritest-katana-look", STAGE_KEY = "pritest-katana-stage";
  var LOOKS = [
    { id: "std", name: N("標準", "標準", "Standard") },
    { id: "sumi", name: N("水墨", "水墨画", "Ink wash") },
    { id: "ukiyo", name: N("浮世繪", "浮世絵", "Ukiyo-e") },
    { id: "neon", name: N("霓虹", "ネオン", "Neon") },
    { id: "pixel", name: N("像素", "ドット絵", "Pixel") }
  ];
  function readKey(k, list, def) {
    try { var v = localStorage.getItem(k); return list.some(function (x) { return x.id === v; }) || v === "auto" ? v : def; } catch (e) { return def; }
  }
  var curLook = readKey(LOOK_KEY, LOOKS, "std");
  function look() { return curLook; }
  function setLook(id) {
    if (!LOOKS.some(function (x) { return x.id === id; })) return;
    curLook = id;
    try { localStorage.setItem(LOOK_KEY, id); } catch (e) { /* 只是記不住 */ }
  }
  function applyLook(root) {
    if (!root) return;
    LOOKS.forEach(function (x) { root.classList.toggle("kt-look-" + x.id, x.id === curLook); });
  }
  // 像素風格：畫布用低解析度畫，CSS 放大時保留方塊
  function resScale() { return curLook === "pixel" ? 0.28 : 1; }

  // ---------------- 小工具 ----------------
  function hash(str) {
    var h = 0x811c9dc5;
    str = String(str);
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return h >>> 0;
  }
  function rand() { return Math.random(); }
  function radial(ctx, r0, r1, c0, c1) { var g = ctx.createRadialGradient(0, 0, r0, 0, 0, r1); g.addColorStop(0, c0); g.addColorStop(1, c1); return g; }
  function disc(ctx, x, y, r, c) { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); }
  // 角落的位置（世界單位）：場地半徑 100，畫布半寬 128
  var CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, 1]];

  // ---------------- 場景（世界單位；ctx 原點在場地中心，s＝世界→像素） ----------------
  // back：場外佈景；floor：場地地面花紋；amb：天氣粒子（每秒產生數、種類）；hit：撞擊時噴出的場景粒子；pov：刀視角的天空・地面・遠景
  var STAGES = [
    { id: "dohyo", name: N("神前土俵", "神前の土俵", "Sacred ring"), bg: ["#2a1f17", "#0c0907"], floor: ["#5a4a3b", "#231c16"], rim: ["#c9a65a", "#8a6d33"],
      back: function (ctx, s, t) {
        var cols = ["#2b5fa8", "#b8322a", "#e8e4d8", "#1b1b1b"];
        CORNERS.forEach(function (c, i) {
          var x = c[0] * 118 * s, y = c[1] * 118 * s;
          disc(ctx, x, y, 9 * s, "rgba(0,0,0,0.4)");
          ctx.fillStyle = cols[i]; ctx.fillRect(x - 5 * s, y - 5 * s, 10 * s, 10 * s);
          var fl = 0.8 + 0.2 * Math.sin(t * 5 + i);
          var g = ctx.createRadialGradient(x * 0.86, y * 0.86, 0, x * 0.86, y * 0.86, 14 * s);
          g.addColorStop(0, "rgba(255,190,110," + 0.6 * fl + ")"); g.addColorStop(1, "rgba(255,140,60,0)");
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x * 0.86, y * 0.86, 14 * s, 0, TAU); ctx.fill();
        });
      },
      amb: { kind: "mote", rate: 4 }, hit: "spark",
      pov: { sky: ["#07060c", "#1a1218", "#3a2418"], gnd: ["#2a2018", "#5a4532", "#8a6a4a"], deco: "lanterns" } },

    { id: "shrine", name: N("神社境內", "神社の境内", "Shrine grounds"), bg: ["#3b4038", "#141712"], floor: ["#a5a196", "#5f5c54"], rim: ["#d8d2c2", "#8d877a"],
      floorDeco: function (ctx, s, t, dpr) {
        ctx.strokeStyle = "rgba(60,56,48,0.35)"; ctx.lineWidth = 1 * dpr;
        for (var r = 14; r < 100; r += 7) { ctx.beginPath(); ctx.arc(0, 0, r * s, 0, TAU); ctx.stroke(); }
      },
      back: function (ctx, s, t) {
        // 鳥居（左上）
        ctx.save(); ctx.translate(-112 * s, -112 * s); ctx.rotate(-Math.PI / 4);
        ctx.fillStyle = "#c0392b"; ctx.fillRect(-22 * s, -4 * s, 44 * s, 5 * s); ctx.fillRect(-18 * s, 3 * s, 36 * s, 3 * s);
        ctx.fillStyle = "#1b1b1b"; ctx.fillRect(-24 * s, -6 * s, 48 * s, 2.5 * s);
        ctx.fillStyle = "#a32d22"; ctx.fillRect(-14 * s, 0, 4 * s, 22 * s); ctx.fillRect(10 * s, 0, 4 * s, 22 * s);
        ctx.restore();
        // 石燈籠與杉樹
        [[1, -1], [1, 1], [-1, 1]].forEach(function (c, i) {
          var x = c[0] * 116 * s, y = c[1] * 116 * s;
          disc(ctx, x + c[0] * 4 * s, y + c[1] * 4 * s, 14 * s, "#1f2a1c"); disc(ctx, x + c[0] * 8 * s, y - c[1] * 6 * s, 10 * s, "#2a3826");
          ctx.fillStyle = "#9b958a"; ctx.fillRect(x - c[0] * 10 * s - 4 * s, y - c[1] * 10 * s - 4 * s, 8 * s, 8 * s);
          var fl = 0.75 + 0.25 * Math.sin(t * 4 + i * 2);
          disc(ctx, x - c[0] * 10 * s, y - c[1] * 10 * s, 2.5 * s, "rgba(255,210,130," + fl + ")");
        });
      },
      amb: { kind: "firefly", rate: 3 }, hit: "paper",
      pov: { sky: ["#1b1a2e", "#5b3a4a", "#d0804a"], gnd: ["#4a4840", "#7e7a6e", "#a5a196"], deco: "torii" } },

    { id: "bamboo", name: N("竹林", "竹林", "Bamboo grove"), bg: ["#1f3a24", "#0a140c"], floor: ["#5d6b45", "#2a331e"], rim: ["#8aa05a", "#4f6230"],
      back: function (ctx, s, t) {
        for (var i = 0; i < 26; i++) {
          var a = i / 26 * TAU + 0.11, d = 112 + (i % 3) * 6;
          var x = Math.cos(a) * d * s, y = Math.sin(a) * d * s, sw = Math.sin(t * 1.4 + i) * 1.5 * s;
          disc(ctx, x + sw, y, (4.5 + (i % 2)) * s, i % 3 ? "#5f8a3a" : "#7aa64a");
          ctx.strokeStyle = "rgba(30,50,20,0.7)"; ctx.lineWidth = 1 * s; ctx.beginPath(); ctx.arc(x + sw, y, (4.5 + (i % 2)) * s, 0, TAU); ctx.stroke();
          disc(ctx, x + sw + 1.2 * s, y - 1.2 * s, 1.5 * s, "rgba(220,240,180,0.5)");
        }
      },
      amb: { kind: "bamboo", rate: 5 }, hit: "bamboo",
      pov: { sky: ["#0d1f12", "#2c4a2a", "#7aa070"], gnd: ["#2a331e", "#4a5a35", "#5d6b45"], deco: "bamboo" } },

    { id: "snow", name: N("雪夜", "雪の夜", "Snowy night"), bg: ["#1c2a44", "#070b16"], floor: ["#a9bccd", "#4a5c72"], rim: ["#eef4fa", "#9fb2c6"],
      floorDeco: function (ctx, s, t, dpr) {
        ctx.fillStyle = "rgba(255,255,255,0.18)";
        for (var i = 0; i < 40; i++) { var a = i * 2.39, r = (i * 37 % 95); ctx.beginPath(); ctx.arc(Math.cos(a) * r * s, Math.sin(a) * r * s, (1 + i % 3) * s, 0, TAU); ctx.fill(); }
      },
      back: function (ctx, s, t) {
        disc(ctx, 108 * s, -110 * s, 13 * s, "rgba(250,250,235,0.9)"); disc(ctx, 103 * s, -113 * s, 11 * s, "#14203a");
        [[-1, -1], [-1, 1], [1, 1]].forEach(function (c) {
          for (var k = 0; k < 2; k++) {
            var x = c[0] * (112 - k * 10) * s, y = c[1] * (106 + k * 10) * s;
            ctx.fillStyle = "#1d3a2c"; ctx.beginPath(); ctx.moveTo(x, y - 14 * s); ctx.lineTo(x + 9 * s, y + 8 * s); ctx.lineTo(x - 9 * s, y + 8 * s); ctx.fill();
            ctx.fillStyle = "#eef4fa"; ctx.beginPath(); ctx.moveTo(x, y - 14 * s); ctx.lineTo(x + 4 * s, y - 5 * s); ctx.lineTo(x - 4 * s, y - 5 * s); ctx.fill();
          }
        });
      },
      amb: { kind: "snow", rate: 30 }, hit: "snow",
      pov: { sky: ["#03060f", "#14203a", "#3a4a6a"], gnd: ["#4a5c72", "#7d92a8", "#c9d6e2"], deco: "moon" } },

    { id: "sakura", name: N("夜櫻", "夜桜", "Night cherry blossoms"), bg: ["#3a2236", "#100810"], floor: ["#5b4250", "#241722"], rim: ["#f1b6cf", "#a8607e"],
      floorDeco: function (ctx, s, t, dpr) {
        for (var i = 0; i < 50; i++) { var a = i * 2.39, r = (i * 53 % 96); ctx.fillStyle = "rgba(255,180,210," + (0.15 + (i % 4) * 0.06) + ")"; ctx.beginPath(); ctx.ellipse(Math.cos(a) * r * s, Math.sin(a) * r * s, 2 * s, 1.2 * s, a, 0, TAU); ctx.fill(); }
      },
      back: function (ctx, s, t) {
        disc(ctx, -106 * s, -108 * s, 12 * s, "rgba(255,248,230,0.85)");
        [[1, -1], [1, 1], [-1, 1]].forEach(function (c, i) {
          var x = c[0] * 112 * s, y = c[1] * 112 * s;
          for (var k = 0; k < 6; k++) disc(ctx, x + Math.cos(k + i) * 9 * s, y + Math.sin(k * 1.7 + i) * 9 * s, (7 + k % 3 * 2) * s, k % 2 ? "rgba(255,170,205,0.85)" : "rgba(255,205,225,0.9)");
          var fl = 0.7 + 0.3 * Math.sin(t * 3 + i);
          disc(ctx, x - c[0] * 18 * s, y - c[1] * 2 * s, 3 * s, "rgba(255,120,80," + fl + ")");
        });
      },
      amb: { kind: "petal", rate: 14 }, hit: "petal",
      pov: { sky: ["#0c0612", "#3a2236", "#7a4a6a"], gnd: ["#241722", "#4a3442", "#5b4250"], deco: "sakura" } },

    { id: "forge", name: N("鍛冶火山", "鍛冶の火山", "Forge volcano"), bg: ["#3a1208", "#0a0302"], floor: ["#3a2a24", "#120a08"], rim: ["#ff7a2a", "#7a2a10"],
      floorDeco: function (ctx, s, t, dpr) {
        var pulse = 0.5 + 0.5 * Math.sin(t * 2.2);
        ctx.lineCap = "round";
        for (var i = 0; i < 9; i++) {
          var a = i / 9 * TAU + 0.3, r0 = 18 + (i % 3) * 10;
          ctx.strokeStyle = "rgba(255," + Math.round(110 + 60 * pulse) + ",30," + (0.35 + 0.35 * pulse) + ")"; ctx.lineWidth = (1.2 + pulse) * dpr;
          ctx.beginPath(); ctx.moveTo(Math.cos(a) * r0 * s, Math.sin(a) * r0 * s);
          for (var k = 1; k <= 4; k++) { var rr = r0 + k * 17, aa = a + Math.sin(i * 3 + k) * 0.18; ctx.lineTo(Math.cos(aa) * rr * s, Math.sin(aa) * rr * s); }
          ctx.stroke();
        }
      },
      back: function (ctx, s, t) {
        CORNERS.forEach(function (c, i) {
          var x = c[0] * 116 * s, y = c[1] * 116 * s, p = 0.75 + 0.25 * Math.sin(t * 2 + i);
          var g = ctx.createRadialGradient(x, y, 0, x, y, 20 * s);
          g.addColorStop(0, "rgba(255,230,120," + p + ")"); g.addColorStop(0.45, "rgba(255,110,20," + 0.8 * p + ")"); g.addColorStop(1, "rgba(120,20,0,0)");
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 20 * s, 0, TAU); ctx.fill();
        });
      },
      amb: { kind: "ember", rate: 22 }, hit: "fire",
      pov: { sky: ["#120302", "#4a1206", "#c0461a"], gnd: ["#120a08", "#2a1a14", "#3a2a24"], deco: "volcano" } },

    { id: "autumn", name: N("紅葉谷", "紅葉の谷", "Maple valley"), bg: ["#4a2a14", "#140a04"], floor: ["#6b4a2a", "#2b1a0c"], rim: ["#e0853a", "#8a3e16"],
      floorDeco: function (ctx, s, t, dpr) {
        for (var i = 0; i < 45; i++) { var a = i * 2.39, r = (i * 41 % 96); ctx.fillStyle = ["rgba(214,70,30,0.35)", "rgba(230,140,40,0.35)", "rgba(180,40,30,0.3)"][i % 3]; ctx.beginPath(); ctx.ellipse(Math.cos(a) * r * s, Math.sin(a) * r * s, 2.4 * s, 1.4 * s, a, 0, TAU); ctx.fill(); }
      },
      back: function (ctx, s, t) {
        CORNERS.forEach(function (c, i) {
          var x = c[0] * 114 * s, y = c[1] * 114 * s;
          for (var k = 0; k < 7; k++) disc(ctx, x + Math.cos(k * 0.9 + i) * 10 * s, y + Math.sin(k * 1.3 + i) * 10 * s, (6 + k % 3 * 2) * s, ["#c0392b", "#e67e22", "#d35400", "#a93226"][(k + i) % 4]);
        });
      },
      amb: { kind: "leaf", rate: 10 }, hit: "leaf",
      pov: { sky: ["#2a1408", "#8a4a1e", "#e0a050"], gnd: ["#2b1a0c", "#4a3018", "#6b4a2a"], deco: "maple" } },

    { id: "storm", name: N("雷雲", "雷雲", "Thunderstorm"), bg: ["#2a3038", "#0a0c10"], floor: ["#4a5058", "#1a1e24"], rim: ["#9aa4b0", "#4a525c"],
      floorDeco: function (ctx, s, t, dpr) {
        for (var i = 0; i < 8; i++) { var a = i * 2.1, r = 20 + i * 9; ctx.fillStyle = "rgba(160,180,200,0.12)"; ctx.beginPath(); ctx.ellipse(Math.cos(a) * r * s, Math.sin(a) * r * s, (8 + i % 3 * 4) * s, (4 + i % 2 * 2) * s, a, 0, TAU); ctx.fill(); }
      },
      back: function (ctx, s, t) {
        CORNERS.forEach(function (c, i) {
          for (var k = 0; k < 5; k++) disc(ctx, c[0] * (110 + Math.sin(t * 0.5 + k) * 3) * s + k * 5 * s * -c[0], c[1] * 112 * s + Math.cos(k) * 5 * s, (9 + k % 2 * 3) * s, "rgba(40,46,56,0.9)");
        });
      },
      amb: { kind: "rain", rate: 60 }, hit: "spark", thunder: true,
      pov: { sky: ["#05070a", "#1e242c", "#3a424e"], gnd: ["#1a1e24", "#30363e", "#4a5058"], deco: "storm" } },

    { id: "lake", name: N("月下水面", "月下の水面", "Moonlit lake"), bg: ["#12284a", "#030812"], floor: ["#2a4a6a", "#0b1a2c"], rim: ["#b8d0e8", "#4a6a8a"],
      floorDeco: function (ctx, s, t, dpr) {
        // 月的倒影＋擴散的漣漪
        var g = ctx.createRadialGradient(28 * s, -24 * s, 0, 28 * s, -24 * s, 26 * s);
        g.addColorStop(0, "rgba(250,245,220,0.35)"); g.addColorStop(1, "rgba(250,245,220,0)");
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(28 * s, -24 * s, 26 * s, 0, TAU); ctx.fill();
        ctx.strokeStyle = "rgba(200,225,255,0.12)"; ctx.lineWidth = 1 * dpr;
        for (var i = 0; i < 6; i++) { var r = ((t * 10 + i * 17) % 100); ctx.beginPath(); ctx.arc(0, 0, r * s, 0, TAU); ctx.stroke(); }
      },
      back: function (ctx, s, t) {
        disc(ctx, 108 * s, -110 * s, 12 * s, "rgba(250,248,230,0.95)");
        CORNERS.forEach(function (c, i) {
          if (i === 1) return;
          for (var k = 0; k < 7; k++) {
            var x = c[0] * (108 + k % 3 * 5) * s + k * 2 * s, y = c[1] * 112 * s, sw = Math.sin(t * 1.8 + k) * 2 * s;
            ctx.strokeStyle = "#2c4a3a"; ctx.lineWidth = 1.5 * s; ctx.beginPath(); ctx.moveTo(x, y + 8 * s); ctx.lineTo(x + sw, y - 10 * s); ctx.stroke();
          }
        });
      },
      amb: { kind: "firefly", rate: 6 }, hit: "ripple",
      pov: { sky: ["#02040c", "#0c1c38", "#2a4a70"], gnd: ["#0b1a2c", "#1e3a58", "#2a4a6a"], deco: "moon" } }
  ];
  var STAGE = {};
  STAGES.forEach(function (x) { STAGE[x.id] = x; });

  var curStage = readKey(STAGE_KEY, STAGES, "auto");
  function stagePref() { return curStage; }
  function setStagePref(id) {
    if (id !== "auto" && !STAGE[id]) return;
    curStage = id;
    try { localStorage.setItem(STAGE_KEY, id); } catch (e) { /* 只是記不住 */ }
  }
  // auto：依對局種子決定（同一場對刀，連線的每個人都看到同一個場景）
  function stageFor(seed) { return curStage !== "auto" ? curStage : STAGES[hash("stage|" + seed) % STAGES.length].id; }

  // ---------------- 一場對刀的場景演出 ----------------
  function createScene(stageId) {
    var sc = { stage: STAGE[stageId] || STAGES[0], t: 0, parts: [], cracks: [], intro: { life: 2.2, max: 2.2 }, finale: null, thunder: 0, thunderT: 4 + rand() * 4, bolt: null };
    sc.setStage = function (id) { if (STAGE[id]) { sc.stage = STAGE[id]; sc.parts = []; } };

    function spawn(kind, x, y, burst) {
      var p = { kind: kind, x: x, y: y, vx: 0, vy: 0, life: 3, max: 3, rot: rand() * TAU, vr: (rand() - 0.5) * 4 };
      if (kind === "snow") { p.vx = (rand() - 0.5) * 10; p.vy = 14 + rand() * 12; p.life = p.max = 6; p.r = 0.8 + rand() * 1.4; }
      else if (kind === "petal" || kind === "leaf" || kind === "bamboo") { p.vx = 8 + rand() * 10; p.vy = 10 + rand() * 10; p.life = p.max = 6; }
      else if (kind === "ember") { p.vx = (rand() - 0.5) * 12; p.vy = -(16 + rand() * 20); p.life = p.max = 2.5 + rand(); }
      else if (kind === "rain") { p.vx = -30; p.vy = 210; p.life = p.max = 1.3; }
      else if (kind === "firefly" || kind === "mote") { p.vx = (rand() - 0.5) * 6; p.vy = (rand() - 0.5) * 6; p.life = p.max = 4 + rand() * 3; }
      else if (kind === "paper") { p.vx = (rand() - 0.5) * 30; p.vy = 12 + rand() * 10; p.life = p.max = 3; }
      if (burst) { var a = rand() * TAU, sp = 30 + rand() * 70; p.vx = Math.cos(a) * sp; p.vy = Math.sin(a) * sp; p.life = p.max = Math.min(p.max, 1.4 + rand()); p.burst = true; }
      sc.parts.push(p);
    }

    sc.tick = function (dt) {
      if (!(dt > 0)) return;
      sc.t += dt;
      var st = sc.stage, amb = st.amb;
      if (amb && sc.parts.length < 260) {
        var n = amb.rate * dt, k = Math.floor(n) + (rand() < n % 1 ? 1 : 0);
        for (var i = 0; i < k; i++) {
          if (amb.kind === "ember") spawn("ember", (rand() - 0.5) * 240, 120);
          else if (amb.kind === "firefly" || amb.kind === "mote") spawn(amb.kind, (rand() - 0.5) * 240, (rand() - 0.5) * 240);
          else spawn(amb.kind, (rand() - 0.5) * 260 - 30, -130);
        }
      }
      sc.parts = sc.parts.filter(function (p) {
        p.life -= dt;
        if (p.kind === "petal" || p.kind === "leaf" || p.kind === "bamboo") { p.vx += Math.sin(sc.t * 2 + p.rot) * 12 * dt; }
        if (p.kind === "firefly" || p.kind === "mote") { p.vx += (rand() - 0.5) * 30 * dt; p.vy += (rand() - 0.5) * 30 * dt; }
        if (p.burst) { p.vx *= 0.94; p.vy = p.vy * 0.94 + 30 * dt; }
        p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
        return p.life > 0 && p.y < 140 && p.y > -150;
      });
      sc.cracks = sc.cracks.filter(function (c) { c.life -= dt; return c.life > 0; });
      sc.rippleCd = Math.max(0, (sc.rippleCd || 0) - dt);
      // 雷雲：不定時打雷（畫面閃白＋角落的落雷）
      if (st.thunder) {
        sc.thunderT -= dt;
        if (sc.thunderT <= 0) { sc.thunderT = 5 + rand() * 6; sc.flashThunder(); }
      }
      if (sc.thunder > 0) sc.thunder -= dt;
      if (sc.bolt) { sc.bolt.life -= dt; if (sc.bolt.life <= 0) sc.bolt = null; }
    };
    // 開場字幕與決著演出用真實時間（不跟著頓幀・慢動作停住；暫停中也照走）
    sc.tickUi = function (dt) {
      if (!(dt > 0)) return;
      if (sc.intro) { sc.intro.life -= dt; if (sc.intro.life <= 0) sc.intro = null; }
      if (sc.finale) sc.finale.life -= dt;
    };
    sc.flashThunder = function () {
      sc.thunder = 0.35;
      var c = CORNERS[Math.floor(rand() * 4)];
      sc.bolt = { x: c[0] * 105, y: c[1] * 105, life: 0.35, max: 0.35, seed: rand() };
    };

    // 引擎事件 → 場景反應（只看事件，不改狀態）
    sc.impact = function (e) {
      var hit = sc.stage.hit;
      if (e.type === "bind" || e.type === "strike" || e.type === "meteor" || e.type === "break") {
        sc.cracks.push({ x: e.x, y: e.y, life: 6, max: 6, n: 5 + Math.floor(rand() * 4), seed: rand() * TAU, big: e.type !== "bind" });
        if (sc.cracks.length > 14) sc.cracks.shift();
        var nb = e.type === "break" ? 40 : 18;
        for (var i = 0; i < nb; i++) spawn(hit === "ripple" ? "mote" : hit, e.x, e.y, true);
        if (sc.stage.thunder && (e.type === "break" || rand() < 0.3)) sc.flashThunder();
      } else if (e.type === "slash" || e.type === "mikiri" || e.type === "iai") {
        for (var j = 0; j < 8; j++) spawn(hit === "ripple" ? "mote" : hit, e.x, e.y, true);
      }
      // 水面：相接・撞壁・斬擊才起漣漪，而且不要太密（每個小火花都起的話畫面會被圈圈蓋滿）
      if (hit === "ripple" && !sc.rippleCd && (e.type === "bind" || e.type === "wall" || e.type === "strike" || e.type === "slash")) {
        sc.rippleCd = 0.25;
        sc.cracks.push({ x: e.x, y: e.y, life: 1.4, max: 1.4, ripple: true });
      }
    };

    sc.startFinale = function (text, sub, color) {
      if (sc.finale) return;
      sc.finale = { text: text, sub: sub, color: color || "#ffffff", life: 2.1, max: 2.1, seed: rand() * TAU };
    };
    sc.finaleDone = function () { return !!sc.finale && sc.finale.life <= 0; };

    // ---- 俯瞰：背景、場外佈景、地面、地面龜裂（場地與刀之前畫） ----
    sc.drawBack = function (ctx, px, s, dpr, R) {
      var st = sc.stage;
      ctx.fillStyle = radial(ctx, R * 0.6 * s, px * 0.75, st.bg[0], st.bg[1]);
      ctx.fillRect(-px, -px, px * 2, px * 2);
      if (st.back) st.back(ctx, s, sc.t, dpr);
      // 地面
      ctx.fillStyle = radial(ctx, 10 * s, R * s, st.floor[0], st.floor[1]);
      ctx.beginPath(); ctx.arc(0, 0, R * s, 0, TAU); ctx.fill();
      if (st.floorDeco) { ctx.save(); ctx.beginPath(); ctx.arc(0, 0, R * s, 0, TAU); ctx.clip(); st.floorDeco(ctx, s, sc.t, dpr); ctx.restore(); }
      ctx.strokeStyle = "rgba(255,240,220,0.06)"; ctx.lineWidth = 1 * dpr;
      [0.3, 0.55, 0.8].forEach(function (k) { ctx.beginPath(); ctx.arc(0, 0, R * k * s, 0, TAU); ctx.stroke(); });
      // 外圈
      ctx.lineWidth = 7 * s; ctx.strokeStyle = st.rim[0];
      ctx.beginPath(); ctx.arc(0, 0, (R + 3) * s, 0, TAU); ctx.stroke();
      ctx.setLineDash([5 * s, 5 * s]); ctx.strokeStyle = st.rim[1]; ctx.lineWidth = 3 * s;
      ctx.beginPath(); ctx.arc(0, 0, (R + 3) * s, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
      // 地面龜裂／水面漣漪
      sc.cracks.forEach(function (c) {
        var k = c.life / c.max;
        if (c.ripple) {
          ctx.strokeStyle = "rgba(200,230,255," + 0.6 * k + ")"; ctx.lineWidth = 1.5 * dpr;
          for (var r = 0; r < 2; r++) { ctx.beginPath(); ctx.arc(c.x * s, c.y * s, ((1 - k) * 34 + r * 7) * s, 0, TAU); ctx.stroke(); }
          return;
        }
        ctx.strokeStyle = "rgba(10,6,4," + 0.6 * Math.min(1, k * 2) + ")"; ctx.lineWidth = (c.big ? 2.2 : 1.4) * dpr; ctx.lineCap = "round";
        for (var i = 0; i < c.n; i++) {
          var a = c.seed + i / c.n * TAU, len = (c.big ? 22 : 13) * (0.6 + 0.4 * Math.sin(i * 7.3 + c.seed));
          ctx.beginPath(); ctx.moveTo(c.x * s, c.y * s);
          var x = c.x, y = c.y;
          for (var j = 1; j <= 3; j++) { var aa = a + Math.sin(i * 3 + j * 5 + c.seed) * 0.5; x += Math.cos(aa) * len / 3; y += Math.sin(aa) * len / 3; ctx.lineTo(x * s, y * s); }
          ctx.stroke();
        }
        if (sc.stage.id === "forge") { ctx.strokeStyle = "rgba(255,140,40," + 0.5 * k + ")"; ctx.lineWidth = 0.8 * dpr; ctx.stroke(); }
      });
    };

    function drawPart(ctx, p, x, y, sz, dpr) {
      var k = Math.min(1, p.life / p.max * 3);
      switch (p.kind) {
        case "snow": disc(ctx, x, y, (p.r || 1.2) * sz, "rgba(245,250,255," + 0.85 * k + ")"); break;
        case "petal": ctx.fillStyle = "rgba(255,185,215," + k + ")"; ctx.beginPath(); ctx.ellipse(x, y, 2.6 * sz, 1.5 * sz, p.rot, 0, TAU); ctx.fill(); break;
        case "leaf": ctx.fillStyle = "rgba(214," + Math.round(60 + 70 * ((p.rot % 1 + 1) % 1)) + ",30," + k + ")"; ctx.beginPath(); ctx.ellipse(x, y, 3 * sz, 1.7 * sz, p.rot, 0, TAU); ctx.fill(); break;
        case "bamboo": ctx.fillStyle = "rgba(140,190,90," + k + ")"; ctx.beginPath(); ctx.ellipse(x, y, 4 * sz, 1 * sz, p.rot, 0, TAU); ctx.fill(); break;
        case "ember": disc(ctx, x, y, 1.3 * sz, "rgba(255," + Math.round(120 + 100 * k) + ",40," + k + ")"); break;
        case "rain": ctx.strokeStyle = "rgba(190,210,235," + 0.45 * k + ")"; ctx.lineWidth = 0.8 * dpr; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 1.5 * sz, y - 9 * sz); ctx.stroke(); break;
        case "firefly": { var fl = 0.5 + 0.5 * Math.sin(sc.t * 5 + p.rot * 3); var g = ctx.createRadialGradient(x, y, 0, x, y, 4 * sz); g.addColorStop(0, "rgba(220,255,140," + fl * k + ")"); g.addColorStop(1, "rgba(220,255,140,0)"); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 4 * sz, 0, TAU); ctx.fill(); break; }
        case "mote": disc(ctx, x, y, 0.8 * sz, "rgba(255,230,190," + 0.35 * k + ")"); break;
        case "paper": ctx.fillStyle = "rgba(250,250,245," + k + ")"; ctx.save(); ctx.translate(x, y); ctx.rotate(p.rot); ctx.fillRect(-0.8 * sz, -1.6 * sz, 1.6 * sz, 3.2 * sz); ctx.restore(); break;
        case "fire": disc(ctx, x, y, 1.8 * sz, "rgba(255," + Math.round(90 + 120 * k) + ",30," + k + ")"); break;
        default: disc(ctx, x, y, 1.2 * sz, "rgba(255,240,200," + k + ")");
      }
    }

    function drawBolt(ctx, x, y, x2, y2, seed, alpha, w) {
      ctx.strokeStyle = "rgba(220,235,255," + alpha + ")"; ctx.lineWidth = w;
      ctx.beginPath(); ctx.moveTo(x, y);
      for (var i = 1; i <= 7; i++) { var q = i / 7; ctx.lineTo(x + (x2 - x) * q + (i < 7 ? Math.sin(seed * 50 + i * 3) * 10 : 0), y + (y2 - y) * q + (i < 7 ? Math.cos(seed * 40 + i * 5) * 10 : 0)); }
      ctx.stroke();
    }

    // ---- 俯瞰：天氣粒子、雷、開場字幕、決著演出（刀與特效之後畫） ----
    sc.drawFront = function (ctx, px, s, dpr, R, labels) {
      sc.parts.forEach(function (p) { drawPart(ctx, p, p.x * s, p.y * s, s * 1.2, dpr); });
      if (sc.bolt) {
        var kb = sc.bolt.life / sc.bolt.max;
        drawBolt(ctx, sc.bolt.x * s * 1.25, -px / 2, sc.bolt.x * s, sc.bolt.y * s, sc.bolt.seed, kb, 3 * dpr);
      }
      if (sc.thunder > 0) { ctx.fillStyle = "rgba(230,240,255," + 0.45 * sc.thunder / 0.35 + ")"; ctx.fillRect(-px, -px, px * 2, px * 2); }
      drawOverlays(ctx, px, dpr, labels);
    };

    function drawOverlays(ctx, px, dpr, labels) {
      labels = labels || {};
      if (sc.intro) {
        var k = sc.intro.life / sc.intro.max, inA = Math.min(1, (1 - k) * 6), outA = Math.min(1, k * 4), al = Math.min(inA, outA);
        ctx.globalAlpha = al;
        ctx.fillStyle = "rgba(8,6,4,0.62)";
        ctx.fillRect(-px / 2, -26 * dpr, px, 52 * dpr);
        ctx.fillStyle = sc.stage.rim[0];
        ctx.fillRect(-px / 2, -26 * dpr, px, 1.5 * dpr); ctx.fillRect(-px / 2, 24.5 * dpr, px, 1.5 * dpr);
        ctx.textAlign = "center";
        ctx.font = Math.round(11 * dpr) + "px serif";
        ctx.fillStyle = "rgba(255,255,255,0.8)";
        ctx.fillText(labels.stage || "", (1 - inA) * -px * 0.3, -8 * dpr);
        ctx.font = "bold " + Math.round(22 * dpr) + "px serif";
        ctx.fillStyle = "#fff6dc";
        ctx.fillText(labels.fight || "", (1 - inA) * px * 0.3, 16 * dpr);
        ctx.globalAlpha = 1;
      }
      if (sc.finale) {
        var f = sc.finale, kf = Math.max(0, f.life / f.max), age = 1 - kf, pop = Math.min(1, age * 5);
        // 畫面變暗、墨潑、放射的斬線、大字
        ctx.fillStyle = "rgba(0,0,0," + 0.55 * Math.min(1, age * 4) + ")";
        ctx.fillRect(-px, -px, px * 2, px * 2);
        ctx.save();
        ctx.rotate(-0.12);
        ctx.fillStyle = "rgba(12,10,10,0.92)";
        ctx.beginPath();
        for (var i = 0; i <= 40; i++) {
          var a = i / 40 * TAU, rr = px * 0.24 * pop * (1 + 0.22 * Math.sin(a * 7 + f.seed) + 0.12 * Math.sin(a * 13 + f.seed * 2));
          if (i === 0) ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); else ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
        }
        ctx.fill();
        for (var j = 0; j < 9; j++) { var aj = f.seed + j * 0.7, d = px * (0.26 + 0.06 * Math.sin(j * 5)) * pop; disc(ctx, Math.cos(aj) * d, Math.sin(aj) * d, (2 + j % 3 * 2) * dpr * pop, "rgba(12,10,10,0.9)"); }
        ctx.restore();
        ctx.strokeStyle = f.color; ctx.lineWidth = 2 * dpr; ctx.globalAlpha = Math.min(1, kf * 2);
        for (var m = 0; m < 14; m++) { var am = m / 14 * TAU + f.seed, r0 = px * 0.27, r1 = px * (0.33 + 0.1 * age); ctx.beginPath(); ctx.moveTo(Math.cos(am) * r0, Math.sin(am) * r0); ctx.lineTo(Math.cos(am) * r1, Math.sin(am) * r1); ctx.stroke(); }
        ctx.globalAlpha = Math.min(1, kf * 3);
        ctx.textAlign = "center";
        var big = Math.round(px * 0.26 * (1.35 - 0.35 * pop));
        ctx.font = "900 " + big + "px serif";
        ctx.lineWidth = 6 * dpr; ctx.strokeStyle = "#000"; ctx.strokeText(f.text, 0, big * 0.36);
        ctx.fillStyle = f.color; ctx.fillText(f.text, 0, big * 0.36);
        if (f.sub) {
          ctx.font = "bold " + Math.round(15 * dpr) + "px serif";
          ctx.lineWidth = 4 * dpr; ctx.strokeText(f.sub, 0, px * 0.33);
          ctx.fillStyle = "#fff"; ctx.fillText(f.sub, 0, px * 0.33);
        }
        ctx.globalAlpha = 1;
      }
    }

    // ---- 刀視角：天空・地面顏色、遠景（Pov.draw 呼叫）與畫面前景的天氣 ----
    sc.pov = {
      sky: function () { return sc.stage.pov.sky; },
      gnd: function () { return sc.stage.pov.gnd; },
      deco: function (ctx, M, HY, ang, t, W) {
        var kind = sc.stage.pov.deco;
        var span = W * 2.2; // 鏡頭轉一圈地平線捲動的寬度
        function az(a0) { var d = ((a0 - ang) % TAU + TAU * 1.5) % TAU - Math.PI; return d / TAU * span * 2; }
        if (kind === "moon" || kind === "sakura" || kind === "storm" || kind === "lanterns") {
          var mx = az(0.8);
          if (Math.abs(mx) < W) { disc(ctx, mx, -HY * 0.62, W * 0.05, kind === "storm" ? "rgba(160,170,190,0.3)" : "rgba(250,246,226,0.9)"); }
        }
        // 遠景剪影：山、竹、樹（依方位捲動）
        var col = { moon: "#0a1424", sakura: "#2a1424", storm: "#10141a", volcano: "#1a0604", bamboo: "#0e2412", maple: "#3a1608", torii: "#1e1c26", lanterns: "#0e0a0a" }[kind] || "#101010";
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.moveTo(-M, 0);
        for (var x = -M; x <= M; x += W / 60) {
          var a = ang * 60 + x / W * 9;
          var h = kind === "bamboo" ? (Math.abs(Math.sin(a * 3.1)) > 0.92 ? HY * 0.9 : HY * 0.12) : kind === "volcano" ? HY * (0.18 + 0.3 * Math.max(0, 1 - Math.abs(((a / 6) % 2 + 2) % 2 - 1) * 3)) : HY * (0.1 + 0.08 * Math.sin(a) + 0.05 * Math.sin(a * 2.7));
          ctx.lineTo(x, -h);
        }
        ctx.lineTo(M, 0); ctx.closePath(); ctx.fill();
        if (kind === "volcano") { var gl = ctx.createLinearGradient(0, -HY * 0.5, 0, 0); gl.addColorStop(0, "rgba(255,90,20,0.0)"); gl.addColorStop(1, "rgba(255,90,20,0.25)"); ctx.fillStyle = gl; ctx.fillRect(-M, -HY * 0.5, 2 * M, HY * 0.5); }
        if (kind === "torii") {
          var tx = az(2.2);
          if (Math.abs(tx) < W) { ctx.fillStyle = "#b8322a"; var tw = W * 0.12; ctx.fillRect(tx - tw, -HY * 0.38, tw * 2, HY * 0.03); ctx.fillRect(tx - tw * 0.7, -HY * 0.36, tw * 0.12, HY * 0.36); ctx.fillRect(tx + tw * 0.58, -HY * 0.36, tw * 0.12, HY * 0.36); }
        }
        void t;
      },
      front: function (ctx, W, H, dpr) {
        // 刀視角前景的天氣：用場景粒子的位置投到畫面（不做 3D，只是氣氛）
        sc.parts.forEach(function (p) {
          if (p.burst) return;
          if (p.kind === "mote" || p.kind === "firefly") return;
          var x = (p.x / 260 + 0.5) * W, y = (p.y / 260 + 0.5) * H;
          drawPart(ctx, p, x, y, W / 260 * 0.7, dpr);
        });
        if (sc.thunder > 0) { ctx.fillStyle = "rgba(230,240,255," + 0.4 * sc.thunder / 0.35 + ")"; ctx.fillRect(0, 0, W, H); }
      },
      overlays: function (ctx, px, dpr, labels) { drawOverlays(ctx, px, dpr, labels); }
    };
    return sc;
  }

  window.PriTestKatanaStyle = {
    LOOKS: LOOKS, look: look, setLook: setLook, applyLook: applyLook, resScale: resScale,
    STAGES: STAGES, STAGE: STAGE, stagePref: stagePref, setStagePref: setStagePref, stageFor: stageFor, createScene: createScene
  };
})();
