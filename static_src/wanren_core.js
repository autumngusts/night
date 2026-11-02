// 萬人迷（wanren）：遊戲規則與狀態。畫面在 wanren.js、3D 在 wanren_3d.js、資料在 wanren_data.js。
// 一天的流程：早上（迷妹搭訕＋隨機事件）→ 上課（平日）／考試 → 自由時間（3D 校園，行動點）→ 晚上（約會或自主活動）→ 一天結算。
// 所有狀態放在單一 state 物件，存在 localStorage["pritest-wanren-save"]。亂數用 state.rs（mulberry32），讀檔後可重現。
(function () {
  "use strict";

  var D = window.PriTestWanrenData;
  if (!D) return;
  var SAVE_KEY = "pritest-wanren-save";
  var VERSION = 1;
  var START = { y: 2026, m: 3, d: 6 };   // 2026-04-06（一）春學期開學
  var LENGTHS = [
    { id: "short", days: 26, name: { zh: "短學期（4 週）", ja: "短期（4 週間）" } },
    { id: "normal", days: 54, name: { zh: "標準（8 週）", ja: "標準（8 週間）" } },
    { id: "full", days: 103, name: { zh: "完整學期（15 週）", ja: "フル学期（15 週間）" } }
  ];
  var STATS = [
    { id: "study", icon: "📖", name: { zh: "學業", ja: "学業" } },
    { id: "charm", icon: "✨", name: { zh: "魅力", ja: "魅力" } },
    { id: "stamina", icon: "💪", name: { zh: "體力", ja: "体力" } },
    { id: "money", icon: "💰", name: { zh: "金錢", ja: "お金" } },
    { id: "rep", icon: "🗣", name: { zh: "風評", ja: "評判" } }
  ];
  var STAT_BY_ID = {};
  STATS.forEach(function (s) { STAT_BY_ID[s.id] = s; });
  var STAGES = [
    { min: -1, name: { zh: "未相遇", ja: "未対面" } },
    { min: 0, name: { zh: "認識", ja: "顔見知り" } },
    { min: 20, name: { zh: "朋友", ja: "友達" } },
    { min: 40, name: { zh: "好感", ja: "好感" } },
    { min: 60, name: { zh: "心動", ja: "ときめき" } },
    { min: 80, name: { zh: "喜歡", ja: "大好き" } },
    { min: 999, name: { zh: "交往中", ja: "交際中" } }
  ];
  var WD = ["一", "二", "三", "四", "五", "六", "日"];
  var WD_JA = ["月", "火", "水", "木", "金", "土", "日"];

  // ---------------- 亂數 ----------------
  function rand(s) {
    var t = (s.rs = (s.rs + 0x6D2B79F5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function ri(s, a, b) { return a + Math.floor(rand(s) * (b - a + 1)); }
  function pick(s, arr) { return arr[Math.floor(rand(s) * arr.length)]; }
  // 不消耗亂數狀態的雜湊（當天的位置、話題等：重複查詢結果一樣）
  function hash() {
    var h = 2166136261;
    for (var i = 0; i < arguments.length; i++) {
      var str = String(arguments[i]);
      for (var j = 0; j < str.length; j++) { h ^= str.charCodeAt(j); h = Math.imul(h, 16777619); }
      h ^= 0x9e37; h = Math.imul(h, 16777619);
    }
    h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
    return (h >>> 0) / 4294967296;
  }
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function name(hid) { return D.L(D.HEROINE_BY_ID[hid].name); }
  function fmt(str, p) { return String(str).replace(/\{(\w+)\}/g, function (m, k) { return p && p[k] !== undefined ? p[k] : m; }); }

  // ---------------- 新遊戲 ----------------
  function newGame(opts) {
    opts = opts || {};
    var len = LENGTHS.filter(function (l) { return l.id === opts.length; })[0] || LENGTHS[1];
    var seed = opts.seed !== undefined ? (opts.seed | 0) : (Math.floor(Math.random() * 2147483647) | 0);
    var s = {
      v: VERSION, seed: seed, rs: seed, name: String(opts.name || "轉學生").slice(0, 12), lengthId: len.id, length: len.days,
      day: 0, phase: "morning",
      stats: { study: 20, charm: 20, stamina: 80, money: 10000, rep: 0 },
      att: { ok: 0, total: 0 }, exams: [],
      h: {}, inv: {},
      fans: 0, admirersTotal: 0, ignored: 0, rejected: 0, contacts: 0, shura: 0, dates: 0, breakups: 0,
      pool: [], events: [], flags: {}, history: [], today: null, summary: null
    };
    D.HEROINES.forEach(function (hd) {
      s.h[hd.id] = { aff: 0, met: false, quest: 0, dating: false, lastSeen: -99, known: { topics: {}, gifts: {} }, cooldown: -1, dates: 0 };
    });
    startDay(s);
    return s;
  }

  // ---------------- 日曆 ----------------
  function weekday(day) { return day % 7; }
  function isWeekend(day) { return weekday(day) >= 5; }
  function dateOf(day) { return new Date(START.y, START.m, START.d + day); }
  function dateLabel(day) {
    var d = dateOf(day), ja = window.I18N && window.I18N.getLang && window.I18N.getLang() === "ja";
    return (d.getMonth() + 1) + "/" + d.getDate() + "（" + (ja ? WD_JA : WD)[weekday(day)] + "）";
  }
  function specialDays(s) {
    var len = s.length;
    var mid = Math.floor(len / 2);
    while (isWeekend(mid)) mid--;
    var fest = Math.round(len * 0.7);
    while (weekday(fest) !== 5) fest++;
    if (fest >= len - 1) fest -= 7;
    return { midterm: mid, final: len - 1, festival: fest };
  }
  function dayKind(s, day) {
    var sp = specialDays(s);
    if (day === sp.midterm) return "midterm";
    if (day === sp.final) return "final";
    if (day === sp.festival) return "festival";
    return isWeekend(day) ? "weekend" : "weekday";
  }

  // ---------------- 屬性 ----------------
  function applyEff(s, eff, out) {
    var parts = [];
    Object.keys(eff || {}).forEach(function (k) {
      var v = eff[k];
      if (!v || !STAT_BY_ID[k]) return;
      var before = s.stats[k];
      // 學業與魅力越高越難成長（遞減）
      if ((k === "study" || k === "charm") && v > 0) v = v * clamp(1.1 - before / 95, 0.15, 1);
      if (k === "money") s.stats.money = Math.max(0, Math.round(before + v));
      else if (k === "rep") s.stats.rep = clamp(Math.round((before + v) * 10) / 10, -100, 100);
      else s.stats[k] = clamp(Math.round((before + v) * 10) / 10, 0, 100);
      var real = Math.round((s.stats[k] - before) * 10) / 10;
      if (real) parts.push(D.L(STAT_BY_ID[k].name) + (real > 0 ? " +" : " ") + (k === "money" ? "¥" + real.toLocaleString() : real));
    });
    if (parts.length && out) out.push("（" + parts.join("、") + "）");
    return parts;
  }

  // ---------------- 女主角 ----------------
  function stageOf(s, hid) {
    var h = s.h[hid];
    if (!h.met) return 0;
    if (h.dating) return 6;
    var st = 1;
    for (var i = 1; i < 6; i++) if (h.aff >= STAGES[i].min) st = i;
    return st;
  }
  function stageName(s, hid) { return D.L(STAGES[stageOf(s, hid)].name); }
  // 沒完成任務時，好感卡在下一個任務門檻 +9
  function affCap(s, hid) {
    var hd = D.HEROINE_BY_ID[hid], h = s.h[hid];
    if (h.quest >= hd.quests.length) return 100;
    return hd.quests[h.quest].at + 9;
  }
  function addAff(s, hid, n, out, ignoreCap) {
    var h = s.h[hid];
    var cap = ignoreCap ? 100 : Math.max(affCap(s, hid), h.aff);
    var before = h.aff;
    h.aff = clamp(Math.round(h.aff + n), 0, n > 0 ? cap : 100);
    var real = h.aff - before;
    if (out) {
      if (real) out.push("（" + name(hid) + " 好感 " + (real > 0 ? "+" : "") + real + "）");
      else if (n > 0 && h.aff >= cap && !ignoreCap) out.push("（" + name(hid) + " 的好感暫時到頂了，完成她的任務才能更進一步）");
    }
    return real;
  }
  function loversOf(s) { return D.HEROINES.filter(function (hd) { return s.h[hd.id].dating; }).map(function (hd) { return hd.id; }); }

  // 今天自由時間她在哪（null＝不在學校）
  function whereIs(s, hid, day) {
    if (day === undefined) day = s.day;
    var hd = D.HEROINE_BY_ID[hid], wd = weekday(day), kind = dayKind(s, day);
    if (kind === "festival") return ["plaza", "club", "cafeteria", "field", "plaza"][Math.floor(hash(s.seed, day, hid, "f") * 5)];
    if (hd.days && hd.days.indexOf(wd) < 0) return null;
    if (wd === 6 && hd.group === "teacher") return null;
    var absent = wd >= 5 ? (hd.group === "parent" ? 0 : 0.45) : 0.1;
    if (hash(s.seed, day, hid, "a") < absent) return null;
    return hd.spots[Math.floor(hash(s.seed, day, hid, "s") * hd.spots.length)];
  }
  function heroinesAt(s, loc) {
    return D.HEROINES.filter(function (hd) { return whereIs(s, hd.id) === loc; }).map(function (hd) { return hd.id; });
  }

  // ---------------- 一天的開始 ----------------
  function startDay(s) {
    var kind = dayKind(s, s.day);
    s.phase = "morning";
    s.today = {
      kind: kind, ap: 0, apMax: 0, apBonus: 0, talked: {}, gifted: {}, invited: {}, pairs: {}, quests: {},
      date: null, dateRun: null, flirt: 0, log: [], admirers: genAdmirers(s), festDance: null
    };
    s.flags.pose = false;
    // 隨機事件（有修羅場時優先）
    if (!s.events.length && rand(s) < 0.38) {
      var ev = genEvent(s);
      if (ev) s.events.push(ev);
    }
  }

  // ---------------- 迷妹 ----------------
  function genAdmirers(s) {
    var c = s.stats.charm;
    var n = 2 + (rand(s) < 0.5 ? 1 : 0) + (c >= 45 ? 1 : 0) + (c >= 75 ? 1 : 0) + (s.flags.pose ? 1 : 0);
    if (s.day === 0) n = 3;
    n = Math.min(n, 6);
    var list = [];
    for (var i = 0; i < n; i++) {
      var back = s.pool.filter(function (p) { return (p.st === "ignored" || p.st === "fan") && !list.some(function (x) { return x.id === p.id; }); });
      if (back.length && rand(s) < 0.22) {
        var p = pick(s, back);
        list.push({ id: p.id, name: p.name, role: p.role, hair: p.hair, ap: pick(s, D.APPROACHES).id, ret: p.st, choice: null });
        continue;
      }
      var a = {
        id: "a" + s.day + "_" + i + "_" + ri(s, 0, 9999),
        name: pick(s, D.ADMIRER_SURNAMES) + " " + pick(s, D.ADMIRER_GIVEN),
        role: pick(s, D.ADMIRER_ROLES),
        hair: pick(s, D.ADMIRER_LOOKS),
        ap: pick(s, D.APPROACHES).id, ret: null, choice: null
      };
      list.push(a);
    }
    return list;
  }
  function approachOf(id) { return D.APPROACHES.filter(function (a) { return a.id === id; })[0]; }
  function answerAdmirer(s, idx, optIdx) {
    var a = s.today.admirers[idx];
    if (!a || a.choice !== null || s.phase !== "morning") return null;
    var ap = approachOf(a.ap), o = ap.opts[optIdx];
    if (!o) return null;
    var out = [o.res];
    a.choice = optIdx;
    s.admirersTotal++;
    applyEff(s, o.eff, out);
    if (o.money) { var m = ri(s, o.money[0], o.money[1]); applyEff(s, { money: m }, out); }
    if (o.fans) s.fans += o.fans;
    if (o.flirt) s.today.flirt += o.flirt;
    if (o.contact) s.contacts++;
    if (o.ap) s.today.apBonus += o.ap;
    var st = optIdx === 0 ? "fan" : optIdx === ap.opts.length - 1 ? "ignored" : "rejected";
    if (st === "ignored") s.ignored++;
    if (st === "rejected") s.rejected++;
    var rec = s.pool.filter(function (p) { return p.id === a.id; })[0];
    if (rec) rec.st = st;
    else s.pool.push({ id: a.id, name: a.name, role: a.role, hair: a.hair, st: st });
    if (s.pool.length > 80) s.pool.shift();
    if (o.flirt && loversOf(s).length) out.push("（女友們好像會在意你跟別人太親近……）");
    return out;
  }
  function finishMorning(s) {
    if (s.phase !== "morning") return;
    s.today.admirers.forEach(function (a, i) {
      if (a.choice === null) answerAdmirer(s, i, approachOf(a.ap).opts.length - 1);
    });
    var k = s.today.kind;
    if (k === "weekday") s.phase = "class";
    else if (k === "midterm" || k === "final") s.phase = "exam";
    else { s.phase = "free"; setAp(s, 6); }
  }
  function setAp(s, base) {
    var n = Math.max(1, base + s.today.apBonus);
    s.today.ap = n; s.today.apMax = n;
  }

  // ---------------- 上課／考試 ----------------
  function doClass(s, optId) {
    if (s.phase !== "class") return null;
    var o = D.CLASS_OPTS.filter(function (c) { return c.id === optId; })[0];
    if (!o) return null;
    var out = [D.L(o.name) + "。"];
    var eff = {};
    Object.keys(o.eff).forEach(function (k) { eff[k] = o.eff[k]; });
    if (eff.study > 0 && s.stats.stamina < 25) { eff.study = eff.study / 2; out.push("太累了，上課內容一半都沒進到腦子裡。"); }
    applyEff(s, eff, out);
    s.att.total++;
    if (o.att) s.att.ok++;
    if (o.teacher && s.h.rinko.met) {
      addAff(s, "rinko", o.teacher, out);
      if (o.teacher < 0) out.push("柊老師的紅筆在你名字旁邊停了一下。");
    }
    s.phase = "free";
    setAp(s, 4 + (o.ap || 0));
    checkFaint(s, out);
    return out;
  }
  function doExam(s, effort) {
    if (s.phase !== "exam") return null;
    var out = [];
    var isFinal = s.today.kind === "final";
    var bonus = effort ? 6 : 0;
    var score = Math.round(clamp(s.stats.study * 0.85 + 12 + bonus + (rand(s) * 16 - 8) - (s.stats.stamina < 20 ? 10 : 0), 0, 100));
    applyEff(s, { stamina: effort ? -15 : -6 }, null);
    s.exams.push({ kind: isFinal ? "final" : "midterm", score: score, day: s.day });
    s.att.total++; s.att.ok++;
    out.push((isFinal ? "期末考" : "期中考") + "結束了。你的分數是 " + score + " 分。");
    if (score >= 90) { out.push("全學年前段班！柊老師難得對你點了點頭。"); if (s.h.rinko.met) addAff(s, "rinko", 4, out); applyEff(s, { rep: 3 }, out); }
    else if (score < 50) { out.push("……不及格邊緣。柊老師的眼神好可怕。"); applyEff(s, { rep: -2 }, out); }
    s.phase = "free";
    setAp(s, 3);
    checkFaint(s, out);
    return out;
  }
  function checkFaint(s, out) {
    if (s.stats.stamina > 0) return false;
    out.push("眼前一黑——你昏倒了。醒來時，你躺在保健中心的床上。");
    s.stats.stamina = 35;
    s.today.ap = 0;
    var h = s.h.rena;
    if (!h.met) { h.met = true; out.push("「你醒啦？不可以太勉強自己喔。」保健中心的七瀨醫師溫柔地看著你。"); }
    addAff(s, "rena", 5, out);
    h.lastSeen = s.day;
    applyEff(s, { rep: -1 }, out);
    return true;
  }

  // ---------------- 自由時間 ----------------
  function useAp(s, n) {
    if (s.phase !== "free" || s.today.ap < n) return false;
    s.today.ap -= n;
    return true;
  }
  function locAction(s, locId) {
    var loc = D.LOC_BY_ID[locId];
    if (!loc || !loc.act || s.phase !== "free") return null;
    var a = loc.act;
    if (a.id === "home") { endFree(s); return ["你今天早點回家了。"]; }
    if (a.eff.money && a.eff.money < 0 && s.stats.money < -a.eff.money) return ["錢不夠。"];
    if (!useAp(s, a.ap)) return ["沒有行動點了。"];
    var out = [D.L(a.name) + "。"];
    applyEff(s, a.eff, out);
    if (a.flag) s.flags[a.flag] = true;
    checkFaint(s, out);
    return out;
  }
  function talkTopics(s, hid) {
    var cnt = s.today.talked[hid] || 0;
    var ids = D.TOPICS.map(function (t) { return t.id; });
    var res = [];
    var k = 0;
    while (res.length < 3 && k < 40) {
      var id = ids[Math.floor(hash(s.seed, s.day, hid, cnt, k) * ids.length)];
      if (res.indexOf(id) < 0) res.push(id);
      k++;
    }
    return res;
  }
  function topicPref(hid, tid) {
    var hd = D.HEROINE_BY_ID[hid];
    return hd.topics.like.indexOf(tid) >= 0 ? "like" : hd.topics.bad.indexOf(tid) >= 0 ? "bad" : "mid";
  }
  function giftPref(hid, iid) {
    var hd = D.HEROINE_BY_ID[hid];
    return hd.gifts.like.indexOf(iid) >= 0 ? "like" : hd.gifts.bad.indexOf(iid) >= 0 ? "bad" : "mid";
  }
  function lineOf(s, arr) { return arr[Math.floor(rand(s) * arr.length)]; }
  // 第一次搭話＝相遇
  function meet(s, hid) {
    var h = s.h[hid], hd = D.HEROINE_BY_ID[hid];
    if (h.met) return null;
    if (!useAp(s, 1)) return ["沒有行動點了。"];
    h.met = true;
    h.lastSeen = s.day;
    s.today.talked[hid] = 1;
    var out = [name(hid) + "：" + hd.lines.greet];
    addAff(s, hid, 5, out);
    return out;
  }
  function talk(s, hid, tid) {
    var h = s.h[hid], hd = D.HEROINE_BY_ID[hid];
    if (!h.met) return meet(s, hid);
    if (!useAp(s, 1)) return ["沒有行動點了。"];
    var cnt = s.today.talked[hid] || 0;
    var pref = topicPref(hid, tid);
    h.known.topics[tid] = pref;
    var out = ["你：" + D.TOPIC_BY_ID[tid].say, name(hid) + "：" + lineOf(s, hd.lines[pref])];
    var base = pref === "like" ? 8 : pref === "bad" ? -4 : 3;
    if (base > 0) base *= 1 + s.stats.charm / 150;
    if (base > 0 && cnt >= 1) base *= 0.5;
    if (h.dating) base += 1;
    addAff(s, hid, base, out);
    if (h.dating && rand(s) < 0.5) out.push(name(hid) + "：" + lineOf(s, hd.lines.lover));
    s.today.talked[hid] = cnt + 1;
    h.lastSeen = s.day;
    return out;
  }
  function gift(s, hid, iid) {
    var h = s.h[hid], hd = D.HEROINE_BY_ID[hid];
    if (!h.met || s.today.gifted[hid] || !s.inv[iid]) return null;
    if (!useAp(s, 1)) return ["沒有行動點了。"];
    s.inv[iid]--;
    if (!s.inv[iid]) delete s.inv[iid];
    var pref = giftPref(hid, iid);
    h.known.gifts[iid] = pref;
    var it = D.ITEM_BY_ID[iid];
    var out = ["你送給" + name(hid) + "「" + D.L(it.name) + "」。", name(hid) + "：" + hd.lines[pref === "like" ? "gl" : pref === "bad" ? "gb" : "gn"]];
    var base = pref === "like" ? 12 : pref === "bad" ? -5 : 4;
    if (base > 0) base *= 1 + s.stats.charm / 200;
    addAff(s, hid, base, out);
    s.today.gifted[hid] = true;
    h.lastSeen = s.day;
    return out;
  }
  function buy(s, iid) {
    var it = D.ITEM_BY_ID[iid];
    if (!it || s.stats.money < it.price) return null;
    s.stats.money -= it.price;
    s.inv[iid] = (s.inv[iid] || 0) + 1;
    return ["買了「" + D.L(it.name) + "」（¥" + it.price.toLocaleString() + "）。"];
  }
  function inviteMin(hid) { return D.HEROINE_BY_ID[hid].inviteMin || 30; }
  function canInvite(s, hid) {
    var h = s.h[hid];
    return s.phase === "free" && h.met && !s.today.date && !s.today.invited[hid] && h.aff >= inviteMin(hid);
  }
  function invite(s, hid) {
    if (!canInvite(s, hid)) return null;
    if (!useAp(s, 1)) return ["沒有行動點了。"];
    var h = s.h[hid], hd = D.HEROINE_BY_ID[hid];
    s.today.invited[hid] = true;
    var p = h.dating ? 0.95 : clamp(0.35 + (h.aff - inviteMin(hid)) / 50 + s.stats.charm / 300, 0.1, 0.95);
    var when = isWeekend(s.day) ? "今天" : "今晚";
    var out = ["你約" + name(hid) + when + "出去。"];
    if (rand(s) < p) {
      s.today.date = hid;
      out.push(name(hid) + "：" + hd.lines.dy);
      out.push("（約會成立！晚上記得赴約。）");
    } else {
      out.push(name(hid) + "：" + hd.lines.dn);
    }
    h.lastSeen = s.day;
    return out;
  }
  function questOf(s, hid) {
    var hd = D.HEROINE_BY_ID[hid], h = s.h[hid];
    if (!h.met || h.quest >= hd.quests.length) return null;
    var q = hd.quests[h.quest];
    return h.aff >= q.at ? q : null;
  }
  function reqText(req) {
    if (req.type === "stat") return D.L(STAT_BY_ID[req.stat].name) + " ≥ " + req.min + (req.cost ? "（消耗體力 " + req.cost + "）" : "");
    if (req.type === "item") return "持有「" + D.L(D.ITEM_BY_ID[req.item].name) + "」";
    if (req.type === "money") return "花費 ¥" + req.amount.toLocaleString();
    if (req.type === "loc") return "到「" + D.L(D.LOC_BY_ID[req.loc].name) + "」執行";
    if (req.type === "heroine") return name(req.id) + " 的好感 ≥ " + req.min;
    return "";
  }
  function reqMet(s, req, curLoc) {
    if (req.type === "stat") return s.stats[req.stat] >= req.min && (!req.cost || s.stats.stamina > req.cost);
    if (req.type === "item") return !!s.inv[req.item];
    if (req.type === "money") return s.stats.money >= req.amount;
    if (req.type === "loc") return curLoc === req.loc;
    if (req.type === "heroine") return s.h[req.id].met && s.h[req.id].aff >= req.min;
    return false;
  }
  // 地點型任務：人在那個地點就能做（不用她剛好在場）
  function locQuests(s, curLoc) {
    return D.HEROINES.filter(function (hd) {
      var q = questOf(s, hd.id);
      return q && q.req.type === "loc" && q.req.loc === curLoc && !s.today.quests[hd.id];
    }).map(function (hd) { return hd.id; });
  }
  function doQuest(s, hid, curLoc) {
    var q = questOf(s, hid);
    if (!q || s.today.quests[hid]) return null;
    if (!reqMet(s, q.req, curLoc)) return ["條件不足：" + reqText(q.req)];
    if (!useAp(s, 1)) return ["沒有行動點了。"];
    var h = s.h[hid];
    if (q.req.type === "item") { s.inv[q.req.item]--; if (!s.inv[q.req.item]) delete s.inv[q.req.item]; }
    if (q.req.type === "money") s.stats.money -= q.req.amount;
    if (q.req.type === "stat" && q.req.cost) applyEff(s, { stamina: -q.req.cost }, null);
    var out = ["【任務】" + q.title, q.done];
    h.quest++;
    s.today.quests[hid] = true;
    var r = q.reward || {};
    addAff(s, hid, r.aff || 10, out, true);
    var eff = {};
    ["study", "charm", "stamina", "money", "rep"].forEach(function (k) { if (r[k]) eff[k] = r[k]; });
    applyEff(s, eff, out);
    if (r.heroine && s.h[r.heroine.id].met) addAff(s, r.heroine.id, r.heroine.aff, out);
    h.lastSeen = s.day;
    if (h.quest >= D.HEROINE_BY_ID[hid].quests.length) out.push("（" + name(hid) + " 的任務全部完成！好感 80 以上就可以告白了。）");
    checkFaint(s, out);
    return out;
  }
  function confessReq(s, hid) {
    var hd = D.HEROINE_BY_ID[hid], c = hd.confess || {};
    var lack = [];
    Object.keys(c).forEach(function (k) { if (s.stats[k] < c[k]) lack.push(D.L(STAT_BY_ID[k].name) + " ≥ " + c[k]); });
    return lack;
  }
  function canConfess(s, hid) {
    var h = s.h[hid], hd = D.HEROINE_BY_ID[hid];
    return s.phase === "free" && h.met && !h.dating && h.quest >= hd.quests.length && h.aff >= 80 && h.cooldown < s.day;
  }
  function confess(s, hid) {
    if (!canConfess(s, hid)) return null;
    var lack = confessReq(s, hid);
    if (lack.length) return ["還差一點……（" + lack.join("、") + "）"];
    if (!useAp(s, 1)) return ["沒有行動點了。"];
    var h = s.h[hid], hd = D.HEROINE_BY_ID[hid];
    var lovers = loversOf(s).length;
    var p = clamp(0.55 + (h.aff - 80) / 50 + s.stats.charm / 400 + s.stats.rep / 400 - lovers * hd.jealousy * 0.12, 0.05, 0.97);
    var out = ["你鼓起勇氣，對" + name(hid) + "說出了「我喜歡你」。"];
    if (rand(s) < p) {
      h.dating = true;
      out.push(name(hid) + "：" + hd.lines.cy);
      out.push("💕 你和" + name(hid) + "開始交往了！");
      addAff(s, hid, 5, out, true);
      if (lovers) { out.push("（……你現在同時和 " + (lovers + 1) + " 個人交往。小心修羅場。）"); }
      applyEff(s, { charm: 3 }, out);
    } else {
      out.push(name(hid) + "：" + hd.lines.cn);
      addAff(s, hid, -10, out);
      h.cooldown = s.day + 3;
      out.push("（3 天後才能再告白）");
    }
    h.lastSeen = s.day;
    return out;
  }
  function pairsAt(s, curLoc) {
    var here = heroinesAt(s, curLoc);
    return D.PAIRS.filter(function (p) {
      return here.indexOf(p.a) >= 0 && here.indexOf(p.b) >= 0 && s.h[p.a].met && s.h[p.b].met && !s.today.pairs[p.a + p.b];
    });
  }
  function pairTalk(s, a, b) {
    var p = D.PAIRS.filter(function (x) { return x.a === a && x.b === b; })[0];
    if (!p || s.today.pairs[a + b]) return null;
    if (!useAp(s, 1)) return ["沒有行動點了。"];
    s.today.pairs[a + b] = true;
    var hot = s.h[a].aff >= 60 && s.h[b].aff >= 60;
    var out = ["【" + name(a) + " × " + name(b) + "】", hot ? p.shura : p.text];
    if (hot) {
      addAff(s, a, 3, out); addAff(s, b, 3, out);
      applyEff(s, { charm: 1, stamina: -4 }, out);
      out.push("（兩個人都很在意你……）");
    } else {
      addAff(s, a, 4, out); addAff(s, b, 4, out);
    }
    s.h[a].lastSeen = s.day; s.h[b].lastSeen = s.day;
    return out;
  }
  function endFree(s) {
    if (s.phase !== "free") return;
    s.phase = "evening";
  }

  // ---------------- 晚上 ----------------
  function dateSpots(s) {
    return D.DATE_SPOTS.filter(function (d) { return !d.weekend || isWeekend(s.day); });
  }
  function startDate(s, spotId) {
    var hid = s.today.date;
    if (s.phase !== "evening" || !hid || s.today.dateRun) return null;
    var sp = D.DATE_BY_ID[spotId];
    if (!sp || (sp.weekend && !isWeekend(s.day))) return null;
    if (s.stats.money < sp.cost) return { error: "錢不夠。" };
    s.stats.money -= sp.cost;
    var mi = Math.floor(rand(s) * D.DATE_MOMENTS.length);
    s.today.dateRun = { hid: hid, spot: spotId, moment: mi };
    return { moment: D.DATE_MOMENTS[mi] };
  }
  function finishDate(s, key) {
    var run = s.today.dateRun;
    if (!run || run.done) return null;
    var hid = run.hid, hd = D.HEROINE_BY_ID[hid], h = s.h[hid], sp = D.DATE_BY_ID[run.spot];
    var out = [];
    var spotPref = hd.dates.like.indexOf(run.spot) >= 0 ? "like" : hd.dates.bad.indexOf(run.spot) >= 0 ? "bad" : "mid";
    var gain = 8 + (spotPref === "like" ? 8 : spotPref === "bad" ? -4 : 0);
    out.push(spotPref === "like" ? name(hid) + "看起來非常開心，一直拉著你的手。" : spotPref === "bad" ? name(hid) + "好像有點提不起勁……" : "你們度過了愉快的時光。");
    if (key === hd.moment) { gain += 7; out.push(name(hid) + "的臉紅了，靜靜地靠近了你。"); }
    else { gain += 1; out.push(name(hid) + "笑了笑。"); }
    if (h.dating) { gain += 2; out.push(name(hid) + "：" + lineOf(s, hd.lines.lover)); }
    addAff(s, hid, gain, out);
    if (sp.eff) applyEff(s, sp.eff, out);
    applyEff(s, { stamina: -6 }, out);
    h.lastSeen = s.day;
    h.dates++;
    s.dates++;
    run.done = true;
    s.phase = "night";
    return out;
  }
  function cancelDate(s) {
    var hid = s.today.date;
    if (!hid || s.today.dateRun) return null;
    var out = ["你放了" + name(hid) + "鴿子……"];
    addAff(s, hid, -8, out);
    s.today.date = null;
    return out;
  }
  function doEvening(s, optId, arg) {
    if (s.phase !== "evening" || s.today.date) return null;
    var o = D.EVENING_OPTS.filter(function (e) { return e.id === optId; })[0];
    if (!o) return null;
    if (o.eff.money && o.eff.money < 0 && s.stats.money < -o.eff.money) return ["錢不夠。"];
    var out = [D.L(o.name) + "。"];
    if (optId === "message") {
      var h = s.h[arg];
      if (!h || !h.met || h.aff < 20) return null;
      out = ["你傳了訊息給" + name(arg) + "，聊到深夜。"];
      addAff(s, arg, h.dating ? 4 : 3, out);
      h.lastSeen = Math.max(h.lastSeen, s.day - 1);
      applyEff(s, { stamina: -3 }, out);
    } else {
      applyEff(s, o.eff, out);
    }
    s.phase = "night";
    return out;
  }
  // 學園祭的後夜祭：選一位共舞
  function festDance(s, hid) {
    if (s.phase !== "evening" || s.today.kind !== "festival" || s.today.date) return null;
    var h = s.h[hid];
    if (!h || !h.met || h.aff < 40) return null;
    var out = ["後夜祭的營火前，你牽起了" + name(hid) + "的手。音樂響起，你們跳了一整首曲子。", name(hid) + "：" + lineOf(s, D.HEROINE_BY_ID[hid].lines.like)];
    addAff(s, hid, h.dating ? 16 : 12, out, true);
    loversOf(s).forEach(function (o) {
      if (o !== hid) { out.push(name(o) + "在人群中看著你們……"); addAff(s, o, -5, out); }
    });
    h.lastSeen = s.day;
    s.today.festDance = hid;
    s.phase = "night";
    return out;
  }

  // ---------------- 一天的結束 ----------------
  function endDay(s) {
    if (s.phase === "free") endFree(s);
    if (s.phase === "evening") {
      if (s.today.date && !s.today.dateRun) cancelDate(s);
      s.phase = "night";
    }
    var out = [];
    // 睡覺回復
    applyEff(s, { stamina: 20 }, null);
    var lovers = loversOf(s);
    // 跟太多迷妹曖昧：女友吃醋
    if (lovers.length && s.today.flirt >= 3) {
      lovers.forEach(function (hid) {
        var n = Math.min(4, Math.round((s.today.flirt - 2) * D.HEROINE_BY_ID[hid].jealousy * 1.5));
        if (n > 0) { out.push(name(hid) + "聽說你今天被一堆女生圍著……"); addAff(s, hid, -n, out); }
      });
    }
    // 冷落
    D.HEROINES.forEach(function (hd) {
      var h = s.h[hd.id];
      if (!h.met) return;
      var gap = s.day - h.lastSeen;
      if (h.dating && gap >= 3) { out.push(name(hd.id) + "：「最近……都沒看到你呢。」"); addAff(s, hd.id, -3, out); }
      else if (!h.dating && h.aff >= 40 && gap >= 6) addAff(s, hd.id, -1, null);
    });
    // 女友好感太低：分手
    lovers.forEach(function (hid) {
      if (s.h[hid].aff < 50) {
        s.h[hid].dating = false;
        s.breakups++;
        out.push("💔 " + name(hid) + "：「我們……還是分開吧。」你們分手了。");
      }
    });
    lovers = loversOf(s);
    // 修羅場
    if (lovers.length >= 2) {
      var avgJ = lovers.reduce(function (a, hid) { return a + D.HEROINE_BY_ID[hid].jealousy; }, 0) / lovers.length;
      var p = clamp(0.05 * (lovers.length - 1) * (1 + avgJ) + s.today.flirt * 0.015 - s.stats.rep / 600, 0.02, 0.55);
      if (rand(s) < p) {
        var a = pick(s, lovers), rest = lovers.filter(function (x) { return x !== a; }), b = pick(s, rest);
        s.events.unshift({ type: "shura", a: a, b: b });
      }
    }
    s.history.push({ day: s.day, study: s.stats.study, charm: s.stats.charm, money: s.stats.money, rep: s.stats.rep, lovers: lovers.length });
    s.summary = { day: s.day, lines: out };
    s.day++;
    if (s.day >= s.length) { s.phase = "report"; s.today = null; }
    else startDay(s);
    return out;
  }

  // ---------------- 隨機事件 ----------------
  function metList(s, f) { return D.HEROINES.filter(function (hd) { var h = s.h[hd.id]; return h.met && (!f || f(h, hd)); }).map(function (hd) { return hd.id; }); }
  function genEvent(s) {
    var c = [];
    var met = metList(s);
    if (met.length) c.push({ type: "rain", hid: pick(s, met) });
    c.push({ type: "wallet" });
    if (!isWeekend(s.day) && s.today.kind === "weekday") c.push({ type: "quiz" });
    if (s.fans >= 10 && !s.flags.fanpage) c.push({ type: "fanpage" });
    if (s.contacts > 0) c.push({ type: "line" });
    var inv = metList(s, function (h, hd) { return h.aff >= 45 && !h.dating; });
    if (inv.length) c.push({ type: "invite", hid: pick(s, inv) }, { type: "invite", hid: pick(s, inv) });
    var conf = metList(s, function (h, hd) { return h.aff >= 85 && !h.dating && h.quest >= hd.quests.length; });
    if (conf.length) c.push({ type: "herconfess", hid: pick(s, conf) }, { type: "herconfess", hid: pick(s, conf) });
    if (s.stats.money < 1500) c.push({ type: "broke" });
    return c.length ? pick(s, c) : null;
  }
  function eventView(s, ev) {
    var n = ev.hid ? name(ev.hid) : "";
    if (ev.type === "rain") return { title: "☔ 突如其來的大雨", text: "放學時下起了大雨。你在校門口看到" + n + "望著天空，好像沒帶傘。", opts: ["共撐一把傘", "把傘借她，自己淋雨回家", "裝作沒看見"] };
    if (ev.type === "wallet") return { title: "👛 撿到錢包", text: "你在中庭撿到一個錢包，裡面有三千塊和一張學生證。", opts: ["交給失物招領處", "……沒人看到吧"] };
    if (ev.type === "quiz") return { title: "📝 突襲小考", text: "柊老師走進教室：「把課本收起來，小考。」", opts: ["憑實力作答", "偷看隔壁的答案"] };
    if (ev.type === "fanpage") return { title: "📱 粉絲專頁", text: "校園論壇上出現了「" + s.name + " 後援會」的粉絲專頁，追蹤人數持續增加中。", opts: ["大方分享、跟粉絲互動", "請管理員低調處理"] };
    if (ev.type === "line") return { title: "💬 LINE 爆炸", text: "之前交換聯絡方式的女生們，一早就傳來了上百則訊息。", opts: ["一則一則耐心回覆", "已讀不回", "全部封鎖"] };
    if (ev.type === "invite") return { title: "💌 " + n + " 的邀約", text: n + " 傳來訊息：「今天" + (isWeekend(s.day) ? "" : "放學後") + "……有空嗎？想跟你一起出去。」", opts: ["當然好！", "抱歉，今天不行"] };
    if (ev.type === "herconfess") return { title: "🌸 櫻花樹下", text: n + " 約你到櫻花林道。她低著頭，聲音在發抖：「我……我喜歡你。可以跟我交往嗎？」", opts: ["「我也喜歡你」", "「對不起……」"] };
    if (ev.type === "broke") return { title: "💸 錢包見底", text: "你的錢包只剩下幾枚硬幣。學餐的美紀學姐看你可憐，問你要不要來打工一天。", opts: ["去打工（今天自由時間 −2）", "撐過去就好"] };
    if (ev.type === "shura") {
      var a = name(ev.a), b = name(ev.b);
      return { title: "⚡ 修羅場", text: a + "和" + b + "同時出現在你面前。她們看看彼此，再看看你。\n" + a + "：" + D.HEROINE_BY_ID[ev.a].lines.jealous + "\n" + b + "：" + D.HEROINE_BY_ID[ev.b].lines.jealous,
        opts: ["選擇" + a, "選擇" + b, "坦白：「我兩個都喜歡！」", "找藉口矇混過去"] };
    }
    return { title: "", text: "", opts: ["OK"] };
  }
  function resolveEvent(s, idx) {
    var ev = s.events.shift();
    if (!ev) return null;
    var out = [];
    var hid = ev.hid;
    if (ev.type === "rain") {
      if (idx === 0) { out.push("小小的傘下，你們的肩膀碰在一起。她一路上都沒說話，但嘴角一直在笑。"); addAff(s, hid, 6, out); }
      else if (idx === 1) { out.push("你把傘塞給她就跑進雨裡。隔天她紅著臉把傘還給你，還附了一張小卡片。"); addAff(s, hid, 9, out); applyEff(s, { stamina: -12 }, out); }
      else out.push("你撐著傘從她身邊走過。");
      if (idx < 2) s.h[hid].lastSeen = s.day;
    } else if (ev.type === "wallet") {
      if (idx === 0) { out.push("失主是一位學妹，她感激得一直鞠躬。這件事在系上傳開了。"); applyEff(s, { rep: 3 }, out); s.fans += 1; }
      else { out.push("你把三千塊放進口袋。……心裡有點不舒服。"); applyEff(s, { money: 3000, rep: -5 }, out); }
    } else if (ev.type === "quiz") {
      if (idx === 0) {
        if (s.stats.study >= 20 + rand(s) * 50) { out.push("寫得很順！你拿了高分。"); applyEff(s, { study: 2, rep: 1 }, out); if (s.h.rinko.met) addAff(s, "rinko", 2, out); }
        else { out.push("……有一半看不懂。"); applyEff(s, { study: 1 }, out); }
      } else if (rand(s) < 0.5) { out.push("成功了……但什麼也沒學到。"); }
      else { out.push("「你在看哪裡？」柊老師就站在你背後。"); applyEff(s, { rep: -5 }, out); if (s.h.rinko.met) addAff(s, "rinko", -5, out); }
    } else if (ev.type === "fanpage") {
      s.flags.fanpage = true;
      if (idx === 0) { out.push("你在專頁留言，粉絲們瘋狂了。"); applyEff(s, { charm: 3, rep: 1 }, out); s.fans += 5; s.today.flirt += 1; }
      else { out.push("專頁改成了私密社團。大家都說你很謙虛。"); applyEff(s, { rep: 2 }, out); }
    } else if (ev.type === "line") {
      if (idx === 0) { out.push("回到手指抽筋。大家都覺得你超溫柔。"); applyEff(s, { charm: 1, stamina: -5 }, out); s.fans += 1; s.today.flirt += 1; }
      else if (idx === 1) { out.push("訊息越來越多……"); applyEff(s, { rep: -1 }, out); }
      else { out.push("世界安靜了。不過也有人說你很無情。"); applyEff(s, { rep: -2 }, out); s.contacts = 0; }
    } else if (ev.type === "invite") {
      if (idx === 0) {
        if (s.today.date) { out.push("……可是你今天已經有約了。只好下次再說。"); addAff(s, hid, -1, out); }
        else { s.today.date = hid; out.push("約會成立！晚上記得赴約。"); }
      } else { out.push("「這樣啊……那下次吧。」"); addAff(s, hid, -2, out); }
    } else if (ev.type === "herconfess") {
      var hd = D.HEROINE_BY_ID[hid];
      if (idx === 0) {
        s.h[hid].dating = true;
        out.push(name(hid) + "：" + hd.lines.cy);
        out.push("💕 你和" + name(hid) + "開始交往了！");
        addAff(s, hid, 8, out, true);
        applyEff(s, { charm: 3 }, out);
      } else { out.push(name(hid) + "強忍著眼淚：「……我知道了。謝謝你。」"); addAff(s, hid, -20, out); }
      s.h[hid].lastSeen = s.day;
    } else if (ev.type === "broke") {
      if (idx === 0) { out.push("你在學餐洗了一整天的盤子。"); applyEff(s, { money: 3000, stamina: -8 }, out); s.today.apBonus -= 2; if (s.h.miki.met) addAff(s, "miki", 4, out); }
      else out.push("今天就喝水度日吧……");
    } else if (ev.type === "shura") {
      s.shura++;
      var a = ev.a, b = ev.b;
      if (!s.h[a].dating || !s.h[b].dating) { out.push("……好像是誤會一場。"); return out; }
      if (idx === 0 || idx === 1) {
        var keep = idx === 0 ? a : b, lose = idx === 0 ? b : a;
        out.push("你握住了" + name(keep) + "的手。" + name(lose) + "什麼也沒說，轉身離開了。");
        s.h[lose].dating = false; s.breakups++;
        addAff(s, lose, -30, out); addAff(s, keep, 6, out);
        applyEff(s, { rep: -3 }, out);
      } else if (idx === 2) {
        var ok = s.stats.charm >= 70 && rand(s) < 0.3 + (s.stats.charm - 70) / 60;
        if (ok) {
          out.push("一陣沉默之後，兩個人同時嘆了一口氣：「……真拿你沒辦法。」這就是萬人迷的力量嗎？");
          addAff(s, a, -4, out); addAff(s, b, -4, out);
          s.flags.harem = (s.flags.harem || 0) + 1;
          applyEff(s, { charm: 2 }, out);
        } else {
          out.push("「你是認真的嗎？！」兩記巴掌同時落在你的臉上。");
          [a, b].forEach(function (x) {
            addAff(s, x, -20, out);
            if (D.HEROINE_BY_ID[x].jealousy >= 0.6 || s.h[x].aff < 50) { s.h[x].dating = false; s.breakups++; out.push("💔 " + name(x) + "跟你分手了。"); }
          });
          applyEff(s, { rep: -8 }, out);
        }
      } else {
        if (rand(s) < 0.45 + s.stats.charm / 300) { out.push("「她只是在問我功課啦！」……好像矇混過去了。"); applyEff(s, { rep: -2 }, out); }
        else {
          out.push("藉口被一眼看穿了。");
          addAff(s, a, -15, out); addAff(s, b, -15, out);
          var worse = D.HEROINE_BY_ID[a].jealousy >= D.HEROINE_BY_ID[b].jealousy ? a : b;
          s.h[worse].dating = false; s.breakups++;
          out.push("💔 " + name(worse) + "跟你分手了。");
          applyEff(s, { rep: -5 }, out);
        }
      }
    }
    return out;
  }

  // ---------------- 學期報告 ----------------
  function report(s) {
    var examAvg = s.exams.length ? s.exams.reduce(function (a, e) { return a + e.score; }, 0) / s.exams.length : s.stats.study;
    var attRate = s.att.total ? s.att.ok / s.att.total : 1;
    var grade = Math.round(clamp(examAvg * 0.6 + attRate * 25 + s.stats.study * 0.15, 0, 100));
    var letter = grade >= 90 ? "S（秀）" : grade >= 80 ? "A（優）" : grade >= 70 ? "B（良）" : grade >= 60 ? "C（可）" : "F（不可）";
    var rows = D.HEROINES.map(function (hd) {
      var h = s.h[hd.id];
      var st = !h.met ? "none" : h.dating ? "lover" : h.aff >= 60 ? "high" : h.aff >= 20 ? "mid" : "low";
      return { id: hd.id, name: D.L(hd.name), group: hd.group, aff: h.aff, met: h.met, dating: h.dating, stage: stageName(s, hd.id), status: st,
        line: st === "none" ? "" : hd.lines.end[st], dates: h.dates, quest: h.quest };
    });
    var lovers = rows.filter(function (r) { return r.dating; });
    var r = {
      grade: grade, letter: letter, examAvg: Math.round(examAvg), attRate: Math.round(attRate * 100), exams: s.exams.slice(),
      lovers: lovers.length, friends: rows.filter(function (x) { return x.met && x.aff >= 20; }).length,
      maxAff: rows.reduce(function (a, x) { return Math.max(a, x.aff); }, 0), met: rows.filter(function (x) { return x.met; }).length,
      fans: s.fans, admirers: s.admirersTotal, ignored: s.ignored, rejected: s.rejected, shura: s.shura, breakups: s.breakups, dates: s.dates,
      rep: s.stats.rep, charm: s.stats.charm, study: s.stats.study, money: s.stats.money, rows: rows, name: s.name, days: s.length
    };
    var title = D.TITLES.filter(function (t) { return t.cond(r); })[0];
    r.title = title.name; r.titleComment = title.comment;
    var sumAff = rows.reduce(function (a, x) { return a + x.aff; }, 0);
    r.score = Math.round(r.charm * 1.5 + Math.min(r.fans, 200) * 0.35 + sumAff / 6 + r.lovers * 25 + r.rep * 0.5 + grade * 0.5);
    r.rank = r.score >= 480 ? "SS" : r.score >= 380 ? "S" : r.score >= 280 ? "A" : r.score >= 190 ? "B" : r.score >= 110 ? "C" : "D";
    // 導師評語
    r.teacher = grade >= 90 ? "成績優異，無可挑剔。……下學期，也繼續坐在第一排吧。" :
      grade >= 80 ? "很認真。轉學生能有這種成績，值得肯定。" :
      grade >= 70 ? "表現穩定。但我知道你可以做得更好。" :
      grade >= 60 ? "勉強及格。你的心思，好像不完全在課本上。" :
      "這樣下去會留級。暑假的補習，我會親自盯著你。";
    if (r.attRate < 70) r.teacher += "另外，出席率 " + r.attRate + "% 是怎麼回事？";
    // 感情評語
    var love = [];
    if (r.lovers === 0) love.push(r.maxAff >= 60 ? "有好幾段差一點就開花結果的感情。下學期，勇敢一點吧。" : "這個學期沒有談戀愛。也許你在等一個真正的心動。");
    else if (r.lovers === 1) love.push("你和" + lovers[0].name + "的故事，是這個學期校園裡最多人在聊的話題。");
    else love.push("你同時和 " + lovers.map(function (x) { return x.name; }).join("、") + " 交往中。" + (r.shura ? "經歷了 " + r.shura + " 次修羅場，" : "奇蹟似地沒有被發現，") + "依然活著。");
    if (r.fans >= 20) love.push("後援會的人數達到 " + r.fans + " 人，你走在校園裡會被偷拍。");
    if (r.ignored >= 20) love.push("你無視了 " + r.ignored + " 個鼓起勇氣的女生。有人說你是「冰山王子」。");
    if (r.breakups) love.push("也經歷了 " + r.breakups + " 次分手。每一次心痛，都讓你更懂得愛。");
    if (lovers.some(function (x) { return x.group === "parent"; }) && lovers.some(function (x) { return x.group === "classmate"; })) love.push("……和同學的媽媽交往這件事，下學期要怎麼解釋呢？");
    if (lovers.some(function (x) { return x.group === "teacher"; })) love.push("師生戀被傳開之前，最好低調一點。");
    r.love = love;
    r.summary = s.name + "的轉學第一學期，以「" + r.title + "」畫下句點。學業 " + letter + "、萬人迷指數 " + r.score + "（" + r.rank + "）。";
    return r;
  }

  // ---------------- 存讀檔 ----------------
  function save(s) {
    try { window.localStorage.setItem(SAVE_KEY, JSON.stringify(s)); return true; } catch (e) { return false; }
  }
  function load() {
    try {
      var s = JSON.parse(window.localStorage.getItem(SAVE_KEY) || "null");
      if (!s || s.v !== VERSION || !s.h || !s.stats) return null;
      D.HEROINES.forEach(function (hd) {
        if (!s.h[hd.id]) s.h[hd.id] = { aff: 0, met: false, quest: 0, dating: false, lastSeen: -99, known: { topics: {}, gifts: {} }, cooldown: -1, dates: 0 };
      });
      return s;
    } catch (e) { return null; }
  }
  function clearSave() { try { window.localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ } }

  window.PriTestWanrenCore = {
    SAVE_KEY: SAVE_KEY, LENGTHS: LENGTHS, STATS: STATS, STAT_BY_ID: STAT_BY_ID, STAGES: STAGES,
    newGame: newGame, save: save, load: load, clearSave: clearSave,
    dateLabel: dateLabel, weekday: weekday, isWeekend: isWeekend, dayKind: dayKind, specialDays: specialDays,
    stageOf: stageOf, stageName: stageName, affCap: affCap, loversOf: loversOf,
    whereIs: whereIs, heroinesAt: heroinesAt,
    approachOf: approachOf, answerAdmirer: answerAdmirer, finishMorning: finishMorning,
    doClass: doClass, doExam: doExam,
    locAction: locAction, talkTopics: talkTopics, topicPref: topicPref, giftPref: giftPref,
    talk: talk, meet: meet, gift: gift, buy: buy, canInvite: canInvite, inviteMin: inviteMin, invite: invite,
    questOf: questOf, reqText: reqText, reqMet: reqMet, locQuests: locQuests, doQuest: doQuest,
    canConfess: canConfess, confessReq: confessReq, confess: confess,
    pairsAt: pairsAt, pairTalk: pairTalk, endFree: endFree,
    dateSpots: dateSpots, startDate: startDate, finishDate: finishDate, cancelDate: cancelDate, doEvening: doEvening, festDance: festDance,
    endDay: endDay, eventView: eventView, resolveEvent: resolveEvent,
    report: report, fmt: fmt
  };
})();
