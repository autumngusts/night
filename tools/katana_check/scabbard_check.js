// ============================================================================
// katana 刀鞘檢查（2026-10-20）：上限 50 把・滿了擋下並提示・整個刀鞘匯出／匯入（合併／覆蓋）・
//   uid 與戰績帶著走・邀請碼帶原主 uid（客刀 uid＝guest|<原主 uid>）
// 前置：
//   1. py -3 generate.py
//   2. py -3 -m http.server 8944 --directory dist
// 執行：node tools/katana_check/scabbard_check.js
// ============================================================================
"use strict";
var path = require("path");
var assert = require("assert");
var chromium = require(require.resolve("playwright", { paths: [path.join(__dirname, "..", "midnight_check")] })).chromium;

var BASE = process.env.KATANA_BASE || "http://localhost:8944/katana/index.html";

function sc(page) { return page.evaluate(function () { return window.PriTestKatana._scabbard(); }); }

async function clickKey(page, key) {
  var ok = await page.evaluate(function (k) {
    var label = window.I18N.t(k);
    var b = Array.prototype.filter.call(document.querySelectorAll("#kt-app button"), function (x) { return x.textContent.trim() === label && !x.disabled; })[0];
    if (!b) return false;
    b.click();
    return true;
  }, key);
  assert.ok(ok, "button not found: " + key);
}

// 用 NPC 刀的快照組出 n 把刀的匯出資料（走正式的匯入路徑，不手寫 localStorage）
function fixture(page, n, prefix, rec) {
  return page.evaluate(function (a) {
    var Core = window.PriTestKatanaCore, D = window.PriTestKatanaData;
    var swords = [];
    for (var i = 0; i < a[0]; i++) {
      var snap = Core.npcSnapshot(D.NPC_SWORDS[i % D.NPC_SWORDS.length]);
      snap.name = a[1] + i;
      snap.uid = a[1] + "-" + i;
      swords.push({ uid: a[1] + "-" + i, snap: snap, guest: false, rec: { w: a[2], l: 1 }, saved: 1000 + i });
    }
    return JSON.stringify({ kind: "pritest-katana-scabbard", v: 1, exported: Date.now(), swords: swords });
  }, [n, prefix, rec]);
}

async function importText(page, text, mode) {
  await page.evaluate(function (a) {
    var area = document.querySelector(".kt-sc-import");
    area.value = a[0];
    area.dispatchEvent(new Event("input"));
    var r = document.querySelector('input[name="scImportMode"][value="' + a[1] + '"]');
    if (!r.checked) { r.checked = true; r.dispatchEvent(new Event("change")); }
  }, [text, mode]);
  await clickKey(page, "kt_sc_tr_import_go");
}

(async function () {
  var browser = await chromium.launch();
  var page = await browser.newPage();
  var errors = [];
  page.on("pageerror", function (e) { errors.push(String(e)); });
  await page.goto(BASE);
  await page.evaluate(function () { localStorage.clear(); });
  await page.reload();
  await page.waitForSelector(".kt-sc-transfer");
  assert.strictEqual(await page.evaluate(function () { return window.PriTestKatana._scMax; }), 50);

  // 壞資料
  await importText(page, "KTSC1.garbage", "merge");
  assert.ok(await page.locator(".kt-sc-transfer .kt-error").count() > 0, "bad code shows error");
  assert.strictEqual((await sc(page)).swords.length, 0);

  // 合併匯入 49 把 → 再匯入 3 把：只放得下 1 把、2 把略過
  await importText(page, await fixture(page, 49, "a", 2), "merge");
  assert.strictEqual((await sc(page)).swords.length, 49);
  await importText(page, await fixture(page, 3, "b", 0), "merge");
  var s = await sc(page);
  assert.strictEqual(s.swords.length, 50, "capped at 50");
  var msg = await page.locator(".kt-sc-tr-msg").textContent();
  assert.ok(msg.indexOf("2") >= 0, "skipped reported: " + msg);
  assert.strictEqual(await page.locator(".kt-sc-full").count(), 1, "full warning shown");

  // 已滿時收下客刀：擋下並提示，刀鞘不變
  var guestSnap = await page.evaluate(function () {
    var snap = window.PriTestKatanaCore.npcSnapshot(window.PriTestKatanaData.NPC_SWORDS[0]);
    snap.name = "客"; snap.uid = "kfriend0001";
    return window.PriTestKatana._encode(snap);
  });
  await page.goto(BASE + "?duel=" + guestSnap);
  await page.waitForSelector(".kt-invite-panel");
  await clickKey(page, "kt_inv_keep");
  assert.ok((await page.locator(".kt-invite-panel .kt-error").count()) === 1, "invite full error");
  assert.strictEqual((await sc(page)).swords.length, 50);

  // 匯出 → 刀鞘碼帶 uid 與戰績
  await clickKey(page, "kt_sc_tr_code");
  var code = await page.locator(".kt-sc-code").inputValue();
  assert.ok(code.indexOf("KTSC1.") === 0);
  var parsed = await page.evaluate(function (c) { return window.PriTestKatana._scParse(c); }, code);
  assert.strictEqual(parsed.length, 50);
  var a0 = parsed.filter(function (x) { return x.uid === "a-0"; })[0];
  assert.ok(a0 && a0.rec.w === 2 && a0.rec.l === 1 && a0.snap.uid === "a-0", "uid + record exported");

  // 合併：同 uid 勝敗取大、較新快照覆蓋
  var upd = JSON.parse(await fixture(page, 1, "a", 9));
  upd.swords[0].snap.name = "改名"; upd.swords[0].saved = Date.now();
  await importText(page, JSON.stringify(upd), "merge");
  s = await sc(page);
  var a0b = s.swords.filter(function (x) { return x.uid === "a-0"; })[0];
  assert.deepStrictEqual(a0b.rec, { w: 9, l: 1 });
  assert.strictEqual(a0b.snap.name, "改名");
  assert.strictEqual(s.swords.length, 50);

  // 覆蓋：要確認一次
  await importText(page, await fixture(page, 2, "c", 4), "replace");
  assert.strictEqual((await sc(page)).swords.length, 50, "not replaced before confirm");
  await clickKey(page, "kt_sc_tr_replace_yes");
  s = await sc(page);
  assert.strictEqual(s.swords.length, 2);
  assert.ok(s.swords.every(function (x) { return x.uid.indexOf("c-") === 0 && x.rec.w === 4; }));
  assert.strictEqual(await page.locator(".kt-sc-full").count(), 0);

  // 有空位時收下客刀：uid＝guest|<原主 uid>；再收一次不會變兩把
  await page.goto(BASE + "?duel=" + guestSnap);
  await page.waitForSelector(".kt-invite-panel");
  await clickKey(page, "kt_inv_keep");
  s = await sc(page);
  assert.strictEqual(s.swords[0].uid, "guest|kfriend0001");
  assert.strictEqual(s.swords.length, 3);
  // 客刀再轉邀請：原主 uid 不變
  var inv = await page.evaluate(function () {
    var x = window.PriTestKatana._scabbard().swords[0];
    return window.PriTestKatana._decode(window.PriTestKatana._encode(x.snap)).uid;
  });
  assert.strictEqual(inv, "kfriend0001");

  if (errors.length) console.log("ERRORS", errors);
  assert.deepStrictEqual(errors, []);
  await browser.close();
  console.log("katana scabbard_check OK");
})().catch(function (e) { console.error(e); process.exit(1); });
