# Midnight 測試模式整合／HUD 折疊排版／樓層進入bug／獎勵清單再編 設計文件

日期：2026-09-09
範圍：`static_src/midnight.js`、`site_src/midnight_page.py`、`static_src/style.css`（即時制擴張版）。
不影響 `night.js`（回合制正式遊戲）。

## 0. 背景

本次是5個各自獨立的UI/邏輯改動，統一寫在同一份設計文件、但視為5個可各自驗證的子項目：

1. 測試模式整合＋密碼閘門
2. 上方資訊欄（field banner群組）折疊排版與HUD疊層順序
3. 最後一層「進入樓層」邀請閃爍消失bug
4. 獎勵清單分類再編＋GM判斷類報酬併入清單
5. HUD顯示資訊盤點（純文件，無程式變更）

已核對的既有機制／資料（避免重複發明）：

| 用途 | 既有函式／欄位 | 位置（已核對） |
|---|---|---|
| 測試模式開關 | `meta.testMode`（checkbox `#midnight-lobby-test-mode-checkbox`） | `midnight.js:521-596`／`midnight_page.py:96` |
| 測試面板（倍率拉桿） | `renderTestPanel()` | `midnight.js:548` |
| Admin密碼閘門既有寫法（供本次沿用同款`window.prompt`模式） | `games.js`（`requireAdmin()`） | 見CLAUDE.md §4.1 |
| 縮圈時間軸計算（純時間衍生，無獨立狀態） | `currentPhaseInfo()`／`phaseInfoForDay()`／`computeDayStage()`／`effectiveNow()` | `midnight.js:9914/9927/9815/9869` |
| 場上四個固定定位banner共用CSS選擇器群組 | `#midnight-field-enter-prompt,#midnight-field-invite-prompt,#midnight-field-banner,#midnight-field-late-join-prompt,#midnight-field-late-claim-prompt,#midnight-strong-enemy-banner`（z-index:600） | `style.css:5328-5347` |
| HUD左上／右上固定角落面板 | `#midnight-hud-top-left`／`#midnight-hud-top-right`（z-index:500） | `style.css:4406-4544` |
| 樓層進入／邀請狀態機 | `handleEnterFieldPointClick()`／`renderFieldOverlay()`／`updateNearbyFieldPoint()` | `midnight.js:4547/9033/4278` |
| 後補領獎判斷（本次bug根因所在） | `nearbyLateClaimPoint`計算 | `midnight.js:4329-4335` |
| 本地「我正在進入這個點」旗標（既有，可重用） | `fieldEnterAttempted[pt.id]` | `midnight.js:4548/4557` |
| 個人抽選報酬佇列 | `pendingRewards[myTokenId]`／`pushPendingReward()`／`computeRewardDraw()`／`renderRewardDetail()` | `midnight.js:7767/8154-8226/7902-7967` |
| 共享搶先領取報酬池 | `fieldTrigger/{id}/sharedRewards`／`pushSharedReward()`／`claimSharedReward()`／`collectUnresolvedSharedRewards()` | `midnight.js:7403-7449` |
| 板塊戰利品直接授予（本次要改掉的路徑） | `grantLootRewardEntryToCharacter()`／`grantTileLootToParticipants()` | `midnight.js:7227/7316` |
| GM判斷類報酬自動套用（本次要改掉的路徑） | `resolveJudgmentRewardEntries()`／`JUDGMENT_REWARD_KINDS` | `midnight.js:7497/7549` |

---

## 1. 測試模式整合＋密碼閘門

### 1.1 現況

程式碼內只找到「測試模式」一個相關功能（`meta.testMode`），沒有另一個獨立的「debug模式」。使用者確認房間設定中確實想要的是：**只留一顆「測試模式」按鍵**，且需要密碼才能開啟。

### 1.2 變更內容

- `#midnight-lobby-test-mode-checkbox` 改造：勾選（或改成按鈕形式）時觸發 `window.prompt()` 要求輸入密碼 `nightnight`，答對才呼叫既有的 `GameStorage.rtSet(gameId, "cloud", "meta/testMode", true)`；答錯或取消則還原成未勾選狀態，不寫入。沿用 `games.js` `requireAdmin()` 的既有密碼比對模式，不另外設計第二套密碼機制。
- 取消勾選（關閉測試模式）不需要密碼，直接寫 `false`。
- `#midnight-test-panel`（倍率拉桿等內容）改為預設隱藏，即使 `meta.testMode` 為 true 也不再常駐顯示；改成點擊右上選單（`#btn-midnight-toggle-menu`，或面板本身新增一顆獨立的「測試主控台」入口按鈕，只在 `meta.testMode` 為 true 時才顯示這顆入口）才開啟，面板內新增一顆 X 關閉按鈕收合。
- 測試面板新增「立即縮圈」按鈕：點擊後依目前 `meta.day2StartAt`／`meta.day3StartAt` 是否存在，判斷目前是day1還是day2，把對應的 `meta.sessionStartAt`（day1）或 `meta.day2StartAt`（day2）往回撥一段固定時間（直接設成 `now - PHASE_TOTAL_MS`，即讓 `computeDayStage()` 直接算出 `"done"` 階段的最終半徑，`PHASE_TOTAL_MS`為`midnight.js:56`既有常數，不重算），不新增第二套計時系統，沿用 `currentPhaseInfo()` 既有的時間衍生邏輯。day3（`stage:"day3"`，無地圖）時此按鈕disabled。
- 戰鬥中敵人HP數值顯示：找到目前顯示敵人HP數值的畫面（combat panel/共用標靶區塊），新增 `meta.testMode` 判斷——為 true 才顯示實際數字，否則只顯示血量條（不顯示數字），沿用既有HP bar元件、不重畫第二套。

