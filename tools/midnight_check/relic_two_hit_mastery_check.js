// ============================================================================
// 遺物效果「2Hit攻擊的達人（武器種類）」在 midnight（即時制）的回歸測試
// （Firebase Local Emulator 版，環境準備同 emulator_sync_check.js 開頭說明）。
// ============================================================================
// 2026-09-11 使用者明確規格：規則書的「此效果1個階段中僅能發揮1次」＝即時制的
// 「冷卻 10 秒」。驗證項目：
//   1. 裝備對應武器＋習得該遺物後，第3擊（2Hit）的體力消耗會套用覆寫值（大劍：
//      基本⑤⑤=10點→「45」=9點，體力 20→18）。
//   2. 發動後會寫入 character/{tokenId}/_twoHitMasteryCooldownUntil（＝現在+10秒）。
//   3. 冷卻中再打一次 2Hit 不會再發動（消耗回到基本值，冷卻時間戳不被往後延）。
//
// 執行方式：node relic_two_hit_mastery_check.js
// ============================================================================

const { chromium } = require("playwright");

const BASE = process.env.PRITEST_BASE_URL || "http://localhost:8791";
const META_WAIT_MS = 15000;

function assert(cond, label, results) {
  results.push({ label: label, pass: !!cond });
  console.log((cond ? "  [PASS] " : "  [FAIL] ") + label);
}

async function enableEmulatorFlag(page) {
  await page.addInitScript(() => {
    try {
      window.sessionStorage.setItem("pritestRtdbEmulator", "1");
    } catch (e) {
      /* ignore */
    }
  });
}

