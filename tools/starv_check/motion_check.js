// 明星經紀 starV：動圖圖鑑「御三家」解鎖的檢查（node 直接跑）：
//   node tools/starv_check/motion_check.js
// 規格 docs/superpowers/specs/2026-11-15-starv-motion-codex.md：
//   階段 1 開局選擇 → 夥伴 動作 1；階段 2 第 1 次頒獎典禮 → 夥伴 2、其他 1；階段 3 公司 Lv5 → 夥伴 3、其他 2；
//   其他兩位的動作 3 只能在之後的局（新紀元／重新開始）選它們才拿得到。
"use strict";

global.window = global;
[
  "starv_data", "starv_words_1", "starv_traits_1", "starv_events",
  "starv_events_1", "starv_events_2", "starv_events_3", "starv_events_4", "starv_events_5", "starv_events_6", "starv_events_7",
  "starv_events_8", "starv_events_9", "starv_events_10", "starv_events_11", "starv_events_12", "starv_events_13", "starv_events_14",
  "starv_events_15", "starv_plus_data", "starv_motion_data",
  "starv_awards_data", "starv_projects", "starv_projects_1", "starv_projects_2",
  "starv_achievements", "starv_achievements_1", "starv_achievements_2", "starv_achievements_3", "starv_achievements_4",
  "starv_roster", "starv_roster_1", "starv_roster_2", "starv_roster_3", "starv_roster_4", "starv_roster_5", "starv_roster_6",
  "starv_roster_rivals_1", "starv_roster_rivals_2", "starv_core", "starv_plus", "starv_motion"
].forEach(function (n) { require("../../static_src/" + n + ".js"); });
var D = global.PriTestStarvData, Core = global.PriTestStarvCore, Motion = global.PriTestStarvMotion;
var M = D.MOTION;

var errors = 0;
function check(cond, msg) { if (!cond) { errors++; console.log("ERROR " + msg); } else console.log("ok    " + msg); }
function lv(st) { return M.STARTERS.map(function (s) { return st.codex.motion.lv[s.id]; }).join(","); }
// 跑到本紀元第 1 次頒獎典禮（12/30）結束的隔天
function passAwards(st) { var left = 360 - (st.day % 360) + 1; Core.advance(st, left); }

check(M.STARTERS.length === 3 && M.STARTERS.every(function (s) { return s.moves.length === 3; }), "御三家 3 位 × 3 個動作");
check(["motions", "motionFull"].every(function (x) { return Core.ACH_TYPES.indexOf(x) >= 0; }), "成就判定類型已登記");

// ---- 第 1 局：選 s2 ----
var st = Core.create({ seed: 7 });
check(Motion.needsPick(st) && lv(st) === "0,0,0", "新存檔：尚未選擇、全部未解鎖");
Core.advance(st, 3);
check(lv(st) === "0,0,0", "沒選之前不會解鎖");
check(Motion.choose(st, "nope") === "noStarter", "不存在的 ID 被拒絕");
check(Motion.choose(st, "s2") === null && lv(st) === "0,1,0", "選 s2 → s2 動作 1");
check(Motion.choose(st, "s1") === "motionPicked" && st.codex.motion.pick === "s2", "同一局不能改選");
Core.advance(st, 1);
check(!!st.achievements.motion_first, "成就：第一支動圖");
st.company.level = 5; Core.advance(st, 1);   // Lv5 但還沒頒獎：維持階段 1
check(lv(st) === "0,1,0", "頒獎典禮前就算 Lv5 也不會跳到階段 3");
st.company.level = 1;
passAwards(st);
check(st.awards.history.length === 1, "第 1 年頒獎典禮已舉行");
check(lv(st) === "1,2,1", "頒獎後：夥伴動作 2、其他兩位動作 1（" + lv(st) + "）");
check(Motion.stage(st) === 2, "階段 2");
st.company.level = 5; Core.advance(st, 1);
check(lv(st) === "2,3,2", "Lv5：夥伴動作 3、其他兩位動作 2（" + lv(st) + "）");
check(!!st.achievements.motion_trio_full && !st.achievements.motion_all, "成就：看家本領（全收藏還沒有）");
check(st.log.filter(function (e) { return e.type === "motion_unlock"; }).length === 7, "每個動作各記 1 筆日誌");

// ---- 第 2 局（新紀元）：選 s1 ----
st.company.level = 10;
check(Core.newEra(st, null) === null && st.era === 2, "開新紀元");
check(Motion.needsPick(st) && lv(st) === "2,3,2", "新紀元：要重新選、已解鎖的保留");
Motion.choose(st, "s1"); Core.advance(st, 1);
check(lv(st) === "2,3,2", "選 s1（已有 2）不會倒退");
passAwards(st);
check(lv(st) === "2,3,2", "新紀元頒獎後：仍是 2,3,2（夥伴 2、其他 ≥1）");
st.company.level = 5; Core.advance(st, 1);
check(lv(st) === "3,3,2", "新紀元 Lv5：s1 動作 3（" + lv(st) + "）");
check(st.codex.motion.picks.length === 2, "選擇紀錄 2 筆");

// ---- 第 3 局：選 s3 → 全收藏 ----
st.company.level = 10; Core.newEra(st, null);
Motion.choose(st, "s3"); passAwards(st); st.company.level = 5; Core.advance(st, 1);
check(lv(st) === "3,3,3" && Motion.total(st) === 9, "第 3 局選 s3 → 9 個動作全部解鎖");
check(!!st.achievements.motion_all, "成就：御三家全收藏");

// ---- 重新開始（鏡射合併）與舊存檔 ----
var fresh = Core.create({ seed: 8 });
check(Motion.merge(fresh, { s1: 3, s2: 1, s3: 9, bad: 3 }) && lv(fresh) === "3,1,3", "鏡射合併：取較高者、超出範圍夾到 3");
check(!Motion.merge(fresh, { s1: 0 }), "鏡射合併不會降級");
var old = Core.create({ seed: 9 }); delete old.codex.motion;
old = Core.migrate(JSON.parse(JSON.stringify(old)));
check(old.codex.motion && Motion.needsPick(old) && lv(old) === "0,0,0", "舊存檔遷移後補上欄位並要求選擇");
var saved = Core.migrate(JSON.parse(JSON.stringify(st)));
check(lv(saved) === "3,3,3" && saved.codex.motion.pick === "s3", "存檔來回後狀態不變");

console.log(errors ? "\n" + errors + " 個錯誤" : "\n全部通過");
process.exit(errors ? 1 : 0);
