// 招式名 → 動畫 id の対照表を生成する。
//
//   node tools/sprite_check/sprite_action_map_gen.js          # 未命中の長尾を一覧するだけ
//   node tools/sprite_check/sprite_action_map_gen.js --write  # static_src/enemy_action_anim_map.js を書き出す
//
// enemies_data_1~4.js の 549 筆・相異 430 個の招式名に対し、まずキーワード表で自動対応し、
// 命中しなかったものを一覧に出す（人手で補標して KEYWORDS か OVERRIDES に足す運用）。
// 対応は「相異名」単位なので、補標は一度きりで永続的に効く（spec §7）。
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

// キーワード表（spec §7.2）。上から順に判定し、最初に当たったものを採用する。
const KEYWORDS = [
  { anim: "thrust", re: /突き|突進|刺し|貫/ },
  { anim: "area", re: /薙ぎ|払い|振り回|回転|旋回|群が|衝撃波|ブレス|咆哮|吠え/ },
  { anim: "slam", re: /叩きつけ|振り下ろ|落とし|踏みつけ|跳躍|のしかかり|プレス/ },
  { anim: "line", re: /射撃|撃ち|放つ|つぶて|矢|弾|投擲|投げ|飛ば/ },
  { anim: "single", re: /噛みつき|喰らい|爪|ひっかき|殴り|蹴り|斬り|切り|掴み|飛びかかり/ }
];

// 人手で補標した長尾（キーワードでは推定できないもの）。ここに足していく。
const OVERRIDES = {};

function classify(name) {
  if (OVERRIDES[name]) return OVERRIDES[name];
  for (let i = 0; i < KEYWORDS.length; i++) {
    if (KEYWORDS[i].re.test(name)) return KEYWORDS[i].anim;
  }
  return null;
}

const names = {};
FAMILIES.forEach(function (f) {
  f.enemies.forEach(function (e) {
    (e.actions || []).forEach(function (a) {
      if (!a.name || !a.name.ja) return;
      names[a.name.ja] = (names[a.name.ja] || 0) + 1;
    });
  });
});

const all = Object.keys(names).sort();
const mapped = {};
const unmapped = [];
all.forEach(function (n) {
  const anim = classify(n);
  if (anim) mapped[n] = anim;
  else unmapped.push(n);
});

const rows = all.reduce(function (sum, n) {
  return sum + names[n];
}, 0);
const mappedRows = Object.keys(mapped).reduce(function (sum, n) {
  return sum + names[n];
}, 0);

console.log("相異招式名: " + all.length + " / 総筆数: " + rows);
console.log("対応済み: " + Object.keys(mapped).length + " 名 (" + mappedRows + " 筆)");
console.log("未対応: " + unmapped.length + " 名 (" + (rows - mappedRows) + " 筆)");

if (process.argv.indexOf("--write") === -1) {
  console.log("\n[未対応の長尾（出現数の多い順）]");
  unmapped
    .slice()
    .sort(function (a, b) {
      return names[b] - names[a];
    })
    .forEach(function (n) {
      console.log("  " + String(names[n]).padStart(3) + "  " + n);
    });
  console.log("\n--write を付けると static_src/enemy_action_anim_map.js を書き出します。");
  process.exit(0);
}

const lines = all
  .filter(function (n) {
    return mapped[n];
  })
  .map(function (n) {
    return '    "' + n + '": "' + mapped[n] + '"';
  });

const out =
  "(function () {\n" +
  "  // 招式名 → 動畫 id 的對照表。\n" +
  "  // 自動產生: node tools/sprite_check/sprite_action_map_gen.js --write\n" +
  "  // 不要手動修改——要改就去改產生器的 KEYWORDS / OVERRIDES 再重新產生。\n" +
  "  // 這裡沒有的招式，resolve() 會依 dmgKind 退到既定值，所以不會開天窗（spec §7.2）。\n" +
  "  var BY_NAME = {\n" +
  lines.join(",\n") +
  "\n  };\n\n" +
  "  function resolve(actionName, dmgKind) {\n" +
  "    if (actionName && BY_NAME[actionName]) return BY_NAME[actionName];\n" +
  '    if (dmgKind === "group") return "area";\n' +
  '    return "single";\n' +
  "  }\n\n" +
  "  window.PriTestEnemyActionAnimMap = { byName: BY_NAME, resolve: resolve };\n" +
  "})();\n";

fs.writeFileSync(path.join(ROOT, "static_src", "enemy_action_anim_map.js"), out, "utf8");
console.log("\nstatic_src/enemy_action_anim_map.js を書き出しました。");
