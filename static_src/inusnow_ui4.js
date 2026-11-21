/* イヌスノー（狗雪）第 4 階段的畫面（docs/inusnow_design.md §19）：
   即時同場（首頁「連線」分頁 → 大廳 → 出賽表與觀戰者下注 → 同時出發 → 房間成績）、M6 雪橇犬接力（單人＋房間）、R5 精彩重播。
   在 inusnow.js 之前載入，登記到 window.PriTestInusnowExt。規則在 inusnow_room／relay／highlight.js，網路在 inusnow_net.js。 */
(function () {
  "use strict";

  (window.PriTestInusnowExt = window.PriTestInusnowExt || []).push(function (UI) {
    var D = window.PriTestInusnowData, T = window.PriTestInusnowTerrain, Phys = window.PriTestInusnowPhys, Core = window.PriTestInusnowCore;
    var SLP = window.PriTestInusnowSlope, CX = window.PriTestInusnowCross, Env = window.PriTestInusnowEnv;
    var Relay = window.PriTestInusnowRelay, Room = window.PriTestInusnowRoom, HL = window.PriTestInusnowHighlight, Net = window.PriTestInusnowNet;
    if (!Relay || !Room || !HL) return;
    var t = UI.t, L = UI.L, esc = UI.esc, fmtTime = UI.fmtTime, fmtScore = UI.fmtScore, app = UI.app;
    var HZ = D.PHYS.hz, RM = D.ROOM;
    function save() { return UI.save(); }
    function on(act, fn, root) { var b = (root || app).querySelector('[data-act="' + act + '"]'); if (b) b.addEventListener("click", fn); }
    function cpuName(c) { return L(c.name); }
    var LEG_ICON = ["gs", "cross", "slope", "gs"];
    var ICONS = {
      relay: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M4 36h40" stroke="currentColor" stroke-width="3" stroke-linecap="round" opacity=".35"/><circle cx="12" cy="30" r="5" fill="#e2453c"/><circle cx="24" cy="24" r="5" fill="#f0a020"/><circle cx="36" cy="18" r="5" fill="#2a6fd6"/><path d="M15 27l6-2M27 21l6-2" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>',
      room: '<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="16" cy="18" r="6" fill="#2a6fd6"/><circle cx="32" cy="18" r="6" fill="#e2453c"/><path d="M6 38c1-7 5-11 10-11s9 4 10 11M22 38c1-7 5-11 10-11s9 4 10 11" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>',
    };
    // 比賽物件（大曲道／Slopestyle／Cross 的一棒）對應的 3D 設定
    function vfor(r0) {
      if (r0.kind === "gs") return { mode: "gs", piste: r0.run.opts.piste, gates: r0.run.gates, finish: r0.run.finish };
      if (r0.kind === "slope") return { mode: "slope", piste: r0.run.opts.piste, feats: r0.run.feats, finish: r0.run.finish, terrain: r0.run.terrain };
      return { mode: "cross", piste: r0.race.opts.piste, feats: r0.race.feats, finish: r0.race.finish, terrain: r0.race.terrain, cuts: r0.race.cuts };
    }
    function legRun(r0) { return r0.kind === "cross" ? null : r0.run; }
    function slopeBtns() {
      return '<button type="button" class="inu-actbtn inu-grabbtn" id="btn-inu-grab">' + esc(t("inu_grab")) + '<small id="inu-grab-kind">' + esc(t("inu_grab_1")) + '</small></button><button type="button" class="inu-actbtn inu-barkbtn" id="btn-inu-bark">' + esc(t("inu_bark")) + "</button>";
    }
    function progressOf(r0) {
      if (r0.kind === "cross") { var rd = r0.race.riders[0]; return { s: rd.s || 0, len: r0.race.finish.s }; }
      var run = r0.run, s = run.near ? run.near.s : 0, from = run.opts.from || 0;
      return { s: s - from, len: (run.finish.s || run.piste.len) - from };
    }

    // ======================= R5 精彩重播（設計 §19.4） =======================
    function hlSource(r) {
      if (r.kind === "slope") {
        var sp = SLP.replay(r.terrain, r.run.opts, r.run.inputs, 1);
        return { frames: sp.frames, terrain: sp.run.terrain, events: sp.run.events, tricks: sp.run.tricks, kind: "slope", vopts: vfor({ kind: "slope", run: sp.run }) };
      }
      if (r.kind === "cross") {
        var cp = CX.replay(r.terrain, r.cross.opts, r.cross.inputs);
        return { frames: [Core.frameOf(Phys.create(r.terrain, T.at(T.piste(r.terrain, r.cross.opts.piste), 0), r.dog))].concat(cp.frames.map(function (f) { return f[0]; })), others: cp.frames, terrain: cp.race.terrain, events: cp.race.events, kind: "cross", me: 0,
          vopts: vfor({ kind: "cross", race: cp.race }) };
      }
      var gp = Core.replay(r.terrain, r.run.opts, r.run.inputs, 1);
      return { frames: [Core.frameOf(Core.newRun(r.terrain, r.run.opts).st)].concat(gp.frames), terrain: r.terrain, events: gp.run.events, kind: "gs", vopts: vfor({ kind: "gs", run: gp.run }) };
    }
    function clipLabel(c) {
      if (c.kind === "fast") return t("inu_hl_fast", { v: c.val });
      if (c.kind === "jump") return t("inu_hl_jump", { v: c.val });
      if (c.kind === "trick") return t("inu_hl_trick", { v: c.val.toFixed(1) });
      return t("inu_hl_pass");
    }
    // 依序播放片段（轉播鏡頭）；done() 回到成績
    function playClips(terrain, src, clips, breed, title, done) {
      UI.stopLoop();
      UI.S.screen = "race";
      var vo = {}, k;
      for (k in src.vopts) if (Object.prototype.hasOwnProperty.call(src.vopts, k)) vo[k] = src.vopts[k];
      vo.breed = breed; vo.camera = "tv"; vo.others = [];
      if (src.others && src.others[0]) for (var i = 1; i < src.others[0].length; i++) vo.others.push({ breed: breed, ghost: false, name: "" });
      app.innerHTML = '<div class="inu-race inu-hlplay"><div class="inu-stage" id="inu-stage"></div><div class="inu-hud"><div class="inu-hud-top"><span class="inu-hud-ev">' + (UI.ICON[src.kind] || "") + '<span class="inu-hud-run">' + esc(title) + '</span></span><span class="inu-hud-time" id="inu-rtime"></span></div>'
        + '<div class="inu-hud-right"><button type="button" class="inu-chip" id="btn-inu-camera">' + esc(t("inu_cam")) + '</button><button type="button" class="inu-chip" id="btn-inu-skip">✕</button></div>'
        + '<div class="inu-hl-title" id="inu-hl-title"></div><div class="inu-hl-dots">' + clips.map(function (c, i) { return '<i data-i="' + i + '"></i>'; }).join("") + '</div><div class="inu-replay-badge">HIGHLIGHT</div></div><div class="inu-hl-bars" aria-hidden="true"></div></div>';
      var view = UI.R3.create(document.getElementById("inu-stage"), terrain, vo);
      UI.S.view = view;
      var ci = -1, i0 = 0, acc = 0, last = performance.now(), finished = false, slow = 1;
      var finish = function () { if (finished) return; finished = true; UI.stopLoop(); done(); };
      document.getElementById("btn-inu-camera").addEventListener("click", function () { var cams = ["tv", "chase", "air"]; vo.camera = cams[(cams.indexOf(vo.camera) + 1) % cams.length]; view.setCamera(vo.camera); });
      document.getElementById("btn-inu-skip").addEventListener("click", finish);
      function nextClip() {
        ci += 1;
        if (ci >= clips.length) { setTimeout(finish, 400); return false; }
        i0 = clips[ci].a; acc = 0;
        slow = clips[ci].kind === "jump" || clips[ci].kind === "trick" ? 0.5 : 1;
        var tl = document.getElementById("inu-hl-title");
        if (tl) { tl.textContent = clipLabel(clips[ci]); tl.className = "inu-hl-title"; void tl.offsetWidth; tl.className = "inu-hl-title is-show"; }
        Array.prototype.forEach.call(document.querySelectorAll(".inu-hl-dots i"), function (d) { d.classList.toggle("is-on", +d.getAttribute("data-i") === ci); });
        view.setCamera(vo.camera); view.teleported();
        return true;
      }
      nextClip();
      function fr(now) {
        if (UI.S.screen !== "race" || UI.S.view !== view || finished) return;
        UI.S.loop = requestAnimationFrame(fr);
        acc += Math.min(100, now - last) * slow; last = now;
        var stepMs = 1000 / HZ;
        while (acc >= stepMs) { acc -= stepMs; i0 += 1; }
        var c = clips[ci];
        if (!c) return;
        if (i0 >= c.b) { if (!nextClip()) return; c = clips[ci]; }
        var f = src.frames[Math.min(i0, src.frames.length - 1)], p = src.frames[Math.max(0, Math.min(i0, src.frames.length - 1) - 1)];
        var oth = src.others ? src.others[Math.min(i0, src.others.length - 1)].slice(1) : null;
        view.render(f, [(f[0] - p[0]) * HZ, (f[1] - p[1]) * HZ, (f[2] - p[2]) * HZ], oth, 1 / 60, {});
        var tt = document.getElementById("inu-rtime"); if (tt) tt.textContent = fmtTime(i0 / HZ);
      }
      UI.S.loop = requestAnimationFrame(fr);
    }
    function highlight(r) {
      var src = hlSource(r);
      var clips = HL.find(src);
      if (!clips.length) { UI.toastText(t("inu_hl_none"), "is-warn"); return; }
      playClips(r.terrain, src, clips, r.dog, t("inu_highlight"), function () { UI.showResult(r); });
    }
    // 分享片段（大曲道練習）：§13 的分享碼＋|h:a-b（第一個片段）
    function shareClip(r) {
      var src = hlSource(r), clips = HL.find(src);
      if (!clips.length) return null;
      var c = clips[0];
      for (var i = 0; i < clips.length; i++) if (clips[i].kind === "fast") c = clips[i];
      var code = Core.shareCode({ resort: r.resort, piste: r.run.opts.piste, seed: r.run.opts.seed, runNo: r.runNo, breed: save().dog.breed, rec: Core.encode(r.run.inputs) });
      return HL.withClip(code, c.a, c.b);
    }
    // 收到含片段的分享碼：載入雪場後播放那一段
    function playShared(p, clip) {
      var info = UI.resortInfo(p.resort);
      if (!info) return;
      UI.loadTerrain(p.resort).then(function (terrain) {
        var gp = Core.replay(terrain, { piste: p.piste, seed: p.seed, dog: Core.breed(p.breed), snow: "groomed", runNo: p.runNo }, p.rec, 1);
        var src = { frames: [Core.frameOf(Core.newRun(terrain, { piste: p.piste, seed: p.seed, dog: Core.breed(p.breed), snow: "groomed", runNo: p.runNo }).st)].concat(gp.frames), kind: "gs", vopts: vfor({ kind: "gs", run: gp.run }) };
        var b = Math.min(clip.b, src.frames.length - 1);
        if (b < 2) throw new Error("short clip");
        playClips(terrain, src, [{ kind: "fast", a: Math.max(0, Math.min(clip.a, b - 1)), b: b, val: 0 }], Core.breed(p.breed), t("inu_hl_shared"), function () { UI.S.tab = "resorts"; UI.show("setup"); });
      }).catch(function () { UI.S.msg = t("inu_import_bad"); UI.show("setup"); });
    }
    UI.hook("highlight", highlight);
    UI.hook("shareClip", shareClip);
    UI.hook("playShared", playShared);

    // ======================= M6 雪橇犬接力（單人，設計 §19.3） =======================
    function legName(k) { return t("inu_leg_" + k); }
    function startLeg(r, terrain, vopts, leg) {
      r.leg = leg;
      r.run = legRun(leg);
      var vo = vfor(leg);
      for (var k in vo) if (Object.prototype.hasOwnProperty.call(vo, k)) vopts[k] = vo[k];
      r.autoCtl = Relay.cpuCtl(leg, { id: "me", breed: r.dog.id, lv: 4, style: "std" }, 7);
    }
    UI.kind("relay", {
      icon: ICONS.relay, setup: true,
      setupInfo: function () {
        var b = save().best[UI.S.resort + "/relay"], cur = save().settings.relayLeg | 0;
        var h = '<p class="inu-course-line">' + esc(t("inu_relay_info")) + '</p><ol class="inu-legs">' + [0, 1, 2, 3].map(function (k) {
          return '<li class="' + (k === cur ? "is-me" : "") + '"><span>' + UI.ICON[LEG_ICON[k]] + "</span><b>" + esc(legName(k)) + "</b></li>";
        }).join("") + "</ol>";
        h += UI.opt("relayLeg", t("inu_relay_myleg"), [[0, "1"], [1, "2"], [2, "3"], [3, "4"]], cur);
        if (b) h += '<p class="inu-course-best">' + esc(t("inu_best", { time: fmtTime(b.time) })) + "</p>";
        return h;
      },
      begin: function (r, terrain, vopts) {
        var seed = r.opts.seed !== undefined ? r.opts.seed : Core.hash(UI.whenKey() + "|relay|" + r.resort);
        var my = r.opts.leg !== undefined ? r.opts.leg : save().settings.relayLeg | 0;
        var cond = r.std ? null : r.cond;
        r.seed = seed; r.myLeg = my; r.relCond = cond;
        r.mates = Core.cpuField((seed ^ Core.hash("relaymates")) >>> 0, 3);
        r.legRes = [];
        var mi = 0;
        for (var k = 0; k < my; k++) { var cpu = r.mates[mi++]; var s = Relay.simLeg(terrain, k, seed, cpu, cond); r.legRes[k] = { time: s.time, who: cpuName(cpu), breed: Core.breed(cpu.breed), info: s.info }; }
        r.pre = 0;
        r.legRes.forEach(function (x) { r.pre += x.time; });
        startLeg(r, terrain, vopts, Relay.newLeg(terrain, my, seed, r.dog, cond));
        vopts.mode = vopts.mode;
      },
      st: function (r) { return Relay.legSt(r.leg); },
      done: function (r) { return Relay.legDone(r.leg); },
      events: function (r) { return r.leg.kind === "cross" ? r.leg.race.events : r.leg.run.events; },
      steps: function (r) { return Relay.legSteps(r.leg); },
      step: function (r, auto) {
        var inp = auto ? Relay.ctlInput(r.leg, r.autoCtl) : UI.Input.sample();
        r.lastInput = inp;
        Relay.stepLeg(r.leg, inp);
      },
      html: function (r) { return (r.leg.kind === "slope" ? slopeBtns() : "") + '<div class="inu-relaybar">' + [0, 1, 2, 3].map(function (k) { return '<i class="' + (k < r.myLeg ? "is-done" : k === r.myLeg ? "is-now" : "") + '">' + (k + 1) + "</i>"; }).join("") + "</div>"; },
      help: function (r) { return t("inu_relay_help", { n: r.myLeg + 1, leg: legName(r.myLeg) }); },
      hud: function (r) {
        var cur = Relay.legSteps(r.leg) / HZ, pg = progressOf(r.leg);
        return { time: fmtTime(r.pre + cur), sub: t("inu_relay_now", { n: r.myLeg + 1, leg: legName(r.myLeg) }), prog: Math.max(0, Math.min(1, pg.s / pg.len)) };
      },
      end: function (r) { UI.banner(t("inu_relay_pass"), "is-go"); if (UI.S.view) UI.S.view.fx("finish"); },
      result: function (r) {
        var terrain = r.terrain, mi = r.myLeg;
        r.legRes[mi] = { time: Relay.legTime(r.leg), who: save().dog.name || t("inu_you"), breed: r.dog, me: true, info: Relay.legInfo(r.leg) };
        var cpuIdx = mi;
        for (var k = mi + 1; k < 4; k++) { var cpu = r.mates[cpuIdx++]; var s = Relay.simLeg(terrain, k, r.seed, cpu, r.relCond); r.legRes[k] = { time: s.time, who: cpuName(cpu), breed: Core.breed(cpu.breed), info: s.info }; }
        var total = 0;
        r.legRes.forEach(function (x) { total += x.time; });
        var teams = Relay.cpuTeams(r.seed).map(function (m, i) { var st = Relay.simTeam(terrain, r.seed, m, r.relCond); return { name: t("inu_relay_team", { n: i + 1 }), total: st.total, lead: m[0] }; });
        teams.push({ name: t("inu_relay_myteam"), total: total, me: true, lead: { breed: r.dog.id } });
        teams.sort(function (a, b) { return a.total - b.total; });
        var place = 0;
        teams.forEach(function (x, i) { if (x.me) place = i + 1; });
        var key = r.resort + "/relay", b = save().best[key], nb = r.std && (!b || total < b.time);
        if (nb) save().best[key] = { time: total, leg: mi, at: Date.now() };
        UI.persist();
        UI.S.screen = "result";
        var info = UI.resortInfo(r.resort);
        var body = '<p class="inu-place-big">' + UI.medal(place) + esc(t("inu_place", { n: place })) + '</p><p class="inu-bigtime" id="inu-bigtime">' + esc(fmtTime(0)) + "</p>"
          + (nb ? '<p class="inu-newbest">' + esc(t("inu_new_best")) + "</p>" : "")
          + '<ol class="inu-legtable">' + r.legRes.map(function (x, k) {
            return '<li class="' + (x.me ? "is-me" : "") + '" style="--d:' + (0.2 + k * 0.15) + 's"><span class="inu-leg-no">' + (k + 1) + "</span>" + UI.ICON[LEG_ICON[k]] + '<span class="inu-leg-name">' + esc(legName(k)) + "<small>" + UI.dogFace(x.breed, "is-mini") + esc(x.who) + "</small></span><b>" + esc(fmtTime(x.time)) + "</b>"
              + (k === 2 && x.info ? '<em>' + esc(t("inu_relay_slope", { v: fmtScore(x.info.score) })) + "</em>" : !x.info || x.info.ok ? "" : '<em class="is-dsq">' + esc(t("inu_relay_penalty", { s: D.RELAY.dsqPenalty })) + "</em>") + "</li>";
          }).join("") + "</ol>"
          + '<h3 class="inu-h3">' + esc(t("inu_ranking")) + "</h3>" + UI.standingsTable({ col: t("inu_time"), list: teams.map(function (x, i) { return { place: i + 1, name: x.name, breed: Core.breed(x.lead.breed), me: x.me, val: fmtTime(x.total) }; }) })
          + '<div class="inu-actions"><button type="button" class="inu-primary" data-act="retry">' + esc(t("inu_retry")) + '</button><button type="button" class="inu-secondary" data-act="setup">' + esc(t("inu_to_setup")) + '</button><button type="button" class="inu-secondary" data-act="resorts">' + esc(t("inu_to_resorts")) + "</button></div>";
        app.innerHTML = '<div class="inu-page inu-result inu-anim-in">' + (place === 1 ? UI.confettiHtml() : "") + '<h2 class="inu-h2">' + ICONS.relay + esc(t("inu_event_relay")) + "　<small>" + esc(L(info.name)) + "</small></h2>" + body + "</div>";
        UI.countUp(document.getElementById("inu-bigtime"), total, fmtTime, 1000);
        on("retry", function () { UI.startRace(r.resort, { event: "relay" }); });
        on("setup", function () { UI.show("setup"); });
        on("resorts", function () { UI.show("resorts"); });
      },
      debug: function (r) { return { status: Relay.legDone(r.leg) ? "finish" : "run", steps: Relay.legSteps(r.leg), leg: r.myLeg, legKind: r.leg.kind }; },
    });

    // ======================= 即時同場（設計 §19.1、§19.2） =======================
    var RS = null;      // { room, racedNo, resNo, leg, legRes, terrain }
    var renderPending = false;
    function roomLink(id) { return location.href.split("#")[0].split("?")[0] + "?room=" + id; }
    function enterRoom(roomId) {
      if (!Net) return;
      if (RS && RS.room) RS.room.leave();
      var info0 = D.RESORTS[0];
      RS = { racedNo: 0, resNo: 0 };
      RS.room = Net.open({ roomId: roomId || null, name: save().dog.name || "", breed: save().dog.breed,
        cfg: roomId ? null : { resort: info0, event: "pgs", cond: "std", runs: 1 }, onChange: onRoomChange });
      if (!RS.room) { RS = null; return; }
      try { history.replaceState(null, "", roomLink(RS.room.id)); } catch (e) { /* file:// 等 */ }
      UI.stopLoop();
      UI.S.screen = "room";
      renderRoom();
    }
    function leaveRoom() {
      if (RS && RS.room) RS.room.leave();
      RS = null;
      try { history.replaceState(null, "", location.href.split("?")[0]); } catch (e) { /* 同上 */ }
      UI.S.tab = "room"; UI.show("resorts");
    }
    function onRoomChange() {
      if (!RS) return;
      var room = RS.room, st = room.status(), m = room.match;
      // 自己那一場的紀錄與下注留一份（房主換場後還能結算）
      if (m && RS.no && m.no === RS.no) RS.snap = { rec: m.rec, bets: m.bets };
      // 場次變了：自己的「準備」作廢（房間只認同一場次的準備）
      if (room.meta && room.me.ready && room.me.no !== room.meta.no) room.update({ ready: false });
      if (st === "race" && m && m.startAt && m.no === room.meta.no && RS.racedNo !== m.no) {
        RS.racedNo = m.no;
        startRoomMatch();
        return;
      }
      if (UI.S.screen === "roomres" && st !== "race" && (st === "lobby" || (m && m.no !== RS.resNo))) { UI.S.screen = "room"; }
      if (UI.S.screen === "room" || UI.S.screen === "roomres") {
        // 正在輸入名字或選單打開時先不重畫，避免輸入中的文字消失
        var ae = document.activeElement;
        if (ae && app.contains(ae) && /^(INPUT|SELECT)$/.test(ae.tagName)) return;
        if (renderPending) return;
        renderPending = true;
        requestAnimationFrame(function () { renderPending = false; if (UI.S.screen === "room") renderRoom(); else if (UI.S.screen === "roomres") renderRoomRes(); });
      }
    }
    function renderRoomTab(el) {
      var html = '<section class="inu-roomintro"><div class="inu-roomintro-art" aria-hidden="true">' + ICONS.room + '</div><h2 class="inu-h2">' + esc(t("inu_room_title")) + "</h2><p>" + esc(t("inu_room_intro")) + "</p>"
        + '<div class="inu-actions"><button type="button" class="inu-primary inu-go" data-act="create">' + esc(t("inu_room_create")) + "</button></div>"
        + '<div class="inu-joinrow"><input type="text" id="inu-roomcode" placeholder="' + esc(t("inu_room_code_ph")) + '"><button type="button" class="inu-secondary" data-act="join">' + esc(t("inu_room_join")) + "</button></div>"
        + (!Net || !(window.PriTestGameStorage || window.PriTestInusnowFakeGS) ? '<p class="inu-msg">' + esc(t("inu_room_offline")) + "</p>" : "") + "</section>";
      el.innerHTML = html;
      on("create", function () { enterRoom(null); }, el);
      on("join", function () {
        var v = (document.getElementById("inu-roomcode").value || "").trim(), id = Net.roomFromUrl(v) || (Net.validRoomId(v) ? v : null);
        if (!id) { UI.toastText(t("inu_room_bad"), "is-warn"); return; }
        enterRoom(id);
      }, el);
    }
    function evLabel(e) { return t(e === "pgs" ? "inu_room_pgs" : e === "relay" ? "inu_event_relay" : "inu_event_slope"); }
    function renderRoom() {
      if (!RS || UI.S.screen !== "room") return;
      var room = RS.room;
      if (!room.loaded) { app.innerHTML = '<div class="inu-loading"><p class="inu-loading-title">' + esc(t("inu_room_connecting")) + "</p></div>"; return; }
      if (room.missing) { app.innerHTML = '<div class="inu-page"><p class="inu-msg">' + esc(t("inu_room_missing")) + '</p><button type="button" class="inu-secondary" data-act="leave">' + esc(t("inu_back")) + "</button></div>"; on("leave", leaveRoom); return; }
      var host = room.isHost(), cfg = room.cfg || {}, list = room.list(), st = room.status(), me = room.me, m = room.match;
      var y = app.querySelector(".inu-page") ? app.querySelector(".inu-page").scrollTop : 0;
      var html = '<div class="inu-page inu-roompage' + (RS.drawn === st ? " is-static" : "") + '"><div class="inu-roomhead"><button type="button" class="inu-link" data-act="leave">← ' + esc(t("inu_room_leave")) + "</button>"
        + '<span class="inu-roomid">' + esc(t("inu_room_no", { id: room.id.slice(1, 7).toUpperCase() })) + '</span><button type="button" class="inu-chip inu-chip-light" data-act="copy">🔗 ' + esc(t("inu_room_copy")) + "</button>"
        + '<span class="inu-coins"><i aria-hidden="true"></i>' + room.coins() + "</span></div>";
      if (st === "card" && m) html += cardHtml(room, m);
      else {
        // 大廳：自己
        html += '<section class="inu-roombox"><h3 class="inu-h3">' + esc(t("inu_room_me")) + '</h3><div class="inu-roomme">'
          + '<label class="inu-field inu-field-mini"><span>' + esc(t("inu_dog_name")) + '</span><input type="text" id="inu-rname" maxlength="12" value="' + esc(me.name) + '"></label>'
          + '<label class="inu-field inu-field-mini"><span>' + esc(t("inu_pick_dog")) + '</span><select id="inu-rbreed">' + D.BREEDS.map(function (b) { return '<option value="' + b.id + '"' + (b.id === me.breed ? " selected" : "") + ">" + esc(L(b.name)) + "</option>"; }).join("") + "</select></label>"
          + UI.opt("rrole", t("inu_room_role"), [["ride", t("inu_room_ride")], ["watch", t("inu_room_watch")]], me.role)
          + '<button type="button" class="' + (me.ready ? "inu-secondary" : "inu-primary") + '" data-act="ready">' + esc(me.ready ? t("inu_room_unready") : t("inu_room_ready")) + "</button></div></section>";
        // 成員
        html += '<section class="inu-roombox"><h3 class="inu-h3">' + esc(t("inu_room_members", { n: list.length })) + '</h3><ul class="inu-members">' + list.map(function (p, i) {
          var isH = room.meta && room.meta.host === p.cid;
          return '<li class="' + (p.cid === room.cid ? "is-me" : "") + '" style="--d:' + (i * 0.05) + 's">' + UI.dogFace(Core.breed(p.breed), "is-mini") + '<span class="inu-member-name">' + (isH ? "👑 " : "") + esc(p.name || t("inu_you")) + "<small>" + esc(L(Core.breed(p.breed).name)) + "</small></span>"
            + '<span class="inu-member-role is-' + p.role + '">' + esc(t(p.role === "ride" ? "inu_room_ride" : "inu_room_watch")) + "</span>" + '<span class="inu-member-ready' + (p.ready ? " is-on" : "") + '">' + (p.ready ? "✔" : "…") + "</span></li>";
        }).join("") + "</ul></section>";
        // 房主設定
        html += '<section class="inu-roombox"><h3 class="inu-h3">' + esc(t("inu_room_cfg")) + (host ? "" : " <small>" + esc(t("inu_room_host_only")) + "</small>") + "</h3>";
        if (host) {
          html += '<label class="inu-field inu-field-mini"><span>' + esc(t("inu_pick_resort")) + '</span><select id="inu-rresort">' + D.RESORTS.map(function (id) { var ri = UI.resortInfo(id); return '<option value="' + id + '"' + (id === cfg.resort ? " selected" : "") + ">" + esc(ri ? L(ri.name) : id) + "</option>"; }).join("") + "</select></label>"
            + UI.opt("revent", t("inu_pick_event"), [["pgs", t("inu_room_pgs")], ["slope", t("inu_event_slope")], ["relay", t("inu_event_relay")]], cfg.event || "pgs")
            + UI.opt("rcond", t("inu_cond"), [["std", t("inu_cond_std")], ["random", t("inu_cond_random")]], cfg.cond || "std")
            + (cfg.event === "pgs" ? UI.opt("rruns", t("inu_runs"), [[1, t("inu_runs_1")], [2, t("inu_runs_2")]], cfg.runs || 1) : "");
          var riders = room.riders(), okN = riders.length > 0 && riders.length <= Room.maxRiders(cfg.event || "pgs"), allReady = riders.every(function (p) { return p.ready; });
          html += '<p class="inu-help inu-help-tight">' + esc(t("inu_room_max", { n: Room.maxRiders(cfg.event || "pgs") })) + "</p>"
            + '<div class="inu-actions"><button type="button" class="inu-primary inu-go" data-act="publish"' + (okN && allReady ? "" : " disabled") + ">" + esc(t("inu_room_publish")) + "</button></div>";
        } else {
          var ri2 = UI.resortInfo(cfg.resort);
          html += '<p class="inu-course-line">' + esc((ri2 ? L(ri2.name) : cfg.resort || "—") + "・" + evLabel(cfg.event) + "・" + t(cfg.cond === "random" ? "inu_cond_random" : "inu_cond_std")) + "</p>";
        }
        html += "</section>";
      }
      html += "</div>";
      app.innerHTML = html;
      RS.drawn = st;
      var pg = app.querySelector(".inu-page"); if (pg) pg.scrollTop = y;
      on("leave", leaveRoom);
      on("copy", function () {
        var link = roomLink(room.id), b = app.querySelector('[data-act="copy"]');
        var ok2 = function () { if (b) b.textContent = "✔ " + t("inu_share_done"); };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(link).then(ok2, function () { window.prompt(t("inu_room_copy"), link); });
        else window.prompt(t("inu_room_copy"), link);
      });
      var nm = document.getElementById("inu-rname");
      if (nm) nm.addEventListener("change", function () { var v = nm.value.slice(0, 12); save().dog.name = v; UI.persist(); room.update({ name: v }); });
      var br = document.getElementById("inu-rbreed");
      if (br) br.addEventListener("change", function () { room.update({ breed: br.value, ready: false }); });
      on("ready", function () { room.setReady(!me.ready); renderRoom(); });
      Array.prototype.forEach.call(app.querySelectorAll("[data-opt]"), function (b) {
        b.addEventListener("click", function () {
          var k = b.getAttribute("data-opt"), v = b.getAttribute("data-val");
          if (k === "rrole") { room.update({ role: v, ready: false }); renderRoom(); return; }
          var c = JSON.parse(JSON.stringify(room.cfg || {}));
          if (k === "revent") c.event = v; else if (k === "rcond") c.cond = v; else if (k === "rruns") c.runs = +v;
          room.setCfg(c); renderRoom();
        });
      });
      var rr = document.getElementById("inu-rresort");
      if (rr) rr.addEventListener("change", function () { var c = JSON.parse(JSON.stringify(room.cfg || {})); c.resort = rr.value; room.setCfg(c); });
      on("publish", function () { publishCard(0, null); });
      on("start", function () { room.start(); });
      bindBets(room);
    }
    // 房主：出賽表（第 2 趟時 prev＝第 1 趟的時間；選手順序沿用上一張）
    function publishCard(runNo, prev) {
      var room = RS.room, cfg = room.cfg || {}, riders;
      if (runNo && room.match) {
        var on2 = {};
        room.list().forEach(function (p) { on2[p.cid] = p; });
        riders = room.match.card.riders.filter(function (x) { return on2[x.cid]; }).map(function (x) { return { cid: x.cid, pid: x.pid, name: x.name, breed: x.breed }; });
      } else riders = room.riders();
      var seed = runNo && room.match ? room.match.card.seed : Core.hash("room|" + room.id + "|" + Date.now());
      var cond = cfg.cond === "random" ? Env.conditions(seed, cfg.resort, +UI.jstDate().slice(5, 7), { change: false }) : null;
      room.publish(Room.makeCard({ resort: cfg.resort, event: cfg.event || "pgs", cond: cond, runs: cfg.runs || 1 }, riders, seed, runNo, prev));
    }
    function cardHtml(room, m) {
      var card = m.card, info = UI.resortInfo(card.resort), host = room.isHost(), watcher = !card.riders.some(function (x) { return x.cid === room.cid; });
      var mine = (m.bets || {})[room.pid] || {};
      var h = '<section class="inu-roombox inu-roomcard"><h3 class="inu-h3">' + esc(t("inu_room_card")) + "　<small>" + esc((info ? L(info.name) : card.resort) + "・" + evLabel(card.event) + (card.event === "pgs" && card.runs === 2 ? "・" + t("inu_run_n", { n: card.runNo + 1 }) : "")) + "</small></h3>"
        + (card.cond ? '<p class="inu-cardcond">' + esc(UI.condLabel(card.cond)) + "</p>" : "")
        + '<ul class="inu-lanes">' + card.riders.map(function (x) {
          var od = Room.poolOdds(m.bets || {}, x.cid);
          return '<li class="' + (x.cid === room.cid ? "is-me" : "") + '"><span class="inu-lane-no">' + (card.event === "relay" ? t("inu_leg_short", { n: x.lane + 1 }) : card.event === "pgs" ? t("inu_lane", { n: x.lane + 1 }) : "") + "</span>" + UI.dogFace(Core.breed(x.breed), "is-mini") + "<b>" + esc(x.name || "—") + "</b>"
            + (card.prev ? '<small class="inu-muted">' + esc(card.prev[x.cid] === null || card.prev[x.cid] === undefined ? t("inu_dnf") : fmtTime(card.prev[x.cid])) + "</small>" : "")
            + (card.event !== "relay" ? '<span class="inu-pool-odds">' + (od ? "×" + od.toFixed(1) : "—") + "</span>" : "")
            + (watcher && card.event !== "relay" ? '<span class="inu-betctl"><button type="button" class="inu-chip inu-chip-light" data-bet="' + x.cid + '">+100</button><em>' + (mine[x.cid] || 0) + "</em></span>" : "") + "</li>";
        }).join("") + "</ul>"
        + (card.event === "relay" && card.riders.length < 4 ? '<p class="inu-help inu-help-tight">' + esc(t("inu_room_relay_cpu")) + "</p>" : "")
        + (watcher && card.event !== "relay" ? '<p class="inu-help inu-help-tight">' + esc(t("inu_room_bet_help", { p: Math.round(RM.poolBack * 100) })) + "</p>" : "")
        + (host ? '<div class="inu-actions"><button type="button" class="inu-primary inu-go" data-act="start">' + esc(t("inu_room_start")) + "</button></div>" : '<p class="inu-muted">' + esc(t("inu_room_wait_host")) + "</p>")
        + "</section>";
      return h;
    }
    function bindBets(room) {
      Array.prototype.forEach.call(app.querySelectorAll("[data-bet]"), function (b) {
        b.addEventListener("click", function () {
          var cid = b.getAttribute("data-bet"), m = room.match;
          if (!m || m.startAt || RS.betBusy) return;
          RS.betBusy = true;
          room.addCoins(room.pid, -100).then(function (v) {
            if (!v) { UI.toastText(t("inu_room_nocoins"), "is-warn"); return; }
            // 寫入時用最新的下注再加（連點不會少記）
            var cur = room.match && room.match.no === m.no ? (room.match.bets || {})[room.pid] || {} : {};
            var mine = JSON.parse(JSON.stringify(cur));
            mine[cid] = (mine[cid] || 0) + 100;
            room.pushBet(mine);
            if (room.match) { room.match.bets = room.match.bets || {}; room.match.bets[room.pid] = mine; }
          }).then(function () { RS.betBusy = false; }, function () { RS.betBusy = false; });
        });
      });
    }

    // ---------------- 房間比賽（賽事種類 room） ----------------
    function startRoomMatch() {
      var room = RS.room, card = room.match.card;
      RS.card = card; RS.no = room.match.no;
      if (card.event === "relay") { RS.leg = 0; RS.legRes = []; relayNext(); return; }
      UI.startRace(card.resort, { event: "room", cond: card.cond || (Env ? Env.standard() : null) });
    }
    function legOwner(card, k) { for (var i = 0; i < card.riders.length; i++) if (card.riders[i].lane === k) return card.riders[i]; return null; }
    function relayMates(card) { return Core.cpuField((card.seed ^ Core.hash("relaymates")) >>> 0, 4); }
    // 接力：CPU 的棒直接模擬，輪到有人的棒時開比賽畫面
    function relayNext() {
      var card = RS.card;
      UI.loadTerrain(card.resort).then(function (terrain) {
        RS.terrain = terrain;
        while (RS.leg < 4 && !legOwner(card, RS.leg)) {
          var cpu = relayMates(card)[RS.leg], s = Relay.simLeg(terrain, RS.leg, card.seed, cpu, card.cond);
          RS.legRes[RS.leg] = { time: s.time, name: cpuName(cpu), breed: cpu.breed, cpu: true, info: s.info };
          RS.leg += 1;
        }
        if (RS.leg >= 4) { showRoomResult(); return; }
        UI.startRace(card.resort, { event: "room", leg: RS.leg, cond: card.cond || (Env ? Env.standard() : null) });
      });
    }
    function clockStep(r) {
      if (r.relay) return r.legT0 ? Math.floor((performance.now() - r.legT0) / 1000 * HZ) : 0;
      var m = RS && RS.room.match;
      return m && m.startAt ? Math.floor((RS.room.now() - m.startAt) / 1000 * HZ) : 0;
    }
    function syncRemotes(r) {
      var m = RS && RS.room.match;
      if (!m || m.no !== r.no) return;
      var now = performance.now();
      r.remotes.forEach(function (rm) {
        var segs = m.rec[rm.rider.cid] || [], n0 = rm.queue.length;
        for (var k = rm.next; k < segs.length; k++) if (segs[k] !== undefined) Room.addSeg(rm, k, segs[k]);
        if (rm.queue.length > n0) rm.lastAt = now;
        if (r.relay && !r.legT0 && rm.queue.length) r.legT0 = performance.now() - rm.queue.length / HZ * 1000;
      });
    }
    function pushMySegs(r, final) {
      var ins = Room.inputsOf(r.mine), n = ins.length, room = RS.room;
      while ((r.sent + 1) * RM.seg <= n || (final && r.sent * RM.seg < n)) {
        room.pushSeg(r.no, r.sent, Core.encode(ins.slice(r.sent * RM.seg, (r.sent + 1) * RM.seg)));
        r.sent += 1;
      }
    }
    function lead(r) {
      // 觀戰鏡頭：還在滑的人裡最前面的
      var best = null, bs = -1;
      r.remotes.forEach(function (rm) { var pg = progressOf(rm.r); if (!Room.done(rm.r) && pg.s > bs) { bs = pg.s; best = rm; } });
      return best || r.remotes[0] || null;
    }
    UI.kind("room", {
      icon: ICONS.room, noPause: true,
      begin: function (r, terrain, vopts) {
        var room = RS.room, card = RS.card;
        r.no = RS.no; r.card = card; r.relay = card.event === "relay"; r.sent = 0;
        var meR = null;
        if (r.relay) { var own = legOwner(card, r.opts.leg); r.legNo = r.opts.leg; if (own && own.cid === room.cid) meR = own; r.riders = own && !meR ? [own] : []; }
        else { card.riders.forEach(function (x) { if (x.cid === room.cid) meR = x; }); r.riders = card.riders.filter(function (x) { return x !== meR; }); }
        r.meR = meR;
        r.mine = meR ? Room.newRider(terrain, card, meR) : null;
        r.remotes = r.riders.map(function (x) { return Room.newRemote(terrain, card, x); });
        r.run = r.mine ? legRun(r.mine) : null;
        var base = r.mine || (r.remotes[0] && r.remotes[0].r);
        var vo = vfor(base);
        for (var k in vo) if (Object.prototype.hasOwnProperty.call(vo, k)) vopts[k] = vo[k];
        if (card.event === "pgs") {
          // 4 條賽道的旗門都畫出來（自己的在最前面，gatePassed 的編號才對）
          var all = r.mine ? r.mine.run.gates.slice() : [];
          r.remotes.forEach(function (rm) { all = all.concat(rm.r.run.gates); });
          vopts.gates = all;
        }
        vopts.breed = Core.breed((meR || r.riders[0] || { breed: "shiba" }).breed);
        vopts.others = r.remotes.map(function (rm) { return { breed: Core.breed(rm.rider.breed), ghost: false, name: rm.rider.name || "—", scarf: 0x2a6fd6 }; });
        if (r.mine) r.autoCtl = Relay.cpuCtl(r.mine, { id: "me", breed: meR.breed, lv: 4, style: "std" }, 7);
        var m = room.match;
        if (!r.relay && m && m.startAt) r.countLeft = Math.max(0.3, (m.startAt - room.now()) / 1000);
        if (r.relay && r.mine) r.countLeft = 3;
        if (r.relay && !r.mine) r.countLeft = 0.3;
        // 結算的斷線計時：從出發（含倒數）開始算
        var t0 = performance.now() + r.countLeft * 1000 + (r.relay ? 3000 : 0);
        r.remotes.forEach(function (rm) { rm.lastAt = t0; });
      },
      st: function (r) {
        if (r.mine && !Room.done(r.mine)) return Room.stOf(r.mine);
        var ld = lead(r);
        return ld ? Room.stOf(ld.r) : Room.stOf(r.mine);
      },
      done: function (r) {
        if (r.mine && !Room.done(r.mine)) return false;
        // 遠端選手：重算到終點，或牆上時鐘 dnfSec 秒沒有新紀錄（未完賽）
        var now = performance.now();
        return r.remotes.every(function (rm) { return Room.done(rm.r) || Room.gone(rm, now); });
      },
      events: function (r) { return r.mine ? (r.mine.kind === "cross" ? r.mine.race.events : r.mine.run.events) : []; },
      steps: function (r) { return r.mine && !Room.done(r.mine) ? Room.steps(r.mine) : clockStep(r); },
      step: function (r, auto) {
        if (r.relay && r.mine && !r.legT0) r.legT0 = performance.now();
        if (r.mine && !Room.done(r.mine)) {
          var inp = auto ? Relay.ctlInput(r.mine, r.autoCtl) : UI.Input.sample();
          r.lastInput = inp;
          Room.step(r.mine, inp);
          if (Room.inputsOf(r.mine).length % RM.seg === 0) pushMySegs(r, false);
          if (Room.done(r.mine)) {
            pushMySegs(r, true);
            var res = Room.result(r.card, r.mine);
            RS.room.pushDone(r.no, { ok: !!res.ok, time: res.time === undefined || res.time === null ? null : res.time, score: res.score === undefined ? null : res.score });
            UI.banner(t("inu_finish"), "is-go");
          }
        }
        syncRemotes(r);
        var tgt = clockStep(r);
        r.remotes.forEach(function (rm) { Room.advance(rm, tgt); });
      },
      others: function (r) {
        syncRemotes(r);
        var tgt = clockStep(r);
        return r.remotes.map(function (rm) { return Room.frameAt(rm, tgt); });
      },
      help: function (r) { return r.mine ? t("inu_help_" + (r.mine.kind === "gs" ? "gates" : r.mine.kind)) : t("inu_room_spectating"); },
      html: function (r) { return (r.mine && r.mine.kind === "slope" ? slopeBtns() : "") + (r.mine ? "" : '<div class="inu-watch-tag">' + esc(t("inu_room_spectating")) + "</div>"); },
      hud: function (r, st) {
        var tgt = clockStep(r), rows = [];
        if (r.mine) rows.push({ me: true, name: r.meR.name || t("inu_you"), pg: progressOf(r.mine), done: Room.done(r.mine), stale: false });
        r.remotes.forEach(function (rm) { rows.push({ name: rm.rider.name || "—", pg: progressOf(rm.r), done: Room.done(rm.r), stale: Room.stale(rm, tgt) }); });
        if (r.hud.room !== tgt - tgt % 15) {
          r.hud.room = tgt - tgt % 15;
          var ord = rows.slice().sort(function (a, b) { return b.pg.s - a.pg.s; });
          var el = document.getElementById("inu-standings");
          if (el) el.innerHTML = ord.map(function (x, i) { return '<li class="' + (x.me ? "is-me" : "") + '"><b>' + (i + 1) + "</b>" + esc(x.name) + (x.done ? " 🏁" : x.stale ? " ⚠" : "") + "</li>"; }).join("");
        }
        var pg = r.mine ? progressOf(r.mine) : rows[0] ? rows[0].pg : { s: 0, len: 1 };
        var sub = r.relay ? t("inu_relay_now", { n: r.legNo + 1, leg: legName(r.legNo) }) : r.card.event === "pgs" && r.meR ? t("inu_lane", { n: r.meR.lane + 1 }) : t("inu_room_live");
        return { time: fmtTime(Math.max(0, (r.mine && !Room.done(r.mine) ? Room.steps(r.mine) : tgt) / HZ)), sub: sub, prog: Math.max(0, Math.min(1, pg.s / pg.len)) };
      },
      end: function (r) { UI.banner(t(r.relay ? "inu_relay_pass" : "inu_room_alldone"), "is-go"); },
      result: function (r) {
        if (r.relay) {
          if (!r.mine && r.remotes[0]) Room.advance(r.remotes[0], 1e9);     // 收到的紀錄全部重算（每台裝置一致）
          var rm0 = r.mine || (r.remotes[0] && r.remotes[0].r), own = legOwner(r.card, r.legNo);
          RS.legRes[r.legNo] = { time: Relay.legTime(rm0), name: own ? own.name : "—", breed: own ? own.breed : "shiba", info: Relay.legInfo(rm0), me: !!r.mine };
          RS.leg = r.legNo + 1;
          relayNext();
          return;
        }
        showRoomResult();
      },
      debug: function (r) { return { status: "run", steps: clockStep(r), room: true, mineDone: r.mine ? Room.done(r.mine) : null, remotes: r.remotes.length }; },
    });

    // ---------------- 房間成績 ----------------
    function showRoomResult() {
      UI.stopLoop();
      UI.S.screen = "roomres";
      var room = RS.room, m = room.match, card = RS.card;
      RS.resNo = RS.no;
      if (card.event === "relay") {
        var total = 0;
        RS.legRes.forEach(function (x) { total += x.time; });
        var teams = Relay.cpuTeams(card.seed).map(function (mm, i) { return { name: t("inu_relay_team", { n: i + 1 }), total: Relay.simTeam(RS.terrain, card.seed, mm, card.cond).total, lead: mm[0].breed }; });
        teams.push({ name: t("inu_relay_myteam"), total: total, me: true, lead: card.riders[0] ? card.riders[0].breed : "shiba" });
        teams.sort(function (a, b) { return a.total - b.total; });
        RS.res = { relay: true, total: total, teams: teams, legs: RS.legRes.slice() };
      } else {
        var terrain = RS.terrain || UI.S.terrainCache[card.resort];
        var src = m && m.no === RS.no ? { rec: m.rec, bets: m.bets } : RS.snap || { rec: {}, bets: {} };
        var results = Room.recompute(terrain, card, src.rec || {});
        var rk = Room.rank(card, results);
        var winner = rk.rows[0] && rk.rows[0].place === 1 ? rk.rows[0].cid : null;
        var pays = Room.poolPays(src.bets || {}, winner || "");
        var myPay = pays[room.pid] || 0, key = "pritest-inusnow-paid-" + room.id + "-" + RS.no;
        var paid = false;
        try { paid = localStorage.getItem(key) === "1"; } catch (e) { /* 私密模式 */ }
        if (myPay && !paid) room.addCoins(room.pid, myPay).then(function (v) { if (v) { try { localStorage.setItem(key, "1"); } catch (e) { /* 同上 */ } } });
        var mb = (src.bets || {})[room.pid];
        RS.res = { rows: rk.rows, myPay: myPay, myStake: mb ? Object.keys(mb).reduce(function (a, k) { return a + (+mb[k] || 0); }, 0) : 0 };
      }
      renderRoomRes();
    }
    function renderRoomRes() {
      if (!RS || !RS.res) return;
      var room = RS.room, card = RS.card, res = RS.res, host = room.isHost(), info = UI.resortInfo(card.resort);
      var html = '<div class="inu-page inu-result">' + '<h2 class="inu-h2">' + ICONS.room + esc(t("inu_room_result")) + "　<small>" + esc((info ? L(info.name) : "") + "・" + evLabel(card.event)) + "</small></h2>";
      if (res.relay) {
        html += '<p class="inu-bigtime">' + esc(fmtTime(res.total)) + '</p><ol class="inu-legtable">' + res.legs.map(function (x, k) {
          return '<li class="' + (x.me ? "is-me" : "") + '"><span class="inu-leg-no">' + (k + 1) + "</span>" + UI.ICON[LEG_ICON[k]] + '<span class="inu-leg-name">' + esc(legName(k)) + "<small>" + UI.dogFace(Core.breed(x.breed), "is-mini") + esc(x.name + (x.cpu ? " (CPU)" : "")) + "</small></span><b>" + esc(fmtTime(x.time)) + "</b></li>";
        }).join("") + "</ol>";
        html += UI.standingsTable({ col: t("inu_time"), list: res.teams.map(function (x, i) { return { place: i + 1, name: x.name, breed: Core.breed(x.lead), me: x.me, val: fmtTime(x.total) }; }) });
      } else {
        var names = {};
        card.riders.forEach(function (x) { names[x.cid] = x; });
        html += '<div class="inu-podium">' + [1, 0, 2].map(function (i) { var x = res.rows[i]; if (!x || !x.place) return ""; var rd = names[x.cid]; return '<div class="inu-podium-step inu-podium-' + (i + 1) + (x.cid === room.cid ? " is-me" : "") + '">' + UI.dogFace(Core.breed(rd.breed)) + "<span>" + esc(rd.name || "—") + "</span><b>" + (i + 1) + "</b></div>"; }).join("") + "</div>";
        html += UI.standingsTable({ col: card.event === "slope" ? t("inu_score") : card.prev ? t("inu_total_col") : t("inu_time"), list: res.rows.map(function (x) {
          var rd = names[x.cid];
          return { place: x.place, name: rd.name || "—", breed: Core.breed(rd.breed), me: x.cid === room.cid, val: x.val === null ? t("inu_dnf") : card.event === "slope" ? fmtScore(x.val) : fmtTime(x.val), extra: card.event === "pgs" ? t("inu_lane", { n: rd.lane + 1 }) : "" };
        }) });
        if (res.myStake) html += '<div class="inu-payout' + (res.myPay > res.myStake ? " is-win" : "") + '"><span>' + esc(t("inu_payout")) + "</span><b>" + res.myPay + "</b><small>" + esc(t("inu_coins")) + "</small><em>" + esc(t("inu_net", { v: (res.myPay - res.myStake >= 0 ? "+" : "") + (res.myPay - res.myStake) })) + "</em></div>";
      }
      var two = card.event === "pgs" && card.runs === 2 && card.runNo === 0;
      html += '<div class="inu-actions">' + (host && two ? '<button type="button" class="inu-primary" data-act="run2">' + esc(t("inu_next_run")) + "</button>" : "")
        + (host ? '<button type="button" class="' + (two ? "inu-secondary" : "inu-primary") + '" data-act="lobby">' + esc(t("inu_room_lobby")) + "</button>" : '<p class="inu-muted">' + esc(t("inu_room_wait_host")) + "</p>")
        + '<button type="button" class="inu-secondary" data-act="leave">' + esc(t("inu_room_leave")) + "</button></div></div>";
      app.innerHTML = html;
      on("run2", function () {
        var prev = {};
        res.rows.forEach(function (x) { prev[x.cid] = x.res.ok ? x.res.time : null; });
        publishCard(1, prev);
      });
      on("lobby", function () { room.backToLobby(); UI.S.screen = "room"; renderRoom(); });
      on("leave", leaveRoom);
    }
    UI.screen("room", renderRoom);
    UI.screen("roomres", renderRoomRes);
    UI.tab({ id: "room", icon: "📡", label: "inu_tab_room", render: renderRoomTab });

    // 網址帶 ?room= 時直接進房
    if (Net) {
      var rid = Net.roomFromUrl(location.href);
      if (rid) setTimeout(function () { enterRoom(rid); }, 0);
    }
    window.PriTestInusnowP4 = {
      enterRoom: enterRoom, leaveRoom: leaveRoom, room: function () { return RS && RS.room; }, rs: function () { return RS; },
      highlight: highlight, shareClip: shareClip,
    };
  });
})();
