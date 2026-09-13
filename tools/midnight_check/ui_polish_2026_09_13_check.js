// ============================================================================
// midnight（即時制擴張版）2026-09-13 UI 優化第 6 批 ＋ 其他 2 項 回歸測試
// （Playwright ＋ Firebase Local Emulator）。
// ============================================================================
// 對應使用者當日提出的項目：
//   UI① 右上「選單」按下時改成黃底
//   UI② 觀察者模式時右上不顯示盧恩，改顯示眼睛符號＋黃底「觀察者模式」
//   UI③ 使用聖杯瓶中，該按鈕格上方顯示「使用中」
//   UI④ 一般攻擊／戰技／魔術／祈禱四種按鈕改用各自不同的圖示
//   UI⑤ 魔術・祈禱詠唱中，按鈕格上方顯示環繞星體；施法成功且對敵人造成傷害時
//        射出彗星到敵人圖片中心
//   UI⑥ 防禦按鈕按下時，按鈕格上方顯示盾牌圖示
//   UI⑦ 按下上方樓層資訊 banner／後補領獎提示時，換成它們疊在左上右上 HUD 之上
//   其他① 新遇到的敵人不得繼承上一敵人的屬性與異常狀態
//   其他② 多人遊戲下獎勵清單被一個人關閉後，仍叫得回來（維持投票制）
//
// 量測原則沿用本資料夾既有腳本：期望值盡量從實際版面／實際資料算回來，只有
// 「哪個 class／CSS 變數要存在」這種結構性條件才直接斷言。
//
// 使用前準備（跟 emulator_sync_check.js 完全相同）：
//   1. py -3 generate.py
//   2. py -3 -m http.server 8931 --directory dist
//   3. npx firebase emulators:start --only database,auth --project elden-ring-nightreign
//   4. PRITEST_BASE_URL=http://localhost:8931 node ui_polish_2026_09_13_check.js
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

// 走位：直接改寫 localPos（沿用 field_multiplayer_floor_check.js 的既有作法，理由見
// 該檔開頭——固定牆壁佈局下用鍵盤走位常常走不到目標點）。
async function teleport(page, x, y) {
  await page.evaluate(
    (p) => {
      const pos = window.PriTestMidnight._debugState().localPos;
      pos.x = p.x;
      pos.y = p.y;
    },
    { x, y }
  );
  await page.waitForTimeout(250);
}

