# 東正小遊戲 進階1：全員投票決定加減分 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 釋放消息後的加減分可選「全員秘密投票取平均」，原本主持人輸入保留為選項。

**Architecture:** 規則全部放在 `toushou_core.js`（新 action `castVote`／`skipPendingVoters`、純函式 `tallyVotes`），UI 只負責輸入與顯示；連線模式沿用既有的 transaction＋`mySeats()`＋遮蔽畫面機制，不改雲端資料結構。

**Tech Stack:** Vanilla ES5、Python 建置（`py -3 generate.py`）、Node 檢查腳本、Playwright（從 `tools/midnight_check/node_modules` 載入）、Firebase Local Emulator。

## Global Constraints

- 規格：`docs/superpowers/specs/2026-10-16-toushou-vote-design.md`。
- `deltaMode`：`"host"`／`"vote"`；連線預設 `vote`、單機預設 `host`；舊存檔缺欄位視為 `host`。
- `voteCap`：整數 10～200，預設 100；每票 −cap～＋cap（含）。
- 投票者＝全部玩家（含股東、含籌碼為 0 者）。
- 計票：平均後四捨五入，.5 遠離 0（2.5→3、−2.5→−3）；之後風向 `up` 且 <0、`down` 且 >0 → 0。
- 略過未投票者：至少 1 票。
- 錯誤以 i18n key throw；`zh`、`ja` 都要加 key，`en` fallback。
- Windows 上 Python 一律 `py -3`；commit message 繁體中文並附 Co-Authored-By／Claude-Session 兩行。
- 推送只用 `git push private main`，且須先徵求使用者同意。

---

### Task 1: 規則引擎（core）＋ core_check

**Files:**
- Modify: `static_src/toushou_core.js`（`newGame` config、`releaseNews`、`applyDelta`、`reduce`、export）
- Test: `tools/toushou_check/core_check.js`（新增 `[core: vote]` 區段，放在 `[core: settle]` 之前、`wind cards` 檢查之後）

**Interfaces:**
- Produces：`Core.voteError(s, playerId, value) -> key|null`、`Core.pendingVoters(s) -> playerId[]`、`Core.tallyVotes(votes, wind) -> { sum, count, avg, delta, windZeroed }`、actions `castVote {playerId, value}`、`skipPendingVoters {}`；`state.config.deltaMode`、`state.config.voteCap`、`state.current.votes`；`news[i].votes / avg / windZeroed`（僅投票模式）。

- [ ] **Step 1: 寫失敗的檢查**（加在 `wind cards` 檢查之後）

