// 明星經紀 starV：大型企劃 v1（5 件）。每個階段派 slots 範圍內的藝人，藝人的主方向或副方向要在 dirs 裡；
// 難度以 tier 的難度基準 × 1.1 計算；branch＝該階段結束後觸發的分歧事件（starv_events_4.js）。
(function () {
  "use strict";

  var root = typeof window !== "undefined" ? window : globalThis;
  var T = root.PriTestStarvData.T;

  function S(name, dirs, slots, tier, days, branch) { return { name: T(name), dirs: dirs, slots: slots, tier: tier, days: days, branch: branch || null }; }
  function P(id, name, desc, unlockLevel, cost, stages) { return { id: id, addedIn: "v1", name: T(name), desc: T(desc), unlockLevel: unlockLevel, cost: cost, stages: stages }; }
  var LIVE = ["singer", "idol", "dancer", "band"];

  root.PriTestStarvProjects.add([
    P("world_tour", "世界巡迴演唱會|ワールドツアー", "從排練到巨蛋終場，帶著旗下的歌手與偶像走遍世界。|リハーサルからドームのファイナルまで、歌手とアイドルを連れて世界を巡る。", 5, 300000, [
      S("排練|リハーサル", LIVE, [2, 5], "B", 10),
      S("亞洲站|アジア公演", LIVE, [3, 5], "A", 15, "proj_injury"),
      S("歐美站|欧米公演", LIVE, [3, 5], "A", 15, "proj_buzz"),
      S("巨蛋終場|ドームファイナル", LIVE, [3, 5], "S", 10)
    ]),
    P("own_variety", "自家冠名綜藝|冠バラエティ番組", "公司自己製作的綜藝節目，從企劃會議一路做到正式開播。|事務所が自ら制作するバラエティ。企画会議から本放送まで。", 5, 200000, [
      S("企劃會議|企画会議", ["host", "comedy", "anchor"], [1, 2], "B", 6),
      S("試播|パイロット版", ["host", "comedy", "influencer", "idol"], [2, 4], "A", 10, "proj_sponsor"),
      S("正式開播|本放送", ["host", "comedy", "influencer", "idol"], [2, 4], "A", 20, "proj_buzz")
    ]),
    P("intl_film", "國際影展合拍片|国際映画祭の合作映画", "和海外製作公司合拍，目標是國際影展的紅毯。|海外の制作会社と合作し、国際映画祭のレッドカーペットを目指す。", 6, 400000, [
      S("選角讀本|キャスティングと本読み", ["film", "drama", "stage"], [1, 3], "B", 8),
      S("海外拍攝|海外ロケ", ["film", "drama", "stage", "voice"], [2, 4], "A", 20, "proj_injury"),
      S("後製配樂|ポストプロダクション", ["composer", "voice"], [1, 2], "A", 10),
      S("影展首映|映画祭プレミア", ["film", "drama", "model", "cm"], [1, 3], "S", 5, "proj_sponsor")
    ]),
    P("music_fest", "大型音樂祭|大型音楽フェス", "連續三天的戶外音樂祭，從招商到壓軸之夜。|三日間の野外フェス。協賛集めから大トリの夜まで。", 7, 500000, [
      S("招商|協賛集め", ["cm", "model", "influencer"], [1, 2], "B", 8, "proj_sponsor"),
      S("DAY 1|DAY 1", ["singer", "band", "idol"], [3, 5], "A", 5),
      S("DAY 2|DAY 2", ["dancer", "idol", "vtuber"], [3, 5], "A", 5, "proj_injury"),
      S("壓軸之夜|大トリの夜", ["singer", "band"], [2, 5], "S", 5)
    ]),
    P("media_mix", "跨媒體企劃|メディアミックス企画", "原創動畫：劇本、配音、主題曲到首播活動一手包辦。|オリジナルアニメ：脚本、アフレコ、主題歌から初回放送イベントまで。", 8, 600000, [
      S("劇本與分鏡|脚本と絵コンテ", ["composer", "voice"], [1, 3], "A", 12),
      S("配音錄製|アフレコ", ["voice"], [2, 5], "A", 15, "proj_injury"),
      S("主題曲|主題歌", ["singer", "idol", "band"], [1, 3], "S", 8),
      S("首播活動|初回放送イベント", ["voice", "vtuber", "influencer"], [2, 4], "S", 6, "proj_buzz")
    ])
  ]);
})();
