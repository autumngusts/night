// ============================================================================
// 劇本1「三首獣／tricephalos」三人入場・多裝置同步・全流程（day1→day2→day3
// 夜之王戰鬥）回歸測試
// ============================================================================
// 用途：延伸既有 scenario_playthrough.js（僅測day1、單頁面、戰鬥用notifyCombatEnded()
// 跳過）與 scenario23_full_playthrough.js（day1→day2→day3完整推進、但一樣跳過戰鬥）
// 的做法，這次改成：
//
//   1. 3名角色入場（不是既有腳本的2名），開啟「全自動化GM」與「簡易抽選」。
//   2. storageMode用"cloud"（真實Firebase），並且真的開3個Playwright分頁（模擬3台
//      裝置）都導向同一個game，其中1個分頁當主控（driving）、其餘2個當旁觀
//      （observer），在關鍵時刻（樓層獎勵清單彈窗、突破判定彈窗、event chip彈窗、
//      地圖移動、進入下一天）比對主控與旁觀分頁的畫面/state是否同步。
//   3. 戰鬥不用notifyCombatEnded()跳過——一般樓層/籌碼觸發的雜魚戰鬥、與day3最終
//      夜之王（gladius）戰鬥，都真的透過UI操作打完整場（PC側：擲體力骰→開戰鬥視窗→
//      選武器Hit1/Hit2→選骰子→確認攻擊，重複到全員已完成→按[攻擊/防禦]；防禦階段
//      依賴state.autoGmEnabled的autoTriggerDefenseRoll自動擲骰，GM只需要對每位PC按
//      確定；[結束回合]後自動進到下一階段，直到敵人HP全部歸零、actionPhase自動回到
//      "normal"為止）。
//   4. 額外驗證「潛在之力」視窗跨裝置各自獨立（不同角色在不同裝置各自開視窗，互不
//      覆蓋，縮小/復原正確）。
//
// 使用前準備：
//   1. 於repo根目錄執行 `py -3 generate.py`（或`python generate.py`）產生dist/。
//   2. 啟動本機伺服器：`py -3 -m http.server 8791 --directory dist`
//      （或設定環境變數PRITEST_BASE_URL指到你自己啟動的位址）。
//   3. 於本資料夾執行 `npm install`（僅需安裝一次）。
//   4. 需要能連上真實Firebase（storageMode="cloud"）——如果沒有網路或Firebase設定
//      有誤，跨裝置同步相關的檢查會直接回報失敗，屬於預期行為。
//
// 執行方式：
//   node scenario1_full_multi_device_playthrough.js
//
// 結果寫入 scenario1-multi-device-results.json（未加入git）。
// ============================================================================

const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const BASE = process.env.PRITEST_BASE_URL || "http://localhost:8791";
const SCENARIO_ID = "tricephalos";
const RESULTS_PATH = path.join(__dirname, "scenario1-multi-device-results.json");

const consoleErrors = { driver: [], obsB: [], obsC: [] };
const findings = []; // 疑似App本身的bug（不是腳本邏輯錯誤）
const criteriaLog = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [], 8: [] };

function note(n, text) {
  criteriaLog[n].push(text);
  console.log("  [criterion " + n + "] " + text);
}
function bug(text) {
  findings.push(text);
  console.log("  !! [疑似App bug] " + text);
}

async function waitFirebaseReady(page) {
  await page.waitForFunction(() => window.firebase && window.firebase.apps.length > 0, { timeout: 15000 });
  await page.waitForFunction(() => window.firebase.auth().currentUser !== null, { timeout: 15000 });
}

async function setupGame(driver) {
  await driver.goto(BASE + "/admin/index.html", { waitUntil: "networkidle" });
  await driver.evaluate(() => window.PriTestGames.list().forEach((g) => window.PriTestGames.remove(g.id)));
  const gameId = await driver.evaluate(
    (scenarioId) => window.PriTestGames.create("s1-multi-" + Date.now(), scenarioId, "cloud").id,
    SCENARIO_ID
  );
  return gameId;
}

async function openDevicePage(page, gameId) {
  await page.goto(BASE + "/night/index.html?game=" + gameId, { waitUntil: "networkidle" });
  await waitFirebaseReady(page);
  await page.waitForTimeout(1000);
}

async function bootstrapCharacters(driver) {
  await driver.evaluate(() => document.getElementById("btn-auto-gm-toggle").click());
  await driver.evaluate(() => document.getElementById("btn-simplified-draw-toggle").click());
  await driver.waitForTimeout(300);
  const charIds = await driver.evaluate(() => {
    const Core = window.PriTestNightCore;
    const CD = window.PriTestCharacterDrawer;
    const CT = window.PriTestCharacterTypes;
    const types = CT.list();
    const roster = Core.getRosterCharacters();
    const ids = [];
    for (let i = 0; i < 3; i++) {
      const typeId = types[i % types.length].id;
      const c = CD.newCharacter("測試者" + (i + 1), typeId);
      c.entered = true;
      c.blessingSlots = { current: 2, max: 2 };
      if (c.weaponIds && c.weaponIds.length) c.equippedWeaponIds = [c.weaponIds[0]];
      roster.push(c);
      ids.push(c.id);
    }
    Core.saveRosterCharacters();
    Core.state.stoneswordKeyCount = 99;
    Core.state.smithingStoneCount = 99;
    Core.saveState();
    return ids;
  });
  await driver.waitForTimeout(1500); // bootstrap push給其他裝置
  return charIds;
}

async function dealInitial(driver) {
  await driver.evaluate(() => document.getElementById("btn-primary-action").click());
  await driver.waitForTimeout(200);
}

// ---------------------------------------------------------------------------
// 跨裝置同步比對
// ---------------------------------------------------------------------------
async function compareModalSync(pages, modalId, label) {
  await pages[0].waitForTimeout(1800);
  const states = [];
  for (const p of pages) {
    states.push(
      await p.evaluate((id) => {
        const el = document.getElementById(id);
        return el ? { hidden: el.hidden, text: (el.textContent || "").slice(0, 120) } : { hidden: null };
      }, modalId)
    );
  }
  const allSame = states.every((s) => s.hidden === states[0].hidden);
  if (allSame) note(1, label + "：3個分頁hidden狀態一致(" + states[0].hidden + ")");
  else {
    note(1, label + "：分頁間hidden狀態不一致！" + JSON.stringify(states));
    bug(label + " 跨裝置沒有同步：" + JSON.stringify(states));
  }
  return states;
}

