// ============================================================================
// midnight（即時制擴張版）武器／戰技・魔術・祈禱 稽核腳本（純 node，不需要
// Playwright／emulator）。docs/midnight_weapon_skill_audit.md 的數字由這支腳本產生。
// 改動 weapons_*.js／midnight.js／character_drawer.js 後可重跑確認狀況有沒有變。
// ============================================================================
// 做三件事：
//   ① 結構化完整性：369 把武器 × 32 個分類 × weapons_skills.js 的 306 條戰技／魔術／
//      祈禱 × 各分類 innateSkills 的 99 條固有技能，檢查 category 參照、art／innate
//      的 id 參照、隨機戰技抽選表（randomSkillTable／namedSkillTables）的 id 參照
//      是否都解得開，以及 id 重複／缺 zh 或 ja／本文空白／孤兒戰技（任何路徑都抽不到）。
//   ② midnight 可達性：midnight.js 的施放入口只有兩個——weaponArtEntry()（右手、
//      非盾非杖非聖印、且只取 matches[0]）與 weaponSpellEntries()（杖／聖印，左右手
//      各 2 個按鈕槽）。據此算出每把武器「資料上有幾個 Action 招式」對「midnight 實際
//      按得到幾個」，差額就是接不到的缺口。
//   ③ 招式效果套用度：對每一條 Action 本文，跑一遍 midnight.js
//      computeMidnightSkillDamage() 的同一條 fallback 鏈（spellSkillPowerValue →
//      artSkillPowerValue → fixedSkillPowerValue → bareGuardSymbolSkillValue）確認
//      威力算不算得出來；再用本文措辭掃出 castWeaponSkillEntry() 目前**不會**處理的
//      效果子句（屬性／狀態異常蓄積、雜兵 HP 損害的 □、HP／FP 回復、敵視、隊列條件
//      等），逐條列出。
//
// 執行方式：npm run audit:weapon_skills（或 node weapon_skill_audit.js）
// 以 --md 參數執行會輸出 Markdown（docs 用），預設輸出人類可讀的 console 報告。
// 純稽核腳本，不會因為有缺口而 exit 1（缺口清單本身就是產出）。
// ============================================================================
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SRC = process.env.PRITEST_SRC || path.resolve(__dirname, "../../static_src");
const AS_MD = process.argv.indexOf("--md") !== -1;

// ---- 載入資料模組與 character_drawer.js 的真實解析函式 ---------------------
// character_drawer.js 會碰 document／localStorage，這裡給最小 stub 讓它跑得起來
// （只用到純函式部分：威力解析與消耗解析，不碰 DOM）。
const stubEl = { style: {}, appendChild() {}, setAttribute() {}, addEventListener() {}, classList: { add() {}, remove() {} } };
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
[
  "weapons_categories.js",
  "weapons_skills.js",
  "weapons_data.js",
  "weapons.js",
  "character_types.js",
  "talismans.js",
  "consumables.js",
  "weapon_rulebook.js",
  "character_drawer.js",
].forEach((f) => vm.runInContext(fs.readFileSync(path.join(SRC, f), "utf8"), sandbox));

const Weapons = sandbox.window.PriTestWeapons;
const SKILLS = sandbox.window.PriTestWeaponsSkills;
const CD = sandbox.window.PriTestCharacterDrawer;
const CATEGORIES = Weapons.categories();
const WEAPONS = Weapons.list();
// 換行正規化成 \n：專案檔案是 CRLF，下面用 /\n  \}\n/ 抓函式本體結尾的 regex
// 在 CRLF 下會抓不到（實測會整支腳本 throw）。
const midnightSrc = fs.readFileSync(path.join(SRC, "midnight.js"), "utf8").replace(/\r\n/g, "\n");

const catById = {};
CATEGORIES.forEach((c) => (catById[c.id] = c));

// 全分類的 innateSkills 攤平成 id → skill（getEquippedWeaponSkillEntries 的查法一樣是
// 掃過所有分類，不限定該武器自己的分類）。
const INNATE_BY_ID = {};
CATEGORIES.forEach((c) =>
  (c.innateSkills || []).forEach((s) => {
    if (!INNATE_BY_ID[s.id]) INNATE_BY_ID[s.id] = { skill: s, categoryId: c.id };
  })
);

const zh = (f) => (f && (f.zh || f.ja)) || "";

