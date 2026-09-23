// sprite sheet の登録表（static_src/enemy_sprite_registry.js）の回歸測試。
//
//   node tools/sprite_check/sprite_registry_check.js
//
// 驗證 5 點（spec §5.1／§5.2）：
//   ① sheet は 93 組（25 系統 × 2 ＋ 個別敵人專屬 31 ＋ 夜王 10 ＋ 絵を別に持つ多形態 2 隻の第二形態）
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
// 2026-09-23：62 → 76 → 93。個別敵人專屬 sheet（enemy_*）を 31 組追加したぶん
//（同日に 2 バッチ届いた：14 組＋17 組）。系統 sheet は「1 張が系統全体を代表する絵」
// なので、自分の絵を起こした敵はそちらを優先する。旧値 62 は專屬 sheet 導入前の組数。
ok(R.listSheets().length === 93, "sheet は93組 (実際 " + R.listSheets().length + ")");
// 形態別 sheet（2026-09-22）：gladius は合体形態と分裂形態で見た目が別物なので 2 枚持つ。
// 專用 sheet が未產出のあいだは既定の boss_gladius に戻ること——ここを間違えると、
// 分裂形態のときだけ別の夜王の代役が出る。
ok(!!R.getSheet("boss_gladius_split"), "gladius の分裂形態 sheet が登録されている");
ok(
  R.sheetIdForBoss("gladius", "fused") === "boss_gladius",
  "合体形態は boss_gladius (実際 " + R.sheetIdForBoss("gladius", "fused") + ")"
);
ok(
  R.sheetIdForBoss("gladius", "split") ===
    (R.getSheet("boss_gladius_split").available ? "boss_gladius_split" : "boss_gladius"),
  "分裂形態は專用 sheet、未產出なら boss_gladius に戻る (実際 " + R.sheetIdForBoss("gladius", "split") + ")"
);
ok(R.sheetIdForBoss("maris", "split") === "boss_maris", "形態別 sheet の無い夜王は form を渡しても既定のまま");
// 形態別 sheet の一覧は boss_auto_gm_data.js の formAware から生成される（手で並べない）。
// 戦闘ルール側で多形態として構造化されている夜王が増えれば、sheet も自動で増える。
// 形態別 sheet を持つのは「絵が別物になる」2 隻だけ（使用者明確規格）。
// stragedes／nameless は戦闘ルール上は多形態だが、絵は第一形態のまま使う。
["gladius", "harmonia"].forEach(function (id) {
  ok(!!R.getSheet("boss_" + id + "_split"), "絵を別に持つ夜王には第二形態 sheet がある: " + id);
});
["stragedes", "nameless"].forEach(function (id) {
  ok(!R.getSheet("boss_" + id + "_split"), "形態変化が後台のみの夜王には sheet を作らない: " + id);
  ok(
    R.sheetIdForBoss(id, "split") === "boss_" + id,
    id + " は split でも第一形態の sheet を返す (実際 " + R.sheetIdForBoss(id, "split") + ")"
  );
});
["maris", "fulghor", "edele", "gnoster", "caligo", "libra"].forEach(function (id) {
  ok(!R.getSheet("boss_" + id + "_split"), "単一形態の夜王には第二形態 sheet を作らない: " + id);
});
ok(FAMILIES.length === 25, "系統は25 (実際 " + FAMILIES.length + ")");

console.log("[149隻の帰属]");
let enemyCount = 0;
const orphan = [];
const used = {};   // 系統への割当（專屬 sheet を見ない）
const ownOf = {};  // 專屬 sheet を持つ敵
FAMILIES.forEach(function (f) {
  f.enemies.forEach(function (e) {
    enemyCount++;
    const sid = R.sheetIdForEnemy(f.id, e.id);
    if (!sid || !R.getSheet(sid)) orphan.push(f.id + "/" + e.id);
    // 空の変体の検査（③）が見るのは「機械的な a／b 分けの結果」なので、
    // 專屬 sheet に逃げたぶんを差し引いてはいけない。專屬 sheet はあくまで
    // 上書きの層で、系統への割当そのものは残っている。
    const fam = R.familySheetIdForEnemy(f.id, e.id);
    if (fam) used[fam] = (used[fam] || 0) + 1;
    if (sid && sid !== fam) ownOf[sid] = f.id + "/" + e.id;
  });
});
ok(enemyCount === 149, "敵は149隻 (実際 " + enemyCount + ")");
ok(orphan.length === 0, "全149隻が sheet に帰属" + (orphan.length ? " / 例: " + orphan[0] : ""));

// 個別敵人專屬 sheet（2026-09-23）。登錄表に enemy_* が 1 枚増えたのに、どの敵からも
// 引かれていない——という取り違え（鍵の綴り間違い、系統 id の変更）をここで止める。
// available:false のあいだは系統 sheet に戻るので、產出済みのぶんだけを見る。
console.log("[個別敵人專屬 sheet]");
const ownSheets = R.listSheets().filter(function (s) {
  return s.id.indexOf("enemy_") === 0;
});
ok(ownSheets.length === 31, "專屬 sheet は31組 (実際 " + ownSheets.length + ")");
const unlinked = ownSheets.filter(function (s) {
  return s.available && !ownOf[s.id];
});
ok(
  unlinked.length === 0,
  "產出済みの專屬 sheet はすべてその敵から引かれている" +
    (unlinked.length ? " / 未結線: " + unlinked.map(function (s) { return s.id; }).join("、") : "")
);
// 產出状況に応じた切り替え。sheet id は enemy_<familyId>_<enemyId> という規約なので、
// 敵の側から期待値を組み立てられる（登錄表の中身を信じずに済む）。
// available:true なら專屬 sheet、false なら系統 sheet——後者が戻らないと絵の無い
// sheet を指したまま 404 になる（夜王の形態別 sheet と同じ落とし穴）。
const wrongPick = [];
FAMILIES.forEach(function (f) {
  f.enemies.forEach(function (e) {
    const expectOwn = "enemy_" + f.id + "_" + e.id;
    const s = R.getSheet(expectOwn);
    if (!s) return;
    const want = s.available ? expectOwn : R.familySheetIdForEnemy(f.id, e.id);
    if (R.sheetIdForEnemy(f.id, e.id) !== want) wrongPick.push(f.id + "/" + e.id);
  });
});
ok(
  wrongPick.length === 0,
  "專屬 sheet は產出済みなら優先・未產出なら系統 sheet に戻る" +
    (wrongPick.length ? " / 例: " + wrongPick[0] : "")
);

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
