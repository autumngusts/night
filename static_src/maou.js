// 魔王城的防衛戰（maou）：塔防引擎與畫面。2026-11-11 依使用者需求新增。
// 每章：城內（配置部下、升級、談話培養羈絆）→ 防衛戰（Canvas 即時塔防）→ 戰後的夜晚（羈絆第 2 段後可共度）→ 下一章。
// 第 12 章打倒勇者後，從締結契約的部下中選出魔后＝結局。輸了可以重打同一章。
(function () {
  "use strict";

  var D = window.PriTestMaouData, ST = window.PriTestMaouStory, N = window.PriTestMaouNight, MORE = window.PriTestMaouNightMore || { OWN: {}, SHARED: [], TALK: [] };
  // 夜晚劇情：每位部下 4 段專屬（maou_night.js 第 1 段＋maou_night2/3.js 第 2〜4 段），之後從共用劇情挑（2026-11-12 加量）
  function ownList(id) { return N.OWN[id] ? [N.OWN[id]].concat(MORE.OWN[id] || []) : []; }
  var SHARED_ALL = N.SHARED.concat(MORE.SHARED || []);
  var app = document.getElementById("mu-app");
  if (!D || !ST || !N || !app) return;

  var IMG = app.getAttribute("data-img") || "../static/images/jikan/";
  var SAVE_KEY = "pritest-maou-save-v1", AGE_KEY = "pritest-maou-age-ok", ALBUM_KEY = "pritest-maou-album", BEST_KEY = "pritest-maou-best";
  var T = D.TILE, W = D.COLS * T, HH = D.ROWS * T;
  var G = {}; D.GIRLS.forEach(function (g) { G[g.id] = g; });
  var SKILL_CD = 35;

  var st = null, sim = null, raf = 0;
  var ui = { screen: "title", vn: null, story: null, toast: "", ageOk: false, pick: null, sel: null, speed: 1, queue: [] };

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function load(k) { try { var s = localStorage.getItem(k); return s ? JSON.parse(s) : null; } catch (e) { return null; } }
  function store(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function save() { store(SAVE_KEY, st && !st.ended ? st : null); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function ageOk() { try { return localStorage.getItem(AGE_KEY) === "1"; } catch (e) { return ui.ageOk; } }
  function album() { return load(ALBUM_KEY) || {}; }
  function addAlbum(k) { var a = album(); a[k] = 1; store(ALBUM_KEY, a); }
  function log(t) { st.log.unshift("第" + st.ch + "章　" + t); if (st.log.length > 50) st.log.length = 50; }

  // ---------------- 地圖 ----------------
  var PTS = D.PATH.map(function (p) { return [(p[0] + 0.5) * T, (p[1] + 0.5) * T]; });
  var SEG = [], TOTAL = 0;
  for (var i = 1; i < PTS.length; i++) { var dx = PTS[i][0] - PTS[i - 1][0], dy = PTS[i][1] - PTS[i - 1][1], L = Math.sqrt(dx * dx + dy * dy); SEG.push(L); TOTAL += L; }
  function posAt(d) {
    d = clamp(d, 0, TOTAL);
    for (var k = 0; k < SEG.length; k++) {
      if (d <= SEG[k]) { var f = SEG[k] ? d / SEG[k] : 0; return [PTS[k][0] + (PTS[k + 1][0] - PTS[k][0]) * f, PTS[k][1] + (PTS[k + 1][1] - PTS[k][1]) * f]; }
      d -= SEG[k];
    }
    return PTS[PTS.length - 1];
  }
  var PATHSET = {};
  (function () {
    for (var k = 1; k < D.PATH.length; k++) {
      var a = D.PATH[k - 1], b = D.PATH[k], sx = Math.sign(b[0] - a[0]), sy = Math.sign(b[1] - a[1]), x = a[0], y = a[1];
      while (true) { if (x >= 0) PATHSET[x + "," + y] = 1; if (x === b[0] && y === b[1]) break; x += sx; y += sy; }
    }
  })();
  function buildable(c, r) { return c >= 0 && r >= 0 && c < D.COLS && r < D.ROWS && !PATHSET[c + "," + r] && !(c === D.THRONE[0] && r === D.THRONE[1]); }
  var IMGS = {};
  D.GIRLS.forEach(function (g) { var im = new Image(); im.src = IMG + g.img; IMGS[g.id] = im; });

  // ---------------- 新遊戲 ----------------
  function newGame() {
    st = { ch: 1, gold: 120, ap: 2, girls: {}, place: {}, log: [], flags: {}, ended: false, lastShared: -1, cleared: 0 };
    D.GIRLS.forEach(function (g) { st.girls[g.id] = { joined: false, lv: 1, bond: 0, line: 0, pact: false, nights: 0, kills: 0 }; });
    startVN(null, "序章", ST.PROLOGUE, function () { chapterStart(); });
  }
  function joined() { return D.GIRLS.filter(function (g) { return st.girls[g.id].joined; }); }
  function deployed() { return Object.keys(st.place); }
  function chapterStart() {
    st.ap = 2; st.phase = "prep";
    var news = D.GIRLS.filter(function (g) { return g.join <= st.ch && !st.girls[g.id].joined; });
    function next() {
      var g = news.shift();
      if (!g) { ui.screen = "hub"; save(); render(); return; }
      st.girls[g.id].joined = true;
      log("✨ " + g.name + "（" + g.title + "）加入了魔王軍");
      startVN(g.id, g.title + "・" + g.name + "加入", ST.S[g.id].join.concat([g.name + "：" + D.TYPES[g.type].name + "型。" + D.TYPES[g.type].desc]), next);
      render();
    }
    next();
  }

  // ---------------- VN ----------------
  function startVN(who, title, steps, after) { ui.vn = { who: who, title: title, steps: steps.slice(), i: 0, after: after }; ui.screen = "vn"; advanceSilent(); }
  function applyEff(e, who) { if (!e) return; if (e.b && who) addBond(who, e.b); }
  function addBond(id, n) { var x = st.girls[id]; x.bond = clamp(x.bond + n, 0, 100); if (n > 0) ui.toast = G[id].name + " 羈絆 +" + n; }
  function advanceSilent() {
    var v = ui.vn;
    while (v && v.i < v.steps.length) { var s = v.steps[v.i]; if (s && typeof s === "object" && !Array.isArray(s) && s.e && !s.ch) { applyEff(s.e, v.who); v.i++; continue; } break; }
    if (v && v.i >= v.steps.length) { ui.vn = null; if (v.after) v.after(); else { ui.screen = "hub"; save(); } }
  }
  function vnNext() { ui.vn.i++; advanceSilent(); render(); }
  function vnChoose(k) { var v = ui.vn, c = v.steps[v.i].ch[k]; applyEff(c.e, v.who); v.steps.splice.apply(v.steps, [v.i + 1, 0].concat((c.r || []).slice())); v.i++; advanceSilent(); render(); }

  // ---------------- 城內 ----------------
  function lineDue(id) { var x = st.girls[id]; return x.line < 2 && x.bond >= D.BOND_LINE[x.line]; }
  function pactDue(id) { var x = st.girls[id]; return !x.pact && x.line >= 2 && x.bond >= D.BOND_PACT; }
  function talk(id) {
    if (st.ap <= 0) return;
    st.ap--;
    var x = st.girls[id], g = G[id];
    if (pactDue(id)) {
      startVN(id, g.name + "・契約", ST.S[id].pact.concat([{ ch: [{ t: "接受她的契約", e: { b: 5 }, r: ["契約的魔法陣在你們腳下亮起。從今以後，她是你的伴侶。"] }, { t: "「……等戰爭結束再說。」", e: { b: -10 } }] }]), function () {
        if (st.girls[id].bond >= D.BOND_PACT) { x.pact = true; log("💍 和 " + g.name + " 締結了契約"); }
        ui.screen = "hub"; save();
      });
      return;
    }
    if (lineDue(id)) {
      var ln = ST.S[id].lines[x.line]; x.line++;
      log("📝 " + g.name + "的故事：" + ln.title + (x.line === 2 ? "（奧義「" + g.skill + "」解鎖）" : ""));
      startVN(id, g.name + "・" + ln.title + "（" + x.line + "/2）", ln.steps, function () { ui.screen = "hub"; save(); });
      return;
    }
    var lines = [["魔王大人，今天的戰鬥辛苦了。……要我幫你按摩肩膀嗎？", "「拜託你了。」", "「不用了，你也累了吧。」"], ["勇者軍好像越來越強了。我會更努力的。", "「有你在，我很安心。」", "「別勉強自己。」"], ["魔王大人，你看，今晚的月亮好漂亮。", "「你比月亮漂亮。」", "「嗯，很漂亮。」"]];
    lines = lines.concat(MORE.TALK || []);
    var c = pick(lines);
    startVN(id, "談話・" + g.name, [["@", c[0]], { ch: Math.random() < 0.5 ? [{ t: c[1], e: { b: 16 } }, { t: c[2], e: { b: 10 } }] : [{ t: c[2], e: { b: 10 } }, { t: c[1], e: { b: 16 } }] }], function () { ui.screen = "hub"; save(); });
  }
  function upgrade(id) {
    var x = st.girls[id]; if (x.lv >= 5) return;
    var cost = D.UPGRADE[x.lv]; if (st.gold < cost) { ui.toast = "金幣不夠"; return; }
    st.gold -= cost; x.lv++; log("⬆ " + G[id].name + " 升到 Lv" + x.lv); save();
  }
  function placeAt(id, c, r) {
    if (!buildable(c, r)) return false;
    var key = c + "," + r;
    for (var k in st.place) if (st.place[k] === key && k !== id) return false;
    if (!st.place[id] && deployed().length >= D.deployCap(st.ch)) { ui.toast = "這一章最多只能配置 " + D.deployCap(st.ch) + " 位"; return false; }
    st.place[id] = key; save(); return true;
  }
  function unitAt(c, r) { var key = c + "," + r; for (var k in st.place) if (st.place[k] === key) return k; return null; }

  // ---------------- 防衛戰 ----------------
  function unitDmg(id, u) {
    var g = G[id], tp = D.TYPES[g.type], d = tp.dmg * Math.pow(D.LV_MULT, st.girls[id].lv - 1);
    if (g.type !== "support" && sim.units.some(function (o) { return o.id !== id && G[o.id].type === "support" && dist(o.x, o.y, u.x, u.y) <= D.TYPES.support.range * T; })) d *= 1.25;
    return d;
  }
  function dist(ax, ay, bx, by) { var dx = ax - bx, dy = ay - by; return Math.sqrt(dx * dx + dy * dy); }
  function startBattle() {
    var wave = D.WAVES[st.ch], q = [];
    wave.g.forEach(function (gr) { for (var k = 0; k < gr[1]; k++) q.push({ t: gr[3] + k * gr[2], type: gr[0] }); });
    q.sort(function (a, b) { return a.t - b.t; });
    sim = { t: 0, q: q, total: q.length, en: [], hp: D.THRONE_HP, units: [], fx: [], gold: 0, kills: {}, done: null, cd: {}, haste: 0, drain: 0 };
    deployed().forEach(function (id) {
      var p = st.place[id].split(","), c = +p[0], r = +p[1];
      sim.units.push({ id: id, c: c, r: r, x: (c + 0.5) * T, y: (r + 0.5) * T, cd: Math.random() * 0.5, hits: 0 });
      sim.cd[id] = 0; sim.kills[id] = 0;
    });
    ui.screen = "battle"; ui.sel = null; ui.pick = null;
    log("⚔ 第 " + st.ch + " 章「" + wave.name + "」開戰（配置 " + sim.units.length + " 位）");
    render();
    loop();
  }
  function spawn(type) {
    var E = D.ENEMIES[type], m = E.boss ? D.bossMult(st.ch) : D.hpMult(st.ch);
    sim.en.push({ type: type, hp: E.hp * m, max: E.hp * m, d: 0, slowT: 0, slowF: 0, curseT: 0, stunT: 0, confT: 0 });
  }
  function hit(e, amt, kind, pierce, by) {
    var E = D.ENEMIES[e.type];
    if (kind === "magic" && E.resist) amt *= 1 - E.resist;
    if (e.curseT > 0) amt *= 1.35;
    if (kind === "phys" && E.armor) amt = Math.max(1, amt - E.armor * (1 - (pierce || 0)));
    e.hp -= amt;
    if (by && G[by] && G[by].type === "drain") { sim.drain += amt; while (sim.drain >= 120) { sim.drain -= 120; sim.hp = Math.min(D.THRONE_HP, sim.hp + 1); } }
    if (e.hp <= 0 && !e.dead) { e.dead = true; sim.gold += E.gold; if (by) sim.kills[by] = (sim.kills[by] || 0) + 1; }
  }
  function step(dt) {
    var s = sim; if (!s || s.done) return;
    s.t += dt;
    while (s.q.length && s.q[0].t <= s.t) spawn(s.q.shift().type);
    if (s.haste > 0) s.haste -= dt;
    Object.keys(s.cd).forEach(function (k) { if (s.cd[k] > 0) s.cd[k] -= dt; });
    // 敵人移動
    s.en.forEach(function (e) {
      var E = D.ENEMIES[e.type], sp = E.speed * T;
      if (e.slowT > 0) { e.slowT -= dt; sp *= 1 - e.slowF; }
      if (e.curseT > 0) e.curseT -= dt;
      if (E.regen) e.hp = Math.min(e.max, e.hp + E.regen * dt);
      if (E.heal) s.en.forEach(function (o) { if (o !== e && !o.dead && Math.abs(o.d - e.d) <= 1.5 * T) o.hp = Math.min(o.max, o.hp + E.heal * dt); });
      if (e.stunT > 0) { e.stunT -= dt; return; }
      if (e.confT > 0) { e.confT -= dt; e.d = Math.max(0, e.d - sp * 0.6 * dt); return; }
      e.d += sp * dt;
      if (e.d >= TOTAL && !e.dead) { e.dead = true; e.leak = true; s.hp -= E.boss ? 5 : 1; }
    });
    // 部下攻擊
    s.units.forEach(function (u) {
      var g = G[u.id], tp = D.TYPES[g.type];
      u.cd -= dt * (s.haste > 0 ? 2 : 1);
      if (u.cd > 0) return;
      var best = null;
      s.en.forEach(function (e) { if (e.dead) return; var p = posAt(e.d); if (dist(p[0], p[1], u.x, u.y) <= tp.range * T && (!best || e.d > best.d)) best = e; });
      if (!best) { u.cd = 0.1; return; }
      u.cd = 1 / tp.rate;
      var dmg = unitDmg(u.id, u), bp = posAt(best.d);
      s.fx.push({ k: "shot", x1: u.x, y1: u.y, x2: bp[0], y2: bp[1], c: g.color, t: 0.14 });
      if (tp.splash) {
        s.fx.push({ k: "ring", x: bp[0], y: bp[1], r: tp.splash * T, c: g.color, t: 0.25 });
        s.en.forEach(function (e) { if (e.dead) return; var p = posAt(e.d); if (dist(p[0], p[1], bp[0], bp[1]) <= tp.splash * T) { if (g.type === "curse") e.curseT = 3; hit(e, dmg, tp.kind, 0, u.id); } });
      } else hit(best, dmg, tp.kind, tp.pierce, u.id);
      if (g.type === "charm") { best.slowT = 1.5; best.slowF = 0.45; }
      if (g.type === "illusion" && !D.ENEMIES[best.type].boss && Math.random() < 0.3) best.confT = 1.2;
      if (g.type === "knight" && ++u.hits % 3 === 0) best.stunT = 0.6;
    });
    s.en = s.en.filter(function (e) { return !e.dead; });
    s.fx.forEach(function (f) { f.t -= dt; });
    s.fx = s.fx.filter(function (f) { return f.t > 0; });
    if (s.hp <= 0) s.done = "lose";
    else if (!s.q.length && !s.en.length) s.done = "win";
  }
  function useSkill(id) {
    var s = sim; if (!s || s.done || s.cd[id] > 0) return;
    var u = s.units.filter(function (x) { return x.id === id; })[0]; if (!u) return;
    s.cd[id] = SKILL_CD;
    function near(r) { return s.en.filter(function (e) { var p = posAt(e.d); return dist(p[0], p[1], u.x, u.y) <= r * T; }); }
    s.fx.push({ k: "ring", x: u.x, y: u.y, r: 3 * T, c: G[id].color, t: 0.6 });
    if (id === "lilith") s.en.forEach(function (e) { e.slowT = 4; e.slowF = 0.6; });
    else if (id === "sylph") s.en.slice().forEach(function (e) { hit(e, 40, "phys", 1, id); });
    else if (id === "rose") near(3).forEach(function (e) { e.stunT = 2; });
    else if (id === "fang") s.haste = 5;
    else if (id === "ignis") near(2.5).forEach(function (e) { hit(e, 150, "magic", 0, id); });
    else if (id === "vera") { near(3).forEach(function (e) { hit(e, 60, "phys", 1, id); }); s.hp = Math.min(D.THRONE_HP, s.hp + 2); }
    else if (id === "kuzu") s.en.forEach(function (e) { if (!D.ENEMIES[e.type].boss) e.d = Math.max(0, e.d - 3 * T); });
    else if (id === "morgan") s.en.forEach(function (e) { e.curseT = 6; });
    else if (id === "dryad") s.hp = Math.min(D.THRONE_HP, s.hp + 5);
    else if (id === "zero") for (var k = 0; k < 8 && s.en.length; k++) hit(pick(s.en), 25, "phys", 1, id);
    s.en = s.en.filter(function (e) { return !e.dead; });
    renderBattleUI();
  }
  var last = 0;
  function loop() {
    cancelAnimationFrame(raf);
    last = performance.now();
    function frame(now) {
      if (ui.screen !== "battle" || !sim) return;
      var dt = Math.min(0.05, (now - last) / 1000); last = now;
      if (!ui.paused) for (var k = 0; k < ui.speed; k++) step(dt);
      draw();
      if (Math.floor(now / 250) !== Math.floor((now - dt * 1000) / 250)) renderBattleUI();
      if (sim.done) { finishBattle(); return; }
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
  }
  function finishBattle() {
    cancelAnimationFrame(raf);
    var s = sim, win = s.done === "win";
    var res = { win: win, gold: s.gold, kills: s.kills, hp: s.hp, bonds: {} };
    st.gold += s.gold;
    if (win) {
      var bonus = 30 + st.ch * 10; st.gold += bonus; res.bonus = bonus;
      s.units.forEach(function (u) { var b = 6 + Math.floor((s.kills[u.id] || 0) / 4); addBond(u.id, b); res.bonds[u.id] = b; st.girls[u.id].kills += s.kills[u.id] || 0; });
      if (deployed().some(function (id) { return id === "dryad"; })) res.dryad = 1;
      log("🏆 勝利！（王座 " + s.hp + "／" + D.THRONE_HP + "、金幣 +" + (s.gold + bonus) + "）");
      st.cleared = Math.max(st.cleared, st.ch);
    } else log("💀 王座被攻破了……（金幣 +" + s.gold + "，可以重新挑戰）");
    ui.res = res; ui.screen = "result"; sim = null; save(); render();
  }
  function afterResult() {
    var r = ui.res; ui.res = null;
    if (!r.win) { ui.screen = "hub"; render(); return; }
    if (st.ch >= D.CHAPTERS) { startVN(null, "終章", ST.VICTORY, function () { ui.screen = "queen"; render(); }); render(); return; }
    ui.screen = "night"; render();
  }
  function nightWith(id) {
    var x = st.girls[id], story, key, own = ownList(id);
    if (x.nights < own.length) { story = own[x.nights]; key = x.nights ? "own" + x.nights + "_" + id : "own_" + id; }
    else { var k; do { k = Math.floor(Math.random() * SHARED_ALL.length); } while (SHARED_ALL.length > 1 && k === st.lastShared); st.lastShared = k; story = SHARED_ALL[k]; key = "sh" + k + "_" + id; }
    x.nights++; addBond(id, 6); addAlbum(key);
    log("🌙 和 " + G[id].name + " 共度夜晚：" + story.title);
    ui.story = { who: id, title: story.title, pages: story.pages, i: 0, after: nextChapter };
    ui.screen = "story"; render();
  }
  function nextChapter() { st.ch++; chapterStart(); render(); }
  function ending(qid) {
    st.ended = true; ui.end = { queen: qid };
    var best = load(BEST_KEY) || {}; best.clear = (best.clear || 0) + 1; if (qid) best["q_" + qid] = 1; store(BEST_KEY, best);
    store(SAVE_KEY, null); ui.screen = "ending"; render();
  }

  // ---------------- 繪圖 ----------------
  function drawMap(ctx) {
    ctx.fillStyle = "#1c1420"; ctx.fillRect(0, 0, W, HH);
    for (var r = 0; r < D.ROWS; r++) for (var c = 0; c < D.COLS; c++) {
      var x = c * T, y = r * T;
      if (c === D.THRONE[0] && r === D.THRONE[1]) { ctx.fillStyle = "#4a3410"; ctx.fillRect(x, y, T, T); ctx.font = "30px serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("👑", x + T / 2, y + T / 2); }
      else if (PATHSET[c + "," + r]) { ctx.fillStyle = "#6b2433"; ctx.fillRect(x, y, T, T); ctx.fillStyle = "#7d2c3d"; ctx.fillRect(x + 6, y + 6, T - 12, T - 12); }
      else { ctx.fillStyle = (r + c) % 2 ? "#2a1f2e" : "#2f2333"; ctx.fillRect(x, y, T, T); ctx.fillStyle = "rgba(200,170,255,0.08)"; ctx.beginPath(); ctx.arc(x + T / 2, y + T / 2, 14, 0, 7); ctx.fill(); }
    }
    ctx.font = "22px serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("🚪", 0.5 * T, 1.5 * T - T);
  }
  function drawUnit(ctx, id, x, y, selected) {
    var g = G[id], im = IMGS[id], rad = 19;
    if (selected) { ctx.strokeStyle = "rgba(255,255,255,0.35)"; ctx.fillStyle = "rgba(255,255,255,0.06)"; ctx.beginPath(); ctx.arc(x, y, D.TYPES[g.type].range * T, 0, 7); ctx.fill(); ctx.stroke(); }
    ctx.save(); ctx.beginPath(); ctx.arc(x, y, rad, 0, 7); ctx.closePath(); ctx.clip();
    if (im && im.complete && im.naturalWidth) ctx.drawImage(im, x - rad, y - rad, rad * 2, rad * 2); else { ctx.fillStyle = g.color; ctx.fill(); }
    ctx.restore();
    ctx.lineWidth = 3; ctx.strokeStyle = g.color; ctx.beginPath(); ctx.arc(x, y, rad, 0, 7); ctx.stroke(); ctx.lineWidth = 1;
    ctx.fillStyle = "#ffd76b"; ctx.font = "bold 10px sans-serif"; ctx.textAlign = "center"; ctx.fillText("Lv" + st.girls[id].lv, x, y > HH - T ? y - rad - 6 : y + rad + 7);
  }
  function draw() {
    var cv = app.querySelector(".mu-canvas"); if (!cv) return;
    var ctx = cv.getContext("2d");
    drawMap(ctx);
    if (sim) {
      sim.units.forEach(function (u) { drawUnit(ctx, u.id, u.x, u.y, ui.sel === u.id); });
      sim.en.forEach(function (e) {
        var p = posAt(e.d), E = D.ENEMIES[e.type], rr = E.boss ? 17 : 12;
        ctx.fillStyle = E.color; ctx.beginPath(); ctx.arc(p[0], p[1], rr, 0, 7); ctx.fill();
        if (e.curseT > 0) { ctx.strokeStyle = "#a070ff"; ctx.lineWidth = 2; ctx.stroke(); ctx.lineWidth = 1; }
        if (e.slowT > 0) { ctx.strokeStyle = "#ff8be0"; ctx.stroke(); }
        ctx.font = (E.boss ? 20 : 14) + "px serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillStyle = "#000"; ctx.fillText(E.ic, p[0], p[1] + 1);
        ctx.fillStyle = "#300"; ctx.fillRect(p[0] - 14, p[1] - rr - 7, 28, 4); ctx.fillStyle = "#e33"; ctx.fillRect(p[0] - 14, p[1] - rr - 7, 28 * Math.max(0, e.hp / e.max), 4);
      });
      sim.fx.forEach(function (f) {
        ctx.globalAlpha = Math.min(1, f.t * 5);
        if (f.k === "shot") { ctx.strokeStyle = f.c; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(f.x1, f.y1); ctx.lineTo(f.x2, f.y2); ctx.stroke(); ctx.lineWidth = 1; }
        else { ctx.strokeStyle = f.c; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, 7); ctx.stroke(); ctx.lineWidth = 1; }
        ctx.globalAlpha = 1;
      });
    } else {
      Object.keys(st.place).forEach(function (id) { var p = st.place[id].split(","); drawUnit(ctx, id, (+p[0] + 0.5) * T, (+p[1] + 0.5) * T, ui.sel === id); });
      if (ui.pick) { ctx.fillStyle = "rgba(120,255,160,0.12)"; for (var r = 0; r < D.ROWS; r++) for (var c = 0; c < D.COLS; c++) if (buildable(c, r) && !unitAt(c, r)) ctx.fillRect(c * T + 2, r * T + 2, T - 4, T - 4); }
    }
  }
  function canvasTile(ev) {
    var cv = app.querySelector(".mu-canvas"), rc = cv.getBoundingClientRect();
    return [Math.floor((ev.clientX - rc.left) / rc.width * D.COLS), Math.floor((ev.clientY - rc.top) / rc.height * D.ROWS)];
  }
  function onCanvas(ev) {
    var t = canvasTile(ev), c = t[0], r = t[1], here = unitAt(c, r);
    if (ui.screen === "battle") { ui.sel = sim && sim.units.filter(function (u) { return u.c === c && u.r === r; }).map(function (u) { return u.id; })[0] || null; renderBattleUI(); return; }
    if (ui.pick) { if (placeAt(ui.pick, c, r)) { ui.sel = ui.pick; ui.pick = null; } render(); return; }
    ui.sel = here; render();
  }

  // ---------------- 畫面 ----------------
  function portrait(id, cls) { return '<img class="mu-pt ' + (cls || "") + '" src="' + IMG + esc(G[id].img) + '" alt="" style="--mu-c:' + G[id].color + '">'; }
  function render() {
    if (!ageOk()) { app.innerHTML = renderAge(); return; }
    var h;
    if (ui.screen === "title") h = renderTitle();
    else if (ui.screen === "vn") h = renderVN();
    else if (ui.screen === "story") h = renderStory();
    else if (ui.screen === "battle") h = renderBattle();
    else if (ui.screen === "result") h = renderResult();
    else if (ui.screen === "night") h = renderNight();
    else if (ui.screen === "queen") h = renderQueen();
    else if (ui.screen === "ending") h = renderEnding();
    else if (ui.screen === "album") h = renderAlbum();
    else h = renderHub();
    if (ui.toast) { h += '<div class="mu-toast">' + esc(ui.toast) + "</div>"; ui.toast = ""; }
    app.innerHTML = '<div class="mu-root">' + h + "</div>";
    var cv = app.querySelector(".mu-canvas");
    if (cv) { cv.addEventListener("click", onCanvas); draw(); if (ui.screen === "battle") renderBattleUI(); }
  }
  function renderAge() {
    return '<div class="mu-age"><p class="mu-age-mark">18+</p><h2>本遊戲含成人向內容</h2><p>遊戲中有成年角色之間的親密、性暗示描寫。登場的魔族部下全員是活了數百年、外表為成年女性的角色。</p><p>你是否已年滿 18 歲，並同意觀看這類內容？</p>' +
      '<div class="mu-row"><button class="mu-btn mu-primary" data-act="age-yes">我已滿 18 歲，進入遊戲</button><button class="mu-btn" data-act="age-no">離開</button></div></div>';
  }
  function renderTitle() {
    var saved = load(SAVE_KEY), best = load(BEST_KEY) || {};
    var h = '<div class="mu-title"><p class="mu-sub">TOWER DEFENSE × 魔物娘</p><h1>魔王城的防衛戰</h1><p class="mu-tag">你是剛繼任的人類魔王。<br>十二場戰役，守住王座——還有她們。</p>';
    h += '<div class="mu-faces">' + D.GIRLS.map(function (g) { return portrait(g.id, "mu-face"); }).join("") + '</div><div class="mu-row">';
    if (saved) h += '<button class="mu-btn mu-primary" data-act="continue">繼續（第 ' + saved.ch + " 章）</button>";
    h += '<button class="mu-btn' + (saved ? "" : " mu-primary") + '" data-act="new">' + (saved ? "重新開始" : "繼任魔王") + '</button><button class="mu-btn" data-act="album">夜晚回憶</button></div>';
    var qs = Object.keys(best).filter(function (k) { return k.indexOf("q_") === 0; }).length;
    if (best.clear) h += '<p class="mu-muted mu-small">🏆 擊退勇者 ' + best.clear + " 次　👑 魔后 " + qs + "／10</p>";
    return h + "</div>";
  }
  function renderHub() {
    var wave = D.WAVES[st.ch], cap = D.deployCap(st.ch);
    var h = '<div class="mu-top"><div><b class="mu-ch">第 ' + st.ch + " 章</b>／" + D.CHAPTERS + "　「" + esc(wave.name) + '」</div><div class="mu-small">💰 ' + st.gold + "　🗣 談話 " + st.ap + "／2　🏰 配置 " + deployed().length + "／" + cap + '</div><div><button class="mu-btn mu-sm" data-act="title">標題</button></div></div>';
    h += '<p class="mu-small mu-muted">敵軍：' + wave.g.map(function (g) { var E = D.ENEMIES[g[0]]; return E.ic + E.name + "×" + g[1]; }).join("　") + "</p>";
    h += '<div class="mu-cvwrap"><canvas class="mu-canvas" width="' + W + '" height="' + HH + '"></canvas></div>';
    h += '<p class="mu-hint">' + (ui.pick ? "點綠色的台座，配置 " + G[ui.pick].name + "。" : "點下面的部下 → 點台座配置。點地圖上的部下可以看能力、升級或撤回。") + "</p>";
    if (ui.sel && st.place[ui.sel]) h += renderUnitInfo(ui.sel, true);
    h += '<div class="mu-roster">' + joined().map(function (g) {
      var x = st.girls[g.id], on = !!st.place[g.id], mark = lineDue(g.id) || pactDue(g.id) ? ' <span class="mu-new">！</span>' : "";
      return '<div class="mu-card' + (on ? " mu-on" : "") + (ui.pick === g.id ? " mu-picking" : "") + '">' + portrait(g.id, "mu-mini") + '<div class="mu-cbody"><b>' + esc(g.name) + mark + (x.pact ? " 💍" : "") + '</b><span class="mu-small mu-muted">' + esc(g.title) + "・" + D.TYPES[g.type].name + "・Lv" + x.lv + '</span><span class="mu-small">羈絆 <span class="mu-bar"><i style="width:' + x.bond + '%"></i></span> ' + x.bond + "</span></div>" +
        '<div class="mu-cbtns"><button class="mu-btn mu-sm" data-act="pick" data-id="' + g.id + '">' + (on ? "移動" : "配置") + '</button><button class="mu-btn mu-sm" data-act="talk" data-id="' + g.id + '"' + (st.ap > 0 ? "" : " disabled") + ">談話</button></div></div>";
    }).join("") + "</div>";
    h += '<div class="mu-row"><button class="mu-btn mu-primary mu-big" data-act="battle"' + (deployed().length ? "" : " disabled") + ">⚔ 開戰</button></div>";
    h += '<details class="mu-log"><summary>戰報</summary><ul>' + st.log.map(function (l) { return "<li>" + esc(l) + "</li>"; }).join("") + "</ul></details>";
    return h;
  }
  function renderUnitInfo(id, prep) {
    var g = G[id], x = st.girls[id], tp = D.TYPES[g.type], dmg = Math.round(tp.dmg * Math.pow(D.LV_MULT, x.lv - 1) * 10) / 10;
    var h = '<div class="mu-info">' + portrait(id, "mu-mini") + "<div><b>" + esc(g.name) + "</b>（" + esc(g.title) + "）Lv" + x.lv + '<br><span class="mu-small">' + tp.name + "：傷害 " + dmg + "、射程 " + tp.range + "、攻速 " + tp.rate + "／秒。" + esc(tp.desc) + '</span><br><span class="mu-small mu-muted">奧義「' + esc(g.skill) + "」：" + esc(g.skillDesc) + (x.line >= 2 ? "" : "（羈絆第 2 段故事後解鎖）") + "</span></div>";
    if (prep) h += '<div class="mu-cbtns"><button class="mu-btn mu-sm" data-act="upgrade" data-id="' + id + '"' + (x.lv >= 5 || st.gold < D.UPGRADE[x.lv] ? " disabled" : "") + ">" + (x.lv >= 5 ? "MAX" : "升級 💰" + D.UPGRADE[x.lv]) + '</button><button class="mu-btn mu-sm" data-act="recall" data-id="' + id + '">撤回</button></div>';
    return h + "</div>";
  }
  function renderBattle() {
    return '<div class="mu-top"><div><b class="mu-ch">第 ' + st.ch + " 章</b>「" + esc(D.WAVES[st.ch].name) + '」</div><div class="mu-bhud mu-small"></div><div><button class="mu-btn mu-sm" data-act="speed">⏩ ×' + ui.speed + '</button> <button class="mu-btn mu-sm" data-act="pause">' + (ui.paused ? "▶" : "⏸") + "</button></div></div>" +
      '<div class="mu-cvwrap"><canvas class="mu-canvas" width="' + W + '" height="' + HH + '"></canvas></div><div class="mu-skills"></div><div class="mu-binfo"></div>';
  }
  function renderBattleUI() {
    if (!sim || ui.screen !== "battle") return;
    var hud = app.querySelector(".mu-bhud"), sk = app.querySelector(".mu-skills"), bi = app.querySelector(".mu-binfo");
    if (!hud) return;
    hud.innerHTML = "👑 王座 <b>" + Math.max(0, sim.hp) + "</b>／" + D.THRONE_HP + "　👹 剩餘 " + (sim.q.length + sim.en.length) + "／" + sim.total + "　💰 +" + sim.gold;
    var html = sim.units.filter(function (u) { return st.girls[u.id].line >= 2; }).map(function (u) {
      var cd = sim.cd[u.id];
      return '<button class="mu-btn mu-sm mu-skill" data-act="skill" data-id="' + u.id + '"' + (cd > 0 ? " disabled" : "") + ' style="border-color:' + G[u.id].color + '">' + esc(G[u.id].skill) + (cd > 0 ? "（" + Math.ceil(cd) + "）" : "") + "</button>";
    }).join("");
    sk.innerHTML = html || '<span class="mu-small mu-muted">羈絆第 2 段故事看完後，就能在戰鬥中使用奧義。</span>';
    bi.innerHTML = ui.sel ? renderUnitInfo(ui.sel, false) : "";
  }
  function renderResult() {
    var r = ui.res;
    var h = '<div class="mu-panel mu-center"><h2>' + (r.win ? "🏆 防衛成功！" : "💀 王座失守……") + "</h2>";
    h += "<p>王座 " + Math.max(0, r.hp) + "／" + D.THRONE_HP + "　💰 +" + (r.gold + (r.bonus || 0)) + "</p>";
    if (r.win) h += '<div class="mu-roster">' + Object.keys(r.bonds).map(function (id) { return '<div class="mu-card">' + portrait(id, "mu-mini") + '<div class="mu-cbody"><b>' + esc(G[id].name) + '</b><span class="mu-small">擊倒 ' + (r.kills[id] || 0) + "　羈絆 +" + r.bonds[id] + "</span></div></div>"; }).join("") + "</div>";
    else h += '<p class="mu-muted">配置或升級之後，再挑戰一次吧。</p>';
    return h + '<div class="mu-row"><button class="mu-btn mu-primary" data-act="resultok">' + (r.win ? "繼續" : "回到城內") + "</button></div></div>";
  }
  function renderNight() {
    var can = joined().filter(function (g) { return st.girls[g.id].line >= 2; });
    var h = '<div class="mu-panel"><h2>🌙 戰後的夜晚</h2><p class="mu-small mu-muted">羈絆的第 2 段故事看完之後，她會願意在夜裡陪你。</p>';
    if (can.length) h += '<div class="mu-roster">' + can.map(function (g) { var x = st.girls[g.id]; return '<button class="mu-card mu-love" data-act="nightwith" data-id="' + g.id + '">' + portrait(g.id, "mu-mini") + '<div class="mu-cbody"><b>' + esc(g.name) + (x.pact ? " 💍" : "") + '</b><span class="mu-small">' + (x.nights ? "共度了 " + x.nights + " 晚" : "第一次的夜晚") + "</span></div></button>"; }).join("") + "</div>";
    else h += '<p class="mu-muted">今晚，城堡很安靜。</p>';
    return h + '<div class="mu-row"><button class="mu-btn" data-act="rest">一個人休息</button></div></div>';
  }
  function renderQueen() {
    var ps = joined().filter(function (g) { return st.girls[g.id].pact; });
    var h = '<div class="mu-panel mu-center"><h2>👑 魔后</h2><p>和平來了。魔王城需要一位魔后。</p>';
    if (ps.length) h += '<div class="mu-roster">' + ps.map(function (g) { return '<button class="mu-card mu-love" data-act="queen" data-id="' + g.id + '">' + portrait(g.id, "mu-mid") + '<div class="mu-cbody"><b>' + esc(g.name) + '</b><span class="mu-small">' + esc(g.title) + "</span></div></button>"; }).join("") + "</div>";
    else h += '<p class="mu-muted">沒有締結契約的部下……魔王，一個人坐在王座上。</p>';
    return h + '<div class="mu-row"><button class="mu-btn" data-act="queen" data-id="">不立魔后</button></div></div>';
  }
  function renderEnding() {
    var q = ui.end.queen, h = '<div class="mu-panel mu-ending"><h2>🏆 魔王城，守住了</h2>';
    if (q) h += '<div class="mu-queen">' + portrait(q, "mu-big") + '<p class="mu-love">👑 魔后：' + esc(G[q].name) + "</p></div>";
    h += "<h3>那之後的她們</h3>";
    joined().forEach(function (g) { var x = st.girls[g.id]; h += '<div class="mu-mem">' + portrait(g.id, "mu-mini") + "<div><b>" + esc(g.name) + "</b>" + (q === g.id ? " 👑" : x.pact ? " 💍" : "") + '<p class="mu-small">' + esc(q === g.id ? ST.S[g.id].epi : ST.S[g.id].epiN) + "</p></div></div>"; });
    var pc = joined().filter(function (g) { return st.girls[g.id].pact; }).length;
    if (pc >= 3) h += '<p class="mu-warn">……另外，締結了 ' + pc + " 份契約的魔王，在立后典禮那天被所有人圍住了。據說魔王城的寢室，從那天起改成了超大尺寸。</p>";
    return h + '<div class="mu-row"><button class="mu-btn mu-primary" data-act="title">回到標題</button></div></div>';
  }
  function renderAlbum() {
    var a = album(), h = '<div class="mu-panel"><h2>夜晚回憶</h2><div class="mu-roster">';
    D.GIRLS.forEach(function (g) {
      var b = [];
      ownList(g.id).forEach(function (s, i) { if (a[i ? "own" + i + "_" + g.id : "own_" + g.id]) b.push('<button class="mu-btn mu-sm" data-act="replay" data-k="own' + i + '" data-id="' + g.id + '">' + esc(s.title) + "</button>"); });
      SHARED_ALL.forEach(function (s, i) { if (a["sh" + i + "_" + g.id]) b.push('<button class="mu-btn mu-sm" data-act="replay" data-k="' + i + '" data-id="' + g.id + '">' + esc(s.title) + "</button>"); });
      h += '<div class="mu-mem">' + portrait(g.id, "mu-mini") + "<div><b>" + esc(g.name) + "</b><br>" + (b.length ? b.join(" ") : '<span class="mu-muted mu-small">？？？</span>') + "</div></div>";
    });
    return h + '</div><div class="mu-row"><button class="mu-btn" data-act="title">返回</button></div></div>';
  }
  function renderVN() {
    var v = ui.vn, s = v.steps[v.i], h = '<div class="mu-vn">';
    if (v.title) h += '<p class="mu-vn-title">' + esc(v.title) + "</p>";
    var who = null, text = "";
    if (typeof s === "string") text = s; else if (Array.isArray(s)) { who = s[0]; text = s[1]; }
    var sp = who === "@" ? v.who : who;
    h += '<div class="mu-stage">' + (v.who ? portrait(v.who, "mu-vnpt") : "") + '</div><div class="mu-box">';
    if (sp) h += '<p class="mu-name" style="color:' + (G[sp] ? G[sp].color : "#ffd59a") + '">' + esc(G[sp] ? G[sp].name : sp) + "</p>";
    if (s && s.ch) h += '<div class="mu-choices">' + s.ch.map(function (c, k) { return '<button class="mu-btn mu-choice" data-act="ch" data-k="' + k + '">' + esc(c.t) + "</button>"; }).join("") + "</div>";
    else h += '<p class="mu-text">' + esc(text).replace(/\{n\}/g, v.who ? G[v.who].name : "") + '</p><button class="mu-btn mu-primary mu-next" data-act="next">▼</button>';
    return h + "</div></div>";
  }
  function renderStory() {
    var s = ui.story, g = G[s.who];
    return '<div class="mu-story"><p class="mu-vn-title">🌙 ' + esc(s.title) + "　<small>" + (s.i + 1) + "/" + s.pages.length + '</small></p><div class="mu-stage mu-stage-night">' + portrait(s.who, "mu-vnpt") + '</div><div class="mu-box mu-box-night"><p class="mu-text">' + esc(String(s.pages[s.i]).replace(/\{n\}/g, g.name)) + '</p><div class="mu-row">' +
      (s.i > 0 ? '<button class="mu-btn mu-sm" data-act="sprev">上一段</button>' : "") + '<button class="mu-btn mu-primary" data-act="snext">' + (s.i + 1 < s.pages.length ? "下一段" : "早晨") + "</button></div></div></div>";
  }

  // ---------------- 輸入 ----------------
  app.addEventListener("click", function (ev) {
    var b = ev.target.closest("[data-act]"); if (!b || b.disabled) return;
    var act = b.getAttribute("data-act"), id = b.getAttribute("data-id");
    if (act === "age-yes") { try { localStorage.setItem(AGE_KEY, "1"); } catch (e) { ui.ageOk = true; } render(); return; }
    if (act === "age-no") { window.location.href = "../index.html"; return; }
    if (act === "new") { newGame(); render(); return; }
    if (act === "continue") { st = load(SAVE_KEY); ui.screen = st ? "hub" : "title"; render(); return; }
    if (act === "title") { cancelAnimationFrame(raf); sim = null; if (st && !st.ended) save(); ui.screen = "title"; render(); return; }
    if (act === "album") { ui.screen = "album"; render(); return; }
    if (act === "replay") { var rk = b.getAttribute("data-k"), story = rk.indexOf("own") === 0 ? ownList(id)[+rk.slice(3)] : SHARED_ALL[+rk]; ui.story = { who: id, title: story.title, pages: story.pages, i: 0, after: function () { ui.screen = "album"; render(); } }; ui.screen = "story"; render(); return; }
    if (act === "pick") { ui.pick = ui.pick === id ? null : id; ui.sel = null; render(); return; }
    if (act === "recall") { delete st.place[id]; ui.sel = null; save(); render(); return; }
    if (act === "upgrade") { upgrade(id); render(); return; }
    if (act === "talk") { talk(id); render(); return; }
    if (act === "battle") { startBattle(); return; }
    if (act === "speed") { ui.speed = ui.speed >= 3 ? 1 : ui.speed + 1; b.textContent = "⏩ ×" + ui.speed; return; }
    if (act === "pause") { ui.paused = !ui.paused; b.textContent = ui.paused ? "▶" : "⏸"; return; }
    if (act === "skill") { useSkill(id); return; }
    if (act === "resultok") { if (ui.res && ui.res.win && ui.res.dryad) { /* 樹精：每章結束後的回復已反映在下一章的王座 */ } afterResult(); return; }
    if (act === "nightwith") { nightWith(id); return; }
    if (act === "rest") { log("🛌 一個人休息"); nextChapter(); return; }
    if (act === "queen") { ending(id || null); return; }
    if (act === "next") { vnNext(); return; }
    if (act === "ch") { vnChoose(+b.getAttribute("data-k")); return; }
    if (act === "snext") { var s = ui.story; if (s.i + 1 < s.pages.length) { s.i++; render(); } else { ui.story = null; s.after(); } return; }
    if (act === "sprev") { ui.story.i = Math.max(0, ui.story.i - 1); render(); return; }
  });
  document.addEventListener("keydown", function (ev) {
    if (ev.key !== " " && ev.key !== "Enter") return;
    var btn = app.querySelector(".mu-next") || app.querySelector('[data-act="snext"]');
    if (btn) { ev.preventDefault(); btn.click(); }
  });

  // 測試用：直接配置、快轉模擬
  window.PriTestMaou = {
    _state: function () { return st; }, _ui: function () { return ui; }, _sim: function () { return sim; },
    _place: function (id, c, r) { var ok = placeAt(id, c, r); render(); return ok; }, buildable: buildable,
    _render: function () { render(); },
    _simulate: function (sec) { for (var t = 0; t < sec && sim && !sim.done; t += 0.05) step(0.05); if (sim && sim.done) finishBattle(); }
  };
  render();
})();
