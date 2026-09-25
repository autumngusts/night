// ============================================================================
// midnight 2026-09-25 回歸測試：玩家操作角色 sprite（Playwright ＋ Firebase Local Emulator）
// ============================================================================
// 使用前準備（跟 sprite_dodge_check.js 完全相同）：
//   1. py -3 generate.py
//   2. py -3 -m http.server 8931 --directory dist
//   3. npx firebase emulators:start --only database,auth --project elden-ring-nightreign
//   4. PRITEST_BASE_URL=http://localhost:8931 node player_sprite_check.js
//
// 使用者明確規格（2026-09-25）：
//   ・「點陣圖模式，接入玩家使用的角色動作」＝ meta.spriteMode 的房間才顯示，動作跟著
//     玩家的實際操作播放。
//   ・「戰鬥時可以放入敵人的左側」＝ 玩家舞台整體位於敵人舞台的左邊。
//   ・「同房全員橫排」＝ 房內每位玩家各佔一格，橫向排開，各自播各自的動作。
//
// 2026-09-25 規格變更（同日第二版，使用者明確規格）：
//   ・「玩家的點陣圖與敵人點陣圖分離一些，玩家們的更靠左邊」＝ 圖框改成分離版面
//     （.midnight-sprite-arena）：敵人舞台靠右、玩家舞台在它的左外側，兩者不再重疊。
//     舊版斷言「玩家舞台矩形＝敵人舞台矩形」「面在舞台寬 × GROUP_RIGHT 的帯內」已過時。
//   ・「多人遊戲時自己的角色排列在右邊，剩餘兩人位置，每30秒輪流輪替正在進行的玩家」
//     ＝ 自分＋他の参加者最多 2 人、超過時 30 秒ごとに輪替（⑥）。
//   ・「創立房間，點陣圖預設開啟」＝ 新房間の meta.spriteMode は最初から true。
//
// 涵蓋項目：
//   ① 純資料／純函式：6×10 的行對應、10 種動作、frameIndexAt 的 loop／hold、
//      backgroundPosition 的行位移、登錄表 20 類型→10 sheet 且全部 available。
//   ② 版面：戰鬥中玩家舞台存在且**整體在敵人舞台左側**、接地線與敵人一致。
//   ③ 動作接線：迴避／一般攻擊／技藝 → 對應的 animId。
//   ④ 受擊與死亡：HP 下降 → hurt；瀕死 → death 且 hold 在最終幀。
//   ⑤ 兩裝置：兩人入座時雙方畫面都是 2 面橫排，且 B 的操作會在 A 的畫面播出來。
//   ⑥ 四裝置：畫面上最多 3 面（自分＋2 人）、自分が最右、30 秒ごとに他の 2 人が輪替。
//
// 期望值一律從 player_sprite_data.js／登錄表／實測的 DOM 位置算出，不硬編
// （CLAUDE.md §4.7 的原則）。點擊一律用 dispatchEvent（同 §4.6）。
// ============================================================================

const { chromium } = require("playwright");

const BASE = process.env.PRITEST_BASE_URL || "http://localhost:8931";
const META_WAIT_MS = 20000;

const results = [];
function assert(cond, label, detail) {
  results.push({ label, pass: !!cond });
  console.log(
    (cond ? "  [PASS] " : "  [FAIL] ") + label + (cond || detail === undefined ? "" : "　→ " + JSON.stringify(detail))
  );
}

const waitFor = (page, fn, arg, timeout) => page.waitForFunction(fn, arg, { timeout: timeout || META_WAIT_MS });
const state = (page) => page.evaluate(() => window.PriTestMidnight._debugState());

// database emulator 的 port（9000 被 IntelliJ 等佔用時用 PRITEST_EMU_PORT 覆寫，同 relic_memory_emulator_check.js）
const EMU_PORT = process.env.PRITEST_EMU_PORT || "9000";

async function enableEmulator(page) {
  await page.addInitScript((port) => {
    try {
      window.sessionStorage.setItem("pritestRtdbEmulator", "1");
      window.sessionStorage.setItem("pritestRtdbEmulatorPort", port);
    } catch (e) {
      /* 忽略 */
    }
  }, EMU_PORT);
}

// 自分の面の現在の動作。key は tokenId。
async function myAnim(page) {
  return page.evaluate(() => {
    var s = window.PriTestMidnight._debugState();
    return window.PriTestMidnightPlayerSprite.currentAnimId(s.myTokenId);
  });
}

