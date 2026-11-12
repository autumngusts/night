// ============================================================================
// 緣日樂園：人物呈現的技術驗證樣本（docs/ennichi_rules.md §8、§9.1，2026-11-12）
//   1. VRM 近景：程序化巫女小夜（MToon、表情、彈簧骨），待機／揮手／走路
//   2. 看板人物群眾：開場把 VRM 從 8 方向 × 4 格走路 × 4 種服裝渲染成圖集，
//      再用一個 InstancedBufferGeometry 畫出全部客人（1 draw call）
//   3. murmur：客人頭上的氣泡＋側欄的 murmur 牆，點擊展開立繪
//   4. 立繪比較：沿用 jikan 3 張＋新製（SVG 暫代）3 張
// 依賴：vendor/three.min.js（r149，全域 THREE）→ vendor/ennichi_vrm.js（PriTestEnnichiVendor）
// ============================================================================
(function () {
  "use strict";

  var root = document.getElementById("en-app");
  if (!root) return;

  var THREE_SRC = root.getAttribute("data-three-src");
  var VENDOR_SRC = root.getAttribute("data-vendor-src");
  var MODEL_URL = root.getAttribute("data-model");
  var IMG = root.getAttribute("data-img");
  var JIKAN = root.getAttribute("data-jikan");

  function t(key, params) { return window.I18N ? window.I18N.t(key, params) : key; }
  function lang() { return window.I18N ? window.I18N.getLang() : "zh"; }
  function C(zh, ja) { return { zh: zh, ja: ja }; }
  function L(o) { return lang() === "ja" ? o.ja : o.zh; }
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = function () { reject(new Error("load failed: " + src)); };
      document.head.appendChild(s);
    });
  }

  // ---------------------------------------------------------------- 資料
  var PORTRAITS = [
    { id: "sayo", src: IMG + "portrait_sayo.svg", origin: "new", name: C("小夜", "小夜"), role: C("神社巫女・青梅竹馬", "神社の巫女・幼なじみ") },
    { id: "tetsuko", src: IMG + "portrait_tetsuko.svg", origin: "new", name: C("鐵子", "鉄子"), role: C("老師傅的孫女・機械宅", "親方の孫娘・メカオタク") },
    { id: "renge", src: IMG + "portrait_renge.svg", origin: "new", name: C("蓮華", "蓮華"), role: C("和菓子店看板娘", "和菓子屋の看板娘") },
    { id: "miu", src: JIKAN + "g_063.webp", origin: "jikan", name: C("美羽", "美羽"), role: C("宣傳・活動企劃", "宣伝・イベント企画") },
    { id: "shizuku", src: JIKAN + "g_020.webp", origin: "jikan", name: C("雫", "雫"), role: C("只在夜晚出現的少女", "夜にだけ現れる少女") },
    { id: "regular", src: JIKAN + "n_025.webp", origin: "jikan", name: C("小雛", "ひな"), role: C("常客・御守收集家", "常連・お守りコレクター") },
  ];

  var RIDES = [C("燈籠摩天輪", "灯籠観覧車"), C("唐獅子旋轉木馬", "唐獅子メリーゴーランド"), C("茶碗咖啡杯", "茶碗コーヒーカップ"), C("化け屋敷", "お化け屋敷"), C("狐狸列車", "きつね列車")];
  var ITEMS = [C("限定御守", "限定お守り"), C("狐狸吉祥物玩偶", "きつねマスコットのぬいぐるみ"), C("夜櫻團扇", "夜桜うちわ"), C("壓克力立牌", "アクリルスタンド")];
  var FOODS = [C("章魚燒", "たこ焼き"), C("蘋果糖", "りんご飴"), C("棉花糖", "わたあめ"), C("刨冰", "かき氷"), C("櫻餅", "桜餅")];

  var MURMURS = [
    { type: "impression", text: C("{ride}的燈好漂亮……", "{ride}の灯り、きれい……") },
    { type: "impression", text: C("參道的燈籠一路排到鳥居，好有氣氛", "参道の灯籠が鳥居まで続いてて雰囲気ある") },
    { type: "impression", text: C("巫女小姐的神樂舞超美的", "巫女さんの神楽舞、すごくきれいだった") },
    { type: "complaint", text: C("{ride}排了 40 分鐘耶……", "{ride}、40 分も並んだんだけど……") },
    { type: "complaint", text: C("垃圾桶好少，{food}的竹籤要丟哪", "ゴミ箱少なすぎ、{food}の串どこに捨てるの") },
    { type: "complaint", text: C("廁所在哪裡啦——", "トイレどこー！") },
    { type: "need", text: C("好想喝冷飲，這附近都沒有賣", "冷たい飲み物ほしい、この辺売ってない") },
    { type: "need", text: C("走好累，想找張長椅坐一下", "歩き疲れた、ベンチ座りたい") },
    { type: "recommend", text: C("下次一定要帶朋友來！", "今度は絶対友達も連れてくる！") },
    { type: "recommend", text: C("{food}好好吃，比市區的還好吃", "{food}おいしい、街のより好きかも") },
    { type: "sns", text: C("#緣日樂園 {item}入手！", "#縁日遊園 {item}ゲット！") },
    { type: "sns", text: C("#緣日樂園 夜景拍起來超好看 ✨", "#縁日遊園 夜景めっちゃ映える ✨") },
    { type: "gossip", text: C("聽說巫女小姐和工房的人……？", "巫女さんと工房の人って……もしかして？") },
    { type: "gossip", text: C("晚上好像有看到一個藍頭髮的女生在鳥居那邊", "夜、鳥居のとこに青い髪の子がいた気がする") },
    { type: "season", text: C("今年的櫻花開得比較早呢", "今年は桜が早いね") },
    { type: "season", text: C("晚上還是有點冷，帶件外套就好了", "夜はまだ冷えるね、上着持ってくればよかった") },
    { type: "love", text: C("他今天會不會在{ride}上告白呢……", "今日、{ride}で告白してくれるかな……") },
    { type: "love", text: C("第一次一起穿浴衣出來，好緊張", "初めて浴衣でデート、緊張する") },
    { type: "rival", text: C("隔壁的樂園好像也要開新設施", "隣の遊園地も新しいアトラクション作るらしいよ") },
  ];
  var SAYO_LINES = [
    C("歡迎來到緣日樂園～", "縁日遊園へようこそ〜"),
    C("今晚的燈籠，是大家一起掛上去的喔", "今夜の灯籠、みんなで吊るしたんですよ"),
    C("要不要抽一支籤呢？", "おみくじ、引いていきませんか？"),
  ];
  var MM_TYPES = ["impression", "complaint", "need", "recommend", "sns", "gossip", "season", "love", "rival"];

  // 看板人物的服裝（top＝白衣材質、bottom＝緋袴材質、hair）
  var OUTFITS = [
    { top: "#2e3e6e", bottom: "#24305a", hair: "#3a2a20" },
    { top: "#f4a6bc", bottom: "#7a3ea0", hair: "#6b3e26" },
    { top: "#8fd0c0", bottom: "#3f7f74", hair: "#1e1a20" },
    { top: "#fbfaf8", bottom: "#d42a3c", hair: "#2b2233" },
  ];
  var ATLAS_CELL = 192, ATLAS_DIRS = 8, ATLAS_FRAMES = 4;
  var BILL_SIZE = 1.55; // 圖集一格對應的世界尺寸（正交相機的視野寬高）
  var STALLS = [C("たこ焼き", "たこ焼き"), C("金魚すくい", "金魚すくい"), C("わたあめ", "わたあめ"), C("射的", "射的"), C("りんご飴", "りんご飴"), C("焼きそば", "焼きそば"), C("お面", "お面"), C("かき氷", "かき氷")];

  // ---------------------------------------------------------------- 狀態
  var V; // PriTestEnnichiVendor
  var renderer, scene, camera, controls, composer, bloomPass, clock;
  var sayo = null, guestVrm = null;
  var sayoMode = "idle", sayoWalk = { z: 1.2, dir: -1 }, follow = false;
  var blinkTimer = 2, blinkT = -1, talkT = 0, happy = false;
  var crowd = null, guests = [], guestCount = 120;
  var wheel = null, wheelLights = null;
  var bubbles = [], bubbleTimer = 1;
  var report = {};
  var fps = { frames: 0, t: 0, value: 0 };

  // ---------------------------------------------------------------- 畫面骨架
  var stageWrap, stage, overlay, reportBox, wallList, modal, controlsBox;

  function buildUi() {
    root.innerHTML = "";
    var head = el("header", "en-head");
    head.appendChild(el("h1", "en-title", t("en_lab_title")));
    head.appendChild(el("p", "en-lead", t("en_lab_lead")));
    root.appendChild(head);

    var grid = el("div", "en-grid");
    stageWrap = el("section", "en-stage-wrap");
    stage = el("div", "en-stage");
    stage.id = "en-stage";
    overlay = el("div", "en-overlay");
    stage.appendChild(overlay);
    var loading = el("div", "en-loading", t("en_loading"));
    loading.id = "en-loading";
    stage.appendChild(loading);
    stageWrap.appendChild(stage);
    controlsBox = el("div", "en-controls");
    stageWrap.appendChild(controlsBox);
    grid.appendChild(stageWrap);

    var side = el("aside", "en-side");
    side.appendChild(el("h2", "en-h2", t("en_report_title")));
    reportBox = el("dl", "en-report");
    reportBox.id = "en-report";
    side.appendChild(reportBox);
    side.appendChild(el("h2", "en-h2", t("en_wall_title")));
    wallList = el("ul", "en-wall");
    wallList.id = "en-wall";
    side.appendChild(wallList);
    grid.appendChild(side);
    root.appendChild(grid);

    root.appendChild(buildPortraits());

    modal = el("div", "en-modal");
    modal.id = "en-modal";
    modal.hidden = true;
    modal.addEventListener("click", function (e) { if (e.target === modal) modal.hidden = true; });
    root.appendChild(modal);
  }

  function buildPortraits() {
    var sec = el("section", "en-portraits");
    sec.appendChild(el("h2", "en-h2", t("en_portraits_title")));
    sec.appendChild(el("p", "en-note", t("en_portraits_note")));
    ["jikan", "new"].forEach(function (origin) {
      sec.appendChild(el("h3", "en-h3", t("en_origin_" + origin)));
      var row = el("div", "en-cards");
      PORTRAITS.filter(function (p) { return p.origin === origin; }).forEach(function (p) {
        var card = el("button", "en-card");
        card.type = "button";
        var img = el("img");
        img.src = p.src;
        img.alt = L(p.name);
        card.appendChild(img);
        card.appendChild(el("strong", null, L(p.name)));
        card.appendChild(el("span", null, L(p.role)));
        card.addEventListener("click", function () { openModal(p, null, null); });
        row.appendChild(card);
      });
      sec.appendChild(row);
    });
    return sec;
  }

  function openModal(p, type, text) {
    modal.innerHTML = "";
    var box = el("div", "en-modal-box");
    var img = el("img", "en-modal-img");
    img.src = p.src;
    img.alt = L(p.name);
    box.appendChild(img);
    var body = el("div", "en-modal-body");
    body.appendChild(el("strong", "en-modal-name", L(p.name)));
    body.appendChild(el("span", "en-modal-role", L(p.role) + "｜" + t("en_origin_" + p.origin)));
    if (type) {
      body.appendChild(el("span", "en-mm-type en-mm-" + type, t("en_mm_" + type)));
      body.appendChild(el("p", "en-modal-text", text));
    }
    var close = el("button", "en-btn", t("en_close"));
    close.type = "button";
    close.addEventListener("click", function () { modal.hidden = true; });
    body.appendChild(close);
    box.appendChild(body);
    modal.appendChild(box);
    modal.hidden = false;
  }

  function setReport(key, value) {
    report[key] = value;
    var dd = document.getElementById("en-r-" + key);
    if (!dd) {
      reportBox.appendChild(el("dt", null, t("en_r_" + key)));
      dd = el("dd");
      dd.id = "en-r-" + key;
      reportBox.appendChild(dd);
    }
    dd.textContent = value;
  }

  function addButton(label, fn, id) {
    var b = el("button", "en-btn", label);
    b.type = "button";
    if (id) b.id = id;
    b.addEventListener("click", function () { fn(b); });
    controlsBox.appendChild(b);
    return b;
  }

  function buildControls() {
    controlsBox.appendChild(el("span", "en-ctl-label", t("en_ctl_sayo")));
    addButton(t("en_btn_happy"), function (b) { happy = !happy; b.classList.toggle("is-on", happy); }, "en-btn-happy");
    addButton(t("en_btn_talk"), function () { sayoSpeak(); }, "en-btn-talk");
    addButton(t("en_btn_wave"), function () { sayoMode = sayoMode === "wave" ? "idle" : "wave"; syncModeButtons(); }, "en-btn-wave");
    addButton(t("en_btn_walk"), function () { sayoMode = sayoMode === "walk" ? "idle" : "walk"; syncModeButtons(); }, "en-btn-walk");
    addButton(t("en_btn_follow"), function (b) { follow = !follow; b.classList.toggle("is-on", follow); }, "en-btn-follow");
    controlsBox.appendChild(el("span", "en-ctl-label", t("en_ctl_view")));
    addButton(t("en_btn_bloom"), function (b) {
      bloomPass.enabled = !bloomPass.enabled;
      b.classList.toggle("is-on", bloomPass.enabled);
    }, "en-btn-bloom").classList.add("is-on");
    [60, 120, 240].forEach(function (n) {
      var b = addButton(t("en_btn_crowd", { n: n }), function () { setGuestCount(n); }, "en-btn-crowd-" + n);
      if (n === guestCount) b.classList.add("is-on");
    });
  }

  function syncModeButtons() {
    ["wave", "walk"].forEach(function (m) {
      var b = document.getElementById("en-btn-" + m);
      if (b) b.classList.toggle("is-on", sayoMode === m);
    });
  }

  // ---------------------------------------------------------------- 3D 場景
  function initThree() {
    var w = stage.clientWidth, h = stage.clientHeight;
    // r149 預設 legacyMode：十六進位顏色會被當成 linear，整個畫面偏亮偏灰。只在這一頁打開色彩管理
    if (THREE.ColorManagement) THREE.ColorManagement.legacyMode = false;
    renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h);
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.info.autoReset = false; // 後製有多個 pass，每幀手動歸零才能看到整幀的 draw call
    stage.insertBefore(renderer.domElement, overlay);

    scene = new THREE.Scene();
    scene.background = new THREE.Color("#141a33");
    scene.fog = new THREE.Fog("#141a33", 14, 46);
    camera = new THREE.PerspectiveCamera(40, w / h, 0.1, 200);
    camera.position.set(2.4, 1.7, 5.2);
    controls = new V.OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 1.0, 0.6);
    controls.enableDamping = true;
    controls.maxPolarAngle = 1.48;
    controls.minDistance = 1.2;
    controls.maxDistance = 30;

    scene.add(new THREE.HemisphereLight("#7c8cff", "#3a2c22", 0.65));
    var moon = new THREE.DirectionalLight("#b8c4ff", 0.55);
    moon.position.set(-4, 8, 6);
    scene.add(moon);
    var warm = new THREE.PointLight("#ffb062", 1.2, 9, 1.6);
    warm.position.set(0, 2.6, 0.5);
    scene.add(warm);

    // HDR 的合成目標（HalfFloat），燈籠顏色可以超過 1 → 只有真正的光源會發光
    var rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType });
    if (renderer.capabilities.isWebGL2) rt.samples = 4;
    composer = new V.EffectComposer(renderer, rt);
    composer.addPass(new V.RenderPass(scene, camera));
    bloomPass = new V.UnrealBloomPass(new THREE.Vector2(w, h), 0.85, 0.55, 1.0);
    composer.addPass(bloomPass);
    composer.addPass(new V.ShaderPass(V.GammaCorrectionShader));

    buildWorld();
    clock = new THREE.Clock();
    tmpV = new THREE.Vector3();
    window.addEventListener("resize", onResize);
  }

  function onResize() {
    var w = stage.clientWidth, h = stage.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    composer.setSize(w, h);
  }

  function glow(hex, k) { return new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(k) }); }

  function buildWorld() {
    var ground = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), new THREE.MeshLambertMaterial({ color: "#26331f" }));
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);
    var path = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.04, 44), new THREE.MeshLambertMaterial({ color: "#6d675f" }));
    path.position.set(0, 0.02, -14);
    scene.add(path);

    // 鳥居 ×2
    var red = new THREE.MeshLambertMaterial({ color: "#c8282e" });
    var black = new THREE.MeshLambertMaterial({ color: "#1d1a1c" });
    [-9, -22].forEach(function (z, i) {
      var s = i === 0 ? 1 : 0.85;
      var g = new THREE.Group();
      [-1.75, 1.75].forEach(function (x) {
        var p = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.2, 3.4, 16), red);
        p.position.set(x, 1.7, 0);
        g.add(p);
      });
      var kasagi = new THREE.Mesh(new THREE.BoxGeometry(5, 0.22, 0.42), black);
      kasagi.position.y = 3.55;
      var shimaki = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.2, 0.36), red);
      shimaki.position.y = 3.36;
      var nuki = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.18, 0.2), red);
      nuki.position.y = 2.75;
      g.add(kasagi, shimaki, nuki);
      g.scale.setScalar(s);
      g.position.z = z;
      scene.add(g);
    });

    // 拜殿
    var hall = new THREE.Group();
    var body = new THREE.Mesh(new THREE.BoxGeometry(6, 2.6, 4), new THREE.MeshLambertMaterial({ color: "#8a5a3a" }));
    body.position.y = 1.3;
    var roof = new THREE.Mesh(new THREE.ConeGeometry(5.2, 2.2, 4, 1), new THREE.MeshLambertMaterial({ color: "#3c4a52" }));
    roof.position.y = 3.6;
    roof.rotation.y = Math.PI / 4;
    roof.scale.set(1.3, 1, 0.9);
    var door = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.6), glow("#ffc070", 1.6));
    door.position.set(0, 1.1, 2.01);
    hall.add(body, roof, door);
    hall.position.z = -31;
    scene.add(hall);

    // 參道兩側的燈籠（InstancedMesh）＋燈串
    var poleGeo = new THREE.CylinderGeometry(0.04, 0.05, 2.3, 8);
    poleGeo.translate(0, 1.15, 0);
    var lanternGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.38, 14);
    var spots = [];
    for (var z = 4; z >= -28; z -= 2.6) { spots.push([-2.5, z], [2.5, z]); }
    var poles = new THREE.InstancedMesh(poleGeo, new THREE.MeshLambertMaterial({ color: "#3a2a22" }), spots.length);
    var lanterns = new THREE.InstancedMesh(lanternGeo, glow("#ffc070", 2.6), spots.length);
    var m = new THREE.Matrix4();
    spots.forEach(function (s, i) {
      m.makeTranslation(s[0], 0, s[1]);
      poles.setMatrixAt(i, m);
      m.makeTranslation(s[0], 2.05, s[1]);
      lanterns.setMatrixAt(i, m);
    });
    scene.add(poles, lanterns);

    var bulbs = [];
    [-2.5, 2.5].forEach(function (x) {
      for (var i = 0; i < spots.length / 2 - 1; i++) {
        var z0 = 4 - i * 2.6;
        for (var k = 1; k < 8; k++) {
          var u = k / 8;
          bulbs.push([x, 2.3 - Math.sin(u * Math.PI) * 0.35, z0 - u * 2.6, k % 2]);
        }
      }
    });
    var bulbGeo = new THREE.SphereGeometry(0.045, 8, 6);
    var bulbMesh = new THREE.InstancedMesh(bulbGeo, new THREE.MeshBasicMaterial({ color: "#ffffff" }), bulbs.length);
    var cRed = new THREE.Color("#ff4050").multiplyScalar(2.2), cWhite = new THREE.Color("#fff2d0").multiplyScalar(2.2);
    bulbs.forEach(function (b, i) {
      m.makeTranslation(b[0], b[1], b[2]);
      bulbMesh.setMatrixAt(i, m);
      bulbMesh.setColorAt(i, b[3] ? cRed : cWhite);
    });
    scene.add(bulbMesh);

    // 攤位（招牌用 CanvasTexture 寫字）
    var roofColors = ["#d23a3a", "#2f6fb5", "#e0a020", "#3a9a5a"];
    for (var j = 0; j < 8; j++) {
      var side = j % 2 ? 1 : -1;
      var sz = 2.5 - Math.floor(j / 2) * 5;
      var stall = new THREE.Group();
      var counter = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.95, 1.4), new THREE.MeshLambertMaterial({ color: "#7a5236" }));
      counter.position.y = 0.48;
      var roofM = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.12, 1.9), new THREE.MeshLambertMaterial({ color: roofColors[j % 4] }));
      roofM.position.set(0, 2.15, -0.05);
      roofM.rotation.z = 0;
      roofM.rotation.x = 0.12;
      [-1.05, 1.05].forEach(function (px) {
        var post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.1, 0.08), new THREE.MeshLambertMaterial({ color: "#5a3a26" }));
        post.position.set(px, 1.05, 0.62);
        stall.add(post);
      });
      var sign = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.45), signMaterial(L(STALLS[j]), roofColors[j % 4]));
      sign.position.set(0, 1.82, 0.72);
      stall.add(counter, roofM, sign);
      stall.position.set(side * 4.3, 0, sz);
      stall.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
      scene.add(stall);
    }

    // 遠方的燈籠摩天輪（樂園的預告）
    wheel = new THREE.Group();
    var rim = new THREE.Mesh(new THREE.TorusGeometry(6, 0.08, 6, 64), new THREE.MeshLambertMaterial({ color: "#c8c8d8" }));
    wheel.add(rim);
    for (var sIdx = 0; sIdx < 16; sIdx++) {
      var spoke = new THREE.Mesh(new THREE.BoxGeometry(0.05, 6, 0.05), rim.material);
      spoke.rotation.z = (sIdx / 16) * Math.PI;
      wheel.add(spoke);
    }
    var lightGeo = new THREE.SphereGeometry(0.12, 8, 6);
    wheelLights = new THREE.InstancedMesh(lightGeo, new THREE.MeshBasicMaterial({ color: "#ffffff" }), 48);
    for (var q = 0; q < 48; q++) {
      var a = (q / 48) * Math.PI * 2;
      m.makeTranslation(Math.cos(a) * 6, Math.sin(a) * 6, 0);
      wheelLights.setMatrixAt(q, m);
      wheelLights.setColorAt(q, new THREE.Color().setHSL(q / 48, 0.8, 0.6).multiplyScalar(2.4));
    }
    wheel.add(wheelLights);
    wheel.position.set(16, 7.2, -34);
    wheel.rotation.y = -0.5;
    scene.add(wheel);
    [-1, 1].forEach(function (sx) {
      var leg = new THREE.Mesh(new THREE.BoxGeometry(0.2, 8, 0.2), rim.material);
      leg.position.set(16 + sx * 1.6, 3.4, -34);
      leg.rotation.z = sx * 0.2;
      scene.add(leg);
    });

    // 星空與月亮
    var starPos = [];
    for (var n = 0; n < 500; n++) {
      var th = Math.random() * Math.PI * 2, ph = Math.random() * 1.2;
      starPos.push(Math.cos(th) * Math.cos(ph) * 90, 8 + Math.sin(ph) * 70, Math.sin(th) * Math.cos(ph) * 90);
    }
    var sg = new THREE.BufferGeometry();
    sg.setAttribute("position", new THREE.Float32BufferAttribute(starPos, 3));
    scene.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: "#dfe6ff", size: 1.6, sizeAttenuation: false, fog: false })));
    var moonMesh = new THREE.Mesh(new THREE.SphereGeometry(2.4, 24, 16), new THREE.MeshBasicMaterial({ color: new THREE.Color("#fff3c8").multiplyScalar(1.5), fog: false }));
    moonMesh.position.set(-30, 34, -70);
    scene.add(moonMesh);
  }

  function signMaterial(text, bg) {
    var c = document.createElement("canvas");
    c.width = 256;
    c.height = 64;
    var g = c.getContext("2d");
    g.fillStyle = bg;
    g.fillRect(0, 0, 256, 64);
    g.fillStyle = "#fffaf0";
    g.font = "bold 40px 'Hiragino Mincho ProN','Yu Mincho','Noto Serif JP',serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(text, 128, 34);
    var tex = new THREE.CanvasTexture(c);
    tex.encoding = THREE.sRGBEncoding;
    var mat = new THREE.MeshBasicMaterial({ map: tex });
    mat.color.multiplyScalar(1.4);
    return mat;
  }

  // ---------------------------------------------------------------- VRM
  function loadVrm() {
    var loader = new V.GLTFLoader();
    loader.register(function (parser) { return new V.VRMLoaderPlugin(parser); });
    return new Promise(function (resolve, reject) {
      loader.load(MODEL_URL, function (gltf) { resolve(gltf); }, null, reject);
    });
  }

  function bone(vrm, name) { return vrm.humanoid.getNormalizedBoneNode(name); }

  function restPose(vrm) {
    bone(vrm, "leftUpperArm").rotation.set(0, 0, -1.22);
    bone(vrm, "rightUpperArm").rotation.set(0, 0, 1.22);
    bone(vrm, "leftLowerArm").rotation.set(0, 0, -0.12);
    bone(vrm, "rightLowerArm").rotation.set(0, 0, 0.12);
    ["leftUpperLeg", "rightUpperLeg", "leftLowerLeg", "rightLowerLeg"].forEach(function (n) { bone(vrm, n).rotation.set(0, 0, 0); });
    ["spine", "chest", "neck", "head"].forEach(function (n) { bone(vrm, n).rotation.set(0, 0, 0); });
  }

  // 走路姿勢：phase 0〜2π
  function walkPose(vrm, phase, amp) {
    var s = Math.sin(phase);
    bone(vrm, "leftUpperLeg").rotation.x = -s * 0.45 * amp;
    bone(vrm, "rightUpperLeg").rotation.x = s * 0.45 * amp;
    bone(vrm, "leftLowerLeg").rotation.x = Math.max(0, s) * 0.55 * amp;
    bone(vrm, "rightLowerLeg").rotation.x = Math.max(0, -s) * 0.55 * amp;
    bone(vrm, "leftUpperArm").rotation.x = s * 0.35 * amp;
    bone(vrm, "rightUpperArm").rotation.x = -s * 0.35 * amp;
    bone(vrm, "spine").rotation.y = s * 0.08 * amp;
  }

  function countMaterials(vrm) {
    var n = 0, seen = {};
    vrm.scene.traverse(function (o) {
      if (!o.isMesh) return;
      (Array.isArray(o.material) ? o.material : [o.material]).forEach(function (m) {
        if (!seen[m.uuid] && m.isMToonMaterial) { seen[m.uuid] = 1; n++; }
      });
    });
    return n;
  }

  function setupSayo(gltf, ms, bytes) {
    sayo = gltf.userData.vrm;
    sayo.scene.traverse(function (o) { o.frustumCulled = false; });
    scene.add(sayo.scene);
    sayo.scene.position.set(0, 0, 1.2);
    restPose(sayo);
    var verts = 0;
    sayo.scene.traverse(function (o) { if (o.isMesh && o.geometry) verts += o.geometry.attributes.position.count; });
    setReport("vrm", t("en_ok") + "（" + ms + " ms／" + (bytes / 1024).toFixed(0) + " KB）");
    setReport("spec", "VRM " + (sayo.meta.metaVersion === "1" ? "1.0" : sayo.meta.metaVersion));
    setReport("bones", Object.keys(sayo.humanoid.humanBones).length + "");
    setReport("expr", Object.keys(sayo.expressionManager.expressionMap).join(" / "));
    setReport("spring", sayo.springBoneManager ? sayo.springBoneManager.joints.size + "" : "0");
    setReport("mtoon", countMaterials(sayo) + "");
    setReport("verts", verts + "");
  }

  function updateSayo(dt, time) {
    if (!sayo) return;
    var em = sayo.expressionManager;
    restPose(sayo);
    var root3 = sayo.scene;
    if (sayoMode === "walk") {
      sayoWalk.z += sayoWalk.dir * dt * 0.9;
      if (sayoWalk.z < -6) sayoWalk.dir = 1;
      if (sayoWalk.z > 1.6) sayoWalk.dir = -1;
      var targetRot = sayoWalk.dir < 0 ? Math.PI : 0;
      root3.rotation.y += (targetRot - root3.rotation.y) * Math.min(1, dt * 6);
      root3.position.z = sayoWalk.z;
      var ph = time * 6.2;
      walkPose(sayo, ph, 1);
      root3.position.y = Math.abs(Math.sin(ph)) * 0.018;
    } else {
      root3.rotation.y += (0 - root3.rotation.y) * Math.min(1, dt * 4);
      root3.position.y = 0;
      bone(sayo, "chest").rotation.x = Math.sin(time * 1.6) * 0.025;
      bone(sayo, "head").rotation.y = Math.sin(time * 0.45) * 0.35;
      bone(sayo, "head").rotation.z = Math.sin(time * 0.7) * 0.05;
      bone(sayo, "spine").rotation.z = Math.sin(time * 0.8) * 0.02;
      if (sayoMode === "wave") {
        // 上臂略高於水平、前臂直立左右擺（手不要擋到臉）
        bone(sayo, "rightUpperArm").rotation.set(0, 0.25, -0.35);
        bone(sayo, "rightLowerArm").rotation.set(0, 0, -1.15 + Math.sin(time * 9) * 0.35);
        bone(sayo, "head").rotation.z = 0.08;
      }
    }
    // 表情：自動眨眼、說話時嘴巴開合、微笑
    blinkTimer -= dt;
    if (blinkTimer <= 0 && blinkT < 0) { blinkT = 0; blinkTimer = 2 + Math.random() * 3; }
    var blink = 0;
    if (blinkT >= 0) {
      blinkT += dt;
      blink = blinkT < 0.07 ? blinkT / 0.07 : Math.max(0, 1 - (blinkT - 0.07) / 0.08);
      if (blinkT > 0.15) blinkT = -1;
    }
    var smile = happy || sayoMode === "wave" ? 1 : 0;
    em.setValue("happy", smile);
    em.setValue("blink", smile ? 0 : blink);
    if (talkT > 0) {
      talkT -= dt;
      em.setValue("aa", Math.max(0, Math.sin(time * 18)) * 0.9);
    } else em.setValue("aa", 0);
    sayo.update(dt);
  }

  function sayoSpeak() {
    talkT = 2.2;
    var line = L(pick(SAYO_LINES));
    spawnBubble({ portrait: PORTRAITS[0], type: "impression", text: line, anchor: function (v) { return v.copy(sayo.scene.position).setY(1.62); } });
  }

  // ---------------------------------------------------------------- 看板人物圖集
  function recolor(vrm, outfit) {
    vrm.scene.traverse(function (o) {
      if (!o.isMesh) return;
      (Array.isArray(o.material) ? o.material : [o.material]).forEach(function (m) {
        var name = (m.name || "").split(" ")[0];
        var hex = name === "white" ? outfit.top : name === "red" ? outfit.bottom : name === "hair" ? outfit.hair : null;
        if (!hex) return;
        var c = new THREE.Color(hex); // 色彩管理已開，set 十六進位時會自動轉成 linear
        if (m.color) m.color.copy(c);
        if (m.shadeColorFactor) m.shadeColorFactor.copy(c).multiplyScalar(0.55);
      });
    });
  }

  function buildAtlas(gltf) {
    var t0 = performance.now();
    guestVrm = gltf.userData.vrm;
    var aScene = new THREE.Scene();
    aScene.add(new THREE.HemisphereLight("#c8d0ff", "#4a3a30", 0.9));
    var key = new THREE.DirectionalLight("#ffe2c0", 0.7);
    key.position.set(1, 3, 4);
    aScene.add(key);
    aScene.add(guestVrm.scene);
    guestVrm.scene.traverse(function (o) { o.frustumCulled = false; });

    // 正交相機以身體中心（y=0.74）為準、略微俯視（約 11°），畫格寬高 = BILL_SIZE
    var half = BILL_SIZE / 2;
    var cam = new THREE.OrthographicCamera(-half, half, half, -half, 0.1, 20);
    cam.position.set(0, 0.74 + 5 * Math.tan(0.2), 5);
    cam.lookAt(0, 0.74, 0);

    var cols = ATLAS_DIRS, rows = ATLAS_FRAMES * OUTFITS.length;
    var rt = new THREE.WebGLRenderTarget(cols * ATLAS_CELL, rows * ATLAS_CELL, { depthBuffer: true });
    rt.texture.generateMipmaps = false;
    rt.texture.minFilter = THREE.LinearFilter;
    rt.texture.magFilter = THREE.LinearFilter;

    var prevClear = renderer.getClearColor(new THREE.Color()), prevAlpha = renderer.getClearAlpha();
    renderer.setRenderTarget(rt);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, true);
    renderer.autoClear = false;
    rt.scissorTest = true;
    OUTFITS.forEach(function (outfit, v) {
      recolor(guestVrm, outfit);
      for (var f = 0; f < ATLAS_FRAMES; f++) {
        restPose(guestVrm);
        // 4 格：左腳在前、交錯、右腳在前、交錯
        walkPose(guestVrm, f * Math.PI / 2 + Math.PI / 2, 1);
        guestVrm.expressionManager.setValue("happy", v % 2 ? 0.6 : 0);
        for (var d = 0; d < cols; d++) {
          guestVrm.scene.rotation.y = d * Math.PI / 4;
          guestVrm.update(0);
          var x = d * ATLAS_CELL, y = (v * ATLAS_FRAMES + f) * ATLAS_CELL;
          rt.viewport.set(x, y, ATLAS_CELL, ATLAS_CELL);
          rt.scissor.set(x, y, ATLAS_CELL, ATLAS_CELL);
          renderer.setRenderTarget(rt);
          renderer.clearDepth();
          renderer.render(aScene, cam);
        }
      }
    });
    rt.scissorTest = false;
    renderer.autoClear = true;
    renderer.setRenderTarget(null);
    renderer.setClearColor(prevClear, prevAlpha);
    setReport("atlas", (cols * ATLAS_CELL) + "×" + (rows * ATLAS_CELL) + "，" + (cols * rows) + " " + t("en_cells") + "（" + Math.round(performance.now() - t0) + " ms）");
    return rt.texture;
  }

  function buildCrowd(atlasTex) {
    var maxN = 240;
    var base = new THREE.PlaneGeometry(1, 1);
    base.translate(0, 0.5, 0);
    var geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute("position", base.attributes.position);
    geo.setAttribute("uv", base.attributes.uv);
    var iPos = new THREE.InstancedBufferAttribute(new Float32Array(maxN * 3), 3);
    var iCell = new THREE.InstancedBufferAttribute(new Float32Array(maxN * 2), 2);
    var iScale = new THREE.InstancedBufferAttribute(new Float32Array(maxN), 1);
    iPos.setUsage(THREE.DynamicDrawUsage);
    iCell.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("iPos", iPos);
    geo.setAttribute("iCell", iCell);
    geo.setAttribute("iScale", iScale);
    geo.instanceCount = guestCount;
    var mat = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: atlasTex },
        uGrid: { value: new THREE.Vector2(ATLAS_DIRS, ATLAS_FRAMES * OUTFITS.length) },
        uSize: { value: BILL_SIZE },
        uTint: { value: new THREE.Color("#c9cfee") },
        uFog: { value: scene.fog.color },
        uFogNear: { value: scene.fog.near },
        uFogFar: { value: scene.fog.far },
      },
      vertexShader: [
        "attribute vec3 iPos; attribute vec2 iCell; attribute float iScale;",
        "uniform vec2 uGrid; uniform float uSize;",
        "varying vec2 vUv; varying float vDepth;",
        "void main() {",
        "  vec3 right = normalize(vec3(viewMatrix[0][0], 0.0, viewMatrix[2][0]));",
        "  vec3 wp = iPos + right * (position.x * uSize * iScale) + vec3(0.0, position.y * uSize * iScale, 0.0);",
        "  vUv = (iCell + uv) / uGrid;",
        "  vec4 mv = viewMatrix * vec4(wp, 1.0);",
        "  vDepth = -mv.z;",
        "  gl_Position = projectionMatrix * mv;",
        "}",
      ].join("\n"),
      fragmentShader: [
        "uniform sampler2D uMap; uniform vec3 uTint; uniform vec3 uFog; uniform float uFogNear; uniform float uFogFar;",
        "varying vec2 vUv; varying float vDepth;",
        "void main() {",
        "  vec4 c = texture2D(uMap, vUv);",
        "  if (c.a < 0.5) discard;",
        // 圖集是不透明模型畫在透明黑底上，邊緣經線性取樣後等於「預乘 alpha」：除回去，邊緣才不會一圈黑點
        "  c.rgb /= c.a;",
        "  float f = smoothstep(uFogNear, uFogFar, vDepth);",
        "  gl_FragColor = vec4(mix(c.rgb * uTint, uFog, f), 1.0);",
        "}",
      ].join("\n"),
    });
    crowd = new THREE.Mesh(geo, mat);
    crowd.frustumCulled = false;
    scene.add(crowd);
    for (var i = 0; i < maxN; i++) guests.push(newGuest(i));
    iScale.array.forEach(function (_, i) { iScale.array[i] = guests[i].scale; });
    iScale.needsUpdate = true;
  }

  function randomSpot() {
    // 參道上、小夜（z≈1.2）身後；前景留空，近景只有 VRM
    return { x: (Math.random() * 2 - 1) * 3.0, z: 0.2 - Math.random() * 30 };
  }

  function newGuest(i) {
    var p = randomSpot();
    var g = { id: i, x: p.x, z: p.z, h: Math.random() * Math.PI * 2, speed: 0.8 + Math.random() * 0.5, outfit: i % OUTFITS.length, phase: Math.random() * 4, scale: 0.9 + Math.random() * 0.16, wait: 0, target: randomSpot() };
    return g;
  }

  function setGuestCount(n) {
    guestCount = n;
    if (crowd) crowd.geometry.instanceCount = n;
    [60, 120, 240].forEach(function (k) {
      var b = document.getElementById("en-btn-crowd-" + k);
      if (b) b.classList.toggle("is-on", k === n);
    });
    setReport("crowd", n + "");
  }

  function updateCrowd(dt, time) {
    if (!crowd) return;
    var pos = crowd.geometry.attributes.iPos, cell = crowd.geometry.attributes.iCell;
    var camPos = camera.position;
    for (var i = 0; i < guestCount; i++) {
      var g = guests[i];
      var walking = true;
      if (g.wait > 0) { g.wait -= dt; walking = false; } else {
        var dx = g.target.x - g.x, dz = g.target.z - g.z;
        var dist = Math.sqrt(dx * dx + dz * dz);
        if (dist < 0.3) {
          g.target = randomSpot();
          if (Math.random() < 0.4) g.wait = 1 + Math.random() * 3;
        } else {
          var want = Math.atan2(dx, dz);
          var diff = Math.atan2(Math.sin(want - g.h), Math.cos(want - g.h));
          g.h += diff * Math.min(1, dt * 3);
          g.x += Math.sin(g.h) * g.speed * dt;
          g.z += Math.cos(g.h) * g.speed * dt;
        }
      }
      // 方向：客人朝向 − 鏡頭方位角（四捨五入到 45°）
      var a = Math.atan2(camPos.x - g.x, camPos.z - g.z);
      var k = Math.round((g.h - a) / (Math.PI / 4));
      k = ((k % 8) + 8) % 8;
      var frame = walking ? Math.floor(time * g.speed * 4 + g.phase) % 4 : 1;
      pos.setXYZ(i, g.x, 0.02, g.z);
      cell.setXY(i, k, g.outfit * ATLAS_FRAMES + frame);
    }
    pos.needsUpdate = true;
    cell.needsUpdate = true;
  }

  // ---------------------------------------------------------------- murmur
  function fill(text) {
    return text.replace("{ride}", L(pick(RIDES))).replace("{item}", L(pick(ITEMS))).replace("{food}", L(pick(FOODS)));
  }

  function spawnBubble(opt) {
    var b = el("button", "en-bubble en-mm-border-" + opt.type);
    b.type = "button";
    var img = el("img");
    img.src = opt.portrait.src;
    img.alt = "";
    b.appendChild(img);
    b.appendChild(el("span", null, opt.text));
    b.addEventListener("click", function () { openModal(opt.portrait, opt.type, opt.text); });
    overlay.appendChild(b);
    bubbles.push({ node: b, life: 4.8, anchor: opt.anchor });
    while (bubbles.length > 5) removeBubble(0);
    addWall(opt);
  }

  function removeBubble(i) {
    var b = bubbles[i];
    if (b.node.parentNode) b.node.parentNode.removeChild(b.node);
    bubbles.splice(i, 1);
  }

  function addWall(opt) {
    var li = el("li", "en-wall-item");
    var img = el("img");
    img.src = opt.portrait.src;
    img.alt = "";
    li.appendChild(img);
    var box = el("div");
    box.appendChild(el("span", "en-mm-type en-mm-" + opt.type, t("en_mm_" + opt.type)));
    box.appendChild(el("p", null, opt.text));
    li.appendChild(box);
    li.addEventListener("click", function () { openModal(opt.portrait, opt.type, opt.text); });
    wallList.insertBefore(li, wallList.firstChild);
    while (wallList.children.length > 30) wallList.removeChild(wallList.lastChild);
  }

  var tmpV = null; // THREE 載入後才建立（initThree）
  function guestMurmur() {
    // 挑一位在畫面內、不會太遠的客人
    for (var tries = 0; tries < 30; tries++) {
      var g = guests[Math.floor(Math.random() * guestCount)];
      tmpV.set(g.x, 1.65 * g.scale, g.z).project(camera);
      var d = Math.hypot(camera.position.x - g.x, camera.position.z - g.z);
      if (Math.abs(tmpV.x) < 0.8 && Math.abs(tmpV.y) < 0.9 && tmpV.z < 1 && d < 22) {
        var mm = pick(MURMURS);
        // 樣本：匿名客人也先借用立繪展示（小夜的氣泡留給她自己）
        spawnBubble({
          portrait: pick(PORTRAITS.slice(1)),
          type: mm.type,
          text: fill(L(mm.text)),
          anchor: (function (gg) { return function (v) { return v.set(gg.x, 1.62 * gg.scale, gg.z); }; })(g),
        });
        return;
      }
    }
  }

  function updateBubbles(dt) {
    bubbleTimer -= dt;
    if (bubbleTimer <= 0 && crowd) {
      bubbleTimer = 1.4 + Math.random() * 1.2;
      if (Math.random() < 0.12 && sayo) sayoSpeak();
      else guestMurmur();
    }
    var w = stage.clientWidth, h = stage.clientHeight;
    for (var i = bubbles.length - 1; i >= 0; i--) {
      var b = bubbles[i];
      b.life -= dt;
      if (b.life <= 0) { removeBubble(i); continue; }
      b.anchor(tmpV).project(camera);
      var visible = tmpV.z < 1 && Math.abs(tmpV.x) < 1.1 && Math.abs(tmpV.y) < 1.1;
      b.node.style.display = visible ? "" : "none";
      b.node.style.transform = "translate(" + ((tmpV.x * 0.5 + 0.5) * w) + "px," + ((-tmpV.y * 0.5 + 0.5) * h) + "px) translate(-50%,-100%)";
      b.node.style.opacity = Math.min(1, b.life / 0.6, (4.8 - b.life) / 0.3) + "";
    }
  }

  // ---------------------------------------------------------------- 迴圈
  function frame() {
    requestAnimationFrame(frame);
    var dt = Math.min(clock.getDelta(), 0.05), time = clock.elapsedTime;
    updateSayo(dt, time);
    updateCrowd(dt, time);
    if (wheel) wheel.rotation.z = time * 0.08;
    if (follow && sayo) {
      var p = sayo.scene.position;
      controls.target.lerp(tmpV.set(p.x, 1.05, p.z), Math.min(1, dt * 4));
    }
    controls.update();
    renderer.info.reset();
    composer.render();
    updateBubbles(dt);
    fps.frames++;
    fps.t += dt;
    if (fps.t >= 1) {
      fps.value = Math.round(fps.frames / fps.t);
      fps.frames = 0;
      fps.t = 0;
      setReport("fps", fps.value + "");
      setReport("calls", renderer.info.render.calls + "");
    }
  }

  function fail(err) {
    var box = document.getElementById("en-loading");
    if (box) {
      box.textContent = t("en_error") + "：" + (err && err.message ? err.message : err);
      box.classList.add("is-error");
    }
    setReport("vrm", t("en_ng") + "：" + (err && err.message ? err.message : err));
    if (window.console) console.error(err);
  }

  function start() {
    buildUi();
    loadScript(THREE_SRC)
      .then(function () { return loadScript(VENDOR_SRC); })
      .then(function () {
        V = window.PriTestEnnichiVendor;
        setReport("three", "r" + THREE.REVISION);
        setReport("vendor", V && V.VRMLoaderPlugin ? t("en_ok") : t("en_ng"));
        initThree();
        buildControls();
        setReport("crowd", guestCount + "");
        var t0 = performance.now();
        var bytes = 0;
        return fetch(MODEL_URL).then(function (r) { return r.arrayBuffer(); }).then(function (buf) {
          bytes = buf.byteLength;
          return Promise.all([loadVrm(), loadVrm()]);
        }).then(function (both) {
          setupSayo(both[0], Math.round(performance.now() - t0), bytes);
          buildCrowd(buildAtlas(both[1]));
          var box = document.getElementById("en-loading");
          if (box) box.parentNode.removeChild(box);
          frame();
          report.ready = true;
        });
      })
      .catch(fail);
  }

  window.PriTestEnnichiLab = {
    _report: function () { return report; },
    _state: function () { return { sayoMode: sayoMode, happy: happy, guests: guestCount, bubbles: bubbles.length, wall: wallList ? wallList.children.length : 0 }; },
  };

  window.addEventListener("i18n:change", function () {
    if (!report.ready) return;
    // 語言切換：重建 HTML 文字（3D 場景保留）
    var head = root.querySelector(".en-head");
    head.querySelector(".en-title").textContent = t("en_lab_title");
    head.querySelector(".en-lead").textContent = t("en_lab_lead");
  });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
