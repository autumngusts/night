// 少女藥師的獨語（yakushi）：清熱解表藥材（18）。文字只寫常識，不寫劑量、提煉、取得方法（§4.5）。
(function () {
  "use strict";
  var root = typeof window !== "undefined" ? window : globalThis;
  // 試藥結果：沒有特別反應的方法填 null。銀針只有砒霜有反應，這類一律 null。
  function T(look, smell, taste, water, heat, animal) {
    return { look: look, smell: smell, taste: taste, silver: null, water: water, heat: heat, animal: animal };
  }
  var LIST = [
    { id: "gancao", name: "甘草", alias: ["國老", "粉草"], cat: "clear", group: null, danger: 0,
      traits: { form: ["圓柱形根", "紅棕色外皮", "斷面黃色"], smell: ["無明顯氣味"], taste: ["微甜"],
        symptom: [], onset: null },
      tests: T("圓柱形的長根，外皮紅棕、有縱皺紋，斷面黃色而有纖維", "氣味很淡", "味甜而特殊，後味持久", null, null, null),
      distinguish: null, remedy: null,
      lore: "傳統上最常出現在方子裡的藥材，有「國老」之稱，意思是能調和眾藥。古人也拿它來緩和藥性、潤喉。" },

    { id: "jinyinhua", name: "金銀花", alias: ["忍冬", "雙花"], cat: "clear", group: "yellow_vine", danger: 0,
      traits: { form: ["藤本", "黃花", "花成對", "黃白兩色花"], smell: ["清香"], taste: ["微苦"],
        symptom: [], onset: null },
      tests: T("花成對生在葉腋，初開為白、漸轉黃，所以同株同時有黃白兩色", "有清淡的花香", "味微苦帶涼", null, null, "餵食的雞沒有任何異狀"),
      distinguish: "與鉤吻同為黃花藤本；金銀花花成對、黃白兩色並有清香，鉤吻無香、花冠漏斗狀、多朵聚生。",
      remedy: null,
      lore: "忍冬的花，初開白色、後轉黃色，所以叫金銀花。傳統用來清熱，夏天常泡成花茶。外形與劇毒的鉤吻相近，採摘時必須分清。" },

    { id: "huanglian", name: "黃連", alias: ["味連", "雲連"], cat: "clear", group: null, danger: 0,
      traits: { form: ["根莖串珠狀", "斷面金黃", "外皮黃褐"], smell: ["無明顯氣味"], taste: ["極苦"],
        symptom: [], onset: null },
      tests: T("根莖彎曲成串珠狀，外皮黃褐，斷面金黃", "氣味很淡", "苦得非常濃烈，久久不散", "泡水後水色轉成黃色", null, null),
      distinguish: null, remedy: null,
      lore: "苦味很重的根莖，所以有「啞巴吃黃連，有苦說不出」的俗語。傳統用來清熱。" },

    { id: "huangqin", name: "黃芩", alias: ["山茶根"], cat: "clear", group: null, danger: 0,
      traits: { form: ["圓錐形根", "斷面黃色", "老根中空"], smell: ["無明顯氣味"], taste: ["微苦"],
        symptom: [], onset: null },
      tests: T("圓錐形的粗根，外皮黃褐，斷面鮮黃，老根中心常枯朽中空", "氣味很淡", "味微苦", null, null, null),
      distinguish: null, remedy: null,
      lore: "傳統清熱藥材，與黃連、黃柏並稱「三黃」。放久了切面會因氧化而變綠。" },

    { id: "lvdou", name: "綠豆", alias: ["青小豆"], cat: "clear", group: null, danger: 0,
      traits: { form: ["綠色小豆粒", "橢圓形", "表面光滑"], smell: ["無明顯氣味"], taste: [],
        symptom: [], onset: null },
      tests: T("翠綠色的小橢圓豆粒，表面光滑，一側有淡色臍點", "有淡淡的豆香", "味淡，有豆腥", null, null, null),
      distinguish: null, remedy: null,
      lore: "夏天常煮的綠豆湯，自古被認為能清暑解熱，也被民間當作解毒的食材。是日常食物，並不是特別的藥。" },

    { id: "fangfeng", name: "防風", alias: ["屏風", "百枝"], cat: "clear", group: null, danger: 0,
      traits: { form: ["長圓錐形根", "表面有環紋", "根頭密生纖維"], smell: ["微有香氣"], taste: ["微甜"],
        symptom: [], onset: null },
      tests: T("長圓錐形的根，表面有密集的環狀細紋，根頭殘留著毛狀纖維", "有淡淡的特異香氣", "味微甘", null, null, null),
      distinguish: null, remedy: null,
      lore: "名字取「防止風邪」之意。傳統用來解表，防風通聖散一類的名方都有它。" },

    { id: "shengjiang", name: "生薑", alias: ["薑", "鮮薑"], cat: "clear", group: null, danger: 0,
      traits: { form: ["塊狀根莖", "淡黃色", "有分枝"], smell: ["濃烈特殊香氣"], taste: ["辛辣"],
        symptom: [], onset: null },
      tests: T("淡黃色的塊狀根莖，表皮薄，掰開可見纖維與黃白色肉", "有強烈而獨特的辛香", "辛辣而帶暖意", null, null, null),
      distinguish: null, remedy: null,
      lore: "廚房常備的食材，傳統上也用來驅寒、暖胃、止嘔。民間常說被生半夏、生天南星麻到舌頭時，可以用它來緩解，這是遊戲設定中的用法。" },

    { id: "banlangen", name: "板藍根", alias: ["靛青根", "大青根"], cat: "clear", group: null, danger: 0,
      traits: { form: ["長圓柱形根", "表面灰黃", "根頭有疣狀突起"], smell: ["無明顯氣味"], taste: ["微苦"],
        symptom: [], onset: null },
      tests: T("略彎的圓柱形長根，外皮灰黃，斷面皮部黃白、木部淡黃", "氣味很淡", "先微甜後帶苦澀", null, null, null),
      distinguish: null, remedy: null,
      lore: "菘藍的根，傳統用來清熱。古人也用同一種植物的葉子來做藍色染料。" },

    { id: "lianqiao", name: "連翹", alias: ["黃壽丹", "落翹"], cat: "clear", group: null, danger: 0,
      traits: { form: ["長卵形果實", "頂端開裂", "外皮黃褐"], smell: ["清香"], taste: ["微苦"],
        symptom: [], onset: null },
      tests: T("長卵形的果實，常從頂端裂成兩瓣，表面有小突起，黃褐色", "有淡淡的清香", "味微苦", null, null, null),
      distinguish: null, remedy: null,
      lore: "早春開黃花的灌木，結出的果實可入藥。傳統用來清熱，常與金銀花一起配伍。" },

    { id: "juhua", name: "菊花", alias: ["杭菊", "甘菊"], cat: "clear", group: null, danger: 0,
      traits: { form: ["黃色頭狀花", "花瓣細密", "花托球形"], smell: ["清香"], taste: ["微苦"],
        symptom: [], onset: null },
      tests: T("頭狀花序，花瓣細長密排，中心有黃色小管狀花", "有清淡的菊香", "味微苦帶甘", "泡水後水色轉成淡黃", null, null),
      distinguish: null, remedy: null,
      lore: "秋天的名花，文人愛詠。傳統上泡成花茶，用來清熱、明目。" },

    { id: "gegen", name: "葛根", alias: ["甘葛"], cat: "clear", group: null, danger: 0,
      traits: { form: ["縱切厚片", "白色粉質", "斷面纖維性"], smell: ["無明顯氣味"], taste: ["微甜"],
        symptom: [], onset: null },
      tests: T("切成縱向厚片，色白帶黃，質地粉實、可見纖維", "氣味很淡", "味微甜", null, null, null),
      distinguish: null, remedy: null,
      lore: "葛藤的塊根，也能磨成粉做成葛粉。傳統上用於解表、止渴。" },

    { id: "chaihu", name: "柴胡", alias: ["北柴胡", "地薰"], cat: "clear", group: null, danger: 0,
      traits: { form: ["細長圓柱根", "根頭有莖基", "外皮黑褐"], smell: ["微有香氣"], taste: ["微苦"],
        symptom: [], onset: null },
      tests: T("細長略彎的圓柱形根，根頭帶著殘留的莖基，質硬而韌", "有一點淡淡的香氣", "味微苦而辛", null, null, null),
      distinguish: null, remedy: null,
      lore: "傳統解表退熱的常用藥材，在《傷寒論》的名方裡佔重要位置。" },

    { id: "dahuang", name: "大黃", alias: ["將軍", "川軍"], cat: "clear", group: null, danger: 1,
      traits: { form: ["類圓柱塊狀根", "黃棕色", "斷面有星點錦紋"], smell: ["微有香氣"], taste: ["微苦", "微澀"],
        symptom: ["腹瀉", "腹痛"], onset: "mid" },
      tests: T("粗大的塊狀根莖，斷面橙黃，可見放射狀的紋路與星點", "有淡淡的特殊清香", "味微苦而澀，嚼之黏牙並染黃唾液", null, null, "餵食的小動物排出稀便"),
      distinguish: null, remedy: null,
      lore: "古人稱它「將軍」，因為藥性迅猛，傳統上用來通便瀉下。體弱者不宜用，吃錯了會腹瀉腹痛。" },

    { id: "pugongying", name: "蒲公英", alias: ["黃花地丁", "婆婆丁"], cat: "clear", group: null, danger: 0,
      traits: { form: ["葉基生鋸齒", "黃色頭狀花", "白色冠毛球"], smell: ["無明顯氣味"], taste: ["微苦"],
        symptom: [], onset: null },
      tests: T("葉片貼地叢生、邊緣有深鋸齒，花黃色，結果後長成白色絨球", "氣味很淡", "味微苦", null, null, null),
      distinguish: null, remedy: null,
      lore: "田邊路旁最常見的野草，種子帶白色冠毛隨風飛散。傳統上用來清熱，嫩葉也可食用。" },

    { id: "yuxingcao", name: "魚腥草", alias: ["蕺菜", "折耳根"], cat: "clear", group: null, danger: 0,
      traits: { form: ["心形葉", "白色苞片", "穗狀花序"], smell: ["魚腥味"], taste: ["微澀"],
        symptom: [], onset: null },
      tests: T("心形的葉，莖紫紅，小花聚成穗，基部有四片白色花瓣狀苞片", "揉搓後有很明顯的魚腥氣", "味微澀，帶腥", null, null, null),
      distinguish: null, remedy: null,
      lore: "揉碎後有魚腥味而得名，在西南地區也被當成野菜。傳統用來清熱。" },

    { id: "jiegeng", name: "桔梗", alias: ["鈴鐺花", "包袱花"], cat: "clear", group: null, danger: 0,
      traits: { form: ["紡錘形根", "外皮淡黃", "斷面有菊花心"], smell: ["無明顯氣味"], taste: ["微甜", "微苦"],
        symptom: [], onset: null },
      tests: T("紡錘形的根，去皮後白淨，橫切面可見一圈圈像菊花的紋路", "氣味很淡", "味微甜後苦", null, null, null),
      distinguish: null, remedy: null,
      lore: "夏天開藍紫色鈴鐺狀花，傳統用來利咽、止咳。朝鮮半島也將它當作食材。" },

    { id: "mahuang", name: "麻黃", alias: ["龍沙", "草麻黃"], cat: "clear", group: null, danger: 1,
      traits: { form: ["草質莖", "細圓柱形", "節明顯", "淡綠色"], smell: ["微弱草腥味"], taste: ["微苦"],
        symptom: ["心悸", "失眠", "手抖"], onset: "mid" },
      tests: T("細長的圓柱形枝，淡綠色，有明顯的節，節上有退化的小鱗葉", "氣味很淡，帶一點草腥", "味微苦而澀", null, null, "餵食的小動物變得躁動不安"),
      distinguish: null, remedy: null,
      lore: "傳統用於發汗解表、平喘的藥材，作用強。體質敏感的人誤用會心悸、失眠，所以古人強調要謹慎。" },

    { id: "baimaogen", name: "白茅根", alias: ["茅根", "茅草根"], cat: "clear", group: null, danger: 0,
      traits: { form: ["白色細長根莖", "節明顯", "表面有縱紋"], smell: ["無明顯氣味"], taste: ["微甜"],
        symptom: [], onset: null },
      tests: T("白色或淡黃的細長根莖，有明顯的節，節間有縱向細紋", "氣味很淡", "味微甜", null, null, null),
      distinguish: null, remedy: null,
      lore: "茅草的地下莖，田野隨處可見。傳統上煮水清熱，是夏天常見的飲料材料。" }
  ];
  if (typeof module !== "undefined" && module.exports) module.exports = LIST;
  if (root.PriTestYakushiHerbs && root.PriTestYakushiHerbs.register) root.PriTestYakushiHerbs.register(LIST);
})();
