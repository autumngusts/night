# midnight 戰鬥 sprite 動畫層（階段 1：管線與 renderer）實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立敵人 sprite 的資料層、產出／驗收工具與遊戲端 renderer，在「一張圖都還沒有」的狀態下即可合併並運行（全部走 fallback 靜態圖），為之後的實圖與判定改動鋪好地基。

**Architecture:** 三層解耦——資料層（動作時間軸 ＋ 招式對照 ＋ sheet 登錄）／表現層（`midnight_sprite.js`，用 CSS `background-position` 從 sheet 取幀）／判定層（本階段不動）。renderer 只認登錄表的 `available` 旗標，未產出的 sheet 一律 fallback 到現有 `<img>` 靜態圖。

**Tech Stack:** Vanilla ES5（瀏覽器端）／Node（`tools/` 工具腳本，零外部相依）／Python 僅限既有的 `generate.py`。

## Global Constraints

- 回覆與新增文件、commit message 一律**繁體中文**（CLAUDE.md §1.1）。
- 瀏覽器端 JS 一律 **Vanilla ES5**，不得使用 `let`/`const`/箭頭函式/樣板字串（專案無建置框架）。
- 工具腳本是 **Node**，放在 `tools/<group>/`，以 `package.json` 的 npm scripts 註冊，慣例見 `tools/midnight_check/`。**不得新增任何 npm 相依。**
- **不發明規則書沒有的數值**（CLAUDE.md §19）。本計畫使用的數值全部來自 spec §3 的使用者明確規格，或標為暫定並由檢查腳本夾在規格區間內。
- 每次修改 `site_src/` 或 `static_src/` 後必須重跑 `py -3 generate.py`。
- 語法檢查：`node --check static_src/<file>.js`。專案沒有 lint、沒有測試框架，「測試」＝ `tools/` 下的 check 腳本，風格照抄 `tools/midnight_check/graces_check.js`（`ok(cond, label)` 印 OK/FAIL，最後依失敗數 `process.exit`）。
- 動畫規格（spec §3／§5.3）：8 動作＝待機／直線／範圍／突刺／重砸／單擊／受擊／死亡；6 幀／動作；sheet 佈局為橫 6 幀 × 縱 8 動作；一律繪製朝左。
- 前搖必須落在 **0.4~0.7 秒**（spec §3）。本階段的分配為暫定值，由檢查腳本強制夾在此區間，階段 2 以實圖校正。
- 本階段**不得更動**任何傷害計算、判定流程或 `night.js`。

---

### Task 1: 動作時間軸資料層

**Files:**
- Create: `static_src/enemy_sprite_data.js`
- Create: `tools/sprite_check/package.json`
- Test: `tools/sprite_check/sprite_anim_check.js`

**Interfaces:**
- Produces: `window.PriTestEnemySprite`，本任務提供 `listAnims()`、`getAnim(animId)`、`animHitTimeMs(animId)`、`animTotalMs(animId)`、`SHEET_COLS`、`SHEET_ROWS`。
  - `getAnim(animId)` 回傳 `{ id, row, frameCount, frameMs, hitFrame, loop, hold }`，`hitFrame` 為 0-based 索引，無命中幀者為 `null`。
  - `animHitTimeMs(animId)` 回傳 `frameMs * hitFrame`（即前搖長度，毫秒），無命中幀者回 `null`。
  - `animTotalMs(animId)` 回傳 `frameMs * frameCount`。

- [ ] **Step 1: 先寫失敗的檢查腳本**

建立 `tools/sprite_check/package.json`：

```json
{
  "name": "pritest-sprite-check",
  "private": true,
  "version": "1.0.0",
  "description": "敵人 sprite 動畫層的資料檢查與產出工具，見 docs/superpowers/specs/2026-09-21-midnight-sprite-combat-design.md。",
  "scripts": {
    "test:anim": "node sprite_anim_check.js"
  }
}
```

建立 `tools/sprite_check/sprite_anim_check.js`：

```js
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
```

- [ ] **Step 2: 執行以確認失敗**

Run: `node tools/sprite_check/sprite_anim_check.js`
Expected: FAIL，訊息為 `ENOENT ... enemy_sprite_data.js`（檔案尚未建立）

- [ ] **Step 3: 寫出最小實作**

建立 `static_src/enemy_sprite_data.js`：

