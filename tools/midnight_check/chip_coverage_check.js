// ============================================================================
// 夜王 × 地圖 × 籌碼 交叉測試：每個籌碼點都有線路能完成（純 node，不需 Playwright／emulator）
// ============================================================================
// 2026-09-24 使用者需求：「所有夜王×地圖，經過每個板塊、每個籌碼都有線路能完成，特別是
// JQK、籌碼封牢；另外告訴我 JQ 結果與隨機事件結果」。
//
// 分工：**板塊**（2〜10／J／Q／K，含封牢＝card 9）的樓層 pipeline 由既有的
// scenario_map_cross_check.js 負責（那支已涵蓋 ghost_floor／決定表對不到／花色等）。
// 這一支負責它沒有涵蓋的另一半——**籌碼點**：地圖上非板塊的那些點，走過去會不會
// 「什麼都沒發生」。
//
// 驗證方式同 scenario_map_cross_check.js：把 midnight 頁實際載入的全部模組載進 vm sandbox，
// midnight.js 載入前以字串注入把籌碼解決流程的內部函式掛到 window.__PriTestMidnightInternals，
// 直接呼叫 App 真正在跑的同一份實作，不另外重寫一份規則。
//
// 對每一個「夜王（劇本）× 地圖變體 × 種子」：
//   1. generateMap() 真的生成地圖，列出所有點。
//   2. 每個點依 type 分類：板塊（交給另一支）／已知籌碼／未知。
//   3. 對兩種「靠決定表解決」的籌碼，實際擲表 ROLLS_PER_POINT 次：
//      ・強敵籌碼 strong_enemy：一般表（extraTables[0]）與恐るべき強敵表（extraTables[1]，
//        Day2 的⑧點）都要擲，每一次都必須解析出真實敵人與 Lv≥1。
//      ・隨機事件籌碼 random_event：帶入該夜王對應的劇本編號擲表（表裡有 5 列是劇本限定），
//        每一次都必須得到分支名稱，且該名稱要有對應的 renderer 畫得出來。
//   4. 判定（嚴重＝exit 1）：
//      ・unknown_point_type ：地圖上出現這支腳本不認得的點型＝沒人保證它會不會卡住。
//      ・strong_enemy_dead  ：強敵表擲不出敵人（連亂數退回都失敗）＝走過去沒有戰鬥。
//      ・strong_enemy_level ：擲出的等級 <1＝敵人資料對不上。
//      ・random_event_dead  ：隨機事件擲不出任何分支＝走過去什麼都不會發生。
//      ・random_event_no_renderer：分支名稱沒有對應 renderer＝畫面上是空白。
//    備註（不算失敗）：
//      ・enemy_fallback     ：決定表條目對不到敵人資料，走 randomEnemyMatchFallback()。
//      ・branch_fallback    ：劇本限定列全部不中，走 randomEventFallbackBranchName()
//                            （這是 2026-09-13 使用者明確規格「允許亂數決定一件」的行為）。
//
// 另外輸出（使用者要求）：
//   ・隨機事件結果一覽：每個夜王實際抽得到哪些分支、各出現幾次。
//   ・J／Q 的決定結果請看 scenario_map_cross_check.js 的同名區塊（那支才有樓層資訊）。
//
// 執行：node chip_coverage_check.js [--seeds N] [--rolls N] [--verbose]
// ============================================================================
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SRC = process.env.PRITEST_SRC || path.resolve(__dirname, "../../static_src");
const argv = process.argv.slice(2);
const VERBOSE = argv.indexOf("--verbose") !== -1;
const readNum = (flag, dflt) => {
  const i = argv.indexOf(flag);
  return i !== -1 ? parseInt(argv[i + 1], 10) || dflt : dflt;
};
const SEEDS_PER_VARIANT = readNum("--seeds", 6);
const ROLLS_PER_POINT = readNum("--rolls", 40);
const SEED_SCAN_LIMIT = 400;

