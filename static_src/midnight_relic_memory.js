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

  // 範圍擲值（使用者明確規格 2026-09-24：「前80%內容機率80% 後20%機率20%」）。
  // 把 [min, max] 依**長度**切成前 80%／後 20% 兩段，以 80%／20% 的機率選一段，再在該段
  // 內均勻取一個整數。結果是同一個範圍裡越靠上限越難抽到——後 20% 的值合計只佔 20% 的
  // 機率，這就是「效果越好的機率越低」（設計文件 §10.2）。
  // 例：[10,30] 切點 26，80% 落在 10〜26、20% 落在 27〜30。
  // 範圍來自 midnight_relic_memory_catalog.js 的 effect.range；range 為 null 的效果不擲。
  //
  // opts.high（使用者明確規格 2026-09-25）：固定遺物上的「強化版」效果（「致命の一撃強化+1」
  // 對「致命の一撃強化」等 4 條 variant，見 catalog 的 FIXED_RELIC_EFFECT_ALIAS）改成
  // **只擲後段**——不做 80%／20% 的段落選擇，直接在後 20% 區間內均勻取值，必定是高值。
  // 使用者在「機率完全反轉／只擲後段／50-50」三個選項中選的是「只擲後段（必定高值）」。
  // 注意這條路徑只消耗 1 次 rand()（沒有段落選擇那一擲），寫測試時要留意。
  var RANGE_LOW_PORTION = 0.8; // 前段佔範圍長度的比例
  var RANGE_LOW_CHANCE = 0.8; // 前段被選中的機率

  function rollRangeValue(min, max, rand, opts) {
    if (typeof min !== "number" || typeof max !== "number") return null;
    if (max <= min) return min;
    var split = Math.floor(min + (max - min) * RANGE_LOW_PORTION);
    var lo = min;
    var hi = split;
    if (opts && opts.high === true) {
      lo = split + 1;
      hi = max;
    } else if (rand() >= RANGE_LOW_CHANCE) {
      lo = split + 1;
      hi = max;
    }
    // 範圍太短切不出兩段時退回整段，避免擲出空區間。
    if (hi < lo) {
      lo = min;
      hi = max;
    }
    return lo + Math.floor(rand() * (hi - lo + 1));
  }

  // 同一顆記憶內抽到第 2 條「角色專用」效果的機率（使用者明確規格 2026-09-24：
  // 「拿到一條後 第二條拿到的機率10%」）。只有中（2 條）／大（3 條）記憶抽得到第二條，
  // 小記憶不受影響。依設計文件 §10.3，專用效果本來就不限定該角色才能抽到，這個門檻只是
  // 讓一顆記憶不容易被專用效果塞滿。
  //
  // 適用範圍（使用者 2026-09-25 明確指示「只限第二條」）：10% 門檻**只套用在第 2 條**。
  // 原本的實作是每一條都套用同一個門檻（當時使用者的措辭只講到「第二條」），2026-09-25
  // 使用者確認採窄讀法，改成只看 i === 1。
  //
  // 第 3 條（大記憶才有）另有一條**更強的規則**（使用者 2026-09-25 明確指示
  // 「第三條必不為角色專用效果」）：不是機率門檻，是硬性排除——一律從非專用池抽，
  // 跟第 1 條抽到什麼無關。原本第 3 條是「不受限制、從整池均勻抽」。
  // 注意 rand 的消耗順序（見 newMemory() 的註解）：這條排除**不擲骰**，所以第 3 條仍然
  // 只消耗 1 次 rand，受控亂數測試的序列不變。
  var EXCLUSIVE_REPEAT_CHANCE = 0.1;
  var EXCLUSIVE_THRESHOLD_INDEX = 1; // 第 2 條（索引 1）套用 10% 門檻
  var EXCLUSIVE_FORBIDDEN_INDEX = 2; // 第 3 條（索引 2）一律不抽專用效果

  // opts.isExclusive(id) → 該效果是不是角色專用。不傳就是舊行為（整池均勻抽）。
  // opts.exclusiveGroup(id) → 該效果所屬的互斥組名（不屬於任何組回 null）。不傳就不限制。
  function rollEffects(size, effectIds, rand, opts) {
    var isExclusive = (opts && opts.isExclusive) || null;
    var exclusiveGroup = (opts && opts.exclusiveGroup) || null;
    // 使用者 2026-09-25 明確規格「同一 id 不會出現兩個在同一遺物記憶中」：抽到的會從 pool
    // 移除（下方 splice），這裡再把傳入池本身的重複 id 去掉，兩道保證。
    var pool = effectIds.filter(function (id, i) {
      return effectIds.indexOf(id) === i;
    });
    var n = Math.min(SIZE_EFFECT_COUNT[size] || 1, pool.length);
    var out = [];
    var gotExclusive = false;
    var usedGroups = {};
    for (var i = 0; i < n; i++) {
      var base = pool;
      // 互斥組（使用者 2026-09-25 明確規格「初始武器帶屬性 帶戰技 等等 一個遺物記憶只能抽到一條」
      // 「結晶雫 一個遺物記憶只能帶一條」）：同一顆記憶內，已抽到的組不再出現。
      // 只是過濾候選，不擲骰，rand 的消耗順序不變。
      if (exclusiveGroup) {
        var ungrouped = pool.filter(function (id) {
          var g = exclusiveGroup(id);
          return !g || !usedGroups[g];
        });
        if (ungrouped.length) base = ungrouped;
      }
      var candidates = base;
      var excludeExclusive = false;
      if (isExclusive) {
        if (i === EXCLUSIVE_FORBIDDEN_INDEX) excludeExclusive = true;
        else if (gotExclusive && i === EXCLUSIVE_THRESHOLD_INDEX && rand() >= EXCLUSIVE_REPEAT_CHANCE) excludeExclusive = true;
      }
      if (excludeExclusive) {
        var plain = base.filter(function (id) {
          return !isExclusive(id);
        });
        // 非專用效果抽光時才退回整池，否則記憶會湊不滿該有的條數。
        if (plain.length) candidates = plain;
      }
      var idx = Math.min(candidates.length - 1, Math.floor(rand() * candidates.length));
      var picked = candidates[idx];
      pool.splice(pool.indexOf(picked), 1);
      out.push(picked);
      if (isExclusive && isExclusive(picked)) gotExclusive = true;
      if (exclusiveGroup && exclusiveGroup(picked)) usedGroups[exclusiveGroup(picked)] = true;
    }
    return out;
  }

  function randomHex16(rand) {
    var s = "";
    for (var i = 0; i < 16; i++) s += Math.floor(rand() * 16).toString(16);
    return s;
  }

  // 記憶內的一條效果，統一成 { id, value } 的形狀。
  // value 是產生這顆記憶當下擲定的數值（設計文件 §10.2），之後永遠是這個值；
  // 沒有 range 的效果不帶 value（Firebase RTDB 存 null 等同刪 key，所以乾脆不寫）。
  //
  // 舊格式相容：2026-09-25 之前產生、已經存在 Firebase 的記憶，effects 是純字串陣列。
  // 所有讀取點都走 effectEntries()／effectIdList()，字串會被視為「沒有擲過值」的 { id }，
  // 不需要資料遷移，也不會因此丟掉既有記憶。
  function effectEntries(mem) {
    var raw = (mem && mem.effects) || [];
    var out = [];
    for (var i = 0; i < raw.length; i++) {
      var e = raw[i];
      if (typeof e === "string") out.push({ id: e, value: null });
      else if (e && typeof e === "object" && e.id) out.push({ id: e.id, value: typeof e.value === "number" ? e.value : null });
    }
    return out;
  }

  function effectIdList(mem) {
    return effectEntries(mem).map(function (e) {
      return e.id;
    });
  }

  // opts.rangeOf(id) → 該效果的 [min, max]，沒有範圍時回傳 null／undefined。
  // 不傳就不擲值（附帶效果那 24 種本來就沒有範圍），結果與舊版完全相同。
  // opts.isExclusive 見 rollEffects()。
  //
  // rand 的消耗順序（用受控亂數寫測試時最容易踩的地方）：
  //   1. rollEffects()：每條效果 1 次，第 2 條若套用專用門檻會多 1 次。
  //   2. **randomHex16()：16 次**——memId 那一行排在 effects 前面，物件字面量由上到下
  //      求值，所以這 16 次夾在「選效果」與「擲值」之間。
  //   3. 每條有範圍的效果 2 次（rollRangeValue 的選段＋段內取值）。
  // 受控序列少算中間那 16 次，就會循環取到錯位的值（2026-09-25 的全覆蓋檢查踩過）。
  function newMemory(size, effectIds, source, rand, now, opts) {
    var rangeOf = (opts && opts.rangeOf) || null;
    var ids = rollEffects(size, effectIds, rand, opts);
    return {
      memId: "m" + randomHex16(rand),
      size: size,
      effects: ids.map(function (id) {
        var range = rangeOf ? rangeOf(id) : null;
        if (!range || typeof range[0] !== "number" || typeof range[1] !== "number") return { id: id };
        var value = rollRangeValue(range[0], range[1], rand);
        return value === null ? { id: id } : { id: id, value: value };
      }),
      createdAt: now,
      favorite: false,
      source: source,
    };
  }

  // 固定配置遺物（catalog 的 FIXED_RELICS，使用者 2026-09-25 明確規格「擊破三頭犬必定另外獲得
  // 存入db 有相同物品則不儲存兩件 自動訂為最愛」）：效果是指定的、不抽選；有 range 的照樣擲值，
  // 強化版（high）只擲後段（設計文件 §10.6.1）。fixedId 是「同一件」的判定鍵（見 mergeIntoStore）。
  // size 依效果條數（2 條＝中、3 條＝大），只是顯示用的標籤。
  // rand 的消耗順序：randomHex16 16 次 → 每條有 range 的效果 2 次（high 1 次）。
  function newFixedMemory(relic, source, rand, now, opts) {
    var rangeOf = (opts && opts.rangeOf) || null;
    var list = (relic && relic.effects) || [];
    return {
      memId: "m" + randomHex16(rand),
      size: list.length >= 3 ? "l" : list.length === 2 ? "m" : "s",
      fixedId: relic.id,
      effects: list.map(function (fx) {
        var range = rangeOf ? rangeOf(fx.effectId) : null;
        if (!range || typeof range[0] !== "number" || typeof range[1] !== "number") return { id: fx.effectId };
        var value = rollRangeValue(range[0], range[1], rand, { high: fx.high === true });
        return value === null ? { id: fx.effectId } : { id: fx.effectId, value: value };
      }),
      createdAt: now,
      favorite: true,
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

  function shallowCopy(o) {
    var out = {};
    Object.keys(o).forEach(function (k) {
      out[k] = o[k];
    });
    return out;
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
    var duplicateFixed = 0;
    newMems.forEach(function (m) {
      // fix round 1（2026-09-24 review，task-6結算保存的重複保存回歸）：memId已經存在於
      // store代表這筆記憶先前已經保存過（例如結算後reload、本地旗標重置導致重新按一次
      // 保存鍵），必須整筆略過，不能被容量判定當成「新記憶」而擠掉別的已存記憶——否則
      // 對一個已滿(cap)的store重複保存同一批memId，會誤丟棄跟這次保存完全無關的舊記憶。
      if (next[m.memId]) return;
      // 固定配置遺物：store 裡已經有同一件（fixedId 相同）就不存第二件（使用者 2026-09-25 明確規格）。
      if (m.fixedId) {
        var dup = toList(next).some(function (x) {
          return x && x.fixedId === m.fixedId;
        });
        if (dup) {
          duplicateFixed++;
          return;
        }
        m = shallowCopy(m);
        m.favorite = true; // 自動訂為最愛
      }
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
    return { store: next, added: added, discarded: discarded, rejected: rejected, duplicateFixed: duplicateFixed };
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
    rollRangeValue: rollRangeValue,
    RANGE_LOW_PORTION: RANGE_LOW_PORTION,
    RANGE_LOW_CHANCE: RANGE_LOW_CHANCE,
    EXCLUSIVE_REPEAT_CHANCE: EXCLUSIVE_REPEAT_CHANCE,
    EXCLUSIVE_THRESHOLD_INDEX: EXCLUSIVE_THRESHOLD_INDEX,
    EXCLUSIVE_FORBIDDEN_INDEX: EXCLUSIVE_FORBIDDEN_INDEX,
    effectEntries: effectEntries,
    effectIdList: effectIdList,
    newMemory: newMemory,
    newFixedMemory: newFixedMemory,
    milestoneGrantKeys: milestoneGrantKeys,
    cycleGrantKeys: cycleGrantKeys,
    grantKindOfKey: grantKindOfKey,
    mergeIntoStore: mergeIntoStore,
    sortedMemories: sortedMemories,
  };
})();
