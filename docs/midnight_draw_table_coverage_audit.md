# 武器／戰技／魔術／祈禱 抽選表覆蓋率驗證報告

產出工具：`tools/midnight_check/draw_table_coverage_check.js`
執行方式：`npm run check:draw_coverage`（於 `tools/midnight_check/`）
本次執行日期：2026-09-12

---

## 1. 驗證範圍與方法

本次驗證回答的問題是：**擲骰抽選時，每一個可能的出目是不是都真的抽得到東西。**

與既有的 `weapon_skill_audit.js`（檢查資料裡的 id 參照解不解得開）角度不同，本腳本直接呼叫
`character_drawer.js` **內部的真實抽選函式**（載入前以字串注入把內部函式掛到
`window.__PriTestDrawInternals`），而不是另外重寫一份規則，避免出現「腳本說沒事、App 實際會落空」的落差。

被驗證的函式：

```text
parseRollRange              武器出目範圍（"1〜2"）解析
pickWeaponByRoll            分類 × 稀有度 × 1D → 武器
lookupRarityBySum           擲骰合計 → 稀有度
resolveSimpleTableRoll      1D 隨機戰技決定表
resolveNamedTableRoll       2D 具名決定表（杖的魔術 A/B、聖印的祈禱 A/B/C）
findCategoryIdByMinorLabel  小分類決定表的名稱 → 實際分類 id
resolveRandomSkillForItem   武器隨機戰技槽的實際解決流程
drawWeaponFromCategory      場地獎勵／商人／塔謎題實際使用的一發抽選
```

驗證區塊：

| 區塊 | 內容 | 規模 |
| --- | --- | --- |
| ① | 〔4-1〕大分類 →〔4-2〕小分類決定表，1D 出目 1〜6 是否都解得出實際分類 id | 6 張表 × 6 格 |
| ② | 武器抽選表：分類 × 稀有度 C/U/R/L × 1D 出目 1〜6 | 128 區間 ×6＝768 格 |
| ③ | 每把武器的固有戰技／魔術／祈禱（`innate`／`art`）參照 | 379 把武器 |
| ④ | 隨機戰技／魔術／祈禱決定表窮舉（1D 表 6 格、2D 具名表 36 格） | 31 張表、336 格 |
| ⑤ | 杖／聖印專章：固有魔術・祈禱齊備度、抽選表字母 A/B/C 的對應 | 17 杖 ／ 15 聖印 |
| ⑥ | runtime 抽樣：實際走 App 抽選路徑重跑 | 32 分類 ×600 次、203 把武器 ×60 次 |

---

## 2. 本次修正的兩個程式缺陷

兩者都是**出目格式解析器沒有支援資料裡實際存在的寫法**，屬於實作缺陷，不涉及規則數值猜測。

### 2.1 `resolveSimpleTableRoll` 不支援範圍寫法（拳・爪的隨機戰技永久抽不到）

原本的比對是字串完全一致：

```js
return String(r.roll) === String(d1);
```

但拳（fist）與爪（claw）的 `randomSkillTable` 首列依規則書寫成 `{ roll: "1〜2", id: "art_kick" }`。
`"1〜2" === "1"` 永遠不成立，因此**出目 1 與 2 時解不出任何戰技**，
`resolveRandomSkillForItem()` 回傳 `skillId: null`，UI 顯示「無對應」訊息。

影響範圍：拳・爪全部帶隨機戰技槽的武器，1/3 的擲骰結果落空。

### 2.2 `resolveNamedTableRoll` 右側出目只取第一個數字（聖印的 5 條祈禱抽不到）

原本右側是 `parseInt(parts[1], 10)`，遇到規則書的複數出目寫法只會取到第一個數：

| 表 | 資料列 | 原本可抽到 | 原本抽不到 |
| --- | --- | --- | --- |
| 隨機祈禱（A） | `"2／5・6"` → 王的聖障壁 | 2／5 | **2／6** |
| 隨機祈禱（B） | `"5／1・2"` → 獸之爪 | 5／1 | **5／2** |
| 隨機祈禱（C） | `"1／1・2"` → 狂火 | 1／1 | **1／2** |
| 隨機祈禱（C） | `"1／3・4"` → 難忍的狂火 | 1／3 | **1／4** |
| 隨機祈禱（C） | `"5／1・2"` → 獸之爪 | 5／1 | **5／2** |

合計 36 格中有 5 格（A 表 1 格、B 表 1 格、C 表 3 格）擲出後解不出任何祈禱。

### 2.3 修正內容

