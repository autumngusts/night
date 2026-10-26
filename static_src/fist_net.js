// 鐵拳教育（fist）：連線房間（最多 4 人，各扮演一位老師）。只負責 Firebase 協定；畫面在 fist.js，規則在 fist_core.js。
// 協定與黃牌（yellow_net.js）相同，只是路徑前綴改成 fe/。
//
// 路徑：games/<roomId>/rtState/fe/...（沿用 game_storage.js 的 rtSet / rtSubscribe，database.rules.json 不用改）
//   meta            { v: 1, host: cid, status: "lobby" | "play", no: 對局編號 }
//   on/<cid>        true（onDisconnect 自動移除＝在線）
//   pl/<cid>        { name, at }
//   seat/<n>        { cid, cls } | null（大廳的座位 0〜3；一個人可以坐好幾個位置）
//   st              { no, seq, json }（房主寫入的整局狀態）
//   in/<cid>/a<seq> 操作 JSON 字串（非房主送出；房主套用後刪除）
//
// 同步方式（房主為準）：回合制，所以不做預測——所有人只畫 st；
// 非房主的操作寫進 in/，房主依 seq 順序用 Core.apply(st, 送出者 cid, 操作) 套用，再把整份狀態寫回 st。
// 房主斷線時，在線者中最早加入的人接手房主（手上已有最新的 st，可以直接繼續）。
(function () {
  "use strict";

  var Core = window.PriTestFistCore;
  var GS = window.PriTestGameStorage;
  if (!Core || !GS) return;

  var ROOM_RE = /^g[0-9a-f]{32}$/;
  var CLOUD = "cloud";
  var SEATS = 4;

  function newCid() {
    var b = new Uint8Array(8);
    try { window.crypto.getRandomValues(b); } catch (e) { for (var i = 0; i < 8; i++) b[i] = Math.floor(Math.random() * 256); }
    return "c" + Array.prototype.map.call(b, function (x) { return (x < 16 ? "0" : "") + x.toString(16); }).join("");
  }

  function parseJson(s) { try { return typeof s === "string" && s ? JSON.parse(s) : null; } catch (e) { return null; } }

  // opts：{ roomId?（沒有＝建立新房）, name, onChange() }
  function open(opts) {
    var roomId = opts.roomId || GS.generateCloudGameId();
    var creating = !opts.roomId;
    var cid = newCid();
    var subs = [];
    var stopPresence = null;
    var lastSeq = Date.now();
    var done = {};         // 房主：cid → 已套用的最大 seq
    var room = {
      id: roomId, cid: cid, creating: creating,
      loaded: false, missing: false, closed: false,
      meta: null, online: {}, players: {}, seats: [null, null, null, null],
      game: null, gameSeq: 0, name: opts.name || ""
    };

    function changed() { if (!room.closed && opts.onChange) opts.onChange(); }
    function path(p) { return "fe/" + p; }
    function set(p, v) { return GS.rtSet(roomId, CLOUD, path(p), v); }
    function sub(p, fn) { var u = GS.rtSubscribe(roomId, CLOUD, path(p), fn); subs.push(u); return u; }

    room.isHost = function () { return !!room.meta && room.meta.host === cid; };
    room.hostOnline = function () { return !!room.meta && !!room.online[room.meta.host]; };

    room.list = function () {
      return Object.keys(room.players).filter(function (k) { return room.online[k]; }).map(function (k) {
        var p = room.players[k] || {};
        return { cid: k, name: String(p.name || "").slice(0, 16), at: Number(p.at) || 0 };
      }).sort(function (x, y) { return (x.at - y.at) || (x.cid < y.cid ? -1 : 1); });
    };

    room.nameOf = function (c) { var p = room.players[c]; return p ? String(p.name || "").slice(0, 16) : ""; };

    function pushMe() { return set("pl/" + cid, { name: room.name || "", at: room.at }); }
    room.setName = function (n) { room.name = String(n || "").slice(0, 16); pushMe(); };

    // ---------------- 大廳座位 ----------------
    // 坐下／換職業：空位或自己的位置才能改（交易避免兩人同時搶）
    room.takeSeat = function (n, cls) {
      if (n < 0 || n >= SEATS || !room.meta || room.meta.status !== "lobby") return;
      GS.rtTransaction(roomId, CLOUD, path("seat/" + n), function (cur) {
        if (cur && cur.cid && cur.cid !== cid && room.online[cur.cid]) return; // 別人坐著
        return { cid: cid, cls: cls };
      });
    };
    room.leaveSeat = function (n) {
      var s = room.seats[n];
      if (!s) return;
      // 自己的位置，或房主清掉離線者的位置
      if (s.cid === cid || (room.isHost() && !room.online[s.cid])) set("seat/" + n, null);
    };

    room.canStart = function () {
      if (!room.isHost() || room.meta.status !== "lobby") return false;
      return room.seats.some(function (s) { return s && room.online[s.cid]; });
    };

    room.start = function () {
      if (!room.canStart()) return;
      var seats = room.seats.map(function (s) {
        if (!s || !room.online[s.cid]) return null;
        return { cls: s.cls, ctrl: s.cid, name: room.nameOf(s.cid) };
      });
      var st = Core.create({ seats: seats, hostCtrl: cid });
      var no = (room.meta.no || 0) + 1;
      done = {};
      set("in", null);
      writeGame(st, no).then(function () { set("meta", { v: 1, host: cid, status: "play", no: no }); });
    };

    room.backToLobby = function () {
      if (!room.isHost() || !room.meta) return;
      set("meta", { v: 1, host: cid, status: "lobby", no: room.meta.no || 0 });
    };

    // ---------------- 對局 ----------------
    function writeGame(st, no) {
      room.gameSeq += 1;
      room.game = st;
      changed();
      return set("st", { no: no, seq: room.gameSeq, json: JSON.stringify(st) });
    }

    // 送出操作：房主直接套用；其他人寫進 in/，等房主的新狀態
    room.send = function (action) {
      if (!room.game || !room.meta || room.meta.status !== "play") return "no_game";
      if (room.isHost()) {
        var err = Core.apply(room.game, cid, action);
        if (!err) writeGame(room.game, room.meta.no);
        return err;
      }
      lastSeq = Math.max(lastSeq + 1, Date.now());
      set("in/" + cid + "/a" + lastSeq, JSON.stringify(action));
      return null;
    };

    function hostProcess(all) {
      if (!room.isHost() || !room.game || !all) return;
      var dirty = false;
      Object.keys(all).forEach(function (c) {
        var box = all[c] || {};
        Object.keys(box).map(function (k) { return { k: k, seq: Number(k.slice(1)) }; })
          .filter(function (x) { return isFinite(x.seq); })
          .sort(function (a, b) { return a.seq - b.seq; })
          .forEach(function (x) {
            if (!(x.seq > (done[c] || 0))) { set("in/" + c + "/" + x.k, null); return; }
            done[c] = x.seq;
            var a = parseJson(box[x.k]);
            if (a && !Core.apply(room.game, c, a)) dirty = true;
            set("in/" + c + "/" + x.k, null);
          });
      });
      if (dirty) writeGame(room.game, room.meta.no);
    }

    room.leave = function () {
      if (room.closed) return;
      room.closed = true;
      subs.forEach(function (u) { u(); });
      if (stopPresence) stopPresence();
      set("pl/" + cid, null);
    };

    // 房主不在了：在線者中最早加入的人接手（對局中也可以，手上有最新的 st）
    function maybeTakeHost() {
      if (!room.meta || room.hostOnline()) return;
      var first = room.list()[0];
      if (!first || first.cid !== cid) return;
      GS.rtTransaction(roomId, CLOUD, path("meta"), function (m) {
        if (!m || m.host !== room.meta.host) return;
        m.host = cid;
        return m;
      });
    }

    // 剛成為房主（接手）：開始處理 in/，並把對局的 hostCtrl 改成自己（「房主決定」「代打」的權限）
    function onBecomeHost() {
      if (!inSub) inSub = sub("in", hostProcess);
      if (room.game && room.meta.status === "play" && room.game.hostCtrl !== cid) {
        room.game.hostCtrl = cid;
        writeGame(room.game, room.meta.no);
      }
    }

    var inSub = null;
    function begin() {
      room.at = GS.serverNow();
      var first = true;
      sub("meta", function (v) {
        if (first) {
          first = false;
          if (!v && !creating) { room.missing = true; room.loaded = true; changed(); return; }
        }
        room.meta = v;
        room.loaded = !!v;
        // 只有房主訂閱 in/
        if (room.isHost()) onBecomeHost();
        maybeTakeHost();
        changed();
      });
      sub("on", function (v) { room.online = v || {}; maybeTakeHost(); changed(); });
      sub("pl", function (v) { room.players = v || {}; changed(); });
      sub("seat", function (v) {
        var s = [null, null, null, null];
        if (v) Object.keys(v).forEach(function (k) { var n = Number(k); if (n >= 0 && n < SEATS && v[k] && v[k].cid) s[n] = { cid: v[k].cid, cls: v[k].cls }; });
        room.seats = s;
        changed();
      });
      sub("st", function (v) {
        if (!v || typeof v.json !== "string") return;
        // 房主自己寫的不用再讀回來（避免覆蓋剛套用、還在路上的狀態）
        if (room.isHost() && room.game && Number(v.seq) <= room.gameSeq) return;
        var g = parseJson(v.json);
        if (!g) return;
        room.game = g;
        room.gameSeq = Math.max(room.gameSeq, Number(v.seq) || 0);
        changed();
      });
      stopPresence = GS.rtSetWithOnDisconnect(roomId, CLOUD, path("on/" + cid), true);
      pushMe();
    }

    if (creating) set("meta", { v: 1, host: cid, status: "lobby", no: 0 }).then(begin);
    else begin();

    return room;
  }

  function roomFromUrl(href) {
    var m = String(href || "").match(/[?&#]room=(g[0-9a-f]{32})/);
    return m ? m[1] : null;
  }

  window.PriTestFistNet = {
    open: open, roomFromUrl: roomFromUrl, validRoomId: function (id) { return ROOM_RE.test(String(id || "")); }
  };
})();
