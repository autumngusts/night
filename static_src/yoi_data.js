// 宵の怪談（yoi）：靜態資料（職業、禁忌、標籤、怪異、舞台、搜索卡、事件）。規則見 docs/yoi_game_design.md。
// 文字為 { zh, ja }（en 未製作，UI 會 fallback 到 zh）。這裡只放資料，規則邏輯在 yoi_core.js。
(function () {
  "use strict";

  var root = typeof window !== "undefined" ? window : globalThis;
  function T(zh, ja) { return { zh: zh, ja: ja }; }

  // ---- §2 探索者 ----
  var JOBS = [
    { id: "medium", hp: 4, nerve: 6, color: 0x9b7bd8, name: T("靈媒", "霊媒師"),
      skill: T("搜索得到線索時，看得出它是不是誤導", "探索で得た手がかりが誤導かどうか見抜ける") },
    { id: "reporter", hp: 5, nerve: 5, color: 0x4fa3d1, name: T("記者", "記者"),
      skill: T("專長「取材」：搜索時抽 2 張留 1 張（算拍照）", "特技「取材」：探索で 2 枚引いて 1 枚残す（撮影扱い）") },
    { id: "miko", hp: 4, nerve: 5, color: 0xe0566b, name: T("神社見習", "巫女見習い"),
      skill: T("每晚 1 次「祓い」：取消剛翻開的怪異事件", "一晩 1 回「祓い」：めくった怪異イベントを打ち消す") },
    { id: "taoist", hp: 5, nerve: 5, color: 0xe0a83a, name: T("道士", "道士"),
      skill: T("每晚 1 次「擲筊」：問 1 條禁忌是不是今晚的禁忌（必定正確）", "一晩 1 回「擲筊」：ある禁忌が今夜のものか問う（必ず正しい）") },
    { id: "student", hp: 5, nerve: 4, color: 0x6cc070, name: T("學生", "学生"),
      skill: T("移動 1 次可以走 2 格（算奔跑）", "1 回の移動で 2 マス進める（走る扱い）") },
    { id: "guard", hp: 7, nerve: 4, color: 0x8a96a8, name: T("保全", "警備員"),
      skill: T("同房間的隊友受到體力傷害時減 1", "同じ部屋の仲間が受ける体力ダメージ −1") }
  ];

  // ---- §5 禁忌池 ----
  var TABOOS = [
    { id: "look_back", name: T("不可回頭", "振り返るな") },
    { id: "answer_name", name: T("不可應答呼名", "名を呼ばれても応えるな") },
    { id: "mirror", name: T("不可照鏡", "鏡を覗くな") },
    { id: "dark", name: T("不可熄燈", "灯りを消すな") },
    { id: "alone", name: T("不可獨處", "独りになるな") },
    { id: "offering", name: T("不可吃供品", "供え物を食べるな") },
    { id: "ushi_voice", name: T("丑時不可出聲", "丑三つ時に声を出すな") },
    { id: "water", name: T("不可碰水", "水に触れるな") },
    { id: "run", name: T("不可奔跑", "走るな") },
    { id: "sleep", name: T("不可睡覺", "眠るな") },
    { id: "photo", name: T("不可拍照", "写真を撮るな") }
  ];

  // ---- 特徵標籤（線索用）：clue＝找到這個標籤線索時的描述 ----
  var TAGS = [
    { id: "woman", name: T("女", "女"), clue: T("走廊盡頭有女人的身影一閃而過", "廊下の奥を女の影がよぎった") },
    { id: "mirror", name: T("鏡", "鏡"), clue: T("所有鏡子都被布蓋住了", "鏡という鏡に布が掛けてある") },
    { id: "light", name: T("光", "光"), clue: T("燈泡被一顆一顆擰鬆了", "電球がひとつずつ緩められている") },
    { id: "hair", name: T("長髮", "長い髪"), clue: T("排水口纏著一大把黑色長髮", "排水口に長い黒髪が絡まっている") },
    { id: "voice", name: T("聲", "声"), clue: T("錄音機裡錄到不屬於任何人的低語", "録音機に誰のものでもない囁きが入っている") },
    { id: "name", name: T("名字", "名前"), clue: T("牆上用指甲刻滿了人名", "壁一面に爪で名前が刻まれている") },
    { id: "night", name: T("夜", "夜"), clue: T("每一座時鐘都停在 2 點", "時計がすべて 2 時で止まっている") },
    { id: "door", name: T("門", "戸"), clue: T("門板內側滿是抓痕", "戸の内側に引っかき傷が無数にある") },
    { id: "water", name: T("水", "水"), clue: T("乾燥的房間地板卻是濕的", "乾いた部屋なのに床が濡れている") },
    { id: "footprint", name: T("足跡", "足跡"), clue: T("一串赤腳的腳印走進牆壁", "裸足の足跡が壁の中へ続いている") },
    { id: "cold", name: T("冷", "冷気"), clue: T("吐出的氣是白的，明明是夏天", "夏なのに吐く息が白い") },
    { id: "bath", name: T("浴", "湯"), clue: T("浴缸放滿了水，水面還在晃", "湯船に水が張られ、まだ揺れている") },
    { id: "child", name: T("孩童", "子供"), clue: T("地上散落著小孩的鞋子", "子供の靴が片方だけ転がっている") },
    { id: "game", name: T("遊戲", "遊び"), clue: T("粉筆畫的跳格子一路延伸進黑暗", "チョークのけんけんぱが闇の奥へ続く") },
    { id: "laugh", name: T("笑聲", "笑い声"), clue: T("天花板上傳來咯咯的笑聲", "天井裏からくすくす笑う声がする") },
    { id: "hide", name: T("躲藏", "隠れる"), clue: T("衣櫃裡有人躲過的凹痕", "押し入れに誰かが隠れていた跡がある") },
    { id: "mountain", name: T("山", "山"), clue: T("鞋底沾滿了這裡不該有的山泥", "ここにあるはずのない山の泥がついている") },
    { id: "lost", name: T("迷路", "迷い"), clue: T("同一條走廊走了三次都回到原點", "同じ廊下を三度歩いても元の場所に戻る") },
    { id: "food", name: T("食物", "食べ物"), clue: T("盤子上的食物被啃過，齒痕很小", "皿の料理に小さな歯形がついている") },
    { id: "red", name: T("紅", "赤"), clue: T("一片紅色的衣角夾在門縫裡", "戸の隙間に赤い布の端が挟まっている") },
    { id: "photo", name: T("照片", "写真"), clue: T("舊照片裡每個人背後都多了一個人", "古い写真の全員の後ろにもう一人いる") },
    { id: "pull", name: T("拉扯", "引く"), clue: T("腳踝留下了被手抓過的瘀青", "足首に掴まれたような痣がある") },
    { id: "bed", name: T("床", "寝床"), clue: T("棉被裡還是溫的，卻沒有人睡過", "布団が温かいのに誰も寝ていない") },
    { id: "dream", name: T("夢", "夢"), clue: T("日記寫著：『又夢到那個人站在床邊』", "日記に「またあの人が枕元に立つ夢」") }
  ];

  // ---- §4 怪異（固定 4 標籤、固定 3 禁忌）----
  var KAII = [
    { id: "kagami_onna", sys: "wa", name: T("鏡ノ女", "鏡ノ女"), tags: ["woman", "mirror", "light", "hair"], taboos: ["mirror", "dark", "look_back"],
      lore: T("住在鏡子裡的女人。燈一熄、或有人回頭看她，就會把人拉進鏡子另一側。", "鏡の中に棲む女。灯りが消えたとき、振り向いた者を鏡の向こうへ引き込む。") },
    { id: "yobigoe", sys: "wa", name: T("喚び声", "喚び声"), tags: ["voice", "name", "night", "door"], taboos: ["answer_name", "ushi_voice", "alone"],
      lore: T("在門外呼喚名字的聲音。只要應了一聲，獨處的人就會被帶走。", "戸の外から名を呼ぶ声。ひとたび応えれば、独りの者から連れていかれる。") },
    { id: "nureashi", sys: "wa", name: T("濡れ足", "濡れ足"), tags: ["water", "footprint", "cold", "bath"], taboos: ["water", "run", "look_back"],
      lore: T("赤腳濕漉漉地跟在身後的東西。奔跑的人、碰了水的人，會被牠的腳步聲追上。", "濡れた裸足でついてくるもの。走る者、水に触れた者に追いつく。") },
    { id: "yoidouji", sys: "wa", name: T("宵童子", "宵童子"), tags: ["child", "game", "laugh", "hide"], taboos: ["alone", "run", "offering"],
      lore: T("想找人玩捉迷藏的孩子。落單的人、逃跑的人、吃了牠點心的人，都算加入了遊戲。", "かくれんぼの相手を探す子供。独りの者、逃げる者、菓子を食べた者は遊びに加わったことになる。") },
    { id: "moshina", sys: "tw", name: T("魔神仔", "モシナ"), tags: ["mountain", "lost", "child", "food"], taboos: ["offering", "answer_name", "alone"],
      lore: T("山裡帶人迷路的精怪。拿草蜢和泥土當作食物給人吃，應聲跟上的人就再也走不出山。", "山で人を迷わせる精怪。泥や虫を馳走と偽って食べさせ、呼び声に応えた者を山奥へ連れ去る。") },
    { id: "hongyi", sys: "tw", name: T("紅衣客", "紅衣の客"), tags: ["red", "woman", "photo", "mountain"], taboos: ["photo", "look_back", "dark"],
      lore: T("只在照片裡現身的紅衣身影。被拍下、被回頭看見的人，下一張照片就會站在她身邊。", "写真にだけ写る赤い衣の影。撮られた者、振り返った者は、次の写真で彼女の隣に立つ。") },
    { id: "shuiliu", sys: "tw", name: T("水流公", "水流公"), tags: ["water", "cold", "pull", "night"], taboos: ["water", "sleep", "ushi_voice"],
      lore: T("把人拉進水裡的水邊之靈。睡著的人、深夜出聲的人，會在夢裡被牽到水邊。", "人を水に引き込む水辺の霊。眠った者、夜更けに声を出した者を夢の中で水辺へ導く。") },
    { id: "chuangbian", sys: "tw", name: T("床邊人", "枕元の人"), tags: ["bed", "dream", "name", "cold"], taboos: ["sleep", "mirror", "photo"],
      lore: T("站在床邊俯視睡著的人。在鏡子或照片裡和牠對上眼的人，今晚就會換牠睡在你的床上。", "枕元に立ち、眠る者を見下ろす。鏡や写真で目が合えば、今夜はそれがあなたの床で眠る。") }
  ];

  // ---- §3 舞台：房間（floor, x, y 為格子座標；同樓層正交相鄰自動連通，stairs 另外連通）----
  // feat：mirror＝有鏡子（搜索會觸犯「不可照鏡」）、water＝有水（搜索會觸犯「不可碰水」）
  var STAGES = [
    { id: "yoiya", sys: "wa", name: T("宵屋旅館", "宵屋旅館"), desc: T("山腳下歇業多年的老旅館。帳場的時鐘還在走。", "山裾で長く休業していた古い旅館。帳場の時計だけがまだ動いている。"),
      wall: 0x6b4a32, floorColor: 0x8a6a48,
      rooms: [
        { id: "genkan", f: 0, x: 0, y: 0, name: T("玄關", "玄関"), start: true },
        { id: "chouba", f: 0, x: 1, y: 0, name: T("帳場", "帳場") },
        { id: "kitchen", f: 0, x: 2, y: 0, name: T("廚房", "厨房"), water: true },
        { id: "storage", f: 0, x: 0, y: 1, name: T("倉庫", "納戸") },
        { id: "kamidana", f: 0, x: 1, y: 1, name: T("神棚間", "神棚の間"), kekkai: true },
        { id: "bath", f: 0, x: 2, y: 1, name: T("浴場", "浴場"), water: true, mirror: true },
        { id: "guest1", f: 1, x: 0, y: 0, name: T("客室・松", "客室・松") },
        { id: "guest2", f: 1, x: 1, y: 0, name: T("客室・竹", "客室・竹") },
        { id: "guest3", f: 1, x: 2, y: 0, name: T("客室・梅", "客室・梅"), mirror: true },
        { id: "guest4", f: 1, x: 1, y: 1, name: T("客室・桜", "客室・桜") }
      ],
      stairs: [["chouba", "guest2"]] },
    { id: "yongle", sys: "tw", name: T("永樂公寓", "永楽アパート"), desc: T("巷子底的四十年老公寓，整棟只剩一戶還亮著神明燈。", "路地裏の築四十年のアパート。神明灯が灯るのは一戸だけ。"),
      wall: 0x8a8578, floorColor: 0x9c9384,
      rooms: [
        { id: "stair", f: 0, x: 0, y: 0, name: T("樓梯間", "階段室"), start: true },
        { id: "living", f: 0, x: 1, y: 0, name: T("客廳", "居間") },
        { id: "shenming", f: 0, x: 2, y: 0, name: T("神明廳", "神明庁"), kekkai: true },
        { id: "kitchen", f: 0, x: 1, y: 1, name: T("廚房", "台所"), water: true },
        { id: "bath", f: 0, x: 2, y: 1, name: T("浴室", "浴室"), water: true, mirror: true },
        { id: "bed1", f: 1, x: 0, y: 0, name: T("主臥", "主寝室"), mirror: true },
        { id: "bed2", f: 1, x: 1, y: 0, name: T("小孩房", "子供部屋") },
        { id: "roof", f: 1, x: 2, y: 0, name: T("頂樓加蓋", "屋上の増築"), water: true },
        { id: "store", f: 1, x: 1, y: 1, name: T("儲藏室", "物置") }
      ],
      stairs: [["stair", "bed1"]] },
    { id: "bunkou", sys: "mix", name: T("山中分校", "山中分校"), desc: T("廢校的山中分校，後山有一座小小的祠。", "廃校になった山の分校。裏山に小さな祠がある。"),
      wall: 0x7a6f5a, floorColor: 0x7d7461,
      rooms: [
        { id: "gate", f: 0, x: 0, y: 0, name: T("校門口", "校門") , start: true },
        { id: "class1", f: 0, x: 1, y: 0, name: T("一年教室", "一年教室") },
        { id: "infirm", f: 0, x: 2, y: 0, name: T("保健室", "保健室"), mirror: true },
        { id: "hokora", f: 0, x: 0, y: 1, name: T("後山的祠", "裏山の祠"), kekkai: true },
        { id: "toilet", f: 0, x: 2, y: 1, name: T("廁所", "便所"), water: true, mirror: true },
        { id: "class2", f: 1, x: 0, y: 0, name: T("二年教室", "二年教室") },
        { id: "class3", f: 1, x: 1, y: 0, name: T("三年教室", "三年教室") },
        { id: "music", f: 1, x: 2, y: 0, name: T("音樂教室", "音楽室") },
        { id: "rooftop", f: 1, x: 1, y: 1, name: T("屋頂水塔", "屋上の貯水槽"), water: true }
      ],
      stairs: [["class1", "class3"]] }
  ];

  // ---- 道具 ----
  var ITEMS = [
    { id: "charm", name: T("符", "御札"), desc: T("施術給隊友膽量 +2，或擋下 1 次怪異事件", "仲間の胆力 +2 の術に使う／怪異イベントを 1 回防ぐ") },
    { id: "salt", name: T("鹽", "盛り塩"), desc: T("自動抵消 1 次膽量損失", "胆力の減少を 1 回自動で打ち消す") },
    { id: "battery", name: T("電池", "電池"), desc: T("停電時換上，不必摸黑", "停電時に交換して暗闇を避ける") }
  ];

  // 搜索卡組成（§9 A8／A9）：真標籤線索 7、禁忌線索 1、誤導 3、道具 5、供品 1，其餘空白
  var DECK = { trueTag: 7, tabooClue: 1, fake: 3, items: ["charm", "charm", "salt", "salt", "battery"], offering: 1 };

  // 禁忌線索的描述（找到時直接指出一條禁忌）
  var TABOO_CLUE = T("一張舊紙條寫著：「{taboo}。」", "古い紙切れにこう書いてある：「{taboo}」");

  // ---- 怪異事件 ----
  // safe：避開禁忌的選項代價（stat：hp/nerve，乘上事件等級 1/2/3）；risk：可能觸犯禁忌的選項（taboo）
  // risk 的 gain：沒觸犯時得到的好處（clue＝得到 1 條真標籤線索；hp/nerve＝回復事件等級的量）
  // ushiOnly：這個選項只在 02:00 時段才算觸犯（丑時不可出聲）
  // room：無選項、對一整個有人的房間生效（hit：stat）
  var EVENTS = [
    { id: "behind", text: T("{who} 的背後傳來腳步聲，就停在身後。", "{who} の背後で足音がして、すぐ後ろで止まった。"),
      risk: { taboo: "look_back", label: T("回頭看", "振り返る") }, safe: { stat: "nerve", label: T("不回頭，快步離開", "振り返らず足早に離れる") } },
    { id: "callname", text: T("黑暗中有人清楚地叫了 {who} 的名字。", "暗がりから誰かが {who} の名をはっきり呼んだ。"),
      risk: { taboo: "answer_name", label: T("「誰？」回應", "「誰？」と応える") }, safe: { stat: "nerve", label: T("摀住耳朵", "耳を塞ぐ") } },
    { id: "blackout", text: T("{who} 手上的燈突然熄滅，四周一片漆黑。", "{who} の灯りが突然消え、あたりが闇に沈んだ。"),
      risk: { taboo: "dark", label: T("摸黑前進", "手探りで進む") }, safe: { stat: "nerve", label: T("蹲在原地等眼睛適應", "その場でうずくまる") }, battery: true },
    { id: "chase", text: T("有什麼東西朝 {who} 衝了過來！", "何かが {who} めがけて迫ってくる！"),
      risk: { taboo: "run", label: T("拔腿就跑", "全力で逃げる") }, safe: { stat: "hp", label: T("躲進角落硬撐", "隅に身を潜めて耐える") } },
    { id: "figure", text: T("{who} 的視線角落站著一個人影。", "{who} の視界の隅に人影が立っている。"),
      risk: { taboo: "photo", label: T("拍下來", "写真に撮る"), gain: "clue" }, safe: { stat: "nerve", label: T("移開視線", "目を逸らす") } },
    { id: "reflection", text: T("{who} 經過的窗玻璃上映出不是自己的臉。", "{who} が通りかかった窓ガラスに、自分ではない顔が映った。"),
      risk: { taboo: "mirror", label: T("仔細看清楚", "よく覗き込む"), gain: "clue" }, safe: { stat: "nerve", label: T("閉上眼睛", "目を閉じる") } },
    { id: "feast", text: T("{who} 面前的桌上擺著冒著熱氣的飯菜。", "{who} の前の卓に湯気の立つ膳が並んでいる。"),
      risk: { taboo: "offering", label: T("吃一口補充體力", "一口食べて精をつける"), gain: "hp" }, safe: { stat: "none", label: T("不吃", "食べない") } },
    { id: "drowsy", text: T("一股濃濃的睡意壓上 {who} 的眼皮。", "強い眠気が {who} のまぶたにのしかかる。"),
      risk: { taboo: "sleep", label: T("小睡一下", "少しだけ眠る"), gain: "nerve" }, safe: { stat: "hp", label: T("掐自己撐住", "自分をつねって耐える") } },
    { id: "faucet", text: T("{who} 聽見水龍頭沒關，水一直流。", "{who} の耳に、出しっぱなしの水音が届く。"),
      risk: { taboo: "water", label: T("去把水關掉", "水を止めに行く") }, safe: { stat: "nerve", label: T("不去理它", "放っておく") } },
    { id: "silence", text: T("四周靜得可怕，{who} 忍不住想說話。", "あまりの静けさに、{who} は声を出したくなった。"),
      risk: { taboo: "ushi_voice", ushiOnly: true, label: T("低聲唸經壯膽", "小声で経を唱える"), gain: "nerve" }, safe: { stat: "nerve", label: T("屏住呼吸", "息を殺す") } },
    { id: "chill", room: true, hit: "nerve", text: T("{room} 的溫度驟降，牆上結了一層霜。", "{room} の気温が急に下がり、壁に霜が降りた。") },
    { id: "crash", room: true, hit: "hp", text: T("{room} 的櫃子猛然倒下！", "{room} の棚が突然倒れてきた！") }
  ];

  // §6 / §9 A4：事件等級門檻（怪異度）
  var TIERS = [{ min: 0, tier: 1 }, { min: 4, tier: 2 }, { min: 7, tier: 3 }];
  var HOURS = [22, 23, 0, 1, 2, 3, 4];
  var USHI_HOUR_INDEX = 4;

  function index(list) { var m = {}; list.forEach(function (x) { m[x.id] = x; }); return m; }

  root.PriTestYoiData = {
    JOBS: JOBS, JOB_BY_ID: index(JOBS),
    TABOOS: TABOOS, TABOO_BY_ID: index(TABOOS),
    TAGS: TAGS, TAG_BY_ID: index(TAGS),
    KAII: KAII, KAII_BY_ID: index(KAII),
    STAGES: STAGES, STAGE_BY_ID: index(STAGES),
    ITEMS: ITEMS, ITEM_BY_ID: index(ITEMS),
    EVENTS: EVENTS, EVENT_BY_ID: index(EVENTS),
    DECK: DECK, TABOO_CLUE: TABOO_CLUE,
    TIERS: TIERS, HOURS: HOURS, USHI_HOUR_INDEX: USHI_HOUR_INDEX
  };
})();
