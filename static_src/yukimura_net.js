// 大名幸村（yukimura）：多人連線（房主模擬、可中途加入／中途退出）。只負責 Firebase 房間協定；規則在 yukimura_core.js、畫面在 yukimura.js。
//
// 路徑：games/<roomId>/rtState/yk/...（沿用 game_storage.js 的 rtSet / rtSubscribe，database.rules.json 不用改）
//   meta        { v: 1, host: cid, status: "lobby" | "game" }
//   on/<cid>    true（onDisconnect 自動移除＝在線）
//   pl/<cid>    { pid, name, dm（大名）, meta（本陣強化 JSON）, at }
//   cfg         JSON 字串（房主的設定：關卡、地圖、難度、時長）
//   st          JSON 字串：壓縮快照（Core.snap，約每 0.14 秒）
//   fu          JSON 字串 { s: 完整狀態, q: { pid: 已處理到的意圖序號 } }（約每 4 秒，給接手的新房主用；一般玩家不訂閱）
//   in/<pid>    JSON 字串 [{ n: 序號（時間戳遞增，換房主也不會重複）, it: 意圖 }]（升級選擇、采配；只留最近 30 筆）
//
// 延遲對策（2026-11-05）：快照與位置的寫入都有「上一筆沒送完就跳過」的流量控制，網路慢時延遲不會越積越多；
// 房主切到背景（手機鎖螢幕、切 App）時把房主交給下一位（handoff），模擬不會停。
//   mv/<pid>    { x, z, fx, fz }：每個人自己的位置（自己算移動，畫面才順；房主採用）
//
// 中途加入：遊戲進行中開網址就會進房，房主在下一次快照把他加進戰場（等級依隊伍平均補發升級）。
// 中途退出：離線超過 4 秒，房主把他移出戰場（角色保留，同一個裝置回來會恢復）。
// 房主斷線：在線者裡最早加入的人接手，從最後一份 fu 繼續模擬。
(function () {
  "use strict";

  var ROOM_RE = /^g[0-9a-f]{32}$/;
  var CLOUD = "cloud";
  var PID_KEY = "pritest-yukimura-pid";
  var KEEP_IN = 30;

  function GS() { return window.PriTestYukimuraFakeGS || window.PriTestGameStorage; }
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

  // opts：{ roomId?（沒有＝建立新房）, name, dm, meta, cfg?, onChange(), onSnap(snap), onFull(fu), onIntent(pid, it), onMove(pid, mv), onHost() }
  function open(opts) {
    var G = GS();
    var roomId = opts.roomId || G.generateCloudGameId();
    var creating = !opts.roomId;
    var cid = newCid();
    var subs = [], stopPresence = null;
    var room = {
      id: roomId, cid: cid, pid: myPid(), creating: creating, loaded: false, missing: false, closed: false,
      meta: null, online: {}, players: {}, cfg: opts.cfg || null, snap: null, full: null, moves: {},
      me: { name: opts.name || "", dm: opts.dm | 0, meta: JSON.stringify(opts.meta || {}), at: 0 }
    };
    var inSeq = 0, inList = [], seenIn = {}, fullRev = 0, fullSub = null;
    // 流量控制：同一路徑上一筆還沒寫完就跳過（最多等 1.5 秒當作失敗）
    var busy = {};
    function setThrottled(key, p, v) {
      var now = Date.now();
      if (busy[key] && now - busy[key] < 1500) return false;
      busy[key] = now;
      var done = function () { busy[key] = 0; };
      var pr = set(p, v);
      if (pr && pr.then) pr.then(done, done); else done();
      return true;
    }

    function changed() { if (!room.closed && opts.onChange) opts.onChange(); }
    function path(p) { return "yk/" + p; }
    function set(p, v) { return G.rtSet(roomId, CLOUD, path(p), v); }
    function sub(p, fn) { var u = G.rtSubscribe(roomId, CLOUD, path(p), fn); subs.push(u); return u; }

    room.isHost = function () { return !!room.meta && room.meta.host === cid; };
    room.status = function () { return room.meta ? room.meta.status : ""; };
    room.hostOnline = function () { return !!room.meta && !!room.online[room.meta.host]; };
    // 在線的玩家（同一個 pid 開兩個分頁只算一個：取最早加入的那個連線）
    room.list = function () {
      var seen = {};
      return Object.keys(room.players).filter(function (k) { return room.online[k]; }).map(function (k) {
        var p = room.players[k] || {};
        return { cid: k, pid: String(p.pid || ""), name: String(p.name || "").slice(0, 16), dm: Number(p.dm) || 0, meta: parseJson(p.meta) || {}, at: Number(p.at) || 0 };
      }).filter(function (p) { return /^p[0-9a-f]{16}$/.test(p.pid); }).sort(function (x, y) { return (x.at - y.at) || (x.cid < y.cid ? -1 : 1); })
        .filter(function (p) { if (seen[p.pid]) return false; seen[p.pid] = 1; return true; });
    };
    function pushMe() { return set("pl/" + cid, { pid: room.pid, name: room.me.name || "", dm: room.me.dm | 0, meta: room.me.meta || "{}", at: room.me.at }); }
    room.update = function (patch) {
      Object.keys(patch).forEach(function (k) { room.me[k] = k === "meta" ? JSON.stringify(patch[k] || {}) : patch[k]; });
      return pushMe();
    };
    room.setCfg = function (cfg) { if (!room.isHost()) return; room.cfg = cfg; set("cfg", JSON.stringify(cfg)); };

    // ---- 房主 ----
    room.writeSnap = function (snapObj) { return room.isHost() ? setThrottled("st", "st", JSON.stringify(snapObj)) : false; };
    room.snapBusy = function () { return !!busy.st && Date.now() - busy.st < 1500; };
    room.writeFull = function (sJson) {
      if (!room.isHost()) return;
      var q = {};
      Object.keys(seenIn).forEach(function (pid) { q[pid] = seenIn[pid]; });
      fullRev++;
      set("fu", JSON.stringify({ s: sJson, q: q, r: fullRev }));
    };
    room.startGame = function (sJson) {
      if (!room.isHost()) return;
      room.writeFull(sJson);
      set("meta", { v: 1, host: cid, status: "game" });
    };
    room.backToLobby = function () { if (room.isHost()) { set("meta", { v: 1, host: cid, status: "lobby" }); set("st", null); set("fu", null); } };
    // 把房主交給在線的下一位（先寫好完整狀態）
    room.handoff = function (sJson) {
      if (!room.isHost()) return false;
      var next = room.list().filter(function (p) { return p.cid !== cid; })[0];
      if (!next) return false;
      room.writeFull(sJson);
      G.rtTransaction(roomId, CLOUD, path("meta"), function (m) {
        if (!m || m.host !== cid) return;
        m.host = next.cid;
        return m;
      });
      return true;
    };
    // 只讀一次完整狀態（接手房主時用）
    room.fetchFull = function (cb) {
      var got = false;
      var u = G.rtSubscribe(roomId, CLOUD, path("fu"), function (v) {
        if (got) return;
        got = true;
        setTimeout(function () { u(); }, 0);
        var w = parseJson(v);
        if (w) room.full = w;
        cb(w);
      });
    };

    // ---- 每個人 ----
    room.sendIntent = function (it) {
      inSeq = Math.max(inSeq + 1, Date.now());
      inList.push({ n: inSeq, it: it });
      if (inList.length > KEEP_IN) inList.splice(0, inList.length - KEEP_IN);
      set("in/" + room.pid, JSON.stringify(inList));
    };
    room.sendMove = function (mv) { return setThrottled("mv", "mv/" + room.pid, mv); };
    room.resetIntents = function () { inList = []; };
    room.close = function () {
      if (room.closed) return;
      room.closed = true;
      subs.forEach(function (u) { u(); });
      if (stopPresence) stopPresence();
      set("pl/" + cid, null);
    };

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
        var done = seenIn[pid] !== undefined ? seenIn[pid] : 0;
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
        if (!wasHost && room.isHost() && room.status() === "game") {
          // 接手房主：先讀最後一份完整狀態，再開始處理意圖
          room.fetchFull(function (w) {
            seenIn = {};
            if (w && w.q) Object.keys(w.q).forEach(function (pid) { seenIn[pid] = w.q[pid]; });
            if (opts.onHost) opts.onHost(w);
            if (room._in) onIn(room._in);
          });
        }
        maybeTakeHost();
        changed();
      });
      sub("on", function (v) { room.online = v || {}; maybeTakeHost(); changed(); });
      sub("pl", function (v) { room.players = v || {}; changed(); });
      sub("cfg", function (v) { var c = parseJson(v); if (c) room.cfg = c; changed(); });
      sub("st", function (v) {
        if (room.isHost()) return;
        var o = parseJson(v);
        room.snap = o;
        if (o && opts.onSnap) opts.onSnap(o);
      });
      // fu 不訂閱（太大）：房主開局時由 startGame 帶進來，接手時用 fetchFull 讀一次
      sub("in", function (v) { room._in = v; onIn(v); });
      sub("mv", function (v) {
        room.moves = v || {};
        if (opts.onMove) Object.keys(room.moves).forEach(function (pid) { opts.onMove(pid, room.moves[pid]); });
      });
      stopPresence = G.rtSetWithOnDisconnect(roomId, CLOUD, path("on/" + cid), true);
      pushMe();
    }
    if (creating) {
      Promise.all([set("meta", { v: 1, host: cid, status: "lobby" }), set("cfg", JSON.stringify(room.cfg || {})), set("st", null), set("fu", null), set("in", null), set("mv", null)]).then(begin);
    } else begin();
    return room;
  }

  function roomFromUrl(href) {
    var m = String(href || "").match(/[?&#]room=(g[0-9a-f]{32})/);
    return m ? m[1] : null;
  }

  window.PriTestYukimuraNet = {
    open: open, roomFromUrl: roomFromUrl, myPid: myPid, validRoomId: function (id) { return ROOM_RE.test(String(id || "")); }
  };
})();
