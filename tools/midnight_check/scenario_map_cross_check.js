// ============================================================================
// 劇本 × 地圖 交叉測試：板塊會不會卡死／有沒有對應的決定表可抽（純 node，不需 Playwright／emulator）
// ============================================================================
// 2026-09-22 使用者需求：「交叉測試所有劇本×地圖，那些板塊會卡死或是沒有對應的決定表來抽，
// 避免沒有抽任何獎勵或是敵人而直接踏破地圖的可能性」。
//
// 驗證方式：把 midnight 頁實際載入的全部 static_src 模組（順序照 site_src/midnight_page.py
// 的 extra_scripts）載進 vm sandbox，midnight.js 於載入前以字串注入把板塊樓層 pipeline 的
// 內部函式掛到 window.__PriTestMidnightInternals，直接呼叫 App 真正在跑的同一份實作
// （pickFieldBranchIndex／fieldFloorCountForCard／fieldFloorForTrig／fieldChoiceLabelsFor／
// collectLinesForChoice／scanLinesForEnemyMatches），不另外重寫一份規則。
//
// 對每一個「劇本 × 地圖變體 × 種子」：
//   1. 用 midnight_map.js generateMap() 真的生成地圖，取出所有走樓層 pipeline 的點
//      （2〜10／K／Q；魔術師塔除外）＋ 王城 J（地圖的 castleZone 有範圍才算，使用者規格
//      「原本地圖沒有 J 則可納入不計」）。
//   2. 對每個點，照 midnight 的流程走完全部樓層：挑分歧 → 每一層取樓層 → 解析「(→XXX)」
//      選項 → 對每一個選項掃敵人引用（含卡片自身 extraTables 決定表）→ 讀樓層獎勵。
//   3. 判定（嚴重＝exit 1）：
//      ・ghost_floor      ：樓層取不到（fieldFloorForTrig 回 null）＝原本會卡死的情況。
//      ・table_unresolved ：bullet 引用「◯◯決定表」但找不到對應的表（卡片 extraTables／
//                          強敵籌碼表都沒有）→ 這一行被當成敵名去查、永遠查不到。
//      ・enemy_unmatched  ：規則書 bullet 明寫敵人（「名(頁)/Lv.N」或決定表引用），但 midnight
//                          解析不出任何敵人→整層誤判成和平通過（＝沒抽敵人就踏破）。
//      ・variance_mismatch：J／Q 的分歧或花色跟卡片 varianceTable／劇本配置表對不上——
//                          使用者規格「決定表先以劇本對應的夜王來決定；地變則以地圖優先、
//                          再根據劇本；都沒有則直接抽選一個劇本的抽選表」。
//      ・suit_duplicate   ：同一張板塊走到的樓層裡，同一層的不同花色變體被當成不同樓層
//                          連續踏破（例：J 砦的 (♥)(◇)(♣) 正門広場），因此有樓層永遠走不到。
//      ・suit_mismatch    ：已決定花色、且該花色有對應變體，卻走到別的花色版本。
//    備註（不算失敗）：
//      ・enemy_fallback   ：決定表擲出的條目對不到敵人資料，退回亂數敵人。
//      ・suit_fallback    ：該花色沒有對應變體（例：劇本 5 的 J 是 ♠，正門広場只有 ♥◇♣），改抽。
//      ・tier_unmatched   ：tieredChoice 沒有 tier 對得上投票標籤，該層不發戰利品（規則書該
//                          路線本來就是判定結果，不是漏抽）。
//      ・empty_tile       ：存在「每一層都既無敵人也無戰利品」的路徑（規則書本文如此）。
//      ・variance_fallback：劇本在決定表沒有列（Q 的劇本 1〜4、自訂劇本），改抽任一劇本的表。
//
// 執行：node scenario_map_cross_check.js [--md] [--seeds N] [--verbose]
// ============================================================================
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SRC = process.env.PRITEST_SRC || path.resolve(__dirname, "../../static_src");
const argv = process.argv.slice(2);
const AS_MD = argv.indexOf("--md") !== -1;
const VERBOSE = argv.indexOf("--verbose") !== -1;
const seedsArgIdx = argv.indexOf("--seeds");
const SEEDS_PER_VARIANT = seedsArgIdx !== -1 ? parseInt(argv[seedsArgIdx + 1], 10) || 6 : 6;
const SEED_SCAN_LIMIT = 400;

