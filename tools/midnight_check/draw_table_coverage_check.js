// ============================================================================
// 武器／戰技／魔術／祈禱 抽選表「覆蓋率」窮舉驗證（純 node，不需 Playwright／emulator）
// ============================================================================
// 既有的 weapon_skill_audit.js 檢查的是「資料裡的 id 參照解不解得開」；這支腳本檢查的是
// 另一個面向——**抽選骰真的擲下去時，每一個可能出目是不是都抽得到東西**。
//
// 驗證對象全部直接呼叫 character_drawer.js 內部的真實函式（載入前以字串注入把內部函式
// 掛到 window.__PriTestDrawInternals），不重寫一份規則，避免「腳本說沒事、App 其實會 miss」。
//
// 五個區塊：
//   ①〔4-1〕大分類決定表 × 〔4-2〕小分類決定表：1D 的 1〜6 是否都解得出列，且小分類名稱
//     是否對得上 Weapons.categories() 的實際分類 id（findCategoryIdByMinorLabel）。
//   ② 武器抽選表：每個分類 × 稀有度 C/U/R/L × 1D 出目 1〜6，pickWeaponByRoll() 是否抽得到
//     實際武器（排除 kind:"note" 的占位項目）。抽不到時分類為「整個稀有度沒武器」與
//     「有武器但這個出目落空」兩種。
//   ③ 固有戰技／固有魔術／固有祈禱：每把武器 skills 的 innate／art 參照是否解得開。
//   ④ 隨機戰技表：對每個帶 kind:"random" 的武器，窮舉它會用到的抽選表的所有出目
//     （簡單表 1D＝6 格；杖／聖印的 namedSkillTables＝2D 的 6×6＝36 格），檢查每一格是否
//     都 resolve 得到列、且該列的 id 在 weapons_skills.js／innateSkills 找得到。
//   ⑤ 杖／聖印專章：固有魔術／祈禱與隨機表字母（A／B／C）的對應是否齊全。
//
// 執行：npm run check:draw_coverage（或 node draw_table_coverage_check.js）
// 有落空時 exit 1（可當回歸測試用）；--md 輸出 Markdown。
// ============================================================================
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SRC = process.env.PRITEST_SRC || path.resolve(__dirname, "../../static_src");
const AS_MD = process.argv.indexOf("--md") !== -1;

// ---- 載入 static_src（character_drawer.js 會碰 DOM／localStorage，給最小 stub） ----
const stubEl = { style: {}, dataset: {}, appendChild() {}, setAttribute() {}, addEventListener() {}, classList: { add() {}, remove() {} } };
const sandbox = {
  window: {},
  console,
  setTimeout,
  clearTimeout,
  document: {
    createElement: () => stubEl,
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    body: { appendChild() {} },
  },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  navigator: { userAgent: "node" },
};
sandbox.window.document = sandbox.document;
sandbox.window.localStorage = sandbox.localStorage;
sandbox.window.addEventListener = () => {};
vm.createContext(sandbox);

["weapons_categories.js", "weapons_skills.js", "weapons_data.js", "weapons.js", "character_types.js", "talismans.js", "consumables.js", "weapon_rulebook.js"].forEach(
  (f) => vm.runInContext(fs.readFileSync(path.join(SRC, f), "utf8"), sandbox)
);

