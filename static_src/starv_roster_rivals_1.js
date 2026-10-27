// 明星經紀 starV：宿敵明星首批（規格 §9、§4）。kind: "rival" → 屬於對手公司，不進抽卡池；
// 對手倒閉時可能流入玩家公司（以 rarity 當作入社的稀有度）。擴充時新增 starv_roster_rivals_2.js，ID rv### 永不重用。
(function () {
  "use strict";

  var root = typeof window !== "undefined" ? window : globalThis;
  var T = root.PriTestStarvData.T;

  function rv(id, rarity, name, gender, age, dir, apt, stats, look, bio, skill) {
    return { id: id, kind: "rival", rarity: rarity, addedIn: "v1", debut: false, name: T(name), gender: gender, age: age, dir: dir,
      subDirs: [], apt: apt, stats: stats, traits: [], skill: skill || null, look: look, bio: T(bio) };
  }
  function A(s) { var k = ["act", "vocal", "dance", "talk", "charm", "sense"], o = {}; s.split("").forEach(function (c, i) { o[k[i]] = c; }); return o; }
  function S(arr) { return { act: arr[0], vocal: arr[1], dance: arr[2], talk: arr[3], charm: arr[4], sense: arr[5] }; }
  function L(face, hair, hairColor, eye, outfit, acc, skin) { return { face: face, hair: hair, hairColor: hairColor, eye: eye, outfit: outfit, acc: acc, skin: skin }; }

  root.PriTestStarvRoster.add([
    rv("rv001", "SR", "黑澤凜|黒澤 凛", "f", 23, "singer", A("CABBAB"), S([40, 150, 70, 60, 110, 90]), L(1, 8, 0, 3, 7, 2, 0),
      "以冷豔歌聲橫掃排行榜的歌姬，從不在節目上笑。|クールな歌声でチャートを席巻する歌姫。番組で笑ったことがない。"),
    rv("rv002", "SR", "葉天朗|葉 天朗", "m", 26, "film", A("ACBBAB"), S([160, 40, 60, 70, 140, 80]), L(2, 4, 1, 4, 5, -1, 1),
      "影帝候選常客，拍戲時從不用替身。|主演男優賞の常連候補。スタントを一切使わない。"),
    rv("rv003", "SR", "月島光|月島 ひかり", "f", 19, "idol", A("CBASAC"), S([40, 110, 140, 70, 160, 40]), L(3, 10, 4, 4, 0, 0, 0),
      "國民偶像團體的絕對中心。|国民的アイドルグループの絶対的センター。"),
    rv("rv004", "SR", "嚴正浩|厳 正浩", "m", 31, "host", A("CCCSBA"), S([60, 50, 40, 170, 100, 130]), L(0, 1, 0, 0, 6, 1, 2),
      "收視保證的王牌主持人，毒舌出了名。|視聴率保証のエース司会者。毒舌で有名。"),
    rv("rv005", "SR", "Lumi|ルミ", "f", 21, "vtuber", A("BACABS"), S([70, 130, 40, 150, 60, 160]), L(1, 11, 7, 5, 4, 4, 0),
      "訂閱數破百萬的虛擬主播，真實身分成謎。|登録者百万人超えの VTuber。中の人は謎。"),
    rv("rv006", "SR", "Rex|レックス", "m", 24, "dancer", A("CCSBAB"), S([50, 60, 180, 60, 120, 90]), L(2, 3, 5, 3, 1, 5, 3),
      "街舞世界大賽冠軍，舞團的靈魂人物。|ストリートダンス世界大会の覇者。グループの中心人物。"),
    rv("rv007", "SR", "白川雪乃|白川 雪乃", "f", 28, "stage", A("SBABAB"), S([170, 100, 120, 60, 100, 70]), L(0, 7, 4, 1, 6, -1, 0),
      "劇場界的女王，一張票難求。|劇場界の女王。チケットは即日完売。"),
    rv("rv008", "SR", "趙大雷|趙 大雷", "m", 34, "comedy", A("BCCSBA"), S([90, 40, 50, 170, 70, 140]), L(3, 0, 0, 2, 3, -1, 2),
      "搞笑大賽三連霸的漫才師。|お笑いグランプリ三連覇の漫才師。"),
    rv("rv009", "SSR", "神宮寺皇|神宮寺 皇", "m", 29, "band", A("BSBBSA"), S([90, 190, 100, 80, 180, 150]), L(2, 5, 0, 3, 7, 5, 1),
      "傳奇樂團的主唱，演唱會門票秒殺。|伝説のバンドのボーカル。ライブのチケットは秒で完売。",
      { id: "rv_rockstar", name: T("搖滾之神|ロックの神"), desc: T("樂團表現 +20%|バンドの表現 +20%"), fx: { perfDirs: { dirs: ["band"], v: 1.2 } } }),
    rv("rv010", "SSR", "花宮麗華|花宮 麗華", "f", 25, "model", A("BBACSB"), S([100, 90, 140, 60, 200, 110]), L(3, 9, 3, 1, 7, 0, 0),
      "巴黎時裝週的常客，品牌搶著簽。|パリコレの常連。ブランドが奪い合う存在。",
      { id: "rv_runway", name: T("伸展台女王|ランウェイの女王"), desc: T("模特兒、廣告表現 +20%|モデル・CM の表現 +20%"), fx: { perfDirs: { dirs: ["model", "cm"], v: 1.2 } } })
  ]);
})();
