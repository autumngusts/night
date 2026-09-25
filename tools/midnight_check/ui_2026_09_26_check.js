// ============================================================================
// midnight 2026-09-26 UI 批次 回歸測試（Playwright ＋ Firebase Local Emulator）
// ============================================================================
// 使用者明確規格（5 項）：
//   ① 房間中按下加入時，欄位排列＝名稱 → 密碼 → 圖片選擇 → 遺物記憶。
//   ② 對敵人造成傷害時，戰鬥面板的刀光特效改為白色芒星，再依屬性上色。
//   ③「右上角地圖可以點開繼續移動探索」的 Y 位置往上移。
//   ④ 按下選單出現的暫停遊戲與流浪祝福資訊，顯示在選單按鈕的下方。
//   ⑤ 進入戰鬥按鈕的 Y 位置更上面；右上角那顆也黃色閃光。
//
// 這一批全是版面／視覺，因此斷言都建立在「實際算出來的位置與 computed style」上，
// 而不是比對 CSS 原始碼字串——只改 CSS 檔案文字但沒真的生效的情況才抓得到。
//
// 使用前準備（跟 near_death_and_accum_check.js 完全相同）：
//   1. py -3 generate.py
//   2. py -3 -m http.server 8931 --directory dist
//   3. npx firebase emulators:start --only database,auth --project elden-ring-nightreign
//   4. PRITEST_BASE_URL=http://localhost:8931 node ui_2026_09_26_check.js
// ============================================================================

const { chromium } = require("playwright");

const BASE = process.env.PRITEST_BASE_URL || "http://localhost:8931";
const META_WAIT_MS = 20000;

const results = [];
function assert(cond, label, detail) {
  results.push({ label, pass: !!cond });
  console.log((cond ? "  [PASS] " : "  [FAIL] ") + label + (cond || detail === undefined ? "" : "　→ " + JSON.stringify(detail)));
}

