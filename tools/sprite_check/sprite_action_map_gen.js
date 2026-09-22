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

// 夜の王の招式も対照表に入れる（2026-09-22）。
// それまでこの生成器は enemies_data_* しか見ておらず、夜の王の 69 招はどれも表に無かった。
// 実行時は resolve() が dmgKind で退くので、乱戦傷害＝area／個別傷害＝single の 2 種類しか
// 再生されない＝ sheet に描いた直線・突刺・重砸の 3 行がほぼ死んでいた。
vm.runInContext(
  fs.readFileSync(path.join(ROOT, "static_src", "night_boss_rulebook.js"), "utf8"),
  sandbox,
  { filename: "night_boss_rulebook.js" }
);
const BOSSES = sandbox.window.PriTestBossRulebook.list();

// キーワード表（spec §7.2）。上から順に判定し、最初に当たったものを採用する。
const KEYWORDS = [
  { anim: "thrust", re: /突き|突進|刺し|貫/ },
  { anim: "area", re: /薙ぎ|払い|振り回|回転|旋回|群が|衝撃波|ブレス|咆哮|吠え/ },
  { anim: "slam", re: /叩きつけ|振り下ろ|落とし|踏みつけ|跳躍|のしかかり|プレス/ },
  { anim: "line", re: /射撃|撃ち|放つ|つぶて|矢|弾|投擲|投げ|飛ば/ },
  { anim: "single", re: /噛みつき|喰らい|爪|ひっかき|殴り|蹴り|斬り|切り|掴み|飛びかかり/ }
];