// ---- sandbox（midnight.js 只在 DOMContentLoaded 之後才碰 DOM／RTDB，載入本身只需最小 stub）----
function stubEl() {
  const e = {
    style: {},
    dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    hidden: false,
    textContent: "",
    innerHTML: "",
    value: "",
    options: [],
    children: [],
    appendChild: () => e,
    removeChild() {},
    setAttribute() {},
    getAttribute: () => null,
    addEventListener() {},
    removeEventListener() {},
    querySelector: () => stubEl(),
    querySelectorAll: () => [],
    getContext: () => null,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }),
    focus() {},
    blur() {},
    insertBefore() {},
  };
  return e;
}
const warnings = [];
const sandbox = {
  console: {
    log() {},
    warn(msg) {
      warnings.push(String(msg));
    },
    error(msg) {
      warnings.push(String(msg));
    },
  },
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  Math,
  Date,
  JSON,
  Promise,
  document: {
    createElement: () => stubEl(),
    createTextNode: () => stubEl(),
    getElementById: () => stubEl(),
    querySelector: () => stubEl(),
    querySelectorAll: () => [],
    addEventListener() {},
    body: stubEl(),
    documentElement: stubEl(),
    activeElement: null,
    hidden: false,
  },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  navigator: { userAgent: "node" },
  location: { search: "", href: "", hash: "" },
  requestAnimationFrame: () => 0,
  cancelAnimationFrame() {},
  performance: { now: () => Date.now() },
  Image: function () {
    return stubEl();
  },
  Audio: function () {
    return stubEl();
  },
  addEventListener() {},
  removeEventListener() {},
};
sandbox.window = sandbox;
sandbox.I18N = { t: (k) => k, getLang: () => "zh", current: () => "zh", apply() {} };
vm.createContext(sandbox);

// 順序照 site_src/midnight_page.py 的 extra_scripts（midnight.js 除外，最後注入後再載）
const MIDNIGHT_PAGE_SCRIPTS = [
  "firebase_config.js",
  "game_storage.js",
  "scenarios.js",
  "night_bosses.js",
  "night_boss_rulebook.js",
  "boss_auto_gm_data.js",
  "fields_data_1.js",
  "fields_data_2.js",
  "fields_data_3.js",
  "fields_data_4.js",
  "fields.js",
  "enemies_data_1.js",
  "enemies_data_2.js",
  "enemies_data_3.js",
  "enemies_data_4.js",
  "enemies.js",
  "auto_gm.js",
  "character_types.js",
  "weapons_categories.js",
  "weapons_skills.js",
  "weapons_data.js",
  "weapons.js",
  "weapon_rulebook.js",
  "talismans.js",
  "consumables.js",
  "graces.js",
  "field_rules.js",
  "character_drawer.js",
  "event_rulebook.js",
  "night_floor_breakthrough.js",
  "worldview.js",
  "night_gm_flow.js",
  "midnight_puzzles.js",
  "midnight_random_events.js",
  "midnight_map_variants.js",
  "midnight_map.js",
  "midnight_text_adapt.js",
  "weapon_affixes.js",
  "enemy_sprite_data.js",
  "enemy_sprite_registry.js",
  "enemy_action_anim_map.js",
  "midnight_sprite.js",
  "enemy_counter_rules.js",
];
MIDNIGHT_PAGE_SCRIPTS.forEach((f) => vm.runInContext(fs.readFileSync(path.join(SRC, f), "utf8"), sandbox, { filename: f }));

