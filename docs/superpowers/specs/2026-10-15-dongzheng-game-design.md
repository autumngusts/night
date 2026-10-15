# 東正小遊戲 設計規格（第 1 階段：單機傳遞模式）

日期：2026-10-15
狀態：已與使用者確認，待審閱

---

## 1. 目標與範圍

在首頁新增一個與「夜渡り」（night／midnight）完全獨立的派對遊戲「東正小遊戲」。
玩家對多個「標的」（歷史事件、人名、公司行號、風景、物品等）下注看漲／看跌，
再輪流擔任「股東」釋放消息面，由全場討論決定股價加減分，最後依股價漲跌結算籌碼。

### 1.1 分階段

| 階段 | 內容 |
| --- | --- |
| **第 1 階段（本 spec）** | 單機傳遞模式：一台裝置，主持人操作，需要保密的步驟以遮蔽畫面輪流傳遞 |
| 第 2 階段（另開 spec） | 多裝置連線模式：重用 `PriTestGameStorage.rtSet / rtSubscribe / rtTransaction`，把 action 寫到 `games/<id>/rtState/dongzheng` |
| 強化版（另開 spec） | 股東內線資訊、股東指定分數目標與專屬計分等 |

第 1 階段的狀態模型必須設計成「可序列化的單一 `state`＋純函式 reducer」，
讓第 2 階段只需把 action 改經雲端同步，不必修改規則邏輯。

### 1.2 基本版明確不做

- 股東的內線資訊（暗牌、真實風向）
- 股東專屬計分／獎懲
- 多裝置連線
- 出牌直接影響數值（消息牌僅供討論，數值一律由全場共識輸入）

---

## 2. 檔案結構

| 檔案 | 職責 |
| --- | --- |
| `site_src/dongzheng_page.py` | `build_dongzheng_html()`，使用 `layout.page_shell` 產生頁面骨架 |
| `static_src/dongzheng_data.js` | 純資料：標的池、消息牌表、任務卡定義、類別→角色名稱對照。掛載為 `window.PriTestDongzhengData` |
| `static_src/dongzheng.js` | 規則引擎（`reduce(state, action)`、結算、任務判定）＋畫面渲染。掛載為 `window.PriTestDongzheng` |
| `site_src/i18n_data_{zh,ja,en}.py` | UI 文字 key（前綴 `dz_`）及首頁 `project_dongzheng_name/desc` |
| `site_src/projects.py` | 新增首頁入口 `dongzheng/index.html` |
| `generate.py` | copy list 加入兩個 JS，`build_pages()` 輸出 `dist/dongzheng/index.html` |

不修改 night／midnight 的任何檔案，也不修改 `database.rules.json`。

規則引擎與渲染寫在同一個 `dongzheng.js` 內，但 reducer 與結算函式不得碰觸 DOM，
並在 `window.PriTestDongzheng` 匯出（`reduce`、`settleTarget`、`evaluateMissions`、`_debugState`），
以便 Playwright 直接驗證。

---

## 3. 開局設定（`setup` 階段）

| 項目 | 選項 |
| --- | --- |
| 玩家人數 | 2～10 人，可輸入名稱（預設「玩家1」…） |
| 初始籌碼 | 「全員一致」（輸入 1 個值，預設 1000）或「個別設定」（每人一個值） |
| 標的數量 | 「依人數」（＝玩家人數）或「自訂」（1～20） |
| 標的類別 | 勾選：歷史／人名／公司行號／風景／物品（至少 1 類） |
| 標的設定 | 「隨機產生」（從勾選類別的池中不重複抽取）或「手動輸入」（名稱＋類別＋標籤），可混用：先隨機，再逐一修改或替換 |
| 任務卡 | 啟用／不啟用 |

確定開局後：
- 每位玩家發 5 張消息牌手牌（牌堆洗牌；牌堆用完則把棄牌堆洗回）。
- 啟用任務卡時，每人秘密抽 1 張任務（不重複），以傳遞遮蔽方式逐人查看。

---

## 4. 一個標的的流程

### 4.1 抽出標的（`reveal_target`）
公開名稱、類別、2～3 個特徵標籤。起始股價固定 **100**。

### 4.2 全員下注（`bet`）
- 在任何消息釋放**之前**完成；確定後不可加碼或下車。
- 逐人遮蔽輸入：押注額 `B`（0 ≤ B ≤ 目前籌碼，整數；B = 0 表示本標的不參與）＋方向（看漲／看跌）。
- 確定時立即從籌碼扣除 `B`。

### 4.3 輪流釋放消息（`news`）
- 系統以隨機順序排列全體玩家；本標的上**每位玩家各擔任一次**股東。
- 每一回合：
  1. 遮蔽畫面「請交給 ○○」→ 本人確認後顯示自己的手牌。
  2. 股東選擇打出 1 張手牌，**和／或**自由輸入一段消息（至少要其中一項）。打出的牌進入棄牌堆，並立即從牌堆補 1 張。
  3. 公開消息（牌面＋自由文字）。
  4. 其他人討論，由主持人輸入全場共識的**加減分**（整數，可為負或 0）。
  5. 股價 = max(0, 股價 + 加減分)，並寫入歷史紀錄。
- 角色名稱依標的類別顯示（僅為名稱，規則相同）：