// ---- sandbox（同 scenario_map_cross_check.js：midnight.js 載入本身只需最小 stub）----
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
const warnings = [];
const sandbox = {
  console: { log() {}, warn(m) { warnings.push(String(m)); }, error(m) { warnings.push(String(m)); } },
  setTimeout, clearTimeout, setInterval, clearInterval, Math, Date, JSON, Promise,
  document: {
    createElement: () => stubEl(), createTextNode: () => stubEl(), getElementById: () => stubEl(),
    querySelector: () => stubEl(), querySelectorAll: () => [], addEventListener() {},
    body: stubEl(), documentElement: stubEl(), activeElement: null, hidden: false,
  },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  navigator: { userAgent: "node" },
  location: { search: "", href: "", hash: "" },
  requestAnimationFrame: () => 0, cancelAnimationFrame() {},
  performance: { now: () => Date.now() },
  Image: function () { return stubEl(); },
  Audio: function () { return stubEl(); },
  addEventListener() {}, removeEventListener() {},
};
sandbox.window = sandbox;
sandbox.I18N = { t: (k) => k, getLang: () => "zh", current: () => "zh", apply() {} };
vm.createContext(sandbox);

const MIDNIGHT_PAGE_SCRIPTS = [
  "firebase_config.js", "game_storage.js", "scenarios.js", "night_bosses.js", "night_boss_rulebook.js",
  "boss_auto_gm_data.js", "fields_data_1.js", "fields_data_2.js", "fields_data_3.js", "fields_data_4.js",
  "fields.js", "enemies_data_1.js", "enemies_data_2.js", "enemies_data_3.js", "enemies_data_4.js",
  "enemies.js", "auto_gm.js", "character_types.js", "weapons_categories.js", "weapons_skills.js",
  "weapons_data.js", "weapons.js", "weapon_rulebook.js", "talismans.js", "consumables.js", "graces.js",
  "field_rules.js", "character_drawer.js", "event_rulebook.js", "night_floor_breakthrough.js",
  "worldview.js", "night_gm_flow.js", "midnight_puzzles.js", "midnight_random_events.js",
  "midnight_map_variants.js", "midnight_map.js", "midnight_text_adapt.js", "weapon_affixes.js",
  "enemy_sprite_data.js", "enemy_sprite_registry.js", "enemy_action_anim_map.js", "midnight_sprite.js",
  "enemy_counter_rules.js",
];
MIDNIGHT_PAGE_SCRIPTS.forEach((f) => vm.runInContext(fs.readFileSync(path.join(SRC, f), "utf8"), sandbox, { filename: f }));

const INTERNAL_NAMES = [
  "findEventChip",
  "randomEnemyMatchFallback",
  "normalizeRandomEventBranchName",
  "randomEventFallbackBranchName",
  "resolveNightBossScenarioId",
  "currentLBonus",
  "RANDOM_EVENT_RENDERERS",
  "NON_FIELD_POINT_TYPES",
  "L_BONUS_TEXT_RE",
];
let mnSrc = fs.readFileSync(path.join(SRC, "midnight.js"), "utf8");
const anchor = "window.PriTestMidnight = {";
if (mnSrc.indexOf(anchor) === -1) throw new Error("找不到 window.PriTestMidnight 匯出點——midnight.js 結構已變，請更新這支腳本");
mnSrc = mnSrc.replace(
  anchor,
  "window.__PriTestMidnightInternals = { " +
    INTERNAL_NAMES.map((n) => n + ": " + n).join(", ") +
    ", _setContext: function (m, mp) { meta = m; map = mp; fieldProgress = {}; fieldTriggers = {}; } };\n  " +
    anchor
);
vm.runInContext(mnSrc, sandbox, { filename: "midnight.js" });

const IN = sandbox.window.__PriTestMidnightInternals;
INTERNAL_NAMES.forEach((n) => {
  if (IN[n] === undefined) throw new Error("內部符號 " + n + " 注入失敗——請確認 midnight.js 是否仍有此定義");
});
const Map_ = sandbox.window.PriTestMidnightMap;
const Variants = sandbox.window.PriTestMidnightMapVariants;
const Scenarios = sandbox.window.PriTestScenarios;
const GmFlow = sandbox.window.PriTestNightGmFlow;
const zh = (f) => (f && (f.zh || f.ja)) || "";

