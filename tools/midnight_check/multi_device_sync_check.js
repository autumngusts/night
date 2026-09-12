// ============================================================================
// midnight（即時制擴張版）多裝置同步回歸測試。
// ============================================================================
// 用途：驗證 docs之外另存的規劃紀錄（見專案根目錄的規劃摘要）明確要求的3個技術風險點：
//   1. 固定地圖佈局＋seed衍生的隨機性：兩台裝置各自用同一個mapSeed在本地跑
//      midnight_map.js演算法，算出的地圖格子、點位（抽牌生成）、縮圈中心錨點都必須
//      逐一相同（不透過網路傳整張地圖資料，只傳種子）。
//   2. 即時移動同步：裝置A移動，裝置B必須在短時間內（節流間隔＋一點網路延遲）
//      看到座標更新（允許lerp插值誤差）。
//   3. 併發扣血用RTDB transaction()不會丟資料：裝置A、B同時攻擊同一個共用標靶，
//      結果必須正確反映兩邊的扣血（不能只扣到1次，那代表transaction()沒有生效、
//      退化成跟nightState一樣「整物件覆寫+LWW」會弄丟其中一邊修改的舊問題）。
//
// 已知限制：這個測試需要真的連上Firebase（storageMode固定"cloud"），並且Firebase
// App Check會嘗試驗證reCAPTCHA v3。在部分無法連上Google reCAPTCHA驗證服務的headless/
// 沙箱環境（例如某些CI容器、無外網的自動化環境）下，簽入會卡在
// "AppCheck: ReCAPTCHA error (appCheck/recaptcha-error)"，整個流程會逾時失敗——
// 這不是這支腳本或midnight.js本身的bug，是環境連線限制。若懷疑遇到這個狀況，先確認
// 一般（非headless、有外網）瀏覽器環境下手動開兩個分頁能否正常同步；如果手動測試正常，
// 這支腳本在CI/沙箱環境跑失敗可以視為環境限制、非回歸。
//
// 使用前準備：
//   1. 於repo根目錄執行 `py -3 generate.py`（或`python generate.py`）產生dist/。
//   2. 啟動本機伺服器：`py -3 -m http.server 8791 --directory dist`
//      （或設定環境變數PRITEST_BASE_URL指到你自己啟動的位址）。
//   3. 於本資料夾執行 `npm install`（僅需安裝一次）。
//
// 執行方式：
//   node multi_device_sync_check.js
// ============================================================================

const { chromium } = require("playwright");

const BASE = process.env.PRITEST_BASE_URL || "http://localhost:8791";
const META_WAIT_MS = 15000;

function assert(cond, label, results) {
  results.push({ label: label, pass: !!cond });
  console.log((cond ? "  [PASS] " : "  [FAIL] ") + label);
}

// 2026-09-12修正：この腳本は元々「本物のFirebaseに繋ぐ（App Check＝reCAPTCHA v3を通す）」
// 前提で書かれており、外網やreCAPTCHAに到達できない環境では上の檔頭に書かれているとおり
// meta待ちで必ず逾時していた（＝回歸ではなく環境制限）。その後emulator_sync_check.jsで
// 導入されたsessionStorage旗標（pritestRtdbEmulator）を使えば、同じ「2裝置同步」の検証を
// 本機のFirebase Local Emulatorだけで完結できるので、既定でそちらへ繋ぐ。
// 本物のFirebaseに対して確認したいときだけ PRITEST_NO_EMULATOR=1 を付けて実行する。
const USE_EMULATOR = process.env.PRITEST_NO_EMULATOR !== "1";

async function enableEmulatorFlag(page) {
  if (!USE_EMULATOR) return;
  await page.addInitScript(() => {
    try {
      window.sessionStorage.setItem("pritestRtdbEmulator", "1");
    } catch (e) {
      /* 忽略 */
    }
  });
}

