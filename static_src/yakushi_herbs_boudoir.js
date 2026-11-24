// 少女藥師的獨語（yakushi）：香料、妝品、食材（16）。文字只寫常識，不寫劑量、提煉、取得方法（§4.5）。
(function () {
  "use strict";
  var root = typeof window !== "undefined" ? window : globalThis;
  // 試藥結果：沒有特別反應的方法填 null。銀針只有砒霜有反應，這類一律 null。
  function T(look, smell, taste, water, heat, animal) {
    return { look: look, smell: smell, taste: taste, silver: null, water: water, heat: heat, animal: animal };
  }
  var LIST = [
    { id: "honghua", name: "紅花", alias: ["紅藍花", "草紅花"], cat: "boudoir", group: "red_flower", danger: 1,
      traits: { form: ["紅色花絲", "染色用紅花", "橙紅管狀花"], smell: ["微有香氣"], taste: ["微苦"],
        symptom: ["腹痛"], onset: "mid" },
      tests: T("細長管狀小花，成團", "有淡淡的花香", "味微苦", "水染成金黃，花不褪色", null, null),
      distinguish: "與番紅花、胭脂同屬染紅的材料；紅花是成團的細長管狀小花，泡水後水染成金黃、花不褪色；番紅花有喇叭狀柱頭，入水可見一道橙黃細線從柱頭直直往下沉、再慢慢把水染黃；胭脂是膏狀。",
      remedy: null,
      lore: "草本植物的花，古時用來染布、做胭脂，也入藥活血。孕婦忌用，是傳統公認的禁忌。價格比番紅花低許多，常被拿來冒充番紅花。" },

    { id: "fanhonghua", name: "番紅花", alias: ["藏紅花", "西紅花"], cat: "boudoir", group: "red_flower", danger: 1,
      traits: { form: ["紅色花絲", "染色用紅花", "花柱細長"], smell: ["濃烈特殊香氣"], taste: ["微苦"],
        symptom: ["噁心", "眩暈"], onset: "mid" },
      tests: T("細長的暗紅柱頭，頂端呈喇叭狀，絲絲分明", "香氣濃烈而特殊", "味微苦", "可見一道橙黃細線從柱頭直直往下沉，再慢慢把水染黃", null, null),
      distinguish: "與紅花、胭脂同屬染紅的材料；番紅花有喇叭狀柱頭，入水可見一道橙黃細線從柱頭直直往下沉、再慢慢把水染黃；紅花是成團的細長管狀小花，泡水後水染成金黃、花不褪色；胭脂是膏狀。",
      remedy: null,
      lore: "採自一種秋季開花的小花的花柱，數量稀少，所以價格昂貴，常被用紅花等冒充。孕婦同樣要避免。" },

    { id: "yanzhi", name: "胭脂", alias: ["燕支", "紅藍膏"], cat: "boudoir", group: "red_flower", danger: 0,
      traits: { form: ["染色用紅花", "膏狀紅色", "質地細膩"], smell: ["無明顯氣味"], taste: [],
        symptom: [], onset: null },
      tests: T("鮮紅或深紅的細膩膏狀物，常盛在小盒或小碟裡", "氣味很淡，略帶花香與油脂味", null, "遇水化開成紅色", null, null),
      distinguish: "與紅花、番紅花同屬染紅的材料；胭脂是紅花等加工成的膏狀妝品，已看不出花絲形狀，遇水化成紅色。",
      remedy: null,
      lore: "古代女子點唇、暈頰的妝品，由紅花等染料加工而成，以匈奴的燕支山命名。是閨房裡最普通的物件，但也可能被人動手腳。" },

    { id: "baizhi", name: "白芷", alias: ["香白芷", "川白芷"], cat: "boudoir", group: null, danger: 0,
      traits: { form: ["圓錐形粗根", "外皮灰棕", "白色粉質"], smell: ["濃烈特殊香氣"], taste: ["微苦"],
        symptom: [], onset: null },
      tests: T("圓錐形的粗根，外皮灰棕，切面白色粉質、帶小油點", "香氣濃烈而獨特", "味微辛而苦", null, null, null),
      distinguish: null, remedy: null,
      lore: "自古就是女子護膚的材料，古方裡常見用來調面脂。傳統上也用於散寒止痛。" },

    { id: "huajiao", name: "花椒", alias: ["川椒", "蜀椒"], cat: "boudoir", group: null, danger: 0,
      traits: { form: ["紅褐色圓粒果皮", "表面疣狀突起", "開口裂瓣"], smell: ["濃烈特殊香氣"], taste: ["舌尖微麻"],
        symptom: [], onset: null },
      tests: T("紅褐色的小圓粒，果皮表面有許多小疣點，多裂成兩瓣", "香氣濃烈", "先麻後辛，舌尖微微發麻", null, null, null),
      distinguish: null, remedy: null,
      lore: "廚房的香料，也是古代傳統的香材。古人用椒塗牆，希望室內溫暖芳香，稱為「椒房」。" },

    { id: "kuxingren", name: "苦杏仁", alias: ["北杏", "杏核仁"], cat: "boudoir", group: "almond", danger: 2,
      traits: { form: ["杏仁核仁", "扁卵形果仁"], smell: ["苦杏仁味"], taste: ["極苦"],
        symptom: ["眩暈", "噁心", "呼吸困難"], onset: "fast" },
      tests: T("扁卵形的果仁，一端尖、一端圓，外覆淺棕色薄皮", "搗碎後加水，會散出明顯的苦杏仁氣味", "極苦，苦味強烈而不散（嚐有代價）",
        null, null, "餵食大量生品的小動物很快出現呼吸急促"),
      distinguish: "與甜杏仁外形幾乎相同；苦杏仁極苦，搗碎加水後有明顯的苦杏仁氣味，生吃過量會中毒；甜杏仁味微甜、沒有毒。",
      remedy: null,
      lore: "杏的種子，傳統用於止咳平喘，但生品有毒，必須經過處理才能入藥。與甜杏仁外形相近，所以古人特別強調要先嚐出苦與甜。" },

    { id: "tianxingren", name: "甜杏仁", alias: ["南杏"], cat: "boudoir", group: "almond", danger: 0,
      traits: { form: ["杏仁核仁", "扁卵形果仁"], smell: ["無明顯氣味"], taste: ["微甜"],
        symptom: [], onset: null },
      tests: T("扁卵形的果仁，形狀與苦杏仁相近，但常略大而飽滿", "搗碎加水後幾乎沒有氣味", "味微甜，帶一點油香", null, null, "餵食的小動物沒有任何異狀"),
      distinguish: "與苦杏仁外形幾乎相同；甜杏仁味微甜、搗碎加水後沒有特殊氣味；苦杏仁極苦，搗碎加水後有明顯的苦杏仁氣味。",
      remedy: null,
      lore: "杏仁的甜味品種，常用來做點心、杏仁茶，也用於潤肺。與苦杏仁極像，混賣的事情時有所聞。" },

    { id: "bohe", name: "薄荷", alias: ["蕃荷菜", "銀丹草"], cat: "boudoir", group: null, danger: 0,
      traits: { form: ["方形莖", "葉對生", "唇形花"], smell: ["清涼香氣"], taste: ["清涼感"],
        symptom: [], onset: null },
      tests: T("莖呈方形，葉對生、邊緣有細鋸齒，花淡紫成輪", "揉搓後有明顯的清涼香氣", "入口清涼", null, null, null),
      distinguish: null, remedy: null,
      lore: "常見的香草，夏天用來泡茶、做點心，也被用於清涼香氣的妝品與熏香。" },

    { id: "chenxiang", name: "沉香", alias: ["沉水香", "伽楠"], cat: "boudoir", group: "fragrant_wood", danger: 0,
      traits: { form: ["香木塊", "深褐色木塊", "黑褐色油脂紋", "入水下沉"], smell: ["濃烈特殊香氣"], taste: [],
        symptom: [], onset: null },
      tests: T("深褐色的木塊，有黑褐色的油脂斑紋，質地緻密沉重", "香氣深沉濃郁，點燃時香味有變化", null, "放入水中會沉到水底", null, null),
      distinguish: "與檀香同屬香木；沉香色深、質重、入水下沉、點燃時香氣有變化；檀香質較輕、入水浮起、氣味偏甜潤。常有人用檀香冒充沉香。",
      remedy: null,
      lore: "樹木受傷後凝結油脂而成的香木，因為入水下沉而稱「沉香」，是宮廷最貴重的香料之一。市面上常見以其他木材冒充的假貨。" },

    { id: "tanxiang", name: "檀香", alias: ["白檀", "旃檀"], cat: "boudoir", group: "fragrant_wood", danger: 0,
      traits: { form: ["香木塊", "淡黃褐色木塊", "黃褐色細緻木紋", "入水浮起"], smell: ["氣味甜潤"], taste: [],
        symptom: [], onset: null },
      tests: T("淡黃褐色的木塊，木紋細緻，質地比沉香輕", "香氣甜潤持久", null, "放入水中會浮在水面", null, null),
      distinguish: "與沉香同屬香木；檀香色淺、質較輕、入水浮起、氣味偏甜潤；沉香質重、入水下沉、點燃時香氣有變化。若有人拿檀香當沉香賣，一泡水就能識破。",
      remedy: null,
      lore: "古來用於寺廟、佛事與熏香，也用來做扇骨、念珠。香氣溫潤持久，價格比沉香低，是最常見的冒充來源之一。" },

    { id: "dingxiang", name: "丁香", alias: ["公丁香"], cat: "boudoir", group: null, danger: 0,
      traits: { form: ["釘形乾燥花蕾", "紅棕色", "頂端有四片萼"], smell: ["濃烈特殊香氣"], taste: ["辛辣"],
        symptom: [], onset: null },
      tests: T("形如小釘的乾燥花蕾，頂端像個小圓球，下面是細長柄，紅棕色", "香氣濃烈而辛", "辛辣而帶麻", null, null, null),
      distinguish: null, remedy: null,
      lore: "古人用它含在口中，讓口氣芬芳。也用於香囊、料理與傳統溫中的藥材。" },

    { id: "molihua", name: "茉莉花", alias: ["茉莉", "香魂"], cat: "boudoir", group: null, danger: 0,
      traits: { form: ["白色小花", "乾燥花蕾", "花瓣緊裹"], smell: ["清香"], taste: ["微苦"],
        symptom: [], onset: null },
      tests: T("乾燥後呈米黃色的小花蕾，花瓣緊緊包裹，枯而不碎", "有清雅的花香", "味微苦", null, null, null),
      distinguish: null, remedy: null,
      lore: "傳統用來窨茶，做成香片，也是女子髮間常插的香花。香氣清淡持久。" },

    { id: "taoren", name: "桃仁", alias: ["桃核仁", "桃葉"], cat: "boudoir", group: "pink_leaf", danger: 1,
      traits: { form: ["披針形長葉", "粉紅花", "葉互生", "葉緣細鋸齒"], smell: ["無明顯氣味"], taste: ["微苦"],
        symptom: ["噁心", "眩暈"], onset: "mid" },
      tests: T("桃樹的葉窄長，互生排列、邊緣有細鋸齒，花粉紅色", null, "桃仁味微苦", null, null, null),
      distinguish: "與夾竹桃都是窄長葉、開粉紅花；桃葉互生、葉緣有細鋸齒，夾竹桃葉革質、三葉輪生、葉緣平滑。",
      remedy: null,
      lore: "桃的種子「桃仁」是傳統的活血藥材，生品略有毒性，過量會頭暈噁心。桃樹的葉形與花色常被拿來和夾竹桃比較，兩者混淆的故事時有所聞。" },

    { id: "aiye", name: "艾葉", alias: ["艾草", "蘄艾"], cat: "boudoir", group: null, danger: 0,
      traits: { form: ["羽狀深裂葉", "背面灰白絨毛", "上面深綠"], smell: ["濃烈特殊香氣"], taste: ["微苦"],
        symptom: [], onset: null },
      tests: T("葉片羽狀深裂，上面深綠、下面密生灰白細絨毛", "香氣濃烈，揉搓後更明顯", "味微苦", null, null, null),
      distinguish: null, remedy: null,
      lore: "端午節掛在門口的香草，傳統用來熏灸、驅蟲。曬乾搗成的艾絨是灸法常用的材料。" },

    { id: "fengmi", name: "蜂蜜", alias: ["石蜜", "蜜"], cat: "boudoir", group: "mad_honey", danger: 0,
      traits: { form: ["蜜源花叢", "黏稠蜜漿", "淡黃至琥珀色"], smell: ["花有淡淡氣味"], taste: ["微甜"],
        symptom: [], onset: null },
      tests: T("淡黃至琥珀色的黏稠液體，看不出哪種花的蜜；要看產地與蜂箱周遭開的是什麼花", "有淡淡的花香", "味甜", null, null, null),
      distinguish: "與羊躑躅（採自它的蜜有毒）從外觀無法分辨；要看蜂蜜的產地與蜂箱周遭盛開的花種，若附近大片開著黃色杜鵑，就要小心。",
      remedy: null,
      lore: "日常食用的甜品，也是古代的重要調味與藥引。多數蜂蜜是安全的，但若蜜蜂大量採食有毒的花，採得的蜜也會有毒，這類故事在山區時有所聞。" },

    { id: "qincai", name: "芹菜", alias: ["旱芹", "藥芹"], cat: "boudoir", group: "umbel", danger: 0,
      traits: { form: ["傘形花序", "白色小花", "羽狀複葉"], smell: ["清香"], taste: ["微苦"],
        symptom: [], onset: null },
      tests: T("莖有縱稜，葉為羽狀複葉，夏天開白色小花、排成傘狀", "有明顯的芹菜香", "味微苦", null, null, "餵食的雞沒有任何異狀"),
      distinguish: "與毒芹同是白色小花排成傘形；芹菜有清香、根莖沒有橫隔空腔；毒芹的根莖剖開有橫隔空腔，切口流出淡黃色汁液。",
      remedy: null,
      lore: "日常的蔬菜，莖葉都有獨特的清香。野外與毒芹外形極為相似，採摘野芹要特別小心，是老一輩常見的叮嚀。" }
  ];
  if (typeof module !== "undefined" && module.exports) module.exports = LIST;
  if (root.PriTestYakushiHerbs && root.PriTestYakushiHerbs.register) root.PriTestYakushiHerbs.register(LIST);
})();
