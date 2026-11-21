# V 企劃室（vkikaku）第 1 階段 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 做出可以從第 1 週玩到第 24 週結局的「V 企劃室」：2 位 Vtuber 的事務所，每週排行程板 → 企劃會議（卡牌組合＋回合制談判）→ 直播（管理員挑留言）→ 週報。

**Architecture:** 規則核心分成 `vkikaku_rng.js`（確定性亂數）、`vkikaku_meeting.js`（會議 → `streamConfig`）、`vkikaku_stream.js`（`streamConfig`＋種子＋輸入紀錄 → `streamResult`）、`vkikaku_office.js`（週循環、行程板、週報、結局）。四者都不碰 DOM、不讀寫 localStorage，只用允許的運算，之後照著移植成 Go。資料在 `vkikaku_data.js`、`vkikaku_chat_data.js`；存檔在 `vkikaku_save.js`；畫面在 `vkikaku_ui_*.js` 與 `vkikaku.js`。

**Tech Stack:** Vanilla ES5 IIFE、Python 產生靜態 HTML（`generate.py`）、Node `assert` 的規則檢查、Playwright 的畫面檢查。不使用任何外部函式庫。

## Global Constraints

- 規則依據：`docs/vkikaku_design.md`（§1～§5 標「P1」的部分是本階段範圍）。數值全部「暫定」，集中在 `vkikaku_data.js`，不要散落在程式裡；本計畫列出的數值就是初始值。
- 前綴：JS `window.PriTestVkikaku*`、i18n 鍵 `vk_`、CSS class／id `vk-`。樣式只放 `static_src/css/vkikaku.css`，**不要加進 `style.css`**；在 `tools/split_css.py` 的 `GAMES` 登記 `"vkikaku": ("vk-",)`，在 `generate.py` 的 `GAME_I18N_PREFIXES` 登記 `"vkikaku": ("vk_",)`。
- 不讀、不改其他遊戲的檔案（CLAUDE.md §5.2.1）。
- **確定性**：`vkikaku_rng.js`／`vkikaku_meeting.js`／`vkikaku_stream.js`／`vkikaku_office.js` 不得使用 `Math.sin|cos|tan|asin|acos|atan|atan2|pow|exp|log|log2|log10|random|hypot|cbrt`、`Date`、`performance`，只能用 `+ − × ÷`、`Math.sqrt`、`Math.floor`、`Math.abs`、`Math.imul`、`Math.min`、`Math.max`、比較。亂數只用 `Rng.make(seed)`。`tools/vkikaku_check/core_check.js` 用原始碼掃描確認。
- 規則核心內的數值盡量用整數；需要比例時用「百分比整數」（例：`viewersPct: 115`），計算後 `Math.floor`。
- 每個 JS 檔都是 IIFE，掛在 `window`，並在最後 `if (typeof module !== "undefined") module.exports = X;` 讓 Node 可以 `require`。核心檔之間在 Node 用 `require`、在瀏覽器讀 `window.PriTestVkikaku*`（寫法：`var Rng = (typeof require === "function" && typeof window === "undefined") ? require("./vkikaku_rng.js") : window.PriTestVkikakuRng;`）。
- 遊戲資料文字（卡片、留言、事件、Vtuber）用 `{ ja, zh }` 物件，以檔內 `C(ja, zh)` helper 建立；UI 字串放 `site_src/i18n_vkikaku.py`（zh／ja／en，en 可先複製 ja）。
- 首頁：放在「付款」分頁最後（`projects.py` 的 `pay`），頁面 `page_shell(paid=True)`；Playwright 開頁前先 `addInitScript` 寫入 `pritest-pay-unlocked`（CLAUDE.md §4.3.1）。
- 載入順序：`vkikaku_data.js` → `vkikaku_chat_data.js` → `vkikaku_rng.js` → `vkikaku_meeting.js` → `vkikaku_stream.js` → `vkikaku_office.js` → `vkikaku_save.js` → `vkikaku_ui_common.js` → `vkikaku_ui_office.js` → `vkikaku_ui_meeting.js` → `vkikaku_ui_stream.js` → `vkikaku_ui_report.js` → `vkikaku.js`。
- Playwright 一律用 `dispatchEvent` 觸發（CLAUDE.md §4.6）。
- 存檔鍵 `pritest-vkikaku-save`；讀寫一律 try/catch，壞檔就提示並重建。
- 版本：`site_src/version.py` 遞增 minor（目前 `2.86.0`）。只推 `private`（`git push private main`），不要碰 `origin`。
- 回覆、註解、文件、commit message 用繁體中文；commit message 結尾加 `Co-Authored-By` 行。

## 檔案結構

| 檔案 | 責任 |
|---|---|
| `static_src/vkikaku_data.js` | 數值表、2 位 Vtuber、標籤、企劃卡 22 種（卡組 24 張）、組合 12 種、顧慮與說服牌、行程格、SNS 發文、週報事件 10 種、年曆、結局 |
| `static_src/vkikaku_chat_data.js` | 留言模板（8 種類 × zh／ja）、詞庫、梗、常客 10 位 |
| `static_src/vkikaku_rng.js` | mulberry32、`hash(str)`、`pick`、`int`、`shuffle` |
| `static_src/vkikaku_meeting.js` | 會議規則：手牌、回合、反應、顧慮、說服、調查、滿意度、組合、`buildConfig` |
| `static_src/vkikaku_stream.js` | 直播規則：留言生成與捲動、操作判定、熱度、連擊、陣營、常客、梗浪潮、話題分支、工具、招牌技、精華、炎上火種、任務、評價、重播 |
| `static_src/vkikaku_office.js` | 新遊戲、行程板驗證與套用、SNS、大型企劃、關係、趨勢、年曆、套用直播結果、週報事件、獎勵卡、結局 |
| `static_src/vkikaku_save.js` | 存檔讀寫、版本遷移（唯一碰 localStorage 的檔） |
| `static_src/vkikaku_ui_common.js` | DOM helper、文字選擇、Vtuber 立繪 SVG（4 表情）、數值條 |
| `static_src/vkikaku_ui_office.js` | 事務所畫面、行程板、SNS 選擇 |
| `static_src/vkikaku_ui_meeting.js` | 會議畫面 |
| `static_src/vkikaku_ui_stream.js` | 直播畫面、留言輸入、語氣輪盤、工具列、鍵盤 |
| `static_src/vkikaku_ui_report.js` | 直播結算、週報、事件選擇、獎勵卡、結局畫面 |
| `static_src/vkikaku.js` | 畫面流程（狀態機）、存檔時機、`_debug` |
| `static_src/css/vkikaku.css` | 樣式（`vk-` 前綴） |
| `site_src/vkikaku_page.py` | 頁面 |
| `site_src/i18n_vkikaku.py` | UI 字串與首頁的 `project_vkikaku_*` |
| `tools/vkikaku_check/core_check.js` | 規則檢查（Node） |
| `tools/vkikaku_check/ui_check.js` | 畫面檢查（Playwright） |

## 介面

