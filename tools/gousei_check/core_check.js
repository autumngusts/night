// ============================================================================
// gousei（武俠合成）規則引擎的 Node 檢查。
// 執行：node tools/gousei_check/core_check.js
// 規則（使用者指定）：組合必有結果（無配方→廢料，材料含廢料→廢料）；
// 每人任務 中階×1（階段3〜4）＋高階×2（階段5〜7）不重複；
// 只有在自己回合親手合出自己的任務物才算達成；先 3/3 者勝。
// ============================================================================
"use strict";
var fs = require("fs");
var path = require("path");
var assert = require("assert");

var SRC = path.join(__dirname, "..", "..", "static_src");
var win = {};
new Function("window", fs.readFileSync(path.join(SRC, "gousei_core.js"), "utf8"))(win);
var Core = win.PriTestGouseiCore;

// ---- 測試用小主題：每層 3 個物體，階段 1〜7 ----
function fixture() {
  var items = [["b1", "甲", "甲", "basic", 0], ["b2", "乙", "乙", "basic", 0],
    ["z1", "灰", "灰", "junk", 0], ["z2", "渣", "渣", "junk", 0]];
  var recipes = {};
  var levels = ["i", "j", "k", "l", "m", "n", "o"];
  var prev = null;
  levels.forEach(function (L, idx) {
    var tier = idx + 1;
    var ids = [L + "1", L + "2", L + "3"];
    ids.forEach(function (id) { items.push([id, id, id, "c", tier]); });
    if (!prev) {
      recipes["b1|b1"] = ids[0]; recipes["b1|b2"] = ids[1]; recipes["b2|b2"] = ids[2];
    } else {
      recipes[Core.pairKey(prev[0], prev[1])] = ids[0];
      recipes[Core.pairKey(prev[1], prev[2])] = ids[1];
      recipes[Core.pairKey(prev[0], prev[2])] = ids[2];
    }
    prev = ids;
  });
  return { id: "fx", name: { zh: "測試", ja: "テスト" }, basics: ["b1", "b2"], junk: ["z1", "z2"],
    categories: [{ id: "c", zh: "類", ja: "類" }], items: items, recipes: recipes };
}
var theme = Core.indexTheme(fixture());

// ---- 基本工具 ----
assert.strictEqual(Core.pairKey("b", "a"), "a|b");
assert.strictEqual(Core.pairKey("a", "a"), "a|a");
assert.strictEqual(Core.hashStr("abc"), Core.hashStr("abc"));
var r1 = Core.makeRng("s1"), r2 = Core.makeRng("s1");
for (var i = 0; i < 5; i++) assert.strictEqual(r1(), r2());
assert.ok(/^[0-9a-z]{8}$/.test(Core.newSeed(Math.random)));
assert.strictEqual(theme.byId.k1.tier, 3);

// ---- 合成 ----
assert.strictEqual(Core.combine(theme, "b1", "b2"), "i2");
assert.strictEqual(Core.combine(theme, "b2", "b1"), "i2", "順序不影響");
var junk = Core.combine(theme, "b1", "o3");
assert.ok(theme.junkSet[junk], "無配方 → 廢料");
assert.strictEqual(Core.combine(theme, "o3", "b1"), junk, "廢料是確定性的");
assert.ok(theme.junkSet[Core.combine(theme, "z1", "z1")], "廢料 + 廢料 → 廢料");
// 即使把廢料塞進配方表，含廢料的組合仍是廢料
theme.recipes["b1|z1"] = "i1";
assert.ok(theme.junkSet[Core.combine(theme, "b1", "z1")], "材料含廢料 → 廢料");
delete theme.recipes["b1|z1"];

