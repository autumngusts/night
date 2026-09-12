# 魔術・祈禱：判讀 vs 既有資料 比對與整合（2026-09-12）

> ## 執行結果（已完成）
>
> 使用者已於 2026-09-12 回答 §5 的 Q1〜Q6，以下依裁定全部執行完畢。
>
> | 項目 | 內容 |
> |---|---|
> | **Q1** 23 列重複段 | 裁定為**正確的參照語意**（B表出1＝A1、C表出4/5/6＝B4/B5/A6）→ **保留不動** |
> | **Q2** グラング／グランダ | 裁定 **グラング**（資料正確）→ 不改名，僅修 ja 本文的「HP損**傷**」錯字 |
> | **Q3** FP／骰子／雜兵個數 | 依裁定逐條套用（見下方「已套用」）|
> | **Q4** `art_phantom_pair_strike` | 裁定刪除 → 已刪 |
> | **Q5** 種類存放 | 裁定**新增 `kindLabel` 欄位**，且詳細資訊要一起顯示 → 已加 72 條＋顯示層已接 |
> | **Q6** 同名重複 | 裁定現在一起處理 → 31 條全部刪除 |
>
> ### 已套用（共 186 筆變更）
>
> - `character_drawer.js`：`parseFpCost`／`parseHpCost` 抽成 `parseSquareCost()`，
>   新增 `FP■×4`／`FP×3` 的 ×N 表記支援。**這同時修掉了 3 條原本 FP 算成 0 或 1 的 bug**
>   （黄金樹の護り 0→3、黄金樹の回復 0→4、王たる回復 1→4），night.js 側一併受益。
> - `character_drawer.js`：`resolveWeaponSkillDisplay`／`resolveRandomSkillDisplay` 回傳
>   `kindLabel`，並新增匯出 `weaponSkillDisplayTitle()`＝「種類｜名稱」。
> - `midnight.js`：武器詳細資訊的〔戰技〕〔戰技B〕兩區塊改用 `weaponSkillDisplayTitle()`，
>   因此詳細資訊會顯示「竜餐｜竜爪」這種帶種類的標題。
> - `weapons_skills.js`：82 筆本文／名稱修正 ＋ 31 條同名重複刪除 ＋ 4 條其他刪除
>   （`art_slumber_spear`／`spell_glintblade`／`art_phantom_pair_strike`／`prayer_flies_swarm`）
>   ＋ 72 條 `kindLabel`。條目數 306 → **271**。
> - `spell_transcription_check.js`：加入 `kindLabel` 比對，並更新 `spell_night_comet`
>   的期望名稱（種類已移出名稱）。
>
> ### 驗證結果
>
> | 檢查 | 結果 |
> |---|---|
> | `node --check`（midnight／character_drawer／weapons_skills）| 通過 |
> | `npm run test:spell_transcription` | 通過（19 條 × ja/zh ＋ kindLabel ＋ 決定表 ＋ 固有配對）|
> | `npm run audit:weapon_skills` | art/innate 參照解不開 **0**；同名重複 **30 → 0**；孤兒 **57 → 22** |
> | 雜兵「□」誤用（會讓 midnight 自動扣血）| **4 → 0 條** |
> | `npm run test:consumable_talisman` | 通過 |
> | `npm run test:reward_perperson` | 通過 |
> | `py -3 generate.py` | 建置成功 |
>
> ### 尚未處理：20 條「近似名稱」孤兒
>
> 本文全部截斷（無 `効果` 欄），與已配對條目只差一兩個字，極可能是同一批早期轉錄殘留，
> 但因為不是 Q6 授權的「**同名**重複」，先保留待確認。詳見文末新增的 §6。

---

# （以下為執行前的比對記錄）

# 魔術・祈禱：判讀 vs 既有資料 比對與整合計畫（2026-09-12）

判讀原始記錄：`docs/midnight_spell_transcription_readings.md`
本文件是把判讀結果與 `weapons_skills.js`／`weapons_categories.js` 既有資料逐條比對後的
**待整合清單**。尚未動工，等使用者確認 §5 的問題後才改。

使用者於 2026-09-12 提供的前提：

- 祈禱抽選表**只有 A1〜A6、B2〜B6、C1〜C3**（共 80 列）。
- `art_slumber_spear`（伴眠之槍）規則書**沒有**。
- `art_magic_ray`（魔力の光線）／`art_flame_sweep`（炎の雑払い）是**夜と炎の剣**的
  `art_night_and_flame_stance` 所賦予的子能力。
