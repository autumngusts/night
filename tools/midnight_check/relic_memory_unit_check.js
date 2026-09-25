// 遺物記憶純函式單元測試（不需瀏覽器）：node relic_memory_unit_check.js
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const src = fs.readFileSync(path.join(__dirname, "../../static_src/midnight_relic_memory.js"), "utf8");
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
const RM = sandbox.window.PriTestMidnightRelicMemory;

const catalogSrc = fs.readFileSync(
  path.join(__dirname, "../../static_src/midnight_relic_memory_catalog.js"),
  "utf8"
);
vm.runInContext(catalogSrc, sandbox);
const CAT = sandbox.window.PriTestMidnightRelicMemoryCatalog;

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

// final review C1（2026-09-24）：重新開始一輪時記錄基準（relicMemoryBaseline），里程碑只算
// 「本輪新增」的部分，day1/day2 已在上一輪擊敗者不再發。boss 不受基準影響（節點本身會被清掉）。
const cg = (counts, base) => JSON.stringify(RM.cycleGrantKeys(counts, base));
assert(cg({ tiles: 7, strong: 3, day1: true, day2: false, boss: false }, null) === '["tiles1","tiles2","strong1","day1"]', "cycleGrantKeys 無基準＝原本行為");
assert(cg({ tiles: 7, strong: 3, day1: true, day2: true, boss: false }, { tiles: 6, strong: 3, day1: true, day2: false }) === '["day2"]', "基準 tiles6/strong3/day1 → 只剩 day2");
assert(cg({ tiles: 9, strong: 2, day1: false, day2: false, boss: true }, { tiles: 6, strong: 5 }) === '["tiles1","boss"]', "基準 tiles6 + 9 → tiles1；count<基準 → 0；boss 照發");
assert(cg({ tiles: 3, strong: 3, day1: true, day2: true, boss: false }, { tiles: 3, strong: 3, day1: true, day2: true }) === "[]", "剛重新開始（count＝基準）→ 不重發任何 key");
assert(cg({ tiles: 3, strong: 0 }, { tiles: "x" }) === '["tiles1"]', "基準欄位不是數字 → 視為 0");

// 100 上限：放 99 舊（第 0 個是最愛）＋ 3 新 → 丟 2 個最舊非最愛
const store = {};
for (let i = 0; i < 99; i++) store["m" + String(i).padStart(16, "0")] = { memId: "m" + String(i).padStart(16, "0"), size: "s", effects: ["a"], createdAt: i, favorite: i === 0, source: "start" };
const add = [1, 2, 3].map((n) => ({ memId: "mnew" + n, size: "s", effects: ["a"], createdAt: 1000 + n, favorite: false, source: "start" }));
const r = RM.mergeIntoStore(store, add, 100);
assert(Object.keys(r.store).length === 100, "合併後剛好 100");
assert(r.added === 3 && r.discarded === 2 && r.rejected === 0, "added 3 / discarded 2");
assert(!!r.store["m0000000000000000"], "最愛（最舊）未被丟");
assert(!r.store["m0000000000000001"] && !r.store["m0000000000000002"], "丟掉最舊的 2 個非最愛");

// fix round 1（2026-09-24 review）：重複保存同一批已存在的memId不應該再次觸發容量判定，
// 否則對一個已滿100的store重複保存，會誤丟棄跟這次保存無關的舊記憶（結算後reload、本地
// 旗標重置、玩家又按一次保存鍵時會發生）。用剛剛合併完（已滿100）的r.store，再合併同一批
// add（memId跟r.store裡的完全相同）→ 應該全部被略過，added/discarded/rejected皆為0，
// store內容不變。
const r3 = RM.mergeIntoStore(r.store, add, 100);
assert(r3.added === 0 && r3.discarded === 0 && r3.rejected === 0, "重複保存同一批memId → added/discarded/rejected 皆 0");
assert(JSON.stringify(Object.keys(r3.store).sort()) === JSON.stringify(Object.keys(r.store).sort()), "重複保存後 store 內容（key集合）不變");