// ---- 發任務 ----
var deal = Core.dealTargets(theme, "seedA", 2);
assert.strictEqual(deal.length, 2);
var seen = {};
deal.forEach(function (ts) {
  assert.strictEqual(ts.length, 3);
  var t0 = theme.byId[ts[0]].tier;
  assert.ok(t0 >= 3 && t0 <= 4, "中階 " + ts[0]);
  [ts[1], ts[2]].forEach(function (id) { var tt = theme.byId[id].tier; assert.ok(tt >= 5 && tt <= 7, "高階 " + id); });
  ts.forEach(function (id) { assert.ok(!seen[id], "任務不重複 " + id); seen[id] = true; });
});
assert.deepStrictEqual(Core.dealTargets(theme, "seedA", 2), deal, "同 seed 相同");
assert.throws(function () { Core.dealTargets(theme, "seedA", 7); }, /not-enough-targets/);

// ---- 開局 ----
var st = Core.newGame(theme, { seed: "seedA", mode: "shared", names: ["A", "B"] });
assert.strictEqual(st.version, 1);
assert.deepStrictEqual(st.pool, ["b1", "b2"]);
assert.deepStrictEqual(st.players[0].targets, deal[0]);
assert.strictEqual(st.players[1].id, "p2");
assert.strictEqual(Core.currentPlayer(st).id, "p1");

// ---- 合成流程：新發現、輪替、輪數 ----
var res = Core.applyCombine(theme, st, "b1", "b2");
assert.strictEqual(res.entry.result, "i2");
assert.strictEqual(res.entry.isNew, true);
assert.strictEqual(res.entry.playerId, "p1");
assert.ok(res.state.pool.indexOf("i2") >= 0);
assert.strictEqual(Core.currentPlayer(res.state).id, "p2");
assert.strictEqual(st.pool.length, 2, "不改動傳入的 state");
var res2 = Core.applyCombine(theme, res.state, "b2", "b1");
assert.strictEqual(res2.entry.isNew, false);
assert.strictEqual(res2.state.round, 2);
assert.strictEqual(res2.state.turn, 0);
assert.throws(function () { Core.applyCombine(theme, res2.state, "b1", "k1"); }, /not-in-pool/);

// ---- 復原：只保留一層 ----
var back = Core.undo(res2.state);
assert.deepStrictEqual(back.pool, res.state.pool);
assert.strictEqual(back.turn, 1);
assert.strictEqual(Core.undo(back), null, "只能復原一層");

// ---- 達成：只算自己回合親手合出 ----
var s3 = Core.newGame(theme, { seed: "x", mode: "shared", names: ["A", "B"] });
s3.players[0].targets = ["k1", "m1", "n1"];
s3.players[1].targets = ["k2", "m2", "n2"];
s3.pool = s3.pool.concat(["j1", "j2", "j3"]);
var a1 = Core.applyCombine(theme, s3, "j2", "j3"); // p1 合出 k2（p2 的任務）
assert.strictEqual(a1.entry.achieved, false, "別人的任務不算");
var a2 = Core.applyCombine(theme, a1.state, "j2", "j3"); // p2 再合出 k2，但已在池子中
assert.strictEqual(a2.entry.achieved, true, "自己親手合出才算（已在池子中也可以）");
assert.deepStrictEqual(a2.state.players[1].done, ["k2"]);
var a3 = Core.applyCombine(theme, a2.state, "j1", "j2"); // p1 合出 k1
assert.strictEqual(a3.entry.achieved, true);

// ---- 勝利 ----
var s4 = Core.newGame(theme, { seed: "x", mode: "shared", names: ["A", "B"] });
s4.players[0].targets = ["k1", "m1", "n1"];
s4.players[0].done = ["m1", "n1"];
s4.pool = s4.pool.concat(["j1", "j2"]);
var w = Core.applyCombine(theme, s4, "j1", "j2");
assert.strictEqual(w.state.winner, "p1");
assert.strictEqual(w.state.turn, 0, "獲勝後不再輪替");
assert.throws(function () { Core.applyCombine(theme, w.state, "b1", "b1"); }, /game-over/);

// ---- 參加碼 ----
var jp = Core.joinParam(st, 1);
assert.strictEqual(jp, "fx.seedA.2.1");
assert.deepStrictEqual(Core.parseJoin(jp), { themeId: "fx", seed: "seedA", count: 2, index: 1 });
assert.strictEqual(Core.parseJoin("fx.seedA.2.5"), null);
assert.strictEqual(Core.parseJoin("garbage"), null);
assert.strictEqual(Core.parseJoin("fx.seedA.9.0"), null, "人數超過 8");

