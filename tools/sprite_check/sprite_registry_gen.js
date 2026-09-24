// sprite sheet の登録表を生成する。
//
//   node tools/sprite_check/sprite_registry_gen.js --write
//
// 切り分け規則（spec §5.2）：
//   ・系統内の size に落差がある → 体型で大(a)／小(b)
//   ・系統内の size が全て同じ   → enemies 配列の前半(a)／後半(b)
// 機械的な初期配分なので、気に入らない割当は OVERRIDES で個別に上書きする。
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..", "..");
const WRITE = process.argv.indexOf("--write") !== -1;
const REGISTRY_PATH = path.join(ROOT, "static_src", "enemy_sprite_registry.js");
const sandbox = { window: {}, console };
vm.createContext(sandbox);
["1", "2", "3", "4"].forEach(function (n) {
  const p = path.join(ROOT, "static_src", "enemies_data_" + n + ".js");
  vm.runInContext(fs.readFileSync(p, "utf8"), sandbox, { filename: "enemies_data_" + n + ".js" });
});
const FAMILIES = [].concat(
  sandbox.window.PriTestEnemiesData1,
  sandbox.window.PriTestEnemiesData2,
  sandbox.window.PriTestEnemiesData3,
  sandbox.window.PriTestEnemiesData4
);

// "familyId/enemyId": "a" | "b"
// 系統内の a／b 分けだけを手で選び直す。體型や配列順から出る機械的な初期配分が
// 絵と合っていないときに使う。
//
// 2026-09-23 使用者明確規格：トロル系の 3 隻を b へ。騎士トロル（a の絵）とは
// 見た目の系統が違うため。
const OVERRIDES = {
  "troll_dragonkin_wormface/headless_trolls": "b",
  "troll_dragonkin_wormface/mad_flame_troll": "b",
  "troll_dragonkin_wormface/snowfield_trolls": "b"
};

// "familyId/enemyId": sheetId
// 系統の a／b では表せない割当を、sheet id ごと直に指定する（2026-09-23 使用者明確規格）。
// OVERRIDES が「自分の系統のどちらの変体か」を選ぶのに対し、こちらは系統の枠を越える：
//   ・別の敵の專屬 sheet を共用する（暗黒の落とし子（枯れ）→ 暗黒の落とし子の絵。
//     同じ個体の別状態なので、系統の代表図より本人の絵のほうが近い）
//   ・別系統の sheet を使う（著大犬 → 騎士トロル系の絵）
// 指定先は「產出済みかどうか」を問わず既存の sheet id でなければならない（末尾で検証）。
const SHEET_OVERRIDES = {
  "rock_spirit_beast/dark_offspring_withered": "enemy_rock_spirit_beast_dark_offspring",
  "big_dog_bear/huge_dog": "family_troll_dragonkin_wormface_a"
};

// 個別敵人專屬 sheet（2026-09-23 使用者提供的 22 張生成物）。
//
// 系統 sheet（family_<id>_a／_b）是「1 張代表整個系統」，同系統的其他敵人共用它。
// 這裡列出的敵人則是「這一隻有自己的絵」，sheet id 為 enemy_<familyId>_<enemyId>。
//
// 未產出のあいだは系統 sheet に戻る（登錄表側の sheetIdForEnemy() が available まで見る）
// ——夜王の形態別 sheet と同じ考え方で、絵が無い間に 404 を出さないため。
//
// ここに並べるのは「系統 sheet が既に別の敵の絵で埋まっている」場合だけにする。
// その変体の唯一の成員だったり、変体がまだ未產出なら、専用 sheet を作らずに
// 系統 sheet そのものへ絵を入れたほうがよい——同じ絵を 2 枚持つことになるし、
// 系統 sheet が誰にも使われない死んだファイルになる。
const ENEMY_OWN = [
  "golem_maiden_puppet/guardian_golem",
  "golem_maiden_puppet/kidnapper_maiden_puppets",
  "cavalry/tree_guard_capital_cavalry",
  "formless_other/miranda_flowers",
  "undead/graveyard_shades",
  "crustacean/big_crabs",
  "demihuman_beastfolk_club/lion_hybrids",
  "warrior_swordsman/stoneskin_kings",
  "warrior_swordsman/divine_beast_warriors",
  "warrior_swordsman/divine_bird_warrior",
  "mage_messenger/oracle_envoys",
  "crystal_puppet/crystal_people",
  "rock_spirit_beast/golden_hippo",
  "imp_watchdog_gargoyle/black_blade_kindred",
  // 2026-09-23 第2バッチ
  "cavalry/carian_royal_guard",
  "troll_dragonkin_wormface/nox_dragonkin_soldier",
  "rat_basilisk/finger_bugs",
  "dragon/great_earth_dragon",
  "dragon/gluttonous_dragon",
  "strong_type/loathed_demon",
  "strong_type/divine_skin_apostles",
  "strong_type/blood_lord",
  "soldier_knight/battlefield_veteran",
  "soldier_knight/death_knight",
  "soldier_knight/hound_knight",
  "soldier_knight/bell_bearing_hunter",
  "grafted/grafted_lord",
  "rock_spirit_beast/dark_offspring",
  "rock_spirit_beast/sacred_beast_lion_dance",
  "rock_spirit_beast/falling_star_beast",
  "big_dog_bear/old_lions"
];

