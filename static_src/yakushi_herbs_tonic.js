// 少女藥師的獨語（yakushi）：補益藥材（18）。文字只寫常識，不寫劑量、提煉、取得方法（§4.5）。
(function () {
  "use strict";
  var root = typeof window !== "undefined" ? window : globalThis;
  // 試藥結果：沒有特別反應的方法填 null。銀針只有砒霜有反應，補益藥一律 null。
  function T(look, smell, taste, water, heat, animal) {
    return { look: look, smell: smell, taste: taste, silver: null, water: water, heat: heat, animal: animal };
  }
  var LIST = [
    { id: "renshen", name: "人參", alias: ["高麗參", "山參"], cat: "tonic", group: "human_root", danger: 0,
      traits: { form: ["肥厚根", "淡黃白色根", "根鬚多", "有蘆頭"], smell: ["微有香氣"], taste: ["苦後回甘"],
        symptom: [], onset: null },
      tests: T("根粗大肥厚，上端有一截帶節的蘆頭，下方鬚根細長繁多", "帶一點特殊的藥香", "先微苦，嚼久回甘", null, null, null),
      distinguish: "與商陸、黨參同為淡色肥厚的根；人參根鬚多、上端有蘆頭，切面沒有同心環紋；黨參根細長帶橫紋，價錢便宜許多，常被拿來冒充。",
      remedy: null,
      lore: "古來被視為最貴重的補氣藥材，價格高昂，所以有許多以黨參、商陸等冒充的騙局。自古也有「山參」與栽培參的分別。" },

    { id: "dangshen", name: "黨參", alias: ["上黨參"], cat: "tonic", group: "human_root", danger: 0,
      traits: { form: ["肥厚根", "淡黃白色根", "根細長帶橫紋"], smell: ["微有香氣"], taste: ["微甜"],
        symptom: [], onset: null },
      tests: T("根呈細長圓柱狀，上端有環狀橫紋，鬚根少", "帶一點淡淡的藥香", "味道偏甜，沒有人參的回甘", null, null, null),
      distinguish: "與人參、商陸同為淡色肥厚的根；黨參根細長、上端有橫紋、鬚根少，價錢遠低於人參；商陸切面才有同心環紋。",
      remedy: null,
      lore: "常見的補氣藥材，性質平和，價錢比人參便宜許多，所以常被不肖商人冒充人參，這是藥材行裡最老的一種騙法。" },

    { id: "huangqi", name: "黃耆", alias: ["黃芪", "北耆"], cat: "tonic", group: null, danger: 0,
      traits: { form: ["長圓柱形根", "斷面纖維性", "黃白色斷面"], smell: ["氣微"], taste: ["微甜"],
        symptom: [], onset: null },
      tests: T("根長圓柱形，外皮淺棕，斷面呈放射狀纖維紋", "氣味很淡", "微微帶甜，有豆腥味", null, null, null),
      distinguish: null, remedy: null,
      lore: "傳統的補氣藥材，常與人參並提。古人也用它來支持久病後的虛弱。" },

    { id: "danggui", name: "當歸", alias: ["秦歸"], cat: "tonic", group: null, danger: 0,
      traits: { form: ["根分枝多", "黃棕色外皮", "斷面黃白"], smell: ["濃烈特殊香氣"], taste: ["微甜", "微苦"],
        symptom: [], onset: null },
      tests: T("根呈分枝狀，外皮黃棕，斷面黃白、有油性光澤", "香氣濃烈而特殊", "先甜後帶辛苦", null, null, null),
      distinguish: null, remedy: null,
      lore: "婦科常用的藥材，名字取「當歸」的含義，古詩文裡常見。女子調養的方子裡經常出現它。" },

    { id: "shudihuang", name: "熟地黃", alias: ["熟地"], cat: "tonic", group: null, danger: 0,
      traits: { form: ["黑色黏軟塊", "表面油潤光亮"], smell: ["氣微"], taste: ["微甜"],
        symptom: [], onset: null },
      tests: T("烏黑油亮的不規則塊，質軟黏手", "氣味很淡", "味甜而稍黏", null, null, null),
      distinguish: null, remedy: null,
      lore: "生地黃經過反覆蒸曬而成，顏色烏黑。傳統上用來補血養陰，是許多補益方子的底藥。" },

    { id: "gouqizi", name: "枸杞子", alias: ["枸杞", "紅耳墜"], cat: "tonic", group: null, danger: 0,
      traits: { form: ["紅色小漿果", "紡錘形果實", "表面皺縮"], smell: ["氣微"], taste: ["微甜"],
        symptom: [], onset: null },
      tests: T("鮮紅略皺的小果，兩端稍尖，內有細小種子", "氣味很淡", "微甜，帶一點酸", "泡水後水色轉成淡橙黃", null, null),
      distinguish: null, remedy: null,
      lore: "寧夏一帶最有名的紅色小果，常泡水或燉湯。古人說它能明目，是日常養生的食材。" },

    { id: "lurong", name: "鹿茸", alias: ["花鹿茸"], cat: "tonic", group: null, danger: 0,
      traits: { form: ["帶茸毛的幼角", "密生細絨毛", "分叉角"], smell: ["微腥"], taste: [],
        symptom: [], onset: null },
      tests: T("尚未骨化的幼角，表面密生柔軟的短絨毛，切面有蜂窩狀細孔", "略帶腥氣", null, null, null, null),
      distinguish: null, remedy: null,
      lore: "雄鹿每年新生、尚未骨化的幼角，價格昂貴，古人視為溫補的珍品。" },

    { id: "ejiao", name: "阿膠", alias: ["驢皮膠"], cat: "tonic", group: null, danger: 0,
      traits: { form: ["琥珀色硬塊", "質脆有光澤", "斷面光亮"], smell: ["氣微"], taste: ["微甜"],
        symptom: [], onset: null },
      tests: T("琥珀色或深褐色的硬塊，敲碎斷面有玻璃樣光澤", "氣味很淡", "味甘，略帶皮膠味", "放入熱水中慢慢化開", null, null),
      distinguish: null, remedy: null,
      lore: "傳統用驢皮熬成的膠塊，出自山東東阿，古代是宮廷貴婦愛用的滋補品。" },

    { id: "baizhu", name: "白朮", alias: ["冬朮", "於朮"], cat: "tonic", group: null, danger: 0,
      traits: { form: ["不規則拳狀根莖", "黃白色斷面", "表面灰黃"], smell: ["微有香氣"], taste: ["微苦"],
        symptom: [], onset: null },
      tests: T("根莖呈拳頭狀的不規則塊，切面黃白、有細小油點", "有淡淡的藥香", "微苦帶甘", null, null, null),
      distinguish: null, remedy: null,
      lore: "傳統用來健脾的藥材，與茯苓、甘草並稱，是調理脾胃方子裡的常客。" },

    { id: "fuling", name: "茯苓", alias: ["雲苓", "白茯苓"], cat: "tonic", group: null, danger: 0,
      traits: { form: ["球形菌核", "外皮黑褐", "內部白色粉質"], smell: ["氣微"], taste: [],
        symptom: [], onset: null },
      tests: T("球形或不規則塊，外皮粗糙黑褐，內部雪白而質鬆", "幾乎沒有氣味", "味淡，嚼之黏牙", null, null, null),
      distinguish: null, remedy: null,
      lore: "寄生在松樹根旁的菌核，古人用它健脾利水，也做成點心「茯苓餅」。" },

    { id: "shanyao", name: "山藥", alias: ["淮山", "薯蕷"], cat: "tonic", group: null, danger: 0,
      traits: { form: ["長圓柱形根莖", "白色粉質", "表面有鬚根痕"], smell: ["氣微"], taste: [],
        symptom: [], onset: null },
      tests: T("長條圓柱形，去皮後潔白，質地粉實", "氣味很淡", "味淡微黏", null, null, null),
      distinguish: null, remedy: null,
      lore: "日常食材兼藥材，原名「薯蕷」，古人說它補脾胃，煮粥燉湯都常見。" },

    { id: "dazao", name: "大棗", alias: ["紅棗", "乾棗"], cat: "tonic", group: null, danger: 0,
      traits: { form: ["紅褐色橢圓果實", "表面皺縮", "內有硬核"], smell: ["氣微"], taste: ["微甜"],
        symptom: [], onset: null },
      tests: T("暗紅褐色的橢圓果，皮皺而有光澤，果肉柔軟，中有硬核", "有淡淡的棗香", "味甜", null, null, null),
      distinguish: null, remedy: null,
      lore: "日常食用的甜果，煮湯、熬粥都常放。傳統方子裡常用它來調和藥性。" },

    { id: "heshouwu", name: "何首烏", alias: ["首烏"], cat: "tonic", group: null, danger: 1,
      traits: { form: ["紅褐色塊根", "表面凹凸不平", "斷面有雲錦花紋"], smell: ["氣微"], taste: ["微苦"],
        symptom: ["腹瀉", "噁心"], onset: "mid" },
      tests: T("紅褐色的不規則塊根，橫切面可見雲朵狀花紋", "氣味很淡", "微苦而澀", null, null, "餵食生品的小動物出現腹瀉"),
      distinguish: null, remedy: null,
      lore: "民間傳說吃了能烏髮長生，真假故事很多。生品與炮製品用法不同，生用容易腹瀉，並不是可以隨意進補的藥。" },

    { id: "dongchongxiacao", name: "冬蟲夏草", alias: ["蟲草"], cat: "tonic", group: null, danger: 0,
      traits: { form: ["蟲體連草莖", "金黃色蟲體", "頂端有棒狀子座"], smell: ["微腥"], taste: [],
        symptom: [], onset: null },
      tests: T("蠶形蟲體帶著一根細長的草莖，蟲體表面有環紋與足", "略帶腥氣", null, null, null, null),
      distinguish: null, remedy: null,
      lore: "寄生在蟲體上的真菌，產於高山，價格極高，常見仿冒品。古人視為稀有的補品。" },

    { id: "rougui", name: "肉桂", alias: ["桂皮", "玉桂"], cat: "tonic", group: null, danger: 0,
      traits: { form: ["捲筒狀樹皮", "紅棕色", "斷面有油層"], smell: ["濃烈特殊香氣"], taste: ["微甜", "辛辣"],
        symptom: [], onset: null },
      tests: T("捲成筒狀或片狀的樹皮，外表紅棕，斷面可見一層油潤", "香氣濃烈甜熱", "先甜後辛", null, null, null),
      distinguish: null, remedy: null,
      lore: "既是香料，也是傳統的溫熱藥材，常用於暖身。宮裡熏衣、點心也常用到。" },

    { id: "duzhong", name: "杜仲", alias: ["思仙", "絲棉皮"], cat: "tonic", group: null, danger: 0,
      traits: { form: ["板片狀樹皮", "折斷有銀白細絲", "內面暗紫色"], smell: ["氣微"], taste: ["微苦"],
        symptom: [], onset: null },
      tests: T("扁平的樹皮板，折斷時可見許多銀白細絲牽連不斷", "氣味很淡", "味微苦", null, null, null),
      distinguish: null, remedy: null,
      lore: "樹皮折斷會牽出細絲，一眼可認。傳統用來補益腰膝。" },

    { id: "suanzaoren", name: "酸棗仁", alias: ["棗仁"], cat: "tonic", group: null, danger: 0,
      traits: { form: ["扁圓形種子", "紫紅色", "表面光滑"], smell: ["氣微"], taste: ["微甜"],
        symptom: [], onset: null },
      tests: T("紫紅色的小扁圓種子，一面隆起、一面平，表面光亮", "氣味很淡", "味淡，略帶油潤", null, null, null),
      distinguish: null, remedy: null,
      lore: "酸棗樹的種子，傳統上用來安神、幫助睡眠，是宮廷夜裡常備的藥材之一。" },

    { id: "lingzhi", name: "靈芝", alias: ["赤芝", "仙草"], cat: "tonic", group: null, danger: 0,
      traits: { form: ["傘形菌蓋", "質地木質堅硬", "表面漆樣光澤"], smell: ["氣微"], taste: ["微苦"],
        symptom: [], onset: null },
      tests: T("紅褐色的半圓或腎形菌蓋，表面光亮如上了漆，有同心環紋", "氣味很淡", "味微苦", null, null, null),
      distinguish: null, remedy: null,
      lore: "傳說中的仙草，古人視為祥瑞，常入畫、入詩。實際上是一種堅硬如木的菌類。" }
  ];
  if (typeof module !== "undefined" && module.exports) module.exports = LIST;
  if (root.PriTestYakushiHerbs && root.PriTestYakushiHerbs.register) root.PriTestYakushiHerbs.register(LIST);
})();
