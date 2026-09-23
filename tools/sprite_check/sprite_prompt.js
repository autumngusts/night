// 各 sheet の生成 prompt を出力する（画像生成そのものは専案外の外部サービスで行う）。
//
//   node tools/sprite_check/sprite_prompt.js                      # 全60組（1組で完結する長い prompt）
//   node tools/sprite_check/sprite_prompt.js family_dragon_a      # 指定の1組だけ
//   node tools/sprite_check/sprite_prompt.js --format=preamble    # 画風契約（会話の最初に1回だけ貼る）
//   node tools/sprite_check/sprite_prompt.js --format=short       # 1組1行（preamble を貼ったあと流す）
//   node tools/sprite_check/sprite_prompt.js --format=json        # 自前スクリプト/API から回す用
//
//   node tools/sprite_check/sprite_prompt.js --format=anim-preamble  # 名鑑が返ってきた会話の軌道修正（1回）
//   node tools/sprite_check/sprite_prompt.js --format=anim           # 1体1行の動畫表リクエスト
//   node tools/sprite_check/sprite_prompt.js --format=frame-rule     # 「各行の1格目は前搖・招式圖なし」の追加指示（1回）
//
// prompt の骨格を1箇所に集約することで、60組の画風が散らからないようにする（spec §11）。
//
// ChatGPT のような会話型サービスに流すなら preamble + short の2段構えを推奨する。
// 画風契約を会話の先頭で1回だけ確定させたほうが、60組ぶん毎回貼り直すより一貫性が出るし、
// 貼る量も桁違いに少ない。single-shot の API なら従来の長い prompt（既定）をそのまま使う。
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
// 2026-09-23 使用者明確規格で行 5（重砸）と行 6（單擊）の中身が確定した：
//   重砸＝「跳起後重砸地面」＝跳び上がってから地面へ叩きつける（空中の影格が要る）
//   單擊＝「遠程 shoot」＝遠距離への射撃（行 2 の直線と違い、1 体を狙う単発の弾）
// 行 2（直線）と行 6（單擊）がどちらも遠距離になるので、prompt 側で「線に沿って伸びる
// ブレス／ビーム」と「1 体を狙う単発の飛び道具」を書き分けておく。ここを曖昧にすると
// 生成側が 2 行とも同じ絵にしてしまい、動畫の区別が付かなくなる。
const ROWS =
  "row order: 1 idle loop, " +
  "2 straight-line ranged attack — a beam, breath or wave that extends in a straight line away from the body, " +
  "3 wide area sweep, " +
  "4 forward thrust, " +
  "5 leap upward and smash straight down into the ground — airborne in the middle cells, landing impact with cracked ground and dust burst in the last cells, " +
  "6 single ranged shot at one distant target — the creature aims and fires ONE projectile (arrow, bolt, spit, thrown stone or focused magic dart), it does not step into melee, " +
  "7 hurt recoil, 8 death collapse";

// 各行の 1 格目＝前搖（2026-09-21 使用者明確規格「各行的第一個要為前搖動作而不出現招式圖」）。
//
// 判定側の理由がある：enemy_sprite_data.js の hitFrame は 3~4 なので、0 格目は必ず前搖の
// さなかにあたる。そこに斬撃光や飛び道具が既に描かれていると、プレイヤーには「もう当たった」
// ように見えてしまい、spec §8.1 の「前搖 0.4~0.7 秒のあいだに読んで迴避を押す」という設計
// そのものが成立しない。招式圖は 2 格目から出して 4~5 格目で最大になる、という時間配分を
// prompt 側に書き下しておく。
//
// 攻擊でない 3 行（待機／受擊／死亡）にも同じ「1 格目は動き出す前」を適用する。行ごとに
// 例外を作ると、生成側が「どの行が例外か」を取り違えて結局 1 格目に効果を描いてくる。
const FRAME_RULE =
  "first-frame rule for every row: the first (leftmost) cell is the WIND-UP only — " +
  "the pose just before the action, with NO attack effect drawn in it: no slash arc, " +
  "no weapon trail, no projectile, no beam, no muzzle flash, no magic circle or glow, " +
  "no shockwave, no dust burst, no impact flash. The attack effect first appears in the " +
  "SECOND cell and peaks around the fourth or fifth cell. On the idle row the first cell " +
  "is the neutral resting pose; on the hurt and death rows it is the instant before the " +
  "body reacts, still upright and undamaged. The player reads this first cell to decide " +
  "whether to dodge, so its silhouette must telegraph which attack is coming while " +
  "carrying no effect art at all";