// 全部是最愛時新記憶放不下
const favStore = {};
for (let i = 0; i < 100; i++) favStore["f" + i] = { memId: "f" + i, size: "s", effects: ["a"], createdAt: i, favorite: true, source: "start" };
const r2 = RM.mergeIntoStore(favStore, add, 100);
assert(r2.added === 0 && r2.rejected === 3 && Object.keys(r2.store).length === 100, "最愛佔滿 → rejected 3");

const sorted = RM.sortedMemories({ x: { memId: "x", createdAt: 5, favorite: false }, y: { memId: "y", createdAt: 1, favorite: true }, z: { memId: "z", createdAt: 9, favorite: false } });
assert(sorted.map((m) => m.memId).join() === "y,z,x", "sortedMemories：最愛優先、再新→舊");

// ---- 範圍擲值（使用者明確規格：前80%內容機率80%、後20%機率20%）----
// [10,30]：切點 = floor(10 + 20*0.8) = 26。rand<0.8 → 前段 10〜26；rand>=0.8 → 後段 27〜30。
// 每次擲用掉兩個 rand：第一個選段，第二個在段內取值。
assert(RM.rollRangeValue(10, 30, seq([0.0, 0.0])) === 10, "[10,30] 前段最小 → 10");
assert(RM.rollRangeValue(10, 30, seq([0.79, 0.999])) === 26, "[10,30] 前段最大 → 26");
assert(RM.rollRangeValue(10, 30, seq([0.8, 0.0])) === 27, "[10,30] 後段最小 → 27");
assert(RM.rollRangeValue(10, 30, seq([0.99, 0.999])) === 30, "[10,30] 後段最大 → 30");
assert(RM.rollRangeValue(1, 3, seq([0.0, 0.0])) === 1, "[1,3] 前段 → 1");
assert(RM.rollRangeValue(1, 3, seq([0.9, 0.5])) === 3, "[1,3] 後段只有 3");
assert(RM.rollRangeValue(5, 5, seq([0.9])) === 5, "min===max 直接回傳");
assert(RM.rollRangeValue(null, 3, seq([0.5])) === null, "沒有範圍 → null");

// 整體分布：上限那一段的出現率應該明顯低於均勻分布。
// [1,10] 切點 = floor(1+9*0.8) = 8，後段是 9〜10（佔範圍的 20%），期望出現率約 20%；
// 均勻分布會是 20%… 剛好一樣，所以改用 [1,100]：後段 81〜100 佔 20 個值，
// 均勻分布下是 20/100 = 20%，同樣看不出差別。差別在「段內」——用兩段的邊界值檢查更準，
// 這裡改為驗證「前段值的總機率 ≈ 80%」，而前段在 [1,100] 是 1〜80（80 個值）。
// 真正能分辨的是不對稱的範圍：[1,6] 切點 = floor(1+5*0.8) = 5，前段 1〜5（5 個值）、
// 後段只有 6。均勻分布下 6 出現 1/6 ≈ 16.7%，本規格下是 20%。
(function () {
  let s = 1;
  const lcg = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  let high = 0;
  const N = 40000;
  for (let i = 0; i < N; i++) if (RM.rollRangeValue(1, 6, lcg) === 6) high++;
  const pct = high / N;
  assert(pct > 0.18 && pct < 0.22, "[1,6] 擲出上限 6 的比例約 20%（均勻分布會是 16.7%）：" + pct.toFixed(3));
})();

// ---- 角色專用效果的連抽抑制（使用者明確規格：拿到一條後，第二條機率 10%）----
// 池子：x1/x2/x3 是專用，p1/p2/p3 不是。
const MIXED = ["x1", "x2", "x3", "p1", "p2", "p3"];
const isExclusive = (id) => id[0] === "x";

// 第一條抽到專用（idx 0 → x1）後，第二次的 10% 判定 rand>=0.1 → 只能從非專用抽。
const ex1 = RM.rollEffects("m", MIXED, seq([0.0, 0.5, 0.0]), { isExclusive: isExclusive });
assert(ex1[0] === "x1" && !isExclusive(ex1[1]), "抽到專用後，rand 0.5（>=0.1）→ 第二條非專用");

