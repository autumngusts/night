/* イヌスノー（狗雪）第 5 階段的畫面（docs/inusnow_design.md §20）：
   犬舍（等級、能力點、好感、照顧、疲勞、稱號）、商店（雪板、雙板、固定器、雪鏡、雪衣、打蠟、換裝）、
   雪場鎖與真實季節、設定畫面的溫泉與在地美食、成績的經驗與解鎖、公園編輯器。
   在 inusnow.js 之前載入，登記到 window.PriTestInusnowExt。規則在 inusnow_prog.js。 */
(function () {
  "use strict";

  (window.PriTestInusnowExt = window.PriTestInusnowExt || []).push(function (UI) {
    var D = window.PriTestInusnowData, T = window.PriTestInusnowTerrain, Core = window.PriTestInusnowCore, Prog = window.PriTestInusnowProg;
    if (!Prog) return;
    var t = UI.t, L = UI.L, esc = UI.esc, app = UI.app, S = UI.S;
    function save() { return UI.save(); }
    function date() { return UI.jstDate(); }
    function cur() { return save().dog.breed; }
    function on(act, fn, root) { var b = (root || app).querySelector('[data-act="' + act + '"]'); if (b) b.addEventListener("click", fn); }
    function onAll(sel, fn, root) { Array.prototype.forEach.call((root || app).querySelectorAll(sel), function (b) { b.addEventListener("click", function (e) { fn(b, e); }); }); }
    function gear() { var s = save(); if (!s.gear || typeof s.gear !== "object") s.gear = {}; if (!s.gear.owned) s.gear.owned = []; return s.gear; }
    function cosm() { var s = save(); if (!s.cosm || typeof s.cosm !== "object") s.cosm = { owned: [] }; if (!s.cosm.owned) s.cosm.owned = []; return s.cosm; }
    function wax() { var s = save(); if (!s.wax || typeof s.wax !== "object") s.wax = { sel: "", stock: {} }; if (!s.wax.stock) s.wax.stock = {}; return s.wax; }
    function pct(v) { var p = Math.round((v - 1) * 100); return (p > 0 ? "+" : "") + p + "%"; }

    // ---------------- 有效選手、紀錄、外觀 ----------------
    UI.hook("dog", function (resort, cond) { return Prog.effDog(save(), cur(), { resort: resort, snow: cond && cond.snow ? cond.snow : "groomed", date: date() }); });
    UI.hook("spec", function (dog) { return Prog.spec(dog); });
    UI.hook("fromSpec", function (spec, b) { return Prog.fromSpec(spec, b); });
    UI.hook("gearSuffix", function () { return gear().ski ? "/ski" : ""; });
    UI.hook("coachMul", function () { return Prog.coachMul(save(), cur()); });
    UI.hook("season", function () { return Prog.season(date()); });
    function lookOf() {
      var c = cosm(), pick = function (cat, id) { var it = Prog.findItem(D.COSMETIC[cat], id || D.COSMETIC[cat][0].id); return it.color; };
      return { ski: !!gear().ski, coat: pick("coat", c.coat), goggle: pick("goggle", c.goggle), hat: pick("hat", c.hat), boots: pick("boots", c.boots) };
    }
    UI.hook("view", function (vo) { vo.look = lookOf(); vo.fogMul = Prog.fogMul(save()); vo.dream = Prog.season(date()) === "dream"; });

    // ---------------- 雪場鎖、季節、稱號 ----------------
    UI.hook("locked", function (id) { return Prog.isUnlocked(save(), id, date()) ? null : t("inu_locked_hint"); });
    UI.hook("resortBadge", function (id) {
      var tt = (save().titles || {})[id], h = "";
      if (tt) h += '<span class="inu-title-badge' + (tt.home ? " is-home" : "") + '" title="' + esc(t("inu_title_got")) + '">👑</span>';
      if (D.ONSEN.resorts.indexOf(id) >= 0) h += '<span class="inu-onsen-badge" title="' + esc(t("inu_onsen")) + '">♨</span>';
      return h;
    });
    UI.hook("banner", function () {
      var se = Prog.season(date());
      if (se === "regular") return "";
      return '<div class="inu-season inu-season-' + se + '"><span aria-hidden="true">' + (se === "dream" ? "✨" : "🌸") + "</span><b>" + esc(t("inu_season_" + se)) + "</b><small>" + esc(t("inu_season_" + se + "_d")) + "</small></div>";
    });

    // ---------------- 設定畫面：選手狀態、溫泉、美食、公園 ----------------
    UI.hook("setupExtra", function (r, ev) {
      var b = cur(), d = Prog.dogOf(save(), b), id = r.id, food = D.FOOD.items[id], g = gear(), w = wax();
      var h = '<section class="inu-facil"><div class="inu-facil-dog">' + UI.dogFace(Core.breed(b), "is-mini") + "<b>" + esc(L(Core.breed(b).name)) + ' <small class="inu-lv">Lv' + d.lv + "</small></b>"
        + '<span class="inu-heart" title="' + esc(t("inu_aff")) + '"><i style="width:' + d.aff + '%"></i></span>'
        + (Prog.isHome(b, id) ? '<span class="inu-tag inu-tag-home">' + esc(t("inu_home")) + "</span>" : "")
        + (Prog.tired(d, date()) ? '<span class="inu-tag inu-tag-tired">' + esc(t("inu_tired")) + "</span>" : "")
        + (d.food ? '<span class="inu-tag inu-tag-food">' + esc(t("inu_food_on", { stat: t("inu_stat_" + d.food.stat) })) + "</span>" : "")
        + '<span class="inu-tag">' + esc(g.ski ? t("inu_gear_ski") : t("inu_gear_board")) + "</span>"
        + (w.sel ? '<span class="inu-tag inu-tag-wax">' + esc(t("inu_wax_on", { snow: L(D.SNOW[w.sel].name), n: w.stock[w.sel] || 0 })) + "</span>" : "") + "</div>";
      h += '<div class="inu-facil-btns">';
      if (D.ONSEN.resorts.indexOf(id) >= 0) h += '<button type="button" class="inu-facil-btn inu-onsen" data-act="onsen"><span aria-hidden="true">♨</span>' + esc(t("inu_onsen")) + "<small>" + esc(t("inu_onsen_d", { c: D.ONSEN.price })) + "</small></button>";
      if (food) h += '<button type="button" class="inu-facil-btn inu-food" data-act="food"' + (d.food ? " disabled" : "") + '><span aria-hidden="true">🍱</span>' + esc(L(food.name)) + "<small>" + esc(t("inu_food_d", { c: D.FOOD.price, stat: t("inu_stat_" + food.stat), v: D.FOOD.bonus })) + "</small></button>";
      if (ev === "slope") {
        var pk = (save().parks || {})[id];
        h += '<button type="button" class="inu-facil-btn inu-parkbtn" data-act="parked"><span aria-hidden="true">🛠</span>' + esc(t("inu_park_edit")) + "<small>" + esc(pk && pk.best ? t("inu_park_best", { v: UI.fmtScore(pk.best) }) : t("inu_park_edit_d")) + "</small></button>";
      }
      h += "</div></section>";
      return h;
    });
    UI.hook("setupBind", function (r) {
      var id = r.id;
      var act = function (kind) {
        var res = Prog.care(save(), cur(), kind, date(), id);
        if (res === "coins") { UI.toastText(t("inu_no_coins"), "is-warn"); return; }
        UI.persist();
        celebrate(kind === "onsen" ? "♨" : "🍱", t(kind === "onsen" ? "inu_onsen_done" : "inu_food_done"));
        UI.render();
      };
      on("onsen", function () { act("onsen"); });
      on("food", function () { act("food"); });
      on("parked", function () { openPark(id); });
    });

    // 小型的慶祝彈出（經驗、升級、解鎖、照顧）
    function celebrate(icon, title, lines) {
      var el = document.createElement("div");
      el.className = "inu-award";
      el.innerHTML = '<div class="inu-award-card"><span class="inu-award-ico" aria-hidden="true">' + icon + "</span><b>" + esc(title) + "</b>" + (lines || []).map(function (x) { return "<p>" + esc(x) + "</p>"; }).join("") + "</div>";
      document.body.appendChild(el);
      el.addEventListener("click", function () { el.remove(); });
      setTimeout(function () { el.classList.add("is-out"); setTimeout(function () { el.remove(); }, 500); }, 2600 + (lines ? lines.length * 500 : 0));
    }

    // ---------------- 成績：經驗、好感、疲勞、解鎖、稱號 ----------------
    function placeOf(r) {
      if (r.kind === "cross") return r.cross.riders[0].place;
      if (r.mode !== "race" || !r.cpus) return 0;          // 名次經驗只算比賽模式（教練模式不算，設計 §20.1）
      if (r.kind === "gs") {
        if (r.run.status !== "finish") return 0;
        return 1 + r.cpus.filter(function (c) { return c.time !== null && c.time < r.run.time; }).length;
      }
      if (r.kind === "slope") return 1 + r.cpus.filter(function (c) { return c.score > (r.run.final || 0); }).length;
      return 0;
    }
    UI.hook("award", function (r) {
      if (r.kind === "watch" || !r.dog || (r.kind === "room" && !r.mine)) return;
      var o = { finished: false, place: 0, tricks360: 0, stamps: 0, mission: false };
      if (r.kind === "gs") o.finished = r.run.status === "finish";
      else if (r.kind === "slope") { o.finished = r.run.status !== "dsq"; o.tricks360 = r.run.tricks.filter(function (x) { return !x.rail && x.spin >= 360 && x.E > 0; }).length; }
      else if (r.kind === "cross") o.finished = !r.cross.riders[0].dnf;
      else if (r.kind === "free") o.stamps = r.run.newGot ? r.run.newGot.stamps : 0;
      else if (r.kind === "rescue") { o.finished = r.run.found > 0; o.mission = true; }
      else if (r.kind === "avalanche") { o.finished = true; o.mission = true; }
      else if (r.kind === "relay") o.finished = Relay() ? Relay().legInfo(r.leg).ok : true;
      else if (r.kind === "room") o.finished = !!(r.mine && Room() && Room().result(r.card, r.mine).ok);
      o.place = placeOf(r);
      var b = r.dog.id || cur(), s = save(), lines = [];
      var exp = Prog.expFor(o);
      var up = exp ? Prog.addExp(s, b, exp) : 0;
      // 房間比賽用犬種本身的數值（大家公平），不消耗蠟與美食、不算疲勞
      if (r.kind !== "free" && r.kind !== "room") Prog.afterRace(s, b, date(), !!(r.dog.gear && r.dog.gear.mu));
      var podium = r.mode === "race" && o.place >= 1 && o.place <= 3 && Prog.isUnlocked(s, r.resort, null);
      var unl = Prog.checkUnlock(s, podium);
      var title = false;
      if (r.kind === "free" && r.world) title = Prog.stampTitle(s, r.resort, r.run.got.stamps.length, r.world.pistes.length, b);
      if (r.kind === "slope" && r.opts.park && r.run.status !== "dsq") {
        s.parks = s.parks || {};
        var pk = s.parks[r.resort] = s.parks[r.resort] || {};
        if (!pk.best || r.run.final > pk.best) pk.best = r.run.final;
      }
      UI.persist();
      if (exp) lines.push(t("inu_exp_gain", { n: exp }));
      if (up) lines.push(t("inu_lv_up", { lv: Prog.dogOf(s, b).lv, p: up * D.PROG.pts }));
      unl.forEach(function (id) { var ri = UI.resortInfo(id); lines.push(t("inu_unlocked", { name: ri ? L(ri.name) : id })); });
      if (title) lines.push(t("inu_title_new"));
      if (lines.length) setTimeout(function () { celebrate(up ? "⭐" : unl.length ? "🔓" : "🐾", up ? t("inu_lv_up_t") : t("inu_reward"), lines); }, 900);
    });
    function Relay() { return window.PriTestInusnowRelay; }
    function Room() { return window.PriTestInusnowRoom; }

    // ======================= 犬舍（§20.1、§20.4） =======================
    function statRow(b, d, k) {
      var base = Core.breed(b).stats[k], add = d.add[k], cap = Prog.capOf(b, k);
      var can = d.pts > 0 && base + add < cap;
      return '<div class="inu-kstat"><em>' + esc(t("inu_stat_" + k)) + '</em><span class="inu-kbar"><i style="width:' + base + '%"></i><b style="left:' + base + "%;width:" + add + '%"></b><u style="left:' + cap + '%"></u></span>'
        + "<strong>" + (base + add) + (add ? "<small>+" + add + "</small>" : "") + "</strong>"
        + '<button type="button" class="inu-kplus" data-stat="' + k + '"' + (can ? "" : " disabled") + ' aria-label="+">＋</button></div>';
    }
    function renderKennel(el) {
      var s = save(), b = cur(), d = Prog.dogOf(s, b), br = Core.breed(b), nd = Prog.need(d.lv);
      var tired = Prog.tired(d, date());
      var h = '<section class="inu-kennel"><div class="inu-kcard"><div class="inu-kface">' + UI.dogFace(br) + '<span class="inu-klv">Lv<b>' + d.lv + "</b></span></div>"
        + '<div class="inu-kinfo"><h2 class="inu-h2">' + esc(s.dog.name || L(br.name)) + " <small>" + esc(L(br.name)) + "</small></h2>"
        + '<div class="inu-expbar"><i style="width:' + Math.min(100, d.exp / nd * 100).toFixed(1) + '%"></i><span>' + esc(t("inu_exp_bar", { e: d.exp, n: nd })) + "</span></div>"
        + '<p class="inu-kpts' + (d.pts ? " is-on" : "") + '">' + esc(t("inu_points_left", { n: d.pts })) + "</p>"
        + '<div class="inu-kaff"><span aria-hidden="true">❤</span><span class="inu-heart"><i style="width:' + d.aff + '%"></i></span><b>' + d.aff + "</b></div>"
        + '<p class="inu-kstate">' + (tired ? '<span class="inu-tag inu-tag-tired">' + esc(t("inu_tired")) + "</span>" : '<span class="inu-tag">' + esc(t("inu_races_today", { n: d.raceDay === date() ? d.races : 0, max: D.FATIGUE.races })) + "</span>")
        + (d.food ? '<span class="inu-tag inu-tag-food">' + esc(t("inu_food_on", { stat: t("inu_stat_" + d.food.stat) })) + "</span>" : "") + "</p></div></div>";
      h += '<div class="inu-kstats">' + Prog.STATS.map(function (k) { return statRow(b, d, k); }).join("") + "</div>";
      h += '<div class="inu-actions"><button type="button" class="inu-secondary" data-act="groom"' + (d.groom === date() ? " disabled" : "") + ">🪮 " + esc(t("inu_groom")) + '</button><button type="button" class="inu-secondary" data-act="feed">🦴 ' + esc(t("inu_feed", { c: D.AFF.feed })) + "</button></div>";
      h += '<p class="inu-help inu-help-tight">' + esc(t("inu_aff_help")) + "</p></section>";
      // 其他犬種
      h += '<h3 class="inu-h3">' + esc(t("inu_kennel_dogs")) + '</h3><div class="inu-kdogs">' + D.BREEDS.map(function (x) {
        var dx = (s.dogs || {})[x.id];
        return '<button type="button" class="inu-kdog' + (x.id === b ? " is-on" : "") + '" data-kdog="' + x.id + '">' + UI.dogFace(x, "is-mini") + "<span>" + esc(L(x.name)) + "</span><b>Lv" + (dx ? dx.lv : 1) + "</b></button>";
      }).join("") + "</div>";
      // 稱號與解鎖
      var titles = s.titles || {}, un = Prog.unlockedList(s, date());
      h += '<h3 class="inu-h3">' + esc(t("inu_titles")) + '</h3><div class="inu-titles">' + D.RESORTS.map(function (id) {
        var ri = UI.resortInfo(id), tt = titles[id];
        return '<span class="inu-titlecard' + (tt ? " is-on" : "") + (tt && tt.home ? " is-home" : "") + (un.indexOf(id) < 0 ? " is-locked" : "") + '"><i aria-hidden="true">' + (tt ? "👑" : un.indexOf(id) < 0 ? "🔒" : "◇") + "</i>" + esc(ri ? L(ri.name) : id) + (tt && tt.home ? "<small>" + esc(t("inu_title_home")) + "</small>" : "") + "</span>";
      }).join("") + '</div><p class="inu-help inu-help-tight">' + esc(t("inu_titles_help")) + "</p>";
      el.innerHTML = h;
      onAll("[data-stat]", function (btn) { if (Prog.allocate(save(), cur(), btn.getAttribute("data-stat"))) { UI.persist(); renderKennel(el); } }, el);
      onAll("[data-kdog]", function (btn) { save().dog.breed = btn.getAttribute("data-kdog"); UI.persist(); renderKennel(el); }, el);
      var care = function (kind) {
        var res = Prog.care(save(), cur(), kind, date(), null);
        if (res === "coins") { UI.toastText(t("inu_no_coins"), "is-warn"); return; }
        UI.persist(); celebrate("💗", t("inu_care_done", { n: D.AFF.care })); renderKennel(el);
      };
      on("groom", function () { care("groom"); }, el);
      on("feed", function () { care("feed"); }, el);
    }
    UI.tab({ id: "kennel", icon: "🐕", label: "inu_tab_kennel", render: renderKennel });

    // ======================= 商店（§20.2、§20.3、§20.6） =======================
    function effText(it) {
      var p = [];
      if (it.turn) p.push(t("inu_eff_turn") + pct(it.turn));
      if (it.drag) p.push(t("inu_eff_drag") + pct(it.drag));
      if (it.spin) p.push(t("inu_eff_spin") + pct(it.spin));
      if (it.grip) p.push(t("inu_eff_grip") + pct(it.grip));
      if (it.fog && it.fog !== 1) p.push(t("inu_eff_fog", { v: it.fog }));
      if (it.cld) p.push(t("inu_eff_cld", { v: it.cld }));
      return p.join("・") || t("inu_eff_none");
    }
    function shopCard(cat, it, ownedList, equipped, extra) {
      var own = it.price === 0 || ownedList.indexOf(cat + ":" + it.id) >= 0;
      var col = it.color !== undefined ? '<i class="inu-swatch" style="background:' + (it.color || "transparent") + '"></i>' : "";
      return '<div class="inu-shopitem' + (equipped ? " is-eq" : "") + '">' + col + '<span class="inu-shopname">' + esc(it.name ? L(it.name) : t("inu_cos_" + cat.slice(1) + "_" + it.id)) + "<small>" + esc(extra || "") + "</small></span>"
        + (equipped ? '<span class="inu-shopeq">' + esc(t("inu_equipped")) + "</span>"
          : own ? '<button type="button" class="inu-chip inu-chip-light" data-equip="' + cat + ":" + it.id + '">' + esc(t("inu_equip")) + "</button>"
            : '<button type="button" class="inu-shopbuy" data-buy="' + cat + ":" + it.id + '"' + (save().coins >= it.price ? "" : " disabled") + '><i aria-hidden="true"></i>' + it.price + "</button>") + "</div>";
    }
    function renderShop(el) {
      var s = save(), g = gear(), c = cosm(), w = wax();
      var h = '<section class="inu-shophead"><div class="inu-bethead-coins"><i aria-hidden="true"></i><b>' + s.coins + "</b><small>" + esc(t("inu_coins")) + "</small></div>"
        + '<div class="inu-seg">' + [["board", t("inu_gear_board")], ["ski", t("inu_gear_ski")]].map(function (x) {
          var onSki = x[0] === "ski", is = !!g.ski === onSki;
          return '<button type="button" data-kind="' + x[0] + '" class="' + (is ? "is-on" : "") + '">' + esc(x[1]) + "</button>";
        }).join("") + '</div><p class="inu-help inu-help-tight">' + esc(t("inu_ski_help")) + "</p></section>";
      var sec = function (title, cat, list, eqId, extraFn) {
        return '<h3 class="inu-h3">' + esc(title) + '</h3><div class="inu-shopgrid">' + list.map(function (it) { return shopCard(cat, it, g.owned, eqId === it.id, extraFn ? extraFn(it) : effText(it)); }).join("") + "</div>";
      };
      h += sec(t("inu_shop_board"), "board", D.GEAR.board, g.board || "std");
      h += sec(t("inu_shop_ski"), "ski", D.GEAR.ski, g.ski ? g.skiId || "" : "__", function (it) { return effText(it) + "・" + t("inu_ski_eff"); });
      h += sec(t("inu_shop_bind"), "bind", D.GEAR.bind, g.bind || "b0");
      h += sec(t("inu_shop_goggle"), "goggle", D.GEAR.goggle, g.goggle || "g0");
      h += sec(t("inu_shop_jacket"), "jacket", D.GEAR.jacket, g.jacket || "j0");
      // 打蠟
      h += '<h3 class="inu-h3">' + esc(t("inu_shop_wax")) + ' <small>' + esc(t("inu_wax_help")) + '</small></h3><div class="inu-shopgrid">' + D.WAX.kinds.map(function (k) {
        var sel = w.sel === k;
        return '<div class="inu-shopitem inu-waxitem' + (sel ? " is-eq" : "") + '"><i class="inu-wax inu-wax-' + k + '" aria-hidden="true"></i><span class="inu-shopname">' + esc(t("inu_wax_name", { snow: L(D.SNOW[k].name) })) + "<small>" + esc(t("inu_wax_stock", { n: w.stock[k] || 0 })) + "</small></span>"
          + '<button type="button" class="inu-shopbuy" data-wax="' + k + '"' + (s.coins >= D.WAX.price ? "" : " disabled") + '><i aria-hidden="true"></i>' + D.WAX.price + "</button>"
          + '<button type="button" class="inu-chip inu-chip-light" data-waxsel="' + k + '">' + esc(sel ? t("inu_wax_off") : t("inu_wax_use")) + "</button></div>";
      }).join("") + "</div>";
      // 換裝
      ["coat", "goggle", "hat", "boots"].forEach(function (cat) {
        h += '<h3 class="inu-h3">' + esc(t("inu_cos_" + cat)) + '</h3><div class="inu-shopgrid">' + D.COSMETIC[cat].map(function (it) { return shopCard("c" + cat, it, c.owned, (c[cat] || D.COSMETIC[cat][0].id) === it.id, t("inu_cos_note")); }).join("") + "</div>";
      });
      el.innerHTML = h;
      onAll("[data-kind]", function (b) {
        var want = b.getAttribute("data-kind") === "ski";
        if (want && !(g.owned.some(function (x) { return x.indexOf("ski:") === 0; }))) { UI.toastText(t("inu_ski_need"), "is-warn"); return; }
        g.ski = want; if (want && !g.skiId) g.skiId = g.owned.filter(function (x) { return x.indexOf("ski:") === 0; })[0].slice(4);
        UI.persist(); renderShop(el);
      }, el);
      onAll("[data-buy]", function (b) {
        var p = b.getAttribute("data-buy").split(":"), cat = p[0], id = p[1];
        var list = cat.charAt(0) === "c" && D.COSMETIC[cat.slice(1)] ? D.COSMETIC[cat.slice(1)] : D.GEAR[cat], it = Prog.findItem(list, id);
        if (s.coins < it.price) return;
        s.coins -= it.price;
        (cat.charAt(0) === "c" && D.COSMETIC[cat.slice(1)] ? c.owned : g.owned).push(cat + ":" + id);
        equip(cat, id);
        UI.persist(); celebrate("🛍", t("inu_bought_item", { name: it.name ? L(it.name) : t("inu_cos_" + cat.slice(1) + "_" + id) })); renderShop(el);
      }, el);
      onAll("[data-equip]", function (b) { var p = b.getAttribute("data-equip").split(":"); equip(p[0], p[1]); UI.persist(); renderShop(el); }, el);
      onAll("[data-wax]", function (b) { var k = b.getAttribute("data-wax"); if (s.coins < D.WAX.price) return; s.coins -= D.WAX.price; w.stock[k] = (w.stock[k] || 0) + 1; if (!w.sel) w.sel = k; UI.persist(); renderShop(el); }, el);
      onAll("[data-waxsel]", function (b) { var k = b.getAttribute("data-waxsel"); w.sel = w.sel === k ? "" : k; UI.persist(); renderShop(el); }, el);
      function equip(cat, id) {
        if (cat === "ski") { g.skiId = id; g.ski = true; }
        else if (cat === "board") { g.board = id; g.ski = false; }
        else if (cat.charAt(0) === "c" && D.COSMETIC[cat.slice(1)]) c[cat.slice(1)] = id;
        else g[cat] = id;
      }
    }
    UI.tab({ id: "shop", icon: "🛒", label: "inu_tab_shop", render: renderShop });

    // ======================= M7 公園編輯器（§20.7） =======================
    var PE = null;
    function defaultPark(len) {
      var kinds = ["box", "kickerS", "rail", "kickerM", "roller", "kickerL"], out = [], s = 60, maxS = len - D.GATES.finishMargin - D.SLOPE.finishAfter - D.SLOPE.rail.len;
      for (var i = 0; i < kinds.length && s <= maxS; i++) { out.push({ kind: kinds[i], s: s, lat: 0 }); s += 60; }
      return out;
    }
    function openPark(resort, list) {
      var info = UI.resortInfo(resort);
      if (!info || !info.slope) return;
      var pk = (save().parks || {})[resort];
      PE = { resort: resort, piste: info.slope.piste, len: info.slope.len, list: (list || (pk && pk.list) || defaultPark(info.slope.len)).map(function (x) { return { kind: x.kind, s: x.s, lat: x.lat }; }) };
      UI.stopLoop();
      S.screen = "park";
      renderPark();
    }
    function renderPark() {
      if (!PE || S.screen !== "park") return;
      var info = UI.resortInfo(PE.resort), err = Prog.validatePark(PE.list, PE.len), P2 = D.PARKED;
      var maxS = Math.floor((PE.len - D.GATES.finishMargin - D.SLOPE.finishAfter - D.SLOPE.rail.len) / P2.step) * P2.step;
      var y = app.querySelector(".inu-page") ? app.querySelector(".inu-page").scrollTop : 0;
      var h = '<div class="inu-page inu-parkpage"><button type="button" class="inu-link" data-act="back">← ' + esc(t("inu_back")) + "</button>"
        + '<h2 class="inu-h2">🛠 ' + esc(t("inu_park_edit")) + "　<small>" + esc(L(info.name) + "・" + (L(info.slope.name) || "")) + "</small></h2>";
      // 俯視圖：雪道往下（左→右），地形的位置與側向
      h += '<svg class="inu-parkmap" viewBox="0 0 400 90" aria-hidden="true"><rect x="0" y="20" width="400" height="50" rx="10" class="inu-parkmap-piste"/>'
        + PE.list.map(function (x) {
          var px = 8 + (x.s / PE.len) * 384, py = 45 + x.lat * 2.2, k = x.kind;
          var shape = k.indexOf("kicker") === 0 ? '<path d="M' + (px - 7) + " " + (py + 6) + " L" + (px + 7) + " " + (py + 6) + " L" + (px + 7) + " " + (py - 6) + ' Z" class="inu-pm-kicker"/>'
            : k === "roller" ? '<path d="M' + (px - 10) + " " + py + " q5 -8 10 0 t10 0" + '" class="inu-pm-roller"/>'
              : '<rect x="' + (px - 2) + '" y="' + (py - 3) + '" width="' + (k === "box" ? 14 : 18) + '" height="' + (k === "box" ? 6 : 3) + '" class="inu-pm-rail"/>';
          return shape;
        }).join("") + '<text x="6" y="14" class="inu-pm-t">START</text><text x="394" y="14" text-anchor="end" class="inu-pm-t">FINISH</text></svg>';
      h += '<ol class="inu-parklist">' + PE.list.map(function (x, i) {
        return '<li><span class="inu-pk-no">' + (i + 1) + '</span><select data-pk="kind" data-i="' + i + '">' + P2.kinds.map(function (k) { return '<option value="' + k + '"' + (k === x.kind ? " selected" : "") + ">" + esc(t("inu_feat_" + k)) + "</option>"; }).join("") + "</select>"
          + '<label class="inu-pk-f"><span>' + esc(t("inu_park_pos")) + '</span><input type="number" data-pk="s" data-i="' + i + '" min="' + P2.gap + '" max="' + maxS + '" step="' + P2.step + '" value="' + x.s + '"></label>'
          + '<label class="inu-pk-f"><span>' + esc(t("inu_park_lat")) + '</span><input type="range" data-pk="lat" data-i="' + i + '" min="-' + P2.lat + '" max="' + P2.lat + '" step="1" value="' + x.lat + '"><b>' + x.lat + "</b></label>"
          + '<button type="button" class="inu-chip inu-chip-light" data-pkdel="' + i + '"' + (PE.list.length <= P2.min ? " disabled" : "") + ">✕</button></li>";
      }).join("") + "</ol>";
      h += '<div class="inu-actions"><button type="button" class="inu-secondary" data-act="add"' + (PE.list.length >= P2.max ? " disabled" : "") + ">＋ " + esc(t("inu_park_add")) + "</button></div>";
      h += '<p class="inu-msg' + (err ? "" : " is-ok") + '">' + esc(err ? t("inu_park_err_" + err, { min: P2.min, max: P2.max, gap: P2.gap, lat: P2.lat }) : t("inu_park_ok")) + "</p>";
      h += '<div class="inu-actions"><button type="button" class="inu-primary inu-go" data-act="ride"' + (err ? " disabled" : "") + ">" + esc(t("inu_park_ride")) + '</button><button type="button" class="inu-secondary" data-act="share"' + (err ? " disabled" : "") + ">" + esc(t("inu_park_share")) + '</button><button type="button" class="inu-secondary" data-act="import">' + esc(t("inu_park_import")) + "</button></div>";
      h += '<p class="inu-help">' + esc(t("inu_park_help", { min: P2.min, max: P2.max, step: P2.step, lat: P2.lat, gap: P2.gap })) + "</p></div>";
      app.innerHTML = h;
      var pg = app.querySelector(".inu-page"); if (pg) pg.scrollTop = y;
      Array.prototype.forEach.call(app.querySelectorAll("[data-pk]"), function (inp) {
        var ev = inp.getAttribute("data-pk") === "lat" ? "input" : "change";
        inp.addEventListener(ev, function () {
          var i = +inp.getAttribute("data-i"), k = inp.getAttribute("data-pk");
          PE.list[i][k] = k === "kind" ? inp.value : Math.round(+inp.value);
          storePark(); renderPark();
        });
      });
      onAll("[data-pkdel]", function (b) { PE.list.splice(+b.getAttribute("data-pkdel"), 1); storePark(); renderPark(); });
      on("add", function () {
        var last = PE.list.reduce(function (a, x) { return x.s > a ? x.s : a; }, 0);
        PE.list.push({ kind: "kickerS", s: Math.min(maxS, last + P2.gap + 10), lat: 0 }); storePark(); renderPark();
      });
      on("back", function () { PE = null; S.screen = "setup"; UI.render(); });
      on("ride", function () { storePark(); UI.startRace(PE.resort, { event: "slope", mode: "practice", runs: 1, park: PE.list.map(function (x) { return { kind: x.kind, s: x.s, lat: x.lat }; }) }); });
      on("share", function () {
        var code = Prog.parkCode(PE.resort, PE.piste, PE.list), b = app.querySelector('[data-act="share"]');
        var done = function () { if (b) b.textContent = t("inu_share_done"); };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(code).then(done, function () { window.prompt(t("inu_park_share"), code); });
        else window.prompt(t("inu_park_share"), code);
      });
      on("import", function () {
        var raw = window.prompt(t("inu_park_import"));
        if (raw === null) return;
        var p = Prog.parseParkCode(raw);
        if (!p || p.resort !== PE.resort || p.piste !== PE.piste) { UI.toastText(t("inu_park_bad"), "is-warn"); return; }
        PE.list = p.list; storePark(); renderPark();
      });
    }
    function storePark() {
      var s = save();
      s.parks = s.parks || {};
      var pk = s.parks[PE.resort] = s.parks[PE.resort] || {};
      var code = JSON.stringify(PE.list);
      if (pk.code !== code) { pk.code = code; pk.best = 0; }
      pk.list = PE.list.map(function (x) { return { kind: x.kind, s: x.s, lat: x.lat }; });
      UI.persist();
    }
    UI.screen("park", renderPark);

    window.PriTestInusnowP5 = { openPark: openPark, pe: function () { return PE; }, celebrate: celebrate };
  });
})();