```js
(function () {
  // 敵人 sprite 的動作時間軸定義。
  // 設計文件：docs/superpowers/specs/2026-09-21-midnight-sprite-combat-design.md
  //
  // 8 動作 × 6 幀の sheet を、横6幀 × 縦8動作 で並べる（spec §5.3）。row がそのまま
  // sheet の縦位置になるので、ここの row を変えると既存の sheet 画像が全部ずれる。
  //
  // frameMs × hitFrame ＝ 前搖（プレイヤーが招を読む時間）。使用者明確規格で
  // 0.4~0.7 秒の範囲が指定されているが、各動作への配分は暫定値で、階段2で実図が
  // 入ってから体感に合わせて校正する（spec §12）。tools/sprite_check/sprite_anim_check.js
  // が範囲を強制しているので、校正時もこの区間から外れることはない。
  var SHEET_COLS = 6;
  var SHEET_ROWS = 8;

  var ANIMS = [
    { id: "idle", row: 0, frameCount: 6, frameMs: 200, hitFrame: null, loop: true, hold: false },
    { id: "line", row: 1, frameCount: 6, frameMs: 170, hitFrame: 3, loop: false, hold: false },
    { id: "area", row: 2, frameCount: 6, frameMs: 150, hitFrame: 4, loop: false, hold: false },
    { id: "thrust", row: 3, frameCount: 6, frameMs: 140, hitFrame: 3, loop: false, hold: false },
    { id: "slam", row: 4, frameCount: 6, frameMs: 175, hitFrame: 4, loop: false, hold: false },
    { id: "single", row: 5, frameCount: 6, frameMs: 150, hitFrame: 3, loop: false, hold: false },
    { id: "hurt", row: 6, frameCount: 6, frameMs: 90, hitFrame: null, loop: false, hold: false },
    { id: "death", row: 7, frameCount: 6, frameMs: 160, hitFrame: null, loop: false, hold: true }
  ];

  function listAnims() {
    return ANIMS;
  }

  function getAnim(animId) {
    return (
      ANIMS.filter(function (a) {
        return a.id === animId;
      })[0] || null
    );
  }

  function animHitTimeMs(animId) {
    var a = getAnim(animId);
    if (!a || a.hitFrame === null) return null;
    return a.frameMs * a.hitFrame;
  }

  function animTotalMs(animId) {
    var a = getAnim(animId);
    if (!a) return 0;
    return a.frameMs * a.frameCount;
  }

  window.PriTestEnemySprite = {
    SHEET_COLS: SHEET_COLS,
    SHEET_ROWS: SHEET_ROWS,
    listAnims: listAnims,
    getAnim: getAnim,
    animHitTimeMs: animHitTimeMs,
    animTotalMs: animTotalMs
  };
})();
```

- [ ] **Step 4: 執行以確認通過**

Run: `node tools/sprite_check/sprite_anim_check.js && node --check static_src/enemy_sprite_data.js`
Expected: 全部 OK，最後印「すべてOK」，exit 0

- [ ] **Step 5: Commit**

```bash
git add static_src/enemy_sprite_data.js tools/sprite_check/package.json tools/sprite_check/sprite_anim_check.js
git commit -m "feat(sprite): 敵人 sprite 的動作時間軸資料層"
```

---

### Task 2: 招式 → 動畫對照表

**Files:**
- Create: `tools/sprite_check/sprite_action_map_gen.js`
- Create: `static_src/enemy_action_anim_map.js`（由上面的腳本產出）
- Modify: `tools/sprite_check/package.json`（新增 npm scripts）
- Test: `tools/sprite_check/sprite_action_map_check.js`

**Interfaces:**
- Consumes: Task 1 的 `window.PriTestEnemySprite`（用來驗證對照到的 animId 真的存在）。
- Produces: `window.PriTestEnemyActionAnimMap`，提供 `byName` 物件（招式名 ja → animId）與 `resolve(actionName, dmgKind)`。
  - `resolve(actionName, dmgKind)` 先查 `byName`，查不到時依 `dmgKind` 退回預設：`"group"` → `"area"`、其餘（含 `"individual"`、`null`）→ `"single"`。回傳值必為 5 種攻擊動畫之一。

- [ ] **Step 1: 寫產生器**

建立 `tools/sprite_check/sprite_action_map_gen.js`：

```js
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
  "  // 招式名 → 動畫 id の対照表。\n" +
  "  // 自動生成: node tools/sprite_check/sprite_action_map_gen.js --write\n" +
  "  // 手で直さないこと——直すときは生成器の KEYWORDS / OVERRIDES を直して再生成する。\n" +
  "  // ここに無い招式は resolve() が dmgKind から既定値に退避するので、穴は空かない（spec §7.2）。\n" +
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
```

- [ ] **Step 2: 執行產生器，取得未對應長尾**

Run: `node tools/sprite_check/sprite_action_map_gen.js`
Expected: 印出「相異招式名: 430 / 総筆数: 549」與未對應清單。

**這一步需要使用者介入：** 把未對應清單貼給使用者補標，將結果填入 `OVERRIDES`（格式 `"招式名": "animId"`，animId 限 `line`/`area`/`thrust`/`slam`/`single`），再繼續下一步。未補標的項目不會造成錯誤（會退回 dmgKind 預設），但動畫多樣性會打折。

- [ ] **Step 3: 寫失敗的檢查腳本**

建立 `tools/sprite_check/sprite_action_map_check.js`：

```js
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
ok(M.resolve("存在しない招式名", "individual") === "single", "未登録 + 個別傷害 -> single");
ok(M.resolve(null, null) === "single", "招式名なし -> single");

console.log(fail === 0 ? "\nすべてOK" : "\n" + fail + " 件 FAIL");
process.exit(fail === 0 ? 0 : 1);
```

- [ ] **Step 4: 執行以確認失敗**

Run: `node tools/sprite_check/sprite_action_map_check.js`
Expected: FAIL，`ENOENT ... enemy_action_anim_map.js`

- [ ] **Step 5: 產出對照表並確認通過**

Run:
```bash
node tools/sprite_check/sprite_action_map_gen.js --write
node --check static_src/enemy_action_anim_map.js
node tools/sprite_check/sprite_action_map_check.js
```
Expected: 全部 OK，exit 0

- [ ] **Step 6: 註冊 npm scripts 並 commit**

在 `tools/sprite_check/package.json` 的 `scripts` 內加入這兩行：

```json
    "gen:action_map": "node sprite_action_map_gen.js --write",
    "test:action_map": "node sprite_action_map_check.js"
```