// 同樣第一條是專用，但 10% 判定 rand<0.1 → 整池可抽，允許再抽到專用。
const ex2 = RM.rollEffects("m", MIXED, seq([0.0, 0.05, 0.0]), { isExclusive: isExclusive });
assert(ex2[0] === "x1" && isExclusive(ex2[1]), "抽到專用後，rand 0.05（<0.1）→ 第二條可為專用");

// 第一條不是專用時不套用門檻，第二次不消耗 10% 判定。
const ex3 = RM.rollEffects("m", MIXED, seq([0.5, 0.0]), { isExclusive: isExclusive });
assert(!isExclusive(ex3[0]) && ex3.length === 2, "第一條非專用 → 不套用門檻");

// 不傳 opts 時維持舊行為（整池均勻抽），且結果不重複。
const ex4 = RM.rollEffects("l", MIXED, seq([0, 0, 0]));
assert(ex4.length === 3 && new Set(ex4).size === 3, "沒有 opts → 舊行為、3 條不重複");

// 非專用抽光時退回整池，記憶仍湊得滿條數。
const ALLX = ["x1", "x2", "x3"];
const ex5 = RM.rollEffects("l", ALLX, seq([0, 0.5, 0, 0.5, 0]), { isExclusive: isExclusive });
assert(ex5.length === 3 && new Set(ex5).size === 3, "池子全是專用 → 仍湊滿 3 條");

// --------------------------------------------------------------------------
// 武器類別的家族繼承（設計文件 10.2，使用者 2026-09-25 確認「同組共用同樣數值」）
// --------------------------------------------------------------------------
// 期望值一律從短剣那一組讀回來算，不硬編（CLAUDE.md 4.7 原則 1）：只要之後短剣的
// 原始數值被修正，這些斷言會自動跟著走。
console.log("");
console.log("-- 武器類別家族繼承 --");

const WP = CAT.EFFECTS.filter((e) => e.id.indexOf("rm_wp_") === 0);
assert(WP.length === 133, "武器類別共 133 條（memory.txt 原始件數）");
assert(
  WP.every((e) => !!e.note),
  "繼承後武器類別 133 條全部都有 note"
);

const FAMILY_CASES = [
  ["atk", "rm_wp_dagger_atk", "rm_wp_straight_sword_atk", "直剣"],
  ["hp", "rm_wp_dagger_hp", "rm_wp_katana_hp", "刀"],
  ["fp", "rm_wp_dagger_fp", "rm_wp_bow_fp", "弓"],
  ["set3_atk", "rm_wp_dagger_set3_atk", "rm_wp_greataxe_set3_atk", "大斧"],
  ["find", "rm_wp_dagger_find", "rm_wp_ballista_find", "バリスタ"],
];
FAMILY_CASES.forEach(([kind, srcId, dstId, labelJa]) => {
  const s = CAT.effect(srcId);
  const d = CAT.effect(dstId);
  assert(!!s && !!d, kind + "：來源與繼承目標都存在");
  if (!s || !d) return;
  assert(d.inheritedFrom === srcId, kind + "：" + dstId + " 的 inheritedFrom 指向短剣");
  assert(
    d.note === s.note.split("短剣").join(labelJa),
    kind + "：note = 短剣的 note 把「短剣」換成「" + labelJa + "」"
  );
  assert(
    JSON.stringify(d.range) === JSON.stringify(s.range) && d.unit === s.unit,
    kind + "：range／unit 與短剣一致（" + JSON.stringify(s.range) + " " + s.unit + "）"
  );
});

// 繼承件數：23 種全套武器類別 ×（atk／hp／fp／set3_atk）＋ 31 種的 find。
const inherited = CAT.EFFECTS.filter((e) => e.inheritedFrom);
assert(inherited.length === 23 * 4 + 31, "繼承 123 條（23×4 ＋ 31 個 find）");

