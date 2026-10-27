# 東正小遊戲（toushou）滿分男模式 設計規格

日期：2026-10-27
狀態：使用者已逐段確認流程與規則，待審閱本文件
前置：
- `docs/superpowers/specs/2026-10-15-toushou-game-design.md`（經典模式、彩池分配、遮蔽傳遞）
- `docs/superpowers/specs/2026-10-15-toushou-multidevice-design.md`（多裝置連線）
- `docs/superpowers/specs/2026-10-16-toushou-swan-sector-design.md`（黑天鵝事件卡）
- `docs/superpowers/specs/2026-10-21-toushou-insider-mode-design.md`（內線模式、`config.mode`）

---

## 1. 目標與範圍

新增第三種遊戲模式「滿分男模式」（`config.mode = "manfen"`），與經典、內線模式並存，開局三選一。

核心概念：《滿分男》× 拍賣 × 心理預測——「你願意為這個缺點付多少？」

> 題目：「他是滿分男，但是他每天都要跟你報備行程。」
> 每個人秘密選擇這個條件對自己而言扣 0、2、5 還是 10 分，再押注預測**全場的平均扣分**。
> 玩家不只表達自己的價值觀，還必須預測別人的價值觀：你可以非常討厭某件事，卻因為知道大家不在意而押低分。

並結合現有的風向卡（改編為「帶風向的人」）與黑天鵝卡（改編為作用於評分與心理戰的專用牌組）。

### 1.1 分成兩個子專案

| 子專案 | 內容 | 狀態 |
| --- | --- | --- |
| **1. 滿分男模式（本 spec）** | 規則引擎、介面、題庫資料 | 本文件 |
| 2. 美術（另開 spec） | SVG 繪製系統＋預留 PNG 插圖（放入同名檔即替換）＋提示詞指南；涵蓋滿分男模式、風向／黑天鵝卡面（三模式共用）、經典／內線介面、17 類別插圖 | 子專案 1 完成後再設計 |

### 1.2 不影響既有模式

經典、內線模式的規則、存檔、測試完全不變。舊存檔缺 `config.mode` 時仍視為 `classic`。

---

## 2. 開局設定

| 設定 | 說明 | 預設 |
| --- | --- | --- |
| `mode` | `classic`／`insider`／`manfen` | `classic` |
| `manfenCategories` | 滿分男專用類別（§6.1），至少勾 1 類（可與下一項合計至少 1 類） | 全選 |
| `categories` | 現有標的類別（§6.3），可不勾 | 不勾 |
| `windEnabled` | 帶風向的人（§4） | 關 |
| `blackSwanEnabled` | 滿分男黑天鵝（§5） | 關 |

選 `manfen` 時，以下設定**隱藏且不生效**：任務卡、板塊連動、加減分方式（主持人／投票）、每票上限。

仍然有效：玩家人數、初始籌碼、題數（＝標的數量，預設依人數）、最低押注、連線模式。

---

## 3. 一題的流程

### 3.1 爆料者輪替

同內線模式 §3.2：開局用 PRNG 抽 `blamerOffset`，第 k 題的爆料者＝座位 `(k + blamerOffset) mod 人數`。題數不是人數的倍數時，設定畫面提示次數不平均。

### 3.2 步驟

| 步驟 | 階段 `phase` | 內容 | 誰操作 | 公開／秘密 |
| --- | --- | --- | --- | --- |
| 1 | `reveal_target` | 顯示滿分對象（名稱＋優點簡介＋標籤）與本題爆料者 | 主持人 | 公開 |
| 2 | `mf_expose` | 爆料者打出一張缺點（§3.3）。打出後公開題目句，並翻開本題黑天鵝卡、抽風向卡（§4） | 爆料者 | 出牌時遮蔽，結果公開 |
| 3 | `mf_rate` | 遮蔽輪流：每人先看到自己的風向身分，再選評分 0／2／5／10（§3.4） | 全員 | 秘密 |
| 4 | `mf_mind` | 心理戰：公開解釋（封口令時禁止）＋封口費競價亮牌（§3.5）。主持人按「結束心理戰」 | 全員／主持人 | 公開 |
| 5 | `bet` | 遮蔽輪流：押注額＋預測群體平均（§3.6） | 有籌碼的玩家 | 秘密 |
| 6 | `settle` | 逐張翻開評分 → 揭曉帶風向者（或「本題沒有」）→ 算群體平均（§3.7）→ 彩池分配 | — | 公開 |