```bash
git add tools/sprite_check/ static_src/enemy_action_anim_map.js
git commit -m "feat(sprite): 招式から動畫を引く対照表と生成器"
```

---

### Task 3: sheet 登錄表（哪一隻敵人用哪一組圖）

**Files:**
- Create: `tools/sprite_check/sprite_registry_gen.js`
- Create: `static_src/enemy_sprite_registry.js`（由上面的腳本產出）
- Modify: `tools/sprite_check/package.json`
- Test: `tools/sprite_check/sprite_registry_check.js`

**Interfaces:**
- Produces: `window.PriTestEnemySpriteRegistry`，提供：
  - `sheetIdForEnemy(familyId, enemyId)` → `"family_<familyId>_a"` / `"..._b"`，查不到回 `null`
  - `sheetIdForBoss(bossId)` → `"boss_<bossId>"`，未登錄回 `null`
  - `getSheet(sheetId)` → `{ id, file, available }`，查不到回 `null`
  - `listSheets()` → 全部 60 組的陣列

**切分規則（spec §5.2）：** 系統內 size 有落差者依體型切大／小（`LL`/`L` 歸 `a`，`M`/`S` 歸 `b`）；系統內 size 全部相同者，依 `enemies` 陣列順序前半 `a`、後半 `b`。此為機械化的初始分配，要改就改生成器裡的 `OVERRIDES`。

- [ ] **Step 1: 寫失敗的檢查腳本**

建立 `tools/sprite_check/sprite_registry_check.js`：

```js
// sprite sheet の登録表（static_src/enemy_sprite_registry.js）の回歸測試。
//
//   node tools/sprite_check/sprite_registry_check.js
//
// 驗證 5 點（spec §5.1／§5.2）：
//   ① sheet は 60 組（25 系統 × 2 ＋ 夜王 10）
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
ok(R.listSheets().length === 60, "sheet は60組 (実際 " + R.listSheets().length + ")");
ok(FAMILIES.length === 25, "系統は25 (実際 " + FAMILIES.length + ")");

console.log("[149隻の帰属]");
let enemyCount = 0;
const orphan = [];
const used = {};
FAMILIES.forEach(function (f) {
  f.enemies.forEach(function (e) {
    enemyCount++;
    const sid = R.sheetIdForEnemy(f.id, e.id);
    if (!sid || !R.getSheet(sid)) orphan.push(f.id + "/" + e.id);
    else used[sid] = (used[sid] || 0) + 1;
  });
});
ok(enemyCount === 149, "敵は149隻 (実際 " + enemyCount + ")");
ok(orphan.length === 0, "全149隻が sheet に帰属" + (orphan.length ? " / 例: " + orphan[0] : ""));

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

console.log("[本階段は全て未産出]");
ok(
  R.listSheets().every(function (s) {
    return s.available === false;
  }),
  "全 sheet が available:false（画像がまだ無いので fallback に落ちる）"
);

console.log(fail === 0 ? "\nすべてOK" : "\n" + fail + " 件 FAIL");
process.exit(fail === 0 ? 0 : 1);
```

- [ ] **Step 2: 執行以確認失敗**

Run: `node tools/sprite_check/sprite_registry_check.js`
Expected: FAIL，`ENOENT ... enemy_sprite_registry.js`

- [ ] **Step 3: 寫生成器**

建立 `tools/sprite_check/sprite_registry_gen.js`：

```js
// sprite sheet の登録表を生成する。
//
//   node tools/sprite_check/sprite_registry_gen.js --write
//
// 切り分け規則（spec §5.2）：
//   ・系統内の size に落差がある → 体型で大(a)／小(b)
//   ・系統内の size が全て同じ   → enemies 配列の前半(a)／後半(b)
// 機械的な初期配分なので、気に入らない割当は OVERRIDES で個別に上書きする。
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

// "familyId/enemyId": "a" | "b"
const OVERRIDES = {};

const BOSSES = [
  "maris", "fulghor", "harmonia", "gladius", "gnoster",
  "caligo", "libra", "edele", "stragedes", "nameless"
];
const BIG = { LL: true, L: true };

function variantFor(fam, enemy, index) {
  const key = fam.id + "/" + enemy.id;
  if (OVERRIDES[key]) return OVERRIDES[key];
  const sizes = {};
  fam.enemies.forEach(function (e) {
    sizes[e.size] = true;
  });
  if (Object.keys(sizes).length > 1) return BIG[enemy.size] ? "a" : "b";
  return index < Math.ceil(fam.enemies.length / 2) ? "a" : "b";
}

const assign = [];
FAMILIES.forEach(function (f) {
  f.enemies.forEach(function (e, i) {
    assign.push(
      '    "' + f.id + "/" + e.id + '": "family_' + f.id + "_" + variantFor(f, e, i) + '"'
    );
  });
});

const sheets = [];
FAMILIES.forEach(function (f) {
  ["a", "b"].forEach(function (v) {
    sheets.push(
      '    { id: "family_' + f.id + "_" + v + '", file: "family_' + f.id + "_" + v + '.png", available: false }'
    );
  });
});
BOSSES.forEach(function (b) {
  sheets.push('    { id: "boss_' + b + '", file: "boss_' + b + '.png", available: false }');
});

const out =
  "(function () {\n" +
  "  // sprite sheet の登録表。\n" +
  "  // 自動生成: node tools/sprite_check/sprite_registry_gen.js --write\n" +
  "  // 手で直さないこと——割当を変えるときは生成器の OVERRIDES を直して再生成する。\n" +
  "  //\n" +
  "  // available は「画像が産出済みか」。false の間、midnight_sprite.js は既存の静止画に\n" +
  "  // fallback する（spec §4）。画像を入れたら sprite_pack.js が true に書き換える。\n" +
  "  var SHEETS = [\n" +
  sheets.join(",\n") +
  "\n  ];\n\n" +
  "  var ENEMY_SHEET = {\n" +
  assign.join(",\n") +
  "\n  };\n\n" +
  "  function listSheets() {\n    return SHEETS;\n  }\n\n" +
  "  function getSheet(sheetId) {\n" +
  "    return (\n      SHEETS.filter(function (s) {\n        return s.id === sheetId;\n      })[0] || null\n    );\n  }\n\n" +
  "  function sheetIdForEnemy(familyId, enemyId) {\n" +
  '    return ENEMY_SHEET[familyId + "/" + enemyId] || null;\n  }\n\n' +
  "  function sheetIdForBoss(bossId) {\n" +
  '    var id = "boss_" + bossId;\n' +
  "    return getSheet(id) ? id : null;\n  }\n\n" +
  "  window.PriTestEnemySpriteRegistry = {\n" +
  "    listSheets: listSheets,\n" +
  "    getSheet: getSheet,\n" +
  "    sheetIdForEnemy: sheetIdForEnemy,\n" +
  "    sheetIdForBoss: sheetIdForBoss\n" +
  "  };\n" +
  "})();\n";

fs.writeFileSync(path.join(ROOT, "static_src", "enemy_sprite_registry.js"), out, "utf8");
console.log(
  "static_src/enemy_sprite_registry.js を書き出しました（sheet " +
    sheets.length +
    " 組／敵 " +
    assign.length +
    " 隻）。"
);
```

