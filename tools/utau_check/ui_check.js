// ============================================================================
// utau（我不會唱歌）Playwright 流程檢查：
//   基本模式：結算／復原／重新整理還原
//   進階模式：匯入題庫包 zip（測試內產生）、版本篩選、播放鍵就緒、出題者偷看、公布答案的原曲、重新整理後題庫包仍在
//   夢想模式：輸入 YouTube 網址（錯誤網址提示）、浮動播放器、結算後的答案連結、切換日文
// 前置：
//   1. py -3 generate.py
//   2. py -3 -m http.server 8942 --directory dist
// 執行：node tools/utau_check/ui_check.js
// ============================================================================
"use strict";
var fs = require("fs");
var os = require("os");
var path = require("path");
var assert = require("assert");
var chromium = require(require.resolve("playwright", { paths: [path.join(__dirname, "..", "midnight_check")] })).chromium;

var BASE = process.env.UTAU_BASE || "http://localhost:8942/utau/index.html";

function debugState(page) { return page.evaluate(function () { return window.PriTestUtau._debugState(); }); }

// ---- 測試用題庫包：STORED zip（與 build_pack.py 的輸出格式相同）----
var CRC_TABLE = (function () {
  var table = [];
  for (var n = 0; n < 256; n++) {
    var c = n;
    for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table.push(c >>> 0);
  }
  return table;
})();
function crc32(buf) {
  var c = 0xffffffff;
  for (var i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function storedZip(files) {
  var locals = [];
  var centrals = [];
  var offset = 0;
  files.forEach(function (f) {
    var name = Buffer.from(f.name, "utf8");
    var data = f.data;
    var crc = crc32(data);
    var lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x800, 6);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(name.length, 26);
    locals.push(lh, name, data);
    var ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x800, 8);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(offset, 42);
    centrals.push(ch, name);
    offset += 30 + name.length + data.length;
  });
  var cd = Buffer.concat(centrals);
  var end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat(locals.concat([cd, end]));
}
function makeTestPack() {
  var variants = ["original", "instrumental", "vocal", "other", "speed", "chip", "vocal_rev", "rhythm", "reverse",
    "zh_read", "zh_sing", "zh_sing_inst", "ja_sing", "ja_sing_inst"];  // zh_read：舊包才有，遊戲要忽略
  var songs = [
    { id: "ja:紅蓮華", t: "紅蓮華", a: "LiSA", y: 2019, r: "ja", c: "anime", key: "aaa" },
    { id: "ja:Lemon", t: "Lemon", a: "米津玄師", y: 2018, r: "ja", c: "screen", key: "bbb" }
  ];
  var files = [];
  songs.forEach(function (s) {
    s.clips = {};
    variants.forEach(function (v) {
      var arc = "clips/" + s.key + "/" + v + ".m4a";
      s.clips[v] = arc;
      files.push({ name: arc, data: Buffer.from("fake-audio-" + s.key + "-" + v) });
    });
    delete s.key;
  });
  var manifest = { format: "pritest-utau-pack", version: 1, clipSeconds: 15, songs: songs };
  files.unshift({ name: "manifest.json", data: Buffer.from(JSON.stringify(manifest), "utf8") });
  var file = path.join(os.tmpdir(), "utau_test_pack.zip");
  fs.writeFileSync(file, storedZip(files));
  return file;
}

