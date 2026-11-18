// 射彈宇宙（shedan）：畫面流程。滿版＋導覽列切換、選隊、拉弓輸入、主迴圈（物理 → 規則 → 特效）、敵人回合、結算。
// 第 1 階段：單場戰鬥（初始 8 人、星區 1 的敵人）。規則依據 docs/shedan_game_design.md。
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
    battle: null, world: null,
    phase: "aim",              // aim | shooting | enemy | over
    aim: null, drag: null,
    seed: 0, result: null,
    lastTime: 0
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
  function initialHeroes() { return D.HEROES.filter(function (h) { return h.initial; }); }

  function render() {
    overlay.style.display = S.screen === "battle" ? "none" : "flex";
    hudWrap.style.display = S.screen === "battle" ? "block" : "none";
    if (S.screen === "pick") renderPick();
    else if (S.screen === "result") renderResult();
  }

  function renderPick() {
    var html = '<h1>' + esc(t("sd_title")) + '</h1><p>' + esc(t("sd_pick_hint", { n: S.picked.length })) + '</p><div class="sd-pick-grid">';
    initialHeroes().forEach(function (h) {
      var idx = S.picked.indexOf(h.id);
      var info = D.ELEMENT_INFO[h.element];
      html += '<button type="button" class="sd-pick-card' + (idx >= 0 ? " is-picked" : "") + '" data-hero="' + h.id + '" style="--sd-el:' + info.color + '">' +
        (idx >= 0 ? '<span class="sd-pick-order">' + (idx + 1) + "</span>" : "") +
        '<img src="' + esc(imgBase + h.img) + '" alt="">' +
        "<b>" + esc(name(h.name)) + '</b><span class="sd-el-tag">' + info.icon + " " + esc(name(info.name)) + "</span></button>";
    });
    html += '</div><button type="button" class="sd-btn" data-act="launch"' + (S.picked.length === 4 ? "" : " disabled") + ">" + esc(t("sd_launch")) + "</button>";
    overlay.innerHTML = html;
    overlay.querySelectorAll("[data-hero]").forEach(function (b) {
      b.addEventListener("click", function () {
        var id = b.getAttribute("data-hero"), i = S.picked.indexOf(id);
        if (i >= 0) S.picked.splice(i, 1);
        else if (S.picked.length < 4) S.picked.push(id);
        renderPick();
      });
    });
    overlay.querySelector('[data-act="launch"]').addEventListener("click", function () {
      if (S.picked.length === 4) startBattle();
    });
  }

  // ---------------- 戰鬥 ----------------
  function genEnemies(rng) {
    var pool = D.ENEMIES.filter(function (e) { return e.sector === 1; });
    var count = Rng.int(rng, 4, 6), list = [], large = 0;
    while (list.length < count) {
      var def = Rng.pick(rng, pool);
      if (def.size === "l" && large >= 1) continue;
      if (def.size === "l") large++;
      list.push(def);
    }
    var placed = [];
    list.forEach(function (def) {
      var r = D.SIZE_R[def.size];
      for (var tries = 0; tries < 300; tries++) {
        var x = Rng.int(rng, r + 20, K.FIELD_W - r - 20), y = Rng.int(rng, 110, 620);
        var ok = placed.every(function (p) {
          var dx = p.x - x, dy = p.y - y;
          return Math.sqrt(dx * dx + dy * dy) > p.r + r + 26;
        });
        if (ok) { placed.push({ def: def, x: x, y: y, r: r }); return; }
      }
    });
    return placed;
  }

  function startBattle(seed) {
    S.seed = seed == null ? (Date.now() >>> 0) : seed;
    var rng = Rng.make(S.seed);
    var heroes = S.picked.map(function (id) { return D.HERO_BY_ID[id]; });
    heroes.forEach(heroImg);
    S.battle = Combat.create({ heroes: heroes, enemies: genEnemies(rng) });
    S.world = Physics.create({ Matter: window.Matter, battle: S.battle });
    S.phase = "aim";
    S.aim = null; S.drag = null;
    S.screen = "battle";
    Render.trailClear(R);
    render();
    updateHud();
    showBanner(t("sd_drag_hint"), 1600);
  }

  function heroPos(i) { return Physics.heroPos(S.world, i); }

  // ---------------- 輸入：任何位置按住拖曳拉弓 ----------------
  function onDown(e) {
    if (S.screen !== "battle" || S.phase !== "aim" || isNavOpen() || Date.now() - navClosedAt < 250) return;
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
    Combat.beginShot(b);
    Physics.launch(S.world, b.active, dx / len * sp, dy / len * sp);
    S.phase = "shooting";
    Render.trailClear(R);
    updateHud();
  }

  // ---------------- 主迴圈 ----------------
  function frame(time) {
    var dt = S.lastTime ? Math.min(0.05, (time - S.lastTime) / 1000) : 0.016;
    S.lastTime = time;
    if (S.screen === "battle" && S.phase === "shooting") {
      for (var i = 0; i < K.SUBSTEPS && S.phase === "shooting"; i++) {
        var evs = Physics.step(S.world);
        for (var j = 0; j < evs.length; j++) handleEvent(evs[j]);
      }
      if (S.phase === "shooting") { var p = heroPos(S.battle.active); Render.trailPush(R, p.x, p.y); }
    }
    Render.draw(R, {
      time: time, battle: S.screen === "result" || S.screen === "battle" ? S.battle : null,
      heroPos: heroPos, imgs: imgs, aim: S.aim, shooter: S.phase === "shooting" && S.battle ? S.battle.active : null
    }, dt);
    window.requestAnimationFrame(frame);
  }

  function handleEvent(ev) {
    var b = S.battle;
    if (ev.type === "hit") {
      applyCmds(Combat.onHit(b, ev));
      updateHud();
    } else if (ev.type === "stop") {
      var res = Combat.endShot(b);
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
      }
    });
  }

  function runEnemyTurn() {
    if (S.screen !== "battle") return;
    showBanner(t("sd_enemy_turn"), 700);
    window.setTimeout(function () {
      var b = S.battle;
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
    hudTop.innerHTML = '<span class="sd-badge">' + esc(t("sd_turn", { n: b.turnNo })) + "</span>" +
      '<span class="sd-badge">' + esc(t("sd_hits", { n: b.shot.hits })) + "</span>" +
      '<span class="sd-badge">' + esc(t("sd_max_chain", { n: Math.max(b.stats.maxChain, b.shot.chain) })) + "</span>";
    var slots = b.party.map(function (p, i) {
      return '<span class="sd-party-slot' + (i === b.active && S.phase !== "enemy" ? " is-active" : "") + '" style="background-image:url(\'' + esc(imgBase + p.def.img) + '\')"></span>';
    }).join("");
    hudBottom.innerHTML = '<div class="sd-party">' + slots + "</div>" +
      '<div class="sd-hp-box"><div class="sd-hp"><span class="sd-hp-fill" style="width:' + (100 * b.hp / b.hpMax).toFixed(1) + '%"></span></div>' +
      '<div class="sd-hp-text">HP ' + b.hp + " / " + b.hpMax + "</div></div>";
    if (!hudLaidOut) { hudLaidOut = true; layoutHud(); }
  }
  var hudLaidOut = false;

  // ---------------- 測試用 ----------------
  window.PriTestShedanApp = {
    isNavOpen: isNavOpen, setNavOpen: setNavOpen,
    _debug: {
      state: function () { return S; },
      pick: function (ids) { S.picked = ids.slice(0, 4); startBattle(1234); },
      shoot: function (dx, dy, power) { if (S.phase === "aim") shoot(dx, dy, power == null ? 1 : power); },
      forceWin: function () {
        S.battle.enemies.forEach(function (e) { e.dead = true; e.hp = 0; Physics.removeEnemy(S.world, e.uid); });
        finish("win");
      },
      enemyHp: function () { return S.battle.enemies.reduce(function (s, e) { return s + e.hp; }, 0); }
    }
  };

  setupNav();
  if (app) {
    build();
    render();
    window.requestAnimationFrame(frame);
  }
})();