// ---- 語音：喚醒詞「yo, アキ」 ----
assert.deepStrictEqual(Core.detectWake("Yo, アキ", false), { rest: "" });
assert.deepStrictEqual(Core.detectWake("ヨー、あき 甲加乙", false), { rest: "甲加乙" }, "片假名／平假名、標點都可以");
assert.deepStrictEqual(Core.detectWake("喲阿基", true), { rest: "" }, "中文辨識的寫法");
assert.deepStrictEqual(Core.detectWake("アキ", false), { rest: "" }, "沒聽到 yo 也可以（不是朗讀中）");
assert.strictEqual(Core.detectWake("アキ", true), null, "朗讀中必須有 yo，避免喇叭回音");
assert.strictEqual(Core.detectWake("秋", false), null, "「秋」是一般詞彙（物體名稱也有），沒有 yo 不算");
assert.deepStrictEqual(Core.detectWake("よ秋", false), { rest: "" });
assert.strictEqual(Core.detectWake("千秋楽", false), null);
assert.strictEqual(Core.detectWake("今天天氣很好", false), null);

// ---- 語音：「A 加 B」 ----
var vpool = ["b1", "b2", "z1", "i1", "j1"];
function combo(text) {
  var r = Core.parseVoiceCombo(theme, vpool, text);
  return r ? [r.a, r.b] : null;
}
assert.deepStrictEqual(combo("甲加乙"), ["b1", "b2"]);
assert.deepStrictEqual(combo("我要 甲 和 甲 吧"), ["b1", "b1"], "去掉前後的口語");
assert.deepStrictEqual(combo("乙プラス甲を合成して"), ["b2", "b1"], "日文說法");
assert.deepStrictEqual(combo("乙と甲"), ["b2", "b1"]);
assert.deepStrictEqual(combo("甲乙"), ["b1", "b2"], "沒說「加」時兩段都要完全一致");
assert.deepStrictEqual(combo("I1 加 j1"), ["i1", "j1"], "大小寫不影響");
assert.strictEqual(combo("灰加甲"), null, "廢料不列入候選");
assert.strictEqual(combo("甲加k1"), null, "不在池子裡的不算");
assert.strictEqual(combo("不知道"), null);

// ---- 語音：拼音（同音字）比對 ----
new Function("window", fs.readFileSync(path.join(SRC, "gousei_pinyin.js"), "utf8"))(win);
Core.setPinyin(win.PriTestGouseiPinyin);
var ptheme = Core.indexTheme({ id: "py", name: { zh: "拼", ja: "拼" }, basics: ["thunder", "water", "fire"], junk: ["z1"],
  categories: [], recipes: {}, items: [["thunder", "雷", "雷", "basic", 0], ["water", "水", "水", "basic", 0],
    ["fire", "火", "火", "basic", 0], ["z1", "灰", "灰", "junk", 0], ["steam", "蒸氣", "蒸気", "c", 1]] });
function pcombo(text) {
  var r = Core.parseVoiceCombo(ptheme, ["thunder", "water", "fire", "z1", "steam"], text);
  return r ? [r.a, r.b] : null;
}
assert.deepStrictEqual(pcombo("雷加水"), ["thunder", "water"]);
assert.deepStrictEqual(pcombo("累家稅"), ["thunder", "water"], "同音字：雷→累、加→家、水→稅");
assert.deepStrictEqual(pcombo("淚加睡"), ["thunder", "water"]);
assert.deepStrictEqual(pcombo("或和雷"), ["fire", "thunder"], "火→或（huo）、和為分隔");
assert.deepStrictEqual(pcombo("正氣加火"), ["steam", "fire"], "zh/z 寬鬆：蒸 zheng ≈ 正 zheng、氣 qi");
assert.ok(Core.parseVoiceCombo(ptheme, ["thunder", "water"], "雷加水").score > Core.parseVoiceCombo(ptheme, ["thunder", "water"], "累加水").score,
  "字面一致的分數高於只有讀音一致");
