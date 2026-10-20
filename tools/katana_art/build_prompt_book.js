// ============================================================================
// katana 生圖手冊：參考圖＋可直接複製的提示詞，一頁看完（2026-10-20）
//   1. 用遊戲本身的繪圖（window.PriTestKatana._artRef）替每個刀種輸出參考圖：
//        docs/katana_art/ref/top/<id>.png   512×512，白底、淺灰十字標中心、虛線圓標刀尖位置（與提示詞要求的構圖相同）
//        docs/katana_art/ref/side/<id>.png  768×512，白底、側視（與提示詞要求的 1536×1024 同比例）
//   2. 讀 docs/katana_art_manifest.json，把參考圖嵌進 tools/katana_art/prompt_book_template.html，
//      輸出 docs/katana_art_prompts.html（單一檔案，瀏覽器直接打開就能用）
// 前置：
//   1. node tools/katana_art/export_manifest.js
//   2. py -3 generate.py
//   3. py -3 -m http.server 8944 --directory dist
// 執行：node tools/katana_art/build_prompt_book.js
// ============================================================================
"use strict";
var fs = require("fs");
var path = require("path");
var chromium = require(require.resolve("playwright", { paths: [path.join(__dirname, "..", "midnight_check")] })).chromium;

var ROOT = path.join(__dirname, "..", "..");
var BASE = process.env.KATANA_BASE || "http://localhost:8944/katana/index.html";
var REF_DIR = path.join(ROOT, "docs", "katana_art", "ref");
var manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "docs", "katana_art_manifest.json"), "utf8"));

function mkdirp(d) { fs.mkdirSync(d, { recursive: true }); }

(async function () {
  var browser = await chromium.launch();
  var page = await browser.newPage();
  await page.goto(BASE);
  await page.waitForFunction(function () { return window.PriTestKatana && window.PriTestKatana._artRef; });
  mkdirp(path.join(REF_DIR, "top"));
  mkdirp(path.join(REF_DIR, "side"));

  var refs = await page.evaluate(async function (ids) {
    var R = window.PriTestKatana._artRef;
    function bg(ctx, w, hgt) { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalCompositeOperation = "destination-over"; ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, w, hgt); ctx.restore(); }
    var out = {};
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i];
      // 俯視：遊戲的剪影＋中心十字＋刀尖位置的虛線圓
      var c = document.createElement("canvas"); c.width = 512; c.height = 512;
      R.top(c, id, "#c8c8c8");
      var ctx = c.getContext("2d");
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = "destination-over";
      ctx.strokeStyle = "#cfcfcf"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(256, 0); ctx.lineTo(256, 512); ctx.moveTo(0, 256); ctx.lineTo(512, 256); ctx.stroke();
      var snap = R.snap(id);
      var bt = window.PriTestKatanaCore.byId(window.PriTestKatanaData.BLADE_TYPES, id);
      var pole = !!bt.shaft || bt.id === "yari"; // 同 katana.js 的 glyphOf
      ctx.setLineDash([4, 6]);
      ctx.beginPath(); ctx.arc(256, 256, 512 * (pole ? 0.38 : 0.45), 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      bg(ctx, 512, 512);
      var top = c.toDataURL("image/png");
      // 側視：遊戲的 SVG 畫進 768×512，左右留邊、垂直置中
      var svgText = R.side(id);
      svgText = svgText.slice(svgText.indexOf("<svg"), svgText.lastIndexOf("</svg>") + 6); // bladeSvg 外面包著 div
      if (svgText.indexOf("xmlns=") < 0) svgText = svgText.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
      var img = new Image();
      await new Promise(function (res, rej) { img.onload = res; img.onerror = rej; img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgText); });
      var s = document.createElement("canvas"); s.width = 768; s.height = 512;
      var sx = s.getContext("2d");
      var vb = (svgText.match(/viewBox="([^"]+)"/) || [])[1];
      var vw = img.width || 600, vh = img.height || 150;
      if (vb) { var p = vb.split(/[\s,]+/).map(Number); vw = p[2]; vh = p[3]; }
      var sc = Math.min(720 / vw, 460 / vh);
      sx.drawImage(img, (768 - vw * sc) / 2, (512 - vh * sc) / 2, vw * sc, vh * sc);
      bg(sx, 768, 512);
      out[id] = { top: top, side: s.toDataURL("image/png"), pole: pole, snapType: snap.type };
    }
    return out;
  }, manifest.blades.map(function (b) { return b.id; }));
  await browser.close();

  manifest.blades.forEach(function (b) {
    var r = refs[b.id];
    if (r.pole !== b.pole) throw new Error("pole mismatch " + b.id);
    fs.writeFileSync(path.join(ROOT, b.reference.top), Buffer.from(r.top.split(",")[1], "base64"));
    fs.writeFileSync(path.join(ROOT, b.reference.side), Buffer.from(r.side.split(",")[1], "base64"));
    b.refTop = r.top;
    b.refSide = r.side;
  });

  var data = { blades: manifest.blades, cards: manifest.cards, specials: manifest.specials, common_vfx: manifest.common_vfx };
  var json = JSON.stringify(data).replace(/<\//g, "<\\/");
  var tpl = fs.readFileSync(path.join(__dirname, "prompt_book_template.html"), "utf8");
  var html = tpl.replace("__DATA__", function () { return json; });
  // docs 版：本機直接打開用，補上 doctype 與 charset
  var outFile = path.join(ROOT, "docs", "katana_art_prompts.html");
  fs.writeFileSync(outFile, "<!doctype html>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1, viewport-fit=cover\">\n" + html);
  // 發佈用（Artifact 會自己包 doctype）：只有在指定環境變數時輸出
  if (process.env.KATANA_BOOK_ARTIFACT) fs.writeFileSync(process.env.KATANA_BOOK_ARTIFACT, html);
  console.log("wrote", path.relative(ROOT, outFile), Math.round(fs.statSync(outFile).size / 1024) + " KB, refs", manifest.blades.length * 2);
})().catch(function (e) { console.error(e); process.exit(1); });
