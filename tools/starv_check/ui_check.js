// ============================================================================
// 明星經紀 starV Playwright 流程檢查：
//   開業 → 招募十連 → 藝人詳情排行程 → 多選套用方針 → 接工作 → 組合 → 存檔匯出入 → 日誌 → 離線報告
//   → 三種語言沒有漏翻的 sv_ 鍵 → 手機寬度沒有水平捲動 → 截圖
// 前置：
//   1. py -3 generate.py
//   2. py -3 -m http.server 8946 --directory dist
// 執行：node tools/starv_check/ui_check.js
// 這頁每秒重畫，按鈕一律用 dispatchEvent 觸發（CLAUDE.md §4.6）。
// ============================================================================
"use strict";
var path = require("path");
var os = require("os");
var fs = require("fs");
var assert = require("assert");
var chromium = require(require.resolve("playwright", { paths: [path.join(__dirname, "..", "midnight_check")] })).chromium;

var BASE = process.env.STARV_BASE || "http://localhost:8946/starv/index.html?debug=1";
var SHOT_DIR = process.env.STARV_SHOTS || path.join(__dirname, "shots");

function st(page) { return page.evaluate(function () { return JSON.parse(JSON.stringify(window.PriTestStarv.state())); }); }
async function act(page, name) {
  await page.waitForSelector('[data-act="' + name + '"]', { state: "attached", timeout: 5000 });
  await page.dispatchEvent('[data-act="' + name + '"]', "click");
}
async function tab(page, id) {
  await page.dispatchEvent('.sv-tab[data-tab="' + id + '"]', "click");
  await page.waitForSelector('.sv-tab.sv-on[data-tab="' + id + '"]');
}
async function noRawKeys(page, where) {
  var raw = await page.evaluate(function () { return (document.querySelector(".sv-root").innerText.match(/sv_[a-zA-Z0-9_]+/g) || []); });
  assert.deepStrictEqual(raw, [], where + " 有漏翻的鍵：" + raw.join(","));
}
async function shot(page, name) {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(SHOT_DIR, name + ".png"), fullPage: true });
}

// 處理掉畫面上所有待處理的事件（一律選預設選項），避免事件卡擋住後面的步驟
async function clearEvents(page) {
  for (var i = 0; i < 6; i++) {
    var pending = await page.evaluate(function () { var s = window.PriTestStarv.state(); return s && s.events ? s.events.pending.length : 0; });
    if (!pending) return;
    if (!(await page.$(".sv-event"))) await act(page, "event-bell");
    await page.dispatchEvent(".sv-event [data-default]", "click");
    await act(page, "event-result-close");
  }
}
// 隨機事件會讓流程不穩定：測試時關掉每日隨機事件（條件事件照常），重新整理後要再設一次
async function quietEvents(page) {
  await page.evaluate(function () { if (window.PriTestStarvData) window.PriTestStarvData.BAL.eventDailyChance = 0; });
}

var steps = [];
function step(name, fn) { steps.push([name, fn]); }

step("開業畫面 → 建立公司", async function (page) {
  await page.waitForSelector(".sv-welcome input");
  await noRawKeys(page, "開業畫面");
  await page.fill(".sv-welcome input", "測試經紀");
  await act(page, "start");
  await page.waitForSelector(".sv-top");
  var s = await st(page);
  assert.strictEqual(s.company.name, "測試經紀");
  assert.strictEqual(s.company.tickets, 10);
  await noRawKeys(page, "頂部列");
});

step("招募：星探券十連 → 翻卡 → 入社", async function (page) {
  await tab(page, "gacha");
  await noRawKeys(page, "招募分頁");
  await act(page, "pull-ticket-10");
  await page.waitForSelector(".sv-reveal");
  await act(page, "reveal-skip");
  await act(page, "reveal-done");
  // 抽到新 SSR 會接著出現全螢幕介紹
  for (var i = 0; i < 10 && await page.$('[data-act="spot-done"]'); i++) await act(page, "spot-done");
  var s = await st(page);
  assert.strictEqual(s.company.tickets, 0, "券用完");
  // 宿舍 Lv1 上限 5 人，其餘進候補；抽到重複的 SR/SSR 會變成突破，所以總人數可能少於 10
  assert.ok(s.artists.length >= 1 && s.artists.length <= 5, "入社人數 " + s.artists.length);
  assert.ok(s.artists.length + s.waitlist.length <= 10, "入社＋候補不超過抽數");
  await noRawKeys(page, "招募結果後");
});