於 `character_drawer.js` 新增共用的出目解釋 helper，兩個決定表函式都改用它。
它同時接受單值 `"3"`、複數值 `"1・2"`、範圍 `"1〜2"` 三種寫法，並重用既有的 `parseRollRange()`：

```js
function rollCellMatches(cell, die) {
  return String(cell || "")
    .split("・")
    .some(function (part) {
      var range = parseRollRange(part.trim());
      return !!range && die >= range[0] && die <= range[1];
    });
}
```

修正後 ④ 區塊的 336 格出目**全部通過**，⑥ 區塊 203 把帶隨機槽武器 ×60 次抽樣**落空 0 次**。

---

## 3. 補齊的資料項目（規則書確認：2026-09-12）

### 3.1 各分類「無對應項目時的再抽選」指示

| 分類 | 稀有度・出目 | 規則書指示 |
| --- | --- | --- |
| 弓 | U 出目⑥ | 於 U 表重新抽選；**若再次擲出⑥則取出目⑤（角弓）** |
| 弓 | L | 改於 U 表重新抽選 |
| 弩 | L | 改於 U 表重新抽選 |
| 弩砲 | C | 改於 R 表重新抽選 |
| 弩砲 | L | 改於 U 表重新抽選 |
| 小盾／中盾／大盾 | L | 改於 R 表重新抽選 |
| 聖印 | L | 改於 R 表重新抽選 |
| 短劍／刺劍／兩刃劍／斧／斧槍／鐮／爪 | L | 改於 R 表重新抽選（既有） |
| 大劍 L⑥／特大劍 L⑤〜⑥ | — | 於 L 表重新抽選（既有） |

上述每一項都在 `weapons_data.js` 收錄為 `kind: "note"` 占位項目，並新增機器可讀的 `reroll` 欄位：

```js
{
  id: "bow_u_reroll", category: "bow", rarity: "U", roll: "6",
  reroll: { rarity: "U", fallbackRoll: 5 },   // ← 抽選側がこれを見て自動で振り直す
  skills: [{ kind: "note", text: C("Uの表で再抽選する。再度⑥が出た場合は出目⑤（角の弓）を獲得する。", "…") }],
}
```

`reroll.rarity` 是改抽的目標表，`reroll.fallbackRoll` 是「同表重抽又落在同一格時，規則書指定改取的出目」
（目前只有弓的 U⑥ 用到）。既有的 9 筆占位也一併補上 `reroll`，短劍 L 原本只有分類備註、沒有占位項目，
也依同格式補上 `dagger_none_l`。

### 3.2 淑女的短劍

裝備品技能與「魔力的短劍」相同，即固有戰技「魔匕首步（魔ダガーステップ）」。
原本 `skills: []` 並註記「規則書未確認」，現已補上 `{ kind: "innate", id: "dagger_step" }`。

---

## 3A. 抽選流程：依規則書自動改抽

原本四條抽選路徑都是「重擲出目，最多 20 次」的重試，並不是規則書指定的「改抽○表」：

* `potentialPowerDrawWeapon()`（潛在之力）
* `autoResolveWeaponDraw()`（簡化抽選）
* `merchantDrawWeapon()`（商人）／`drawWeaponFromCategory()`（場地・塔謎題指定分類）
* 手動精靈的〔②擲骰決定武器〕按鈕

其中前兩者的稀有度是固定的，因此在「L 表不存在」的分類（弓・弩・盾・聖印等）會 20 次全部落空，
**武器獎勵直接消失**；後兩者會重擲稀有度，雖然最終多半能抽到，但機率分布偏離規則書
（例如弩砲 ★1 有約 2/3 的擲骰被丟棄）。

現在新增 `pickWeaponByRollWithReroll()` 集中處理規則書的再抽選指示，四條路徑全部改用它。
`pickWeaponByRoll()` 本身維持「只查表」的純函式，再抽選的手順只存在一處。
每一次改抽的經過會記在 `itemRerollSteps`，並在下列兩處顯示給 GM／玩家：

* 抽選精靈（`renderWeaponRollField`）
* night 的潛在之力視窗（`night_potential_power.js`）

顯示範例（實機輸出）：

```text
出目：5（L表）　此稀有度不存在此武器，改於R表重新抽選。　→　改抽R表，出目：6
```

新增的 i18n key：`weapon_roll_item_reroll_step`／`weapon_roll_item_reroll_next`／
`weapon_roll_item_reroll_fallback`（zh／ja／en 三語）。

---

## 3B. night 側規則書顯示

night 的「武器」規則書頁籤（`night_weapon_rulebook.js`）做了兩項更新：

