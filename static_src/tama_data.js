// 百鬼轉珠（tama）：靜態資料（角色、妖怪、關卡）。規則依據 docs/tama_game_design.md。
// 角色頭像沿用 static/images/jikan/ 的 g_ 系列；妖怪圖由 tama_art.js 以 SVG 繪製。
// 名字等內容字串直接以 {zh, ja, en} 放在資料裡；技能說明由 tama.js 依 I18N 模板組出。
(function () {
  "use strict";

  var ATTRS = ["fire", "water", "wood", "light", "dark"];
  var ORBS = ["fire", "water", "wood", "light", "dark", "heart"];

  // 稀有度 → 等級 1 能力值（§5）
  var BASE = {
    3: { hp: 320, atk: 90, rcv: 35 },
    4: { hp: 420, atk: 115, rcv: 45 },
    5: { hp: 520, atk: 140, rcv: 55 }
  };
  var MAX_LV = 30;

  function n(zh, ja, en) { return { zh: zh, ja: ja, en: en }; }

  // 隊長技能 ls：t = atk（attr, m）| hp（m）| combo（min, m, attr?）| time（s）| regen（p）| guard（p）
  // 主動技能 as：t = convert（from, to）| delay（n）| nuke（m）| buff（attr, m, turns）| heal（p）
  //              | time（s, turns）| jamheal（p）| refresh | shield（p, turns）；cd = 冷卻回合
  var HEROES = [
    // 火
    { id: "akane", img: "g_000", attr: "fire", rarity: 3, name: n("朱音", "朱音", "Akane"), title: n("見習巫女", "見習い巫女", "Apprentice Miko"),
      ls: [{ t: "atk", attr: "fire", m: 1.5 }], as: { t: "convert", from: "heart", to: "fire", cd: 5 } },
    { id: "homura", img: "g_031", attr: "fire", rarity: 3, name: n("焔", "焔", "Homura"), title: n("火打石的符師", "火打ちの符術師", "Flint Talisman Caster"),
      ls: [{ t: "atk", attr: "fire", m: 1.5 }], as: { t: "delay", n: 1, cd: 6 } },
    { id: "momiji", img: "g_014", attr: "fire", rarity: 4, name: n("紅葉", "紅葉", "Momiji"), title: n("退魔軍師", "退魔の軍師", "Exorcist Strategist"),
      ls: [{ t: "atk", attr: "fire", m: 2 }], as: { t: "convert", from: "water", to: "fire", cd: 7 } },
    { id: "tsubaki", img: "g_015", attr: "fire", rarity: 4, name: n("椿", "椿", "Tsubaki"), title: n("紅椿的劍客", "紅椿の剣客", "Crimson Camellia Blade"),
      ls: [{ t: "hp", m: 1.5 }], as: { t: "nuke", m: 20, cd: 8 } },
    { id: "hozuki", img: "g_021", attr: "fire", rarity: 5, name: n("鬼灯", "鬼灯", "Hozuki"), title: n("與人立約的鬼姬", "人と契りし鬼姫", "Oni Princess of the Pact"),
      ls: [{ t: "atk", attr: "fire", m: 2.5 }, { t: "combo", min: 5, m: 1.5, attr: "fire" }], as: { t: "buff", attr: "fire", m: 2, turns: 2, cd: 8 } },
    // 水
    { id: "shizuku", img: "g_001", attr: "water", rarity: 3, name: n("雫", "雫", "Shizuku"), title: n("泉之巫女", "泉の巫女", "Spring Miko"),
      ls: [{ t: "atk", attr: "water", m: 1.5 }], as: { t: "convert", from: "heart", to: "water", cd: 5 } },
    { id: "mio", img: "g_030", attr: "water", rarity: 3, name: n("澪", "澪", "Mio"), title: n("水脈的治癒師", "水脈の癒し手", "Waterway Healer"),
      ls: [{ t: "regen", p: 0.1 }], as: { t: "heal", p: 0.5, cd: 6 } },
    { id: "ruri", img: "g_004", attr: "water", rarity: 4, name: n("瑠璃", "瑠璃", "Ruri"), title: n("陰陽寮的才女", "陰陽寮の才女", "Onmyo Prodigy"),
      ls: [{ t: "time", s: 1 }, { t: "atk", attr: "water", m: 1.5 }], as: { t: "time", s: 3, turns: 2, cd: 6 } },
    { id: "shione", img: "g_011", attr: "water", rarity: 4, name: n("汐音", "汐音", "Shione"), title: n("潮騷的歌姬", "潮騒の歌姫", "Tide Singer"),
      ls: [{ t: "atk", attr: "water", m: 2 }], as: { t: "convert", from: "fire", to: "water", cd: 7 } },
    { id: "ai", img: "g_020", attr: "water", rarity: 5, name: n("藍", "藍", "Ai"), title: n("龍神的使者", "龍神の御使い", "Envoy of the Dragon God"),
      ls: [{ t: "atk", attr: "water", m: 2.5 }, { t: "combo", min: 5, m: 1.5, attr: "water" }], as: { t: "buff", attr: "water", m: 2, turns: 2, cd: 8 } },
    // 木
    { id: "sakura", img: "g_003", attr: "wood", rarity: 3, name: n("桜", "桜", "Sakura"), title: n("花守", "花守", "Blossom Keeper"),
      ls: [{ t: "atk", attr: "wood", m: 1.5 }], as: { t: "convert", from: "heart", to: "wood", cd: 5 } },
    { id: "kosuzu", img: "g_023", attr: "wood", rarity: 3, name: n("小雀", "小雀", "Kosuzu"), title: n("茶屋的招牌娘", "茶屋の看板娘", "Teahouse Darling"),
      ls: [{ t: "combo", min: 4, m: 2 }], as: { t: "jamheal", p: 0.2, cd: 5 } },
    { id: "wakaba", img: "g_013", attr: "wood", rarity: 4, name: n("若葉", "若葉", "Wakaba"), title: n("森之歌者", "森の歌い手", "Forest Singer"),
      ls: [{ t: "hp", m: 1.5 }], as: { t: "refresh", cd: 4 } },
    { id: "midori", img: "g_022", attr: "wood", rarity: 4, name: n("翠", "翠", "Midori"), title: n("山野的獵人", "山野の狩人", "Mountain Huntress"),
      ls: [{ t: "atk", attr: "wood", m: 2 }], as: { t: "convert", from: "light", to: "wood", cd: 7 } },
    { id: "yuzuha", img: "g_024", attr: "wood", rarity: 5, name: n("柚葉", "柚葉", "Yuzuha"), title: n("古樹的代言人", "古樹の代弁者", "Voice of the Old Tree"),
      ls: [{ t: "atk", attr: "wood", m: 2.5 }, { t: "combo", min: 5, m: 1.5, attr: "wood" }], as: { t: "buff", attr: "wood", m: 2, turns: 2, cd: 8 } },
    // 光
    { id: "hikari", img: "g_002", attr: "light", rarity: 3, name: n("光", "光", "Hikari"), title: n("曉之巫女", "暁の巫女", "Dawn Miko"),
      ls: [{ t: "atk", attr: "light", m: 1.5 }], as: { t: "convert", from: "heart", to: "light", cd: 5 } },
    { id: "himari", img: "g_008", attr: "light", rarity: 3, name: n("陽葵", "陽葵", "Himari"), title: n("機關師", "からくり技師", "Karakuri Tinker"),
      ls: [{ t: "combo", min: 4, m: 2 }], as: { t: "delay", n: 1, cd: 6 } },
    { id: "amane", img: "g_007", attr: "light", rarity: 4, name: n("天音", "天音", "Amane"), title: n("神樂舞姬", "神楽の舞姫", "Kagura Dancer"),
      ls: [{ t: "atk", attr: "light", m: 2 }], as: { t: "convert", from: "dark", to: "light", cd: 7 } },
    { id: "shizuka", img: "g_028", attr: "light", rarity: 4, name: n("静", "静", "Shizuka"), title: n("結界守", "結界守", "Barrier Warden"),
      ls: [{ t: "guard", p: 0.2 }], as: { t: "shield", p: 0.5, turns: 2, cd: 8 } },
    { id: "kaguya", img: "g_016", attr: "light", rarity: 5, name: n("輝夜", "輝夜", "Kaguya"), title: n("月之騎士", "月の騎士", "Knight of the Moon"),
      ls: [{ t: "atk", attr: "light", m: 2.5 }, { t: "combo", min: 5, m: 1.5, attr: "light" }], as: { t: "buff", attr: "light", m: 2, turns: 2, cd: 8 } },
    // 闇
    { id: "yoi", img: "g_005", attr: "dark", rarity: 3, name: n("夜宵", "夜宵", "Yoi"), title: n("宵之魔女", "宵の魔女", "Witch of Dusk"),
      ls: [{ t: "atk", attr: "dark", m: 1.5 }], as: { t: "convert", from: "heart", to: "dark", cd: 5 } },
    { id: "oboro", img: "g_027", attr: "dark", rarity: 3, name: n("朧", "朧", "Oboro"), title: n("朧月的忍", "朧月の忍", "Shinobi of the Hazy Moon"),
      ls: [{ t: "time", s: 1 }, { t: "atk", attr: "dark", m: 1.5 }], as: { t: "time", s: 3, turns: 2, cd: 6 } },
    { id: "kureha", img: "g_009", attr: "dark", rarity: 4, name: n("黒羽", "黒羽", "Kureha"), title: n("鴉天狗的養女", "烏天狗の養い子", "Ward of the Crow Tengu"),
      ls: [{ t: "atk", attr: "dark", m: 2 }], as: { t: "convert", from: "wood", to: "dark", cd: 7 } },
    { id: "shirotae", img: "g_025", attr: "dark", rarity: 4, name: n("白妙", "白妙", "Shirotae"), title: n("人偶使", "人形遣い", "Puppeteer"),
      ls: [{ t: "hp", m: 1.5 }], as: { t: "nuke", m: 20, cd: 8 } },
    { id: "shion", img: "g_012", attr: "dark", rarity: 5, name: n("紫苑", "紫苑", "Shion"), title: n("半妖的公主", "半妖の姫", "Half-Yokai Princess"),
      ls: [{ t: "atk", attr: "dark", m: 2.5 }, { t: "combo", min: 5, m: 1.5, attr: "dark" }], as: { t: "buff", attr: "dark", m: 2, turns: 2, cd: 8 } }
  ];

  var STARTERS = ["akane", "shizuku", "sakura", "hikari", "yoi"];

  // 妖怪（§6）。sp：jam（n）| enrage | heavy；art = tama_art.js 的繪圖鍵。stats 為倍率 1 時的值。
  var ENEMIES = {
    onibi:    { attr: "fire",  hp: 300,   atk: 90,  def: 0,   cd: 1, name: n("鬼火", "鬼火", "Onibi") },
    kodama:   { attr: "wood",  hp: 420,   atk: 70,  def: 0,   cd: 2, name: n("木靈", "木霊", "Kodama") },
    kappa:    { attr: "water", hp: 520,   atk: 110, def: 10,  cd: 2, name: n("河童", "河童", "Kappa") },
    chochin:  { attr: "fire",  hp: 450,   atk: 130, def: 0,   cd: 2, sp: { t: "jam", n: 3 }, name: n("提燈妖怪", "提灯お化け", "Lantern Ghost") },
    karakasa: { attr: "dark",  hp: 600,   atk: 120, def: 20,  cd: 2, name: n("唐傘妖怪", "唐傘お化け", "Umbrella Ghost") },
    ittan:    { attr: "light", hp: 500,   atk: 100, def: 0,   cd: 1, name: n("一反木綿", "一反木綿", "Ittan-momen") },
    bakeneko: { attr: "dark",  hp: 700,   atk: 150, def: 10,  cd: 2, sp: { t: "enrage" }, name: n("化貓", "化け猫", "Bakeneko") },
    tengu:    { attr: "wood",  hp: 900,   atk: 180, def: 30,  cd: 3, sp: { t: "heavy" }, name: n("天狗", "天狗", "Tengu") },
    umibozu:  { attr: "water", hp: 1400,  atk: 220, def: 40,  cd: 3, sp: { t: "heavy" }, name: n("海坊主", "海坊主", "Umibozu") },
    raiju:    { attr: "light", hp: 1000,  atk: 160, def: 20,  cd: 1, sp: { t: "jam", n: 2 }, name: n("雷獸", "雷獣", "Raiju") },
    omukade:  { attr: "wood",  hp: 4200,  atk: 420, def: 30,  cd: 2, sp: { t: "jam", n: 4 }, boss: true, name: n("大百足", "大百足", "Great Centipede") },
    gasha:    { attr: "dark",  hp: 11000, atk: 900, def: 80,  cd: 3, sp: { t: "heavy" }, boss: true, name: n("餓者髑髏", "がしゃどくろ", "Gashadokuro") },
    kyubi:    { attr: "light", hp: 28000, atk: 1300, def: 120, cd: 2, sp: { t: "enrage" }, boss: true, name: n("九尾狐", "九尾の狐", "Nine-Tailed Fox") }
  };

  // 關卡（§7）：f = 該關妖怪能力倍率；waves = 每波的妖怪鍵；recruit = 首次通關加入
  var CHAPTERS = [
    { id: "c1", name: n("夕暮山道", "夕暮れの山道", "Twilight Mountain Path"), bg: "dusk", stages: [
      { id: "1-1", f: 1,    exp: 60,  waves: [["onibi", "onibi"], ["kodama", "onibi", "kodama"]], recruit: ["homura", "mio"] },
      { id: "1-2", f: 1.25, exp: 80,  waves: [["kodama", "kappa"], ["onibi", "kappa", "onibi"]], recruit: ["kosuzu", "himari"] },
      { id: "1-3", f: 1.5,  exp: 100, waves: [["chochin", "onibi"], ["kappa", "chochin", "kodama"]], recruit: ["oboro"] },
      { id: "1-4", f: 1,    exp: 160, waves: [["kodama", "chochin", "kappa"], ["omukade"]], recruit: ["wakaba", "ruri"] }
    ] },
    { id: "c2", name: n("月下古寺", "月下の古寺", "Moonlit Old Temple"), bg: "temple", stages: [
      { id: "2-1", f: 2.2,  exp: 220, waves: [["karakasa", "ittan"], ["ittan", "karakasa", "ittan"]], recruit: ["momiji", "shione"] },
      { id: "2-2", f: 2.5,  exp: 260, waves: [["bakeneko", "karakasa"], ["ittan", "bakeneko", "chochin"]], recruit: ["midori", "amane"] },
      { id: "2-3", f: 2.8,  exp: 300, waves: [["tengu", "ittan"], ["bakeneko", "tengu"], ["karakasa", "tengu", "bakeneko"]], recruit: ["kureha", "tsubaki"] },
      { id: "2-4", f: 1,    exp: 450, waves: [["karakasa", "bakeneko", "ittan"], ["tengu", "tengu"], ["gasha"]], recruit: ["shizuka", "shirotae"] }
    ] },
    { id: "c3", name: n("鬼之城", "鬼ヶ城", "Demon Castle"), bg: "castle", stages: [
      { id: "3-1", f: 3.2,  exp: 600,  waves: [["umibozu", "kappa"], ["raiju", "umibozu"]], recruit: ["hozuki", "ai"] },
      { id: "3-2", f: 3.6,  exp: 700,  waves: [["raiju", "tengu"], ["bakeneko", "raiju", "tengu"]], recruit: ["yuzuha"] },
      { id: "3-3", f: 3.8,  exp: 800,  waves: [["umibozu", "raiju"], ["tengu", "umibozu", "bakeneko"], ["raiju", "raiju", "umibozu"]], recruit: ["kaguya"] },
      { id: "3-4", f: 1,    exp: 1200, waves: [["umibozu", "raiju", "tengu"], ["gasha"], ["kyubi"]], recruit: ["shion"] }
    ] }
  ];

  var HERO_BY_ID = {};
  HEROES.forEach(function (h) { HERO_BY_ID[h.id] = h; });
  var STAGE_BY_ID = {}, STAGE_ORDER = [];
  CHAPTERS.forEach(function (c) { c.stages.forEach(function (s) { s.chapter = c.id; STAGE_BY_ID[s.id] = s; STAGE_ORDER.push(s.id); }); });

  var api = {
    ATTRS: ATTRS, ORBS: ORBS, BASE: BASE, MAX_LV: MAX_LV,
    HEROES: HEROES, HERO_BY_ID: HERO_BY_ID, STARTERS: STARTERS,
    ENEMIES: ENEMIES, CHAPTERS: CHAPTERS, STAGE_BY_ID: STAGE_BY_ID, STAGE_ORDER: STAGE_ORDER
  };
  var root = typeof window !== "undefined" ? window : globalThis;
  root.PriTestTamaData = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
