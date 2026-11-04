// 末日據點（zombie）：合作連線（2〜4 人守同一個據點）。只負責 Firebase 房間協定；規則在 zombie_core.js，畫面在 zombie.js。
//
// 路徑：games/<roomId>/rtState/zm/...（沿用 game_storage.js 的 rtSet / rtSubscribe，database.rules.json 不用改）
//   meta        { v: 1, host: cid, status: "lobby" | "game" }
//   on/<cid>    true（onDisconnect 自動移除＝在線）
//   pl/<cid>    { pid, name, special, at }
//   cfg         JSON 字串（房主的設定：城市、天數、末日規則、起始據點）
//   st          JSON 字串 { s: 整局狀態, q: { pid: 已處理到的意圖序號 }, nm: "" | "live" | "auto", rev }
//   in/<pid>    JSON 字串 [{ n: 序號, it: 意圖 }]（每個玩家自己的意圖，只留最近 40 筆）
//   nc/<pid>    JSON 字串 [{ n: 序號, c: 夜晚指令 }]（即時防守中的點擊，只留最近 60 筆）
//   ns          JSON 字串（房主跑夜晚模擬時的快照，約每 0.2 秒一份）
//
// 「房主說了算」：只有房主套用意圖、跑夜晚模擬、寫 st／ns；其他人只送意圖／指令、看房主廣播的結果。
// 房主斷線（不在夜晚即時防守中）時，在線者裡最早加入的人接手，從 st 繼續。
// pid 存在 localStorage：重新整理或換分頁重進房間，還是同一個人、同一批倖存者。
(function () {
  "use strict";

  var ROOM_RE = /^g[0-9a-f]{32}$/;
  var CLOUD = "cloud";
  var PID_KEY = "pritest-zombie-pid";
  var KEEP_IN = 40, KEEP_NC = 60;

  function GS() { return window.PriTestZombieFakeGS || window.PriTestGameStorage; }
  function newCid() {
    var b = new Uint8Array(8);
    try { window.crypto.getRandomValues(b); } catch (e) { for (var i = 0; i < 8; i++) b[i] = Math.floor(Math.random() * 256); }
    return "c" + Array.prototype.map.call(b, function (x) { return (x < 16 ? "0" : "") + x.toString(16); }).join("");
  }
  function myPid() {
    var id = "";
    try { id = window.localStorage.getItem(PID_KEY) || ""; } catch (e) { /* 無法保存就每次新的 */ }
    if (!/^p[0-9a-f]{16}$/.test(id)) {
      id = "p" + newCid().slice(1);
      try { window.localStorage.setItem(PID_KEY, id); } catch (e) { /* 同上 */ }
    }
    return id;
  }
  function parseJson(s) { try { return typeof s === "string" && s ? JSON.parse(s) : null; } catch (e) { return null; } }

  // opts：{ roomId?（沒有＝建立新房）, name, special, cfg?, onChange(), onState(wrapper), onSnap(snap), onIntent(pid, it), onNightCmd(pid, c) }
  function open(opts) {
    var G = GS();
    var roomId = opts.roomId || G.generateCloudGameId();
    var creating = !opts.roomId;
    var cid = newCid();
    var subs = [], stopPresence = null;
    var room = {
      id: roomId, cid: cid, pid: opts.pid || myPid(), creating: creating, loaded: false, missing: false, closed: false,
      meta: null, online: {}, players: {}, cfg: opts.cfg || null, wrap: null, snap: null,
      me: { name: opts.name || "", special: opts.special || "", at: 0 }
    };
    var inSeq = 0, inList = [], ncSeq = 0, ncList = [];
    var seenIn = {}, seenNc = {};   // 房主：每個 pid 處理到的序號

    function changed() { if (!room.closed && opts.onChange) opts.onChange(); }
    function path(p) { return "zm/" + p; }
    function set(p, v) { return G.rtSet(roomId, CLOUD, path(p), v); }
    function sub(p, fn) { var u = G.rtSubscribe(roomId, CLOUD, path(p), fn); subs.push(u); return u; }

    room.isHost = function () { return !!room.meta && room.meta.host === cid; };
    room.status = function () { return room.meta ? room.meta.status : ""; };
    room.hostOnline = function () { return !!room.meta && !!room.online[room.meta.host]; };
    room.list = function () {
      return Object.keys(room.players).filter(function (k) { return room.online[k]; }).map(function (k) {
        var p = room.players[k] || {};
        return { cid: k, pid: String(p.pid || ""), name: String(p.name || "").slice(0, 16), special: String(p.special || ""), at: Number(p.at) || 0 };
      }).filter(function (p) { return /^p[0-9a-f]{16}$/.test(p.pid); }).sort(function (x, y) { return (x.at - y.at) || (x.cid < y.cid ? -1 : 1); });
    };
    function pushMe() { return set("pl/" + cid, { pid: room.pid, name: room.me.name || "", special: room.me.special || "", at: room.me.at }); }
    room.update = function (patch) { Object.keys(patch).forEach(function (k) { room.me[k] = patch[k]; }); return pushMe(); };
    room.setCfg = function (cfg) { if (!room.isHost()) return; room.cfg = cfg; set("cfg", JSON.stringify(cfg)); };

    // ---- 房主 ----
    room.writeState = function (wrap) {
      if (!room.isHost()) return null;
      wrap.rev = (wrap.rev || 0) + 1;
      wrap.q = wrap.q || {};
      Object.keys(seenIn).forEach(function (pid) { wrap.q[pid] = seenIn[pid]; });
      room.wrap = wrap;
      set("st", JSON.stringify(wrap));
      return wrap;
    };
    room.startGame = function (wrap) {
      if (!room.isHost()) return;
      room.writeState(wrap);
      set("meta", { v: 1, host: cid, status: "game" });
    };
    room.backToLobby = function () { if (room.isHost()) { set("meta", { v: 1, host: cid, status: "lobby" }); set("ns", null); } };
    room.writeSnap = function (snap) { if (room.isHost()) set("ns", JSON.stringify(snap)); };
    room.clearSnap = function () { if (room.isHost()) set("ns", null); };

    // ---- 每個人 ----
    room.sendIntent = function (it) {
      inSeq = Math.max(inSeq, (room.wrap && room.wrap.q && room.wrap.q[room.pid]) || 0) + 1;
      inList.push({ n: inSeq, it: it });
      if (inList.length > KEEP_IN) inList.splice(0, inList.length - KEEP_IN);
      set("in/" + room.pid, JSON.stringify(inList));
    };
    room.sendNightCmd = function (c) {
      ncSeq++;
      ncList.push({ n: ncSeq, c: c });
      if (ncList.length > KEEP_NC) ncList.splice(0, ncList.length - KEEP_NC);
      set("nc/" + room.pid, JSON.stringify(ncList));
    };
    room.close = function () {
      if (room.closed) return;
      room.closed = true;
      subs.forEach(function (u) { u(); });
      if (stopPresence) stopPresence();
      set("pl/" + cid, null);
    };

    // 房主不在了（不在即時防守中）：在線者中最早加入的人接手
    function maybeTakeHost() {
      if (!room.meta || room.hostOnline()) return;
      var first = room.list()[0];
      if (!first || first.cid !== cid) return;
      G.rtTransaction(roomId, CLOUD, path("meta"), function (m) {
        if (!m || m.host !== room.meta.host) return;
        m.host = cid;
        return m;
      });
    }
    function onIn(v) {
      if (!room.isHost() || !v) return;
      Object.keys(v).forEach(function (pid) {
        var list = parseJson(v[pid]);
        if (!Array.isArray(list)) return;
        var done = seenIn[pid] !== undefined ? seenIn[pid] : ((room.wrap && room.wrap.q && room.wrap.q[pid]) || 0);
        list.forEach(function (x) {
          if (!x || !(x.n > done)) return;
          done = x.n;
          if (opts.onIntent) opts.onIntent(pid, x.it);
        });
        seenIn[pid] = done;
      });
    }
    function onNc(v) {
      if (!room.isHost() || !v) return;
      Object.keys(v).forEach(function (pid) {
        var list = parseJson(v[pid]);
        if (!Array.isArray(list)) return;
        var done = seenNc[pid] || 0;
        list.forEach(function (x) { if (x && x.n > done) { done = x.n; if (opts.onNightCmd) opts.onNightCmd(pid, x.c); } });
        seenNc[pid] = done;
      });
    }
    room.resetNightCmds = function () {
      // 新的一晚：把大家目前的序號當作已處理（舊的點擊不會跑進新的夜晚）
      Object.keys(room._nc || {}).forEach(function (pid) {
        var list = parseJson(room._nc[pid]);
        if (Array.isArray(list) && list.length) seenNc[pid] = list[list.length - 1].n;
      });
    };

    function begin() {
      room.me.at = G.serverNow();
      var first = true;
      sub("meta", function (v) {
        if (first) {
          first = false;
          if (!v && !creating) { room.missing = true; room.loaded = true; changed(); return; }
        }
        var wasHost = room.isHost();
        room.meta = v;
        room.loaded = !!v;
        if (!wasHost && room.isHost()) { seenIn = {}; if (room._in) onIn(room._in); }
        maybeTakeHost();
        changed();
      });
      sub("on", function (v) { room.online = v || {}; maybeTakeHost(); changed(); });
      sub("pl", function (v) { room.players = v || {}; changed(); });
      sub("cfg", function (v) { var c = parseJson(v); if (c) room.cfg = c; changed(); });
      sub("st", function (v) {
        var w = parseJson(v);
        if (!w) return;
        if (room.isHost() && room.wrap && (w.rev || 0) <= (room.wrap.rev || 0)) return;   // 自己剛寫的
        room.wrap = w;
        if (opts.onState) opts.onState(w);
        changed();
      });
      sub("in", function (v) { room._in = v; onIn(v); });
      sub("nc", function (v) { room._nc = v; onNc(v); });
      sub("ns", function (v) { var s = parseJson(v); room.snap = s; if (opts.onSnap) opts.onSnap(s); });
      stopPresence = G.rtSetWithOnDisconnect(roomId, CLOUD, path("on/" + cid), true);
      pushMe();
    }
    if (creating) {
      Promise.all([set("meta", { v: 1, host: cid, status: "lobby" }), set("cfg", JSON.stringify(room.cfg || {})), set("st", null), set("in", null), set("nc", null), set("ns", null)]).then(begin);
    } else begin();
    return room;
  }

  function roomFromUrl(href) {
    var m = String(href || "").match(/[?&#]room=(g[0-9a-f]{32})/);
    return m ? m[1] : null;
  }

  window.PriTestZombieNet = {
    open: open, roomFromUrl: roomFromUrl, myPid: myPid, validRoomId: function (id) { return ROOM_RE.test(String(id || "")); }
  };
})();