```js
// vkikaku_rng.js → window.PriTestVkikakuRng
Rng.make(seed) → rng                         // rng() → [0,1)（mulberry32，seed 為 uint32）
Rng.hash(str) → uint32                       // FNV-1a，用 Math.imul
Rng.int(rng, n) → 0..n-1；Rng.pick(rng, arr) → elem；Rng.shuffle(rng, arr) → 新陣列（Fisher–Yates）

// vkikaku_meeting.js → window.PriTestVkikakuMeeting
Meeting.create(ctx) → m                      // ctx 由 Office.meetingCtx 產生（見下）
Meeting.act(m, action) → { ok, events: [...] }
//   action: {op:"play", cardId} | {op:"swap", cardId} | {op:"persuade", concernIdx, card:"data"|"cheer"|"concede"|"promise"} | {op:"probe"}
//   events: {type:"reaction", cardId, face:"like"|"neutral"|"dislike"|"mine"|"fav", line} | {type:"concern", kind} | {type:"reveal", tag, hidden:"mine"|"fav"}
//           | {type:"persuade", ok} | {type:"combo", comboId}
Meeting.canStart(m) → bool                   // 兩條滿意度都 ≥ D.MEETING.passLine
Meeting.preview(m) → { viewersLo, viewersHi, riskStars, scEst, combos:[id], vtSat, chiefSat }
Meeting.finish(m) → streamConfig             // 空欄位補 "normal_<slot>" 卡；未解決顧慮與未達門檻在此扣分
Meeting.autoAct(m) → action|null             // 簡單 AI：有顧慮就用對應說服牌，否則出 like／fav／中立卡補空欄位；回合用完或欄位滿回傳 null

// vkikaku_stream.js → window.PriTestVkikakuStream
Stream.create(config) → st
Stream.step(st, actions) → events            // 推進 1 步（50 ms）；actions 為本步輸入的陣列
//   action: {op:"read", cid, tone:"tsukkomi"|"amae"|"serious"|"skip"} | {op:"del", cid} | {op:"ban", cid}
//         | {op:"tool", tool:"slow"|"members"|"pin", cid?} | {op:"sig"}
Stream.visible(st) → [comment]               // 畫面上的留言（含 progress 0..1）
Stream.done(st) → bool                       // st.step >= config.durationSteps
Stream.result(st) → streamResult
Stream.run(config, inputLog) → streamResult  // inputLog = [{step, ...action}]，依步數排序；重播用
Stream.autoActions(st) → [action]            // 「完美管理員」：對畫面上的留言做正確操作（good 用其 tone 念、sc／topic good 念、惡意類刪），每步最多 2 個操作

// vkikaku_office.js → window.PriTestVkikakuOffice
Office.newGame(seed) → save
Office.validatePlan(save, plan) → [errorKey]  // plan = { uta:[7 cells], kuro:[7 cells] }
Office.applyPlan(save, plan) → { streams:[slot], notes:[...] }   // slot = {vtId, day, viewersPct, skillBonus, skillBonusFor, plantedMeme, special}；同時寫入 save.pending
Office.meetingCtx(save, slot) → ctx
Office.applyStream(save, slot, result) → { deltas }
Office.weekEnd(save) → report               // report = { deltas, event|null, rewards:[cardId×3] }
Office.resolveEvent(save, choiceIdx) → { deltas }
Office.pickReward(save, addCardId|null, removeCardId|null)
Office.nextWeek(save) → save.ending|null

// vkikaku_save.js → window.PriTestVkikakuSave
Save.load() → save|null；Save.store(save) → bool；Save.clear()；Save.migrate(obj) → save|null
```

### 資料形狀

```js
// ctx（Office.meetingCtx）
{ seed, week, vtId, vt /* 見 save.vts[vtId] + D.VTUBERS[vtId] 的合併唯讀物件 */, deck:[cardId], trends:[tag],
  level, slot /* applyPlan 產生的 slot */, special: null|"birthday" }

// streamConfig（Meeting.finish）
{ seed, vtId, week, cards:{type, theme, hook, slot}, combos:[comboId], tags:[tag],
  durationSteps:1500, baseViewers, spawnEvery /* 每幾步生一則 */, lifeSteps /* 留言存活步數 */,
  weights:{good, sc, normal, spoiler, troll, danger, fake, topic},   // 整數權重
  memes:[memeId], waves /* 梗浪潮次數 */, heatCap, scPct, mood, stamina, skill /* 該類型技能 1..10 */,
  tonePref, signature, factions:{core, casual, overseas, troll} /* 合計 100 */,
  mission:{tag, count}, crisis: null|"fire", regulars:{ id: affinity }, special: null|"birthday" }

// comment（Stream 內部與 visible）
{ cid, kind, tpl /* 模板 index */, words:[index], user /* 常客 id 或 "anon<n>" */, faction,
  tone /* 適合語氣 */, tag /* 任務用 */, meme /* memeId|null */, origin /* bool */, branch /* topic 用："good"|"bad" */,
  amount /* sc 金額 */, quoteOf /* 炎上火種的引用來源 cid */, born, life, progress }

// streamResult（Stream.result）
{ grade:"S"|"A"|"B"|"C"|"D", score, peakViewers, avgHeat, accuracy /* 0..100 */, scIncome, scMissed,
  missedDanger, clips, missionDone, sat:{core, casual, overseas}, newSubs, flameDelta, moodDelta,
  regularsDelta:{ id: n }, comboMax, reads, dels, sigUsed }

// save（Office.newGame）
{ v:1, seed, week:1, money:1000000, level:1, deck:[cardId×24], trends:[tag], codex:{ combos:[] },
  relation:50, vts:{ uta:VtState, kuro:VtState }, plan:null, pending:[slot], report:null, ending:null,
  history:[{ week, vtId, grade, newSubs }] }
// VtState
{ subs, stamina:100, mood:70, affinity:40, flame:0, skills:{song, game, talk, plan}, skillXp:{song, game, talk, plan},
  revealed:[tag], regulars:{ id:0 }, restWeeks:0, prep:0, birthdayDone:false, nextViewersPct:100, plantedMeme:null }
```

---

### Task 1: 頁面骨架與登記

**Files:** Create `site_src/vkikaku_page.py`、`site_src/i18n_vkikaku.py`、`static_src/css/vkikaku.css`、`static_src/vkikaku.js`（空殼）；Modify `generate.py`、`site_src/projects.py`、`site_src/i18n_data.py`、`tools/split_css.py`、`CLAUDE.md`

- [ ] `vkikaku_page.py`：比照 `site_src/inusnow_page.py`。`VKIKAKU_SCRIPTS` 依 Global Constraints 的載入順序列出 13 個檔（本 Task 先只放實際存在的檔，之後每個 Task 新增檔案時一併加進來）；`build_vkikaku_html()` 回傳 `page_shell(paid=True, title="ブイ企画室", body=..., static_prefix="../static/", home_href="../index.html", extra_scripts=VKIKAKU_SCRIPTS, extra_styles=("css/vkikaku.css",), extra_i18n=("i18n/vkikaku.js",))`；body 為 `<div id="vk-app"><noscript>這個遊戲需要 JavaScript。</noscript></div>`。
- [ ] `i18n_vkikaku.py`：比照 `site_src/i18n_inusnow.py` 的結構匯出 `VKIKAKU_ZH`、`VKIKAKU_JA`、`VKIKAKU_EN`、`VKIKAKU_PROJECT`；`VKIKAKU_PROJECT` 含 `project_vkikaku_name`（zh「V 企劃室」／ja「ブイ企画室」／en「V Planning Room」）與 `project_vkikaku_desc`（zh「經營 Vtuber 事務所：開企劃會議、在直播聊天室當管理員。」／ja「Vtuber 事務所を経営：企画会議を開き、配信のチャット欄で管理人をこなす。」）。
- [ ] `i18n_data.py`：比照 inusnow 的 import 與合併方式加入。
- [ ] `generate.py`：`from site_src.vkikaku_page import VKIKAKU_SCRIPTS, build_vkikaku_html`；`GAME_I18N_PREFIXES["vkikaku"] = ("vk_",)`；`build_pages()` 輸出 `dist/vkikaku/index.html`；把 `"vkikaku"` 加進清理用的目錄清單（`generate.py:414` 那一行）；確認 `VKIKAKU_SCRIPTS` 有被複製（比照 inusnow 的處理）。
- [ ] `projects.py`：新增 `{"id": "vkikaku", "href": "vkikaku/index.html", "name_key": "project_vkikaku_name", "desc_key": "project_vkikaku_desc", ...}`（其他欄位比照 inusnow），加在 `pay` 分頁最後。
- [ ] `tools/split_css.py` 的 `GAMES` 加 `"vkikaku": ("vk-",)`；CLAUDE.md §5.2.1「目前已分開的遊戲」與 §4.3.1 的付款分頁遊戲清單加 vkikaku。
- [ ] `vkikaku.js` 空殼：IIFE，`window.PriTestVkikakuApp = {}`，DOMContentLoaded 時在 `#vk-app` 放一行 `I18N.t("vk_title")`。
- [ ] Run: `py -3 generate.py` → 成功、`dist/vkikaku/index.html` 存在；`py -3 tools/split_css.py --check` → 沒有混入。
- [ ] Commit: `feat(vkikaku): 頁面骨架與登記`

