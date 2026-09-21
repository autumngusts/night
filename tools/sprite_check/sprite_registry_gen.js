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
const OVERRIDES = {
  "rock_spirit_beast/ancestral_spirit": "b",
  "death_bird_raven/demon_prince": "b",
  "grafted/royal_wraith": "b",
  "dog_wolf/stray_dogs": "a",
  "cavalry/dragon_tree_guard": "b",
  "golem_maiden_puppet/molten_iron_demon": "b"
};

const BOSSES = [
  "maris", "fulghor", "harmonia", "gladius", "gnoster",
  "caligo", "libra", "edele", "stragedes", "nameless"
];
const BIG = { LL: true, L: true };

function variantFor(fam, enemy, index) {
  const key = fam.id + "/" + enemy.id;
  if (OVERRIDES[key]) return OVERRIDES[key];
  const sizes = {};
  fam.enemies.forEach(function (e) {
    sizes[e.size] = true;
  });
  if (Object.keys(sizes).length > 1) return BIG[enemy.size] ? "a" : "b";
  return index < Math.ceil(fam.enemies.length / 2) ? "a" : "b";
}

const assign = [];
FAMILIES.forEach(function (f) {
  f.enemies.forEach(function (e, i) {
    assign.push(
      '    "' + f.id + "/" + e.id + '": "family_' + f.id + "_" + variantFor(f, e, i) + '"'
    );
  });
});

const sheets = [];
FAMILIES.forEach(function (f) {
  ["a", "b"].forEach(function (v) {
    sheets.push(
      '    { id: "family_' + f.id + "_" + v + '", file: "family_' + f.id + "_" + v + '.png", available: false }'
    );
  });
});
BOSSES.forEach(function (b) {
  sheets.push('    { id: "boss_' + b + '", file: "boss_' + b + '.png", available: false }');
});

const out =
  "(function () {\n" +
  "  // sprite sheet の登録表。\n" +
  "  // 自動生成: node tools/sprite_check/sprite_registry_gen.js --write\n" +
  "  // 手で直さないこと——割当を変えるときは生成器の OVERRIDES を直して再生成する。\n" +
  "  //\n" +
  "  // available は「画像が産出済みか」。false の間、midnight_sprite.js は既存の静止画に\n" +
  "  // fallback する（spec §4）。画像を入れたら sprite_pack.js が true に書き換える。\n" +
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
  "  function sheetIdForBoss(bossId) {\n" +
  '    var id = "boss_" + bossId;\n' +
  "    return getSheet(id) ? id : null;\n  }\n\n" +
  "  window.PriTestEnemySpriteRegistry = {\n" +
  "    listSheets: listSheets,\n" +
  "    getSheet: getSheet,\n" +
  "    sheetIdForEnemy: sheetIdForEnemy,\n" +
  "    sheetIdForBoss: sheetIdForBoss\n" +
  "  };\n" +
  "})();\n";

fs.writeFileSync(path.join(ROOT, "static_src", "enemy_sprite_registry.js"), out, "utf8");
console.log(
  "static_src/enemy_sprite_registry.js を書き出しました（sheet " +
    sheets.length +
    " 組／敵 " +
    assign.length +
    " 隻）。"
);