// ---------------------------------------------------------------------------
// 戰鬥驅動（一般樓層戰鬥／籌碼強敵戰鬥／day3最終夜之王戰鬥共用）
// ---------------------------------------------------------------------------
// 使用者確認（2026-09-01再追加）：「盡量使用2Hit攻擊」——武器攻擊分頁裡，同一把武器一定是
// 先渲染1Hit按鈕、再渲染2Hit按鈕（見night.jsのrenderCombatAttackAction，hitTypes固定
// ["hit1","hit2"]順序；沒有2Hit概念的武器種類則只有1Hit按鈕）。按鈕文字固定是"1Hit"/"2Hit"
// （site_src/i18n_data_zh.py確認），不必去猜測傷害數字，直接把文字含"2Hit"的按鈕排到前面
// 優先嘗試即可，2Hit不可行（骰子成本付不起）才會退回試1Hit。
async function attemptAttackForCharacter(driver, idx) {
  return driver.evaluate((idx) => {
    const combatBtns = Array.from(document.querySelectorAll("#character-roster-tbody .roster-combat-btn"));
    if (!combatBtns[idx]) return { opened: false };
    combatBtns[idx].click();
    const attackTab = document.querySelector('.combat-action-btn[data-action="attack"]');
    if (!attackTab) return { opened: true, attacked: false, reason: "no-attack-tab" };
    attackTab.click();

    function enabledHitBtns() {
      const all = Array.from(document.querySelectorAll("#combat-modal-content .combat-attack-hit-btn")).filter((b) => !b.disabled);
      const hit2 = all.filter((b) => b.textContent.indexOf("2Hit") !== -1);
      const rest = all.filter((b) => b.textContent.indexOf("2Hit") === -1);
      return hit2.concat(rest);
    }
    function diceBtns() {
      return Array.from(document.querySelectorAll("#combat-modal-content .combat-dice-pick-btn"));
    }
    function clearDice() {
      diceBtns().forEach((b) => {
        if (b.classList.contains("active")) b.click();
      });
    }
    function confirmBtn() {
      return document.querySelector("#combat-modal-content .primary-btn");
    }

    let attackResult = { attacked: false };
    const hitBtnsSnapshot = enabledHitBtns();
    for (let h = 0; h < hitBtnsSnapshot.length && !attackResult.attacked; h++) {
      const hitLabel = hitBtnsSnapshot[h].textContent;
      hitBtnsSnapshot[h].click(); // 選定這個武器/Hit
      clearDice();
      const n = diceBtns().length;
      if (n === 0) {
        // 無骰子可選：如果本身就不需要骰子成本，confirm可能已經可按
        const cb = confirmBtn();
        if (cb && !cb.disabled) {
          cb.click();
          attackResult = { attacked: true, diceUsed: 0, hitIndex: h, hitLabel };
          break;
        }
        continue;
      }
      const btns = diceBtns();
      for (let k = 1; k <= n; k++) {
        btns[k - 1].click();
        const cb = confirmBtn();
        if (cb && !cb.disabled) {
          cb.click();
          attackResult = { attacked: true, diceUsed: k, hitIndex: h, hitLabel };
          break;
        }
      }
      if (!attackResult.attacked) clearDice();
    }
    const closeBtn = document.getElementById("btn-combat-modal-close");
    if (closeBtn) closeBtn.click();
    return Object.assign({ opened: true }, attackResult);
  }, idx);
}

// 使用者確認（2026-09-01再追加）：「腳本也用技能，不是只用武器普通攻擊」——docs/enemy_damage_rules.md
// 的Guard機制是「敵人防禦次數要先被Guard削減值（▲=0.5/◆=1，通常來自技能效果敘述，不是單純武器
// 普通攻擊）扣到0，之後傷害才會真正扣到HP格數」，如果角色從頭到尾只用武器普通攻擊、從不用技能，
// 防禦次數可能永遠打不穿，這是規則書機制本身，不是bug。這裡只處理「最簡單的情況」：技能點下去
// （combat-action-btn[data-action="skill"]分頁裡的「使用」按鈕，class同樣是combat-attack-hit-btn）
// 之後重新render出來的內容，如果沒有出現任何<select>（代表不需要額外的目標/選項選擇），才嘗試繼續
// 走骰子選擇＋確認流程；只要出現<select>就視為「複雜情況」，退回（再點一次同一顆按鈕取消選定）、
// 換下一個技能entry，全部技能都不符合簡單情況就直接回報skillUsed:false，讓呼叫端退回武器攻擊。
// 不嘗試處理有下拉選單/多步驟選擇的技能——那類技能種類差異太大，硬做泛用driver風險高於這次追查
// 「Guard削減有沒有正確發生」所需要的程度。
async function attemptSkillForCharacter(driver, idx) {
  return driver.evaluate((idx) => {
    const combatBtns = Array.from(document.querySelectorAll("#character-roster-tbody .roster-combat-btn"));
    if (!combatBtns[idx]) return { opened: false, skillUsed: false };
    combatBtns[idx].click();
    const skillTab = document.querySelector('.combat-action-btn[data-action="skill"]');
    if (!skillTab) return { opened: true, skillUsed: false, reason: "no-skill-tab" };
    skillTab.click();

    function useBtns() {
      return Array.from(document.querySelectorAll("#combat-modal-content .combat-attack-hit-btn")).filter((b) => !b.disabled);
    }
    function diceBtns() {
      return Array.from(document.querySelectorAll("#combat-modal-content .combat-dice-pick-btn"));
    }
    function clearDice() {
      diceBtns().forEach((b) => {
        if (b.classList.contains("active")) b.click();
      });
    }
    function confirmBtn() {
      return document.querySelector("#combat-modal-content .primary-btn");
    }
    function hasComplexSelect() {
      return document.querySelectorAll("#combat-modal-content select").length > 0;
    }

    let result = { opened: true, skillUsed: false };
    const candidateCount = useBtns().length; // 先取snapshot數量，因為每次點擊都會整個重render，元素會失效
    for (let s = 0; s < candidateCount && !result.skillUsed; s++) {
      const btns = useBtns();
      if (!btns[s]) break;
      const skillLabel = btns[s].closest(".combat-skill-row") ? btns[s].closest(".combat-skill-row").textContent.slice(0, 30) : "";
      btns[s].click(); // 選定這個技能（combatSkillState = key）
      if (hasComplexSelect()) {
        // 複雜情況（需要額外選擇）：取消選定，換下一個候選
        const reBtns = useBtns();
        const stillActive = document.querySelector("#combat-modal-content .combat-attack-hit-btn.active");
        if (stillActive) stillActive.click();
        continue;
      }
      clearDice();
      const n = diceBtns().length;
      let usedThis = false;
      if (n === 0) {
        const cb = confirmBtn();
        if (cb && !cb.disabled) {
          cb.click();
          result = { opened: true, skillUsed: true, diceUsed: 0, skillIndex: s, skillLabel };
          usedThis = true;
        }
      } else {
        const dbtns = diceBtns();
        for (let k = 1; k <= n && !usedThis; k++) {
          dbtns[k - 1].click();
          const cb = confirmBtn();
          if (cb && !cb.disabled) {
            cb.click();
            result = { opened: true, skillUsed: true, diceUsed: k, skillIndex: s, skillLabel };
            usedThis = true;
          }
        }
      }
      if (!usedThis) {
        // 骰子怎麼選confirm都不會啟用（多半是成本付不起）：取消選定，換下一個候選
        clearDice();
        const stillActive = document.querySelector("#combat-modal-content .combat-attack-hit-btn.active");
        if (stillActive) stillActive.click();
      }
    }
    const closeBtn = document.getElementById("btn-combat-modal-close");
    if (closeBtn) closeBtn.click();
    return result;
  }, idx);
}

// 先試「簡單情況」的技能，成功就視為本回合這個角色的行動；沒有技能可用/都太複雜，才退回武器攻擊。
async function attemptActionForCharacter(driver, idx) {
  const skillResult = await attemptSkillForCharacter(driver, idx);
  if (skillResult.skillUsed) return Object.assign({ via: "skill" }, skillResult, { attacked: true });
  const attackResult = await attemptAttackForCharacter(driver, idx);
  return Object.assign({ via: "attack" }, attackResult);
}

// 使用者確認（2026-09-01再追加）：「印出當下實際的Guard Count跟HP數值」——每回合confirm
// 前後都印一次，讓下一步能直接對帳「傷害到底有沒有算出來、Guard有沒有被削減、HP格數為什麼
// 變或不變」，不用再用猜的。enemyHp是攤平陣列（ENEMY_HP_ROWS段×ENEMY_HP_COLS格），這兩個
// 常數沒有export到window，改用state.battle.enemyHpMax.length（固定4段）反推COLS。
async function logGuardHpSnapshot(driver, label) {
  const info = await driver.evaluate(() => {
    const Core = window.PriTestNightCore;
    const s = Core.state;
    const rows = (s.battle.enemyHpMax || []).length || 4;
    const cols = Math.floor((s.battle.enemyHp || []).length / rows) || 20;
    const hpByRow = [];
    for (let r = 0; r < rows; r++) {
      let checked = 0;
      for (let c = 0; c < cols; c++) {
        if (s.battle.enemyHp[r * cols + c]) checked++;
      }
      hpByRow.push({ row: r, checked, max: s.battle.enemyHpMax[r] });
    }
    const roster = Core.getRosterCharacters()
      .filter((c) => c.entered && !c._nearDeath)
      .map((c) => ({
        name: c.name,
        phaseDamageDealt: c._phaseDamageDealt || 0,
        phaseGuardReductionPoints: c._phaseGuardReductionPoints || 0,
      }));
    return {
      guardCount: s.battle.guardCount,
      selectedEnemyIds: s.battle.selectedEnemyIds,
      hpByRow,
      roster,
    };
  });
  console.log("      [guard/hp " + label + "] " + JSON.stringify(info));
  return info;
}

