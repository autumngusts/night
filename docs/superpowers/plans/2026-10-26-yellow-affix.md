# 黃牌：敵人詞綴 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 開場的一般敵人依幕數 10／20／30% 隨機帶一個通用詞綴（菁英必帶、首領不帶），共 8 種。

**Architecture:** 詞綴定義與數值放 `yellow_data.js`（`D.AFFIXES`、`D.AFFIX_NUM`、`D.AFFIX_PCT`）；`yellow_core.js` 在 `startBattle()` 的 `buildEncounter()` 之後替 `st.enemies` 抽詞綴（記在 `e.af`），效果掛在既有函式（`hitEnemy`、`effActs`、`enemyTurn`、`runEnemyAct`、`moveEnemy`、`shiftEnemy`、`swapEnemy`）；`yellow.js` 只負責顯示。

**Tech Stack:** Vanilla ES5（IIFE、`window.PriTestYellow*`），Node 跑 `tools/yellow_check/*.js`，Python `generate.py` 建置。

**Spec:** `docs/superpowers/specs/2026-10-26-yellow-affix-design.md`

## Global Constraints

- 詞綴不能借用招牌機制：`thorns`、`split`、`phase`、`ward`、`grow`、`burst`、`rally`、`drain`、`pierce`、`swap`、`steal`、`shatter`、`purge`、`curse`、`summon`。
- 不補強英雄。
- 機率 `[10, 20, 30]`（第三幕含無盡模式）；菁英必帶 1 個；首領不帶；只有開場生成的敵人會抽（召喚、分裂不帶）；每隻最多 1 個；用 `rint(st, …)`。
- 不升存檔版本 `st.v`；沒有 `e.af` 就是沒有詞綴。
- 使用者可見文字三種語言（zh／ja／en）都要有，放 `site_src/i18n_yellow.py`。
- 對使用者的說明與文件用繁體中文。

---

### Task 1：資料與核心效果

**Files:**
- Modify: `static_src/yellow_data.js`（`ENDLESS` 附近新增常數、匯出）
- Modify: `static_src/yellow_core.js`（`eref`、`hitEnemy`、`moveEnemy`、`shiftEnemy`、`spawnEnemy` 附近、`effActs`、`startBattle`、`enemyTurn`、`runEnemyAct`、`swapEnemy`）
- Test: `tools/yellow_check/core_check.js`

**Interfaces:**
- Produces：`D.AFFIXES`（陣列 `{ id, icon, name, desc }`）、`D.AFFIX`（`id → def`）、`D.AFFIX_NUM`（`{ tough: 1.5, armor: 0.5, fury: [2, 2, 3], regen: 0.1, venom: 2 }`）、`D.AFFIX_PCT = [10, 20, 30]`；
  敵人欄位 `e.af`（字串）、`e.afUsed`（不屈用過）；`Core.rollAffixes(st)`（匯出供測試）；log 種類 `afUndying`、`afAnchor`；`eref(e)` 在有詞綴時多帶 `af`。

- [ ] **Step 1：寫失敗的測試**（加在 `core_check.js`「回溯不會拿回其他回溯牌」那段之後）

