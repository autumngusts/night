// 賽狗賽狗（saigo）：真賽狗模式（2026-11-02 使用者指定）——8 隻、起跑後不分跑道，要搶位置。
//
// 2026-11-02 第二版（使用者指定「地圖依照原本許多障礙賽方式，但是會搶道的方式進行」）：
//   出賽表改用關卡賽的隨機地圖（Core.makeCourse：地形、天氣、距離、32 種關卡），模擬在 saigo_core.js 的
//   Core.simulate（關卡規則＋搶道層），畫面用 saigo_3d.js。這裡負責出賽表、喊聲指令與共用的狀態內插。
// 下面的橢圓跑道（第一版）只保留給沒有 course 的舊出賽表播放用（模擬 simulate、畫面 saigo_real3d.js）。
//
// 跑道：兩條直道（LS m）＋兩個半圓彎道（內欄半徑 R m），一圈 LAP m；終點在主直道 FINISH m 處，
//   起點＝終點往回推比賽距離（三種距離的起點都落在直道上）。
// 狗的位置：p＝沿內欄量的前進距離（0〜比賽距離）、x＝離內欄的橫向距離（0〜W）。
//   彎道上跑外側要跑比較遠：沿內欄的前進＝實際移動 × R ÷ (R＋x)。
// 搶道：前方有狗擋住就只能跟著跑，同時找左右的空檔切出去；兩隻狗擠在一起會碰撞，互相推開並掉速度。
// 指令（比賽中）：只有 { k, d, a: "shout" }＝對狗喊「賽狗」，低機率回復少許體力。跑法在出賽前決定，開跑後不能改。
(function () {
  "use strict";

  var D = window.PriTestSaigoData;
  var Core = window.PriTestSaigoCore;
  var SK = window.PriTestSaigoSkills;
  var C = D.C;
  var rng = Core.rng, clamp = Core.clamp, weighted = Core.weighted, between = Core.between, pick = Core.pick;

  var DT = Core.DT, MAX_T = 120, FIELD = 8;
  var PI = 3.141592653589793;
  var LS = 100, R = 30, BEND = PI * R, LAP = 2 * LS + 2 * BEND, FINISH = 75;
  var W = 8.6;              // 跑道寬（m）
  var DOG_W = 0.72, DOG_L = 1.05, LOOK = 2.6;
  var STA_K = 0.029;        // 真賽狗距離短（17〜42 秒），耐力係數比關卡賽大，長距離跑完約剩 1 成
  var SHOUT_MAX = 6, SHOUT_GAP = 40, SHOUT_P = 0.15, SHOUT_HEAL = 0.07;   // 喊「賽狗」：每場 6 次、間隔 2 秒、15% 機率回復 7%
  var DISTS = {
    sprint: { m: 260, w: 30, name: C("短距離 260m", "短距離 260m", "Sprint 260m") },
    middle: { m: 450, w: 45, name: C("標準 450m", "標準 450m", "Standard 450m") },
    long: { m: 640, w: 25, name: C("長距離 640m", "長距離 640m", "Stayers 640m") }
  };
  var WEATHER_W = { sunny: 30, cloudy: 22, rain: 14, hot: 8, windy: 8, fog: 7, snow: 6, typhoon: 2, blizzard: 1, sandstorm: 2 };

  function trapX(i) { return 0.55 + i * 0.95; }
  function sectAt(ts) { return ts < LS ? "straight" : ts < LS + BEND ? "curve" : ts < 2 * LS + BEND ? "straight" : "curve"; }
  function trackPos(card, p) { return (card.start + p) % LAP; }
  function lineOf(e) {
    if (D.LINES[e.line]) return e.line;
    return D.LINE_IDS[Core.hashStr(String(e.dogId || e.name || "")) % 3];
  }

  // ---------------- 出賽表 ----------------
  // 實力分（NPC 補強用）：犬種實力分的算法（速度 55%＋耐力 15%＋力量／敏捷／跳躍 30%）占 6 成，
  //   8 項能力平均占 4 成（障礙賽也看游泳、接物、專注）。訓練每項同加 t 時分數剛好 +t。
  function strength(breed, train, lv) {
    var B = (D.BREED_BY_ID[breed] || D.BREEDS[0]).base, v = {}, sum = 0;
    D.STATS.forEach(function (k) { v[k] = B[k] + ((train && train[k]) || 0) + (lv || 0) * 0.5; sum += v[k]; });
    var rt = v.spd * 0.55 + v.sta * 0.15 + (v.pow + v.agi + v.jmp) / 3 * 0.3;
    return rt * 0.6 + sum / D.STATS.length * 0.4;
  }

  // entries 同關卡賽（可以有同一個玩家的好幾隻）；opts：{ cls, terrain?, weather?, dist?, ground?, obstacles? }（沒指定＝依 seed 隨機）
  function makeCard(seed, entries, opts) {
    opts = opts || {};
    var r = rng((seed ^ 0x9ea1) >>> 0);
    var cls = D.CLASSES.filter(function (c) { return c.id === opts.cls; })[0] || D.CLASSES[1];
    var terrain = D.TERRAINS[opts.terrain] ? opts.terrain : weighted(r, { park: 30, forest: 20, snowmtn: 17, desert: 16, beach: 17 });
    var TR = D.TERRAINS[terrain];
    var weather = D.WEATHERS[opts.weather] ? opts.weather : weighted(r, TR.weathers);
    var dist = D.DISTANCES[opts.dist] ? opts.dist : weighted(r, { sprint: D.DISTANCES.sprint.w, middle: D.DISTANCES.middle.w, long: D.DISTANCES.long.w });
    var wet = weather === "rain" || weather === "typhoon", cold = weather === "snow" || weather === "blizzard";
    var ground = opts.ground || (weather === "typhoon" ? pick(r, ["soft", "heavy", "heavy"]) : wet ? pick(r, ["good", "soft", "heavy"]) : cold ? pick(r, ["good", "soft"]) : weather === "hot" || weather === "sandstorm" ? "firm" : weighted(r, { firm: 70, good: 30 }));
    // 關卡障礙開關（2026-11-03 使用者指定）：opts.obstacles === false → 只有直道／彎道的純搶道賽道
    var noObs = opts.obstacles === false;
    var course = noObs ? Core.makeFlatCourse(r, dist) : Core.makeCourse(r, terrain, dist);
    var dogs = [];
    (entries || []).slice(0, FIELD).forEach(function (e) {
      var m = clamp(e.mood === undefined ? 2 : e.mood | 0, 0, 4), f = e.fatigue || 0;
      if (f > 85) m -= 2; else if (f > 60) m -= 1;
      var x = r();
      if (x < 0.15) m -= 1; else if (x > 0.85) m += 1;
      dogs.push({
        breed: e.breed, name: String(e.name || "").slice(0, 16), train: e.train || {}, lv: e.lv || 0, best: e.best || "", style: e.style || "",
        skills: SK.sanitize(e.skills), line: lineOf(e),
        mood: clamp(m, 0, 4), cpu: false, owner: e.owner || "", ownerName: e.ownerName || "", dogId: e.dogId || ""
      });
      if (e.rival) dogs[dogs.length - 1].rival = String(e.rival).slice(0, 16);   // 宿敵的王牌狗（saigo_league.js）
      if (e.npc) dogs[dogs.length - 1].npc = 1;
      if (e.career) dogs[dogs.length - 1].career = 1;   // 生涯畢業的狗（關卡賽的 CPU 依它補強）   // 冠軍大會晉級的 NPC（只是顯示用）
      if (e.ownerPid) dogs[dogs.length - 1].ownerPid = String(e.ownerPid).slice(0, 20);   // 冠軍大會：重新連線後用 pid 找回飼主
    });
    // NPC：依賽事等級配對（同關卡賽），名字與所屬犬舍各自抽
    var used = {};
    dogs.forEach(function (d) { used[d.name] = 1; });
    var lang = window.I18N && window.I18N.getLang() === "ja" ? "ja" : "zh";
    var names = D.NAMES[lang], kennels = D.NPC_KENNELS[lang];
    var anchor = between(r, cls.band[0], cls.band[1]), bw = {};
    D.BREEDS.forEach(function (b) { var z = (D.breedRating(b) - anchor) / Core.CPU_BW; bw[b.id] = 1 / (1 + z * z * z * z); });
    // 2026-11-04 使用者指定「玩家人數不足時補上的 NPC 強度再加強，原則貼近玩家中第一名的數值」：
    //   有玩家的狗時，算出玩家裡實力分最高的那隻（top），NPC 依原本的配對產生後，實力分低於 top 的 96〜103% 就把訓練補到那裡
    //   （每項同加、再加 ±4 的個體差，保留犬種原本的長短處）；等級也貼近 top。用另一條亂數，原本的抽選順序不變。
    var top = null;
    dogs.forEach(function (d) { var s = strength(d.breed, d.train, d.lv); if (!top || s > top.s) top = { s: s, lv: d.lv || 0 }; });
    var br = rng((seed ^ 0xb0057) >>> 0);
    while (dogs.length < FIELD) {
      var b = D.BREED_BY_ID[weighted(r, bw)], train = {};
      var adj = clamp(Math.round((anchor - D.breedRating(b)) * Core.CPU_ADJ), -12, 12);
      D.STATS.forEach(function (k) { train[k] = Math.round(between(r, cls.cpu[0], cls.cpu[1])) + adj; });
      var nm, guard = 0;
      do { nm = pick(r, names); guard++; } while (used[nm] && guard < 80);
      used[nm] = 1;
      var mx = r(), mood = mx < 0.08 ? 0 : mx < 0.28 ? 1 : mx < 0.72 ? 2 : mx < 0.92 ? 3 : 4;
      var lv = Math.round(between(r, 0, cls.cpu[1] / 3));
      if (top) {
        var tgt = top.s * between(br, 0.96, 1.03), lv2 = clamp(top.lv + Math.round(between(br, -2, 2)), 0, 20);
        if (strength(b.id, train, lv) < tgt) {
          // strength 對「每項同加 t」是線性的（係數 1）：t＝目標 − 犬種基礎分 − 等級 × 0.5
          var tAdd = tgt - strength(b.id, null, lv2);
          D.STATS.forEach(function (k) { train[k] = Math.round(clamp(tAdd + between(br, -4, 4), -15, 60)); });
          lv = lv2;
          if (mood < 2) mood = 2;   // 補強的 NPC 至少普通調子，免得一開始就輸在心情
        }
      }
      dogs.push({ breed: b.id, name: nm, train: train, lv: lv, mood: mood, cpu: true, owner: "", ownerName: pick(r, kennels), dogId: "", line: pick(r, D.LINE_IDS), skills: [] });
    }
    for (var i = dogs.length - 1; i > 0; i--) { var j = Math.floor(r() * (i + 1)); var tmp = dogs[i]; dogs[i] = dogs[j]; dogs[j] = tmp; }
    var sr = rng((seed ^ 0x57e1e) >>> 0), kr = rng((seed ^ 0x5c111) >>> 0);
    dogs.forEach(function (d, k) {
      d.gate = k;
      var bs = (D.BREED_BY_ID[d.breed] || D.BREEDS[0]).style;
      if (D.STYLE_IDS.indexOf(d.best) < 0) d.best = d.cpu ? D.rollBestStyle(bs, sr) : bs;
      if (D.STYLE_IDS.indexOf(d.style) < 0) d.style = d.best;
      if (d.cpu) d.skills = SK.npcSkills(cls.id, kr);
      d.eff = Core.effStats(d, weather, ground, terrain);
    });
    var card = { v: 2, mode: "real", seed: seed >>> 0, cls: cls.id, terrain: terrain, dist: dist, weather: weather, ground: ground, course: course, length: course.length, dogs: dogs };
    if (noObs) card.noObs = true;
    return card;
  }

  // ---------------- 指令 ----------------
  function cmdIndex(cmds, n) {
    var list = (cmds || []).filter(function (c) {
      if (!c || (c.d | 0) !== c.d || c.d < 0 || c.d >= n || (c.k | 0) !== c.k || c.k < 0) return false;
      return c.a === "shout";
    }).slice().sort(function (a, b) { return a.k - b.k || a.d - b.d; });
    var at = {};
    list.forEach(function (c) { (at[c.k] || (at[c.k] = [])).push(c); });
    return at;
  }
  // 喊聲的成功與否：用 seed＋步數＋枠算出來（不動到比賽本身的亂數，沒成功＝比賽完全不變）
  function shoutHits(card, k, d) {
    return rng((card.seed ^ Math.imul(k + 1, 0x9e3779b1) ^ Math.imul(d + 1, 0x85ebca6b)) >>> 0)() < SHOUT_P;
  }

  // ---------------- 模擬 ----------------
  var MODE = Core.MODE;
  function simulate(card, record, seedOverride, cmds) {
    var L = card.length, n = card.dogs.length;
    var g0 = D.GROUNDS[card.ground] || D.GROUNDS.firm, wx = card.weather;
    var gust = wx === "typhoon" ? 0.1 : wx === "windy" || wx === "blizzard" || wx === "sandstorm" ? 0.07 : 0.05;
    var hot = (D.WEATHERS[wx] || {}).temp > 0;
    var base = seedOverride === undefined ? (card.seed ^ 0x9e3779b1) : seedOverride;
    var dogs = card.dogs.map(function (d, i) {
      var e = d.eff, b = D.BREED_BY_ID[d.breed] || D.BREEDS[0], r = rng((base + Math.imul(i + 1, 0x632be5ab)) >>> 0);
      var vbase = (12.5 + e.spd * 0.045) * g0.drag;
      var slow = r() < clamp(0.12 - e.agi * 0.0008, 0.02, 0.12);
      return {
        i: i, e: e, size: b.size, r: r, style: d.style, shoutN: 0, lastShout: -1e9,
        pace: Core.fieldPace(card, d.style), vmax: vbase * D.APT[D.aptitude(d.best || d.style, d.style)].spd,
        acc: 2.6 + e.pow * 0.03 + (5 - b.size) * 0.4,
        react: 0.08 + (100 - Math.min(e.foc, 100)) * 0.0022 + r() * 0.12 + (slow ? 0.35 : 0), slow: slow,
        lineX: (D.LINES[d.line] || D.LINES.mid).x, lineB: (D.LINES[d.line] || D.LINES.mid).bend,
        sk: SK.runtime(d.skills, rng((base ^ 0x5c111 ^ Math.imul(i + 7, 0x2c1b3c6d)) >>> 0), e.foc), boost: null,
        day: 0, p: 0, x: trapX(i), v: 0, sta: 1, jit: 1, jitT: 0, vt: 0, xt: trapX(i), blocked: false, blockEv: -9,
        mode: MODE.wait, done: false, time: null
      };
    });
    var frames = record ? [] : null, events = record ? [] : null;
    var t = 0, step = 0, leader = -1, cmdAt = cmdIndex(cmds, n), applied = [], ranks = [], bumpAt = {};
    function ev(k, d, x) { if (events) events.push({ t: Math.round(t * 100) / 100, k: k, d: d, x: x === undefined ? null : x }); }
    if (events) ev("start", -1);
    function rankAll() {
      for (var a = 0; a < n; a++) {
        var rk = 1, A = dogs[a];
        for (var b = 0; b < n; b++) {
          if (b === a) continue;
          var B = dogs[b];
          if (B.done && (!A.done || B.time < A.time || (B.time === A.time && b < a))) rk++;
          else if (!B.done && !A.done && (B.p > A.p || (B.p === A.p && b < a))) rk++;
        }
        ranks[a] = rk;
      }
    }
    // 位置 cand 附近（前後 1.6 m）有沒有別的狗
    function sideFree(o, cand) {
      if (cand < 0.3 || cand > W - 0.3) return false;
      for (var q = 0; q < n; q++) {
        var z = dogs[q];
        if (z === o || z.done) continue;
        var dp = z.p - o.p;
        if (dp > -1.6 && dp < 1.6 && (z.x - cand < 0.8 && cand - z.x < 0.8)) return false;
      }
      return true;
    }

    while (t < MAX_T) {
      var alive = 0, di, o;
      rankAll();
      // 指令
      var cl = cmdAt[step];
      if (cl) for (var ci = 0; ci < cl.length; ci++) {
        var cm = cl[ci];
        o = dogs[cm.d];
        if (o.done) continue;
        if (o.shoutN >= SHOUT_MAX || step - o.lastShout < SHOUT_GAP || t < o.react) continue;
        o.shoutN++; o.lastShout = step;
        var hit = shoutHits(card, step, cm.d);
        if (hit) o.sta = Math.min(1, o.sta + SHOUT_HEAL);
        applied.push({ k: step, d: cm.d, a: "shout", ok: hit ? 1 : 0 });
        ev(hit ? "shoutHeal" : "shout", cm.d);
      }
      // A：每隻狗決定目標速度與目標橫向位置（用這一步開始時的狀態）
      for (di = 0; di < n; di++) {
        o = dogs[di];
        if (o.done) continue;
        alive++;
        var e = o.e, r = o.r;
        o.jitT -= DT;
        if (!o.day) o.day = 1 - Core.DAY / 2 + r() * Core.DAY;
        if (o.jitT <= 0) { o.jitT = 1; o.jit = 1 - gust + r() * gust * 2; }
        if (t < o.react) { o.vt = 0; o.xt = o.x; o.mode = MODE.wait; continue; }
        if (o.mode === MODE.wait) { o.mode = MODE.run; ev(o.slow ? "slowStart" : o.react < 0.16 ? "goodBreak" : "go", di); }
        var prog = o.p / L, ts = trackPos(card, o.p), sect = sectAt(ts);
        var pace = prog < o.pace.at ? o.pace.early : o.pace.late;
        if (prog > 0.85 && o.sta > 0.3) pace += 0.03;
        var bo = o.sk.length ? SK.tick(o.sk, { prog: prog, sect: sect, style: o.style, weather: wx, ground: card.ground, sta: o.sta, rank: ranks[di], n: n }, t) : null;
        o.boost = bo;
        if (bo && bo.heal) o.sta = Math.min(1, o.sta + bo.heal);
        if (bo && bo.fired) for (var fi = 0; fi < bo.fired.length; fi++) ev("skill", di, bo.fired[fi]);
        var vt = o.vmax * pace * o.jit * o.day * (bo ? 1 + bo.spd : 1);
        if (o.sta < 0.25) vt *= 0.72 + o.sta * 1.1;
        var xt = o.lineX;
        if (sect === "curve") {
          // 彎道：離心力限速；太快會被甩向外側
          var grip = (0.56 + e.agi * 0.004) * g0.grip * (1.04 - o.size * 0.02);
          // 跑外側的狗習慣大弧度過彎、不太減速（抵銷多跑的距離）
          var vc = Math.sqrt((R + o.x) * 9.8 * grip) * (1 + o.lineB);
          if (o.v > vc * 0.9) xt = o.x + (o.v - vc * 0.9) * 1.5;
          vt = Math.min(vt * (1 + o.lineB), vc);
        }
        // 前面有沒有狗：擋住（貼得很近）或想超車（比前面快）
        var ahead = -1, gap = 99;
        for (var q = 0; q < n; q++) {
          var z = dogs[q];
          if (q === di || z.done) continue;
          var dp = z.p - o.p, dx = z.x - o.x;
          if (dp > 0 && dp < 5 && dx < DOG_W + 0.12 && dx > -DOG_W - 0.12 && dp < gap) { gap = dp; ahead = q; }
        }
        o.blocked = false;
        if (ahead >= 0) {
          var A = dogs[ahead];
          if (gap < LOOK || vt > A.v + 0.3) {
            // 找空檔：往自己偏好的那一側優先
            var inSide = o.x - 0.95, outSide = o.x + 0.95;
            var prefIn = o.lineX < o.x, c1 = prefIn ? inSide : outSide, c2 = prefIn ? outSide : inSide;
            if (sideFree(o, c1)) xt = c1;
            else if (sideFree(o, c2)) xt = c2;
            else if (gap < LOOK) {
              o.blocked = true;
              vt = Math.min(vt, A.v + (gap - 1.2) * 2.5);
              if (t - o.blockEv > 3) { o.blockEv = t; ev("boxed", di, ahead); }
            }
          }
          if (gap < 1.15) vt = Math.min(vt, A.v - 0.3);
        }
        o.vt = Math.max(0, vt); o.xt = clamp(xt, 0.3, W - 0.3);
      }
      // B：移動
      for (di = 0; di < n; di++) {
        o = dogs[di];
        if (o.done || t < o.react) continue;
        var bo2 = o.boost;
        if (o.v < o.vt) o.v = Math.min(o.vt, o.v + o.acc * (bo2 ? 1 + bo2.acc : 1) * DT);
        else o.v = Math.max(o.vt, o.v - 9 * DT);
        var latMax = (0.9 + o.e.agi * 0.006) * DT, mx2 = clamp(o.xt - o.x, -latMax, latMax);
        o.x = clamp(o.x + mx2, 0.3, W - 0.3);
        var ts2 = trackPos(card, o.p), fac = sectAt(ts2) === "curve" ? R / (R + o.x) : 1;
        var ratio = o.v / o.vmax;
        o.sta -= ratio * ratio * ratio * ratio * STA_K * g0.stam * (hot ? 1.15 : 1) * DT / (0.5 + o.e.sta * 0.01);
        o.sta = clamp(o.sta, 0, 1);
        var prev = o.p;
        o.p += o.v * DT * fac;
        if (o.p >= L) {
          o.done = true;
          var spd = o.v * fac;
          o.time = Math.round((t + (spd > 0 ? (L - prev) / spd : DT)) * 1000) / 1000;
          o.p = L; o.mode = MODE.fin;
          ev("finish", di, o.time);
        }
      }
      // C：碰撞（搶道）——互相推開、都掉速度，體型大的掉得少
      for (var a = 0; a < n; a++) {
        var P = dogs[a];
        if (P.done || t < P.react) continue;
        for (var b = a + 1; b < n; b++) {
          var Q = dogs[b];
          if (Q.done || t < Q.react) continue;
          var ddp = P.p - Q.p, ddx = P.x - Q.x;
          if (ddp > -DOG_L && ddp < DOG_L && ddx > -DOG_W && ddx < DOG_W) {
            var sg = ddx > 0 || (ddx === 0 && a > b) ? 1 : -1, push = (DOG_W - (ddx < 0 ? -ddx : ddx)) / 2 + 0.02;
            P.x = clamp(P.x + sg * push, 0.3, W - 0.3); Q.x = clamp(Q.x - sg * push, 0.3, W - 0.3);
            var key = a * 16 + b;
            if (!(bumpAt[key] > t - 1.2)) {
              bumpAt[key] = t;
              P.v *= 1 - clamp(0.035 + 0.01 * (Q.size - P.size), 0.01, 0.06);
              Q.v *= 1 - clamp(0.035 + 0.01 * (P.size - Q.size), 0.01, 0.06);
              P.sta = Math.max(0, P.sta - 0.01); Q.sta = Math.max(0, Q.sta - 0.01);
              ev("bump", a, b);
            }
          }
        }
      }
      t += DT; step++;
      if (frames) {
        var f = new Float32Array(n * 4);
        for (var k2 = 0; k2 < n; k2++) { var Z = dogs[k2]; f[k2 * 4] = Z.p; f[k2 * 4 + 1] = Z.x; f[k2 * 4 + 2] = Z.v; f[k2 * 4 + 3] = Z.mode + Z.sta * 0.99; }
        frames.push(f);
      }
      if (events && step % 10 === 0) {
        var best = -1, bs = -1;
        dogs.forEach(function (o2, k3) { if (!o2.done && o2.p > bs) { bs = o2.p; best = k3; } });
        if (best >= 0 && best !== leader && t > 1.5) { leader = best; ev("lead", best); }
        else if (leader < 0) leader = best;
      }
      if (!alive) break;
    }
    var order = dogs.slice().sort(function (a2, b2) {
      if (a2.time !== null && b2.time !== null) return a2.time - b2.time || a2.i - b2.i;
      if (a2.time !== null) return -1;
      if (b2.time !== null) return 1;
      return b2.p - a2.p || a2.i - b2.i;
    }).map(function (o3) { return o3.i; });
    return { real: true, order: order, times: dogs.map(function (o4) { return o4.time; }), frames: frames, events: events, dt: DT, cmds: applied, duration: Math.min(t, MAX_T) };
  }

  // 第 t 秒的狀態（內插）。回傳 [{ s, x, v, mode, sta }]（s＝沿內欄的前進距離，和關卡賽同名方便共用畫面程式）
  function stateAt(result, t) {
    var fr = result.frames, nf = fr.length;
    if (!nf) return [];
    var p = clamp(t / result.dt - 1, 0, nf - 1), i = Math.floor(p), f = p - i;
    var a = fr[i], b = fr[Math.min(nf - 1, i + 1)], out = [];
    for (var k = 0; k < a.length / 4; k++) {
      var m = a[k * 4 + 3];
      out.push({ s: a[k * 4] + (b[k * 4] - a[k * 4]) * f, x: a[k * 4 + 1] + (b[k * 4 + 1] - a[k * 4 + 1]) * f, v: a[k * 4 + 2], mode: Math.floor(m), sta: m - Math.floor(m) });
    }
    return out;
  }
  function rankAt(result, t) {
    var st = stateAt(result, t);
    return st.map(function (x, i) { return i; }).sort(function (a, b) {
      var ta = result.times[a], tb = result.times[b];
      var fa = ta !== null && ta <= t, fb = tb !== null && tb <= t;
      if (fa && fb) return ta - tb;
      if (fa) return -1;
      if (fb) return 1;
      return st[b].s - st[a].s || a - b;
    });
  }

  // 畫面用：沿內欄 p、橫向 x → 平面座標（三角函數只用在畫面）
  // 座標：主直道在 y = −(R)，往 +x 方向跑；彎道 1 在右側（圓心 (LS/2, 0)）、彎道 2 在左側（圓心 (−LS/2, 0)）
  function trackXY(ts, x) {
    ts = ((ts % LAP) + LAP) % LAP;
    var rr = R + x;
    if (ts < LS) return { x: -LS / 2 + ts, y: -rr, h: 0 };
    if (ts < LS + BEND) { var a = (ts - LS) / R - PI / 2; return { x: LS / 2 + Math.cos(a) * rr, y: Math.sin(a) * rr, h: a + PI / 2 }; }
    if (ts < 2 * LS + BEND) return { x: LS / 2 - (ts - LS - BEND), y: rr, h: PI };
    var a2 = (ts - 2 * LS - BEND) / R + PI / 2;
    return { x: -LS / 2 + Math.cos(a2) * rr, y: Math.sin(a2) * rr, h: a2 + PI / 2 };
  }
  function posAt(card, p, x) { return trackXY(trackPos(card, p), x); }

  window.PriTestSaigoReal = { strength: strength,
    FIELD: FIELD, LS: LS, R: R, BEND: BEND, LAP: LAP, FINISH: FINISH, W: W, DISTS: DISTS, WEATHER_W: WEATHER_W,
    SHOUT_MAX: SHOUT_MAX, SHOUT_GAP: SHOUT_GAP, SHOUT_P: SHOUT_P, SHOUT_HEAL: SHOUT_HEAL,
    makeCard: makeCard, simulate: simulate, stateAt: stateAt, rankAt: rankAt, trapX: trapX, sectAt: sectAt, trackPos: trackPos,
    trackXY: trackXY, posAt: posAt, shoutHits: shoutHits, cmdIndex: cmdIndex
  };
})();