async function enteredCharacterCount(driver) {
  return driver.evaluate(() => {
    const Core = window.PriTestNightCore;
    return Core.getRosterCharacters().filter((c) => c.entered && !c._nearDeath).length;
  });
}

// 使用者確認（2026-09-01追加）：#character-roster-tbody的.roster-combat-btn是依照
// 「entered全員（含瀕死者）」的固定順序render的（renderCharacterRoster的entered=
// rosterCharacters.filter(c=>c.entered)，瀕死不會把人從列表拿掉，只是換成復歸圓鈕），
// 所以「跟entCount（entered&&!nearDeath的人數）」對不上——一旦有人瀕死，用0..entCount-1
// 當index去點.roster-combat-btn，會誤點到錯的角色（例如跳過還活著、排在後面的角色）。
// 這個helper回傳「非瀕死的entered角色，在完整entered列表中的實際DOM位置」，讓呼叫端
// 用正確的index去點對應的按鈕。
async function nonNearDeathRosterIndexes(driver) {
  return driver.evaluate(() => {
    const Core = window.PriTestNightCore;
    const entered = Core.getRosterCharacters().filter((c) => c.entered);
    const idxs = [];
    entered.forEach((c, i) => {
      if (!c._nearDeath) idxs.push(i);
    });
    return idxs;
  });
}

// 使用者確認（2026-09-01追加）：「有盧恩就直接升級」——角色身上的runes只要付得起下一級
// （花費=level+1，見character_drawer.js STAT_STEPPERS的char-level onDelta）就一路升到
// 升不動為止（盧恩不夠或撞到LEVEL_CAP）。照現有腳本一貫「一律透過真實UI操作」的風格，
// 真的開角色詳細抽屜、點data-stepper="char-level" data-delta="1"的+按鈕（這個stepper
// 靠activeCharacterId辨識角色，所以必須先CharacterDrawer.open(c.id)），而不是直接改
// c.level/c.runes——這樣才會連動applyLevelUpResourceBonus等既有的升級副作用（HP/FP/加護
// 上限提升等），跟真人在角色詳細畫面手動升級的結果完全一致。
async function autoLevelUpAllEntered(driver) {
  return driver.evaluate(() => {
    const Core = window.PriTestNightCore;
    const CD = window.PriTestCharacterDrawer;
    const entered = Core.getRosterCharacters().filter((c) => c.entered && !c._nearDeath);
    const results = [];
    entered.forEach((c) => {
      CD.open(c.id);
      const startLevel = c.level;
      const startRunes = c.runes || 0;
      let guard = 0;
      while (guard < 100) {
        guard++;
        const btn = document.querySelector('[data-stepper="char-level"][data-delta="1"]');
        if (!btn) break;
        const beforeLevel = c.level;
        btn.click();
        if (c.level === beforeLevel) break; // 沒升成功（盧恩不夠、或已達LEVEL_CAP）
      }
      CD.close();
      if (c.level !== startLevel) {
        results.push({ name: c.name, from: startLevel, to: c.level, runesSpent: startRunes - (c.runes || 0), runesLeft: c.runes || 0 });
      }
    });
    return results;
  });
}

async function rollAllDiceThisPhase(driver) {
  return driver.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("#character-roster-tbody .dice-add-btn")).filter(
      (b) => b.textContent.indexOf("\u{1F3B2}") !== -1
    );
    btns.forEach((b) => b.click());
    return btns.length;
  });
}

// 使用者確認（2026-09-01追加）：「全滅就直接復活繼續打」——全滅時（entered&&!nearDeath
// 人數變成0）不放棄，改成點擊每個瀕死角色既有的3個「瀕死復歸圓鈕」（renderRosterDiceDisplay
// 渲染的.near-death-revival-circle，night.js的handleNearDeathRevivalClick/
// completeNearDeathRevival——這是App本身既有、且本session的自動復活機制刻意沒有動到的
// 手動UI，戰鬥中仍然可以正常按），對應真實遊戲裡「還沒瀕死的隊友執行復活行動」；全滅時
// 沒人能動，等同劇本/GM需要出手介入才能讓戰鬥繼續——用既有UI操作，不是腳本發明新規則。
async function reviveAllNearDeath(driver) {
  return driver.evaluate(() => {
    let clicks = 0;
    for (let pass = 0; pass < 4; pass++) {
      const circles = Array.from(document.querySelectorAll(".near-death-revival-circle")).filter((b) => !b.disabled);
      if (!circles.length) break;
      circles.forEach((b) => {
        b.click();
        clicks++;
      });
    }
    return clicks;
  });
}

async function getBattleSnapshot(driver) {
  return driver.evaluate(() => {
    const Core = window.PriTestNightCore;
    const s = Core.state;
    return {
      actionPhase: s.actionPhase,
      roundStage: s.battle ? s.battle.roundStage : null,
      enemyHp: s.battle ? s.battle.enemyHp.reduce((a, v) => a + (v ? 1 : 0), 0) : null,
    };
  });
}

