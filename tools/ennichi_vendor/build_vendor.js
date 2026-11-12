// ============================================================================
// 緣日樂園 vendor 打包（2026-11-12）
//   把 GLTFLoader／OrbitControls／後製（Bloom）與 @pixiv/three-vrm 打包成一支 IIFE：
//     static_src/vendor/ennichi_vrm.js → window.PriTestEnnichiVendor
//   程式裡的 `import ... from "three"` 全部改指向全域 window.THREE（vendor/three.min.js，r149），
//   所以頁面要先載入 three.min.js 再載入這支。
// 前置（套件裝在專案外的暫存資料夾，不進 Git）：
//   mkdir <tmp> && cd <tmp> && npm init -y
//   npm i three149@npm:three@0.149.0 @pixiv/three-vrm@3.5.5 esbuild@0.24.0
// 執行：node tools/ennichi_vendor/build_vendor.js <tmp>
// ============================================================================
"use strict";
var path = require("path");
var fs = require("fs");

var work = process.argv[2];
if (!work) { console.error("usage: node build_vendor.js <node_modules 所在的資料夾>"); process.exit(1); }
work = path.resolve(work);
var esbuild = require(path.join(work, "node_modules", "esbuild"));
var out = path.join(__dirname, "..", "..", "static_src", "vendor", "ennichi_vrm.js");
var vrmPkg = JSON.parse(fs.readFileSync(path.join(work, "node_modules", "@pixiv", "three-vrm", "package.json"), "utf8"));
var threePkg = JSON.parse(fs.readFileSync(path.join(work, "node_modules", "three149", "package.json"), "utf8"));

esbuild.build({
  entryPoints: [path.join(__dirname, "entry.js")],
  bundle: true,
  format: "iife",
  minify: true,
  target: "es2017",
  outfile: out,
  nodePaths: [path.join(work, "node_modules")],
  legalComments: "eof",
  banner: { js: "/* ennichi_vrm.js — three.js r" + threePkg.version + " examples (MIT, three.js authors) + @pixiv/three-vrm " + vrmPkg.version + " (MIT, pixiv Inc.). Requires global THREE (vendor/three.min.js). Built by tools/ennichi_vendor/build_vendor.js */" },
  plugins: [{
    name: "three-global",
    setup: function (b) {
      b.onResolve({ filter: /^three$/ }, function () { return { path: "three", namespace: "three-global" }; });
      b.onLoad({ filter: /.*/, namespace: "three-global" }, function () { return { contents: "module.exports = window.THREE;", loader: "js" }; });
    },
  }],
  logLevel: "warning",
}).then(function () {
  console.log("wrote", path.relative(process.cwd(), out), (fs.statSync(out).size / 1024).toFixed(1) + " KB");
});