// ---- ① 結構化完整性 --------------------------------------------------------
const structural = {
  badCategory: [],
  badArtRef: [],
  badInnateRef: [],
  badTableRef: [],
  dupWeaponId: [],
  missingLang: [],
  emptyBody: [],
  unconfirmed: [],
  orphanSkills: [],
  unknownRefKind: [],
  shieldMissingFields: [],
  deadRandomSlot: [],
};

const KNOWN_REF_KINDS = ["innate", "art", "random", "status", "element", "element_minus5", "status_minus5", "bonus", "special", "note"];

// 武器 id 重複
const seenWeaponId = {};
WEAPONS.forEach((w) => {
  if (seenWeaponId[w.id]) structural.dupWeaponId.push(w.id);
  seenWeaponId[w.id] = true;
});

// 每把武器的 ref 走一遍
function refsOfWeapon(w) {
  const cat = catById[w.category];
  if (cat && cat.isShield) {
    return (w.attachedEffect || [])
      .map((ref) => ({ ref, slot: "attached" }))
      .concat((w.reverseArt || []).map((ref) => ({ ref, slot: "reverse" })));
  }
  return (w.skills || []).map((ref) => ({ ref, slot: null }));
}

WEAPONS.forEach((w) => {
  const cat = catById[w.category];
  if (!cat) {
    structural.badCategory.push(`${w.id}（category="${w.category}" 不存在）`);
    return;
  }
  if (!w.name || !w.name.zh || !w.name.ja) structural.missingLang.push(`${w.id}（武器名缺 zh 或 ja）`);
  // kind:"note" のプレースホルダー（「L表には該当盾なし→Rの表で再抽選」等）は実際の盾ではないので、
  // attachedEffect／reverseArt を持たないのが正しい。ここで除外しないと誤検知になる。
  const isNotePlaceholder = (w.skills || []).length === 1 && (w.skills || [])[0].kind === "note";
  if (cat.isShield && !isNotePlaceholder && !w.attachedEffect && !w.reverseArt) structural.shieldMissingFields.push(w.id);
  refsOfWeapon(w).forEach(({ ref }) => {
    if (KNOWN_REF_KINDS.indexOf(ref.kind) === -1) structural.unknownRefKind.push(`${w.id} → kind="${ref.kind}"`);
    // 隨機戰技槽但該分類沒有任何抽選表 → resolveRandomSkillForItem() 永遠回傳
    // skillId:null，這個槽永遠解不開，武器等於少一個戰技。
    if (ref.kind === "random") {
      const hasSimple = (cat.randomSkillTable || []).length > 0;
      const hasNamed = (cat.namedSkillTables || []).length > 0;
      if (!hasSimple && !hasNamed) structural.deadRandomSlot.push(`${w.id}（${zh(w.name)}／分類 ${cat.id} 沒有任何隨機戰技抽選表）`);
      else if (hasNamed && ref.table !== undefined) {
        const letters = (cat.namedSkillTables || []).map((t) => (zh(t.title).match(/[（(]([A-Z])[）)]/) || [])[1]).filter(Boolean);
        if (letters.indexOf(ref.table) === -1)
          structural.deadRandomSlot.push(`${w.id}（${zh(w.name)}）→ table="${ref.table}" 在分類 ${cat.id} 的抽選表（${letters.join("/")}）中不存在`);
      }
    }
    if (ref.kind === "art" && !SKILLS[ref.id]) structural.badArtRef.push(`${w.id} → art id "${ref.id}" 在 weapons_skills.js 找不到`);
    if (ref.kind === "innate" && !INNATE_BY_ID[ref.id]) structural.badInnateRef.push(`${w.id} → innate id "${ref.id}" 在任何分類的 innateSkills 都找不到`);
  });
});

// 隨機抽選表的 id 參照 + 收集「抽得到的 skill id」
const drawableSkillIds = {};
CATEGORIES.forEach((c) => {
  (c.randomSkillTable || []).forEach((row) => {
    if (!row.id) return;
    drawableSkillIds[row.id] = true;
    if (!SKILLS[row.id] && !INNATE_BY_ID[row.id]) structural.badTableRef.push(`分類 ${c.id} randomSkillTable roll=${row.roll} → id "${row.id}" 解不開`);
  });
  (c.namedSkillTables || []).forEach((t) => {
    (t.rows || []).forEach((row) => {
      if (!row.id) return;
      drawableSkillIds[row.id] = true;
      if (!SKILLS[row.id] && !INNATE_BY_ID[row.id])
        structural.badTableRef.push(`分類 ${c.id}「${zh(t.title)}」roll=${row.roll} → id "${row.id}" 解不開`);
    });
  });
});

