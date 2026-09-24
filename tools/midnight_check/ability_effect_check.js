// ============================================================================
// Playwright 回歸測試：每一招按下去到底有沒有「實質動作」。
// ============================================================================
// 起因：ability_damage_check.js 發現 40 招裡有 24 招（12 個 id × 基礎/變體）威力無法自動
// 解算，走的是「顯示規則原文交給 GM」那條路（CLAUDE.md §19）。問題是——那 24 招是真的
// 有觸發別的效果（蓄積／buff／回復／敵人狀態），還是按下去只跳一行字、什麼都沒發生？
//
// 作法：不讀程式碼猜，直接在真的戰鬥裡按下去，比對前後的每一個可觀測通道：
//
//   enemyHp        敵人HP（fieldEnemyHp）
//   mobHp          雜兵HP（fieldMobHp）
//   accum          對敵人施加的屬性／異常蓄積（attributeAccum）
//   selfHp/fp/sta  自身HP（demoStat）／FP／體力
//   recvAccum      自身承受的蓄積（receivedAttributeAccum）
//   charFields     自己角色物件上變動的欄位（扣掉必然變動的冷卻欄位）
//   metaBuff       party-wide 時限 buff（bloodSongUntil／partyNoDamageUntil／affixHolyGroundUntil）
//   trigFields     這場戰鬥 fieldTrigger 上變動的欄位（扣掉敵人出招排程那幾個雜訊欄位）
//   toast          畫面上那行字
//
// 判定：每一招都必須至少讓「toast 以外」的某一個通道發生變化。只動到 toast＝按了等於
// 沒事發生，那才是真正該回報的問題。
//
// 走 Firebase Local Emulator。前置：
//   1. py -3 generate.py
//   2. py -3 -m http.server 8931 --directory dist
//   3. npx firebase emulators:start --only database,auth --project elden-ring-nightreign
// 執行：node ability_effect_check.js
// ============================================================================

const { chromium } = require("playwright");

const BASE = process.env.PRITEST_BASE_URL || "http://localhost:8931";
const WAIT = 20000;

const results = [];
const pageErrors = [];
function assert(cond, label, extra) {
  results.push({ label, pass: !!cond });
  if (!cond) console.log("  [FAIL] " + label + (extra ? "   " + extra : ""));
}

async function enableEmulatorFlag(page) {
  await page.addInitScript(() => {
    try {
      window.sessionStorage.setItem("pritestRtdbEmulator", "1");
    } catch (e) {}
  });
}

const click = (page, sel) => page.dispatchEvent(sel, "click"); // CLAUDE.md §4.6

async function joinLobbyAndStart(page) {
  await page.click("#midnight-lobby-slots .midnight-slot-empty button");
  await page.fill("#midnight-lobby-passcode-input", "1234");
  await page.click("#btn-midnight-lobby-join");
  await page.waitForFunction(() => !!window.PriTestMidnight._debugState().mySlot, { timeout: WAIT });
  await click(page, "#btn-midnight-lobby-ready");
  await page.waitForFunction(() => !!window.PriTestMidnight._debugState().meta.sessionStartAt, { timeout: WAIT });
}

async function setupEncounter(page) {
  const pointId = await page.evaluate(() => {
    const s = window.PriTestMidnight._debugState();
    const NON_FIELD = { sorcerer: 1, merchant: 1, strong_enemy: 1, random_event: 1, blessing: 1 };
    const pt = (s.map.points || []).filter((p) => !NON_FIELD[p.type])[0];
    if (!pt) return null;
    const participants = {};
    participants[s.mySlot] = true;
    window.PriTestMidnight._debugSetLocalPos(pt.x + 0.5, pt.y + 0.5);
    return window.PriTestGameStorage.rtSet(s.gameId, "cloud", "fieldTrigger/" + pt.id, {
      status: "resolved",
      participants: participants,
      branchIndex: 0,
      floorIndex: 0,
      level: 1,
      // 一定要用**真實**敵人而不是 enemyFamilyId:"test"，而且要有雜兵：守護者「旋風」的
      // 兩個效果分別卡在「有雜兵」與「敵人查得到體型且為 S/M」上，用假敵人＋無雜兵的場景
      // 會把它誤判成「按了沒反應」（第一版就是這樣誤報的）。rat_basilisk/big_rats 是體型 S。
      enemyFamilyId: "rat_basilisk",
      enemyId: "big_rats",
    })
      .then(() => window.PriTestGameStorage.rtSet(s.gameId, "cloud", "fieldEnemyHp/" + pt.id, 100000000))
      .then(() => window.PriTestGameStorage.rtSet(s.gameId, "cloud", "fieldMobHp/" + pt.id, 5000000))
      .then(() => pt.id);
  });
  await page.waitForFunction(() => !!window.PriTestMidnight._debugState().activeEncounter, { timeout: 20000 }).catch(() => {});
  const st = await page.evaluate(() => window.PriTestMidnight._debugState());
  return { pointId, activeEncounter: st.activeEncounter };
}

