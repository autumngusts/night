// 潛入晶片（sennyu）：純邏輯規則引擎（不碰 DOM，node 也能跑）。
// 規則依據：docs/sennyu_game_design.md。場景資料在 window.PriTestSennyuScenes（sennyu_story_*.js）。
//
// 場景的走法：st.cur = { sid, path, lines, i, phase }。path 記錄從場景根部走到目前段落的選擇，
// 每一步是 [選項序號, "ok"|"ng"|"d"] 或 ["m", "win"|"lose"]，所以存檔只有字串與數字。
(function () {
  "use strict";

  var root = typeof window !== "undefined" ? window : globalThis;
  var D = root.PriTestSennyuData;

  function S() { return root.PriTestSennyuScenes || {}; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function arch(st) { return D.ARCHES.filter(function (a) { return a.id === st.hero.arch; })[0]; }
  function chap(st) { return D.CHAPTERS[st.ch]; }

  // ---------------- 亂數（存在 st.rs，讀檔後可以接著用） ----------------
  function rnd(st) {
    st.rs = (st.rs + 0x6D2B79F5) | 0;
    var t = st.rs;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function pick(st, list) { return list[Math.floor(rnd(st) * list.length)]; }
  function shuffle(st, list) {
    var a = list.slice();
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(rnd(st) * (i + 1)); var x = a[i]; a[i] = a[j]; a[j] = x; }
    return a;
  }

  // ---------------- 開局 ----------------
  // 5 位候選人：圖庫頭像（排除 NPC 用的）＋不重複的出身
  function candidates(seed, imgs) {
    var tmp = { rs: seed | 0 };
    var pool = imgs.filter(function (f) { return D.NPC_IMGS.indexOf(f) < 0; });
    var faces = shuffle(tmp, pool).slice(0, 5);
    var arches = shuffle(tmp, D.ARCHES).slice(0, 5);
    var names = shuffle(tmp, D.COVER_NAMES);
    return faces.map(function (f, i) { return { img: f, arch: arches[i].id, name: names[i] }; });
  }

  function newGame(o) {
    var a = D.ARCHES.filter(function (x) { return x.id === o.arch; })[0] || D.ARCHES[0];
    var st = {
      v: 1, rs: (o.seed | 0) || 12345,
      hero: { img: o.img, arch: a.id, name: (o.name || "").trim() || "夜鶯" },
      stats: JSON.parse(JSON.stringify(a.stats)),
      ch: 0, day: 1, slot: 0, susp: 5, stress: 10, rep: 0,
      trust: {}, met: {}, bond: {}, intel: {}, flags: {}, done: {}, mainDone: {}, vars: {},
      skillUsed: false, snoop: 0, firedEvents: {}, handler: {},
      mole: null, cur: null, mini: null, busy: false, ending: null, log: [], turns: 0
    };
    Object.keys(D.NPCS).forEach(function (k) { st.trust[k] = 0; });
    st.mole = pick(st, D.SUSPECTS);
    startScene(st, D.CHAPTERS[0].open);
    return st;
  }

  // ---------------- 數值與效果 ----------------
  function scale(st, key, v, ctx) {
    if (v <= 0) return v;
    var p = arch(st).passive;
    if (key === "trust" && p === "trust") return Math.round(v * 1.25);
    if (key === "susp" && p === "susp") return Math.round(v * 0.7);
    if (key === "stress") {
      if (p === "drink") v = v * 0.8;
      if (p === "work" && ctx && ctx.work) v = v * 0.5;
      return Math.round(v);
    }
    return v;
  }
  function signed(n) { return (n > 0 ? "+" : "−") + Math.abs(n); }

  // 套用效果；回傳畫面上要提示的變化
  function applyEff(st, eff, ctx) {
    var notes = [];
    if (!eff) return notes;
    if (typeof eff === "function") eff = eff(st) || {};
    [["susp", "懷疑"], ["stress", "壓力"]].forEach(function (p) {
      if (!eff[p[0]]) return;
      var v = scale(st, p[0], eff[p[0]], ctx);
      var before = st[p[0]];
      st[p[0]] = clamp(before + v, 0, 100);
      if (st[p[0]] !== before) notes.push({ k: p[0], t: p[1] + " " + signed(st[p[0]] - before), bad: st[p[0]] > before });
    });
    if (eff.rep) { st.rep = Math.max(0, st.rep + eff.rep); notes.push({ k: "rep", t: "評價 " + signed(eff.rep), bad: eff.rep < 0 }); }
    if (eff.meet) eff.meet.forEach(function (n) { if (!st.met[n]) { st.met[n] = true; notes.push({ k: "meet", t: "認識了 " + D.NPCS[n].name }); } });
    if (eff.trust) Object.keys(eff.trust).forEach(function (k) {
      var who = k === "me" ? (ctx && ctx.from) : k;
      if (!who || !D.NPCS[who]) return;
      var v = scale(st, "trust", eff.trust[k], ctx);
      var before = st.trust[who];
      st.trust[who] = clamp(before + v, 0, 100);
      if (st.trust[who] !== before) notes.push({ k: "trust", t: D.NPCS[who].short + " 信任 " + signed(st.trust[who] - before), bad: v < 0 });
    });
    if (eff.stat) Object.keys(eff.stat).forEach(function (k) {
      st.stats[k] = clamp(st.stats[k] + eff.stat[k], 1, 6);
      notes.push({ k: "stat", t: statName(k) + " " + signed(eff.stat[k]) });
    });
    if (eff.intel) eff.intel.forEach(function (id) {
      if (st.intel[id]) return;
      st.intel[id] = true;
      notes.push({ k: "intel", t: "情報：" + intelById(id).name });
    });
    if (eff.flag) Object.keys(eff.flag).forEach(function (k) { st.flags[k] = eff.flag[k]; });
    if (eff.vars) Object.keys(eff.vars).forEach(function (k) { st.vars[k] = (st.vars[k] || 0) + eff.vars[k]; });
    return notes;
  }
  function statName(id) { return D.STATS.filter(function (s) { return s.id === id; })[0].name; }
  function intelById(id) { return D.INTEL.filter(function (x) { return x.id === id; })[0]; }
  function intelText(st, id) {
    var it = intelById(id);
    if (it.text) return it.text;
    var m = D.MOLE_TEXT[id];
    if (id === "k_4") {
      var from = st.flags.k4From;
      if (!from) return "";
      if (from === st.mole) return m.self[from];
      return m.other.replace("{from}", D.NPCS[from].name).replace("{mole}", D.NPCS[st.mole].name);
    }
    return m ? m[st.mole] : "";
  }

  // ---------------- 判定 ----------------
  function statOf(st, s) {
    var list = Array.isArray(s) ? s : [s];
    var best = list[0];
    list.forEach(function (x) { if (st.stats[x] > st.stats[best]) best = x; });
    return best;
  }
  function chance(st, check) {
    var s = statOf(st, check.s);
    var pct = 50 + (st.stats[s] - check.dc) * 15;
    if (st.stress >= 70) pct -= 10;
    if (check.bonus) pct += check.bonus(st) || 0;
    pct = clamp(pct, 5, 95);
    var list = Array.isArray(check.s) ? check.s : [check.s];
    var a = arch(st);
    return { stat: s, pct: pct, skill: !st.skillUsed && list.indexOf(a.skill) >= 0 ? a.skillName : null };
  }
  function roll(st, check, useSkill) {
    var c = chance(st, check);
    if (useSkill && c.skill) { st.skillUsed = true; return { ok: true, pct: 100, stat: c.stat, skill: true }; }
    var r = rnd(st) * 100;
    return { ok: r < c.pct, pct: c.pct, stat: c.stat, skill: false };
  }

  // 條件：函式（回傳 true／錯誤訊息）或物件
  function reqFail(st, req) {
    if (!req) return null;
    if (typeof req === "function") { var r = req(st); return r === true || r == null ? null : (r || "條件不足"); }
    var miss = [];
    if (req.intel) req.intel.forEach(function (id) { if (!st.intel[id]) miss.push("情報「" + intelById(id).name + "」"); });
    if (req.trust) Object.keys(req.trust).forEach(function (k) { if (st.trust[k] < req.trust[k]) miss.push(D.NPCS[k].short + " 信任 " + req.trust[k]); });
    if (req.flag) (Array.isArray(req.flag) ? req.flag : [req.flag]).forEach(function (f) { if (!st.flags[f]) miss.push(req.flagText || "尚未達成的條件"); });
    if (req.stat) Object.keys(req.stat).forEach(function (k) { if (st.stats[k] < req.stat[k]) miss.push(statName(k) + " " + req.stat[k]); });
    if (req.rep && st.rep < req.rep) miss.push("評價 " + req.rep);
    if (req.passive && arch(st).passive !== req.passive) miss.push(req.passiveText || "特定出身");
    return miss.length ? "需要：" + miss.join("、") : null;
  }

  // ---------------- 台詞 ----------------
  function fill(st, s) {
    return String(s)
      .replace(/\{name\}/g, st.hero.name)
      .replace(/\{mole\}/g, D.NPCS[st.mole].name)
      .replace(/\{rank\}/g, chap(st).rank);
  }
  function resolveLines(st, list, out) {
    out = out || [];
    if (typeof list === "function") list = [list];
    (list || []).forEach(function (l) {
      if (l == null || l === false) return;
      if (typeof l === "function") { resolveLines(st, [].concat(l(st) || []), out); return; }
      if (typeof l === "string") { out.push({ w: null, t: fill(st, l) }); return; }
      if (Array.isArray(l)) { out.push({ w: l[0], t: fill(st, l[1]) }); return; }
      if (l.if) { resolveLines(st, l.if(st) ? l.then : l.else, out); }
    });
    return out;
  }

  // ---------------- 場景 ----------------
  function seg(st) {
    var c = st.cur;
    if (!c) return null;
    var s = S()[c.sid];
    c.path.forEach(function (p) {
      if (p[0] === "m") { s = s.mini[p[1]]; return; }
      var ch = s.choices[p[0]];
      s = p[1] === "d" ? ch : ch[p[1]];
    });
    return s;
  }
  function rootScene(st) { return st.cur ? S()[st.cur.sid] : null; }

  function enterSeg(st, s, pre) {
    var ctx = { from: (rootScene(st) || {}).npc };
    var notes = applyEff(st, s.eff, ctx);
    var lines = (pre || []).concat(resolveLines(st, s.lines));
    st.cur.lines = lines;
    st.cur.i = 0;
    st.cur.notes = notes;
    st.cur.phase = "lines";
    if (!lines.length) finishLines(st);
  }

  function startScene(st, sid, opt) {
    var s = S()[sid];
    if (!s) throw new Error("sennyu: 找不到場景 " + sid);
    var prev = st.cur;
    st.cur = { sid: sid, path: [], lines: [], i: 0, phase: "lines", notes: [], busy: prev ? prev.busy : !!(opt && opt.busy) };
    if (s.npc) { st.met[s.npc] = true; }
    if (s.loc) st.cur.loc = s.loc;
    enterSeg(st, s);
  }

  function visibleChoices(st, s) {
    var out = [];
    (s.choices || []).forEach(function (c, i) {
      var why = reqFail(st, c.req);
      if (why && c.hide) return;
      out.push({ i: i, c: c, why: why });
    });
    return out;
  }

  function finishLines(st) {
    var s = seg(st);
    if (visibleChoices(st, s).length) { st.cur.phase = "choice"; return; }
    if (s.mini) { st.cur.phase = "mini"; startMini(st, s.mini); return; }
    goNext(st, s.next !== undefined ? s.next : rootNext(st));
  }
  // 選項結果沒有寫 next 時，接回場景根部的 next
  function rootNext(st) {
    var r = rootScene(st);
    return st.cur.path.length ? r.next : undefined;
  }

  // 下一行；沒有就進入選項／小遊戲／下一個場景
  function advance(st) {
    if (!st.cur || st.cur.phase !== "lines") return;
    st.cur.notes = [];
    st.cur.i++;
    if (st.cur.i >= st.cur.lines.length) { st.cur.i = st.cur.lines.length - 1; finishLines(st); }
  }

  function choose(st, idx, useSkill) {
    if (!st.cur || st.cur.phase !== "choice") return { ok: false };
    var s = seg(st);
    var c = s.choices[idx];
    if (!c || reqFail(st, c.req)) return { ok: false };
    var said = c.say || stripTag(c.t);
    var pre = [{ w: said.charAt(0) === "「" ? "me" : "act", t: fill(st, said), choice: true }];
    if (c.say === false) pre = [];
    if (c.check) {
      var r = roll(st, c.check, useSkill);
      st.cur.path.push([idx, r.ok ? "ok" : "ng"]);
      pre.push({ w: "sys", t: (r.skill ? "【" + arch(st).skillName + "】" : "") + statName(r.stat) + "判定 " + r.pct + "%：" + (r.ok ? "成功" : "失敗"), roll: r.ok ? "ok" : "ng" });
      enterSeg(st, r.ok ? c.ok : c.ng, pre);
      return { ok: true, roll: r };
    }
    st.cur.path.push([idx, "d"]);
    enterSeg(st, c, pre);
    return { ok: true };
  }
  function stripTag(t) { return typeof t === "string" ? t.replace(/^【[^】]*】/, "") : ""; }

  function goNext(st, next) {
    if (typeof next === "function") next = next(st);
    // 懷疑／壓力爆表優先
    if (!st.ending && !(typeof next === "string" && next.indexOf("@ending") === 0)) {
      if (st.susp >= 100) { startEnding(st, "e_exposed"); return; }
      if (st.stress >= 100) { startEnding(st, "e_broken"); return; }
    }
    if (!next || next === "@hub") { endScene(st); return; }
    if (next.indexOf("@ending:") === 0) { startEnding(st, next.slice(8)); return; }
    if (next === "@promote") { promote(st); return; }
    if (next === "@gate") {
      var g = chap(st).gate || 0;
      if (st.rep >= g) promote(st); else startScene(st, "gate_fail");
      return;
    }
    startScene(st, next);
  }

  function startEnding(st, id) {
    st.ending = id;
    st.cur = null;
    st.mini = null;
    var sid = "end_" + id.slice(2);
    if (S()[sid]) { startScene(st, sid); st.cur.ending = true; }
  }

  function endScene(st) {
    var busy = st.cur && st.cur.busy;
    if (st.cur) st.done[st.cur.sid] = true;
    st.cur = null;
    st.mini = null;
    if (st.ending) return;
    if (busy) advanceSlot(st);
  }

  function promote(st) {
    st.ch++;
    st.day = 1;
    st.slot = 0;
    st.skillUsed = false;
    st.snoop = 0;
    st.cur = null;
    st.mini = null;
    log(st, "★ " + chap(st).n + "「" + chap(st).title + "」　職位：" + chap(st).rank);
    startScene(st, chap(st).open);
  }

  function advanceSlot(st) {
    st.turns++;
    st.slot++;
    if (st.slot > 1) { st.slot = 0; st.day++; }
    var c = chap(st);
    if (st.day > c.days) {
      st.day = c.days;
      st.slot = 1;
      log(st, "期限到了。");
      startScene(st, c.fin);
      return;
    }
    if (st.slot === 0 && st.day > 1) {
      var pool = D.EVENTS.filter(function (e) { return e.ch === st.ch && !st.firedEvents[e.sid] && S()[e.sid]; });
      if (pool.length && rnd(st) < 0.35) {
        var e = pick(st, pool);
        st.firedEvents[e.sid] = true;
        startScene(st, e.sid);
      }
    }
  }

  function log(st, t) { st.log.push(t); if (st.log.length > 60) st.log.shift(); }

  // ---------------- 每天的行動 ----------------
  function slotName(st) { return st.slot === 0 ? "日間" : "夜間"; }
  function actions(st) {
    var c = chap(st), out = [];
    if (st.cur || st.ending || !c.mains) return out;
    var night = st.slot === 1;
    var allMain = true;
    c.mains.forEach(function (m) {
      if (st.mainDone[m.sid]) return;
      allMain = false;
      var ok = m.slot === "any" || (m.slot === "night") === night;
      out.push({ id: "main:" + m.sid, kind: "main", label: "★ " + m.label, why: ok ? null : (m.slot === "night" ? "只能在夜間進行" : "只能在日間進行") });
    });
    if (allMain) out.push({ id: "fin", kind: "main", label: "★ 推進：" + c.finLabel, desc: "進入章末（剩下的時間會跳過）" });
    Object.keys(D.BONDS).forEach(function (n) {
      if (!st.met[n]) return;
      var idx = st.bond[n] || 0, b = D.BONDS[n][idx];
      if (!b || b.ch > st.ch) return;
      out.push({ id: "bond:" + n, kind: "bond", npc: n, label: b.label, why: st.trust[n] >= b.req ? null : "需要信任 " + b.req + "（目前 " + st.trust[n] + "）" });
    });
    if (!night && st.ch <= 4) out.push({ id: "work", kind: "work", label: "處理堆積的請求", desc: "不合理要求小遊戲・評價" });
    var sn = (D.SNOOPS[st.ch] || [])[st.snoop];
    if (sn) out.push({ id: "snoop", kind: "snoop", label: "四處打探", desc: "可能拿到情報，也可能引起懷疑" });
    if (night) {
      out.push({ id: "handler", kind: "handler", label: "回報灰鷺", desc: "壓力 −10・懷疑 +3" });
      out.push({ id: "rest", kind: "rest", label: "休息", desc: "壓力 −25" });
    }
    return out;
  }

  function doAction(st, id) {
    var a = actions(st).filter(function (x) { return x.id === id; })[0];
    if (!a || a.why) return false;
    var sid;
    if (id.indexOf("main:") === 0) { sid = id.slice(5); st.mainDone[sid] = true; }
    else if (id === "fin") { startScene(st, chap(st).fin); return true; }
    else if (id.indexOf("bond:") === 0) { var n = id.slice(5); sid = D.BONDS[n][st.bond[n] || 0].sid; st.bond[n] = (st.bond[n] || 0) + 1; }
    else if (id === "work") sid = "work";
    else if (id === "snoop") { sid = D.SNOOPS[st.ch][st.snoop]; st.snoop++; }
    else if (id === "handler") {
      var h = D.HANDLER.filter(function (x) { return x.ch <= st.ch && !st.handler[x.sid]; })[0];
      if (h) st.handler[h.sid] = true;
      sid = h ? h.sid : "h_generic";
    }
    else if (id === "rest") sid = "rest";
    startScene(st, sid, { busy: true });
    return true;
  }

  // ---------------- 小遊戲 ----------------
  function startMini(st, m) {
    if (m.kind === "inbox") {
      var pool = D.INBOX.filter(function (q) { return !q.ch || q.ch <= st.ch; });
      st.mini = { kind: "inbox", list: shuffle(st, pool).slice(0, m.n || 4).map(function (q) { return q.id; }), i: 0,
        time: (m.time || 5) + (arch(st).passive === "work" ? 2 : 0), score: 0, res: [], need: m.need || 3, done: false };
    } else if (m.kind === "qte") {
      st.mini = { kind: "qte", foe: m.foe || "敵人", need: m.need || 2, of: m.of || 3, speed: m.speed || 1, done: false };
    } else if (m.kind === "sneak") {
      var map = D.MAPS[m.map], start = null;
      map.rows.forEach(function (r, y) { var x = r.indexOf("S"); if (x >= 0) start = [x, y]; });
      st.mini = { kind: "sneak", map: m.map, pos: start, t: 0, got: {}, out: {}, away: {}, alert: null, done: false, dc: m.dc || 3, msg: "" };
      // 情報可以讓某些警衛不在（例：知道交班時間）
      if (m.off) m.off(st).forEach(function (gi) { st.mini.out[gi] = true; });
    }
  }

  // 小遊戲結束：win／lose 可以是場景 id 或寫在 mini 裡的段落
  function miniEnd(st, win) {
    if (!st.cur || st.cur.phase !== "mini") return;
    var s = seg(st), key = win ? "win" : "lose", target = s.mini[key];
    st.mini = null;
    if (typeof target === "string" || typeof target === "function") { goNext(st, target); return; }
    st.cur.path.push(["m", key]);
    enterSeg(st, target, [{ w: "sys", t: win ? "成功" : "失敗", roll: win ? "ok" : "ng" }]);
  }

  // 請求：回傳這一件的結果文字
  function inboxQ(st) { var m = st.mini; return m && D.INBOX.filter(function (q) { return q.id === m.list[m.i]; })[0]; }
  function inboxPick(st, oi, useSkill) {
    var m = st.mini, q = inboxQ(st);
    if (!m || m.done || !q) return null;
    var o = q.opts[oi];
    if (o.time > m.time) return null;
    m.time -= o.time;
    var ctx = { from: q.from, work: true }, res = { q: q.id, opt: oi };
    if (o.check) {
      var r = roll(st, o.check, useSkill), out = r.ok ? o.ok : o.ng;
      res.roll = r; res.text = out.text; res.notes = applyEff(st, out, ctx);
      if (r.ok) m.score++;
    } else {
      res.text = o.text; res.notes = applyEff(st, o.eff, ctx);
      if (o.time > 0) m.score++;
    }
    m.res.push(res);
    m.i++;
    if (m.i >= m.list.length || m.time <= 0) {
      // 時間用完：沒處理的請求，請求者不太高興
      for (var k = m.i; k < m.list.length; k++) {
        var left = D.INBOX.filter(function (x) { return x.id === m.list[k]; })[0];
        applyEff(st, { trust: { me: -3 } }, { from: left.from });
      }
      m.done = true;
      m.win = m.score >= m.need;
      if (m.win) applyEff(st, { rep: 3 }, ctx);
    }
    return res;
  }

  // QTE 判定區寬（%）
  function qteZone(st) {
    var w = 14 + st.stats.body * 3;
    if (arch(st).passive === "qte") w *= 1.5;
    return Math.round(w);
  }

  // ---- 潛入 ----
  function guardCells(g) {
    var cells = [], pts = g.path.concat([g.path[0]]);
    for (var i = 0; i < pts.length - 1; i++) {
      var a = pts[i], b = pts[i + 1], x = a[0], y = a[1];
      while (x !== b[0] || y !== b[1]) {
        cells.push([x, y]);
        x += Math.sign(b[0] - x);
        y += Math.sign(b[1] - y);
      }
    }
    return cells;
  }
  function guardAt(map, gi, t) {
    var cells = guardCells(map.guards[gi]), n = cells.length;
    var p = cells[((t % n) + n) % n], q = cells[(((t - 1) % n) + n) % n];
    var dir = [Math.sign(p[0] - q[0]), Math.sign(p[1] - q[1])];
    if (!dir[0] && !dir[1]) dir = [1, 0];
    return { x: p[0], y: p[1], dx: dir[0], dy: dir[1] };
  }
  function tile(map, x, y) { var r = map.rows[y]; return r ? r.charAt(x) : "#"; }
  // 警衛 g 看不看得到 (x, y)：同格、相鄰（不論躲藏），或在面向的直線上 3 格內（躲在桌子就看不到）
  function sees(map, g, x, y) {
    var dist = Math.abs(g.x - x) + Math.abs(g.y - y);
    if (dist <= 1) return true;
    if (tile(map, x, y) === "d") return false;
    for (var k = 1; k <= 3; k++) {
      var cx = g.x + g.dx * k, cy = g.y + g.dy * k;
      if (tile(map, cx, cy) === "#") return false;
      if (cx === x && cy === y) return true;
    }
    return false;
  }
  function visionCells(map, g) {
    var out = [];
    for (var k = 1; k <= 3; k++) {
      var cx = g.x + g.dx * k, cy = g.y + g.dy * k;
      if (tile(map, cx, cy) === "#") break;
      out.push([cx, cy]);
    }
    return out;
  }
  function activeGuards(st) {
    var m = st.mini, map = D.MAPS[m.map], out = [];
    map.guards.forEach(function (g, i) {
      if (m.out[i]) return;
      var p = guardAt(map, i, m.t);
      p.i = i;
      p.away = (m.away[i] || 0) > m.t;
      out.push(p);
    });
    return out;
  }
  function detect(st) {
    var m = st.mini, map = D.MAPS[m.map];
    var hit = activeGuards(st).filter(function (g) { return !g.away && sees(map, g, m.pos[0], m.pos[1]); })[0];
    if (hit) m.alert = { g: hit.i, adj: Math.abs(hit.x - m.pos[0]) + Math.abs(hit.y - m.pos[1]) <= 1 };
    return !!hit;
  }
  // 移動一步（0,0＝原地等待）；回傳 false 表示不能走
  function sneakMove(st, dx, dy) {
    var m = st.mini;
    if (!m || m.kind !== "sneak" || m.done || m.alert) return false;
    var map = D.MAPS[m.map], nx = m.pos[0] + dx, ny = m.pos[1] + dy;
    if (tile(map, nx, ny) === "#") return false;
    var before = activeGuards(st);
    m.pos = [nx, ny];
    m.t++;
    m.msg = "";
    var key = nx + "," + ny;
    if (map.targets[key] && !m.got[key]) { m.got[key] = true; m.msg = "取得：" + map.targets[key]; }
    // 擦身而過（和警衛互換位置）也算被發現
    var swap = activeGuards(st).filter(function (g) {
      var b = before.filter(function (x) { return x.i === g.i; })[0];
      return !g.away && b && b.x === nx && b.y === ny && g.x === nx - dx && g.y === ny - dy;
    })[0];
    if (swap) m.alert = { g: swap.i, adj: true };
    else detect(st);
    if (m.alert) return true;
    var allGot = Object.keys(map.targets).every(function (k) { return m.got[k]; });
    if (allGot && tile(map, nx, ny) === "S") { m.done = true; m.win = true; return true; }
    if (m.t >= map.turns) { m.done = true; m.win = false; m.msg = "警報響了——時間到。"; }
    return true;
  }
  // 被發現後：擊暈（QTE 結果）
  function sneakStun(st, win) {
    var m = st.mini;
    if (!m || !m.alert) return;
    if (win) { m.out[m.alert.g] = true; m.alert = null; applyEff(st, { susp: 4 }); m.msg = "警衛倒下了。"; if (detect(st)) return; }
    else { m.done = true; m.win = false; m.msg = "你被制伏了。"; }
  }
  // 被發現後：找藉口（演技判定）
  function sneakBluff(st, useSkill) {
    var m = st.mini;
    if (!m || !m.alert) return null;
    var r = roll(st, { s: "guise", dc: m.dc }, useSkill);
    if (r.ok) {
      m.away[m.alert.g] = m.t + 6;
      m.alert = null;
      applyEff(st, { susp: 6 });
      m.msg = "「我東西忘在這裡了……」警衛半信半疑地走開了。";
    } else { m.done = true; m.win = false; m.msg = "警衛按下了對講機。"; }
    return r;
  }

  // ---------------- 結局 ----------------
  function truthHeron(st) { return ["h_1", "h_2", "h_3"].filter(function (k) { return st.intel[k]; }).length >= 2; }
  function truthModel(st) { return ["m_1", "m_2", "m_3"].filter(function (k) { return st.intel[k]; }).length >= 2; }

  root.PriTestSennyuCore = {
    candidates: candidates, newGame: newGame, rnd: rnd, pick: pick,
    applyEff: applyEff, chance: chance, roll: roll, reqFail: reqFail, statName: statName, arch: arch, chap: chap,
    intelById: intelById, intelText: intelText,
    seg: seg, rootScene: rootScene, startScene: startScene, visibleChoices: visibleChoices, advance: advance, choose: choose,
    goNext: goNext, actions: actions, doAction: doAction, slotName: slotName,
    miniEnd: miniEnd, inboxQ: inboxQ, inboxPick: inboxPick, qteZone: qteZone,
    guardAt: guardAt, guardCells: guardCells, sees: sees, visionCells: visionCells, activeGuards: activeGuards, tile: tile,
    sneakMove: sneakMove, sneakStun: sneakStun, sneakBluff: sneakBluff,
    truthHeron: truthHeron, truthModel: truthModel
  };
})();