// 固定掛在武器上的 skill id
const fixedSkillIds = {};
WEAPONS.forEach((w) =>
  refsOfWeapon(w).forEach(({ ref }) => {
    if ((ref.kind === "art" || ref.kind === "innate") && ref.id) fixedSkillIds[ref.id] = true;
  })
);

// 孤兒：weapons_skills.js 有這條，但既不固定掛在任何武器上，也不在任何抽選表裡。
// さらに「なぜ孤児なのか」で3分類する（「所有招式都有被配對」の確認用）：
//   A 重複轉錄：ja名が既配對の別idと完全一致（＝同じ規則書エントリを2回転記した死にデータ）
//   B 子能力  ：名前が他の招式の本文から「…」で参照される（例：夜と焰の構えが付与する
//               「魔力の光線」「炎の雑払い」）。配對が無いのが正しい
//   C 未配對  ：上のどちらでもない＝本当に抽選表/武器のデータ待ち
const orphanIds = Object.keys(SKILLS).filter((id) => !fixedSkillIds[id] && !drawableSkillIds[id]);
const pairedByJaName = {};
Object.keys(SKILLS)
  .filter((id) => fixedSkillIds[id] || drawableSkillIds[id])
  .forEach((id) => {
    const n = (SKILLS[id].name || {}).ja;
    if (!n) return;
    (pairedByJaName[n] = pairedByJaName[n] || []).push(id);
  });
let allBodyText = "";
Object.keys(SKILLS).forEach((id) => (allBodyText += (SKILLS[id].body.ja || "") + "\n" + (SKILLS[id].body.zh || "") + "\n"));
CATEGORIES.forEach((c) =>
  (c.innateSkills || []).forEach((s) => (allBodyText += ((s.body || {}).ja || "") + "\n" + ((s.body || {}).zh || "") + "\n"))
);
const orphanClass = { dup: [], sub: [], unpaired: [] };
orphanIds.forEach((id) => {
  const s = SKILLS[id];
  const ja = (s.name || {}).ja || "";
  const z = (s.name || {}).zh || "";
  if (pairedByJaName[ja]) orphanClass.dup.push({ id, ja, z, dup: pairedByJaName[ja] });
  else if (allBodyText.indexOf("「" + ja + "」") !== -1 || (z && allBodyText.indexOf("「" + z + "」") !== -1)) orphanClass.sub.push({ id, ja, z });
  else orphanClass.unpaired.push({ id, ja, z });
});
orphanIds.forEach((id) => structural.orphanSkills.push(`${id}（${zh(SKILLS[id].name)}）`));

// 本文空白／未確認／缺語系
function auditBody(id, label, skill) {
  const b = skill.body || {};
  if (!b.zh && !b.ja) structural.emptyBody.push(`${label} ${id}（${zh(skill.name)}）本文空白`);
  else if (!b.zh || !b.ja) structural.missingLang.push(`${label} ${id}（${zh(skill.name)}）本文缺 zh 或 ja`);
  if (/未確認|判読できず|判讀不易/.test(zh(b))) structural.unconfirmed.push(`${label} ${id}（${zh(skill.name)}）`);
}
Object.keys(SKILLS).forEach((id) => auditBody(id, "戰技", SKILLS[id]));
Object.keys(INNATE_BY_ID).forEach((id) => auditBody(id, "固有", INNATE_BY_ID[id].skill));

// ---- ② midnight 可達性 ----------------------------------------------------
// midnight.js 的施放入口（原始碼實況，見檔頭說明）。2026-09-12 起：
//   〔戰技A〕btn-midnight-skill = weaponActionEntriesForSide("R")[0]（含盾，排除杖/聖印）
//   〔戰技B/B1/B2〕每側 = sideSkillButtonEntries(side)
//        = 杖/聖印 ? 魔術/祈禱 : （右手 arts.slice(1)／左手 arts 全部），可定位 2 槽
const HAS_SIDE_ART_ENTRY = midnightSrc.indexOf("function weaponActionEntriesForSide") !== -1;
const HAS_SHARED_SIDE_LIST = midnightSrc.indexOf("function sideSkillButtonEntries") !== -1;
// fnBody() で関数本体に限定して判定する。`/function X\([\s\S]*?isShield/` のような
// 無境界の lazy regex は、後続の別関数にある isShield まで拾って誤判定する。
const ENTRY_ART_EXCLUDES_SHIELD = /category\.isShield/.test(fnBody("weaponActionEntriesForSide"));
// 每側可定位的魔術／祈禱槽數：SORCERY_BUTTON_DEFS 每側有 3 個按鈕，但 slot:null 那個
// 在 sorceryButtonEntry() 裡只有「entries 剛好 1 個」時才回傳 entries[0]，因此真正能
// 定位到第 N 個 entry 的只有 slot:0／slot:1 兩個 → 每側 2 槽。
const SORCERY_DEFS_SRC = (midnightSrc.match(/SORCERY_BUTTON_DEFS\s*=\s*\[[\s\S]*?^  \];/m) || [""])[0];
const SORCERY_SLOTS_PER_SIDE = new Set(SORCERY_DEFS_SRC.match(/slot:\s*(\d+)/g) || []).size;

