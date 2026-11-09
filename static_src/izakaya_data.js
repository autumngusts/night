// 深夜居酒屋（izakaya）：靜態資料。食材、菜單、季節、星級解鎖、話題、約會地點、分工。
// 規則邏輯在 izakaya_core.js；這裡只放數值與雙語文字（C(zh, ja)）。2026-11-09 依使用者需求新增。
(function () {
  "use strict";

  function C(zh, ja) { return { zh: zh, ja: ja || zh }; }
  function L(o) {
    if (!o) return "";
    if (typeof o === "string") return o;
    var lang = window.I18N && window.I18N.getLang ? window.I18N.getLang() : "zh";
    return o[lang] || o.zh || o.ja || "";
  }

  var DIMS = ["salty", "sweet", "rich", "light", "spicy"];
  var DIM_NAMES = { salty: C("鹹", "塩辛い"), sweet: C("甜", "甘い"), rich: C("油潤", "こってり"), light: C("清爽", "さっぱり"), spicy: C("辣", "辛い") };
  var TAGS = ["raw", "sea", "meat", "alcohol"];
  var TAG_NAMES = { raw: C("生食", "生もの"), sea: C("海鮮", "魚介"), meat: C("肉類", "肉"), alcohol: C("酒精", "お酒") };

  // ---------------- 食材 ----------------
  // cat：veg／meat／sea／other／drink；price：基準單價（円）；fresh：可放幾天；season：當令季節（-1＝全年）
  function I(name, cat, price, fresh, season) { return { name: name, cat: cat, price: price, fresh: fresh, season: season }; }
  var INGS = {
    negi: I(C("蔥", "ねぎ"), "veg", 80, 4, -1), daikon: I(C("白蘿蔔", "大根"), "veg", 120, 5, 3),
    cabbage: I(C("高麗菜", "キャベツ"), "veg", 100, 5, -1), shiitake: I(C("香菇", "椎茸"), "veg", 150, 3, 2),
    takenoko: I(C("竹筍", "筍"), "veg", 220, 2, 0), edamame: I(C("毛豆", "枝豆"), "veg", 140, 2, 1),
    nasu: I(C("茄子", "茄子"), "veg", 110, 3, 1), kabocha: I(C("南瓜", "かぼちゃ"), "veg", 160, 6, 2),
    potato: I(C("馬鈴薯", "じゃがいも"), "veg", 80, 8, -1), cucumber: I(C("小黃瓜", "きゅうり"), "veg", 70, 3, 1),
    chicken: I(C("雞肉", "鶏肉"), "meat", 180, 2, -1), liver: I(C("雞肝", "レバー"), "meat", 120, 1, -1),
    pork: I(C("豬五花", "豚バラ"), "meat", 220, 2, -1), beef: I(C("牛肉", "牛肉"), "meat", 420, 2, -1),
    maguro: I(C("鮪魚", "まぐろ"), "sea", 480, 1, -1), salmon: I(C("鮭魚", "サーモン"), "sea", 380, 1, -1),
    saba: I(C("鯖魚", "鯖"), "sea", 260, 1, 2), ika: I(C("花枝", "いか"), "sea", 240, 1, -1),
    ebi: I(C("蝦", "海老"), "sea", 300, 1, -1), tako: I(C("章魚", "たこ"), "sea", 260, 2, 1),
    buri: I(C("鰤魚", "ぶり"), "sea", 420, 1, 3), katsuo: I(C("鰹魚", "かつお"), "sea", 380, 1, 0),
    shishamo: I(C("柳葉魚", "ししゃも"), "sea", 200, 2, 3),
    tofu: I(C("豆腐", "豆腐"), "other", 90, 2, -1), egg: I(C("雞蛋", "卵"), "other", 40, 7, -1),
    rice: I(C("米", "米"), "other", 50, 30, -1), konnyaku: I(C("蒟蒻", "こんにゃく"), "other", 70, 10, -1),
    chili: I(C("辣椒", "唐辛子"), "other", 30, 20, -1), wasabi: I(C("山葵", "わさび"), "other", 120, 5, -1),
    beer: I(C("生啤酒桶", "生ビール樽"), "drink", 200, 10, -1), sake: I(C("日本酒", "日本酒"), "drink", 260, 20, -1),
    shochu: I(C("燒酎", "焼酎"), "drink", 180, 30, -1), whisky: I(C("威士忌", "ウイスキー"), "drink", 300, 30, -1),
    lemon: I(C("檸檬", "レモン"), "drink", 60, 7, -1), umeshu: I(C("梅酒", "梅酒"), "drink", 220, 30, -1),
    oolong: I(C("烏龍茶", "烏龍茶"), "drink", 40, 30, -1), tea: I(C("綠茶葉", "緑茶葉"), "drink", 40, 30, -1),
    ginger: I(C("生薑", "生姜"), "drink", 60, 7, -1)
  };

  // ---------------- 菜單 ----------------
  // d(id, 中文, 日文, cat, m, st, ing, f[鹹甜油清辣], tags, price, cook（秒）, season, unlock, prep)
  var DISHES = {};
  function d(id, zh, ja, cat, m, st, ing, f, tags, price, cook, season, unlock, prep) {
    DISHES[id] = { name: C(zh, ja), cat: cat, m: m, st: st, ing: ing, f: f, tags: tags, price: price, cook: cook, season: season, unlock: unlock, prep: !!prep };
  }
  // 串燒（grill）
  d("negima", "蔥雞串", "ねぎま", "yakitori", "yaki", "grill", { chicken: 1, negi: 1 }, [2, 1, 1, 0, 0], ["meat"], 180, 8, -1, "start");
  d("tsukune", "雞肉丸", "つくね", "yakitori", "yaki", "grill", { chicken: 1, egg: 1 }, [1, 2, 1, 0, 0], ["meat"], 200, 8, -1, "start");
  d("kawa", "雞皮串", "皮", "yakitori", "yaki", "grill", { chicken: 1 }, [2, 0, 2, 0, 0], ["meat"], 150, 9, -1, "start");
  d("reba", "雞肝串", "レバー", "yakitori", "yaki", "grill", { liver: 1 }, [1, 1, 1, 0, 0], ["meat"], 180, 8, -1, "dev");
  d("butabara", "豬五花串", "豚バラ", "yakitori", "yaki", "grill", { pork: 1 }, [2, 0, 2, 0, 0], ["meat"], 200, 9, -1, "start");
  d("gyukushi", "牛肉串", "牛串", "yakitori", "yaki", "grill", { beef: 1 }, [2, 0, 2, 0, 0], ["meat"], 380, 9, -1, "dev");
  d("shiitake_yaki", "烤香菇", "焼き椎茸", "yakitori", "yaki", "grill", { shiitake: 1 }, [1, 0, 0, 2, 0], [], 160, 6, 2, "dev");
  d("nasu_yaki", "烤茄子", "焼き茄子", "yakitori", "yaki", "grill", { nasu: 1 }, [1, 0, 0, 1, 0], [], 220, 7, 1, "dev");
  d("ika_yaki", "烤花枝", "いか焼き", "yakitori", "yaki", "grill", { ika: 1 }, [2, 1, 0, 1, 0], ["sea"], 380, 8, -1, "dev");
  d("saba_shio", "鹽烤鯖魚", "鯖の塩焼き", "yakitori", "yaki", "grill", { saba: 1 }, [2, 0, 1, 1, 0], ["sea"], 480, 10, 2, "start");
  d("shishamo", "烤柳葉魚", "ししゃも焼き", "yakitori", "yaki", "grill", { shishamo: 1 }, [1, 0, 1, 0, 0], ["sea"], 380, 7, 3, "dev");
  d("tamagoyaki", "玉子燒", "玉子焼き", "kobachi", "yaki", "grill", { egg: 2 }, [0, 2, 0, 1, 0], [], 420, 4, -1, "start");
  d("yaki_onigiri", "烤飯糰", "焼きおにぎり", "meshi", "yaki", "grill", { rice: 1 }, [2, 0, 0, 0, 0], [], 280, 7, -1, "start");
  d("gyu_tataki", "炙燒牛肉", "牛たたき", "sashimi", "yaki", "grill", { beef: 1, negi: 1 }, [1, 0, 1, 1, 0], ["meat", "raw"], 880, 5, -1, "dev");
  // 生魚片（cold）
  d("maguro_sashi", "鮪魚生魚片", "まぐろ刺身", "sashimi", "nama", "cold", { maguro: 1 }, [0, 0, 1, 2, 0], ["raw", "sea"], 680, 3, -1, "start");
  d("salmon_sashi", "鮭魚生魚片", "サーモン刺身", "sashimi", "nama", "cold", { salmon: 1 }, [0, 1, 1, 1, 0], ["raw", "sea"], 580, 3, -1, "dev");
  d("katsuo_tataki", "炙燒鰹魚", "かつおのたたき", "sashimi", "nama", "cold", { katsuo: 1, negi: 1 }, [1, 0, 0, 2, 0], ["raw", "sea"], 680, 5, 0, "dev");
  d("tako_sashi", "章魚生魚片", "たこ刺し", "sashimi", "nama", "cold", { tako: 1 }, [0, 0, 0, 2, 0], ["raw", "sea"], 480, 3, -1, "dev");
  d("buri_sashi", "鰤魚生魚片", "ぶり刺身", "sashimi", "nama", "cold", { buri: 1 }, [0, 1, 2, 0, 0], ["raw", "sea"], 720, 3, 3, "dev");
  d("ika_sashi", "花枝生魚片", "いか刺し", "sashimi", "nama", "cold", { ika: 1 }, [0, 1, 0, 2, 0], ["raw", "sea"], 520, 3, -1, "dev");
  d("moriawase", "綜合生魚片", "刺身盛り合わせ", "sashimi", "nama", "cold", { maguro: 1, salmon: 1, ika: 1 }, [0, 1, 1, 2, 0], ["raw", "sea"], 1280, 6, -1, "dev");
  d("tori_wasa", "山葵雞柳", "鶏わさ", "sashimi", "nama", "cold", { chicken: 1, wasabi: 1 }, [1, 0, 0, 2, 2], ["raw", "meat"], 380, 3, -1, "dev");
  // 煮物（pot，可備料）
  d("oden", "關東煮", "おでん", "nimono", "ni", "pot", { daikon: 1, egg: 1, konnyaku: 1 }, [1, 1, 0, 2, 0], [], 480, 4, 3, "start", true);
  d("nikujaga", "馬鈴薯燉肉", "肉じゃが", "nimono", "ni", "pot", { potato: 1, beef: 1 }, [1, 2, 1, 0, 0], ["meat"], 520, 4, -1, "start", true);
  d("buri_daikon", "鰤魚燉蘿蔔", "ぶり大根", "nimono", "ni", "pot", { buri: 1, daikon: 1 }, [1, 2, 1, 0, 0], ["sea"], 620, 4, 3, "dev", true);
  d("kakuni", "滷豬角煮", "角煮", "nimono", "ni", "pot", { pork: 1, egg: 1 }, [1, 2, 2, 0, 0], ["meat"], 580, 4, -1, "dev", true);
  d("kabocha_ni", "燉南瓜", "かぼちゃの煮物", "nimono", "ni", "pot", { kabocha: 1 }, [0, 2, 0, 1, 0], [], 380, 3, 2, "dev", true);
  d("motsuni", "味噌燉內臟", "もつ煮", "nimono", "ni", "pot", { liver: 1, konnyaku: 1, chili: 1 }, [2, 0, 2, 0, 1], ["meat"], 480, 4, -1, "dev", true);
  d("tofu_yu", "湯豆腐", "湯豆腐", "nimono", "ni", "pot", { tofu: 1, negi: 1 }, [0, 0, 0, 2, 0], [], 420, 3, 3, "dev", true);
  d("tofu_chili", "辣味燉豆腐", "ピリ辛豆腐", "nimono", "ni", "pot", { tofu: 1, chili: 1 }, [1, 0, 1, 0, 2], [], 420, 4, -1, "dev", true);
  // 炸物（fry）
  d("karaage", "炸雞", "唐揚げ", "agemono", "age", "fry", { chicken: 1 }, [2, 0, 2, 0, 0], ["meat"], 480, 10, -1, "start");
  d("ebi_ten", "炸蝦天婦羅", "海老天", "agemono", "age", "fry", { ebi: 1 }, [1, 0, 2, 0, 0], ["sea"], 580, 9, -1, "dev");
  d("agedashi", "炸豆腐", "揚げ出し豆腐", "agemono", "age", "fry", { tofu: 1 }, [1, 0, 1, 1, 0], [], 380, 8, -1, "start");
  d("korokke", "可樂餅", "コロッケ", "agemono", "age", "fry", { potato: 1, beef: 1 }, [1, 1, 2, 0, 0], ["meat"], 320, 9, -1, "dev");
  d("ika_geso", "炸花枝腳", "げそ揚げ", "agemono", "age", "fry", { ika: 1 }, [2, 0, 2, 0, 0], ["sea"], 420, 8, -1, "dev");
  d("tonkatsu", "炸豬排", "とんかつ", "agemono", "age", "fry", { pork: 1, egg: 1 }, [1, 0, 2, 0, 0], ["meat"], 680, 11, -1, "dev");
  d("yasai_ten", "蔬菜天婦羅", "野菜天", "agemono", "age", "fry", { kabocha: 1, nasu: 1 }, [0, 1, 2, 0, 0], [], 520, 9, -1, "dev");
  d("takenoko_ten", "竹筍天婦羅", "筍の天ぷら", "agemono", "age", "fry", { takenoko: 1 }, [0, 0, 1, 1, 0], [], 480, 8, 0, "dev");
  d("ebi_mayo", "美乃滋蝦", "海老マヨ", "agemono", "age", "fry", { ebi: 1, egg: 1 }, [0, 2, 2, 0, 0], ["sea"], 620, 9, -1, "dev");
  // 小菜（cold）
  d("edamame", "毛豆", "枝豆", "kobachi", "ae", "cold", { edamame: 1 }, [1, 0, 0, 2, 0], [], 280, 2, 1, "start");
  d("hiyayakko", "冷豆腐", "冷奴", "kobachi", "ae", "cold", { tofu: 1, negi: 1 }, [0, 0, 0, 2, 0], [], 280, 2, -1, "start");
  d("kyuri", "淺漬小黃瓜", "きゅうりの浅漬け", "kobachi", "ae", "cold", { cucumber: 1 }, [1, 0, 0, 2, 0], [], 280, 2, 1, "start");
  d("potesara", "馬鈴薯沙拉", "ポテトサラダ", "kobachi", "ae", "cold", { potato: 1, egg: 1, cucumber: 1 }, [0, 1, 1, 1, 0], [], 380, 3, -1, "dev");
  d("cabbage_shio", "鹽味高麗菜", "塩キャベツ", "kobachi", "ae", "cold", { cabbage: 1 }, [1, 0, 0, 2, 0], [], 280, 2, -1, "start");
  d("tako_wasa", "芥末章魚", "たこわさ", "kobachi", "ae", "cold", { tako: 1, wasabi: 1 }, [1, 0, 0, 1, 2], ["raw", "sea"], 380, 2, -1, "dev");
  d("takenoko_ae", "涼拌竹筍", "筍の和え物", "kobachi", "ae", "cold", { takenoko: 1 }, [0, 1, 0, 2, 0], [], 380, 3, 0, "dev");
  d("spicy_kyuri", "辣拌小黃瓜", "ピリ辛きゅうり", "kobachi", "ae", "cold", { cucumber: 1, chili: 1 }, [1, 0, 0, 1, 2], [], 300, 2, 1, "dev");
  // 飯類
  d("ochazuke", "鮭魚茶泡飯", "鮭茶漬け", "meshi", "meshi", "cold", { rice: 1, salmon: 1 }, [1, 0, 0, 2, 0], ["sea"], 480, 3, -1, "start");
  d("tekkadon", "鐵火丼", "鉄火丼", "meshi", "meshi", "cold", { rice: 1, maguro: 1 }, [0, 0, 1, 1, 0], ["raw", "sea"], 880, 3, -1, "dev");
  d("zosui", "雜炊", "雑炊", "meshi", "meshi", "pot", { rice: 1, egg: 1, negi: 1 }, [1, 0, 0, 2, 0], [], 520, 4, 3, "dev", true);
  d("kamameshi", "雞肉香菇釜飯", "鶏と椎茸の釜飯", "meshi", "meshi", "pot", { rice: 1, chicken: 1, shiitake: 1 }, [1, 1, 1, 0, 0], ["meat"], 780, 5, 2, "dev", true);
  d("takenoko_gohan", "竹筍飯", "筍ご飯", "meshi", "meshi", "pot", { rice: 1, takenoko: 1 }, [1, 1, 0, 1, 0], [], 480, 3, 0, "dev", true);
  // 酒飲（bar）——研發改由酒保「調飲研發」：選一種未解鎖的酒，用掉一份材料即解鎖
  d("nama", "生啤酒", "生ビール", "drink", "nomi", "bar", { beer: 1 }, [0, 0, 0, 2, 0], ["alcohol"], 550, 2, -1, "start");
  d("sake_atsu", "熱清酒", "熱燗", "drink", "nomi", "bar", { sake: 1 }, [0, 1, 0, 1, 0], ["alcohol"], 600, 3, -1, "start");
  d("sake_hiya", "冷酒", "冷酒", "drink", "nomi", "bar", { sake: 1 }, [0, 1, 0, 2, 0], ["alcohol"], 650, 2, -1, "dev");
  d("daiginjo", "大吟釀", "大吟醸", "drink", "nomi", "bar", { sake: 2 }, [0, 2, 0, 2, 0], ["alcohol"], 1200, 2, -1, "dev");
  d("atsukan_ni", "熱燗二合", "熱燗二合", "drink", "nomi", "bar", { sake: 2 }, [0, 1, 0, 1, 0], ["alcohol"], 1100, 3, 3, "dev");
  d("shochu_rock", "燒酎加冰", "焼酎ロック", "drink", "nomi", "bar", { shochu: 1 }, [0, 0, 0, 1, 0], ["alcohol"], 500, 2, -1, "start");
  d("shochu_yu", "燒酎兌熱水", "焼酎お湯割り", "drink", "nomi", "bar", { shochu: 1 }, [0, 0, 0, 1, 0], ["alcohol"], 500, 2, 3, "dev");
  d("highball", "Highball", "ハイボール", "drink", "nomi", "bar", { whisky: 1, lemon: 1 }, [0, 0, 0, 2, 0], ["alcohol"], 500, 2, -1, "start");
  d("whisky_rock", "威士忌加冰", "ウイスキーロック", "drink", "nomi", "bar", { whisky: 1 }, [0, 0, 1, 0, 0], ["alcohol"], 800, 2, -1, "dev");
  d("ginger_high", "薑汁 Highball", "ジンジャーハイ", "drink", "nomi", "bar", { whisky: 1, ginger: 1 }, [0, 1, 0, 2, 1], ["alcohol"], 550, 2, -1, "dev");
  d("lemon_sour", "檸檬沙瓦", "レモンサワー", "drink", "nomi", "bar", { shochu: 1, lemon: 1 }, [0, 1, 0, 2, 0], ["alcohol"], 480, 2, -1, "start");
  d("oolong_hai", "烏龍燒酎", "ウーロンハイ", "drink", "nomi", "bar", { shochu: 1, oolong: 1 }, [0, 0, 0, 2, 0], ["alcohol"], 480, 2, -1, "dev");
  d("umeshu_rock", "梅酒加冰", "梅酒ロック", "drink", "nomi", "bar", { umeshu: 1 }, [0, 2, 0, 1, 0], ["alcohol"], 550, 2, -1, "start");
  d("umeshu_soda", "梅酒蘇打", "梅酒ソーダ", "drink", "nomi", "bar", { umeshu: 1, lemon: 1 }, [0, 2, 0, 2, 0], ["alcohol"], 550, 2, 1, "dev");
  d("oolong", "烏龍茶", "烏龍茶", "drink", "nomi", "bar", { oolong: 1 }, [0, 0, 0, 2, 0], [], 280, 1, -1, "start");
  d("lemon_soda", "檸檬蘇打", "レモンソーダ", "drink", "nomi", "bar", { lemon: 1 }, [0, 1, 0, 2, 0], [], 300, 1, -1, "start");
  d("ocha", "熱綠茶", "緑茶", "drink", "nomi", "bar", { tea: 1 }, [0, 0, 0, 2, 0], [], 200, 1, -1, "start");
  d("ginger_ale", "自製薑汁汽水", "自家製ジンジャーエール", "drink", "nomi", "bar", { ginger: 1, lemon: 1 }, [0, 2, 0, 2, 1], [], 380, 1, -1, "dev");
  d("hot_lemon", "熱檸檬水", "ホットレモン", "drink", "nomi", "bar", { lemon: 1, tea: 1 }, [0, 1, 0, 2, 0], [], 300, 1, 3, "dev");
  d("nonal_beer", "無酒精啤酒", "ノンアルビール", "drink", "nomi", "bar", { beer: 1 }, [0, 0, 0, 2, 0], [], 400, 1, -1, "dev");

  var SEASONS = [C("春", "春"), C("夏", "夏"), C("秋", "秋"), C("冬", "冬")];
  // 星級解鎖（依歷史最高星級，永久保留）
  var STARS = [
    { unlock: C("吧台 6 席、基本菜單", "カウンター 6 席・基本メニュー"), love: null },
    { unlock: C("4 人桌＋團體預約、冰箱擴充", "4 人テーブル＋団体予約・冷蔵庫拡張"), love: null },
    { unlock: C("招牌菜（價格 +20%、點單率提高）", "看板メニュー（価格 +20%・注文率アップ）"), love: C("約會", "デート") },
    { unlock: C("雇用店員", "店員を雇う"), love: C("怦然心動事件", "ときめきイベント") },
    { unlock: C("美食評論家來訪、季節宴席", "グルメ評論家の来店・季節の宴席"), love: C("告白・交往・求婚・結婚", "告白・交際・プロポーズ・結婚") }
  ];
  var TOPICS = {
    work: C("工作", "仕事"), love: C("戀愛", "恋愛"), music: C("音樂", "音楽"), money: C("錢與投資", "お金と投資"),
    food: C("美食", "グルメ"), gossip: C("八卦", "噂話"), family: C("家人", "家族"), dream: C("夢想", "夢")
  };
  // 約會地點：每個地點 3 輪、每輪 3 個選項；選項的 tag 對上角色 likes 加分
  // heart：★4 心動事件時，角色在這個地點沒有專屬場景就用這段通用描寫（1b 新增）
  function S(id, zh, ja, rounds, heart) { return { id: id, name: C(zh, ja), rounds: rounds, heart: heart }; }
  function R(q, a, b, c) { return { q: q, ch: [a, b, c] }; }
  function O(t, tag) { return { t: t, tag: tag }; }
  var SPOTS = [
    S("matsuri", "夏日祭典", "夏祭り", [
      R("攤販好多，先去哪裡？", O("撈金魚比賽", "play"), O("吃蘋果糖", "sweet"), O("找個安靜處看人潮", "calm")),
      R("對方的浴衣帶子鬆了。", O("自然地幫忙綁好", "care"), O("提醒一聲然後別過頭", "shy"), O("開玩笑說要拍照留念", "tease")),
      R("煙火開始了。", O("說「好漂亮」", "honest"), O("說「沒有你漂亮」", "bold"), O("安靜地一起看", "calm"))], "煙火在頭頂綻開的瞬間，她悄悄勾住了你的小指。"),
    S("onsen", "溫泉街", "温泉街", [
      R("到溫泉街了。", O("先去泡足湯", "calm"), O("逛土產店", "play"), O("吃溫泉饅頭", "sweet")),
      R("對方說最近很累。", O("聽她慢慢說", "care"), O("提議來比桌球", "play"), O("說「有我在」", "bold")),
      R("回程的電車上，對方睡著靠在你肩上。", O("就這樣不動", "care"), O("輕聲叫醒她", "honest"), O("偷偷拍下睡臉", "tease"))], "泡完湯的她臉頰微紅，濕髮的香氣讓你一時忘了要說什麼。"),
    S("aquarium", "水族館", "水族館", [
      R("入口有兩條路線。", O("先看水母區", "calm"), O("先看海豚表演", "play"), O("讓她決定", "care")),
      R("巨大水槽前，她看得入迷。", O("說明魚的知識", "smart"), O("靜靜地陪著", "calm"), O("說「你比較好看」", "bold")),
      R("紀念品店。", O("送她企鵝吊飾", "sweet"), O("買一對成對的吊飾", "bold"), O("讓她挑給你", "shy"))], "藍色的水光映在她臉上，她轉過頭，發現你一直在看她，而不是魚。"),
    S("yakei", "夜景展望台", "夜景展望台", [
      R("搭電梯上展望台。", O("聊這座城市的回憶", "honest"), O("猜哪一盞燈是自己家", "play"), O("什麼都不說，牽起手", "bold")),
      R("風有點冷。", O("把外套給她", "care"), O("一起去買熱飲", "sweet"), O("靠近一點", "shy")),
      R("她問你「為什麼開居酒屋？」", O("說出師父的事", "honest"), O("說「為了遇見你」", "bold"), O("笑著說是秘密", "tease"))], "整座城市的燈火在腳下閃爍，她輕輕靠上你的肩膀。"),
    S("asaichi", "早市", "朝市", [
      R("一大早來到早市。", O("認真挑今晚的食材", "smart"), O("邊走邊試吃", "sweet"), O("跟老闆殺價", "play")),
      R("她對一條魚很好奇。", O("教她怎麼看新鮮度", "smart"), O("說今晚就做給她吃", "care"), O("把魚舉到她面前嚇她", "tease")),
      R("早餐吃什麼？", O("市場裡的海鮮丼", "sweet"), O("她推薦的小店", "care"), O("自己做飯糰給她", "honest"))], "清晨的市場裡，她把剛買的熱飯糰掰成兩半，大的那一半遞給你。"),
    S("karaoke", "卡拉 OK", "カラオケ", [
      R("先由誰唱？", O("自己先唱暖場", "bold"), O("請她先唱", "care"), O("一起合唱", "play")),
      R("她唱完一首抒情歌，眼眶有點紅。", O("問她想起了什麼", "honest"), O("用力鼓掌", "play"), O("遞上面紙不說話", "calm")),
      R("最後一首。", O("點一首情歌", "bold"), O("點她最愛的歌", "care"), O("點搞笑歌收尾", "tease"))], "她點了一首情歌，唱到副歌時，視線始終沒有離開你。"),
    // ---- 1b 新增 ----
    S("amusement", "遊樂園", "遊園地", [
      R("先玩什麼？", O("雲霄飛車", "bold"), O("旋轉木馬", "sweet"), O("鬼屋", "tease")),
      R("排隊時她說有點冷。", O("把圍巾分她一半", "care"), O("去買熱可可", "sweet"), O("拉著她小跑步取暖", "play")),
      R("最後搭摩天輪。到最高點時——", O("說出心裡話", "honest"), O("安靜地看風景", "calm"), O("故意晃車廂", "tease"))], "摩天輪升到最高點，她突然握住你的手：「……再轉一圈好不好？」"),
    S("beach", "海邊", "海辺", [
      R("到海邊了。", O("脫鞋去踩浪", "play"), O("撿漂亮的貝殼", "sweet"), O("在堤防上坐著聊天", "calm")),
      R("她的帽子被風吹走了。", O("衝去追回來", "bold"), O("笑著陪她一起追", "play"), O("把自己的帽子給她", "care")),
      R("夕陽西下。", O("說「好美」", "honest"), O("在沙灘上寫她的名字", "bold"), O("靜靜並肩看完", "calm"))], "夕陽把海面染成金色，浪花打濕了兩人的腳踝，她笑著不肯放開你的手。"),
    S("museum", "美術館", "美術館", [
      R("先看哪一區？", O("印象派", "calm"), O("現代藝術", "smart"), O("讓她帶路", "care")),
      R("她在一幅畫前停了很久。", O("講解畫家的故事", "smart"), O("問她看到了什麼", "honest"), O("安靜等她", "calm")),
      R("紀念品店。", O("買她喜歡的明信片", "sweet"), O("買一樣的兩張", "bold"), O("讓她挑一張給你", "shy"))], "安靜的展廳裡只剩你們兩個，她小聲說：「比起畫，我比較想看你。」"),
    S("hanami", "賞花", "花見", [
      R("櫻花樹下鋪好了野餐墊。", O("拿出親手做的便當", "care"), O("開一瓶小酒", "bold"), O("躺下來看花", "calm")),
      R("一片花瓣落在她的頭髮上。", O("輕輕幫她拿下來", "care"), O("說「很適合妳」", "bold"), O("偷偷拍照", "tease")),
      R("天色暗了，夜櫻亮起燈。", O("說明年也要一起來", "honest"), O("一起散步", "calm"), O("比賽誰接到最多花瓣", "play"))], "夜櫻的燈亮起時，她把一片花瓣夾進你的掌心：「明年……也要一起。」"),
    S("snow", "雪景溫泉", "雪見温泉", [
      R("下雪了。", O("打雪仗", "play"), O("堆雪人", "sweet"), O("撐傘慢慢走", "calm")),
      R("她的手凍得通紅。", O("握住她的手呵氣", "care"), O("把暖暖包給她", "honest"), O("把她的手放進自己口袋", "bold")),
      R("露天溫泉看雪景。", O("聊明年的計畫", "honest"), O("一起看雪不說話", "calm"), O("偷偷捏一顆雪球", "tease"))], "雪靜靜落下，她把凍紅的手放進你的口袋，然後就再也沒有拿出來。"),
    S("yakata", "屋形船", "屋形船", [
      R("上船了。", O("坐在窗邊看河景", "calm"), O("先點天婦羅", "sweet"), O("跟船家聊天", "smart")),
      R("她不小心打翻了酒杯。", O("迅速擦乾淨", "care"), O("笑著說「乾杯失敗」", "play"), O("把自己的杯子給她", "honest")),
      R("船經過一座點燈的橋。", O("許願", "honest"), O("說「這座橋好像我們」", "bold"), O("靜靜看著燈影", "calm"))], "船身輕輕搖晃，河面的燈影在她眼中晃動，她說：「好想一直待在這艘船上。」")
  ];
  var LIKE_TAGS = ["play", "sweet", "calm", "care", "shy", "tease", "honest", "bold", "smart"];

  var ROLES = {
    hall: { icon: "🏮", name: C("外場店長", "ホール店長") },
    chef: { icon: "🔪", name: C("板前", "板前") },
    bar: { icon: "🍶", name: C("酒保", "バーテン") },
    buyer: { icon: "🧺", name: C("採買", "仕入れ") }
  };
  var ROLE_ORDER = ["hall", "chef", "bar", "buyer"];

  // 口碑與星級數值依 tools/izakaya_check/sim.js 調整（2026-11-09）：原本每組口碑乘人數、門檻 [0,25,70,140,240]，
  // 會推理的機器人 3 天內就滿星。改成每組 round((滿意度-60)/15)、門檻 [0,35,95,190,340]、房租 6000 後，
  // 會推理的機器人平均最高 ★3.25、亂選 ★1.35（★5 留給認真推理＋經營的玩家）。
  window.PriTestIzakayaData = {
    C: C, L: L, DIMS: DIMS, DIM_NAMES: DIM_NAMES, TAGS: TAGS, TAG_NAMES: TAG_NAMES, INGS: INGS, DISHES: DISHES,
    SEASONS: SEASONS, STARS: STARS, TOPICS: TOPICS, SPOTS: SPOTS, LIKE_TAGS: LIKE_TAGS, ROLES: ROLES, ROLE_ORDER: ROLE_ORDER,
    DAYS: 30, WEEK: 6, START_CASH: 30000, RENT: 6000, FRIDGE_CAP: 40, FRIDGE_CAP_STAR2: 60, BOARD_MAX: 8, PREP_PORTIONS: 3,
    BASE_GROUPS: 4, REP_BASE: 60, REP_DIV: 15, STAR_REP: [0, 35, 95, 190, 340], DATE_AFF: 30, HEART_AFF: 50, CONFESS_AFF: 80, PROPOSE_AFF: 95, SIG_MULT: 1.2
  };
})();
