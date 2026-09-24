// 遺物記憶（2026-09-24新增，設計文件 docs/superpowers/specs/2026-09-24-relic-memory-design.md）：
// 純函式層——大小擲骰、效果抽選、里程碑計算、100 上限合併。不碰 DOM／Firebase／角色物件，
// 由 midnight.js 呼叫；可直接在 node 以 vm 載入測試（tools/midnight_check/relic_memory_unit_check.js）。
(function () {
  "use strict";

  var SIZE_EFFECT_COUNT = { s: 1, m: 2, l: 3 };
  var MAX_STORED = 100;
  var MAX_LOADOUT = 3;
  var CODE_RE = /^[A-Z0-9]{5}$/;
  var MILESTONE_STEP = 3; // 板塊踏破／強敵擊殺每 3 個發一次

  function isValidCode(code) {
    return typeof code === "string" && CODE_RE.test(code);
  }

  function normalizeCode(raw) {
    return String(raw || "").replace(/\s+/g, "").toUpperCase();
  }

  function smallOrMid(rand) {
    return rand() < 0.8 ? "s" : "m";
  }

  function midOrLarge(rand) {
    return rand() < 0.6 ? "m" : "l";
  }

  // 使用者明確規格的獲得表（見設計文件 §3）。
  function grantSizes(kind, rand) {
    if (kind === "start") return ["s"];
    if (kind === "tiles" || kind === "strong") return [smallOrMid(rand)];
    if (kind === "day1") return [midOrLarge(rand)];
    if (kind === "day2") return ["m", midOrLarge(rand)];
    if (kind === "boss") return rand() < 0.5 ? ["l", "l"] : ["l"];
    return [];
  }

  function rollEffects(size, effectIds, rand) {
    var pool = effectIds.slice();
    var n = Math.min(SIZE_EFFECT_COUNT[size] || 1, pool.length);
    var out = [];
    for (var i = 0; i < n; i++) {
      var idx = Math.min(pool.length - 1, Math.floor(rand() * pool.length));
      out.push(pool.splice(idx, 1)[0]);
    }
    return out;
  }

  function randomHex16(rand) {
    var s = "";
    for (var i = 0; i < 16; i++) s += Math.floor(rand() * 16).toString(16);
    return s;
  }

  function newMemory(size, effectIds, source, rand, now) {
    return {
      memId: "m" + randomHex16(rand),
      size: size,
      effects: rollEffects(size, effectIds, rand),
      createdAt: now,
      favorite: false,
      source: source,
    };
  }

  function milestoneGrantKeys(tilesCleared, strongKilled) {
    var keys = [];
    var i;
    for (i = 1; i <= Math.floor(tilesCleared / MILESTONE_STEP); i++) keys.push("tiles" + i);
    for (i = 1; i <= Math.floor(strongKilled / MILESTONE_STEP); i++) keys.push("strong" + i);
    return keys;
  }

  // final review C1（2026-09-24）：重新開始一輪（handleRestartCycle）時，fieldProgress／強敵／
  // day1・day2 最終圈的狀態不會被清掉，若直接用目前數量算，新一輪第一影格就會把 tiles1..N、
  // strong1..N、day1、day2 全部重新發一次（可被刷）。restart 時在新 meta 記下
  // relicMemoryBaseline（當下的數量與旗標），這裡只算「超出基準」的部分。
  // counts：{ tiles, strong, day1, day2, boss }；baseline 缺少／欄位非數字＝0／false。
  // boss 不看基準（day3 夜王節點在 restart 時本來就會被清掉）。
  function cycleGrantKeys(counts, baseline) {
    var c = counts || {};
    var b = baseline || {};
    var baseTiles = typeof b.tiles === "number" ? b.tiles : 0;
    var baseStrong = typeof b.strong === "number" ? b.strong : 0;
    var keys = milestoneGrantKeys(Math.max(0, (c.tiles || 0) - baseTiles), Math.max(0, (c.strong || 0) - baseStrong));
    if (c.day1 && b.day1 !== true) keys.push("day1");
    if (c.day2 && b.day2 !== true) keys.push("day2");
    if (c.boss) keys.push("boss");
    return keys;
  }

  function grantKindOfKey(key) {
    return String(key).replace(/[0-9]+$/, function (m) {
      return /^day/.test(key) ? m : "";
    });
  }

  function toList(store) {
    return Object.keys(store || {}).map(function (k) {
      return store[k];
    });
  }

  // 追加 newMems，超過 cap 時從非最愛的最舊者開始丟；非最愛全丟光仍超過（最愛佔滿）時，
  // 新記憶中放不下的部分不存入（rejected）。不修改傳入的 store。
  function mergeIntoStore(store, newMems, cap) {
    var next = {};
    toList(store).forEach(function (m) {
      next[m.memId] = m;
    });
    var added = 0;
    var discarded = 0;
    var rejected = 0;
    newMems.forEach(function (m) {
      // fix round 1（2026-09-24 review，task-6結算保存的重複保存回歸）：memId已經存在於
      // store代表這筆記憶先前已經保存過（例如結算後reload、本地旗標重置導致重新按一次
      // 保存鍵），必須整筆略過，不能被容量判定當成「新記憶」而擠掉別的已存記憶——否則
      // 對一個已滿(cap)的store重複保存同一批memId，會誤丟棄跟這次保存完全無關的舊記憶。
      if (next[m.memId]) return;
      var count = Object.keys(next).length;
      if (count >= cap) {
        var victims = toList(next)
          .filter(function (x) {
            return x.favorite !== true;
          })
          .sort(function (a, b) {
            return (a.createdAt || 0) - (b.createdAt || 0);
          });
        if (!victims.length) {
          rejected++;
          return;
        }
        delete next[victims[0].memId];
        discarded++;
      }
      next[m.memId] = m;
      added++;
    });
    return { store: next, added: added, discarded: discarded, rejected: rejected };
  }

  function sortedMemories(store) {
    return toList(store).sort(function (a, b) {
      if (!!a.favorite !== !!b.favorite) return a.favorite ? -1 : 1;
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
  }

  window.PriTestMidnightRelicMemory = {
    SIZE_EFFECT_COUNT: SIZE_EFFECT_COUNT,
    MAX_STORED: MAX_STORED,
    MAX_LOADOUT: MAX_LOADOUT,
    isValidCode: isValidCode,
    normalizeCode: normalizeCode,
    grantSizes: grantSizes,
    rollEffects: rollEffects,
    newMemory: newMemory,
    milestoneGrantKeys: milestoneGrantKeys,
    cycleGrantKeys: cycleGrantKeys,
    grantKindOfKey: grantKindOfKey,
    mergeIntoStore: mergeIntoStore,
    sortedMemories: sortedMemories,
  };
})();
