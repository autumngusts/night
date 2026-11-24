// 少女藥師的獨語（yakushi）：動物藥・動物毒（14）。文字只寫常識，不寫劑量、提煉、取得方法（§4.5）。
(function () {
  "use strict";
  var root = typeof window !== "undefined" ? window : globalThis;
  // 試藥結果：沒有特別反應的方法填 null。銀針一律 null（只有砒霜有反應，§4.4）。
  function T(look, smell, taste, water, heat, animal) {
    return { look: look, smell: smell, taste: taste, silver: null, water: water, heat: heat, animal: animal };
  }
  var LIST = [
    { id: "banmao", name: "斑蝥", alias: ["斑蚝", "花斑蝥"], cat: "animal", group: null, danger: 3,
      traits: { form: ["黑色甲蟲", "翅鞘黃褐橫紋", "體型細長"], smell: ["刺鼻腥臭"], taste: [],
        symptom: ["皮膚起水泡", "排尿疼痛", "口腔灼痛", "血尿"], onset: "mid" },
      tests: T("黑色細長的甲蟲，翅鞘上有黃褐色的橫紋", "有刺鼻的腥臭味", null, null, null, "接觸過的牲畜皮膚起水泡"),
      distinguish: null,
      remedy: null,
      lore: "芫菁科的甲蟲，體內含有會讓皮膚起水泡的刺激物。古人用於外治，也傳說被用來下毒，中毒者排尿時會劇痛。" },

    { id: "chansu", name: "蟾酥", alias: ["蟾蜍漿"], cat: "animal", group: "numb_poison", danger: 3,
      traits: { form: ["動物性毒物", "暗褐色團塊", "質硬而脆"], smell: ["微腥"], taste: ["麻舌"],
        symptom: ["口唇發麻", "心悸", "心律紊亂", "噁心"], onset: "fast" },
      tests: T("乾燥後呈暗褐色的扁團塊，質硬，斷面光亮", "微腥", "舌頭立刻發麻，麻到整個口腔（嚐有代價）", null, null,
        "狗舔到後流涎、心跳紊亂"),
      distinguish: "與河豚同樣造成口唇麻痺；蟾酥是蟾蜍分泌物乾燥成的暗褐色團塊，並會造成心悸與心律紊亂，河豚則是呼吸肌麻痺、手腳無力。",
      remedy: null,
      lore: "蟾蜍皮膚與耳後腺的分泌物乾燥而成，古時用於止痛、強心，也用作外敷。毒性強，誤食會讓心跳失常。" },

    { id: "wugong", name: "蜈蚣", alias: ["百足", "天龍"], cat: "animal", group: null, danger: 2,
      traits: { form: ["多足節肢動物", "紅頭黑褐身", "身體扁長"], smell: ["微腥"], taste: [],
        symptom: ["傷口紅腫劇痛", "發熱"], onset: "fast" },
      tests: T("身體扁長，分成許多節，每節一對足，頭部偏紅", "微腥", null, null, null, "被咬到的小動物傷口紅腫"),
      distinguish: null,
      remedy: null,
      lore: "古人認為能熄風止痙，所以用乾燥的蜈蚣入藥。活蜈蚣咬人會紅腫劇痛，民間稱為五毒之一。" },

    { id: "quanxie", name: "全蠍", alias: ["全蟲", "蠍子"], cat: "animal", group: null, danger: 2,
      traits: { form: ["節肢動物", "尾端帶鉤", "兩隻大螯"], smell: ["微腥"], taste: ["微鹹"],
        symptom: ["刺傷處劇痛", "麻木", "流涎"], onset: "fast" },
      tests: T("身體分成頭胸與腹部，尾巴向上彎、尾端有一根毒鉤，前面有兩隻螯", "微腥", "味微鹹", null, null,
        "被螫到的小動物痙攣"),
      distinguish: null,
      remedy: null,
      lore: "古時用於熄風止痙與攻毒散結，也是民間五毒之一。被螫處會劇痛麻木，體型小者危險性較低。" },

    { id: "hetun", name: "河豚", alias: ["鯸鮧", "吹肚魚"], cat: "animal", group: "numb_poison", danger: 3,
      traits: { form: ["動物性毒物", "鼓脹圓身魚", "皮有小刺"], smell: [], taste: [],
        symptom: ["口唇發麻", "手腳麻痺", "呼吸困難", "嘔吐"], onset: "fast" },
      tests: T("魚身短圓，受驚會鼓脹成球，皮上有細小的刺", null, "嚐到的鮮美，卻有輕微麻意（嚐有代價）", null, null,
        "貓吃了內臟後四肢癱軟"),
      distinguish: "與蟾酥同樣造成口唇麻痺；河豚是魚，中毒時會手腳麻痺、呼吸困難、神智卻清楚，不像蟾酥會有心悸與心律紊亂。",
      remedy: null,
      lore: "味道鮮美卻劇毒的魚，肝臟、卵巢等內臟含毒最多。「拼死吃河豚」的說法就是從這裡來的。" },

    { id: "shexiang", name: "麝香", alias: ["寸香", "香獐臍"], cat: "animal", group: null, danger: 1,
      traits: { form: ["深褐色顆粒", "帶膜香囊"], smell: ["濃烈特殊香氣"], taste: ["微苦"],
        symptom: ["眩暈"], onset: "mid" },
      tests: T("深褐色顆粒，微潤，外面常包著薄膜", "香氣濃烈而穿透力強，久久不散", "微苦", null, null, null),
      distinguish: null,
      remedy: null,
      lore: "麝的香囊分泌物，氣味濃烈。古人用於開竅醒神、辟穢，也是名貴的香料。傳統上認為孕婦不宜接觸。" },

    { id: "niuhuang", name: "牛黃", alias: ["丑寶"], cat: "animal", group: null, danger: 0,
      traits: { form: ["黃色層狀結石", "表面光滑", "斷面有層紋"], smell: ["清香"], taste: ["苦後回甘"],
        symptom: [], onset: null },
      tests: T("黃色近球形的結石，剖開有一層一層的紋路", "有清香", "先苦後甘，涼涼的", "放入水中會慢慢染黃", null, null),
      distinguish: null,
      remedy: null,
      lore: "牛的膽囊中偶爾生成的結石，極為珍貴。古人用於清熱解毒、開竅，常出現在名貴成藥中。" },

    { id: "shuizhi", name: "水蛭", alias: ["螞蟥", "螞蝗"], cat: "animal", group: null, danger: 1,
      traits: { form: ["扁長環節動物", "黑褐色身體", "兩端有吸盤"], smell: [], taste: [],
        symptom: ["傷口難止血"], onset: "mid" },
      tests: T("身體扁長，有許多環節，兩端各有吸盤，乾燥後黑褐而脆", null, null, null, null, "被吸附的小動物傷口血流不止"),
      distinguish: null,
      remedy: null,
      lore: "生活在水田與池沼，會吸附動物吸血。古人用乾燥的水蛭入藥，用於破血化瘀。被吸之處因為分泌物會讓血不易凝固。" },

    { id: "qishe", name: "蘄蛇", alias: ["白花蛇", "五步蛇"], cat: "animal", group: null, danger: 1,
      traits: { form: ["盤成圓盤的乾燥蛇", "背部方形斑紋", "頭呈三角形"], smell: ["微腥"], taste: [],
        symptom: [], onset: null },
      tests: T("乾燥後蛇身盤成圓盤狀，背面有一塊塊方形斑紋，頭呈三角形", "微腥", null, null, null, null),
      distinguish: null,
      remedy: null,
      lore: "古時以蘄州所產的乾燥蛇入藥，用於祛風通絡。活蛇有劇毒，但乾燥入藥的蛇毒性已大為降低。" },

    { id: "zhenzhu", name: "珍珠", alias: ["真珠", "蚌珠"], cat: "animal", group: null, danger: 0,
      traits: { form: ["白色圓珠", "表面有光澤"], smell: [], taste: [], symptom: [], onset: null },
      tests: T("近圓形的小珠，表面有柔和的虹彩光澤，切開有一層層的紋路", null, null, null, null, null),
      distinguish: null,
      remedy: null,
      lore: "蚌類體內形成的圓珠，古人用於安神定驚，也用於養顏，是常見的珍貴飾品與藥材。" },

    { id: "guijia", name: "龜甲", alias: ["龜板", "烏龜殼"], cat: "animal", group: null, danger: 0,
      traits: { form: ["龜的背甲與腹甲", "表面有盾片紋", "質堅硬"], smell: ["微腥"], taste: [],
        symptom: [], onset: null },
      tests: T("淡黃褐色的堅硬甲片，表面有一塊塊盾片的紋路", "微腥", null, null, null, null),
      distinguish: null,
      remedy: null,
      lore: "古代占卜的龜甲就是這類材料。入藥用於滋陰潛陽，是傳統中醫常見的補益材料之一。" },

    { id: "jiangcan", name: "僵蠶", alias: ["白僵蠶"], cat: "animal", group: null, danger: 0,
      traits: { form: ["乾硬的蠶體", "表面覆白色粉", "略彎曲"], smell: ["微腥"], taste: ["微鹹"],
        symptom: [], onset: null },
      tests: T("蠶體僵直而硬，略彎，表面覆著一層白色粉狀物", "微腥", "味微鹹", null, null, null),
      distinguish: null,
      remedy: null,
      lore: "蠶感染白僵菌死亡後，身體變得僵硬，表面長出白色粉末，古人用它來熄風止痙、化痰。" },

    { id: "chantui", name: "蟬蛻", alias: ["蟬衣", "蟬殼"], cat: "animal", group: null, danger: 0,
      traits: { form: ["蟬羽化後的空殼", "半透明淡黃", "質輕"], smell: [], taste: [], symptom: [], onset: null },
      tests: T("蟬脫下的空殼，淡黃褐色、半透明，輕得幾乎沒有分量", null, null, null, null, null),
      distinguish: null,
      remedy: null,
      lore: "蟬羽化時脫下的殼，古人用於疏散風熱、退翳，是外形最容易辨認的動物藥之一。" },

    { id: "xiongdan", name: "熊膽", alias: ["熊膽粉"], cat: "animal", group: null, danger: 0,
      traits: { form: ["黃綠或黑褐色膽汁乾品", "質脆有光澤"], smell: ["微腥"], taste: ["極苦"],
        symptom: [], onset: null },
      tests: T("乾燥後呈黃綠或黑褐色，質脆，斷面有玻璃般光澤", "微腥", "苦味極重，卻有淡淡回甘", "放入水中會慢慢旋成一縷金黃線",
        null, null),
      distinguish: null,
      remedy: null,
      lore: "古時視為清熱、明目的貴重藥材，苦味極重。後世因為保育理由而不再鼓勵使用，常以其他材料取代。" }
  ];
  if (typeof module !== "undefined" && module.exports) module.exports = LIST;
  if (root.PriTestYakushiHerbs && root.PriTestYakushiHerbs.register) root.PriTestYakushiHerbs.register(LIST);
})();