function actionEntriesOfWeapon(w) {
  // 資料上這把武器可以產生幾個 Action 招式（隨機槽以「抽到 Action 的可能性」計 1）
  const fixed = [];
  let randomSlots = 0;
  refsOfWeapon(w).forEach(({ ref }) => {
    if (ref.kind === "random") {
      randomSlots++;
      return;
    }
    let skill = null;
    if (ref.kind === "art") skill = SKILLS[ref.id];
    else if (ref.kind === "innate") skill = INNATE_BY_ID[ref.id] && INNATE_BY_ID[ref.id].skill;
    if (skill && skill.kind === "Action") fixed.push({ id: ref.id, skill });
  });
  return { fixed, randomSlots };
}

// 各武器が「その側で何個まで押せるか」。右手の一般武器/盾は 戰技A(1) + B1/B2(2) = 3、
// 左手は B1/B2 の 2、杖/聖印はどちらの手でも 2。
const reach = { rightBlocked: [], leftBlocked: [], spellBlocked: [] };

WEAPONS.forEach((w) => {
  const cat = catById[w.category];
  if (!cat) return;
  const { fixed, randomSlots } = actionEntriesOfWeapon(w);
  const potential = fixed.length + randomSlots;
  if (!potential) return;
  const isSpellCat = cat.id === "staff" || cat.id === "sacred_seal";
  const rightCap = isSpellCat ? SORCERY_SLOTS_PER_SIDE : 1 + SORCERY_SLOTS_PER_SIDE;
  const leftCap = SORCERY_SLOTS_PER_SIDE;
  const rec = { w, potential, fixed, randomSlots };
  if (isSpellCat) {
    if (potential > SORCERY_SLOTS_PER_SIDE) reach.spellBlocked.push(rec);
  } else {
    if (potential > rightCap) reach.rightBlocked.push(rec);
    if (potential > leftCap) reach.leftBlocked.push(rec);
  }
});

// ---- ③ 招式效果套用度 -----------------------------------------------------
// midnight.js castWeaponSkillEntry() 目前實際做的事（原始碼實況）
// castWeaponSkillEntry() 的**函式本體**（從宣告行抓到同縮排的收尾大括號為止）。
// 不能用「宣告行後面 N 個字元」當範圍——檔案裡緊接在後的 healSelfHp()／spendSelfHp()
// 等函式定義會造成誤判（實測會把「有呼叫 healSelfHp」判成 true）。
function fnBody(name) {
  const m = midnightSrc.match(new RegExp("\\n  function " + name + "\\([\\s\\S]*?\\n  \\}\\n"));
  return m ? m[0] : "";
}
const CAST_BODY = fnBody("castWeaponSkillEntry");
if (!CAST_BODY) throw new Error("找不到 castWeaponSkillEntry() 函式本體——midnight.js 結構已變，請更新這支腳本");
// castWeaponSkillEntry() が呼ぶ本文效果套用ヘルパー（2026-09-12 追加）まで1段だけ追う。
// これを見ないと「recordAttributeAccum を呼んでいない」と誤判定する。
const CAST_SCOPE = CAST_BODY + fnBody("applyWeaponSkillBodyEffects");
const callsInCast = (name) => CAST_SCOPE.indexOf(name) !== -1;

const CAST_APPLIES = {
  cost: callsInCast("computeMidnightSkillCost"),
  damage: callsInCast("damageCombatTarget"),
  prayerFirepower: callsInCast("maybeApplyPrayerFirepower"),
  roarBuff: callsInCast("maybeApplyRoarArtBuff"),
  // 以下是「castWeaponSkillEntry() 本體裡有沒有呼叫」
  accum: callsInCast("recordAttributeAccum"),
  heal: callsInCast("healSelfHp") || callsInCast("healSelfFp"),
  aggro: /aggro|敵視/i.test(CAST_BODY),
  hpValue: /hpValue|HP價值/i.test(CAST_BODY),
  // 這兩個解析器在整個 midnight.js 裡有沒有出現（night.js 有，用來對照）
  mobSquares: midnightSrc.indexOf("countMobDamageSquares") !== -1,
  healSquares: midnightSrc.indexOf("countHealSquares") !== -1,
};