// 短剣本身是來源，不該被標記。
assert(
  !CAT.EFFECTS.some((e) => e.id.indexOf("rm_wp_dagger_") === 0 && e.inheritedFrom),
  "短剣那一組本身沒有 inheritedFrom"
);

// 盾／杖／聖印的 set3 原始資料就有固定值 note，繼承必須跳過。
[
  ["rm_wp_small_shield_set3_hp", "+40"],
  ["rm_wp_medium_shield_set3_hp", "+40"],
  ["rm_wp_greatshield_set3_hp", "+40"],
  ["rm_wp_staff_set3_fp", "+25"],
  ["rm_wp_seal_set3_fp", "+25"],
].forEach(([id, note]) => {
  const e = CAT.effect(id);
  assert(
    !!e && e.note === note && !e.inheritedFrom,
    id + "：原始固定值 note「" + note + "」沒有被繼承覆蓋"
  );
});

// 有 range 的總數：原始解析 82 ＋ 家族繼承的 23×3（atk／hp／fp）＋ 第 3 期補的 4 條＝ 155。
// 補的 4 條是生命力／精神力／持久力／強靭度（使用者 2026-09-25 給的換算，設計文件 §10.14.1 A）。
// set3_atk 與 find 是固定 10%，原始資料就沒有範圍，繼承後也不該有。
assert(
  CAT.EFFECTS.filter((e) => e.range).length === 82 + 23 * 3 + 5,
  "有 range 的效果 156 條（82 原始解析 ＋ 69 繼承 ＋ 4 條能力值 ＋ HP低下時カット率）"
);
assert(
  inherited.filter((e) => e.range).length === 23 * 3,
  "繼承來的 range 只有 69 條（set3_atk／find 是固定值，不帶 range）"
);

// 繼承來的 range 真的能餵進 rollRangeValue()。
const sw = CAT.effect("rm_wp_straight_sword_atk");
const swMin = RM.rollRangeValue(sw.range[0], sw.range[1], seq([0.0, 0.0]));
const swMax = RM.rollRangeValue(sw.range[0], sw.range[1], seq([0.99, 0.999]));
assert(
  swMin === sw.range[0] && swMax === sw.range[1],
  "直剣の攻撃力+ 的繼承範圍可擲出 " + sw.range[0] + "-" + sw.range[1]
);

// --------------------------------------------------------------------------
// variant（固定遺物上的強化版）只擲後段（使用者明確規格 2026-09-25）
// --------------------------------------------------------------------------
// 一般擲法用掉兩個 rand（選段、段內取值）；opts.high 跳過選段，只用掉一個。
console.log("");
console.log("-- variant 只擲後段 --");
assert(RM.rollRangeValue(10, 30, seq([0.0]), { high: true }) === 27, "[10,30] high 最小 → 27（不是 10）");
assert(RM.rollRangeValue(10, 30, seq([0.999]), { high: true }) === 30, "[10,30] high 最大 → 30");
assert(RM.rollRangeValue(6, 12, seq([0.0]), { high: true }) === 11, "[6,12] high 最小 → 11（切點 10）");
assert(RM.rollRangeValue(1, 2, seq([0.0]), { high: true }) === 2, "[1,2] high → 2（切點 1，後段只有 2）");
assert(RM.rollRangeValue(5, 5, seq([0.0]), { high: true }) === 5, "min===max 時 high 無影響");
(function () {
  // high 的結果必定落在後段：[6,12] 切點 10，後段是 11〜12。
  let s = 7;
  const lcg = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  let ok = true;
  for (let i = 0; i < 2000; i++) {
    const v = RM.rollRangeValue(6, 12, lcg, { high: true });
    if (v < 11 || v > 12) ok = false;
  }
  assert(ok, "[6,12] high 擲 2000 次全部落在 11〜12");
})();

