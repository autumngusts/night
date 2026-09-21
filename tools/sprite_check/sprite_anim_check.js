// 敵人 sprite 的動作時間軸（static_src/enemy_sprite_data.js）的回歸測試。
//
//   node tools/sprite_check/sprite_anim_check.js
//   （或 tools/sprite_check で npm run test:anim）
//
// 驗證 4 點：
//   ① spec §3 指定的 8 動作全部登錄，且 row 索引 0~7 不重複
//   ② 每個動作都是 6 幀（spec §5.3）
//   ③ 5 種攻擊動作都有 hitFrame，且推算出的前搖落在 0.4~0.7 秒（spec §3）
//   ④ 待機/受擊/死亡沒有 hitFrame（它們不是攻擊，不產生命中判定）
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const dataPath = path.resolve(__dirname, "..", "..", "static_src", "enemy_sprite_data.js");
const sandbox = { window: {}, console };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(dataPath, "utf8"), sandbox, { filename: "enemy_sprite_data.js" });

const S = sandbox.window.PriTestEnemySprite;
let fail = 0;
function ok(cond, label) {
  console.log((cond ? "  OK   " : "  FAIL ") + label);
  if (!cond) fail++;
}

console.log("[動作登錄]");
const EXPECTED = ["idle", "line", "area", "thrust", "slam", "single", "hurt", "death"];
const ids = S.listAnims().map(function (a) {
  return a.id;
});
EXPECTED.forEach(function (id) {
  ok(ids.indexOf(id) !== -1, "登錄あり: " + id);
});
ok(ids.length === EXPECTED.length, "動作は8種 (実際 " + ids.length + ")");
const rows = S.listAnims().map(function (a) {
  return a.row;
});
ok(
  rows.slice().sort().join(",") === "0,1,2,3,4,5,6,7",
  "row は 0~7 の重複なし (実際 " + rows.join(",") + ")"
);

console.log("[幀數]");
ok(S.SHEET_COLS === 6, "SHEET_COLS === 6");
ok(S.SHEET_ROWS === 8, "SHEET_ROWS === 8");
S.listAnims().forEach(function (a) {
  ok(a.frameCount === 6, a.id + " は6幀");
});

console.log("[前搖 0.4~0.7 秒]");
const ATTACKS = ["line", "area", "thrust", "slam", "single"];
ATTACKS.forEach(function (id) {
  const t = S.animHitTimeMs(id);
  ok(t !== null && t >= 400 && t <= 700, id + " の前搖 " + t + "ms が 400~700 の範囲内");
});

console.log("[非攻擊動作]");
["idle", "hurt", "death"].forEach(function (id) {
  ok(S.animHitTimeMs(id) === null, id + " に hitFrame なし");
});
ok(S.getAnim("idle").loop === true, "idle はループ");
ok(S.getAnim("death").hold === true, "death は最終幀で停止");

console.log(fail === 0 ? "\nすべてOK" : "\n" + fail + " 件 FAIL");
process.exit(fail === 0 ? 0 : 1);