const st = (page) => page.evaluate(() => window.PriTestMidnight._debugState());

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const results = [];
  page.on("pageerror", (e) => console.log("  [pageerror]", e.message));

  try {
    await enableEmulatorFlag(page);
    await page.goto(BASE + "/midnight/index.html", { waitUntil: "networkidle" });
    await page.click("#btn-midnight-create");
    await page.waitForFunction(() => window.PriTestMidnight && window.PriTestMidnight._debugState().meta, { timeout: META_WAIT_MS });
    await page.click("#midnight-lobby-slots .midnight-slot-empty button");
    await page.fill("#midnight-lobby-passcode-input", "1234");
    await page.click("#btn-midnight-lobby-join");
    await page.waitForFunction(() => !!window.PriTestMidnight._debugState().mySlot, { timeout: META_WAIT_MS });
    await page.click("#btn-midnight-lobby-ready");
    await page.waitForFunction(() => window.PriTestMidnight._debugState().meta.sessionStartAt, { timeout: 20000 });
    await page.waitForTimeout(11000); // 開場動畫

    const s0 = await st(page);
    const gameId = s0.gameId;
    const tokenId = s0.myTokenId;

    // 角色類型に対応する「2Hit攻擊的達人（○○）」を探し、その武器カテゴリの武器を装備、
    // 該当遺物を習得済みにする（習得UIを通さず直接RTDBへ書く——検証対象は習得フローでは
    // なく攻撃コストの適用側なので、既存の他テストと同じく前提だけ直接作る）。
    const setup = await page.evaluate(
      ({ tokenId }) => {
        const CD = window.PriTestCharacterDrawer;
        const CT = window.PriTestCharacterTypes;
        const W = window.PriTestWeapons;
        const state = window.PriTestMidnight._debugState();
        const c = state.characters[tokenId];
        if (!c) return { ok: false, why: "角色資料尚未抵達" };
        const type = CT.get(c.typeId);
        let key = null;
        let effectName = null;
        (type.relicEffectGroups || []).forEach((g, gi) =>
          (g.effects || []).forEach((e, ei) => {
            const n = (e.name && e.name.zh) || "";
            if (!key && n.indexOf("2Hit攻擊的達人") === 0) {
              key = CD.relicEffectKey(type.id, gi, ei);
              effectName = n;
            }
          })
        );
        if (!key) return { ok: false, why: c.typeId + " 沒有 2Hit攻擊的達人 遺物" };
        // 効果名の括弧内カテゴリ名から実際の武器カテゴリを引き当てる
        const catName = effectName.replace(/^.*（/, "").replace(/）$/, "");
        const cat = W.categories().filter((x) => W.localizedText(x.name) === catName)[0];
        if (!cat) return { ok: false, why: "找不到對應武器分類：" + catName };
        const item = W.list().filter((w) => w.category === cat.id)[0];
        if (!item) return { ok: false, why: "分類內沒有武器：" + cat.id };
        return { ok: true, key: key, effectName: effectName, catId: cat.id, itemId: item.id, cost: W.localizedText(cat.basicStats.attackCost) };
      },
      { tokenId }
    );
    if (!setup.ok) {
      console.log("  [SKIP] " + setup.why);
      await browser.close();
      return;
    }
    console.log(`  對象：${setup.effectName} ／ 分類 ${setup.catId} ／ 基本消耗 ${setup.cost}`);

    await page.evaluate(
      ({ gameId, tokenId, key, itemId }) => {
        const GS = window.PriTestGameStorage;
        return GS.rtSet(gameId, "cloud", "character/" + tokenId + "/learnedRelicEffects", [key])
          .then(() => GS.rtSet(gameId, "cloud", "character/" + tokenId + "/weaponIds", [itemId]))
          .then(() => GS.rtSet(gameId, "cloud", "character/" + tokenId + "/equippedWeaponIdR", itemId))
          .then(() => GS.rtSet(gameId, "cloud", "character/" + tokenId + "/equippedWeaponIdL", itemId))
          .then(() => GS.rtSet(gameId, "cloud", "character/" + tokenId + "/_twoHitMasteryCooldownUntil", null));
      },
      { gameId, tokenId, key: setup.key, itemId: setup.itemId }
    );
    await page.waitForTimeout(1200);

    // 3連撃（1秒の連段窗口内）で3擊目＝2Hit。体力は毎秒+5回復するので、消費量は
    // 「攻撃直前→直後」の差で測る（回復が挟まる幅を抑えるため待ち時間は最小限）。
    async function comboAndMeasure() {
      await page.evaluate(() => {
        window.PriTestMidnight._debugState(); // no-op：状態同期の待ち合わせ用
      });
      await page.click("#btn-midnight-attack-shared-target");
      await page.waitForTimeout(120);
      await page.click("#btn-midnight-attack-shared-target");
      await page.waitForTimeout(120);
      const before = (await st(page)).stamina.current;
      await page.click("#btn-midnight-attack-shared-target");
      await page.waitForTimeout(120);
      const after = (await st(page)).stamina.current;
      return before - after;
    }

    const spentWithMastery = await comboAndMeasure();
    await page.waitForTimeout(600);
    const afterState = await st(page);
    const cooldownUntil = afterState.characters[tokenId]._twoHitMasteryCooldownUntil || 0;
    assert(cooldownUntil > Date.now(), "發動後寫入 _twoHitMasteryCooldownUntil（冷卻中）", results);
    assert(cooldownUntil - Date.now() <= 10000 + 1500, "冷卻長度約為10秒", results);

    // 冷卻中の2撃目コンボ：覆寫は発動しないので、消費は基本値へ戻る（＝1点分＝体力2多い）
    await page.waitForTimeout(2500); // 体力を少し回復させてから（不足で攻撃が空振りしないように）
    const spentOnCooldown = await comboAndMeasure();
    const cooldownUntil2 = (await st(page)).characters[tokenId]._twoHitMasteryCooldownUntil || 0;
    assert(spentOnCooldown > spentWithMastery, `冷卻中的2Hit消耗回到基本值（發動時${spentWithMastery}／冷卻中${spentOnCooldown}）`, results);
    assert(cooldownUntil2 === cooldownUntil, "冷卻中再打不會把冷卻時間往後延", results);
  } catch (e) {
    console.log("  [ERROR]", e.message);
    results.push({ label: "腳本執行中發生例外：" + e.message, pass: false });
  }

  await browser.close();
  const failed = results.filter((r) => !r.pass);
  console.log(`\n=== 結果：${results.length - failed.length}/${results.length} 通過 ===`);
  failed.forEach((r) => console.log("  FAIL: " + r.label));
  process.exit(failed.length ? 1 : 0);
})();