| 類別 | 角色名稱 |
| --- | --- |
| 公司行號 | 股東 |
| 物品 | 黃牛 |
| 歷史／人名／風景 | 投資客 |

### 4.4 結算（`settle`）
- `Δ = (最終股價 − 100) / 100`
- 看漲：取回 `round(B × (1 + Δ))`
- 看跌：取回 `max(0, round(B × (1 − Δ)))`
- 股價下限為 0，因此看漲最低取回 0；看跌獲利無上限（例如股價 0 時取回 2B）。
- 顯示本標的明細：股價變化歷程、每人押注／方向／取回／盈虧。

然後進入下一個標的；全部結束後進入整局結算。

---

## 5. 整局結算（`final`）

- 最終分數 = 籌碼 ＋ 達成的任務獎勵。
- 依最終分數排名，並顯示每人的任務內容與是否達成、各標的的盈虧一覽。
- 提供「同設定再玩一局」與「回到設定」。

---

## 6. 任務卡（秘密目標）

只收錄**能從遊戲紀錄自動判定**的任務。資料格式：

```js
{ id: "m_bull_big", text: C(ja, zh), reward: 300, check: "bullWinAtLeast", params: { count: 2 } }
```

`check` 對應 `dongzheng.js` 內的判定函式表，判定只讀取 `state.history`（各標的的結算紀錄）與最終籌碼。
初版範例（約 8 張，獎勵與門檻為暫定值，可再調整）：

| 判定 | 內容 |
| --- | --- |
| `bullWinAtLeast` | 看漲且獲利的標的 ≥ N 個 |
| `bearWinAtLeast` | 看跌且獲利的標的 ≥ N 個 |
| `categoryRiseAtLeast` | 指定類別中，有標的最終股價 ≥ X |
| `anyTargetCrash` | 有任一標的最終股價 ≤ X |
| `finalRank` | 最終籌碼（不含任務獎勵）為第 N 名 |
| `allInOnce` | 至少一次押注額 ≥ 當時籌碼的 80% 且獲利 |
| `neverSkip` | 每個標的都有下注（B > 0） |
| `ownNewsSwing` | 自己擔任股東時，有一次加減分的絕對值 ≥ X |

---

## 7. 資料

### 7.1 標的池
```js
{ id, category: "history" | "person" | "company" | "scenery" | "item", name: C(ja, zh), tags: [C(ja, zh), ...] }
```
每個類別先放約 10 個範例。手動輸入的標的存在 state 中（`custom: true`）。

### 7.2 消息牌
```js
{ id, text: C(ja, zh), tone: "up" | "down" | "neutral" }
```
`tone` 只作為畫面提示色。**正式牌表由使用者提供**；在此之前先放約 20 張標示「暫定範例」的牌（牌堆需能供 10 人 × 5 張開局手牌，不足時棄牌堆洗回）。

---

## 8. 狀態模型

```js
state = {
  version: 1,
  phase: "setup" | "reveal_target" | "bet" | "news" | "settle" | "final",
  config: { playerCount, chipsMode, targetCountMode, categories, missionsEnabled, ... },
  players: [{ id, name, chips, hand: [cardId], missionId }],
  deck: [cardId], discard: [cardId],
  targets: [{ id, category, name, tags, custom }],
  targetIndex: 0,
  current: {
    price: 100,
    bets: { [playerId]: { amount, side: "up" | "down" } },
    order: [playerId],      // 本標的的股東順序
    turnIndex: 0,
    news: [{ playerId, cardId, text, delta, priceAfter }]
  },
  history: [{ targetId, finalPrice, news: [...], bets: {...}, payouts: { [playerId]: n } }],
  rngSeed: <number>
};
```

- 所有變更都經過 `reduce(state, action)`（純函式，回傳新 state），之後才 `save()`＋`render()`。
- 隨機性（洗牌、抽標的、股東順序）使用存在 state 中的 seed 驅動 PRNG，使 reducer 具有決定性（第 2 階段同步也需要此特性）。
- 存放於 `localStorage["pritest-dongzheng-state"]`，所有讀寫都包在 try/catch 中；讀到的 `version` 不符或格式錯誤時，捨棄並回到 setup。
- 提供「放棄本局」按鈕（需確認）。
- 傳遞遮蔽是 UI 狀態（`ui.revealedFor`），**不**存進 state，重新整理後回到遮蔽畫面。

---

## 9. 錯誤處理與邊界

- 下注額超過籌碼、負數或非整數 → 停用確定鈕並提示。
- 籌碼為 0 的玩家仍需擔任股東；下注只能是 0。
- 加減分輸入必須是整數；股價以 0 為下限。
- 隨機產生標的但池中數量不足 → 抽完為止，並提示改為手動補足。
- 股東的出牌與自由文字兩者皆空 → 不可送出。

---

## 10. 驗證

1. `node --check static_src/dongzheng.js static_src/dongzheng_data.js`
2. `python generate.py`，用 `python -m http.server 8000 --directory dist` 手動遊玩一局。
3. 臨時 Playwright 腳本（不提交）：3 人 × 3 標的跑完一整局，讀取 `PriTestDongzheng._debugState()` 驗證：
   - 下注扣款與 `settleTarget` 的看漲／看跌取回公式（含股價 0 的邊界）
   - 每個標的每位玩家恰好擔任一次股東
   - 出牌後手牌維持 5 張
   - 任務判定結果與手算一致
   - 重新整理後 state 完整還原
