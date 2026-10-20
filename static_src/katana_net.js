// 神前鍛刀對決：連線對刀（使用者指定 2026-10-20，最多 8 把刀）。
// 只負責 Firebase 房間協定與每回合的同步；畫面在 katana.js，模擬在 katana_arena.js。
//
// 路徑：games/<roomId>/rtState/kt/...（沿用 game_storage.js 的 rtSet / rtSubscribe，database.rules.json 不用改）
//   meta              { v: 1, host: cid, no: 對局編號, status: "lobby" | "play" }
//   on/<cid>          true（onDisconnect 自動移除＝在線）
//   pl/<cid>          { name, snap: JSON 字串 | "", ready, at }
//   npc               { <npcId>: true }（房主加入的 AI 對手刀）
//   m/<no>            { seed, fighters: JSON 字串, startAt: 伺服器時刻 ms }
//   in<no>/<r>/<cid>  { <fid>: "uid,uid" | "" }（各玩家第 r 回合放的牌）
//   s<no>             { r, st: Arena.serialize(), end }（房主在每個回合交界寫的整份狀態）
//
// 同步方式（房主為準）：大家用同一個 seed 各自模擬；到回合交界（招式只在交界發動）時，
// 房主收齊各玩家這回合的出牌（最多等 LOCK_WAIT_MS），套用後把整份狀態寫進 s<no>；
// 其他人停在交界等這份狀態，收到後直接換上再繼續。每回合重新對齊，不同瀏覽器的浮點誤差不會累積。
(function () {
  "use strict";

  var Arena = window.PriTestKatanaArena;
  var GS = window.PriTestGameStorage;
  if (!Arena || !GS) return;

  var MAX_FIGHTERS = 8;
  var LOCK_WAIT_MS = 1500;   // 房主在交界最多等其他玩家的出牌多久
  var LOCK_LEAD_S = 0.25;    // 交界前這段時間放的牌算下一回合（讓出牌提早送到房主）
  var START_DELAY_MS = 3500; // 開打倒數
  var ROOM_RE = /^g[0-9a-f]{32}$/;
  var CLOUD = "cloud";

  function newCid() {
    var b = new Uint8Array(8);
    try { window.crypto.getRandomValues(b); } catch (e) { for (var i = 0; i < 8; i++) b[i] = Math.floor(Math.random() * 256); }
    return "c" + Array.prototype.map.call(b, function (x) { return (x < 16 ? "0" : "") + x.toString(16); }).join("");
  }

  function parseJson(s) { try { return typeof s === "string" && s ? JSON.parse(s) : null; } catch (e) { return null; } }

  // ---------------- 房間 ----------------
  // opts：{ roomId?（沒有＝建立新房）, name, snap?, onChange() }
  function open(opts) {
    var roomId = opts.roomId || GS.generateCloudGameId();
    var creating = !opts.roomId;
    var cid = newCid();
    var subs = [];
    var stopPresence = null;
    var room = {
      id: roomId, cid: cid, creating: creating,
      loaded: false, missing: false, closed: false,
      meta: null, online: {}, players: {}, npc: {}, match: null, matchNo: 0,
      me: { name: opts.name || "", snap: opts.snap || null, ready: false, at: 0 }
    };

    function changed() { if (!room.closed && opts.onChange) opts.onChange(); }
    function path(p) { return "kt/" + p; }
    function set(p, v) { return GS.rtSet(roomId, CLOUD, path(p), v); }
    function sub(p, fn) { var u = GS.rtSubscribe(roomId, CLOUD, path(p), fn); subs.push(u); return u; }

    room.isHost = function () { return !!room.meta && room.meta.host === cid; };
    room.hostOnline = function () { return !!room.meta && !!room.online[room.meta.host]; };

    // 在線且資料完整的玩家，依加入時間排序
    room.list = function () {
      return Object.keys(room.players).filter(function (k) { return room.online[k]; }).map(function (k) {
        var p = room.players[k] || {};
        return { cid: k, name: String(p.name || "").slice(0, 16), snap: parseJson(p.snap), ready: !!p.ready, at: Number(p.at) || 0 };
      }).sort(function (x, y) { return (x.at - y.at) || (x.cid < y.cid ? -1 : 1); });
    };

    room.npcIds = function () { return Object.keys(room.npc || {}).filter(function (k) { return room.npc[k]; }); };

    room.fighterCount = function () {
      return room.list().filter(function (p) { return p.snap; }).length + room.npcIds().length;
    };

    // 自己還沒選刀、其他人＋AI 已經 8 把時不能再出戰（只能觀戰）
    room.full = function () {
      if (room.me.snap) return false;
      return room.list().filter(function (p) { return p.snap && p.cid !== cid; }).length + room.npcIds().length >= MAX_FIGHTERS;
    };

    function pushMe() {
      return set("pl/" + cid, { name: room.me.name || "", snap: room.me.snap ? JSON.stringify(room.me.snap) : "", ready: !!room.me.ready, at: room.me.at });
    }

    room.update = function (patch) {
      Object.keys(patch).forEach(function (k) { room.me[k] = patch[k]; });
      if (!room.me.snap) room.me.ready = false;
      return pushMe();
    };

    room.setNpc = function (id, on) {
      if (!room.isHost()) return;
      var n = {};
      Object.keys(room.npc || {}).forEach(function (k) { if (room.npc[k]) n[k] = true; });
      if (on) n[id] = true; else delete n[id];
      room.npc = n;
      set("npc", n);
    };

    // 房主開打：在線且選好刀、按了準備的玩家＋AI 對手刀
    room.canStart = function () {
      if (!room.isHost() || room.meta.status !== "lobby") return false;
      var ps = room.list();
      if (ps.some(function (p) { return p.snap && !p.ready; })) return false;
      var n = room.fighterCount();
      return n >= 2 && n <= MAX_FIGHTERS;
    };

    // npcSnap(id)／npcName(id)／anonName(n)：畫面提供（資料與多語系文字在 katana.js 那邊）
    room.start = function (npcSnap, npcName, anonName) {
      if (!room.canStart()) return;
      var fighters = [];
      room.list().forEach(function (p) {
        if (!p.snap) return;
        var nm = p.name || String(p.snap.smith || "").slice(0, 16) || anonName(fighters.length + 1);
        fighters.push({ id: "p" + fighters.length, cid: p.cid, name: nm, human: true, snap: p.snap });
      });
      room.npcIds().forEach(function (id) {
        var s = npcSnap(id);
        if (s && fighters.length < MAX_FIGHTERS) fighters.push({ id: "npc-" + id, cid: null, name: npcName(id), human: false, snap: s });
      });
      var no = (room.meta.no || 0) + 1;
      var seed = newCid() + Date.now();
      set("m/" + no, { seed: seed, fighters: JSON.stringify(fighters), startAt: GS.serverNow() + START_DELAY_MS }).then(function () {
        if (no > 1) { set("m/" + (no - 1), null); set("in" + (no - 1), null); set("s" + (no - 1), null); }
        return set("meta", { v: 1, host: cid, no: no, status: "play" });
      });
    };

    room.backToLobby = function () {
      if (!room.isHost() || !room.meta) return;
      set("meta", { v: 1, host: cid, no: room.meta.no, status: "lobby" });
    };

    room.leave = function () {
      if (room.closed) return;
      room.closed = true;
      subs.forEach(function (u) { u(); });
      if (room.ctl) room.ctl.dispose();
      if (stopPresence) stopPresence();
      set("pl/" + cid, null);
    };

    // 房主不在了（大廳中）：在線者中最早加入的人接手房主
    function maybeTakeHost() {
      if (!room.meta || room.meta.status !== "lobby" || room.hostOnline()) return;
      var first = room.list()[0];
      if (!first || first.cid !== cid) return;
      GS.rtTransaction(roomId, CLOUD, path("meta"), function (m) {
        if (!m || m.host !== room.meta.host) return; // 已經有人改過
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
        var fs = parseJson(v.fighters);
        if (!Array.isArray(fs)) return;
        room.match = { no: no, seed: String(v.seed), fighters: fs, startAt: Number(v.startAt) || 0 };
        changed();
      });
    }

    // 開始連線
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
      sub("npc", function (v) { room.npc = v || {}; changed(); });
      stopPresence = GS.rtSetWithOnDisconnect(roomId, CLOUD, path("on/" + cid), true);
      pushMe();
    }

    if (creating) {
      set("meta", { v: 1, host: cid, no: 0, status: "lobby" }).then(begin);
    } else begin();

    // ---------------- 對局同步 ----------------
    // 回傳控制器給畫面：canStep(a) 在每次 Arena.step 前呼叫；pick() 放牌；
    // ctl.onRestore（畫面設定）在換上房主狀態後呼叫；ctl.ended＝已收到房主的結束狀態
    room.matchCtl = function () {
      var m = room.match, no = m.no;
      var host = room.isHost();
      var inputs = {};        // 房主：r → cid → { fid: "uid,uid" }
      var pending = {};       // r → fid → [uid]
      var locked = {};        // r → true（自己這回合的牌已送出）
      var latest = null;      // 非房主：最新收到的 s<no>
      var appliedSeq = -1;
      var waitStart = 0, endSent = false, disposed = false;
      var mySet = {};
      m.fighters.forEach(function (f) { if (f.cid === cid) mySet[f.id] = true; });
      var un = [];
      if (host) un.push(sub("in" + no, function (v) { inputs = v || {}; }));
      else un.push(sub("s" + no, function (v) { if (v && typeof v.st === "string") latest = v; }));

      function boundaryTime(a) { return a.round * Arena.ROUND_S; }
      function openRound(a) { return locked[a.round] ? a.round + 1 : a.round; }

      function lock(a, r) {
        if (locked[r]) return;
        locked[r] = true;
        if (host) return;
        var out = { _: 1 }; // Firebase 不存空物件
        Object.keys(pending[r] || {}).forEach(function (fid) { out[fid] = pending[r][fid].join(","); });
        set("in" + no + "/" + r + "/" + cid, out);
      }

      function sendState(a, end) {
        set("s" + no, { r: a.round, st: Arena.serialize(a), end: !!end, seq: (a.round * 2) + (end ? 1 : 0) });
      }

      function applyLatest(a) {
        var seq = Number(latest.seq);
        if (seq <= appliedSeq) return false;
        appliedSeq = seq;
        Arena.restore(a, latest.st);
        if (latest.end) ctl.ended = true;
        Object.keys(pending).forEach(function (r) { if (Number(r) <= a.round) delete pending[r]; });
        if (ctl.onRestore) ctl.onRestore();
        return true;
      }

      var ctl = {
        no: no,
        isHost: host,
        mine: function (fid) { return !!mySet[fid]; },
        startIn: function () { return Math.max(0, m.startAt - GS.serverNow()); },
        waiting: null,  // null | "players" | "host"
        hostGone: false,
        ended: false,
        onRestore: null,
        pending: function (fid) {
          var out = [];
          Object.keys(pending).forEach(function (r) { (pending[r][fid] || []).forEach(function (u) { out.push(u); }); });
          return out;
        },
        // 放牌：先記在 pending，回合交界才真正進等待區（房主套用、大家同步）
        pick: function (a, fid, uid) {
          var f = null;
          a.fighters.forEach(function (x) { if (x.id === fid) f = x; });
          if (!f || !mySet[fid] || !f.alive || a.over) return false;
          var all = ctl.pending(fid);
          if (all.indexOf(uid) >= 0 || f.queue.length + all.length >= Arena.QUEUE) return false;
          if (uid === "special" && (!f.special || f.specialUsed)) return false;
          var r = openRound(a);
          pending[r] = pending[r] || {};
          (pending[r][fid] = pending[r][fid] || []).push(uid);
          return true;
        },
        canStep: function (a) {
          if (disposed) return false;
          if (ctl.startIn() > 0) return false;
          if (!host && room.meta && !room.hostOnline()) { ctl.hostGone = true; ctl.waiting = "host"; return false; }
          if (host) {
            if (a.over) { if (!endSent) { endSent = true; sendState(a, true); } return false; }
            if (a.time + Arena.DT >= boundaryTime(a) - LOCK_LEAD_S) lock(a, a.round);
            if (!Arena.atBoundary(a)) { ctl.waiting = null; return true; }
            var now = Date.now();
            if (!waitStart) waitStart = now;
            var got = inputs[a.round] || {};
            var need = a.fighters.filter(function (f) { return f.human && f.alive && f.cid && f.cid !== cid && room.online[f.cid]; });
            var all = need.every(function (f) { return !!got[f.cid]; });
            if (!all && now - waitStart < LOCK_WAIT_MS) { ctl.waiting = "players"; return false; }
            // 離線的玩家改由 AI 接手（寫進狀態，大家看到的一致）
            a.fighters.forEach(function (f) { if (f.human && f.cid && f.cid !== cid && !room.online[f.cid]) { f.human = false; a.ver++; } });
            a.fighters.forEach(function (f) {
              var list;
              if (f.cid === cid) list = (pending[a.round] || {})[f.id] || [];
              else if (f.human && got[f.cid] && typeof got[f.cid][f.id] === "string") list = got[f.cid][f.id] ? got[f.cid][f.id].split(",") : [];
              else list = [];
              list.forEach(function (u) { Arena.queueCard(a, f.id, u); });
            });
            delete pending[a.round];
            sendState(a, false);
            waitStart = 0;
            ctl.waiting = null;
            return true;
          }
          // 非房主
          if (latest && latest.end) { applyLatest(a); return false; }
          if (a.over || Arena.atBoundary(a)) {
            if (!a.over) lock(a, a.round);
            if (latest && Number(latest.r) >= a.round && applyLatest(a)) { ctl.waiting = null; return !a.over; }
            ctl.waiting = "host";
            return false;
          }
          if (a.time + Arena.DT >= boundaryTime(a) - LOCK_LEAD_S) lock(a, a.round);
          ctl.waiting = null;
          return true;
        },
        dispose: function () { disposed = true; un.forEach(function (u) { u(); }); if (room.ctl === ctl) room.ctl = null; }
      };
      if (room.ctl) room.ctl.dispose();
      room.ctl = ctl;
      return ctl;
    };

    return room;
  }

  function roomFromUrl(href) {
    var m = String(href || "").match(/[?&#]room=(g[0-9a-f]{32})/);
    return m ? m[1] : null;
  }

  window.PriTestKatanaNet = {
    MAX_FIGHTERS: MAX_FIGHTERS, LOCK_WAIT_MS: LOCK_WAIT_MS,
    open: open, roomFromUrl: roomFromUrl, validRoomId: function (id) { return ROOM_RE.test(String(id || "")); }
  };
})();
