// ============================================================================
// 敵人／夜之王 自動化GM涵蓋率稽核（暫時性 Playwright 腳本，不提交進 Git）
// ============================================================================
// 用途：列舉 enemies_data_1~4.js 的全部一般敵人，以及 night_boss_rulebook.js 的全部
// 夜之王，逐一呼叫既有的 window.PriTestAutoGm.isStructured(key) 判斷是否具備
// enemy_auto_gm_data.js／boss_auto_gm_data.js 的結構化資料（行動擲骰表→亂戰/個別
// 傷害自動算出）。沒有結構化資料的敵人，目前仍需GM自行對照規則書面板手動擲骰、
// 手動輸入傷害數值（並非完全不能戰鬥，只是「自動化GM」不會自動幫忙算傷害）。
//
// 另外交叉比對 fields_data_*.js／event_rulebook.js／night_boss_rulebook.js 決定表中
// 引用的敵人名稱字串，確認是否都能在 enemies_data 中以 Enemies.search 找到（無論該
// 分岐是否被目前10個劇本實際抽到）。
//
// 執行方式：node enemy_coverage_audit.js
// ============================================================================

const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const BASE = process.env.PRITEST_BASE_URL || "http://localhost:8791";

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on("dialog", async (d) => { await d.accept("night"); });
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));

  await page.goto(BASE + "/admin/index.html", { waitUntil: "networkidle" });
  await page.evaluate(() => window.PriTestGames.list().forEach((g) => window.PriTestGames.remove(g.id)));
  const gameId = await page.evaluate(() => window.PriTestGames.create("enemy-coverage", "tricephalos", "local").id);
  await page.goto(BASE + "/night/index.html?game=" + gameId, { waitUntil: "networkidle" });
  await page.waitForTimeout(200);

  const result = await page.evaluate(() => {
    const Enemies = window.PriTestEnemies;
    const AutoGm = window.PriTestAutoGm;
    const BossRulebook = window.PriTestBossRulebook;

    // 1) 一般敵人涵蓋率
    const allEnemies = Enemies.allEnemies();
    const enemyRows = allEnemies.map((row) => {
      const key = row.familyId + "|" + row.enemy.id + "|1";
      return {
        familyId: row.familyId,
        familyName: Enemies.localizedText(row.familyName),
        enemyId: row.enemy.id,
        name: Enemies.localizedText(row.enemy.name),
        structured: AutoGm.isStructured(key),
      };
    });

    // 2) 夜之王涵蓋率
    const bosses = BossRulebook.list().map((b) => ({
      id: b.id,
      name: Enemies.localizedText(b.name),
      structured: AutoGm.isStructured("boss|" + b.id),
    }));

    return { enemyRows, bosses, totalEnemies: allEnemies.length };
  });

  // 3) 敵人名稱引用交叉比對：掃描所有 fields_data 卡牌 branches 中「」開頭的 bullet
  //    （敵名/決定表引用行），以及各卡牌 extraTables／night_boss_rulebook 決定表列出的
  //    具體敵人名稱，逐一用 Enemies.search 檢查能否解析。
  // 使用者確認（2026-08-23，修正版）：第一版掃描了任何以「」開頭的bullet，混入大量
  // 非敵名的道具/選項/表格效果文字（如「石剣の鍵」「では選べ」等）。改為精確模擬正式
  // production code path：isCombatTriggerLine 判斷戰鬥觸發行 → collectCombatEnemyLines
  // 同款規則（bullet、depth≥trigger、以「開頭、非報酬stub）收集敵名bullet；額外決定表
  // （extraTables，含「決定表」關鍵字者，排除純flavor/reroll行）另外用同一套
  // extractLevelAndNameTokens解析。
  const refCheck = await page.evaluate(() => {
    const Fields = window.PriTestFields;
    const Enemies = window.PriTestEnemies;

    var COMBAT_TRIGGER_TITLES = [
      { ja: "ザコ戦闘", zh: "雜兵戰鬥" },
      { ja: "ボス戦闘", zh: "王戰" },
    ];
    var NUM_GAP = "[0-9０-９]?";
    function isCombatTriggerLine(line) {
      if (line.label) return false;
      var ja = (line.text && line.text.ja) || "";
      var zh = (line.text && line.text.zh) || "";
      return COMBAT_TRIGGER_TITLES.some(function (t) {
        return new RegExp("^" + t.ja + NUM_GAP + "\\s*[（(]").test(ja) || new RegExp("^" + t.zh + NUM_GAP + "（").test(zh);
      });
    }

    function collectCombatEnemyLines(lines, triggerIndex) {
      var triggerDepth = lines[triggerIndex].depth;
      var out = [];
      var j = triggerIndex + 1;
      for (; j < lines.length; j++) {
        var l = lines[j];
        if (!l.bullet || l.depth < triggerDepth) break;
        var ja = (l.text && l.text.ja) || "";
        var zh = (l.text && l.text.zh) || "";
        if (ja.indexOf("「") !== 0 && zh.indexOf("「") !== 0) break;
        var jaBracket = (/「([^」]*)」/.exec(ja) || [])[1] || "";
        var zhBracket = (/「([^」]*)」/.exec(zh) || [])[1] || "";
        if (/[:：]\s*★+\s*$/.test(jaBracket) || /[:：]\s*★+\s*$/.test(zhBracket)) break;
        out.push(l);
      }
      return out;
    }

    function extractLevelAndNameTokens(text) {
      var namePart = String(text || "").split(/[（(]/)[0];
      var tokens = [];
      namePart.split(/[＆&、，,]/).forEach(function (part) {
        var t = part.trim();
        if (t && tokens.indexOf(t) === -1) tokens.push(t);
      });
      return tokens;
    }

    var results = [];
    var seen = {};

    function checkToken(token, source) {
      if (!token) return;
      if (/決定表|決定した|決定的|下記|下述|振り直|重新擲骰/.test(token)) return;
      if (seen[token] !== undefined) return;
      var matches = Enemies.search(token);
      var ok = matches.length === 1;
      if (!ok && matches.length > 1) {
        ok = matches.some(function (m) {
          return m.enemy.name.ja === token || m.enemy.name.zh === token;
        });
      }
      seen[token] = ok;
      if (!ok) results.push({ token: token, source: source, matchCount: matches.length });
    }

    Fields.list().forEach(function (card) {
      (card.branches || []).forEach(function (branch) {
        (branch.floors || []).forEach(function (floor) {
          var lines = floor.lines || [];
          lines.forEach(function (line, idx) {
            if (!isCombatTriggerLine(line)) return;
            collectCombatEnemyLines(lines, idx).forEach(function (l) {
              var jaInner = (/「([^」]+)」/.exec((l.text && l.text.ja) || "") || [])[1] || "";
              extractLevelAndNameTokens(jaInner).forEach(function (tok) {
                checkToken(tok, card.id + " / " + (branch.name && branch.name.ja) + " / " + (floor.label && floor.label.ja));
              });
            });
          });
        });
      });
      (card.extraTables || []).forEach(function (table) {
        var titleJa = (table.title && table.title.ja) || "";
        // 「エネミー」「ボス」を含む決定表のみ対象（増大する気配決定表など非敵名系の表、
        // および夜の強敵決定表＝別セル書式・別関数resolveNightBossCombatLineで処理される
        // ものは対象外）。
        if (!/エネミー|ボス/.test(titleJa)) return;
        (table.rows || []).forEach(function (row) {
          var cell = row[1];
          if (!cell || !cell.ja) return;
          if (/振り直|重新擲骰/.test(cell.ja)) return;
          extractLevelAndNameTokens(cell.ja).forEach(function (tok) {
            checkToken(tok, card.id + " / extraTable:" + titleJa);
          });
        });
      });
    });

    return results;
  });

  console.log("=== 一般敵人 自動化GM涵蓋率 ===");
  console.log("總敵人數：", result.totalEnemies);
  const structuredCount = result.enemyRows.filter((e) => e.structured).length;
  console.log("已結構化（可自動擲骰算傷害）：", structuredCount);
  console.log("未結構化（GM需自行對照規則書手動擲骰/輸入傷害）：", result.totalEnemies - structuredCount);
  console.log("\n未結構化敵人清單：");
  result.enemyRows
    .filter((e) => !e.structured)
    .forEach((e) => console.log(" -", e.familyName, "/", e.name, "(" + e.familyId + "|" + e.enemyId + ")"));

  console.log("\n=== 夜之王 自動化GM涵蓋率 ===");
  console.log("總數：", result.bosses.length);
  result.bosses.forEach((b) => console.log(" -", b.name, "(" + b.id + ")", "=>", b.structured ? "已結構化" : "未結構化（GM手動）"));

  console.log("\n=== 敵人名稱引用交叉比對（板塊/決定表 → enemies_data） ===");
  console.log("無法比對成功的引用數：", refCheck.length);
  refCheck.forEach((r) => console.log(" -", "「" + r.token + "」", "matchCount=" + r.matchCount, "來源：", r.source));

  fs.writeFileSync(
    path.join(__dirname, "enemy-coverage-results.json"),
    JSON.stringify({ ...result, refCheck }, null, 2)
  );

  await browser.close();
})().catch((e) => {
  console.error("FATAL ERROR:", e);
  process.exit(1);
});
