// 快門之後：拍攝小遊戲。
// 1 取景：拖曳觀景框、縮放（鏡頭決定範圍），依三分法、構圖大小、視線方向評分
// 2 燈光：主燈方向（正面／左／右／頂／逆光）、柔光／硬光、強度、補光（反光板）
// 3 抓瞬間：她的表情一直在變，最好的瞬間只有約 0.5 秒（表情量表進到金色區）
// 4 指導對話：每拍一張可以說一次話（稱讚／開玩笑／要求姿勢），心情與信任度決定她願意擺的姿勢
// 5 底片限制：12 張（36 張長卷＝24 張），拍完或按「結束拍攝」就交回主程式挑片
// 照片只存參數（場景、她的位置、姿勢、燈光、觀景框），之後用同一個 sceneHTML 重新組出畫面，作品集也一樣。
(function () {
  "use strict";

  var D = window.PriTestShutterData, C = window.PriTestShutterCast;
  if (!D || !C) return;
  var SW = 900, SH = 600;
  var DIRS = [
    { id: "front", name: "正面" }, { id: "left", name: "左側" }, { id: "right", name: "右側" }, { id: "top", name: "頂光" }, { id: "back", name: "逆光" }
  ];

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function poseOf(id) { return D.POSES.filter(function (p) { return p.id === id; })[0] || D.POSES[0]; }
  function lensOf(id) { return D.LENSES.filter(function (l) { return l.id === id; })[0] || D.LENSES[0]; }
  function filmOf(id) { return D.FILMS.filter(function (f) { return f.id === id; })[0] || D.FILMS[0]; }
  function poseScale(p) { var m = /scale\(([\d.]+)\)/.exec(p.tf || ""); return m ? +m[1] : 1; }

  // ---------------- 畫面組成 ----------------
  // p：{ img, sc, mx, mh, pose, L:{d,s,i,f}, film, bk }，imgBase＝頭像資料夾
  function lightCSS(L, sc) {
    var a = L.s ? 0.32 : 0.55, b = (1 - L.f / 100) * (L.s ? 0.42 : 0.72);
    var warm = "rgba(255, 244, 222, ", dark = "rgba(6, 4, 18, ";
    var bg;
    if (L.d === "left") bg = "linear-gradient(90deg, " + warm + a + ") 0%, " + warm + "0) 48%, " + dark + b + ") 100%)";
    else if (L.d === "right") bg = "linear-gradient(270deg, " + warm + a + ") 0%, " + warm + "0) 48%, " + dark + b + ") 100%)";
    else if (L.d === "top") bg = "linear-gradient(180deg, " + warm + a + ") 0%, " + warm + "0) 45%, " + dark + b + ") 100%)";
    else if (L.d === "back") bg = "radial-gradient(ellipse 55% 60% at 50% 55%, " + dark + (b * 0.8 + 0.12) + ") 0%, " + dark + "0) 100%)";
    else bg = "radial-gradient(ellipse 60% 55% at 50% 40%, " + warm + (a * 0.7) + ") 0%, " + warm + "0) 70%), linear-gradient(180deg, transparent 60%, " + dark + (b * 0.5) + ") 100%)";
    var exp = D.SCENES[sc].exp;
    var br = clamp(1 + (L.i - exp) / 70, 0.42, 1.75);
    return { bg: bg, filter: "brightness(" + br.toFixed(3) + ") contrast(" + (L.s ? 0.94 : 1.14) + ")", sceneBr: clamp(1 + (L.i - exp) / 220, 0.75, 1.25) };
  }
  function sceneHTML(p, imgBase) {
    var S = D.SCENES[p.sc], pose = poseOf(p.pose), lc = lightCSS(p.L, p.sc);
    var top = SH - p.mh, left = p.mx - p.mh / 2;
    var h = '<div class="sh-scene" style="filter:' + (filmOf(p.film).filter || "none") + '">';
    h += '<div class="sh-bg" style="background:' + S.bg + ";filter:brightness(" + lc.sceneBr.toFixed(3) + ")" + (p.bk ? " blur(3px)" : "") + '"></div>';
    var src = imgBase + esc(p.img), mk = "-webkit-mask-image:url(" + src + ");mask-image:url(" + src + ")";
    if (p.L.d === "back") h += '<div class="sh-halo" style="left:' + (p.mx - p.mh * 0.75) + "px;top:" + (top - p.mh * 0.15) + "px;width:" + (p.mh * 1.5) + "px;height:" + (p.mh * 1.2) + 'px"></div>';
    // 外層 .sh-model 放姿勢變形與逆光的亮邊（drop-shadow 不會被遮罩切掉）；內層 .sh-model-in 負責四邊淡出
    var rim = p.L.d === "back" ? "drop-shadow(0 0 5px rgba(255, 240, 205, 0.95)) drop-shadow(0 0 14px rgba(255, 214, 150, 0.6))" : "none";
    h += '<div class="sh-model" style="left:' + left + "px;top:" + top + "px;width:" + p.mh + "px;height:" + p.mh + "px;transform:" + (pose.tf || "none") + ";filter:" + rim + '"><div class="sh-model-in">';
    // 燈光層用她的剪影當遮罩，只照在她身上
    h += '<img class="sh-model-img" src="' + src + '" alt="" draggable="false" style="filter:' + lc.filter + '">';
    h += '<div class="sh-light" style="background:' + lc.bg + ";" + mk + '"></div></div></div>';
    return h + '<div class="sh-sparkle" style="left:' + (p.mx + p.mh * 0.18) + "px;top:" + (top + p.mh * 0.12) + 'px">✦</div></div>';
  }
  // 照片：依觀景框裁切，w＝顯示寬度（px）
  function photoHTML(p, imgBase, w) {
    var k = w / p.fw;
    return '<div class="sh-photo" style="width:' + w + "px;height:" + Math.round(w * 2 / 3) + 'px"><div class="sh-photo-in" style="transform:scale(' + k.toFixed(4) + ") translate(" + (-p.fx) + "px," + (-p.fy) + 'px)">' + sceneHTML(p, imgBase) + "</div></div>";
  }

  // ---------------- 評分 ----------------
  function moodMatch(L, mood, gear) {
    var d = L.d, side = d === "left" || d === "right";
    var m;
    if (mood === "soft") m = (L.s ? 1 : 0.45) * (L.f >= 50 ? 1 : 0.62) * (d === "back" ? 0.7 : 1) + (L.s && gear.softbox ? 0.12 : 0);
    else if (mood === "dramatic") m = (!L.s ? 1 : 0.5) * (side ? 1 : d === "top" ? 0.72 : 0.42) * (L.f <= 35 ? 1 : 0.6);
    else if (mood === "dreamy") m = (d === "back" ? 1 : 0.45) * (L.f >= 45 ? 1 : 0.62) * (L.s ? 1 : 0.82);
    else m = (d === "front" || d === "top" ? 1 : 0.72) * (L.f >= 30 && L.f <= 70 ? 1 : 0.72);
    return clamp(m, 0, 1.12);
  }
  // st：拍攝狀態（含 fx/fy/zoom/mx/mh/pose/L/lens/film），e＝按下快門時的表情值
  function score(st, e) {
    var pose = poseOf(st.pose), sc = poseScale(pose), lens = lensOf(st.lens), film = filmOf(st.film), cs = st.cs;
    var fw = SW / st.zoom, fh = SH / st.zoom;
    var mh = st.mh * sc, cy = SH - st.mh / 2;
    var faceX = st.mx, faceY = cy + (0.38 - 0.5) * mh;
    var u = (faceX - st.fx) / fw, v = (faceY - st.fy) / fh;
    var notes = [];
    var comp;
    if (u < 0.06 || u > 0.94 || v < 0.06 || v > 0.94) { comp = 0.05; notes.push("臉被切到了"); }
    else {
      var pts = [[1 / 3, 1 / 3, 1], [2 / 3, 1 / 3, 1], [1 / 3, 2 / 3, 0.8], [2 / 3, 2 / 3, 0.8], [0.5, 0.4, 0.72]], th = 0;
      pts.forEach(function (p) { var dd = Math.sqrt((u - p[0]) * (u - p[0]) + (v - p[1]) * (v - p[1])); th = Math.max(th, p[2] * clamp(1 - dd / 0.22, 0, 1)); });
      var r = mh / fh, T = D.FRAME_TARGET[cs.frame];
      var fill = clamp(1 - Math.abs(r - T) / T * 1.4, 0, 1);
      var gz = pose.gaze === 0 ? 0.8 + 0.2 * (1 - Math.abs(u - 0.5) * 2) : clamp(0.65 - pose.gaze * (u - 0.5) * 2.2, 0.2, 1);
      comp = 0.45 * th + 0.4 * fill + 0.15 * gz;
      if (th > 0.8) notes.push("三分法");
      if (fill < 0.45) notes.push(r < T ? "她太小了" : "裁得太緊");
      if (gz < 0.45) notes.push("視線前方太擠");
    }
    var exp = D.SCENES[st.sc].exp;
    var ex = clamp(1 - Math.abs(st.L.i - exp) / 35, 0, 1);
    if (ex < 0.55) notes.push(st.L.i > exp ? "過曝" : "太暗");
    var mm = moodMatch(st.L, cs.mood, st.gear);
    var light = 0.5 * ex + 0.5 * mm + (st.best && st.best === st.L.d ? 0.08 : 0);
    if (st.best && st.best === st.L.d) notes.push("她最好看的一側");
    if (cs.strict && mm < 0.7) { light *= 0.6; notes.push("客戶不滿意燈光"); }
    light = clamp(light, 0, 1);
    var want = cs.want.indexOf(pose.id) >= 0;
    var appeal = pose.appeal * (want ? 1 : 0.62);
    if (!want) notes.push("姿勢不符合主題");
    var moment = clamp(e, 0, 1);
    if (moment >= 0.9) notes.push("✦ 完美的瞬間");
    else if (moment < 0.6) notes.push("按早或按晚了");
    var raw = (0.3 * comp + 0.25 * light + 0.25 * moment + 0.2 * appeal) * (0.72 + 0.28 * st.mood / 100) * 100;
    var bonus = 0;
    if (lens.bonus && lens.bonus === cs.frame) bonus += 5;
    if (lens.bokeh && cs.frame !== "wide") bonus += 3;
    if (film.fit && (film.fit === cs.mood || (Array.isArray(film.fit) && film.fit.indexOf(cs.mood) >= 0))) bonus += 5;
    var s = Math.round(clamp(raw + bonus, 0, 100));
    return { score: s, grade: grade(s), comp: comp, light: light, moment: moment, appeal: appeal, notes: notes };
  }
  function grade(s) { return s >= 90 ? "S" : s >= 80 ? "A" : s >= 66 ? "B" : s >= 50 ? "C" : "D"; }

  // ---------------- 拍攝狀態 ----------------
  var ss = null; // 目前的拍攝
  function mount(host, o, onDone) {
    var gear = {}; (o.gear.lights || []).forEach(function (id) { gear[id] = 1; });
    var lens = o.gear.lenses.indexOf("port85") >= 0 && o.cs.frame === "bust" ? "port85" : o.gear.lenses.indexOf("wide24") >= 0 && o.cs.frame === "wide" ? "wide24" : "std50";
    var L = { d: "front", s: false, i: 50, f: 40 };
    ss = {
      host: host, o: o, onDone: onDone, cs: o.cs, sc: o.scene, img: o.model.img, best: o.model.best || null, gear: gear,
      lens: lens, film: "color", zoom: 1, fx: 0, fy: 0, mx: rnd(330, 570), mh: rnd(310, 350), pose: "natural", L: L,
      mood: clamp(o.mood, 0, 100), trust: clamp(o.trust, 0, 100), trust0: o.trust, total: o.roll ? 24 : 12, left: o.roll ? 24 : 12,
      talked: false, lastTalk: "", praiseN: 0, photos: [], msg: "拖曳觀景框取景。表情量表進到金色區的瞬間，按下快門（空白鍵）。",
      t0: performance.now(), tp: 1.2, sigma: 0.56, e: 0, raf: 0, W: 0
    };
    setZoom(defaultZoom());
    centerOnFace();
    build();
    loop();
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
  }
  function defaultZoom() { var l = lensOf(ss.lens); var want = ss.cs.frame === "bust" ? 2.6 : ss.cs.frame === "half" ? 1.7 : 1.1; return clamp(want, l.zoom[0], l.zoom[1]); }
  function setZoom(z) {
    var l = lensOf(ss.lens); z = clamp(z, l.zoom[0], l.zoom[1]);
    var cx = ss.fx + SW / ss.zoom / 2, cy = ss.fy + SH / ss.zoom / 2;
    ss.zoom = z;
    moveFrame(cx - SW / z / 2, cy - SH / z / 2);
  }
  function moveFrame(x, y) { var fw = SW / ss.zoom, fh = SH / ss.zoom; ss.fx = clamp(x, 0, SW - fw); ss.fy = clamp(y, 0, SH - fh); }
  function centerOnFace() { var fw = SW / ss.zoom, fh = SH / ss.zoom; moveFrame(ss.mx - fw / 2, SH - ss.mh * 0.62 - fh / 2); }
  function maxI() { return ss.gear.strobe ? 100 : 60; }
  function stop() {
    if (!ss) return;
    cancelAnimationFrame(ss.raf);
    window.removeEventListener("keydown", onKey);
    window.removeEventListener("resize", onResize);
  }
  function finish() {
    var s = ss; stop(); ss = null;
    s.onDone({ photos: s.photos, mood: s.mood, trustGain: Math.round(s.trust - s.trust0) });
  }

  // ---------------- 表情 ----------------
  function eAt(t) {
    var b = 0.24 + 0.24 * ss.mood / 100;
    var x = (t - ss.tp) / ss.sigma;
    return clamp(b + (1 - b) * Math.exp(-x * x) + Math.sin(t * 2.3) * 0.025, 0, 1);
  }
  function loop() {
    if (!ss) return;
    var t = (performance.now() - ss.t0) / 1000;
    if (t > ss.tp + ss.sigma * 1.6) {
      var wide = lensOf(ss.lens).wide || 1;
      ss.sigma = 0.56 * (0.85 + ss.trust / 400) * wide;
      ss.tp = t + ss.sigma * 1.6 + rnd(0.9, 2.2) * (1.25 - ss.mood / 200);
    }
    ss.e = eAt(t);
    var m = ss.host.querySelector(".sh-meter i"), img = ss.host.querySelector(".sh-vp .sh-model-img"), sp = ss.host.querySelector(".sh-vp .sh-sparkle");
    if (m) { m.style.width = (ss.e * 100).toFixed(1) + "%"; m.className = ss.e >= 0.9 ? "sh-hot" : ""; }
    if (img) img.style.transform = "scale(" + (1 + 0.03 * ss.e).toFixed(4) + ")";
    if (sp) sp.style.opacity = String(clamp((ss.e - 0.86) / 0.12, 0, 1));
    ss.raf = requestAnimationFrame(loop);
  }

  // ---------------- 畫面 ----------------
  function stP() { return { img: ss.img, sc: ss.sc, mx: ss.mx, mh: ss.mh, pose: ss.pose, L: ss.L, film: ss.film, bk: lensOf(ss.lens).bokeh && ss.cs.frame !== "wide" ? 1 : 0 }; }
  function build() {
    var o = ss.o, W = Math.min(ss.host.clientWidth || 700, 760);
    ss.W = W;
    var h = '<div class="sh-shoot"><div class="sh-shoot-top"><div><b>' + esc(o.title) + '</b><br><span class="sh-small sh-muted">' + esc(o.model.name) + "・" + esc(D.SCENES[ss.sc].name) + "・" + D.MOODS[ss.cs.mood] + "系・" + D.FRAMES[ss.cs.frame] + "構圖" + (o.theme ? "・主題「" + esc(o.theme) + "」" : "") + "</span></div>";
    h += '<div class="sh-hud"></div></div>';
    h += '<div class="sh-vp" style="width:' + W + "px;height:" + Math.round(W * 2 / 3) + 'px"><div class="sh-vp-scene" style="transform:scale(' + (W / SW).toFixed(4) + ')"></div><div class="sh-frame"><i></i></div><div class="sh-flash"></div></div>';
    h += '<div class="sh-meter" style="width:' + W + 'px"><i></i><b></b><span>表情</span></div>';
    h += '<div class="sh-msg"></div><div class="sh-ctl"></div><div class="sh-roll"></div></div>';
    ss.host.innerHTML = h;
    paintScene(); paintFrame(); paintCtl(); paintHud(); paintRoll();
    var vp = ss.host.querySelector(".sh-vp");
    var drag = null;
    vp.addEventListener("pointerdown", function (ev) {
      var s = ss.W / SW, r = vp.getBoundingClientRect();
      drag = { x: ev.clientX, y: ev.clientY, fx: ss.fx, fy: ss.fy, s: s };
      // 點在觀景框外：直接把觀景框中心移到點的位置
      var px = (ev.clientX - r.left) / s, py = (ev.clientY - r.top) / s, fw = SW / ss.zoom, fh = SH / ss.zoom;
      if (px < ss.fx || px > ss.fx + fw || py < ss.fy || py > ss.fy + fh) { moveFrame(px - fw / 2, py - fh / 2); drag.fx = ss.fx; drag.fy = ss.fy; paintFrame(); }
      try { vp.setPointerCapture(ev.pointerId); } catch (e) {}
      ev.preventDefault();
    });
    vp.addEventListener("pointermove", function (ev) {
      if (!drag || !ss) return;
      moveFrame(drag.fx + (ev.clientX - drag.x) / drag.s, drag.fy + (ev.clientY - drag.y) / drag.s);
      paintFrame();
    });
    vp.addEventListener("pointerup", function () { drag = null; });
    vp.addEventListener("pointercancel", function () { drag = null; });
    ss.host.querySelector(".sh-shoot").addEventListener("click", onClick);
    ss.host.querySelector(".sh-shoot").addEventListener("input", onInput);
  }
  function paintScene() { ss.host.querySelector(".sh-vp-scene").innerHTML = sceneHTML(stP(), ss.o.img); }
  function paintFrame() {
    var s = ss.W / SW, f = ss.host.querySelector(".sh-frame");
    f.style.left = (ss.fx * s) + "px"; f.style.top = (ss.fy * s) + "px";
    f.style.width = (SW / ss.zoom * s) + "px"; f.style.height = (SH / ss.zoom * s) + "px";
  }
  function paintHud() {
    ss.host.querySelector(".sh-hud").innerHTML = '<span class="sh-film">🎞 ' + ss.left + "／" + ss.total + "</span>" +
      '<span class="sh-small">心情 <span class="sh-bar sh-bar-mood"><i style="width:' + ss.mood + '%"></i></span></span>' +
      '<span class="sh-small">信任 <span class="sh-bar sh-bar-trust"><i style="width:' + ss.trust + '%"></i></span> ' + Math.round(ss.trust) + "</span>";
    ss.host.querySelector(".sh-msg").textContent = ss.msg;
  }
  function paintRoll() {
    ss.host.querySelector(".sh-roll").innerHTML = ss.photos.map(function (p) {
      return '<div class="sh-rollpic">' + photoHTML(p, ss.o.img, 84) + '<b class="sh-g sh-g' + p.g + '">' + p.g + "</b></div>";
    }).join("");
  }
  function paintCtl() {
    var o = ss.o, lens = lensOf(ss.lens), z = lens.zoom, adultOk = !!ss.cs.adult;
    var h = '<div class="sh-ctl-row"><button class="sh-btn sh-shutter" data-sa="shutter"' + (ss.left <= 0 ? " disabled" : "") + '>📸 快門</button>';
    h += '<label class="sh-small">縮放 <input type="range" data-sa="zoom" min="' + z[0] + '" max="' + z[1] + '" step="0.05" value="' + ss.zoom + '"' + (z[0] === z[1] ? " disabled" : "") + "></label>";
    h += '<button class="sh-btn sh-sm" data-sa="center">對準她</button><button class="sh-btn sh-sm" data-sa="end">' + (ss.left <= 0 ? "底片用完了：去挑片" : "結束拍攝") + "</button></div>";
    // 指導
    h += '<div class="sh-ctl-box"><b>🗣 指導</b>' + (ss.talked ? ' <span class="sh-small sh-muted">（拍完下一張才能再說話）</span>' : "") + '<div class="sh-ctl-row">';
    h += '<button class="sh-btn sh-sm" data-sa="praise"' + (ss.talked ? " disabled" : "") + ">稱讚她</button>";
    h += '<button class="sh-btn sh-sm" data-sa="joke"' + (ss.talked ? " disabled" : "") + ">開個玩笑</button></div>";
    h += '<div class="sh-ctl-row sh-poses">' + D.POSES.filter(function (p) { return !p.adult || adultOk; }).map(function (p) {
      var lock = ss.trust < p.trust, cur = p.id === ss.pose, want = ss.cs.want.indexOf(p.id) >= 0;
      return '<button class="sh-btn sh-sm' + (cur ? " sh-on" : "") + (want ? " sh-want" : "") + '" data-sa="pose" data-id="' + p.id + '"' + (ss.talked || cur ? " disabled" : "") + ">" + (lock ? "🔒" : "") + esc(p.name) + (p.trust ? '<small> 信任' + p.trust + "</small>" : "") + "</button>";
    }).join("") + '</div><p class="sh-small sh-muted">★ 框起來的是這次主題想要的姿勢。信任度不夠時要求，她會拒絕、心情下降。</p></div>';
    // 燈光
    var L = ss.L, indoor = D.SCENES[ss.sc].indoor;
    h += '<div class="sh-ctl-box"><b>💡 燈光</b><div class="sh-ctl-row">' + DIRS.map(function (d) {
      var dis = d.id === "back" && indoor && !ss.gear.led;
      return '<button class="sh-btn sh-sm' + (L.d === d.id ? " sh-on" : "") + '" data-sa="dir" data-id="' + d.id + '"' + (dis ? ' disabled title="室內逆光需要 LED 輪廓燈"' : "") + ">" + d.name + "</button>";
    }).join("") + '<button class="sh-btn sh-sm' + (L.s ? " sh-on" : "") + '" data-sa="soft">' + (L.s ? "柔光" : "硬光") + "</button></div>";
    h += '<div class="sh-ctl-row"><label class="sh-small">強度 ' + L.i + ' <input type="range" data-sa="int" min="10" max="' + maxI() + '" step="1" value="' + Math.min(L.i, maxI()) + '"></label>';
    h += '<label class="sh-small">補光 ' + L.f + ' <input type="range" data-sa="fill" min="0" max="100" step="1" value="' + L.f + '"' + (ss.gear.reflector ? "" : " disabled") + "></label></div>";
    h += '<p class="sh-small sh-muted">' + esc(D.MOODS[ss.cs.mood]) + "系的提示：" + { soft: "柔光、補光多，避免逆光。", dramatic: "硬光、側光、補光少。", dreamy: "逆光，補光多一點。", natural: "正面或頂光，補光適中。" }[ss.cs.mood] + (ss.gear.strobe ? "" : "（沒有閃燈：強度上限 60）") + "</p></div>";
    // 鏡頭與底片
    h += '<div class="sh-ctl-box"><b>📷 鏡頭</b><div class="sh-ctl-row">' + o.gear.lenses.map(function (id) {
      var l = lensOf(id); return '<button class="sh-btn sh-sm' + (ss.lens === id ? " sh-on" : "") + '" data-sa="lens" data-id="' + id + '">' + esc(l.name) + "</button>";
    }).join("") + '</div><b>🎞 底片</b>' + (ss.photos.length ? ' <span class="sh-small sh-muted">（已經開始拍了，不能換）</span>' : "") + '<div class="sh-ctl-row">' + o.gear.films.filter(function (id) { return !filmOf(id).roll; }).map(function (id) {
      var f = filmOf(id); return '<button class="sh-btn sh-sm' + (ss.film === id ? " sh-on" : "") + '" data-sa="film" data-id="' + id + '"' + (ss.photos.length ? " disabled" : "") + ">" + esc(f.name) + "</button>";
    }).join("") + "</div></div>";
    ss.host.querySelector(".sh-ctl").innerHTML = h;
  }

  // ---------------- 操作 ----------------
  function shiftModel(big) {
    var fw = SW / ss.zoom;
    ss.mx = clamp(ss.mx + (big ? rnd(-110, 110) : rnd(-28, 28)), 260, 640);
    if (big) ss.mh = clamp(rnd(300, 360), 280, 380);
    void fw;
  }
  function shutter() {
    if (ss.left <= 0) return;
    var e = ss.e, r = score(ss, e);
    var p = { img: ss.img, sc: ss.sc, mx: Math.round(ss.mx), mh: Math.round(ss.mh), pose: ss.pose, L: { d: ss.L.d, s: ss.L.s, i: ss.L.i, f: ss.L.f }, film: ss.film,
      bk: lensOf(ss.lens).bokeh && ss.cs.frame !== "wide" ? 1 : 0, fx: Math.round(ss.fx), fy: Math.round(ss.fy), fw: Math.round(SW / ss.zoom), score: r.score, g: r.grade, notes: r.notes };
    ss.photos.push(p);
    ss.left--;
    ss.mood = clamp(ss.mood - 2.5, 0, 100);
    ss.talked = false;
    ss.msg = "【" + r.grade + "】" + r.score + " 分　" + (r.notes.length ? r.notes.join("・") : "不錯的一張。");
    var fl = ss.host.querySelector(".sh-flash"); if (fl) { fl.classList.remove("sh-flashing"); void fl.offsetWidth; fl.classList.add("sh-flashing"); }
    shiftModel(false);
    paintScene(); paintCtl(); paintHud(); paintRoll();
  }
  function say(text) { ss.msg = String(text).replace(/\{n\}/g, ss.o.model.short); }
  function talk(kind, poseId) {
    if (ss.talked) return;
    var T = C.TALK;
    if (kind === "praise") {
      var g = [10, 6, 2][Math.min(ss.praiseN, 2)];
      ss.mood = clamp(ss.mood + g, 0, 100); ss.trust = clamp(ss.trust + 1, 0, 100);
      say(pick(ss.praiseN >= 2 ? T.praiseTired : T.praise)); ss.praiseN++;
    } else if (kind === "joke") {
      ss.praiseN = 0;
      if (Math.random() < (ss.o.model.joke || 0.5)) { ss.mood = clamp(ss.mood + 15, 0, 100); ss.trust = clamp(ss.trust + 2, 0, 100); say(pick(T.jokeOk)); }
      else { ss.mood = clamp(ss.mood - 7, 0, 100); say(pick(T.jokeNg)); }
    } else if (kind === "pose") {
      ss.praiseN = 0;
      var p = poseOf(poseId);
      if (ss.cs.strict && ss.cs.want.indexOf(p.id) < 0) { ss.mood = clamp(ss.mood - 3, 0, 100); say(pick(T.strict)); }
      else if (ss.trust >= p.trust) {
        ss.pose = p.id; ss.trust = clamp(ss.trust + 1, 0, 100);
        if (p.adult) ss.mood = clamp(ss.mood - 2, 0, 100);
        say(pick(p.adult ? T.acceptBold : T.accept)); shiftModel(true);
      } else { ss.mood = clamp(ss.mood - 10, 0, 100); ss.trust = clamp(ss.trust - 2, 0, 100); say(pick(T.refuse)); }
    }
    ss.talked = true;
    paintScene(); paintCtl(); paintHud();
  }
  function onClick(ev) {
    var b = ev.target.closest("[data-sa]"); if (!b || b.disabled || !ss) return;
    var a = b.getAttribute("data-sa"), id = b.getAttribute("data-id");
    if (a === "shutter") shutter();
    else if (a === "end") finish();
    else if (a === "center") { centerOnFace(); paintFrame(); }
    else if (a === "praise" || a === "joke") talk(a);
    else if (a === "pose") talk("pose", id);
    else if (a === "dir") { ss.L.d = id; paintScene(); paintCtl(); }
    else if (a === "soft") { ss.L.s = !ss.L.s; paintScene(); paintCtl(); }
    else if (a === "lens") { ss.lens = id; setZoom(ss.zoom); paintScene(); paintFrame(); paintCtl(); }
    else if (a === "film") { ss.film = id; paintScene(); paintCtl(); }
  }
  function onInput(ev) {
    var t = ev.target, a = t.getAttribute("data-sa"); if (!a || !ss) return;
    if (a === "zoom") { setZoom(+t.value); paintFrame(); }
    else if (a === "int") { ss.L.i = +t.value; paintScene(); t.parentNode.firstChild.nodeValue = "強度 " + ss.L.i + " "; }
    else if (a === "fill") { ss.L.f = +t.value; paintScene(); t.parentNode.firstChild.nodeValue = "補光 " + ss.L.f + " "; }
  }
  function onKey(ev) {
    if (!ss) return;
    var tag = (ev.target && ev.target.tagName) || "";
    if (ev.key === " " && tag !== "INPUT") { ev.preventDefault(); shutter(); return; }
    var step = 18, k = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[ev.key];
    if (k && tag !== "INPUT") { ev.preventDefault(); moveFrame(ss.fx + k[0], ss.fy + k[1]); paintFrame(); }
  }
  function onResize() {
    if (!ss) return;
    var W = Math.min(ss.host.clientWidth || 700, 760);
    if (Math.abs(W - ss.W) < 4) return;
    ss.W = W;
    var vp = ss.host.querySelector(".sh-vp"); vp.style.width = W + "px"; vp.style.height = Math.round(W * 2 / 3) + "px";
    ss.host.querySelector(".sh-meter").style.width = W + "px";
    ss.host.querySelector(".sh-vp-scene").style.transform = "scale(" + (W / SW).toFixed(4) + ")";
    paintFrame();
  }

  window.PriTestShutterShoot = {
    SW: SW, SH: SH, mount: mount, stop: function () { stop(); ss = null; }, sceneHTML: sceneHTML, photoHTML: photoHTML, score: score, grade: grade, moodMatch: moodMatch,
    // 測試用：直接設定觀景框與燈光、在指定表情值按快門
    _sess: function () { return ss; },
    _aim: function () { if (ss) { centerOnFace(); paintFrame(); } },
    _shootAt: function (e) { if (!ss) return; ss.e = e; shutter(); }
  };
})();