// --------------------------------------------------------------------------
// 角色專用門檻只套用在第 2 條（使用者明確指示 2026-09-25「只限第二條」）
// --------------------------------------------------------------------------
console.log("");
console.log("-- 第 2 條的 10% 門檻／第 3 條硬性排除 --");
assert(RM.EXCLUSIVE_THRESHOLD_INDEX === 1, "10% 門檻索引是 1（＝第 2 條）");
assert(RM.EXCLUSIVE_FORBIDDEN_INDEX === 2, "硬性排除索引是 2（＝第 3 條）");
// 2026-09-25 使用者明確指示「第三條必不為角色專用效果」：第 3 條不是機率門檻，是硬性
// 排除，一律從非專用池抽（舊規格是「第 3 條不受限制、整池均勻抽」）。
// rand 序列：[選 x1] [門檻 0.5>=0.1] [選 p1] [選 p2]
//   i=0 candidates=MIXED(6) rand 0.0 → x1（專用）
//   i=1 門檻 rand 0.5 → plain=[p1,p2,p3] rand 0.0 → p1
//   i=2 硬性排除、**不擲骰** → plain=[p2,p3] rand 0.0 → p2
const th = RM.rollEffects("l", MIXED, seq([0.0, 0.5, 0.0, 0.0]), { isExclusive: isExclusive });
assert(
  th[0] === "x1" && th[1] === "p1" && th[2] === "p2",
  "大記憶第 3 條一律非專用（得到 " + th.join("／") + "）"
);
// 第 1 條非專用時，第 2 條不受門檻（可為專用），但第 3 條照樣被硬性排除。
// rand 序列：[選 p1] [選 x1] [選 p2]（i=1 沒有 gotExclusive，不擲門檻；i=2 不擲骰）
const th2 = RM.rollEffects("l", MIXED, seq([0.5, 0.0, 0.0]), { isExclusive: isExclusive });
assert(
  !isExclusive(th2[0]) && isExclusive(th2[1]) && !isExclusive(th2[2]),
  "第 1 條非專用時第 2 條仍可為專用，第 3 條仍不可（得到 " + th2.join("／") + "）"
);

// --------------------------------------------------------------------------
// newMemory 帶值 + 舊格式相容（設計文件 10.2／10.10 的範圍接線）
// --------------------------------------------------------------------------
console.log("");
console.log("-- 記憶的效果帶值 --");
// 不傳 rangeOf：行為與接線前相同，每一項只有 id、沒有 value。
const noRange = RM.newMemory("m", IDS, "start", seq([0.5]), 1000);
assert(
  noRange.effects.length === 2 && noRange.effects.every((e) => e && e.id && e.value === undefined),
  "沒有 rangeOf → 每項只有 { id }，不帶 value"
);

// 有 rangeOf：抽到的效果當下擲定數值。
// 小記憶：rand 序列 = [選效果] [擲值選段] [擲值段內] 然後才是 memId 的 16 個 hex。
const withRange = RM.newMemory("s", IDS, "start", seq([0.0, 0.0, 0.0, 0.5]), 1000, {
  rangeOf: (id) => (id === "a" ? [10, 30] : null),
});
assert(
  withRange.effects.length === 1 && withRange.effects[0].id === "a" && withRange.effects[0].value === 10,
  "有 rangeOf → 擲定數值（前段最小 10），實得 " + JSON.stringify(withRange.effects[0])
);
// rangeOf 回 null 的效果不帶 value。
const mixedRange = RM.newMemory("s", ["b"], "start", seq([0.0, 0.5]), 1000, { rangeOf: () => null });
assert(mixedRange.effects[0].value === undefined, "rangeOf 回 null 的效果不帶 value");

