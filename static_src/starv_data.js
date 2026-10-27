// 明星經紀 starV：靜態資料（規格見 docs/superpowers/specs/2026-10-27-starv-design.md）。
// 只放資料與常數，不放邏輯；邏輯在 starv_core.js。雙語文字一律 { zh, ja }，en 沿用 ja。
(function () {
  "use strict";

  var root = typeof window !== "undefined" ? window : globalThis;

  // "中文|日文" → { zh, ja }
  function T(s) { var p = s.split("|"); return { zh: p[0], ja: p[1] || p[0] }; }
  function TL(arr) { return arr.map(T); }
  function index(list) { var m = {}; list.forEach(function (x) { m[x.id] = x; }); return m; }

  var STATS = ["act", "vocal", "dance", "talk", "charm", "sense"];
  var STAT_NAMES = {
    act: T("演技|演技"), vocal: T("歌唱|歌唱"), dance: T("舞蹈|ダンス"),
    talk: T("口才|トーク"), charm: T("魅力|魅力"), sense: T("創意|センス")
  };

  // 適性：mult＝成長倍率，cap＝潛力上限係數（§3.2）
  var APT = {
    S: { mult: 1.6, cap: 1.1 }, A: { mult: 1.3, cap: 1.0 }, B: { mult: 1.0, cap: 0.9 },
    C: { mult: 0.8, cap: 0.75 }, D: { mult: 0.6, cap: 0.6 }
  };
  var APT_ORDER = ["S", "A", "B", "C", "D"];

  // 稀有度（§3.3）：capBase × 適性 cap ＝ 潛力上限（最高 999）
  var RARITY = {
    R: { capBase: 450, statTotal: [80, 150], salary: [1500, 3000], traits: [0, 1] },
    SR: { capBase: 700, statTotal: [200, 300], salary: [8000, 8000], traits: [1, 2] },
    SSR: { capBase: 910, statTotal: [350, 450], salary: [20000, 20000], traits: [2, 2] }
  };
  var R_APT_WEIGHTS = { S: 2, A: 12, B: 40, C: 30, D: 16 };

  // 成長方向（§3.4）。weights 總和為 1；peak＝生涯巔峰年齡；retire＝引退線；
  // group＝會出現團體工作；title＝作品名格式與詞庫（{a}{b} 各從詞庫抽一個）
  function dir(id, name, weights, peak, retire, color, icon, group, fmt, a, b) {
    return { id: id, name: T(name), weights: weights, peak: peak, retire: retire, color: color, icon: icon, group: group,
      title: { fmt: T(fmt), a: TL(a), b: TL(b) } };
  }
  var DIRS = [
    dir("film", "電影|映画", { act: 0.5, charm: 0.25, sense: 0.15, talk: 0.1 }, [22, 45], 65, "#e0b04a", "🎬", false,
      "電影《{a}{b}》|映画『{a}{b}』",
      ["午夜的|真夜中の", "最後的|最後の", "沉默的|沈黙の", "星空下的|星空の", "失落的|失われた", "第十三號|十三番目の"],
      ["列車|列車", "證人|証人", "約定|約束", "王國|王国", "夏天|夏", "迷宮|迷宮"]),
    dir("drama", "電視劇|ドラマ", { act: 0.45, charm: 0.3, talk: 0.15, sense: 0.1 }, [20, 40], 60, "#ff8a65", "📺", false,
      "劇集《{a}{b}》|ドラマ『{a}{b}』",
      ["戀愛的|恋する", "東京|東京", "急診室的|救命室の", "豪門|名家の", "便利商店的|コンビニの", "重返|もう一度の"],
      ["七日|七日間", "女王|女王", "醫生|ドクター", "秘密|秘密", "戀人|恋人", "青春|青春"]),
    dir("singer", "歌手|歌手", { vocal: 0.5, charm: 0.2, sense: 0.2, dance: 0.1 }, [18, 35], 55, "#ff5fa8", "🎤", false,
      "單曲〈{a}{b}〉|シングル「{a}{b}」",
      ["霓虹|ネオン", "午後的|午後の", "星光|星屑の", "透明的|透明な", "遠方的|遠い", "夏日|夏の"],
      ["雨|雨", "告白|告白", "旋律|メロディ", "心跳|鼓動", "晚安|おやすみ", "翅膀|翼"]),
    dir("idol", "偶像|アイドル", { charm: 0.35, dance: 0.3, vocal: 0.25, talk: 0.1 }, [16, 26], 30, "#ff9de2", "💖", true,
      "偶像企劃「{a}{b}」|アイドル企画「{a}{b}」",
      ["閃耀|キラキラ", "甜蜜|スイート", "奇蹟|ミラクル", "戀愛|ラブ", "元氣|元気", "彩虹|レインボー"],
      ["舞台|ステージ", "宣言|宣言", "派對|パーティー", "偶像祭|アイドル祭", "握手會|握手会", "巡演|ツアー"]),
    dir("cm", "廣告|CM", { charm: 0.6, act: 0.2, sense: 0.2 }, [18, 35], 50, "#4dd0e1", "📣", false,
      "廣告「{a}{b}」|CM「{a}{b}」",
      ["極光|オーロラ", "晨曦|朝焼け", "雪花|スノー", "海風|潮風", "森林|フォレスト", "蜜桃|ピーチ"],
      ["氣泡水|ソーダ", "洗髮精|シャンプー", "咖啡|コーヒー", "手機|スマホ", "汽車|カー", "冰淇淋|アイス"]),
    dir("host", "主持人|司会", { talk: 0.55, sense: 0.25, charm: 0.2 }, [25, 55], 65, "#ffd66b", "🎙️", false,
      "節目「{a}{b}」|番組「{a}{b}」",
      ["明星|スター", "週末|週末", "深夜|深夜の", "全民|みんなの", "驚奇|ドッキリ", "美食|グルメ"],
      ["大逃亡|大脱走", "會客室|応接室", "挑戰王|チャレンジ王", "大集合|大集合", "夜話|ナイト", "遊樂園|遊園地"]),
    dir("dancer", "舞團|ダンスグループ", { dance: 0.65, charm: 0.2, sense: 0.15 }, [18, 30], 38, "#7c4dff", "🕺", true,
      "舞蹈公演「{a}{b}」|ダンス公演「{a}{b}」",
      ["赤焰|紅蓮", "街頭|ストリート", "月光|月光", "律動|ビート", "疾風|疾風", "水晶|クリスタル"],
      ["之舞|の舞", "對決|バトル", "狂想曲|ラプソディ", "革命|レボリューション", "交響|シンフォニー", "祭典|フェス"]),
    dir("anchor", "主播|キャスター", { talk: 0.6, sense: 0.25, charm: 0.15 }, [25, 50], 60, "#90a4ae", "📰", false,
      "新聞「{a}{b}」|ニュース「{a}{b}」",
      ["晨間|モーニング", "晚間|イブニング", "週末|ウィークエンド", "財經|経済", "午夜|ミッドナイト", "現場|現場"],
      ["快報|速報", "焦點|フォーカス", "新聞台|ニュース", "直擊|直撃", "觀察|ウォッチ", "解讀|解説"]),
    dir("vtuber", "虛擬主播|VTuber", { talk: 0.4, sense: 0.3, vocal: 0.2, act: 0.1 }, [18, 40], 50, "#69f0ae", "🖥️", false,
      "直播企劃「{a}{b}」|配信企画「{a}{b}」",
      ["深夜|深夜", "耐久|耐久", "歌回|歌枠", "雜談|雑談", "新衣裝|新衣装", "聯動|コラボ"],
      ["直播|配信", "挑戰|チャレンジ", "祭|祭り", "首播|お披露目", "馬拉松|マラソン", "大會|大会"]),
    dir("band", "樂團|バンド", { sense: 0.45, vocal: 0.3, charm: 0.15, dance: 0.1 }, [18, 40], 55, "#ff7043", "🎸", true,
      "專輯《{a}{b}》|アルバム『{a}{b}』",
      ["破曉的|夜明けの", "電氣|エレクトリック", "地下室的|地下室の", "逆風的|向かい風の", "鐵鏽|錆びた", "藍色|青い"],
      ["樂章|楽章", "吉他|ギター", "共鳴|共鳴", "公路|ハイウェイ", "季節|季節", "心臟|心臓"]),
    dir("voice", "聲優|声優", { act: 0.5, vocal: 0.25, talk: 0.25 }, [20, 45], 65, "#b388ff", "🎧", false,
      "動畫《{a}{b}》|アニメ『{a}{b}』",
      ["魔法|魔法", "機動|機動", "異世界|異世界", "星際|星間", "放學後的|放課後の", "劍與|剣と"],
      ["少女|少女", "戰記|戦記", "物語|物語", "學園|学園", "騎士|騎士", "旅人|旅人"]),
    dir("stage", "舞台劇|舞台", { act: 0.5, vocal: 0.2, dance: 0.2, talk: 0.1 }, [25, 50], 65, "#c62828", "🎭", false,
      "舞台劇《{a}{b}》|舞台『{a}{b}』",
      ["雨夜的|雨夜の", "玻璃|硝子の", "王子與|王子と", "時鐘|時計", "劇場的|劇場の", "黎明的|黎明の"],
      ["獨白|独白", "假面|仮面", "天使|天使", "城堡|城", "幽靈|亡霊", "告別|別れ"]),
    dir("model", "模特兒|モデル", { charm: 0.7, dance: 0.15, sense: 0.15 }, [17, 28], 35, "#f5f5f5", "👗", false,
      "時尚秀「{a}{b}」|ファッションショー「{a}{b}」",
      ["巴黎|パリ", "春夏|春夏", "秋冬|秋冬", "白金|プラチナ", "黑曜|オブシディアン", "晴空|晴天"],
      ["時裝週|コレクション", "封面|表紙", "伸展台|ランウェイ", "特輯|特集", "大片|グラビア", "系列|ライン"]),
    dir("comedy", "搞笑藝人|お笑い芸人", { talk: 0.5, sense: 0.35, act: 0.15 }, [22, 50], 65, "#ffee58", "😂", false,
      "綜藝「{a}{b}」|お笑い「{a}{b}」",
      ["爆笑|爆笑", "漫才|漫才", "整人|ドッキリ", "吐槽|ツッコミ", "即興|即興", "冷笑話|ダジャレ"],
      ["大賽|グランプリ", "劇場|劇場", "王|王", "之夜|ナイト", "擂台|バトル", "特攻隊|特攻隊"]),
    dir("influencer", "網紅|インフルエンサー", { charm: 0.35, talk: 0.35, sense: 0.3 }, [16, 30], 40, "#ec407a", "📱", false,
      "網路企劃「{a}{b}」|ネット企画「{a}{b}」",
      ["開箱|開封", "旅行|旅", "美妝|コスメ", "一日|1日", "挑戰|チャレンジ", "日常|日常"],
      ["實況|実況", "Vlog|Vlog", "教學|講座", "體驗|体験", "合作|コラボ", "特輯|特集"]),
    dir("composer", "配樂創作|作曲家", { sense: 0.7, vocal: 0.3 }, [22, 60], 70, "#26a69a", "🎼", false,
      "配樂《{a}{b}》|劇伴『{a}{b}』",
      ["交響|交響", "幻想|幻想", "鋼琴|ピアノ", "電子|エレクトロ", "永恆的|永遠の", "微光的|微光の"],
      ["組曲|組曲", "序曲|序曲", "主題|テーマ", "夜想曲|ノクターン", "原聲帶|サウンドトラック", "協奏|協奏曲"])
  ];

  // 工作角色（§6.2）：diff＝難度倍率；pay／fame＝酬勞、人氣倍率。group＝團體工作
  var ROLES = {
    lead: { name: T("主角|主演"), diff: 1.2, pay: 1.3, fame: 1.3 },
    support: { name: T("配角|助演"), diff: 1.0, pay: 1.0, fame: 1.0 },
    cameo: { name: T("客串|ゲスト"), diff: 0.8, pay: 0.6, fame: 0.6 },
    group: { name: T("團體|グループ"), diff: 1.0, pay: 1.0, fame: 1.0 }
  };

  // 工作等級（§6.2、§6.3）：unlock＝需要的公司等級；w＝看板出現權重；load＝體力／壓力負擔倍率
  var TIERS = {
    D: { diff: 60, pay: 2000, fame: 5, rep: 5, days: [1, 3], minFame: 0, minProf: 1, unlock: 1, w: 30, load: 1.0 },
    C: { diff: 150, pay: 6000, fame: 15, rep: 15, days: [2, 5], minFame: 50, minProf: 1, unlock: 1, w: 35, load: 1.1 },
    B: { diff: 300, pay: 15000, fame: 40, rep: 40, days: [4, 10], minFame: 300, minProf: 3, unlock: 3, w: 20, load: 1.2 },
    A: { diff: 500, pay: 40000, fame: 100, rep: 100, days: [7, 20], minFame: 1500, minProf: 5, unlock: 4, w: 10, load: 1.35 },
    S: { diff: 750, pay: 120000, fame: 250, rep: 250, days: [14, 30], minFame: 6000, minProf: 7, unlock: 6, w: 5, load: 1.5 }
  };
  var TIER_ORDER = ["D", "C", "B", "A", "S"];

  // 判定結果（§6.3）：min＝比率門檻；xp＝熟練度經驗（再乘上等級序號＋1）
  var RESULTS = {
    great: { min: 1.4, pay: 1.5, fame: 1.5, rep: 1.5, stars: [4, 5], xp: 3, sat: 3 },
    success: { min: 1.0, pay: 1.0, fame: 1.0, rep: 1.0, stars: [3, 4], xp: 2, sat: 1 },
    normal: { min: 0.7, pay: 0.7, fame: 0.5, rep: 0.5, stars: [2, 3], xp: 1, sat: 0 },
    fail: { min: 0, pay: 0.3, fame: -0.5, rep: 0, stars: [1, 1], xp: 1, sat: -3 }
  };

  // 熟練度：PROF_XP[lv] ＝ 到達該等級所需累計經驗（lv 1～10）
  var PROF_XP = [0, 0, 5, 12, 22, 35, 52, 75, 105, 145, 200];

  // 課程（§6.1）：每項能力有基礎與高級各一；高級課程需要設施或公司等級
  var ADV_NEED = {
    act: { facility: "practice", lv: 1 }, dance: { facility: "practice", lv: 1 },
    vocal: { facility: "studio", lv: 1 }, charm: { facility: "photo", lv: 1 },
    talk: { company: 2 }, sense: { company: 2 }
  };
  var COURSES = [];
  STATS.forEach(function (s) {
    COURSES.push({ id: s + "_1", stat: s, level: 1, days: 3, cost: 1500, gain: 20, stamina: 18, stress: 6, need: null });
    COURSES.push({ id: s + "_2", stat: s, level: 2, days: 6, cost: 6000, gain: 50, stamina: 30, stress: 12, need: ADV_NEED[s] });
  });
  var TRAIN = { days: 2, gain: 10, stamina: 25, stress: 8 };
  var REST = { stamina: 25, stress: 12 };              // 每天回復量
  var PROMO = { days: 2, cost: 1000, fame: 10, stamina: 10, stress: 4 };

  // 特質（§3.2）
  function trait(id, name, desc, fx) { return { id: id, name: T(name), desc: T(desc), fx: fx }; }
  function dirs(list, v) { return { dirs: list, v: v }; }
  var TRAITS = [
    trait("hardworker", "努力家|努力家", "課程效果 +20%|レッスン効果 +20%", { growthCourse: 1.2 }),
    trait("genius", "天才肌|天才肌", "成長 +15%、壓力累積 +20%|成長 +15%、ストレス +20%", { growth: 1.15, stress: 1.2 }),
    trait("camera", "鏡頭寵兒|カメラ映え", "廣告／電視劇／模特兒表現 +15%|CM・ドラマ・モデルの表現 +15%", { perfDirs: dirs(["cm", "drama", "model"], 1.15) }),
    trait("glass", "玻璃心|ガラスのハート", "壓力累積 ×1.5|ストレス ×1.5", { stress: 1.5 }),
    trait("tough", "鐵人|鉄人", "體力消耗 -25%|体力消費 -25%", { stamina: 0.75 }),
    trait("nightowl", "夜貓子|夜型", "虛擬主播／主持人／主播表現 +10%|VTuber・司会・キャスターの表現 +10%", { perfDirs: dirs(["vtuber", "host", "anchor"], 1.1) }),
    trait("buzz", "話題體質|話題体質", "事件發生率 ×2、人氣獲得 +20%|イベント発生率 ×2、人気 +20%", { eventRate: 2, fame: 1.2 }),
    trait("lucky", "幸運兒|強運", "表現 +5%|表現 +5%", { perf: 1.05 }),
    trait("stagefright", "怯場|あがり症", "表現 -10%、訓練效果 +10%|表現 -10%、トレーニング効果 +10%", { perf: 0.9, growthTrain: 1.1 }),
    trait("showman", "表演慾|目立ちたがり", "偶像／搞笑／主持人表現 +12%|アイドル・お笑い・司会の表現 +12%", { perfDirs: dirs(["idol", "comedy", "host"], 1.12) }),
    trait("perfectionist", "完美主義|完璧主義", "成長 +10%、壓力累積 +30%|成長 +10%、ストレス +30%", { growth: 1.1, stress: 1.3 }),
    trait("easygoing", "隨和|マイペース", "壓力累積 -30%、成長 -5%|ストレス -30%、成長 -5%", { stress: 0.7, growth: 0.95 }),
    trait("sweetvoice", "好嗓子|美声", "歌手／聲優／樂團表現 +12%|歌手・声優・バンドの表現 +12%", { perfDirs: dirs(["singer", "voice", "band"], 1.12) }),
    trait("supple", "柔軟體|しなやか", "舞團／偶像／舞台劇表現 +12%|ダンス・アイドル・舞台の表現 +12%", { perfDirs: dirs(["dancer", "idol", "stage"], 1.12) }),
    trait("witty", "機智|機転", "搞笑／主持人／網紅表現 +12%|お笑い・司会・インフルエンサーの表現 +12%", { perfDirs: dirs(["comedy", "host", "influencer"], 1.12) }),
    trait("bookworm", "博學|博識", "主播／配樂表現 +12%|キャスター・作曲の表現 +12%", { perfDirs: dirs(["anchor", "composer"], 1.12) }),
    trait("figure", "衣架子|モデル体型", "模特兒／廣告表現 +15%|モデル・CMの表現 +15%", { perfDirs: dirs(["model", "cm"], 1.15) }),
    trait("method", "方法派|憑依型", "電影／舞台劇／電視劇表現 +12%|映画・舞台・ドラマの表現 +12%", { perfDirs: dirs(["film", "stage", "drama"], 1.12) }),
    trait("gamer", "遊戲宅|ゲーマー", "虛擬主播／網紅表現 +12%|VTuber・インフルエンサーの表現 +12%", { perfDirs: dirs(["vtuber", "influencer"], 1.12) }),
    trait("melody", "旋律腦|メロディメーカー", "配樂／樂團／歌手表現 +10%|作曲・バンド・歌手の表現 +10%", { perfDirs: dirs(["composer", "band", "singer"], 1.1) }),
    trait("thrifty", "精打細算|しっかり者", "工作酬勞 +10%|ギャラ +10%", { pay: 1.1 }),
    trait("humble", "謙虛|謙虚", "人氣獲得 -10%、壓力累積 -20%|人気 -10%、ストレス -20%", { fame: 0.9, stress: 0.8 }),
    trait("aura", "明星光環|スターオーラ", "人氣獲得 +25%|人気 +25%", { fame: 1.25 }),
    trait("frail", "體弱|病弱", "體力消耗 +30%|体力消費 +30%", { stamina: 1.3 }),
    trait("quick", "學得快|飲み込みが早い", "訓練效果 +25%|トレーニング効果 +25%", { growthTrain: 1.25 })
  ];

  // 工作中的小事件（§6.3）：fx 可用 eventMod（加到表現的事件修正）、stamina、stress、mood、fame（直接增減）
  function minor(id, w, text, bad, fx) { return { id: id, w: w, text: T(text), bad: bad, fx: fx }; }
  var MINOR_EVENTS = [
    minor("ng", 10, "片場 NG 連連|NG連発", true, { eventMod: -0.1 }),
    minor("adlib", 8, "導演即興加戲|監督のアドリブ指示", false, { eventMod: 0.15 }),
    minor("cold", 6, "感冒了|風邪をひいた", true, { stamina: -20 }),
    minor("fans", 8, "粉絲探班|ファンの差し入れ", false, { mood: 1 }),
    minor("chem", 8, "與共演者很合拍|共演者と意気投合", false, { eventMod: 0.1 }),
    minor("script", 6, "劇本大改|台本の大幅修正", true, { eventMod: -0.08, stress: 5 }),
    minor("late", 5, "遲到挨罵|遅刻して叱られた", true, { mood: -1 }),
    minor("viral", 4, "幕後花絮爆紅|メイキングがバズった", false, { fame: 20 }),
    minor("nervous", 7, "太緊張|緊張しすぎ", true, { eventMod: -0.05 }),
    minor("praise", 6, "受到前輩稱讚|先輩に褒められた", false, { mood: 1, stress: -5 })
  ];

  // 設施（§8.2）：升級費用 ＝ base × growth^(目前等級 − start)，取整到千
  function fac(o, name, desc) { o.name = T(name); o.desc = T(desc); return o; }
  var FACILITIES = {
    dorm: fac({ max: 10, start: 1, base: 30000, growth: 1.8 }, "宿舍|寮", "藝人人數上限；不受公司等級限制|タレントの人数上限。事務所レベルの制限なし"),
    practice: fac({ max: 5, start: 0, base: 80000, growth: 2, trainGrowth: 0.1 }, "練習室|練習室", "訓練效果 +10%／級；Lv1 解鎖演技、舞蹈高級課|トレーニング効果 +10%／Lv。Lv1 で演技・ダンスの上級レッスン解放"),
    studio: fac({ max: 5, start: 0, base: 100000, growth: 2, stats: ["vocal"], dirs: ["singer", "band", "voice", "composer"], v: 0.04 },
      "錄音室|レコーディングスタジオ", "歌唱課與歌手、樂團、聲優、配樂表現 +4%／級；Lv1 解鎖歌唱高級課|歌唱レッスンと歌手・バンド・声優・作曲の表現 +4%／Lv。Lv1 で歌唱の上級レッスン解放"),
    photo: fac({ max: 5, start: 0, base: 100000, growth: 2, stats: ["charm"], dirs: ["cm", "model", "influencer", "vtuber"], v: 0.04 },
      "攝影棚|撮影スタジオ", "魅力課與廣告、模特兒、網紅、虛擬主播表現 +4%／級；Lv1 解鎖魅力高級課|魅力レッスンと CM・モデル・インフルエンサー・VTuber の表現 +4%／Lv。Lv1 で魅力の上級レッスン解放"),
    lounge: fac({ max: 5, start: 0, base: 60000, growth: 2, rest: 0.15, stress: 0.05 }, "休息室|ラウンジ", "休息回復 +15%／級，壓力累積 −5%／級|休養の回復 +15%／Lv、ストレス蓄積 −5%／Lv"),
    pr: fac({ max: 5, start: 0, base: 120000, growth: 2, fameDecay: 0.1 }, "公關部|広報部", "人氣衰退 −10%／級，重大事件壞結果 −10%／級|人気の減少 −10%／Lv、重大イベントの悪い結果 −10%／Lv"),
    scout: fac({ max: 5, start: 0, base: 160000, growth: 2 }, "星探部|スカウト部", "一般試鏡 SR +0.3%、SSR +0.05%／級|一般オーディションの SR +0.3%・SSR +0.05%／Lv")
  };
  var FACILITY_ORDER = ["dorm", "practice", "studio", "photo", "lounge", "pr", "scout"];
  var DORM_CAP = [0, 5, 10, 15, 20, 30, 40, 55, 70, 85, 100];

  // 特殊潮流（§8.3）：持續一季，dirs 視同熱門方向
  function trendSp(id, name, desc, dirs) { return { id: id, name: T(name), desc: T(desc), dirs: dirs }; }
  var SPECIAL_TRENDS = [
    trendSp("vtuber_boom", "虛擬主播熱潮|VTuber ブーム", "直播平台爆發，虛擬主播、聲優與配樂需求大增。|配信プラットフォームが急成長。VTuber・声優・作曲の需要が急増。", ["vtuber", "voice", "composer"]),
    trendSp("audition_boom", "選秀節目大爆發|オーディション番組ブーム", "選秀節目收視長紅，偶像與舞團炙手可熱。|オーディション番組が高視聴率。アイドルとダンスグループが引っ張りだこ。", ["idol", "dancer"]),
    trendSp("cinema_revival", "電影復興|映画ルネサンス", "國片票房接連破紀錄，電影與配樂工作湧現。|邦画の興行記録が続々更新。映画と劇伴の仕事が急増。", ["film", "composer"]),
    trendSp("variety_gold", "綜藝黃金期|バラエティ黄金期", "週末綜藝大戰，主持人與搞笑藝人搶手。|週末バラエティ戦争。司会とお笑い芸人が大人気。", ["host", "comedy"]),
    trendSp("fashion_year", "時尚年|ファッションイヤー", "國際品牌接連進駐，模特兒與廣告代言機會變多。|海外ブランドが続々進出。モデルと CM のチャンスが増える。", ["model", "cm"]),
    trendSp("band_revival", "樂團復興|バンドリバイバル", "Live House 一票難求，樂團與歌手再度走紅。|ライブハウスのチケットが即完。バンドと歌手が再ブレイク。", ["band", "singer"])
  ];

  // R 藝人的姓名庫：存檔只存 nameSeed，依目前語言組名字（§3.5）
  var NAMES = {
    zh: {
      family: "林 陳 張 李 王 黃 吳 劉 蔡 楊 許 鄭 謝 郭 洪 曾 周 賴 徐 葉".split(" "),
      f: "雨晴 詩涵 欣妤 語彤 心媛 子晴 品妍 芷若 依晨 宥蓁 若曦 書瑤 思穎 婉婷 采薇 夢潔 安琪 曉彤 星語 予希".split(" "),
      m: "宇翔 柏睿 承恩 冠廷 品睿 子豪 浩宇 俊傑 彥廷 宥辰 振宇 立恆 致遠 皓軒 東霖 家豪 宸睿 予安 明哲 晨熙".split(" ")
    },
    ja: {
      family: "佐藤 鈴木 高橋 田中 伊藤 渡辺 山本 中村 小林 加藤 吉田 山田 佐々木 山口 松本 井上 木村 林 清水 森".split(" "),
      f: "陽菜 結衣 美咲 さくら 葵 凛 楓 芽依 莉子 ひかり 七海 琴音 彩花 美月 千尋 遥 心春 紗希 真央 柚葉".split(" "),
      m: "蓮 湊 陽翔 大和 悠真 樹 蒼 颯 律 奏太 拓海 健太 翔太 優斗 隼人 大輝 春樹 海斗 慎吾 涼".split(" ")
    }
  };
  var UNKNOWN_NAME = T("未知藝人|不明なタレント");

  // 對手公司名＝a + b（§9；全部虛構）
  var RIVAL_NAME = {
    a: TL(["銀河|ギャラクシー", "晨星|モーニングスター", "紅月|レッドムーン", "極光|オーロラ", "天狼|シリウス", "琥珀|アンバー",
      "蒼穹|ソウキュウ", "黑曜|オブシディアン", "白夜|ビャクヤ", "彩虹|レインボー", "流星|メテオ", "星辰|スターズ"]),
    b: TL(["娛樂|エンタテインメント", "經紀|プロダクション", "傳媒|メディア", "事務所|オフィス", "製作|プロ"])
  };

  // 外觀組件數量（2D 頭像與 3D 模型共用；acc ＝ -1 表示沒有配件）
  var LOOK = {
    face: 4, hair: 12, eye: 6, outfit: 8, acc: 6,
    hairColors: ["#1b1b1f", "#4a2f23", "#8a5a3b", "#d9b26f", "#f2e2c4", "#c0392b", "#8e44ad", "#2e86de"],
    skins: ["#ffe0cc", "#f5cba7", "#e0a97e", "#b07850"]
  };

  // 平衡常數（調整數值時改這裡，並重跑 tools/starv_check/sim.js）
  var BAL = {
    dayMs: 60000, offlineCapDays: 480, daysPerMonth: 30, daysPerYear: 360,
    startMoney: 50000, startTickets: 10, startSafeLine: 20000,
    upkeepPerLevel: 1000, fameDecay: 0.02, fameDecayOffPeak: 0.04, salaryFameDiv: 60,
    boardBase: 8, boardPerLevel: 2, boardRefreshDays: 7, jobLifeDays: 14, groupJobChance: 0.35,
    jobStaminaPerDay: 5, jobStressPerDay: 3, jobStaminaMax: 70, jobStressMax: 40,
    minorEventRate: 0.08, lowStamina: 30, lowStaminaMult: 0.8, profPerf: 0.05, moodPerf: 0.05,
    randLo: 0.85, randHi: 1.15, offPeakGrowth: 0.7, forcedRestDays: 3, strikeDays: 7, strikeStressAfter: 60,
    dividendMonths: 3, dividendRate: 0.1,
    waitlistMax: 10, waitlistDays: 30, dismissSalaryMonths: 3,
    pityMax: 150, dailyPullLimit: 30, pullBaseCost: 5000, pullLevelMult: 0.5,
    limitBreakMax: 5, limitBreakCap: 0.05, dupTickets: { SR: 2, SSR: 10 },
    poolRates: { money: { SR: 0.03, SSR: 0.005 }, ticket: { SR: 0.12, SSR: 0.03 } },
    scoutBonus: { SR: 0.003, SSR: 0.0005 }, pickupChance: 0.5,
    levelRep: [500, 1500, 4000, 9000, 18000, 35000, 60000, 100000, 160000],  // levelRep[lv-1]＝升到 lv+1 所需聲望
    levelTickets: 2, chemistryPerJob: 0.02, chemistryMax: 0.2,
    autoRestStamina: 40, autoRestStress: 50, autoRestStressWork: 80, autoMaxTier: "C",
    eventDailyChance: 0.08, eventDeadlineDays: 3, eventMax: 3, prBadCut: 0.1, famousFame: 200, rookieDays: 60,
    fameMilestones: [1000, 5000, 20000, 50000], sellContractMonths: 6, debtCrisisMonths: 3,
    seasonDays: 90, trendHot: 1.5, trendCold: 0.7, specialTrendChance: 0.25, trendBoardHot: 2, trendBoardCold: 0.5,
    tierWeight: { D: 1, C: 2, B: 4, A: 8, S: 16 }, chartBase: 25, chartFameDiv: 100, chartFameBase: 15, chartFillers: 2, chartTopRep: 50, chartTopFame: 100,
    auditionTiers: ["A", "S"], interestChance: 0.3, snatchChance: 0.01, snatchInterestChance: 0.06, auditionRivalWin: 2,
    rivalCount: 5, rivalPowerStart: [80, 140], rivalPowerNew: [80, 120], rivalBankrupt: 40, rivalShockChance: 0.12,
    rivalPerfDiv: 400, rivalYearGrowth: 0.08, rivalStarJoinChance: 0.5,
    logMax: 200, worksMax: 50
  };

  root.PriTestStarvData = {
    T: T, STATS: STATS, STAT_NAMES: STAT_NAMES, APT: APT, APT_ORDER: APT_ORDER, RARITY: RARITY, R_APT_WEIGHTS: R_APT_WEIGHTS,
    DIRS: DIRS, DIR_BY_ID: index(DIRS), ROLES: ROLES, TIERS: TIERS, TIER_ORDER: TIER_ORDER, RESULTS: RESULTS, PROF_XP: PROF_XP,
    COURSES: COURSES, COURSE_BY_ID: index(COURSES), TRAIN: TRAIN, REST: REST, PROMO: PROMO,
    TRAITS: TRAITS, TRAIT_BY_ID: index(TRAITS), MINOR_EVENTS: MINOR_EVENTS,
    FACILITIES: FACILITIES, FACILITY_ORDER: FACILITY_ORDER, SPECIAL_TRENDS: SPECIAL_TRENDS, SPECIAL_TREND_BY_ID: index(SPECIAL_TRENDS), DORM_CAP: DORM_CAP, NAMES: NAMES, UNKNOWN_NAME: UNKNOWN_NAME, RIVAL_NAME: RIVAL_NAME, LOOK: LOOK, BAL: BAL
  };
})();