```js
  // ---- 敵人詞綴（2026-10-26）----
  function afFoe(seed, af, extra) {
    var s = duo("paladin", seed);
    var list = setFoes(s.st, [Object.assign({ id: "skel", hp: 40, intent: [{ k: "atk", n: 6 }] }, extra || {})]);
    list[0].af = af;
    return { st: s.st, h: s.h, e: list[0] };
  }
  // 迅捷：攻擊次數 +1
  var sw = afFoe(301, "swift");
  assert(Core.effActs(sw.st, sw.e)[0].h === 2, "迅捷：攻擊 1 下變 2 下");
  // 不屈：第一次致命傷剩 1，第二次照常倒下
  var ud = afFoe(302, "undying");
  Core.hitEnemy(ud.st, ud.e, 999, true);
  assert(ud.e.hp === 1 && ud.e.afUsed, "不屈：剩 1 生命");
  Core.hitEnemy(ud.st, ud.e, 999, true);
  assert(ud.e.hp === 0, "不屈只觸發一次");
  // 再生：回合開始回復最大血量 10%（至少 1）
  var rg = afFoe(303, "regen", { intent: [] });
  rg.e.max = 40; rg.e.hp = 20;
  Core.enemyTurn(rg.st, rg.e);
  assert(rg.e.hp === 24, "再生：40 的 10% → +4，實際 " + rg.e.hp);
  // 毒牙：打掉生命才中毒；被護盾完全擋住不中毒
  var vn = afFoe(304, "venom");
  vn.h.blk = 0; vn.h.st.poison = 0;
  Core.runEnemyAct(vn.st, vn.e, { k: "atk", n: 6 });
  assert(vn.h.st.poison === D.AFFIX_NUM.venom, "毒牙：中毒 " + D.AFFIX_NUM.venom);
  var vb = afFoe(305, "venom");
  vb.h.blk = 99; vb.h.st.poison = 0;
  Core.runEnemyAct(vb.st, vb.e, { k: "atk", n: 6 });
  assert(vb.h.st.poison === 0, "毒牙：被護盾擋住就不中毒");
  // 穩固：推開、換區都無效
  var an = afFoe(306, "anchor", { ring: "near" });
  Core.moveEnemy(an.st, an.e, "far");
  assert(an.e.ring === "near", "穩固：不會被推開");
  var an4 = Core.create({ seed: 307, seats: [{ cls: "paladin" }, { cls: "mage" }, null, null] });
  var a4 = setFoes(an4, [{ id: "skel", hp: 40 }])[0];
  a4.af = "anchor";
  Core.shiftEnemy(an4, a4, 1);
  assert(a4.sec === 0, "穩固：不會被換區");
  // 開場抽詞綴：強韌／堅甲／狂暴在 rollAffixes 生效；首領不帶、菁英必帶、同 seed 相同
  function rollWith(seed, ids, act) {
    var s = Core.create({ seed: seed, seats: [{ cls: "paladin" }, null, null, null] });
    s.act = act || 0;
    setFoes(s, ids.map(function (id) { return { id: id, hp: 100 }; }));
    Core.rollAffixes(s);
    return s.enemies;
  }
  var bossId = D.ENEMIES.filter(function (x) { return x.boss; })[0].id;
  var eliteId = D.ENEMIES.filter(function (x) { return x.elite && !x.boss; })[0].id;
  for (var ai = 0; ai < 30; ai++) {
    var rs = rollWith(400 + ai, [bossId, eliteId, "skel"], 2);
    assert(!rs[0].af, "首領不會有詞綴");
    assert(rs[1].af && D.AFFIX[rs[1].af], "菁英一定有詞綴");
  }
  assert(JSON.stringify(rollWith(450, ["skel", "skel", "skel", "skel", "skel"], 2).map(function (x) { return x.af || ""; })) ===
         JSON.stringify(rollWith(450, ["skel", "skel", "skel", "skel", "skel"], 2).map(function (x) { return x.af || ""; })), "同 seed 抽到的詞綴相同");
  var cnt = 0, tot = 0;
  for (var aj = 0; aj < 200; aj++) rollWith(500 + aj, ["skel", "skel", "skel", "skel", "skel"], 2).forEach(function (x) { tot++; if (x.af) cnt++; });
  assert(cnt / tot > 0.2 && cnt / tot < 0.4, "第三幕約 30% 帶詞綴，實際 " + (cnt / tot).toFixed(2));
  var tg = Core.create({ seed: 601, seats: [{ cls: "paladin" }, null, null, null] });
  var tgE = setFoes(tg, [{ id: "skel", hp: 100 }])[0];
  Core.applyAffix(tg, tgE, "tough");
  assert(tgE.max === 150 && tgE.hp === 150, "強韌：血量 ×1.5");
  var ar = setFoes(tg, [{ id: "skel", hp: 100 }])[0];
  Core.applyAffix(tg, ar, "armor");
  assert(ar.blk === 50, "堅甲：護盾＝最大血量 50%");
  var fu = setFoes(tg, [{ id: "skel", hp: 100 }])[0];
  Core.applyAffix(tg, fu, "fury");
  assert(fu.str === D.AFFIX_NUM.fury[0], "狂暴：第一幕力量 +" + D.AFFIX_NUM.fury[0]);
```

- [ ] **Step 2：確認測試失敗**

Run: `node tools/yellow_check/core_check.js`
Expected: 例外，`Core.effActs(...)[0].h` 是 `undefined`（"迅捷：攻擊 1 下變 2 下"）。