// 快照要排除的雜訊：
//   角色側：冷卻欄位每次使用必然變動，拿它當「有效果」會讓所有招式無條件通過。
//   trigger側：敵人出招排程（nextAttackAt／enemyAttack／damageBySlot…）跟這一招無關，
//             它每隔幾秒自己就會動。
// elementalMarks／_elementalControlCooldownUntil 是**腳本自己**造成的雜訊：量測前用
// _debugSetElementalMarks()／_debugResetMyAbilityCooldowns() 只改了本地值，沒寫 RTDB，
// 招式使用時的同步會把 RTDB 的舊值蓋回來 → 每一招都會「變化」。第一版沒排除它，結果
// 每一列都掛著 char(_elementalControlCooldownUntil,elementalMarks)，等於這個測試無條件
// 全通過（空轉）。
const CHAR_NOISE = [
  "_artCooldownUntil",
  "_skillCooldownUntil",
  "_powerResonanceCredits",
  "elementalMarks",
  "_elementalControlCooldownUntil",
];
// 經查證「按下去只有 toast」但**不是漏接**的招式：規則上它們本來就不是行動階段的主動
// 招式，不是有傷害沒接上。列在這裡讓測試維持綠燈，同時任何**新增**的空轉招式仍會被抓出來。
const KNOWN_NO_INSTANT_EFFECT = {
  // 2026-09-23 使用者明確規格變更後，爪擊**已經**兩邊效果都會執行（Guard 削減 ▲ ＋
  // 復歸傷害 40）。它之所以仍可能在這支腳本裡顯示「只有 toast」，純粹是這裡的量測限制：
  //   ・guardUnits 在 TRIG_NOISE 裡（敵人出招會自己動），所以 ▲ 只有在「這一下剛好把
  //     Guard 打破」時才會透過 guardBrokenAt 被看見；掃到第 21 列時 Guard 早就破了。
  //   ・復歸傷害需要有倒地的隊友，這支腳本只有 1 個席位。
  // 兩邊效果的正式驗證在 yoto_clawshot_check.js（開兩個席位、Guard 先歸零）。
  claw_shot:
    "已於 2026-09-23 改為兩邊效果一起執行；在這支單人、Guard 已破的掃描場景中觀測不到，" +
    "正式驗證見 yoto_clawshot_check.js。",
  restage:
    "本文是「於階段結束時宣告使用，此階段中若造成 HP損害:■■■以上則追加 HP損害:■」的條件型效果。" +
    "midnight 沒有階段結構，已改由淑女的被動 maybeApplyRestageBonus()（每累積30點傷害追加10點、cd 60秒）承接，按鍵本身沒有即時效果。",
  yoto:
    "本文明寫「可代替『防禦』執行」——它是特殊防禦選項（availableSpecialDefenseOptions() 的 kind:yoto），" +
    "不是行動階段招式；妖刀蓄積是在防禦成功時才 +1。",
};

const TRIG_NOISE = ["nextAttackAt", "enemyAttack", "damageBySlot", "staggerUnits", "guardUnits", "attackSeq"];

async function snapshot(page, pointId) {
  return page.evaluate(
    ({ pointId, CHAR_NOISE, TRIG_NOISE }) => {
      const s = window.PriTestMidnight._debugState();
      const c = s.characters[s.myTokenId] || {};
      const trig = (s.fieldTriggers || {})[pointId] || {};
      // null／undefined 一律當成「這個欄位不存在」：Firebase 會把寫成 null 的鍵整個刪掉，
      // 所以同一個「沒有值」的狀態，在本地是 key=null、回流後是 key 不存在。不正規化的話
      // 這個純粹的表示差異會被算成「這一招產生了效果」——claw_shot／whirlwind／restage／
      // marking／yoto 原本就是靠這個假訊號通過的。
      const pick = (obj, noise) => {
        const out = {};
        Object.keys(obj).forEach((k) => {
          if (noise.indexOf(k) !== -1) return;
          if (obj[k] === null || obj[k] === undefined) return;
          out[k] = JSON.stringify(obj[k]);
        });
        return out;
      };
      const toastEl = document.getElementById("midnight-toast");
      return {
        enemyHp: s.fieldEnemyHp[pointId],
        mobHp: (s.fieldMobHp || {})[pointId],
        accum: JSON.stringify(s.attributeAccum[pointId] || {}),
        selfHp: s.demoStats[s.myTokenId],
        fp: s.fp && s.fp.current,
        stamina: s.stamina && Math.round(s.stamina.current),
        recvAccum: JSON.stringify(s.receivedAttributeAccum || {}),
        charFields: pick(c, CHAR_NOISE),
        trigFields: pick(trig, TRIG_NOISE),
        // party-wide 時限 buff 不要用白名單列舉——第一版只列了3個，結果漏掉
        // 不死行軍寫的 meta/reviveImmuneUntil，害那一招被誤判成「只有 toast」。
        // 改成把 meta 上所有 *Until 欄位一起抓，之後新增的 buff 自動涵蓋。
        metaBuff: JSON.stringify(
          Object.keys(s.meta)
            .filter((k) => /Until$/.test(k))
            .sort()
            .map((k) => k + "=" + s.meta[k])
        ),
        toast: toastEl && !toastEl.hidden ? toastEl.textContent : "",
      };
    },
    { pointId, CHAR_NOISE, TRIG_NOISE }
  );
}

