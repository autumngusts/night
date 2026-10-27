// 明星經紀 starV：雲端存檔（規格 §18）。
// 存在 games/<存檔 ID>/rtState/starv（沿用既有 rtState 子節點，不需要修改 database.rules.json）：
//   save         { savedAt, deviceId, version, tickAt, name, day, data }：data 是整個 state 的 JSON 字串
//                （Firebase 會丟掉空陣列／空物件，所以不直接存物件）；tickAt 是 lastTickAt 換算成伺服器時間
//   activeDevice { deviceId, since }：以 rtTransaction 寫入；同時只有 1 台裝置進行中，其他裝置轉為唯讀
// 時間一律經過 GS.serverNow()：換裝置時用伺服器時間換回本機時間，跨裝置的離線補算才正確。
// 本機：localStorage["pritest-starv-cloud"] = { id, lastSync, pending }、["pritest-starv-device"] = 裝置 ID。
// 這個檔案沒有 DOM：純函式＋控制器（依賴注入 gs／storage／app），node 可以直接測；畫面在 starv_cloud_ui.js。
(function () {
  "use strict";

  var root = typeof window !== "undefined" ? window : globalThis;
  var Store = root.PriTestStarvStore;
  var CFG_KEY = "pritest-starv-cloud";
  var DEVICE_KEY = "pritest-starv-device";
  var SAVE = "starv/save";
  var ACTIVE = "starv/activeDevice";
  var READ_TIMEOUT_MS = 15000;

  function validId(id) { return typeof id === "string" && /^g[0-9a-f]{32}$/.test(id); }

  function envelope(st, deviceId, localNow, serverNow) {
    return {
      savedAt: serverNow, deviceId: deviceId, version: st.version,
      tickAt: st.lastTickAt - localNow + serverNow,
      name: st.company.name || "", day: st.day,
      data: JSON.stringify(st)
    };
  }

  // 雲端封包 → state（經過 Store.parse 驗證與 migrate）；lastTickAt 換回本機時間，不會落在本機的未來
  function unpack(env, localNow, serverNow) {
    if (!env || typeof env.data !== "string") throw new Error("starV: 雲端存檔格式不正確");
    var st = Store.parse(env.data);
    if (typeof env.tickAt === "number" && isFinite(env.tickAt)) st.lastTickAt = Math.min(localNow, env.tickAt - serverNow + localNow);
    return st;
  }

  // rtTransaction 的 updateFn：回傳 undefined＝放棄（別台進行中且不是強制接回）
  function claimUpdate(cur, deviceId, serverNow, force) {
    if (!force && cur && cur.deviceId && cur.deviceId !== deviceId) return undefined;
    return { deviceId: deviceId, since: serverNow };
  }

  // 已啟用雲端的裝置重新開啟時：別台進行中 → 唯讀；雲端有別台傳的、比本機最後同步新的存檔 → 採用；否則上傳本機
  function decide(o) {
    if (o.active && o.active.deviceId && o.active.deviceId !== o.deviceId) return "locked";
    if (o.remote && o.remote.deviceId !== o.deviceId && o.remote.savedAt > (o.lastSync || 0)) return "adopt";
    return "upload";
  }

  // 重要時點（規格 §18：抽卡、頒獎、新紀元）：這個字串改變就立即上傳
  function marks(st) {
    var h = st.awards && st.awards.history[0];
    return [st.stats.pulls, h ? h.year : 0, st.era].join("|");
  }

  function linkFor(href, id) { return String(href).split("#")[0].split("?")[0] + "?cloud=" + id; }
  function idFromSearch(search) {
    var m = /[?&]cloud=([^&#]*)/.exec(search || "");
    return m ? decodeURIComponent(m[1]) : null;
  }
  function stripCloudParam(search) {
    return String(search || "").replace(/([?&])cloud=[^&#]*&?/, "$1").replace(/[?&]$/, "");
  }

  function readJson(storage, key) {
    try { var v = storage.getItem(key); return v ? JSON.parse(v) : null; } catch (e) { return null; }
  }
  function writeJson(storage, key, v) {
    try { if (v === null) storage.removeItem(key); else storage.setItem(key, JSON.stringify(v)); } catch (e) { /* 只是記不住 */ }
  }
  function randomHex(bytes) {
    var s = "", c = root.crypto, i;
    if (c && c.getRandomValues) {
      var b = new Uint8Array(bytes);
      c.getRandomValues(b);
      for (i = 0; i < bytes; i++) s += (b[i] < 16 ? "0" : "") + b[i].toString(16);
      return s;
    }
    for (i = 0; i < bytes * 2; i++) s += Math.floor(Math.random() * 16).toString(16);
    return s;
  }

  // opts：gs（PriTestGameStorage 相容）、storage（localStorage 相容，可為 null）、
  //       app（st／now／adopt／setReadOnly）、onStatus（狀態改變時呼叫）、readTimeoutMs
  function create(opts) {
    var gs = opts.gs, storage = opts.storage, app = opts.app;
    var onStatus = opts.onStatus || function () {};
    var timeoutMs = opts.readTimeoutMs || READ_TIMEOUT_MS;
    var device = null;
    try { device = storage.getItem(DEVICE_KEY); } catch (e) { /* 沒有 storage */ }
    if (!device) {
      device = "d" + randomHex(8);
      try { storage.setItem(DEVICE_KEY, device); } catch (e) { /* 只是記不住 */ }
    }
    var cfg = readJson(storage, CFG_KEY);
    if (cfg && !validId(cfg.id)) cfg = null;
    var locked = false, busy = false, attached = false;
    var active = null, unsub = null, lastMarks = null;

    function info() {
      return { enabled: !!cfg, id: cfg ? cfg.id : null, lastSync: cfg ? cfg.lastSync || 0 : 0, pending: !!(cfg && cfg.pending),
        locked: locked, deviceId: device, busy: busy };
    }
    function status() { onStatus(info()); }
    function saveCfg() { writeJson(storage, CFG_KEY, cfg); }

    // 讀一次：rtSubscribe 收到第一個值就解除；逾時 reject（離線或 Firebase 載入失敗）
    function readOnce(id, sub) {
      return new Promise(function (resolve, reject) {
        var done = false, off = null;
        var timer = setTimeout(function () { if (done) return; done = true; if (off) off(); reject(new Error("starV: 雲端讀取逾時")); }, timeoutMs);
        off = gs.rtSubscribe(id, "cloud", sub, function (v) {
          if (done) return;
          done = true; clearTimeout(timer);
          Promise.resolve().then(function () { if (off) off(); });
          resolve(v);
        });
      });
    }

    function setLocked(b) {
      if (locked === b) return;
      locked = b;
      app.setReadOnly(b);
      status();
    }
    // 持續監看 activeDevice：別台接手就轉唯讀（解除唯讀只走 takeover）
    function watch() {
      if (unsub) unsub();
      unsub = gs.rtSubscribe(cfg.id, "cloud", ACTIVE, function (v) {
        active = v;
        if (v && v.deviceId && v.deviceId !== device) setLocked(true);
      });
    }
    function claim(force) {
      return gs.rtTransaction(cfg.id, "cloud", ACTIVE, function (cur) { return claimUpdate(cur, device, gs.serverNow(), force); })
        .then(function (v) { if (v) active = v; return !!(v && v.deviceId === device); });
    }
    function adopt(env) {
      var st = unpack(env, app.now(), gs.serverNow());
      cfg.lastSync = env.savedAt;
      saveCfg();
      lastMarks = marks(st);
      app.adopt(st);
    }

    // 上傳本機 state。pending 先寫進本機，rtSet 完成才清掉（離線時 Firebase SDK 會暫存，恢復後送出）
    function upload() {
      var st = app.st();
      if (!cfg || locked || !st) return Promise.resolve(false);
      if (active && active.deviceId && active.deviceId !== device) return Promise.resolve(false);
      var id = cfg.id, env = envelope(st, device, app.now(), gs.serverNow());
      cfg.pending = true;
      saveCfg();
      lastMarks = marks(st);
      status();
      return gs.rtSet(id, "cloud", SAVE, env).then(function () {
        if (!cfg || cfg.id !== id) return false;
        cfg.pending = false;
        cfg.lastSync = env.savedAt;
        saveCfg();
        status();
        return true;
      });
    }

    function attach() {
      if (!cfg) { status(); return Promise.resolve("off"); }
      var id = cfg.id;
      return Promise.all([readOnce(id, ACTIVE), readOnce(id, SAVE)]).then(function (r) {
        if (!cfg || cfg.id !== id) return "off";
        attached = true;
        active = r[0];
        var d = decide({ active: r[0], remote: r[1], deviceId: device, lastSync: cfg.lastSync });
        watch();
        if (d === "locked") { setLocked(true); return d; }
        return claim(false).then(function (ok) {
          if (!ok) return "conflict";   // 別台剛好搶先：watch() 會收到並轉唯讀
          if (d === "adopt") {
            try { adopt(r[1]); } catch (e) { d = "upload"; }   // 雲端存檔壞掉：保留本機並覆蓋上去
          }
          return upload().then(function () { return d; });
        });
      }, function () { status(); return "offline"; });
    }

    function enable() {
      if (cfg) return Promise.resolve(cfg.id);
      var id = gs.generateCloudGameId();
      cfg = { id: id, lastSync: 0, pending: false };
      busy = true;
      status();
      return claim(true).then(function (ok) {
        busy = false;
        if (!ok) { cfg = null; status(); return null; }
        saveCfg();
        attached = true;
        watch();
        return upload().then(function () { return id; });
      });
    }

    function disable() {
      if (unsub) unsub();
      unsub = null; cfg = null; active = null; attached = false;
      saveCfg();
      setLocked(false);
      status();
    }

    function preview(id) {
      if (!validId(id)) return Promise.resolve(null);
      return readOnce(id, SAVE).then(function (env) { return env && typeof env.data === "string" ? env : null; });
    }

    // 換裝置接回：先驗證封包，再強制成為進行中裝置並採用雲端 state
    function connect(id, env) {
      try { unpack(env, app.now(), gs.serverNow()); } catch (e) { return Promise.reject(e); }
      if (unsub) unsub();
      unsub = null;
      cfg = { id: id, lastSync: 0, pending: false };
      return claim(true).then(function (ok) {
        if (!ok) { cfg = null; status(); return false; }
        saveCfg();
        attached = true;
        adopt(env);
        setLocked(false);
        watch();
        status();
        return true;
      });
    }

    // 唯讀中按「在此裝置繼續」：強制接手，雲端有別台傳的較新存檔就採用
    function takeover() {
      if (!cfg) return Promise.resolve(false);
      busy = true;
      status();
      return claim(true).then(function (ok) {
        if (!ok) { busy = false; status(); return false; }
        return readOnce(cfg.id, SAVE).then(function (env) {
          if (env && env.deviceId !== device && env.savedAt > (cfg.lastSync || 0)) adopt(env);
          busy = false;
          setLocked(false);
          status();
          return upload().then(function () { return true; });
        });
      }).catch(function () { busy = false; status(); return false; });
    }

    // 每 30 秒：還沒接上（啟動時離線）就再接一次，否則上傳
    function tick() {
      if (!cfg) return Promise.resolve(false);
      return attached ? upload() : attach();
    }
    function changed() {
      if (!cfg || locked) return;
      var st = app.st();
      if (!st) return;
      var m = marks(st);
      if (lastMarks !== null && m !== lastMarks) upload();
      else lastMarks = m;
    }
    function onOnline() { if (cfg && (cfg.pending || !attached)) tick(); }

    return {
      info: info, deviceId: function () { return device; },
      attach: attach, enable: enable, disable: disable, preview: preview, connect: connect, takeover: takeover,
      upload: upload, tick: tick, changed: changed, onOnline: onOnline
    };
  }

  root.PriTestStarvCloud = {
    CFG_KEY: CFG_KEY, DEVICE_KEY: DEVICE_KEY, SAVE: SAVE, ACTIVE: ACTIVE,
    validId: validId, envelope: envelope, unpack: unpack, claimUpdate: claimUpdate, decide: decide, marks: marks,
    linkFor: linkFor, idFromSearch: idFromSearch, stripCloudParam: stripCloudParam, create: create
  };
})();