// ============================================================================
// 地圖集合（同 scenario_map_cross_check.js：掃種子直到每個變體各湊到 SEEDS_PER_VARIANT 張）
// ============================================================================
const VARIANT_IDS = ["basic"].concat((Variants.list() || []).map((v) => v.id || v));
const mapsByVariant = {};
VARIANT_IDS.forEach((v) => (mapsByVariant[v] = []));
for (let i = 0; i < SEED_SCAN_LIMIT && VARIANT_IDS.some((v) => mapsByVariant[v].length < SEEDS_PER_VARIANT); i++) {
  const seed = "chipseed" + i;
  VARIANT_IDS.forEach((v) => {
    if (mapsByVariant[v].length >= SEEDS_PER_VARIANT) return;
    mapsByVariant[v].push({ seed, map: Map_.generateMap(seed, v) });
  });
}

const scenarios = Scenarios.list()
  .filter((s) => !Scenarios.isCustom || !Scenarios.isCustom(s.id))
  .map((s) => ({
    id: s.id,
    number: Scenarios.numberForId(s.id),
    boss: zh(s.bossName || s.name).slice(0, 8),
    label: Scenarios.numberForId(s.id) + "." + zh(s.bossName || s.name).slice(0, 8),
  }));

// ============================================================================
// 籌碼分類：地圖上每一種點型都必須落在這三類之一，否則就是 unknown_point_type。
// 板塊（含封牢 card 9、K、Q、J）交給 scenario_map_cross_check.js；這裡只記數。
// ============================================================================
const FIELD_CARD_TYPES = new Set(["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "evergaol", "hazard_q"]);
// 這幾種籌碼沒有決定表，走過去就是固定互動（靈脈＝祝福、商人、教會、鍛造、魔術師塔解謎），
// 它們各自的流程由專屬的回歸測試涵蓋（見下方 HANDLED_ELSEWHERE 的註記），這裡只確認
// 它們確實是「已知且有 handler」的點型，不會變成沒人管的空點。
const HANDLED_ELSEWHERE = {
  blessing: "靈脈／祝福籌碼（使用祝福→升級，見 pause_flow_check.js 以外的既有祝福流程）",
  merchant: "商人籌碼（new_chips_check.js）",
  church: "教會（固定互動）",
  forge: "鍛造（merchant/forge 流程）",
  sorcerer: "魔術師塔解謎（midnight_puzzles.js／random_event_coverage_check.js 的塔邀請段）",
};
const TABLE_DRIVEN = new Set(["strong_enemy", "random_event"]);
// 使用者明確規格（2026-09-24）：隨機事件籌碼每張地圖配置 2 個。
const RANDOM_EVENT_PER_MAP = 2;

const rendererNames = new Set(Object.keys(IN.RANDOM_EVENT_RENDERERS || {}));

// ============================================================================
// 擲表
// ============================================================================
function rollStrongEnemyOnce(tableIndex) {
  const chip = IN.findEventChip("strong_enemy");
  const table = chip && chip.extraTables && chip.extraTables[tableIndex];
  if (!table) return { ok: false, reason: "找不到強敵決定表 extraTables[" + tableIndex + "]" };
  const rolled = GmFlow ? GmFlow.rollStrongEnemyTable(table) : null;
  const parsed = rolled ? GmFlow.extractLevelAndNameTokens((rolled.entry && rolled.entry.ja) || "") : { level: 0, nameTokens: [] };
  let match = null;
  for (let i = 0; i < parsed.nameTokens.length && !match; i++) match = GmFlow.resolveCombatEnemyMatch(parsed.nameTokens[i]);
  let fallback = false;
  if (!match) {
    match = IN.randomEnemyMatchFallback("chip_coverage:" + tableIndex + ":" + Math.random());
    fallback = true;
  }
  if (!match) return { ok: false, reason: "連亂數退回都取不到敵人" };
  // L補只在決定表條目寫了「+L補正」時才加；這裡沒有真正的 phaseInfo，用 0，等級下限驗 >=1。
  const level = (parsed.level || 1) + ((rolled && rolled.levelBonus) || 0);
  return { ok: true, fallback, level, enemy: match.enemy && match.enemy.id, family: match.familyId, entry: ((rolled && rolled.entry && rolled.entry.ja) || "").split("（")[0] };
}

function rollRandomEventOnce(scenarioNumber) {
  const chip = IN.findEventChip("random_event");
  const table = chip && chip.extraTables && chip.extraTables[0];
  if (!table) return { ok: false, reason: "找不到隨機事件決定表" };
  const rolled = GmFlow ? GmFlow.rollRandomEventTable(table, scenarioNumber) : null;
  if (!rolled) {
    const fb = IN.randomEventFallbackBranchName(table);
    if (!fb) return { ok: false, reason: "劇本限定列全部不中，且連亂數退回的分支名稱都湊不出來" };
    return { ok: true, fallback: true, branch: IN.normalizeRandomEventBranchName(String(fb).split("（")[0]) };
  }
  const branch = IN.normalizeRandomEventBranchName(((rolled.entry && rolled.entry.ja) || "").split("（")[0]);
  if (!branch) return { ok: false, reason: "決定表條目正規化後得到空的分支名稱" };
  return { ok: true, fallback: false, branch };
}

// ============================================================================
// 決定表逐列解析（在擲表之前先做）：每一列的敵人引用都必須解析得到真實敵人。
// 這是 2026-09-24 加的——只靠「擲表 N 次有沒有卡住」抓不到這種問題，因為解析失敗會靜默
// 退回 randomEnemyMatchFallback()，測試看起來照樣「完成」，但玩家拿到的是亂數敵人而不是
// 規則書指定的那一隻。實際就是這樣揪出「竜のツリーガード」的新舊字體不一致
// （event_rulebook.js 寫新字體「竜」、enemies_data_3.js 寫舊字體「龍」）。
// 「レベルを+1して振り直す」這種再擲指示不是敵人引用，由 rollStrongEnemyTable() 自己處理
// （回傳 levelBonus），所以跳過。
// ============================================================================
const REROLL_ROW_RE = /振り直|振直|再[擲振]/;
const tableRowIssues = [];
[0, 1].forEach((ti) => {
  const chip = IN.findEventChip("strong_enemy");
  const table = chip && chip.extraTables && chip.extraTables[ti];
  if (!table) {
    tableRowIssues.push({ kind: "table_missing", text: "強敵決定表 extraTables[" + ti + "] 不存在" });
    return;
  }
  (table.rows || []).forEach((row, ri) => {
    const ja = (row[1] && row[1].ja) || "";
    if (REROLL_ROW_RE.test(ja)) return;
    const parsed = GmFlow.extractLevelAndNameTokens(ja);
    let m = null;
    for (let i = 0; i < parsed.nameTokens.length && !m; i++) m = GmFlow.resolveCombatEnemyMatch(parsed.nameTokens[i]);
    if (!m) {
      tableRowIssues.push({
        kind: "table_row_unresolved",
        text:
          (ti === 0 ? "強敵決定表" : "可怖強敵決定表") + " 第 " + (ri + 1) + " 列「" + ja.split("（")[0] +
          "」解析不到敵人 → 會靜默退回亂數敵人（tokens=" + JSON.stringify(parsed.nameTokens) + "）",
      });
    }
  });
});

// ============================================================================
// 主迴圈
// ============================================================================
const issues = [];
const notes = [];
const pointTypeCounts = {};
const randomEventByScenario = {};   // label -> { branch -> count }
const strongEnemyByTable = { 0: {}, 1: {} }; // tableIndex -> { enemyId -> count }
const matrix = {};
let chipPointTotal = 0;
let fieldPointTotal = 0;

scenarios.forEach((sc) => {
  matrix[sc.label] = {};
  randomEventByScenario[sc.label] = {};
  VARIANT_IDS.forEach((variantId) => {
    let severe = 0;
    let note = 0;
    mapsByVariant[variantId].forEach(({ seed, map }) => {
      const meta = { mapSeed: seed, mapVariant: variantId, nightBossScenarioId: sc.id, sessionStartAt: Date.now() };
      IN._setContext(meta, map);

      // 2026-09-24 使用者明確規格「隨機事件 每個地圖配置兩個」：實測 5 個變體 × 40 張種子
      // 本來就都是 2 個，這裡把它釘住，避免之後動地圖生成時無聲少放一個。
      const randomEventCount = (map.points || []).filter((p) => p.type === "random_event").length;
      if (randomEventCount !== RANDOM_EVENT_PER_MAP) {
        issues.push({
          kind: "random_event_count",
          sc: sc.label, variantId, seed,
          text: "這張地圖的隨機事件籌碼有 " + randomEventCount + " 個，規格是 " + RANDOM_EVENT_PER_MAP + " 個",
        });
        severe++;
      }

      (map.points || []).forEach((pt) => {
        pointTypeCounts[pt.type] = (pointTypeCounts[pt.type] || 0) + 1;
        if (FIELD_CARD_TYPES.has(String(pt.type)) || FIELD_CARD_TYPES.has(String(pt.card))) {
          fieldPointTotal++;
          return; // 板塊：交給 scenario_map_cross_check.js
        }
        if (HANDLED_ELSEWHERE[pt.type]) {
          chipPointTotal++;
          return;
        }
        if (!TABLE_DRIVEN.has(pt.type)) {
          issues.push({ kind: "unknown_point_type", sc: sc.label, variantId, seed, text: "地圖上出現不認得的點型「" + pt.type + "」（id=" + pt.id + "）" });
          severe++;
          return;
        }
        chipPointTotal++;

        if (pt.type === "strong_enemy") {
          // 一般強敵表與「恐るべき強敵」表都要能解出敵人（後者是 Day2 的⑧點）。
          [0, 1].forEach((ti) => {
            for (let r = 0; r < ROLLS_PER_POINT; r++) {
              const res = rollStrongEnemyOnce(ti);
              if (!res.ok) {
                issues.push({ kind: "strong_enemy_dead", sc: sc.label, variantId, seed, text: "強敵決定表[" + ti + "]：" + res.reason });
                severe++;
                return;
              }
              if (res.level < 1) {
                issues.push({ kind: "strong_enemy_level", sc: sc.label, variantId, seed, text: "強敵決定表[" + ti + "] 擲出等級 " + res.level });
                severe++;
                return;
              }
              if (res.fallback) {
                notes.push({ kind: "enemy_fallback", sc: sc.label, variantId, text: "強敵決定表[" + ti + "]「" + res.entry + "」對不到敵人資料，走亂數退回" });
                note++;
              }
              strongEnemyByTable[ti][res.enemy] = (strongEnemyByTable[ti][res.enemy] || 0) + 1;
            }
          });
        }

        if (pt.type === "random_event") {
          for (let r = 0; r < ROLLS_PER_POINT; r++) {
            const res = rollRandomEventOnce(sc.number);
            if (!res.ok) {
              issues.push({ kind: "random_event_dead", sc: sc.label, variantId, seed, text: res.reason });
              severe++;
              break;
            }
            if (!rendererNames.has(res.branch)) {
              issues.push({
                kind: "random_event_no_renderer",
                sc: sc.label, variantId, seed,
                text: "分支「" + res.branch + "」沒有對應的 renderer（畫面會是空白）",
              });
              severe++;
              break;
            }
            const key = res.branch + (res.fallback ? "（亂數退回）" : "");
            randomEventByScenario[sc.label][key] = (randomEventByScenario[sc.label][key] || 0) + 1;
            if (res.fallback) note++;
          }
        }
      });
    });
    matrix[sc.label][variantId] = severe + "/" + note;
  });
});

// ============================================================================
// 輸出
// ============================================================================
console.log("夜王 × 地圖 × 籌碼 交叉測試（籌碼點會不會「走過去什麼都沒發生」）");
console.log(
  "地圖變體：" + VARIANT_IDS.map((v) => v + "×" + mapsByVariant[v].length + "種子").join("、") +
    "；夜王（劇本）：" + scenarios.length +
    "；每個籌碼點擲表 " + ROLLS_PER_POINT + " 次"
);
console.log("模擬點合計：板塊 " + fieldPointTotal + "（交給 scenario_map_cross_check.js）／籌碼 " + chipPointTotal);

console.log("\n=== 地圖上出現的點型 ===");
Object.keys(pointTypeCounts)
  .sort()
  .forEach((t) => {
    const cls = FIELD_CARD_TYPES.has(t) ? "板塊" : HANDLED_ELSEWHERE[t] ? "籌碼（固定互動）" : TABLE_DRIVEN.has(t) ? "籌碼（決定表驅動）" : "**未知**";
    console.log("  " + t.padEnd(14) + " ×" + String(pointTypeCounts[t]).padStart(5) + "   " + cls + (HANDLED_ELSEWHERE[t] ? " — " + HANDLED_ELSEWHERE[t] : ""));
  });

console.log("\n=== 矩陣（每格＝嚴重問題數／備註數） ===");
const header = "  夜王（劇本）".padEnd(22) + VARIANT_IDS.map((v) => v.padEnd(12)).join("");
console.log(header);
scenarios.forEach((sc) => {
  console.log("  " + sc.label.padEnd(20, "　").slice(0, 20) + VARIANT_IDS.map((v) => (matrix[sc.label][v] || "-").padEnd(12)).join(""));
});

console.log("\n=== 隨機事件結果一覽（每個夜王實際抽得到的分支／出現次數） ===");
scenarios.forEach((sc) => {
  const m = randomEventByScenario[sc.label];
  const keys = Object.keys(m).sort((a, b) => m[b] - m[a]);
  if (!keys.length) {
    console.log("  " + sc.label + "：（這些地圖上沒有隨機事件籌碼點）");
    return;
  }
  console.log("  " + sc.label + "：" + keys.map((k) => k + "×" + m[k]).join("、"));
});

console.log("\n=== 強敵決定表抽得到的敵人（去重） ===");
[0, 1].forEach((ti) => {
  const m = strongEnemyByTable[ti];
  const keys = Object.keys(m).sort((a, b) => m[b] - m[a]);
  console.log("  " + (ti === 0 ? "一般強敵決定表" : "恐るべき強敵決定表") + "：共 " + keys.length + " 種 → " + keys.slice(0, 18).join("、") + (keys.length > 18 ? " …" : ""));
});

if (notes.length) {
  const byKind = {};
  notes.forEach((n) => (byKind[n.kind] = (byKind[n.kind] || 0) + 1));
  console.log("\n=== 備註（不算失敗） ===");
  Object.keys(byKind).forEach((k) => console.log("  [" + k + "] ×" + byKind[k]));
  if (VERBOSE) notes.slice(0, 40).forEach((n) => console.log("    " + n.sc + " × " + n.variantId + "：" + n.text));
}

if (warnings.length && VERBOSE) {
  console.log("\n=== 載入期 console 警告 ===");
  [...new Set(warnings)].slice(0, 10).forEach((w) => console.log("  " + w));
}

console.log("\n=== 決定表逐列解析 ===");
if (!tableRowIssues.length) console.log("  強敵決定表／可怖強敵決定表：每一列的敵人引用都解析得到真實敵人");
tableRowIssues.forEach((t) => {
  console.log("  [" + t.kind + "] " + t.text);
  issues.push({ kind: t.kind, sc: "-", variantId: "-", seed: "-", text: t.text });
});

console.log("\n" + "=".repeat(60));
if (issues.length) {
  const byKind = {};
  issues.forEach((i) => (byKind[i.kind] = (byKind[i.kind] || 0) + 1));
  console.log("嚴重問題 " + issues.length + " 件：");
  Object.keys(byKind).forEach((k) => console.log("  [" + k + "] ×" + byKind[k]));
  issues.slice(0, 30).forEach((i) => console.log("  " + i.sc + " × " + i.variantId + " (" + i.seed + ")：" + i.text));
  process.exit(1);
}
console.log("結果：全部通過（每個籌碼點都有線路能完成）");
