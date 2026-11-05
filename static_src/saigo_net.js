// 賽狗賽狗（saigo）：多裝置連線。只負責 Firebase 房間協定；畫面在 saigo.js，模擬在 saigo_core.js。
//
// 路徑：games/<roomId>/rtState/sg/...（沿用 game_storage.js 的 rtSet / rtSubscribe，database.rules.json 不用改）
//   meta          { v: 1, host: cid, no: 場次編號, status: "lobby" | "card" | "race" }
//   on/<cid>      true（onDisconnect 自動移除＝在線）
//   pl/<cid>      { name, entry: JSON 字串 | ""（要派出賽的狗）, entries: JSON 陣列字串（真賽狗：可派好幾隻）, ready, no（ready 對應的場次）, at }
//   cfg           JSON 字串（房主的設定：賽事等級）
//   m/<no>        { card: JSON（出賽表，含 seed）, startAt: 伺服器時刻 ms（0＝還在下注） }
//   m/<no>/bets/<pid>  JSON { type: { combo: 金額 } }（彩池制：每個人目前的下注）
//   m/<no>/pool   JSON { base, h: 合計 }（彩池制：房主開跑時鎖定的彩池，大家用它算最終賠率）
//   m/<no>/cmd/<pid>   JSON [{ k: 第幾步生效, d: 枠, s: 跑法 }]（比賽中改跑法：每個人自己的狗的指令）
//   jp            { amt: 累積彩金, no: 已結算到第幾場, last: { no, pot, win: [{ pid, name, pay }] } }
//   bank          { start: 起始籌碼, ver: 重置次數 }（管理面板設定）
//   bal/<pid>     { c: 籌碼, ver, name }（房間籌碼；pid 存在 localStorage，重新整理／重進房間也還是同一份）
//   w5            { ser: 第幾輪, leg: 目前第幾場, res: { 場: 冠軍枠 }, carry: 累積, last: { ser, pot, win: [{ pid, name, pay }] } }（WIN5，房主寫）
//   w5p/<pid>     JSON { ser, picks: { 場: 枠 } }（WIN5：買了這一輪的人自己寫自己的選擇）
//   cup           JSON（冠軍大會的狀態，saigo_cup.js 的 start／advance；房主寫）
//
// 同步方式：出賽表（含 seed）一旦發佈，每台裝置自己跑同一個確定性模擬，
// 依伺服器時鐘（startAt）播放，所以結果完全一樣，只是各自看不同的鏡頭。
// 唯一的即時指令是「比賽中改跑法」（m/<no>/cmd）：指令記的是「第幾步生效」且比送出時晚 CMD_LEAD_S 秒，
// 各裝置收到後用同一份指令從頭重新模擬，生效前的每一步都和原本一樣，所以畫面不會跳、結果也一致。
// 下注用房間籌碼（bal）：各自的裝置扣款／派彩，管理面板可以改任何人的籌碼，一律用 transaction 避免互相覆蓋。
(function () {
  "use strict";

  var GS = window.PriTestGameStorage;
  if (!GS) return;

  var START_DELAY_MS = 5000;
  var CMD_LEAD_S = 1.5;
  var CMD_MAX = 64;   // 每人每場的指令上限（改跑法＋喊聲，可能有好幾隻狗）
  var ROOM_RE = /^g[0-9a-f]{32}$/;
  var CLOUD = "cloud";
  var PID_KEY = "pritest-saigo-pid";
  var DEFAULT_START = 10000;

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

  // opts：{ roomId?（沒有＝建立新房）, name, cfg?, onChange() }
  function open(opts) {
    var roomId = opts.roomId || GS.generateCloudGameId();
    var creating = !opts.roomId;
    var cid = newCid();
    var subs = [];
    var stopPresence = null;
    var room = {
      id: roomId, cid: cid, pid: myPid(), creating: creating,
      bank: null, bal: {}, balLoaded: false, jp: null, w5: null, w5p: {}, cup: null,
      loaded: false, missing: false, closed: false,
      meta: null, online: {}, players: {}, cfg: opts.cfg || { cls: "open" }, match: null, matchNo: 0,
      me: { name: opts.name || "", entry: null, entries: [], ready: false, no: 0, at: 0 }
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
        var es = parseJson(p.entries);
        return { cid: k, pid: String(p.pid || ""), name: String(p.name || "").slice(0, 16), entry: parseJson(p.entry), entries: Array.isArray(es) ? es.slice(0, 6) : [], ready: !!p.ready && Number(p.no) === (room.meta && room.meta.no), at: Number(p.at) || 0 };
      }).sort(function (x, y) { return (x.at - y.at) || (x.cid < y.cid ? -1 : 1); });
    };

    function pushMe() {
      var m = room.me;
      return set("pl/" + cid, { pid: room.pid, name: m.name || "", entry: m.entry ? JSON.stringify(m.entry) : "", entries: m.entries && m.entries.length ? JSON.stringify(m.entries) : "", ready: !!m.ready, no: m.no || 0, at: m.at });
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
    // 彩池制：把自己目前的下注寫進房間
    room.pushBets = function (pool) {
      if (!room.match || room.match.startAt) return;
      set("m/" + room.match.no + "/bets/" + room.pid, JSON.stringify(pool || {}));
    };
    // 彩池的虛擬規模：起始籌碼的 30%（至少 2000）
    room.poolBase = function () { return Math.max(2000, Math.round(room.bankCfg().start * 0.3)); };
    room.livePool = function () {
      var m = room.match;
      if (!m) return {};
      return window.PriTestSaigoBet.mergePools(Object.keys(m.bets || {}).map(function (k) { return m.bets[k]; }));
    };
    // 房主開跑（彩池制先鎖定彩池）
    room.start = function () {
      if (!room.isHost() || !room.meta || !room.match) return;
      var no = room.meta.no, card = room.match.card;
      var lock = card && card.pm ? set("m/" + no + "/pool", JSON.stringify({ base: room.poolBase(), h: room.livePool() })) : Promise.resolve();
      lock.then(function () { return set("m/" + no + "/startAt", GS.serverNow() + START_DELAY_MS); }).then(function () {
        return set("meta", { v: 1, host: cid, no: no, status: "race" });
      });
    };
    // 比賽中改跑法：把自己全部的指令寫進房間（覆寫，指令最多幾筆）
    room.pushCmds = function (list) {
      if (!room.match || !room.match.startAt) return;
      set("m/" + room.match.no + "/cmd/" + room.pid, JSON.stringify((list || []).slice(0, CMD_MAX)));
    };
    // 全房間的指令（攤平）
    room.cmds = function () {
      var m = room.match, out = [];
      if (!m) return out;
      Object.keys(m.cmds || {}).forEach(function (pid) { (m.cmds[pid] || []).slice(0, CMD_MAX).forEach(function (c) { out.push(c); }); });
      return out;
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

    // ---- 房間籌碼 ----
    room.bankCfg = function () { return room.bank || { start: DEFAULT_START, ver: 1 }; };
    function fresh(v) { return !!v && typeof v === "object" && v.ver === room.bankCfg().ver && isFinite(v.c); }
    // 某人的籌碼（還沒建立／重置過的＝起始籌碼）
    room.coinsOf = function (pid) { var v = room.bal[pid]; return fresh(v) ? Math.max(0, Math.round(v.c)) : room.bankCfg().start; };
    room.coins = function () { return room.coinsOf(room.pid); };
    // 所有有籌碼紀錄或在線的人：[{ pid, name, coins, online }]，籌碼多的在前
    room.ledger = function () {
      var rows = {}, on = {};
      room.list().forEach(function (p) { if (p.pid) { on[p.pid] = 1; rows[p.pid] = { pid: p.pid, name: p.name }; } });
      Object.keys(room.bal).forEach(function (pid) {
        var v = room.bal[pid] || {};
        if (!rows[pid]) rows[pid] = { pid: pid, name: String(v.name || "").slice(0, 16) };
      });
      return Object.keys(rows).map(function (pid) {
        var r = rows[pid]; r.coins = room.coinsOf(pid); r.online = !!on[pid]; return r;
      }).sort(function (a, b) { return (b.coins - a.coins) || (a.pid < b.pid ? -1 : 1); });
    };
    function nameOf(pid) {
      if (pid === room.pid) return room.me.name || "";
      var p = room.list().filter(function (x) { return x.pid === pid; })[0];
      return p ? p.name : null;
    }
    // fn(目前籌碼) → 新籌碼；回傳 undefined＝放棄（例如餘額不足）。結果 promise：新紀錄或 null（沒寫入）
    function balTx(pid, fn) {
      if (!/^p[0-9a-f]{16}$/.test(pid)) return Promise.resolve(null);
      var nm = nameOf(pid);
      return GS.rtTransaction(roomId, CLOUD, path("bal/" + pid), function (v) {
        var cfg = room.bankCfg(), cur = fresh(v) ? v.c : cfg.start;
        var n = fn(cur);
        if (n === undefined) return;
        return { c: Math.max(0, Math.round(n)), ver: cfg.ver, name: nm !== null ? nm : String((v && v.name) || "") };
      });
    }
    // 加減籌碼；delta < 0 且餘額不足時：floor＝扣到 0 為止，否則整筆放棄
    room.addCoins = function (pid, delta, floor) {
      return balTx(pid, function (c) { if (c + delta < 0 && !floor) return; return c + delta; });
    };
    room.setCoins = function (pid, n) { return balTx(pid, function () { return n; }); };
    // 管理面板：設定起始籌碼；reset＝全部人的籌碼重置成起始籌碼（ver + 1，離線的人重進房間也會是新的）
    room.setBank = function (start, reset) {
      var cfg = room.bankCfg(), nb = { start: Math.max(0, Math.round(start)), ver: cfg.ver + (reset ? 1 : 0) };
      return set("bank", nb).then(function () {
        room.bank = nb;
        if (!reset) return;
        return Promise.all(room.ledger().map(function (r) { return room.setCoins(r.pid, nb.start); }));
      });
    };
    // 累積彩金：房主在比賽結束時結算一次（jp.no 防止重複）；三連單押中的人依押中金額平分
    room.jpAmt = function () { return room.jp && isFinite(room.jp.amt) ? room.jp.amt : window.PriTestSaigoBet.JP_SEED; };
    room.settleJackpot = function (no, order) {
      var m = room.match, Bet = window.PriTestSaigoBet;
      if (!room.isHost() || !m || m.no !== no) return Promise.resolve(null);
      var win = order.slice(0, 3).join("-"), total = 0, stakes = {}, names = {};
      Object.keys(m.bets || {}).forEach(function (pid) {
        var b = m.bets[pid];
        total += Bet.poolTotal(b);
        var s = b.trifecta && Number(b.trifecta[win]) || 0;
        if (s > 0) stakes[pid] = s;
      });
      room.ledger().forEach(function (r) { names[r.pid] = r.name; });
      return GS.rtTransaction(roomId, CLOUD, path("jp"), function (v) {
        v = v || { amt: Bet.JP_SEED, no: 0 };
        if ((v.no || 0) >= no) return;
        var st = Bet.jackpotStep(Number(v.amt), total, stakes);
        return { amt: st.amt, no: no, last: { no: no, pot: st.pot, win: Object.keys(st.pays).map(function (pid) { return { pid: pid, name: names[pid] || "", pay: st.pays[pid] }; }) } };
      }).then(function (v) {
        if (v && v.last && v.last.no === no) (v.last.win || []).forEach(function (w) { room.addCoins(w.pid, w.pay); });
        return v;
      });
    };

    // ---- WIN5（2026-11-05）----
    function Cup() { return window.PriTestSaigoCup; }
    room.w5Buyers = function (ser) {
      var out = {};
      Object.keys(room.w5p || {}).forEach(function (pid) { var x = room.w5p[pid]; if (x && x.ser === ser) out[pid] = x; });
      return out;
    };
    room.w5Mine = function (ser) { var x = room.w5p[room.pid]; return x && x.ser === ser ? x : null; };
    // 這一輪目前的彩池（累積＋買入 × 回收率）
    room.w5Pot = function (ser) {
      var w = room.w5 || {}, carry = w.ser === ser || !w.ser ? (w.carry || 0) : 0;
      return carry + Math.floor(Object.keys(room.w5Buyers(ser)).length * Cup().W5_COST * Cup().W5_TAKE);
    };
    // 房主發佈出賽表前：決定這張是第幾輪第幾場（寫進 w5）
    room.w5Leg = function () {
      if (!room.isHost()) return Promise.resolve(null);
      var nl = null;
      return GS.rtTransaction(roomId, CLOUD, path("w5"), function (v) {
        nl = Cup().w5NextLeg(v);
        var o = v ? JSON.parse(JSON.stringify(v)) : { carry: 0 };
        o.ser = nl.ser; o.leg = nl.leg;
        if (nl.fresh) o.res = {};
        if (!o.res) o.res = {};
        if (!isFinite(o.carry)) o.carry = 0;
        return o;
      }).then(function (v) { return v ? { ser: v.ser, leg: v.leg } : null; });
    };
    // 買這一輪（第 1 場開跑前）：扣房間籌碼成功才登記
    room.w5Buy = function (ser) {
      if (room.w5Mine(ser)) return Promise.resolve(true);
      return room.addCoins(room.pid, -Cup().W5_COST).then(function (v) {
        if (!v) return false;
        var x = { ser: ser, picks: {} };
        room.w5p[room.pid] = x;
        return set("w5p/" + room.pid, JSON.stringify(x)).then(function () { return true; });
      });
    };
    room.w5Pick = function (ser, leg, gate) {
      var x = room.w5Mine(ser);
      if (!x) return Promise.resolve(false);
      x.picks = x.picks || {};
      x.picks[leg] = gate;
      return set("w5p/" + room.pid, JSON.stringify(x));
    };
    // 房主：一場跑完記下冠軍；第 5 場跑完就結算（全中的人平分彩池，沒人中就累積到下一輪）
    room.w5Result = function (ser, leg, gate) {
      if (!room.isHost()) return Promise.resolve(null);
      var names = {}, buyers = room.w5Buyers(ser);
      room.ledger().forEach(function (r) { names[r.pid] = r.name; });
      return GS.rtTransaction(roomId, CLOUD, path("w5"), function (v) {
        if (!v || v.ser !== ser) return;
        v.res = v.res || {};
        if (v.res[leg] !== undefined && v.res[leg] !== null) return;
        v.res[leg] = gate;
        if (leg >= Cup().W5_LEGS) {
          var st = Cup().w5Settle(buyers, v.res, v.carry || 0);
          v.carry = st.carry;
          v.last = { ser: ser, pot: st.pot, n: Object.keys(buyers).length, win: st.winners.map(function (pid) { return { pid: pid, name: names[pid] || "", pay: st.pay }; }) };
        }
        return v;
      }).then(function (v) {
        if (v && v.last && v.last.ser === ser && leg >= Cup().W5_LEGS && v.res && v.res[leg] === gate) (v.last.win || []).forEach(function (w) { room.addCoins(w.pid, w.pay); });
        return v;
      });
    };

    // ---- 冠軍大會（2026-11-05）----
    room.cupSet = function (state) {
      if (!room.isHost()) return Promise.resolve();
      room.cup = state;
      return set("cup", state ? JSON.stringify(state) : null);
    };
    // 房主：這一關跑完就晉級（stage 對得上才寫，避免重複）
    room.cupAdvance = function (card, order) {
      if (!room.isHost() || !card.cup) return Promise.resolve(null);
      return GS.rtTransaction(roomId, CLOUD, path("cup"), function (v) {
        var cur = parseJson(v);
        if (!cur || cur.id !== card.cup.id || cur.stage !== card.cup.stage) return;
        return JSON.stringify(Cup().advance(cur, card, order));
      });
    };

    // 自己的籌碼紀錄不存在或過期（被重置）時建立
    function ensureBal() {
      if (!room.balLoaded || room.bank === null || fresh(room.bal[room.pid])) return;
      balTx(room.pid, function (c) { return c; });
    }

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
        var bets = {};
        Object.keys(v.bets || {}).forEach(function (pid) { var b = parseJson(v.bets[pid]); if (b) bets[pid] = b; });
        var cmds = {};
        Object.keys(v.cmd || {}).forEach(function (pid) { var c = parseJson(v.cmd[pid]); if (Array.isArray(c)) cmds[pid] = c; });
        room.match = { no: no, card: same ? room.match.card : card, startAt: Number(v.startAt) || 0, bets: bets, pool: parseJson(v.pool), cmds: cmds };
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
      sub("bank", function (v) { room.bank = v && isFinite(v.start) ? { start: Number(v.start), ver: Number(v.ver) || 1 } : { start: DEFAULT_START, ver: 1 }; ensureBal(); changed(); });
      sub("jp", function (v) { room.jp = v || null; changed(); });
      sub("w5", function (v) { room.w5 = v || null; changed(); });
      sub("w5p", function (v) {
        var o = {};
        Object.keys(v || {}).forEach(function (pid) { var x = parseJson(v[pid]); if (x && isFinite(x.ser)) o[pid] = x; });
        room.w5p = o; changed();
      });
      sub("cup", function (v) { room.cup = parseJson(v); changed(); });
      sub("bal", function (v) { room.bal = v || {}; room.balLoaded = true; ensureBal(); changed(); });
      stopPresence = GS.rtSetWithOnDisconnect(roomId, CLOUD, path("on/" + cid), true);
      pushMe();
    }

    if (creating) {
      Promise.all([set("meta", { v: 1, host: cid, no: 0, status: "lobby" }), set("cfg", JSON.stringify(room.cfg)), set("bank", { start: DEFAULT_START, ver: 1 })]).then(begin);
    } else begin();

    return room;
  }

  function roomFromUrl(href) {
    var m = String(href || "").match(/[?&#]room=(g[0-9a-f]{32})/);
    return m ? m[1] : null;
  }

  window.PriTestSaigoNet = {
    START_DELAY_MS: START_DELAY_MS, CMD_LEAD_S: CMD_LEAD_S, CMD_MAX: CMD_MAX, DEFAULT_START: DEFAULT_START,
    open: open, roomFromUrl: roomFromUrl, validRoomId: function (id) { return ROOM_RE.test(String(id || "")); }
  };
})();