- `art_phantom_pair_strike`（共撃の幻）是**兩刃劍的隨機戰技**。
- `魔術の輝剣` 是招式名稱；`輝剣` 是它的**魔術種類**，記為「魔術（輝剣）」。

---

## 1. 比對結果總覽：既有資料品質比預期好很多

| 比對項目 | 範圍 | 結果 |
|---|---|---|
| 抽選表 roll → skill id 對應 | 祈禱 80 列 | **100% 一致** |
| 威力數值 | 祈禱 53 條有威力者 | **100% 一致** |
| 屬性／狀態異常蓄積 | 祈禱全部 | **100% 一致** |
| 成本遞減句（使用後成本變更） | 祈禱 8 條 | 7 條有、**1 條缺**（光輪） |
| 自傷句（自身に発狂） | 狂い火系 3 條 | **一致** |
| 使用次數限制（1ターン1度） | 3 條 | **一致** |
| 杖魔術 19 條（批次1 已寫入） | — | 已由 `spell_transcription_check.js` 鎖定 |

> **注意**：我在比對過程中一度因為自寫腳本的 regex 被 heredoc 吃掉反斜線，誤判成
> 「所有祈禱都缺蓄積」。實際上蓄積全部都在且正確。已改用 Write 工具產生腳本避免此問題。

---

## 2. 確定要修的項目（不依賴照片精度，證據在資料本身）

### 2-1. `prayer_urgent_heal`（性急な回復）本文被截斷

```
現況： コスト：③／自身
```

缺 `対象`／`隊列`／`効果` 三欄，是全 90 條祈禱中唯一一條缺 `効果` 欄的。
判讀應為：

```
コスト：③／FP■　対象：自身　隊列：前衛・後衛どちらでも使用可能　効果：対象に「HP回復：□□□」を適用。
```

### 2-2. 4 條 FP 成本用了解析器認不得的寫法 → 遊戲內 FP 算錯

`parseFpCost` 只認 `FP■■■` 這種方塊列舉形式，以下寫法會解析失敗：

| id | 現況寫法 | 實際解析出的 FP | 判讀應為 |
|---|---|---|---|
| `prayer_kings_heal`（王たる回復）| `FP■×4` | **1** | 4（或 8，見 §5-Q3）|
| `prayer_erdtree_protection`（黄金樹の護り）| `FP×3` | **0（完全不扣）** | 3 |
| `prayer_erdtree_heal`（黄金樹の回復）| `FP×4` | **0** | 4 |
| `prayer_erdtree_bounty`（黄金樹の恵み）| `FP×4` | **0** | 2（見 §5-Q3）|

修法：改寫成 `FP■■■` 形式（或擴充 `parseFpCost` 支援 `×N`，但改資料較單純且不動共用解析器）。

### 2-3. `prayer_aimed_lightning_strike`（狙いすます雷撃）成本內部矛盾

```
コスト：③／FP■ … このスキルは「コスト：③／FP■」に変更される（ダイスコストの3が減少）
```

基礎已是 ③，「減少後變成 ③」自相矛盾。**資料自己證明基礎應為 `③③`**，與判讀一致。
這條不需要照片就能斷定。

### 2-4. `prayer_radagons_rings_of_light`（ラダゴンの光輪）雜兵損害用了 `□`

```
現況： モブに「HP損害：□□」
判讀： モブに「HP損害：■■■」
```

`□` 是可計算值、`■` 是不可知值（CLAUDE.md §19）。目前這條會讓 midnight **自動扣 20 點**
雜兵 HP（□2 × 10），而規則書是交給 GM 處理。先前 `midnight_weapon_skill_audit.md` 的
「雜兵 □ 可計算 4 條」就包含這一條，修掉後會變 3 條。

同一條的骰子成本也不一致：資料 `②②②`（合計6）vs 判讀 `②②`（合計4）。

### 2-5. `prayer_wax_swarm`（蝋たかり）是錯字，應為 `蠅たかり`

本文 flavor 明寫「**血蠅**の群れを前方に放つ」、蓄積是「出血：1D」，所以名稱的「蝋」（蠟）
是「蠅」的誤字。而且**孤兒清單裡就有正確的 `prayer_flies_swarm`（蝿たかり）**——
B6／1 目前指向錯字版，正確版反而是抽不到的孤兒。

### 2-6. `prayer_golden_order_fundamentalism_halo`（光輪）缺成本遞減句 ＋ 名稱含種類