### 1.3 驗證方式

1. `python generate.py` 後啟動本機server。
2. Playwright：建立遊戲→admin或lobby頁面嘗試勾選測試模式→確認彈出`window.prompt`且需要處理dialog（`dialog.accept("nightnight")`），答錯時確認`meta.testMode`未被寫入。
3. 確認測試面板預設不顯示，只有按下選單/專屬入口後才出現，面板內X能關閉。
4. 手動測試「立即縮圈」按鈕效果（觀察地圖圈是否立即跳到最終半徑）。
5. 比對測試模式ON/OFF時戰鬥畫面是否正確顯示/隱藏敵人HP數字。

---

## 2. 上方資訊欄折疊排版與HUD疊層順序

### 2.1 現況

`#midnight-field-enter-prompt`／`#midnight-field-banner`／`#midnight-field-late-claim-prompt`等5個元素共用同一組CSS選擇器（`style.css:5328`），固定在畫面上方置中，z-index:600，高於HUD左上/右上角落面板（z-index:500）。目前沒有折疊/薄線功能，也沒有找到使用者所述的 `btn-midnight-hud-collapse` 或雙擊變薄線的既有程式碼（已確認：這是全新功能，不是復原舊功能）。

### 2.2 變更內容

- 新增折疊狀態旗標（本地only，不需要跨裝置同步，比照`mapExpanded`同類純UI旗標寫法），套用一個新class（例如 `.midnight-field-overlay-collapsed`）到上述共用選擇器群組的父容器或個別元素上。
- 折疊時的樣式：文字/內容維持在DOM中但視覺上壓成一條薄線（大幅降低`padding`/`font-size`，內容用`text-overflow:ellipsis`或直接隱藏內文只留一條色線），並將這組z-index降到低於500（例如400），讓HUD左上/右上角落面板轉為疊在其上方。
- 新增折疊/展開按鈕：新增 `#btn-midnight-hud-collapse`（放在banner群組本身內，例如banner右上角），文字/圖示切換為「▶收合」「◀展開」。折疊後顯示的「◀」按鈕沿用同一顆按鈕、只是換文字/位置固定在原banner的左側細條上。
- 額外補上雙擊（dblclick）事件監聽，加在共用選擇器群組的容器上，效果與按鈕相同（互為另一個入口，不是取代按鈕）。

### 2.3 驗證方式

1. `generate.py`建置後，實際靠近地圖上的點觸發banner顯示。
2. 點擊收合按鈕／雙擊背景文字，確認變成薄線、且此時HUD左上角血條/右上角選單按鈕清晰可點擊（原本可能被банner疊住的情境）。
3. 點擊「◀」展開，確認恢復原本banner外觀與資訊。

---

## 3. 最後一層「進入樓層」邀請閃爍消失bug

### 3.1 根因

`updateNearbyFieldPoint()`（`midnight.js:4278`）中，後補領獎判斷（`midnight.js:4329-4335`）：

```js
if (!nearbyLateJoinPoint && progress0) {
  var alreadyClaimed0 = progress0.claimedBy && progress0.claimedBy[myTokenId];
  var neverJoined0 = !(trig0 && trig0.participants && trig0.participants[mySlot]);
  if (neverJoined0 && !alreadyClaimed0) {
    nearbyLateClaimPoint = found;
  }
}
```

`handleEnterFieldPointClick()`（`midnight.js:4547`）建立`fieldTrigger`是atomic transaction，理論上一次寫入`status:"inviting"`＋`participants`。但本地`fieldTriggers`快取（透過RTDB監聽回填）與`GameStorage.rtTransaction()`的本地回呼之間，仍可能存在數個影格的延遲窗口——這段期間`fieldTriggers[found.id]`（即`trig0`）尚未反映剛建立的trig，導致`neverJoined0`被誤判為`true`。若這個板塊已经有先前樓層留下的`progress0`（非第一層），`nearbyLateClaimPoint`會在這個窗口內被錯誤設成`true`，讓`#midnight-field-late-claim-prompt`短暫顯示——由於與`#midnight-field-banner`共用同一組固定定位＋z-index（見§2.1），視覺上造成banner「閃一下就消失」的錯覺，且使用者會誤以為進入失敗。

