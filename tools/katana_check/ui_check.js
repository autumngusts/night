// ============================================================================
// katana（神前鍛刀對決）Playwright 流程檢查：
//   設定（兩人）→ 交接畫面 → 13 道工序（小割分揀、加熱、鎚擊、研磨…）全員輪流 → 神前審查
//   → 命名・收入刀鞘 → 試斬 5 目標 → 對刀場（加入對手刀、放牌、快轉）→ 總結；重新整理能還原；切換語言沒有漏翻的 kt_ 鍵
//   第二局：單人以特殊材料（烏茲鋼）打異國刀種（克力士），確認小割・積沸被略過
//   最後：刀鞘的刀轉成邀請網址，以 ?duel= 打開 → 對刀 → 戰績寫回刀鞘
// 前置：
//   1. py -3 generate.py
//   2. py -3 -m http.server 8944 --directory dist
// 執行：node tools/katana_check/ui_check.js
// ============================================================================
"use strict";
var path = require("path");
var assert = require("assert");
var chromium = require(require.resolve("playwright", { paths: [path.join(__dirname, "..", "midnight_check")] })).chromium;

var BASE = process.env.KATANA_BASE || "http://localhost:8944/katana/index.html";

function st(page) { return page.evaluate(function () { return window.PriTestKatana._state(); }); }

// 依 i18n 鍵找按鈕並點擊（小遊戲每幀重繪，一律用 DOM click 而不是 page.click）
async function clickKey(page, key, nth) {
  var ok = await page.evaluate(function (a) {
    var label = window.I18N.t(a[0]);
    var btns = Array.prototype.filter.call(document.querySelectorAll("#kt-app button"), function (b) { return b.textContent.trim() === label && !b.disabled; });
    var b = btns[a[1] || 0];
    if (!b) return false;
    b.click();
    return true;
  }, [key, nth || 0]);
  return ok;
}

async function mustClick(page, key) {
  var ok = await clickKey(page, key);
  assert.ok(ok, "button not found: " + key);
}

async function doHeat(page, ms) {
  await mustClick(page, "kt_heat_start");
  await page.waitForTimeout(ms);
  await mustClick(page, "kt_heat_pull");
}

async function doHammer(page, strikes) {
  await mustClick(page, strikes === 1 ? "kt_swing_ready" : "kt_hammer_start");
  for (var i = 0; i < strikes; i++) {
    await page.waitForTimeout(60);
    await mustClick(page, strikes === 1 ? "kt_swing_hit" : "kt_hammer_hit");
  }
}

// 目前工序：依 kind 做完小遊戲與必要選擇
// 連按到小遊戲結束（按鈕消失為止）
async function tapUntilDone(page, startKey, hitKey, gapMs) {
  await mustClick(page, startKey);
  for (var i = 0; i < 20; i++) {
    await page.waitForTimeout(gapMs || 60);
    if (!(await clickKey(page, hitKey))) break;
  }
}

// 置土：以滑鼠沿畫布中段拖一條線（會產生 pointer 事件）
async function drawClay(page) {
  await page.locator(".kt-clay-canvas").scrollIntoViewIfNeeded();
  var box = await page.locator(".kt-clay-canvas").boundingBox();
  if (!box) return;
  var y = box.y + box.height * 0.62;
  await page.mouse.move(box.x + box.width * 0.04, y);
  await page.mouse.down();
  for (var i = 1; i <= 30; i++) await page.mouse.move(box.x + box.width * (0.04 + 0.92 * i / 30), y + Math.sin(i) * 4);
  await page.mouse.up();
  await mustClick(page, "kt_clay_ok");
  var clay = await page.evaluate(function () { var u = window.PriTestKatana._ui(); return Object.keys(u.mg).filter(function (k) { return /:clay$/.test(k); }).map(function (k) { return u.mg[k].acc; }); });
  assert.ok(clay.length && clay[clay.length - 1] > 0, "clay drawing registered: " + clay);
}

