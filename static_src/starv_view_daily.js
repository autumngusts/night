// 明星經紀 starV：「日程」分頁——公司設施圖（人流動畫＋murmur 對話框）、行程月曆、每人進度一覽。
// 純顯示：只讀 state，不呼叫任何會改狀態的 Core 函式；人物的走動、工作人員、粉絲、對話框都是畫面上的演出。
// 設施圖的 DOM 在整個分頁生命週期內重複使用（主程式每次 render 會清空畫面，這裡把同一個節點接回去），走到一半的人才不會瞬移。
// 設施圖有 3D（starv_office3d.js，預設）與 2D 兩種畫法，共用這裡的移動模擬：每段路記錄起點、終點與起訖時間，
// 2D 用 CSS transition 走，3D 每一幀內插位置；3D 時人物的 HTML 節點只當點擊區與對話框的錨點。
// 畫質設為「關閉」或不支援 WebGL 時固定用 2D。
(function () {
  "use strict";

  var D = window.PriTestStarvData;
  var Core = window.PriTestStarvCore;
  var Murmurs = window.PriTestStarvMurmurs;
  var UI = window.PriTestStarvUI;
  var t = UI.t, el = UI.el;
  var BAL = D.BAL;

  // 行程種類：圖示與顏色（月曆、進度一覽共用；CSS 用 sv-k-<kind>）
  var KIND_ICON = { course: "📚", train: "💪", rest: "💤", promo: "📣", job: "💼", audition: "🎤", project: "🌟" };

  // ==== 設施圖 ====
  // 座標單位：寬 100、高 64（容器 aspect-ratio 100/64，所以 x、y 一單位等長）
  var COLS = [1, 16.4, 31.8, 47.2, 62.6, 78];
  var ROOMS = {
    dorm: { x1: COLS[0], x2: COLS[1], top: true, fac: "dorm" },
    lounge: { x1: COLS[1], x2: COLS[2], top: true, fac: "lounge" },
    practice: { x1: COLS[2], x2: COLS[3], top: true, fac: "practice" },
    studio: { x1: COLS[3], x2: COLS[4], top: true, fac: "studio" },
    photo: { x1: COLS[4], x2: COLS[5], top: true, fac: "photo" },
    classroom: { x1: COLS[0], x2: COLS[1], top: false },
    pr: { x1: COLS[1], x2: COLS[2], top: false, fac: "pr" },
    scout: { x1: COLS[2], x2: COLS[3], top: false, fac: "scout" },
    lobby: { x1: COLS[3], x2: COLS[5], top: false },
    outside: { x1: 81, x2: 99, y1: 2, y2: 62 }
  };
  var ROOM_DECO = { dorm: "🛏️", lounge: "☕", practice: "🪞", studio: "🎙️", photo: "📸", classroom: "📖", pr: "📞", scout: "🔭", lobby: "🛋️", outside: "🚐" };
  var ROOM_ORDER = ["dorm", "lounge", "practice", "studio", "photo", "classroom", "pr", "scout", "lobby", "outside"];
  var TOP_Y = [2, 24], BOT_Y = [38, 62], CORR_Y = 31;
  var ENTR_IN = { x: 76.5, y: 52 }, ENTR_OUT = { x: 83, y: 52 };
  var SPEED = 16;           // 單位／秒
  var COURSE_ROOM = { vocal: "studio", charm: "photo", dance: "practice", act: "classroom", talk: "classroom", sense: "classroom" };
  var KIND_OUT = { job: 1, audition: 1, project: 1, promo: 1 };

  Object.keys(ROOMS).forEach(function (k) {
    var r = ROOMS[k];
    if (r.y1 === undefined) { r.y1 = r.top ? TOP_Y[0] : BOT_Y[0]; r.y2 = r.top ? TOP_Y[1] : BOT_Y[1]; }
    r.cx = (r.x1 + r.x2) / 2;
  });

  function built(st, room) { var f = ROOMS[room].fac; return !f || (st.facilities[f] || 0) > 0; }
  function door(room) { var r = ROOMS[room]; return { x: r.cx, y: r.top ? r.y2 : r.y1 }; }
  function corr(room) { return { x: ROOMS[room].cx, y: CORR_Y }; }
  // 從房間內走到走廊（外出區要先經過大門、大廳）
  function toCorr(room) {
    if (room === "outside") return [ENTR_OUT, ENTR_IN, door("lobby"), corr("lobby")];
    return [door(room), corr(room)];
  }
  function route(from, to) {
    if (from === to) return [];
    if (from === "lobby" && to === "outside") return [ENTR_IN, ENTR_OUT];
    if (from === "outside" && to === "lobby") return [ENTR_OUT, ENTR_IN];
    return toCorr(from).concat(toCorr(to).slice().reverse());
  }
  function spot(room, rnd) {
    var r = ROOMS[room];
    return { x: r.x1 + 2.5 + rnd() * (r.x2 - r.x1 - 5), y: r.y1 + 6.5 + rnd() * (r.y2 - r.y1 - 9) };
  }

  // 藝人現在應該在哪個房間（依行程；沒有對應設施就去教室／宿舍）
  function roomOf(st, a) {
    var tk = a.task, H = Murmurs.hash;
    if (!tk) return built(st, "lounge") && H(a.id + "@" + Math.floor(st.day / 3)) % 5 < 2 ? "lounge" : "lobby";
    if (KIND_OUT[tk.kind]) return "outside";
    if (tk.kind === "rest") return !tk.forced && built(st, "lounge") && H(a.id) % 2 ? "lounge" : "dorm";
    if (tk.kind === "train") return built(st, "practice") ? "practice" : "classroom";
    if (tk.kind === "course") {
      var c = D.COURSE_BY_ID[tk.courseId], r = c ? COURSE_ROOM[c.stat] : "classroom";
      return built(st, r) ? r : "classroom";
    }
    return "lobby";
  }

  var map = null;   // { node, people, rooms, movers: {key: mover}, feed: [], timer, App }

  function makeMap() {
    var node = el("div", { class: "sv-map" });
    var corrNode = el("div", { class: "sv-map-corr", style: "left:" + COLS[0] + "%;width:" + (COLS[5] - COLS[0]) + "%;top:" + pctY(26) + "%;height:" + pctY(10) + "%" });
    node.appendChild(corrNode);
    var rooms = {};
    ROOM_ORDER.forEach(function (k) {
      var r = ROOMS[k];
      var label = el("span", { class: "sv-map-label" });
      var box = el("div", {
        class: "sv-map-room sv-map-room-" + k,
        style: "left:" + r.x1 + "%;width:" + (r.x2 - r.x1) + "%;top:" + pctY(r.y1) + "%;height:" + pctY(r.y2 - r.y1) + "%"
      }, [el("span", { class: "sv-map-deco", "aria-hidden": "true", text: ROOM_DECO[k] }), label]);
      if (k !== "outside") box.appendChild(el("span", { class: "sv-map-door", style: r.top ? "bottom:-2px" : "top:-2px" }));
      node.appendChild(box);
      rooms[k] = { box: box, label: label };
    });
    node.appendChild(el("span", { class: "sv-map-gate", style: "left:" + (ENTR_IN.x + 0.5) + "%;top:" + pctY(ENTR_IN.y - 3) + "%;height:" + pctY(6) + "%" }));
    var people = el("div", { class: "sv-map-people" });
    node.appendChild(people);
    var feed = el("ul", { class: "sv-map-feed", "aria-live": "polite" });
    return { node: node, people: people, rooms: rooms, feedNode: feed, movers: {}, feed: [], timer: null, lastWander: 0, lastBubble: 0, App: null, o3d: null, loading3d: false };
  }
  function pctY(y) { return y / 64 * 100; }

  function newMover(key, kind, pos) {
    var node = el("div", { class: "sv-map-p sv-map-" + kind });
    var m = { key: key, kind: kind, node: node, x: pos.x, y: pos.y, x0: pos.x, y0: pos.y, start: 0, queue: [], until: 0, room: null, leaving: false };
    place(m, pos, 0, Date.now());
    map.people.appendChild(node);
    map.movers[key] = m;
    return m;
  }
  function place(m, p, dur, now) {
    m.x0 = m.x; m.y0 = m.y; m.start = now; m.until = now + dur * 1000;
    m.x = p.x; m.y = p.y;
    if (map.o3d) return;   // 3D：位置由 starv_office3d.js 每一幀算
    m.node.style.transition = dur > 0 ? "left " + dur + "s linear, top " + dur + "s linear" : "none";
    m.node.style.left = p.x + "%";
    m.node.style.top = pctY(p.y) + "%";
    m.node.classList.toggle("sv-map-flip", p.x < m.x0);
  }
  function walkTo(m, room) {
    var from = m.room;
    m.room = room;
    m.queue = m.queue.concat(from ? route(from, room) : []).concat([spot(room, Math.random)]);
  }
  function step(m, now) {
    if (now < m.until || !m.queue.length) {
      m.node.classList.toggle("sv-map-walk", now < m.until);
      return;
    }
    var p = m.queue.shift(), dur = Math.max(0.15, Math.sqrt((p.x - m.x) * (p.x - m.x) + (p.y - m.y) * (p.y - m.y)) / SPEED);
    place(m, p, dur, now);
    m.node.classList.add("sv-map-walk");
  }

  function sync(st, App) {
    map.App = App;
    var seen = {}, first = !Object.keys(map.movers).length;
    var counts = {};
    st.artists.forEach(function (a) {
      var key = "a:" + a.id, room = roomOf(st, a);
      seen[key] = true;
      counts[room] = (counts[room] || 0) + 1;
      var m = map.movers[key];
      if (!m) {
        // 第一次打開分頁：直接站在該在的位置；之後新加入的人從大門走進來
        m = newMover(key, "artist", first ? spot(room, Math.random) : ENTR_OUT);
        m.room = first ? room : "outside";
        m.aid = a.id;
        m.node.appendChild(UI.avatar(a, 22));
        m.node.addEventListener("click", function () { openArtist(map.App, m.aid); });
        if (!first) walkTo(m, room);
      } else if (m.room !== room) walkTo(m, room);
      m.node.title = UI.name(a) + "・" + taskText(st, a);
      m.node.classList.toggle("sv-map-tired", a.stamina < 30 || a.stress > 70);
    });
    // 離開公司的人走出大門後消失
    Object.keys(map.movers).forEach(function (key) {
      var m = map.movers[key];
      if (m.kind !== "artist" || seen[key] || m.leaving) return;
      m.leaving = true;
      walkTo(m, "outside");
      m.queue.push({ x: 101, y: ENTR_OUT.y });
    });
    syncExtras(st);
    ROOM_ORDER.forEach(function (k) {
      var r = map.rooms[k], ok = built(st, k), f = ROOMS[k].fac;
      var name = f ? UI.L(D.FACILITIES[f].name) : t("sv_map_" + k);
      r.text = (ok ? name + (f && f !== "dorm" ? " Lv" + st.facilities[f] : "") : name + "・" + t("sv_map_unbuilt")) +
        (counts[k] ? "　" + t("sv_map_count", { n: counts[k] }) : "");
      r.label.textContent = r.text;
      r.off = !ok;
      r.box.classList.toggle("sv-map-off", !ok);
    });
  }

  // 工作人員（人數隨設施規模）與門口的粉絲（人數隨總人氣）
  function syncExtras(st) {
    var lv = 0;
    D.FACILITY_ORDER.forEach(function (f) { lv += st.facilities[f] || 0; });
    var staff = Math.min(10, 3 + Math.floor(lv / 3) + (st.staff ? st.staff.length : 0));
    var fame = 0;
    st.artists.forEach(function (a) { fame += a.fame; });
    var fans = Math.min(9, Math.floor(Math.log(1 + fame / 50) * 1.6));
    var i, m;
    for (i = 0; i < 10; i++) {
      m = map.movers["s:" + i];
      if (i < staff && !m) { m = newMover("s:" + i, "staff", spot("lobby", Math.random)); m.room = "lobby"; }
      else if (i >= staff && m) { removeMover(m); }
    }
    for (i = 0; i < 9; i++) {
      m = map.movers["f:" + i];
      if (i < fans && !m) { m = newMover("f:" + i, "fan", fanSpot()); m.room = "outside"; }
      else if (i >= fans && m) { removeMover(m); }
    }
  }
  function fanSpot() { return { x: 84 + Math.random() * 13, y: 45 + Math.random() * 14 }; }
  function removeMover(m) { if (m.node.parentNode) m.node.parentNode.removeChild(m.node); delete map.movers[m.key]; }

  function loop() {
    if (!document.body.contains(map.node)) { clearInterval(map.timer); map.timer = null; return; }
    var now = Date.now(), st = map.App && map.App.st();
    if (!st) return;
    var list = Object.keys(map.movers).map(function (k) { return map.movers[k]; });
    list.forEach(function (m) {
      step(m, now);
      if (m.leaving && !m.queue.length && now >= m.until) removeMover(m);
    });
    // 工作人員走完就換個房間；一部分人在房內換位置，看起來有人在走動
    list.forEach(function (m) {
      if (m.kind !== "staff" || m.queue.length || now < m.until) return;
      if (Math.random() < 0.04) {
        var opts = ROOM_ORDER.filter(function (k) { return k !== "outside" && built(st, k); });
        walkTo(m, opts[Math.floor(Math.random() * opts.length)]);
      }
    });
    if (now - map.lastWander > 1800) {
      map.lastWander = now;
      list.forEach(function (m) {
        if (m.leaving || m.queue.length || now < m.until || Math.random() > 0.18) return;
        m.queue.push(m.kind === "fan" ? fanSpot() : spot(m.room, Math.random));
      });
    }
    if (now - map.lastBubble > 2600) { map.lastBubble = now; bubble(st, list); }
  }

  function bubble(st, list) {
    var idle = list.filter(function (m) { return m.kind === "artist" && !m.leaving && !m.node.querySelector(".sv-map-say"); });
    if (!idle.length) return;
    var m = idle[Math.floor(Math.random() * idle.length)], a = Core.artistById(st, m.aid);
    if (!a) return;
    var text = Murmurs.say(st, a, UI.lang(), Math.random());
    if (!text || (map.feed[0] && map.feed[0].text === text)) return;
    var b = el("span", { class: "sv-map-say" + (m.x > 60 ? " sv-map-say-l" : ""), text: text });
    m.node.appendChild(b);
    m.node.classList.add("sv-map-talking");
    setTimeout(function () { if (b.parentNode) b.parentNode.removeChild(b); m.node.classList.remove("sv-map-talking"); }, 3800);
    map.feed.unshift({ name: UI.name(a), text: text });
    map.feed = map.feed.slice(0, 4);
    renderFeed();
  }
  function renderFeed() {
    map.feedNode.innerHTML = "";
    if (!map.feed.length) map.feedNode.appendChild(el("li", { class: "sv-muted", text: t("sv_map_feed_empty") }));
    map.feed.forEach(function (f) {
      map.feedNode.appendChild(el("li", {}, [el("b", { text: f.name }), "：" + f.text]));
    });
  }

  // ---- 3D／2D 切換（偏好只存在這台裝置） ----
  var VIEW_KEY = "pritest-starv-office";
  function can3d() { var S3 = window.PriTestStarvStage3D; return !!(S3 && window.PriTestStarvOffice3D && S3.quality() !== "off" && S3.available()); }
  function wants3d() {
    if (!can3d()) return false;
    try { return (JSON.parse(localStorage.getItem(VIEW_KEY) || "{}").view || "3d") === "3d"; } catch (e) { return true; }
  }
  function setView(v) { try { localStorage.setItem(VIEW_KEY, JSON.stringify({ view: v })); } catch (e) { /* 只是記不住 */ } }
  function env3d() {
    return {
      ROOMS: ROOMS, COLS: COLS, ENTR_IN: ENTR_IN, ENTR_OUT: ENTR_OUT,
      st: function () { return map.App && map.App.st(); },
      built: function (k) { var st = map.App && map.App.st(); return st ? built(st, k) : true; },
      movers: function () { return Object.keys(map.movers).map(function (k) { return map.movers[k]; }); },
      labels: function () {
        return ROOM_ORDER.map(function (k) {
          var r = ROOMS[k], x = map.rooms[k];
          return { room: k, text: x.text || "", off: x.off, x: k === "outside" ? r.cx : r.x1 + 5, y: k === "outside" ? r.y1 + 3 : r.y1 + 3 };
        });
      }
    };
  }
  function ensureView() {
    if (wants3d()) {
      if (map.o3d) { map.o3d.resume(); return; }
      if (map.loading3d) return;
      map.loading3d = true;
      window.PriTestStarvStage3D.load().then(function (T) {
        map.loading3d = false;
        if (!wants3d() || map.o3d) return;
        try { map.o3d = window.PriTestStarvOffice3D.create(T, map.node, env3d()); } catch (e) { map.o3d = null; return; }
        map.node.classList.add("sv-map-3d");
        Object.keys(map.movers).forEach(function (k) { map.movers[k].node.style.transition = "none"; });
      }, function () { map.loading3d = false; });
    } else if (map.o3d) {
      map.o3d.dispose();
      map.o3d = null;
      map.node.classList.remove("sv-map-3d");
      // 回到 2D：所有人直接站到目前的目的地
      Object.keys(map.movers).forEach(function (k) {
        var m = map.movers[k];
        m.node.style.transition = "none"; m.node.style.visibility = "";
        m.node.style.left = m.x + "%"; m.node.style.top = pctY(m.y) + "%";
      });
    }
  }

  function climateChip(st) {
    var O = window.PriTestStarvOffice3D;
    if (!O) return null;
    var c = O.climate(st);
    return el("span", { class: "sv-chip", "data-act": "map-climate", title: t("sv_map_climate_tip"),
      text: O.SEASON_ICON[c.season] + " " + t("sv_season_" + c.season) + "・" + O.WEATHER_ICON[c.weather] + " " + t("sv_wx_" + c.weather) });
  }

  function mapCard(st, App) {
    if (!map) map = makeMap();
    sync(st, App);
    renderFeed();
    if (!map.timer) map.timer = setInterval(loop, 200);
    ensureView();
    var is3d = wants3d();
    var lv = Math.max(1, Math.min(10, st.company.level));
    return el("div", { class: "sv-card" }, [
      el("div", { class: "sv-map-head" }, [
        el("h3", { class: "sv-grow", text: t("sv_map_title") }),
        climateChip(st),
        can3d() ? el("span", { class: "sv-seg" }, ["3d", "2d"].map(function (v) {
          return UI.btn(v.toUpperCase(), function () { setView(v); App.render(); }, (v === "3d") === is3d ? "sv-btn-primary" : "sv-btn-ghost", { "data-act": "map-view-" + v });
        })) : null
      ]),
      el("p", { class: "sv-small sv-muted", text: t("sv_bld_line", { lv: lv, name: t("sv_bld_" + lv) }) + "　" + t(is3d ? "sv_map_hint_3d" : "sv_map_hint") }),
      map.node,
      el("div", { class: "sv-map-legend sv-small sv-muted" }, [
        el("span", {}, [el("i", { class: "sv-map-key sv-map-key-staff" }), t("sv_map_staff")]),
        el("span", {}, [el("i", { class: "sv-map-key sv-map-key-fan" }), t("sv_map_fan")])
      ]),
      el("h4", { class: "sv-map-feed-title", text: "💬 " + t("sv_map_feed") }),
      map.feedNode
    ]);
  }

  // ==== 行程與月曆 ====
  function taskText(st, a) {
    var tk = a.task;
    if (!tk) return t("sv_status_idle");
    var lang = UI.lang(), title = "";
    if (tk.kind === "job") {
      var aj = (st.activeJobs || []).filter(function (x) { return x.id === tk.ref; })[0];
      if (aj) title = Core.jobTitle(aj.job, lang);
    } else if (tk.kind === "audition") {
      var au = (st.auditions || []).filter(function (x) { return x.id === tk.ref; })[0];
      if (au) title = Core.jobTitle(au.job, lang);
    } else if (tk.kind === "project" && st.project) title = Core.jobTitle({ project: st.project.id }, lang);
    else if (tk.kind === "course") title = UI.courseName(tk.courseId);
    var k = t("sv_task_" + tk.kind) + (tk.forced ? "（" + t("sv_forced") + "）" : "");
    return title ? k + "「" + title + "」" : k;
  }
  // 目前行程佔用的日子：今天算第 (days−left+1) 天，最後一天是 day + left − 1
  function span(st, a) {
    var tk = a.task;
    if (!tk) return null;
    var left = Math.max(1, tk.left);
    return { start: st.day - Math.max(0, tk.days - left), end: st.day + left - 1, kind: tk.kind };
  }

  var cal = { offset: 0, who: "" };
  var WEEK = ["sv_wd_1", "sv_wd_2", "sv_wd_3", "sv_wd_4", "sv_wd_5", "sv_wd_6", "sv_wd_0"];

  function people(st) { return cal.who ? st.artists.filter(function (a) { return a.id === cal.who; }) : st.artists; }

  // 某一天的記號：生日、合約到期、頒獎典禮、換季、工作看板更新
  function marks(st, day, list) {
    var out = [], y = Core.dateOf(day).year;
    list.forEach(function (a) {
      if (Murmurs.birthdayOf(a, y) === day) out.push({ icon: "🎂", text: t("sv_cal_birthday", { name: UI.name(a) }) });
      if (a.contractEnd === day) out.push({ icon: "📝", text: t("sv_cal_contract", { name: UI.name(a) }) });
    });
    if (day % BAL.daysPerYear === BAL.daysPerYear - 1) out.push({ icon: "🏆", text: t("sv_cal_awards") });
    if (day % BAL.seasonDays === 0 && day > 0) out.push({ icon: "🌸", text: t("sv_cal_season") });
    if (day === st.boardRefreshDay) out.push({ icon: "📋", text: t("sv_cal_board") });
    return out;
  }
  // 過去的日子：日誌裡當天完成的事（課程、訓練、宣傳、工作）
  var DONE_TYPES = { course_done: "📚", train_done: "💪", promo_done: "📣", job_done: "💼", join: "🎉" };
  function doneOn(st, day, ids) {
    return st.log.filter(function (e) {
      if (e.day !== day || !DONE_TYPES[e.type]) return false;
      var who = e.data.aids || [e.data.aid];
      return who.some(function (id) { return ids[id]; });
    });
  }

  function calendarCard(st, App) {
    var month = Math.floor(st.day / BAL.daysPerMonth) + cal.offset;
    if (month < 0) { cal.offset -= month; month = 0; }
    var first = month * BAL.daysPerMonth, d0 = Core.dateOf(first);
    var list = people(st), ids = {};
    list.forEach(function (a) { ids[a.id] = true; });
    var spans = list.map(function (a) { return { a: a, s: span(st, a) }; }).filter(function (x) { return x.s; });
    var grid = el("div", { class: "sv-cal" }, WEEK.map(function (k) { return el("div", { class: "sv-cal-wd", text: t(k) }); }));
    for (var b = 0; b < first % 7; b++) grid.appendChild(el("div", { class: "sv-cal-blank" }));
    for (var i = 0; i < BAL.daysPerMonth; i++) grid.appendChild(dayCell(st, App, first + i, spans, list, ids));

    var whoOpts = [{ value: "", label: t("sv_cal_all") }].concat(st.artists.map(function (a) { return { value: a.id, label: UI.name(a) }; }));
    return el("div", { class: "sv-card" }, [
      el("div", { class: "sv-cal-head" }, [
        UI.btn("‹", function () { cal.offset--; App.render(); }, "sv-btn-ghost sv-btn-icon", { "data-act": "cal-prev", disabled: month <= 0, "aria-label": t("sv_cal_prev") }),
        el("h3", { class: "sv-grow", text: "🗓️ " + t("sv_cal_month", { y: d0.year, m: d0.month }) }),
        cal.offset ? UI.btn(t("sv_cal_today"), function () { cal.offset = 0; App.render(); }, "sv-btn-ghost", { "data-act": "cal-today" }) : null,
        UI.btn("›", function () { cal.offset++; App.render(); }, "sv-btn-ghost sv-btn-icon", { "data-act": "cal-next", "aria-label": t("sv_cal_next") })
      ]),
      el("div", { class: "sv-row" }, [
        UI.select(whoOpts, cal.who, function (v) { cal.who = v; App.render(); }, { "data-act": "cal-who" }),
        el("span", { class: "sv-small sv-muted", text: t("sv_cal_hint") })
      ]),
      el("div", { class: "sv-cal-legend sv-small" }, Object.keys(KIND_ICON).map(function (k) {
        return el("span", { class: "sv-cal-key sv-k-" + k, text: KIND_ICON[k] + " " + t("sv_task_" + k) });
      })),
      grid
    ]);
  }

  function dayCell(st, App, day, spans, list, ids) {
    var on = spans.filter(function (x) { return day >= x.s.start && day <= x.s.end; })
      .sort(function (x, y) { return x.s.end - y.s.end; });
    var mk = marks(st, day, list);
    var done = day < st.day ? doneOn(st, day, ids) : [];
    var past = day < st.day, today = day === st.day;
    var MAX = cal.who ? 1 : 4;
    var chips = on.slice(0, MAX).map(function (x) {
      // 點頭像直接開這個人的詳情（點格子其他地方才開當天明細）
      var c = el("span", { class: "sv-cal-chip sv-k-" + x.s.kind + (x.s.end === day ? " sv-cal-end" : ""), title: UI.name(x.a) + "・" + taskText(st, x.a),
        role: "button", "data-chip": x.a.id, onclick: function (e) { e.stopPropagation(); openArtist(App, x.a.id); } },
        [UI.avatar(x.a, 18)]);
      if (cal.who) c.appendChild(el("span", { class: "sv-cal-chip-t", text: KIND_ICON[x.s.kind] + (x.s.end === day ? "🏁" : "") }));
      return c;
    });
    if (on.length > MAX) chips.push(el("span", { class: "sv-cal-more", text: "+" + (on.length - MAX) }));
    if (done.length) chips.push(el("span", { class: "sv-cal-done", text: "✔" + (done.length > 1 ? done.length : "") }));
    return el("div", {
      class: "sv-cal-day" + (past ? " sv-cal-past" : "") + (today ? " sv-cal-today" : ""), role: "button", tabindex: "0", "data-day": day,
      onclick: function () { openDay(App, day); }
    }, [
      el("div", { class: "sv-cal-num" }, [String(Core.dateOf(day).day), el("span", { class: "sv-cal-marks", text: mk.map(function (m) { return m.icon; }).join("") })]),
      el("div", { class: "sv-cal-chips" }, chips)
    ]);
  }

  function openDay(App, day) {
    UI.openModal(function (box, close) {
      var st = App.st(), list = people(st), ids = {};
      list.forEach(function (a) { ids[a.id] = true; });
      box.appendChild(UI.modalHead(UI.dateText(day), close));
      var mk = marks(st, day, list);
      if (mk.length) box.appendChild(el("ul", { class: "sv-cal-marklist" }, mk.map(function (m) { return el("li", { text: m.icon + " " + m.text }); })));
      var on = list.map(function (a) { return { a: a, s: span(st, a) }; }).filter(function (x) { return x.s && day >= x.s.start && day <= x.s.end; });
      if (on.length) box.appendChild(el("div", { class: "sv-prog" }, on.map(function (x) { return progRow(st, App, x.a, x.s, day); })));
      // 今天：待命的人可以直接在這裡排下一個行程
      var idle = day === st.day ? list.filter(function (a) { return !a.task; }) : [];
      if (idle.length) {
        box.appendChild(el("h3", { class: "sv-sec-title", text: t("sv_prog_idle", { n: idle.length }) }));
        box.appendChild(el("div", { class: "sv-prog" }, idle.map(function (a) { return idleRow(st, App, a); })));
      }
      var done = day < st.day ? doneOn(st, day, ids) : [];
      if (done.length) {
        box.appendChild(el("h3", { class: "sv-sec-title", text: t("sv_cal_done") }));
        box.appendChild(el("ul", { class: "sv-cal-marklist" }, done.map(function (e) {
          var who = (e.data.aids || [e.data.aid]).map(function (id) { var a = Core.artistById(st, id); return a ? UI.name(a) : ""; }).filter(Boolean).join("、");
          return el("li", { text: DONE_TYPES[e.type] + " " + who + "・" + t("sv_cal_done_" + e.type) });
        })));
      }
      if (!mk.length && !on.length && !done.length && !idle.length) box.appendChild(el("p", { class: "sv-muted", text: t(day < st.day ? "sv_cal_day_empty_past" : "sv_cal_day_empty") }));
    }, { live: true });
  }

  function openArtist(App, aid) { UI.closeModal(); var V = window.PriTestStarvArtistsView; if (V) V.openDetail(App, aid); }
  var MOODS = ["😣", "😟", "🙂", "😊", "😆"];

  // 狀況：體力、壓力、心情、合約快到期
  function statusMini(st, a) {
    var left = a.contractEnd === null ? null : a.contractEnd - st.day;
    return el("div", { class: "sv-prog-status sv-small" }, [
      el("span", { class: "sv-prog-meter", title: t("sv_stamina") }, ["💪", UI.bar(a.stamina, 100, "sv-bar-stamina"), el("b", { text: String(Math.round(a.stamina)) })]),
      el("span", { class: "sv-prog-meter", title: t("sv_stress") }, ["😵", UI.bar(a.stress, 100, "sv-bar-stress"), el("b", { text: String(Math.round(a.stress)) })]),
      el("span", { title: t("sv_mood"), text: MOODS[a.mood + 2] }),
      left !== null && left <= 90 ? el("span", { class: "sv-chip sv-chip-warn", text: t("sv_prog_contract", { n: Math.max(0, left) }) }) : null
    ]);
  }

  // 一列進度：頭像、名字、行程、進度條、預計完成日、狀況
  function progRow(st, App, a, s, day) {
    var tk = a.task, total = Math.max(1, tk.days), nth = Math.min(total, (day === undefined ? st.day : day) - s.start + 1);
    return el("div", { class: "sv-prog-row", role: "button", tabindex: "0", "data-aid": a.id, onclick: function () { openArtist(App, a.id); } }, [
      UI.avatar(a, 34),
      el("div", { class: "sv-grow" }, [
        el("div", {}, [el("b", { text: UI.name(a) }), el("span", { class: "sv-small sv-muted", text: "　" + KIND_ICON[s.kind] + " " + taskText(st, a) })]),
        el("div", { class: "sv-prog-bar sv-k-" + s.kind }, [el("span", { style: "width:" + (nth / total * 100) + "%" })]),
        el("div", { class: "sv-small sv-muted", text: t("sv_prog_day", { n: nth, total: total }) + "・" + t("sv_prog_until", { date: UI.dateText(s.end) }) +
          (a.policy !== "idle" ? "・" + t("sv_prog_then", { policy: t("sv_policy_" + a.policy) }) : "") }),
        statusMini(st, a)
      ])
    ]);
  }

  // 推薦課程：主方向權重最高的能力；進階課可用、付得起、還沒練滿就選進階
  function suggestCourse(st, a) {
    var w = D.DIR_BY_ID[a.dir].weights, best = null;
    Object.keys(w).forEach(function (k) { if (!best || w[k] > w[best]) best = k; });
    var adv = D.COURSE_BY_ID[best + "_2"], basic = D.COURSE_BY_ID[best + "_1"];
    return adv && Core.courseAllowed(st, adv) && st.company.money >= adv.cost && a.stats[best] < a.caps[best] ? adv.id : basic.id;
  }
  var picks = {};   // 每人選的課程（只在畫面上記住）

  // 待命的人：狀況＋快速排程（上課、訓練、休息、宣傳、找工作）
  function idleRow(st, App, a) {
    var pick = picks[a.id] || suggestCourse(st, a);
    function run(spec) {
      var err = App.act(function (s) { return Core.schedule(s, a.id, spec); });
      if (err) UI.toast(t("sv_err_" + err), "bad");
      else UI.toast(t("sv_prog_assigned", { name: UI.name(a), task: t("sv_task_" + spec.kind) }));
    }
    var courseSel = UI.select(D.COURSES.map(function (c) {
      return { value: c.id, label: t("sv_course_opt", { name: UI.courseName(c.id), days: c.days, cost: UI.money(c.cost) }), disabled: !Core.courseAllowed(st, c) };
    }), pick, function (v) { picks[a.id] = v; }, { "data-act": "quick-course-select-" + a.id });
    var tired = a.stamina < 30 || a.stress > 70;
    return el("div", { class: "sv-prog-row sv-prog-idle-row", "data-aid": a.id }, [
      el("span", { role: "button", class: "sv-prog-ava", onclick: function () { openArtist(App, a.id); } }, [UI.avatar(a, 34)]),
      el("div", { class: "sv-grow" }, [
        el("div", {}, [
          el("b", { role: "button", class: "sv-prog-name", text: UI.name(a), onclick: function () { openArtist(App, a.id); } }),
          el("span", { class: "sv-small sv-muted", text: "　" + UI.dirIcon(a.dir) + " " + UI.dirName(a.dir) + (tired ? "・" + t("sv_prog_tired") : "") })
        ]),
        statusMini(st, a),
        el("div", { class: "sv-prog-quick" }, [
          courseSel,
          UI.btn("📚 " + t("sv_do_course"), function () { run({ kind: "course", courseId: courseSel.value }); }, "sv-btn-primary", { "data-act": "quick-course-" + a.id }),
          UI.btn("💪 " + t("sv_do_train"), function () { run({ kind: "train" }); }, "", { "data-act": "quick-train-" + a.id }),
          UI.btn("💤 " + t("sv_prog_rest2"), function () { run({ kind: "rest", days: 2 }); }, tired ? "sv-btn-gold" : "", { "data-act": "quick-rest-" + a.id }),
          UI.btn("📣 " + t("sv_task_promo"), function () { run({ kind: "promo" }); }, "", { "data-act": "quick-promo-" + a.id }),
          UI.btn("💼 " + t("sv_prog_find_job"), function () { UI.closeModal(); App.goTab("jobs"); }, "sv-btn-ghost", { "data-act": "quick-job-" + a.id })
        ])
      ])
    ]);
  }

  function progressCard(st, App) {
    var busy = st.artists.map(function (a) { return { a: a, s: span(st, a) }; }).filter(function (x) { return x.s; })
      .sort(function (x, y) { return x.s.end - y.s.end; });
    var soon = busy.filter(function (x) { return x.s.end <= st.day + 1; });
    var later = busy.filter(function (x) { return x.s.end > st.day + 1; });
    var idle = st.artists.filter(function (a) { return !a.task; });
    var rows = [el("h3", { text: t("sv_prog_title") })];
    if (!st.artists.length) rows.push(el("p", { class: "sv-muted", text: t("sv_art_empty") }));
    function group(key, n, list) {
      rows.push(el("h4", { class: "sv-prog-group", text: t(key, { n: n }) }));
      rows.push(el("div", { class: "sv-prog" }, list));
    }
    // 先列待命（要派任務的人），再列快結束的、其他行程中的
    if (idle.length) group("sv_prog_idle", idle.length, idle.map(function (a) { return idleRow(st, App, a); }));
    if (soon.length) group("sv_prog_soon", soon.length, soon.map(function (x) { return progRow(st, App, x.a, x.s); }));
    if (later.length) group("sv_prog_busy", later.length, later.map(function (x) { return progRow(st, App, x.a, x.s); }));
    return el("div", { class: "sv-card", "data-act": "progress-card" }, rows);
  }

  UI.register({
    id: "daily", order: 15, icon: "📅", labelKey: "sv_tab_daily",
    render: function (c, App) {
      var st = App.st();
      c.appendChild(mapCard(st, App));
      c.appendChild(calendarCard(st, App));
      c.appendChild(progressCard(st, App));
    }
  });

  window.PriTestStarvDaily = {
    roomOf: roomOf, span: span, taskText: taskText,
    _debug3d: function () { return map && map.o3d ? map.o3d._debug() : null; },
    // 測試用（tools/starv_check/daily_check.js）：設施圖上每個人目前的目的地房間與位置
    _debugMovers: function () {
      if (!map) return [];
      return Object.keys(map.movers).map(function (k) { var m = map.movers[k]; return { key: k, kind: m.kind, room: m.room, x: m.x, y: m.y, walking: m.queue.length > 0 }; });
    }
  };
})();
