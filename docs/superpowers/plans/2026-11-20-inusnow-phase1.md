# イヌスノー（inusnow）第 1 階段 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 做出可以實際玩的イヌスノー核心：8 個日本真實雪場（OSM 雪道＋國土地理院標高）的地形上，用單板狗選手滑大曲道單人計時（旗門、失格、2 趟合計），輸入紀錄可以重播成幽靈，手機拖曳、陀螺儀、桌機鍵盤都能操作。

**Architecture:** 建置工具 `tools/inusnow_data/fetch.py` 把 OSM 與標高圖轉成每個雪場一個 JSON，提交進 repo。規則核心分成 `inusnow_terrain.js`（格網高度、法線、雪道幾何）、`inusnow_phys.js`（單板物理，固定步長）、`inusnow_core.js`（旗門、比賽、紀錄、存檔格式），三者都不碰 DOM、不讀寫 localStorage，只用 `+ − × ÷` 與 `Math.sqrt`，之後照著移植成 Go。畫面在 `inusnow_3d.js`（three.js）與 `inusnow.js`（UI、輸入、存檔）。

**Tech Stack:** Vanilla ES5 IIFE、Python 產生靜態 HTML（`generate.py`）、Python 建置工具（只用標準函式庫＋`urllib`）、Node `assert` 的規則檢查、Playwright 的畫面檢查、three.js r149（`static/vendor/three.min.js`）。

## Global Constraints

- 規則依據：`docs/inusnow_design.md`（§2、§3、§4.1、§5.1、§10、§13 是第 1 階段的範圍）。數值都是「暫定」，集中在 `inusnow_data.js`，不要散落在程式裡。
- 前綴：JS `window.PriTestInusnow*`、i18n 鍵 `inu_`、CSS class／id `inu-`。遊戲樣式只放 `static_src/css/inusnow.css`，**不要加進 `style.css`**；在 `tools/split_css.py` 的 `GAMES` 登記 `inu-`，在 `generate.py` 的 `GAME_I18N_PREFIXES` 登記 `inu_`。
- 不讀、不改 saigo 或其他遊戲的檔案（CLAUDE.md §5.2.1）。
- **確定性**：`inusnow_terrain.js`／`inusnow_phys.js`／`inusnow_core.js` 不得使用 `Math.sin/cos/atan2/pow/exp/log/random`，只能用 `+ − × ÷`、`Math.sqrt`、`Math.floor`、`Math.abs`、比較。亂數只用 `Core.makeRng(seed)`（mulberry32）。`tools/inusnow_check/core_check.js` 用原始碼掃描確認。
- 資料出處：每個雪場 JSON 帶 `attribution`；畫面的載入畫面與「關於」顯示「© OpenStreetMap contributors」與「出典：国土地理院 標高タイル」。`static_src/inusnow/data/LICENSE.txt` 寫明 ODbL。
- 雪道指南（ゲレンデマップ）圖片不下載、不描圖、不放進 repo，只用來確認事實，寫進 JSON 的 `notes`。
- 建置工具的 HTTP 請求帶通用 User-Agent（`PriTest-build-tool/1.0`），不含個人資訊；Overpass 每次查詢間隔 5 秒以上，標高圖每張間隔 0.2 秒以上，下載結果快取在 `tools/inusnow_data/cache/`（加進 `.gitignore`）。
- 首頁：放在「付款」分頁（`projects.py` 的 `pay`），頁面 `page_shell(paid=True)`；Playwright 開頁前先 `addInitScript` 寫入 `pritest-pay-unlocked`（CLAUDE.md §4.3.1）。
- 載入順序：`inusnow_data.js` → `inusnow_terrain.js` → `inusnow_phys.js` → `inusnow_core.js` → `inusnow_input.js` → `inusnow_3d.js` → `inusnow.js`。
- Playwright 一律用 `dispatchEvent` 觸發（CLAUDE.md §4.6）。
- 存檔鍵 `pritest-inusnow-save-v1`；讀寫一律 try/catch，壞檔就重建。
- 版本：`site_src/version.py` 遞增 minor。只推 `private`（`git push private main`），不要碰 `origin`。
- 回覆、註解、文件、commit message 用繁體中文。

## 檔案結構