- [ ] **Step 3：資料**（`yellow_data.js`，`FOE_HP` 宣告之後）

```js
  // 敵人詞綴（2026-10-26 使用者指定）：只用通用效果，不借用各敵人的招牌機制（docs/superpowers/specs/2026-10-26-yellow-affix-design.md）
  var AFFIXES = [
    { id: "tough", icon: "❤️", name: N("強韌", "強靭", "Tough"), desc: N("血量 ×1.5", "生命 ×1.5", "×1.5 HP") },
    { id: "armor", icon: "🛡️", name: N("堅甲", "堅甲", "Armored"), desc: N("開場護盾＝最大血量的 50%", "開戦時に最大生命の 50% の防御", "Starts with block equal to 50% of max HP") },
    { id: "fury", icon: "💢", name: N("狂暴", "狂暴", "Furious"), desc: N("力量 +2（第三幕起 +3）", "筋力 +2（第三幕から +3）", "+2 Strength (+3 from Act III)") },
    { id: "swift", icon: "⚡", name: N("迅捷", "迅速", "Swift"), desc: N("攻擊次數 +1", "攻撃回数 +1", "+1 hit on every attack") },
    { id: "regen", icon: "💚", name: N("再生", "再生", "Regenerating"), desc: N("每回合開始回復最大血量的 10%（至少 1）", "毎ターン開始時に最大生命の 10% 回復（最低 1）", "Heals 10% of max HP at the start of each turn (min 1)") },
    { id: "undying", icon: "🩹", name: N("不屈", "不屈", "Undying"), desc: N("第一次受到致命傷時剩 1 生命", "初めて致命傷を受けたとき生命 1 で耐える", "Survives the first lethal hit with 1 HP") },
    { id: "venom", icon: "🐍", name: N("毒牙", "毒牙", "Venomous"), desc: N("攻擊打掉生命時，英雄中毒 2", "攻撃で生命を削ると英雄に毒 2", "Attacks that deal HP damage inflict 2 Poison") },
    { id: "anchor", icon: "⚓", name: N("穩固", "不動", "Anchored"), desc: N("不會被推開、拉近或換區", "押し出し・引き寄せ・移動を受けない", "Can't be pushed, pulled or moved to another sector") }
  ];
  var AFFIX_NUM = { tough: 1.5, armor: 0.5, fury: [2, 2, 3], regen: 0.1, venom: 2 };
  var AFFIX_PCT = [10, 20, 30];   // 一般敵人帶詞綴的機率（第一／二／三幕，無盡模式照第三幕）
```

匯出（`FOE_HP: FOE_HP,` 那一行後面加）：

```js
    AFFIXES: AFFIXES, AFFIX: index(AFFIXES), AFFIX_NUM: AFFIX_NUM, AFFIX_PCT: AFFIX_PCT,
```

- [ ] **Step 4：核心**（`yellow_core.js`）

`eref`：

```js
  function eref(e) { var r = { k: "e", id: e.id, u: e.u }; if (e.af) r.af = e.af; return r; }
```

`hitEnemy` 在 `var dmg = amount - absorbed;` 之後：

```js
    // 不屈（詞綴）：第一次致命傷剩 1 生命
    if (e.af === "undying" && !e.afUsed && dmg >= e.hp) { dmg = e.hp - 1; e.afUsed = true; log(st, { t: "afUndying", to: eref(e) }); }
```

`moveEnemy` 開頭的 `if (...) return;` 之後、`shiftEnemy` 的 `if (...) return;` 之後各加：

```js
    if (e.af === "anchor") { log(st, { t: "afAnchor", to: eref(e) }); return; }
```

`swapEnemy(st, x)` 開頭加：

```js
    if (x.af === "anchor") { log(st, { t: "afAnchor", to: eref(x) }); return; }
```

`effActs` 最後的 `return acts;` 改成：

```js
    // 迅捷（詞綴）：攻擊次數 +1
    if (e.af === "swift") return acts.map(function (a) { return a.k === "atk" ? swiftAtk(a) : a; });
    return acts;
```

並在 `effActs` 前加：

```js
  function swiftAtk(a) { var b = {}; Object.keys(a).forEach(function (k) { b[k] = a[k]; }); b.h = (a.h || 1) + 1; return b; }
```

