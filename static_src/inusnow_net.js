// イヌスノー（狗雪）：即時同場的房間協定（docs/inusnow_design.md §19.1）。畫面在 inusnow_ui4.js，比賽規則在 inusnow_room.js。
//
// 路徑：games/<roomId>/rtState/inu/...（沿用 game_storage.js 的 rtSet／rtSubscribe，database.rules.json 不用改）
//   meta              { v: 1, host: cid, no: 場次, status: "lobby" | "card" | "race" }
//   on/<cid>          true（onDisconnect 移除＝在線）
//   pl/<cid>          { pid, name, breed, ready, no, role: "ride" | "watch", at }
//   cfg               JSON：房主設定 { resort, event: "pgs" | "slope" | "relay", cond, runs }
//   m/<no>            { card: JSON（Room.makeCard）, startAt: 伺服器時刻 ms（0＝還沒出發） }
//   m/<no>/rec/<cid>/<k>   第 k 段輸入紀錄（每 30 步一段，Core.encode）
//   m/<no>/done/<cid>      { ok, time, score }（自己算的結果；結算時大家用紀錄重算）
//   m/<no>/bets/<pid>      JSON { <cid>: 金額 }（觀戰者的單勝彩池）
//   bal/<pid>         { c: 房間狗幣, name }（transaction）
// 接力（relay）：第 k 棒在看到第 k−1 棒的 done 之後才出發（startAt 只用在第 1 棒）。
(function () {
  "use strict";

  var ROOM_RE = /^g[0-9a-f]{32}$/;
  var CLOUD = "cloud";
  var PID_KEY = "pritest-inusnow-pid";
  function GS() { return window.PriTestInusnowFakeGS || window.PriTestGameStorage; }
  function D() { return window.PriTestInusnowData; }

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

  // opts：{ roomId?（沒有＝建立新房）, name, breed, cfg?, onChange() }
  function open(opts) {
    var gs = GS();
    if (!gs) return null;
    var roomId = opts.roomId || gs.generateCloudGameId();
    var creating = !opts.roomId;
    var cid = newCid();
    var subs = [];
    var stopPresence = null;
    var room = {
      id: roomId, cid: cid, pid: myPid(), creating: creating, loaded: false, missing: false, closed: false,
      meta: null, online: {}, players: {}, cfg: opts.cfg || null, match: null, matchNo: 0, bal: {}, balLoaded: false,
      me: { name: opts.name || "", breed: opts.breed || "shiba", ready: false, no: 0, role: "ride", at: 0 },
    };
    function changed() { if (!room.closed && opts.onChange) opts.onChange(); }
    function path(p) { return "inu/" + p; }
    function set(p, v) { return gs.rtSet(roomId, CLOUD, path(p), v); }
    function sub(p, fn) { var u = gs.rtSubscribe(roomId, CLOUD, path(p), fn); subs.push(u); return u; }

    room.isHost = function () { return !!room.meta && room.meta.host === cid; };
    room.hostOnline = function () { return !!room.meta && !!room.online[room.meta.host]; };
    room.status = function () { return room.meta ? room.meta.status : ""; };
    room.now = function () { return gs.serverNow(); };
    // 在線的人（加入順序）
    room.list = function () {
      return Object.keys(room.players).filter(function (k) { return room.online[k]; }).map(function (k) {
        var p = room.players[k] || {};
        return { cid: k, pid: String(p.pid || ""), name: String(p.name || "").slice(0, 16), breed: String(p.breed || "shiba"), role: p.role === "watch" ? "watch" : "ride",
          ready: !!p.ready && Number(p.no) === (room.meta && room.meta.no), at: Number(p.at) || 0 };
      }).sort(function (x, y) { return (x.at - y.at) || (x.cid < y.cid ? -1 : 1); });
    };
    room.riders = function () { return room.list().filter(function (p) { return p.role === "ride"; }); };
    function pushMe() {
      var m = room.me;
      return set("pl/" + cid, { pid: room.pid, name: m.name || "", breed: m.breed || "shiba", ready: !!m.ready, no: m.no || 0, role: m.role, at: m.at });
    }
    room.update = function (patch) { Object.keys(patch).forEach(function (k) { room.me[k] = patch[k]; }); return pushMe(); };
    room.setReady = function (v) { return room.update({ ready: !!v, no: room.meta ? room.meta.no : 0 }); };
    room.setCfg = function (cfg) { if (!room.isHost()) return; room.cfg = cfg; set("cfg", JSON.stringify(cfg)); };

    // 房主：發佈出賽表（觀戰者下注）→ 出發（startAt＝伺服器時刻＋延遲）
    room.publish = function (card) {
      if (!room.isHost() || !room.meta) return Promise.resolve();
      var no = (room.meta.no || 0) + 1, prev = room.meta.no;
      return set("m/" + no, { card: JSON.stringify(card), startAt: 0 }).then(function () {
        if (prev) set("m/" + prev, null);
        return set("meta", { v: 1, host: cid, no: no, status: "card" });
      });
    };
    room.start = function () {
      if (!room.isHost() || !room.meta || !room.match) return Promise.resolve();
      var no = room.meta.no;
      return set("m/" + no + "/startAt", gs.serverNow() + D().ROOM.startDelay).then(function () { return set("meta", { v: 1, host: cid, no: no, status: "race" }); });
    };
    room.backToLobby = function () { if (room.isHost() && room.meta) set("meta", { v: 1, host: cid, no: room.meta.no, status: "lobby" }); };
    // 寫到「自己那一場」（no），不是目前的 match（房主換場時舊場的紀錄不會混進新場）
    room.pushSeg = function (no, k, str) { if (no) set("m/" + no + "/rec/" + cid + "/" + k, str); };
    room.pushDone = function (no, o) { if (no) set("m/" + no + "/done/" + cid, o); };
    room.pushBet = function (obj) { if (room.match) set("m/" + room.match.no + "/bets/" + room.pid, JSON.stringify(obj || {})); };
    room.raceTime = function () { return room.match && room.match.startAt ? (gs.serverNow() - room.match.startAt) / 1000 : null; };

    // 房間狗幣
    room.coinsOf = function (pid) { var v = room.bal[pid]; return v && isFinite(v.c) ? Math.max(0, Math.round(v.c)) : D().ROOM.coins; };
    room.coins = function () { return room.coinsOf(room.pid); };
    room.addCoins = function (pid, delta) {
      if (!/^p[0-9a-f]{16}$/.test(pid)) return Promise.resolve(null);
      return gs.rtTransaction(roomId, CLOUD, path("bal/" + pid), function (v) {
        var cur = v && isFinite(v.c) ? v.c : D().ROOM.coins;
        if (cur + delta < 0) return;
        return { c: Math.round(cur + delta), name: pid === room.pid ? room.me.name || "" : String((v && v.name) || "") };
      });
    };

    room.leave = function () {
      if (room.closed) return;
      room.closed = true;
      subs.forEach(function (u) { u(); });
      if (stopPresence) stopPresence();
      set("pl/" + cid, null);
    };
    // 房主離線：在線最早加入的人接手（比賽中不換）
    function maybeTakeHost() {
      // 2026-11-21 QA：比賽中房主離開也要換人（只換 host，不動 status），否則沒人能回大廳
      // 剛加入時各路徑的資料會分批到，房主看起來暫時不在線：要連續 3 秒不在線才接手
      if (!room.meta || room.hostOnline()) { room._hostGone = 0; return; }
      var now = Date.now();
      if (!room._hostGone) { room._hostGone = now; setTimeout(function () { if (!room.closed) maybeTakeHost(); }, 3100); return; }
      if (now - room._hostGone < 3000) return;
      var first = room.list()[0];
      if (!first || first.cid !== cid) return;
      gs.rtTransaction(roomId, CLOUD, path("meta"), function (m) {
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
        var card = room.match && room.match.no === no ? room.match.card : parseJson(v.card);
        if (!card || !card.riders) return;
        var bets = {};
        Object.keys(v.bets || {}).forEach(function (pid) { var b = parseJson(v.bets[pid]); if (b) bets[pid] = b; });
        var rec = {};
        Object.keys(v.rec || {}).forEach(function (c) {
          var segs = [], o = v.rec[c] || {};
          Object.keys(o).forEach(function (k) { if (/^\d+$/.test(k) && typeof o[k] === "string") segs[+k] = o[k]; });
          rec[c] = segs;
        });
        room.match = { no: no, card: card, startAt: Number(v.startAt) || 0, bets: bets, rec: rec, done: v.done || {} };
        changed();
      });
    }
    function begin() {
      room.me.at = gs.serverNow();
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
      sub("pl", function (v) { room.players = v || {}; maybeTakeHost(); changed(); });
      sub("cfg", function (v) { var c = parseJson(v); if (c) room.cfg = c; changed(); });
      sub("bal", function (v) { room.bal = v || {}; room.balLoaded = true; changed(); });
      stopPresence = gs.rtSetWithOnDisconnect(roomId, CLOUD, path("on/" + cid), true);
      pushMe();
    }
    if (creating) Promise.all([set("meta", { v: 1, host: cid, no: 0, status: "lobby" }), set("cfg", JSON.stringify(room.cfg || {}))]).then(begin);
    else begin();
    return room;
  }

  function roomFromUrl(href) {
    var m = String(href || "").match(/[?&#]room=(g[0-9a-f]{32})/);
    return m ? m[1] : null;
  }

  window.PriTestInusnowNet = { open: open, roomFromUrl: roomFromUrl, validRoomId: function (id) { return ROOM_RE.test(String(id || "")); } };
})();
