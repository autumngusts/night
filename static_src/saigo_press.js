// 賽狗賽狗（saigo）：賽前情報——看板（パドック）與報紙預測（2026-11-05 使用者指定，參考賽馬的パドック與新聞の予想印）。不碰 DOM。
//
// 看板：依「正式比賽」每隻狗的當天狀態（Core.preRace 的 day，賠率試跑裡每場都不一樣，所以賠率不知道）
//   給 5 段提示（只有一部分是照實的，見 PAD_TRUE）；這場會暴衝的狗有 70% 機率看得出「情緒高漲」（沒有要暴衝的狗也有 8% 誤判）。
//   所以看板是賠率以外的真實情報，但不是百分之百準。
// 報紙：3 位記者各自打印（◎○▲△…），看的東西不同：
//   data 數據派＝依賠率（勝率）＋小雜訊，最常跟人氣一致；
//   track 場地派＝依這場的關卡、距離與天氣對每隻狗的能力打分，不管人氣；
//   ana 穴派＝看板（和畫面上的看板同一份有雜訊的提示）＋大雜訊，◎ 一律不打人氣前 2 名。
// 記者戰績（◎ 的勝率／進前三率）存在本機 localStorage，每台裝置各自累計。
// 所有提示由出賽表 seed 決定（另一條亂數），連線房間的每台裝置看到的一樣。
(function () {
  "use strict";

  var D = window.PriTestSaigoData;
  var Core = window.PriTestSaigoCore;
  var C = D.C;
  var KEY = "pritest-saigo-press";

  var LEVELS = {
    "2": { icon: "✨", text: C("毛色發亮、步伐輕快", "毛ヅヤ抜群、軽快な歩様", "Glossy coat, light steps") },
    "1": { icon: "↗", text: C("精神不錯", "気配良好", "Looking keen") },
    "0": { icon: "→", text: C("平常心", "平常どおり", "As usual") },
    "-1": { icon: "↘", text: C("有點沒精神", "やや元気がない", "A bit flat") },
    "-2": { icon: "💤", text: C("腳步沉重", "歩様が重い", "Heavy steps") }
  };
  var KAKARI_HINT = C("情緒高漲、一直拉牽繩", "イレ込み気味、引っ張っている", "Worked up, pulling the lead");

  var REPORTERS = [
    { id: "data", icon: "📊", name: C("數據派・本田記者", "データ派・本田記者", "Stats desk"), note: C("看賠率與能力，穩紮穩打", "オッズと能力重視の堅実派", "Follows the numbers") },
    { id: "track", icon: "🗺", name: C("場地派・森記者", "コース派・森記者", "Course desk"), note: C("只看這場的關卡、距離與天氣合不合", "コースと距離・天候との相性だけを見る", "Course and weather fit") },
    { id: "ana", icon: "🕵", name: C("穴派・大穴記者", "穴党・大穴記者", "Longshot desk"), note: C("天天跑看板，◎ 絕不給人氣前 2 名", "パドック命、◎は人気上位 2 頭に打たない", "Paddock-watcher, never tips the top 2") }
  ];
  var MARKS = ["◎", "○", "▲", "△", "△"];
  // 看板的準度（2026-11-05 實測調整）：當天狀態對名次影響非常大（實測當天狀態前 20% 的狗，單勝期望回收率約 2.5 倍），
  //   看板太準的話「只押 ✨ 的狗」就穩賺。所以看板只有 PAD_TRUE 的機率照實（依當天狀態的五等分），其餘是隨機的；
  //   這樣 ✨ 的單勝期望回收率約 1.0（略高於一般的 0.8），有用但不能無腦押。真賽狗比較亂，當天狀態影響小，準度可以高一點。
  var PAD_TRUE = { classic: 0.18, real: 0.32 }, ANA_PAD = 0.03, ANA_NOISE = 0.22;

  // 關卡 → 看哪一項能力（場地派）
  var PART_STAT = {
    hurdle: "jmp", hurdlerace: "jmp", ditch: "jmp", wallkick: "jmp", trampoline: "jmp",
    tunnel: "agi", weave: "agi", dogwalk: "agi", tirerun: "agi", ski: "agi", skateboard: "agi", seesaw: "agi", windmill: "agi", looptube: "agi", slide: "agi",
    frisbee: "cat", pool: "swm", surf: "swm",
    mud: "pow", hill: "pow", sled: "pow", climbwall: "pow", stairs: "pow", conveyor: "pow", aframe: "pow", sprinkler: "pow",
    treat: "foc", stay: "foc", catzone: "foc", ballpit: "foc", bridge: "foc", firewheel: "foc"
  };

  function cache(card) {
    if (card._press) return card._press;
    var pre = Core.preRace(card), r = Core.rng((card.seed ^ 0xbadd0c) >>> 0), n = card.dogs.length;
    // 看板
    var pad = pre.map(function (p) {
      var q = Math.min(4, Math.floor((p.day - (1 - Core.DAY / 2)) / Core.DAY * 5)), x = r(), y = r();
      var lv = (x < PAD_TRUE[card.mode === "real" ? "real" : "classic"] ? q : Math.floor(y * 5)) - 2, sc = lv;
      var hot = p.kakari ? r() < 0.7 : r() < 0.08;
      return { lv: lv, kakari: hot, sc: sc };
    });
    // 報紙
    var od = Core.odds(card), pop = Core.popularity(card);
    var parts = card.course ? card.course.parts.filter(function (p) { return PART_STAT[p.type]; }) : [];
    var plen = 0;
    parts.forEach(function (p) { plen += p.len; });
    var distK = card.dist === "long" ? 0.3 : card.dist === "sprint" ? 0.08 : 0.18;
    var scores = { data: [], track: [], ana: [] };
    card.dogs.forEach(function (d, i) {
      var e = d.eff || {};
      scores.data.push(od.p[i] * (1 + (r() - 0.5) * 0.3));
      var fit = 0;
      parts.forEach(function (p) { fit += p.len * (e[PART_STAT[p.type]] || 0); });
      fit = plen ? fit / plen : 60;
      var tol = (D.WEATHERS[card.weather] || {}).temp > 0 ? (D.BREED_BY_ID[d.breed] || {}).heat || 0 : (D.WEATHERS[card.weather] || {}).temp < 0 ? (D.BREED_BY_ID[d.breed] || {}).cold || 0 : 0;
      scores.track.push((e.spd || 0) * (0.55 - distK) + (e.sta || 0) * distK + fit * 0.45 + tol * 3 + (r() - 0.5) * 8);
      scores.ana.push(od.p[i] + pad[i].sc * ANA_PAD - (pad[i].kakari ? 0.08 : 0) + r() * ANA_NOISE);
    });
    var marks = {};
    REPORTERS.forEach(function (rp) {
      var idx = card.dogs.map(function (d, i) { return i; }).sort(function (a, b) { return scores[rp.id][b] - scores[rp.id][a] || a - b; });
      if (rp.id === "ana") {
        // ◎ 給人氣 3 名以後分數最高的那隻
        var hon = idx.filter(function (i) { return pop[i] > 2; })[0];
        idx = [hon].concat(idx.filter(function (i) { return i !== hon; }));
      }
      var m = [], k = n >= 8 ? 5 : 4;
      idx.forEach(function (i, rank) { m[i] = rank < k ? MARKS[rank] : ""; });
      marks[rp.id] = m;
    });
    card._press = { pad: pad, marks: marks };
    return card._press;
  }
  function paddock(card) { return cache(card).pad; }
  function marks(card) { return cache(card).marks; }
  // ◎ 是哪一隻
  function honmei(card, id) { var m = marks(card)[id]; return m ? m.indexOf("◎") : -1; }

  // ---------------- 記者戰績 ----------------
  function load() {
    var s = null;
    try { s = JSON.parse(window.localStorage.getItem(KEY) || "null"); } catch (e) { s = null; }
    if (!s || typeof s !== "object") s = {};
    REPORTERS.forEach(function (rp) { var x = s[rp.id]; if (!x || !isFinite(x.n)) s[rp.id] = { n: 0, win: 0, top3: 0 }; });
    return s;
  }
  function stats() { return load(); }
  // 結算時呼叫一次：◎ 有沒有贏、有沒有進前三
  function record(card, order) {
    var s = load();
    REPORTERS.forEach(function (rp) {
      var h = honmei(card, rp.id), x = s[rp.id];
      if (h < 0) return;
      x.n++;
      if (order[0] === h) x.win++;
      if (order.slice(0, 3).indexOf(h) >= 0) x.top3++;
    });
    try { window.localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* 記不住也能玩 */ }
    return s;
  }

  window.PriTestSaigoPress = {
    LEVELS: LEVELS, KAKARI_HINT: KAKARI_HINT, REPORTERS: REPORTERS, MARKS: MARKS, PART_STAT: PART_STAT,
    paddock: paddock, marks: marks, honmei: honmei, stats: stats, record: record
  };
})();