async function joinLobby(page, passcode) {
  await page.click("#midnight-lobby-slots .midnight-slot-empty button");
  await page.fill("#midnight-lobby-passcode-input", passcode);
  await page.click("#btn-midnight-lobby-join");
  await page.waitForFunction(() => !!window.PriTestMidnight._debugState().mySlot, { timeout: META_WAIT_MS });
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1280, height: 900 });
  page.on("pageerror", (e) => console.log("  [pageerror] " + e.message));

  try {
    await enableEmulatorFlag(page);
    console.log("=== 建立 midnight 測試場（連本機 emulator） ===");
    await page.goto(BASE + "/midnight/index.html", { waitUntil: "networkidle" });
    await page.click("#btn-midnight-create");
    await page.waitForFunction(() => window.PriTestMidnight && window.PriTestMidnight._debugState().meta, { timeout: META_WAIT_MS });
    await joinLobby(page, "1234");
    await page.click("#btn-midnight-lobby-ready");
    await page.waitForFunction(() => window.PriTestMidnight._debugState().meta.sessionStartAt, { timeout: 30000 });
    await page.waitForFunction(() => !!window.PriTestMidnight._debugState().characters[window.PriTestMidnight._debugState().myTokenId], {
      timeout: META_WAIT_MS,
    });

    // ------------------------------------------------------------------
    // ① 選單按鈕黃底
    // 顏色期望值不硬編 rgb 字串，改成「開啟後的背景色跟關閉時不同，而且是
    // .midnight-btn-active-yellow 這個 class 帶來的」。
    // ------------------------------------------------------------------
    console.log("=== ① 右上選單按鈕黃底 ===");
    const menuState = await page.evaluate(() => {
      const M = window.PriTestMidnight;
      const btn = document.getElementById("btn-midnight-toggle-menu");
      const panel = document.getElementById("midnight-menu-panel");
      panel.hidden = true;
      M._debugRenderMenuToggleUI();
      const closed = { cls: btn.className, bg: getComputedStyle(btn).backgroundColor };
      panel.hidden = false;
      M._debugRenderMenuToggleUI();
      const opened = { cls: btn.className, bg: getComputedStyle(btn).backgroundColor };
      panel.hidden = true;
      M._debugRenderMenuToggleUI();
      const reclosed = { cls: btn.className, bg: getComputedStyle(btn).backgroundColor };
      return { closed, opened, reclosed };
    });
    assert(menuState.opened.cls.indexOf("midnight-btn-active-yellow") !== -1, "選單開啟時按鈕掛上 .midnight-btn-active-yellow", menuState);
    assert(menuState.closed.cls.indexOf("midnight-btn-active-yellow") === -1, "選單關閉時沒有掛上該 class", menuState);
    assert(menuState.opened.bg !== menuState.closed.bg, "開啟／關閉的實際背景色不同（黃底真的生效）", menuState);
    assert(menuState.reclosed.bg === menuState.closed.bg, "再次關閉後背景色復原", menuState);

    // ------------------------------------------------------------------
    // ② 觀察者模式徽章
    // ------------------------------------------------------------------
    console.log("=== ② 觀察者模式徽章 ===");
    const spectator = await page.evaluate(() => {
      const M = window.PriTestMidnight;
      const badge = document.getElementById("midnight-spectator-badge");
      const runeRow = document.getElementById("midnight-self-rune-row");
      const seated = { badge: badge.hidden, rune: runeRow.hidden };
      const prev = M._debugSetMySlot(null);
      const watching = {
        badge: badge.hidden,
        rune: runeRow.hidden,
        bg: getComputedStyle(badge).backgroundColor,
        hasEye: !!badge.querySelector(".midnight-icon-eye"),
        text: badge.textContent.trim(),
      };
      M._debugSetMySlot(prev);
      const restored = { badge: badge.hidden, rune: runeRow.hidden };
      return { seated, watching, restored };
    });
    assert(spectator.seated.badge && !spectator.seated.rune, "有席位時：顯示盧恩、不顯示觀察者徽章", spectator.seated);
    assert(!spectator.watching.badge && spectator.watching.rune, "觀戰時：不顯示盧恩、改顯示觀察者徽章", spectator.watching);
    assert(spectator.watching.hasEye, "觀察者徽章含眼睛符號（.midnight-icon-eye）", spectator.watching);
    assert(spectator.watching.text.length > 0, "觀察者徽章有文字", spectator.watching);
    assert(spectator.watching.bg === "rgb(255, 213, 74)", "觀察者徽章是黃底（#ffd54a）", spectator.watching);
    assert(spectator.restored.badge && !spectator.restored.rune, "還原席位後回到顯示盧恩", spectator.restored);

    // ------------------------------------------------------------------
    // ③ 聖杯瓶「使用中」
    // ------------------------------------------------------------------
    console.log("=== ③ 聖杯瓶使用中浮標 ===");
    const flask = await page.evaluate(() => {
      const M = window.PriTestMidnight;
      const badge = document.getElementById("midnight-flask-using-badge");
      const card = document.getElementById("btn-midnight-use-flask");
      M._debugSetFlaskReading(false);
      const before = badge.hidden;
      M._debugSetFlaskReading(true);
      const br = badge.getBoundingClientRect();
      const cr = card.getBoundingClientRect();
      const during = {
        hidden: badge.hidden,
        text: badge.textContent.trim(),
        aboveCard: br.bottom <= cr.top + 1,
        cardOverflow: getComputedStyle(card).overflowY,
      };
      M._debugSetFlaskReading(false);
      const after = badge.hidden;
      return { before, during, after };
    });
    assert(flask.before === true, "沒在喝的時候不顯示", flask);
    assert(flask.during.hidden === false, "讀取中顯示浮標", flask.during);
    assert(flask.during.text.length > 0, "浮標有「使用中」文字", flask.during);
    assert(flask.during.aboveCard, "浮標真的浮在聖杯瓶格子的上方（不是疊在格子裡）", flask.during);
    assert(flask.during.cardOverflow === "visible", "聖杯瓶格子解除了 overflow:hidden，浮標不會被裁掉", flask.during);
    assert(flask.after === true, "讀取結束／被中斷後浮標消失", flask);

    // ------------------------------------------------------------------
    // ④ 四種戰鬥按鈕圖示互不相同
    // 期望值從 CSS 實際的 mask-image 讀回來比較，不硬編 SVG 內容。
    // ------------------------------------------------------------------
    console.log("=== ④ 戰鬥按鈕圖示 ===");
    const icons = await page.evaluate(() => {
      const probe = (cls) => {
        const s = document.createElement("span");
        s.className = cls;
        document.body.appendChild(s);
        const st = getComputedStyle(s);
        const mask = st.maskImage && st.maskImage !== "none" ? st.maskImage : st.webkitMaskImage;
        s.remove();
        return mask;
      };
      return {
        sword: probe("midnight-icon-sword"),
        skill: probe("midnight-icon-skill"),
        sorcery: probe("midnight-icon-sorcery"),
        prayer: probe("midnight-icon-prayer"),
        shield: probe("midnight-icon-shield"),
        attackBtnIcon: !!document.querySelector("#btn-midnight-attack-shared-target .midnight-icon-sword"),
        skillBtnIcon: !!document.querySelector("#btn-midnight-skill .midnight-icon-skill"),
      };
    });
    const iconMasks = [icons.sword, icons.skill, icons.sorcery, icons.prayer];
    assert(
      iconMasks.every((m) => m && m !== "none"),
      "劍／戰技／魔術／祈禱四個圖示都有 mask-image",
      icons
    );
    assert(new Set(iconMasks).size === 4, "四個圖示的 mask-image 互不相同（改版前全部共用劍）", iconMasks.map((m) => (m || "").slice(0, 60)));
    assert(icons.attackBtnIcon, "一般攻擊鍵用 .midnight-icon-sword", icons);
    assert(icons.skillBtnIcon, "戰技A鍵用 .midnight-icon-skill", icons);

    // 魔術／祈禱的判斷依據：杖＝魔術、聖印＝祈禱、其餘＝戰技。武器 id 從實際資料挑，
    // 不硬編（沿用 CLAUDE.md §4.5 的 Weapons.list()）。
    const spellIconMap = await page.evaluate(() => {
      const M = window.PriTestMidnight;
      const W = window.PriTestWeapons;
      const pick = (catId) => (W.list().filter((w) => w.category === catId)[0] || {}).id || null;
      const staff = pick("staff");
      const seal = pick("sacred_seal");
      const sword = W.list().filter((w) => w.category !== "staff" && w.category !== "sacred_seal")[0].id;
      return {
        staff: { id: staff, cls: staff ? M._debugSpellIconClassForWeapon(staff) : null },
        seal: { id: seal, cls: seal ? M._debugSpellIconClassForWeapon(seal) : null },
        other: { id: sword, cls: M._debugSpellIconClassForWeapon(sword) },
      };
    });
    assert(spellIconMap.staff.cls === "midnight-icon-sorcery", "杖 → 魔術圖示", spellIconMap.staff);
    assert(spellIconMap.seal.cls === "midnight-icon-prayer", "聖印 → 祈禱圖示", spellIconMap.seal);
    assert(spellIconMap.other.cls === "midnight-icon-skill", "其餘武器 → 戰技圖示", spellIconMap.other);

    // ------------------------------------------------------------------
    // ⑤ 詠唱環繞星體 ＋ 施法彗星
    // ------------------------------------------------------------------
    console.log("=== ⑤ 詠唱環繞星體與施法彗星 ===");
    const orbit = await page.evaluate(() => {
      const M = window.PriTestMidnight;
      const o = document.getElementById("midnight-skill-b-orbit");
      const btn = document.getElementById("btn-midnight-skill-b");
      M._debugSetSorceryHold("R", false);
      const before = o.hidden;
      M._debugSetSorceryHold("R", true);
      const or = o.getBoundingClientRect();
      const br = btn.getBoundingClientRect();
      const st = getComputedStyle(o, "::before");
      const during = {
        hidden: o.hidden,
        aboveButton: or.bottom <= br.top + 1,
        anim: st.animationName,
        color: o.style.getPropertyValue("--orbit-color"),
      };
      M._debugSetSorceryHold("R", false);
      return { before, during, after: o.hidden };
    });
    assert(orbit.before === true, "沒在詠唱時不顯示環繞星體", orbit);
    assert(orbit.during.hidden === false, "詠唱中顯示環繞星體", orbit.during);
    assert(orbit.during.aboveButton, "環繞星體浮在按鈕格上方", orbit.during);
    assert(orbit.during.anim === "midnight-cell-orbit-spin", "環繞動畫確實生效", orbit.during);
    assert(!!orbit.during.color, "環繞星體套用了屬性顏色變數", orbit.during);
    assert(orbit.after === true, "放開按鈕後環繞星體消失", orbit);

    const comet = await page.evaluate(() => {
      const M = window.PriTestMidnight;
      const c = document.getElementById("midnight-spell-comet");
      const img = document.getElementById("midnight-field-encounter-image");
      const box = document.getElementById("midnight-field-encounter");
      const btn = document.getElementById("btn-midnight-skill-b");
      // 不在戰鬥中不該觸發（跟刀光/異常特效同一個守衛）
      M._debugSetActiveEncounterForFx(false);
      M._debugTriggerSpellComet("btn-midnight-skill-b", "#ff8844");
      const withoutEncounter = c.hidden;
      // 模擬戰鬥中：把敵人圖片區塊顯示出來並給一張假圖尺寸。魔術鍵本身在沒有裝備
      // 杖／聖印時是 hidden（renderSideCombatButtons()），量不到座標也就射不出彗星
      // ——這是正確的守衛行為，測試這裡手動顯示出來以取得真實的按鈕格座標。
      document.getElementById("midnight-hud-bottom-center").hidden = false;
      box.hidden = false;
      img.hidden = false;
      img.style.width = "200px";
      img.style.height = "200px";
      btn.hidden = false;
      M._debugSetActiveEncounterForFx(true);
      M._debugTriggerSpellComet("btn-midnight-skill-b", "#ff8844");
      const br = btn.getBoundingClientRect();
      const ir = img.getBoundingClientRect();
      const cs = getComputedStyle(c);
      const out = {
        withoutEncounter,
        hidden: c.hidden,
        anim: cs.animationName,
        left: parseFloat(c.style.left),
        top: parseFloat(c.style.top),
        dx: parseFloat(c.style.getPropertyValue("--comet-dx")),
        dy: parseFloat(c.style.getPropertyValue("--comet-dy")),
        color: c.style.getPropertyValue("--comet-color"),
        btnCx: br.left + br.width / 2,
        btnCy: br.top + br.height / 2,
        imgCx: ir.left + ir.width / 2,
        imgCy: ir.top + ir.height / 2,
      };
      M._debugSetActiveEncounterForFx(false);
      img.style.width = "";
      img.style.height = "";
      return out;
    });
    assert(comet.withoutEncounter, "不在戰鬥中時不放彗星", comet);
    assert(comet.hidden === false, "戰鬥中施法成功會放彗星", comet);
    assert(comet.anim === "midnight-spell-comet-fly", "彗星動畫確實生效", comet);
    assert(Math.abs(comet.left - comet.btnCx) < 1.5 && Math.abs(comet.top - comet.btnCy) < 1.5, "彗星起點＝該魔術按鈕格中心", comet);
    assert(
      Math.abs(comet.left + comet.dx - comet.imgCx) < 1.5 && Math.abs(comet.top + comet.dy - comet.imgCy) < 1.5,
      "彗星終點＝敵人圖片中心",
      comet
    );
    assert(!!comet.color, "彗星套用了屬性顏色變數", comet);

    // ------------------------------------------------------------------
    // ⑥ 防禦中盾牌浮標
    // ------------------------------------------------------------------
    console.log("=== ⑥ 防禦中盾牌浮標 ===");
    const block = await page.evaluate(() => {
      const M = window.PriTestMidnight;
      const badge = document.getElementById("midnight-block-shield-badge");
      const btn = document.getElementById("btn-midnight-block");
      M._debugSetBlockHolding(false);
      const before = badge.hidden;
      M._debugSetBlockHolding(true);
      const ba = badge.getBoundingClientRect();
      const br = btn.getBoundingClientRect();
      const during = {
        hidden: badge.hidden,
        aboveButton: ba.bottom <= br.top + 1,
        hasShield: !!badge.querySelector(".midnight-icon-shield"),
      };
      M._debugSetBlockHolding(false);
      return { before, during, after: badge.hidden };
    });
    assert(block.before === true, "沒按防禦時不顯示盾牌浮標", block);
    assert(block.during.hidden === false, "按下防禦時顯示盾牌浮標", block.during);
    assert(block.during.hasShield, "浮標裡是盾牌圖示", block.during);
    assert(block.during.aboveButton, "盾牌浮標浮在防禦鍵格上方", block.during);
    assert(block.after === true, "放開防禦後浮標消失", block);

    // ------------------------------------------------------------------
    // ⑦ banner 反向疊層
    // 用真實的 pointerdown 觸發（CLAUDE.md §4.6：HUD 疊層要用真實事件，
    // 手動加 class 會被每幀的 updateHudStackingUI() 覆寫）。
    // ------------------------------------------------------------------
    console.log("=== ⑦ 點 banner 讓它疊到 HUD 之上 ===");
    await page.evaluate(() => {
      // 讓其中一條 banner 真的顯示出來，才有 z-index 可以量
      document.getElementById("midnight-field-late-claim-prompt").hidden = false;
      document.documentElement.classList.remove("midnight-top-banner-collapsed");
    });
    // 先點右上 HUD：HUD 應該蓋過 banner
    await page.dispatchEvent("#midnight-hud-top-right", "pointerdown");
    await page.waitForTimeout(120);
    const stackHudFirst = await page.evaluate(() => {
      const z = (id) => parseInt(getComputedStyle(document.getElementById(id)).zIndex, 10);
      return {
        html: document.documentElement.className,
        hud: z("midnight-hud-top-right"),
        banner: z("midnight-field-late-claim-prompt"),
      };
    });
    assert(stackHudFirst.hud > stackHudFirst.banner, "點右上 HUD 後：HUD 疊在 banner 之上（既有行為未被破壞）", stackHudFirst);

    await page.dispatchEvent("#midnight-field-late-claim-prompt", "pointerdown");
    await page.waitForTimeout(120);
    const stackBannerFirst = await page.evaluate(() => {
      const z = (id) => parseInt(getComputedStyle(document.getElementById(id)).zIndex, 10);
      return {
        html: document.documentElement.className,
        hud: z("midnight-hud-top-right"),
        banner: z("midnight-field-late-claim-prompt"),
      };
    });
    assert(
      stackBannerFirst.html.indexOf("midnight-banner-above-hud") !== -1,
      "點 banner 後掛上 html.midnight-banner-above-hud",
      stackBannerFirst
    );
    assert(stackBannerFirst.banner > stackBannerFirst.hud, "點 banner 後：banner 反過來疊在 HUD 之上", stackBannerFirst);
    await page.evaluate(() => {
      document.getElementById("midnight-field-late-claim-prompt").hidden = true;
    });

    // ------------------------------------------------------------------
    // ⑧ 自身承受中的屬性／異常蓄積顯示在左上 HUD（聖杯瓶列與隊伍資訊之間）
    // ------------------------------------------------------------------
    console.log("=== ⑧ 自身蓄積顯示於左上 HUD ===");
    const selfAccumEmpty = await page.evaluate(() => {
      const note = document.getElementById("midnight-self-accum-note");
      return { exists: !!note, hidden: note ? note.hidden : null };
    });
    assert(selfAccumEmpty.exists, "左上 HUD 有自身蓄積顯示區塊（#midnight-self-accum-note）", selfAccumEmpty);
    assert(selfAccumEmpty.hidden === true, "沒有任何蓄積時整塊隱藏（不佔高度把隊友卡片推開）", selfAccumEmpty);

    // 護符會無效化/減免承受蓄積（見 talismanAdjustedReceivedAccum）：先清空護符，
    // 避免測試角色剛好帶到相剋護符時記不進去。
    const selfAccum = await page.evaluate(async () => {
      const M = window.PriTestMidnight;
      M._debugSetTalismans([]);
      const after = M._debugRecordReceivedAccum("炎", 4);
      M._debugRecordReceivedAccum("出血", 9);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const note = document.getElementById("midnight-self-accum-note");
      const chips = [...note.querySelectorAll(".midnight-accum-chip")].map((c) => ({
        text: c.textContent,
        color: getComputedStyle(c).color,
        pct: c.style.getPropertyValue("--accum-pct"),
        hasIcon: !!c.querySelector(".midnight-accum-chip-icon"),
        hasValue: !!c.querySelector(".midnight-accum-chip-value"),
      }));
      const r = (id) => document.getElementById(id).getBoundingClientRect();
      return {
        raw: after,
        hidden: note.hidden,
        chips,
        threshold: M._debugAttributeStatusThreshold(),
        noteTop: r("midnight-self-accum-note").top,
        noteBottom: r("midnight-self-accum-note").bottom,
        flaskBottom: r("midnight-flask-count").bottom,
        slotsTop: r("midnight-players-panel-slots").top,
      };
    });
    assert(selfAccum.hidden === false, "承受蓄積後區塊顯示出來", selfAccum);
    assert(selfAccum.chips.length === 2, "兩種蓄積各自渲染成一枚徽章", selfAccum.chips);
    assert(
      selfAccum.chips.every((c) => c.hasIcon && c.hasValue),
      "徽章有屬性符號與「目前值/門檻」數字（重用血條上方那組樣式）",
      selfAccum.chips
    );
    assert(
      selfAccum.chips.some((c) => c.text.indexOf("/" + selfAccum.threshold) !== -1),
      `數字顯示成「目前值/${selfAccum.threshold}」`,
      selfAccum.chips
    );
    assert(
      new Set(selfAccum.chips.map((c) => c.color)).size === 2,
      "不同屬性／異常用不同顏色",
      selfAccum.chips.map((c) => c.color)
    );
    assert(
      selfAccum.noteTop >= selfAccum.flaskBottom - 1 && selfAccum.noteBottom <= selfAccum.slotsTop + 1,
      "位置確實在聖杯瓶資訊與隊伍資訊之間",
      selfAccum
    );

    // 異常狀態跨過門檻後歸零（規則書 §7.4）→ 徽章隨之消失；屬性保留超額值繼續累計（§7.3）。
    const selfAccumThreshold = await page.evaluate(async () => {
      const M = window.PriTestMidnight;
      const th = M._debugAttributeStatusThreshold();
      const raw = M._debugRecordReceivedAccum("出血", th); // 出血 9 + th → 跨門檻
      M._debugRecordReceivedAccum("炎", th); // 炎 4 + th → 跨門檻但屬性保留超額
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const note = document.getElementById("midnight-self-accum-note");
      const labels = [...note.querySelectorAll(".midnight-accum-chip-label")].map((e) => e.textContent);
      return { th, bleed: raw["出血"], fire: raw["炎"], labels };
    });
    assert(selfAccumThreshold.bleed === 0, "異常狀態（出血）跨過門檻後歸零", selfAccumThreshold);
    assert(selfAccumThreshold.labels.indexOf("出血") === -1, "歸零後該徽章從左上 HUD 消失", selfAccumThreshold);
    assert(selfAccumThreshold.fire > 0, "屬性（炎）跨過門檻後保留超額值", selfAccumThreshold);
    assert(selfAccumThreshold.labels.indexOf("炎") !== -1, "屬性徽章仍然留著", selfAccumThreshold);

    // ------------------------------------------------------------------
    // ⑨ 角色視窗顯示全部六項威力補正
    // 期望值不硬編：直接從 CharacterDrawer.statPowerModValue() 算回來比對，並額外
    // 驗證「護符帶來的加成會反映到畫面上」（不是只印類型基本值）。
    // ------------------------------------------------------------------
    console.log("=== ⑨ 角色視窗六項威力補正 ===");
    const powerMods = await page.evaluate(async () => {
      const M = window.PriTestMidnight;
      const CD = window.PriTestCharacterDrawer;
      const D = M._debugState();
      const c = D.characters[D.myTokenId];
      const keys = ["strength", "dex", "balance", "intelligence", "faith", "arcane"];
      M._debugSetTalismans([]);
      document.getElementById("midnight-character-sheet-modal").hidden = false;
      M._debugRenderCharacterSheet();
      const line = document.getElementById("midnight-character-sheet-power-mods");
      const base = {
        text: line.textContent,
        expected: keys.map((k) => CD.statPowerModValue(c, k)),
        typeRaw: keys.map((k) => (window.PriTestCharacterTypes.get(c.typeId).powerMod[k] || 0)),
        label: window.I18N.t("stat_power_mod"),
      };
      // 找一個真的會加威力補正的護符（本文含「威力補正」），驗證顯示值跟著變。
      const T = window.PriTestTalismans;
      const bonusTalisman = (T.list ? T.list() : []).filter((t) => /威力補正/.test(T.localizedText(t.body) || ""))[0];
      let withTalisman = null;
      if (bonusTalisman) {
        M._debugSetTalismans([bonusTalisman.id]);
        M._debugRenderCharacterSheet();
        withTalisman = {
          id: bonusTalisman.id,
          text: line.textContent,
          expected: keys.map((k) => CD.statPowerModValue(c, k)),
        };
        M._debugSetTalismans([]);
        M._debugRenderCharacterSheet();
      }
      const artLine = document.getElementById("midnight-character-sheet-power").textContent;
      document.getElementById("midnight-character-sheet-modal").hidden = true;
      return { base, withTalisman, artLine };
    });
    assert(powerMods.base.text.indexOf(powerMods.base.label) === 0, "六項威力補正沿用主遊戲角色卡既有的標籤字串", powerMods.base);
    assert(
      powerMods.base.text.indexOf(powerMods.base.expected.join("／")) !== -1,
      "六項數值與 CharacterDrawer.statPowerModValue() 一致，順序＝力量／技巧／平衡／智力／信仰／神秘",
      powerMods.base
    );
    assert(powerMods.base.expected.length === 6, "確實是 6 項", powerMods.base);
    if (powerMods.withTalisman) {
      const changed = powerMods.withTalisman.expected.join("／") !== powerMods.base.expected.join("／");
      assert(
        powerMods.withTalisman.text.indexOf(powerMods.withTalisman.expected.join("／")) !== -1,
        "戴上會加威力補正的護符後，顯示值跟著 statPowerModValue() 一起變（不是只印類型基本值）",
        powerMods.withTalisman
      );
      assert(changed, "該護符確實改變了其中至少一項（測試前提）", { base: powerMods.base.expected, with: powerMods.withTalisman.expected });
    }
    assert(
      powerMods.artLine.indexOf(powerMods.base.label) !== 0,
      "原本那行改稱「戰技威力（裝備中武器）」，不再跟威力補正同名",
      powerMods.artLine
    );

    // ------------------------------------------------------------------
    // 其他① 新敵人不繼承屬性／異常蓄積
    // 直接驗證「清空樓層 trigger 時會一起把該點的 attributeAccum 清掉」這條路徑：
    // 先在某個板塊點的 key 底下寫入蓄積，再跑一次踏破→清空流程，確認歸零。
    // ------------------------------------------------------------------
    console.log("=== 其他① 新敵人不繼承屬性／異常蓄積 ===");
    // maybeClearFieldTriggerAfterRewardGate() 掛在 updateNearbyFieldPoint() 裡，
    // 只對「玩家目前站在旁邊」的那個點跑，因此要先傳送過去。
    const inheritPt = await page.evaluate(() => {
      const NON_FIELD = { sorcerer: 1, merchant: 1, strong_enemy: 1, random_event: 1, blessing: 1 };
      const pts = (window.PriTestMidnight._debugState().map.points || []).filter((p) => !NON_FIELD[p.type] && p.card);
      return pts[0] || null;
    });
    if (inheritPt) await teleport(page, inheritPt.x + 0.5, inheritPt.y + 0.5);
    const inherit = await page.evaluate(async (ptIn) => {
      const M = window.PriTestMidnight;
      const D = M._debugState();
      const GS = window.PriTestGameStorage;
      const pt = ptIn;
      if (!pt) return { skipped: true };
      // ① 上一隻敵人打出來的蓄積
      await GS.rtSet(D.gameId, "cloud", "attributeAccum/" + pt.id, { 炎: 12, 出血: 7 });
      await GS.rtSet(D.gameId, "cloud", "attributeAccumTriggerClaims/" + pt.id, { 炎: { 1: D.myTokenId } });
      // ② 造出「第0層已 resolved、fieldProgress 已推進到第1層、沒有未領獎勵」的狀態，
      //    也就是 maybeClearFieldTriggerAfterRewardGate() 會出手清空的那個窗口
      await GS.rtSet(D.gameId, "cloud", "fieldTrigger/" + pt.id, {
        status: "resolved",
        floorIndex: 0,
        branchIndex: 0,
        participants: {},
        enemyFamilyId: null,
        enemyId: null,
        resolvedAt: Date.now(),
      });
      await GS.rtSet(D.gameId, "cloud", "fieldProgress/" + pt.id, { branchIndex: 0, floorIndex: 1 });
      // ③ 等每幀輪詢真的把 trigger 清掉
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 200));
        const s = M._debugState();
        if (!s.fieldTriggers[pt.id]) break;
      }
      await new Promise((r) => setTimeout(r, 800));
      const after = M._debugState();
      return {
        pointId: pt.id,
        triggerCleared: !after.fieldTriggers[pt.id],
        accum: after.attributeAccum ? after.attributeAccum[pt.id] : undefined,
      };
    }, inheritPt);
    if (inherit.skipped) {
      assert(false, "找得到可測的板塊點（測試前提）", inherit);
    } else {
      assert(inherit.triggerCleared, "樓層踏破後 fieldTrigger 被清空（測試前提成立）", inherit);
      assert(!inherit.accum || Object.keys(inherit.accum).length === 0, "該點的屬性／異常蓄積一併歸零，下一層新敵人不會繼承", inherit);
    }

    // ------------------------------------------------------------------
    // 其他② 獎勵清單關閉後仍叫得回來
    // ------------------------------------------------------------------
    console.log("=== 其他② 獎勵清單重新開啟 ===");
    const reward = await page.evaluate(async () => {
      const M = window.PriTestMidnight;
      const D = M._debugState();
      const GS = window.PriTestGameStorage;
      const reopen = document.getElementById("btn-midnight-reward-reopen");
      const modal = document.getElementById("midnight-reward-modal");
      // 給自己一筆個人待領獎勵
      await GS.rtSet(D.gameId, "cloud", "pendingRewards/" + D.myTokenId + "/t1", { kind: "rune", value: 10 });
      await new Promise((r) => setTimeout(r, 800));
      M._debugRenderRewardModal();
      const opened = { modalHidden: modal.hidden, reopenHidden: reopen.hidden };
      // 玩家按下關閉
      document.getElementById("btn-midnight-reward-close").click();
      const closed = { modalHidden: modal.hidden, reopenHidden: reopen.hidden, flash: reopen.className };
      // 再按重新開啟
      reopen.click();
      const reopened = { modalHidden: modal.hidden, reopenHidden: reopen.hidden };
      // 清掉，避免影響後續
      await GS.rtSet(D.gameId, "cloud", "pendingRewards/" + D.myTokenId + "/t1", null);
      return { opened, closed, reopened };
    });
    assert(reward.opened.modalHidden === false, "有未解決獎勵時清單會開著", reward.opened);
    assert(reward.opened.reopenHidden === true, "清單開著時不顯示重新開啟鈕", reward.opened);
    assert(reward.closed.modalHidden === true, "按下關閉後清單收起（只影響本機）", reward.closed);
    assert(reward.closed.reopenHidden === false, "關閉後出現重新開啟鈕（改版前完全叫不回來）", reward.closed);
    assert(reward.closed.flash.indexOf("midnight-flash-yellow") !== -1, "還有事情要處理時重新開啟鈕閃黃光", reward.closed);
    assert(reward.reopened.modalHidden === false, "按下重新開啟鈕後清單又開起來", reward.reopened);

    // 「別人揭示共享池獎勵時，先前關掉清單的人會自動重新彈出」——這是「一個人按下關閉
    // 導致其他人卡住」的根因（那一票永遠投不出去）。這裡在同一台裝置上模擬狀態變化：
    // 先關閉清單，再把某筆共享獎勵標成已揭示（drawn），確認 renderRewardModal() 的
    // 簽章改變、自動解除 dismissed。
    const sharedReopen = await page.evaluate(async () => {
      const M = window.PriTestMidnight;
      const D = M._debugState();
      const GS = window.PriTestGameStorage;
      const pt = (D.map.points || []).filter((p) => p.kind === "field" || p.card)[1];
      if (!pt) return { skipped: true };
      await GS.rtSet(D.gameId, "cloud", "fieldTrigger/" + pt.id, {
        status: "resolved",
        floorIndex: 0,
        participants: { 1: true },
        resolvedAt: Date.now(),
        sharedRewards: { s1: { kind: "rune", value: 5 } },
      });
      await new Promise((r) => setTimeout(r, 800));
      M._debugRenderRewardModal();
      M._debugSetRewardModalDismissed(true);
      const closed = M._debugRewardModalDismissed();
      // 另一台裝置按下［抽選］＝寫入 drawn
      await GS.rtSet(D.gameId, "cloud", "fieldTrigger/" + pt.id + "/sharedRewards/s1/drawn", { value: 5 });
      await new Promise((r) => setTimeout(r, 800));
      M._debugRenderRewardModal();
      const afterReveal = M._debugRewardModalDismissed();
      await GS.rtSet(D.gameId, "cloud", "fieldTrigger/" + pt.id, null);
      return { closed, afterReveal };
    });
    if (sharedReopen.skipped) {
      assert(false, "找得到第二個板塊點（測試前提）", sharedReopen);
    } else {
      assert(sharedReopen.closed === true, "先把清單關起來（測試前提）", sharedReopen);
      assert(sharedReopen.afterReveal === false, "別人揭示共享獎勵後，清單自動重新彈出（那一票不會再卡死）", sharedReopen);
    }

    const failed = results.filter((r) => !r.pass);
    console.log("\n==== 結果：" + (results.length - failed.length) + " / " + results.length + " 通過 ====");
    if (failed.length) {
      failed.forEach((f) => console.log("  FAIL: " + f.label));
      process.exitCode = 1;
    }
  } catch (err) {
    console.error("測試中斷：", err);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