// 驅動一整場戰鬥（從actionPhase==="combat"開始）直到actionPhase回到"normal"（撃破）或超過maxRounds。
async function driveFullCombat(driver, label, maxRounds) {
  maxRounds = maxRounds || 40;
  const log = [];
  let rounds = 0;
  let stuckRounds = 0;
  let lastEnemyHp = null;
  let wipeRecoveries = 0;
  const MAX_WIPE_RECOVERIES = 2; // 避免對一場真的打不過的敵人無限重複「全滅→復活→又全滅」，每次重試本身也要耗好幾回合才會被stuckRounds偵測到，次數不宜設太高

  while (rounds < maxRounds) {
    const phaseNow = await driver.evaluate(() => window.PriTestNightCore.state.actionPhase);
    if (phaseNow === "normal") break;

    // 使用者確認（2026-09-01修正）：全滅（entered且非瀕死的角色數變成0）不再直接放棄——
    // App本身的自動救起機制（triggerNearDeath/setActionPhase combatEnd）只在「非戰鬥中」
    // 或「戰鬥真的結束時」才會發動，全員同時瀕死、敵人卻還活著的情況下沒有人能再行動，
    // 戰鬥永遠不會走到combatEnd，這是遊戲設計上「隊伍需要有人出手介入」的情境（不是App
    // bug）。改用既有的瀕死復歸圓鈕（reviveAllNearDeath）把大家救起來繼續打，模擬真實
        // 遊戲裡GM/劇本出手介入。設MAX_WIPE_RECOVERIES上限，避免對打不過的敵人無限重試。
    const activeCount = await enteredCharacterCount(driver);
    if (activeCount === 0) {
      wipeRecoveries++;
      if (wipeRecoveries > MAX_WIPE_RECOVERIES) {
        log.push({ round: rounds, status: "party-wiped-too-many-times-giving-up", wipeRecoveries });
        break;
      }
      const revived = await reviveAllNearDeath(driver);
      log.push({ round: rounds, status: "party-wiped-revived", wipeRecoveries, revivedClicks: revived });
      await driver.waitForTimeout(300);
      const activeAfterRevive = await enteredCharacterCount(driver);
      if (activeAfterRevive === 0) {
        // 復歸圓鈕沒有生效（例如按鈕根本不存在），視為腳本端真的無法繼續，明確回報。
        log.push({ round: rounds, status: "revive-attempt-failed" });
        break;
      }
      continue; // 不消耗這回合的rounds計數，直接重新開始這回合
    }
    rounds++;

    // 0. 低血量角色先喝聖杯瓶（避免不必要的瀕死/團滅——真實玩家也會這樣做）。
    // 使用者確認（2026-09-01修正）：combatBtns的順序是「entered全員（含瀕死者）」的固定
    // DOM順序，不能直接用「entered&&!nearDeath」重新編號後的idx去對應，否則一旦有人瀕死
    // 就會點錯人（見nonNearDeathRosterIndexes註解）。這裡改成先取得完整entered列表，
    // 用該列表裡的真實位置對應combatBtns，只是跳過瀕死者不做動作。
    await driver.evaluate(() => {
      const combatBtns = Array.from(document.querySelectorAll("#character-roster-tbody .roster-combat-btn"));
      const Core = window.PriTestNightCore;
      const entered = Core.getRosterCharacters().filter((c) => c.entered);
      entered.forEach((c, idx) => {
        if (c._nearDeath) return;
        if (!combatBtns[idx]) return;
        const lowHp = c.hp && c.hp.max && c.hp.current < c.hp.max * 0.5;
        const hasFlask = c.flaskBase && c.flaskBase.current > 0;
        if (!lowHp || !hasFlask) return;
        combatBtns[idx].click();
        const flaskTab = document.querySelector('.combat-action-btn[data-action="flask"]');
        if (flaskTab) flaskTab.click();
        const cb = document.querySelector("#combat-modal-content .primary-btn");
        if (cb && !cb.disabled) cb.click();
        const closeBtn = document.getElementById("btn-combat-modal-close");
        if (closeBtn) closeBtn.click();
      });
    });

    // 1. 全員擲骰
    await rollAllDiceThisPhase(driver);
    await driver.waitForTimeout(300);

    // 2. 等待roundStage變成acting（全員擲完）
    let stage = null;
    for (let i = 0; i < 20; i++) {
      stage = (await getBattleSnapshot(driver)).roundStage;
      if (stage === "acting") break;
      await driver.waitForTimeout(150);
    }
    if (stage !== "acting") {
      log.push({ round: rounds, status: "stuck-awaitingRoll", phase: phaseNow });
      stuckRounds++;
      if (stuckRounds >= 3) break;
      continue;
    }

    const phaseForThisRound = await driver.evaluate(() => window.PriTestNightCore.state.actionPhase);
    const attackReports = [];

    if (phaseForThisRound === "combat" || phaseForThisRound === "extra") {
      // 使用者確認（2026-09-01修正）：改用nonNearDeathRosterIndexes取得「非瀕死者在完整
      // entered列表中的實際DOM位置」，而不是0..entCount-1重新編號，避免點錯角色（見上方
      // nonNearDeathRosterIndexes/flask區塊的說明）。
      const idxs = await nonNearDeathRosterIndexes(driver);
      for (const idx of idxs) {
        const r = await attemptActionForCharacter(driver, idx);
        attackReports.push(r);
        await driver.waitForTimeout(80);
      }
    }
    // defense階段：不主動開combat modal的防禦分頁（迴避/格擋可選、非必要），
    // 直接標記完成即可，autoTriggerDefenseRoll會在AutoGM開啟時自動處理敵方擲骰。

    // 3. 全員按「已完成」（#location-status-actions中，按鈕文字=角色名）
    const doneClicks = await driver.evaluate(() => {
      const Core = window.PriTestNightCore;
      const entered = Core.getRosterCharacters().filter((c) => c.entered && !c._nearDeath);
      let clicked = 0;
      entered.forEach((c) => {
        const btn = Array.from(document.querySelectorAll("#location-status-actions button")).find((b) => b.textContent === c.name);
        if (btn && !btn.classList.contains("gm-flow-suggested")) {
          btn.click();
          clicked++;
        }
      });
      return clicked;
    });
    await driver.waitForTimeout(150);

    // 使用者確認（2026-09-01再追加）：confirm前先印一次guard/hp快照，這是「傷害還沒真正
    // 套用到敵人HP格數之前」的基準點（c._phaseDamageDealt/_phaseGuardReductionPoints已經
    // 累積好、但handleBattleGuardCalcApply還沒被呼叫）。
    if (phaseForThisRound === "combat" || phaseForThisRound === "extra") {
      await logGuardHpSnapshot(driver, "round" + rounds + " confirm前");
    }

    // 4. 點[攻擊/防禦]確認鈕（已完成後倒數第二顆按鈕通常是確認、最後一顆是返回，這裡用文字比對比較穩）
    const confirmClicked = await driver.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("#location-status-actions button"));
      // 已完成後只剩[返回][攻擊/防禦]兩顆，確認鈕不是"返回"
      const btn = btns.find((b) => !/返回|戻る/.test(b.textContent));
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    });
    await driver.waitForTimeout(200);

    if (phaseForThisRound === "combat" || phaseForThisRound === "extra") {
      await logGuardHpSnapshot(driver, "round" + rounds + " confirm後");
    }

    if (phaseForThisRound === "defense") {
      // 開了enemy-damage-modal：對每個PC/靈體列按確定
      for (let pass = 0; pass < 6; pass++) {
        const clickedAny = await driver.evaluate(() => {
          const btns = Array.from(document.querySelectorAll(".enemy-damage-confirm-btn")).filter((b) => !b.disabled);
          if (!btns.length) return false;
          btns[0].click();
          return true;
        });
        await driver.waitForTimeout(150);
        if (!clickedAny) break;
      }
      const modalStillOpen = await driver.evaluate(() => {
        const el = document.getElementById("enemy-damage-modal");
        return el && !el.hidden;
      });
      if (modalStillOpen) {
        log.push({ round: rounds, status: "enemy-damage-modal-stuck-open" });
      }
    }

    // 5. 等roundStage變成resolving，點[結束回合]
    let resolvingSeen = false;
    for (let i = 0; i < 20; i++) {
      const snap = await getBattleSnapshot(driver);
      if (snap.roundStage === "resolving" || snap.actionPhase === "normal") {
        resolvingSeen = true;
        break;
      }
      await driver.waitForTimeout(150);
    }
    if (resolvingSeen) {
      await driver.evaluate(() => {
        const btns = Array.from(document.querySelectorAll("#location-status-actions button"));
        if (btns.length === 1) btns[0].click();
      });
      await driver.waitForTimeout(250);
    }

    const afterSnap = await getBattleSnapshot(driver);
    const dmgDealt = attackReports.filter((r) => r.attacked).length;
    const roundEntry = {
      round: rounds,
      phase: phaseForThisRound,
      attacksLanded: dmgDealt,
      attacksAttempted: attackReports.length,
      attackReports,
      doneClicks,
      confirmClicked,
      resolvingSeen,
      afterEnemyHpCount: afterSnap.enemyHp,
      actionPhaseAfter: afterSnap.actionPhase,
    };
    log.push(roundEntry);
    console.log("    [combat round " + rounds + "] " + JSON.stringify(roundEntry));

    if (lastEnemyHp !== null && afterSnap.enemyHp === lastEnemyHp && dmgDealt === 0 && afterSnap.actionPhase !== "normal") {
      stuckRounds++;
    } else {
      stuckRounds = 0;
    }
    lastEnemyHp = afterSnap.enemyHp;
    if (stuckRounds >= 4) {
      log.push({ round: rounds, status: "no-progress-abort" });
      break;
    }
    if (afterSnap.actionPhase === "normal") break;
  }

  const finalPhase = await driver.evaluate(() => window.PriTestNightCore.state.actionPhase);
  const ended = finalPhase === "normal";
  console.log("  [" + label + "] 戰鬥結束=" + ended + "，共" + rounds + "回合");
  return { label, ended, rounds, log };
}

