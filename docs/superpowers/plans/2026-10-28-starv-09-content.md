# starV 計畫 9：內容量 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把內容補到規格 v1 的量：SR 30／SSR 12（每位 SSR 有專屬技能與小故事）、宿敵明星擴充、宿敵劇情 10 段（與同一位宿敵反覆競爭時依序觸發）、成就 60 項（獎勵星探券與稱號）、R 姓名庫與作品名詞庫加倍；舊存檔的名字與作品名不變。

**Architecture:** 內容一律放新的資料檔（`starv_roster_2.js`、`starv_roster_3.js`、`starv_roster_rivals_2.js`、`starv_events_5.js`、`starv_achievements_3.js`、`starv_words_1.js`），透過既有登記器追加；核心只加三件事：宿敵劇情的計數與推出（`rivalFeud`）、成就的新判定類型、稱號（`st.title`、`Core.setTitle`）。R 的姓名庫擴充用「新 nameSeed ≥ 1,000,000」區分：舊 seed 只用前 20 個名字（`D.NAME_V1_LEN`），所以舊存檔、日誌、名人堂的名字都不變；作品名只在詞庫尾端追加，舊索引不變。

**Tech Stack:** Vanilla ES5、node、Playwright。

## Global Constraints

- 規格 §3.3：SR 能力合計 200～300、主方向適性 A 以上、特質 1～2；SSR 能力合計 350～450、主方向 S、特質 2＋專屬技能；SSR 每位 1 段小故事（得獎後解鎖，既有機制）
- 規格 §3.2：專屬技能的 fx 只能用 core 支援的修正鍵（＝`D.TRAITS` 用到的鍵＋`greatShift`）
- 規格 §4：每位 SR／SSR／宿敵明星都有固定 ID（`sr###`、`ssr###`、`rv###`），ID 永不重用，帶 `addedIn`；新增名錄＝新增 `starv_roster_N.js` 並加進頁面
- 規格 §7：每個事件都必須有 `defaultChoice`；宿敵劇情 10 段
- 規格 §9：與同一位宿敵連續競爭會觸發劇情事件
- 規格 §14：成就約 60 項，獎勵為星探券與稱號
- 規格 §20-9：詞庫與姓名庫擴充
- 舊存檔相容：R 藝人的名字、作品名、名人堂與日誌裡的名字都不能因擴充而改變；存檔版本 5 → 6（`fillDefaults` 補 `rivalStory`、`title`）
- 不修改其他遊戲；CLAUDE.md §5.2.1 前綴；推送前遞增版本號；測試頁面按鈕一律用 `dispatchEvent`

## 檔案結構

| 檔案 | 責任 |
| --- | --- |
| Create `static_src/starv_roster_2.js` | SR 27 位（sr004～sr030） |
| Create `static_src/starv_roster_3.js` | SSR 10 位（ssr003～ssr012） |
| Create `static_src/starv_roster_rivals_2.js` | 宿敵明星 10 位（rv011～rv020） |
| Create `static_src/starv_words_1.js` | R 姓名庫各 +20、16 方向作品名詞庫各 +6／+6 |
| Create `static_src/starv_events_5.js` | 宿敵劇情 10 段（rival_story_1～10） |
| Create `static_src/starv_achievements_3.js` | 成就 38 項（合計 60） |
| Modify `static_src/starv_data.js` | `NAME_V1_LEN` |
| Modify `static_src/starv_core.js` | nameSeed v2、宿敵劇情、成就新類型、稱號、VERSION 6 |
| Modify `static_src/starv_view_hall.js`、`site_src/i18n_starv.py`、`static_src/css/starv.css` | 稱號 UI |
| Modify `static_src/starv_roster_1.js` | 檔頭註解 |
| Modify `site_src/starv_page.py`、`tools/starv_check/core_check.js`、`tools/starv_check/sim.js` | 登記新資料檔（三處的載入順序一致） |
| Modify `tools/starv_check/core_check.js`、`tools/starv_check/ui_check.js` | 測試 |

新資料檔的載入順序（頁面 `STARV_SCRIPTS`、`core_check.js`、`sim.js` 都照這個順序插入）：

- `starv_words_1.js` 緊接在 `starv_data.js` 之後
- `starv_events_5.js` 緊接在 `starv_events_4.js` 之後
- `starv_achievements_3.js` 緊接在 `starv_achievements_2.js` 之後
- `starv_roster_2.js`、`starv_roster_3.js` 緊接在 `starv_roster_1.js` 之後
- `starv_roster_rivals_2.js` 緊接在 `starv_roster_rivals_1.js` 之後

> **既有測試的連帶影響：** 名錄、詞庫變大後，用固定 seed 的測試抽到的角色、作品名可能改變（亂數呼叫次數不變，但 `pick` 的結果會變）。遇到這種失敗時，先確認是「期望值寫死了某個抽選結果」，再把期望值改成從資料算出來或改用範圍檢查，並在該處註解「計畫 9 擴充名錄後抽選結果改變」（CLAUDE.md §4.7）。不要為了讓舊測試通過而刪減內容。

---

### Task 1：SR 27、SSR 10、宿敵明星 10

**Files:**
- Create: `static_src/starv_roster_2.js`、`static_src/starv_roster_3.js`、`static_src/starv_roster_rivals_2.js`
- Modify: `static_src/starv_roster_1.js`（檔頭）、`site_src/starv_page.py`、`tools/starv_check/core_check.js`、`tools/starv_check/sim.js`
- Test: `tools/starv_check/core_check.js`

**Interfaces:**
- Consumes：`PriTestStarvRoster.add(entries)`、`PriTestStarvData.T("zh|ja")`
- Produces：`Roster.byRarity("SR").length === 30`、`Roster.byRarity("SSR").length === 12`、`Roster.rivals().length === 20`

- [ ] **Step 1：改寫名錄測試（先寫測試）**

`tools/starv_check/core_check.js` 的 `test("名錄：首批 SR 3、SSR 2，欄位完整", …)` 改名並改第一行：

```js
test("名錄：SR 30、SSR 12、宿敵 20，欄位完整", function () {
  eq(Roster.byRarity("SR").length, 30, "SR 數"); eq(Roster.byRarity("SSR").length, 12, "SSR 數");
  eq(Roster.rivals().length, 20, "宿敵數");
```

（其餘內容不動。）緊接在它後面新增：

```js
test("名錄：稀有度規則（能力合計、主方向適性、特質數、外觀範圍、技能 fx、名字不重複、涵蓋 16 方向）", function () {
  var fxKeys = { greatShift: 1 };
  D.TRAITS.forEach(function (t) { Object.keys(t.fx).forEach(function (k) { fxKeys[k] = 1; }); });
  function topStats(dir) {
    var w = D.DIR_BY_ID[dir].weights, mx = 0;
    Object.keys(w).forEach(function (k) { mx = Math.max(mx, w[k]); });
    return Object.keys(w).filter(function (k) { return w[k] === mx; });
  }
  var names = {}, L = D.LOOK;
  Roster.all().forEach(function (e) {
    ["zh", "ja"].forEach(function (l) { assert(!names[l + e.name[l]], e.id + " 名字重複 " + e.name[l]); names[l + e.name[l]] = 1; });
    var k = e.look;
    assert(k.face >= 0 && k.face < L.face && k.hair >= 0 && k.hair < L.hair && k.eye >= 0 && k.eye < L.eye &&
      k.outfit >= 0 && k.outfit < L.outfit && k.acc >= -1 && k.acc < L.acc &&
      k.hairColor >= 0 && k.hairColor < L.hairColors.length && k.skin >= 0 && k.skin < L.skins.length, e.id + " 外觀超出範圍");
    if (e.skill) Object.keys(e.skill.fx).forEach(function (f) { assert(fxKeys[f], e.id + " 技能 fx 不支援 " + f); });
    assert(/^(sr|ssr|rv)\d{3}$/.test(e.id) && e.addedIn, e.id + " ID 格式／addedIn");
    if (e.kind === "rival") return;
    var sum = D.STATS.reduce(function (s, x) { return s + e.stats[x]; }, 0), R = D.RARITY[e.rarity];
    assert(sum >= R.statTotal[0] && sum <= R.statTotal[1], e.id + " 能力合計 " + sum);
    assert(e.traits.length >= R.traits[0] && e.traits.length <= R.traits[1], e.id + " 特質數 " + e.traits.length);
    var need = e.rarity === "SSR" ? ["S"] : ["S", "A"];
    topStats(e.dir).forEach(function (s) { assert(need.indexOf(e.apt[s]) >= 0, e.id + " 主方向適性 " + s + "=" + e.apt[s]); });
    assert(e.subDirs.length <= 2, e.id + " 副方向最多 2");
    e.subDirs.forEach(function (d) { assert(D.DIR_BY_ID[d] && d !== e.dir, e.id + " 副方向 " + d); });
    if (e.rarity === "SSR") assert(e.story && e.story.zh && e.story.ja, e.id + " 小故事");
  });
  var dirs = {};
  Roster.byRarity("SR").concat(Roster.byRarity("SSR")).forEach(function (e) { dirs[e.dir] = 1; });
  eq(Object.keys(dirs).length, 16, "SR／SSR 涵蓋 16 個方向");
});
```

- [ ] **Step 2：執行，確認失敗**

Run：`node tools/starv_check/core_check.js`
Expected：`名錄：SR 30…` FAIL（SR 數 預期 30，實際 3）。

- [ ] **Step 3：建立 `static_src/starv_roster_2.js`**

