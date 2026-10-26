// ============================================================================
// 黃牌 Yellow Card（yellow）Playwright 流程檢查（本機模式）：
//   設定四位英雄 → 地圖投票 → 戰鬥（用滑鼠把手牌拖到敵人／隊友／戰場上、結束回合）→ 戰利品選卡 → 往下推進數層
//   另外檢查：扇形手牌、滑過抽起、拖出一半顯示完整說明、拖回不出牌、指定範圍卡的範圍圈預覽、點敵人／英雄的虛線、打擊演出
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

// 手牌的「看得到的那一塊」：扇形疊著，後面的牌蓋住前面那張的右側
async function slotPoint(page, u) {
  return page.evaluate(function (uid) {
    var slot = document.querySelector('.yc-slot[data-u="' + uid + '"]');
    if (!slot) return null;
    // 戰場與手牌要同時在畫面內才能拖
    document.querySelector(".yc-fan").scrollIntoView({ block: "end" });
    var r = slot.getBoundingClientRect();
    // 在外框裡找一個真的點得到這張牌的位置（牌有旋轉、也會被右邊的牌蓋住）
    for (var fy = 0.75; fy >= 0.3; fy -= 0.15) {
      for (var fx = 0.15; fx <= 0.85; fx += 0.1) {
        var x = r.left + r.width * fx, y = r.top + r.height * fy;
        var hit = document.elementFromPoint(x, y);
        if (hit && hit.closest && hit.closest(".yc-slot") === slot) return { x: x, y: y };
      }
    }
    return null;
  }, u);
}
// 這張牌該拖到哪裡（畫面座標）：敵人／範圍卡＝第一個可打的敵人，隊友＝第一個可選的英雄，其他＝戰場內圈
async function dropPoint(page, seat, u) {
  return page.evaluate(function (a) {
    var Y = window.PriTestYellow, C = window.PriTestYellowCore;
    var st = Y.state(), h = st.heroes[a.seat], lay = Y.layout();
    var c = h.hand.filter(function (x) { return x.u === a.u; })[0];
    var d = C.cardDef(c), vt = C.validTargets(st, h, c);
    var p;
    if (d.tgt === "enemy" || d.tgt === "area") { if (!vt.e.length) return null; p = lay.e[vt.e[0]]; }
    else if (d.tgt === "ally" || d.tgt === "down") { if (!vt.s.length) return null; p = lay.h[vt.s[0]]; }
    else p = { x: 50, y: 50 - C.GEO.mid + 2 };
    return Y.arenaToClient(p.x, p.y);
  }, { seat: seat, u: u });
}
async function dragTo(page, from, to, steps) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 4, from.y - 30, { steps: 3 });
  await page.mouse.move(to.x, to.y, { steps: steps || 8 });
}
async function openTab(page, name) {
  await page.evaluate(function (n) {
    var tabs = Array.prototype.filter.call(document.querySelectorAll(".yc-tab"), function (b) { return b.textContent.indexOf(n) >= 0; });
    if (tabs[0]) tabs[0].click();
  }, name);
}

// 敵人回合重播中不能操作：等播完
async function waitReplay(page) {
  await page.waitForFunction(function () { return !window.PriTestYellow.replaying(); }, null, { timeout: 60000 });
}

// 用畫面打一個英雄的回合：能打的牌就拖到目標上
async function playHeroTurn(page, seat) {
  await waitReplay(page);
  for (var guard = 0; guard < 12; guard++) {
    var s = await st(page);
    if (s.phase !== "battle") return;
    var h = s.heroes[seat];
    if (!h || h.down || h.done) return;
    await openTab(page, h.name);
    var u = await page.evaluate(function () {
      var c = document.querySelector(".yc-fan .yc-slot .yc-card:not(.yc-card-off)");
      return c ? Number(c.parentNode.getAttribute("data-u")) : null;
    });
    if (u === null) break;
    var from = await slotPoint(page, u), to = await dropPoint(page, seat, u);
    if (!from || !to) break;
    await dragTo(page, from, to);
    await page.mouse.up();
    await page.waitForTimeout(260);
    var after = await st(page);
    if (after.phase === "battle" && after.heroes[seat] && after.heroes[seat].hand.length === h.hand.length && after.heroes[seat].mana === h.mana) break; // 沒有變化：避免無限迴圈
  }
  var s2 = await st(page);
  if (s2.phase === "battle" && s2.heroes[seat] && !s2.heroes[seat].done && !s2.heroes[seat].down) {
    await clickKey(page, "yc_end_turn");
  }
}