step("藝人：卡片 → 詳情 → 安排訓練", async function (page) {
  await tab(page, "artists");
  await noRawKeys(page, "藝人分頁");
  var s = await st(page);
  assert.strictEqual(await page.$$eval(".sv-acard", function (x) { return x.length; }), s.artists.length, "卡片數");
  var aid = s.artists[0].id;
  await page.dispatchEvent('.sv-acard[data-aid="' + aid + '"]', "click");
  await page.waitForSelector(".sv-modal-detail");
  await noRawKeys(page, "藝人詳情");
  await act(page, "do-train");
  s = await st(page);
  assert.strictEqual(s.artists[0].task && s.artists[0].task.kind, "train");
  await act(page, "modal-close");
});

step("藝人：多選套用方針", async function (page) {
  await act(page, "select-mode");
  var s = await st(page);
  var ids = s.artists.slice(1).map(function (a) { return a.id; });
  for (var i = 0; i < ids.length; i++) await page.dispatchEvent('.sv-acard[data-aid="' + ids[i] + '"]', "click");
  await page.selectOption('[data-act="batch-policy-select"]', "balance");
  await act(page, "batch-policy");
  s = await st(page);
  s.artists.slice(1).forEach(function (a) { assert.strictEqual(a.policy, "balance", a.id); });
  assert.strictEqual(s.artists[0].policy, "idle", "沒選的不變");
  await act(page, "select-mode");
});

step("工作：選角 → 簽約", async function (page) {
  await tab(page, "jobs");
  await noRawKeys(page, "工作分頁");
  var pickJob = function () {
    return page.evaluate(function () {
      var s = window.PriTestStarv.state();
      var j = s.board.filter(function (x) { return x.slots === 1 && x.minFame === 0; })[0];
      return j ? j.id : null;
    });
  };
  var jobId = await pickJob();
  // 看板上偶爾沒有 D 級單人工作：快轉 7 天讓看板刷新（App.skip 在 Task 4 就有）
  for (var i = 0; i < 5 && !jobId; i++) { await page.evaluate(function () { window.PriTestStarv.app.skip(7); }); jobId = await pickJob(); }
  assert.ok(jobId, "看板上沒有 D 級單人工作");
  await page.dispatchEvent('.sv-job[data-job="' + jobId + '"]', "click");
  await page.waitForSelector(".sv-cast-row");
  await noRawKeys(page, "選角");
  await page.dispatchEvent(".sv-cast-row:not(.sv-dis)", "click");
  await act(page, "cast-sign");
  // 簽約成功後不該跳出「工作已經不在看板上」的錯誤提示（2026-10-27 修正 live 彈窗重畫順序）
  assert.ok(!(await page.$(".sv-toast-bad")), "簽約後出現錯誤提示");
  var s = await st(page);
  assert.ok(s.activeJobs.some(function (aj) { return aj.job.id === jobId; }), "工作進行中");
});

step("工作：結成組合", async function (page) {
  await act(page, "jobs-sub-groups");
  await noRawKeys(page, "組合");
  await page.fill('[data-act="group-name"]', "星光少女");
  var ids = await page.$$eval(".sv-group-pick input[data-aid]", function (xs) { return xs.slice(0, 2).map(function (x) { return x.getAttribute("data-aid"); }); });
  assert.strictEqual(ids.length, 2, "至少要有兩位可選的藝人");
  for (var i = 0; i < ids.length; i++) await page.check('.sv-group-pick input[data-aid="' + ids[i] + '"]');
  await act(page, "group-create");
  var s = await st(page);
  assert.strictEqual(s.groups.length, 1); assert.strictEqual(s.groups[0].name, "星光少女");
  await act(page, "jobs-sub-board");
});

step("公司：匯出 → 匯入 → 名稱一致", async function (page) {
  await tab(page, "company");
  await noRawKeys(page, "公司分頁");
  await act(page, "save-export");
  var code = await page.$eval('[data-act="save-code"]', function (x) { return x.value; });
  assert.ok(code.indexOf("SV1.") === 0, "匯出字串");
  await page.fill('[data-act="save-import-text"]', code);
  await act(page, "save-import");
  await act(page, "save-import-confirm");
  var s = await st(page);
  assert.strictEqual(s.company.name, "測試經紀");
});

