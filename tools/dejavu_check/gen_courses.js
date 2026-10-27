// DÉJÀ VU：產生擴充固定山路 static_src/dejavu_courses.js（2026-10-26 第六批，10 → 102 條；2026-10-27 第十批再加日本／台灣為主的路線）
//   node tools/dejavu_check/gen_courses.js
// 每條路依「路線性格」（PROFILES）用零件（D.PIECES）接出來，盡量不重疊；亂數 seed 由 id 決定，所以重跑結果一樣。
// 只有名稱是真實地名，路段形狀是風格化的生成結果，不是實際測量。產生後的檔案可以直接手動微調。
"use strict";

global.window = global;
require("../../static_src/dejavu_data.js");
require("../../static_src/dejavu_core.js");
var D = global.PriTestDejavuData;
var Core = global.PriTestDejavuCore;
var fs = require("fs");
var path = require("path");

// 路線性格：零件權重＋坡度變化
var PROFILES = {
  hairpin: { hairpin: 3, double_hairpin: 1.5, hairpin_wide: 1.5, straight_s: 3, medium: 1.5, tight: 2, gutter_hairpin: 0.8, fishhook: 1, triple_hairpin: 0.4, kink: 1 },
  switchback: { switchback: 0.8, hairpin: 3, double_hairpin: 2, triple_hairpin: 0.8, straight_s: 3, kink: 1, tight: 1 },
  fast: { straight_l: 3, sweep: 3, long_sweep: 2, kink: 3, cliff_run: 1, straight_s: 2, medium: 1, carousel: 0.4 },
  technical: { medium: 3, tight: 3, s_curve: 2, chicane: 1, esses: 1, decreasing: 1, increasing: 1, double_apex: 1, straight_s: 3, hairpin: 1 },
  narrow: { snake: 2, esses: 2, tight: 3, medium: 2, s_curve: 2, straight_s: 2, hairpin: 1, kink: 1 },
  mixed: { straight_s: 4, straight_l: 2, sweep: 3, medium: 3, tight: 3, hairpin: 2, s_curve: 2, double_hairpin: 1, kink: 2, long_sweep: 1, hairpin_wide: 1,
    chicane: 1, decreasing: 1, increasing: 1, esses: 1, crest: 1, dive: 0.8, fishhook: 0.8, double_apex: 0.8, snake: 0.6 },
  coastal: { sweep: 3, medium: 3, kink: 2, straight_l: 1.5, straight_s: 2, cliff_run: 1.5, tight: 1, bridge: 0.5, tunnel: 0.4, s_curve: 1 },
  tunnel: { tunnel: 1.5, tunnel_curve: 1.5, medium: 2, straight_s: 2, sweep: 2, tight: 1.5, hairpin: 1, bridge: 0.8 },
  rally: { gravel: 1.5, gravel_corner: 1.5, crest: 1.5, dip: 1, tight: 2, medium: 2, straight_s: 2, hairpin: 1, dive: 1 },
  highland: { long_sweep: 2, sweep: 3, carousel: 1, crest: 1, straight_l: 2, kink: 2, hairpin: 1, dive: 0.5, medium: 1 },
  cliff: { cliff_run: 2, tunnel: 1, tunnel_curve: 1, bridge: 1, medium: 2, tight: 2, hairpin: 1.5, straight_s: 2 }
};
var PROFILE_IDS = Object.keys(PROFILES);
// 城市路線（第九批）：不用零件，直接接直線與路口彎（見 cityPiece）
//   city_grid 棋盤街區（直線接 90° 路口）、city_avenue 大道（長直線、少彎）、city_express 高架快速道路（大半徑彎、整段高架）、city_river 河岸道路
var CITY_PROFILES = ["city_grid", "city_avenue", "city_express", "city_river"];

