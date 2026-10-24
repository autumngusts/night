// 黃牌 Yellow Card：畫面。規則全部在 yellow_core.js，資料在 yellow_data.js，連線在 yellow_net.js。
//   本機模式：一台裝置操作所有英雄，狀態存在 localStorage["pritest-yellow-state"]。
//   連線模式：yellow/index.html?room=<g+32hex>，每人選一位（或多位）英雄；畫面只畫房主同步來的狀態。
// 戰場是圓形（使用者指定 2026-10-22）：英雄在中心，依人數切成等分的扇形區（淺色區分），內圈近、外圈遠，
// 敵人是依體型大小的圓點（判定範圍＝圓，座標由 Core.layout() 計算，跟指定範圍卡的命中判定共用）。
// 出牌（使用者指定 2026-10-22）：手牌像拿在手上一樣扇形疊著，滑過抽起來、拖出一半在旁邊顯示完整說明，
// 拖到戰場上才發動——單體牌拖到敵人／隊友身上、全範圍牌放在戰場任一處、指定範圍牌放下範圍圈；預覽到的目標會變色。
// 點戰場上的敵人：虛線標出牠準備攻擊誰；點英雄：虛線標出誰會打他。
// 每次狀態變動都整個重畫（拖曳中延後到放開）；打擊演出（彈道、爆光、擊殺、數字）用 log 流水號比對新增的紀錄後播放。
(function () {
  "use strict";

  var D = window.PriTestYellowData;
  var Core = window.PriTestYellowCore;
  var AI = window.PriTestYellowAI;
  var NOOP = function () { /* 沒有音效模組時 */ };
  var Snd = window.PriTestYellowAudio || { sfx: NOOP, scene: NOOP, settings: function () { return { sfx: false, music: false }; }, setSfx: NOOP, setMusic: NOOP };
  var app = document.getElementById("yc-app");
  if (!app || !D || !Core) return;

  var STORAGE_KEY = "pritest-yellow-state";
  var NETNAME_KEY = "pritest-yellow-netname";
  // 圓形戰場的半徑（佔容器寬度的 %，與 Core.GEO 相同）：中心英雄區 / 內外圈分界 / 外緣
  var R_CORE = Core.GEO.core, R_MID = Core.GEO.mid, R_EDGE = Core.GEO.edge;

  var mode = null;          // null | "local" | "net"
  var localSt = null;
  var room = null;
  var ui = {
    replay: null,           // 敵人回合重播：{ st, events, idx }
    lastSt: null,           // 上一次畫的戰鬥狀態（重播的起點）
    acting: null,           // 重播中正在行動的敵人 uid
    focus: null,            // 戰場上點選的對象：{ k:"e", u } 敵人／{ k:"h", s } 英雄（畫虛線）
    lay: null,              // 這次畫面用的 Core.layout()
    enemyPos: {},           // 上一次畫面的敵人位置與圖示（移動補間、擊殺演出用）
    hover: -1,              // 手牌中滑過的卡（扇形攤開）
    tab: null,              // 下方手牌區正在看的英雄 seat
    seenLog: 0,             // 已經浮出數字的 log 流水號
    logOpen: false,
    deckView: null,         // 正在看牌組的 seat
    setup: [{ cls: "paladin", name: "" }, { cls: "mage", name: "" }, null, null],
    opts: { torment: 0, endless: false }, // 本機的苦痛等級／無盡模式
    signals: [],            // 畫面上的標記與表情：{ k, x, y, u, s, e, who, color, until }
    sigSeen: {},            // 連線：每個 cid 已經顯示過的訊號時間
    pingMode: false,        // 下一次點戰場＝標記
    emoteOpen: false,       // 表情列展開
    lastPhase: null,        // 勝負音效只響一次
    focusHero: "paladin",   // 選角畫面正在看的英雄
    joinText: "", joinBad: false, copied: false, confirmQuit: false, err: ""
  };

  function t(key, params) { return window.I18N.t(key, params); }
  function lang() { return window.I18N.getLang(); }
  function L(obj) { if (!obj) return ""; var l = lang(); return obj[l] || obj.zh || ""; }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === "text") node.textContent = v;
      else if (k === "class") node.className = v;
      else if (k === "style") node.setAttribute("style", v);
      else if (k.indexOf("on") === 0) node.addEventListener(k.slice(2), v);
      else if (v === true) node.setAttribute(k, "");
      else node.setAttribute(k, v);
    });
    (children || []).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      node.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
    });
    return node;
  }
  function svg(tag, attrs) {
    var node = document.createElementNS("http://www.w3.org/2000/svg", tag);
    Object.keys(attrs || {}).forEach(function (k) { node.setAttribute(k, attrs[k]); });
    return node;
  }

  // ---------------- 狀態存取 ----------------
  function game() { return mode === "local" ? localSt : mode === "net" && room ? room.game : null; }
  function myCtrl() { return mode === "net" && room ? room.cid : "local"; }
  function mine(h) { return !!h && h.ctrl === myCtrl(); }
  function isAi(h) { return !!h && !!AI && h.ctrl === AI.CTRL; }
  // 連線時這個操作者在不在（AI 永遠在）；本機一律在
  function isOnline(ctrl) { return mode !== "net" || !room || room.isOnline(ctrl); }
  // 幕名：無盡模式第四幕起寫「第 N 幕・（輪到的那一幕）」
  function actName(act, rg) {
    var st = game();
    var def = (rg && D.REGION[rg]) || (st ? Core.regionOf(st, act) : D.ACTS[act % D.ACTS.length]);
    return (act >= D.ACTS.length ? t("yc_act_endless", { n: act + 1 }) + " · " : "") + L(def.name);
  }

  function saveLocal() {
    try {
      if (localSt) localStorage.setItem(STORAGE_KEY, JSON.stringify(localSt));
      else localStorage.removeItem(STORAGE_KEY);
    } catch (e) { /* 私密模式等：只是記不住 */ }
  }
  function loadLocal() {
    try {
      var s = localStorage.getItem(STORAGE_KEY);
      var st = s ? JSON.parse(s) : null;
      return st && st.v === 5 ? st : null; // 舊版（四角象限／5 層地圖／有商店與金幣／戰後自動復活）的存檔不相容
    } catch (e) { return null; }
  }

  function send(action) {
    var st = game();
    if (!st) return;
    var err;
    if (mode === "local") { err = Core.apply(st, "local", action); if (!err) saveLocal(); }
    else err = room.send(action);
    ui.err = err ? t("yc_err_" + err) : "";
    render();
  }

  // ---------------- 局外進度（2026-10-23 使用者指定，Hellcard 的解鎖；只存在這台裝置的 localStorage） ----------------
  // { xp: { 英雄 id: 經驗 }, won: 通關過的最高苦痛等級（-1＝還沒通關過）, done: [已經算過經驗的對局 seed] }
  var PROFILE_KEY = "pritest-yellow-profile";
  function profile() {
    try {
      var p = JSON.parse(localStorage.getItem(PROFILE_KEY) || "null");
      if (p && typeof p === "object") return { xp: p.xp || {}, won: typeof p.won === "number" ? p.won : -1, done: p.done || [] };
    } catch (e) { /* 讀不到就當新玩家 */ }
    return { xp: {}, won: -1, done: [] };
  }
  function saveProfile(p) { try { localStorage.setItem(PROFILE_KEY, JSON.stringify(p)); } catch (e) { /* 只是記不住 */ } }
  // 匯出／匯入（2026-10-23 使用者指定：換瀏覽器或清掉資料時可以搬進度）。代碼＝"YC1-" + base64url(JSON)；
  // 匯入是「合併」：每位英雄的經驗、通關過的苦痛都取較高的一邊，所以不會因為貼錯代碼而失去進度
  var PROFILE_DONE_MAX = 300;
  function b64urlEncode(str) { return btoa(unescape(encodeURIComponent(str))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
  function b64urlDecode(str) {
    var b = str.replace(/-/g, "+").replace(/_/g, "/");
    while (b.length % 4) b += "=";
    return decodeURIComponent(escape(atob(b)));
  }
  function exportProfile(p) { return "YC1-" + b64urlEncode(JSON.stringify({ xp: p.xp, won: p.won, done: p.done.slice(-PROFILE_DONE_MAX) })); }
  function importProfile(code) {
    var m = /^YC1-([A-Za-z0-9_-]+)$/.exec(String(code || "").replace(/\s+/g, ""));
    if (!m) return null;
    var o;
    try { o = JSON.parse(b64urlDecode(m[1])); } catch (e) { return null; }
    if (!o || typeof o !== "object" || typeof o.xp !== "object" || !o.xp) return null;
    var xp = {};
    D.CLASSES.forEach(function (c) { var v = Number(o.xp[c.id]); if (isFinite(v) && v > 0) xp[c.id] = Math.floor(v); });
    var won = Math.max(-1, Math.min(D.TORMENTS.length, Math.floor(Number(o.won))));
    if (!isFinite(won)) won = -1;
    var done = Array.isArray(o.done) ? o.done.filter(function (x) { return typeof x === "number" && isFinite(x); }) : [];
    return { xp: xp, won: won, done: done };
  }
  function mergeProfile(a, b) {
    var xp = {};
    D.CLASSES.forEach(function (c) { var v = Math.max(a.xp[c.id] || 0, b.xp[c.id] || 0); if (v) xp[c.id] = v; });
    var done = a.done.slice();
    b.done.forEach(function (x) { if (done.indexOf(x) < 0) done.push(x); });
    return { xp: xp, won: Math.max(a.won, b.won), done: done.slice(-PROFILE_DONE_MAX) };
  }
  function profilePanel() {
    var p = profile();
    var d = el("details", { class: "yc-panel yc-profile", open: ui.profOpen ? true : null });
    d.addEventListener("toggle", function () { ui.profOpen = d.open; });
    d.appendChild(el("summary", { text: "📦 " + t("yc_prof_title") }));
    d.appendChild(el("p", { class: "yc-small", text: t("yc_prof_summary", { n: totalLv(p), w: p.won >= 0 ? p.won : t("yc_prof_none") }) }));
    d.appendChild(el("p", { class: "yc-small yc-muted", text: t("yc_prof_desc") }));
    d.appendChild(el("div", { class: "yc-actions" }, [
      el("button", { type: "button", text: t("yc_prof_export"), onclick: function () { ui.profCode = exportProfile(profile()); ui.profMsg = null; render(); } })
    ]));
    if (ui.profCode) {
      var out = el("textarea", { class: "yc-text yc-prof-code", readonly: true, rows: 3 });
      out.value = ui.profCode;
      out.addEventListener("focus", function () { out.select(); });
      d.appendChild(out);
      d.appendChild(el("div", { class: "yc-actions" }, [
        el("button", { type: "button", class: "yc-small-btn", text: t("yc_prof_copy"), onclick: function () {
          var done = function () { ui.profMsg = { ok: true, k: "yc_prof_copied" }; render(); };
          try { navigator.clipboard.writeText(ui.profCode).then(done, function () { out.select(); }); } catch (e) { out.select(); }
        } }),
        el("span", { class: "yc-small yc-muted", text: t("yc_prof_export_hint") })
      ]));
    }
    var inp = el("textarea", { class: "yc-text yc-prof-in", rows: 2, placeholder: t("yc_prof_import_ph") });
    inp.value = ui.profIn || "";
    inp.addEventListener("input", function () { ui.profIn = inp.value; });
    d.appendChild(inp);
    d.appendChild(el("div", { class: "yc-actions" }, [
      el("button", { type: "button", text: t("yc_prof_import"), onclick: function () {
        var got = importProfile(ui.profIn);
        if (!got) { ui.profMsg = { ok: false, k: "yc_prof_import_bad" }; render(); return; }
        saveProfile(mergeProfile(profile(), got));
        ui.profIn = ""; ui.profCode = null;
        ui.profMsg = { ok: true, k: "yc_prof_import_ok" };
        render();
      } }),
      ui.profMsg ? el("span", { class: ui.profMsg.ok ? "yc-good" : "yc-bad", text: t(ui.profMsg.k, { n: totalLv(profile()) }) }) : null
    ]));
    return d;
  }
  function heroLv(p, cls) { var xp = p.xp[cls] || 0, lv = 0; D.LEVEL_XP.forEach(function (n, i) { if (xp >= n) lv = i; }); return lv; }
  function totalLv(p) { var n = 0; D.CLASSES.forEach(function (c) { n += heroLv(p, c.id); }); return n; }
  function starterOpts(p) { var tl = totalLv(p); return D.STARTERS.filter(function (x) { return tl >= x.need; }); }
  function maxTorment(p) { return Math.min(D.TORMENTS.length, p.won + 1); }
  // 這台裝置操作的英雄（本機：不是 AI 的；連線：開局時坐這個位置的是自己）
  function myRunHeroes(st) {
    return Core.heroes(st).filter(function (h) { return mode === "net" && room ? h.owner === room.cid : !isAi(h); });
  }
  // 一局結束：自己的英雄得到經驗＝推進的層數（通關 +6）；通關時記下苦痛等級。同一局只算一次（回傳這次的結果給結算畫面）
  function awardRun(st) {
    var p = profile();
    var id = String(st.seed);
    var cleared = st.phase === "win" || st.act >= D.ACTS.length;
    var gain = Math.min(24, st.act * D.FLOORS.length + st.floor) + (st.phase === "win" ? 6 : 0);
    var out = myRunHeroes(st).map(function (h) {
      var before = heroLv(p, h.cls);
      return { cls: h.cls, before: before, xp: (p.xp[h.cls] || 0) };
    });
    if (p.done.indexOf(id) >= 0) return ui.award && ui.award.id === id ? ui.award : null;
    out.forEach(function (x) { p.xp[x.cls] = x.xp + gain; x.after = heroLv(p, x.cls); });
    if (cleared && (st.torment || 0) > p.won) p.won = st.torment || 0;
    p.done = p.done.concat([id]).slice(-30);
    saveProfile(p);
    ui.award = { id: id, gain: gain, heroes: out };
    return ui.award;
  }
  // 出發遺物的選單（解鎖的才列出來）
  function artSelect(cur, onChange) {
    var opts = starterOpts(profile());
    var sel = el("select", { class: "yc-select yc-art-select", title: t("yc_art_desc"), onchange: function () { onChange(sel.value || null); } });
    sel.appendChild(el("option", { value: "", text: t("yc_art_none") }));
    opts.forEach(function (x) {
      var o = el("option", { value: x.id, text: D.RELIC[x.id].icon + " " + relicName(x.id) + " — " + L(D.RELIC[x.id].desc) });
      if (cur === x.id) o.selected = true;
      sel.appendChild(o);
    });
    var next = D.STARTERS.filter(function (x) { return opts.indexOf(x) < 0; })[0];
    return el("label", { class: "yc-opt yc-art" }, [el("span", { text: "🎒 " + t("yc_art") }), sel,
      next ? el("span", { class: "yc-small yc-muted", text: t("yc_art_next", { n: next.need, m: totalLv(profile()) }) }) : null]);
  }
  function validArt(art) { return starterOpts(profile()).some(function (x) { return x.id === art; }) ? art : null; }

  // ---------------- 名稱 ----------------
  function heroDef(id) { return D.CLASS[id]; }
  function heroName(h) { return h ? (h.name || L(heroDef(h.cls).name)) + (isAi(h) ? " 🤖" : "") : ""; }
  function heroLabel(st, seat) {
    var h = Core.hero(st, seat);
    return h ? heroDef(h.cls).icon + heroName(h) : "?";
  }
  function enemyName(id) { var d = D.ENEMY[id]; return d ? L(d.name) : id; }
  function cardName(c) { var d = D.CARD[c.id]; return d ? L(d.name) + (c.up ? "+" : "") : c.id; }
  function stName(s) { return t("yc_st_" + s); }
  function pathName(cls, pid) {
    var hd = heroDef(cls);
    var p = hd && hd.paths.filter(function (x) { return x.id === pid; })[0];
    return p ? L(p.name) : "";
  }

  // ---------------- 卡牌說明（依 fx 自動產生） ----------------
  var DMG_OPS = { dmg: 1, dmgAll: 1, dmgSec: 1, dmgExec: 1 };
  // 2026-10-24 新英雄的條件 op（巢狀 fx）
  var COND_OPS = { comboIf: 1, back: 1, aimed: 1, atkIf: 1, gen: 1, killIf: 1, beatIf: 1, linked: 1, hasLink: 1, charmed: 1, ceIf: 1 };
  // 五行（陰陽師）的圖示
  var EL_ICON = { wood: "🌳", fire: "🔥", earth: "⛰️", metal: "⚙️", water: "💧" };
  function fxText(d, f, h, ring) {
    var p = { n: f.n, h: f.h || 1, s: f.s ? stName(f.s) : "", r: t("yc_rng_" + (f.r || d.rng || "any")), k: f.k, per: f.per || 1 };
    // 有英雄時顯示實際數值（力量、鷹眼、狂熱、虛弱都算進去）
    if (h && DMG_OPS[f.o]) p.n = Core.heroHitValue(h, f.n, ring || (f.r === "far" ? "far" : "near"), null);
    // 指定範圍卡：範圍 op 改成「範圍內的敵人」（射程限制寫在卡面的標籤）
    if (d.tgt === "area" && (f.o === "dmgAll" || f.o === "stAll" || f.o === "pushAll")) {
      if (f.o === "stAll" && f.s === "stun") return t("yc_fx_stunAll_area", p);
      return t("yc_fx_" + f.o + "_area" + (f.o === "dmgAll" && (f.h || 1) > 1 ? "_multi" : ""), p);
    }
    if ((f.o === "dmg" || f.o === "dmgAll") && (f.h || 1) > 1) return t("yc_fx_" + f.o + "_multi", p);
    if (f.o === "pow") return t("yc_pow_" + f.p, p);
    if ((f.o === "st" || f.o === "stAll") && f.s === "stun") return t(f.o === "st" ? "yc_fx_stun" : "yc_fx_stunAll", p);
    if (f.o === "sac") return t("yc_fx_sac_" + f.k, p);
    if (f.o === "finale") return t("yc_fx_finale_" + f.k, p) + (h ? t("yc_fx_now_mel", { m: h.mel }) : "");
    if (h && (f.o === "dmgSpirit" || f.o === "blkSpirit")) return t("yc_fx_" + f.o, p) + t("yc_fx_now_sp", { m: h.sp });
    if (h && f.o === "dmgMel") return t("yc_fx_dmgMel", p) + t("yc_fx_now_mel", { m: h.mel });
    if (f.o === "dmgBlock" && h) return t("yc_fx_dmgBlock_now", { n: Core.heroHitValue(h, h.blk * f.n, "near", null) });
    // 新英雄的機制（巢狀效果遞迴產生說明）
    var sub = function (list) { return (list || []).map(function (g) { return fxText(d, g, h, ring); }).join(t("yc_sep_inner")); };
    if (f.o === "chiIf") return t("yc_fx_chiIf", { c: f.c }) + sub(f.fx);
    if (f.o === "delay") return t("yc_fx_delay") + sub(f.fx);
    if (f.o === "form") return t("yc_fx_form", { f: t("yc_form_" + f.f) });
    if (f.o === "brew") return t(f.ally ? "yc_fx_brew_ally" : "yc_fx_brew", { n: f.n || 1, c: (f.c === "rand" ? t("yc_potion_rand") : L(D.CARD[f.c].name)) + (f.up ? "+" : "") });
    if (f.o === "dmgPotion" || f.o === "dmgAllPotion") return t("yc_fx_" + f.o, p) + (h ? t("yc_fx_now_potion", { m: Core.potionCount(h) }) : "");
    if (f.o === "roll") return t("yc_fx_roll_" + f.k, p) + (f.a ? t("yc_fx_adv") : "");
    if (f.o === "gamble") return t(f.lose && f.lose.length ? "yc_fx_gamble" : "yc_fx_gamble_nolose", { w: sub(f.win), l: sub(f.lose) }) + (f.a ? t("yc_fx_adv") : "");
    // 2026-10-24 新英雄：條件（連擊／背刺／後之先／相生／掠奪／節拍／綁定／魅惑／咒力…）＋巢狀效果
    if (COND_OPS[f.o]) return t("yc_fx_" + f.o, { c: f.o === "ceIf" && h ? Math.max(0, f.c - (h.pw.ceDisc || 0)) : f.c }) + sub(f.fx);
    if (f.o === "dmg" && (f.pierce || f.pierceGen)) return t((f.h || 1) > 1 ? "yc_fx_dmg_multi" : "yc_fx_dmg", p) + t(f.pierce ? "yc_fx_pierce" : "yc_fx_pierceGen");
    if (f.o === "ammoDmg" || f.o === "beatSpend" || f.o === "vow") return t("yc_fx_" + f.o + "_" + f.k, p) + (h && f.o === "ammoDmg" ? t("yc_fx_now_ammo", { m: h.ammo || 0 }) : h && f.o === "beatSpend" ? t("yc_fx_now_beat", { m: h.beat || 0 }) : "");
    if (h && f.o === "dmgCombo") return t("yc_fx_dmgCombo", p) + t("yc_fx_now_combo", { m: h.combo || 0 });
    if (h && (f.o === "blkShiki" || f.o === "dmgShiki" || f.o === "dmgAllShiki")) return t("yc_fx_" + f.o, p) + t("yc_fx_now_shiki", { m: h.shiki || 0 });
    // 對自己用的牌（清祓、水遁）：移除的是自己的負面狀態
    if (f.o === "cleanse" && d.tgt === "self") return t("yc_fx_cleanse_self");
    if (f.o === "addTok") return t("yc_fx_addTok", { n: f.n, c: L(D.CARD[f.c].name) });
    if (f.o === "manaNext") return t("yc_fx_manaNext", { n: f.n, k: f.k || f.n });
    if (f.o === "dmgAtkN") return t("yc_fx_dmgAtkN", p) + (h ? t("yc_fx_now_hits", { m: (h.atkN || 0) + (f.k || 0) }) : "");
    return t("yc_fx_" + f.o, p);
  }

  function cardText(d, h) {
    var sep = t("yc_sep");
    var parts = [];
    if (d.near) parts.push(t("yc_ring_near_lbl") + d.near.map(function (f) { return fxText(d, f, h, "near"); }).join(t("yc_sep_inner")));
    if (d.far) parts.push(t("yc_ring_far_lbl") + d.far.map(function (f) { return fxText(d, f, h, "far"); }).join(t("yc_sep_inner")));
    d.fx.forEach(function (f) { parts.push(fxText(d, f, h, d.rng === "far" ? "far" : d.rng === "near" ? "near" : null)); });
    // 德魯伊：在某個姿態時的額外效果
    Object.keys(d.forms || {}).forEach(function (k) {
      parts.push(t("yc_form_lbl", { f: t("yc_form_" + k) }) + d.forms[k].map(function (f) { return fxText(d, f, h, d.rng === "far" ? "far" : d.rng === "near" ? "near" : null); }).join(t("yc_sep_inner")));
    });
    if (d.unplayable) parts.unshift(t("yc_kw_unplayable"));
    if (d.ethereal) parts.push(t("yc_kw_ethereal"));
    if (d.id === "t_yellow") parts.push(t("yc_kw_redcard", { n: D.RED_CARD_DMG }));
    if (d.dblEdge) parts.push(t("yc_kw_dblEdge"));
    if (d.exhaust) parts.push(t("yc_kw_exhaust"));
    return parts.join(sep);
  }

  function rangeTag(d) {
    if (d.near || d.far) return t("yc_rngtag_split");
    if (!d.rng) return null;
    return t("yc_rngtag_" + d.rng);
  }

  // 卡面：一般卡牌的直式比例（5:7）。上方費用＋名稱、中間插圖（職業圖示＋種類）、下方標籤與說明
  var TYPE_ICON = { atk: "⚔️", skl: "🔰", pow: "🌟", curse: "🃏" };
  function cardMeta(d) {
    var meta = [t("yc_type_" + d.type)];
    var rt = rangeTag(d);
    if (rt) meta.push(rt);
    if (d.tgt === "area") meta.push(t("yc_tgt_area", { s: t("yc_area_" + (d.ar || "m")) }));
    if (d.tgt === "ally") meta.push(t("yc_tgt_ally"));
    if (d.tgt === "down") meta.push(t("yc_tgt_down"));
    if (d.el) meta.push(EL_ICON[d.el] + t("yc_el_" + d.el));
    if (d.ammo) meta.push(t("yc_tag_ammo", { n: d.ammo }));
    return meta.join(" · ");
  }
  function cardEl(c, opts) {
    opts = opts || {};
    var d = Core.cardDef(c);
    var hd = heroDef(d.cls);
    var tag = opts.tag || (opts.button === false ? "div" : "button");
    var classes = "yc-card yc-type-" + d.type + " yc-rar-" + d.rar + (opts.extra ? " " + opts.extra : "");
    if (opts.selected) classes += " yc-card-sel";
    if (opts.disabled) classes += " yc-card-off";
    if (c.up) classes += " yc-card-up";
    return el(tag, {
      type: tag === "button" ? "button" : null, class: classes,
      style: hd ? "--yc-cls:" + hd.color : null,
      "data-u": c.u, title: opts.title || null,
      onclick: opts.onclick || null, disabled: tag === "button" && opts.disabled && !opts.onclick ? true : null
    }, [
      el("span", { class: "yc-card-top" }, [
        d.unplayable ? null : el("span", { class: "yc-card-cost", text: d.cost }),
        el("span", { class: "yc-card-name", text: cardName(c) })
      ]),
      el("span", { class: "yc-card-art" }, [
        el("span", { class: "yc-card-art-icon", text: hd ? hd.icon : "🟨" }),
        d.el ? el("span", { class: "yc-card-art-el", title: t("yc_el_" + d.el), text: EL_ICON[d.el] }) : null,
        el("span", { class: "yc-card-art-type", text: d.tgt === "area" ? "🎯" : (TYPE_ICON[d.type] || "") })
      ]),
      el("span", { class: "yc-card-meta", text: cardMeta(d) }),
      d.path ? el("span", { class: "yc-card-path", text: pathName(d.cls, d.path) }) : null,
      el("span", { class: "yc-card-text", text: cardText(d, opts.hero || null) })
    ]);
  }

  // ---------------- 遺物 ----------------
  function relicName(id) { var r = D.RELIC[id]; return r ? L(r.name) : id; }
  function relicEl(id, opts) {
    var r = D.RELIC[id];
    if (!r) return null;
    opts = opts || {};
    return el(opts.onclick ? "button" : "div", { type: opts.onclick ? "button" : null, class: "yc-relic yc-relic-" + r.rar,
      disabled: opts.disabled ? true : null, onclick: opts.onclick || null }, [
      el("span", { class: "yc-relic-icon", text: r.icon }),
      el("span", { class: "yc-relic-body" }, [
        el("strong", { text: L(r.name) }),
        el("span", { class: "yc-small yc-muted", text: t("yc_rar_" + r.rar) }),
        el("span", { class: "yc-small", text: L(r.desc) })
      ])
    ]);
  }
  // 小圖示一排（滑過看說明）
  function relicRow(h) {
    if (!h.relics || !h.relics.length) return null;
    return el("div", { class: "yc-relic-row" }, h.relics.map(function (id) {
      var r = D.RELIC[id];
      return el("span", { class: "yc-relic-chip", title: L(r.name) + "：" + L(r.desc), text: r.icon });
    }));
  }

  // ---------------- 英雄選擇 ----------------
  // taken：已被其他座位選走的英雄 id（同一隊不能重複）
  function heroGrid(cur, taken, onPick, allowEmpty) {
    var grid = el("div", { class: "yc-hero-pick" });
    D.CLASSES.forEach(function (c) {
      var off = taken.indexOf(c.id) >= 0 && cur !== c.id;
      grid.appendChild(el("button", { type: "button", class: "yc-hero-btn" + (cur === c.id ? " yc-on" : ""), style: "--yc-cls:" + c.color,
        disabled: off ? true : null, title: L(c.desc),
        onclick: function () { ui.focusHero = c.id; onPick(c.id); } }, [el("span", { class: "yc-class-icon", text: c.icon }), el("span", { text: L(c.name) })]));
    });
    if (allowEmpty) grid.appendChild(el("button", { type: "button", class: "yc-hero-btn" + (cur ? "" : " yc-on"), onclick: function () { onPick(null); } }, [el("span", { text: t("yc_seat_none") })]));
    return grid;
  }

  function heroInfo(id) {
    var c = heroDef(id);
    if (!c) return null;
    var ps = c.passive;
    var box = el("div", { class: "yc-hero-info", style: "--yc-cls:" + c.color });
    var art = HERO_ART[id];
    if (art && art.portrait) box.classList.add("yc-has-portrait");
    if (art && art.portrait) box.appendChild(el("img", { class: "yc-hero-portrait", src: HERO_IMG + id + "_portrait.png", alt: L(c.name) }));
    box.appendChild(el("div", { class: "yc-hero-info-head" }, [
      el("span", { class: "yc-hero-info-icon", text: c.icon }),
      el("div", {}, [el("strong", { text: L(c.name) }), el("div", { class: "yc-muted yc-small", text: "HP " + c.hp + " · " + t("yc_passive") + "：" + t("yc_pas_" + ps.p, { n: ps.n }) })])
    ]));
    // 局外進度：等級與經驗
    var prof = profile(), lv = heroLv(prof, id), xp = prof.xp[id] || 0, nextXp = D.LEVEL_XP[lv + 1];
    box.appendChild(el("div", { class: "yc-small yc-hero-lv" }, [el("strong", { text: t("yc_lv", { n: lv }) }), " ",
      el("span", { class: "yc-muted", text: nextXp ? t("yc_xp", { a: xp, b: nextXp }) : t("yc_xp_max") })]));
    box.appendChild(el("p", { class: "yc-small", text: L(c.desc) }));
    var paths = el("div", { class: "yc-paths" });
    c.paths.forEach(function (p) {
      var cards = D.CARDS.filter(function (x) { return x.cls === c.id && x.path === p.id; });
      paths.appendChild(el("div", { class: "yc-path" }, [
        el("strong", { text: L(p.name) }),
        el("span", { class: "yc-small yc-muted", text: cards.map(function (x) { return L(x.name) + (x.lv && x.lv > lv ? "🔒" + x.lv : ""); }).join("・") })
      ]));
    });
    box.appendChild(el("div", { class: "yc-small yc-muted", text: t("yc_paths_title") + " " + t("yc_locked_hint") }));
    box.appendChild(paths);
    box.appendChild(el("div", { class: "yc-small yc-muted", text: t("yc_start_deck") + "：" + c.start.map(function (id) { return L(D.CARD[id].name); }).join("・") }));
    return box;
  }

  // ---------------- 入口畫面 ----------------
  function renderEntry() {
    var saved = loadLocal();
    var wrap = el("div", { class: "yc-entry" });
    wrap.appendChild(el("p", { class: "yc-intro", text: t("yc_intro") }));

    if (saved && saved.phase !== "win" && saved.phase !== "lose") {
      wrap.appendChild(el("div", { class: "yc-panel yc-saved" }, [
        el("span", { text: t("yc_saved_found", { act: saved.act + 1, floor: saved.floor + 1 }) }),
        el("button", { type: "button", class: "yc-primary", text: t("yc_continue"), onclick: function () { localSt = saved; mode = "local"; ui.seenLog = saved.logSeq; render(); } })
      ]));
    }

    // 本機
    var local = el("div", { class: "yc-panel" });
    local.appendChild(el("h2", { text: t("yc_local_title") }));
    local.appendChild(el("p", { class: "yc-muted", text: t("yc_local_desc") }));
    var grid = el("div", { class: "yc-seat-grid" });
    ui.setup.forEach(function (s, seat) {
      var taken = ui.setup.filter(function (x, i) { return x && i !== seat; }).map(function (x) { return x.cls; });
      var box = el("div", { class: "yc-seat" + (s ? "" : " yc-seat-empty") });
      box.appendChild(el("div", { class: "yc-seat-pos", text: t("yc_player_n", { n: seat + 1 }) }));
      box.appendChild(heroGrid(s ? s.cls : null, taken, function (cls) { ui.setup[seat] = cls ? { cls: cls, name: s ? s.name : "", ai: !!(s && s.ai), art: s ? s.art : null } : null; render(); }, true));
      if (s) {
        var inp = el("input", { type: "text", class: "yc-text", maxlength: "16", placeholder: L(heroDef(s.cls).name) });
        inp.value = s.name || "";
        inp.addEventListener("input", function () { s.name = inp.value; });
        // AI 隊友（2026-10-23 使用者指定）：勾選後這個位置由電腦操作
        var aiBox = el("input", { type: "checkbox", class: "yc-ai-check", checked: s.ai ? true : null, onchange: function () { s.ai = aiBox.checked; render(); } });
        box.appendChild(el("div", { class: "yc-seat-row" }, [inp, el("label", { class: "yc-ai-label", title: t("yc_ai_desc") }, [aiBox, " 🤖 " + t("yc_ai")])]));
        box.appendChild(artSelect(s.art, function (v) { s.art = v; }));
      }
      grid.appendChild(box);
    });
    local.appendChild(grid);
    local.appendChild(heroInfo(ui.focusHero));
    var count = ui.setup.filter(Boolean).length;
    var humans = ui.setup.filter(function (s) { return s && !s.ai; }).length;
    local.appendChild(modeOptions(ui.opts, function (o) { ui.opts = o; render(); }, true));
    local.appendChild(el("div", { class: "yc-actions" }, [
      el("button", { type: "button", class: "yc-primary", disabled: humans ? null : true, text: t("yc_start_local"), onclick: function () {
        var prof = profile();
        localSt = Core.create({ seats: ui.setup.map(function (s) { return s ? { cls: s.cls, name: s.name, ctrl: s.ai && AI ? AI.CTRL : "local", lv: heroLv(prof, s.cls), art: validArt(s.art) } : null; }),
          torment: Math.min(ui.opts.torment, maxTorment(prof)), endless: ui.opts.endless });
        ui.award = null;
        mode = "local"; ui.seenLog = localSt.logSeq; ui.tab = null;
        saveLocal();
        render();
      } }),
      count && !humans ? el("span", { class: "yc-bad", text: t("yc_need_human") }) : count === 1 ? el("span", { class: "yc-muted", text: t("yc_solo_hint") }) : null
    ]));
    wrap.appendChild(local);

    // 連線
    var net = el("div", { class: "yc-panel" });
    net.appendChild(el("h2", { text: t("yc_net_title") }));
    net.appendChild(el("p", { class: "yc-muted", text: t("yc_net_desc") }));
    var join = el("input", { type: "text", class: "yc-text yc-join", placeholder: t("yc_net_join_ph") });
    join.value = ui.joinText;
    join.addEventListener("input", function () { ui.joinText = join.value; ui.joinBad = false; });
    net.appendChild(el("div", { class: "yc-actions" }, [
      el("button", { type: "button", class: "yc-primary", text: t("yc_net_create"), onclick: function () { openRoom(null); } })
    ]));
    net.appendChild(el("div", { class: "yc-actions" }, [
      join,
      el("button", { type: "button", text: t("yc_net_join"), onclick: function () {
        var Net = window.PriTestYellowNet;
        var raw = String(ui.joinText || "").trim();
        var id = Net.roomFromUrl(raw) || (Net.validRoomId(raw) ? raw : null);
        if (!id) { ui.joinBad = true; render(); return; }
        openRoom(id);
      } }),
      ui.joinBad ? el("span", { class: "yc-bad", text: t("yc_net_join_bad") }) : null
    ]));
    wrap.appendChild(net);

    wrap.appendChild(profilePanel());
    wrap.appendChild(rulesPanel());
    return wrap;
  }

  // 苦痛等級與無盡模式的設定（本機：可編輯；連線：房主可編輯，其他人只看）
  function modeOptions(o, onChange, editable) {
    var box = el("div", { class: "yc-mode-opts" });
    var sel = el("select", { class: "yc-select", disabled: editable ? null : true, onchange: function () { onChange({ torment: Number(sel.value), endless: o.endless }); } });
    for (var i = 0; i <= D.TORMENTS.length; i++) {
      var lockT = editable && i > maxTorment(profile());
      var opt = el("option", { value: String(i), disabled: lockT ? true : null, text: (lockT ? "🔒 " : "") + (i === 0 ? t("yc_torment_none") : t("yc_torment_n", { n: i }) + " — " + L(D.TORMENTS[i - 1].name)) });
      if (i === o.torment) opt.selected = true;
      sel.appendChild(opt);
    }
    var endless = el("input", { type: "checkbox", disabled: editable ? null : true, checked: o.endless ? true : null, onchange: function () { onChange({ torment: o.torment, endless: endless.checked }); } });
    box.appendChild(el("label", { class: "yc-opt" }, [el("span", { text: "😈 " + t("yc_torment") }), sel]));
    box.appendChild(el("label", { class: "yc-opt", title: t("yc_endless_desc") }, [endless, el("span", { text: " ♾️ " + t("yc_endless") })]));
    if (o.torment > 0) {
      var list = el("ul", { class: "yc-torment-list yc-small yc-muted" });
      D.TORMENTS.slice(0, o.torment).forEach(function (x) { list.appendChild(el("li", { text: x.n + ". " + L(x.name) })); });
      box.appendChild(list);
    }
    if (o.endless) box.appendChild(el("div", { class: "yc-small yc-muted", text: t("yc_endless_desc") }));
    if (editable && maxTorment(profile()) < D.TORMENTS.length) box.appendChild(el("div", { class: "yc-small yc-muted", text: t("yc_torment_locked", { n: maxTorment(profile()) }) }));
    return box;
  }

  function rulesPanel() {
    var d = el("details", { class: "yc-panel yc-rules" });
    d.appendChild(el("summary", { text: t("yc_rules_title") }));
    var ul = el("ul");
    for (var i = 1; i <= 20; i++) ul.appendChild(el("li", { text: t("yc_rule_" + i, { n: D.RED_CARD_DMG, m: D.HAND_MAX }) }));
    d.appendChild(ul);
    return d;
  }

  // ---------------- 連線大廳 ----------------
  function netName() { try { return localStorage.getItem(NETNAME_KEY) || ""; } catch (e) { return ""; } }
  function setNetName(n) { try { localStorage.setItem(NETNAME_KEY, n); } catch (e) { /* 只是記不住 */ } }
  function roomUrl(id) { return location.href.split(/[?#]/)[0] + "?room=" + id; }

  // 每個房間的身分（cid）存在 sessionStorage：同一個分頁重新整理後還是同一個人（拿得回自己的英雄）；
  // 用 sessionStorage 而不是 localStorage，同一台電腦開兩個分頁才會是兩個人
  function cidKey(id) { return "pritest-yellow-cid-" + id; }
  function savedCid(id) { try { return id ? sessionStorage.getItem(cidKey(id)) : null; } catch (e) { return null; } }
  function openRoom(id) {
    var Net = window.PriTestYellowNet;
    if (!Net) return;
    if (room) room.leave();
    room = Net.open({ roomId: id, name: netName(), cid: savedCid(id), onChange: onRoomChange, onSignal: onSignal });
    try { sessionStorage.setItem(cidKey(room.id), room.cid); } catch (e) { /* 只是記不住 */ }
    mode = "net";
    ui.seenLog = 0; ui.tab = null; ui.focus = null;
    try { history.replaceState(null, "", roomUrl(room.id)); } catch (e) { /* file:// 等 */ }
    render();
  }

  function leaveRoom() {
    if (room) room.leave();
    room = null; mode = null;
    try { history.replaceState(null, "", location.href.split(/[?#]/)[0]); } catch (e) { /* ignore */ }
    render();
  }

  var renderPending = false;
  function onRoomChange() {
    var act = document.activeElement;
    // 正在輸入名字時先不重畫（會搶走焦點）
    if (act && act.classList && act.classList.contains("yc-name-input")) { renderPending = true; return; }
    renderPending = false;
    render();
  }

  function renderLobby() {
    var wrap = el("div", { class: "yc-panel yc-lobby" });
    if (!room.loaded) { wrap.appendChild(el("p", { text: t("yc_net_connecting") })); return wrap; }
    if (room.missing) {
      wrap.appendChild(el("p", { class: "yc-bad", text: t("yc_net_missing") }));
      wrap.appendChild(el("button", { type: "button", text: t("yc_back"), onclick: leaveRoom }));
      return wrap;
    }
    wrap.appendChild(el("h2", { text: t("yc_lobby_title") }));
    var url = roomUrl(room.id);
    var canvas = el("canvas", { class: "yc-qr" });
    try { window.PriTestQRCode.renderToCanvas(canvas, url, { level: "L", scale: 4, margin: 2 }); } catch (e) { canvas = null; }
    var urlInput = el("input", { type: "text", class: "yc-text yc-url", readonly: true, value: url });
    wrap.appendChild(el("div", { class: "yc-share" }, [
      canvas,
      el("div", {}, [
        el("div", { class: "yc-muted", text: t("yc_lobby_share") }),
        urlInput,
        el("button", { type: "button", text: ui.copied ? t("yc_copied") : t("yc_copy"), onclick: function () {
          try { navigator.clipboard.writeText(url).catch(function () { urlInput.select(); }); } catch (e) { urlInput.select(); }
          ui.copied = true; render();
        } })
      ])
    ]));

    var nameInp = el("input", { type: "text", class: "yc-text yc-name-input", maxlength: "16", placeholder: t("yc_name_ph") });
    nameInp.value = room.name || "";
    nameInp.addEventListener("change", function () { setNetName(nameInp.value); room.setName(nameInp.value); });
    nameInp.addEventListener("blur", function () { if (renderPending) setTimeout(render, 0); });
    wrap.appendChild(el("div", { class: "yc-actions" }, [el("label", { text: t("yc_name") }), nameInp]));

    var grid = el("div", { class: "yc-seat-grid" });
    room.seats.forEach(function (s, seat) {
      var on = s && room.isOnline(s.cid);
      var isMe = s && s.cid === room.cid;
      var isAiSeat = s && AI && s.cid === AI.CTRL;
      var taken = room.seats.filter(function (x, i) { return x && i !== seat && room.isOnline(x.cid); }).map(function (x) { return x.cls; });
      var box = el("div", { class: "yc-seat" + (s ? "" : " yc-seat-empty") + (isMe ? " yc-seat-me" : "") });
      box.appendChild(el("div", { class: "yc-seat-pos", text: t("yc_player_n", { n: seat + 1 }) }));
      if (isAiSeat && room.isHost()) {
        // 房主改 AI 的英雄，或清掉這個 AI
        box.appendChild(heroGrid(s.cls, taken, function (cls) { if (cls) room.setAiSeat(seat, cls, heroLv(profile(), cls)); else room.leaveSeat(seat); }, true));
      } else if (!s || isMe || !on || isAiSeat) {
        box.appendChild(heroGrid(s && (isMe || !on) ? s.cls : null, taken, function (cls) {
          if (cls) room.takeSeat(seat, cls, { lv: heroLv(profile(), cls), art: isMe ? s.art : null }); else room.leaveSeat(seat);
        }, isMe));
        if (isMe) box.appendChild(artSelect(s.art, function (v) { room.takeSeat(seat, s.cls, { lv: heroLv(profile(), s.cls), art: validArt(v) }); }));
      }
      if (AI && room.isHost() && (!s || !on)) {
        var freeCls = D.CLASSES.filter(function (c) { return taken.indexOf(c.id) < 0; })[0];
        if (freeCls) box.appendChild(el("button", { type: "button", class: "yc-small-btn", text: "🤖 " + t("yc_add_ai"), onclick: function () { room.setAiSeat(seat, freeCls.id, heroLv(profile(), freeCls.id)); } }));
      }
      if (s) {
        var c = heroDef(s.cls);
        box.appendChild(el("div", { class: "yc-seat-who" }, [
          el("span", { class: "yc-class-icon", text: c ? c.icon : "?" }),
          el("strong", { text: c ? L(c.name) : "" }),
          el("span", { text: " — " + (isAiSeat ? "🤖 " + t("yc_ai") : (room.nameOf(s.cid) || t("yc_anon")) + (isMe ? t("yc_you") : "") + (on ? "" : t("yc_offline"))) }),
          typeof s.lv === "number" ? el("span", { class: "yc-small yc-muted", text: " " + t("yc_lv", { n: s.lv }) }) : null,
          s.art && D.RELIC[s.art] ? el("span", { class: "yc-small", title: relicName(s.art), text: " 🎒" + D.RELIC[s.art].icon }) : null
        ]));
      } else box.appendChild(el("div", { class: "yc-muted yc-small", text: t("yc_seat_free") }));
      grid.appendChild(box);
    });
    wrap.appendChild(grid);
    wrap.appendChild(heroInfo(ui.focusHero));

    wrap.appendChild(modeOptions(room.opts, function (o) { room.setOpts(o); }, room.isHost()));
    var ps = room.list();
    wrap.appendChild(el("div", { class: "yc-muted", text: t("yc_lobby_people", { n: ps.length }) + ps.map(function (p) { return (p.name || t("yc_anon")) + (room.meta && p.cid === room.meta.host ? "👑" : ""); }).join("、") }));
    wrap.appendChild(el("div", { class: "yc-actions" }, [
      room.isHost() ? el("button", { type: "button", class: "yc-primary", disabled: room.canStart() ? null : true, text: t("yc_start_net"), onclick: function () { room.start(); } })
        : el("span", { class: "yc-muted", text: t("yc_wait_host") }),
      el("button", { type: "button", text: t("yc_leave_room"), onclick: leaveRoom }),
      soundButtons()
    ]));
    return el("div", {}, [wrap, rulesPanel()]);
  }

  // ---------------- 戰場 ----------------
  function incomingBySeat(st) {
    var by = {};
    st.enemies.forEach(function (e) {
      Core.effActs(st, e).forEach(function (a) {
        if (a.k !== "atk") return;
        Core.actTargets(st, e, a).forEach(function (s) { by[s] = (by[s] || 0) + Core.enemyHitValue(st, e, a.n, s) * (a.h || 1); });
      });
    });
    return by;
  }

  // 全範圍牌（不需要目標、不看位置）放到戰場上時會影響誰：{ e:[uid], s:[seat], band }
  //   band＝要亮起來的範圍：near 內圈／far 外圈／any 全場／sec 自己扇形區的外圈／core 英雄區
  function fieldPreview(st, h, d) {
    var out = { e: [], s: [], band: null };
    function add(list) { list.forEach(function (e) { if (out.e.indexOf(e.u) < 0) out.e.push(e.u); }); }
    function band(b) { if (!out.band || out.band === b) out.band = b; else out.band = "any"; }
    d.fx.forEach(function (f) {
      if (f.o === "dmgAll" || f.o === "stAll") { add(Core.inRange(st, f.r || d.rng || "any")); band(f.r || d.rng || "any"); }
      if (f.o === "pushAll") { add(Core.inRange(st, "near").filter(function (e) { return !Core.isBoss(e); })); band("near"); }
      if (f.o === "pullSec") { add(st.enemies.filter(function (e) { return e.ring === "far" && e.sec === Core.secOf(st, h.seat) && !Core.isBoss(e); })); band("sec"); }
      if ((f.o === "sac" && f.k === "dmgAll") || (f.o === "finale" && f.k === "dmgAll")) { add(Core.inRange(st, "any")); band("any"); }
    });
    var allyArea = d.fx.some(function (f) { return f.o === "blkAll" || f.o === "healAll" || f.o === "strAll" || f.o === "cleanseAll" || (f.o === "finale" && /All$/.test(f.k)) || (f.o === "sac" && f.k === "healAll"); });
    if (allyArea) out.s = Core.alive(st).map(function (x) { return x.seat; });
    else if (d.tgt === "self" || d.tgt === "none") out.s = [h.seat];
    if (!out.band && out.s.length) out.band = "core";
    return out;
  }

  function statusBadges(obj, isHero) {
    var row = el("div", { class: "yc-badges" });
    if (obj.blk > 0) row.appendChild(el("span", { class: "yc-badge yc-badge-blk", title: t("yc_block"), text: "🛡" + obj.blk }));
    if (obj.str) row.appendChild(el("span", { class: "yc-badge yc-badge-str", title: t("yc_str"), text: "💪" + obj.str }));
    if (obj.thorns) row.appendChild(el("span", { class: "yc-badge yc-badge-thorns", title: t("yc_thorns_desc", { n: obj.thorns }), text: "🌵" + obj.thorns }));
    (obj.mech || []).forEach(function (m) { row.appendChild(el("span", { class: "yc-badge yc-badge-mech" + (m.on ? " yc-on" : ""), title: m.title, text: m.icon })); });
    ["weak", "vuln", "poison", "burn", "stun", "regen", "charm", "link"].forEach(function (s) {
      if (obj.st && obj.st[s] > 0) row.appendChild(el("span", { class: "yc-badge yc-badge-" + s, title: stName(s) + "：" + t("yc_st_desc_" + s), text: t("yc_sti_" + s) + obj.st[s] }));
    });
    if (isHero) {
      if (obj.sp) row.appendChild(el("span", { class: "yc-badge yc-badge-sp", title: t("yc_spirits_desc", { n: 2 + (obj.pw.spirit || 0) }), text: "🦉" + obj.sp }));
      if (obj.mel) row.appendChild(el("span", { class: "yc-badge yc-badge-mel", title: t("yc_melody_desc"), text: "♪" + obj.mel }));
      if (obj.trap) row.appendChild(el("span", { class: "yc-badge yc-badge-trap", title: t("yc_trap_desc", { n: obj.trap }), text: "🪤" + obj.trap }));
      Object.keys(obj.pw || {}).forEach(function (p) {
        if (obj.pw[p] && p !== "reagent" && p !== "ammoStart") row.appendChild(el("span", { class: "yc-badge yc-badge-pow", title: t("yc_pow_" + p, { n: obj.pw[p] }), text: "✦" + obj.pw[p] }));
      });
      if (obj.taunt) row.appendChild(el("span", { class: "yc-badge yc-badge-taunt", title: t("yc_taunt_desc"), text: "🎯" }));
      if (obj.chi) row.appendChild(el("span", { class: "yc-badge yc-badge-sp", title: t("yc_chi_desc", { n: D.MAX_CHI }), text: "☯" + obj.chi }));
      if (obj.flux) row.appendChild(el("span", { class: "yc-badge yc-badge-sp", title: t("yc_flux_desc", { n: D.MAX_FLUX }), text: "⌛" + obj.flux }));
      if (obj.pw && obj.pw.reagent) row.appendChild(el("span", { class: "yc-badge yc-badge-sp", title: t("yc_rg_desc", { n: Core.reagentNeed(obj) }), text: "🧪" + (obj.rg || 0) + "/" + Core.reagentNeed(obj) }));
      if (obj.form) row.appendChild(el("span", { class: "yc-badge yc-badge-sp", title: t("yc_form_desc_" + obj.form, { n: D.FORMS[obj.form].blk || D.FORMS[obj.form].n }), text: D.FORMS[obj.form].icon + t("yc_form_" + obj.form) }));
      if (obj.later && obj.later.length) row.appendChild(el("span", { class: "yc-badge yc-badge-sp", title: t("yc_later_desc"), text: "⏳" + obj.later.length }));
      newHeroBadges(obj).forEach(function (b) { row.appendChild(el("span", { class: "yc-badge yc-badge-sp", title: b[1], text: b[0] })); });
    }
    return row;
  }

  // 2026-10-24 新英雄的資源標記：[文字, 說明]（只顯示有值的；連擊、彈藥、節拍只給有那個被動的英雄）
  function newHeroBadges(h) {
    var out = [], pw = h.pw || {};
    if (pw.combo !== undefined && h.combo) out.push(["🌀" + h.combo, t("yc_combo_desc", { n: pw.combo })]);
    if (h.dodge) out.push(["👤" + h.dodge, t("yc_dodge_desc", { n: D.MAX_DODGE })]);
    if (h.echo || h.echoAny) out.push(["👥", t("yc_echo_desc")]);
    if (h.edge) out.push(["🗡️" + h.edge, t("yc_edge_desc")]);
    if (h.parry) out.push(["🔁" + h.parry, t("yc_parry_desc", { n: h.parry })]);
    if (h.lastEl) out.push([EL_ICON[h.lastEl] + "→" + EL_ICON[Core.GEN[h.lastEl]], t("yc_lastEl_desc", { a: t("yc_el_" + h.lastEl), b: t("yc_el_" + Core.GEN[h.lastEl]) })]);
    if (h.genWild) out.push(["♾️", t("yc_genWild_desc")]);
    if (h.shiki) out.push(["👺" + h.shiki, t("yc_shiki_desc", { n: D.SHIKI_DMG * h.shiki, m: D.MAX_SHIKI })]);
    if (h.kek) out.push(["⛩️" + h.kek, t("yc_kek_desc", { n: h.kek })]);
    if (pw.ammoTurn !== undefined) out.push(["🔫" + (h.ammo || 0) + "/" + Core.ammoCap(h), t("yc_ammo_desc", { n: pw.ammoTurn })]);
    if (pw.beatBlk !== undefined && h.beat) out.push(["🎵" + h.beat, t("yc_beat_desc", { n: D.MAX_BEAT })]);
    if (pw.ceHit !== undefined && h.ce) out.push(["🌑" + h.ce, t("yc_ce_desc", { n: D.MAX_CE })]);
    if (h.turnAtk) out.push(["💢+" + h.turnAtk, t("yc_turnAtk_desc", { n: h.turnAtk })]);
    if (h.noSkl || pw.noSkl) out.push(["🚫🔰", t("yc_noSkl_desc")]);
    if (h.noBlk) out.push(["🚫🛡", t("yc_noBlk_desc")]);
    if (typeof h.onlyN === "number") out.push(["☝️" + h.onlyN, t("yc_onlyN_desc", { n: h.onlyN })]);
    if (h.half) out.push(["◐", t("yc_half_desc")]);
    if (h.endLose) out.push(["⌛−" + h.endLose, t("yc_endLose_desc", { n: h.endLose })]);
    if (h.debt) out.push(["💸−" + h.debt, t("yc_debt_desc", { n: h.debt })]);
    return out;
  }

  function hpBar(cur, max) {
    var pct = max ? Math.max(0, Math.min(100, cur / max * 100)) : 0;
    return el("div", { class: "yc-hp" }, [el("div", { class: "yc-hp-fill", style: "width:" + pct + "%" }), el("span", { class: "yc-hp-text", text: cur + " / " + max })]);
  }

  function intentText(st, e, a, short) {
    var tg = function () {
      if (short) return "";
      if (a.tgt === "all") return "→" + t("yc_tg_all");
      return "→" + Core.actTargets(st, e, a).map(function (s) { return heroLabel(st, s); }).join("、");
    };
    switch (a.k) {
      case "atk":
        var seats = Core.actTargets(st, e, a);
        var v = seats.length === 1 ? Core.enemyHitValue(st, e, a.n, seats[0]) : Core.enemyHitValue(st, e, a.n, -1);
        return (a.drain ? "🩸" : a.pierce ? "✈" : "⚔") + v + ((a.h || 1) > 1 ? "×" + a.h : "") + (a.drain && !short ? t("yc_int_drain") : "") + (a.pierce && !short ? t("yc_int_pierce") : "") + tg();
      case "blk": return "🛡" + a.n + (a.all ? t("yc_int_allies") : "");
      case "buff": return "💪+" + a.str + (a.all ? t("yc_int_allies") : "");
      case "heal": return "💚" + a.n + (a.all ? t("yc_int_allies") : "");
      case "debuff": return t("yc_sti_" + a.s) + (short ? "" : stName(a.s)) + a.n + tg();
      case "curse": return "🃏" + (short ? "" : L(D.CARD[a.card].name)) + "×" + a.n + tg();
      case "yellow": return "🟨" + (short ? "" : t("yc_int_yellow")) + tg();
      case "summon": return "➕" + (short ? "" : t("yc_int_summon", { name: enemyName(a.id) }));
      case "move": return (a.to === "near" ? "⇣" : "⇡") + (short ? "" : t(a.to === "near" ? "yc_int_advance" : "yc_int_retreat"));
      case "stun": return "💫" + (short ? "" : t("yc_int_stun"));
      case "shatter": return "💔" + (short ? "" : t("yc_int_shatter")) + tg();
      case "purge": return "✨" + (short ? "" : t("yc_int_purge")) + (a.all ? t("yc_int_allies") : "");
      case "swap": return "🎩" + (short ? "" : t("yc_int_swap")) + (a.all ? t("yc_int_allies") : "");
      case "steal": return "🐒" + a.n + (short ? "" : t("yc_int_steal")) + tg();
      case "charm": return "💗⚔" + Core.enemyHitValue(st, e, a.n, -1) + ((a.h || 1) > 1 ? "×" + a.h : "") + (short ? "" : t("yc_int_charm"));
    }
    return a.k;
  }

  function polar(deg, r) { return Core.polar(deg, r); }
  function secSpan(st) { return Core.secSpan(st); }
  function secStart(st, i) { return Core.secStart(st, i); }
  function pctPos(p) { return "left:" + p.x.toFixed(2) + "%;top:" + p.y.toFixed(2) + "%"; }
  // 敵人的特殊機制（2026-10-23）：受庇護、成長、分裂、第二階段 → [{ icon, title, on }]（on＝正在生效）
  function enemyMech(st, e) {
    var d = D.ENEMY[e.id], out = [];
    if (d.ward) out.push({ icon: "🔰", on: Core.warded(st, e), title: t(Core.warded(st, e) ? "yc_mech_ward_on" : "yc_mech_ward_off") });
    if (d.grow) out.push({ icon: "📈", title: t("yc_mech_grow", { n: d.grow }) });
    if (d.split) out.push({ icon: "🧬", title: t("yc_mech_split", { n: d.split.n, name: enemyName(d.split.id) }) });
    if (d.burst) out.push({ icon: "💥", title: t("yc_mech_burst", { n: d.burst }) });
    if (d.rally) out.push({ icon: "📣", title: t("yc_mech_rally", { n: d.rally }) });
    if (d.phase) out.push({ icon: e.ph ? "🔥" : "🌗", on: !!e.ph, title: t(e.ph ? "yc_mech_phase_on" : "yc_mech_phase", { n: Math.round(d.phase.at * 100) }) });
    return out;
  }
  function enemySizeKey(e) { var d = D.ENEMY[e.id]; return d.size || (d.boss ? "boss" : d.elite ? "l" : "m"); }

  // 敵人＝依體型大小的圓點（元素本身就是判定圓）；外圈的環是血量，上方是意圖、下方是血量數字與狀態
  function enemyEl(st, e, pos, prev) {
    var d = D.ENEMY[e.id];
    var acts = Core.effActs(st, e);
    var focus = ui.focus && ui.focus.k === "e" && ui.focus.u === e.u;
    var classes = "yc-enemy yc-kind-" + d.kind + (d.elite ? " yc-elite" : "") + (d.boss ? " yc-boss" : "") + (focus ? " yc-focus" : "") + (prev ? "" : " yc-spawn") + (ui.acting === e.u ? " yc-acting" : "");
    // 意圖、血量盾牌一律掛在離中心較遠的一側，不往中央英雄區伸（中央有英雄資訊牌）：
    // 左半邊的敵人盾牌放左邊、下半邊的敵人意圖放下面
    if (pos.x < 49.5) classes += " yc-side-l";
    if (pos.y > 50.5) classes += " yc-side-b";
    var pct = e.max ? Math.max(0, Math.min(100, e.hp / e.max * 100)) : 0;
    var mech = enemyMech(st, e);
    var title = enemyName(e.id) + "（" + t("yc_size_" + enemySizeKey(e)) + "・" + t("yc_kind_" + d.kind) + "）\n" + acts.map(function (a) { return intentText(st, e, a); }).join("\n") + (d.thorns ? "\n🌵 " + t("yc_thorns_desc", { n: d.thorns }) : "") +
      mech.map(function (m) { return "\n" + m.icon + " " + m.title; }).join("");
    var start = prev && (Math.abs(prev.x - pos.x) > 0.05 || Math.abs(prev.y - pos.y) > 0.05) ? prev : pos;
    var node = el("div", { class: classes, "data-ref": "e" + e.u, title: title,
      style: pctPos(start) + ";width:" + (pos.r * 2).toFixed(2) + "%;--hp:" + pct.toFixed(1),
      onclick: function (ev) { ev.stopPropagation(); ui.focus = focus ? null : { k: "e", u: e.u }; render(); } }, [
      el("div", { class: "yc-enemy-dot" }, [enemyIcon(e.id, "yc-enemy-icon")]),
      // 血量：掛在圓點上的紅色盾牌（使用者指定 2026-10-22）；護盾是旁邊的藍色小盾
      el("span", { class: "yc-enemy-shield", title: e.hp + " / " + e.max, text: e.hp }),
      e.blk ? el("span", { class: "yc-enemy-blk", text: e.blk }) : null,
      el("div", { class: "yc-enemy-int" }, acts.map(function (a) { return el("span", { class: "yc-int yc-int-" + a.k, text: intentText(st, e, a, true) }); })),
      el("div", { class: "yc-enemy-label" }, [statusBadges({ st: e.st, str: e.str, thorns: d.thorns, mech: mech }, false)])
    ]);
    // 被擊退／拉近／隊形重排：從上一次的位置補間過去
    if (start !== pos) requestAnimationFrame(function () { requestAnimationFrame(function () { node.classList.add("yc-moving"); node.style.left = pos.x.toFixed(2) + "%"; node.style.top = pos.y.toFixed(2) + "%"; }); });
    return node;
  }

  // 英雄：小小的剪影（之後換成正式剪影圖；目前是 SVG 人形填英雄色＋胸口職業圖示），
  // 頭頂正上方掛一行小字：剩餘魔力、目前血量、護盾（使用者指定 2026-10-22）
  var SILHOUETTE = "M20 4a8.5 8.5 0 1 1 0 17a8.5 8.5 0 1 1 0-17Z M3 47c0-13 7-21 17-21s17 8 17 21Z";
  // 英雄圖（static_src/images/yellow/heroes/）：<id>_n/e/s/w.png 為戰場上的四方向圖（160×192，南＝面向畫面），
  // <id>_portrait.png 為選角大圖（512×640）。東／西只有一張時，另一邊左右翻轉；沒有圖的英雄用上面的 SVG 剪影
  var HERO_IMG = "../static/images/yellow/heroes/";
  var HERO_ART = {
    paladin: { dirs: "snw", portrait: true },
    mage: { dirs: "snw", portrait: true },
    ranger: { dirs: "senw", portrait: true },
    berserker: { dirs: "senw", portrait: true },
    priest: { dirs: "senw", portrait: true },
    witch: { dirs: "snw", portrait: true },
    summoner: { dirs: "senw", portrait: true },
    bard: { dirs: "senw", portrait: true },
    monk: { dirs: "senw", portrait: true },
    druid: { dirs: "senw", portrait: true },
    chrono: { dirs: "senw", portrait: true },
    alchemist: { dirs: "snw", portrait: true },
    gambler: { dirs: "senw", portrait: true }
  };
  // 敵人圖（static_src/images/yellow/enemies/<id>.png，一般 128×128、首領 256×256，見 docs/yellow_art_guide.md）：
  // 列在這裡的敵人在圓形棋子上顯示圖片，沒有圖的照舊用 emoji
  var ENEMY_IMG = "../static/images/yellow/enemies/";
  var ENEMY_ART = {
    skel: 1, archer: 1, ghoul: 1, bats: 1, cultist: 1, slime: 1, bigslime: 1, slimelet: 1, vampire: 1, knight: 1, witch: 1, giant: 1, bonedragon: 1, lich: 1,
    imp: 1, hound: 1, guard: 1, succubus: 1, salamander: 1, lavaslime: 1, spark: 1, priestess: 1, brute: 1, warlock: 1, lord: 1, colossus: 1, queen: 1,
    lineman: 1, hooligan: 1, shade: 1, golem: 1, heckler: 1, enforcer: 1, var: 1, captain: 1, referee: 1, whistler: 1, scales: 1,
    // 2026-10-24 新區域（其餘新敵人還沒有圖，用 emoji）
    doll: 1, teddy: 1, goat: 1, gunslinger: 1, gladiator: 1, boxer: 1
  };
  function enemyIcon(id, cls) {
    if (ENEMY_ART[id]) return el("img", { class: cls + " yc-enemy-img", src: ENEMY_IMG + id + ".png", alt: "", draggable: "false" });
    return el("span", { class: cls, text: D.ENEMY[id].icon });
  }
  // 面向自己扇形區的外側；站在正中央（單人）時面向畫面
  function heroFacing(pos) {
    var dx = pos.x - 50, dy = pos.y - 50;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return "s";
    if (Math.abs(dy) >= Math.abs(dx)) return dy < 0 ? "n" : "s";
    return dx > 0 ? "e" : "w";
  }
  // 回傳 { src, flip }；沒有可用的圖回傳 null
  function heroSprite(id, dir) {
    var art = HERO_ART[id];
    if (!art || !art.dirs) return null;
    var has = function (d) { return art.dirs.indexOf(d) >= 0; };
    var mirror = { e: "w", w: "e" }[dir];
    if (has(dir)) return { src: HERO_IMG + id + "_" + dir + ".png", flip: false };
    if (mirror && has(mirror)) return { src: HERO_IMG + id + "_" + mirror + ".png", flip: true };
    if (has("s")) return { src: HERO_IMG + id + "_s.png", flip: false };
    return null;
  }
  function heroChip(st, h, pos) {
    var c = heroDef(h.cls);
    var focus = ui.focus && ui.focus.k === "h" && ui.focus.s === h.seat;
    var classes = "yc-hero" + (h.down ? " yc-down" : "") + (h.done && !h.down ? " yc-done" : "") + (mine(h) ? " yc-mine" : "") + (ui.tab === h.seat ? " yc-hero-tab" : "") + (focus ? " yc-focus" : "");
    var offline = !isOnline(h.ctrl);
    var click = function (ev) {
      ev.stopPropagation();
      ui.tab = h.seat; ui.focus = focus ? null : { k: "h", s: h.seat }; render();
    };
    var title = heroName(h) + " — " + L(c.name) + (h.done && !h.down ? " ✓" : "") + (offline ? " " + t("yc_offline") : "");
    var spr = heroSprite(h.cls, heroFacing(pos));
    var fig, kids;
    if (spr) {
      // 腳下一圈英雄代表色的光圈，用來分辨是誰
      fig = el("img", { class: "yc-hero-fig yc-hero-img" + (spr.flip ? " yc-flip" : ""), src: spr.src, alt: "", draggable: "false" });
      kids = [el("span", { class: "yc-hero-ring" }), fig, h.down ? el("span", { class: "yc-hero-icon", text: "💀" }) : null];
    } else {
      fig = svg("svg", { viewBox: "0 0 40 48", class: "yc-hero-fig", "aria-hidden": "true" });
      fig.appendChild(svg("path", { d: SILHOUETTE, class: "yc-hero-fig-body" }));
      kids = [fig, el("span", { class: "yc-hero-icon", text: h.down ? "💀" : c.icon })];
    }
    var pct = h.max ? h.hp / h.max : 0;
    // 頭上只放一行小字（使用者指定 2026-10-22：只放頭上、不要太大，敵人位置要清楚）：
    // 藍＝剩餘魔力、白＝血量（低血量變紅）、淺藍＝護盾（有才顯示）
    var tag = el("div", { class: "yc-hero-tag" + (h.down ? " yc-down" : ""), title: title + "\n" + t("yc_mana") + " " + h.mana + " · HP " + h.hp + " / " + h.max + (h.blk ? " · " + t("yc_block") + " " + h.blk : "") }, [
      el("span", { class: "yc-tag-mana", text: h.mana }),
      el("span", { class: "yc-tag-hp" + (pct <= 0.3 ? " yc-tag-low" : ""), text: h.hp }),
      h.blk ? el("span", { class: "yc-tag-blk", text: h.blk }) : null,
      h.form && D.FORMS[h.form] ? el("span", { text: D.FORMS[h.form].icon }) : null
    ]);
    kids.push(tag);
    var body = el("div", { class: classes + (spr ? " yc-has-img" : ""), style: "--yc-cls:" + c.color + ";" + pctPos(pos), "data-ref": "h" + h.seat, "data-seat": h.seat, title: title, onclick: click }, kids);
    return [body];
  }

  function arcPath(a0, a1, r0, r1) {
    var p1 = polar(a0, r1), p2 = polar(a1, r1), p3 = polar(a1, r0), p4 = polar(a0, r0);
    var large = a1 - a0 > 180 ? 1 : 0;
    return "M" + p1.x + " " + p1.y + " A" + r1 + " " + r1 + " 0 " + large + " 1 " + p2.x + " " + p2.y +
      " L" + p3.x + " " + p3.y + " A" + r0 + " " + r0 + " 0 " + large + " 0 " + p4.x + " " + p4.y + " Z";
  }
  // 環形（r0～r1）：用粗線畫圓
  function ringShape(r0, r1, cls) { return svg("circle", { cx: 50, cy: 50, r: (r0 + r1) / 2, "stroke-width": r1 - r0, class: cls, fill: "none" }); }

  function arenaBackground(st) {
    var n = Core.sectorCount(st);
    var s = svg("svg", { viewBox: "0 0 100 100", class: "yc-arena-bg", "aria-hidden": "true" });
    st.secs.forEach(function (seat, i) {
      var h = Core.hero(st, seat);
      var color = heroDef(h.cls).color;
      if (n === 1) {
        s.appendChild(svg("circle", { cx: 50, cy: 50, r: (R_MID + R_EDGE) / 2, fill: "none", stroke: color, "stroke-opacity": 0.13, "stroke-width": R_EDGE - R_MID }));
        s.appendChild(svg("circle", { cx: 50, cy: 50, r: (R_CORE + R_MID) / 2, fill: "none", stroke: color, "stroke-opacity": 0.24, "stroke-width": R_MID - R_CORE }));
        return;
      }
      var a0 = secStart(st, i), a1 = a0 + secSpan(st);
      s.appendChild(svg("path", { d: arcPath(a0, a1, R_MID, R_EDGE), fill: color, "fill-opacity": 0.13 }));
      s.appendChild(svg("path", { d: arcPath(a0, a1, R_CORE, R_MID), fill: color, "fill-opacity": 0.24 }));
      var pa = polar(a0, R_CORE), pb = polar(a0, R_EDGE);
      s.appendChild(svg("line", { x1: pa.x, y1: pa.y, x2: pb.x, y2: pb.y, class: "yc-arena-line" }));
    });
    [R_CORE, R_MID, R_EDGE].forEach(function (r) { s.appendChild(svg("circle", { cx: 50, cy: 50, r: r, class: "yc-arena-ring" })); });
    return s;
  }

  // 點選的敵人／英雄：哪些敵人的行動指向哪些英雄
  function focusLinks(st) {
    var f = ui.focus;
    if (!f) return [];
    if (f.k === "e" && !Core.enemy(st, f.u)) { ui.focus = null; return []; }
    if (f.k === "h" && !Core.hero(st, f.s)) { ui.focus = null; return []; }
    var by = {};
    var out = [];
    st.enemies.forEach(function (e) {
      if (f.k === "e" && f.u !== e.u) return;
      Core.effActs(st, e).forEach(function (a) {
        if (["atk", "debuff", "curse", "yellow"].indexOf(a.k) < 0) return;
        Core.actTargets(st, e, a).forEach(function (seat) {
          if (f.k === "h" && f.s !== seat) return;
          var key = e.u + ":" + seat;
          var l = by[key];
          if (!l) { l = by[key] = { e: e, seat: seat, atk: 0, bits: [] }; out.push(l); }
          if (a.k === "atk") l.atk += Core.enemyHitValue(st, e, a.n, seat) * (a.h || 1);
          l.bits.push(intentText(st, e, a, true));
        });
      });
    });
    return out;
  }

  function drawLinks(layer, st, links) {
    var lay = ui.lay;
    links.forEach(function (l) {
      var pe = lay.e[l.e.u], ph = lay.h[l.seat];
      if (!pe || !ph) return;
      var dx = ph.x - pe.x, dy = ph.y - pe.y, len = Math.sqrt(dx * dx + dy * dy) || 1;
      var ux = dx / len, uy = dy / len;
      var x1 = pe.x + ux * (pe.r + 0.6), y1 = pe.y + uy * (pe.r + 0.6), x2 = ph.x - ux * 2.4, y2 = ph.y - uy * 2.4;
      // 點英雄：從英雄拉到每一個會打他的敵人（使用者指定 2026-10-22）；點敵人：從敵人拉到牠的目標
      if (ui.focus && ui.focus.k === "h") { var tx = x1, ty = y1; x1 = x2; y1 = y2; x2 = tx; y2 = ty; }
      var cls = "yc-link " + (l.atk ? "yc-link-atk" : "yc-link-fx");
      layer.appendChild(svg("line", { x1: x1, y1: y1, x2: x2, y2: y2, class: cls, "marker-end": "url(#yc-arrow" + (l.atk ? "" : "-fx") + ")" }));
      // 標籤放在靠敵人的那一端（英雄的資訊牌在中心附近）
      var lt = ui.focus && ui.focus.k === "h" ? 0.68 : 0.32;
      var mx = x1 + (x2 - x1) * lt, my = y1 + (y2 - y1) * lt;
      var label = svg("text", { x: mx, y: my, class: "yc-link-label" + (l.atk ? " yc-link-label-atk" : ""), "text-anchor": "middle", "dominant-baseline": "middle" });
      label.textContent = l.bits.join(" ");
      layer.appendChild(label);
    });
  }

  function svgDefs() {
    var defs = svg("defs", {});
    [["yc-arrow", "yc-arrow-atk"], ["yc-arrow-fx", "yc-arrow-fx"], ["yc-arrow-aim", "yc-arrow-aim"], ["yc-arrow-aim-ally", "yc-arrow-aim-ally"]].forEach(function (x) {
      var m = svg("marker", { id: x[0], viewBox: "0 0 10 10", refX: 7, refY: 5, markerWidth: 4, markerHeight: 4, orient: "auto-start-reverse" });
      m.appendChild(svg("path", { d: "M0 0 L10 5 L0 10 Z", class: x[1] }));
      defs.appendChild(m);
    });
    return defs;
  }

  function focusPanel(st, links, incoming) {
    var f = ui.focus;
    var box = el("div", { class: "yc-focus-panel" });
    if (!f) { box.classList.add("yc-focus-empty"); box.appendChild(el("span", { class: "yc-muted", text: t("yc_focus_tip") })); return box; }
    if (f.k === "e") {
      var e = Core.enemy(st, f.u), d = D.ENEMY[e.id];
      box.appendChild(el("div", { class: "yc-focus-head" }, [
        enemyIcon(e.id, "yc-focus-icon"),
        el("strong", { text: enemyName(e.id) }),
        el("span", { class: "yc-muted yc-small", text: t("yc_size_" + enemySizeKey(e)) + "・" + t("yc_kind_" + d.kind) })
      ]));
      box.appendChild(hpBar(e.hp, e.max));
      box.appendChild(statusBadges(e, false));
      box.appendChild(el("div", { class: "yc-intents" }, Core.effActs(st, e).map(function (a) { return el("div", { class: "yc-int yc-int-" + a.k, text: intentText(st, e, a) }); })));
      if (!links.length) box.appendChild(el("div", { class: "yc-muted yc-small", text: t("yc_focus_none_e") }));
    } else {
      var h = Core.hero(st, f.s);
      var n = incoming[h.seat] || 0;
      box.appendChild(el("div", { class: "yc-focus-head" }, [el("span", { class: "yc-focus-icon", text: heroDef(h.cls).icon }), el("strong", { text: heroName(h) })]));
      box.appendChild(statusBadges(h, true));
      box.appendChild(el("div", { class: "yc-small", text: links.length ? t("yc_focus_hero", { name: heroName(h), n: n, w: Math.max(0, n - h.blk) }) : t("yc_focus_none_h", { name: heroName(h) }) }));
    }
    return box;
  }

  function renderBoard(st) {
    var incoming = incomingBySeat(st);
    var n = Core.sectorCount(st);
    var lay = ui.lay = Core.layout(st);
    var prev = ui.enemyPos || {};
    ui.enemyPos = {};
    var board = el("div", { class: "yc-arena" + (ui.pingMode ? " yc-pinging" : ""), onclick: function () { if (ui.focus) { ui.focus = null; render(); } } });
    // 標記模式：點哪裡都先當成標記（攔在敵人／英雄的點擊之前）；右鍵＝直接標記
    board.addEventListener("click", function (ev) {
      if (!ui.pingMode || (ev.target.closest && ev.target.closest(".yc-signal-bar"))) return;
      ev.stopPropagation(); ev.preventDefault();
      ui.pingMode = false;
      pingAt(ev.clientX, ev.clientY);
      render();
    }, true);
    board.addEventListener("contextmenu", function (ev) { ev.preventDefault(); pingAt(ev.clientX, ev.clientY); });
    board.appendChild(arenaBackground(st));
    // 內外圈標示放在第 0 區的起始邊界上（避開敵人；單人時放正下方）
    var la = n === 1 ? 180 : secStart(st, 0);
    [["near", (R_CORE + R_MID) / 2], ["far", (R_MID + R_EDGE) / 2]].forEach(function (x) {
      var p = polar(la, x[1]);
      board.appendChild(el("span", { class: "yc-ring-label", style: pctPos(p), text: t("yc_zone_" + x[0]) }));
    });
    // 拖曳時的範圍預覽（範圍圈／環形）放在敵人下面；虛線與打擊演出放在最上層
    var aim = svg("svg", { viewBox: "0 0 100 100", class: "yc-arena-aim", "aria-hidden": "true" });
    board.appendChild(aim);
    st.enemies.forEach(function (e) {
      var pos = lay.e[e.u];
      if (!pos) return;
      board.appendChild(enemyEl(st, e, pos, prev[e.u]));
      ui.enemyPos[e.u] = { x: pos.x, y: pos.y, r: pos.r, icon: D.ENEMY[e.id].icon };
    });
    // 已經不在場上的敵人保留到這次的演出用完（擊殺消散）
    Object.keys(prev).forEach(function (u) { if (u.charAt(0) !== "x" && !ui.enemyPos[u]) ui.enemyPos["x" + u] = prev[u]; });
    st.secs.forEach(function (seat, i) {
      heroChip(st, Core.hero(st, seat), lay.h[seat]).forEach(function (node) { board.appendChild(node); });
    });
    var fx = svg("svg", { viewBox: "0 0 100 100", class: "yc-arena-fx", "aria-hidden": "true" });
    fx.appendChild(svgDefs());
    var links = focusLinks(st);
    drawLinks(fx, st, links);
    board.appendChild(fx);
    board.appendChild(svg("svg", { viewBox: "0 0 100 100", class: "yc-arena-arc", "aria-hidden": "true" }));
    board.appendChild(signalBar(st));
    if (ui.legend) board.appendChild(legendPanel());
    else if (!ui.replay) { var tc = tutCard(); if (tc) board.appendChild(tc); }
    return el("div", { class: "yc-arena-wrap yc-rg-" + Core.actDef(st).id }, [board, focusPanel(st, links, incoming)]);
  }

  // ---------------- 手牌區（扇形） ----------------
  function defaultTab(st) {
    var hs = Core.heroes(st);
    if (ui.tab !== null && Core.hero(st, ui.tab)) return ui.tab;
    var m = hs.filter(function (h) { return mine(h) && !h.down && !h.done; })[0] || hs.filter(mine)[0] || hs[0];
    return m ? m.seat : null;
  }

  function renderHands(st) {
    var tab = ui.tab = defaultTab(st);
    var wrap = el("div", { class: "yc-hands" });
    var tabs = el("div", { class: "yc-tabs" });
    Core.heroes(st).forEach(function (h) {
      var c = heroDef(h.cls);
      tabs.appendChild(el("button", { type: "button", class: "yc-tab" + (h.seat === tab ? " yc-on" : "") + (mine(h) ? " yc-tab-mine" : ""), style: "--yc-cls:" + c.color,
        onclick: function () { ui.tab = h.seat; render(); } }, [
        c.icon + " " + heroName(h), h.down ? " 💀" : h.done ? " ✓" : mine(h) ? " ●" : ""
      ]));
    });
    wrap.appendChild(tabs);
    var h = Core.hero(st, tab);
    if (!h) return wrap;
    // 敵人回合重播中不能操作
    var own = mine(h) && !ui.replay;
    // 資訊列：魔力・牌堆・狀態・遺物，右邊是結束回合（手牌區要矮，戰場和手牌才能同時放進畫面）
    wrap.appendChild(el("div", { class: "yc-hand-info" }, [
      el("span", { class: "yc-mana-big", title: t("yc_mana") }, [t("yc_mana") + " ", el("strong", { text: h.mana })]),
      el("span", { class: "yc-muted", text: (handHidden(h) ? t("yc_hand_n", { n: h.hand.length }) + " · " : "") + t("yc_piles_rest", { c: h.disc.length, x: h.exh.length }) }),
      el("button", { type: "button", class: "yc-link", text: t("yc_view_deck"), onclick: function () { ui.deckView = h.seat; render(); } }),
      own || ui.replay || isAi(h) ? null : el("span", { class: "yc-muted", text: t("yc_not_yours") }),
      !isOnline(h.ctrl) ? el("span", { class: "yc-tag-off", text: t("yc_offline") }) : null,
      isAi(h) ? el("span", { class: "yc-muted", text: "🤖 " + t("yc_ai_playing") }) : null,
      !isOnline(h.ctrl) && room && room.isHost() ? el("button", { type: "button", class: "yc-small-btn", text: t("yc_takeover"), onclick: function () { send({ t: "take", s: h.seat }); } }) : null,
      // 自己的英雄被代打中：可以拿回來
      mode === "net" && room && h.owner === room.cid && h.ctrl !== room.cid ? el("button", { type: "button", class: "yc-small-btn", text: t("yc_reclaim"), onclick: function () { send({ t: "reclaim", s: h.seat }); } }) : null,
      statusBadges(h, true),
      relicRow(h),
      own && !h.down ? el("span", { class: "yc-hand-end" }, [
        el("span", { class: "yc-muted yc-small", text: t("yc_waiting", { n: Core.alive(st).filter(function (x) { return !x.done; }).length }) }),
        el("button", { type: "button", class: h.done ? "" : "yc-primary yc-end", text: h.done ? t("yc_unend") : t("yc_end_turn"), onclick: function () { send({ t: "end", s: h.seat, on: !h.done }); } })
      ]) : null
    ]));
    var hint = ui.replay ? t("yc_enemy_acting") : own && !h.done && !h.down ? t("yc_hint_pick") : "";
    if (ui.err) hint = ui.err;
    wrap.appendChild(el("div", { class: "yc-hint" + (ui.err ? " yc-bad" : ""), text: hint }));
    var fan = el("div", { class: "yc-fan", "data-seat": h.seat, onpointerleave: function () { ui.hover = -1; layoutFan(fan); } });
    // 手牌左邊是抽牌堆，上方顯示剩下幾張（2026-10-23 使用者指定）
    var body = el("div", { class: "yc-hand-body" }, [drawPileEl(h), fan]);
    // 連線時看不到別人的手牌（使用者指定 2026-10-22）：只畫卡背，不能滑過、拖曳或看說明；戰場資訊照舊共享
    if (handHidden(h)) {
      h.hand.forEach(function (c, i) {
        fan.appendChild(el("div", { class: "yc-slot yc-slot-back", "data-i": i }, [el("div", { class: "yc-card yc-card-back", style: "--yc-cls:" + heroDef(h.cls).color }, [el("span", { text: "🟨" })])]));
      });
      if (!h.hand.length) fan.appendChild(el("div", { class: "yc-muted yc-fan-empty", text: h.down ? t("yc_is_down") : t("yc_empty_hand") }));
      wrap.appendChild(body);
      return wrap;
    }
    h.hand.forEach(function (c, i) {
      var playable = own && Core.canPlay(st, h, c);
      var vt = Core.validTargets(st, h, c);
      var d = Core.cardDef(c);
      var noTarget = ((d.tgt === "enemy" || d.tgt === "area") && !vt.e.length) || ((d.tgt === "ally" || d.tgt === "down") && !vt.s.length);
      var slot = el("div", { class: "yc-slot", "data-u": c.u, "data-i": i, title: noTarget && playable ? t("yc_no_target") : null,
        onpointerenter: function () { if (!drag) { ui.hover = i; layoutFan(fan); } },
        onpointerdown: function (ev) { startDrag(ev, h.seat, c.u, slot, playable && !noTarget); } }, [
        cardEl(c, { tag: "div", hero: h, disabled: !playable || noTarget })
      ]);
      fan.appendChild(slot);
    });
    if (!h.hand.length) fan.appendChild(el("div", { class: "yc-muted yc-fan-empty", text: h.down ? t("yc_is_down") : t("yc_empty_hand") }));
    wrap.appendChild(body);
    return wrap;
  }

  // 抽牌堆：卡背疊起來（最多 3 層），上方是張數；點一下看牌組（內容不公開，只看得到整副牌組）
  function drawPileEl(h) {
    var n = h.draw.length;
    var stack = [];
    for (var i = Math.min(3, n) - 1; i >= 0; i--) stack.push(el("div", { class: "yc-pile-card", style: "--i:" + i }));
    return el("button", { type: "button", class: "yc-pile" + (n ? "" : " yc-pile-empty"), style: "--yc-cls:" + heroDef(h.cls).color,
      title: t("yc_draw_pile_n", { n: n }), onclick: function () { ui.deckView = h.seat; render(); } }, [
      el("span", { class: "yc-pile-n", text: String(n) }),
      el("div", { class: "yc-pile-stack" }, stack),
      el("span", { class: "yc-pile-label", text: t("yc_pile_label") })
    ]);
  }

  // 戰場縮放：上方資訊列＋戰場＋手牌要能同時放進畫面（2026-10-23 使用者指定手牌要看得到、放在戰場下方）
  function fitArena() {
    var a = app.querySelector(".yc-arena"), wrap = app.querySelector(".yc-arena-wrap"), hands = app.querySelector(".yc-hands"), top = app.querySelector(".yc-topbar");
    if (!a || !wrap || !hands) return;
    var rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    var other = (top ? top.offsetHeight : 0) + (wrap.offsetHeight - a.offsetHeight) + hands.offsetHeight + rem * 2.2;
    var size = Math.max(15 * rem, Math.min(wrap.clientWidth - 4, 46 * rem, window.innerHeight - other));
    a.style.width = Math.floor(size) + "px";
  }

  // 連線模式下別人的英雄：手牌與抽牌堆內容不公開（本機模式一台裝置操作所有人，全部公開）
  function handHidden(h) { return mode === "net" && !mine(h); }

  // 扇形排列：中間的牌最高、兩邊往下彎並旋轉；滑過的牌抽起來，兩旁的牌往外讓開
  function layoutFan(fan) {
    if (!fan || !fan.isConnected) return;
    var slots = Array.prototype.slice.call(fan.querySelectorAll(".yc-slot"));
    var n = slots.length;
    if (!n) return;
    var w = fan.clientWidth, cw = slots[0].offsetWidth || 120;
    var gap = n > 1 ? Math.max(cw * 0.22, Math.min(cw * 0.72, (w - cw * 1.3) / (n - 1))) : 0; // 兩端的牌會旋轉，多留一點邊（左邊是抽牌堆）
    var hov = drag && drag.started ? -1 : ui.hover;
    if (hov >= n) hov = -1;
    var push = hov >= 0 ? Math.max(0, Math.min(cw * 0.45, cw * 0.82 - gap)) : 0;
    var rotStep = Math.min(6, 34 / Math.max(1, n));
    slots.forEach(function (slot, i) {
      var off = i - (n - 1) / 2;
      var x = off * gap + (hov >= 0 && i !== hov ? (i < hov ? -push : push) : 0);
      var y = Math.abs(off) * Math.abs(off) * Math.min(4, 14 / n);
      var lift = i === hov;
      slot.style.setProperty("--x", x.toFixed(1) + "px");
      slot.style.setProperty("--y", y.toFixed(1) + "px");
      // 點擊範圍（slot）維持原本的角度，抽起來時只把裡面的卡面轉正（不然滑鼠會從轉開的邊角掉出去）
      slot.style.setProperty("--rot", (off * rotStep).toFixed(2) + "deg");
      slot.style.zIndex = lift ? 60 : 10 + i;
      slot.classList.toggle("yc-lift", lift);
    });
    // 第一次排好之前不要補間（不然每次重畫都會從中間散開）
    if (!fan.classList.contains("yc-ready")) { void fan.offsetWidth; fan.classList.add("yc-ready"); }
  }

  // ---------------- 拖曳出牌 ----------------
  // drag：{ seat, u, slot, playable, sx, sy, started, ghost, detail, aim }
  var drag = null;
  var renderDeferred = false;
  var detailEl = null;      // 旁邊的完整說明（拖出一半／點一下手牌時）

  function arenaPoint(cx, cy) {
    var a = app.querySelector(".yc-arena");
    if (!a) return null;
    var r = a.getBoundingClientRect();
    var x = (cx - r.left) / r.width * 100, y = (cy - r.top) / r.height * 100;
    var dist = Math.sqrt((x - 50) * (x - 50) + (y - 50) * (y - 50));
    return { x: x, y: y, inside: dist <= 50 };
  }
  function arenaToClient(x, y) {
    var a = app.querySelector(".yc-arena");
    if (!a) return null;
    var r = a.getBoundingClientRect();
    return { x: r.left + r.width * x / 100, y: r.top + r.height * y / 100 };
  }
  function dragCard() {
    var st = game();
    var h = st && Core.hero(st, drag.seat);
    if (!h || st.phase !== "battle") return null;
    var c = null;
    h.hand.forEach(function (x) { if (x.u === drag.u) c = x; });
    return c ? { st: st, h: h, c: c, d: Core.cardDef(c) } : null;
  }

  function startDrag(ev, seat, u, slot, playable) {
    if (drag || ui.replay || (ev.button !== undefined && ev.button !== 0)) return;
    ev.preventDefault();
    drag = { seat: seat, u: u, slot: slot, playable: playable, sx: ev.clientX, sy: ev.clientY, started: false, ghost: null, aim: null };
    hideDetail();
  }

  function setHint(text, bad) {
    var hint = app.querySelector(".yc-hint");
    if (!hint) return;
    hint.textContent = text;
    hint.classList.toggle("yc-bad", !!bad);
  }

  function clearAim() {
    Array.prototype.forEach.call(app.querySelectorAll(".yc-aim, .yc-aim-sub, .yc-valid"), function (n) { n.classList.remove("yc-aim", "yc-aim-sub", "yc-valid"); });
    Array.prototype.forEach.call(app.querySelectorAll(".yc-arena-aim, .yc-arena-arc"), function (l) { l.innerHTML = ""; });
    var a = app.querySelector(".yc-arena");
    if (a) a.classList.remove("yc-targeting");
  }
  function mark(ref, cls) { var n = app.querySelector('[data-ref="' + ref + '"]'); if (n) n.classList.add(cls); }

  // 拖到戰場上：依卡的目標種類算出預覽，回傳出牌用的 tg（不能出牌時為 null）
  // 拖曳預覽（使用者指定 2026-10-22）：卡牌進入戰場後隱藏，只剩一條從出牌角色身上拋出去的虛線拋物線
  function aimArc(from, to, on, ally) {
    var layer = app.querySelector(".yc-arena-arc");
    if (!layer || !from || !to) return;
    layer.appendChild(svg("path", { d: arcD(from, to), class: "yc-aim-arc" + (on ? " yc-aim-arc-on" : "") + (ally ? " yc-aim-arc-ally" : ""),
      "marker-end": on ? "url(#yc-arrow-aim" + (ally ? "-ally" : "") + ")" : "" }));
    layer.appendChild(svg("circle", { cx: to.x, cy: to.y, r: 0.7, class: "yc-aim-dot" + (ally ? " yc-aim-dot-ally" : "") }));
  }

  function updateAim(info, p) {
    clearAim();
    var st = info.st, h = info.h, d = info.d, c = info.c;
    var layer = app.querySelector(".yc-arena-aim");
    var arena = app.querySelector(".yc-arena");
    if (!layer || !arena) return null;
    arena.classList.add("yc-targeting");
    var vt = Core.validTargets(st, h, c);
    var lay = ui.lay;
    var hp = lay.h[h.seat];
    if (d.tgt === "enemy") {
      vt.e.forEach(function (u) { mark("e" + u, "yc-valid"); });
      // 判定圓（＋一點寬容）內最近的合法目標
      var best = null, bd = 1e9;
      vt.e.forEach(function (u) {
        var q = lay.e[u];
        if (!q) return;
        var dd = Math.sqrt((q.x - p.x) * (q.x - p.x) + (q.y - p.y) * (q.y - p.y));
        if (dd <= q.r + 2.6 && dd < bd) { bd = dd; best = u; }
      });
      aimArc(hp, best ? lay.e[best] : p, !!best);
      if (!best) { setHint(t("yc_hint_drag_enemy")); return null; }
      mark("e" + best, "yc-aim");
      // 連鎖閃電：同一扇形區的敵人也會被打到
      if (d.fx.some(function (f) { return f.o === "dmgSec"; })) {
        var te = Core.enemy(st, best);
        st.enemies.forEach(function (e) { if (e.u !== best && e.sec === te.sec) mark("e" + e.u, "yc-aim-sub"); });
      }
      setHint(t("yc_hint_drag_enemy"));
      return { e: best };
    }
    if (d.tgt === "ally" || d.tgt === "down") {
      vt.s.forEach(function (s) { mark("h" + s, "yc-valid"); });
      var hit = null, hd2 = 1e9;
      vt.s.forEach(function (s) {
        var q = lay.h[s];
        var dd = Math.sqrt((q.x - p.x) * (q.x - p.x) + (q.y - p.y) * (q.y - p.y));
        if (dd <= 4 && dd < hd2) { hd2 = dd; hit = s; }
      });
      aimArc(hp, hit !== null ? lay.h[hit] : p, hit !== null, true);
      setHint(t("yc_hint_drag_ally"));
      if (hit === null) return null;
      mark("h" + hit, "yc-aim");
      return { s: hit };
    }
    if (d.tgt === "area") {
      var R = D.AREA_R[d.ar] || D.AREA_R.m;
      var hits = Core.areaHits(st, d, p.x, p.y);
      vt.e.forEach(function (u) { mark("e" + u, "yc-valid"); });
      hits.forEach(function (e) { mark("e" + e.u, "yc-aim"); });
      layer.appendChild(svg("circle", { cx: p.x, cy: p.y, r: R, class: "yc-aim-zone" + (hits.length ? " yc-aim-zone-on" : "") }));
      aimArc(hp, p, hits.length > 0);
      setHint(hits.length ? t("yc_hint_drag_area") : t("yc_hint_drag_area_empty"), !hits.length);
      return hits.length ? { x: p.x, y: p.y } : null;
    }
    // 全範圍牌／自己用的牌：放在戰場任一處
    var fp = fieldPreview(st, h, d);
    fp.e.forEach(function (u) { mark("e" + u, "yc-aim"); });
    fp.s.forEach(function (s) { mark("h" + s, "yc-aim"); });
    if (fp.band === "near") layer.appendChild(ringShape(R_CORE, R_MID, "yc-aim-band"));
    else if (fp.band === "far") layer.appendChild(ringShape(R_MID, R_EDGE, "yc-aim-band"));
    else if (fp.band === "any") layer.appendChild(ringShape(R_CORE, R_EDGE, "yc-aim-band"));
    else if (fp.band === "core") layer.appendChild(svg("circle", { cx: 50, cy: 50, r: R_CORE, class: "yc-aim-band yc-aim-band-ally" }));
    else if (fp.band === "sec") {
      var i = Core.secOf(st, h.seat), n = Core.sectorCount(st);
      if (n === 1) layer.appendChild(ringShape(R_MID, R_EDGE, "yc-aim-band"));
      else layer.appendChild(svg("path", { d: arcPath(secStart(st, i), secStart(st, i) + secSpan(st), R_MID, R_EDGE), class: "yc-aim-band yc-aim-band-fill" }));
    }
    aimArc(hp, p, true, !fp.e.length);
    setHint(t("yc_hint_drag_field"));
    return { field: true };
  }

  function showDetail(info, cx, cy, ghostRect) {
    if (!detailEl) {
      detailEl = cardEl(info.c, { tag: "div", hero: info.h, extra: "yc-card-detail" });
      document.body.appendChild(detailEl);
    }
    var dw = detailEl.offsetWidth, dh = detailEl.offsetHeight;
    var r = ghostRect || { left: cx - 60, right: cx + 60, top: cy - 80 };
    var left = r.right + 12;
    if (left + dw > window.innerWidth - 8) left = r.left - dw - 12;
    if (left < 8) left = 8;
    var top = Math.max(8, Math.min(window.innerHeight - dh - 8, r.top));
    detailEl.style.left = left + "px";
    detailEl.style.top = top + "px";
  }
  function hideDetail() {
    if (detailEl && detailEl.parentNode) detailEl.parentNode.removeChild(detailEl);
    detailEl = null;
  }

  function moveDrag(ev) {
    if (!drag) return;
    var info = dragCard();
    if (!info) { endDrag(false); return; }
    if (!drag.started) {
      if (Math.abs(ev.clientX - drag.sx) + Math.abs(ev.clientY - drag.sy) < 7) return;
      drag.started = true;
      drag.slot.classList.add("yc-slot-out");
      drag.ghost = cardEl(info.c, { tag: "div", hero: info.h, extra: "yc-ghost" + (drag.playable ? "" : " yc-card-off") });
      document.body.appendChild(drag.ghost);
      layoutFan(drag.slot.parentNode);
    }
    ev.preventDefault();
    var p = arenaPoint(ev.clientX, ev.clientY);
    var fan = drag.slot.parentNode;
    var fr = fan && fan.getBoundingClientRect();
    var overHand = fr && ev.clientY >= fr.top - 10;
    var onField = p && p.inside && !overHand;
    drag.ghost.classList.toggle("yc-ghost-field", !!onField);
    drag.ghost.style.left = ev.clientX + "px";
    drag.ghost.style.top = ev.clientY + "px";
    if (onField && drag.playable) {
      hideDetail();
      drag.aim = updateAim(info, p);
      drag.ghost.classList.toggle("yc-ghost-ok", !!drag.aim);
    } else {
      // 半脫出：還沒到戰場（或這張不能出）就在旁邊顯示完整說明
      clearAim();
      drag.aim = null;
      drag.ghost.classList.remove("yc-ghost-ok");
      showDetail(info, ev.clientX, ev.clientY, drag.ghost.getBoundingClientRect());
      setHint(drag.playable ? t("yc_hint_drag_read") : t("yc_hint_drag_off"), !drag.playable && onField);
    }
  }

  function upDrag(ev) {
    if (!drag) return;
    if (!drag.started) {
      // 點一下（沒有拖）：在旁邊顯示完整說明，再點別處收起
      var info0 = dragCard();
      var slot = drag.slot;
      drag = null;
      if (info0 && slot.isConnected) {
        var r = slot.getBoundingClientRect();
        showDetail(info0, ev.clientX, ev.clientY, { left: r.left, right: r.right, top: r.top - r.height * 0.4 });
      }
      return;
    }
    var info = dragCard();
    var tg = drag.aim;
    if (info && tg && drag.playable) {
      // 卡牌在戰場上已經隱藏（只剩拋物線），放開就出牌；彈道由出牌演出接手
      var action = { t: "play", s: info.h.seat, u: info.c.u, tg: tg.field ? null : tg };
      endDrag(false);
      send(action);
      return;
    }
    endDrag(true);
  }

  function endDrag(cancelled) {
    if (!drag) return;
    var d0 = drag;
    drag = null;
    hideDetail();
    clearAim();
    if (d0.slot) d0.slot.classList.remove("yc-slot-out");
    if (d0.ghost) {
      var g = d0.ghost;
      if (cancelled && d0.slot && d0.slot.isConnected) {
        var r = d0.slot.getBoundingClientRect();
        g.classList.remove("yc-ghost-field");
        g.classList.add("yc-ghost-back");
        g.style.left = (r.left + r.width / 2) + "px";
        g.style.top = (r.top + r.height / 2) + "px";
        setTimeout(function () { if (g.parentNode) g.parentNode.removeChild(g); }, 200);
      } else if (g.parentNode) g.parentNode.removeChild(g);
    }
    if (cancelled) {
      var st = game();
      var h = st && Core.hero(st, ui.tab);
      setHint(h && mine(h) && !h.done && !h.down ? t("yc_hint_pick") : "");
      if (d0.slot) layoutFan(d0.slot.parentNode);
    }
    if (renderDeferred) { renderDeferred = false; render(); }
  }

  document.addEventListener("pointermove", moveDrag, { passive: false });
  document.addEventListener("pointerup", upDrag);
  document.addEventListener("pointercancel", function () { endDrag(true); });
  document.addEventListener("pointerdown", function (ev) {
    if (!drag && !(ev.target.closest && ev.target.closest(".yc-slot"))) hideDetail();
  });
  window.addEventListener("resize", function () { fitArena(); layoutFan(app.querySelector(".yc-fan")); });

  // ---------------- 紀錄 ----------------
  function refName(st, r) {
    if (!r) return "";
    if (r.k === "h") return heroLabel(st, r.s);
    return D.ENEMY[r.id] ? D.ENEMY[r.id].icon + enemyName(r.id) : "?";
  }

  function logText(st, e) {
    var to = refName(st, e.to);
    switch (e.t) {
      case "play": return t(e.to ? "yc_log_play_to" : "yc_log_play", { a: heroLabel(st, e.s), c: L(D.CARD[e.c].name) + (e.up ? "+" : ""), b: refName(st, e.to) }) + (e.ring ? t("yc_log_ring_" + e.ring) : "");
      case "dmg": return t(e.b ? "yc_log_dmg_blk" : "yc_log_dmg", { to: to, n: e.n, b: e.b });
      case "st": return t("yc_log_st", { to: to, n: e.n, s: stName(e.s) });
      case "move": return t("yc_log_move", { to: to, z: t("yc_zone_" + e.z) });
      case "swap": return t("yc_log_swap", { to: to, z: t("yc_zone_" + e.z), a: heroLabel(st, st.secs ? st.secs[e.sec] : 0) });
      case "steal": return t("yc_log_steal", { to: to, n: e.n });
      case "burst": return t("yc_log_burst", { to: to, n: e.n });
      case "rally": return t("yc_log_rally", { to: to, n: e.n });
      case "curse": return t("yc_log_curse", { to: to, n: e.n, c: L(D.CARD[e.c].name) });
      case "red": return t("yc_log_red", { to: to, n: D.RED_CARD_DMG });
      case "pow": return t("yc_log_pow", { to: to, p: t("yc_pow_" + e.p, { n: e.n }) });
      case "trapHit": case "spirit": return t("yc_log_" + e.t, { to: to, a: heroLabel(st, e.s) });
      case "relic": return t("yc_log_relic", { to: to, r: relicName(e.id) });
      case "removeCard": return t("yc_log_removeCard", { to: to, c: L(D.CARD[e.c].name) });
      case "round": return t("yc_log_round", { n: e.r });
      case "battle": return t("yc_log_battle", { kind: t("yc_node_" + e.kind) });
      case "floor": return t("yc_log_floor", { f: e.floor + 1 });
      case "form": return t("yc_log_form", { to: to, f: t("yc_form_" + e.f) });
      case "brew": return t("yc_log_brew", { to: to, c: L(D.CARD[e.c].name), a: heroLabel(st, e.s) });
      case "later": return t("yc_log_later", { to: to, c: D.CARD[e.c] ? L(D.CARD[e.c].name) : "" });
      case "act": return t("yc_log_act", { act: actName(e.act, e.rg) });
      case "shift": return t("yc_log_shift", { to: to, a: heroLabel(st, st.secs[e.sec]) });
      case "thorns": return t("yc_log_thorns", { to: to, a: heroLabel(st, e.s), n: e.n });
      case "handFull": return t("yc_log_handFull", { to: to, n: D.HAND_MAX });
      case "tmod": return t("yc_log_tmod", { m: tmodText(e.id, e.n), n: e.left });
      case "tok": return t("yc_log_tok", { to: to, n: e.n, c: L(D.CARD[e.c].name) });
      case "parry": case "shikiAtk": case "kekRefl": case "linkHit": case "turret": return t("yc_log_" + e.t, { to: to, a: heroLabel(st, e.s), n: e.n });
      case "vow": return t("yc_log_vow", { to: to, k: t("yc_vow_" + e.k) });
      default: return t("yc_log_" + e.t, { to: to, n: e.n });
    }
  }

  function renderLog(st) {
    var d = el("details", { class: "yc-log", open: ui.logOpen ? true : null });
    d.addEventListener("toggle", function () { ui.logOpen = d.open; });
    d.appendChild(el("summary", { text: t("yc_log") }));
    var list = el("ol", { class: "yc-log-list" });
    st.log.slice(-40).reverse().forEach(function (e) {
      list.appendChild(el("li", { class: "yc-log-" + e.t, text: logText(st, e) }));
    });
    d.appendChild(list);
    return d;
  }

  // ---------------- 打擊演出 ----------------
  // 英雄出牌：新紀錄依序播放（每筆錯開一點）：出牌彈道／範圍爆炸／全範圍衝擊波、命中爆光＋震動、擊殺消散、浮出數字。
  // 敵人回合（使用者指定 2026-10-22）：規則照舊一次結算，但畫面從結算前的狀態開始，依紀錄一步一步重播——
  //   每次移動（補間）、攻擊（敵人撲向目標＋彈道＋命中）、其他行動都有各自的演出，播完才換成最終狀態。
  var FX_STEP = 85, FX_MAX = 2600;

  function fxLayer() { return app.querySelector(".yc-arena-fx"); }
  function arenaEl() { return app.querySelector(".yc-arena"); }
  // 紀錄的對象 → 戰場座標（英雄／敵人；已經被打倒的敵人用上一次畫面的位置）
  function refPos(r) {
    if (!r || !ui.lay) return null;
    if (r.k === "h") return ui.lay.h[r.s] || null;
    return ui.lay.e[r.u] || ui.enemyPos[r.u] || ui.enemyPos["x" + r.u] || null;
  }
  function later(ms, fn) { setTimeout(fn, ms); }
  function svgOnce(node, ms) {
    var layer = fxLayer();
    if (!layer) return;
    layer.appendChild(node);
    later(ms, function () { if (node.parentNode) node.parentNode.removeChild(node); });
  }
  // 拋物線：控制點在中點往垂直方向（偏畫面上方的那一側）拱起；拖曳預覽與彈道共用
  function arcD(a, b, lift) {
    var dx = b.x - a.x, dy = b.y - a.y, len = Math.sqrt(dx * dx + dy * dy) || 1;
    var nx = -dy / len, ny = dx / len;
    if (ny > 0.01 || (Math.abs(ny) <= 0.01 && nx < 0)) { nx = -nx; ny = -ny; }
    var k = len * (lift === undefined ? 0.35 : lift) + 1.5;
    var cx = (a.x + b.x) / 2 + nx * k, cy = (a.y + b.y) / 2 + ny * k;
    return "M" + a.x.toFixed(2) + " " + a.y.toFixed(2) + " Q" + cx.toFixed(2) + " " + cy.toFixed(2) + " " + b.x.toFixed(2) + " " + b.y.toFixed(2);
  }
  function shot(a, b, cls, lift) {
    if (!a || !b) return;
    svgOnce(svg("path", { d: arcD(a, b, lift), class: "yc-shot " + cls, pathLength: 100 }), 520);
  }
  function burstAt(p, cls) {
    var a = arenaEl();
    if (!a || !p) return;
    var b = el("span", { class: "yc-burst " + (cls || ""), style: pctPos(p) + ";--s:" + (Math.max(p.r || 3, 3) * 2.8).toFixed(2) + "%" });
    a.appendChild(b);
    later(650, function () { if (b.parentNode) b.parentNode.removeChild(b); });
  }
  function floatAt(node, txt, cls, k) {
    var f = el("span", { class: "yc-float yc-float-" + cls, text: txt, style: "animation-delay:" + ((k - 1) * 0.16) + "s" });
    node.appendChild(f);
    later(1500 + k * 160, function () { if (f.parentNode) f.parentNode.removeChild(f); });
  }
  function hitNode(node, cls, ms) {
    node.classList.remove(cls);
    void node.offsetWidth; // 重新觸發動畫
    node.classList.add(cls);
    later(ms || 420, function () { node.classList.remove(cls); });
  }
  // 敵人撲向目標再退回（攻擊、施加狀態時）
  function lunge(src, to) {
    var node = app.querySelector('[data-ref="e' + src.u + '"]');
    var a = refPos(src), b = refPos(to), ar = arenaEl();
    if (!node || !a || !b || !ar) return;
    var w = ar.getBoundingClientRect().width / 100;
    var f = Math.min(0.4, 9 / (Math.sqrt((b.x - a.x) * (b.x - a.x) + (b.y - a.y) * (b.y - a.y)) || 1));
    node.style.setProperty("--lx", ((b.x - a.x) * f * w).toFixed(1) + "px");
    node.style.setProperty("--ly", ((b.y - a.y) * f * w).toFixed(1) + "px");
    hitNode(node, "yc-lunge", 460);
  }

  // 播放一筆紀錄的演出；k＝同一個對象這一批的第幾個浮出數字（錯開用）
  function playEvent(st, e, delay, k) {
    if (e.t === "play") {
      var from = ui.lay.h[e.s];
      var d = D.CARD[e.c];
      var hh = Core.hero(st, e.s);
      var color = hh ? heroDef(hh.cls).color : "#ffd34d";
      later(delay, function () {
        Snd.sfx("play");
        if (typeof e.x === "number") {
          var R = D.AREA_R[e.ar] || D.AREA_R.m;
          shot(from, { x: e.x, y: e.y }, "yc-shot-hero");
          later(150, function () { svgOnce(svg("circle", { cx: e.x, cy: e.y, r: R, class: "yc-blast", style: "--c:" + color }), 700); });
        } else if (e.to) {
          if (e.to.k === "e" || e.to.s !== e.s) shot(from, refPos(e.to), e.to.k === "e" ? "yc-shot-hero" : "yc-shot-ally");
        } else if (d && d.type === "atk") {
          // 全範圍攻擊：從中心擴散的衝擊波
          svgOnce(svg("circle", { cx: 50, cy: 50, r: R_EDGE, class: "yc-wave", style: "--c:" + color }), 750);
        }
      });
      return;
    }
    if (e.t === "enemyTurn") {
      var a0 = arenaEl();
      if (!a0) return;
      Snd.sfx("turn");
      var ban = el("div", { class: "yc-banner", text: t("yc_enemy_phase") });
      a0.appendChild(ban);
      later(1100, function () { if (ban.parentNode) ban.parentNode.removeChild(ban); });
      return;
    }
    if (!e.to) return;
    var ref = e.to.k === "h" ? "h" + e.to.s : "e" + e.to.u;
    if (e.t === "kill") {
      later(delay + 120, function () {
        Snd.sfx("kill");
        var p = refPos(e.to);
        var a = arenaEl();
        if (!p || !a) return;
        var poof = el("span", { class: "yc-poof", style: pctPos(p) + ";width:" + (Math.max(p.r, 2.5) * 2).toFixed(2) + "%" }, [el("span", { text: p.icon || "💥" })]);
        a.appendChild(poof);
        later(900, function () { if (poof.parentNode) poof.parentNode.removeChild(poof); });
      });
      return;
    }
    // 敵人對英雄施加狀態／詛咒／黃牌：撲過去＋紫色彈道＋標籤
    if ((e.t === "st" || e.t === "curse" || e.t === "yellow") && e.src && e.to.k === "h") {
      later(delay, function () {
        lunge(e.src, e.to);
        shot(refPos(e.src), refPos(e.to), "yc-shot-fx", 0.2);
        later(260, function () {
          var node = app.querySelector('[data-ref="' + ref + '"]');
          if (!node) return;
          var txt = e.t === "st" ? t("yc_sti_" + e.s) + e.n : e.t === "curse" ? "🃏×" + e.n : "🟨";
          floatAt(node, txt, "fx", k || 1);
        });
      });
      return;
    }
    if (e.t === "roll" || e.t === "brew") {
      later(delay, function () {
        var node = app.querySelector('[data-ref="' + ref + '"]');
        if (node) floatAt(node, e.t === "roll" ? "🎲" + e.n : "⚗️", "fx", k || 1);
      });
      return;
    }
    // 換區、荊棘、手牌滿
    if (e.t === "shift" || e.t === "thorns" || e.t === "handFull") {
      later(delay, function () {
        Snd.sfx(e.t === "shift" ? "shift" : e.t === "thorns" ? "thorns" : "click");
        var node = app.querySelector('[data-ref="' + ref + '"]');
        if (node) floatAt(node, e.t === "shift" ? "↻" : e.t === "thorns" ? "🌵" + e.n : "✋" + D.HAND_MAX, "fx", k || 1);
      });
      return;
    }
    if (e.t === "stunned" || e.t === "summon") {
      later(delay, function () {
        var node = app.querySelector('[data-ref="' + ref + '"]');
        if (node) floatAt(node, e.t === "stunned" ? "💫" : "➕", "fx", k || 1);
      });
      return;
    }
    if (e.t !== "dmg" && e.t !== "heal" && e.t !== "blk") return;
    if (e.t === "dmg" && !e.n && !e.b) return;
    later(delay, function () {
      var p = refPos(e.to);
      var enemyHit = e.t === "dmg" && e.src && e.src.k === "e" && e.to.k === "h";
      if (enemyHit) { lunge(e.src, e.to); shot(refPos(e.src), p, "yc-shot-enemy", 0.2); }
      later(enemyHit ? 230 : 0, function () {
        var node = app.querySelector('[data-ref="' + ref + '"]');
        Snd.sfx(e.t === "heal" ? "heal" : e.t === "blk" ? "block" : !e.n ? "block" : e.to.k === "h" ? "hurt" : e.n >= 15 ? "heavy" : "hit");
        if (e.t === "dmg") {
          if (e.n) burstAt(p, e.to.k === "h" ? "yc-burst-hero" : "");
          else burstAt(p, "yc-burst-blk");
          if (node && e.n) hitNode(node, e.to.k === "h" ? "yc-hit-hero" : "yc-hit");
        }
        if (!node) return;
        var txt = e.t === "dmg" ? (e.n ? "-" + e.n : "🛡" + e.b) : e.t === "heal" ? "+" + e.n : "🛡+" + e.n;
        floatAt(node, txt, e.t, k || 1);
      });
    });
  }

  function playEffects(st) {
    var fresh = st.log.filter(function (e) { return e.i > ui.seenLog; });
    ui.seenLog = st.logSeq;
    if (st.phase !== "battle" || !arenaEl()) return;
    if (fresh.length > 60) fresh = fresh.slice(-60);
    var stack = {};
    var step = 0;
    fresh.forEach(function (e) {
      if (e.t !== "play" && e.t !== "kill" && e.t !== "dmg" && e.t !== "heal" && e.t !== "blk" && e.t !== "roll" && e.t !== "brew" && e.t !== "shift" && e.t !== "thorns" && e.t !== "handFull") return;
      if (e.t === "dmg" && !e.n && !e.b) return;
      var ref = e.to ? (e.to.k === "h" ? "h" + e.to.s : "e" + e.to.u) : "";
      var k = e.t === "play" || e.t === "kill" ? 1 : (stack[ref] = (stack[ref] || 0) + 1);
      playEvent(st, e, Math.min(FX_MAX, step * FX_STEP), k);
      step++;
    });
  }

  // ---- 敵人回合重播 ----
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  // 新紀錄裡有「敵人行動」，而且上一次畫的是同一場戰鬥、紀錄沒有斷：從上一次的狀態開始重播
  function maybeStartReplay(real) {
    if (ui.replay || !ui.lastSt || ui.lastSt.phase !== "battle") return;
    var fresh = real.log.filter(function (e) { return e.i > ui.seenLog; });
    if (!fresh.length || fresh[0].i !== ui.seenLog + 1) return;
    if (!fresh.some(function (e) { return e.t === "enemyTurn"; }) || fresh.some(function (e) { return e.t === "battle"; })) return;
    ui.replay = { st: clone(ui.lastSt), events: fresh, idx: 0 };
    ui.focus = null;
    hideDetail();
    later(200, stepReplay);
  }
  function findRef(st, r) {
    if (!r) return null;
    if (r.k === "h") return st.heroes[r.s] || null;
    return st.enemies.filter(function (x) { return x.u === r.u; })[0] || null;
  }
  // 把一筆紀錄套到重播用的狀態上（只更新畫面看得到的數值；最後會換成真正的狀態）
  function applyEvent(st, e) {
    var x = findRef(st, e.to);
    switch (e.t) {
      case "dmg": if (x) { x.blk = Math.max(0, (x.blk || 0) - (e.b || 0)); x.hp = Math.max(0, x.hp - (e.n || 0)); } break;
      case "heal": if (x) x.hp = Math.min(x.max, x.hp + e.n); break;
      case "blk": if (x) x.blk = (x.blk || 0) + e.n; break;
      case "str": if (x) x.str = (x.str || 0) + e.n; break;
      case "st": if (x) x.st[e.s] = (x.st[e.s] || 0) + e.n; break;
      case "move": if (x) x.ring = e.z; break;
      case "swap": if (x) { x.ring = e.z; x.sec = e.sec; } break;
      case "shift": if (x) x.sec = e.sec; break;
      case "kill": st.enemies = st.enemies.filter(function (q) { return q.u !== e.to.u; }); break;
      case "down": if (x) { x.down = true; x.hp = 0; x.blk = 0; } break;
      case "summon":
        var real = game();
        var m = real && findRef(real, e.to);
        if (m && !x) st.enemies.push(clone(m));
        break;
    }
  }
  // 每一步的長度：移動、攻擊比較久，其他短一點
  function stepTime(e) {
    if (e.t === "enemyTurn") return 900;
    if (e.t === "move" || e.t === "shift" || e.t === "swap") return 560;
    if (e.t === "dmg") return e.src ? 700 : (e.n || e.b ? 420 : 0);
    if (e.t === "kill") return 480;
    if (e.t === "st" || e.t === "curse" || e.t === "yellow") return e.src ? 560 : 120;
    if (e.t === "summon" || e.t === "stunned") return 520;
    if (e.t === "blk" || e.t === "str" || e.t === "heal") return e.src ? 420 : 200;
    if (e.t === "spirit" || e.t === "trapHit") return 0;
    return 60;
  }
  function stepReplay() {
    var R = ui.replay;
    if (!R) return;
    var e = R.events[R.idx];
    if (!e || e.t === "round" || e.t === "win" || e.t === "lose" || mode === null) { finishReplay(); return; }
    R.idx += 1;
    applyEvent(R.st, e);
    // 正在行動的敵人發亮
    ui.acting = e.src && e.src.k === "e" ? e.src.u : (e.to && e.to.k === "e" && (e.t === "move" || e.t === "stunned") ? e.to.u : null);
    if (e.t !== "spirit" && e.t !== "trapHit" && e.t !== "str") paint();
    playEvent(R.st, e, 0, 1);
    later(stepTime(e), stepReplay);
  }
  function finishReplay() {
    var R = ui.replay;
    if (!R) return;
    var last = R.events[Math.max(0, R.idx - 1)];
    ui.replay = null;
    ui.acting = null;
    // 還沒播的（新回合開始的護盾、回復等）交給一般演出
    ui.seenLog = last ? last.i : ui.seenLog;
    render();
  }

  // ---------------- 地圖／選擇 ----------------
  function floorTrack(st) {
    var row = el("ol", { class: "yc-track" });
    D.FLOORS.forEach(function (f, i) {
      row.appendChild(el("li", { class: "yc-track-node" + (i < st.floor ? " yc-past" : i === st.floor ? " yc-now" : ""), text: t("yc_floor_" + f) }));
    });
    return row;
  }

  // 地圖（Hellcard 式，使用者指定 2026-10-22）：每位英雄各自從兩個目的地選一個。
  // 目的地決定自己扇形區的敵人（較弱／一般／較強／菁英），打贏後各自領獎勵；全員選好就開戰，開戰前可以改選
  function destCard(h, id, i) {
    var dd = D.DEST[id];
    var boss = id === "boss";
    var foe = boss ? "boss" : dd.foe;
    return el("button", { type: "button", class: "yc-node yc-node-" + id + " yc-foe-" + foe + (h.dest === id ? " yc-on" : ""),
      disabled: mine(h) ? null : true, onclick: function () { send({ t: "dest", s: h.seat, i: i }); } }, [
      el("span", { class: "yc-node-icon", text: boss ? "👑" : dd.icon }),
      el("strong", { text: t("yc_dest_" + id) }),
      el("span", { class: "yc-foe-tag", text: t("yc_foe_" + foe) }),
      el("span", { class: "yc-small", text: t("yc_dest_desc_" + id) })
    ]);
  }

  function tmodText(id, pw) { return t("yc_tmod_" + id, { n: D.TMOD[id].n * pw }); }

  function renderMap(st) {
    var wrap = el("div", { class: "yc-panel yc-map" });
    // 無盡模式的苦痛修正：全隊三選一（隊伍裡任何一位玩家都可以選）
    if (st.tmodPick) {
      var tbox = el("div", { class: "yc-dest-hero yc-tmod-pick yc-dest-open" });
      tbox.appendChild(el("h3", { text: "😈 " + t("yc_tmod_title") }));
      var canPick = Core.controllers(st).indexOf(myCtrl()) >= 0;
      tbox.appendChild(el("div", { class: "yc-nodes" }, st.tmodPick.map(function (m, i) {
        return el("button", { type: "button", class: "yc-node yc-tmod", disabled: canPick ? null : true, onclick: function () { send({ t: "tmod", i: i }); } }, [
          el("span", { class: "yc-node-icon", text: D.TMOD[m.id].icon }),
          el("strong", { text: tmodText(m.id, m.pw) }),
          el("span", { class: "yc-foe-tag", text: t("yc_tmod_pw", { n: m.pw }) }),
          el("span", { class: "yc-small", text: t("yc_tmod_left", { n: m.left }) })
        ]);
      })));
      wrap.appendChild(tbox);
    }
    wrap.appendChild(el("h2", { text: actName(st.act) + " — " + t("yc_floor_n", { n: st.floor + 1, total: D.FLOORS.length }) }));
    wrap.appendChild(floorTrack(st));
    if (st.boss && D.ENEMY[st.boss]) {
      wrap.appendChild(el("p", { class: "yc-boss-preview" }, [el("strong", { text: t("yc_act_boss") + D.ENEMY[st.boss].icon + " " + enemyName(st.boss) }),
        el("span", { class: "yc-small", text: " — " + t("yc_boss_hint_" + st.boss) })]));
    }
    var boss = D.FLOORS[st.floor] === "boss";
    wrap.appendChild(el("p", { class: "yc-muted", text: boss ? t("yc_map_boss") : t("yc_map_pick") }));
    Core.heroes(st).forEach(function (h) {
      var c = heroDef(h.cls);
      var box = el("div", { class: "yc-dest-hero" + (h.dest ? "" : " yc-dest-open") + (mine(h) ? " yc-dest-mine" : ""), style: "--yc-cls:" + c.color });
      box.appendChild(el("h3", {}, [c.icon + " " + heroName(h) + " ", el("span", { class: "yc-muted yc-small", text: "HP " + h.hp + "/" + h.max }),
        h.perk ? el("span", { class: "yc-small", title: t("yc_perk_n", { n: h.perk }), text: " 🌟" + h.perk }) : null,
        el("span", { class: "yc-small " + (h.dest ? "yc-good" : "yc-muted"), text: " " + (h.down ? "" : h.dest ? t("yc_dest_chosen") : mine(h) ? "" : t("yc_choice_waiting")) })]));
      if (h.down) box.appendChild(el("div", { class: "yc-bad", text: "💤 " + t("yc_fallen_wait") }));
      else box.appendChild(el("div", { class: "yc-nodes" }, (h.dests || []).map(function (id, i) { return destCard(h, id, i); })));
      wrap.appendChild(box);
    });
    wrap.appendChild(partyPanel(st));
    return wrap;
  }

  // 牌組依成長方向計數（看出這局往哪個方向組）
  function pathCounts(h) {
    var hd = heroDef(h.cls);
    return hd.paths.map(function (p) {
      var n = h.deck.filter(function (c) { return D.CARD[c.id] && D.CARD[c.id].path === p.id; }).length;
      return L(p.name) + " " + n;
    }).join(" · ");
  }

  function partyPanel(st) {
    var row = el("div", { class: "yc-party" });
    Core.heroes(st).forEach(function (h) {
      var c = heroDef(h.cls);
      row.appendChild(el("div", { class: "yc-party-hero", style: "--yc-cls:" + c.color }, [
        el("div", {}, [el("span", { text: c.icon + " " }), el("strong", { text: heroName(h) })]),
        hpBar(h.hp, h.max),
        el("div", { class: "yc-small yc-muted", text: pathCounts(h) }),
        el("div", { class: "yc-small" }, [el("button", { type: "button", class: "yc-link", text: t("yc_deck_n", { n: h.deck.length }), onclick: function () { ui.deckView = h.seat; render(); } })]),
        relicRow(h)
      ]));
    });
    return row;
  }

  function renderChoices(st) {
    var wrap = el("div", { class: "yc-panel yc-choices" });
    wrap.appendChild(el("h2", { text: t("yc_phase_" + st.phase) }));
    wrap.appendChild(floorTrack(st));
    Core.heroes(st).forEach(function (h) {
      var c = heroDef(h.cls);
      var box = el("div", { class: "yc-choice-hero", style: "--yc-cls:" + c.color });
      box.appendChild(el("h3", {}, [c.icon + " " + heroName(h) + " ", el("span", { class: "yc-muted yc-small", text: "HP " + h.hp + "/" + h.max + " · " + pathCounts(h) })]));
      var rrow = relicRow(h);
      if (rrow) box.appendChild(rrow);
      var p = h.pend;
      if (!p && h.down) { box.appendChild(el("div", { class: "yc-bad", text: "💤 " + t("yc_fallen") })); wrap.appendChild(box); return; }
      if (!p) { box.appendChild(el("div", { class: "yc-good", text: t("yc_choice_done") })); wrap.appendChild(box); return; }
      if (!mine(h)) { box.appendChild(el("div", { class: "yc-muted", text: t("yc_choice_waiting") })); wrap.appendChild(box); return; }
      var choose = function (ch) { send({ t: "choose", s: h.seat, c: ch }); };
      var canUpgrade = h.deck.some(function (x) { return !x.up; });
      if (p.k === "relic") {
        box.appendChild(el("div", { class: "yc-muted", text: t("yc_pick_relic") }));
        box.appendChild(el("div", { class: "yc-relic-list" }, p.opts.map(function (id) { return relicEl(id, { onclick: function () { choose({ id: id }); } }); })));
        box.appendChild(el("div", { class: "yc-actions" }, [el("button", { type: "button", text: t("yc_skip"), onclick: function () { choose({ skip: true }); } })]));
      } else if (p.k === "card") {
        box.appendChild(el("div", { class: "yc-muted", text: t("yc_pick_card") }));
        var row = el("div", { class: "yc-hand" });
        p.opts.forEach(function (id) { row.appendChild(cardEl({ id: id, u: 0 }, { onclick: function () { choose({ id: id }); } })); });
        box.appendChild(row);
        box.appendChild(el("div", { class: "yc-actions" }, [
          el("button", { type: "button", disabled: canUpgrade ? null : true, text: t("yc_reward_upgrade"), onclick: function () { choose({ kind: "upgrade" }); } }),
          el("button", { type: "button", text: t("yc_skip"), onclick: function () { choose({ skip: true }); } })
        ]));
      } else if (p.k === "altar") {
        // 祭壇（5 種）：接受這座祭壇的交易，或離開
        var al = p.a || "blood", AN = D.ALTAR_NUM;
        var ok = al === "blood" ? !!p.relic && h.max > D.ALTAR_HP : al === "purify" || al === "trade" ? h.deck.length > 5 : al === "war" ? h.hp > AN.war : true;
        var prm = { n: D.ALTAR_HP, t: AN.trade, p: AN.pact, w: AN.war, s: AN.warStr };
        box.appendChild(el("div", { class: "yc-altar-head" }, [el("span", { class: "yc-node-icon", text: D.ALTAR[al].icon }), el("strong", { text: t("yc_altar_" + al) })]));
        box.appendChild(el("div", { class: "yc-muted", text: t("yc_altar_desc_" + al, prm) }));
        if (p.relic) box.appendChild(el("div", { class: "yc-relic-list" }, [relicEl(p.relic, { disabled: !ok, onclick: ok ? function () { choose({ kind: "accept" }); } : null })]));
        box.appendChild(el("div", { class: "yc-actions" }, [
          el("button", { type: "button", class: "yc-primary", disabled: ok ? null : true, text: t("yc_altar_do_" + al, prm), onclick: function () { choose({ kind: "accept" }); } }),
          el("button", { type: "button", text: t("yc_skip"), onclick: function () { choose({ skip: true }); } })
        ]));
      } else if (p.k === "sanctum") {
        // 職業聖地：永久強化被動，或兩張稀有卡選一張
        var cd = heroDef(h.cls), pn = cd.passive.n + ((h.perk || 0) + 1) * (cd.perk || 0);
        var maxed = (h.perk || 0) >= D.MAX_PERK;
        box.appendChild(el("div", { class: "yc-muted", text: t("yc_sanctum_intro", { m: D.MAX_PERK }) }));
        box.appendChild(el("div", { class: "yc-actions" }, [
          el("button", { type: "button", class: "yc-primary", disabled: maxed ? true : null, text: maxed ? t("yc_sanctum_maxed") : "🌟 " + t("yc_sanctum_perk", { p: t("yc_pas_" + cd.passive.p, { n: pn }), k: (h.perk || 0) + 1, m: D.MAX_PERK }), onclick: function () { choose({ kind: "perk" }); } })
        ]));
        var srow = el("div", { class: "yc-hand" });
        p.opts.forEach(function (id) { srow.appendChild(cardEl({ id: id, u: 0 }, { onclick: function () { choose({ id: id }); } })); });
        box.appendChild(srow);
        box.appendChild(el("div", { class: "yc-actions" }, [el("button", { type: "button", text: t("yc_skip"), onclick: function () { choose({ skip: true }); } })]));
      } else if (p.k === "rest") {
        box.appendChild(el("div", { class: "yc-actions" }, [
          el("button", { type: "button", class: "yc-primary", text: t("yc_rest_heal", { n: Math.min(h.max - h.hp, Math.ceil(h.max * Core.restPct(st, h) / 100)) }), onclick: function () { choose({ kind: "heal" }); } }),
          el("button", { type: "button", disabled: canUpgrade ? null : true, text: t("yc_rest_upgrade"), onclick: function () { choose({ kind: "upgrade" }); } })
        ]));
      } else if (p.k === "upgrade" || p.k === "remove") {
        box.appendChild(el("div", { class: "yc-muted", text: t(p.k === "upgrade" ? "yc_pick_upgrade" : p.a === "trade" ? "yc_pick_remove_trade" : !p.back && p.k === "remove" ? "yc_pick_remove_more" : "yc_pick_remove", { n: D.ALTAR_NUM.trade }) }));
        var grid = el("div", { class: "yc-hand yc-deck-grid" });
        h.deck.forEach(function (x) {
          if (p.k === "upgrade" && x.up) return;
          grid.appendChild(cardEl(p.k === "upgrade" ? { id: x.id, u: x.u, up: true } : x, { onclick: function () { choose({ u: x.u }); } }));
        });
        box.appendChild(grid);
        box.appendChild(el("div", { class: "yc-actions" }, [el("button", { type: "button", text: t(p.back || p.k === "upgrade" ? "yc_back" : "yc_done"), onclick: function () { choose({ back: true }); } })]));
      }
      wrap.appendChild(box);
    });
    return wrap;
  }

  function renderEnd(st) {
    var win = st.phase === "win";
    var wrap = el("div", { class: "yc-panel yc-end-panel " + (win ? "yc-win" : "yc-lose") });
    wrap.appendChild(el("h2", { text: t(win ? "yc_win_title" : "yc_lose_title") }));
    wrap.appendChild(el("p", { text: t(win ? "yc_win_desc" : "yc_lose_desc", { act: actName(st.act), f: st.floor + 1 }) }));
    if (st.torment) wrap.appendChild(el("p", { class: "yc-muted", text: "😈 " + t("yc_torment_n", { n: st.torment }) }));
    if (st.endless) {
      var best = endlessBest(st);
      wrap.appendChild(el("p", { text: t("yc_endless_reach", { a: st.act + 1, f: st.floor + 1 }) }));
      if (best) wrap.appendChild(el("p", { class: "yc-muted", text: t("yc_endless_best", { a: best.act + 1, f: best.floor + 1, t: best.torment || 0 }) }));
    }
    // 局外進度：這台裝置的英雄得到經驗
    var aw = awardRun(st);
    if (aw && aw.heroes.length) {
      var ul = el("ul", { class: "yc-award" });
      aw.heroes.forEach(function (x) {
        var hd = heroDef(x.cls);
        ul.appendChild(el("li", { text: hd.icon + " " + L(hd.name) + "：" + t("yc_xp_gain", { n: aw.gain }) + (x.after > x.before ? " — " + t("yc_lv_up", { n: x.after }) : "") }));
      });
      wrap.appendChild(ul);
    }
    wrap.appendChild(partyPanel(st));
    var acts = el("div", { class: "yc-actions" });
    if (mode === "local") acts.appendChild(el("button", { type: "button", class: "yc-primary", text: t("yc_new_game"), onclick: quitLocal }));
    else if (room && room.isHost()) acts.appendChild(el("button", { type: "button", class: "yc-primary", text: t("yc_back_lobby"), onclick: function () { room.backToLobby(); } }));
    else acts.appendChild(el("span", { class: "yc-muted", text: t("yc_wait_host") }));
    wrap.appendChild(acts);
    return wrap;
  }

  function quitLocal() {
    localSt = null; mode = null; ui.confirmQuit = false; ui.focus = null; ui.tab = null;
    saveLocal();
    render();
  }

  function renderDeckView(st) {
    var h = Core.hero(st, ui.deckView);
    if (!h) { ui.deckView = null; return null; }
    var close = function () { ui.deckView = null; render(); };
    var box = el("div", { class: "yc-modal-box" });
    box.appendChild(el("div", { class: "yc-modal-head" }, [el("h3", { text: t("yc_deck_of", { name: heroName(h), n: h.deck.length }) }), el("button", { type: "button", text: "✕", onclick: close })]));
    box.appendChild(el("div", { class: "yc-small yc-muted", text: pathCounts(h) }));
    var grid = el("div", { class: "yc-hand yc-deck-grid" });
    h.deck.slice().sort(function (a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; }).forEach(function (c) { grid.appendChild(cardEl(c, { button: false })); });
    box.appendChild(grid);
    if (st.phase === "battle" && h.draw.length && !handHidden(h)) {
      box.appendChild(el("h4", { text: t("yc_draw_pile", { n: h.draw.length }) }));
      box.appendChild(el("div", { class: "yc-muted", text: h.draw.map(cardName).sort().join("、") }));
    }
    return el("div", { class: "yc-modal", onclick: function (ev) { if (ev.target === ev.currentTarget) close(); } }, [box]);
  }

  function topBar(st) {
    var bits = [el("strong", { text: actName(st.act) }), el("span", { text: t("yc_floor_n", { n: st.floor + 1, total: D.FLOORS.length }) })];
    if (st.torment) bits.push(el("span", { class: "yc-tag-torment", title: D.TORMENTS.slice(0, st.torment).map(function (x) { return x.n + ". " + L(x.name); }).join("\n"), text: "😈 " + t("yc_torment_n", { n: st.torment }) }));
    if (st.endless) bits.push(el("span", { class: "yc-tag-endless", text: "♾️ " + t("yc_endless") }));
    (st.tmods || []).forEach(function (m) { bits.push(el("span", { class: "yc-tag-torment", title: tmodText(m.id, m.pw) + " · " + t("yc_tmod_left", { n: m.left }), text: D.TMOD[m.id].icon + m.pw })); });
    bits.push(soundButtons());
    if (st.phase === "battle") bits.push(el("span", { text: t("yc_node_" + st.battleKind) + " · " + t("yc_round", { n: st.round }) }));
    if (mode === "net" && room) {
      if (!room.hostOnline()) bits.push(el("span", { class: "yc-bad", text: t("yc_host_gone") }));
      bits.push(el("button", { type: "button", class: "yc-link", text: t("yc_leave_room"), onclick: leaveRoom }));
    } else if (ui.confirmQuit) {
      bits.push(el("span", { text: t("yc_confirm_quit") }));
      bits.push(el("button", { type: "button", class: "yc-link yc-bad", text: t("yc_yes"), onclick: quitLocal }));
      bits.push(el("button", { type: "button", class: "yc-link", text: t("yc_no"), onclick: function () { ui.confirmQuit = false; render(); } }));
    } else {
      bits.push(el("button", { type: "button", class: "yc-link", text: t("yc_quit"), onclick: function () { ui.confirmQuit = true; render(); } }));
    }
    return el("div", { class: "yc-topbar" }, bits);
  }

  // ---------------- 主畫面 ----------------
  function render() {
    // 拖曳中不重畫（會把拖著的牌拆掉）；放開後補畫
    if (drag && drag.started) { renderDeferred = true; return; }
    if (drag) drag = null;
    hideDetail();
    if (!mode) { ui.replay = null; Snd.scene(null); app.innerHTML = ""; app.appendChild(renderEntry()); return; }
    if (mode === "net" && (!room.loaded || room.missing || !room.meta || room.meta.status !== "play" || !room.game)) {
      ui.replay = null;
      Snd.scene("map");
      app.innerHTML = "";
      app.appendChild(renderLobby());
      return;
    }
    maybeStartReplay(game());
    paint();
  }

  // 畫目前的狀態（敵人回合重播中畫重播用的狀態）
  function paint() {
    hideDetail();
    var scrollY = window.scrollY;
    app.innerHTML = "";
    var st = ui.replay ? ui.replay.st : game();
    app.appendChild(topBar(st));
    if (st.phase === "battle") {
      app.appendChild(renderBoard(st));
      app.appendChild(renderHands(st));
    } else if (st.phase === "map") app.appendChild(renderMap(st));
    else if (st.phase === "win" || st.phase === "lose") app.appendChild(renderEnd(st));
    else app.appendChild(renderChoices(st));
    app.appendChild(renderLog(st));
    if (ui.deckView !== null) { var m = renderDeckView(st); if (m) app.appendChild(m); }
    window.scrollTo(0, scrollY);
    if (st.phase === "battle") {
      fitArena();
      layoutFan(app.querySelector(".yc-fan"));
      // 進入戰鬥時捲到上方資訊列，戰場與手牌一起出現在畫面裡
      var tb = app.querySelector(".yc-topbar");
      if (st.phase !== ui.lastPhase && tb) window.scrollTo(0, Math.max(0, tb.getBoundingClientRect().top + window.scrollY - 4));
    }
    else { ui.enemyPos = {}; ui.focus = null; }
    if (!ui.replay) {
      ui.lastSt = st.phase === "battle" ? clone(st) : null;
      playEffects(st);
    }
    // 音樂：戰鬥／Boss 戰／其他；勝負音效只在切換時響一次
    Snd.scene(st.phase === "battle" ? (st.battleKind === "boss" ? "boss" : "battle") : st.phase === "win" || st.phase === "lose" ? null : "map");
    if (st.phase !== ui.lastPhase) {
      if (st.phase === "win" || st.phase === "lose") Snd.sfx(st.phase);
      if (st.phase === "lose" && st.endless) saveEndlessBest(st);
      ui.lastPhase = st.phase;
    }
    if (st.phase === "battle") drawSignals();
    if (!ui.replay) aiDriver();
  }

  // ---------------- 音效開關 ----------------
  function soundButtons() {
    var s = Snd.settings();
    return el("span", { class: "yc-sound" }, [
      el("button", { type: "button", class: "yc-link", title: t("yc_sfx"), text: s.sfx ? "🔊" : "🔇", onclick: function () { Snd.setSfx(!s.sfx); render(); } }),
      el("button", { type: "button", class: "yc-link", title: t("yc_music"), text: s.music ? "🎵" : "🎵̸", onclick: function () { Snd.setMusic(!s.music); render(); } })
    ]);
  }

  // ---------------- 無盡模式的最佳紀錄（這台裝置；只是個人的方便，存在 localStorage） ----------------
  var BEST_KEY = "pritest-yellow-endless-best";
  function endlessBest() { try { return JSON.parse(localStorage.getItem(BEST_KEY) || "null"); } catch (e) { return null; } }
  function saveEndlessBest(st) {
    var cur = endlessBest();
    var score = st.act * D.FLOORS.length + st.floor;
    if (cur && cur.act * D.FLOORS.length + cur.floor >= score) return;
    try { localStorage.setItem(BEST_KEY, JSON.stringify({ act: st.act, floor: st.floor, torment: st.torment || 0 })); } catch (e) { /* 只是記不住 */ }
  }

  // ---------------- AI 隊友（本機：這台裝置；連線：房主代為送出） ----------------
  var aiTimer = null;
  function aiNeeds(st, h) {
    if (st.phase === "map") return !h.dest;
    if (st.phase === "battle") return !h.down && !h.done;
    if (st.phase === "win" || st.phase === "lose") return false;
    return !!h.pend;
  }
  function aiSend(a) {
    if (mode === "local") { var err = Core.apply(localSt, AI.CTRL, a); if (!err) saveLocal(); return err; }
    return room ? room.sendAi(a) : "no_game";
  }
  function aiDriver() {
    if (aiTimer || !AI) return;
    var st = game();
    if (!st || ui.replay || (mode === "net" && !(room && room.isHost()))) return;
    var h = Core.heroes(st).filter(function (x) { return isAi(x) && aiNeeds(st, x); })[0];
    if (!h) return;
    // 戰鬥中每張牌之間停一下，玩家才看得到 AI 在做什麼
    aiTimer = setTimeout(function () {
      aiTimer = null;
      var s2 = game();
      if (!s2 || ui.replay || (mode === "net" && !(room && room.isHost()))) return;
      var hh = Core.hero(s2, h.seat);
      if (!hh || !isAi(hh) || !aiNeeds(s2, hh)) { aiDriver(); return; }
      var a = AI.next(s2, hh.seat);
      if (!a) return;
      var err = aiSend(a);
      if (err && a.t === "choose") aiSend(AI.fallback(hh.seat));
      else if (err && a.t === "play") aiSend({ t: "end", s: hh.seat });
      render();
    }, st.phase === "battle" ? 650 : 450);
  }

  // ---------------- 戰場標記與表情（2026-10-23 使用者指定） ----------------
  var EMOTES = ["👍", "❓", "⚠️", "⚔️", "🛡️", "🙏", "😅"];
  var SIG_MS = 4000;
  function myHeroSeat(st) {
    var h = Core.hero(st, ui.tab);
    if (h && mine(h)) return h.seat;
    var m = Core.heroes(st).filter(mine)[0];
    return m ? m.seat : null;
  }
  function sendSignal(sig) {
    if (mode === "net" && room) { room.signal(sig); return; }
    addSignal(sig, "local", Date.now());
  }
  function addSignal(sig, who, at) {
    var st = game();
    var h = st ? Core.heroes(st).filter(function (x) { return x.ctrl === who; })[0] : null;
    var color = h ? heroDef(h.cls).color : "#ffd34d";
    var name = mode === "net" && room ? (room.nameOf(who) || t("yc_anon")) : (h ? heroName(h) : "");
    ui.signals.push({ k: sig.k, x: sig.x, y: sig.y, u: sig.u, s: sig.s, e: sig.e, color: color, name: name, until: Date.now() + SIG_MS });
    Snd.sfx(sig.k === "emo" ? "emote" : "ping");
    drawSignals();
    later(SIG_MS + 50, drawSignals);
  }
  // 連線：fx/<cid> 有新的訊號就顯示（太舊的不顯示：剛進房間時不要把之前的訊號重播一次）
  function onSignal(all) {
    Object.keys(all || {}).forEach(function (c) {
      var v = all[c];
      if (!v || typeof v.at !== "number" || ui.sigSeen[c] === v.at) return;
      var fresh = ui.sigSeen[c] !== undefined || Math.abs((window.PriTestGameStorage && window.PriTestGameStorage.serverNow ? window.PriTestGameStorage.serverNow() : Date.now()) - v.at) < SIG_MS;
      ui.sigSeen[c] = v.at;
      if (fresh && mode === "net") addSignal(v, c, Date.now());
    });
  }
  function drawSignals() {
    var arena = arenaEl();
    if (!arena) return;
    Array.prototype.forEach.call(arena.querySelectorAll(".yc-sig"), function (n) { n.parentNode.removeChild(n); });
    var now = Date.now();
    ui.signals = ui.signals.filter(function (s) { return s.until > now; });
    var st = ui.replay ? ui.replay.st : game();
    if (!st || !ui.lay) return;
    ui.signals.forEach(function (s) {
      var p = null;
      if (s.k === "emo") p = typeof s.s === "number" ? ui.lay.h[s.s] : null;
      else if (typeof s.u === "number" && ui.lay.e[s.u]) p = ui.lay.e[s.u];
      else if (typeof s.x === "number") p = { x: s.x, y: s.y };
      if (!p) return;
      var node = s.k === "emo"
        ? el("div", { class: "yc-sig yc-sig-emo", style: pctPos(p) + ";--c:" + s.color }, [el("span", { text: s.e })])
        : el("div", { class: "yc-sig yc-sig-ping", style: pctPos(p) + ";--c:" + s.color }, [el("span", { class: "yc-sig-ring" }), el("span", { class: "yc-sig-name", text: "📍" + (s.name || "") })]);
      arena.appendChild(node);
    });
  }
  // 點戰場標記：位置貼齊最近的敵人（點在判定圓附近）
  function pingAt(cx, cy) {
    var st = game();
    var p = arenaPoint(cx, cy);
    if (!st || !p || !ui.lay) return;
    var hit = null;
    Object.keys(ui.lay.e).forEach(function (u) {
      var q = ui.lay.e[u];
      if (Math.sqrt((q.x - p.x) * (q.x - p.x) + (q.y - p.y) * (q.y - p.y)) <= q.r + 2) hit = Number(u);
    });
    sendSignal(hit !== null ? { k: "ping", u: hit } : { k: "ping", x: p.x, y: p.y });
  }
  // 標記說明（2026-10-23 使用者指定：戰鬥畫面顯示各種標記的說明）：戰場右上的 ❔
  function legendRows() {
    var sec = function (k, rows) { return { k: k, rows: rows }; };
    var st = ["weak", "vuln", "poison", "burn", "stun", "regen", "charm", "link"].map(function (s) { return [t("yc_sti_" + s), stName(s) + "：" + t("yc_st_desc_" + s)]; });
    return [
      sec("yc_legend_sec_field", [["⭕", t("yc_legend_sectors")], ["◎", t("yc_legend_rings")]]),
      sec("yc_legend_sec_status", [["🛡", t("yc_block") + "：" + t("yc_legend_blk")], ["💪", t("yc_str")]].concat(st)),
      sec("yc_legend_sec_hero", [
        ["🦉", t("yc_spirits_desc", { n: 2 })], ["♪", t("yc_melody_desc")], ["🪤", t("yc_trap_desc", { n: "N" })], ["☯", t("yc_chi_desc", { n: D.MAX_CHI })],
        ["⌛", t("yc_flux_desc", { n: D.MAX_FLUX })], ["🧪", t("yc_rg_desc", { n: 3 })], ["🐻🐺🦅", t("yc_legend_forms")], ["⏳", t("yc_later_desc")],
        ["✦", t("yc_legend_pow")], ["🎯", t("yc_taunt_desc")]]),
      // 2026-10-24 新英雄
      sec("yc_legend_sec_hero2", [
        ["🌀", t("yc_combo_desc", { n: "N" })], ["👤", t("yc_dodge_desc", { n: D.MAX_DODGE })], ["👥", t("yc_echo_desc")], ["🗡️", t("yc_edge_desc")],
        ["🔁", t("yc_parry_desc", { n: "N" })], ["🌳🔥⛰️⚙️💧", t("yc_legend_gen")], ["👺", t("yc_shiki_desc", { n: D.SHIKI_DMG + "×Lv", m: D.MAX_SHIKI })],
        ["⛩️", t("yc_kek_desc", { n: "N" })], ["🔫", t("yc_ammo_desc", { n: 1 })], ["🎵", t("yc_beat_desc", { n: D.MAX_BEAT })], ["🌑", t("yc_ce_desc", { n: D.MAX_CE })],
        ["💢 🚫 ☝️", t("yc_legend_vow")]]),
      sec("yc_legend_sec_intent", [["⚔", t("yc_legend_atk")], ["🩸", t("yc_int_drain") + " " + t("yc_legend_drain")], ["🛡", t("yc_legend_eblk")], ["💪+", t("yc_legend_buff")],
        ["💚", t("yc_legend_heal")], ["🃏", t("yc_legend_curse")], ["🟨", t("yc_legend_yellow", { n: D.RED_CARD_DMG })], ["➕", t("yc_legend_summon")],
        ["⇣ ⇡", t("yc_legend_move")], ["💔", t("yc_int_shatter")], ["✨", t("yc_int_purge")], ["💫", t("yc_legend_stun")],
        ["✈", t("yc_legend_pierce")], ["🎩", t("yc_legend_swap")], ["🐒", t("yc_legend_steal")]]),
      sec("yc_legend_sec_mech", [["🌵", t("yc_thorns_desc", { n: "N" })], ["🔰", t("yc_mech_ward_on")], ["📈", t("yc_mech_grow", { n: "N" })],
        ["🧬", t("yc_legend_split")], ["🌗", t("yc_mech_phase", { n: 50 })], ["💥", t("yc_mech_burst", { n: "N" })], ["📣", t("yc_mech_rally", { n: "N" })]])
    ];
  }
  function legendPanel() {
    var stop = function (ev) { ev.stopPropagation(); };
    var box = el("div", { class: "yc-legend", onclick: stop });
    box.appendChild(el("div", { class: "yc-legend-head" }, [el("strong", { text: "❔ " + t("yc_legend_title") }),
      el("button", { type: "button", class: "yc-small-btn", text: t("yc_tut_replay"), onclick: function () { ui.legend = false; ui.tutStep = 0; render(); } }),
      el("button", { type: "button", class: "yc-small-btn", text: "✕", title: t("yc_legend_close"), onclick: function () { ui.legend = false; render(); } })]));
    legendRows().forEach(function (sec) {
      box.appendChild(el("h4", { text: t(sec.k) }));
      var dl = el("dl", { class: "yc-legend-list" });
      sec.rows.forEach(function (r) { dl.appendChild(el("dt", { text: r[0] })); dl.appendChild(el("dd", { text: r[1] })); });
      box.appendChild(dl);
    });
    return box;
  }
  // 第一場戰鬥的教學（看過一次就記在這台裝置；❔ 裡可以重看）
  var TUT_KEY = "pritest-yellow-tut";
  var TUT_STEPS = 5;
  function tutSeen() { try { return localStorage.getItem(TUT_KEY) === "1"; } catch (e) { return true; } }
  function tutFinish() { ui.tutStep = null; try { localStorage.setItem(TUT_KEY, "1"); } catch (e) { /* 只是記不住 */ } render(); }
  function tutCard() {
    if (ui.tutStep === null || ui.tutStep === undefined) {
      if (tutSeen() || ui.tutClosed) return null;
      ui.tutStep = 0;
    }
    var i = ui.tutStep;
    var last = i >= TUT_STEPS - 1;
    var stop = function (ev) { ev.stopPropagation(); };
    return el("div", { class: "yc-tut", onclick: stop }, [
      el("div", { class: "yc-tut-step yc-small yc-muted", text: t("yc_tut_title") + "（" + (i + 1) + " / " + TUT_STEPS + "）" }),
      el("p", { text: t("yc_tut_" + (i + 1), { n: D.MANA }) }),
      el("div", { class: "yc-actions" }, [
        el("button", { type: "button", class: "yc-primary yc-small-btn", text: t(last ? "yc_tut_done" : "yc_tut_next"), onclick: function () { if (last) { ui.tutClosed = true; tutFinish(); } else { ui.tutStep = i + 1; render(); } } }),
        last ? null : el("button", { type: "button", class: "yc-small-btn", text: t("yc_tut_skip"), onclick: function () { ui.tutClosed = true; tutFinish(); } })
      ])
    ]);
  }

  // 戰場的兩個空角：右下＝標記鈕、左下＝表情（點開才出現表情列）；不另外佔一列，手機上手牌才放得進畫面
  function signalBar(st) {
    var seat = myHeroSeat(st);
    var stop = function (ev) { ev.stopPropagation(); };
    var bar = el("div", { class: "yc-signal-bar", onclick: stop });
    bar.appendChild(el("button", { type: "button", class: "yc-sig-btn yc-help-btn" + (ui.legend ? " yc-on" : ""), title: t("yc_legend_title"), text: "❔",
      onclick: function (ev) { ev.stopPropagation(); ui.legend = !ui.legend; render(); } }));
    bar.appendChild(el("button", { type: "button", class: "yc-sig-btn yc-ping-btn" + (ui.pingMode ? " yc-on" : ""), title: t("yc_ping_hint"), text: "📍" + t("yc_ping"),
      onclick: function (ev) { ev.stopPropagation(); ui.pingMode = !ui.pingMode; ui.emoteOpen = false; render(); } }));
    bar.appendChild(el("button", { type: "button", class: "yc-sig-btn yc-emo-toggle" + (ui.emoteOpen ? " yc-on" : ""), title: t("yc_emotes"), disabled: seat === null ? true : null, text: "😀",
      onclick: function (ev) { ev.stopPropagation(); ui.emoteOpen = !ui.emoteOpen; render(); } }));
    if (ui.emoteOpen && seat !== null) {
      var pop = el("div", { class: "yc-emo-pop" });
      EMOTES.forEach(function (e) {
        pop.appendChild(el("button", { type: "button", class: "yc-emote", title: t("yc_emotes"), text: e,
          onclick: function (ev) { ev.stopPropagation(); ui.emoteOpen = false; sendSignal({ k: "emo", e: e, s: seat }); render(); } }));
      });
      bar.appendChild(pop);
    }
    return bar;
  }

  window.addEventListener("i18n:change", render);
  document.addEventListener("keydown", function (ev) {
    if (ev.key !== "Escape") return;
    if (drag && drag.started) { endDrag(true); return; }
    if (ui.focus || ui.deckView !== null) { ui.focus = null; ui.deckView = null; render(); }
  });

  // 網址帶 ?room= 直接加入
  var rid = window.PriTestYellowNet ? window.PriTestYellowNet.roomFromUrl(location.href) : null;
  if (rid) openRoom(rid); else render();

  // 測試用（tools/yellow_check/ui_check.js）
  window.PriTestYellow = { state: function () { return game(); }, mode: function () { return mode; }, room: function () { return room; },
    layout: function () { return ui.lay; }, arenaToClient: arenaToClient, replaying: function () { return !!ui.replay; },
    signals: function () { return ui.signals.slice(); }, aiBusy: function () { return !!aiTimer; },
    cardText: function (id, up) { return cardText(Core.cardDef({ id: id, up: !!up }), null) + " | " + cardMeta(Core.cardDef({ id: id, up: !!up })); } };
})();