// 本文效果子句偵測（只抓「有可計算數值、但 midnight 不處理」的句型；■ 類依
// CLAUDE.md §19 另外分開統計，那是刻意交給 GM 的，不算缺口）。
const CLAUSE_DEFS = [
  {
    key: "accum",
    label: "屬性／狀態異常蓄積（固定值）",
    // 「炎：2」「魔：4」「出血：2」「凍傷：3」「發狂：2」「聖：2」「雷：2」…
    re: /「(?:炎|魔|雷|聖|出血|凍傷|毒|猛毒|腐敗|睡眠|發狂|狂|詛咒|咒死)[：:]\s*\d+」/g,
    applied: () => CAST_APPLIES.accum,
  },
  {
    key: "accumDice",
    label: "屬性／狀態異常蓄積（1D／2D，需擲骰）",
    re: /「(?:炎|魔|雷|聖|出血|凍傷|毒|猛毒|腐敗|睡眠|發狂|狂|詛咒)[：:]\s*\d*D[^」]*」/g,
    applied: () => CAST_APPLIES.accum,
  },
  {
    key: "healSquare",
    label: "HP／FP 回復（□，可計算）",
    re: /「?(?:HP|FP)回復[：:]\s*□+(?:×\d+)?」?/g,
    applied: () => CAST_APPLIES.healSquares,
  },
  {
    key: "mobSquare",
    label: "雜兵 HP 損害（□，可計算）",
    re: /(?:雜兵|モブ|ザコ|雜魚)[^」]{0,8}「?HP損害[：:]\s*□+」?/g,
    applied: () => CAST_APPLIES.mobSquares,
  },
  {
    key: "aggro",
    label: "敵視變更",
    re: /敵視[：:]\s*[＋+－\-]?\d+/g,
    applied: () => CAST_APPLIES.aggro,
  },
  {
    key: "accumBonus",
    label: "蓄積值加成（「蓄積值：＋N」）",
    re: /「蓄積值[：:]\s*[＋+]\d+」/g,
    applied: () => CAST_APPLIES.accum,
  },
  {
    key: "hpValue",
    label: "HP 價值變更（Guard／HP-value）",
    re: /「HP價值[：:]\s*[＋+－\-]\d+」/g,
    applied: () => CAST_APPLIES.hpValue,
  },
];

// ■ 類（刻意 GM 手動，非缺口）
const SQUARE_UNKNOWN_RE = /HP損害[：:]\s*■+/g;
// 體型條件（bareGuardSymbolSkillValue 刻意回傳 null，非缺口）
const SIZE_COND_RE = /「?體型[：:]\s*L+」?/;

const actionBodies = [];
Object.keys(SKILLS).forEach((id) => {
  if (SKILLS[id].kind === "Action") actionBodies.push({ id, src: "weapons_skills.js", skill: SKILLS[id] });
});
Object.keys(INNATE_BY_ID).forEach((id) => {
  const s = INNATE_BY_ID[id].skill;
  if (s.kind === "Action") actionBodies.push({ id, src: "weapons_categories.js:" + INNATE_BY_ID[id].categoryId, skill: s });
});

// 該招式是掛在杖／聖印上嗎（決定 computeMidnightSkillDamage 走 spell 還是 art 分支）
const spellSkillIds = {};
WEAPONS.forEach((w) => {
  const cat = catById[w.category];
  if (!cat || (cat.id !== "staff" && cat.id !== "sacred_seal")) return;
  refsOfWeapon(w).forEach(({ ref }) => {
    if ((ref.kind === "art" || ref.kind === "innate") && ref.id) spellSkillIds[ref.id] = true;
  });
});
CATEGORIES.forEach((c) => {
  if (c.id !== "staff" && c.id !== "sacred_seal") return;
  (c.randomSkillTable || []).forEach((r) => r.id && (spellSkillIds[r.id] = true));
  (c.namedSkillTables || []).forEach((t) => (t.rows || []).forEach((r) => r.id && (spellSkillIds[r.id] = true)));
});