function C(zh, ja, en) { return [zh, ja, en]; }
// [id, 名稱, 分類, 性格, 路寬, 坡度, 長度 km, { scene, water }?]
var LIST = [
  // ---- 日本峠 ----
  ["irohazaka", C("伊呂波坂", "いろは坂", "Irohazaka"), "touge", "hairpin", 7, 8, 3.6],
  ["tsubaki", C("椿線", "椿ライン", "Tsubaki Line"), "touge", "technical", 6.5, 8, 4.2],
  ["nagao", C("長尾峠", "長尾峠", "Nagao Pass"), "touge", "narrow", 5.5, 7, 3.2],
  ["hakonetp", C("箱根收費道", "箱根ターンパイク", "Hakone Turnpike"), "touge", "fast", 8.5, 9, 5.2],
  ["ashinokosl", C("蘆之湖天際線", "芦ノ湖スカイライン", "Ashinoko Skyline"), "touge", "highland", 7, 5, 4.6, { scene: "lake", water: 1 }],
  ["izusl", C("伊豆天際線", "伊豆スカイライン", "Izu Skyline"), "touge", "fast", 7.5, 6, 5.5],
  ["kirifuri", C("日光霧降高原", "日光霧降高原", "Nikko Kirifuri"), "touge", "mixed", 6.5, 8, 4],
  ["momiji", C("紅葉線", "もみじライン", "Momiji Line"), "touge", "technical", 6.5, 7, 3.8],
  ["sadamine", C("定峰峠", "定峰峠", "Sadamine Pass"), "touge", "narrow", 5.5, 7, 3],
  ["shomaru", C("正丸峠", "正丸峠", "Shomaru Pass"), "touge", "hairpin", 5.5, 8, 2.8],
  ["happogahara", C("八方原", "八方ヶ原", "Happogahara"), "touge", "hairpin", 6.5, 9, 3.4],
  ["tsukuba", C("筑波山", "筑波山", "Mt. Tsukuba"), "touge", "technical", 6, 7, 3.2],
  ["yabitsu", C("矢櫃峠", "ヤビツ峠", "Yabitsu Pass"), "touge", "narrow", 5, 8, 3.6],
  ["okutama", C("奧多摩周遊道路", "奥多摩周遊道路", "Okutama Shuyu"), "touge", "mixed", 7, 6, 5],
  ["rokko", C("六甲山", "六甲山", "Mt. Rokko"), "touge", "hairpin", 6.5, 9, 3.6],
  ["shigakusatsu", C("志賀草津高原", "志賀草津高原ルート", "Shiga-Kusatsu"), "touge", "highland", 7, 7, 5.6],
  ["bandai", C("磐梯吾妻天際線", "磐梯吾妻スカイライン", "Bandai-Azuma Skyline"), "touge", "highland", 7, 6, 5],
  ["venus", C("維納斯線", "ビーナスライン", "Venus Line"), "touge", "fast", 7.5, 4, 5.4],
  ["fujiazami", C("富士薊線", "ふじあざみライン", "Fuji Azami Line"), "touge", "switchback", 6, 12, 3.4],
  ["ibuki", C("伊吹山兜風道", "伊吹山ドライブウェイ", "Ibuki Driveway"), "touge", "mixed", 7, 7, 4.4],
  ["aso", C("阿蘇牛奶路", "阿蘇ミルクロード", "Aso Milk Road"), "touge", "fast", 8, 4, 5],
  ["ebino", C("蝦野高原", "えびの高原", "Ebino Highland"), "touge", "mixed", 6.5, 7, 4],
  ["tsuetsuki", C("杖突峠", "杖突峠", "Tsuetsuki Pass"), "touge", "technical", 6.5, 8, 3.6],
  ["mikuni", C("三國峠", "三国峠", "Mikuni Pass"), "touge", "hairpin", 6.5, 8, 3.8],
  ["shiobara", C("鹽原", "塩原", "Shiobara"), "touge", "technical", 6.5, 6, 3.6],
  ["ikoma", C("生駒山", "生駒山", "Mt. Ikoma"), "touge", "narrow", 6, 8, 3],
  ["wada", C("和田峠", "和田峠", "Wada Pass"), "touge", "switchback", 5, 11, 2.8],
  ["odarumi", C("大垂水峠", "大垂水峠", "Odarumi Pass"), "touge", "mixed", 7, 6, 3.6],
  ["echizen", C("越前海岸", "越前海岸", "Echizen Coast"), "touge", "coastal", 7, 3, 4.6, { scene: "sea", water: -1 }],
  ["oga", C("男鹿半島", "男鹿半島", "Oga Peninsula"), "touge", "coastal", 6.5, 4, 4.2, { scene: "sea", water: 1 }],
  // 第十批（2026-10-27）：日本峠追加
  ["tsuchisaka", C("土坂峠", "土坂峠", "Tsuchisaka Pass"), "touge", "narrow", 5, 8, 3],
  ["norikura", C("乘鞍回聲線", "乗鞍エコーライン", "Norikura Echo Line"), "touge", "switchback", 6, 9, 4.6],
  ["mugikusa", C("麥草峠", "麦草峠", "Mugikusa Pass"), "touge", "highland", 6.5, 7, 4.6],
  ["ohdarumi", C("大弛峠", "大弛峠", "Ohdarumi Pass"), "touge", "narrow", 5, 9, 4],
  ["hakonekyudo", C("箱根舊道 七曲", "箱根旧道・七曲り", "Hakone Old Road Nanamagari"), "touge", "hairpin", 6, 9, 3.2],
  ["nishiizu", C("西伊豆天際線", "西伊豆スカイライン", "Nishi-Izu Skyline"), "touge", "highland", 6.5, 6, 5, { scene: "sea", water: -1 }],
  ["kawazu", C("河津七瀑環狀橋", "河津七滝ループ橋", "Kawazu Loop Bridge"), "touge", "mixed", 7, 8, 3.6],
  ["fujisubaru", C("富士速霸陸線", "富士スバルライン", "Fuji Subaru Line"), "touge", "fast", 8, 7, 5.8],
  ["doshi", C("道志道", "道志みち", "Doshi Road"), "touge", "mixed", 7, 5, 5],
  ["suzukasl", C("鈴鹿天際線", "鈴鹿スカイライン", "Suzuka Skyline"), "touge", "hairpin", 6.5, 8, 4],
  ["hiei", C("比叡山兜風道", "比叡山ドライブウェイ", "Mt. Hiei Driveway"), "touge", "mixed", 7, 7, 4.4, { scene: "lake", water: -1 }],
  ["arashiyama", C("嵐山高雄公園道", "嵐山高雄パークウェイ", "Arashiyama-Takao Parkway"), "touge", "technical", 6.5, 7, 4],
  ["royu", C("芦有兜風道", "芦有ドライブウェイ", "Royu Driveway"), "touge", "technical", 6.5, 8, 3.8],
  ["hiruzen", C("蒜山大山天際線", "蒜山大山スカイライン", "Hiruzen-Daisen Skyline"), "touge", "highland", 6.5, 6, 4.8],
  ["karst", C("四國喀斯特", "四国カルスト", "Shikoku Karst"), "touge", "narrow", 4.5, 6, 4.4],
  ["ishizuchi", C("石鎚天際線", "石鎚スカイライン", "Ishizuchi Skyline"), "touge", "hairpin", 5.5, 9, 4.2],
  ["yamanami", C("山並公路", "やまなみハイウェイ", "Yamanami Highway"), "touge", "fast", 7.5, 5, 5.6],
  ["unzen", C("雲仙", "雲仙", "Unzen"), "touge", "technical", 6.5, 8, 3.8],
  ["ibusuki", C("指宿天際線", "指宿スカイライン", "Ibusuki Skyline"), "touge", "fast", 7, 5, 5, { scene: "sea", water: 1 }],
  ["bihoro", C("美幌峠", "美幌峠", "Bihoro Pass"), "touge", "highland", 7, 6, 4.6, { scene: "lake", water: -1 }],
  ["nissho", C("日勝峠", "日勝峠", "Nissho Pass"), "touge", "fast", 7.5, 7, 5.4],
  ["shiretoko", C("知床峠", "知床峠", "Shiretoko Pass"), "touge", "switchback", 6.5, 8, 4.6],
  ["hachimantai", C("八幡平盾狀火山線", "八幡平アスピーテライン", "Hachimantai Aspite Line"), "touge", "highland", 6.5, 7, 5],
  ["zao", C("藏王回聲線", "蔵王エコーライン", "Zao Echo Line"), "touge", "switchback", 6.5, 8, 4.8],
  ["chokai", C("鳥海藍線", "鳥海ブルーライン", "Chokai Blue Line"), "touge", "highland", 6.5, 8, 5, { scene: "sea", water: 1 }],
  ["hakusan", C("白山白川鄉白色之路", "白山白川郷ホワイトロード", "Hakusan White Road"), "touge", "hairpin", 6, 8, 4.4],
  ["onioshi", C("鬼押公路", "鬼押ハイウェー", "Onioshi Highway"), "touge", "fast", 7.5, 5, 4.6],
  ["chirihama", C("千里濱海灘兜風道", "千里浜なぎさドライブウェイ", "Chirihama Beach Driveway"), "touge", "coastal", 9, 1, 4.6, { scene: "sea", water: -1 }],
  ["tsunoshima", C("角島大橋", "角島大橋", "Tsunoshima Bridge"), "touge", "coastal", 7, 2, 3.8, { scene: "sea", water: 1 }],
  ["kaichu", C("沖繩海中道路", "沖縄・海中道路", "Okinawa Kaichu Road"), "touge", "coastal", 8, 1, 4.2, { scene: "sea", water: -1 }],
  // ---- 台灣山路 ----
  ["yangjin", C("陽金公路", "陽金公路（陽明山）", "Yangjin Hwy (Yangmingshan)"), "tw", "technical", 6.5, 7, 4.2],
  ["beiyi", C("北宜公路九彎十八拐", "北宜公路・九彎十八拐", "Beiyi Hwy 'Nine Bends'"), "tw", "narrow", 6.5, 6, 5],
  ["hehuan", C("合歡山武嶺", "合歓山・武嶺", "Hehuanshan Wuling"), "tw", "switchback", 6, 9, 4.6],
  ["taroko", C("太魯閣中橫", "タロコ・中横公路", "Taroko Central Cross-Island"), "tw", "cliff", 6, 6, 5.4],
  ["beiheng", C("北橫公路", "北横公路", "Northern Cross-Island Hwy"), "tw", "narrow", 6, 6, 5],
  ["nanheng", C("南橫公路", "南横公路", "Southern Cross-Island Hwy"), "tw", "mixed", 6, 7, 5.8],
  ["alishan", C("阿里山公路", "阿里山公路", "Alishan Hwy"), "tw", "hairpin", 6.5, 8, 4.8],
  ["sunmoon", C("日月潭環湖", "日月潭湖畔道路", "Sun Moon Lake Loop"), "tw", "coastal", 7, 3, 4.2, { scene: "lake", water: 1 }],
  ["xitou", C("溪頭", "渓頭", "Xitou"), "tw", "technical", 6, 7, 3.4],
  ["dasyueshan", C("大雪山林道", "大雪山林道", "Dasyueshan Forest Rd"), "tw", "rally", 5.5, 8, 4],
  ["suhua", C("蘇花公路", "蘇花公路", "Suhua Hwy"), "tw", "cliff", 6.5, 3, 5.6, { scene: "sea", water: -1 }],
  ["tw11", C("台11線東海岸", "台11線・東海岸", "East Coast Hwy 11"), "tw", "coastal", 8, 2, 5.6, { scene: "sea", water: 1 }],
  ["fengguizui", C("風櫃嘴", "風櫃嘴", "Fengguizui"), "tw", "narrow", 5.5, 8, 3.2],
  ["buyanting", C("102 縣道不厭亭", "102県道・不厭亭", "Route 102 Buyanting"), "tw", "technical", 6, 7, 3.8],
  ["wuzhishan", C("五指山", "五指山", "Wuzhishan"), "tw", "hairpin", 5.5, 8, 3.4],
  ["lalashan", C("拉拉山", "拉拉山", "Lalashan"), "tw", "narrow", 5.5, 7, 4.4],
  ["qingjing", C("清境", "清境", "Cingjing"), "tw", "highland", 6.5, 7, 4.4],
  ["kenting", C("墾丁濱海", "墾丁海岸道路", "Kenting Coast"), "tw", "coastal", 7.5, 2, 4.4, { scene: "sea", water: -1 }],
  ["taipingshan", C("太平山", "太平山", "Taipingshan"), "tw", "switchback", 5.5, 9, 4],
  ["guguan", C("谷關", "谷関", "Guguan"), "tw", "tunnel", 6.5, 6, 4.2],
  // 第十批（2026-10-27）：台灣山路追加
  ["jinshui", C("金水公路", "金水公路（金瓜石）", "Jinshui Rd (Jinguashi)"), "tw", "switchback", 5.5, 9, 3.6, { scene: "sea", water: 1 }],
  ["balaka", C("巴拉卡公路", "巴拉卡公路（陽明山）", "Balaka Hwy (Yangmingshan)"), "tw", "technical", 6, 7, 4.2],
  ["yangde", C("仰德大道", "仰徳大道", "Yangde Blvd"), "tw", "technical", 7, 8, 3.4],
  ["shiding", C("石碇 北 47", "石碇・北47", "Shiding Rd 47"), "tw", "narrow", 5, 7, 3.6],
  ["wulai", C("烏來", "烏来", "Wulai"), "tw", "narrow", 5.5, 6, 3.8],
  ["smangus", C("司馬庫斯", "スマングス", "Smangus"), "tw", "rally", 5, 9, 4.4],
  ["nanzhuang", C("南庄 124 縣道", "南庄・124県道", "Nanzhuang Route 124"), "tw", "technical", 6, 6, 4],
  ["shanlinxi", C("杉林溪", "杉林渓", "Shanlinxi"), "tw", "switchback", 5.5, 9, 4.2],
  ["tataka", C("新中橫塔塔加", "新中横・塔塔加", "Tataka (New Central Cross-Island)"), "tw", "highland", 6.5, 8, 5.4],
  ["siyuan", C("思源埡口", "思源埡口", "Siyuan Pass"), "tw", "hairpin", 6, 8, 4.6],
  ["fenqihu", C("奮起湖", "奮起湖", "Fenqihu"), "tw", "hairpin", 5.5, 8, 4],
  ["guanziling", C("關子嶺", "関子嶺", "Guanziling"), "tw", "technical", 6, 7, 3.6],
  ["maolin", C("茂林", "茂林", "Maolin"), "tw", "hairpin", 5.5, 8, 3.8],
  ["southlink", C("南迴公路", "南廻公路", "South Link Hwy"), "tw", "fast", 8, 5, 5.6],
  ["mudan", C("牡丹 199 縣道", "牡丹・199県道", "Mudan Route 199"), "tw", "narrow", 5.5, 5, 4.6],
  ["liushidan", C("六十石山", "六十石山", "Liushidan Mountain"), "tw", "hairpin", 5, 10, 3.4],
  ["yuchang", C("玉長公路", "玉長公路", "Yuchang Hwy"), "tw", "tunnel", 7, 6, 4.4],
  ["luye", C("鹿野高台", "鹿野高台", "Luye Highland"), "tw", "highland", 6.5, 6, 3.8],
  ["northcoast", C("台2線北海岸", "台2線・北海岸", "North Coast Hwy 2"), "tw", "coastal", 8, 2, 5, { scene: "sea", water: -1 }],
  ["bitou", C("鼻頭角", "鼻頭角", "Bitou Cape"), "tw", "cliff", 6.5, 3, 3.8, { scene: "sea", water: 1 }],
  ["jiji", C("集集綠色隧道", "集集・緑のトンネル", "Jiji Green Tunnel"), "tw", "fast", 7, 2, 4.4],
  ["penghu", C("澎湖跨海大橋", "澎湖跨海大橋", "Penghu Great Bridge"), "tw", "coastal", 8, 1, 4, { scene: "sea", water: 1 }],
  ["greenisland", C("綠島環島", "緑島一周道路", "Green Island Loop"), "tw", "coastal", 6, 2, 4, { scene: "sea", water: -1 }],
  // ---- 世界名道 ----
  ["stelvio", C("斯泰爾維奧山口", "ステルヴィオ峠", "Stelvio Pass"), "world", "switchback", 6, 8, 5],
  ["transfagarasan", C("特蘭斯法加拉什", "トランスファガラシャン", "Transfăgărășan"), "world", "hairpin", 6.5, 7, 5.6],
  ["grossglockner", C("大格洛克納高山公路", "グロースグロックナー", "Grossglockner"), "world", "highland", 7, 8, 5.4],
  ["furka", C("富卡山口", "フルカ峠", "Furka Pass"), "world", "cliff", 6, 8, 4.6],
  ["tremola", C("聖哥達特雷莫拉", "ゴッタルド・トレモラ", "Gotthard Tremola"), "world", "switchback", 5.5, 8, 4],
  ["turini", C("圖里尼山口", "チュリニ峠", "Col de Turini"), "world", "hairpin", 5.5, 8, 4.2],
  ["corniche", C("蔚藍海岸濱海路", "コルニッシュ", "Grande Corniche"), "world", "coastal", 7, 4, 4.4, { scene: "sea", water: -1 }],
  ["amalfi", C("阿瑪菲海岸", "アマルフィ海岸", "Amalfi Coast"), "world", "narrow", 5.5, 3, 4.6, { scene: "sea", water: -1 }],
  ["trollstigen", C("精靈之路", "トロルスティーゲン", "Trollstigen"), "world", "switchback", 5.5, 9, 3.6],
  ["atlantic", C("大西洋海濱路", "アトランティック・ロード", "Atlantic Road"), "world", "coastal", 7, 2, 4.2, { scene: "sea", water: 1 }],
  ["pikes", C("派克峰", "パイクスピーク", "Pikes Peak"), "world", "hairpin", 7, 7, 6],
  ["dragon", C("巨龍之尾", "テール・オブ・ザ・ドラゴン", "Tail of the Dragon"), "world", "narrow", 6, 5, 5],
  ["angeles", C("安吉利斯冠線", "エンジェルス・クレスト", "Angeles Crest"), "world", "fast", 7.5, 6, 6],
  ["mulholland", C("穆赫蘭道", "マルホランド・ドライブ", "Mulholland Drive"), "world", "technical", 6.5, 5, 4.2],
  ["bigsur", C("大索爾一號公路", "ビッグサー・ハイウェイ1", "Big Sur Hwy 1"), "world", "coastal", 7, 3, 5.6, { scene: "sea", water: -1 }],
  ["milliondollar", C("百萬美元公路", "ミリオンダラー・ハイウェイ", "Million Dollar Hwy"), "world", "cliff", 6, 7, 5],
  ["beartooth", C("熊牙公路", "ベアトゥース・ハイウェイ", "Beartooth Hwy"), "world", "switchback", 6.5, 7, 5.2],
  ["sani", C("薩尼山口", "サニ峠", "Sani Pass"), "world", "rally", 5.5, 9, 4],
  ["chapmans", C("查普曼峰", "チャップマンズ・ピーク", "Chapman's Peak"), "world", "coastal", 6.5, 4, 4, { scene: "sea", water: -1 }],
  ["guoliang", C("郭亮掛壁公路", "郭亮村の絶壁トンネル", "Guoliang Tunnel"), "world", "tunnel", 5.5, 7, 3.6],
  ["tianmen", C("天門山通天大道", "天門山・通天大道", "Tianmen 99 Bends"), "world", "switchback", 6, 9, 5],
  ["panorama", C("全景山", "マウント・パノラマ", "Mount Panorama"), "world", "fast", 8, 6, 4.4],
  ["yungas", C("永加斯死亡公路", "ユンガスの道", "Yungas Road"), "world", "rally", 5, 8, 5],
  ["jebelhafeet", C("哈菲特山", "ジェベル・ハフィート", "Jebel Hafeet"), "world", "fast", 9, 7, 5.2],
  ["corse", C("科西嘉山路", "コルシカ山岳路", "Corsica D81"), "world", "narrow", 5.5, 5, 5, { scene: "sea", water: 1 }],
  ["greatocean", C("大洋路", "グレート・オーシャン・ロード", "Great Ocean Road"), "world", "coastal", 7.5, 2, 5.8, { scene: "sea", water: -1 }],
  // 第十批（2026-10-27）：世界名道追加
  ["galibier", C("加利比耶山口", "ガリビエ峠", "Col du Galibier"), "world", "switchback", 6, 8, 5],
  ["giau", C("吉奧山口", "ジャウ峠", "Passo Giau"), "world", "hairpin", 6, 9, 4.4],
  ["sella", C("塞拉山口", "セッラ峠", "Passo Sella"), "world", "hairpin", 6.5, 8, 4],
  ["iseran", C("伊塞朗山口", "イズラン峠", "Col de l'Iseran"), "world", "highland", 6.5, 7, 5.2],
  ["napoleon", C("拿破崙之路", "ナポレオン街道", "Route Napoléon"), "world", "fast", 7.5, 5, 5.6],
  ["bealach", C("牛之山口", "ベアラック・ナ・バ", "Bealach na Bà"), "world", "narrow", 4.5, 10, 4],
  ["hardknott", C("哈德諾特山口", "ハードノット峠", "Hardknott Pass"), "world", "narrow", 4, 12, 2.8],
  ["hana", C("哈納公路", "ハナ・ハイウェイ", "Hana Highway"), "world", "narrow", 5.5, 3, 5, { scene: "sea", water: -1 }],
  ["hangyeryeong", C("寒溪嶺", "寒渓嶺", "Hangyeryeong Pass"), "world", "mixed", 7, 8, 4.6],
  ["taimoshan", C("大帽山", "大帽山", "Tai Mo Shan"), "world", "hairpin", 5.5, 10, 3.4],
  ["genting", C("雲頂高原", "ゲンティン・ハイランド", "Genting Highlands"), "world", "hairpin", 7, 8, 5],
  ["crownrange", C("皇冠山脈公路", "クラウン・レンジ・ロード", "Crown Range Road"), "world", "switchback", 6.5, 9, 4.2],
  // ---- MF Ghost 風格（風格化，不是實際路線） ----
  ["nagaogt", C("箱根長尾 GT", "箱根長尾GT", "Hakone Nagao GT"), "mfg", "mixed", 8, 8, 5],
  ["amagigt", C("伊豆天城 GT", "伊豆天城GT", "Izu Amagi GT"), "mfg", "hairpin", 7.5, 7, 5.2],
  ["fujigt", C("富士吉田 GT", "富士吉田GT", "Fujiyoshida GT"), "mfg", "fast", 9, 6, 6],
  ["atamitoge", C("熱海峠 GT", "熱海峠GT", "Atami Pass GT"), "mfg", "technical", 7.5, 8, 4.8],
  ["yugawara", C("湯河原 GT", "湯河原GT", "Yugawara GT"), "mfg", "coastal", 8, 5, 5.2, { scene: "sea", water: -1 }],
  ["izunokuni", C("伊豆之國湖岸 GT", "伊豆の国レイクサイドGT", "Izunokuni Lakeside GT"), "mfg", "highland", 8.5, 5, 5.6, { scene: "lake", water: 1 }],
  ["odawaragt", C("小田原派克峰 GT", "小田原パイクスピークGT", "Odawara Pikes Peak GT"), "mfg", "fast", 9, 9, 5.6],
  ["ashinokogt", C("蘆之湖 GT", "芦ノ湖GT", "Ashinoko GT"), "mfg", "mixed", 8, 6, 5.4, { scene: "lake", water: -1 }],
  ["izuslgt", C("伊豆天際線 GT", "伊豆スカイラインGT", "Izu Skyline GT"), "mfg", "fast", 8.5, 6, 6],
  // ---- 原創 ----
  ["kirimine", C("霧峰", "霧峰", "Kirimine"), "orig", "mixed", 6.5, 8, 4.4],
  ["kitsunebi", C("狐火峠", "狐火峠", "Kitsunebi Pass"), "orig", "hairpin", 6, 9, 3.8],
  ["raimei", C("雷鳴坂", "雷鳴坂", "Raimei Slope"), "orig", "fast", 8, 10, 4.6],
  ["ryuseki", C("龍脊", "龍の背", "Dragon's Spine"), "orig", "narrow", 5.5, 8, 4.6],
  ["hakuro", C("白狼林道", "白狼林道", "White Wolf Forest Rd"), "orig", "rally", 6, 8, 4.2],
  ["gekko", C("月光谷", "月光谷", "Moonlight Valley"), "orig", "tunnel", 6.5, 7, 4.4],
  ["kikoku", C("鬼哭峠", "鬼哭峠", "Kikoku Pass"), "orig", "switchback", 5.5, 10, 4],
  ["hoshifuri", C("星降坂", "星降る坂", "Starfall Slope"), "orig", "highland", 7, 7, 5],
  ["tengu", C("天狗之鼻", "天狗の鼻", "Tengu's Nose"), "orig", "cliff", 6, 8, 4.4],
  ["aosagi", C("蒼鷺湖", "蒼鷺湖", "Grey Heron Lake"), "orig", "coastal", 7, 4, 4.6, { scene: "lake", water: -1 }],
  // ---- 城市（第九批，2026-10-27；街景見 dejavu.js 的 cityLayout，路形是風格化的） ----
  ["shinjuku", C("東京 新宿", "東京・新宿", "Tokyo Shinjuku"), "city", "city_grid", 8, 2, 3.6, { region: "jpcity", lm: "tokyo" }],
  ["shibuya", C("東京 澀谷", "東京・渋谷", "Tokyo Shibuya"), "city", "city_grid", 8.5, 3, 3.4, { region: "jpcity", lm: "tokyo" }],
  ["ginza", C("東京 銀座中央通", "東京・銀座中央通り", "Tokyo Ginza"), "city", "city_avenue", 10, 1, 3.8, { region: "jpcity", lm: "tokyo" }],
  ["shutoc1", C("首都高 C1 都心環狀線", "首都高 C1 都心環状線", "Shuto Expwy C1 Loop"), "city", "city_express", 7, 2, 4.6, { region: "jpcity", lm: "tokyo" }],
  ["wangan", C("首都高 灣岸線", "首都高 湾岸線", "Shuto Wangan Line"), "city", "city_express", 9, 1, 5.4, { region: "jpcity", lm: "tokyo", scene: "sea", water: -1 }],
  ["dotonbori", C("大阪 道頓堀", "大阪・道頓堀", "Osaka Dotonbori"), "city", "city_river", 7, 1, 3.4, { region: "jpcity", scene: "lake", water: 1 }],
  ["umeda", C("大阪 梅田 御堂筋", "大阪・梅田 御堂筋", "Osaka Umeda Midosuji"), "city", "city_avenue", 10, 2, 3.8, { region: "jpcity" }],
  ["hanshin", C("阪神高速 環狀線", "阪神高速 環状線", "Hanshin Expwy Loop"), "city", "city_express", 7, 2, 4.4, { region: "jpcity" }],
  ["sakae", C("名古屋 榮", "名古屋・栄", "Nagoya Sakae"), "city", "city_avenue", 10, 1, 3.6, { region: "jpcity" }],
  ["kawaramachi", C("京都 河原町", "京都・河原町", "Kyoto Kawaramachi"), "city", "city_grid", 7, 2, 3.2, { region: "jpcity" }],
  ["tenjin", C("福岡 天神", "福岡・天神", "Fukuoka Tenjin"), "city", "city_grid", 8, 2, 3.4, { region: "jpcity" }],
  ["susukino", C("札幌 薄野", "札幌・すすきの", "Sapporo Susukino"), "city", "city_grid", 9, 1, 3.4, { region: "jpcity" }],
  ["minatomirai", C("橫濱 港未來", "横浜・みなとみらい", "Yokohama Minato Mirai"), "city", "city_river", 9, 1, 4, { region: "jpcity", scene: "sea", water: -1 }],
  ["ximen", C("台北 西門町", "台北・西門町", "Taipei Ximending"), "city", "city_grid", 7, 2, 3.2, { region: "twcity", lm: "taipei" }],
  ["xinyi", C("台北 信義區", "台北・信義区", "Taipei Xinyi"), "city", "city_avenue", 10, 2, 3.6, { region: "twcity", lm: "taipei" }],
  ["zhongxiao", C("台北 忠孝東路", "台北・忠孝東路", "Taipei Zhongxiao E. Rd"), "city", "city_avenue", 10, 1, 4, { region: "twcity", lm: "taipei" }],
  ["civicblvd", C("台北 市民大道高架", "台北・市民大道高架", "Taipei Civic Blvd Viaduct"), "city", "city_express", 8, 2, 4.4, { region: "twcity", lm: "taipei" }],
  ["jianguo", C("台北 建國高架", "台北・建国高架", "Taipei Jianguo Viaduct"), "city", "city_express", 8, 2, 4.2, { region: "twcity", lm: "taipei" }],
  ["zhongshan", C("台北 中山北路", "台北・中山北路", "Taipei Zhongshan N. Rd"), "city", "city_avenue", 9, 2, 3.6, { region: "twcity", lm: "taipei" }],
  ["fengjia", C("台中 逢甲", "台中・逢甲", "Taichung Fengjia"), "city", "city_grid", 6.5, 2, 3, { region: "twcity" }],
  ["taiwanblvd", C("台中 台灣大道", "台中・台湾大道", "Taichung Taiwan Blvd"), "city", "city_avenue", 10, 1, 4.2, { region: "twcity" }],
  ["loveriver", C("高雄 愛河", "高雄・愛河", "Kaohsiung Love River"), "city", "city_river", 8, 1, 3.8, { region: "twcity", scene: "lake", water: -1 }],
  ["xinjuejiang", C("高雄 新堀江", "高雄・新堀江", "Kaohsiung Shinkuchan"), "city", "city_grid", 7, 1, 3, { region: "twcity" }],
  ["haian", C("台南 海安路", "台南・海安路", "Tainan Haian Rd"), "city", "city_grid", 7.5, 1, 3.2, { region: "twcity" }],
  ["miaokou", C("基隆 廟口", "基隆・廟口", "Keelung Miaokou"), "city", "city_grid", 6.5, 3, 3, { region: "twcity", scene: "sea", water: 1 }],
  ["tamsui", C("淡水 河岸", "淡水・河岸", "Tamsui Riverside"), "city", "city_river", 7, 2, 3.6, { region: "twcity", scene: "sea", water: -1 }],
  // 第十批（2026-10-27）：城市追加
  ["roppongi", C("東京 六本木", "東京・六本木", "Tokyo Roppongi"), "city", "city_grid", 8, 3, 3.4, { region: "jpcity", lm: "tokyo" }],
  ["daikoku", C("首都高 橫羽線 大黑", "首都高 横羽線・大黒", "Shuto Yokohane Line (Daikoku)"), "city", "city_express", 8, 2, 5, { region: "jpcity", scene: "sea", water: 1 }],
  ["kobe", C("神戶 三宮", "神戸・三宮", "Kobe Sannomiya"), "city", "city_grid", 8, 3, 3.4, { region: "jpcity", scene: "sea", water: -1 }],
  ["sendai", C("仙台 定禪寺通", "仙台・定禅寺通", "Sendai Jozenji-dori"), "city", "city_avenue", 10, 1, 3.6, { region: "jpcity" }],
  ["hiroshima", C("廣島 平和大通", "広島・平和大通り", "Hiroshima Peace Blvd"), "city", "city_river", 10, 1, 3.8, { region: "jpcity", scene: "lake", water: 1 }],
  ["kokusai", C("那霸 國際通", "那覇・国際通り", "Naha Kokusai-dori"), "city", "city_grid", 7, 2, 3, { region: "jpcity" }],
  ["xinsheng", C("台北 新生高架", "台北・新生高架", "Taipei Xinsheng Viaduct"), "city", "city_express", 8, 2, 4.2, { region: "twcity", lm: "taipei" }],
  ["dadaocheng", C("台北 大稻埕河岸", "台北・大稲埕河岸", "Taipei Dadaocheng Riverside"), "city", "city_river", 8, 1, 3.6, { region: "twcity", lm: "taipei", scene: "lake", water: -1 }],
  ["qiqi", C("台中 七期市政路", "台中・七期 市政路", "Taichung Shizheng Rd"), "city", "city_avenue", 10, 1, 3.6, { region: "twcity" }],
  ["hsinchu", C("新竹 光復路", "新竹・光復路", "Hsinchu Guangfu Rd"), "city", "city_avenue", 9, 2, 3.8, { region: "twcity" }],
  ["anping", C("台南 安平", "台南・安平", "Tainan Anping"), "city", "city_river", 8, 1, 3.4, { region: "twcity", scene: "sea", water: 1 }],
  ["asianbay", C("高雄 亞洲新灣區", "高雄・亜洲新湾区", "Kaohsiung Asia New Bay"), "city", "city_river", 9, 1, 4, { region: "twcity", scene: "sea", water: -1 }]
];