- 缺：`このアクション後、フェイズ終了まで、このスキルは「コスト：②」に変更される（FPコスト不要になる）`
- `name.ja` 目前是 `黄金律原理主義｜光輪`，把種類塞進名稱。依使用者的「種類｜名稱」規則，
  名稱應為 **光輪**，種類為 **黄金律原理主義**（種類的存放方式見 §4）。

### 2-7. `spell_glintblade`（輝剣）不是獨立魔術

依使用者說明：`魔術の輝剣` 是招式名稱、`輝剣` 是它的**魔術種類**。因此
`spell_glintblade` 這條獨立 entry 應**移除**，種類「輝剣」記到
`spell_royal_carian_glintblade`（批次1 已改名為 `魔術の輝剣`）上。
這也解釋了為何 `spell_glintblade` 一直是孤兒。

### 2-8. `art_slumber_spear`（伴眠の槍／伴眠之槍）規則書沒有 → 移除

目前是孤兒（無武器掛載、不在任何抽選表），且本文為 `コスト：③／FP■ … 威力：30` 但缺
`効果` 欄。使用者確認規則書沒有這條，可直接刪除。

### 2-9. `art_phantom_pair_strike` 是 `art_phantom_of_union_strike` 的截斷重複

| | `art_phantom_of_union_strike` | `art_phantom_pair_strike` |
|---|---|---|
| 掛載 | **twinblade 隨機表 roll=3** | 孤兒 |
| 威力 | `55＋戦技威力` | `55`（缺「＋戦技威力」）|
| 効果欄 | 有（`【総合ダメージ：威力＋▲】`）| **無** |
| 隊列 | 前衛のとき | 後衛のとき |

使用者說「共撃の幻 是兩刃劍的隨機戰技」——這個條件**已經由
`art_phantom_of_union_strike` 滿足**（它就在 twinblade 表 roll=3）。因此
`art_phantom_pair_strike` 是多餘的截斷副本，建議移除（見 §5-Q4 確認）。

### 2-10. 名稱用字修正

| id | 現況 | 應為 | 依據 |
|---|---|---|---|
| `prayer_unbearable_frenzied_flame` | 堪え**きれ**ぬ狂い火 | 堪え**られ**ぬ狂い火 | 照片 |
| `prayer_dragon_ice_breath` | **龍**氷 | **竜**氷 | 全檔其餘一律用「竜」|
| `prayer_dragon_claw` | **龍**爪 | **竜**爪 | 同上 |

`prayer_dragon_claw` 與 `prayer_dragon_ice_breath` 的 flavor 還有
「己が姿を竜と**なり**」→ 應為「竜と**なし**」（同系其他條都是「なし」）。

---

## 3. 確定為正確現狀、不要動的項目

| 項目 | 說明 |
|---|---|
| `art_magic_ray`／`art_flame_sweep` 為孤兒 | `art_night_and_flame_stance` 本文明寫「効果『魔力の光線』と効果『炎の雑払い』を使用可能になる」，兩者是子能力，本來就不該有自己的抽選格。**現狀正確。** |
| A6／5・A6／6 = ランサクスの薙刀／フォルサクスの雷槍 | 既有資料本來就放在 A6，與批次7 的目錄索引一致。我批次5 暫定為 B1 是錯的，**資料是對的**。 |
| A2／5・6、B5／1・2、C1／1・2、C1／3・4 的併列 | roll 欄位的併合寫法與照片上「一條祈禱兩個骰面」一致。**現狀正確。** |
| `prayer_death_correcting_edict` 的「死に生きる者」條件句 | 已存在於本文。**現狀正確。** |

---

## 4. 魔術／祈禱「種類」的存放方式（待決定，見 §5-Q5）

規則書每格的標題是「（種類）｜（名稱）」，種類例如 石掘り／カーリア／輝剣／不可視／結晶人／
茨／重力／溶岩（魔術側），王都古竜信仰／黄金律原理主義／神狩り／獣／血盟／狂い火／竜餐／
巨人の火／結晶人（祈禱側）。

目前資料的處理方式不統一：

- 多數條目**完全沒記種類**（例：`spell_rock_sling` 只有名稱「岩盤砕き」）
- 少數把種類塞進名稱：`spell_night_comet` = 「夜の彗星（不可視）」、
  `prayer_golden_order_fundamentalism_halo` = 「黄金律原理主義｜光輪」

三個選項：

1. **新增欄位** `kindLabel: C(ja, zh)`（推薦）——資料乾淨，顯示層可自行決定要不要顯示。
   但要改 `resolveWeaponSkillDisplay` 等顯示路徑才看得到。