const INTERNAL_NAMES = [
  "pickFieldBranchIndex",
  "resolveFieldVariant",
  "fieldEffectiveFloors",
  "findEnemyDecisionTableForLine",
  "tieredChoiceTierMatchesVoteLabel",
  "fieldFloorCountForCard",
  "fieldFloorForTrig",
  "fieldChoiceLabelsFor",
  "collectLinesForChoice",
  "scanLinesForEnemyMatches",
  "randomEnemyMatchFallback",
  "fieldCardData",
  "fieldCardBranches",
  "resolveNightBossScenarioId",
  "mapHasCastle",
  "parseAllFloorEffectRuneAmount",
  "isJudgmentRewardEntryLocal",
  "NON_FIELD_POINT_TYPES",
  "CASTLE_POINT_ID",
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
const Fields = sandbox.window.PriTestFields;
const GmFlow = sandbox.window.PriTestNightGmFlow;
const Scenarios = sandbox.window.PriTestScenarios;
const FloorBreakthrough = sandbox.window.PriTestNightFloorBreakthrough;
const zh = (f) => (f && (f.zh || f.ja)) || "";

// ============================================================================
// 地圖集合：掃種子直到每個變體（basic／cassel／ice／kasan／red）各湊到 SEEDS_PER_VARIANT 張
// ============================================================================
const VARIANT_IDS = ["basic"].concat(Variants && Variants.list ? Variants.list() : ["cassel", "ice", "kasan", "red"]);
const mapsByVariant = {};
VARIANT_IDS.forEach((id) => (mapsByVariant[id] = []));
for (let seed = 1; seed <= SEED_SCAN_LIMIT; seed++) {
  const need = VARIANT_IDS.some((id) => mapsByVariant[id].length < SEEDS_PER_VARIANT);
  if (!need) break;
  if (mapsByVariant.basic.length < SEEDS_PER_VARIANT) mapsByVariant.basic.push({ seed, setting: "basic", map: Map_.generateMap(seed, "basic") });
  const full = Map_.generateMap(seed, "full");
  if (full.variantId !== "basic" && mapsByVariant[full.variantId] && mapsByVariant[full.variantId].length < SEEDS_PER_VARIANT) {
    mapsByVariant[full.variantId].push({ seed, setting: "full", map: full });
  }
}

// ============================================================================
// 劇本集合：10 個規則書劇本 ＋ 1 個自訂劇本（沒有規則書編號＝所有依劇本的查表都查不到）
// ============================================================================
const scenarios = Scenarios.list()
  .filter((s) => Scenarios.numberForId(s.id) !== null)
  .map((s) => ({ id: s.id, number: Scenarios.numberForId(s.id), label: Scenarios.numberForId(s.id) + "." + zh(s.bossName || s.name).slice(0, 6), scenario: s }));
scenarios.push({ id: "custom_cross_check", number: null, label: "自訂劇本", scenario: null });

// ============================================================================
// varianceTable 期望（使用者規格）：
//   J：以劇本對應的夜王（劇本編號）查 card_j.varianceTable 得到內容名；沒有 J 的地圖不計。
//   Q：地圖優先（變體 qNames 已指定分歧），再依劇本查 card_q.varianceTable；都沒有則隨便抽
//      一個劇本的表（＝任一 varianceTable 內容都算合格）。
// ============================================================================
function varianceRowsForScenario(card, scenarioNumber) {
  const table = card && card.varianceTable;
  if (!table || scenarioNumber === null) return [];
  const out = [];
  let currentScenarioCell = "";
  table.rows.forEach((row) => {
    const cell = zh(row[0]).trim();
    if (cell) currentScenarioCell = cell;
    if (scenarioCellMatches(currentScenarioCell, scenarioNumber)) out.push({ suit: zh(row[1]), content: zh(row[2]) });
  });
  return out;
}
function scenarioCellMatches(cell, n) {
  return cell.split(/[、,，]/).some((part) => {
    const range = /^(\d+)\s*[〜～~]\s*(\d+)$/.exec(part.trim());
    if (range) return n >= parseInt(range[1], 10) && n <= parseInt(range[2], 10);
    return parseInt(part, 10) === n;
  });
}
function allVarianceContents(card) {
  return ((card && card.varianceTable && card.varianceTable.rows) || []).map((row) => zh(row[2]));
}
// 分歧名稱跟 varianceTable 內容的對應：內容「西の地下砦」對應分歧「西の地下砦（♠♥）」、
// 「(黒陶)西の地下砦」也對應同一個分歧（去掉括號註記後前綴比對）。
function branchMatchesContent(branchName, content) {
  const norm = (s) =>
    String(s || "")
      .replace(/[（(][^）)]*[）)]/g, "")
      .replace(/\s+/g, "")
      .trim();
  const a = norm(branchName);
  const b = norm(content);
  return !!a && !!b && (a === b || a.indexOf(b) === 0 || b.indexOf(a) === 0);
}

// 規則書把敵名寫成bullet行的「」引用：具體敵名帶「(NNN頁)」或「Lv.N」，決定表引用帶「決定表」。
// 這兩種行代表「規則書說這裡有敵人」，midnight 若解析不出任何敵人就是漏掉戰鬥。
function bulletInner(line) {
  const ja = (line.text && line.text.ja) || "";
  const z = (line.text && line.text.zh) || "";
  return (/「([^」]+)」/.exec(ja) || /「([^」]+)」/.exec(z) || [])[1] || "";
}
// 敵人決定表引用：「◯◯エネミー決定表で決定したエネミー」「強敵決定表（319頁）で抽選」等；
// 「ランダム戦技決定表」（鍛造台重抽戰技）這種非敵人的表不算。
function isTableRefLine(line) {
  const inner = bulletInner(line);
  return !!line.bullet && /決定表/.test(inner) && /エネミー|敵人|強敵|で決定した|で抽選|決定的/.test(inner);
}
// 具體敵名引用一律帶 Lv（「人さらいの乙女人形たち(225頁)/Lv.5 + L補」）；只有頁碼的是武器
// 屬性等參照（「凍傷／－5（154頁）」），不是敵人。
function isConcreteEnemyRefLine(line) {
  const inner = bulletInner(line);
  return !!line.bullet && !/決定表/.test(inner) && /Lv\.?\s*\d/i.test(inner);
}

