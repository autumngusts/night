// 萬人迷（wanren）：遊戲性擴充資料（2026-11-02 使用者「全部都做」的 13 項建議）。
// 依地點的約會瞬間與心情、聊天的隱藏對話、迷妹個性與麻煩事件、第 16 位隱藏女主角（二周目）、
// 社團與社團大會、專長、交往階段事件、校園隨機遭遇、成就。載入順序：wanren_data.js → 本檔 → wanren_core.js。
(function () {
  "use strict";

  var D = window.PriTestWanrenData;
  if (!D) return;

  // ---------------- 專長（第 6 項） ----------------
  // topic：哪個話題會因為這項專長加分
  var SKILLS = [
    { id: "cook", icon: "🍳", name: { zh: "廚藝", ja: "料理" }, topic: "food" },
    { id: "sport", icon: "⚽", name: { zh: "運動", ja: "運動" }, topic: "sports" },
    { id: "art", icon: "🎨", name: { zh: "藝術", ja: "芸術" }, topic: "art" },
    { id: "music", icon: "🎵", name: { zh: "音樂", ja: "音楽" }, topic: "music" },
    { id: "talk", icon: "🗨", name: { zh: "口才", ja: "話術" }, topic: null }
  ];
  var SKILL_BY_ID = {};
  SKILLS.forEach(function (k) { SKILL_BY_ID[k.id] = k; });
  // 任務的屬性條件可以用專長代替（≥ 原門檻的 80%）
  var STAT_ALT_SKILL = { charm: "talk", stamina: "sport", rep: "talk" };
  // 晚上練專長
  var SKILL_EVENINGS = [
    { id: "cookpractice", icon: "🍳", name: { zh: "練習做菜", ja: "料理の練習" }, skill: "cook", eff: { money: -500, stamina: -3 }, note: "廚藝 +3、¥500" },
    { id: "jog", icon: "🏃", name: { zh: "夜跑", ja: "夜ラン" }, skill: "sport", eff: { stamina: -8 }, note: "運動 +3" },
    { id: "draw", icon: "🎨", name: { zh: "畫畫", ja: "絵を描く" }, skill: "art", eff: { stamina: -3 }, note: "藝術 +3" },
    { id: "instrument", icon: "🎸", name: { zh: "練樂器", ja: "楽器の練習" }, skill: "music", eff: { stamina: -3 }, note: "音樂 +3" },
    { id: "speech", icon: "🎙", name: { zh: "練習說話", ja: "話し方の練習" }, skill: "talk", eff: { stamina: -3 }, note: "口才 +3" }
  ];

  // ---------------- 社團（第 5 項） ----------------
  // members：同社團的女主角（聊天好感 ×1.3、社團活動時一起加好感）；skills：社團活動提升的專長
  var CLUBS = [
    { id: "sports", icon: "🥋", name: { zh: "運動社團（劍道・田徑）", ja: "運動系（剣道・陸上）" }, loc: "gym", skills: { sport: 2 }, members: ["akane", "konatsu", "kaoru"] },
    { id: "lit", icon: "📝", name: { zh: "文藝美術社", ja: "文芸美術部" }, loc: "club", skills: { art: 1.5, talk: 0.5 }, members: ["shiori", "aoi"] },
    { id: "music", icon: "🎤", name: { zh: "音樂社", ja: "音楽部" }, loc: "club", skills: { music: 2 }, members: ["kotone", "rion"] },
    { id: "esports", icon: "🎮", name: { zh: "電競社", ja: "eスポーツ部" }, loc: "club", skills: { art: 0.5, talk: 1.5 }, members: ["mashiro"] },
    { id: "council", icon: "📋", name: { zh: "學生會", ja: "生徒会" }, loc: "classroom", skills: { talk: 2 }, members: ["reika", "yukina", "rinko"] },
    { id: "cooking", icon: "🍰", name: { zh: "料理研究社", ja: "料理研究会" }, loc: "cafeteria", skills: { cook: 2 }, members: ["miki", "yoko"] }
  ];
  var CLUB_BY_ID = {};
  CLUBS.forEach(function (c) { CLUB_BY_ID[c.id] = c; });
  var CLUB_DAYS = [2, 5];   // 社團活動日：星期三、六

  // ---------------- 約會：依地點的瞬間（第 1 項） ----------------
  // 每次約會 2 題（交往中 3 題）：先出該地點的 2 題，交往中再加 1 題通用題
  var SPOT_MOMENTS = {
    library: [
      { text: "她指著一本書：「這本你讀過嗎？我很喜歡最後一段。」", opts: { romantic: "「那我想聽你念給我聽。」", funny: "「讀過，但我只記得封面。」", earnest: "「還沒，借我好嗎？我想知道你喜歡它的理由。」" } },
      { text: "閉館的廣播響起。她小聲說：「……時間過得好快。」", opts: { romantic: "「跟你在一起的時候都是這樣。」", funny: "「我們躲進書架後面，等管理員走掉吧。」", earnest: "「下次早一點來，就能待久一點。」" } }
    ],
    nightview: [
      { text: "城市的燈光一閃一閃。她說：「從這裡看，煩惱好像都變小了。」", opts: { romantic: "「但你在我心裡越來越大。」", funny: "「那我們把煩惱丟下去吧，反正很遠。」", earnest: "「有什麼煩惱，可以跟我說。」" } },
      { text: "冷風吹過，她縮了一下肩膀。", opts: { romantic: "把外套披在她身上，順手牽住她的手。", funny: "「我身上有暖暖包，一個 500 元。」", earnest: "「會冷嗎？我們去買熱飲吧。」" } }
    ],
    beach: [
      { text: "浪花打上來，她的鞋子濕了。她看著你，噗哧一聲笑了出來。", opts: { romantic: "「那我也陪你一起濕。」走進浪裡。", funny: "「這片海決定要跟你交朋友了。」", earnest: "「沒事吧？我幫你把鞋子曬乾。」" } },
      { text: "她在沙灘上寫了兩個名字，又馬上用腳抹掉。", opts: { romantic: "「為什麼要擦掉？我想看。」", funny: "「是在寫我的名字對吧？寫錯字了嗎？」", earnest: "裝作沒看見，在旁邊寫下『謝謝你今天陪我』。" } }
    ],
    karaoke: [
      { text: "她把麥克風遞給你：「換你唱！不准唱太好聽喔。」", opts: { romantic: "點一首情歌，從頭到尾看著她唱。", funny: "用盡全力唱走音，逗得她笑到流眼淚。", earnest: "「那我們合唱吧，一個人唱太害羞了。」" } },
      { text: "她唱完一首慢歌，包廂忽然安靜下來。", opts: { romantic: "「那首歌……是唱給誰聽的？」", funny: "「九十八分！扣兩分是因為太好聽了。」", earnest: "「你唱歌的聲音很好聽，我很喜歡。」" } }
    ],
    movie: [
      { text: "電影演到最感人的地方，你聽到旁邊傳來小小的吸鼻子聲。", opts: { romantic: "在黑暗中輕輕握住她的手。", funny: "默默遞過去一包面紙，自己也拿一張。", earnest: "散場後問她：「哪一段最讓你感動？」" } },
      { text: "爆米花只剩最後一顆，你們的手同時伸了過去。", opts: { romantic: "把那一顆餵到她嘴邊。", funny: "「猜拳決定！三戰兩勝！」", earnest: "「給你吧，我已經吃很多了。」" } }
    ],
    museum: [
      { text: "她在一幅畫前站了很久：「你覺得畫家在想什麼？」", opts: { romantic: "「也許在想一個重要的人吧，像我現在一樣。」", funny: "「在想今天晚餐要吃什麼。」", earnest: "認真看了一會兒，說出你的感受。" } },
      { text: "紀念品店裡，她拿起兩張明信片猶豫不決。", opts: { romantic: "兩張都買下來，一張送給她。", funny: "「我幫你投票，選比較像我的那張。」", earnest: "「你為什麼喜歡這兩張？」" } }
    ],
    park: [
      { text: "摩天輪轉到最高點。她看著窗外，臉有點紅。", opts: { romantic: "「聽說在最高點許願的情侶會在一起。」", funny: "「我有懼高症……開玩笑的，你剛剛的表情好可愛。」", earnest: "「今天很開心，謝謝你答應跟我出來。」" } },
      { text: "雲霄飛車下來，她的頭髮亂成一團。", opts: { romantic: "幫她把頭髮一縷一縷整理好。", funny: "「這是今年最流行的髮型。」拍下一張照片。", earnest: "「還好嗎？要不要休息一下？」" } }
    ],
    dinner: [
      { text: "侍者送上甜點，盤子上用巧克力寫著『Happy Day』。", opts: { romantic: "「今天跟你在一起，每天都是 Happy Day。」", funny: "「看來他們知道今天有大人物來用餐。」", earnest: "「我特別請他們準備的。希望你喜歡。」" } },
      { text: "她看著帳單小聲說：「……這裡好貴喔，沒關係嗎？」", opts: { romantic: "「為了看你笑，一點都不貴。」", funny: "「沒關係，接下來一個月我吃泡麵就好。」", earnest: "「我想讓你有一個特別的回憶。」" } }
    ]
  };
  // 她當天的心情（依日期決定）→ 偏好的回應
  var MOODS = [
    { id: "happy", icon: "😊", name: { zh: "心情很好", ja: "ご機嫌" }, pref: "funny", hint: "她今天心情很好，一直在笑。" },
    { id: "tired", icon: "😮‍💨", name: { zh: "有點累", ja: "お疲れ気味" }, pref: "earnest", hint: "她今天看起來有點累。" },
    { id: "dreamy", icon: "🌙", name: { zh: "浪漫模式", ja: "ロマンチック" }, pref: "romantic", hint: "她今天好像有點浪漫的心情。" }
  ];

  // ---------------- 聊天：隱藏對話（第 2 項） ----------------
  // 連擊（連續選中她喜歡的話題）≥ 2 時再選 topic，觸發隱藏對話；needMet：要先認識的人
  var HIDDEN_TALKS = {
    yukina: { topic: "family", needMet: "saeko", text: "「……媽媽以前也是學年第一。我只是不想輸給她。」雪奈第一次說起家裡的事。" },
    konatsu: { topic: "family", needMet: "yoko", text: "「媽媽一個人把我養大的。所以我要跑得很快，快到可以帶她去任何地方！」" },
    kotone: { topic: "love", text: "「我寫的曲子……其實都是情歌。只是一直沒有可以唱給他聽的人。」" },
    rion: { topic: "study", text: "「欸……其實我在偷偷考服裝設計的證照。不准跟別人說喔。」她難得有點害羞。" },
    mashiro: { topic: "music", needMet: "kotone", text: "「琴音彈的遊戲配樂，是我最喜歡的聲音……你、你也覺得好聽嗎？」" },
    reika: { topic: "gossip", text: "「……那個傳言是真的。我小時候怕狗怕到哭。不准笑。」她別過頭去。" },
    akane: { topic: "love", text: "「我、我也想穿一次可愛的衣服啦……只是不知道適不適合。」朱音的臉紅得像番茄。" },
    shiori: { topic: "games", needMet: "mashiro", text: "「茉白推薦的遊戲……劇情寫得比我還好。我有點不甘心。」" },
    miki: { topic: "art", text: "「其實我小時候想當畫家喔。後來覺得那是有錢人的夢想。」" },
    rinko: { topic: "family", needMet: "rena", text: "「玲奈是我唯一的朋友。……如果你也算的話，就是兩個。」" },
    rena: { topic: "sports", text: "「我以前是游泳選手喔。因為受傷才開始對醫學有興趣的。」" },
    kaoru: { topic: "art", needMet: "aoi", text: "「雨宮畫的那幅排球選手……是我。她說受傷的我也很美。」" },
    aoi: { topic: "money", text: "「……其實我的畫，賣得很好。只是錢對我來說，沒有顏色。」" },
    saeko: { topic: "love", text: "「我和丈夫是在這間學校認識的。……那棵櫻花樹，還在呢。」" },
    yoko: { topic: "study", needMet: "konatsu", text: "「我高中就輟學了。所以小夏能上大學，我比誰都驕傲。」" },
    hiyori: { topic: "family", text: "「我是為了某個人才考進這間學校的。……那個人，就在我面前。」" }
  };

  // ---------------- 第 16 位：隱藏女主角（二周目，第 3、12 項） ----------------
  var HIYORI = {
    id: "hiyori", group: "kouhai", age: 18, hidden: true,
    name: { zh: "朝比奈 日和", ja: "朝比奈 日和" }, title: { zh: "神秘的學妹", ja: "ミステリアスな後輩" },
    intro: "第二學年入學的學妹。總是在遠處看著你，被發現就躲起來。據說她入學的理由，跟你有關。",
    topics: { like: ["love", "family", "music"], bad: ["gossip", "money"] },
    gifts: { like: ["plush", "flower", "choco"], bad: ["game", "coupon"] },
    dates: { like: ["park", "nightview", "movie"], bad: ["library", "dinner"] }, moment: "romantic",
    spots: ["garden", "plaza", "library", "gate"],
    look: { hair: 0xe8e2f0, style: "long", skin: 0xfaeee6, top: 0x2b2f55, bottom: 0x3a3f66, outfit: "blazer", ribbon: 0xb48ae0, h: 0.92, glasses: false },
    quests: [
      { at: 25, title: "被跟蹤的理由", desc: "「學、學長……我不是跟蹤狂！我只是……想跟你說話。」在櫻花林道等她。", req: { type: "loc", loc: "garden" }, done: "她從櫻花樹後走出來，深深鞠躬：「我叫朝比奈日和。請多指教，學長。」", reward: { aff: 12 } },
      { at: 50, title: "那天的熊熊", desc: "「學長還記得嗎……很久以前，在遊樂園送迷路的小女孩一隻熊熊？」", req: { type: "item", item: "plush" }, done: "「……一模一樣。」她抱著熊熊，眼淚一顆一顆掉下來：「那個小女孩，就是我。」", reward: { aff: 15 } },
      { at: 75, title: "追著你來的", desc: "「我是追著學長考進來的。……這樣的我，會很奇怪嗎？」", req: { type: "stat", stat: "charm", min: 60 }, done: "「不奇怪？」她破涕為笑：「那……可以讓我一直追下去嗎？」", reward: { aff: 18 } }
    ],
    story: [
      "日和在入學後第一次考試拿了全學年第二。她拿著成績單衝到你面前：「學長！我有變成配得上你的人一點了嗎？」",
      "日和把一本舊相簿遞給你。最後一頁貼著一張很舊的照片——年幼的她，和年幼的你，在摩天輪下。"
    ],
    confess: { charm: 55 }, jealousy: 0.8,
    lines: {
      greet: "「啊……！學、學長……！不、不是的，我剛好路過……！」",
      hi: ["「學長，早安……！」", "「今天也……見到學長了。」", "「欸嘿嘿……」"],
      like: ["「學長也是嗎？好開心……！」", "她的眼睛閃閃發亮：「再多說一點，好嗎？」"],
      mid: ["「嗯嗯……」她拼命點頭。", "「原來如此……我記下來了。」"],
      bad: ["「那、那個……我不太懂……」", "她有點困惑地歪著頭。"],
      gl: "「學長送我的……我會當成傳家寶的！」", gn: "「謝謝學長……！」", gb: "「啊……謝、謝謝……」",
      dy: "「真、真的嗎？！我、我馬上準備！」", dn: "「今天……家裡有事，對不起……」",
      cy: "「我等這一天……等了好多年。學長，我最喜歡你了。」", cn: "「……沒關係，我很習慣等待了。」",
      lover: ["「學長是我的……欸嘿嘿，說出口了。」", "「以前只能遠遠看著，現在可以牽手了。」"],
      jealous: "「我追了學長這麼多年……結果還是排在後面嗎？」",
      end: { lover: "「接下來的每一年，我都會在學長身邊。」", high: "「學長，謝謝你注意到我。」", mid: "「我會繼續努力的，學長！」", low: "「……學長好。」" }
    }
  };
  D.HEROINES.push(HIYORI);
  D.HEROINE_BY_ID.hiyori = HIYORI;
  D.GROUPS.push({ id: "kouhai", name: { zh: "學妹", ja: "後輩" } });
  D.PAIRS.push({ a: "hiyori", b: "rinko", text: "日和抱著問題集去找柊老師。「朝比奈，這題的解法……跟某人一模一樣。」柊老師看了你一眼。",
    shura: "「柊老師，學長是我先看上的。」「……朝比奈，你入學才一年。」" });

  // ---------------- 迷妹個性（第 3 項） ----------------
  var ADMIRER_TYPES = [
    { id: "pure", icon: "🌸", name: { zh: "純情", ja: "純情" }, w: 0.62 },
    { id: "bold", icon: "🔥", name: { zh: "肉食系", ja: "肉食系" }, w: 0.28 },
    { id: "stalker", icon: "👁", name: { zh: "執著", ja: "粘着" }, w: 0.10 }
  ];

  // ---------------- 校園隨機遭遇（第 9 項）：在 3D 校園走路時觸發 ----------------
  // kind：bump＝撞到在場的女主角；其餘不需要她在場
  var ENCOUNTERS = [
    { id: "bump", kind: "bump", title: "💥 轉角相撞", text: "你在轉角撞上了{n}，她手上的東西掉了一地。", opts: ["幫她一起撿", "「你沒事吧？」扶她起來", "道歉後快步離開"] },
    { id: "item", title: "🎁 撿到東西", text: "長椅上放著一個沒人認領的紙袋，裡面是一份還沒拆的禮物。", opts: ["交給失物招領", "先收著，找不到主人再說"] },
    { id: "witness", title: "💌 目擊告白現場", text: "你在樹後不小心目擊了一場告白。被告白的男生拒絕後跑走了，女生一個人站在原地。", opts: ["上前遞面紙", "悄悄離開"] },
    { id: "lost", title: "🗺 迷路的新生", text: "一個抱著地圖的新生女生在原地打轉：「請、請問保健中心在哪裡……」", opts: ["親自帶她過去", "指路給她"] },
    { id: "coin", title: "🪙 地上的硬幣", text: "噴水池邊的地上有一枚 500 元硬幣在發光。", opts: ["撿起來", "丟進噴水池許願"] },
    { id: "cat", title: "🐈 校園的貓", text: "一隻三花貓在你腳邊蹭來蹭去，好像餓了。", opts: ["分一點午餐給牠", "摸摸牠的頭"] },
    { id: "rain", title: "☔ 突然的陣雨", text: "走到一半下起了陣雨，你躲到屋簷下。", opts: ["等雨停", "衝回去"] }
  ];

  // ---------------- 交往階段（第 7 項） ----------------
  var REL_STAGES = [
    { lv: 0, name: { zh: "—", ja: "—" } },
    { lv: 1, name: { zh: "交往中", ja: "交際中" } },
    { lv: 2, name: { zh: "熱戀", ja: "熱愛" } },
    { lv: 3, name: { zh: "見過家長", ja: "家族公認" } },
    { lv: 4, name: { zh: "未來的約定", ja: "未来の約束" } }
  ];
  // 見「重要的人」：家長→女兒；老師→同事；其他→家人
  var FAMILY_TEXT = {
    saeko: "冴子帶你回早瀨家。雪奈打開門，看著你們兩個，沉默了很久：「……媽媽，你要幸福喔。」",
    yoko: "陽子把你帶到小夏面前。小夏瞪大眼睛，然後笑著拍了你一下：「欺負我媽的話，我會揍你喔！」",
    rinko: "柊老師帶你去見她唯一的朋友七瀨醫師。「凜子交給你了。」七瀨醫師笑著說。",
    rena: "七瀨醫師帶你見了她在鄉下的父母。她父親拍著你的肩：「玲奈就拜託你了。」",
    kaoru: "橘老師帶你去見她以前的教練。老教練說：「她終於找到比排球更重要的東西了。」",
    aoi: "雨宮老師帶你到她的畫室，牆上掛滿了你的畫像。「……這就是我的家人。」",
    _default: "{n}帶你回家見了她的家人。一開始很緊張，但晚餐結束時，她的家人已經叫你「孩子」了。"
  };

  // ---------------- 成就（第 8 項）：跨存檔保存 ----------------
  var ACHIEVEMENTS = [
    { id: "meet1", icon: "👋", name: "初次見面", desc: "認識第一位女主角" },
    { id: "meetAll", icon: "👭", name: "校園人脈王", desc: "認識全部 15 位主要女主角" },
    { id: "date1", icon: "💌", name: "第一次約會", desc: "完成第一次約會" },
    { id: "date50", icon: "🗓", name: "約會達人", desc: "累計約會 50 次" },
    { id: "lover1", icon: "💕", name: "戀愛開始", desc: "第一次交往" },
    { id: "lover3", icon: "💞", name: "三人行", desc: "同時和 3 人交往" },
    { id: "lover5", icon: "👑", name: "後宮", desc: "同時和 5 人交往" },
    { id: "harem", icon: "😇", name: "修羅場生還者", desc: "在修羅場坦白「兩個都喜歡」並被接受" },
    { id: "rel2", icon: "🔥", name: "熱戀", desc: "和某人進入熱戀" },
    { id: "rel3", icon: "🏠", name: "見家長", desc: "見過她重要的人" },
    { id: "rel4", icon: "💍", name: "未來的約定", desc: "和某人許下未來的約定" },
    { id: "exam95", icon: "💯", name: "學霸", desc: "考試拿到 95 分以上" },
    { id: "fans100", icon: "📣", name: "後援會成立", desc: "粉絲 100 人" },
    { id: "fans1000", icon: "🏟", name: "校園偶像", desc: "粉絲 1000 人" },
    { id: "ignore100", icon: "🧊", name: "冰山", desc: "無視 100 位迷妹" },
    { id: "clubWin", icon: "🏆", name: "社團大會優勝", desc: "在社團大會拿到優勝" },
    { id: "skill80", icon: "🎓", name: "專長大師", desc: "任一專長達到 80" },
    { id: "hidden", icon: "🔍", name: "隱藏的對話", desc: "觸發 5 段隱藏對話" },
    { id: "encounter20", icon: "🚶", name: "校園散步家", desc: "在校園遭遇 20 次事件" },
    { id: "meetup10", icon: "⏰", name: "守時的戀人", desc: "準時赴約 10 次" },
    { id: "story10", icon: "📖", name: "她們的故事", desc: "看過 10 段個人劇情" },
    { id: "hiyori", icon: "🌙", name: "神秘的學妹", desc: "讓隱藏女主角成為可攻略角色" },
    { id: "clear", icon: "🎓", name: "畢業", desc: "完成完整版（3 學年）" },
    { id: "trueEnd", icon: "🌈", name: "真結局", desc: "二周目以上，畢業時 15 人的好感都在 80 以上" }
  ];

  // 社團大會（秋學期第 10 週六）
  D.SPECIAL_DAYS.clubcup = { icon: "🏆", name: { zh: "社團大會", ja: "部活動大会" }, free: true, spots: ["gym", "club", "plaza", "field"], text: "今天是社團大會。各社團都在展現一年的成果。" };

  D.SKILLS = SKILLS; D.SKILL_BY_ID = SKILL_BY_ID; D.STAT_ALT_SKILL = STAT_ALT_SKILL; D.SKILL_EVENINGS = SKILL_EVENINGS;
  D.CLUBS = CLUBS; D.CLUB_BY_ID = CLUB_BY_ID; D.CLUB_DAYS = CLUB_DAYS;
  D.SPOT_MOMENTS = SPOT_MOMENTS; D.MOODS = MOODS;
  D.HIDDEN_TALKS = HIDDEN_TALKS;
  D.ADMIRER_TYPES = ADMIRER_TYPES;
  D.ENCOUNTERS = ENCOUNTERS;
  D.REL_STAGES = REL_STAGES; D.FAMILY_TEXT = FAMILY_TEXT;
  D.ACHIEVEMENTS = ACHIEVEMENTS;
  D.MAIN_COUNT = 15;
})();