### Task 2: 亂數與遊戲資料

**Files:** Create `static_src/vkikaku_rng.js`、`static_src/vkikaku_data.js`、`tools/vkikaku_check/core_check.js`

**Interfaces:** Produces `Rng.*`（見介面）與 `window.PriTestVkikakuData`（下列常數名稱）。

- [ ] 先寫 `core_check.js`（會失敗）：
  - 原始碼掃描（去掉註解後）：四個核心檔不含 Global Constraints 列出的禁用函式；本 Task 只有 `vkikaku_rng.js` 存在，其餘檔不存在時略過。
  - `Rng.make(1)` 連取 5 個值與 `Rng.make(1)` 第二次完全相同；`Rng.make(2)` 不同；10000 次 `Rng.int(rng, 6)` 每個值出現 1500～1850 次。
  - 資料完整性：每張卡的 `slot` ∈ `SLOTS`、`tags` 都在 `TAGS`；`DECK_START` 24 張且每張都在 `CARDS`；每個 `COMBOS[i].when` 至少能被一組四張卡滿足（窮舉 6×6×6×4 組合檢查）；每位 Vtuber 的公開＋隱藏標籤都在 `TAGS`、互不重複；`EVENTS` 每個的 `choices` 長度 1～3；所有 `{ja, zh}` 物件兩個語言都非空字串。