(async function main() {
  var packFile = makeTestPack();
  var browser = await chromium.launch();
  var page = await browser.newPage();
  var errors = [];
  page.on("pageerror", function (e) { errors.push(String(e)); });

  await page.goto(BASE);
  await page.evaluate(function () {
    localStorage.clear();
    localStorage.setItem("pritest-lang", "zh");
    return new Promise(function (resolve) {
      var r = indexedDB.deleteDatabase("pritest-utau-pack");
      r.onsuccess = r.onerror = r.onblocked = function () { resolve(); };
    });
  });
  await page.reload();

  // ================= 基本模式 =================
  await page.fill("#ut-player-count", "3");
  await page.dispatchEvent("#ut-player-count", "change");
  assert.strictEqual(await page.locator(".ut-name-input").count(), 3);
  assert.strictEqual(await page.locator(".ut-score-input").count(), 3);
  await page.fill(".ut-name-input[data-index='0']", "阿明");
  await page.fill(".ut-score-input[data-k='1']", "5");
  await page.fill("#ut-ai-bonus", "2");
  await page.click("#ut-btn-start");

  var s = await debugState(page);
  assert.strictEqual(s.config.players[0].name, "阿明");
  assert.deepStrictEqual(s.config.scoreTable, [0, 5, 1]);
  assert.strictEqual(s.round, 1);

  var singer = s.current.singerId;
  var guesser = s.config.players.map(function (p) { return p.id; }).filter(function (id) { return id !== singer; })[0];
  assert.strictEqual(await page.locator(".ut-player-toggle").count(), 2, "singer is not a guesser");
  await page.click("#ut-btn-ai");
  await page.click(".ut-player-toggle[data-player='" + guesser + "']");
  assert.ok((await page.textContent("#ut-preview")).indexOf("+7") >= 0, "preview shows singer 5+2");
  await page.click("#ut-btn-settle");
  s = await debugState(page);
  assert.strictEqual(s.scores[singer], 7);
  assert.strictEqual(s.scores[guesser], 5);
  assert.strictEqual(s.round, 2);
  assert.strictEqual(await page.locator("#ut-btn-ai.ut-on").count(), 0, "toggles reset for the new round");

  await page.click("#ut-btn-undo");
  s = await debugState(page);
  assert.strictEqual(s.round, 1);
  assert.strictEqual(s.scores[singer], 0);
  await page.click("#ut-btn-settle");

  await page.reload();
  s = await debugState(page);
  assert.strictEqual(s.round, 2);

  // ================= 進階模式（題庫包）=================
  await page.click("#ut-btn-finish");
  assert.ok(await page.locator("#ut-winner").isVisible());
  await page.click("#ut-btn-back-setup");
  assert.strictEqual(await page.locator(".ut-name-input").count(), 3, "previous config is reused");
  await page.check("#ut-mode-advanced");
  await page.waitForSelector("#ut-pack-status");
  assert.ok((await page.textContent("#ut-pack-status")).indexOf("0") >= 0);
  await page.click("#ut-btn-start");
  assert.ok((await page.textContent(".ut-error")).length > 0, "cannot start without a pack");

  await page.setInputFiles("#ut-pack-file", packFile);
  await page.waitForFunction(function () {
    var m = document.getElementById("ut-pack-msg");
    return m && m.textContent.indexOf("2") >= 0 && document.getElementById("ut-pool-size");
  });
  assert.ok((await page.textContent("#ut-pack-status")).indexOf("2") >= 0);
  // 只留純樂器、只留動漫
  for (var v of ["vocal", "other", "speed", "chip", "vocal_rev", "rhythm", "reverse", "zh_sing", "ja_sing"]) await page.uncheck("#ut-variant-" + v);
  assert.strictEqual(await page.$("#ut-variant-zh_read"), null);  // 中文朗讀已拿掉（2026-10-17）
  await page.uncheck("#ut-cat-screen");
  assert.ok((await page.textContent("#ut-pool-size")).indexOf("1") >= 0);
  await page.click("#ut-btn-start");

  s = await debugState(page);
  assert.strictEqual(s.config.mode, "advanced");
  assert.strictEqual(s.current.songId, "ja:紅蓮華");
  assert.strictEqual(s.current.variant, "instrumental");
  assert.ok((await page.textContent("#ut-variant-badge")).indexOf("純樂器") >= 0);
  await page.waitForSelector("#ut-btn-play:not([disabled])");
  assert.strictEqual(await page.locator("#ut-song-card").count(), 0, "answer hidden before peek");
  await page.click("#ut-btn-reveal");
  assert.strictEqual(await page.textContent(".ut-song-title"), "紅蓮華");
  await page.click("#ut-btn-hide");
  await page.click("#ut-btn-settle");
  assert.ok((await page.textContent("#ut-last-round")).indexOf("紅蓮華") >= 0, "answer shown after scoring");
  await page.waitForSelector("#ut-btn-play-answer:not([disabled])");
  // 讀回存在 IndexedDB 的音檔內容，確認是對的那一段
  var clipText = await page.evaluate(function () {
    var song = window.PriTestUtau._debugState().config.packSongs.filter(function (x) { return x.id === "ja:紅蓮華"; })[0];
    return window.PriTestUtauPack.getClip(song, "original").then(function (b) { return b.text(); });
  });
  assert.strictEqual(clipText, "fake-audio-aaa-original");

  // 重新整理後題庫包還在、播放鍵會再就緒
  await page.reload();
  await page.waitForSelector("#ut-btn-play:not([disabled])");

  // ---- 中文歌聲的提示：播放 5 次後才能加上伴奏，不扣分 ----
  await page.click("#ut-btn-finish");
  await page.click("#ut-btn-back-setup");
  await page.check("#ut-mode-advanced");
  await page.waitForSelector("#ut-pool-size");
  await page.uncheck("#ut-variant-instrumental");
  await page.check("#ut-variant-zh_sing");
  await page.check("#ut-cat-screen");
  await page.click("#ut-btn-start");
  s = await debugState(page);
  assert.strictEqual(s.current.variant, "zh_sing");
  assert.strictEqual(await page.locator("#ut-variant-zh_sing_inst").count(), 0, "hint clip is not a selectable version");
  await page.waitForSelector("#ut-btn-play:not([disabled])");
  assert.ok(await page.locator("#ut-btn-hint[disabled]").isVisible(), "hint locked at first");
  assert.ok(await page.locator("#ut-ai-credit").isVisible(), "AI voice credit shown");
  for (var n = 0; n < 5; n++) await page.dispatchEvent("#ut-btn-play", "click");
  s = await debugState(page);
  assert.strictEqual(s.current.plays, 5);
  await page.waitForSelector("#ut-btn-hint:not([disabled])");
  var hintSinger = s.current.singerId;
  await page.click("#ut-btn-hint");
  assert.ok(await page.locator("#ut-hint-on").isVisible());
  // 提示後主播放器換成「歌聲＋伴奏」的音檔
  await page.waitForSelector("#ut-btn-play:not([disabled])");
  var hintGuesser = s.config.players.map(function (p) { return p.id; }).filter(function (id) { return id !== hintSinger; })[0];
  await page.click(".ut-player-toggle[data-player='" + hintGuesser + "']");
  var beforeHint = (await debugState(page)).scores[hintSinger];
  await page.click("#ut-btn-settle");
  s = await debugState(page);
  assert.strictEqual(s.history[s.history.length - 1].hint, true);
  assert.strictEqual(s.scores[hintSinger] - beforeHint, s.config.scoreTable[1], "hint does not change scoring");
  assert.ok((await page.textContent("#ut-last-round")).indexOf("用了提示") >= 0, "history shows the hint");

  // ================= 夢想模式（YouTube）=================
  await page.click("#ut-btn-finish");
  await page.click("#ut-btn-back-setup");
  await page.check("#ut-mode-dream");
  await page.fill("#ut-clip-seconds", "10");
  await page.check("#ut-random-speed");
  await page.click("#ut-btn-start");
  s = await debugState(page);
  assert.strictEqual(s.config.mode, "dream");
  assert.strictEqual(s.config.clipSeconds, 10);
  assert.ok([0.75, 1.25].indexOf(s.current.dream.rate) >= 0);
  assert.ok(await page.locator("#ut-rate-badge").count() === 0, "rate badge only after the link is set");
  assert.ok(await page.locator("#ut-yt-host:visible").count() === 0, "no player before a link is set");

  await page.click("#ut-btn-reveal");
  await page.fill("#ut-dream-url", "https://example.com/nope");
  await page.click("#ut-btn-dream-set");
  assert.ok((await page.textContent("#ut-topic .ut-error")).length > 0, "bad url rejected");
  await page.fill("#ut-dream-url", "https://youtu.be/dQw4w9WgXcQ?si=x");
  await page.click("#ut-btn-dream-set");
  s = await debugState(page);
  assert.strictEqual(s.current.dream.videoId, "dQw4w9WgXcQ");
  assert.strictEqual(await page.locator("#ut-dream-url").count(), 0, "url input hidden after setting");
  assert.ok(await page.locator("#ut-yt-host").isVisible(), "floating player shown");
  assert.ok(await page.locator("#ut-rate-badge").isVisible());

  await page.click("#ut-btn-settle");
  assert.strictEqual(await page.getAttribute("#ut-answer-link", "href"), "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  s = await debugState(page);
  assert.strictEqual(s.current.dream.videoId, null);
  assert.strictEqual(await page.locator("#ut-yt-host:visible").count(), 0, "player hidden until the next link");

  // ---- 切換日文 ----
  await page.evaluate(function () { window.I18N.setLang("ja"); });
  assert.ok((await page.textContent("#ut-round-title")).indexOf("ラウンド") >= 0);

  // ---- 同設定再玩 ----
  await page.click("#ut-btn-finish");
  await page.click("#ut-btn-replay");
  s = await debugState(page);
  assert.strictEqual(s.round, 1);
  assert.strictEqual(s.history.length, 0);
  assert.strictEqual(s.config.mode, "dream");

  // ---- 首頁有入口 ----
  await page.goto(BASE.replace("utau/index.html", "index.html"));
  assert.ok(await page.locator("a[href='utau/index.html']").count() > 0);

  assert.deepStrictEqual(errors, []);
  await browser.close();
  console.log("utau ui_check OK");
})().catch(function (e) {
  console.error(e);
  process.exit(1);
});