function ownSheetIdFor(key) {
  return "enemy_" + key.replace("/", "_");
}

const BOSSES = [
  "maris", "fulghor", "harmonia", "gladius", "gnoster",
  "caligo", "libra", "edele", "stragedes", "nameless"
];
// 形態ごとに別の sheet を持つ夜王（2026-09-22 使用者明確規格「確保有些敵人會有不同型態，
// 產生兩種以上點陣圖」）。
//
// 一覧は手で並べない——boss_auto_gm_data.js の formAware をそのまま使う。あちらは
// 「形態ごとに行動決定表が別」という戦闘ルール側の事実で、形態が変われば見た目も変わる。
// 手で並べると、あとで formAware な夜王が増えたときに必ず片方だけ古くなる。
//
// 追加する sheet の接尾辞は state.battle.bossForm が取る値そのもの（"fused"／"split"）。
// 既定の形態（fused）は boss_<id>.png のままなので、増えるのは "split" のぶんだけ。
// 「split」は harmonia／nameless のように意味が「第二形態」でも同じ値を使う（絵が
// 別物だという主張ではなく、単に登錄表の鍵を bossForm に揃えているだけ）。
const BOSS_AUTO_GM = (function () {
  const sb = { window: {}, console: { log: function () {}, warn: function () {}, error: function () {} } };
  vm.createContext(sb);
  vm.runInContext(
    fs.readFileSync(path.join(ROOT, "static_src", "boss_auto_gm_data.js"), "utf8"),
    sb,
    { filename: "boss_auto_gm_data.js" }
  );
  return sb.window.PriTestBossAutoGmData;
})();

// 形態別 sheet を実際に持つ夜王（2026-09-22 使用者明確規格）。
// formAware（＝戦闘ルール上は多形態）なのは gladius／harmonia／stragedes／nameless の
// 4 隻だが、「其餘兩個夜王也沒有第二種點陣圖，發生型態變化只後台使用，前面仍使用同一
// 點陣圖」との指示により、絵を別に持つのは gladius（合体⇄分裂）と harmonia（第二形態は
// 分身 9 体）の 2 隻だけにする。stragedes／nameless は形態が変わっても第一形態の絵のまま。
const BOSS_FORM_ART = { gladius: true, harmonia: true };

function formSheetsFor(bossId) {
  const data = BOSS_AUTO_GM && BOSS_AUTO_GM.get ? BOSS_AUTO_GM.get(bossId) : null;
  if (!data || !data.formAware) return [];
  return BOSS_FORM_ART[bossId] ? ["split"] : [];
}
const BIG = { LL: true, L: true };

function variantFor(fam, enemy, index) {
  const key = fam.id + "/" + enemy.id;
  if (OVERRIDES[key]) return OVERRIDES[key];

  const sizes = {};
  fam.enemies.forEach(function (e) {
    sizes[e.size] = true;
  });
  const sizeKeys = Object.keys(sizes);

  // 規則 1: 系統內 size 有落差時，依體型大小切分（LL/L→a，M/S→b）。
  // 但僅當落差導致跨越 BIG 與 SMALL 兩個桶時才有效。
  // 若所有 size 都落在同一個桶（例如都是 L/LL，或都是 M/S），
  // 則依體型切只會產生單一變體、另一邊必空，違反規則 3（無空變體）。
  // 此時退回規則 2（陣列順序對半切），保證兩邊都有員工。
  if (sizeKeys.length > 1) {
    var variants = {};
    sizeKeys.forEach(function (s) {
      variants[BIG[s] ? "a" : "b"] = true;
    });
    if (Object.keys(variants).length > 1) return BIG[enemy.size] ? "a" : "b";
    // 否則所有 size 都在同一個桶，退回陣列順序對半切
  }

  // 規則 2: 系統內 size 全部相同時，依 enemies 陣列順序前半(a)、後半(b)
  return index < Math.ceil(fam.enemies.length / 2) ? "a" : "b";
}