- [ ] `vkikaku_rng.js`：mulberry32（`Math.imul`、`>>> 0`），`hash` 用 FNV-1a 32 bit。
- [ ] `vkikaku_data.js`（`window.PriTestVkikakuData`），內容如下（全部暫定）：
  - `TAGS`：`horror, cute, music, game, night, retro, talk, food, challenge, healing, new`，各有 `{ja, zh}` 名稱。
  - `SLOTS`：`type, theme, hook, time`。
  - `CARDS`（22 種；每張 `{id, slot, name:C(), tags, fx}`，`fx` 欄位見下）：
    - type：`game` 遊戲實況 [game]、`song` 歌回 [music]、`chat` 雜談 [talk]、`totsu` 凸待 [talk, challenge]、`asmr` ASMR [healing, night]、`cook` 料理 [food, cute]
    - theme：`horror` 恐怖遊戲 [horror]、`hardgame` 高難度遊戲 [game, challenge]、`retro` 懷舊歌 [retro, music]、`newtitle` 話題新作 [new, game]、`marshmallow` 棉花糖 [talk, cute]、`anime` 動畫歌 [music, cute]
    - hook：`endurance` 耐久 [challenge]、`penalty` 懲罰遊戲 [challenge, cute]、`outfit` 新衣裝公開 [cute, new]、`first` 初見 [new]、`merch` 周邊預告 [new]、`request` 點歌 [music, talk]
    - time：`morning` 早上 [healing]、`golden` 黃金時段 []、`late` 深夜 [night]、`dawn` 凌晨 [night, challenge]
    - 另有 4 張不在卡組的預設卡 `normal_type`（雜談同效果但 fx 減半）、`normal_theme`、`normal_hook`、`normal_time`（tags 皆空、fx 全 0）。
  - `fx` 欄位（全部是加總用的整數，未寫＝0）：`viewersPct`、`speedPct`、`w:{good, sc, normal, spoiler, troll, danger, fake, topic}`、`scPct`、`heatCap`、`memes:[memeId]`、`waves`、`stamina`（消耗）、`risk`、`chief`、`skill:"song"|"game"|"talk"|"plan"`（只有 type 卡有）、`mission:{tag, count}`（只有 type 卡有）、`fac:{core, casual, overseas, troll}`。
    初始數值表（以此為準）：

    | id | viewersPct | speedPct | w 增減 | scPct | heatCap | memes | waves | stamina | risk | chief | 其他 |
    |---|---|---|---|---|---|---|---|---|---|---|---|
    | game | 0 | 0 | good+10 spoiler+6 | 0 | 0 | — | 1 | 20 | 5 | 5 | skill game；mission play×5 |
    | song | 0 | -10 | good+8 sc+4 | 30 | 0 | — | 1 | 25 | 0 | 10 | skill song；mission request×3 |
    | chat | -10 | -20 | topic+10 good+6 | 0 | 0 | — | 1 | 10 | 10 | 0 | skill talk；mission question×3 |
    | totsu | 10 | 20 | topic+6 troll+4 | 10 | 0 | — | 1 | 20 | 20 | 5 | skill talk；mission guest×3 |
    | asmr | -10 | -40 | normal+10 | 20 | -10 | — | 0 | 10 | 5 | 0 | skill talk；mission calm×3 |
    | cook | 0 | 0 | good+6 | 10 | 0 | — | 1 | 20 | 5 | 0 | skill plan；mission food×3 |
    | horror | 15 | 20 | spoiler+8 good+6 | 0 | 0 | scream | 1 | 10 | 10 | 5 | |
    | hardgame | 10 | 10 | spoiler+10 troll+4 | 0 | 10 | rage | 1 | 15 | 10 | 0 | |
    | retro | 0 | -10 | good+6 | 10 | 0 | nostalgia | 1 | 5 | 0 | 0 | fac core+10 |
    | newtitle | 20 | 20 | spoiler+12 | 0 | 0 | hype | 1 | 5 | 15 | 10 | fac casual+10 |
    | marshmallow | 0 | -10 | topic+10 | 0 | 0 | — | 0 | 5 | 15 | 0 | |
    | anime | 10 | 0 | good+6 | 10 | 0 | singalong | 1 | 5 | 0 | 5 | fac overseas+10 |
    | endurance | 10 | 0 | sc+4 | 40 | 20 | — | 0 | 30 | 5 | 10 | |
    | penalty | 10 | 10 | good+6 troll+2 | 10 | 10 | punish | 1 | 15 | 10 | 5 | |
    | outfit | 25 | 10 | sc+6 | 30 | 0 | kawaii | 1 | 5 | 5 | 15 | fac core+10 |
    | first | 10 | 10 | spoiler+10 | 0 | 0 | — | 0 | 5 | 5 | 0 | |
    | merch | 5 | 0 | sc+4 | 20 | 0 | — | 0 | 5 | 10 | 20 | |
    | request | 0 | 10 | good+8 | 10 | 0 | — | 0 | 10 | 0 | 5 | |
    | morning | -20 | -20 | troll-4 | 0 | 0 | — | 0 | 0 | -5 | -5 | fac core+10 |
    | golden | 30 | 20 | troll+2 | 10 | 0 | — | 0 | 0 | 5 | 10 | fac casual+10 |
    | late | 0 | 0 | troll+4 danger+2 | 0 | 0 | — | 0 | 10 | 10 | 0 | fac overseas+10 |
    | dawn | -10 | -10 | troll+6 | 0 | 10 | — | 0 | 20 | 10 | -5 | fac overseas+20 |
  - `DECK_START`：上表 22 張＋`golden`、`chat` 各再 1 張＝24 張。
  - `COMBOS`（12 種；`{id, name:C(), when, fx}`；`when` 是 `{cards:[...], anyTag:tag, allTag:true}` 的條件；`allTag:true` 表示四張卡共有至少一個相同標籤）：

    | id | 名稱 | when | fx |
    |---|---|---|---|
    | lateHorror | 深夜恐怖 | theme horror＋time ∈ {late, dawn} | viewersPct+15、waves+1、scream 浪潮 |
    | songEndurance | 歌回耐久 | song＋endurance | scPct+40、stamina+15 |
    | retroSong | 懷舊歌回 | song＋retro | fac core+15、heatCap+10 |
    | firstHard | 初見高難度 | hardgame＋first | waves+1、viewersPct+10 |
    | outfitChat | 新衣裝雜談 | chat＋outfit | scPct+30、viewersPct+10 |
    | nightMarsh | 深夜棉花糖 | marshmallow＋late | topic+10、risk+10、viewersPct+10 |
    | cookPenalty | 料理懲罰 | cook＋penalty | waves+1、heatCap+10 |
    | hypeTotsu | 話題凸待 | totsu＋newtitle | viewersPct+20、troll+4 |
    | morningAsmr | 早晨療癒 | asmr＋morning | troll-6、fac core+10、stamina-10 |
    | animeRequest | 動畫點歌 | anime＋request | fac overseas+15、good+6 |
    | premiere | 新作首播 | newtitle＋first＋golden | viewersPct+30、spoiler+6 |
    | unified | 全標籤一致 | allTag | heatCap+20、viewersPct+10 |
  - `VTUBERS`：
    - 隱藏地雷／最愛以**卡片 id** 判定（不是標籤），揭露紀錄也存卡片 id。
    - `uta`（星乃うた／星乃詩，歌姬型）：`pub:["music","cute"]`、`pubDislike:["horror","night"]`、`hidden:{fav:["retro"], mine:["penalty","dawn"]}`、`skills:{song:7, game:3, talk:5, plan:4}`、`subs:12000`、`tonePref:"amae"`、`signature:"highNote"`、`concernByTag:{horror:"flame", night:"tired"}`、表情台詞（like／neutral／dislike／mine／fav 各 3 句 `{ja, zh}`）。
    - `kuro`（夜宵くろ／夜宵玄，夜貓子遊戲型）：`pub:["game","night"]`、`pubDislike:["healing","cute"]`、`hidden:{fav:["horror","dawn"], mine:["outfit"]}`、`skills:{song:3, game:7, talk:5, plan:4}`、`subs:8000`、`tonePref:"tsukkomi"`、`signature:"clutch"`、`concernByTag:{healing:"tired", cute:"unskilled"}`、台詞同上。
    - `pubDislike` 的每個標籤都必須在 `concernByTag` 有對應（core_check 檢查）。
  - `MEETING`：`turns:5`、`hand:6`、`passLine:50`、`vtSatStart:50`、`chiefSatStart:40`、`like:+10`、`dislike:-10`、`fav:+15`、`mineMood:-15`、`persuadeOk:+8`、`persuadeNg:-5`、`unresolved:-10`、`emptySlotMood:-5`、`trendChief:+10`、`trendViewersPct:+15`、`belowLineMood:-10`、`belowLineMoney:-50000`、`riskPerStar:15`。
  - `CONCERNS`：`flame`（怕被罵；對應 `data`）、`tired`（很累；對應 `concede`）、`unskilled`（不擅長；對應 `cheer`）。
  - `PERSUADE`：`data`、`cheer`（初始可用）、`concede`（事務所等級 ≥ 2）、`promise`（好感 ≥ 50，萬用，每場會議 1 次）。`concede` 成功時同時把該卡的 `stamina` 減半。
  - `STREAM`：`durationSteps:1500`、`stepMs:50`、`segments:[300, 1200]`、`spawnEvery:10`、`lifeSteps:160`、`baseWeights:{good:30, sc:4, normal:40, spoiler:4, troll:6, danger:2, fake:2, topic:4}`、`heatCap:100`、`heatDecayEvery:20`、`read:{match:6, miss:3, normal:1, sc:4, bad:-6, fake:-8}`、`delOk:1`、`delWrong:-3`、`dangerEscapeFlame:12`、`dangerEscapeHeat:-5`、`fakeReadFlame:5`、`trollSpreadW:2`、`comboStepPct:5`、`comboMax:20`、`wave:{size:8, every:5, originHeat:20, memberHeat:3}`、`topic:{goodWaveDelay:40, badSteps:200, badDangerPct:300}`、`tools:{slow:{steps:100, cd:300, speedPct:50}, members:{steps:100, cd:400}, pin:{steps:200, cd:300, heatPer10:1}}`、`highlight:{atPct:90, maxClips:3}`、`sig:{max:2, afterPct:50}`、`fire:{at:900, quoteEvery:60, quoteEveryHelped:90, escapeFlame:25, helperAff:5}`、`regularPct:15`、`sat:{start:50, good:3, inJokeCore:4, inJokeCasual:-1, overseas:4, trollLeft:-1}`、`grade:{S:85, A:70, B:55, C:40}`、`subsFromCasualPct:30`、`subsPerClip:200`、`moodPct:{base:50, per:2}`（效果倍率＝50＋心情/2 %）、`lowStamina:{below:30, pct:80}`、`skillPct:{base:80, per:4}`、`viewersFromSubsPct:4`、`viewersSpreadPct:20`、`scAmounts:[500, 1000, 2000, 5000, 10000]`。
  - `OFFICE`：`weeks:24`、`streamsPerWeek:2`、`moneyStart:1000000`、`salary:50000`（每位）、`equipment:30000`、`memberDiv:2`（會員收入＝`Math.floor(subs / memberDiv)`）、`levels:[0, 50000, 100000, 200000]`（總訂閱門檻）、`flameDecay:10`、`flameMax:100`、`flameOut:{restWeeks:2, subsPct:90, affinity:-10, flameAfter:40}`、`staminaCost:{stream:25, practice:10, record:10, prep:10}`、`rest:{stamina:30, mood:10}`、`promo:{cost:50000, viewersPct:15}`、`fatigue:{run:3, stamina:-20, mood:-15}`、`recordMoodNoRest:-5`、`skillXpPerLevel:3`、`relation:{bothStream:2, oneSided:-5, jealousMood:-10, eventHigh:70, eventLow:30}`、`birthday:{uta:14, kuro:18, prepNeed:3, cost:300000, gradeNeed:"B"}`、`affinityStreamGood:2`（評價 ≥ B）、`affinityStreamBad:-2`（評價 D）。
  - `CELLS`：`stream, practice_song, practice_game, practice_talk, practice_plan, rest, promo, sns, record, prep, off`（`off`＝空白）；高強度＝`stream, practice_*, record, prep`。
  - `SNS_POSTS`：`preview`（下一場 viewersPct+10）、`daily`（心情+5、下一場 fac core+5）、`meme`（下一場追加一個梗：該 Vtuber 的 `plantedMeme`，從 `MEMES` 中依種子選）、`trend`（爆紅：訂閱 +3%；炎上：flame+15；爆紅機率 60%，flame ≥ 50 時 30%）。
  - `CALENDAR`：`{8:{id:"summerFes", trends:["retro","food"], card:"summer"}, 20:{id:"anniv", trends:["new","music"], card:"anniv"}}`；特別卡 `summer`（hook，[retro, food]，viewersPct+20、waves+1）、`anniv`（hook，[new, music]，scPct+50、viewersPct+20）在當週會議時額外放進手牌（不進卡組）。
  - `TREND_POOL`：`TAGS` 全部；非年曆週每週依種子選 1～2 個。
  - `REWARD_POOL`：`{1:[...], 2:[...], 3:[...], 4:[...]}`，等級 n 時可從 1..n 的池中抽 3 張；池內容就是 `CARDS` 的 id（等級 1：type／time 卡；等級 2：theme 卡；等級 3：hook 卡；等級 4：全部）。
  - `EVENTS`（10 種；`{id, when, text:C(), choices:[{label:C(), fx}]}`；`when` 用簡單條件物件：`{minWeek, flameGte, moodLte, relationGte, relationLte, clipsGte, gradeGte, chancePct}`；`fx` 鍵：`money, mood, affinity, flame, subsPct, relation, stamina`，作用於指定或全部 Vtuber）：`clipViral`（剪片師把精華剪爆了：subsPct+5）、`poach`（其他事務所挖角：選「加薪」money-200000 affinity+10／「信任她」affinity-5 或 mood-10）、`newGenre`（想挑戰新類型：同意→下週 mood+15；拒絕→affinity-5）、`collabAsk`（relation ≥ 70：A 想跟 B 聯動→兩人 mood+10）、`lonely`（relation ≤ 30：覺得被冷落→指定者 mood-10，安撫選項 money-30000 mood+5）、`fanArt`（粉絲畫圖：mood+10）、`sickThroat`（喉嚨不舒服：stamina-20 或 休一天 mood+5 stamina+10）、`oldPost`（舊推文被挖出：flame+20 或道歉 flame+5 subsPct-2）、`sponsor`（企業贊助：money+150000 或 拒絕 affinity+5）、`overwork`（mood ≤ 30：情緒低落：休息 stamina+20 mood+20 下週 1 格強制 rest）。
  - `ENDINGS`（判定順序）：`bankrupt`（資金 ≤ 0，任何時候）、`all3d`（總訂閱 ≥ 300000 且兩人 `birthdayDone`）、`popular`（總訂閱 ≥ 150000）、`cozy`（其他）。各有 `{title:C(), text:C()}`。