// 純函式版的獎勵解析（對照 midnight.js resolveJudgmentRewardEntries()，不含 RTDB 副作用）：
// 回傳 { loot: [kind...], unmatchedTiers: n, judgmentOnly: [kind...] }。tieredChoice 依投票
// 標籤挑 tier（同 tieredChoiceTierMatchesVoteLabel），沒有任何 tier 對得上就什麼都不發。
function evaluateRewards(entries, voteLabel) {
  const out = { loot: [], unmatchedTiers: 0, judgmentOnly: [] };
  (entries || []).forEach((entry) => {
    if (FloorBreakthrough && FloorBreakthrough.isLootRewardEntry(entry)) {
      out.loot.push(entry.kind + (entry.value !== undefined ? ":" + entry.value : ""));
    } else if (entry.kind === "tieredChoice") {
      const tier = (entry.tiers || []).filter((t) => IN.tieredChoiceTierMatchesVoteLabel(t.label, voteLabel))[0];
      if (!tier) out.unmatchedTiers++;
      else {
        const sub = evaluateRewards(tier.rewards, voteLabel);
        out.loot = out.loot.concat(sub.loot);
        out.unmatchedTiers += sub.unmatchedTiers;
        out.judgmentOnly = out.judgmentOnly.concat(sub.judgmentOnly);
      }
    } else if (entry.kind === "diceHandChoice") {
      // 12顆骰擲役：每一種役都有 rewards，實際擲到哪一種不影響「有沒有東西」
      out.loot.push("diceHandChoice");
    } else if (entry.kind === "bargainReveal") {
      out.loot.push("bargainReveal"); // 取引視窗，玩家自行選 deal
    } else {
      out.judgmentOnly.push(entry.kind); // hpDamage／note：不是戰利品
    }
  });
  return out;
}