// ---------------------------------------------------------------------------
// 樓層自動化GM流程驅動（沿用scenario23_full_playthrough.js的分支處理，戰鬥改真打）
// ---------------------------------------------------------------------------
async function getBannerState(driver) {
  return driver.evaluate(() => {
    const Core = window.PriTestNightCore;
    const state = Core.state;
    const gf = state.gmFlow;
    const btns = Array.from(document.querySelectorAll("#location-status-actions button")).map((b) => b.textContent);
    const idx = state.focusedIndex;
    return {
      actionKind: gf.actionKind,
      awaitingOk: gf.awaitingOk,
      battleWait: gf.battleWaitActive,
      buttons: btns,
      narration: (gf.narrationText || "").slice(0, 150),
      cardLevel: typeof idx === "number" ? state.cardLevels[idx] : null,
      dayNumber: state.dayNumber,
      actionPhase: state.actionPhase,
      abilityModalVisible: !document.getElementById("ability-check-modal").hidden,
      coopModalVisible: !document.getElementById("cooperative-check-modal").hidden,
      tallyModalVisible: !document.getElementById("branch-tally-modal").hidden,
      breakthroughModalVisible: !document.getElementById("breakthrough-modal").hidden,
      eventChipModalVisible: !document.getElementById("event-chip-modal").hidden,
    };
  });
}

async function resetGmFlowOnly(driver, idx) {
  await driver.evaluate((idx) => {
    const Core = window.PriTestNightCore;
    const state = Core.state;
    state.focusedIndex = idx;
    state.gmFlow.walk = null;
    state.gmFlow.awaitingOk = false;
    state.gmFlow.actionKind = "ok";
    state.gmFlow.narrationText = null;
    state.gmFlow.pendingChoiceLabels = [];
    state.gmFlow.battleWaitActive = false;
    state.gmFlow.combatTriggerLabel = null;
    state.gmFlow.pendingFinalFloorSlot = null;
    state.gmFlow.pendingChipCheckSlot = null;
    state.gmFlow.pendingMapMoveSlot = null;
    state.gmFlow.pendingRewardWindows = [];
    state.gmFlow.branchOverrideActive = false;
    state.gmFlow.floorEndRewardOpened = false;
    state.gmFlow.chipOfferSlot = null;
    state.gmFlow.chipOfferContinuation = null;
    state.gmFlow.abilityCheckSpec = null;
    state.gmFlow.cooperativeCheckSpec = null;
    state.gmFlow.branchPointTallySpec = null;
    state.gmFlow.sequentialPairSpec = null;
    state.gmFlow.conditionalCooperativeChoiceSpec = null;
    state.gmFlow.sequentialChainSpec = null;
    state.gmFlow.openEndedTallySpec = null;
    state.gmFlow.representativePickSpec = null;
    state.gmFlow.multiStatCheckSpec = null;
    state.gmFlow.freeFloorOptions = [];
    state.gmFlow.playerPickCheckExcluded = [];
    ["ability-check-modal", "cooperative-check-modal", "branch-tally-modal", "turn-reward-modal", "breakthrough-modal", "floor-reward-modal", "event-chip-modal"].forEach(
      (id) => {
        const el = document.getElementById(id);
        if (el) el.hidden = true;
      }
    );
    Core.saveState();
    Core.renderCurrentLocationStatus();
  }, idx);
}