// 讀入現行的登錄表。available 是「圖片是否已產出」＝驗收的成果，只為了調整分組而重跑
// 產生器時若把它們一律寫成 false，已驗收的實績會無聲歸零，所以逐 sheet 沿用既有的值；
// 只有登錄表還不存在（第一次產生）時才從 false 開始。
// 順便把現行的分配讀出來，供預覽時計算「有幾筆分配會變動」。
function loadExisting() {
  if (!fs.existsSync(REGISTRY_PATH)) return null;
  const box = { window: {}, console };
  vm.createContext(box);
  vm.runInContext(fs.readFileSync(REGISTRY_PATH, "utf8"), box, {
    filename: "enemy_sprite_registry.js"
  });
  const reg = box.window.PriTestEnemySpriteRegistry;
  if (!reg || typeof reg.listSheets !== "function") return null;
  const available = {};
  reg.listSheets().forEach(function (s) {
    available[s.id] = !!s.available;
  });
  return {
    available: available,
    sheetIdForEnemy: reg.sheetIdForEnemy,
    familySheetIdForEnemy: reg.familySheetIdForEnemy
  };
}

const EXISTING = loadExisting();

function availableFor(sheetId) {
  if (!EXISTING) return false;
  return !!EXISTING.available[sheetId];
}

const assign = [];
let changedAssign = 0;
const knownKeys = {};
FAMILIES.forEach(function (f) {
  f.enemies.forEach(function (e, i) {
    const key = f.id + "/" + e.id;
    knownKeys[key] = true;
    const sheetId = SHEET_OVERRIDES[key] || "family_" + f.id + "_" + variantFor(f, e, i);
    assign.push('    "' + key + '": "' + sheetId + '"');
    // 比べる相手は「系統への割当」。sheetIdForEnemy() は專屬 sheet を優先して返すように
    // なったので（2026-09-23）、そちらと比べると專屬 sheet を持つ敵が毎回「変更あり」に
    // 数えられてしまう。familySheetIdForEnemy() が無いのは專屬 sheet 導入前の登錄表。
    if (EXISTING) {
      const prevFn = EXISTING.familySheetIdForEnemy || EXISTING.sheetIdForEnemy;
      if (prevFn(f.id, e.id) !== sheetId) changedAssign++;
    }
  });
});

// 綴り間違いをここで止める。登錄表に書けてしまうと、どの敵にも結び付かない sheet が
// 1 枚増えるだけで、check も verify も通ってしまう（ファイル名は自分で決めた名前なので）。
const unknownOwn = ENEMY_OWN.filter(function (k) {
  return !knownKeys[k];
});
if (unknownOwn.length) {
  console.error("ENEMY_OWN に enemies_data に無い鍵がある: " + unknownOwn.join("、"));
  process.exit(1);
}
const own = ENEMY_OWN.map(function (k) {
  return '    "' + k + '": "' + ownSheetIdFor(k) + '"';
});

const sheets = [];
let keptAvailable = 0;
function pushSheet(id) {
  const av = availableFor(id);
  if (av) keptAvailable++;
  sheets.push('    { id: "' + id + '", file: "' + id + '.png", available: ' + av + " }");
}
FAMILIES.forEach(function (f) {
  ["a", "b"].forEach(function (v) {
    pushSheet("family_" + f.id + "_" + v);
  });
});
ENEMY_OWN.forEach(function (k) {
  pushSheet(ownSheetIdFor(k));
});
BOSSES.forEach(function (b) {
  pushSheet("boss_" + b);
  formSheetsFor(b).forEach(function (form) {
    pushSheet("boss_" + b + "_" + form);
  });
});

// SHEET_OVERRIDES の指定先が実在する sheet かを確かめる。存在しない id を書くと、
// その敵は登錄表のどの sheet にも当たらず getSheet() が null を返す——戰鬥画面では
// 代役すら出ず、静止画のまま黙って通る（sheetIdForEnemy が返す id を誰も検証しない）。
const sheetIds = {};
sheets.forEach(function (line) {
  sheetIds[/\{ id: "([^"]+)"/.exec(line)[1]] = true;
});
const badOverride = Object.keys(SHEET_OVERRIDES).filter(function (k) {
  return !knownKeys[k] || !sheetIds[SHEET_OVERRIDES[k]];
});
if (badOverride.length) {
  badOverride.forEach(function (k) {
    console.error(
      "SHEET_OVERRIDES が不正: " + k + " -> " + SHEET_OVERRIDES[k] +
        (knownKeys[k] ? "（指定先の sheet が存在しない）" : "（enemies_data に無い敵）")
    );
  });
  process.exit(1);
}