// 舊格式（純字串陣列）相容：不需要資料遷移。
const legacy = { memId: "m0", size: "m", effects: ["max_hp_up", "attack_dmg"] };
assert(
  RM.effectIdList(legacy).join(",") === "max_hp_up,attack_dmg",
  "舊格式純字串 → effectIdList 取得 id"
);
assert(
  RM.effectEntries(legacy).every((e) => e.value === null),
  "舊格式視為「沒有擲過值」（value null）"
);
const modern = { memId: "m1", size: "m", effects: [{ id: "a", value: 7 }, { id: "b" }] };
assert(
  RM.effectIdList(modern).join(",") === "a,b" &&
    RM.effectEntries(modern)[0].value === 7 &&
    RM.effectEntries(modern)[1].value === null,
  "新格式 { id, value } 正確取出"
);
// 壞掉的項目（null／沒有 id）整個略過，不丟例外。
assert(
  RM.effectEntries({ effects: [null, {}, "ok", { id: "x", value: "3" }] }).length === 2,
  "壞掉的項目略過；value 非數字視為沒擲過值"
);

// --------------------------------------------------------------------------
// 固定遺物的效果對應（使用者 2026-09-25 的 POOL_MISMATCH 決定）
// --------------------------------------------------------------------------
console.log("");
console.log("-- 固定遺物效果對應 --");
const unresolved = [];
CAT.FIXED_RELICS.forEach((r) => {
  r.effects.forEach((x) => {
    if (!x.effectId) unresolved.push(r.id + " :: " + x.text);
  });
});
assert(
  unresolved.length === 0,
  "18 顆固定遺物的效果全部對應到 effect id" + (unresolved.length ? "：" + unresolved.join(", ") : "")
);
assert(
  CAT.FIXED_RELICS.every((r) => r.effects.every((x) => typeof x.text === "string" && x.text)),
  "每一項都保留了遺物自己的原文措辭（text）"
);

// variant 4 條：對應到基礎版的 id，並帶 high 旗標。
const HIGH_EXPECT = {
  "攻撃命中時、スタミナ回復+1": "rm_hit_stamina_regen",
  "致命の一撃強化+1": "rm_critical_up",
  "炎攻撃力上昇+2": "rm_fire_atk_up",
  "出撃中、ショップでの購入に必要なルーンが大割引": "rm_shop_discount",
};
Object.keys(HIGH_EXPECT).forEach((text) => {
  const hits = [];
  CAT.FIXED_RELICS.forEach((r) =>
    r.effects.forEach((x) => {
      if (x.text === text) hits.push(x);
    })
  );
  assert(hits.length > 0, "variant「" + text + "」出現在固定遺物上");
  assert(
    hits.every((x) => x.effectId === HIGH_EXPECT[text] && x.high === true),
    "variant「" + text + "」→ " + HIGH_EXPECT[text] + " 且 high=true"
  );
  // 四條 variant 對應的效果都必須有 range，否則 high 旗標擲不出東西。
  const base = CAT.effect(HIGH_EXPECT[text]);
  assert(!!(base && base.range), HIGH_EXPECT[text] + " 有 range（high 才有意義）");
});

// renamed 4 條：名稱對齊，不帶 high。
const RENAMED_EXPECT = {
  "凍傷状態の敵に対する攻撃を強化": "rm_vs_frostbitten",
  "物理カット率上昇": "rm_physical_cut_up",
  "生命力+1": "rm_stat_vigor",
  "周囲で毒/腐敗状態の発生時、攻撃力上昇": "rm_nearby_poison_rot_atk",
};
Object.keys(RENAMED_EXPECT).forEach((text) => {
  const hits = [];
  CAT.FIXED_RELICS.forEach((r) =>
    r.effects.forEach((x) => {
      if (x.text === text) hits.push(x);
    })
  );
  assert(
    hits.length > 0 && hits.every((x) => x.effectId === RENAMED_EXPECT[text] && x.high === false),
    "renamed「" + text + "」→ " + RENAMED_EXPECT[text] + "（不帶 high）"
  );
});