step("debug：快轉 30 天 → 日誌有紀錄", async function (page) {
  var d0 = (await st(page)).day;
  await act(page, "debug-skip-30");
  var s = await st(page);
  // 主迴圈每秒也可能推進一天，所以用 ≥ 比較
  assert.ok(s.day >= d0 + 30 && s.day <= d0 + 31, "日期 " + d0 + " → " + s.day);
  assert.ok(s.log.some(function (e) { return e.type === "month_end"; }), "有月結");
  await act(page, "log-toggle");
  await page.waitForSelector(".sv-log-panel .sv-log-line");
  await noRawKeys(page, "日誌");
  await act(page, "log-toggle");
});

step("離線報告：回到 10 天前 → 跳出報告", async function (page) {
  await page.evaluate(function () { window.PriTestStarv.state().lastTickAt -= 10 * 60000; });
  await page.waitForSelector(".sv-report", { timeout: 5000 });
  await noRawKeys(page, "離線報告");
  await act(page, "report-close");
});

step("重新整理後從存檔繼續", async function (page) {
  var before = await st(page);
  await page.reload();
  await page.waitForSelector(".sv-top");
  await quietEvents(page);
  var s = await st(page);
  assert.strictEqual(s.company.name, before.company.name);
  assert.ok(s.day >= before.day, "日期不會倒退");
  assert.strictEqual(s.artists.length, before.artists.length);
});

step("三種語言：各分頁沒有漏翻、手機寬度沒有水平捲動", async function (page) {
  var tabs = ["artists", "jobs", "projects", "industry", "gacha", "hall", "company"];
  var langs = ["ja", "en", "zh"];
  for (var i = 0; i < langs.length; i++) {
    await page.dispatchEvent('.lang-btn[data-lang="' + langs[i] + '"]', "click");
    for (var j = 0; j < tabs.length; j++) {
      await tab(page, tabs[j]);
      await noRawKeys(page, langs[i] + " / " + tabs[j]);
      var over = await page.evaluate(function () { return document.documentElement.scrollWidth - window.innerWidth; });
      assert.ok(over <= 0, langs[i] + " / " + tabs[j] + " 水平溢出 " + over + "px");
      if (langs[i] === "zh") await shot(page, "tab-" + tabs[j]);
    }
  }
  var aid = (await st(page)).artists[0].id;
  await tab(page, "artists");
  await page.dispatchEvent('.sv-acard[data-aid="' + aid + '"]', "click");
  await page.waitForSelector(".sv-modal-detail");
  await page.waitForTimeout(400);   // 等彈窗的淡入動畫結束再截圖
  await shot(page, "artist-detail");
  await act(page, "modal-close");
});

step("事件：觸發 → 鈴鐺 → 選擇 → 結果", async function (page) {
  await page.evaluate(function () {
    var App = window.PriTestStarv.app;
    App.act(function (s) { window.PriTestStarvCore.triggerEvent(s, "charity", s.artists[0].id); });
  });
  await page.waitForSelector(".sv-event");
  await noRawKeys(page, "事件卡");
  await act(page, "modal-close");
  await act(page, "event-bell");
  await page.waitForSelector(".sv-event");
  var rep0 = (await st(page)).company.rep;
  await act(page, "event-choice-0");
  await page.waitForSelector('[data-act="event-result-close"]');
  await noRawKeys(page, "事件結果");
  await act(page, "event-result-close");
  var s = await st(page);
  assert.strictEqual(s.events.pending.length, 0);
  assert.ok(s.company.rep >= rep0 + 40, "聲望 +40");
});

step("公司：升級宿舍", async function (page) {
  await tab(page, "company");
  await act(page, "debug-money");
  await act(page, "fac-up-dorm");
  var s = await st(page);
  assert.strictEqual(s.facilities.dorm, 2);
  await noRawKeys(page, "設施");
});

step("業界：本季趨勢與傳聞", async function (page) {
  await tab(page, "industry");
  await noRawKeys(page, "業界分頁");
  var n = await page.$$eval(".sv-trend-hot", function (x) { return x.length; });
  assert.ok(n >= 2, "熱門方向 " + n);
  assert.ok(await page.$(".sv-trend-cold"), "低迷方向");
  assert.ok(await page.$(".sv-trend-rumor"), "下季傳聞");
});