// ============================================================================
// 單一板塊點的模擬
// ============================================================================
function simulatePoint(pt, ctx) {
  const rec = {
    pointId: pt.id,
    card: pt.card,
    type: pt.type || (pt.card === "J" ? "castle" : ""),
    hazardQName: pt.hazardQName || null,
    branchIndex: null,
    branchName: "",
    floorCount: 0,
    floors: [],
    issues: [],
    notes: [],
  };
  const cardData = IN.fieldCardData(pt.card);
  if (!cardData) {
    rec.issues.push({ kind: "no_card_data", text: "找不到卡片資料 card_" + String(pt.card).toLowerCase() });
    return rec;
  }
  const branches = IN.fieldCardBranches(pt.card);
  const variant = IN.resolveFieldVariant(pt);
  const branchIndex = IN.pickFieldBranchIndex(pt);
  const branch = branches[branchIndex];
  rec.branchIndex = branchIndex;
  rec.suitCode = variant.suitCode;
  rec.branchName = branch ? zh(branch.name) : "(無分歧)";
  if (!branch) {
    rec.issues.push({ kind: "ghost_floor", text: "pickFieldBranchIndex 回傳 " + branchIndex + " 但 branches 只有 " + branches.length + " 個" });
    return rec;
  }
  const floorCount = IN.fieldFloorCountForCard(pt);
  rec.floorCount = floorCount;
  const usedFloors = [];
  let emptyPathPossible = true;
  for (let fi = 0; fi < floorCount; fi++) {
    const trig = { branchIndex, floorIndex: fi };
    const floor = IN.fieldFloorForTrig(pt, trig);
    const frec = { index: fi, title: floor ? zh(floor.title) : null, choices: [] };
    rec.floors.push(frec);
    if (!floor) {
      rec.issues.push({ kind: "ghost_floor", text: "第 " + (fi + 1) + " 層取不到樓層資料（分歧「" + rec.branchName + "」只有 " + (branch.floors || []).length + " 層，floorCount=" + floorCount + "）" });
      continue;
    }
    usedFloors.push(floor);
    const labels = IN.fieldChoiceLabelsFor(pt, trig);
    const choiceList = labels.length <= 1 ? [null] : labels;
    const reward = floor.reward || [];
    let anyChoiceEmpty = false;
    choiceList.forEach((label) => {
      const where = "第 " + (fi + 1) + " 層「" + zh(floor.title) + "」" + (label ? "選項「" + label + "」" : "");
      const lines = label ? IN.collectLinesForChoice(floor, label) : floor.lines;
      const unresolvedRefs = (lines || []).filter((line) => isTableRefLine(line) && !IN.findEnemyDecisionTableForLine(cardData, line)).map((line) => zh(line.text));
      const expectsEnemy = (lines || []).some((line) => isTableRefLine(line) || isConcreteEnemyRefLine(line));
      const warnBefore = warnings.length;
      let matches = IN.scanLinesForEnemyMatches(lines, cardData, pt.id);
      let evergaolWholeFloor = false;
      // 跟 maybeAssignFieldEnemy() 的退回順序相同：封牢、或選項本身寫著「王戰」（2026-09-22 使用者規格
      // 「在J都要有一個替代的路線可以抽選到」）→ 整層 → 亂數一隻
      const bossChoice = !!label && /王戰|ボス戦闘/.test(label);
      if (!matches.length && (pt.type === "evergaol" || bossChoice)) {
        matches = IN.scanLinesForEnemyMatches(floor.lines, cardData, pt.id);
        evergaolWholeFloor = true;
        if (!matches.length) matches = [IN.randomEnemyMatchFallback(pt.id + ":evergaol_fallback")].filter(Boolean);
      }
      const fallbackUsed = warnings.slice(warnBefore).some((w) => w.indexOf("抽選退回亂數") !== -1);
      const rewards = evaluateRewards(reward, label);
      const crec = {
        label: label,
        enemies: matches.map((m) => m.enemy.id + "(Lv" + m.level + (m.mobRowCount ? "+雜兵" + m.mobRowCount : "") + ")"),
        loot: rewards.loot,
        judgment: rewards.judgmentOnly,
        unmatchedTiers: rewards.unmatchedTiers,
        unresolvedRefs,
        fallbackUsed,
        evergaolWholeFloor,
      };
      frec.choices.push(crec);
      unresolvedRefs.forEach((t) => rec.issues.push({ kind: "table_unresolved", text: where + "：" + t + " 找不到對應的決定表（卡片 extraTables／強敵籌碼表都沒有）" }));
      if (expectsEnemy && !matches.length) {
        const refs = (lines || []).filter((line) => isTableRefLine(line) || isConcreteEnemyRefLine(line)).map((line) => bulletInner(line));
        rec.issues.push({ kind: "enemy_unmatched", text: where + "：規則書寫有敵人 " + refs.join("／") + "，但解析不出任何敵人→會被當成和平通過" });
      }
      if (fallbackUsed) rec.notes.push({ kind: "enemy_fallback", text: where + "：決定表條目對不到敵人資料，退回亂數敵人" });
      if (rewards.unmatchedTiers && !rewards.loot.length) rec.notes.push({ kind: "tier_unmatched", text: where + "：tieredChoice 沒有任何 tier 對得上投票標籤，這一層不發任何戰利品" });
      if (!matches.length && !rewards.loot.length) anyChoiceEmpty = true;
    });
    frec.anyChoiceEmpty = anyChoiceEmpty;
    if (!anyChoiceEmpty) emptyPathPossible = false;
    // 2026-09-22 使用者回報「有些劇本配地圖 走到堡壘J 仍有第一層抽不到王戰」：J 的第 1 層一定要有
    // 至少一條能抽到敵人（王戰）的路線，否則列為嚴重問題（castle_no_boss）。
    if (pt.card === "J" && fi === 0) {
      const anyBoss = frec.choices.some((c) => c.enemies.length > 0);
      if (!anyBoss) rec.issues.push({ kind: "castle_no_boss", text: "第 1 層「" + zh(floor.title) + "」沒有任何一條路線抽得到敵人（王戰）" });
    }
  }
  // 花色變體：走到的樓層裡不可以有同 label 的不同花色版本；而且若分歧有花色變體且已決定花色，
  // 必須挑到該花色的版本（該花色沒有版本才允許亂數）。
  const seenLabel = {};
  const dupes = [];
  usedFloors.forEach((f) => {
    const key = (f.label && f.label.ja) || zh(f.title);
    if (seenLabel[key]) dupes.push(zh(f.title));
    seenLabel[key] = true;
  });
  if (dupes.length) {
    rec.issues.push({ kind: "suit_duplicate", text: "同一層的花色變體被當成不同樓層連續踏破：" + dupes.join("、") });
  }
  if (variant.suitCode) {
    const groups = {};
    (branch.floors || []).forEach((f) => {
      const key = (f.label && f.label.ja) || "";
      (groups[key] = groups[key] || []).push(f);
    });
    const symbol = { S: "♠", H: "♥", D: "◇", C: "♣" }[variant.suitCode];
    const words = { S: ["スペード", "黑桃"], H: ["ハート", "紅心"], D: ["ダイヤ", "方塊", "♦"], C: ["クラブ", "梅花"] }[variant.suitCode];
    const matchesSuit = (f) => {
      const t = (f.title && f.title.ja) || "";
      const tz = (f.title && f.title.zh) || "";
      return t.indexOf(symbol) !== -1 || words.some((w) => t.indexOf(w) !== -1 || tz.indexOf(w) !== -1);
    };
    const multiGroups = Object.keys(groups).filter((k) => groups[k].length >= 2);
    // 跟 fieldEffectiveFloors() 同一條規則：劇本花色要在「每一個」有變體的樓層都有版本才採用，
    // 否則整個分歧改用同一個退回花色（不會混花色）。
    const primaryUsable = multiGroups.every((k) => groups[k].some(matchesSuit));
    const usedSuits = {};
    multiGroups.forEach((key) => {
      const used = usedFloors.filter((f) => ((f.label && f.label.ja) || "") === key)[0];
      if (!used) return;
      const usedSymbol = ((((used.title && used.title.ja) || "") + ((used.title && used.title.zh) || "")).match(/[♠♥◇♦♣]|方塊|梅花|紅心|黑桃|ダイヤ|クラブ|ハート|スペード/g) || []).join("");
      usedSuits[usedSymbol] = true;
      if (primaryUsable && !matchesSuit(used)) {
        rec.issues.push({ kind: "suit_mismatch", text: key + "：花色 " + symbol + " 有對應版本「" + zh(groups[key].filter(matchesSuit)[0].title) + "」，實際走到「" + zh(used.title) + "」" });
      } else if (!primaryUsable) {
        rec.notes.push({ kind: "suit_fallback", text: key + "：花色 " + symbol + " 沒有對應版本（只有 " + groups[key].map((f) => zh(f.title)).join("／") + "），改抽「" + zh(used.title) + "」" });
      }
    });
    // 退回花色必須整個分歧一致：只有一個花色標記的樓層之間不能混（(♣)正門→(◇)城壁）
    const distinctSingle = Object.keys(usedSuits).filter((s) => s.length === 1 || /^(方塊|梅花|紅心|黑桃|ダイヤ|クラブ|ハート|スペード)+$/.test(s));
    if (!primaryUsable && distinctSingle.length > 1) {
      rec.issues.push({ kind: "suit_mismatch", text: "退回花色不一致：同一分歧走到的花色變體有 " + distinctSingle.join("／") });
    }
  }
  const fullClearRune = IN.parseAllFloorEffectRuneAmount(Fields.localizedText(cardData.allFloorEffect || ""));
  if (floorCount > 0 && emptyPathPossible && !rec.issues.some((i) => i.kind === "ghost_floor")) {
    rec.notes.push({
      kind: "empty_tile",
      text: "分歧「" + rec.branchName + "」存在每一層都既無敵人也無戰利品的路徑，可以什麼都沒抽到就踏破整張板塊" + (fullClearRune ? "（全踏破只有盧恩：" + fullClearRune + "）" : "（全踏破也沒有盧恩）"),
    });
  }
  // varianceTable 比對——只對 J／Q（使用者規格明確指定的兩張；2〜7／K 的 varianceTable 是
  // 「劇本×花色×1D」三層表，midnight 沒有花色概念，維持既有的劇本卡牌名稱比對，不在此驗證）
  if (cardData.varianceTable && (pt.card === "J" || pt.card === "Q")) {
    const expectedByScenario = varianceRowsForScenario(cardData, ctx.scenarioNumber).map((r) => r.content);
    const allContents = allVarianceContents(cardData);
    if (pt.hazardQName) {
      // Q：地圖優先——分歧必須就是地圖指定的那個
      if (rec.branchName !== pt.hazardQName) rec.issues.push({ kind: "variance_mismatch", text: "Q 地圖指定分歧「" + pt.hazardQName + "」但實際選到「" + rec.branchName + "」" });
    } else if (expectedByScenario.length) {
      if (!expectedByScenario.some((c) => branchMatchesContent(rec.branchName, c))) {
        rec.issues.push({ kind: "variance_mismatch", text: "劇本 " + ctx.scenarioNumber + " 的決定表內容應為「" + expectedByScenario.join("／") + "」，實際選到「" + rec.branchName + "」" });
      }
      // J 的花色必須是這個劇本 day1/day2 配置表裡 J 卡的花色之一（劇本 8・9 有西・東兩張）
      const slotSuits = ctx.scenario ? ["day1", "day2"].reduce((acc, k) => acc.concat((ctx.scenario[k] || []).filter((s) => s.rank === pt.card).map((s) => s.suit)), []) : [];
      if (slotSuits.length && slotSuits.indexOf(rec.suitCode) === -1) {
        rec.issues.push({ kind: "variance_mismatch", text: "劇本 " + ctx.scenarioNumber + " 的 " + pt.card + " 卡花色為 " + slotSuits.join("/") + "，實際決定的花色為 " + rec.suitCode });
      }
    } else if (ctx.scenarioNumber !== null) {
      // 規則書劇本但決定表沒有這個劇本的列（例：Q 的劇本 1〜4）→ 使用者規格：直接抽選一個劇本的表
      if (!allContents.some((c) => branchMatchesContent(rec.branchName, c))) {
        rec.issues.push({ kind: "variance_mismatch", text: "劇本 " + ctx.scenarioNumber + " 在決定表沒有列，退回抽選的「" + rec.branchName + "」也不在任何劇本的表內" });
      } else rec.notes.push({ kind: "variance_fallback", text: "劇本 " + ctx.scenarioNumber + " 在決定表沒有列，改抽任一劇本的表 →「" + rec.branchName + "」" });
    } else {
      rec.notes.push({ kind: "variance_fallback", text: "自訂劇本無決定表，改抽任一劇本的表 →「" + rec.branchName + "」" });
    }
  } else if (ctx.scenario && cardData.name && cardData.name.zh) {
    // 2〜7／K／9：midnight 用「劇本卡牌名稱 → 分歧名稱」比對（scenarioVariantCandidatesForCard）。
    // 劇本配置表的名稱（例：「大教會（無印）」）在 branches 裡沒有同名項目時會退回亂數分歧——
    // 不卡死，但列出來供資料面對照（不在本次 J／Q 規格範圍內）。
    const base = cardData.name.zh;
    const slotNames = ["day1", "day2"].reduce((acc, k) => acc.concat((ctx.scenario[k] || []).filter((s) => s.name && s.name.zh && s.name.zh.indexOf(base) === 0).map((s) => s.name.zh)), []);
    const norm = GmFlow.normalizeBranchNameForMatch;
    const branchNames = branches.map((b) => zh(b.name));
    const unmatched = slotNames.filter((n) => !branchNames.some((b) => norm(b) === norm(n)));
    if (slotNames.length && unmatched.length === slotNames.length) {
      rec.notes.push({ kind: "scenario_name_unmatched", text: "劇本卡牌名「" + unmatched.join("／") + "」在分歧清單（" + branchNames.join("／") + "）沒有同名項目，退回亂數分歧" });
    } else if (slotNames.length && !unmatched.length) {
      // 劇本裡這張卡的名稱全部都對得到分歧 → midnight 挑到的分歧必須是其中之一（回歸保護：
      // 2026-09-22 曾把 2〜7／K 誤導進 varianceTable 路徑、全部退回亂數，就是靠這條抓到）
      if (!slotNames.some((n) => norm(n) === norm(rec.branchName))) {
        rec.issues.push({ kind: "scenario_branch_mismatch", text: "劇本卡牌名「" + slotNames.join("／") + "」都對得到分歧，實際卻選到「" + rec.branchName + "」" });
      }
    }
  }
  return rec;
}

