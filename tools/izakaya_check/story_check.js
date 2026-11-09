// 深夜居酒屋（izakaya）劇情圖檢查：所有場景的引用都存在、前置條件做得到、沒有循環、每個角色的段數達標。
// 執行：node tools/izakaya_check/story_check.js
"use strict";
var fs = require("fs"), path = require("path"), assert = require("assert");
global.window = global;
global.I18N = { getLang: function () { return "zh"; } };
var SRC = path.join(__dirname, "..", "..", "static_src");
["gousei_data_food.js", "izakaya_data.js", "izakaya_cast.js", "izakaya_story.js", "izakaya_story_main.js", "izakaya_story_arcs.js", "izakaya_story_staff.js", "izakaya_story_main2.js", "izakaya_story_arcs2.js", "izakaya_story_staff2.js", "izakaya_story_heart.js", "izakaya_story_truth.js", "izakaya_story_deep.js", "izakaya_story_deep_staff.js", "izakaya_story_daily.js", "izakaya_story_e.js", "izakaya_story_heart2.js"].forEach(function (f) {
  eval.call(global, fs.readFileSync(path.join(SRC, f), "utf8"));
});
var D = window.PriTestIzakayaData, Cast = window.PriTestIzakayaCast, St = window.PriTestIzakayaStory;
// 批次 C（2026-11-09）：常客每人至少 15 段、店員至少 10 段
var MIN_REG = +(process.env.IZ_MIN_REG || 15), MIN_STAFF = +(process.env.IZ_MIN_STAFF || 10);
var scenes = St.all(), ids = {}, flagsMade = {}, problems = [];
function chk(ok, msg) { if (!ok) problems.push(msg); }
scenes.forEach(function (sc) {
  chk(!ids[sc.id], "場景 id 重複：" + sc.id); ids[sc.id] = sc;
  (sc.ch || []).forEach(function (o) { var fx = o.fx || {}; (fx.flag || []).forEach(function (f) { flagsMade[f] = 1; }); });
});
var ARCS = ["band", "contest", "dance", "invest", "will", "master", "truth", "bride", "critic", "idol"];
scenes.forEach(function (sc) {
  var c = sc.cond || {};
  chk(["visit", "close", "holiday", "date", "daily"].indexOf(sc.at) >= 0, sc.id + " 的 at 不合法");
  chk(sc.who && sc.who.length, sc.id + " 沒有 who");
  (sc.who || []).concat(c.present || []).concat(Object.keys(c.aff || {})).forEach(function (k) { chk(!!Cast.byId(k), sc.id + " 引用不存在的角色：" + k); });
  (c.seen || []).concat(c.notSeen || []).forEach(function (k) { chk(!!ids[k], sc.id + " 的前置場景不存在：" + k); });
  (c.flag || []).forEach(function (k) { chk(!!flagsMade[k], sc.id + " 需要的旗標沒有任何場景產生：" + k); });
  if (sc.next) chk(!!ids[sc.next], sc.id + " 的 next 不存在：" + sc.next);
  if (sc.arc) chk(ARCS.indexOf(sc.arc) >= 0, sc.id + " 的事件線不存在：" + sc.arc);
  chk(sc.lines && sc.lines.length, sc.id + " 沒有台詞");
  (sc.lines || []).forEach(function (l) { chk(l[0] === "" || !!Cast.byId(l[0]), sc.id + " 台詞的說話者不存在：" + l[0]); });
  (sc.ch || []).forEach(function (o) {
    var fx = o.fx || {};
    Object.keys(fx.aff || {}).forEach(function (k) { chk(!!Cast.byId(k), sc.id + " 的效果引用不存在的角色：" + k); });
    (fx.link || []).forEach(function (l) { chk(!!Cast.byId(l[0]) && !!Cast.byId(l[1]) && !!St.RELS[l[2]], sc.id + " 的關係線不合法：" + l.join(",")); });
    if (fx.dish) chk(!!D.DISHES[fx.dish], sc.id + " 解鎖的菜不存在：" + fx.dish);
  });
});
// 前置沒有循環（seen 圖做拓樸排序）
var state = {};
function visit(id, stack) {
  if (state[id] === 2) return; if (state[id] === 1) { problems.push("前置循環：" + stack.concat(id).join(" → ")); return; }
  state[id] = 1; ((ids[id].cond || {}).seen || []).forEach(function (k) { if (ids[k]) visit(k, stack.concat(id)); }); state[id] = 2;
}
Object.keys(ids).forEach(function (k) { visit(k, []); });
// 段數：以 who[0] 為主角計算（多人場面不算進個人段數）
function own(cid) { return scenes.filter(function (sc) { return sc.who[0] === cid && !sc.arc; }).length + scenes.filter(function (sc) { return sc.who[0] === cid && sc.arc; }).length; }
Cast.REGULARS.forEach(function (c) { chk(own(c.id) >= MIN_REG, c.id + " 劇情段數 " + own(c.id) + " < " + MIN_REG); });
Cast.STAFF.forEach(function (c) { chk(own(c.id) >= MIN_STAFF, c.id + " 劇情段數 " + own(c.id) + " < " + MIN_STAFF); });
if (problems.length) { console.error(problems.join("\n")); process.exit(1); }
console.log("story_check OK（場景 " + scenes.length + "）");