1. **種類決定表新增「備註」欄**（i18n key `weapon_note_column_label`）。
   占位列（「（L稀有度無對應武器）」等）原本只有名稱、看不出用途，現在會直接顯示
   「此稀有度不存在此武器，改於R表重新抽選。」；其他 `kind: "note"` 的記載
   （例如滑車之弩的「武器威力40＋▲」）也一併顯示。
2. **新增規則條目「抽選表無對應項目時的重新抽選」**（`weapon_rulebook.js` 的 `rerollNote()`），
   整理全部分類的再抽選對應，接在「★＝稀有度決定值」之後。

midnight 頁只載入 `weapon_rulebook.js`（資料）而沒有規則書 UI，抽選則與 night 共用
`character_drawer.js`，因此同一份修正兩邊都生效。

---

## 4. 目前驗證結果

腳本以 exit 0 結束（**全部通過**）。

| 區塊 | 結果 |
| --- | --- |
| ① 分類決定表 | 通過（6 張小分類表 ×1〜6 全部解得出分類；杖／聖印依規則書不經此表） |
| ② 武器抽選表 | 768 格中 94 格表上沒有武器，**全部都能依規則書的 `reroll` 指示自動改抽並取得武器**（腳本會實際跑 40 次確認每一格都解得出來） |
| ③ 固有戰技／魔術／祈禱 | 通過，379 把武器的 `innate`／`art` 參照全部解得開 |
| ④ 隨機決定表窮舉 | 通過（31 張表、336 格出目，落空 0） |
| ⑤ 杖／聖印 | 杖 17 件固有魔術 17/17、聖印 15 件固有祈禱 15/15 齊備；抽選表 A/B/C 都有杖・聖印引用，無死表 |
| ⑥ runtime 抽樣 | 32 分類 ×600 次 ★1 抽選落空 0；隨機戰技 203 把 ×60 次落空 0；弓 U⑥ 的 `fallbackRoll` 400 次確認會觸發且落點正確 |

### 4.1 杖／聖印細節

```text
杖(staff)    ：17 件；固有魔術 17/17；帶隨機槽 16/17；抽選表使用次數 A=9、B=7
聖印(sacred_seal)：15 件；固有祈禱 15/15；帶隨機槽 14/15；抽選表使用次數 A=6、B=6、C=2
```

各少 1 件隨機槽的是初期裝備（杖：隱者的杖／聖印：手指的聖印〈復仇者初期裝備〉），
兩者依規則書都是固定持有 2 個固有魔術・祈禱、不帶隨機槽，屬正常。

---

## 5. 剩餘的參考事項

抽選表本身已無缺口。以下僅為資料層的參考狀況，不影響抽選：

* **一條戰技都沒有的武器 2 把**：手持式弩砲（`ballista_handheld`）／壺大砲（`ballista_pot_cannon`）。
  `weapons_data.js` 註解已載明「依種類決定表照片修正，裝備品技能為『なし』」，屬規則書確認結果。
* **孤兒戰技 2 條**（`weapon_skill_audit.js` 的既有報告）：`art_magic_ray`（魔力的光線）／
  `art_flame_sweep`（炎的雜清）。兩者是其他招式本文以「…」引用的子能力
  （「夜與焰之構」賦予），沒有單獨的抽選配對是正確的。
* 杖的隨機魔術 A／B 表各 30 列、聖印的隨機祈禱 A／B／C 表各 35／35／33 列，
  對照規則書的 A1〜A6・B1〜B6（杖）與 A／B／C 各群（聖印），仍有部分列尚未謄寫完。
  這是資料量的問題，不是抽選程式的缺口——**現有列的每一個出目都抽得到東西**（④區塊全通過）。

---

## 6. 回歸驗證方式

```bash
cd tools/midnight_check
npm run check:draw_coverage          # 有落空時 exit 1
node draw_table_coverage_check.js --md   # 輸出 Markdown
```

改動 `weapons_data.js`／`weapons_categories.js`／`weapons_skills.js`／`character_drawer.js`
的抽選相關程式後重跑即可。腳本會同時檢查：

* 靜態窮舉（表上每一格出目）
* `reroll` 指示是否真的能自動改抽到武器（不只是「有占位說明」）
* 真實抽選路徑（`drawWeaponFromCategory`／`resolveRandomSkillForItem`）的抽樣
* 弓 U⑥ 的 `fallbackRoll` 分支

新增或修改占位項目時，務必一併給 `reroll` 欄位，否則腳本會以
「有占位說明但自動再抽選解不出武器」失敗。
