// 招式 → 動畫の対照表（static_src/enemy_action_anim_map.js）の回歸測試。
//
//   node tools/sprite_check/sprite_action_map_check.js
//
// 驗證 3 點：
//   ① enemies_data_1~4.js の全 549 筆が、必ず 5 種の攻撃動畫のどれかに解決できる
//      （対照表に無くても dmgKind の既定値に落ちるので null にはならない）
//   ② 対照表が返す animId が enemy_sprite_data.js に実在する
//   ③ 待機/受擊/死亡は攻撃動畫ではないので、対照表の値として現れない
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..", "..");
const sandbox = { window: {}, console };
vm.createContext(sandbox);
["enemy_sprite_data.js", "enemy_action_anim_map.js"].forEach(function (f) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, "static_src", f), "utf8"), sandbox, { filename: f });
});
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

const S = sandbox.window.PriTestEnemySprite;
const M = sandbox.window.PriTestEnemyActionAnimMap;
let fail = 0;
function ok(cond, label) {
  console.log((cond ? "  OK   " : "  FAIL ") + label);
  if (!cond) fail++;
}

const ATTACKS = ["line", "area", "thrust", "slam", "single"];

console.log("[全招式が解決できる]");
let total = 0;
const bad = [];
FAMILIES.forEach(function (f) {
  f.enemies.forEach(function (e) {
    (e.actions || []).forEach(function (a) {
      if (!a.name || !a.name.ja) return;
      total++;
      const anim = M.resolve(a.name.ja, null);
      if (ATTACKS.indexOf(anim) === -1) bad.push(a.name.ja + " -> " + anim);
    });
  });
});
ok(total === 549, "招式は549筆 (実際 " + total + ")");
ok(bad.length === 0, "全招式が5種の攻撃動畫に解決できる" + (bad.length ? " / 例: " + bad[0] : ""));

console.log("[animId が実在する]");
const values = Object.keys(M.byName).map(function (n) {
  return M.byName[n];
});
const unknown = values.filter(function (v) {
  return !S.getAnim(v);
});
ok(unknown.length === 0, "対照表の animId が全て実在" + (unknown.length ? " / 例: " + unknown[0] : ""));

console.log("[攻撃動畫のみ]");
const nonAttack = values.filter(function (v) {
  return ATTACKS.indexOf(v) === -1;
});
ok(nonAttack.length === 0, "待機/受擊/死亡が対照表に現れない" + (nonAttack.length ? " / 例: " + nonAttack[0] : ""));

console.log("[既定値への退避]");
ok(M.resolve("存在しない招式名", "group") === "area", "未登録 + 亂戰傷害 -> area");
ok(M.resolve("存在しない招式名", "individual") === "single", "未登録 + 個別傷害 -> single");
ok(M.resolve(null, null) === "single", "招式名なし -> single");

console.log(fail === 0 ? "\nすべてOK" : "\n" + fail + " 件 FAIL");
process.exit(fail === 0 ? 0 : 1);
