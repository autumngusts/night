// 萬人迷（wanren）：2026-11-05 遊戲性擴充的資料（使用者選定 1、2、3、6、7，並「再增加更多玩法」）。
//   1 迷妹轉正：模板（個性、任務、劇情、台詞），由 wanren_core.js 依迷妹的名字與身分產生角色
//   2 照片圖鑑：成就（收集進度記在 meta，規則在 core）
//   3 剪影尋人：成就
//   6 傳聞網路：成就（交友圈由社團、雙人互動、母女關係推出來，規則在 core）
//   7 房間與穿搭：服裝 4 套、家具 8 種
//   追加：約會拍立得、校園 SNS 發文
// 只放資料；規則（何時觸發、加多少好感）都在 wanren_core.js。
// 載入順序：wanren_data5.js → 本檔 → wanren_core.js。
(function () {
  "use strict";

  var D = window.PriTestWanrenData;
  if (!D || !D.CAST_KIT) return;
  var K = D.CAST_KIT;

  // ---------------- 1. 迷妹轉正 ----------------
  D.GROUPS.push({ id: "fanclub", name: { zh: "轉正的迷妹", ja: "ファンから昇格" } });
  K.ADDRESS.fanclub = "你";
  // 轉正的迷妹可能的個性（依名字決定）
  var FAN_PERSONAS = ["shy", "gentle", "genki", "airhead", "otaku", "tsun", "glutton", "playful"];
  // 身分 → 常出沒的地點、年齡
  var ROLE_INFO = {
    "大一學妹": { sp: "garden plaza cafeteria", age: 18 }, "大二學妹": { sp: "plaza library cafe", age: 19 },
    "隔壁系的同學": { sp: "classroom cafeteria plaza", age: 19 }, "他校的女生": { sp: "gate cafe plaza", age: 19 },
    "籃球社經理": { sp: "gym field", age: 19 }, "便利商店店員": { sp: "gate cafeteria", age: 20 },
    "網紅": { sp: "plaza cafe garden", age: 20 }, "圖書館志工": { sp: "library classroom", age: 19 },
    "交換留學生": { sp: "classroom garden cafe", age: 20 }, "啦啦隊隊長": { sp: "field gym", age: 20 },
    "學生會幹部": { sp: "classroom club", age: 20 }, "管樂社的學妹": { sp: "club garden", age: 18 },
    "研究生學姐": { sp: "library infirmary cafe", age: 23 }, "咖啡廳常客": { sp: "cafe garden", age: 20 },
    "熱舞社社員": { sp: "club plaza gym", age: 19 }
  };
  var FAN_TOPICS = ["study", "sports", "music", "food", "fashion", "games", "books", "love", "art", "money", "family", "gossip"];
  var FAN_GIFTS = ["choco", "drink", "towel", "cake", "coupon", "book", "sheet", "sketch", "flower", "tea", "wagashi", "plush", "pen", "accessory", "perfume", "figure", "game"];
  var FAN_DATES = ["library", "nightview", "beach", "karaoke", "movie", "museum", "park", "dinner"];
  var FAN_OUTFITS = ["casual", "cardigan", "blazer", "casual"];
  var FAN_TOPS = [0xf4a6c0, 0xa6c8f4, 0xffffff, 0xf0d070, 0xb0e0c0, 0x2a3358, 0xd0b0f0];
  // 任務模板：{l} 她常去的地點、{g} 她喜歡的禮物
  var FAN_QUESTS = [
    [25, "正式的第一次見面", "「那個……可以在{l}見面嗎？我想好好地、正式地跟你說話。」", "loc", "她遞給你一封很長的信，說完「請、請之後再看！」就跑走了。信的第一行寫著：「從那天早上鼓起勇氣跟你搭話開始……」", { aff: 12 }],
    [50, "她一直想要的東西", "「我最近一直很想要{g}……啊！我、我不是在暗示什麼喔！」", "item", "她抱著禮物愣了好久：「……原來你有記得我說過的話。」", { aff: 15, charm: 1 }],
    [75, "不只是粉絲", "「大家都說我只是你眾多迷妹之一……你能讓大家知道，我不一樣嗎？」（風評 15 以上）", "stat:rep:15", "你在大家面前牽起她的手。她紅著臉說：「……我會記住今天的。一輩子。」", { aff: 18, rep: 2 }]
  ];
  var FAN_STORY = [
    "{n}把你們第一次見面那天的照片設成了手機桌布。被朋友發現後，她慌張地說：「這、這是紀念！不是那個意思！」……然後偷偷看了你一眼。",
    "{n}說她一直很怕自己只是「很多人之一」。你陪她走了很長一段路。分開前她說：「謝謝你，讓我從粉絲變成了你身邊的人。」"
  ];
  var FAN_LINES = {
    greet: "「我、我是之前在早上跟你搭話的{n}！……你還記得我嗎？」",
    cy: "「我從第一天就……一直一直喜歡你！現在，終於能站在你身邊說出口了。」",
    jl: "「我才不要回去當粉絲呢。」",
    el: "「我是你的第一號粉絲，也是你的女朋友。這兩個，我都不會讓給別人。」"
  };
  D.FAN_KIT = {
    PERSONAS: FAN_PERSONAS, ROLE_INFO: ROLE_INFO, TOPICS: FAN_TOPICS, GIFTS: FAN_GIFTS, DATES: FAN_DATES,
    OUTFITS: FAN_OUTFITS, TOPS: FAN_TOPS, QUESTS: FAN_QUESTS, STORY: FAN_STORY, LINES: FAN_LINES,
    MAX: 8,          // 一輪最多轉正幾位
    NEED: { trial: 2, year: 3, full: 3 }   // 💗 回應幾次後會提出「想正式認識你」
  };

  // ---------------- 7. 穿搭與房間 ----------------
  // spots：穿這套去這些約會地點，約會好感 +4
  D.OUTFITS = [
    { id: "casual", icon: "👕", name: { zh: "休閒穿搭", ja: "カジュアル" }, price: 0, spots: ["library", "nightview"], note: "圖書館、夜景約會加分" },
    { id: "street", icon: "🧢", name: { zh: "街頭潮流", ja: "ストリート" }, price: 5000, spots: ["karaoke", "movie"], note: "KTV、電影約會加分；早上多 1 位迷妹的機率" },
    { id: "sporty", icon: "🏃", name: { zh: "清爽運動風", ja: "スポーティ" }, price: 4000, spots: ["beach", "park"], note: "海邊、遊樂園約會加分" },
    { id: "formal", icon: "🤵", name: { zh: "正式西裝", ja: "フォーマル" }, price: 8000, spots: ["dinner", "museum"], note: "晚餐、美術館約會加分；告白成功率 +5%" }
  ];
  D.OUTFIT_BY_ID = {};
  D.OUTFITS.forEach(function (o) { D.OUTFIT_BY_ID[o.id] = o; });
  // comfort：房間舒適度（約會後邀她來坐坐的條件與加成）
  D.FURNITURE = [
    { id: "plant", icon: "🪴", name: { zh: "觀葉植物", ja: "観葉植物" }, price: 1500, comfort: 1, note: "舒適度 +1" },
    { id: "aroma", icon: "🕯", name: { zh: "香氛蠟燭", ja: "アロマキャンドル" }, price: 2000, comfort: 1, note: "舒適度 +1" },
    { id: "lamp", icon: "💡", name: { zh: "書桌檯燈", ja: "デスクライト" }, price: 3000, comfort: 0, note: "「在家讀書」學業 +2" },
    { id: "mirror", icon: "🪞", name: { zh: "全身鏡", ja: "姿見" }, price: 3500, comfort: 0, note: "「逛街打扮」魅力 +1" },
    { id: "speaker", icon: "🔊", name: { zh: "藍牙音響", ja: "スピーカー" }, price: 4500, comfort: 1, note: "練樂器 ×1.3、舒適度 +1" },
    { id: "bed", icon: "🛏", name: { zh: "好睡的床墊", ja: "いいマットレス" }, price: 5000, comfort: 1, note: "睡覺體力 +8、舒適度 +1" },
    { id: "kitchen", icon: "🍳", name: { zh: "小廚房組", ja: "ミニキッチン" }, price: 6000, comfort: 1, note: "練習做菜 ×1.3、舒適度 +1" },
    { id: "sofa", icon: "🛋", name: { zh: "雙人沙發", ja: "二人掛けソファ" }, price: 8000, comfort: 2, note: "舒適度 +2" }
  ];
  D.FURNITURE_BY_ID = {};
  D.FURNITURE.forEach(function (f) { D.FURNITURE_BY_ID[f.id] = f; });
  D.ROOM_VISIT = {
    need: 3,   // 舒適度 3 以上，約會很順利時她會想來你的房間坐坐
    text: ["她在你的沙發上坐下，東看西看：「……比想像中整齊耶。」", "你泡了茶。她捧著杯子，安靜地看著窗外的夜景。", "她發現了你書架上的相簿，一頁一頁地翻：「這張是我嗎？……什麼時候拍的！」"]
  };

  // ---------------- 追加：校園 SNS ----------------
  // f：基本追蹤數；need：條件（lover＝要有女友、club＝要有社團）
  D.SNS_POSTS = [
    { id: "selfie", icon: "🤳", name: { zh: "帥氣自拍", ja: "自撮り" }, f: 14, note: "追蹤 ↑↑、粉絲 +1〜3；迷妹會留言（曖昧 +1）" },
    { id: "food", icon: "🍜", name: { zh: "美食打卡", ja: "グルメ投稿" }, f: 8, note: "廚藝 20 以上加倍；喜歡美食的人好感 +1" },
    { id: "study", icon: "📖", name: { zh: "讀書日常", ja: "勉強の記録" }, f: 5, note: "學業 +1、風評 +1" },
    { id: "club", icon: "🎪", name: { zh: "社團活動", ja: "サークル活動" }, f: 9, need: "club", note: "認識的社員好感 +1" },
    { id: "lover", icon: "💑", name: { zh: "和她的合照", ja: "ツーショット" }, f: 22, need: "lover", note: "她好感 +5；其他女友會吃醋；腳踏多條船時可能炎上" }
  ];
  D.SNS_STEPS = [100, 500, 1000, 3000];
  // 晚上的選項：「早點睡」之前插入「發文到 SNS」（選了之後再選要發哪一種）
  var restIdx = D.EVENING_OPTS.map(function (o) { return o.id; }).indexOf("rest");
  D.EVENING_OPTS.splice(restIdx < 0 ? D.EVENING_OPTS.length : restIdx, 0,
    { id: "sns", icon: "📱", name: { zh: "發文到校園 SNS", ja: "学内SNSに投稿" }, eff: {}, note: "增加追蹤與粉絲；內容不同效果不同" });

  // ---------------- 成就（追加） ----------------
  D.ACHIEVEMENTS.push(
    { id: "fanUp", icon: "🌱", name: "從粉絲開始", desc: "讓一位迷妹轉正，成為可攻略角色" },
    { id: "fanLover", icon: "💝", name: "偶像與粉絲", desc: "和轉正的迷妹交往" },
    { id: "photo30", icon: "🖼", name: "相簿收藏家", desc: "照片圖鑑收集 30 張" },
    { id: "photo100", icon: "📚", name: "誰都見過", desc: "照片圖鑑收集 100 張" },
    { id: "photoAll", icon: "🌈", name: "全員集合", desc: "照片圖鑑收集全部 175 張" },
    { id: "photoFate", icon: "🔗", name: "命中注定", desc: "同一張照片的人，在兩輪不同的遊戲裡都和你交往" },
    { id: "hunt10", icon: "🔍", name: "尋人高手", desc: "完成 10 次剪影尋人" },
    { id: "rumorGood", icon: "📣", name: "好人緣", desc: "好的傳聞傳開 15 次" },
    { id: "roomFull", icon: "🏠", name: "理想的房間", desc: "買齊全部家具" },
    { id: "outfitAll", icon: "👔", name: "衣櫃達人", desc: "收集全部 4 套穿搭" },
    { id: "polaroid20", icon: "📸", name: "拍立得收藏", desc: "收集 20 張約會拍立得" },
    { id: "sns1000", icon: "📱", name: "校園網紅", desc: "SNS 追蹤人數達到 1,000" }
  );
})();