// ============================================================================
// 交叉迴圈
// ============================================================================
const SEVERE_KINDS = ["ghost_floor", "table_unresolved", "enemy_unmatched", "variance_mismatch", "scenario_branch_mismatch", "suit_duplicate", "suit_mismatch", "no_card_data", "castle_no_boss"];
const matrix = {}; // scenarioLabel -> variantId -> { severe: n, points: n }
const detail = {}; // key: scenario|variant|card|branch|issueKind|text -> { count, sample }
const jqOverview = {}; // scenarioLabel -> variantId -> { J: {desc: true}, Q: {desc: true} }
let totalPoints = 0;
const SUIT_SYMBOL = { S: "♠", H: "♥", D: "◇", C: "♣" };

scenarios.forEach((sc) => {
  matrix[sc.label] = {};
  VARIANT_IDS.forEach((variantId) => {
    const cell = { severe: 0, notes: 0, points: 0, seeds: mapsByVariant[variantId].length };
    matrix[sc.label][variantId] = cell;
    mapsByVariant[variantId].forEach((entry) => {
      const meta = { mapSeed: entry.seed, nightBossId: sc.id, mapVariant: entry.setting, sessionStartAt: 1 };
      IN._setContext(meta, entry.map);
      const ctx = { scenarioNumber: sc.number, scenario: sc.scenario };
      const points = entry.map.points.filter((p) => !IN.NON_FIELD_POINT_TYPES[p.type] && IN.fieldCardData(p.card));
      if (IN.mapHasCastle()) points.push({ id: IN.CASTLE_POINT_ID, card: "J", x: entry.map.castleCenter.x, y: entry.map.castleCenter.y });
      points.forEach((pt) => {
        const rec = simulatePoint(pt, ctx);
        totalPoints++;
        cell.points++;
        if (pt.card === "J" || pt.card === "Q") {
          const ov = (jqOverview[sc.label] = jqOverview[sc.label] || {});
          const cellOv = (ov[variantId] = ov[variantId] || { J: {}, Q: {} });
          const desc = rec.branchName + (rec.suitCode ? "(" + SUIT_SYMBOL[rec.suitCode] + ")" : "") + "→" + rec.floors.map((f) => f.title).join("→");
          cellOv[pt.card][desc] = true;
        }
        rec.issues.forEach((iss) => {
          if (SEVERE_KINDS.indexOf(iss.kind) !== -1) cell.severe++;
          const key = [sc.label, variantId, rec.card, rec.branchName, iss.kind, iss.text].join("|");
          detail[key] = detail[key] || { scenario: sc.label, variant: variantId, card: rec.card, branch: rec.branchName, kind: iss.kind, text: iss.text, count: 0, severe: true, sample: rec };
          detail[key].count++;
        });
        rec.notes.forEach((n) => {
          cell.notes++;
          const key = [sc.label, variantId, rec.card, rec.branchName, n.kind, n.text].join("|");
          detail[key] = detail[key] || { scenario: sc.label, variant: variantId, card: rec.card, branch: rec.branchName, kind: n.kind, text: n.text, count: 0, severe: false, sample: rec };
          detail[key].count++;
        });
        if (VERBOSE) {
          console.log(`[${sc.label} × ${variantId} seed=${entry.seed}] ${rec.card}${rec.hazardQName ? "(" + rec.hazardQName + ")" : ""} 分歧「${rec.branchName}」 ${rec.floorCount} 層`);
          rec.floors.forEach((f) => {
            console.log(`    L${f.index + 1} ${f.title}`);
            f.choices.forEach((c) => console.log(`       ${c.label ? "→" + c.label : "(單一)"} 敵:${c.enemies.join(",") || "-"} 獎:${c.loot.join(",") || "-"} 判:${c.judgment.join(",") || "-"}${c.fallbackUsed ? " [退回亂數]" : ""}`));
          });
          rec.issues.forEach((i) => console.log("    !! " + i.kind + " " + i.text));
          rec.notes.forEach((n) => console.log("    .. " + n.kind + " " + n.text));
        }
      });
    });
  });
});