function diffChannels(a, b) {
  const ch = [];
  if (a.enemyHp !== b.enemyHp) ch.push("enemyHp" + (b.enemyHp - a.enemyHp));
  if (a.mobHp !== b.mobHp) ch.push("mobHp");
  if (a.accum !== b.accum) ch.push("accum");
  if (a.selfHp !== b.selfHp) ch.push("selfHp" + (b.selfHp - a.selfHp > 0 ? "+" : "") + (b.selfHp - a.selfHp));
  if (a.fp !== b.fp) ch.push("fp" + (b.fp - a.fp > 0 ? "+" : "") + (b.fp - a.fp));
  if (Math.abs((a.stamina || 0) - (b.stamina || 0)) > 3) ch.push("stamina");
  if (a.recvAccum !== b.recvAccum) ch.push("recvAccum");
  if (a.metaBuff !== b.metaBuff) ch.push("metaBuff");
  const keyDiff = (x, y, tag) => {
    const keys = new Set(Object.keys(x).concat(Object.keys(y)));
    const changed = [...keys].filter((k) => x[k] !== y[k]);
    if (changed.length) ch.push(tag + "(" + changed.join(",") + ")");
  };
  keyDiff(a.charFields, b.charFields, "char");
  keyDiff(a.trigFields, b.trigFields, "trig");
  return ch;
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on("pageerror", (e) => {
    pageErrors.push(String(e && e.message ? e.message : e));
    console.log("  [PAGE ERROR] " + (e && e.message ? e.message : e));
  });

  try {
    await enableEmulatorFlag(page);
    console.log("=== 開局（emulator） ===");
    await page.goto(BASE + "/midnight/index.html", { waitUntil: "networkidle" });
    await page.click("#btn-midnight-create");
    await page.waitForFunction(() => window.PriTestMidnight && window.PriTestMidnight._debugState().meta, { timeout: WAIT });
    await joinLobbyAndStart(page);

    const enc = await setupEncounter(page);
    assert(!!enc.activeEncounter, "戰鬥已建立（activeEncounter 生效）");
    if (!enc.activeEncounter) throw new Error("沒有 activeEncounter");

    const types = await page.evaluate(() =>
      window.PriTestCharacterTypes.list().map((t) => ({ id: t.id, name: t.name.zh }))
    );

    const noEffect = [];
    const rows = [];

    for (const t of types) {
      await page.evaluate((id) => window.PriTestMidnight._debugSetTypeAndLevel(id, 3), t.id);
      for (const kind of ["skill", "art"]) {
        // 時限 buff／蓄積歸零，讓「這一招造成的變化」不跟上一招混在一起。
        await page.evaluate(
          ({ p }) => {
            const s = window.PriTestMidnight._debugState();
            const GS = window.PriTestGameStorage;
            const c = s.characters[s.myTokenId];
            const jobs = [];
            Object.keys(c).forEach((k) => {
              if (/^_.*(Until|ReadyAt)$/.test(k) && typeof c[k] === "number" && c[k] > 0) {
                c[k] = 0;
                jobs.push(GS.rtSet(s.gameId, "cloud", "character/" + s.myTokenId + "/" + k, 0));
              }
            });
            Object.keys(s.meta)
              .filter((k) => /Until$/.test(k))
              .forEach((k) => jobs.push(GS.rtSet(s.gameId, "cloud", "meta/" + k, null)));
            jobs.push(GS.rtSet(s.gameId, "cloud", "attributeAccum/" + p, null));
            jobs.push(GS.rtSet(s.gameId, "cloud", "attributeAccumTriggers/" + p, null));
            // 上一個角色召喚的靈體會留著，而且它的 nextAttackAt 每 6 秒自己就會動，
            // 會被誤判成「這一招有效果」。每次量測前收掉，spirit_summon 自己的召喚
            // 仍然會照常顯示在 charFields 裡。
            c.summonedSpirit = null;
            jobs.push(GS.rtSet(s.gameId, "cloud", "character/" + s.myTokenId + "/summonedSpirit", null));
            return Promise.all(jobs);
          },
          { p: enc.pointId }
        );
        // 固定等待不夠：rtSet(null) 的回流若晚於 before 快照，舊的 summonedSpirit 會在
        // after 快照前才被回流塞回來，被誤判成「這一招召喚了靈體」。必須等到狀態真的
        // 清乾淨再開始量——否則 claw_shot／whirlwind／restage／marking／yoto 這幾招會
        // 靠這個假訊號矇混過關，而那正是這支腳本要查的對象。
        await page
          .waitForFunction(
            (p) => {
              const st = window.PriTestMidnight._debugState();
              const ch = st.characters[st.myTokenId] || {};
              const accum = st.attributeAccum[p];
              return (
                !ch.summonedSpirit &&
                Object.keys(st.meta).filter((k) => /Until$/.test(k)).length === 0 &&
                (!accum || Object.keys(accum).length === 0)
              );
            },
            enc.pointId,
            { timeout: 8000 }
          )
          .catch(() => {});
        await page.waitForTimeout(400);

        const info = await page.evaluate((k) => {
          const M = window.PriTestMidnight;
          M._debugResetMyAbilityCooldowns();
          M._debugSetElementalMarks(9);
          M._debugSetFp(500);
          return M._debugAbilityDamageInfo(k);
        }, kind);

        const before = await snapshot(page, enc.pointId);
        await page.evaluate((k) => window.PriTestMidnight._debugUseCharacterAbility(k), kind);
        await page.waitForTimeout(1400); // 等 RTDB 寫入回流（meta/fieldTrigger 的 buff 都是這樣落地的）
        const after = await snapshot(page, enc.pointId);

        const channels = diffChannels(before, after);
        const toastChanged = before.toast !== after.toast && !!after.toast;
        const hasDamage = info.value !== null;
        rows.push({
          name: t.name,
          kind,
          abilityId: info.abilityId,
          hasDamage,
          channels,
          toastChanged,
        });
        if (!channels.length) noEffect.push(t.name + "／" + kind + "(" + info.abilityId + ")");
      }
    }

    console.log("\n角色／種別          招式                  威力  變化的通道");
    console.log("-".repeat(104));
    rows.forEach((r) => {
      console.log(
        (r.name + "／" + (r.kind === "art" ? "技藝" : "技能")).padEnd(18, "　") +
          r.abilityId.padEnd(23) +
          (r.hasDamage ? "有解算" : "規則原文") +
          "  " +
          (r.channels.length ? r.channels.join(" ") : "（只有 toast" + (r.toastChanged ? "" : "，連 toast 都沒變") + "）")
      );
    });

    // 本命判定：每一招都要有 toast 以外的實質變化。
    rows.forEach((r) => {
      if (!r.channels.length && KNOWN_NO_INSTANT_EFFECT[r.abilityId]) return; // 已查證，見上方清單
      assert(
        r.channels.length > 0,
        r.name + "／" + r.kind + "(" + r.abilityId + ")：有 toast 以外的實質效果",
        "只觀測到 toast"
      );
    });
    assert(pageErrors.length === 0, "全程沒有拋出任何 JS 例外", pageErrors.join(" / "));

    console.log("\n只有文字、沒有任何可觀測狀態變化的招式（" + noEffect.length + "）：");
    if (!noEffect.length) console.log("  （無）");
    noEffect.forEach((d) => {
      const id = d.substring(d.lastIndexOf("(") + 1, d.length - 1);
      const known = KNOWN_NO_INSTANT_EFFECT[id];
      console.log("  " + d + (known ? "  ← 已查證：" + known : "  ← 未列入已知清單，請確認"));
    });
    if (noEffect.length) {
      console.log(
        "\n提醒：上列招式雖然規則上不是行動階段的主動招式，但按下技能鍵目前**仍會吃掉整輪冷卻**" +
          "（useCharacterAbility() 先設冷卻才判斷有沒有效果）。要不要改成按鈕隱藏／提示，是設計決定。"
      );
    }
  } catch (e) {
    console.log("\n[EXCEPTION] " + (e && e.stack ? e.stack : e));
    results.push({ label: "腳本執行中發生例外", pass: false });
  } finally {
    await browser.close();
  }

  const failed = results.filter((r) => !r.pass);
  console.log("\n" + "=".repeat(50));
  console.log(results.length - failed.length + " / " + results.length + " 通過");
  if (failed.length) {
    failed.forEach((f) => console.log("  FAIL: " + f.label));
    process.exit(1);
  }
  console.log("全部通過");
})();
