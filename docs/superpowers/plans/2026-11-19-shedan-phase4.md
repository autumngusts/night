# 射彈宇宙 第 4 階段 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 一局完整的肉鴿遠征：3 星區的分支地圖、7 種節點（戰鬥、精英、漂流者、補給站、異常訊號、休息、Boss）、遺物 100 件與 10 種套裝、精英敵人。

**Architecture:**
- `shedan_data_relics.js`：100 件遺物（標籤、稀有度、參數）、10 種套裝、8 則事件、`D.computeMods(ids)` 把持有的遺物＋套裝攤平成一個 `mods` 物件（數值加總、旗標）。
- `shedan_run.js`（新）：**肉鴿規則核心**，不碰 DOM 與物理，最終移植成 Go。地圖產生、節點結算、獎勵抽選、補給站、休息、漂流者、事件、精英生成、隊伍 HP 換算。所有亂數由「局種子＋節點 id」衍生，可重現。
- `shedan_combat.js`／`shedan_physics.js`：讀 `b.mods` 的掛鉤（不為單一遺物寫獨立架構，全部走 mods）。
- `shedan.js`：遠征流程畫面（地圖、節點、獎勵、商店、事件、休息、漂流者、結算）；原本的「戰場」選擇改放在「試玩戰場」。

## Global Constraints

- 規則依據：`docs/shedan_game_design.md` §9、§10、§10.1、§11、§11.1。
- 存檔、每日星圖、星塵與解鎖在第 5 階段；這一階段的遠征只存在記憶體。
- 選隊仍開放 30 人（解鎖在第 5 階段）。
- 版本 `2.73.0`；只推 `private`。

## 介面約定

```js
D.RELICS / D.RELIC_BY_ID      // {id, name, tags[], rarity:"common"|"rare"|"legendary", p:{...}, requires?}
D.SETS                        // {tag: {name, t3:{...mods}, t5:{...mods}}}
D.EVENTS                      // [{id, name, text, a:{label, effect}, b:{label, effect}}]
D.computeMods(relicIds) → mods   // 加總後的數值／旗標，戰鬥與遠征都讀它

Run.create({seed, heroes:[id×4]}) → run
Run.mapOf(run) / Run.reachable(run) / Run.enter(run, nodeId) → node
Run.battleSetup(run, node) → {enemies, field, boss, elite, mods, hp, hpMax}   // 給 Combat.create
Run.finishBattle(run, node, result:{win, hp}) → {energy, choices:[relicId]}
Run.takeRelic(run, id) / Run.shop(run, node) / Run.buy(run, node, i) / Run.repair(run, node)
Run.rest(run, "heal"|"upgrade", heroIndex) / Run.drifter(run, node) / Run.rescue(run, node, pay, replaceIndex|null)
Run.event(run, node) / Run.choose(run, node, "a"|"b") → outcome
run.state: "map" | "node" | "won" | "lost"
```

---

### Task 1: 遺物資料、套裝、事件、computeMods
- [ ] 測試：100 件（10 標籤各 9 件主標籤＋無標籤 10）、稀有度 10／30／60、套裝 10 種、事件 8 則、computeMods 加總與套裝門檻（3／5）。
- [ ] 實作；Commit。

### Task 2: 遠征規則核心 `shedan_run.js`
- [ ] 測試：同種子地圖相同；每層 2～4、第 1 層全戰鬥、第 1～2 層無精英、第 4 層有休息、每節點可達且有出路、第 7 層連 Boss；只能走到相連節點；戰鬥獎勵（能源、三選一、精英保證稀有、幸運骰 4 選、已持有不重複、雙重殘影的前置）；補給站價格與商人會員卡；休息兩種；漂流者兩種代價與替換後 HP 換算；8 則事件的效果與拾荒者之手；精英（HP ×2.5、精英特性）；Boss 星區 3 勝利 → won；HP 0 → lost（救生艙例外由戰鬥處理）。
- [ ] 實作；Commit。

### Task 3: 戰鬥與物理的遺物掛鉤
- [ ] 測試（每個標籤至少 3 件代表＋全部套裝）：數值類（引信強化、屬性透鏡、編隊通訊器、反應類、質量增幅器、技能迴路、指揮官徽章…）、觸發類（連鎖雷管、煙火庫、羈絆電路、合體訊號、星座爆破、新星標記、擊破充能、二段技能、溢流儲存、緊急超頻、偏轉護盾、緩衝氣墊、嘲諷信標、反擊裝甲、救生艙、再生裝甲、隕鐵外殼、撞擊鑽頭…）、開場類（不穩定核心、時間緩衝、充能電池、微型奇點、碎片 3、小行星牽引）、精英特性。
- [ ] 實作；Commit。

### Task 4: 遠征畫面與整合
- [ ] 選隊 → 「開始遠征」／「試玩戰場」；地圖畫面（可走節點高亮、雷達顯示）；戰鬥；獎勵三選一；補給站；休息；漂流者；事件；遠征結算（通關／全滅、抵達節點、總傷害、最大連爆）。
- [ ] 遠征中隨時可看持有遺物與套裝進度。
- [ ] `ui_check.js`：自動走完一局（戰鬥用 debug 強制勝利，其他節點選第一個選項）不出錯；全部 100 件遺物同時持有打一輪不出錯。
- [ ] 版本 `2.73.0`，Commit，push。