async function doStep(page, stepId) {
  if (process.env.KT_VERBOSE) console.log("step", stepId);
  if (stepId === "kowari") {
    await tapUntilDone(page, "kt_hammer_start", "kt_hammer_hit");
    for (var k = 0; k < 13; k++) {
      var left = await page.evaluate(function () {
        var p = Array.prototype.filter.call(document.querySelectorAll(".kt-piece"), function (x) { return !x.classList.contains("kt-piece-picked"); });
        if (p[0]) { var chips = p[0].querySelectorAll(".kt-chip"); (p.length % 4 === 0 ? chips[chips.length - 1] : chips[0]).click(); }
        return p.length;
      });
      if (!left) break;
    }
  } else if (stepId === "tsumi") {
    await tapUntilDone(page, "kt_stack_start", "kt_stack_drop", 120);
    await doHeat(page, 5200);
  } else if (stepId === "tsukurikomi") {
    await doHeat(page, 5200);
    await tapUntilDone(page, "kt_hammer_start", "kt_hammer_hit");
  } else if (stepId === "yakiire") {
    await doHeat(page, 3200);
    await page.waitForTimeout(400);
    await mustClick(page, "kt_plunge");
  } else if (stepId === "shitakitae" || stepId === "uwakitae") {
    await doHeat(page, 4800);
    await tapUntilDone(page, "kt_hammer_start", "kt_hammer_hit");
  } else if (stepId === "sunobe" || stepId === "hizukuri") {
    await tapUntilDone(page, "kt_hammer_start", "kt_hammer_hit");
  } else if (stepId === "tsuchioki") {
    if (await page.locator(".kt-clay-canvas").count()) await drawClay(page);
  } else if (stepId === "aitori") {
    await mustClick(page, "kt_temper_start");
    await page.waitForTimeout(3500);
    await mustClick(page, "kt_temper_stop");
  } else if (stepId === "togi") {
    for (var s = 0; s < 11; s++) {
      await page.evaluate(function () { var b = document.querySelector(".kt-stone:not([disabled])"); if (b) b.click(); });
    }
    await tapUntilDone(page, "kt_rhythm_start", "kt_rhythm_hit", 300);
  } else if (stepId === "mei") {
    await tapUntilDone(page, "kt_chisel_start", "kt_chisel_hit");
  }
  var fin = await clickKey(page, "kt_finish_step");
  if (!fin) {
    var info = await page.evaluate(function () { return document.querySelector(".kt-error") ? document.querySelector(".kt-error").textContent + " | " + document.querySelector("#kt-app").innerText.slice(0, 600) : document.body.innerText.slice(0, 600); });
    throw new Error("cannot finish " + stepId + ": " + info);
  }
  await page.waitForFunction(function () { return !!document.querySelector(".kt-result") || !!(document.querySelector(".kt-error") || {}).textContent; });
  var errTxt = await page.evaluate(function () { return document.querySelector(".kt-result") ? "" : document.querySelector(".kt-error").textContent; });
  if (errTxt) throw new Error(stepId + " rejected: " + errTxt);
  await mustClick(page, "kt_next");
}

async function noMissingKeys(page) {
  var txt = await page.evaluate(function () { return document.body.innerText; });
  var m = txt.match(/kt_[a-z0-9_]+/);
  assert.ok(!m, "untranslated key: " + (m && m[0]));
}

async function forgeAll(page, onMaterial) {
  var guard = 0;
  while (guard++ < 60) {
    var s = await st(page);
    if (s.phase !== "forge") break;
    if (await clickKey(page, "kt_handoff_go")) continue;
    var pi = s.players.reduce(function (best, p, i) { return p.step < 13 && (best < 0 || p.step < s.players[best].step) ? i : best; }, -1);
    var step = await page.evaluate(function (i) { return window.PriTestKatanaData.STEPS[window.PriTestKatana._state().players[i].step].id; }, pi);
    if (step === "material" && onMaterial) await onMaterial(page, pi);
    await noMissingKeys(page);
    await doStep(page, step);
  }
}