function hash(str) { var h = 2166136261; for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h | 0; }

function pick(r, w) {
  var ids = Object.keys(w), tot = 0, i;
  for (i = 0; i < ids.length; i++) tot += w[ids[i]];
  var x = r() * tot;
  for (i = 0; i < ids.length; i++) { x -= w[ids[i]]; if (x < 0) return ids[i]; }
  return ids[0];
}

function cross(course) { return Core.trackInfo(Core.buildTrack(course, { seed: 1, season: "summer", rain: false })); }

// 城市：直線＋路口彎（棋盤街區是 90° 路口，半徑 14–22 m）；高架整段是橋面（D.SURFACES.bridge）
function cityPiece(r, prof) {
  var side = r() < 0.5 ? 1 : -1, x = r(), sf = prof === "city_express" ? "bridge" : undefined;
  function S(a, b) { var o = { t: "S", len: Math.round(a + r() * (b - a)), g: null }; if (sf) o.sf = sf; return o; }
  function Cc(ang, ra, rb) { var o = { t: "C", ang: ang * side, r: Math.round(ra + r() * (rb - ra)), g: null }; if (sf) o.sf = sf; return o; }
  if (prof === "city_grid") {
    if (x < 0.5) return [S(70, 200)];
    if (x < 0.85) return [Cc(90, 14, 22), S(40, 120)];
    return [Cc(35 + Math.round(r() * 20), 45, 80)];
  }
  if (prof === "city_avenue") {
    if (x < 0.55) return [S(160, 380)];
    if (x < 0.8) return [Cc(20 + Math.round(r() * 40), 80, 160)];
    return [Cc(90, 22, 30), S(60, 160)];
  }
  if (prof === "city_express") {
    if (x < 0.4) return [S(120, 320)];
    if (x < 0.85) return [Cc(25 + Math.round(r() * 55), 90, 220)];
    return [Cc(70 + Math.round(r() * 40), 45, 70)];
  }
  // city_river：沿著河的緩彎
  if (x < 0.5) return [S(80, 260)];
  return [Cc(15 + Math.round(r() * 35), 80, 200)];
}

