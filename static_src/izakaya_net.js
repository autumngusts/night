// 深夜居酒屋（izakaya）：合作連線（2〜4 人分工經營同一家店）。只負責 Firebase 房間協定；規則在 izakaya_core.js，畫面在 izakaya.js。
//
// 路徑：games/<roomId>/rtState/iz/...（沿用 game_storage.js 的 rtSet / rtSubscribe，database.rules.json 不用改）
//   meta        { v: 1, host: cid, status: "lobby" | "game" }
//   on/<cid>    true（onDisconnect 自動移除＝在線）
//   pl/<cid>    { pid, name, role, at }
//   cfg         JSON 字串（房主的設定：模式、地圖、波數、難度）
//   st          JSON 字串 { s: 整局狀態（Core.serialize）, q: { pid: 已處理到的意圖序號 }, rev }
//   in/<pid>    JSON 字串 [{ n: 序號, it: 意圖 }]（每個玩家自己的意圖，只留最近 40 筆）
//
// 「房主說了算」：只有房主套用意圖、跑模擬、寫 st（尖峰進行中約每 0.1 秒一份，其餘時間有變動才寫）；其他人只送意圖、看房主廣播的結果。
// 房主斷線時，在線者裡最早加入的人接手，從最後一份 st 繼續模擬。
(function () {
  "use strict";

  var ROOM_RE = /^g[0-9a-f]{32}$/;
  var CLOUD = "cloud";
  var PID_KEY = "pritest-izakaya-pid";
  var KEEP_IN = 40;

  function GS() { return window.PriTestIzakayaFakeGS || window.PriTestGameStorage; }
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

  // opts：{ roomId?（沒有＝建立新房）, name, cfg?, onChange(), onState(wrap), onIntent(pid, it), onHost() }
  function open(opts) {
    var G = GS();
    var roomId = opts.roomId || G.generateCloudGameId();
    var creating = !opts.roomId;
    var cid = newCid();
    var subs = [], stopPresence = null;
    var room = {
      id: roomId, cid: cid, pid: myPid(), creating: creating, loaded: false, missing: false, closed: false,
      meta: null, online: {}, players: {}, cfg: opts.cfg || null, wrap: null, me: { name: opts.name || "", role: opts.role || "", at: 0 }
    };
    var inSeq = 0, inList = [], seenIn = {};

    function changed() { if (!room.closed && opts.onChange) opts.onChange(); }
    function path(p) { return "iz/" + p; }
    function set(p, v) { return G.rtSet(roomId, CLOUD, path(p), v); }
    function sub(p, fn) { var u = G.rtSubscribe(roomId, CLOUD, path(p), fn); subs.push(u); return u; }

    room.isHost = function () { return !!room.meta && room.meta.host === cid; };
    room.status = function () { return room.meta ? room.meta.status : ""; };
    room.hostOnline = function () { return !!room.meta && !!room.online[room.meta.host]; };
    room.list = function () {
      return Object.keys(room.players).filter(function (k) { return room.online[k]; }).map(function (k) {
        var p = room.players[k] || {};
        return { cid: k, pid: String(p.pid || ""), name: String(p.name || "").slice(0, 16), role: String(p.role || ""), at: Number(p.at) || 0 };
      }).filter(function (p) { return /^p[0-9a-f]{16}$/.test(p.pid); }).sort(function (x, y) { return (x.at - y.at) || (x.cid < y.cid ? -1 : 1); });
    };
    function pushMe() { return set("pl/" + cid, { pid: room.pid, name: room.me.name || "", role: room.me.role || "", at: room.me.at }); }
    room.update = function (patch) { Object.keys(patch).forEach(function (k) { room.me[k] = patch[k]; }); return pushMe(); };
    room.setCfg = function (cfg) { if (!room.isHost()) return; room.cfg = cfg; set("cfg", JSON.stringify(cfg)); };

    // ---- 房主 ----
    room.writeState = function (sJson) {
      if (!room.isHost()) return;
      var w = { s: sJson, q: {}, rev: ((room.wrap && room.wrap.rev) || 0) + 1 };
      Object.keys(seenIn).forEach(function (pid) { w.q[pid] = seenIn[pid]; });
      room.wrap = w;
      set("st", JSON.stringify(w));
    };
    room.startGame = function (sJson) {
      if (!room.isHost()) return;
      room.writeState(sJson);
      set("meta", { v: 1, host: cid, status: "game" });
    };
    room.backToLobby = function () { if (room.isHost()) set("meta", { v: 1, host: cid, status: "lobby" }); };

    // ---- 每個人 ----
    room.sendIntent = function (it) {
      inSeq = Math.max(inSeq, (room.wrap && room.wrap.q && room.wrap.q[room.pid]) || 0) + 1;
      inList.push({ n: inSeq, it: it });
      if (inList.length > KEEP_IN) inList.splice(0, inList.length - KEEP_IN);
      set("in/" + room.pid, JSON.stringify(inList));
    };
    room.close = function () {
      if (room.closed) return;
      room.closed = true;
      subs.forEach(function (u) { u(); });
      if (stopPresence) stopPresence();
      set("pl/" + cid, null);
    };

    // 房主看起來離線時，等 2.5 秒再確認才接手：剛連上時「在線名單」可能還沒收齊（先只看到自己），
    // 不等的話新加入的人會誤以為房主不在而搶走房主（2026-11-09 連線檢查發現）
    var takeTimer = null;
    function maybeTakeHost() {
      if (!room.meta || room.hostOnline() || takeTimer) return;
      takeTimer = setTimeout(function () {
        takeTimer = null;
        if (room.closed || !room.meta || room.hostOnline()) return;
        var first = room.list()[0];
        if (!first || first.cid !== cid) return;
        G.rtTransaction(roomId, CLOUD, path("meta"), function (m) {
          if (!m || m.host !== room.meta.host) return;
          m.host = cid;
          return m;
        });
      }, 2500);
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
        if (!wasHost && room.isHost()) {
          seenIn = {};
          if (opts.onHost) opts.onHost();
          if (room._in) onIn(room._in);
        }
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
      stopPresence = G.rtSetWithOnDisconnect(roomId, CLOUD, path("on/" + cid), true);
      pushMe();
    }
    if (creating) {
      Promise.all([set("meta", { v: 1, host: cid, status: "lobby" }), set("cfg", JSON.stringify(room.cfg || {})), set("st", null), set("in", null)]).then(begin);
    } else begin();
    return room;
  }

  function roomFromUrl(href) {
    var m = String(href || "").match(/[?&#]room=(g[0-9a-f]{32})/);
    return m ? m[1] : null;
  }

  window.PriTestIzakayaNet = {
    open: open, roomFromUrl: roomFromUrl, myPid: myPid, validRoomId: function (id) { return ROOM_RE.test(String(id || "")); }
  };
})();
