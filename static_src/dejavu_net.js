// DÉJÀ VU 山道下坡：多裝置連線（第十三批，使用者指定 2026-10-27）。
// 只負責 Firebase 房間協定與比賽同步；畫面在 dejavu.js，模擬在 dejavu_core.js。
//
// 路徑：games/<roomId>/rtState/dv/...（沿用 game_storage.js 的 rtSet / rtSubscribe，database.rules.json 不用改）
//   meta              { v: 1, host: cid, no: 比賽編號, status: "lobby" | "race" }
//   on/<cid>          true（onDisconnect 自動移除＝在線）
//   pl/<cid>          { name, spec: JSON 字串 | "", ready, watch, at }（每台裝置一位玩家；watch＝只觀戰）
//   cfg               JSON 字串（房主的比賽設定：路線、季節、模式、規則、方向、PI 上限、條件、CPU、速度…）
//   m/<no>            { seed, cars: JSON, cfg: JSON, cmds: JSON, replay, speed, startAt: 伺服器時刻 ms }
//   in<no>/<cid>/<k>  { car, style } | { car, card }（非房主玩家在比賽中下的指令，k 遞增）
//   s<no>             { seq, st: Core.snapshot(), ack: JSON { cid: 已套用到第幾個指令 } }
//   r<no>             { res: JSON（Core.results）, log: JSON（指令紀錄，Déjà vu 用） }
//   view              { no, seq, kind: "one" | "all" | "full" | "stop", h: JSON }（房主帶大家一起看的重播）
//
// 同步方式（房主為準）：大家用同一組設定＋seed 依伺服器時鐘各自模擬；別人下的指令先送到房主，
// 房主套用後約每秒寫一張比賽快照，其他裝置收到就換上快照、再追到現在的時刻（自己剛下、房主還沒收到的指令重新套用）。
(function () {
  "use strict";

  var Core = window.PriTestDejavuCore;
  var GS = window.PriTestGameStorage;
  if (!Core || !GS) return;

  var START_DELAY_MS = 4500;  // 開賽倒數（讓每台裝置都收到比賽資料）
  var SNAP_MS = 1000;         // 房主多久寫一次快照
  var SNAP_FAST_MS = 200;     // 收到別人的指令後，最快多久補寫一次（指令早點讓大家看到）
  var ROOM_RE = /^g[0-9a-f]{32}$/;
  var CLOUD = "cloud";

  function newCid() {
    var b = new Uint8Array(8);
    try { window.crypto.getRandomValues(b); } catch (e) { for (var i = 0; i < 8; i++) b[i] = Math.floor(Math.random() * 256); }
    return "c" + Array.prototype.map.call(b, function (x) { return (x < 16 ? "0" : "") + x.toString(16); }).join("");
  }
  function parseJson(s) { try { return typeof s === "string" && s ? JSON.parse(s) : null; } catch (e) { return null; } }

  // opts：{ roomId?（沒有＝建立新房）, name, spec, cfg?（建房時的設定）, onChange() }
  function open(opts) {
    var roomId = opts.roomId || GS.generateCloudGameId();
    var creating = !opts.roomId;
    var cid = newCid();
    var subs = [];
    var stopPresence = null;
    var room = {
      id: roomId, cid: cid, creating: creating,
      loaded: false, missing: false, closed: false,
      meta: null, online: {}, players: {}, cfg: opts.cfg || null, match: null, matchNo: 0, view: null,
      me: { name: opts.name || "", spec: opts.spec || null, ready: false, watch: false, at: 0 }
    };

    function changed() { if (!room.closed && opts.onChange) opts.onChange(); }
    function path(p) { return "dv/" + p; }
    function set(p, v) { return GS.rtSet(roomId, CLOUD, path(p), v); }
    function sub(p, fn) { var u = GS.rtSubscribe(roomId, CLOUD, path(p), fn); subs.push(u); return u; }

    room.isHost = function () { return !!room.meta && room.meta.host === cid; };
    room.hostOnline = function () { return !!room.meta && !!room.online[room.meta.host]; };

    // 在線的成員，依加入時間排序
    room.list = function () {
      return Object.keys(room.players).filter(function (k) { return room.online[k]; }).map(function (k) {
        var p = room.players[k] || {};
        return { cid: k, name: String(p.name || "").slice(0, 16), spec: parseJson(p.spec), ready: !!p.ready, watch: !!p.watch, at: Number(p.at) || 0 };
      }).sort(function (x, y) { return (x.at - y.at) || (x.cid < y.cid ? -1 : 1); });
    };
    // 會上場的玩家（有車、沒選觀戰）
    room.racers = function () { return room.list().filter(function (p) { return p.spec && !p.watch; }); };

    function pushMe() {
      var m = room.me;
      return set("pl/" + cid, { name: m.name || "", spec: m.spec ? JSON.stringify(m.spec) : "", ready: !!m.ready, watch: !!m.watch, at: m.at });
    }
    room.update = function (patch) {
      Object.keys(patch).forEach(function (k) { room.me[k] = patch[k]; });
      return pushMe();
    };

    // 房主改設定：整份覆寫（設定不大）
    room.setCfg = function (cfg) {
      if (!room.isHost()) return;
      var txt = JSON.stringify(cfg);
      if (txt === room._cfgTxt) return;
      room._cfgTxt = txt;
      room.cfg = cfg;
      set("cfg", txt);
    };

    // 房主開賽：大家都按了準備（觀戰的不用）
    room.canStart = function () {
      if (!room.isHost() || !room.meta || room.meta.status !== "lobby") return false;
      var rs = room.racers();
      return rs.length >= 1 && rs.every(function (p) { return p.ready; });
    };

    // m：{ seed, cars: [{ spec, name, color, cpu, cid }], cfg, cmds, replay, speed }
    room.start = function (m) {
      if (!room.isHost() || !room.meta) return;
      var no = (room.meta.no || 0) + 1;
      var prev = room.meta.no;
      set("m/" + no, {
        seed: m.seed, cars: JSON.stringify(m.cars), cfg: JSON.stringify(m.cfg), cmds: JSON.stringify(m.cmds || []),
        replay: !!m.replay, speed: m.speed || 1, startAt: GS.serverNow() + START_DELAY_MS
      }).then(function () {
        if (prev) ["m/", "in", "s", "r"].forEach(function (k) { set(k + prev, null); });
        return set("meta", { v: 1, host: cid, no: no, status: "race" });
      });
    };

    room.backToLobby = function () {
      if (!room.isHost() || !room.meta) return;
      set("meta", { v: 1, host: cid, no: room.meta.no, status: "lobby" });
    };

    // 房主帶大家一起看重播
    room.setView = function (kind, h) {
      if (!room.isHost() || !room.meta) return;
      room._viewSeq = (room._viewSeq || (room.view && room.view.seq) || 0) + 1;
      set("view", { no: room.meta.no, seq: room._viewSeq, kind: kind, h: h ? JSON.stringify(h) : "" });
    };

    room.leave = function () {
      if (room.closed) return;
      room.closed = true;
      subs.forEach(function (u) { u(); });
      if (room.ctl) room.ctl.dispose();
      if (stopPresence) stopPresence();
      set("pl/" + cid, null);
    };

    // 房主不在了（不在比賽中）：在線者中最早加入的人接手房主
    function maybeTakeHost() {
      if (!room.meta || room.meta.status === "race" || room.hostOnline()) return;
      var first = room.list()[0];
      if (!first || first.cid !== cid) return;
      GS.rtTransaction(roomId, CLOUD, path("meta"), function (m) {
        if (!m || m.host !== room.meta.host) return;
        m.host = cid;
        m.status = "lobby";
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
        var cars = parseJson(v.cars);
        if (!Array.isArray(cars)) return;
        room.match = {
          no: no, seed: Number(v.seed) | 0, cars: cars, cfg: parseJson(v.cfg) || {}, cmds: parseJson(v.cmds) || [],
          replay: !!v.replay, speed: Number(v.speed) || 1, startAt: Number(v.startAt) || 0
        };
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
      sub("cfg", function (v) { var c = parseJson(v); if (c) { room.cfg = c; room._cfgTxt = v; } changed(); });
      sub("view", function (v) {
        if (!v) return;
        room.view = { no: Number(v.no) || 0, seq: Number(v.seq) || 0, kind: String(v.kind || ""), h: parseJson(v.h) };
        changed();
      });
      stopPresence = GS.rtSetWithOnDisconnect(roomId, CLOUD, path("on/" + cid), true);
      pushMe();
    }

    if (creating) {
      var init = [set("meta", { v: 1, host: cid, no: 0, status: "lobby" })];
      if (room.cfg) { room._cfgTxt = JSON.stringify(room.cfg); init.push(set("cfg", room._cfgTxt)); }
      Promise.all(init).then(begin);
    } else begin();

    // ---------------- 比賽同步 ----------------
    // raceCtl(race)：畫面每一幀呼叫 ctl.sync(race)，回傳現在應該跑到第幾步；
    // 自己的指令用 ctl.command(race, car, style) / ctl.card(race, car, idx)；ctl.onRestore（畫面設定）在換上快照後呼叫
    room.raceCtl = function () {
      var m = room.match, no = m.no;
      var host = room.isHost();
      var mine = {};
      m.cars.forEach(function (c, i) { if (c.cid === cid) mine[i] = true; });
      var un = [];
      var latest = null, appliedSeq = 0, snapSeq = 0, lastSnap = 0, fastSnap = false, endSent = false, disposed = false;
      var inputs = {}, ack = {};       // 房主：收到的指令、各玩家已套用到第幾個
      var sent = [], sentK = 0;        // 非房主：自己送出、房主還沒確認的指令

      if (host) un.push(sub("in" + no, function (v) { inputs = v || {}; }));
      else {
        un.push(sub("s" + no, function (v) { if (v && typeof v.st === "string" && Number(v.seq) > appliedSeq) latest = v; }));
        un.push(sub("r" + no, function (v) {
          var res = v && parseJson(v.res);
          if (Array.isArray(res)) { ctl.result = { res: res, log: parseJson(v.log) || [] }; changed(); }
        }));
      }

      function applyCmd(race, cm) {
        if (cm.style) return Core.command(race, cm.car, cm.style);
        var c = race.cars[cm.car];
        var idx = c && c.hand ? c.hand.indexOf(cm.card) : -1;
        return idx >= 0 && Core.playCard(race, cm.car, idx, cm.card);
      }

      // 房主：把別人送來的指令照順序套用（只接受指揮自己的車）
      function takeInputs(race) {
        Object.keys(inputs).forEach(function (who) {
          var list = inputs[who] || {};
          var ks = Object.keys(list).map(Number).filter(function (k) { return k > (ack[who] || 0); }).sort(function (a, b) { return a - b; });
          ks.forEach(function (k) {
            var cm = list[k];
            ack[who] = k;
            var car = m.cars[cm && cm.car];
            if (!car || car.cid !== who) return;
            if (applyCmd(race, cm)) fastSnap = true;
          });
        });
      }

      var ctl = {
        no: no, isHost: host, startAt: m.startAt, speed: m.speed,
        result: null, onRestore: null,
        mine: function (id) { return !!mine[id]; },
        mineIds: function () { return Object.keys(mine).map(Number); },
        // 依伺服器時鐘，現在應該跑到第幾步（開賽前是負的秒數）
        clock: function () { return (GS.serverNow() - m.startAt) / 1000 * m.speed; },
        wait: function () { return (m.startAt - GS.serverNow()) / 1000; },
        sync: function (race) {
          if (disposed) return;
          if (host) {
            takeInputs(race);
            var now = Date.now();
            if (race.done) {
              if (!endSent) { endSent = true; set("s" + no, { seq: ++snapSeq, st: Core.snapshot(race), ack: JSON.stringify(ack) }); }
              return;
            }
            if (ctl.clock() > 0 && (now - lastSnap >= SNAP_MS || (fastSnap && now - lastSnap >= SNAP_FAST_MS))) {
              lastSnap = now; fastSnap = false;
              set("s" + no, { seq: ++snapSeq, st: Core.snapshot(race), ack: JSON.stringify(ack) });
            }
            return;
          }
          // 非房主：比賽在本機已經結束就不再換快照（結果以房主寫的 r<no> 為準）
          if (!latest || race.done) return;
          var v = latest; latest = null;
          appliedSeq = Number(v.seq);
          if (!Core.restore(race, v.st)) return;
          var a = (parseJson(v.ack) || {})[cid] || 0;
          sent = sent.filter(function (s) { return s.k > a; });
          sent.forEach(function (s) { applyCmd(race, s.cm); });
          if (ctl.onRestore) ctl.onRestore();
        },
        // 自己的指令：本機馬上套用；非房主同時送給房主
        send: function (race, cm) {
          if (!mine[cm.car] || !applyCmd(race, cm)) return false;
          if (!host) {
            var k = ++sentK;
            sent.push({ k: k, cm: cm });
            set("in" + no + "/" + cid + "/" + k, cm);
          } else fastSnap = true;
          return true;
        },
        // 房主：比賽結束寫結果
        finish: function (res, log) {
          if (!host || disposed) return;
          set("r" + no, { res: JSON.stringify(res), log: JSON.stringify(log || []) });
        },
        hostGone: function () { return !host && room.meta && !room.hostOnline(); },
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

  window.PriTestDejavuNet = {
    START_DELAY_MS: START_DELAY_MS,
    open: open, roomFromUrl: roomFromUrl, validRoomId: function (id) { return ROOM_RE.test(String(id || "")); }
  };
})();
