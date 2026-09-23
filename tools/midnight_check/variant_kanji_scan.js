// ============================================================================
// 規則書轉錄的異體字（新字體／舊字體）不一致全掃（純 node）
// ============================================================================
// 2026-09-24 起因：chip_coverage_check.js 發現「可怖強敵決定表」寫新字體「竜のツリーガード」、
// 而 enemies_data_3.js 寫舊字體「龍のツリーガード」，Enemies.search() 是純子字串比對所以
// 對不上，第 2 天⑧點的可怖強敵有 1/12 機率靜默退回亂數敵人。修法是在 Enemies.search()
// 做異體字摺疊（KANJI_VARIANTS），但那份對應表只收了實際踩到的一組。使用者要求
// 「掃一遍所有規則書轉錄找出其他潛在的異體字不一致」——這支就是那一輪。
//
// 兩個部分：
//
//   A. 語料掃描（只看 ja 側）：深走所有資料物件蒐集全部 .ja 字串，用異體字表摺疊後，
//      找出「摺疊後相同、原文不同」的組——那就是同一個詞在轉錄裡有兩種寫法，只要哪天
//      有人跨檔引用就會重演竜/龍那個 bug。
//      刻意**不**比對 zh 側，也不直接掃原始碼字元：ja 用新字體、zh 用繁體（字形多半等於
//      舊字體），那是正常的雙語轉錄，拿去比會得到幾十組全是雜訊的「不一致」。
//
//   B. 交叉引用解析：把 App 真的會拿去查敵人的決定表引用丟給 resolveCombatEnemyMatch()。
//      只含兩種：強敵籌碼的兩張表（一列一隻），以及 a_golden 的「夜の強敵決定表」
//      （一格多行，用 App 自己的 parseNightBossCellEntries() 拆）。其餘 extraTables 放的是
//      事件名／道具／地點／氣息效果，不是敵人表，掃了只會製造誤判。
//
// A 是「潛在風險」（不一定現在就壞），B 是「現在就壞」。只有 B 會讓這支腳本 exit 1。
//
// 執行：node variant_kanji_scan.js [--verbose]
// ============================================================================
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SRC = process.env.PRITEST_SRC || path.resolve(__dirname, "../../static_src");
const VERBOSE = process.argv.indexOf("--verbose") !== -1;

// ---- 新字體 → 舊字體 對應（日文常用漢字裡實際有字形差異的那些）----
// 只列「兩種寫法都可能出現在遊戲用語裡」的組別；純行政用字（会/會 這種在本資料裡不會
// 造成跨檔引用問題的）也一併列入，因為掃描成本很低、漏掉才麻煩。
const VARIANT_PAIRS = [
  ["竜", "龍"], ["沢", "澤"], ["剣", "劍"], ["戦", "戰"], ["独", "獨"], ["霊", "靈"],
  ["属", "屬"], ["発", "發"], ["乱", "亂"], ["両", "兩"], ["総", "總"], ["悪", "惡"],
  ["実", "實"], ["体", "體"], ["医", "醫"], ["声", "聲"], ["労", "勞"], ["帰", "歸"],
  ["気", "氣"], ["国", "國"], ["数", "數"], ["断", "斷"], ["豊", "豐"], ["学", "學"],
  ["会", "會"], ["点", "點"], ["当", "當"], ["対", "對"], ["経", "經"], ["続", "續"],
  ["歯", "齒"], ["鉄", "鐵"], ["巌", "巖"], ["斎", "齋"], ["麦", "麥"], ["虫", "蟲"],
  ["塩", "鹽"], ["雑", "雜"], ["残", "殘"], ["層", "層"], ["静", "靜"], ["蔵", "藏"],
  ["随", "隨"], ["険", "險"], ["験", "驗"], ["駅", "驛"], ["黒", "黑"], ["昼", "晝"],
  ["価", "價"], ["拠", "據"], ["権", "權"], ["観", "觀"], ["関", "關"], ["顕", "顯"],
];