```js
// 明星經紀 starV：名錄 v2——SR 27 位（sr004～sr030；規格 §3.3、§4）。ID 永不重用。
// 參數順序：id, 名字「zh|ja」, 性別, 年齡, 主方向, 副方向, 適性（act vocal dance talk charm sense 的 6 字母）,
//           能力 [act, vocal, dance, talk, charm, sense], 特質, 外觀 L(face, hair, hairColor, eye, outfit, acc, skin), 簡介「zh|ja」
(function () {
  "use strict";

  var root = typeof window !== "undefined" ? window : globalThis;
  var T = root.PriTestStarvData.T;

  function A(s) { var k = ["act", "vocal", "dance", "talk", "charm", "sense"], o = {}; s.split("").forEach(function (c, i) { o[k[i]] = c; }); return o; }
  function S(arr) { return { act: arr[0], vocal: arr[1], dance: arr[2], talk: arr[3], charm: arr[4], sense: arr[5] }; }
  function L(face, hair, hairColor, eye, outfit, acc, skin) { return { face: face, hair: hair, hairColor: hairColor, eye: eye, outfit: outfit, acc: acc, skin: skin }; }
  function sr(id, name, gender, age, dir, subDirs, apt, stats, traits, look, bio) {
    return { id: id, rarity: "SR", addedIn: "v2", debut: false, name: T(name), gender: gender, age: age, dir: dir, subDirs: subDirs,
      apt: A(apt), stats: S(stats), traits: traits, skill: null, look: look, bio: T(bio) };
  }

  root.PriTestStarvRoster.add([
    sr("sr004", "沈若微|沈 若微", "f", 22, "film", ["drama"], "ACCBAB", [80, 20, 25, 40, 70, 35], ["method"], L(0, 10, 0, 2, 5, -1, 0),
      "選秀落選十二次，第十三次以一場哭戲讓評審全體起立。|オーディションに十二回落ち、十三回目の泣きの芝居で審査員を総立ちにさせた。"),
    sr("sr005", "顧以辰|顧 以辰", "m", 25, "singer", ["composer"], "CABBBA", [20, 85, 30, 35, 50, 60], ["sweetvoice", "melody"], L(2, 2, 1, 3, 4, 1, 1),
      "在便利商店值夜班時寫下的歌，被路人上傳後一夜爆紅。|コンビニの夜勤中に書いた歌が、通行人の投稿で一夜にしてバズった。"),
    sr("sr006", "Kai|カイ", "m", 20, "dancer", ["idol"], "CCABBB", [20, 25, 85, 30, 55, 40], ["supple", "tough"], L(1, 3, 7, 3, 1, 5, 3),
      "街舞大賽三連霸，舞步快到攝影機都追不上。|ストリートダンス大会三連覇。ステップの速さにカメラが追いつかない。"),
    sr("sr007", "宋知夏|宋 知夏", "f", 23, "drama", ["cm"], "ACCBAC", [75, 25, 20, 40, 70, 30], ["camera"], L(3, 6, 2, 1, 2, 2, 0),
      "十二歲就當上晨間劇女主角，觀眾看著她長大。|十二歳で朝ドラのヒロインに。視聴者は彼女の成長を見守ってきた。"),
    sr("sr008", "江逸|江 逸", "m", 28, "drama", ["film"], "ACCBAB", [70, 20, 25, 45, 65, 40], ["method", "humble"], L(2, 7, 0, 4, 6, -1, 1),
      "律師轉行的演員，演起法庭戲沒有人比他更有說服力。|弁護士から転身した俳優。法廷ドラマで彼ほど説得力のある者はいない。"),
    sr("sr009", "桃瀨鈴|桃瀬 鈴", "f", 17, "idol", ["singer"], "CBACAC", [25, 55, 65, 30, 80, 25], ["showman"], L(3, 11, 5, 5, 0, 0, 0),
      "握手會上記得每位粉絲的名字，被稱為「記憶的天使」。|握手会でファン全員の名前を覚えている「記憶の天使」。"),
    sr("sr010", "南宮晴|南宮 晴", "m", 19, "idol", ["dancer"], "CBABAB", [30, 55, 70, 40, 75, 30], ["supple", "aura"], L(1, 4, 3, 0, 1, 3, 0),
      "原本是遊樂園的布偶裝人員，脫下頭套那天被星探發現。|元は遊園地の着ぐるみスタッフ。頭を脱いだ日にスカウトされた。"),
    sr("sr011", "柳葉凪|柳葉 凪", "f", 22, "cm", ["model"], "BCCBAB", [45, 20, 25, 35, 90, 40], ["camera", "figure"], L(0, 9, 3, 1, 5, 4, 0),
      "一支洗髮精廣告讓她的名字登上搜尋第一名。|シャンプーのCM一本で検索ランキング一位に。"),
    sr("sr012", "程楓|程 楓", "m", 26, "cm", ["drama"], "BCCBAB", [50, 20, 30, 40, 85, 35], ["thrifty"], L(2, 1, 0, 2, 6, -1, 1),
      "笑起來會露出虎牙，汽車、咖啡、手機廣告搶著要。|笑うと八重歯がのぞく。車にコーヒーにスマホ、CM のオファーが絶えない。"),
    sr("sr013", "高木陽|高木 陽", "m", 30, "host", ["comedy"], "CCCABB", [25, 20, 15, 90, 50, 60], ["witty"], L(0, 0, 1, 2, 6, 1, 2),
      "深夜廣播起家，一張嘴能把冷場變成名場面。|深夜ラジオ出身。どんな沈黙も名場面に変える話術の持ち主。"),
    sr("sr014", "唐語薇|唐 語薇", "f", 27, "host", ["anchor"], "CCCABB", [30, 25, 20, 85, 55, 55], ["showman", "easygoing"], L(3, 8, 2, 4, 2, 2, 0),
      "前體育記者，訪問時總能問出對方沒準備好的真心話。|元スポーツ記者。インタビューで相手の準備していない本音を引き出す。"),
    sr("sr015", "秋山理沙|秋山 理沙", "f", 29, "anchor", ["host"], "CCCABB", [25, 20, 15, 90, 45, 65], ["bookworm"], L(0, 7, 0, 0, 6, -1, 0),
      "颱風夜連續播報十八小時，聲音始終沒有一絲動搖。|台風の夜に十八時間報道を続け、声は最後まで揺るがなかった。"),
    sr("sr016", "Nyako|にゃこ", "f", 20, "vtuber", ["singer"], "CBCABB", [30, 55, 20, 80, 35, 60], ["gamer", "nightowl"], L(1, 11, 6, 5, 4, 4, 0),
      "貓耳虛擬主播，玩恐怖遊戲時的慘叫剪輯播放破千萬。|猫耳 VTuber。ホラーゲームの絶叫切り抜きが一千万再生。"),
    sr("sr017", "零式|零式", "m", 23, "vtuber", ["influencer"], "BBCABB", [40, 45, 20, 85, 30, 65], ["gamer"], L(2, 5, 7, 3, 4, 5, 1),
      "從不露臉的毒舌軍師，直播同時在線人數是業界傳說。|顔出しゼロの毒舌軍師。同時接続数は業界の伝説。"),
    sr("sr018", "藤堂響|藤堂 響", "m", 24, "band", ["composer"], "CBCCBA", [20, 60, 30, 25, 50, 90], ["melody"], L(2, 3, 0, 3, 7, 5, 1),
      "吉他是爺爺留下的，琴身上的刮痕都是他的故事。|ギターは祖父の形見。ボディの傷はすべて祖父の物語。"),
    sr("sr019", "Mio|ミオ", "f", 22, "band", ["singer"], "CBBCBA", [20, 55, 45, 25, 50, 85], ["melody", "genius"], L(1, 2, 5, 2, 3, 2, 0),
      "在車庫裡打鼓的少女，鼓棒斷了就用筷子繼續練。|ガレージで叩き続けた少女。スティックが折れたら箸で練習した。"),
    sr("sr020", "小鳥遊雛|小鳥遊 ひな", "f", 21, "voice", ["singer"], "ABCBBB", [80, 60, 20, 55, 35, 30], ["sweetvoice"], L(3, 10, 4, 5, 0, 0, 0),
      "能用同一張嘴演出七歲男孩和七十歲老婆婆。|七歳の男の子と七十歳のおばあさんを同じ声帯で演じ分ける。"),
    sr("sr021", "久遠朔|久遠 朔", "m", 26, "voice", ["stage"], "ABCBBC", [80, 65, 15, 60, 40, 25], ["method"], L(2, 4, 0, 4, 5, -1, 1),
      "一句「我回來了」讓無數動畫迷在片尾淚崩。|「ただいま」の一言で、無数のアニメファンをエンディングで泣かせた。"),
    sr("sr022", "坂本銀河|坂本 銀河", "m", 32, "stage", ["film"], "ABBCBC", [85, 55, 50, 30, 40, 20], ["method", "tough"], L(0, 6, 0, 2, 6, 1, 2),
      "連續公演三百場不曾缺席，被稱為「劇場的鐵柱」。|三百公演連続出演。「劇場の鉄柱」と呼ばれる。"),
    sr("sr023", "鳳真琴|鳳 真琴", "f", 27, "stage", ["dancer"], "ABBCBC", [80, 60, 55, 30, 45, 25], ["supple"], L(3, 9, 0, 1, 6, 2, 0),
      "男役出身，換回裙裝登場時全場倒抽一口氣。|男役出身。スカートで登場した瞬間、劇場中が息をのんだ。"),
    sr("sr024", "Elena|エレナ", "f", 20, "model", ["cm"], "CCBCAB", [20, 15, 50, 20, 95, 45], ["figure"], L(0, 8, 4, 1, 7, 4, 0),
      "身高一百七十八公分，走秀時連設計師都忘了看衣服。|身長百七十八センチ。ランウェイではデザイナーまで服を見るのを忘れる。"),
    sr("sr025", "黑瀨透|黒瀬 透", "m", 22, "model", ["film"], "CCBCAB", [25, 15, 45, 25, 90, 50], ["figure", "camera"], L(2, 7, 0, 3, 7, -1, 0),
      "眼神冷到能讓攝影棚降溫，私下卻是會餵流浪貓的人。|スタジオの温度を下げる冷たい眼差し。素顔は野良猫に餌をやる人。"),
    sr("sr026", "大熊權太|大熊 権太", "m", 29, "comedy", ["host"], "BCCABB", [40, 20, 25, 85, 40, 65], ["witty", "buzz"], L(3, 0, 0, 2, 3, -1, 2),
      "被前搭檔拆夥後單打獨鬥，靠自嘲段子翻紅。|相方に解散された後、ピンで自虐ネタを磨いて再ブレイク。"),
    sr("sr027", "花子|花子", "f", 25, "comedy", ["influencer"], "BCCABB", [45, 25, 20, 80, 45, 60], ["showman"], L(1, 1, 5, 4, 2, 3, 1),
      "表情多到被做成整套貼圖，每一張都很醜但很好笑。|表情が多すぎてスタンプ化。どれも変顔だが、どれも面白い。"),
    sr("sr028", "Momo|モモ", "f", 19, "influencer", ["model"], "CBCAAB", [20, 40, 25, 70, 80, 45], ["buzz"], L(3, 10, 6, 5, 0, 1, 0),
      "分享平價穿搭起家，追蹤者三年內從零到三百萬。|プチプラコーデ投稿から始め、三年でフォロワー三百万人。"),
    sr("sr029", "周遊|周 遊", "m", 24, "influencer", ["host"], "CCBAAB", [25, 20, 40, 75, 75, 55], ["easygoing"], L(1, 3, 2, 0, 4, 2, 3),
      "騎機車環島兩百天的旅遊頻道主，鏡頭永遠對著風景不對著自己。|バイクで二百日旅する旅チャンネル主。カメラはいつも景色を向いている。"),
    sr("sr030", "鷹宮奏一|鷹宮 奏一", "m", 31, "composer", ["band"], "CBCCCA", [20, 65, 15, 30, 35, 95], ["melody", "bookworm"], L(2, 5, 0, 1, 6, 5, 1),
      "替一百首廣告歌作曲卻沒人知道他的名字，直到那部電影的主題曲。|CMソング百曲を書いても名前は知られなかった。あの映画の主題歌までは。")
  ]);
})();
```

- [ ] **Step 4：建立 `static_src/starv_roster_3.js`**

