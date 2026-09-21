// 各 sheet の生成 prompt を出力する（画像生成そのものは専案外の外部サービスで行う）。
//
//   node tools/sprite_check/sprite_prompt.js                 # 全60組
//   node tools/sprite_check/sprite_prompt.js family_dragon_a # 指定の1組だけ
//
// prompt の骨格を1箇所に集約することで、60組の画風が散らからないようにする（spec §11）。
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

const STYLE =
  "dark fantasy pixel art sprite sheet, 6 columns x 8 rows, transparent background, " +
  "character facing LEFT, consistent lighting from upper-left, muted desaturated palette, " +
  "no text, no frame borders, no drop shadow outside the character";
const ROWS =
  "row order: 1 idle loop, 2 ranged straight attack, 3 wide area sweep, " +
  "4 forward thrust, 5 heavy overhead slam, 6 quick single strike, 7 hurt recoil, 8 death collapse";

function membersOf(sheetId) {
  const out = [];
  FAMILIES.forEach(function (f) {
    f.enemies.forEach(function (e) {
      if (R.sheetIdForEnemy(f.id, e.id) === sheetId) out.push(e);
    });
  });
  return out;
}

const only = process.argv[2];
R.listSheets().forEach(function (s) {
  if (only && s.id !== only) return;
  console.log("=== " + s.id + " -> " + s.file + " ===");
  if (s.id.indexOf("boss_") === 0) {
    console.log(STYLE + ", " + ROWS);
    console.log(
      'subject: Elden Ring Nightreign night lord "' +
        s.id.replace("boss_", "") +
        '", boss scale, imposing silhouette'
    );
    console.log("");
    return;
  }
  const members = membersOf(s.id);
  const fam = FAMILIES.filter(function (f) {
    return s.id.indexOf("family_" + f.id + "_") === 0;
  })[0];
  const sizes = {};
  members.forEach(function (e) {
    sizes[e.size] = true;
  });
  console.log(STYLE + ", " + ROWS);
  console.log(
    "subject: " +
      (fam ? fam.name.ja + " / " + fam.name.zh : s.id) +
      ", size class " +
      Object.keys(sizes).join("+") +
      ", representative members: " +
      members
        .slice(0, 4)
        .map(function (e) {
          return e.name.ja;
        })
        .join("、") +
      " (" +
      members.length +
      " enemies share this sheet)"
  );
  console.log("");
});