// ============================================================================
// 輸出
// ============================================================================
const out = [];
const h = (t) => out.push(AS_MD ? `\n## ${t}\n` : `\n=== ${t} ===`);
out.push(AS_MD ? "# 劇本 × 地圖 交叉測試（板塊卡死／決定表對應）" : "劇本 × 地圖 交叉測試（板塊卡死／決定表對應）");
out.push(`地圖變體：${VARIANT_IDS.map((id) => id + "×" + mapsByVariant[id].length + "種子").join("、")}；劇本：${scenarios.length}（含自訂）；模擬板塊點合計 ${totalPoints}`);
VARIANT_IDS.forEach((id) => {
  if (!mapsByVariant[id].length) out.push(`※ 變體 ${id} 在 1〜${SEED_SCAN_LIMIT} 的種子裡一張都沒抽到，未測試`);
});

h("矩陣（每格＝嚴重問題數／備註數，跨該變體全部種子合計）");
if (AS_MD) {
  out.push("| 劇本 | " + VARIANT_IDS.join(" | ") + " |");
  out.push("| --- | " + VARIANT_IDS.map(() => "---").join(" | ") + " |");
  scenarios.forEach((sc) => out.push("| " + sc.label + " | " + VARIANT_IDS.map((id) => matrix[sc.label][id].severe + " / " + matrix[sc.label][id].notes).join(" | ") + " |"));
} else {
  const pad = (s, n) => (s + " ".repeat(n)).slice(0, n);
  out.push("  " + pad("劇本", 16) + VARIANT_IDS.map((id) => pad(id, 12)).join(""));
  scenarios.forEach((sc) => out.push("  " + pad(sc.label, 16) + VARIANT_IDS.map((id) => pad(matrix[sc.label][id].severe + "/" + matrix[sc.label][id].notes, 12)).join("")));
}