// character_drawer.js：IIFE 內部函式無法從外部取得，於載入前注入一行 export。
// 這樣驗證的就是 App 實際使用的同一份實作（複製一份到腳本裡遲早會跟本體走偏）。
const INTERNAL_NAMES = [
  "parseRollRange",
  "pickWeaponByRoll",
  "lookupRarityBySum",
  "getRarityBreakpoints",
  "resolveSimpleTableRoll",
  "resolveNamedTableRoll",
  "findCategoryIdByMinorLabel",
  "isNotePlaceholderWeapon",
  "getItemSkillRefs",
  "resolveRandomSkillForItem",
  "pickWeaponByRollWithReroll",
  "findNotePlaceholderForRoll",
];
let cdSrc = fs.readFileSync(path.join(SRC, "character_drawer.js"), "utf8");
const anchor = "window.PriTestCharacterDrawer = {";
if (cdSrc.indexOf(anchor) === -1) throw new Error("找不到 window.PriTestCharacterDrawer 匯出點——character_drawer.js 結構已變，請更新這支腳本");
cdSrc = cdSrc.replace(anchor, "window.__PriTestDrawInternals = { " + INTERNAL_NAMES.map((n) => n + ": " + n).join(", ") + " };\n  " + anchor);
vm.runInContext(cdSrc, sandbox);

const Weapons = sandbox.window.PriTestWeapons;
const SKILLS = sandbox.window.PriTestWeaponsSkills;
const RB = sandbox.window.PriTestWeaponRulebook;
const IN = sandbox.window.__PriTestDrawInternals;
INTERNAL_NAMES.forEach((n) => {
  if (typeof IN[n] !== "function") throw new Error("內部函式 " + n + " 注入失敗——請確認 character_drawer.js 是否仍有此函式");
});

const CATEGORIES = Weapons.categories();
const WEAPONS = Weapons.list();
const catById = {};
CATEGORIES.forEach((c) => (catById[c.id] = c));
const zh = (f) => (f && (f.zh || f.ja)) || "";
const RARITIES = ["C", "U", "R", "L"];

// 全分類的 innateSkills 攤平（getEquippedWeaponSkillEntries 一樣是跨分類查）
const INNATE_BY_ID = {};
CATEGORIES.forEach((c) => (c.innateSkills || []).forEach((s) => (INNATE_BY_ID[s.id] = INNATE_BY_ID[s.id] || { skill: s, categoryId: c.id })));
const skillExists = (id) => !!(SKILLS[id] || INNATE_BY_ID[id]);
const skillName = (id) => zh((SKILLS[id] || (INNATE_BY_ID[id] || {}).skill || {}).name) || "(無名)";

const report = { categoryTable: [], weaponTable: [], innateRef: [], randomTable: [], spellCat: [], runtime: [] };
let failCount = 0;
const fail = (bucket, msg) => {
  report[bucket].push(msg);
  failCount++;
};

// ============================================================================
// ① 大分類／小分類決定表
// ============================================================================
const majorRows = RB.majorTable().rows;
const minorTables = RB.minorTables();
if (majorRows.length !== minorTables.length) fail("categoryTable", `大分類表有 ${majorRows.length} 列，但小分類表只有 ${minorTables.length} 張，數量對不上`);

const reachableCategoryIds = {};
minorTables.forEach((table, idx) => {
  const majorLabel = zh(majorRows[idx] ? majorRows[idx][1] : null) || `表#${idx}`;
  for (let die = 1; die <= 6; die++) {
    let row = null;
    for (let i = 0; i < table.rows.length; i++) {
      const range = IN.parseRollRange(zh(table.rows[i][0]));
      if (range && die >= range[0] && die <= range[1]) {
        row = table.rows[i];
        break;
      }
    }
    if (!row) {
      fail("categoryTable", `〔4-2〕${majorLabel} 出目 ${die}：抽選表沒有對應列`);
      continue;
    }
    const label = zh(row[1]);
    if (/振り直し|重新擲骰/.test(label)) continue; // 規則書明訂的「本表重新擲骰」
    const catId = IN.findCategoryIdByMinorLabel(label);
    if (!catId) fail("categoryTable", `〔4-2〕${majorLabel} 出目 ${die}：「${label}」對不到任何實際分類 id`);
    else reachableCategoryIds[catId] = true;
  }
});