async function enableEmulatorFlag(page) {
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
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => {
    pageErrors.push(e.message);
    console.log("  [pageerror] " + e.message);
  });

  try {
    await enableEmulatorFlag(page);
    await page.goto(BASE + "/midnight/index.html", { waitUntil: "networkidle" });
    await page.click("#btn-midnight-create");
    await page.waitForFunction(() => window.PriTestMidnight && window.PriTestMidnight._debugState().meta, { timeout: META_WAIT_MS });

    // ================================================================
    // ① 加入表單的欄位排列
    // ================================================================
    console.log("=== ① 加入表單排列：名稱 → 密碼 → 圖片選擇 → 遺物記憶 ===");
    await page.click("#midnight-lobby-slots .midnight-slot-empty button");
    await page.waitForSelector("#midnight-lobby-join-form:not([hidden])", { timeout: 10000 });
    const order = await page.evaluate(() => {
      const ids = [
        "midnight-lobby-name-input",
        "midnight-lobby-passcode-input",
        "midnight-lobby-character-picker",
        "midnight-lobby-relic-memory",
      ];
      const nodes = ids.map((id) => document.getElementById(id));
      if (nodes.some((n) => !n)) return { err: "missing", found: ids.filter((id) => !document.getElementById(id)) };
      // compareDocumentPosition：a 在 b 之前時會帶 DOCUMENT_POSITION_FOLLOWING(4)
      const pairs = [];
      for (let i = 0; i + 1 < nodes.length; i++) {
        pairs.push(!!(nodes[i].compareDocumentPosition(nodes[i + 1]) & Node.DOCUMENT_POSITION_FOLLOWING));
      }
      return { pairs, ids };
    });
    assert(!order.err, "四個元素都存在", order);
    if (!order.err) {
      assert(order.pairs[0], "名稱在密碼之前", order);
      assert(order.pairs[1], "密碼在圖片選擇之前", order);
      assert(order.pairs[2], "圖片選擇在遺物記憶之前", order);
    }
    // 加入鈕留在最後（選完角色才按），不在使用者列的四項裡但順序要合理
    const joinBtnAfterPicker = await page.evaluate(() => {
      const picker = document.getElementById("midnight-lobby-character-picker");
      const btn = document.getElementById("btn-midnight-lobby-join");
      return !!(picker && btn && picker.compareDocumentPosition(btn) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    assert(joinBtnAfterPicker, "［加入］鈕排在圖片選擇之後");

    // 表單仍然可用（排列改了但流程沒壞）
    await page.fill("#midnight-lobby-name-input", "版面測試");
    await page.fill("#midnight-lobby-passcode-input", "1111");
    await page.click("#btn-midnight-lobby-join");
    await page.waitForFunction(() => !!window.PriTestMidnight._debugState().mySlot, { timeout: META_WAIT_MS });
    assert(true, "改過排列後仍然加得進席位");

    await page.click("#btn-midnight-lobby-ready");
    await page.waitForFunction(() => window.PriTestMidnight._debugState().meta.sessionStartAt, { timeout: 30000 });
    await page.waitForTimeout(1500);

    // ================================================================
    // ② 刀光 → 白色芒星（依屬性上色）
    // ================================================================
    console.log("\n=== ② 命中特效改為白色芒星 ===");
    const star = await page.evaluate(() => {
      const el = document.getElementById("midnight-enemy-hit-effect");
      if (!el) return { err: "missing" };
      el.hidden = false;
      const cs = getComputedStyle(el);
      const out = {
        bg: cs.backgroundImage,
        mask: cs.webkitMaskImage || cs.maskImage,
        anim: null,
      };
      // 播放 class 掛上後才看得到 animation-name
      el.classList.add("midnight-enemy-hit-effect-play");
      out.anim = getComputedStyle(el).animationName;
      // 屬性上色：--hit-color 換成金色後，背景字串裡要真的出現那個顏色
      el.style.setProperty("--hit-color", "rgb(255, 215, 0)");
      out.bgGold = getComputedStyle(el).backgroundImage;
      el.classList.remove("midnight-enemy-hit-effect-play");
      el.hidden = true;
      return out;
    });
    assert(!star.err, "命中特效元素存在", star);
    assert(/conic-gradient/.test(star.bg || ""), "背景是 conic-gradient（芒線），不再是單一 linear-gradient 斜向刀光", (star.bg || "").slice(0, 80));
    assert(/radial-gradient/.test(star.bg || ""), "另有 radial-gradient 白色中心芒", (star.bg || "").slice(0, 80));
    assert(/rgb\(255,\s*255,\s*255\)|#ffffff|white/i.test(star.bg || ""), "預設狀態是白色芒星", (star.bg || "").slice(0, 120));
    assert(/radial-gradient/.test(star.mask || ""), "有 mask 讓芒線由中心往外淡出", (star.mask || "").slice(0, 60));
    assert(star.anim === "midnight-enemy-hit-star", "播放動畫換成芒星綻放（midnight-enemy-hit-star）", star.anim);
    assert(/255,\s*215,\s*0/.test(star.bgGold || ""), "改變 --hit-color 後芒線真的跟著上色（依屬性套色）", (star.bgGold || "").slice(0, 120));

    // ================================================================
    // ③ 地圖提示訊息的 Y 位置
    // ================================================================
    console.log("\n=== ③ 地圖提示訊息往上移 ===");
    const nudge = await page.evaluate(() => {
      const el = document.getElementById("midnight-map-nudge-message");
      if (!el) return { err: "missing" };
      const wasHidden = el.hidden;
      el.hidden = false;
      const r = el.getBoundingClientRect();
      const out = { top: r.top, vh: window.innerHeight, ratio: r.top / window.innerHeight };
      el.hidden = wasHidden;
      return out;
    });
    assert(!nudge.err, "提示訊息元素存在", nudge);
    assert(nudge.ratio < 0.2, "訊息位於畫面上方 20% 以內（原本是 28%）", nudge);

    // ================================================================
    // ④ 選單面板在選單按鈕下方
    // ================================================================
    console.log("\n=== ④ 選單面板顯示在選單按鈕下方 ===");
    await page.dispatchEvent("#btn-midnight-toggle-menu", "click");
    await page.waitForTimeout(500);
    const menu = await page.evaluate(() => {
      const btn = document.getElementById("btn-midnight-toggle-menu");
      const panel = document.getElementById("midnight-menu-panel");
      if (!btn || !panel) return { err: "missing" };
      const hudRight = document.getElementById("midnight-hud-top-right");
      const br = btn.getBoundingClientRect();
      const pr = panel.getBoundingClientRect();
      return {
        hidden: panel.hidden,
        inHud: !!(hudRight && hudRight.contains(panel)),
        btnBottom: br.bottom,
        panelTop: pr.top,
        position: getComputedStyle(panel).position,
        pauseVisible: !!document.getElementById("btn-midnight-pause-game"),
        blessingVisible: !!document.getElementById("midnight-wandering-blessing-value"),
      };
    });
    assert(!menu.err, "選單按鈕與面板都存在", menu);
    assert(menu.hidden === false, "按下選單後面板顯示", menu);
    assert(menu.inHud, "面板位於右上 HUD 內（跟選單按鈕同一個容器）", menu);
    assert(menu.position === "static", "不再用 position:fixed 疊在畫面上，改走文件流", menu);
    assert(menu.panelTop >= menu.btnBottom - 1, "面板的上緣在選單按鈕的下緣之下（＝顯示在按鈕下方）", menu);
    assert(menu.pauseVisible && menu.blessingVisible, "暫停遊戲與流浪祝福資訊都在面板內", menu);
    await page.dispatchEvent("#btn-midnight-toggle-menu", "click");

    // ================================================================
    // ⑤ 進入戰鬥按鈕：置中那顆往上、右上角那顆也閃黃光
    // ================================================================
    console.log("\n=== ⑤ 進入戰鬥按鈕 ===");
    const enter = await page.evaluate(() => {
      const center = document.getElementById("midnight-enter-battle-center");
      const top = document.getElementById("midnight-enter-battle-prompt");
      const topBtn = document.getElementById("btn-midnight-enter-battle");
      if (!center || !topBtn) return { err: "missing" };
      const wasC = center.hidden;
      const wasT = top.hidden;
      center.hidden = false;
      top.hidden = false;
      const cr = center.getBoundingClientRect();
      const cs = getComputedStyle(topBtn);
      const out = {
        centerCenterY: cr.top + cr.height / 2,
        vh: window.innerHeight,
        ratio: (cr.top + cr.height / 2) / window.innerHeight,
        topBtnBg: cs.backgroundColor,
        topBtnAnim: cs.animationName,
      };
      center.hidden = wasC;
      top.hidden = wasT;
      return out;
    });
    assert(!enter.err, "兩顆進入戰鬥按鈕都存在", enter);
    assert(enter.ratio < 0.42, "置中的［進入戰鬥］中心位於畫面上半部（原本正中 50%）", enter);
    assert(enter.topBtnBg === "rgb(255, 213, 74)", "右上角的［進入戰鬥］是黃色底", enter);
    assert(enter.topBtnAnim === "midnight-enter-battle-glow", "右上角的［進入戰鬥］也帶閃黃光動畫", enter);

    assert(pageErrors.length === 0, "過程中沒有任何 pageerror", pageErrors);
  } finally {
    await browser.close();
  }

  const passed = results.filter((r) => r.pass).length;
  console.log("\n" + passed + "/" + results.length + (passed === results.length ? " PASS" : " PASS（有失敗項目）"));
  process.exit(passed === results.length ? 0 : 1);
})();