- [ ] Run: `node tools/vkikaku_check/core_check.js` → 全部 ok
- [ ] Commit: `feat(vkikaku): 確定性亂數與遊戲資料`

### Task 3: 留言資料

**Files:** Create `static_src/vkikaku_chat_data.js`；Modify `tools/vkikaku_check/core_check.js`

**Interfaces:** Produces `window.PriTestVkikakuChat = { TEMPLATES, WORDS, MEMES, REGULARS, render(comment, lang) }`

- [ ] 先在 `core_check.js` 加（會失敗）：
  - `TEMPLATES[kind]` 對 8 種類各有 30 則以上；每則 `{ja, zh, tone, faction, tag?, inJoke?, branch?}`；`tone` ∈ 4 語氣；`faction` ∈ `core|casual|overseas|troll`；`topic` 類每則有 `branch`，`good` 與 `bad` 都至少 10 則。
  - 每個 type 卡的 `mission.tag`（play、request、question、guest、calm、food）在 `good` 模板中至少 5 則。
  - 模板中的 `{w:<key>}` 佔位符都存在於 `WORDS`，且 `WORDS[key]` 是 `{ja, zh}` 配對陣列。
  - `MEMES`：`scream, rage, nostalgia, hype, singalong, punish, kawaii` 等至少 10 個，每個 `{origin:{ja,zh}, echoes:[{ja,zh}×6 以上]}`。
  - `REGULARS`：uta、kuro 各 5 位 `{id, vt, name:C(), faction, habit:[{ja,zh}×3]}`；每位 Vtuber 至少 1 位 `overseas`。
  - `render` 對每個模板 × 兩語言都輸出不含 `{` 的字串。
- [ ] `vkikaku_chat_data.js` 內容：
  - 8 種類：`good`（好梗／提問／應援，tone 依內容）、`sc`（超級留言的訊息）、`normal`（「8888」「こんばんは」之類，tone `skip`）、`spoiler`（劇透、指示廚「那邊有道具」）、`troll`（酸民，faction `troll`）、`danger`（其他事務所名、問住哪裡、敏感時事；以虛構名稱表示，**不出現真實人物、團體、事件**）、`fake`（看起來是好梗但含地雷字，例如「好可愛！ 對了你住在○○附近嗎」）、`topic`（「上次的懲罰遊戲是什麼？」branch good／「你怎麼看那個炎上的人」branch bad）。
  - 海外觀眾的留言以簡單英文混雜（兩語言版本相同英文即可）。
  - 常客：uta — `ohayou_oji`（早安大叔，core）、`samui_king`（冷笑話王，casual）、`kusa`（只打草，core）、`kashi_police`（歌詞警察，core）、`mike_la`（overseas）；kuro — `shinya_kumi`（深夜組長，core）、`speedrun`（速通仔，casual）、`kusa2`（草，core）、`zatsu`（雜學王，casual）、`pierre`（overseas）。
  - `render(comment, lang)`：依 `kind`／`tpl`／`words` 組字；常客用 `habit[tpl % 3]`；梗用 `origin` 或 `echoes[tpl]`；`lang` 不是 `ja`／`zh` 時用 `ja`。
- [ ] Run: `node tools/vkikaku_check/core_check.js` → 全部 ok
- [ ] Commit: `feat(vkikaku): 留言模板、詞庫、梗與常客`

### Task 4: 會議核心

**Files:** Create `static_src/vkikaku_meeting.js`；Modify `tools/vkikaku_check/core_check.js`

**Interfaces:** Consumes `Rng.*`、`PriTestVkikakuData`。Produces `Meeting.create/act/canStart/preview/finish`（見介面），`m` 的欄位：`{ ctx, rng, hand:[cardId], drawPile:[cardId], slots:{type, theme, hook, time}, turn, vtSat, chiefSat, mood, concerns:[{kind, cardId}], revealed:[tag], promiseUsed, combos:[id], log:[event] }`。

- [ ] 先在 `core_check.js` 加（會失敗），用手寫的 ctx（`Office` 還不存在；ctx 依「資料形狀」組成，uta、subs 12000、mood 70、affinity 40、level 1、deck = DECK_START、trends ["retro"]、seed 7）：
  - `create` 後手牌 6 張、`turn === 0`、`vtSat === 50`、`chiefSat === 40`；同 seed 兩次手牌完全相同。
  - uta 出 `song` → 事件含 `{face:"like"}`、vtSat 60。
  - uta 出 `horror`（公開不喜歡）→ `face:"dislike"`＋`{type:"concern", kind:"flame"}`；接著 `persuade` 用 `data` → ok、顧慮消失、vtSat +8；用 `cheer` → 失敗、mood −5。
  - uta 出 `penalty`（隱藏地雷）→ `face:"mine"`、mood −15、`revealed` 含 `"penalty"`。
  - uta 出 `retro`（隱藏最愛）→ `face:"fav"`、vtSat ＋15、`revealed` 含 `"retro"`。
  - `probe` → 揭露一個未揭露的隱藏卡（依種子；事件 `{type:"reveal", tag:<cardId>, hidden}`），消耗 1 回合；uta 三張都揭露後 `probe` 回傳 `ok:false` 且不耗回合。
  - uta 出 `late`（公開不喜歡 night）→ 顧慮 `tired`；`concede` 在等級 1 回傳 `ok:false`。
  - `autoAct` 反覆呼叫直到 null → 四欄位都有卡、沒有未解決顧慮（uta、seed 1..10）。
  - 5 回合用完後 `act` 回傳 `ok:false`。
  - 組合：放 `song` 與 `retro` → 事件含 `{type:"combo", comboId:"retroSong"}`；`unified` 在四張卡共有標籤時成立。
  - `preview`：`viewersLo < viewersHi`；`riskStars` 0..5。
  - `finish`：空欄位補 `normal_*`、每個空欄位 mood −5；`weights` 各值 ≥ 0；`factions` 合計 100；`mission` 來自 type 卡；`crisis === "fire"` 當且僅當 `risk ≥ 40` 或 `special === "birthday"`。
  - `promise` 只能用 1 次；好感 < 50 時回傳 `ok:false`。
- [ ] 實作規則：
  - 手牌：`Rng.shuffle` 卡組取前 6 張；年曆週的特別卡額外加入手牌。`swap`：棄一張、從 `drawPile` 抽一張。
  - `play`：卡放進對應欄位（取代舊卡時舊卡回手牌，舊卡造成的滿意度變化要扣回——實作上每次都由 `recompute(m)` 從目前欄位重算 vtSat 與 chiefSat 的「卡片部分」，說服／調查／地雷的累計值另存在 `m.vtAdj`、`m.moodAdj`）。
  - 反應判定（以卡片 id 與標籤）：卡 id ∈ `hidden.mine` → mine；∈ `hidden.fav` → fav；任一標籤 ∈ `pubDislike` → dislike（產生顧慮 `concernByTag[tag]`，沒有對應就 `unskilled`）；任一標籤 ∈ `pub` → like；否則 neutral。
  - vtSat ＝ `vtSatStart` ＋ Σlike×10 ＋ Σfav×15 − 未解決顧慮數×10 ＋ `vtAdj`；chiefSat ＝ `chiefSatStart` ＋ Σcard.fx.chief ＋ 趨勢符合標籤數×10 − max(0, risk − 30)；兩者夾在 0..100。
  - 組合：每次 `recompute` 重新判定，新成立的組合發出 `combo` 事件並記到 `m.combos`。
  - `buildConfig`（`finish` 內）：
    - 加總四張卡＋組合的 `fx`。
    - `pct = max(10, slot.viewersPct + ΣviewersPct + trendMatches × trendViewersPct)`（`slot.viewersPct` 由 applyPlan 給，預設 100；`trendMatches`＝四張卡標籤中屬於本週趨勢的不同標籤數）；`baseViewers = floor(floor(subs × viewersFromSubsPct / 100) × pct / 100)`。
    - `spawnEvery = max(4, floor(10 × 100 / (100 + ΣspeedPct)))`；`lifeSteps = max(80, floor(160 × 100 / (100 + ΣspeedPct)))`。
    - `weights = baseWeights + Σw`，各自 `max(0, …)`。
    - `factions`：起始 `{core:30, casual:50, overseas:15, troll:5}` 加上 Σfac，`troll` 再加 `floor(risk / 10)`，最後正規化成合計 100（依比例 floor，餘數加給 casual）。
    - `memes`：卡與組合的梗去重，再加 `slot.plantedMeme`；`waves = Σwaves`（上限 4）。
    - `heatCap = 100 + ΣheatCap`；`scPct = 100 + ΣscPct`；`mood` ＝ 會議結束後的心情；`skill = min(10, vt.skills[type.fx.skill] + (slot.skillBonusFor === type.fx.skill ? slot.skillBonus : 0))`。
  - `autoAct`：照介面說明實作（核心檔內，確定性），供 core_check 的 24 週模擬與 `_debug.autoMeeting` 共用。
    - `regulars`：該 Vtuber 的常客與好感（從 ctx 複製）。
