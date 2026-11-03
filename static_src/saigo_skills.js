// 賽狗賽狗（saigo）：被動技能——一般／罕見／金三階（2026-11-02 使用者指定，效果與命名參考賽馬娘的技能系統）。
// 資料、技能池抽選、評分，以及比賽中的執行引擎（關卡賽與真賽狗共用）。不碰 DOM。
//
// 規則：
//   - 每個技能有發動條件（when）與效果（eff）；比賽開始時依專注擲一次「這場能不能發動」，
//     之後第一次符合條件時發動，每個技能每場限一次。
//   - 效果：spd＝目標速度 +x 倍（持續 dur 秒）、acc＝加速度 +x 倍（持續 dur 秒）、heal＝立即回復體力。
//   - 引擎只用四則運算，多裝置模擬結果一致。
//   - 同一階的技能「平均效果」相近（條件越嚴格效果越強）；評分 pts 也相近：一般 40〜48、罕見 88〜98、金 170〜185。
(function () {
  "use strict";

  var D = window.PriTestSaigoData;
  var C = D.C;

  var TIERS = {
    n: { name: C("一般", "ノーマル", "Normal"), slots: 2, pool: 8, icon: "○" },
    r: { name: C("罕見", "レア", "Rare"), slots: 2, pool: 8, icon: "◎" },
    g: { name: C("金", "金", "Gold"), slots: 1, pool: 4, icon: "★" }
  };
  var TIER_IDS = ["g", "r", "n"];
  var POOL_SIZE = 20;
  var POOL_TTL_MS = 30 * 60 * 1000;

  // 階段（依進度）：start 起跑 0〜12%、early 前段 12〜35%、mid 中段 35〜66%、late 後段 66〜85%、final 最後直線 85%〜
  var PHASES = ["start", "early", "mid", "late", "final"];
  function phaseOf(prog) { return prog < 0.12 ? "start" : prog < 0.35 ? "early" : prog < 0.66 ? "mid" : prog < 0.85 ? "late" : "final"; }

  // when：phase（陣列）、sect（curve 彎道／straight 直道）、style、pos（lead 領先／front 前段／behind 非領先／back 後段）、
  //       sta（體力低於）、weather（陣列）、ground（陣列）
  function S(id, tier, zh, ja, en, icon, pts, when, eff, dzh, dja) {
    return { id: id, tier: tier, name: C(zh, ja, en), icon: icon, pts: pts, when: when, eff: eff, desc: C(dzh, dja, dzh) };
  }
  var LIST = [
    // ---- 一般（○） ----
    S("n_corner", "n", "彎道巧手○", "コーナー巧者○", "Corner Adept", "↪", 44, { sect: "curve" }, { spd: 0.025, dur: 3 }, "彎道時速度小幅提升。", "コーナーで速度が少し上がる。"),
    S("n_straight", "n", "直線巧手○", "直線巧者○", "Straightaway Adept", "➡", 44, { sect: "straight", phase: ["mid", "late", "final"] }, { spd: 0.025, dur: 3 }, "中段以後的直道速度小幅提升。", "中盤以降の直線で速度が少し上がる。"),
    S("n_breath", "n", "喘口氣", "一息つく", "Breather", "💨", 42, { phase: ["mid", "late"], sta: 0.55 }, { heal: 0.035 }, "中段體力低於 55% 時回復少許體力。", "中盤にスタミナ 55% 未満で少し回復。"),
    S("n_focus", "n", "集中力", "集中力", "Concentration", "🎯", 40, { phase: ["start"] }, { acc: 0.05, dur: 1.5 }, "起跑時加速度提升（出閘快）。", "スタート時の加速力が上がる。"),
    S("n_nige", "n", "逃馬直線○", "逃げ直線○", "Front Runner Straight", "🐇", 46, { style: "nige", sect: "straight" }, { spd: 0.03, dur: 3 }, "逃馬跑法時，直道速度提升。", "逃げのとき直線で速度が上がる。"),
    S("n_senko", "n", "先行彎道○", "先行コーナー○", "Stalker Corner", "🐕", 46, { style: "senko", sect: "curve" }, { spd: 0.03, dur: 3 }, "先行跑法時，彎道速度提升。", "先行のときコーナーで速度が上がる。"),
    S("n_sashi", "n", "差馬直線○", "差し直線○", "Closer Straight", "🐺", 46, { style: "sashi", sect: "straight", phase: ["late", "final"] }, { spd: 0.03, dur: 3 }, "差馬跑法時，後段直道速度提升。", "差しのとき終盤の直線で速度が上がる。"),
    S("n_oikomi", "n", "後追彎道○", "追込コーナー○", "Deep Closer Corner", "🦊", 46, { style: "oikomi", sect: "curve", phase: ["mid", "late"] }, { spd: 0.03, dur: 3 }, "後追跑法時，中後段彎道速度提升。", "追込のとき中盤以降のコーナーで速度が上がる。"),
    S("n_sunny", "n", "晴天○", "晴れの日○", "Sunny Days", "☀", 42, { weather: ["sunny", "hot"], phase: ["mid", "late"] }, { spd: 0.03, dur: 3 }, "晴天或炎熱時，中段速度提升。", "晴れ・猛暑のとき中盤で速度が上がる。"),
    S("n_rain", "n", "雨天○", "雨の日○", "Rainy Days", "☔", 42, { weather: ["rain", "typhoon"], phase: ["mid", "late"] }, { spd: 0.035, dur: 3 }, "下雨或颱風時，中段速度提升。", "雨・台風のとき中盤で速度が上がる。"),
    S("n_heavy", "n", "重場地○", "重バ場○", "Heavy Going", "🟫", 42, { ground: ["soft", "heavy"], phase: ["early", "mid"] }, { spd: 0.035, dur: 3 }, "稍重／重場地時，前中段速度提升。", "稍重・重バ場のとき序中盤で速度が上がる。"),
    S("n_snow", "n", "雪天○", "雪の日○", "Snowy Days", "❄", 42, { weather: ["snow", "blizzard"], phase: ["mid", "late"] }, { spd: 0.035, dur: 3 }, "下雪或暴風雪時，中段速度提升。", "雪・吹雪のとき中盤で速度が上がる。"),
    S("n_pacekeep", "n", "保持步調", "ペースキープ", "Pace Keeper", "⏱", 42, { phase: ["mid"], pos: "back" }, { heal: 0.035 }, "中段位於後半時回復少許體力。", "中盤で後方にいるとき少し回復。"),
    S("n_pushup", "n", "位置推進", "位置取り押し上げ", "Position Push", "⤴", 44, { phase: ["early"], pos: "back" }, { spd: 0.025, dur: 3 }, "前段位於後半時速度提升，往前推進。", "序盤で後方にいるとき速度が上がる。"),
    S("n_spurt", "n", "衝刺準備", "抜け出し準備", "Ready to Break", "🏃", 44, { phase: ["final"], pos: "front" }, { acc: 0.5, dur: 3 }, "最後直線位於前段時加速度提升。", "最終直線で前方にいるとき加速力が上がる。"),
    S("n_lastleg", "n", "末腳", "末脚", "Late Kick", "🦵", 44, { phase: ["final"] }, { spd: 0.02, dur: 3 }, "最後直線速度小幅提升。", "最終直線で速度が少し上がる。"),
    // ---- 罕見（◎） ----
    S("r_corner", "r", "彎道巧手◎", "コーナー巧者◎", "Corner Expert", "↪", 92, { sect: "curve", phase: ["mid", "late"] }, { spd: 0.045, dur: 3.5 }, "中後段的彎道速度提升。", "中盤以降のコーナーで速度が上がる。"),
    S("r_straight", "r", "直線巧手◎", "直線巧者◎", "Straightaway Expert", "➡", 92, { sect: "straight", phase: ["late", "final"] }, { spd: 0.045, dur: 3.5 }, "後段直道速度提升。", "終盤の直線で速度が上がる。"),
    S("r_breath", "r", "深呼吸", "深呼吸", "Deep Breath", "🌬", 90, { phase: ["mid", "late"], sta: 0.5 }, { heal: 0.06 }, "體力低於 50% 時回復體力。", "スタミナ 50% 未満で回復。"),
    S("r_start", "r", "好出閘", "好スタート", "Great Break", "🚪", 88, { phase: ["start"] }, { acc: 0.1, dur: 2 }, "起跑時大幅加速。", "スタートで大きく加速する。"),
    S("r_nige", "r", "逃馬彎道◎", "逃げコーナー◎", "Front Runner Corner", "🐇", 96, { style: "nige", sect: "curve" }, { spd: 0.05, dur: 3.5 }, "逃馬跑法時，彎道速度提升。", "逃げのときコーナーで速度が上がる。"),
    S("r_senko", "r", "先行直線◎", "先行直線◎", "Stalker Straight", "🐕", 96, { style: "senko", sect: "straight", phase: ["mid", "late", "final"] }, { spd: 0.05, dur: 3.5 }, "先行跑法時，中段以後的直道速度提升。", "先行のとき中盤以降の直線で速度が上がる。"),
    S("r_sashi", "r", "差馬彎道◎", "差しコーナー◎", "Closer Corner", "🐺", 96, { style: "sashi", sect: "curve", phase: ["mid", "late"] }, { spd: 0.05, dur: 3.5 }, "差馬跑法時，中後段彎道速度提升。", "差しのとき中盤以降のコーナーで速度が上がる。"),
    S("r_oikomi", "r", "後追直線◎", "追込直線◎", "Deep Closer Straight", "🦊", 96, { style: "oikomi", sect: "straight", phase: ["late", "final"] }, { spd: 0.055, dur: 3.5 }, "後追跑法時，後段直道速度提升。", "追込のとき終盤の直線で速度が上がる。"),
    S("r_slip", "r", "尾流", "スリップストリーム", "Slipstream", "🌀", 90, { phase: ["mid", "late"], pos: "behind" }, { spd: 0.04, dur: 3 }, "中段沒有領先時，跟在後面借力加速。", "中盤に先頭でないとき、前を風よけに加速。"),
    S("r_overtake", "r", "超越", "追い抜き", "Overtake", "⏩", 94, { phase: ["late"], pos: "behind" }, { spd: 0.045, dur: 3.5 }, "後段沒有領先時速度提升。", "終盤に先頭でないとき速度が上がる。"),
    S("r_guts", "r", "毅力", "根性", "Grit", "💪", 92, { sta: 0.25 }, { heal: 0.06, spd: 0.015, dur: 3 }, "體力低於 25% 時回復體力並稍微加速。", "スタミナ 25% 未満で回復し少し加速。"),
    S("r_rail", "r", "內欄高手", "内ラチ巧者", "Rail Hugger", "📏", 90, { sect: "curve", phase: ["early", "mid"] }, { spd: 0.04, dur: 3.5 }, "前中段的彎道速度提升。", "序中盤のコーナーで速度が上がる。"),
    S("r_heat", "r", "炎熱◎", "猛暑◎", "Heat Master", "🔥", 88, { weather: ["hot", "sandstorm", "sunny"], phase: ["mid", "late"] }, { heal: 0.05, spd: 0.02, dur: 3 }, "晴天／炎熱／沙塵暴時，中段回復體力並加速。", "晴れ・猛暑・砂嵐のとき中盤で回復し加速。"),
    S("r_gofirst", "r", "先發制人", "先制", "Strike First", "🏁", 94, { phase: ["early"], pos: "front" }, { spd: 0.045, dur: 3.5 }, "前段位於前段時速度提升，拉開距離。", "序盤に前方にいるとき速度が上がる。"),
    S("r_mud", "r", "泥地◎", "道悪◎", "Mudlark", "🟫", 90, { ground: ["good", "soft", "heavy"], phase: ["mid", "late"] }, { spd: 0.045, dur: 3.5 }, "稍重以上的場地，中後段速度提升。", "稍重以上のバ場で中盤以降に速度が上がる。"),
    // ---- 金（★） ----
    S("g_maestro", "g", "彎道魔術師", "コーナーの魔術師", "Corner Wizard", "🌀", 180, { sect: "curve", phase: ["mid", "late"] }, { heal: 0.06, spd: 0.04, dur: 4 }, "中後段的彎道回復體力並加速。", "中盤以降のコーナーで回復し加速する。"),
    S("g_shadow", "g", "迫近之影", "迫る影", "Looming Shadow", "👤", 182, { phase: ["final"], pos: "behind" }, { spd: 0.07, acc: 0.5, dur: 4 }, "最後直線沒有領先時，大幅加速追上去。", "最終直線で先頭でないとき大きく加速する。"),
    S("g_first", "g", "先手必勝", "先手必勝", "First Strike", "⚡", 176, { phase: ["start", "early"], pos: "front" }, { spd: 0.045, acc: 0.08, dur: 3 }, "起跑後位於前段時大幅加速，搶到好位置。", "序盤に前方にいるとき大きく加速する。"),
    S("g_escape", "g", "逃亡者", "逃亡者", "Fugitive", "🏃", 178, { style: "nige", phase: ["mid", "late"], pos: "lead" }, { spd: 0.065, dur: 4.5 }, "逃馬領先時，中後段大幅加速甩開對手。", "逃げで先頭のとき中盤以降に大きく加速。"),
    S("g_steel", "g", "鋼鐵意志", "鋼の意志", "Will of Steel", "🛡", 174, { phase: ["early", "mid"], pos: "back" }, { acc: 0.8, spd: 0.05, dur: 3.5 }, "前中段位於後半時加速衝出重圍。", "序中盤に後方にいるとき加速して抜け出す。"),
    S("g_allout", "g", "全身全靈", "全身全霊", "All-Out", "🔥", 184, { phase: ["final"] }, { spd: 0.06, acc: 0.6, dur: 4 }, "最後直線用盡全力加速。", "最終直線で全力を出し切る。"),
    S("g_unbroken", "g", "不屈之心", "不屈の心", "Unbroken", "💖", 172, { sta: 0.2 }, { heal: 0.11 }, "體力低於 20% 時大幅回復體力。", "スタミナ 20% 未満で大きく回復。"),
    S("g_gale", "g", "疾風迅雷", "疾風迅雷", "Swift as Lightning", "🌩", 180, { sect: "straight", phase: ["late"] }, { spd: 0.065, dur: 4 }, "後段直道大幅加速。", "終盤の直線で大きく加速する。"),
    S("g_hunter", "g", "獵兔本能", "狩猟本能", "Hunter's Instinct", "🐰", 178, { phase: ["late", "final"], pos: "front" }, { spd: 0.06, dur: 4.5 }, "後段位於前段時，看到誘餌（兔子）大幅加速。", "終盤に前方にいるとき、ルアーを追って大きく加速。"),
    S("g_bond", "g", "人犬一心", "人犬一体", "Two as One", "🤝", 176, { phase: ["mid"] }, { heal: 0.06, spd: 0.035, dur: 4 }, "中段回復體力並加速。", "中盤で回復し加速する。")
  ];
  var BY_ID = {};
  LIST.forEach(function (s) { BY_ID[s.id] = s; });
  function byTier(tier) { return LIST.filter(function (s) { return s.tier === tier; }); }

  // ---------------- 技能池（犬舍） ----------------
  // 一次抽 20 個：金 4、罕見 8、一般 8（同一池裡不重複）；rnd 預設 Math.random
  function rollPool(rnd) {
    rnd = rnd || Math.random;
    var out = [];
    TIER_IDS.forEach(function (tier) {
      var src = byTier(tier).slice(), n = TIERS[tier].pool;
      for (var i = 0; i < n && src.length; i++) out.push(src.splice(Math.floor(rnd() * src.length), 1)[0].id);
    });
    return out;
  }
  // 狗目前學的技能 → 每階已用幾格
  function slotsUsed(ids) {
    var u = { n: 0, r: 0, g: 0 };
    (ids || []).forEach(function (id) { var s = BY_ID[id]; if (s) u[s.tier]++; });
    return u;
  }
  function canLearn(ids, id) {
    var s = BY_ID[id];
    if (!s || (ids || []).indexOf(id) >= 0) return false;
    return slotsUsed(ids)[s.tier] < TIERS[s.tier].slots;
  }
  // 只保留有效、不重複、不超過欄位的技能（網路傳來的出賽資料也用這個清理）
  function sanitize(ids) {
    var out = [];
    (Array.isArray(ids) ? ids : []).forEach(function (id) { if (canLearn(out, id)) out.push(id); });
    return out;
  }

  // ---------------- 評分 ----------------
  // 能力評分＝8 項能力合計 × 2；技能評分＝各技能 pts。等級仿賽馬娘的評價（G〜SS）
  var GRADES = [[1900, "SS"], [1700, "S"], [1550, "A+"], [1400, "A"], [1250, "B+"], [1100, "B"], [950, "C+"], [800, "C"], [650, "D"], [500, "E"], [0, "G"]];
  function statPts(stats) { var t = 0; D.STATS.forEach(function (k) { t += stats[k] || 0; }); return Math.round(t * 2); }
  function skillPts(ids) { var t = 0; sanitize(ids).forEach(function (id) { t += BY_ID[id].pts; }); return t; }
  function rating(stats, ids) {
    var p = statPts(stats) + skillPts(ids), g = "G";
    for (var i = 0; i < GRADES.length; i++) if (p >= GRADES[i][0]) { g = GRADES[i][1]; break; }
    return { pts: p, grade: g, stat: statPts(stats), skill: skillPts(ids) };
  }

  // CPU／NPC 的技能：欄位全部填滿（金 1、罕見 2、一般 2；2026-11-03 使用者指定「NPC 也會填滿技能」）。
  // cls 保留參數（舊版依賽事等級給部分技能）
  function npcSkills(cls, rnd) {
    var out = [];
    TIER_IDS.forEach(function (tier) {
      var src = byTier(tier).slice();
      for (var i = 0; i < TIERS[tier].slots && src.length; i++) out.push(src.splice(Math.floor(rnd() * src.length), 1)[0].id);
    });
    return out;
  }

  // ---------------- 執行引擎 ----------------
  // 發動率（比賽開始時每個技能擲一次）：35%＋專注 × 0.45%（上限 90%）。仿賽馬娘「賢さ」影響發動率
  function activationRate(foc) { var p = 0.35 + foc * 0.0045; return p < 0.35 ? 0.35 : p > 0.9 ? 0.9 : p; }
  function runtime(ids, rnd, foc) {
    var p = activationRate(foc || 0);
    return sanitize(ids).map(function (id) { return { s: BY_ID[id], ok: rnd() < p, on: false, end: 0 }; });
  }
  function match(w, c) {
    if (w.phase && w.phase.indexOf(phaseOf(c.prog)) < 0) return false;
    if (w.sect && w.sect !== c.sect) return false;
    if (w.style && w.style !== c.style) return false;
    if (w.weather && w.weather.indexOf(c.weather) < 0) return false;
    if (w.ground && w.ground.indexOf(c.ground) < 0) return false;
    if (w.sta !== undefined && !(c.sta < w.sta)) return false;
    if (w.pos) {
      var front = c.rank <= Math.ceil(c.n / 3), back = c.rank > c.n / 2;
      if (w.pos === "lead" && c.rank !== 1) return false;
      if (w.pos === "behind" && c.rank === 1) return false;
      if (w.pos === "front" && !front) return false;
      if (w.pos === "back" && !back) return false;
    }
    return true;
  }
  // c：{ prog, sect, style, weather, ground, sta, rank, n }；t＝比賽時間；scale＝持續時間倍率
  // （關卡賽一場比真賽狗長、又常被關卡限速，持續時間放大 SCALE_CLASSIC 倍）。回傳這一步的加成與新發動的技能
  function tick(rt, c, t, scale) {
    var out = { spd: 0, acc: 0, heal: 0, fired: null };
    for (var i = 0; i < rt.length; i++) {
      var x = rt[i], e = x.s.eff;
      if (!x.on && x.ok && match(x.s.when, c)) {
        x.on = true; x.end = t + (e.dur || 0) * (scale || 1);
        out.heal += e.heal || 0;
        (out.fired || (out.fired = [])).push(x.s.id);
      }
      if (x.on && t < x.end) { out.spd += e.spd || 0; out.acc += e.acc || 0; }
    }
    return out;
  }

  var SCALE_CLASSIC = 3;
  window.PriTestSaigoSkills = {
    SCALE_CLASSIC: SCALE_CLASSIC,
    TIERS: TIERS, TIER_IDS: TIER_IDS, LIST: LIST, BY_ID: BY_ID, POOL_SIZE: POOL_SIZE, POOL_TTL_MS: POOL_TTL_MS, PHASES: PHASES,
    byTier: byTier, rollPool: rollPool, slotsUsed: slotsUsed, canLearn: canLearn, sanitize: sanitize,
    rating: rating, statPts: statPts, skillPts: skillPts, npcSkills: npcSkills,
    activationRate: activationRate, runtime: runtime, tick: tick, phaseOf: phaseOf
  };
})();
