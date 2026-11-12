// ============================================================================
// 緣日樂園：Blender 版 VRM 的建置入口（2026-11-12）
//   1. 用 tools/ennichi_model/build_vrm.js 的 SVG 畫五官貼圖，經 Playwright 轉成 PNG（暫存資料夾）
//   2. 背景執行 Blender：blender -b -P build_sayo.py -- --tex <暫存> --out static_src/models/ennichi/sayo_blender.vrm
// 前置：
//   * Blender 4.2 以上（找不到時用環境變數 BLENDER 指定 blender.exe）
//   * VRM Add-on for Blender 已安裝成擴充（blender --command extension install-file -r user_default -e <zip>）
//   * tools/midnight_check 已 npm install（借用其中的 playwright）
// 用法：node tools/ennichi_blender/build.js [--no-cloth]
// ============================================================================
"use strict";
var fs = require("fs");
var os = require("os");
var path = require("path");
var cp = require("child_process");
var tex = require("../ennichi_model/build_vrm.js");

var ROOT = path.join(__dirname, "..", "..");
var OUT = path.join(ROOT, "static_src", "models", "ennichi", "sayo_blender.vrm");

function findBlender() {
  if (process.env.BLENDER) return process.env.BLENDER;
  var base = "C:\\Program Files\\Blender Foundation";
  if (fs.existsSync(base)) {
    var dirs = fs.readdirSync(base).filter(function (d) { return /^Blender/.test(d); }).sort().reverse();
    for (var i = 0; i < dirs.length; i++) {
      var exe = path.join(base, dirs[i], "blender.exe");
      if (fs.existsSync(exe)) return exe;
    }
  }
  return "blender";
}

(async function () {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), "ennichi-tex-"));
  var c = tex.SAYO;
  var png = await tex.rasterize({ face: tex.faceSvg(c), eye: tex.eyeSvg(c), mouth: tex.mouthSvg(), lid: tex.lidSvg(c) });
  Object.keys(png).forEach(function (k) { fs.writeFileSync(path.join(dir, k + ".png"), png[k]); });
  var args = ["-b", "-P", path.join(__dirname, "build_sayo.py"), "--", "--tex", dir, "--out", OUT, "--cloth", process.argv.indexOf("--no-cloth") >= 0 ? "0" : "1"];
  var blender = findBlender();
  console.log("blender:", blender);
  var r = cp.spawnSync(blender, args, { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  var log = (r.stdout || "") + (r.stderr || "");
  log.split(/\r?\n/).filter(function (l) { return /\[ennichi\]|Error|Traceback|error:|^\s+File /.test(l); }).forEach(function (l) { console.log(l); });
  fs.rmSync(dir, { recursive: true, force: true });
  if (r.status !== 0 || !fs.existsSync(OUT)) {
    console.error("blender failed (status " + r.status + ")");
    console.error(log.split(/\r?\n/).slice(-40).join("\n"));
    process.exit(1);
  }
})().catch(function (e) { console.error(e); process.exit(1); });
