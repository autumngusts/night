// 明星經紀 starV：3D 演出的播放時機（規格 §16）。
// 即時結算（不是離線補算）時：A／S 級工作完成、大型企劃每個階段與完成 → 排入佇列，沒有其他彈窗時依序播放；
// 作品列表可以重看任何作品；頒獎典禮的我方得獎者可以上台。
(function () {
  "use strict";

  var D = window.PriTestStarvData;
  var Core = window.PriTestStarvCore;
  var UI = window.PriTestStarvUI;
  var Stage = window.PriTestStarvStage3D;
  var MAX_QUEUE = 2;
  var queue = [];
  var playing = false;

  function performer(a) { return { look: a.look, rarity: a.rarity, gender: a.gender, name: UI.name(a) }; }
  function performers(st, ids) { return ids.map(function (id) { return Core.artistById(st, id); }).filter(Boolean).map(performer); }

  function enqueue(job) {
    queue.push(job);
    while (queue.length > MAX_QUEUE) queue.shift();
  }
  function pump(App) {
    if (playing || !queue.length || UI.modalIsOpen()) return;
    var job = queue.shift(), st = App.st();
    var opts = job(st);
    if (!opts || !opts.performers.length) { pump(App); return; }
    playing = true;
    Stage.play(opts).then(function () { playing = false; App.render(); });
  }

  function onLogs(App, rep) {
    if (!rep || rep.days >= 3) return;
    rep.logs.forEach(function (e) {
      var d = e.data || {};
      if (e.type === "job_done" && (d.tier === "A" || d.tier === "S")) {
        enqueue(function (st) {
          return { kind: "job", dir: d.dir, performers: performers(st, d.aids || []), title: Core.jobTitle({ dir: d.dir, title: d.title }, UI.lang()),
            sub: UI.dirName(d.dir) + "・" + d.tier, result: d.result, stars: d.stars, seed: e.seq };
        });
      } else if (e.type === "project_stage" && d.members) {
        enqueue(function (st) {
          var p = D.PROJECT_BY_ID[d.project], stage = p && p.stages[d.stage];
          return { kind: "project", dir: d.dir, performers: performers(st, d.members), title: p ? UI.L(p.name) : "",
            sub: stage ? UI.L(stage.name) : "", result: d.result, seed: e.seq };
        });
      } else if (e.type === "project_done") {
        enqueue(function (st) {
          var q = null;
          st.projectQueue.forEach(function (x) { if (x.project === d.project) q = x; });
          var p = D.PROJECT_BY_ID[d.project];
          var members = q ? q.members : [];
          var first = Core.artistById(st, members[0]);
          return { kind: "project", dir: first ? first.dir : "singer", performers: performers(st, members), title: p ? UI.L(p.name) : "",
            result: d.result === "normal" ? "normal" : d.result, duration: 22, seed: e.seq };
        });
      }
    });
    pump(App);
  }

  function playWork(App, a, w) {
    return Stage.play({ kind: "replay", dir: w.dir, performers: [performer(a)], title: Core.jobTitle(w, UI.lang()),
      sub: UI.dirName(w.dir) + "・" + w.tier, result: w.result, stars: w.stars, seed: w.day });
  }

  function playAward(App, nominee, awardName) {
    var st = App.st(), list = [];
    if (nominee.kind === "artist" || nominee.kind === "work") list = performers(st, [nominee.aid]);
    else if (nominee.kind === "group") st.groups.forEach(function (g) { if (g.id === nominee.gid) list = performers(st, g.members); });
    else if (nominee.kind === "company") list = st.artists.slice(0, 3).map(performer);
    if (!list.length) return null;
    return Stage.play({ kind: "awards", dir: "singer", performers: list, title: awardName, result: "great" });
  }

  UI.addLogWatcher(onLogs);
  UI.addExtra(function (App) { if (queue.length && !playing) setTimeout(function () { pump(App); }, 0); return null; });

  window.PriTestStarvStageUI = { onLogs: onLogs, playWork: playWork, playAward: playAward };
})();
