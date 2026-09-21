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

// 畫風骨架（2026-09-21 使用者提供參考圖後細化）。
// 使用者給的參考圖是一隻持大鐮刀的羊頭惡魔：手繪感的抗鋸齒點陣圖、暗褐色描邊會在受光面
// 變細或斷開、左上單一暖色光源、黃土＋褐＋奶白＋灰紫的低彩度配色、頭角與武器誇張放大的
// 細長剪影、全透明背景無接地影。以下把這些特徵寫死在同一個常數裡，60 組才不會各長各的
// （spec §11 的「prompt 骨架集約在一處」）。
//
// 重點是把「不要什麼」也寫出來——多數生成服務一聽到 pixel art 就會給出 NES 那種硬邊、
// 高彩度、純黑描邊的東西，那跟參考圖差很遠。
//
// 有參考圖的話，除了這段文字，直接把參考圖當 style reference／image prompt 一起餵給
// 生成服務，同一性會穩定很多（見 tools/sprite_spec.md 的驗收流程）。
const STYLE =
  "dark fantasy pixel art sprite sheet, 6 columns x 8 rows, transparent background, " +
  "hand-shaded anti-aliased pixel art in the lineage of late-90s / 2000s 2D action RPG " +
  "sprite work — soft dithered gradients and sub-pixel shading, NOT hard-edged 1-bit, " +
  "NOT flat NES-style, NOT modern flat-vector pixel art, " +
  "selective dark umber outline that thins or drops out along lit edges, never pure black, " +
  "single warm light source from the upper-left, cool-tinted shadows, " +
  "limited low-saturation earthy palette: ochre, tan and umber body tones, " +
  "cream-white fur or hair accents, muted violet-grey metal, " +
  "character facing LEFT in three-quarter view, " +
  "exaggerated readable silhouette: oversized head, horns and weapon against slender limbs, " +
  "character occupies roughly 80% of the cell height and is centred in its cell, " +
  "no text, no frame borders, no ground shadow, no background elements, no colour variation " +
  "between cells of the same sheet";
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
