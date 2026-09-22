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
// 機制保留給未來真正的個別例外，但目前應為空
const OVERRIDES = {};

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
  return { available: available, sheetIdForEnemy: reg.sheetIdForEnemy };
}

const EXISTING = loadExisting();

function availableFor(sheetId) {
  if (!EXISTING) return false;
  return !!EXISTING.available[sheetId];
}

const assign = [];
let changedAssign = 0;
FAMILIES.forEach(function (f) {
  f.enemies.forEach(function (e, i) {
    const sheetId = "family_" + f.id + "_" + variantFor(f, e, i);
    assign.push('    "' + f.id + "/" + e.id + '": "' + sheetId + '"');
    if (EXISTING && EXISTING.sheetIdForEnemy(f.id, e.id) !== sheetId) changedAssign++;
  });
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
BOSSES.forEach(function (b) {
  pushSheet("boss_" + b);
  formSheetsFor(b).forEach(function (form) {
    pushSheet("boss_" + b + "_" + form);
  });
});

const out =
  "(function () {\n" +
  "  // sprite sheet 的登錄表。\n" +
  "  // 自動產生: node tools/sprite_check/sprite_registry_gen.js --write\n" +
  "  // 不要手動修改——要改分配就去改產生器的 OVERRIDES 再重新產生。\n" +
  "  //\n" +
  "  // available 是「圖片是否已產出」。false 期間 midnight_sprite.js 會 fallback 到既有的\n" +
  "  // 靜止畫（spec §4）。圖片放進來之後由 sprite_pack.js 改寫成 true；重新產生登錄表時\n" +
  "  // 產生器會逐 sheet 沿用這裡既有的值，不會把已驗收的成果歸零。\n" +
  "  var SHEETS = [\n" +
  sheets.join(",\n") +
  "\n  ];\n\n" +
  "  var ENEMY_SHEET = {\n" +
  assign.join(",\n") +
  "\n  };\n\n" +
  "  function listSheets() {\n    return SHEETS;\n  }\n\n" +
  "  function getSheet(sheetId) {\n" +
  "    return (\n      SHEETS.filter(function (s) {\n        return s.id === sheetId;\n      })[0] || null\n    );\n  }\n\n" +
  "  function sheetIdForEnemy(familyId, enemyId) {\n" +
  '    return ENEMY_SHEET[familyId + "/" + enemyId] || null;\n  }\n\n' +
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