// 人手で補標した長尾（キーワードでは推定できないもの）。ここに足していく。
// 2026-09-21 使用者補標 203 筆（原未對應 207 名）。刻意留白的 4 名不列入這裡，
// 讓 resolve() 退回 dmgKind 預設（group→area、其餘→single）：
//   ・ガードカウンター／ハイガード＆ガードカウンター／バックラーパリィ
//     ——防禦反擊型，沒有合適的攻擊動畫，改由反擊效果處理。
//   ・仲間呼び——召喚技，本來就不是攻擊動作。
const OVERRIDES = {
  "回り込み": "area",
  "狂い火": "slam",
  "つかみかかり": "single",
  "ジャンプ攻撃": "slam",
  "ダッシュ攻撃": "thrust",
  "光輪": "area",
  "円刃剣の舞": "area",
  "呪霊呼び": "line",
  "奇襲＆闇に紛れる": "single",
  "挟み込み拘束": "single",
  "斧槍の連撃": "thrust",
  "溶岩吐き＆溶岩の滞留": "line",
  "神託のシャボン": "slam",
  "突撃": "thrust",
  "突撃指令＆防御態勢": "thrust",
  "突撃指示": "thrust",
  "落雷": "slam",
  "連撃": "thrust",
  "連続攻撃": "single",
  "霊の飛沫": "slam",
  "駆け抜け": "thrust",
  "魔力の閃光": "area",
  "つむじ風": "area",
  "アステール・メテオ": "area",
  "アローレイン": "thrust",
  "アースシーカー": "thrust",
  "ウォークライ＆突撃": "thrust",
  "エオヒドの剣舞": "area",
  "エオヒドの飛剣": "thrust",
  "カーリアの速剣": "single",
  "クロスボウ": "line",
  "コンビネーション攻撃": "thrust",
  "ハイマの大槌": "slam",
  "ハイマの砲丸": "slam",
  "ハサミ連続攻撃": "single",
  "ハサミ食らいつき": "single",
  "ヘビーアタック": "slam",
  "ベアハッグ": "thrust",
  "マーキング": "thrust",
  "メテオライト＆斥力波": "line",
  "ローレッタの絶技＆輝剣の円陣": "area",
  "両刃剣乱舞": "area",
  "乙女の抱擁": "area",
  "乱撃": "thrust",
  "乱舞": "area",
  "倒れ込み": "single",
  "側転回り込み": "thrust",
  "光の大槌": "slam",
  "光の柱": "area",
  "光の槍": "thrust",
  "冷気の嵐": "area",
  "前転攻撃": "area",
  "剣の連撃": "line",
  "剣嵐の刃": "single",
  "創星雨": "area",
  "動き回る腕": "single",
  "双剣の舞": "area",
  "古き死の怨霊": "thrust",
  "吐き出し": "single",
  "吹雪の吐息": "thrust",
  "咥え込み": "single",
  "咥え込み＆回り込み": "single",
  "咳き込み": "single",
  "地を這う赤雷": "area",
  "地擦り斬撃＆体当たり": "line",
  "坩堝の諸相・喉": "area",
  "坩堝の諸相・翼": "thrust",
  "夜の彗星": "area",
  "夜の霧": "area",
  "大弓＆クロスボウ": "line",
  "大波": "line",
  "子蜘蛛の抱擁": "thrust",
  "子蜘蛛の牙": "single",
  "射手の一撃": "line",
  "岩盤砕き": "slam",
  "広範囲降雷": "area",
  "弓乱射": "line",
  "影の貴人の群れ": "thrust",
  "後ずさる": "single",
  "怯える": "single",
  "抱きつき": "single",
  "拒絶": "single",
  "拒絶の霜": "thrust",
  "放電": "thrust",
  "数え上げる呪い": "single",
  "斧槍嵐脚": "area",
  "斧連続攻撃": "area",
  "星雲": "area",
  "時間差攻撃＆黄金の返報": "single",
  "暴れまわり": "thrust",
  "曲剣二刀": "thrust",
  "槍呼び＆飛び退き": "thrust",
  "武器振り後ずさり": "line",
  "死に生きる者:暴れまわる＆転移": "thrust",
  "死の叫び": "single",
  "死の瘴気": "area",
  "死儀礼の鳥:呪霊爆発＆転移": "area",
  "死儀礼の鳥:槍呼び＆再召喚": "thrust",
  "毒の噴霧": "area",
  "毒の瘴気": "area",
  "毒吐き": "thrust",
  "毒散布": "area",
  "毒液噴射": "thrust",
  "毒霧": "area",
  "水鉄砲": "line",
  "氷の吐息": "line",
  "氷嵐の剣技": "line",
  "氷槍＆飛び退き": "thrust",
  "流体剣": "line",
  "流体槍": "thrust",
  "浮遊": "single",
  "火の雨": "area",
  "火吹き": "line",
  "火炎壺": "area",
  "火炎放射": "line",
  "火球": "area",
  "火花の香り": "single",
  "炎の嵐": "area",
  "炎の舌": "line",
  "炎の連撃＆炉の炎": "thrust",
  "炎の隕石": "area",
  "炎吐き": "line",
  "炎噴き": "line",
  "炎爆発": "thrust",
  "炎爆発＆炉の炎": "thrust",
  "熱戦爆発": "area",
  "燭台＆支援": "single",
  "爆裂ボルト": "line",
  "狂い火の豪雨": "area",
  "猛追": "thrust",
  "猟犬の剣技＆飛び退き": "thrust",
  "直剣連撃": "line",
  "盾撃": "single",
  "睡眠の霧": "area",
  "瞬雷・双斧": "line",
  "短剣連続攻撃": "thrust",
  "砕け散る結晶": "area",
  "祈りの一撃": "single",
  "神獣の舞": "thrust",
  "神獣竜巻": "area",
  "神獣霜踏み": "area",
  "神託の大シャボン": "area",
  "空裂狂火": "area",
  "立ち上がり剣撃＆溶岩の滞留": "area",
  "糸の雨": "area",
  "紫の吐息": "line",
  "組みつき": "single",
  "罪の茨": "thrust",
  "罰の茨": "thrust",
  "聖槍の壁": "slam",
  "背後からの一撃": "single",
  "背後致命": "single",
  "脚踏み＆転がり": "thrust",
  "腐敗の嵐": "area",
  "自爆": "area",
  "蟲糸": "thrust",
  "蟻酸": "thrust",
  "蠢く尻尾": "area",
  "血の茨": "thrust",
  "血の飛沫": "area",
  "血炎の交差斬撃": "area",
  "血炎の槍撃＆槍の幻影": "thrust",
  "血炎の飛沫": "area",
  "角振り上げ": "thrust",
  "赤い雷槌＆迸る赤雷": "slam",
  "赤獅子の炎": "line",
  "踏み込み＆盾ガード": "thrust",
  "転移": "single",
  "転移＆杖撃": "single",
  "輝石の彗星＆輝剣の円陣": "thrust",
  "這いずり回り": "line",
  "這いずり回り＆溶岩の滞留": "line",
  "連携攻撃": "single",
  "連続踏み付け": "thrust",
  "酸吐き": "thrust",
  "酸吐き出し": "thrust",
  "重力操作＆重力岩生成": "slam",
  "重力波": "slam",
  "針降らし": "thrust",
  "闇に紛れる": "area",
  "雷の槍": "thrust",
  "雷の蹴撃": "thrust",
  "雷光剣槍＆落雷": "thrust",
  "雷大剣連撃＆角降ろし": "line",
  "雷槍": "thrust",
  "霊炎発火": "line",
  "音波攻撃": "line",
  "飛び退き＆深淵纏い": "single",
  "飛沫の一撃＆転移": "single",
  "食いつき": "single",
  "馬体当たり": "single",
  "騎士の雷槍": "thrust",
  "高揚の香り": "single",
  "魔力の大剣": "line",
  "魔力の大剣＆輝剣の円陣": "line",
  "魔力の短剣": "line",
  "黄金の地": "single",
  "黄金の弧": "area",
  "黄金の爆発＆回り込み": "single",
  "黄金樹の尻撃": "slam",
  "黒炎の乱舞": "area",
  "黒炎の扇": "area",
  "黒炎発火": "area"
};