(async () => {
  const browser = await chromium.launch();
  const pageA = await browser.newPage();
  const pageB = await browser.newPage();
  const results = [];
  await enableEmulatorFlag(pageA);
  await enableEmulatorFlag(pageB);
  console.log(USE_EMULATOR ? "（本機Firebase Local Emulatorに接続）" : "（本物のFirebaseに接続：App Check/reCAPTCHAが必要）");

  try {
    console.log("=== 建立midnight測試場（裝置A） ===");
    await pageA.goto(BASE + "/midnight/index.html", { waitUntil: "networkidle" });
    await pageA.click("#btn-midnight-create");
    // 2026-09-12修正：URLに?game=<id>が入るのはmetaが出来上がってから（history.replaceState）
    // なので、networkidleだけ待って先にurl()を取ると「?game=なしのトップ」を掴んでしまい、
    // 裝置Bが別のロビーを開いてmeta待ちで逾時していた。emulator_sync_check.jsと同じ順序
    // （meta待ち→url()）に揃える。
    await pageA.waitForFunction(() => window.PriTestMidnight && window.PriTestMidnight._debugState().meta, {
      timeout: META_WAIT_MS,
    });
    const gameUrl = pageA.url();
    console.log("game URL:", gameUrl);

    console.log("=== 裝置B加入同一個測試場 ===");
    await pageB.goto(gameUrl, { waitUntil: "networkidle" });
    await pageB.waitForFunction(() => window.PriTestMidnight && window.PriTestMidnight._debugState().meta, {
      timeout: META_WAIT_MS,
    });

    // 使用者確認（2026-09-05）：等待房加入需要先點空席位開表單、填4碼密碼、送出加入，
    // 全部已佔用席位都準備好後5秒倒數才會寫入meta.sessionStartAt——這個流程是lobby系統
    // 加進來之後才有的，沒有先完成這段，updateMovement()／attack按鈕等mySlot存在才會動作
    // 的功能全部不會生效（見emulator_sync_check.js同樣的說明）。
    console.log("=== 等待房：兩裝置各自加入席位並準備，觸發5秒倒數開局 ===");
    await pageA.click("#midnight-lobby-slots .midnight-slot-empty button");
    await pageA.fill("#midnight-lobby-passcode-input", "1234");
    await pageA.click("#btn-midnight-lobby-join");
    await pageA.waitForFunction(() => !!window.PriTestMidnight._debugState().mySlot, { timeout: META_WAIT_MS });
    await pageB.click("#midnight-lobby-slots .midnight-slot-empty button");
    await pageB.fill("#midnight-lobby-passcode-input", "5678");
    await pageB.click("#btn-midnight-lobby-join");
    await pageB.waitForFunction(() => !!window.PriTestMidnight._debugState().mySlot, { timeout: META_WAIT_MS });
    await pageA.click("#btn-midnight-lobby-ready");
    await pageB.click("#btn-midnight-lobby-ready");
    await pageA.waitForFunction(() => window.PriTestMidnight._debugState().meta.sessionStartAt, { timeout: 20000 });
    await pageB.waitForFunction(() => window.PriTestMidnight._debugState().meta.sessionStartAt, { timeout: 20000 });

    const stateA = await pageA.evaluate(() => window.PriTestMidnight._debugState());
    const stateB = await pageB.evaluate(() => window.PriTestMidnight._debugState());
    assert(stateA.meta.mapSeed === stateB.meta.mapSeed, "兩裝置收到同一個mapSeed", results);

    console.log("=== 風險點1：固定地圖佈局＋seed衍生的點位／縮圈錨點，兩裝置本地算出結果一致 ===");
    const gridA = await pageA.evaluate((seed) => Array.from(window.PriTestMidnightMap.generateMap(seed).grid).join(","), stateA.meta.mapSeed);
    const gridB = await pageB.evaluate((seed) => Array.from(window.PriTestMidnightMap.generateMap(seed).grid).join(","), stateB.meta.mapSeed);
    assert(gridA === gridB, "兩裝置各自用相同mapSeed在本地生成的固定地圖逐格相同", results);

    const pointsA = await pageA.evaluate((seed) => JSON.stringify(window.PriTestMidnightMap.generateMap(seed).points), stateA.meta.mapSeed);
    const pointsB = await pageB.evaluate((seed) => JSON.stringify(window.PriTestMidnightMap.generateMap(seed).points), stateB.meta.mapSeed);
    assert(pointsA === pointsB, "兩裝置各自用抽牌邏輯算出的地點位置逐一相同", results);

    const dayPlanA = await pageA.evaluate((seed) => JSON.stringify(window.PriTestMidnightMap.generateMap(seed).dayPlan), stateA.meta.mapSeed);
    const dayPlanB = await pageB.evaluate((seed) => JSON.stringify(window.PriTestMidnightMap.generateMap(seed).dayPlan), stateB.meta.mapSeed);
    assert(dayPlanA === dayPlanB, "兩裝置各自算出的三天縮圈時間軸（Day1/Day2開始地點與兩階段終點）相同", results);

    console.log("=== 風險點2：即時移動同步 ===");
    await pageA.focus("body");
    await pageA.keyboard.down("ArrowRight");
    await pageA.waitForTimeout(800);
    await pageA.keyboard.up("ArrowRight");
    await pageA.waitForTimeout(500);
    const aPos = (await pageA.evaluate(() => window.PriTestMidnight._debugState())).localPos;
    const bSeesA = await pageB.evaluate(
      (tokenId) => (window.PriTestMidnight._debugState().remoteTokens || {})[tokenId] || null,
      stateA.myTokenId
    );
    const moved = !!bSeesA && Math.abs(bSeesA.x - aPos.x) < 0.5 && Math.abs(bSeesA.y - aPos.y) < 0.5;
    console.log("  A本地座標:", JSON.stringify(aPos), "B看到的A座標:", JSON.stringify(bSeesA));
    assert(moved, "裝置A移動後，裝置B在1.3秒內看到接近的座標更新（容許lerp誤差）", results);

    console.log("=== 風險點3：併發扣血用transaction()不丟資料 ===");
    // 2026-09-12修正：この検査が書かれた時点では1回の攻撃が固定1点だったため「-2」を期待して
    // いたが、2026-09-05の武器資料接入で攻撃ダメージは装備武器の
    // CharacterDrawer.computeWeoponDamage().hit1Damage（短剣なら10）になった。
    // ①sharedTargetの既定値20では10×2でちょうど0に張り付き、transaction()が両方効いたのか
    //   片方が消えたのかを数値で区別できない → 先に十分大きな値へ置き換える。
    // ②期待値は固定値ではなく、両裝置それぞれの装備武器から算出した1Hitダメージの合計にする
    //   （どちらの裝置がどの初期武器を持つかは角色類型依存なので、ハードコードしない）。
    await pageA.evaluate((gameId) => window.PriTestGameStorage.rtSet(gameId, "cloud", "demoStat/sharedTarget", 100000), stateA.gameId);
    await pageA.waitForTimeout(400);
    const hit1DamageOf = (page) =>
      page.evaluate(() => {
        const D = window.PriTestMidnight._debugState();
        const c = D.characters[D.myTokenId];
        const raw = c.equippedWeaponIdR || c.equippedWeaponIdL || (c.weaponIds || [])[0] || "";
        const baseId = String(raw).split("::")[0];
        if (!baseId) return 0;
        return window.PriTestCharacterDrawer.computeWeaponDamage(c, baseId).hit1Damage;
      });
    const dmgA = await hit1DamageOf(pageA);
    const dmgB = await hit1DamageOf(pageB);
    const beforeTarget = (await pageA.evaluate(() => window.PriTestMidnight._debugState().demoStats.sharedTarget)) || 20;
    await Promise.all([pageA.click("#btn-midnight-attack-shared-target"), pageB.click("#btn-midnight-attack-shared-target")]);
    await pageA.waitForTimeout(1500);
    const afterA = (await pageA.evaluate(() => window.PriTestMidnight._debugState())).demoStats.sharedTarget;
    const afterB = (await pageB.evaluate(() => window.PriTestMidnight._debugState())).demoStats.sharedTarget;
    console.log("  扣血前:", beforeTarget, "扣血後 A看到:", afterA, "B看到:", afterB, " A/Bの1Hit傷害:", dmgA + "/" + dmgB);
    assert(afterA === afterB, "兩裝置最終看到的共用標靶數值一致（沒有分歧）", results);
    assert(
      afterA === beforeTarget - (dmgA + dmgB),
      "共用標靶正確減少兩裝置1Hit傷害的合計（" + dmgA + "+" + dmgB + "=" + (dmgA + dmgB) + "，兩次攻擊都生效、沒有被覆寫弄丟其中一次），實際減少=" +
        (beforeTarget - afterA),
      results
    );
  } catch (err) {
    console.error("FATAL:", err);
    results.push({ label: "腳本主流程拋出未預期例外：" + err.message, pass: false });
  } finally {
    const failed = results.filter((r) => !r.pass);
    console.log("\n=== 結果彙總 ===");
    console.log(results.length + "項檢查，" + failed.length + "項失敗");
    if (failed.length) failed.forEach((f) => console.log("  [FAIL] " + f.label));
    await browser.close();
    process.exit(failed.length ? 1 : 0);
  }
})();