```js
// 明星經紀 starV：名錄 v2——SSR 10 位（ssr003～ssr012；規格 §3.3、§4）。ID 永不重用。
// 每位有專屬技能（fx 只用 core 支援的修正鍵）與 1 段小故事（在頒獎典禮得獎後於圖鑑解鎖）。
(function () {
  "use strict";

  var root = typeof window !== "undefined" ? window : globalThis;
  var T = root.PriTestStarvData.T;

  function A(s) { var k = ["act", "vocal", "dance", "talk", "charm", "sense"], o = {}; s.split("").forEach(function (c, i) { o[k[i]] = c; }); return o; }
  function S(arr) { return { act: arr[0], vocal: arr[1], dance: arr[2], talk: arr[3], charm: arr[4], sense: arr[5] }; }
  function L(face, hair, hairColor, eye, outfit, acc, skin) { return { face: face, hair: hair, hairColor: hairColor, eye: eye, outfit: outfit, acc: acc, skin: skin }; }
  function dirs(list, v) { return { dirs: list, v: v }; }
  function skill(id, name, desc, fx) { return { id: id, name: T(name), desc: T(desc), fx: fx }; }
  function ssr(id, name, gender, age, dir, subDirs, apt, stats, traits, sk, look, bio, story) {
    return { id: id, rarity: "SSR", addedIn: "v2", debut: false, name: T(name), gender: gender, age: age, dir: dir, subDirs: subDirs,
      apt: A(apt), stats: S(stats), traits: traits, skill: sk, look: look, bio: T(bio), story: T(story) };
  }

  root.PriTestStarvRoster.add([
    ssr("ssr003", "月詠千歲|月詠 千歳", "f", 24, "singer", ["band", "voice"], "BSBBAA", [50, 110, 55, 60, 85, 70], ["sweetvoice", "perfectionist"],
      skill("heavenly", "天籟|天上の歌声", "歌手／樂團／聲優表現 +20%，大成功門檻 -0.2|歌手・バンド・声優の表現 +20%、大成功ライン -0.2",
        { perfDirs: dirs(["singer", "band", "voice"], 1.2), greatShift: dirs(["singer", "band", "voice"], 0.2) }),
      L(1, 9, 6, 2, 7, 2, 0),
      "三個八度的音域，被樂評稱為「從天上借來的聲音」。|三オクターブの音域。評論家いわく「天から借りた声」。",
      "千歲小時候因為口吃不敢說話，只有唱歌時字句會順順地流出來。第一座歌唱獎的頒獎典禮上，她握著麥克風，沒有唱歌，而是一字一字地說完了得獎感言。台下的母親哭得比她還厲害。|幼い千歳は吃音で話すのが怖かった。歌うときだけ、言葉がすらすらと流れた。初めての歌唱賞の授賞式、彼女はマイクを握り、歌わずに、一語ずつ受賞スピーチを言い切った。客席の母は彼女よりも泣いていた。"),
    ssr("ssr004", "御堂龍之介|御堂 龍之介", "m", 38, "host", ["comedy", "anchor"], "BBCSAA", [60, 45, 30, 115, 80, 90], ["witty", "tough"],
      skill("emperor", "綜藝之王|バラエティの帝王", "主持人／搞笑／主播表現 +20%，人氣獲得 +10%|司会・お笑い・キャスターの表現 +20%、人気 +10%",
        { perfDirs: dirs(["host", "comedy", "anchor"], 1.2), fame: 1.1 }),
      L(0, 1, 0, 2, 6, 1, 2),
      "主持過的節目收視率加起來，據說比國家人口還多。|司会番組の視聴率を合計すると国の人口を超えるという。",
      "龍之介從不在節目上提起自己。得獎那晚，主持人反過來訪問他：「你最想感謝誰？」他沉默了三秒——對他來說是史上最長的冷場——然後說：「謝謝每一個轉台前多看了我一秒的人。」|龍之介は番組で自分の話をしない。受賞の夜、逆に司会者が尋ねた。「一番感謝したいのは誰ですか」。三秒の沈黙——彼にとって史上最長の間——のあと、彼は言った。「チャンネルを変える前に、一秒だけ長く見てくれた皆さんに」。"),
    ssr("ssr005", "Luna|ルナ", "f", 21, "dancer", ["idol", "stage"], "BCSBAA", [55, 40, 115, 45, 85, 70], ["supple", "quick"],
      skill("moonstep", "月光舞步|ムーンステップ", "舞團／偶像／舞台劇表現 +20%，大成功門檻 -0.15|ダンス・アイドル・舞台の表現 +20%、大成功ライン -0.15",
        { perfDirs: dirs(["dancer", "idol", "stage"], 1.2), greatShift: dirs(["dancer", "idol", "stage"], 0.15) }),
      L(3, 8, 7, 4, 1, 4, 3),
      "在世界大賽上以一支即興獨舞讓全場安靜了十秒。|世界大会の即興ソロで、会場を十秒間静まり返らせた。",
      "Luna 的第一雙舞鞋是撿來的，鞋底磨穿了就墊紙板。得獎後她把獎金全數捐給社區舞蹈教室，條件只有一個：每個孩子都要有一雙合腳的鞋。|ルナの最初のダンスシューズは拾い物で、底が抜けたら段ボールを敷いた。受賞後、彼女は賞金をすべて地域のダンス教室に寄付した。条件はひとつ。どの子にも足に合う靴を。"),
    ssr("ssr006", "星宮諾亞|星宮 ノア", "f", 22, "vtuber", ["singer", "influencer"], "BABSAA", [55, 85, 45, 110, 60, 85], ["gamer", "nightowl"],
      skill("million", "百萬同接|百万同接", "虛擬主播／網紅表現 +20%，人氣獲得 +15%|VTuber・インフルエンサーの表現 +20%、人気 +15%",
        { perfDirs: dirs(["vtuber", "influencer"], 1.2), fame: 1.15 }),
      L(1, 11, 7, 5, 4, 0, 0),
      "出道直播就創下百萬同時在線，據說伺服器燒掉了三台。|デビュー配信で同時接続百万。サーバーが三台燃えたという噂。",
      "諾亞的中之人從沒露過臉。拿下年度大獎那天，她在直播裡說：「螢幕對面的我，其實很普通。」聊天室沒有人刷「露臉」，只有一整排的「我們知道，所以喜歡你」。|ノアの中の人は一度も顔を出していない。年間大賞を取った日、配信で彼女は言った。「画面の向こうの私は、本当は普通の人なんだ」。チャット欄に「顔出し」の文字はなく、「知ってるよ、だから好き」が並び続けた。"),
    ssr("ssr007", "雷伊|レイ", "m", 26, "band", ["singer", "composer"], "BABBAS", [45, 90, 55, 50, 80, 110], ["melody", "genius"],
      skill("anthem", "世代之歌|世代のアンセム", "樂團／歌手／配樂表現 +20%，大成功門檻 -0.15|バンド・歌手・作曲の表現 +20%、大成功ライン -0.15",
        { perfDirs: dirs(["band", "singer", "composer"], 1.2), greatShift: dirs(["band", "singer", "composer"], 0.15) }),
      L(2, 3, 5, 3, 7, 5, 1),
      "十七歲寫的歌成了畢業典禮必唱曲，至今沒有人能翻唱得比他好。|十七歳で書いた曲は卒業式の定番に。今も誰も彼以上には歌えない。",
      "雷伊的樂團曾經解散過一次。得獎時台上只有他一個人，他卻在感言最後念了四個名字，然後說：「這座獎有五個人的重量。」那天深夜，四則久違的訊息同時傳到他手機裡。|レイのバンドは一度解散した。受賞のステージに立ったのは彼一人だったが、スピーチの最後に四つの名前を読み上げ、言った。「このトロフィーには五人分の重さがある」。その深夜、久しぶりのメッセージが四通、同時に届いた。"),
    ssr("ssr008", "朝霧言葉|朝霧 ことは", "f", 25, "voice", ["film", "drama"], "SABABB", [110, 90, 40, 85, 60, 55], ["sweetvoice", "method"],
      skill("hundredvoices", "百色之聲|百色の声", "聲優／電影／電視劇表現 +20%，大成功門檻 -0.2|声優・映画・ドラマの表現 +20%、大成功ライン -0.2",
        { perfDirs: dirs(["voice", "film", "drama"], 1.2), greatShift: dirs(["voice", "film", "drama"], 0.2) }),
      L(3, 10, 2, 1, 2, 2, 0),
      "配過的角色超過三百個，路人只聽聲音就能叫出其中一半。|演じた役は三百以上。声を聞くだけでその半分を言い当てられる。",
      "言葉小時候住院一整年，陪她的是病床旁的一台收音機和裡面的廣播劇。得獎那天她回到那家醫院，在兒科病房念了一整晚的故事，用了二十種不同的聲音。|ことはは幼い頃、一年間入院していた。そばにいたのはラジオと、そこから流れるラジオドラマだった。受賞の日、彼女はあの病院を訪れ、小児病棟で一晩中物語を読んだ。二十通りの声で。"),
    ssr("ssr009", "獅子堂豪|獅子堂 豪", "m", 34, "stage", ["film"], "SABBAB", [115, 80, 70, 50, 75, 40], ["method", "tough"],
      skill("curtaincall", "滿場謝幕|満場のカーテンコール", "舞台劇／電影表現 +20%，體力消耗 -20%|舞台・映画の表現 +20%、体力消費 -20%",
        { perfDirs: dirs(["stage", "film"], 1.2), stamina: 0.8 }),
      L(0, 6, 0, 2, 6, 1, 2),
      "一人分飾十二角的獨角戲，連演十年場場爆滿。|十二役を一人で演じる一人芝居。十年連続で満員御礼。",
      "豪的父親是個演了一輩子配角的舞台劇演員。得獎那晚，豪把獎座留在後台，換上父親當年的舊戲服，在空無一人的舞台上演了一段父親最拿手的、只有三句台詞的戲。|豪の父は一生脇役を演じた舞台俳優だった。受賞の夜、豪はトロフィーを楽屋に置き、父の古い衣装に着替えて、誰もいない舞台で父の十八番——台詞が三つしかない場面——を演じた。"),
    ssr("ssr010", "蘇菲亞|ソフィア", "f", 23, "model", ["cm", "dancer"], "BCABSA", [60, 30, 85, 45, 120, 80], ["figure", "aura"],
      skill("vogue", "封面女王|カバーガール", "模特兒／廣告表現 +20%，人氣獲得 +10%|モデル・CM の表現 +20%、人気 +10%",
        { perfDirs: dirs(["model", "cm"], 1.2), fame: 1.1 }),
      L(0, 8, 3, 1, 7, 4, 1),
      "一年登上四十本雜誌封面，被稱為「書報攤的統治者」。|一年で四十誌の表紙を飾った「書店の支配者」。",
      "蘇菲亞十四歲時被說「太高、太瘦、不像女孩」。得獎後她出版的第一本寫真集裡，每一頁都配著一句當年別人罵她的話，最後一頁寫著：「謝謝你們，讓我知道自己有多特別。」|十四歳のソフィアは「背が高すぎる、痩せすぎ、女の子らしくない」と言われた。受賞後の初写真集、各ページに当時の悪口がひとつずつ添えられ、最後のページにはこうあった。「ありがとう。おかげで自分がどれだけ特別か分かった」。"),
    ssr("ssr011", "笑福亭福來|笑福亭 福来", "m", 41, "comedy", ["host", "influencer"], "ACCSBA", [80, 40, 35, 120, 55, 90], ["witty", "buzz"],
      skill("belly", "捧腹絕倒|抱腹絶倒", "搞笑／主持人／網紅表現 +20%，壓力累積 -20%|お笑い・司会・インフルエンサーの表現 +20%、ストレス -20%",
        { perfDirs: dirs(["comedy", "host", "influencer"], 1.2), stress: 0.8 }),
      L(3, 0, 0, 0, 3, -1, 2),
      "能讓喪禮上的人笑出來，也能讓婚禮上的人哭出來。|葬式で人を笑わせ、結婚式で人を泣かせる。",
      "福來有一個沒公開過的段子，是寫給過世的師父的。得獎那天他第一次在台上表演它，全場笑了七次。最後一句說完，他對著天花板鞠躬，說：「師父，今天七次，比你多一次。」|福来には公開したことのないネタがある。亡き師匠に宛てたものだ。受賞の日、彼は初めてそれを高座にかけ、会場は七回笑った。最後の一言のあと、天井に向かって頭を下げた。「師匠、今日は七回。一回勝ちました」。"),
    ssr("ssr012", "久世奏|久世 奏", "m", 30, "composer", ["band", "singer"], "CABBBS", [35, 95, 40, 55, 60, 125], ["melody", "bookworm"],
      skill("maestro", "旋律之神|旋律の神", "配樂／樂團／歌手表現 +20%，成長 +10%|作曲・バンド・歌手の表現 +20%、成長 +10%",
        { perfDirs: dirs(["composer", "band", "singer"], 1.2), growth: 1.1 }),
      L(2, 5, 0, 3, 6, 5, 1),
      "他寫的電影配樂，讓觀眾在片尾名單播完前沒有人起身。|彼が書いた映画音楽は、エンドロールが終わるまで誰一人席を立たせない。",
      "奏的工作室裡有一台走音的舊鋼琴，所有得獎作品的第一個音都是在它上面彈出來的。調音師說要修，他總是拒絕：「那個走音的 Si，是我所有旋律開始的地方。」|奏のスタジオには調律の狂った古いピアノがある。受賞作の最初の一音は、すべてこのピアノで弾かれた。調律師が直そうとしても、彼は断る。「あの狂ったシの音が、僕のすべての旋律の始まりだから」。")
  ]);
})();
```