function classify(name) {
  if (OVERRIDES[name]) return OVERRIDES[name];
  for (let i = 0; i < KEYWORDS.length; i++) {
    if (KEYWORDS[i].re.test(name)) return KEYWORDS[i].anim;
  }
  return null;
}

// 攻擊動作（待機・受擊・死亡は招式に割り当てない）。順番は enemy_sprite_data.js の row 順。
const ATTACK_ANIMS = ["line", "area", "thrust", "slam", "single"];

// 夜の王 1 隻ぶんの招式名を、表に出てくる順で取り出す。
function bossMoveNames(boss) {
  const cols = boss.actionColumns.map(function (c) {
    return (c && (c.ja || c.zh)) || "";
  });
  let nameIdx = cols.indexOf("アクション名");
  if (nameIdx === -1) nameIdx = boss.actionColumns.length - 3;
  const out = [];
  boss.actions.forEach(function (row) {
    const cell = row[nameIdx];
    const ja = cell && cell.ja ? cell.ja : "";
    if (ja && ja !== "—" && out.indexOf(ja) === -1) out.push(ja);
  });
  return out;
}

// 夜の王ごとに独立した対照表を作る（2026-09-22）。
//
// 一般敵と同じ BY_NAME に混ぜると、「噛みつき」のように名前を共有している招式を
// 動かしたとき一般敵の動畫まで変わってしまう。夜の王は 10 隻しかおらず、招式も
// 各 5~8 招なので、隻ごとに持たせたほうが後から手で調整するときも楽。
//
// 埋め方（使用者明確規格「先分析第一波，安排相應動畫，剩下不好分的可以直接由還沒有
// 被選中的動畫隨機挑選；這樣就能保持全部動畫都有機會登場」）：
//   ① キーワード表／OVERRIDES で当たるものを先に決める
//   ② まだ出番の無い動畫を、表に出てくる順で未決定の招式に配る
//   ③ それでも余る動畫があれば、同じ動畫が 2 つ以上に付いている招式から 1 つ譲る
// 乱数は使わない——生成時に決めて対照表へ焼き込むので、全端末で同じでなければならない。
function buildBossMaps(classifyFn) {
  const maps = {};
  const report = [];
  BOSSES.forEach(function (boss) {
    const moves = bossMoveNames(boss);
    const decided = {};
    const used = {};
    let byKeyword = 0;
    moves.forEach(function (n) {
      const anim = classifyFn(n);
      if (anim) {
        decided[n] = anim;
        used[anim] = true;
        byKeyword++;
      }
    });
    const unused = ATTACK_ANIMS.filter(function (a) {
      return !used[a];
    });
    let cycle = 0;
    moves.forEach(function (n) {
      if (decided[n]) return;
      decided[n] = unused.length ? unused.shift() : ATTACK_ANIMS[cycle++ % ATTACK_ANIMS.length];
    });
    while (unused.length) {
      const counts = {};
      moves.forEach(function (n) {
        counts[decided[n]] = (counts[decided[n]] || 0) + 1;
      });
      let donor = null;
      for (let i = moves.length - 1; i >= 0; i--) {
        if (counts[decided[moves[i]]] > 1) {
          donor = moves[i];
          break;
        }
      }
      if (!donor) break;
      if (classifyFn(donor)) byKeyword--;
      decided[donor] = unused.shift();
    }
    maps[boss.id] = decided;
    report.push({ boss: boss.id, moves: moves, decided: decided, byKeyword: byKeyword });
  });
  return { maps: maps, report: report };
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

// 夜の王は隻ごとの独立表（BY_BOSS）。一般敵の BY_NAME には混ぜない。
const bossBuild = buildBossMaps(classify);

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
console.log("");
console.log("[夜の王（隻ごとの独立表）]");
bossBuild.report.forEach(function (r) {
  const counts = {};
  r.moves.forEach(function (n) {
    counts[r.decided[n]] = (counts[r.decided[n]] || 0) + 1;
  });
  const missing = ATTACK_ANIMS.filter(function (a) {
    return !counts[a];
  });
  console.log(
    "  " + r.boss.padEnd(10) + " 招式 " + String(r.moves.length).padStart(2) +
      "（キーワード " + r.byKeyword + " / 補充 " + (r.moves.length - r.byKeyword) + "）  " +
      ATTACK_ANIMS.map(function (a) {
        return a + "×" + (counts[a] || 0);
      }).join(" ") +
      (missing.length ? "  ← " + missing.join(",") + " が出番なし" : "")
  );
  if (process.argv.indexOf("--verbose") !== -1) {
    r.moves.forEach(function (n) {
      console.log("      " + r.decided[n].padEnd(7) + n);
    });
  }
});

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

const bossLines = bossBuild.report.map(function (r) {
  const inner = r.moves.map(function (n) {
    return '      "' + n + '": "' + r.decided[n] + '"';
  });
  return '    "' + r.boss + '": {\n' + inner.join(",\n") + "\n    }";
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
  "  // 夜の王は隻ごとの表。招式名が一般敵と被っても、こちらが優先される。\n" +
  "  var BY_BOSS = {\n" +
  bossLines.join(",\n") +
  "\n  };\n\n" +
  "  // actionName 可以直接吃 enemies_data_*.js 的 action.name——實際資料是\n" +
  '  // { ja: "叩きつけ", zh: "砸擊" } 這種多語物件，enemyAttack.actionName 也是這個形狀。\n' +
  '  // 當成字串處理的話 BY_NAME[物件] 會去查 "[object Object]"，永遠落到 dmgKind 預設，\n' +
  "  // 整張對照表就形同虛設。所以以 ja 為鍵，同時也接受直接傳字串。\n" +
  "  // 第3引数に夜王 id を渡すと、その夜王専用の表を先に引く。夜の王の招式は名前が\n" +
  "  // 一般敵と被ることがあり（噛みつき・突進など）、共用の BY_NAME に混ぜると一般敵の\n" +
  "  // 動畫まで巻き添えになるので、隻ごとに分けてある。\n" +
  "  function resolve(actionName, dmgKind, bossId) {\n" +
  '    var key = actionName && typeof actionName === "object" ? actionName.ja : actionName;\n' +
  "    if (key && bossId && BY_BOSS[bossId] && BY_BOSS[bossId][key]) return BY_BOSS[bossId][key];\n" +
  "    if (key && BY_NAME[key]) return BY_NAME[key];\n" +
  '    if (dmgKind === "group") return "area";\n' +
  '    return "single";\n' +
  "  }\n\n" +
  "  window.PriTestEnemyActionAnimMap = { byName: BY_NAME, byBoss: BY_BOSS, resolve: resolve };\n" +
  "})();\n";

fs.writeFileSync(path.join(ROOT, "static_src", "enemy_action_anim_map.js"), out, "utf8");
console.log("\nstatic_src/enemy_action_anim_map.js を書き出しました。");