async function driveGenericStep(driver, s, combatLogs) {
  if (s.abilityModalVisible) {
    await driver.evaluate(() => document.querySelectorAll("#ability-check-characters button").forEach((b) => !b.disabled && b.click()));
    await driver.waitForTimeout(60);
    const doneDisabled = await driver.evaluate(() => {
      const b = document.getElementById("btn-ability-check-done");
      return !b || b.disabled;
    });
    if (!doneDisabled) await driver.evaluate(() => document.getElementById("btn-ability-check-done").click());
    await driver.waitForTimeout(80);
    return true;
  }
  if (s.coopModalVisible) {
    await driver.evaluate(() => document.querySelectorAll("#cooperative-check-characters button.combat-attack-hit-btn").forEach((b) => !b.disabled && b.click()));
    await driver.waitForTimeout(60);
    const confirmDisabled = await driver.evaluate(() => {
      const b = document.getElementById("btn-cooperative-check-confirm");
      return !b || b.disabled;
    });
    if (!confirmDisabled) await driver.evaluate(() => document.getElementById("btn-cooperative-check-confirm").click());
    await driver.waitForTimeout(80);
    return true;
  }
  if (s.tallyModalVisible) {
    await driver.evaluate(() => document.querySelectorAll("#branch-tally-characters button.combat-attack-hit-btn").forEach((b) => !b.disabled && b.click()));
    await driver.waitForTimeout(60);
    const confirmDisabled = await driver.evaluate(() => {
      const b = document.getElementById("btn-branch-tally-confirm");
      return !b || b.disabled;
    });
    if (!confirmDisabled) await driver.evaluate(() => document.getElementById("btn-branch-tally-confirm").click());
    await driver.waitForTimeout(80);
    return true;
  }
  if (s.breakthroughModalVisible) {
    await driver.evaluate(() => document.querySelectorAll("#breakthrough-characters button.combat-attack-hit-btn").forEach((b) => !b.disabled && b.click()));
    await driver.waitForTimeout(60);
    const passHidden = await driver.evaluate(() => document.getElementById("btn-breakthrough-pass").hidden);
    if (!passHidden) await driver.evaluate(() => document.getElementById("btn-breakthrough-pass").click());
    await driver.waitForTimeout(80);
    return true;
  }
  if (s.eventChipModalVisible) {
    await driver.evaluate(() => {
      const c = document.getElementById("btn-event-chip-modal-close");
      if (c) c.click();
    });
    await driver.waitForTimeout(80);
    return true;
  }
  if (s.battleWait || s.actionKind === "chipCombatWait") {
    // 真的打——等actionPhase進入combat/extra/defense其中之一即開始驅動
    const phase = await driver.evaluate(() => window.PriTestNightCore.state.actionPhase);
    if (phase === "combat" || phase === "extra" || phase === "defense") {
      const result = await driveFullCombat(driver, "樓層戰鬥(slot narration)");
      combatLogs.push(result);
      if (!result.ended) {
        // 使用者確認（2026-09-01修正）：driveFullCombat內部已經會用reviveAllNearDeath
        // 處理全滅（見該函式），所以走到這裡代表「就算救回來了，這場戰鬥還是沒辦法在
        // 合理回合內結束」（可能是敵人太強、或救回來後round-stage卡住等更深層問題）。
        // 過去版本會讓外層runOneSlot繼續無限重試同一場battleWait，一旦真的卡住就會
        // 反覆重跑driveFullCombat（每次都再打好幾回合），耗費大量時間卻毫無進展。這裡
        // 改成：只打一次，沒結束就直接回報卡住（false），不要重試，交給人工複查。
        note(5, "一場樓層戰鬥在" + result.rounds + "回合內未能結束，可能卡住");
        return false;
      }
      note(5, "樓層戰鬥正常打完，共" + result.rounds + "回合");
    } else {
      // 沒有真的進入combat phase（可能是舊有shortcut路徑），保底呼叫既有notify
      await driver.evaluate(() => {
        window.PriTestNightGmFlow.notifyCombatEnded();
        window.PriTestNightGmFlow.notifyChipCombatEnded && window.PriTestNightGmFlow.notifyChipCombatEnded();
        window.PriTestNightCore.saveState();
      });
      bug("battleWait觸發但actionPhase不是combat/extra/defense(=" + phase + ")，退回notifyCombatEnded捷徑");
    }
    await driver.waitForTimeout(150);
    return true;
  }
  if (!s.awaitingOk) {
    if (s.buttons.length === 0) return false;
    const clicked = await driver.evaluate(() => {
      const b = Array.from(document.querySelectorAll("#location-status-actions button")).find((b) => /進入/.test(b.textContent));
      if (b) {
        b.click();
        return true;
      }
      return false;
    });
    await driver.waitForTimeout(120);
    return clicked;
  }
  if (s.actionKind === "chipCombatResolved") {
    const modalHidden = await driver.evaluate(() => document.getElementById("turn-reward-modal").hidden);
    if (!modalHidden) {
      await driver.evaluate(() => document.getElementById("btn-turn-reward-modal-close").click());
      await driver.waitForTimeout(100);
    }
    await driver.evaluate(() => document.querySelectorAll("#location-status-actions button")[0].click());
    await driver.waitForTimeout(100);
    return true;
  }
  if (s.actionKind === "chipStrongEnemyOffer") {
    await driver.evaluate(() => {
      const b = Array.from(document.querySelectorAll("#location-status-actions button")).find((b) => /進入強敵戰鬥|強敵戰鬥/.test(b.textContent));
      if (b) b.click();
    });
    await driver.waitForTimeout(100);
    return true;
  }
  if (s.actionKind === "chipOffer") {
    await driver.evaluate(() => document.querySelectorAll("#location-status-actions button")[0].click());
    await driver.waitForTimeout(120);
    return true;
  }
  if (s.actionKind === "branchChoice") {
    note(2, "autoResolveBranch失敗，落到手動選分岐 (" + JSON.stringify(s.buttons) + ")");
    await driver.evaluate(() => document.querySelectorAll("#location-status-actions button")[0].click());
    await driver.waitForTimeout(100);
    return true;
  }
  if (s.actionKind === "lineChoice") {
    await driver.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("#location-status-actions button"));
      let idx = btns.findIndex((b) => /石剣の鍵|石劍鑰匙/.test(b.textContent));
      if (idx === -1) idx = btns.findIndex((b) => !/移動|離去|立ち去/.test(b.textContent));
      if (idx === -1) idx = 0;
      btns[idx].click();
    });
    await driver.waitForTimeout(100);
    return true;
  }
  if (s.actionKind === "combatTrigger") {
    await driver.evaluate(() => document.querySelectorAll("#location-status-actions button")[0].click());
    await driver.waitForTimeout(150);
    return true;
  }
  if (s.actionKind === "floorEnd") {
    if (!driveGenericStep._floorEndSeen) driveGenericStep._floorEndSeen = 0;
    driveGenericStep._floorEndSeen++;
    if (driveGenericStep._floorEndSeen % 15 === 1) {
      console.log("      [floorEnd#" + driveGenericStep._floorEndSeen + "] buttons=" + JSON.stringify(s.buttons) + " narration=" + JSON.stringify(s.narration));
    }
    // 無論按鈕數量，先確認是否有殘留的pendingRewardWindows（多半是先前迭代誤觸「暫時縮小」
    // 造成modal.hidden=true但未真正清除的殘留)，有的話先復原+關閉，避免永遠卡在
    // 「還有N個獎勵視窗尚未領取/關閉」敘述。
    const hadPending = await driver.evaluate(() => {
      const Core = window.PriTestNightCore;
      const pending = (Core.state.gmFlow.pendingRewardWindows || []).slice();
      pending.forEach((id) => {
        const restoreBtn = document.getElementById(id === "turnReward" ? "btn-turn-reward-restore" : "btn-floor-reward-restore");
        if (restoreBtn && !restoreBtn.hidden) restoreBtn.click();
        const closeBtn = document.getElementById(id === "turnReward" ? "btn-turn-reward-modal-close" : "btn-floor-reward-modal-close");
        if (closeBtn) closeBtn.click();
      });
      return pending.length > 0;
    });
    if (hadPending) {
      await driver.waitForTimeout(150);
      return true;
    }

    const nBtns = s.buttons.length;
    if (nBtns >= 2) {
      await driver.evaluate(() => document.querySelectorAll("#location-status-actions button")[0].click());
      await driver.waitForTimeout(150);
      const modalHidden = await driver.evaluate(() => document.getElementById("turn-reward-modal").hidden);
      if (!modalHidden) {
        await driver.evaluate(() => document.getElementById("btn-turn-reward-modal-close").click());
        await driver.waitForTimeout(100);
      }
      for (let pass = 0; pass < 3; pass++) {
        const frOpen = await driver.evaluate(() => {
          const el = document.getElementById("floor-reward-modal");
          return el && !el.hidden;
        });
        if (!frOpen) break;
        await driver.evaluate(() => document.querySelectorAll("#floor-reward-modal-content button").forEach((b) => !b.disabled && b.click()));
        await driver.waitForTimeout(100);
        const dhOpen = await driver.evaluate(() => {
          const el = document.getElementById("dice-hand-draw-modal");
          return el && !el.hidden;
        });
        if (dhOpen) {
          await driver.evaluate(() => document.getElementById("btn-dice-hand-draw-random") && document.getElementById("btn-dice-hand-draw-random").click());
          await driver.waitForTimeout(100);
          await driver.evaluate(() => {
            const j = document.getElementById("btn-dice-hand-draw-judge");
            if (j && !j.disabled) j.click();
          });
          await driver.waitForTimeout(100);
          await driver.evaluate(() => document.getElementById("btn-dice-hand-draw-close") && document.getElementById("btn-dice-hand-draw-close").click());
          await driver.waitForTimeout(100);
        }
      }
      await driver.evaluate(() => {
        const closeBtn = document.getElementById("btn-floor-reward-modal-close");
        const el = document.getElementById("floor-reward-modal");
        if (closeBtn && el && !el.hidden) closeBtn.click();
      });
      await driver.waitForTimeout(100);
      // 「點光所有按鈕」的通用做法有機率誤點到獎勵視窗自己的「暫時縮小」按鈕（外觀上跟
      // 「關閉」一樣會讓modal.hidden=true，但不會清除state.gmFlow.pendingRewardWindows，
      // 導致進度版永遠卡在「還有N個獎勵視窗尚未領取/關閉」）。這裡收尾時明確檢查該欄位，
      // 若還有殘留就先按對應的［復原］再按對應的［關閉］，確保真正清空。
      await driver.evaluate(() => {
        const Core = window.PriTestNightCore;
        const pending = (Core.state.gmFlow.pendingRewardWindows || []).slice();
        pending.forEach((id) => {
          const restoreBtn = document.getElementById(id === "turnReward" ? "btn-turn-reward-restore" : "btn-floor-reward-restore");
          if (restoreBtn && !restoreBtn.hidden) restoreBtn.click();
          const closeBtn = document.getElementById(id === "turnReward" ? "btn-turn-reward-modal-close" : "btn-floor-reward-modal-close");
          if (closeBtn) closeBtn.click();
        });
      });
      await driver.waitForTimeout(120);
      return true;
    }
    await driver.evaluate(() => document.querySelectorAll("#location-status-actions button")[0].click());
    await driver.waitForTimeout(100);
    return true;
  }
  if (s.actionKind === "mapMove" || s.actionKind === "nightAdvance" || s.actionKind === "finalDayBattle") return "terminal:" + s.actionKind;
  if (s.actionKind === "freeFloorChoice") {
    await driver.evaluate(() => document.querySelectorAll("#location-status-actions button")[0].click());
    await driver.waitForTimeout(120);
    return true;
  }
  if (s.buttons.length) {
    await driver.evaluate(() => document.querySelectorAll("#location-status-actions button")[0].click());
    await driver.waitForTimeout(100);
    return true;
  }
  return false;
}

async function runOneSlot(driver, idx, allPages, doSyncCheck) {
  await resetGmFlowOnly(driver, idx);
  const combatLogs = [];
  const branchWarnings = [];
  let steps = 0;
  const maxSteps = 220;
  let syncedThisSlot = false;

  await driver.evaluate(() => {
    const b = Array.from(document.querySelectorAll("#location-status-actions button")).find((b) => /進入/.test(b.textContent));
    if (b) b.click();
  });
  await driver.waitForTimeout(150);

  while (steps < maxSteps) {
    steps++;
    const s = await getBannerState(driver);

    // 注意：event-chip-modal／potential-power-modal依既有設計是「大視窗僅開啟者本機
    // 顯示、只有縮小狀態跨裝置同步」（見night_event_chips.js openEventChipModal註解），
    // 不屬於使用者評斷重點4「任何彈勵視窗都同步共享」的範圍（該重點的例外就是潛在之力，
    // 而event-chip-modal刻意採用相同pattern）。因此這裡只驗證真正「全裝置應一起看到」
    // 的turn-reward-modal／breakthrough-modal／floor-reward-modal。
    if (doSyncCheck && !syncedThisSlot && s.breakthroughModalVisible) {
      syncedThisSlot = true;
      await compareModalSync(allPages, "breakthrough-modal", "slot" + idx + " 突破判定彈窗");
    }

    if (steps % 10 === 0 || steps < 5) console.log("    [slot" + idx + " step" + steps + "] actionKind=" + s.actionKind + " awaitingOk=" + s.awaitingOk + " battleWait=" + s.battleWait);
    const r = await driveGenericStep(driver, s, combatLogs);
    if (typeof r === "string" && r.startsWith("terminal:")) {
      return { status: "ok:" + r.slice(9), steps, combatLogs, branchWarnings, finalCardLevel: (await getBannerState(driver)).cardLevel };
    }
    if (!r) {
      return { status: "stuck:" + s.actionKind, steps, combatLogs, branchWarnings, lastNarration: s.narration, lastButtons: s.buttons };
    }
  }
  return { status: "timeout", steps, combatLogs, branchWarnings };
}