```js
console.log("[core: vote]");
function toVote(n, extra) {
  return release(toNews(n, Object.assign({ deltaMode: "vote" }, extra || {})));
}
check("config: deltaMode/voteCap defaults; old state without deltaMode is host", function () {
  var s = Core.newGame(baseConfig(2));
  assert.strictEqual(s.config.deltaMode, "host");
  assert.strictEqual(s.config.voteCap, 100);
  s = Core.newGame(baseConfig(2, { deltaMode: "vote", voteCap: 30 }));
  assert.strictEqual(s.config.deltaMode, "vote");
  assert.strictEqual(s.config.voteCap, 30);
  var old = release(toNews(2));
  delete old.config.deltaMode;
  old = Core.reduce(old, { type: "applyDelta", delta: 5 });
  assert.strictEqual(old.current.news[0].delta, 5);
});
check("tallyVotes: average rounded half away from zero, wind zeroing", function () {
  function d(list, wind) {
    var v = {};
    list.forEach(function (x, i) { v["p" + i] = x; });
    return Core.tallyVotes(v, wind || null);
  }
  assert.strictEqual(d([2, 3]).delta, 3);
  assert.strictEqual(d([-2, -3]).delta, -3);
  assert.strictEqual(d([10, -5, 0]).delta, 2);
  assert.strictEqual(d([1, 1, 0]).delta, 1);
  assert.strictEqual(d([1, 0, 0]).delta, 0);
  assert.strictEqual(d([2, 3]).avg, 2.5);
  var z = d([-10, -20], "up");
  assert.strictEqual(z.delta, 0);
  assert.strictEqual(z.windZeroed, true);
  assert.strictEqual(d([10, 20], "down").delta, 0);
  assert.strictEqual(d([-10, -20], "down").delta, -15);
  assert.strictEqual(d([-10, -20], "neutral").delta, -15);
  assert.strictEqual(d([5], "up").windZeroed, false);
});
check("castVote: validations and mode guard", function () {
  var s = toVote(3, { voteCap: 50 });
  assert.strictEqual(Core.voteError(s, "p0", 50), null);
  assert.strictEqual(Core.voteError(s, "p0", -50), null);
  assert.strictEqual(Core.voteError(s, "p0", 51), "ts_err_vote_range");
  assert.strictEqual(Core.voteError(s, "p0", 1.5), "ts_err_int");
  assert.strictEqual(Core.voteError(s, "zz", 1), "ts_err_not_your_turn");
  s = Core.reduce(s, { type: "castVote", playerId: "p0", value: 10 });
  assert.strictEqual(Core.voteError(s, "p0", 1), "ts_err_already_voted");
  assert.throws(function () { Core.reduce(s, { type: "castVote", playerId: "p0", value: 1 }); }, /ts_err_already_voted/);
  assert.throws(function () { Core.reduce(s, { type: "applyDelta", delta: 1 }); }, /ts_err_vote_mode/);
  var h = release(toNews(3));
  assert.throws(function () { Core.reduce(h, { type: "castVote", playerId: "p0", value: 1 }); }, /ts_err_vote_mode/);
  assert.throws(function () { Core.reduce(h, { type: "skipPendingVoters" }); }, /ts_err_vote_mode/);
});
check("all votes in (any order, shareholder included) -> applied and recorded", function () {
  var s = toVote(3);
  var sh = Core.currentShareholder(s);
  assert.deepStrictEqual(Core.pendingVoters(s), ["p0", "p1", "p2"]);
  s = Core.reduce(s, { type: "castVote", playerId: "p2", value: 30 });
  s = Core.reduce(s, { type: "castVote", playerId: sh === "p2" ? "p1" : sh, value: -10 });
  assert.strictEqual(s.phase, "vote");
  assert.strictEqual(Core.pendingVoters(s).length, 1);
  s = Core.reduce(s, { type: "castVote", playerId: Core.pendingVoters(s)[0], value: 0 });
  assert.strictEqual(s.phase, "news");
  var n = s.current.news[0];
  assert.strictEqual(n.delta, 7);
  assert.strictEqual(n.priceAfter, 107);
  assert.strictEqual(n.playerId, sh);
  assert.strictEqual(Object.keys(n.votes).length, 3);
  assert.strictEqual(n.windZeroed, false);
  assert.deepStrictEqual(s.current.votes, {});
});
check("skipPendingVoters needs at least one vote; tallies existing votes", function () {
  var s = toVote(3);
  assert.throws(function () { Core.reduce(s, { type: "skipPendingVoters" }); }, /ts_err_no_votes/);
  s = Core.reduce(s, { type: "castVote", playerId: "p1", value: -25 });
  s = Core.reduce(s, { type: "skipPendingVoters" });
  assert.strictEqual(s.current.news[0].delta, -25);
  assert.deepStrictEqual(Object.keys(s.current.news[0].votes), ["p1"]);
});
check("vote mode plays a full target to settle; wind zeroing recorded", function () {
  var s = toNews(2, { deltaMode: "vote", windEnabled: true });
  for (var k = 0; k < 2; k++) {
    s = release(s);
    var wind = s.current.wind;
    var v = wind === "up" ? -40 : 40;
    s = Core.reduce(s, { type: "castVote", playerId: "p0", value: v });
    s = Core.reduce(s, { type: "castVote", playerId: "p1", value: v });
    var n = s.phase === "settle" ? s.history[0].news[k] : s.current.news[k];
    assert.strictEqual(n.windZeroed, wind === "up" || wind === "down" ? (wind === "up") === (v < 0) : false);
  }
  assert.strictEqual(s.phase, "settle");
});
```

- [ ] **Step 2: 執行，確認失敗**

Run: `node tools/toushou_check/core_check.js`
Expected: 新增的 `[core: vote]` 檢查 FAIL（`tallyVotes is not a function` 等），既有 45 項維持 ok。

- [ ] **Step 3: 實作**

`newGame` 的 `config`：

```js
      config: {
        missionsEnabled: !!config.missionsEnabled,
        windEnabled: !!config.windEnabled,
        minBet: config.minBet,
        deltaMode: config.deltaMode === "vote" ? "vote" : "host",
        voteCap: isInt(config.voteCap) ? config.voteCap : 100
      },
```

`releaseNews` 結尾設 `s.current.votes = {};`。把 `applyDelta` 的共用部分抽成 `commitDelta(s, delta, extra)`，並新增投票函式：