- [ ] **Step 4: 產出並確認通過**

Run:
```bash
node tools/sprite_check/sprite_registry_gen.js --write
node --check static_src/enemy_sprite_registry.js
node tools/sprite_check/sprite_registry_check.js
```
Expected: 產出訊息為「sheet 60 組／敵 149 隻」，檢查全部 OK

- [ ] **Step 5: 註冊 npm scripts 並 commit**

在 `tools/sprite_check/package.json` 的 `scripts` 內加入這兩行：

```json
    "gen:registry": "node sprite_registry_gen.js --write",
    "test:registry": "node sprite_registry_check.js"
```

```bash
git add tools/sprite_check/ static_src/enemy_sprite_registry.js
git commit -m "feat(sprite): sheet 登録表と生成器"
```

---

### Task 4: prompt 產生器與規格文件

**Files:**
- Create: `tools/sprite_spec.md`
- Create: `tools/sprite_check/sprite_prompt.js`
- Modify: `tools/sprite_check/package.json`

**Interfaces:**
- Consumes: Task 1 的 `PriTestEnemySprite`、Task 3 的 `PriTestEnemySpriteRegistry`、`enemies_data_1~4.js`。
- Produces: 僅 CLI 輸出（給人貼到外部生成服務的文字），無執行期介面。

本任務的產出是文字，沒有可自動驗證的行為，驗收方式為**目視確認 60 段輸出齊全**（Step 3 的 `grep -c` 會把「齊不齊」變成可驗證的數字）。

- [ ] **Step 1: 寫規格文件**

建立 `tools/sprite_spec.md`：

```markdown
# 敵人 sprite 規格

設計文件：`docs/superpowers/specs/2026-09-21-midnight-sprite-combat-design.md`

## sheet 佈局

- 橫 6 幀 × 縱 8 動作的單張 PNG
- 縱向列順序（**不可更動**，與 `static_src/enemy_sprite_data.js` 的 `row` 一一對應）：
  0 待機／1 直線／2 範圍／3 突刺／4 重砸／5 單擊／6 受擊／7 死亡
- 背景透明
- 角色一律**朝左**繪製（朝右由 CSS `scaleX(-1)` 翻轉）
- 單格為正方形。尺寸暫定 128×128（sheet 768×1024），階段 2 由第一組實圖定案後回填此處

## 命名

- 一般敵人：`family_<familyId>_a.png` ／ `family_<familyId>_b.png`
- 夜王：`boss_<bossId>.png`
- 放置位置：`static_src/images/sprites/`

## 驗收流程

1. `node tools/sprite_check/sprite_prompt.js <sheetId>` 取得該組的生成 prompt
2. 在外部服務生成，存成上述檔名放進 `static_src/images/sprites/`
3. `node tools/sprite_check/sprite_verify.js` 檢查檔名在登錄表內、為合法 PNG、寬高可整除為 6×8 的正方格
4. `node tools/sprite_check/sprite_pack.js --write` 把登錄表的 `available` 更新為 true
5. `py -3 generate.py` 重新建置
```

- [ ] **Step 2: 寫 prompt 產生器**

建立 `tools/sprite_check/sprite_prompt.js`：

```js
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
["enemy_sprite_data.js", "enemy_sprite_registry.js"].forEach(function (f) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, "static_src", f), "utf8"), sandbox, { filename: f });
});
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
```

- [ ] **Step 3: 執行並確認輸出**

Run: `node tools/sprite_check/sprite_prompt.js | grep -c "^=== "`
Expected: `60`

Run: `node tools/sprite_check/sprite_prompt.js family_dragon_a`
Expected: 三行輸出——`=== family_dragon_a -> family_dragon_a.png ===`、style＋row order、`subject: ドラゴン・土竜系 / 龍・土龍系, size class LL, representative members: ...`