// midnight 的威力 fallback 鏈（與 computeMidnightSkillDamage 完全同順序）
function midnightDamageOf(bodyText, isSpell) {
  const artPower = 0; // 稽核用：只看「解不解得出來」，不看實際角色加成
  let r = isSpell ? CD.spellSkillPowerValue(bodyText, artPower) : CD.artSkillPowerValue(bodyText, artPower);
  if (!r) r = CD.fixedSkillPowerValue(bodyText);
  if (!r) r = CD.bareGuardSymbolSkillValue(bodyText);
  return r;
}

const dmgUnresolved = [];
const clauseGaps = {};
CLAUSE_DEFS.forEach((d) => (clauseGaps[d.key] = []));
let squareUnknownCount = 0;

actionBodies.forEach((a) => {
  const body = zh(a.skill.body);
  const isSpell = !!spellSkillIds[a.id];
  const dmg = midnightDamageOf(body, isSpell);
  if (!dmg) dmgUnresolved.push({ ...a, body, isSpell, sizeCond: SIZE_COND_RE.test(body) });
  if ((body.match(SQUARE_UNKNOWN_RE) || []).length) squareUnknownCount++;
  CLAUSE_DEFS.forEach((d) => {
    if (d.applied()) return;
    const hits = body.match(d.re);
    if (hits && hits.length) clauseGaps[d.key].push({ ...a, hits: [...new Set(hits)] });
  });
});

// ---- 輸出 ------------------------------------------------------------------
const out = [];
const P = (s) => out.push(s === undefined ? "" : s);
const H = (lvl, s) => P(AS_MD ? "#".repeat(lvl) + " " + s : "\n=== " + s + " ===");
const LI = (s) => P(AS_MD ? "- " + s : "  - " + s);

H(1, "midnight 武器／戰技・魔術・祈禱 稽核");
P();
P(
  `資料規模：武器 ${WEAPONS.length} 把 / 分類 ${CATEGORIES.length} 個（其中盾 ${CATEGORIES.filter((c) => c.isShield).length} 個）/ ` +
    `weapons_skills.js ${Object.keys(SKILLS).length} 條 / 各分類 innateSkills ${Object.keys(INNATE_BY_ID).length} 條 / ` +
    `其中 Action 類招式合計 ${actionBodies.length} 條`
);
P();

H(2, "① 結構化完整性");
P();
const structLabels = {
  badCategory: "武器的 category 參照解不開",
  badArtRef: "art id 參照解不開",
  badInnateRef: "innate id 參照解不開",
  badTableRef: "隨機戰技抽選表的 id 參照解不開",
  dupWeaponId: "武器 id 重複",
  unknownRefKind: "未知的 skill ref kind",
  shieldMissingFields: "盾缺 attachedEffect／reverseArt 欄位",
  deadRandomSlot: "隨機戰技槽永遠抽不出東西（分類無抽選表／table 字母對不上）",
  missingLang: "缺 zh 或 ja",
  emptyBody: "本文空白",
  unconfirmed: "本文標記為未確認",
  orphanSkills: "孤兒戰技（固定掛載與抽選表都到不了）",
};
let structTotal = 0;
Object.keys(structLabels).forEach((k) => {
  const arr = structural[k];
  structTotal += arr.length;
  P((AS_MD ? "**" : "") + `${structLabels[k]}：${arr.length} 筆` + (AS_MD ? "**" : ""));
  arr.slice(0, 40).forEach(LI);
  if (arr.length > 40) LI(`…另 ${arr.length - 40} 筆`);
  P();
});
P(`結構化問題合計：${structTotal} 筆`);
P();