```js
  function deltaMode(s) { return s.config.deltaMode === "vote" ? "vote" : "host"; }

  // 寫入消息面、換下一位股東或結算。extra 為投票模式的附加紀錄（votes/avg/windZeroed）
  function commitDelta(s, delta, extra) {
    var c = s.current;
    c.price = Math.max(0, c.price + delta);
    var entry = { playerId: c.pending.playerId, cardId: c.pending.cardId, edited: c.pending.edited,
      text: c.pending.text, wind: c.wind, delta: delta, priceAfter: c.price };
    Object.keys(extra || {}).forEach(function (k) { entry[k] = extra[k]; });
    c.news.push(entry);
    c.votes = {};
    c.turnIndex += 1;
    if (c.turnIndex >= c.order.length) {
      c.pending = null;
      settleCurrent(s);
    } else {
      s.phase = "news";
      enterNewsTurn(s);
    }
  }

  function applyDelta(s, a) {
    if (deltaMode(s) !== "host") throw new Error("ts_err_vote_mode");
    var err = deltaError(s, a.delta);
    if (err) throw new Error(err);
    commitDelta(s, a.delta, null);
  }

  // ---------------- 投票（deltaMode = "vote"） ----------------

  // 全部玩家（含股東）都投票；座位順序
  function pendingVoters(s) {
    if (s.phase !== "vote" || !s.current || deltaMode(s) !== "vote") return [];
    var votes = s.current.votes || {};
    return s.players.filter(function (p) { return !Object.prototype.hasOwnProperty.call(votes, p.id); })
      .map(function (p) { return p.id; });
  }

  function voteError(s, playerId, value) {
    if (deltaMode(s) !== "vote") return "ts_err_vote_mode";
    if (!playerById(s, playerId)) return "ts_err_not_your_turn";
    if (pendingVoters(s).indexOf(playerId) < 0) return "ts_err_already_voted";
    if (!isInt(value)) return "ts_err_int";
    if (Math.abs(value) > s.config.voteCap) return "ts_err_vote_range";
    return null;
  }

  // 平均四捨五入（.5 遠離 0）；以整數運算避免浮點誤差。之後套用風向限制。
  function tallyVotes(votes, wind) {
    var ids = Object.keys(votes);
    var sum = 0;
    ids.forEach(function (id) { sum += votes[id]; });
    var n = ids.length;
    var raw = Math.floor((2 * Math.abs(sum) + n) / (2 * n)) * (sum < 0 ? -1 : 1);
    var zeroed = (wind === "up" && raw < 0) || (wind === "down" && raw > 0);
    return { sum: sum, count: n, avg: sum / n, delta: zeroed ? 0 : raw, windZeroed: zeroed };
  }

  function finishVote(s) {
    var c = s.current;
    var r = tallyVotes(c.votes, c.wind);
    commitDelta(s, r.delta, { votes: clone(c.votes), avg: r.avg, windZeroed: r.windZeroed });
  }

  function castVote(s, a) {
    var err = voteError(s, a.playerId, a.value);
    if (err) throw new Error(err);
    s.current.votes[a.playerId] = a.value;
    if (!pendingVoters(s).length) finishVote(s);
  }

  function skipPendingVoters(s) {
    if (deltaMode(s) !== "vote") throw new Error("ts_err_vote_mode");
    if (!Object.keys(s.current.votes || {}).length) throw new Error("ts_err_no_votes");
    finishVote(s);
  }
```

注意：`(-0)` 不會出現，因為 `sum === 0` 時 `raw = 0 * 1`。`releaseNews` 的 `s.current.votes = {}` 寫在 `s.phase = "vote"` 前；`castVote` 若 `s.current.votes` 不存在（理論上不會）時先補 `{}`。

`reduce` 新增：

```js
      case "castVote":
        if (s.phase !== "vote") throw new Error("ts_err_phase");
        castVote(s, action);
        break;
      case "skipPendingVoters":
        if (s.phase !== "vote") throw new Error("ts_err_phase");
        skipPendingVoters(s);
        break;
```

export 加入 `voteError`、`pendingVoters`、`tallyVotes`。`baseConfig` 的 `extra` 已支援傳入 `deltaMode`／`voteCap`。

- [ ] **Step 4: 執行，確認全部通過**

Run: `node --check static_src/toushou_core.js; node tools/toushou_check/core_check.js`
Expected: `51 passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
git add static_src/toushou_core.js tools/toushou_check/core_check.js
git commit -m "feat(toushou): 規則引擎新增全員投票決定加減分（castVote／略過未投票者）"
```

