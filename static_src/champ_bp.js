// 冠軍教練（champ）：BP 戰略（2026-11-11 第六版，使用者指定 BP 提案 1、2、3、8、9、10、12）。
// 1 對位剋制（由英雄標籤推出，同位置對線生效）　2 搖擺位英雄（可打兩個位置，兩個位置都空時對手看不出位置）
// 3 陣容原型（標籤湊齊時的特殊加成）　8 選邊權（流程在 champ_core.js 的 startGame／chooseSide）
// 9 局間學習（對手記住你的 BP 習慣並針對；你改變做法就「出其不意」）　10 選手的英雄請求　12 BP 評分。
// champ_core.js 執行時透過 window.PriTestChampBP 取用（power、aiChoose、draftAct、endGame）。
(function () {
  "use strict";

  var D = window.PriTestChampData, Core = window.PriTestChampCore;
  var C = D.C, L = D.L;
  function S() { return Core.get(); }
  function tr(k, p) { return Core.tr(k, p); }
  function clamp(x, a, b) { return Core.clamp(x, a, b); }

  // ---------------- 1 對位剋制 ----------------
  // 標籤 A 剋標籤 B（單向，不會互剋）
  var TAG_BEATS = {
    engage: ["poke", "scale"], dive: ["poke", "split"], peel: ["dive", "engage"], poke: ["peel", "sustain"],
    burst: ["sustain", "scale"], cc: ["dive", "split"], early: ["scale"], sustain: ["early", "dive"],
    split: ["peel", "sustain"], scale: ["cc", "sustain"]
  };
  function beats(a, b) { return (TAG_BEATS[a] || []).indexOf(b) >= 0 ? 1 : 0; }
  // 英雄 h 對英雄 o 的剋制值（−2〜+2）
  function counter(hid, oid) {
    var h = D.HERO[hid], o = D.HERO[oid];
    if (!h || !o) return 0;
    var v = 0;
    h.tags.forEach(function (a) { o.tags.forEach(function (b) { v += beats(a, b) - beats(b, a); }); });
    return clamp(v, -2, 2);
  }
  var LANE_W = 0.45;   // 每一點剋制的戰力
  // 雙方同位置的對線剋制（我方視角），回傳 { tot, by: {role: v} }
  function laneCounter(myPicks, oppPicks) {
    var by = {}, tot = 0;
    D.ROLES.forEach(function (r) { var v = myPicks && oppPicks && myPicks[r] && oppPicks[r] ? counter(myPicks[r], oppPicks[r]) : 0; by[r] = v; tot += v; });
    return { tot: tot, by: by, power: tot * LANE_W };
  }

  // ---------------- 2 搖擺位英雄 ----------------
  var FLEX = { t_titan: "sup", t_witch: "mid", t_monk: "jg", t_samurai: "mid", t_druid: "jg", j_fox: "mid", j_bear: "top", j_lava: "top",
    m_puppet: "sup", m_dancer: "top", m_storm: "sup", a_spark: "mid", a_chem: "top", s_mage: "mid", s_war: "top", s_time: "mid" };
  Object.keys(FLEX).forEach(function (id) { if (D.HERO[id]) D.HERO[id].flex = FLEX[id]; });
  function rolesOf(hid) { var h = D.HERO[hid]; return h ? (h.flex ? [h.role, h.flex] : [h.role]) : []; }
  // 舊存檔：補上副位置英雄的熟練度
  function ensureFlexMastery(p) {
    Object.keys(FLEX).forEach(function (id) {
      if (FLEX[id] === p.role && p.mastery[id] == null) p.mastery[id] = Core.ri(12, 48);
    });
  }

  // ---------------- 3 陣容原型 ----------------
  var ARCH = [
    { id: "protect", icon: "👑", name: C("四保一", "四保一"), need: { peel: 3 }, ph: { late: 1.6 } },
    { id: "dive", icon: "🗡", name: C("全突進", "全員ダイブ"), need: { dive: 3, burst: 2 }, ph: { early: 0.6, mid: 1.2 } },
    { id: "poke", icon: "🎯", name: C("消耗攻城", "ポーク攻城"), need: { poke: 3 }, ph: { mid: 0.8, late: 0.8 } },
    { id: "split", icon: "🧭", name: C("1-3-1 分推", "1-3-1 スプリット"), need: { split: 2 }, ph: { mid: 0.3, late: 1.3 } },
    { id: "rush", icon: "⚡", name: C("前期速攻", "序盤速攻"), need: { early: 3 }, ph: { early: 1.8, late: -0.4 } },
    { id: "chain", icon: "⛓", name: C("控制鏈", "CC チェーン"), need: { cc: 3, engage: 2 }, ph: { mid: 1.5 } },
    { id: "sustain", icon: "💚", name: C("續戰消耗", "継戦"), need: { sustain: 3 }, ph: { mid: 0.6, late: 0.8 } },
    { id: "flex", icon: "🔀", name: C("搖擺奇襲", "フレックス奇襲"), flexN: 2, ph: { early: 0.5, mid: 0.5, late: 0.5 } }
  ];
  var ARCH_BY = {};
  ARCH.forEach(function (a) { ARCH_BY[a.id] = a; });
  function tagCount(picks) {
    var c = {};
    Object.keys(picks || {}).forEach(function (r) { var h = D.HERO[picks[r]]; if (h) h.tags.forEach(function (t) { c[t] = (c[t] || 0) + 1; }); });
    return c;
  }
  function offRoleN(picks) { var n = 0; Object.keys(picks || {}).forEach(function (r) { var h = D.HERO[picks[r]]; if (h && h.role !== r) n++; }); return n; }
  // 成立的原型（最多 2 個，取加成最大的）。progress：還沒成立的原型差幾個標籤（畫面用）
  function archetypes(picks) {
    var c = tagCount(picks), on = [];
    ARCH.forEach(function (a) {
      var ok = a.flexN ? offRoleN(picks) >= a.flexN : Object.keys(a.need).every(function (t) { return (c[t] || 0) >= a.need[t]; });
      if (ok) on.push(a);
    });
    function sum(a) { return (a.ph.early || 0) + (a.ph.mid || 0) + (a.ph.late || 0); }
    on.sort(function (a, b) { return sum(b) - sum(a); });
    return on.slice(0, 2);
  }
  function archProgress(picks) {
    var c = tagCount(picks);
    return ARCH.filter(function (a) { return !a.flexN; }).map(function (a) {
      var have = 0, need = 0;
      Object.keys(a.need).forEach(function (t) { need += a.need[t]; have += Math.min(a.need[t], c[t] || 0); });
      return { a: a, have: have, need: need };
    }).filter(function (x) { return x.have > 0; }).sort(function (x, y) { return (y.have / y.need) - (x.have / x.need); });
  }
  function archPhase(picks) {
    var o = { early: 0, mid: 0, late: 0 };
    archetypes(picks).forEach(function (a) { ["early", "mid", "late"].forEach(function (k) { o[k] += a.ph[k] || 0; }); });
    return o;
  }

  // ---------------- 9 局間學習 ----------------
  // 系列賽中記錄我方每局的 BP：先選的位置、陣容標籤、戰術。對手據此針對。
  function logGame(se, d, mySide) {
    if (!se.bpLog) se.bpLog = [];
    se.bpLog.push({ first: d.myFirst ? d.myFirst.role : null, tags: tagCount(d.picks[mySide]), tactic: d.tactic });
  }
  // 對手的讀法：{ role：預測你先搶的位置, tag：預測你的主力標籤, tactic：連續使用的戰術 }
  function read(se) {
    var log = (se && se.bpLog) || [], n = log.length, out = { role: null, tag: null, tactic: null };
    if (n >= 2 && log[n - 1].first && log[n - 1].first === log[n - 2].first) out.role = log[n - 1].first;
    if (n >= 1) {
      var tot = {};
      log.forEach(function (g) { Object.keys(g.tags).forEach(function (t) { tot[t] = (tot[t] || 0) + g.tags[t]; }); });
      var best = null, bv = 0;
      Object.keys(tot).forEach(function (t) { if (tot[t] > bv) { bv = tot[t]; best = t; } });
      if (best && bv >= 3 * n) out.tag = best;
    }
    if (n >= 2 && log[n - 1].tactic === log[n - 2].tactic) out.tactic = log[n - 1].tactic;
    return out;
  }
  // AI 的評分加成（aiChoose 呼叫）：rd＝read(se)，針對我方
  function aiBanBonus(rd, h) { return rd.role && rolesOf(h.id).indexOf(rd.role) >= 0 ? 14 : 0; }
  function aiPickBonus(rd, h) {
    if (!rd.tag) return 0;
    var v = 0;
    h.tags.forEach(function (t) { v += beats(t, rd.tag) * 7; });
    return v;
  }
  // 出其不意：對手讀到的習慣，這局你沒照做
  function surprise(se, d, mySide) {
    var rd = d.read || {}, out = [];
    if (rd.role && d.myFirst && d.myFirst.role !== rd.role) out.push("role");
    if (rd.tag && (tagCount(d.picks[mySide])[rd.tag] || 0) <= 1) out.push("tag");
    return out;
  }
  var SURPRISE_POW = 0.6;

  // ---------------- 10 選手的英雄請求 ----------------
  var REQ = {
    hot: C("「教練！這局讓我玩 {hero}！我一定打爆對面！」", "「コーチ！この試合 {hero} やらせて！絶対ぶっ飛ばす！」"),
    calm: C("「如果可以，這局我想用 {hero}。我有把握。」", "「できれば、今回は {hero} を使いたい。自信がある」"),
    natural: C("「欸欸，{hero} 可以嗎～？今天手感超好！」", "「ねえねえ、{hero} いい～？今日手の調子いいの！」"),
    tsun: C("「我、我才不是想玩 {hero}……只是剛好想玩而已！」", "「べ、別に {hero} がやりたいわけじゃ……たまたまだから！」"),
    hard: C("「{hero} 我練了很久，請讓我試試看。」", "「{hero} はずっと練習してきた。やらせてください」"),
    confident: C("「{hero} 給我，這局我 carry。」", "「{hero} ちょうだい。この試合は私がキャリーする」"),
    shy: C("「那個……如果可以的話……{hero}……」", "「あの……もしよければ……{hero} を……」"),
    lady: C("「本小姐今天想用 {hero}，請安排一下。」", "「今日は {hero} の気分ですの。よろしくて？」")
  };
  var REQ_OK = C("「謝謝教練！看我的！」", "「ありがとうコーチ！見ててね！」");
  var REQ_NG = {
    hot: C("「……好啦，我照教練的打。」", "「……わかった、コーチの言う通りにする」"), calm: C("「……了解。」", "「……了解」"),
    natural: C("「欸～好吧……」", "「え～、まあいっか……」"), tsun: C("「哼！隨便你啦！」", "「ふん！勝手にすれば！」"),
    hard: C("「我會用別的英雄證明自己。」", "「別のチャンプで証明してみせる」"), confident: C("「不給我？輸了別怪我喔。」", "「くれないの？負けても知らないから」"),
    shy: C("「……嗯，沒關係……」", "「……うん、大丈夫……」"), lady: C("「真是不懂本小姐的心呢。」", "「わたくしの気持ちがわかってませんのね」")
  };
  // 每局 40%：一位先發選手請求她熟練度最高、還能選的英雄
  function makeRequest(se) {
    if (se.auto || Math.random() > 0.4) return null;
    var cands = D.ROLES.map(function (r) { return Core.person(S().lineup[r]); }).filter(Boolean);
    var p = Core.pick(cands), best = null, bv = -1;
    Core.heroesOfRole(p.role).forEach(function (h) {
      if (se.used.indexOf(h.id) >= 0) return;
      var v = p.mastery[h.id] || 0;
      if (v > bv) { bv = v; best = h.id; }
    });
    if (!best || bv < 50) return null;
    return { pid: p.id, role: p.role, hid: best };
  }
  function reqLine(req) { var p = Core.person(req.pid); return p ? L(REQ[p.trait] || REQ.calm).replace("{hero}", L(D.HERO[req.hid].name)) : ""; }
  // BP 結束時結算請求
  function settleRequest(d, mySide) {
    var rq = d.req;
    if (!rq || rq.res) return;
    var p = Core.person(rq.pid);
    if (!p) return;
    var lover = window.PriTestChampBond && window.PriTestChampBond.isLover(p);
    if (d.picks[mySide][rq.role] === rq.hid) {
      p.mood = clamp(p.mood + 8, 0, 100); p.aff = clamp(p.aff + 2, 0, 100); if (p.cond < 2) p.cond++;
      rq.res = "ok"; rq.line = L(REQ_OK);
    } else if (Core.heroTaken(rq.hid)) {
      // 被禁、或被對手（或自己別的位置）選走：不怪教練
      p.mood = clamp(p.mood - 2, 0, 100);
      rq.res = "gone";
    } else {
      var hurt = ["tsun", "confident", "hot"].indexOf(p.trait) >= 0 ? 10 : 6;
      p.mood = clamp(p.mood - hurt - (lover ? 4 : 0), 0, 100); p.aff = clamp(p.aff - 1, 0, 100);
      rq.res = "ng"; rq.line = L(REQ_NG[p.trait] || REQ_NG.calm);
    }
  }

  // ---------------- 12 BP 評分 ----------------
  function topOf(p, role, n) {
    if (!p) return [];
    return Core.heroesOfRole(role).map(function (h) { return h.id; }).sort(function (a, b) { return (p.mastery[b] || 0) - (p.mastery[a] || 0); }).slice(0, n);
  }
  function grade(d, side, se) {
    var other = side === "blue" ? "red" : "blue", tid = d[side], otid = d[other], picks = d.picks[side], notes = [], sc = 0;
    var mSum = 0, metaSum = 0, secret = 0;
    D.ROLES.forEach(function (r) {
      var p = Core.playerFor(tid, r), hid = picks[r];
      mSum += p ? (p.mastery[hid] || 15) : 30;
      metaSum += Core.metaTier(hid);
      if (Core.isSecret(p, hid)) secret++;
    });
    var mAvg = mSum / 5, v;
    v = (mAvg - 62) * 0.12; sc += v; notes.push({ k: "mastery", v: v, n: Math.round(mAvg) });
    v = metaSum * 0.6; sc += v; if (metaSum) notes.push({ k: "meta", v: v, n: metaSum });
    var lc = laneCounter(picks, d.picks[other]);
    v = lc.tot * 0.9; sc += v; if (lc.tot) notes.push({ k: lc.tot > 0 ? "counter_good" : "counter_bad", v: v, n: Math.abs(lc.tot) });
    var syn = Core.activeSynergies(picks).length;
    v = syn * 1.2; sc += v; if (syn) notes.push({ k: "syn", v: v, n: syn });
    var arch = archetypes(picks);
    v = arch.length * 1.5; sc += v; if (arch.length) notes.push({ k: "arch", v: v, names: arch.map(function (a) { return L(a.name); }).join("、") });
    // 禁掉對手招牌（對手該位置熟練度前 3 的英雄）
    var hit = 0;
    d.bans[side].forEach(function (b) {
      var hb = D.HERO[b];
      if (!hb) return;
      rolesOf(b).forEach(function (r) { if (topOf(Core.playerFor(otid, r), r, 3).indexOf(b) >= 0) hit++; });
    });
    v = Math.min(3, hit) * 0.9; sc += v; notes.push({ k: hit ? "ban_hit" : "ban_miss", v: hit ? v : -0.5, n: hit });
    if (!hit) sc -= 0.5;
    if (secret) { v = secret * 0.8; sc += v; notes.push({ k: "secret", v: v, n: secret }); }
    var hidN = Object.keys((d.hidden || {})[side] || {}).length;
    if (hidN) { v = hidN * 0.5; sc += v; notes.push({ k: "flex", v: v, n: hidN }); }
    if (tid === "me" && d.surprise && d.surprise.length) { v = d.surprise.length; sc += v; notes.push({ k: "surprise", v: v }); }
    if (tid === "me" && d.read && d.read.role && d.myFirst && d.myFirst.role === d.read.role) { sc -= 0.8; notes.push({ k: "read", v: -0.8 }); }
    var g = sc >= 8 ? "S" : sc >= 5 ? "A" : sc >= 2.5 ? "B" : sc >= 0 ? "C" : "D";
    notes.sort(function (a, b) { return Math.abs(b.v) - Math.abs(a.v); });
    return { g: g, sc: Math.round(sc * 10) / 10, notes: notes };
  }
  function noteText(n) {
    return tr("bpn_" + n.k, { n: n.n, names: n.names || "" });
  }

  // 新成就：BP 大師（Bo5 系列賽獲勝且每局 BP 都在 A 以上）
  var EX = window.PriTestChampExtra;
  if (!EX.ACH_BY_ID.bp_master) {
    var a = { id: "bp_master", icon: "🧠", name: C("BP 大師", "BP マスター"), desc: C("Bo5 獲勝且每局 BP 評分都在 A 以上", "Bo5 で勝ち、全ゲームの BP 評価が A 以上") };
    EX.ACH.push(a); EX.ACH_BY_ID[a.id] = a;
  }

  window.PriTestChampBP = {
    TAG_BEATS: TAG_BEATS, FLEX: FLEX, ARCH: ARCH, ARCH_BY: ARCH_BY, LANE_W: LANE_W, SURPRISE_POW: SURPRISE_POW,
    counter: counter, laneCounter: laneCounter, rolesOf: rolesOf, ensureFlexMastery: ensureFlexMastery,
    archetypes: archetypes, archProgress: archProgress, archPhase: archPhase, tagCount: tagCount,
    logGame: logGame, read: read, aiBanBonus: aiBanBonus, aiPickBonus: aiPickBonus, surprise: surprise,
    makeRequest: makeRequest, reqLine: reqLine, settleRequest: settleRequest, grade: grade, noteText: noteText
  };
})();