step("工作：試鏡制與對手有興趣的標示", async function (page) {
  await page.evaluate(function () {
    window.PriTestStarv.app.act(function (s) {
      var C = window.PriTestStarvCore;
      var j = C._genJob(s, { tier: "C" }); j.audition = true; j.interest = s.rivals[0].id; s.board.unshift(j);
    });
  });
  await tab(page, "jobs");
  await page.waitForSelector(".sv-chip-audition");
  await page.waitForSelector(".sv-chip-interest");
  await noRawKeys(page, "試鏡標示");
});

step("業界：對手公司與排行榜", async function (page) {
  await page.evaluate(function () { window.PriTestStarv.app.act(function (s) { window.PriTestStarvCore.updateCharts(s); }); });
  await tab(page, "industry");
  var n = await page.$$eval(".sv-rival", function (x) { return x.length; });
  assert.strictEqual(n, 5, "對手卡數");
  await page.waitForSelector(".sv-chart li");
  await act(page, "chart-popularity");
  await noRawKeys(page, "業界：對手與排行榜");
});

step("頒獎典禮：舉辦 → 自動播放 → 跳過 → 重看", async function (page) {
  await tab(page, "company");
  await act(page, "debug-awards");
  await page.waitForSelector(".sv-ceremony");
  await noRawKeys(page, "典禮");
  await act(page, "ceremony-next");
  await act(page, "ceremony-skip");
  await page.waitForSelector('[data-act="ceremony-close"]');
  await noRawKeys(page, "典禮結果");
  await act(page, "ceremony-close");
  var s = await st(page);
  assert.strictEqual(s.awards.unseen, null, "看完清掉 unseen");
  await tab(page, "industry");
  await act(page, "ceremony-replay-" + s.awards.history[0].year);
  await page.waitForSelector(".sv-ceremony");
  await act(page, "ceremony-skip");
  await act(page, "ceremony-close");
});

step("生涯：藝人詳情的合約與獎座、引退紀念", async function (page) {
  var aid = (await st(page)).artists[0].id;
  await tab(page, "artists");
  await page.dispatchEvent('.sv-acard[data-aid="' + aid + '"]', "click");
  await page.waitForSelector(".sv-modal-detail .sv-trophies");
  await noRawKeys(page, "藝人詳情（生涯）");
  await act(page, "modal-close");
  await page.evaluate(function (id) { window.PriTestStarv.app.act(function (s) { window.PriTestStarvCore.retireArtist(s, id); }); }, aid);
  await page.waitForSelector(".sv-retire");
  await noRawKeys(page, "引退紀念");
  await act(page, "retire-close");
  var s = await st(page);
  assert.strictEqual(s.retireQueue.length, 0, "看完清掉");
  assert.ok(!s.artists.some(function (a) { return a.id === aid; }), "已引退");
});

step("殿堂：圖鑑、成就、名人堂聘請、新紀元", async function (page) {
  await tab(page, "hall");
  await noRawKeys(page, "殿堂：名人堂");
  for (var k of ["codex", "ach", "timeline", "era", "hall"]) { await act(page, "hall-sub-" + k); await noRawKeys(page, "殿堂：" + k); }
  var hof = await page.evaluate(function () {
    var A = window.PriTestStarv.app;
    return A.act(function (s) {
      s.company.level = 10;
      s.hall.push({ id: "h_ui", era: s.era, day: s.day, rosterId: null, nameSeed: 42, gender: "f", rarity: "R", dir: "singer", age: 40, years: 10, works: 80, best: null, trophies: [{ award: "singer_f", year: 1 }], fame: 1000, look: s.artists[0].look, score: 50, hof: true });
      return "h_ui";
    });
  });
  await page.waitForSelector('[data-act="hire-' + hof + '"]');
  await act(page, "hire-" + hof);
  var s = await st(page);
  assert.strictEqual(s.staff.length, 1, "聘請");
  await act(page, "hall-sub-era");
  await act(page, "era-start");
  await act(page, "era-confirm");
  s = await st(page);
  assert.strictEqual(s.era, 2, "進入第 2 紀元");
  assert.ok(s.hall.some(function (h) { return h.id === "h_ui"; }), "名人堂保留");
  await noRawKeys(page, "新紀元之後");
});