assert.strictEqual(pcombo("今天天氣很好"), null);
assert.deepStrictEqual(Core.detectWake("有阿基", true), { rest: "" }, "中文辨識：有阿基");
assert.deepStrictEqual(Core.detectWake("要啊奇 雷加水", false), { rest: "雷加水" });
assert.deepStrictEqual(Core.detectWake("you a key", true), { rest: "" }, "英文辨識");
assert.deepStrictEqual(Core.detectWake("亞基", false), { rest: "" }, "yo+a 連成「亞」");
assert.strictEqual(Core.detectWake("亞基", true), null, "兩個音節的寫法朗讀中不算");
// 辨識器把外語音節換成同類音：yo アキ → 幼兒體（a→兒、ki→體）
["幼兒體", "有兒題", "要阿地", "よあき", "ようあき"].forEach(function (s) {
  assert.deepStrictEqual(Core.detectWake(s, false), { rest: "" }, "音節類別比對：" + s);
});
assert.deepStrictEqual(Core.detectWake("幼兒體雷加水", true), { rest: "雷加水" });
// 訓練過的範本：同類音的差異可以，不像的不行
var tpl = ["幼兒體"];
assert.deepStrictEqual(Core.detectWake("右兒提", false, tpl), { rest: "" }, "範本：同音字");
assert.deepStrictEqual(Core.detectWake("有爾地 雷加水", false, tpl), { rest: "雷加水" }, "範本：ti≈di");
assert.strictEqual(Core.detectWake("幼稚", false, tpl), null);
assert.deepStrictEqual(Core.detectWake("開始和成", false, ["開始合成"]), { rest: "" }, "範本可以是任何詞");
assert.strictEqual(Core.detectWake("開心合唱", false, ["開始合成"]), null);
["今天天氣很好", "記得", "有一個", "要求", "你好啊", "有兒子", "有二十", "又愛吃", "有一次", "有的"].forEach(function (s) {
  assert.strictEqual(Core.detectWake(s, false), null, "一般句子不誤觸：" + s);
});

// ---- 語音：池子編號與確認回答 ----
assert.strictEqual(Core.parseSpokenNumber("3"), 3);
assert.strictEqual(Core.parseSpokenNumber("二十三"), 23);
assert.strictEqual(Core.parseSpokenNumber("第七號"), 7);
assert.strictEqual(Core.parseSpokenNumber("3番"), 3);
assert.strictEqual(Core.parseSpokenNumber("一百零五"), 105);
assert.strictEqual(Core.parseSpokenNumber("一刀流"), null, "含數字的名稱不是編號");
var npool = ["thunder", "water", "z1", "fire", "steam"];
function ncombo(text) { var r = Core.parseVoiceCombo(ptheme, npool, text); return r ? [r.a, r.b, r.exact] : null; }
assert.deepStrictEqual(ncombo("1加4"), ["thunder", "fire", true], "編號＝池子順序");
assert.deepStrictEqual(ncombo("第一個加第五號"), ["thunder", "steam", true]);
assert.deepStrictEqual(ncombo("2 加 火"), ["water", "fire", true], "編號與名稱可以混用");
assert.strictEqual(ncombo("3加4"), null, "廢料的編號不算");
assert.strictEqual(ncombo("1加9"), null, "超出池子");
assert.deepStrictEqual(ncombo("雷加水"), ["thunder", "water", true], "字面完全一致＝exact");
assert.deepStrictEqual(ncombo("累家稅"), ["thunder", "water", false], "只靠讀音＝要確認");
assert.strictEqual(Core.parseYesNo("對"), true);
assert.strictEqual(Core.parseYesNo("好啊"), true);
assert.strictEqual(Core.parseYesNo("はい"), true);
assert.strictEqual(Core.parseYesNo("不對"), false, "否定詞優先");
assert.strictEqual(Core.parseYesNo("違います"), false);
assert.strictEqual(Core.parseYesNo("雷加水"), null);

console.log("gousei core_check OK");