h("J（王城）／Q（地變）決定結果一覽（分歧(花色)→實際走的樓層；跨種子去重）");
scenarios.forEach((sc) => {
  VARIANT_IDS.forEach((variantId) => {
    const ov = jqOverview[sc.label] && jqOverview[sc.label][variantId];
    if (!ov) return;
    ["J", "Q"].forEach((card) => {
      const descs = Object.keys(ov[card]);
      if (!descs.length) return;
      out.push((AS_MD ? "- " : "  ") + `${sc.label} × ${variantId} ${card}：` + descs.join("　｜　"));
    });
  });
});

const entries = Object.keys(detail).map((k) => detail[k]);
const severeEntries = entries.filter((e) => e.severe);
const noteEntries = entries.filter((e) => !e.severe);

h("嚴重問題（會卡死／抽不到表／可能空手踏破／分歧與決定表不符）");
if (!severeEntries.length) out.push(AS_MD ? "- 無" : "  無");
// 依 kind → card 彙整，相同文字跨劇本／地圖合併列出
const grouped = {};
severeEntries.forEach((e) => {
  const gk = e.kind + "|" + e.card + "|" + e.branch + "|" + e.text;
  grouped[gk] = grouped[gk] || { kind: e.kind, card: e.card, branch: e.branch, text: e.text, where: [] , count: 0 };
  grouped[gk].where.push(e.scenario + "×" + e.variant);
  grouped[gk].count += e.count;
});
Object.keys(grouped)
  .sort()
  .forEach((gk) => {
    const g = grouped[gk];
    const where = g.where.length > 8 ? g.where.slice(0, 8).join("、") + "…（共 " + g.where.length + " 組）" : g.where.join("、");
    out.push((AS_MD ? "- " : "  ") + `[${g.kind}] 卡 ${g.card}／分歧「${g.branch}」：${g.text}　（${where}；出現 ${g.count} 次）`);
  });

h("備註（不卡死，但屬退回結果）");
if (!noteEntries.length) out.push(AS_MD ? "- 無" : "  無");
const groupedNotes = {};
noteEntries.forEach((e) => {
  const gk = e.kind + "|" + e.card + "|" + e.text;
  groupedNotes[gk] = groupedNotes[gk] || { kind: e.kind, card: e.card, text: e.text, where: [], count: 0 };
  groupedNotes[gk].where.push(e.scenario + "×" + e.variant);
  groupedNotes[gk].count += e.count;
});
Object.keys(groupedNotes)
  .sort()
  .forEach((gk) => {
    const g = groupedNotes[gk];
    const where = g.where.length > 6 ? g.where.slice(0, 6).join("、") + "…（共 " + g.where.length + " 組）" : g.where.join("、");
    out.push((AS_MD ? "- " : "  ") + `[${g.kind}] 卡 ${g.card}：${g.text}　（${where}；出現 ${g.count} 次）`);
  });

const severeTotal = severeEntries.reduce((n, e) => n + e.count, 0);
out.push("");
out.push(severeTotal ? `結果：發現 ${severeTotal} 次嚴重問題（${Object.keys(grouped).length} 種）` : "結果：全部通過");
console.log(out.join("\n"));
process.exit(severeTotal ? 1 : 0);
