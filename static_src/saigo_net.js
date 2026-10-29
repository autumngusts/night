// 賽狗賽狗（saigo）：多裝置連線。只負責 Firebase 房間協定；畫面在 saigo.js，模擬在 saigo_core.js。
//
// 路徑：games/<roomId>/rtState/sg/...（沿用 game_storage.js 的 rtSet / rtSubscribe，database.rules.json 不用改）
//   meta          { v: 1, host: cid, no: 場次編號, status: "lobby" | "card" | "race" }
//   on/<cid>      true（onDisconnect 自動移除＝在線）
//   pl/<cid>      { name, entry: JSON 字串 | ""（要派出賽的狗）, ready, no（ready 對應的場次）, at }
//   cfg           JSON 字串（房主的設定：賽事等級）
//   m/<no>        { card: JSON（出賽表，含 seed）, startAt: 伺服器時刻 ms（0＝還在下注） }
//
// 同步方式：比賽不需要任何即時指令——出賽表（含 seed）一旦發佈，每台裝置自己跑同一個確定性模擬，
// 依伺服器時鐘（startAt）播放，所以結果完全一樣，只是各自看不同的鏡頭。下注各自在自己的裝置上記帳。
(function () {
  "use strict";

  var GS = window.PriTestGameStorage;
  if (!GS) return;

  var START_DELAY_MS = 5000;
  var ROOM_RE = /^g[0-9a-f]{32}$/;
  var CLOUD = "cloud";

  function newCid() {
    var b = new Uint8Array(8);
    try { window.crypto.getRandomValues(b); } catch (e) { for (var i = 0; i < 8; i++) b[i] = Math.floor(Math.random() * 256); }
    return "c" + Array.prototype.map.call(b, function (x) { return (x < 16 ? "0" : "") + x.toString(16); }).join("");
  }
  function parseJson(s) { try { return typeof s === "string" && s ? JSON.parse(s) : null; } catch (e) { return null; } }

  // opts：{ roomId?（沒有＝建立新房）, name, cfg?, onChange() }
  function open(opts) {
    var roomId = opts.roomId || GS.generateCloudGameId();
    var creating = !opts.roomId;
    var cid = newCid();
    var subs = [];
    var stopPresence = null;
    var room = {
      id: roomId, cid: cid, creating: creating,
      loaded: false, missing: false, closed: false,
      meta: null, online: {}, players: {}, cfg: opts.cfg || { cls: "open" }, match: null, matchNo: 0,
      me: { name: opts.name || "", entry: null, ready: false, no: 0, at: 0 }
    };

    function changed() { if (!room.closed && opts.onChange) opts.onChange(); }
    function path(p) { return "sg/" + p; }
    function set(p, v) { return GS.rtSet(roomId, CLOUD, path(p), v); }
    function sub(p, fn) { var u = GS.rtSubscribe(roomId, CLOUD, path(p), fn); subs.push(u); return u; }

    room.isHost = function () { return !!room.meta && room.meta.host === cid; };
    room.hostOnline = function () { return !!room.meta && !!room.online[room.meta.host]; };
    room.status = function () { return room.meta ? room.meta.status : ""; };

    room.list = function () {
      return Object.keys(room.players).filter(function (k) { return room.online[k]; }).map(function (k) {
        var p = room.players[k] || {};
        return { cid: k, name: String(p.name || "").slice(0, 16), entry: parseJson(p.entry), ready: !!p.ready && Number(p.no) === (room.meta && room.meta.no), at: Number(p.at) || 0 };
      }).sort(function (x, y) { return (x.at - y.at) || (x.cid < y.cid ? -1 : 1); });
    };

    function pushMe() {
      var m = room.me;
      return set("pl/" + cid, { name: m.name || "", entry: m.entry ? JSON.stringify(m.entry) : "", ready: !!m.ready, no: m.no || 0, at: m.at });
    }
    room.update = function (patch) {
      Object.keys(patch).forEach(function (k) { room.me[k] = patch[k]; });
      return pushMe();
    };
    room.setReady = function (v) { return room.update({ ready: !!v, no: room.meta ? room.meta.no : 0 }); };

    room.setCfg = function (cfg) {
      if (!room.isHost()) return;
      room.cfg = cfg;
      set("cfg", JSON.stringify(cfg));
    };

    // 房主發佈出賽表（下注開始）
    room.publish = function (card) {
      if (!room.isHost() || !room.meta) return;
      var no = (room.meta.no || 0) + 1, prev = room.meta.no;
      set("m/" + no, { card: JSON.stringify(card), startAt: 0 }).then(function () {
        if (prev) set("m/" + prev, null);
        return set("meta", { v: 1, host: cid, no: no, status: "card" });
      });
    };
    // 房主開跑
    room.start = function () {
      if (!room.isHost() || !room.meta || !room.match) return;
      var no = room.meta.no;
      set("m/" + no + "/startAt", GS.serverNow() + START_DELAY_MS).then(function () {
        return set("meta", { v: 1, host: cid, no: no, status: "race" });
      });
    };
    room.backToLobby = function () {
      if (!room.isHost() || !room.meta) return;
      set("meta", { v: 1, host: cid, no: room.meta.no, status: "lobby" });
    };
    // 比賽時間（秒）：伺服器時刻換算
    room.raceTime = function () {
      if (!room.match || !room.match.startAt) return null;
      return (GS.serverNow() - room.match.startAt) / 1000;
    };

    room.leave = function () {
      if (room.closed) return;
      room.closed = true;
      subs.forEach(function (u) { u(); });
      if (stopPresence) stopPresence();
      set("pl/" + cid, null);
    };

    // 房主不在了（不在比賽中）：在線者中最早加入的人接手
    function maybeTakeHost() {
      if (!room.meta || room.meta.status === "race" || room.hostOnline()) return;
      var first = room.list()[0];
      if (!first || first.cid !== cid) return;
      GS.rtTransaction(roomId, CLOUD, path("meta"), function (m) {
        if (!m || m.host !== room.meta.host) return;
        m.host = cid;
        return m;
      });
    }

    function watchMatch(no) {
      if (room.matchNo === no) return;
      room.matchNo = no;
      room.match = null;
      if (room._unMatch) room._unMatch();
      room._unMatch = sub("m/" + no, function (v) {
        if (!v || room.matchNo !== no) return;
        var card = parseJson(v.card);
        if (!card || !card.dogs) return;
        var same = room.match && room.match.no === no;
        room.match = { no: no, card: same ? room.match.card : card, startAt: Number(v.startAt) || 0 };
        changed();
      });
    }

    function begin() {
      room.me.at = GS.serverNow();
      var first = true;
      sub("meta", function (v) {
        if (first) {
          first = false;
          if (!v && !creating) { room.missing = true; room.loaded = true; changed(); return; }
        }
        room.meta = v;
        room.loaded = !!v;
        if (v && v.no) watchMatch(v.no);
        maybeTakeHost();
        changed();
      });
      sub("on", function (v) { room.online = v || {}; maybeTakeHost(); changed(); });
      sub("pl", function (v) { room.players = v || {}; changed(); });
      sub("cfg", function (v) { var c = parseJson(v); if (c) room.cfg = c; changed(); });
      stopPresence = GS.rtSetWithOnDisconnect(roomId, CLOUD, path("on/" + cid), true);
      pushMe();
    }

    if (creating) {
      Promise.all([set("meta", { v: 1, host: cid, no: 0, status: "lobby" }), set("cfg", JSON.stringify(room.cfg))]).then(begin);
    } else begin();

    return room;
  }

  function roomFromUrl(href) {
    var m = String(href || "").match(/[?&#]room=(g[0-9a-f]{32})/);
    return m ? m[1] : null;
  }

  window.PriTestSaigoNet = {
    START_DELAY_MS: START_DELAY_MS,
    open: open, roomFromUrl: roomFromUrl, validRoomId: function (id) { return ROOM_RE.test(String(id || "")); }
  };
})();