// ---- sandbox ----
function stubEl() {
  const e = {
    style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    hidden: false, textContent: "", innerHTML: "", value: "", options: [], children: [],
    appendChild: () => e, removeChild() {}, setAttribute() {}, getAttribute: () => null,
    addEventListener() {}, removeEventListener() {}, querySelector: () => stubEl(), querySelectorAll: () => [],
    getContext: () => null, getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }),
    focus() {}, blur() {}, insertBefore() {},
  };
  return e;
}
const sandbox = {
  console: { log() {}, warn() {}, error() {} },
  setTimeout, clearTimeout, setInterval, clearInterval, Math, Date, JSON, Promise,
  document: {
    createElement: () => stubEl(), createTextNode: () => stubEl(), getElementById: () => stubEl(),
    querySelector: () => stubEl(), querySelectorAll: () => [], addEventListener() {},
    body: stubEl(), documentElement: stubEl(), activeElement: null, hidden: false,
  },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  navigator: { userAgent: "node" }, location: { search: "", href: "", hash: "" },
  requestAnimationFrame: () => 0, cancelAnimationFrame() {},
  performance: { now: () => Date.now() },
  Image: function () { return stubEl(); }, Audio: function () { return stubEl(); },
  addEventListener() {}, removeEventListener() {},
};
sandbox.window = sandbox;
sandbox.I18N = { t: (k) => k, getLang: () => "zh", current: () => "zh", apply() {} };
vm.createContext(sandbox);

const DATA_SCRIPTS = [
  "fields_data_1.js", "fields_data_2.js", "fields_data_3.js", "fields_data_4.js", "fields.js",
  "enemies_data_1.js", "enemies_data_2.js", "enemies_data_3.js", "enemies_data_4.js", "enemies.js",
  "night_bosses.js", "night_boss_rulebook.js", "event_rulebook.js", "night_floor_breakthrough.js",
  "character_types.js", "weapons_categories.js", "weapons_skills.js", "weapons_data.js", "weapons.js",
  "weapon_rulebook.js", "talismans.js", "consumables.js", "graces.js", "worldview.js",
  "night_gm_flow.js", "midnight_random_events.js",
];
DATA_SCRIPTS.forEach((f) => vm.runInContext(fs.readFileSync(path.join(SRC, f), "utf8"), sandbox, { filename: f }));

const Enemies = sandbox.window.PriTestEnemies;
const GmFlow = sandbox.window.PriTestNightGmFlow;
const ER = sandbox.window.PriTestEventRulebook;
const Fields = sandbox.window.PriTestFields;

// 目前 Enemies.search() 已經摺疊掉的組別（讀實作而不是自己抄一份，避免兩邊走鐘）。
const folded = new Set();
if (Enemies.foldNameVariants) {
  VARIANT_PAIRS.forEach(([shin, kyu]) => {
    if (Enemies.foldNameVariants(shin) === Enemies.foldNameVariants(kyu)) folded.add(shin + kyu);
  });
}

// ============================================================================
// A. 語料掃描（只看 ja 側）
// ============================================================================
// 第一版是直接掃檔案原始碼裡有沒有出現某個字，結果幾乎每一組都「兩種寫法都有」——因為
// ja 欄位用新字體、zh 欄位用繁體，而繁體的字形大多就等於舊字體。那不是不一致，是正常的
// 雙語轉錄。真正的風險只存在於**同一種語言欄位內部**：同一個詞在某個 ja 欄位寫新字體、
// 在另一個 ja 欄位寫舊字體，跨檔引用時就對不上（竜/龍 正是如此）。
//
// 因此改成：深走所有已載入的資料物件，蒐集全部 .ja 字串，再用異體字表把它們摺疊；
// **摺疊後相同、但原文不同**的那幾組，就是同一個詞的兩種寫法。這個判準沒有雜訊。
const VARIANT_MAP = {};
VARIANT_PAIRS.forEach(([shin, kyu]) => (VARIANT_MAP[shin] = kyu));
function fold(text) {
  let out = "";
  for (let i = 0; i < text.length; i++) out += VARIANT_MAP[text.charAt(i)] || text.charAt(i);
  return out;
}