function generate(def) {
  var w = PROFILES[def[3]], city = CITY_PROFILES.indexOf(def[3]) >= 0;
  for (var attempt = 0; attempt < 12; attempt++) {
    var r = Core.rng(hash(def[0]) + attempt * 7919);
    var course = { w: def[4], g: def[5], segs: [{ t: "S", len: 150, g: null }] };
    var target = def[6] * 1000, guard = 0, okRun = true;
    while (Core.courseLen(course) < target && guard++ < 120) {
      var best = null;
      for (var tries = 0; tries < 8; tries++) {
        var cand = city ? cityPiece(r, def[3]) : Core.expandPiece(pick(r, w), r() < 0.5 ? 1 : -1, null);
        var info = cross({ w: course.w, g: course.g, segs: course.segs.concat(cand) });
        if (!best || info.cross < best.cross) best = { segs: cand, cross: info.cross };
        if (info.cross === 0) break;
      }
      if (best.cross > 0) { okRun = false; break; }
      course.segs = course.segs.concat(best.segs);
    }
    if (!okRun) continue;
    var fin = cross(course);
    if (fin.cross === 0 && fin.drop > 0) return course;
  }
  throw new Error("generate failed: " + def[0]);
}

function segOut(s) {
  var a = s.t === "S" ? ["S", Math.round(s.len)] : ["C", Math.round(s.ang), Math.round(s.r)];
  if (s.g !== null && s.g !== undefined || s.sf) a.push(s.g === undefined ? null : s.g);
  if (s.sf) a.push(s.sf);
  return a;
}