step("企劃：開始 → 派遣 → 完成結算", async function (page) {
  await page.evaluate(function () {
    window.PriTestStarv.app.act(function (s) {
      s.company.level = Math.max(s.company.level, 5); s.company.money = 1e7; s.events.pending = [];
      // 前一個步驟開了新紀元（不帶人），先補幾位藝人
      while (s.artists.length < 5) s.artists.push(window.PriTestStarvCore._genR(s));
      s.artists.forEach(function (a) { a.task = null; a.dir = "host"; window.PriTestStarvData.STATS.forEach(function (k) { a.stats[k] = 600; a.caps[k] = 999; }); });
    });
  });
  await tab(page, "projects");
  await noRawKeys(page, "企劃分頁");
  await act(page, "proj-start-own_variety");
  for (var stage = 0; stage < 3; stage++) {
    await clearEvents(page);
    await page.waitForSelector(".sv-proj-pick input[data-aid]");
    var ids = await page.$$eval(".sv-proj-pick input[data-aid]", function (xs) { return xs.map(function (x) { return x.getAttribute("data-aid"); }); });
    var need = await page.evaluate(function () { var s = window.PriTestStarv.state(); return window.PriTestStarvData.PROJECT_BY_ID[s.project.id].stages[s.project.stage].slots[0]; });
    for (var i = 0; i < need; i++) await page.check('.sv-proj-pick input[data-aid="' + ids[i] + '"]');
    await act(page, "proj-assign");
    await noRawKeys(page, "企劃進行中");
    await page.evaluate(function () { window.PriTestStarv.app.skip(30); });
  }
  await clearEvents(page);
  await page.waitForSelector(".sv-proj-result");
  await noRawKeys(page, "企劃結算");
  await act(page, "proj-result-close");
  var s = await st(page);
  assert.strictEqual(s.project, null); assert.strictEqual(s.projectQueue.length, 0); assert.strictEqual(s.stats.projects, 1);
});

step("3D：three.js 不在初始載入、網址可以取得", async function (page) {
  assert.strictEqual(await page.evaluate(function () { return typeof window.THREE; }), "undefined", "初始不載入 three.js");
  var src = await page.$eval("#sv-app", function (x) { return x.getAttribute("data-three-src"); });
  assert.ok(/vendor\/three\.min\.js\?v=/.test(src), "data-three-src：" + src);
  var ok = await page.evaluate(function (u) { return fetch(u).then(function (r) { return r.ok; }); }, src);
  assert.ok(ok, "three.min.js 可以下載");
});

async function playStage(page, opts) {
  await page.evaluate(function (o) {
    var s = window.PriTestStarv.state(), a = s.artists[0] || window.PriTestStarvCore._genR(s);
    o.performers = [{ look: a.look, rarity: a.rarity, gender: a.gender, name: "測試" }];
    window.__stageDone = false;
    window.PriTestStarvStage3D.play(o).then(function () { window.__stageDone = true; });
  }, opts);
}

step("3D：播放演出（WebGL）→ 跳過 → 結果字卡 → 關閉", async function (page) {
  var webgl = await page.evaluate(function () { return window.PriTestStarvStage3D.available(); });
  await playStage(page, { dir: "singer", kind: "job", title: "單曲〈測試〉", result: "great", stars: 5, duration: 4 });
  await page.waitForSelector(webgl ? ".sv-stage canvas" : ".sv-stage-2d", { timeout: 15000 });
  if (webgl) assert.strictEqual(await page.evaluate(function () { return typeof window.THREE; }), "object", "播放時載入 three.js");
  await page.waitForTimeout(1500);
  await shot(page, "stage-3d");
  await noRawKeys(page, "演出中");
  await act(page, "stage-skip");
  await page.waitForSelector(".sv-stage-end");
  await noRawKeys(page, "結果字卡");
  await act(page, "stage-close");
  await page.waitForFunction(function () { return window.__stageDone; });
});

step("3D：畫質關閉時用 2D 後備", async function (page) {
  await page.evaluate(function () { window.PriTestStarvStage3D.setQuality("off"); });
  await playStage(page, { dir: "model", kind: "job", title: "測試", result: "success", stars: 4, duration: 3 });
  await page.waitForSelector(".sv-stage-2d");
  await page.waitForTimeout(800);   // 等彈窗淡入結束再截圖
  await shot(page, "stage-2d");
  await act(page, "stage-skip");
  await act(page, "stage-close");
  await page.waitForFunction(function () { return window.__stageDone; });
  await page.evaluate(function () { window.PriTestStarvStage3D.setQuality("high"); });
});