**評分先鎖定 → 心理戰 → 才下注**（使用者確認的順序）：評分在心理戰前鎖定、不可修改；下注放在心理戰之後，亮牌得到的資訊才能用在預測上。

### 3.3 爆料（步驟 2）

- 每位玩家開局發 5 張**缺點牌**手牌（牌堆＝通用缺點牌＋本局出現類別的專屬缺點牌＋勾選的現有類別的利空消息牌；張數不足 `人數 × 6` 時整副複製；用完把棄牌堆洗回）。
- 出牌方式沿用經典模式：直接打出／手牌改寫／純自訂（內容不可空白）。用到手牌就棄牌並補 1 張。
- 可直接打出：通用缺點牌、與本題對象同類別的專屬缺點牌；對象為現有標的時，另加該類別的 `tone: "down"` 消息牌。其他手牌只能改寫。
- 題目句：
  - 滿分男專用類別：依類別的句型，例「他是滿分男，但是{flaw}」。
  - 現有標的：「『{target}』是滿分的，但是{flaw}」。
- 黑天鵝「封口令」不影響爆料（只影響心理戰的公開解釋）。

### 3.4 秘密評分（步驟 3）

- 評分只能是 `0`、`2`、`5`、`10`（代表扣分）。
- 每人進入遮蔽畫面後，先顯示風向身分：
  - 帶風向者：「你是帶風向的人（利多／利空）」。利多只能評 0 或 2；利空只能評 5 或 10。
  - 其他人（含本題沒有帶風向者時的全員）：「你不是帶風向的人」。
- 確定後鎖定，存入 `current.ratings[playerId]`。全員評完自動進入 `mf_mind`。
- 籌碼為 0 的玩家仍要評分（評分會影響平均）。

### 3.5 心理戰與封口費競價（步驟 4）

- 公開解釋為口頭進行，系統不記錄。黑天鵝「封口令」時畫面顯示「本題禁止公開解釋」。
- **亮牌要求**：
  1. 要求者指定一位尚未亮牌的目標，開價 X：`ceil(最低押注 / 2) ≤ X ≤ 要求者目前籌碼`。
  2. 目標選擇：
     - **亮牌**：公開目標的評分（只公開分數，不公開風向身分）。要求者付 X 進彩池。
     - **付封口費拒絕**：目標付 X 進彩池，要求者的 X 也進彩池。目標籌碼 < X 時不能拒絕，只能亮牌。
  3. 被拒絕時，要求者可**加價一次**：開價 X₂（`X < X₂ ≤ 要求者目前籌碼`），目標再選一次亮牌或付 X₂ 拒絕（付款規則同上）。要求者也可以放棄加價。之後這一對的要求結束。
  4. 每人每題最多**發起** 1 次要求（含其加價）；已亮牌的人不能再被要求；同一時間只能有一筆進行中的要求。
- 心理戰階段付出的籌碼記在 `current.mindPot`，結算時與押注合併為彩池。
- 黑天鵝「股東臨時會」：本題 X 的下限減半（`ceil(最低押注 / 4)`）。
- 黑天鵝「逆序發言」：進入 `mf_mind` 時，籌碼最少的玩家（同數依座位順序）自動強制亮牌，不花費籌碼。
- 黑天鵝「全民公審」：進入 `mf_mind` 時，爆料者自動強制亮牌，不花費籌碼。
- 主持人按「結束心理戰」→ 若有進行中的要求，須先處理完。

### 3.6 秘密下注（步驟 5）

- 押注額規則同經典模式 §4.2（最低押注、不足時全押、籌碼 0 不參與）。
- 預測群體平均：0.0～10.0，可到小數一位。不另開 `predict10` 欄位，直接以 ×10 整數存在 `bets[id].predict`（0～100），理由：可直接沿用 `settleTarget(bets, avg10, …)`。黑天鵝「散戶狂熱」時上限為 15.0（150）。
- 預設值為 5.0。

### 3.7 公布與群體平均（步驟 6）