var out = [];
var t0 = Date.now();
LIST.forEach(function (def) {
  var course = generate(def);
  var o = { id: def[0], cat: def[2], prof: def[3], name: def[1], w: def[4], g: def[5] };
  if (def[7]) { o.scene = def[7].scene; o.water = def[7].water; o.region = def[7].region; o.lm = def[7].lm; }
  o.segs = course.segs.map(segOut);
  out.push(o);
  process.stdout.write(def[0] + " " + (Core.courseLen(course) / 1000).toFixed(2) + "km " + course.segs.length + "段\n");
});

var lines = out.map(function (o) {
  var head = "    { id: " + JSON.stringify(o.id) + ", cat: " + JSON.stringify(o.cat) + ", prof: " + JSON.stringify(o.prof) +
    ", name: C(" + o.name.map(function (x) { return JSON.stringify(x); }).join(", ") + "), w: " + o.w + ", g: " + o.g +
    (o.scene ? ", scene: " + JSON.stringify(o.scene) + ", water: " + o.water : "") +
    (o.region ? ", region: " + JSON.stringify(o.region) : "") + (o.lm ? ", lm: " + JSON.stringify(o.lm) : "") + ",\n      segs: " + JSON.stringify(o.segs) + " }";
  return head;
});
var src = "// DÉJÀ VU 山道下坡（dejavu）：擴充固定山路（2026-10-26 第六批 10 → 102 條；2026-10-27 第九批加城市道路、第十批加日本／台灣為主的路線，共 " + (10 + out.length) + " 條）。在 dejavu_data.js 之後、dejavu_core.js 之前載入。\n" +
  "// 由 tools/dejavu_check/gen_courses.js 產生：依路線性格（prof）用零件接出來的風格化路線，只有名稱是真實地名，形狀不是實際測量。\n" +
  "// 可以直接手改 segs（格式同 dejavu_data.js 的 COURSES）；重新執行產生工具會覆蓋這個檔案。\n" +
  "(function () {\n  \"use strict\";\n\n  var root = typeof window !== \"undefined\" ? window : globalThis;\n  var D = root.PriTestDejavuData;\n  if (!D) return;\n" +
  "  var C = D.C;\n\n  // 路線性格（車庫／山路畫面顯示用，說明文字在 i18n 的 dv_prof_*）\n  D.COURSE_PROFILES = " + JSON.stringify(PROFILE_IDS.concat(CITY_PROFILES)) + ";\n\n" +
  "  [\n" + lines.join(",\n") + "\n  ].forEach(function (c) { D.COURSES.push(c); });\n})();\n";
fs.writeFileSync(path.join(__dirname, "../../static_src/dejavu_courses.js"), src);
console.log("寫入 " + out.length + " 條，耗時 " + ((Date.now() - t0) / 1000).toFixed(1) + " 秒");
