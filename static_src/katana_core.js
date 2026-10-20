// 神前鍛刀對決（katana）規則引擎：純函式，不碰 DOM／localStorage，方便用 node 測試。
//
// 流程（詳見 docs/katana_game_design.md）：
//   鍛刀（forge，13 道工序，多人輪流；依材料形態略過不需要的工序）→ 神前審查（judge，五項各 20 分）
//   → 開刃試鋒（cut）→ 互擊（clash）→ 總結（end）
// 每道工序的隨機結果都用「seed｜玩家序號｜工序 id」的確定性亂數，重新整理也不會重抽。
//
// 冶金模型（使用者指定「盡可能精確」，見設計文件 §3）：
//   ・脫碳：碳在沃斯田鐵中的擴散係數 D = 2.3e-5·exp(−148 kJ / RT)，表面脫碳量 ∝ √(Dt)／板厚
//   ・沸燒上限：Fe–C 固相線（C 越高越低），超過就燒損
//   ・Ac1／Ac3：Andrews 經驗式；Acm：Fe–C 狀態圖的 ES 線
//   ・淬透性：Grossmann 理想臨界直徑 DI（碳量・晶粒度・合金元素倍率）× 淬火強烈度 H（土層改變 H）
//   ・麻田散鐵比例：截面各位置的冷卻是否快於臨界 × Koistinen–Marburger 式（Ms 由 Andrews 式）
//   ・硬度：Hodge–Orehoski 的麻田散鐵硬度 × 相分率；回火：Hollomon–Jaffe 參數
//   ・淬火反り：麻田散鐵變態膨脹（ΔV/V ≈ 1.68·C %）作為固有應變，以樑理論求曲率 → 弓高 κL²/8
//   ・韌性：硬度、晶粒、回火脆性（250〜400℃）、夾雜物、P、Ni、心鐵複合
// 這些是有文獻依據的經驗式，但刀匠實務還有許多無法量化的因素；遊戲中的數值是「合理的近似」。
(function () {
  "use strict";

  var D = window.PriTestKatanaData;
  var MIN_PLAYERS = 1;
  var MAX_PLAYERS = 8;
  var KOWARI_PIECES = 12;
  var HAMMER_STRIKES = 8;
  var R_GAS = 8.314;
  var EDGE_THICK = 1.2;        // 淬火前刃口厚度（刀匠會留厚一點以免淬裂）
  var AIR_COOL_RATE = 25;      // 取出後到入水前，刃口在空氣中的降溫（℃/秒）
  var FOLD_BAR_MM = 15;        // 折返時鋼坯厚度
  var FOLD_HEAT_S = 100;       // 每次加熱在高溫的秒數
  var HEATS_PER_FOLD = 3;
  var FLUX_PROTECT = 0.55;     // 藁灰・泥汁使脫碳減少的倍率
  var SORI_PLASTIC = 2.5;      // 淬火反り的塑性放大（校正值，見 quenchModel）

  function N(ja, zh) { return { ja: ja, zh: zh }; }
  function clone(obj) { return JSON.parse(JSON.stringify(obj)); }
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function round1(v) { return Math.round(v * 10) / 10; }
  function round2(v) { return Math.round(v * 100) / 100; }
  function round3(v) { return Math.round(v * 1000) / 1000; }

  function byId(list, id) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  // FNV-1a 32bit
  function hashStr(s) {
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  }

  // mulberry32
  function makeRng(seed) {
    var a = hashStr(String(seed));
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function gauss(rng) { return (rng() + rng() + rng() - 1.5) / 0.5; } // 約 N(0,1)
  function stepRng(state, pIndex, key) { return makeRng(state.seed + "|" + pIndex + "|" + key); }

  // 溫度在 [lo, hi] 內為 1，往外每 fall ℃ 線性降到 0
  function heatScore(temp, lo, hi, fall) {
    if (temp >= lo && temp <= hi) return 1;
    var d = temp < lo ? lo - temp : temp - hi;
    return clamp(1 - d / fall, 0, 1);
  }

  // ======================================================================
  // 冶金
  // ======================================================================

  // 碳在 γ 鐵中的擴散係數（m²/s）
  function diffC(Tc) { return 2.3e-5 * Math.exp(-148000 / (R_GAS * (Tc + 273.15))); }

  // Fe–C 固相線（℃）：純鐵 1538、包晶點 0.17% 1495、共晶點 2.11% 1148（二次近似）；Ni 每 1% 約降 3℃
  function solidus(C, Ni) {
    var t = C <= 0.17 ? 1538 - (1538 - 1495) * C / 0.17 : 1495 - 120 * (C - 0.17) - 30 * (C - 0.17) * (C - 0.17);
    return t - 3 * (Ni || 0);
  }

  function comp(b) {
    var m = byId(D.KAWAGANE, b.kawaId) || D.KAWAGANE[0];
    var c = clone(m.comp);
    c.C = b.kawaC || c.C;
    return c;
  }

  function ac1(c) { return 723 - 10.7 * c.Mn - 16.9 * c.Ni + 29.1 * c.Si + 16.9 * c.Cr + 6.38 * c.W; }
  function a3Const(c) { return 910 - 15.2 * c.Ni + 44.7 * c.Si + 104 * c.V + 31.5 * c.Mo + 13.1 * c.W; }
  function ac3(c) { return a3Const(c) - 203 * Math.sqrt(Math.max(0.01, c.C)); }
  // 共析碳量：合金元素使其左移（近似）
  function eutectoidC(c) { return 0.77 - 0.05 * c.Ni - 0.03 * c.Mn - 0.05 * c.Cr - 0.03 * c.W; }
  // ES 線（Acm）：由 Ac1 起每 1% C 約升 314℃
  function acm(c) { return ac1(c) + 314 * Math.max(0, c.C - eutectoidC(c)); }
  // Andrews 的 Ms 式（Cd 為溶入沃斯田鐵的碳）
  function msTemp(c, Cd) { return 539 - 423 * Cd - 30.4 * c.Mn - 17.7 * c.Ni - 12.1 * c.Cr - 7.5 * c.Mo - 7.5 * c.Si; }

  // 淬火溫度 T 下的沃斯田鐵分率 fa 與溶入碳量 Cd
  function austenite(c, T) {
    var A1 = ac1(c), Ce = eutectoidC(c);
    if (T < A1) return { fa: 0, Cd: 0, excess: 0 };
    if (c.C <= Ce) {
      var A3 = ac3(c);
      if (T >= A3) return { fa: 1, Cd: c.C, excess: 0 };
      var s = (a3Const(c) - T) / 203;
      var Cg = clamp(s * s, c.C, Ce);
      var fa = clamp((c.C - 0.02) / Math.max(0.01, Cg - 0.02), 0, 1); // 槓桿定則（肥粒鐵 0.02%）
      return { fa: fa, Cd: Cg, excess: 0 };
    }
    var Cd = Math.min(c.C, Ce + (T - A1) / 314);
    return { fa: 1, Cd: Cd, excess: c.C - Cd };
  }

  // Grossmann 理想臨界直徑（mm）。G：ASTM 晶粒度號
  function idealDiameter(c, Cd, G) {
    var base = 0.29 * Math.sqrt(clamp(Cd, 0.05, 0.9));
    var f = (1 + 3.333 * c.Mn) * (1 + 0.7 * c.Si) * (1 + 0.363 * c.Ni) * (1 + 2.16 * c.Cr) * (1 + 3.0 * c.Mo) * (1 + 0.5 * c.W) * (1 + 1.73 * c.V);
    return base * f * Math.pow(1.09, 7 - G) * 25.4;
  }

  // 冷卻後可變態為麻田散鐵的比例（厚度 t mm、強烈度 H）。
  // 平板約等於直徑 1.5t 的圓棒；刀身是楔形，刃口附近還會往刃尖方向散熱，取 1.2t
  function coolFraction(DI, H, t) {
    var Dc = DI * H / (H + 0.8);
    return 1 / (1 + Math.exp((1.2 * t - Dc) / (0.2 * Dc)));
  }

  // HRC ⇔ HV 近似換算（相分率的硬度以 HV 線性混合較合理）
  function hrcToHv(h) { return Math.pow(1500 / (116 - h), 2); }
  function hvToHrc(v) { return 116 - 1500 / Math.sqrt(v); }

  // Hodge–Orehoski：100% 麻田散鐵的 HRC（C ≤ 0.7 有效，以上近似平台）
  function hrcMartensite(C) {
    var x = Math.min(C, 0.7);
    var h = 35.395 + 6.990 * x + 312.330 * x * x - 821.744 * Math.pow(x, 3) + 1015.479 * Math.pow(x, 4) - 538.346 * Math.pow(x, 5);
    if (C > 0.7) h += Math.min(1.5, (C - 0.7) * 5);
    return h;
  }

  function hrcPearlite(C) { return 8 + 22 * Math.pow(Math.min(C, 0.8), 0.8); }

  // 截面位置 y（0＝刃口，1＝刀背；雙刃時 1＝另一側刃口）的厚度
  function thicknessAt(y, b, tk) {
    var K = b.kasane || 7;
    var EDGE_THICK_MM = Math.min(EDGE_THICK, K * 0.6);
    if (tk.edges === 2) {
      var yy = Math.min(y, 1 - y) / 0.5;
      return EDGE_THICK_MM + (K - EDGE_THICK_MM) * yy;
    }
    var at = tk.shinogiAt || 0.67;
    if (y <= at) return EDGE_THICK_MM + (K - EDGE_THICK_MM) * y / at;
    return K * (1 - 0.12 * (y - at) / Math.max(0.01, 1 - at)); // 鎬到棟稍薄
  }

  // 淬火計算：回傳截面上 21 點的相分率與硬度、刃文位置、反り等
  function quenchModel(b, T, mediaId, G) {
    var c = comp(b);
    var tk = byId(D.TSUKURI, b.tsukuri) || D.TSUKURI[0];
    var hm = byId(D.HAMON, b.hamon) || D.HAMON[0];
    var media = byId(D.QUENCH_MEDIA, mediaId) || D.QUENCH_MEDIA[2];
    var eClay = byId(D.CLAY_LEVELS, b.edgeClay) || D.CLAY_LEVELS[0];
    var sClay = byId(D.CLAY_LEVELS, b.spineClay) || D.CLAY_LEVELS[2];
    var au = austenite(c, T);
    var Ms = msTemp(c, au.Cd);
    var fKM = Ms > media.bath ? 1 - Math.exp(-0.011 * (Ms - media.bath)) : 0;
    var DI = idealDiameter(c, au.Cd || c.C, G);
    var pts = [];
    var NPT = 20;
    for (var i = 0; i <= NPT; i++) {
      var y = i / NPT;
      var yEdge = tk.edges === 2 ? Math.min(y, 1 - y) : y;
      var H = media.H;
      if (hm.id !== "none") H *= yEdge < hm.width ? eClay.hMul : sClay.hMul;
      var t = thicknessAt(y, b, tk);
      var cool = coolFraction(DI, H, t);
      var M = au.fa * cool * fKM;
      var RA = au.fa * cool * (1 - fKM);
      var hv = M * hrcToHv(hrcMartensite(au.Cd)) + RA * hrcToHv(20) + (1 - M - RA) * hrcToHv(hrcPearlite(c.C));
      var hrc = hvToHrc(hv) + (M > 0.5 ? Math.min(3, au.excess * 4) : 0);
      pts.push({ y: y, t: t, H: H, M: M, RA: RA, hrc: hrc });
    }
    // 刃文（硬化邊界）：由刃口往內第一個麻田散鐵 < 0.5 的位置
    var boundary = 1;
    var limit = tk.edges === 2 ? NPT / 2 : NPT;
    for (var j = 0; j <= limit; j++) if (pts[j].M < 0.5) { boundary = pts[j].y; break; }
    if (tk.edges === 2 && boundary === 1) boundary = 0.5;
    // 刃文清晰度：麻田散鐵由刃口值的 75% 降到 25% 的過渡寬度（mm，越窄匂口越冴）× 邊界與土線的吻合度
    var clarity = 0;
    var Me = pts[1].M;
    if (hm.id !== "none" && Me > 0.3) {
      var y75 = null, y25 = null;
      for (var q = 1; q <= limit; q++) {
        if (y75 === null && pts[q].M < 0.75 * Me) y75 = pts[q].y;
        if (y25 === null && pts[q].M < 0.25 * Me) { y25 = pts[q].y; break; }
      }
      var widthMm = ((y25 === null ? 1 : y25) - (y75 === null ? 0 : y75)) * (b.mihaba || 30);
      clarity = clamp(1 - widthMm / 15, 0, 1) * clamp(1 - Math.abs(boundary - hm.width) * 3, 0, 1);
      // 土層下（刀背側）也淬硬 → 刃文糊掉
      var Ms_ = tk.edges === 2 ? pts[NPT / 2].M : pts[NPT - 1].M;
      clarity *= 1 - clamp(Ms_ / Me, 0, 1);
    }
    // 淬火反り：固有應變 ε(y) = M·ΔV/3，以樑理論求曲率 κ = ∫ε(y−yc)t dy / ∫(y−yc)²t dy（y 以 mm）
    var W = b.mihaba || 30, eps0 = 1.68 * au.Cd / 100 / 3;
    var A = 0, Sy = 0;
    pts.forEach(function (p) { A += p.t; Sy += p.t * p.y * W; });
    var yc = Sy / A, num = 0, den = 0;
    pts.forEach(function (p) {
      var yy = p.y * W - yc;
      num += eps0 * p.M * yy * p.t;
      den += yy * yy * p.t;
    });
    var kappa = -num / den; // 刃側（y 小）膨脹 → 刃側凸 → 正的反り
    // 塑性放大：淬火初期刃口先收縮、高溫的刀背降伏，之後刃口變態膨脹，實際彎度大於彈性解。
    // 依實務「淬火約產生 1〜1.5cm 反り」校正為 2.5 倍（無法單靠解析式求得，屬校正值）
    var soriQ = kappa * Math.pow((b.length || 70) * 10, 2) / 8 * SORI_PLASTIC;
    return {
      comp: c, au: au, Ms: Ms, fKM: fKM, DI: DI, pts: pts, boundary: boundary, clarity: clarity,
      edge: pts[0], spine: tk.edges === 2 ? pts[NPT / 2] : pts[NPT - 1], soriQ: soriQ, media: media
    };
  }

  // 回火色（氧化膜干涉色）：給定溫度取最接近、且不高於該溫度的色階
  function temperColorAt(T) {
    var c = D.TEMPER_COLORS[0];
    D.TEMPER_COLORS.forEach(function (x) { if (T >= x.t) c = x; });
    return c;
  }

  // Hollomon–Jaffe 回火參數 → 硬度下降（HRC）
  function temperDrop(Tc, hours) {
    if (!Tc) return 0;
    var P = (Tc + 273.15) * (20 + Math.log(hours) / Math.LN10);
    var P0 = 8200;
    if (P <= P0) return 0;
    var d = Math.min(P, 11500) - P0;
    var drop = 0.003 * d;
    if (P > 11500) drop += 0.0018 * (P - 11500);
    return drop;
  }

  // 回火韌性修正（含 230〜400℃ 回火麻田散鐵脆性）
  function temperToughness(Tc) {
    if (!Tc) return -12;
    var rec = 18 * (1 - Math.exp(-Math.max(0, Tc - 80) / 70));
    if (Tc > 230 && Tc < 400) rec -= 26 * Math.sin(Math.PI * (Tc - 230) / 170); // 回火麻田散鐵脆性（谷底約 315℃）
    return rec;
  }

  // 每次加熱的脫碳比例（板厚 h mm、時間 t s、保護倍率 prot）
  function decarbFrac(T, h, t, prot) {
    return clamp(4 / h * Math.sqrt(diffC(T) * t / Math.PI) * 1000 * prot, 0, 0.5);
  }

  // 每次加熱的氧化損失比例（拋物線氧化，以 1300℃、有保護 2.7% 校正；Q = 165 kJ）
  function scaleLoss(T, prot) {
    var f = Math.exp(-165000 / (2 * R_GAS) * (1 / (T + 273.15) - 1 / 1573.15));
    return clamp(0.027 * f * (prot >= 1 ? 1.8 : 1), 0, 0.2);
  }

  // 熱脆：S 多且 Mn/S 低時，FeS 在晶界熔化（約 988℃ 共晶）→ 950〜1150℃ 鍛打易裂
  function hotShortRisk(c, T) {
    if (c.S <= 0.012 || c.Mn / c.S >= 4) return 0;
    return T >= 950 && T <= 1150 ? 0.5 : 0;
  }

  // 給 UI／輔助模式看的冶金數值
  function metallurgy(b) {
    var c = comp(b);
    var Ts = solidus(c.C, c.Ni);
    return {
      C: round2(c.C), solidus: Math.round(Ts), ac1: Math.round(ac1(c)), ac3: Math.round(ac3(c)), acm: Math.round(acm(c)),
      eutectoid: round2(eutectoidC(c)), hyper: c.C > eutectoidC(c), ms: Math.round(msTemp(c, Math.min(c.C, eutectoidC(c)))),
      di: round1(idealDiameter(c, Math.min(c.C, 0.8), b.grain || 7)), mnS: c.S ? round1(c.Mn / c.S) : 99
    };
  }

  // ======================================================================
  // 遊戲進行
  // ======================================================================

  function stepIndex(id) {
    for (var i = 0; i < D.STEPS.length; i++) if (D.STEPS[i].id === id) return i;
    return -1;
  }

  function materialForm(b) { var m = byId(D.KAWAGANE, b.kawaId); return m ? m.form : "bloom"; }

  function stepApplies(b, step) { return !step.forms || !b.kawaId || step.forms.indexOf(materialForm(b)) >= 0; }

  // 模式（使用者指定 2026-10-20）：
  //   show（表演）：加熱窗口放寬、瑕疵與淬裂機率減半、小遊戲失誤影響減半、非傳統鋼材打日本刀不扣分（趣味）
  //   serious（較真）：完整冶金模型，與冶煉知識一致
  var MODES = ["show", "serious"];
  var SHOW_LENIENCY = 0.5;

  function isShow(b) { return b.mode === "show"; }
  // 瑕疵類機率：表演模式減半
  function chance(b, p) { return isShow(b) ? p * SHOW_LENIENCY : p; }
  // 小遊戲精準度：表演模式把失誤減半（0.6 → 0.8）
  function skill(b, acc) {
    acc = clamp(typeof acc === "number" ? acc : 0.7, 0, 1);
    return isShow(b) ? 1 - (1 - acc) * SHOW_LENIENCY : acc;
  }

  function newBlade(mode) {
    return {
      mode: mode || "serious",
      kawaId: null, shinId: null, type: null, kawaKg: 0, shinKg: 0, kawaC: 0, shinC: 0,
      impurity: 0, shinImp: 0, consistency: 1, layers: 1, folds: 0, shinFolds: 0, reheats: 0,
      pattern: "itame", patternWanted: null, patternIntact: true, maxForgeT: 0, construction: null, weldQ: 0, hammerQ: [],
      steelKg: 0, steelRatio: 1, length: 0, uniformity: 1,
      tsukuri: null, kissaki: null, mune: null, soriType: null, kasane: 0, mihaba: 0, forgeSori: 0,
      grain: 6, normCount: 0,
      hamon: null, edgeClay: null, spineClay: null, ashi: false,
      quenchTemp: 0, media: null, dark: false, hamonClarity: 0, hamonBoundary: 0, hardEdge: 0, hardSpine: 0,
      edgeM: 0, spineM: 0, retainedAus: 0, ms: 0, cdiss: 0, excessC: 0, sori: 0, soriQuench: 0,
      temperTemp: 0, temperHours: 1, clayAcc: 1, quenchDelay: 0, shapeAcc: 1,
      polish: 0, polishRhythm: 1, stoneOrder: [], edge: null,
      yasurime: null, nakagojiri: null, mei: "", meiAcc: 1,
      flaws: []
    };
  }

  function newGame(opts) {
    var names = (opts.names || []).map(function (n) { return String(n || "").trim(); });
    if (names.length < MIN_PLAYERS || names.length > MAX_PLAYERS) throw new Error("player-count");
    var seed = opts.seed || String(Date.now()) + Math.floor(Math.random() * 1e6);
    var mode = MODES.indexOf(opts.mode) >= 0 ? opts.mode : "serious";
    return {
      v: 3,
      seed: String(seed),
      assist: !!opts.assist,
      mode: mode,
      phase: "forge",
      players: names.map(function (n, i) {
        return { id: "p" + (i + 1), name: n || ("#" + (i + 1)), step: 0, blade: newBlade(mode), log: [] };
      }),
      cut: null,
      clash: null
    };
  }

  // 輪到誰：工序最少的人；同進度時座位在前者優先 → 自然形成「每道工序全員輪一次」
  function currentForger(state) {
    var best = -1;
    state.players.forEach(function (p, i) {
      if (p.step >= D.STEPS.length) return;
      if (best < 0 || p.step < state.players[best].step) best = i;
    });
    return best;
  }

  function addFlaw(b, id) { if (b.flaws.indexOf(id) < 0) b.flaws.push(id); }
  function hasFlaw(b, id) { return b.flaws.indexOf(id) >= 0; }

  // ---------------- 小割：破面樣本 ----------------
  // 水へし後急冷：高碳部分成為麻田散鐵而脆，斷口細緻銀白；低碳部分韌，斷口粗大閃亮。
  // look：結晶（fine／mid／coarse）；sheen：色（silver／grey／glitter）；spots：斑點（none／few／many）

  // mizuAcc：水壓（打薄）小遊戲的精準度。打得越均勻，淬水後的斷口越能反映真正的含碳量
  function kowariPieces(state, pIndex, mizuAcc) {
    var b = state.players[pIndex].blade;
    var mat = byId(D.KAWAGANE, b.kawaId) || D.KAWAGANE[0];
    var rng = stepRng(state, pIndex, "kowari-pieces");
    var noise = 0.06 + (1 - skill(b, mizuAcc === undefined ? 1 : mizuAcc)) * 0.2;
    var pieces = [];
    for (var i = 0; i < KOWARI_PIECES; i++) {
      var c = clamp(mat.comp.C + gauss(rng) * mat.spread, 0.05, 1.8);
      var slag = clamp(mat.slag + gauss(rng) * mat.slag * 0.9, 0, 95);
      var cView = c + gauss(rng) * noise;
      var look = cView >= 1.0 ? "fine" : (cView >= 0.6 ? "mid" : "coarse");
      var sheen = cView >= 1.0 ? "silver" : (cView >= 0.6 ? "grey" : "glitter");
      var sView = slag + gauss(rng) * 5;
      var spots = sView < 15 ? "none" : (sView < 40 ? "few" : "many");
      pieces.push({ carbon: round2(c), slag: Math.round(slag), look: look, sheen: sheen, spots: spots });
    }
    return pieces;
  }

  // ---------------- 加熱目標 ----------------
  // heatId：tsumi／fold／weld／quench。fold 時 opts.folds 為 0 代表只延展不鍛接（鍛造溫度）

  // 表演模式：窗口上下各放寬 40℃、偏離時扣分較慢
  function heatWindow(b, heatId, opts) {
    var w = heatWindowRaw(b, heatId, opts);
    if (isShow(b)) { w.lo -= 40; w.hi += 40; w.fall = Math.round(w.fall * 1.5); }
    if (w.burn < 9999) w.hi = Math.min(w.hi, w.burn - 5);
    return w;
  }

  // 燒損溫度：固相線 −15℃（表演模式放寬到 +10℃）
  function burnTemp(b, Ts) { return Ts - 15 + (isShow(b) ? 25 : 0); }

  function heatWindowRaw(b, heatId, opts) {
    opts = opts || {};
    var c = comp(b);
    var Ts = solidus(c.C, c.Ni);
    if (heatId === "quench") {
      var hyper = c.C > eutectoidC(c);
      var base = hyper ? ac1(c) : ac3(c);
      return { lo: Math.round(base + 20), hi: Math.round(base + 60), min: 550, max: 1000, fall: 60, burn: 9999 };
    }
    if (heatId === "fold" && !opts.folds) {
      var mf = materialForm(b) === "ingot" ? acm(c) - 10 : Math.min(1150, Ts - 150);
      var lo = materialForm(b) === "ingot" ? 800 : 950;
      return { lo: lo, hi: Math.round(mf), min: 600, max: 1450, fall: 120, burn: Math.round(burnTemp(b, Ts)) };
    }
    return { lo: Math.round(Ts - 150), hi: Math.round(Ts - 35), min: 700, max: 1500, fall: 120, burn: Math.round(burnTemp(b, Ts)) };
  }

  // ---------------- 工序驗證 ----------------

  function between(v, lo, hi) { return typeof v === "number" && v >= lo && v <= hi; }

  function validate(state, pIndex, stepId, input) {
    var b = state.players[pIndex].blade;
    input = input || {};
    if (stepId === "material") {
      if (!byId(D.KAWAGANE, input.kawagane) || !byId(D.SHINGANE, input.shingane) || !byId(D.BLADE_TYPES, input.type)) return "kt_err_pick";
      if (!between(input.kawaKg, 2, 12)) return "kt_err_range";
      if (input.shingane !== "none" && !between(input.shinKg, 0.5, 4)) return "kt_err_range";
    } else if (stepId === "kowari") {
      if (!input.picks || input.picks.length !== KOWARI_PIECES) return "kt_err_kowari_all";
      for (var i = 0; i < input.picks.length; i++) if (["kawa", "shin", "discard"].indexOf(input.picks[i]) < 0) return "kt_err_kowari_all";
      if (input.picks.filter(function (x) { return x === "kawa"; }).length < 3) return "kt_err_kowari_min";
    } else if (stepId === "tsumi" || stepId === "yakiire") {
      if (typeof input.temp !== "number") return "kt_err_heat";
      if (stepId === "yakiire" && !byId(D.QUENCH_MEDIA, input.media)) return "kt_err_pick";
    } else if (stepId === "shitakitae" || stepId === "uwakitae") {
      if (typeof input.temp !== "number") return "kt_err_heat";
      if (!input.hammer || !(input.hammer.strikes >= HAMMER_STRIKES)) return "kt_err_hammer";
      if (!between(input.folds, 0, 12)) return "kt_err_range";
      if (stepId === "shitakitae" && b.shinId !== "none" && !between(input.shinFolds, 0, 10)) return "kt_err_range";
      if (stepId === "uwakitae" && !byId(D.PATTERNS, input.pattern)) return "kt_err_pick";
    } else if (stepId === "tsukurikomi") {
      var con = byId(D.CONSTRUCTIONS, input.construction);
      if (!con) return "kt_err_pick";
      if (con.needsShingane && b.shinId === "none") return "kt_err_need_shingane";
      if (typeof input.temp !== "number") return "kt_err_heat";
    } else if (stepId === "sunobe") {
      var bt = byId(D.BLADE_TYPES, b.type);
      if (!bt || !between(input.length, bt.min, bt.max)) return "kt_err_range";
      if (!input.hammer || !(input.hammer.strikes >= HAMMER_STRIKES)) return "kt_err_hammer";
    } else if (stepId === "hizukuri") {
      var tk = byId(D.TSUKURI, input.tsukuri), ks = byId(D.KISSAKI, input.kissaki), bt2 = byId(D.BLADE_TYPES, b.type);
      if (!tk || !ks || !byId(D.SORI_TYPES, input.soriType) || !bt2) return "kt_err_pick";
      if (tk.edges !== bt2.edges || (ks.edges && ks.edges !== bt2.edges)) return "kt_err_pick";
      if (bt2.edges === 1 && !byId(D.MUNE, input.mune)) return "kt_err_pick";
      if (!between(input.kasane, 0.3, 15) || !between(input.mihaba, 8, 90) || !between(input.forgeSori, -150, 300)) return "kt_err_range";
    } else if (stepId === "tsuchioki") {
      if (!byId(D.HAMON, input.hamon) || !byId(D.CLAY_LEVELS, input.edgeClay) || !byId(D.CLAY_LEVELS, input.spineClay)) return "kt_err_pick";
      if (!between(input.norm, 0, 3)) return "kt_err_range";
    } else if (stepId === "aitori") {
      // temp：回火色小遊戲停火時的溫度（0＝不回火）
      if (!between(input.temp, 0, 650) || D.TEMPER_HOURS.indexOf(input.hours) < 0) return "kt_err_pick";
      if (!between(input.soriAdjust, -5, 5)) return "kt_err_range";
    } else if (stepId === "togi") {
      if (!input.order || !input.order.length) return "kt_err_togi";
      if (!byId(D.EDGE_GEOMETRY, input.edge)) return "kt_err_pick";
    } else if (stepId === "mei") {
      if (!byId(D.YASURIME, input.yasurime) || !byId(D.NAKAGOJIRI, input.nakagojiri)) return "kt_err_pick";
    } else {
      return "kt_err_step";
    }
    return null;
  }

  // ---------------- 工序套用 ----------------

  function hammerAcc(h) { return clamp(h && typeof h.acc === "number" ? h.acc : 0, 0, 1); }

  function applyMaterial(b, input, notes) {
    var k = byId(D.KAWAGANE, input.kawagane), s = byId(D.SHINGANE, input.shingane), bt = byId(D.BLADE_TYPES, input.type);
    b.kawaId = k.id; b.shinId = s.id; b.type = bt.id;
    b.kawaKg = input.kawaKg; b.shinKg = s.id === "none" ? 0 : input.shinKg;
    b.kawaC = k.comp.C; b.shinC = s.comp.C; b.impurity = k.slag; b.shinImp = s.slag;
    b.layers = k.layers || 1;
    b.consistency = round2(clamp(1 - k.spread / 0.35, 0, 1));
    if (k.pattern === "damascus") b.pattern = "damascus";
    else if (k.pattern === "wootz") b.pattern = "wootz";
    else if (k.pattern === "meteor") b.pattern = "meteor";
    else if (k.pattern === "none") b.pattern = "none";
    notes.push(N(bt.name.ja + "を作る。皮鉄は" + k.name.ja + " " + input.kawaKg + "kg。", "要打造" + bt.name.zh + "。皮鐵用" + k.name.zh + " " + input.kawaKg + "kg。"));
    if (bt.family === "nihonto" && !k.authentic) notes.push(isShow(b) ? N("玉鋼以外の鋼の日本刀。表演モードなので趣味として楽しめる（減点なし）。", "以玉鋼以外的鋼打日本刀。表演模式下屬於趣味，不扣分。")
      : N("玉鋼以外の鋼の日本刀。神前の審査では本筋から外れると見られる。", "以玉鋼以外的鋼打日本刀，神前審查會視為偏離正統。"));
    if (bt.family !== "nihonto" && k.authentic) notes.push(N("玉鋼で異国の刃を打つ。", "以玉鋼打造異國刀劍。"));
  }

  function applyKowari(state, pIndex, b, input, notes) {
    var pieces = kowariPieces(state, pIndex, input.mizuheshi ? input.mizuheshi.acc : undefined);
    var w = b.kawaKg / KOWARI_PIECES;
    var kawa = [], shinAdd = [];
    input.picks.forEach(function (p, i) {
      if (p === "kawa") kawa.push(pieces[i]);
      else if (p === "shin" && b.shinId !== "none") shinAdd.push(pieces[i]);
    });
    var sumC = 0, sumS = 0;
    kawa.forEach(function (x) { sumC += x.carbon; sumS += x.slag; });
    var meanC = sumC / kawa.length, varC = 0;
    kawa.forEach(function (x) { varC += (x.carbon - meanC) * (x.carbon - meanC); });
    b.kawaKg = round2(kawa.length * w);
    b.kawaC = round3(meanC);
    b.impurity = Math.round(sumS / kawa.length);
    b.consistency = round2(clamp(1 - Math.sqrt(varC / kawa.length) / 0.35, 0, 1));
    if (shinAdd.length) {
      var addKg = shinAdd.length * w, addC = 0, addS = 0;
      shinAdd.forEach(function (x) { addC += x.carbon; addS += x.slag; });
      b.shinC = round3((b.shinC * b.shinKg + addC * w) / (b.shinKg + addKg));
      b.shinImp = Math.round((b.shinImp * b.shinKg + addS * w) / (b.shinKg + addKg));
      b.shinKg = round2(b.shinKg + addKg);
    }
    var bad = kawa.filter(function (x) { return x.slag >= 40; }).length;
    var low = kawa.filter(function (x) { return x.carbon < 0.6; }).length;
    if (bad) notes.push(N("鉄滓の多い小片が " + bad + " 個混ざった。", "混入了 " + bad + " 片鐵滓多的碎片。"));
    if (low) notes.push(N("炭素の少ない小片が " + low + " 個皮鉄に入った。", "有 " + low + " 片低碳碎片混進了皮鐵。"));
    if (!bad && !low) notes.push(N("見事な選別。", "分揀得漂亮。"));
  }

  // 一次加熱（脫碳・氧化・燒損）。h：板厚、t：秒、prot：保護倍率。回傳 burned
  function heatCycle(b, T, h, t, prot) {
    var c = comp(b);
    var Ts = solidus(c.C, c.Ni);
    b.kawaC *= 1 - decarbFrac(T, h, t, prot);
    b.kawaKg *= 1 - scaleLoss(T, prot);
    b.maxForgeT = Math.max(b.maxForgeT, T);
    if (T >= burnTemp(b, Ts)) {
      b.kawaKg *= 0.92; b.kawaC *= 0.9;
      return true;
    }
    return false;
  }

  function applyTsumi(state, pIndex, b, input, notes) {
    var rng = stepRng(state, pIndex, "tsumi");
    var w = heatWindow(b, "tsumi");
    var T = input.temp, prot = input.ash ? FLUX_PROTECT : 1;
    var C0 = b.kawaC;
    var burned = heatCycle(b, T, 40, 900, prot);
    if (!input.ash) notes.push(N("藁灰・泥汁を省いたため酸化して鋼が減り、脱炭した。", "省略稻草灰與泥漿，鋼材氧化減少並脫碳。"));
    var stackAcc = skill(b, input.stack ? input.stack.acc : undefined);
    b.weldQ = heatScore(T, w.lo, w.hi, w.fall) * (0.6 + 0.4 * stackAcc);
    if (stackAcc < 0.5) notes.push(N("積み方がずれて、塊の中にすき間が残った。", "堆疊歪斜，鋼塊內留有空隙。"));
    if (!burned && T >= w.lo && rng() < chance(b, (1 - stackAcc) * 0.4)) { addFlaw(b, "fukure"); notes.push(N("積み崩れたすき間がふくれになった。", "堆疊的空隙變成了膨脹。")); }
    if (burned) { addFlaw(b, "burned"); notes.push(N("固相線（約 " + w.burn + "℃）を越え、鋼が燃えた。", "超過固相線（約 " + w.burn + "℃），鋼材燒損。")); }
    else if (T < w.lo) {
      var p = clamp((w.lo - T) / 200 + 0.1, 0, 0.9) * (1.5 - stackAcc);
      if (rng() < chance(b, p)) { addFlaw(b, "fukure"); notes.push(N("沸かし不足で鍛着が甘く、ふくれが出た。", "沸燒不足熔接不牢，出現膨脹。")); }
      else notes.push(N("温度がやや低かったが、なんとか付いた。", "溫度偏低，但總算接上了。"));
    } else if (T > w.hi) notes.push(N("少し沸かし過ぎ。炭素がやや抜けた。", "稍微沸過頭，碳流失了一些。"));
    else notes.push(N("沸き花が出たちょうどよい頃合いで取り出せた。", "在沸花出現的最佳時機取出。"));
    if (hotShortRisk(comp(b), T) && rng() < chance(b, 0.3)) { addFlaw(b, "hotShort"); notes.push(N("赤熱脆性で割れが入った。", "紅熱脆性導致開裂。")); }
    notes.push(N("脱炭 " + round2(C0 - b.kawaC) + "%。", "脫碳 " + round2(C0 - b.kawaC) + "%。"));
    b.kawaKg = round2(b.kawaKg); b.kawaC = round3(Math.max(0.03, b.kawaC));
  }

  function applyFold(state, pIndex, b, input, stage, notes) {
    var rng = stepRng(state, pIndex, stage);
    var n = input.folds;
    var w = heatWindow(b, "fold", { folds: n });
    var T = input.temp, acc = skill(b, hammerAcc(input.hammer)), cold = input.hammer.cold || 0, reheats = input.hammer.reheats || 0;
    var mat = byId(D.KAWAGANE, b.kawaId) || D.KAWAGANE[0];
    var C0 = b.kawaC, kg0 = b.kawaKg;
    var burned = false;
    var heats = n > 0 ? n * HEATS_PER_FOLD : 3; // 不折返也要加熱延展數次
    for (var i = 0; i < heats; i++) burned = heatCycle(b, T, FOLD_BAR_MM, FOLD_HEAT_S, FLUX_PROTECT) || burned;
    for (var r = 0; r < reheats; r++) heatCycle(b, T, FOLD_BAR_MM, FOLD_HEAT_S * 0.6, FLUX_PROTECT);
    var Lmm = Math.sqrt(diffC(T) * FOLD_HEAT_S * HEATS_PER_FOLD) * 1000; // 每折一次的擴散距離
    for (var k = 0; k < n; k++) {
      b.layers *= 2;
      b.impurity *= 0.76 + 0.16 * (1 - acc); // 鍛接時鐵滓被擠出
      var lam = FOLD_BAR_MM / Math.max(1, b.layers);
      b.consistency = clamp(1 - (1 - b.consistency) * Math.exp(-Math.pow(Math.PI * Lmm / lam, 2) * 0.02), 0, 1);
    }
    b.folds += n;
    b.reheats += reheats;
    b.hammerQ.push(round2(acc));
    // 再結晶細化晶粒（打擊確實、溫度不過高時較細）
    b.grain = round1(clamp(6 + acc * 1.2 - (T > 1250 ? (T - 1250) / 120 : 0), 3, 8));
    if (burned) { addFlaw(b, "burned"); notes.push(N("固相線（約 " + w.burn + "℃）を越えて鋼が燃えた。", "超過固相線（約 " + w.burn + "℃），鋼材燒損。")); }
    if (n > 0 && T < w.lo && rng() < chance(b, clamp((w.lo - T) / 150, 0.1, 0.8))) { addFlaw(b, "fukure"); notes.push(N("沸かしが足りず、層の間にふくれが残った。", "沸燒不足，層間留下膨脹。")); }
    if (hotShortRisk(comp(b), T) && rng() < chance(b, 0.4)) { addFlaw(b, "hotShort"); notes.push(N("赤熱脆性で割れが入った（Mn/S が低い）。", "紅熱脆性導致開裂（Mn/S 太低）。")); }
    if (mat.pattern === "wootz" && (T > acm(comp(b)) || n > 0)) {
      if (b.patternIntact) notes.push(N("Acm 点を越えて炭化物が溶け、ウーツの模様が消えた。", "超過 Acm 點，碳化物溶解，烏茲紋消失了。"));
      b.patternIntact = false; addFlaw(b, "patternLost");
    }
    if (cold > 0) {
      if (rng() < chance(b, clamp(cold * 0.14, 0, 0.9))) { addFlaw(b, "kitaeware"); notes.push(N("冷えた鋼を打って鍛え割れが入った。", "敲打冷掉的鋼，產生了鍛裂。")); }
      else notes.push(N("冷えた鋼を " + cold + " 回打ったが、割れずに済んだ。", "敲了 " + cold + " 下冷鋼，所幸沒有裂開。"));
    }
    if (stage === "shitakitae" && b.shinId !== "none") {
      var sn = input.shinFolds || 0;
      for (var j = 0; j < sn * HEATS_PER_FOLD; j++) {
        b.shinC *= 1 - decarbFrac(T, FOLD_BAR_MM, FOLD_HEAT_S, FLUX_PROTECT);
        b.shinKg *= 1 - scaleLoss(T, FLUX_PROTECT);
      }
      for (var q = 0; q < sn; q++) b.shinImp *= 0.75;
      b.shinFolds = sn;
      b.shinC = round3(Math.max(0.03, b.shinC)); b.shinKg = round2(b.shinKg); b.shinImp = Math.round(b.shinImp);
      if (sn === 0 && byId(D.SHINGANE, b.shinId).slag > 20) { b.shinImp += 10; notes.push(N("心鉄を鍛えなかったので鉄滓が残っている。", "心鐵未經鍛鍊，殘留鐵滓。")); }
    }
    if (stage === "uwakitae" && mat.pattern === "jihada") {
      var pat = byId(D.PATTERNS, input.pattern);
      b.patternWanted = pat.id;
      if (rng() < pat.difficulty * (1.2 - acc)) {
        b.pattern = "itame";
        notes.push(N("狙った" + pat.name.ja + "にならず、板目肌に落ち着いた。", "沒能做出想要的" + pat.name.zh + "，成了板目肌。"));
      } else {
        b.pattern = pat.id;
        notes.push(N(pat.name.ja + "が出た。", "做出了" + pat.name.zh + "。"));
      }
    }
    if (stage === "uwakitae") {
      if (mat.form === "bloom" && b.folds > 18) notes.push(N("鍛錬が " + b.folds + " 回。鍛えすぎで鉄が死にかけている。", "鍛鍊達 " + b.folds + " 次，鍛過頭鐵快死了。"));
      if (mat.form === "bloom" && b.folds < 10) notes.push(N("鍛錬が " + b.folds + " 回と少なく、鉄滓が残りやすい。", "鍛鍊只有 " + b.folds + " 次，容易殘留鐵滓。"));
      if (mat.pattern === "damascus") notes.push(N("層の数 " + b.layers.toLocaleString() + "。", "層數 " + b.layers.toLocaleString() + "。"));
    }
    b.kawaC = round3(Math.max(0.03, b.kawaC)); b.kawaKg = round2(b.kawaKg); b.impurity = round1(b.impurity);
    b.consistency = round2(b.consistency);
    notes.push(N("脱炭 " + round2(C0 - b.kawaC) + "%、鋼の減り " + round2(kg0 - b.kawaKg) + "kg、鎚の正確さ " + Math.round(acc * 100) + "%。",
      "脫碳 " + round2(C0 - b.kawaC) + "%、鋼材減少 " + round2(kg0 - b.kawaKg) + "kg、鎚擊精準度 " + Math.round(acc * 100) + "%。"));
  }

  function avgHammer(b) {
    if (!b.hammerQ.length) return 0.5;
    var s = 0;
    b.hammerQ.forEach(function (x) { s += x; });
    return s / b.hammerQ.length;
  }

  function applyConstruct(state, pIndex, b, input, notes) {
    var rng = stepRng(state, pIndex, "tsukurikomi");
    var con = byId(D.CONSTRUCTIONS, input.construction);
    var w = heatWindow(b, "weld");
    b.construction = con.id;
    var wacc = skill(b, input.hammer ? input.hammer.acc : undefined);
    if (input.hammer) b.hammerQ.push(round2(wacc));
    var q = heatScore(input.temp, w.lo, w.hi, w.fall) * (0.6 + 0.4 * wacc);
    b.weldQ = round2((b.weldQ + q) / 2);
    if (input.temp >= w.burn) { addFlaw(b, "burned"); b.kawaC *= 0.92; notes.push(N("沸かし付けで鋼が燃えた。", "沸接時鋼材燒損。")); }
    if (con.needsShingane) {
      if (q < 0.5 && rng() < chance(b, 0.5)) { addFlaw(b, "fukure"); notes.push(N("沸かし付けが甘く、皮鉄と心鉄の間にふくれ。", "沸接不牢，皮鐵與心鐵之間出現膨脹。")); }
      if (rng() < chance(b, con.risk * (1.6 - avgHammer(b)))) { addFlaw(b, "shinganeExposed"); notes.push(N("組み合わせがずれ、心鉄が表に出た。", "組合偏移，心鐵外露。")); }
      b.steelKg = round2(b.kawaKg + b.shinKg);
    } else {
      b.steelKg = round2(b.kawaKg);
      if (b.shinKg > 0) notes.push(N("丸鍛えなので心鉄は使わない。", "丸鍛不使用心鐵。"));
    }
    b.kawaC = round3(b.kawaC);
    notes.push(N(con.name.ja + "で造り込んだ。鋼の総量 " + b.steelKg + "kg。", "以" + con.name.zh + "造込，鋼材總量 " + b.steelKg + "kg。"));
  }

  // 完成刃器（含莖）重量（kg）：斷面積 = 身幅 × 重 × area，莖約 +35%
  function bladeMassKg(length, mihaba, kasane, area) {
    return length * 10 * mihaba * kasane * (area || 0.6) * 7.85e-6 * 1.35;
  }

  function steelNeeded(b, length) {
    var bt = byId(D.BLADE_TYPES, b.type) || D.BLADE_TYPES[2];
    var w = (bt.width[0] + bt.width[1]) / 2, k = (bt.kasane[0] + bt.kasane[1]) / 2;
    return bladeMassKg(length, w, k, 0.6) * 1.5; // 火造・研磨損耗約 1/3
  }

  function applySunobe(state, pIndex, b, input, notes) {
    var rng = stepRng(state, pIndex, "sunobe");
    var acc = skill(b, hammerAcc(input.hammer));
    b.length = input.length;
    b.uniformity = round2(acc);
    b.hammerQ.push(round2(acc));
    var need = steelNeeded(b, input.length);
    b.steelRatio = round2(Math.min(1, b.steelKg / need));
    if (b.steelRatio < 1) {
      addFlaw(b, "shortSteel");
      notes.push(N("鋼が " + round2(need - b.steelKg) + "kg 足りない。重ねが薄くなる。", "鋼材不足 " + round2(need - b.steelKg) + "kg，重會變薄。"));
    }
    if (b.construction !== "maru" && acc < 0.5 && rng() < chance(b, (0.5 - acc) * 0.8)) {
      addFlaw(b, "shinganeExposed");
      notes.push(N("延ばしむらで心鉄が片寄った。", "延展不均，心鐵偏向一側。"));
    }
    if (input.hammer.cold > 2 && rng() < chance(b, 0.3)) { addFlaw(b, "kitaeware"); notes.push(N("冷えたまま延ばして割れが入った。", "冷著延展產生裂紋。")); }
    notes.push(N("刃長 " + input.length + "cm に延ばした（均一さ " + Math.round(acc * 100) + "%）。", "延展至刃長 " + input.length + "cm（均勻度 " + Math.round(acc * 100) + "%）。"));
  }

  function applyHizukuri(state, pIndex, b, input, notes) {
    var rng = stepRng(state, pIndex, "hizukuri");
    var acc = skill(b, input.hammer ? input.hammer.acc : undefined);
    var err = 1 - acc;
    b.shapeAcc = round2(acc);
    b.tsukuri = input.tsukuri; b.kissaki = input.kissaki; b.mune = input.mune || null; b.soriType = input.soriType;
    // 小鎚打不準 → 身幅・重・反り偏離預定（重的誤差與厚度成比例）
    b.mihaba = round1(input.mihaba + gauss(rng) * err * 3);
    b.kasane = round1(Math.max(0.3, input.kasane * (1 + gauss(rng) * err * 0.12)));
    b.forgeSori = round1(input.forgeSori + gauss(rng) * err * Math.max(4, Math.abs(input.forgeSori) * 0.15));
    if (err > 0.25) notes.push(N("鎚がぶれて、狙いより身幅 " + b.mihaba + "mm・重ね " + b.kasane + "mm・反り " + b.forgeSori + "mm になった。", "鎚擊不穩，實際身幅 " + b.mihaba + "mm、重 " + b.kasane + "mm、彎度 " + b.forgeSori + "mm，與預定有落差。"));
    if (b.steelRatio < 1) {
      b.kasane = round1(Math.max(0.3, b.kasane * b.steelRatio));
      notes.push(N("鋼不足のため重ねは " + b.kasane + "mm にしかならなかった。", "因鋼材不足，重只有 " + b.kasane + "mm。"));
    }
    var ratio = b.kasane / b.mihaba;
    if (ratio < 0.15) notes.push(N("身幅に対して重ねが薄い。曲がりやすい。", "相對身幅，重偏薄，容易彎曲。"));
    else if (ratio > 0.32) notes.push(N("重ねが厚く、切り込みが重い。", "重偏厚，切入較鈍。"));
    else notes.push(N("身幅と重ねの釣り合いがよい。", "身幅與重的比例協調。"));
    if (b.forgeSori) notes.push(N("火造りで " + b.forgeSori + "mm の反りを打ち出した。", "火造時打出 " + b.forgeSori + "mm 的彎度。"));
  }

  var NORM_GAIN = [0, 1.2, 1.8, 2.1];

  function applyTsuchioki(b, input, notes) {
    b.hamon = input.hamon; b.edgeClay = input.edgeClay; b.spineClay = input.spineClay; b.ashi = !!input.ashi && input.hamon !== "none";
    b.normCount = input.norm;
    b.clayAcc = input.hamon === "none" ? 1 : round2(skill(b, input.clayAcc));
    if (input.hamon !== "none" && b.clayAcc < 0.6) notes.push(N("土の線が乱れた。刃文が狙いどおりに出ないかもしれない。", "土線畫得歪，刃文可能不會照預定出現。"));
    var mat = byId(D.KAWAGANE, b.kawaId) || D.KAWAGANE[0];
    if (input.norm > 0) {
      b.grain = round1(Math.min(10, b.grain + NORM_GAIN[input.norm]));
      if (mat.pattern === "wootz" && b.patternIntact && comp(b).C > eutectoidC(comp(b))) {
        notes.push(N("焼きならしは Acm 点より下で行い、炭化物の模様を残した。", "正常化在 Acm 點以下進行，保住了碳化物紋路。"));
      }
      notes.push(N("焼きならし " + input.norm + " 回。結晶粒度 No." + b.grain + "。", "正常化 " + input.norm + " 次，晶粒度 No." + b.grain + "。"));
    }
    var h = byId(D.HAMON, input.hamon);
    notes.push(h.id === "none" ? N("土を置かず、全体に焼きを入れる。", "不置土，整體淬火。") : N(h.name.ja + "の土を置いた。", "置好了" + h.name.zh + "的土。"));
  }

  function applyYakiire(state, pIndex, b, input, notes) {
    var rng = stepRng(state, pIndex, "yakiire");
    var w = heatWindow(b, "quench");
    var delay = Math.max(0, input.delay || 0) / 1000 * (isShow(b) ? SHOW_LENIENCY : 1);
    var T = input.temp - AIR_COOL_RATE * delay;
    b.quenchDelay = round1(delay);
    if (delay > 1) notes.push(N("取り出してから水に入れるまで " + round1(delay) + " 秒。その間に約 " + Math.round(AIR_COOL_RATE * delay) + "℃ 冷めた。", "取出到入水花了 " + round1(delay) + " 秒，期間冷卻了約 " + Math.round(AIR_COOL_RATE * delay) + "℃。"));
    // 加熱過頭使晶粒粗大；過共析鋼在 Ac1 稍上淬火時未溶碳化物會釘住晶界
    var G = b.grain;
    if (T > w.hi) G -= (T - w.hi) / 35;
    var qm = quenchModel(b, T, input.media, G);
    if (qm.au.excess > 0.1) G += 0.5;
    G = round1(clamp(G, 2, 11));
    if (G !== b.grain) qm = quenchModel(b, T, input.media, G);
    b.grain = G;
    var hm = byId(D.HAMON, b.hamon) || D.HAMON[0];
    var bt = byId(D.BLADE_TYPES, b.type) || D.BLADE_TYPES[2];
    b.quenchTemp = T; b.media = input.media; b.dark = !!input.dark;
    b.hardEdge = round1(qm.edge.hrc); b.hardSpine = round1(qm.spine.hrc);
    b.edgeM = round2(qm.edge.M); b.spineM = round2(qm.spine.M); b.retainedAus = round2(qm.edge.RA);
    b.ms = Math.round(qm.Ms); b.cdiss = round2(qm.au.Cd); b.excessC = round2(qm.au.excess);
    b.hamonClarity = round2(qm.clarity * (0.55 + 0.45 * (b.clayAcc === undefined ? 1 : b.clayAcc))); b.hamonBoundary = round2(qm.boundary);
    b.soriQuench = round1(qm.soriQ);
    b.sori = round1(b.forgeSori + qm.soriQ);
    // 淬裂：轉變應力 ∝ H^1.6 ×（溶入碳）²× 粗晶 × 低 Ms × 刃文種類 × 既有瑕疵 × P
    var Hedge = qm.edge.H;
    var stress = Math.pow(Hedge, 1.6) * Math.pow(qm.au.Cd / 0.6, 2) * (1 + Math.max(0, 7 - G) * 0.2) *
      (qm.Ms < 250 ? 1 + (250 - qm.Ms) / 120 : 1) * hm.risk * (qm.spine.M > 0.5 && bt.edges === 1 ? 1.5 : 1);
    var flawMul = (hasFlaw(b, "fukure") ? 1.5 : 1) * (hasFlaw(b, "kitaeware") ? 1.8 : 1) * (hasFlaw(b, "burned") ? 1.3 : 1) * (hasFlaw(b, "hotShort") ? 2 : 1);
    var crack = clamp(chance(b, 0.018 * stress * flawMul * (1 + 5 * qm.comp.P)), 0, 0.95);
    b.crackRisk = round2(crack);
    if (qm.au.fa <= 0) notes.push(N("Ac1 点（約 " + Math.round(ac1(qm.comp)) + "℃）に届かず、まったく焼きが入らなかった。", "沒有達到 Ac1 點（約 " + Math.round(ac1(qm.comp)) + "℃），完全沒有淬硬。"));
    else if (qm.au.fa < 0.95) { addFlaw(b, "yakimura"); notes.push(N("Ac3 点に届かず、フェライトが残って焼きむらが出た。", "未達 Ac3 點，殘留肥粒鐵造成淬火不均。")); }
    else if (T > w.hi) notes.push(N("熱しすぎ。結晶粒が粗くなった（No." + G + "）。", "加熱過頭，晶粒粗化（No." + G + "）。"));
    else notes.push(N("ちょうどよい色で水に入れた。「ジュッ」という音とともに焼きが入った。", "在恰好的火色入水，「嗤」的一聲淬硬了。"));
    if (qm.edge.M < 0.5 && qm.au.fa > 0) notes.push(N("冷却が追いつかず、刃にマルテンサイトがほとんどできなかった。", "冷卻速度不夠，刃口幾乎沒有形成麻田散鐵。"));
    if (qm.edge.RA > 0.15) notes.push(N("Ms 点が " + Math.round(qm.Ms) + "℃ と低く、残留オーステナイトが " + Math.round(qm.edge.RA * 100) + "% 残った。", "Ms 點低至 " + Math.round(qm.Ms) + "℃，殘留沃斯田鐵達 " + Math.round(qm.edge.RA * 100) + "%。"));
    if (hm.id !== "none" && qm.spine.M > 0.5) notes.push(N("焼きが深く入り、土の下まで硬くなった。刃文がぼやける。", "淬透太深，土層下也硬化了，刃文模糊。"));
    if (rng() < crack) {
      addFlaw(b, "yakiware");
      notes.push(N("……ピシッ。焼き割れが入った。", "……啪。出現了淬裂。"));
    } else if (rng() < crack * 0.6 * (b.ashi ? 0.35 : 1)) {
      addFlaw(b, "hagire");
      notes.push(N("刃先に細い刃切れが入った。", "刃口出現細小的刃切。"));
    } else if (crack >= 0.15) {
      notes.push(N("危ない条件だったが、割れずに済んだ。", "條件相當危險，但沒有裂開。"));
    }
    notes.push(N("焼き入れで反りが " + b.soriQuench + "mm 動いた（合計 " + b.sori + "mm）。", "淬火使反變化 " + b.soriQuench + "mm（合計 " + b.sori + "mm）。"));
  }

  function applyAitori(state, pIndex, b, input, notes) {
    var rng = stepRng(state, pIndex, "aitori");
    var tt = Math.round(input.temp);
    b.temperTemp = tt; b.temperHours = input.hours;
    var dE = temperDrop(tt, input.hours);
    b.hardEdge = round1(b.hardEdge - dE);
    b.hardSpine = round1(b.hardSpine - dE * clamp(b.spineM, 0, 1));
    if (tt >= 230) b.retainedAus = 0; // 200℃ 以上殘留沃斯田鐵分解
    var col = temperColorAt(tt);
    if (!tt) notes.push(N("焼き戻しをしなかった。硬いが脆い。", "沒有回火，硬但脆。"));
    else notes.push(N(col.name.ja + "（約 " + tt + "℃）で " + input.hours + " 時間焼き戻した（刃の硬さ HRC " + b.hardEdge + "）。", "在" + col.name.zh + "（約 " + tt + "℃）回火 " + input.hours + " 小時（刃硬度 HRC " + b.hardEdge + "）。"));
    if (tt >= 250 && tt <= 400) notes.push(N("低温焼き戻し脆性の温度域だった。", "落在回火麻田散鐵脆性溫區。"));
    var adj = input.soriAdjust || 0;
    if (adj) {
      b.sori = round1(b.sori + adj);
      var p = Math.max(0, Math.abs(adj) - 2) * 0.07 * (b.hardSpine > 45 ? 2 : 1) + (hasFlaw(b, "yakiware") ? 0.1 : 0);
      if (rng() < chance(b, p)) { addFlaw(b, "soriCrack"); notes.push(N("反りを大きく動かして割れが入った。", "大幅調整反時出現裂紋。")); }
      notes.push(N("反りを " + b.sori + "mm に直した。", "把反調整為 " + b.sori + "mm。"));
    }
  }

  // 最長遞增子序列長度：砥石順序正確的程度
  function lisLength(arr) {
    var tails = [];
    arr.forEach(function (x) {
      var lo = 0, hi = tails.length;
      while (lo < hi) { var mid = (lo + hi) >> 1; if (tails[mid] < x) lo = mid + 1; else hi = mid; }
      tails[lo] = x;
    });
    return tails.length;
  }

  function polishScore(order) {
    var seen = {}, nums = [];
    order.forEach(function (id) {
      var s = byId(D.STONES, id);
      if (s && !seen[id]) { seen[id] = true; nums.push(s.order); }
    });
    return lisLength(nums) / D.STONES.length;
  }

  function applyTogi(b, input, notes) {
    b.stoneOrder = input.order.slice();
    b.polishRhythm = round2(skill(b, input.rhythm ? input.rhythm.acc : undefined));
    b.polish = round2(polishScore(input.order) * (0.7 + 0.3 * b.polishRhythm));
    if (b.polishRhythm < 0.6) notes.push(N("砥石の当たりが不揃いで、ひけ傷が残った。", "研磨力道不一，留下了刮痕。"));
    b.edge = input.edge;
    var missing = D.STONES.length - input.order.length;
    if (missing > 0) notes.push(N("砥石を " + missing + " 種飛ばした。", "跳過了 " + missing + " 種砥石。"));
    notes.push(N("研ぎの出来 " + Math.round(b.polish * 100) + "%。", "研磨完成度 " + Math.round(b.polish * 100) + "%。"));
  }

  function applyMei(b, input, notes) {
    b.yasurime = input.yasurime; b.nakagojiri = input.nakagojiri;
    b.mei = String(input.mei || "").trim().slice(0, 20);
    b.meiAcc = round2(skill(b, input.chisel ? input.chisel.acc : undefined));
    if (b.mei && b.meiAcc < 0.6) notes.push(N("鏨が滑って、銘の線が乱れた。", "鏨子打滑，銘文筆畫歪了。"));
    notes.push(b.mei ? N("「" + b.mei + "」と銘を切った。", "刻上了「" + b.mei + "」之銘。") : N("無銘のまま仕上げた。", "以無銘完成。"));
  }

  // 前進到下一道適用的工序；略過的工序記一筆
  function advance(p) {
    p.step++;
    while (p.step < D.STEPS.length && !stepApplies(p.blade, D.STEPS[p.step])) {
      p.log.push({ step: D.STEPS[p.step].id, skipped: true, notes: [N("この材料では行わない。", "此材料不需要這道工序。")] });
      p.step++;
    }
  }

  // 套用目前玩家的工序；回傳 { ok, error, notes }
  function applyStep(state, pIndex, stepId, input) {
    var p = state.players[pIndex];
    if (!p || state.phase !== "forge" || p.step >= D.STEPS.length) return { ok: false, error: "kt_err_step" };
    if (D.STEPS[p.step].id !== stepId) return { ok: false, error: "kt_err_step" };
    var err = validate(state, pIndex, stepId, input);
    if (err) return { ok: false, error: err };
    var b = p.blade, notes = [];
    if (stepId === "material") applyMaterial(b, input, notes);
    else if (stepId === "kowari") applyKowari(state, pIndex, b, input, notes);
    else if (stepId === "tsumi") applyTsumi(state, pIndex, b, input, notes);
    else if (stepId === "shitakitae" || stepId === "uwakitae") applyFold(state, pIndex, b, input, stepId, notes);
    else if (stepId === "tsukurikomi") applyConstruct(state, pIndex, b, input, notes);
    else if (stepId === "sunobe") applySunobe(state, pIndex, b, input, notes);
    else if (stepId === "hizukuri") applyHizukuri(state, pIndex, b, input, notes);
    else if (stepId === "tsuchioki") applyTsuchioki(b, input, notes);
    else if (stepId === "yakiire") applyYakiire(state, pIndex, b, input, notes);
    else if (stepId === "aitori") applyAitori(state, pIndex, b, input, notes);
    else if (stepId === "togi") applyTogi(b, input, notes);
    else if (stepId === "mei") applyMei(b, input, notes);
    p.log.push({ step: stepId, notes: notes });
    advance(p);
    if (currentForger(state) < 0) {
      state.phase = "judge";
      state.players.forEach(function (q, i) { awaken(state, i); });
    }
    return { ok: true, notes: notes };
  }

  // ---------------- 性能 ----------------

  function stats(b) {
    var con = byId(D.CONSTRUCTIONS, b.construction) || D.CONSTRUCTIONS[1];
    var edge = byId(D.EDGE_GEOMETRY, b.edge) || D.EDGE_GEOMETRY[1];
    var tk = byId(D.TSUKURI, b.tsukuri) || D.TSUKURI[0];
    var shin = byId(D.SHINGANE, b.shinId) || D.SHINGANE[0];
    var c = comp(b);
    var HRC = b.hardEdge || 30;
    // 刃鋼的韌性
    var te = 110 - 1.5 * HRC + temperToughness(b.temperTemp || 0) + 3 * ((b.grain || 7) - 7) - 18 * Math.max(0, (b.cdiss || c.C) - 0.6) -
      10 * (b.retainedAus || 0) - 0.35 * b.impurity - 150 * c.P + 3 * c.Ni;
    // 刀背未淬硬（差異淬火）時整體更韌
    te += (1 - clamp(b.spineM, 0, 1)) * 15;
    var coreT = 95 - 120 * b.shinC - 0.25 * b.shinImp - 150 * (shin.comp.P || 0);
    var tough = (1 - con.coreFrac) * te + con.coreFrac * coreT;
    tough *= con.id === "shihozume" ? 1.06 : (con.id === "honsanmai" ? 1.03 : 1);
    tough += tk.sturdy + (b.ashi ? 5 : 0);
    var flawTough = { yakiware: 25, hagire: 15, kitaeware: 8, fukure: 6, burned: 8, soriCrack: 8, shortSteel: 4, hotShort: 10, yakimura: 4 };
    b.flaws.forEach(function (f) { tough -= flawTough[f] || 0; });
    if (b.kasane / (b.mihaba || 30) < 0.15) tough -= 6;
    tough = clamp(Math.round(tough), 5, 100);
    var sharp = (HRC - 45) * 2.6 + b.polish * 20 + edge.cut + tk.cut + (8 - b.kasane) * 3 + Math.min(8, (b.excessC || 0) * 16) - b.impurity * 0.15 + c.W * 3;
    sharp = clamp(Math.round(sharp), 0, 100);
    var mass = round2(bladeMassKg(b.length || 70, b.mihaba || 30, b.kasane || 7, tk.area));
    var integrity = 60 + tough * 0.6 + mass * 20;
    if (hasFlaw(b, "yakiware")) integrity -= 20;
    integrity = Math.round(clamp(integrity, 20, 160));
    return { hardness: round1(HRC), toughness: tough, sharpness: sharp, mass: mass, integrity: integrity, chip: edge.chip };
  }

  // ---------------- 神前審查 ----------------

  function rangeFit(v, lo, hi, per) {
    if (v >= lo && v <= hi) return 0;
    return (v < lo ? lo - v : v - hi) * per;
  }

  function judge(b) {
    var mat = byId(D.KAWAGANE, b.kawaId) || D.KAWAGANE[0];
    var hm = byId(D.HAMON, b.hamon) || D.HAMON[0];
    var bt = byId(D.BLADE_TYPES, b.type) || D.BLADE_TYPES[2];
    var tk = byId(D.TSUKURI, b.tsukuri);
    var ks = byId(D.KISSAKI, b.kissaki);
    var st = byId(D.SORI_TYPES, b.soriType);
    var nihonto = bt.family === "nihonto";
    var show = isShow(b);
    var comments = [];

    // 地鐵・素材
    var jig = 7 * clamp(1 - b.impurity / 30, 0, 1);
    var cLo = bt.ht === "through" ? 0.5 : 0.55, cHi = bt.ht === "through" ? 0.9 : 0.78;
    if (mat.pattern === "wootz") { cLo = 1.2; cHi = 1.8; } // 烏茲鋼本來就是高碳的坩堝鋼
    jig += 4 * clamp(1 - rangeFit(b.kawaC, cLo, cHi, 1) / 0.25, 0, 1);
    if (mat.pattern === "jihada") {
      var pat = byId(D.PATTERNS, b.pattern) || D.PATTERNS[0];
      jig += pat.beauty + b.consistency * 2 + (mat.jiganeBonus || 0);
      if (b.folds > 18) { jig -= 3; comments.push(N("地鉄：鍛えすぎで鉄に力が無い。", "地鐵：鍛過頭，鐵失去活力。")); }
      if (b.folds < 10) jig -= 2;
    } else if (mat.pattern === "none") {
      if (nihonto) { comments.push(N("地鉄：地肌が見えない無地の鋼。", "地鐵：看不到地肌的素面鋼。")); jig += 1; }
      else jig += 4;
    } else if (mat.pattern === "damascus") {
      var lr = Math.log(Math.max(1, b.layers) / 200) / Math.LN10;
      var ds = 5 * Math.exp(-lr * lr / 0.3);
      jig += ds;
      if (ds < 2) comments.push(N("地鉄：層が " + (b.layers > 200 ? "細かすぎて模様が霞んだ" : "少なく模様が粗い") + "。", "地鐵：層數" + (b.layers > 200 ? "太多，紋路模糊" : "太少，紋路粗糙") + "。"));
      if (nihonto && !show) { jig -= 2; comments.push(N("地鉄：日本刀に異国の積層模様。", "地鐵：日本刀配上異國積層紋。")); }
    } else if (mat.pattern === "wootz") {
      if (b.patternIntact) { jig += 6; comments.push(N("地鉄：ウーツの水紋が見事に残った。", "地鐵：烏茲水紋完美保留。")); }
      if (nihonto && !show) jig -= 1;
    } else if (mat.pattern === "meteor") {
      jig += 3.5 + (mat.legend || 0) + b.consistency;
      comments.push(N("地鉄：隕鉄の混じった流星刀。", "地鐵：混有隕鐵的流星刀。"));
    }
    if (nihonto && !mat.authentic) {
      if (show) comments.push(N("地鉄：玉鋼ではないが、表演モードなので趣味として減点なし。", "地鐵：不是玉鋼，但表演模式屬於趣味，不扣分。"));
      else { jig -= 3; comments.push(N("地鉄：玉鋼ではない。神前では本筋から外れる。", "地鐵：不是玉鋼，在神前視為偏離正統。")); }
    }
    if (bt.pamor && (mat.pattern === "damascus" || mat.pattern === "meteor")) { jig += 2; comments.push(N("地鉄：ニッケルの模様（パモール）が浮かぶクリス。", "地鐵：浮現鎳紋（Pamor）的克力士劍。")); }
    if (b.kawaC < 0.45) comments.push(N("地鉄：炭素が抜けすぎている（C " + b.kawaC + "%）。", "地鐵：碳流失太多（C " + b.kawaC + "%）。"));
    if (b.impurity > 15) comments.push(N("地鉄：鉄滓が目立つ。", "地鐵：鐵滓明顯。"));
    ["fukure", "kitaeware", "burned", "hotShort"].forEach(function (f) { if (hasFlaw(b, f)) jig -= 2.5; });
    jig = clamp(jig, 0, 20);

    // 刃文・熱處理
    var ham;
    var hrcFit = clamp(1 - rangeFit(b.hardEdge, bt.hrc[0], bt.hrc[1], 1) / 8, 0, 1);
    if (bt.ht === "diff") {
      if (hm.id === "none") {
        ham = 6 * hrcFit;
        comments.push(N("刃文：土を置かず刃文が無い。", "刃文：沒有置土，沒有刃文。"));
      } else {
        ham = hm.potential * (0.4 + 0.6 * b.hamonClarity) * (0.4 + 0.6 * hrcFit) + (b.ashi ? 0.5 : 0);
        if (b.hamonClarity >= 0.7) comments.push(N("刃文：匂口が冴えている。", "刃文：匂口清澈明亮。"));
        else if (b.spineM > 0.5) comments.push(N("刃文：焼きが深く入りすぎて刃文がぼやけた。", "刃文：淬透過深，刃文模糊。"));
      }
      if (b.edgeM < 0.5) { ham *= 0.4; comments.push(N("刃文：焼きが入っていない。", "刃文：沒有淬硬。")); }
    } else {
      var uni = 1 - clamp(Math.abs(b.hardEdge - b.hardSpine) / 15, 0, 1);
      ham = 14 * hrcFit + 6 * uni;
      comments.push(N("熱処理：刃の硬さ HRC " + b.hardEdge + "（" + bt.name.ja + "の目安 " + bt.hrc[0] + "〜" + bt.hrc[1] + "）。",
        "熱處理：刃硬度 HRC " + b.hardEdge + "（" + bt.name.zh + "的標準 " + bt.hrc[0] + "〜" + bt.hrc[1] + "）。"));
    }
    if (hasFlaw(b, "yakiware")) ham -= 6;
    if (hasFlaw(b, "yakimura")) ham -= 2;
    ham = clamp(ham, 0, 20);

    // 姿
    var sug = 20;
    sug -= b.length < bt.min || b.length > bt.max ? 6 : rangeFit(b.length, bt.ideal[0], bt.ideal[1], 0.4);
    sug -= Math.min(6, rangeFit(b.sori, bt.sori[0], bt.sori[1], 0.5));
    sug -= Math.min(4, rangeFit(b.mihaba, bt.width[0], bt.width[1], 0.6));
    sug -= Math.min(4, rangeFit(b.kasane, bt.kasane[0], bt.kasane[1], 1.2));
    if (tk && bt.tsukuri.indexOf(tk.id) < 0) { sug -= 3; comments.push(N("姿：" + bt.name.ja + "に" + tk.name.ja + "は珍しい。", "姿：" + bt.name.zh + "配" + tk.name.zh + "很少見。")); }
    if (ks && bt.kissaki.indexOf(ks.id) < 0) sug -= 2;
    if (st && bt.soriType.indexOf(st.id) < 0) sug -= 2;
    sug -= (1 - (b.shapeAcc === undefined ? 1 : b.shapeAcc)) * 3;
    if (rangeFit(b.sori, bt.sori[0], bt.sori[1], 1) > 3) comments.push(N("姿：反り " + b.sori + "mm は" + bt.name.ja + "らしくない（目安 " + bt.sori[0] + "〜" + bt.sori[1] + "mm）。",
      "姿：反 " + b.sori + "mm 不像" + bt.name.zh + "（標準 " + bt.sori[0] + "〜" + bt.sori[1] + "mm）。"));
    sug = clamp(sug, 0, 20);

    // 健全
    var snd = 20;
    b.flaws.forEach(function (f) { snd -= D.FLAWS[f] ? D.FLAWS[f].penalty : 0; });
    snd = clamp(snd, 0, 20);
    if (!b.flaws.length) comments.push(N("健全：傷の無い健全な刃。", "健全：毫無瑕疵的健全之刃。"));

    // 研磨與莖
    var fin = b.polish * 14 + (b.edge ? 1 : 0) + (b.yasurime && b.nakagojiri ? 2 : 0) + (b.mei ? 3 * (b.meiAcc === undefined ? 1 : b.meiAcc) : 0);
    if (b.polish < 0.7) comments.push(N("研ぎ：前の砥石の傷が残っている。", "研磨：還殘留前一道砥石的磨痕。"));
    fin = clamp(fin, 0, 20);

    var scores = { jigane: round1(jig), hamon: round1(ham), sugata: round1(sug), soundness: round1(snd), finish: round1(fin) };
    var total = round1(scores.jigane + scores.hamon + scores.sugata + scores.soundness + scores.finish);
    var grade = 0;
    for (var g = 0; g < D.GRADES.length; g++) if (total >= D.GRADES[g].min) { grade = g; break; }
    return { scores: scores, total: total, grade: grade, comments: comments, heatTreat: bt.ht === "through" };
  }

  // ---------------- 開刃試鋒 ----------------

  function startCut(state) {
    state.phase = "cut";
    var hp = {};
    state.players.forEach(function (p) { hp[p.id] = stats(p.blade).integrity; });
    state.cut = { target: 0, turn: 0, hp: hp, results: {} };
    state.players.forEach(function (p) { state.cut.results[p.id] = []; });
  }

  function cutTurn(state) {
    if (!state.cut || state.cut.target >= D.TARGETS.length) return null;
    return { target: D.TARGETS[state.cut.target], player: state.players[state.cut.turn], pIndex: state.cut.turn };
  }

  // hasuji：刃筋（0〜1，UI 的時機小遊戲）；skip：放棄這個目標（不冒險損傷刀）
  function applyCut(state, hasuji, skip) {
    var turn = cutTurn(state);
    if (!turn) return null;
    var p = turn.player, tg = turn.target, b = p.blade, s = stats(b);
    var rng = makeRng(state.seed + "|cut|" + p.id + "|" + tg.id);
    var res = { target: tg.id, skipped: !!skip, cut: false, loss: 0, events: [], points: 0 };
    var hp = state.cut.hp[p.id];
    if (!skip && hp > 0) {
      hasuji = clamp(hasuji, 0, 1);
      var power = s.sharpness * (0.55 + 0.45 * hasuji) + s.mass * 8 + (rng() - 0.5) * 16;
      res.cut = power >= tg.difficulty;
      res.points = res.cut ? tg.points : 0;
      var loss = tg.hard * 14 * (res.cut ? 0.7 : 1.3) * (1.4 - hasuji) * (60 / (s.toughness + 20));
      if (s.hardness >= 61 && tg.hard >= 0.3 && rng() < 0.3 + (s.chip - 1) * 0.5 + tg.hard * 0.3) { res.events.push("chip"); loss += 6 * s.chip; }
      if (s.hardness < 52 && tg.hard >= 0.3 && rng() < 0.5) { res.events.push("bend"); loss += 5; }
      if (hasFlaw(b, "yakiware") && tg.hard >= 0.9 && rng() < 0.5) { res.events.push("break"); loss = hp; }
      res.loss = Math.round(Math.min(hp, loss));
      state.cut.hp[p.id] = hp - res.loss;
      if (state.cut.hp[p.id] <= 0 && res.events.indexOf("break") < 0) res.events.push("break");
    } else if (hp <= 0) {
      res.skipped = true; res.broken = true;
    }
    state.cut.results[p.id].push(res);
    state.cut.turn++;
    if (state.cut.turn >= state.players.length) { state.cut.turn = 0; state.cut.target++; }
    return res;
  }

  function cutPoints(state, pid) {
    var s = 0;
    (state.cut && state.cut.results[pid] || []).forEach(function (r) { s += r.points; });
    return s;
  }

  // ---------------- 覺醒招式・刀的快照 ----------------
  // 鍛完（進入審查）時，依刀的性能・材料・形狀判定是否覺醒特殊招式。條件見 D.SPECIALS 的 cond。
  // 符合多項時以種子亂數挑一項；沒有符合但總評達上上作者，也有機會覺醒任一招式。表演模式機率較高。
  // 覺醒條件（D.SPECIALS[].req）的判定
  function meetsReq(b, r, ctx) {
    if (r.any && !r.any.some(function (x) { return meetsReq(b, x, ctx); })) return false;
    var s = ctx.s, j = ctx.j;
    function lo(v, k) { return r[k] === undefined || v >= r[k]; }
    function hi(v, k) { return r[k] === undefined || v <= r[k]; }
    function inList(v, k) { return !r[k] || r[k].indexOf(v) >= 0; }
    if (!lo(s.hardness, "minHrc") || !hi(s.hardness, "maxHrc") || !lo(s.sharpness, "minSharp") || !lo(s.toughness, "minTough")) return false;
    if (!lo(s.mass, "minMass") || !hi(s.mass, "maxMass") || !lo(b.length || 0, "minLen") || !hi(b.length || 0, "maxLen")) return false;
    if (!lo(b.sori || 0, "minSori") || !lo(b.mihaba || 0, "minWidth") || !hi(b.kasane || 0, "maxKasane")) return false;
    if (!lo(j.total, "minTotal") || !lo(b.flaws.length, "minFlaws") || !hi(b.hamonClarity || 0, "maxClarity")) return false;
    if (!inList(b.type, "types") || !inList(b.kawaId, "kawa") || !inList(b.media, "media") || !inList(b.hamon, "hamon")) return false;
    if (!inList(b.soriType, "soriType") || !inList(b.tsukuri, "tsukuri") || !inList(b.kissaki, "kissaki")) return false;
    if (r.wave && !ctx.bt.wave) return false;
    if (r.minScore) for (var k in r.minScore) if (!(j.scores[k] >= r.minScore[k])) return false;
    return true;
  }

  function specialCandidates(b) {
    var ctx = { s: stats(b), j: judge(b), bt: byId(D.BLADE_TYPES, b.type) || {} };
    return D.SPECIALS.filter(function (sp) { return meetsReq(b, sp.req || {}, ctx); }).map(function (sp) { return sp.id; });
  }

  function awaken(state, pIndex) {
    var b = state.players[pIndex].blade;
    if (b.special !== undefined) return b.special;
    var rng = stepRng(state, pIndex, "awaken");
    var cands = specialCandidates(b), show = isShow(b);
    var pick = null;
    if (cands.length && rng() < (show ? 0.9 : 0.65)) pick = cands[Math.floor(rng() * cands.length)];
    else if (judge(b).total >= 78 && rng() < (show ? 0.5 : 0.25)) pick = D.SPECIALS[Math.floor(rng() * D.SPECIALS.length)].id;
    b.special = pick;
    return pick;
  }

  // 舊存檔（進入審查後才加入這個功能）補判定
  function ensureSpecials(state) {
    if (state.phase === "forge") return;
    state.players.forEach(function (p, i) { if (p.blade.special === undefined) awaken(state, i); });
  }

  // 刀鞘與對刀場使用的快照：只留畫圖與戰鬥需要的欄位（可轉成邀請碼）
  var SNAP_FIELDS = ["type", "length", "sori", "mihaba", "kasane", "tsukuri", "kissaki", "soriType", "hamon", "ashi", "yasurime", "mune", "pattern", "kawaId", "mei", "mode"];
  function swordSnapshot(b, opts) {
    opts = opts || {};
    var bt = byId(D.BLADE_TYPES, b.type) || {};
    var j = judge(b), s = stats(b);
    var snap = { v: 1, name: String(opts.name || b.swordName || "").slice(0, 24), smith: String(opts.smith || "").slice(0, 16),
      edges: bt.edges || 1, wave: !!bt.wave, special: b.special || null, crack: hasFlaw(b, "yakiware"),
      grade: j.grade, total: j.total, stats: s, flaws: b.flaws.slice() };
    SNAP_FIELDS.forEach(function (k) { snap[k] = b[k]; });
    return snap;
  }

  function npcSnapshot(n) {
    return { v: 1, name: "", smith: "", npc: n.id, type: "uchigatana", length: 70, sori: 17, mihaba: 31, kasane: 7, tsukuri: "shinogi", kissaki: "chu",
      soriType: "torii", hamon: "suguha", ashi: false, edges: 1, wave: false, special: n.special || null, crack: false, flaws: [], grade: 3, total: 55,
      stats: { hardness: n.hardness, toughness: n.toughness, sharpness: n.sharpness, mass: n.mass, integrity: n.integrity, chip: 1 } };
  }

  // ---------------- 對刀（互擊） ----------------
  // 實際的滑行・碰撞・招式在 katana_arena.js（PriTestKatanaArena）以固定步長模擬；這裡只負責
  // 「誰上場、帶著多少耐久」與比賽結束後的名次。試斬後的損傷會帶進對刀（hp 從試斬剩下的值開始）。
  // extras：[{ id, name, snap }]（對手刀、刀鞘裡的刀）
  function startClash(state, extras) {
    state.phase = "clash";
    ensureSpecials(state);
    var fighters = state.players.map(function (p) {
      var s = stats(p.blade);
      return { id: p.id, name: p.name, human: true, snap: swordSnapshot(p.blade, { smith: p.name }), hp: state.cut ? state.cut.hp[p.id] : s.integrity };
    });
    (extras || []).forEach(function (x) { fighters.push({ id: x.id, name: x.name, human: false, snap: x.snap, hp: x.snap.stats.integrity }); });
    state.clash = { fighters: fighters, winner: null, placing: [], summary: [] };
  }

  // result：PriTestKatanaArena.result()
  function finishClash(state, result) {
    var cl = state.clash;
    cl.winner = result.winner;
    cl.placing = result.placing.slice();
    cl.summary = result.summary;
  }

  // 互擊名次：對刀場算好的名次（勝者在前、之後依退場時間晚者在前）
  function clashPlacing(state) {
    return state.clash && state.clash.placing ? state.clash.placing.slice() : [];
  }

  function isPlayerId(state, id) { return state.players.some(function (p) { return p.id === id; }); }

  var CLASH_BONUS = [15, 8, 4];

  // 總合：審查分 + 試斬分 ×2 + 互擊名次加分（只算玩家之間的名次）
  function finalRanking(state) {
    var placing = clashPlacing(state).filter(function (id) { return isPlayerId(state, id); });
    var rows = state.players.map(function (p) {
      var j = judge(p.blade);
      var cp = cutPoints(state, p.id);
      var place = placing.indexOf(p.id);
      var cb = place >= 0 && place < CLASH_BONUS.length ? CLASH_BONUS[place] : 0;
      return { id: p.id, judge: j.total, cut: cp, clash: cb, total: round1(j.total + cp * 2 + cb) };
    });
    rows.sort(function (a, b) { return b.total - a.total; });
    return rows;
  }

  window.PriTestKatanaCore = {
    MIN_PLAYERS: MIN_PLAYERS,
    MODES: MODES,
    AIR_COOL_RATE: AIR_COOL_RATE,
    temperColorAt: temperColorAt,
    MAX_PLAYERS: MAX_PLAYERS,
    KOWARI_PIECES: KOWARI_PIECES,
    HAMMER_STRIKES: HAMMER_STRIKES,
    clone: clone,
    byId: byId,
    makeRng: makeRng,
    stepIndex: stepIndex,
    stepApplies: stepApplies,
    newGame: newGame,
    currentForger: currentForger,
    kowariPieces: kowariPieces,
    heatWindow: heatWindow,
    steelNeeded: steelNeeded,
    validate: validate,
    applyStep: applyStep,
    polishScore: polishScore,
    stats: stats,
    judge: judge,
    startCut: startCut,
    cutTurn: cutTurn,
    applyCut: applyCut,
    cutPoints: cutPoints,
    startClash: startClash,
    finishClash: finishClash,
    awaken: awaken,
    specialCandidates: specialCandidates,
    ensureSpecials: ensureSpecials,
    swordSnapshot: swordSnapshot,
    bladeMassKg: bladeMassKg,
    npcSnapshot: npcSnapshot,
    clamp: clamp,
    hashStr: hashStr,
    clashPlacing: clashPlacing,
    finalRanking: finalRanking,
    // 冶金（測試與輔助模式用）
    metal: {
      diffC: diffC, solidus: solidus, ac1: ac1, ac3: ac3, acm: acm, eutectoidC: eutectoidC, msTemp: msTemp,
      austenite: austenite, idealDiameter: idealDiameter, hrcMartensite: hrcMartensite, quenchModel: quenchModel,
      temperDrop: temperDrop, decarbFrac: decarbFrac, metallurgy: metallurgy
    }
  };
})();
