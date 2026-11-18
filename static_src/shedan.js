// 射彈宇宙（shedan）：畫面流程。滿版＋導覽列切換、選隊、拉弓輸入、主迴圈（物理 → 規則 → 特效）、敵人回合、結算。
// 第 2 階段：30 人（暫時全部開放）的特性／友情技／技能、星座、殘影、引力井、小行星。規則依據 docs/shedan_game_design.md。
(function () {
  "use strict";
  var D = window.PriTestShedanData, Rng = window.PriTestShedanRng, Combat = window.PriTestShedanCombat, Run = window.PriTestShedanRun;
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
    window.addEventListener("resize", function () { Render.resize(R); layoutHud(); if (S.screen === "map") render(); });
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
    overlay.classList.toggle("is-run", !!S.run && S.screen !== "pick");
    var fn = {
      pick: renderPick, result: renderResult, map: renderMap, reward: renderReward, shop: renderShop, rest: renderRest,
      drifter: renderDrifter, event: renderEvent, eventOut: renderEventOut, relics: renderRelics, runEnd: renderRunEnd
    }[S.screen];
    if (fn) fn();
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
    var ready = S.picked.length === 4 ? "" : " disabled";
    html += '</div><div class="sd-pick-bar">' +
      '<button type="button" class="sd-btn" data-act="launch"' + ready + ">" + esc(t("sd_start_run")) + "</button>" +
      '<details class="sd-test-arena"' + (S.arenaOpen ? " open" : "") + '><summary>' + esc(t("sd_test_arena")) + '</summary><div class="sd-arena" role="radiogroup" aria-label="' + esc(t("sd_arena")) + '">' +
      ARENAS.map(function (a) {
        return '<button type="button" class="sd-arena-btn' + (S.arena === a ? " is-on" : "") + '" data-arena="' + a + '">' + esc(arenaName(a)) + "</button>";
      }).join("") + '</div><button type="button" class="sd-btn sd-btn-ghost" data-act="arena"' + ready + ">" + esc(t("sd_launch")) + "</button></details></div>";
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
      if (S.picked.length === 4) startRun();
    });
    overlay.querySelector('[data-act="arena"]').addEventListener("click", function () {
      if (S.picked.length === 4) startArena();
    });
    overlay.querySelector(".sd-test-arena").addEventListener("toggle", function (e) { S.arenaOpen = e.target.open; });
  }

  var ARENAS = ["s1", "s2", "s3", "b1", "b2", "b3"];
  function arenaSector(a) { return +a.charAt(1); }
  function arenaBoss(a) { return a.charAt(0) === "b" ? D.BOSSES[arenaSector(a) - 1] : null; }
  function arenaName(a) {
    var boss = arenaBoss(a);
    return boss ? name(boss.name) : t("sd_arena_s" + arenaSector(a));
  }

  // ---------------- 戰鬥 ----------------
  // 敵人與場地機關的產生在 shedan_run.js（遠征層亂數，最終移植成 Go）。這裡只把 setup 交給規則與物理。
  // setup = {heroes, enemies, field, boss, seed, mods, hp, hpMax, gaugeMinus, fullGauge, lifePodUsed}
  function startBattle(setup) {
    S.seed = setup.seed >>> 0;
    var rng = Rng.make(S.seed);
    setup.heroes.forEach(heroImg);
    S.battle = Combat.create({
      heroes: setup.heroes, enemies: setup.enemies, field: setup.field, rng: rng, boss: setup.boss,
      mods: setup.mods || {}, hp: setup.hp, hpMax: setup.hpMax, gaugeMinus: setup.gaugeMinus,
      fullGauge: setup.fullGauge, lifePodUsed: setup.lifePodUsed
    });
    S.battle.avoid = D.HERO_POS.map(function (p) { return { x: p.x, y: p.y, r: K.HERO_R + 6 }; });
    S.world = Physics.create({ Matter: window.Matter, battle: S.battle, field: { wells: S.battle.wells, rocks: S.battle.rocks }, mods: S.battle.mods });
    S.phase = "aim";
    S.aim = null; S.drag = null;
    S.skillArmed = false; S.canRedirect = false; S.walls = [];
    S.recording = false; S.recPath = []; S.ghostPath = null; S.ghost = null; S.lastPath = null; S.bestPath = null;
    S.screen = "battle";
    Render.trailClear(R);
    render();
    updateHud();
    showBanner(t("sd_drag_hint"), 1600);
  }

  // 試玩戰場（不經過遠征）：用與遠征相同的產生器
  function startArena(seed) {
    var sd = seed == null ? (Date.now() >>> 0) : seed;
    var boss = arenaBoss(S.arena);
    var bt = Run.genBattle(Rng.make(sd), { sector: arenaSector(S.arena), boss: boss ? boss.id : null, mods: {} });
    S.run = null;
    startBattle({ heroes: S.picked.map(function (id) { return D.HERO_BY_ID[id]; }), enemies: bt.enemies, field: bt.field, boss: bt.boss, seed: sd });
  }

  // ---------------- 遠征（第 4 階段） ----------------
  function startRun(seed) {
    S.run = Run.create({ seed: seed == null ? String(Date.now()) : String(seed), heroes: S.picked });
    S.screen = "map";
    render();
  }
  function enterNode(id) {
    var run = S.run, node = Run.enter(run, id);
    if (node.type === "battle" || node.type === "elite" || node.type === "boss") startBattle(Run.battleSetup(run));
    else { S.screen = node.type; render(); }
  }
  function backToMap() {
    var run = S.run;
    S.screen = run.state === "won" || run.state === "lost" ? "runEnd" : "map";
    render();
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
    var len = Math.sqrt(dx * dx + dy * dy), maxLen = K.PULL_MAX * maxPower();
    if (len > maxLen) { dx *= maxLen / len; dy *= maxLen / len; len = maxLen; }
    var hp = heroPos(S.battle.active);
    S.aim = { x: hp.x, y: hp.y, dx: dx, dy: dy, power: len / K.PULL_MAX, bounce: !!S.battle.mods.bounceAim };
  }
  // 力道上限：穩定推進器 100% → 115%
  function maxPower() { return 1 + ((S.battle && S.battle.mods.pullMax) || 0); }
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
    var m = b.mods;
    var sp = K.SPEED_MAX * Math.min(maxPower(), power) * (hero.speed || 1);
    var hp = heroPos(b.active);
    var useSkill = S.skillArmed && Combat.canSkill(b);
    S.skillArmed = false;
    var r = Combat.beginShot(b, { skill: useSkill, x: hp.x, y: hp.y, dir: { x: dx / len, y: dy / len } });
    S.walls = [];
    // 殘影（§8.1、§10.1）：上一發有「回聲」→ 重播那一發；殘影投影機 → 每發重播上一發（記憶結晶：本場 Hit 最多的一發）
    var path = S.ghostPath || (m.ghostOn ? (m.ghostMemory ? S.bestPath : S.lastPath) : null);
    S.ghost = path && path.length > 1 ? {
      path: path, i: 0, x: path[0].x, y: path[0].y, loops: m.ghostTwice ? 2 : 1,
      r: K.HERO_R * (1 + (m.ghostRadius || 0))
    } : null;
    S.ghostPath = null;
    S.recording = !!b.ghostNext;   // 這一發有「回聲」：下一發重播這一發
    b.ghostNext = false;
    S.recPath = [];
    applyCmds(r.cmds);
    Physics.launch(S.world, b.active, dx / len * sp, dy / len * sp, r.launch);
    if (S.ghost && m.ghostAirless) Physics.setShooterAirless(S.world, true);   // 時滯晶片
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
      // 共振天線：停住的隊友位置也算星點
      var allies = b.mods.allyStar ? b.party.map(function (q, i) { var hp = heroPos(i); return { i: i, x: hp.x, y: hp.y }; }).filter(function (a) { return a.i !== b.active; }) : null;
      applyCmds(Combat.onPos(b, { x: p.x, y: p.y, r: Physics.heroRadius(w, b.active), allies: allies }));
      S.recPath.push({ x: p.x, y: p.y });   // 每一發都記錄（殘影投影機、記憶結晶用）
    }
    if (S.ghost) {
      var g = S.ghost;
      g.i++;
      if (g.i >= g.path.length && --g.loops > 0) g.i = 0;   // 雙重殘影：跑完再跑一次
      if (g.i >= g.path.length) {
        S.ghost = null;
        if (b.mods.ghostAirless) Physics.setShooterAirless(w, false);
      } else {
        g.x = g.path[g.i].x; g.y = g.path[g.i].y;
        Combat.alive(b).forEach(function (e) {
          var dx = e.x - g.x, dy = e.y - g.y;
          if (Math.sqrt(dx * dx + dy * dy) <= e.r + g.r) applyCmds(Combat.onGhost(b, { enemy: e.uid, step: w.stepNo }));
        });
        // 幽靈隊員／殘影 5：殘影碰到停住的隊友也觸發友情技（規則層限制每發一次）
        if (b.mods.ghostAlly) b.party.forEach(function (q, i) {
          if (i === b.active) return;
          var hp = heroPos(i), ddx = hp.x - g.x, ddy = hp.y - g.y;
          if (Math.sqrt(ddx * ddx + ddy * ddy) <= g.r + Physics.heroRadius(w, i)) applyCmds(Combat.onAlly(b, { ally: i, x: hp.x, y: hp.y, ghost: true }));
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
      var shotHits = b.shot.hits;
      var res = Combat.endShot(b, sp);
      applyCmds(res.cmds);
      // 軌跡：回聲 → 下一發；上一發（投影機）；本場 Hit 最多的一發（記憶結晶）
      if (S.recPath.length > 1) {
        if (S.recording) S.ghostPath = S.recPath;
        S.lastPath = S.recPath;
        if (!S.bestPath || shotHits > S.bestHits) { S.bestPath = S.recPath; S.bestHits = shotHits; }
      }
      S.recording = false; S.recPath = [];
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
        Render.spark(R, c.x, c.y, "#ffe27a");
      } else if (c.type === "addStar") {
        Render.spark(R, c.x, c.y, "#fff3b0");
      } else if (c.type === "miss") {
        var me = Combat.byUid(b, c.uid);
        if (me) Render.floatText(R, me.x, me.y - 30, t("sd_miss"), "#cfd6ff");
      } else if (c.type === "lifePod") {
        showBanner(name(D.RELIC_BY_ID.life_pod.name), 1400);
        updateHud();
      } else if (c.type === "relic") {
        var rl = D.RELIC_BY_ID[c.id];
        if (rl) Render.floatText(R, K.FIELD_W / 2, 120, name(rl.name), "#ffe9a8", true);
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

  // 戰鬥結束：遠征中交給 Run（勝利 → 獎勵三選一；戰敗 → 遠征結束）；試玩戰場顯示結果
  function finish(kind) {
    S.phase = "over";
    S.result = kind;
    updateHud();
    var ended = S.battle;
    window.setTimeout(function () {
      // 延遲期間已經開了下一場（例如測試或快速操作）就不要把新戰鬥切走
      if (S.battle !== ended || S.screen !== "battle") return;
      var b = S.battle;
      if (S.run) {
        S.reward = Run.finishBattle(S.run, {
          win: kind === "win", hp: b.hp, damage: b.stats.damage, maxChain: b.stats.maxChain, lifePodUsed: b.flags.lifePodUsed
        });
        S.screen = S.run.state === "reward" ? "reward" : "runEnd";
      } else S.screen = "result";
      render();
    }, 700);
  }

  function renderResult() {
    var b = S.battle;
    overlay.innerHTML = "<h1>" + esc(t(S.result === "win" ? "sd_win" : "sd_lose")) + "</h1>" +
      "<p>" + esc(t("sd_result_stats", { turns: b.turnNo, dmg: b.stats.damage, chain: b.stats.maxChain })) + "</p>" +
      '<div class="sd-row"><button type="button" class="sd-btn" data-act="again">' + esc(t("sd_again")) + "</button>" +
      '<button type="button" class="sd-btn sd-btn-ghost" data-act="pick">' + esc(t("sd_back_pick")) + "</button></div>";
    overlay.querySelector('[data-act="again"]').addEventListener("click", function () { startArena(); });
    overlay.querySelector('[data-act="pick"]').addEventListener("click", function () { S.screen = "pick"; render(); });
  }

  // ---------------- 遠征畫面 ----------------
  var NODE_ICON = { battle: "⚔", elite: "☠", drifter: "🛟", shop: "🛒", event: "❓", rest: "⛺", boss: "👑" };
  function relicCard(id, extra) {
    var r = D.RELIC_BY_ID[id];
    return '<div class="sd-relic is-' + r.rarity + '"><b>' + esc(name(r.name)) + '</b><span class="sd-relic-tags">' +
      r.tags.map(function (tg) { return esc(name(D.TAG_NAMES[tg])); }).join("・") + " · " + esc(t("sd_rarity_" + r.rarity)) + "</span>" +
      "<span>" + esc(r.desc) + "</span>" + (extra || "") + "</div>";
  }
  function runHeader() {
    var run = S.run;
    return '<div class="sd-run-head"><span class="sd-badge">' + esc(t("sd_arena_s" + run.sector)) + '</span>' +
      '<span class="sd-badge">HP ' + run.hp + " / " + run.hpMax + '</span><span class="sd-badge">⚡ ' + run.energy + "</span>" +
      '<button type="button" class="sd-badge sd-relic-btn" data-act="relics">' + esc(t("sd_relics_n", { n: run.relics.length })) + "</button></div>";
  }
  function bindRunHeader() {
    var rb = overlay.querySelector('[data-act="relics"]');
    if (rb) rb.addEventListener("click", function () { S.prevScreen = S.screen; S.screen = "relics"; render(); });
  }
  function teamRow(onPick) {
    return '<div class="sd-team">' + S.run.heroes.map(function (id, i) {
      var h = D.HERO_BY_ID[id];
      return '<button type="button" class="sd-team-btn" data-team="' + i + '"' + (onPick ? "" : " disabled") + '><img src="' + esc(imgBase + h.img) + '" alt=""><span>' + esc(name(h.name)) + "</span></button>";
    }).join("") + "</div>";
  }

  // 地圖：由下（第 1 層）往上（Boss）；可走的節點高亮
  function renderMap() {
    var run = S.run, map = Run.mapOf(run), reach = Run.reachable(run);
    var html = runHeader() + '<div class="sd-map"><svg class="sd-map-lines"></svg>';
    for (var L = Run.LAYERS + 1; L >= 1; L--) {
      html += '<div class="sd-map-row">';
      map.nodes.filter(function (n) { return n.layer === L; }).forEach(function (n) {
        var vis = Run.typeVisible(run, n);
        var cls = "sd-node" + (reach.indexOf(n.id) >= 0 ? " is-reach" : "") + (run.visited.indexOf(n.id) >= 0 ? " is-done" : "") + (run.nodeId === n.id ? " is-here" : "") + (n.type === "boss" ? " is-boss" : "");
        var left = n.type === "boss" ? 50 : 12.5 + n.col * 25;
        html += '<button type="button" class="' + cls + '" data-node="' + n.id + '" style="left:' + left + '%"' + (reach.indexOf(n.id) >= 0 ? "" : " disabled") +
          ' title="' + esc(vis ? t("sd_node_" + n.type) : "?") + '">' + (vis ? NODE_ICON[n.type] : "?") + "</button>";
      });
      html += "</div>";
    }
    html += "</div>";
    overlay.innerHTML = html;
    bindRunHeader();
    overlay.querySelectorAll("[data-node]").forEach(function (btn) {
      btn.addEventListener("click", function () { enterNode(btn.getAttribute("data-node")); });
    });
    drawMapLines(map);
  }
  function drawMapLines(map) {
    var svg = overlay.querySelector(".sd-map-lines"), box = overlay.querySelector(".sd-map");
    if (!svg || !box) return;
    var br = box.getBoundingClientRect(), lines = "";
    function center(id) {
      var n = overlay.querySelector('[data-node="' + id + '"]');
      if (!n) return null;
      var r = n.getBoundingClientRect();
      return { x: r.left + r.width / 2 - br.left, y: r.top + r.height / 2 - br.top };
    }
    map.nodes.forEach(function (n) {
      var a = center(n.id);
      n.next.forEach(function (id) {
        var c = center(id);
        if (a && c) lines += '<line x1="' + a.x + '" y1="' + a.y + '" x2="' + c.x + '" y2="' + c.y + '"/>';
      });
    });
    svg.setAttribute("width", br.width);
    svg.setAttribute("height", br.height);
    svg.innerHTML = lines;
  }

  function renderReward() {
    var rw = S.reward || { energy: 0, choices: [] };
    var html = runHeader() + "<h1>" + esc(t("sd_win")) + "</h1><p>" + esc(t("sd_energy_gain", { n: rw.energy })) + "</p><p>" + esc(t("sd_pick_relic")) + '</p><div class="sd-relic-list">';
    rw.choices.forEach(function (id) { html += '<button type="button" class="sd-relic-pick" data-relic="' + id + '">' + relicCard(id) + "</button>"; });
    html += '</div><button type="button" class="sd-btn sd-btn-ghost" data-act="skip">' + esc(t("sd_skip")) + "</button>";
    overlay.innerHTML = html;
    bindRunHeader();
    overlay.querySelectorAll("[data-relic]").forEach(function (btn) {
      btn.addEventListener("click", function () { Run.takeRelic(S.run, btn.getAttribute("data-relic")); backToMap(); });
    });
    overlay.querySelector('[data-act="skip"]').addEventListener("click", function () { Run.takeRelic(S.run, null); backToMap(); });
  }

  function renderShop() {
    var run = S.run, sh = Run.data(run).shop;
    var html = runHeader() + "<h1>" + esc(t("sd_node_shop")) + '</h1><div class="sd-relic-list">';
    sh.items.forEach(function (it, i) {
      var can = !it.sold && run.energy >= it.price && run.relics.indexOf(it.id) < 0;
      html += relicCard(it.id, '<button type="button" class="sd-btn" data-buy="' + i + '"' + (can ? "" : " disabled") + ">" + (it.sold ? esc(t("sd_sold")) : "⚡ " + it.price) + "</button>");
    });
    var rc = Run.repairCost(run);
    html += '</div><div class="sd-row"><button type="button" class="sd-btn" data-act="repair"' + (!sh.repaired && run.energy >= rc ? "" : " disabled") + ">" +
      esc(t("sd_repair", { n: rc })) + '</button><button type="button" class="sd-btn sd-btn-ghost" data-act="leave">' + esc(t("sd_leave")) + "</button></div>";
    overlay.innerHTML = html;
    bindRunHeader();
    overlay.querySelectorAll("[data-buy]").forEach(function (btn) {
      btn.addEventListener("click", function () { Run.buy(run, +btn.getAttribute("data-buy")); renderShop(); });
    });
    overlay.querySelector('[data-act="repair"]').addEventListener("click", function () { Run.repair(run); renderShop(); });
    overlay.querySelector('[data-act="leave"]').addEventListener("click", function () { Run.leave(run); backToMap(); });
  }

  function renderRest() {
    var run = S.run;
    var heal = Math.round(run.hpMax * 0.3 * (1 + (Run.mods(run).restBonus || 0)));
    overlay.innerHTML = runHeader() + "<h1>" + esc(t("sd_node_rest")) + "</h1>" +
      '<div class="sd-row"><button type="button" class="sd-btn" data-act="heal">' + esc(t("sd_rest_heal", { n: heal })) + "</button></div>" +
      "<p>" + esc(t("sd_rest_upgrade")) + "</p>" + teamRow(true);
    bindRunHeader();
    overlay.querySelector('[data-act="heal"]').addEventListener("click", function () { Run.rest(run, "heal"); backToMap(); });
    overlay.querySelectorAll("[data-team]").forEach(function (btn) {
      btn.addEventListener("click", function () { Run.rest(run, "upgrade", +btn.getAttribute("data-team")); backToMap(); });
    });
  }

  function renderDrifter() {
    var run = S.run, who = Run.data(run).drifter;
    if (!who) { Run.leave(run); backToMap(); return; }
    var h = D.HERO_BY_ID[who], info = D.ELEMENT_INFO[h.element];
    var pay = S.drifterPay;
    var html = runHeader() + "<h1>" + esc(t("sd_node_drifter")) + '</h1><div class="sd-drifter"><img src="' + esc(imgBase + h.img) + '" alt="" style="border-color:' + info.color + '">' +
      "<b>" + esc(name(h.name)) + "</b><span>" + info.icon + " " + esc(name(info.name)) + "・" + esc(name(h.skill.name)) + "</span></div>";
    if (!pay) {
      html += '<div class="sd-row"><button type="button" class="sd-btn" data-pay="energy"' + (Run.canRescue(run, "energy") ? "" : " disabled") + ">" + esc(t("sd_pay_energy", { n: Run.drifterCost(run, "energy") })) + "</button>" +
        '<button type="button" class="sd-btn" data-pay="hp"' + (Run.canRescue(run, "hp") ? "" : " disabled") + ">" + esc(t("sd_pay_hp", { n: Run.drifterCost(run, "hp") })) + "</button>" +
        '<button type="button" class="sd-btn sd-btn-ghost" data-act="leave">' + esc(t("sd_leave")) + "</button></div>";
    } else {
      html += "<p>" + esc(t("sd_replace_who")) + "</p>" + teamRow(true) + '<button type="button" class="sd-btn sd-btn-ghost" data-act="noswap">' + esc(t("sd_no_swap")) + "</button>";
    }
    overlay.innerHTML = html;
    bindRunHeader();
    overlay.querySelectorAll("[data-pay]").forEach(function (btn) {
      btn.addEventListener("click", function () { S.drifterPay = btn.getAttribute("data-pay"); renderDrifter(); });
    });
    var lv = overlay.querySelector('[data-act="leave"]');
    if (lv) lv.addEventListener("click", function () { Run.leave(run); backToMap(); });
    overlay.querySelectorAll("[data-team]").forEach(function (btn) {
      btn.addEventListener("click", function () { Run.rescue(run, pay, +btn.getAttribute("data-team")); S.drifterPay = null; backToMap(); });
    });
    var ns = overlay.querySelector('[data-act="noswap"]');
    if (ns) ns.addEventListener("click", function () { Run.rescue(run, pay, null); S.drifterPay = null; backToMap(); });
  }

  function renderEvent() {
    var run = S.run, ev = Run.eventOf(run);
    overlay.innerHTML = runHeader() + "<h1>" + esc(name(ev.name)) + "</h1><p>" + esc(name(ev.text)) + '</p><div class="sd-row sd-col">' +
      ["a", "b"].map(function (o) {
        return '<button type="button" class="sd-btn" data-opt="' + o + '"' + (Run.canChoose(run, o) ? "" : " disabled") + ">" + esc(name(ev[o].label)) + "</button>";
      }).join("") + "</div>";
    bindRunHeader();
    overlay.querySelectorAll("[data-opt]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var out = Run.choose(run, btn.getAttribute("data-opt"));
        S.eventOut = out;
        S.screen = "eventOut";
        render();
      });
    });
  }
  function renderEventOut() {
    var o = S.eventOut || {};
    var lines = [];
    if (o.relic) lines.push(t("sd_got_relic", { name: name(D.RELIC_BY_ID[o.relic].name) }));
    if (o.energy) lines.push("⚡ " + (o.energy > 0 ? "+" : "") + o.energy);
    if (o.hp) lines.push("HP " + (o.hp > 0 ? "+" : "") + o.hp);
    if (o.maxHp) lines.push(t("sd_max_hp") + " " + (o.maxHp > 0 ? "+" : "") + o.maxHp);
    if (!lines.length) lines.push(t("sd_nothing"));
    overlay.innerHTML = runHeader() + "<h1>" + esc(t("sd_node_event")) + "</h1>" + lines.map(function (l) { return "<p>" + esc(l) + "</p>"; }).join("") +
      (o.relic ? '<div class="sd-relic-list">' + relicCard(o.relic) + "</div>" : "") +
      '<button type="button" class="sd-btn" data-act="ok">' + esc(t("sd_continue")) + "</button>";
    bindRunHeader();
    overlay.querySelector('[data-act="ok"]').addEventListener("click", backToMap);
  }

  // 持有遺物與套裝進度
  function renderRelics() {
    var run = S.run, n = D.tagCounts(run.relics);
    var html = "<h1>" + esc(t("sd_relics")) + '</h1><div class="sd-sets">' + D.TAGS.map(function (tg) {
      var c = n[tg], st = D.SETS[tg];
      return '<div class="sd-set' + (c >= 3 ? " is-on" : "") + '"><b>' + esc(name(D.TAG_NAMES[tg])) + " " + c + '</b><span class="' + (c >= 3 ? "on" : "") + '">3：' + esc(st.d3) +
        '</span><span class="' + (c >= 5 ? "on" : "") + '">5：' + esc(st.d5) + "</span></div>";
    }).join("") + '</div><div class="sd-relic-list">' + (run.relics.length ? run.relics.map(function (id) { return relicCard(id); }).join("") : "<p>" + esc(t("sd_no_relics")) + "</p>") +
      '</div><button type="button" class="sd-btn" data-act="back">' + esc(t("sd_continue")) + "</button>";
    overlay.innerHTML = html;
    overlay.querySelector('[data-act="back"]').addEventListener("click", function () { S.screen = S.prevScreen || "map"; render(); });
  }

  function renderRunEnd() {
    var run = S.run, s = run.stats;
    overlay.innerHTML = "<h1>" + esc(t(run.state === "won" ? "sd_run_won" : "sd_run_lost")) + "</h1>" +
      "<p>" + esc(t("sd_run_stats", { nodes: s.nodes, dmg: s.damage, chain: s.maxChain, bosses: s.bosses })) + "</p>" +
      '<p class="sd-score">' + esc(t("sd_score", { n: Run.score(run) })) + "</p>" +
      '<div class="sd-row"><button type="button" class="sd-btn" data-act="pick">' + esc(t("sd_back_pick")) + "</button></div>";
    overlay.querySelector('[data-act="pick"]').addEventListener("click", function () { S.run = null; S.screen = "pick"; render(); });
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
      pick: function (ids, arena, seed) { S.picked = ids.slice(0, 4); if (arena) S.arena = arena; startArena(seed == null ? 1234 : seed); },
      startRun: function (ids, seed) { S.picked = ids.slice(0, 4); startRun(seed == null ? "debug" : seed); },
      run: function () { return S.run; },
      enter: function (id) { enterNode(id); },
      // 測試：直接把遺物加進遠征（全部 100 件同時持有的煙霧測試用）
      giveRelics: function (ids) { ids.forEach(function (id) { Run.addRelic(S.run, id); }); },
      arenaWithRelics: function (ids, arena, seed) {
        S.arena = arena || "s1";
        var sd = seed || 99, boss = arenaBoss(S.arena);
        var bt = Run.genBattle(Rng.make(sd), { sector: arenaSector(S.arena), boss: boss ? boss.id : null, mods: D.computeMods(ids) });
        S.run = null;
        startBattle({ heroes: S.picked.map(function (id) { return D.HERO_BY_ID[id]; }), enemies: bt.enemies, field: bt.field, boss: bt.boss, seed: sd, mods: D.computeMods(ids) });
      },
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