---

### Task 2: i18n＋UI＋單機 ui_check

**Files:**
- Modify: `site_src/i18n_data_zh.py`、`site_src/i18n_data_ja.py`（`ts_*` 區塊尾端）
- Modify: `static_src/toushou.js`（`newDraft`、`renderSetup`、`buildConfig`、`dispatch` 錯誤參數、`newsBoard`、`renderVote`）
- Test: `tools/toushou_check/ui_check.js`

**Interfaces:**
- Consumes：Task 1 的 `Core.voteError / pendingVoters / tallyVotes`、actions。
- Produces：DOM id `#ts-delta-mode`（select，值 host/vote）、`#ts-vote-cap`、`#ts-vote-value`、`#ts-btn-cast-vote`、`#ts-btn-skip-voters`、`.ts-vote-detail`（消息面每則的票）。

- [ ] **Step 1: i18n key**

zh：

```python
    "ts_delta_mode": "加減分方式",
    "ts_delta_mode_host": "主持人輸入",
    "ts_delta_mode_vote": "全員投票（取平均）",
    "ts_vote_cap": "每票上限",
    "ts_vote_cast_heading": "{name} 的投票：這則消息讓股價加減多少？",
    "ts_vote_value": "你的票（−{cap}～+{cap}）",
    "ts_btn_cast_vote": "確認投票",
    "ts_wait_votes": "等待其他玩家投票（{done} / {total}）",
    "ts_btn_skip_voters": "略過未投票者並計票",
    "ts_news_votes": "票：{list}／平均 {avg}",
    "ts_news_wind_zeroed": "違反風向，歸 0",
    "ts_err_vote_mode": "目前的加減分方式不能這樣操作",
    "ts_err_vote_range": "每票必須是 −{cap}～+{cap} 的整數",
    "ts_err_already_voted": "已經投過票了",
    "ts_err_no_votes": "至少要有 1 票才能計票",
    "ts_err_setup_vote_cap": "每票上限須為 10～200 的整數",
```

ja：

```python
    "ts_delta_mode": "増減の決め方",
    "ts_delta_mode_host": "ホストが入力",
    "ts_delta_mode_vote": "全員で投票（平均）",
    "ts_vote_cap": "1票の上限",
    "ts_vote_cast_heading": "{name} の投票：この情報で株価をいくら動かす？",
    "ts_vote_value": "あなたの票（−{cap}〜+{cap}）",
    "ts_btn_cast_vote": "投票する",
    "ts_wait_votes": "他のプレイヤーの投票待ち（{done} / {total}）",
    "ts_btn_skip_voters": "未投票者を飛ばして集計",
    "ts_news_votes": "票：{list}／平均 {avg}",
    "ts_news_wind_zeroed": "風向きに反するため 0",
    "ts_err_vote_mode": "現在の増減の決め方ではこの操作はできません",
    "ts_err_vote_range": "1票は −{cap}〜+{cap} の整数にしてください",
    "ts_err_already_voted": "すでに投票済みです",
    "ts_err_no_votes": "集計には最低1票必要です",
    "ts_err_setup_vote_cap": "1票の上限は10〜200の整数にしてください",
```

- [ ] **Step 2: 設定畫面**

`newDraft` 加 `deltaMode: "host", deltaModeEdited: false, voteCap: 100`。
連線開關 `onchange`：`draft.online = e.target.checked; if (!draft.deltaModeEdited) draft.deltaMode = draft.online ? "vote" : "host"; render();`。
在最低押注欄位後加：

```js
    var modeSel = el("select", { id: "ts-delta-mode", "aria-label": t("ts_delta_mode"),
      onchange: function (e) { draft.deltaMode = e.target.value; draft.deltaModeEdited = true; render(); } });
    ["host", "vote"].forEach(function (m) {
      modeSel.appendChild(el("option", { value: m, selected: draft.deltaMode === m, text: t("ts_delta_mode_" + m) }));
    });
    box.appendChild(el("label", { class: "ts-field" }, [t("ts_delta_mode"), modeSel]));
    if (draft.deltaMode === "vote") {
      box.appendChild(el("label", { class: "ts-field" }, [t("ts_vote_cap"), el("input", {
        id: "ts-vote-cap", type: "number", min: "10", max: "200", value: String(draft.voteCap),
        oninput: function (e) { draft.voteCap = e.target.value; }
      })]));
    }
```

