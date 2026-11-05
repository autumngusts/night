// 賽狗賽狗（saigo）：畫面。首頁 → 犬舍／圖鑑／單機比賽／連線房間 → 出賽表（下注）→ 比賽（3D 轉播）→ 結果。
// 模擬在 saigo_core.js、下注在 saigo_bet.js、犬舍在 saigo_kennel.js、連線在 saigo_net.js、3D 在 saigo_3d.js。
(function () {
  "use strict";

  var D = window.PriTestSaigoData;
  var Core = window.PriTestSaigoCore;
  var Bet = window.PriTestSaigoBet;
  var K = window.PriTestSaigoKennel;
  var Net = window.PriTestSaigoNet;
  var V3 = window.PriTestSaigo3D;
  var SK = window.PriTestSaigoSkills;
  var Real = window.PriTestSaigoReal;
  var Mic = window.PriTestSaigoMic;
  var Press = window.PriTestSaigoPress;
  var League = window.PriTestSaigoLeague;
  var Cup = window.PriTestSaigoCup;
  var app = document.getElementById("sg-app");
  if (!app || !D || !Core) return;

  var NAME_KEY = "pritest-saigo-name", PREF_KEY = "pritest-saigo-pref";
  var DASH_PASSWORD = "nightnight";   // 使用者指定 2026-10-31：連線房間的管理面板密碼
  function t(k, p) { return window.I18N.t(k, p); }
  function L(o) { return D.L(o); }
  function lsGet(k) { try { return window.localStorage.getItem(k) || ""; } catch (e) { return ""; } }
  function lsSet(k, v) { try { window.localStorage.setItem(k, v); } catch (e) { /* 記不住也能玩 */ } }
  function pref() { try { return JSON.parse(lsGet(PREF_KEY) || "{}") || {}; } catch (e) { return {}; } }
  function setPref(p) { var o = pref(); Object.keys(p).forEach(function (k) { o[k] = p[k]; }); lsSet(PREF_KEY, JSON.stringify(o)); }

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
  function btn(label, onclick, cls, attrs) {
    var a = { class: cls || "sg-btn", type: "button", onclick: onclick };
    Object.keys(attrs || {}).forEach(function (k) { a[k] = attrs[k]; });
    return el("button", a, [label]);
  }
  function money(n) { return "¥" + Math.round(n).toLocaleString(); }
  function fmtTime(s) {
    if (s === null || s === undefined || !isFinite(s)) return "--";
    var m = Math.floor(s / 60), r = s - m * 60;
    return (m ? m + ":" + (r < 10 ? "0" : "") : "") + r.toFixed(2);
  }
  function gateBadge(g) { return el("span", { class: "sg-gate", style: "background:" + D.GATE_COLORS[g] + ";color:" + D.GATE_TEXT[g] }, [String(g + 1)]); }
  function breedOf(d) { return D.BREED_BY_ID[d.breed] || D.BREEDS[0]; }
  // 真賽狗模式（8 隻、搶道）。2026-11-02 起用關卡賽的地圖；沒有 course 的是舊版橢圓跑道的出賽表（只剩播放用）
  function isReal(card) { return !!card && card.mode === "real"; }
  function isOval(card) { return isReal(card) && !card.course; }
  function cardLen(card) { return isOval(card) ? card.length : card.course.length; }
  // 小地圖上的位置：關卡賽＝里程＋自己的跑道；真賽狗＝里程＋橫向位置（舊版橢圓：沿內欄距離＋橫向位置）
  function mapPos(card, st, i) {
    if (isOval(card)) { var q = Real.posAt(card, Math.min(st.s, card.length), st.x || 0); return { x: q.x, z: q.y }; }
    var p = Core.pointAt(card.course, Math.min(st.s, card.course.length), isReal(card) ? st.x || 0 : Core.laneOff(i));
    return { x: p.x, z: p.y };
  }
  // 技能小標籤
  function skillChip(id, extra) {
    var s = SK.BY_ID[id];
    if (!s) return null;
    return el("span", { class: "sg-skill sg-skill-" + s.tier, title: L(s.desc) + "（" + s.pts + "pt）" }, [s.icon + " " + L(s.name)].concat(extra || []));
  }
  // 可點的技能標籤（手機沒有 title 提示）：點一下在下方顯示簡易說明，再點一次收起。key＝這一列的識別
  function skillTap(id, key) {
    var s = SK.BY_ID[id];
    if (!s) return null;
    var k = key + ":" + id, on = ui.selSkill === k;
    return el("button", { type: "button", class: "sg-skill sg-skill-btn sg-skill-" + s.tier + (on ? " sg-on" : ""), title: L(s.desc), onclick: function (ev) {
      ev.stopPropagation(); ui.selSkill = on ? "" : k; rerenderKeep();
    } }, [s.icon + " " + L(s.name)]);
  }
  function skillDesc(ids, key) {
    var hit = (ids || []).filter(function (id) { return ui.selSkill === key + ":" + id; })[0], s = hit && SK.BY_ID[hit];
    if (!s) return null;
    return el("div", { class: "sg-skill-desc sg-skill-desc-" + s.tier }, [
      el("b", null, [s.icon + " " + L(s.name)]), el("small", null, [" " + L(SK.TIERS[s.tier].name) + "・" + s.pts + "pt"]), el("br"), L(s.desc)
    ]);
  }
  // 能力的大概範圍（2026-11-03 使用者指定「屬性的數值只詳細自己的，其他人的只畫大概範圍」）：
  // 寬 20 的區間（例：60〜80），區間的位置依出賽表 seed＋枠＋能力決定，各裝置一樣、也不會總是置中
  function statRange(v, key) {
    var lo = Math.floor(v / 10) * 10 - (Core.hashStr(key) % 2) * 10;
    if (lo < 0) lo = 0;
    return [lo, lo + 20];
  }
  function rangeKey(card, i, k) { return (card ? card.seed : 0) + ":" + i + ":" + k; }
  // 出走表用的 8 項能力：自己的狗＝數字；別人的狗＝大概範圍
  function statMini(stats, exact, card, i) {
    return el("div", { class: "sg-statmini" }, D.STATS.map(function (k) {
      var v = Math.round(stats[k]);
      if (!exact) {
        var rg = statRange(v, rangeKey(card, i, k)), mid = rg[0] + 10;
        return el("span", { class: "sg-sm-range sg-sm-" + (mid >= 90 ? "a" : mid >= 70 ? "b" : mid >= 50 ? "c" : "d") }, [el("i", null, [t("sg_stat_" + k)]), rangeBar(rg, 120), rg[0] + "〜" + rg[1]]);
      }
      return el("span", { class: "sg-sm-" + (v >= 90 ? "a" : v >= 70 ? "b" : v >= 50 ? "c" : "d") }, [el("i", null, [t("sg_stat_" + k)]), String(v)]);
    }));
  }
  function rangeBar(rg, max) {
    var a = Core.clamp(rg[0] / max, 0, 1), b = Core.clamp(rg[1] / max, 0, 1);
    return el("span", { class: "sg-bar sg-bar-range" }, [el("i", { style: "margin-left:" + Math.round(a * 100) + "%;width:" + Math.round((b - a) * 100) + "%" })]);
  }
  // 詳細欄：別人的狗只畫範圍
  function statsRangeTable(stats, card, i) {
    return el("div", { class: "sg-stats" }, D.STATS.map(function (k) {
      var rg = statRange(Math.round(stats[k]), rangeKey(card, i, k));
      return el("div", { class: "sg-stat" }, [
        el("span", { class: "sg-stat-k" }, [t("sg_stat_" + k)]),
        rangeBar(rg, 120),
        el("span", { class: "sg-stat-v" }, [rg[0] + "〜" + rg[1]])
      ]);
    }));
  }
  function statBar(v, max, cls) {
    return el("span", { class: "sg-bar " + (cls || "") }, [el("i", { style: "width:" + Math.round(Core.clamp(v / (max || 120), 0, 1) * 100) + "%" })]);
  }

  var ui = {
    screen: "home", card: null, result: null, tickets: [], practice: false, cls: pref().cls || "open", entryDog: pref().entryDog || "",
    slip: { type: "win", method: "normal", picks: [], key: null, stake: 100 },
    map: pref().map || { terrain: "", weather: "", dist: "" },
    room: null, netNo: 0, settled: {}, paid: {}, view: null, previews: [], raf: 0, selDog: null, openDog: -1, msg: "",
    dashOk: false, dash: { start: "", all: "", per: {} }, dashMsg: "",
    pool: pref().pool !== false, finalOdds: null, jpWin: null,
    mode: pref().mode === "real" ? "real" : "classic", rmap: pref().rmap || { weather: "", dist: "" },
    entryDogs: pref().entryDogs || [], ctlDog: -1, mic: null, micState: "", selSkill: "", obs: pref().obs !== false,
    w5: !!pref().w5
  };

  // 彩池制（連線房間、房主開啟）：賠率＝虛擬彩池＋大家的下注；開跑後用房主鎖定的彩池
  function poolMode(card) { return !!(ui.room && card && card.pm); }
  // order＝結算時的名次（彩池制的複勝／寬要看跟誰一起中才算得出確定賠率）
  function curOdds(card, order) {
    if (!poolMode(card)) return Core.odds(card);
    var m = ui.room.match, lk = m && m.pool;
    if (lk && lk.h) return Bet.poolOdds(card, lk.h, lk.base, order);
    return Bet.poolOdds(card, ui.room.livePool(), ui.room.poolBase(), order);
  }
  // 顯示用賠率：彩池制的複勝／寬顯示範圍
  function oddsText(od, type, c, fb) {
    var rg = od.range && od.range[type] && od.range[type][c];
    if (rg && rg[1] > rg[0]) return rg[0].toFixed(1) + "-" + rg[1].toFixed(1);
    var v = od[type] && od[type][c];
    return (v || fb || 0).toFixed(1);
  }
  function popOf(od) {
    var w = od.win, idx = Object.keys(w).map(Number).sort(function (a, b) { return w[a] - w[b] || a - b; }), pop = [];
    idx.forEach(function (d, rank) { pop[d] = rank + 1; });
    return pop;
  }
  // 連線房間：下注一變就寫進房間（彩池制算賠率、累積彩金算押中金額都要用）
  function pushBets() { if (ui.room) ui.room.pushBets(Bet.poolOf(ui.tickets)); }
  function jackpotAmt() { return ui.room ? ui.room.jpAmt() : K.jackpot(); }

  // ---- 跑法 ----
  function aptG(best, style) { return D.APT[D.aptitude(best || style, style)].g; }
  function styleLabel(d) { return L(D.STYLES[d.style]) + "（" + aptG(d.best, d.style) + "）"; }
  function stylePicker(best, cur, onPick, disabled) {
    return el("div", { class: "sg-seg" }, D.STYLE_IDS.map(function (st) {
      return btn(L(D.STYLES[st]) + " " + aptG(best, st) + (st === best ? " ★" : ""), function () { onPick(st); }, "sg-seg-btn" + (st === cur ? " sg-on" : ""), { disabled: disabled, title: t("sg_apt_note") });
    }));
  }
  // 犬舍的狗：下次出賽的跑法
  function dogStylePicker(id, after, disabled) {
    var d = id ? K.dog(id) : null;
    if (!d) return null;
    return el("div", null, [
      el("h3", null, [t("sg_run_style") + "（" + t("sg_best_style") + "：" + L(D.STYLES[K.bestStyle(d)]) + "）"]),
      stylePicker(K.bestStyle(d), K.runStyle(d), function (st) { K.setRunStyle(id, st); if (after) after(); rerenderKeep(); }, disabled),
      el("p", { class: "sg-small sg-muted" }, [t("sg_apt_note")])
    ]);
  }

  // 下注用的錢：連線房間＝房間籌碼（Firebase），單機＝犬舍錢包
  function wallet() { return ui.room ? ui.room.coins() : K.coins(); }

  // ---------------- 共用 ----------------
  function stopRace() {
    if (ui.raf) cancelAnimationFrame(ui.raf);
    ui.raf = 0;
    if (ui.mic) { ui.mic.stop(); ui.mic = null; ui.micState = ""; ui.micHeard = null; }
    if (ui.view) { ui.view.dispose(); ui.view = null; }
  }
  function stopPreview() { ui.previews.forEach(function (p) { p.dispose(); }); ui.previews = []; }
  function go(screen) {
    stopRace(); stopPreview();
    ui.screen = screen;
    render();
    window.scrollTo(0, 0);
  }
  function render() {
    stopPreview();
    app.innerHTML = "";
    var f = SCREENS[ui.screen] || SCREENS.home;
    app.appendChild(header());
    f();
  }
  function header() {
    var s = K.load();
    var bar = el("div", { class: "sg-top" }, [
      el("h1", { class: "sg-title" }, [t("sg_title")]),
      el("span", { class: "sg-wallet" }, [t("sg_wallet") + " ", el("b", null, [money(s.coins)])]),
      ui.room ? el("span", { class: "sg-wallet sg-chips" }, [t("sg_chips") + " ", el("b", null, [money(ui.room.coins())])]) : null,
      ui.room ? el("span", { class: "sg-roomtag" }, [t("sg_net_in_room")]) : null,
      ui.screen !== "home" && ui.screen !== "race" ? btn(t("sg_home"), function () { if (ui.room && ui.screen !== "lobby") go("lobby"); else go("home"); }, "sg-link") : null
    ]);
    return bar;
  }
  function panel(title, children, cls) {
    return el("section", { class: "sg-panel " + (cls || "") }, [title ? el("h2", null, [title]) : null].concat(children || []));
  }

  // ---------------- 首頁 ----------------
  function screenHome() {
    var s = K.load();
    app.appendChild(panel(null, [
      el("p", { class: "sg-intro" }, [t("sg_intro")]),
      el("div", { class: "sg-menu" }, [
        btn(t("sg_menu_solo"), function () { go("setup"); }, "sg-big sg-primary"),
        Net ? btn(ui.room ? t("sg_menu_back_room") : t("sg_menu_net"), function () { if (ui.room) go("lobby"); else enterRoom(null); }, "sg-big") : null,
        btn(t("sg_menu_kennel"), function () { go("kennel"); }, "sg-big"),
        btn(t("sg_menu_zukan"), function () { go("zukan"); }, "sg-big"),
        btn(t("sg_menu_record"), function () { go("record"); }, "sg-big")
      ]),
      s.coins < 100 ? el("div", { class: "sg-actions" }, [btn(t("sg_bailout", { n: money(K.BAILOUT) }), function () { K.bailout(); render(); })]) : null,
      !s.dogs.length ? el("p", { class: "sg-hint" }, [t("sg_hint_adopt")]) : null
    ]));
    app.appendChild(panel(t("sg_rules_title"), [el("ul", { class: "sg-rules" }, ["sg_rule_1", "sg_rule_6", "sg_rule_2", "sg_rule_7", "sg_rule_8", "sg_rule_9", "sg_rule_3", "sg_rule_10", "sg_rule_4", "sg_rule_5", "sg_rule_11"].map(function (k) { return el("li", null, [t(k)]); }))]));
  }

  // ---------------- 犬種圖鑑 ----------------
  function statsTable(stats, extra) {
    return el("div", { class: "sg-stats" }, D.STATS.map(function (k) {
      return el("div", { class: "sg-stat" }, [
        el("span", { class: "sg-stat-k" }, [t("sg_stat_" + k)]),
        statBar(stats[k], 120, extra && extra[k] ? "sg-bar-up" : ""),
        el("span", { class: "sg-stat-v" }, [String(Math.round(stats[k])) + (extra && extra[k] ? " (+" + extra[k] + ")" : "")])
      ]);
    }));
  }
  function traitLine(b) {
    var parts = [L(D.SIZES[b.size]), t("sg_style") + "：" + L(D.STYLES[b.style])];
    if (b.heat) parts.push(t(b.heat > 0 ? "sg_trait_heat_good" : "sg_trait_heat_bad"));
    if (b.cold) parts.push(t(b.cold > 0 ? "sg_trait_cold_good" : "sg_trait_cold_bad"));
    return parts.join("・");
  }
  function previewBox(breedId, gate) {
    var box = el("div", { class: "sg-preview" });
    if (!V3 || !V3.available()) { box.appendChild(el("div", { class: "sg-muted sg-center" }, [t("sg_no_3d")])); return box; }
    V3.load().then(function () {
      if (!box.isConnected) return;
      ui.previews.push(V3.preview(box, breedId, gate || 0));
    }).catch(function () { box.textContent = t("sg_no_3d"); });
    return box;
  }
  function screenZukan() {
    var sel = ui.selBreed || D.BREEDS[0].id, b = D.BREED_BY_ID[sel];
    var detail = panel(L(b.name), [
      el("div", { class: "sg-zukan-detail" }, [
        previewBox(sel, 0),
        el("div", null, [
          el("p", { class: "sg-muted" }, [b.name.zh + " / " + b.name.ja + " / " + b.name.en]),
          el("p", null, [traitLine(b)]),
          statsTable(b.base)
        ])
      ])
    ]);
    app.appendChild(detail);
    var grid = el("div", { class: "sg-breed-grid" }, D.BREEDS.map(function (x) {
      return el("button", { type: "button", class: "sg-breed" + (x.id === sel ? " sg-on" : ""), onclick: function () { ui.selBreed = x.id; render(); } }, [
        el("span", { class: "sg-swatch", style: "background:" + x.model.c1 + ";border-color:" + x.model.c2 }),
        el("b", null, [L(x.name)]),
        el("small", null, [L(D.SIZES[x.size]) + "・" + L(D.STYLES[x.style])])
      ]);
    }));
    app.appendChild(panel(t("sg_zukan_all", { n: D.BREEDS.length }), [grid]));
  }

  // ---------------- 犬舍 ----------------
  function dogStats(d) {
    var b = breedOf(d), out = {};
    D.STATS.forEach(function (k) { out[k] = b.base[k] + (d.train[k] || 0) + d.lv * 0.5; });
    return out;
  }
  function screenKennel() {
    var s = K.load();
    if (ui.selDog && !K.dog(ui.selDog)) ui.selDog = null;
    if (!ui.selDog && s.dogs.length) ui.selDog = s.dogs[0].id;
    var list = el("div", { class: "sg-dog-list" }, s.dogs.map(function (d) {
      var b = breedOf(d);
      return el("button", { type: "button", class: "sg-dog-card" + (d.id === ui.selDog ? " sg-on" : ""), onclick: function () { ui.selDog = d.id; ui.msg = ""; render(); } }, [
        el("span", { class: "sg-swatch", style: "background:" + b.model.c1 + ";border-color:" + b.model.c2 }),
        el("b", null, [d.name]), el("small", null, [L(b.name) + " Lv" + d.lv]),
        el("small", null, [L(D.MOODS[d.mood].name) + " " + D.MOODS[d.mood].icon + "・" + t("sg_fatigue") + " " + d.fatigue]),
        League ? el("small", null, ["👥 " + League.fansOf(d).toLocaleString() + (League.titlesOf(d).length ? "・🏆" + League.titlesOf(d).length : "")]) : null
      ]);
    }));
    app.appendChild(panel(t("sg_kennel_title", { n: s.dogs.length, max: K.MAX_DOGS }), [s.dogs.length ? list : el("p", { class: "sg-muted" }, [t("sg_kennel_empty")])]));

    var d = ui.selDog ? K.dog(ui.selDog) : null;
    if (d) {
      var b = breedOf(d), stats = dogStats(d);
      // 訓練（2026-11-04）：每隻狗固定 20 次，分「基礎能力」與「障礙賽特化」兩組
      var tLeft = K.trainLeft(d);
      function trainGroup(g) {
        return el("div", { class: "sg-train" }, Object.keys(K.TRAININGS).filter(function (k) { return K.TRAININGS[k].group === g; }).map(function (k) {
          var tr = K.TRAININGS[k];
          return btn(tr.icon + " " + t("sg_train_" + k), function () {
            var r = K.train(d.id, k);
            if (!r) return;
            ui.msg = r.tired ? t("sg_msg_tired") : (r.noLeft ? t("sg_msg_train_none") : t("sg_msg_trained", { a: t("sg_stat_" + r.main), ga: r.gMain, b: t("sg_stat_" + r.sub), gb: r.gSub }) + " " + t("sg_msg_train_left", { n: r.left })) + (r.lvUp ? " " + t("sg_msg_lvup") : "") + (r.moodDown ? " " + t("sg_msg_mood_down") : "") + (r.newPool ? " " + t("sg_msg_new_pool", { n: SK.POOL_SIZE }) : "");
            render();
          }, "sg-btn", { title: t("sg_stat_" + tr.main) + " / " + t("sg_stat_" + tr.sub), disabled: d.fatigue >= 95, "data-train": k });
        }));
      }
      var trainBtns = el("div", { class: "sg-train-wrap" }, [
        el("div", { class: "sg-train-head" }, [
          el("p", { class: "sg-train-left" + (tLeft ? "" : " sg-muted") }, [t("sg_train_left", { n: tLeft, max: K.TRAIN_TIMES })]),
          btn("↺ " + t("sg_train_reset"), function () {
            if (!window.confirm(t("sg_train_reset_confirm", { name: d.name, n: K.TRAIN_TIMES }))) return;
            K.resetTraining(d.id);
            ui.msg = t("sg_msg_train_reset", { n: K.TRAIN_TIMES });
            render();
          }, "sg-link", { id: "sg-train-reset" })
        ]),
        el("h4", null, [t("sg_train_group_base")]), trainGroup("base"),
        el("h4", null, [t("sg_train_group_obs")]), trainGroup("obs")
      ]);
      var care = el("div", { class: "sg-actions" }, [
        (function () {
          var rl = K.restLeft(d);
          return btn("😴 " + (rl ? t("sg_rest_wait", { n: Math.ceil(rl / 60000) }) : t("sg_rest")), function () {
            ui.msg = K.rest(d.id) ? t("sg_msg_rest") : t("sg_msg_rest_wait", { n: Math.ceil(K.restLeft(d) / 60000) });
            render();
          }, "sg-btn", { disabled: rl > 0, title: t("sg_rest_note", { n: K.REST_CD_MIN }) });
        })(),
        btn("🎾 " + t("sg_play"), function () { K.play(d.id); ui.msg = t("sg_msg_play"); render(); }),
        btn("🍖 " + t("sg_treat", { n: money(K.TREAT_COST) }), function () { ui.msg = K.treat(d.id) ? t("sg_msg_treat") : t("sg_msg_no_money"); render(); }),
        btn("🏁 " + t("sg_practice"), function () { startSolo(true, d.id); }, "sg-btn sg-primary")
      ]);
      var info = el("div", null, [
        el("p", null, [el("b", null, [d.name]), " — " + L(b.name) + "・" + traitLine(b)]),
        el("p", { class: "sg-small" }, [
          "Lv " + d.lv + (d.lv < K.MAX_LV ? "（" + t("sg_exp") + " " + d.exp + "/" + K.expNeed(d.lv) + "）" : "") + "・" +
          t("sg_mood") + " " + L(D.MOODS[d.mood].name) + D.MOODS[d.mood].icon + "・" + t("sg_fatigue") + " " + d.fatigue + "/100・" + t("sg_bond") + " " + d.bond
        ]),
        el("p", { class: "sg-small" }, [t("sg_dog_record", { r: d.races, w: d.wins, p: d.top3, e: money(d.earnings) })]),
        League ? el("p", { class: "sg-small" }, ["👥 " + t("sg_fans_line", { n: League.fansOf(d).toLocaleString(), r: L(League.fanRank(League.fansOf(d))) })]) : null,
        League && League.titlesOf(d).length ? el("p", { class: "sg-small sg-titles" }, ["🏆 " + t("sg_titles") + "：", League.titlesOf(d).map(function (x) {
          return el("span", { class: "sg-title-chip sg-grade-" + x.grade }, [t("sg_season_n", { n: x.season }) + " " + x.grade + " " + L(League.STAKE_BY_ID[x.id].name)]);
        })]) : null,
        el("p", { class: "sg-small" }, [t("sg_best_style") + "：" + L(D.STYLES[K.bestStyle(d)]) + "・" + t("sg_run_style") + "：" + L(D.STYLES[K.runStyle(d)]) + "（" + aptG(K.bestStyle(d), K.runStyle(d)) + "）"]),
        statsTable(stats, d.train),
        el("p", { class: "sg-small sg-muted" }, [t("sg_train_cap", { n: K.TRAIN_CAP })]),
        (function () { var r = K.rating(d); return el("p", { class: "sg-rating-line" }, [t("sg_rating") + "：", el("b", { class: "sg-grade sg-grade-" + r.grade.replace("+", "p") }, [r.grade]), " " + r.pts + "pt（" + t("sg_rating_stat") + " " + r.stat + "＋" + t("sg_skills") + " " + r.skill + "）・" + t("sg_line") + "：" + L(D.LINES[K.lineOf(d)].name)]); })()
      ]);
      app.appendChild(panel(t("sg_kennel_detail"), [
        el("div", { class: "sg-zukan-detail" }, [previewBox(d.breed, 0), info]),
        ui.msg ? el("p", { class: "sg-msg" }, [ui.msg]) : null,
        dogStylePicker(d.id),
        el("h3", null, [t("sg_training")]), trainBtns,
        el("h3", null, [t("sg_care")]), care,
        skillPanel(d),
        el("div", { class: "sg-actions sg-sub" }, [
          btn(t("sg_rename"), function () { var n = window.prompt(t("sg_rename"), d.name); if (n) { K.rename(d.id, n); render(); } }, "sg-link"),
          btn(t("sg_release"), function () { if (window.confirm(t("sg_release_confirm", { name: d.name }))) { K.release(d.id); ui.selDog = null; render(); } }, "sg-link sg-danger")
        ])
      ]));
    }

    if (s.dogs.length < K.MAX_DOGS) {
      var pickB = ui.adoptBreed || D.BREEDS[0].id, cost = K.adoptCost();
      var sel = el("select", { class: "sg-input", onchange: function (e) { ui.adoptBreed = e.target.value; render(); } }, D.BREEDS.map(function (x) {
        return el("option", { value: x.id, selected: x.id === pickB }, [L(x.name) + "（" + L(D.SIZES[x.size]) + "）"]);
      }));
      var nameIn = el("input", { class: "sg-input", maxlength: "12", placeholder: t("sg_dog_name") });
      app.appendChild(panel(t("sg_adopt"), [
        el("div", { class: "sg-zukan-detail" }, [
          previewBox(pickB, 0),
          el("div", null, [
            el("div", { class: "sg-row" }, [sel, nameIn]),
            el("p", { class: "sg-small" }, [traitLine(D.BREED_BY_ID[pickB])]),
            statsTable(D.BREED_BY_ID[pickB].base),
            el("div", { class: "sg-actions" }, [
              btn(cost ? t("sg_adopt_btn_cost", { n: money(cost) }) : t("sg_adopt_btn_free"), function () {
                var r = K.adopt(pickB, nameIn.value);
                ui.msg = r ? t("sg_msg_adopted", { name: r.name }) : t("sg_msg_no_money");
                if (r) ui.selDog = r.id;
                render();
              }, "sg-btn sg-primary", { disabled: K.coins() < cost })
            ])
          ])
        ])
      ]));
    }
  }

  // ---------------- 技能（犬舍） ----------------
  // 上：這隻狗學會的技能（欄位 金 1／罕見 2／一般 2，點 × 遺忘）；下：技能池（訓練時抽 20 個、30 分鐘後消失，點一下讓這隻狗學）
  function skillPanel(d) {
    var have = K.skillsOf(d), old = K.expiredSkillsOf(d), used = SK.slotsUsed(have), pool = K.pool();
    function forgetBtn(sid) { return btn("×", function () { if (window.confirm(t("sg_forget_confirm", { s: L(SK.BY_ID[sid].name) }))) { K.forget(d.id, sid); render(); } }, "sg-x", { title: t("sg_forget") }); }
    var slots = el("div", { class: "sg-slots" }, SK.TIER_IDS.map(function (tier) {
      var mineT = have.filter(function (id) { return SK.BY_ID[id].tier === tier; }), oldT = old.filter(function (id) { return SK.BY_ID[id].tier === tier; }), cells = [];
      for (var i = 0; i < SK.TIERS[tier].slots; i++) {
        var id = mineT[i], oid = !id ? oldT[i - mineT.length] : null;
        if (id) cells.push(skillChip(id, [el("small", { class: "sg-skill-left" }, [t("sg_skill_left", { m: Math.ceil(K.skillLeft(d, id) / 60000) })]), forgetBtn(id)]));
        else if (oid) cells.push(el("span", { class: "sg-skill sg-skill-expired sg-skill-" + tier, title: t("sg_skill_expired_note") }, [SK.BY_ID[oid].icon + " " + L(SK.BY_ID[oid].name), el("small", null, ["⌛ " + t("sg_skill_expired")]), forgetBtn(oid)]));
        else cells.push(el("span", { class: "sg-skill sg-skill-empty sg-skill-" + tier }, [SK.TIERS[tier].icon + " " + t("sg_slot_empty")]));
      }
      return el("div", { class: "sg-slot-row" }, [el("b", null, [L(SK.TIERS[tier].name) + "（" + used[tier] + "/" + SK.TIERS[tier].slots + "）"])].concat(cells));
    }));
    var poolBox;
    if (!pool) poolBox = el("p", { class: "sg-muted" }, [t("sg_pool_none", { n: SK.POOL_SIZE, ttl: Math.round(SK.POOL_TTL_MS / 60000) })]);
    else {
      var mins = Math.floor(pool.left / 60000), secs = Math.floor(pool.left / 1000) % 60;
      poolBox = el("div", null, [
        el("p", { class: "sg-small" }, [t("sg_pool_left", { n: pool.ids.length, m: mins, s: (secs < 10 ? "0" : "") + secs })]),
        el("div", { class: "sg-pool-grid" }, SK.TIER_IDS.map(function (tier) {
          return el("div", { class: "sg-pool-tier" }, pool.ids.filter(function (id) { return SK.BY_ID[id].tier === tier; }).map(function (id) {
            var sk = SK.BY_ID[id], ok = SK.canLearn(have, id);
            return el("button", { type: "button", class: "sg-pool-item sg-skill-" + tier + (ok ? "" : " sg-off"), title: L(sk.desc), onclick: function () {
              var r = K.learn(d.id, id);
              ui.msg = r === "ok" ? t("sg_msg_learned", { name: d.name, s: L(sk.name) }) : r === "replaced" ? t("sg_msg_replaced", { name: d.name, s: L(sk.name) }) : r === "full" ? t("sg_msg_slot_full", { tier: L(SK.TIERS[tier].name) }) : r === "dup" ? t("sg_msg_skill_dup") : t("sg_msg_pool_gone");
              render();
            } }, [el("b", null, [sk.icon + " " + L(sk.name)]), el("small", null, [L(sk.desc) + "（" + sk.pts + "pt）"])]);
          }));
        }))
      ]);
    }
    return el("div", { class: "sg-skillbox" }, [
      el("h3", null, [t("sg_skills")]),
      el("p", { class: "sg-small sg-muted" }, [t("sg_skill_rule", { g: SK.TIERS.g.slots, r: SK.TIERS.r.slots, n: SK.TIERS.n.slots })]),
      el("p", { class: "sg-small sg-muted" }, [t("sg_skill_expire_rule", { ttl: Math.round(SK.POOL_TTL_MS / 60000) })]),
      old.length ? el("p", { class: "sg-small sg-warn" }, ["⌛ " + t("sg_skill_expired_warn", { n: old.length })]) : null,
      slots,
      el("h3", null, [t("sg_pool_title")]),
      poolBox
    ]);
  }

  // ---------------- 紀錄 ----------------
  function screenRecord() {
    var s = K.load(), st = s.stats;
    app.appendChild(panel(t("sg_menu_record"), [
      el("p", null, [t("sg_record_sum", { r: st.races, spent: money(st.spent), won: money(st.won), net: money(st.won - st.spent) })]),
      el("table", { class: "sg-table" }, [
        el("thead", null, [el("tr", null, [t("sg_col_when"), t("sg_col_race"), t("sg_col_winner"), t("sg_col_bet"), t("sg_col_pay")].map(function (h) { return el("th", null, [h]); }))]),
        el("tbody", null, s.history.map(function (h) {
          return el("tr", null, [new Date(h.at).toLocaleString(), h.title, h.winner, money(h.spent), money(h.won)].map(function (c) { return el("td", null, [c]); }));
        }))
      ])
    ]));
  }

  // ---------------- 單機：設定 ----------------
  function entryPicker(onPick) {
    var s = K.load();
    var sel = el("select", { class: "sg-input", onchange: function (e) { ui.entryDog = e.target.value; setPref({ entryDog: ui.entryDog }); if (onPick) onPick(); } },
      [el("option", { value: "" }, [t("sg_entry_none")])].concat(s.dogs.map(function (d) {
        var ex = K.expiredSkillsOf(d).length;
        return el("option", { value: d.id, selected: d.id === ui.entryDog }, [d.name + "（" + L(breedOf(d).name) + " Lv" + d.lv + "・" + t("sg_fatigue") + d.fatigue + "）" + (ex ? " " + t("sg_entry_expired", { n: ex }) : "")]);
      })));
    if (ui.entryDog && !K.dog(ui.entryDog)) ui.entryDog = "";
    return sel;
  }
  function classPicker(onPick, disabled) {
    return el("div", { class: "sg-seg" }, D.CLASSES.map(function (c) {
      return btn(L(c.name), function () { ui.cls = c.id; setPref({ cls: c.id }); if (onPick) onPick(); else render(); }, "sg-seg-btn" + (ui.cls === c.id ? " sg-on" : ""), { disabled: disabled });
    }));
  }
  // 地圖設定：地形／天氣／距離（空字串＝隨機）
  function mapOpts() { return { terrain: ui.map.terrain || null, weather: ui.map.weather || null, dist: ui.map.dist || null }; }
  function mapPicker(onPick, disabled) {
    function seg(field, table, label) {
      var keys = [""].concat(Object.keys(table));
      return el("div", null, [el("h3", null, [label]), el("div", { class: "sg-seg" }, keys.map(function (k) {
        var name = k ? (table[k].icon ? table[k].icon + " " : "") + L(table[k].name) : "🎲 " + t("sg_random");
        return btn(name, function () { ui.map[field] = k; setPref({ map: ui.map }); if (onPick) onPick(); else rerenderKeep(); }, "sg-seg-btn" + ((ui.map[field] || "") === k ? " sg-on" : ""), { disabled: disabled });
      }))]);
    }
    return el("div", null, [
      seg("terrain", D.TERRAINS, t("sg_terrain")),
      seg("weather", D.WEATHERS, t("sg_weather")),
      seg("dist", D.DISTANCES, t("sg_distance")),
      el("p", { class: "sg-small sg-muted" }, [t("sg_map_note")])
    ]);
  }
  // 模式：目前的關卡賽／真賽狗
  function modePicker(onPick, disabled) {
    return el("div", null, [
      el("div", { class: "sg-seg" }, [["classic", "sg_mode_classic"], ["real", "sg_mode_real"]].map(function (m) {
        return btn(t(m[1]), function () { ui.mode = m[0]; setPref({ mode: m[0] }); if (onPick) onPick(); else rerenderKeep(); }, "sg-seg-btn" + (ui.mode === m[0] ? " sg-on" : ""), { disabled: disabled });
      })),
      el("p", { class: "sg-small sg-muted" }, [t(ui.mode === "real" ? "sg_mode_real_note" : "sg_mode_classic_note")])
    ]);
  }
  // 真賽狗：關卡障礙開／關（2026-11-03 使用者指定「能選擇是否起動關卡障礙」）
  function obsPicker(onPick, disabled) {
    return el("div", null, [
      el("h3", null, [t("sg_obstacles")]),
      el("div", { class: "sg-seg" }, [[true, "sg_obs_on"], [false, "sg_obs_off"]].map(function (o) {
        return btn(t(o[1]), function () { ui.obs = o[0]; setPref({ obs: o[0] }); if (onPick) onPick(); else rerenderKeep(); }, "sg-seg-btn" + (ui.obs === o[0] ? " sg-on" : ""), { disabled: disabled });
      })),
      el("p", { class: "sg-small sg-muted" }, [t(ui.obs ? "sg_obs_on_note" : "sg_obs_off_note")])
    ]);
  }
  // 真賽狗：可以派好幾隻（勾選）
  var ENTRY_MAX_SOLO = 6, ENTRY_MAX_NET = 4;
  function multiEntryPicker(max, onPick) {
    var s = K.load();
    ui.entryDogs = ui.entryDogs.filter(function (id) { return K.dog(id); }).slice(0, max);
    if (!s.dogs.length) return el("p", { class: "sg-muted" }, [t("sg_kennel_empty")]);
    return el("div", null, [
      el("div", { class: "sg-entry-multi" }, s.dogs.map(function (d) {
        var on = ui.entryDogs.indexOf(d.id) >= 0, r = K.rating(d);
        return el("label", { class: "sg-entry-chk" + (on ? " sg-on" : "") }, [
          el("input", { type: "checkbox", checked: on, disabled: !on && ui.entryDogs.length >= max, onchange: function (e) {
            if (e.target.checked) { if (ui.entryDogs.indexOf(d.id) < 0 && ui.entryDogs.length < max) ui.entryDogs.push(d.id); }
            else ui.entryDogs = ui.entryDogs.filter(function (x) { return x !== d.id; });
            setPref({ entryDogs: ui.entryDogs });
            if (onPick) onPick(); else rerenderKeep();
          } }),
          " " + d.name + "（" + L(breedOf(d).name) + " Lv" + d.lv + "・" + r.grade + "・" + t("sg_fatigue") + d.fatigue + "）",
          K.expiredSkillsOf(d).length ? el("small", { class: "sg-warn" }, [" " + t("sg_entry_expired", { n: K.expiredSkillsOf(d).length })]) : null
        ]);
      })),
      el("p", { class: "sg-small sg-muted" }, [t("sg_entry_multi_note", { n: max })])
    ]);
  }
  // 真賽狗：勾選的每一隻各自決定跑法（出賽前決定，開跑後不能改）
  function entryStylePickers(onPick) {
    return el("div", null, ui.entryDogs.filter(function (id) { return K.dog(id); }).map(function (id) {
      var d = K.dog(id);
      return el("div", { class: "sg-entry-style" }, [
        el("b", null, [d.name + "（" + t("sg_best_style") + "：" + L(D.STYLES[K.bestStyle(d)]) + "）"]),
        stylePicker(K.bestStyle(d), K.runStyle(d), function (st) { K.setRunStyle(id, st); if (onPick) onPick(); rerenderKeep(); })
      ]);
    }));
  }
  function screenSetup() {
    var real = ui.mode === "real";
    app.appendChild(panel(t("sg_menu_solo"), [
      el("h3", null, [t("sg_mode")]), modePicker(render),
      el("h3", null, [t("sg_class")]), classPicker(),
      el("p", { class: "sg-small sg-muted" }, [t("sg_class_note")]),
      mapPicker(),
      real ? obsPicker() : null,
      el("h3", null, [t("sg_entry")]), real ? multiEntryPicker(ENTRY_MAX_SOLO) : entryPicker(rerenderKeep),
      real ? entryStylePickers() : dogStylePicker(ui.entryDog),
      el("div", { class: "sg-actions" }, [btn(t("sg_make_card"), function () { startSolo(false, ui.entryDog); }, "sg-btn sg-primary")])
    ]));
    if (League) app.appendChild(stakesPanel());
  }
  // ---- 重賞賽程（2026-11-05）：10 場固定重賞依序進行，報名看派出的狗的粉絲數 ----
  function stakeDogIds(stake) {
    if (stake.mode === "real") return ui.entryDogs.filter(function (id) { return K.dog(id); }).slice(0, ENTRY_MAX_SOLO).concat(ui.entryDogs.length ? [] : ui.entryDog ? [ui.entryDog] : []);
    var one = ui.entryDog && K.dog(ui.entryDog) ? ui.entryDog : ui.entryDogs.filter(function (id) { return K.dog(id); })[0];
    return one ? [one] : [];
  }
  function stakeChip(st) {
    var TR = D.TERRAINS[st.terrain];
    return el("span", { class: "sg-small sg-muted" }, [TR.icon + " " + L(TR.name) + "・" + L(D.DISTANCES[st.dist].name) + (st.mode === "real" ? "・🏟 " + t("sg_mode_real") : "") + "・👥 ≥ " + st.fans.toLocaleString()]);
  }
  function stakesPanel() {
    var cur = League.current(), L0 = League.state();
    var ids = stakeDogIds(cur.stake), ok = ids.length && League.canEnter(ids, cur.stake);
    var won = {};
    L0.log.forEach(function (x) { if (x.season === cur.season && !won[x.id]) won[x.id] = x; });
    return panel("🏆 " + t("sg_stakes_title", { n: cur.season }), [
      el("ol", { class: "sg-stakes" }, League.STAKES.map(function (st, i) {
        var done = i < cur.week, now = i === cur.week, lg = won[st.id];
        return el("li", { class: "sg-stake" + (now ? " sg-on" : "") + (done ? " sg-done" : "") }, [
          el("b", { class: "sg-grade-badge sg-grade-" + st.grade }, [st.grade]), " ", el("b", null, [L(st.name)]), " ", stakeChip(st),
          done ? el("small", { class: lg && lg.mine ? "sg-good" : "sg-muted" }, [lg ? "　🏁 " + lg.winner + (lg.mine ? " 🎉" : "") : "　" + t("sg_stakes_skipped")]) : null,
          now ? el("div", { class: "sg-actions" }, [
            btn("🏆 " + t("sg_stakes_enter"), function () { startStakes(); }, "sg-btn sg-primary", { disabled: !ok }),
            btn(t("sg_stakes_skip"), function () { League.advance(); rerenderKeep(); }, "sg-link")
          ]) : null,
          now ? el("p", { class: "sg-small " + (ok ? "sg-muted" : "sg-danger") }, [!ids.length ? t("sg_stakes_need_dog") : ok ? t("sg_stakes_with", { names: ids.map(function (id) { return K.dog(id).name; }).join("、") }) : t("sg_stakes_need_fans", { n: st.fans.toLocaleString() })]) : null
        ]);
      })),
      el("p", { class: "sg-small sg-muted" }, [t("sg_stakes_note")])
    ]);
  }
  function freshSlip() { ui.result = null; ui.tickets = []; ui.openDog = -1; ui.slip = { type: "win", method: "normal", picks: [], key: null, stake: ui.slip.stake || 100 }; }
  function startStakes() {
    var cur = League.current(), st = cur.stake, ids = stakeDogIds(st);
    if (!ids.length || !League.canEnter(ids, st)) return;
    var entries = ids.map(function (id) { return K.entry(id, "me", ""); }).filter(Boolean);
    var rv = League.pickRivals(st.grade === "G1" ? 2 : 1).map(function (id) { return League.rivalEntry(id, entries); });
    var o = { cls: "stakes", terrain: st.terrain, dist: st.dist };
    if (st.mode === "real") { o.mode = "real"; o.obstacles = true; }
    ui.practice = false;
    ui.card = Core.makeCard(Core.newSeed(), entries.concat(rv), o);
    ui.card.stakes = { id: st.id, grade: st.grade, season: cur.season };
    ui.card.prizeMult = League.GRADES[st.grade].prize;
    freshSlip();
    go("card");
  }
  // 一般單機比賽：有派狗、不是新手戰時有機率出現宿敵（max＝這場最多幾隻）
  function withRival(entries, cls, max) {
    if (!League || !entries.length || entries.length >= max || !League.rollRival(cls)) return entries;
    return entries.concat([League.rivalEntry(League.pickRivals(1)[0], entries)]);
  }
  function startSolo(practice, dogId) {
    var entries = [];
    if (!practice && ui.mode === "real") {
      ui.practice = false;
      ui.entryDogs.forEach(function (id) { var e1 = K.entry(id, "me", ""); if (e1) entries.push(e1); });
      var ro = mapOpts();
      ro.mode = "real"; ro.cls = ui.cls; ro.obstacles = ui.obs;
      ui.card = Core.makeCard(Core.newSeed(), withRival(entries.slice(0, ENTRY_MAX_SOLO), ui.cls, Real.FIELD), ro);
      ui.result = null; ui.tickets = []; ui.openDog = -1;
      ui.slip = { type: "win", method: "normal", picks: [], key: null, stake: ui.slip.stake || 100 };
      go("card");
      return;
    }
    var e = dogId ? K.entry(dogId, "me", "") : null;
    if (e) entries.push(e);
    ui.practice = !!practice;
    var o = mapOpts();
    o.cls = practice ? "rookie" : ui.cls;
    ui.card = Core.makeCard(Core.newSeed(), practice ? entries : withRival(entries, o.cls, D.FIELD), o);
    ui.result = null; ui.tickets = []; ui.openDog = -1;
    ui.slip = { type: "win", method: "normal", picks: [], key: null, stake: ui.slip.stake || 100 };
    if (practice) { startRace(); return; }
    go("card");
  }

  // ---------------- 出賽表＋下注 ----------------
  function minimap(card, w, h) {
    var c = el("canvas", { class: "sg-minimap", width: w, height: h });
    drawMinimap(c, card, null);
    return c;
  }
  var PART_COLORS = { straight: "#b98a5a", curve: "#b98a5a", hurdle: "#e53935", tunnel: "#8e24aa", frisbee: "#fdd835", weave: "#ff7043", pool: "#29b6f6", mud: "#5d4037", aframe: "#43a047", treat: "#ec407a", stay: "#1e88e5", hill: "#7cb342", bridge: "#6d4c41",
    hurdlerace: "#ff1744", firewheel: "#ff6d00", looptube: "#00bcd4", climbwall: "#7e57c2", wallkick: "#78909c", seesaw: "#fbc02d", dogwalk: "#a1887f", tirerun: "#424242", ballpit: "#f06292", sprinkler: "#4fc3f7", conveyor: "#616161", slide: "#26a69a", trampoline: "#3949ab", windmill: "#d81b60", catzone: "#ff9800", sled: "#5d4037", ditch: "#1f5f7a", stairs: "#8d6e63", surf: "#0288d1", skateboard: "#546e7a", ski: "#90caf9" };
  // 真賽狗的小地圖：橢圓跑道＋終點＋狗的位置
  function drawOval(c, card, positions) {
    var g = c.getContext("2d"), W = c.width, H = c.height, pad = 8;
    var bx = Real.LS / 2 + Real.R + Real.W, by = Real.R + Real.W;
    var sc = Math.min((W - pad * 2) / (bx * 2), (H - pad * 2) / (by * 2));
    function X(x) { return W / 2 + x * sc; }
    function Y(y) { return H / 2 - y * sc; }
    g.clearRect(0, 0, W, H);
    g.strokeStyle = "#c9a36a"; g.lineWidth = Math.max(3, Real.W * sc);
    g.beginPath();
    for (var ts = 0; ts <= Real.LAP + 1; ts += 3) { var p = Real.trackXY(ts, Real.W / 2); if (ts === 0) g.moveTo(X(p.x), Y(p.y)); else g.lineTo(X(p.x), Y(p.y)); }
    g.closePath(); g.stroke();
    var f0 = Real.trackXY(Real.FINISH, -0.5), f1 = Real.trackXY(Real.FINISH, Real.W + 0.5);
    g.strokeStyle = "#111"; g.lineWidth = 2; g.beginPath(); g.moveTo(X(f0.x), Y(f0.y)); g.lineTo(X(f1.x), Y(f1.y)); g.stroke();
    var s0 = Real.trackXY(card.start, -0.5), s1 = Real.trackXY(card.start, Real.W + 0.5);
    g.strokeStyle = "#1e88e5"; g.beginPath(); g.moveTo(X(s0.x), Y(s0.y)); g.lineTo(X(s1.x), Y(s1.y)); g.stroke();
    (positions || []).forEach(function (p, i) {
      g.beginPath(); g.arc(X(p.x), Y(p.z), 4, 0, Math.PI * 2);
      g.fillStyle = D.GATE_COLORS[i]; g.fill(); g.lineWidth = 1.2; g.strokeStyle = "#333"; g.stroke();
    });
  }
  function drawMinimap(c, card, positions) {
    if (isOval(card)) { drawOval(c, card, positions); return; }
    var g = c.getContext("2d"), geo = Core.geometry(card.course), box = geo.box;
    var W = c.width, H = c.height, pad = 10;
    var sc = Math.min((W - pad * 2) / Math.max(1, box[2] - box[0]), (H - pad * 2) / Math.max(1, box[3] - box[1]));
    var ox = (W - (box[2] - box[0]) * sc) / 2, oy = (H - (box[3] - box[1]) * sc) / 2;
    function X(x) { return ox + (x - box[0]) * sc; }
    function Y(y) { return H - (oy + (y - box[1]) * sc); }
    g.clearRect(0, 0, W, H);
    g.lineCap = "round";
    card.course.parts.forEach(function (p) {
      g.strokeStyle = PART_COLORS[p.type] || "#999";
      g.lineWidth = p.type === "straight" || p.type === "curve" ? 4 : 6;
      g.beginPath();
      for (var s = p.s0; s <= p.s0 + p.len; s += 2) {
        var i = Math.min(geo.N - 1, Math.round(s));
        if (s === p.s0) g.moveTo(X(geo.x[i]), Y(geo.y[i])); else g.lineTo(X(geo.x[i]), Y(geo.y[i]));
      }
      g.stroke();
    });
    var f = Core.pointAt(card.course, card.course.length, 0);
    g.fillStyle = "#111"; g.fillRect(X(f.x) - 3, Y(f.y) - 3, 6, 6);
    if (positions) {
      positions.forEach(function (p, i) {
        g.beginPath(); g.arc(X(p.x), Y(p.z), 4.5, 0, Math.PI * 2);
        g.fillStyle = D.GATE_COLORS[i]; g.fill(); g.lineWidth = 1.2; g.strokeStyle = "#333"; g.stroke();
      });
    }
  }
  function partChips(card) {
    return el("div", { class: "sg-parts" }, card.course.parts.map(function (p) {
      var def = D.PARTS[p.type], nm = D.partName(p);
      return el("span", { class: "sg-part sg-part-" + p.type, title: nm }, [def.icon + " " + nm + (p.type === "hurdle" || p.type === "hurdlerace" ? "×" + p.bars : p.type === "firewheel" ? "×" + p.rings : p.type === "wallkick" ? "×" + p.kicks : p.type === "ditch" ? " ↔" + p.dw + "m" : "") + (p.type === "hill" ? " ↑" + p.hh + "m" : "") + " " + p.len + "m"]);
    }));
  }
  function raceTitle(card) {
    var cls = D.CLASSES.filter(function (c) { return c.id === card.cls; })[0];
    var TR = D.TERRAINS[card.terrain] || D.TERRAINS.park;
    var stk = League && card.stakes && League.STAKE_BY_ID[card.stakes.id];
    if (stk) return "🏆 " + stk.grade + " " + L(stk.name) + "・" + L(TR.name) + "・" + card.course.length + "m";
    if (card.cup) return "🏆 " + t("sg_cup_stage_" + card.cup.stage) + "・" + L(TR.name) + "・" + card.course.length + "m";
    if (isOval(card)) return "🏟 " + t("sg_mode_real") + "・" + L(cls.name) + "・" + card.length + "m";
    if (isReal(card)) return "🏟 " + t("sg_mode_real") + "・" + L(cls.name) + "・" + L(TR.name) + "・" + card.course.length + "m";
    return (ui.practice ? t("sg_practice") : L(cls.name)) + "・" + L(TR.name) + "・" + card.course.length + "m";
  }
  function canBet() {
    if (ui.practice) return false;
    if (ui.room) { var m = ui.room.match; return !!m && !m.startAt && !(ui.room.me.ready); }
    return true;
  }
  function screenCard() {
    var card = ui.card;
    if (!card) { go(ui.room ? "lobby" : "home"); return; }
    var od = curOdds(card), pop = popOf(od), W = D.WEATHERS[card.weather], G = D.GROUNDS[card.ground], pk = Core.paceKind(card);
    if (isOval(card)) {
      app.appendChild(panel(raceTitle(card), [
        el("div", { class: "sg-card-head" }, [
          minimap(card, 260, 150),
          el("div", null, [
            el("p", { class: "sg-cond" }, [
              el("span", { class: "sg-chip" }, ["🏟 " + t("sg_real_track")]),
              el("span", { class: "sg-chip" }, [L(Real.DISTS[card.dist].name)]),
              el("span", { class: "sg-chip" }, [W.icon + " " + L(W.name)]),
              el("span", { class: "sg-chip" }, [t("sg_ground") + "：" + L(G.name)]),
              el("span", { class: "sg-chip sg-code", title: t("sg_code_note") }, [t("sg_code") + " #" + Core.courseCode(card)]),
              el("span", { class: "sg-chip sg-pace-" + pk, title: t("sg_pace_note_" + pk) }, [t("sg_pace") + "：" + t("sg_pace_" + pk)]),
              !ui.practice ? el("span", { class: "sg-chip sg-jp" }, ["💰 " + t("sg_jp_chip", { n: money(jackpotAmt()) })]) : null,
              poolMode(card) ? el("span", { class: "sg-chip sg-pool" }, [t("sg_pool_chip", { n: money(Bet.poolTotal(ui.room.livePool())) })]) : null
            ]),
            el("p", { class: "sg-small sg-muted" }, [t("sg_real_note")]),
            el("p", { class: "sg-small sg-muted" }, [t("sg_weather_note_" + card.weather)])
          ])
        ])
      ]));
    } else app.appendChild(panel(raceTitle(card), [
      el("div", { class: "sg-card-head" }, [
        minimap(card, 260, 170),
        el("div", null, [
          el("p", { class: "sg-cond" }, [
            isReal(card) ? el("span", { class: "sg-chip sg-real-chip" }, ["🏟 " + t("sg_real_crowd_chip")]) : null,
            card.noObs ? el("span", { class: "sg-chip sg-real-chip" }, ["🏁 " + t("sg_real_flat_chip")]) : null,
            el("span", { class: "sg-chip" }, [(D.TERRAINS[card.terrain] || D.TERRAINS.park).icon + " " + L((D.TERRAINS[card.terrain] || D.TERRAINS.park).name) + "（" + L(D.SURFACES[(D.TERRAINS[card.terrain] || D.TERRAINS.park).surf].name) + "）"]),
            el("span", { class: "sg-chip" }, [W.icon + " " + L(W.name)]),
            el("span", { class: "sg-chip" }, [L((D.DISTANCES[card.dist] || D.DISTANCES.middle).name)]),
            el("span", { class: "sg-chip sg-code", title: t("sg_code_note") }, [t("sg_code") + " #" + Core.courseCode(card)]),
            el("span", { class: "sg-chip" }, [t("sg_ground") + "：" + L(G.name)]),
            el("span", { class: "sg-chip" }, [t("sg_parts_n", { n: card.course.parts.filter(function (p) { return p.type !== "straight" && p.type !== "curve"; }).length })]),
            el("span", { class: "sg-chip sg-pace-" + pk, title: t("sg_pace_note_" + pk) }, [t("sg_pace") + "：" + t("sg_pace_" + pk)]),
            !ui.practice ? el("span", { class: "sg-chip sg-jp" }, ["💰 " + t("sg_jp_chip", { n: money(jackpotAmt()) })]) : null,
            poolMode(card) ? el("span", { class: "sg-chip sg-pool" }, [t("sg_pool_chip", { n: money(Bet.poolTotal(ui.room.livePool())) })]) : null
          ]),
          card.noObs ? null : partChips(card),
          isReal(card) ? el("p", { class: "sg-small sg-muted" }, [t(card.noObs ? "sg_real_note_flat" : "sg_real_note")]) : null,
          el("p", { class: "sg-small sg-muted" }, [t("sg_terrain_note_" + (card.terrain || "park"))]),
          el("p", { class: "sg-small sg-muted" }, [t("sg_weather_note_" + card.weather)])
        ])
      ])
    ]));

    if (ui.room && card.cup && Cup) app.appendChild(cupPanel(ui.room.cup, card));
    // 宿敵登場（2026-11-05）
    var rvDogs = League ? card.dogs.map(function (d, i) { return { d: d, i: i }; }).filter(function (x) { return x.d.rival && League.RIVAL_BY_ID[x.d.rival]; }) : [];
    if (rvDogs.length) app.appendChild(panel("🔥 " + t("sg_rival_title"), rvDogs.map(function (x) {
      var rs = League.state().rv[x.d.rival], tn = League.rivalTaunt(x.d.rival);
      return el("div", { class: "sg-rival" }, [
        el("div", null, [gateBadge(x.i), " ", el("b", null, [x.d.name]), " ", el("small", { class: "sg-muted" }, [x.d.ownerName + "・" + L(breedOf(x.d).name) + "・" + t("sg_rival_record", { w: rs.w, l: rs.l })])]),
        el("p", { class: "sg-rival-line" }, ["「" + L(tn) + "」"])
      ]);
    }).concat([el("p", { class: "sg-small sg-muted" }, [t("sg_rival_note")])]), "sg-rival-panel"));

    // 出走表
    var rows = [];
    card.dogs.forEach(function (d, i) {
      var b = breedOf(d), mine = isMine(d), mood = D.MOODS[d.mood];
      rows.push(el("tr", { class: "sg-dogrow" + (mine ? " sg-mine" : "") + (ui.openDog === i ? " sg-open" : ""), onclick: function () { ui.openDog = ui.openDog === i ? -1 : i; rerenderKeep(); } }, [
        el("td", null, [gateBadge(i)]),
        el("td", null, [el("b", null, [d.rival ? "🔥 " + d.name : d.name]), el("br"), el("small", null, [L(b.name)])]),
        el("td", { class: "sg-hide-s" }, [d.cpu ? (isReal(card) && d.ownerName ? d.ownerName : "CPU") : (mine ? t("sg_owner_me") : d.ownerName || t("sg_owner_player"))]),
        el("td", { class: "sg-mood sg-mood-" + d.mood }, [mood.icon + " " + L(mood.name)]),
        // 表上不顯示跑法適性（A〜D）、總評分、速／耐／敏（2026-11-03 使用者指定）
        el("td", { class: "sg-hide-s" }, [L(D.STYLES[d.style]), isReal(card) ? el("br") : null, isReal(card) ? el("small", null, [L((D.LINES[d.line] || D.LINES.mid).name)]) : null]),
        el("td", { class: "sg-odds" }, [od.win[i].toFixed(1)]),
        el("td", null, [t("sg_pop_n", { n: pop[i] })])
      ]));
      // 真賽狗：每隻狗的 8 項能力與技能直接列在下面（2026-11-03 使用者指定），點技能看簡易說明
      if (isReal(card) && ui.openDog !== i) {
        rows.push(el("tr", { class: "sg-dogsub" + (mine ? " sg-mine" : "") }, [el("td", { colspan: "7" }, [
          statMini(d.eff, mine, card, i),
          el("div", { class: "sg-skills" }, (d.skills || []).length ? d.skills.map(function (id) { return skillTap(id, "c" + i); }) : [el("span", { class: "sg-muted sg-small" }, [t("sg_no_skills")])]),
          skillDesc(d.skills, "c" + i)
        ])]));
      }
      if (ui.openDog === i) {
        rows.push(el("tr", { class: "sg-dogdetail" }, [el("td", { colspan: "7" }, [
          el("div", { class: "sg-zukan-detail" }, [
            previewBox(d.breed, i),
            el("div", null, [
              el("p", null, [traitLine(b) + (d.lv ? "・Lv" + d.lv : "")]),
              mine ? el("p", { class: "sg-small" }, [t("sg_best_style") + "：" + L(D.STYLES[d.best || d.style]) + "・" + t("sg_run_style") + "：" + styleLabel(d) + "・" + t("sg_rating") + "：" + dogRatingText(d)])
                : el("p", { class: "sg-small" }, [t("sg_run_style") + "：" + L(D.STYLES[d.style])]),
              mine ? statsTable(d.eff) : statsRangeTable(d.eff, card, i),
              mine ? null : el("p", { class: "sg-small sg-muted" }, [t("sg_stat_range_note")]),
              el("p", { class: "sg-skills" }, [t("sg_skills") + "："].concat((d.skills || []).length ? d.skills.map(function (id) { return skillTap(id, "d" + i); }) : [el("span", { class: "sg-muted" }, [t("sg_no_skills")])])),
              skillDesc(d.skills, "d" + i),
              isReal(card) ? el("p", { class: "sg-small" }, [t("sg_line") + "：" + L((D.LINES[d.line] || D.LINES.mid).name) + "・" + t("sg_line_note_" + (d.line || "mid"))]) : null,
              el("p", { class: "sg-small sg-muted" }, [t("sg_eff_note")]),
              el("p", { class: "sg-small" }, [t("sg_place_odds") + "：" + oddsText(od, "place", String(i))])
            ])
          ])
        ])]));
      }
    });
    app.appendChild(panel(t("sg_entries"), [el("table", { class: "sg-table sg-entries" }, [
      el("thead", null, [el("tr", null, ["", t("sg_col_dog"), el("span", { class: "sg-hide-s" }, [t("sg_col_owner")]), t("sg_mood"), el("span", { class: "sg-hide-s" }, [t("sg_style")]), t("sg_col_odds"), t("sg_col_pop")].map(function (h) { return el("th", null, [h]); }))]),
      el("tbody", null, rows)
    ]), el("p", { class: "sg-small sg-muted" }, [t("sg_click_detail") + (isReal(card) ? " " + t("sg_card_skill_tap") : "")])]));

    if (!ui.practice && Press) app.appendChild(pressPanel(card));

    // 單機：自己的狗可以在出賽表上改跑法（買了票之後就鎖定，免得先下注再改）
    if (!ui.room && !ui.practice) card.dogs.forEach(function (md) {
      if (!isMine(md)) return;
      app.appendChild(panel(t("sg_style_pick_title", { name: md.name }), [
        stylePicker(md.best || md.style, md.style, function (st) {
          md.style = st; card._odds = null; card._press = null;
          if (md.dogId) K.setRunStyle(md.dogId, st);
          rerenderKeep();
        }, ui.tickets.length > 0),
        el("p", { class: "sg-small sg-muted" }, [ui.tickets.length ? t("sg_style_locked") : t("sg_apt_note")])
      ]));
    });
    if (ui.room && card.w5 && Cup) app.appendChild(w5Panel(card));
    if (!ui.practice) app.appendChild(betSlip(card, od));
    app.appendChild(cardActions());
  }
  // 賽前情報（2026-11-05）：看板＋3 位記者的預測印＋記者戰績
  function pressPanel(card) {
    var pad = Press.paddock(card), mk = Press.marks(card), st = Press.stats();
    var head = el("tr", null, ["", t("sg_col_dog"), t("sg_paddock")].concat(Press.REPORTERS.map(function (rp) { return el("span", { title: L(rp.name) }, [rp.icon]); })).map(function (h) { return el("th", null, [h]); }));
    var body = card.dogs.map(function (d, i) {
      var lv = Press.LEVELS[String(pad[i].lv)];
      return el("tr", { class: isMine(d) ? "sg-mine" : "" }, [
        el("td", null, [gateBadge(i)]),
        el("td", null, [el("b", null, [d.name])]),
        el("td", { class: "sg-pad sg-pad-" + (pad[i].lv + 2) }, [lv.icon + " " + L(lv.text), pad[i].kakari ? el("div", { class: "sg-pad-hot" }, ["🔥 " + L(Press.KAKARI_HINT)]) : null]),
      ].concat(Press.REPORTERS.map(function (rp) { var m = mk[rp.id][i]; return el("td", { class: "sg-mark" + (m === "◎" ? " sg-mark-hon" : "") }, [m || ""]); })));
    });
    return panel("📰 " + t("sg_press_title"), [
      el("table", { class: "sg-table sg-press" }, [el("thead", null, [head]), el("tbody", null, body)]),
      el("ul", { class: "sg-reporters" }, Press.REPORTERS.map(function (rp) {
        var x = st[rp.id];
        return el("li", null, [rp.icon + " ", el("b", null, [L(rp.name)]), "：" + L(rp.note) + "　",
          el("small", { class: "sg-muted" }, [x.n ? t("sg_press_record", { n: x.n, w: Math.round(x.win / x.n * 100), p: Math.round(x.top3 / x.n * 100) }) : t("sg_press_record_none")])]);
      })),
      el("p", { class: "sg-small sg-muted" }, [t("sg_paddock_note")])
    ]);
  }
  // 出走表上的總評分（能力用當天的有效能力）
  function dogRatingText(d) { var r = SK.rating(d.eff, d.skills); return r.grade + " " + r.pts; }
  function isMine(d) {
    if (!d || d.cpu) return false;
    if (ui.room) return d.owner === ui.room.cid;
    return d.owner === "me";
  }
  function rerenderKeep() { var y = window.scrollY; render(); window.scrollTo(0, y); }

  function betSlip(card, od) {
    var sl = ui.slip, bt = Bet.TYPE[sl.type], open = canBet();
    var typeSeg = el("div", { class: "sg-seg" }, D.BET_TYPES.map(function (x) {
      return btn(L(x.name), function () { sl.type = x.id; if (x.pick === 1) sl.method = "normal"; sl.picks = []; sl.key = null; rerenderKeep(); }, "sg-seg-btn" + (sl.type === x.id ? " sg-on" : ""), { disabled: !open });
    }));
    var methodSeg = bt.pick > 1 ? el("div", { class: "sg-seg" }, ["normal", "box", "key"].map(function (m) {
      return btn(t("sg_method_" + m), function () { sl.method = m; sl.picks = []; sl.key = null; rerenderKeep(); }, "sg-seg-btn" + (sl.method === m ? " sg-on" : ""), { disabled: !open });
    })) : null;
    // 選狗：普通買法依序點（有順序的票點的順序就是名次）；壓住：先點軸
    var pickRow = el("div", { class: "sg-picks" }, card.dogs.map(function (d, i) {
      var idx = sl.picks.indexOf(i), isKey = sl.key === i;
      var label = [gateBadge(i), " " + d.name];
      if (isKey) label.push(el("em", null, [" " + t("sg_key_mark")]));
      else if (idx >= 0 && sl.method === "normal" && bt.ordered && bt.pick > 1) label.push(el("em", null, [" " + t("sg_nth", { n: idx + 1 })]));
      return el("button", { type: "button", class: "sg-pick" + (idx >= 0 || isKey ? " sg-on" : "") + (isKey ? " sg-key" : ""), disabled: !open, onclick: function () {
        if (sl.method === "key" && bt.pick > 1 && sl.key === null) { sl.key = i; }
        else if (isKey) { sl.key = null; }
        else if (idx >= 0) sl.picks.splice(idx, 1);
        else {
          if (sl.method === "normal" && bt.pick > 1 && sl.picks.length >= bt.pick) sl.picks.shift();
          sl.picks.push(i);
        }
        rerenderKeep();
      } }, label);
    }));
    var picks = sl.method === "key" ? sl.picks.concat(sl.key === null ? [] : [sl.key]) : sl.picks;
    var draft = Bet.makeTicket(card, sl.type, sl.method, picks, sl.key, sl.stake, od);
    var ods = [];
    draft.combos.forEach(function (c) { var rg = od.range && od.range[draft.type] && od.range[draft.type][c]; ods.push(draft.odds[c]); if (rg) ods.push(rg[1]); });
    var stakeIn = el("input", { class: "sg-input sg-stake", type: "number", min: "100", step: "100", value: String(sl.stake), disabled: !open, onchange: function (e) { sl.stake = Math.max(100, Math.floor((Number(e.target.value) || 100) / 100) * 100); rerenderKeep(); } });
    var total = ui.tickets.reduce(function (a, x) { return a + x.cost; }, 0);
    var canAdd = open && draft.combos.length > 0 && total + draft.cost <= wallet();
    var hint = bt.pick === 1 ? t("sg_hint_single") : sl.method === "normal" ? t(bt.ordered ? "sg_hint_normal_ordered" : "sg_hint_normal", { n: bt.pick }) : sl.method === "box" ? t("sg_hint_box", { n: bt.pick }) : t(bt.ordered ? "sg_hint_key_ordered" : "sg_hint_key");
    var list = el("div", { class: "sg-tickets" }, ui.tickets.map(function (tk, n) {
      return el("div", { class: "sg-ticket" }, [
        el("b", null, [L(Bet.TYPE[tk.type].name)]), " " + (tk.method !== "normal" ? t("sg_method_" + tk.method) + " " : ""),
        el("span", { class: "sg-combos" }, [tk.combos.slice(0, 8).map(function (c) { return Bet.comboLabel(tk.type, c) + "(" + oddsText(od, tk.type, c, tk.odds[c]) + ")"; }).join(" ") + (tk.combos.length > 8 ? " …" : "")]),
        " " + t("sg_ticket_cost", { n: tk.combos.length, s: money(tk.stake), c: money(tk.cost) }),
        open ? btn("×", function () { ui.tickets.splice(n, 1); pushBets(); rerenderKeep(); }, "sg-x") : null
      ]);
    }));
    return panel(t("sg_bet_title"), [
      poolMode(card) ? el("p", { class: "sg-small sg-pool-note" }, [t("sg_pool_note")]) : null,
      typeSeg, el("p", { class: "sg-small sg-muted" }, [t("sg_bet_desc_" + sl.type)]),
      methodSeg, el("p", { class: "sg-small" }, [hint]),
      pickRow,
      el("div", { class: "sg-row sg-slip" }, [
        el("label", null, [t("sg_stake_per"), stakeIn]),
        el("span", null, [t("sg_draft", { n: draft.combos.length, c: money(draft.cost) }) + (ods.length ? "・" + t("sg_odds_range", { a: Math.min.apply(null, ods).toFixed(1), b: Math.max.apply(null, ods).toFixed(1) }) : "")]),
        btn(t("sg_add_ticket"), function () { ui.tickets.push(draft); sl.picks = []; sl.key = null; pushBets(); rerenderKeep(); }, "sg-btn sg-primary", { disabled: !canAdd })
      ]),
      ui.tickets.length ? list : el("p", { class: "sg-muted sg-small" }, [t("sg_no_tickets")]),
      el("p", null, [t(ui.room ? "sg_total_bet_chips" : "sg_total_bet", { c: money(total), left: money(wallet() - total) })])
    ]);
  }

  function cardActions() {
    if (!ui.room) {
      return el("div", { class: "sg-actions sg-next" }, [
        btn(t("sg_reroll"), function () { if (ui.card && ui.card.stakes) startStakes(); else startSolo(ui.practice, ui.entryDog); }, "sg-btn"),
        btn(ui.tickets.length || ui.practice ? t("sg_go") : t("sg_go_nobet"), function () { startRace(); }, "sg-btn sg-primary sg-big")
      ]);
    }
    var room = ui.room, ready = room.me.ready, host = room.isHost();
    var list = room.list();
    var box = el("div", { class: "sg-panel" }, [
      el("h2", null, [t("sg_net_players")]),
      el("ul", { class: "sg-plist" }, list.map(function (p) {
        return el("li", null, [(p.cid === room.meta.host ? "👑 " : "") + (p.name || t("sg_net_noname")) + (p.cid === room.cid ? t("sg_net_you") : ""), " ", el("span", { class: p.ready ? "sg-good" : "sg-muted" }, [p.ready ? t("sg_ready") : t("sg_not_ready")])]);
      })),
      el("div", { class: "sg-actions" }, [
        btn(ready ? t("sg_unready") : t("sg_ready_btn"), function () { room.setReady(!ready); }, ready ? "sg-btn" : "sg-btn sg-primary"),
        host ? btn(t("sg_net_start"), function () { room.start(); }, "sg-btn sg-primary sg-big", { disabled: !list.every(function (p) { return p.ready || p.cid === room.cid; }) && !ui.forceStart }) : el("span", { class: "sg-muted" }, [t("sg_net_wait_host")]),
        host && !list.every(function (p) { return p.ready; }) ? btn(t("sg_net_force"), function () { ui.forceStart = true; room.start(); }, "sg-link") : null
      ])
    ]);
    return box;
  }

  // ---------------- 比賽 ----------------
  function startRace() {
    if (!ui.card) return;
    ui.cmds = [];
    ui.result = Core.simulate(ui.card, true);
    // 單機：開跑時扣下注金額
    if (!ui.room && ui.tickets.length) {
      var cost = ui.tickets.reduce(function (a, x) { return a + x.cost; }, 0);
      if (!K.spend(cost)) { ui.tickets = []; }
    }
    ui.raceT = -3; ui.speed = 1; ui.replay = false; ui.settledSolo = false;
    go("race");
  }
  var EV_ICONS = { queue: "🔀", knock: "💥", catchGood: "🥏", catchLate: "🥏", catchMiss: "❌", eat: "🍖", stayBreak: "🙃", stayGood: "✋", weaveMiss: "〰", lead: "🚩", finish: "🏁", jumpGood: "✨", start: "🔫", diveGood: "🌊", bridgeStop: "😰",
    clip: "🦵", fireBalk: "🔥", ringMiss: "💥", loopFail: "➰", climbSlip: "🧗", kickGood: "🧱", kickFall: "🤕", seesawFly: "⚖",
    plankFall: "🤕", trip: "⭕", ballPlay: "🔴", sprayStop: "💦", bounceGood: "🤸", bounceFlop: "🤕", paddleBonk: "✣", catStare: "🐈",
    ditchGood: "✨", ditchFall: "💦", surfWipe: "🌊", skateFall: "🛹", skiFall: "❄",
    skill: "✨", bump: "💥", boxed: "🚧", slowStart: "🐢", goodBreak: "🚀", shout: "📣", shoutHeal: "📣",
    kakari: "💢", calm: "😌", duel: "⚔" };
  function eventText(card, e) {
    var name = e.d >= 0 ? (e.d + 1) + " " + card.dogs[e.d].name : "";
    var n = e.x;
    if (e.k === "skill") n = SK.BY_ID[e.x] ? SK.BY_ID[e.x].icon + L(SK.BY_ID[e.x].name) : e.x;
    else if (e.k === "bump" || e.k === "boxed" || e.k === "duel") n = e.x !== null && card.dogs[e.x] ? (e.x + 1) + " " + card.dogs[e.x].name : "";
    var key = e.k === "calm" && e.x ? "calmSkill" : e.k;
    return (EV_ICONS[e.k] || "") + " " + t("sg_ev_" + key, { name: name, n: n });
  }
  // ---- 比賽中的指令（真賽狗的喊聲；跑法在出賽前決定，開跑後不能改）----
  // 全部的指令：單機＝ui.cmds；連線＝自己的（本機為準）＋其他人寫進房間的
  function raceCmds() {
    if (!ui.room) return ui.cmds || [];
    var out = (ui.myCmds || []).slice(), m = ui.room.match;
    Object.keys((m && m.cmds) || {}).forEach(function (pid) {
      if (pid !== ui.room.pid) (m.cmds[pid] || []).slice(0, Net.CMD_MAX).forEach(function (c) { out.push(c); });
    });
    return out;
  }
  // 用目前的指令整場重新模擬；結果物件原地替換，畫面與 3D 播放都接著用同一個物件
  function resimulate() {
    var nr = Core.simulate(ui.card, true, undefined, raceCmds());
    Object.keys(nr).forEach(function (k) { ui.result[k] = nr[k]; });
    ui.cmdSig = JSON.stringify(raceCmds());
    ui.resVer = (ui.resVer || 0) + 1;
    if (ui.view && ui.view.refresh) ui.view.refresh();
  }
  // 生效時間比現在晚一點：單機 0.15 秒；連線 CMD_LEAD_S 秒（讓其他裝置在生效前收到）
  function cmdLead() { return ui.room ? Net.CMD_LEAD_S : 0.15; }
  function pushCmd(c) {
    if (ui.room) { ui.myCmds = (ui.myCmds || []).concat([c]); ui.room.pushCmds(ui.myCmds); }
    else ui.cmds = (ui.cmds || []).concat([c]);
    resimulate();
  }
  // 真賽狗：對自己的狗喊「賽狗」（麥克風偵測到時呼叫）
  function sendShout(idx, tt) {
    if (!isReal(ui.card) || !ui.result || idx < 0 || tt < 0) return false;
    var ss = myShoutState(ui.card, ui.result, idx, tt);
    if (!ss.can) return false;
    pushCmd({ k: Core.stepOf(Math.max(0, tt) + cmdLead()), d: idx, a: "shout" });
    return true;
  }
  function myShoutState(card, res, idx, tt) {
    var used = 0, last = -1e9, pend = false, hits = 0;
    (res.cmds || []).forEach(function (c) {
      if (c.d !== idx || c.a !== "shout") return;
      used++; last = Math.max(last, c.k);
      if (c.k * Core.DT > tt + 1e-6) pend = true; else if (c.ok) hits++;
    });
    var fin = res.times[idx] !== null && res.times[idx] <= tt;
    var gapOk = (Core.stepOf(Math.max(0, tt) + cmdLead()) - last) >= Real.SHOUT_GAP;
    return { left: Real.SHOUT_MAX - used, hits: hits, pend: pend, can: tt >= 0 && !fin && used < Real.SHOUT_MAX && gapOk && !pend };
  }
  function screenRace() {
    var card = ui.card, res = ui.result;
    var stage = el("div", { class: "sg-stage" });
    var hud = el("div", { class: "sg-hud" });
    var rankBox = el("ol", { class: "sg-rank" });
    var info = el("div", { class: "sg-hud-info" });
    var ticker = el("div", { class: "sg-ticker" });
    var count = el("div", { class: "sg-count" });
    var shot = el("div", { class: "sg-shot" });
    var mm = el("canvas", { class: "sg-hud-map", width: 180, height: 120 });
    var bannerBox = el("div", { class: "sg-skill-banners" });
    var photoBox = el("div", { class: "sg-photo", style: "display:none" });
    hud.appendChild(photoBox);
    hud.appendChild(info); hud.appendChild(bannerBox); hud.appendChild(rankBox); hud.appendChild(ticker); hud.appendChild(count); hud.appendChild(shot); hud.appendChild(mm);
    stage.appendChild(hud);
    var camBar = el("div", { class: "sg-cams" });
    var spdBar = el("div", { class: "sg-cams" });
    var styleBox = el("div", { class: "sg-race-style" });
    app.appendChild(el("div", { class: "sg-race" }, [stage, styleBox, camBar, spdBar]));

    var camMode = pref().cam || "tv", camDog = 0;
    // 自己的狗（真賽狗可以有好幾隻）：指示列一次控制一隻，可切換
    var mine = [];
    card.dogs.forEach(function (d, i) { if (isMine(d)) mine.push(i); });
    if (mine.indexOf(ui.ctlDog) < 0) ui.ctlDog = mine.length ? mine[0] : -1;
    if (ui.ctlDog >= 0) camDog = ui.ctlDog;
    // 真賽狗：自己的狗的體力＋麥克風喊「賽狗」（重播時不能用；關卡賽沒有比賽中的操作）
    var real = isReal(card), curTT = -3, styleKey = "", staFill = null, heardBox = null, heardV = -1, styleOn = real && mine.length > 0 && !ui.replay;
    if (!styleOn) styleBox.style.display = "none";
    function toggleMic() {
      if (ui.mic) { ui.mic.stop(); ui.mic = null; ui.micState = ""; ui.micHeard = null; styleKey = ""; return; }
      ui.micState = "starting"; ui.micHeard = null;
      ui.mic = Mic.start(function () {
        var ok = sendShout(ui.ctlDog, curTT);
        ui.micFlash = { t: performance.now(), ok: ok };
        styleKey = "";
      }, function (stt, why) { ui.micState = stt === "error" ? "error:" + why : "listening"; if (stt === "error") ui.mic = null; styleKey = ""; }, window.I18N.getLang(), function (txt, hit, fin) {
        // 系統讀到的文字（2026-11-04 使用者指定）：暫定結果即時更新，最後確定的保留最近 3 段
        var h = ui.micHeard || (ui.micHeard = { cur: "", hit: false, log: [] });
        h.cur = txt; h.hit = hit;
        if (fin) { if (txt) h.log.unshift({ txt: txt, hit: hit }); if (h.log.length > 3) h.log.length = 3; h.cur = ""; }
        h.v = (h.v || 0) + 1;
      });
      styleKey = "";
    }
    function updateStyleBox(tt, st) {
      if (!styleOn) return;
      var idx = ui.ctlDog, md = card.dogs[idx], sh = myShoutState(card, res, idx, tt);
      var flash = ui.micFlash && performance.now() - ui.micFlash.t < 1500 ? ui.micFlash : null;
      var key = [idx, sh.left, sh.hits, sh.pend, sh.can, ui.micState, flash ? flash.ok : ""].join("|");
      if (key !== styleKey) {
        styleKey = key;
        styleBox.innerHTML = "";
        staFill = el("i");
        if (mine.length > 1) {
          styleBox.appendChild(el("div", { class: "sg-seg sg-ctl-tabs" }, mine.map(function (i) {
            return el("button", { type: "button", class: "sg-seg-btn" + (i === idx ? " sg-on" : ""), onclick: function () { ui.ctlDog = i; camDog = i; styleKey = ""; } }, [gateBadge(i), " " + card.dogs[i].name]);
          })));
        }
        styleBox.appendChild(el("div", { class: "sg-race-style-head" }, [
          gateBadge(idx), el("b", null, [" " + t("sg_race_cheer_title", { name: md.name })]),
          el("span", { class: "sg-race-sta" }, [t("sg_race_sta") + " ", el("span", { class: "sg-bar sg-bar-b" }, [staFill])]),
          el("small", { class: "sg-muted" }, [styleLabel(md) + "（" + t("sg_style_fixed") + "）"])
        ]));
        if (real) {
          var on = !!ui.mic, err = ui.micState.indexOf("error:") === 0;
          styleBox.appendChild(el("div", { class: "sg-mic" + (on ? " sg-mic-on" : "") }, [
            Mic && Mic.supported() ? btn(on ? "🎤 " + t("sg_mic_off") : "🎤 " + t("sg_mic_on"), toggleMic, "sg-btn" + (on ? " sg-primary" : ""), { id: "sg-mic-btn" }) : el("span", { class: "sg-muted" }, [t("sg_mic_unsupported")]),
            el("span", { class: "sg-small" }, [t("sg_shout_left", { n: sh.left, h: sh.hits })]),
            flash ? el("b", { class: flash.ok ? "sg-good" : "sg-muted" }, [flash.ok ? t("sg_shout_sent") : t("sg_shout_wait")]) : sh.pend ? el("b", { class: "sg-good" }, [t("sg_shout_sent")]) : null,
            err ? el("span", { class: "sg-danger sg-small" }, [t("sg_mic_error")]) : on ? el("span", { class: "sg-small sg-muted" }, [t(ui.mic.method === "speech" ? "sg_mic_speech" : "sg_mic_volume")]) : null
          ]));
          heardBox = on && ui.mic.method === "speech" ? el("div", { class: "sg-mic-heard", id: "sg-mic-heard" }) : null;
          heardV = -1;
          if (heardBox) styleBox.appendChild(heardBox);
          styleBox.appendChild(el("p", { class: "sg-small sg-muted" }, [t("sg_shout_note", { p: Math.round(Real.SHOUT_P * 100), h: Math.round(Real.SHOUT_HEAL * 100), n: Real.SHOUT_MAX })]));
        }
      }
      // 語音辨識讀到的文字：只改這一塊，不整個重畫
      var hd = ui.micHeard;
      if (heardBox && (hd ? hd.v : 0) !== heardV) {
        heardV = hd ? hd.v : 0;
        heardBox.innerHTML = "";
        heardBox.appendChild(el("span", { class: "sg-small sg-muted" }, [t("sg_mic_heard") + "："]));
        if (!hd || (!hd.cur && !hd.log.length)) heardBox.appendChild(el("span", { class: "sg-small sg-muted" }, [t("sg_mic_heard_none")]));
        if (hd && hd.cur) heardBox.appendChild(el("span", { class: "sg-heard sg-heard-cur" + (hd.hit ? " sg-heard-hit" : "") }, [(hd.hit ? "✔ " : "") + "「" + hd.cur + "…」"]));
        if (hd) hd.log.forEach(function (x) { heardBox.appendChild(el("span", { class: "sg-heard" + (x.hit ? " sg-heard-hit" : " sg-heard-miss") }, [(x.hit ? "✔ " : "✘ ") + "「" + x.txt + "」"])); });
      }
      if (staFill && st[idx]) staFill.style.width = Math.round(Core.clamp(st[idx].sta, 0, 1) * 100) + "%";
    }
    function camButtons() {
      camBar.innerHTML = "";
      [["tv", t("sg_cam_tv")], ["aerial", t("sg_cam_aerial")]].forEach(function (c) {
        camBar.appendChild(btn(c[1], function () { camMode = c[0]; setPref({ cam: camMode }); if (ui.view) ui.view.setCam(camMode, camDog); camButtons(); }, "sg-seg-btn" + (camMode === c[0] ? " sg-on" : "")));
      });
      ["chase", "pov"].forEach(function (m) {
        camBar.appendChild(el("span", { class: "sg-cam-label" }, [t("sg_cam_" + m)]));
        card.dogs.forEach(function (d, i) {
          camBar.appendChild(el("button", { type: "button", class: "sg-cam-dog" + (camMode === m && camDog === i ? " sg-on" : ""), style: "background:" + D.GATE_COLORS[i] + ";color:" + D.GATE_TEXT[i], title: d.name, onclick: function () { camMode = m; camDog = i; setPref({ cam: m }); if (ui.view) ui.view.setCam(m, i); camButtons(); } }, [String(i + 1)]));
        });
      });
    }
    camButtons();
    if (!ui.room || ui.replay) {
      [1, 2, 4].forEach(function (s) {
        spdBar.appendChild(btn("×" + s, function () { ui.speed = s; Array.prototype.forEach.call(spdBar.children, function (b, n) { b.classList.toggle("sg-on", n === [1, 2, 4].indexOf(s)); }); }, "sg-seg-btn" + (ui.speed === s ? " sg-on" : "")));
      });
      spdBar.appendChild(btn(t("sg_skip"), function () { finishRace(); }, "sg-link"));
    } else {
      spdBar.appendChild(el("span", { class: "sg-muted sg-small" }, [t("sg_net_sync_note")]));
    }

    var fallback = null;
    function start3d() {
      if (!V3 || !V3.available() || pref().no3d) { fallback = el("canvas", { class: "sg-fallback", width: 800, height: 450 }); stage.insertBefore(fallback, hud); return; }
      stage.classList.add("sg-loading");
      V3.load().then(function () {
        if (ui.screen !== "race" || !stage.isConnected) return;
        stage.classList.remove("sg-loading");
        ui.view = (isOval(card) ? window.PriTestSaigoReal3D : V3).create(stage, card, res, { quality: pref().quality || "high" });
        var cv = stage.querySelector(".sg-canvas");
        if (cv) stage.insertBefore(cv, hud);
        ui.view.setCam(camMode, camDog);
      }).catch(function () { stage.classList.remove("sg-loading"); fallback = el("canvas", { class: "sg-fallback", width: 800, height: 450 }); stage.insertBefore(fallback, hud); });
    }
    start3d();

    var last = performance.now(), lastEv = -1, ended = false, tickLines = [], resVer = ui.resVer;
    // 左上的技能廣播：發動後顯示約 2.6 秒（比賽時間），最多 3 條
    var banners = [], bannerSig = "";
    function drawBanners(tt) {
      banners = banners.filter(function (b) { return tt < b.until && tt >= b.e.t - 0.05; }).slice(0, 3);
      var sig = banners.map(function (b) { return b.e.t + ":" + b.e.d + ":" + b.e.x; }).join("|");
      if (sig === bannerSig) return;
      bannerSig = sig;
      bannerBox.innerHTML = "";
      banners.forEach(function (b) {
        var sk = SK.BY_ID[b.e.x], d = card.dogs[b.e.d];
        if (b.e.k === "kakari" && d) {
          bannerBox.appendChild(el("div", { class: "sg-skill-banner sg-banner-kakari" + (isMine(d) ? " sg-banner-mine" : "") }, [
            el("small", null, [t("sg_banner_kakari")]), el("div", null, [gateBadge(b.e.d), " " + d.name + " ", el("b", null, ["💢 " + t("sg_banner_kakari_line")])])
          ]));
          return;
        }
        if (b.e.k === "duel" && d && card.dogs[b.e.x]) {
          bannerBox.appendChild(el("div", { class: "sg-skill-banner sg-banner-duel" + (isMine(d) || isMine(card.dogs[b.e.x]) ? " sg-banner-mine" : "") }, [
            el("small", null, [t("sg_banner_duel")]), el("div", null, [gateBadge(b.e.d), " " + d.name + " ", el("b", null, ["⚔"]), " ", gateBadge(b.e.x), " " + card.dogs[b.e.x].name])
          ]));
          return;
        }
        if (!sk || !d) return;
        bannerBox.appendChild(el("div", { class: "sg-skill-banner sg-banner-" + sk.tier + (isMine(d) ? " sg-banner-mine" : "") }, [
          el("small", null, [t("sg_skill_fired") + "・" + L(SK.TIERS[sk.tier].name)]),
          el("div", null, [gateBadge(b.e.d), " " + d.name + " ", el("b", null, ["「" + sk.icon + " " + L(sk.name) + "」"])])
        ]));
      });
    }
    // 照片判定（第 1、2 名差不到 Core.PHOTO_GAP 秒）：終點前後慢動作，第二隻到後等 PHOTO_WAIT 秒才公布
    var PHOTO_SLOW = 0.25, PHOTO_WAIT = 2.2, PHOTO_SHOW = 2.8;
    function photoInfo() {
      var p = res.photo;
      if (!p) return null;
      var t1 = res.times[p.a], t2 = res.times[p.b];
      return { a: p.a, b: p.b, gap: p.gap, t1: t1, t2: t2, reveal: t2 + PHOTO_WAIT };
    }
    function photoSlow(tt) { var p = photoInfo(); return !!p && tt >= p.t1 - 1.0 && tt < p.t2 + 0.3; }
    function liveEvents() { return (res.events || []).filter(function (e) { return e.k !== "enter" && e.k !== "start" && e.k !== "stayGood" && e.k !== "go"; }); }
    var evs = liveEvents();
    function loop(now) {
      if (ui.screen !== "race") return;
      var dt = Math.min(0.1, (now - last) / 1000); last = now;
      var tt;
      if (ui.room && !ui.replay) { tt = ui.room.raceTime(); if (tt === null) tt = -3; }
      else { ui.raceT += dt * (ui.raceT < 0 ? 1 : ui.speed * (photoSlow(ui.raceT) ? PHOTO_SLOW : 1)); tt = ui.raceT; }
      curTT = tt;
      var ph = photoInfo(), pend = ph && tt >= ph.t1 && tt < ph.reveal;
      // 改跑法後重新模擬過：實況從目前時間接著播（生效前的事件都一樣）
      if (resVer !== ui.resVer) {
        resVer = ui.resVer; evs = liveEvents(); lastEv = -1;
        while (lastEv + 1 < evs.length && evs[lastEv + 1].t <= tt) lastEv++;
      }
      var out = null;
      if (ui.view) out = ui.view.frame(tt, dt * (ui.room && !ui.replay ? 1 : ui.speed));
      var rank = out ? out.rank : Core.rankAt(res, Math.max(0, tt));
      var st = Core.stateAt(res, Math.max(0, tt));
      var pos = st.map(function (x, i) { return mapPos(card, x, i); });
      if (fallback) drawFallback(fallback, card, res, tt, pos, rank);
      drawMinimap(mm, card, pos);
      updateStyleBox(tt, st);
      // HUD
      var lead = rank[0], ls = st[lead] ? st[lead].s : 0;
      var where;
      if (isOval(card)) where = t("sg_sect_" + Real.sectAt(Real.trackPos(card, Math.min(ls, card.length))));
      else { var part = Core.partAt(card.course, Math.min(ls, card.course.length - 0.01)); where = D.PARTS[part.type].icon + " " + D.partName(part); }
      info.textContent = (tt < 0 ? "" : fmtTime(Math.max(0, tt)) + "  ") + t("sg_hud_left", { n: Math.max(0, Math.round(cardLen(card) - ls)) }) + "  " + where;
      rankBox.innerHTML = "";
      // 照片判定中：那兩隻先依枠順排、不顯示差距
      if (pend) {
        var pa = Math.min(ph.a, ph.b), pb = Math.max(ph.a, ph.b), ia = rank.indexOf(ph.a), ib = rank.indexOf(ph.b);
        if (ia >= 0 && ib >= 0) { var lo = Math.min(ia, ib); rank = rank.slice(); rank[lo] = pa; rank[lo + 1] = pb; }
      }
      rank.forEach(function (i, n) {
        var gap = n === 0 ? "" : (res.times[i] !== null && res.times[i] <= tt ? "+" + (res.times[i] - res.times[rank[0]]).toFixed(2) + "s" : "-" + Math.max(0, (ls - st[i].s)).toFixed(1) + "m");
        if (pend && (i === ph.a || i === ph.b)) gap = "📷";
        rankBox.appendChild(el("li", { class: isMine(card.dogs[i]) ? "sg-mine" : "" }, [gateBadge(i), " " + card.dogs[i].name + " ", el("small", null, [gap])]));
      });
      count.textContent = tt < 0 ? String(Math.ceil(-tt)) : (tt < 1 ? "GO!" : "");
      count.style.display = tt < 1 ? "" : "none";
      shot.textContent = out && out.shot ? "LIVE ・ " + t("sg_shot_" + out.shot) : "";
      // 實況
      while (lastEv + 1 < evs.length && evs[lastEv + 1].t <= tt) {
        lastEv++;
        var bk = evs[lastEv].k;
        if ((bk === "skill" || bk === "kakari" || bk === "duel") && tt - evs[lastEv].t < 2.6) banners.unshift({ e: evs[lastEv], until: evs[lastEv].t + (bk === "duel" ? 3.2 : 2.6) });
        var line = ph && evs[lastEv].k === "finish" && (evs[lastEv].d === ph.a || evs[lastEv].d === ph.b) ? "" : eventText(card, evs[lastEv]);
        if (line) { tickLines.unshift(line); if (tickLines.length > 4) tickLines.length = 4; }
      }
      if (tt < 0.1 && tickLines.length && lastEv < 0) tickLines = [];
      drawBanners(tt);
      ticker.innerHTML = "";
      tickLines.forEach(function (s2, n) { ticker.appendChild(el("div", { style: "opacity:" + (1 - n * 0.22) }, [s2])); });
      // 照片判定：第二隻到終點後顯示「判定中」，PHOTO_WAIT 秒後公布
      if (ph && tt >= ph.t2) {
        var revealed = tt >= ph.reveal, key2 = revealed ? "r" : "w";
        if (photoBox.getAttribute("data-k") !== key2) {
          photoBox.setAttribute("data-k", key2);
          photoBox.innerHTML = "";
          photoBox.className = "sg-photo" + (revealed ? " sg-photo-done" : "");
          if (!revealed) photoBox.appendChild(el("div", null, ["📷 " + t("sg_photo_wait")]));
          else {
            photoBox.appendChild(el("small", null, [t("sg_photo_result")]));
            photoBox.appendChild(el("div", null, [gateBadge(ph.a), " " + card.dogs[ph.a].name + " ", el("b", null, [t("sg_margin_" + (Core.marginKind(ph.gap) || "nose"))])]));
            tickLines.unshift("📷 " + t("sg_photo_line", { name: (ph.a + 1) + " " + card.dogs[ph.a].name, m: t("sg_margin_" + (Core.marginKind(ph.gap) || "nose")) }));
            if (tickLines.length > 4) tickLines.length = 4;
          }
        }
        photoBox.style.display = tt < ph.reveal + PHOTO_SHOW ? "" : "none";
      } else if (photoBox.style.display !== "none") photoBox.style.display = "none";
      var endAt = ph ? Math.max(res.duration + 3, ph.reveal + PHOTO_SHOW) : res.duration + 3;
      if (!ended && tt > endAt) { ended = true; finishRace(); return; }
      ui.raf = requestAnimationFrame(loop);
    }
    ui.raf = requestAnimationFrame(loop);
  }
  // WebGL 不能用時：俯視地圖＋進度條
  function drawFallback(c, card, res, tt, pos, rank) {
    drawMinimap(c, card, pos);
    var g = c.getContext("2d");
    g.font = "bold 14px sans-serif";
    rank.forEach(function (i, n) {
      var st = Core.stateAt(res, Math.max(0, tt))[i];
      var w;
      // 進度條放在左側、資訊列下方（右上是名次表）
      var y0 = 70 + n * 18, bw = c.width * 0.45;
      w = bw * Core.clamp(st.s / cardLen(card), 0, 1);
      g.fillStyle = "rgba(0,0,0,0.08)"; g.fillRect(110, y0, bw, 14);
      g.fillStyle = D.GATE_COLORS[i]; g.fillRect(110, y0, w, 14);
      g.fillStyle = "#333"; g.fillText((i + 1) + " " + card.dogs[i].name, 8, y0 + 12);
    });
  }

  function finishRace() {
    var res = ui.result;
    if (!res) return;
    if (!ui.replay) settle();
    go("result");
  }
  // 結算（每場只一次）：下注派彩、自己的狗的獎金／經驗、紀錄
  function settle() {
    var key = ui.room ? "n" + ui.netNo : "solo" + ui.card.seed;
    if (ui.settled[key]) return;
    ui.settled[key] = true;
    var card = ui.card, res = ui.result, order = res.order;
    // 彩池制：票上記的是買的當下的預估賠率，換成開跑時鎖定的最終賠率
    ui.finalOdds = poolMode(card) ? curOdds(card, order) : null;
    if (ui.finalOdds) ui.tickets.forEach(function (tk) { tk.combos.forEach(function (c) { tk.odds[c] = ui.finalOdds[tk.type][c] || tk.odds[c]; }); });
    var sum = Bet.settle(ui.tickets, order);
    if (sum.won && !ui.room) K.receive(sum.won);
    ui.lastSettle = sum;
    var cls = D.CLASSES.filter(function (c) { return c.id === card.cls; })[0];
    ui.dogRewards = [];
    var prizes = 0;
    card.dogs.forEach(function (d, i) {
      if (!isMine(d) || !d.dogId) return;
      // 連線房間：狗的獎金進房間籌碼，經驗／疲勞照樣記在自己的犬舍
      var r = K.afterRace(d.dogId, order.indexOf(i), card.prizeMult || cls.prize, ui.practice, !!ui.room);
      if (r) { ui.dogRewards.push({ name: d.name, dogId: d.dogId, place: order.indexOf(i), r: r }); prizes += r.prize; }
    });
    if (ui.room && sum.won + prizes > 0) ui.room.addCoins(ui.room.pid, sum.won + prizes);
    // 粉絲數、宿敵、重賞稱號（2026-11-05）
    ui.leagueOut = League ? League.afterRace(card, order, ui.dogRewards.map(function (x) { return { dogId: x.dogId, place: x.place }; }), ui.practice) : null;
    // 累積彩金：單機在這裡結算；連線由房主結算（全房間的下注都在 m/<no>/bets）
    ui.jpWin = null;
    if (!ui.practice && !ui.room) {
      var st = Bet.jackpotStep(K.jackpot(), sum.spent, { me: Bet.trifectaStake(ui.tickets, order) });
      K.setJackpot(st.amt);
      if (st.pays.me) K.receive(st.pays.me);
      ui.jpWin = { pot: st.pot, pay: st.pays.me || 0, next: st.amt };
    }
    if (ui.room && ui.room.isHost()) ui.room.settleJackpot(ui.netNo, order);
    // WIN5／冠軍大會：房主記下這場的結果（只寫一次，transaction 防重複）
    if (ui.room && ui.room.isHost() && card.w5) ui.room.w5Result(card.w5.ser, card.w5.leg, order[0]);
    if (ui.room && ui.room.isHost() && card.cup) ui.room.cupAdvance(card, order);
    if (!ui.practice && Press) Press.record(card, order);
    if (!ui.practice) K.record({ at: Date.now(), title: raceTitle(card), winner: (order[0] + 1) + " " + card.dogs[order[0]].name, spent: sum.spent, won: sum.won });
  }

  // 著差（和前一名比）：鼻差／頭差／頸差／半身
  function marginText(tm, prev) {
    if (tm === null || prev === null || prev === undefined) return "";
    var k = Core.marginKind(tm - prev);
    return k ? "（" + t("sg_margin_" + k) + "）" : "";
  }
  function screenResult() {
    var card = ui.card, res = ui.result, order = res.order, sum = ui.lastSettle || { rows: [], spent: 0, won: 0 };
    var winT = res.times[order[0]];
    app.appendChild(panel(t("sg_result_title") + "・" + raceTitle(card), [
      res.photo ? el("p", { class: "sg-big-line" }, ["📷 " + t("sg_photo_line", { name: (res.photo.a + 1) + " " + card.dogs[res.photo.a].name, m: t("sg_margin_" + (Core.marginKind(res.photo.gap) || "nose")) })]) : null,
      el("table", { class: "sg-table" }, [
        el("thead", null, [el("tr", null, [t("sg_col_rank"), "", t("sg_col_dog"), t("sg_col_time"), t("sg_col_margin"), t("sg_col_odds")].map(function (h) { return el("th", null, [h]); }))]),
        el("tbody", null, order.map(function (i, n) {
          var d = card.dogs[i], tm = res.times[i];
          return el("tr", { class: isMine(d) ? "sg-mine" : "" }, [
            el("td", null, [n + 1 + ""]), el("td", null, [gateBadge(i)]),
            el("td", null, [el("b", null, [d.name]), " ", el("small", null, [L(breedOf(d).name)])]),
            el("td", null, [tm === null ? t("sg_dnf") : fmtTime(tm)]),
            el("td", null, [n === 0 || tm === null ? "" : "+" + (tm - winT).toFixed(2) + marginText(tm, res.times[order[n - 1]])]),
            el("td", null, [(ui.finalOdds || Core.odds(card)).win[i].toFixed(1)])
          ]);
        }))
      ])
    ]));
    if (!ui.practice) {
      var pt = Bet.payoutTable(card, order, ui.finalOdds);
      app.appendChild(panel(t("sg_payouts"), [el("table", { class: "sg-table sg-pay" }, [el("tbody", null, pt.map(function (row) {
        return el("tr", null, [el("th", null, [L(Bet.TYPE[row.type].name)]), el("td", null, row.list.map(function (x) { return el("div", null, [Bet.comboLabel(row.type, x.combo) + "　" + money(x.pay)]); }))]);
      }))]), el("p", { class: "sg-small sg-muted" }, [t(ui.finalOdds ? "sg_pay_note_pool" : "sg_pay_note")])]));
      app.appendChild(panel(t("sg_my_tickets"), [
        sum.rows.length ? el("div", { class: "sg-tickets" }, sum.rows.map(function (r) {
          return el("div", { class: "sg-ticket " + (r.pay ? "sg-hit" : "") }, [
            el("b", null, [L(Bet.TYPE[r.tk.type].name)]), " " + (r.tk.method !== "normal" ? t("sg_method_" + r.tk.method) + " " : ""),
            el("span", { class: "sg-combos" }, [r.tk.combos.slice(0, 8).map(function (c) { return Bet.comboLabel(r.tk.type, c); }).join(" ") + (r.tk.combos.length > 8 ? " …" : "")]),
            " " + money(r.tk.cost) + " → ", el("b", { class: r.pay ? "sg-good" : "sg-muted" }, [r.pay ? t("sg_hit", { n: money(r.pay) }) : t("sg_miss")])
          ]);
        })) : el("p", { class: "sg-muted" }, [t("sg_no_tickets_result")]),
        el("p", { class: "sg-big-line" }, [t("sg_balance", { s: money(sum.spent), w: money(sum.won), n: (sum.won - sum.spent >= 0 ? "+" : "") + money(sum.won - sum.spent) })])
      ]));
    }
    if (!ui.practice) app.appendChild(jackpotPanel());
    if (ui.room && card.w5 && Cup) app.appendChild(w5Panel(card, order));
    if (ui.room && card.cup && Cup && ui.room.cup) app.appendChild(cupPanel(ui.room.cup.id === card.cup.id ? ui.room.cup : null, null));
    if (ui.dogRewards && ui.dogRewards.length) {
      app.appendChild(panel(t("sg_dog_rewards"), ui.dogRewards.map(function (x) {
        return el("p", null, [t("sg_dog_reward_line", { name: x.name, p: x.place + 1, prize: money(x.r.prize), exp: x.r.exp }) + (x.r.lvUp ? " " + t("sg_msg_lvup") : "")]);
      })));
    }
    var lo = ui.leagueOut;
    if (lo && (lo.title || lo.rivals.length || lo.fans.length)) {
      var lines = [];
      if (lo.title) lines.push(el("p", { class: "sg-big-line sg-good" }, ["🏆 " + t("sg_title_won", { name: lo.title.name, g: lo.title.stake.grade, s: L(lo.title.stake.name) })]));
      lo.rivals.forEach(function (x) {
        var d = card.dogs[x.gate];
        lines.push(el("p", { class: x.beat ? "sg-good" : "" }, ["🔥 " + t(x.beat ? "sg_rival_beat" : "sg_rival_lost", { name: d.name, k: d.ownerName })]));
      });
      lo.fans.forEach(function (x) { lines.push(el("p", null, ["👥 " + t("sg_fans_gain", { name: x.name, n: x.gain.toLocaleString(), total: x.total.toLocaleString() })])); });
      app.appendChild(panel("🏆 " + t("sg_league_result"), lines));
    }
    var acts = [btn(t("sg_replay"), function () { ui.replay = true; ui.raceT = -1; ui.speed = 1; go("race"); }, "sg-btn")];
    if (ui.room) {
      if (ui.room.isHost()) {
        acts.push(btn(t("sg_net_next"), function () { publishCard(); }, "sg-btn sg-primary"));
        acts.push(btn(t("sg_net_lobby"), function () { ui.room.backToLobby(); }, "sg-btn"));
      } else acts.push(el("span", { class: "sg-muted" }, [t("sg_net_wait_next")]));
    } else {
      if (card.stakes) acts.push(btn("🏆 " + t("sg_stakes_back"), function () { go("setup"); }, "sg-btn sg-primary"));
      else acts.push(btn(ui.practice ? t("sg_back_kennel") : t("sg_next_race"), function () { if (ui.practice) go("kennel"); else startSolo(false, ui.entryDog); }, "sg-btn sg-primary"));
    }
    app.appendChild(el("div", { class: "sg-actions sg-next" }, acts));
  }

  function jackpotPanel() {
    var lines = [];
    if (!ui.room) {
      var j = ui.jpWin;
      if (j) lines.push(el("p", { class: j.pay ? "sg-big-line sg-good" : "" }, [j.pay ? t("sg_jp_win_solo", { n: money(j.pay) }) : t("sg_jp_none", { n: money(j.next) })]));
    } else {
      var jp = ui.room.jp, last = jp && jp.last && jp.last.no === ui.netNo ? jp.last : null;
      if (!last) lines.push(el("p", { class: "sg-muted" }, [t("sg_jp_wait")]));
      else if (last.win && last.win.length) {
        lines.push(el("p", { class: "sg-big-line sg-good" }, [t("sg_jp_hit_room", { n: money(last.pot) })]));
        last.win.forEach(function (w) { lines.push(el("p", null, ["🎉 " + (w.name || t("sg_net_noname")) + "：" + money(w.pay)])); });
      } else lines.push(el("p", null, [t("sg_jp_none", { n: money(jp.amt) })]));
    }
    lines.push(el("p", { class: "sg-small sg-muted" }, [t("sg_jp_rule", { seed: money(Bet.JP_SEED), per: money(Bet.JP_PER_RACE), rate: Math.round(Bet.JP_RATE * 100) })]));
    return panel("💰 " + t("sg_jp_title"), lines);
  }

  // ---------------- WIN5（連線，2026-11-05）----------------
  function w5Panel(card, order) {
    var room = ui.room, w = card.w5, mine = room.w5Mine(w.ser), res = (room.w5 && room.w5.ser === w.ser && room.w5.res) || {};
    var alive = mine && Cup.w5Alive(mine.picks, res, w.leg), lines = [];
    lines.push(el("p", { class: "sg-big-line" }, [t("sg_w5_pot", { n: money(room.w5Pot(w.ser)), k: Object.keys(room.w5Buyers(w.ser)).length })]));
    // 前幾場的結果
    if (mine && w.leg > 1) {
      var hist = [];
      for (var lg = 1; lg < w.leg; lg++) {
        var ok = mine.picks && res[lg] !== undefined && res[lg] !== null && Number(mine.picks[lg]) === Number(res[lg]);
        hist.push(el("span", { class: "sg-w5-leg " + (ok ? "sg-good" : "sg-danger") }, [t("sg_w5_leg_n", { n: lg }) + (ok ? " ✔" : " ✘")]));
      }
      lines.push(el("p", null, hist));
    }
    if (order) {
      // 結果畫面：這一場中了沒
      if (mine) {
        var hitNow = mine.picks && Number(mine.picks[w.leg]) === order[0];
        var aliveNow = alive && hitNow;
        lines.push(el("p", { class: aliveNow ? "sg-good sg-big-line" : "sg-muted" }, [alive ? (hitNow ? (w.leg >= Cup.W5_LEGS ? t("sg_w5_all_hit") : t("sg_w5_hit")) : t("sg_w5_miss")) : t("sg_w5_out")]));
      }
      var last = room.w5 && room.w5.last;
      if (w.leg >= Cup.W5_LEGS) {
        if (!last || last.ser !== w.ser) lines.push(el("p", { class: "sg-muted" }, [t("sg_w5_wait")]));
        else if (last.win && last.win.length) {
          lines.push(el("p", { class: "sg-big-line sg-good" }, [t("sg_w5_won_room", { n: money(last.pot) })]));
          last.win.forEach(function (x) { lines.push(el("p", null, ["🎉 " + (x.name || t("sg_net_noname")) + "：" + money(x.pay)])); });
        } else lines.push(el("p", null, [t("sg_w5_none", { n: money(room.w5.carry || 0) })]));
      }
    } else if (!mine) {
      lines.push(w.leg === 1 ? el("div", { class: "sg-actions" }, [btn("🎯 " + t("sg_w5_buy", { n: money(Cup.W5_COST) }), function () {
        room.w5Buy(w.ser).then(function (ok) { ui.msg = ok ? "" : t("sg_msg_no_money"); rerenderKeep(); });
      }, "sg-btn sg-primary", { disabled: !canBet() || room.coins() < Cup.W5_COST })]) : el("p", { class: "sg-muted" }, [t("sg_w5_late")]));
    } else if (!alive) lines.push(el("p", { class: "sg-muted" }, [t("sg_w5_out")]));
    else {
      var pk = mine.picks ? mine.picks[w.leg] : undefined;
      lines.push(el("p", null, [t("sg_w5_pick", { n: w.leg })]));
      lines.push(el("div", { class: "sg-picks" }, card.dogs.map(function (d, i) {
        var on = pk !== undefined && Number(pk) === i;
        return el("button", { type: "button", class: "sg-pick" + (on ? " sg-on" : ""), disabled: !canBet(), onclick: function () { room.w5Pick(w.ser, w.leg, i).then(rerenderKeep); } }, [gateBadge(i), " " + d.name]);
      })));
      if (pk === undefined) lines.push(el("p", { class: "sg-small sg-danger" }, [t("sg_w5_need_pick")]));
    }
    lines.push(el("p", { class: "sg-small sg-muted" }, [t("sg_w5_rule", { n: money(Cup.W5_COST), r: Math.round(Cup.W5_TAKE * 100) })]));
    return panel("🎯 " + t("sg_w5_title", { s: w.ser, n: w.leg, m: Cup.W5_LEGS }), lines, "sg-w5");
  }

  // ---------------- 冠軍大會（連線，2026-11-05）----------------
  function cupNames(list) { return (list || []).map(function (e) { return e.name + (e.ownerName && !e.npc ? "（" + e.ownerName + "）" : ""); }).join("、") || "—"; }
  function cupPanel(cup, card) {
    var rows = [];
    if (!cup) return panel("🏆 " + t("sg_cup_title"), [el("p", { class: "sg-muted" }, [t("sg_cup_none")])]);
    var c = Cup.conf(cup.mode);
    rows.push(el("div", { class: "sg-cup-stages" }, ["h1", "h2", "rep", "final"].map(function (st) {
      var idx = Cup.STAGES.indexOf(st), cur = Cup.STAGES.indexOf(cup.stage);
      return el("span", { class: "sg-cup-stage" + (st === cup.stage ? " sg-on" : idx < cur ? " sg-done" : "") }, [t("sg_cup_stage_" + st)]);
    })));
    if (card) rows.push(el("p", { class: "sg-small" }, [t("sg_cup_adv_" + (card.cup.stage === "final" ? "final" : card.cup.stage === "rep" ? "rep" : "heat"), { q: c.q, r: c.rep, k: Cup.REP_Q, m: Cup.CUP_FINAL_PRIZE })]));
    if (cup.stage === "done" && cup.champ) {
      rows.push(el("p", { class: "sg-big-line sg-good" }, ["👑 " + t("sg_cup_champ", { name: cup.champ.name, o: cup.champ.npc ? "CPU" : cup.champ.ownerName || "" })]));
      rows.push(el("ol", null, (cup.podium || []).map(function (x) { return el("li", null, [x.name + (x.owner ? "（" + x.owner + "）" : "")]); })));
    } else {
      if ((cup.q1 || []).length || (cup.q2 || []).length) rows.push(el("p", { class: "sg-small" }, ["✅ " + t("sg_cup_qualified") + "：" + cupNames((cup.q1 || []).concat(cup.q2 || [], cup.qr || []))]));
      if (!card) {
        rows.push(el("p", { class: "sg-small" }, [t("sg_cup_stage_h1") + "：" + cupNames(cup.h1)]));
        rows.push(el("p", { class: "sg-small" }, [t("sg_cup_stage_h2") + "：" + cupNames(cup.h2)]));
      }
    }
    return panel("🏆 " + t("sg_cup_title"), rows, "sg-cup");
  }

  // ---------------- 連線 ----------------
  function roomUrl(id) { return location.href.split(/[?#]/)[0] + "?room=" + id; }
  function enterRoom(roomId) {
    if (!Net) return;
    if (ui.room) ui.room.leave();
    ui.room = Net.open({ roomId: roomId || null, name: lsGet(NAME_KEY), cfg: netCfg(), onChange: onRoomChange });
    ui.netNo = 0; ui.tickets = []; ui.card = null; ui.practice = false;
    try { history.replaceState(null, "", roomUrl(ui.room.id)); } catch (e) { /* file:// 等 */ }
    syncEntry();
    go("lobby");
  }
  function leaveRoom() {
    if (ui.room) ui.room.leave();
    ui.room = null;
    ui.map = pref().map || { terrain: "", weather: "", dist: "" };
    try { history.replaceState(null, "", location.href.split(/[?#]/)[0]); } catch (e) { /* 同上 */ }
    go("home");
  }
  // 關卡賽送一隻（entry）；真賽狗送勾選的好幾隻（entries，最多 ENTRY_MAX_NET 隻）
  function syncEntry() {
    if (!ui.room) return;
    var nm = lsGet(NAME_KEY), cid = ui.room.cid;
    var e = ui.entryDog ? K.entry(ui.entryDog, cid, nm) : null;
    var es = ui.entryDogs.slice(0, ENTRY_MAX_NET).map(function (id) { return K.entry(id, cid, nm); }).filter(Boolean);
    ui.room.update({ entry: e, entries: es, name: nm });
  }
  function netCfg() { return { mode: ui.mode, cls: ui.cls, terrain: ui.map.terrain || "", weather: ui.map.weather || "", dist: ui.map.dist || "", rdist: ui.rmap.dist || "", rweather: ui.rmap.weather || "", pool: ui.pool, obs: ui.obs, w5: !!ui.w5 }; }
  function publishCard() {
    var room = ui.room;
    if (!room || !room.isHost()) return;
    var cfg = room.cfg || netCfg(), card;
    // 冠軍大會（2026-11-05）：這一關的出賽狗由大會狀態決定（模式與等級用大會開始時的設定）
    var cup = Cup && room.cup && room.cup.stage !== "done" ? room.cup : null;
    var pidCid = {};
    room.list().forEach(function (p) { if (p.pid) pidCid[p.pid] = { cid: p.cid, name: p.name }; });
    function cupEntries() {
      return JSON.parse(JSON.stringify(Cup.entriesFor(cup))).map(function (e) {
        var pc = e.ownerPid && pidCid[e.ownerPid];
        if (pc) { e.owner = pc.cid; e.ownerName = pc.name || e.ownerName; }
        else if (e.ownerPid) e.owner = "gone:" + e.ownerPid;   // 飼主不在線：照樣出賽，只是沒有人結算這隻狗
        return e;
      });
    }
    var mode = cup ? cup.mode : cfg.mode, cls = cup ? cup.cls : cfg.cls || ui.cls;
    if (mode === "real") {
      var picked = [];
      if (cup) picked = cupEntries();
      else {
        // 每個玩家輪流排一隻，排滿 8 隻為止（大家都能派到，不會被第一個人佔滿）
        var lists = room.list().map(function (p) {
          return (p.entries && p.entries.length ? p.entries : p.entry ? [p.entry] : []).slice(0, ENTRY_MAX_NET).map(function (e) { e.owner = p.cid; e.ownerName = p.name; return e; });
        });
        for (var round = 0; round < ENTRY_MAX_NET && picked.length < Real.FIELD; round++) lists.forEach(function (l) { if (l[round] && picked.length < Real.FIELD) picked.push(l[round]); });
      }
      card = Core.makeCard(Core.newSeed(), picked.slice(0, Real.FIELD), { mode: "real", cls: cls, terrain: cfg.terrain || null, weather: cfg.weather || null, dist: cfg.dist || null, obstacles: cfg.obs !== false });
    } else {
      var entries = cup ? cupEntries() : room.list().filter(function (p) { return p.entry; }).map(function (p) { var e = p.entry; e.owner = p.cid; e.ownerName = p.name; return e; });
      card = Core.makeCard(Core.newSeed(), entries.slice(0, D.FIELD), { cls: cls, terrain: cfg.terrain || null, weather: cfg.weather || null, dist: cfg.dist || null });
    }
    card.pm = cfg.pool === false ? 0 : 1;
    if (cup) {
      card.cup = { id: cup.id, stage: cup.stage };
      if (cup.stage === "final") card.prizeMult = (D.CLASSES.filter(function (c) { return c.id === cls; })[0] || D.CLASSES[1]).prize * Cup.CUP_FINAL_PRIZE;
    }
    // WIN5：這張是第幾輪第幾場
    if (Cup && cfg.w5) room.w5Leg().then(function (leg) { if (leg) card.w5 = leg; room.publish(Core.cardForWire(card)); });
    else room.publish(Core.cardForWire(card));
  }
  // 冠軍大會：房主用目前大家派的狗開始（關卡賽每人 1 隻、真賽狗每人最多 ENTRY_MAX_NET 隻）
  function startCup() {
    var room = ui.room;
    if (!room || !room.isHost() || !Cup) return;
    var cfg = room.cfg || netCfg(), real = cfg.mode === "real";
    var lists = room.list().map(function (p) {
      var es = real ? (p.entries && p.entries.length ? p.entries : p.entry ? [p.entry] : []).slice(0, ENTRY_MAX_NET) : p.entry ? [p.entry] : [];
      return es.map(function (e) { e.owner = p.cid; e.ownerName = p.name; e.ownerPid = p.pid; return e; });
    });
    var id = "c" + Core.newSeed().toString(16);
    room.cupSet(Cup.start(id, real ? "real" : "classic", cfg.cls || ui.cls, lists)).then(function () { publishCard(); });
  }
  var roomRenderPending = false;
  function onRoomChange() {
    var room = ui.room;
    if (!room) return;
    var m = room.match, st = room.status();
    // 新的出賽表：換上並清掉上一場的下注
    if (m && m.no !== ui.netNo && (st === "card" || st === "race")) {
      ui.netNo = m.no;
      ui.card = m.card; ui.result = null; ui.tickets = []; ui.openDog = -1; ui.forceStart = false;
      ui.slip.picks = []; ui.slip.key = null;
      room.setReady(false);
      if (st === "card") { go("card"); return; }
    }
    if (st === "race" && m && m.startAt && ui.screen !== "race" && ui.screen !== "result" && ui.card) {
      // 開跑：扣下注金額（只扣一次）
      if (!ui.paid["n" + m.no]) {
        ui.paid["n" + m.no] = true;
        var cost = ui.tickets.reduce(function (a, x) { return a + x.cost; }, 0);
        // 房間籌碼扣款（管理面板在下注途中把籌碼調低、不夠付時整筆作廢）
        var tks = ui.tickets;
        if (cost > 0) room.addCoins(room.pid, -cost).then(function (v) { if (!v) tks.length = 0; });
      }
      ui.myCmds = ((m.cmds || {})[room.pid] || []).slice();
      ui.result = Core.simulate(ui.card, true, undefined, raceCmds());
      ui.cmdSig = JSON.stringify(raceCmds());
      ui.replay = false;
      go("race");
      return;
    }
    // 比賽中有人改跑法：用新的指令重新模擬
    if (st === "race" && m && m.no === ui.netNo && ui.screen === "race" && !ui.replay && ui.result && JSON.stringify(raceCmds()) !== ui.cmdSig) {
      resimulate();
      return;
    }
    if (st === "lobby" && (ui.screen === "card" || ui.screen === "result")) { go("lobby"); return; }
    if (st === "card" && ui.screen === "lobby" && ui.card) { go("card"); return; }
    var chip = app.querySelector(".sg-chips b");
    if (chip) chip.textContent = money(room.coins());
    if (ui.screen === "lobby" || ui.screen === "card" || ui.screen === "dash" || ui.screen === "result") scheduleRoomRender();
  }
  // 房間資料一變就重畫，但正在輸入框裡打字時先不重畫（不然會吃掉輸入）
  function scheduleRoomRender() {
    if (roomRenderPending) return;
    roomRenderPending = true;
    setTimeout(function () {
      roomRenderPending = false;
      if (ui.screen !== "lobby" && ui.screen !== "card" && ui.screen !== "dash" && ui.screen !== "result") return;
      var a = document.activeElement;
      if (a && app.contains(a) && (a.tagName === "INPUT" || a.tagName === "SELECT")) { scheduleRoomRender(); return; }
      rerenderKeep();
    }, 120);
  }

  // ---------------- 管理面板（連線房間；密碼 nightnight） ----------------
  function openDash() {
    if (!ui.room) return;
    if (!ui.dashOk) {
      var pw = window.prompt(t("sg_dash_pw"));
      if (pw === null) return;
      if (pw !== DASH_PASSWORD) { window.alert(t("sg_dash_pw_wrong")); return; }
      ui.dashOk = true;
    }
    ui.dashMsg = "";
    go("dash");
  }
  function amountOf(v) { var n = Math.round(Number(String(v).replace(/[,¥\s]/g, ""))); return isFinite(n) ? n : NaN; }
  function dashDone(msg) { return function () { ui.dashMsg = msg; rerenderKeep(); }; }
  function screenDash() {
    var room = ui.room;
    if (!room || !ui.dashOk) { go(room ? "lobby" : "home"); return; }
    var cfg = room.bankCfg(), dash = ui.dash;
    function numIn(val, onset, ph) {
      return el("input", { class: "sg-input sg-stake", type: "number", step: "100", value: val, placeholder: ph || "", oninput: function (e) { onset(e.target.value); } });
    }
    var startIn = numIn(dash.start !== "" ? dash.start : String(cfg.start), function (v) { dash.start = v; });
    app.appendChild(panel(t("sg_dash_title"), [
      el("p", { class: "sg-small sg-muted" }, [t("sg_dash_note")]),
      ui.dashMsg ? el("p", { class: "sg-msg" }, [ui.dashMsg]) : null,
      el("h3", null, [t("sg_dash_start")]),
      el("div", { class: "sg-row" }, [
        startIn,
        btn(t("sg_dash_start_save"), function () {
          var n = amountOf(startIn.value);
          if (!(n >= 0)) return;
          dash.start = "";
          room.setBank(n, false).then(dashDone(t("sg_dash_msg_start", { n: money(n) })));
        }, "sg-btn"),
        btn(t("sg_dash_reset_all"), function () {
          var n = amountOf(startIn.value);
          if (!(n >= 0) || !window.confirm(t("sg_dash_reset_confirm", { n: money(n) }))) return;
          dash.start = "";
          room.setBank(n, true).then(dashDone(t("sg_dash_msg_reset", { n: money(n) })));
        }, "sg-btn sg-danger")
      ]),
      el("p", { class: "sg-small sg-muted" }, [t("sg_dash_start_note")]),
      el("h3", null, [t("sg_dash_give_all")]),
      el("div", { class: "sg-row" }, [
        numIn(dash.all, function (v) { dash.all = v; }, "1000"),
        btn(t("sg_dash_give_all_btn"), function () {
          var n = amountOf(dash.all);
          if (!n) return;
          var rows = room.ledger().filter(function (r) { return r.online; });
          Promise.all(rows.map(function (r) { return room.addCoins(r.pid, n, true); })).then(dashDone(t("sg_dash_msg_give_all", { n: (n > 0 ? "+" : "") + money(n), k: rows.length })));
        }, "sg-btn sg-primary")
      ]),
      el("p", { class: "sg-small sg-muted" }, [t("sg_dash_give_note")])
    ]));

    var rows = room.ledger();
    app.appendChild(panel(t("sg_dash_players", { n: rows.length }), [
      el("table", { class: "sg-table sg-dash" }, [
        el("thead", null, [el("tr", null, [t("sg_net_players"), t("sg_chips"), t("sg_dash_amount"), ""].map(function (h) { return el("th", null, [h]); }))]),
        el("tbody", null, rows.map(function (r) {
          var inp = numIn(dash.per[r.pid] || "", function (v) { dash.per[r.pid] = v; });
          function act(fn, msg) { return function () { var n = amountOf(inp.value); if (isNaN(n) || inp.value === "") return; dash.per[r.pid] = ""; fn(n).then(dashDone(msg(n))); }; }
          var nm = (r.name || t("sg_net_noname")) + (r.pid === room.pid ? t("sg_net_you") : "");
          return el("tr", { class: r.online ? "" : "sg-off" }, [
            el("td", null, [el("span", { class: r.online ? "sg-good" : "sg-muted" }, [r.online ? "● " : "○ "]), nm]),
            el("td", { class: "sg-odds" }, [money(r.coins)]),
            el("td", null, [inp]),
            el("td", { class: "sg-dash-acts" }, [
              btn(t("sg_dash_give"), act(function (n) { return room.addCoins(r.pid, n, true); }, function (n) { return t("sg_dash_msg_give", { name: nm, n: (n > 0 ? "+" : "") + money(n) }); }), "sg-btn sg-primary"),
              btn(t("sg_dash_set"), act(function (n) { return room.setCoins(r.pid, n); }, function (n) { return t("sg_dash_msg_set", { name: nm, n: money(Math.max(0, n)) }); }), "sg-btn"),
              btn(t("sg_dash_reset"), function () { room.setCoins(r.pid, cfg.start).then(dashDone(t("sg_dash_msg_set", { name: nm, n: money(cfg.start) }))); }, "sg-link")
            ])
          ]);
        }))
      ]),
      el("p", { class: "sg-small sg-muted" }, [t("sg_dash_row_note")])
    ]));
    app.appendChild(el("div", { class: "sg-actions sg-next" }, [btn(t("sg_dash_back"), function () { go("lobby"); }, "sg-btn")]));
  }
  function screenLobby() {
    var room = ui.room;
    if (!room) { go("home"); return; }
    if (room.missing) { app.appendChild(panel(t("sg_net_title"), [el("p", null, [t("sg_net_missing")]), btn(t("sg_home"), leaveRoom)])); return; }
    if (!room.loaded) { app.appendChild(panel(t("sg_net_title"), [el("p", { class: "sg-muted" }, [t("sg_net_connecting")])])); return; }
    var host = room.isHost(), url = roomUrl(room.id);
    // 非房主：賽事等級與地圖設定跟著房主
    if (!host && room.cfg) {
      if (room.cfg.cls) ui.cls = room.cfg.cls;
      ui.pool = room.cfg.pool !== false;
      ui.map = { terrain: room.cfg.terrain || "", weather: room.cfg.weather || "", dist: room.cfg.dist || "" };
      ui.mode = room.cfg.mode === "real" ? "real" : "classic";
      ui.rmap = { weather: room.cfg.rweather || "", dist: room.cfg.rdist || "" };
      ui.obs = room.cfg.obs !== false;
      ui.w5 = !!room.cfg.w5;
    }
    var realRoom = ui.mode === "real";
    var qr = el("canvas", { class: "sg-qr" });
    try { window.PriTestQRCode.renderToCanvas(qr, url, { level: "L", scale: 4, margin: 2 }); } catch (e) { qr = null; }
    var nameIn = el("input", { class: "sg-input", maxlength: "16", value: lsGet(NAME_KEY), placeholder: t("sg_net_name"), onchange: function (e) { lsSet(NAME_KEY, e.target.value.trim()); syncEntry(); } });
    app.appendChild(panel(t("sg_net_title"), [
      el("div", { class: "sg-card-head" }, [
        qr,
        el("div", null, [
          el("p", null, [t("sg_net_share")]),
          el("input", { class: "sg-input sg-url", readonly: true, value: url, onclick: function (e) { e.target.select(); } }),
          el("div", { class: "sg-actions" }, [
            btn(t("sg_net_copy"), function () { try { navigator.clipboard.writeText(url); ui.msg = t("sg_net_copied"); } catch (e) { ui.msg = ""; } rerenderKeep(); }),
            btn("🔧 " + t("sg_dash_open"), openDash, "sg-btn"),
            btn(t("sg_net_leave"), leaveRoom, "sg-link")
          ]),
          ui.msg ? el("p", { class: "sg-small sg-good" }, [ui.msg]) : null
        ])
      ])
    ]));
    app.appendChild(panel(t("sg_net_me"), [
      el("div", { class: "sg-row" }, [el("label", null, [t("sg_net_name") + " ", nameIn])]),
      realRoom ? el("div", null, [el("h3", null, [t("sg_entry")]), multiEntryPicker(ENTRY_MAX_NET, function () { syncEntry(); rerenderKeep(); })])
        : el("div", { class: "sg-row" }, [el("label", null, [t("sg_entry") + " ", entryPicker(syncEntry)])]),
      realRoom ? entryStylePickers(syncEntry) : dogStylePicker(ui.entryDog, syncEntry),
      el("p", { class: "sg-small sg-muted" }, [t("sg_net_entry_note")])
    ]));
    var list = room.list();
    app.appendChild(panel(t("sg_net_players") + "（" + list.length + "）", [
      el("ul", { class: "sg-plist" }, list.map(function (p) {
        return el("li", null, [(p.cid === room.meta.host ? "👑 " : "") + (p.name || t("sg_net_noname")) + (p.cid === room.cid ? t("sg_net_you") : ""), " ",
          p.pid ? el("b", { class: "sg-pchips" }, [money(room.coinsOf(p.pid))]) : null, " — ",
          (function () {
            var es = realRoom ? (p.entries && p.entries.length ? p.entries : p.entry ? [p.entry] : []) : p.entry ? [p.entry] : [];
            return es.length ? es.map(function (e) { return e.name + "（" + L((D.BREED_BY_ID[e.breed] || D.BREEDS[0]).name) + "）"; }).join("、") : el("span", { class: "sg-muted" }, [t("sg_net_watch")]);
          })()]);
      })),
      el("p", { class: "sg-small sg-muted" }, [t("sg_net_cpu_fill", { n: realRoom ? Real.FIELD : D.FIELD })])
    ]));
    var st = room.status();
    app.appendChild(panel(t("sg_class"), [
      el("h3", null, [t("sg_mode")]),
      modePicker(function () { if (host) room.setCfg(netCfg()); syncEntry(); render(); }, !host),
      el("h3", null, [t("sg_class")]),
      classPicker(function () { if (host) room.setCfg(netCfg()); render(); }, !host),
      mapPicker(function () { if (host) room.setCfg(netCfg()); rerenderKeep(); }, !host),
      realRoom ? obsPicker(function () { if (host) room.setCfg(netCfg()); rerenderKeep(); }, !host) : null,
      el("h3", null, [t("sg_odds_mode")]),
      el("div", { class: "sg-seg" }, [[true, "sg_odds_pool"], [false, "sg_odds_fixed"]].map(function (o) {
        return btn(t(o[1]), function () { ui.pool = o[0]; setPref({ pool: o[0] }); room.setCfg(netCfg()); rerenderKeep(); }, "sg-seg-btn" + (ui.pool === o[0] ? " sg-on" : ""), { disabled: !host });
      })),
      el("p", { class: "sg-small sg-muted" }, [t("sg_odds_mode_note")]),
      Cup ? el("h3", null, ["🎯 WIN5"]) : null,
      Cup ? el("div", { class: "sg-seg" }, [[true, "sg_w5_on"], [false, "sg_w5_off"]].map(function (o) {
        return btn(t(o[1]), function () { ui.w5 = o[0]; setPref({ w5: o[0] }); room.setCfg(netCfg()); rerenderKeep(); }, "sg-seg-btn" + (!!ui.w5 === o[0] ? " sg-on" : ""), { disabled: !host });
      })) : null,
      Cup ? el("p", { class: "sg-small sg-muted" }, [t("sg_w5_lobby_note", { n: money(Cup.W5_COST) }) + (room.w5 && room.w5.ser ? " " + t("sg_w5_status", { s: room.w5.ser, n: room.w5.leg, c: money(room.w5.carry || 0) }) : "")]) : null,
      host ? el("div", { class: "sg-actions" }, [
        btn(t("sg_net_publish"), publishCard, "sg-btn sg-primary sg-big"),
        st === "card" && ui.card ? btn(t("sg_net_back_card"), function () { go("card"); }, "sg-btn") : null
      ]) : el("p", { class: "sg-muted" }, [st === "card" ? t("sg_net_card_open") : t("sg_net_wait_publish")]),
      !host && st === "card" && ui.card ? btn(t("sg_net_back_card"), function () { go("card"); }, "sg-btn") : null
    ]));
    if (Cup) {
      var cup = room.cup, active = cup && cup.stage !== "done";
      var cp = cupPanel(cup, null);
      cp.appendChild(el("p", { class: "sg-small sg-muted" }, [t("sg_cup_note", { q: Cup.CUP.classic.q, r: Cup.CUP.classic.rep, q8: Cup.CUP.real.q, r8: Cup.CUP.real.rep, m: Cup.CUP_FINAL_PRIZE })]));
      if (host) cp.appendChild(el("div", { class: "sg-actions" }, [
        active ? btn(t("sg_cup_next"), publishCard, "sg-btn sg-primary") : btn("🏆 " + t("sg_cup_start"), function () { if (window.confirm(t("sg_cup_start_confirm"))) startCup(); }, "sg-btn sg-primary"),
        active ? btn(t("sg_cup_end"), function () { if (window.confirm(t("sg_cup_end_confirm"))) { room.cupSet(null); rerenderKeep(); } }, "sg-link sg-danger") : null
      ]));
      app.appendChild(cp);
    }
  }

  // ---------------- 設定（畫質） ----------------
  function settingsPanel() {
    var p = pref();
    return panel(t("sg_settings"), [el("div", { class: "sg-seg" }, [
      btn(t("sg_q_high"), function () { setPref({ quality: "high", no3d: false }); render(); }, "sg-seg-btn" + (!p.no3d && p.quality !== "low" ? " sg-on" : "")),
      btn(t("sg_q_low"), function () { setPref({ quality: "low", no3d: false }); render(); }, "sg-seg-btn" + (!p.no3d && p.quality === "low" ? " sg-on" : "")),
      btn(t("sg_q_2d"), function () { setPref({ no3d: true }); render(); }, "sg-seg-btn" + (p.no3d ? " sg-on" : ""))
    ])]);
  }

  var SCREENS = {
    home: function () { screenHome(); app.appendChild(settingsPanel()); },
    zukan: screenZukan, kennel: screenKennel, record: screenRecord,
    setup: screenSetup, card: screenCard, race: screenRace, result: screenResult, lobby: screenLobby, dash: screenDash
  };

  window.addEventListener("i18n:change", function () { if (ui.screen !== "race") render(); });
  // 2026-11-04 修正：單機在開跑時就扣了下注金額，但派彩、狗的獎金／經驗要等轉播播完才結算；
  //   轉播中重新整理或關掉分頁＝錢被扣走卻永遠不結算。比賽結果開跑時就已確定，所以離開頁面時直接結算（本機存檔是同步的）。
  window.addEventListener("pagehide", function () {
    if (ui.screen === "race" && !ui.room && !ui.replay && ui.result && ui.card) settle();
  });
  // 測試／除錯用
  window.PriTestSaigo = { ui: ui, go: go, startSolo: startSolo, startRace: startRace, enterRoom: enterRoom, openDash: openDash, sendShout: sendShout };

  render();
  (function () { var id = Net ? Net.roomFromUrl(location.search) : null; if (id) enterRoom(id); })();
})();
