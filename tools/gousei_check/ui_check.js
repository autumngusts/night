// ============================================================================
// gousei（武俠合成）Playwright 流程檢查：
//   同一裝置：設定 → 開局任務確認（全員看過並隱藏才能開始）→ 大池子 → 池子下方展開任務 → 合成 → 結果
//            → 下一位（不再交接）→ 復原 → 重新整理還原 → 親手達成任務
//   分別裝置：QR 畫面 → 手機頁任務與共用裝置一致 → 無效連結
//   語音模式（假的辨識／朗讀）：朗讀輪到誰與池子 → 喚醒詞 → 「A 加 B」直接合成 → 自動換人 → 聽不懂重說
//   兩個主題都能載入；切換日文後名稱改變
// 前置：
//   1. py -3 generate.py
//   2. py -3 -m http.server 8943 --directory dist
// 執行：node tools/gousei_check/ui_check.js
// ============================================================================
"use strict";
var path = require("path");
var assert = require("assert");
var chromium = require(require.resolve("playwright", { paths: [path.join(__dirname, "..", "midnight_check")] })).chromium;

var BASE = process.env.GOUSEI_BASE || "http://localhost:8943/gousei/index.html";

function debugState(page) { return page.evaluate(function () { return window.PriTestGousei._debugState(); }); }

// 從主題資料找出「用目前池子就能一步合出」的配方
function findRecipeFor(page, resultId) {
  return page.evaluate(function (rid) {
    var th = window.PriTestGousei._theme();
    var keys = Object.keys(th.recipes);
    for (var i = 0; i < keys.length; i++) if (th.recipes[keys[i]] === rid) return keys[i].split("|");
    return null;
  }, resultId);
}

// 語音模式的替身：朗讀立即結束並記錄文字；辨識結果由 _voiceHeard() 注入
var VOICE_STUB = function () {
  window.__spoken = [];
  function FakeRec() {}
  FakeRec.prototype.start = function () {};
  FakeRec.prototype.abort = function () { var self = this; setTimeout(function () { if (self.onend) self.onend(); }, 0); };
  FakeRec.prototype.stop = FakeRec.prototype.abort;
  window.SpeechRecognition = FakeRec;
  window.webkitSpeechRecognition = FakeRec;
  var synth = {
    speak: function (u) { window.__spoken.push(u.text); setTimeout(function () { if (u.onend) u.onend(); }, 5); },
    cancel: function () {},
    getVoices: function () { return []; }
  };
  Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true });
};

function spoken(page) { return page.evaluate(function () { return window.__spoken.slice(); }); }
function voiceHeard(page, alts, isFinal) {
  return page.evaluate(function (args) { window.PriTestGousei._voiceHeard(args[0], args[1]); }, [alts, isFinal !== false]);
}
function waitSpoken(page, text) {
  return page.waitForFunction(function (s) { return window.__spoken.join("|").indexOf(s) >= 0; }, text);
}
function waitListening(page) {
  return page.waitForFunction(function () { return document.getElementById("gs-voice-status").textContent.indexOf("yo") >= 0; });
}

async function startGame(page, opts) {
  await page.goto(BASE);
  await page.evaluate(function () { localStorage.clear(); });
  await page.goto(BASE);
  await page.check('input[name=gs-theme][value="' + opts.theme + '"]');
  await page.check('input[name=gs-mode][value="' + opts.mode + '"]');
  await page.fill("#gs-player-count", String(opts.count));
  await page.dispatchEvent("#gs-player-count", "change");
  if (opts.voice) await page.check("#gs-voice-setup");
  await page.click("#gs-start");
  await page.waitForFunction(function () { return window.PriTestGousei._debugState() !== null; }, null, { timeout: 15000 });
}

// 開局確認：每位玩家查看再隱藏，然後正式開始
async function confirmAll(page, count) {
  await page.waitForSelector("#gs-confirm");
  for (var i = 1; i <= count; i++) {
    await page.click('button[data-reveal="p' + i + '"]');
    await page.click('button[data-reveal="p' + i + '"]');
  }
  await page.click("#gs-confirm-start");
}

