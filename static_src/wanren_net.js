// 萬人迷（wanren）：同一個校園（第 13 項）。只同步「人在校園的哪裡」：每個玩家的進度仍然各自存在自己的裝置。
// 路徑：games/<roomId>/rtState/wr/p/<cid> = { name, title, x, z, ry, loc, emote, emoteAt }
//   沿用 game_storage.js 的 rtSetWithOnDisconnect（斷線時伺服器自動移除）與 rtSet／rtSubscribe，database.rules.json 不用改。
// 位置最多每 0.4 秒寫一次，而且只有移動超過 0.3 或換地點時才寫。
(function () {
  "use strict";

  var GS = window.PriTestGameStorage;
  var ROOM_RE = /^g[0-9a-f]{32}$/;
  var CLOUD = "cloud";
  var SEND_MS = 400;

  function newCid() {
    var b = new Uint8Array(8);
    try { window.crypto.getRandomValues(b); } catch (e) { for (var i = 0; i < 8; i++) b[i] = Math.floor(Math.random() * 256); }
    return "c" + Array.prototype.map.call(b, function (x) { return (x < 16 ? "0" : "") + x.toString(16); }).join("");
  }
  function available() { return !!GS; }
  function validRoom(id) { return ROOM_RE.test(String(id || "")); }

  // opts：{ roomId?（沒有＝建立新房）, name, title, onChange(others) }
  function open(opts) {
    if (!GS) return null;
    var roomId = validRoom(opts.roomId) ? opts.roomId : GS.generateCloudGameId();
    var cid = newCid();
    var me = { name: String(opts.name || "").slice(0, 12) || "?", title: String(opts.title || "").slice(0, 16), x: 0, z: 0, ry: 0, loc: "", emote: "", emoteAt: 0 };
    var path = "wr/p/" + cid;
    var stop = GS.rtSetWithOnDisconnect(roomId, CLOUD, path, me);
    var lastSent = 0, timer = null, closed = false;
    var others = [];
    var unsub = GS.rtSubscribe(roomId, CLOUD, "wr/p", function (val) {
      others = Object.keys(val || {}).filter(function (k) { return k !== cid && val[k] && typeof val[k] === "object"; }).map(function (k) {
        var o = val[k];
        return { id: k, name: String(o.name || "?").slice(0, 12), title: String(o.title || "").slice(0, 16), x: +o.x || 0, z: +o.z || 0, ry: +o.ry || 0, loc: o.loc || "", emote: String(o.emote || "").slice(0, 12), emoteAt: +o.emoteAt || 0 };
      });
      if (opts.onChange) opts.onChange(others);
    });
    function send() {
      timer = null;
      if (closed) return;
      lastSent = Date.now();
      GS.rtSet(roomId, CLOUD, path, me);
    }
    function schedule() {
      if (timer || closed) return;
      var wait = Math.max(0, SEND_MS - (Date.now() - lastSent));
      timer = setTimeout(send, wait);
    }
    return {
      id: roomId, cid: cid,
      others: function () { return others; },
      // 位置：移動夠多或換地點才送
      pose: function (p, loc) {
        if (!p) return;
        var moved = Math.abs(p.x - me.x) + Math.abs(p.z - me.z) > 0.3 || (loc || "") !== me.loc;
        me.x = p.x; me.z = p.z; me.ry = p.ry; me.loc = loc || "";
        if (moved) schedule();
      },
      profile: function (name, title) { me.name = String(name || me.name).slice(0, 12); me.title = String(title || "").slice(0, 16); schedule(); },
      emote: function (txt) { me.emote = String(txt || "").slice(0, 12); me.emoteAt = Date.now(); schedule(); },
      close: function () {
        closed = true;
        if (timer) clearTimeout(timer);
        try { unsub(); } catch (e) { /* ignore */ }
        try { stop(); } catch (e) { /* ignore */ }
      }
    };
  }

  window.PriTestWanrenNet = { available: available, open: open, validRoom: validRoom };
})();
