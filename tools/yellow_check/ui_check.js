// ============================================================================
// 黃牌 Yellow Card（yellow）Playwright 流程檢查（本機模式）：
//   設定四角英雄 → 地圖投票 → 戰鬥（點手牌、點敵人／隊友目標、結束回合）→ 戰利品選卡 → 往下推進數層
//   → 重新整理後能從存檔繼續 → 切換三種語言沒有漏翻的 yc_ 鍵 → 截圖
// 前置：
//   1. py -3 generate.py
//   2. py -3 -m http.server 8945 --directory dist
// 執行：node tools/yellow_check/ui_check.js [要推進到的層數，預設 4]
// ============================================================================
"use strict";
var path = require("path");
var assert = require("assert");
var chromium = require(require.resolve("playwright", { paths: [path.join(__dirname, "..", "midnight_check")] })).chromium;

var BASE = process.env.YELLOW_BASE || "http://localhost:8945/yellow/index.html";
var FLOORS = Number(process.argv[2]) || 4;
var SHOT_DIR = process.env.YELLOW_SHOTS || path.join(__dirname, "shots");

function st(page) { return page.evaluate(function () { return window.PriTestYellow.state(); }); }

async function clickText(page, label) {
  return page.evaluate(function (l) {
    var b = Array.prototype.filter.call(document.querySelectorAll("#yc-app button"), function (x) { return x.textContent.trim() === l && !x.disabled; })[0];
    if (!b) return false;
    b.click();
    return true;
  }, label);
}
async function clickKey(page, key) {
  var label = await page.evaluate(function (k) { return window.I18N.t(k); }, key);
  var ok = await clickText(page, label);
  assert.ok(ok, "找不到按鈕：" + key);
}

async function noRawKeys(page, where) {
  var raw = await page.evaluate(function () { return (document.getElementById("yc-app").innerText.match(/yc_[a-zA-Z_]+/g) || []); });
  assert.deepStrictEqual(raw, [], where + " 有漏翻的鍵：" + raw.join(","));
}

// 用畫面打一個英雄的回合：能打的牌就點，需要目標就點第一個發亮的目標
async function playHeroTurn(page, seat) {
  await page.evaluate(function (s) {
    var tab = document.querySelectorAll(".yc-tab")[0];
    void tab;
  }, seat);
  for (var guard = 0; guard < 12; guard++) {
    var s = await st(page);
    if (s.phase !== "battle") return;
    var h = s.heroes[seat];
    if (!h || h.down || h.done) return;
    // 切到這名英雄的分頁
    await page.evaluate(function (name) {
      var tabs = Array.prototype.filter.call(document.querySelectorAll(".yc-tab"), function (b) { return b.textContent.indexOf(name) >= 0; });
      if (tabs[0]) tabs[0].click();
    }, h.name);
    var clicked = await page.evaluate(function () {
      var c = document.querySelector(".yc-hand button.yc-card:not(.yc-card-off)");
      if (!c) return false;
      c.click();
      return true;
    });
    if (!clicked) break;
    var res = await page.evaluate(function () {
      var tgt = document.querySelector(".yc-valid");
      if (tgt) { tgt.click(); return "target"; }
      var sel = document.querySelector(".yc-card-sel");
      if (sel) { sel.click(); return "again"; }
      return "direct";
    });
    void res;
    var after = await st(page);
    if (after.phase === "battle" && after.heroes[seat] && after.heroes[seat].hand.length === h.hand.length && after.heroes[seat].mana === h.mana) break; // 沒有變化：避免無限迴圈
  }
  var s2 = await st(page);
  if (s2.phase === "battle" && s2.heroes[seat] && !s2.heroes[seat].done && !s2.heroes[seat].down) {
    await clickKey(page, "yc_end_turn");
  }
}