// 杖／聖印不經過〔4-1〕〔4-2〕（規則書：直接指定分類），其餘分類都應該抽得到
const CATEGORY_TABLE_EXEMPT = ["staff", "sacred_seal"];
CATEGORIES.forEach((c) => {
  if (CATEGORY_TABLE_EXEMPT.indexOf(c.id) !== -1) return;
  if (!reachableCategoryIds[c.id]) fail("categoryTable", `分類「${zh(c.name)}」(${c.id}) 在〔4-2〕小分類決定表中完全抽不到`);
});

// ============================================================================
// ② 武器抽選表：分類 × 稀有度 × 1D
// ============================================================================
const weaponTableStats = [];
CATEGORIES.forEach((c) => {
  RARITIES.forEach((rarity) => {
    const pool = WEAPONS.filter((w) => w.category === c.id && w.rarity === rarity);
    const real = pool.filter((w) => !IN.isNotePlaceholderWeapon(w));
    const rolled = real.filter((w) => !!IN.parseRollRange(w.roll));
    const missing = [];
    for (let die = 1; die <= 6; die++) {
      const picked = IN.pickWeaponByRoll(c.id, rarity, die);
      if (!picked || IN.isNotePlaceholderWeapon(picked)) missing.push(die);
    }
    weaponTableStats.push({ cat: c, rarity, pool: pool.length, real: real.length, rolled: rolled.length, missing });
    if (!missing.length) return;
    const hasNote = !!(c.note && zh(c.note));
    const label = `分類「${zh(c.name)}」(${c.id}) 稀有度 ${rarity}`;
    // 規則書が「この稀有度には武器が無い／再抽選する」と明記している枠は、資料側で
    // kind:"note" のプレースホルダー（roll:"5〜6" のような範囲、または roll:"－"＝稀有度まるごと）
    // として収録済み。その出目は「落空」ではなく規則書どおりの再抽選なので可接受として扱う。
    const placeholders = pool.filter((w) => IN.isNotePlaceholderWeapon(w));
    const coveredByNote = (die) =>
      placeholders.some((w) => {
        const r = IN.parseRollRange(w.roll);
        return r ? die >= r[0] && die <= r[1] : true; // roll:"－" のプレースホルダーは稀有度全体をカバー
      });
    const uncovered = missing.filter((die) => !coveredByNote(die));
    if (!uncovered.length) {
      // 占位があるだけでは足りない：規則書の指示どおり自動で再抽選先へ辿れて、実際に武器が
      // 出てくるところまで確認する（reroll フィールドが無い占位は抽選が「該当なし」で止まる）。
      const unresolvable = [];
      missing.forEach((die) => {
        let ok = false;
        for (let t = 0; t < 40 && !ok; t++) ok = !!IN.pickWeaponByRollWithReroll(c.id, rarity, die).item;
        if (!ok) unresolvable.push(die);
      });
      if (unresolvable.length) {
        fail(
          "weaponTable",
          `${label}：出目 ${unresolvable.join("/")} 有占位說明但自動再抽選解不出武器（占位缺 reroll 欄位，或指定的再抽選表本身也是空的）`
        );
        return;
      }
      report.weaponTable.push(
        `〔可接受〕${label}：出目 ${missing.join("/")} 依規則書為「無對應武器／重新抽選」，已自動改抽並取得武器（占位：${placeholders.map((w) => zh(w.name) + "→" + (w.reroll ? w.reroll.rarity + "表" : "?")).join("、")}）`
      );
      return;
    }
    if (!real.length) {
      // 該稀有度完全沒有武器：規則書可能以 note 說明改抽別表（例：短劍的 L）
      if (hasNote) report.weaponTable.push(`〔可接受〕${label}：無武器，但分類備註有說明改抽方式──${zh(c.note)}`);
      else fail("weaponTable", `${label}：完全沒有武器，也沒有 note 占位或分類備註說明改抽方式（1〜6 全部落空）`);
    } else if (rolled.length === 0) {
      // 有武器但都沒有 roll 範圍（例：只有初始武器 roll:"－"）
      fail("weaponTable", `${label}：有 ${real.length} 把武器但都沒有 1D 出目範圍（roll 欄為「${real.map((w) => w.roll).join("／")}」），出目 ${uncovered.join("/")} 落空`);
    } else {
      fail("weaponTable", `${label}：出目 ${uncovered.join("/")} 抽不到武器（現有出目範圍：${rolled.map((w) => `${w.roll}=${zh(w.name)}`).join("、")}）`);
    }
  });
});

