// 賽狗賽狗（saigo）：連線房間的 WIN5（五場連勝）與冠軍大會（2026-11-05 使用者指定，參考 JRA 的 WIN5 與賽馬娘的チャンピオンズミーティング）。
// 這裡只有純計算（不碰 DOM、不碰 Firebase），房間協定在 saigo_net.js，畫面在 saigo.js。
//
// WIN5：房主開啟後，連續發佈的 5 張出賽表是同一輪的第 1〜5 場。第 1 場開跑前花 W5_COST 房間籌碼買一張，
//   每場開跑前選一隻冠軍；5 場全中的人平分彩池。彩池＝這一輪的買入 × W5_TAKE＋上一輪沒人中的累積。
//   某一場沒有結果（房主沒跑就發佈下一張）時，下一張仍算同一場，不會跳號。
// 冠軍大會：預賽 A → 預賽 B → 敗部復活 → 決賽。房主開始時把大家派的狗輪流分到兩組預賽，不足的由 NPC 補上；
//   預賽前 q 名直接進決賽，接下來 rep 名進敗部復活，敗部復活前 2 名進決賽。晉級的狗（含 NPC）原樣帶到下一場。
//   關卡賽 6 隻：q 2、rep 3（2＋2＋2＝6）；真賽狗 8 隻：q 3、rep 4（3＋3＋2＝8）。決賽獎金 × CUP_FINAL_PRIZE。
(function () {
  "use strict";

  var W5_COST = 1000, W5_TAKE = 0.7, W5_LEGS = 5;
  var CUP = { classic: { field: 6, q: 2, rep: 3 }, real: { field: 8, q: 3, rep: 4 } };
  var CUP_FINAL_PRIZE = 3, REP_Q = 2;
  var STAGES = ["h1", "h2", "rep", "final", "done"];

  // ---------------- WIN5 ----------------
  // picks：{ 場: 枠 }、res：{ 場: 冠軍枠 }。到第 upto 場之前（有結果的場次）都中＝還活著
  function w5Alive(picks, res, upto) {
    for (var leg = 1; leg < upto; leg++) {
      if (res[leg] === undefined || res[leg] === null) return false;
      if (!picks || picks[leg] === undefined || Number(picks[leg]) !== Number(res[leg])) return false;
    }
    return true;
  }
  // players：{ pid: { picks } }（這一輪有買的人）。回傳 { pot, winners: [pid], pay, carry }
  function w5Settle(players, res, carry) {
    var ids = Object.keys(players || {}), pot = Math.max(0, Math.round(carry || 0)) + Math.floor(ids.length * W5_COST * W5_TAKE);
    var winners = ids.filter(function (pid) { return w5Alive(players[pid].picks, res, W5_LEGS + 1); }).sort();
    if (!winners.length) return { pot: pot, winners: [], pay: 0, carry: pot };
    var pay = Math.floor(pot / winners.length);
    return { pot: pot, winners: winners, pay: pay, carry: pot - pay * winners.length };
  }
  // 房主發佈下一張出賽表時的場次：w5＝{ ser, leg, res }（沒有／已經跑完 5 場＝新的一輪）
  function w5NextLeg(w5) {
    if (!w5 || !w5.ser || !w5.leg) return { ser: ((w5 && w5.ser) || 0) + 1, leg: 1, fresh: true };
    var res = w5.res || {};
    if (res[w5.leg] === undefined || res[w5.leg] === null) return { ser: w5.ser, leg: w5.leg, fresh: false };   // 上一場還沒跑：同一場
    if (w5.leg >= W5_LEGS) return { ser: w5.ser + 1, leg: 1, fresh: true };
    return { ser: w5.ser, leg: w5.leg + 1, fresh: false };
  }

  // ---------------- 冠軍大會 ----------------
  function conf(mode) { return CUP[mode === "real" ? "real" : "classic"]; }
  // 出走表上的狗 → 下一場的出賽資料（NPC 也一樣帶過去）
  function dogToEntry(d) {
    var e = { breed: d.breed, name: d.name, train: d.train || {}, lv: d.lv || 0, mood: d.mood, fatigue: 0, best: d.best || "", style: d.style || "",
      skills: (d.skills || []).slice(), line: d.line || "", owner: d.owner || "", ownerName: d.ownerName || (d.cpu ? "CPU" : ""), dogId: d.dogId || "" };
    if (d.cpu || d.npc) e.npc = 1;
    if (d.rival) e.rival = d.rival;
    if (d.ownerPid) e.ownerPid = d.ownerPid;
    return e;
  }
  // 把大家的狗（lists＝每個玩家的狗陣列）輪流分到兩組預賽，每組最多 field 隻
  function split(lists, mode) {
    var c = conf(mode), all = [], h = [[], []];
    var most = 0;
    lists.forEach(function (l) { most = Math.max(most, l.length); });
    for (var r = 0; r < most; r++) lists.forEach(function (l) { if (l[r]) all.push(l[r]); });
    all.forEach(function (e, i) { var g = h[i % 2]; if (g.length < c.field) g.push(e); });
    return h;
  }
  function start(id, mode, cls, lists) {
    var h = split(lists, mode);
    return { id: id, mode: mode === "real" ? "real" : "classic", cls: cls || "open", stage: "h1", h1: h[0], h2: h[1], q1: [], r1: [], q2: [], r2: [], qr: [], champ: null, podium: [] };
  }
  // 這一關要出賽的狗
  function entriesFor(cup) {
    if (!cup) return [];
    if (cup.stage === "h1") return cup.h1 || [];
    if (cup.stage === "h2") return cup.h2 || [];
    if (cup.stage === "rep") return (cup.r1 || []).concat(cup.r2 || []);
    if (cup.stage === "final") return (cup.q1 || []).concat(cup.q2 || [], cup.qr || []);
    return [];
  }
  // 這一關跑完：依名次決定晉級，回傳新的狀態（不改原本的物件）
  function advance(cup, card, order) {
    var c = conf(cup.mode), nx = JSON.parse(JSON.stringify(cup)), es = order.map(function (i) { return dogToEntry(card.dogs[i]); });
    if (cup.stage === "h1") { nx.q1 = es.slice(0, c.q); nx.r1 = es.slice(c.q, c.q + c.rep); nx.stage = "h2"; }
    else if (cup.stage === "h2") { nx.q2 = es.slice(0, c.q); nx.r2 = es.slice(c.q, c.q + c.rep); nx.stage = "rep"; }
    else if (cup.stage === "rep") { nx.qr = es.slice(0, REP_Q); nx.stage = "final"; }
    else if (cup.stage === "final") { nx.champ = es[0]; nx.podium = es.slice(0, 3).map(function (e) { return { name: e.name, owner: e.ownerName || "", breed: e.breed }; }); nx.stage = "done"; }
    return nx;
  }

  window.PriTestSaigoCup = {
    W5_COST: W5_COST, W5_TAKE: W5_TAKE, W5_LEGS: W5_LEGS, CUP: CUP, CUP_FINAL_PRIZE: CUP_FINAL_PRIZE, REP_Q: REP_Q, STAGES: STAGES,
    w5Alive: w5Alive, w5Settle: w5Settle, w5NextLeg: w5NextLeg,
    conf: conf, dogToEntry: dogToEntry, split: split, start: start, entriesFor: entriesFor, advance: advance
  };
})();
