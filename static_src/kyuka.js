// 九華（kyuka）：試作畫面（招募、收藏、角色詳細、說明）與本機存檔。
// 規則全部交給 kyuka_core.js，花紋交給 kyuka_crest.js。這是 RMD 正式實作前的試作，抽卡、親密度、升級都免費、可以重複測試。
(function () {
  "use strict";

  var D = window.PriTestKyukaData, Core = window.PriTestKyukaCore, Crest = window.PriTestKyukaCrest;
  var app = document.getElementById("ky-app");
  if (!D || !Core || !Crest || !app) return;

  var SAVE_KEY = "pritest-kyuka-save-v1";
  var IMG = app.getAttribute("data-img") || "../static/images/jikan/";
  var rng = Core.makeRng();

  function t(k, p) { return window.I18N ? window.I18N.t(k, p) : k; }
  function lang() { return (window.I18N && window.I18N.getLang && window.I18N.getLang()) || "zh"; }
  function L(o) { return o ? (o[lang()] || o.zh || "") : ""; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function load() { try { var s = localStorage.getItem(SAVE_KEY); return s ? JSON.parse(s) : null; } catch (e) { return null; } }
  function persist() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) {} }

  var save = load();
  if (!save || save.v !== 1 || !save.items) save = { v: 1, seq: 1, items: [] };

  var ui = { tab: "gacha", last: [], filter: "all", sort: "rarity", detail: null, log: "", confirmRelease: false };

  function hero(inst) { return D.HERO_BY_ID[inst.heroId]; }
  function find(uid) { for (var i = 0; i < save.items.length; i++) if (save.items[i].uid === uid) return save.items[i]; return null; }
  function rIdx(r) { return D.RARITIES.indexOf(r); }

  // ---------------- 卡片 ----------------
  function cardHTML(inst, i) {
    var h = hero(inst), ty = Core.type81(inst.v);
    return '<button type="button" class="ky-card ky-r-' + inst.rarity + '" data-act="detail" data-uid="' + inst.uid + '"' +
      (i != null ? ' style="animation-delay:' + (i * 90) + 'ms"' : "") + ">" +
      '<span class="ky-card-img"><img src="' + IMG + h.img + '.webp" alt="" loading="lazy" draggable="false">' +
      '<span class="ky-card-crest">' + Crest.forInstance(inst, { size: 64, mini: true }) + "</span></span>" +
      '<span class="ky-rar">' + inst.rarity + "</span>" +
      '<span class="ky-card-name">' + esc(L(h.name)) + '</span><span class="ky-card-type">' + esc(ty.name) + "</span>" +
      '<span class="ky-card-lv">Lv' + inst.level + " · ♥" + inst.affection + "</span></button>";
  }

  // ---------------- 招募 ----------------
  function gachaHTML() {
    var rates = D.RARITIES.map(function (r) { return '<span class="ky-rate ky-r-' + r + '"><b>' + r + "</b> " + D.RARITY[r].rate + "%</span>"; }).join("");
    var res = ui.last.length
      ? '<div class="ky-grid ky-grid-pull">' + ui.last.map(function (uid, i) { var x = find(uid); return x ? cardHTML(x, i) : ""; }).join("") + "</div>"
      : '<p class="ky-empty">' + esc(t("ky_gacha_empty")) + "</p>";
    return '<section class="ky-banner"><div class="ky-banner-title">' + esc(t("ky_title")) + '</div><p class="ky-muted">' + esc(t("ky_gacha_lede")) + '</p>' +
      '<div class="ky-rates">' + rates + "</div>" +
      '<div class="ky-pull-btns"><button type="button" class="ky-btn" data-act="pull1">' + esc(t("ky_pull1")) + '</button>' +
      '<button type="button" class="ky-btn ky-btn-main" data-act="pull10">' + esc(t("ky_pull10")) + "</button></div>" +
      '<p class="ky-small ky-muted">' + esc(t("ky_pull10_note")) + "</p></section>" + res;
  }

  function doPull(n) {
    var got = n === 10 ? Core.pull10(rng, save.seq) : [Core.pull(rng, null, save.seq)];
    save.seq += got.length;
    got.forEach(function (x) { save.items.push(x); });
    ui.last = got.map(function (x) { return x.uid; });
    persist();
  }

  // ---------------- 收藏 ----------------
  function collectionHTML() {
    var filters = ["all"].concat(D.RARITIES).map(function (r) {
      return '<button type="button" class="ky-chip' + (ui.filter === r ? " ky-on" : "") + '" data-act="filter" data-v="' + r + '">' + (r === "all" ? esc(t("ky_all")) : r) + "</button>";
    }).join("");
    var sorts = ["rarity", "level", "new"].map(function (s) {
      return '<button type="button" class="ky-chip' + (ui.sort === s ? " ky-on" : "") + '" data-act="sort" data-v="' + s + '">' + esc(t("ky_sort_" + s)) + "</button>";
    }).join("");
    var list = save.items.filter(function (x) { return ui.filter === "all" || x.rarity === ui.filter; });
    var order = save.items.slice();
    list.sort(function (a, b) {
      if (ui.sort === "level") return b.level - a.level || rIdx(b.rarity) - rIdx(a.rarity);
      if (ui.sort === "new") return order.indexOf(b) - order.indexOf(a);
      return rIdx(b.rarity) - rIdx(a.rarity) || b.level - a.level;
    });
    var counts = D.RARITIES.map(function (r) { return r + " " + save.items.filter(function (x) { return x.rarity === r; }).length; }).join(" · ");
    return '<div class="ky-bar"><div class="ky-chips">' + filters + '</div><div class="ky-chips">' + sorts + "</div></div>" +
      '<p class="ky-small ky-muted">' + esc(t("ky_count", { n: save.items.length })) + "（" + counts + "）</p>" +
      (list.length ? '<div class="ky-grid">' + list.map(function (x) { return cardHTML(x); }).join("") + "</div>" : '<p class="ky-empty">' + esc(t("ky_coll_empty")) + "</p>") +
      (save.items.length ? '<div class="ky-center"><button type="button" class="ky-link' + (ui.confirmReset ? " ky-danger" : "") + '" data-act="reset">' + esc(t(ui.confirmReset ? "ky_reset_confirm" : "ky_reset")) + "</button></div>" : "");
  }

  // ---------------- 角色詳細 ----------------
  function detailHTML(inst) {
    var h = hero(inst), ty = Core.type81(inst.v), next = Core.nextUnlock(inst);
    var groups = D.GROUPS.map(function (g, gi) {
      var vis = Core.visibleGroups(inst).indexOf(gi) >= 0;
      var rows = g.keys.map(function (k) {
        var val = inst.v[k], gr = Core.grade(val), title = D.TITLES[k] ? D.TITLES[k][gr] : "";
        return '<div class="ky-stat"><span class="ky-stat-k">' + k + "</span>" +
          (vis ? '<span class="ky-stat-bar"><i style="width:' + val + '%;background:var(--ky-g' + gi + ')"></i></span><span class="ky-stat-v">' + val + '</span><span class="ky-stat-g">' + gr + (title ? "・" + esc(title) : "") + "</span>"
               : '<span class="ky-stat-bar ky-locked"></span><span class="ky-stat-v">？</span><span class="ky-stat-g"></span>') + "</div>";
      }).join("");
      var lockNote = vis ? "" : '<span class="ky-lock-note">' + esc(t("ky_locked_at", { n: unlockAtFor(inst, gi) })) + "</span>";
      return '<div class="ky-group"><div class="ky-group-head"><i class="ky-sw" style="background:var(--ky-g' + gi + ')"></i>' + g.id + lockNote + "</div>" + rows + "</div>";
    }).join("");
    var marks = D.UNLOCK_AT.map(function (m) { return '<i class="ky-aff-mark" style="left:' + m + '%"></i>'; }).join("");
    var tags = D.TAGS.map(function (tg) { return '<span class="ky-tag"><b>' + esc(L(tg.name)) + "</b>" + esc(Core.tag(inst, tg.id)) + "</span>"; }).join("");
    var release = ui.confirmRelease
      ? '<div class="ky-confirm">' + esc(t("ky_release_confirm")) + '<button type="button" class="ky-btn ky-btn-danger" data-act="release-yes">' + esc(t("ky_release")) + '</button><button type="button" class="ky-btn" data-act="release-no">' + esc(t("ky_cancel")) + "</button></div>"
      : '<button type="button" class="ky-link" data-act="release">' + esc(t("ky_release")) + "</button>";
    return '<div class="ky-detail">' +
      '<div class="ky-detail-head"><span class="ky-face ky-r-' + inst.rarity + '"><img src="' + IMG + h.img + '.webp" alt=""></span>' +
      '<div><div class="ky-detail-name">' + esc(L(h.name)) + ' <span class="ky-rar-inline ky-r-' + inst.rarity + '">' + inst.rarity + '</span></div><div class="ky-small ky-muted">' + esc(L(h.title)) + "</div></div></div>" +
      '<div class="ky-detail-crest">' + Crest.forInstance(inst, { size: 280, labels: true, values: true, label: L(h.name) }) + "</div>" +
      '<div class="ky-type"><span class="ky-type-name">' + esc(ty.name) + '</span><span class="ky-small ky-muted">' +
      esc(ty.pure ? t("ky_type_pure", { main: ty.main }) : t("ky_type_ms", { main: ty.main, sub: ty.sub })) + "</span></div>" +
      '<div class="ky-groups">' + groups + "</div>" +
      '<div class="ky-row"><div class="ky-row-head"><b>' + esc(t("ky_affection")) + '</b><span>♥ ' + inst.affection + " / 100" +
      (next != null ? "　" + esc(t("ky_next_unlock", { n: next })) : "　" + esc(t("ky_all_open"))) + '</span></div>' +
      '<div class="ky-aff"><i class="ky-aff-fill" style="width:' + inst.affection + '%"></i>' + marks + "</div>" +
      '<div class="ky-btns"><button type="button" class="ky-btn" data-act="aff" data-d="-11">♥ −11</button><button type="button" class="ky-btn ky-btn-main" data-act="aff" data-d="11">♥ +11</button></div></div>' +
      '<div class="ky-row"><div class="ky-row-head"><b>' + esc(t("ky_level")) + "</b><span>Lv " + inst.level + " / " + D.MAX_LEVEL + "　" + esc(t("ky_growth_rate", { p: Math.round(D.RARITY[inst.rarity].growth * 100) })) + "</span></div>" +
      '<div class="ky-btns"><button type="button" class="ky-btn" data-act="lv1"' + (inst.level >= D.MAX_LEVEL ? " disabled" : "") + ">" + esc(t("ky_lv_up")) + '</button><button type="button" class="ky-btn" data-act="lvmax"' + (inst.level >= D.MAX_LEVEL ? " disabled" : "") + ">" + esc(t("ky_lv_max")) + "</button></div>" +
      (ui.log ? '<p class="ky-small ky-log">' + esc(ui.log) + "</p>" : "") + "</div>" +
      '<div class="ky-row"><div class="ky-row-head"><b>' + esc(t("ky_skill")) + '</b></div><p class="ky-small">' + esc(L(h.skill)) + "</p></div>" +
      '<div class="ky-row"><div class="ky-row-head"><b>' + esc(t("ky_tags")) + '</b></div><div class="ky-tags">' + tags + '</div><p class="ky-small ky-muted">' + esc(t("ky_tags_note")) + "</p></div>" +
      '<div class="ky-detail-foot">' + release + '<button type="button" class="ky-btn" data-act="close">' + esc(t("ky_close")) + "</button></div></div>";
  }
  // 某一華會在親密度多少解鎖
  function unlockAtFor(inst, gi) {
    var pos = inst.order.indexOf(gi), base = D.RARITY[inst.rarity].visible;
    return D.UNLOCK_AT[pos - base] != null ? D.UNLOCK_AT[pos - base] : "—";
  }

  // ---------------- 說明 ----------------
  function rulesHTML() {
    var items = ["ky_rule_1", "ky_rule_2", "ky_rule_3", "ky_rule_4", "ky_rule_5", "ky_rule_6"].map(function (k) { return "<li>" + esc(t(k)) + "</li>"; }).join("");
    var table = '<div class="ky-t81"><table><thead><tr><th>' + esc(t("ky_main_sub")) + "</th>" + D.ORDER.map(function (k) { return "<th>" + k + "</th>"; }).join("") + "</tr></thead><tbody>" +
      D.ORDER.map(function (m) {
        return "<tr><th>" + m + "</th>" + D.TYPE81[m].map(function (nm, i) { return '<td class="' + (D.ORDER[i] === m ? "ky-pure" : "") + '">' + esc(nm) + "</td>"; }).join("") + "</tr>";
      }).join("") + "</tbody></table></div>";
    var sample = Crest.render({ v: { 美: 92, 瑟: 30, 聲: 78, 柔: 55, 速: 40, 剛: 22, 心: 70, 智: 60, 緣: 48 }, hidden: { 柔: 1, 速: 1, 剛: 1 } }, { size: 220, labels: true, label: t("ky_sample") });
    return '<div class="ky-rules"><div class="ky-rules-crest">' + sample + '<p class="ky-small ky-muted">' + esc(t("ky_sample_note")) + "</p></div><ol>" + items + "</ol></div>" + table;
  }

  // ---------------- 外框 ----------------
  function render() {
    var tabs = [["gacha", t("ky_tab_gacha")], ["coll", t("ky_tab_coll", { n: save.items.length })], ["rules", t("ky_tab_rules")]].map(function (x) {
      return '<button type="button" class="ky-tab' + (ui.tab === x[0] ? " ky-on" : "") + '" data-act="tab" data-v="' + x[0] + '">' + esc(x[1]) + "</button>";
    }).join("");
    var body = ui.tab === "gacha" ? gachaHTML() : ui.tab === "coll" ? collectionHTML() : rulesHTML();
    var modal = "";
    var d = ui.detail ? find(ui.detail) : null;
    if (d) modal = '<div class="ky-modal-bg" data-act="close"><div class="ky-modal" data-stop="1">' + detailHTML(d) + "</div></div>";
    app.innerHTML = '<div class="ky-wrap"><nav class="ky-tabs">' + tabs + '</nav><div class="ky-body">' + body + "</div>" + modal + "</div>";
  }

  app.addEventListener("click", function (e) {
    var el = e.target.closest("[data-act]");
    if (!el || !app.contains(el)) return;
    if (el.classList.contains("ky-modal-bg") && e.target.closest("[data-stop]")) return;
    var act = el.getAttribute("data-act"), d = ui.detail ? find(ui.detail) : null;
    switch (act) {
      case "tab": ui.tab = el.getAttribute("data-v"); ui.confirmReset = false; break;
      case "pull1": doPull(1); break;
      case "pull10": doPull(10); break;
      case "filter": ui.filter = el.getAttribute("data-v"); break;
      case "sort": ui.sort = el.getAttribute("data-v"); break;
      case "detail": ui.detail = el.getAttribute("data-uid"); ui.log = ""; ui.confirmRelease = false; break;
      case "close": ui.detail = null; break;
      case "aff":
        if (!d) return;
        var opened = Core.setAffection(d, d.affection + (+el.getAttribute("data-d")));
        ui.log = opened.length ? t("ky_unlocked", { g: opened.map(function (gi) { return D.GROUPS[gi].id; }).join("・") }) : "";
        persist();
        break;
      case "lv1":
      case "lvmax":
        if (!d) return;
        var gained = {}, before = d.level, typeBefore = Core.type81(d.v).name;
        do {
          var g = Core.levelUp(d, rng);
          if (!g) break;
          g.forEach(function (k) { gained[k] = (gained[k] || 0) + 1; });
        } while (act === "lvmax");
        var parts = D.ORDER.filter(function (k) { return gained[k]; }).map(function (k) { return k + (Core.isVisible(d, k) ? " +" + gained[k] : " +？"); });
        var typeAfter = Core.type81(d.v).name;
        ui.log = t("ky_grew", { a: before, b: d.level, list: parts.length ? parts.join("、") : t("ky_no_growth") }) + (typeAfter !== typeBefore ? "　" + t("ky_type_changed", { a: typeBefore, b: typeAfter }) : "");
        persist();
        break;
      case "release": ui.confirmRelease = true; break;
      case "release-no": ui.confirmRelease = false; break;
      case "release-yes":
        save.items = save.items.filter(function (x) { return x.uid !== ui.detail; });
        ui.last = ui.last.filter(function (u) { return u !== ui.detail; });
        ui.detail = null; ui.confirmRelease = false;
        persist();
        break;
      case "reset":
        if (!ui.confirmReset) { ui.confirmReset = true; break; }
        ui.confirmReset = false; save = { v: 1, seq: 1, items: [] }; ui.last = []; persist();
        break;
      default: return;
    }
    render();
  });

  window.addEventListener("i18n:change", function () { render(); });
  render();

  // 測試用（Playwright 讀取狀態）
  window.PriTestKyuka = { state: function () { return { ui: ui, save: save }; } };
})();