- [ ] Run: `node tools/vkikaku_check/core_check.js` → 全部 ok
- [ ] Commit: `feat(vkikaku): 企劃會議規則（回合、反應、顧慮、說服、調查、組合）`

### Task 5: 直播核心（一）：留言流與基本判定

**Files:** Create `static_src/vkikaku_stream.js`；Modify `tools/vkikaku_check/core_check.js`

**Interfaces:** Consumes `Rng.*`、`PriTestVkikakuData`、`PriTestVkikakuChat`（只用模板數量與屬性，不用文字）。Produces `Stream.create/step/visible/done/result/run`；`st` 欄位：`{ cfg, rng, step, nextCid, comments:[comment], heat, heatSum, combo, comboMax, viewers, peakViewers, sat:{core, casual, overseas}, flame, scIncome, scMissed, missedDanger, reads, dels, correct, judged, banned:{user:true}, wDanger, wTroll, regularsDelta:{}, tool:{slow, members, pin, cd:{}}, sigLeft, highlight, clips, missionCount, wavePlan:[step], fire:null, events:[] }`。

- [ ] 先在 `core_check.js` 加（會失敗），用 Task 4 的 `Meeting.finish` 產生的 config：
  - `Stream.run(cfg, [])` 兩次 → `streamResult` 深度相等（`assert.deepStrictEqual`）。
  - 不操作跑完：生成的留言數 ≈ `1500 / spawnEvery`（±5％，不含浪潮）；各種類比例與 `weights` 的比例差 < 5 個百分點（用 3 個種子合計）。
  - 只對 `danger` 放著不管 → `flameDelta ≥ dangerEscapeFlame × missedDanger`。
  - 用 `Stream.autoActions`（完美管理員：good 用其 `tone` 念、sc 念、spoiler／troll／danger／fake 刪、normal 不管；topic 在 Task 6 前一律不管）每步餵回 `step` → `accuracy ≥ 95`、`grade` 為 S 或 A。
  - 「全部亂念」腳本（每則都念、語氣 skip）→ 評價 ≤ C、`flameDelta > 0`。
  - 刪 `good` → 熱度 −3、連擊歸零；刪常客的留言 → `regularsDelta[id] < 0`。
  - `ban` 一個 troll 使用者 → 該使用者畫面上的留言全部消失、之後不再生成。
- [ ] 實作：
  - 生成：`step % spawnEvery === 0` 時生成 1 則；種類依 `weights`（加上本場動態調整 `wTroll`、`wDanger`）加權抽；模板依種類從 `Chat.TEMPLATES[kind]` 抽 index，`words` 依模板佔位符數抽；`regularPct`% 機率改成常客（只對 good／normal）；`sc` 的 `amount` 從 `scAmounts` 抽再乘 `scPct / 100`。
  - 存活：`life = lifeSteps`（慢速模式期間生成的留言 `life × 100 / slow.speedPct`）；`progress = (step − born) / life`；`progress ≥ 1` 時離開畫面並結算「漏掉」：sc → `scMissed += amount`、sat.core −2；danger → flame ＋12、heat −5、`missedDanger++`；troll → `wTroll += trollSpreadW`、sat.casual −1；fake／spoiler → 無。
  - 判定（`read`）：good → 語氣對 `match` 否則 `miss`；sc → `sc` 並收錢；normal → `normal`；spoiler／troll → `bad`；fake → `fake` 並 flame ＋5；topic → 依 branch（Task 6）。
    `del`：spoiler／troll／danger／fake → `delOk`；其他 → `delWrong`。
    正確（`read` good 對語氣、sc、topic；`del` 惡意類）→ `correct++`、連擊 +1；錯誤 → 連擊歸零。`judged` 計入所有 read／del 以及漏掉的 sc／danger。
  - 熱度：正向增量 × (100 + min(combo, 20) × 5) / 100 × 心情倍率（50 + mood/2）% × 技能倍率（80 + skill × 4）% × 低體力倍率；負向不乘。熱度夾在 0..heatCap；每 20 步 −1。
  - 陣營：念 good → `sat[faction] += 3`（troll 陣營不計）；`inJoke` → core ＋4、casual −1；海外 → overseas ＋4。夾在 0..100。
  - 同接：`viewers = floor(baseViewers × (60 + 80 × heat / heatCap) / 100)`，三段的倍率為 開場 80％、中盤 100％、收尾 120％；`members` 工具期間不上升（維持啟動時的值）。
  - 常客：念 → `regularsDelta[id] += 1`；刪 → −2。
  - `result`：`avgHeat = floor(heatSum × 100 / (steps × heatCap))`；`accuracy = floor(correct × 100 / max(1, judged))`；`avgSat = floor((sat.core + sat.casual + sat.overseas) / 3)`；`score = floor((avgHeat × 4 + accuracy × 3 + avgSat × 2) / 10) + (missionDone ? 10 : 0)`；依 `grade` 門檻；`newSubs = floor(peakViewers × sat.casual / 100 × 30 / 100) + clips × 200`；`flameDelta`；`moodDelta`（S/A：+10、B：+5、C：0、D：−10）。
  - `run`：依步數把 inputLog 分組，逐步 `step`。
  - `autoActions`：照介面說明實作；Task 6 起擴充為：topic 只念 `branch:"good"`、熱度滿時 `sig`、浪潮中優先念 origin。
- [ ] Run: `node tools/vkikaku_check/core_check.js` → 全部 ok
- [ ] Commit: `feat(vkikaku): 直播規則：留言流、判定、熱度、連擊、陣營、常客`

### Task 6: 直播核心（二）：浪潮、話題、工具、招牌技、精華、危機、任務

**Files:** Modify `static_src/vkikaku_stream.js`、`tools/vkikaku_check/core_check.js`

- [ ] 先在 `core_check.js` 加（會失敗）：
  - `waves = 2` 時中盤（300..1200 步）出現 2 次浪潮，每次 8 則同 `meme`、其中恰好 1 則 `origin` 且最先生成；念 origin → 熱度 ＋20（乘倍率前）；念其他 → ＋3。
  - 念 `branch:"good"` 的 topic → 40 步後出現一次浪潮；念 `branch:"bad"` → 之後 200 步內 danger 權重 ×3（統計：該區間 danger 比例明顯高於其他區間）。
  - `slow`：啟動後 100 步內生成的留言 `life` 加倍；冷卻 300 步內再用 → 無效。
  - `members`：100 步內不生成 troll／danger；同接不上升。
  - `pin`：指定一則 good → 200 步內每 10 步熱度 ＋1；釘選的留言不會離開畫面直到效果結束。
  - 招牌技：熱度 < heatCap 時 `sig` 無效；= heatCap 時有效，uta `highNote` → 畫面上 troll／spoiler／fake 全部視為正確刪除、normal 全部視為念到（各 ＋2）；kuro `clutch` → 立即開始一次浪潮、畫面上 spoiler 全刪；之後熱度變成 heatCap × 50％；一場最多 2 次。
  - 精華：熱度 ≥ heatCap × 90％ 時念到 good → `clips +1`（上限 3）。
  - 炎上火種：`crisis === "fire"` 時第 900 步生成來源 danger（`quoteOf:null`），未刪時每 60 步生成一則引用（`quoteOf` 為來源 cid）；刪掉來源後不再生成引用；來源漏掉 → flame ＋25；有常客好感 ≥ 5 時間隔變 90 步。
  - 任務：念到 `tag === mission.tag` 的 good 次數 ≥ `mission.count` → `missionDone`。