H(2, "② midnight 可達性（招式按不按得到）");
P();
P(
  `midnight.js 入口實況：每側戰技B／B1／B2 可定位 ${SORCERY_SLOTS_PER_SIDE} 槽` +
    `（共用清單 sideSkillButtonEntries：${HAS_SHARED_SIDE_LIST ? "有" : "**無**"}）；` +
    `左右手皆可施放的一般武器／盾戰技（weaponActionEntriesForSide：${HAS_SIDE_ART_ENTRY ? "有" : "**無**"}，` +
    `盾${ENTRY_ART_EXCLUDES_SHIELD ? "仍被排除" : "已納入"}）；` +
    `右手另有〔戰技A〕專用鍵 → 右手上限 ${1 + SORCERY_SLOTS_PER_SIDE} 個、左手上限 ${SORCERY_SLOTS_PER_SIDE} 個、杖／聖印 ${SORCERY_SLOTS_PER_SIDE} 個。`
);
P();
function dumpReach(title, list) {
  P((AS_MD ? "**" : "") + `${title}：${list.length} 把` + (AS_MD ? "**" : ""));
  list.slice(0, 60).forEach((r) => {
    const names = r.fixed.map((f) => `${zh(f.skill.name)}(${f.id})`).join("、");
    LI(
      `${zh(r.w.name)}（${r.w.id}／${r.w.category}）：Action 招式 ${r.potential} 個` +
        (r.randomSlots ? `（含隨機槽 ${r.randomSlots}）` : "") +
        (names ? " — " + names : "")
    );
  });
  if (list.length > 60) LI(`…另 ${list.length - 60} 把`);
  P();
}
dumpReach(`一般武器／盾裝在右手時，招式數超過上限 ${1 + SORCERY_SLOTS_PER_SIDE} 而按不到`, reach.rightBlocked);
dumpReach(`一般武器／盾裝在左手時，招式數超過上限 ${SORCERY_SLOTS_PER_SIDE} 而按不到`, reach.leftBlocked);
dumpReach(`杖／聖印：第 ${SORCERY_SLOTS_PER_SIDE + 1} 個以後的魔術／祈禱按不到`, reach.spellBlocked);

H(2, "③ 招式效果套用度（castWeaponSkillEntry 實際處理範圍）");
P();
P("castWeaponSkillEntry() 目前會做的事：");
LI(`消耗（體力／FP／HP）解析與扣除：${CAST_APPLIES.cost ? "有" : "無"}`);
LI(`主傷害 → damageCombatTarget()：${CAST_APPLIES.damage ? "有" : "無"}`);
LI(`祈禱火力提升 buff：${CAST_APPLIES.prayerFirepower ? "有" : "無"}`);
LI(`咆哮系 2Hit buff：${CAST_APPLIES.roarBuff ? "有" : "無"}`);
LI(`屬性／狀態異常蓄積（recordAttributeAccum）：${CAST_APPLIES.accum ? "有" : "**無**"}`);
LI(`HP／FP 回復（healSelfHp／healSelfFp）：${CAST_APPLIES.heal ? "有" : "**無**"}`);
LI(`雜兵 □ 傷害（countMobDamageSquares）：${CAST_APPLIES.mobSquares ? "有" : "**無**（night.js 有，midnight 沒有）"}`);
LI(`回復 □ 解析（countHealSquares）：${CAST_APPLIES.healSquares ? "有" : "**無**（night.js 有，midnight 沒有）"}`);
P();

P((AS_MD ? "**" : "") + `威力無法自動解算、只顯示規則原文的 Action 招式：${dmgUnresolved.length} 條` + (AS_MD ? "**" : ""));
const sizeOnes = dmgUnresolved.filter((d) => d.sizeCond);
P(`（其中 ${sizeOnes.length} 條含「體型：L／LL」條件——bareGuardSymbolSkillValue 刻意回傳 null，屬設計上正確行為，非缺口）`);
dmgUnresolved
  .filter((d) => !d.sizeCond)
  .slice(0, 80)
  .forEach((d) => LI(`${zh(d.skill.name)}（${d.id}／${d.src}）：${d.body.slice(0, 90)}`));
const realUnresolved = dmgUnresolved.filter((d) => !d.sizeCond).length;
if (realUnresolved > 80) LI(`…另 ${realUnresolved - 80} 條`);
P();

CLAUSE_DEFS.forEach((d) => {
  const list = clauseGaps[d.key];
  P((AS_MD ? "**" : "") + `${d.label}：${list.length} 條招式的本文寫了，但 midnight 不會套用` + (AS_MD ? "**" : ""));
  list.slice(0, 60).forEach((a) => LI(`${zh(a.skill.name)}（${a.id}／${a.src}）：${a.hits.join("、")}`));
  if (list.length > 60) LI(`…另 ${list.length - 60} 條`);
  P();
});

P(
  `參考：本文含「HP損害：■」的 Action 招式 ${squareUnknownCount} 條——依 CLAUDE.md §19，` +
    `■ 不得自行發明數值，維持顯示規則原文交由 GM 處理即為正確現狀，不列為缺口。`
);
P();

