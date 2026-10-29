// 賽狗賽狗（saigo）：靜態資料——犬種、場地零件、天氣、調子、下注種類、CPU 狗名。
// 犬種的能力值是遊戲用的風格化數值（0–100），不是實測。三語名稱放在這裡，UI 字串在 site_src/i18n_saigo.py。
(function () {
  "use strict";

  function C(zh, ja, en) { return { zh: zh, ja: ja, en: en || ja }; }
  function L(o) {
    if (!o) return "";
    var lang = window.I18N ? window.I18N.getLang() : "zh";
    return o[lang] || o.zh || o.ja || "";
  }

  // 能力：spd 速度、sta 耐力、pow 力量、agi 敏捷、jmp 跳躍、swm 游泳、cat 接物、foc 專注
  var STATS = ["spd", "sta", "pow", "agi", "jmp", "swm", "cat", "foc"];
  // 體型 1 迷你 2 小型 3 中型 4 大型 5 超大型
  var SIZES = { 1: C("迷你", "超小型", "Toy"), 2: C("小型", "小型", "Small"), 3: C("中型", "中型", "Medium"), 4: C("大型", "大型", "Large"), 5: C("超大型", "超大型", "Giant") };
  // 跑法：nige 逃（一路領先）、senko 先行、sashi 差（中段蓄力）、oikomi 追（最後衝刺）
  var STYLES = {
    nige: C("逃", "逃げ", "Front-runner"), senko: C("先行", "先行", "Stalker"),
    sashi: C("差", "差し", "Closer"), oikomi: C("追", "追込", "Deep closer")
  };

  // [id, zh, ja, en, 體型, spd, sta, pow, agi, jmp, swm, cat, foc, 耐熱, 耐寒, 跑法, 耳, 尾, 吻長, 腿長, 身長, 主色, 副色, 花紋]
  // 耳：prick 立耳、floppy 垂耳、fold 半立耳、bat 蝙蝠耳；尾：curl 捲尾、straight 直尾、bob 短尾、plume 蓬尾
  // 花紋：0 單色、1 白胸腹、2 斑點、3 背鞍、4 面罩
  var RAW = [
    ["shiba", "柴犬", "柴犬", "Shiba Inu", 3, 62, 66, 55, 68, 55, 40, 45, 40, 0, 1, "senko", "prick", "curl", 0.9, 0.9, 0.9, "#c8792f", "#f3e3c8", 1],
    ["akita", "秋田犬", "秋田犬", "Akita", 4, 58, 72, 75, 52, 50, 50, 40, 50, -1, 2, "senko", "prick", "curl", 1.0, 1.0, 1.15, "#d08a45", "#f5ead8", 1],
    ["husky", "西伯利亞哈士奇", "シベリアン・ハスキー", "Siberian Husky", 4, 70, 92, 68, 62, 55, 45, 45, 30, -2, 2, "nige", "prick", "plume", 1.05, 1.05, 1.1, "#5d6670", "#f2f2f2", 4],
    ["malamute", "阿拉斯加雪橇犬", "アラスカン・マラミュート", "Alaskan Malamute", 5, 55, 88, 88, 45, 40, 45, 38, 45, -2, 2, "senko", "prick", "plume", 1.1, 1.0, 1.3, "#7a7f86", "#f0f0f0", 4],
    ["golden", "黃金獵犬", "ゴールデン・レトリーバー", "Golden Retriever", 4, 60, 70, 62, 58, 55, 85, 82, 75, -1, 1, "sashi", "floppy", "plume", 1.1, 1.0, 1.15, "#e0a956", "#f0c987", 0],
    ["labrador", "拉布拉多", "ラブラドール・レトリーバー", "Labrador Retriever", 4, 62, 72, 66, 58, 55, 90, 85, 72, 0, 1, "sashi", "floppy", "straight", 1.1, 1.0, 1.15, "#e9d29a", "#f2e2b8", 0],
    ["border", "邊境牧羊犬", "ボーダー・コリー", "Border Collie", 3, 74, 80, 58, 92, 80, 60, 95, 92, 0, 1, "sashi", "fold", "plume", 1.05, 1.05, 1.0, "#1c1c1c", "#ffffff", 1],
    ["gsd", "德國牧羊犬", "ジャーマン・シェパード", "German Shepherd", 4, 72, 78, 76, 72, 72, 55, 70, 88, 0, 1, "senko", "prick", "plume", 1.15, 1.05, 1.2, "#8a5a2b", "#1e1a16", 3],
    ["greyhound", "灰狗", "グレーハウンド", "Greyhound", 4, 98, 55, 60, 65, 62, 35, 40, 55, 0, -1, "nige", "fold", "straight", 1.35, 1.35, 1.25, "#9aa0a6", "#e8e8e8", 0],
    ["whippet", "惠比特犬", "ウィペット", "Whippet", 3, 92, 58, 48, 72, 66, 30, 42, 55, 0, -2, "nige", "fold", "straight", 1.3, 1.3, 1.05, "#c9a27a", "#f5f0e8", 1],
    ["saluki", "薩路基獵犬", "サルーキ", "Saluki", 4, 90, 72, 52, 66, 60, 30, 38, 40, 2, -1, "sashi", "floppy", "plume", 1.3, 1.35, 1.15, "#d9b98c", "#f2e6cf", 0],
    ["afghan", "阿富汗獵犬", "アフガン・ハウンド", "Afghan Hound", 4, 85, 62, 52, 70, 62, 30, 35, 25, 1, 1, "oikomi", "floppy", "curl", 1.4, 1.3, 1.15, "#e3c595", "#8a6a45", 4],
    ["corgi", "柯基", "ウェルシュ・コーギー", "Welsh Corgi", 2, 48, 70, 50, 62, 30, 45, 60, 68, 0, 1, "senko", "prick", "bob", 0.95, 0.5, 1.0, "#d9893b", "#ffffff", 1],
    ["dachshund", "臘腸犬", "ダックスフンド", "Dachshund", 2, 42, 60, 45, 55, 22, 40, 50, 50, 0, -1, "oikomi", "floppy", "straight", 1.2, 0.4, 1.25, "#8b4a1f", "#c47a3e", 0],
    ["frenchie", "法國鬥牛犬", "フレンチ・ブルドッグ", "French Bulldog", 2, 40, 40, 62, 45, 30, 15, 40, 45, -2, -1, "senko", "bat", "bob", 0.4, 0.65, 0.8, "#3b3632", "#ffffff", 1],
    ["bulldog", "英國鬥牛犬", "ブルドッグ", "Bulldog", 3, 32, 38, 80, 32, 22, 12, 35, 45, -2, -1, "oikomi", "fold", "bob", 0.4, 0.6, 1.0, "#e5d3b8", "#ffffff", 1],
    ["pug", "巴哥", "パグ", "Pug", 2, 35, 40, 50, 45, 28, 20, 45, 40, -2, -1, "senko", "fold", "curl", 0.35, 0.6, 0.8, "#e6cfa3", "#2a2420", 4],
    ["chihuahua", "吉娃娃", "チワワ", "Chihuahua", 1, 50, 38, 25, 75, 35, 15, 40, 30, 1, -2, "nige", "bat", "straight", 0.6, 0.65, 0.6, "#e8c48f", "#f8ecd8", 1],
    ["pomeranian", "博美", "ポメラニアン", "Pomeranian", 1, 46, 45, 28, 70, 38, 20, 50, 40, -1, 2, "senko", "prick", "curl", 0.6, 0.55, 0.6, "#f0a24a", "#f8d39a", 0],
    ["poodle", "標準貴賓", "スタンダード・プードル", "Standard Poodle", 4, 72, 70, 55, 82, 85, 75, 80, 85, 0, 0, "sashi", "floppy", "straight", 1.0, 1.2, 1.05, "#f4f1ea", "#e8e2d6", 0],
    ["toypoodle", "玩具貴賓", "トイ・プードル", "Toy Poodle", 1, 50, 50, 25, 80, 55, 40, 65, 75, 0, 0, "sashi", "floppy", "straight", 0.7, 0.7, 0.65, "#8a4f2a", "#a8653a", 0],
    ["beagle", "比格犬", "ビーグル", "Beagle", 3, 64, 80, 52, 66, 50, 40, 55, 25, 0, 0, "sashi", "floppy", "straight", 0.95, 0.8, 0.95, "#c7843f", "#2a2622", 3],
    ["jack", "傑克羅素梗", "ジャック・ラッセル・テリア", "Jack Russell Terrier", 2, 70, 75, 45, 85, 78, 35, 72, 35, 0, 0, "nige", "fold", "straight", 0.8, 0.75, 0.8, "#ffffff", "#a8642c", 3],
    ["schnauzer", "迷你雪納瑞", "ミニチュア・シュナウザー", "Miniature Schnauzer", 2, 55, 60, 45, 65, 50, 30, 55, 60, 0, 1, "senko", "fold", "bob", 0.85, 0.7, 0.8, "#8c8c8c", "#d8d8d8", 4],
    ["yorkie", "約克夏", "ヨークシャー・テリア", "Yorkshire Terrier", 1, 45, 40, 22, 68, 35, 20, 45, 45, 0, -1, "senko", "prick", "bob", 0.7, 0.5, 0.6, "#3a4a5e", "#d4a15c", 3],
    ["maltese", "馬爾濟斯", "マルチーズ", "Maltese", 1, 42, 42, 20, 62, 32, 20, 48, 50, -1, -1, "senko", "floppy", "plume", 0.7, 0.5, 0.65, "#fbfaf6", "#f0ebe0", 0],
    ["shihtzu", "西施犬", "シー・ズー", "Shih Tzu", 1, 38, 45, 30, 50, 28, 20, 42, 50, -2, 0, "oikomi", "floppy", "curl", 0.6, 0.5, 0.7, "#e8d6b8", "#8a6a45", 4],
    ["dalmatian", "大麥町", "ダルメシアン", "Dalmatian", 4, 78, 88, 62, 70, 65, 55, 60, 50, 0, 0, "senko", "floppy", "straight", 1.05, 1.1, 1.15, "#fafafa", "#1a1a1a", 2],
    ["doberman", "杜賓犬", "ドーベルマン", "Doberman", 4, 82, 75, 74, 75, 72, 45, 60, 80, 0, -1, "senko", "prick", "bob", 1.2, 1.2, 1.15, "#1e1b19", "#a8572a", 4],
    ["rottweiler", "羅威那", "ロットワイラー", "Rottweiler", 5, 62, 70, 90, 52, 50, 45, 55, 75, -1, 0, "oikomi", "fold", "bob", 0.95, 1.0, 1.25, "#1d1b19", "#9b5a2a", 4],
    ["boxer", "拳師犬", "ボクサー", "Boxer", 4, 70, 68, 78, 66, 70, 40, 62, 50, -1, -1, "senko", "fold", "bob", 0.55, 1.05, 1.1, "#c27b3a", "#ffffff", 1],
    ["samoyed", "薩摩耶", "サモエド", "Samoyed", 4, 60, 82, 60, 60, 50, 45, 55, 55, -2, 2, "sashi", "prick", "curl", 0.95, 1.0, 1.1, "#fbfbf8", "#f2efe8", 0],
    ["chowchow", "鬆獅犬", "チャウチャウ", "Chow Chow", 3, 40, 50, 70, 38, 28, 25, 30, 30, -2, 2, "oikomi", "prick", "curl", 0.6, 0.75, 1.05, "#c9813a", "#d99a52", 0],
    ["kai", "甲斐犬", "甲斐犬", "Kai Ken", 3, 68, 74, 60, 80, 72, 45, 50, 55, 0, 1, "senko", "prick", "curl", 0.9, 0.95, 0.95, "#3a2c22", "#6a4a2e", 0],
    ["hokkaido", "北海道犬", "北海道犬", "Hokkaido Ken", 3, 60, 82, 66, 66, 55, 50, 48, 60, -1, 2, "senko", "prick", "curl", 0.9, 0.9, 1.0, "#f1ece2", "#dcd2c0", 0],
    ["shikoku", "四國犬", "四国犬", "Shikoku Ken", 3, 66, 78, 62, 76, 66, 45, 50, 55, 0, 1, "sashi", "prick", "curl", 0.95, 0.95, 0.95, "#b0602e", "#e8d8c0", 1],
    ["formosan", "台灣犬", "台湾犬", "Formosan Mountain Dog", 3, 74, 80, 64, 84, 76, 55, 55, 65, 2, -1, "senko", "prick", "plume", 0.95, 1.0, 0.95, "#1e1c1a", "#b07a3e", 0],
    ["aussie", "澳洲牧羊犬", "オーストラリアン・シェパード", "Australian Shepherd", 3, 70, 82, 58, 86, 76, 55, 88, 85, 0, 1, "sashi", "fold", "bob", 1.0, 1.0, 1.0, "#6e7a86", "#f2f2f2", 2],
    ["sheltie", "喜樂蒂", "シェットランド・シープドッグ", "Shetland Sheepdog", 3, 68, 70, 42, 86, 72, 40, 80, 78, 0, 1, "sashi", "fold", "plume", 1.0, 0.9, 0.85, "#c9813a", "#ffffff", 1],
    ["bernese", "伯恩山犬", "バーニーズ・マウンテン・ドッグ", "Bernese Mountain Dog", 5, 45, 68, 82, 40, 35, 50, 50, 72, -2, 2, "oikomi", "floppy", "plume", 1.0, 0.95, 1.25, "#1b1918", "#ffffff", 1],
    ["stbernard", "聖伯納犬", "セント・バーナード", "Saint Bernard", 5, 38, 70, 92, 32, 25, 50, 45, 72, -2, 2, "oikomi", "floppy", "plume", 1.05, 0.95, 1.35, "#b55a2a", "#ffffff", 1],
    ["greatdane", "大丹犬", "グレート・デーン", "Great Dane", 5, 72, 55, 85, 48, 70, 40, 42, 55, 0, -1, "nige", "floppy", "straight", 1.15, 1.4, 1.35, "#c8a26a", "#2a2420", 4],
    ["newfie", "紐芬蘭犬", "ニューファンドランド", "Newfoundland", 5, 40, 72, 88, 35, 30, 98, 60, 70, -2, 2, "oikomi", "floppy", "plume", 1.0, 0.95, 1.35, "#1a1918", "#2a2826", 0],
    ["weimaraner", "威瑪獵犬", "ワイマラナー", "Weimaraner", 4, 80, 82, 66, 70, 68, 70, 62, 55, 0, -1, "senko", "floppy", "straight", 1.15, 1.15, 1.15, "#9a9a92", "#b8b6ae", 0],
    ["vizsla", "維茲拉犬", "ビズラ", "Vizsla", 4, 82, 85, 60, 74, 70, 65, 60, 55, 0, -1, "sashi", "floppy", "straight", 1.1, 1.15, 1.1, "#b8682e", "#c47a3e", 0],
    ["basenji", "巴仙吉犬", "バセンジー", "Basenji", 3, 76, 72, 48, 80, 74, 15, 45, 35, 2, -1, "nige", "prick", "curl", 0.95, 1.05, 0.9, "#b8682e", "#ffffff", 1],
    ["mix", "台灣米克斯", "台湾ミックス", "Taiwanese Mixed", 3, 66, 76, 62, 70, 62, 50, 55, 50, 1, 0, "senko", "prick", "straight", 0.95, 0.95, 0.95, "#c9a46a", "#f2e6cf", 1]
  ];

  var BREEDS = RAW.map(function (r) {
    return {
      id: r[0], name: C(r[1], r[2], r[3]), size: r[4],
      base: { spd: r[5], sta: r[6], pow: r[7], agi: r[8], jmp: r[9], swm: r[10], cat: r[11], foc: r[12] },
      heat: r[13], cold: r[14], style: r[15],
      model: { ear: r[16], tail: r[17], snout: r[18], leg: r[19], body: r[20], c1: r[21], c2: r[22], pat: r[23] }
    };
  });
  var BREED_BY_ID = {};
  BREEDS.forEach(function (b) { BREED_BY_ID[b.id] = b; });

  // 場地零件（part）。len＝長度範圍（m）；icon 只是 UI 用的符號
  var PARTS = {
    straight: { name: C("長直道", "直線", "Straight"), icon: "━", len: [60, 140] },
    curve: { name: C("彎道", "コーナー", "Corner"), icon: "↷", len: [30, 70] },
    hurdle: { name: C("障礙跳高", "ハードル", "Hurdles"), icon: "╫", len: [40, 70] },
    tunnel: { name: C("蹲伏隧道", "トンネルくぐり", "Crawl tunnel"), icon: "◠", len: [12, 24] },
    frisbee: { name: C("接飛盤", "フリスビーキャッチ", "Frisbee catch"), icon: "◎", len: [24, 34] },
    weave: { name: C("繞桿", "スラローム", "Weave poles"), icon: "⋮", len: [16, 26] },
    pool: { name: C("游泳池", "プール", "Swim pool"), icon: "≈", len: [10, 20] },
    mud: { name: C("泥巴地", "泥んこ地帯", "Mud pit"), icon: "▒", len: [20, 40] },
    aframe: { name: C("攀爬板", "Aフレーム", "A-frame"), icon: "△", len: [10, 10] },
    treat: { name: C("零食誘惑區", "おやつ誘惑ゾーン", "Treat zone"), icon: "🍖", len: [20, 30] },
    stay: { name: C("坐下等待", "おすわり待て", "Sit & stay"), icon: "✋", len: [8, 8] },
    hill: { name: C("坡道", "坂道", "Hill"), icon: "⛰", len: [30, 60] },
    bridge: { name: C("吊橋", "吊り橋", "Rope bridge"), icon: "🌉", len: [14, 26] },
    // 2026-10-29 擴充（使用者指定「關卡新增至 29 種、跨欄出現機率極高」）：以下 18 種
    hurdlerace: { name: C("跨欄賽道", "ハードル走", "Hurdle sprint"), icon: "╪", len: [50, 80] },
    firewheel: { name: C("風火輪", "火の輪くぐり", "Ring of fire"), icon: "🔥", len: [30, 45] },
    looptube: { name: C("圓形通道", "ループトンネル", "Loop tube"), icon: "➰", len: [22, 22] },
    climbwall: { name: C("爬高牆", "クライミングウォール", "Climbing wall"), icon: "🧗", len: [10, 14] },
    wallkick: { name: C("蹬牆連跳", "壁蹴りジャンプ", "Wall-kick jumps"), icon: "🧱", len: [14, 20] },
    seesaw: { name: C("蹺蹺板", "シーソー", "Seesaw"), icon: "⚖", len: [8, 8] },
    dogwalk: { name: C("平衡木", "ドッグウォーク", "Dog walk"), icon: "▬", len: [12, 18] },
    tirerun: { name: C("輪胎陣", "タイヤ踏み", "Tire run"), icon: "⭕", len: [10, 16] },
    ballpit: { name: C("球池", "ボールプール", "Ball pit"), icon: "🔴", len: [8, 14] },
    sprinkler: { name: C("灑水陣", "スプリンクラー", "Sprinklers"), icon: "💦", len: [20, 30] },
    conveyor: { name: C("逆向輸送帶", "逆走ベルト", "Reverse treadmill"), icon: "⇇", len: [10, 16] },
    slide: { name: C("溜滑梯", "すべり台", "Slide"), icon: "⛷", len: [12, 18] },
    trampoline: { name: C("彈跳床", "トランポリン", "Trampoline"), icon: "⤊", len: [10, 14] },
    windmill: { name: C("風車門", "風車ゲート", "Windmill gate"), icon: "✣", len: [8, 8] },
    catzone: { name: C("貓咪誘惑區", "ネコ誘惑ゾーン", "Cat zone"), icon: "🐈", len: [20, 30] },
    sled: { name: C("拖輪胎", "タイヤ引き", "Tire pull"), icon: "⛓", len: [20, 30] },
    ditch: { name: C("跳溝", "溝跳び", "Ditch jump"), icon: "⟗", len: [10, 14] },
    stairs: { name: C("階梯", "階段", "Stairs"), icon: "🪜", len: [10, 16] },
    // 2026-10-29 使用者追加點子：狗狗衝浪、狗狗滑板、狗狗滑雪（狗狗跳火圈＝上面的風火輪）
    surf: { name: C("狗狗衝浪", "ドッグサーフィン", "Dog surfing"), icon: "🏄", len: [24, 36] },
    skateboard: { name: C("狗狗滑板", "ドッグスケボー", "Dog skateboard"), icon: "🛹", len: [25, 40] },
    ski: { name: C("狗狗滑雪", "ドッグスキー", "Dog skiing"), icon: "🎿", len: [30, 45] }
  };
  // 跨欄類（障礙跳高＋跨欄賽道）：每場至少一個（saigo_core.js makeCourse）
  var HURDLE_TYPES = { hurdle: 1, hurdlerace: 1 };
  // 新關卡的預設權重：跨欄類權重最高，其餘依地形在 TERRAINS 裡覆寫
  var NEW_PART_WEIGHTS = {
    hurdlerace: 16, firewheel: 4, looptube: 3, climbwall: 4, wallkick: 3, seesaw: 3, dogwalk: 3, tirerun: 3, ballpit: 3,
    sprinkler: 3, conveyor: 3, slide: 3, trampoline: 3, windmill: 3, catzone: 3, sled: 3, ditch: 3, stairs: 3,
    surf: 3, skateboard: 3, ski: 3
  };
  // 關卡變體（kind）：同一種關卡在不同地形有不同樣貌與規則
  var KINDS = {
    hurdle: {
      bar: C("障礙跳高", "ハードル", "Hurdles"), hay: C("乾草捆", "干し草ロール", "Hay bales"), tire: C("輪胎圈", "タイヤくぐり", "Tire jump"),
      log: C("倒木跨越", "倒木越え", "Fallen logs"), snowbank: C("雪堆跨越", "雪山越え", "Snowbanks")
    },
    mud: { mud: C("泥巴地", "泥んこ地帯", "Mud pit"), snow: C("深雪區", "深雪ゾーン", "Deep snow"), sand: C("沙坑", "砂地獄", "Sand trap") },
    pool: {
      std: C("標準泳池", "プール", "Swim pool"), deep: C("深水池", "深いプール", "Deep pool"), shallow: C("淺灘涉水", "浅瀬", "Shallows"),
      stream: C("激流渡河", "急流", "Rapids"), dock: C("跳水台泳池", "ドックダイビング", "Dock diving"), ice: C("冰水池", "氷水プール", "Icy pool")
    },
    hill: { grass: C("草坡", "芝の坂", "Grass hill"), snow: C("雪坡", "雪の坂", "Snow slope"), dune: C("沙丘", "砂丘", "Sand dune") }
  };
  // 隨機場地時，零件出現的權重（直道／彎道另外補足）——預設值，各地形在 TERRAINS 裡另訂
  var PART_WEIGHTS = { hurdle: 24, tunnel: 8, frisbee: 8, weave: 7, pool: 6, mud: 6, aframe: 5, treat: 6, stay: 4 };

  var WEATHERS = {
    sunny: { name: C("晴", "晴れ", "Sunny"), icon: "☀", temp: 0 },
    cloudy: { name: C("陰", "曇り", "Cloudy"), icon: "☁", temp: 0 },
    hot: { name: C("炎熱", "猛暑", "Heatwave"), icon: "🔥", temp: 2 },
    rain: { name: C("雨", "雨", "Rain"), icon: "☂", temp: 0 },
    snow: { name: C("雪", "雪", "Snow"), icon: "❄", temp: -2 },
    windy: { name: C("強風", "強風", "Windy"), icon: "🌀", temp: 0 },
    typhoon: { name: C("颱風", "台風", "Typhoon"), icon: "🌪", temp: 0 },
    blizzard: { name: C("暴風雪", "吹雪", "Blizzard"), icon: "🌨", temp: -3 },
    sandstorm: { name: C("沙塵暴", "砂嵐", "Sandstorm"), icon: "🏜", temp: 2 },
    fog: { name: C("濃霧", "濃霧", "Fog"), icon: "🌫", temp: 0 }
  };
  // 路面：grip 抓地、drag 速度倍率、stam 耐力消耗倍率（再乘上場地狀態 GROUNDS）
  var SURFACES = {
    dirt: { name: C("泥土", "ダート", "Dirt"), grip: 1, drag: 1, stam: 1 },
    snow: { name: C("雪地", "雪", "Snow"), grip: 0.84, drag: 0.95, stam: 1.15 },
    sand: { name: C("沙地", "砂", "Sand"), grip: 0.9, drag: 0.94, stam: 1.22 }
  };
  // 地形：路面、天氣機率、關卡權重、各關卡變體的權重
  var TERRAINS = {
    park: {
      name: C("公園草地", "公園", "Park"), icon: "🌳", surf: "dirt",
      weathers: { sunny: 28, cloudy: 20, hot: 10, rain: 14, windy: 12, typhoon: 5, fog: 7, snow: 4 },
      parts: { hurdle: 10, tunnel: 8, frisbee: 8, weave: 7, pool: 6, mud: 4, aframe: 5, treat: 6, stay: 4, hill: 3, bridge: 1 },
      kinds: { hurdle: { bar: 6, hay: 3, tire: 3 }, mud: { mud: 1 }, pool: { std: 5, deep: 3, dock: 4, shallow: 1 }, hill: { grass: 1 } }
    },
    forest: {
      name: C("森林步道", "森の小道", "Forest trail"), icon: "🌲", surf: "dirt",
      weathers: { cloudy: 25, rain: 22, fog: 20, sunny: 18, windy: 10, typhoon: 5 },
      parts: { hurdle: 10, tunnel: 5, frisbee: 4, weave: 6, pool: 6, mud: 7, aframe: 3, treat: 5, stay: 3, hill: 5, bridge: 7 },
      kinds: { hurdle: { log: 6, bar: 1, tire: 2 }, mud: { mud: 1 }, pool: { stream: 5, shallow: 3, deep: 1 }, hill: { grass: 1 } }
    },
    snowmtn: {
      name: C("雪山", "雪山", "Snowy mountain"), icon: "🏔", surf: "snow",
      weathers: { snow: 35, blizzard: 18, cloudy: 18, sunny: 20, windy: 9 },
      parts: { hurdle: 7, tunnel: 5, frisbee: 4, weave: 4, pool: 4, mud: 8, aframe: 3, treat: 4, stay: 3, hill: 9, bridge: 5 },
      kinds: { hurdle: { snowbank: 5, bar: 2, log: 2 }, mud: { snow: 1 }, pool: { ice: 5, std: 1 }, hill: { snow: 1 } }
    },
    desert: {
      name: C("沙漠", "砂漠", "Desert"), icon: "🏜", surf: "sand",
      weathers: { hot: 35, sunny: 30, sandstorm: 18, windy: 14, rain: 3 },
      parts: { hurdle: 7, tunnel: 6, frisbee: 6, weave: 5, pool: 3, mud: 7, aframe: 3, treat: 5, stay: 3, hill: 10 },
      kinds: { hurdle: { tire: 3, bar: 2, hay: 2 }, mud: { sand: 1 }, pool: { shallow: 3, std: 2 }, hill: { dune: 1 } }
    },
    beach: {
      name: C("海灘", "ビーチ", "Beach"), icon: "🏖", surf: "sand",
      weathers: { sunny: 32, hot: 18, windy: 18, typhoon: 10, rain: 12, cloudy: 10 },
      parts: { hurdle: 7, tunnel: 5, frisbee: 10, weave: 5, pool: 9, mud: 6, aframe: 3, treat: 6, stay: 4, hill: 3 },
      kinds: { hurdle: { tire: 3, bar: 2, log: 1 }, mud: { sand: 1 }, pool: { shallow: 4, stream: 2, dock: 3, std: 1 }, hill: { dune: 1 } }
    }
  };
  // 新關卡權重套進各地形（地形倍率：雪山多爬高、少灑水；沙漠多拖輪胎、跳溝；海灘多球池與灑水；森林多爬高與平衡木）
  var TERRAIN_NEW_MULT = {
    // 衝浪只在有水的地形、滑雪只在雪山（森林偶爾）、滑板不上雪地
    park: { sprinkler: 1.5, slide: 1.5, trampoline: 1.5, ballpit: 1.3, surf: 0.7, ski: 0, skateboard: 1.6 },
    forest: { climbwall: 1.8, dogwalk: 1.8, ditch: 1.5, wallkick: 1.3, sprinkler: 0.5, conveyor: 0.5, surf: 0.3, ski: 0.5, skateboard: 0.5 },
    snowmtn: { climbwall: 1.6, stairs: 1.5, sled: 1.8, sprinkler: 0, ballpit: 0.5, firewheel: 1.3, surf: 0, ski: 3, skateboard: 0 },
    desert: { sled: 1.8, ditch: 1.6, firewheel: 1.5, sprinkler: 0.4, ballpit: 0.5, surf: 0, ski: 0, skateboard: 0.8 },
    beach: { ballpit: 1.8, sprinkler: 1.6, trampoline: 1.4, looptube: 1.2, stairs: 0.6, surf: 3, ski: 0, skateboard: 1.2 }
  };
  Object.keys(TERRAINS).forEach(function (id) {
    var T = TERRAINS[id], m = TERRAIN_NEW_MULT[id] || {};
    T.parts.hurdle = Math.max(T.parts.hurdle, 24);
    Object.keys(NEW_PART_WEIGHTS).forEach(function (k) {
      var w = NEW_PART_WEIGHTS[k] * (m[k] === undefined ? 1 : m[k]);
      if (w > 0) T.parts[k] = Math.round(w * 10) / 10;
    });
  });

  // 距離：關卡數範圍與直道長度倍率
  var DISTANCES = {
    sprint: { name: C("短距離", "短距離", "Sprint"), parts: [3, 4], straight: 0.8, w: 30 },
    middle: { name: C("中距離", "中距離", "Middle"), parts: [4, 7], straight: 1, w: 45 },
    long: { name: C("長距離", "長距離", "Long"), parts: [7, 10], straight: 1.15, w: 25 }
  };
  // 關卡顯示名稱（有變體就用變體名稱）
  function partName(p) {
    var k = p.kind && KINDS[p.type] && KINDS[p.type][p.kind];
    return L(k || (PARTS[p.type] || PARTS.straight).name);
  }
  // 場地狀態：grip 抓地（彎道上限）、drag 速度倍率、stam 耐力消耗倍率
  var GROUNDS = {
    firm: { name: C("良", "良", "Firm"), grip: 1.0, drag: 1.0, stam: 1.0 },
    good: { name: C("稍重", "稍重", "Good"), grip: 0.95, drag: 0.985, stam: 1.05 },
    soft: { name: C("重", "重", "Soft"), grip: 0.88, drag: 0.965, stam: 1.12 },
    heavy: { name: C("不良", "不良", "Heavy"), grip: 0.8, drag: 0.94, stam: 1.2 }
  };
  // 調子：倍率套在所有能力上
  var MOODS = [
    { id: 0, name: C("絕不調", "絶不調", "Awful"), icon: "⇊", mult: 0.92 },
    { id: 1, name: C("不調", "不調", "Poor"), icon: "↘", mult: 0.96 },
    { id: 2, name: C("普通", "普通", "Normal"), icon: "→", mult: 1.0 },
    { id: 3, name: C("好調", "好調", "Good"), icon: "↗", mult: 1.04 },
    { id: 4, name: C("絕好調", "絶好調", "Great"), icon: "⇈", mult: 1.08 }
  ];

  // 枠色（1 白 2 黑 3 紅 4 藍 5 黃 6 綠，與日本賽馬相同）
  var GATE_COLORS = ["#f5f5f5", "#222222", "#d32f2f", "#1e5bd6", "#f2c418", "#2e9a4a"];
  var GATE_TEXT = ["#222", "#fff", "#fff", "#fff", "#222", "#fff"];
  var FIELD = 6;

  // 下注種類。pick＝要選幾隻；ordered＝是否有順序
  var BET_TYPES = [
    { id: "win", name: C("單勝", "単勝", "Win"), pick: 1, ordered: true, take: 0.8 },
    { id: "place", name: C("複勝", "複勝", "Place"), pick: 1, ordered: true, take: 0.8 },
    { id: "quinella", name: C("二連複", "馬連", "Quinella"), pick: 2, ordered: false, take: 0.775 },
    { id: "exacta", name: C("二連單", "馬単", "Exacta"), pick: 2, ordered: true, take: 0.75 },
    { id: "wide", name: C("寬（任二進前三）", "ワイド", "Wide"), pick: 2, ordered: false, take: 0.775 },
    { id: "trio", name: C("三連複", "三連複", "Trio"), pick: 3, ordered: false, take: 0.75 },
    { id: "trifecta", name: C("三連單", "三連単", "Trifecta"), pick: 3, ordered: true, take: 0.725 }
  ];

  // 賽事等級：CPU 的訓練加成範圍與獎金倍率
  var CLASSES = [
    { id: "rookie", name: C("新手戰", "新馬戦", "Rookie"), cpu: [0, 8], prize: 1 },
    { id: "open", name: C("一般戰", "一般戦", "Open"), cpu: [6, 18], prize: 2 },
    { id: "stakes", name: C("重賞", "重賞", "Stakes"), cpu: [16, 30], prize: 4 }
  ];
  var PRIZES = [3000, 1500, 800, 300, 200, 200];

  var NAMES = {
    zh: ["小黑", "旺財", "豆豆", "阿福", "麻糬", "布丁", "可樂", "黑輪", "饅頭", "球球", "小虎", "來福", "多多", "嘟嘟", "皮皮", "芝麻", "湯圓", "奶茶", "雪球", "大寶", "花生", "米漿", "毛毛", "阿金", "閃電", "疾風", "飛毛腿", "小白", "胖虎", "阿肥"],
    ja: ["ポチ", "ハチ", "タロウ", "コタロウ", "モモ", "ソラ", "ハナ", "マル", "チョコ", "レオ", "ムギ", "コムギ", "サクラ", "ココ", "リキ", "ゴン", "クウ", "ハヤテ", "イナズマ", "シロ", "クロ", "チビ", "ゲン", "ダイフク", "キナコ", "アズキ", "ラッキー", "ジロウ", "フク", "ユキ"]
  };

  window.PriTestSaigoData = {
    C: C, L: L, STATS: STATS, SIZES: SIZES, STYLES: STYLES,
    BREEDS: BREEDS, BREED_BY_ID: BREED_BY_ID,
    PARTS: PARTS, PART_WEIGHTS: PART_WEIGHTS, HURDLE_TYPES: HURDLE_TYPES, WEATHERS: WEATHERS, GROUNDS: GROUNDS, MOODS: MOODS,
    KINDS: KINDS, SURFACES: SURFACES, TERRAINS: TERRAINS, DISTANCES: DISTANCES, partName: partName,
    GATE_COLORS: GATE_COLORS, GATE_TEXT: GATE_TEXT, FIELD: FIELD,
    BET_TYPES: BET_TYPES, CLASSES: CLASSES, PRIZES: PRIZES, NAMES: NAMES
  };
})();
