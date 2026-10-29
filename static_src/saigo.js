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
  var app = document.getElementById("sg-app");
  if (!app || !D || !Core) return;

  var NAME_KEY = "pritest-saigo-name", PREF_KEY = "pritest-saigo-pref";
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
  function statBar(v, max, cls) {
    return el("span", { class: "sg-bar " + (cls || "") }, [el("i", { style: "width:" + Math.round(Core.clamp(v / (max || 120), 0, 1) * 100) + "%" })]);
  }

  var ui = {
    screen: "home", card: null, result: null, tickets: [], practice: false, cls: pref().cls || "open", entryDog: pref().entryDog || "",
    slip: { type: "win", method: "normal", picks: [], key: null, stake: 100 },
    map: pref().map || { terrain: "", weather: "", dist: "" },
    room: null, netNo: 0, settled: {}, paid: {}, view: null, previews: [], raf: 0, selDog: null, openDog: -1, msg: ""
  };

  // ---------------- 共用 ----------------
  function stopRace() {
    if (ui.raf) cancelAnimationFrame(ui.raf);
    ui.raf = 0;
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
    app.appendChild(panel(t("sg_rules_title"), [el("ul", { class: "sg-rules" }, ["sg_rule_1", "sg_rule_2", "sg_rule_3", "sg_rule_4", "sg_rule_5"].map(function (k) { return el("li", null, [t(k)]); }))]));
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
        el("small", null, [L(D.MOODS[d.mood].name) + " " + D.MOODS[d.mood].icon + "・" + t("sg_fatigue") + " " + d.fatigue])
      ]);
    }));
    app.appendChild(panel(t("sg_kennel_title", { n: s.dogs.length, max: K.MAX_DOGS }), [s.dogs.length ? list : el("p", { class: "sg-muted" }, [t("sg_kennel_empty")])]));

    var d = ui.selDog ? K.dog(ui.selDog) : null;
    if (d) {
      var b = breedOf(d), stats = dogStats(d);
      var trainBtns = el("div", { class: "sg-train" }, Object.keys(K.TRAININGS).map(function (k) {
        var tr = K.TRAININGS[k];
        return btn(tr.icon + " " + t("sg_train_" + k), function () {
          var r = K.train(d.id, k);
          if (!r) return;
          ui.msg = r.tired ? t("sg_msg_tired") : t("sg_msg_trained", { a: t("sg_stat_" + r.main), ga: r.gMain, b: t("sg_stat_" + r.sub), gb: r.gSub }) + (r.lvUp ? " " + t("sg_msg_lvup") : "") + (r.moodDown ? " " + t("sg_msg_mood_down") : "");
          render();
        }, "sg-btn", { title: t("sg_stat_" + tr.main) + " / " + t("sg_stat_" + tr.sub), disabled: d.fatigue >= 95 });
      }));
      var care = el("div", { class: "sg-actions" }, [
        btn("😴 " + t("sg_rest"), function () { K.rest(d.id); ui.msg = t("sg_msg_rest"); render(); }),
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
        statsTable(stats, d.train),
        el("p", { class: "sg-small sg-muted" }, [t("sg_train_cap", { n: K.TRAIN_CAP })])
      ]);
      app.appendChild(panel(t("sg_kennel_detail"), [
        el("div", { class: "sg-zukan-detail" }, [previewBox(d.breed, 0), info]),
        ui.msg ? el("p", { class: "sg-msg" }, [ui.msg]) : null,
        el("h3", null, [t("sg_training")]), trainBtns,
        el("h3", null, [t("sg_care")]), care,
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
        return el("option", { value: d.id, selected: d.id === ui.entryDog }, [d.name + "（" + L(breedOf(d).name) + " Lv" + d.lv + "・" + t("sg_fatigue") + d.fatigue + "）"]);
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
  function screenSetup() {
    app.appendChild(panel(t("sg_menu_solo"), [
      el("h3", null, [t("sg_class")]), classPicker(),
      el("p", { class: "sg-small sg-muted" }, [t("sg_class_note")]),
      mapPicker(),
      el("h3", null, [t("sg_entry")]), entryPicker(),
      el("div", { class: "sg-actions" }, [btn(t("sg_make_card"), function () { startSolo(false, ui.entryDog); }, "sg-btn sg-primary")])
    ]));
  }
  function startSolo(practice, dogId) {
    var entries = [];
    var e = dogId ? K.entry(dogId, "me", "") : null;
    if (e) entries.push(e);
    ui.practice = !!practice;
    var o = mapOpts();
    o.cls = practice ? "rookie" : ui.cls;
    ui.card = Core.makeCard(Core.newSeed(), entries, o);
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
  var PART_COLORS = { straight: "#b98a5a", curve: "#b98a5a", hurdle: "#e53935", tunnel: "#8e24aa", frisbee: "#fdd835", weave: "#ff7043", pool: "#29b6f6", mud: "#5d4037", aframe: "#43a047", treat: "#ec407a", stay: "#1e88e5", hill: "#7cb342", bridge: "#6d4c41" };
  function drawMinimap(c, card, positions) {
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
      return el("span", { class: "sg-part sg-part-" + p.type, title: nm }, [def.icon + " " + nm + (p.type === "hurdle" ? "×" + p.bars : "") + (p.type === "hill" ? " ↑" + p.hh + "m" : "") + " " + p.len + "m"]);
    }));
  }
  function raceTitle(card) {
    var cls = D.CLASSES.filter(function (c) { return c.id === card.cls; })[0];
    var TR = D.TERRAINS[card.terrain] || D.TERRAINS.park;
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
    var od = Core.odds(card), pop = Core.popularity(card), W = D.WEATHERS[card.weather], G = D.GROUNDS[card.ground];
    app.appendChild(panel(raceTitle(card), [
      el("div", { class: "sg-card-head" }, [
        minimap(card, 260, 170),
        el("div", null, [
          el("p", { class: "sg-cond" }, [
            el("span", { class: "sg-chip" }, [(D.TERRAINS[card.terrain] || D.TERRAINS.park).icon + " " + L((D.TERRAINS[card.terrain] || D.TERRAINS.park).name) + "（" + L(D.SURFACES[(D.TERRAINS[card.terrain] || D.TERRAINS.park).surf].name) + "）"]),
            el("span", { class: "sg-chip" }, [W.icon + " " + L(W.name)]),
            el("span", { class: "sg-chip" }, [L((D.DISTANCES[card.dist] || D.DISTANCES.middle).name)]),
            el("span", { class: "sg-chip sg-code", title: t("sg_code_note") }, [t("sg_code") + " #" + Core.courseCode(card)]),
            el("span", { class: "sg-chip" }, [t("sg_ground") + "：" + L(G.name)]),
            el("span", { class: "sg-chip" }, [t("sg_parts_n", { n: card.course.parts.filter(function (p) { return p.type !== "straight" && p.type !== "curve"; }).length })])
          ]),
          partChips(card),
          el("p", { class: "sg-small sg-muted" }, [t("sg_terrain_note_" + (card.terrain || "park"))]),
          el("p", { class: "sg-small sg-muted" }, [t("sg_weather_note_" + card.weather)])
        ])
      ])
    ]));

    // 出走表
    var rows = [];
    card.dogs.forEach(function (d, i) {
      var b = breedOf(d), mine = isMine(d), mood = D.MOODS[d.mood];
      rows.push(el("tr", { class: "sg-dogrow" + (mine ? " sg-mine" : "") + (ui.openDog === i ? " sg-open" : ""), onclick: function () { ui.openDog = ui.openDog === i ? -1 : i; rerenderKeep(); } }, [
        el("td", null, [gateBadge(i)]),
        el("td", null, [el("b", null, [d.name]), el("br"), el("small", null, [L(b.name)])]),
        el("td", { class: "sg-hide-s" }, [d.cpu ? "CPU" : (mine ? t("sg_owner_me") : d.ownerName || t("sg_owner_player"))]),
        el("td", { class: "sg-mood sg-mood-" + d.mood }, [mood.icon + " " + L(mood.name)]),
        el("td", { class: "sg-hide-s" }, [L(D.STYLES[d.style])]),
        el("td", { class: "sg-hide-s" }, [statBar(d.eff.spd), statBar(d.eff.sta, 120, "sg-bar-b"), statBar(d.eff.agi, 120, "sg-bar-c")]),
        el("td", { class: "sg-odds" }, [od.win[i].toFixed(1)]),
        el("td", null, [t("sg_pop_n", { n: pop[i] })])
      ]));
      if (ui.openDog === i) {
        rows.push(el("tr", { class: "sg-dogdetail" }, [el("td", { colspan: "8" }, [
          el("div", { class: "sg-zukan-detail" }, [
            previewBox(d.breed, i),
            el("div", null, [
              el("p", null, [traitLine(b) + (d.lv ? "・Lv" + d.lv : "")]),
              statsTable(d.eff),
              el("p", { class: "sg-small sg-muted" }, [t("sg_eff_note")]),
              el("p", { class: "sg-small" }, [t("sg_place_odds") + "：" + od.place[i].toFixed(1)])
            ])
          ])
        ])]));
      }
    });
    app.appendChild(panel(t("sg_entries"), [el("table", { class: "sg-table sg-entries" }, [
      el("thead", null, [el("tr", null, ["", t("sg_col_dog"), el("span", { class: "sg-hide-s" }, [t("sg_col_owner")]), t("sg_mood"), el("span", { class: "sg-hide-s" }, [t("sg_style")]), el("span", { class: "sg-hide-s" }, [t("sg_col_spd_sta_agi")]), t("sg_col_odds"), t("sg_col_pop")].map(function (h) { return el("th", null, [h]); }))]),
      el("tbody", null, rows)
    ]), el("p", { class: "sg-small sg-muted" }, [t("sg_click_detail")])]));

    if (!ui.practice) app.appendChild(betSlip(card));
    app.appendChild(cardActions());
  }
  function isMine(d) {
    if (!d || d.cpu) return false;
    if (ui.room) return d.owner === ui.room.cid;
    return d.owner === "me";
  }
  function rerenderKeep() { var y = window.scrollY; render(); window.scrollTo(0, y); }

  function betSlip(card) {
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
    var draft = Bet.makeTicket(card, sl.type, sl.method, picks, sl.key, sl.stake);
    var ods = draft.combos.map(function (c) { return draft.odds[c]; });
    var stakeIn = el("input", { class: "sg-input sg-stake", type: "number", min: "100", step: "100", value: String(sl.stake), disabled: !open, onchange: function (e) { sl.stake = Math.max(100, Math.floor((Number(e.target.value) || 100) / 100) * 100); rerenderKeep(); } });
    var total = ui.tickets.reduce(function (a, x) { return a + x.cost; }, 0);
    var canAdd = open && draft.combos.length > 0 && total + draft.cost <= K.coins();
    var hint = bt.pick === 1 ? t("sg_hint_single") : sl.method === "normal" ? t(bt.ordered ? "sg_hint_normal_ordered" : "sg_hint_normal", { n: bt.pick }) : sl.method === "box" ? t("sg_hint_box", { n: bt.pick }) : t(bt.ordered ? "sg_hint_key_ordered" : "sg_hint_key");
    var list = el("div", { class: "sg-tickets" }, ui.tickets.map(function (tk, n) {
      return el("div", { class: "sg-ticket" }, [
        el("b", null, [L(Bet.TYPE[tk.type].name)]), " " + (tk.method !== "normal" ? t("sg_method_" + tk.method) + " " : ""),
        el("span", { class: "sg-combos" }, [tk.combos.slice(0, 8).map(function (c) { return Bet.comboLabel(tk.type, c) + "(" + tk.odds[c] + ")"; }).join(" ") + (tk.combos.length > 8 ? " …" : "")]),
        " " + t("sg_ticket_cost", { n: tk.combos.length, s: money(tk.stake), c: money(tk.cost) }),
        open ? btn("×", function () { ui.tickets.splice(n, 1); rerenderKeep(); }, "sg-x") : null
      ]);
    }));
    return panel(t("sg_bet_title"), [
      typeSeg, el("p", { class: "sg-small sg-muted" }, [t("sg_bet_desc_" + sl.type)]),
      methodSeg, el("p", { class: "sg-small" }, [hint]),
      pickRow,
      el("div", { class: "sg-row sg-slip" }, [
        el("label", null, [t("sg_stake_per"), stakeIn]),
        el("span", null, [t("sg_draft", { n: draft.combos.length, c: money(draft.cost) }) + (ods.length ? "・" + t("sg_odds_range", { a: Math.min.apply(null, ods).toFixed(1), b: Math.max.apply(null, ods).toFixed(1) }) : "")]),
        btn(t("sg_add_ticket"), function () { ui.tickets.push(draft); sl.picks = []; sl.key = null; rerenderKeep(); }, "sg-btn sg-primary", { disabled: !canAdd })
      ]),
      ui.tickets.length ? list : el("p", { class: "sg-muted sg-small" }, [t("sg_no_tickets")]),
      el("p", null, [t("sg_total_bet", { c: money(total), left: money(K.coins() - total) })])
    ]);
  }

  function cardActions() {
    if (!ui.room) {
      return el("div", { class: "sg-actions sg-next" }, [
        btn(t("sg_reroll"), function () { startSolo(ui.practice, ui.entryDog); }, "sg-btn"),
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
    ui.result = Core.simulate(ui.card, true);
    // 單機：開跑時扣下注金額
    if (!ui.room && ui.tickets.length) {
      var cost = ui.tickets.reduce(function (a, x) { return a + x.cost; }, 0);
      if (!K.spend(cost)) { ui.tickets = []; }
    }
    ui.raceT = -3; ui.speed = 1; ui.replay = false; ui.settledSolo = false;
    go("race");
  }
  var EV_ICONS = { knock: "💥", catchGood: "🥏", catchLate: "🥏", catchMiss: "❌", eat: "🍖", stayBreak: "🙃", stayGood: "✋", weaveMiss: "〰", lead: "🚩", finish: "🏁", jumpGood: "✨", start: "🔫", diveGood: "🌊", bridgeStop: "😰" };
  function eventText(card, e) {
    var name = e.d >= 0 ? (e.d + 1) + " " + card.dogs[e.d].name : "";
    return (EV_ICONS[e.k] || "") + " " + t("sg_ev_" + e.k, { name: name, n: e.x });
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
    hud.appendChild(info); hud.appendChild(rankBox); hud.appendChild(ticker); hud.appendChild(count); hud.appendChild(shot); hud.appendChild(mm);
    stage.appendChild(hud);
    var camBar = el("div", { class: "sg-cams" });
    var spdBar = el("div", { class: "sg-cams" });
    app.appendChild(el("div", { class: "sg-race" }, [stage, camBar, spdBar]));

    var camMode = pref().cam || "tv", camDog = 0;
    var myIdx = -1;
    card.dogs.forEach(function (d, i) { if (myIdx < 0 && isMine(d)) myIdx = i; });
    if (myIdx >= 0) camDog = myIdx;
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
        ui.view = V3.create(stage, card, res, { quality: pref().quality || "high" });
        var cv = stage.querySelector(".sg-canvas");
        if (cv) stage.insertBefore(cv, hud);
        ui.view.setCam(camMode, camDog);
      }).catch(function () { stage.classList.remove("sg-loading"); fallback = el("canvas", { class: "sg-fallback", width: 800, height: 450 }); stage.insertBefore(fallback, hud); });
    }
    start3d();

    var last = performance.now(), lastEv = -1, ended = false, tickLines = [];
    var evs = (res.events || []).filter(function (e) { return e.k !== "enter" && e.k !== "start" && e.k !== "stayGood"; });
    function loop(now) {
      if (ui.screen !== "race") return;
      var dt = Math.min(0.1, (now - last) / 1000); last = now;
      var tt;
      if (ui.room && !ui.replay) { tt = ui.room.raceTime(); if (tt === null) tt = -3; }
      else { ui.raceT += dt * (ui.raceT < 0 ? 1 : ui.speed); tt = ui.raceT; }
      var out = null;
      if (ui.view) out = ui.view.frame(tt, dt * (ui.room && !ui.replay ? 1 : ui.speed));
      var rank = out ? out.rank : Core.rankAt(res, Math.max(0, tt));
      var st = Core.stateAt(res, Math.max(0, tt));
      var pos = st.map(function (x, i) { var p = Core.pointAt(card.course, Math.min(x.s, card.course.length), Core.laneOff(i)); return { x: p.x, z: p.y }; });
      if (fallback) drawFallback(fallback, card, res, tt, pos, rank);
      drawMinimap(mm, card, pos);
      // HUD
      var lead = rank[0], ls = st[lead] ? st[lead].s : 0;
      var part = Core.partAt(card.course, Math.min(ls, card.course.length - 0.01));
      info.textContent = (tt < 0 ? "" : fmtTime(Math.max(0, tt)) + "  ") + t("sg_hud_left", { n: Math.max(0, Math.round(card.course.length - ls)) }) + "  " + D.PARTS[part.type].icon + " " + D.partName(part);
      rankBox.innerHTML = "";
      rank.forEach(function (i, n) {
        var gap = n === 0 ? "" : (res.times[i] !== null && res.times[i] <= tt ? "+" + (res.times[i] - res.times[rank[0]]).toFixed(2) + "s" : "-" + Math.max(0, (ls - st[i].s)).toFixed(1) + "m");
        rankBox.appendChild(el("li", { class: isMine(card.dogs[i]) ? "sg-mine" : "" }, [gateBadge(i), " " + card.dogs[i].name + " ", el("small", null, [gap])]));
      });
      count.textContent = tt < 0 ? String(Math.ceil(-tt)) : (tt < 1 ? "GO!" : "");
      count.style.display = tt < 1 ? "" : "none";
      shot.textContent = out && out.shot ? "LIVE ・ " + t("sg_shot_" + out.shot) : "";
      // 實況
      while (lastEv + 1 < evs.length && evs[lastEv + 1].t <= tt) {
        lastEv++;
        var line = eventText(card, evs[lastEv]);
        if (line) { tickLines.unshift(line); if (tickLines.length > 4) tickLines.length = 4; }
      }
      if (tt < 0.1 && tickLines.length && lastEv < 0) tickLines = [];
      ticker.innerHTML = "";
      tickLines.forEach(function (s2, n) { ticker.appendChild(el("div", { style: "opacity:" + (1 - n * 0.22) }, [s2])); });
      if (!ended && tt > res.duration + 3) { ended = true; finishRace(); return; }
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
      var w = (c.width - 140) * Core.clamp(st.s / card.course.length, 0, 1);
      // 進度條放在左側、資訊列下方（右上是名次表）
      var y0 = 70 + n * 18, bw = c.width * 0.45;
      w = bw * Core.clamp(st.s / card.course.length, 0, 1);
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
    var sum = Bet.settle(ui.tickets, order);
    if (sum.won) K.receive(sum.won);
    ui.lastSettle = sum;
    var cls = D.CLASSES.filter(function (c) { return c.id === card.cls; })[0];
    ui.dogRewards = [];
    card.dogs.forEach(function (d, i) {
      if (!isMine(d) || !d.dogId) return;
      var r = K.afterRace(d.dogId, order.indexOf(i), cls.prize, ui.practice);
      if (r) ui.dogRewards.push({ name: d.name, place: order.indexOf(i), r: r });
    });
    if (!ui.practice) K.record({ at: Date.now(), title: raceTitle(card), winner: (order[0] + 1) + " " + card.dogs[order[0]].name, spent: sum.spent, won: sum.won });
  }

  function screenResult() {
    var card = ui.card, res = ui.result, order = res.order, sum = ui.lastSettle || { rows: [], spent: 0, won: 0 };
    var winT = res.times[order[0]];
    app.appendChild(panel(t("sg_result_title") + "・" + raceTitle(card), [
      el("table", { class: "sg-table" }, [
        el("thead", null, [el("tr", null, [t("sg_col_rank"), "", t("sg_col_dog"), t("sg_col_time"), t("sg_col_margin"), t("sg_col_odds")].map(function (h) { return el("th", null, [h]); }))]),
        el("tbody", null, order.map(function (i, n) {
          var d = card.dogs[i], tm = res.times[i];
          return el("tr", { class: isMine(d) ? "sg-mine" : "" }, [
            el("td", null, [n + 1 + ""]), el("td", null, [gateBadge(i)]),
            el("td", null, [el("b", null, [d.name]), " ", el("small", null, [L(breedOf(d).name)])]),
            el("td", null, [tm === null ? t("sg_dnf") : fmtTime(tm)]),
            el("td", null, [n === 0 || tm === null ? "" : "+" + (tm - winT).toFixed(2)]),
            el("td", null, [Core.odds(card).win[i].toFixed(1)])
          ]);
        }))
      ])
    ]));
    if (!ui.practice) {
      var pt = Bet.payoutTable(card, order);
      app.appendChild(panel(t("sg_payouts"), [el("table", { class: "sg-table sg-pay" }, [el("tbody", null, pt.map(function (row) {
        return el("tr", null, [el("th", null, [L(Bet.TYPE[row.type].name)]), el("td", null, row.list.map(function (x) { return el("div", null, [Bet.comboLabel(row.type, x.combo) + "　" + money(x.pay)]); }))]);
      }))]), el("p", { class: "sg-small sg-muted" }, [t("sg_pay_note")])]));
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
    if (ui.dogRewards && ui.dogRewards.length) {
      app.appendChild(panel(t("sg_dog_rewards"), ui.dogRewards.map(function (x) {
        return el("p", null, [t("sg_dog_reward_line", { name: x.name, p: x.place + 1, prize: money(x.r.prize), exp: x.r.exp }) + (x.r.lvUp ? " " + t("sg_msg_lvup") : "")]);
      })));
    }
    var acts = [btn(t("sg_replay"), function () { ui.replay = true; ui.raceT = -1; ui.speed = 1; go("race"); }, "sg-btn")];
    if (ui.room) {
      if (ui.room.isHost()) {
        acts.push(btn(t("sg_net_next"), function () { publishCard(); }, "sg-btn sg-primary"));
        acts.push(btn(t("sg_net_lobby"), function () { ui.room.backToLobby(); }, "sg-btn"));
      } else acts.push(el("span", { class: "sg-muted" }, [t("sg_net_wait_next")]));
    } else {
      acts.push(btn(ui.practice ? t("sg_back_kennel") : t("sg_next_race"), function () { if (ui.practice) go("kennel"); else startSolo(false, ui.entryDog); }, "sg-btn sg-primary"));
    }
    app.appendChild(el("div", { class: "sg-actions sg-next" }, acts));
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
  function syncEntry() {
    if (!ui.room) return;
    var e = ui.entryDog ? K.entry(ui.entryDog, ui.room.cid, lsGet(NAME_KEY)) : null;
    ui.room.update({ entry: e, name: lsGet(NAME_KEY) });
  }
  function netCfg() { return { cls: ui.cls, terrain: ui.map.terrain || "", weather: ui.map.weather || "", dist: ui.map.dist || "" }; }
  function publishCard() {
    var room = ui.room;
    if (!room || !room.isHost()) return;
    var entries = room.list().filter(function (p) { return p.entry; }).map(function (p) { var e = p.entry; e.owner = p.cid; e.ownerName = p.name; return e; });
    var cfg = room.cfg || netCfg();
    var card = Core.makeCard(Core.newSeed(), entries.slice(0, D.FIELD), { cls: cfg.cls || ui.cls, terrain: cfg.terrain || null, weather: cfg.weather || null, dist: cfg.dist || null });
    room.publish(Core.cardForWire(card));
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
        if (cost > 0 && !K.spend(cost)) ui.tickets = [];
      }
      ui.result = Core.simulate(ui.card, true);
      ui.replay = false;
      go("race");
      return;
    }
    if (st === "lobby" && (ui.screen === "card" || ui.screen === "result")) { go("lobby"); return; }
    if (st === "card" && ui.screen === "lobby" && ui.card) { go("card"); return; }
    if (ui.screen === "lobby" || ui.screen === "card") {
      if (roomRenderPending) return;
      roomRenderPending = true;
      setTimeout(function () { roomRenderPending = false; if (ui.screen === "lobby" || ui.screen === "card") rerenderKeep(); }, 120);
    }
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
      ui.map = { terrain: room.cfg.terrain || "", weather: room.cfg.weather || "", dist: room.cfg.dist || "" };
    }
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
            btn(t("sg_net_leave"), leaveRoom, "sg-link")
          ]),
          ui.msg ? el("p", { class: "sg-small sg-good" }, [ui.msg]) : null
        ])
      ])
    ]));
    app.appendChild(panel(t("sg_net_me"), [
      el("div", { class: "sg-row" }, [el("label", null, [t("sg_net_name") + " ", nameIn])]),
      el("div", { class: "sg-row" }, [el("label", null, [t("sg_entry") + " ", entryPicker(syncEntry)])]),
      el("p", { class: "sg-small sg-muted" }, [t("sg_net_entry_note")])
    ]));
    var list = room.list();
    app.appendChild(panel(t("sg_net_players") + "（" + list.length + "）", [
      el("ul", { class: "sg-plist" }, list.map(function (p) {
        return el("li", null, [(p.cid === room.meta.host ? "👑 " : "") + (p.name || t("sg_net_noname")) + (p.cid === room.cid ? t("sg_net_you") : ""), " — ",
          p.entry ? p.entry.name + "（" + L((D.BREED_BY_ID[p.entry.breed] || D.BREEDS[0]).name) + "）" : el("span", { class: "sg-muted" }, [t("sg_net_watch")])]);
      })),
      el("p", { class: "sg-small sg-muted" }, [t("sg_net_cpu_fill", { n: D.FIELD })])
    ]));
    var st = room.status();
    app.appendChild(panel(t("sg_class"), [
      classPicker(function () { if (host) room.setCfg(netCfg()); render(); }, !host),
      mapPicker(function () { if (host) room.setCfg(netCfg()); rerenderKeep(); }, !host),
      host ? el("div", { class: "sg-actions" }, [
        btn(t("sg_net_publish"), publishCard, "sg-btn sg-primary sg-big"),
        st === "card" && ui.card ? btn(t("sg_net_back_card"), function () { go("card"); }, "sg-btn") : null
      ]) : el("p", { class: "sg-muted" }, [st === "card" ? t("sg_net_card_open") : t("sg_net_wait_publish")]),
      !host && st === "card" && ui.card ? btn(t("sg_net_back_card"), function () { go("card"); }, "sg-btn") : null
    ]));
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
    setup: screenSetup, card: screenCard, race: screenRace, result: screenResult, lobby: screenLobby
  };

  window.addEventListener("i18n:change", function () { if (ui.screen !== "race") render(); });
  // 測試／除錯用
  window.PriTestSaigo = { ui: ui, go: go, startSolo: startSolo, startRace: startRace, enterRoom: enterRoom };

  render();
  (function () { var id = Net ? Net.roomFromUrl(location.search) : null; if (id) enterRoom(id); })();
})();