2. 沿用「名稱（種類）」括號寫法統一到所有條目——不用改程式，但會改動所有顯示名稱。
3. 不記種類，只修 §2-6 那條把種類塞進名稱的不一致——改動最小。

---

## 5. 需要使用者確認的問題

### Q1. B1／C4／C5／C6 這 23 列要怎麼處理？

資料側這四段是**逐行複製**其他段：

| 重複段 | 複製來源 | 列數 |
|---|---|---|
| B1 | = A1（回復系）| 6 |
| C4 | = B4（黒炎系）| 6 |
| C5 | = B5（獣系）| 5 |
| C6 | = A6（雷系）| 6 |

使用者說規則書只有 A1〜A6／B2〜B6／C1〜C3。但如果直接刪掉這 23 列，
**擲骰機制會出現空洞**：B 表第 1 顆骰出 1 沒有結果、C 表出 4／5／6 沒有結果。

參考：**杖的 A／B 兩表就有共用段**（`1・2／N` 的輝石段在 A、B 兩表都各存一份 6 列）。
所以聖印這裡也可能是同一種設計——規則書不重印，但機制上 B 表出 1 就是查 A1。

- **(a)** 這 23 列是規則書刻意的「參照其他段」，資料複製一份是正確做法 → 保留不動
- **(b)** 規則書的 B 表第 1 顆骰只有 2〜6、C 表只有 1〜3（例如改用其他擲骰方式）→ 刪除 23 列
- **(c)** 其他

### Q2. `グランダ` 還是 `グラング`？

`prayer_gurranqs_beast_claw`／`prayer_gurranqs_boulder` 資料寫「**グラング**の獣爪／の岩」，
我在兩張不同照片（條目本體與目錄索引）都讀成「**グランダ**」。
（原作 Elden Ring 的獸之司祭是 Gurranq＝グラング。）以哪個為準？

### Q3. 以下 FP／骰子個數以哪邊為準？

方塊（■）與圓圈數字的個數，是我判讀最沒把握的部分（照片旋轉＋方塊小）。
**若你認為既有資料原本就是照著清晰照片轉錄的，這些應以資料為準。**
以下是差異清單（左＝資料、右＝我的判讀）：

| 條目 | 資料 | 我的判讀 |
|---|---|---|
| A1／2 回復 | FP■ | FP■■ |
| A1／4 王たる回復 | FP■×4 | FP■■×4 |
| A1／6 暗闇 | FP■ | FP■■ |
| A2／5・6 王たる聖防護 | FP■ | FP■■ |
| A3／1 黄金樹に誓って | FP■ | FP■■ |
| A3／2 黄金の魔力防護 | FP■ | FP■■ |
| A3／3 黄金の雷防護 | FP■ | FP■■ |
| A3／6 黄金樹の恵み | FP×4 | FP■■ |
| A4／1 喉袋（モブ）| ■ | ■■ |
| A4／5 黒き剣 | FP■ | FP■■ |
| A5／6 ラダゴンの光輪 | ②②② | ②② |
| B3／4 火よ、降り注げ | FP■ | FP■■ |
| B3／5 悪神の火 | FP■ | FP■■ |
| B3／6 火よ、焼き尽くせ！（FP／モブ）| FP■／■ | FP■■／■■ |
| B4／1 黒炎 | FP■ | FP■■ |
| B5／4 グラングの獣爪（モブ）| （無モブ句）| ■■ |
| C1／1・2 狂い火 | FP■■ | FP■ |
| C1／5 空裂狂火 | FP■ | FP■■ |
| C1／6 シャブリリの叫び | FP■ | FP■■ |
| C2／2〜5 ブレス4條（FP／モブ）| FP■／■ | FP■■■／■■ |
| C2／6 竜爪 | ③ | ③③ |
| C3／1 アギールの炎 | FP■■■ | FP■■ |
| C3／2・3（モブ）| ■ | ■■ |
| C3／4 エグズキスの腐敗 | FP■■■ | FP■■ |
| 固有 黄金の怒り | FP■ | FP■■ |

### Q4. `art_phantom_pair_strike` 可以刪除嗎？

如 §2-9，twinblade 隨機表 roll=3 已經指向本文完整的 `art_phantom_of_union_strike`。
`art_phantom_pair_strike` 是本文截斷的孤兒副本。刪除它，還是反過來讓表指向它？