// 「今の動作が終わって idle に戻る」まで待つ。動作は最長でも 1 秒ほど（arts の 6×150ms）。
async function waitIdle(page) {
  await waitFor(
    page,
    () => {
      var s = window.PriTestMidnight._debugState();
      return window.PriTestMidnightPlayerSprite.currentAnimId(s.myTokenId) === "idle";
    },
    null,
    5000
  );
}

async function refillStamina(page) {
  await page.evaluate(() => {
    const s = window.PriTestMidnight._debugState();
    s.stamina.current = s.stamina.max;
  });
}

// 舞台と面の実測矩形。舞台が非表示なら null。
async function stageRects(page) {
  return page.evaluate(() => {
    const enemy = document.getElementById("midnight-enemy-sprite-stage");
    const player = document.getElementById("midnight-player-sprite-stage");
    if (!player || player.hidden) return null;
    const faces = Array.prototype.slice.call(player.querySelectorAll(".midnight-player-sprite-face"));
    const r = (el) => {
      const b = el.getBoundingClientRect();
      return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, w: b.width, h: b.height };
    };
    return {
      enemy: enemy && !enemy.hidden ? r(enemy) : null,
      player: r(player),
      faces: faces.map(r),
    };
  });
}

async function createSpriteRoom(page, opts) {
  await page.goto(BASE + "/midnight/index.html", { waitUntil: "networkidle" });
  await page.click("#btn-midnight-create");
  await waitFor(page, () => window.PriTestMidnight && window.PriTestMidnight._debugState().meta);
  await page.click("#midnight-lobby-slots .midnight-slot-empty button");
  await page.fill("#midnight-lobby-passcode-input", "1234");
  await page.click("#btn-midnight-lobby-join");
  await waitFor(page, () => !!window.PriTestMidnight._debugState().mySlot);
  // 2026-09-25 規格「創立房間，點陣圖預設開啟」：勾選操作は不要になった（meta 作成時から true）。
  await waitFor(page, () => window.PriTestMidnight._debugState().meta.spriteMode === true);
  if (!opts || !opts.skipBattleSim) {
    // 戰鬥模擬の三列は測試模式を開かないと出てこない（sprite_dodge_check.js と同じ）。
    page.once("dialog", (d) => d.accept("nightnight"));
    await page.check("#midnight-lobby-test-mode-checkbox");
    await waitFor(page, () => !document.querySelector("#midnight-lobby-test-tools").hidden);
    page.once("dialog", (d) => d.accept("nightnight"));
    await page.click("#btn-midnight-lobby-battle-sim");
    await waitFor(page, () => !!(window.PriTestMidnight._debugState().meta.battleSim || {}).enemyId);
  }
  return page.url();
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log("  [pageerror] " + e.message));
  await enableEmulator(page);

  try {
    console.log("=== 建立點陣圖模式＋戰鬥模擬房（單人） ===");
    await createSpriteRoom(page);

    console.log("=== ① 純資料／純函式 ===");
    const data = await page.evaluate(() => {
      const S = window.PriTestPlayerSprite;
      return {
        cols: S.SHEET_COLS,
        rows: S.SHEET_ROWS,
        anims: S.listAnims().map((a) => ({ id: a.id, row: a.row, n: a.frameCount, loop: a.loop, hold: a.hold, p: a.priority })),
      };
    });
    assert(data.cols === 6 && data.rows === 10, "玩家 sheet 規格是 6 欄 × 10 列", data);
    // 行の意味は tools/sprite_spec.md「玩家操作角色 sheet」の表がすべて。ここが狂うと
    // 全角色の全動作が別の絵になるので、順序まで固定で確かめる。
    const wantRows = ["idle", "dodge", "hurt", "death", "attack1", "attack2", "critical", "ability", "skill", "arts"];
    assert(
      data.anims.length === 10 && data.anims.every((a, i) => a.id === wantRows[i] && a.row === i),
      "10 種動作が spec の行順（待機/迴避/受擊/死亡/1hit/2hit/致命/能力/技能/技藝）で row 0~9 に並ぶ",
      data.anims
    );
    assert(data.anims.every((a) => a.n === 6), "各行とも 6 幀", data.anims.map((a) => a.n));
    const idle = data.anims[0];
    const death = data.anims[3];
    assert(idle.loop === true && idle.hold === false, "待機は loop、hold しない", idle);
    assert(death.loop === false && death.hold === true, "死亡は loop せず最終幀で hold", death);
    assert(
      death.p > data.anims[2].p && data.anims[2].p > data.anims[8].p,
      "優先度：死亡 > 受擊 > 技能（受擊は招式を割り込めるが、死亡は何にも割り込まれない）",
      data.anims.map((a) => a.id + ":" + a.p)
    );

    const fn = await page.evaluate(() => {
      const P = window.PriTestMidnightPlayerSprite;
      const S = window.PriTestPlayerSprite;
      const idleMs = S.getAnim("idle").frameMs;
      const deathMs = S.getAnim("death").frameMs;
      const atkMs = S.getAnim("attack1").frameMs;
      return {
        idleWrap: P.frameIndexAt("idle", idleMs * 7), // loop：7 幀目は 1 に折り返す
        deathHold: P.frameIndexAt("death", deathMs * 99), // hold：終わっても最終幀
        atkEnd: P.frameIndexAt("attack1", atkMs * 6), // hold しない：終われば null
        posRow0: P.backgroundPosition("idle", 2, 100, 100),
        posRow9: P.backgroundPosition("arts", 0, 100, 100),
      };
    });
    assert(fn.idleWrap === 1, "待機は 6 幀で折り返す（frameIndexAt）", fn);
    assert(fn.deathHold === 5, "死亡は最終幀（index 5）で止まる", fn);
    assert(fn.atkEnd === null, "hold しない動作は終わると null（呼び出し端が idle へ戻す）", fn);
    // 期待値の書式は敵人側と同じ：-(0 * px) は JS の文字列化で "0"（"-0" にはならない）。
    assert(fn.posRow0 === "-200px 0px", "backgroundPosition：待機行（row0）は縦オフセット 0、横は 2 幀ぶん", fn);
    assert(fn.posRow9 === "0px -900px", "backgroundPosition：技藝行（row9）は 9 格ぶん上へ（row×格高）", fn);

    const reg = await page.evaluate(() => {
      const R = window.PriTestPlayerSpriteRegistry;
      const types = window.PriTestCharacterTypes.list().map((t) => t.id);
      return {
        sheets: R.listSheets().map((s) => ({ id: s.id, available: s.available })),
        types: types.length,
        mapped: types.filter((id) => !!R.sheetFileForType(id)).length,
        // 暗黑／黎明の派生は素体と同じ sheet を共用する設計
        trackerPair: [R.sheetIdForType("tracker"), R.sheetIdForType("tracker_dark")],
      };
    });
    assert(reg.sheets.length === 10, "sheet は 10 組（基礎角色 10 種）", reg.sheets.length);
    assert(reg.sheets.every((s) => s.available), "10 組とも產出済み（available: true）", reg.sheets.filter((s) => !s.available));
    assert(reg.types === 20 && reg.mapped === 20, "20 個角色類型すべてに sheet が当たる", reg);
    assert(reg.trackerPair[0] === reg.trackerPair[1], "派生類型（tracker_dark）は素体と同じ sheet を共用", reg.trackerPair);

    console.log("=== 開局進戰鬥 ===");
    await page.click("#btn-midnight-lobby-ready");
    await waitFor(page, () => (window.PriTestMidnight._debugState().activeEncounter || {}).id === "battleSim", null, 30000);
    // 舞台は面板が開いた次の影格で mount → setParty されるので少し待つ
    await waitFor(page, () => {
      const el = document.getElementById("midnight-player-sprite-stage");
      return !!(el && !el.hidden && el.querySelector(".midnight-player-sprite-face"));
    }, null, 15000);

    console.log("=== ② 版面：玩家在敵人的左側 ===");
    // 舞台の幅は親（#midnight-field-encounter-image-wrap、inline-block）＝敵人插圖の
    // 実寸に従う。插圖の読み込みが終わるまでは数十 px しかないので、確定を待ってから測る。
    await waitFor(page, () => {
      const el = document.getElementById("midnight-player-sprite-stage");
      return !!el && el.offsetWidth >= 100;
    }, null, 15000);
    await page.waitForTimeout(120); // 次の影格の syncLayout() が面を書き直すのを待つ
    const rects = await stageRects(page);
    const L = await page.evaluate(() => {
      const P = window.PriTestMidnightPlayerSprite;
      return { arenaMax: P.ARENA_FACE_MAX_H, step: P.FACE_STEP, arena: P.isArena() };
    });
    assert(!!rects && rects.faces.length === 1, "單人房：玩家面は 1 面", rects && rects.faces.length);
    assert(!!rects.enemy, "敵人舞台も表示中（比較対象がある）", !!rects.enemy);
    // 2026-09-25 規格「玩家的點陣圖與敵人點陣圖分離一些，玩家們的更靠左邊」：
    // 舊版は「玩家舞台＝敵人舞台と同一矩形、帯 0~GROUP_RIGHT に左寄せ」だったが、
    // 分離版面では玩家舞台が敵人舞台の左外側に丸ごと出る。
    const arenaOn = await page.evaluate(() =>
      document.getElementById("midnight-field-encounter-image-wrap").classList.contains("midnight-sprite-arena")
    );
    assert(arenaOn && L.arena, "點陣圖接手時は分離版面（.midnight-sprite-arena）", { arenaOn, arena: L.arena });
    // 2026-09-25 同日第三版（使用者明確規格「敵人點陣圖仍在戰鬥面板中心位置，人物貼左邊」）：
    // 第二版の「敵人舞台は右寄せ・玩家舞台はその左外側で重ならない」は過時。敵人は面板中央、
    // 玩家舞台は面板の左端から始まり、敵人の 1 格の左 10% まで伸びる（敵人の格の留白ぶん）。
    const panelBox = await page.evaluate(() => {
      const p = document.getElementById("midnight-hud-bottom-center");
      const ps = getComputedStyle(p);
      const b = p.getBoundingClientRect();
      return {
        left: b.left + parseFloat(ps.paddingLeft) + parseFloat(ps.borderLeftWidth),
        right: b.right - parseFloat(ps.paddingRight) - parseFloat(ps.borderRightWidth),
      };
    });
    const panelMid = (panelBox.left + panelBox.right) / 2;
    assert(
      Math.abs(rects.enemy.left + rects.enemy.w / 2 - panelMid) <= 2,
      "敵人舞台は戰鬥面板の中央",
      { enemyMid: Math.round(rects.enemy.left + rects.enemy.w / 2), panelMid: Math.round(panelMid) }
    );
    assert(
      Math.abs(rects.player.left - panelBox.left) <= 2,
      "玩家舞台は面板の左端から始まる（人物貼左邊）",
      { player: Math.round(rects.player.left), panel: Math.round(panelBox.left) }
    );
    assert(
      rects.player.right <= rects.enemy.left + rects.enemy.w * 0.1 + 1,
      "玩家舞台が敵人の 1 格に入り込むのは左 10% まで",
      { playerRight: Math.round(rects.player.right), enemyLeft: Math.round(rects.enemy.left) }
    );
    assert(
      Math.abs(Math.min.apply(null, rects.faces.map((f) => f.left)) - rects.player.left) <= 1,
      "面の群れは帯の左端に寄る",
      rects.faces.map((f) => Math.round(f.left))
    );
    assert(
      rects.faces.every((f) => f.left >= rects.player.left - 1 && f.right <= rects.player.right + 1),
      "面はすべて玩家舞台の中＝敵人より左に立つ",
      rects.faces.map((f) => [Math.round(f.left), Math.round(f.right)])
    );
    assert(
      rects.faces[0].left + rects.faces[0].w / 2 < rects.enemy.left + rects.enemy.w / 2,
      "面の中心は敵人舞台の中心より左",
      { face: Math.round(rects.faces[0].left + rects.faces[0].w / 2), enemy: Math.round(rects.enemy.left + rects.enemy.w / 2) }
    );
    assert(
      Math.abs(rects.player.bottom - rects.enemy.bottom) <= 2,
      "玩家舞台と敵人舞台の下端（接地線）が一致",
      { player: Math.round(rects.player.bottom), enemy: Math.round(rects.enemy.bottom) }
    );
    // 期待値は syncLayout() と同じ式から算出（硬編しない、CLAUDE.md §4.7）。
    // 分離版面：帯＝玩家舞台の全幅、上限＝舞台の高さ × ARENA_FACE_MAX_H。
    const wantFaceW = (r, n) =>
      Math.max(24, Math.round(Math.min(r.h * L.arenaMax, r.w / (1 + (n - 1) * L.step))));
    assert(
      Math.abs(rects.faces[0].w - wantFaceW(rects.player, 1)) <= 2,
      "1 面の幅＝上限（舞台高 × " + L.arenaMax + "）と帯に収まる幅の小さいほう",
      { face: Math.round(rects.faces[0].w), want: wantFaceW(rects.player, 1) }
    );
    assert(
      Math.abs(rects.faces[0].bottom - rects.player.bottom) <= 2,
      "面は舞台の下端に接地（敵人と同じ地面に立つ）",
      { face: Math.round(rects.faces[0].bottom), stage: Math.round(rects.player.bottom) }
    );

    console.log("=== ③ 動作接線 ===");
    await waitIdle(page);
    await refillStamina(page);
    await page.dispatchEvent("#btn-midnight-dodge", "click");
    assert((await myAnim(page)) === "dodge", "迴避鍵 → dodge（row1）", await myAnim(page));

    await waitIdle(page);
    await refillStamina(page);
    // 攻擊鍵は長按（蓄力）に対応するため mousedown/mouseup 綁定で、click は綁いていない
    // （bindAttackHoldInput()）。CLAUDE.md §4.6 に従い dispatchEvent で両方送る。
    await page.dispatchEvent("#btn-midnight-attack-shared-target", "mousedown");
    await page.waitForTimeout(60);
    await page.dispatchEvent("#btn-midnight-attack-shared-target", "mouseup");
    await page.waitForTimeout(60);
    const atkAnim = await myAnim(page);
    assert(atkAnim === "attack1" || atkAnim === "attack2", "攻擊鍵 → attack1／attack2（row4／row5）", atkAnim);

    await waitIdle(page);
    await refillStamina(page);
    // 技藝は習得レベルと冷卻の縛りがあるので、debug 入口で条件をそろえてから撃つ。
    const artFired = await page.evaluate(() => {
      const M = window.PriTestMidnight;
      const s = M._debugState();
      M._debugSetTypeAndLevel(s.characters[s.myTokenId].typeId, 3);
      M._debugResetMyAbilityCooldowns();
      s.stamina.current = s.stamina.max;
      M._debugSetFp(99);
      M._debugUseCharacterAbility("art");
      return window.PriTestMidnightPlayerSprite.currentAnimId(s.myTokenId);
    });
    assert(artFired === "arts", "角色技藝 → arts（row9）", artFired);

    console.log("=== ④ 受擊と死亡 ===");
    await waitIdle(page);
    // HP を 1 点だけ減らす（demoStats は _debugState() が生の参照を返すので直接触れる）。
    // 受擊は「HP が減った影格」で鳴るので、次の影格まで待つ。
    await page.evaluate(() => {
      const s = window.PriTestMidnight._debugState();
      s.demoStats[s.myTokenId] = (s.demoStats[s.myTokenId] || 100) - 1;
    });
    await waitFor(page, () => {
      const s = window.PriTestMidnight._debugState();
      return window.PriTestMidnightPlayerSprite.currentAnimId(s.myTokenId) === "hurt";
    }, null, 3000).catch(() => {});
    assert((await myAnim(page)) === "hurt", "HP が減ると hurt（row2）。新しい欄位は足さず demoStats の変化だけで鳴る", await myAnim(page));

    await page.evaluate(() => {
      const s = window.PriTestMidnight._debugState();
      s.characters[s.myTokenId].nearDeath = { active: true, at: Date.now() };
    });
    await waitFor(page, () => {
      const s = window.PriTestMidnight._debugState();
      return window.PriTestMidnightPlayerSprite.currentAnimId(s.myTokenId) === "death";
    }, null, 3000).catch(() => {});
    assert((await myAnim(page)) === "death", "瀕死になると death（row3）。受擊より優先", await myAnim(page));
    const deathTotalMs = await page.evaluate(() => window.PriTestPlayerSprite.animTotalMs("death"));
    await page.waitForTimeout(deathTotalMs + 400);
    assert((await myAnim(page)) === "death", "死亡動畫は再生後も idle に戻らない（hold）", await myAnim(page));
    // 蘇生したら自分では戻れないので、呼び出し端が idle に戻すこと
    await page.evaluate(() => {
      const s = window.PriTestMidnight._debugState();
      s.characters[s.myTokenId].nearDeath = { active: false };
    });
    await waitFor(page, () => {
      const s = window.PriTestMidnight._debugState();
      return window.PriTestMidnightPlayerSprite.currentAnimId(s.myTokenId) === "idle";
    }, null, 3000).catch(() => {});
    assert((await myAnim(page)) === "idle", "瀕死が解けると idle へ戻る（hold したままにならない）", await myAnim(page));

    console.log("=== ④-3 迴避／防禦（含快捷鍵）で詠唱と聖杯瓶が中断される ===");
    // 2026-09-25 使用者明確規格「使用需要施法的攻擊時，例如法術以及聖杯瓶，按下閃避防禦包含快捷鍵時會取消使用」
    const flaskState = () =>
      page.evaluate(() => {
        const bar = document.getElementById("midnight-flask-read-fill");
        return { width: parseFloat(bar.style.width) || 0, using: !document.getElementById("midnight-flask-using-badge").hidden };
      });
    // 聖杯瓶 → 迴避鍵
    await refillStamina(page);
    await page.dispatchEvent("#btn-midnight-use-flask", "click");
    await page.waitForTimeout(150);
    const fBefore = await flaskState();
    await page.dispatchEvent("#btn-midnight-dodge", "pointerdown");
    await page.waitForTimeout(120);
    const fAfter = await flaskState();
    assert(fBefore.width > 0 && fAfter.width === 0, "聖杯瓶讀取中に迴避を押すと読み取りが中断", { fBefore, fAfter });
    await waitIdle(page);
    // 聖杯瓶 → Shift（迴避の快捷鍵）
    await refillStamina(page);
    await page.dispatchEvent("#btn-midnight-use-flask", "click");
    await page.waitForTimeout(150);
    const fBefore2 = await flaskState();
    await page.keyboard.down("Shift");
    await page.keyboard.up("Shift");
    await page.waitForTimeout(120);
    const fAfter2 = await flaskState();
    assert(fBefore2.width > 0 && fAfter2.width === 0, "快捷鍵 Shift でも聖杯瓶が中断", { fBefore2, fAfter2 });
    // 防禦（G／防禦鍵）：盾か両手持ちで防禦できる角色のときだけ検査できる
    const canBlock = await page.evaluate(() => {
      const b = document.getElementById("btn-midnight-block");
      return !!(b && !b.hidden && !b.disabled && b.offsetParent !== null);
    });
    if (canBlock) {
      await page.dispatchEvent("#btn-midnight-use-flask", "click");
      await page.waitForTimeout(150);
      const fBefore3 = await flaskState();
      await page.keyboard.down("g");
      await page.waitForTimeout(120);
      const fAfter3 = await flaskState();
      await page.keyboard.up("g");
      assert(fBefore3.width > 0 && fAfter3.width === 0, "快捷鍵 G（防禦）でも聖杯瓶が中断", { fBefore3, fAfter3 });
    } else {
      console.log("  （この角色は防禦鍵が使えないので G の検査は省略）");
    }
    // 魔術／祈禱の長按詠唱 → 迴避／Shift。長按は dispatchEvent では維持できない（CLAUDE.md §4.6）
    // ので、既存の _debugSetSorceryHold() で「詠唱中」を作ってから押す。
    for (const how of ["pointer", "shift"]) {
      const before = await page.evaluate(() => {
        const M = window.PriTestMidnight;
        M._debugSetSorceryHold(M._debugSorceryButtonKeys()[0], true);
        return M._debugSorceryHoldKeys().length;
      });
      await refillStamina(page);
      if (how === "pointer") await page.dispatchEvent("#btn-midnight-dodge", "pointerdown");
      else {
        await page.keyboard.down("Shift");
        await page.keyboard.up("Shift");
      }
      await page.waitForTimeout(80);
      const after = await page.evaluate(() => window.PriTestMidnight._debugSorceryHoldKeys().length);
      assert(before > 0 && after === 0, "魔術／祈禱の長按詠唱中に" + (how === "pointer" ? "迴避鍵" : "快捷鍵 Shift") + "で詠唱が中断", { before, after });
      await waitIdle(page);
    }

    console.log("=== ④-2 同じ面で sheet が変わっても切幀が進む ===");
    // 2026-09-25 修正：setParty() が面の sheet を差し替えると cellPx を 0 に戻すのに、
    // 舞台の寸法が同じだと syncLayout() が何もしないため cellPx=0 のまま残り、
    // 横オフセットが常に 0（＝各行の 1 幀目で止まる）になっていた。
    const swap = await page.evaluate(async () => {
      const s = window.PriTestMidnight._debugState();
      const c = s.characters[s.myTokenId];
      const P = window.PriTestMidnightPlayerSprite;
      const S = window.PriTestPlayerSprite;
      const orig = c.typeId;
      c.typeId = orig === "guardian" ? "scholar" : "guardian";
      await new Promise((r) => setTimeout(r, 400));
      const face = document.querySelector("#midnight-player-sprite-stage .midnight-player-sprite-face");
      const a = S.getAnim("attack1");
      // 3 幀目の途中から再生させる
      P.playAnim(s.myTokenId, "attack1", Date.now() - a.frameMs * 3 - a.frameMs / 2, true);
      await new Promise((r) => setTimeout(r, 40));
      const pos = face.style.backgroundPosition;
      const w = face.getBoundingClientRect().width;
      c.typeId = orig;
      return { pos: pos, w: w, file: face.style.backgroundImage };
    });
    const swapX = parseFloat(swap.pos);
    assert(
      swapX < -1 && Math.abs(Math.round(-swapX / swap.w) - 3) <= 1,
      "sheet 差し替え後も backgroundPosition の横が進む（1 幀目で止まらない）",
      swap
    );

    console.log("=== ⑤ 兩裝置：全員橫排と他人の動作 ===");
    const pageB = await browser.newPage();
    pageB.on("pageerror", (e) => console.log("  [pageerror B] " + e.message));
    await enableEmulator(pageB);
    const pageA2 = await browser.newPage();
    pageA2.on("pageerror", (e) => console.log("  [pageerror A2] " + e.message));
    await enableEmulator(pageA2);
    const url2 = await createSpriteRoom(pageA2);
    await pageB.goto(url2, { waitUntil: "networkidle" });
    await waitFor(pageB, () => window.PriTestMidnight && window.PriTestMidnight._debugState().meta);
    await pageB.click("#midnight-lobby-slots .midnight-slot-empty button");
    await pageB.fill("#midnight-lobby-passcode-input", "5678");
    await pageB.click("#btn-midnight-lobby-join");
    await waitFor(pageB, () => !!window.PriTestMidnight._debugState().mySlot);
    await pageA2.click("#btn-midnight-lobby-ready");
    await pageB.click("#btn-midnight-lobby-ready");
    await waitFor(pageA2, () => (window.PriTestMidnight._debugState().activeEncounter || {}).id === "battleSim", null, 40000);
    await waitFor(pageB, () => (window.PriTestMidnight._debugState().activeEncounter || {}).id === "battleSim", null, 40000);
    const twoFaces = (p) =>
      waitFor(p, () => document.querySelectorAll("#midnight-player-sprite-stage .midnight-player-sprite-face").length === 2, null, 15000);
    let bothTwo = true;
    try {
      await twoFaces(pageA2);
      await twoFaces(pageB);
    } catch (e) {
      bothTwo = false;
    }
    assert(bothTwo, "2 人入座 → 両装置とも 2 面が横排で出る");
    // 単人のときと同じ理由で、舞台幅が確定してから採寸する（插圖の読み込み待ち）
    await waitFor(pageA2, () => {
      const el = document.getElementById("midnight-player-sprite-stage");
      return !!el && el.offsetWidth >= 100;
    }, null, 15000);
    await pageA2.waitForTimeout(120);
    const rectsA2 = await stageRects(pageA2);
    if (rectsA2 && rectsA2.faces.length === 2) {
      assert(
        rectsA2.faces[0].left > rectsA2.faces[1].left &&
          rectsA2.faces.every((f) => f.right <= rectsA2.enemy.left + rectsA2.enemy.w * 0.1 + 2), // 面寬・間隔の Math.round で ~1px 出ることがある
        "先頭（自分）が敵人に近い側（右）、2 人目はその左。2 人とも玩家の帯の中",
        rectsA2.faces.map((f) => Math.round(f.left))
      );
      assert(
        Math.abs(rectsA2.faces[0].w - wantFaceW(rectsA2.player, 2)) <= 2,
        "2 人のときは 1 面が帯に収まるぶんまで細くなる",
        { face: Math.round(rectsA2.faces[0].w), want: wantFaceW(rectsA2.player, 2) }
      );
      assert(
        Math.abs(rectsA2.faces[0].bottom - rectsA2.faces[1].bottom) <= 2,
        "2 人の接地線がそろう",
        rectsA2.faces.map((f) => Math.round(f.bottom))
      );
    } else {
      assert(false, "2 面ぶんの矩形が取れる", rectsA2 && rectsA2.faces.length);
    }
    // B が迴避 → A の画面でも B の面が dodge になる
    const bToken = (await state(pageB)).myTokenId;
    await refillStamina(pageB);
    await pageB.dispatchEvent("#btn-midnight-dodge", "click");
    let remoteOk = true;
    try {
      await waitFor(pageA2, (tid) => window.PriTestMidnightPlayerSprite.currentAnimId(tid) === "dodge", bToken, 8000);
    } catch (e) {
      remoteOk = false;
    }
    assert(remoteOk, "B の迴避が A の画面でも B の面で再生される（_spriteAnim の通し番号同期）");
    await pageA2.close();
    await pageB.close();

    console.log("=== ⑥ 四裝置：自分＋2 人、30 秒ごとに輪替 ===");
    const pages4 = [];
    for (let i = 0; i < 4; i++) {
      const p = await browser.newPage();
      p.on("pageerror", (e) => console.log("  [pageerror 4-" + i + "] " + e.message));
      await enableEmulator(p);
      pages4.push(p);
    }
    const url4 = await createSpriteRoom(pages4[0]);
    for (let i = 1; i < 4; i++) {
      await pages4[i].goto(url4, { waitUntil: "networkidle" });
      await waitFor(pages4[i], () => window.PriTestMidnight && window.PriTestMidnight._debugState().meta);
      await pages4[i].click("#midnight-lobby-slots .midnight-slot-empty button");
      await pages4[i].fill("#midnight-lobby-passcode-input", String(2000 + i));
      await pages4[i].click("#btn-midnight-lobby-join");
      await waitFor(pages4[i], () => !!window.PriTestMidnight._debugState().mySlot);
    }
    for (let i = 0; i < 4; i++) await pages4[i].click("#btn-midnight-lobby-ready");
    for (let i = 0; i < 4; i++) {
      await waitFor(pages4[i], () => (window.PriTestMidnight._debugState().activeEncounter || {}).id === "battleSim", null, 40000);
    }
    const A4 = pages4[0];
    await waitFor(A4, () => document.querySelectorAll("#midnight-player-sprite-stage .midnight-player-sprite-face").length === 3, null, 15000)
      .catch(() => {});
    // 期待値：他の 3 人（席順）を floor(now/30000) % 3 だけずらして先頭 2 人（playerSpriteParty() と同じ式）。
    const cast = () =>
      A4.evaluate(() => {
        const s = window.PriTestMidnight._debugState();
        const faces = Array.prototype.slice.call(document.querySelectorAll("#midnight-player-sprite-stage .midnight-player-sprite-face"));
        const P = window.PriTestMidnightPlayerSprite;
        return {
          now: Date.now(),
          count: P.faceCount(),
          lefts: faces.map((f) => f.getBoundingClientRect().left),
          myAnimKnown: P.currentAnimId(s.myTokenId) !== null,
          others: Object.keys(s.players || {})
            .sort((a, b) => Number(a) - Number(b))
            .map((slot) => s.players[slot] && s.players[slot].tokenId)
            .filter((t) => t && t !== s.myTokenId),
          onStage: Object.keys(s.players || {})
            .map((slot) => s.players[slot] && s.players[slot].tokenId)
            .filter((t) => t && P.currentAnimId(t) !== null),
          me: s.myTokenId,
        };
      });
    const expectOthers = (c) => {
      const off = Math.floor(c.now / 30000) % c.others.length;
      return [c.others[off % c.others.length], c.others[(off + 1) % c.others.length]].sort();
    };
    const c1 = await cast();
    assert(c1.count === 3, "4 人でも舞台に出るのは 3 面（自分＋2 人）", c1.count);
    assert(c1.onStage.indexOf(c1.me) !== -1, "自分は常に出演", c1.onStage);
    const shownOthers1 = c1.onStage.filter((t) => t !== c1.me).sort();
    assert(JSON.stringify(shownOthers1) === JSON.stringify(expectOthers(c1)), "他の 2 人は 30 秒窓の輪替順どおり", {
      shown: shownOthers1,
      want: expectOthers(c1),
    });
    const lefts1 = c1.lefts;
    assert(lefts1.length === 3 && lefts1[0] > lefts1[1] && lefts1[1] > lefts1[2], "自分（先頭）が最右、残りはその左へ", lefts1);
    // 次の 30 秒境界をまたいでから、顔ぶれが入れ替わったかを見る
    const waitMs = 30000 - (c1.now % 30000) + 800;
    console.log("  次の輪替まで " + Math.round(waitMs / 1000) + " 秒待つ…");
    await A4.waitForTimeout(waitMs);
    const c2 = await cast();
    const shownOthers2 = c2.onStage.filter((t) => t !== c2.me).sort();
    assert(c2.count === 3, "輪替後も 3 面", c2.count);
    assert(JSON.stringify(shownOthers2) === JSON.stringify(expectOthers(c2)), "30 秒後、他の 2 人が次の組に入れ替わる", {
      shown: shownOthers2,
      want: expectOthers(c2),
    });
    assert(JSON.stringify(shownOthers1) !== JSON.stringify(shownOthers2), "顔ぶれが実際に変わった", [shownOthers1, shownOthers2]);
    for (const p of pages4) await p.close();

    console.log("");
    const failed = results.filter((r) => !r.pass);
    console.log(results.length - failed.length + "/" + results.length + " PASS");
    if (failed.length) {
      console.log("FAILED:");
      failed.forEach((r) => console.log("  - " + r.label));
    }
    process.exitCode = failed.length ? 1 : 0;
  } catch (e) {
    console.log("EXCEPTION: " + (e && e.stack ? e.stack : e));
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
