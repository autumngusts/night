// 煉金術士（atelier）：相機與取色來源。只負責把畫面變成 SRC_SIZE×SRC_SIZE 的 RGBA，分析交給 atelier_core.js。
// 不保存任何影像（隱私）；照片只在記憶體中縮成 32×32 後就丟掉。
(function () {
  "use strict";
  var D = window.PriTestAtelierData;
  var stream = null;

  function supported() { return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia); }
  // 開後鏡頭；iOS 需要 playsinline + muted 才能在頁面內播放
  function open(video) {
    return navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false }).then(function (s) {
      stream = s;
      video.setAttribute("playsinline", "");
      video.muted = true;
      video.srcObject = s;
      return video.play();
    });
  }
  function close(video) {
    if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
    stream = null;
    if (video) video.srcObject = null;
  }
  function isOpen() { return !!stream; }
  // 取中央正方形，縮成 N×N
  function sample(src, sw, sh) {
    var N = D.SRC_SIZE, c = document.createElement("canvas");
    c.width = N; c.height = N;
    var g = c.getContext("2d"), side = Math.min(sw, sh);
    g.drawImage(src, (sw - side) / 2, (sh - side) / 2, side, side, 0, 0, N, N);
    return g.getImageData(0, 0, N, N).data;
  }
  function grab(video) { return sample(video, video.videoWidth, video.videoHeight); }
  function fromFile(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(sample(img, img.naturalWidth, img.naturalHeight)); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("image")); };
      img.src = url;
    });
  }
  // B17 色彩散步：沒有相機時，用 seed 畫出隨機的色塊風景
  function walkScene(seed) {
    var rng = window.PriTestAtelierCore.makeRng("walk:" + seed), N = D.SRC_SIZE, c = document.createElement("canvas");
    c.width = N; c.height = N;
    var g = c.getContext("2d");
    function hsl() { return "hsl(" + Math.floor(rng() * 360) + "," + Math.floor(30 + rng() * 60) + "%," + Math.floor(25 + rng() * 55) + "%)"; }
    g.fillStyle = hsl(); g.fillRect(0, 0, N, N);
    var n = 2 + Math.floor(rng() * 3);
    for (var i = 0; i < n; i++) {
      g.fillStyle = hsl();
      var w = 6 + Math.floor(rng() * 16), h = 6 + Math.floor(rng() * 16);
      g.fillRect(Math.floor(rng() * (N - w)), Math.floor(rng() * (N - h)), w, h);
    }
    return { rgba: g.getImageData(0, 0, N, N).data, url: c.toDataURL() };
  }

  window.PriTestAtelierCamera = { supported: supported, open: open, close: close, isOpen: isOpen, grab: grab, fromFile: fromFile, walkScene: walkScene };
})();