const jaStrings = new Map(); // ja 原文 -> Set(來源標籤)
function collectJa(node, label, seen, depth) {
  if (!node || depth > 12) return;
  if (typeof node === "object") {
    if (seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      node.forEach((v) => collectJa(v, label, seen, depth + 1));
      return;
    }
    if (typeof node.ja === "string" && node.ja.trim()) {
      const t = node.ja.trim();
      if (!jaStrings.has(t)) jaStrings.set(t, new Set());
      jaStrings.get(t).add(label);
    }
    Object.keys(node).forEach((k) => {
      if (k === "ja" || k === "zh" || k === "en") return;
      collectJa(node[k], label, seen, depth + 1);
    });
  }
}

const ROOTS = [
  ["enemies", Enemies.listFamilies && Enemies.listFamilies()],
  ["fields", Fields.list && Fields.list()],
  ["event_rulebook", ER.list && ER.list()],
  ["night_boss_rulebook", sandbox.window.PriTestBossRulebook && sandbox.window.PriTestBossRulebook.list && sandbox.window.PriTestBossRulebook.list()],
  ["floor_breakthrough", sandbox.window.PriTestNightFloorBreakthrough],
  ["character_types", sandbox.window.PriTestCharacterTypes && sandbox.window.PriTestCharacterTypes.list()],
  ["weapons", sandbox.window.PriTestWeapons && sandbox.window.PriTestWeapons.list()],
  ["talismans", sandbox.window.PriTestTalismans && sandbox.window.PriTestTalismans.list()],
  ["consumables", sandbox.window.PriTestConsumables && sandbox.window.PriTestConsumables.list()],
  ["graces", sandbox.window.PriTestGraces && sandbox.window.PriTestGraces.list && sandbox.window.PriTestGraces.list()],
  ["worldview", sandbox.window.PriTestWorldview],
  ["random_events", sandbox.window.PriTestMidnightRandomEvents],
];
ROOTS.forEach(([label, root]) => {
  if (root) collectJa(root, label, new Set(), 0);
});

// 摺疊後相同、原文不同 → 同一個詞的兩種寫法
const byFolded = new Map();
jaStrings.forEach((labels, raw) => {
  const f = fold(raw);
  if (!byFolded.has(f)) byFolded.set(f, new Map());
  byFolded.get(f).set(raw, labels);
});
const partA = [];
byFolded.forEach((variants, f) => {
  if (variants.size > 1) {
    partA.push({
      folded: f,
      forms: [...variants.entries()].map(([raw, labels]) => ({ raw, sources: [...labels].join("、") })),
      handled: [...variants.keys()].every((raw, _, all) =>
        Enemies.foldNameVariants ? Enemies.foldNameVariants(raw) === Enemies.foldNameVariants(all[0]) : false
      ),
    });
  }
});

console.log("規則書轉錄 異體字（新字體／舊字體）不一致全掃");
console.log("掃描檔案：" + DATA_SCRIPTS.length + " 份；檢查字組：" + VARIANT_PAIRS.length + " 組");
console.log("蒐集到的相異 ja 字串：" + jaStrings.size + " 條（只比對 ja 側，zh 的繁體字形不算不一致）");

console.log("\n=== A. 同一個詞在 ja 側有兩種寫法（摺疊後相同、原文不同） ===");
if (!partA.length) console.log("  （無）");
partA
  .sort((x, y) => (x.handled === y.handled ? 0 : x.handled ? 1 : -1))
  .slice(0, 60)
  .forEach((p) => {
    console.log("  " + (p.handled ? "[已由 Enemies.search() 摺疊]" : "[**未處理**]"));
    p.forms.forEach((fm) => console.log("      「" + fm.raw.slice(0, 70) + "」  ← " + fm.sources));
  });