- [ ] 實作：
  - 浪潮排程：`create` 時在中盤依種子挑 `waves` 個起始步（彼此間隔 ≥ 150 步），每次從 `cfg.memes` 依序取梗；每 5 步生成 1 則，第一則為 origin。
  - 話題分支、工具、招牌技、精華、火種、任務照測試描述實作，數值全部讀 `D.STREAM`。
  - `step` 回傳的 events 給 UI 用：`{type:"spawn"|"leave"|"judge", cid, ok, heatDelta}`、`{type:"wave", meme}`、`{type:"sig"}`、`{type:"clip"}`、`{type:"fire"}`、`{type:"mission"}`、`{type:"segment", idx}`。
- [ ] Run: `node tools/vkikaku_check/core_check.js` → 全部 ok
- [ ] Commit: `feat(vkikaku): 直播規則：梗浪潮、話題分支、管理工具、招牌技、精華、炎上火種、任務`

### Task 7: 事務所核心與 24 週模擬

**Files:** Create `static_src/vkikaku_office.js`；Modify `tools/vkikaku_check/core_check.js`

**Interfaces:** Consumes Meeting、Stream、Data。Produces `Office.*`（見介面）。

- [ ] 先在 `core_check.js` 加（會失敗）：
  - `newGame(5)` 符合「資料形狀」；同 seed 兩次深度相等。
  - `validatePlan`：直播格合計 > 2 → `vk_err_stream_limit`；同一天兩人都 `record` → `vk_err_studio`；`restWeeks > 0` 的 Vtuber 排了 stream → `vk_err_resting`；長度不是 7 → `vk_err_len`。
  - `applyPlan`：`practice_song` 在 stream 前一天 → slot `skillBonus 1`（且 type 卡的技能是 song 時才有效，於 buildConfig 判斷：`skillBonusFor:"song"`）；promo 在 stream 前 → `viewersPct 115` 且扣 50000；連續 3 格高強度 → 體力 −20、心情 −15；record 後一天不是 rest → 心情 −5；rest → 體力 ＋30、心情 ＋10（上限 100）；SNS 的四種效果。
  - 關係：一人 2 場另一人 0 場 → 另一人心情 −10、relation −5；兩人各 1 場 → relation ＋2。
  - `applyStream`：訂閱 ＋newSubs、money ＋scIncome、flame ＋flameDelta、mood ＋moodDelta、技能經驗（B 以上 ＋2，否則 ＋1；每 3 點升 1 級，上限 10）、常客好感、好感（≥ B ＋2、D −2）、圖鑑組合、`history`。
  - `weekEnd`：扣薪水與器材、加會員收入、flame −10、等級更新；flame ≥ 100 → 炎上（restWeeks 2、subs ×90％、好感 −10、flame 40）；抽事件（依 `when` 過濾，`chancePct` 依種子）；給 3 張獎勵卡。
  - 生日：第 14 週 uta 的 stream slot `special:"birthday"`（`prep ≥ 3` 且 money ≥ 300000 時；扣錢）；評價 ≥ B → `birthdayDone`。
  - 年曆：第 8、20 週 trends 固定、ctx 手牌含特別卡。
  - **24 週自動模擬**：在 core_check 寫排程 AI（每週：兩人各 1 場直播、其他天交替 practice／rest、生日前 3 週放 prep；事件一律選第一個選項；獎勵卡選第一張、不刪卡），會議用 `Meeting.autoAct`、直播用 `Stream.autoActions`。種子 1..20 全部跑到 `ending !== null`，且：所有數值在範圍內（stamina、mood、affinity、flame 0..100；skills 1..10）、不出現 NaN、至少有一個種子得到 `all3d` 或 `popular`。再跑「什麼都不管的 AI」（直播不操作）→ 至少一個種子 `bankrupt` 或 `cozy`。印出每個結局的次數（調數值用）。
- [ ] 實作：照上述規則；`nextWeek`：week ＋1、restWeeks −1、清 `plan`／`pending`／`report`、重抽 trends；week > 24 或 money ≤ 0 → 依 `ENDINGS` 判定。
- [ ] Run: `node tools/vkikaku_check/core_check.js` → 全部 ok
- [ ] Commit: `feat(vkikaku): 事務所規則：行程板、SNS、週報、事件、生日 3D、年曆、結局`

### Task 8: 存檔

**Files:** Create `static_src/vkikaku_save.js`；Modify `tools/vkikaku_check/core_check.js`

- [ ] 先在 `core_check.js` 加（用假的 `localStorage` 物件放在 `global`）：`store` 後 `load` 深度相等；存入壞 JSON → `load()` 回傳 null；`migrate({v:0})` → null；`migrate` 補上缺少的欄位（例如舊存檔沒有 `codex`）。
- [ ] 實作：鍵 `pritest-vkikaku-save`；全部 try/catch；`migrate` 只接受 `v === 1`，缺欄位用 `Office.newGame` 的預設補。
- [ ] Commit: `feat(vkikaku): 存檔與遷移`

### Task 9: 共通 UI、事務所畫面、週報與結局

**Files:** Create `static_src/vkikaku_ui_common.js`、`static_src/vkikaku_ui_office.js`、`static_src/vkikaku_ui_report.js`；Modify `static_src/css/vkikaku.css`、`site_src/i18n_vkikaku.py`、`site_src/vkikaku_page.py`

- [ ] `ui_common`（`window.PriTestVkikakuUI`）：`el(tag, cls, text)`、`txt(obj)`（依 `I18N` 目前語言選 `ja`／`zh`，en 用 ja）、`bar(value, max, cls)`、`portrait(vtId, face)` 回傳 SVG（uta：粉色長髮＋星形髮飾；kuro：黑短髮＋貓耳耳機；4 表情 normal／happy／scared／angry 只改眼與嘴），`toast(msg)`。
- [ ] 滿版畫面（比照 `docs/shedan_game_design.md` §1.1），頂部列：週數／24、資金、事務所等級、☰（回首頁、語言、重新開始）。
- [ ] 事務所畫面：兩張 Vtuber 卡（立繪、訂閱、體力、心情、好感、炎上度條、技能、已揭露的隱藏項、生日準備度）；本週趨勢；關係值；行程板（每人 7 格，點格子跳出 `CELLS` 選單；SNS 格再選發文類型）；錯誤以 i18n 顯示；「開始這週」按鈕。
- [ ] 週報畫面：本週每場直播的評價與數字、收支、各數值變化（用 ▲▼ 標示）、事件（有選項就按鈕）、獎勵卡三選一＋「刪除一張卡」（顯示卡組清單）、「下一週」。
- [ ] 結局畫面：結局標題與文字、24 週歷史（每場評價）、總訂閱、「再玩一次」。
- [ ] 所有 UI 字串加進 `i18n_vkikaku.py`（zh／ja；en 先複製 ja），鍵一律 `vk_` 開頭。
- [ ] 手機 390px 寬可操作：行程板在手機上改為每人一列可橫向捲動的 7 格（只有行程板本身捲動，頁面不橫向捲動）。
- [ ] Run: `py -3 generate.py`、`node --check static_src/vkikaku_*.js`
- [ ] Commit: `feat(vkikaku): 事務所、週報、結局畫面`

### Task 10: 會議畫面

**Files:** Create `static_src/vkikaku_ui_meeting.js`；Modify `static_src/css/vkikaku.css`、`site_src/i18n_vkikaku.py`、`site_src/vkikaku_page.py`

