// 煉金術士（atelier）：第 6 階段的配方系列（docs/atelier_design.md §12）。
// atelier_data.js 原有 16 個配方，這裡用 23 個系列 × 8 個展開成 184 個，總共 200 種。
// 每個系列：類別、第 2 個素材格的類別、2 條量表（屬性:效果）、起始等級、擅長的釜、第 1 個配方的發想條件。
// 系列中第 i 個配方的等級＝起始等級＋2i；發想條件是「做過前一個」（第 4、7 個改成「前一個的品質達到 45／60」）。
// 門檻、效果數值、價格都由公式算出（全部暫定），集中在 build()。
(function () {
  "use strict";
  function N(s) { var p = s.split("|"); return { zh: p[0], ja: p[1], en: p[2] }; }
  // [id, 類別, 第 2 格類別, 量表 1, 量表 2, 起始 Lv, 擅長的釜, 第 1 個配方的發想, 系列名, 8 個配方名]
  var SERIES = [
    ["elixir", "liquid", "plant", "wind:heal", "ice:cleanse", 1, "copper", null, "藥湯|薬湯|Tonics",
      ["薄荷露水|ハッカの露|Mint Dew", "蜂蜜滋養液|はちみつ滋養液|Honey Tonic", "青草膏|青草の軟膏|Green Salve", "月見草精|月見草のエキス|Primrose Essence",
        "百草湯|百草湯|Hundred-Herb Broth", "生命之滴|いのちのしずく|Drop of Life", "長春秘藥|長春の秘薬|Evergreen Elixir", "甦生仙露|よみがえりの仙露|Elixir of Revival"]],
    ["paint", "essence", "mineral", "spirit:value", "fire:dye", 1, "copper", null, "繪具|絵の具|Paints",
      ["水彩粉|水彩の粉|Watercolor Powder", "蠟筆芯|クレヨンの芯|Crayon Core", "粉彩條|パステル|Pastel Stick", "岩彩泥|岩絵の具|Mineral Paint",
        "金泥|金泥|Gold Paint", "夜光繪具|夜光絵の具|Glow Paint", "不褪之彩|褪せない彩り|Unfading Hue", "天空畫布|空のキャンバス|Sky Canvas"]],
    ["textile", "plant", "liquid", "fire:dye", "wind:guard", 1, "copper", { made: "ink" }, "染織|染め織り|Textiles",
      ["藍染手巾|藍染めの手ぬぐい|Indigo Towel", "草木染線|草木染めの糸|Plant-Dyed Thread", "紅花緞帶|紅花のリボン|Safflower Ribbon", "茜色頭巾|茜色の頭巾|Madder Hood",
        "七彩織錦|七色の錦|Seven-Hue Brocade", "晚霞披肩|夕焼けのショール|Sunset Shawl", "天女羽衣|天女の羽衣|Celestial Robe", "虹織長袍|虹織りの長衣|Rainbow-Woven Gown"]],
    ["garden", "plant", "liquid", "wind:grow", "ice:heal", 1, "glass", { made: "heal" }, "園藝|園芸|Gardening",
      ["發芽粉|芽吹きの粉|Sprouting Powder", "綠肥球|緑の肥料玉|Green Compost Ball", "花開水|花ひらきの水|Blooming Water", "果實精|実りの精|Fruit Spirit",
        "豐收鈴|豊穣の鈴|Harvest Bell", "四季種子|四季の種|Four-Season Seed", "森林之息|森の息吹|Breath of the Forest", "萬花之苗|万花の苗|Seedling of Myriad Blooms"]],
    ["cuisine", "liquid", "plant", "fire:warm", "wind:heal", 1, "copper", { made: "neutral" }, "料理|料理|Cuisine",
      ["番茄湯|トマトスープ|Tomato Soup", "南瓜派|かぼちゃのパイ|Pumpkin Pie", "薑汁奶茶|しょうがミルクティー|Ginger Milk Tea", "七彩果凍|七色ゼリー|Rainbow Jelly",
        "暖爐燉菜|暖炉のシチュー|Hearth Stew", "黃金布丁|黄金のプリン|Golden Pudding", "星空蛋糕|星空のケーキ|Starry-Sky Cake", "萬味饗宴|万味の饗宴|Feast of All Flavors"]],
    ["spark", "mineral", "essence", "fire:dmg", "bolt:stun", 2, "iron", { made: "bomb" }, "火藥|火薬|Fireworks",
      ["線香花火|線香花火|Sparkler", "爆竹|かんしゃく玉|Cracker Ball", "煙幕彈|けむり玉|Smoke Ball", "雷鳴彈|雷鳴弾|Thunder Shell",
        "熔岩石|溶岩石|Lava Stone", "火龍之息|火竜の吐息|Dragon's Breath", "流星爆|流星爆弾|Meteor Burst", "太陽核心|太陽の核|Sun Core"]],
    ["amulet", "plant", "essence", "wind:guard", "spirit:speed", 2, "glass", { seenEl: { el: "wind", n: 3 } }, "護身|お守り|Amulets",
      ["四葉草書籤|四つ葉のしおり|Clover Bookmark", "草編手環|草編みの腕輪|Woven Grass Bracelet", "守護香囊|守り香袋|Guardian Pouch", "森之徽章|森の紋章|Forest Crest",
        "疾風羽飾|疾風の羽飾り|Gale Feather", "古木之盾|古木の盾|Ancient Wood Shield", "精靈之環|精霊の環|Spirit Circlet", "世界樹之葉|世界樹の葉|Leaf of the World Tree"]],
    ["incense", "plant", "essence", "wind:heal", "spirit:speed", 2, "glass", { seenCount: 6 }, "香|お香|Incense",
      ["薰衣草枕|ラベンダーの枕|Lavender Pillow", "檀香片|白檀のかけら|Sandalwood Chip", "柚子香油|柚子の香油|Yuzu Oil", "桂花蜜香|金木犀の蜜香|Osmanthus Scent",
        "安眠香|安眠のお香|Slumber Incense", "醒神薄荷|目覚めのミント|Awakening Mint", "千里香|千里香|Thousand-Mile Fragrance", "夢之花香|夢の花の香|Dream Blossom Scent"]],
    ["trinket", "crystal", "essence", "spirit:luck", "bolt:value", 2, "star", { seenCount: 8 }, "飾品|アクセサリー|Trinkets",
      ["玻璃珠|ビー玉|Glass Marble", "幸運鈕扣|幸運のボタン|Lucky Button", "琥珀胸針|琥珀のブローチ|Amber Brooch", "月長石戒|ムーンストーンの指輪|Moonstone Ring",
        "星砂項鍊|星の砂のペンダント|Star-Sand Pendant", "七色耳墜|七色の耳飾り|Seven-Hue Earrings", "女神之淚|女神の涙|Goddess's Tear", "萬色寶冠|万色の宝冠|Diadem of All Colors"]],
    ["glassware", "crystal", "liquid", "ice:value", "bolt:light", 2, "glass", { seenEl: { el: "ice", n: 3 } }, "玻璃器|ガラス器|Glassware",
      ["小玻璃杯|小さなグラス|Little Glass", "彩繪玻璃|ステンドグラス片|Stained Glass Shard", "藥瓶|薬瓶|Apothecary Vial", "萬花筒|万華鏡|Kaleidoscope",
        "水晶球|水晶玉|Crystal Ball", "玻璃風鈴|ガラスの風鈴|Glass Wind Chime", "七色燒瓶|七色のフラスコ|Seven-Hue Flask", "天空之鏡|天空の鏡|Mirror of the Sky"]],
    ["spring", "liquid", "crystal", "ice:heal", "spirit:cleanse", 2, "glass", { made: "neutral" }, "泉水|泉の水|Spring Waters",
      ["清泉水|清水|Clear Spring Water", "淨化鹽|清めの塩|Purifying Salt", "晨霧瓶|朝霧の瓶|Morning Mist Jar", "聖泉之水|聖なる泉の水|Holy Spring Water",
        "鏡湖之滴|鏡の湖のしずく|Mirror Lake Drop", "雨神之淚|雨神の涙|Rain God's Tear", "青龍之泉|青龍の泉|Azure Dragon Spring", "源流之水|源流の水|Wellspring Water"]],
    ["lantern", "crystal", "mineral", "bolt:light", "spirit:value", 3, "star", { seenEl: { el: "bolt", n: 3 } }, "燈火|灯り|Lanterns",
      ["螢火瓶|ほたる瓶|Firefly Jar", "燭台結晶|燭台の結晶|Candle Crystal", "月光燈|月光ランプ|Moonlight Lamp", "極光燈籠|オーロラ灯籠|Aurora Lantern",
        "星屑燭|星くずの燭|Stardust Candle", "燈塔之心|灯台の心|Lighthouse Heart", "永夜明燈|常夜の灯|Everlasting Lamp", "晨星|明けの明星|Morning Star"]],
    ["frostwork", "crystal", "liquid", "ice:freeze", "spirit:value", 3, "glass", { made: "frost" }, "冰霜|氷と霜|Frostwork",
      ["霜花片|霜の花びら|Frost Petal", "冰糖晶|氷砂糖の結晶|Rock-Candy Crystal", "雪見瓶|雪見瓶|Snowglobe", "冰柱笛|つららの笛|Icicle Flute",
        "寒月鏡|寒月の鏡|Winter Moon Mirror", "冰河之心|氷河の心|Glacier Heart", "永凍王冠|永久凍土の冠|Permafrost Crown", "白銀世界|白銀の世界|Silver World"]],
    ["alloy", "mineral", "crystal", "bolt:value", "fire:guard", 3, "iron", { seenCount: 15 }, "合金|合金|Alloys",
      ["黃銅釘|真鍮の釘|Brass Nail", "鐵砂塊|砂鉄の塊|Iron Sand Ingot", "銀鈴|銀の鈴|Silver Bell", "青銅齒輪|青銅の歯車|Bronze Gear",
        "白金線|白金の糸|Platinum Wire", "隕鐵|隕鉄|Meteoric Iron", "星銀板|星銀の板|Starsilver Plate", "賢者合金|賢者の合金|Sage's Alloy"]],
    ["flame", "mineral", "plant", "fire:warm", "bolt:dmg", 3, "iron", { seenEl: { el: "fire", n: 5 } }, "火焰|炎|Flames",
      ["火種石|火種の石|Ember Stone", "暖手爐|懐炉|Hand Warmer", "篝火柴|かがり火の薪|Bonfire Log", "鳳仙火|鳳仙火|Balsam Flame",
        "紅蓮之珠|紅蓮の珠|Crimson Lotus Orb", "不滅之火|消えない火|Undying Flame", "火山之心|火山の心臓|Heart of the Volcano", "鳳凰之羽|不死鳥の羽|Phoenix Feather"]],
    ["umbra", "shadow", "plant", "spirit:guard", "wind:speed", 4, "star", { made: "shade" }, "影|影|Shadows",
      ["夜色手帕|夜色のハンカチ|Night Handkerchief", "影縫針|影縫いの針|Shadow Needle", "黑貓鈴|黒猫の鈴|Black Cat Bell", "隱身墨|隠れ墨|Vanishing Ink",
        "夢魘面具|悪夢の仮面|Nightmare Mask", "暗月披風|闇月の外套|Dark Moon Mantle", "影之王座|影の玉座|Shadow Throne", "無明之夜|無明の夜|Lightless Night"]],
    ["thunder", "mineral", "crystal", "bolt:stun", "ice:speed", 4, "iron", { seenEl: { el: "bolt", n: 5 } }, "雷|雷|Thunder",
      ["靜電絨球|静電気の毛玉|Static Fluff", "雷石|雷石|Thunderstone", "電光指針|電光の針|Lightning Needle", "雷鳴鼓|雷鳴の太鼓|Thunder Drum",
        "紫電之鞭|紫電の鞭|Violet Lightning Whip", "雷雲瓶|雷雲の瓶|Storm Cloud Jar", "天雷之槌|天雷の槌|Hammer of Heaven", "雷神之眼|雷神の瞳|Eye of the Storm"]],
    ["tome", "essence", "crystal", "spirit:sense", "ice:value", 4, "star", { seenCount: 25 }, "書|書物|Tomes",
      ["色彩筆記|色のノート|Color Notebook", "觀星圖|星見の図|Star Chart", "古文書|古文書|Old Manuscript", "煉金術入門|錬金術入門|Alchemy Primer",
        "色彩辭典|色彩辞典|Dictionary of Colors", "預言之書|予言の書|Book of Prophecy", "賢者手記|賢者の手記|Sage's Journal", "萬色之書|万色の書|Codex of All Colors"]],
    ["breeze", "plant", "mineral", "wind:speed", "bolt:stun", 4, "glass", { made: "charm" }, "風|風|Breezes",
      ["竹蜻蜓|竹とんぼ|Bamboo Copter", "紙風車|紙風車|Paper Pinwheel", "風箏線|凧の糸|Kite String", "疾走鞋墊|はやて靴の中敷き|Swift Insole",
        "旋風扇|つむじ風の扇|Whirlwind Fan", "雲之翼|雲の翼|Wings of Cloud", "嵐之號角|嵐の角笛|Storm Horn", "天馬之靴|天馬の靴|Pegasus Boots"]],
    ["starry", "shadow", "crystal", "spirit:light", "ice:freeze", 5, "star", { seen: "kon" }, "星夜|星の夜|Starry Nights",
      ["星光碎片|星明かりのかけら|Starlight Fragment", "夜露瓶|夜露の瓶|Night Dew Jar", "銀河砂|銀河の砂|Galaxy Sand", "新月之鏡|新月の鏡|New Moon Mirror",
        "彗星尾羽|彗星の尾羽|Comet Tail Feather", "星座盤|星座盤|Planisphere", "夜空羅盤|夜空の羅針盤|Night-Sky Compass", "銀河之杯|銀河の杯|Chalice of the Milky Way"]],
    ["music", "essence", "mineral", "bolt:speed", "wind:luck", 5, "iron", { seenCount: 30 }, "樂音|音|Music",
      ["草笛|草笛|Grass Whistle", "音叉|音叉|Tuning Fork", "八音盒|オルゴール|Music Box", "銀笛|銀の笛|Silver Flute",
        "星之豎琴|星の竪琴|Star Harp", "回聲貝殼|こだまの貝殻|Echo Shell", "祝福之鐘|祝福の鐘|Bell of Blessing", "天籟之琴|天籟の琴|Harp of Heaven"]],
    ["relic", "essence", "crystal", "spirit:value", "fire:luck", 6, "star", { made: "prism" }, "秘寶|秘宝|Relics",
      ["賢者之石屑|賢者の石くず|Philosopher's Grit", "時之沙漏|時の砂時計|Hourglass of Time", "龍之鱗|竜のうろこ|Dragon Scale", "人魚之歌|人魚の歌|Mermaid's Song",
        "黃金蘋果|黄金のりんご|Golden Apple", "永恆之花|永遠の花|Eternal Flower", "創世之卵|創世の卵|Egg of Genesis", "萬色之心|万色の心|Heart of All Colors"]],
    ["gadget", "mineral", "plant", "bolt:speed", "ice:guard", 6, "iron", { seenCount: 35 }, "工具|道具|Tools",
      ["煉金攪拌棒|錬金の攪拌棒|Alchemy Stirrer", "精密天秤|精密天秤|Precision Scale", "萬能鉗|万能やっとこ|All-Purpose Tongs", "魔力研缽|魔力の乳鉢|Mana Mortar",
        "自動羽毛筆|自動羽ペン|Self-Writing Quill", "飛行掃帚|空飛ぶほうき|Flying Broom", "時光懷錶|時の懐中時計|Pocket Watch of Time", "萬象工房|万象の工房|Workshop of Everything"]]
  ];
  // 數值型效果的基準（第 1 段、Lv0）；其他效果是「段數＋floor(Lv/8)」（暫定）
  var SCALAR = { heal: 16, value: 16, dmg: 24, guard: 8, warm: 10, grow: 10 };
  var SCALAR_CAP = { guard: 80 };
  var STEP_MULT = [1, 2, 3.4];

  function steps(kind, lv, ats) {
    return ats.map(function (at, i) {
      var n = SCALAR[kind] ? Math.round(SCALAR[kind] * (1 + lv * 0.25) * STEP_MULT[i]) : i + 1 + Math.floor(lv / 8);
      if (SCALAR_CAP[kind]) n = Math.min(SCALAR_CAP[kind], n);
      return { at: at, kind: kind, n: n };
    });
  }
  function slotCount(lv) { return lv < 3 ? 2 : lv < 8 ? 3 : lv < 13 ? 4 : 5; }

  function build(D) {
    if (D.RECIPE_SERIES) return D;                     // 只展開一次
    D.RECIPE_SERIES = [];
    SERIES.forEach(function (s) {
      var ids = [];
      s[9].forEach(function (name, i) {
        var lv = s[5] + i * 2, a = 6 + Math.floor((lv - 1) * 0.6), id = s[0] + (i + 1), prev = s[0] + i;
        var g1 = s[3].split(":"), g2 = s[4].split(":"), needs = [s[1], s[2]];
        while (needs.length < slotCount(lv)) needs.push("*");
        var idea = i === 0 ? s[7] : i === 3 ? { quality: { recipe: prev, n: 45 } } : i === 6 ? { quality: { recipe: prev, n: 60 } } : { made: prev };
        var r = { id: id, lv: lv, cat: s[1], series: s[0], needs: needs, name: N(name),
          gauges: [{ el: g1[0], steps: steps(g1[1], lv, [a, 2 * a, 3 * a]) }, { el: g2[0], steps: steps(g2[1], lv, [a + 2, 2 * a + 4]) }] };
        if (idea) r.idea = idea;
        D.RECIPES.push(r);
        D.RECIPE_PRICE[id] = 30 + lv * 10 + needs.length * 5;
        D.CAULDRONS[s[6]].affinity.push(id);
        ids.push(id);
      });
      D.RECIPE_SERIES.push({ id: s[0], name: N(s[8]), cat: s[1], cauldron: s[6], recipes: ids });
    });
    return D;
  }
  if (typeof module !== "undefined" && module.exports) module.exports = build;
  else build(window.PriTestAtelierData);
})();
