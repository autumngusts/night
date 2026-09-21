// sprite sheet の登録表（static_src/enemy_sprite_registry.js）の回歸測試。
//
//   node tools/sprite_check/sprite_registry_check.js
//
// 驗證 5 點（spec §5.1／§5.2）：
//   ① sheet は 60 組（25 系統 × 2 ＋ 夜王 10）
//   ② enemies_data の 149 隻すべてが、いずれかの sheet に帰属している
//   ③ 各系統がちょうど 2 組を持ち、両方に最低 1 隻が割り当たっている（空の変体を作らない）
//   ④ 夜王 10 隻が登録されている
//   ⑤ 本階段では全 sheet が available:false（画像がまだ無い）
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
vm.runInContext(
  fs.readFileSync(path.join(ROOT, "static_src", "enemy_sprite_registry.js"), "utf8"),
  sandbox,
  { filename: "enemy_sprite_registry.js" }
);
const FAMILIES = [].concat(
  sandbox.window.PriTestEnemiesData1,
  sandbox.window.PriTestEnemiesData2,
  sandbox.window.PriTestEnemiesData3,
  sandbox.window.PriTestEnemiesData4
);

const R = sandbox.window.PriTestEnemySpriteRegistry;
let fail = 0;
function ok(cond, label) {
  console.log((cond ? "  OK   " : "  FAIL ") + label);
  if (!cond) fail++;
}

console.log("[組数]");
ok(R.listSheets().length === 60, "sheet は60組 (実際 " + R.listSheets().length + ")");
ok(FAMILIES.length === 25, "系統は25 (実際 " + FAMILIES.length + ")");

console.log("[149隻の帰属]");
let enemyCount = 0;
const orphan = [];
const used = {};
FAMILIES.forEach(function (f) {
  f.enemies.forEach(function (e) {
    enemyCount++;
    const sid = R.sheetIdForEnemy(f.id, e.id);
    if (!sid || !R.getSheet(sid)) orphan.push(f.id + "/" + e.id);
    else used[sid] = (used[sid] || 0) + 1;
  });
});
ok(enemyCount === 149, "敵は149隻 (実際 " + enemyCount + ")");
ok(orphan.length === 0, "全149隻が sheet に帰属" + (orphan.length ? " / 例: " + orphan[0] : ""));

console.log("[空の変体がない]");
const empty = [];
FAMILIES.forEach(function (f) {
  ["a", "b"].forEach(function (v) {
    const sid = "family_" + f.id + "_" + v;
    if (!R.getSheet(sid)) empty.push(sid + "(未登録)");
    else if (!used[sid]) empty.push(sid + "(割当0隻)");
  });
});
ok(empty.length === 0, "各系統2組ともに最低1隻" + (empty.length ? " / 例: " + empty[0] : ""));

console.log("[夜王10隻]");
const BOSSES = [
  "maris", "fulghor", "harmonia", "gladius", "gnoster",
  "caligo", "libra", "edele", "stragedes", "nameless"
];
BOSSES.forEach(function (id) {
  ok(!!R.sheetIdForBoss(id), "夜王登録あり: " + id);
});

// 階段1 の時点では「全 sheet が available:false」を固定で検査していたが、実素材が
// 入り始めた以上その断言は成立しない。代わりに、available と実ファイルが食い違って
// いないことを見る——これは素材が増えても成立し続ける不変条件。
// available:true なのに PNG が無ければ戰鬥画面で画像が出ない（404）。
// PNG があるのに available:false なら、せっかく作った素材が使われない。
console.log("[available と実ファイルの整合]");
const fsMod = require("fs");
const pathMod = require("path");
const SPRITE_DIR = pathMod.join(ROOT, "static_src", "images", "sprites");
const missing = [];
const unregistered = [];
R.listSheets().forEach(function (s) {
  const exists = fsMod.existsSync(pathMod.join(SPRITE_DIR, s.file));
  if (s.available && !exists) missing.push(s.id);
  if (!s.available && exists) unregistered.push(s.id);
});
ok(missing.length === 0, "available:true の sheet は PNG が実在する" + (missing.length ? " / 欠落: " + missing.join("、") : ""));
ok(
  unregistered.length === 0,
  "PNG がある sheet は available:true になっている" + (unregistered.length ? " / 未反映: " + unregistered.join("、") : "")
);
const avail = R.listSheets().filter(function (s) {
  return s.available;
});
console.log("  --   産出済み " + avail.length + " / " + R.listSheets().length + " 組");

console.log(fail === 0 ? "\nすべてOK" : "\n" + fail + " 件 FAIL");
process.exit(fail === 0 ? 0 : 1);