### Q5. 「種類」要用 §4 的哪個方案？

### Q6. 其餘 28 條「同名重複轉錄」要怎麼處理？

先前 `midnight_weapon_skill_audit.md` 列出 30 條「ja 名稱與已配對條目完全相同」的孤兒。
本次已釐清其中 2 條（`prayer_flies_swarm` 是正確版、錯字版才是被表格指向的；
`art_phantom_pair_strike` 是截斷副本）。剩下 28 條需要同樣逐條核對規則書才能判斷是
「真的重複、可刪」還是「A／B 表各存一份的正常設計」。要現在一起處理，還是先做 §2 的
確定項目？

---

# 6. 尚未處理：20 條「近似名稱」孤兒（待使用者確認）

Q6 授權的是「**ja 名稱完全相同**」的 31 條，已全部刪除。剩下這 20 條是**名稱只差一兩個字**
的孤兒，因此沒有被歸進 Q6。三個共同特徵指向「同一批早期轉錄殘留」：

1. **全部缺 `効果` 欄**（本文長度 8〜47 字，已配對的對應條目是 95〜190 字）
2. 全部不在任何抽選表、也沒有任何武器掛載
3. 名稱與某個已配對條目高度相似

| 孤兒 | 名稱 | 疑似對應的已配對條目 |
|---|---|---|
| `prayer_beastclaw_gnaw` | グラン**ク**の獣爪 | `prayer_gurranqs_beast_claw`（グラン**グ**の獣爪）|
| `prayer_beastclaw_rock` | グラン**ク**の岩 | `prayer_gurranqs_boulder`（グラン**グ**の岩）|
| `prayer_giants_flame_burn` | 火よ焼き尽くせ | `prayer_fire_giant_scorn`（火よ、焼き尽くせ！）|
| `prayer_giants_flame_rain` | 降り注げ（巨人の火）| `prayer_fire_fall_upon`（火よ、降り注げ）|
| `prayer_exkis_rot` | エク**ス**キスの腐敗 | `prayer_ekzykes_decay`（エ**グズ**キスの腐敗）|
| `prayer_borealis_miasma` | ボレアリスの氷**瘴** | `prayer_borealis_mist`（ボレアリスの氷**霧**）|
| `prayer_theodoricks_magma` | テオドリック**の**溶岩 | `prayer_theodorix_lava`（テオドリック**ス**の溶岩）|
| `prayer_crimson_aeonia` | **朱色**エオニア | `prayer_scarlet_aeonia`（**朱き**エオニア）|
| `prayer_bloody_claw_mark` | 血**獄**の爪痕 | `prayer_bloodflame_talons`（血**炎**の爪痕）|
| `prayer_blood_offering` | 血**摂** | `prayer_blood_blessing`（血**授**）|
| `prayer_unquenchable_madness_fire` | 燃えきれぬ狂い火 | `prayer_unbearable_frenzied_flame`（堪えられぬ狂い火）|
| `prayer_wicked_flame` | 悪**炎** | `prayer_flame_of_the_fell_god`（悪**神の火**）|
| `prayer_golden_heal` | 黄金の回復 | `prayer_erdtree_heal`（黄金**樹**の回復）|
| `spell_lichdragons_lament` | ライカードの怨**嗟** | `spell_rykards_rancor`（ライカードの怨**霊**）|
| `spell_star_shower` | 星**殺ぎ** | `spell_star_shatter`（星**砕き**）|
| `spell_thops_barrage` | ト**ー**フスの大弓 | `spell_thops_barrier`（ト**ープ**スの力場）／`spell_lorettas_greatbow`（ローレッタの大弓）|
| `prayer_royal_ancient_faith` | 王古き者信仰 | （對應不明）|
| `spell_scattershot_crystal` | 巻壁砕破 | （對應不明）|
| `spell_ice_spit` | 氷の唾 | （對應不明）|
| `spell_crystal_person` | 結晶人 | **疑似「種類」而非招式名**——與 `spell_glintblade`（輝剣）同性質，該條已依 Q5 裁定刪除 |

## 建議

- 前 16 條的對應關係明確、本文又都是截斷版，建議比照 Q6 一併刪除。
- `spell_crystal_person`（結晶人）看起來是「魔術（結晶人）」的種類標籤被誤存成招式，
  跟 `spell_glintblade`（輝剣）完全同一種情形，建議刪除。
- 剩下 3 條（`prayer_royal_ancient_faith` 王古き者信仰／`spell_scattershot_crystal` 巻壁砕破／
  `spell_ice_spit` 氷の唾）找不到對應的已配對條目，需要確認規則書是否真的有這三條。