1. **票權**：每人基本 1 票；以下各 +1 票，可疊加：本題帶風向者、黑天鵝「題材炒作」時的爆料者、黑天鵝「主力進場」時押注額最高者（並列者都 +1）。
2. **票值**：評分 ×10 後套用黑天鵝修正（§5 A 類）。
3. **群體平均** `avg10` ＝ round(Σ(票值 × 票權) ÷ Σ票權)，round 為四捨五入、.5 遠離 0；「利多出盡」改用加權中位數（§5）。
4. **彩池**＝全部押注＋`mindPot`（＋紓困加碼）。
5. 參與者依誤差 `|predict − avg10|`（`predict` 為 ×10 整數）排名，沿用經典模式 `settleTarget()`（60/30/10%、並列合併、零頭給排名最前者、守恆）。黑天鵝「爆冷門」「交易取消」「紓困加碼」照 §5 C 類。
6. 結算畫面：每人評分（含票權）、帶風向者身分與方向、平均（顯示到小數一位）、每人押注／預測／誤差／名次／取回／盈虧、心理戰的亮牌與封口費紀錄。

---

## 4. 帶風向的人（風向卡改編）

- 每題在爆料完成時抽一張風向卡（沿用 `WIND_COMPOSITION` 利多 2：利空 2：中立 1，獨立牌堆、PRNG 洗牌、用完重洗）。
- 利多／利空：用 PRNG 從全體玩家中秘密指定 1 位為帶風向者（爆料者也可能被選中）。
- 中立：本題**沒有**帶風向者。
- 未啟用時本題沒有帶風向者，畫面也不提風向。
- 啟用時，畫面一律只顯示「本題**可能**有一位帶風向者」，不論實際有沒有。
- 帶風向者：評分受限（§3.4）、票權 +1（§3.7）。公布時揭曉身分與方向。
- 紀錄：`current.windCard`（`up`／`down`／`neutral`）、`current.windHolder`（playerId 或 `null`）。

---

## 5. 滿分男黑天鵝（專用牌組）

獨立於經典模式的 `SWAN_CARDS`：新增 `MANFEN_SWAN_CARDS` 與 `MANFEN_SWAN_COMPOSITION`。
牌堆 20 張：15 種事件各 1 張＋5 張「平靜」（約 1/4 的題目沒有事件）。爆料完成時翻開，公開顯示到本題結算。
名稱沿用經典模式的盤勢用語（除「全民公審」為新增）。

**A. 改變群體平均**

| id | 名稱 | 效果 |
| --- | --- | --- |
| `circuit` | 熔斷 | 去掉一張最高票值、一張最低票值的票（各去掉一張，含其全部票權）再平均；有效票不足 3 張時不作用 |
| `hype` | 題材炒作 | 爆料者票權 +1 |
| `whale` | 主力進場 | 押注額最高者票權 +1（並列都 +1；沒有人押注時不作用） |
| `fomo` | 散戶狂熱 | 評 10 的票值算成 15（150）；預測上限改為 15.0 |
| `panic` | 恐慌拋售 | 評 2 的票值算成 5（50） |
| `lull` | 量縮盤整 | 所有票值減半 |
| `exhausted` | 利多出盡 | 改用加權中位數：票值由小到大排列並依票權展開，取中間值；偶數時取中間兩值平均（round） |
| `rumor` | 謠言破滅 | 公布時以 PRNG 隨機作廢一位玩家的票（公布前不顯示是誰）；只剩 1 人有票時不作用 |

A 類修正順序：作廢（`rumor`）→ 票值修正（`fomo`／`panic`／`lull`）→ 去極值（`circuit`）→ 平均或中位數（`exhausted`）。

**B. 改變心理戰**

| id | 名稱 | 效果 |
| --- | --- | --- |
| `gag` | 封口令 | 本題禁止公開解釋（亮牌要求仍可進行） |
| `extra` | 股東臨時會 | 亮牌開價下限減半 |
| `reverse` | 逆序發言 | 心理戰開始時，籌碼最少者強制亮牌（免費） |
| `trial` | 全民公審 | 心理戰開始時，爆料者強制亮牌（免費） |

**C. 改變結算**

