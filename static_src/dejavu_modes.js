// DÉJÀ VU（dejavu）：比賽以外的玩法（2026-10-27 第十二批）——錦標賽積分、山道傳說、下注賠率、路線紀錄、每日挑戰。
//   純邏輯與存檔，不碰 DOM（畫面在 dejavu.js）；node 也能載入（tools/dejavu_check/modes_check.js）。
//   在 dejavu_core.js 之後載入。
(function () {
  "use strict";

  var root = typeof window !== "undefined" ? window : globalThis;
  var D = root.PriTestDejavuData, Core = root.PriTestDejavuCore;
  if (!D || !Core) return;
  var C = D.C;

  function hash(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }

  // ---------------- 存檔（localStorage；不能存也照樣能玩） ----------------
  var KEYS = { records: "pritest-dejavu-records", legends: "pritest-dejavu-legends", wallet: "pritest-dejavu-wallet", daily: "pritest-dejavu-daily" };
  function load(k, def) {
    try { var v = JSON.parse(root.localStorage.getItem(KEYS[k]) || "null"); return v && typeof v === "object" ? v : def; } catch (e) { return def; }
  }
  function store(k, v) { try { root.localStorage.setItem(KEYS[k], JSON.stringify(v)); return true; } catch (e) { return false; } }

  // ---------------- 錦標賽 ----------------
  var POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
  var CHAMP_ROUNDS = [3, 5, 8];
  // 依分類抽 n 條不重複的固定山路，每站季節隨機（seed 決定）
  function champPlan(n, cat, seed) {
    var r = Core.rng(seed | 0);
    var pool = D.COURSES.filter(function (co) { return !cat || (co.cat || "touge") === cat; }).map(function (co) { return co.id; });
    var out = [];
    while (out.length < n && pool.length) {
      var id = pool.splice(Math.floor(r() * pool.length), 1)[0];
      out.push({ course: id, season: D.SEASON_IDS[Math.floor(r() * D.SEASON_IDS.length)] });
    }
    return out;
  }
  function champPoints(pos, state) { return state === "fin" ? POINTS[pos - 1] || 0 : 0; }
  // 總排名：積分高的在前；同分比冠軍次數、再比亞軍次數…
  function champStandings(champ) {
    var rows = Object.keys(champ.table).map(function (key) { return { key: key, pts: champ.table[key], pos: [] }; });
    champ.log.forEach(function (round) {
      round.forEach(function (e) { rows.forEach(function (row) { if (row.key === e.key) row.pos.push(e.pos || 99); }); });
    });
    rows.forEach(function (row) { row.pos.sort(function (a, b) { return a - b; }); });
    rows.sort(function (a, b) {
      if (b.pts !== a.pts) return b.pts - a.pts;
      for (var i = 0; i < Math.max(a.pos.length, b.pos.length); i++) {
        var x = a.pos[i] || 99, y = b.pos[i] || 99;
        if (x !== y) return x - y;
      }
      return a.key < b.key ? -1 : 1;
    });
    return rows;
  }

  // ---------------- 山道傳說 ----------------
  // 每條固定山路一位原創的「在地傳說」：外號、愛車、調校都由路線 id 決定（每台裝置都一樣）。
  var TITLES = [
    ["白色幽靈", "白い亡霊", "White Phantom"], ["下坡之鬼", "ダウンヒルの鬼", "Downhill Demon"], ["紅色彗星", "赤い彗星", "Red Comet"],
    ["夜之帝王", "夜の帝王", "Night Emperor"], ["無聲刺客", "サイレントアサシン", "Silent Assassin"], ["髮夾魔術師", "ヘアピンの魔術師", "Hairpin Magician"],
    ["山道之狐", "峠の狐", "Mountain Fox"], ["雷鳴", "雷鳴", "Thunderclap"], ["藍色閃電", "青い稲妻", "Blue Lightning"],
    ["霧中之影", "霧の中の影", "Shadow in the Fog"], ["黑色疾風", "黒い疾風", "Black Gale"], ["最速的送貨員", "最速の配達人", "Fastest Courier"],
    ["不敗的老將", "無敗の古豪", "Unbeaten Veteran"], ["彎道詩人", "コーナーの詩人", "Corner Poet"], ["溝落達人", "溝落としの達人", "Gutter Master"],
    ["冰上舞者", "氷上の踊り子", "Ice Dancer"], ["鋼鐵獵犬", "鋼鉄の猟犬", "Steel Hound"], ["月下狼", "月下の狼", "Moonlight Wolf"],
    ["零點一秒", "コンマ1秒", "The Tenth"], ["山之主", "山の主", "Lord of the Pass"], ["晨霧騎士", "朝霧の騎士", "Dawn Mist Knight"],
    ["流星", "流れ星", "Shooting Star"], ["赤鬼", "赤鬼", "Red Oni"], ["青鬼", "青鬼", "Blue Oni"]
  ];
  // 路線性格 → 傳說的 PI 範圍與偏好（four＝偏好四驅、light＝偏好輕量、bike＝機車手機率）
  var PROF_PI = {
    fast: [700, 840], highland: [650, 780], coastal: [620, 760], city_express: [680, 820], city_avenue: [600, 740],
    hairpin: [520, 680], switchback: [500, 660], technical: [540, 700], narrow: [480, 640], city_grid: [500, 660],
    rally: [560, 720], tunnel: [600, 740], cliff: [580, 740], mixed: [580, 740], city_river: [560, 720]
  };
  var legendCache = {};
  function legend(courseId, pts, piCap) {
    var co = D.course(courseId);
    if (!co) return null;
    pts = D.UPGRADE_PTS_OPTIONS.indexOf(Number(pts)) >= 0 ? Number(pts) : D.UPGRADE_POINTS;
    var ck = courseId + "|" + pts + "|" + (piCap || 0);
    if (legendCache[ck]) return legendCache[ck];
    var h = hash("legend:" + courseId), r = Core.rng(h | 0);
    var title = TITLES[h % TITLES.length];
    var rg = PROF_PI[co.prof] || [560, 720];
    var lo = rg[0], hi = rg[1];
    if (piCap) { hi = Math.min(hi, piCap); lo = Math.min(lo, hi - 60); }
    var bike = r() < 0.15;
    var four = co.prof === "rally";
    // 改裝：依路線把點數分到引擎／操控／煞車
    function specFor(car) {
      var sp = { car: car.id, tire: "soft", aero: co.prof === "fast" || co.prof === "city_express" ? 3 : 1, gear: co.prof === "fast" ? 1 : -1, style: "balanced", up: { eng: 0, wt: 0, brk: 0, hdl: 0 } };
      var order = ["hdl", "eng", "brk", "wt"];
      for (var p = 0; p < pts; p++) { var u = order[p % order.length]; if (sp.up[u] < D.UPGRADE_MAX) sp.up[u]++; }
      return Core.cleanSpec(sp, pts);
    }
    var pool = D.CARS.filter(function (c) { return !!c.bike === bike && c.id !== "custom" && c.cls !== "u"; });
    var cands = pool.map(function (c) { return { c: c, sp: specFor(c) }; }).map(function (x) { x.pi = Core.carStats(x.sp, pts).pi; return x; })
      .filter(function (x) { return x.pi >= lo && x.pi <= hi && (!four || x.c.drive === "4WD" || x.c.bike); });
    if (!cands.length) {
      cands = pool.map(function (c) { var sp = specFor(c); return { c: c, sp: sp, pi: Core.carStats(sp, pts).pi }; })
        .filter(function (x) { return !piCap || x.pi <= piCap; });
      cands.sort(function (a, b) { return b.pi - a.pi; });
      cands = cands.slice(0, 12);
    }
    var pick = cands[Math.floor(r() * cands.length)];
    var nm = co.name || {};
    var out = {
      course: courseId, title: title,
      name: C((nm.zh || courseId) + "的" + title[0], (nm.ja || nm.zh || courseId) + "の" + title[1], "The " + title[2] + " of " + (nm.en || courseId)),
      spec: pick.sp, pi: pick.pi, color: ["#e8e8e8", "#d23c3c", "#2b2b2b", "#2a6fd6", "#f2c230", "#7a3fc4"][h % 6]
    };
    legendCache[ck] = out;
    return out;
  }
  function legendBeaten() { return load("legends", {}); }
  function markLegend(courseId, entry) {
    var all = legendBeaten(), old = all[courseId];
    if (!old || entry.t < old.t) all[courseId] = entry;
    store("legends", all);
    return !old;
  }

  // ---------------- 下注 ----------------
  var BET_START = 1000, BET_RESCUE = 300;
  var BET_AMOUNTS = [50, 100, 250, 500];
  function wallet() {
    var w = load("wallet", null);
    if (!w || typeof w.chips !== "number" || !isFinite(w.chips)) w = { chips: BET_START, won: 0, lost: 0, best: 0 };
    return w;
  }
  function saveWallet(w) { store("wallet", w); }
  // 實力：PI 與車手風格；不是模擬結果，只是莊家的估計（所以冷門真的有機會爆）
  var STYLE_EDGE = { attack: 12, balanced: 6, calm: 0, defend: 2 };
  function strengths(stats) { return stats.map(function (s) { return Math.exp(((s.pi || 500) + (STYLE_EDGE[s.style] || 0)) / 38); }); }
  // Plackett–Luce：冠軍機率與前三名機率（n ≤ 12，直接列舉前三名）
  function odds(stats) {
    var w = strengths(stats), n = w.length, sum = w.reduce(function (a, b) { return a + b; }, 0);
    var pWin = w.map(function (x) { return x / sum; }), pTop = w.map(function () { return 0; });
    for (var a = 0; a < n; a++) {
      var pa = w[a] / sum;
      pTop[a] += pa;
      for (var b = 0; b < n; b++) {
        if (b === a) continue;
        var pb = pa * w[b] / (sum - w[a]);
        pTop[b] += pb;
        if (n < 3) continue;
        for (var c = 0; c < n; c++) {
          if (c === a || c === b) continue;
          pTop[c] += pb * w[c] / (sum - w[a] - w[b]);
        }
      }
    }
    return stats.map(function (s, i) {
      return {
        win: Math.round(clamp(0.9 / pWin[i], 1.1, 60) * 10) / 10,
        top: n <= 3 ? 1 : Math.round(clamp(0.9 / Math.min(0.99, pTop[i]), 1.05, 25) * 10) / 10
      };
    });
  }
  // bet：{ car, kind: "win"|"top", amount, odds }；res：Core.results()
  function settleBet(bet, res) {
    var r = res.filter(function (x) { return x.id === bet.car; })[0];
    var ok = !!r && r.state === "fin" && (bet.kind === "win" ? r.pos === 1 : r.pos <= 3);
    var w = wallet();
    var pay = ok ? Math.round(bet.amount * bet.odds) : 0;
    w.chips += pay;
    if (ok) { w.won++; if (pay - bet.amount > (w.best || 0)) w.best = pay - bet.amount; } else w.lost++;
    var rescued = false;
    if (w.chips < 10) { w.chips = BET_RESCUE; rescued = true; }
    saveWallet(w);
    return { ok: ok, pay: pay, chips: w.chips, rescued: rescued };
  }
  function placeBet(amount) {
    var w = wallet();
    if (amount <= 0 || amount > w.chips) return false;
    w.chips -= amount;
    saveWallet(w);
    return true;
  }

  // ---------------- 路線紀錄 ----------------
  // 只記沒改過的固定山路（key＝路線＋方向）；夜間、天氣變化等條件也一起記下來給玩家參考
  function recordKey(course, dir) {
    if (!course || course.mod || !D.course(course.src)) return null;
    return course.src + "|" + (dir === "up" ? "up" : "down");
  }
  function records() { return load("records", {}); }
  function submitRecord(key, entry) {
    if (!key) return false;
    var all = records(), old = all[key];
    if (old && old.t <= entry.t) return false;
    all[key] = entry;
    store("records", all);
    return old ? { prev: old.t } : { prev: null };
  }

  // ---------------- 每日挑戰 ----------------
  function today(d) {
    d = d || new Date();
    return d.getFullYear() + "-" + (d.getMonth() + 1 < 10 ? "0" : "") + (d.getMonth() + 1) + "-" + (d.getDate() < 10 ? "0" : "") + d.getDate();
  }
  // 同一天所有人拿到同一組：路線、季節、方向、PI 上限、條件、seed
  function daily(dateStr) {
    var h = hash("daily:" + dateStr), r = Core.rng(h | 0);
    var co = D.COURSES[Math.floor(r() * D.COURSES.length)];
    var caps = [400, 500, 600, 600, 700, 700, 800];
    return {
      date: dateStr, course: co.id, season: D.SEASON_IDS[Math.floor(r() * 4)], dir: r() < 0.8 ? "down" : "up",
      piCap: caps[Math.floor(r() * caps.length)], night: r() < 0.3, wx: r() < 0.25, wear: r() < 0.3,
      seed: h % 2147483647
    };
  }
  function dailyBest(dateStr) { var all = load("daily", {}); return all[dateStr] || null; }
  function submitDaily(dateStr, entry) {
    var all = load("daily", {}), old = all[dateStr];
    if (old && old.t <= entry.t) return false;
    all[dateStr] = entry;
    // 只留最近 30 天
    var keys = Object.keys(all).sort();
    while (keys.length > 30) delete all[keys.shift()];
    store("daily", all);
    return true;
  }

  root.PriTestDejavuModes = {
    POINTS: POINTS, CHAMP_ROUNDS: CHAMP_ROUNDS, BET_AMOUNTS: BET_AMOUNTS, BET_START: BET_START, BET_RESCUE: BET_RESCUE,
    champPlan: champPlan, champPoints: champPoints, champStandings: champStandings,
    legend: legend, legendBeaten: legendBeaten, markLegend: markLegend,
    wallet: wallet, odds: odds, placeBet: placeBet, settleBet: settleBet,
    recordKey: recordKey, records: records, submitRecord: submitRecord,
    today: today, daily: daily, dailyBest: dailyBest, submitDaily: submitDaily
  };
})();
