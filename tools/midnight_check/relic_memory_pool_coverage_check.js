// ============================================================================
// 遺物記憶：抽選池的全覆蓋檢查（2026-09-25 池擴充，設計文件 §10.11）
// ----------------------------------------------------------------------------
// 回答的問題：「抽到目錄效果現在只有文字」的那 369 條，套進小／中／大記憶時，
//   1. 條數對不對（小 1／中 2／大 3）
//   2. **每一條**效果被抽到時的數值對不對（有 range 的必定擲出值且落在範圍內；
//      沒有 range 的必定不帶值）
//
// 「全覆蓋」是指池裡 393 條（24 種附帶效果 ＋ 目錄 369 條）在三種大小下**每一條都被
// 實際抽到過至少一次**，再逐條核對，而不是抽個幾百次看起來沒問題就算過。做法是持續
// 抽到集滿為止（coupon collector），集不滿就把漏掉的列出來當失敗。
//
// 驗的是生產路徑：midnight.js 的 _debugNewRelicMemory() 用的就是真實的
// relicMemoryDrawPool() 與 relicMemoryRollOpts()，測試沒有自己重現一份抽選邏輯。
//
// 前置：
//   1. python generate.py
//   2. python -m http.server 8791 --directory dist
// 執行：node relic_memory_pool_coverage_check.js
// ============================================================================
const { chromium } = require("playwright");
const BASE = process.env.PRITEST_BASE_URL || "http://localhost:8791";
// 每種大小最多抽幾顆記憶才放棄湊齊覆蓋。小記憶一顆只有 1 條效果，是最慢的一種：
// 393 條的 coupon collector 期望值約 393 × ln(393) ≈ 2350 顆，給 40 倍餘裕。
const MAX_DRAWS = Number(process.env.PRITEST_COVERAGE_MAX_DRAWS || 100000);

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  let fails = 0;
  const assert = (c, l) => {
    console.log((c ? "  [PASS] " : "  [FAIL] ") + l);
    if (!c) fails++;
  };

  try {
    await page.goto(BASE + "/midnight/index.html", { waitUntil: "networkidle" });

    const r = await page.evaluate((maxDraws) => {
      const MN = window.PriTestMidnight;
      const pool = MN._debugRelicMemoryPool();
      const SIZES = { s: 1, m: 2, l: 3 };
      const out = { pool: { size: pool.size, attached: pool.attached, withRange: pool.withRange }, sizes: {} };

      Object.keys(SIZES).forEach((size) => {
        const expectCount = SIZES[size];
        const seen = {}; // id -> { n, values: [] }
        let remaining = pool.ids.length;
        pool.ids.forEach((id) => {
          seen[id] = { n: 0, values: [] };
        });

        const res = {
          draws: 0,
          countWrong: [], // 條數不對的記憶
          dupWithin: [], // 同一顆記憶內 id 重複
          badValue: [], // 數值錯誤（超出範圍／該有卻沒有／不該有卻有／非整數）
          uncovered: [],
          byPosition: [], // 每個位置（第 1／2／3 條）出現過帶值效果的次數
          memIdBad: 0,
        };
        for (let i = 0; i < expectCount; i++) res.byPosition.push(0);

        while (remaining > 0 && res.draws < maxDraws) {
          const mem = MN._debugNewRelicMemory(size, null);
          res.draws++;

          if (!/^m[0-9a-f]{16}$/.test(mem.memId)) res.memIdBad++;
          if (mem.size !== size) res.countWrong.push("size=" + mem.size);
          if (mem.effects.length !== expectCount) {
            if (res.countWrong.length < 5) res.countWrong.push(mem.effects.length + " 條");
            continue;
          }

          const idsInMem = {};
          mem.effects.forEach((entry, pos) => {
            const id = entry.id;
            if (idsInMem[id] && res.dupWithin.length < 5) res.dupWithin.push(id);
            idsInMem[id] = true;

            const range = pool.ranges[id] || null;
            const hasValue = typeof entry.value === "number";
            if (hasValue) res.byPosition[pos]++;

            if (range) {
              if (!hasValue) {
                if (res.badValue.length < 10) res.badValue.push(id + "：有 range 卻沒有 value");
              } else if (entry.value < range[0] || entry.value > range[1]) {
                if (res.badValue.length < 10)
                  res.badValue.push(id + "：value " + entry.value + " 超出 [" + range[0] + "," + range[1] + "]");
              } else if (!Number.isInteger(entry.value)) {
                if (res.badValue.length < 10) res.badValue.push(id + "：value " + entry.value + " 不是整數");
              }
            } else if (hasValue) {
              if (res.badValue.length < 10) res.badValue.push(id + "：沒有 range 卻帶了 value " + entry.value);
            }

            const rec = seen[id];
            if (rec) {
              if (rec.n === 0) remaining--;
              rec.n++;
              if (rec.values.length < 400 && hasValue) rec.values.push(entry.value);
            }
          });
        }

        // 覆蓋不到的（抽到上限仍沒出現過）。
        Object.keys(seen).forEach((id) => {
          if (seen[id].n === 0) res.uncovered.push(id);
        });

        // 逐條核對：有 range 的效果，實際擲出過的值必須全部在範圍內，且範圍的兩端都搆得到
        // （只擲得出下限代表分段或取值邏輯壞掉）。樣本不足的效果只驗範圍、不驗兩端。
        res.perEffect = { checked: 0, outOfRange: [], neverHitLow: [], neverHitHigh: [], noValue: [] };
        Object.keys(pool.ranges).forEach((id) => {
          const rec = seen[id];
          if (!rec || rec.n === 0) return;
          res.perEffect.checked++;
          const range = pool.ranges[id];
          if (!rec.values.length) {
            res.perEffect.noValue.push(id);
            return;
          }
          const min = Math.min.apply(null, rec.values);
          const max = Math.max.apply(null, rec.values);
          if (min < range[0] || max > range[1]) {
            if (res.perEffect.outOfRange.length < 10)
              res.perEffect.outOfRange.push(id + "：實得 [" + min + "," + max + "]，宣告 [" + range[0] + "," + range[1] + "]");
          }
          // 樣本夠多時才檢查兩端可達性（30 次以上）。
          if (rec.values.length >= 30) {
            if (min !== range[0] && res.perEffect.neverHitLow.length < 10)
              res.perEffect.neverHitLow.push(id + "：" + rec.values.length + " 次都沒擲到下限 " + range[0] + "（最低 " + min + "）");
            if (max !== range[1] && res.perEffect.neverHitHigh.length < 10)
              res.perEffect.neverHitHigh.push(id + "：" + rec.values.length + " 次都沒擲到上限 " + range[1] + "（最高 " + max + "）");
          }
        });

        // 沒有 range 的效果一次都不該帶值——上面已在 badValue 抓過，這裡記條數備查。
        res.noRangeCovered = Object.keys(seen).filter((id) => !pool.ranges[id] && seen[id].n > 0).length;
        res.withRangeCovered = Object.keys(seen).filter((id) => pool.ranges[id] && seen[id].n > 0).length;
        out.sizes[size] = res;
      });

      // ---- 受控亂數：不依賴機率的確定性檢查 ----
      // rand 恆為 0 → 必選池首、擲值走前段最小。池首是 24 種附帶效果（都沒有範圍），
      // 所以這一組驗的是「沒有範圍的效果不帶 value」。
      const fixed = MN._debugNewRelicMemory("l", [0]);
      out.fixed = {
        count: fixed.effects.length,
        entries: fixed.effects.map((e) => ({ id: e.id, value: typeof e.value === "number" ? e.value : null })),
        ranges: fixed.effects.map((e) => pool.ranges[e.id] || null),
      };

      // 要驗擲值那條路，得讓受控亂數選到**帶範圍**的效果：rollEffects 的取法是
      // idx = floor(rand × 池長)，所以 (idx + 0.5) / 池長 會穩穩落在該索引上。
      //
      // newMemory() 的 rand 消耗順序（寫測試最容易踩的地方）：
      //   1 次 rollEffects 選效果 → **16 次 memId 的 hex** → 才輪到 rollRangeValue 的
      //   「選段」與「段內取值」。memId 夾在中間是因為物件字面量由上到下求值，
      //   memId 那一行排在 effects 前面。序列少算這 16 次就會循環取到錯位的值。
      // 小記憶只抽 1 條，所以序列長度 = 1 + 16 + 2 = 19：
      //   [pick, …16 個佔位…, 0,   0    ] → 前段最小 → value = range[0]（範圍下限）
      //   [pick, …16 個佔位…, 0.9, 0.999] → 後段最大 → value = range[1]（範圍上限）
      const MEMID_RAND_COUNT = 16;
      const memIdFiller = [];
      for (let i = 0; i < MEMID_RAND_COUNT; i++) memIdFiller.push(0);

      let rangedIdx = -1;
      for (let i = 0; i < pool.ids.length; i++) {
        if (pool.ranges[pool.ids[i]]) {
          rangedIdx = i;
          break;
        }
      }
      if (rangedIdx >= 0) {
        const pick = (rangedIdx + 0.5) / pool.ids.length;
        const lowMem = MN._debugNewRelicMemory("s", [pick].concat(memIdFiller, [0, 0]));
        const highMem = MN._debugNewRelicMemory("s", [pick].concat(memIdFiller, [0.9, 0.999]));
        out.ranged = {
          id: pool.ids[rangedIdx],
          range: pool.ranges[pool.ids[rangedIdx]],
          lowId: lowMem.effects[0].id,
          lowValue: typeof lowMem.effects[0].value === "number" ? lowMem.effects[0].value : null,
          highId: highMem.effects[0].id,
          highValue: typeof highMem.effects[0].value === "number" ? highMem.effects[0].value : null,
        };
      }

      // variant（固定遺物的強化版）的 high 旗標：同一個範圍，只擲後段。
      // 這裡直接驗純函式層，因為 high 目前只用在固定遺物上、不走記憶的抽選路徑。
      const RM = window.PriTestMidnightRelicMemory;
      const CAT = window.PriTestMidnightRelicMemoryCatalog;
      const critical = CAT.effect("rm_critical_up");
      out.variant = {
        range: critical.range,
        normalLow: RM.rollRangeValue(critical.range[0], critical.range[1], () => 0),
        highLow: RM.rollRangeValue(critical.range[0], critical.range[1], () => 0, { high: true }),
      };
      return out;
    }, MAX_DRAWS);

    // ---------------------------------------------------------------- 報告
    console.log("");
    console.log("抽選池：" + r.pool.size + " 條（附帶效果 " + r.pool.attached + " ＋ 目錄 " + (r.pool.size - r.pool.attached) + "），其中 " + r.pool.withRange + " 條帶數值範圍");

    const SIZE_LABEL = { s: "小", m: "中", l: "大" };
    const EXPECT = { s: 1, m: 2, l: 3 };
    ["s", "m", "l"].forEach((size) => {
      const d = r.sizes[size];
      const label = SIZE_LABEL[size] + "記憶";
      console.log("");
      console.log("-- " + label + "（期望 " + EXPECT[size] + " 條）：抽了 " + d.draws + " 顆湊齊覆蓋 --");

      assert(d.countWrong.length === 0, label + "：每一顆都恰好 " + EXPECT[size] + " 條效果" + (d.countWrong.length ? "（異常：" + d.countWrong.join("、") + "）" : ""));
      assert(d.dupWithin.length === 0, label + "：同一顆記憶內效果不重複" + (d.dupWithin.length ? "（重複：" + d.dupWithin.join("、") + "）" : ""));
      assert(d.memIdBad === 0, label + "：memId 全部符合 ^m[0-9a-f]{16}$");
      assert(
        d.uncovered.length === 0,
        label + "：池裡 " + r.pool.size + " 條效果全部被抽到過" + (d.uncovered.length ? "（漏 " + d.uncovered.length + " 條：" + d.uncovered.slice(0, 5).join("、") + "…）" : "")
      );
      assert(
        d.badValue.length === 0,
        label + "：每一條抽到的效果數值都正確（有範圍→擲出整數值且在範圍內；無範圍→不帶值）" +
          (d.badValue.length ? "\n        " + d.badValue.join("\n        ") : "")
      );
      assert(
        d.withRangeCovered === r.pool.withRange,
        label + "：" + r.pool.withRange + " 條帶範圍的效果全部被抽到並驗過數值（實得 " + d.withRangeCovered + "）"
      );
      assert(
        d.perEffect.noValue.length === 0,
        label + "：帶範圍的效果沒有一條是「抽到了卻從沒擲出值」" + (d.perEffect.noValue.length ? "（" + d.perEffect.noValue.slice(0, 5).join("、") + "）" : "")
      );
      assert(
        d.perEffect.outOfRange.length === 0,
        label + "：逐條核對 " + d.perEffect.checked + " 條的實得值域都在宣告範圍內" +
          (d.perEffect.outOfRange.length ? "\n        " + d.perEffect.outOfRange.join("\n        ") : "")
      );
      assert(
        d.perEffect.neverHitLow.length === 0,
        label + "：樣本足夠的效果都擲得到範圍下限" + (d.perEffect.neverHitLow.length ? "\n        " + d.perEffect.neverHitLow.join("\n        ") : "")
      );
      assert(
        d.perEffect.neverHitHigh.length === 0,
        label + "：樣本足夠的效果都擲得到範圍上限（後 20% 段真的抽得到）" +
          (d.perEffect.neverHitHigh.length ? "\n        " + d.perEffect.neverHitHigh.join("\n        ") : "")
      );
      assert(
        d.byPosition.every((n) => n > 0),
        label + "：第 1〜" + EXPECT[size] + " 條每個位置都出現過帶值的效果（各 " + d.byPosition.join("／") + " 次）"
      );
    });

    // ---- 受控亂數的確定性檢查 ----
    console.log("");
    console.log("-- 受控亂數（rand 恆 0）--");
    assert(r.fixed.count === 3, "大記憶固定 3 條");
    r.fixed.entries.forEach((e, i) => {
      const range = r.fixed.ranges[i];
      if (range) {
        assert(e.value === range[0], "第 " + (i + 1) + " 條 " + e.id + "：rand 恆 0 → value = 範圍下限 " + range[0] + "（實得 " + e.value + "）");
      } else {
        assert(e.value === null, "第 " + (i + 1) + " 條 " + e.id + "：沒有範圍 → 不帶 value");
      }
    });

    assert(!!r.ranged, "池中找得到帶範圍的效果（受控擲值檢查的前提）");
    if (r.ranged) {
      const rg = r.ranged;
      assert(
        rg.lowId === rg.id && rg.highId === rg.id,
        "受控亂數選中指定的帶範圍效果 " + rg.id + "（實得 " + rg.lowId + "／" + rg.highId + "）"
      );
      assert(
        rg.lowValue === rg.range[0],
        rg.id + "：前段最小 → value = 範圍下限 " + rg.range[0] + "（實得 " + rg.lowValue + "）"
      );
      assert(
        rg.highValue === rg.range[1],
        rg.id + "：後段最大 → value = 範圍上限 " + rg.range[1] + "（實得 " + rg.highValue + "）"
      );
    }

    console.log("");
    console.log("-- 固定遺物 variant 的 high（只擲後段）--");
    assert(
      r.variant.normalLow === r.variant.range[0],
      "致命の一撃強化 " + JSON.stringify(r.variant.range) + "：一般擲法最低 " + r.variant.range[0] + "（實得 " + r.variant.normalLow + "）"
    );
    assert(
      r.variant.highLow > r.variant.normalLow,
      "同一範圍的 +1 版最低 " + r.variant.highLow + "，高於一般擲法的 " + r.variant.normalLow
    );
  } finally {
    await browser.close();
  }

  console.log("");
  console.log(fails ? fails + " FAIL" : "ALL PASS");
  process.exit(fails ? 1 : 0);
})();
