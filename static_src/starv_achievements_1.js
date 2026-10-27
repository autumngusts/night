// 明星經紀 starV：成就 v1（20 項）。cond.type 見 starv_core.js 的 ACH_CHECKS。
(function () {
  "use strict";

  var root = typeof window !== "undefined" ? window : globalThis;
  var T = root.PriTestStarvData.T;

  function A(id, name, desc, type, n, tickets) {
    return { id: id, addedIn: "v1", name: T(name), desc: T(desc), cond: { type: type, n: n }, reward: { tickets: tickets } };
  }

  root.PriTestStarvAchievements.add([
    A("first_pull", "星探出動|スカウト始動", "累計招募 10 次|累計 10 回スカウト", "pulls", 10, 2),
    A("pulls_100", "百人面試官|百人面接官", "累計招募 100 次|累計 100 回スカウト", "pulls", 100, 5),
    A("first_ssr", "命運的相遇|運命の出会い", "第一次招募到 SSR|初めて SSR をスカウト", "ssr", 1, 5),
    A("codex_half", "星光收藏家|スターコレクター", "SR／SSR 圖鑑收集一半|SR／SSR 図鑑を半分収集", "codexRate", 0.5, 10),
    A("level_3", "小有名氣|ちょっと有名", "公司升到 Lv3|事務所 Lv3 到達", "level", 3, 3),
    A("level_6", "業界中堅|業界の中堅", "公司升到 Lv6|事務所 Lv6 到達", "level", 6, 6),
    A("level_10", "頂尖經紀公司|トップ事務所", "公司升到 Lv10|事務所 Lv10 到達", "level", 10, 10),
    A("artists_20", "大家庭|大家族", "旗下藝人達到 20 人|所属タレント 20 人", "artists", 20, 3),
    A("artists_100", "百星齊聚|百花繚乱", "旗下藝人達到 100 人|所属タレント 100 人", "artists", 100, 10),
    A("money_1m", "百萬富翁|百万長者", "資金達到 100 萬|資金 100 万到達", "money", 1000000, 5),
    A("jobs_100", "勤勉經紀|勤勉なマネジメント", "累計完成 100 件工作|累計 100 件の仕事", "jobs", 100, 3),
    A("jobs_1000", "千錘百鍊|千錘百錬", "累計完成 1,000 件工作|累計 1,000 件の仕事", "jobs", 1000, 8),
    A("great_s", "巨星的證明|大スターの証", "S 級工作大成功|S ランクの仕事で大成功", "greatS", 1, 8),
    A("chart_top", "排行榜冠軍|チャート 1 位", "第一次拿下排行榜第 1 名|初めてランキング 1 位", "chartTops", 1, 3),
    A("chart_top_12", "常勝軍|常勝軍団", "累計拿下排行榜第 1 名 12 次|ランキング 1 位を累計 12 回", "chartTops", 12, 8),
    A("first_trophy", "第一座獎座|初めてのトロフィー", "第一次在頒獎典禮得獎|授賞式で初受賞", "trophies", 1, 5),
    A("trophies_50", "獎座牆|トロフィーの壁", "累計得獎 50 座|累計 50 冠", "trophies", 50, 10),
    A("hof_1", "傳說的開始|伝説の始まり", "第一位藝人進入名人堂|初めての殿堂入り", "hof", 1, 5),
    A("group_100", "最佳拍檔|最高の相棒", "一個組合合作 100 次|一つのユニットで共演 100 回", "groupJobs", 100, 5),
    A("era_2", "新紀元|新時代", "開創第 2 紀元|第 2 紀元を開く", "era", 2, 10)
  ]);
})();