(async function main() {
  var browser = await chromium.launch();
  var page = await browser.newPage();
  var pageErrors = [];
  page.on("pageerror", function (e) { pageErrors.push(String(e)); });

  // ---- 同一裝置：開局任務確認 ----
  await startGame(page, { theme: "wuxia", mode: "shared", count: 2 });
  await page.waitForSelector("#gs-confirm");
  assert.strictEqual(await page.locator('[id^="gs-targets-"]').count(), 0, "確認畫面一開始全部隱藏");
  assert.ok(await page.isDisabled("#gs-confirm-start"), "還沒人確認時不能開始");
  await page.click('button[data-reveal="p1"]');
  assert.strictEqual(await page.locator("#gs-targets-p1 li").count(), 3, "顯示 3 張任務");
  await page.click('button[data-reveal="p2"]');
  assert.strictEqual(await page.locator("#gs-targets-p1").count(), 0, "一次只展開一位");
  assert.strictEqual(await page.locator("#gs-targets-p2 li").count(), 3);
  assert.ok(await page.isDisabled("#gs-confirm-start"), "還有人展開著不能開始");
  await page.click('button[data-reveal="p2"]');
  // 確認進度存檔：重新整理後仍在確認畫面、已確認的不用重看
  await page.reload();
  await page.waitForSelector("#gs-confirm");
  assert.ok(!(await page.isDisabled("#gs-confirm-start")), "全員看過且已隱藏才能開始");
  await page.click("#gs-confirm-start");

  // ---- 遊戲畫面：池子約半個畫面、下方可查看各玩家任務 ----
  await page.waitForSelector("#gs-pool");
  assert.strictEqual(await page.locator("#gs-confirm").count(), 0);
  var poolBox = await page.locator("#gs-pool-list").boundingBox();
  var viewport = page.viewportSize();
  assert.ok(poolBox.height >= viewport.height * 0.45, "池子高度約半個畫面（" + poolBox.height + "/" + viewport.height + "）");
  assert.strictEqual(await page.locator('[id^="gs-targets-"]').count(), 0, "遊戲中任務預設隱藏");
  await page.click('#gs-player-targets button[data-reveal="p1"]');
  assert.strictEqual(await page.locator("#gs-targets-p1 li").count(), 3);

  await page.click('#gs-pool-list button[data-item="metal"]');
  await page.click('#gs-pool-list button[data-item="fire"]');
  await page.click("#gs-combine");
  await page.waitForSelector("#gs-result");
  assert.strictEqual(await page.locator('[id^="gs-targets-"]').count(), 0, "合成後任務自動收起");
  var st = await debugState(page);
  assert.strictEqual(st.log.length, 1);
  assert.strictEqual(st.turn, 1, "輪到第二位");
  await page.click("#gs-next");
  await page.waitForSelector("#gs-combine");
  assert.strictEqual(await page.locator("#gs-confirm").count(), 0, "每回合不再有交接畫面");

  // 復原：回到被復原的玩家，所有任務收起
  await page.click('#gs-player-targets button[data-reveal="p2"]');
  await page.click("#gs-undo");
  st = await debugState(page);
  assert.strictEqual(st.log.length, 0);
  assert.strictEqual(st.turn, 0);
  assert.strictEqual(await page.locator('[id^="gs-targets-"]').count(), 0, "復原後不顯示任務");

  // 重新整理：state 保留、任務隱藏
  await page.click('#gs-pool-list button[data-item="water"]');
  await page.click('#gs-pool-list button[data-item="water"]');
  await page.click("#gs-combine");
  await page.reload();
  await page.waitForSelector("#gs-pool");
  assert.strictEqual((await debugState(page)).log.length, 1);
  assert.strictEqual(await page.locator('[id^="gs-targets-"]').count(), 0);

  // 搜尋只重畫清單（輸入框維持焦點）
  await page.fill("#gs-pool-search", "水");
  assert.ok(await page.evaluate(function () { return document.activeElement.id === "gs-pool-search"; }));
  await page.fill("#gs-pool-search", "");

  // 親手達成：把目前玩家中階任務的兩個材料放進池子，合成後應達成
  st = await debugState(page);
  var cur = st.players[st.turn];
  var pair = await findRecipeFor(page, cur.targets[0]);
  assert.ok(pair, "中階任務要有配方");
  st.pool = st.pool.concat(pair.filter(function (id) { return st.pool.indexOf(id) < 0; }));
  await page.evaluate(function (s) { localStorage.setItem("pritest-gousei-state", JSON.stringify(s)); }, st);
  await page.reload();
  await page.waitForSelector("#gs-pool");
  await page.click('#gs-pool-list button[data-item="' + pair[0] + '"]');
  await page.click('#gs-pool-list button[data-item="' + pair[1] + '"]');
  await page.click("#gs-combine");
  await page.waitForSelector("#gs-result.gs-achieved");
  st = await debugState(page);
  assert.deepStrictEqual(st.players[cur.id === "p1" ? 0 : 1].done, [cur.targets[0]]);

  // 日文切換：結果標題變成「○○ の合成結果」（中文是「○○ 的合成結果」）
  await page.evaluate(function () { window.I18N.setLang("ja"); });
  assert.ok((await page.textContent("#gs-result")).indexOf("の合成結果") >= 0, "切換日文後重畫");
  await page.evaluate(function () { window.I18N.setLang("zh"); });

  // ---- 分別裝置 ----
  await startGame(page, { theme: "wafu", mode: "split", count: 3 });
  await page.waitForSelector("#gs-qr-screen");
  await page.click('button[data-qr-player="1"]');
  await page.waitForSelector("#gs-qr-canvas");
  var url = await page.inputValue("#gs-qr-url");
  st = await debugState(page);
  var phone = await browser.newPage();
  await phone.goto(url);
  await phone.waitForSelector("#gs-join-toggle");
  await phone.click("#gs-join-toggle");
  var phoneTargets = await phone.$$eval("#gs-join-targets li", function (lis) { return lis.map(function (li) { return li.getAttribute("data-target"); }); });
  assert.deepStrictEqual(phoneTargets, st.players[1].targets, "手機任務與共用裝置一致");
  await phone.goto(BASE + "?join=garbage");
  await phone.waitForSelector("#gs-join.gs-error");
  await phone.close();

  await page.click("#gs-qr-continue");
  assert.strictEqual(await page.locator('[id^="gs-targets-"], [data-reveal]').count(), 0, "分別裝置模式不在共用裝置顯示任務");
  assert.strictEqual(await page.locator("#gs-show-qr").count(), 1);
  await page.click('#gs-pool-list button[data-item="thunder"]');
  await page.click('#gs-pool-list button[data-item="wind"]');
  await page.click("#gs-combine");
  await page.click("#gs-next");
  assert.strictEqual(await page.locator("#gs-confirm").count(), 0, "分別裝置模式沒有任務確認畫面");

  // ---- 語音模式：以假的 SpeechRecognition／speechSynthesis 模擬 ----
  var vctx = await browser.newContext();
  await vctx.addInitScript(VOICE_STUB);
  var vpage = await vctx.newPage();
  vpage.on("pageerror", function (e) { pageErrors.push(String(e)); });
  await startGame(vpage, { theme: "wuxia", mode: "shared", count: 2, voice: true });
  await vpage.waitForSelector("#gs-confirm");
  assert.ok(await vpage.evaluate(function () { return window.PriTestGousei._voiceOn(); }), "勾選後開局即開啟語音");
  assert.deepStrictEqual(await spoken(vpage), [], "確認畫面不朗讀");
  await confirmAll(vpage, 2);
  await waitSpoken(vpage, "輪到 玩家1");
  await waitSpoken(vpage, "什麼加什麼"); // 最後一段：玩法說明
  var said = (await spoken(vpage)).join("|");
  ["金", "木", "水", "火", "土"].forEach(function (n) { assert.ok(said.indexOf(n) >= 0, "朗讀池子：" + n); });
  await waitListening(vpage);
  await vpage.waitForFunction(function () { return window.PriTestGousei._pinyinReady(); });

  // 喚醒詞（即時結果就先響提示音）→ 說「今家火」（金加火的同音字）→ 直接合成 → 念結果 → 自動換下一位並朗讀
  await voiceHeard(vpage, ["你好"]);
  assert.strictEqual((await debugState(vpage)).log.length, 0, "沒有喚醒詞不動作");
  await voiceHeard(vpage, ["有阿基"], false);
  assert.ok((await vpage.textContent("#gs-voice-status")).indexOf("加") >= 0, "即時結果聽到喚醒詞就提示說 A 加 B");
  await voiceHeard(vpage, ["有阿基"]);
  assert.strictEqual((await debugState(vpage)).log.length, 0, "最終結果只有喚醒詞：繼續等指令");
  assert.ok((await vpage.textContent("#gs-voice-status")).indexOf("加") >= 0);
  await voiceHeard(vpage, ["今家火"]);
  st = await debugState(vpage);
  assert.strictEqual(st.log.length, 1);
  assert.deepStrictEqual([st.log[0].a, st.log[0].b], ["metal", "fire"]);
  await waitSpoken(vpage, "輪到 玩家2");
  assert.strictEqual(await vpage.locator("#gs-result").count(), 0, "念完結果自動換下一位");
  assert.strictEqual((await debugState(vpage)).turn, 1);

  // 聽不懂 → 請再說一次；一口氣說「yo アキ 水加水」也可以
  await waitListening(vpage);
  await voiceHeard(vpage, ["喲阿基"]);
  await voiceHeard(vpage, ["隨便說說"]);
  await waitSpoken(vpage, "聽不懂");
  assert.strictEqual((await debugState(vpage)).log.length, 1);
  await vpage.waitForFunction(function () { return document.getElementById("gs-voice-status").textContent.indexOf("加") >= 0; });
  await voiceHeard(vpage, ["水加水"]);
  st = await debugState(vpage);
  assert.strictEqual(st.log.length, 2, "重說後合成");
  // 第 2 輪又輪到玩家1：「輪到 玩家1」第二次被朗讀
  await vpage.waitForFunction(function () {
    return window.__spoken.filter(function (s) { return s.indexOf("輪到 玩家1") >= 0; }).length >= 2;
  });
  await waitListening(vpage);
  await voiceHeard(vpage, ["yo アキ 土加土"]);
  st = await debugState(vpage);
  assert.strictEqual(st.log.length, 3, "喚醒詞和指令一口氣說完");
  assert.deepStrictEqual([st.log[2].a, st.log[2].b], ["earth", "earth"]);

  // 備用：按「直接說」按鈕，不用喚醒詞
  await vpage.waitForFunction(function () {
    return window.__spoken.filter(function (s) { return s.indexOf("輪到 玩家2") >= 0; }).length >= 2;
  });
  await waitListening(vpage);
  await vpage.click("#gs-voice-talk");
  assert.ok((await vpage.textContent("#gs-voice-status")).indexOf("加") >= 0, "按鈕後直接等指令");
  await voiceHeard(vpage, ["睡和吐"]);
  st = await debugState(vpage);
  assert.strictEqual(st.log.length, 4, "按鈕說話合成");
  assert.deepStrictEqual([st.log[3].a, st.log[3].b], ["water", "earth"]);

  // 訓練喚醒詞：說三次「開始合成」→ 之後用它喚醒
  await waitListening(vpage);
  await vpage.click("#gs-voice-train");
  assert.ok((await vpage.textContent("#gs-voice-status")).indexOf("1/3") >= 0, "訓練提示");
  await voiceHeard(vpage, ["開始合成"]);
  await voiceHeard(vpage, ["開始和成"]);
  assert.strictEqual((await debugState(vpage)).log.length, 4, "訓練中不會合成");
  await voiceHeard(vpage, ["開始合成"]);
  assert.deepStrictEqual(await vpage.evaluate(function () { return window.PriTestGousei._wakeTemplates(); }), ["開始合成", "開始和成"]);
  await waitListening(vpage);
  await voiceHeard(vpage, ["凱始合成"]);
  assert.ok((await vpage.textContent("#gs-voice-status")).indexOf("加") >= 0, "訓練過的詞（同音也可）能喚醒");
  await voiceHeard(vpage, ["火加木"]);
  st = await debugState(vpage);
  assert.strictEqual(st.log.length, 5);
  assert.deepStrictEqual([st.log[4].a, st.log[4].b], ["fire", "wood"]);
  await vpage.waitForSelector("#gs-voice-train-clear");
  await vpage.click("#gs-voice-train-clear");
  assert.deepStrictEqual(await vpage.evaluate(function () { return window.PriTestGousei._wakeTemplates(); }), []);

  // 關閉語音模式後不再反應
  await vpage.waitForSelector("#gs-voice-toggle");
  await vpage.click("#gs-voice-toggle");
  assert.ok(!(await vpage.evaluate(function () { return window.PriTestGousei._voiceOn(); })));
  await voiceHeard(vpage, ["yo アキ 金加金"]);
  assert.strictEqual((await debugState(vpage)).log.length, 5);
  await vctx.close();

  assert.deepStrictEqual(pageErrors, [], "頁面不應有 JS 錯誤");
  await browser.close();
  console.log("gousei ui_check OK");
})().catch(function (e) { console.error(e); process.exit(1); });
