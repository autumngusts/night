// renderer の純函式部分（static_src/midnight_sprite.js）の回歸測試。
//
//   node tools/sprite_check/sprite_renderer_check.js
//
// DOM を触る部分は Playwright が要るのでここでは扱わない。幀の選択と
// background-position の計算という、間違えると全動畫がずれる核心だけを検証する。
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..", "..");
const sandbox = { window: {}, console };
vm.createContext(sandbox);
["enemy_sprite_data.js", "enemy_sprite_registry.js", "midnight_sprite.js"].forEach(function (f) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, "static_src", f), "utf8"), sandbox, { filename: f });
});
const P = sandbox.window.PriTestMidnightSprite;
let fail = 0;
function ok(cond, label) {
  console.log((cond ? "  OK   " : "  FAIL ") + label);
  if (!cond) fail++;
}

console.log("[幀の選択]");
ok(P.frameIndexAt("thrust", 0) === 0, "thrust 0ms は第0幀");
ok(P.frameIndexAt("thrust", 139) === 0, "thrust 139ms はまだ第0幀 (frameMs=140)");
ok(P.frameIndexAt("thrust", 140) === 1, "thrust 140ms で第1幀");
ok(P.frameIndexAt("thrust", 420) === 3, "thrust 420ms は第3幀＝hitFrame");
ok(P.frameIndexAt("thrust", 840) === null, "thrust 840ms は動畫終了後なので null");

console.log("[ループと停止]");
ok(P.frameIndexAt("idle", 1200) === 0, "idle は 1200ms で一巡して第0幀 (200x6)");
ok(P.frameIndexAt("idle", 1400) === 1, "idle 1400ms は第1幀");
ok(P.frameIndexAt("death", 9999) === 5, "death は最終幀で停止");

console.log("[background-position]");
ok(P.backgroundPosition("idle", 0, 128) === "0px 0px", "idle 第0幀は 0px 0px");
ok(P.backgroundPosition("idle", 2, 128) === "-256px 0px", "idle 第2幀は -256px 0px");
ok(P.backgroundPosition("thrust", 1, 128) === "-128px -384px", "thrust(row3) 第1幀は -128px -384px");

// 階段1 では「まだ 1 枚も無い」前提で dragon/maris を null 判定の材料に使っていたが、
// その 2 つは実素材が入ったので材料として使えない。まだ産出していない sheet を選び直す。
// fallback 契約そのもの（available:false → null → 静止画のまま）は変わっていない。
console.log("[fallback 契約]");
ok(
  P.sheetFileFor("dragon", "hill_wyvern", false) === null,
  "未産出の family は null（静止画に落ちる）"
);
ok(P.sheetFileFor("no_such_family", "no_such_enemy", false) === null, "未登録も null");
// 「まだ產出されていない夜王」は固定で書かない——素材が入るたびにこの行が落ちる
// （実際 caligo を書いていて、caligo の sheet が入った日に落ちた）。登錄表から
// available:false の夜王を 1 隻拾う。形態別 sheet（boss_x_split）は除く。
var pendingBoss = sandbox.window.PriTestEnemySpriteRegistry.listSheets().filter(function (s) {
  return /^boss_[a-z]+$/.test(s.id) && !s.available;
})[0];
if (pendingBoss) {
  ok(
    P.sheetFileFor(null, pendingBoss.id.replace("boss_", ""), true) === null,
    "未産出の夜王も null（" + pendingBoss.id + "）"
  );
} else {
  console.log("  --   夜王は全て產出済み（未産出時の fallback は確かめられない）");
}
ok(
  typeof P.sheetFileFor(null, "gladius", true) === "string",
  "産出済みの夜王は檔名を返す（fallback しない）"
);