| 檔案 | 責任 |
|---|---|
| `tools/inusnow_data/fetch.py` | 建置工具：Overpass 查雪道與纜車、地理院標高圖、座標轉換、格網重取樣、輸出 JSON |
| `tools/inusnow_data/resorts.py` | 8 個雪場的範圍（bbox）、大曲道用雪道、手動修正（`notes`） |
| `static_src/inusnow/data/<id>.json` | 8 個雪場的資料（`generate.py` 複製到 `dist/static/inusnow/data/`） |
| `static_src/inusnow/data/LICENSE.txt` | ODbL 與地理院出處 |
| `static_src/inusnow_data.js` | 數值表：PHYS、雪質、旗門、犬種 8 種、雪場清單（id、名稱、地區） |
| `static_src/inusnow_terrain.js` | 格網解碼、雙線性高度、法線、雪道中心線的弧長參數化、最近點 |
| `static_src/inusnow_phys.js` | 單板物理：地面、轉彎、橫滑、空中、落地、摔倒 |
| `static_src/inusnow_core.js` | rng、旗門配置、旗門通過判定、比賽流程（1／2 趟）、輸入紀錄編碼、重播、存檔格式 |
| `static_src/inusnow_input.js` | 拖曳、陀螺儀、鍵盤 → 每步的量化輸入 |
| `static_src/inusnow_3d.js` | three.js：地形 mesh、雪道、樹林、旗門、狗與雪板、幽靈、鏡頭 |
| `static_src/inusnow.js` | 畫面（選雪場、選犬種、比賽、結果）、存檔、滿版與「☰」導覽列 |
| `static_src/css/inusnow.css` | 樣式 |
| `site_src/inusnow_page.py` | 頁面 |
| `site_src/i18n_inusnow.py` | UI 字串（zh／ja／en） |
| `tools/inusnow_check/core_check.js` | 規則檢查（Node） |
| `tools/inusnow_check/ui_check.js` | 畫面檢查（Playwright） |

## 介面

```js
// inusnow_terrain.js → window.PriTestInusnowTerrain（Node：module.exports）
Terrain.load(json) → terrain                       // 解碼 base64 Int16LE 格網
Terrain.height(terrain, x, z) → y                  // 雙線性；範圍外夾到邊界
Terrain.normal(terrain, x, z) → [nx, ny, nz]       // 中央差分，sqrt 正規化
Terrain.piste(terrain, pisteId) → piste            // {pts, cum（累積弧長）, len, width}
Terrain.nearest(piste, x, z) → {s, d, i}           // s＝弧長、d＝帶號側向距離（右正）、i＝線段
Terrain.at(piste, s) → {x, z, tx, tz}              // 弧長 s 處的點與單位切線

// inusnow_phys.js → window.PriTestInusnowPhys
Phys.create(terrain, start, dog) → state           // start＝{x, z, tx, tz}
Phys.step(state, input, env) → events              // input＝{s, c, j, g}；env＝{snow}；events＝["land", "fall", ...]
Phys.speed(state) → m/s

// inusnow_core.js → window.PriTestInusnowCore
Core.makeRng(seed) → () => 0..1；Core.hash(str) → uint32
Core.makeGates(terrain, pisteId, seed) → [{s, x, z, side: -1|1, w}]
Core.gateCheck(prevP, p, gate) → "pass"|"miss"|null   // 線段與旗門橫線的相交（只用乘除）
Core.newRun(terrain, opts) → run                   // opts＝{resort, piste, seed, dog, snow, ghost?}
Core.stepRun(run, input) → run.status              // "run"|"finish"|"dsq"
Core.encode(inputs) → str；Core.decode(str) → inputs   // 行程長度編碼
Core.replay(terrain, opts, rec) → {time, status, frames}
Core.newSave() → save；Core.migrate(obj) → save
```

---

### Task 1: 頁面骨架與登記

**Files:** Create `site_src/inusnow_page.py`、`site_src/i18n_inusnow.py`、`static_src/css/inusnow.css`、`static_src/inusnow.js`（空殼）；Modify `generate.py`、`site_src/projects.py`、`site_src/i18n_data.py`、`tools/split_css.py`、`CLAUDE.md`

