// 大名幸村（yukimura）：靜態資料。大名（60+）、武器（24 種攻擊方式 × 10 藩＝240 種）、
// 飾品（25 種東北工藝 × 20 種能力＝500 種）、鄉土料理（30 種拾取道具）、敵人、首領、十大關卡、東北地圖 20 張、本陣強化。
// 規則邏輯在 yukimura_core.js；這裡只放數值與雙語文字（C(zh, ja)）。2026-11-05 依使用者需求新增。
(function () {
  "use strict";

  function C(zh, ja) { return { zh: zh, ja: ja === undefined ? zh : ja }; }
  function L(o) {
    if (!o) return "";
    if (typeof o === "string") return o;
    var lang = window.I18N && window.I18N.getLang ? window.I18N.getLang() : "zh";
    return o[lang] || o.zh || o.ja || "";
  }
  // 人名、地名的日文寫法 → 繁體（只換常見的新字體）
  var TRAD = { "実": "實", "沢": "澤", "戸": "戶", "広": "廣", "継": "繼", "続": "續", "宝": "寶", "黒": "黑", "頼": "賴", "総": "總", "竜": "龍", "辺": "邊", "斎": "齋", "鉄": "鐵", "団": "團", "猪": "豬", "恵": "惠", "県": "縣", "関": "關", "仏": "佛", "楽": "樂", "桜": "櫻", "囲": "圍", "薬": "藥", "円": "圓", "将": "將", "歳": "歲", "乗": "乘", "尽": "盡", "湾": "灣", "賛": "贊", "読": "讀", "与": "與", "国": "國", "剣": "劍", "焼": "燒", "鋳": "鑄", "絵": "繪", "糸": "絲", "麺": "麵", "鶏": "雞", "灯": "燈", "気": "氣", "霊": "靈", "撃": "擊", "弾": "彈", "戦": "戰", "氷": "冰", "黄": "黃", "蔵": "藏", "経": "經", "姫": "姬", "様": "樣", "参": "參", "応": "應", "縄": "繩", "拠": "據", "厳": "嚴", "増": "增", "壊": "壞", "変": "變", "転": "轉", "発": "發", "砕": "碎", "穂": "穗", "銭": "錢", "図": "圖", "覚": "覺", "髪": "髮", "険": "險", "浅": "淺", "稲": "稻", "芸": "藝", "伝": "傳" };
  function tr(s) { return String(s).replace(/./g, function (ch) { return TRAD[ch] || ch; }); }
  function N(ja) { return C(tr(ja), ja); }

  // ---------------- 能力（stat）----------------
  // 飾品、大名特性、本陣強化、地緣加成都用同一組鍵。base＝飾品每級的基本值（稀有度與等級再放大）
  var STATS = [
    { k: "might", icon: "⚔️", pct: true, base: 0.07, name: C("攻擊力", "攻撃力"), noun: C("武運護符", "武運の守り") },
    { k: "area", icon: "🌀", pct: true, base: 0.07, name: C("攻擊範圍", "攻撃範囲"), noun: C("廣目之鏡", "広目の鏡") },
    { k: "cdr", icon: "⏱️", pct: true, base: 0.05, name: C("冷卻縮短", "クールダウン短縮"), noun: C("早鐘", "早鐘") },
    { k: "amount", icon: "✳️", pct: false, base: 0.22, name: C("投射數", "投射数"), noun: C("分身之鈴", "分身の鈴") },
    { k: "dur", icon: "⌛", pct: true, base: 0.08, name: C("持續時間", "持続時間"), noun: C("長命香", "長命香") },
    { k: "speed", icon: "👣", pct: true, base: 0.05, name: C("移動速度", "移動速度"), noun: C("韋駄天草鞋", "韋駄天草鞋") },
    { k: "pspd", icon: "💨", pct: true, base: 0.08, name: C("彈速", "弾速"), noun: C("疾風羽", "疾風の羽") },
    { k: "maxHp", icon: "❤️", pct: false, base: 10, name: C("最大體力", "最大体力"), noun: C("丹田帶", "丹田の帯") },
    { k: "regen", icon: "💚", pct: false, base: 0.2, name: C("體力回復/秒", "体力回復/秒"), noun: C("養生湯", "養生の湯") },
    { k: "armor", icon: "🛡️", pct: false, base: 0.8, name: C("防禦", "防御"), noun: C("胴丸", "胴丸") },
    { k: "magnet", icon: "🧲", pct: true, base: 0.18, name: C("拾取範圍", "回収範囲"), noun: C("吸寄磁石", "吸寄せ磁石") },
    { k: "luck", icon: "🍀", pct: true, base: 0.07, name: C("幸運", "幸運"), noun: C("福招貓", "福招き猫") },
    { k: "growth", icon: "📈", pct: true, base: 0.06, name: C("經驗值", "経験値"), noun: C("學問書", "学問の書") },
    { k: "greed", icon: "💰", pct: true, base: 0.1, name: C("金錢", "金銭"), noun: C("錢袋", "銭袋") },
    { k: "crit", icon: "🎯", pct: true, base: 0.03, name: C("會心率", "会心率"), noun: C("鷹之目", "鷹の目") },
    { k: "critDmg", icon: "💥", pct: true, base: 0.12, name: C("會心傷害", "会心ダメージ"), noun: C("砥石", "砥石") },
    { k: "steal", icon: "🩸", pct: false, base: 0.04, name: C("擊殺回復", "撃破回復"), noun: C("吸血椿", "吸血椿") },
    { k: "thorns", icon: "🌵", pct: false, base: 5, name: C("反擊傷害", "反撃ダメージ"), noun: C("棘鎧", "棘の鎧") },
    { k: "knock", icon: "👊", pct: true, base: 0.12, name: C("擊退", "ノックバック"), noun: C("鐵拳", "鉄拳") },
    { k: "elem", icon: "🔮", pct: true, base: 0.1, name: C("異常強化", "状態異常強化"), noun: C("陰陽玉", "陰陽玉") }
  ];
  var STAT = {};
  STATS.forEach(function (s, i) { s.i = i; STAT[s.k] = s; });

  // ---------------- 十個藩（武器風格、地緣）----------------
  // pref＝縣（地緣加成用）。m＝對武器基礎值的修正。st＝附帶的異常（chill 凍結減速／shock 麻痺／poison 毒／burn 灼燒）
  var PREFS = {
    aomori: { name: N("青森"), color: 0x7fb8e6, bonus: [["area", 0.08], ["dur", 0.12]] },
    iwate: { name: N("岩手"), color: 0x6b6b72, bonus: [["armor", 1.5], ["might", 0.1]] },
    akita: { name: N("秋田"), color: 0xd9b84a, bonus: [["amount", 0.5], ["growth", 0.1]] },
    miyagi: { name: N("宮城"), color: 0x3a4aa8, bonus: [["cdr", 0.06], ["crit", 0.06]] },
    yamagata: { name: N("山形"), color: 0x4f9a5a, bonus: [["regen", 0.6], ["maxHp", 25]] },
    fukushima: { name: N("福島"), color: 0xb83a3a, bonus: [["knock", 0.25], ["might", 0.08]] }
  };
  var VARIANTS = [
    { k: "tsugaru", name: N("津軽"), pref: "aomori", color: 0x9fd8ff, st: "chill", m: { area: 1.05 }, desc: C("寒氣使敵人減速", "冷気で敵を鈍らせる") },
    { k: "nanbu", name: N("南部"), pref: "iwate", color: 0x5d6670, m: { dmg: 1.35, cd: 1.15, knock: 1.3 }, desc: C("南部鐵打造，沉重一擊", "南部鉄の重い一撃") },
    { k: "date", name: N("伊達"), pref: "miyagi", color: 0x3550c8, st: "shock", m: { dmg: 0.92, cd: 0.82 }, desc: C("華麗連擊並帶麻痺", "伊達者の連撃、痺れ付き") },
    { k: "mogami", name: N("最上"), pref: "yamagata", color: 0x6fa36f, m: { area: 1.3, dur: 1.2 }, desc: C("範圍大、持續久", "範囲が広く長持ち") },
    { k: "aizu", name: N("会津"), pref: "fukushima", color: 0xa83232, m: { dmg: 1.1, cd: 1.05, pierce: 2 }, desc: C("會津魂，貫穿多個敵人", "会津魂、多くの敵を貫く") },
    { k: "akita", name: N("秋田"), pref: "akita", color: 0xd9c27a, m: { dmg: 0.82, n: 1 }, desc: C("數量多一發", "数がひとつ多い") },
    { k: "shonai", name: N("庄内"), pref: "yamagata", color: 0x7a5ca8, st: "poison", m: { dur: 1.15 }, desc: C("附帶劇毒", "猛毒付き") },
    { k: "soma", name: N("相馬"), pref: "fukushima", color: 0x8a5a2b, m: { spd: 1.4, knock: 1.8, cd: 0.95 }, desc: C("相馬野馬追的衝勁，擊退強", "野馬追の勢い、強いノックバック") },
    { k: "hiraizumi", name: N("平泉"), pref: "iwate", color: 0xf2c230, m: { dmg: 1.05, crit: 0.15, gold: 1 }, desc: C("黃金加持：會心率高、擊殺掉錢", "黄金の加護：会心が出やすく銭を落とす") },
    { k: "tono", name: N("遠野"), pref: "iwate", color: 0xff7a3a, st: "burn", m: { dmg: 0.95 }, desc: C("狐火灼燒", "狐火で焼く") }
  ];

  // ---------------- 24 種攻擊方式 ----------------
  // kind 決定行為（yukimura_core.js 的 fire()）。b：dmg 傷害、cd 冷卻秒、area 範圍、n 數量、spd 彈速、pierce 貫穿、dur 持續
  // evo：奧義進化需要的飾品能力（武器 Lv8 ＋ 持有該能力的任一飾品 → 打開寶箱時進化）
  var ARCHES = [
    { k: "tachi", kind: "slash", icon: "🗡️", name: C("太刀", "太刀"), b: { dmg: 14, cd: 1.15, area: 2.6, n: 1 }, evo: "might", evoName: C("天下五劍・童子切", "天下五剣・童子切"), desc: C("朝面向揮出半月斬", "向いた方向に半月斬り") },
    { k: "yari", kind: "thrust", icon: "🔱", name: C("長槍", "長槍"), b: { dmg: 16, cd: 1.35, area: 5, n: 1 }, evo: "area", evoName: C("蜻蛉切", "蜻蛉切"), desc: C("向前直線突刺，貫穿一排", "前方へ一直線に突く") },
    { k: "naginata", kind: "spin", icon: "🌙", name: C("薙刀", "薙刀"), b: { dmg: 12, cd: 2.1, area: 3.1, n: 1 }, evo: "armor", evoName: C("岩融", "岩融"), desc: C("旋轉橫掃周圍", "回転して周囲を薙ぎ払う") },
    { k: "yumi", kind: "arrow", icon: "🏹", name: C("和弓", "和弓"), b: { dmg: 11, cd: 0.95, n: 1, spd: 18, pierce: 1 }, evo: "amount", evoName: C("與一之弓", "与一の弓"), desc: C("射向最近的敵人", "最も近い敵を射る") },
    { k: "teppo", kind: "gun", icon: "🔫", name: C("火繩槍", "火縄銃"), b: { dmg: 24, cd: 1.7, n: 1, spd: 32, pierce: 3 }, evo: "crit", evoName: C("國友筒・騎馬鐵砲", "国友筒・騎馬鉄砲"), desc: C("高速子彈貫穿多個敵人", "高速の弾が敵を貫く") },
    { k: "shuriken", kind: "bounce", icon: "✴️", name: C("手裏劍", "手裏剣"), b: { dmg: 9, cd: 1.25, n: 1, spd: 16, pierce: 3 }, evo: "pspd", evoName: C("風魔大車輪", "風魔大車輪"), desc: C("在敵人之間彈跳", "敵から敵へ跳ね回る") },
    { k: "kunai", kind: "fan", icon: "🔪", name: C("苦無", "苦無"), b: { dmg: 7, cd: 1.05, n: 3, spd: 17, pierce: 0 }, evo: "cdr", evoName: C("百花繚亂", "百花繚乱"), desc: C("扇形擲出多把", "扇状に何本も投げる") },
    { k: "horoku", kind: "bomb", icon: "💣", name: C("焙烙玉", "焙烙玉"), b: { dmg: 22, cd: 2.3, area: 2.2, n: 1 }, evo: "area", evoName: C("天地焦焚", "天地焦がし"), desc: C("丟向敵群後爆炸", "敵の群れに投げて爆発") },
    { k: "ozutsu", kind: "cannon", icon: "🧨", name: C("大筒", "大筒"), b: { dmg: 48, cd: 3.8, area: 3.2, n: 1 }, evo: "critDmg", evoName: C("國崩", "国崩し"), desc: C("轟向遠方最強的敵人", "遠くの強敵へ砲撃") },
    { k: "kusarigama", kind: "whip", icon: "⛓️", name: C("鎖鎌", "鎖鎌"), b: { dmg: 13, cd: 1.4, area: 4.2, n: 1 }, evo: "steal", evoName: C("吸血鎖", "血吸い鎖"), desc: C("左右橫甩鎖鏈", "左右に鎖を振る") },
    { k: "ofuda", kind: "orbit", icon: "📜", name: C("御札", "御札"), b: { dmg: 8, cd: 3.5, area: 2.3, n: 2, dur: 3.2 }, evo: "dur", evoName: C("千枚護符", "千枚護符"), desc: C("符咒繞身旋轉", "お札が身の回りを回る") },
    { k: "juzu", kind: "aura", icon: "📿", name: C("念珠", "数珠"), b: { dmg: 4, cd: 0.5, area: 2.1, n: 1 }, evo: "regen", evoName: C("南無阿彌陀佛", "南無阿弥陀仏"), desc: C("持續傷害身邊的敵人", "周囲の敵に継続ダメージ") },
    { k: "kaminari", kind: "lightning", icon: "⚡", name: C("落雷", "落雷"), b: { dmg: 19, cd: 1.9, area: 1.2, n: 2 }, evo: "luck", evoName: C("雷切", "雷切"), desc: C("隨機劈下雷擊", "ランダムに雷を落とす") },
    { k: "kaen", kind: "flame", icon: "🔥", name: C("火炎放射", "火炎放射"), b: { dmg: 6, cd: 2.4, area: 3.6, n: 1, dur: 1 }, evo: "maxHp", evoName: C("不動明王之炎", "不動明王の炎"), desc: C("朝面向噴火", "向いた方向へ火を吹く") },
    { k: "tsurara", kind: "icefall", icon: "🧊", name: C("冰柱", "氷柱"), b: { dmg: 16, cd: 2.1, area: 1.4, n: 3 }, evo: "growth", evoName: C("八甲田冰河", "八甲田の氷河"), desc: C("冰柱從天而降", "空から氷柱が降る") },
    { k: "shikigami", kind: "homing", icon: "🕊️", name: C("式神", "式神"), b: { dmg: 10, cd: 1.5, n: 2, spd: 10, pierce: 0 }, evo: "greed", evoName: C("十二神將", "十二神将"), desc: C("紙鶴追蹤敵人", "紙の鳥が敵を追う") },
    { k: "horagai", kind: "wave", icon: "🐚", name: C("法螺貝", "法螺貝"), b: { dmg: 10, cd: 3.4, area: 5.2, n: 1 }, evo: "knock", evoName: C("出陣大法螺", "出陣の大法螺"), desc: C("擴散的衝擊波，擊退敵人", "広がる衝撃波で押し返す") },
    { k: "tessen", kind: "boomerang", icon: "🪭", name: C("鐵扇", "鉄扇"), b: { dmg: 12, cd: 1.6, n: 1, spd: 14, pierce: 99 }, evo: "speed", evoName: C("軍配團扇", "軍配団扇"), desc: C("飛出去再飛回來", "飛んで戻ってくる") },
    { k: "hata", kind: "zone", icon: "🚩", name: C("軍旗", "軍旗"), b: { dmg: 6, cd: 4.8, area: 2.5, n: 1, dur: 4 }, evo: "dur", evoName: C("風林火山", "風林火山"), desc: C("在敵群插下軍旗，持續傷害", "敵の中に旗を立て継続ダメージ") },
    { k: "makibishi", kind: "trail", icon: "📍", name: C("撒菱", "撒菱"), b: { dmg: 8, cd: 0.55, area: 0.9, n: 1, dur: 4 }, evo: "thorns", evoName: C("千本撒菱", "千本撒菱"), desc: C("沿路撒下撒菱", "通った道に撒菱をまく") },
    { k: "taiko", kind: "pulse", icon: "🥁", name: C("陣太鼓", "陣太鼓"), b: { dmg: 8, cd: 3, area: 3.6, n: 1 }, evo: "elem", evoName: C("雷鳴太鼓", "雷鳴太鼓"), desc: C("鼓聲震暈周圍敵人", "太鼓の音で周囲を気絶させる") },
    { k: "yanoame", kind: "rain", icon: "🎋", name: C("箭雨", "矢の雨"), b: { dmg: 9, cd: 2.9, area: 4.5, n: 6 }, evo: "amount", evoName: C("天降之矢", "天降る矢"), desc: C("箭如雨下", "矢が雨のように降る") },
    { k: "hamaya", kind: "beam", icon: "🏮", name: C("破魔矢", "破魔矢"), b: { dmg: 26, cd: 2.7, area: 0.8, n: 1 }, evo: "elem", evoName: C("破邪顯正", "破邪顕正"), desc: C("一道貫穿畫面的光", "画面を貫く光の矢") },
    { k: "kiba", kind: "charge", icon: "🐎", name: C("騎馬突擊", "騎馬突撃"), b: { dmg: 30, cd: 4.8, area: 1.6, n: 1, spd: 20 }, evo: "speed", evoName: C("赤備", "赤備え"), desc: C("騎馬隊橫掃戰場", "騎馬隊が戦場を駆け抜ける") }
  ];
  var MAX_WLV = 8, MAX_ALV = 5, MAX_W = 6, MAX_A = 6;
  // 每一級的成長（Lv2〜Lv8）：同一種規則套用在所有武器，數值由 kind 決定實際意義
  var WLV = [null, null, { n: 1 }, { dmg: 0.25 }, { area: 0.2 }, { n: 1 }, { cd: -0.15 }, { dmg: 0.3 }, { n: 1, area: 0.15 }];

  var WEAPONS = [];
  ARCHES.forEach(function (a, ai) {
    VARIANTS.forEach(function (v, vi) {
      WEAPONS.push({
        id: ai * 10 + vi, a: ai, v: vi, icon: a.icon, kind: a.kind,
        name: C(v.name.zh + a.name.zh, v.name.ja + a.name.ja),
        desc: C(a.desc.zh + "。" + v.desc.zh + "。", a.desc.ja + "。" + v.desc.ja + "。")
      });
    });
  });

  // ---------------- 東北工藝（飾品 25 種 × 20 能力）----------------
  // r＝稀有度 1〜3（數值倍率 1 / 1.3 / 1.6，出現率反比），sec＝附帶的次要能力
  var CRAFTS = [
    { name: N("南部鉄器"), pref: "iwate", r: 3, sec: "armor" },
    { name: N("津軽塗"), pref: "aomori", r: 3, sec: "luck" },
    { name: N("樺細工"), pref: "akita", r: 2, sec: "cdr" },
    { name: N("曲げわっぱ"), pref: "akita", r: 1, sec: "regen" },
    { name: N("こけし"), pref: "miyagi", r: 1, sec: "magnet" },
    { name: N("赤べこ"), pref: "fukushima", r: 1, sec: "maxHp" },
    { name: N("起き上がり小法師"), pref: "fukushima", r: 2, sec: "regen" },
    { name: N("会津塗"), pref: "fukushima", r: 3, sec: "might" },
    { name: N("天童将棋駒"), pref: "yamagata", r: 2, sec: "crit" },
    { name: N("山形鋳物"), pref: "yamagata", r: 2, sec: "armor" },
    { name: N("仙台箪笥"), pref: "miyagi", r: 3, sec: "greed" },
    { name: N("雄勝硯"), pref: "miyagi", r: 2, sec: "growth" },
    { name: N("秀衡塗"), pref: "iwate", r: 3, sec: "greed" },
    { name: N("浄法寺漆"), pref: "iwate", r: 2, sec: "dur" },
    { name: N("白石和紙"), pref: "miyagi", r: 1, sec: "pspd" },
    { name: N("置賜紬"), pref: "yamagata", r: 2, sec: "speed" },
    { name: N("川連漆器"), pref: "akita", r: 2, sec: "area" },
    { name: N("鳴子漆器"), pref: "miyagi", r: 2, sec: "elem" },
    { name: N("大堀相馬焼"), pref: "fukushima", r: 2, sec: "knock" },
    { name: N("会津木綿"), pref: "fukushima", r: 1, sec: "speed" },
    { name: N("ねぶた和紙"), pref: "aomori", r: 2, sec: "area" },
    { name: N("こぎん刺し"), pref: "aomori", r: 1, sec: "maxHp" },
    { name: N("八幡馬"), pref: "aomori", r: 1, sec: "speed" },
    { name: N("秋田杉桶"), pref: "akita", r: 1, sec: "thorns" },
    { name: N("岩谷堂箪笥"), pref: "iwate", r: 3, sec: "critDmg" }
  ];
  var RAR = [0, 1, 1.3, 1.6];
  var ACCS = [];
  CRAFTS.forEach(function (c, ci) {
    STATS.forEach(function (s, si) {
      ACCS.push({
        id: ci * 20 + si, c: ci, s: si, r: c.r, pref: c.pref,
        name: C(c.name.zh + "・" + s.noun.zh, c.name.ja + "の" + s.noun.ja)
      });
    });
  });
  // 飾品在 lv 級時的能力：{ 主能力: 值, 次要能力: 值 }
  function accStats(id, lv) {
    var a = ACCS[id];
    if (!a) return {};
    var s = STATS[a.s], sec = STAT[CRAFTS[a.c].sec], o = {};
    o[s.k] = s.base * RAR[a.r] * lv;
    if (sec && sec.k !== s.k) o[sec.k] = (o[sec.k] || 0) + sec.base * 0.35 * lv;
    else o[s.k] += s.base * 0.35 * lv;
    return o;
  }

  // ---------------- 鄉土料理與道具（拾取）----------------
  // e：heal 回復、full 全回復、magnet 吸全部經驗、inv 無敵秒、speed 加速秒、might 攻擊秒、armor 防禦秒、freeze 時停秒、nuke 全畫面傷害、gold 錢、xp 經驗、ult 采配充能
  var FOODS = [
    { icon: "🍙", w: 30, name: N("おにぎり"), e: { heal: 20 } },
    { icon: "🍢", w: 18, name: N("きりたんぽ"), e: { heal: 35 } },
    { icon: "🥩", w: 8, name: N("牛タン焼き"), e: { heal: 40, might: 12 } },
    { icon: "🍡", w: 12, name: N("ずんだ餅"), e: { heal: 25, speed: 10 } },
    { icon: "🍲", w: 8, name: N("芋煮"), e: { heal: 60 } },
    { icon: "🥢", w: 10, name: N("わんこそば"), e: { heal: 10, magnet: 1 } },
    { icon: "🍜", w: 7, name: N("盛岡冷麺"), e: { heal: 20, freeze: 4 } },
    { icon: "🍝", w: 7, name: N("じゃじゃ麺"), e: { might: 15 } },
    { icon: "🥣", w: 8, name: N("せんべい汁"), e: { heal: 30, armor: 15 } },
    { icon: "🍜", w: 7, name: N("喜多方ラーメン"), e: { heal: 45 } },
    { icon: "🍝", w: 7, name: N("稲庭うどん"), e: { speed: 15 } },
    { icon: "🍗", w: 6, name: N("比内地鶏"), e: { heal: 50 } },
    { icon: "🍣", w: 6, name: N("はたはた寿司"), e: { xp: 40 } },
    { icon: "🍥", w: 10, name: N("笹かまぼこ"), e: { heal: 25 } },
    { icon: "🦪", w: 5, name: N("ほや"), e: { gold: 40 } },
    { icon: "🍎", w: 16, name: N("津軽りんご"), e: { heal: 15 } },
    { icon: "🍒", w: 8, name: N("佐藤錦"), e: { heal: 10, xp: 20 } },
    { icon: "🍘", w: 10, name: N("南部せんべい"), e: { gold: 20 } },
    { icon: "🍚", w: 4, name: N("三陸海鮮丼"), e: { heal: 100 } },
    { icon: "🥩", w: 2, name: N("米沢牛"), e: { full: 1, might: 20 } },
    { icon: "🥘", w: 5, name: N("こづゆ"), e: { heal: 40, armor: 10 } },
    { icon: "🍢", w: 10, name: N("玉こんにゃく"), e: { heal: 15, speed: 5 } },
    { icon: "🍱", w: 5, name: N("はらこ飯"), e: { heal: 60 } },
    { icon: "🍶", w: 4, name: N("地酒"), e: { might: 20, speed: 8 } },
    { icon: "🔨", w: 2, name: N("打ち出の小槌"), e: { gold: 120 } },
    { icon: "🔔", w: 4, name: N("鳴子"), e: { magnet: 1 } },
    { icon: "🛢️", w: 3, name: N("火薬樽"), e: { nuke: 80 } },
    { icon: "⏳", w: 3, name: N("時の砂時計"), e: { freeze: 7 } },
    { icon: "🧿", w: 3, name: N("不動明王の御守"), e: { inv: 8 } },
    { icon: "📯", w: 3, name: N("采配"), e: { ult: 50 } }
  ];

  // ---------------- 采配（大名的大招，擊殺累積）----------------
  var ULTS = {
    toki: { icon: "📣", name: C("鬨之聲", "鬨の声"), desc: C("對周圍所有敵人造成大傷害", "周囲の敵すべてに大ダメージ") },
    muso: { icon: "⚡", name: C("無雙", "無双"), desc: C("6 秒無敵、傷害 ×2", "6 秒間無敵・ダメージ ×2") },
    kaifuku: { icon: "💊", name: C("陣中藥", "陣中薬"), desc: C("全隊回復 50% 體力", "味方全員の体力を 50% 回復") },
    engun: { icon: "🏹", name: C("援軍", "援軍"), desc: C("8 秒內友軍箭雨支援", "8 秒間、味方の矢の雨") },
    kaze: { icon: "🌪️", name: C("疾風", "疾風"), desc: C("8 秒移動速度 ×1.8，吸取全部經驗", "8 秒間移動 ×1.8、経験値を全回収") },
    jishin: { icon: "🌋", name: C("大地震", "大地震"), desc: C("周圍敵人暈眩 4 秒並受傷", "周囲の敵を 4 秒気絶させダメージ") },
    ougon: { icon: "💰", name: C("黃金之雨", "黄金の雨"), desc: C("天降大量錢與經驗", "銭と経験値が降り注ぐ") },
    kaen: { icon: "🔥", name: C("火計", "火計"), desc: C("身邊燃起火環 8 秒", "8 秒間、周囲に炎の輪") },
    kori: { icon: "❄️", name: C("凍結", "凍結"), desc: C("凍住全部敵人 5 秒", "敵すべてを 5 秒凍らせる") },
    tenrai: { icon: "🌩️", name: C("天雷", "天雷"), desc: C("連續劈下 24 道雷", "雷を 24 回落とす") },
    kekkai: { icon: "⛩️", name: C("結界", "結界"), desc: C("全隊防禦 +10、10 秒", "味方全員 防御 +10・10 秒") },
    kage: { icon: "🥷", name: C("影分身", "影分身"), desc: C("5 秒無敵加速，四周射出 16 枚手裏劍", "5 秒無敵・加速、四方に手裏剣 16 枚") },
    ikki: { icon: "🗡️", name: C("一騎討", "一騎討ち"), desc: C("對附近最強的敵人一記重擊", "近くの最強の敵に渾身の一撃") }
  };

  // ---------------- 大名（60+）----------------
  // [名, 家色, 副色, 前立, 起始攻擊方式, 起始藩, 特性能力, 值, 采配, 稱號 zh, 稱號 ja]
  // 前立：moon 三日月／horns 鍬形／sun 日輪／rokumon 六文錢／antler 鹿角／ai 愛／fan 扇／star 星／flame 火焰／ebosi 烏帽子／hachi 鉢卷＋長髮（女武將）／zukin 頭巾（忍者）
  // 最後一欄 k：0 大名（省略）、1 武將、2 女武將、3 忍者
  var A = {}; ARCHES.forEach(function (a, i) { A[a.k] = i; });
  var VI = {}; VARIANTS.forEach(function (v, i) { VI[v.k] = i; });
  var DM_RAW = [
    ["真田幸村", 0xc0262d, 0xe8c547, "rokumon", "yari", "soma", "might", 0.12, "muso", "日本第一兵", "日本一の兵"],
    ["伊達政宗", 0x1f2a5c, 0xe8c547, "moon", "teppo", "date", "cdr", 0.08, "engun", "獨眼龍，奧州之霸", "独眼竜、奥州の覇者"],
    ["伊達輝宗", 0x24346e, 0xc9c9c9, "moon", "yumi", "date", "growth", 0.1, "kekkai", "政宗之父，善外交", "政宗の父、外交の名手"],
    ["伊達晴宗", 0x2a3a7a, 0xb0b0b0, "moon", "tachi", "date", "armor", 1.5, "kaifuku", "伊達家第十五代", "伊達家十五代当主"],
    ["伊達稙宗", 0x30407e, 0xd0b060, "sun", "ofuda", "date", "luck", 0.1, "ougon", "制定塵芥集的家主", "塵芥集を定めた当主"],
    ["伊達成実", 0x333344, 0xdddddd, "horns", "naginata", "date", "speed", 0.08, "muso", "毛蟲前立的猛將", "毛虫の前立の猛将"],
    ["片倉景綱", 0x3a3a5a, 0xc0c0c0, "moon", "tessen", "date", "cdr", 0.06, "kekkai", "白石城主・智之小十郎", "白石城主・智の小十郎"],
    ["最上義光", 0x2f6b3a, 0xe0d070, "horns", "naginata", "mogami", "area", 0.12, "jishin", "羽州之狐", "羽州の狐"],
    ["最上義守", 0x3a7a46, 0xcccccc, "sun", "yumi", "mogami", "regen", 0.5, "kaifuku", "山形城主，義光之父", "山形城主、義光の父"],
    ["鮭延秀綱", 0x4a8050, 0xaaaaaa, "star", "yanoame", "mogami", "amount", 0.5, "engun", "鮭延城的勇將", "鮭延城の勇将"],
    ["南部信直", 0x3a2e2a, 0xd0a040, "horns", "yari", "nanbu", "armor", 2, "kekkai", "盛岡藩祖", "盛岡藩祖"],
    ["南部晴政", 0x4a3a30, 0xc8c8c8, "sun", "tachi", "nanbu", "might", 0.1, "toki", "三日月之丸、南部全盛", "三日月の丸、南部の全盛"],
    ["南部利直", 0x40342c, 0xe0b050, "fan", "ozutsu", "nanbu", "critDmg", 0.2, "toki", "盛岡城築城者", "盛岡城を築いた藩主"],
    ["九戸政実", 0x2a2422, 0xb04030, "flame", "kiba", "nanbu", "speed", 0.1, "muso", "九戶城以寡敵眾", "九戸城で寡兵よく戦う"],
    ["津軽為信", 0x5b2a86, 0xe0c060, "horns", "horoku", "tsugaru", "area", 0.1, "kaen", "弘前藩祖，津輕獨立", "弘前藩祖、津軽独立"],
    ["津軽信枚", 0x6a3a96, 0xdddddd, "star", "tsurara", "tsugaru", "dur", 0.15, "kori", "弘前城築城者", "弘前城を築いた藩主"],
    ["蘆名盛氏", 0x1d5e5e, 0xe0d080, "sun", "hata", "aizu", "dur", 0.15, "kekkai", "蘆名家全盛之主", "蘆名家全盛の当主"],
    ["蘆名盛隆", 0x226a6a, 0xcccccc, "horns", "tachi", "aizu", "crit", 0.08, "muso", "年少氣盛的會津之主", "若き会津の主"],
    ["蘆名義広", 0x287070, 0xb0b0b0, "star", "yumi", "aizu", "pspd", 0.15, "engun", "摺上原之戰", "摺上原の戦い"],
    ["佐竹義重", 0x222226, 0xd04040, "horns", "tachi", "akita", "might", 0.12, "toki", "鬼義重，一刀斬七人", "鬼義重、一太刀で七人斬り"],
    ["佐竹義宣", 0x2a2a30, 0xe0c060, "sun", "teppo", "akita", "cdr", 0.07, "engun", "久保田藩祖", "久保田藩祖"],
    ["相馬義胤", 0x2b2b2b, 0xe0e0e0, "horns", "kiba", "soma", "knock", 0.3, "jishin", "相馬野馬追的大將", "相馬野馬追の総大将"],
    ["相馬盛胤", 0x343434, 0xc0a060, "sun", "yari", "soma", "maxHp", 30, "kaifuku", "與伊達抗衡數十年", "伊達と数十年渡り合う"],
    ["安東愛季", 0x103c6e, 0xe0e0e0, "fan", "horagai", "akita", "magnet", 0.3, "kaze", "斗星北天，海上之雄", "斗星の北天、海の雄"],
    ["秋田実季", 0x184880, 0xd0d0d0, "star", "kunai", "akita", "amount", 0.5, "engun", "檜山城主", "檜山城主"],
    ["戸沢盛安", 0x3a1a1a, 0xe03030, "flame", "naginata", "akita", "might", 0.1, "muso", "夜叉九郎", "夜叉九郎"],
    ["小野寺輝道", 0x5a3a20, 0xc0c0c0, "sun", "yumi", "akita", "luck", 0.1, "ougon", "仙北的雄主", "仙北の雄"],
    ["大崎義隆", 0x2e4a6e, 0xd8c070, "sun", "juzu", "date", "regen", 0.6, "kekkai", "奧州探題之家", "奥州探題の家"],
    ["葛西晴信", 0x6e5a2e, 0xf0d060, "fan", "hata", "hiraizumi", "greed", 0.2, "ougon", "平泉一帶的領主", "平泉一帯の領主"],
    ["大宝寺義氏", 0x4a2e5e, 0xe07030, "flame", "kaen", "shonai", "elem", 0.2, "kaen", "庄內的惡屋形", "庄内の悪屋形"],
    ["二階堂盛義", 0x3e5e2e, 0xd0d0d0, "sun", "ofuda", "soma", "dur", 0.12, "kekkai", "須賀川城主", "須賀川城主"],
    ["田村清顕", 0x5e2e3e, 0xe0c0c0, "moon", "shikigami", "soma", "cdr", 0.06, "kaifuku", "三春城主，愛姬之父", "三春城主、愛姫の父"],
    ["岩城常隆", 0x2e3e5e, 0xa0c0e0, "fan", "horagai", "soma", "knock", 0.25, "jishin", "濱通的岩城家", "浜通りの岩城家"],
    ["白河義親", 0x6e6e6e, 0xffffff, "star", "hamaya", "aizu", "elem", 0.2, "tenrai", "白河結城家", "白河結城家"],
    ["蒲生氏郷", 0x5a1a1a, 0xe0c060, "horns", "teppo", "aizu", "luck", 0.12, "toki", "鯰尾兜的會津九十二萬石", "燕尾形兜、会津九十二万石"],
    ["上杉景勝", 0x3b4a2a, 0xe0d080, "sun", "tachi", "aizu", "armor", 1.5, "kekkai", "會津一百二十萬石", "会津百二十万石"],
    ["直江兼続", 0x2a3a2a, 0xe0c060, "ai", "ofuda", "mogami", "cdr", 0.08, "kaifuku", "愛字前立的智將", "愛の前立の智将"],
    ["保科正之", 0x203040, 0xc0c0c0, "sun", "juzu", "aizu", "regen", 0.8, "kekkai", "會津藩祖，名君", "会津藩祖、名君"],
    ["松平容保", 0x2a2030, 0xe0e0e0, "sun", "teppo", "aizu", "armor", 2, "engun", "最後的會津藩主", "最後の会津藩主"],
    ["留守政景", 0x30406a, 0xc0c0c0, "moon", "yari", "date", "maxHp", 25, "kaifuku", "伊達一門的猛將", "伊達一門の猛将"],
    ["石川昭光", 0x4a3a6a, 0xd0c080, "star", "yumi", "soma", "pspd", 0.15, "engun", "角田石川家", "角田石川家"],
    ["畠山義継", 0x5a4a3a, 0xc0c0c0, "horns", "kusarigama", "soma", "steal", 0.2, "kaen", "二本松城主", "二本松城主"],
    ["浅利勝頼", 0x6a5a2a, 0xd0d0a0, "star", "shuriken", "akita", "pspd", 0.15, "kaze", "比內的淺利家", "比内の浅利家"],
    ["稗貫輝家", 0x4a5a3a, 0xc0c0a0, "sun", "makibishi", "nanbu", "thorns", 10, "jishin", "花卷鳥谷崎城主", "花巻鳥谷崎城主"],
    ["和賀義忠", 0x3a4a5a, 0xc0c0c0, "fan", "kunai", "nanbu", "speed", 0.08, "kaze", "和賀郡的領主", "和賀郡の領主"],
    ["阿曽沼広長", 0x5a3a5a, 0xff9050, "flame", "shikigami", "tono", "elem", 0.2, "kaen", "遠野的領主", "遠野の領主"],
    ["黒川晴氏", 0x203a5a, 0xa0d0ff, "moon", "tsurara", "date", "area", 0.1, "kori", "大和城主", "大和城主"],
    ["本堂忠親", 0x5a5a3a, 0xc0c0c0, "sun", "makibishi", "akita", "thorns", 10, "kekkai", "本堂城主", "本堂城主"],
    ["六郷政乗", 0x3a5a5a, 0xd0d0d0, "fan", "taiko", "akita", "knock", 0.25, "jishin", "本莊藩主", "本荘藩主"],
    ["仁賀保挙誠", 0x2a5a4a, 0xe0e0e0, "star", "hamaya", "shonai", "crit", 0.07, "tenrai", "由利十二頭之首", "由利十二頭の筆頭"],
    ["藤原秀衡", 0xb08a20, 0xffe080, "ebosi", "kaminari", "hiraizumi", "greed", 0.3, "ougon", "奧州藤原氏第三代", "奥州藤原氏三代"],
    ["藤原清衡", 0xa07a18, 0xffffff, "ebosi", "juzu", "hiraizumi", "regen", 0.6, "kaifuku", "中尊寺建立者", "中尊寺を建てた初代"],
    ["真田昌幸", 0xa0262d, 0xd0d0d0, "rokumon", "horoku", "tono", "cdr", 0.08, "kaen", "表裏比興之者", "表裏比興の者"],
    ["真田信之", 0xb0362d, 0xe0e0e0, "rokumon", "hata", "nanbu", "armor", 1.5, "kekkai", "松代藩祖，長壽的名將", "松代藩祖、長寿の名将"],
    ["武田信玄", 0x8b1a1a, 0xffffff, "horns", "kiba", "soma", "armor", 1.5, "jishin", "甲斐之虎・風林火山", "甲斐の虎・風林火山"],
    ["上杉謙信", 0xe8e8e8, 0x3a3a6a, "sun", "tachi", "tsugaru", "crit", 0.1, "tenrai", "越後之龍・毘沙門天", "越後の龍・毘沙門天"],
    ["織田信長", 0x1a1a1a, 0xe0b030, "horns", "teppo", "akita", "might", 0.1, "engun", "第六天魔王", "第六天魔王"],
    ["豊臣秀吉", 0xd4a017, 0xffffff, "sun", "hata", "hiraizumi", "greed", 0.3, "ougon", "天下人", "天下人"],
    ["徳川家康", 0x2a4a2a, 0xe0c060, "horns", "juzu", "mogami", "maxHp", 30, "kekkai", "忍耐的天下人", "忍耐の天下人"],
    ["北条氏康", 0x2a2a5a, 0xe0e0e0, "sun", "horagai", "soma", "maxHp", 25, "kekkai", "相模之獅子", "相模の獅子"],
    ["毛利元就", 0x5a2a2a, 0xe0e0e0, "star", "yanoame", "shonai", "amount", 0.5, "engun", "三矢之訓", "三本の矢"],
    ["島津義弘", 0x2a2a2a, 0xffffff, "horns", "tachi", "nanbu", "might", 0.12, "muso", "鬼島津", "鬼島津"],
    ["長宗我部元親", 0x5a3a1a, 0xd0a060, "horns", "yari", "akita", "speed", 0.08, "toki", "土佐之出來人", "土佐の出来人"],
    ["前田利家", 0x3a2a1a, 0xc0c0c0, "star", "yari", "nanbu", "maxHp", 30, "toki", "槍之又左", "槍の又左"],
    ["石田三成", 0x2a3a3a, 0xe0e0e0, "fan", "shikigami", "hiraizumi", "growth", 0.12, "kekkai", "大一大萬大吉", "大一大万大吉"],
    ["黒田官兵衛", 0x3a3a2a, 0xd0d0d0, "sun", "horoku", "mogami", "area", 0.1, "kaen", "天下的軍師", "天下の軍師"],
    ["加藤清正", 0x5a5a5a, 0xffffff, "ebosi", "yari", "aizu", "maxHp", 25, "toki", "長烏帽子兜的虎之助", "長烏帽子の虎之助"],
    ["立花宗茂", 0x2a3a5a, 0xe0e0ff, "sun", "kaminari", "date", "crit", 0.08, "tenrai", "西國無雙", "西国無双"],
    ["本多忠勝", 0x1a1a1a, 0xe0c060, "antler", "yari", "aizu", "armor", 2, "muso", "蜻蛉切與鹿角兜", "蜻蛉切と鹿角の兜"],
    ["今川義元", 0xd0b0e0, 0xffffff, "ebosi", "ofuda", "hiraizumi", "luck", 0.12, "ougon", "海道第一弓取", "海道一の弓取り"],
    ["明智光秀", 0x3a5a8a, 0xd0d0d0, "star", "teppo", "shonai", "crit", 0.07, "kaen", "桔梗紋的智將", "桔梗紋の智将"],
    ["大友宗麟", 0x4a2a5a, 0xe0c060, "star", "ozutsu", "hiraizumi", "critDmg", 0.25, "toki", "國崩之主", "国崩しの主"],
    // ---- 武將（k:1）、女武將（k:2）、忍者（k:3）----
    ["鬼庭綱元", 0x2a3a5c, 0xd0d0d0, "moon", "yari", "date", "maxHp", 25, "kekkai", "伊達家的宿老", "伊達家の宿老", 1],
    ["原田宗時", 0x30385a, 0xe0c060, "horns", "tachi", "date", "might", 0.1, "muso", "伊達的猛將", "伊達の猛将", 1],
    ["後藤信康", 0x2a2a48, 0xffffff, "sun", "kiba", "date", "speed", 0.08, "toki", "黃後藤", "黄後藤", 1],
    ["支倉常長", 0x3a4a7a, 0xe0c060, "star", "teppo", "date", "pspd", 0.15, "engun", "慶長遣歐使節", "慶長遣欧使節", 1],
    ["白石宗実", 0x34406a, 0xc0c0c0, "fan", "yumi", "date", "luck", 0.1, "kekkai", "白石城代", "白石城代", 1],
    ["氏家守棟", 0x3a6a46, 0xd0d0d0, "fan", "shikigami", "mogami", "cdr", 0.07, "kekkai", "最上的智囊", "最上の知恵袋", 1],
    ["志村光安", 0x407048, 0xe0c060, "horns", "teppo", "mogami", "crit", 0.07, "engun", "長谷堂城的守將", "長谷堂城の守将", 1],
    ["楯岡満茂", 0x467a50, 0xc0c0c0, "sun", "naginata", "mogami", "area", 0.1, "jishin", "本城豐前守", "本城豊前守", 1],
    ["北信愛", 0x3a302a, 0xc0c0c0, "sun", "hata", "nanbu", "regen", 0.5, "kekkai", "南部的長老", "南部の長老", 1],
    ["八戸政栄", 0x463830, 0xe0c060, "fan", "yumi", "nanbu", "growth", 0.1, "ougon", "根城南部家", "根城南部家", 1],
    ["沼田祐光", 0x5a3a80, 0xd0d0d0, "star", "ofuda", "tsugaru", "elem", 0.2, "kori", "津輕的軍師", "津軽の軍師", 1],
    ["森岡信元", 0x6a4a8a, 0xe0c060, "horns", "kusarigama", "tsugaru", "steal", 0.2, "kaen", "津輕的猛將", "津軽の猛将", 1],
    ["金上盛備", 0x1d5a5a, 0xd0d0d0, "fan", "juzu", "aizu", "armor", 1.5, "kekkai", "蘆名的執權", "蘆名の執権", 1],
    ["前田慶次", 0x8a1a3a, 0xffd060, "flame", "yari", "aizu", "might", 0.12, "ikki", "天下第一的傾奇者", "天下一の傾奇者", 1],
    ["水原親憲", 0x3a4a2a, 0xd0d0d0, "sun", "teppo", "mogami", "critDmg", 0.2, "engun", "上杉的鐵砲大將", "上杉の鉄砲大将", 1],
    ["甘粕景継", 0x34442a, 0xe0c060, "horns", "tachi", "aizu", "crit", 0.07, "muso", "上杉的殿軍", "上杉の殿", 1],
    ["山県昌景", 0xc02020, 0xffffff, "horns", "kiba", "soma", "speed", 0.1, "ikki", "赤備之將", "赤備えの将", 1],
    ["馬場信春", 0x7a1a1a, 0xd0d0d0, "sun", "yari", "nanbu", "armor", 2, "kekkai", "不死身的鬼美濃", "不死身の鬼美濃", 1],
    ["高坂昌信", 0x6a2a2a, 0xe0c060, "fan", "hata", "mogami", "dur", 0.15, "kekkai", "逃彈正", "逃げ弾正", 1],
    ["山本勘助", 0x4a3a2a, 0xd0d0d0, "ebosi", "horoku", "tono", "area", 0.1, "kaen", "武田的軍師", "武田の軍師", 1],
    ["柿崎景家", 0x3a4a2a, 0xffffff, "horns", "naginata", "tsugaru", "might", 0.1, "toki", "越後第一猛將", "越後一の猛将", 1],
    ["竹中半兵衛", 0x2a4a4a, 0xe0e0e0, "ebosi", "shikigami", "hiraizumi", "cdr", 0.08, "kekkai", "今孔明", "今孔明", 1],
    ["可児才蔵", 0x4a3a2a, 0x7ab040, "horns", "yari", "akita", "might", 0.1, "ikki", "笹之才藏", "笹の才蔵", 1],
    ["福島正則", 0x5a2a1a, 0xe0c060, "horns", "yari", "nanbu", "maxHp", 30, "toki", "賤岳七本槍之首", "賤ヶ岳七本槍の筆頭", 1],
    ["井伊直政", 0xd02020, 0xffd040, "horns", "kiba", "aizu", "might", 0.1, "muso", "井伊的赤鬼", "井伊の赤鬼", 1],
    ["榊原康政", 0x3a3a3a, 0xe0c060, "sun", "yari", "mogami", "speed", 0.08, "engun", "德川四天王", "徳川四天王", 1],
    ["酒井忠次", 0x2a3a2a, 0xd0d0d0, "fan", "taiko", "mogami", "knock", 0.25, "jishin", "德川四天王筆頭", "徳川四天王筆頭", 1],
    ["雑賀孫一", 0x2a2a2a, 0xe0a030, "star", "teppo", "akita", "amount", 0.5, "engun", "雜賀眾的鐵砲頭領", "雑賀衆の鉄砲頭", 1],
    ["柳生宗矩", 0x3a3a4a, 0xc0c0c0, "ebosi", "tachi", "tsugaru", "crit", 0.1, "ikki", "柳生新陰流", "柳生新陰流", 1],
    ["鍋島直茂", 0x4a2a2a, 0xe0c060, "sun", "hata", "hiraizumi", "greed", 0.2, "ougon", "肥前的智將", "肥前の智将", 1],
    ["大谷吉継", 0xe8e8e8, 0x3a3a3a, "ebosi", "ofuda", "shonai", "elem", 0.25, "kekkai", "義之白頭巾", "義の白頭巾", 1],
    ["島左近", 0x3a2a2a, 0xffffff, "horns", "yari", "shonai", "might", 0.1, "toki", "三成過分之人", "三成に過ぎたる者", 1],
    ["後藤又兵衛", 0x2a2a3a, 0xe0c060, "horns", "yari", "soma", "maxHp", 30, "ikki", "槍之又兵衛", "槍の又兵衛", 1],
    ["毛利勝永", 0x5a3a3a, 0xd0d0d0, "sun", "tachi", "soma", "cdr", 0.07, "muso", "大坂之陣的勇將", "大坂の陣の勇将", 1],
    ["木村重成", 0x3a2a4a, 0xf0e0ff, "star", "yari", "date", "luck", 0.1, "ikki", "大坂之陣的貴公子", "大坂の陣の貴公子", 1],
    ["真田大助", 0xb02a2d, 0xe8c547, "rokumon", "yumi", "soma", "growth", 0.12, "engun", "幸村之子", "幸村の嫡男", 1],
    ["甲斐姫", 0xd04070, 0xffe0f0, "hachi", "naginata", "soma", "speed", 0.1, "muso", "忍城的女武者", "忍城の女武者", 2],
    ["立花誾千代", 0x4a5aa0, 0xffffff, "hachi", "kaminari", "date", "crit", 0.08, "tenrai", "立花城的女城主", "立花城の女城主", 2],
    ["大祝鶴姫", 0x2a6aa0, 0xd0f0ff, "hachi", "naginata", "tsugaru", "pspd", 0.15, "kori", "瀨戶內的聖女", "瀬戸内のジャンヌ", 2],
    ["井伊直虎", 0xc03030, 0xffe0e0, "hachi", "hata", "aizu", "cdr", 0.08, "kekkai", "女城主", "女城主", 2],
    ["小松姫", 0xa02a40, 0xe8c547, "hachi", "yumi", "nanbu", "armor", 1.5, "kekkai", "真田信之之妻", "真田信之の妻", 2],
    ["愛姫", 0xe080a0, 0xffffff, "hachi", "ofuda", "soma", "regen", 0.6, "kaifuku", "政宗的正室", "政宗の正室", 2],
    ["義姫", 0x4a8a50, 0xffffff, "hachi", "juzu", "mogami", "maxHp", 25, "kaifuku", "最上御前", "最上御前", 2],
    ["駒姫", 0xf0a0c0, 0xffffff, "hachi", "shikigami", "mogami", "luck", 0.12, "ougon", "東國第一美女", "東国一の美少女", 2],
    ["服部半蔵", 0x1a1a24, 0xc0c0c0, "zukin", "kunai", "date", "speed", 0.1, "kage", "伊賀眾的首領", "伊賀衆の頭領", 3],
    ["風魔小太郎", 0x222018, 0xc04030, "zukin", "shuriken", "soma", "pspd", 0.2, "kage", "風魔一黨", "風魔一党", 3],
    ["猿飛佐助", 0x2a3a2a, 0xe0c060, "zukin", "shuriken", "tono", "speed", 0.1, "kage", "真田十勇士", "真田十勇士", 3],
    ["霧隠才蔵", 0x2a2a3a, 0xa0c0ff, "zukin", "makibishi", "tsugaru", "dur", 0.15, "kage", "真田十勇士・霧之術", "真田十勇士・霧の術", 3],
    ["黒脛巾組", 0x202020, 0xd0a040, "zukin", "kunai", "date", "cdr", 0.07, "kage", "伊達的忍者集團", "伊達の忍び集団", 3]
  ];
  var DAIMYO = DM_RAW.map(function (r, i) {
    return {
      i: i, name: N(r[0]), color: r[1], accent: r[2], crest: r[3], start: A[r[4]] * 10 + VI[r[5]],
      trait: [r[6], r[7]], ult: r[8], title: C(r[9], r[10]), k: r[11] | 0
    };
  });

  // ---------------- 敵人 ----------------
  // m＝模型（yukimura_3d.js）。hp／spd／dmg（碰觸傷害）／xp／r 半徑。f：fly 飛行、ghost 半透明、ranged 遠程、charge 衝鋒、armor 減傷、gold 掉錢、split 分裂
  var ENEMIES = {
    ikki: { m: "ikki", name: N("一揆衆"), hp: 7, spd: 2.5, dmg: 5, xp: 1, r: 0.45 },
    ashigaru: { m: "ashigaru", name: N("足軽"), hp: 11, spd: 2.2, dmg: 6, xp: 1, r: 0.5 },
    yari: { m: "yari", name: N("槍足軽"), hp: 17, spd: 2.1, dmg: 7, xp: 2, r: 0.5 },
    nobushi: { m: "nobushi", name: N("野武士"), hp: 32, spd: 2.5, dmg: 9, xp: 3, r: 0.55 },
    gaikotsu: { m: "gaikotsu", name: N("骸骨武者"), hp: 24, spd: 2.0, dmg: 8, xp: 2, r: 0.5 },
    onibi: { m: "onibi", name: N("鬼火"), hp: 9, spd: 3.2, dmg: 5, xp: 1, r: 0.4, f: { fly: 1, ghost: 1 } },
    yurei: { m: "yurei", name: N("幽霊"), hp: 20, spd: 1.9, dmg: 7, xp: 2, r: 0.5, f: { ghost: 1 } },
    yukinko: { m: "yukinko", name: N("雪ん子"), hp: 9, spd: 3.0, dmg: 5, xp: 1, r: 0.42 },
    yukidaruma: { m: "yukidaruma", name: N("雪だるま"), hp: 55, spd: 1.3, dmg: 10, xp: 4, r: 0.75 },
    ookami: { m: "ookami", name: N("狼"), hp: 15, spd: 4.0, dmg: 6, xp: 2, r: 0.5 },
    kuma: { m: "kuma", name: N("月輪熊"), hp: 130, spd: 2.1, dmg: 14, xp: 8, r: 0.85, f: { charge: 1 } },
    kappa: { m: "kappa", name: N("河童"), hp: 28, spd: 2.6, dmg: 8, xp: 3, r: 0.5 },
    tengu: { m: "tengu", name: N("烏天狗"), hp: 26, spd: 3.1, dmg: 8, xp: 3, r: 0.5, f: { fly: 1 } },
    namahage: { m: "namahage", name: N("なまはげ"), hp: 65, spd: 2.8, dmg: 12, xp: 5, r: 0.65, f: { charge: 1 } },
    teppo: { m: "teppo", name: N("鉄砲足軽"), hp: 22, spd: 1.8, dmg: 6, xp: 3, r: 0.5, f: { ranged: 1 } },
    kiba: { m: "kiba", name: N("騎馬武者"), hp: 75, spd: 4.0, dmg: 13, xp: 6, r: 0.8, f: { charge: 1 } },
    ninja: { m: "ninja", name: N("忍者"), hp: 19, spd: 3.9, dmg: 7, xp: 2, r: 0.45 },
    gama: { m: "gama", name: N("大蝦蟇"), hp: 95, spd: 1.5, dmg: 12, xp: 7, r: 0.9, f: { ranged: 1 } },
    tsuchigumo: { m: "tsuchigumo", name: N("土蜘蛛"), hp: 42, spd: 3.0, dmg: 9, xp: 4, r: 0.7 },
    kasha: { m: "kasha", name: N("火車"), hp: 48, spd: 3.3, dmg: 10, xp: 4, r: 0.65 },
    kitsune: { m: "kitsune", name: N("狐"), hp: 21, spd: 3.6, dmg: 7, xp: 2, r: 0.45 },
    akaoni: { m: "akaoni", name: N("赤鬼"), hp: 160, spd: 2.0, dmg: 16, xp: 10, r: 0.9 },
    tetsuoni: { m: "tetsuoni", name: N("鉄鬼"), hp: 230, spd: 1.6, dmg: 16, xp: 12, r: 0.9, f: { armor: 4 } },
    kogane: { m: "kogane", name: N("黄金武者"), hp: 60, spd: 2.2, dmg: 9, xp: 5, r: 0.55, f: { gold: 1 } },
    yogan: { m: "yogan", name: N("溶岩兵"), hp: 85, spd: 1.9, dmg: 12, xp: 6, r: 0.7, f: { split: 1 } },
    kodama: { m: "kodama", name: N("木霊"), hp: 6, spd: 2.8, dmg: 4, xp: 1, r: 0.35, f: { split: 0 } }
  };

  // ---------------- 首領 ----------------
  // pat：首領的招式（core 依序循環）charge 衝撞／ring 彈幕環／aim 瞄準三連發／slam 預警範圍／summon 召喚／rain 隨機預警／nova 大範圍預警
  var BOSSES = {
    kuma: { m: "kuma", s: 2.4, name: N("主の大熊"), hp: 1800, spd: 2.3, dmg: 20, pat: ["charge", "slam", "charge"] },
    akaoni: { m: "akaoni", s: 2.2, name: N("大赤鬼"), hp: 2200, spd: 2.0, dmg: 22, pat: ["slam", "summon", "charge"] },
    gama: { m: "gama", s: 2.2, name: N("大蝦蟇仙人"), hp: 2000, spd: 1.6, dmg: 18, pat: ["aim", "ring", "summon"] },
    yukijo: { m: "yukijo", s: 2.4, name: N("雪女王"), hp: 9000, spd: 2.0, dmg: 22, pat: ["ring", "rain", "summon", "aim"] },
    enma: { m: "enma", s: 2.6, name: N("恐山の閻魔"), hp: 11000, spd: 1.8, dmg: 24, pat: ["nova", "summon", "ring", "rain"] },
    tetsuguma: { m: "tetsuguma", s: 2.8, name: N("鉄甲大熊"), hp: 14000, spd: 2.4, dmg: 26, pat: ["charge", "slam", "charge", "ring"] },
    okappa: { m: "okappa", s: 2.6, name: N("遠野の大河童"), hp: 15000, spd: 2.2, dmg: 26, pat: ["aim", "slam", "summon", "ring"] },
    benkei: { m: "benkei", s: 2.6, name: N("黄金の弁慶"), hp: 18000, spd: 2.3, dmg: 30, pat: ["charge", "nova", "slam", "summon"] },
    onamahage: { m: "onamahage", s: 2.8, name: N("大なまはげ"), hp: 20000, spd: 2.6, dmg: 30, pat: ["charge", "charge", "rain", "summon"] },
    daitengu: { m: "daitengu", s: 2.6, name: N("大天狗・羽黒坊"), hp: 22000, spd: 2.8, dmg: 30, pat: ["ring", "aim", "rain", "charge"] },
    karakuri: { m: "karakuri", s: 3.0, name: N("青葉の絡繰大鎧"), hp: 26000, spd: 1.9, dmg: 34, pat: ["aim", "ring", "slam", "summon"] },
    ozutsuoni: { m: "ozutsuoni", s: 3.0, name: N("大筒鬼"), hp: 30000, spd: 1.7, dmg: 36, pat: ["rain", "nova", "aim", "summon"] },
    arahabaki: { m: "arahabaki", s: 3.4, name: N("荒覇吐神"), hp: 40000, spd: 1.8, dmg: 40, pat: ["nova", "ring", "rain", "summon", "aim", "slam"] }
  };

  // ---------------- 東北地圖 20 張 ----------------
  // g＝地面三色、sky、fog、prop 裝飾權重（yukimura_3d.js 依名稱建模）、river 河流數、snow 下雪、ash 火山灰
  var MAPS = [
    { name: N("弘前城下・雪桜"), pref: "aomori", g: [0xc4cfdc, 0xaab8c9, 0x8e9fb4], sky: 0xbcd0e6, fog: 0xdfe8f2, prop: { snowpine: 6, sakura: 3, lantern: 2, house: 2, castle: 1, rock: 2 }, snow: 1 },
    { name: N("八甲田山・樹氷原"), pref: "aomori", g: [0xc8d3e0, 0xadbccd, 0x92a4b8], sky: 0xc7d6e6, fog: 0xeef3f8, prop: { snowpine: 10, juhyo: 5, rock: 3 }, snow: 1 },
    { name: N("恐山・宇曽利湖"), pref: "aomori", g: [0xa9a596, 0x8e8a7e, 0xc8c2a4], sky: 0x8c8f99, fog: 0xa8a8a0, prop: { rock: 8, grave: 6, jizo: 4, kazaguruma: 4, torii: 1 }, sulfur: 1 },
    { name: N("下北・仏ヶ浦"), pref: "aomori", g: [0xd8d6cc, 0xbdbbb0, 0x8fb0b8], sky: 0x9fb8c8, fog: 0xc4d0d4, prop: { pillar: 8, rock: 6, grave: 2 } },
    { name: N("盛岡城跡・岩手山麓"), pref: "iwate", g: [0x7a9a5a, 0x66854a, 0x8a8a6a], sky: 0x9cc0e0, fog: 0xc8d8e0, prop: { pine: 6, rock: 5, castle: 1, house: 2, anvil: 3 } },
    { name: N("釜石・鉄の鉱山"), pref: "iwate", g: [0x6a625a, 0x58504a, 0x8a5a3a], sky: 0x7a7a80, fog: 0x8a8580, prop: { rock: 9, anvil: 5, furnace: 3, pine: 2 } },
    { name: N("遠野・カッパ淵"), pref: "iwate", g: [0x5f8f4a, 0x4e7a3e, 0x7aa05a], sky: 0x9ac0c8, fog: 0xb8d0c8, prop: { cedar: 5, bamboo: 4, rock: 3, jizo: 2 }, river: 2 },
    { name: N("遠野・曲り家の里"), pref: "iwate", g: [0x8aa050, 0x749040, 0xa8a860], sky: 0xa8c8e0, fog: 0xd0dcd0, prop: { magariya: 4, rice: 6, cedar: 3, kakashi: 3 }, river: 1 },
    { name: N("平泉・中尊寺金色堂"), pref: "iwate", g: [0x6f8f4f, 0x5c7c42, 0xc8a850], sky: 0xb8c8d8, fog: 0xd8d0b8, prop: { cedar: 7, toro: 4, pagoda: 1, shrine: 2, maple: 3 } },
    { name: N("平泉・毛越寺浄土庭園"), pref: "iwate", g: [0x78985a, 0x66884c, 0x5a8aa0], sky: 0xb0c8dc, fog: 0xd0dcd8, prop: { pine: 4, toro: 5, rock: 4, maple: 3 }, river: 1 },
    { name: N("男鹿・真山の神域"), pref: "akita", g: [0x5a6e48, 0x4a5c3c, 0x6a5a48], sky: 0x40486a, fog: 0x505870, prop: { cedar: 7, torii: 2, lantern: 3, rock: 3 }, night: 1 },
    { name: N("角館・武家屋敷"), pref: "akita", g: [0x8a8a7a, 0x7a7a6a, 0xa09070], sky: 0xb0bcd0, fog: 0xd0d0d0, prop: { sakura: 7, house: 5, kura: 3, lantern: 2 } },
    { name: N("羽黒山・杉並木"), pref: "yamagata", g: [0x4f6e3e, 0x40603a, 0x6a7a5a], sky: 0x90a8b0, fog: 0xa8b8b0, prop: { cedar: 12, pagoda: 1, toro: 3 } },
    { name: N("山寺・立石寺"), pref: "yamagata", g: [0x7a7a62, 0x6a6a52, 0x8a8a6a], sky: 0xa0b4c4, fog: 0xc0c8c8, prop: { cliff: 6, shrine: 3, cedar: 4, maple: 4, jizo: 2 } },
    { name: N("仙台・青葉山"), pref: "miyagi", g: [0x6a8a4a, 0x5a7a40, 0x7a7a5a], sky: 0x98b8d8, fog: 0xc0d0d8, prop: { pine: 5, castle: 1, house: 3, tanabata: 4, rock: 2 } },
    { name: N("松島・八百八島"), pref: "miyagi", g: [0xd8cca0, 0xc4b88e, 0x6a9ab0], sky: 0xa8c8e0, fog: 0xc8dce8, prop: { pine: 6, islet: 6, rock: 4 }, river: 2 },
    { name: N("会津・鶴ヶ城"), pref: "fukushima", g: [0x7a8a5a, 0x6a7a4a, 0x8a7a6a], sky: 0x9ab0c8, fog: 0xc0c8d0, prop: { castle: 1, sakura: 5, house: 3, rock: 2, kura: 2 } },
    { name: N("大内宿・茅葺の宿場"), pref: "fukushima", g: [0x8a8a62, 0x7a7a54, 0xa09a70], sky: 0xa8bcd0, fog: 0xd0d4d0, prop: { magariya: 6, cedar: 4, lantern: 3, rice: 2 } },
    { name: N("磐梯山・噴火口"), pref: "fukushima", g: [0x4a3a34, 0x3a2e2a, 0x7a3a22], sky: 0x5a4040, fog: 0x704a3e, prop: { lavarock: 9, rock: 6, deadtree: 4 }, ash: 1 },
    { name: N("裏磐梯・五色沼"), pref: "fukushima", g: [0x5a7a4a, 0x4a6a40, 0x3aa0a0], sky: 0x90b0c0, fog: 0xb0c8c8, prop: { pine: 6, rock: 4, deadtree: 2, maple: 3 }, river: 3 }
  ];

  // ---------------- 十大關卡 ----------------
  // feat：關卡特色（yukimura_core.js 的 stageFeature）。roster：[開始秒數, 會出現的敵人]。mid：第 5／10 分鐘的中首領。boss：第 15 分鐘的魔王
  var STAGES = [
    { maps: [0, 1], feat: "blizzard", color: 0x9fd0ff, name: C("津輕・吹雪雪原", "津軽・吹雪の雪原"), desc: C("每隔一段時間颳起吹雪：視野變差、移動變慢，雪人和雪童子成群出沒。", "定期的に吹雪：視界が悪く足が鈍る。雪だるまと雪ん子の群れ。"),
      roster: [[0, ["ikki", "yukinko"]], [120, ["ashigaru", "yukinko", "ookami"]], [300, ["yukidaruma", "ookami", "yari"]], [540, ["yukidaruma", "nobushi", "yukinko"]], [720, ["kuma", "yukidaruma", "nobushi"]]], mid: ["kuma", "kuma"], boss: "yukijo" },
    { maps: [2, 3], feat: "vents", color: 0xc0b080, name: C("恐山・地獄靈場", "恐山・地獄の霊場"), desc: C("地面隨時噴出硫磺毒氣（紅圈預警）。幽靈與鬼火會穿過一切而來。", "地面から硫黄の毒気が噴き出す（赤い円で予告）。幽霊と鬼火がすり抜けて来る。"),
      roster: [[0, ["onibi", "gaikotsu"]], [120, ["yurei", "onibi", "gaikotsu"]], [300, ["yurei", "gaikotsu", "kasha"]], [540, ["kasha", "yurei", "akaoni"]], [720, ["akaoni", "kasha", "onibi"]]], mid: ["akaoni", "akaoni"], boss: "enma" },
    { maps: [4, 5], feat: "iron", color: 0x8a8a92, name: C("南部・鐵之國", "南部・鉄の国"), desc: C("敵人穿著南部鐵甲（減傷）。地上的鐵砧被打破會掉下強化用的寶箱。", "敵は南部鉄の鎧で硬い。金床を壊すと強化の宝箱が出る。"),
      roster: [[0, ["ashigaru", "ookami"]], [120, ["yari", "nobushi", "ookami"]], [300, ["kuma", "nobushi", "tetsuoni"]], [540, ["tetsuoni", "kiba", "yari"]], [720, ["tetsuoni", "kuma", "kiba"]]], mid: ["kuma", "akaoni"], boss: "tetsuguma" },
    { maps: [6, 7], feat: "river", color: 0x5fa05a, name: C("遠野・妖怪之里", "遠野・妖怪の里"), desc: C("河流會拖慢移動、河童從水裡冒出。偶爾出現的座敷童子碰到就有好運。", "川に入ると足が鈍り、河童が現れる。座敷わらしに触れると福が来る。"),
      roster: [[0, ["kodama", "kappa"]], [120, ["kappa", "kitsune", "kodama"]], [300, ["kappa", "tsuchigumo", "kitsune"]], [540, ["tsuchigumo", "gama", "kappa"]], [720, ["gama", "tsuchigumo", "akaoni"]]], mid: ["gama", "gama"], boss: "okappa" },
    { maps: [8, 9], feat: "gold", color: 0xf2c230, name: C("平泉・黃金鄉", "平泉・黄金郷"), desc: C("錢的掉落加倍，黃金武者被打倒會撒出大量的錢；但敵人會被黃金吸引更兇猛。", "銭のドロップ 2 倍、黄金武者は銭をばらまく。ただし敵も黄金に惹かれて猛る。"),
      roster: [[0, ["ashigaru", "ikki"]], [120, ["nobushi", "kogane", "yari"]], [300, ["kogane", "nobushi", "gaikotsu"]], [540, ["kiba", "kogane", "akaoni"]], [720, ["akaoni", "kiba", "kogane"]]], mid: ["akaoni", "kuma"], boss: "benkei" },
    { maps: [10, 11], feat: "darkness", color: 0x6a3a3a, name: C("男鹿・生剝鬼夜襲", "男鹿・なまはげの夜襲"), desc: C("「哭泣的孩子在哪裡！」定期入夜、視野縮小，生剝鬼成列衝鋒而來。", "「泣ぐ子はいねがー！」定期的に夜になり視界が狭まり、なまはげが列で突撃。"),
      roster: [[0, ["ikki", "ookami"]], [120, ["namahage", "ookami", "ikki"]], [300, ["namahage", "kitsune", "nobushi"]], [540, ["namahage", "akaoni", "kitsune"]], [720, ["akaoni", "namahage", "kuma"]]], mid: ["akaoni", "akaoni"], boss: "onamahage" },
    { maps: [12, 13], feat: "wind", color: 0x6a8a6a, name: C("出羽三山・修驗之道", "出羽三山・修験の道"), desc: C("天狗之風定期把所有人往同一方向吹。烏天狗從空中襲來。", "天狗の風が定期的に皆を吹き流す。烏天狗が空から襲う。"),
      roster: [[0, ["tengu", "kodama"]], [120, ["tengu", "ninja", "kodama"]], [300, ["tengu", "ninja", "yurei"]], [540, ["tengu", "nobushi", "tsuchigumo"]], [720, ["tengu", "akaoni", "ninja"]]], mid: ["gama", "akaoni"], boss: "daitengu" },
    { maps: [14, 15], feat: "gunners", color: 0x3a4aa8, name: C("仙台・青葉城攻防", "仙台・青葉城の攻防"), desc: C("鐵砲隊在遠處開槍，騎馬隊成群衝鋒。注意閃避子彈。", "鉄砲隊が遠くから撃ち、騎馬隊が群れで突撃。弾をかわせ。"),
      roster: [[0, ["ashigaru", "teppo"]], [120, ["teppo", "yari", "ashigaru"]], [300, ["teppo", "kiba", "nobushi"]], [540, ["kiba", "teppo", "ninja"]], [720, ["kiba", "teppo", "tetsuoni"]]], mid: ["kuma", "akaoni"], boss: "karakuri" },
    { maps: [16, 17], feat: "siege", color: 0xa83232, name: C("會津・鶴之城籠城戰", "会津・鶴ヶ城籠城戦"), desc: C("城上的大砲會轟擊玩家的位置（紅圈預警），敵人以軍勢陣形推進。", "城の大砲がプレイヤーの位置を砲撃（赤い円で予告）。敵は陣形で押し寄せる。"),
      roster: [[0, ["ashigaru", "yari"]], [120, ["yari", "teppo", "nobushi"]], [300, ["nobushi", "kiba", "gaikotsu"]], [540, ["tetsuoni", "kiba", "teppo"]], [720, ["tetsuoni", "akaoni", "kiba"]]], mid: ["akaoni", "kuma"], boss: "ozutsuoni" },
    { maps: [18, 19], feat: "eruption", color: 0xe0502a, name: C("磐梯山・大噴火", "磐梯山・大噴火"), desc: C("火山彈不斷落下並留下熔岩池；溶岩兵被打倒會分裂。最終魔王荒覇吐神在此等候。", "火山弾が降り溶岩溜まりを残す。溶岩兵は倒すと分裂。最後の魔王・荒覇吐神が待つ。"),
      roster: [[0, ["kasha", "onibi"]], [120, ["yogan", "kasha", "onibi"]], [300, ["yogan", "akaoni", "kasha"]], [540, ["yogan", "tetsuoni", "kasha"]], [720, ["yogan", "tetsuoni", "akaoni"]]], mid: ["akaoni", "akaoni"], boss: "arahabaki" }
  ];
  var FEATS = {
    blizzard: { icon: "❄️" }, vents: { icon: "♨️" }, iron: { icon: "⚒️" }, river: { icon: "🌊" }, gold: { icon: "💰" },
    darkness: { icon: "🌑" }, wind: { icon: "🌬️" }, gunners: { icon: "🔫" }, siege: { icon: "🏯" }, eruption: { icon: "🌋" }
  };

  // ---------------- 本陣強化（每局結束的錢永久累積）----------------
  var META = [
    { k: "might", v: 0.05, max: 5, cost: 200, name: C("武具鍛錬", "武具鍛錬") },
    { k: "maxHp", v: 10, max: 5, cost: 150, name: C("兵糧", "兵糧") },
    { k: "armor", v: 1, max: 3, cost: 300, name: C("具足", "具足") },
    { k: "speed", v: 0.04, max: 3, cost: 250, name: C("馬術", "馬術") },
    { k: "magnet", v: 0.15, max: 3, cost: 150, name: C("小荷駄", "小荷駄") },
    { k: "growth", v: 0.04, max: 5, cost: 250, name: C("兵法書", "兵法書") },
    { k: "greed", v: 0.08, max: 5, cost: 150, name: C("檢地", "検地") },
    { k: "luck", v: 0.05, max: 3, cost: 300, name: C("祈禱", "祈祷") },
    { k: "cdr", v: 0.025, max: 3, cost: 400, name: C("軍略", "軍略") },
    { k: "revive", v: 1, max: 1, cost: 1500, name: C("影武者（復活 1 次）", "影武者（復活 1 回）") },
    { k: "reroll", v: 1, max: 3, cost: 500, name: C("重抽（升級選項）", "引き直し（レベルアップ）") }
  ];

  var DIFFS = {
    normal: { hp: 1, dmg: 1, rate: 1, name: C("普通", "普通") },
    hard: { hp: 1.6, dmg: 1.35, rate: 1.25, name: C("困難", "困難") },
    hell: { hp: 2.6, dmg: 1.8, rate: 1.5, name: C("地獄", "地獄") }
  };

  window.PriTestYukimuraData = {
    C: C, L: L, STATS: STATS, STAT: STAT, PREFS: PREFS, VARIANTS: VARIANTS, ARCHES: ARCHES, WEAPONS: WEAPONS, WLV: WLV,
    MAX_WLV: MAX_WLV, MAX_ALV: MAX_ALV, MAX_W: MAX_W, MAX_A: MAX_A, CRAFTS: CRAFTS, ACCS: ACCS, accStats: accStats,
    FOODS: FOODS, ULTS: ULTS, DAIMYO: DAIMYO, DM_KINDS: [C("大名", "大名"), C("武將", "武将"), C("女武將", "女武将"), C("忍者", "忍者")], ENEMIES: ENEMIES, BOSSES: BOSSES, MAPS: MAPS, STAGES: STAGES, FEATS: FEATS,
    META: META, DIFFS: DIFFS, ARENA: 60
  };
})();