function membersOf(sheetId) {
  const out = [];
  FAMILIES.forEach(function (f) {
    f.enemies.forEach(function (e) {
      if (R.sheetIdForEnemy(f.id, e.id) === sheetId) out.push(e);
    });
  });
  return out;
}

// 1 組ぶんの素材を組み立てる。出力形式はあとで選ぶだけにして、内容はここ 1 箇所に集約する。
// 形態別 sheet（boss_<id>_<form>）の subject。id をそのまま流すと
// 「night lord "gladius_split"」という存在しない夜王を頼むことになるので、
// どの夜王のどの形態かを明示する。登錄表の BOSS_FORM_SHEETS と対で増える。
const BOSS_FORM_SUBJECTS = {
  boss_gladius_split:
    'Elden Ring Nightreign night lord "gladius" in its SPLIT form — one of the three ' +
    "smaller wolves the fused three-headed beast breaks apart into, each still carrying " +
    "part of the broken body on its back. NOT the fused three-headed beast. Boss scale, " +
    "leaner and faster-looking than the fused form",
};

// 形態別 sheet の subject。個別の説明があればそれを、無ければ「第二形態」として頼む。
// id をそのまま流すと「night lord "harmonia_split"」という存在しない夜王を頼むことになる。
function bossSubject(sheetId) {
  if (BOSS_FORM_SUBJECTS[sheetId]) return BOSS_FORM_SUBJECTS[sheetId];
  const form = /^boss_(.+)_split$/.exec(sheetId);
  if (form) {
    return (
      'Elden Ring Nightreign night lord "' + form[1] + '" in its SECOND form — the shape it ' +
      "changes into partway through the fight, visibly different from its first form. " +
      "Boss scale, imposing silhouette"
    );
  }
  return (
    'Elden Ring Nightreign night lord "' + sheetId.replace("boss_", "") +
    '", boss scale, imposing silhouette'
  );
}

function entryOf(s) {
  if (s.id.indexOf("boss_") === 0) {
    return {
      id: s.id,
      file: s.file,
      kind: "boss",
      subject: bossSubject(s.id),
      members: [],
    };
  }
  const members = membersOf(s.id);
  const fam = FAMILIES.filter(function (f) {
    return s.id.indexOf("family_" + f.id + "_") === 0;
  })[0];
  const sizes = {};
  members.forEach(function (e) {
    sizes[e.size] = true;
  });
  // 「この系統の代表 1 体」であることを毎回明示する（2026-09-22）。
  // 以前は "representative members: A、B、C、D (11 enemies share this sheet)" とだけ書いて
  // いたら、生成側が「系統の面々を並べた一覧」を返してきた——8 行それぞれが別のキャラで、
  // 行＝動作になっていない。系統 sheet は 1 体が系統全体を代表する絵なので、
  // 「並べるな、1 体だけ描け」を subject 自体に入れておく。
  return {
    id: s.id,
    file: s.file,
    kind: "family",
    subject:
      "ONE single creature that represents the " +
      (fam ? fam.name.ja + " / " + fam.name.zh : s.id) +
      " group (size class " +
      Object.keys(sizes).join("+") +
      "), designed after these members: " +
      members
        .slice(0, 4)
        .map(function (e) {
          return e.name.ja;
        })
        .join("、") +
      ". Draw ONE creature only — this single sheet is reused for all " +
      members.length +
      " enemies of the group, it is NOT a lineup of them",
    members: members.map(function (e) {
      return e.name.ja;
    }),
  };
}

const args = process.argv.slice(2);
const fmtArg = args.filter(function (a) {
  return a.indexOf("--format=") === 0;
})[0];
const format = fmtArg ? fmtArg.split("=")[1] : "full";
const only = args.filter(function (a) {
  return a.indexOf("--") !== 0;
})[0];

const entries = R.listSheets()
  .filter(function (s) {
    return !only || s.id === only;
  })
  .map(entryOf);

const PREAMBLE =
  "You are generating a set of " +
  R.listSheets().length +
  " sprite sheets for one game. Every sheet MUST share the exact same art style, " +
  "line weight, palette and cell layout — treat the following as a fixed contract " +
  "for the whole session, and apply it to every sheet I ask for afterwards " +
  "without me repeating it.\n\n" +
  STYLE +
  ", " +
  ROWS +
  "\n\n" +
  FRAME_RULE +
  "\n\nI will then send one short line per sheet, in the form:\n" +
  "  <filename> — subject: <what the creature is>\n" +
  "Reply with only the image for that sheet. Keep the style identical to the contract above.";