- [ ] `inusnow_page.py`：`build_inusnow_html()`，`page_shell(paid=True, extra_styles=("css/inusnow.css",), extra_i18n=("i18n/inusnow.js",), extra_scripts=INUSNOW_SCRIPTS)`；body 為 `<div id="inu-app" data-three-src="..." data-data-dir="../static/inusnow/data/">`。
- [ ] `generate.py`：`build_pages()` 輸出 `dist/inusnow/index.html`；`GAME_I18N_PREFIXES["inusnow"] = ("inu_",)`；把 `static_src/inusnow/data/` 整個複製到 `dist/static/inusnow/data/`（確認現有的複製方式是否已涵蓋子目錄，沒有就加）。
- [ ] `projects.py`：新增 `inusnow` 專案，放進 `pay` 分頁最後；`i18n_data.py` 加 `project_inusnow_name`（狗雪／イヌスノー／Inu Snow）與 `project_inusnow_desc`。
- [ ] `tools/split_css.py` 的 `GAMES` 加 `"inusnow": ("inu-",)`；CLAUDE.md §5.2.1 的清單加 inusnow。
- [ ] Run: `py -3 generate.py` → 成功；`py -3 tools/split_css.py --check` → 沒有混入。
- [ ] Commit: `feat(inusnow): 頁面骨架與登記`

### Task 2: 建置工具與 8 個雪場資料

**Files:** Create `tools/inusnow_data/fetch.py`、`tools/inusnow_data/resorts.py`、`static_src/inusnow/data/*.json`、`static_src/inusnow/data/LICENSE.txt`；Modify `.gitignore`

- [ ] `resorts.py`：8 個雪場（設計 §2.2）的 `bbox`（南、西、北、東）、名稱（ja／zh／en）、縣、`gs` 用雪道的 OSM 名稱候選、`notes`。
- [ ] `fetch.py`：
  - Overpass 查 `way["piste:type"="downhill"]` 與 `way["aerialway"]`，`out geom`；快取到 `cache/<id>_osm.json`。
  - 依雪道範圍外擴 150 m 決定格網範圍，下載 z15 的 DEM5A（`https://cyberjapandata.gsi.go.jp/xyz/dem5a_png/{z}/{x}/{y}.png`），缺值（`(128,0,0)`）用 DEM10B z14 補；PNG 解碼用 `zlib`＋自寫的 PNG filter 還原（不依賴 Pillow）。高度＝`(R×65536＋G×256＋B)×0.01`，超過 2^23 時減 2^24。
  - 重取樣到 8 m 格網，輸出 Int16LE（`(h − base) × 10`）的 base64。
  - 座標轉換用設計 §2.3 的近似，原點為格網西南角。
  - 依 §2.2 的條件選 `events.gs.piste`（長度 ≥ 600 m、高低差 ≥ 150 m、難度 intermediate／advanced，優先用 `resorts.py` 的候選名稱）。
  - 印出每個雪場的雪道數、格網大小、檔案大小、選到的大曲道雪道（名稱、長度、高低差）。
- [ ] 執行 `py -3 tools/inusnow_data/fetch.py --all`；OSM 資料不足（找不到符合條件的雪道）的雪場，依設計 Q1 換成安比高原、妙高赤倉、富良野，並在回報中列出。
- [ ] 檢查：8 個 JSON 合計 ≤ 4 MB；每個都有 `attribution`、`events.gs.piste`。
- [ ] Commit: `feat(inusnow): OSM＋地理院標高的雪場資料工具與 8 個雪場`

### Task 3: 數值表與地形

**Files:** Create `static_src/inusnow_data.js`、`static_src/inusnow_terrain.js`、`tools/inusnow_check/core_check.js`

- [ ] `inusnow_data.js`：`PHYS`（g、步長、`k_air`、grip、skidLoss、v_ollie、落地角度門檻、摔倒停頓）、`SNOW`（設計 §6，第 1 階段只用壓雪）、`GATES`（間距 25～30 m、旗門寬 8 m、側向偏移比例）、`BREEDS` 8 種（6 項能力與外觀參數）、`RESORTS`（id、名稱、縣）。
- [ ] `inusnow_terrain.js`：照介面實作；`nearest` 用投影到線段（只用內積與除法）。
- [ ] `core_check.js` 先寫：
  - 讀 `happo.json`：`height` 在格網點上等於解碼值；格網中央的高度在 OSM 雪道起點高於終點。
  - `normal` 是單位向量（誤差 < 1e−9）。
  - `piste` 的 `len` 等於累積弧長；`nearest(at(s))` 回傳同一個 s（誤差 < 0.01 m）。
  - 原始碼掃描：三個核心檔不含 `Math.sin|cos|tan|atan|pow|exp|log|random`。
- [ ] Run: `node tools/inusnow_check/core_check.js` → OK
- [ ] Commit: `feat(inusnow): 數值表、格網地形與雪道幾何`

### Task 4: 單板物理

