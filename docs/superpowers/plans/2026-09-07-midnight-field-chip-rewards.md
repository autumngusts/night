# Midnight 板塊樓層／獎勵清單／籌碼事件 大改版 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the 9-item midnight.js (即時制擴張版) optimization spec: pipeline timing/late-join/late-claim, scenario-linked branch selection, reward-list overhaul (perPerson routing, potential power, weapon-skill-reroll forge, GM-judgment auto-resolve, bargain deals), sorcerer-tower rework (6 puzzle types + 12-dice reward), church/merchant/strong-enemy tweaks, and full 10-branch random-event automation.

**Architecture:** All state/RTDB wiring stays inside `static_src/midnight.js` (the existing single-closure module holding `characters`/`fieldTriggers`/`meta`/etc.). Two new sibling files hold **pure functions only** (no RTDB/DOM access), following the same pattern `night_gm_flow.js` etc. use for `night.js`: `midnight_puzzles.js` (6 puzzle generators + dice-hand judge) and `midnight_random_events.js` (branch/table resolution helpers). Both are loaded before `midnight.js` and export a `window.PriTestMidnight*` namespace that `midnight.js` calls into.

**Tech Stack:** Vanilla ES5, Firebase RTDB (`GameStorage.rtSet`/`rtTransaction`), no build framework, no test framework — verification is `node --check` for syntax plus ad-hoc Node assertion scripts for pure functions (deleted after use, not committed) plus manual/Playwright browser verification per `CLAUDE.md` §4.

## Global Constraints

- All commit messages, code comments (when added), and user-facing i18n text: Traditional Chinese by default (`CLAUDE.md` §1).
- Never invent numeric values for `■` placeholders; leave them as GM-facing text (`CLAUDE.md` §19).
- `□` placeholders must be resolved to real numbers via existing parsing helpers, never left as literal squares in computed values (`CLAUDE.md` §17).
- Every "until end of phase" style flag needs a corresponding reset path — midnight has no phase system, so any such flag introduced here must document its own lifecycle explicitly (see Task 15/25 bargain effects).
- Reuse existing pure functions instead of re-deriving rules (`CLAUDE.md` §41): `judgeDiceHand`, `parseBreakthroughCheckText`, `rollRandomEventTable`, `resolveNightBossTableRow`, `potentialPowerDrawWeapon`, `rerollWeaponSkill`, `upgradeWeaponRarity`, `scanLinesForEnemyMatches`/`maybeAssignFieldEnemy`, `fieldSeededIndex`.
- After any `static_src/*.js` or `site_src/*.py` change: run `python generate.py`, then `node --check static_src/<changed file>.js` for every touched JS file.
- Design spec of record: `docs/superpowers/specs/2026-09-07-midnight-field-chip-rewards-design.md` — every task below cites the spec section it implements. If code and spec disagree, spec wins; flag the conflict instead of guessing.

---

## File Structure

| File | Change |
|---|---|
| `static_src/midnight_puzzles.js` | **New.** Pure functions: 6 tower puzzle generators + `judgeDiceHand`-compatible dice-hand judge (re-exported, not re-implemented — see Task 16). |
| `static_src/midnight_random_events.js` | **New.** Pure functions: chest-table roll, "襲擊事件決定表" roll, insect/madness-zone step tables as data, bargain "取引抽選表" data + structured-effect parser. |
| `static_src/midnight.js` | Modified extensively — see tasks below. |
| `site_src/midnight_page.py` | New DOM: weapon-reroll modal, shared-pool reward markers, late-join/late-claim buttons, tower puzzle result panel, bargain-deal modal. |
| `static_src/style.css` | New classes for the above (yellow-note style already exists as `.toast`/warning text — reuse, confirm class name in Task 1). |
| `site_src/i18n_data_zh.py` / `_ja.py` / `_en.py` | New keys for every new user-facing string (zh required; ja/en added with best-effort translations, matching existing per-key three-file pattern). |
| `generate.py` | Add the two new JS files to the static copy list, before `midnight.js`. |

---

### Task 1: Shared reward-routing infrastructure (perPerson ledger + shared pool)

Implements design §1.5 and §3.2. This is the foundation every later reward task builds on — do this first.

**Files:**
- Modify: `static_src/midnight.js`

**Interfaces:**
- Produces: `isPerPersonRewardEntry(entry)`, `pushPerPlayerReward(pointId, entries)`, `claimLatePerPlayerRewards(pointId)`, `pushSharedReward(pointId, entry)`, `claimSharedReward(pointId, rewardId)`, `renderSharedRewardList(pointId, containerEl)`.

- [ ] **Step 1: Add `isPerPersonRewardEntry` and locate insertion point**

Find `maybeGrantFieldTileReward` in `static_src/midnight.js` (currently ~line 5583) and add just above it:

```js
// perPerson判斷（設計文件§1.5）：讀資料本體旗標，未標記或true都視為每人各自一份，
// 只有明確false才是固定共享（先搶先贏）——不依kind寫死，同一個kind不同板塊可能標記不同。
function isPerPersonRewardEntry(entry) {
  return entry.perPerson !== false;
}
```

- [ ] **Step 2: Verify with a throwaway Node check (not committed)**

Create `scratch_check.js` in the repo root (temporary, delete after):
```js
function isPerPersonRewardEntry(entry) { return entry.perPerson !== false; }
console.assert(isPerPersonRewardEntry({ kind: "rune" }) === true, "unmarked=true");
console.assert(isPerPersonRewardEntry({ kind: "rune", perPerson: true }) === true, "explicit true");
console.assert(isPerPersonRewardEntry({ kind: "smithingStone", perPerson: false }) === false, "explicit false");
console.log("OK");
```
Run: `node scratch_check.js` — expect `OK` printed with no assertion errors. Delete `scratch_check.js` afterward.

- [ ] **Step 3: Add the perPlayerRewards ledger push/claim functions**

Add directly below `isPerPersonRewardEntry`:

```js
// 落後獎勵ledger（設計文件§1.5）：每次對trig.participants發放perPerson獎勵時，額外記一份
// 到 fieldProgress/{pointId}/perPlayerRewards/{seq}，供之後才加入、原本不在participants裡
// 的玩家後補領取。固定共享(perPerson:false)的獎勵不進這裡，見pushSharedReward()。
function pushPerPlayerReward(pointId, entries) {
  var perPersonEntries = entries.filter(isPerPersonRewardEntry);
  if (!perPersonEntries.length) return;
  var seq = "pr" + Date.now() + Math.floor(Math.random() * 100000);
  GameStorage.rtSet(gameId, "cloud", "fieldProgress/" + pointId + "/perPlayerRewards/" + seq, {
    entries: perPersonEntries,
    grantedAt: Date.now(),
  });
}

// 後補領獎（設計文件§1.5）：後加入者按下[領取獎勵]、等待FIELD_LATE_JOIN_WAIT_MS後呼叫。
// 只把「目前fieldProgress記錄的perPlayerRewards」中，這個玩家(myTokenId)尚未領過的entries
// 一次授予，並標記claimedBy防止重複。範圍明確排除祝福/商人（那兩種沒有fieldProgress，
// 呼叫端本來就不會替它們顯示這個按鈕，見Task 8）。
function claimLatePerPlayerRewards(pointId) {
  GameStorage.rtTransaction(gameId, "cloud", "fieldProgress/" + pointId + "/claimedBy/" + myTokenId, function (cur) {
    return cur ? cur : true;
  }).then(function (committed) {
    if (committed !== true) return; // 已經領過（不可能發生，transaction本身已保證，防禦性判斷）
    var progress = fieldProgress[pointId] || {};
    var ledger = progress.perPlayerRewards || {};
    var c = characters[myTokenId];
    if (!c) return;
    var labels = [];
    Object.keys(ledger).forEach(function (seq) {
      (ledger[seq].entries || []).forEach(function (entry) {
        var label = grantLootRewardEntryToCharacter(c, entry);
        if (label) labels.push(label);
      });
    });
    if (labels.length) {
      c._lastTileRewardNote = { text: window.I18N.t("midnight_reward_toast_prefix") + labels.join("、"), at: Date.now() };
    }
    GameStorage.rtSet(gameId, "cloud", "character/" + myTokenId, c);
  });
}
```

- [ ] **Step 4: Add the shared-pool (perPerson:false) push/claim functions**

```js
// 固定共享池（設計文件§3.2）：perPerson:false的獎勵走這裡，全部participants看到同一份，
// 任一人按領取用transaction鎖定resolvedBy，first-writer-wins（同既有tileRewardGrantedBy
// 手法）。
function pushSharedReward(pointId, entry) {
  var rewardId = "srw" + Date.now() + Math.floor(Math.random() * 100000);
  var withFlag = {};
  for (var k in entry) withFlag[k] = entry[k];
  withFlag.resolved = false;
  GameStorage.rtSet(gameId, "cloud", "fieldTrigger/" + pointId + "/sharedRewards/" + rewardId, withFlag);
}

function claimSharedReward(pointId, rewardId) {
  GameStorage.rtTransaction(gameId, "cloud", "fieldTrigger/" + pointId + "/sharedRewards/" + rewardId + "/resolvedBy", function (cur) {
    return cur ? cur : myTokenId;
  }).then(function (committed) {
    if (committed !== myTokenId) return; // 被別人搶先領走
    var trig = fieldTriggers[pointId];
    var entry = trig && trig.sharedRewards && trig.sharedRewards[rewardId];
    var c = characters[myTokenId];
    if (!entry || !c) return;
    var label = grantLootRewardEntryToCharacter(c, entry);
    if (label) {
      c._lastTileRewardNote = { text: window.I18N.t("midnight_reward_toast_prefix") + label, at: Date.now() };
    }
    GameStorage.rtSet(gameId, "cloud", "character/" + myTokenId, c);
  });
}
```

- [ ] **Step 5: Route new reward kinds through `grantLootRewardEntryToCharacter`**

`grantLootRewardEntryToCharacter` (currently ~line 5508) is missing branches for `stoneswordKey` and `smithingStone` (per the design §3.4, both kinds now flow through this same function regardless of which path — ledger or shared pool — called it). Add before the final `return null;`:

```js
if (entry.kind === "stoneswordKey" || entry.kind === "smithingStone") {
  var itemId = entry.kind === "stoneswordKey" ? "item_stonesword_key" : "item_smithing_stone";
  var value = entry.value || 1;
  c.consumables = c.consumables || [];
  var existing = c.consumables.filter(function (inst) { return inst.itemId === itemId; })[0];
  if (existing) {
    existing.usesRemaining = (existing.usesRemaining || 0) + value;
  } else {
    var instId = CD.makeConsumableInstanceId(itemId, c);
    c.consumables.push({ id: instId, itemId: itemId, usesRemaining: value });
  }
  var itemData = window.PriTestConsumables.get(itemId);
  return itemData ? window.PriTestConsumables.localizedText(itemData.name) : itemId;
}
```

- [ ] **Step 6: `node --check`**

Run: `node --check static_src/midnight.js` — expect no output (success).

- [ ] **Step 7: Commit**

```bash
git add static_src/midnight.js
git commit -m "feat(midnight): 新增perPerson獎勵ledger與固定共享池基礎設施"
```

---

### Task 2: Inventory-full yellow warning (design §3.1)

**Files:**
- Modify: `static_src/midnight.js`
- Modify: `site_src/i18n_data_zh.py`, `site_src/i18n_data_ja.py`, `site_src/i18n_data_en.py`