// 2026-09-21 使用者明確規格「背景仍舊顯示元圖片，產生的點陣圖敵人顯示在圖片的頂層」。
// 疊放是 CSS 與呼叫端的分工，DOM 驗證需要 Playwright，所以這裡用靜態檢查擔保。
console.log("[插圖の上に重ねる契約]");
const css = fs.readFileSync(path.join(ROOT, "static_src", "style.css"), "utf8");
const stageRule = (css.split("#midnight-enemy-sprite-stage {")[1] || "").split("}")[0];
ok(stageRule.indexOf("position: absolute") !== -1, "舞台は position:absolute（插圖の上に重なる）");
ok(stageRule.indexOf("pointer-events: none") !== -1, "舞台は pointer-events:none（下のクリックを塞がない）");
ok(
  stageRule.indexOf("aspect-ratio: 1 / 1") !== -1,
  "舞台は正方形（syncCellPx が offsetWidth を縦横兼用するため）"
);
ok(stageRule.indexOf("z-index") === -1, "z-index は付けない（DOM 順で 插圖 < 舞台 < 命中特效 になる）");

// 呼び出し側：sprite が出ても <img> を隠さない形になっているか。
// 夜王分支の nameless（名冊に立繪なし）用の imgEl.hidden = true は残すべき別物なので、
// 「隠す行が無いこと」ではなく「新しい呼び出し形になっていること」を正として検査する。
const mnSrc = fs.readFileSync(path.join(ROOT, "static_src", "midnight.js"), "utf8");
ok(
  mnSrc.indexOf('el("midnight-field-encounter-image").hidden = true;') === -1,
  "一般敵分支で <img> を隠す行が消えている（插圖は背景として残す）"
);
ok(
  (mnSrc.match(/if \(!\(\w+ && window\.PriTestMidnightSprite\.showSprite\(/g) || []).length === 2,
  "両分支とも showSprite() の失敗時だけ showStatic() に落ちる形（成功時に <img> を触らない）"
);

// 未產出の敵に產出済みの sheet を代役として充てる（使用者明確規格
// 「剩餘還沒配對的會先隨機抽取一張點陣圖」）。ここで一番大事なのは「同じ敵なら常に
// 同じ代役」であること——sheetFileFor は毎影格呼ばれるので、乱数だと 1 影格ごとに
// 別の生き物に化ける。ハッシュ由来であることを繰り返し呼んで確かめる。
console.log("[未產出への代役]");
const sub1 = P.sheetFileOrSubstitute("dragon", "hill_wyvern", false);
ok(typeof sub1 === "string", "未產出の family にも代役が返る");
ok(
  P.sheetFileOrSubstitute("dragon", "hill_wyvern", false) === sub1 &&
    P.sheetFileOrSubstitute("dragon", "hill_wyvern", false) === sub1,
  "何度呼んでも同じ代役（乱数ではない＝影格ごとに化けない）"
);
ok(
  P.sheetFileOrSubstitute(null, "caligo", true) === P.sheetFileOrSubstitute(null, "caligo", true),
  "未產出の夜王でも代役が安定する"
);
ok(
  P.sheetFileOrSubstitute(null, "gladius", true) === P.sheetFileFor(null, "gladius", true),
  "產出済みなら代役ではなく自分の sheet を返す"
);
ok(
  P.sheetFileOrSubstitute("no_such_family", "no_such_enemy", false) === null,
  "登録すら無い相手には代役も返さない（sheetId が引けないため）"
);
// 代役は必ず「實在する產出済み sheet」でなければならない。存在しない檔名を返すと 404。
const availFiles = {};
sandbox.window.PriTestEnemySpriteRegistry.listSheets().forEach(function (s) {
  if (s.available) availFiles[s.file] = true;
});
ok(!!availFiles[sub1], "代役は available:true の sheet から選ばれている");

// 2026-09-22 使用者明確規格「確認每個敵人都有連接 特別是區分敵人種類 若沒有連結的直接抽選
// 其他敵人 boss另外抽選其他夜王點陣圖」：全 149 隻＋夜王 10 隻が必ず何かの sheet に解決し、
// 一般敵の代役は family_* だけ、夜王の代役は boss_* だけから選ばれる。同系統の別変体が
// 產出済みならそれを優先する。
console.log("[全敵の連結と種類の分離]");
["1", "2", "3", "4"].forEach(function (n) {
  vm.runInContext(
    fs.readFileSync(path.join(ROOT, "static_src", "enemies_data_" + n + ".js"), "utf8"),
    sandbox,
    { filename: "enemies_data_" + n + ".js" }
  );
});
const FAMILIES = [].concat(
  sandbox.window.PriTestEnemiesData1,
  sandbox.window.PriTestEnemiesData2,
  sandbox.window.PriTestEnemiesData3,
  sandbox.window.PriTestEnemiesData4
);
const R = sandbox.window.PriTestEnemySpriteRegistry;
let enemyTotal = 0;
let unresolved = [];
let mixed = [];
let substituted = 0;
FAMILIES.forEach(function (f) {
  f.enemies.forEach(function (e) {
    enemyTotal++;
    const file = P.sheetFileOrSubstitute(f.id, e.id, false);
    if (!file) unresolved.push(f.id + "/" + e.id);
    else if (!/^family_/.test(file)) mixed.push(f.id + "/" + e.id + "→" + file);
    if (file && !P.sheetFileFor(f.id, e.id, false)) substituted++;
  });
});
ok(enemyTotal === 149 && unresolved.length === 0, "一般敵 149 隻すべてが sheet に解決" + (unresolved.length ? " / 未解決: " + unresolved.slice(0, 3).join("、") : ""));
ok(mixed.length === 0, "一般敵の代役は family_* のみ（夜王 sheet を混ぜない）" + (mixed.length ? " / " + mixed[0] : ""));
console.log("  --   一般敵：自分の sheet " + (enemyTotal - substituted) + " 隻／代役 " + substituted + " 隻");
const BOSSES = ["maris", "fulghor", "harmonia", "gladius", "gnoster", "caligo", "libra", "edele", "stragedes", "nameless"];
const bossUnresolved = [];
const bossMixed = [];
let bossSubstituted = 0;
BOSSES.forEach(function (id) {
  const file = P.sheetFileOrSubstitute(null, id, true);
  if (!file) bossUnresolved.push(id);
  else if (!/^boss_/.test(file)) bossMixed.push(id + "→" + file);
  if (file && !P.sheetFileFor(null, id, true)) bossSubstituted++;
});
ok(bossUnresolved.length === 0, "夜王 10 隻すべてが sheet に解決" + (bossUnresolved.length ? " / " + bossUnresolved.join("、") : ""));
ok(bossMixed.length === 0, "夜王の代役は boss_* のみ（一般敵 sheet を混ぜない）" + (bossMixed.length ? " / " + bossMixed[0] : ""));
console.log("  --   夜王：自分の sheet " + (BOSSES.length - bossSubstituted) + " 隻／代役 " + bossSubstituted + " 隻");
// 同系統の別変体優先：a/b の片方だけ產出済みの系統を実データから探して検査する（硬編しない）。
let siblingCase = null;
FAMILIES.forEach(function (f) {
  if (siblingCase) return;
  const a = R.getSheet("family_" + f.id + "_a");
  const b = R.getSheet("family_" + f.id + "_b");
  if (!a || !b || a.available === b.available) return;
  const missingVariant = a.available ? "b" : "a";
  const presentFile = (a.available ? a : b).file;
  f.enemies.forEach(function (e) {
    if (siblingCase) return;
    if (R.sheetIdForEnemy(f.id, e.id) === "family_" + f.id + "_" + missingVariant) siblingCase = { familyId: f.id, enemyId: e.id, expect: presentFile };
  });
});
if (siblingCase) {
  ok(
    P.sheetFileOrSubstitute(siblingCase.familyId, siblingCase.enemyId, false) === siblingCase.expect,
    "同系統の別変体が產出済みならそれを代役にする（" + siblingCase.familyId + "/" + siblingCase.enemyId + " → " + siblingCase.expect + "）"
  );
} else {
  console.log("  --   （a/b 片方だけ產出済みの系統が無いため、変体優先の検査は SKIP）");
}

console.log(fail === 0 ? "\nすべてOK" : "\n" + fail + " 件 FAIL");
process.exit(fail === 0 ? 0 : 1);