- [ ] **Step 4: 註冊 npm script 並 commit**

在 `tools/sprite_check/package.json` 的 `scripts` 內加入這一行：

```json
    "gen:prompt": "node sprite_prompt.js"
```

```bash
git add tools/sprite_check/ tools/sprite_spec.md
git commit -m "feat(sprite): 生成 prompt の出力器と規格文件"
```

---

### Task 5: 匯入驗收與 available 更新

**Files:**
- Create: `tools/sprite_check/sprite_verify.js`
- Create: `tools/sprite_check/sprite_pack.js`
- Modify: `tools/sprite_check/package.json`
- Test: `tools/sprite_check/sprite_verify_check.js`

**Interfaces:**
- Consumes: Task 3 的 `static_src/enemy_sprite_registry.js`。
- Produces: `sprite_verify.js` 以 CommonJS 匯出三個純函式供檢查腳本與 `sprite_pack.js` 呼叫：
  - `readPngSize(buffer)` → `{ width, height }`，非合法 PNG 回 `null`（只讀 IHDR，零相依）
  - `isGridDivisible(width, height)` → `boolean`，寬高皆可整除為 6×8 的**正方**格時為 true
  - `verifyFile(filePath)` → `{ ok, errors, size }`

- [ ] **Step 1: 寫失敗的檢查腳本**

建立 `tools/sprite_check/sprite_verify_check.js`：

```js
// sprite_verify.js の純函式部分の回歸測試。
//
//   node tools/sprite_check/sprite_verify_check.js
//
// 画像がまだ1枚も無い段階でも走らせたいので、PNG ヘッダは実ファイルではなく
// テスト内で組み立てた最小バイト列で検証する（外部相依ゼロ）。
const V = require("./sprite_verify.js");
let fail = 0;
function ok(cond, label) {
  console.log((cond ? "  OK   " : "  FAIL ") + label);
  if (!cond) fail++;
}

function fakePng(width, height) {
  const buf = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.writeUInt32BE(13, 8);
  buf.write("IHDR", 12, "ascii");
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

console.log("[PNG ヘッダの読み取り]");
const size = V.readPngSize(fakePng(768, 1024));
ok(size && size.width === 768 && size.height === 1024, "768x1024 を読める");
ok(V.readPngSize(Buffer.from("not a png at all, just text")) === null, "PNG でなければ null");
ok(V.readPngSize(null) === null, "null なら null");

console.log("[6x8 に割り切れるか]");
ok(V.isGridDivisible(768, 1024), "768x1024 は 6x8 の正方格 (128x128)");
ok(!V.isGridDivisible(770, 1024), "770x1024 は横が割り切れない");
ok(!V.isGridDivisible(768, 1000), "768x1000 は縦が割り切れない");
ok(!V.isGridDivisible(768, 800), "768x800 は割り切れるが正方形でない (128x100)");

console.log(fail === 0 ? "\nすべてOK" : "\n" + fail + " 件 FAIL");
process.exit(fail === 0 ? 0 : 1);
```

- [ ] **Step 2: 執行以確認失敗**

Run: `node tools/sprite_check/sprite_verify_check.js`
Expected: FAIL，`Cannot find module './sprite_verify.js'`

- [ ] **Step 3: 寫 verify**

建立 `tools/sprite_check/sprite_verify.js`：

```js
// 産出された sprite sheet の受け入れ検査。
//
//   node tools/sprite_check/sprite_verify.js
//
// static_src/images/sprites/ を走査し、登録表にある名前か・合法な PNG か・
// 6x8 の正方格に割り切れる寸法かを確認する。画像ライブラリは使わず PNG の IHDR だけ読む
// （専案に npm 相依を足さないため、spec §6 の前提）。
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..", "..");
const SPRITE_DIR = path.join(ROOT, "static_src", "images", "sprites");
const COLS = 6;
const ROWS = 8;

function readPngSize(buffer) {
  if (!buffer || buffer.length < 24) return null;
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < sig.length; i++) {
    if (buffer[i] !== sig[i]) return null;
  }
  if (buffer.toString("ascii", 12, 16) !== "IHDR") return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function isGridDivisible(width, height) {
  return width % COLS === 0 && height % ROWS === 0 && width / COLS === height / ROWS;
}

function verifyFile(filePath) {
  const errors = [];
  let size = null;
  try {
    size = readPngSize(fs.readFileSync(filePath));
  } catch (e) {
    errors.push("読み込めない: " + e.message);
  }
  if (!errors.length && !size) errors.push("合法な PNG ではない");
  if (size && !isGridDivisible(size.width, size.height)) {
    errors.push("寸法 " + size.width + "x" + size.height + " が 6x8 の正方格に割り切れない");
  }
  return { ok: errors.length === 0, errors: errors, size: size };
}

function loadRegistry() {
  const sandbox = { window: {}, console };
  vm.createContext(sandbox);
  vm.runInContext(
    fs.readFileSync(path.join(ROOT, "static_src", "enemy_sprite_registry.js"), "utf8"),
    sandbox,
    { filename: "enemy_sprite_registry.js" }
  );
  return sandbox.window.PriTestEnemySpriteRegistry;
}

function main() {
  const R = loadRegistry();
  if (!fs.existsSync(SPRITE_DIR)) {
    console.log("static_src/images/sprites/ がまだありません（画像0枚）。fallback で動作します。");
    process.exit(0);
  }
  const files = fs.readdirSync(SPRITE_DIR).filter(function (f) {
    return /\.png$/i.test(f);
  });
  const known = {};
  R.listSheets().forEach(function (s) {
    known[s.file] = s.id;
  });
  let fail = 0;
  files.forEach(function (f) {
    if (!known[f]) {
      console.log("  FAIL " + f + " は登録表にない名前");
      fail++;
      return;
    }
    const r = verifyFile(path.join(SPRITE_DIR, f));
    if (r.ok) console.log("  OK   " + f + " (" + r.size.width + "x" + r.size.height + ")");
    else {
      console.log("  FAIL " + f + " : " + r.errors.join(" / "));
      fail++;
    }
  });
  console.log("\n" + files.length + " 枚中 " + (files.length - fail) + " 枚が合格");
  process.exit(fail === 0 ? 0 : 1);
}

module.exports = { readPngSize: readPngSize, isGridDivisible: isGridDivisible, verifyFile: verifyFile };

if (require.main === module) main();
```