const out =
  "(function () {\n" +
  "  // sprite sheet 的登錄表。\n" +
  "  // 自動產生: node tools/sprite_check/sprite_registry_gen.js --write\n" +
  "  // 不要手動修改——要改分配就去改產生器的 OVERRIDES 再重新產生。\n" +
  "  //\n" +
  "  // available 是「圖片是否已產出」。false 期間 midnight_sprite.js 會 fallback 到既有的\n" +
  "  // 靜止畫（spec §4）。圖片放進來之後由 sprite_pack.js 改寫成 true；重新產生登錄表時\n" +
  "  // 產生器會逐 sheet 沿用這裡既有的值，不會把已驗收的成果歸零。\n" +
  "  //\n" +
  "  // sheet は 3 種類：family_*（系統の代表 1 張）／enemy_*（個別敵人專屬）／boss_*（夜王）。\n" +
  "  var SHEETS = [\n" +
  sheets.join(",\n") +
  "\n  ];\n\n" +
  "  var ENEMY_SHEET = {\n" +
  assign.join(",\n") +
  "\n  };\n\n" +
  "  // 自分だけの絵を持つ敵（2026-09-23）。系統 sheet は 1 張が系統全体を代表する絵なので、\n" +
  "  // 個別に絵を起こした敵はこちらを優先する。available:false のあいだは系統 sheet に戻る。\n" +
  "  var ENEMY_OWN_SHEET = {\n" +
  own.join(",\n") +
  "\n  };\n\n" +
  "  function listSheets() {\n    return SHEETS;\n  }\n\n" +
  "  function getSheet(sheetId) {\n" +
  "    return (\n      SHEETS.filter(function (s) {\n        return s.id === sheetId;\n      })[0] || null\n    );\n  }\n\n" +
  "  // 系統への割当だけを返す（專屬 sheet を見ない）。系統 sheet の成員一覧や、\n" +
  "  // 「空の変体を作っていないか」の検査はこちらを使う。\n" +
  "  function familySheetIdForEnemy(familyId, enemyId) {\n" +
  '    return ENEMY_SHEET[familyId + "/" + enemyId] || null;\n  }\n\n' +
  "  // 表現層が使うのはこちら。專屬 sheet が產出済みならそれを、無ければ系統 sheet を返す。\n" +
  "  function sheetIdForEnemy(familyId, enemyId) {\n" +
  '    var own = ENEMY_OWN_SHEET[familyId + "/" + enemyId];\n' +
  "    if (own) {\n" +
  "      var ownSheet = getSheet(own);\n" +
  "      if (ownSheet && ownSheet.available) return own;\n" +
  "    }\n" +
  "    return familySheetIdForEnemy(familyId, enemyId);\n  }\n\n" +
  "  // form（state.battle.bossForm と同じ文字列）を渡すと、その形態専用の sheet を優先する。\n" +
  "  // 專用 sheet が未產出のときは既定の boss_<id> に戻す——代役（別の夜王の絵）を出すより、\n" +
  "  // 同じ夜王の別形態の絵を出すほうが明らかに近い。\n" +
  "  function sheetIdForBoss(bossId, form) {\n" +
  '    var id = "boss_" + bossId;\n' +
  "    if (form) {\n" +
  '      var formSheet = getSheet(id + "_" + form);\n' +
  '      if (formSheet && formSheet.available) return id + "_" + form;\n' +
  "    }\n" +
  "    return getSheet(id) ? id : null;\n  }\n\n" +
  "  window.PriTestEnemySpriteRegistry = {\n" +
  "    listSheets: listSheets,\n" +
  "    getSheet: getSheet,\n" +
  "    familySheetIdForEnemy: familySheetIdForEnemy,\n" +
  "    sheetIdForEnemy: sheetIdForEnemy,\n" +
  "    sheetIdForBoss: sheetIdForBoss\n" +
  "  };\n" +
  "})();\n";

if (!WRITE) {
  console.log(
    "プレビュー（sheet " +
      sheets.length +
      " 組／敵 " +
      assign.length +
      " 隻／割当の変更 " +
      (EXISTING ? changedAssign + " 筆" : "—（登録表なし・初回生成）") +
      "／available:true を維持 " +
      keptAvailable +
      " 組）。"
  );
  console.log("書き出すには --write を付けてください。");
  process.exit(0);
}

fs.writeFileSync(REGISTRY_PATH, out, "utf8");
console.log(
  "static_src/enemy_sprite_registry.js を書き出しました（sheet " +
    sheets.length +
    " 組／敵 " +
    assign.length +
    " 隻／available:true を維持 " +
    keptAvailable +
    " 組）。"
);