**Interfaces:**
- Consumes: nothing new.
- Produces: `midnight_inventory_full_note` i18n key already exists (confirmed in use at `handleEnterFieldPointClick`'s evergaol guard and `handlePickupGroundItem`) — reuse it, do not add a duplicate key.

- [ ] **Step 1: Show the note instead of silently skipping in `grantTileLootToParticipants`**

Locate `grantTileLootToParticipants` (~line 5564). It currently does `if (!labels.length) return;` after looping `lootEntries`. Change the loop to also collect a full/skip flag:

```js
function grantTileLootToParticipants(trig, lootEntries) {
  Object.keys(trig.participants || {}).forEach(function (slot) {
    var p = players[slot];
    if (!p) return;
    var c = characters[p.tokenId];
    if (!c) return;
    var labels = [];
    var anyFull = false;
    lootEntries.forEach(function (entry) {
      var label = grantLootRewardEntryToCharacter(c, entry);
      if (label) labels.push(label);
      else if (entry.kind === "weapon" || entry.kind === "weaponStar" || entry.kind === "talisman" || entry.kind === "consumable") anyFull = true;
    });
    var text = labels.length ? window.I18N.t("midnight_reward_toast_prefix") + labels.join("、") : "";
    if (anyFull) text = text + (text ? "　" : "") + window.I18N.t("midnight_inventory_full_note");
    if (!text) return;
    c._lastTileRewardNote = { text: text, at: Date.now() };
    GameStorage.rtSet(gameId, "cloud", "character/" + p.tokenId, c);
  });
}
```

- [ ] **Step 2: Add the same full-check to the reward-modal "領取" handler**

Locate `confirmRewardEntry` (~line 5768). After `draft.apply(c);`, this already runs unconditionally — the "full" case for `pendingRewards`-style draws (`computeRewardDraw`) currently has no full-check at all (weapon/consumable/talisman draws there always succeed by construction, since `computeRewardDraw` doesn't check space). Add a guard before `draft.apply(c)`:

```js
function confirmRewardEntry(id, draft) {
  var c = characters[myTokenId];
  if (!c) return;
  var kind = pendingRewardKindForId(id); // helper added below
  if ((kind === "weapon" || kind === "consumable" || kind === "talisman") && !hasInventorySpace(c, kind === "weapon" ? "weapon" : kind)) {
    el("midnight-reward-full-note").textContent = window.I18N.t("midnight_inventory_full_note");
    el("midnight-reward-full-note").hidden = false;
    return;
  }
  draft.apply(c);
  ...
```

Add the small helper just above `confirmRewardEntry`:
```js
function pendingRewardKindForId(id) {
  var entry = (pendingRewards[myTokenId] || {})[id];
  return entry ? entry.kind : null;
}
```
(`pendingRewards` is the existing module-level variable already populated by `onPendingRewardsReceived` — confirm the exact variable name by grepping `pendingRewards\[` in `midnight.js` before wiring this up; use whatever the existing local variable is called.)

- [ ] **Step 3: Add `#midnight-reward-full-note` element**

In `site_src/midnight_page.py`, find the reward modal markup (search for `midnight-reward-detail` or `renderRewardDetail`-adjacent container) and add:
```html
<p id="midnight-reward-full-note" class="warning-text" hidden data-i18n="midnight_inventory_full_note"></p>
```
Confirm `.warning-text` (or whatever yellow-note class the codebase already uses — grep `style.css` for existing yellow/warning text classes such as `.toast`) is the right class; reuse it rather than inventing a new one.

- [ ] **Step 4: `python generate.py`, then manual browser check**

Run `python generate.py`, start `python -m http.server 8000 --directory dist`, create a test game via Admin, fill a character's weapon inventory to `WEAPON_SLOT_COUNT`, trigger a floor with a `weaponStar` reward, confirm the yellow note appears and the rest of the reward text (if any) still shows.

- [ ] **Step 5: Commit**

```bash
git add static_src/midnight.js site_src/midnight_page.py
git commit -m "feat(midnight): 背包已滿時顯示黃字提示取代靜默略過"
```

---

### Task 3: Pipeline timing constants + typewriter speed (design §1.1)

**Files:**
- Modify: `static_src/midnight.js`

- [ ] **Step 1: Update the constants block**

Find (currently ~line 297-300):
```js
var FIELD_TRIGGER_RADIUS = 1.6;
var FIELD_INVITE_RADIUS = FIELD_TRIGGER_RADIUS;
var FIELD_INVITE_TIME_LIMIT_MS = 3000;
var FIELD_ENTER_WAIT_MS = 500;
```
Replace with:
```js
var FIELD_TRIGGER_RADIUS = 1.6;
var FIELD_INVITE_RADIUS = FIELD_TRIGGER_RADIUS;
var FIELD_INVITE_TIME_LIMIT_MS = 10000; // 2026-09-07優化：3秒→10秒
var FIELD_ENTER_WAIT_MS = 1000; // 2026-09-07優化：0.5秒→1秒（一般板塊：A/2~10/K/籌碼）
var FIELD_ENTER_WAIT_MS_CASTLE = 5000; // 2026-09-07優化新增：僅J（堡壘）適用
var FIELD_LATE_JOIN_WAIT_MS = 2000; // 2026-09-07優化新增：中途加入/後補領獎的等待時間
```

- [ ] **Step 2: Use the castle-specific wait in `maybeStartFieldTypewriter`**

Find `maybeStartFieldTypewriter` (~line 4245):
```js
if (Date.now() < trig.enterAt + FIELD_ENTER_WAIT_MS) return;
```
Replace with:
```js
var waitMs = pt.card === "J" ? FIELD_ENTER_WAIT_MS_CASTLE : FIELD_ENTER_WAIT_MS;
if (Date.now() < trig.enterAt + waitMs) return;
```
Also change the `typewriteInto` call two lines below to slow the animation:
```js
window.PriTestNightGmFlow.typewriteInto(el("midnight-field-narrative-text"), text, {
  intervalMs: 56, // 2026-09-07優化：預設28ms的2倍＝變慢0.5倍
  onDone: function () {
    fieldTypewriterDoneFor[pt.id] = true;
  },
});
```

- [ ] **Step 3: `node --check` and commit**

```bash
node --check static_src/midnight.js
git add static_src/midnight.js
git commit -m "feat(midnight): 板塊邀請/進入等待時間與打字機速度調整"
```

---

### Task 4: Invite stage — joined-name list + "立即進入" (design §1.2)

**Files:**
- Modify: `static_src/midnight.js`
- Modify: `site_src/midnight_page.py`

- [ ] **Step 1: Add `handleForceEnterFieldClick`**

Add near `handleAcceptFieldInviteClick` (~line 4206):
```js
// 2026-09-07優化：已加入者可按「立即進入」跳過剩餘邀請時限。直接把inviteDeadline改成現在，
// 不新增狀態機分支——maybeAdvanceFieldInvite()既有的Date.now()>=inviteDeadline判斷會在下一輪
// updateNearbyFieldPoint()自然觸發。
function handleForceEnterFieldClick(pt) {
  var trig = fieldTriggers[pt.id];
  if (!trig || trig.status !== "inviting" || !trig.participants || !trig.participants[mySlot]) return;
  GameStorage.rtSet(gameId, "cloud", "fieldTrigger/" + pt.id + "/inviteDeadline", Date.now());
}
```

- [ ] **Step 2: Render the joined-name list + button**

Find `renderFieldVoteOrResult` (~line 6721). It currently only handles `status === "active"`/`"resolved"` rendering. Add an `inviting` branch at the top of the function:
```js
function renderFieldVoteOrResult(pt, trig) {
  var inviteBox = el("midnight-field-invite-status");
  if (trig.status === "inviting") {
    var names = Object.keys(trig.participants || {}).map(function (slot) {
      return players[slot] && players[slot].name;
    }).filter(Boolean);
    inviteBox.hidden = false;
    inviteBox.querySelector("[data-role=names]").textContent = names.join("、");
    var forceBtn = inviteBox.querySelector("[data-role=force-enter]");
    forceBtn.hidden = !(trig.participants && trig.participants[mySlot]);
    forceBtn.onclick = function () { handleForceEnterFieldClick(pt); };
    return;
  }
  inviteBox.hidden = true;
  // ...existing active/resolved rendering continues below unchanged...
```

- [ ] **Step 3: Add the DOM container**

In `site_src/midnight_page.py`, next to `#midnight-field-narrative-text` (search for that id), add:
```html
<div id="midnight-field-invite-status" hidden>
  <p data-i18n="midnight_field_invite_joined_label"></p>
  <p><span data-role="names"></span></p>
  <button type="button" data-role="force-enter" data-i18n="midnight_field_force_enter_button"></button>
</div>
```

- [ ] **Step 4: Add i18n keys**

Add to `site_src/i18n_data_zh.py` (and matching ja/en entries in the other two files — use direct translations, not copies of the zh string, per `CLAUDE.md` §6):
```python
"midnight_field_invite_joined_label": "已加入：",
"midnight_field_force_enter_button": "立即進入",
```

- [ ] **Step 5: `python generate.py`, manual verification with 2 browser tabs**

Create a cloud-mode game, join with 2 tabs, have tab A enter a field point, confirm tab B sees the invite prompt and can join, confirm tab A sees B's name appear in the joined list, confirm pressing "立即進入" moves the trigger to `active` well before 10s.

- [ ] **Step 6: Commit**

```bash
git add static_src/midnight.js site_src/midnight_page.py site_src/i18n_data_zh.py site_src/i18n_data_ja.py site_src/i18n_data_en.py
git commit -m "feat(midnight): 邀請階段顯示已加入名單並新增立即進入按鈕"
```

---

### Task 5: Vote stage — live tally + immediate resolve on all-voted (design §1.3)

**Files:**
- Modify: `static_src/midnight.js`
- Modify: `site_src/midnight_page.py`

- [ ] **Step 1: Change `maybeResolveFieldVote`'s waiting branch**

Find (~line 4295-4307):
```js
      if (allVoted) {
        var first = votes[participants[0]];
        var consensus = participants.every(function (slot) {
          return votes[slot] === first;
        });
        if (consensus) choiceIndex = first;
        else if (timedOut) choiceIndex = pickFallbackChoice(votes, participants, labels.length, pt);
        else return; // 全員都投了但還沒有共識，且還沒逾時，繼續等待
      } else if (timedOut) {
```
Replace the `allVoted` branch:
```js
      if (allVoted) {
        var first = votes[participants[0]];
        var consensus = participants.every(function (slot) {
          return votes[slot] === first;
        });
        // 2026-09-07優化：全員投完就立即判定，不再等timedOut——一致用該值，不一致立即多數決。
        choiceIndex = consensus ? first : pickFallbackChoice(votes, participants, labels.length, pt);
      } else if (timedOut) {
```

- [ ] **Step 2: Add live tally rendering**

In the same function (or `renderFieldVoteOrResult`, whichever currently draws the vote UI — locate the existing vote-option rendering block, likely inside `renderFieldVoteOrResult`'s `active`+has-labels branch), add a per-option count next to each label:
```js
labels.forEach(function (label, idx) {
  var count = Object.keys(trig.votes || {}).filter(function (slot) {
    return trig.votes[slot] === idx;
  }).length;
  // append " (N票)" or similar to the existing option button/label text — wire into
  // whatever existing per-option DOM element the current code already creates.
});
```
(Locate the exact existing per-option element creation code in `renderFieldVoteOrResult` before writing this — the design intentionally doesn't prescribe new DOM ids here since the vote options are already dynamically rendered; add the count as a `<span>` appended to each existing option row.)

- [ ] **Step 3: `python generate.py`, manual 2-3 tab verification**

Reach a floor with a "(→XXX)" choice (e.g. `card_2` some branch — check via `PriTestFields.get("card_2")` in console for a branch whose floor text contains "→"), have all participants vote, confirm resolution happens immediately once the last vote lands (no waiting for the 10s timer) both when votes agree and when they disagree.

- [ ] **Step 4: Commit**

```bash
git add static_src/midnight.js site_src/midnight_page.py
git commit -m "feat(midnight): 投票即時票數顯示與全員投完立即判定"
```

---

### Task 6: Mid-join ("參加探索") (design §1.4)

**Files:**
- Modify: `static_src/midnight.js`
- Modify: `site_src/midnight_page.py`

**Interfaces:**
- Consumes: `FIELD_LATE_JOIN_WAIT_MS` (Task 3).

- [ ] **Step 1: Detect the mid-join case in `updateNearbyFieldPoint`**

Find (~line 3980-4003). After the existing `if (found) { maybeAdvanceFieldInvite(found); ... }` block, add:
```js
    nearbyLateJoinPoint = null;
    if (found) {
      var trig0 = fieldTriggers[found.id];
      if (trig0 && (!trig0.participants || !trig0.participants[mySlot])) {
        nearbyLateJoinPoint = found;
      }
    }
```
Declare `nearbyLateJoinPoint` alongside the other `nearby*` module-level variables near the top of the file (find where `nearbyFieldPoint` is declared, e.g. `var nearbyFieldPoint = null;`, and add `var nearbyLateJoinPoint = null;` next to it).

- [ ] **Step 2: Add the click handler and 2s timer**

Add near `handleEnterFieldPointClick`:
```js
var lateJoinTimer = null;
function handleLateJoinFieldClick(pt) {
  if (!mySlot || isPaused() || lateJoinTimer) return;
  el("midnight-field-late-join-loading").hidden = false;
  lateJoinTimer = setTimeout(function () {
    lateJoinTimer = null;
    el("midnight-field-late-join-loading").hidden = true;
    GameStorage.rtSet(gameId, "cloud", "fieldTrigger/" + pt.id + "/participants/" + mySlot, true);
  }, FIELD_LATE_JOIN_WAIT_MS);
}
```

- [ ] **Step 3: Render the button**

In `renderFieldOverlay()` (~line 6615), add rendering for `nearbyLateJoinPoint` alongside the existing `nearbyFieldPoint` prompt logic:
```js
var lateJoinBtn = el("midnight-field-late-join-prompt");
lateJoinBtn.hidden = !nearbyLateJoinPoint;
if (nearbyLateJoinPoint) {
  lateJoinBtn.onclick = function () { handleLateJoinFieldClick(nearbyLateJoinPoint); };
}
```

- [ ] **Step 4: Add DOM**

In `site_src/midnight_page.py`:
```html
<button type="button" id="midnight-field-late-join-prompt" hidden data-i18n="midnight_field_late_join_button"></button>
<div id="midnight-field-late-join-loading" hidden data-i18n="midnight_field_late_join_loading_note"></div>
```

- [ ] **Step 5: i18n keys** (zh/ja/en, all three files)

```python
"midnight_field_late_join_button": "參加探索",
"midnight_field_late_join_loading_note": "準備會合中…",
```

- [ ] **Step 6: Manual verification**

3 tabs: A enters a multi-participant vote floor, B and C join within the invite window, resolve the vote, then have a 4th tab (or a tab that stayed away) approach mid-combat and confirm "參加探索" appears, and after 2s the tab is added to `participants` and sees the in-progress combat immediately (no re-triggered typewriter/vote).

Separately: have a tab approach a point still in `active`+voting (not yet resolved), press "參加探索", confirm after 2s it becomes a vote participant and its vote counts in Task 5's tally.

- [ ] **Step 7: Commit**

```bash
git add static_src/midnight.js site_src/midnight_page.py site_src/i18n_data_zh.py site_src/i18n_data_ja.py site_src/i18n_data_en.py
git commit -m "feat(midnight): 新增板塊事件中途加入機制"
```

---

### Task 7: Late-claim ("領取獎勵") for one-time-cleared content (design §1.5)

**Files:**
- Modify: `static_src/midnight.js`
- Modify: `site_src/midnight_page.py`

**Interfaces:**
- Consumes: `claimLatePerPlayerRewards` (Task 1), `FIELD_LATE_JOIN_WAIT_MS` (Task 3).

- [ ] **Step 1: Detect "never participated, but already has progress" in `updateNearbyFieldPoint`**

Extend the same block from Task 6 Step 1:
```js
    nearbyLateClaimPoint = null;
    if (found) {
      var progress0 = fieldProgress[found.id];
      var trigForClaim = fieldTriggers[found.id];
      var alreadyClaimed = progress0 && progress0.claimedBy && progress0.claimedBy[myTokenId];
      var neverJoined = !(trigForClaim && trigForClaim.participants && trigForClaim.participants[mySlot]);
      if (progress0 && neverJoined && !alreadyClaimed) {
        nearbyLateClaimPoint = found;
      }
    }
```
Declare `var nearbyLateClaimPoint = null;` alongside `nearbyLateJoinPoint`.

**Note:** this only fires for points that have `fieldProgress` (board floors) — strong-enemy/random-event/Day1-2 night-strong-enemy/Day3-boss points don't use `fieldProgress`, so Task 21/22/25 (which also grant rewards via `pushPerPlayerReward`) need their own equivalent detection using `fieldTrigger`'s own `resolvedAt`+HP-zero as the "already cleared" signal. Add a second check alongside the one above:
```js
    map.points.forEach(function (pt2) {
      if (nearbyLateClaimPoint) return;
      if (pt2.type !== "strong_enemy" && pt2.type !== "random_event") return;
      var dist2 = Math.hypot(localPos.x - (pt2.x + 0.5), localPos.y - (pt2.y + 0.5));
      if (dist2 > FIELD_TRIGGER_RADIUS) return;
      var trig2 = fieldTriggers[pt2.id];
      if (!trig2 || trig2.status !== "resolved") return;
      var hp2 = fieldEnemyHp[pt2.id];
      var cleared2 = trig2.enemyFamilyId ? (hp2 !== undefined && hp2 <= 0) : !!trig2.scarabResolved; // scarab has no HP
      var claimed2 = trig2.claimedBy && trig2.claimedBy[myTokenId];
      var joined2 = trig2.participants && trig2.participants[mySlot];
      if (cleared2 && !claimed2 && !joined2) nearbyLateClaimPoint = pt2;
    });
```
(`trig2.claimedBy` here lives under `fieldTrigger/{id}/claimedBy`, distinct from `fieldProgress/{id}/claimedBy` used for board floors — Step 2 below dispatches to the right ledger location based on which kind of point it is.)

- [ ] **Step 2: Click handler dispatches to the right ledger**

```js
var lateClaimTimer = null;
function handleLateClaimClick(pt) {
  if (!mySlot || isPaused() || lateClaimTimer) return;
  el("midnight-field-late-claim-loading").hidden = false;
  lateClaimTimer = setTimeout(function () {
    lateClaimTimer = null;
    el("midnight-field-late-claim-loading").hidden = true;
    if (fieldProgress[pt.id]) {
      claimLatePerPlayerRewards(pt.id);
    } else {
      claimLateFieldTriggerRewards(pt.id);
    }
  }, FIELD_LATE_JOIN_WAIT_MS);
}

// 對strong_enemy/random_event等沒有fieldProgress的一次性內容，ledger改存在
// fieldTrigger/{id}/perPlayerRewards（跟fieldProgress版同一種{seq:{entries,grantedAt}}
// 結構），claimedBy也存在fieldTrigger底下——Task 21/25會把撃破獎勵寫進這裡而不是
// fieldProgress。
function claimLateFieldTriggerRewards(pointId) {
  GameStorage.rtTransaction(gameId, "cloud", "fieldTrigger/" + pointId + "/claimedBy/" + myTokenId, function (cur) {
    return cur ? cur : true;
  }).then(function (committed) {
    if (committed !== true) return;
    var trig = fieldTriggers[pointId] || {};
    var ledger = trig.perPlayerRewards || {};
    var c = characters[myTokenId];
    if (!c) return;
    var labels = [];
    Object.keys(ledger).forEach(function (seq) {
      (ledger[seq].entries || []).forEach(function (entry) {
        var label = grantLootRewardEntryToCharacter(c, entry);
        if (label) labels.push(label);
      });
    });
    if (labels.length) {
      c._lastTileRewardNote = { text: window.I18N.t("midnight_reward_toast_prefix") + labels.join("、"), at: Date.now() };
    }
    GameStorage.rtSet(gameId, "cloud", "character/" + myTokenId, c);
  });
}
```

- [ ] **Step 3: Render button, DOM, i18n**

Same pattern as Task 6 Step 3-5, using ids `midnight-field-late-claim-prompt` / `midnight-field-late-claim-loading` and keys `midnight_field_late_claim_button` (label: "領取獎勵") / reuse `midnight_field_late_join_loading_note`.

- [ ] **Step 4: Confirm blessing/merchant are excluded**

`nearbyLateClaimPoint`'s point-type loop in Step 1 only checks `strong_enemy`/`random_event`, and the board-floor check only fires when `fieldProgress[id]` exists — `blessing`/`merchant` points never create `fieldProgress` or match those two types, so no extra guard is needed. Verify by reading `updateNearbyChipPoint()` (~line 4476) to confirm blessing/merchant handling is untouched by this task — it is a separate function.

- [ ] **Step 5: Manual verification**

Fully clear a board-floor card and a strong-enemy point with 2 of 3 players; bring the 3rd player (who never joined either) to each in turn, confirm "領取獎勵" appears, confirm after claiming the button disappears and doesn't reappear on revisit; confirm approaching a blessing/merchant point never shows this button.

- [ ] **Step 6: Commit**

```bash
git add static_src/midnight.js site_src/midnight_page.py site_src/i18n_data_zh.py site_src/i18n_data_ja.py site_src/i18n_data_en.py
git commit -m "feat(midnight): 新增一次性內容的後補領獎機制，排除可重複使用籌碼"
```

---

### Task 8: Scenario-linked branch selection (design §2)

**Files:**
- Modify: `static_src/midnight.js`

**Interfaces:**
- Consumes: `window.PriTestScenarios` (`.list()`, `.numberForId()`), `window.PriTestFields` (`.get()`).
- Produces: `scenarioVariantCandidatesForCard(scenarioId, card)`, `matchBranchIndexByName(branches, nameHintZh)`, modifies `pickFieldBranchIndex`.

- [ ] **Step 1: Write a throwaway verification script first (pure logic, no RTDB)**

Create `scratch_scenario_check.js` at repo root:
```js
// Minimal repro of the matching logic against real data shape, run with plain node
// (no DOM/window needed for this part — just string comparison logic).
function matchBranchIndexByName(branches, nameHintZh) {
  for (var i = 0; i < branches.length; i++) {
    if (branches[i].name && branches[i].name.zh === nameHintZh) return i;
  }
  return null;
}
var branches = [{ name: { zh: "大教會（1）" } }, { name: { zh: "大教會（聖）" } }];
console.assert(matchBranchIndexByName(branches, "大教會（聖）") === 1, "exact match finds index 1");
console.assert(matchBranchIndexByName(branches, "大教會（無印）") === null, "no match returns null");
console.log("OK");
```
Run: `node scratch_scenario_check.js` — expect `OK`. Delete the file after.

- [ ] **Step 2: Implement `scenarioVariantCandidatesForCard` and `matchBranchIndexByName`**

Add just above `pickFieldBranchIndex` (~line 3923):
```js
// 劇本連動分歧（設計文件§2.1-2.2）：用卡牌本名比對，不用rank——同一個rank在不同劇本可能
// 對應完全不同板塊類型（例：劇本1 day2 pos5是rank"J"但name是"砦（隨機）"，"J"在基礎地圖
// 固定代表堡壘）。全程只比對.zh欄位，不經localizedText()（遊戲邏輯不該受玩家個人UI語言影響）。
function scenarioVariantCandidatesForCard(scenarioId, card) {
  var Scenarios = window.PriTestScenarios;
  if (!Scenarios) return [];
  var scenario = Scenarios.list().filter(function (s) { return s.id === scenarioId; })[0];
  if (!scenario) return [];
  var data = fieldCardData(card);
  var baseName = data ? data.name.zh : "";
  if (!baseName) return [];
  var out = [];
  ["day1", "day2"].forEach(function (dayKey) {
    (scenario[dayKey] || []).forEach(function (slot) {
      if (slot.name && slot.name.zh && slot.name.zh.indexOf(baseName) === 0) out.push(slot);
    });
  });
  return out;
}

function matchBranchIndexByName(branches, nameHintZh) {
  for (var i = 0; i < branches.length; i++) {
    if (branches[i].name && branches[i].name.zh === nameHintZh) return i;
  }
  return null;
}
```

- [ ] **Step 3: Rewire `pickFieldBranchIndex`**

Find (~line 3923-3926):
```js
function pickFieldBranchIndex(pt) {
  var branches = fieldCardBranches(pt.card);
  return branches.length ? fieldSeededIndex(pt.id + ":branch", branches.length) : 0;
}
```
Replace:
```js
function pickFieldBranchIndex(pt) {
  var branches = fieldCardBranches(pt.card);
  if (!branches.length) return 0;
  var scenarioId = resolveNightBossScenarioId();
  var candidates = scenarioId ? scenarioVariantCandidatesForCard(scenarioId, pt.card) : [];
  if (candidates.length) {
    // 同一張卡不同地點都需要重抽：用pt.id當seed key，不共用同一個結果。
    var picked = candidates[fieldSeededIndex(pt.id + ":scenario_variant", candidates.length)];
    var resolvedIndex = matchBranchIndexByName(branches, picked.name.zh);
    if (resolvedIndex !== null) return resolvedIndex;
  }
  return fieldSeededIndex(pt.id + ":branch", branches.length); // 找不到劇本資料/比對失敗：退回純隨機
}
```
`resolveNightBossScenarioId` already exists (~line 455) and is safe to call here (it's a pure read of `meta`, already used elsewhere in the file before `meta` is guaranteed non-null in some call sites — confirm `meta` is non-null by the time `pickFieldBranchIndex` is first called; it's only invoked from `maybeAdvanceFieldInvite`, which only runs once the session has started and `meta` is populated, so this is safe).

- [ ] **Step 4: `node --check` and manual determinism check**

`node --check static_src/midnight.js`. Manual: pick a fixed `meta.mapSeed` game with a known scenario, note which branch a given `card_2` point resolves to (inspect via console: the resolved branch text shown in the narrative), reload the page, confirm the same branch is shown again (determinism). Then create a second point of the same card type on the map and confirm it independently resolves to a variant (may be the same or different — just confirm it's not sharing the exact same RTDB write/seed key by checking `fieldSeededIndex` inputs differ, i.e. each point's `pt.id` differs).

- [ ] **Step 5: Commit**

```bash
git add static_src/midnight.js
git commit -m "feat(midnight): 分歧變體挑選改為劇本連動(依卡牌名稱比對)"
```

---

### Task 9: `midnight_puzzles.js` — 6 puzzle generators (design §4.1) + dice-hand judge (§4.2 dependency)

**Files:**
- Create: `static_src/midnight_puzzles.js`
- Modify: `generate.py`
- Modify: `site_src/midnight_page.py`

**Interfaces:**
- Produces: `window.PriTestMidnightPuzzles = { generate, check, judgeDiceHand }` where `generate(kind)` returns a puzzle descriptor and `check(kind, puzzle, guess)` returns pass/fail (+ feedback for the number-guess type).

- [ ] **Step 1: Write the file with all 6 generators**

```js
// ============================================================================
// midnight（即時制擴張版）魔術師塔謎題：純函式產生器，不依賴DOM/RTDB/window.PriTestMidnight*
// 以外的任何全域狀態，midnight.js負責呼叫並處理UI/計時。2026-09-07新增。
// ============================================================================
(function () {
  "use strict";

  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
    }
    return a;
  }

  // ---- 猜數字（4位不重複，幾A幾B） ----
  function genNumberGuess() {
    var digits = shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]).slice(0, 4);
    return { kind: "numberGuess", answer: digits };
  }
  function checkNumberGuess(puzzle, guessDigits) {
    var a = 0, b = 0;
    for (var i = 0; i < 4; i++) {
      if (guessDigits[i] === puzzle.answer[i]) a++;
      else if (puzzle.answer.indexOf(guessDigits[i]) !== -1) b++;
    }
    return { a: a, b: b, solved: a === 4 };
  }

  // ---- 雞兔同籠 ----
  function genChickenRabbit() {
    var H = 8 + Math.floor(Math.random() * 13); // 8~20
    var minF = 2 * H, maxF = 4 * H;
    var F;
    do {
      F = minF + 2 * Math.floor(Math.random() * ((maxF - minF) / 2 + 1));
    } while (F === minF || F === maxF); // 避免全雞或全兔的退化情況
    var x = (4 * H - F) / 2; // 雞
    return { kind: "chickenRabbit", H: H, F: F, answer: x };
  }
  function checkChickenRabbit(puzzle, guess) {
    return { solved: Number(guess) === puzzle.answer };
  }

  // ---- 秤重找次品 ----
  function genWeighing() {
    var N = 8 + Math.floor(Math.random() * 20); // 8~27
    var lighter = Math.random() < 0.5;
    var answer = Math.ceil(Math.log(N) / Math.log(3));
    return { kind: "weighing", N: N, lighter: lighter, answer: answer };
  }
  function checkWeighing(puzzle, guess) {
    return { solved: Number(guess) === puzzle.answer };
  }

  // ---- 過橋問題（4人，貪心：最快2人來回護送）----
  function genBridge() {
    var times = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]).slice(0, 4).sort(function (a, b) { return a - b; });
    var t = times;
    // 標準4人過橋貪心解：min(
    //   t0+2*t1+t3,      // 快的兩人來回護送
    //   2*t0+t1+t3       // 最快的人當擺渡
    // )
    var optA = t[0] + 2 * t[1] + t[3];
    var optB = 2 * t[0] + t[1] + t[3];
    var answer = Math.min(optA, optB);
    return { kind: "bridge", times: times, answer: answer };
  }
  function checkBridge(puzzle, guess) {
    return { solved: Number(guess) === puzzle.answer };
  }

  // ---- 邏輯消去法（3~5人，身高排序線索）----
  function genLogicElimination() {
    var n = 3 + Math.floor(Math.random() * 3); // 3~5
    var names = ["A", "B", "C", "D", "E"].slice(0, n);
    // 身高順序（0=最高）為隨機排列，answer=最高的人
    var order = shuffle(names);
    var clues = [];
    for (var i = 0; i < order.length - 1; i++) {
      clues.push(order[i] + " 比 " + order[i + 1] + " 高");
    }
    return { kind: "logicElimination", names: names, clues: shuffle(clues), answer: order[0] };
  }
  function checkLogicElimination(puzzle, guess) {
    return { solved: String(guess).toUpperCase() === puzzle.answer };
  }

  // ---- 動態逆向思考（數列推算）----
  function genSequence() {
    var kind = ["arithmetic", "geometric", "square"][Math.floor(Math.random() * 3)];
    var seq = [];
    var answer;
    if (kind === "arithmetic") {
      var start = 1 + Math.floor(Math.random() * 10);
      var step = 1 + Math.floor(Math.random() * 5);
      for (var i = 0; i < 4; i++) seq.push(start + i * step);
      answer = start + 4 * step;
    } else if (kind === "geometric") {
      var s2 = 1 + Math.floor(Math.random() * 3);
      var ratio = 2 + Math.floor(Math.random() * 2);
      for (var j = 0; j < 4; j++) seq.push(s2 * Math.pow(ratio, j));
      answer = s2 * Math.pow(ratio, 4);
    } else {
      var offset = Math.floor(Math.random() * 3);
      for (var k = 0; k < 4; k++) seq.push((k + 1 + offset) * (k + 1 + offset));
      answer = (4 + 1 + offset) * (4 + 1 + offset);
    }
    return { kind: "sequence", sequence: seq, answer: answer };
  }
  function checkSequence(puzzle, guess) {
    return { solved: Number(guess) === puzzle.answer };
  }

  var GENERATORS = {
    numberGuess: genNumberGuess,
    chickenRabbit: genChickenRabbit,
    weighing: genWeighing,
    bridge: genBridge,
    logicElimination: genLogicElimination,
    sequence: genSequence,
  };
  var CHECKERS = {
    numberGuess: checkNumberGuess,
    chickenRabbit: checkChickenRabbit,
    weighing: checkWeighing,
    bridge: checkBridge,
    logicElimination: checkLogicElimination,
    sequence: checkSequence,
  };
  var KINDS = Object.keys(GENERATORS);

  function generate(kind) {
    var pick = kind || KINDS[Math.floor(Math.random() * KINDS.length)];
    return GENERATORS[pick]();
  }
  function check(kind, puzzle, guess) {
    return CHECKERS[kind](puzzle, guess);
  }

  // ---- 12骰牌型判定（設計文件§4.2，判定邏輯與night_floor_breakthrough.jsのjudgeDiceHand
  // 完全相同——7骰同值>大骰>小骰>順子>其他，這裡複製一份純函式，不直接import(見既有
  // MERCHANT_CONSUMABLE_IDS慣例，night_floor_breakthrough.js依賴night.js專屬state不能
  // 整個載入這個頁面)。----
  function judgeDiceHand(values) {
    var counts = [0, 0, 0, 0, 0, 0, 0];
    values.forEach(function (v) { counts[v]++; });
    var maxCount = Math.max(counts[1], counts[2], counts[3], counts[4], counts[5], counts[6]);
    var lowCount = counts[1] + counts[2] + counts[3];
    var highCount = counts[4] + counts[5] + counts[6];
    var isStraight = counts[1] > 0 && counts[2] > 0 && counts[3] > 0 && counts[4] > 0 && counts[5] > 0 && counts[6] > 0;
    if (maxCount >= 7) return "sevenDice";
    if (lowCount === 0) return "large";
    if (highCount === 0) return "small";
    if (isStraight) return "straight";
    return "default";
  }

  window.PriTestMidnightPuzzles = {
    KINDS: KINDS,
    generate: generate,
    check: check,
    judgeDiceHand: judgeDiceHand,
  };
})();
```

- [ ] **Step 2: Verify with a throwaway Node script**

```js
var vm = require("vm");
var fs = require("fs");
var sandbox = { window: {}, Math: Math };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync("static_src/midnight_puzzles.js", "utf8"), sandbox);
var P = sandbox.window.PriTestMidnightPuzzles;
for (var i = 0; i < 50; i++) {
  P.KINDS.forEach(function (kind) {
    var puzzle = P.generate(kind);
    console.assert(puzzle.kind === kind, "kind matches for " + kind);
    console.assert(typeof puzzle.answer !== "undefined" || kind === "numberGuess", "has answer for " + kind);
  });
}
console.assert(P.judgeDiceHand([1,1,1,1,1,1,1,2,3,4,5,6]) === "sevenDice", "7 ones -> sevenDice");
console.assert(P.judgeDiceHand([4,4,5,5,6,6,4,5,6,4,5,6]) === "large", "all 4-6 -> large");
console.assert(P.judgeDiceHand([1,1,2,2,3,3,1,2,3,1,2,3]) === "small", "all 1-3 -> small");
console.assert(P.judgeDiceHand([1,2,3,4,5,6,1,2,3,4,5,6]) === "straight", "1-6 present -> straight");
console.assert(P.judgeDiceHand([1,1,2,2,3,3,4,4,5,5,6,1]) === "default", "no pattern -> default");
console.log("OK");
```
Run: `node scratch_puzzle_check.js` — expect `OK`. Delete the script after.

- [ ] **Step 3: Register the new file**

In `generate.py`, add `"midnight_puzzles.js"` to the JS copy list right before `"midnight_map.js"` (~line 73).
In `site_src/midnight_page.py`'s `extra_scripts` tuple, add `"midnight_puzzles.js"` right before `"midnight_map.js"` (~line 835).

- [ ] **Step 4: `python generate.py`, confirm the file lands in `dist/static/midnight_puzzles.js`**

- [ ] **Step 5: Commit**

```bash
git add static_src/midnight_puzzles.js generate.py site_src/midnight_page.py
git commit -m "feat(midnight): 新增midnight_puzzles.js(6種塔謎題產生器+12骰牌型判定)"
```

---

### Task 10: Wire puzzle generators into the tower (design §4.1)

**Files:**
- Modify: `static_src/midnight.js`
- Modify: `site_src/midnight_page.py`
- Modify: i18n files (zh/ja/en)

**Interfaces:**
- Consumes: `window.PriTestMidnightPuzzles.generate/check` (Task 9).

- [ ] **Step 1: Replace `startTowerPuzzle`'s internals**

Find `startTowerPuzzle` (~line 3784). It currently generates a two-number arithmetic problem. Replace the body (keep the function signature and the `if (towerSolved[pt.id]) return;` guard) with:
```js
function startTowerPuzzle(pt) {
  if (towerSolved[pt.id]) return;
  var puzzle = window.PriTestMidnightPuzzles.generate();
  towerPuzzleState[pt.id] = { puzzle: puzzle, pointId: pt.id };
  renderTowerPuzzleModal(pt, puzzle);
}
```
Declare `var towerPuzzleState = {};` near the other tower-related module variables (find `var towerSolved = {};` and add it alongside).

- [ ] **Step 2: Add rendering + submit handler dispatch (one function per kind)**

```js
function renderTowerPuzzleModal(pt, puzzle) {
  var container = el("midnight-tower-puzzle-body");
  container.innerHTML = "";
  var renderers = {
    numberGuess: renderNumberGuessPuzzle,
    chickenRabbit: renderSingleAnswerPuzzle,
    weighing: renderSingleAnswerPuzzle,
    bridge: renderSingleAnswerPuzzle,
    logicElimination: renderLogicEliminationPuzzle,
    sequence: renderSingleAnswerPuzzle,
  };
  renderers[puzzle.kind](pt, puzzle, container);
  el("midnight-tower-puzzle-modal").hidden = false;
}

var TOWER_PROMPT_KEYS = {
  chickenRabbit: "midnight_tower_prompt_chicken_rabbit",
  weighing: "midnight_tower_prompt_weighing",
  bridge: "midnight_tower_prompt_bridge",
  sequence: "midnight_tower_prompt_sequence",
};

function renderSingleAnswerPuzzle(pt, puzzle, container) {
  var promptText;
  if (puzzle.kind === "chickenRabbit") promptText = window.I18N.t(TOWER_PROMPT_KEYS.chickenRabbit, { h: puzzle.H, f: puzzle.F });
  else if (puzzle.kind === "weighing") promptText = window.I18N.t(TOWER_PROMPT_KEYS.weighing, { n: puzzle.N });
  else if (puzzle.kind === "bridge") promptText = window.I18N.t(TOWER_PROMPT_KEYS.bridge, { times: puzzle.times.join("、") });
  else promptText = window.I18N.t(TOWER_PROMPT_KEYS.sequence, { seq: puzzle.sequence.join("、") });
  var p = document.createElement("p");
  p.textContent = promptText;
  var input = document.createElement("input");
  input.type = "number";
  input.id = "midnight-tower-answer-input";
  var btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = window.I18N.t("midnight_tower_submit_button");
  btn.addEventListener("click", function () {
    var result = window.PriTestMidnightPuzzles.check(puzzle.kind, puzzle, input.value);
    handleTowerPuzzleResult(pt, result.solved);
  });
  container.appendChild(p);
  container.appendChild(input);
  container.appendChild(btn);
}

function renderNumberGuessPuzzle(pt, puzzle, container) {
  var p = document.createElement("p");
  p.textContent = window.I18N.t("midnight_tower_prompt_number_guess");
  var input = document.createElement("input");
  input.type = "text";
  input.maxLength = 4;
  input.pattern = "[0-9]{4}";
  var resultLine = document.createElement("p");
  var btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = window.I18N.t("midnight_tower_guess_button");
  btn.addEventListener("click", function () {
    var digits = String(input.value).split("").map(Number);
    if (digits.length !== 4 || digits.some(isNaN)) return;
    var result = window.PriTestMidnightPuzzles.check("numberGuess", puzzle, digits);
    resultLine.textContent = window.I18N.t("midnight_tower_number_guess_result", { a: result.a, b: result.b });
    if (result.solved) handleTowerPuzzleResult(pt, true);
  });
  container.appendChild(p);
  container.appendChild(input);
  container.appendChild(btn);
  container.appendChild(resultLine);
}

function renderLogicEliminationPuzzle(pt, puzzle, container) {
  var p = document.createElement("p");
  p.textContent = window.I18N.t("midnight_tower_prompt_logic_elimination");
  var clueList = document.createElement("ul");
  puzzle.clues.forEach(function (clue) {
    var li = document.createElement("li");
    li.textContent = clue;
    clueList.appendChild(li);
  });
  var select = document.createElement("select");
  puzzle.names.forEach(function (name) {
    var opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    select.appendChild(opt);
  });
  var btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = window.I18N.t("midnight_tower_submit_button");
  btn.addEventListener("click", function () {
    var result = window.PriTestMidnightPuzzles.check("logicElimination", puzzle, select.value);
    handleTowerPuzzleResult(pt, result.solved);
  });
  container.appendChild(p);
  container.appendChild(clueList);
  container.appendChild(select);
  container.appendChild(btn);
}
```

- [ ] **Step 3: `handleTowerPuzzleResult` marks solved and hands off to Task 11's reward flow**

```js
function handleTowerPuzzleResult(pt, solved) {
  if (!solved) {
    el("midnight-tower-puzzle-wrong-note").hidden = false;
    return;
  }
  el("midnight-tower-puzzle-modal").hidden = true;
  towerSolved[pt.id] = true;
  GameStorage.rtSet(gameId, "cloud", "towerSolved/" + pt.id, true);
  startTowerDiceHandReward(pt); // Task 11
}
```

- [ ] **Step 4: DOM + i18n**

In `site_src/midnight_page.py`, replace the existing two-number arithmetic puzzle markup (search for `midnight-tower-puzzle-modal`) body with an empty container:
```html
<div id="midnight-tower-puzzle-modal" hidden>
  <div id="midnight-tower-puzzle-body"></div>
  <p id="midnight-tower-puzzle-wrong-note" class="warning-text" hidden data-i18n="midnight_tower_wrong_note"></p>
</div>
```
Add i18n keys (zh required, ja/en translated) to all three `i18n_data_*.py`:
```python
"midnight_tower_prompt_number_guess": "猜一組4位不重複數字（0-9），系統會回饋幾A幾B",
"midnight_tower_guess_button": "猜測",
"midnight_tower_number_guess_result": "{a}A{b}B",
"midnight_tower_prompt_chicken_rabbit": "籠中共有 {h} 隻雞兔、{f} 隻腳，雞有幾隻？",
"midnight_tower_prompt_weighing": "{n} 顆球中有1顆較輕或較重，用天秤最少秤幾次能找出？",
"midnight_tower_prompt_bridge": "4人過橋耗時分別為 {times} 分鐘，最短總共需要幾分鐘？",
"midnight_tower_prompt_sequence": "數列 {seq} 之後，第5項是多少？",
"midnight_tower_prompt_logic_elimination": "依下列線索，誰最高？",
"midnight_tower_submit_button": "提交答案",
"midnight_tower_wrong_note": "答案不對，再試一次",
```

- [ ] **Step 5: `python generate.py`, manual verification of all 6 puzzle types**

Force each `kind` by temporarily calling `window.PriTestMidnightPuzzles.generate("chickenRabbit")` etc. from the browser console to spot-check each renderer displays correctly and validates correctly, then let the real random dispatch run a few times to confirm all 6 appear over repeated attempts.

- [ ] **Step 6: Commit**

```bash
git add static_src/midnight.js site_src/midnight_page.py site_src/i18n_data_zh.py site_src/i18n_data_ja.py site_src/i18n_data_en.py
git commit -m "feat(midnight): 魔術師塔改為6種參數化謎題"
```

---

### Task 11: Tower puzzle 12-dice reward (design §4.2)

**Files:**
- Modify: `static_src/midnight.js`
- Modify: `character_drawer.js` (new `drawWeaponFromCategory` helper)
- Modify: `site_src/midnight_page.py`, `static_src/style.css`, i18n files

**Interfaces:**
- Consumes: `window.PriTestMidnightPuzzles.judgeDiceHand` (Task 9), `pushPerPlayerReward` (Task 1).
- Produces: `CharacterDrawer.drawWeaponFromCategory(c, categoryId, starCount)`.

- [ ] **Step 1: Add `drawWeaponFromCategory` in `character_drawer.js`**

Add right after `merchantDrawWeapon` (~line 2752-2790, after its closing brace):
```js
// 塔謎題12骰獎勵「杖」品項用（設計文件§4.2）：跟merchantDrawWeapon幾乎一樣，只是category固定
// 不隨機選，複用同一套pickWeaponByRoll/lookupRarityBySum規則，不重新發明抽選機率。
function drawWeaponFromCategory(c, categoryId, starCount) {
  var stars = Math.max(1, Math.min(4, starCount || 1));
  var attempt, item, rarity, rarityDice, itemDie;
  for (attempt = 0; attempt < 20; attempt++) {
    rarityDice = [];
    for (var i = 0; i < stars; i++) rarityDice.push(rollD6());
    rarity = lookupRarityBySum(rarityDice.reduce(function (a, b) { return a + b; }, 0));
    itemDie = rollD6();
    item = pickWeaponByRoll(categoryId, rarity, itemDie);
    if (item) break;
  }
  if (!item) return null;
  var weaponId = categoryId + ":" + item.id + ":" + rarity + ":" + Date.now() + Math.floor(Math.random() * 1000);
  return { item: item, rarity: rarity, weaponId: weaponId };
}
```
Add `drawWeaponFromCategory: drawWeaponFromCategory,` to the file's exported `window.PriTestCharacterDrawer = {...}` object (find that export block near the end of the file and add the line alongside the existing `merchantDrawWeapon: merchantDrawWeapon,` entry).

**Note:** confirm the exact `weaponId` construction convention used elsewhere (grep `merchantDrawWeapon`'s own `return { item: item, rarity: rarity, weaponId: ... }` line to copy its precise id format instead of inventing a new one — the snippet above is a placeholder format to be replaced with whatever `merchantDrawWeapon` actually returns for `weaponId`).

- [ ] **Step 2: Reward table + dice-roll/reroll UI in `midnight.js`**

```js
// 塔謎題12骰牌型獎勵表（設計文件§4.2，順序即優先序，judgeDiceHand()回傳值對應這裡的key）。
var TOWER_DICE_HAND_REWARDS = {
  sevenDice: [
    { kind: "staffStar", value: 2 }, { kind: "weaponStar", value: 3 },
    { kind: "talisman" }, { kind: "consumable", itemId: "item_shard_of_starlight", count: 2 },
  ],
  large: [
    { kind: "staffStar", value: 2 }, { kind: "weaponStar", value: 2 },
    { kind: "talisman" }, { kind: "consumable", itemId: "item_shard_of_starlight", count: 1 },
  ],
  small: [
    { kind: "staffStar", value: 2 }, { kind: "weaponStar", value: 2 },
    { kind: "consumable", itemId: "item_shard_of_starlight", count: 1 },
  ],
  straight: [
    { kind: "staffStar", value: 2 }, { kind: "weaponStar", value: 2 }, { kind: "weaponStar", value: 1 },
    { kind: "consumable", itemId: "item_shard_of_starlight", count: 1 },
  ],
  default: [
    { kind: "staffStar", value: 1 }, { kind: "weaponStar", value: 1 },
    { kind: "consumable", itemId: "item_shard_of_starlight", count: 1 },
  ],
};

var towerDiceState = {}; // pointId -> { dice: [1..6 x12], rerolled: bool }

function startTowerDiceHandReward(pt) {
  var dice = [];
  for (var i = 0; i < 12; i++) dice.push(1 + Math.floor(Math.random() * 6));
  towerDiceState[pt.id] = { dice: dice, rerolled: false };
  renderTowerDiceHandModal(pt);
}

function renderTowerDiceHandModal(pt) {
  var state = towerDiceState[pt.id];
  var container = el("midnight-tower-dice-hand-body");
  container.innerHTML = "";
  state.dice.forEach(function (value, idx) {
    var die = document.createElement("button");
    die.type = "button";
    die.className = "midnight-tower-die midnight-tower-die-flip"; // CSS handles the flip-5x animation on add
    die.textContent = String(value);
    die.dataset.selected = "false";
    die.addEventListener("click", function () {
      if (state.rerolled) return; // 已重骰過一次，不能再選
      var sel = die.dataset.selected === "true";
      die.dataset.selected = sel ? "false" : "true";
      die.classList.toggle("midnight-tower-die-selected", !sel);
    });
    container.appendChild(die);
  });
  el("btn-midnight-tower-dice-reroll").hidden = state.rerolled;
  el("btn-midnight-tower-dice-reroll").onclick = function () { handleTowerDiceReroll(pt); };
  el("btn-midnight-tower-dice-confirm").onclick = function () { handleTowerDiceConfirm(pt); };
  el("midnight-tower-dice-hand-modal").hidden = false;
}

function handleTowerDiceReroll(pt) {
  var state = towerDiceState[pt.id];
  if (state.rerolled) return;
  var dieEls = el("midnight-tower-dice-hand-body").querySelectorAll(".midnight-tower-die");
  dieEls.forEach(function (dieEl, idx) {
    if (dieEl.dataset.selected === "true") {
      state.dice[idx] = 1 + Math.floor(Math.random() * 6);
    }
  });
  state.rerolled = true;
  renderTowerDiceHandModal(pt);
}

function handleTowerDiceConfirm(pt) {
  var state = towerDiceState[pt.id];
  var handId = window.PriTestMidnightPuzzles.judgeDiceHand(state.dice);
  var rewardSpecs = TOWER_DICE_HAND_REWARDS[handId];
  var c = characters[myTokenId];
  var labels = [];
  var entries = [];
  rewardSpecs.forEach(function (spec) {
    if (spec.kind === "staffStar") {
      var drawn = window.PriTestCharacterDrawer.drawWeaponFromCategory(c, "staff", spec.value);
      if (drawn && hasInventorySpace(c, "weapon")) {
        c.weaponIds.push(drawn.weaponId);
        labels.push(window.PriTestWeapons.localizedText(drawn.item.name));
      }
    } else if (spec.kind === "weaponStar") {
      entries.push({ kind: "weaponStar", value: spec.value, perPerson: true });
    } else if (spec.kind === "talisman") {
      entries.push({ kind: "talisman", perPerson: true });
    } else if (spec.kind === "consumable") {
      for (var i = 0; i < spec.count; i++) entries.push({ kind: "consumable", itemId: spec.itemId, perPerson: true });
    }
  });
  entries.forEach(function (entry) {
    var label = grantLootRewardEntryToCharacter(c, entry);
    if (label) labels.push(label);
  });
  GameStorage.rtSet(gameId, "cloud", "character/" + myTokenId, c);
  el("midnight-tower-dice-hand-modal").hidden = true;
  showToast(window.I18N.t("midnight_reward_toast_prefix") + labels.join("、"));
  delete towerDiceState[pt.id];
}
```

**Note:** `c.weaponIds` must exist (`c.weaponIds = c.weaponIds || []` if any doubt — check how other weapon-granting code in this file initializes it, e.g. `handlePickupGroundItem`'s `c2.weaponIds = (c2.weaponIds || []).concat(...)` pattern, and match that defensive style instead of assuming it's always an array).

- [ ] **Step 3: DOM + CSS + i18n**

`site_src/midnight_page.py`:
```html
<div id="midnight-tower-dice-hand-modal" hidden>
  <div id="midnight-tower-dice-hand-body"></div>
  <button type="button" id="btn-midnight-tower-dice-reroll" data-i18n="midnight_tower_dice_reroll_button"></button>
  <button type="button" id="btn-midnight-tower-dice-confirm" data-i18n="midnight_tower_dice_confirm_button"></button>
</div>
```
`static_src/style.css`: add `.midnight-tower-die`, `.midnight-tower-die-flip` (a `@keyframes` spinning 5 full rotations then settling — reuse the existing keyframe-animation authoring style already present in the file for other flip/spin effects, e.g. search for an existing `@keyframes` block to match naming conventions), `.midnight-tower-die-selected` (a distinct border/background color).
i18n (zh/ja/en):
```python
"midnight_tower_dice_reroll_button": "指定任意骰子並重骰一次",
"midnight_tower_dice_confirm_button": "確定牌型",
```

- [ ] **Step 4: Manual verification**

Solve a puzzle, confirm 12 dice appear with the flip animation, select a few, reroll once, confirm reroll button then disappears (single-use), confirm confirm button always available, confirm each of the 5 hand outcomes can be observed by repeating (or by temporarily hardcoding `state.dice` in the console before calling `handleTowerDiceConfirm` to force each branch), confirm rewards land in inventory (or fail with the full-inventory yellow note from Task 2).

- [ ] **Step 5: Commit**

```bash
git add static_src/midnight.js static_src/character_drawer.js site_src/midnight_page.py static_src/style.css site_src/i18n_data_zh.py site_src/i18n_data_ja.py site_src/i18n_data_en.py
git commit -m "feat(midnight): 魔術師塔解謎成功後新增12骰牌型獎勵"
```

---

### Task 12: PotentialPower dual-draw pick-one (design §3.3)

**Files:**
- Modify: `static_src/midnight.js`

- [ ] **Step 1: Rewrite `renderPotentialPowerRewardDetail`**

Find the function (~line 5791). Replace its two-independent-button structure with a single "抽選" button that draws both simultaneously, then two result cards each with its own confirm:
```js
function renderPotentialPowerRewardDetail(id, entry, detail) {
  detail.innerHTML = "";
  var draft = potentialPowerDraftById[id];
  if (!draft) {
    var drawBtn = document.createElement("button");
    drawBtn.type = "button";
    drawBtn.textContent = window.I18N.t("midnight_reward_draw_button");
    drawBtn.addEventListener("click", function () {
      var c = characters[myTokenId];
      var weaponResult = window.PriTestCharacterDrawer.potentialPowerDrawWeapon(c, entry.value || 1);
      var effect = window.PriTestCharacterDrawer.rollPotentialPowerAttachedEffect(c);
      var preview = effect ? window.PriTestCharacterDrawer.previewAttachedEffectSlot(c) : null;
      potentialPowerDraftById[id] = { weaponResult: weaponResult, effect: effect, preview: preview };
      renderRewardModal();
    });
    detail.appendChild(drawBtn);
    return;
  }
  var note = document.createElement("p");
  note.className = "warning-text";
  note.textContent = window.I18N.t("midnight_reward_potential_choose_note");
  detail.appendChild(note);
  var row = document.createElement("div");
  row.className = "wb-row";
  if (draft.weaponResult) {
    var weaponCard = document.createElement("button");
    weaponCard.type = "button";
    weaponCard.textContent = window.PriTestWeapons.localizedText(draft.weaponResult.item.name);
    weaponCard.addEventListener("click", function () {
      window.PriTestCharacterDrawer.commitPotentialPowerWeapon(characters[myTokenId], draft.weaponResult, null);
      GameStorage.rtSet(gameId, "cloud", "character/" + myTokenId, characters[myTokenId]);
      confirmRewardEntry(id, { apply: function () {} });
    });
    row.appendChild(weaponCard);
  }
  if (draft.effect) {
    var effectCard = document.createElement("button");
    effectCard.type = "button";
    effectCard.textContent = window.PriTestCharacterTypes.localizedText(draft.effect.name || draft.effect.body);
    effectCard.addEventListener("click", function () {
      window.PriTestCharacterDrawer.commitAttachedEffectChoice(characters[myTokenId], draft.effect, draft.preview);
      GameStorage.rtSet(gameId, "cloud", "character/" + myTokenId, characters[myTokenId]);
      confirmRewardEntry(id, { apply: function () {} });
    });
    row.appendChild(effectCard);
  }
  detail.appendChild(row);
}
```

**Note:** the exact shape of `rollPotentialPowerAttachedEffect`'s return value (does it have `.name`? `.body`?) and `previewAttachedEffectSlot`'s return value must be confirmed by reading `character_drawer.js:3049-3090` before finalizing this rendering code — adjust the field access accordingly if the actual shape differs from what's assumed here.

- [ ] **Step 2: `node --check`, manual verification**

Trigger a `potentialPower` reward, confirm both draws appear side by side with the yellow "請從下方選項中獲得一項" note, confirm picking one commits only that one and the other is discarded (character object shows only the chosen effect after reload).

- [ ] **Step 3: Commit**

```bash
git add static_src/midnight.js
git commit -m "feat(midnight): 潛在力量獎勵改為雙抽同時揭示二選一"
```

---

### Task 13: Weapon-skill-reroll forge modal (design §3.5)

**Files:**
- Modify: `static_src/midnight.js`
- Modify: `site_src/midnight_page.py`, i18n files

**Interfaces:**
- Consumes: `listRerollableWeaponSkillSlots`, `rerollWeaponSkill`, `commitWeaponSkillReroll` (`character_drawer.js`, already exist).

- [ ] **Step 1: Modal open/close + weapon list**

```js
var weaponRerollState = null; // { weaponId, slot, rerollResult } | null
var weaponRerollLeaveArmed = false;
var weaponRerollLeaveTimer = null;

function openWeaponRerollModal() {
  weaponRerollState = null;
  weaponRerollLeaveArmed = false;
  renderWeaponRerollModal();
  el("midnight-weapon-reroll-modal").hidden = false;
}

function renderWeaponRerollModal() {
  var listEl = el("midnight-weapon-reroll-list");
  var c = characters[myTokenId];
  if (!weaponRerollState) {
    listEl.innerHTML = "";
    window.PriTestCharacterDrawer.listRerollableWeaponSkillSlots(c).forEach(function (slotInfo) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = window.PriTestWeapons.localizedText(slotInfo.weaponName || slotInfo.weapon.name);
      btn.addEventListener("click", function () {
        weaponRerollState = { weaponId: slotInfo.weaponId, slot: slotInfo.slot, rerollResult: null };
        renderWeaponRerollModal();
      });
      listEl.appendChild(btn);
    });
    el("midnight-weapon-reroll-compare").hidden = true;
    return;
  }
  listEl.innerHTML = "";
  var pinned = document.createElement("div");
  pinned.className = "midnight-forge-pinned-weapon";
  pinned.textContent = weaponRerollState.weaponId;
  listEl.appendChild(pinned);
  el("midnight-weapon-reroll-compare").hidden = !weaponRerollState.rerollResult;
  if (weaponRerollState.rerollResult) {
    el("midnight-weapon-reroll-compare-old").textContent = weaponRerollState.rerollResult.oldLabel || "";
    el("midnight-weapon-reroll-compare-new").textContent = weaponRerollState.rerollResult.newLabel || "";
  }
}

function handleWeaponRerollUseClick() {
  if (!weaponRerollState) return;
  var c = characters[myTokenId];
  var result = window.PriTestCharacterDrawer.rerollWeaponSkill(c, weaponRerollState.weaponId, weaponRerollState.slot);
  weaponRerollState.rerollResult = result;
  renderWeaponRerollModal();
}

function handleWeaponRerollApplyClick() {
  if (!weaponRerollState || !weaponRerollState.rerollResult) return;
  var c = characters[myTokenId];
  window.PriTestCharacterDrawer.commitWeaponSkillReroll(c, weaponRerollState.weaponId, weaponRerollState.slot, weaponRerollState.rerollResult.skillId);
  GameStorage.rtSet(gameId, "cloud", "character/" + myTokenId, c);
  closeWeaponRerollModal();
}

// [保留並離開]：放棄結果(不寫回)＋二段式確認離開，跟原本[離開]相同機制。
function handleWeaponRerollKeepAndLeaveClick() {
  if (!weaponRerollLeaveArmed) {
    weaponRerollLeaveArmed = true;
    el("midnight-weapon-reroll-leave-note").hidden = false;
    weaponRerollLeaveTimer = setTimeout(function () {
      weaponRerollLeaveArmed = false;
      el("midnight-weapon-reroll-leave-note").hidden = true;
    }, 3000);
    return;
  }
  clearTimeout(weaponRerollLeaveTimer);
  closeWeaponRerollModal();
}

function closeWeaponRerollModal() {
  el("midnight-weapon-reroll-modal").hidden = true;
  el("midnight-weapon-reroll-leave-note").hidden = true;
  weaponRerollState = null;
  weaponRerollLeaveArmed = false;
  if (weaponRerollLeaveTimer) clearTimeout(weaponRerollLeaveTimer);
}
```

**Note:** confirm `listRerollableWeaponSkillSlots`'s actual returned object shape (`weaponId`/`slot`/`weaponName` or similar) by reading `character_drawer.js:2817-2845` before wiring the exact field names used above.

- [ ] **Step 2: Wire this reward kind into the grant flow**

`weaponSkillReroll` is `perPerson:true` by default (per design §3.5) — it flows through the existing `pushPerPlayerReward`/reward-modal path like any other loot kind, but its "claim" action opens this modal instead of instantly granting. In `grantLootRewardEntryToCharacter`, add:
```js
if (entry.kind === "weaponSkillReroll") {
  c._weaponRerollCredits = (c._weaponRerollCredits || 0) + (entry.value || 1);
  return window.I18N.t("midnight_reward_label_weapon_skill_reroll", { value: entry.value || 1 });
}
```
The character-sheet UI (wherever the forge-open button lives — add a new button near the weapon list, disabled when `c._weaponRerollCredits` is 0) should decrement `_weaponRerollCredits` by 1 each time `handleWeaponRerollApplyClick` successfully commits.

- [ ] **Step 3: DOM + i18n**

```html
<div id="midnight-weapon-reroll-modal" hidden>
  <div id="midnight-weapon-reroll-list"></div>
  <div id="midnight-weapon-reroll-compare" hidden>
    <p><span data-i18n="midnight_weapon_reroll_old_label"></span><span id="midnight-weapon-reroll-compare-old"></span></p>
    <p><span data-i18n="midnight_weapon_reroll_new_label"></span><span id="midnight-weapon-reroll-compare-new"></span></p>
  </div>
  <button type="button" id="btn-midnight-weapon-reroll-use" data-i18n="midnight_weapon_reroll_use_button"></button>
  <button type="button" id="btn-midnight-weapon-reroll-apply" data-i18n="midnight_weapon_reroll_apply_button"></button>
  <button type="button" id="btn-midnight-weapon-reroll-keep-leave" data-i18n="midnight_weapon_reroll_keep_leave_button"></button>
  <p id="midnight-weapon-reroll-leave-note" class="warning-text" hidden data-i18n="midnight_weapon_reroll_leave_note"></p>
</div>
```
i18n (zh/ja/en):
```python
"midnight_weapon_reroll_old_label": "原戰技：",
"midnight_weapon_reroll_new_label": "新戰技：",
"midnight_weapon_reroll_use_button": "使用",
"midnight_weapon_reroll_apply_button": "套用",
"midnight_weapon_reroll_keep_leave_button": "保留並離開",
"midnight_weapon_reroll_leave_note": "再按一下放棄使用鍛造台",
"midnight_reward_label_weapon_skill_reroll": "戰技重抽券×{value}",
```

- [ ] **Step 4: Manual verification**

Grant a `weaponSkillReroll` entry to a test character, open the forge, select a weapon, use, confirm comparison table shows old vs new, press 保留並離開 once (confirm warning shows, modal stays open), press again within 3s (confirm modal closes without writing), reopen and repeat but press 套用 this time (confirm the character's weapon skill actually changed after reload).

- [ ] **Step 5: Commit**

```bash
git add static_src/midnight.js site_src/midnight_page.py site_src/i18n_data_zh.py site_src/i18n_data_ja.py site_src/i18n_data_en.py
git commit -m "feat(midnight): 新增戰技重抽鍛造台UI"
```

---

### Task 14: GM-judgment reward kinds auto-resolve (design §3.6, minus bargainReveal)

**Files:**
- Modify: `static_src/midnight.js`

**Interfaces:**
- Consumes: `judgeDiceHand`-equivalent (copy inline, see Step 2), `entry.tiers`, choice results from Task 5's vote resolution.
- Produces: `resolveJudgmentRewardEntries(entries, trig)` called from `maybeGrantFieldTileReward`.

- [ ] **Step 1: Copy `judgeDiceHand` as a local pure function** (distinct copy from Task 9's puzzle-specific one — this one takes the `night.js`-style `entry` with `.hands[]`, matching the original signature exactly since it's driving general floor rewards, not the tower's fixed table)

```js
// 複製自night_floor_breakthrough.js:250(純函式)，GM判斷類diceHandChoice獎勵用。
function judgeDiceHandEntry(entry, values) {
  var counts = [0, 0, 0, 0, 0, 0, 0];
  values.forEach(function (v) { counts[v]++; });
  var maxCount = Math.max(counts[1], counts[2], counts[3], counts[4], counts[5], counts[6]);
  var lowCount = counts[1] + counts[2] + counts[3];
  var highCount = counts[4] + counts[5] + counts[6];
  var isStraight = counts[1] > 0 && counts[2] > 0 && counts[3] > 0 && counts[4] > 0 && counts[5] > 0 && counts[6] > 0;
  var matchedId = null;
  if (maxCount >= 7) matchedId = "sevenDice";
  else if (lowCount === 0) matchedId = "large";
  else if (highCount === 0) matchedId = "small";
  else if (isStraight) matchedId = "straight";
  return (entry.hands || []).filter(function (h) { return h.id === matchedId; })[0] || null;
}
```

- [ ] **Step 2: `resolveJudgmentRewardEntries`, called recursively for tier/hand sub-rewards**

```js
// GM判斷類獎勵自動套用（設計文件§3.6）。voteChoiceLabel＝這一層§1.3投票判定出的選項標籤
// (tieredChoice比對用)，可能為null(這一層沒有選項)。
function resolveJudgmentRewardEntries(entries, trig, voteChoiceLabel) {
  var lootOut = [];
  (entries || []).forEach(function (entry) {
    if (entry.kind === "hpDamage") {
      var slots = participantSlots(trig);
      if (slots.length) {
        var pickedSlot = slots[Math.floor(Math.random() * slots.length)];
        var tokenId = players[pickedSlot] && players[pickedSlot].tokenId;
        if (tokenId) {
          GameStorage.rtTransaction(gameId, "cloud", "demoStat/" + tokenId, function (cur) {
            var max = selfArenaHpMax(characters[tokenId]);
            var current = cur === null ? max : cur;
            return Math.max(0, current - (entry.value || 0));
          });
        }
      }
    } else if (entry.kind === "tieredChoice") {
      var tier = (entry.tiers || []).filter(function (t) { return t.label === voteChoiceLabel; })[0];
      if (tier) lootOut = lootOut.concat(resolveJudgmentRewardEntries(tier.rewards, trig, voteChoiceLabel));
    } else if (entry.kind === "diceHandChoice") {
      var diceCount = entry.diceCount || 12;
      var values = [];
      for (var i = 0; i < diceCount; i++) values.push(1 + Math.floor(Math.random() * 6));
      var hand = judgeDiceHandEntry(entry, values);
      if (hand) lootOut = lootOut.concat(resolveJudgmentRewardEntries(hand.rewards, trig, voteChoiceLabel));
    } else if (entry.kind === "note") {
      Object.keys(trig.participants || {}).forEach(function (slot) {
        var p = players[slot];
        var c = p && characters[p.tokenId];
        if (!c) return;
        c._lastTileRewardNote = { text: window.PriTestFields.localizedText(entry.text || entry.body), at: Date.now() };
        GameStorage.rtSet(gameId, "cloud", "character/" + p.tokenId, c);
      });
    } else {
      lootOut.push(entry); // 戰利品類直接回傳，交給呼叫端跟現有戰利品entries合併處理
    }
  });
  return lootOut;
}
```

- [ ] **Step 3: Wire into `maybeGrantFieldTileReward`**

Find (~line 5583):
```js
function maybeGrantFieldTileReward(pt, trig, floor) {
  if (fieldTileRewardAttempted[pt.id]) return;
  fieldTileRewardAttempted[pt.id] = true;
  var FloorBreakthrough = window.PriTestNightFloorBreakthrough;
  var reward = (floor && floor.reward) || [];
  var lootEntries = FloorBreakthrough ? reward.filter(FloorBreakthrough.isLootRewardEntry) : [];
  if (!lootEntries.length) return;
  ...
```
Replace to also resolve judgment entries (note: `window.PriTestNightFloorBreakthrough` is NOT loaded on the midnight page — confirm this before relying on it; if it isn't loaded, `isLootRewardEntry`'s logic must be inlined instead, matching Task 1's `isPerPersonRewardEntry` sibling — since `LOOT_REWARD_KINDS` is a fixed short list, inline it directly rather than depending on a module that isn't actually available at runtime):
```js
var LOOT_REWARD_KINDS = ["rune", "weaponStar", "consumable", "talisman", "potentialPower", "stoneswordKey", "smithingStone", "chaliceBonus", "weaponSkillReroll"];
function isLootRewardEntryLocal(entry) {
  return LOOT_REWARD_KINDS.indexOf(entry.kind) !== -1;
}
function isJudgmentRewardEntryLocal(entry) {
  return ["hpDamage", "tieredChoice", "diceHandChoice", "bargainReveal", "note"].indexOf(entry.kind) !== -1;
}

function maybeGrantFieldTileReward(pt, trig, floor) {
  if (fieldTileRewardAttempted[pt.id]) return;
  fieldTileRewardAttempted[pt.id] = true;
  var reward = (floor && floor.reward) || [];
  var lootEntries = reward.filter(isLootRewardEntryLocal);
  var judgmentEntries = reward.filter(isJudgmentRewardEntryLocal);
  var voteLabel = null;
  if (typeof trig.choiceIndex === "number") {
    var labels = fieldChoiceLabelsFor(pt, trig);
    voteLabel = labels[trig.choiceIndex] || null;
  }
  var resolvedLoot = judgmentEntries.length ? resolveJudgmentRewardEntries(judgmentEntries.filter(function (e) { return e.kind !== "bargainReveal"; }), trig, voteLabel) : [];
  var bargainEntries = judgmentEntries.filter(function (e) { return e.kind === "bargainReveal"; });
  var allLoot = lootEntries.concat(resolvedLoot);
  if (allLoot.length) {
    GameStorage.rtTransaction(gameId, "cloud", "fieldTrigger/" + pt.id + "/tileRewardGrantedBy", function (cur) {
      return cur === null ? myTokenId : cur;
    }).then(function (committed) {
      if (committed !== myTokenId) return;
      var perPerson = allLoot.filter(isPerPersonRewardEntry);
      var shared = allLoot.filter(function (e) { return !isPerPersonRewardEntry(e); });
      if (perPerson.length) { grantTileLootToParticipants(trig, perPerson); pushPerPlayerReward(pt.id, perPerson); }
      shared.forEach(function (e) { pushSharedReward(pt.id, e); });
    });
  }
  if (bargainEntries.length) openBargainRevealModal(pt, trig, bargainEntries[0]); // Task 15
}
```

- [ ] **Step 4: `node --check`, manual verification**

Find a floor whose `reward[]` contains a `note` entry (search `PriTestFields` data via console for one, e.g. grep `kind: "note"` in `fields_data_*.js` files to find a concrete example), clear that floor, confirm the note text appears in the toast. Repeat for a `hpDamage` entry (confirm a random participant's HP drops by the right amount) and a `tieredChoice` entry (find one tied to an actual "(→XXX)" choice, confirm the tier matching the chosen label grants its rewards).

- [ ] **Step 5: Commit**

```bash
git add static_src/midnight.js
git commit -m "feat(midnight): GM判斷類獎勵(hpDamage/tieredChoice/diceHandChoice/note)自動套用"
```

---

### Task 15: `bargainReveal` modal + 4 concrete deal effect mappings (design §3.6, §9-2)

**Files:**
- Modify: `static_src/midnight.js`
- Modify: `site_src/midnight_page.py`, i18n files

**Interfaces:**
- Consumes: `openBargainRevealModal` call site from Task 14 Step 3.
- Produces: a reusable bargain engine also consumed by Task 25 (襲擊/調律の魔物).

- [ ] **Step 1: Structured-effect application table for the 4 known deals**

```js
// 調律の魔物取引表・4個已知deal的midnight數值換算（設計文件§9-2）。key對應
// event_rulebook.jsの取引抽選表原文標題（用於比對，見Task 25引用時的資料來源）。
// applyGood/applyBad回傳true代表已結構化套用完畢，回傳false代表無法結構化、只留文字。
var BARGAIN_DEAL_EFFECTS = {
  "後に大成したい": {
    applyGood: function (c) {
      c._pendingDay3HpBonus = (c._pendingDay3HpBonus || 0) + 30; // 打贏Day2夜之強敵、進入Day3時+30 HP，見maybeTriggerDay3FromReady()掛勾點
      return true;
    },
    applyBad: function (c) {
      fp.current = Math.max(0, fp.current - 10); // 立即扣FP(本地端資源，只影響自己)；「最大加護」midnight無對應資源、略過
      return true;
    },
  },
  "全力で戦いたい": {
    applyGood: function (c) {
      GameStorage.rtSet(gameId, "cloud", "demoStat/" + myTokenId, (demoStats[myTokenId] || selfArenaHpMax(c)) ); // 觸發即時最大HP重算(selfArenaHpMax讀c.hp.max，這裡先確保UI立即反映)
      c._bargainMaxHpBonus = (c._bargainMaxHpBonus || 0) + 10; // 供selfArenaHpMax()疊加，Task實作需在該函式讀取此欄位
      return true; // 「任選威力補正+5」沿用既有choice picker(見RELIC_CHOICE_CONFIG_BY_NAME同款pattern)機制，實作階段接上
    },
    applyBad: function () {
      GameStorage.rtTransaction(gameId, "cloud", "meta/day3BossHpBonusRaw", function (cur) { return (cur || 0) + 20; }); // 累積，多PC各自套用時加總
      return true;
    },
  },
};
var BARGAIN_STAMINA_GOOD_KEY = "防禦階段開始獲得體力骰1個";
var BARGAIN_STAMINA_BAD_KEY = "行動階段體力骰□變⚀";
BARGAIN_DEAL_EFFECTS[BARGAIN_STAMINA_GOOD_KEY] = {
  applyGood: function () { myStaminaRegenPerSec = 6; return true; }, // 5→6/秒
  applyBad: function () { return false; }, // 這個deal沒有對應bad(見§9-2兩個是各自不同deal各一半)
};
BARGAIN_DEAL_EFFECTS[BARGAIN_STAMINA_BAD_KEY] = {
  applyGood: function () { return false; },
  applyBad: function () { myStaminaRegenPerSec = 4; return true; }, // 5→4/秒
};
```

**Note:** `myStaminaRegenPerSec` doesn't exist yet — the existing `STAMINA_REGEN_PER_SEC` is a shared constant used wherever stamina regenerates. Introduce a module-level `var myStaminaRegenPerSec = STAMINA_REGEN_PER_SEC;` and replace the read site(s) that currently use `STAMINA_REGEN_PER_SEC` directly for the local player's regen tick with `myStaminaRegenPerSec` (grep `STAMINA_REGEN_PER_SEC` usage sites first — there should be exactly one regen-tick call site to update, since this is a per-second tick, not per-character since midnight only tracks the local player's own stamina).

- [ ] **Step 2: Generic modal (works for both §3.6 bargainReveal and Task 25's 調律の魔物, since data shape is identical)**

```js
function openBargainRevealModal(pt, trig, entry) {
  var deals = entry.deals || [];
  renderBargainDealList(pt, trig, deals);
  el("midnight-bargain-modal").hidden = false;
}

function renderBargainDealList(pt, trig, deals) {
  var listEl = el("midnight-bargain-deal-list");
  listEl.innerHTML = "";
  deals.forEach(function (deal, idx) {
    var card = document.createElement("div");
    var title = document.createElement("p");
    title.textContent = deal.title + "　" + window.I18N.t("midnight_bargain_good_label") + "：" + deal.good;
    card.appendChild(title);
    var badLine = document.createElement("p");
    badLine.hidden = true;
    card.appendChild(badLine);
    var btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = window.I18N.t("midnight_bargain_choose_button");
    btn.addEventListener("click", function () {
      badLine.textContent = window.I18N.t("midnight_bargain_bad_label") + "：" + deal.bad;
      badLine.hidden = false;
      btn.disabled = true;
      var c = characters[myTokenId];
      var effects = BARGAIN_DEAL_EFFECTS[deal.title];
      var goodApplied = effects && effects.applyGood(c);
      var badApplied = effects && effects.applyBad(c);
      c._lastTileRewardNote = {
        text: deal.title + "／" + window.I18N.t("midnight_bargain_good_label") + "：" + deal.good +
          (goodApplied ? "" : window.I18N.t("midnight_bargain_manual_note")) +
          "／" + window.I18N.t("midnight_bargain_bad_label") + "：" + deal.bad +
          (badApplied ? "" : window.I18N.t("midnight_bargain_manual_note")),
        at: Date.now(),
      };
      GameStorage.rtSet(gameId, "cloud", "character/" + myTokenId, c);
    });
    card.appendChild(btn);
    listEl.appendChild(card);
  });
}
```

- [ ] **Step 3: DOM + i18n**

```html
<div id="midnight-bargain-modal" hidden>
  <div id="midnight-bargain-deal-list"></div>
</div>
```
i18n (zh/ja/en):
```python
"midnight_bargain_good_label": "良好效果",
"midnight_bargain_bad_label": "不良效果",
"midnight_bargain_choose_button": "選擇這項",
"midnight_bargain_manual_note": "（無法自動套用，請自行對照文字處理）",
```

- [ ] **Step 4: Wire `_pendingDay3HpBonus`/`_bargainMaxHpBonus`/`meta.day3BossHpBonusRaw` into their actual consumption points**

- `_pendingDay3HpBonus`: in `maybeTriggerDay3FromReady()` (existing function, search for it), when writing `meta.day3StartAt`, also read each ready participant's `_pendingDay3HpBonus` and apply it to their `demoStat` at that moment (one-time, then clear the flag).
- `_bargainMaxHpBonus`: in `selfArenaHpMax(c)` (~line 400), add `+ (c._bargainMaxHpBonus || 0) * 10` — wait, check the design's exact wording: "自身最大HP:+10" is a flat 10, not a ×10-multiplied box — add it as a flat addend, not multiplied: `return 100 + (c.hp.max + CharacterDrawer.totalFlatMaxStatBonus(c, "hp")) * 10 + (c._bargainMaxHpBonus || 0);`.
- `meta.day3BossHpBonusRaw`: in `bossHpMax(bossId)` (existing function), add `+ (meta.day3BossHpBonusRaw || 0) * 10` to the final multiplied total (per design: "未乘上倍率的HP+20" means +20 to the pre-×10 box sum, so the ×10 happens on this bonus too — read `bossHpMax`'s existing body first to confirm exactly where the `×10` multiplication happens and add the bonus before that multiplication, not after).

- [ ] **Step 5: Manual verification**

Trigger a floor/event with a `bargainReveal` entry (or manually construct one via console for testing if no such floor is easily reachable), confirm all deals show with good-effect visible and bad hidden, pick one, confirm bad effect reveals, confirm the 2 known-mapped deals' numeric effects actually apply (FP−10 visible in HUD; stamina regen visibly faster/slower over the next several seconds), confirm the other 2 stamina deals apply their regen change too.

- [ ] **Step 6: Commit**

```bash
git add static_src/midnight.js site_src/midnight_page.py site_src/i18n_data_zh.py site_src/i18n_data_ja.py site_src/i18n_data_en.py
git commit -m "feat(midnight): bargainReveal自動套用+調律の魔物取引4個deal的midnight數值換算"
```

---

### Task 16: Church (K) chalice-bonus routes through reward list (design §5)

**Files:**
- Modify: `static_src/midnight.js`

- [ ] **Step 1: Change `chaliceBonus` from immediate-apply to ledger-routed**

Find `grantLootRewardEntryToCharacter`'s existing `chaliceBonus` branch (~line 5552):
```js
if (entry.kind === "chaliceBonus") {
  var bonus = entry.value || 0;
  c.flaskMax = (c.flaskMax || FLASK_MAX_DEFAULT) + bonus;
  c.flaskCount = (c.flaskCount || 0) + bonus;
  return window.I18N.t("midnight_reward_label_chalice_bonus", { value: bonus });
}
```
This function is fine as-is (it already applies immediately when *called*) — the design change is about *when* it's called: it must go through the pending-reward-modal flow (like `rune`/`talisman`/`weapon` kill rewards) instead of being auto-applied the instant the floor's loot is granted. Since `chaliceBonus` currently comes from `maybeGrantFieldTileReward` → `grantTileLootToParticipants` (immediate), change that specific kind to instead be pushed via `pushPendingReward` per participant so it shows in the reward-list modal:

In `maybeGrantFieldTileReward` (as rewritten in Task 14 Step 3), before the `grantTileLootToParticipants(trig, perPerson)` call, split out `chaliceBonus`:
```js
var chaliceEntries = perPerson.filter(function (e) { return e.kind === "chaliceBonus"; });
var immediateEntries = perPerson.filter(function (e) { return e.kind !== "chaliceBonus"; });
if (immediateEntries.length) { grantTileLootToParticipants(trig, immediateEntries); pushPerPlayerReward(pt.id, immediateEntries); }
chaliceEntries.forEach(function (e) {
  Object.keys(trig.participants || {}).forEach(function (slot) {
    var p = players[slot];
    if (p) pushPendingReward(p.tokenId, e);
  });
});
```
Add a label for the reward-list rendering: `rewardEntryLabel()` and `computeRewardDraw()` (~line 5701/5714) need a `chaliceBonus` case:
```js
// in rewardEntryLabel():
if (entry.kind === "chaliceBonus") return window.I18N.t("midnight_reward_kind_chalice_bonus");
// in computeRewardDraw():
if (entry.kind === "chaliceBonus") {
  var bonusVal = entry.value || 0;
  return {
    label: window.I18N.t("midnight_reward_label_chalice_bonus", { value: bonusVal }),
    apply: function (c) {
      c.flaskMax = (c.flaskMax || FLASK_MAX_DEFAULT) + bonusVal;
      c.flaskCount = (c.flaskCount || 0) + bonusVal;
    },
  };
}
```

- [ ] **Step 2: i18n key**

```python
"midnight_reward_kind_chalice_bonus": "聖杯瓶上限",
```

- [ ] **Step 3: Manual verification**

Clear `card_k`'s floor 1 (has the `chaliceBonus` reward per earlier research), confirm it now shows up in the reward-list modal requiring a manual "領取" click instead of applying instantly.

- [ ] **Step 4: Commit**

```bash
git add static_src/midnight.js site_src/i18n_data_zh.py site_src/i18n_data_ja.py site_src/i18n_data_en.py
git commit -m "feat(midnight): 教會聖杯瓶上限獎勵改走獎勵清單"
```

---

### Task 17: Merchant forge cost → smithing stones (design §6)

**Files:**
- Modify: `static_src/midnight.js`

- [ ] **Step 1: Add count/consume helpers, replace rune-cost constant**

Find the `MERCHANT_FORGE_COST_RUNES` declaration and remove it. Add near `characterHasConsumable`:
```js
function smithingStoneCount(c) {
  var inst = c && (c.consumables || []).filter(function (i) { return i.itemId === "item_smithing_stone"; })[0];
  return inst ? inst.usesRemaining || 0 : 0;
}
function consumeSmithingStones(c, n) {
  var inst = (c.consumables || []).filter(function (i) { return i.itemId === "item_smithing_stone"; })[0];
  if (!inst || inst.usesRemaining < n) return false;
  inst.usesRemaining -= n;
  if (inst.usesRemaining <= 0) {
    c.consumables = c.consumables.filter(function (i) { return i !== inst; });
  }
  return true;
}
var FORGE_COST_C_TO_U = 1;
var FORGE_COST_U_TO_R = 2;
function forgeCostForRarity(rarity) {
  return rarity === "C" ? FORGE_COST_C_TO_U : rarity === "U" ? FORGE_COST_U_TO_R : null;
}
```

- [ ] **Step 2: Rewrite `renderMerchantForgeList`/`handleMerchantForgeWeapon`**

Find `renderMerchantForgeList` (~line 5372). Replace the rune-cost display/gating with smithing-stone cost:
```js
function renderMerchantForgeList() {
  var container = el("midnight-merchant-forge-list");
  container.innerHTML = "";
  var c = characters[myTokenId];
  var heldStones = smithingStoneCount(c);
  el("midnight-merchant-forge-stone-note").textContent = window.I18N.t("midnight_merchant_forge_stone_note", { count: heldStones });
  if (!heldStones) {
    container.textContent = window.I18N.t("midnight_merchant_forge_need_stone_note");
    return;
  }
  var ids = (c && c.weaponIds) || [];
  if (!ids.length) {
    container.textContent = window.I18N.t("midnight_merchant_forge_empty_note");
    return;
  }
  var CD = window.PriTestCharacterDrawer;
  var Weapons = window.PriTestWeapons;
  ids.forEach(function (weaponId) {
    var weapon = Weapons.get(baseCatalogId(weaponId));
    if (!weapon) return;
    var rarity = CD.getEffectiveWeaponRarity(c, weaponId);
    var name = Weapons.localizedText(weapon.name);
    var btn = document.createElement("button");
    btn.type = "button";
    if (!CD.canUpgradeWeaponRarity(c, weaponId)) {
      btn.textContent = window.I18N.t("midnight_merchant_forge_max_note", { name: name, rarity: rarity });
      btn.disabled = true;
    } else {
      var cost = forgeCostForRarity(rarity);
      btn.textContent = window.I18N.t("midnight_merchant_forge_weapon_button", { name: name, rarity: rarity, cost: cost });
      btn.disabled = heldStones < cost;
      btn.addEventListener("click", function () {
        handleMerchantForgeWeapon(weaponId);
      });
    }
    container.appendChild(btn);
  });
}

function handleMerchantForgeWeapon(weaponId) {
  var c = characters[myTokenId];
  var CD = window.PriTestCharacterDrawer;
  var rarity = CD.getEffectiveWeaponRarity(c, weaponId);
  var cost = forgeCostForRarity(rarity);
  if (!c || !cost || !consumeSmithingStones(c, cost)) return;
  if (!CD.upgradeWeaponRarity(c, weaponId)) return;
  GameStorage.rtSet(gameId, "cloud", "character/" + myTokenId, c);
  var weapon = window.PriTestWeapons.get(baseCatalogId(weaponId));
  el("midnight-merchant-forge-result").textContent = window.I18N.t("midnight_merchant_forge_result", {
    name: weapon ? window.PriTestWeapons.localizedText(weapon.name) : weaponId,
    rarity: CD.getEffectiveWeaponRarity(c, weaponId),
  });
  renderMerchantForgeList();
}
```

- [ ] **Step 2: Remove the now-unused `characterHasConsumable(c, "item_smithing_stone")` guard in the old `renderMerchantForgeList`** — already replaced above by `heldStones` check.

- [ ] **Step 3: DOM + i18n**

Add `<p id="midnight-merchant-forge-stone-note"></p>` near the forge list in `site_src/midnight_page.py` (replacing whatever previously showed the rune note there, if any — check existing markup around `midnight-merchant-forge-list` first).
```python
"midnight_merchant_forge_stone_note": "持有鍛造石：{count}",
```
Update the existing `midnight_merchant_forge_weapon_button` key's `{cost}` semantics stay the same (still a count) — verify its current translated text doesn't say "盧恩" explicitly; if it does, edit it in all 3 files to say "鍛造石" instead.

- [ ] **Step 4: Manual verification**

Give a test character 1 `item_smithing_stone`, confirm a C-rarity weapon can upgrade to U (consumes the 1 stone, none left), confirm a U-rarity weapon now shows disabled (needs 2, has 0); grant 2 more stones, confirm U→R works and consumes exactly 2.

- [ ] **Step 5: Commit**

```bash
git add static_src/midnight.js site_src/midnight_page.py site_src/i18n_data_zh.py site_src/i18n_data_ja.py site_src/i18n_data_en.py
git commit -m "feat(midnight): 商人鍛冶合費用改為消耗鍛造石(C->U:1,U->R:2)"
```

---

### Task 18: Strong-enemy "⑧恐るべき強敵" on Day2 (design §7)

**Files:**
- Modify: `static_src/midnight.js`

- [ ] **Step 1: New constants + point selection**

Add near `STRONG_ENEMY_REWARD_RUNES`:
```js
var TERRIFYING_STRONG_ENEMY_REWARD_RUNES = 12;
var TERRIFYING_STRONG_ENEMY_REWARD_POTENTIAL_STARS = 3;
```

Add a function that picks the Day2 terrifying point once, called from the existing per-frame update loop (wherever `updateNearbyChipPoint` or the day-transition detection already runs — hook it into the same place `updateAutoDayAdvance()` transitions to day 2):
```js
function maybeAssignTerrifyingStrongEnemyPoint() {
  if (!meta || meta.terrifyingStrongEnemyPointId !== undefined) return; // 已決定過(含null)就不重決定
  if (currentDayNumber() < 2) return; // 假設既有currentDayNumber()/等價函式可用，確認實際函式名稱
  var candidates = map.points.filter(function (pt) {
    if (pt.type !== "strong_enemy") return false;
    var trig = fieldTriggers[pt.id];
    var hp = fieldEnemyHp[pt.id];
    var alreadyDefeated = trig && trig.enemyFamilyId && hp !== undefined && hp <= 0;
    return !alreadyDefeated;
  });
  var chosenId = candidates.length ? candidates[fieldSeededIndex("day2_terrifying_strong_enemy", candidates.length)].id : null;
  GameStorage.rtTransaction(gameId, "cloud", "meta/terrifyingStrongEnemyPointId", function (cur) {
    return cur === undefined || cur === null ? (chosenId || null) : cur;
  });
}
```

**Note:** confirm the actual existing day-tracking accessor (grep for `dayNumber`/`currentDay` in `midnight.js` — the file tracks days via `currentPhaseInfo(now).stage` transitions like `waitingForDay2`/`waitingForDay3`, not a simple `dayNumber` field; wire this call into whatever function already detects "we have just entered Day2" — likely inside `updateAutoDayAdvance()` — rather than inventing a new day-counter).

- [ ] **Step 2: Branch `rollAndAssignStrongEnemy` and `maybeGrantStrongEnemyReward`**

Find `rollAndAssignStrongEnemy` (~line 4536). Change the table selection:
```js
var isTerrifying = meta && meta.terrifyingStrongEnemyPointId === pt.id;
var table = chip && chip.extraTables && chip.extraTables[isTerrifying ? 1 : 0];
```
Find `maybeGrantStrongEnemyReward` (~line 5200). Change the fixed reward constants to branch:
```js
var isTerrifying = meta && meta.terrifyingStrongEnemyPointId === pt.id;
var runes = isTerrifying ? TERRIFYING_STRONG_ENEMY_REWARD_RUNES : STRONG_ENEMY_REWARD_RUNES;
var stars = isTerrifying ? TERRIFYING_STRONG_ENEMY_REWARD_POTENTIAL_STARS : STRONG_ENEMY_REWARD_POTENTIAL_STARS;
```
and use `runes`/`stars` in place of the constants in the `pushPendingReward` calls that follow.

- [ ] **Step 3: `node --check`, manual verification**

With a fixed `mapSeed`, defeat 1 of the 3 strong-enemy points on Day1, advance to Day2, confirm the terrifying point is chosen only from the 2 remaining (never the already-defeated one), confirm that point's table/rewards use the higher values, confirm the other point keeps normal values.

- [ ] **Step 4: Commit**

```bash
git add static_src/midnight.js
git commit -m "feat(midnight): Day2強敵籌碼新增⑧恐るべき強敵(高倍表與獎勵)"
```

---

### Task 19: `midnight_random_events.js` — pure data/logic for the 10 branches (design §8)

**Files:**
- Create: `static_src/midnight_random_events.js`
- Modify: `generate.py`, `site_src/midnight_page.py`

**Interfaces:**
- Produces: `window.PriTestMidnightRandomEvents = { rollChestTable, rollAmbushTable, insectSwarmSteps, madnessZoneSteps }`.

- [ ] **Step 1: Write the file**

```js
// ============================================================================
// midnight（即時制擴張版）隨機事件籌碼：10分支中需要獨立子表/多步驟資料的部分，抽成純函式，
// 不含RTDB/DOM——避免把midnight.js塞得更肥。2026-09-07新增(設計文件§8)。
// ============================================================================
(function () {
  "use strict";

  // ---- 埋もれ宝「チェスト内容決定表」（event_rulebook.js extraTables[1]，1D）----
  var CHEST_TABLE = [
    { faces: [1], kind: "smithingStone" },
    { faces: [2], kind: "stoneswordKey" },
    { faces: [3], kind: "consumable" },
    { faces: [4, 5], kind: "weaponStar", value: 2 },
    { faces: [6], kind: "weaponStar", value: 3 },
  ];
  function rollChestTable() {
    var roll = 1 + Math.floor(Math.random() * 6);
    var row = CHEST_TABLE.filter(function (r) { return r.faces.indexOf(roll) !== -1; })[0];
    return { roll: roll, kind: row.kind, value: row.value };
  }
  function rollChestTableThreeTimes() {
    var out = [];
    for (var i = 0; i < 3; i++) out.push(rollChestTable());
    return out;
  }

  // ---- 襲擊事件決定表（event_rulebook.js extraTables[2]，1D，各自劇本限定）----
  var AMBUSH_TABLE = [
    { faces: [1], nameJa: "忌み鬼", scenarios: [2, 3, 9, 10] },
    { faces: [2], nameJa: "兆し", scenarios: [3, 7, 9, 10] },
    { faces: [3], nameJa: "調律の魔物", scenarios: [6, 7, 9, 10] },
    { faces: [4], nameJa: "三つ首の獣", scenarios: [8, 9] },
    { faces: [5], nameJa: "霧の裂け目", scenarios: [8, 9] },
    { faces: [6], nameJa: "安寧者たち", scenarios: [9] },
  ];
  function rollAmbushTable(scenarioNumber) {
    for (var attempt = 0; attempt < 30; attempt++) {
      var roll = 1 + Math.floor(Math.random() * 6);
      var row = AMBUSH_TABLE.filter(function (r) { return r.faces.indexOf(roll) !== -1; })[0];
      if (row.scenarios.indexOf(scenarioNumber) !== -1) return { roll: roll, nameJa: row.nameJa };
    }
    return null; // 30次都不符合劇本限定，放棄不硬湊
  }

  // ---- 虫の大量発生／蟻の大量発生：多步驟資料（純敘述/判定描述，midnight.js負責流程與RTDB）----
  var INSECT_SWARM_STEPS = {
    groundBugs: { checkTarget: 12, statKey: "any", failRuneLoss: 10 },
    chaseBug: { checkTarget: 12, successNeedMajority: true },
    bounty: { runeReward: 3, knowledgeGatherDie: 1, knowledgeGatherFace: 1 },
  };

  // ---- 発狂地帯：多步驟資料 ----
  var MADNESS_ZONE_STEPS = {
    madFire1: { checkTarget: 12, successMadness: "2D", failMadness: "3D" },
    tower2: { checkTarget: 12, successMadness: "2D", failMadness: "3D" },
    tower3: { checks: [{ stat: "luck", target: 11 }, { stat: "physical", target: 11 }, { stat: "mental", target: 11 }] },
  };

  window.PriTestMidnightRandomEvents = {
    rollChestTable: rollChestTable,
    rollChestTableThreeTimes: rollChestTableThreeTimes,
    rollAmbushTable: rollAmbushTable,
    insectSwarmSteps: INSECT_SWARM_STEPS,
    madnessZoneSteps: MADNESS_ZONE_STEPS,
  };
})();
```

- [ ] **Step 2: Verify with a throwaway script**

```js
var vm = require("vm"), fs = require("fs");
var sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync("static_src/midnight_random_events.js", "utf8"), sandbox);
var R = sandbox.window.PriTestMidnightRandomEvents;
for (var i = 0; i < 100; i++) {
  var chest = R.rollChestTable();
  console.assert(["smithingStone", "stoneswordKey", "consumable", "weaponStar"].indexOf(chest.kind) !== -1, "chest kind valid");
  var ambush = R.rollAmbushTable(9); // 劇本9符合全部6項
  console.assert(ambush !== null, "scenario 9 always resolves (all 6 rows include it)");
  var ambushNone = R.rollAmbushTable(1); // 劇本1不符合任何一項
  console.assert(ambushNone === null, "scenario 1 never resolves (no row includes it)");
}
console.log("OK");
```
Run: `node scratch_events_check.js` — expect `OK` (the scenario-1 assertion will only reliably show `null` across the 30-attempt reroll cap — run this a few times manually if flaky, since it's probabilistic; the important invariant is it never picks a row whose `scenarios` doesn't include 1). Delete the script after.

- [ ] **Step 3: Register the file**

`generate.py`: add `"midnight_random_events.js"` before `"midnight_map.js"`.
`site_src/midnight_page.py` `extra_scripts`: same placement.

- [ ] **Step 4: Commit**

```bash
git add static_src/midnight_random_events.js generate.py site_src/midnight_page.py
git commit -m "feat(midnight): 新增midnight_random_events.js(埋もれ宝/襲擊決定表等純資料)"
```

---

### Task 20: Random-event decision + simple branches (聖甲蟲替換／女神像／埋もれ宝／隕石) (design §8.1-8.2)

**Files:**
- Modify: `static_src/midnight.js`

**Interfaces:**
- Consumes: `rollRandomEventTable` (`night_gm_flow.js`, existing), `window.PriTestMidnightRandomEvents.rollChestTableThreeTimes` (Task 19), `scanLinesForEnemyMatches`/`maybeAssignFieldEnemy` (existing).

- [ ] **Step 1: `rollAndAssignRandomEvent`**

```js
// 隨機事件籌碼決定（設計文件§8.1）：跟rollAndAssignStrongEnemy同款寫法。「霊鷹の止まり木」
// 依規格直接替換成聖甲蟲，不走場地移動機制。
var randomEventRollAttempted = {};
function rollAndAssignRandomEvent(pt) {
  if (randomEventRollAttempted[pt.id] || fieldTriggers[pt.id]) return;
  randomEventRollAttempted[pt.id] = true;
  var GmFlow = window.PriTestNightGmFlow;
  var chip = findEventChip("random_event");
  var table = chip && chip.extraTables && chip.extraTables[0];
  var scenarioId = resolveNightBossScenarioId();
  var scenarioNumber = scenarioId ? window.PriTestScenarios.numberForId(scenarioId) : null;
  if (!GmFlow || !table) return;
  var rolled = GmFlow.rollRandomEventTable(table, scenarioNumber);
  if (!rolled) return;
  var branchName = rolled.name; // 確認rollRandomEventTable()實際回傳欄位名稱(可能是.name/.entry.ja等)，實作時核對night_gm_flow.js:1667附近程式碼調整
  if (branchName === "霊鷹の止まり木") branchName = "スカラベ";
  GameStorage.rtTransaction(gameId, "cloud", "fieldTrigger/" + pt.id, function (cur) {
    if (cur !== null) return cur;
    return { status: "resolved", branchNameJa: branchName, participants: {}, resolvedAt: Date.now() };
  });
}
```

**Note:** `rollRandomEventTable`'s exact return shape must be confirmed by reading `night_gm_flow.js:1667` before finalizing `rolled.name` — adjust to whatever field actually holds the resolved branch's Japanese name.

- [ ] **Step 2: Dispatch table + 聖甲蟲 alias / 女神像 / 埋もれ宝 / 隕石**

Extend `updateNearbyChipPoint()`'s `random_event` handling (currently just sets `nearbyRandomEvent` and calls `renderScarabOverlay()`) to call `rollAndAssignRandomEvent` and dispatch based on the resolved `branchNameJa`:
```js
nearbyRandomEvent = randomEvent;
if (randomEvent) rollAndAssignRandomEvent(randomEvent);
renderRandomEventOverlay(); // replaces renderScarabOverlay(), dispatches by branch
```
```js
function renderRandomEventOverlay() {
  var pt = nearbyRandomEvent;
  var trig = pt && fieldTriggers[pt.id];
  if (!pt || !trig || !trig.branchNameJa) { el("midnight-scarab-banner").hidden = true; return; }
  var RENDERERS = {
    "スカラベ": renderScarabBranch,
    "女神像": renderGoddessStatueBranch,
    "埋もれ宝": renderBuriedTreasureBranch,
    "隕石": renderMeteorBranch,
    "歩く霊廟": renderWalkingMausoleumBranch, // Task 21
    "夜の勢力": renderNightForceBranch, // Task 21
    "虫の大量発生": renderInsectSwarmBranch, // Task 21
    "発狂地帯": renderMadnessZoneBranch, // Task 21
    "襲撃": renderAmbushBranch, // Task 21
  };
  var renderer = RENDERERS[trig.branchNameJa];
  if (renderer) renderer(pt, trig);
}

function renderScarabBranch(pt, trig) {
  // 沿用現有renderScarabOverlay()／handleScarabCheckClick()全部邏輯，原樣呼叫。
  renderScarabOverlay();
}

function renderGoddessStatueBranch(pt, trig) {
  var banner = el("midnight-random-event-banner");
  banner.hidden = false;
  el("midnight-random-event-text").textContent = window.I18N.t("midnight_random_event_goddess_desc");
  var attempted = trig.attempted && trig.attempted[mySlot];
  el("midnight-random-event-action").hidden = !!attempted;
  el("midnight-random-event-action").onclick = function () { handleGoddessStatueCheckClick(pt); };
}
function handleGoddessStatueCheckClick(pt) {
  if (!mySlot || isPaused()) return;
  GameStorage.rtSet(gameId, "cloud", "fieldTrigger/" + pt.id + "/attempted/" + mySlot, true);
  var c = characters[myTokenId];
  var type = c && c.typeId ? window.PriTestCharacterTypes.get(c.typeId) : null;
  var diceCount = type && type.checkValues ? type.checkValues.mental || 0 : 0;
  var sum = 0;
  for (var i = 0; i < diceCount; i++) sum += 1 + Math.floor(Math.random() * 6);
  if (sum >= 10) {
    GameStorage.rtSet(gameId, "cloud", "fieldTrigger/" + pt.id + "/goddessSucceeded", true);
  }
  el("midnight-random-event-result").textContent = window.I18N.t(sum >= 10 ? "midnight_random_event_success_note" : "midnight_random_event_fail_note");
  var restrictedTypes = ["tracker", "tracker_dark", "ruffian", "ruffian_dark", "guardian", "guardian_dawn", "executor", "executor_dark"]; // 追跡者/無頼漢/守護者/執行者(含變體)——確認character_types.js實際typeId清單再調整
  if (sum >= 10 && restrictedTypes.indexOf(c.typeId) !== -1) {
    pushPerPlayerReward(pt.id, [{ kind: "consumable", itemId: "item_smithing_stone", value: 3, perPerson: true }]); // 鍊石×3
  }
}

function renderBuriedTreasureBranch(pt, trig) {
  var banner = el("midnight-random-event-banner");
  banner.hidden = false;
  el("midnight-random-event-text").textContent = window.I18N.t("midnight_random_event_buried_treasure_desc");
  el("midnight-random-event-action").hidden = !!trig.resolvedOutcome;
  el("midnight-random-event-action").onclick = function () { handleBuriedTreasureCheckClick(pt); };
}
function handleBuriedTreasureCheckClick(pt) {
  if (!mySlot || isPaused()) return;
  var trig = fieldTriggers[pt.id];
  var target = 12 * participantSlots(trig).length;
  var sum = teamCheckSum(trig, "luck"); // 見Task 21的通用協力判定helper——此task先inline一份最小版本
  GameStorage.rtTransaction(gameId, "cloud", "fieldTrigger/" + pt.id, function (cur) {
    if (!cur || cur.resolvedOutcome) return cur;
    var out = {}; for (var k in cur) out[k] = cur[k];
    out.resolvedOutcome = sum >= target ? "success" : "fail";
    return out;
  }).then(function () {
    if (sum >= target) {
      var entries = window.PriTestMidnightRandomEvents.rollChestTableThreeTimes().map(function (row) {
        return { kind: row.kind, value: row.value, perPerson: false }; // 寶箱內容給隊伍共享，走共享池
      });
      entries.forEach(function (e) { pushSharedReward(pt.id, e); });
    }
  });
}

function renderMeteorBranch(pt, trig) {
  // 描寫後(→隕石)/遠離二選一，沿用§1.3投票機制：構造一個假floor物件餵給既有pipeline。
  var banner = el("midnight-random-event-banner");
  banner.hidden = false;
  el("midnight-random-event-text").textContent = window.I18N.t("midnight_random_event_meteor_desc");
  if (!trig.meteorChoice) {
    el("midnight-random-event-choice-a").hidden = false;
    el("midnight-random-event-choice-a").onclick = function () {
      GameStorage.rtSet(gameId, "cloud", "fieldTrigger/" + pt.id + "/meteorChoice", "go");
    };
    el("midnight-random-event-choice-b").hidden = false;
    el("midnight-random-event-choice-b").onclick = function () {
      GameStorage.rtSet(gameId, "cloud", "fieldTrigger/" + pt.id + "/meteorChoice", "flee");
    };
    return;
  }
  el("midnight-random-event-choice-a").hidden = true;
  el("midnight-random-event-choice-b").hidden = true;
  if (trig.meteorChoice !== "go" || trig.enemyFamilyId || meteorEnemyAssignAttempted[pt.id]) return;
  meteorEnemyAssignAttempted[pt.id] = true;
  var GmFlow = window.PriTestNightGmFlow;
  var match = GmFlow.resolveCombatEnemyMatch("降る星の成獣");
  if (!match) return;
  GameStorage.rtTransaction(gameId, "cloud", "fieldTrigger/" + pt.id + "/enemyFamilyId", function (cur) { return cur === null ? match.familyId : cur; });
  GameStorage.rtTransaction(gameId, "cloud", "fieldTrigger/" + pt.id + "/enemyId", function (cur) { return cur === null ? match.enemy.id : cur; });
  GameStorage.rtTransaction(gameId, "cloud", "fieldTrigger/" + pt.id + "/level", function (cur) { return cur === null ? 8 : cur; });
  GameStorage.rtTransaction(gameId, "cloud", "fieldEnemyHp/" + pt.id, function (cur) {
    return cur === null ? enemyRealHpMax({ enemyFamilyId: match.familyId, enemyId: match.enemy.id, level: 8 }) : cur;
  });
}
var meteorEnemyAssignAttempted = {};
```

**Note:** `teamCheckSum` is referenced but not yet defined — Task 21 introduces the shared "協力判定" helper (`teamCheckSum(trig, statKey)`, summing every participant's dice per `parseBreakthroughCheckText`-style target); if Task 21 is done after this task in execution order, add a minimal local version here first and have Task 21 replace it with the shared one (do not leave this task broken pending a later task — write the minimal version now):
```js
function teamCheckSum(trig, statKey) {
  var sum = 0;
  participantSlots(trig).forEach(function (slot) {
    var p = players[slot];
    var c = p && characters[p.tokenId];
    var type = c && c.typeId ? window.PriTestCharacterTypes.get(c.typeId) : null;
    var diceCount = type && type.checkValues ? type.checkValues[statKey] || 0 : 0;
    for (var i = 0; i < diceCount; i++) sum += 1 + Math.floor(Math.random() * 6);
  });
  return sum;
}
```

- [ ] **Step 2: Reward-granting for meteor's boss defeat**

The meteor boss defeat reward (潛在力量★★★★, per-person) needs the same "撃破 → grant" pattern as `maybeGrantStrongEnemyReward` — add an equivalent `maybeGrantMeteorReward(pt)` called from the per-frame loop, mirroring that function's structure but pushing `{ kind: "potentialPower", value: 4, perPerson: true }` via `pushPerPlayerReward`.

- [ ] **Step 3: DOM + i18n**

Add `#midnight-random-event-banner` / `-text` / `-action` / `-result` / `-choice-a` / `-choice-b` to `site_src/midnight_page.py` near the existing `#midnight-scarab-banner` markup (can reuse/rename the existing scarab banner elements rather than duplicating — the scarab renderer in Step 1 already just calls the existing `renderScarabOverlay()`, so keep `#midnight-scarab-banner` for that branch and add the new generic banner alongside for the other branches, OR unify both under the new generic ids and update `renderScarabOverlay()`'s element references to match — pick whichever requires touching fewer existing working call sites; recommend keeping `#midnight-scarab-banner` untouched and adding the new `#midnight-random-event-banner` purely for the other 8 branches).
i18n keys (zh/ja/en) — `midnight_random_event_goddess_desc`, `midnight_random_event_success_note`, `midnight_random_event_fail_note`, `midnight_random_event_buried_treasure_desc`, `midnight_random_event_meteor_desc`, plus button labels for the choice buttons.

- [ ] **Step 4: Manual verification**

With a fixed seed/scenario combination known to resolve to each of these 4 branches (determine via repeated console calls to `rollRandomEventTable` with a forced scenario number, or by temporarily forcing `branchNameJa` via console for testing), verify: scarab still works exactly as before; goddess statue grants smithing-stone×3 only to eligible classes; buried treasure rolls 3 chest items into the shared pool; meteor shows the 2-choice prompt and only assigns the boss on "go".

- [ ] **Step 5: Commit**

```bash
git add static_src/midnight.js site_src/midnight_page.py site_src/i18n_data_zh.py site_src/i18n_data_ja.py site_src/i18n_data_en.py
git commit -m "feat(midnight): 隨機事件決定機制+聖甲蟲替換/女神像/埋もれ宝/隕石4分支"
```

---

### Task 21: Remaining random-event branches (歩く霊廟／夜の勢力／虫の大量発生／発狂地帯) (design §8.2)

**Files:**
- Modify: `static_src/midnight.js`

**Interfaces:**
- Consumes: `teamCheckSum` (introduced in Task 20, promote to the canonical shared helper here — remove any duplicate), `window.PriTestMidnightRandomEvents.insectSwarmSteps`/`madnessZoneSteps` (Task 19), existing `ATTRIBUTE_STATUS_AILMENT_NAMES_JA`/ailment-accumulation helpers (grep for the existing function that applies ailment dice to a character, likely something like `applyAttributeStatusToCharacter` or similar — confirm exact name before use).

- [ ] **Step 1: 歩く霊廟**

```js
function renderWalkingMausoleumBranch(pt, trig) {
  var banner = el("midnight-random-event-banner");
  banner.hidden = false;
  el("midnight-random-event-text").textContent = window.I18N.t("midnight_random_event_mausoleum_desc");
  el("midnight-random-event-action").hidden = !!(trig.attempted && trig.attempted[mySlot]);
  el("midnight-random-event-action").onclick = function () { handleMausoleumCheckClick(pt); };
}
function handleMausoleumCheckClick(pt) {
  if (!mySlot || isPaused()) return;
  GameStorage.rtSet(gameId, "cloud", "fieldTrigger/" + pt.id + "/attempted/" + mySlot, true);
  var c = characters[myTokenId];
  var type = c && c.typeId ? window.PriTestCharacterTypes.get(c.typeId) : null;
  var diceCount = type && type.checkValues ? type.checkValues.physical || 0 : 0;
  var sum = 0;
  for (var i = 0; i < diceCount; i++) sum += 1 + Math.floor(Math.random() * 6);
  var success = sum >= 11;
  if (!success) {
    GameStorage.rtTransaction(gameId, "cloud", "demoStat/" + myTokenId, function (cur) {
      var max = selfArenaHpMax(c);
      return Math.max(0, (cur === null ? max : cur) - 20); // HP損害□□，□=10(既有慣例)
    });
  }
  if (c.weaponIds && c.weaponIds.length && hasInventorySpace(c, "weapon")) {
    var pickedId = c.weaponIds[Math.floor(Math.random() * c.weaponIds.length)];
    c.weaponIds.push(pickedId);
    GameStorage.rtSet(gameId, "cloud", "character/" + myTokenId, c);
  }
  el("midnight-random-event-result").textContent = window.I18N.t(success ? "midnight_random_event_success_note" : "midnight_random_event_fail_note");
}
```

- [ ] **Step 2: 夜の勢力（n連戦）**

```js
var NIGHT_FORCE_TABLE = [
  { faces: [1], nameJa: "ユビムシたち", level: 6, rounds: 3, mob: true },
  { faces: [2], nameJa: "巨大犬", level: 6, rounds: 3, mob: true },
  { faces: [3], nameJa: "幽鬼の従者たち", level: 6, rounds: 2, mob: true },
  { faces: [4], nameJa: "丘陵の飛竜", level: 5, rounds: 2, mob: false },
  { faces: [5], nameJa: "ガーディアン・ゴーレム", level: 5, rounds: 2, mob: false },
  { faces: [6], nameJa: "狂い火トロル", level: 3, rounds: 3, mob: true },
];
function renderNightForceBranch(pt, trig) {
  if (!trig.nightForceEnemyId) { rollAndAssignNightForceEnemy(pt); return; }
  var banner = el("midnight-random-event-banner");
  banner.hidden = false;
  el("midnight-random-event-text").textContent = window.I18N.t("midnight_random_event_night_force_desc", {
    completed: trig.completedRounds || 0, required: trig.requiredRounds,
  });
}
function rollAndAssignNightForceEnemy(pt) {
  var roll = 1 + Math.floor(Math.random() * 6);
  var row = NIGHT_FORCE_TABLE.filter(function (r) { return r.faces.indexOf(roll) !== -1; })[0];
  var GmFlow = window.PriTestNightGmFlow;
  var match = GmFlow.resolveCombatEnemyMatch(row.nameJa);
  if (!match) return;
  GameStorage.rtTransaction(gameId, "cloud", "fieldTrigger/" + pt.id, function (cur) {
    if (!cur || cur.nightForceEnemyId) return cur;
    var out = {}; for (var k in cur) out[k] = cur[k];
    out.nightForceEnemyId = match.enemy.id;
    out.enemyFamilyId = match.familyId;
    out.enemyId = match.enemy.id;
    out.level = row.level;
    out.requiredRounds = row.rounds;
    out.completedRounds = 0;
    return out;
  }).then(function () {
    GameStorage.rtTransaction(gameId, "cloud", "fieldEnemyHp/" + pt.id, function (cur) {
      return cur === null ? enemyRealHpMax({ enemyFamilyId: match.familyId, enemyId: match.enemy.id, level: row.level }) : cur;
    });
  });
}
// 每次擊敗檢查(掛在既有偵測敵人HP歸零的地方，例如onFieldEnemyHpReceived或每幀updateXXX
// 迴圈——確認既有night-boss/strong-enemy撃破偵測是怎麼hook進去的，抄同一個掛勾點)：
function maybeAdvanceNightForceRound(pt) {
  var trig = fieldTriggers[pt.id];
  if (!trig || !trig.nightForceEnemyId) return;
  var hp = fieldEnemyHp[pt.id];
  if (hp === undefined || hp > 0) return;
  var completed = (trig.completedRounds || 0) + 1;
  if (completed >= trig.requiredRounds) {
    GameStorage.rtTransaction(gameId, "cloud", "fieldTrigger/" + pt.id + "/completedRounds", function (cur) {
      return cur === null || cur < trig.requiredRounds ? completed : cur;
    }).then(function (committed) {
      if (committed !== completed) return;
      pushPerPlayerReward(pt.id, [{ kind: "potentialPower", value: 2, perPerson: true }]);
      Object.keys(trig.participants || {}).forEach(function (slot) {
        var p = players[slot];
        var c = p && characters[p.tokenId];
        if (c) {
          c._nightBlessing = true; // 設計文件§9-1：技能冷卻改用祝福重置
          skillCooldownUntil[p.tokenId] = 0; // 立即恢復可用(確認實際冷卻追蹤變數名稱，比照既有ART_COOLDOWN_MS/SKILL_COOLDOWN_MS用法調整)
          GameStorage.rtSet(gameId, "cloud", "character/" + p.tokenId, c);
        }
      });
    });
  } else {
    GameStorage.rtTransaction(gameId, "cloud", "fieldTrigger/" + pt.id + "/completedRounds", function (cur) {
      return cur === null || cur < completed ? completed : cur;
    }).then(function () {
      GameStorage.rtSet(gameId, "cloud", "fieldEnemyHp/" + pt.id, enemyRealHpMax({
        enemyFamilyId: trig.enemyFamilyId, enemyId: trig.enemyId, level: trig.level,
      }));
    });
  }
}
```

**Note:** `skillCooldownUntil` is a guess at the existing per-character skill-cooldown tracking variable name — grep `SKILL_COOLDOWN_MS` usage in `midnight.js` to find the actual variable/map holding each character's next-available timestamp and use that instead.

- [ ] **Step 3: 虫の大量発生（蟻の大量発生）**

```js
function renderInsectSwarmBranch(pt, trig) {
  var steps = window.PriTestMidnightRandomEvents.insectSwarmSteps;
  var banner = el("midnight-random-event-banner");
  banner.hidden = false;
  if (!trig.groundBugsOutcome) {
    el("midnight-random-event-text").textContent = window.I18N.t("midnight_random_event_insect_ground_desc");
    el("midnight-random-event-action").hidden = !!(trig.attempted && trig.attempted[mySlot]);
    el("midnight-random-event-action").onclick = function () { handleInsectGroundCheckClick(pt); };
    return;
  }
  if (!trig.chaseOutcome) {
    el("midnight-random-event-text").textContent = window.I18N.t("midnight_random_event_insect_chase_desc");
    el("midnight-random-event-action").hidden = !!(trig.chaseAttempted && trig.chaseAttempted[mySlot]);
    el("midnight-random-event-action").onclick = function () { handleInsectChaseCheckClick(pt); };
    return;
  }
  el("midnight-random-event-text").textContent = window.I18N.t(
    trig.chaseOutcome === "success" ? "midnight_random_event_insect_bounty_note" : "midnight_random_event_insect_fail_note"
  );
  el("midnight-random-event-action").hidden = true;
}
function handleInsectGroundCheckClick(pt) {
  if (!mySlot || isPaused()) return;
  GameStorage.rtSet(gameId, "cloud", "fieldTrigger/" + pt.id + "/attempted/" + mySlot, true);
  var c = characters[myTokenId];
  var type = c && c.typeId ? window.PriTestCharacterTypes.get(c.typeId) : null;
  var diceCount = type && type.checkValues ? type.checkValues.luck || 0 : 0;
  var sum = 0;
  for (var i = 0; i < diceCount; i++) sum += 1 + Math.floor(Math.random() * 6);
  if (sum < 12) {
    var lost = Math.min(c.runes || 0, 10);
    c.runes = (c.runes || 0) - lost;
    GameStorage.rtSet(gameId, "cloud", "character/" + myTokenId + "/runes", c.runes);
    GameStorage.rtSet(gameId, "cloud", "fieldTrigger/" + pt.id + "/anyGroundFail", true);
  }
  GameStorage.rtTransaction(gameId, "cloud", "fieldTrigger/" + pt.id + "/groundBugsOutcome", function (cur) {
    return cur ? cur : "done"; // 全員嘗試過(不論成敗)才算完成這一步——用participants長度比對attempted計數，簡化為any-attempt即進下一步（因為原文「無論成敗」皆前進）
  });
}
function handleInsectChaseCheckClick(pt) {
  // 結構同上，statKey可選physical(HP損害□)或mental(FP損害□)，成敗記錄進chaseAttempted，
  // 半數以上成功比對用participantSlots(trig).length算多數；完成後寫chaseOutcome="success"/"fail"。
  // 略——同handleInsectGroundCheckClick的transaction/計票 pattern，實作時比照撰寫。
}
```

- [ ] **Step 4: 発狂地帯（直接用既有発狂蓄積機制）**

First find the existing ailment-accumulation call used for enemy attacks (grep `ATTRIBUTE_STATUS_AILMENT_NAMES_JA` usage sites in `midnight.js` to find the exact function name/signature that adds N dice worth of a named ailment to a character's accumulation bucket — the plan below calls it `applyAilmentDiceToCharacter(tokenId, ailmentNameJa, diceCount)`; rename every call site below to match whatever the real function is actually called before implementing):

```js
function renderMadnessZoneBranch(pt, trig) {
  var banner = el("midnight-random-event-banner");
  banner.hidden = false;
  var stage = trig.madnessStage || "madFire";
  if (stage === "madFire") {
    el("midnight-random-event-text").textContent = window.I18N.t("midnight_random_event_madness_fire_desc");
    el("midnight-random-event-action").hidden = !!(trig.attempted && trig.attempted[mySlot]);
    el("midnight-random-event-action").onclick = function () { handleMadnessCheckClick(pt, "madFire", "midnight_random_event_madness_tower1_desc"); };
  } else if (stage === "tower1") {
    el("midnight-random-event-text").textContent = window.I18N.t("midnight_random_event_madness_tower1_desc");
    el("midnight-random-event-choice-a").hidden = false; // 離開（需突破判定）
    el("midnight-random-event-choice-a").onclick = function () { handleMadnessTower1LeaveClick(pt); };
    el("midnight-random-event-choice-b").hidden = false; // 探索塔
    el("midnight-random-event-choice-b").onclick = function () {
      GameStorage.rtSet(gameId, "cloud", "fieldTrigger/" + pt.id + "/madnessStage", "tower2");
    };
  } else if (stage === "tower2") {
    el("midnight-random-event-text").textContent = window.I18N.t("midnight_random_event_madness_tower2_desc");
    el("midnight-random-event-action").hidden = !!(trig.tower2Attempted && trig.tower2Attempted[mySlot]);
    el("midnight-random-event-action").onclick = function () { handleMadnessCheckClick(pt, "tower2", "midnight_random_event_madness_tower3_desc"); };
  } else if (stage === "tower3") {
    el("midnight-random-event-text").textContent = window.I18N.t("midnight_random_event_madness_tower3_desc");
    el("midnight-random-event-action").hidden = !!trig.tower3Outcome;
    el("midnight-random-event-action").onclick = function () { handleMadnessTower3Click(pt); };
  } else {
    el("midnight-random-event-text").textContent = window.I18N.t("midnight_random_event_madness_done_note");
    el("midnight-random-event-action").hidden = true;
  }
}

// 狂い火／狂い火の塔2：PC各自12｜任選判定值，無論成敗都進下一段；成功發狂2D、失敗發狂3D。
// stage="madFire"用attempted、stage="tower2"用tower2Attempted當獨立的participant追蹤欄位
// （兩段各自算一次全員嘗試，不共用同一份attempted，避免互相誤判已完成）。
function handleMadnessCheckClick(pt, stage, nextStageKeyUnused) {
  if (!mySlot || isPaused()) return;
  var attemptField = stage === "madFire" ? "attempted" : "tower2Attempted";
  GameStorage.rtSet(gameId, "cloud", "fieldTrigger/" + pt.id + "/" + attemptField + "/" + mySlot, true);
  var c = characters[myTokenId];
  var type = c && c.typeId ? window.PriTestCharacterTypes.get(c.typeId) : null;
  var diceCount = type && type.checkValues ? (type.checkValues.physical || type.checkValues.mental || type.checkValues.luck || 0) : 0;
  var sum = 0;
  for (var i = 0; i < diceCount; i++) sum += 1 + Math.floor(Math.random() * 6);
  var success = sum >= 12;
  applyAilmentDiceToCharacter(myTokenId, "発狂", success ? 2 : 3);
  var trig = fieldTriggers[pt.id];
  var participants = participantSlots(trig);
  var attemptedMap = (trig[attemptField] || {});
  var allAttempted = participants.length > 0 && participants.every(function (slot) { return attemptedMap[slot] || slot === mySlot; });
  if (allAttempted) {
    var nextStage = stage === "madFire" ? "tower1" : "tower3";
    GameStorage.rtTransaction(gameId, "cloud", "fieldTrigger/" + pt.id + "/madnessStage", function (cur) {
      return cur ? cur : nextStage;
    });
  }
}

// 塔1「離開」：需突破判定，這裡沿用既有parseBreakthroughCheckText同款〈N|任選判定值〉判定，
// 成功→事件結束(madnessStage="ended")；失敗→除一般失敗效果外回到「狂い火」(madnessStage
// 設回"madFire"、清空attempted讓全員重新嘗試)。
function handleMadnessTower1LeaveClick(pt) {
  if (!mySlot || isPaused()) return;
  var c = characters[myTokenId];
  var type = c && c.typeId ? window.PriTestCharacterTypes.get(c.typeId) : null;
  var diceCount = type && type.checkValues ? type.checkValues.any || type.checkValues.luck || 0 : 0;
  var sum = 0;
  for (var i = 0; i < diceCount; i++) sum += 1 + Math.floor(Math.random() * 6);
  if (sum >= 12) {
    GameStorage.rtSet(gameId, "cloud", "fieldTrigger/" + pt.id + "/madnessStage", "ended");
  } else {
    GameStorage.rtSet(gameId, "cloud", "fieldTrigger/" + pt.id + "/madnessStage", "madFire");
    GameStorage.rtSet(gameId, "cloud", "fieldTrigger/" + pt.id + "/attempted", null);
  }
}

// 塔3：依序做3次協力判定(運試し/體能/精神，各11×PC人數)，記錄成功次數。
function handleMadnessTower3Click(pt) {
  if (!mySlot || isPaused()) return;
  var trig = fieldTriggers[pt.id];
  var target = 11 * participantSlots(trig).length;
  var successCount = 0;
  ["luck", "physical", "mental"].forEach(function (statKey) {
    if (teamCheckSum(trig, statKey) >= target) successCount++;
  });
  GameStorage.rtTransaction(gameId, "cloud", "fieldTrigger/" + pt.id, function (cur) {
    if (!cur || cur.tower3Outcome) return cur;
    var out = {}; for (var k in cur) out[k] = cur[k];
    out.tower3Outcome = successCount >= 2 ? "success2plus" : successCount === 1 ? "success1" : "allFail";
    out.madnessStage = "ended";
    return out;
  }).then(function () {
    var outcome = successCount >= 2 ? "success2plus" : successCount === 1 ? "success1" : "allFail";
    Object.keys(trig.participants || {}).forEach(function (slot) {
      var p = players[slot];
      var tokenId = p && p.tokenId;
      if (!tokenId) return;
      if (outcome === "success2plus") {
        pushPerPlayerReward(pt.id, [{ kind: "potentialPower", value: 2, perPerson: true }]);
        applyAilmentDiceToCharacter(tokenId, "発狂", 2);
      } else if (outcome === "success1") {
        pushPerPlayerReward(pt.id, [{ kind: "potentialPower", value: 2, perPerson: true }]);
        applyAilmentDiceToCharacter(tokenId, "発狂", 3);
      } else {
        applyAilmentDiceToCharacter(tokenId, "発狂", 3);
        // 「時間損耗：1」無對應資源，依既有簡化原則不套用（同§5全踏破效果的既有處理）。
      }
    });
  });
}
```

- [ ] **Step 5: DOM/i18n additions** for all of the above (banner text keys, action button labels) — same pattern as Task 20 Step 3.

- [ ] **Step 6: Manual verification**

Force each branch via console (temporarily set `trig.branchNameJa`), walk through every step of 夜の勢力 (confirm n-round loop actually re-fights), 虫の大量発生 (confirm rune loss/majority check), 発狂地帯 (confirm madness accumulates via the existing ailment UI).

- [ ] **Step 7: Commit**

```bash
git add static_src/midnight.js site_src/midnight_page.py site_src/i18n_data_zh.py site_src/i18n_data_ja.py site_src/i18n_data_en.py
git commit -m "feat(midnight): 隨機事件歩く霊廟/夜の勢力/虫の大量発生/発狂地帯4分支"
```

---

### Task 22: 襲擊 branch + 調律の魔物 bargain wiring (design §8.2)

**Files:**
- Modify: `static_src/midnight.js`

**Interfaces:**
- Consumes: `window.PriTestMidnightRandomEvents.rollAmbushTable` (Task 19), `openBargainRevealModal`/`BARGAIN_DEAL_EFFECTS` (Task 15).

- [ ] **Step 1: Roll + dispatch**

```js
function renderAmbushBranch(pt, trig) {
  if (!trig.ambushEnemyNameJa) {
    var scenarioId = resolveNightBossScenarioId();
    var scenarioNumber = scenarioId ? window.PriTestScenarios.numberForId(scenarioId) : null;
    var rolled = window.PriTestMidnightRandomEvents.rollAmbushTable(scenarioNumber);
    if (!rolled) return;
    GameStorage.rtTransaction(gameId, "cloud", "fieldTrigger/" + pt.id + "/ambushEnemyNameJa", function (cur) {
      return cur === null ? rolled.nameJa : cur;
    });
    return;
  }
  if (trig.ambushEnemyNameJa === "調律の魔物") {
    renderTuningDemonBranch(pt, trig);
    return;
  }
  // 其餘5種(忌み鬼/兆し/三つ首の獣/霧の裂け目/安寧者たち)：一律走王戰pipeline，敵名直接
  // 用ambushEnemyNameJa查resolveCombatEnemyMatch，撃破ルーン依各自原文個別數值(忌み鬼/兆し
  // 各6+L補正，其餘3種原文未在本次調查中完整轉錄——實作時需另外讀取event_rulebook.js該4種
  // 分支的完整原文，找出各自的撃破ルーン數值與恩寵效果，比照忌み鬼/兆し的既有寫法逐一補上，
  // 不得憑空假設數值)。
  if (!trig.enemyFamilyId) {
    var match = window.PriTestNightGmFlow.resolveCombatEnemyMatch(trig.ambushEnemyNameJa);
    if (!match) return;
    GameStorage.rtTransaction(gameId, "cloud", "fieldTrigger/" + pt.id + "/enemyFamilyId", function (cur) { return cur === null ? match.familyId : cur; });
    GameStorage.rtTransaction(gameId, "cloud", "fieldTrigger/" + pt.id + "/enemyId", function (cur) { return cur === null ? match.enemy.id : cur; });
    GameStorage.rtTransaction(gameId, "cloud", "fieldTrigger/" + pt.id + "/level", function (cur) { return cur === null ? 6 : cur; }); // 忌み鬼/兆し已確認Lv.6+L補正；其餘3種等級需實作時核對原文補上正確值
  }
}
```

- [ ] **Step 2: 調律の魔物 — 3-way choice (取引に応じる／立ち去る／戦いを仕掛ける) + reuse Task 15's bargain engine**

```js
var TUNING_DEMON_DEALS = [
  { title: "後に大成したい", good: "『夜之王』戰鬥時，自身「最大HP：+□□□」（midnight換算：打贏Day2夜之強敵、進入夜之王戰鬥時+30）", bad: "「最大FP：−□」與「最大加護：−□」（midnight換算：FP−10）" },
  { title: "全力で戦いたい", good: "自身「最大HP：+□」，並「任選威力補正：+5」（midnight換算：HP+10）", bad: "「夜之王」的所有HP行「最大HP：+□」，多PC累積（midnight換算：夜之王聚合HP池(未乘倍率)+20）" },
  // 剩餘deals(取引抽選表第4~6項)：本次調查未完整讀取event_rulebook.js原文，實作時需先讀取
  // 完整內容補上title/good/bad三個欄位，不得省略——參照第1、2項的既有格式與Task 15§9-2的
  // 換算原則(找不到明確midnight對應時，good/bad原樣照抄規則書原文，交由BARGAIN_DEAL_EFFECTS
  // 找不到對應key時的既有fallback：manual note顯示，不阻塞流程)。
];
function renderTuningDemonBranch(pt, trig) {
  var banner = el("midnight-random-event-banner");
  banner.hidden = false;
  if (!trig.tuningDemonChoice) {
    el("midnight-random-event-text").textContent = window.I18N.t("midnight_random_event_tuning_demon_desc");
    ["deal", "leave", "fight"].forEach(function (choiceKey, idx) {
      var btn = el("midnight-tuning-demon-choice-" + choiceKey);
      btn.hidden = false;
      btn.onclick = function () {
        GameStorage.rtSet(gameId, "cloud", "fieldTrigger/" + pt.id + "/tuningDemonChoice", choiceKey);
      };
    });
    return;
  }
  ["deal", "leave", "fight"].forEach(function (choiceKey) { el("midnight-tuning-demon-choice-" + choiceKey).hidden = true; });
  if (trig.tuningDemonChoice === "deal") {
    openBargainRevealModal(pt, trig, { deals: TUNING_DEMON_DEALS });
  } else if (trig.tuningDemonChoice === "fight" && !trig.enemyFamilyId) {
    var match = window.PriTestNightGmFlow.resolveCombatEnemyMatch("調律の魔物");
    if (match) {
      GameStorage.rtTransaction(gameId, "cloud", "fieldTrigger/" + pt.id + "/enemyFamilyId", function (cur) { return cur === null ? match.familyId : cur; });
      GameStorage.rtTransaction(gameId, "cloud", "fieldTrigger/" + pt.id + "/enemyId", function (cur) { return cur === null ? match.enemy.id : cur; });
    }
  }
  // "leave"：不做任何事，事件視為結束（不指派敵人、不開bargain）。
}
```

- [ ] **Step 3: DOM + i18n**

Add `#midnight-tuning-demon-choice-deal/-leave/-fight` buttons in `site_src/midnight_page.py`.
i18n: `midnight_random_event_tuning_demon_desc`, and 3 button labels (取引に応じる/立ち去る/戦いを仕掛ける → 接受交易/離去/發動攻擊).

- [ ] **Step 4: Manual verification**

Force `branchNameJa = "襲撃"` with a scenario where the table resolves to 調律の魔物 (or force `ambushEnemyNameJa` directly via console for testing), confirm all 3 choices work, confirm "deal" opens the bargain modal with the 2 fully-mapped deals showing correct good/bad text and applying their midnight-specific numeric effects (reuse Task 15's verification steps).

- [ ] **Step 5: Commit**

```bash
git add static_src/midnight.js site_src/midnight_page.py site_src/i18n_data_zh.py site_src/i18n_data_ja.py site_src/i18n_data_en.py
git commit -m "feat(midnight): 隨機事件襲擊分支(6種命定敵)+調律の魔物取引"
```

---

## Final Integration Pass

- [ ] **Step 1: Full-file syntax check**

```bash
node --check static_src/midnight.js
node --check static_src/midnight_puzzles.js
node --check static_src/midnight_random_events.js
node --check static_src/character_drawer.js
```

- [ ] **Step 2: Full rebuild**

```bash
python generate.py
```
Confirm no errors and `dist/static/midnight_puzzles.js` / `dist/static/midnight_random_events.js` exist.

- [ ] **Step 3: End-to-end Playwright/manual smoke pass**

Cover, in one continuous multi-tab session: create game → set a scenario in lobby → verify scenario-linked branch on a known card → play through a full board-floor card with mid-join and late-claim → trigger and clear a strong-enemy point (normal, then force a Day2 terrifying one) → clear a random-event point of each of the 10 branches (forcing via console where a specific branch is hard to reach naturally) → solve a tower puzzle and confirm the dice-hand reward → visit a merchant and forge C→U→R with the right smithing-stone costs → visit a church card and confirm chalice bonus goes through the reward list.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "chore(midnight): 9項優化整合驗證(python generate.py + node --check全過)"
```