## 另外 2 條孤兒是正確現狀，不要動

`art_magic_ray`（魔力の光線）／`art_flame_sweep`（炎の雑払い）——
`art_night_and_flame_stance` 本文明寫會賦予這兩個效果，是子能力，本來就不該有抽選格。

---

# 7. 比對中發現、但使用者尚未裁定的差異

| 條目 | 資料現況 | 我的判讀 |
|---|---|---|
| `prayer_fire_fall_upon`（火よ、降り注げ）| エネミーが「サイズ：**L**」| 「サイズ：**LL**」|
| `prayer_fire_giant_scorn`（火よ、焼き尽くせ！）| エネミーが「サイズ：**L**」| 「サイズ：**LL**」|
| `prayer_golden_fury`（黄金の怒り）| 【総合ダメージ：**威力**】| 【総合ダメージ：**威力＋▲**】|
| `prayer_lansseaxs_glaive`（ランサクスの薙刀）| 有エネミー句 | 照片上讀不到エネミー句（推測有）|
| `prayer_crucible_aspect_tail`（坩堝の諸相・尾）| 無エネミー【総合ダメージ】句 | 照片上也讀不到（推測有）|

前三條若要改，請告知以哪邊為準。後兩條是我判讀不確定，資料可能才是對的。

---

# 8. 第二批執行（2026-09-12，§6／§7 全部結案）

## 前提驗證（使用者指定的條件）

使用者的條件是「**如果所有魔術祈禱的隨機招式抽選都有配對到了**，就能把近似名稱都移除乾淨」。
刪除前以腳本驗證，三項全部成立：

| 驗證項目 | 結果 |
|---|---|
| 全 28 個分類的隨機抽選表每一列都解得開 | ✓（杖 60 列、聖印 103 列、其餘各 5〜6 列，未配對 **0**）|
| 全部武器的固定 skill ref 都解得開 | ✓（201 個 ref，未配對 **0**）|
| 待刪 20 條是否被抽選表／武器／其他招式本文引用 | ✓ **0 條被引用** |

## §7 兩項裁定已套用

| 條目 | 修正 |
|---|---|
| `prayer_fire_fall_upon`（火よ、降り注げ）| `サイズ：L` → **`サイズ：LL`**（ja／zh）|
| `prayer_fire_giant_scorn`（火よ、焼き尽くせ！）| `サイズ：L` → **`サイズ：LL`**（ja／zh）|
| `prayer_golden_fury`（黄金の怒り）| 【総合ダメージ：威力】→ **【総合ダメージ：威力＋▲】**（ja／zh）|

（原 §7 的後 2 條——ランサクスの薙刀／坩堝の諸相・尾 的エネミー句——是我照片判讀不確定、
資料本來就有該句，因此不動。）

## §6 的 20 條近似名稱孤兒已全部刪除

包含使用者另外指名的 `prayer_royal_ancient_faith`（王古き者信仰）／
`spell_scattershot_crystal`（巻壁砕破）／`spell_ice_spit`（氷の唾）。

## 最終狀態

| 指標 | 整合前 | 整合後 |
|---|---|---|
| `weapons_skills.js` 條目數 | 306 | **251** |
| 孤兒（抽選表與武器都到不了） | 57 | **2** |
| 同名重複轉錄 | 30 | **0** |
| 近似名稱孤兒 | 20 | **0** |
| art／innate 參照解不開 | 4 | **0** |
| 雜兵誤用「□」（會讓 midnight 自動扣血） | 4 | **0** |

**剩下的 2 條孤兒是正確現狀**：`art_magic_ray`（魔力の光線）／`art_flame_sweep`（炎の雑払い）
是 `art_night_and_flame_stance`（夜と炎の剣）本文明寫會賦予的子能力，依設計不該有抽選格。

也就是說——**`weapons_skills.js` 裡現在每一條招式，都不是配對到某個武器／抽選格，
就是有明確出處的子能力，沒有任何死資料。**

## 驗證

| 檢查 | 結果 |
|---|---|
| `node --check` × 3 檔 | 通過 |
| `npm run test:spell_transcription` | 通過 |
| `npm run audit:weapon_skills` | 孤兒 2（皆為子能力）、參照解不開 0 |
| `npm run test:consumable_talisman` | 通過 |
| `npm run test:reward_perperson` | 通過 |
| `py -3 generate.py` | 建置成功 |