**Files:** Create `static_src/inusnow_phys.js`；Modify `tools/inusnow_check/core_check.js`

- [ ] 照設計 §3 實作 `create`／`step`／`speed`：
  - 板頭方向 `h` 的轉動：`h += k·[−hz, hx]` 後 sqrt 正規化。
  - 地面：重力切向分量、雪面摩擦、空氣阻力（蹲低減阻）、轉彎的側向加速度上限與橫滑減速。
  - 離地：地面曲率超過速度能貼住的程度，或 `j` 從 1 變 0（ollie）。
  - 空中：重力、阻力、轉體累計 `yawAir`；落地判定（內積換算的角度門檻）與摔倒停頓。
  - 犬種能力只透過 `PHYS` 的乘數影響（平衡→grip、力量→加速、勇氣→ollie、體型→阻力）。
- [ ] `core_check.js` 加：
  - 在八方的大曲道雪道起點、不輸入：10 秒後速度 > 0 且沿坡往下（高度下降）。
  - 蹲低時的終速 > 不蹲低。
  - 一直轉向（s＝8）時會發生橫滑（速度比直滑低）。
  - 同一組輸入跑兩次，每一步的狀態完全相等（`===`）。
- [ ] Commit: `feat(inusnow): 單板物理（刻滑、橫滑、空中、落地）`

### Task 5: 大曲道規則、紀錄與重播

**Files:** Create `static_src/inusnow_core.js`；Modify `tools/inusnow_check/core_check.js`

- [ ] `makeGates`：沿雪道每 25～30 m 一座，左右交錯，側向偏移由 seed 決定，不超出雪道寬度的 35%。
- [ ] `gateCheck`：這一步的移動線段和旗門橫線相交時，看交點在旗竿的哪一側，判定通過或漏門；通過時回傳和旗竿的距離。
- [ ] G4 完美旗門（設計 §4.1）：距離 < 0.5 m＝完美，給 `run.boost`（倍率與剩餘步數），`Phys.step` 的 env 帶入倍率；連續完美累加、普通通過歸零。數值放 `GATES.perfect`。
- [ ] `newRun`／`stepRun`：起跑 3 秒倒數 → 滑行 → 通過終點線＝`finish`；漏門＝`dsq`；離開雪道 60 m 以上或停在原地 8 秒＝`dsq`；單趟超過 180 秒＝`dsq`。2 趟合計時，第 2 趟換一組旗門（seed＋1）。
- [ ] `encode`／`decode`：每步輸入轉成 4 個小整數，行程長度編碼成 base36 字串。
- [ ] `replay`：用同一份 opts 與紀錄重跑，回傳時間、狀態、每 2 步一格的位置（給幽靈用）。
- [ ] `newSave`／`migrate`：設計 §13。
- [ ] `core_check.js` 加：
  - 旗門數 20～35，左右交錯，都在雪道內。
  - 寫一個簡單的自動駕駛（朝下一座旗門內側轉向）在八方跑完一趟 → `finish`，時間在 30～180 秒。
  - 把自動駕駛的輸入 `encode` 再 `replay` → 時間與最後位置完全相同。
  - 故意朝外側滑 → `dsq`。
  - 完美旗門：把狗放在離旗竿 0.3 m 處通過 → `perfect`，速度倍率 ×1.03；接著 1.5 m 處通過 → 連續數歸零。
  - 8 個雪場各跑一次自動駕駛 → 全部能 `finish`（找出雪道或旗門配置不合理的雪場）。
- [ ] Commit: `feat(inusnow): 大曲道旗門、比賽流程、輸入紀錄與重播`

### Task 6: 操作輸入

**Files:** Create `static_src/inusnow_input.js`

- [ ] 拖曳：畫面下半部的 pointer 事件，左右位移換算成 `s`（−8..8，60 px 滿格，暫定）；往下拖 > 40 px＝`c`；放開前 150 ms 內往上滑 > 30 px＝`j`。
- [ ] 陀螺儀：`deviceorientation` 的 `gamma`（左右傾斜）±25° 滿格；iOS 要先按「啟用傾斜操作」按鈕呼叫 `DeviceOrientationEvent.requestPermission()`；沒有權限時退回拖曳。
- [ ] 鍵盤：← → 轉向（按住時 0.2 秒內漸增到滿格）、↓ 蹲低、空白鍵起跳。
- [ ] `Input.sample() → {s, c, j, g}`：每個物理步呼叫一次；設定存在存檔的 `settings.control`。
- [ ] Commit: `feat(inusnow): 拖曳、陀螺儀、鍵盤操作`

