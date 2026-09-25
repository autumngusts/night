// ============================================================================
// 遺物記憶：效果的機制接入（2026-09-25 第 1 期，設計文件 §10.13）
// ----------------------------------------------------------------------------
// 驗的是「文字對應真實效果」這一步：帶入的遺物記憶，其效果值有沒有真的進到 midnight 的
// 計算裡。做法是把記憶的效果 id 對應到語意等價的武器詞條 id（RELIC_MEMORY_AFFIX_ALIAS），
// 讓既有的 affixTotal() 一併算進去。
//
// 這張 alias 是純字串表，**打錯字會靜默失效**（效果永遠加 0，不會報錯），所以第一組檢查
// 是稽核表的健全性，第二組才是實際數值。
//
// 前置：
//   1. python generate.py
//   2. python -m http.server 8791 --directory dist
// 執行：node relic_memory_effect_check.js
// ============================================================================
const { chromium } = require("playwright");
const BASE = process.env.PRITEST_BASE_URL || "http://localhost:8791";

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

    // ---------------------------------------------------------------- 稽核表
    const audit = await page.evaluate(() => window.PriTestMidnight._debugRelicMemoryAliasAudit());

    console.log("-- alias 稽核表（" + audit.length + " 條）--");
    const notInCatalog = audit.filter((a) => !a.effectExists);
    assert(
      notInCatalog.length === 0,
      "每一條 alias 的效果 id 都存在於目錄" + (notInCatalog.length ? "：" + notInCatalog.map((a) => a.effectId).join("、") : "")
    );

    // 2026-09-25：固定配置遺物上的 4 條（relicOnly）也接上了 alias。它們本來就只出現在固定遺物上、
    // 不進抽選池，所以從「抽得到」這項排除（舊期望：alias 全部可抽選——當時 alias 只有抽選池的效果）。
    const CAT_RELIC_ONLY = await page.evaluate(() =>
      window.PriTestMidnightRelicMemoryCatalog.EFFECTS.filter((e) => e.relicOnly).map((e) => e.id)
    );
    const notDrawable = audit.filter((a) => a.effectExists && !a.drawable && CAT_RELIC_ONLY.indexOf(a.effectId) === -1);
    assert(
      notDrawable.length === 0,
      "每一條 alias 的效果都抽得到（沒有被 bad／skip 排除；固定遺物專用的 relicOnly 除外）" +
        (notDrawable.length ? "：" + notDrawable.map((a) => a.effectId).join("、") : "")
    );

    // alias 的目標有兩種：併進既有武器詞條（ownKey=false），或本檔自己的 bonus key
    // （ownKey=true，目錄有而詞條沒有的效果）。兩種的健全條件相反，所以分開檢查。
    const shared = audit.filter((a) => !a.ownKey);
    const ownKeys = audit.filter((a) => a.ownKey);
    console.log("    （併進既有詞條 " + shared.length + " 條／本檔自己的 key " + ownKeys.length + " 條）");

    const noAffix = shared.filter((a) => !a.affixExists);
    assert(
      noAffix.length === 0,
      "併進既有詞條的那幾條，目標詞條都存在於 weapon_affixes.js" +
        (noAffix.length ? "：" + noAffix.map((a) => a.effectId + " → " + a.key).join("、") : "")
    );

    // 反過來：本檔自己的 key **不該**在詞條表裡找得到，否則是撞名，兩邊的值會互相污染。
    const collided = ownKeys.filter((a) => a.affixExists);
    assert(
      collided.length === 0,
      "本檔自己的 bonus key 沒有跟武器詞條撞名" +
        (collided.length ? "：" + collided.map((a) => a.key).join("、") : "")
    );

    const phase2 = shared.filter((a) => a.affixExists && a.affixPhase !== 1);
    assert(
      phase2.length === 0,
      "目標詞條全部是 phase 1（phase 2 的詞條 affixTotal 一律回 0，接了也不會生效）" +
        (phase2.length ? "：" + phase2.map((a) => a.effectId + " → " + a.key).join("、") : "")
    );

    const noValue = audit.filter((a) => !a.hasRange && a.fixed === null);
    assert(
      noValue.length === 0,
      "每一條 alias 都有數值可加（有 range，或 alias 上寫了 fixed）" +
        (noValue.length ? "：" + noValue.map((a) => a.effectId).join("、") : "")
    );

    // ---------------------------------------------------------------- 實際數值
    console.log("");
    console.log("-- 帶入記憶後 affixTotal 的實得值 --");

    // 用稽核表自己的資料造測試案例，期望值從 range 算出來，不硬編（CLAUDE.md §4.7 原則 1）。
    const cases = audit.map((a) => ({
      effectId: a.effectId,
      key: a.key,
      value: a.range ? a.range[0] : a.fixed,
      stackable: a.stackable,
    }));

    const single = await page.evaluate((cs) => {
      const MN = window.PriTestMidnight;
      return cs.map((c) => {
        const loadout = [{ memId: "m0", size: "s", effects: [{ id: c.effectId, value: c.value }] }];
        const got = MN._debugRelicMemoryAffixTotal(loadout, [c.key]);
        return { effectId: c.effectId, key: c.key, expect: c.value, got: got[c.key] };
      });
    }, cases);

    const wrong = single.filter((s) => s.got !== s.expect);
    assert(
      wrong.length === 0,
      "每一條效果帶入後都算進了對應的詞條（" + single.length + " 條）" +
        (wrong.length ? "\n        " + wrong.map((w) => w.effectId + " → " + w.key + "：期望 " + w.expect + "，實得 " + w.got).join("\n        ") : "")
    );

    // 沒有帶記憶時一律 0（不能讓沒帶的人也吃到加成）。
    const empty = await page.evaluate((keys) => window.PriTestMidnight._debugRelicMemoryAffixTotal([], keys), [
      ...new Set(audit.map((a) => a.key)),
    ]);
    assert(
      Object.keys(empty).every((k) => empty[k] === 0),
      "沒有帶入記憶時每個 key 都是 0"
    );

    // ---------------------------------------------------------------- 疊加
    console.log("");
    console.log("-- stackable 的疊加行為 --");
    const stackTrue = audit.filter((a) => a.stackable === true && a.range)[0];
    const stackFalse = audit.filter((a) => a.stackable === false && a.range)[0];
    assert(!!stackTrue && !!stackFalse, "稽核表裡同時有 stackable true 與 false 的案例（前提）");

    if (stackTrue && stackFalse) {
      const stacked = await page.evaluate(
        (args) => {
          const MN = window.PriTestMidnight;
          const mk = (id, value, memId) => ({ memId: memId, size: "s", effects: [{ id: id, value: value }] });
          return {
            trueTwo: MN._debugRelicMemoryAffixTotal([mk(args.t.effectId, args.t.range[0], "ma"), mk(args.t.effectId, args.t.range[1], "mb")], [args.t.key])[args.t.key],
            falseTwo: MN._debugRelicMemoryAffixTotal([mk(args.f.effectId, args.f.range[0], "ma"), mk(args.f.effectId, args.f.range[1], "mb")], [args.f.key])[args.f.key],
          };
        },
        { t: stackTrue, f: stackFalse }
      );
      assert(
        stacked.trueTwo === stackTrue.range[0] + stackTrue.range[1],
        stackTrue.effectId + "（stackable）帶 2 顆 → 相加 " + stackTrue.range[0] + "+" + stackTrue.range[1] + "=" + (stackTrue.range[0] + stackTrue.range[1]) + "（實得 " + stacked.trueTwo + "）"
      );
      assert(
        stacked.falseTwo === stackFalse.range[0],
        stackFalse.effectId + "（不可疊加）帶 2 顆 → 只算第一顆的 " + stackFalse.range[0] + "（實得 " + stacked.falseTwo + "）"
      );
    }

    // ---------------------------------------------------------------- 實際計算點
    console.log("");
    console.log("-- 接到真實計算點 --");
    const real = await page.evaluate(() => {
      const CD = window.PriTestCharacterDrawer;
      const typeId = window.PriTestCharacterTypes.list()[0].id;
      const mk = (id, value) => [{ memId: "m1", size: "s", effects: [{ id: id, value: value }] }];

      // 最大HP上昇：selfArenaHpMax() 直接用 affixTotal(c, "maxHpUp")，沒有武器詞條 gate。
      const c = CD.newCharacter("t", typeId);
      const MN = window.PriTestMidnight;
      const before = MN._debugRelicMemoryAffixTotal([], ["maxHpUp", "physicalAtkUp", "magicCutUp"]);
      const hp = MN._debugRelicMemoryAffixTotal(mk("rm_max_hp_up", 25), ["maxHpUp"]);
      const atk = MN._debugRelicMemoryAffixTotal(mk("rm_physical_atk_up", 4), ["physicalAtkUp"]);
      const cut = MN._debugRelicMemoryAffixTotal(mk("rm_magic_cut_up", 11), ["magicCutUp"]);
      // 物理攻撃力上昇+2 走同一個 key，證明兩條 variant 疊在同一個注入點上。
      const atk2 = MN._debugRelicMemoryAffixTotal(
        [
          { memId: "ma", size: "s", effects: [{ id: "rm_physical_atk_up", value: 4 }] },
          { memId: "mb", size: "s", effects: [{ id: "rm_physical_atk_up_2", value: 9 }] },
        ],
        ["physicalAtkUp"]
      );
      return { before, hp: hp.maxHpUp, atk: atk.physicalAtkUp, cut: cut.magicCutUp, atk2: atk2.physicalAtkUp };
    });

    assert(real.before.maxHpUp === 0 && real.before.physicalAtkUp === 0 && real.before.magicCutUp === 0, "基準值都是 0");
    assert(real.hp === 25, "最大HP上昇 25 → maxHpUp = 25（selfArenaHpMax 的加數，實得 " + real.hp + "）");
    assert(real.atk === 4, "物理攻撃力上昇 4% → physicalAtkUp = 4（affixOutgoingDamageMult 的加數，實得 " + real.atk + "）");
    assert(real.cut === 11, "魔力カット率上昇 11% → magicCutUp = 11（affixElementCut 的加數，實得 " + real.cut + "）");
    assert(real.atk2 === 13, "物理攻撃力上昇 4% ＋ 同系的 +2 版 9% → 疊在同一個注入點 = 13（實得 " + real.atk2 + "）");

    // ---------------------------------------------------------------- 武器類別攻擊力
    console.log("");
    console.log("-- 武器類別攻擊力（24 條，一個注入點）--");
    const wp = await page.evaluate(() => {
      const MN = window.PriTestMidnight;
      const CAT = window.PriTestMidnightRelicMemoryCatalog;
      const W = window.PriTestWeapons;
      const map = MN._debugRelicMemoryWeaponCategory([], null).map;

      // 目錄裡「○○の攻撃力+」共幾條（期望 24 條全部對應得到 category）。
      const atkEffects = CAT.EFFECTS.filter((e) => /^(.+)の攻撃力\+$/.test(e.name.ja));

      // category id 是否真的存在於 weapons.js（對錯了會靜默失效）。
      const catIds = {};
      (W.categories() || []).forEach((c) => {
        catIds[c.id] = true;
      });
      const badCat = Object.keys(map).filter((k) => !catIds[map[k]]);

      // 每一條都用它自己的 category 驗一次：帶入該效果 → 該 category 的加成 = 擲定的值；
      // 換成別的 category → 0（不能對所有武器都生效）。
      const rows = Object.keys(map).map((effectId) => {
        const def = CAT.effect(effectId);
        const value = def.range ? def.range[1] : null;
        const loadout = [{ memId: "m1", size: "s", effects: [{ id: effectId, value: value }] }];
        const own = MN._debugRelicMemoryWeaponCategory(loadout, map[effectId]).total;
        const other = MN._debugRelicMemoryWeaponCategory(loadout, map[effectId] === "dagger" ? "katana" : "dagger").total;
        return { effectId: effectId, category: map[effectId], expect: value, own: own, other: other };
      });

      // 實際走 affixOutgoingDamageMult：拿一把該類別的武器，倍率要反映出來。
      const daggerWeapon = (W.list() || []).filter((w) => w.category === "dagger")[0];
      const dLoad = [{ memId: "m1", size: "s", effects: [{ id: "rm_wp_dagger_atk", value: 8 }] }];
      const c = { relicMemoryLoadout: dLoad };
      return {
        mapSize: Object.keys(map).length,
        atkEffectCount: atkEffects.length,
        badCat: badCat,
        rows: rows,
        daggerWeaponId: daggerWeapon ? daggerWeapon.id : null,
        multDagger: MN._debugRelicMemoryAffixTotal ? null : null,
      };
    });

    assert(wp.atkEffectCount === 24, "目錄裡「○○の攻撃力+」共 24 條（實得 " + wp.atkEffectCount + "）");
    assert(wp.mapSize === 24, "24 條全部自動對應到 weapons.js 的 category（實得 " + wp.mapSize + "）");
    assert(
      wp.badCat.length === 0,
      "對應到的 category id 全部存在於 weapons.js" + (wp.badCat.length ? "：" + wp.badCat.join("、") : "")
    );
    const wpWrong = wp.rows.filter((r) => r.own !== r.expect);
    assert(
      wpWrong.length === 0,
      "每一條帶入後對自己的武器類別都生效（24 條）" +
        (wpWrong.length ? "\n        " + wpWrong.map((w) => w.effectId + " → " + w.category + "：期望 " + w.expect + "，實得 " + w.own).join("\n        ") : "")
    );
    const wpLeak = wp.rows.filter((r) => r.other !== 0);
    assert(
      wpLeak.length === 0,
      "沒有一條會對別的武器類別生效（不能變成無條件加成）" +
        (wpLeak.length ? "：" + wpLeak.map((w) => w.effectId + " 對別類別也加了 " + w.other).join("、") : "")
    );

    // 走真實的 affixOutgoingDamageMult：帶「短剣の攻撃力+8%」時，用短劍攻擊倍率 1.08，
    // 用別的武器 1.00。
    const mult = await page.evaluate((weaponId) => {
      const MN = window.PriTestMidnight;
      const W = window.PriTestWeapons;
      const katana = (W.list() || []).filter((w) => w.category === "katana")[0];
      const loadout = [{ memId: "m1", size: "s", effects: [{ id: "rm_wp_dagger_atk", value: 8 }] }];
      return {
        dagger: MN._debugRelicMemoryOutgoingMult(loadout, { weaponId: weaponId }),
        katana: MN._debugRelicMemoryOutgoingMult(loadout, { weaponId: katana ? katana.id : null }),
        none: MN._debugRelicMemoryOutgoingMult([], { weaponId: weaponId }),
      };
    }, wp.daggerWeaponId);
    assert(Math.abs(mult.dagger - 1.08) < 1e-9, "帶「短剣の攻撃力+8%」用短劍攻擊 → 倍率 1.08（實得 " + mult.dagger + "）");
    assert(Math.abs(mult.katana - 1.0) < 1e-9, "同一顆記憶用刀攻擊 → 倍率 1.00（實得 " + mult.katana + "）");
    assert(Math.abs(mult.none - 1.0) < 1e-9, "沒帶記憶時倍率 1.00（實得 " + mult.none + "）");

    // ---------------------------------------------------------------- 第1期覆蓋率
    console.log("");
    console.log("-- 第 1 期（純數值加成）的接入覆蓋率 --");
    const cov = await page.evaluate(() => {
      const MN = window.PriTestMidnight;
      const CAT = window.PriTestMidnightRelicMemoryCatalog;
      // 第 1 期的範圍定義（設計文件 §10.13 的分期表）。
      const P1_KINDS = [
        "atkPct", "elementAtkPct", "physicalAtkPct", "maxStat", "damageTaken",
        "elementDamageTaken", "staminaRegen", "artCooldown", "skillCooldown",
        "castFpCost", "staggerThreshold",
      ];
      const wanted = CAT.drawableEffects().filter((e) => P1_KINDS.indexOf(e.kind) >= 0);
      const wired = {};
      MN._debugRelicMemoryWiredIds().forEach((id) => {
        wired[id] = true;
      });
      return {
        wantedCount: wanted.length,
        missing: wanted.filter((e) => !wired[e.id]).map((e) => e.id + "（" + e.kind + "／" + e.name.ja + "）"),
        // 反向：接了但不在**已完成期別**範圍內的（代表分期表或 alias 有一邊寫錯）。
        // 第 2 期完成的是 accumResist／overTime／onAttack 三群（discovery 待規格）。
        // startFlask 是 2026-09-25 第 7 期（結晶雫）加入的，見 crystal_tear_check.js。
        extra: MN._debugRelicMemoryWiredIds().filter((id) => {
          const e = CAT.effect(id);
          const DONE = P1_KINDS.concat(["accumResist", "overTime", "onAttack", "discovery", "weaponInfusion", "onInfusion", "levelStat", "poise", "spellSchool", "grantWeaponSkill", "grantSpell", "special", "onGuardSuccess", "onDamaged", "aggro", "flask", "onWeaponSwap", "globalMilestone", "startItem", "nearDeath", "startFlask"]);
          return !e || DONE.indexOf(e.kind) < 0;
        }),
      };
    });

    assert(cov.wantedCount === 56, "第 1 期範圍是 56 條（實得 " + cov.wantedCount + "）");
    assert(
      cov.missing.length === 0,
      "第 1 期 56 條全部有注入點" + (cov.missing.length ? "，還缺 " + cov.missing.length + " 條：\n        " + cov.missing.join("\n        ") : "")
    );
    assert(
      cov.extra.length === 0,
      "沒有接到已完成期別以外的效果" + (cov.extra.length ? "：" + cov.extra.join("、") : "")
    );

    // ---------------------------------------------------------------- 新 key 的數值
    console.log("");
    console.log("-- 目錄獨有效果（本檔自己的 bonus key）--");
    const own = await page.evaluate(() => {
      const MN = window.PriTestMidnight;
      const CAT = window.PriTestMidnightRelicMemoryCatalog;
      const audit = MN._debugRelicMemoryAliasAudit().filter((a) => a.ownKey);
      const rows = audit.map((a) => {
        const value = a.range ? a.range[1] : a.fixed;
        const loadout = [{ memId: "m1", size: "s", effects: [{ id: a.effectId, value: a.range ? value : undefined }] }];
        return {
          effectId: a.effectId,
          key: a.key,
          expect: value,
          got: MN._debugRelicMemoryAffixTotal(loadout, [a.key])[a.key],
        };
      });
      // 減傷真的降低了受傷倍率。
      const cutLoad = (id, v) => [{ memId: "m1", size: "s", effects: [{ id: id, value: v }] }];
      return {
        rows: rows,
        ownCount: audit.length,
        physCut: MN._debugRelicMemoryIncomingMult(cutLoad("rm_physical_cut_up", 10), {}),
        physNone: MN._debugRelicMemoryIncomingMult([], {}),
        fireCut: MN._debugRelicMemoryIncomingMult(cutLoad("rm_fire_cut_up", 12), { element: "炎" }),
        fireOther: MN._debugRelicMemoryIncomingMult(cutLoad("rm_fire_cut_up", 12), { element: "雷" }),
        elemCut: MN._debugRelicMemoryIncomingMult(cutLoad("rm_element_cut_up", 9), { element: "雷" }),
        // 第 1 段強化只在 firstHit 時生效。
        firstHit: MN._debugRelicMemoryOutgoingMult(cutLoad("rm_first_hit_up", 6), { firstHit: true }),
        notFirstHit: MN._debugRelicMemoryOutgoingMult(cutLoad("rm_first_hit_up", 6), { firstHit: false }),
        roar: MN._debugRelicMemoryOutgoingMult(cutLoad("rm_roar_breath_up", 10), { roarBreath: true }),
        notRoar: MN._debugRelicMemoryOutgoingMult(cutLoad("rm_roar_breath_up", 10), { roarBreath: false }),
      };
    });

    const ownWrong = own.rows.filter((r) => r.got !== r.expect);
    assert(
      ownWrong.length === 0,
      "目錄獨有的 " + own.ownCount + " 條，bonus key 都算得出值" +
        (ownWrong.length ? "\n        " + ownWrong.map((w) => w.effectId + " → " + w.key + "：期望 " + w.expect + "，實得 " + w.got).join("\n        ") : "")
    );

    assert(Math.abs(own.physNone - 1.0) < 1e-9, "沒帶記憶時受傷倍率 1.00");
    assert(Math.abs(own.physCut - 0.9) < 1e-9, "物理カット率+10% → 物理受傷倍率 0.90（實得 " + own.physCut + "）");
    assert(Math.abs(own.fireCut - 0.88) < 1e-9, "炎カット率+12% → 受炎屬性攻擊倍率 0.88（實得 " + own.fireCut + "）");
    assert(Math.abs(own.fireOther - 1.0) < 1e-9, "炎カット率+ 對雷屬性攻擊無效（實得 " + own.fireOther + "）");
    assert(Math.abs(own.elemCut - 0.91) < 1e-9, "属性カット率+9% → 受雷屬性攻擊倍率 0.91（實得 " + own.elemCut + "）");
    assert(Math.abs(own.firstHit - 1.06) < 1e-9, "1段目強化+6% → 第1段倍率 1.06（實得 " + own.firstHit + "）");
    assert(Math.abs(own.notFirstHit - 1.0) < 1e-9, "1段目強化對非第1段無效（實得 " + own.notFirstHit + "）");
    assert(Math.abs(own.roar - 1.1) < 1e-9, "咆哮とブレス強化+10% → 咆哮招式倍率 1.10（實得 " + own.roar + "）");
    assert(Math.abs(own.notRoar - 1.0) < 1e-9, "咆哮とブレス強化對一般招式無效（實得 " + own.notRoar + "）");

    // ---------------------------------------------------------------- 第2期
    console.log("");
    console.log("-- 第 2 期：異常蓄積上限（7 條）--");
    const acc = await page.evaluate(() => {
      const MN = window.PriTestMidnight;
      const PAIRS = [
        ["rm_resist_poison", "猛毒"],
        ["rm_resist_rot", "腐敗"],
        ["rm_resist_bleed", "出血"],
        ["rm_resist_frost", "凍傷"],
        ["rm_resist_sleep", "睡眠"],
        ["rm_resist_madness", "発狂"],
        ["rm_resist_death", "呪死"],
      ];
      const base = {};
      PAIRS.forEach(([, name]) => {
        base[name] = MN._debugRelicMemoryAccumThreshold([], name);
      });
      const rows = PAIRS.map(([id, name]) => {
        const loadout = [{ memId: "m1", size: "s", effects: [{ id: id }] }];
        return {
          id: id,
          name: name,
          base: base[name],
          withMem: MN._debugRelicMemoryAccumThreshold(loadout, name),
          // 同一顆記憶不該影響別的異常。
          other: MN._debugRelicMemoryAccumThreshold(loadout, name === "猛毒" ? "腐敗" : "猛毒"),
          otherBase: base[name === "猛毒" ? "腐敗" : "猛毒"],
        };
      });
      return rows;
    });

    const accWrong = acc.filter((r) => r.withMem !== r.base + 1);
    assert(
      accWrong.length === 0,
      "7 條「○○異常蓄積上限+1」都讓對應異常的門檻 +1" +
        (accWrong.length ? "\n        " + accWrong.map((r) => r.id + "（" + r.name + "）：" + r.base + " → " + r.withMem).join("\n        ") : "")
    );
    const accLeak = acc.filter((r) => r.other !== r.otherBase);
    assert(
      accLeak.length === 0,
      "沒有一條會影響其他異常的門檻" + (accLeak.length ? "：" + accLeak.map((r) => r.id).join("、") : "")
    );

    console.log("");
    console.log("-- 第 2 期：武器類別的攻擊回復（48 條）--");
    const oa = await page.evaluate(() => {
      const MN = window.PriTestMidnight;
      const CAT = window.PriTestMidnightRelicMemoryCatalog;
      const maps = MN._debugRelicMemoryCategoryMaps();
      const rows = [];
      ["hp", "fp"].forEach((kind) => {
        Object.keys(maps[kind]).forEach((effectId) => {
          const def = CAT.effect(effectId);
          const value = def.range ? def.range[1] : null;
          const loadout = [{ memId: "m1", size: "s", effects: [{ id: effectId, value: value }] }];
          const cat = maps[kind][effectId];
          rows.push({
            effectId: effectId,
            kind: kind,
            category: cat,
            expect: value,
            own: MN._debugRelicMemoryCategoryTotal(loadout, cat, kind),
            other: MN._debugRelicMemoryCategoryTotal(loadout, cat === "dagger" ? "katana" : "dagger", kind),
            crossKind: MN._debugRelicMemoryCategoryTotal(loadout, cat, kind === "hp" ? "fp" : "hp"),
          });
        });
      });
      return { hpCount: Object.keys(maps.hp).length, fpCount: Object.keys(maps.fp).length, rows: rows };
    });

    assert(oa.hpCount === 24, "「○○の攻撃でHP回復」24 條全部對應到 category（實得 " + oa.hpCount + "）");
    assert(oa.fpCount === 24, "「○○の攻撃でFP回復」24 條全部對應到 category（實得 " + oa.fpCount + "）");
    const oaWrong = oa.rows.filter((r) => r.own !== r.expect);
    assert(
      oaWrong.length === 0,
      "48 條帶入後對自己的武器類別都算得出回復量" +
        (oaWrong.length ? "\n        " + oaWrong.map((r) => r.effectId + "：期望 " + r.expect + "，實得 " + r.own).join("\n        ") : "")
    );
    const oaLeak = oa.rows.filter((r) => r.other !== 0);
    assert(oaLeak.length === 0, "沒有一條會對別的武器類別生效" + (oaLeak.length ? "：" + oaLeak.map((r) => r.effectId).join("、") : ""));
    const oaCross = oa.rows.filter((r) => r.crossKind !== 0);
    assert(
      oaCross.length === 0,
      "HP 那條不會被當成 FP 回復、反之亦然" + (oaCross.length ? "：" + oaCross.map((r) => r.effectId).join("、") : "")
    );

    console.log("");
    console.log("-- 第 2 期：持續回復系（6 條）--");
    const ot = await page.evaluate(() => {
      const MN = window.PriTestMidnight;
      const CAT = window.PriTestMidnightRelicMemoryCatalog;
      const IDS = [
        ["rm_hp_regen", "rmHpRegen"],
        ["rm_fp_regen", "rmFpRegen"],
        ["rm_madness_fp_regen", "rmMadnessFpRegen"],
        ["rm_nearby_rot_hp_regen", "rmNearbyRotHpRegen"],
        ["rm_low_hp_party_regen", "rmLowHpPartyRegen"],
        ["rm_kill_party_heal", "rmKillPartyHeal"],
      ];
      return IDS.map(([id, key]) => {
        const def = CAT.effect(id);
        const audit = MN._debugRelicMemoryAliasAudit().filter((a) => a.effectId === id)[0];
        const value = def.range ? def.range[1] : audit ? audit.fixed : null;
        const loadout = [{ memId: "m1", size: "s", effects: [{ id: id, value: def.range ? value : undefined }] }];
        return { id: id, key: key, expect: value, got: MN._debugRelicMemoryAffixTotal(loadout, [key])[key] };
      });
    });
    const otWrong = ot.filter((r) => r.got !== r.expect);
    assert(
      otWrong.length === 0,
      "持續回復系 6 條的 bonus key 都算得出值" +
        (otWrong.length ? "\n        " + otWrong.map((r) => r.id + " → " + r.key + "：期望 " + r.expect + "，實得 " + r.got).join("\n        ") : "")
    );

    console.log("");
    console.log("-- 第 2 期覆蓋率 --");
    const cov2 = await page.evaluate(() => {
      const MN = window.PriTestMidnight;
      const CAT = window.PriTestMidnightRelicMemoryCatalog;
      // 第 2 期已接的三群（discovery 32 條待使用者確認「+10%」的語意，不在此列）。
      const DONE_KINDS = ["accumResist", "overTime", "onAttack", "discovery", "weaponInfusion", "onInfusion"];
      const wanted = CAT.drawableEffects().filter((e) => DONE_KINDS.indexOf(e.kind) >= 0);
      const wired = {};
      MN._debugRelicMemoryWiredIds().forEach((id) => {
        wired[id] = true;
      });
      const discovery = CAT.drawableEffects().filter((e) => e.kind === "discovery");
      return {
        wantedCount: wanted.length,
        missing: wanted.filter((e) => !wired[e.id]).map((e) => e.id + "（" + e.kind + "）"),
        discoveryCount: discovery.length,
        discoveryWired: discovery.filter((e) => wired[e.id]).length,
        totalWired: Object.keys(wired).length,
      };
    });
    assert(cov2.wantedCount === 101, "第 2 期 93 條 ＋ 第 4 期已完成的 8 條 = 101（實得 " + cov2.wantedCount + "）");
    assert(
      cov2.missing.length === 0,
      "這 101 條全部有注入點" + (cov2.missing.length ? "，還缺：\n        " + cov2.missing.join("\n        ") : "")
    );
    assert(cov2.discoveryCount === 32 && cov2.discoveryWired === 32, "discovery 32 條全部接上（實得 " + cov2.discoveryWired + "）");

    console.log("");
    console.log("-- 第 2 期：潛在之力的出現率（32 條）--");
    const disc = await page.evaluate(() => {
      const MN = window.PriTestMidnight;
      const CD = window.PriTestCharacterDrawer;
      const W = window.PriTestWeapons;
      const maps = MN._debugRelicMemoryCategoryMaps();
      const cats = W.categories() || [];
      const n = cats.length;

      // 每一條都對應到一個 category。
      const findCount = Object.keys(maps.find).length;

      // 帶「短剣更容易出現」時算出來的加成表。
      const loadout = [{ memId: "m1", size: "s", effects: [{ id: "rm_wp_dagger_find" }] }];
      const bonus = MN._debugRelicMemoryDiscoveryBonus(loadout);

      // 統計：抽 N 次，短劍的出現率應該逼近 1/n + 0.10。
      const N = 60000;
      let dagger = 0;
      let katana = 0;
      for (let i = 0; i < N; i++) {
        const id = CD.pickCategoryIdWithBonus(cats, bonus);
        if (id === "dagger") dagger++;
        else if (id === "katana") katana++;
      }
      // 沒有加成時的基準。
      let daggerBase = 0;
      for (let i = 0; i < N; i++) {
        if (CD.pickCategoryIdWithBonus(cats, null) === "dagger") daggerBase++;
      }

      // 兩個不同類別各帶一條。
      const two = [
        { memId: "m1", size: "s", effects: [{ id: "rm_wp_dagger_find" }] },
        { memId: "m2", size: "s", effects: [{ id: "rm_wp_katana_find" }] },
      ];
      const bonusTwo = MN._debugRelicMemoryDiscoveryBonus(two);
      // 同一條帶兩顆（stackable:false → 只算一次）。
      const dup = [
        { memId: "m1", size: "s", effects: [{ id: "rm_wp_dagger_find" }] },
        { memId: "m2", size: "s", effects: [{ id: "rm_wp_dagger_find" }] },
      ];
      const bonusDup = MN._debugRelicMemoryDiscoveryBonus(dup);

      return {
        findCount: findCount,
        catCount: n,
        bonus: bonus,
        bonusTwo: bonusTwo,
        bonusDup: bonusDup,
        noneBonus: MN._debugRelicMemoryDiscoveryBonus([]),
        daggerRate: dagger / N,
        katanaRate: katana / N,
        daggerBaseRate: daggerBase / N,
        expectBoost: 1 / n + 0.1,
        expectRest: (1 - 1 / n - 0.1) / (n - 1),
      };
    });

    assert(disc.findCount === 32, "「潜在する力から、○○を見つけやすくなる」32 條全部對應到 category（實得 " + disc.findCount + "）");
    assert(disc.noneBonus === null, "沒帶記憶時不產生加成表（回 null）");
    assert(
      disc.bonus && Math.abs(disc.bonus.dagger - 0.1) < 1e-9 && Object.keys(disc.bonus).length === 1,
      "帶「短剣更容易出現」→ 加成表只有 dagger: +0.10（實得 " + JSON.stringify(disc.bonus) + "）"
    );
    assert(
      disc.bonusTwo && Math.abs(disc.bonusTwo.dagger - 0.1) < 1e-9 && Math.abs(disc.bonusTwo.katana - 0.1) < 1e-9,
      "兩個不同類別各帶一條 → 兩邊各 +0.10（實得 " + JSON.stringify(disc.bonusTwo) + "）"
    );
    assert(
      disc.bonusDup && Math.abs(disc.bonusDup.dagger - 0.1) < 1e-9,
      "同一條帶兩顆（stackable:false）→ 仍是 +0.10，不疊成 0.20（實得 " + JSON.stringify(disc.bonusDup) + "）"
    );
    assert(
      Math.abs(disc.daggerBaseRate - 1 / disc.catCount) < 0.01,
      "沒有加成時短劍出現率 ≈ 1/" + disc.catCount + " = " + (1 / disc.catCount).toFixed(4) + "（實得 " + disc.daggerBaseRate.toFixed(4) + "）"
    );
    assert(
      Math.abs(disc.daggerRate - disc.expectBoost) < 0.01,
      "帶一條後短劍出現率 ≈ " + disc.expectBoost.toFixed(4) + "（3.1% + 10%），實得 " + disc.daggerRate.toFixed(4)
    );
    assert(
      Math.abs(disc.katanaRate - disc.expectRest) < 0.01,
      "其餘類別按比例縮減到 ≈ " + disc.expectRest.toFixed(4) + "，實得 " + disc.katanaRate.toFixed(4)
    );

    console.log("");
    console.log("-- 第 4 期：出撃時の武器への付加（7 條）＋ 附加連動（1 條）--");
    const inf = await page.evaluate(() => {
      const MN = window.PriTestMidnight;
      const CASES = [
        ["rm_infuse_magic", "魔", true],
        ["rm_infuse_fire", "炎", true],
        ["rm_infuse_lightning", "雷", true],
        ["rm_infuse_holy", "聖", true],
        ["rm_infuse_poison", "猛毒", false],
        ["rm_infuse_bleed", "出血", false],
        ["rm_infuse_frost", "凍傷", false],
      ];
      const rows = CASES.map(([id, label, isElement]) => {
        const r = MN._debugRelicMemoryInfusion([{ memId: "m1", size: "s", effects: [{ id: id }] }], "wTest");
        return { id: id, label: label, isElement: isElement, temps: r.temps, onInfuseActive: r.onInfuseActive };
      });

      // 兩種屬性一起帶 → 只有帶入順序第一條發動（2026-09-25 使用者明確規格「玩家裝備裝上
      // 不同科的不可重複效果時 只會發動前面一個的效果」；舊期望值是兩條都掛上）。
      const two = MN._debugRelicMemoryInfusion(
        [
          { memId: "m1", size: "s", effects: [{ id: "rm_infuse_fire" }] },
          { memId: "m2", size: "s", effects: [{ id: "rm_infuse_bleed" }] },
        ],
        "wTest"
      );
      // 同一種帶兩次 → 只掛一條（附加就是附加，不疊加）。
      const dup = MN._debugRelicMemoryInfusion(
        [
          { memId: "m1", size: "s", effects: [{ id: "rm_infuse_fire" }] },
          { memId: "m2", size: "s", effects: [{ id: "rm_infuse_fire" }] },
        ],
        "wTest"
      );
      // 附加屬性 ＋ 帶「附加時屬性攻擊力上昇」→ 5 秒內屬性攻擊 +8%。
      const combo = MN._debugRelicMemoryInfusion(
        [
          { memId: "m1", size: "s", effects: [{ id: "rm_infuse_fire" }] },
          { memId: "m2", size: "s", effects: [{ id: "rm_on_infuse_element_atk_up" }] },
        ],
        "wTest"
      );
      // 只附加異常（不是屬性）→ 不該觸發「属性攻撃力が付加された時」。
      const ailmentOnly = MN._debugRelicMemoryInfusion(
        [
          { memId: "m1", size: "s", effects: [{ id: "rm_infuse_bleed" }] },
          { memId: "m2", size: "s", effects: [{ id: "rm_on_infuse_element_atk_up" }] },
        ],
        "wTest"
      );
      const none = MN._debugRelicMemoryInfusion([], "wTest");
      return { rows: rows, two: two, dup: dup, combo: combo, ailmentOnly: ailmentOnly, none: none };
    });

    const infWrong = inf.rows.filter(
      (r) => r.temps.length !== 1 || r.temps[0].label !== r.label || r.temps[0].isElement !== r.isElement || !r.temps[0].forever
    );
    assert(
      infWrong.length === 0,
      "7 條各自附加正確的屬性／異常，且整場有效" +
        (infWrong.length ? "\n        " + infWrong.map((r) => r.id + " → 期望 " + r.label + "，實得 " + JSON.stringify(r.temps)).join("\n        ") : "")
    );
    assert(inf.none.temps.length === 0, "沒帶記憶時不附加任何東西");
    assert(
      inf.two.temps.length === 1 && inf.two.temps[0].label === "炎",
      "炎＋出血一起帶 → 只發動第一條（炎）（實得 " + JSON.stringify(inf.two.temps) + "）"
    );
    assert(inf.dup.temps.length === 1, "同一種帶兩顆 → 只掛 1 條，不疊加（實得 " + inf.dup.temps.length + "）");
    assert(inf.combo.onInfuseActive, "附加屬性後「属性攻撃力が付加された時」的視窗開啟");
    assert(
      Math.abs(inf.combo.mult - 1.08) < 1e-9,
      "視窗內屬性攻擊倍率 1.08（實得 " + inf.combo.mult + "）"
    );
    assert(
      Math.abs(inf.combo.multNoElement - 1.0) < 1e-9,
      "非屬性攻擊不受影響（實得 " + inf.combo.multNoElement + "）"
    );
    assert(!inf.ailmentOnly.onInfuseActive, "只附加異常（出血）不算「屬性被附加」，視窗不開啟");

    // ------------------------------------------------------------ 第 3 期：能力值
    console.log("");
    console.log("-- 第 3 期：能力值（29 條）--");
    const stat = await page.evaluate(() => {
      const MN = window.PriTestMidnight;
      const CAT = window.PriTestMidnightRelicMemoryCatalog;
      const mk = (id, value) => [{ memId: "m1", size: "s", effects: [{ id: id, value: value }] }];
      const base = MN._debugRelicMemoryStats([], 15, 5);

      // 威力補正 6 條（值由 range 擲定）。
      const powerRows = Object.keys(CAT.POWER_MOD_STAT_OF).map((id) => {
        const r = MN._debugRelicMemoryStats(mk(id, 3), 15, 5);
        return { id: id, stat: CAT.POWER_MOD_STAT_OF[id], got: r.powerMod, range: CAT.effect(id).range };
      });

      // 角色專用的能力值互換 20 條：逐條比對換算表。
      const swapRows = Object.keys(CAT.STAT_SWAPS).map((id) => {
        const r = MN._debugRelicMemoryStats(mk(id, null), 15, 5);
        return {
          id: id,
          want: CAT.STAT_SWAPS[id],
          powerMod: r.powerMod,
          hp: r.swaps.hp,
          fp: r.swaps.fp,
          stamina: r.staminaSwap,
          hpMax: r.hpMax,
          fpMax: r.fpMax,
          staminaMax: r.staminaMax,
        };
      });

      // 百分比 3 條：HP／FP／體力上限。
      const pct = {
        hp: MN._debugRelicMemoryStats(mk("rm_stat_vigor", 5), 15, 5),
        fp: MN._debugRelicMemoryStats(mk("rm_stat_mind", 4), 15, 5),
        st: MN._debugRelicMemoryStats(mk("rm_stat_endurance", 3), 15, 5),
      };

      // stackable：筋力那 6 條是 true（相加），互換 20 條是 false（只算一次）。
      const stackTwo = MN._debugRelicMemoryStats(
        [
          { memId: "ma", size: "s", effects: [{ id: "rm_stat_strength", value: 1 }] },
          { memId: "mb", size: "s", effects: [{ id: "rm_stat_strength", value: 3 }] },
        ],
        15,
        5
      );
      const dupSwap = MN._debugRelicMemoryStats(
        [
          { memId: "ma", size: "s", effects: [{ id: "rm_scholar_mind_up_vig_down" }] },
          { memId: "mb", size: "s", effects: [{ id: "rm_scholar_mind_up_vig_down" }] },
        ],
        15,
        5
      );
      return { base: base, powerRows: powerRows, swapRows: swapRows, pct: pct, stackTwo: stackTwo, dupSwap: dupSwap };
    });

    assert(
      Object.keys(stat.base.powerMod).every((k) => stat.base.powerMod[k] === 0) && stat.base.swaps.hp === 0 && stat.base.swaps.fp === 0,
      "沒帶記憶時威力補正與能力值互換都是 0"
    );

    const powerWrong = stat.powerRows.filter((r) => {
      const keys = Object.keys(r.got);
      return r.got[r.stat] !== 3 || keys.some((k) => k !== r.stat && r.got[k] !== 0);
    });
    assert(
      powerWrong.length === 0,
      "威力補正 6 條各自只加到自己那一項（擲定值 3）" +
        (powerWrong.length ? "\n        " + powerWrong.map((r) => r.id + " → " + r.stat + "：" + JSON.stringify(r.got)).join("\n        ") : "")
    );
    const rangeWrong = stat.powerRows.filter((r) => !r.range || r.range[0] !== 1 || r.range[1] !== 3);
    assert(rangeWrong.length === 0, "威力補正 6 條的範圍都是 [1,3]（強靭度＝平衡也在內）");

    const swapWrong = stat.swapRows.filter((r) => {
      const pm = r.want.powerMod || {};
      const pmWrong = Object.keys(r.powerMod).some((k) => r.powerMod[k] !== (pm[k] || 0));
      return pmWrong || r.hp !== (r.want.hp || 0) || r.fp !== (r.want.fp || 0) || r.stamina !== (r.want.stamina || 0);
    });
    assert(
      swapWrong.length === 0,
      "角色專用的能力值互換 " +
        stat.swapRows.length +
        " 條全部照換算表生效" +
        (swapWrong.length
          ? "\n        " +
            swapWrong
              .map(
                (r) =>
                  r.id +
                  "：期望 " +
                  JSON.stringify(r.want) +
                  "，實得 " +
                  JSON.stringify({ powerMod: r.powerMod, hp: r.hp, fp: r.fp, stamina: r.stamina })
              )
              .join("\n        ")
          : "")
    );
    assert(stat.swapRows.length === 20, "換算表是 20 條（實得 " + stat.swapRows.length + "）");

    // 真的進到上限計算：學者「精神力上昇、生命力低下」＝ FP+20／HP-20。
    const scholar = stat.swapRows.filter((r) => r.id === "rm_scholar_mind_up_vig_down")[0];
    assert(
      scholar && scholar.hpMax === stat.base.hpMax - 20 && scholar.fpMax === stat.base.fpMax + 20,
      "flat 的互換真的改到 selfArenaHpMax／selfFpMax（HP " +
        stat.base.hpMax +
        "→" +
        (scholar && scholar.hpMax) +
        "、FP " +
        stat.base.fpMax +
        "→" +
        (scholar && scholar.fpMax) +
        "）"
    );
    const hermit = stat.swapRows.filter((r) => r.id === "rm_hermit_vig_end_dex_up_int_fth_down")[0];
    assert(
      hermit && hermit.staminaMax === stat.base.staminaMax + 15,
      "體力上限的互換也生效（" + stat.base.staminaMax + "→" + (hermit && hermit.staminaMax) + "）"
    );

    assert(
      stat.pct.hp.hpMax === Math.round(stat.base.hpMax * 1.05),
      "生命力+1/2/3 擲到 5 → HP 上限 ×1.05 = " + Math.round(stat.base.hpMax * 1.05) + "（實得 " + stat.pct.hp.hpMax + "）"
    );
    assert(
      stat.pct.fp.fpMax === Math.round(stat.base.fpMax * 1.04),
      "精神力+1/2/3 擲到 4 → FP 上限 ×1.04 = " + Math.round(stat.base.fpMax * 1.04) + "（實得 " + stat.pct.fp.fpMax + "）"
    );
    assert(
      stat.pct.st.staminaMax === Math.round(stat.base.staminaMax * 1.03),
      "持久力+1/2/3 擲到 3 → 體力上限 ×1.03 = " + Math.round(stat.base.staminaMax * 1.03) + "（實得 " + stat.pct.st.staminaMax + "）"
    );
    assert(stat.pct.hp.fpMax === stat.base.fpMax, "生命力那條不會影響 FP 上限");

    assert(stat.stackTwo.powerMod.strength === 4, "筋力（stackable）帶 2 顆 1+3 → +4（實得 " + stat.stackTwo.powerMod.strength + "）");
    assert(
      stat.dupSwap.swaps.fp === 20 && stat.dupSwap.swaps.hp === -20,
      "能力值互換（不可疊加）帶 2 顆只算一次（實得 FP " + stat.dupSwap.swaps.fp + "／HP " + stat.dupSwap.swaps.hp + "）"
    );

    // ------------------------------------------- 第 4 期：戰技／魔術的置換
    console.log("");
    console.log("-- 第 4 期：出撃時の武器の戦技／魔術置換（28 條）--");
    const swap = await page.evaluate(() => {
      const MN = window.PriTestMidnight;
      const CAT = window.PriTestMidnightRelicMemoryCatalog;
      const W = window.PriTestWeapons;
      // 找一把「自己有戰技枠、不是盾」的武器來驗替換。
      const target = (W.list() || []).filter((w) => {
        const cat = W.getCategory(w.category);
        return cat && !cat.isShield && (w.skills || []).some((r) => r.kind === "art");
      })[0];
      const wid = target ? target.id : null;
      const probe = MN._debugRelicMemorySkillSwap([], wid);
      const one = MN._debugRelicMemorySkillSwap([{ memId: "m1", size: "s", effects: [{ id: "rm_skillswap_endure" }] }], wid);
      // 帶兩條置換 → 只採第一條。
      const two = MN._debugRelicMemorySkillSwap(
        [
          { memId: "m1", size: "s", effects: [{ id: "rm_skillswap_endure" }] },
          { memId: "m2", size: "s", effects: [{ id: "rm_spellswap_night_shard" }] },
        ],
        wid
      );
      const drawableSwaps = CAT.drawableEffects().filter((e) => e.kind === "grantWeaponSkill" || e.kind === "grantSpell");
      const allSwaps = CAT.EFFECTS.filter((e) => e.kind === "grantWeaponSkill" || e.kind === "grantSpell");
      const drawableIds = {};
      drawableSwaps.forEach((e) => {
        drawableIds[e.id] = true;
      });
      return {
        targetId: wid,
        missing: probe.missing,
        swapCount: Object.keys(probe.skillIdMap).length,
        probeSwap: probe.swap,
        probeIds: probe.ids,
        baseIds: probe.baseIds,
        oneIds: one.ids,
        oneSwap: one.swap,
        twoSwap: two.swap,
        drawableCount: drawableSwaps.length,
        allCount: allSwaps.length,
        notDrawable: allSwaps.filter((e) => !drawableIds[e.id]).map((e) => e.id),
      };
    });

    assert(swap.missing.length === 0, "置換表指向的招式全部存在於 weapons_skills.js" + (swap.missing.length ? "：" + swap.missing.join("、") : ""));
    assert(swap.swapCount === 28, "置換表有 28 條（20 戰技 − 2 缺資料 ＋ 10 魔術／祈禱，實得 " + swap.swapCount + "）");
    assert(swap.allCount === 30 && swap.drawableCount === 28, "目錄上 30 條，抽得到的是 28 條（實得 " + swap.drawableCount + "）");
    assert(
      swap.notDrawable.length === 2 &&
        swap.notDrawable.indexOf("rm_skillswap_storm_stomp") >= 0 &&
        swap.notDrawable.indexOf("rm_skillswap_determination") >= 0,
      "被排除的正好是缺招式資料的「嵐脚」「デターミネーション」（實得 " + swap.notDrawable.join("、") + "）"
    );
    assert(swap.probeSwap === null && JSON.stringify(swap.probeIds) === JSON.stringify(swap.baseIds), "沒帶記憶時戰技枠完全不變");
    assert(
      swap.oneSwap && swap.oneSwap.skillId === "art_endure" && swap.oneIds[0] === "art_endure",
      "帶「戦技を我慢にする」→ 第 1 個戰技枠換成 art_endure（實得 " + JSON.stringify(swap.oneIds) + "）"
    );
    assert(swap.oneIds.length === swap.baseIds.length, "是替換不是追加：枠數不變（" + swap.baseIds.length + " → " + swap.oneIds.length + "）");
    assert(swap.oneIds.indexOf(swap.baseIds[0]) < 0, "原本第 1 個枠的戰技被換掉了（不會兩個並存）");
    assert(swap.twoSwap && swap.twoSwap.skillId === "art_endure", "同時帶兩條置換只採第一條（實得 " + (swap.twoSwap && swap.twoSwap.skillId) + "）");

    // ------------------------------------------- 第 4 期：魔術／祈禱的系統別
    console.log("");
    console.log("-- 第 4 期：魔術／祈禱的系統別威力（14 條）--");
    const school = await page.evaluate(() => {
      const MN = window.PriTestMidnight;
      const info = MN._debugRelicMemorySpellSchools();
      const ids = Object.keys(info.schools);
      const rows = ids.map((id) => {
        const label = info.schools[id].label;
        const loadout = [{ memId: "m1", size: "s", effects: [{ id: id, value: 10 }] }];
        return {
          id: id,
          label: label,
          skillCount: info.schools[id].skillCount,
          hit: MN._debugRelicMemoryOutgoingMult(loadout, { sorcery: true, spellSchool: label }),
          miss: MN._debugRelicMemoryOutgoingMult(loadout, { sorcery: true, spellSchool: "xx-not-a-school" }),
          noSchool: MN._debugRelicMemoryOutgoingMult(loadout, { sorcery: true }),
        };
      });
      return { count: ids.length, rows: rows, labelCounts: info.labelCounts };
    });

    assert(school.count === 14, "系統別 14 條全部接上（實得 " + school.count + "）");
    const noSkill = school.rows.filter((r) => r.skillCount === 0);
    assert(
      noSkill.length === 0,
      "14 種系統名在 weapons_skills.js 的 kindLabel 裡都找得到招式" + (noSkill.length ? "：" + noSkill.map((r) => r.label).join("、") : "")
    );
    const schoolWrong = school.rows.filter((r) => Math.abs(r.hit - 1.1) > 1e-9);
    assert(
      schoolWrong.length === 0,
      "帶該系統的記憶（擲到 10%）施放同系統 → 倍率 1.10" +
        (schoolWrong.length ? "\n        " + schoolWrong.map((r) => r.label + "：實得 " + r.hit).join("\n        ") : "")
    );
    assert(
      school.rows.every((r) => Math.abs(r.miss - 1.0) < 1e-9 && Math.abs(r.noSchool - 1.0) < 1e-9),
      "施放別的系統／沒有系統別的招式時不加成"
    );

    // ------------------------------------------- 第 3／4 期覆蓋率
    console.log("");
    console.log("-- 第 3／4 期覆蓋率 --");
    const cov3 = await page.evaluate(() => {
      const MN = window.PriTestMidnight;
      const CAT = window.PriTestMidnightRelicMemoryCatalog;
      const P3 = ["levelStat", "poise"];
      const P4 = ["spellSchool", "grantWeaponSkill", "grantSpell"];
      const wired = {};
      MN._debugRelicMemoryWiredIds().forEach((id) => {
        wired[id] = true;
      });
      const want = (kinds) => CAT.drawableEffects().filter((e) => kinds.indexOf(e.kind) >= 0);
      return {
        p3Count: want(P3).length,
        p3Missing: want(P3)
          .filter((e) => !wired[e.id])
          .map((e) => e.id),
        p4Count: want(P4).length,
        p4Missing: want(P4)
          .filter((e) => !wired[e.id])
          .map((e) => e.id),
        totalWired: Object.keys(wired).length,
      };
    });
    assert(cov3.p3Count === 29, "第 3 期範圍是 29 條（levelStat 28 ＋ poise 1，實得 " + cov3.p3Count + "）");
    assert(cov3.p3Missing.length === 0, "第 3 期 29 條全部有注入點" + (cov3.p3Missing.length ? "，還缺：" + cov3.p3Missing.join("、") : ""));
    assert(cov3.p4Count === 42, "第 4 期剩下的可抽選效果是 42 條（14 ＋ 18 ＋ 10，實得 " + cov3.p4Count + "）");
    assert(cov3.p4Missing.length === 0, "這 42 條全部有注入點" + (cov3.p4Missing.length ? "，還缺：" + cov3.p4Missing.join("、") : ""));
    console.log("    （累計已接 " + cov3.totalWired + " 條：第 1 期 56 ＋ 第 2 期 93 ＋ 第 3 期 29 ＋ 第 4 期 50）");
    assert(cov3.totalWired >= 228, "累計至少已接 228 條（第 1〜4 期，實得 " + cov3.totalWired + "）");


    // ------------------------------------------- 第 6 期：武器類別持有 3 把（29 條）
    console.log("");
    console.log("-- 第 6 期：武器類別持有 3 把以上（29 條）--");
    const set3 = await page.evaluate(() => {
      const MN = window.PriTestMidnight;
      const W = window.PriTestWeapons;
      const probe = MN._debugRelicMemorySet3([], [], "set3atk");
      const maps = probe.maps;
      // 每一條的 category id 都必須真的存在於 weapons.js（對錯了會靜默失效）。
      const catIds = {};
      (W.categories() || []).forEach((c) => (catIds[c.id] = true));
      const bad = [];
      const rows = [];
      ["set3atk", "set3hp", "set3fp"].forEach((kind) => {
        Object.keys(maps[kind]).forEach((effectId) => {
          const categoryId = maps[kind][effectId];
          if (!catIds[categoryId]) bad.push(effectId + " → " + categoryId);
          // 持有 2 把 → 不到門檻；3 把 → 拿到該 kind 的固定值。
          const ids2 = [];
          const ids3 = [];
          (W.list() || []).forEach((w) => {
            if (w.category !== categoryId) return;
            if (ids3.length < 3) ids3.push(w.id);
            if (ids2.length < 2) ids2.push(w.id);
          });
          const loadout = [{ memId: "m1", size: "s", effects: [{ id: effectId }] }];
          rows.push({
            effectId: effectId,
            kind: kind,
            categoryId: categoryId,
            haveEnough: ids3.length >= 3,
            two: MN._debugRelicMemorySet3(loadout, ids2, kind).total,
            three: MN._debugRelicMemorySet3(loadout, ids3, kind).total,
            want: probe.values[kind],
          });
        });
      });
      // 別的類別湊滿 3 把不會讓這一條生效。
      const dagger = Object.keys(maps.set3atk).filter((id) => maps.set3atk[id] === "dagger")[0];
      const katanaIds = (W.list() || []).filter((w) => w.category === "katana").slice(0, 3).map((w) => w.id);
      const wrongCat = dagger
        ? MN._debugRelicMemorySet3([{ memId: "m1", size: "s", effects: [{ id: dagger }] }], katanaIds, "set3atk").total
        : null;
      return {
        counts: { atk: Object.keys(maps.set3atk).length, hp: Object.keys(maps.set3hp).length, fp: Object.keys(maps.set3fp).length },
        required: probe.required,
        values: probe.values,
        bad: bad,
        rows: rows,
        wrongCat: wrongCat,
        emptyTotal: probe.total,
      };
    });

    assert(
      set3.counts.atk === 24 && set3.counts.hp === 3 && set3.counts.fp === 2,
      "29 條全部對應到 category（攻擊 24／盾 3／杖聖印 2，實得 " + JSON.stringify(set3.counts) + "）"
    );
    assert(set3.bad.length === 0, "對應到的 category id 都存在於 weapons.js" + (set3.bad.length ? "：" + set3.bad.join("、") : ""));
    assert(set3.emptyTotal === 0, "沒帶記憶時加成是 0");
    assert(set3.required === 3, "門檻是持有 3 把（實得 " + set3.required + "）");
    const set3Under = set3.rows.filter((r) => r.two !== 0);
    assert(set3Under.length === 0, "持有 2 把時不到門檻、加成 0" + (set3Under.length ? "：" + set3Under.map((r) => r.effectId).join("、") : ""));
    const set3Over = set3.rows.filter((r) => r.haveEnough && r.three !== r.want);
    assert(
      set3Over.length === 0,
      "持有 3 把時拿到該類的固定值（攻擊 10%／盾 40HP／杖聖印 25FP）" +
        (set3Over.length ? "\n        " + set3Over.map((r) => r.effectId + "：期望 " + r.want + "，實得 " + r.three).join("\n        ") : "")
    );
    assert(set3.wrongCat === 0, "湊滿的是別的武器類別時不生效（實得 " + set3.wrongCat + "）");

    // ------------------------------------------- 第 6 期：敵人異常狀態的 10 秒視窗（6 條）
    console.log("");
    console.log("-- 第 6 期：敵人異常狀態發生後的 10 秒視窗（6 條）--");
    const ail = await page.evaluate(() => {
      const MN = window.PriTestMidnight;
      const CASES = [
        ["rm_vs_poisoned", "猛毒", "腐敗"],
        ["rm_vs_rotted", "腐敗", "猛毒"],
        ["rm_vs_frostbitten", "凍傷", "猛毒"],
        ["rm_nearby_poison_rot_atk", "猛毒", "睡眠"],
        ["rm_nearby_sleep_atk", "睡眠", "猛毒"],
        ["rm_nearby_madness_atk", "発狂", "猛毒"],
      ];
      const rows = CASES.map(([id, hit, miss]) => {
        const loadout = [{ memId: "m1", size: "s", effects: [{ id: id, value: 10 }] }];
        return {
          id: id,
          hit: MN._debugRelicMemoryAilmentAtk(loadout, hit).total,
          miss: MN._debugRelicMemoryAilmentAtk(loadout, miss).total,
          none: MN._debugRelicMemoryAilmentAtk(loadout, null).total,
          mult: MN._debugRelicMemoryAilmentAtk(loadout, hit).mult,
        };
      });
      // 「周囲で毒/腐敗」那條對兩種異常都成立。
      const bothLoadout = [{ memId: "m1", size: "s", effects: [{ id: "rm_nearby_poison_rot_atk", value: 10 }] }];
      const both = {
        poison: MN._debugRelicMemoryAilmentAtk(bothLoadout, "猛毒").total,
        rot: MN._debugRelicMemoryAilmentAtk(bothLoadout, "腐敗").total,
      };
      // 凍傷の隠れ身：敵視歸零。
      const hideLoadout = [{ memId: "m1", size: "s", effects: [{ id: "rm_nearby_frost_hide" }] }];
      const hide = {
        on: MN._debugRelicMemoryAilmentAtk(hideLoadout, "凍傷").frostHide,
        off: MN._debugRelicMemoryAilmentAtk(hideLoadout, "猛毒").frostHide,
      };
      // 全裝置共用（使用者 2026-09-25 明確規格）：視窗的起算點是共享的
      // attributeAccumTriggers 次數變多的那一刻，不是本地事件——隊友打出來的異常也算。
      const shared = [{ memId: "m1", size: "s", effects: [{ id: "rm_vs_poisoned", value: 10 }] }];
      const TK = "sharedTarget"; // 沒有 activeEncounter 時的 targetKey
      const sharedRes = {
        // 只有第 1 份快照（首次回流）→ 只建立基準，不該開窗。
        first: MN._debugRelicMemoryAilmentAtk(shared, null, [{ [TK]: { 猛毒: 3 } }]).total,
        // 次數變多 → 開窗。
        grew: MN._debugRelicMemoryAilmentAtk(shared, null, [{ [TK]: { 猛毒: 3 } }, { [TK]: { 猛毒: 4 } }]).total,
        // 次數沒變 → 不開窗。
        same: MN._debugRelicMemoryAilmentAtk(shared, null, [{ [TK]: { 猛毒: 3 } }, { [TK]: { 猛毒: 3 } }]).total,
        // 別隻敵人（別的 targetKey）身上的異常 → 不開我這邊的窗。
        otherTarget: MN._debugRelicMemoryAilmentAtk(shared, null, [{ pt9: { 猛毒: 3 } }, { pt9: { 猛毒: 9 } }]).total,
        // 別的異常變多 → 不開這條的窗。
        otherName: MN._debugRelicMemoryAilmentAtk(shared, null, [{ [TK]: { 腐敗: 1 } }, { [TK]: { 腐敗: 2 } }]).total,
      };
      return { keys: MN._debugRelicMemoryAilmentAtk([], null).keys, rows: rows, both: both, hide: hide, shared: sharedRes };
    });

    assert(ail.keys.length === 6, "異常視窗 6 條各有一個 bonus key（實得 " + ail.keys.length + "）");
    const ailWrong = ail.rows.filter((r) => r.hit !== 10 || r.miss !== 0 || r.none !== 0);
    assert(
      ailWrong.length === 0,
      "各條只在對應異常觸發後的視窗內生效（擲到 10%）" +
        (ailWrong.length ? "\n        " + ailWrong.map((r) => r.id + "：命中 " + r.hit + "／不符 " + r.miss + "／未觸發 " + r.none).join("\n        ") : "")
    );
    assert(Math.abs(ail.rows[0].mult - 1.1) < 1e-9, "視窗內攻擊倍率 1.10（實得 " + ail.rows[0].mult + "）");
    assert(ail.both.poison === 10 && ail.both.rot === 10, "「周囲で毒/腐敗」對兩種異常都成立");
    assert(ail.hide.on === true && ail.hide.off === false, "「凍傷発生時、姿を隠す」只在凍傷觸發後成立");
    assert(ail.shared.first === 0, "首次收到共享快照只建立基準，不開窗（實得 " + ail.shared.first + "）");
    assert(ail.shared.grew === 10, "共享的觸發次數變多 → 全裝置同時開窗（實得 " + ail.shared.grew + "）");
    assert(ail.shared.same === 0, "次數沒變不開窗（實得 " + ail.shared.same + "）");
    assert(ail.shared.otherTarget === 0, "別隻敵人身上的異常不開我這邊的窗（實得 " + ail.shared.otherTarget + "）");
    assert(ail.shared.otherName === 0, "別的異常變多不開這條的窗（實得 " + ail.shared.otherName + "）");

    // ------------------------------------------- 第 6 期：道具強化與里程碑
    console.log("");
    console.log("-- 第 6 期：道具強化（7 條）與全域里程碑（5 條）--");
    const misc6 = await page.evaluate(() => {
      const MN = window.PriTestMidnight;
      const mk = (id, value) => [{ memId: "m1", size: "s", effects: [{ id: id, value: value }] }];
      return {
        pot: MN._debugRelicMemoryItemAtk(mk("rm_throwing_pot_atk_up", 12), "item_throwing_pot"),
        potOnKnife: MN._debugRelicMemoryItemAtk(mk("rm_throwing_pot_atk_up", 12), "item_throwing_dagger"),
        // +1 版與一般版走同一個 key，兩條都帶會相加（stackable: true）。
        potBoth: MN._debugRelicMemoryItemAtk(
          [
            { memId: "ma", size: "s", effects: [{ id: "rm_throwing_pot_atk_up", value: 8 }] },
            { memId: "mb", size: "s", effects: [{ id: "rm_throwing_pot_atk_up_1", value: 12 }] },
          ],
          "item_throwing_pot"
        ),
        knife: MN._debugRelicMemoryItemAtk(mk("rm_throwing_knife_atk_up", 9), "item_azure_throwing_knife"),
        perfume: MN._debugRelicMemoryItemAtk(mk("rm_perfume_up", 11), "item_perfume_acid_spray"),
        perfumeOnPot: MN._debugRelicMemoryItemAtk(mk("rm_perfume_up", 11), "item_throwing_pot"),
        none: MN._debugRelicMemoryItemAtk([], "item_throwing_pot"),
        milestones: ["rmMilestoneTowerFp", "rmMilestoneCathedralHp", "rmMilestoneCampStamina", "rmMilestoneRuinsArcane", "rmMilestonePrisonAtk"].map((key) => {
          const idMap = {
            rmMilestoneTowerFp: "rm_milestone_tower_fp",
            rmMilestoneCathedralHp: "rm_milestone_cathedral_hp",
            rmMilestoneCampStamina: "rm_milestone_camp_stamina",
            rmMilestoneRuinsArcane: "rm_milestone_ruins_arcane",
            rmMilestonePrisonAtk: "rm_milestone_prison_atk",
          };
          const r = MN._debugRelicMemoryMilestone(mk(idMap[key], null), key, 3);
          return { key: key, per: r.per, total: r.total, cards: r.cards };
        }),
      };
    });

    assert(misc6.none === 0, "沒帶記憶時道具加成 0");
    assert(misc6.pot === 12 && misc6.potOnKnife === 0, "投擲壺那條只對投擲壺生效（壺 " + misc6.pot + "／刀 " + misc6.potOnKnife + "）");
    assert(misc6.potBoth === 20, "投擲壺的一般版＋「+1」版走同一個注入點並相加 8+12=20（實得 " + misc6.potBoth + "）");
    assert(misc6.knife === 9, "投擲ナイフ那條對蒼火的投擲刀生效（實得 " + misc6.knife + "）");
    assert(misc6.perfume === 11 && misc6.perfumeOnPot === 0, "調香術那條只對調香瓶生效（瓶 " + misc6.perfume + "／壺 " + misc6.perfumeOnPot + "）");
    const msWant = { rmMilestoneTowerFp: 10, rmMilestoneCathedralHp: 5, rmMilestoneCampStamina: 5, rmMilestoneRuinsArcane: 2, rmMilestonePrisonAtk: 8 };
    const msWrong = misc6.milestones.filter((m) => m.per !== msWant[m.key] || m.total !== msWant[m.key] * 3);
    assert(
      msWrong.length === 0,
      "5 條里程碑的單次加成與「達成 3 次」的累計都正確" +
        (msWrong.length ? "\n        " + msWrong.map((m) => m.key + "：per " + m.per + "／total " + m.total).join("\n        ") : "")
    );
    const cards = misc6.milestones[0].cards;
    assert(
      cards["rmMilestoneCathedralHp"] === "2" && cards["rmMilestoneCampStamina"] === "4" && cards["rmMilestoneRuinsArcane"] === "5" && cards["rmMilestonePrisonAtk"] === "9",
      "里程碑對應的場地卡編號正確（大教会2／大野営地4／遺跡5／封牢9，實得 " + JSON.stringify(cards) + "）"
    );


    // ------------------------------------------- 第 5 期：出撃時に持つ道具（18 條）
    console.log("");
    console.log("-- 第 5 期：出撃時に持つ道具（18 條）--");
    const start = await page.evaluate(() => {
      const MN = window.PriTestMidnight;
      const CAT = window.PriTestMidnightRelicMemoryCatalog;
      const probe = MN._debugRelicMemoryStartItems([]);
      // 同一條帶兩顆（stackable: true）→ 發兩份。
      const dup = MN._debugRelicMemoryStartItems([
        { memId: "ma", size: "s", effects: [{ id: "rm_start_fire_pot" }] },
        { memId: "mb", size: "s", effects: [{ id: "rm_start_fire_pot" }] },
      ]);
      // 屬性壺／屬性脂各自帶著正確的 tag。
      const tagged = MN._debugRelicMemoryStartItems([
        { memId: "m1", size: "l", effects: [{ id: "rm_start_magic_pot" }, { id: "rm_start_holy_grease" }, { id: "rm_start_shield_grease" }] },
      ]);
      const all = CAT.EFFECTS.filter((e) => e.kind === "startItem");
      return {
        count: probe.count,
        missing: probe.missing,
        counts: probe.counts,
        emptyGrants: probe.grants.length,
        dup: dup.grants,
        tagged: tagged.grants,
        allCount: all.length,
        unmapped: all.filter((e) => !probe.map[e.id]).map((e) => e.id),
        drawableIds: CAT.drawableEffects().reduce((acc, e) => {
          acc[e.id] = true;
          return acc;
        }, {}),
      };
    });

    assert(start.count === 18, "對應表有 18 條（22 − 4 條沒有對應道具，實得 " + start.count + "）");
    assert(start.unmapped.every((id) => !start.drawableIds[id]), "4 條沒有對應道具的已改成抽不到（使用者 2026-09-25 指示「先改為抽不到 只建檔」）");
    assert(start.allCount === 22, "目錄上的 startItem 是 22 條（實得 " + start.allCount + "）");
    assert(
      start.unmapped.length === 4 &&
        ["rm_start_crystal_dart", "rm_start_glintstone_scrap", "rm_start_gravity_stone_chunk", "rm_start_frenzy_perfume"].every((id) => start.unmapped.indexOf(id) >= 0),
      "沒對應的正好是結晶投げ矢／屑輝石／塊の重力石／狂熱の香薬（實得 " + start.unmapped.join("、") + "）"
    );
    assert(start.missing.length === 0, "對應到的 itemId 都存在於 consumables.js" + (start.missing.length ? "：" + start.missing.join("、") : ""));
    assert(start.emptyGrants === 0, "沒帶記憶時不發任何道具");
    const cntWrong = Object.keys(start.counts).filter((k) => !(start.counts[k] >= 1 && start.counts[k] <= 3));
    assert(cntWrong.length === 0, "每一條都從效果名解析得到 1〜3 的數量" + (cntWrong.length ? "：" + cntWrong.join("、") : ""));
    assert(start.counts["rm_start_holy_water_pot"] === 3 && start.counts["rm_start_fire_pot"] === 2 && start.counts["rm_start_acid_spray"] === 1, "數量解析正確（聖水壺 x3／火炎壺 x2／酸の噴霧 x1）");
    assert(
      start.dup.length === 2 && start.dup.every((g) => g.itemId === "item_throwing_pot" && g.tag === "炎" && g.count === 2),
      "同一條帶兩顆（stackable）→ 發兩份，各 2 個火屬性投擲壺（實得 " + JSON.stringify(start.dup) + "）"
    );
    assert(
      start.tagged.length === 3 &&
        start.tagged[0].itemId === "item_throwing_pot" && start.tagged[0].tag === "魔" &&
        start.tagged[1].itemId === "item_grease" && start.tagged[1].tag === "聖" &&
        start.tagged[2].itemId === "item_grease" && start.tagged[2].tag === null,
      "屬性壺／屬性脂帶對 tag，盾脂不帶 tag（實得 " + JSON.stringify(start.tagged) + "）"
    );

    // ------------------------------------------- 第 6 期覆蓋率
    console.log("");
    console.log("-- 第 5／6 期覆蓋率 --");
    const cov6 = await page.evaluate(() => {
      const MN = window.PriTestMidnight;
      const CAT = window.PriTestMidnightRelicMemoryCatalog;
      const wired = {};
      MN._debugRelicMemoryWiredIds().forEach((id) => (wired[id] = true));
      const byKind = {};
      CAT.drawableEffects().forEach((e) => {
        byKind[e.kind] = byKind[e.kind] || { total: 0, wired: 0, missing: [] };
        byKind[e.kind].total++;
        if (wired[e.id]) byKind[e.kind].wired++;
        else byKind[e.kind].missing.push(e.id);
      });
      return { byKind: byKind, totalWired: Object.keys(wired).length, drawable: CAT.drawableEffects().length };
    });

    const K = cov6.byKind;
    const expect6 = {
      // 2026-09-25：rm_party_rune_up／rm_milestone_fort_rune 接上（舊值 special 73、globalMilestone 6）。
      special: [74, 74],
      onGuardSuccess: [5, 5],
      onDamaged: [2, 2],
      aggro: [1, 1],
      flask: [2, 2],
      onWeaponSwap: [2, 2],
      globalMilestone: [7, 7],
      nearDeath: [1, 1],
      startItem: [18, 18],
      // 2026-09-25 第 7 期：結晶雫 22 條中，21 條已接（RM_CRYSTAL_TEARS，見 crystal_tear_check.js）；
      // 剩下的細枝の割れ雫加了 d 旗標、已不在抽選池裡，所以這裡的 total 從 22 降為 21。
      startFlask: [21, 21],
    };
    const cov6Wrong = Object.keys(expect6).filter((k) => !K[k] || K[k].total !== expect6[k][0] || K[k].wired !== expect6[k][1]);
    assert(
      cov6Wrong.length === 0,
      "第 5／6 期各類的接入數符合預期" +
        (cov6Wrong.length
          ? "\n        " + cov6Wrong.map((k) => k + "：期望 " + expect6[k][1] + "/" + expect6[k][0] + "，實得 " + (K[k] ? K[k].wired + "/" + K[k].total : "無")).join("\n        ")
          : "")
    );
    // 2026-09-25：已接入的 id 多了固定遺物專用的 4 條（不在抽選池），因此「仍僅顯示」改成直接數
    // 抽選池中沒有接入的條數，不再用「池條數 − 已接條數」相減（舊寫法會變成 −4）。
    const stillOpen = Object.keys(cov6.byKind).reduce((n, k) => n + cov6.byKind[k].missing.length, 0);
    console.log("    （抽選池中的目錄效果 " + cov6.drawable + " 條，已接 " + cov6.totalWired + " 條，仍僅顯示 " + stillOpen + " 條）");
    // 舊值 361（359 ＋ 盧恩 2 條）；2026-09-25 固定配置遺物的 4 條接上 → 365。
    assert(cov6.totalWired === 365, "累計已接 365 條（361 ＋ 固定遺物專用 4 條，實得 " + cov6.totalWired + "）");
    // 2026-09-25 第 7 期之前這裡是 24（結晶雫 22 ＋ 盧恩 2），第 7 期後 2；盧恩 2 條接上後歸零。
    assert(stillOpen === 0, "抽選池中已沒有只顯示文字的效果（實得 " + stillOpen + "）");

    // ------------------------------------------- 最後 2 條盧恩效果＋互斥組（2026-09-25）
    console.log("");
    console.log("-- 盧恩 2 條＋互斥組 --");
    const last = await page.evaluate(() => {
      const MN = window.PriTestMidnight;
      const CD = window.PriTestCharacterDrawer;
      const CAT = window.PriTestMidnightRelicMemoryCatalog;
      const mem = (memId, ids) => ({ memId: memId, size: "l", effects: ids.map((id) => ({ id: id })) });
      const party = mem("m1", ["rm_party_rune_up"]);
      const fort = mem("m2", ["rm_milestone_fort_rune"]);
      const rune = {
        none: MN._debugRelicMemoryRuneEffects([[], []], [], 0),
        one: MN._debugRelicMemoryRuneEffects([[], [party]], [fort], 3),
        // 多人帶／同一人帶兩顆：仍只 +1（stackable:false）；小砦同一人帶兩顆也只算一次。
        many: MN._debugRelicMemoryRuneEffects([[party, mem("m3", ["rm_party_rune_up"])], [party]], [fort, mem("m4", ["rm_milestone_fort_rune"])], 2),
      };
      // 潛在之力的稀有度擲骰點數加成（character_drawer 的新 rarityBonus 參數）。
      const typeId = window.PriTestCharacterTypes.list()[0].id;
      const pp = [];
      for (let i = 0; i < 30; i++) {
        const r = CD.potentialPowerDrawWeapon({ typeId: typeId, learnedRelicEffects: [], talismanIds: [] }, 2, 3);
        if (r) pp.push({ dice: r.rarityDice.reduce((a, b) => a + b, 0), sum: r.raritySum });
      }
      // 互斥組：整池大記憶抽 3000 顆，同一顆內每組最多一條。
      const groupOf = (id) => CAT.exclusiveGroup(id);
      let violations = 0;
      let startWeaponSeen = 0;
      let tearSeen = 0;
      for (let i = 0; i < 3000; i++) {
        const m = MN._debugNewRelicMemory("l");
        const seen = {};
        m.effects.forEach((e) => {
          const g = groupOf(e.id);
          if (!g) return;
          if (g === "startWeapon") startWeaponSeen++;
          if (g === "crystalTear") tearSeen++;
          if (seen[g]) violations++;
          seen[g] = true;
        });
      }
      // 受控：池裡只剩同組效果時，才會退回同組（湊滿條數優先），這裡只驗組定義。
      const groups = {
        infuse: groupOf("rm_infuse_fire"),
        skill: groupOf("rm_skillswap_endure"),
        spell: groupOf("rm_spellswap_o_flame"),
        tear: groupOf("rm_start_crimson_crystal_tear"),
        plain: groupOf("rm_max_hp_up"),
        attached: groupOf("attack_dmg"),
      };
      // 帶入多顆：同組只有第一條發動。
      const ex1 = MN._debugRelicMemoryExclusiveGroups([mem("a", ["rm_skillswap_endure"]), mem("b", ["rm_infuse_fire", "rm_start_leaden_hardtear"]), mem("c", ["rm_start_crimson_crystal_tear"])]);
      const swapFirst = MN._debugRelicMemorySkillSwap([mem("a", ["rm_infuse_fire"]), mem("b", ["rm_skillswap_endure"])]);
      const infSecond = MN._debugRelicMemoryInfusion([mem("a", ["rm_skillswap_endure"]), mem("b", ["rm_infuse_fire"])], "wTest");
      const tear = MN._debugCrystalTears([mem("a", ["rm_start_leaden_hardtear"]), mem("b", ["rm_start_crimson_crystal_tear"])]);
      return { rune: rune, pp: pp, violations: violations, startWeaponSeen: startWeaponSeen, tearSeen: tearSeen, groups: groups, ex1: ex1, swapFirst: swapFirst, infSecond: infSecond, tearPicked: tear.picked };
    });
    assert(last.rune.none.partyBonus === 0 && last.rune.none.fortPer === 0, "沒帶記憶時盧恩加成 0");
    assert(last.rune.one.partyBonus === 1, "參加者中有人帶「自身と味方の取得ルーン増加」→ 全踏破盧恩 +1");
    assert(last.rune.many.partyBonus === 1, "多人帶／同一人帶兩顆 → 仍只 +1（實得 " + last.rune.many.partyBonus + "）");
    assert(last.rune.one.fortCard === "3", "小砦對應場地卡 card_3");
    assert(last.rune.one.fortPer === 1 && last.rune.one.fortDiscovery === 3, "小砦踏破 3 次 → 發現力 +3（實得 " + last.rune.one.fortDiscovery + "）");
    assert(last.rune.many.fortPer === 1, "小砦效果帶兩顆不疊加（每次仍 +1）");
    assert(
      last.pp.length > 0 && last.pp.every((x) => x.sum === x.dice + 3),
      "潛在之力：rarityBonus 3 → 稀有度點數 = 骰子合計 + 3（樣本 " + last.pp.length + "）"
    );
    assert(
      last.groups.infuse === "startWeapon" && last.groups.skill === "startWeapon" && last.groups.spell === "startWeapon" &&
        last.groups.tear === "crystalTear" && last.groups.plain === null && last.groups.attached === null,
      "互斥組定義：屬性附加／戰技置換／魔術祈禱置換＝startWeapon、結晶雫＝crystalTear（實得 " + JSON.stringify(last.groups) + "）"
    );
    assert(
      last.violations === 0 && last.startWeaponSeen > 0 && last.tearSeen > 0,
      "大記憶 3000 顆：同一顆內同組最多一條（違反 " + last.violations + "，出現 startWeapon " + last.startWeaponSeen + "／結晶雫 " + last.tearSeen + "）"
    );
    assert(
      last.ex1.startWeapon === "rm_skillswap_endure" && last.ex1.crystalTear === "rm_start_leaden_hardtear" &&
        last.ex1.suppressed.join(",") === "rm_infuse_fire,rm_start_crimson_crystal_tear",
      "帶入多顆：同組只發動第一條，其餘標為未發動（實得 " + JSON.stringify(last.ex1) + "）"
    );
    assert(last.swapFirst.swap === null, "第一條是屬性附加時，後面的戰技置換不發動");
    assert(last.infSecond.temps.length === 0, "第一條是戰技置換時，後面的屬性附加不發動");
    assert(last.tearPicked === "rm_start_leaden_hardtear", "結晶雫取帶入順序第一條（實得 " + last.tearPicked + "）");


    // ------------------------------------------- 固定配置遺物的 4 條（2026-09-25 使用者補換算）
    console.log("");
    console.log("-- 固定配置遺物的 4 條 --");
    const fx4 = await page.evaluate(() => {
      const MN = window.PriTestMidnight;
      const W = window.PriTestWeapons.list();
      const melee = W.filter((w) => w.category && !/bow|crossbow|ballista|staff|seal|shield/.test(w.category))[0];
      const bow = W.filter((w) => w.category === "bow")[0] || W.filter((w) => /bow/.test(w.category || ""))[0];
      const mem = (id, value) => [{ memId: "mfx", size: "s", effects: [{ id: id, value: value }] }];
      const m = (loadout, ctx) => MN._debugRelicMemoryOutgoingMult(loadout, ctx);
      const r = {
        meleeId: melee && melee.id,
        bowId: bow && bow.id,
        melee: m(mem("rm_melee_atk_up", 10), { weaponId: melee.id }) / m([], { weaponId: melee.id }),
        meleeArt: m(mem("rm_melee_atk_up", 10), { weaponId: melee.id, art: true }) / m([], { weaponId: melee.id, art: true }),
        meleeBow: bow ? m(mem("rm_melee_atk_up", 10), { weaponId: bow.id }) / m([], { weaponId: bow.id }) : null,
        meleeSorcery: m(mem("rm_melee_atk_up", 10), { weaponId: melee.id, sorcery: true }) / m([], { weaponId: melee.id, sorcery: true }),
        meleeNoWeapon: m(mem("rm_melee_atk_up", 10), {}) / m([], {}),
        art: m(mem("rm_weapon_skill_atk_up", 9), { art: true }) / m([], { art: true }),
        artPlain: m(mem("rm_weapon_skill_atk_up", 9), {}) / m([], {}),
        gaugeBefore: m(mem("rm_ailment_gauge_atk_up", 11), {}) / m([], {}),
      };
      MN._debugRecordReceivedAccum("猛毒", 1);
      r.gaugeAfter = m(mem("rm_ailment_gauge_atk_up", 11), {}) / m([], {});
      MN._debugRecordReceivedAccum("炎", 0); // no-op（屬性不算異常，另外不測）
      return r;
    });
    const near = (a, b) => Math.abs(a - b) < 1e-9;
    assert(near(fx4.melee, 1.1), "近接攻撃力上昇 10%：近戰武器一般攻擊 ×1.10（實得 " + fx4.melee + "）");
    assert(near(fx4.meleeArt, 1.1), "近接攻撃力上昇：近戰武器的戰技也算近距離 ×1.10（實得 " + fx4.meleeArt + "）");
    assert(fx4.meleeBow === null || near(fx4.meleeBow, 1), "近接攻撃力上昇：弓（遠程）不加成（實得 " + fx4.meleeBow + "）");
    assert(near(fx4.meleeSorcery, 1), "近接攻撃力上昇：魔術不加成（實得 " + fx4.meleeSorcery + "）");
    assert(near(fx4.meleeNoWeapon, 1), "近接攻撃力上昇：非武器攻擊（道具等）不加成");
    assert(near(fx4.art, 1.09), "戦技攻撃力上昇 9%：戰技 ×1.09（併進詞條 weaponArtUp，實得 " + fx4.art + "）");
    assert(near(fx4.artPlain, 1), "戦技攻撃力上昇：一般攻擊不加成");
    assert(near(fx4.gaugeBefore, 1), "異常計量表：自身沒有異常蓄積時不加成");
    assert(near(fx4.gaugeAfter, 1.11), "異常計量表：自身猛毒蓄積 >0 後 ×1.11（實得 " + fx4.gaugeAfter + "）");

    const catFx = await page.evaluate(() => {
      const CAT = window.PriTestMidnightRelicMemoryCatalog;
      const ids = ["rm_item_effect_to_allies", "rm_melee_atk_up", "rm_weapon_skill_atk_up", "rm_ailment_gauge_atk_up"];
      const wired = {};
      window.PriTestMidnight._debugRelicMemoryWiredIds().forEach((id) => (wired[id] = true));
      return ids.map((id) => ({ id: id, wired: !!wired[id], range: CAT.effect(id).range, drawable: CAT.drawableEffectIds().indexOf(id) !== -1 }));
    });
    assert(catFx.every((e) => e.wired), "4 條全部接入（" + catFx.filter((e) => !e.wired).map((e) => e.id).join(",") + "）");
    assert(catFx.every((e) => !e.drawable), "4 條仍只出現在固定遺物上（不進抽選池）");
    assert(
      catFx.filter((e) => e.range).every((e) => e.range[0] === 8 && e.range[1] === 12) && catFx.filter((e) => e.range).length === 3,
      "近接／戦技／異常計量表 3 條的範圍是 8~12%"
    );
  } finally {
    await browser.close();
  }

  console.log("");
  console.log(fails ? fails + " FAIL" : "ALL PASS");
  process.exit(fails ? 1 : 0);
})();
