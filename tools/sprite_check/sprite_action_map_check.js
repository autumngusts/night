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
// dmgKind 就是 midnight.js 的 resolveEnemyActionOutcome() 實際回傳的值＝
// "single"（個別傷害）／"group"（亂戰傷害）／null 三種，沒有 "individual" 這個值。
ok(M.resolve("存在しない招式名", "single") === "single", "未登録 + 個別傷害 -> single");
ok(M.resolve(null, null) === "single", "招式名なし -> single");

// 実行時に渡ってくるのは文字列ではなく action.name の多語物件（enemyAttack.actionName）。
// ここを取り違えると BY_NAME["[object Object]"] を引いて必ず dmgKind の既定値に落ち、
// 426 件の対照表と 203 件の補標がまるごと死ぬ——見た目は動くので気づきにくい。
console.log("[多語物件をそのまま引ける]");
ok(M.resolve({ ja: "叩きつけ", zh: "砸擊" }, "single") === "slam", "{ja,zh} -> ja で slam を引く");
ok(M.resolve({ ja: "落雷" }, "single") === "slam", "補標した 203 件も物件で引ける（落雷 -> slam）");
ok(M.resolve({ zh: "只有中文" }, "group") === "area", "ja が無い物件は既定値へ");
ok(M.resolve({}, "single") === "single", "空物件は既定値へ");

// 対照表を実際に引いている呼び出し端があるか。ここが無い間は showSprite() の idle が
// ループするだけで、補標も対照表も実行時には何も起きていなかった（2026-09-21 に結線）。
console.log("[midnight.js から実際に引かれている]");
const mnSrc = fs.readFileSync(path.join(ROOT, "static_src", "midnight.js"), "utf8");
ok(
  mnSrc.indexOf("AnimMap.resolve(atk.actionName, atk.dmgKind)") !== -1,
  "attack 動畫が招式名から引かれている"
);
ok(
  mnSrc.indexOf("maybePlayEnemyAttackAnim(trig);") !== -1,
  "毎フレームの観測側から呼ばれている（発動した端だけでなく全端で鳴る）"
);
ok(
  mnSrc.indexOf("enemyAttackWarnAtLocal(atk))") !== -1,
  "startAt に時鐘偏移を換算した起点を渡している（§8.2）"
);
ok(
  mnSrc.indexOf('playEnemySpriteAnim("death", true)') !== -1 &&
    mnSrc.indexOf('playEnemySpriteAnim("hurt", false)') !== -1,
  "受擊/死亡も結線されている（死亡だけ force で割り込む）"
);

console.log(fail === 0 ? "\nすべてOK" : "\n" + fail + " 件 FAIL");
process.exit(fail === 0 ? 0 : 1);