// ============================================================================
// ③ 固有戰技／固有魔術／固有祈禱參照
// ============================================================================
function refsOfWeapon(w) {
  const cat = catById[w.category];
  if (cat && cat.isShield) return (w.attachedEffect || []).concat(w.reverseArt || []);
  return IN.getItemSkillRefs(cat, w);
}
WEAPONS.forEach((w) => {
  const cat = catById[w.category];
  if (!cat) return;
  refsOfWeapon(w).forEach((ref) => {
    if (ref.kind === "innate" && !INNATE_BY_ID[ref.id]) fail("innateRef", `${zh(w.name)}(${w.id}) 固有技能 id "${ref.id}" 在任何分類的 innateSkills 都找不到`);
    if (ref.kind === "art" && !SKILLS[ref.id]) fail("innateRef", `${zh(w.name)}(${w.id}) 固有戰技／魔術／祈禱 id "${ref.id}" 在 weapons_skills.js 找不到`);
  });
});
// 一條戰技／魔術／祈禱都沒有的武器（規則書で「装備品スキル：なし」と確認済みのものと、
// 単に未転記のものを見分けるため、参考情報として一覧を出す）
const noSkillWeapons = WEAPONS.filter((w) => !IN.isNotePlaceholderWeapon(w) && !refsOfWeapon(w).length).map((w) => `${zh(w.name)}(${w.id})`);

// 分類 innateSkills 本身有沒有被任何武器引用（抽不到的固有技能＝死資料）
const usedInnate = {};
WEAPONS.forEach((w) => refsOfWeapon(w).forEach((ref) => ref.kind === "innate" && (usedInnate[ref.id] = true)));
const unusedInnate = Object.keys(INNATE_BY_ID).filter((id) => !usedInnate[id]);

// ============================================================================
// ④ 隨機戰技表：窮舉所有出目
// ============================================================================
// 表級窮舉（每張表只查一次），再列出「哪些武器吃到有洞的表」
const tableAudit = {}; // key: catId 或 catId::字母
function tableLetters(cat) {
  const map = {};
  (cat.namedSkillTables || []).forEach((t, idx) => {
    const letter = (zh(t.title).match(/[（(]([A-Z])[）)]/) || [])[1];
    if (letter) map[letter] = idx;
  });
  return map;
}
CATEGORIES.forEach((cat) => {
  if ((cat.randomSkillTable || []).length) {
    const holes = [];
    const badId = [];
    for (let d = 1; d <= 6; d++) {
      const row = IN.resolveSimpleTableRoll(cat, d);
      if (!row || !row.id) holes.push(String(d));
      else if (!skillExists(row.id)) badId.push(`${d}→${row.id}`);
    }
    tableAudit[cat.id] = { cat, title: "隨機戰技決定表(1D)", cells: 6, holes, badId };
  }
  const letters = tableLetters(cat);
  (cat.namedSkillTables || []).forEach((t, idx) => {
    const letter = Object.keys(letters).filter((k) => letters[k] === idx)[0] || `#${idx}`;
    const holes = [];
    const badId = [];
    for (let d1 = 1; d1 <= 6; d1++) {
      for (let d2 = 1; d2 <= 6; d2++) {
        const row = IN.resolveNamedTableRoll(t, d1, d2);
        if (!row || !row.id) holes.push(`${d1}／${d2}`);
        else if (!skillExists(row.id)) badId.push(`${d1}／${d2}→${row.id}`);
      }
    }
    tableAudit[cat.id + "::" + letter] = { cat, title: zh(t.title), letter, cells: 36, holes, badId, rows: t.rows };
  });
});