（魅惑那一行回傳的 `charm` 行動也要吃迅捷：把 `{ k: "charm", n: a.n, h: a.h }` 改成 `{ k: "charm", n: a.n, h: (a.h || 1) + (e.af === "swift" ? 1 : 0) }`。）

`spawnEnemy` 之後新增：

```js
  // ---- 敵人詞綴（2026-10-26 使用者指定，見 D.AFFIXES）----
  function applyAffix(st, e, id) {
    e.af = id;
    var N2 = D.AFFIX_NUM;
    if (id === "tough") { e.max = Math.round(e.max * N2.tough); e.hp = e.max; }
    else if (id === "armor") e.blk += Math.floor(e.max * N2.armor);
    else if (id === "fury") e.str += N2.fury[actOf(st)];
  }
  // 開場的敵人抽詞綴：首領不帶、菁英必帶、一般敵人依幕數機率（只在開戰時呼叫，召喚與分裂不會帶）
  function rollAffixes(st) {
    st.enemies.forEach(function (e) {
      var d = D.ENEMY[e.id];
      if (!d || d.boss) return;
      if (!d.elite && rint(st, 100) >= D.AFFIX_PCT[actOf(st)]) return;
      applyAffix(st, e, pick(st, D.AFFIXES).id);
    });
  }
```

`startBattle` 的 `buildEncounter(st, kind);` 後面加 `rollAffixes(st);`（在苦痛修正之前）。

`enemyTurn` 的 `e.blk = 0;` 之後：

```js
    // 再生（詞綴）：每回合開始回復最大血量的 10%（至少 1）
    if (e.af === "regen" && e.hp < e.max) {
      var rv = Math.min(e.max - e.hp, Math.max(1, Math.floor(e.max * D.AFFIX_NUM.regen)));
      e.hp += rv; log(st, { t: "heal", to: eref(e), n: rv, src: eref(e) });
    }
```

`runEnemyAct` 攻擊中 `var lost = hitHero(st, h, hv, !!act.pierce, e);` 之後：

```js
            // 毒牙（詞綴）：打掉生命才中毒
            if (e.af === "venom" && lost > 0 && !h.down) {
              h.st.poison = (h.st.poison || 0) + D.AFFIX_NUM.venom;
              log(st, { t: "st", to: href(h), s: "poison", n: D.AFFIX_NUM.venom, src: eref(e) });
            }
```

匯出（`_rnd: rnd` 前）加 `rollAffixes: rollAffixes, applyAffix: applyAffix,`；若 `hitEnemy`、`enemyTurn`、`runEnemyAct`、`moveEnemy`、`shiftEnemy` 尚未匯出也一併加入。

- [ ] **Step 5：確認測試通過**

Run: `node tools/yellow_check/core_check.js`
Expected: 最後一行 `OK 60 局`，exit 0。若既有測試因為隨機抽到詞綴而失敗，在該測試的敵人上把 `af` 刪掉並加註解（同三枚貝殼測試把 `wk` 固定回 1 的做法）。

- [ ] **Step 6：Commit**

```bash
git add static_src/yellow_data.js static_src/yellow_core.js tools/yellow_check/core_check.js
git commit -m "feat(yellow): 敵人詞綴核心（8 種通用詞綴、依幕數機率）"
```

（注意：工作目錄裡還有尚未 commit 的平衡修改也在這三個檔案裡，會一起進這個 commit；commit 訊息要一併寫上：數量曲線、單隻倍率、控制卡強化、取消洗牌限制。）

---

### Task 2：畫面與文字

**Files:**
- Modify: `static_src/yellow.js`（`enemyName` 附近、`enemyMech`、`enemyEl` 的 title、焦點面板標題、`refName`、`legend` 的 `yc_legend_sec_mech`）
- Modify: `site_src/i18n_yellow.py`（三種語言各在 `yc_legend_stunImm` 後面加）

**Interfaces:**
- Consumes：`e.af`、`r.af`（log ref）、`D.AFFIX[id]`、log 種類 `afUndying`、`afAnchor`。
- Produces：`enemyLabel(e)`（`yellow.js` 內部）。

- [ ] **Step 1：i18n**（zh／ja／en）