由於樓層數在遊戲後期較多，最後一層（`progress0`必然存在、非第一層）最容易踩到此窗口，符合使用者回報「最後一層」的現象。

### 3.2 修正內容

在後補領獎判斷中加入既有的本地旗標`fieldEnterAttempted[found.id]`（`midnight.js:4548/4557`，本來就用來標記「我剛按過這個點的進入」，天然涵蓋上述延遲窗口）：

```js
if (!nearbyLateJoinPoint && progress0 && !fieldEnterAttempted[found.id]) {
  ...
}
```

另外在`renderFieldOverlay()`（`midnight.js:9033`）中，於`banner.hidden = false`的分支明確加一行`lateClaimBox.hidden = true`，讓banner顯示時強制排除late-claim-prompt同時出現，作為第二層保險（即使本地旗標判斷仍有極端競態，也不會兩者同時可見）。

### 3.3 驗證方式

1. 建立測試遊戲，用Playwright或人工操作把某個板塊打到只剩最後一層（`fieldProgress/{id}/floorIndex`＝`floorCount-1`）。
2. 靠近該點按「進入」，確認邀請banner／讀取條正常顯示且不再閃爍消失，能正常走完打字機/投票流程進入最後一層戰鬥。
3. 確認正常情況下（非最後一層、無`progress0`）行為不受影響。

---

## 4. 獎勵清單分類再編＋GM判斷類報酬併入清單

### 4.1 現況

`renderRewardModal()`（`midnight.js:8154`）把個人`pendingRewards[myTokenId]`與共享`sharedRewards`（`collectUnresolvedSharedRewards()`）混在同一個`<ul id="midnight-reward-list">`中，只用文字提示（`midnight_reward_shared_note`）區分，沒有視覺分區。

板塊樓層戰利品目前透過`grantTileLootToParticipants()`→`grantLootRewardEntryToCharacter()`直接授予＋`_lastTileRewardNote`背景toast顯示（`midnight.js:7316-7342`），未經過`pendingRewards`。

GM判斷類報酬（`hpDamage`/`tieredChoice`/`diceHandChoice`/`note`）透過`resolveJudgmentRewardEntries()`（`midnight.js:7497`）在判定當下立即套用效果（hpDamage直接扣demoStat、note直接寫`_lastTileRewardNote`），同樣未經過`pendingRewards`。

### 4.2 UI變更：單一面板、上下兩段式

`#midnight-reward-modal`維持單一彈窗，`#midnight-reward-list`內部改成兩個區段（不是分頁/tab切換，兩段同時可見、可各自捲動或直接上下排列）：

```html
<div id="midnight-reward-modal" hidden>
  ...
  <h4 data-i18n="midnight_reward_shared_section_title"></h4>
  <ul id="midnight-reward-list-shared"></ul>
  <h4 data-i18n="midnight_reward_section_title"></h4>
  <ul id="midnight-reward-list-personal"></ul>
  <div id="midnight-reward-detail"></div>
</div>
```

`renderRewardModal()`拆成兩段渲染：上段沿用現有`sharedEntries.forEach`邏輯（點擊直接`claimSharedReward()`），下段沿用現有`unresolvedIds.forEach`邏輯（點擊選取後於`#midnight-reward-detail`顯示抽選/確認流程）。資料來源與判斷邏輯（`perPerson`旗標／`sharedRewards`結構）完全不變，只是改變DOM輸出目標與新增兩個`<h4>`標題。

### 4.3 板塊戰利品併入`pendingRewards`

`grantTileLootToParticipants()`與其呼叫端（`midnight.js:7759`附近）、`claimLateFieldTriggerRewards()`（`midnight.js:4632`）、`claimSharedReward()`（`midnight.js:7411`，若該筆非共享而走個人）中，凡是呼叫`grantLootRewardEntryToCharacter(c, entry)`直接授予的地方，改為對每個`entry`呼叫`pushPendingReward(tokenId, entry)`（比照`chaliceBonus`既有作法，`midnight.js:7385-7388`），移除直接的`c.xxx=...`＋`_lastTileRewardNote`寫法。

`computeRewardDraw()`（`midnight.js:7902`）需要新增對`stoneswordKey`／`smithingStone`／`weaponSkillReroll`三種kind的處理（目前只有`rune`/`chaliceBonus`/`talisman`/`weapon`/`consumable`），比照`grantLootRewardEntryToCharacter()`裡對應的既有邏輯搬過來（非抽選、固定數量直接apply，沿用`rune`/`chaliceBonus`同款「直接顯示確認/丟棄按鈕」模式，不需要`needsDrawStep`）。