（連線開關目前在最低押注之後，`deltaMode` 欄位放在連線開關之後，切換連線時預設值的變化看得到。）
`buildConfig`：

```js
    var voteCap = intOf(draft.voteCap);
    if (draft.deltaMode === "vote" && !(voteCap >= 10 && voteCap <= 200)) return { error: "ts_err_setup_vote_cap" };
```

回傳的 config 加 `deltaMode: draft.deltaMode, voteCap: draft.deltaMode === "vote" ? voteCap : 100`。

- [ ] **Step 3: 錯誤訊息參數**

新增 `function errText(key) { return t(key, { cap: state && state.config ? state.config.voteCap : 100 }); }`，`dispatch` 兩處 `t(e.message)`／`t(errKey || "ts_err_network")` 改用 `errText`。

- [ ] **Step 4: 消息面顯示票**

`newsBoard` 每個 `li` 在文字後加入：

```js
        n.votes ? el("div", { class: "ts-vote-detail", text: t("ts_news_votes", {
          list: Object.keys(n.votes).map(function (id) {
            var v = n.votes[id];
            return playerName(id) + " " + (v > 0 ? "+" + v : String(v));
          }).join("、"),
          avg: String(Math.round(n.avg * 10) / 10)
        }) + (n.windZeroed ? "（" + t("ts_news_wind_zeroed") + "）" : "") }) : null
```

- [ ] **Step 5: 投票畫面**

`renderVote` 開頭保留 `news` 段落；`state.config.deltaMode !== "vote"` 時走原本流程。投票模式：

```js
    var pendingIds = Core.pendingVoters(state);
    var total = state.players.length;
    var mine = pendingIds.filter(owns);
    var voted = total - pendingIds.length;
    var skipBtn = isHost() && voted > 0 && pendingIds.length > 0 && room
      ? el("button", { id: "ts-btn-skip-voters", type: "button", text: t("ts_btn_skip_voters"),
          onclick: function () { dispatch({ type: "skipPendingVoters" }); } })
      : null;
    if (!mine.length) {
      return el("section", { class: "ts-panel" }, [news,
        el("p", { class: "ts-wait-text", text: t("ts_wait_votes", { done: voted, total: total }) }), errorLine(), skipBtn]);
    }
    var pid = mine[0];
    var cap = state.config.voteCap;
    var body = masked(pid, function () {
      var input = el("input", { id: "ts-vote-value", type: "number", step: "1", min: String(-cap), max: String(cap), value: "0" });
      return el("div", {}, [
        el("h3", { text: t("ts_vote_cast_heading", { name: playerName(pid) }) }),
        el("label", { class: "ts-field" }, [t("ts_vote_value", { cap: cap }), input]),
        errorLine(),
        el("button", { id: "ts-btn-cast-vote", type: "button", class: "ts-primary", text: t("ts_btn_cast_vote"),
          onclick: function () {
            var v = intOf(input.value);
            var err = Core.voteError(state, pid, v);
            if (err) { ui.error = errText(err); render(); return; }
            dispatch({ type: "castVote", playerId: pid, value: v });
          } })
      ]);
    });
    return el("section", { class: "ts-panel" }, [news, body,
      el("p", { class: "ts-hooks", text: t("ts_wait_votes", { done: voted, total: total }) }), skipBtn]);
```

`skipBtn` 只在連線模式顯示（單機時主持人擁有全部座位，不會有人卡住）。

- [ ] **Step 6: ui_check 新增單機投票模式**

在 ui_check 最後（`assert.deepStrictEqual(errors, [])` 前）加入第二局：