```python
    "yc_af_name": "{af}的{name}",
    "yc_legend_sec_af": "詞綴（一般敵人第一／二／三幕 10／20／30% 帶一個，菁英必帶，首領不帶）",
    "yc_log_afUndying": "{to} 不屈：剩下 1 生命",
    "yc_log_afAnchor": "{to} 穩固：沒有被移動",
```

```python
    "yc_af_name": "{af}{name}",
    "yc_legend_sec_af": "詞綴（通常の敵は第一／二／三幕で 10／20／30% の確率で一つ、エリートは必ず一つ、ボスはなし）",
    "yc_log_afUndying": "{to} 不屈：生命 1 で耐えた",
    "yc_log_afAnchor": "{to} 不動：動かされない",
```

```python
    "yc_af_name": "{af} {name}",
    "yc_legend_sec_af": "Affixes (normal enemies: 10/20/30% in Acts I/II/III, elites always have one, bosses never)",
    "yc_log_afUndying": "{to} is Undying: holds on at 1 HP",
    "yc_log_afAnchor": "{to} is Anchored and doesn't move",
```

- [ ] **Step 2：`yellow.js`**

`enemyName` 後面：

```js
  // 詞綴（2026-10-26）：名稱前加詞綴名，例如「狂暴的骷髏兵」
  function affixName(af, name) { var a = af && D.AFFIX[af]; return a ? t("yc_af_name", { af: L(a.name), name: name }) : name; }
  function enemyLabel(e) { return affixName(e.af, enemyName(e.id)); }
```

`enemyMech` 的 `return out;` 前：

```js
    if (e.af && D.AFFIX[e.af]) { var af = D.AFFIX[e.af]; out.unshift({ icon: af.icon, on: !(e.af === "undying" && e.afUsed), title: L(af.name) + "：" + L(af.desc) }); }
```

`enemyEl` 的 title、焦點面板的 `el("strong", { text: enemyName(e.id) })` 改用 `enemyLabel(e)`。
`refName` 的敵人分支改成 `D.ENEMY[r.id].icon + affixName(r.af, enemyName(r.id))`。
`legend` 在 `yc_legend_sec_mech` 那個 `sec(...)` 後面加：

```js
      , sec("yc_legend_sec_af", D.AFFIXES.map(function (a) { return [a.icon, L(a.name) + "：" + L(a.desc)]; }))
```

- [ ] **Step 3：驗證**

Run: `node --check static_src/yellow.js && python generate.py`
Expected: 沒有錯誤；`dist/static/i18n.js` 含 `yc_af_name`。

Run: `node tools/yellow_check/ui_check.js` 與 `node tools/yellow_check/feature_check.js`（需要先 `python -m http.server 8000 --directory dist`，依腳本開頭說明）
Expected: 跟改動前一樣通過。

- [ ] **Step 4：Commit**

```bash
git add static_src/yellow.js site_src/i18n_yellow.py
git commit -m "feat(yellow): 詞綴的名稱、圖示、標記說明與戰鬥紀錄"
```

---

### Task 3：文件、平衡、瀏覽器確認

**Files:**
- Modify: `docs/yellow_card_design.md`（「敵人的特殊機制」一節後新增「詞綴」）

- [ ] **Step 1：設計文件**：新增「## 詞綴（2026-10-26 使用者指定）」，貼上規格的詞綴表與出現規則表，註明數值在 `D.AFFIX_NUM`／`D.AFFIX_PCT`、狀態欄位 `e.af`／`e.afUsed`、測試在 `core_check.js`。

- [ ] **Step 2：平衡**

Run: `node tools/yellow_check/balance_check.js 40`
Expected: 和目前（1 人 45%／2 人 73%／3 人 58%／4 人 60%，整體 59%）比較。整體掉到 50% 以下時，先調 `D.AFFIX_PCT` 或 `D.AFFIX_NUM`，不補強英雄，然後重跑。

- [ ] **Step 3：瀏覽器**：`python generate.py`、`python -m http.server 8000 --directory dist`，開黃牌本機模式打到第二幕，確認：敵人名稱有詞綴前綴、圖示列有詞綴圖示且說明正確、標記說明有「詞綴」一節、戰鬥紀錄有不屈／穩固文字；手機寬度（390px）沒有橫向捲動。

- [ ] **Step 4：Commit**

```bash
git add docs/yellow_card_design.md
git commit -m "docs(yellow): 詞綴規則與平衡結果"
```
