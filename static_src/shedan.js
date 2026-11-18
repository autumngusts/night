// 射彈宇宙（shedan）：畫面流程。滿版＋導覽列切換、選隊、拉弓輸入、主迴圈（物理 → 規則 → 特效）、敵人回合、結算。
// 第 2 階段：30 人（暫時全部開放）的特性／友情技／技能、星座、殘影、引力井、小行星。規則依據 docs/shedan_game_design.md。
(function () {
  "use strict";
  var D = window.PriTestShedanData, Rng = window.PriTestShedanRng, Combat = window.PriTestShedanCombat;
  var Physics = window.PriTestShedanPhysics, Render = window.PriTestShedanRender;
  var K = D.C;

  function t(key, params) { return window.I18N ? window.I18N.t(key, params) : key; }
  function name(obj) { return D.text(obj); }
  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  // ---------------- 導覽列（使用者指定 2026-11-18：滿版，☰ 展開原本的導覽列） ----------------
  var navClosedAt = 0;
  function setupNav() {
    document.body.classList.add("sd-body");
    window.requestAnimationFrame(function () { window.requestAnimationFrame(function () { document.body.classList.add("sd-nav-anim"); }); });
    var btn = document.createElement("button");
    btn.type = "button";
    btn.id = "sd-nav-toggle";
    btn.textContent = "☰";
    btn.setAttribute("aria-expanded", "false");
    document.body.appendChild(btn);
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      setNavOpen(!isNavOpen());
    });
    document.addEventListener("pointerdown", function (e) {
      if (!isNavOpen()) return;
      var header = document.querySelector(".site-header");
      if (e.target === btn || (header && header.contains(e.target))) return;
      setNavOpen(false);
      navClosedAt = Date.now();
    }, true);
  }
  function isNavOpen() { return document.body.classList.contains("sd-nav-open"); }
  function setNavOpen(open) {
    document.body.classList.toggle("sd-nav-open", open);
    var btn = document.getElementById("sd-nav-toggle");
    if (btn) btn.setAttribute("aria-expanded", open ? "true" : "false");
  }

  // ---------------- 狀態 ----------------
  var app = document.getElementById("sd-app");
  var imgBase = (app && app.getAttribute("data-img")) || "../static/images/jikan/";
  var S = {
    screen: "pick",            // pick | battle | result
    picked: [],                // 選隊順序（id）
    arena: "s1",               // 戰場（試作用）：s1～s3 一般戰鬥、b1～b3 Boss 戰（地圖在第 4 階段）
    battle: null, world: null,
    phase: "aim",              // aim | shooting | enemy | over
    aim: null, drag: null,
    seed: 0, result: null,
    lastTime: 0,
    skillArmed: false,         // 瞄準時按了技能鍵
    canRedirect: false,        // 離子技能：飛行中可以點一次轉向
    walls: [],                 // 本發的冰牆（畫面用）
    recording: false, recPath: [], ghostPath: null, ghost: null   // 殘影：記錄／重播
  };
  var imgs = {};
  var R, canvas, hudWrap, hudTop, hudBottom, banner, overlay;

  function heroImg(h) {
    if (!imgs[h.id]) { var im = new Image(); im.src = imgBase + h.img; imgs[h.id] = im; }
    return imgs[h.id];
  }

  // ---------------- DOM ----------------
  function build() {
    app.innerHTML = "";
    canvas = el("canvas", "sd-canvas");
    app.appendChild(canvas);
    hudWrap = el("div", "sd-hud-wrap");
    hudTop = el("div", "sd-hud sd-hud-top");
    hudBottom = el("div", "sd-hud sd-hud-bottom");
    banner = el("div", "sd-banner");
    hudWrap.appendChild(hudTop);
    hudWrap.appendChild(hudBottom);
    hudWrap.appendChild(banner);
    app.appendChild(hudWrap);
    overlay = el("div", "sd-overlay");
    app.appendChild(overlay);
    R = Render.create(canvas);
    layoutHud();
    window.addEventListener("resize", function () { Render.resize(R); layoutHud(); });
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", function () { S.drag = null; S.aim = null; });
    window.addEventListener("i18n:change", function () { render(); updateHud(); });
    // 技能鍵：瞄準時按一下切換「這一發發動技能」
    hudBottom.addEventListener("click", function (e) {
      var btn = e.target.closest && e.target.closest('[data-act="skill"]');
      if (!btn || S.phase !== "aim" || !Combat.canSkill(S.battle)) return;
      S.skillArmed = !S.skillArmed;
      updateHud();
    });
  }
  // HUD 與戰場同寬；畫面比 9:16 長（手機直拿）時放進戰場上下的空白，空間不夠才疊在戰場邊緣
  function layoutHud() {
    var f = Render.fieldRect(R);
    var display = hudWrap.style.display;
    hudWrap.style.cssText = "position:absolute;inset:0;pointer-events:none;";
    hudWrap.style.display = display;
    var topH = hudTop.offsetHeight || 42, botH = hudBottom.offsetHeight || 48;
    var fBottom = f.top + f.height, below = R.ch - fBottom;
    hudTop.style.left = f.left + "px";
    hudTop.style.width = f.width + "px";
    hudTop.style.top = (f.top >= topH ? f.top - topH : f.top) + "px";
    hudBottom.style.left = f.left + "px";
    hudBottom.style.width = f.width + "px";
    hudBottom.style.top = (below >= botH ? fBottom : fBottom - botH) + "px";
    banner.style.left = (f.left + f.width / 2) + "px";
    banner.style.top = (f.top + f.height * 0.42) + "px";
  }

  // ---------------- 選隊 ----------------
  // 第 2 階段暫時開放全部 30 人（解鎖機制在第 5 階段），依屬性排列
  function pickableHeroes() {
    return D.HEROES.slice().sort(function (a, b) { return D.ELEMENTS.indexOf(a.element) - D.ELEMENTS.indexOf(b.element); });
  }

  function render() {
    overlay.style.display = S.screen === "battle" ? "none" : "flex";
    hudWrap.style.display = S.screen === "battle" ? "block" : "none";
    if (S.screen === "pick") renderPick();
    else if (S.screen === "result") renderResult();
  }

  function renderPick() {
    var html = '<h1>' + esc(t("sd_title")) + '</h1><p>' + esc(t("sd_pick_hint", { n: S.picked.length })) + '</p><div class="sd-pick-grid">';
    pickableHeroes().forEach(function (h) {
      var idx = S.picked.indexOf(h.id);
      var info = D.ELEMENT_INFO[h.element];
      html += '<button type="button" class="sd-pick-card' + (idx >= 0 ? " is-picked" : "") + '" data-hero="' + h.id + '" style="--sd-el:' + info.color + '"' +
        ' title="' + esc(t("sd_friend") + "：" + name(h.friend.name) + " ／ " + t("sd_skill") + "：" + name(h.skill.name)) + '">' +
        (idx >= 0 ? '<span class="sd-pick-order">' + (idx + 1) + "</span>" : "") +
        '<img src="' + esc(imgBase + h.img) + '" alt="" loading="lazy">' +
        "<b>" + esc(name(h.name)) + '</b><span class="sd-el-tag">' + info.icon + " " + esc(name(h.skill.name)) + "</span></button>";
    });
    html += '</div><div class="sd-pick-bar"><div class="sd-arena" role="radiogroup" aria-label="' + esc(t("sd_arena")) + '">' +
      ARENAS.map(function (a) {
        return '<button type="button" class="sd-arena-btn' + (S.arena === a ? " is-on" : "") + '" data-arena="' + a + '">' + esc(arenaName(a)) + "</button>";
      }).join("") + "</div>" +
      '<button type="button" class="sd-btn" data-act="launch"' + (S.picked.length === 4 ? "" : " disabled") + ">" + esc(t("sd_launch")) + "</button></div>";
    overlay.innerHTML = html;
    overlay.querySelectorAll("[data-hero]").forEach(function (b) {
      b.addEventListener("click", function () {
        var id = b.getAttribute("data-hero"), i = S.picked.indexOf(id);
        if (i >= 0) S.picked.splice(i, 1);
        else if (S.picked.length < 4) S.picked.push(id);
        renderPick();
      });
    });
    overlay.querySelectorAll("[data-arena]").forEach(function (b) {
      b.addEventListener("click", function () { S.arena = b.getAttribute("data-arena"); renderPick(); });
    });
    overlay.querySelector('[data-act="launch"]').addEventListener("click", function () {
      if (S.picked.length === 4) startBattle();
    });
  }

  var ARENAS = ["s1", "s2", "s3", "b1", "b2", "b3"];
  function arenaSector(a) { return +a.charAt(1); }
  function arenaBoss(a) { return a.charAt(0) === "b" ? D.BOSSES[arenaSector(a) - 1] : null; }
  function arenaName(a) {
    var boss = arenaBoss(a);
    return boss ? name(boss.name) : t("sd_arena_s" + arenaSector(a));
  }

  // ---------------- 戰鬥 ----------------
  // 依星區抽敵（§6.1）：浮游孢子 2～3 隻成群、雙子球／引力雙星成對、寄生藤貼在宿主旁、巨蟒要留身體的空間。
  // 星蝕使徒只以精英出現（第 4 階段），一般戰鬥不抽。boss = Boss 戰時本體與部位佔用的區域。
  function genEnemies(rng, sector, count, boss) {
    var pool = D.ENEMIES.filter(function (e) { return e.sector === sector && e.trait !== "eclipse"; });
    var list = [], large = 0;
    while (list.length < count) {
      var def = Rng.pick(rng, pool);
      if (def.size === "l" && large >= 1) continue;
      if (def.size === "l") large++;
      var n = def.trait === "swarm" ? Rng.int(rng, 2, 3) : (def.trait === "linked" || def.trait === "binary") ? 2 : 1;
      for (var k = 0; k < n; k++) list.push(def);
    }
    var placed = [];
    var taken = boss ? [{ x: K.FIELD_W / 2, y: 240, r: 220 }] : [];
    function free(x, y, r) {
      return placed.concat(taken).every(function (p) { var dx = p.x - x, dy = p.y - y; return Math.sqrt(dx * dx + dy * dy) > p.r + r + 26; });
    }
    var parasites = [];
    list.forEach(function (def) {
      if (def.trait === "parasite") { parasites.push(def); return; }
      var r = D.SIZE_R[def.size];
      for (var tries = 0; tries < 300; tries++) {
        var serp = def.trait === "serpent";
        var x = Rng.int(rng, r + 20, K.FIELD_W - r - 20), y = Rng.int(rng, 110, serp ? 500 : 620);
        // 巨蟒：頭＋往下 3 節身體都要有空間
        var ok = free(x, y, r) && (!serp || [76, 122, 168].every(function (dy) { return free(x, y + dy, 22); }));
        if (ok) {
          placed.push({ def: def, x: x, y: y, r: r });
          if (serp) [76, 122, 168].forEach(function (dy) { taken.push({ x: x, y: y + dy, r: 22 }); });
          return;
        }
      }
    });
    parasites.forEach(function (def) {
      var r = D.SIZE_R[def.size];
      var hosts = placed.filter(function (p) { return p.def.trait !== "parasite"; });
      for (var tries = 0; tries < 60 && hosts.length; tries++) {
        var h = Rng.pick(rng, hosts), a = rng() * Math.PI * 2, d = h.r + r + 4;
        var x = h.x + Math.cos(a) * d, y = h.y + Math.sin(a) * d;
        if (x < r + 10 || x > K.FIELD_W - r - 10 || y < 90 || y > 680) continue;
        var ok = placed.concat(taken).every(function (p) { return p === h || Math.sqrt((p.x - x) * (p.x - x) + (p.y - y) * (p.y - y)) > p.r + r + 4; });
        if (ok) { placed.push({ def: def, x: x, y: y, r: r }); return; }
      }
    });
    return placed;
  }

  // 場地機關（規則文件 §8.1）：星點 4～6；50% 引力井（其中 30% 黑洞）；60% 小行星 2～3。
  // 與敵人、隊員、彼此至少相距 FIELD_GAP。
  function genField(rng, enemies) {
    var taken = enemies.map(function (e) { return { x: e.x, y: e.y, r: e.r }; });
    Physics.DEFAULT_HERO_POS.forEach(function (p) { taken.push({ x: p.x, y: p.y, r: K.HERO_R }); });
    function place(r, y0, y1) {
      for (var i = 0; i < 300; i++) {
        var x = Rng.int(rng, r + 20, K.FIELD_W - r - 20), y = Rng.int(rng, y0, y1);
        var ok = taken.every(function (o) { var dx = o.x - x, dy = o.y - y; return Math.sqrt(dx * dx + dy * dy) > o.r + r + K.FIELD_GAP; });
        if (ok) { taken.push({ x: x, y: y, r: r }); return { x: x, y: y }; }
      }
      return null;
    }
    var field = { stars: [], wells: [], rocks: [] };
    if (rng() < 0.5) {
      var hole = rng() < 0.3;
      var g = place(hole ? K.HOLE_R + 10 : 50, 180, 620);
      if (g) field.wells.push({ x: g.x, y: g.y, radius: K.WELL_R, hole: hole });
    }
    if (rng() < 0.6) {
      for (var k = Rng.int(rng, 2, 3); k > 0; k--) { var rk = place(K.ROCK_R, 130, 700); if (rk) field.rocks.push(rk); }
    }
    for (var s = Rng.int(rng, K.STAR_MIN, K.STAR_MAX); s > 0; s--) { var st = place(12, 90, 740); if (st) field.stars.push(st); }
    return field;
  }

  function startBattle(seed) {
    S.seed = seed == null ? (Date.now() >>> 0) : seed;
    var rng = Rng.make(S.seed);
    var heroes = S.picked.map(function (id) { return D.HERO_BY_ID[id]; });
    heroes.forEach(heroImg);
    var boss = arenaBoss(S.arena), sector = arenaSector(S.arena);
    var enemies = genEnemies(rng, sector, boss ? 2 : Rng.int(rng, 4, 6), boss);
    var occupied = enemies.slice();
    if (boss) occupied.push({ x: K.FIELD_W / 2, y: 240, r: 200 });
    var field = genField(rng, occupied);
    S.battle = Combat.create({ heroes: heroes, enemies: enemies, field: field, rng: rng, boss: boss ? boss.id : null });
    S.battle.avoid = Physics.DEFAULT_HERO_POS.map(function (p) { return { x: p.x, y: p.y, r: K.HERO_R + 6 }; });
    S.world = Physics.create({ Matter: window.Matter, battle: S.battle, field: { wells: S.battle.wells, rocks: S.battle.rocks } });
    S.phase = "aim";
    S.aim = null; S.drag = null;
    S.skillArmed = false; S.canRedirect = false; S.walls = [];
    S.recording = false; S.recPath = []; S.ghostPath = null; S.ghost = null;
    S.screen = "battle";
    Render.trailClear(R);
    render();
    updateHud();
    showBanner(t("sd_drag_hint"), 1600);
  }

  function heroPos(i) { return Physics.heroPos(S.world, i); }

  // ---------------- 輸入：任何位置按住拖曳拉弓 ----------------
  function onDown(e) {
    if (S.screen !== "battle" || isNavOpen() || Date.now() - navClosedAt < 250) return;
    // 電漿推進（離子技能）：飛行中點一下朝該點轉向
    if (S.phase === "shooting" && S.canRedirect) {
      var tp = Render.toField(R, e.clientX, e.clientY);
      if (Physics.redirect(S.world, tp.x, tp.y)) { S.canRedirect = false; Render.spark(R, tp.x, tp.y, "#ffe14d"); }
      return;
    }
    if (S.phase !== "aim") return;
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* 合成事件沒有真正的 pointer */ }
    S.drag = Render.toField(R, e.clientX, e.clientY);
    updateAim(e);
  }
  function onMove(e) { if (S.drag) updateAim(e); }
  function updateAim(e) {
    var p = Render.toField(R, e.clientX, e.clientY);
    var dx = S.drag.x - p.x, dy = S.drag.y - p.y;
    var len = Math.sqrt(dx * dx + dy * dy);
    if (len > K.PULL_MAX) { dx *= K.PULL_MAX / len; dy *= K.PULL_MAX / len; len = K.PULL_MAX; }
    var hp = heroPos(S.battle.active);
    S.aim = { x: hp.x, y: hp.y, dx: dx, dy: dy, power: len / K.PULL_MAX };
  }
  function onUp(e) {
    if (!S.drag) return;
    updateAim(e);
    var a = S.aim;
    S.drag = null; S.aim = null;
    if (!a || a.power < 0.12) return;
    shoot(a.dx, a.dy, a.power);
  }

  function shoot(dx, dy, power) {
    var b = S.battle, len = Math.sqrt(dx * dx + dy * dy) || 1;
    var hero = b.party[b.active].def;
    var sp = K.SPEED_MAX * Math.min(1, power) * (hero.speed || 1);
    var hp = heroPos(b.active);
    var useSkill = S.skillArmed && Combat.canSkill(b);
    S.skillArmed = false;
    var r = Combat.beginShot(b, { skill: useSkill, x: hp.x, y: hp.y, dir: { x: dx / len, y: dy / len } });
    S.walls = [];
    // 殘影：上一發有「回聲」就在這一發重播；這一發有「回聲」就開始記錄
    S.ghost = S.ghostPath ? { path: S.ghostPath, i: 0, x: S.ghostPath[0].x, y: S.ghostPath[0].y } : null;
    S.ghostPath = null;
    S.recording = !!b.ghostNext;
    b.ghostNext = false;
    S.recPath = [];
    applyCmds(r.cmds);
    Physics.launch(S.world, b.active, dx / len * sp, dy / len * sp, r.launch);
    S.canRedirect = !!r.launch.redirect;
    S.phase = "shooting";
    Render.trailClear(R);
    updateHud();
  }

  // ---------------- 主迴圈 ----------------
  function frame(time) {
    var dt = S.lastTime ? Math.min(0.05, (time - S.lastTime) / 1000) : 0.016;
    S.lastTime = time;
    if (S.screen === "battle" && S.phase === "shooting") {
      for (var i = 0; i < K.SUBSTEPS && S.phase === "shooting"; i++) substep();
      if (S.phase === "shooting") { var p = heroPos(S.battle.active); Render.trailPush(R, p.x, p.y); }
    }
    var showB = S.screen === "result" || S.screen === "battle";
    Render.draw(R, {
      time: time, battle: showB ? S.battle : null,
      heroPos: heroPos, heroRadius: function (i) { return Physics.heroRadius(S.world, i); },
      imgs: imgs, aim: S.aim, shooter: S.phase === "shooting" && S.battle ? S.battle.active : null,
      lit: showB && S.battle && !S.battle.shot.ended ? S.battle.shot.lit : [],
      wells: showB && S.world ? Physics.allWells(S.world) : [],
      debris: showB && S.world ? Physics.debrisList(S.world) : [],
      walls: S.walls, ghost: S.ghost
    }, dt);
    window.requestAnimationFrame(frame);
  }

  // 一個物理子步：物理事件 → 規則；射出者位置（星點、殘響、冰霜軌跡）；殘影的記錄與重播
  function substep() {
    var b = S.battle, w = S.world;
    var evs = Physics.step(w);
    var stop = null;
    for (var j = 0; j < evs.length; j++) {
      if (evs[j].type === "stop") stop = evs[j]; else handleEvent(evs[j]);
      if (S.phase !== "shooting") return;
    }
    var p = heroPos(b.active);
    if (!stop) {
      applyCmds(Combat.onPos(b, { x: p.x, y: p.y, r: Physics.heroRadius(w, b.active) }));
      if (S.recording) S.recPath.push({ x: p.x, y: p.y });
    }
    if (S.ghost) {
      var g = S.ghost;
      g.i++;
      if (g.i >= g.path.length) S.ghost = null;
      else {
        g.x = g.path[g.i].x; g.y = g.path[g.i].y;
        Combat.alive(b).forEach(function (e) {
          var dx = e.x - g.x, dy = e.y - g.y;
          if (Math.sqrt(dx * dx + dy * dy) <= e.r + K.HERO_R) applyCmds(Combat.onGhost(b, { enemy: e.uid, step: w.stepNo }));
        });
      }
    }
    if (stop) handleEvent(stop);
  }

  function handleEvent(ev) {
    var b = S.battle;
    if (ev.type === "hit") {
      applyCmds(Combat.onHit(b, ev));
      updateHud();
    } else if (ev.type === "ally") {
      var ap = heroPos(ev.ally);
      applyCmds(Combat.onAlly(b, { ally: ev.ally, x: ap.x, y: ap.y }));
      updateHud();
    } else if (ev.type === "wall") {
      applyCmds(Combat.onWall(b, ev));
    } else if (ev.type === "rock") {
      applyCmds(Combat.onRock(b, ev));
    } else if (ev.type === "debris") {
      applyCmds(Combat.onDebris(b, ev));
      updateHud();
    } else if (ev.type === "stop") {
      var sp = heroPos(b.active);
      var res = Combat.endShot(b, sp);
      applyCmds(res.cmds);
      if (S.recording) { S.ghostPath = S.recPath.length > 1 ? S.recPath : null; S.recording = false; S.recPath = []; }
      S.ghost = null;
      S.walls = [];
      S.canRedirect = false;
      Render.trailClear(R);
      if (res.next === "win") return finish("win");
      if (res.next === "enemy") { S.phase = "enemy"; updateHud(); window.setTimeout(runEnemyTurn, 350); }
      else { S.phase = "aim"; updateHud(); }
    }
  }

  function applyCmds(cmds) {
    var b = S.battle;
    cmds.forEach(function (c) {
      if (c.type === "damage") {
        var col = c.kind === "true" ? "#c9a8ff" : c.kind === "explode" ? "#ffb3e6" : c.kind === "burn" ? "#ff9a4a" : "#fff";
        Render.floatText(R, c.x, c.y - 10, String(c.amount), col);
        if (c.kind === "hit") Render.spark(R, c.x, c.y, "#fff");
      } else if (c.type === "explode") {
        Render.explode(R, c.x, c.y, c.radius, c.depth);
        if (c.depth >= 2) Render.floatText(R, c.x, c.y - 30, t("sd_chain", { n: c.depth }), "#ff7ad9", true);
      } else if (c.type === "kill") {
        Physics.removeEnemy(S.world, c.uid);
      } else if (c.type === "reaction") {
        var info = D.REACTIONS[c.id];
        Render.floatText(R, c.x, c.y - 34, name(info.name), "#9ff3ff", true);
      } else if (c.type === "move") {
        Physics.moveEnemy(S.world, c.uid, c.x, c.y);
      } else if (c.type === "arc") {
        var a = Combat.byUid(b, c.from), z = Combat.byUid(b, c.to);
        if (a && z) Render.arc(R, a.x, a.y, z.x, z.y);
      } else if (c.type === "laser") {
        Render.laser(R, c.x1, c.y1, c.x2, c.y2, c.el);
      } else if (c.type === "bolt") {
        var tg = Combat.byUid(b, c.uid);
        if (tg) Render.bolt(R, c.fromX, c.fromY, tg.x, tg.y, c.el);
      } else if (c.type === "pierceOff") {
        Physics.setPierce(S.world, false);
      } else if (c.type === "well") {
        Physics.addWell(S.world, c, c.temp);
      } else if (c.type === "wall") {
        Physics.addWall(S.world, c.x1, c.y1, c.x2, c.y2);
        S.walls.push(c);
      } else if (c.type === "debris") {
        Physics.spawnDebris(S.world, c.x, c.y, c.n, c.el);
      } else if (c.type === "rockBreak") {
        Physics.breakRock(S.world, c.id);
        Render.explode(R, c.x, c.y, K.ROCK_R * 1.8, 0, "#c9a07a");
      } else if (c.type === "star") {
        var st = b.stars[c.index];
        Render.spark(R, st.x, st.y, "#ffe27a");
      } else if (c.type === "constellation") {
        showBanner(t("sd_const_" + c.id), 1200);
      } else if (c.type === "heal") {
        Render.floatText(R, K.FIELD_W / 2, 780, "+" + c.amount, "#7dffb0", true);
        updateHud();
      } else if (c.type === "shield") {
        Render.floatText(R, K.FIELD_W / 2, 760, t("sd_shield"), "#9fe6ff", true);
      } else if (c.type === "skill") {
        var sh = D.HERO_BY_ID[c.id];
        showBanner(name(sh.skill.name), 1000);
      } else if (c.type === "friend") {
        var fh = b.party[c.ally].def, fp = heroPos(c.ally);
        Render.floatText(R, fp.x, fp.y - 34, name(fh.friend.name), "#ffe9a8");
      // ---- 第 3 階段：敵人特性與 Boss ----
      } else if (c.type === "spawn") {
        var ne = Combat.byUid(b, c.uid);
        if (ne) { Physics.addEnemy(S.world, ne); Render.spark(R, ne.x, ne.y, "#d6b3ff"); }
      } else if (c.type === "shooterVel") {
        Physics.scaleShooter(S.world, c.mult, c.rotate, c.cap);
      } else if (c.type === "enemySensor") {
        Physics.setEnemySensor(S.world, c.uid, c.on);
      } else if (c.type === "removeWells") {
        Physics.removeWellsOf(S.world, c.owner);
      } else if (c.type === "addRock") {
        Physics.addRock(S.world, { id: c.id, x: c.x, y: c.y });
        Render.spark(R, c.x, c.y, "#c9a07a");
      } else if (c.type === "teamDamage") {
        // 敵人回合的攻擊由 attacks 依序顯示；這裡只顯示射擊中的（漂流水雷）
        if (S.phase !== "enemy") Render.floatText(R, K.FIELD_W / 2, 800, "-" + c.amount, "#ff6b7a", true);
        updateHud();
      } else if (c.type === "enemyHeal") {
        if (c.amount > 0) Render.floatText(R, c.x, c.y - 16, "+" + c.amount, "#7dffb0");
      } else if (c.type === "shieldBreak") {
        var se = Combat.byUid(b, c.uid);
        if (se) { Render.explode(R, se.x, se.y, se.r * 1.4, 0, "#9fe6ff"); Render.floatText(R, se.x, se.y - 30, t("sd_shield_break"), "#9fe6ff", true); }
      } else if (c.type === "allPartsDown") {
        showBanner(t("sd_all_parts"), 1200);
      }
    });
  }

  function runEnemyTurn() {
    if (S.screen !== "battle") return;
    showBanner(t("sd_enemy_turn"), 700);
    window.setTimeout(function () {
      var b = S.battle;
      // 敵人移動／召喚要避開隊員目前的位置
      b.avoid = b.party.map(function (p, i) { var q = heroPos(i); return { x: q.x, y: q.y, r: Physics.heroRadius(S.world, i) + 6 }; });
      var r = Combat.enemyTurn(b);
      applyCmds(r.cmds);
      r.attacks.forEach(function (a, i) {
        var e = Combat.byUid(b, a.uid);
        window.setTimeout(function () {
          if (e) Render.explode(R, e.x, e.y, e.r * 1.6, 0, "#ff5a6a");
          Render.floatText(R, K.FIELD_W / 2, 790, "-" + a.dmg, "#ff6b7a", true);
          updateHud();
        }, i * 160);
      });
      window.setTimeout(function () {
        if (r.win) return finish("win");
        if (r.lose) return finish("lose");
        S.phase = "aim";
        updateHud();
      }, 300 + r.attacks.length * 160);
    }, 650);
  }

  function finish(kind) {
    S.phase = "over";
    S.result = kind;
    updateHud();
    window.setTimeout(function () { S.screen = "result"; render(); }, 700);
  }

  function renderResult() {
    var b = S.battle;
    overlay.innerHTML = "<h1>" + esc(t(S.result === "win" ? "sd_win" : "sd_lose")) + "</h1>" +
      "<p>" + esc(t("sd_result_stats", { turns: b.turnNo, dmg: b.stats.damage, chain: b.stats.maxChain })) + "</p>" +
      '<div class="sd-row"><button type="button" class="sd-btn" data-act="again">' + esc(t("sd_again")) + "</button>" +
      '<button type="button" class="sd-btn sd-btn-ghost" data-act="pick">' + esc(t("sd_back_pick")) + "</button></div>";
    overlay.querySelector('[data-act="again"]').addEventListener("click", function () { startBattle(); });
    overlay.querySelector('[data-act="pick"]').addEventListener("click", function () { S.screen = "pick"; render(); });
  }

  // ---------------- HUD ----------------
  var bannerTimer = 0;
  function showBanner(text, ms) {
    banner.textContent = text;
    banner.classList.add("is-on");
    window.clearTimeout(bannerTimer);
    bannerTimer = window.setTimeout(function () { banner.classList.remove("is-on"); }, ms);
  }
  function updateHud() {
    var b = S.battle;
    if (!b || S.screen !== "battle") return;
    var bossBar = "";
    if (b.bossUid) {
      var body = Combat.byUid(b, b.bossUid);
      bossBar = '<span class="sd-boss-bar"><b>' + esc(name(body.def.name)) + '</b><span class="sd-boss-hp"><span style="width:' +
        (100 * body.hp / body.hpMax).toFixed(1) + '%"></span></span></span>';
    }
    hudTop.innerHTML = bossBar + '<span class="sd-badge">' + esc(t("sd_turn", { n: b.turnNo })) + "</span>" +
      '<span class="sd-badge">' + esc(t("sd_hits", { n: b.shot.hits })) + "</span>" +
      '<span class="sd-badge">' + esc(t("sd_max_chain", { n: Math.max(b.stats.maxChain, b.shot.chain) })) + "</span>";
    var slots = b.party.map(function (p, i) {
      return '<span class="sd-party-slot' + (i === b.active && S.phase !== "enemy" ? " is-active" : "") + '" style="background-image:url(\'' + esc(imgBase + p.def.img) + '\')"></span>';
    }).join("");
    var p = b.party[b.active];
    var ready = S.phase === "aim" && Combat.canSkill(b);
    var skillBtn = '<button type="button" class="sd-skill-btn' + (S.skillArmed && ready ? " is-armed" : "") + (ready ? " is-ready" : "") + '" data-act="skill"' +
      (ready ? "" : " disabled") + ' style="--sd-fill:' + Math.round(100 * p.gauge / p.gaugeMax) + '%">' +
      "<b>" + esc(t("sd_skill")) + "</b><span>" + esc(name(p.def.skill.name)) + "</span></button>";
    hudBottom.innerHTML = '<div class="sd-party">' + slots + "</div>" +
      '<div class="sd-hp-box"><div class="sd-hp"><span class="sd-hp-fill" style="width:' + (100 * b.hp / b.hpMax).toFixed(1) + '%"></span></div>' +
      '<div class="sd-hp-text">HP ' + b.hp + " / " + b.hpMax + (b.shield ? "　🛡" : "") + "</div></div>" + skillBtn;
    if (!hudLaidOut) { hudLaidOut = true; layoutHud(); }
  }
  var hudLaidOut = false;

  // ---------------- 測試用 ----------------
  window.PriTestShedanApp = {
    isNavOpen: isNavOpen, setNavOpen: setNavOpen,
    _debug: {
      state: function () { return S; },
      pick: function (ids, arena, seed) { S.picked = ids.slice(0, 4); if (arena) S.arena = arena; startBattle(seed == null ? 1234 : seed); },
      shoot: function (dx, dy, power) { if (S.phase === "aim") shoot(dx, dy, power == null ? 1 : power); },
      forceWin: function () {
        S.battle.enemies.forEach(function (e) { e.dead = true; e.hp = 0; Physics.removeEnemy(S.world, e.uid); });
        finish("win");
      },
      enemyHp: function () { return S.battle.enemies.reduce(function (s, e) { return s + e.hp; }, 0); },
      // 目前射出者的量表墊滿（測試技能用）
      fillGauge: function () { var p = S.battle.party[S.battle.active]; p.gauge = p.gaugeMax; updateHud(); }
    }
  };

  setupNav();
  if (app) {
    build();
    render();
    window.requestAnimationFrame(frame);
  }
})();