- [ ] **Step 5：建立 `static_src/starv_roster_rivals_2.js`**

```js
// 明星經紀 starV：宿敵明星 v2（rv011～rv020；規格 §9、§4）。kind: "rival" → 屬於對手公司，不進抽卡池。
// 對手引退、倒閉、新公司成立時從沒被占用的宿敵明星中補人，名錄越多，換人越不重複。ID 永不重用。
(function () {
  "use strict";

  var root = typeof window !== "undefined" ? window : globalThis;
  var T = root.PriTestStarvData.T;

  function rv(id, rarity, name, gender, age, dir, apt, stats, look, bio, skill) {
    return { id: id, kind: "rival", rarity: rarity, addedIn: "v2", debut: false, name: T(name), gender: gender, age: age, dir: dir,
      subDirs: [], apt: apt, stats: stats, traits: [], skill: skill || null, look: look, bio: T(bio) };
  }
  function A(s) { var k = ["act", "vocal", "dance", "talk", "charm", "sense"], o = {}; s.split("").forEach(function (c, i) { o[k[i]] = c; }); return o; }
  function S(arr) { return { act: arr[0], vocal: arr[1], dance: arr[2], talk: arr[3], charm: arr[4], sense: arr[5] }; }
  function L(face, hair, hairColor, eye, outfit, acc, skin) { return { face: face, hair: hair, hairColor: hairColor, eye: eye, outfit: outfit, acc: acc, skin: skin }; }

  root.PriTestStarvRoster.add([
    rv("rv011", "SR", "柏木沙耶|柏木 沙耶", "f", 26, "drama", A("ACCBAB"), S([150, 40, 45, 70, 130, 75]), L(3, 6, 1, 1, 2, 2, 0),
      "收視率保證的連續劇女王，三年內主演九部黃金檔。|視聴率保証のドラマ女王。三年でゴールデン主演九本。"),
    rv("rv012", "SR", "瀨戶拓真|瀬戸 拓真", "m", 24, "cm", A("BCCBAB"), S([90, 40, 60, 70, 170, 80]), L(1, 2, 3, 2, 5, -1, 0),
      "代言數量業界第一，便利商店裡到處都是他的臉。|CM 契約数は業界一。コンビニのどこを見ても彼の顔。"),
    rv("rv013", "SR", "冴島玲|冴島 玲", "f", 33, "anchor", A("CCCABB"), S([50, 40, 30, 180, 90, 130]), L(0, 7, 0, 0, 6, 1, 0),
      "以犀利提問聞名的主播，政治人物最怕上她的節目。|鋭い質問で知られるキャスター。政治家が最も恐れる番組。"),
    rv("rv014", "SR", "逢坂翼|逢坂 翼", "m", 27, "voice", A("ABCBBC"), S([170, 120, 40, 100, 60, 40]), L(2, 4, 7, 4, 4, 5, 0),
      "主角專業戶，一年配了二十部動畫的男主角。|主役専門。一年で二十本のアニメの主人公を演じた。"),
    rv("rv015", "SR", "Kiki|キキ", "f", 20, "influencer", A("CBCAAB"), S([40, 70, 60, 140, 150, 80]), L(3, 10, 5, 5, 0, 4, 0),
      "一支舞蹈挑戰影片被模仿了五百萬次。|ダンスチャレンジ動画が五百万回真似された。"),
    rv("rv016", "SR", "九條律|九条 律", "m", 35, "composer", A("CBCCCA"), S([30, 120, 30, 60, 70, 190]), L(2, 5, 0, 3, 6, 5, 1),
      "得獎無數的配樂大師，從不出席頒獎典禮。|受賞多数の作曲家。授賞式には一度も出ない。"),
    rv("rv017", "SR", "天城颯|天城 颯", "m", 20, "idol", A("CBACAC"), S([50, 110, 140, 60, 160, 40]), L(1, 4, 2, 3, 1, 3, 0),
      "男子偶像團體的不動 C 位，握手會排隊排到隔壁站。|男性アイドルグループの不動のセンター。握手会の列は隣の駅まで。"),
    rv("rv018", "SR", "Leon|レオン", "m", 28, "singer", A("CABBBA"), S([40, 170, 70, 60, 90, 100]), L(2, 3, 0, 2, 7, 1, 2),
      "海外出道後衣錦還鄉的歌手，用三種語言演唱。|海外デビュー後に凱旋した歌手。三か国語で歌う。"),
    rv("rv019", "SSR", "東雲司|東雲 司", "m", 32, "drama", A("SBBBAA"), S([200, 90, 80, 100, 170, 120]), L(2, 7, 0, 4, 6, -1, 1),
      "國民級男演員，他演的角色名字會變成那年的新生兒命名第一名。|国民的俳優。彼の役名はその年の赤ちゃんの名前ランキング一位になる。",
      { id: "rv_national", name: T("國民演員|国民的俳優"), desc: T("電視劇／電影表現 +20%|ドラマ・映画の表現 +20%"), fx: { perfDirs: { dirs: ["drama", "film"], v: 1.2 } } }),
    rv("rv020", "SSR", "Aria|アリア", "f", 23, "vtuber", A("BABSAA"), S([90, 160, 80, 200, 120, 150]), L(1, 11, 6, 5, 4, 0, 0),
      "全球訂閱數第一的虛擬歌姬，演唱會在元宇宙舉行。|世界登録者数一位のバーチャル歌姫。ライブはメタバースで開催。",
      { id: "rv_diva", name: T("虛擬歌姬|バーチャルディーヴァ"), desc: T("虛擬主播／歌手表現 +20%|VTuber・歌手の表現 +20%"), fx: { perfDirs: { dirs: ["vtuber", "singer"], v: 1.2 } } })
  ]);
})();
```

- [ ] **Step 6：登記三個檔案、更新 roster_1 檔頭**

- `site_src/starv_page.py` 的 `STARV_SCRIPTS`：`"starv_roster_1.js",` 之後加 `"starv_roster_2.js",`、`"starv_roster_3.js",`；`"starv_roster_rivals_1.js",` 之後加 `"starv_roster_rivals_2.js",`
- `tools/starv_check/core_check.js` 與 `tools/starv_check/sim.js`：`require("../../static_src/starv_roster_1.js");` 之後加

```js
require("../../static_src/starv_roster_2.js");
require("../../static_src/starv_roster_3.js");
```

  `require("../../static_src/starv_roster_rivals_1.js");` 之後加 `require("../../static_src/starv_roster_rivals_2.js");`
- `static_src/starv_roster_1.js` 第 1 行改為：`// 明星經紀 starV：首批名錄（v1：SR 3、SSR 2）。擴充在 starv_roster_2.js（SR）、starv_roster_3.js（SSR）。`

- [ ] **Step 7：執行並修正連帶影響**

```bash
for f in static_src/starv_roster*.js; do node --check "$f" || exit 1; done
node tools/starv_check/core_check.js
```

Expected：兩個名錄測試通過。其他測試若因抽選結果改變而失敗，依本計畫開頭「既有測試的連帶影響」處理後，`全部 102 個通過`。

- [ ] **Step 8：commit**

```bash
git add static_src/starv_roster_1.js static_src/starv_roster_2.js static_src/starv_roster_3.js static_src/starv_roster_rivals_2.js site_src/starv_page.py tools/starv_check/core_check.js tools/starv_check/sim.js
git commit -m "feat(starv): 名錄擴充到 SR 30／SSR 12（專屬技能與小故事）、宿敵明星 20 位"
```

---

### Task 2：R 姓名庫與作品名詞庫加倍（舊存檔不變）

**Files:**
- Create: `static_src/starv_words_1.js`
- Modify: `static_src/starv_data.js`（`NAME_V1_LEN`）、`static_src/starv_core.js`（`artistName`、nameSeed 產生）、`site_src/starv_page.py`、`tools/starv_check/core_check.js`、`tools/starv_check/sim.js`
- Test: `tools/starv_check/core_check.js`

**Interfaces:**
- Produces：`D.NAME_V1_LEN = 20`；`D.NAMES.{zh,ja}.{family,f,m}` 各 40 個；每個方向 `title.a`／`title.b` 各 12 個；`Core.NAME_V2_BASE = 1000000`；新產生的 nameSeed（R 藝人、對手的 rgen 參加者）一律 ≥ 1,000,000

- [ ] **Step 1：寫失敗測試**

在 `core_check.js` 的 `test("藝人：名字依語言、名錄找不到時顯示未知", …)` 之後新增：