- [ ] 版面：上方會議桌（Vtuber 立繪＋台詞泡泡、營運部長圖示）、兩條滿意度條（門檻線 50）、剩餘回合（5 個圓點）；中間四欄位（類型／題材／噱頭／時段）；下方手牌（卡片顯示名稱、標籤、主要效果摘要）；側邊：趨勢、已成立組合、說服牌、「調查」按鈕。
- [ ] 操作：點手牌 → 放進對應欄位（`play`）；長按或右上「換」→ `swap`；顧慮以泡泡顯示在 Vtuber 旁，點顧慮再點說服牌 → `persuade`；不可用的說服牌灰階並顯示解鎖條件。
- [ ] 每個 `act` 的 events 轉成演出：表情切換（like→happy、dislike→scared、mine→angry、fav→happy＋星星）、台詞、組合成立的橫幅、揭露時的卡片翻面。
- [ ] 確認區：`preview` 的同接範圍、炎上風險星等、預估超級留言、組合；`canStart` 為 false 時「開播」按鈕變成「強行開播」並顯示扣分提示。
- [ ] Commit: `feat(vkikaku): 企劃會議畫面`

### Task 11: 直播畫面與輸入

**Files:** Create `static_src/vkikaku_ui_stream.js`；Modify `static_src/css/vkikaku.css`、`site_src/i18n_vkikaku.py`、`site_src/vkikaku_page.py`

- [ ] 迴圈：`requestAnimationFrame` 累積時間，每滿 50 ms 呼叫一次 `Stream.step(st, queued)`，同時把 `queued` 以 `{step, ...action}` 推進 `inputLog`；分頁切到背景（`visibilitychange`）時暫停。
- [ ] 版面：左側 Vtuber 立繪（表情依熱度：<30 scared、30..80 normal、>80 happy；危機中 angry）、直播標題（四張卡名稱組成）、同接、熱度條（滿了發光並顯示「招牌技」按鈕）、連擊數、剩餘時間與三段進度；右側聊天室（`Stream.visible` 依 `progress` 由下往上排列，`Chat.render` 出文字；sc 有金額色帶、常客有固定頭像色、話題留言有 💬 圖示、浪潮的 origin 不特別標示）；下方工具列（慢速、會員限定、釘選，顯示冷卻）。
- [ ] 操作：點留言 → 在留言旁出現 4 方向語氣輪盤＋刪除＋封鎖（troll 才顯示封鎖）；選語氣 → `read`。鍵盤：↑↓ 移動選取、`1`～`4` 語氣念、`D` 刪、`B` 封鎖、`Q`／`W`／`E` 工具、空白鍵招牌技。
- [ ] events 演出：判定正確綠閃＋熱度飄字、錯誤紅閃、浪潮的橫幅、精華時刻的邊框、炎上火種的紅色警告與引用連線、任務達成提示。
- [ ] 結束：顯示 `streamResult`（評價大字、各數字），按「下一步」交回 `vkikaku.js`。
- [ ] Commit: `feat(vkikaku): 直播畫面、語氣輪盤與鍵盤操作`

### Task 12: 畫面流程、`_debug` 與畫面檢查

**Files:** Modify `static_src/vkikaku.js`；Create `tools/vkikaku_check/ui_check.js`

- [ ] 狀態機：`title`（新遊戲／繼續）→ `office` → （每個 stream slot）`meeting` → `stream` → `streamResult` → … → `report` → `office`（下一週）或 `ending`。
- [ ] 存檔時機：`applyPlan` 後、每場 `applyStream` 後、`weekEnd` 後、`pickReward` 後、`nextWeek` 後。會議與直播進行中不存檔；重新整理時回到該週事務所並重新開始未完成的那場（`pending` 中尚未套用的 slot）。
- [ ] `window.PriTestVkikakuApp._debug = { save(), screen(), autoMeeting(), autoStream(on), fastForward(n) }`：`autoMeeting` 反覆呼叫 `Meeting.autoAct` 並在畫面上演出；`autoStream(true)` 每步把 `Stream.autoActions` 加入佇列；`fastForward(n)` 讓直播一次跑 n 步。
- [ ] `ui_check.js`（`addInitScript` 寫入付款解鎖旗標；按鈕一律 `dispatchEvent`）：
  - 手機 390×844、桌機 1280×800：首頁「付款」分頁看得到 V 企劃室 → 開頁 → 新遊戲 → 排一週行程（兩人各 1 場直播）→ 會議（`autoMeeting`）→ 直播（`autoStream(true)`＋`fastForward(1500)`）→ 結算 → 第二場 → 週報 → 選獎勵 → 第 2 週事務所畫面；沒有 console error；`document.documentElement.scrollWidth <= innerWidth`。
  - 手動操作一則留言：`dispatchEvent` 點留言、點語氣 → 熱度改變。
  - 重新整理 → 週數與數值保留。
  - 語言切換 zh／ja → 留言與卡名切換。
  - 每個主要畫面截圖存到 scratchpad。
- [ ] Run: `py -3 generate.py`、`node --check static_src/vkikaku_*.js`、`node tools/vkikaku_check/core_check.js`、`py -3 tools/split_css.py --check`、啟動 `py -3 -m http.server 8976 --directory dist` 後 `VKIKAKU_ROOT=http://localhost:8976/ node tools/vkikaku_check/ui_check.js`（Playwright 從 `tools/midnight_check/node_modules` 取得，比照 inusnow 的 ui_check 寫法）。
- [ ] Commit: `feat(vkikaku): 畫面流程、存檔時機與畫面檢查`

### Task 13: 版本與推送

- [ ] `site_src/version.py` 遞增 minor（`2.86.0` → `2.87.0`，若期間已有其他推送就再往上）。
- [ ] `docs/vkikaku_design.md` §A.1 標記 P1 完成；實作和設計不同的地方寫進 §0 決定記錄（例：隱藏偏好以卡片 id 判定）。
- [ ] Commit: `feat(vkikaku): v2.87.0 V 企劃室第 1 階段：事務所週循環、企劃會議、直播聊天室管理`
- [ ] `git push private main`

## 自我檢查（對照 docs/vkikaku_design.md 第 1 階段）

| 設計 | Task |
|---|---|
| §1.1 24 週、週流程 | 7、9、12 |
| §1.2 會議 → `streamConfig` → 直播 → 週報 | 4、5、7 |
| §1.3 炎上、資金歸零 | 7 |
| §1.4 存檔 | 8、12 |
| §2.1 四欄位、標籤、卡組 24 張、手牌 6 | 2、4、10 |
| §2.2 5 回合、出卡／換牌／說服／調查 | 4、10 |
| §2.3 雙滿意度、門檻、強行開播 | 4、10 |
| §2.4 組合 12 種、圖鑑 | 2、4、7 |
| §2.5 隱藏偏好、調查、表情台詞 | 2、4、10 |
| §2.6 說服 4 牌、解鎖條件 | 2、4、10 |
| §2.7 趨勢 | 4、7 |
| §2.8 確認畫面 | 4、10 |
| §3.1 畫面、75 秒、三段 | 5、11 |
| §3.2 七種留言＋話題留言、念／刪／封鎖 | 3、5、11 |
| §3.3 連擊、梗浪潮、狀態、3 工具、精華 | 5、6、11 |
| §3.4 回應語氣 | 3、5、11 |
| §3.5 觀眾陣營 | 5 |
| §3.6 常客 5 位 | 3、5、7 |
| §3.7 話題分支 | 3、6 |
| §3.8 公開任務 | 2、3、6 |
| §3.9 招牌技 | 2、6、11 |
| §3.10 炎上火種 | 6、11 |
| §3.12 評價、`streamResult` | 5、11 |
| §3.13 留言模板 zh／ja 30 則以上 | 3 |
| §3.14 固定步長、輸入紀錄、重播 | 5、11 |
| §4.1 Vtuber 數值 | 2、7 |
| §4.2 行程板（相鄰、疲勞、設備） | 7、9 |
| §4.3 SNS 發文 | 2、7、9 |
| §4.4 資金、等級、卡組管理 | 7、9 |
| §4.5 生日 3D | 7 |
| §4.6 關係值 | 7 |
| §4.7 年曆 2 個 | 2、7 |
| §4.8 2 位 Vtuber、4 表情 | 2、9 |
| §4.10 週報事件 10 種 | 2、7、9 |
| §4.11 結局 4 種 | 2、7、9 |
| §5 檔案、確定性、驗證 | 全部 |