step("3D：A 級工作完成自動播放、作品重看", async function (page) {
  await page.evaluate(function () {
    var A = window.PriTestStarv.app, s = A.st(), a = s.artists[0];
    a.works.unshift({ title: [0, 0], dir: "film", tier: "A", role: "lead", result: "great", stars: 5, day: s.day, isWork: true, pay: 1 });
    window.PriTestStarvStageUI.onLogs(A, { days: 1, logs: [{ seq: 0, day: s.day, type: "job_done", data: { aids: [a.id], dir: "film", tier: "A", title: [0, 0], result: "great", pay: 1, stars: 5 } }] });
  });
  await page.waitForSelector(".sv-stage-modal", { timeout: 10000 });
  await act(page, "stage-skip");
  await act(page, "stage-close");
  var aid = (await st(page)).artists[0].id;
  await tab(page, "artists");
  await page.dispatchEvent('.sv-acard[data-aid="' + aid + '"]', "click");
  await page.waitForSelector(".sv-modal-detail");
  await act(page, "replay-0");
  await page.waitForSelector(".sv-stage-modal", { timeout: 10000 });
  await act(page, "stage-skip");
  await act(page, "stage-close");
  await tab(page, "company");
  await page.selectOption('[data-act="stage-quality"]', "low");
  assert.strictEqual(await page.evaluate(function () { return window.PriTestStarvStage3D.quality(); }), "low");
  await page.selectOption('[data-act="stage-quality"]', "high");
  await noRawKeys(page, "畫質設定");
});

step("雲端：未啟用時不載入 Firebase、雲端卡可用、ID 不合法時提示", async function (page) {
  assert.strictEqual(await page.evaluate(function () {
    return !!document.querySelector('script[src*="firebasejs"]');
  }), false, "未啟用雲端時不載入 Firebase SDK");
  await tab(page, "company");
  await page.waitForSelector(".sv-cloud [data-act=\"cloud-enable\"]");
  await page.fill('[data-act="cloud-id-input"]', "not-an-id");
  await page.dispatchEvent('[data-act="cloud-id-input"]', "input");
  await act(page, "cloud-connect");
  await page.waitForSelector(".sv-toast-bad");
  assert.strictEqual(await page.evaluate(function () { return window.PriTestStarv.app.readOnly(); }), false);
  await noRawKeys(page, "雲端卡");
});

step("成就：設為稱號 → 頂部列顯示 → 取消", async function (page) {
  await tab(page, "hall");
  await act(page, "hall-sub-ach");
  var id = await page.evaluate(function () { return Object.keys(window.PriTestStarv.state().achievements)[0]; });
  assert.ok(id, "已有達成的成就");
  await act(page, "title-" + id);
  await page.waitForSelector(".sv-chip-title");
  assert.strictEqual((await st(page)).title, id);
  await noRawKeys(page, "稱號");
  await act(page, "title-" + id);
  await page.waitForSelector(".sv-chip-title", { state: "detached" });
});

// ==== 之後的 task 在這行之前追加步驟 ====

(async function main() {
  var browser = await chromium.launch();
  var page = await browser.newPage({ viewport: { width: 420, height: 900 } });
  var errors = [];
  page.on("pageerror", function (e) { errors.push(e.message); });
  page.on("console", function (m) { if (m.type() === "error" && m.text().indexOf("fonts.g") < 0) errors.push(m.text()); });
  await page.goto(BASE);
  await page.evaluate(function () { localStorage.clear(); });
  await page.reload();
  await quietEvents(page);
  var fails = 0;
  for (var i = 0; i < steps.length; i++) {
    try { await clearEvents(page); await steps[i][1](page); console.log("ok   " + steps[i][0]); }
    catch (e) { fails++; console.log("FAIL " + steps[i][0] + "：" + e.message); await shot(page, "fail").catch(function () {}); break; }
  }
  if (errors.length) { fails++; console.log("FAIL 頁面錯誤：" + errors.join(" | ")); }
  await browser.close();
  console.log(fails ? "有失敗" : "全部 " + steps.length + " 個步驟通過");
  process.exit(fails ? 1 : 0);
})();