- [ ] **Step 4: 執行以確認通過**

Run: `node tools/sprite_check/sprite_verify_check.js`
Expected: 全部 OK

Run: `node tools/sprite_check/sprite_verify.js`
Expected: 印出「static_src/images/sprites/ がまだありません（画像0枚）。fallback で動作します。」，exit 0

- [ ] **Step 5: 寫 pack**

建立 `tools/sprite_check/sprite_pack.js`：

```js
// 受け入れ検査を通った sheet を「産出済み」として登録表に反映する。
//
//   node tools/sprite_check/sprite_pack.js           # 差分の件数だけ表示
//   node tools/sprite_check/sprite_pack.js --write   # 実際に書き込む
//
// 画像の切り出しは行わない——renderer は CSS の background-position で sheet から
// 直接1幀を切り出すので、切り出し済みファイルは不要（spec §6 の簡略化）。
// この工具がやるのは available フラグの更新だけ。
const fs = require("fs");
const path = require("path");
const V = require("./sprite_verify.js");

const ROOT = path.resolve(__dirname, "..", "..");
const SPRITE_DIR = path.join(ROOT, "static_src", "images", "sprites");
const REG_PATH = path.join(ROOT, "static_src", "enemy_sprite_registry.js");

const present = fs.existsSync(SPRITE_DIR)
  ? fs.readdirSync(SPRITE_DIR).filter(function (f) {
      return /\.png$/i.test(f) && V.verifyFile(path.join(SPRITE_DIR, f)).ok;
    })
  : [];

let src = fs.readFileSync(REG_PATH, "utf8");
let changed = 0;
src = src.replace(
  /\{ id: "([^"]+)", file: "([^"]+)", available: (true|false) \}/g,
  function (m, id, file, cur) {
    const next = present.indexOf(file) !== -1;
    if (String(next) !== cur) changed++;
    return '{ id: "' + id + '", file: "' + file + '", available: ' + next + " }";
  }
);

if (process.argv.indexOf("--write") === -1) {
  console.log("合格画像 " + present.length + " 枚 / 更新予定 " + changed + " 件（--write で書き込み）");
  process.exit(0);
}
fs.writeFileSync(REG_PATH, src, "utf8");
console.log("登録表を更新しました（合格 " + present.length + " 枚 / 変更 " + changed + " 件）");
```

- [ ] **Step 6: 確認 pack 在無圖時不改動任何東西**

Run: `node tools/sprite_check/sprite_pack.js`
Expected: 「合格画像 0 枚 / 更新予定 0 件（--write で書き込み）」

Run: `node tools/sprite_check/sprite_pack.js --write && git diff --stat static_src/enemy_sprite_registry.js`
Expected: `git diff --stat` 無輸出（登錄表內容未變）

- [ ] **Step 7: 註冊 npm scripts 並 commit**

在 `tools/sprite_check/package.json` 的 `scripts` 內加入這三行：

```json
    "verify": "node sprite_verify.js",
    "pack": "node sprite_pack.js --write",
    "test:verify": "node sprite_verify_check.js"
```

```bash
git add tools/sprite_check/
git commit -m "feat(sprite): 受け入れ検査と available フラグの更新工具"
```

---

### Task 6: 遊戲端 renderer 與 fallback 接線

**Files:**
- Create: `static_src/midnight_sprite.js`
- Modify: `site_src/midnight_page.py`（`extra_scripts` 新增 4 支）
- Modify: `generate.py`（靜態檔複製清單新增 4 支）
- Modify: `static_src/midnight.js`（`renderFieldEncounterPanel()` 附近，約 17900-17948 行）
- Modify: `static_src/style.css`（新增 sprite 舞台樣式）
- Test: `tools/sprite_check/sprite_renderer_check.js`

**Interfaces:**
- Consumes: Task 1 `PriTestEnemySprite`、Task 3 `PriTestEnemySpriteRegistry`。
- Produces: `window.PriTestMidnightSprite`，提供：
  - `sheetFileFor(familyId, enemyId, isBoss)` → 已產出時回檔名字串，未產出或查無回 `null`
  - `frameIndexAt(animId, elapsedMs)` → 0-based 幀索引；`loop` 動作取餘數，`hold` 動作停在最終幀，其餘超出長度回 `null`
  - `backgroundPosition(animId, frameIndex, cellPx)` → CSS `background-position` 字串
  - `mount(wrapEl)` / `showStatic()` / `showSprite(sheetFile, staticPrefix)` / `playAnim(animId, startAt)` / `tick(now)`