```js
test("姓名庫與作品名詞庫：擴充後舊存檔的名字與作品名不變", function () {
  eq(D.NAME_V1_LEN, 20);
  ["zh", "ja"].forEach(function (l) { ["family", "f", "m"].forEach(function (k) { assert(D.NAMES[l][k].length >= 40, l + "." + k + " 姓名庫 " + D.NAMES[l][k].length); }); });
  D.DIRS.forEach(function (d) {
    assert(d.title.a.length >= 12 && d.title.b.length >= 12, d.id + " 詞庫");
    ["a", "b"].forEach(function (k) {
      var seen = {};
      d.title[k].forEach(function (w) { assert(w.zh && w.ja, d.id + " 缺字"); assert(!seen[w.zh], d.id + " 重複詞 " + w.zh); seen[w.zh] = 1; });
    });
  });
  ["zh", "ja"].forEach(function (l) {
    ["family", "f", "m"].forEach(function (k) {
      var seen = {};
      D.NAMES[l][k].forEach(function (n) { assert(!seen[n], l + "." + k + " 重複 " + n); seen[n] = 1; });
    });
  });
  // 舊 nameSeed（< 1,000,000）只用前 20 個：舊存檔、日誌、名人堂的名字不變
  var old = { rosterId: null, nameSeed: 12345, gender: "f" };
  eq(Core.artistName(old, "zh"), D.NAMES.zh.family[12345 % 20] + D.NAMES.zh.f[Math.floor(12345 / 20) % 20]);
  // 新藝人的 nameSeed ≥ 1,000,000，用整個姓名庫
  var st = Core.create({ seed: 9 }), a = Core._genR(st);
  assert(a.nameSeed >= Core.NAME_V2_BASE, "新的 nameSeed " + a.nameSeed);
  var s = a.nameSeed - Core.NAME_V2_BASE, N = D.NAMES.ja;
  eq(Core.artistName(a, "ja"), N.family[s % N.family.length] + " " + N[a.gender][Math.floor(s / N.family.length) % N[a.gender].length]);
  // 舊作品名索引仍指向同一個詞
  eq(Core.jobTitle({ dir: "film", title: [0, 0] }, "zh"), "電影《午夜的列車》");
});
```

- [ ] **Step 2：執行，確認失敗**

Run：`node tools/starv_check/core_check.js`
Expected：新測試 FAIL（`D.NAME_V1_LEN` 預期 20，實際 undefined）。

- [ ] **Step 3：`starv_data.js` 加 `NAME_V1_LEN`**

`var NAMES = {` 之前（`// R 藝人的姓名庫：…` 註解那一行之後）加：

```js
  // 第一版姓名庫各 20 個。starv_words_1.js 之後在尾端追加；nameSeed < 1,000,000 的舊藝人只用前 20 個，名字不會變（計畫 9）
  var NAME_V1_LEN = 20;
```

並在最後的匯出物件 `NAMES: NAMES,` 之後加 `NAME_V1_LEN: NAME_V1_LEN,`。

- [ ] **Step 4：建立 `static_src/starv_words_1.js`**

```js
// 明星經紀 starV：詞庫與姓名庫擴充 v1（規格 §20-9）。只在尾端追加：
// - 作品名存的是 [a 索引, b 索引]，追加不會改變舊作品名
// - R 藝人名字由 nameSeed 決定；新 nameSeed ≥ 1,000,000 才用到追加的名字（見 starv_core.js 的 artistName），舊藝人不變
(function () {
  "use strict";

  var root = typeof window !== "undefined" ? window : globalThis;
  var D = root.PriTestStarvData;

  function push(list, words) { words.split(" ").forEach(function (w) { list.push(w); }); }
  // "zh|ja zh|ja …" → [{ zh, ja }]
  function pairs(s) { return s.split(" ").map(function (p) { var x = p.split("|"); return { zh: x[0], ja: x[1] }; }); }
  function words(dir, a, b) {
    var t = D.DIR_BY_ID[dir].title;
    pairs(a).forEach(function (w) { t.a.push(w); });
    pairs(b).forEach(function (w) { t.b.push(w); });
  }

  push(D.NAMES.zh.family, "羅 高 潘 宋 唐 馮 韓 沈 彭 呂 蘇 盧 蔣 蕭 程 簡 方 江 范 石");
  push(D.NAMES.zh.f, "佳穎 語涵 子涵 芯瑜 宛蓉 筱婷 映彤 沛晴 舒雅 靜怡 亦菲 若晴 曼琪 芊芊 詠晴 昕妤 可馨 雅筑 紫萱 韻如");
  push(D.NAMES.zh.m, "冠宇 俊宏 政宏 柏翰 哲瑋 承翰 煜城 少廷 宇恆 子騫 書豪 毅倫 維哲 凱文 建廷 廷睿 博宇 宥廷 瑞陽 昱辰");
  push(D.NAMES.ja.family, "斎藤 山崎 阿部 池田 橋本 石川 前田 藤田 小川 岡田 後藤 長谷川 村上 近藤 石井 坂本 遠藤 青木 藤井 西村");
  push(D.NAMES.ja.f, "美羽 杏 紬 澪 結菜 日向 花音 詩 栞 咲良 優奈 茜 未来 愛莉 玲奈 環 雫 瑠璃 若菜 碧");
  push(D.NAMES.ja.m, "朝陽 新 暖 陸 碧斗 理人 悠斗 結翔 瑛太 大翔 樹生 一輝 光 航 誠 駿 直人 翼 遼 柊");

  words("film", "暴風雨的|嵐の 紅色的|赤い 不存在的|存在しない 永遠的|永遠の 黃昏的|黄昏の 地下的|地下の",
    "審判|審判 逃亡者|逃亡者 遺書|遺書 海岸線|海岸線 秘密基地|秘密基地 輓歌|挽歌");
  words("drama", "下班後的|定時後の 隔壁的|隣の 偽裝的|偽りの 三十歲的|三十歳の 深夜食堂的|深夜食堂の 再見了|さよなら",
    "律師|弁護士 家族|家族 婚約|婚約 同居人|同居人 刑警|刑事 最終章|最終章");
  words("singer", "玻璃色的|硝子色の 月光下的|月明かりの 微甜的|甘い 雨後的|雨上がりの 第一次的|はじめての 無重力|無重力",
    "情書|ラブレター 星座|星座 花火|花火 未來|未来 約定|約束 回聲|エコー");
  words("idol", "夢幻|ドリーム 青空|青空 心動|ときめき 流星|流星 糖果|キャンディ 純白|ピュア",
    "進行曲|マーチ 週年祭|周年祭 練習生|研究生 物語|ストーリー 革命|レボリューション 約定|プロミス");
  words("cm", "夏日|サマー 午夜|ミッドナイト 薄荷|ミント 黃金|ゴールド 珍珠|パール 檸檬|レモン",
    "口紅|リップ 運動飲料|スポーツドリンク 洗衣精|洗剤 泡麵|カップ麺 香水|香水 機票|航空券");
  words("host", "午夜|真夜中の 超級|スーパー 奇蹟的|奇跡の 紅白|紅白 秘密|ひみつの 王牌|エース",
    "問答|クイズ 料理王|料理王 旅行團|旅団 歌唱大賽|のど自慢 運動會|運動会 偵探社|探偵団");
  words("dancer", "銀色|シルバー 黑天鵝|黒鳥 狂熱|フィーバー 無限|インフィニティ 霓虹|ネオン 原始|プリミティブ",
    "圓舞曲|ワルツ 探戈|タンゴ 嘉年華|カーニバル 宣言|マニフェスト 衝擊|インパクト 迴旋|スピン");
  words("anchor", "正午|お昼の 國際|国際 深度|ディープ 選舉|選挙 天氣|お天気 獨家|独占",
    "特報|特報 日報|デイリー 夜線|ナイトライン 頭條|ヘッドライン 專訪|インタビュー 追蹤|追跡");
  words("vtuber", "初見|初見 恐怖|ホラー 晨間|朝活 紀念|記念 參加型|参加型 生日|誕生日",
    "實況|実況 歌謠祭|歌謡祭 鬼抓人|鬼ごっこ 晚酌|晩酌 料理|料理 3D首播|3Dお披露目");
  words("band", "午夜|ミッドナイト 燃燒的|燃える 最後的|ラストの 無名的|名もなき 迷途的|迷子の 復古|レトロ",
    "搖滾|ロック 進行式|進行形 安可|アンコール 巡迴|ツアー 幻象|ビジョン 宣言|宣言");
  words("voice", "鋼鐵|鋼鉄の 終焉的|終焉の 偶像|アイドル 戀愛|恋する 超能力|超能力 怪盜|怪盗",
    "英雄|英雄 契約|契約 方舟|箱舟 革命|革命 王女|王女 守護者|ガーディアン");
  words("stage", "春之|春の 羅密歐與|ロミオと 沙漠的|砂漠の 歌劇院的|オペラ座の 第十二夜的|十二夜の 夢中的|夢の",
    "狂詩曲|狂詩曲 悲劇|悲劇 喜劇|喜劇 女王|女王 戀文|恋文 鎮魂歌|レクイエム");
  words("model", "米蘭|ミラノ 紐約|ニューヨーク 東京|トウキョウ 薔薇|ローズ 午夜藍|ミッドナイトブルー 極簡|ミニマル",
    "新作|新作 聯名款|コラボライン 晚宴|ガラ 精選|セレクト 宣傳照|ビジュアル 寫真集|写真集");
  words("comedy", "深夜|深夜 地獄|地獄の 全力|全力 兩人|ふたりの 新春|新春 無厘頭|ナンセンス",
    "短劇|コント 大喜利|大喜利 單口|ピン芸 寄席|寄席 合宿|合宿 祭|祭り");
  words("influencer", "深夜|深夜の 極限|極限 百元|百円 名店|名店 早起|早起き 隱藏版|裏",
    "測評|レビュー 直播|ライブ 開箱|開封 美食|グルメ 旅記|旅行記 挑戰|チャレンジ");
  words("composer", "黎明的|黎明の 弦樂|弦楽 遙遠的|遥かなる 孤獨的|孤独の 星之|星の 森之|森の",
    "前奏曲|前奏曲 狂想曲|狂想曲 安魂曲|レクイエム 練習曲|エチュード 圓舞曲|ワルツ 搖籃曲|子守唄");
})();
```

- [ ] **Step 5：核心的 nameSeed v2**

`static_src/starv_core.js`：

1. `var VERSION = 5;` 的下一行加：

```js
  // R 姓名庫擴充（計畫 9）：新的 nameSeed 從這裡起跳；小於它的舊 seed 只用第一版姓名庫（D.NAME_V1_LEN），名字不變
  var NAME_V2_BASE = 1000000;
  function newNameSeed(st) { return NAME_V2_BASE + rint(st, 0, 999999); }
```

   （`rint` 是函式宣告，提升後可用。）

2. `artistName` 的最後四行（`var N = D.NAMES[lang], …` 到 `return …`）改為：

```js
    var N = D.NAMES[lang], givenList = N[a.gender] || N.f;
    var v2 = a.nameSeed >= NAME_V2_BASE, seed = v2 ? a.nameSeed - NAME_V2_BASE : a.nameSeed;
    var nFam = v2 ? N.family.length : Math.min(D.NAME_V1_LEN, N.family.length);
    var nGiv = v2 ? givenList.length : Math.min(D.NAME_V1_LEN, givenList.length);
    var fam = N.family[seed % nFam];
    var giv = givenList[Math.floor(seed / nFam) % nGiv];
    return lang === "ja" ? fam + " " + giv : fam + giv;
```

