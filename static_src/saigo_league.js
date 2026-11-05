// 賽狗賽狗（saigo）：宿敵犬舍、重賞賽程表、粉絲數與稱號（2026-11-05 使用者指定，參考賽馬娘的ライバル・G1 レース・ファン数）。
// 資料存在犬舍（Kennel.load().league、每隻狗的 fans／titles），每台裝置各自一份；只在單機出現宿敵與重賞賽程，
// 粉絲數在單機與連線房間都會累積（自己的狗由自己的裝置結算）。不碰 DOM。
//
// 宿敵：6 個固定的 NPC 犬舍，各有一隻王牌狗（固定犬種、跑法、跑線、技能、擅長的能力）。
//   王牌狗的實力跟著玩家出賽的狗裡最強的那隻（Real.strength），每輸給玩家一次就多練一點（grow，最多 8 次），
//   出賽表上依上一次對戰結果說不同的話。宿敵輸贏以「玩家名次最好的狗」和王牌狗比。
// 重賞賽程：10 場固定的重賞（G3／G2／G1），固定地形與距離，依序進行；跑完（或略過）就換下一場，10 場一輪＝一季。
//   報名要「派出的狗」粉絲數達到門檻；贏了得到稱號。重賞一定有 1〜2 個宿敵出賽。
// 粉絲數：每場（練習賽除外）依名次 × 賽事倍率增加。舊的狗依戰績換算初始粉絲數。
(function () {
  "use strict";

  var D = window.PriTestSaigoData;
  var K = window.PriTestSaigoKennel;
  var SK = window.PriTestSaigoSkills;
  function Real() { return window.PriTestSaigoReal; }
  var C = D.C;

  // ---------------- 宿敵 ----------------
  // fav＝擅長的能力（訓練多 +6），其他 −1.5；taunt：first 初次見面、won 上次宿敵贏、lost 上次宿敵輸
  function R(id, kz, kj, nz, nj, breed, style, line, fav, skills, first, won, lost) {
    return { id: id, kennel: C(kz, kj, kj), name: C(nz, nj, nj), breed: breed, style: style, line: line, fav: fav, skills: skills,
      taunt: { first: C(first[0], first[1], first[0]), won: C(won[0], won[1], won[0]), lost: C(lost[0], lost[1], lost[0]) } };
  }
  var RIVALS = [
    R("ginga", "銀河犬舍", "ギンガ犬舎", "銀河流星", "ギンガリュウセイ", "greyhound", "nige", "rail", ["spd"],
      ["g_escape", "r_nige", "r_start", "n_nige", "n_focus"],
      ["新來的？先跟上我的速度再說吧。", "新顔か。まずはこのスピードについて来てみな。"],
      ["又是我贏了。下次也一樣。", "また俺の勝ちだ。次も同じだよ。"],
      ["……那次只是意外。這次讓你看清楚差距。", "……あれは何かの間違いだ。今度こそ差を見せてやる。"]),
    R("reimei", "黎明訓練所", "レイメイ育成所", "黑潮", "クロシオ", "formosan", "sashi", "mid", ["agi", "jmp"],
      ["g_shadow", "r_sashi", "r_overtake", "n_sashi", "n_lastleg"],
      ["聽說你的狗很有潛力，請多指教！", "君の犬、伸びしろがあるって評判だよ。よろしく！"],
      ["好比賽！再來一次吧！", "いいレースだった！またやろう！"],
      ["你們又變強了……我們也不會停下腳步。", "また強くなったね……僕たちも立ち止まらないよ。"]),
    R("kinjishi", "金獅犬舍", "キンジシ犬舎", "金獅王", "キンジシオウ", "doberman", "senko", "mid", ["pow", "sta"],
      ["g_first", "r_senko", "r_gofirst", "n_senko", "n_straight"],
      ["這裡是重賞的舞台，不是小狗玩耍的地方。", "ここは重賞の舞台だ。子犬の遊び場じゃない。"],
      ["看到了嗎？這就是王者的距離。", "見たか。これが王者との距離だ。"],
      ["哼……給我記住，下一場全力以赴。", "フン……覚えておけ。次は全力で行く。"]),
    R("sakura", "櫻花犬舍", "サクラ犬舎", "千本櫻", "センボンザクラ", "saluki", "oikomi", "wide", ["spd", "sta"],
      ["g_allout", "r_oikomi", "r_straight", "n_oikomi", "n_spurt"],
      ["最後的直線，會開滿櫻花喔。", "最後の直線、桜が満開になりますよ。"],
      ["花開得剛剛好呢。", "ちょうど見頃に咲きましたね。"],
      ["這次的花謝得太早了……下次不會了。", "今回は散るのが早すぎました……次は咲かせます。"]),
    R("raimei", "雷鳴團隊", "ライメイチーム", "雷電", "ライデン", "vizsla", "sashi", "wide", ["spd", "pow"],
      ["g_gale", "r_duel", "r_slip", "n_sashi", "n_spurt"],
      ["我們是雷鳴團隊！誰快誰說了算！", "ライメイチーム参上！速い奴が正義だ！"],
      ["哈哈！聽到雷聲了嗎！", "ハッハー！雷鳴が聞こえたか！"],
      ["可惡！再比一場！現在就比！", "くそっ！もう一回だ！今すぐだ！"]),
    R("tsukikage", "月影牧場", "ツキカゲ牧場", "月影", "ツキカゲ", "border", "senko", "rail", ["foc", "agi"],
      ["g_maestro", "r_corner", "r_breath", "n_corner", "n_calm"],
      ["……月亮升起的夜晚，我們不會輸。", "……月の昇る夜、我らは負けない。"],
      ["……如預言。", "……予言の通り。"],
      ["……月有陰晴圓缺。下次是滿月。", "……月は満ち欠けするもの。次は満月だ。"])
  ];
  var RIVAL_BY_ID = {};
  RIVALS.forEach(function (r) { RIVAL_BY_ID[r.id] = r; });
  var GROW_MAX = 8, GROW_K = 0.012;     // 每輸一次，王牌狗的實力目標 +1.2%（最多 +9.6%）
  var RIVAL_CHANCE = 0.35;              // 一般戰／重賞（非重賞賽程）有宿敵出賽的機率

  // ---------------- 重賞賽程 ----------------
  var GRADES = { G3: { fan: 6, prize: 5 }, G2: { fan: 9, prize: 7 }, G1: { fan: 14, prize: 10 } };
  function ST(id, zh, ja, grade, terrain, dist, fans, mode) { return { id: id, name: C(zh, ja, ja), grade: grade, terrain: terrain, dist: dist, fans: fans, mode: mode || "classic" }; }
  var STAKES = [
    ST("spring", "春風公園盃", "春風パーク杯", "G3", "park", "sprint", 0),
    ST("forest", "森林小徑賞", "森の小径賞", "G3", "forest", "middle", 300),
    ST("silver", "白銀雪山盃", "白銀スノーマウンテン杯", "G2", "snowmtn", "middle", 900),
    ST("dune", "沙丘衝刺賞", "砂丘スプリント", "G3", "desert", "sprint", 600),
    ST("seabreeze", "海風紀念", "シーブリーズ記念", "G2", "beach", "middle", 1500),
    ST("summer", "夏季大賞（真賽狗）", "サマーグランプリ（リアル）", "G1", "park", "long", 2800, "real"),
    ST("maple", "楓葉森林盃", "紅葉フォレスト杯", "G2", "forest", "long", 2400),
    ST("king", "沙漠王者決定戰", "砂漠王者決定戦", "G1", "desert", "long", 4500),
    ST("blizzard", "暴風雪山盃", "ブリザードマウンテン杯", "G2", "snowmtn", "sprint", 3800),
    ST("final", "年終冠軍大賞（真賽狗）", "年末チャンピオン大賞（リアル）", "G1", "beach", "long", 7000, "real")
  ];
  var STAKE_BY_ID = {};
  STAKES.forEach(function (s) { STAKE_BY_ID[s.id] = s; });

  // ---------------- 粉絲數 ----------------
  var FAN_BASE = [300, 150, 90, 50, 30, 20, 10, 10];
  var CLASS_FAN = { rookie: 1, open: 2, stakes: 4 };
  // 舊的狗（沒有 fans）依戰績換算
  function fansOf(d) {
    if (!d) return 0;
    if (typeof d.fans !== "number") d.fans = (d.wins || 0) * 400 + (d.top3 || 0) * 150 + (d.races || 0) * 30;
    return d.fans;
  }
  // 粉絲稱號（依人數）
  var FAN_RANKS = [[20000, C("國民偶像犬", "国民的アイドル犬", "National idol")], [8000, C("超人氣犬", "超人気犬", "Superstar")], [3000, C("人氣犬", "人気犬", "Fan favorite")],
    [1000, C("小有名氣", "ちょっと有名", "Rising star")], [0, C("新人", "新人", "Newcomer")]];
  function fanRank(n) { for (var i = 0; i < FAN_RANKS.length; i++) if (n >= FAN_RANKS[i][0]) return FAN_RANKS[i][1]; return FAN_RANKS[FAN_RANKS.length - 1][1]; }

  // ---------------- 狀態 ----------------
  function state() {
    var s = K.load();
    var L = s.league;
    if (!L || typeof L !== "object") L = s.league = {};
    if (!isFinite(L.week) || L.week < 0 || L.week >= STAKES.length) L.week = 0;
    if (!isFinite(L.season) || L.season < 1) L.season = 1;
    if (!L.rv || typeof L.rv !== "object") L.rv = {};
    RIVALS.forEach(function (r) { var x = L.rv[r.id]; if (!x || !isFinite(x.met)) L.rv[r.id] = { met: 0, w: 0, l: 0, last: "", grow: 0 }; });
    if (!Array.isArray(L.log)) L.log = [];
    return L;
  }
  function current() { var L = state(); return { stake: STAKES[L.week], week: L.week, season: L.season }; }
  function advance() {
    var L = state();
    L.week++;
    if (L.week >= STAKES.length) { L.week = 0; L.season++; }
    K.save();
  }
  // 報名資格：派出的狗裡至少一隻粉絲數達到門檻
  function canEnter(dogIds, stake) {
    return (dogIds || []).some(function (id) { return fansOf(K.dog(id)) >= stake.fans; });
  }

  // ---------------- 宿敵出賽 ----------------
  function rivalTaunt(id) {
    var r = RIVAL_BY_ID[id], x = state().rv[id];
    if (!r) return null;
    return x.met === 0 ? r.taunt.first : x.last === "lose" ? r.taunt.lost : r.taunt.won;
  }
  // 宿敵的王牌狗（給 Core.makeCard 的 entry）。playerEntries＝這場玩家派出的狗（實力目標跟著最強的那隻）
  function rivalEntry(id, playerEntries) {
    var r = RIVAL_BY_ID[id], x = state().rv[id], RL = Real();
    var top = null;
    (playerEntries || []).forEach(function (e) { var s = RL.strength(e.breed, e.train, e.lv); if (!top || s > top.s) top = { s: s, lv: e.lv || 0 }; });
    if (!top) top = { s: 75, lv: 6 };
    var lv = Math.min(K.MAX_LV, top.lv + 1);
    var tgt = top.s * (1 + GROW_K * Math.min(GROW_MAX, x.grow || 0));
    var tAdd = tgt - RL.strength(r.breed, null, lv), train = {};
    // 擅長的能力多 6、其他少 1.5，加總後再校正回目標實力
    D.STATS.forEach(function (k) { train[k] = tAdd + (r.fav.indexOf(k) >= 0 ? 6 : -1.5); });
    var fix = tgt - RL.strength(r.breed, train, lv);
    D.STATS.forEach(function (k) { train[k] = Math.round(Math.max(-15, Math.min(60, train[k] + fix))); });
    var lang = window.I18N && window.I18N.getLang() === "ja" ? "ja" : "zh";
    return { breed: r.breed, name: r.name[lang] || r.name.zh, best: r.style, style: r.style, line: r.line, train: train, lv: lv,
      mood: x.last === "lose" ? 3 : 2, fatigue: 0, owner: "rival", ownerName: r.kennel[lang] || r.kennel.zh, dogId: "", skills: SK.sanitize(r.skills), rival: id };
  }
  // 這場要出賽的宿敵（n 隻，不重複；rnd 預設 Math.random）
  function pickRivals(n, rnd) {
    rnd = rnd || Math.random;
    var ids = RIVALS.map(function (r) { return r.id; }), out = [];
    while (out.length < n && ids.length) out.push(ids.splice(Math.floor(rnd() * ids.length), 1)[0]);
    return out;
  }
  // 一般比賽要不要有宿敵（新手戰沒有）
  function rollRival(cls, rnd) { return cls !== "rookie" && (rnd || Math.random)() < RIVAL_CHANCE; }

  // ---------------- 賽後 ----------------
  // mine：[{ dogId, place }]（自己的狗）；回傳 { fans: [{ dogId, name, gain, total }], rivals: [{ id, beat }], title }
  function afterRace(card, order, mine, practice) {
    var out = { fans: [], rivals: [], title: null };
    if (practice) return out;
    var st = card.stakes && STAKE_BY_ID[card.stakes.id], mult = st ? GRADES[st.grade].fan : (CLASS_FAN[card.cls] || 2);
    mine.forEach(function (m) {
      var d = K.dog(m.dogId);
      if (!d) return;
      var gain = Math.round((FAN_BASE[m.place] || 10) * mult);
      d.fans = fansOf(d) + gain;
      out.fans.push({ dogId: d.id, name: d.name, gain: gain, total: d.fans });
      if (st && m.place === 0) {
        d.titles = Array.isArray(d.titles) ? d.titles : [];
        var title = { id: st.id, grade: st.grade, season: card.stakes.season };
        d.titles.push(title);
        out.title = { name: d.name, stake: st, season: card.stakes.season };
      }
    });
    var best = mine.length ? Math.min.apply(null, mine.map(function (m) { return m.place; })) : -1;
    var L = state();
    card.dogs.forEach(function (d, i) {
      if (!d.rival || !RIVAL_BY_ID[d.rival] || best < 0) return;
      var x = L.rv[d.rival], beat = best < order.indexOf(i);
      x.met++;
      if (beat) { x.w++; x.last = "lose"; x.grow = Math.min(GROW_MAX, (x.grow || 0) + 1); }
      else { x.l++; x.last = "win"; }
      out.rivals.push({ id: d.rival, beat: beat, gate: i });
    });
    if (st) {
      L.log.unshift({ id: st.id, season: card.stakes.season, winner: card.dogs[order[0]].name, mine: !!out.title });
      if (L.log.length > 30) L.log.length = 30;
      if (L.week === STAKES.indexOf(st) && L.season === card.stakes.season) advance();
    }
    K.save();
    return out;
  }

  function titlesOf(d) { return d && Array.isArray(d.titles) ? d.titles.filter(function (x) { return STAKE_BY_ID[x.id]; }) : []; }

  window.PriTestSaigoLeague = {
    RIVALS: RIVALS, RIVAL_BY_ID: RIVAL_BY_ID, STAKES: STAKES, STAKE_BY_ID: STAKE_BY_ID, GRADES: GRADES, FAN_BASE: FAN_BASE, CLASS_FAN: CLASS_FAN, RIVAL_CHANCE: RIVAL_CHANCE,
    state: state, current: current, advance: advance, canEnter: canEnter, fansOf: fansOf, fanRank: fanRank, titlesOf: titlesOf,
    rivalTaunt: rivalTaunt, rivalEntry: rivalEntry, pickRivals: pickRivals, rollRival: rollRival, afterRace: afterRace
  };
})();
