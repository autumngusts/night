// 深夜居酒屋（izakaya）：劇情引擎。場景資料在 izakaya_story_*.js（push 進 window.PriTestIzakayaScenes）。
// 觸發條件（Cond）、選項效果（Fx）的欄位見 docs/superpowers/plans/2026-11-09-izakaya-1a.md Task 6。
// 多人時一般場景全員投票（平手取房主），約會等私密場景（priv）只有那位玩家選。
(function () {
  "use strict";
  var D = window.PriTestIzakayaData, C = D.C;
  window.PriTestIzakayaScenes = window.PriTestIzakayaScenes || [];
  function Core() { return window.PriTestIzakayaCore; }

  var RELS = {
    ex_band: C("前團員", "元バンドメンバー"), sister: C("姊妹", "姉妹"), rival: C("死對頭", "宿敵"), ex_lover: C("前戀人", "元恋人"),
    boss: C("老闆與部下", "上司と部下"), friend: C("好友", "親友"), debt: C("欠債", "借金"), secret: C("祕密", "秘密")
  };
  function all() { return window.PriTestIzakayaScenes; }
  function byId(id) { var a = all(); for (var i = 0; i < a.length; i++) if (a[i].id === id) return a[i]; return null; }
  function has(list, x) { return list && list.indexOf(x) >= 0; }
  function maxAff(s, cid, pid) {
    if (pid) return s.players[pid].aff[cid] || 0;
    var m = 0; s.order.forEach(function (p) { m = Math.max(m, s.players[p].aff[cid] || 0); }); return m;
  }
  function condOk(s, sc, ctx) {
    if (sc.at !== ctx.at || s.story.seen[sc.id]) return false;
    if (ctx.who && !has(sc.who, ctx.who)) return false;
    var c = sc.cond || {}, st = s.story;
    if (c.day && (s.day < c.day[0] || s.day > c.day[1])) return false;
    if (c.star && s.maxStar < c.star) return false;
    if (c.aff && !Object.keys(c.aff).every(function (k) { return maxAff(s, k, sc.priv ? ctx.pid : null) >= c.aff[k]; })) return false;
    if (c.seen && !c.seen.every(function (k) { return st.seen[k]; })) return false;
    if (c.notSeen && c.notSeen.some(function (k) { return st.seen[k]; })) return false;
    if (c.flag && !c.flag.every(function (k) { return st.flags[k]; })) return false;
    if (c.notFlag && c.notFlag.some(function (k) { return st.flags[k]; })) return false;
    if (c.present && !c.present.every(function (k) { return has(ctx.present, k); })) return false;
    if (c.arc && !Object.keys(c.arc).every(function (k) { return (st.arcs[k] || 0) >= c.arc[k]; })) return false;
    if (c.spot && c.spot !== ctx.spot) return false;
    if (c.staff && s.staff.hired !== c.staff) return false;
    return true;
  }
  function eligible(s, ctx) {
    var best = null;
    all().forEach(function (sc) { if (condOk(s, sc, ctx) && (!best || (sc.pri || 0) > (best.pri || 0))) best = sc; });
    return best;
  }
  function begin(s, id, pid) { s.story.cur = { id: id, pid: pid || null, votes: {} }; }
  function voters(s) { var cur = s.story.cur; return cur.pid ? [cur.pid] : s.order.slice(); }
  function choose(s, pid, c) {
    var cur = s.story.cur;
    if (!cur || voters(s).indexOf(pid) < 0) return false;
    var sc = byId(cur.id), n = sc.ch ? sc.ch.length : 1;
    if (!(c >= 0 && c < n)) return false;
    cur.votes[pid] = c;
    if (voters(s).every(function (p) { return cur.votes[p] !== undefined; })) resolve(s);
    return true;
  }
  function force(s, pid) {
    var cur = s.story.cur;
    if (!cur || pid !== s.order[0] || !Object.keys(cur.votes).length) return false;
    resolve(s); return true;
  }
  function resolve(s) {
    var cur = s.story.cur, sc = byId(cur.id), tally = {}, top = -1, topN = 0, tied = [];
    Object.keys(cur.votes).forEach(function (p) { var c = cur.votes[p]; tally[c] = (tally[c] || 0) + 1; });
    Object.keys(tally).forEach(function (k) {
      var n = tally[k];
      if (n > topN) { topN = n; tied = [+k]; } else if (n === topN) tied.push(+k);
    });
    var hv = cur.votes[s.order[0]];
    top = tied.length === 1 ? tied[0] : (tied.indexOf(hv) >= 0 ? hv : Math.min.apply(null, tied));
    var fx = sc.ch && sc.ch[top] ? sc.ch[top].fx || {} : {};
    apply(s, fx, cur.pid);
    s.story.seen[sc.id] = 1;
    s.story.last = { id: sc.id, c: top };
    s.story.cur = null;
    if (sc.next) begin(s, sc.next, cur.pid);
  }
  function apply(s, fx, pid) {
    var st = s.story, K = Core();
    if (fx.aff) Object.keys(fx.aff).forEach(function (cid) { (pid ? [pid] : s.order).forEach(function (p) { K.addAff(s, p, cid, fx.aff[cid]); }); });
    (fx.flag || []).forEach(function (k) { st.flags[k] = 1; });
    (fx.unflag || []).forEach(function (k) { delete st.flags[k]; });
    if (fx.arc) Object.keys(fx.arc).forEach(function (k) { st.arcs[k] = (st.arcs[k] || 0) + fx.arc[k]; });
    (fx.link || []).forEach(function (l) { st.links[[l[0], l[1]].sort().join("|")] = l[2]; });
    if (fx.dish && D.DISHES[fx.dish]) s.known[fx.dish] = 1;
    if (fx.cash) s.cash += fx.cash;
    if (fx.rep) s.rep = Math.max(0, s.rep + fx.rep);
    if (fx.met) s.staff.met[fx.met] = 1;
  }

  window.PriTestIzakayaStory = { RELS: RELS, all: all, byId: byId, condOk: condOk, eligible: eligible, begin: begin, choose: choose, force: force, resolve: resolve, apply: apply };
})();