3. 把三處 `rint(st, 0, 999999)` 產生 nameSeed 的地方改成 `newNameSeed(st)`：
   - `baseArtist` 的 `a.nameSeed = rint(st, 0, 999999);`
   - 排行榜 rgen 參加者 `entries.push({ kind: "rgen", rival: r.id, nameSeed: rint(st, 0, 999999), …`
   - 頒獎 rgen 參加者 `out.push({ kind: "rgen", rival: r.id, nameSeed: rint(st, 0, 999999), …`

   （亂數呼叫次數不變。）

4. 匯出區 `api.VERSION = VERSION;` 之後加 `api.NAME_V2_BASE = NAME_V2_BASE;`

- [ ] **Step 6：登記並執行**

- `site_src/starv_page.py`：`"starv_data.js",` 之後加 `"starv_words_1.js",`
- `core_check.js`、`sim.js`：`require("../../static_src/starv_data.js");` 之後加 `require("../../static_src/starv_words_1.js");`

```bash
node --check static_src/starv_words_1.js && node --check static_src/starv_core.js
node tools/starv_check/core_check.js
```

Expected：`全部 103 個通過`（作品名或名字寫死的舊測試依開頭說明修正）。

- [ ] **Step 7：commit**

```bash
git add static_src/starv_words_1.js static_src/starv_data.js static_src/starv_core.js site_src/starv_page.py tools/starv_check/core_check.js tools/starv_check/sim.js
git commit -m "feat(starv): R 姓名庫與作品名詞庫加倍（新 nameSeed 區分版本，舊存檔名字不變）"
```

---

### Task 3：宿敵劇情 10 段

**Files:**
- Create: `static_src/starv_events_5.js`
- Modify: `static_src/starv_core.js`、`static_src/starv_data.js`（BAL）、`site_src/starv_page.py`、`tools/starv_check/core_check.js`、`tools/starv_check/sim.js`
- Test: `tools/starv_check/core_check.js`

**Interfaces:**
- Consumes：`pushEvent(st, id, aid, ctx)`（ctx 帶 `rival`、`star` 時不再另外抽對手）、事件 UI 的 `{rival}`／`{star}` 佔位
- Produces：`st.rivalStory = { stage: 0..10, feud: { [rosterId]: n } }`；`D.BAL.rivalStoryEvery = 3`、`D.BAL.rivalStoryStages = 10`；事件 `rival_story_1`～`rival_story_10`（trigger `"cond"`）；`Core.VERSION === 6`

- [ ] **Step 1：寫失敗測試**

在 `core_check.js` 的 `test("試鏡：A/S 是試鏡制、隔天公布、贏了開工輸了被搶", …)` 之後新增：

```js
test("宿敵劇情：同一位宿敵競爭 3 次推出下一段，10 段依序、前一段未處理不推、最後一段後停止", function () {
  eq(D.BAL.rivalStoryStages, 10); eq(D.BAL.rivalStoryEvery, 3);
  for (var n = 1; n <= 10; n++) {
    var ev = D.EVENT_BY_ID["rival_story_" + n];
    assert(ev, "第 " + n + " 段"); eq(ev.trigger, "cond");
    assert(ev.choices[ev.defaultChoice], "第 " + n + " 段的預設選項");
  }
  var st = Core.create({ seed: 1 });
  st.company.level = 6; st.board = []; st.boardRefreshDay = 99999;
  var r = st.rivals[0];
  r.stars = [{ rosterId: "rv001", stats: { act: 999, vocal: 999, dance: 999, talk: 999, charm: 999, sense: 999 }, fame: 5000, age: 23 }];
  st.rivals = [r];
  var a = freshArtist(st, { fame: 99999 }); a.prof.singer.lv = 10;
  function contest() {
    var j = soloJob(st, { tier: "A", audition: true, minFame: 1500, minProf: 5, days: 1 });
    eq(Core.takeJob(st, j.id, [a.id]), null);
    Core.advance(st, 1);
    a.task = null;
  }
  function pending(id) { return st.events.pending.filter(function (e) { return e.id === id; })[0]; }
  contest(); contest();
  eq(st.rivalStory.stage, 0, "2 次還不觸發");
  contest();
  eq(st.rivalStory.stage, 1, "第 3 次觸發第 1 段");
  var e = pending("rival_story_1");
  assert(e, "推出第 1 段"); eq(e.ctx.star, "rv001"); eq(e.ctx.rival, r.id); eq(e.aid, a.id);
  contest(); contest(); contest();
  eq(st.rivalStory.stage, 1, "前一段還沒處理就不推下一段");
  Core.resolveEvent(st, e.uid, D.EVENT_BY_ID.rival_story_1.defaultChoice);
  contest(); contest(); contest();
  eq(st.rivalStory.stage, 2); assert(pending("rival_story_2"), "推出第 2 段");
  st.events.pending = [];
  st.rivalStory.stage = 9;
  contest(); contest(); contest();
  eq(st.rivalStory.stage, 10); assert(pending("rival_story_10"), "推出第 10 段");
  st.events.pending = [];
  contest(); contest(); contest();
  eq(st.rivalStory.stage, 10, "最後一段之後不再推出");
  var old = Core.create({ seed: 2 }); delete old.rivalStory; old.version = 5;
  var m = Core.migrate(JSON.parse(JSON.stringify(old)));
  eq(m.version, 6); eq(m.rivalStory.stage, 0, "舊存檔補上宿敵劇情");
});
```

- [ ] **Step 2：執行，確認失敗**

Run：`node tools/starv_check/core_check.js`
Expected：新測試 FAIL（`rivalStoryStages` 預期 10，實際 undefined）。

- [ ] **Step 3：BAL 常數**

`static_src/starv_data.js` 的 BAL 中 `rivalCount: 5,` 那一行的下一行加：

```js
    rivalStoryEvery: 3, rivalStoryStages: 10,   // 宿敵劇情：同一位宿敵每競爭 3 次推出下一段，共 10 段（計畫 9）
```

- [ ] **Step 4：核心**

`static_src/starv_core.js`：

1. `var VERSION = 5;` 改為 `var VERSION = 6;`
2. `blankState` 回傳物件中 `project: null, projectQueue: [],` 之後加 `rivalStory: { stage: 0, feud: {} }, title: null,`（`title` 給 Task 4 用，一起加）
3. `migrate` 中 `st.version = VERSION;` 之前加註解：

```js
    // version 5 → 6：宿敵劇情 rivalStory、稱號 title（計畫 9），由上面的 fillDefaults 補上
```

4. `bestRivalFor` 整個換成（同時回傳分數來自哪一位宿敵明星；亂數用量不變）：

```js
  function bestRivalFor(st, job) {
    var best = null;
    st.rivals.forEach(function (r) {
      var score = rivalScore(st, r, difficulty(job)), star = null;
      r.stars.forEach(function (s) {
        var e = Roster.byId(s.rosterId);
        if (!e || e.dir !== job.dir) return;
        var v = rivalStarPerf(r, s, job.dir);
        if (v > score) { score = v; star = s.rosterId; }
      });
      if (!best || score > best.score) best = { rival: r, score: score, star: star };
    });
    return best;
  }

  // 宿敵劇情（規格 §9：與同一位宿敵反覆競爭觸發劇情；共 10 段，依序推出）
  // 每位宿敵明星分開計數；滿 rivalStoryEvery 次推出下一段。前一段還在待處理時先不推（計數保留）。
  function rivalFeud(st, r, rosterId, aid) {
    var rs = st.rivalStory;
    rs.feud[rosterId] = (rs.feud[rosterId] || 0) + 1;
    if (rs.stage >= BAL.rivalStoryStages || rs.feud[rosterId] < BAL.rivalStoryEvery) return;
    var next = "rival_story_" + (rs.stage + 1);
    if (!D.EVENT_BY_ID || !D.EVENT_BY_ID[next]) return;
    if (st.events.pending.some(function (e) { return /^rival_story_/.test(e.id); })) return;
    rs.feud[rosterId] = 0;
    rs.stage++;
    pushEvent(st, next, aid, { rival: r.id, star: rosterId });
  }
```

5. `tickAuditions` 中，`if (!rv || ours >= rv.score) { … } else { … }` 整個 if／else 之後（仍在 `due.forEach` 的回呼內）加：

```js
      if (rv && rv.star) rivalFeud(st, rv.rival, rv.star, members[0].id);
```

- [ ] **Step 5：建立 `static_src/starv_events_5.js`**