### 4.4 GM判斷類報酬併入`pendingRewards`

`resolveJudgmentRewardEntries()`（`midnight.js:7497`）修改：

- `tieredChoice`／`diceHandChoice`：分支判定邏輯（挑中哪個tier/hand）維持不變、必須在解析當下一次性決定（避免多裝置算出不同分支），遞迴呼叫維持原樣。
- `hpDamage`：挑選受害者（`slots`中隨機一人）的邏輯維持不變，但不再直接呼叫`GameStorage.rtTransaction("demoStat/"+tokenId, ...)`扣血，改成對該`tokenId`呼叫`pushPendingReward(tokenId, {kind:"hpDamage", value: entry.value})`。
- `note`：不再迴圈所有participants直接寫`_lastTileRewardNote`，改成對每個participant的`tokenId`呼叫`pushPendingReward(tokenId, {kind:"note", text: window.PriTestFields.localizedText(entry.note)})`。

`computeRewardDraw()`／`renderRewardDetail()`新增對`hpDamage`／`note`兩種kind的處理：
- `hpDamage`：label顯示「受到X點傷害」，`apply`時才真正執行`demoStat`扣血transaction（沿用`selfArenaHpMax()`既有換算）。
- `note`：label／內文直接顯示`entry.text`原文，`apply`為no-op（純確認已讀、跟`discardRewardEntry()`效果相同，但因為沒有「丟棄」的意義，可只顯示一顆「確認」按鈕）。

### 4.5 範圍排除

「祝福」（HP/FP/體力/聖杯瓶全回滿）與商人鍛冶合等狀態效果/交易行為，不算「獲得道具」，維持現狀不經過`pendingRewards`。`bargainReveal`已有專屬手動UI（`openBargainRevealModal`），本次不變動。

### 4.6 驗證方式

1. `generate.py`後建立測試遊戲，用Playwright打穿一個含有戰利品（武器/消耗品/護符/盧恩/鍛造石/石劍鑰匙）的板塊樓層，確認角色資料不再瞬間變化，而是`pendingRewards[tokenId]`多出對應筆數，開啟獎勵清單彈窗才能逐一抽選/確認取得。
2. 觸發一個含有`hpDamage`/`note`/`tieredChoice`的既有事件分支（例如`fields_data_*.js`中已知含這些kind的段落），確認判定當下不再立即扣血/立即跳toast，而是進到被選中玩家的個人待領清單，開啟後才真正扣血/顯示文字。
3. 確認共享池項目（`sharedRewards`）維持「先搶先贏」直接領取行為不變，只是視覺上移到清單上段。

---

## 5. HUD顯示資訊盤點（`#midnight-hud-top-left`／`#midnight-hud-top-right`）

本節純粹列出目前程式碼中，這兩個固定角落面板實際會顯示的資訊，供使用者參考，不涉及本次程式修改。

### 5.1 `#midnight-hud-top-left`（左上）

- 進入戰鬥提示按鈕＋3秒讀取條（`#midnight-enter-battle-prompt`，離開戰鬥後再進入時顯示）
- 暫停後繼續遊戲的3秒讀取條（`#midnight-resume-countdown-row`）
- Day1/Day2夜之強敵倒數（`#midnight-final-circle-countdown`，純顯示不可操作）
- Day1夜之強敵戰後「祝福／離去」列（`#midnight-hud-day1-rewards-row`）
- Day2夜之強敵戰後「祝福／商人／離去」列（`#btn-midnight-hud-blessing`／`#midnight-hud-merchant-row`）
- 「準備進入最終王戰」列（`#midnight-hud-ready-final-row`）
- 自己的HP／FP／體力數值條（`#midnight-self-hp/fp/stamina-*`）
- 聖杯瓶剩餘數（`#midnight-flask-count`）
- 隊友（其他玩家）血量卡片（`#midnight-players-panel-slots`）
- 附近掉落物簡易資訊＋拾取按鈕（`#midnight-ground-item-prompt`）

### 5.2 `#midnight-hud-top-right`（右上）

- 自己的盧恩數值（`#midnight-self-rune-value`）
- 小地圖（戰鬥中且地圖收合時顯示，`#midnight-minimap-canvas`）
- 地圖圖示按鈕（展開/收合全螢幕地圖，`#btn-midnight-map-icon`）
- 角色面板開啟按鈕（`#btn-midnight-open-character-sheet`，可習得遺物效果時會黃光提示）
- 選單開啟按鈕（`#btn-midnight-toggle-menu`）
- 測試模式面板（`#midnight-test-panel`，僅`meta.testMode`為true時顯示；本次改為需另外點擊才展開，見§1）