Object.keys(tableAudit).forEach((key) => {
  const a = tableAudit[key];
  if (a.holes.length) {
    // 有洞的表，把「哪幾列的 roll 寫法造成落空」一起指出來，方便直接修資料
    let hint = "";
    if (a.rows) {
      const suspicious = a.rows.filter((r) => /／.*[・]/.test(String(r.roll)));
      if (suspicious.length) hint = `　可疑列（右側出目寫成複數值，resolveNamedTableRoll 只取 parseInt 的第一個數）：${suspicious.map((r) => `"${r.roll}"→${r.id}`).join("、")}`;
    }
    fail("randomTable", `分類「${zh(a.cat.name)}」(${a.cat.id})「${a.title}」：${a.holes.length}/${a.cells} 格出目抽不到任何項目 → ${a.holes.join("、")}${hint}`);
  }
  a.badId.forEach((b) => fail("randomTable", `分類「${zh(a.cat.name)}」(${a.cat.id})「${a.title}」：出目 ${b} 的 id 在資料庫找不到`));
});

// 每把武器的 random 槽：確認它指到的表存在（沒有表＝這個槽永遠抽不到東西）
WEAPONS.forEach((w) => {
  const cat = catById[w.category];
  if (!cat) return;
  refsOfWeapon(w).forEach((ref) => {
    if (ref.kind !== "random") return;
    const hasSimple = (cat.randomSkillTable || []).length > 0;
    const letters = tableLetters(cat);
    const hasNamed = Object.keys(letters).length > 0;
    if (!hasSimple && !hasNamed) {
      fail("randomTable", `${zh(w.name)}(${w.id})：分類 ${cat.id} 沒有任何隨機抽選表，這個隨機槽永遠抽不到東西`);
      return;
    }
    if (hasNamed) {
      if (ref.table === undefined) fail("randomTable", `${zh(w.name)}(${w.id})：分類 ${cat.id} 用具名抽選表，但武器沒有指定 table 字母，抽選時解不出表`);
      else if (letters[ref.table] === undefined) fail("randomTable", `${zh(w.name)}(${w.id})：指定的 table="${ref.table}" 在分類 ${cat.id}（有 ${Object.keys(letters).join("/")}）不存在`);
    }
  });
});

// ============================================================================
// ⑤ 杖／聖印專章
// ============================================================================
["staff", "sacred_seal"].forEach((catId) => {
  const cat = catById[catId];
  if (!cat) {
    fail("spellCat", `找不到分類 ${catId}`);
    return;
  }
  // kind:"note" のプレースホルダー（「L表には該当なし」等）は実際の装備品ではないので統計から外す
  const list = WEAPONS.filter((w) => w.category === catId && !IN.isNotePlaceholderWeapon(w));
  const letters = tableLetters(cat);
  const perLetterUse = {};
  Object.keys(letters).forEach((l) => (perLetterUse[l] = 0));
  let noFixed = [];
  let noRandom = [];
  list.forEach((w) => {
    const refs = refsOfWeapon(w);
    const fixed = refs.filter((r) => r.kind === "art" || r.kind === "innate");
    const rnd = refs.filter((r) => r.kind === "random");
    if (!fixed.length) noFixed.push(`${zh(w.name)}(${w.id})`);
    if (!rnd.length) noRandom.push(`${zh(w.name)}(${w.id})`);
    rnd.forEach((r) => r.table && perLetterUse[r.table] !== undefined && perLetterUse[r.table]++);
    fixed.forEach((r) => {
      if (!skillExists(r.id)) fail("spellCat", `${zh(cat.name)}「${zh(w.name)}」的固有${catId === "staff" ? "魔術" : "祈禱"} id "${r.id}" 找不到`);
    });
  });
  report.spellCat.push(
    `${zh(cat.name)}(${catId})：共 ${list.length} 件；固有${catId === "staff" ? "魔術" : "祈禱"}齊全 ${list.length - noFixed.length}/${list.length}；帶隨機槽 ${list.length - noRandom.length}/${list.length}；` +
      `抽選表 ${Object.keys(letters).join("/")} 使用次數 ${Object.keys(letters).map((l) => l + "=" + perLetterUse[l]).join("、")}`
  );
  if (noFixed.length) report.spellCat.push(`　※ 無固有${catId === "staff" ? "魔術" : "祈禱"}：${noFixed.join("、")}`);
  Object.keys(letters).forEach((l) => {
    if (!perLetterUse[l]) fail("spellCat", `${zh(cat.name)} 的「${l}」抽選表沒有任何${catId === "staff" ? "杖" : "聖印"}會用到（死表）`);
  });
});