```js
// 明星經紀 starV：重大事件 v5——宿敵劇情 10 段（規格 §7、§9）。條件觸發：同一位宿敵明星與我方競爭試鏡滿 3 次時，
// 由核心 rivalFeud() 依序推出下一段（ctx.rival＝對手公司、ctx.star＝宿敵明星、目標＝這次報名的我方藝人）。
// 文字佔位 {name}＝我方藝人、{rival}＝對手公司名、{star}＝宿敵明星名。
(function () {
  "use strict";

  var root = typeof window !== "undefined" ? window : globalThis;
  var T = root.PriTestStarvData.T;

  function O(w, fx, bad) { return { w: w, fx: fx || {}, bad: !!bad }; }
  function C(label, hint, outcomes) { return { label: T(label), hint: T(hint), outcomes: outcomes }; }
  function E(n, title, text, choices, defaultChoice) {
    return { id: "rival_story_" + n, addedIn: "v5", category: "special", target: "any", trigger: "cond", weight: 10,
      title: T(title), text: T(text), choices: choices, defaultChoice: defaultChoice };
  }

  root.PriTestStarvEvents.add([
    E(1, "宿敵篇①　初次交鋒|宿敵編①　初めての火花",
      "試鏡會場上，{name} 又和{rival}的{star}撞在一起。{star}擦身而過時低聲說：「又是你。」|オーディション会場で、{name} はまたしても{rival}の{star}と鉢合わせた。すれ違いざまに{star}が呟く。「また君か」。", [
      C("回嗆「下次換我贏」|「次は勝つ」と言い返す", "壓力↑ 心情↑|ストレス↑ 気分↑", [O(1, { stress: 5, mood: 1 })]),
      C("默默點頭|黙って会釈する", "沒有變化|変化なし", [O(1, {})])
    ], 1),
    E(2, "宿敵篇②　宿命對決特輯|宿敵編②　因縁の対決特集",
      "週刊雜誌把 {name} 和{star}做成「宿命對決」特輯，銷量大賣。|週刊誌が {name} と{star}の「宿命の対決」特集を組み、売れに売れた。", [
      C("配合受訪|取材に応じる", "人氣↑ 壓力↑|人気↑ ストレス↑", [O(1, { fame: 80, stress: 8 })]),
      C("拒絕受訪|取材を断る", "人氣小幅↓|人気やや↓", [O(1, { famePct: -0.03 })])
    ], 0),
    E(3, "宿敵篇③　深夜的練習室|宿敵編③　深夜のレッスン室",
      "深夜，{name} 發現隔壁練習室的燈還亮著——裡面是{star}，一個人練到腳步踉蹌。|深夜、{name} は隣のレッスン室に明かりがついているのに気づく。中には{star}。ふらつくまで一人で練習していた。", [
      C("偷偷看完再走|こっそり最後まで見る", "能力↑|能力↑", [O(1, { statAll: 3 })]),
      C("遞上一瓶水|水を差し入れる", "心情↑|気分↑", [O(1, { mood: 2 })]),
      C("轉身離開|黙って立ち去る", "沒有變化|変化なし", [O(1, {})])
    ], 2),
    E(4, "宿敵篇④　公開挑釁|宿敵編④　公開の挑発",
      "{star}在{rival}的記者會上說：「{name}？我沒把對方放在眼裡。」|{star}が{rival}の会見で言い放った。「{name}？眼中にないね」。", [
      C("用作品回應|作品で応える", "看板出現指名工作 壓力↑|指名の仕事がボードに ストレス↑", [O(1, { specialJob: true, stress: 10 })]),
      C("在社群上反擊|SNS で反撃", "看運氣|運次第", [O(5, { fame: 120 }), O(5, { famePct: -0.08, stress: 10 }, true)]),
      C("一笑置之|笑って流す", "心情↓|気分↓", [O(1, { mood: -1 })])
    ], 2),
    E(5, "宿敵篇⑤　意外的同台|宿敵編⑤　まさかの共演",
      "製作人提議讓 {name} 和{star}同台演出，兩家公司都在觀望。|プロデューサーが {name} と{star}の共演を提案。両事務所が様子をうかがっている。", [
      C("答應|引き受ける", "人氣↑ 資金↑ 對手也變強|人気↑ 資金↑ 相手も強くなる", [O(1, { fame: 150, money: 30000, rivalPower: 5 })]),
      C("婉拒|断る", "沒有變化|変化なし", [O(1, {})])
    ], 1),
    E(6, "宿敵篇⑥　宿敵的低潮|宿敵編⑥　ライバルの不調",
      "{star}因為傷病缺席了一整季。記者追問 {name} 的看法。|{star}が怪我で一シーズン休養。記者が {name} に感想を求める。", [
      C("「我等對方回來」|「戻ってくるのを待ってる」", "人氣↑ 心情↑|人気↑ 気分↑", [O(1, { fame: 100, mood: 1 })]),
      C("「這是我的機會」|「これはチャンスだ」", "對手變弱 壓力↑|相手が弱る ストレス↑", [O(1, { rivalPower: -8, stress: 5 })]),
      C("不予置評|ノーコメント", "沒有變化|変化なし", [O(1, {})])
    ], 2),
    E(7, "宿敵篇⑦　對決宣言|宿敵編⑦　対決宣言",
      "復出的{star}在頒獎典禮後台攔住 {name}：「下一次，我們在同一個舞台上分高下。」|復帰した{star}が授賞式の舞台裏で {name} を呼び止めた。「次は同じ舞台で決着をつけよう」。", [
      C("接受挑戰|受けて立つ", "看板出現指名工作 能力↑ 壓力↑|指名の仕事がボードに 能力↑ ストレス↑", [O(1, { specialJob: true, statAll: 3, stress: 8 })]),
      C("婉拒|断る", "心情↓|気分↓", [O(1, { mood: -1 })])
    ], 1),
    E(8, "宿敵篇⑧　決戰前夜|宿敵編⑧　決戦前夜",
      "對決前一晚，{name} 睡不著。手機裡跳出一則陌生訊息：「明天別手下留情。——{star}」|対決前夜、{name} は眠れない。知らない番号からメッセージが届く。「明日、手加減はなしだ。——{star}」", [
      C("回覆「彼此彼此」|「お互いにね」と返す", "心情↑ 壓力↓|気分↑ ストレス↓", [O(1, { mood: 2, stress: -10 })]),
      C("不讀不回，專心休息|既読もつけずに休む", "體力↑|体力↑", [O(1, { stamina: 20 })])
    ], 1),
    E(9, "宿敵篇⑨　世紀對決|宿敵編⑨　世紀の対決",
      "全國直播的特別節目上，{name} 與{star}正面對決，收視率創下年度新高。|全国生放送の特番で {name} と{star}が真っ向勝負。視聴率は年間最高を記録した。", [
      C("全力以赴|全力で挑む", "看運氣|運次第", [O(6, { fame: 300, rep: 30, stress: 15 }), O(4, { fame: 120, stress: 20, mood: -1 }, true)]),
      C("享受舞台|舞台を楽しむ", "人氣↑ 心情↑|人気↑ 気分↑", [O(1, { fame: 150, mood: 2 })])
    ], 1),
    E(10, "宿敵篇⑩　宿敵，亦是摯友|宿敵編⑩　宿敵にして親友",
      "對決落幕後，{star}走到 {name} 面前伸出手：「謝謝你，讓我一直沒辦法停下腳步。」|対決のあと、{star}が {name} の前に来て手を差し出した。「ありがとう。君のおかげで、立ち止まれなかった」。", [
      C("緊緊握手|固く握手する", "人氣↑ 能力↑ 心情↑ 星探券|人気↑ 能力↑ 気分↑ スカウト券", [O(1, { fame: 200, statAll: 5, mood: 2, tickets: 5 })]),
      C("相約下一次再戰|次の勝負を約束する", "能力大幅↑ 星探券 壓力↑|能力大幅↑ スカウト券 ストレス↑", [O(1, { statAll: 10, tickets: 5, stress: 5 })])
    ], 0)
  ]);
})();
```

- [ ] **Step 6：登記並執行**

- `site_src/starv_page.py`：`"starv_events_4.js",` 之後加 `"starv_events_5.js",`
- `core_check.js`、`sim.js`：`require("../../static_src/starv_events_4.js");` 之後加 `require("../../static_src/starv_events_5.js");`

```bash
node --check static_src/starv_events_5.js && node --check static_src/starv_core.js
node tools/starv_check/core_check.js
```

Expected：`全部 104 個通過`（若既有的事件數量測試寫死了總數，改成從登記器算並註解）。

- [ ] **Step 7：commit**

```bash
git add static_src/starv_events_5.js static_src/starv_core.js static_src/starv_data.js site_src/starv_page.py tools/starv_check/core_check.js tools/starv_check/sim.js
git commit -m "feat(starv): 宿敵劇情 10 段（同一位宿敵競爭 3 次推出下一段）、存檔版本 6"
```

---

### Task 4：成就 60 項與稱號

**Files:**
- Create: `static_src/starv_achievements_3.js`
- Modify: `static_src/starv_core.js`、`static_src/starv_view_hall.js`、`site_src/i18n_starv.py`、`static_src/css/starv.css`、`site_src/starv_page.py`、`tools/starv_check/core_check.js`、`tools/starv_check/sim.js`、`tools/starv_check/ui_check.js`
- Test: `tools/starv_check/core_check.js`、`tools/starv_check/ui_check.js`

**Interfaces:**
- Consumes：Task 3 的 `st.rivalStory`、`blankState` 的 `title: null`
- Produces：`D.ACHIEVEMENTS.length === 60`；`Core.ACH_TYPES`（判定類型名稱陣列）；新類型 `sr`、`stories`、`rivalStory`、`topFame`、`groups`、`facMax`、`staff`；`Core.setTitle(st, id|null) → null | "locked"`；`st.title`（新紀元保留）；DOM `[data-act="title-<成就 id>"]`、`.sv-chip-title`

- [ ] **Step 1：寫失敗測試**

`core_check.js` 的 `// ==== 雲端存檔（計畫 8） ====` 之前加：

```js
test("成就：60 項、判定類型都存在、新類型可以達成", function () {
  eq(D.ACHIEVEMENTS.length, 60, "成就數");
  D.ACHIEVEMENTS.forEach(function (x) {
    assert(Core.ACH_TYPES.indexOf(x.cond.type) >= 0, x.id + " 類型不存在 " + x.cond.type);
    assert(x.name.zh && x.name.ja && x.desc.zh && x.desc.ja, x.id + " 文字");
    assert(x.reward.tickets > 0, x.id + " 獎勵");
  });
  var st = Core.create({ seed: 3 });
  st.board = []; st.boardRefreshDay = 99999;
  st.codex.stories = { ssr001: true }; st.rivalStory.stage = 5;
  freshArtist(st, { fame: 12000 });
  D.FACILITY_ORDER.forEach(function (f) { st.facilities[f] = D.FACILITIES[f].max; });
  Core.advance(st, 1);
  ["story_1", "rival_story_1", "rival_story_5", "fame_10k", "fac_max_1", "fac_max_all"].forEach(function (id) { assert(st.achievements[id], id + " 應該達成"); });
  assert(!st.achievements.rival_story_10 && !st.achievements.fame_50k && !st.achievements.story_6, "還沒到門檻的不會達成");
});

test("稱號：只能用已達成的成就、可以取消、新紀元保留", function () {
  var st = Core.create({ seed: 3 });
  eq(Core.setTitle(st, "first_pull"), "locked");
  st.achievements.first_pull = { day: 0, era: 1 };
  eq(Core.setTitle(st, "first_pull"), null); eq(st.title, "first_pull");
  st.company.level = 10;
  assert(!Core.newEra(st), "開新紀元");
  eq(st.era, 2); eq(st.title, "first_pull", "新紀元保留稱號");
  eq(Core.setTitle(st, null), null); eq(st.title, null);
});
```

`tools/starv_check/ui_check.js` 的 `// ==== 之後的 task 在這行之前追加步驟 ====` 之前加：

```js
step("成就：設為稱號 → 頂部列顯示 → 取消", async function (page) {
  await tab(page, "hall");
  await act(page, "hall-sub-ach");
  var id = await page.evaluate(function () { return Object.keys(window.PriTestStarv.state().achievements)[0]; });
  assert.ok(id, "已有達成的成就");
  await act(page, "title-" + id);
  await page.waitForSelector(".sv-chip-title");
  assert.strictEqual((await st(page)).title, id);
  await noRawKeys(page, "稱號");
  await act(page, "title-" + id);
  await page.waitForSelector(".sv-chip-title", { state: "detached" });
});
```

- [ ] **Step 2：執行，確認失敗**

Run：`node tools/starv_check/core_check.js`
Expected：兩個新測試 FAIL（成就數 預期 60，實際 22；`Core.setTitle` 不存在）。

- [ ] **Step 3：建立 `static_src/starv_achievements_3.js`**