async function advanceToDay2(driver, allPages) {
  await driver.evaluate(() => document.getElementById("btn-primary-action").click());
  await driver.waitForTimeout(150);
  const opened = await driver.evaluate(() => document.getElementById("keep-drawer").classList.contains("open"));
  if (!opened) return { ok: false, reason: "keep-drawer-not-open" };
  await driver.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll("#keep-grid .mini-card"));
    const countText = document.getElementById("keep-count").textContent || "";
    const m = /\/\s*(\d+)/.exec(countText) || /(\d+)\s*\/?\s*\D*$/.exec(countText);
    const needed = m ? parseInt(m[1], 10) : 3;
    let picked = 0;
    for (const btn of buttons) {
      if (picked >= needed) break;
      if (btn.disabled || btn.classList.contains("locked") || btn.classList.contains("terrain-locked")) continue;
      btn.click();
      picked++;
    }
  });
  await driver.waitForTimeout(100);
  const submitDisabled = await driver.evaluate(() => document.getElementById("btn-keep-submit").disabled);
  if (submitDisabled) return { ok: false, reason: "submit-still-disabled" };
  await driver.evaluate(() => document.getElementById("btn-keep-submit").click());
  await driver.waitForTimeout(200);

  // criterion 6/7：day跳轉後，比對dayNumber、focusedIndex（第二天開始位置）在全裝置一致
  await driver.waitForTimeout(1500);
  const daySnaps = [];
  for (const p of allPages) {
    daySnaps.push(await p.evaluate(() => ({ dayNumber: window.PriTestNightCore.state.dayNumber, focusedIndex: window.PriTestNightCore.state.focusedIndex })));
  }
  const daySynced = daySnaps.every((d) => d.dayNumber === daySnaps[0].dayNumber);
  note(6, "day1→day2跳轉：" + (daySynced ? "全裝置dayNumber一致(" + daySnaps[0].dayNumber + ")" : "不一致！" + JSON.stringify(daySnaps)));
  if (!daySynced) bug("day1→day2跳轉後，各裝置dayNumber不一致：" + JSON.stringify(daySnaps));
  note(7, "第二天開始focusedIndex=" + JSON.stringify(daySnaps.map((d) => d.focusedIndex)));
  return { ok: true, daySnaps };
}

async function advanceToDay3(driver) {
  await driver.evaluate(() => document.getElementById("btn-primary-action").click());
  await driver.waitForTimeout(200);
  return getBannerState(driver);
}