**fallback 契約：** `sheetFileFor()` 回 `null` 時 `renderFieldEncounterPanel()` 維持現行行為（`<img>` 顯示靜態圖）。本階段所有 sheet 皆 `available:false`，因此**實際畫面必須與改動前完全一致**。

- [ ] **Step 1: 寫失敗的檢查腳本**

建立 `tools/sprite_check/sprite_renderer_check.js`：

```js
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

console.log(fail === 0 ? "\nすべてOK" : "\n" + fail + " 件 FAIL");
process.exit(fail === 0 ? 0 : 1);
```

- [ ] **Step 2: 執行以確認失敗**

Run: `node tools/sprite_check/sprite_renderer_check.js`
Expected: FAIL，`ENOENT ... midnight_sprite.js`

- [ ] **Step 3: 寫 renderer**

建立 `static_src/midnight_sprite.js`：

```js
(function () {
  // midnight（即時制）の敵 sprite 表現層。
  // 設計文件：docs/superpowers/specs/2026-09-21-midnight-sprite-combat-design.md
  //
  // 判定層とは完全に分離している（spec §4）——ここは「今どの幀を見せるか」しか知らず、
  // 命中判定には一切関与しない。逆に判定層は enemy_sprite_data.js の hitFrame だけを
  // 読み、画像には触らない。だから画像が1枚も無くてもゲームは成立する。
  //
  // sheet からの切り出しは CSS の background-position で行う（切り出し済みファイルは
  // 作らない）。cellPx は表示枠の実寸から算出する。
  var S = window.PriTestEnemySprite;
  var R = window.PriTestEnemySpriteRegistry;

  var stageEl = null;
  var imgEl = null;
  var current = null; // { animId: string, startAt: number }
  var cellPx = 0;

  function sheetFileFor(familyId, enemyId, isBoss) {
    if (!R) return null;
    var id = isBoss ? R.sheetIdForBoss(enemyId) : R.sheetIdForEnemy(familyId, enemyId);
    if (!id) return null;
    var sheet = R.getSheet(id);
    if (!sheet || !sheet.available) return null;
    return sheet.file;
  }

  function frameIndexAt(animId, elapsedMs) {
    var a = S.getAnim(animId);
    if (!a || elapsedMs < 0) return null;
    var idx = Math.floor(elapsedMs / a.frameMs);
    if (a.loop) return idx % a.frameCount;
    if (idx >= a.frameCount) return a.hold ? a.frameCount - 1 : null;
    return idx;
  }

  function backgroundPosition(animId, frameIndex, px) {
    var a = S.getAnim(animId);
    if (!a) return "0px 0px";
    return -(frameIndex * px) + "px " + -(a.row * px) + "px";
  }

  // ---- 以下は DOM 操作。純函式部分（上）と違い check スクリプトでは検証できない
  // （Playwright が要る）。手動確認の手順は計画の Task 6 Step 6 を参照。----

  function mount(wrapEl) {
    if (!wrapEl || stageEl) return;
    imgEl = wrapEl.querySelector("#midnight-field-encounter-image");
    stageEl = wrapEl.ownerDocument.createElement("div");
    stageEl.id = "midnight-enemy-sprite-stage";
    stageEl.hidden = true;
    wrapEl.insertBefore(stageEl, wrapEl.firstChild);
  }

  function showStatic() {
    if (stageEl) stageEl.hidden = true;
    if (imgEl) imgEl.hidden = false;
    current = null;
  }

  function showSprite(sheetFile, staticPrefix) {
    if (!stageEl) return;
    stageEl.style.backgroundImage =
      "url(" + (staticPrefix || "../static/") + "images/sprites/" + sheetFile + ")";
    stageEl.hidden = false;
    if (imgEl) imgEl.hidden = true;
    // sheet は横6幀 × 縦8動作。表示枠の一辺を1格の実寸として扱う。
    cellPx = stageEl.offsetWidth || 128;
    stageEl.style.backgroundSize = S.SHEET_COLS * cellPx + "px " + S.SHEET_ROWS * cellPx + "px";
    playAnim("idle", Date.now());
  }

  function playAnim(animId, startAt) {
    if (!S.getAnim(animId)) return;
    current = { animId: animId, startAt: startAt };
  }

  function tick(now) {
    if (!stageEl || stageEl.hidden || !current) return;
    var idx = frameIndexAt(current.animId, now - current.startAt);
    if (idx === null) {
      playAnim("idle", now);
      idx = 0;
    }
    stageEl.style.backgroundPosition = backgroundPosition(current.animId, idx, cellPx);
  }

  window.PriTestMidnightSprite = {
    sheetFileFor: sheetFileFor,
    frameIndexAt: frameIndexAt,
    backgroundPosition: backgroundPosition,
    mount: mount,
    showStatic: showStatic,
    showSprite: showSprite,
    playAnim: playAnim,
    tick: tick
  };
})();
```

- [ ] **Step 4: 執行以確認通過**

Run: `node tools/sprite_check/sprite_renderer_check.js && node --check static_src/midnight_sprite.js`
Expected: 全部 OK

- [ ] **Step 5: 接線**

**5a.** 在 `site_src/midnight_page.py` 的 `extra_scripts` 中，於 `"weapon_affixes.js",` 之後、`"midnight.js",` 之前插入：