```js
// 明星經紀 starV：成就 v3（38 項，合計 60；規格 §14）。cond.type 見 starv_core.js 的 ACH_CHECKS。
// 達成的成就可以在殿堂設為稱號，顯示在頂部列。
(function () {
  "use strict";

  var root = typeof window !== "undefined" ? window : globalThis;
  var T = root.PriTestStarvData.T;

  function A(id, name, desc, type, n, tickets) {
    return { id: id, addedIn: "v3", name: T(name), desc: T(desc), cond: { type: type, n: n }, reward: { tickets: tickets } };
  }

  root.PriTestStarvAchievements.add([
    A("pulls_500", "星探狂熱|スカウト中毒", "累計招募 500 次|累計 500 回スカウト", "pulls", 500, 8),
    A("pulls_1000", "千人選秀|千人オーディション", "累計招募 1,000 次|累計 1,000 回スカウト", "pulls", 1000, 10),
    A("ssr_3", "星星的聚會|星の集い", "收集 3 位 SSR|SSR を 3 人収集", "ssr", 3, 8),
    A("ssr_10", "群星閃耀|綺羅星のごとく", "收集 10 位 SSR|SSR を 10 人収集", "ssr", 10, 15),
    A("sr_10", "新星名冊|新星名鑑", "收集 10 位 SR|SR を 10 人収集", "sr", 10, 5),
    A("sr_25", "實力派軍團|実力派軍団", "收集 25 位 SR|SR を 25 人収集", "sr", 25, 10),
    A("codex_full", "完全名鑑|完全名鑑", "SR／SSR 圖鑑全部收集|SR／SSR 図鑑をコンプリート", "codexRate", 1, 20),
    A("level_5", "嶄露頭角|頭角を現す", "公司升到 Lv5|事務所 Lv5 到達", "level", 5, 5),
    A("level_8", "業界龍頭|業界の雄", "公司升到 Lv8|事務所 Lv8 到達", "level", 8, 8),
    A("artists_50", "明星宿舍|スター寮", "旗下藝人達到 50 人|所属タレント 50 人", "artists", 50, 6),
    A("money_100k", "第一桶金|最初の資金", "資金達到 10 萬|資金 10 万到達", "money", 100000, 2),
    A("money_10m", "娛樂帝國|エンタメ帝国", "資金達到 1,000 萬|資金 1,000 万到達", "money", 10000000, 10),
    A("jobs_300", "行程滿檔|スケジュール満載", "累計完成 300 件工作|累計 300 件の仕事", "jobs", 300, 5),
    A("jobs_3000", "工作狂公司|仕事の鬼", "累計完成 3,000 件工作|累計 3,000 件の仕事", "jobs", 3000, 10),
    A("great_s_10", "王牌製造機|エース製造機", "S 級工作大成功 10 次|S ランクの仕事で大成功 10 回", "greatS", 10, 8),
    A("great_s_50", "傳說的舞台|伝説のステージ", "S 級工作大成功 50 次|S ランクの仕事で大成功 50 回", "greatS", 50, 12),
    A("chart_top_50", "排行榜霸主|チャートの覇者", "累計拿下排行榜第 1 名 50 次|ランキング 1 位を累計 50 回", "chartTops", 50, 12),
    A("trophies_10", "獎座收藏家|トロフィーコレクター", "累計得獎 10 座|累計 10 冠", "trophies", 10, 6),
    A("trophies_100", "百冠王|百冠王", "累計得獎 100 座|累計 100 冠", "trophies", 100, 15),
    A("hof_5", "傳說的系譜|伝説の系譜", "5 位藝人進入名人堂|殿堂入り 5 人", "hof", 5, 8),
    A("hof_20", "不朽的殿堂|不朽の殿堂", "20 位藝人進入名人堂|殿堂入り 20 人", "hof", 20, 15),
    A("group_10", "默契搭檔|息の合うコンビ", "一個組合合作 10 次|一つのユニットで共演 10 回", "groupJobs", 10, 2),
    A("group_300", "永遠的組合|永遠のユニット", "一個組合合作 300 次|一つのユニットで共演 300 回", "groupJobs", 300, 10),
    A("projects_5", "企劃之王|企画王", "完成 5 件大型企劃|大型企画を 5 件完遂", "projects", 5, 8),
    A("projects_20", "超級製作人|スーパープロデューサー", "完成 20 件大型企劃|大型企画を 20 件完遂", "projects", 20, 15),
    A("great_project_5", "奇蹟的製作|奇跡のプロダクション", "大型企劃大成功 5 次|大型企画で大成功 5 回", "projectsGreat", 5, 15),
    A("era_3", "輪迴的星光|巡る星の光", "開創第 3 紀元|第 3 紀元を開く", "era", 3, 12),
    A("era_5", "永恆的經紀|永遠のマネジメント", "開創第 5 紀元|第 5 紀元を開く", "era", 5, 20),
    A("story_1", "背後的故事|知られざる物語", "解鎖 1 段 SSR 小故事|SSR ストーリーを 1 つ解放", "stories", 1, 5),
    A("story_6", "故事收藏家|物語の蒐集家", "解鎖 6 段 SSR 小故事|SSR ストーリーを 6 つ解放", "stories", 6, 10),
    A("rival_story_1", "宿敵登場|ライバル登場", "宿敵劇情進入第 1 段|宿敵編 第 1 話", "rivalStory", 1, 3),
    A("rival_story_5", "命中注定的對手|運命のライバル", "宿敵劇情進入第 5 段|宿敵編 第 5 話", "rivalStory", 5, 6),
    A("rival_story_10", "宿敵亦摯友|宿敵にして親友", "宿敵劇情走到最終段|宿敵編 最終話", "rivalStory", 10, 15),
    A("fame_10k", "國民明星|国民的スター", "旗下藝人人氣達到 10,000|所属タレントの人気が 10,000 に", "topFame", 10000, 5),
    A("fame_50k", "超級巨星|スーパースター", "旗下藝人人氣達到 50,000|所属タレントの人気が 50,000 に", "topFame", 50000, 10),
    A("fac_max_1", "頂級設施|最高の設備", "任一設施升到最高等級|いずれかの設備を最大レベルに", "facMax", 1, 5),
    A("fac_max_all", "夢想中的經紀公司|夢の事務所", "所有設施升到最高等級|すべての設備を最大レベルに", "facMax", 7, 15),
    A("staff_1", "傳承的導師|受け継ぐ師", "第一次聘請名人堂導師|初めて殿堂入りの師を招く", "staff", 1, 3)
  ]);
})();
```

- [ ] **Step 4：核心的新判定類型與稱號**

`static_src/starv_core.js`：

1. `ACH_CHECKS` 物件中 `era: function (st) { return st.era; }` 改為（前面加逗號並追加）：

```js
    era: function (st) { return st.era; },
    sr: function (st) { return codexStats(st).sr; },
    stories: function (st) { return Object.keys(st.codex.stories).length; },
    rivalStory: function (st) { return st.rivalStory.stage; },
    topFame: function (st) { return st.artists.reduce(function (m, a) { return Math.max(m, a.fame); }, 0); },
    groups: function (st) { return st.groups.length; },
    facMax: function (st) { return D.FACILITY_ORDER.filter(function (f) { return st.facilities[f] >= D.FACILITIES[f].max; }).length; },
    staff: function (st) { return st.staff.length; }
```

2. `checkAchievements` 函式之後加：

```js
  // 稱號（規格 §14）：已達成的成就可以設為稱號，null 取消
  function setTitle(st, id) {
    if (id === null) { st.title = null; return null; }
    if (!st.achievements[id]) return "locked";
    st.title = id;
    return null;
  }
```

3. `newEra`：`var keep = { … }` 物件的 `name: st.company.name` 之後加 `, title: st.title`；`["hall", "codex", "achievements", "timeline", "legacy", "era", "nextId", "logSeq"]` 陣列尾端加 `"title"`。
4. 匯出區 `api.newEra = newEra;` 之後加：

```js
  api.setTitle = setTitle;
  api.ACH_TYPES = Object.keys(ACH_CHECKS);
```

- [ ] **Step 5：稱號 UI**

`static_src/starv_view_hall.js` 的 `achView` 中，`el("span", { class: "sv-small", text: t("sv_ach_reward", …) })` 那一行改為（後面接稱號按鈕）：

```js
          el("span", { class: "sv-small", text: t("sv_ach_reward", { n: x.reward.tickets || 0 }) }),
          got ? UI.btn(st.title === x.id ? t("sv_ach_title_on") : t("sv_ach_set_title"), function () {
            App.act(function (s) { Core.setTitle(s, s.title === x.id ? null : x.id); });
          }, st.title === x.id ? "sv-btn-gold" : "sv-btn-ghost", { "data-act": "title-" + x.id }) : null
```

`achView(st)` 的簽名改為 `achView(st, App)`（render 裡的呼叫 `body(st, App)` 已經傳了 App）。檔案最後的 `UI.register({…});` 之後加頂部列的稱號：

```js
  // 頂部列：目前的稱號
  UI.addTopItem(function (App) {
    var s = App.st(), x = s.title && D.ACHIEVEMENT_BY_ID && D.ACHIEVEMENT_BY_ID[s.title];
    return x ? el("span", { class: "sv-chip sv-chip-title", title: t("sv_title_tip"), text: t("sv_title_chip", { title: UI.L(x.name) }) }) : null;
  });
```

（`Core`、`D` 已在檔頭取得時直接用；若檔頭沒有 `var Core = window.PriTestStarvCore;`／`var D = window.PriTestStarvData;`，在 `var UI = …` 旁補上。）

`site_src/i18n_starv.py` 的 `# ==== 之後的 task 在這行之前追加字串 ====` 之前加：

```python
    # ---- 稱號（計畫 9） ----
    ("sv_ach_set_title", "設為稱號", "称号にする"),
    ("sv_ach_title_on", "使用中（取消）", "使用中（外す）"),
    ("sv_title_chip", "「{title}」", "「{title}」"),
    ("sv_title_tip", "稱號（在殿堂的成就頁變更）", "称号（殿堂の実績ページで変更）"),
```

`static_src/css/starv.css` 最後追加：

```css
/* ---- 稱號（計畫 9） ---- */
.sv-chip-title { color: var(--sv-gold); border-color: var(--sv-gold); }
```

- [ ] **Step 6：登記並執行**

- `site_src/starv_page.py`：`"starv_achievements_2.js",` 之後加 `"starv_achievements_3.js",`
- `core_check.js`、`sim.js`：`require("../../static_src/starv_achievements_2.js");` 之後加 `require("../../static_src/starv_achievements_3.js");`

```bash
for f in static_src/starv*.js; do node --check "$f" || exit 1; done
node tools/starv_check/core_check.js
```

Expected：`全部 106 個通過`。

- [ ] **Step 7：commit**

```bash
git add static_src/starv_achievements_3.js static_src/starv_core.js static_src/starv_view_hall.js site_src/i18n_starv.py static_src/css/starv.css site_src/starv_page.py tools/starv_check/core_check.js tools/starv_check/sim.js tools/starv_check/ui_check.js
git commit -m "feat(starv): 成就擴充到 60 項、稱號（殿堂設定、頂部列顯示、新紀元保留）"
```

---

### Task 5：全部檢查

**Files:** 無新增（只有檢查中發現的修正）

- [ ] **Step 1：建置並執行全部檢查**

```bash
py -3 generate.py && py -3 tools/split_css.py --check
for f in static_src/starv*.js; do node --check "$f" || exit 1; done
node tools/starv_check/core_check.js
node tools/starv_check/sim.js 30
node tools/starv_check/ui_check.js
```

（`ui_check` 需要 `py -3 -m http.server 8946 --directory dist`。）

Expected：`core_check` 106 個通過；`sim` 不變量全部通過（抽卡 SR／SSR 機率不受名錄人數影響）；`ui_check` 26 個步驟通過（「三種語言…沒有漏翻」涵蓋稱號）。

- [ ] **Step 2：抽查內容顯示**

在 ui_check 的截圖（`tools/starv_check/shots/`）確認圖鑑分頁 `tab-hall.png` 正常、沒有版面溢出。發現問題就修正並重跑 Step 1。

- [ ] **Step 3：若 Step 1～2 有修正就 commit**

```bash
git add -A static_src site_src tools/starv_check/*.js
git commit -m "fix(starv): 計畫 9 全部檢查的修正"
```