// ---- 動畫表のやり直し用（2026-09-21）----
// 実際に起きた失敗：「sprite sheet」と頼んだら 6 欄×8 列のアニメーション表ではなく、
// 171 体の別々のキャラを並べた「名鑑」が 1 枚返ってきた。絵柄自体は良いのに、
// どのセルも別キャラ・単一ポーズなので動畫としては 1 コマも使えない。
//
// 同じ会話セッションが生きているなら、そこが最大の武器になる：既に描いた造形を
// 参照させられるので、画風も造形も説明し直さずに済む。この preamble はその前提で
// 「何を取り違えたか」だけを正し、以降は 1 体ずつの動畫表を要求する形に切り替える。
//
// 実測で分かった不備をそのまま禁止事項に落としてある（名鑑になる／背景が不透明／
// セル寸法が不揃い／個体ごとに大きさが変わる）。抽象的に「正しく作って」と言っても
// 同じ失敗を繰り返すので、起きた失敗を名指しする。
const ANIM_PREAMBLE =
  "The sheet you just produced is a ROSTER — many different creatures, one pose each. " +
  "That is not what I need, and I should have been clearer. Keep the art style and the " +
  "character designs exactly as they are; only the sheet layout has to change.\n\n" +
  "From now on, each request is the ANIMATION SHEET for ONE creature.\n\n" +
  "Hard requirements for every sheet from here on:\n" +
  "1. ONE creature only. All 48 cells show the SAME creature — never a lineup of " +
  "different creatures. Reuse the design you already drew for it in the roster.\n" +
  "2. Canvas exactly 1536 x 2048 pixels: 6 columns x 8 rows of 256x256 SQUARE cells, " +
  "evenly spaced. Exactly 6 columns, not 7. The last attempt came back 7 wide at " +
  "1536x1024, which makes each cell 219x128 instead of square.\n" +
  "2b. Leave margin inside every cell. The creature AND its effects together should " +
  "occupy about 80% of the cell and must not touch the cell edges. In the last attempt " +
  "46 of the 48 cells ran into the row above or below, so breath, dust and sweep " +
  "effects were cut off at the boundary.\n" +
  "3. Each ROW is one action, read left to right as 6 consecutive animation frames:\n" +
  "   " +
  ROWS.replace("row order: ", "") +
  "\n" +
  "4. The creature keeps the same scale and the same ground baseline in every cell. " +
  "Only the pose changes between frames.\n" +
  "5. Save as a 32-bit PNG with a REAL alpha channel (PNG colour type 6, RGBA). The " +
  "background must be alpha 0 — actually empty, not painted. Do NOT draw a grey-and-white " +
  "checkerboard: one attempt came back as a 24-bit PNG (colour type 2, no alpha at all) " +
  "with the checkerboard baked in as real pixels, which puts a grey grid on screen in game. " +
  "No mottled backdrop, no gradient, no coloured haze either.\n" +
  "6. No text, no labels, no cell borders, no grid lines, no drop shadow on the ground.\n" +
  "7. " +
  FRAME_RULE +
  ".\n\n" +
  "Reply with only the image. I will send one creature per message, as:\n" +
  "  <filename> — <creature>";

// ---- 「各行の 1 格目は前搖」だけを追送するぶん（2026-09-21）----
// 既に動畫表モードで回っている会話に、画風も造形も layout も触らずにこの 1 条だけを
// 足すためのもの。ANIM_PREAMBLE を貼り直すと「名鑑になっている」という前提から
// 始まってしまい、既に正しく回っている会話を混乱させる。
const FRAME_PREAMBLE =
  "One more rule for every animation sheet from here on. Everything else stays exactly " +
  "as it is — art style, character designs, canvas size, cell layout, alpha channel.\n\n" +
  "7. The FIRST cell of every row is the WIND-UP, and it must contain NO attack effect.\n" +
  "   - The creature is loading the attack: weapon drawn back, weight shifted, mouth " +
  "opening, magic gathering in the hands only.\n" +
  "   - Draw nothing that is already the attack itself: no slash arc, no weapon trail, " +
  "no projectile, no beam, no muzzle flash, no magic circle, no shockwave, no dust " +
  "burst, no impact flash.\n" +
  "   - The attack effect appears from the SECOND cell onward and peaks around the " +
  "fourth or fifth cell.\n" +
  "   - Idle row: the first cell is the neutral resting pose. Hurt and death rows: the " +
  "first cell is the instant before the body reacts — still upright, no impact effect " +
  "yet.\n\n" +
  "Why this matters: in game the player watches that first cell to decide whether to " +
  "dodge. If the effect is already on screen in cell 1, the attack reads as having " +
  "already landed and there is nothing left to react to.\n\n" +
  "Reply with only the image. I will keep sending one creature per message, as:\n" +
  "  <filename> — <creature>";