// ============================================================================
// ⑥ runtime 抽樣：真的走一遍 App 的抽選路徑
// ============================================================================
// 上面①〜⑤是靜態窮舉；這裡實際呼叫 App 在場地獎勵／商人／塔謎題會用到的
// drawWeaponFromCategory()（內含稀有度擲骰→武器擲骰→20次重試）與隨機戰技解決
// resolveRandomSkillForItem()，確認靜態結論在真實路徑上成立。
const SAMPLES = 600;
const CD = sandbox.window.PriTestCharacterDrawer;
CATEGORIES.forEach((cat) => {
  let nulls = 0;
  for (let i = 0; i < SAMPLES; i++) {
    const c = { weaponIds: [] };
    if (!CD.drawWeaponFromCategory(c, cat.id, 1)) nulls++;
  }
  if (nulls) fail("runtime", `分類「${zh(cat.name)}」(${cat.id})：★1 抽選 ${SAMPLES} 次有 ${nulls} 次抽不到任何武器（重試 20 次仍落空）`);
});
// 帶隨機槽的武器：每把抽 60 次，統計解不出戰技的次數
let rndWeapons = 0;
let rndNullTotal = 0;
WEAPONS.forEach((w) => {
  const cat = catById[w.category];
  if (!cat) return;
  if (!refsOfWeapon(w).some((r) => r.kind === "random")) return;
  rndWeapons++;
  let nulls = 0;
  for (let i = 0; i < 60; i++) {
    const res = IN.resolveRandomSkillForItem(cat, w);
    if (!res || !res.skillId) nulls++;
  }
  rndNullTotal += nulls;
  if (nulls) fail("runtime", `${zh(w.name)}(${w.id})：隨機戰技抽選 60 次有 ${nulls} 次解不出戰技`);
});
report.runtime.push(`分類抽選：${CATEGORIES.length} 個分類 × ${SAMPLES} 次 ★1 抽選；隨機戰技：${rndWeapons} 把帶隨機槽武器 × 60 次（落空合計 ${rndNullTotal} 次）`);

