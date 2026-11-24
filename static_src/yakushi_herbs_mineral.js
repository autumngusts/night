// 少女藥師的獨語（yakushi）：礦石・金屬（12）。文字只寫常識，不寫劑量、提煉、取得方法（§4.5）。
(function () {
  "use strict";
  var root = typeof window !== "undefined" ? window : globalThis;
  // 試藥結果：沒有特別反應的方法填 null。銀針只有砒霜有反應（因含硫雜質），其他一律 null（§4.4）。
  function T(look, smell, taste, water, heat, animal, silver) {
    return { look: look, smell: smell, taste: taste, silver: silver || null, water: water, heat: heat, animal: animal };
  }
  var LIST = [
    { id: "pishuang", name: "砒霜", alias: ["信石", "信砒"], cat: "mineral", group: "white_powder", danger: 3,
      traits: { form: ["白色粉末", "質重細粉"], smell: ["無明顯氣味"], taste: [],
        symptom: ["嘔吐", "腹痛", "米泔樣腹瀉", "手腳抽筋"], onset: "mid" },
      tests: T("白色細粉，拿在手裡比同樣大小的石膏、明礬沉重", "幾乎沒有氣味", "略帶甜味，幾乎嚐不出異樣（嚐有大代價）",
        "只能微溶於水，粉末多半浮在水面或沉在底部", "加熱後升華成白煙", "餵食的鼠類不久便嘔吐、痙攣",
        "銀針變黑（因含硫雜質）"),
      distinguish: "與鉛粉、石膏、明礬、硼砂、芒硝同為白色粉末；砒霜質重、難溶於水、加熱升華成白煙，且是唯一能讓銀針變黑的（因含硫雜質）。",
      remedy: null,
      lore: "古時鼠藥與毒殺案中最惡名昭彰的毒物，溶入飲食後幾乎無色無味，容易混進食物。銀針驗毒的說法就是由它而來，但並非所有毒都能這樣驗出。" },

    { id: "xionghuang", name: "雄黃", alias: ["黃金石", "石黃"], cat: "mineral", group: "red_mineral", danger: 2,
      traits: { form: ["紅色系礦物", "橙紅偏黃", "質脆易碎"], smell: ["加熱有蒜臭"], taste: [],
        symptom: ["腹痛", "嘔吐", "口中蒜臭"], onset: "mid" },
      tests: T("橙紅偏黃的礦塊，有樹脂般光澤，質脆，敲碎後斷面光亮", "平時氣味很淡", null, "不溶於水，粉末沉在水底",
        "加熱冒出白煙，並散出蒜一樣的臭味", "餵食的鼠類腹痛、蜷縮不動"),
      distinguish: "與朱砂、鉛丹同屬紅色系礦物；雄黃橙紅偏黃、質脆成塊，加熱會冒白煙並有蒜臭，朱砂鮮紅沉重、鉛丹則是橘紅色的細粉。",
      remedy: null,
      lore: "端午節民間常以雄黃酒驅蟲避邪，古人也將它用於外治瘡毒。實際上它含砷，不可隨意入口，加熱時尤其危險。" },

    { id: "zhusha", name: "朱砂", alias: ["丹砂", "辰砂"], cat: "mineral", group: "red_mineral", danger: 2,
      traits: { form: ["紅色系礦物", "朱紅色", "質重有光澤"], smell: [], taste: [],
        symptom: ["口中金屬味", "牙齦腫痛", "手抖", "失眠"], onset: "slow" },
      tests: T("鮮豔的朱紅色礦塊或粉末，質地沉重，帶玻璃般光澤", "沒有氣味", null, "不溶於水，水面不會變色",
        "加熱會放出有毒蒸氣", "長期餵食的鼠類手腳發抖、毛髮脫落"),
      distinguish: "與雄黃、鉛丹同屬紅色系礦物；朱砂是鮮豔的朱紅色、質地沉重，加熱會放出有毒蒸氣，雄黃則橙紅偏黃、加熱冒白煙。",
      remedy: null,
      lore: "鮮紅的礦石，古時用作顏料、印泥與符籙，也被煉丹方士視為長生之藥。實際上含汞，長期接觸或吞食會慢慢損害身體。" },

    { id: "shuiyin", name: "水銀", alias: ["汞", "靈液"], cat: "mineral", group: null, danger: 3,
      traits: { form: ["銀白液態金屬", "圓珠滾動"], smell: [], taste: [],
        symptom: ["手抖", "口腔潰爛", "流涎", "牙齦腫痛"], onset: "slow" },
      tests: T("銀白色的液體金屬，碰到就聚成小圓珠滾動，不黏容器", null, null, "比水重，沉在水底，不與水相融",
        "加熱後逐漸消散不見", "長期置於旁邊的鼠類毛髮脫落、手腳發抖"),
      distinguish: null,
      remedy: null,
      lore: "唯一在常溫下呈液態的金屬，秦始皇陵傳說以水銀為江河。古人曾將它用於丹藥與鍍金，但蒸氣與長期接觸都會傷人。" },

    { id: "qiandan", name: "鉛丹", alias: ["黃丹", "丹粉"], cat: "mineral", group: "red_mineral", danger: 2,
      traits: { form: ["紅色系礦物", "橘紅色粉末", "質地細膩"], smell: [], taste: [],
        symptom: ["腹痛", "便秘", "面色蒼白"], onset: "slow" },
      tests: T("橘紅色的細粉末，質重而均勻，沒有礦塊的光澤", "沒有氣味", null, "不溶於水，沉在水底",
        "加熱後顏色變暗，漸轉黃褐", "長期餵食的鼠類消瘦、毛色暗淡"),
      distinguish: "與朱砂、雄黃同屬紅色系礦物；鉛丹是橘紅色細粉，沒有礦塊光澤，加熱只變暗轉黃褐，沒有白煙。",
      remedy: null,
      lore: "古時製膏藥與顏料的原料，也用於外敷。實際上含鉛，長期接觸或誤食會造成腹痛、貧血。" },

    { id: "qianfen", name: "鉛粉", alias: ["胡粉", "鉛白"], cat: "mineral", group: "white_powder", danger: 2,
      traits: { form: ["白色粉末", "質重細膩", "妝粉質地"], smell: ["無明顯氣味"], taste: ["微甜"],
        symptom: ["腹痛", "便秘", "口中金屬味"], onset: "slow" },
      tests: T("雪白細膩的粉，質重，沾在皮膚上很服貼", "沒有氣味", "有淡淡甜味（嚐有代價）", "不溶於水，沉在水底",
        "加熱後顏色改變", "長期餵食的鼠類消瘦、腹痛蜷縮"),
      distinguish: "與砒霜、石膏等同為白色粉末；鉛粉細膩服貼、有甜味，加熱會變色，砒霜則是加熱升華成白煙。",
      remedy: null,
      lore: "古代婦人用來敷面的白粉，也叫胡粉。日久使用會積累鉛毒，使人面色灰暗、腹痛。" },

    { id: "qingfen", name: "輕粉", alias: ["水銀粉", "汞粉"], cat: "mineral", group: null, danger: 3,
      traits: { form: ["雪白輕質結晶粉", "質輕鬆散"], smell: [], taste: [],
        symptom: ["口腔潰爛", "流涎", "牙齦腫痛", "腹瀉"], onset: "mid" },
      tests: T("雪白而質地極輕的結晶粉，比鉛粉輕得多，久見光會漸漸變灰暗", "沒有氣味", null, "幾乎不溶於水", null,
        "餵食的鼠類流口水、口腔潰爛"),
      distinguish: null,
      remedy: null,
      lore: "古時外用於疥癬瘡毒，也被方士當作丹藥原料。屬汞的化合物，吃下去會引起口腔潰爛、流涎。" },

    { id: "danfan", name: "膽礬", alias: ["石膽", "藍礬"], cat: "mineral", group: null, danger: 2,
      traits: { form: ["藍色透明結晶", "不規則塊狀"], smell: [], taste: ["酸澀帶金屬味"],
        symptom: ["嘔吐", "腹痛", "口中金屬味"], onset: "fast" },
      tests: T("鮮豔的深藍色透明結晶塊", "沒有氣味", "又澀又酸，帶著金屬味（嚐有代價）", "溶於水，水變成淡藍色",
        "加熱後藍色褪去，變成白色粉末", "餵食的鼠類立刻嘔吐"),
      distinguish: null,
      remedy: null,
      lore: "藍色的結晶礦物，古時用於催吐與外敷。顏色鮮豔，遇水變藍、受熱褪色，是最容易認出的礦物之一。" },

    { id: "mingfan", name: "明礬", alias: ["白礬", "礬石"], cat: "mineral", group: "white_powder", danger: 1,
      traits: { form: ["白色粉末", "透明結晶塊"], smell: ["無明顯氣味"], taste: ["酸澀"], symptom: [], onset: null },
      tests: T("無色透明或半透明的結晶塊，磨細則是白粉", "沒有氣味", "又酸又澀，舌頭收縮", "易溶於水，溶液帶酸澀",
        "加熱後融化並膨脹成白色多孔的鬆塊", null),
      distinguish: "與砒霜、鉛粉等同為白色粉末；明礬是透明結晶、味酸澀、易溶於水，加熱膨脹成多孔鬆塊；硼砂則是微鹹、加熱成玻璃狀小珠。",
      remedy: null,
      lore: "古時用來淨水、止血與收斂，也常用於染布與外治。性質溫和，但不能當作食物亂吃。" },

    { id: "pengsha", name: "硼砂", alias: ["月石", "蓬砂"], cat: "mineral", group: "white_powder", danger: 1,
      traits: { form: ["白色粉末", "玻璃狀結晶"], smell: ["無明顯氣味"], taste: ["微鹹"], symptom: [], onset: null },
      tests: T("無色或白色的結晶，外形像玻璃碎粒", "沒有氣味", "微鹹，帶一點甘味", "緩慢溶於水",
        "加熱後先鼓脹，再熔成玻璃狀的小珠", null),
      distinguish: "與明礬、芒硝同為白色結晶粉；硼砂味微鹹，加熱先鼓脹再熔成玻璃狀小珠，明礬則是酸澀、膨脹成多孔鬆塊，芒硝加熱化成水。",
      remedy: null,
      lore: "古時用於清熱解毒與外洗口腔，也被匠人當作焊接金屬的助熔劑。但曾有過被拿來添加到食物中的歷史，並不安全。" },

    { id: "mangxiao", name: "芒硝", alias: ["朴硝", "皮硝"], cat: "mineral", group: "white_powder", danger: 1,
      traits: { form: ["白色粉末", "細針狀結晶"], smell: ["無明顯氣味"], taste: ["鹹苦"], symptom: ["腹瀉"], onset: "mid" },
      tests: T("無色至白色的細針狀結晶，容易結塊", "沒有氣味", "又鹹又苦，吃下去有涼感", "極易溶於水，溶解時摸起來變涼",
        "加熱後熔化成水狀", null),
      distinguish: "與明礬、硼砂同為白色結晶粉；芒硝味鹹苦、極易溶於水，且溶解時吸熱變涼，加熱化成水狀，不會膨脹。",
      remedy: null,
      lore: "古時用於通便瀉下與消腫，性寒。吃多了會腹瀉脫水，所以不宜隨便使用。" },

    { id: "shigao", name: "石膏", alias: ["細石", "細理石"], cat: "mineral", group: "white_powder", danger: 0,
      traits: { form: ["白色粉末", "纖維狀石塊", "質軟"], smell: ["無明顯氣味"], taste: [], symptom: [], onset: null },
      tests: T("白色纖維狀的軟石塊，可用指甲刻出痕跡，磨細則是白粉", "沒有氣味", null, "幾乎不溶於水，粉末沉底",
        "加熱後失去水分，變成質地更細的白粉", null),
      distinguish: "與砒霜、鉛粉同為白色粉末；石膏是質軟的纖維狀石塊，幾乎不溶於水、加熱只變得更細，沒有甜味也不升華，毒性幾乎沒有。",
      remedy: null,
      lore: "古人用於清熱瀉火，也在後世被用來製作豆腐的凝固劑與石膏繃帶。性寒，常被用來和砒霜、鉛粉對照，因為外觀相近。" }
  ];
  if (typeof module !== "undefined" && module.exports) module.exports = LIST;
  if (root.PriTestYakushiHerbs && root.PriTestYakushiHerbs.register) root.PriTestYakushiHerbs.register(LIST);
})();
