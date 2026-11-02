// ============================================================================
// 萬人迷（wanren）平衡模擬（不用瀏覽器）：用幾種策略從頭玩到學期末，印出成績、交往人數、粉絲、修羅場、稱號與各女主角好感。
// 執行：node tools/wanren_check/balance_check.js
// ============================================================================
global.window = { localStorage: { s:{}, getItem(k){return this.s[k]||null}, setItem(k,v){this.s[k]=v}, removeItem(k){delete this.s[k]} } };
var ROOT = require("path").join(__dirname, "..", "..");
require(ROOT + "/static_src/wanren_data.js");
require(ROOT + "/static_src/wanren_core.js");
var C = window.PriTestWanrenCore, D = window.PriTestWanrenData;
function play(seed, strat) {
  var s = C.newGame({ seed: seed, length: "normal", name: "測試" });
  var guard = 0;
  while (s.phase !== "report" && guard++ < 2000) {
    while (s.events.length) C.resolveEvent(s, strat === "harem" ? 2 : 0);
    if (s.phase === "morning") { s.today.admirers.forEach(function (a, i) { C.answerAdmirer(s, i, strat === "cold" ? 2 : 0); }); C.finishMorning(s); continue; }
    if (s.phase === "class") { C.doClass(s, s.stats.stamina < 30 ? "doze" : "focus"); continue; }
    if (s.phase === "exam") { C.doExam(s, true); continue; }
    if (s.phase === "free") {
      // 走遍各地點：任務 → 告白 → 送禮 → 聊天
      var locs = D.LOCATIONS.map(l => l.id);
      for (var li = 0; li < locs.length && s.today.ap > 0; li++) {
        var loc = locs[li];
        C.locQuests(s, loc).forEach(h => C.doQuest(s, h, loc));
        C.heroinesAt(s, loc).forEach(function (h) {
          if (s.today.ap <= 0) return;
          if (C.canConfess(s, h)) { C.confess(s, h); return; }
          var q = C.questOf(s, h); if (q && C.reqMet(s, q.req, loc)) { C.doQuest(s, h, loc); return; }
          if (q && q.req.type === "item" && s.stats.money > D.ITEM_BY_ID[q.req.item].price) C.buy(s, q.req.item);
          if (!s.today.date && C.canInvite(s, h) && Math.random() < 0.5) { C.invite(s, h); return; }
          var tps = C.talkTopics(s, h); var best = tps.filter(t => C.topicPref(h, t) === "like")[0] || tps.filter(t => C.topicPref(h, t) === "mid")[0] || tps[0];
          C.talk(s, h, best);
        });
      }
      if (s.stats.stamina < 30 && s.today.ap > 0) C.locAction(s, "infirmary");
      C.endFree(s); continue;
    }
    if (s.phase === "evening") {
      if (s.today.date) { var hd = D.HEROINE_BY_ID[s.today.date]; var spot = C.dateSpots(s).filter(d => hd.dates.like.indexOf(d.id) >= 0 && d.cost <= s.stats.money)[0] || C.dateSpots(s)[0]; var r = C.startDate(s, spot.id); if (r && r.moment) C.finishDate(s, hd.moment); else C.cancelDate(s); }
      if (s.phase === "evening") C.doEvening(s, s.stats.money < 3000 ? "work" : s.stats.stamina < 40 ? "rest" : (s.day % 2 ? "study" : "gym"));
    }
    if (s.phase === "night" || s.phase === "evening") C.endDay(s);
  }
  var r = C.report(s);
  var h=s.history[25]; console.log("  day26", h.study, h.charm); console.log(seed, strat, "grade", r.grade, r.letter, "lovers", r.lovers, "met", r.met, "fans", r.fans, "shura", r.shura, "breakups", r.breakups, "title", r.title, "score", r.score, r.rank, "stats", JSON.stringify(s.stats));
  console.log("  aff", r.rows.map(x => x.name.split(" ")[1] + ":" + x.aff + (x.dating ? "♥" : "") + "q" + x.quest).join(" "));
}
[1, 2, 3].forEach(s => play(s, "normal"));
play(4, "cold"); play(5, "harem");