| id | 名稱 | 效果 |
| --- | --- | --- |
| `cancel` | 交易取消 | `avg10` 在 45～55（含）→ 全員退回押注；`mindPot` 依各人付出額退回；沒有名次 |
| `upset` | 爆冷門 | 依誤差由大到小排名後照原比例分配 |
| `bailout` | 紓困加碼 | 銀行加碼 floor(彩池 × 50%) 一起分配 |

| id | 名稱 | 效果 |
| --- | --- | --- |
| `calm` | 平靜 | 無效果（5 張） |

經典模式的跳空、除權、空頭回補、漲跌停、動能，以及利多出盡的原效果，本模式不使用。

---

## 6. 題庫資料

### 6.1 滿分男專用類別

新檔 `static_src/toushou_data_manfen.js`，以新函式 `registerManfenCategory()` 登錄（不進入經典／內線模式的類別清單）：

```js
registerManfenCategory({
  id, name: C(ja, zh),
  phrase: C(ja, zh),            // 題目句型，例 C("彼は満点男、でも{flaw}", "他是滿分男，但是{flaw}")
  targets: [{ id, name: C, summary: C, tags: [C] }],
  flawCards: [{ id, text: C }]  // 類別專屬缺點牌
});
```

| 類別 id | 名稱 | 句型（zh） |
| --- | --- | --- |
| `mf_man` | 滿分男 | 他是滿分男，但是…… |
| `mf_woman` | 滿分女 | 她是滿分女，但是…… |
| `mf_job` | 滿分工作 | 這是滿分工作，但是…… |
| `mf_home` | 滿分房子 | 這是滿分房子，但是…… |
| `mf_roommate` | 滿分室友 | 他是滿分室友，但是…… |
| `mf_travel` | 滿分旅伴 | 他是滿分旅伴，但是…… |

每類 8～10 個滿分對象（名稱＋優點簡介＋2～3 標籤）、約 12 張專屬缺點牌。

### 6.2 通用缺點牌

約 30 張，`category: null`，任何類別（含現有標的）都能直接打出。

### 6.3 沿用現有標的

勾選的現有類別（`categories`）的標的也會進入題目池，句型為「『{target}』是滿分的，但是{flaw}」；該類別原有的 `tone: "down"` 消息牌可直接打出。

### 6.4 製作流程

先寫中文草稿 `docs/toushou_manfen_data_draft.md` 給使用者審核，通過後才轉成資料並補日文。英文 fallback 至日文（同其他類別）。

---

## 7. 狀態模型（新增欄位）

```js
config: { mode: "manfen", manfenCategories: [..], windEnabled, blackSwanEnabled, ... },
blamerOffset: <int>,
mfSwanDeck: [id], windDeck: [id],
current: {
  blamerId,
  flaw: { cardId, edited, text },        // 爆料內容
  event: null | <manfen swan id>,
  windCard: null | "up" | "down" | "neutral",
  windHolder: null | playerId,
  ratings: { [playerId]: 0 | 2 | 5 | 10 },
  revealed: { [playerId]: "paid" | "forced" },
  requests: [{ from, to, offers: [x1, x2?], outcome: "revealed" | "refused" | "dropped" }],
  pendingRequest: null | { from, to, offer, round: 1 | 2 },
  mindPaid: { [playerId]: n },           // 心理戰各人付出額（交易取消退回用）
  mindPot: n,
  bets: { [playerId]: { amount, predict, chipsBefore } },  // predict 為 ×10 整數
  pot: n
},
history[i]: 上列紀錄＋{ avg10, weights, voidedPlayer, ranks, payouts, cancelled, refundMind, bonus }
// refundMind：非交易取消、且沒有人押注而退回 mindPot 時為 true（見 §9）
```

- 題目句由 UI 依類別句型＋`flaw.text` 即時組出，不存 state（不設 `sentence` 欄位）。
- 全部變更經過 `reduce(state, action)`；隨機性只來自 `state.rng`。
- 新 action：`mfExpose`、`mfRate`、`mfRequest`、`mfRespond`（`reveal`／`refuse`）、`mfRaise`、`mfDrop`、`mfEndMind`；下注沿用 `placeBet`（manfen 時 `predict` 為 ×10 整數）；`nextTarget` 沿用。
- 秘密資訊（評分、帶風向者）與內線模式的 T 相同處理：存在 state，由 UI 依遮蔽狀態決定是否顯示。

---

## 8. 檔案結構

