# 2026-08-08 GM回報問題修正摘要

19項問題已全數實作完成，並已提交、推送至 `origin/main`（commit `dec7cbc`）。

`python generate.py`（Windows 用 `py -3 generate.py`）建置通過；並用 Playwright 對建置後的
`dist/` 做過端到端煙霧測試（建立遊戲、開設定選單、開規則書各分頁、送出 `/rune` 指令），
全程零 JS 執行期錯誤（僅有既有的敵人圖片404，與本次修改無關）。

## 各項目修正內容

### 獎勵/盧恩系統
- 手機端獎勵清單版面：`.wb-row`/`.floor-reward-entry-row` 改為可換行，`#turn-reward-list`
  可獨立捲動，並新增 640px 以下的手機斷點（`static_src/style.css`）。
- 跨裝置重複領取盧恩：`GameStorage.subscribeNightState` 的回呼補上
  `turn-reward-modal`/`floor-reward-modal`/`breakthrough-modal` 的重繪守門（`night.js`）。
- 武器獲得預設分類：`resetWeaponRollState()` 預設改為 `categoryId:null, categoryResolved:false`
  （即「武器」大分類擲骰流程），不再靜默預設為短劍（`character_drawer.js`）。
- 「擊破盧恩：N」文字自動偵測：新增 `parseRuneAmountFromText`/`grantRuneToAllEntered`/
  `appendRuneGrantRowIfDetected`，涵蓋樓層卡（`renderFloorRewardSection`）、敵人規則書
  （`renderEnemyRulebookList`）、事件規則書（沿用 `renderFieldLine`）三處，GM可在發放前調整數值。
- 潛在能力獎勵文字縮短為「【角色名】全員獲得潛力：★×N」，補充說明移至次要灰字行。

### 設定選單／角色／戰鬥機制
- 新增「重置全骰」按鈕（`handleResetAllDice`）：清空共用骰子池、各角色骰子、執行紀錄。
- 「返回角色列表」移入設定選單，避免公開盤誤觸。
- 玩家資訊新增即時的「目前○○區域＆敵視為N」（`renderLiveBattleStatusLabel`），取代原本骰子池
  清空後就失效的預測文字；隊列切換/敵視±時同步重繪角色列表。
- 入場（已入場勾選）時自動裝備角色類型的初始武器（`bindFieldSave("char-entered", ...)`）。
- 建立通用「本回合限用1次」機制：`parseOncePerTurnRestriction` 自動偵測本文文字，
  `c._entryUsedThisTurn` 於新回合（防禦→戰鬥）重置，涵蓋踢擊×2／拒絕／黃金之怒／
  貴種的腹藝／盾擊共6個技能。
- 學者「博聞強識」改為依實際支付骰子出目（5或6）自動判定是否消耗使用次數，移除原本
  預設不反白的手動Yes/No詢問；節約術（出目6回復1次，已確認原本邏輯正確）維持不變；
  兩者皆在消耗品面板新增使用時機提示文字。

### 調香瓶（consumables.js + night.js applyConsumableEffect）
- 5項道具（酸之噴霧／鐵壺之香藥／火花之香／高揚之香／毒之噴霧）`uses` 由2改為1，
  body文字「使用次數：○○...使用次數●」補上正確數值「使用次數：1　消耗：③」。
- 火花之香／毒之噴霧：傷害由1D骰改為GM提供的固定數值（Lv1=1，Lv2累計=3）。
- 酸之噴霧：「-120不重複」提示同步寫入「目前生效中的效果」清單（`state.activeThreatEffects`），
  不只出現在一次性執行紀錄。
- 鐵壺之香藥：「下個行動階段體力骰-1」改為透過既有 `_nextActionDicePenalty` 機制自動套用。
- 高揚之香：確認原本數值（1Hit+5/2Hit+10、戰技+5、HP價值+10，Lv2雙倍）已正確自動化，未變動。

### 樓層卡／板塊
- 卡牌等級按鈕依該卡牌 `floorCount` 動態限制步進範圍（0,1,...,floorCount,全），
  不再固定0-5（`levelStepsForSlot`/`stepCardLevel`）。
- 等級達「全」時自動解析卡牌 `allFloorEffect` 文字，發放盧恩給全體入場角色並公告時間損耗
  （`grantCardFullClearRewardIfNeeded`），以卡牌code防止重複發放。
- 修正保留卡牌（`submitKeepCards`）跨日後 `renderSlotEffect` 只查當前日期表格導致地點文字消失
  的問題：改為當前日查無結果時，退回查另一日的表格。
- 新增放回牌庫的長按復原機制：`recordReturnedCard`/`restoreReturnedCardIfAny`，
  以 `state.returnedCardMemory` 記錄每格最近一次被放回牌庫的內容。
- 「第二天起點在右邊」：程式碼邏輯（`isSwappedDay`/CSS swap/`pileAdjacentSlotIndices`）
  讀來自洽，未發現明顯bug，**需要實際在瀏覽器中跑一次第二天流程確認是否仍會重現**。

### 潛在之力／公開盤／廣播
- 潛在之力的武器戰技改為可展開的詳細說明（沿用規則書分頁的 `renderWeaponSkillRefEntry`），
  已抽選的隨機戰技會解析為實際戰技內容而非「未決定」。
- 公開盤角色武器欄名稱前綴稀有度色塊■（C白U藍R紫L金，`.weapon-rarity-*`）。
- Time Loss廣播：新增威脅效果時會公告實際文字內容（原本只有通用「追加1個效果」且從未真正顯示），
  常駐列（`renderTimeLossSummary`）新增「目前 Time Loss N個效果」計數。
- 畫面上方常駐目前所在位置資訊（`renderCurrentLocationStatus`）：卡牌名正常字色，
  樓層數／全效果等資訊以灰字（`.loc-detail`）呈現。

### 留言板快速指令
- `/cleardice`、`/rune x`、`/clearenemy` 三個指令（`handleChatCommand`），
  規則書新增「指令」分頁（`renderCommandsRulebook`）列出用法。

## 尚待確認事項
- 「第二天起點在右邊」的重現情境（若仍會重現，麻煩告知是哪個劇本/操作步驟）。