// ---- 結論：缺口一覽與性質判斷 ---------------------------------------------
H(2, "④ 缺口一覽（依性質分類）");
P();
P("下面是把 ①〜③ 的結果整理成「要不要動工」的判斷。**規則數值未確認的項目一律不列為要實作**（CLAUDE.md §4／§19）。");
P();
P((AS_MD ? "**" : "") + "A. 參照解不開的 skill ref（確定是 bug、與規則無關）" + (AS_MD ? "**" : ""));
LI(
  structural.badArtRef.length + structural.badInnateRef.length === 0
    ? `目前 0 筆。（2026-09-12 已修：weapons_data.js 曾有 4 筆把 colossal 的固有技能寫成 kind:"art"，` +
        `而 kind:"art" 只查 weapons_skills.js，查不到就整條丟掉，導致那 4 把特大武器的招式在 night/midnight 都不存在。）`
    : `art ref ${structural.badArtRef.length} 筆、innate ref ${structural.badInnateRef.length} 筆解不開，招式會被 getEquippedWeaponSkillEntries() 整條丟掉。`
);
P();
P((AS_MD ? "**" : "") + `B. 招式配對狀況：${structural.orphanSkills.length} 條沒有配對到任何武器／抽選表` + (AS_MD ? "**" : ""));
LI(
  `B-1 重複轉錄 ${orphanClass.dup.length} 條：ja 名稱與「已配對的另一條」完全相同＝同一條規則書項目被轉記了兩次，` +
    `其中一份是永遠抽不到的死資料。刪除前要先核對規則書，確認不是「同名的兩條不同項目」。`
);
orphanClass.dup.forEach((o) => LI(`　　${o.id}（${o.ja}）← 已配對同名：${o.dup.join("、")}`));
LI(
  `B-2 子能力 ${orphanClass.sub.length} 條：名稱被其他招式的本文以「…」引用（例：夜與焰之構賦予「魔力的光線」「炎的雜清」），` +
    `本來就不該有自己的配對——非缺口，現狀正確。`
);
orphanClass.sub.forEach((o) => LI(`　　${o.id}（${o.ja} / ${o.z}）`));
LI(`B-3 真正未配對 ${orphanClass.unpaired.length} 條：既非重複也沒被引用，是抽選表／武器資料還沒謄完。需要規則書照片才能補，程式不用改。`);
orphanClass.unpaired.forEach((o) => LI(`　　${o.id}（${o.ja} / ${o.z}）`));
P();
P((AS_MD ? "**" : "") + "B-old. 參考：原本的整批孤兒清單" + (AS_MD ? "**" : ""));
LI(
  `孤兒戰技 ${structural.orphanSkills.length} 條：本文已謄寫在 weapons_skills.js，但沒有任何武器固定掛載、也不在任何隨機抽選表裡，` +
    `所以玩家永遠取得不到。多數是 spell_*／prayer_*，對照杖的「隨機魔術（A）（B）決定表」各 30 列、聖印的（A）（B）（C）各 35/35/33 列，` +
    `推測是抽選表本身還沒謄完。需要規則書照片才能補，程式不用改。`
);
P();
P((AS_MD ? "**" : "") + "C. midnight 施放入口（2026-09-12 補齊）" + (AS_MD ? "**" : ""));
LI(
  `盾的裏戰技／附帶效果：${HAS_SIDE_ART_ENTRY && !ENTRY_ART_EXCLUDES_SHIELD ? "已可施放" : "**仍無入口**"}` +
    `（weaponActionEntriesForSide() 不再排除 isShield，左右手皆可）。`
);
LI(`左手一般武器的戰技：${HAS_SIDE_ART_ENTRY ? "已可施放" : "**仍無入口**"}（戰技B／B1／B2 在該側非杖/聖印時改顯示該側武器的戰技）。`);
LI(
  `同一把武器的多個戰技：右手上限 ${1 + SORCERY_SLOTS_PER_SIDE} 個、左手 ${SORCERY_SLOTS_PER_SIDE} 個。` +
    `目前超過上限而按不到的武器：右手 ${reach.rightBlocked.length} 把／左手 ${reach.leftBlocked.length} 把／杖聖印 ${reach.spellBlocked.length} 把。`
);
P();
P((AS_MD ? "**" : "") + "D. 招式本文的附帶效果套用狀況（2026-09-12 補齊，剩下的為未動工）" + (AS_MD ? "**" : ""));
CLAUSE_DEFS.forEach((d) => {
  const n = clauseGaps[d.key].length;
  if (!n) return;
  LI(`${d.label}：${n} 條`);
});
LI(
  `威力本身就解算不出來、只 showToast 規則原文的：${dmgUnresolved.length} 條——其中多數是「直到結束階段為止…」的 buff 型招式（附加屬性、防護、HP價值、追加技能），` +
    `即時制要先決定換算規則才能實作（既有通則：階段 → 10 秒，見 midnight_text_adapt.js）。`
);
P();

console.log(out.join("\n"));