// fallbackRoll（弓のU表⑥：振り直して再度⑥なら出目⑤の角の弓を取る）が実際に効くか。
// 確率 1/6 でしか通らない枝なので、明示的に回数を稼いで1回は通す。
const FALLBACK_CASES = [{ categoryId: "bow", rarity: "U", die: 6, fallbackRoll: 5 }];
FALLBACK_CASES.forEach((tc) => {
  let sawFallback = false;
  let nulls = 0;
  const landed = {};
  for (let i = 0; i < 400; i++) {
    const r = IN.pickWeaponByRollWithReroll(tc.categoryId, tc.rarity, tc.die);
    if (!r.item) nulls++;
    else landed[r.item.id] = (landed[r.item.id] || 0) + 1;
    if ((r.steps || []).some((s) => s.fallbackRoll === tc.fallbackRoll)) sawFallback = true;
  }
  const cat = catById[tc.categoryId];
  if (nulls) fail("runtime", `${zh(cat.name)} ${tc.rarity}表出目${tc.die} 的自動再抽選：400 次中有 ${nulls} 次落空`);
  if (!sawFallback)
    fail("runtime", `${zh(cat.name)} ${tc.rarity}表出目${tc.die}：400 次都沒有觸發 fallbackRoll=${tc.fallbackRoll}（再度同出目時應改取該出目的武器）`);
  const expectedFallbackItem = IN.pickWeaponByRoll(tc.categoryId, tc.rarity, tc.fallbackRoll);
  if (expectedFallbackItem && !landed[expectedFallbackItem.id])
    fail("runtime", `${zh(cat.name)} ${tc.rarity}表出目${tc.die}：fallback 指定的出目${tc.fallbackRoll}（${zh(expectedFallbackItem.name)}）一次也沒被抽到`);
  report.runtime.push(
    `${zh(cat.name)} ${tc.rarity}表出目${tc.die} 的規則書再抽選：400 次落空 0、fallbackRoll=${tc.fallbackRoll} 已觸發、落點 ${Object.keys(landed).length} 種`
  );
});

// ============================================================================
// 輸出
// ============================================================================
const out = [];
const h = (t) => out.push(AS_MD ? `\n## ${t}\n` : `\n=== ${t} ===`);
const line = (t) => out.push(AS_MD ? `- ${t}` : `  ${t}`);

out.push(AS_MD ? "# 武器／戰技抽選表覆蓋率驗證" : "武器／戰技抽選表覆蓋率驗證");
out.push(
  `資料規模：分類 ${CATEGORIES.length}／武器 ${WEAPONS.length}／戰技・魔術・祈禱 ${Object.keys(SKILLS).length}／固有技能 ${Object.keys(INNATE_BY_ID).length}`
);

h("① 分類決定表〔4-1〕〔4-2〕");
if (!report.categoryTable.length) line(`全部通過：6 張小分類表 × 1D 出目 1〜6 全部解得出分類（杖／聖印依規則書不經此表）`);
report.categoryTable.forEach(line);

h("② 武器抽選表（分類 × 稀有度 × 1D）");
const badCells = weaponTableStats.reduce((n, s) => n + s.missing.length, 0);
line(`檢查 ${weaponTableStats.length} 個「分類×稀有度」區間、共 ${weaponTableStats.length * 6} 格出目，落空 ${badCells} 格`);
report.weaponTable.forEach(line);
if (!report.weaponTable.length) line("全部通過");

h("③ 固有戰技／魔術／祈禱參照");
if (!report.innateRef.length) line("全部通過：所有武器的 innate／art 參照都解得開");
report.innateRef.forEach(line);
if (unusedInnate.length) line(`（參考）沒有被任何武器引用的固有技能 ${unusedInnate.length} 條：${unusedInnate.map((id) => `${id}（${skillName(id)}）`).join("、")}`);
if (noSkillWeapons.length) line(`（參考）一條戰技都沒有的武器 ${noSkillWeapons.length} 把：${noSkillWeapons.join("、")}`);

h("④ 隨機戰技／魔術／祈禱抽選表窮舉");
const tKeys = Object.keys(tableAudit);
const totalCells = tKeys.reduce((n, k) => n + tableAudit[k].cells, 0);
const holeCells = tKeys.reduce((n, k) => n + tableAudit[k].holes.length, 0);
line(`檢查 ${tKeys.length} 張抽選表、共 ${totalCells} 格出目，落空 ${holeCells} 格`);
report.randomTable.forEach(line);
if (!report.randomTable.length) line("全部通過");

h("⑤ 杖／聖印");
report.spellCat.forEach(line);

h("⑥ runtime 抽樣（實際走 App 抽選路徑）");
report.runtime.forEach(line);

out.push("");
out.push(failCount ? `結果：發現 ${failCount} 項問題` : "結果：全部通過");
console.log(out.join("\n"));
process.exit(failCount ? 1 : 0);