### Task 7: three.js 畫面

**Files:** Create `static_src/inusnow_3d.js`

- [ ] 第一次進比賽時才載入 `vendor/three.min.js`（比照 saigo 的 `data-three-src`）。
- [ ] 地形：格網轉 `BufferGeometry`（顏色依雪道內外與難度），雪道外用 seed 決定的樹（`InstancedMesh`），纜車塔與纜線當景觀。
- [ ] 旗門：紅藍交替的旗；終點拱門。
- [ ] 狗與雪板：程序生成（身體、頭、耳、尾、四肢，依犬種外觀參數），姿勢依 `edge`／`crouch`／空中轉體；摔倒動畫。
- [ ] 幽靈：半透明的同一隻狗，位置依重播 frames 內插。
- [ ] 鏡頭：追身（預設）、轉播、空拍、第一人稱；畫面右上切換。
- [ ] 畫面每幀依物理狀態內插（物理固定 60 步／秒，畫面用 `requestAnimationFrame`）。
- [ ] Commit: `feat(inusnow): three.js 地形、旗門、狗選手、幽靈與鏡頭`

### Task 8: 畫面流程、存檔與畫面檢查

**Files:** Modify `static_src/inusnow.js`、`static_src/css/inusnow.css`、`site_src/i18n_inusnow.py`；Create `tools/inusnow_check/ui_check.js`

- [ ] 滿版畫面與「☰」導覽列（比照 shedan 設計 §1.1）。
- [ ] 畫面：首頁（選雪場：名稱、縣、大曲道雪道的長度與高低差）→ 選犬種與名字 → 選 1 趟或 2 趟、有無幽靈 → 比賽（倒數、計時、速度、下一座旗門、通過數、完美旗門的連續數與特效）→ 結果（時間、最佳紀錄、重播按鈕、分享紀錄碼）。
- [ ] 載入畫面與「關於」顯示資料出處（設計 §2.1）。
- [ ] 存檔：最佳紀錄與輸入紀錄存在 `best`；讀檔 try/catch。
- [ ] `_debug`：`window.PriTestInusnowApp._debug = { state, autopilot(on), start(resort, opts) }`，給 Playwright 用。
- [ ] `ui_check.js`（`addInitScript` 寫入付款解鎖旗標）：
  - 手機 390×844、桌機 1280×800：開頁、選八方、開賽，用 `_debug.autopilot(true)` 跑完 → 結果畫面顯示時間；沒有 console error；畫面無捲軸。
  - 重新整理 → 最佳紀錄還在；開幽靈 → 畫面上有幽靈。
  - 用 `dispatchEvent` 送 pointer 事件拖曳 → `Input.sample().s` 改變。
  - 8 個雪場各開一次 → 地形載入成功（截圖存在 scratchpad）。
- [ ] Run: `py -3 generate.py`、`node --check` 每個 JS、`node tools/inusnow_check/core_check.js`、啟動 `py -3 -m http.server 8975 --directory dist` 後 `INUSNOW_ROOT=http://localhost:8975/ node tools/inusnow_check/ui_check.js`。
- [ ] Commit: `feat(inusnow): 畫面流程、存檔與畫面檢查`

### Task 9: 版本與推送

- [ ] `site_src/version.py` 遞增 minor（目前 `2.81.0` → `2.82.0`，若期間已有其他推送就再往上）。
- [ ] 設計文件標記第 1 階段完成。
- [ ] Commit: `feat(inusnow): v2.82.0 イヌスノー第 1 階段：8 個真實雪場的單板大曲道`
- [ ] `git push private main`

## 自我檢查（對照 docs/inusnow_design.md 第 1 階段）

| 設計 | Task |
|---|---|
| §2 8 個雪場、OSM＋地理院、出處、雪道指南只確認事實 | 2、8 |
| §3 單板物理、只用加減乘除與 sqrt、輸入紀錄 | 3、4、5 |
| §4.1 大曲道：旗門、漏門失格、2 趟合計、G4 完美旗門 | 5、8 |
| §5.1 犬種 8 種 | 3、7 |
| §7.1 自己的最佳幽靈 | 5、7、8 |
| §10 three.js、鏡頭、拖曳／陀螺儀／鍵盤、滿版 | 6、7、8 |
| §13 存檔 | 5、8 |
| D15 付款分頁 | 1、8 |
