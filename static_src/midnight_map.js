// ============================================================================
// midnight（即時制擴張版・技術驗證片）地圖生成模組。
// ============================================================================
// 設計原則（見 docs/superpowers/plans... 不適用，這是全新專案，沒有既有規則文件）：
// 地圖不透過網路傳輸整張資料，只傳一個亂數種子（seed），每台裝置各自用同一個演算法
// 重新生成同一張地圖——只要種子與演算法一致，各裝置算出來的地圖保證逐格相同。
// 因此這裡的PRNG必須是「可種子化、決定性」的（跟一般的window.Math.random()不同，
// Math.random()無法指定種子，每次呼叫結果不可重現）。
//
// 簡易測試改版（2026-09-04）：地形本身改成一張寫死的固定佈局（不吃seed），seed只用來
// 決定「地圖上13個點（2~11各1點、K生成3點的抽牌結果）分別落在哪裡」以及「縮圈中心點
// 隨機落在右上／下方／左邊哪一個錨點」，兩者一樣透過同一個mulberry32(seed)序列衍生，
// 保證各裝置算出同樣結果。
(function () {
  "use strict";

  // mulberry32：輕量、決定性、品質足夠此用途的可種子化PRNG。輸入32位元整數種子，
  // 每次呼叫回傳[0,1)浮點數，同一種子＋同樣呼叫次數必定產生同樣序列。
  function mulberry32(seed) {
    var state = seed >>> 0;
    return function () {
      state = (state + 0x6d2b79f5) | 0;
      var t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  var GRID_SIZE = 48; // 48x48格
  var CELL_PX = 16; // 每格在canvas上的像素邊長（世界座標，非螢幕縮放後像素）
  // 開始地點：目前地圖上唯一有意義的固定基準點（原畫王城正上方的旗幟／橋樑處），
  // 用來保證「開始地點附近至少一個2~7類地點」。這不是玩家實際出生座標
  // （findWalkableSpawn()目前仍是全地圖隨機，不受此點影響），純粹是地圖敘事上的
  // 「起始點」基準，供地點生成規則參照。
  var START_CELL = { x: 22, y: 22 };
  var START_NEARBY_RADIUS = 6;

  // 簡易測試套用使用者提供的實際「origin」地圖原畫（photo/midnight/map_origin.jpg，
  // 已複製到static_src/images/maps/map_origin.jpg，由midnight.js畫成canvas背景），以及
  // 使用者在原畫上手繪標註三種邊界的版本（photo/midnight/map_origin_annotated.png，
  // 紅線＝可走邊界、黃線＝點位生成範圍、橘色＝王城事件範圍）。以下三份48x48資料是用
  // 程式對該標註圖做顏色比對（紅線RGB約(136,0,21)、黃線約(255,242,0)、橘色約
  // (255,127,39)，取與目標色距離小於門檻的像素）＋膨脹填補描線間的小縫隙＋
  // binary_fill_holes()取得每條封閉線圈起來的內部範圍＋侵蝕還原膨脹造成的外擴，
  // 才在原圖解析度下用「每格超過一半取樣點落在範圍內」downsample成48格——不是肉眼
  // 估座標手描，也不是程式runtime算出的幾何近似，因此精準對齊使用者實際畫的線。
  //   FIXED_GRID_ROWS：對應紅線（可走邊界）——牆＝紅線以外。橘色王城範圍不算牆（王城
  //     內部使用者確認也能進去，只是先記錄範圍，尚未串接任何王城事件邏輯）。
  //   POINT_ELIGIBLE_ROWS：對應黃線（點位生成範圍）扣掉橘色王城範圍——只有
  //     placePoints()用得到，不影響移動可行走判定，王城內部不生成一般點。
  //   CASTLE_ZONE_ROWS：對應橘色（王城事件範圍）。目前只保留範圍資料（見generateMap()
  //     回傳的castleZone），尚未有任何事件觸發行為——之後若要做「進入王城觸發事件」，
  //     應該以這份資料為基礎擴充，而不是重新描一次範圍。
  // 每一列是長度48的'0'/'1'字串，由上而下依序對應y=0..47。陸地內部其餘地形（森林、河流、
  // 湖泊、瀑布）目前不影響可行走判定，只在原畫背景上呈現視覺效果。如果之後origin原畫或
  // 使用者標註更新，應該重新跑一次顏色比對＋rasterize出新的三份資料，而不是手動微調
  // 字串內容。
  var FIXED_GRID_ROWS = [
    "111111111111111111111111111111111111111111111111",
    "111111111111111111111111111111111111111111111111",
    "111111111111111111111111111111111111111111111111",
    "111111111111111111111111111111111111111111111111",
    "111111111111111111111111111111111111111111111111",
    "111111111111111111111111111111111111111111111111",
    "111111111111111110001111111111111111111111111111",
    "111111110111111000000111111111111111111111111111",
    "111111000000000000000011100111100000000011111111",
    "111111000000000000000011000000000000000000111111",
    "111111000000000000000000000000000000000000011111",
    "111111000000000000000000000000000000000000011111",
    "111111000000000000000000000000000000000000111111",
    "111111000000000000000000000000000000000001111111",
    "111110000000000000000000000000000000000001111111",
    "111110000000000000000000000000000000000001111111",
    "111110000000000000000000000000000000000001111111",
    "111111000000000000000000000000000000000001111111",
    "111110000000000000000000000000000000000000111111",
    "111110000000000000000000000000000000000000111111",
    "111110000000000000000000000000000000000000111111",
    "111110000000000000000000000000000000000000111111",
    "111111000000000000000000000000000000000000111111",
    "111111000000000000000000000000000000000000111111",
    "111111000000000000000000000000000000000000111111",
    "111111000000000000000000000000000000000000111111",
    "111111000000000000000000000000000000000000111111",
    "111111000000000000000000000000000000000000111111",
    "111111000000000000000000000000000000000000111111",
    "111111000000000000000000000000000000000000111111",
    "111111100000000000000000000000000000000000111111",
    "111111110000000000000000000000000000000000111111",
    "111111110000000000000000000000000000000000111111",
    "111111100000000000000000000000000000000000111111",
    "111111100000000000000000000000000000000000111111",
    "111111100000000000000000000000000000000000111111",
    "111111100000000000000000000000000000000000111111",
    "111111100000000000000000000000000000000000111111",
    "111111100000000000000000000000000000000001111111",
    "111111100000000000000000000000000000000001111111",
    "111111110000000000000000000000000000000111111111",
    "111111110000000000000000000000001110001111111111",
    "111111111100000000000011100000111111111111111111",
    "111111111111111110011111110011111111111111111111",
    "111111111111111111111111111111111111111111111111",
    "111111111111111111111111111111111111111111111111",
    "111111111111111111111111111111111111111111111111",
    "111111111111111111111111111111111111111111111111",
  ];

  var POINT_ELIGIBLE_ROWS = [
    "000000000000000000000000000000000000000000000000",
    "000000000000000000000000000000000000000000000000",
    "000000000000000000000000000000000000000000000000",
    "000000000000000000000000000000000000000000000000",
    "000000000000000000000000000000000000000000000000",
    "000000000000000000000000000000000000000000000000",
    "000000000000000000000000000000000000000000000000",
    "000000000000000001110000000000000000000000000000",
    "000000000000011111111000000000000111100000000000",
    "000000001111111111111000011111111111111100000000",
    "000000011111111111111111111111111111111111000000",
    "000000011111111111111111111111111111111111000000",
    "000000011111111111111111111111111111111111000000",
    "000000111111111111111111111111111111111110000000",
    "000001111111111111111111111111111111111100000000",
    "000001111111111111111111111111111111111100000000",
    "000000111111111111111111111111111111111100000000",
    "000000111111111111111111111111111111111100000000",
    "000000111111111111111111111111111111111110000000",
    "000000111111111111111111111111111111111110000000",
    "000000111111111111111111111111111111111111000000",
    "000000111111111111111111111111111111111110000000",
    "000000111111111111111111111111111111111110000000",
    "000000111111111111111111111111111111111110000000",
    "000000111111111111111111111111111111111110000000",
    "000000011111111111100000011111111111111110000000",
    "000000011111111111100000011111111111111110000000",
    "000000011111111111100000011111111111111110000000",
    "000000011111111111100000011111111111111110000000",
    "000000011111111111100000111111111111111111000000",
    "000000001111111111111011111111111111111111000000",
    "000000000111111111111111111111111111111111000000",
    "000000001111111111111111111111111111111111000000",
    "000000001111111111111111111111111111111110000000",
    "000000001111111111111111111111111111111110000000",
    "000000001111111111111111111111111111111110000000",
    "000000001111111111111111111111111111111100000000",
    "000000001111111111111111111111111111111100000000",
    "000000001111111111111111111111111111111000000000",
    "000000001111111111111111111111111111110000000000",
    "000000000111111111111111111111100011000000000000",
    "000000000001111111111111001110000000000000000000",
    "000000000000000011110000000000000000000000000000",
    "000000000000000000000000000000000000000000000000",
    "000000000000000000000000000000000000000000000000",
    "000000000000000000000000000000000000000000000000",
    "000000000000000000000000000000000000000000000000",
    "000000000000000000000000000000000000000000000000",
  ];

  var CASTLE_ZONE_ROWS = [
    "000000000000000000000000000000000000000000000000",
    "000000000000000000000000000000000000000000000000",
    "000000000000000000000000000000000000000000000000",
    "000000000000000000000000000000000000000000000000",
    "000000000000000000000000000000000000000000000000",
    "000000000000000000000000000000000000000000000000",
    "000000000000000000000000000000000000000000000000",
    "000000000000000000000000000000000000000000000000",
    "000000000000000000000000000000000000000000000000",
    "000000000000000000000000000000000000000000000000",
    "000000000000000000000000000000000000000000000000",
    "000000000000000000000000000000000000000000000000",
    "000000000000000000000000000000000000000000000000",
    "000000000000000000000000000000000000000000000000",
    "000000000000000000000000000000000000000000000000",
    "000000000000000000000000000000000000000000000000",
    "000000000000000000000000000000000000000000000000",
    "000000000000000000000000000000000000000000000000",
    "000000000000000000000000000000000000000000000000",
    "000000000000000000000000000000000000000000000000",
    "000000000000000000000000000000000000000000000000",
    "000000000000000000000000000000000000000000000000",
    "000000000000000000000000000000000000000000000000",
    "000000000000000000000000000000000000000000000000",
    "000000000000000000000000000000000000000000000000",
    "000000000000000000011111100000000000000000000000",
    "000000000000000000011111100000000000000000000000",
    "000000000000000000011111100000000000000000000000",
    "000000000000000000011111100000000000000000000000",
    "000000000000000000011111000000000000000000000000",
    "000000000000000000000100000000000000000000000000",
    "000000000000000000000000000000000000000000000000",
    "000000000000000000000000000000000000000000000000",
    "000000000000000000000000000000000000000000000000",
    "000000000000000000000000000000000000000000000000",
    "000000000000000000000000000000000000000000000000",
    "000000000000000000000000000000000000000000000000",
    "000000000000000000000000000000000000000000000000",
    "000000000000000000000000000000000000000000000000",
    "000000000000000000000000000000000000000000000000",
    "000000000000000000000000000000000000000000000000",
    "000000000000000000000000000000000000000000000000",
    "000000000000000000000000000000000000000000000000",
    "000000000000000000000000000000000000000000000000",
    "000000000000000000000000000000000000000000000000",
    "000000000000000000000000000000000000000000000000",
    "000000000000000000000000000000000000000000000000",
    "000000000000000000000000000000000000000000000000",
  ];

  function decodeGridRows(rows, w, h) {
    var grid = new Uint8Array(w * h);
    for (var y = 0; y < h; y++) {
      var row = rows[y];
      for (var x = 0; x < w; x++) {
        grid[y * w + x] = row.charCodeAt(x) - 48;
      }
    }
    return grid;
  }

  function buildFixedGrid(w, h) {
    return decodeGridRows(FIXED_GRID_ROWS, w, h); // 1=牆 0=地板
  }

  function buildPointEligibleMask(w, h) {
    return decodeGridRows(POINT_ELIGIBLE_ROWS, w, h); // 1=可生成點 0=不可（含王城與貼牆緩衝區）
  }

  function buildCastleZoneMask(w, h) {
    return decodeGridRows(CASTLE_ZONE_ROWS, w, h); // 1=王城事件範圍（可走，尚未串接事件邏輯）
  }

  // 三天階段用的固定地點資料，依使用者在map_origin_annotated.png上第二輪標註（A／Z／F
  // 三種文字標籤＋白色曲線）描出，座標換算自1024x1035原圖：
  //   A（遊戲開始地點）：4個候選，Day1開局從其中選1個當起始位置。
  //   Z（黃金樹之帳，縮圈第一階段／第二階段的終點小圓位置）：5個候選。
  //   F（靈鳥，可在附近使用、沿白線自動飛到另一個地點）：6個，每個各自連到一個目的地
  //     （見SPIRIT_BIRD_LINKS）。白線在原圖上彼此靠近、部分端點重疊，起點/終點的精確
  //     連法是依人工描圖辨識最合理的走向配對，不是逐像素描出來的精確曲線——如果之後
  //     發現配對跟原意不符，應該重新核對annotated圖再修正這份資料，不用整個重寫。
  var A_CANDIDATES = [
    { id: "a_topright", x: 37, y: 11 },
    { id: "a_midleft", x: 8, y: 21 },
    { id: "a_bottomleft", x: 10, y: 38 },
    { id: "a_bottomright", x: 30, y: 38 },
  ];

  var Z_CANDIDATES = [
    { id: "z_topright", x: 33, y: 14 },
    { id: "z_topleft", x: 13, y: 14 },
    { id: "z_midleft", x: 10, y: 22 },
    { id: "z_center", x: 28, y: 30 },
    { id: "z_bottomleft", x: 18, y: 35 },
  ];

  // 每個F的目的地用grid座標直接指定（不是id參照Z/A，因為F6/F2互相對飛，目的地不一定是
  // Z或A本身）。座標修正紀錄（2026-09-04）：第一輪是肉眼描座標，使用者實測後指出多個
  // 目的地不夠精確；這次改用程式對白色線條像素做connected-component分析，取每條曲線
  // 上距離最遠的兩點當起點/終點（凸包上兩兩距離最大的一對），比肉眼判讀準確很多——
  // 曲線本身仍用簡單二次貝茲近似（controlX/controlY），不是逐像素還原原畫路徑。
  var SPIRIT_BIRD_LINKS = [
    { id: "f_topleft", x: 16, y: 12, toX: 31, toY: 13, controlX: 24, controlY: 7 },
    { id: "f_mid", x: 29, y: 17, toX: 14, toY: 20, controlX: 21, controlY: 13 },
    { id: "f_topright", x: 35, y: 16, toX: 30, toY: 32, controlX: 36, controlY: 25 },
    { id: "f_midleft", x: 14, y: 25, toX: 26, toY: 35, controlX: 17, controlY: 33 },
    { id: "f_bottomright", x: 34, y: 37, toX: 37, toY: 15, controlX: 43, controlY: 25 },
    { id: "f_bottomleft", x: 24, y: 37, toX: 10, toY: 19, controlX: 13, controlY: 33 },
  ];

  // 縮圈半徑常數（地圖生成/day plan跟session時間軸兩邊都要用到，所以放在這裡當唯一
  // 來源，midnight.js透過window.PriTestMidnightMap讀取，不要各自重複定義一份）：
  //   FULL_RADIUS：開放階段的滿版半徑＝地圖對角線長度，保證整張地圖都在圈內。
  //   MID_RADIUS：第一階段縮圈的中繼圓半徑＝終點小圓半徑的3倍（使用者指定「直徑三倍」，
  //     半徑同比例）。
  //   FINAL_RADIUS：終點小圓（黃金樹之帳）半徑。
  var FULL_RADIUS = Math.SQRT2 * GRID_SIZE;
  var FINAL_RADIUS = GRID_SIZE * 0.08;
  var MID_RADIUS = FINAL_RADIUS * 3;

  // 每個縮圈終點（黃金樹之帳）另外算一個「中繼圓中心」（midCenter）：使用者指定「第一
  // 階段的縮圈...中心不一定要是最終目的地」，所以第一階段（grace/shrink1/hold）用
  // midCenter當圓心，只有第二階段（shrink2）才讓圓心從midCenter內插移動到終點Z本身。
  // midCenter是Z往隨機方向偏移一段距離（上限＝MID_RADIUS-FINAL_RADIUS，這樣終點小圓
  // 一定完整落在中繼圓範圍內，shrink2才能連續地把範圍縮小到終點，不會忽然跳出中繼圓
  // 外）。用同一個seed衍生的rand算，各裝置結果一致。
  function offsetMidCenter(target, rand) {
    var maxOffset = MID_RADIUS - FINAL_RADIUS;
    var angle = rand() * Math.PI * 2;
    var dist = rand() * maxOffset;
    return {
      x: target.x + Math.cos(angle) * dist,
      y: target.y + Math.sin(angle) * dist,
    };
  }

  // 隨機決定Day1／Day2的起始地點與各自的縮圈終點（黃金樹之帳）：
  //   - Day1開始位置從A_CANDIDATES隨機選1個。
  //   - 從Z_CANDIDATES（5個）隨機取2個不重複的，分別當day1／day2的終點——每天只有
  //     「開放→縮到大圈→暫停→縮到小圈→停在小圈等玩家按下一天」這一輪，不是兩輪
  //     （這是2026-09-04第二次修正：使用者確認每天只有一個縮圈循環，不是phase A/B
  //     兩階段；先前版本誤把「兩天」拆成「兩天各兩階段」）。
  //   - Day2的開始位置＝Day1終點（「第一天結束的Z就是第二天的開始位置」），不是另外從
  //     A_CANDIDATES選——這樣Day2自然不會跟Day1用同一個開始點，且兩天終點彼此不同
  //     （「第二天的Z不會跟第一天一樣」自動成立，因為是從同一批不重複取樣出來的）。
  //   - 每個終點另外算一個midCenter（見offsetMidCenter()），給「縮到大圈」那一段用。
  function assignDayPlan(rand) {
    var day1Start = A_CANDIDATES[Math.floor(rand() * A_CANDIDATES.length)];
    var shuffled = Z_CANDIDATES.slice();
    for (var i = shuffled.length - 1; i > 0; i--) {
      var j = Math.floor(rand() * (i + 1));
      var tmp = shuffled[i];
      shuffled[i] = shuffled[j];
      shuffled[j] = tmp;
    }
    function withMidCenter(target) {
      return { id: target.id, x: target.x, y: target.y, midCenter: offsetMidCenter(target, rand) };
    }
    var day1End = withMidCenter(shuffled[0]);
    var day2End = withMidCenter(shuffled[1]);
    return {
      day1: { start: day1Start, end: day1End },
      day2: { start: day1End, end: day2End },
    };
  }

  // 每張牌對應的實際地點名稱／簡稱——直接沿用static_src/fields_data_1~4.js既有的
  // 「night」規則書地點名稱（cardLabel/name欄位），不是自己另外發明的地名，也不是
  // 通用的「祝福」分類。查詢方式：grep `cardLabel: "2"` 等找到對應card_2/card_3/...
  // 物件的name欄位。label是地圖圖標上顯示的簡稱（1字，互不重複，方便小圖標排版）。
  //   2  大教會   （fields_data_1.js card_2）
  //   3  小砦     （fields_data_2.js card_3）
  //   4  大野營地 （fields_data_2.js card_4）
  //   5  遺跡     （fields_data_2.js card_5）
  //   6  坑道／倒下的大結晶（fields_data_3.js card_6）
  //   7  湖沼     （fields_data_3.js card_7）
  //   8  鍛造村   （fields_data_3.js card_8）
  //   9  封牢／神殿（fields_data_3.js card_9）
  //   10 魔術師塔 （fields_data_4.js card_10）
  //   K  教會     （fields_data_4.js card_k）
  //   J  堡壘／地下堡壘（fields_data_4.js card_j）——對應地圖中央已固定存在的王城
  //     （castleZone），不額外隨機放置。
  var FIELD_CARD_NAMES = {
    "2": { zh: "大教會", label: "教" },
    "3": { zh: "小砦", label: "砦" },
    "4": { zh: "大野營地", label: "營" },
    "5": { zh: "遺跡", label: "遺" },
    "6": { zh: "坑道", label: "坑" },
    "7": { zh: "湖沼", label: "湖" },
    "8": { zh: "鍛造村", label: "鍛" },
    "9": { zh: "封牢", label: "封" },
    "10": { zh: "魔術師塔", label: "塔" },
    K: { zh: "教會", label: "會" },
    // J（堡壘）：地圖中央castleZone固定範圍，不透過placePoints()隨機生成，見
    // generateMap()回傳的castleCenter與midnight.js的drawCastleMarker()。名稱沿用
    // fields_data_4.js card_j的簡稱（「堡壘／地下堡壘」取前兩字），不是另外發明的。
    J: { zh: "堡壘", label: "堡" },
  };

  // 新籌碼點（非fields_data卡牌）的名稱表（2026-09-05籌碼優化新增）：commerce/強敵/
  // 隨機事件/祝福都不是fields_data_*.js的抽牌卡，因此不透過FIELD_CARD_NAMES查——
  // drawPointCard()判斷icon類型時用這份表取名稱標籤文字。強敵／隨機事件在被揭露前
  // 只顯示icon不顯示名稱（見midnight.js的updateNearbyChipPoint()相關渲染邏輯），
  // 祝福一開始就顯示名稱。
  var CHIP_TYPE_NAMES = {
    blessing: { zh: "祝福" },
    merchant: { zh: "商人" },
    strong_enemy: { zh: "強敵" },
    random_event: { zh: "隨機事件" },
  };

  // 抽牌對應的地點類型與數量（不含花色，每個點數固定對應一種地點類型，見上方
  // FIELD_CARD_NAMES）：
  //   2~7：各自獨立的地點類型，各2個（共12個，不是同一種「祝福」）
  //   8：鍛造村，1個
  //   9：封牢，3個
  //   10：魔術師塔，2或3個（用seed衍生的rand決定，不是固定值）
  //   K：教會，3個，分佈稀疏
  //   J（堡壘）：對應地圖中央已固定存在的王城（castleZone），不額外隨機放置。
  // 牌的抽取順序固定（不吃seed），實際隨機的只有每個點在地圖上的座標與10的數量，
  // 這樣各裝置只要seed一致，算出的點位置就會逐一相同。
  // K（教會）不在這裡的清單裡——它的「分佈稀疏」用placeChurchSectorSpread()的分區
  // 放置法達成（見下方），不是單純用最小間距做rejection sampling，因為3個點只互相
  // 保持最小間距，仍然可能3個都落在地圖同一側（純機率上完全合法但不符合「稀疏」的
  // 視覺意圖），分區放置才能保證每個教會落在地圖不同象限。
  //
  // 新籌碼點（2026-09-05新增，見docs之外的規劃紀錄）：不對應fields_data卡牌，type即代表
  // 籌碼種類本身（沒有card欄位語意，card直接沿用type字串當佔位，drawPointCard不會讀它）：
  //   merchant：商人，2個，用偏大的MIN_DIST_SAME_TYPE強制「彼此遠離」（使用者明確要求）。
  //   strong_enemy：強敵，3個。
  //   random_event：隨機事件（聖甲蟲），2個。
  //   blessing：祝福，10個（2026-09-05籌碼優化新增，使用者明確規格「大約分配10個」），
  //     散佈在各地，跟其他籌碼一樣只用最小間距rejection sampling，不特別分區。
  function buildPointRequests(rand) {
    var sorcererCount = rand() < 0.5 ? 2 : 3;
    var requests = [];
    ["2", "3", "4", "5", "6", "7"].forEach(function (card) {
      requests.push({ card: card, type: card });
      requests.push({ card: card, type: card });
    });
    requests.push({ card: "8", type: "forge" });
    for (var i = 0; i < 3; i++) requests.push({ card: "9", type: "evergaol" });
    for (var j = 0; j < sorcererCount; j++) requests.push({ card: "10", type: "sorcerer" });
    for (var k = 0; k < 2; k++) requests.push({ card: "merchant", type: "merchant" });
    for (var m = 0; m < 3; m++) requests.push({ card: "strong_enemy", type: "strong_enemy" });
    for (var n = 0; n < 2; n++) requests.push({ card: "random_event", type: "random_event" });
    for (var b = 0; b < 10; b++) requests.push({ card: "blessing", type: "blessing" });
    return requests;
  }

  // 同類型地點之間的最小間距（格）：2~7每個地點類型只有2個，要求「不密集配置」所以
  // 間距較大；其他類型沒有明確要求，用較小的間距避免完全重疊即可。不同類型之間一律用
  // MIN_DIST_DIFFERENT_TYPE，避免圖標互相重疊。教會（K）不使用這個表——它的間距在
  // placeChurchSectorSpread()內另外處理。merchant刻意設一個偏大值（地圖可行走範圍
  // 對角線量級的一半左右），讓兩個商人點盡量落在地圖兩側，不用另外設計分區演算法。
  var MIN_DIST_SAME_TYPE = {
    2: 5,
    3: 5,
    4: 5,
    5: 5,
    6: 5,
    7: 5,
    forge: 3,
    evergaol: 4,
    sorcerer: 4,
    merchant: 20,
    strong_enemy: 5,
    random_event: 5,
    blessing: 4,
  };
  var MIN_DIST_DIFFERENT_TYPE = 2;
  var CHURCH_COUNT = 3;
  var CHURCH_MIN_DIST = 6;

  function farEnoughFromPlaced(x, y, type, placed) {
    for (var i = 0; i < placed.length; i++) {
      var p = placed[i];
      var dx = p.x - x;
      var dy = p.y - y;
      var dist = Math.sqrt(dx * dx + dy * dy);
      var required = p.type === type ? MIN_DIST_SAME_TYPE[type] : MIN_DIST_DIFFERENT_TYPE;
      if (dist < required) return false;
    }
    return true;
  }

  // 王城範圍的重心座標（供J卡牌事件當作合成點物件的x/y使用，見updateNearbyCastle()）——
  // 用實際遮罩算平均座標，不是憑印象手動猜一個座標，這樣如果之後CASTLE_ZONE_ROWS的
  // 標註資料更新，這裡會自動跟著對，不用另外維護一份座標常數。
  function computeMaskCentroid(mask, w, h) {
    var sumX = 0;
    var sumY = 0;
    var count = 0;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        if (mask[y * w + x] === 1) {
          sumX += x;
          sumY += y;
          count++;
        }
      }
    }
    return count === 0 ? { x: w / 2, y: h / 2 } : { x: sumX / count + 0.5, y: sumY / count + 0.5 };
  }

  function generateMap(seed) {
    var rand = mulberry32(seed);
    var w = GRID_SIZE;
    var h = GRID_SIZE;
    var grid = buildFixedGrid(w, h);
    var pointEligible = buildPointEligibleMask(w, h);
    var castleZone = buildCastleZoneMask(w, h);
    var points = placePoints(grid, pointEligible, w, h, rand);
    var dayPlan = assignDayPlan(rand);
    return {
      seed: seed,
      width: w,
      height: h,
      cellPx: CELL_PX,
      grid: grid,
      points: points,
      castleZone: castleZone,
      castleCenter: computeMaskCentroid(castleZone, w, h),
      dayPlan: dayPlan,
    };
  }

  // pointEligible是黃線範圍（比可行走的紅線範圍更內縮，且已扣掉王城），點只會生成在
  // 這個範圍內，不是只要可行走（grid===0）就能生成——兩個條件都檢查是因為理論上黃線
  // 資料應該已經完全落在紅線可行走範圍內，但仍保留grid檢查當作保險，避免資料來源不
  // 一致時生成到牆上。
  //
  // 「開始地點附近至少一個2~7類地點」不是額外多生成一個，而是從buildPointRequests()
  // 產生的12個2~7需求中，挑第一個（固定是card"2"／大教會）優先在START_CELL半徑內
  // 放置，成功後其餘需求（包含剩下11個與其他類型）才照正常流程（不限定範圍、檢查
  // 同類型間距）放置——這樣2~7類地點總數維持規格要求的12個，且保證其中一定有一個在
  // 開始地點附近，而不是隨機生成完才檢查、失敗了還要重試整個流程。
  function placePoints(grid, pointEligible, w, h, rand) {
    var out = [];
    var guard = 0;

    function tryPlaceOne(card, type, withinStartRadius) {
      while (guard < 20000) {
        guard++;
        var x, y;
        if (withinStartRadius) {
          var angle = rand() * Math.PI * 2;
          var r = rand() * START_NEARBY_RADIUS;
          x = Math.round(START_CELL.x + Math.cos(angle) * r);
          y = Math.round(START_CELL.y + Math.sin(angle) * r);
          if (x < 0 || y < 0 || x >= w || y >= h) continue;
        } else {
          x = Math.floor(rand() * w);
          y = Math.floor(rand() * h);
        }
        var idx = y * w + x;
        if (grid[idx] !== 0 || pointEligible[idx] !== 1) continue;
        if (!farEnoughFromPlaced(x, y, type, out)) continue;
        out.push({ id: "pt" + out.length, card: card, type: type, x: x, y: y });
        return true;
      }
      return false;
    }

    var requests = buildPointRequests(rand);
    var firstIdx = -1;
    for (var i = 0; i < requests.length; i++) {
      if (requests[i].card === "2") {
        firstIdx = i;
        break;
      }
    }
    if (firstIdx >= 0) {
      var first = requests.splice(firstIdx, 1)[0];
      tryPlaceOne(first.card, first.type, true);
    }
    requests.forEach(function (req) {
      tryPlaceOne(req.card, req.type, false);
    });

    placeChurchSectorSpread(grid, pointEligible, w, h, rand, out);

    return out;
  }

  // 教會（K）「分佈稀疏」：把地圖以中心點分成CHURCH_COUNT個等角扇形（120度一份），
  // 每個扇形內各放1個教會，確保3個教會一定落在地圖的不同方位，而不是像其他類型單純用
  // 最小間距做rejection sampling那樣，機率上仍可能3個都聚在同一側。扇形內仍檢查最小
  // 間距／eligible／grid，只是把「往哪個方向找」限制在該扇形角度範圍內。
  function placeChurchSectorSpread(grid, pointEligible, w, h, rand, out) {
    var center = { x: w / 2, y: h / 2 };
    var maxRadius = Math.min(w, h) / 2;
    for (var s = 0; s < CHURCH_COUNT; s++) {
      var sectorStart = (s / CHURCH_COUNT) * Math.PI * 2;
      var sectorSize = (Math.PI * 2) / CHURCH_COUNT;
      var placed = false;
      var localGuard = 0;
      while (!placed && localGuard < 4000) {
        localGuard++;
        var angle = sectorStart + rand() * sectorSize;
        var radius = rand() * maxRadius;
        var x = Math.round(center.x + Math.cos(angle) * radius);
        var y = Math.round(center.y + Math.sin(angle) * radius);
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        var idx = y * w + x;
        if (grid[idx] !== 0 || pointEligible[idx] !== 1) continue;
        var farEnough = true;
        for (var i = 0; i < out.length; i++) {
          var p = out[i];
          var required = p.type === "church" ? CHURCH_MIN_DIST : MIN_DIST_DIFFERENT_TYPE;
          if (Math.hypot(p.x - x, p.y - y) < required) {
            farEnough = false;
            break;
          }
        }
        if (!farEnough) continue;
        out.push({ id: "pt" + out.length, card: "K", type: "church", x: x, y: y });
        placed = true;
      }
    }
  }

  // 王城事件範圍判定（2026-09-05 HUD優化新增：串接castleZone→J卡牌事件，見
  // buildPointRequests()附近註解「J（堡壘）：對應地圖中央已固定存在的王城」）。照抄
  // isWalkable()的寫法，只是改讀map.castleZone。
  function isCastleZone(map, x, y) {
    var gx = Math.floor(x);
    var gy = Math.floor(y);
    if (gx < 0 || gy < 0 || gx >= map.width || gy >= map.height) return false;
    return map.castleZone[gy * map.width + gx] === 1;
  }

  function isWalkable(map, x, y) {
    var gx = Math.floor(x);
    var gy = Math.floor(y);
    if (gx < 0 || gy < 0 || gx >= map.width || gy >= map.height) return false;
    return map.grid[gy * map.width + gx] === 0;
  }

  // 找一個可行走的隨機出生點（用同一個seed衍生的rand，各裝置算出相同結果，避免
  // 「大家都生成同一張地圖，但出生點卻各算各的」這種不一致）。
  function findWalkableSpawn(map, rand) {
    var guard = 0;
    while (guard < 5000) {
      guard++;
      var x = Math.floor(rand() * map.width);
      var y = Math.floor(rand() * map.height);
      if (isWalkable(map, x, y)) return { x: x + 0.5, y: y + 0.5 };
    }
    return { x: map.width / 2, y: map.height / 2 };
  }

  window.PriTestMidnightMap = {
    GRID_SIZE: GRID_SIZE,
    CELL_PX: CELL_PX,
    mulberry32: mulberry32,
    generateMap: generateMap,
    isWalkable: isWalkable,
    isCastleZone: isCastleZone,
    findWalkableSpawn: findWalkableSpawn,
    A_CANDIDATES: A_CANDIDATES,
    Z_CANDIDATES: Z_CANDIDATES,
    SPIRIT_BIRD_LINKS: SPIRIT_BIRD_LINKS,
    FULL_RADIUS: FULL_RADIUS,
    MID_RADIUS: MID_RADIUS,
    FINAL_RADIUS: FINAL_RADIUS,
    FIELD_CARD_NAMES: FIELD_CARD_NAMES,
    CHIP_TYPE_NAMES: CHIP_TYPE_NAMES,
  };
})();
