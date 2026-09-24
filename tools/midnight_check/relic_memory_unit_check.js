// 遺物記憶純函式單元測試（不需瀏覽器）：node relic_memory_unit_check.js
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const src = fs.readFileSync(path.join(__dirname, "../../static_src/midnight_relic_memory.js"), "utf8");
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
const RM = sandbox.window.PriTestMidnightRelicMemory;

let fails = 0;
function assert(cond, label) {
  console.log((cond ? "  [PASS] " : "  [FAIL] ") + label);
  if (!cond) fails++;
}
function seq(values) {
  let i = 0;
  return () => values[i++ % values.length];
}
const IDS = ["a", "b", "c", "d", "e"];

assert(RM.isValidCode("ABC1E"), "ABC1E 有效");
assert(!RM.isValidCode("abc1e"), "小寫無效");
assert(!RM.isValidCode("ABCD"), "4 位無效");
assert(RM.normalizeCode(" abc1e ") === "ABC1E", "normalizeCode 去空白轉大寫");

assert(JSON.stringify(RM.grantSizes("start", seq([0.99]))) === '["s"]', "start 固定小");
assert(JSON.stringify(RM.grantSizes("tiles", seq([0.79]))) === '["s"]', "tiles 0.79 → 小");
assert(JSON.stringify(RM.grantSizes("tiles", seq([0.8]))) === '["m"]', "tiles 0.8 → 中");
assert(JSON.stringify(RM.grantSizes("strong", seq([0.1]))) === '["s"]', "strong 同 tiles");
assert(JSON.stringify(RM.grantSizes("day1", seq([0.59]))) === '["m"]', "day1 0.59 → 中");
assert(JSON.stringify(RM.grantSizes("day1", seq([0.6]))) === '["l"]', "day1 0.6 → 大");
assert(JSON.stringify(RM.grantSizes("day2", seq([0.6]))) === '["m","l"]', "day2 = 中 + (0.6→大)");
assert(JSON.stringify(RM.grantSizes("boss", seq([0.49]))) === '["l","l"]', "boss 0.49 → 大大");
assert(JSON.stringify(RM.grantSizes("boss", seq([0.5]))) === '["l"]', "boss 0.5 → 大");

const eff = RM.rollEffects("l", IDS, seq([0, 0, 0, 0.5, 0.99]));
assert(eff.length === 3 && new Set(eff).size === 3, "大＝3 個互不重複");
assert(RM.rollEffects("s", IDS, seq([0.3])).length === 1, "小＝1 個");

const mem = RM.newMemory("m", IDS, "tiles", Math.random, 1000);
assert(/^m[0-9a-f]{16}$/.test(mem.memId), "memId 格式");
assert(mem.size === "m" && mem.effects.length === 2 && mem.favorite === false && mem.createdAt === 1000 && mem.source === "tiles", "newMemory 欄位");

assert(JSON.stringify(RM.milestoneGrantKeys(7, 3)) === '["tiles1","tiles2","strong1"]', "milestone 7 板塊 3 強敵");
assert(RM.milestoneGrantKeys(2, 2).length === 0, "未滿 3 不發");
assert(RM.grantKindOfKey("tiles3") === "tiles" && RM.grantKindOfKey("day2") === "day2", "grantKindOfKey");

// 100 上限：放 99 舊（第 0 個是最愛）＋ 3 新 → 丟 2 個最舊非最愛
const store = {};
for (let i = 0; i < 99; i++) store["m" + String(i).padStart(16, "0")] = { memId: "m" + String(i).padStart(16, "0"), size: "s", effects: ["a"], createdAt: i, favorite: i === 0, source: "start" };
const add = [1, 2, 3].map((n) => ({ memId: "mnew" + n, size: "s", effects: ["a"], createdAt: 1000 + n, favorite: false, source: "start" }));
const r = RM.mergeIntoStore(store, add, 100);
assert(Object.keys(r.store).length === 100, "合併後剛好 100");
assert(r.added === 3 && r.discarded === 2 && r.rejected === 0, "added 3 / discarded 2");
assert(!!r.store["m0000000000000000"], "最愛（最舊）未被丟");
assert(!r.store["m0000000000000001"] && !r.store["m0000000000000002"], "丟掉最舊的 2 個非最愛");

// 全部是最愛時新記憶放不下
const favStore = {};
for (let i = 0; i < 100; i++) favStore["f" + i] = { memId: "f" + i, size: "s", effects: ["a"], createdAt: i, favorite: true, source: "start" };
const r2 = RM.mergeIntoStore(favStore, add, 100);
assert(r2.added === 0 && r2.rejected === 3 && Object.keys(r2.store).length === 100, "最愛佔滿 → rejected 3");

const sorted = RM.sortedMemories({ x: { memId: "x", createdAt: 5, favorite: false }, y: { memId: "y", createdAt: 1, favorite: true }, z: { memId: "z", createdAt: 9, favorite: false } });
assert(sorted.map((m) => m.memId).join() === "y,z,x", "sortedMemories：最愛優先、再新→舊");

console.log(fails ? "\n" + fails + " FAIL" : "\nALL PASS");
process.exit(fails ? 1 : 0);
