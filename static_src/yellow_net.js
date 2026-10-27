// 黃牌 Yellow Card：連線房間（最多 4 人，各佔一個角落）。只負責 Firebase 協定；畫面在 yellow.js，規則在 yellow_core.js。
//
// 路徑：games/<roomId>/rtState/yc/...（沿用 game_storage.js 的 rtSet / rtSubscribe，database.rules.json 不用改）
//   meta            { v: 1, host: cid, status: "lobby" | "play", no: 對局編號 }
//   on/<cid>        true（onDisconnect 自動移除＝在線）
//   pl/<cid>        { name, at }
//   seat/<n>        { cid, cls } | null（大廳的座位，n＝0 左上、1 右上、2 左下、3 右下；一個人可以坐好幾個位置；cid＝"ai" 是 AI 隊友）
//   opt             { torment: 0～10, endless: bool, daily: bool }（房主在大廳設定的苦痛等級／無盡模式／每日挑戰）
//   chat/<key>      { c: cid, t: 文字, at }（房內聊天，房主只留最新 CHAT_MAX 則；不進對局狀態）
//   nudge/<cid>     { from: cid, at }（催促：寫給還沒結束回合的人；不進對局狀態）
//   fx/<cid>        { k: "ping" | "emo", x, y, e, s, at }（戰場標記與表情；不進對局狀態，只是畫面上的溝通）
//   st              { no, seq, json }（房主寫入的整局狀態）
//   in/<cid>/a<seq> 操作 JSON 字串（非房主送出；房主套用後刪除）
//
// 同步方式（房主為準）：回合制，所以不做預測——所有人只畫 st；
// 非房主的操作寫進 in/，房主依 seq 順序用 Core.apply(st, 送出者 cid, 操作) 套用，再把整份狀態寫回 st。
// 房主斷線時，在線者中最早加入的人接手房主（手上已有最新的 st，可以直接繼續）。
(function () {
  "use strict";

  var Core = window.PriTestYellowCore;
  var GS = window.PriTestGameStorage;
  if (!Core || !GS) return;

  var ROOM_RE = /^g[0-9a-f]{32}$/;
  var CLOUD = "cloud";
  var SEATS = 4;
  var AI_CID = "ai";
  var CHAT_MAX = 30, CHAT_LEN = 80;

  function newCid() {
    var b = new Uint8Array(8);
    try { window.crypto.getRandomValues(b); } catch (e) { for (var i = 0; i < 8; i++) b[i] = Math.floor(Math.random() * 256); }
    return "c" + Array.prototype.map.call(b, function (x) { return (x < 16 ? "0" : "") + x.toString(16); }).join("");
  }

  function parseJson(s) { try { return typeof s === "string" && s ? JSON.parse(s) : null; } catch (e) { return null; } }

  // opts：{ roomId?（沒有＝建立新房）, name, cid?（重新整理後沿用的身分）, onChange() }
  function open(opts) {
    var roomId = opts.roomId || GS.generateCloudGameId();
    var creating = !opts.roomId;
    var cid = /^c[0-9a-f]{16}$/.test(String(opts.cid || "")) ? opts.cid : newCid();
    var subs = [];
    var stopPresence = null;
    var lastSeq = Date.now();
    var done = {};         // 房主：cid → 已套用的最大 seq
    var room = {
      id: roomId, cid: cid, creating: creating,
      loaded: false, missing: false, closed: false,
      meta: null, online: {}, players: {}, seats: [null, null, null, null], opts: { torment: 0, endless: false, daily: false }, fx: {}, chats: [],
      game: null, gameSeq: 0, name: opts.name || ""
    };

    function changed() { if (!room.closed && opts.onChange) opts.onChange(); }
    function path(p) { return "yc/" + p; }
    function set(p, v) { return GS.rtSet(roomId, CLOUD, path(p), v); }
    function sub(p, fn) { var u = GS.rtSubscribe(roomId, CLOUD, path(p), fn); subs.push(u); return u; }

    room.isHost = function () { return !!room.meta && room.meta.host === cid; };
    // AI 隊友永遠算在線（由房主代為行動）
    room.isOnline = function (c) { return c === AI_CID || !!room.online[c]; };
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
    // ex：{ lv（自己的英雄等級）, art（出發遺物） }——局外進度存在各自的裝置，開局時由座位帶進對局
    room.takeSeat = function (n, cls, ex) {
      if (n < 0 || n >= SEATS || !room.meta || room.meta.status !== "lobby") return;
      GS.rtTransaction(roomId, CLOUD, path("seat/" + n), function (cur) {
        if (cur && cur.cid && cur.cid !== cid && cur.cid !== AI_CID && room.online[cur.cid]) return; // 別人坐著（AI 的位置可以直接換成真人）
        var out = { cid: cid, cls: cls };
        if (ex && typeof ex.lv === "number") out.lv = ex.lv;
        if (ex && ex.art) out.art = String(ex.art);
        return out;
      });
    };
    room.leaveSeat = function (n) {
      var s = room.seats[n];
      if (!s) return;
      // 自己的位置，或房主清掉離線者／AI 的位置
      if (s.cid === cid || (room.isHost() && !room.isOnline(s.cid)) || (room.isHost() && s.cid === AI_CID)) set("seat/" + n, null);
    };
    // 房主把空位（或離線者的位置）交給 AI 隊友
    room.setAiSeat = function (n, cls, lv) {
      if (!room.isHost() || n < 0 || n >= SEATS || !room.meta || room.meta.status !== "lobby") return;
      var cur = room.seats[n];
      if (cur && cur.cid !== AI_CID && room.online[cur.cid]) return;
      var seat = { cid: AI_CID, cls: cls };
      if (typeof lv === "number") seat.lv = lv;
      set("seat/" + n, seat);
    };
    // 房主設定苦痛等級／無盡模式
    room.setOpts = function (o) {
      if (!room.isHost() || !room.meta || room.meta.status !== "lobby") return;
      var torment = Math.max(0, Math.min(10, Math.floor(Number(o.torment) || 0)));
      set("opt", { torment: torment, endless: !!o.endless, daily: !!o.daily });
    };

    // 至少要有一位在線的真人
    room.canStart = function () {
      if (!room.isHost() || room.meta.status !== "lobby") return false;
      return room.seats.some(function (s) { return s && s.cid !== AI_CID && room.online[s.cid]; });
    };

    // 連線每日挑戰（2026-10-27）：在線的座位依大廳位置排成第 1～n 位，英雄依當天固定（座位只決定誰操作哪一位）
    room.dailyPlayers = function () { return room.seats.filter(function (x) { return x && room.isOnline(x.cid); }); };
    room.start = function (dateKey) {
      if (!room.canStart()) return;
      var st;
      if (room.opts.daily && dateKey) {
        var ps = room.dailyPlayers();
        st = Core.createDaily(dateKey, ps.length, ps.map(function (x) { return x.cid === AI_CID ? "" : room.nameOf(x.cid); }), ps.map(function (x) { return x.cid; }), cid);
      } else {
      var seats = room.seats.map(function (s) {
        if (!s || !room.isOnline(s.cid)) return null;
        return { cls: s.cls, ctrl: s.cid, name: s.cid === AI_CID ? "" : room.nameOf(s.cid), lv: s.lv, art: s.art };
      });
      st = Core.create({ seats: seats, hostCtrl: cid, torment: room.opts.torment, endless: room.opts.endless });
      }
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
        if (action && action.t === "claim" && !claimOk(cid, action.s)) return "cannot_claim";
        var err = Core.apply(room.game, cid, action);
        if (!err) writeGame(room.game, room.meta.no);
        return err;
      }
      lastSeq = Math.max(lastSeq + 1, Date.now());
      set("in/" + cid + "/a" + lastSeq, JSON.stringify(action));
      return null;
    };

    // AI 隊友的操作：只有房主送（其他人呼叫沒有作用）
    room.sendAi = function (action) {
      if (!room.isHost() || !room.game || !room.meta || room.meta.status !== "play") return "not_host";
      var err = Core.apply(room.game, AI_CID, action);
      if (!err) writeGame(room.game, room.meta.no);
      return err;
    };

    // 戰場標記／表情：寫在自己的 fx/<cid>，所有人訂閱；4 秒後畫面自己消失
    room.signal = function (sig) {
      var v = { k: sig.k === "emo" ? "emo" : "ping", at: GS.serverNow() };
      if (typeof sig.x === "number" && typeof sig.y === "number") { v.x = Math.round(sig.x * 10) / 10; v.y = Math.round(sig.y * 10) / 10; }
      if (typeof sig.s === "number") v.s = sig.s;
      if (typeof sig.u === "number") v.u = sig.u;
      if (sig.e) v.e = String(sig.e).slice(0, 4);
      set("fx/" + cid, v);
    };

    // 換裝置接回（2026-10-27）：原本的主人不在線，而且目前沒人在操作（離線）或是房主代打中；送出者要在線、不是 AI
    function claimOk(c, seat) {
      var h = room.game && room.game.heroes[seat];
      if (!h || c === AI_CID || !room.online[c] || h.owner === AI_CID || h.ctrl === AI_CID) return false;
      if (room.isOnline(h.owner) && h.owner !== c) return false;
      return !room.isOnline(h.ctrl) || h.ctrl === room.game.hostCtrl;
    }
    room.canClaim = function (seat) {
      var g = room.game;
      if (!g || g.heroes.some(function (x) { return x && x.ctrl === cid; })) return false;
      return claimOk(cid, seat);
    };

    // ---------------- 聊天與催促（2026-10-27；不進對局狀態） ----------------
    room.chat = function (text) {
      var tx = String(text || "").replace(/\s+/g, " ").trim().slice(0, CHAT_LEN);
      if (!tx) return;
      var at = GS.serverNow();
      set("chat/m" + at + cid.slice(-4), { c: cid, t: tx, at: at });
    };
    room.nudge = function (to) {
      if (!to || to === cid || to === AI_CID || !room.online[to]) return;
      set("nudge/" + to, { from: cid, at: GS.serverNow() });
    };
    function onChat(v) {
      var list = Object.keys(v || {}).map(function (k) { var m = v[k] || {}; return { k: k, c: String(m.c || ""), t: String(m.t || "").slice(0, CHAT_LEN), at: Number(m.at) || 0 }; })
        .filter(function (m) { return m.t; }).sort(function (a, b) { return a.at - b.at || (a.k < b.k ? -1 : 1); });
      // 房主清掉太舊的
      if (room.isHost() && list.length > CHAT_MAX) list.slice(0, list.length - CHAT_MAX).forEach(function (m) { set("chat/" + m.k, null); });
      room.chats = list.slice(-CHAT_MAX);
      if (opts.onChat) opts.onChat(room.chats);
    }

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
            if (a && a.t === "claim" && !claimOk(c, a.s)) a = null;
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
      sub("opt", function (v) { room.opts = { torment: v ? Math.max(0, Math.min(10, Number(v.torment) || 0)) : 0, endless: !!(v && v.endless), daily: !!(v && v.daily) }; changed(); });
      sub("fx", function (v) { room.fx = v || {}; if (opts.onSignal) opts.onSignal(room.fx); });
      sub("chat", onChat);
      sub("nudge/" + cid, function (v) { if (v && typeof v.at === "number" && opts.onNudge) opts.onNudge(v); });
      sub("seat", function (v) {
        var s = [null, null, null, null];
        if (v) Object.keys(v).forEach(function (k) {
          var n = Number(k), x = v[k];
          if (!(n >= 0 && n < SEATS && x && x.cid)) return;
          s[n] = { cid: x.cid, cls: x.cls };
          // 2026-10-27 修正：原本這裡只留 cid、cls，英雄等級與出發遺物沒有帶進對局
          if (typeof x.lv === "number") s[n].lv = x.lv;
          if (x.art) s[n].art = String(x.art);
        });
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

  window.PriTestYellowNet = {
    open: open, roomFromUrl: roomFromUrl, validRoomId: function (id) { return ROOM_RE.test(String(id || "")); }
  };
})();
