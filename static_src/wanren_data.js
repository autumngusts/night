// 萬人迷（wanren）：靜態資料。女主角 15 人、地點、話題、禮物、約會地點、每天的迷妹（搭訕方式）、雙人互動、隨機事件、評語。
// 舞台設定為大學（私立星見學園大學），玩家是轉學進來的大三生，所有角色都是成年人。
// 文字以繁中為主；角色名與稱號有日文，其餘日文 fallback 到繁中（L() 會自動 fallback）。
(function () {
  "use strict";

  function L(o) {
    if (o === null || o === undefined) return "";
    if (typeof o === "string") return o;
    var lang = (window.I18N && window.I18N.getLang && window.I18N.getLang()) || "zh";
    return o[lang] || o.zh || o.ja || "";
  }

  // ---------------- 地點（3D 校園座標：x 向右、z 向南＝鏡頭方向） ----------------
  // b：建築（中心、寬、深、高）；z：觸發範圍（中心、半徑）
  var LOCATIONS = [
    { id: "gate", name: { zh: "校門", ja: "校門" }, icon: "🚪", z: { x: 0, z: 50, r: 7 },
      act: { id: "home", ap: 0, name: { zh: "直接回家", ja: "まっすぐ帰る" }, note: "結束今天的自由時間" } },
    { id: "plaza", name: { zh: "中庭噴水池", ja: "中庭の噴水" }, icon: "⛲", z: { x: 0, z: 19, r: 8.5 },
      act: { id: "pose", ap: 1, name: { zh: "在噴水池邊耍帥", ja: "噴水の前でキメる" }, eff: { charm: 1, stamina: -3 }, flag: "pose", note: "魅力 +1，明天的迷妹變多" } },
    { id: "classroom", name: { zh: "教學大樓", ja: "講義棟" }, icon: "🏫", z: { x: 0, z: 1.5, r: 7 },
      b: { x: 0, z: -8, w: 46, d: 12, h: 13 },
      act: { id: "self", ap: 1, name: { zh: "教室自習", ja: "教室で自習" }, eff: { study: 3, stamina: -4 }, note: "學業 +3" } },
    { id: "library", name: { zh: "圖書館", ja: "図書館" }, icon: "📚", z: { x: -22, z: 13, r: 6 },
      b: { x: -35, z: 11, w: 16, d: 16, h: 10 },
      act: { id: "read", ap: 1, name: { zh: "埋頭讀書", ja: "勉強する" }, eff: { study: 4, stamina: -6 }, note: "學業 +4" } },
    { id: "cafeteria", name: { zh: "學生餐廳", ja: "学食" }, icon: "🍛", z: { x: 21, z: 14, r: 6 },
      b: { x: 35, z: 12, w: 18, d: 14, h: 7 },
      act: { id: "lunch", ap: 1, name: { zh: "吃一頓好的", ja: "がっつり食べる" }, eff: { stamina: 14, money: -500 }, note: "體力 +14、¥500" }, shop: true },
    { id: "gym", name: { zh: "體育館", ja: "体育館" }, icon: "🏀", z: { x: 34, z: -11, r: 6 },
      b: { x: 35, z: -25, w: 22, d: 16, h: 9 },
      act: { id: "workout", ap: 1, name: { zh: "重訓", ja: "筋トレ" }, eff: { charm: 2, stamina: -10 }, note: "魅力 +2" } },
    { id: "field", name: { zh: "操場", ja: "グラウンド" }, icon: "🏃", z: { x: -35, z: -26, r: 13 },
      act: { id: "sun", ap: 1, name: { zh: "在草皮上曬太陽", ja: "芝生で日向ぼっこ" }, eff: { stamina: 7 }, note: "體力 +7" } },
    { id: "garden", name: { zh: "櫻花林道", ja: "桜並木" }, icon: "🌸", z: { x: 0, z: -31, r: 10 },
      act: { id: "walk", ap: 1, name: { zh: "在櫻花下散步", ja: "桜の下を散歩" }, eff: { stamina: 5, charm: 1 }, note: "體力 +5、魅力 +1" } },
    { id: "club", name: { zh: "社團大樓", ja: "部室棟" }, icon: "🎸", z: { x: 24, z: 37, r: 6 },
      b: { x: 35, z: 38, w: 14, d: 10, h: 8 },
      act: { id: "clubact", ap: 1, name: { zh: "參加社團活動", ja: "サークル活動" }, eff: { charm: 1, rep: 2, stamina: -5 }, note: "魅力 +1、風評 +2" } },
    { id: "infirmary", name: { zh: "保健中心", ja: "保健センター" }, icon: "🩺", z: { x: -24, z: 37, r: 5.5 },
      b: { x: -34, z: 38, w: 11, d: 9, h: 6 },
      act: { id: "bed", ap: 1, name: { zh: "躺一下", ja: "ベッドで休む" }, eff: { stamina: 16 }, note: "體力 +16" } },
    { id: "cafe", name: { zh: "咖啡廳「陽光」", ja: "カフェ「ひだまり」" }, icon: "☕", z: { x: 13, z: 49, r: 4.5 },
      b: { x: 21, z: 52, w: 9, d: 7, h: 5 },
      act: { id: "parttime", ap: 1, name: { zh: "打工", ja: "バイト" }, eff: { money: 1200, stamina: -8 }, note: "¥1,200" } }
  ];
  var LOC_BY_ID = {};
  LOCATIONS.forEach(function (l) { LOC_BY_ID[l.id] = l; });

  // ---------------- 話題 ----------------
  var TOPICS = [
    { id: "study", name: { zh: "課業", ja: "勉強" }, say: "「最近的課好難，你平常都怎麼讀書？」" },
    { id: "sports", name: { zh: "運動", ja: "スポーツ" }, say: "「昨天的比賽你有看嗎？最後那一球超扯！」" },
    { id: "music", name: { zh: "音樂", ja: "音楽" }, say: "「你最近都聽什麼歌？推薦一首給我吧。」" },
    { id: "food", name: { zh: "美食", ja: "グルメ" }, say: "「車站後面新開了一家拉麵，聽說很好吃。」" },
    { id: "fashion", name: { zh: "時尚", ja: "ファッション" }, say: "「你今天的穿搭很好看，是在哪裡買的？」" },
    { id: "games", name: { zh: "遊戲動漫", ja: "ゲーム・アニメ" }, say: "「這季的新番你有在追嗎？」" },
    { id: "books", name: { zh: "文學", ja: "文学" }, say: "「我最近在讀一本小說，結局讓我想了好幾天。」" },
    { id: "love", name: { zh: "戀愛", ja: "恋愛" }, say: "「你相信一見鍾情嗎？」" },
    { id: "art", name: { zh: "藝術", ja: "アート" }, say: "「美術館這個月有特展，你有興趣嗎？」" },
    { id: "money", name: { zh: "打工理財", ja: "バイト・お金" }, say: "「最近想多打點工，你知道哪裡時薪比較好嗎？」" },
    { id: "family", name: { zh: "家人", ja: "家族" }, say: "「你家裡是怎樣的人呢？」" },
    { id: "gossip", name: { zh: "校園八卦", ja: "学内のウワサ" }, say: "「你有聽說那個傳言嗎？說學生會長其實……」" }
  ];
  var TOPIC_BY_ID = {};
  TOPICS.forEach(function (t) { TOPIC_BY_ID[t.id] = t; });

  // ---------------- 禮物（學生餐廳的購買部） ----------------
  var ITEMS = [
    { id: "choco", icon: "🍫", name: { zh: "巧克力", ja: "チョコレート" }, price: 300 },
    { id: "drink", icon: "🥤", name: { zh: "運動飲料", ja: "スポーツドリンク" }, price: 150 },
    { id: "towel", icon: "🧣", name: { zh: "運動毛巾", ja: "スポーツタオル" }, price: 600 },
    { id: "cake", icon: "🍰", name: { zh: "草莓蛋糕", ja: "苺のショートケーキ" }, price: 800 },
    { id: "coupon", icon: "🎫", name: { zh: "超市優惠券", ja: "スーパーの割引券" }, price: 500 },
    { id: "book", icon: "📕", name: { zh: "推理小說", ja: "推理小説" }, price: 900 },
    { id: "sheet", icon: "🎼", name: { zh: "古典樂譜集", ja: "クラシック楽譜集" }, price: 1200 },
    { id: "sketch", icon: "🎨", name: { zh: "高級素描本", ja: "高級スケッチブック" }, price: 1300 },
    { id: "flower", icon: "💐", name: { zh: "花束", ja: "花束" }, price: 1500 },
    { id: "tea", icon: "🫖", name: { zh: "高級紅茶", ja: "高級紅茶" }, price: 2000 },
    { id: "wagashi", icon: "🍡", name: { zh: "老店和菓子", ja: "老舗の和菓子" }, price: 2200 },
    { id: "plush", icon: "🧸", name: { zh: "熊熊玩偶", ja: "クマのぬいぐるみ" }, price: 2500 },
    { id: "pen", icon: "🖋", name: { zh: "高級鋼筆", ja: "高級万年筆" }, price: 3000 },
    { id: "accessory", icon: "💍", name: { zh: "銀色飾品", ja: "シルバーアクセ" }, price: 3500 },
    { id: "perfume", icon: "🌹", name: { zh: "香水", ja: "香水" }, price: 4000 },
    { id: "figure", icon: "🤖", name: { zh: "限定公仔", ja: "限定フィギュア" }, price: 4500 },
    { id: "game", icon: "🎮", name: { zh: "新作遊戲", ja: "新作ゲーム" }, price: 6000 }
  ];
  var ITEM_BY_ID = {};
  ITEMS.forEach(function (i) { ITEM_BY_ID[i.id] = i; });

  // ---------------- 約會地點 ----------------
  var DATE_SPOTS = [
    { id: "library", icon: "📖", name: { zh: "圖書館讀書約會", ja: "図書館デート" }, cost: 0, eff: { study: 2 } },
    { id: "nightview", icon: "🌃", name: { zh: "夜景展望台", ja: "夜景の展望台" }, cost: 500 },
    { id: "beach", icon: "🏖", name: { zh: "海邊散步", ja: "海辺の散歩" }, cost: 1000 },
    { id: "karaoke", icon: "🎤", name: { zh: "卡拉OK", ja: "カラオケ" }, cost: 1200 },
    { id: "movie", icon: "🎬", name: { zh: "電影院", ja: "映画館" }, cost: 1500 },
    { id: "museum", icon: "🖼", name: { zh: "美術館", ja: "美術館" }, cost: 1500 },
    { id: "park", icon: "🎡", name: { zh: "遊樂園", ja: "遊園地" }, cost: 5000, weekend: true },
    { id: "dinner", icon: "🍷", name: { zh: "高級餐廳", ja: "高級レストラン" }, cost: 8000 }
  ];
  var DATE_BY_ID = {};
  DATE_SPOTS.forEach(function (d) { DATE_BY_ID[d.id] = d; });

  // 約會中的一個瞬間：三種回應（浪漫／幽默／真誠），每位女主角各有喜歡的一種
  var DATE_MOMENTS = [
    { text: "她忽然停下腳步，看著你問：「跟我在一起……會不會很無聊？」",
      opts: { romantic: "「跟你在一起的每一秒都不無聊。」", funny: "「無聊？我剛剛心跳快到可以去跑馬拉松了。」", earnest: "「不會。我是真的很喜歡跟你相處的時間。」" } },
    { text: "回程的路上下起了小雨，你們只有一把傘。",
      opts: { romantic: "把傘整個往她那邊傾，自己淋濕半邊肩膀。", funny: "「這把傘是情侶專用的，單身的人撐會被雷劈。」", earnest: "「靠近一點吧，這樣兩個人都不會淋濕。」" } },
    { text: "她的手機響了一下，她看了一眼後有點落寞：「家裡又在催我了。」",
      opts: { romantic: "輕輕握住她的手：「今天就先忘了那些吧。」", funny: "「需要的話我可以假扮成你的經紀人去談判。」", earnest: "「要不要說說看？我會好好聽。」" } },
    { text: "她指著遠處的燈光：「你知道嗎，聽說在這裡許願很靈。」",
      opts: { romantic: "「我的願望已經站在我旁邊了。」", funny: "「那我許願明天的考試全部都是選擇題。」", earnest: "「那我們一起許願吧，你先。」" } },
    { text: "她小聲地說：「其實我今天……有特別打扮過。」",
      opts: { romantic: "「我一看到你就發現了，美到我說不出話。」", funny: "「難怪今天路人都在看你，害我好有壓力。」", earnest: "「謝謝你，很適合你。我很開心。」" } }
  ];

  // ---------------- 女主角 15 人 ----------------
  // group：classmate 同級生（大三）／senior 學姐（大四）／teacher 老師／parent 家長
  // topics.like／bad、gifts.like／bad、dates.like／bad、moment：喜歡的回應
  // spots：自由時間可能出現的地點；days：只在星期幾出現（0＝一 … 6＝日）
  // look：3D 外觀（hair 髮色、style 髮型、skin、top、bottom、outfit、h 身高倍率、glasses、ribbon）
  // quests：好感達 at 時解鎖；req：stat（學業／魅力／體力／風評下限）、item、money、loc、heroine
  // confess：告白條件（屬性下限）；jealousy：同時交往的在意程度 0〜1
  var HEROINES = [
    {
      id: "yukina", group: "classmate", age: 21,
      name: { zh: "早瀨 雪奈", ja: "早瀬 雪奈" }, title: { zh: "學年第一的冰山美人", ja: "学年一位の氷の美少女" },
      intro: "經濟系的學年第一，總是一個人在圖書館。說話冷淡，其實只是不擅長表達。母親是學園理事。",
      topics: { like: ["study", "books"], bad: ["games", "gossip"] },
      gifts: { like: ["pen", "book", "tea"], bad: ["figure", "perfume"] },
      dates: { like: ["library", "museum"], bad: ["karaoke", "park"] }, moment: "earnest",
      spots: ["library", "library", "classroom", "garden"],
      look: { hair: 0x1c1d2b, style: "long", skin: 0xf6e1d3, top: 0x23305a, bottom: 0x2b2f45, outfit: "blazer", ribbon: 0x6fa8dc, h: 1.0, glasses: false },
      quests: [
        { at: 25, title: "借筆記的條件", desc: "「想借我的筆記？先證明你跟得上進度。」", req: { type: "stat", stat: "study", min: 30 }, done: "她翻了翻你的筆記，難得點了點頭：「……還算可以。這本借你，下週還我。」", reward: { aff: 12, study: 3 } },
        { at: 50, title: "遺失的鋼筆", desc: "她最愛用的鋼筆不見了，表面上說無所謂，卻一直在找。送她一支新的吧。", req: { type: "item", item: "pen" }, done: "「這個……是同一個牌子。你怎麼知道？」她把鋼筆握在胸前，耳朵紅了。", reward: { aff: 15 } },
        { at: 75, title: "與母親的約定", desc: "她說母親今天會來學校，想讓你陪她一起去校門口。", req: { type: "loc", loc: "gate" }, done: "在母親面前，雪奈第一次主動牽起了你的手：「這是……我很重要的人。」", reward: { aff: 15, heroine: { id: "saeko", aff: 6 } } }
      ],
      confess: { study: 55 }, jealousy: 0.8,
      lines: {
        greet: "「……你是轉學生？位子在那邊，不要擋到我。」",
        hi: ["「你又來了。」", "「這題，你會嗎？」", "「……早。」"],
        like: ["她難得放下了書：「……你也會想這種事？說下去。」", "「嗯。這個觀點不錯。」她的嘴角動了一下。"],
        mid: ["「是嗎。」她翻了一頁書。", "「……普通。」"],
        bad: ["「我對那種東西沒興趣。」氣溫好像降了兩度。", "她看了你一眼，沒有回答。"],
        gl: "「……謝謝。我會好好用的。」", gn: "「謝謝，放那邊就好。」", gb: "「這個……我用不到。」",
        dy: "「……如果只是去讀書的話，可以。」", dn: "「我今天要讀書。」",
        cy: "「我本來以為，自己不需要任何人……可是你不一樣。嗯，我也喜歡你。」", cn: "「……現在的你，還不夠。」",
        lover: ["「今天也一起回家吧。……不行嗎？」", "「只有在你面前，我可以不用當第一名。」"],
        jealous: "「我以為……你只看著我一個人。」",
        end: { lover: "「下學期也要坐在我旁邊。這是命令。」", high: "「你是我在這間學校……唯一的朋友。」", mid: "「你的筆記，字很醜。但是很認真。」", low: "「轉學生？……啊，那個人。」" }
      }
    },
    {
      id: "konatsu", group: "classmate", age: 20,
      name: { zh: "日向 小夏", ja: "日向 小夏" }, title: { zh: "元氣滿點的田徑社王牌", ja: "元気いっぱいの陸上部エース" },
      intro: "體育系、田徑社的短跑王牌。笑聲很大、肚子總是餓，跟誰都能變成朋友。媽媽在校門旁開咖啡廳。",
      topics: { like: ["sports", "food"], bad: ["study", "books"] },
      gifts: { like: ["drink", "towel", "cake"], bad: ["book", "pen"] },
      dates: { like: ["park", "beach"], bad: ["museum", "library"] }, moment: "funny",
      spots: ["field", "field", "cafeteria", "plaza"],
      look: { hair: 0xd9792b, style: "ponytail", skin: 0xf0c9a8, top: 0xffffff, bottom: 0xd7443e, outfit: "jersey", ribbon: 0xd7443e, h: 0.96, glasses: false },
      quests: [
        { at: 25, title: "晨跑夥伴", desc: "「明天早上要不要一起跑操場十圈？跟不上的人請喝飲料喔！」", req: { type: "stat", stat: "stamina", min: 45, cost: 15 }, done: "跑完十圈你累到躺在草皮上，她笑著把運動飲料貼在你臉上：「不錯嘛！」", reward: { aff: 12, charm: 1 } },
        { at: 50, title: "大會前的特製便當", desc: "下週就是大會了，她想吃「有幸運加持」的便當。幫她準備食材吧。", req: { type: "money", amount: 1500 }, done: "「這、這是你做的？！」她一口氣吃光：「我一定會拿第一！」", reward: { aff: 15 } },
        { at: 75, title: "跑道上的約定", desc: "大會決賽前，她說：「如果你在終點等我，我就能跑出最快的速度。」", req: { type: "stat", stat: "charm", min: 45 }, done: "她衝過終點線，直接撲進你懷裡：「看到了嗎！我是為了你跑的喔！」", reward: { aff: 15, rep: 3 } }
      ],
      confess: { charm: 45 }, jealousy: 0.5,
      lines: {
        greet: "「喔！你就是轉學生？我是小夏！以後請多指教～要不要一起吃午餐？」",
        hi: ["「嗨嗨～！今天也很有精神嗎？」", "「我肚子餓了～你有帶吃的嗎？」", "「看我看我，新的跑鞋！」"],
        like: ["「對吧對吧！你很懂嘛！」她興奮地抓著你的手搖。", "「哇——我們好合！再多說一點！」"],
        mid: ["「嗯嗯，然後呢？」", "「喔～原來如此！」"],
        bad: ["「嗚……那個我聽了會想睡……」", "她的眼神開始放空，好像在想午餐要吃什麼。"],
        gl: "「哇！給我的？最喜歡你了！」", gn: "「謝啦～！」", gb: "「呃……這是要我讀的嗎……？」",
        dy: "「好耶！去去去！」", dn: "「啊，今天要練習……下次一定！」",
        cy: "「真的？！我也、我也是！從第一天就……哇啊好害羞！」", cn: "「欸？那個……我還沒想過耶……對不起！」",
        lover: ["「欸嘿嘿，牽手！」", "「下次比賽你也要來看喔！男朋友專用座位！」"],
        jealous: "「我……我還以為只有我……笨蛋！」",
        end: { lover: "「暑假一起去海邊吧！約好了喔！」", high: "「你是我最好的夥伴！」", mid: "「下次一起跑步吧！」", low: "「啊，轉學生！你好～」" }
      }
    },
    {
      id: "kotone", group: "classmate", age: 21,
      name: { zh: "白石 琴音", ja: "白石 琴音" }, title: { zh: "溫柔的鋼琴少女", ja: "優しいピアノ少女" },
      intro: "音樂系鋼琴組。說話輕聲細語，彈琴時卻判若兩人。放學後常在社團大樓的琴房練琴。",
      topics: { like: ["music", "art"], bad: ["sports", "money"] },
      gifts: { like: ["sheet", "flower", "plush"], bad: ["drink", "game"] },
      dates: { like: ["museum", "nightview"], bad: ["park", "karaoke"] }, moment: "romantic",
      spots: ["club", "club", "garden", "classroom"],
      look: { hair: 0xc9b38a, style: "wavy", skin: 0xf8e6da, top: 0xf3eee4, bottom: 0x8aa4c8, outfit: "dress", ribbon: 0xf2a7c3, h: 0.95, glasses: false },
      quests: [
        { at: 25, title: "翻譜的人", desc: "「下週的練習……可以幫我翻譜嗎？在社團大樓的琴房。」", req: { type: "loc", loc: "club" }, done: "你在她身邊翻著譜，她彈完最後一個音，小聲地說：「你翻得剛剛好。」", reward: { aff: 12, charm: 1 } },
        { at: 50, title: "遺失的樂譜", desc: "她的樂譜在搬琴房時弄丟了，上面有老師的筆記，她難過得不得了。", req: { type: "item", item: "sheet" }, done: "「雖然不是原本那本……可是，這本對我來說更重要了。」", reward: { aff: 15 } },
        { at: 75, title: "發表會", desc: "她說很怕上台，「如果台下有你在，我就不會害怕了。」", req: { type: "stat", stat: "charm", min: 50 }, done: "謝幕時，她的視線穿過整個大廳，只對著你一個人微笑。", reward: { aff: 15, rep: 2 } }
      ],
      confess: { charm: 50 }, jealousy: 0.7,
      lines: {
        greet: "「啊……你好。我是白石琴音。轉學的話……如果有不懂的，可以問我。」",
        hi: ["「你好……今天天氣很好呢。」", "「我剛剛在練琴……有吵到你嗎？」", "「嗯，下午好。」"],
        like: ["她眼睛一亮：「你也喜歡這個嗎……好開心。」", "「我們好像……很聊得來呢。」她害羞地笑了。"],
        mid: ["「嗯嗯……」她安靜地聽著。", "「原來是這樣。」"],
        bad: ["「對不起……我不太懂那個……」", "她有點困擾地低下了頭。"],
        gl: "「給我的……？謝謝，我會珍惜的。」", gn: "「謝謝你。」", gb: "「啊……謝、謝謝……」",
        dy: "「嗯……我很期待。」", dn: "「今天要練琴……對不起。」",
        cy: "「我……一直在等你說這句話。嗯，我願意。」", cn: "「對不起……我還沒有準備好……」",
        lover: ["「這首曲子……是為你寫的。」", "「可以……再靠近一點嗎？」"],
        jealous: "「沒關係……我只是……有點想哭。」",
        end: { lover: "「以後的每一場演奏，都想讓你坐在第一排。」", high: "「謝謝你總是聽我彈琴。」", mid: "「下次……也來琴房玩吧。」", low: "「你好……？」" }
      }
    },
    {
      id: "rion", group: "classmate", age: 21,
      name: { zh: "黑川 莉音", ja: "黒川 莉音" }, title: { zh: "辣妹系讀者模特兒", ja: "ギャル系読者モデル" },
      intro: "時尚雜誌的讀者模特兒，追蹤數十萬。看起來很會玩，對感情其實比誰都認真。",
      topics: { like: ["fashion", "love", "gossip"], bad: ["study", "books"] },
      gifts: { like: ["perfume", "accessory"], bad: ["book", "coupon"] },
      dates: { like: ["karaoke", "dinner", "movie"], bad: ["library", "museum"] }, moment: "romantic",
      spots: ["plaza", "plaza", "cafeteria", "cafe"],
      look: { hair: 0xf0d27a, style: "twin", skin: 0xf2cfb4, top: 0xf7f2f5, bottom: 0x2d2d2d, outfit: "casual", ribbon: 0xff5fa2, h: 1.0, glasses: false },
      quests: [
        { at: 25, title: "提包包要有人", desc: "「欸，陪我去逛街啦！幫我提包包，順便請我喝珍奶～」", req: { type: "money", amount: 2000 }, done: "「你的眼光還不錯嘛。這件我買了！」她對著鏡子比了個 YA。", reward: { aff: 12, charm: 2 } },
        { at: 50, title: "攝影助理", desc: "外拍的攝影助理放她鳥，「你來幫我拍吧？要把我拍得超可愛喔。」", req: { type: "stat", stat: "charm", min: 40 }, done: "她看著你拍的照片愣了好久：「……你拍的我，好像比平常溫柔。」", reward: { aff: 15, rep: 2 } },
        { at: 75, title: "不是玩玩而已", desc: "論壇上有人說她「只是在玩弄轉學生」。她第一次露出受傷的表情。", req: { type: "stat", stat: "rep", min: 5 }, done: "你在所有人面前說：「她是我最重視的人。」莉音轉過身，偷偷擦掉了眼淚。", reward: { aff: 15, rep: 3 } }
      ],
      confess: { charm: 55 }, jealousy: 0.9,
      lines: {
        greet: "「欸～你就是那個轉學生？長得不錯嘛。加個 IG？」",
        hi: ["「嗨～今天也很帥喔。」", "「欸，你看我的新指甲！」", "「你終於來了，等你好久耶～」"],
        like: ["「對吧～！你很懂耶！」她整個人靠過來。", "「欸欸我們超合的！」"],
        mid: ["「喔～是喔。」她滑著手機。", "「嗯哼。」"],
        bad: ["「好無聊喔～換個話題啦。」", "她打了個大大的呵欠。"],
        gl: "「哇！這個超可愛！你很懂我耶！」", gn: "「謝啦～」", gb: "「呃……這要我拿來幹嘛？」",
        dy: "「好啊～要把我打扮得漂漂亮亮再出門！」", dn: "「今天有拍攝啦～改天！」",
        cy: "「……你是認真的？我、我也是認真的喔。不准反悔！」", cn: "「噗，還早啦～再努力一點吧。」",
        lover: ["「我的限動全部都是你耶，你知道嗎？」", "「欸，牽手。現在、馬上。」"],
        jealous: "「你把我當什麼了？我才不是那種可以隨便的女生！」",
        end: { lover: "「下次的雜誌，我想跟你一起拍情侶特輯。」", high: "「你是我在學校最在意的人喔。」", mid: "「欸～下次再一起去逛街吧。」", low: "「誰啊？」" }
      }
    },
    {
      id: "mashiro", group: "classmate", age: 20,
      name: { zh: "星野 茉白", ja: "星野 茉白" }, title: { zh: "怕生的遊戲宅", ja: "人見知りのゲーマー" },
      intro: "資工系，戴著大大的眼鏡和耳機。線上是排行榜前十的玩家，現實中跟人說話會結巴。",
      topics: { like: ["games", "art"], bad: ["sports", "fashion"] },
      gifts: { like: ["game", "figure", "choco"], bad: ["perfume", "drink"] },
      dates: { like: ["karaoke", "movie"], bad: ["dinner", "beach"] }, moment: "funny",
      spots: ["club", "library", "classroom", "club"],
      look: { hair: 0x8c78c9, style: "bob", skin: 0xfaeadf, top: 0x9aa6b8, bottom: 0x3a3f55, outfit: "hoodie", ribbon: 0x7fd1c9, h: 0.9, glasses: true },
      quests: [
        { at: 25, title: "連線組隊", desc: "「那、那個……今天的活動副本，缺一個人……你在社團大樓的話……」", req: { type: "loc", loc: "club" }, done: "你雖然一直死，她卻笑得很開心：「你、你好爛……可是好好玩。」", reward: { aff: 12 } },
        { at: 50, title: "限定公仔", desc: "她排了三小時還是沒買到限定公仔，躲在社團教室角落難過。", req: { type: "item", item: "figure" }, done: "「這、這個是……！你怎麼買到的？！」她抱著公仔，眼鏡都起霧了。", reward: { aff: 15 } },
        { at: 75, title: "第一次的同人展", desc: "她第一次以作者身分參加同人展，但一個人會怕。攤位費還差一點。", req: { type: "money", amount: 3000 }, done: "本子全部賣完了。她在收攤時小聲說：「有你在……我、我什麼都不怕。」", reward: { aff: 15, charm: 1 } }
      ],
      confess: { charm: 40 }, jealousy: 0.6,
      lines: {
        greet: "「咿！……啊、你、你好……我是星野……請、請不要靠那麼近……」",
        hi: ["「……嗨。」她把耳機拿下一邊。", "「你、你今天也來了啊。」", "「……要一起玩嗎？」"],
        like: ["「對、對對對！你也知道這個？！」她突然變得超會講。", "她眼鏡後的眼睛閃閃發亮：「我、我們可以當朋友嗎？」"],
        mid: ["「嗯……嗯。」", "「是、是喔……」"],
        bad: ["「那、那種東西……跟我無關……」她縮進帽T裡。", "她默默把耳機戴回去了。"],
        gl: "「這、這是……！你是神嗎？！」", gn: "「謝、謝謝……」", gb: "「啊……這個……我用不到……」",
        dy: "「約、約會？！……好、好啊。」", dn: "「今、今天有排名賽……」",
        cy: "「我、我也……喜歡你。比任何遊戲都喜歡……！」", cn: "「對、對不起！我、我腦袋一片空白……！」",
        lover: ["「今天……也要一起打遊戲喔。」", "「現實好像……也沒那麼可怕了。」"],
        jealous: "「……果然，像我這樣的人……」",
        end: { lover: "「下次的同人展，我們一起出本吧。」", high: "「你是我第一個現實裡的朋友。」", mid: "「有、有空再組隊吧……」", low: "「……？」" }
      }
    },
    {
      id: "reika", group: "senior", age: 22,
      name: { zh: "神宮寺 麗華", ja: "神宮寺 麗華" }, title: { zh: "完美的學生會長大小姐", ja: "完璧な生徒会長お嬢様" },
      intro: "法律系大四、學生會長。名門神宮寺家的千金，舉止優雅、成績頂尖，從不讓人看見破綻。",
      topics: { like: ["study", "family", "art"], bad: ["games", "gossip"] },
      gifts: { like: ["tea", "flower", "wagashi"], bad: ["choco", "drink", "game"] },
      dates: { like: ["dinner", "museum"], bad: ["karaoke", "park"] }, moment: "earnest",
      spots: ["classroom", "classroom", "plaza", "library"],
      look: { hair: 0x6b3a2a, style: "longcurl", skin: 0xf9e9de, top: 0x2b2b4a, bottom: 0x2b2b4a, outfit: "blazer", ribbon: 0xd4af37, h: 1.04, glasses: false },
      quests: [
        { at: 25, title: "學生會的雜務", desc: "「學弟，你看起來很閒。學生會的預算報告就交給你整理吧。」", req: { type: "stat", stat: "study", min: 35 }, done: "「……沒有任何錯誤。哼，看來我小看你了。」", reward: { aff: 12, rep: 3 } },
        { at: 50, title: "紅茶的品味", desc: "她說學生會室的紅茶喝完了，「普通的茶包我是不喝的喔。」", req: { type: "item", item: "tea" }, done: "她啜了一口，眼神柔和下來：「大吉嶺的第一摘……你很用心呢。」", reward: { aff: 15 } },
        { at: 75, title: "學生會長的面具", desc: "深夜的學生會室，她一個人趴在桌上：「我好累……可是我不能讓任何人看到。」", req: { type: "stat", stat: "rep", min: 15 }, done: "「只有在你面前，我可以不是『神宮寺麗華』。……可以再陪我一下嗎？」", reward: { aff: 15 } }
      ],
      confess: { study: 50, rep: 10 }, jealousy: 0.85,
      lines: {
        greet: "「你就是轉學生？我是學生會長神宮寺麗華。在這間學校，請遵守規矩。」",
        hi: ["「午安，學弟。」", "「領帶歪了。……真是的，過來。」", "「有什麼事嗎？」"],
        like: ["「呵呵，你倒是有點見識。」她用扇子掩著嘴笑了。", "「很好。我欣賞會思考的人。」"],
        mid: ["「是嗎。」", "「嗯，繼續。」"],
        bad: ["「那種低俗的話題，請不要在我面前提。」", "她的眼神冷了下來。"],
        gl: "「……真是的，這麼高級的東西。謝謝你。」", gn: "「心意我收下了。」", gb: "「這種東西……你是在小看我嗎？」",
        dy: "「既然你這麼誠懇地邀請……我就給你一次機會吧。」", dn: "「今天學生會有會議。」",
        cy: "「……我神宮寺麗華，從來沒有輸給過任何人。只有你……讓我心甘情願認輸。」", cn: "「你還配不上我。……目前。」",
        lover: ["「今天也辛苦了。……過來，讓我靠一下。」", "「下次，我想介紹你給我父親認識。」"],
        jealous: "「我給了你我的一切，你卻……！」",
        end: { lover: "「畢業之後，也要一直在我身邊。這是我第一次的任性。」", high: "「你是我最信任的學弟。」", mid: "「學生會隨時歡迎你。」", low: "「請遵守校規。」" }
      }
    },
    {
      id: "akane", group: "senior", age: 22,
      name: { zh: "葛城 朱音", ja: "葛城 朱音" }, title: { zh: "豪爽的劍道社主將", ja: "豪快な剣道部主将" },
      intro: "體育系大四、劍道社主將。說話直來直往、食量驚人，很照顧學弟妹。不擅長應付戀愛話題。",
      topics: { like: ["sports", "food", "family"], bad: ["fashion", "love"] },
      gifts: { like: ["towel", "drink", "cake"], bad: ["perfume", "accessory"] },
      dates: { like: ["beach", "park", "karaoke"], bad: ["museum", "dinner"] }, moment: "earnest",
      spots: ["gym", "gym", "field", "cafeteria"],
      look: { hair: 0x241515, style: "highpony", skin: 0xeec3a2, top: 0xffffff, bottom: 0x1c2340, outfit: "hakama", ribbon: 0xc0392b, h: 1.06, glasses: false },
      quests: [
        { at: 25, title: "對練", desc: "「喂，學弟！來陪我練一下！放心，我會手下留情的！」", req: { type: "stat", stat: "stamina", min: 50, cost: 20 }, done: "你被打得滿地找牙，她哈哈大笑地拉你起來：「有骨氣！我喜歡！」", reward: { aff: 12, charm: 1 } },
        { at: 50, title: "竹刀的護手", desc: "她的竹刀護手破了，但社費不夠。「沒關係啦，用膠帶黏一黏就好！」", req: { type: "money", amount: 1200 }, done: "「這、這是給我的？……笨蛋，幹嘛對我這麼好。」她轉過身去，耳朵紅透了。", reward: { aff: 15 } },
        { at: 75, title: "一本勝負", desc: "引退賽前，她說：「如果我贏了，有件事……我想跟你說。」", req: { type: "stat", stat: "charm", min: 50 }, done: "她摘下面罩，滿頭大汗地看著你：「我贏了。……所以，聽好了，我喜歡你！」", reward: { aff: 18 } }
      ],
      confess: { charm: 45 }, jealousy: 0.4,
      lines: {
        greet: "「喔！新面孔！我是劍道社的葛城！有空來社團玩啊，學弟！」",
        hi: ["「喲，學弟！吃飯了沒？」", "「今天也要好好鍛鍊啊！」", "「哈哈，你看起來很沒精神喔！」"],
        like: ["「說得好！你這傢伙很有意思嘛！」她用力拍你的背。", "「哈哈哈！對吧！」"],
        mid: ["「嗯？喔，是喔。」", "「原來如此。」"],
        bad: ["「哇，那種東西我完全不懂……」她抓了抓頭。", "「……你、你在說什麼啦，害我不知道怎麼回。」"],
        gl: "「喔喔！正好需要這個！謝啦！」", gn: "「謝啦！」", gb: "「這種東西……跟我不搭吧？」",
        dy: "「好啊！走吧！」", dn: "「今天要練習，抱歉啦！」",
        cy: "「我、我嗎？！……我又不像女孩子……你說真的？……好、好啦，我也喜歡你啦！」", cn: "「哈、哈哈！開什麼玩笑！……你先打贏我再說！」",
        lover: ["「我……我給你做了便當。不准嫌難吃！」", "「被你牽著手……比輸掉比賽還要讓人心跳……」"],
        jealous: "「我不擅長吵架……可是，我現在真的很生氣！」",
        end: { lover: "「畢業後我也會一直保護你的！……也讓你保護我一下好了。」", high: "「你是我最得意的學弟！」", mid: "「隨時來道場找我！」", low: "「嗯？你是哪個社團的？」" }
      }
    },
    {
      id: "shiori", group: "senior", age: 22,
      name: { zh: "綾瀨 詩織", ja: "綾瀬 詩織" }, title: { zh: "活在書頁裡的文藝社長", ja: "本の中に生きる文芸部長" },
      intro: "文學系大四、文藝社社長，已經出版過一本短篇集。常在櫻花林道的長椅上寫東西，說話像在念詩。",
      topics: { like: ["books", "love", "art"], bad: ["sports", "money"] },
      gifts: { like: ["book", "flower", "sketch"], bad: ["drink", "game"] },
      dates: { like: ["nightview", "beach", "library"], bad: ["park", "karaoke"] }, moment: "romantic",
      spots: ["garden", "garden", "library", "cafe"],
      look: { hair: 0x3b4a6b, style: "braid", skin: 0xf7e7dc, top: 0xe8dcc8, bottom: 0x6a5a7a, outfit: "cardigan", ribbon: 0x9b7bb8, h: 0.98, glasses: true },
      quests: [
        { at: 25, title: "小說的素材", desc: "「我在寫一個轉學生的故事。可以……讓我觀察你一下嗎？在櫻花林道。」", req: { type: "loc", loc: "garden" }, done: "她一邊寫一邊偷看你：「嗯……主角的眼睛，原來是這種顏色。」", reward: { aff: 12 } },
        { at: 50, title: "絕版的推理小說", desc: "她在找一本小時候讀過的推理小說，說那是她成為作家的起點。", req: { type: "item", item: "book" }, done: "「……就是這本。」她把書抱在懷裡：「你真的……很像故事裡的人。」", reward: { aff: 15 } },
        { at: 75, title: "最後一章", desc: "她的小說卡在最後一章。「我不知道……主角最後會不會說出喜歡。」", req: { type: "stat", stat: "study", min: 40 }, done: "你們一起改到深夜。最後一行她寫下：『他說，喜歡妳。』然後抬頭看著你。", reward: { aff: 15, study: 2 } }
      ],
      confess: { study: 40, charm: 40 }, jealousy: 0.6,
      lines: {
        greet: "「……你的腳步聲，像是一個新章節的開頭。你好，我是綾瀨。」",
        hi: ["「午安。今天的雲，像鯨魚。」", "「你來了。我剛好寫到你。」", "「噓……櫻花在說話。」"],
        like: ["「啊……這句話，我可以抄下來嗎？」", "她闔上筆記本，認真地看著你：「繼續說，我想聽。」"],
        mid: ["「嗯……」她的筆停了一下。", "「這也是一種風景呢。」"],
        bad: ["「……那個世界，離我好遠。」", "她的視線飄向了天空。"],
        gl: "「……謝謝。這是我今年收過最好的禮物。」", gn: "「謝謝你。」", gb: "「嗯……我會好好收著的。」",
        dy: "「好。今晚的月亮，應該很美。」", dn: "「今天是截稿日……」",
        cy: "「我寫過一百種告白的場景……但是沒有一種，比現在更美。嗯，我也喜歡你。」", cn: "「……這一章，還不是結局。」",
        lover: ["「你知道嗎？我新書的主角，越來越像你了。」", "「今晚的月色真美。……你懂這句話的意思吧？」"],
        jealous: "「原來……我只是你故事裡的配角。」",
        end: { lover: "「下一本書的扉頁，我要寫上：獻給你。」", high: "「你是我故事裡最重要的角色。」", mid: "「有空來文藝社坐坐吧。」", low: "「……是誰呢？」" }
      }
    },
    {
      id: "miki", group: "senior", age: 23,
      name: { zh: "鳴海 美紀", ja: "鳴海 美紀" }, title: { zh: "學餐打工的節儉學姐", ja: "学食バイトの節約先輩" },
      intro: "商學系大四，靠自己打工付學費。在學生餐廳打工、精打細算，嘴上愛錢，其實最會照顧人。",
      topics: { like: ["money", "food", "family"], bad: ["fashion", "art"] },
      gifts: { like: ["coupon", "cake", "choco"], bad: ["perfume", "accessory"] },
      dates: { like: ["nightview", "library", "karaoke"], bad: ["dinner", "park"] }, moment: "funny",
      spots: ["cafeteria", "cafeteria", "cafe", "library"],
      look: { hair: 0x5a3b26, style: "bun", skin: 0xf3d2b8, top: 0xf6f0e3, bottom: 0x4f6f52, outfit: "apron", ribbon: 0xe6a23c, h: 1.0, glasses: false },
      quests: [
        { at: 25, title: "代班", desc: "「學弟～拜託！今天學餐缺人，幫我代一下班！時薪會照算給你喔！」", req: { type: "loc", loc: "cafeteria" }, done: "忙完午餐尖峰，她塞了一個飯糰給你：「辛苦啦！你比新人好用多了！」", reward: { aff: 12, money: 1000 } },
        { at: 50, title: "超市特價日", desc: "她說今天的超市特價只能一人一份，想拜託你一起去排隊。用優惠券的話更好！", req: { type: "item", item: "coupon" }, done: "「哇！這樣這個月可以省三千塊！你是我的救星！」她開心地轉了一圈。", reward: { aff: 15 } },
        { at: 75, title: "她的夢想", desc: "打烊後，她第一次說出夢想：「我想開一間便宜又好吃的小食堂。……很蠢吧？」", req: { type: "stat", stat: "charm", min: 50 }, done: "「你說不蠢……那我就再努力一下吧。」她靠在你肩上：「到時候，你要當第一個客人。」", reward: { aff: 15 } }
      ],
      confess: { charm: 45 }, jealousy: 0.5,
      lines: {
        greet: "「歡迎光臨～啊，新生？不對，轉學生？今天的 A 餐很划算喔！」",
        hi: ["「學弟～今天吃什麼？」", "「我跟你說，今天雞腿便當特價！」", "「累死了……啊，你來啦。」"],
        like: ["「對對！就是這樣！錢要花在刀口上！」", "「你很懂生活嘛，學弟！」"],
        mid: ["「嗯嗯。」她一邊擦桌子一邊聽。", "「是喔～」"],
        bad: ["「那種東西又不能吃……」", "「學弟，那個很貴的吧……」"],
        gl: "「哇！實用！我最喜歡實用的東西了！」", gn: "「謝謝～」", gb: "「這個……好貴吧？可以退貨嗎？」",
        dy: "「不用花太多錢的話……好啊！」", dn: "「今天要打工啦～」",
        cy: "「我……我很窮喔？很小氣喔？你確定？……笨蛋，我也喜歡你啦。」", cn: "「學弟，別開學姐玩笑啦～」",
        lover: ["「我幫你做了便當，材料費只要 120 元喔～開玩笑的。」", "「跟你在一起，好像不用那麼拚也沒關係。」"],
        jealous: "「我是沒什麼錢……可是我的心，不是可以拿來打折的！」",
        end: { lover: "「我的食堂開張那天，你要坐在櫃台旁邊喔。」", high: "「你是我最好的學弟！」", mid: "「下次來學餐，我多給你一塊肉。」", low: "「歡迎光臨～」" }
      }
    },
    {
      id: "rinko", group: "teacher", age: 31,
      name: { zh: "柊 凜子", ja: "柊 凛子" }, title: { zh: "嚴格的數學教授（你的導師）", ja: "厳しい数学教授（あなたの担任）" },
      intro: "理學院最年輕的副教授，也是你的導師。對學生極為嚴格，被稱為「鬼柊」。私底下是個怕寂寞的人。",
      topics: { like: ["study", "books"], bad: ["gossip", "games"] },
      gifts: { like: ["pen", "tea", "wagashi"], bad: ["plush", "figure"] },
      dates: { like: ["museum", "dinner", "library"], bad: ["park", "karaoke"] }, moment: "earnest",
      spots: ["classroom", "classroom", "library", "cafe"],
      look: { hair: 0x161616, style: "updo", skin: 0xf4e0d2, top: 0x2f3440, bottom: 0x2f3440, outfit: "suit", ribbon: 0xffffff, h: 1.05, glasses: true },
      quests: [
        { at: 25, title: "課後補習", desc: "「你的小考成績，我看不下去。放學後到教室來。」", req: { type: "stat", stat: "study", min: 35 }, done: "「……進步很多。我沒有誇你，只是陳述事實。」", reward: { aff: 12, study: 4 } },
        { at: 50, title: "研究室的整理", desc: "她的研究室堆滿了論文。「……不准笑。幫我整理。在教學大樓。」", req: { type: "loc", loc: "classroom" }, done: "你在論文堆底下找到一張舊照片，照片裡的她笑得很燦爛。她搶過照片：「……不准說出去。」", reward: { aff: 15 } },
        { at: 75, title: "滿分的答卷", desc: "「如果你期末考數學拿到高分，我就……答應你一個要求。」", req: { type: "stat", stat: "study", min: 65 }, done: "「……滿分。你這個人，真是。」她摘下眼鏡，第一次對你露出了微笑。", reward: { aff: 18, study: 3 } }
      ],
      confess: { study: 70 }, jealousy: 0.7, inviteMin: 50,
      lines: {
        greet: "「我是你的導師，柊。轉學生不會有特別待遇，遲到一次就扣分。」",
        hi: ["「作業交了嗎？」", "「……什麼事。」", "「你今天的出席，我記下了。」"],
        like: ["「……你這個問題問得不錯。」她推了推眼鏡。", "「嗯。有思考過的人，說話是不一樣的。」"],
        mid: ["「是嗎。」", "「說重點。」"],
        bad: ["「你是來學校做什麼的？」", "她用紅筆在你的名字旁邊打了一個叉。"],
        gl: "「……學生送老師禮物，不太好。……但是，謝謝。」", gn: "「心意收下了。」", gb: "「我看起來像是會喜歡這種東西的人嗎？」",
        dy: "「……只是去『校外教學』而已。不要誤會。」", dn: "「老師很忙。」",
        cy: "「……等你畢業。不，算了。我已經……等不了了。」", cn: "「我是老師，你是學生。……回去讀書。」",
        lover: ["「在學校要叫我老師。……兩個人的時候，叫我凜子。」", "「今天的作業是……陪我吃晚餐。」"],
        jealous: "「我以為……至少你是不一樣的。」",
        end: { lover: "「下學期的導師面談……時間會比較長。你懂的。」", high: "「你是我教過最讓我頭痛，也最讓我驕傲的學生。」", mid: "「下學期也要認真。」", low: "「出席率太低了。」" }
      }
    },
    {
      id: "rena", group: "teacher", age: 29,
      name: { zh: "七瀨 玲奈", ja: "七瀬 玲奈" }, title: { zh: "溫柔的保健中心醫師", ja: "優しい保健センターの先生" },
      intro: "保健中心的駐校醫師。總是溫柔地笑著，被學生們稱為「天使」。對自己的事卻不太會照顧。",
      topics: { like: ["family", "food", "love"], bad: ["sports", "games"] },
      gifts: { like: ["flower", "cake", "plush"], bad: ["drink", "game"] },
      dates: { like: ["beach", "nightview", "movie"], bad: ["karaoke", "park"] }, moment: "earnest",
      spots: ["infirmary", "infirmary", "infirmary", "garden"],
      look: { hair: 0x9a5b3a, style: "sidepony", skin: 0xf8e4d6, top: 0xffffff, bottom: 0x7a8fa6, outfit: "labcoat", ribbon: 0x88c0d0, h: 1.0, glasses: false },
      quests: [
        { at: 25, title: "健康檢查", desc: "「轉學生的健康檢查還沒做喔～到保健中心來一下吧。」", req: { type: "loc", loc: "infirmary" }, done: "「心跳有點快呢……緊張嗎？」她笑咪咪地把聽診器收起來。", reward: { aff: 12, stamina: 15 } },
        { at: 50, title: "藥品的整理", desc: "「藥品要按照成分重新分類……可以幫我嗎？我對這種事情最不拿手了。」", req: { type: "stat", stat: "study", min: 30 }, done: "「好厲害，一下子就整理好了！你以後要不要來當我的助手？」", reward: { aff: 15, study: 2 } },
        { at: 75, title: "天使也會累", desc: "你發現她一個人在保健中心的床上睡著了，眼角還有淚痕。", req: { type: "item", item: "plush" }, done: "她醒來看到枕邊的熊熊：「……被你看到了呢。其實我，一直很想被誰照顧一次。」", reward: { aff: 15 } }
      ],
      confess: { charm: 50, rep: 0 }, jealousy: 0.6, inviteMin: 40,
      lines: {
        greet: "「你好呀，轉學生。哪裡不舒服的話，隨時來找我喔。」",
        hi: ["「今天氣色不錯呢。」", "「有好好吃飯嗎？」", "「又受傷了？……開玩笑的，歡迎。」"],
        like: ["「呵呵，你真是個溫柔的孩子。」", "「我們好像很合得來呢。」她的笑容更柔和了。"],
        mid: ["「嗯嗯，這樣啊。」", "「原來如此～」"],
        bad: ["「要小心不要受傷喔……」她有點擔心地看著你。", "「那個……我不太懂呢。」"],
        gl: "「哎呀，好可愛！謝謝你～」", gn: "「謝謝你的心意。」", gb: "「呵呵……謝謝？」",
        dy: "「好呀。偶爾也想離開消毒水的味道呢。」", dn: "「今天要值班，對不起喔。」",
        cy: "「我比你大很多喔……真的可以嗎？……嗯。我也是，一直都喜歡你。」", cn: "「不可以喔。……你值得更好的人。」",
        lover: ["「今天也要好好照顧自己。……我也會照顧你的。」", "「你來了，我的心跳就會變快呢。這要怎麼治呢？」"],
        jealous: "「我是不是……太天真了呢。」",
        end: { lover: "「以後換我來當你一個人的醫生吧。」", high: "「謝謝你總是來陪我說話。」", mid: "「要注意身體喔。」", low: "「你好呀～」" }
      }
    },
    {
      id: "kaoru", group: "teacher", age: 30,
      name: { zh: "橘 薰", ja: "橘 薫" }, title: { zh: "帥氣的體育老師", ja: "カッコいい体育教師" },
      intro: "前國家隊排球選手，因傷退役後成為體育老師。比男生還帥，女學生的人氣第一。",
      topics: { like: ["sports", "food"], bad: ["books", "art"] },
      gifts: { like: ["drink", "towel"], bad: ["sketch", "book"] },
      dates: { like: ["park", "beach", "karaoke"], bad: ["museum", "library"] }, moment: "funny",
      spots: ["field", "gym", "field", "cafeteria"],
      look: { hair: 0x2a1e1a, style: "short", skin: 0xe8b996, top: 0x2d4f8a, bottom: 0x2d4f8a, outfit: "jersey", ribbon: 0xffffff, h: 1.08, glasses: false },
      quests: [
        { at: 25, title: "體能測驗", desc: "「轉學生！你的體能測驗還沒補考！給我跑起來！」", req: { type: "stat", stat: "stamina", min: 55, cost: 15 }, done: "「好！不錯的根性！」她用力揉亂你的頭髮。", reward: { aff: 12, charm: 1 } },
        { at: 50, title: "球隊缺人", desc: "教職員排球賽缺一個人，「你來湊數！在體育館集合！」", req: { type: "loc", loc: "gym" }, done: "你接起了決勝的一球。她衝過來抱住你：「幹得好！」……然後發現自己在幹嘛，臉紅了。", reward: { aff: 15, rep: 2 } },
        { at: 75, title: "退役的選手", desc: "她看著舊比賽影片，小聲說：「如果沒受傷，我現在會在哪裡呢……」", req: { type: "stat", stat: "charm", min: 55 }, done: "「……謝謝你。原來還有人，看到的不是選手橘薰，而是我。」", reward: { aff: 15 } }
      ],
      confess: { charm: 55 }, jealousy: 0.4, inviteMin: 40,
      lines: {
        greet: "「喔，轉學生！我是體育老師橘！上我的課可不准偷懶喔！」",
        hi: ["「喲！有在運動嗎？」", "「站直！……開玩笑的，哈哈。」", "「今天也很有精神嘛！」"],
        like: ["「說得好！就是要這樣！」她跟你擊了個掌。", "「哈哈哈，我喜歡你這小子！」"],
        mid: ["「嗯？喔。」", "「是喔～」"],
        bad: ["「那種東西……我看了會頭痛。」", "她打了個大哈欠。"],
        gl: "「喔！謝啦！正好需要！」", gn: "「謝啦！」", gb: "「這個……我大概用不到吧，哈哈。」",
        dy: "「好啊！流流汗吧！」", dn: "「今天要帶社團，下次吧！」",
        cy: "「我……我比你大耶？我很粗魯耶？……真是的，被你打敗了。好啦！」", cn: "「臭小子，十年後再來吧！」",
        lover: ["「今天的練習……我陪你一對一，特別指導。」", "「被你這樣看著，我也會害羞的啦……」"],
        jealous: "「我最討厭不認真的人了！」",
        end: { lover: "「暑假一起去集訓吧……兩個人的。」", high: "「你是我最看好的學生！」", mid: "「繼續加油！」", low: "「體育課要出席喔！」" }
      }
    },
    {
      id: "aoi", group: "teacher", age: 28,
      name: { zh: "雨宮 葵", ja: "雨宮 葵" }, title: { zh: "神秘的美術講師", ja: "ミステリアスな美術講師" },
      intro: "兼任的美術講師，也是新銳畫家。總穿著沾了顏料的外套，說話慢吞吞的，看人的眼神像在畫素描。",
      topics: { like: ["art", "books", "music"], bad: ["money", "sports"] },
      gifts: { like: ["sketch", "flower", "wagashi"], bad: ["drink", "coupon"] },
      dates: { like: ["museum", "nightview", "beach"], bad: ["park", "dinner"] }, moment: "romantic",
      spots: ["garden", "plaza", "club", "garden"],
      look: { hair: 0x2d5a6b, style: "messy", skin: 0xf6e3d6, top: 0x8a9a6a, bottom: 0x3e3a36, outfit: "coat", ribbon: 0xe0a458, h: 1.02, glasses: false },
      quests: [
        { at: 25, title: "當模特兒", desc: "「你的輪廓很好畫。……到櫻花林道來，當我的模特兒。」", req: { type: "loc", loc: "garden" }, done: "兩個小時一動也不動。她看了看畫布，又看了看你：「……你比畫好看。」", reward: { aff: 12, charm: 1 } },
        { at: 50, title: "畫材", desc: "她的素描本用完了，卻一直忘記去買。「……你可以幫我嗎？」", req: { type: "item", item: "sketch" }, done: "她在新素描本的第一頁，畫了你的側臉。", reward: { aff: 15 } },
        { at: 75, title: "未完成的畫", desc: "她的畫室裡有一幅畫了三年還沒完成的畫。「……少了一種顏色。」", req: { type: "stat", stat: "charm", min: 60 }, done: "那天她終於完成了。畫裡的櫻花樹下站著一個人——是你。", reward: { aff: 18 } }
      ],
      confess: { charm: 60 }, jealousy: 0.5, inviteMin: 40,
      lines: {
        greet: "「……你。不要動。……嗯，好。你可以走了。」她在素描本上畫了幾筆。",
        hi: ["「……嗨。」", "「今天的光線很好。」", "「……你的影子，很漂亮。」"],
        like: ["她停下了畫筆：「……你，很有意思。」", "「嗯……再多說一點，我想畫下來。」"],
        mid: ["「……嗯。」", "她的筆沒有停。"],
        bad: ["「……那個，沒有顏色。」", "她好像根本沒在聽。"],
        gl: "「……謝謝。我很喜歡。」", gn: "「……謝謝。」", gb: "「……這是什麼？」",
        dy: "「……好。我想看看你在夜裡的樣子。」", dn: "「……今天，畫不完。」",
        cy: "「我畫了你一百次……每一次，都想更靠近一點。……嗯，我也是。」", cn: "「……還差一種顏色。」",
        lover: ["「今天，可以當我的模特兒嗎？……不是為了畫畫。」", "「你在的時候，世界的顏色比較多。」"],
        jealous: "「……原來你的顏色，是可以分給很多人的。」",
        end: { lover: "「下一次個展的主題，是你。」", high: "「你是我最喜歡的模特兒。」", mid: "「……有空來畫室。」", low: "「……？」" }
      }
    },
    {
      id: "saeko", group: "parent", age: 41,
      name: { zh: "早瀨 冴子", ja: "早瀬 冴子" }, title: { zh: "雪奈的母親・學園理事", ja: "雪奈の母・学園理事" },
      intro: "雪奈的母親，學園的理事。丈夫早逝後一手撐起家族企業，嚴厲又優雅。每週二、四、六會來學校開會。",
      topics: { like: ["family", "study", "art"], bad: ["games", "gossip"] },
      gifts: { like: ["wagashi", "tea", "flower"], bad: ["choco", "drink", "figure"] },
      dates: { like: ["dinner", "museum"], bad: ["karaoke", "park"] }, moment: "earnest",
      spots: ["gate", "plaza", "classroom"], days: [1, 3, 5],
      look: { hair: 0x1c1d2b, style: "updo", skin: 0xf3dfd0, top: 0x5a2a3a, bottom: 0x2a2030, outfit: "kimono", ribbon: 0xd4af37, h: 1.02, glasses: false },
      quests: [
        { at: 25, title: "女兒的事", desc: "「你和雪奈同班吧？那孩子……在學校過得還好嗎？」先跟雪奈變熟吧。", req: { type: "heroine", id: "yukina", min: 25 }, done: "「是嗎……那孩子會笑了啊。」冴子眼角泛起淚光：「謝謝你。」", reward: { aff: 12 } },
        { at: 50, title: "理事會的資料", desc: "「下次理事會的資料需要學生的觀點……你願意幫忙嗎？」", req: { type: "stat", stat: "study", min: 45 }, done: "「很有見地。比那些老頭子強多了。」她第一次直呼你的名字。", reward: { aff: 15, rep: 3 } },
        { at: 75, title: "再一次心動", desc: "「這麼多年，我早就忘記怎麼當一個『女人』了……」", req: { type: "stat", stat: "charm", min: 65 }, done: "她抬起頭，像個少女一樣紅了臉：「……你這孩子，真是壞心眼。」", reward: { aff: 15 } }
      ],
      confess: { charm: 65, rep: 15 }, jealousy: 0.7, inviteMin: 55,
      lines: {
        greet: "「你就是那位轉學生？我是早瀨冴子。……小女承蒙關照了。」",
        hi: ["「午安。」", "「今天也很有禮貌呢。」", "「理事會又拖了這麼久……啊，是你。」"],
        like: ["「呵呵，你說話很有分寸。」她用和服的袖子掩住嘴角。", "「很好。我欣賞懂得思考的年輕人。」"],
        mid: ["「是這樣啊。」", "「嗯。」"],
        bad: ["「那種事，不適合在這裡說。」", "她的表情沒有任何變化，卻讓人背脊發涼。"],
        gl: "「真是懂事的孩子。謝謝你。」", gn: "「謝謝。」", gb: "「……心意，我收下了。」",
        dy: "「……只是吃頓飯而已，對吧？」", dn: "「今天還有會議。」",
        cy: "「我……已經不年輕了喔。……可是，既然你這麼說，就讓我任性一次吧。」", cn: "「你應該把這份心意，留給更適合的人。」",
        lover: ["「在雪奈面前……要保密喔。」", "「和你在一起，好像回到了二十歲。」"],
        jealous: "「我這把年紀，不想再為誰心碎了。」",
        end: { lover: "「下次……來家裡吃飯吧。我會想辦法跟雪奈說的。」", high: "「你是個值得信賴的人。」", mid: "「請繼續和雪奈好好相處。」", low: "「失禮了。」" }
      }
    },
    {
      id: "yoko", group: "parent", age: 42,
      name: { zh: "日向 陽子", ja: "日向 陽子" }, title: { zh: "小夏的媽媽・咖啡廳老闆娘", ja: "小夏の母・カフェのママ" },
      intro: "小夏的媽媽，在校門旁經營咖啡廳「陽光」。爽朗愛笑、廚藝一流，是學生們的「大家的媽媽」。離婚後一個人把小夏養大。",
      topics: { like: ["food", "family", "love"], bad: ["study", "art"] },
      gifts: { like: ["cake", "flower", "wagashi"], bad: ["game", "figure"] },
      dates: { like: ["karaoke", "beach", "nightview"], bad: ["museum", "library"] }, moment: "funny",
      spots: ["cafe", "cafe", "cafe", "plaza"],
      look: { hair: 0xb8662e, style: "bun", skin: 0xf0cdb0, top: 0xfff4e0, bottom: 0xd77a4a, outfit: "apron", ribbon: 0xffb347, h: 0.98, glasses: false },
      quests: [
        { at: 25, title: "店裡忙不過來", desc: "「哎呀，今天客人好多！你來幫阿姨端一下盤子好不好？」", req: { type: "loc", loc: "cafe" }, done: "「你很能幹嘛！來，這是阿姨請你的特製蛋包飯！」", reward: { aff: 12, money: 800, stamina: 10 } },
        { at: 50, title: "新菜單試吃", desc: "「我想推新的甜點，但小夏只會說『好吃』！你來給點意見吧？」", req: { type: "stat", stat: "charm", min: 35 }, done: "「嗯嗯！你說得很有道理！就叫它『初戀布丁』好了！」她對你眨了眨眼。", reward: { aff: 15 } },
        { at: 75, title: "女兒與我", desc: "「小夏常常提到你喔……你跟那孩子，是什麼關係呢？」", req: { type: "heroine", id: "konatsu", min: 40 }, done: "「是嗎……那孩子交到好朋友了。」她摸摸你的頭：「你也要常來喔，不只是為了她。」", reward: { aff: 15, heroine: { id: "konatsu", aff: 5 } } }
      ],
      confess: { charm: 55 }, jealousy: 0.5, inviteMin: 45,
      lines: {
        greet: "「歡迎光臨～哎呀，生面孔！是小夏的同學嗎？來來來，今天的蛋糕阿姨請你！」",
        hi: ["「哎呀，你來啦～」", "「今天想吃什麼？阿姨給你算便宜一點。」", "「有沒有好好吃飯呀？」"],
        like: ["「對吧對吧！阿姨就知道你懂！」", "「哈哈哈，你這孩子真會說話！」"],
        mid: ["「嗯嗯～」她一邊沖咖啡一邊聽。", "「這樣啊～」"],
        bad: ["「哎呀，那種難懂的東西阿姨不行啦～」", "「好啦好啦，先吃蛋糕吧。」"],
        gl: "「哎呀！這麼貼心！阿姨要哭了啦！」", gn: "「謝謝你呀～」", gb: "「這個……是給小夏的嗎？」",
        dy: "「哎呀，約阿姨出去？好呀好呀！」", dn: "「今天店裡走不開啦～」",
        cy: "「你……你是說真的？阿姨可是比你大二十歲喔？……哎呀，真是的，害我心跳好快。」", cn: "「哈哈，謝謝你，阿姨很開心。不過啊，你還年輕。」",
        lover: ["「今天打烊後……留下來陪我收拾好嗎？」", "「在小夏面前，要裝得自然一點喔。」"],
        jealous: "「我還以為，這把年紀不會再嘗到這種滋味了……」",
        end: { lover: "「暑假，我們三個人一起去旅行吧？……該怎麼跟小夏說呢。」", high: "「你就像我另一個孩子一樣。」", mid: "「下次來店裡，阿姨請你喝咖啡！」", low: "「歡迎光臨～」" }
      }
    }
  ];
  var HEROINE_BY_ID = {};
  HEROINES.forEach(function (h) { HEROINE_BY_ID[h.id] = h; });

  var GROUPS = [
    { id: "classmate", name: { zh: "同級生", ja: "同級生" } },
    { id: "senior", name: { zh: "學姐", ja: "先輩" } },
    { id: "teacher", name: { zh: "老師", ja: "先生" } },
    { id: "parent", name: { zh: "家長", ja: "保護者" } }
  ];

  // ---------------- 雙人互動（兩人在同一地點時可以一起聊天） ----------------
  // shura：兩人好感都 ≥ 60 時，會變成爭風吃醋的版本
  var PAIRS = [
    { a: "yukina", b: "saeko", text: "雪奈在母親面前格外拘謹。你自然地幫她說了幾句好話，冴子露出了意外的表情，雪奈則偷偷拉了拉你的袖子。",
      shura: "「媽媽，他是我的。」「呵呵，雪奈，妳在說什麼呢？」母女之間的空氣，凍結成了冰。" },
    { a: "konatsu", b: "yoko", text: "「媽！不要一直問他奇怪的問題啦！」「哎呀，關心女兒的朋友不行嗎？」你被母女倆夾在中間，吃了三塊蛋糕。",
      shura: "「媽，妳幹嘛一直餵他吃東西啦！」「哎呀，小夏，妳吃醋啦？」兩個人同時看向你。" },
    { a: "yukina", b: "reika", text: "學年第一和學生會長在討論期末考的範圍。你插了一句話，兩個人同時轉頭：「你也懂？」",
      shura: "「學弟，我們去學生會室。」「他要跟我去圖書館。」兩道冰冷的視線在空中交會。" },
    { a: "konatsu", b: "akane", text: "田徑社和劍道社的兩位王牌在比賽誰吃得比較多。你被抓去當裁判，結果兩個人都要你請客。",
      shura: "「學弟，今天來道場吧！」「不行！他要陪我跑步！」你被兩邊拉著手，好像要被扯成兩半。" },
    { a: "konatsu", b: "kaoru", text: "「小夏，起跑太慢了！」「是～老師！」你跟著她們一起練習，橘老師誇你有天分。",
      shura: "「小夏，妳的男朋友借我一下，我要特別指導。」「老師！不准！」" },
    { a: "kotone", b: "shiori", text: "琴音彈琴，詩織即興念詩。你在旁邊聽得入迷，兩個人相視而笑：「觀眾很滿意呢。」",
      shura: "「這首曲子是我寫給他的。」「……那首詩，也是。」琴房裡安靜得只剩下心跳聲。" },
    { a: "rion", b: "aoi", text: "莉音請雨宮老師幫她看新的穿搭，雨宮老師卻拿起筆開始畫她……和旁邊的你。",
      shura: "「老師，他是我的模特兒！」「……他是我的。」莉音和雨宮老師之間迸出了火花。" },
    { a: "mashiro", b: "kotone", text: "茉白在琴音面前意外地很自在。三個人一起聽遊戲配樂，琴音當場彈出了主旋律。",
      shura: "「琴、琴音……妳也……？」「嗯……對不起，茉白，我也是。」兩個好朋友第一次沉默了。" },
    { a: "miki", b: "yoko", text: "美紀學姐跟陽子阿姨在交換省錢食譜。你被當成試吃員，吃到撐。",
      shura: "「阿姨，他平常都是在我們學餐吃飯的喔。」「哎呀，可是他說我的蛋包飯最好吃耶～」" },
    { a: "rinko", b: "rena", text: "柊老師和七瀨醫師是大學同學。「凜子，妳又熬夜了吧？」「……要妳管。」你第一次看到鬼柊被念到說不出話。",
      shura: "「凜子，他是學生喔。」「……玲奈，妳自己還不是。」兩位大人之間的空氣，比期末考還緊張。" },
    { a: "reika", b: "rinko", text: "學生會長和柊老師在討論學校的預算。你提了一個意見，兩個人都看了你一眼，然後點了點頭。",
      shura: "「柊老師，他是學生會的人。」「神宮寺，他是我的導生。」" },
    { a: "akane", b: "kaoru", text: "劍道主將和前國手在比腕力。你被抓來當見證人，兩個人都說對方作弊。",
      shura: "「學弟是我的！」「臭小子是我的學生！」你覺得自己的手腕要被折斷了。" },
    { a: "shiori", b: "aoi", text: "詩織寫字，雨宮老師畫畫，你坐在櫻花樹下被兩個人當成素材。",
      shura: "「他是我故事的主角。」「……他是我畫的主題。」櫻花瓣在你們之間緩緩飄落。" },
    { a: "mashiro", b: "rion", text: "莉音硬要幫茉白化妝。茉白快哭了，結果意外地超可愛，你看呆了。",
      shura: "「欸，你剛剛是不是一直在看茉白？」「我、我沒有……！」" }
  ];

  // ---------------- 每天迷上你的女生（搭訕） ----------------
  var ADMIRER_SURNAMES = ["佐藤", "鈴木", "高橋", "田中", "伊藤", "渡邊", "山本", "中村", "小林", "加藤", "吉田", "山田", "松本", "井上", "木村", "清水", "山崎", "森", "池田", "橋本", "阿部", "石川", "前田", "藤田", "小川", "岡田", "後藤", "長谷川", "村上", "近藤", "坂本", "遠藤", "青木", "西村", "福田", "太田", "三浦", "藤井", "岡本", "松田"];
  var ADMIRER_GIVEN = ["美咲", "陽菜", "結衣", "葵", "凜", "芽依", "楓", "花音", "美月", "莉子", "心春", "彩", "優奈", "七海", "千尋", "真央", "結菜", "杏", "舞", "遙", "愛", "紗希", "美羽", "櫻", "詩音", "未來", "澪", "桃花", "雛", "柚子", "瑠璃", "朱里", "萌", "奏", "唯", "光", "茜", "鈴", "日和", "環"];
  var ADMIRER_ROLES = ["大一學妹", "大二學妹", "隔壁系的同學", "他校的女生", "籃球社經理", "便利商店店員", "網紅", "圖書館志工", "交換留學生", "啦啦隊隊長", "學生會幹部", "管樂社的學妹", "研究生學姐", "咖啡廳常客", "熱舞社社員"];
  var ADMIRER_LOOKS = [0x2a1e1a, 0x5a3b26, 0x9a5b3a, 0xd9b26a, 0x1c1d2b, 0xb05a7a, 0x6a4a8a, 0xc0c0c8];
  // 搭訕方式：opts 的 eff 會套在玩家身上；fans 粉絲數、flirt 今天跟別人曖昧的次數（女友會吃醋）
  // 第一個選項＝回應她（提升魅力），最後一個＝無視
  var APPROACHES = [
    { id: "letter", icon: "💌", text: "鞋櫃裡放了一封粉紅色的情書：「從開學典禮那天就一直看著你……」",
      opts: [
        { label: "回一封溫柔的信", eff: { charm: 1, stamina: -2 }, fans: 1, flirt: 1, res: "你寫了一封回信。隔天聽說她抱著信在走廊上尖叫。" },
        { label: "禮貌地拒絕", eff: { rep: 1 }, res: "你當面道謝並拒絕了她。她紅著眼睛說：「謝謝你認真回覆我。」" },
        { label: "無視", eff: {}, res: "你把信收進書包，沒有回應。" }
      ] },
    { id: "bento", icon: "🍱", text: "她紅著臉遞出一個愛心便當：「做、做太多了……要吃嗎？」",
      opts: [
        { label: "開心地收下吃光", eff: { stamina: 6, charm: 1 }, fans: 1, flirt: 1, res: "便當超好吃。她看著空掉的便當盒，笑得比太陽還燦爛。" },
        { label: "婉拒她的好意", eff: { rep: 1 }, res: "「這樣啊……」她抱著便當跑走了。" },
        { label: "無視", eff: { rep: -1 }, res: "你假裝沒聽見走掉了。背後傳來小小的抽泣聲。" }
      ] },
    { id: "confess", icon: "💘", text: "她在走廊上攔住你，鼓起勇氣大聲說：「我、我喜歡你！請跟我交往！」",
      opts: [
        { label: "「先從朋友開始吧」", eff: { charm: 2, stamina: -3 }, fans: 1, flirt: 2, res: "她破涕為笑：「嗯！我會努力讓你喜歡上我的！」走廊上響起掌聲。" },
        { label: "溫柔地拒絕", eff: { rep: 2, charm: 1 }, res: "「……謝謝你，好好地拒絕我。」她深深鞠了一躬，轉身時是笑著的。" },
        { label: "無視走開", eff: { rep: -2 }, res: "你一句話也沒說就走了。論壇上開始有人說你很冷漠。" }
      ] },
    { id: "contact", icon: "📱", text: "她拿著手機在你面前晃：「那個……可以交換 LINE 嗎？」",
      opts: [
        { label: "交換聯絡方式", eff: { charm: 1 }, fans: 1, flirt: 1, contact: true, res: "當天晚上收到了 47 則貼圖。" },
        { label: "「抱歉，我不太用」", eff: {}, res: "「啊，這樣啊……」她默默收起手機。" },
        { label: "無視", eff: {}, res: "你戴上耳機走過去了。" }
      ] },
    { id: "gift", icon: "🎁", text: "她塞給你一個包裝精美的盒子：「這、這是給你的！不用回禮！」",
      opts: [
        { label: "收下並道謝", eff: { charm: 1, rep: -1 }, money: [800, 2500], fans: 1, flirt: 1, res: "盒子裡是名牌錢包。你覺得收得有點心虛。" },
        { label: "婉拒太貴重的禮物", eff: { rep: 2 }, res: "「你果然是個好人……」她更喜歡你了，但禮物收回去了。" },
        { label: "無視", eff: {}, res: "盒子被留在你的桌上，你沒有打開。" }
      ] },
    { id: "photo", icon: "📸", text: "她跟三個朋友圍過來：「可以跟我們合照嗎？要放 IG！」",
      opts: [
        { label: "露出營業用笑容合照", eff: { charm: 1, rep: 1, stamina: -2 }, fans: 2, flirt: 1, res: "照片當天被分享了 300 次。你在校內小有名氣了。" },
        { label: "「我不太上鏡……」", eff: {}, res: "她們失望地散開了。" },
        { label: "無視", eff: { rep: -1 }, res: "你快步走開，背後傳來「好跩喔」的聲音。" }
      ] },
    { id: "hangout", icon: "🍦", text: "她雙手合十：「放學後……可以陪我去吃冰嗎？一下下就好！」",
      opts: [
        { label: "陪她去（自由時間 −2）", eff: { charm: 2, stamina: -4, money: -600 }, fans: 1, flirt: 2, ap: -2, res: "你們聊了一個下午。她說這是她大學生活最棒的一天。" },
        { label: "「今天有事，抱歉」", eff: {}, res: "「那、那下次！」她揮著手跑開了。" },
        { label: "無視", eff: { rep: -1 }, res: "她在原地站了很久。" }
      ] },
    { id: "cheer", icon: "📣", text: "一群女生拿著手作的應援扇：「我們成立了你的粉絲後援會！可以給我們簽名嗎？」",
      opts: [
        { label: "大方簽名、跟大家握手", eff: { charm: 2, rep: 1, stamina: -5, study: -1 }, fans: 3, flirt: 1, res: "後援會成員一口氣增加到二十人。你已經是校園名人了。" },
        { label: "「拜託低調一點……」", eff: { rep: 1 }, res: "她們答應低調，但後援會還是偷偷在運作。" },
        { label: "無視", eff: {}, res: "你逃走了。後援會的人說：「害羞的樣子也好帥！」" }
      ] },
    { id: "study", icon: "📝", text: "她抱著課本湊過來：「學長，這題可以教我嗎？……其實是藉口啦。」",
      opts: [
        { label: "耐心地教她", eff: { study: 1, charm: 1, stamina: -3 }, fans: 1, flirt: 1, res: "她說她聽懂了，但眼睛一直盯著你的臉。" },
        { label: "「建議你去問教授喔」", eff: {}, res: "「嗚……好啦。」" },
        { label: "無視", eff: {}, res: "你假裝在講電話。" }
      ] }
  ];
  // 再次出現的迷妹（之前被無視或曖昧過）
  var RETURN_TEXT = {
    ignored: "「又、又是我……上次你沒有理我，可是我還是放不下。」",
    fan: "「學長～！今天也是我喔！」她已經是你的忠實粉絲了。"
  };

  // ---------------- 課堂 ----------------
  var CLASS_OPTS = [
    { id: "focus", icon: "✍️", name: { zh: "認真聽講", ja: "真面目に受ける" }, eff: { study: 2.5, stamina: -8 }, att: true, teacher: 1, note: "學業 +2.5、體力 −8" },
    { id: "normal", icon: "📘", name: { zh: "普通上課", ja: "普通に受ける" }, eff: { study: 1.5, stamina: -4 }, att: true, note: "學業 +1.5、體力 −4" },
    { id: "doze", icon: "😴", name: { zh: "打瞌睡", ja: "居眠り" }, eff: { study: 0.5, stamina: 6 }, att: true, teacher: -1, note: "體力 +6、學業幾乎沒進步" },
    { id: "skip", icon: "🏃", name: { zh: "蹺課去校園晃晃", ja: "サボって散策" }, eff: { rep: -1 }, att: false, ap: 2, note: "自由時間 +2、不算出席、風評 −1" }
  ];

  // ---------------- 晚上 ----------------
  var EVENING_OPTS = [
    { id: "study", icon: "📚", name: { zh: "在家讀書", ja: "家で勉強" }, eff: { study: 4, stamina: -8 }, note: "學業 +4" },
    { id: "work", icon: "💼", name: { zh: "去打工", ja: "バイト" }, eff: { money: 2500, stamina: -12 }, note: "¥2,500" },
    { id: "groom", icon: "💇", name: { zh: "逛街打扮", ja: "おしゃれ" }, eff: { charm: 3, money: -1500 }, note: "魅力 +3、¥1,500" },
    { id: "gym", icon: "🏋", name: { zh: "上健身房", ja: "ジム" }, eff: { charm: 2, stamina: -6 }, note: "魅力 +2" },
    { id: "message", icon: "💬", name: { zh: "傳訊息給她", ja: "メッセージを送る" }, eff: {}, note: "選一位好感 20 以上的對象，好感 +3" },
    { id: "rest", icon: "🛌", name: { zh: "早點睡", ja: "早く寝る" }, eff: { stamina: 18 }, note: "體力 +18" }
  ];

  // ---------------- 稱號（報告用，由上往下第一個符合的） ----------------
  var TITLES = [
    { id: "legend", name: "傳說中的萬人迷", cond: function (r) { return r.lovers >= 4 && r.rep >= 0; }, comment: "同時被這麼多人愛著，還能讓大家都笑著——這已經不是運氣，是一種才能。" },
    { id: "harem", name: "後宮之王", cond: function (r) { return r.lovers >= 3 && r.rep >= -20; }, comment: "你的行程表比教授還滿。下學期請記得保重身體。" },
    { id: "sea", name: "海王", cond: function (r) { return r.lovers >= 2 && r.rep < -20; }, comment: "魚塘很大，但校園論壇上關於你的討論串也很長。" },
    { id: "idol", name: "校園偶像", cond: function (r) { return r.fans >= 150; }, comment: "後援會的人數已經超過大部分的社團了。" },
    { id: "pure", name: "純愛之人", cond: function (r) { return r.lovers === 1 && r.maxAff >= 95; }, comment: "一心一意地只看著一個人。這個學期最美的故事，就是你們。" },
    { id: "lover", name: "幸福的戀人", cond: function (r) { return r.lovers >= 1; }, comment: "轉學第一個學期就找到了重要的人，恭喜。" },
    { id: "scholar", name: "孤高的學霸", cond: function (r) { return r.grade >= 85 && r.maxAff < 60; }, comment: "成績無可挑剔。不過，大學生活不只有考試喔。" },
    { id: "friend", name: "大家的好朋友", cond: function (r) { return r.friends >= 6; }, comment: "誰都喜歡你，但誰都還沒成為你的特別。" },
    { id: "cold", name: "冰山轉學生", cond: function (r) { return r.ignored >= 40; }, comment: "無視了那麼多告白……你的心門，到底什麼時候才會打開？" },
    { id: "air", name: "空氣", cond: function () { return true; }, comment: "這個學期你好像……沒怎麼被注意到。下學期再加油吧。" }
  ];

  window.PriTestWanrenData = {
    L: L,
    LOCATIONS: LOCATIONS, LOC_BY_ID: LOC_BY_ID,
    TOPICS: TOPICS, TOPIC_BY_ID: TOPIC_BY_ID,
    ITEMS: ITEMS, ITEM_BY_ID: ITEM_BY_ID,
    DATE_SPOTS: DATE_SPOTS, DATE_BY_ID: DATE_BY_ID, DATE_MOMENTS: DATE_MOMENTS,
    HEROINES: HEROINES, HEROINE_BY_ID: HEROINE_BY_ID, GROUPS: GROUPS,
    PAIRS: PAIRS,
    ADMIRER_SURNAMES: ADMIRER_SURNAMES, ADMIRER_GIVEN: ADMIRER_GIVEN, ADMIRER_ROLES: ADMIRER_ROLES, ADMIRER_LOOKS: ADMIRER_LOOKS,
    APPROACHES: APPROACHES, RETURN_TEXT: RETURN_TEXT,
    CLASS_OPTS: CLASS_OPTS, EVENING_OPTS: EVENING_OPTS,
    TITLES: TITLES
  };
})();