// 第一場戰鬥：拖曳／預覽／虛線／演出的細部檢查
async function battleChecks(page) {
  var s = await st(page);
  var seat = s.heroes.findIndex(function (h) { return h && !h.down && !h.done && h.hand.length; });
  var h = s.heroes[seat];
  await openTab(page, h.name);
  // 敵人血量是掛在圓點上的紅盾
  var shields = await page.evaluate(function () {
    var st = window.PriTestYellow.state();
    return st.enemies.every(function (e) { var n = document.querySelector('[data-ref="e' + e.u + '"] .yc-enemy-shield'); return n && n.textContent === String(e.hp); });
  });
  assert.ok(shields, "每個敵人都要有寫著血量的紅盾");
  // 敵人是依體型的圓點
  var sizes = await page.evaluate(function () {
    return Array.prototype.map.call(document.querySelectorAll(".yc-enemy"), function (n) { var r = n.getBoundingClientRect(); return Math.abs(r.width - r.height) < 1.5 ? r.width : -1; });
  });
  assert.ok(sizes.length && sizes.every(function (w) { return w > 10; }), "敵人應該是正圓點：" + sizes.join(","));
  // 手牌是扇形：至少兩張時有旋轉、有重疊
  var fan = await page.evaluate(function () {
    var ss = document.querySelectorAll(".yc-fan .yc-slot");
    if (ss.length < 2) return { n: ss.length };
    var a = ss[0].getBoundingClientRect(), b = ss[1].getBoundingClientRect();
    return { n: ss.length, overlap: a.right > b.left + 2, rot: ss[0].style.getPropertyValue("--rot") };
  });
  if (fan.n >= 2) assert.ok(fan.overlap && fan.rot && fan.rot.trim() !== "0.00deg", "手牌應該扇形重疊：" + JSON.stringify(fan));
  var u = h.hand[0].u;
  var from = await slotPoint(page, u);
  // 滑過：抽起來
  await page.mouse.move(from.x, from.y);
  await page.waitForTimeout(220);
  assert.ok(await page.evaluate(function (uid) { return document.querySelector('.yc-slot[data-u="' + uid + '"]').classList.contains("yc-lift"); }, u), "滑過的牌應該抽起來");
  // 拖出一半（還沒到戰場）：旁邊出現完整說明
  await page.mouse.down();
  var fanTop = await page.evaluate(function () { return document.querySelector(".yc-fan").getBoundingClientRect().top; });
  await page.mouse.move(from.x + 10, fanTop - 30, { steps: 4 });
  var onField = await page.evaluate(function (y) { var r = document.querySelector(".yc-arena").getBoundingClientRect(); return y < r.bottom; }, fanTop - 30);
  if (!onField) assert.ok(await page.$(".yc-card-detail"), "拖出一半應該顯示完整說明：" + JSON.stringify(await page.evaluate(function () { return [!!document.querySelector(".yc-ghost"), document.querySelector(".yc-hint").textContent, window.scrollY]; })) + JSON.stringify(from));
  await page.screenshot({ path: path.join(SHOT_DIR, "03_half_out.png") });
  // 拖回手牌區放開：不出牌
  await page.mouse.move(from.x, from.y, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  var s1 = await st(page);
  assert.strictEqual(s1.heroes[seat].hand.length, h.hand.length, "拖回手牌區不應出牌");
  assert.ok(!(await page.$(".yc-ghost")), "取消後拖曳中的牌應該消失");

  // 指定範圍卡：存檔裡塞一張火焰炸彈給這位英雄後重新整理，拖到敵人身上時要出現範圍圈、圈內敵人變色
  var bu = await page.evaluate(function (a) {
    var stt = JSON.parse(localStorage.getItem("pritest-yellow-state"));
    var hh = stt.heroes[a.seat];
    stt.uid += 1;
    hh.hand.push({ u: stt.uid, id: "mag_firebomb" });
    hh.mana = Math.max(hh.mana, 2);
    localStorage.setItem("pritest-yellow-state", JSON.stringify(stt));
    return stt.uid;
  }, { seat: seat });
  await page.reload();
  await clickKey(page, "yc_continue");
  await openTab(page, h.name);
  var s2 = await st(page);
  var from2 = await slotPoint(page, bu), to2 = await dropPoint(page, seat, bu);
  await dragTo(page, from2, to2, 10);
  await page.waitForTimeout(80);
  var prev = await page.evaluate(function () {
    var g = document.querySelector(".yc-ghost");
    return { zone: !!document.querySelector(".yc-aim-zone.yc-aim-zone-on"), aimed: document.querySelectorAll(".yc-enemy.yc-aim").length,
      arc: !!document.querySelector(".yc-arena-arc .yc-aim-arc-on"), ghost: g ? getComputedStyle(g).opacity : "none" };
  });
  assert.ok(prev.zone && prev.aimed >= 1, "指定範圍卡應顯示範圍圈並讓圈內敵人變色：" + JSON.stringify(prev));
  // 卡牌進戰場後隱藏，只剩從角色身上拋出的虛線拋物線
  assert.ok(prev.arc && Number(prev.ghost) < 0.05, "拖到戰場上應該只剩虛線拋物線：" + JSON.stringify(prev));
  await page.screenshot({ path: path.join(SHOT_DIR, "03_area_aim.png") });
  // 移到沒有敵人的地方：沒有變色的敵人
  var empty = await page.evaluate(function () { return window.PriTestYellow.arenaToClient(50, 50); });
  await page.mouse.move(empty.x, empty.y, { steps: 4 });
  var emptyAim = await page.evaluate(function () { return { aimed: document.querySelectorAll(".yc-enemy.yc-aim").length, on: !!document.querySelector(".yc-aim-zone-on") }; });
  assert.ok(emptyAim.aimed === 0 && !emptyAim.on, "範圍圈內沒有敵人時不應變色：" + JSON.stringify(emptyAim));
  await page.mouse.move(to2.x, to2.y, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  var s3 = await st(page);
  var played = s3.log.filter(function (x) { return x.t === "play" && x.c === "mag_firebomb"; }).pop();
  assert.ok(played && typeof played.x === "number", "放下範圍圈應該打出指定範圍卡");
  assert.ok(s3.logSeq > s2.logSeq, "出牌後紀錄應增加");
  // 打擊演出：命中爆光／浮出數字／範圍爆炸
  var fxSeen = await page.evaluate(function () { return document.querySelectorAll(".yc-burst, .yc-float, .yc-blast, .yc-shot, .yc-poof").length; });
  assert.ok(fxSeen > 0, "出牌後應該有打擊演出");
  await page.screenshot({ path: path.join(SHOT_DIR, "03_area_hit.png") });

  // 點敵人：虛線標出牠要打誰；點英雄：虛線標出誰會打他
  var atkEnemy = await page.evaluate(function () {
    var Y = window.PriTestYellow, C = window.PriTestYellowCore, st = Y.state();
    var e = st.enemies.filter(function (x) { return C.effActs(st, x).some(function (a) { return a.k === "atk" && C.actTargets(st, x, a).length; }); })[0];
    return e ? { u: e.u, seat: C.actTargets(st, e, C.effActs(st, e).filter(function (a) { return a.k === "atk"; })[0])[0] } : null;
  });
  if (atkEnemy) {
    await page.dispatchEvent('[data-ref="e' + atkEnemy.u + '"]', "click");
    var lines = await page.evaluate(function () { return document.querySelectorAll(".yc-arena-fx .yc-link-atk").length; });
    assert.ok(lines >= 1, "點敵人應該畫出攻擊虛線");
    await page.screenshot({ path: path.join(SHOT_DIR, "08_focus_enemy.png"), fullPage: true });
    await page.dispatchEvent('[data-ref="h' + atkEnemy.seat + '"]', "click");
    var lines2 = await page.evaluate(function () { return document.querySelectorAll(".yc-arena-fx .yc-link-atk").length; });
    assert.ok(lines2 >= 1, "點英雄應該畫出誰會打他的虛線");
    await page.screenshot({ path: path.join(SHOT_DIR, "09_focus_hero.png"), fullPage: true });
    await page.keyboard.press("Escape");
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
  // 2026-10-27 選角改成「點座位 → 共用的一份英雄清單」，不再每個座位各一份
  for (var pk of [[2, "遊俠"], [3, "祭司"]]) {
    await page.evaluate(function (x) { document.querySelectorAll(".yc-seat")[x[0]].click(); }, pk);
    await page.evaluate(function (x) {
      var b = Array.prototype.filter.call(document.querySelectorAll(".yc-hero-pick .yc-hero-btn"), function (y) { return y.textContent.indexOf(x[1]) >= 0; })[0];
      b.click();
    }, pk);
  }
  var dup = await page.evaluate(function () {
    document.querySelectorAll(".yc-seat")[0].click();
    var b = Array.prototype.filter.call(document.querySelectorAll(".yc-hero-pick .yc-hero-btn"), function (y) { return y.textContent.indexOf("遊俠") >= 0; })[0];
    return b.disabled;
  });
  // 2026-10-27 使用者指定：可以選重複英雄（舊規格是「已被選走的英雄在其他座位不能選」）
  assert.ok(!dup, "已被別的座位選走的英雄也要能選（允許重複）");
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

  var floorsDone = 0, battles = 0, shotBattle = false, replaySeen = false;
  for (var loop = 0; loop < 400 && floorsDone < FLOORS; loop++) {
    s = await st(page);
    if (s.phase === "map") {
      // 每位英雄各自選目的地（還沒選的英雄點第一個）
      var picked0 = await page.evaluate(function () { var b = document.querySelector(".yc-dest-open .yc-node:not(:disabled)"); if (b) b.click(); return !!b; });
      assert.ok(picked0, "地圖畫面應該有可以選的目的地");
      continue;
    }
    if (s.phase === "battle") {
      if (!shotBattle) {
        await noRawKeys(page, "戰鬥畫面");
        await page.screenshot({ path: path.join(SHOT_DIR, "02_battle.png"), fullPage: true });
        await battleChecks(page);
        shotBattle = true;
        continue;
      }
      var r0 = s.round, before = s.logSeq;
      for (var seat = 0; seat < 4; seat++) await playHeroTurn(page, seat);
      // 敵人回合：從結算前的狀態一步一步重播（第一次檢查有在播，之後等播完）
      if (!replaySeen && (await st(page)).phase === "battle") {
        var rp = await page.evaluate(function () { return window.PriTestYellow.replaying(); });
        assert.ok(rp, "全員結束回合後應該逐步播放敵人回合");
        await page.waitForSelector(".yc-acting, .yc-banner", { timeout: 5000 });
        await page.screenshot({ path: path.join(SHOT_DIR, "10_enemy_turn.png") });
        replaySeen = true;
      }
      await waitReplay(page);
      var s3 = await st(page);
      assert.ok(s3.logSeq > before, "一輪操作後紀錄應該增加");
      if (s3.phase === "battle") assert.ok(s3.round > r0 || s3.heroes.some(function (h) { return h && !h.done && !h.down; }), "全員結束後應進入下一回合");
      if (s3.phase !== "battle") battles++;
      if (s3.phase === "lose") break;
      continue;
    }
    if (s.phase === "reward") {
      // 2026-10-23 拿掉商店與金幣：畫面上不應該再出現金幣
      assert.ok(!(await page.evaluate(function () { return document.getElementById("yc-app").textContent.indexOf("💰") >= 0; })), "不應該再顯示金幣");
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

  // 語言切換；全部卡牌（含升級版）的說明都不能有漏翻的鍵或沒代入的參數
  for (var lang of ["ja", "en", "zh"]) {
    await page.evaluate(function (l) { window.I18N.setLang(l); }, lang);
    await noRawKeys(page, "語言 " + lang);
    var badCards = await page.evaluate(function () {
      var bad = [];
      window.PriTestYellowData.CARDS.forEach(function (c) {
        [false, true].forEach(function (up) {
          var txt = window.PriTestYellow.cardText(c.id, up);
          if (/yc_[a-zA-Z_]+|\{[a-z]+\}|undefined|NaN/.test(txt)) bad.push(c.id + (up ? "+" : "") + "：" + txt);
        });
      });
      return bad;
    });
    assert.deepStrictEqual(badCards, [], "語言 " + lang + " 的卡牌說明有問題：\n" + badCards.slice(0, 10).join("\n"));
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
