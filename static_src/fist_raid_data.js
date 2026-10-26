// 鐵拳教育：搜打撤模式的靜態資料（物品、搜索點、撤離點、升級、數值）。設計見 docs/fist_raid_design.md。
// 地圖、老師、霸凌者、章節沿用 fist_data.js（PriTestFistData）。名稱都是 { zh, ja, en } 三語。
(function () {
  "use strict";

  function N(zh, ja, en) { return { zh: zh, ja: ja, en: en }; }

  // kind：evid 證據（val＝證據值）／sup 補給／token 權力者信物。size＝佔背包幾格
  var ITEMS = [
    { id: "note", kind: "evid", icon: "📝", size: 1, val: 1, name: N("紙條", "メモ", "Note"),
      desc: N("寫著「去死」的紙條。", "「消えろ」と書かれたメモ。", "A note that says \"disappear\".") },
    { id: "photo", kind: "evid", icon: "📷", size: 1, val: 2, name: N("照片", "写真", "Photo"),
      desc: N("霸凌現場的照片。", "いじめ現場の写真。", "A photo of the bullying.") },
    { id: "chat", kind: "evid", icon: "💬", size: 1, val: 3, name: N("聊天截圖", "チャットのスクショ", "Chat screenshot"),
      desc: N("群組裡的辱罵紀錄。", "グループチャットでの罵倒の記録。", "Abuse in the group chat.") },
    { id: "rec", kind: "evid", icon: "🎙️", size: 1, val: 4, name: N("錄音檔", "録音データ", "Recording"),
      desc: N("錄下了威脅的聲音。", "脅しの声が録音されている。", "Threats caught on tape.") },
    { id: "diary", kind: "evid", icon: "📔", size: 2, val: 6, name: N("受害日記", "被害者の日記", "Victim's diary"),
      desc: N("一頁一頁寫滿了求救。", "助けを求める言葉がページを埋めている。", "Page after page of pleas for help.") },
    { id: "report", kind: "evid", icon: "📁", size: 2, val: 9, name: N("被壓下的報告書", "揉み消された報告書", "Buried report"),
      desc: N("從沒送出校門的霸凌報告。", "一度も校門の外に出なかったいじめ報告書。", "A bullying report that never left the school.") },
    { id: "ledger", kind: "evid", icon: "💰", size: 2, val: 14, name: N("封口費帳本", "口止め料の帳簿", "Hush-money ledger"),
      desc: N("誰拿了多少錢、閉上了嘴。", "誰がいくら受け取り、口を閉ざしたか。", "Who got paid, and how much, to stay quiet.") },
    { id: "testimony", kind: "evid", icon: "🗣️", size: 1, val: 6, noBag: true, name: N("證詞", "証言", "Testimony"),
      desc: N("被救出的學生願意說出真相。", "救い出された生徒が真実を語ってくれる。", "A rescued student is willing to speak up.") },
    { id: "bandage", kind: "sup", icon: "🩹", size: 1, name: N("OK 繃", "絆創膏", "Bandage"),
      desc: N("體力 +3。", "体力 +3。", "+3 stamina.") },
    { id: "onigiri", kind: "sup", icon: "🍙", size: 1, name: N("飯糰", "おにぎり", "Rice ball"),
      desc: N("體力 +6。", "体力 +6。", "+6 stamina.") },
    { id: "drink", kind: "sup", icon: "🥤", size: 1, name: N("運動飲料", "スポーツドリンク", "Sports drink"),
      desc: N("熱血 +2、體力 +1。", "熱血 +2、体力 +1。", "+2 passion, +1 stamina.") },
    { id: "alarm", kind: "sup", icon: "🔔", size: 1, name: N("防身警報器", "防犯ブザー", "Safety alarm"),
      desc: N("所在格的霸凌者暈 5 秒，察覺度 +5。", "同じマスのいじめっ子が 5 秒気絶、察知度 +5。", "Bullies here are dazed 5s. Alert +5.") },
    { id: "crown", kind: "token", icon: "👑", size: 1, boss: "queen", name: N("女王的王冠", "女王の王冠", "Queen's crown"),
      desc: N("帶出校園，第一章就結束了。", "校外へ持ち出せば第一章は終わる。", "Get it out of the school to finish Chapter 1.") },
    { id: "bat", kind: "token", icon: "🏏", size: 1, boss: "captain", name: N("隊長的球棒", "キャプテンのバット", "Captain's bat"),
      desc: N("帶出校園，第二章就結束了。", "校外へ持ち出せば第二章は終わる。", "Get it out of the school to finish Chapter 2.") },
    { id: "seal", kind: "token", icon: "🔏", size: 1, boss: "chairman", name: N("理事長印章", "理事長の印鑑", "Chairman's seal"),
      desc: N("帶出校園，權力之牆就倒了。", "校外へ持ち出せば、権力の壁は崩れる。", "Get it out of the school and the wall of power falls.") }
  ];
  var ITEM = {};
  ITEMS.forEach(function (it) { ITEM[it.id] = it; });

  ITEMS.push(
    { id: "key_roof", kind: "key", icon: "🗝️", size: 1, zone: "roof", name: N("頂樓鑰匙", "屋上の鍵", "Roof key"),
      desc: N("帶出校園後，之後每局都能上頂樓。", "持ち帰れば、以後は毎回屋上に行ける。", "Get it out and the roof opens on every raid.") },
    { id: "key_old", kind: "key", icon: "🔑", size: 1, zone: "old", name: N("舊校舍鑰匙", "旧校舎の鍵", "Old building key"),
      desc: N("帶出校園後，之後每局都能進舊校舍。", "持ち帰れば、以後は毎回旧校舎に入れる。", "Get it out and the old building opens on every raid.") },
    { id: "mm_phone", kind: "evid", icon: "📱", size: 1, val: 15, name: N("主謀的手機", "主犯のスマホ", "Mastermind's phone"),
      desc: N("所有指示都在這支手機裡。", "すべての指示はこのスマホの中にある。", "Every order was sent from this phone.") }
  );
  ITEMS.forEach(function (it) { ITEM[it.id] = it; });

  var BOSS_TOKEN = { queen: "crown", captain: "bat", chairman: "seal" };

  // ---------------- 校園地圖（搜打撤專用；經典模式仍用 fist_data.js 的 7×5） ----------------
  // 區域：每區是一張小格子圖；LINKS 把不同區域（或同區不相鄰）的地點接起來（樓梯、門）。
  // lock：要先把對應的鑰匙帶出校園才會開放。
  var ZONES = [
    { id: "main1", cols: 5, rows: 2, name: N("本館 1F", "本館 1F", "Main bldg 1F") },
    { id: "main2", cols: 5, rows: 2, name: N("本館 2F", "本館 2F", "Main bldg 2F") },
    { id: "main3", cols: 5, rows: 2, name: N("本館 3F", "本館 3F", "Main bldg 3F") },
    { id: "roof", cols: 3, rows: 2, lock: "key_roof", name: N("頂樓", "屋上", "Rooftop") },
    { id: "yard", cols: 5, rows: 2, name: N("操場・校門", "校庭・校門", "Grounds & gate") },
    { id: "gym", cols: 4, rows: 2, name: N("體育館區", "体育館エリア", "Gym area") },
    { id: "old", cols: 4, rows: 2, lock: "key_old", name: N("舊校舍", "旧校舎", "Old building") }
  ];
  // [id, 區域, x, y, 種類, 美術, 名稱]。種類決定搜索點與事件；美術決定 fist_raid_art.js 畫哪一張
  var TILE_DEFS = [
    ["wc1", "main1", 0, 0, "blind", "wc", N("1F 廁所", "1F トイレ", "1F restroom")],
    ["hall1w", "main1", 1, 0, "path", "hall", N("1F 西走廊", "1F 西廊下", "1F west hall")],
    ["lobby", "main1", 2, 0, "path", "lobby", N("穿堂", "昇降口", "Entrance hall")],
    ["hall1e", "main1", 3, 0, "path", "hall", N("1F 東走廊", "1F 東廊下", "1F east hall")],
    ["stair1", "main1", 4, 0, "stairs", "stairs", N("樓梯 1F", "階段 1F", "Stairs 1F")],
    ["office", "main1", 0, 1, "office", "office", N("教師辦公室", "職員室", "Staff room")],
    ["nurse", "main1", 1, 1, "nurse", "nurse", N("保健室", "保健室", "Infirmary")],
    ["counsel", "main1", 2, 1, "class", "counsel", N("輔導室", "相談室", "Counseling room")],
    ["store", "main1", 3, 1, "path", "store", N("福利社", "購買部", "School store")],
    ["archive", "main1", 4, 1, "blind", "archive", N("檔案室", "資料室", "Archive")],

    ["c2a", "main2", 0, 0, "class", "classroom", N("2年A班", "2年A組", "Class 2-A")],
    ["c2b", "main2", 1, 0, "class", "classroom", N("2年B班", "2年B組", "Class 2-B")],
    ["hall2", "main2", 2, 0, "path", "hall", N("2F 走廊", "2F 廊下", "2F hall")],
    ["lab", "main2", 3, 0, "class", "lab", N("理化教室", "理科室", "Science lab")],
    ["stair2", "main2", 4, 0, "stairs", "stairs", N("樓梯 2F", "階段 2F", "Stairs 2F")],
    ["wc2", "main2", 0, 1, "blind", "wc", N("2F 廁所", "2F トイレ", "2F restroom")],
    ["c2c", "main2", 1, 1, "class", "classroom", N("2年C班", "2年C組", "Class 2-C")],
    ["hall2e", "main2", 2, 1, "path", "hall", N("2F 東走廊", "2F 東廊下", "2F east hall")],
    ["prep", "main2", 3, 1, "blind", "archive", N("理化準備室", "理科準備室", "Lab prep room")],
    ["study", "main2", 4, 1, "class", "classroom", N("自習室", "自習室", "Study hall")],

    ["c3c", "main3", 0, 0, "class", "classroom", N("3年C班", "3年C組", "Class 3-C")],
    ["c3d", "main3", 1, 0, "class", "classroom", N("3年D班", "3年D組", "Class 3-D")],
    ["hall3", "main3", 2, 0, "path", "hall", N("3F 走廊", "3F 廊下", "3F hall")],
    ["music", "main3", 3, 0, "class", "music", N("音樂教室", "音楽室", "Music room")],
    ["stair3", "main3", 4, 0, "stairs", "stairs", N("樓梯 3F", "階段 3F", "Stairs 3F")],
    ["wc3", "main3", 0, 1, "blind", "wc", N("3F 廁所", "3F トイレ", "3F restroom")],
    ["library", "main3", 1, 1, "class", "library", N("圖書館", "図書室", "Library")],
    ["broadcast", "main3", 2, 1, "broadcast", "broadcast", N("廣播室", "放送室", "Broadcast room")],
    ["principal", "main3", 3, 1, "principal", "principal", N("理事長室", "理事長室", "Chairman's office")],
    ["artroom", "main3", 4, 1, "class", "artroom", N("美術教室", "美術室", "Art room")],

    ["roofdoor", "roof", 0, 0, "path", "roof", N("頂樓出入口", "屋上の扉", "Roof door")],
    ["roof_w", "roof", 1, 0, "blind", "roof", N("西頂樓", "西屋上", "West roof")],
    ["tank", "roof", 2, 0, "blind", "tank", N("水塔旁", "給水塔の陰", "By the water tank")],
    ["roof_e", "roof", 0, 1, "blind", "roof", N("東頂樓", "東屋上", "East roof")],
    ["bench", "roof", 1, 1, "path", "roof", N("頂樓長椅", "屋上のベンチ", "Roof bench")],
    ["roof_esc", "roof", 2, 1, "path", "escape", N("逃生梯", "非常階段", "Fire escape")],

    ["gate", "yard", 0, 0, "path", "gate", N("校門", "校門", "School gate")],
    ["garden", "yard", 1, 0, "path", "garden", N("中庭", "中庭", "Courtyard")],
    ["field", "yard", 2, 0, "path", "field", N("操場", "校庭", "Field")],
    ["track", "yard", 3, 0, "path", "track", N("跑道", "トラック", "Track")],
    ["court", "yard", 4, 0, "path", "court", N("籃球場", "バスケコート", "Basketball court")],
    ["bikes", "yard", 0, 1, "blind", "bikes", N("腳踏車棚", "駐輪場", "Bike shed")],
    ["flower", "yard", 1, 1, "blind", "flower", N("花圃後面", "花壇の裏", "Behind the flowerbeds")],
    ["pool", "yard", 2, 1, "path", "pool", N("游泳池", "プール", "Pool")],
    ["poolside", "yard", 3, 1, "blind", "locker", N("泳池更衣間", "プール更衣室", "Pool changing room")],
    ["clubhouse", "yard", 4, 1, "class", "club", N("社團大樓", "部室棟", "Club building")],

    ["gym", "gym", 0, 0, "class", "gym", N("體育館", "体育館", "Gym")],
    ["locker", "gym", 1, 0, "blind", "locker", N("更衣室", "更衣室", "Locker room")],
    ["storage", "gym", 2, 0, "blind", "storage", N("器材室", "体育倉庫", "Equipment room")],
    ["dojo", "gym", 3, 0, "class", "dojo", N("柔道場", "柔道場", "Judo hall")],
    ["gym_back", "gym", 0, 1, "blind", "back", N("體育館後方", "体育館裏", "Behind the gym")],
    ["alley", "gym", 1, 1, "path", "alley", N("後門小巷", "裏門の路地", "Back alley")],
    ["incin", "gym", 2, 1, "blind", "back", N("焚化爐旁", "焼却炉の横", "By the incinerator")],
    ["oldgate", "gym", 3, 1, "path", "oldgate", N("舊校舍通道", "旧校舎への通路", "Path to old building")],

    ["oldhall", "old", 0, 0, "path", "oldhall", N("舊校舍走廊", "旧校舎の廊下", "Old hallway")],
    ["oldclass", "old", 1, 0, "blind", "oldroom", N("廢棄教室", "廃教室", "Abandoned classroom")],
    ["oldlab", "old", 2, 0, "blind", "oldroom", N("舊實驗室", "旧実験室", "Old lab")],
    ["oldclub", "old", 3, 0, "blind", "oldroom", N("舊社辦", "旧部室", "Old club room")],
    ["oldstore", "old", 0, 1, "blind", "storage", N("舊倉庫", "旧倉庫", "Old storehouse")],
    ["shrine", "old", 1, 1, "blind", "shrine", N("後山祠堂", "裏山の祠", "Hillside shrine")],
    ["hill", "old", 2, 1, "path", "hill", N("後山小徑", "裏山の小道", "Hillside path")]
  ];
  var LINKS = [["lobby", "garden"], ["stair1", "stair2"], ["stair2", "stair3"], ["stair3", "roofdoor"], ["court", "gym"],
    ["clubhouse", "dojo"], ["oldgate", "oldhall"], ["field", "gym_back"]];
  var TILES = TILE_DEFS.map(function (d) { return { id: d[0], zone: d[1], x: d[2], y: d[3], type: d[4], art: d[5], name: d[6] }; });
  var TILE = {};
  TILES.forEach(function (t) { TILE[t.id] = t; });
  var ZONE = {};
  ZONES.forEach(function (z) { ZONE[z.id] = z; });

  // 每種格子的搜索點數與抽選權重（[物品 id, 權重]）
  var SPOTS = { blind: 2, class: 2, path: 1, broadcast: 2, principal: 3, office: 0, nurse: 0, stairs: 0 };
  var LOOT = {
    blind: [["note", 22], ["photo", 18], ["chat", 16], ["rec", 9], ["diary", 9], ["bandage", 10], ["alarm", 6], [null, 30]],
    class: [["note", 24], ["photo", 14], ["chat", 18], ["rec", 6], ["diary", 6], ["bandage", 10], ["onigiri", 6], ["drink", 6], [null, 34]],
    path: [["note", 14], ["photo", 8], ["bandage", 22], ["onigiri", 16], ["drink", 16], ["alarm", 8], [null, 40]],
    broadcast: [["rec", 30], ["chat", 20], ["report", 25], ["alarm", 10], [null, 30]],
    principal: [["report", 40], ["chat", 15], ["rec", 15], ["ledger", 8], [null, 35]]
  };
  // 舊校舍比較深：證據多、好東西多
  var DEEP_LOOT = [["diary", 22], ["rec", 20], ["report", 14], ["chat", 14], ["onigiri", 8], [null, 22]];
  // 鑰匙藏在哪幾格（還沒拿到的鑰匙，每局放在其中一格的搜索點）
  var KEY_SPOTS = { key_roof: ["archive", "broadcast", "music", "prep"], key_old: ["storage", "incin", "locker", "dojo"] };
  // 打倒一般霸凌者掉落（60%）
  var DROP_RATE = 0.6;
  var DROPS = [["note", 30], ["photo", 22], ["chat", 18], ["bandage", 16], ["drink", 8], ["rec", 6]];

  var EXITS = ["gate", "bikes", "alley", "roof_esc", "hill"];

  var UPGRADES = [
    { id: "bag", icon: "🎒", costs: [6, 12, 20], name: N("大背包", "大きなリュック", "Bigger bag"), desc: N("背包 +1 格", "リュック +1 マス", "+1 bag slot") },
    { id: "hp", icon: "💪", costs: [5, 10, 16], name: N("鍛鍊", "鍛錬", "Training"), desc: N("體力上限 +2", "体力上限 +2", "+2 max stamina") },
    { id: "eye", icon: "🔍", costs: [6, 14], name: N("觀察眼", "観察眼", "Keen eye"), desc: N("搜索時間 −15%", "捜索時間 −15%", "Searching −15% time") },
    { id: "pocket", icon: "🔒", costs: [12], name: N("安全口袋", "セーフポケット", "Safe pocket"), desc: N("倒下時保住背包第 1 格", "倒れてもリュックの 1 マス目は守る", "Keep bag slot 1 if you go down") }
  ];

  // ---------------- 案件（推理支線）：學生的特徵 ----------------
  // 每個特徵的值都畫得出來（fist_raid_art.js 的頭像），線索就是這些特徵。
  var ATTRS = [
    { id: "grade", vals: [1, 2, 3], label: N("年級", "学年", "Year"),
      names: [N("1 年級（綠領帶）", "1年生（緑のネクタイ）", "1st year (green tie)"), N("2 年級（藍領帶）", "2年生（青のネクタイ）", "2nd year (blue tie)"), N("3 年級（紅領帶）", "3年生（赤のネクタイ）", "3rd year (red tie)")] },
    { id: "hair", vals: ["short", "long", "pony", "buzz", "bob", "curly"], label: N("髮型", "髪型", "Hair"),
      names: [N("短髮", "ショート", "short hair"), N("長髮", "ロング", "long hair"), N("綁馬尾", "ポニーテール", "a ponytail"), N("平頭", "坊主頭", "a buzz cut"), N("鮑伯頭", "ボブ", "a bob"), N("捲髮", "くせ毛", "curly hair")] },
    { id: "color", vals: ["black", "brown", "blond"], label: N("髮色", "髪色", "Hair color"),
      names: [N("黑髮", "黒髪", "black hair"), N("咖啡色頭髮", "茶髪", "brown hair"), N("染成金色", "金髪に染めている", "bleached blond hair")] },
    { id: "glasses", vals: [false, true], label: N("眼鏡", "眼鏡", "Glasses"),
      names: [N("沒戴眼鏡", "眼鏡なし", "no glasses"), N("戴眼鏡", "眼鏡をかけている", "glasses")] },
    { id: "acc", vals: ["none", "pin", "earring", "phones", "mask", "plaster"], label: N("配件", "アクセサリー", "Accessory"),
      names: [N("沒有配件", "飾りなし", "no accessories"), N("別著髮夾", "ヘアピン", "a hairpin"), N("戴耳環", "ピアス", "an earring"), N("掛著耳機", "ヘッドホン", "headphones"), N("戴口罩", "マスク", "a face mask"), N("臉上貼 OK 繃", "顔に絆創膏", "a bandage on the face")] },
    { id: "club", vals: ["none", "basket", "baseball", "band", "art", "kendo"], label: N("社團", "部活", "Club"),
      names: [N("回家社", "帰宅部", "no club"), N("籃球社", "バスケ部", "the basketball club"), N("棒球社", "野球部", "the baseball club"), N("熱音社", "軽音部", "the band club"), N("美術社", "美術部", "the art club"), N("劍道社", "剣道部", "the kendo club")] }
  ];
  var ATTR = {};
  ATTRS.forEach(function (a) { ATTR[a.id] = a; });
  // 社團 → 常出沒的地點
  var CLUB_HAUNTS = { none: ["store", "garden", "bikes", "library"], basket: ["court", "gym", "locker"], baseball: ["field", "storage", "gym_back"],
    band: ["music", "clubhouse", "hall3"], art: ["artroom", "flower", "library"], kendo: ["dojo", "locker", "clubhouse"] };

  // 學生名字（三語各 24 個，依編號對應同一個人）
  var NAMES = {
    zh: ["林子揚", "陳語彤", "王柏翰", "張品妍", "李冠宇", "黃思妤", "吳承恩", "蔡雅婷", "劉家豪", "楊于晴", "許哲維", "鄭欣怡",
      "謝宗翰", "郭芷涵", "洪睿哲", "邱詠晴", "曾柏宇", "廖心妍", "賴俊傑", "周芮安", "徐梓軒", "簡沛恩", "江禹辰", "葉以晴"],
    ja: ["佐藤ユウト", "鈴木ミオ", "高橋ソウタ", "田中ハルカ", "伊藤リク", "渡辺アオイ", "山本ケンタ", "中村サクラ", "小林ハヤト", "加藤ユイ", "吉田タクミ", "山田ヒナ",
      "佐々木レン", "松本ナナ", "井上カイト", "木村マコ", "林ダイキ", "清水リコ", "山崎ショウ", "森カエデ", "池田ツバサ", "橋本ノア", "阿部ユウキ", "石川ミサキ"],
    en: ["Leo Lin", "Mia Chen", "Owen Wang", "Ivy Chang", "Ryan Lee", "Zoe Huang", "Noah Wu", "Emma Tsai", "Jack Liu", "Chloe Yang", "Ethan Hsu", "Lily Cheng",
      "Max Hsieh", "Ruby Kuo", "Sam Hung", "Ella Chiu", "Ben Tseng", "Grace Liao", "Kai Lai", "Nina Chou", "Alex Hsu", "Rose Chien", "Jay Chiang", "Amy Yeh"]
  };

  window.PriTestFistRaidData = {
    ITEMS: ITEMS, ITEM: ITEM, BOSS_TOKEN: BOSS_TOKEN,
    ZONES: ZONES, ZONE: ZONE, TILES: TILES, TILE: TILE, LINKS: LINKS,
    SPOTS: SPOTS, LOOT: LOOT, DEEP_LOOT: DEEP_LOOT, KEY_SPOTS: KEY_SPOTS, DROPS: DROPS, DROP_RATE: DROP_RATE,
    EXITS: EXITS, OPEN_EXITS: 2, UPGRADES: UPGRADES,
    ATTRS: ATTRS, ATTR: ATTR, CLUB_HAUNTS: CLUB_HAUNTS, NAMES: NAMES,
    BAG: 6, STASH: 30, MAX_WITNESS: 2,
    // 時間（秒）
    STEP: 0.6, STEP_PE: 0.46, SEARCH: 4.0, PHOTO: 1.5, TALK: 2.0, CHAT: 1.4, USE: 1.0, EXTRACT: 3.0, EXPOSE: 1.5,
    SKILL_CD: 20, DASH_TIME: 6, CCTV_TIME: 8, STUN: 4, ALARM_STUN: 5, GLARE_STUN: 5,
    // 察覺度
    ALERT_RATE: 0.32, ALERT_FIGHT: 5, ALERT_COMP: 10, ALERT_SEARCH: 1, ALERT_BREAK: 8, ALERT_ALARM: 5, ALERT_WRONG: 20,
    ALERT_WARY: 40, ALERT_HIGH: 80, LOCKDOWN_TIME: 25,
    // 權力者（搜打撤裡比經典模式硬：壁 ×2、手下 3 名）
    BOSS_HP_MUL: 1, BOSS_WALL_MUL: 2, BOSS_ESCORTS: 3,
    // 霸凌者
    START_INCIDENTS: 4, START_PATROLS: 3, SPAWN_EVERY: 20, SPAWN_EVERY_WARY: 14, MAX_BULLIES: 16,
    PATROL_MIN: 1.8, PATROL_RAND: 0.8, PATROL_FAST: 0.7, VICTIM_DRAIN: 9,
    // 案件：名單人數、每局出現在校園裡的學生數、主謀出現機率、指認成功的獎勵
    CAST: 18, STUDENTS: 8, MM_CHANCE: 0.75, MM_HP: 12, SOLVE_WALL: 6, SOLVE_REP: 10, STUDENT_MOVE: 4.5
  };
})();