// missing：ジェスチャー 那條已從固定遺物拿掉，其餘 4 條補建成新效果。
assert(
  !CAT.FIXED_RELICS.some((r) => r.effects.some((x) => x.text.indexOf("ジェスチャー") >= 0)),
  "「ジェスチャー「あぐら」により、発狂が蓄積」已從固定遺物移除"
);
["rm_item_effect_to_allies", "rm_melee_atk_up", "rm_weapon_skill_atk_up", "rm_ailment_gauge_atk_up"].forEach((id) => {
  const e = CAT.effect(id);
  assert(!!e, "補建的效果 " + id + " 存在於 EFFECTS");
  if (!e) return;
  assert(e.note === "" && e.range === null, id + "：note 空、range null（memory.txt 沒有換算說明，不自行推定）");
  assert(e.stackable === null && e.use === null, id + "：stackable／use 為 null（台帳上還沒決定）");
});
assert(CAT.EFFECTS.length === 419, "EFFECTS 共 419 條（415 原始 ＋ 4 補建）");

// 效果件數：18 顆本來各 3 個，獣の夜 2 個、魔の夜與魔の暗き夜各拿掉 1 個 → 51。
assert(
  CAT.FIXED_RELICS.reduce((n, r) => n + r.effects.length, 0) === 51,
  "固定遺物效果合計 51 條（54 − 獣の夜 1 − ジェスチャー 2）"
);
assert(CAT.fixedRelic("relic_beast_night").effects.length === 2, "獣の夜就是 2 個效果（使用者確認，非資料缺漏）");
assert(CAT.fixedRelic("relic_magic_night").effects.length === 2, "魔の夜拿掉 ジェスチャー 後剩 2 個");
assert(CAT.fixedRelic("relic_magic_dark_night").effects.length === 2, "魔の暗き夜拿掉 ジェスチャー 後剩 2 個");

// variant 走實際資料時真的擲得出高值。
(function () {
  const critical = CAT.effect("rm_critical_up"); // [6,12]，切點 10
  const low = RM.rollRangeValue(critical.range[0], critical.range[1], seq([0.0, 0.0]));
  const high = RM.rollRangeValue(critical.range[0], critical.range[1], seq([0.0]), { high: true });
  assert(low === 6 && high === 11, "致命の一撃強化：一般最低 6、+1 版最低 11");
})();

// --------------------------------------------------------------------------
// 抽選池的擴充（2026-09-25，設計文件 10.1「並存」／10.9 第 6 點）
// --------------------------------------------------------------------------
console.log("");
console.log("-- 抽選池擴充 --");

// drawableEffects() 排除 bad／skip／relicOnly 三種。
const drawable = CAT.drawableEffects();
assert(
  drawable.every((e) => !e.bad),
  "池中沒有悪効果（抽選規則未定，使用者指示先跳過）"
);
assert(
  drawable.every((e) => e.use !== "skip"),
  "池中沒有 use: skip 的效果"
);
assert(
  drawable.every((e) => !e.relicOnly),
  "池中沒有 relicOnly 的效果（只出現在固定配置遺物上）"
);
const bad = CAT.EFFECTS.filter((e) => e.bad).length;
const skipOnly = CAT.EFFECTS.filter((e) => !e.bad && !e.relicOnly && e.use === "skip").length;
const relicOnly = CAT.EFFECTS.filter((e) => !e.bad && e.relicOnly).length;
// missingData（d 旗標）：效果指向的招式資料還不存在，使用者指示先不進抽選池（§10.14.2）。
const missingData = CAT.EFFECTS.filter((e) => !e.bad && !e.relicOnly && e.use !== "skip" && e.missingData).length;
assert(
  drawable.length === CAT.EFFECTS.length - bad - skipOnly - relicOnly - missingData,
  "池的條數 = 419 − " + bad + " 悪効果 − " + skipOnly + " skip − " + relicOnly + " relicOnly − " + missingData + " 缺資料 = " + drawable.length
);
assert(
  CAT.drawableEffectIds().length === drawable.length &&
    CAT.drawableEffectIds().every((id) => typeof id === "string"),
  "drawableEffectIds() 與 drawableEffects() 同長度、全是字串 id"
);

