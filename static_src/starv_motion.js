// 明星經紀 starV：動圖圖鑑「御三家」解鎖邏輯（規格 docs/superpowers/specs/2026-11-15-starv-motion-codex.md）。
// 純邏輯、不碰 DOM，可在 node 載入。全部經由 Core.hook() 掛上；狀態放在 st.codex.motion
// （codex 在新紀元會保留，所以已解鎖的動作跨局保存；「重新開始」時由 starv_motion_ui.js 的鏡射補回）。
//   st.codex.motion = { lv: { s1: 0〜3, … }, pick: 本局選的御三家 ID 或 null, pickEra: 選擇時的紀元, picks: [{ era, id }] }
(function () {
  "use strict";

  var root = typeof window !== "undefined" ? window : globalThis;
  var D = root.PriTestStarvData;
  var Core = root.PriTestStarvCore;
  if (!D || !D.MOTION || !Core || !Core.hook) return;
  var M = D.MOTION;
  var MAX = 3;

  function ensure(st) {
    if (!st.codex) return null;
    var m = st.codex.motion;
    if (!m || typeof m !== "object") m = st.codex.motion = { lv: {}, pick: null, pickEra: st.era || 1, picks: [] };
    if (!m.lv || typeof m.lv !== "object") m.lv = {};
    if (!Array.isArray(m.picks)) m.picks = [];
    if (m.pick && !M.BY_ID[m.pick]) m.pick = null;
    M.STARTERS.forEach(function (s) {
      var v = Number(m.lv[s.id]);
      m.lv[s.id] = isFinite(v) ? Math.max(0, Math.min(MAX, Math.floor(v))) : 0;
    });
    return m;
  }

  // 本局進行到第幾階段：0＝還沒選；1＝已選；2＝本紀元第 1 次頒獎典禮已舉行；3＝再達到公司 Lv midLevel
  function stage(st) {
    var m = ensure(st);
    if (!m || !m.pick) return 0;
    if (!st.awards || !st.awards.history || !st.awards.history.length) return 1;
    return st.company.level >= M.midLevel ? 3 : 2;
  }

  // 依目前階段把應得的動作補齊（只升不降），每解鎖一個動作記一筆日誌
  function sync(st) {
    var m = ensure(st), s = stage(st);
    if (!s) return 0;
    var got = 0;
    M.STARTERS.forEach(function (x) {
      var want = x.id === m.pick ? s : s - 1;
      while (m.lv[x.id] < Math.min(MAX, want)) {
        m.lv[x.id]++;
        got++;
        Core._int.log(st, "motion_unlock", { sid: x.id, n: m.lv[x.id] });
      }
    });
    return got;
  }

  function choose(st, id) {
    var m = ensure(st);
    if (!m) return "noState";
    if (!M.BY_ID[id]) return "noStarter";
    if (m.pick) return "motionPicked";
    m.pick = id;
    m.pickEra = st.era || 1;
    m.picks.push({ era: m.pickEra, id: id });
    sync(st);
    return null;
  }

  // 把外部保存的解鎖等級併進來（取較高者）；回傳是否有變動
  function merge(st, lv) {
    var m = ensure(st), changed = false;
    if (!m || !lv) return false;
    M.STARTERS.forEach(function (s) {
      var v = Math.max(0, Math.min(MAX, Math.floor(Number(lv[s.id]) || 0)));
      if (v > m.lv[s.id]) { m.lv[s.id] = v; changed = true; }
    });
    return changed;
  }

  function level(st, id) { var m = ensure(st); return m ? m.lv[id] || 0 : 0; }
  function total(st) { var m = ensure(st), n = 0; if (m) M.STARTERS.forEach(function (s) { n += m.lv[s.id]; }); return n; }
  function full(st) { var m = ensure(st), n = 0; if (m) M.STARTERS.forEach(function (s) { if (m.lv[s.id] >= MAX) n++; }); return n; }

  Core.hook("create", function (st) { ensure(st); });
  Core.hook("migrate", function (st) { ensure(st); });
  // 新紀元＝新的一局：重新選御三家，階段從頭判定（已解鎖的動作保留）
  Core.hook("newEra", function (st) { var m = ensure(st); if (m) { m.pick = null; m.pickEra = st.era; } });
  // 每天結算：頒獎典禮、升級都在 advance 裡發生，當天就補齊（在成就判定之前）
  Core.hook("day", function (st) { sync(st); });

  // 成就判定類型（starv_achievements_4.js 使用）
  if (Core.achCheck) {
    Core.achCheck("motions", total);
    Core.achCheck("motionFull", full);
  }

  root.PriTestStarvMotion = {
    MAX: MAX, ensure: ensure, stage: stage, sync: sync, choose: choose, merge: merge,
    level: level, total: total, full: full,
    needsPick: function (st) { var m = ensure(st); return !!m && !m.pick; }
  };
})();