// ============================================================================
// B. 交叉引用解析
// ============================================================================
// 只掃「App 真的會拿去查敵人」的表。第一版對所有 extraTables 無差別掃描，33 筆「失敗」裡
// 絕大多數是誤判——隨機事件表放的是事件名（スカラベ／女神像）、獎勵表放的是道具
// （鍛石／武器：★★）、card_5/8 放的是地點（遺跡／鍛冶村）、card_9 放的是氣息效果，
// 它們本來就不是敵人表。掃描範圍錯了只會製造雜訊，不會提高可信度。
//
// 實際會被丟進 resolveCombatEnemyMatch() 的有兩種格式：
//   ① 一列一隻：強敵籌碼的兩張表（rollAndAssignStrongEnemy）。
//   ② 一格多行：a_golden 的「夜の強敵決定表」，每格是「1-3 敵名（頁）＋換行＋4-6 敵名（頁）」，
//      有專屬 parser parseNightBossCellEntries()。第一版把整格當單一引用，於是切出
//      「1 貪食ドラゴン」這種帶出目前綴的 token，當然全部對不到。
// 板塊樓層 bullet 的敵人引用由 scenario_map_cross_check.js／extra_table_enemy_check.js
// 負責，這裡不重複。
const REROLL_RE = /振り直|振直|再[擲振]/;
const unresolved = [];
const checked = { refs: 0 };

function checkEnemyRef(ja, where) {
  if (!ja || REROLL_RE.test(ja)) return;
  const parsed = GmFlow.extractLevelAndNameTokens(ja);
  if (!parsed.nameTokens || !parsed.nameTokens.length) return;
  checked.refs++;
  let m = null;
  for (let i = 0; i < parsed.nameTokens.length && !m; i++) m = GmFlow.resolveCombatEnemyMatch(parsed.nameTokens[i]);
  if (!m) unresolved.push({ where, ja: ja.split("（")[0].trim(), tokens: parsed.nameTokens });
}

// ① 強敵籌碼的兩張表
(ER.list() || [])
  .filter((chip) => chip.id === "strong_enemy")
  .forEach((chip) => {
    (chip.extraTables || []).forEach((t, ti) => {
      (t.rows || []).forEach((row, ri) => {
        checkEnemyRef((row[1] && row[1].ja) || "", (ti === 0 ? "強敵決定表" : "可怖強敵決定表") + " 第 " + (ri + 1) + " 列");
      });
    });
  });

// ② a_golden「夜の強敵決定表」：每格多行，用 App 自己的 parser 拆開後逐條解析。
const NIGHT_BOSS_TABLE_RE = /夜の強敵|夜之強敵/;
(Fields.list() || []).forEach((card) => {
  (card.extraTables || []).forEach((t) => {
    const title = (t.title && (t.title.ja || t.title.zh)) || "";
    if (!NIGHT_BOSS_TABLE_RE.test(title)) return;
    (t.rows || []).forEach((row, ri) => {
      [1, 2].forEach((col) => {
        const entries = GmFlow.parseNightBossCellEntries(row[col]) || [];
        entries.forEach((e) => {
          checkEnemyRef(e.ja, card.id + "「" + title + "」劇本 " + ((row[0] && row[0].ja) || ri + 1) + " 第 " + col + " 日目 出目" + e.faces.join("-"));
        });
      });
    });
  });
});

console.log("\n=== B. 會被拿去查敵人的決定表引用（" + checked.refs + " 筆） ===");
if (!unresolved.length) {
  console.log("  全部解析得到真實敵人");
} else {
  unresolved.forEach((u) => console.log("  [解析失敗] " + u.where + "：「" + u.ja + "」 tokens=" + JSON.stringify(u.tokens)));
}

console.log("\n" + "=".repeat(64));
const unhandled = partA.filter((p) => !p.handled);
console.log("A：兩種寫法並存的字組 " + partA.length + " 組（其中 " + unhandled.length + " 組尚未摺疊）");
console.log("B：解析失敗的敵人引用 " + unresolved.length + " 筆");
if (unresolved.length) {
  console.log("\n結果：有解析失敗的引用，請比照 竜/龍 的作法處理（Enemies.js 的 KANJI_VARIANTS 或修正轉錄）");
  process.exit(1);
}
console.log("\n結果：沒有任何敵人引用解析失敗。A 區只是潛在風險提示，不代表目前有 bug。");