| 檔案 | 變更 |
| --- | --- |
| `static_src/toushou_data.js` | 新增 `registerManfenCategory()`、`MANFEN_CATEGORIES`、`MANFEN_TARGETS`、`FLAW_CARDS`、`MANFEN_SWAN_CARDS`、`MANFEN_SWAN_COMPOSITION` |
| `static_src/toushou_data_manfen.js` | 新檔：6 類別資料＋通用缺點牌 |
| `static_src/toushou_core_manfen.js` | 新檔：滿分男模式的純函式（評分、心理戰、平均計算、結算），掛 `window.PriTestToushouManfen` |
| `static_src/toushou_core.js` | `newGame` 支援 `mode: "manfen"`；`reduce()` 在 manfen 時把新 action 轉交 `toushou_core_manfen.js`；`placeBet`／`settleCurrent` 分支 |
| `static_src/toushou_ui_manfen.js` | 新檔：滿分男模式各階段的畫面 |
| `static_src/toushou.js` | 設定畫面加模式選項與 manfen 設定；各階段轉交新 UI；遮蔽傳遞與結算畫面共用 |
| `static_src/css/toushou.css` | 新增樣式（前綴 `.ts-mf-`） |
| `site_src/toushou_page.py` | `TOUSHOU_SCRIPTS` 加入三個新 JS（data_manfen 在 data 之後；core_manfen 在 core **之後**，因為它要用 `Core._internal`，而 `reduce()` 在執行時才查 `window.PriTestToushouManfen`，所以不需要放在前面；ui_manfen 在 toushou.js 之前） |
| `site_src/i18n_data_{zh,ja,en}.py` | 新增 `ts_mf_*` 字串 zh／ja／en 三語（現有 `ts_` 字串皆三語） |

不修改其他遊戲的檔案，也不修改 `database.rules.json`（連線模式的 rtState 結構不變，只是 state 內容多了欄位）。

---

## 9. 錯誤處理與邊界

- 評分不是 0／2／5／10，或帶風向者選了方向外的分數 → `ts_mf_err_rating`。
- 亮牌開價低於下限或超過要求者籌碼、對已亮牌者發起、本題已發起過、已有進行中的要求 → 對應錯誤 key，不改 state。
- 目標籌碼不足時「拒絕」按鈕停用。
- 心理戰中有進行中的要求時不能結束心理戰。
- 預測值不是 0～上限的整數（×10）→ 停用確定鈕。
- 沒有人押注（全員籌碼 0）→ 本題照常公布平均，彩池 0（`mindPot` 另依下一條退回）；全員籌碼皆 0 時直接整局結算（同經典）。
- 沒有人押注（`bets` 合計 0）時，`mindPot` 依 `mindPaid` 全數退回，避免籌碼消失（`history.refundMind = true`）。黑天鵝「交易取消」生效（`cancelled = true`）時以交易取消為準，`mindPot` 照 §5 C 類退回，`refundMind` 為 `false`；也就是 `refundMind` 只在非交易取消、且無人押注時為 `true`。
- 題目池不足 → 抽完為止並提示。

---

## 10. 驗證

1. `node --check` 三個新 JS 與修改過的 JS。
2. `tools/toushou_check/manfen_core_check.js`（Node）：
   - 爆料者輪替；手牌出牌／改寫／自訂；可直接打出的判定（含現有標的的利空牌）
   - 評分限制（帶風向者利多／利空）、中立時沒有帶風向者
   - 封口費競價：亮牌、拒絕、加價、放棄；每人一次限制；籌碼不足不能拒絕；籌碼守恆（含 `mindPot`）
   - 票權疊加（帶風向＋題材炒作＋主力進場）；平均的 round
   - 15 種黑天鵝逐一檢查，及 A 類的修正順序；交易取消退回 `mindPot`；紓困加碼增加總籌碼；爆冷門
   - 彩池分配沿用 `settleTarget()` 的並列與零頭規則
   - 同一串 action 的結果具決定性
3. Playwright（臨時，不提交）：3 人 × 3 題跑完一整局（啟用帶風向＋黑天鵝），以 `PriTestToushou._debugState()` 驗證各階段與結算；重新整理後還原。
4. 既有 `core_check.js`、`ui_check.js`、`insider_ui_check.js`、`multi_device_check.js` 維持通過。