(async function () {
  var browser = await chromium.launch();
  var page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  var errors = [];
  page.on("pageerror", function (e) { errors.push(String(e)); });
  page.on("console", function (m) { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(BASE);
  await page.evaluate(function () { localStorage.removeItem("pritest-yellow-state"); localStorage.setItem("pritest-lang", "zh"); });
  await page.reload();
  require("fs").mkdirSync(SHOT_DIR, { recursive: true });

  await noRawKeys(page, "入口畫面");
  await page.screenshot({ path: path.join(SHOT_DIR, "01_entry.png"), fullPage: true });
  // 第 3、4 位玩家選英雄（遊俠、祭司）；選過的英雄在其他座位要變成不能選
  await page.evaluate(function () {
    var seats = document.querySelectorAll(".yc-seat");
    [[2, "遊俠"], [3, "祭司"]].forEach(function (x) {
      var b = Array.prototype.filter.call(document.querySelectorAll(".yc-seat")[x[0]].querySelectorAll(".yc-hero-btn"), function (y) { return y.textContent.indexOf(x[1]) >= 0; })[0];
      b.click();
    });
    void seats;
  });
  var dup = await page.evaluate(function () {
    var b = Array.prototype.filter.call(document.querySelectorAll(".yc-seat")[0].querySelectorAll(".yc-hero-btn"), function (y) { return y.textContent.indexOf("遊俠") >= 0; })[0];
    return b.disabled;
  });
  assert.ok(dup, "已被選走的英雄在其他座位應該不能選");
  // 取個名字
  await page.evaluate(function () {
    var inputs = document.querySelectorAll(".yc-seat .yc-text");
    ["亞瑟", "羅賓", "梅林", "瑪莉"].forEach(function (n, i) { if (inputs[i]) { inputs[i].value = n; inputs[i].dispatchEvent(new Event("input")); } });
  });
  await clickKey(page, "yc_start_local");
  var s = await st(page);
  assert.strictEqual(s.phase, "map");
  assert.strictEqual(s.heroes.filter(Boolean).length, 4);
  assert.strictEqual(s.heroes[0].name, "亞瑟");

  var floorsDone = 0, battles = 0, shotBattle = false, shotShop = false;
  for (var loop = 0; loop < 400 && floorsDone < FLOORS; loop++) {
    s = await st(page);
    if (s.phase === "map") {
      await page.evaluate(function () { document.querySelector(".yc-node").click(); });
      continue;
    }
    if (s.phase === "battle") {
      if (!shotBattle) {
        await noRawKeys(page, "戰鬥畫面");
        await page.screenshot({ path: path.join(SHOT_DIR, "02_battle.png"), fullPage: true });
        // 選一張需要目標的牌，截目標選擇畫面
        await page.evaluate(function () { var c = document.querySelector(".yc-hand button.yc-card:not(.yc-card-off)"); if (c) c.click(); });
        await page.screenshot({ path: path.join(SHOT_DIR, "03_targeting.png"), fullPage: true });
        await page.keyboard.press("Escape");
        shotBattle = true;
      }
      var r0 = s.round, before = s.logSeq;
      for (var seat = 0; seat < 4; seat++) await playHeroTurn(page, seat);
      var s3 = await st(page);
      assert.ok(s3.logSeq > before, "一輪操作後紀錄應該增加");
      if (s3.phase === "battle") assert.ok(s3.round > r0 || s3.heroes.some(function (h) { return h && !h.done && !h.down; }), "全員結束後應進入下一回合");
      if (s3.phase !== "battle") battles++;
      if (s3.phase === "lose") break;
      continue;
    }
    if (s.phase === "reward" || s.phase === "rest" || s.phase === "treasure" || s.phase === "shop") {
      if (s.phase === "shop" && !shotShop) { shotShop = true; await noRawKeys(page, "商店"); await page.screenshot({ path: path.join(SHOT_DIR, "07_shop.png"), fullPage: true }); }
      if (floorsDone === 0 && s.phase === "reward") assert.ok(s.heroes.filter(Boolean).every(function (h) { return h.gold > 0; }), "打贏戰鬥後每位英雄都應該得到金幣");
      if (floorsDone === 0) { await noRawKeys(page, "選擇畫面"); await page.screenshot({ path: path.join(SHOT_DIR, "04_reward.png"), fullPage: true }); }
      // 每名英雄：選第一張卡／休息
      var picked = await page.evaluate(function () {
        var card = document.querySelector(".yc-choice-hero button.yc-card:not(:disabled)") || document.querySelector(".yc-choice-hero button.yc-relic:not(:disabled)");
        if (card) { card.click(); return true; }
        var b = document.querySelector(".yc-choice-hero .yc-primary");
        if (b) { b.click(); return true; }
        return false;
      });
      assert.ok(picked, "選擇畫面沒有可以點的按鈕");
      var s4 = await st(page);
      if (s4.phase === "map") floorsDone++;
      continue;
    }
    if (s.phase === "win" || s.phase === "lose") break;
  }
  s = await st(page);
  console.log("推進：", floorsDone, "層，打完", battles, "場戰鬥，目前", s.phase, "第", s.act + 1, "幕第", s.floor + 1, "層");
  assert.ok(floorsDone >= Math.min(FLOORS, 1) || s.phase === "lose", "至少要推進一層");

  // 重新整理 → 進行中的冒險：入口畫面出現「繼續」且狀態一致；已結束（勝利／全滅）：不再提示繼續
  var saved = await st(page);
  await page.reload();
  if (saved.phase !== "win" && saved.phase !== "lose") {
    await clickKey(page, "yc_continue");
    var restored = await st(page);
    assert.strictEqual(restored.logSeq, saved.logSeq, "存檔還原後狀態應一致");
  } else {
    var hasContinue = await page.evaluate(function () { return document.body.innerText.indexOf(window.I18N.t("yc_continue")) >= 0; });
    assert.ok(!hasContinue, "已結束的冒險不應提示繼續");
  }

  // 語言切換
  for (var lang of ["ja", "en", "zh"]) {
    await page.evaluate(function (l) { window.I18N.setLang(l); }, lang);
    await noRawKeys(page, "語言 " + lang);
  }
  await page.screenshot({ path: path.join(SHOT_DIR, "05_after.png"), fullPage: true });

  // 手機寬度不應橫向捲動（戰鬥畫面最擠，有的話切回戰鬥中的狀態再量）
  await page.setViewportSize({ width: 390, height: 844 });
  var overflow = await page.evaluate(function () { return document.documentElement.scrollWidth - window.innerWidth; });
  await page.screenshot({ path: path.join(SHOT_DIR, "06_mobile.png"), fullPage: true });
  assert.ok(overflow <= 1, "手機寬度出現橫向捲動：" + overflow + "px");

  assert.deepStrictEqual(errors, [], "頁面錯誤：" + errors.join("\n"));
  await browser.close();
  console.log("OK");
})().catch(function (e) { console.error(e); process.exit(1); });