// 角色專用效果留在池裡（設計文件 10.3：別的角色也有機會抽到）。
const poolExclusive = drawable.filter((e) => e.character);
assert(poolExclusive.length > 0, "池中仍有角色專用效果（" + poolExclusive.length + " 條），沒有被排除");
assert(
  CAT.isExclusiveEffect(poolExclusive[0].id) === true,
  "isExclusiveEffect 認得專用效果（" + poolExclusive[0].id + "）"
);
assert(
  CAT.isExclusiveEffect("rm_max_hp_up") === false && CAT.isExclusiveEffect("max_hp_up") === false,
  "isExclusiveEffect：通用效果與 24 種附帶效果都回 false"
);

// 池裡帶 range 的效果條數（範圍擲值真正生效的部分）。
const poolWithRange = drawable.filter((e) => e.range);
assert(poolWithRange.length > 100, "池中有 range 的效果 " + poolWithRange.length + " 條（範圍擲值會對它們生效）");

// --------------------------------------------------------------------------
// 池擴充後：從實際資料抽出的記憶會帶擲定的數值
// --------------------------------------------------------------------------
// 模擬 midnight.js 的 relicMemoryDrawPool()／relicMemoryRollOpts()：
// 24 種附帶效果（這裡用假 id 代替，它們本來就沒有 range）＋ 目錄的可抽選效果。
(function () {
  const ATTACHED = ["max_hp_up", "attack_dmg", "arts_dmg"]; // 沒有 range
  const pool = ATTACHED.concat(CAT.drawableEffectIds());
  const opts = {
    rangeOf: (id) => {
      const e = CAT.effect(id);
      return e && e.range ? e.range : null;
    },
    isExclusive: (id) => CAT.isExclusiveEffect(id),
  };
  let s = 12345;
  const lcg = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

  let withValue = 0;
  let total = 0;
  let outOfRange = [];
  for (let i = 0; i < 400; i++) {
    const mem = RM.newMemory("l", pool, "boss", lcg, Date.now(), opts);
    RM.effectEntries(mem).forEach((entry) => {
      total++;
      const e = CAT.effect(entry.id);
      if (entry.value !== null) {
        withValue++;
        // 擲定的值必須落在該效果宣告的範圍內。
        if (!e || !e.range || entry.value < e.range[0] || entry.value > e.range[1]) {
          outOfRange.push(entry.id + "=" + entry.value);
        }
      } else if (e && e.range) {
        // 有 range 卻沒擲出值 → 接線漏了。
        outOfRange.push(entry.id + " 有 range 卻沒有 value");
      }
    });
  }
  assert(withValue > 0, "池擴充後抽到的效果會帶擲定的數值（" + withValue + " / " + total + " 條）");
  assert(outOfRange.length === 0, "擲定的值全部落在該效果的 range 內" + (outOfRange.length ? "：" + outOfRange.slice(0, 5).join(", ") : ""));

  // 專用效果的 10% 門檻真的有壓低第 2 條的專用率。
  let secondExclusive = 0;
  let firstExclusive = 0;
  const N = 6000;
  for (let i = 0; i < N; i++) {
    const ids = RM.rollEffects("l", pool, lcg, opts);
    if (opts.isExclusive(ids[0])) {
      firstExclusive++;
      if (opts.isExclusive(ids[1])) secondExclusive++;
    }
  }
  const rate = firstExclusive ? secondExclusive / firstExclusive : 0;
  // 第 1 條是專用時，第 2 條有 10% 的機率不套門檻（整池均勻抽，專用佔比約 12%），
  // 其餘 90% 從非專用池抽 → 條件專用率約 0.1 × 12% ≈ 1.2%，遠低於整池的 12%。
  const poolExclusiveRate = poolExclusive.length / pool.length;
  assert(
    firstExclusive > 100 && rate < poolExclusiveRate / 2,
    "第 1 條是專用時，第 2 條的專用率 " + (rate * 100).toFixed(2) + "% 明顯低於整池的 " + (poolExclusiveRate * 100).toFixed(1) + "%"
  );
})();

console.log(fails ? "\n" + fails + " FAIL" : "\nALL PASS");
process.exit(fails ? 1 : 0);