```python
            # 2026-09-21新增：敵人 sprite 動畫層。enemy_sprite_data.js（動作時間軸）と
            # enemy_sprite_registry.js（sheet 登録表）は midnight_sprite.js が module-load
            # 時点で読むので、必ずその前に置く（auto_gm.js で同じ罠を踏んだ既存の教訓、
            # 設計文件と midnight_page.py の auto_gm.js 周りの註解を参照）。
            # 画像が未産出のうちは registry の available が全て false で、
            # 既存の静止画にそのまま fallback する（設計文件 §4）。
            "enemy_sprite_data.js",
            "enemy_sprite_registry.js",
            "enemy_action_anim_map.js",
            "midnight_sprite.js",
```

**5b.** 在 `generate.py` 的靜態檔複製清單中，於 `"weapon_affixes.js",` 之後插入：

```python
        "enemy_sprite_data.js",
        "enemy_sprite_registry.js",
        "enemy_action_anim_map.js",
        "midnight_sprite.js",
```

**5c.** 在 `static_src/midnight.js` 的 `renderFieldEncounterPanel()` 中，於 `box.hidden = false;` 之後插入：

```js
    // 2026-09-21：sprite 舞台を遅延 mount（要素は encounter パネルが開いて初めて存在する）。
    if (window.PriTestMidnightSprite) {
      window.PriTestMidnightSprite.mount(el("midnight-field-encounter-image-wrap"));
    }
```

**5d.** 同函式的夜王分支，於 `imgEl.alt = bossName;` 之前插入：

```js
      // 2026-09-21：sprite が産出済みならそちらを表示、未産出なら従来どおり静止画
      // （設計文件 §4 の fallback 契約）。判定側は一切変わらない。
      var bossSheet = window.PriTestMidnightSprite
        ? window.PriTestMidnightSprite.sheetFileFor(null, trig.enemyId, true)
        : null;
      if (bossSheet) window.PriTestMidnightSprite.showSprite(bossSheet, "../static/");
      else if (window.PriTestMidnightSprite) window.PriTestMidnightSprite.showStatic();
```

**5e.** 同函式最後的一般敵人分支，於 `el("midnight-field-encounter-name").textContent = name;` 之前插入：

```js
    // 2026-09-21：同上。available:false のうちは必ず showStatic() 側に落ちる。
    var sheet = window.PriTestMidnightSprite
      ? window.PriTestMidnightSprite.sheetFileFor(trig.enemyFamilyId, trig.enemyId, false)
      : null;
    if (sheet) window.PriTestMidnightSprite.showSprite(sheet, "../static/");
    else if (window.PriTestMidnightSprite) window.PriTestMidnightSprite.showStatic();
```

**5f.** 每影格推進動畫。在 `renderStaggerOverlay()` 的**呼叫處**旁（同樣是每影格執行、不受 `lastRenderedEncounterKey` 快取影響的位置，理由見既有文件 §17.1）插入：

```js
    if (window.PriTestMidnightSprite) window.PriTestMidnightSprite.tick(now);
```

**5g.** 在 `static_src/style.css` 末尾加入：

```css
/* 敵人 sprite 舞台（2026-09-21）。sheet から background-position で1幀を切り出す。
   画像未産出のうちは hidden のままで、既存の #midnight-field-encounter-image が見える。 */
#midnight-enemy-sprite-stage {
  width: 100%;
  aspect-ratio: 1 / 1;
  background-repeat: no-repeat;
  image-rendering: pixelated;
}
```

- [ ] **Step 6: 重新建置並確認畫面完全沒有變化**

Run:
```bash
py -3 generate.py
node --check static_src/midnight.js
node tools/sprite_check/sprite_anim_check.js
node tools/sprite_check/sprite_action_map_check.js
node tools/sprite_check/sprite_registry_check.js
node tools/sprite_check/sprite_verify_check.js
node tools/sprite_check/sprite_renderer_check.js
```
Expected: 全部 exit 0

手動確認（`python -m http.server 8000 --directory dist`，瀏覽器開 `http://localhost:8000/midnight/`）：

1. 建立房間、進場、靠近任一敵人籌碼進入戰鬥
2. **敵人圖片必須跟改動前完全一樣**（靜態插圖），沒有空白、沒有破圖
3. DevTools console 沒有 `PriTestMidnightSprite` 相關的例外
4. Elements 面板中 `#midnight-enemy-sprite-stage` 存在且為 `hidden`

- [ ] **Step 7: Commit**

```bash
git add static_src/midnight_sprite.js static_src/midnight.js static_src/style.css site_src/midnight_page.py generate.py tools/sprite_check/sprite_renderer_check.js
git commit -m "feat(sprite): 敵 sprite の renderer と fallback 接線"
```

---

## 完成後的狀態

- 管線可用：prompt 產生 → 外部生成 → verify → pack → 重新建置
- 資料層齊備：8 動作時間軸、549 筆招式的動畫對照、60 組 sheet 登錄、149 隻歸屬
- renderer 就位，但因 `available` 全為 `false`，**遊戲畫面與改動前完全一致**

## 本計畫範圍外（另立計畫）

- **階段 2**：第一組實圖進來，校正單格尺寸／色階／各動作前搖在 0.4~0.7 秒內的分配（spec §12）
- **階段 3**：判定切換為動畫驅動（命中幀 × 無敵幀 0.25 秒、迴避失敗 30% 減傷、判定優先序見 spec §8.3）、方向性迴避、時鐘偏移對策（spec §8.2／§9）
- **階段 4**：60 組鋪滿
