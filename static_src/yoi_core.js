// 宵の怪談（yoi）：規則引擎（純邏輯，不碰 DOM；node 也能跑，見 tools/yoi_check/core_check.js）。
// 規則依據 docs/yoi_game_design.md（§9 數值經使用者確認 2026-11-10）。
// 整局狀態 st 可 JSON 化；所有變動都透過 apply(st, ctrl, action)。本機模式 ctrl 一律 "local"
// （之後連線模式由房主代為套用，ctrl＝送出者 cid，屆時再加探索者的 ctrl 判定）。
// 亂數用 mulberry32，狀態存在 st.seed，所以存檔／重播／同步都能得到相同結果。
(function () {
  "use strict";

  var root = typeof window !== "undefined" ? window : globalThis;
  var D = root.PriTestYoiData;

  var TABOO_PENALTY = 2;      // §9 A3
  var ACCUSE_PENALTY = 2;     // §9 A7
  var ACCUSE_DREAD = 2;
  var ACCUSE_NEED = 2;        // §9 A6：禁忌答對 2 條以上
  var RITUAL_NERVE = 2;
  var OFFERING_HP = 2;

  // ---------------- 亂數 ----------------
  function rnd(st) {
    var t = (st.seed = (st.seed + 0x6D2B79F5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function ri(st, n) { return Math.floor(rnd(st) * n); }
  function pick(st, list) { return list[ri(st, list.length)]; }
  function shuffle(st, list) {
    for (var i = list.length - 1; i > 0; i--) { var j = ri(st, i + 1), x = list[i]; list[i] = list[j]; list[j] = x; }
    return list;
  }

  // ---------------- 查詢 ----------------
  function stage(st) { return D.STAGE_BY_ID[st.stage]; }
  function kaii(st) { return D.KAII_BY_ID[st.kaii]; }
  function room(st, id) { var r = stage(st).rooms; for (var i = 0; i < r.length; i++) if (r[i].id === id) return r[i]; return null; }
  function kekkaiRoom(st) { var r = stage(st).rooms; for (var i = 0; i < r.length; i++) if (r[i].kekkai) return r[i]; return null; }
  function alive(m) { return !m.gone; }
  function canAct(m) { return !m.gone && !m.down; }
  function isTaboo(st, id) { return kaii(st).taboos.indexOf(id) >= 0; }
  function isUshi(st) { return st.hourIdx === D.USHI_HOUR_INDEX; }

  function adjacent(st, id) {
    var s = stage(st), a = room(st, id), out = [];
    if (!a) return out;
    s.rooms.forEach(function (b) {
      if (b.id !== id && b.f === a.f && Math.abs(b.x - a.x) + Math.abs(b.y - a.y) === 1) out.push(b.id);
    });
    s.stairs.forEach(function (p) {
      if (p[0] === id) out.push(p[1]);
      else if (p[1] === id) out.push(p[0]);
    });
    return out;
  }
  // 從 from 出發，maxStep 步以內可到的房間 → { roomId: 距離 }
  function distances(st, from, maxStep) {
    var dist = {}, q = [from];
    dist[from] = 0;
    while (q.length) {
      var x = q.shift();
      if (dist[x] >= maxStep) continue;
      adjacent(st, x).forEach(function (y) { if (dist[y] == null) { dist[y] = dist[x] + 1; q.push(y); } });
    }
    return dist;
  }
  function moveTargets(st, mi) {
    var m = st.members[mi], step = m.job === "student" ? 2 : 1, d = distances(st, m.room, step), out = [];
    Object.keys(d).forEach(function (k) { if (d[k] > 0) out.push({ room: k, dist: d[k] }); });
    return out;
  }
  function membersIn(st, roomId) {
    var out = [];
    st.members.forEach(function (m, i) { if (alive(m) && m.room === roomId) out.push(i); });
    return out;
  }
  function tierOf(st) {
    if (isUshi(st)) return 3;
    var t = 1;
    D.TIERS.forEach(function (x) { if (st.dread >= x.min) t = x.tier; });
    return t;
  }
  function accuseReady(st) {
    var k = kekkaiRoom(st), ok = false;
    for (var i = 0; i < st.members.length; i++) {
      var m = st.members[i];
      if (!canAct(m)) continue;
      if (m.room !== k.id) return false;
      ok = true;
    }
    return ok;
  }

  // 已確定的事實推出哪些怪異候選互相矛盾（只用確定的資訊：親身觸犯、親身確認無事、擲筊、禁忌線索、靈媒鑑定過的標籤）
  function candidates(st) {
    var tabooYes = {}, tabooNo = {}, tagYes = {}, tagNo = {}, tagSeen = {};
    Object.keys(st.revealed).forEach(function (t) { tabooYes[t] = 1; });
    Object.keys(st.safe).forEach(function (t) { tabooNo[t] = 1; });
    Object.keys(st.divined).forEach(function (t) { if (st.divined[t]) tabooYes[t] = 1; else tabooNo[t] = 1; });
    st.clues.forEach(function (c) {
      if (c.k === "taboo") tabooYes[c.taboo] = 1;
      else if (c.k === "tag") {
        if (c.seer) { if (c.fake) tagNo[c.tag] = 1; else tagYes[c.tag] = 1; }
        if (!(c.seer && c.fake)) tagSeen[c.tag] = 1;
      }
    });
    return D.KAII.map(function (k) {
      var bad = false, hits = 0;
      Object.keys(tabooYes).forEach(function (t) { if (k.taboos.indexOf(t) < 0) bad = true; });
      Object.keys(tabooNo).forEach(function (t) { if (k.taboos.indexOf(t) >= 0) bad = true; });
      Object.keys(tagYes).forEach(function (t) { if (k.tags.indexOf(t) < 0) bad = true; });
      Object.keys(tagNo).forEach(function (t) { if (k.tags.indexOf(t) >= 0) bad = true; });
      Object.keys(tagSeen).forEach(function (t) { if (k.tags.indexOf(t) >= 0) hits++; });
      return { id: k.id, contradicted: bad, tagHits: hits };
    });
  }

  // ---------------- 紀錄 ----------------
  function log(st, k, p) {
    st.log.push({ h: st.hourIdx, k: k, p: p || {} });
    if (st.log.length > 200) st.log.splice(0, st.log.length - 200);
  }

  // ---------------- 資源變動 ----------------
  function checkWipe(st) {
    if (st.result) return;
    if (!st.members.some(alive)) { st.result = "wipe"; st.phase = "end"; st.pending = null; log(st, "yo_log_wipe"); }
  }
  function loseNerve(st, mi, n) {
    var m = st.members[mi];
    if (n <= 0 || m.gone) return;
    if (m.items.salt > 0) { m.items.salt--; log(st, "yo_log_salt", { who: mi }); return; }
    m.nerve = Math.max(0, m.nerve - n);
    log(st, "yo_log_nerve", { who: mi, n: n });
    if (m.nerve <= 0) { m.gone = true; m.down = false; log(st, "yo_log_vanish", { who: mi }); checkWipe(st); }
  }
  function loseHp(st, mi, n) {
    var m = st.members[mi];
    if (n <= 0 || m.gone) return;
    var guarded = st.members.some(function (g, gi) { return gi !== mi && g.job === "guard" && canAct(g) && g.room === m.room; });
    if (guarded) { n -= 1; if (n <= 0) { log(st, "yo_log_guarded", { who: mi }); return; } }
    if (m.down) { log(st, "yo_log_down_hit", { who: mi }); loseNerve(st, mi, n); return; }   // §9 A11
    m.hp = Math.max(0, m.hp - n);
    log(st, "yo_log_hp", { who: mi, n: n });
    if (m.hp <= 0) { m.down = true; log(st, "yo_log_down", { who: mi }); }
  }
  function gain(st, mi, stat, n) {
    var m = st.members[mi];
    if (m.gone || n <= 0) return;
    if (stat === "hp") { m.hp = Math.min(m.maxHp, m.hp + n); if (m.hp > 0 && m.down) m.down = false; }
    else m.nerve = Math.min(m.maxNerve, m.nerve + n);
    log(st, "yo_log_gain_" + stat, { who: mi, n: n });
  }

  // 做了禁忌池中的行為 → 是今晚的禁忌就觸犯（膽量 −2、公開、怪異度 +1）；不是就記為「確認無事」。回傳是否觸犯。
  function checkTaboo(st, mi, taboo) {
    if (taboo === "ushi_voice" && !isUshi(st)) return false;
    if (isTaboo(st, taboo)) {
      st.revealed[taboo] = true;
      st.dread += 1;
      log(st, "yo_log_taboo", { who: mi, taboo: taboo });
      loseNerve(st, mi, TABOO_PENALTY);
      return true;
    }
    if (!st.safe[taboo]) { st.safe[taboo] = true; log(st, "yo_log_safe", { who: mi, taboo: taboo }); }
    return false;
  }

  // ---------------- 開局 ----------------
  // opts：{ seed?, stage?（不給＝隨機）, kaii?（測試用）, members: [{ job, name }] }
  function create(opts) {
    var st = {
      v: 1, seed: (opts.seed >>> 0) || ((Math.random() * 4294967296) >>> 0),
      stage: null, kaii: null, hourIdx: 0, dread: 0, phase: "act",
      members: [], cur: 0, ap: 0, apPer: 2,
      decks: {}, clues: [], revealed: {}, safe: {}, divined: {},
      pending: null, log: [], result: null, accuseFails: 0
    };
    st.stage = opts.stage && D.STAGE_BY_ID[opts.stage] ? opts.stage : pick(st, D.STAGES).id;
    st.kaii = opts.kaii && D.KAII_BY_ID[opts.kaii] ? opts.kaii : pick(st, D.KAII).id;
    var start = stage(st).rooms.filter(function (r) { return r.start; })[0];
    (opts.members || []).slice(0, 4).forEach(function (p) {
      var j = D.JOB_BY_ID[p.job] || D.JOBS[0];
      st.members.push({ job: j.id, name: p.name || "", hp: j.hp, maxHp: j.hp, nerve: j.nerve, maxNerve: j.nerve,
        room: start.id, items: { charm: 0, salt: 0, battery: 0 }, down: false, gone: false, usedSkill: false });
    });
    if (!st.members.length) throw new Error("no members");
    st.apPer = st.members.length === 1 ? 4 : st.members.length === 2 ? 3 : 2;   // §9 A10
    buildDecks(st);
    log(st, "yo_log_start", { stage: st.stage });
    beginHour(st);
    return st;
  }

  function buildDecks(st) {
    var k = kaii(st), cards = [], i;
    var trueTags = shuffle(st, k.tags.slice());
    for (i = 0; i < D.DECK.trueTag; i++) cards.push({ k: "tag", tag: trueTags[i % trueTags.length], fake: false });
    shuffle(st, k.taboos.slice()).slice(0, D.DECK.tabooClue).forEach(function (t) { cards.push({ k: "taboo", taboo: t }); });
    var others = shuffle(st, D.TAGS.filter(function (t) { return k.tags.indexOf(t.id) < 0; }).map(function (t) { return t.id; }));
    for (i = 0; i < D.DECK.fake; i++) cards.push({ k: "tag", tag: others[i], fake: true });
    D.DECK.items.forEach(function (it) { cards.push({ k: "item", item: it }); });
    for (i = 0; i < D.DECK.offering; i++) cards.push({ k: "offering" });
    var rooms = stage(st).rooms, total = rooms.length * 2;
    while (cards.length < total) cards.push({ k: "blank" });
    shuffle(st, cards);
    rooms.forEach(function (r, ri2) { st.decks[r.id] = [cards[ri2 * 2], cards[ri2 * 2 + 1]]; });
  }

  // ---------------- 流程 ----------------
  function firstActor(st, from) {
    for (var i = from; i < st.members.length; i++) if (canAct(st.members[i])) return i;
    return -1;
  }
  function beginHour(st) {
    st.phase = "act";
    st.cur = firstActor(st, 0);
    st.ap = st.apPer;
    log(st, "yo_log_hour", { hour: D.HOURS[st.hourIdx] });
    if (st.cur < 0) startEvent(st);
  }
  function nextActor(st) {
    if (st.result || st.pending) return;
    var n = firstActor(st, st.cur + 1);
    if (n < 0) { startEvent(st); return; }
    st.cur = n; st.ap = st.apPer;
  }
  function afterAction(st) {
    if (st.result || st.pending || st.phase !== "act") return;
    var m = st.members[st.cur];
    if (!m || !canAct(m) || st.ap <= 0) nextActor(st);
  }

  function startEvent(st) {
    if (st.result) return;
    st.phase = "event";
    var tier = tierOf(st), ev = pick(st, D.EVENTS);
    var living = []; st.members.forEach(function (m, i) { if (alive(m)) living.push(i); });
    if (!living.length) { checkWipe(st); return; }
    if (ev.room) {
      var rooms = []; living.forEach(function (i) { if (rooms.indexOf(st.members[i].room) < 0) rooms.push(st.members[i].room); });
      st.pending = { kind: "event", ev: ev.id, tier: tier, room: pick(st, rooms) };
    } else {
      var awake = living.filter(function (i) { return !st.members[i].down; });
      st.pending = { kind: "event", ev: ev.id, tier: tier, who: pick(st, awake.length ? awake : living) };
    }
    log(st, "yo_log_event", { ev: ev.id, tier: tier });
  }

  function eventOptions(st) {
    var p = st.pending;
    if (!p || p.kind !== "event") return [];
    var ev = D.EVENT_BY_ID[p.ev], out = [];
    if (ev.room) out.push("ok");
    else {
      out.push("risk", "safe");
      var m = st.members[p.who];
      if (ev.battery && m.items.battery > 0) out.push("battery");
      if (m.items.charm > 0) out.push("charm");
    }
    return out;
  }
  function purifier(st) {
    for (var i = 0; i < st.members.length; i++) {
      var m = st.members[i];
      if (m.job === "miko" && canAct(m) && !m.usedSkill) return i;
    }
    return -1;
  }

  function resolveEvent(st, opt) {
    var p = st.pending, ev = D.EVENT_BY_ID[p.ev], tier = p.tier;
    st.pending = null;
    if (ev.room) {
      membersIn(st, p.room).forEach(function (mi) {
        if (ev.hit === "hp") loseHp(st, mi, tier); else loseNerve(st, mi, tier);
      });
    } else if (opt === "charm") {
      st.members[p.who].items.charm--;
      log(st, "yo_log_charm_block", { who: p.who });
    } else if (opt === "battery") {
      st.members[p.who].items.battery--;
      log(st, "yo_log_battery", { who: p.who });
    } else if (opt === "risk") {
      var hit = checkTaboo(st, p.who, ev.risk.taboo);
      if (!hit && !st.members[p.who].gone) {
        if (ev.risk.gain === "clue") addTrueTagClue(st, p.who);
        else if (ev.risk.gain === "hp" || ev.risk.gain === "nerve") gain(st, p.who, ev.risk.gain, tier);
      }
    } else {
      if (ev.safe.stat === "hp") loseHp(st, p.who, tier);
      else if (ev.safe.stat === "nerve") loseNerve(st, p.who, tier);
    }
    endHour(st);
  }

  function endHour(st) {
    if (st.result) return;
    if (st.members.length > 1) {   // 單人遊玩不檢查「不可獨處」（設計文件 §5 註）
      st.members.forEach(function (m, i) {
        if (alive(m) && membersIn(st, m.room).length === 1) checkTaboo(st, i, "alone");
      });
      if (st.result) return;
    }
    st.dread += 1;
    st.hourIdx += 1;
    if (st.hourIdx >= D.HOURS.length) {
      st.result = "escape"; st.phase = "end";
      log(st, "yo_log_dawn");
      return;
    }
    beginHour(st);
  }

  // ---------------- 線索 ----------------
  function addClueFromCard(st, mi, card) {
    var m = st.members[mi];
    if (card.k === "tag") {
      st.clues.push({ k: "tag", tag: card.tag, fake: card.fake, seer: m.job === "medium", by: mi, h: st.hourIdx });
      log(st, m.job === "medium" ? (card.fake ? "yo_log_clue_fake_seen" : "yo_log_clue_true_seen") : "yo_log_clue", { who: mi, tag: card.tag });
    } else if (card.k === "taboo") {
      st.clues.push({ k: "taboo", taboo: card.taboo, by: mi, h: st.hourIdx });
      log(st, "yo_log_clue_taboo", { who: mi, taboo: card.taboo });
    }
  }
  function addTrueTagClue(st, mi) {
    addClueFromCard(st, mi, { k: "tag", tag: pick(st, kaii(st).tags), fake: false });
  }
  function resolveCard(st, mi, card) {
    var m = st.members[mi];
    if (card.k === "tag" || card.k === "taboo") addClueFromCard(st, mi, card);
    else if (card.k === "item") { m.items[card.item]++; log(st, "yo_log_item", { who: mi, item: card.item }); }
    else if (card.k === "offering") { st.pending = { kind: "offering", who: mi }; log(st, "yo_log_offering", { who: mi }); }
    else log(st, "yo_log_blank", { who: mi });
  }
  // 在有鏡子／水的房間搜索 → 觸犯檢查（§5）
  function roomTaboos(st, mi) {
    var r = room(st, st.members[mi].room);
    if (r.mirror) checkTaboo(st, mi, "mirror");
    if (r.water && !st.members[mi].gone) checkTaboo(st, mi, "water");
  }

  // ---------------- 行動 ----------------
  function err(e) { return { ok: false, err: e }; }

  function apply(st, ctrl, a) {
    if (!a || st.result) return err("over");
    var t = a.t;

    // 待決事項（事件選項、供品、取材挑卡）
    if (st.pending) {
      var p = st.pending;
      if (t === "purify" && p.kind === "event") {
        var pi = purifier(st);
        if (pi < 0) return err("no_purifier");
        st.members[pi].usedSkill = true;
        st.pending = null;
        log(st, "yo_log_purify", { who: pi });
        endHour(st);
        return { ok: true };
      }
      if (t !== "choose") return err("pending");
      if (p.kind === "event") {
        if (eventOptions(st).indexOf(a.opt) < 0) return err("bad_opt");
        resolveEvent(st, a.opt);
      } else if (p.kind === "offering") {
        st.pending = null;
        if (a.opt === "eat") {
          if (!checkTaboo(st, p.who, "offering")) gain(st, p.who, "hp", OFFERING_HP);
        } else log(st, "yo_log_offering_leave", { who: p.who });
        afterAction(st);
      } else if (p.kind === "pick") {
        var idx = a.opt === 1 ? 1 : 0;
        st.pending = null;
        st.decks[p.room].push(p.cards[1 - idx]);   // 沒選的那張放回房間
        resolveCard(st, p.who, p.cards[idx]);
        afterAction(st);
      }
      return { ok: true };
    }

    if (st.phase !== "act") return err("phase");
    var mi = st.cur, m = st.members[mi];
    if (!m || !canAct(m)) return err("no_actor");

    if (t === "pass") { log(st, "yo_log_pass", { who: mi }); st.ap = 0; afterAction(st); return { ok: true }; }

    if (t === "move") {
      var tg = moveTargets(st, mi).filter(function (x) { return x.room === a.to; })[0];
      if (!tg) return err("not_adjacent");
      st.ap--;
      m.room = a.to;
      log(st, "yo_log_move", { who: mi, room: a.to });
      if (tg.dist >= 2) checkTaboo(st, mi, "run");
    } else if (t === "search" || t === "interview") {
      var deck = st.decks[m.room];
      if (!deck.length) return err("empty");
      if (t === "interview" && m.job !== "reporter") return err("not_reporter");
      st.ap--;
      if (t === "interview") checkTaboo(st, mi, "photo");
      if (!m.gone) roomTaboos(st, mi);
      if (!m.gone) {
        if (t === "interview" && deck.length >= 2) {
          st.pending = { kind: "pick", who: mi, room: m.room, cards: [deck.shift(), deck.shift()] };
          log(st, "yo_log_interview", { who: mi });
        } else resolveCard(st, mi, deck.shift());
      }
    } else if (t === "rest") {
      var stat = a.stat === "hp" ? "hp" : "nerve";
      if ((stat === "hp" ? m.hp >= m.maxHp : m.nerve >= m.maxNerve)) return err("full");
      st.ap--;
      log(st, "yo_log_rest", { who: mi });
      checkTaboo(st, mi, "sleep");
      if (!m.gone) gain(st, mi, stat, 1);
    } else if (t === "ritual") {
      var target = st.members[a.target];
      if (m.items.charm <= 0) return err("no_charm");
      if (!target || target.gone || target.room !== m.room) return err("bad_target");
      st.ap--;
      m.items.charm--;
      log(st, "yo_log_ritual", { who: mi, target: a.target });
      checkTaboo(st, mi, "ushi_voice");
      if (!target.gone) gain(st, a.target, "nerve", RITUAL_NERVE);
    } else if (t === "divine") {
      if (m.job !== "taoist" || m.usedSkill) return err("no_skill");
      if (!D.TABOO_BY_ID[a.taboo]) return err("bad_taboo");
      st.ap--;
      m.usedSkill = true;
      st.divined[a.taboo] = isTaboo(st, a.taboo);
      log(st, st.divined[a.taboo] ? "yo_log_divine_yes" : "yo_log_divine_no", { who: mi, taboo: a.taboo });
      checkTaboo(st, mi, "ushi_voice");
    } else if (t === "lift") {
      var tm = st.members[a.target];
      if (!tm || tm.gone || !tm.down || tm.room !== m.room) return err("bad_target");
      st.ap--;
      tm.down = false; tm.hp = 1;
      log(st, "yo_log_lift", { who: mi, target: a.target });
    } else if (t === "accuse") {
      if (m.room !== kekkaiRoom(st).id || !accuseReady(st)) return err("not_ready");
      var tb = (a.taboos || []).filter(function (x, i, arr) { return D.TABOO_BY_ID[x] && arr.indexOf(x) === i; });
      if (!D.KAII_BY_ID[a.kaii] || tb.length !== 3) return err("bad_accuse");
      st.ap--;
      var right = tb.filter(function (x) { return isTaboo(st, x); }).length;
      st.lastAccuse = { kaii: a.kaii, taboos: tb, right: a.kaii === st.kaii ? right : 0 };
      if (a.kaii === st.kaii && right >= ACCUSE_NEED) {
        st.result = "seal"; st.phase = "end";
        log(st, "yo_log_seal", { kaii: a.kaii });
        return { ok: true };
      }
      st.accuseFails++;
      log(st, "yo_log_rampage");
      st.dread += ACCUSE_DREAD;
      st.members.forEach(function (x, i) { if (alive(x)) loseNerve(st, i, ACCUSE_PENALTY); });
      if (!st.result) startEvent(st);   // §9 A7：時段立刻結束（直接進入怪異事件）
      return { ok: true };
    } else return err("unknown");

    afterAction(st);
    return { ok: true };
  }

  root.PriTestYoiCore = {
    create: create, apply: apply,
    stage: stage, kaii: kaii, room: room, kekkaiRoom: kekkaiRoom,
    adjacent: adjacent, moveTargets: moveTargets, membersIn: membersIn,
    tierOf: tierOf, accuseReady: accuseReady, candidates: candidates,
    eventOptions: eventOptions, purifier: purifier, canAct: canAct,
    ACCUSE_NEED: ACCUSE_NEED
  };
  if (typeof module !== "undefined" && module.exports) module.exports = root.PriTestYoiCore;
})();
