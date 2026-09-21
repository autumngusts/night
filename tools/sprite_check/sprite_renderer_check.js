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

console.log("[fallback 契約]");
ok(
  P.sheetFileFor("dragon", "great_earth_dragon", false) === null,
  "available:false なので null（静止画に落ちる）"
);
ok(P.sheetFileFor("no_such_family", "no_such_enemy", false) === null, "未登録も null");
ok(P.sheetFileFor(null, "maris", true) === null, "夜王も available:false なので null");

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

console.log(fail === 0 ? "\nすべてOK" : "\n" + fail + " 件 FAIL");
process.exit(fail === 0 ? 0 : 1);
