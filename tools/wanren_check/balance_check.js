// ============================================================================
// 萬人迷（wanren）平衡模擬（不用瀏覽器）：用幾種策略從頭玩到學期末，印出成績、交往人數、粉絲、修羅場、稱號與各女主角好感。
// 執行：node tools/wanren_check/balance_check.js
// ============================================================================
global.window = { localStorage: { s:{}, getItem(k){return this.s[k]||null}, setItem(k,v){this.s[k]=v}, removeItem(k){delete this.s[k]} } };
var ROOT = require("path").join(__dirname, "..", "..");
require(ROOT + "/static_src/wanren_data.js");
require(ROOT + "/static_src/wanren_data2.js");
require(ROOT + "/static_src/wanren_data3.js");
require(ROOT + "/static_src/wanren_data4.js");
require(ROOT + "/static_src/wanren_data5.js");
require(ROOT + "/static_src/wanren_data6.js");
require(ROOT + "/static_src/wanren_core.js");
var C = window.PriTestWanrenCore, D = window.PriTestWanrenData;
function play(seed, strat, len, ng) {
  var s = C.newGame({ seed: seed, length: len || "full", name: "測試", inherit: !!ng });
  var dating = [];
  var guard = 0;
  while (s.phase !== "report" && guard++ < 20000) {
    if (s.phase === "yearreport") { var yr = C.report(s, s.yearReport); console.log("  第" + (s.yearReport + 1) + "學年", "grade", yr.grade, "lovers", yr.lovers, "study", Math.round(s.stats.study), "charm", Math.round(s.stats.charm)); C.nextYear(s); continue; }
    while (s.events.length) C.resolveEvent(s, strat === "harem" ? 2 : 0);
    if (s.phase === "morning") { s.today.admirers.forEach(function (a, i) { C.answerAdmirer(s, i, strat === "cold" ? 2 : 0); }); C.finishMorning(s); continue; }
    if (s.phase === "class") { C.doClass(s, s.stats.stamina < 30 ? "doze" : "focus"); continue; }
    if (s.phase === "exam") { C.doExam(s, true); continue; }
    if (s.phase === "free") {
      // 社團活動日先去社團
      if (s.club && C.canClubAction(s, D.CLUB_BY_ID[s.club].loc)) C.clubAction(s, D.CLUB_BY_ID[s.club].loc);
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
      if (s.club && C.canClubAction(s, D.CLUB_BY_ID[s.club].loc)) C.clubAction(s, D.CLUB_BY_ID[s.club].loc);
      if (s.today.meetup && !s.today.meetup.done) C.arrive(s, s.today.meetup.loc);
      if (Math.random() < 0.3) C.encounter(s, "plaza");
      while (s.events.length) C.resolveEvent(s, 0);
      if (s.stats.stamina < 30 && s.today.ap > 0) C.locAction(s, "infirmary");
      C.checkAchievements(s);
      C.endFree(s); continue;
    }
    if (s.phase === "evening") {
      if (s.today.date) { var hd = D.HEROINE_BY_ID[s.today.date]; var spot = C.dateSpots(s).filter(d => hd.dates.like.indexOf(d.id) >= 0 && d.cost <= s.stats.money)[0] || C.dateSpots(s)[0]; var r = C.startDate(s, spot.id); if (r && r.moment) { var g = 0; while (C.dateMoment(s) && g++ < 5) C.answerDate(s, C.skillAnswer(s) && Math.random() < 0.3 ? "skill" : (Math.random() < 0.5 ? hd.moment : r.mood.pref)); } else C.cancelDate(s); }
      if (s.phase === "evening") C.doEvening(s, s.stats.money < 3000 ? "work" : s.stats.stamina < 40 ? "rest" : ["study", "gym", "speech", "cookpractice", "instrument"][s.day % 5]);
    }
    if (s.phase === "night" || s.phase === "evening") C.endDay(s);
  }
  var r = C.report(s);
  console.log("  skills", JSON.stringify(s.skills), "club", s.club, "wins", s.clubWins, "rel", r.rows.filter(x => x.dating).map(x => x.name.split(" ")[1] + x.rel).join(","), "enc", s.encounters, "meetup", s.meetupOk, "hidden", s.hiddenTalks, "story", s.storySeen, "trueEnd", r.trueEnd);
  console.log(seed, strat, len || "full", "days", s.length, "grade", r.grade, r.letter, "lovers", r.lovers, "met", r.met, "fans", r.fans, "shura", r.shura, "breakups", r.breakups, "title", r.title, "score", r.score, r.rank, "stats", JSON.stringify(s.stats));
  console.log("  aff", r.rows.map(x => x.name.split(" ")[1] + ":" + x.aff + (x.dating ? "♥" : "") + "q" + x.quest).join(" "));
}
[1, 2].forEach(s => play(s, "normal"));
// 二周目：繼承＋隱藏學妹
play(3, "normal", "full", true);
play(4, "cold"); play(5, "harem");
play(6, "normal", "year"); play(7, "normal", "trial");