(async function main() {
  var browser = await chromium.launch();
  var page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  var errors = [];
  page.on("pageerror", function (e) { errors.push(String(e)); console.log("PAGEERROR", e.stack || String(e)); });
  page.on("console", function (m) { if (m.type() === "error") errors.push(m.text()); });

  await page.goto(BASE);
  await page.evaluate(function () { localStorage.clear(); localStorage.setItem("pritest-lang", "zh"); });
  await page.reload();
  await page.waitForSelector("#kt-app .kt-panel");
  await noMissingKeys(page);

  // ---- 第一局：兩人 ----
  await page.evaluate(function () { document.querySelector('input[name="mode"][value="serious"]').dispatchEvent(new Event("change")); });
  await page.fill(".kt-names li:nth-child(1) input", "甲");
  await page.fill(".kt-names li:nth-child(2) input", "乙");
  await mustClick(page, "kt_start");
  var s = await st(page);
  assert.strictEqual(s.players.length, 2);
  assert.strictEqual(s.phase, "forge");
  assert.strictEqual(s.mode, "serious");
  // 交接畫面
  assert.ok(await page.evaluate(function () { return document.body.innerText.indexOf("甲") >= 0; }));

  // 第二位玩家選擇玉鋼打闊劍（雙刃）
  await forgeAll(page, async function (pg, pi) {
    if (pi !== 1) return;
    await pg.evaluate(function () {
      document.querySelector(".kt-special").open = true;
      document.querySelector('input[name="type"][value="broadsword"]').dispatchEvent(new Event("change"));
    });
  });

  // 中途重新整理不會壞（此時已在審查）
  await page.reload();
  await page.waitForSelector("#kt-app .kt-panel");
  if (await clickKey(page, "kt_continue")) await page.waitForTimeout(100);
  s = await st(page);
  assert.strictEqual(s.phase, "judge", "phase after forge: " + s.phase);
  assert.strictEqual(s.players[1].blade.type, "broadsword");
  assert.strictEqual(await page.locator(".kt-card .kt-blade").count(), 2);
  await noMissingKeys(page);
  console.log("judge:", s.players.map(function (p) { return p.name + " " + p.blade.type + " HRC " + p.blade.hardEdge + " sori " + p.blade.sori + " flaws " + p.blade.flaws.join("/"); }).join(" | "));

  // 命名・覺醒招式・收入刀鞘
  assert.strictEqual(await page.locator(".kt-naming").count(), 2);
  s = await st(page);
  assert.ok(s.players.every(function (p) { return p.blade.special !== undefined; }), "awaken decided");
  await page.fill(".kt-naming input.kt-text >> nth=0", "試作一號");
  await mustClick(page, "kt_sc_put");
  var sc = await page.evaluate(function () { return window.PriTestKatana._scabbard(); });
  assert.strictEqual(sc.swords.length, 1);
  assert.ok(["試作一號"].indexOf(sc.swords[0].snap.name) >= 0, "sword name saved: " + sc.swords[0].snap.name);

  // 試斬
  await mustClick(page, "kt_go_cut");
  for (var c = 0; c < 10; c++) {
    if (!(await clickKey(page, "kt_swing_ready"))) { await mustClick(page, "kt_next"); continue; }
    await page.waitForTimeout(150);
    await mustClick(page, "kt_swing_hit");
    await mustClick(page, "kt_cut_do");
    await mustClick(page, "kt_next");
  }
  s = await st(page);
  assert.strictEqual(s.cut.target, 5);
  await noMissingKeys(page);

  // 互擊
  await page.evaluate(function () { var cb = document.querySelector('.kt-check input[type="checkbox"]'); cb.checked = true; cb.dispatchEvent(new Event("change")); });
  await mustClick(page, "kt_go_clash");
  await page.waitForSelector(".kt-arena-canvas");
  await page.waitForTimeout(1500);
  // 把第一把能出牌的刀的手牌放進等待區（試斬可能已經把某把刀打斷）
  var queued = await page.evaluate(function () {
    var b = document.querySelector(".kt-af .kt-card-btn:not([disabled])");
    if (!b) return -1;
    var fid = b.closest(".kt-af").getAttribute("data-fid");
    b.click();
    return window.PriTestKatana._ui().arena.fighters.filter(function (f) { return f.id === fid; })[0].queue.length;
  });
  assert.strictEqual(queued, 1, "card queued");
  await page.waitForTimeout(3500);
  var ar = await page.evaluate(function () { var a = window.PriTestKatana._ui().arena; return { t: a.time, round: a.round, fx: a.log.filter(function (e) { return e.type === "card"; }).length }; });
  assert.ok(ar.t > 3 && ar.round >= 2, "arena runs: " + JSON.stringify(ar));
  await page.screenshot({ path: path.join(process.env.KATANA_SHOT_DIR || __dirname, "katana_arena.png"), fullPage: false });
  await noMissingKeys(page);
  await mustClick(page, "kt_ar_skip");
  await page.waitForTimeout(100);
  s = await st(page);
  assert.ok(s.clash.winner, "clash winner");
  assert.strictEqual(s.clash.placing.length, 3);
  console.log("clash:", s.clash.placing.join(","), JSON.stringify(s.clash.summary.map(function (x) { return x.id + ":" + x.hp + "/" + x.maxHp; })));
  await mustClick(page, "kt_to_final");
  await page.waitForSelector(".kt-table");
  await noMissingKeys(page);

  // 語言切換
  for (var lang of ["ja", "en"]) {
    await page.evaluate(function (l) { window.I18N.setLang(l); }, lang);
    await noMissingKeys(page);
  }
  await page.screenshot({ path: path.join(process.env.KATANA_SHOT_DIR || __dirname, "katana_final.png"), fullPage: true });

  // ---- 第二局：單人・烏茲鋼彎刀 ----
  await page.evaluate(function () { window.I18N.setLang("zh"); });
  await mustClick(page, "kt_new_game");
  await page.waitForSelector(".kt-names");
  await page.evaluate(function () { document.querySelectorAll(".kt-names .kt-link").forEach(function (b) { b.click(); }); });
  await page.evaluate(function () { var b = document.querySelector(".kt-names .kt-link"); if (b) b.click(); });
  await mustClick(page, "kt_start");
  await forgeAll(page, async function (pg) {
    await pg.evaluate(function () {
      document.querySelector('input[name="type"][value="kris"]').dispatchEvent(new Event("change"));
    });
    await pg.evaluate(function () {
      document.querySelector('input[name="kawa"][value="wootz"]').dispatchEvent(new Event("change"));
    });
    await pg.evaluate(function () {
      document.querySelector('input[name="shin"][value="none"]').dispatchEvent(new Event("change"));
    });
  });
  s = await st(page);
  assert.strictEqual(s.players.length, 1);
  var b = s.players[0].blade;
  assert.strictEqual(b.kawaId, "wootz");
  assert.strictEqual(b.type, "kris");
  assert.strictEqual(s.mode, "show");
  assert.ok(s.players[0].log.some(function (e) { return e.step === "kowari" && e.skipped; }), "kowari skipped");
  console.log("solo wootz kris (show):", JSON.stringify({ C: b.kawaC, hrc: b.hardEdge, sori: b.sori, intact: b.patternIntact, flaws: b.flaws }));

  // ---- 刀鞘 → 邀請網址 → 對方打開後對刀 ----
  sc = await page.evaluate(function () { return window.PriTestKatana._scabbard(); });
  var rec0 = sc.swords[0].rec.w + sc.swords[0].rec.l;
  assert.strictEqual(rec0, 1, "forge clash recorded to scabbard");
  var code = await page.evaluate(function () { return window.PriTestKatana._encode(window.PriTestKatana._scabbard().swords[0].snap); });
  await page.goto(BASE + "?duel=" + code);
  await page.waitForSelector(".kt-invite-panel");
  await noMissingKeys(page);
  await page.screenshot({ path: path.join(process.env.KATANA_SHOT_DIR || __dirname, "katana_invite.png"), fullPage: true });
  await mustClick(page, "kt_duel_go");
  await page.waitForSelector(".kt-arena-canvas");
  var nf = await page.evaluate(function () { return window.PriTestKatana._ui().duel.arena.fighters.map(function (f) { return f.id + (f.human ? "H" : "A"); }); });
  assert.strictEqual(nf.length, 2, "invite duel fighters: " + nf);
  await page.waitForTimeout(800);
  await mustClick(page, "kt_ar_skip");
  await page.waitForTimeout(100);
  await mustClick(page, "kt_duel_again");
  await mustClick(page, "kt_ar_skip");
  await mustClick(page, "kt_duel_back");
  sc = await page.evaluate(function () { return window.PriTestKatana._scabbard(); });
  assert.strictEqual(sc.swords[0].rec.w + sc.swords[0].rec.l, 3, "duels recorded");
  // 壞掉的碼不會讓頁面出錯
  await page.goto(BASE + "?duel=AAAA");
  await page.waitForSelector(".kt-names");
  assert.strictEqual(await page.locator(".kt-invite-panel").count(), 0);

  // ---- 對刀實驗場：批次模擬・改刀種・開打 ----
  await page.evaluate(function () { document.querySelector(".kt-lab").open = true; });
  assert.strictEqual(await page.locator(".kt-lab-card").count(), 4);
  await page.evaluate(function () { var sel = document.querySelector(".kt-lab-card select"); sel.value = "jiuhuan"; sel.dispatchEvent(new Event("change")); });
  assert.strictEqual(await page.evaluate(function () { return window.PriTestKatana._ui().lab.blades[0].type; }), "jiuhuan");
  await mustClick(page, "kt_lab_add");
  await page.evaluate(function () { var b = Array.prototype.filter.call(document.querySelectorAll("button"), function (x) { return x.textContent === window.I18N.t("kt_lab_batch", { n: 100 }); })[0]; b.click(); });
  assert.strictEqual(await page.locator(".kt-lab-batch tr").count(), 6, "batch table rows");
  await noMissingKeys(page);
  await mustClick(page, "kt_lab_go");
  await page.waitForSelector(".kt-arena-canvas");
  assert.strictEqual(await page.evaluate(function () { return window.PriTestKatana._ui().duel.arena.fighters.length; }), 5);
  await mustClick(page, "kt_ar_skip");
  await mustClick(page, "kt_duel_back");

  if (errors.length) console.log("ERRORS", errors);
  assert.deepStrictEqual(errors, []);
  await browser.close();
  console.log("katana ui_check OK");
})().catch(function (e) { console.error(e); process.exit(1); });