```js
  // ---- 第二局：單機 + 全員投票，跑 1 個標的 ----
  await page.click('.lang-btn[data-lang="zh"]');
  await page.click("#ts-btn-back-setup");
  await page.fill("#ts-player-count", "3");
  await page.dispatchEvent("#ts-player-count", "change");
  await page.uncheck("#ts-missions");
  await page.selectOption("#ts-delta-mode", "vote");
  assert.strictEqual(await page.inputValue("#ts-vote-cap"), "100");
  await page.click("#ts-btn-start");
  s = await debugState(page);
  assert.strictEqual(s.config.deltaMode, "vote");
  await page.click("#ts-btn-start-betting");
  for (var vb = 0; vb < 3; vb++) {
    await page.click("#ts-btn-reveal");
    await page.fill("#ts-bet-amount", "100");
    await page.fill("#ts-bet-predict", "100");
    await page.click("#ts-btn-confirm-bet");
  }
  for (var vk = 0; vk < 3; vk++) {
    await page.click("#ts-btn-reveal");
    await page.fill("#ts-news-text", "投票消息" + vk);
    await page.click("#ts-btn-release");
    var votes = [30, -10, 0];
    for (var vv = 0; vv < 3; vv++) {
      assert.strictEqual(await page.locator("#ts-vote-value").count(), 0, "vote hidden behind mask");
      await page.click("#ts-btn-reveal");
      if (vk === 0 && vv === 0) {
        await page.fill("#ts-vote-value", "101");
        await page.click("#ts-btn-cast-vote");
        assert.ok((await page.textContent("#ts-game-error")).indexOf("100") >= 0, "range error shows cap");
      }
      await page.fill("#ts-vote-value", String(votes[vv]));
      await page.click("#ts-btn-cast-vote");
    }
    assert.strictEqual(await page.locator(".ts-vote-detail").count(), vk + 1);
  }
  s = await debugState(page);
  assert.strictEqual(s.phase, "settle");
  assert.strictEqual(s.history[0].finalPrice, 100 + 7 * 3);
```

（標的數預設依人數＝3，只跑 1 個標的到 settle 即可。）

- [ ] **Step 7: 建置與執行**

Run:
```
node --check static_src/toushou.js
py -3 generate.py
py -3 -m http.server 8941 --directory dist   # 背景
node tools/toushou_check/ui_check.js
```
Expected: `toushou ui_check: OK`

- [ ] **Step 8: Commit**

```bash
git add site_src/i18n_data_zh.py site_src/i18n_data_ja.py static_src/toushou.js tools/toushou_check/ui_check.js
git commit -m "feat(toushou): 新增全員投票介面（開局設定、遮蔽輪流投票、消息面顯示票數）"
```

---

### Task 3: 多裝置檢查改為投票模式

**Files:**
- Modify: `tools/toushou_check/multi_device_check.js`

- [ ] **Step 1: 設定改為投票模式**

A 勾選連線模式後斷言 `await A.inputValue("#ts-delta-mode") === "vote"`。

- [ ] **Step 2: 取代主持人輸入加減分**

原本 `await A.fill("#ts-delta", ...)`／`#ts-btn-apply-delta` 改為三台各自投票。期望價格維持 110：k=0 每人投 20（平均 20），k=1、k=2 每人投 −5。

```js
      var voteVal = k === 0 ? 20 : -5;
      // 每台只看到自己的投票框，沒有遮蔽
      for (var vp in deviceOf) {
        await deviceOf[vp].waitForSelector("#ts-vote-value", { timeout: TIMEOUT });
        assert.strictEqual(await deviceOf[vp].locator("#ts-mask").count(), 0);
      }
      if (round === 1 && k === 1) {
        // 主持人略過：只有 B 投票，A 用略過按鈕計票
        await B.fill("#ts-vote-value", String(voteVal));
        await B.click("#ts-btn-cast-vote");
        await waitState(A, "return Object.keys(s.current.votes).length === 1;");
        assert.strictEqual(await B.locator("#ts-btn-skip-voters").count(), 0, "only host can skip");
        await A.click("#ts-btn-skip-voters");
      } else {
        await B.fill("#ts-vote-value", String(voteVal));
        await B.click("#ts-btn-cast-vote");
        await waitState(C, "return Object.keys(s.current.votes).length === 1;");
        assert.ok((await C.textContent("#ts-app")).indexOf("1 / 3") >= 0, "progress shown, value hidden");
        await C.fill("#ts-vote-value", String(voteVal));
        await C.click("#ts-btn-cast-vote");
        await A.fill("#ts-vote-value", String(voteVal));
        await A.click("#ts-btn-cast-vote");
      }
```

刪掉原本 `if (sh !== "p0") assert ... #ts-delta` 那行（改成斷言所有裝置 `#ts-delta` 數量為 0）。最後檢查 `h.news[1]` 在 round 1 只有 1 票：`Object.keys(s.history[1].news[1].votes).length === 1`。

- [ ] **Step 3: 執行（含 emulator）**

Run:
```
tools/midnight_check/node_modules/.bin/firebase emulators:start --only database,auth --project elden-ring-nightreign   # 背景，repo 根目錄
node tools/toushou_check/multi_device_check.js
```
Expected: `toushou multi_device_check: OK`（連跑 2 次）

- [ ] **Step 4: Commit**

```bash
git add tools/toushou_check/multi_device_check.js
git commit -m "test(toushou): 多裝置檢查改為全員投票並驗證主持人略過未投票者"
```
