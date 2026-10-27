// 明星經紀 starV：宿敵明星 v2（rv011～rv020；規格 §9、§4）。kind: "rival" → 屬於對手公司，不進抽卡池。
// 對手引退、倒閉、新公司成立時從沒被占用的宿敵明星中補人，名錄越多，換人越不重複。ID 永不重用。
(function () {
  "use strict";

  var root = typeof window !== "undefined" ? window : globalThis;
  var T = root.PriTestStarvData.T;

  function rv(id, rarity, name, gender, age, dir, apt, stats, look, bio, skill) {
    return { id: id, kind: "rival", rarity: rarity, addedIn: "v2", debut: false, name: T(name), gender: gender, age: age, dir: dir,
      subDirs: [], apt: apt, stats: stats, traits: [], skill: skill || null, look: look, bio: T(bio) };
  }
  function A(s) { var k = ["act", "vocal", "dance", "talk", "charm", "sense"], o = {}; s.split("").forEach(function (c, i) { o[k[i]] = c; }); return o; }
  function S(arr) { return { act: arr[0], vocal: arr[1], dance: arr[2], talk: arr[3], charm: arr[4], sense: arr[5] }; }
  function L(face, hair, hairColor, eye, outfit, acc, skin) { return { face: face, hair: hair, hairColor: hairColor, eye: eye, outfit: outfit, acc: acc, skin: skin }; }

  root.PriTestStarvRoster.add([
    rv("rv011", "SR", "柏木沙耶|柏木 沙耶", "f", 26, "drama", A("ACCBAB"), S([150, 40, 45, 70, 130, 75]), L(3, 6, 1, 1, 2, 2, 0),
      "收視率保證的連續劇女王，三年內主演九部黃金檔。|視聴率保証のドラマ女王。三年でゴールデン主演九本。"),
    rv("rv012", "SR", "瀨戶拓真|瀬戸 拓真", "m", 24, "cm", A("BCCBAB"), S([90, 40, 60, 70, 170, 80]), L(1, 2, 3, 2, 5, -1, 0),
      "代言數量業界第一，便利商店裡到處都是他的臉。|CM 契約数は業界一。コンビニのどこを見ても彼の顔。"),
    rv("rv013", "SR", "冴島玲|冴島 玲", "f", 33, "anchor", A("CCCABB"), S([50, 40, 30, 180, 90, 130]), L(0, 7, 0, 0, 6, 1, 0),
      "以犀利提問聞名的主播，政治人物最怕上她的節目。|鋭い質問で知られるキャスター。政治家が最も恐れる番組。"),
    rv("rv014", "SR", "逢坂翼|逢坂 翼", "m", 27, "voice", A("ABCBBC"), S([170, 120, 40, 100, 60, 40]), L(2, 4, 7, 4, 4, 5, 0),
      "主角專業戶，一年配了二十部動畫的男主角。|主役専門。一年で二十本のアニメの主人公を演じた。"),
    rv("rv015", "SR", "Kiki|キキ", "f", 20, "influencer", A("CBCAAB"), S([40, 70, 60, 140, 150, 80]), L(3, 10, 5, 5, 0, 4, 0),
      "一支舞蹈挑戰影片被模仿了五百萬次。|ダンスチャレンジ動画が五百万回真似された。"),
    rv("rv016", "SR", "九條律|九条 律", "m", 35, "composer", A("CBCCCA"), S([30, 120, 30, 60, 70, 190]), L(2, 5, 0, 3, 6, 5, 1),
      "得獎無數的配樂大師，從不出席頒獎典禮。|受賞多数の作曲家。授賞式には一度も出ない。"),
    rv("rv017", "SR", "天城颯|天城 颯", "m", 20, "idol", A("CBACAC"), S([50, 110, 140, 60, 160, 40]), L(1, 4, 2, 3, 1, 3, 0),
      "男子偶像團體的不動 C 位，握手會排隊排到隔壁站。|男性アイドルグループの不動のセンター。握手会の列は隣の駅まで。"),
    rv("rv018", "SR", "Leon|レオン", "m", 28, "singer", A("CABBBA"), S([40, 170, 70, 60, 90, 100]), L(2, 3, 0, 2, 7, 1, 2),
      "海外出道後衣錦還鄉的歌手，用三種語言演唱。|海外デビュー後に凱旋した歌手。三か国語で歌う。"),
    rv("rv019", "SSR", "東雲司|東雲 司", "m", 32, "drama", A("SBBBAA"), S([200, 90, 80, 100, 170, 120]), L(2, 7, 0, 4, 6, -1, 1),
      "國民級男演員，他演的角色名字會變成那年的新生兒命名第一名。|国民的俳優。彼の役名はその年の赤ちゃんの名前ランキング一位になる。",
      { id: "rv_national", name: T("國民演員|国民的俳優"), desc: T("電視劇／電影表現 +20%|ドラマ・映画の表現 +20%"), fx: { perfDirs: { dirs: ["drama", "film"], v: 1.2 } } }),
    rv("rv020", "SSR", "Aria|アリア", "f", 23, "vtuber", A("BABSAA"), S([90, 160, 80, 200, 120, 150]), L(1, 11, 6, 5, 4, 0, 0),
      "全球訂閱數第一的虛擬歌姬，演唱會在元宇宙舉行。|世界登録者数一位のバーチャル歌姫。ライブはメタバースで開催。",
      { id: "rv_diva", name: T("虛擬歌姬|バーチャルディーヴァ"), desc: T("虛擬主播／歌手表現 +20%|VTuber・歌手の表現 +20%"), fx: { perfDirs: { dirs: ["vtuber", "singer"], v: 1.2 } } })
  ]);
})();