// 行 5（重砸）／行 6（單擊）の中身だけを、既に回っている会話へ追送するぶん（2026-09-23）。
// 画風も造形も canvas も触らない。ANIM_PREAMBLE を貼り直すと「名鑑になっている」前提から
// 始まってしまうので、FRAME_PREAMBLE と同じく 1 条だけの短いものを別に用意する。
const ROWS_PREAMBLE =
  "A correction to what rows 5 and 6 mean. Everything else stays exactly as it is — " +
  "art style, character designs, canvas size, cell layout, alpha channel, and the " +
  "first-cell wind-up rule.\n\n" +
  "Row 5 is NOT a plain overhead swing. The creature LEAPS UP and SMASHES STRAIGHT DOWN " +
  "into the ground: cells 1-2 crouch and launch, cells 3-4 are airborne with the body " +
  "clearly off the ground, cells 5-6 are the landing — the impact cracks the ground and " +
  "throws up a dust burst.\n\n" +
  "Row 6 is NOT a melee strike. It is a SINGLE RANGED SHOT at one distant target: the " +
  "creature plants itself, aims, and fires ONE projectile — an arrow, bolt, spit, thrown " +
  "stone or focused magic dart. It must not step forward into melee range.\n\n" +
  "For contrast, row 2 stays the other kind of ranged attack: a beam, breath or wave " +
  "that extends in a straight LINE away from the body and stays connected to it. " +
  "Row 2 is a continuous line, row 6 is one separate projectile — they must not look " +
  "like the same attack.\n\n" +
  "So the eight rows are:\n  " +
  ROWS.replace("row order: ", "") +
  "\n\nReply with only the image. I will keep sending one creature per message, as:\n" +
  "  <filename> — <creature>";

if (format === "json") {
  // 自前のスクリプトや API から回すとき用。style / rows / preamble を分けて持たせるので、
  // 「毎回 style を足す」も「preamble を 1 回だけ流して短い行を 60 回」もどちらも組める。
  console.log(
    JSON.stringify(
      {
        style: STYLE,
        rows: ROWS,
        frameRule: FRAME_RULE,
        preamble: PREAMBLE,
        animPreamble: ANIM_PREAMBLE,
        framePreamble: FRAME_PREAMBLE,
        rowsPreamble: ROWS_PREAMBLE,
        count: entries.length,
        sheets: entries,
      },
      null,
      2
    )
  );
} else if (format === "rows") {
  // 行 5／6 の中身だけを追送するぶん。1 回だけ。
  console.log(ROWS_PREAMBLE);
} else if (format === "frame-rule") {
  // 動畫表モードで回っている会話に、前搖の 1 条だけを追送するぶん。1 回だけ。
  console.log(FRAME_PREAMBLE);
} else if (format === "anim-preamble") {
  // 名鑑が返ってきた会話に投げて、動畫表モードに切り替えるぶん。1 回だけ。
  console.log(ANIM_PREAMBLE);
} else if (format === "anim") {
  // anim-preamble のあと、1 体 1 行で流すぶん。
  entries.forEach(function (e) {
    console.log(e.file + " — " + e.subject);
  });
} else if (format === "preamble") {
  // ChatGPT などの会話型サービスに最初の 1 回だけ貼るぶん。
  console.log(PREAMBLE);
} else if (format === "short") {
  // preamble を貼ったあと、1 組 1 行で流すぶん。
  entries.forEach(function (e) {
    console.log(e.file + " — subject: " + e.subject);
  });
} else {
  // 従来どおり、1 組で完結する長い prompt（1 回きりの生成や単発の作り直し向け）。
  entries.forEach(function (e) {
    console.log("=== " + e.id + " -> " + e.file + " ===");
    console.log(STYLE + ", " + ROWS);
    console.log(FRAME_RULE);
    console.log("subject: " + e.subject);
    console.log("");
  });
}