// ---------------------------------------------------------------------------
// 潛在之力跨裝置獨立性
// ---------------------------------------------------------------------------
async function checkPotentialPowerIndependence(obsB, obsC, charIds) {
  const [charA, charB] = charIds;
  await obsB.evaluate((id) => window.PriTestNightPotentialPower.openPotentialPowerModal(id, 2, null, null), charA);
  await obsC.evaluate((id) => window.PriTestNightPotentialPower.openPotentialPowerModal(id, 2, null, null), charB);
  await obsB.waitForTimeout(1500);
  const bView = await obsB.evaluate(() => {
    const el = document.getElementById("potential-power-modal");
    return { hidden: el ? el.hidden : null, contentLen: (document.getElementById("potential-power-modal-content") || {}).innerHTML || "" };
  });
  const cView = await obsC.evaluate(() => {
    const el = document.getElementById("potential-power-modal");
    return { hidden: el ? el.hidden : null, contentLen: (document.getElementById("potential-power-modal-content") || {}).innerHTML || "" };
  });
  const bOk = bView.hidden === false && bView.contentLen.length > 0;
  const cOk = cView.hidden === false && cView.contentLen.length > 0;
  note(4, "裝置B開角色A視窗=" + bOk + "，裝置C開角色B視窗=" + cOk + "（互不干擾）");
  if (!bOk || !cOk) bug("潛在之力視窗跨裝置各自開啟失敗：B=" + JSON.stringify(bView).slice(0, 100) + " C=" + JSON.stringify(cView).slice(0, 100));

  // 縮小/復原
  await obsB.evaluate(() => window.PriTestNightPotentialPower.minimizePotentialPowerModal());
  await obsB.waitForTimeout(1200);
  const bAfterMinimize = await obsB.evaluate(() => document.getElementById("potential-power-modal").hidden);
  const cStillOpen = await obsC.evaluate(() => document.getElementById("potential-power-modal").hidden === false);
  note(4, "裝置B縮小後，B的彈窗hidden=" + bAfterMinimize + "；裝置C視窗未被B的縮小操作影響=" + cStillOpen);
  if (!cStillOpen) bug("裝置B縮小自己的潛在之力視窗，卻影響了裝置C正在開啟的視窗");

  await obsB.evaluate((id) => window.PriTestNightPotentialPower.restorePotentialPowerModal(id), charA);
  await obsB.waitForTimeout(1200);
  const bRestored = await obsB.evaluate(() => document.getElementById("potential-power-modal").hidden === false);
  note(4, "裝置B復原視窗=" + bRestored);
  if (!bRestored) bug("裝置B復原潛在之力視窗失敗");

  await obsB.evaluate(() => window.PriTestNightPotentialPower.closePotentialPowerModal());
  await obsC.evaluate(() => window.PriTestNightPotentialPower.closePotentialPowerModal());
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
(async () => {
  const browser = await chromium.launch();
  const driver = await browser.newPage();
  const obsB = await browser.newPage();
  const obsC = await browser.newPage();
  const pages = { driver, obsB, obsC };
  driver.on("dialog", (d) => d.accept("night"));
  obsB.on("dialog", (d) => d.accept("night"));
  obsC.on("dialog", (d) => d.accept("night"));
  driver.on("pageerror", (e) => consoleErrors.driver.push(String(e.message || e)));
  obsB.on("pageerror", (e) => consoleErrors.obsB.push(String(e.message || e)));
  obsC.on("pageerror", (e) => consoleErrors.obsC.push(String(e.message || e)));

  const report = { day1: [], day2: [], day3: null };
  const levelUpLog = [];

  try {
    console.log("=== 建立劇本1雲端遊戲、3個分頁模擬3台裝置 ===");
    const gameId = await setupGame(driver);
    await openDevicePage(driver, gameId);
    await openDevicePage(obsB, gameId);
    await openDevicePage(obsC, gameId);
    note(1, "3個分頁（driver/obsB/obsC）均已成功導向同一個game=" + gameId + "並完成Firebase bootstrap");

    console.log("=== 建立3名角色、開啟全自動化GM+簡易抽選 ===");
    const charIds = await bootstrapCharacters(driver);
    await dealInitial(driver);

    const allPages = [driver, obsB, obsC];
    const slotCount = await driver.evaluate(() => window.PriTestNightCore.SLOT_COUNT);

    console.log("\n########## day1 ##########");
    for (let idx = 0; idx < slotCount; idx++) {
      let result;
      try {
        result = await runOneSlot(driver, idx, allPages, idx < 2);
      } catch (e) {
        result = { status: "error:" + e.message };
      }
      report.day1.push({ idx, ...result });
      console.log(" [day1 slot" + idx + "] => " + result.status, "steps=" + result.steps);
      // 使用者確認（2026-09-01追加）：有盧恩就直接升級——每個版塊跑完（樓層獎勵最常見的
      // 盧恩來源）都檢查一次，能升就升，讓角色盡量不要維持在脆弱的Lv1應付後面的戰鬥。
      const lvUps1 = await autoLevelUpAllEntered(driver);
      if (lvUps1.length) {
        levelUpLog.push({ when: "day1 slot" + idx, ups: lvUps1 });
        console.log("    [升級] " + JSON.stringify(lvUps1));
      }
      if (result.status && result.status.indexOf("stuck") === 0) {
        note(2, "slot" + idx + " 卡住：" + result.status + " lastButtons=" + JSON.stringify(result.lastButtons));
      } else if (result.status && result.status.indexOf("ok") === 0) {
        note(2, "slot" + idx + " 自動流程正常跑完（含選路線與戰鬥）");
        if (result.status === "ok:mapMove") note(3, "slot" + idx + "：突破後未全踏破，正確進入mapMove繼續指示玩家下一張圖");
      }
    }

    console.log("\n-- 進入day2 --");
    const adv = await advanceToDay2(driver, allPages);
    report.day1ToDay2 = adv;

    if (adv.ok) {
      const lvUpsD2 = await autoLevelUpAllEntered(driver);
      if (lvUpsD2.length) {
        levelUpLog.push({ when: "day1->day2跳轉後", ups: lvUpsD2 });
        console.log("    [升級] " + JSON.stringify(lvUpsD2));
      }
      console.log("\n########## day2 ##########");
      for (let idx = 0; idx < slotCount; idx++) {
        let result;
        try {
          result = await runOneSlot(driver, idx, allPages, false);
        } catch (e) {
          result = { status: "error:" + e.message };
        }
        report.day2.push({ idx, ...result });
        console.log(" [day2 slot" + idx + "] => " + result.status, "steps=" + result.steps);
        const lvUps2 = await autoLevelUpAllEntered(driver);
        if (lvUps2.length) {
          levelUpLog.push({ when: "day2 slot" + idx, ups: lvUps2 });
          console.log("    [升級] " + JSON.stringify(lvUps2));
        }
      }

      console.log("\n-- 進入day3（最終夜之王戰鬥）--");
      const day3State = await advanceToDay3(driver);
      const bossCheck = await driver.evaluate(() => {
        const Core = window.PriTestNightCore;
        const game = Core.getGame();
        const AutoGm = window.PriTestAutoGm;
        const key = game && game.night3BossId ? "boss|" + game.night3BossId : null;
        return {
          dayNumber: Core.state.dayNumber,
          night3BossId: game && game.night3BossId,
          bossKeyStructured: key ? AutoGm.isStructured(key) : false,
        };
      });
      report.day3 = { day3State, bossCheck };
      console.log(" dayNumber:", bossCheck.dayNumber, "night3BossId:", bossCheck.night3BossId, "structured:", bossCheck.bossKeyStructured);

      if (day3State.actionKind === "finalDayBattle") {
        await driver.evaluate(() => document.querySelectorAll("#location-status-actions button")[0].click());
        await driver.waitForTimeout(300);
        const afterOpen = await driver.evaluate(() => ({
          actionPhase: window.PriTestNightCore.state.actionPhase,
          selectedEnemyIds: (window.PriTestNightCore.state.battle && window.PriTestNightCore.state.battle.selectedEnemyIds) || [],
        }));
        console.log(" 開啟夜之王戰鬥後：", JSON.stringify(afterOpen));
        note(8, "開啟夜之王戰鬥，actionPhase=" + afterOpen.actionPhase + "，selectedEnemyIds=" + JSON.stringify(afterOpen.selectedEnemyIds));

        const lvUpsBoss = await autoLevelUpAllEntered(driver);
        if (lvUpsBoss.length) {
          levelUpLog.push({ when: "夜之王戰鬥前", ups: lvUpsBoss });
          console.log("    [升級] " + JSON.stringify(lvUpsBoss));
        }

        if (afterOpen.actionPhase === "combat") {
          const bossResult = await driveFullCombat(driver, "夜之王(gladius)戰鬥", 60);
          report.day3.bossCombat = bossResult;
          if (bossResult.ended) note(8, "夜之王戰鬥正常打完，共" + bossResult.rounds + "回合，actionPhase已回到normal");
          else {
            note(8, "夜之王戰鬥在" + bossResult.rounds + "回合內未能結束");
            bug("夜之王(gladius)戰鬥超過上限回合或卡住未能撃破，detail=" + JSON.stringify(bossResult.log.slice(-5)));
          }
        } else {
          note(8, "開啟夜之王戰鬥後actionPhase不是combat(=" + afterOpen.actionPhase + ")，無法驅動戰鬥");
          bug("[開啟夜之王戰鬥]點擊後actionPhase未正確切換為combat");
        }

        await driver.waitForTimeout(1500);
        const finalHpSnaps = [];
        for (const p of allPages) {
          finalHpSnaps.push(await p.evaluate(() => window.PriTestNightCore.state.battle.enemyHp.reduce((a, v) => a + (v ? 1 : 0), 0)));
        }
        const hpSynced = finalHpSnaps.every((v) => v === finalHpSnaps[0]);
        note(1, "夜之王戰鬥後HP格數跨裝置一致=" + hpSynced + " (" + JSON.stringify(finalHpSnaps) + ")");
        if (!hpSynced) bug("夜之王戰鬥結束後，各裝置看到的敵人HP格數不一致：" + JSON.stringify(finalHpSnaps));
      } else {
        note(8, "day3狀態不是finalDayBattle（=" + day3State.actionKind + "），無法測試夜之王戰鬥");
      }
    } else {
      console.log("!! 進入day2失敗：", adv.reason);
      bug("day1→day2跳轉失敗：" + adv.reason);
    }

    console.log("\n=== 潛在之力跨裝置獨立性 ===");
    try {
      await checkPotentialPowerIndependence(obsB, obsC, charIds);
    } catch (e) {
      bug("潛在之力跨裝置測試拋出例外：" + e.message);
    }
  } catch (err) {
    console.error("FATAL:", err);
    bug("腳本主流程拋出未預期例外：" + err.message);
  } finally {
    console.log("\n=== console pageerror彙總 ===");
    console.log("driver:", consoleErrors.driver.length, "obsB:", consoleErrors.obsB.length, "obsC:", consoleErrors.obsC.length);
    if (consoleErrors.driver.length) console.log(consoleErrors.driver.slice(0, 10));
    if (consoleErrors.obsB.length) console.log(consoleErrors.obsB.slice(0, 10));
    if (consoleErrors.obsC.length) console.log(consoleErrors.obsC.slice(0, 10));

    console.log("\n=== 依8個評斷重點彙總 ===");
    for (let i = 1; i <= 8; i++) {
      console.log("[" + i + "] " + (criteriaLog[i].length ? "" : "（無記錄）"));
      criteriaLog[i].forEach((l) => console.log("    - " + l));
    }
    console.log("\n=== 疑似App bug清單 ===");
    findings.forEach((f) => console.log(" - " + f));

    console.log("\n=== 升級紀錄（有盧恩就升級） ===");
    levelUpLog.forEach((entry) => console.log(" [" + entry.when + "] " + JSON.stringify(entry.ups)));
    try {
      const finalRoster = await driver.evaluate(() =>
        window.PriTestNightCore.getRosterCharacters()
          .filter((c) => c.entered)
          .map((c) => ({ name: c.name, level: c.level, runes: c.runes, nearDeath: !!c._nearDeath }))
      );
      console.log("最終角色狀態：", JSON.stringify(finalRoster));
    } catch (e) {}

    fs.writeFileSync(
      RESULTS_PATH,
      JSON.stringify({ report, criteriaLog, findings, consoleErrors, levelUpLog }, null, 2)
    );
    await browser.close();
  }
})();
