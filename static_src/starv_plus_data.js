// 明星經紀 starV：增加遊戲性的七個系統的資料（2026-11-05 使用者指定「1-7 可以做」）。
//   1 藝人心願　2 季度經營目標　3 臨場決策　4 粉絲結構　5 藝人關係網　6 作品 IP 與續集　7 醜聞連鎖（事件在 starv_events_15.js）
// 只放數值與雙語文字；規則在 starv_plus.js，畫面在 starv_plus_ui.js。
(function () {
  "use strict";

  var root = typeof window !== "undefined" ? window : globalThis;
  var D = root.PriTestStarvData;
  var T = D.T;

  // ---- 數值 ----
  var BAL = {
    // 心願
    wishMax: 2, wishFirst: [3, 15], wishGap: [40, 90], wishLife: 300, wishLongDays: 150,
    wishSat: 20, wishFamePct: 0.05, wishFame: 50, wishCorePct: 0.03, wishFailSat: -8, wishLongSat: -2,
    // 季度目標
    goalCount: 3, goalTickets: 2, goalMoneyPerLv: 5000, goalRepPerLv: 40, goalAllTickets: 5, goalAllRepPerLv: 100,
    // 臨場決策：A／S 級工作，3 回合
    clutchTiers: ["A", "S"], clutchRounds: 3, clutchBest: 0.08, clutchMid: 0.02, clutchWorst: -0.05, clutchRushStamina: 4,
    // 粉絲
    coreStart: 0.05, coreMax: 0.6, coreDecay: 0.01, coreFromJob: 0.12, coreDecayShield: 0.8, coreDecayShieldMax: 0.5,
    antiDecay: 0.85, antiPrCut: 0.12, antiScandal: 10, antiFailJob: 4, antiPromoSpam: 3, antiPromoGap: 15, antiBadMultDiv: 80,
    clubFeePerCore: 0.5,
    // 關係
    bondFriend: 40, bondRival: -40, bondJobDay: 0.5, bondGreat: 4, bondSuccess: 1, bondFail: -3, bondCompete: -3, bondCohort: 2, bondChat: 1, bondDecay: 0.08,
    bondPerfMax: 0.1, duelBonus: 1.15, duelChance: 0.4, friendStress: 3, friendStressMax: 8, rivalStress: 2, rivalStressMax: 6,
    mentorChance: 0.3, mentorGain: 4, mentorRatio: 1.3, bondEventRival: 0.15, bondEventFriend: 0.08,
    // 作品 IP
    ipMinTier: "B", ipChance4: 0.25, ipChance5: 0.5, ipMax: 15, ipWait: 60, ipOfferChance: 0.02, ipPay: 1.3, ipFame: 1.3,
    ipCastBonus: 0.12, ipRecastPenalty: 0.06, ipFinal: 5, ipFinalRep: 300, adaptChance: 0.3,
    // 醜聞連鎖
    chainDays: 2
  };

  // ---- 1. 心願 ----
  // text 的參數：{tier} 等級、{dir} 方向、{n} 數量、{partner} 對象
  var WISHES = [
    { id: "lead", w: 10, text: T("想主演一部 {tier} 級以上的作品（成功以上）|{tier} 級以上の作品で主演したい（成功以上）") },
    { id: "great", w: 8, text: T("想在「{dir}」工作拿到大成功|「{dir}」の仕事で大成功を取りたい") },
    { id: "try", w: 7, text: T("想挑戰「{dir}」的工作|「{dir}」の仕事に挑戦したい") },
    { id: "fame", w: 9, text: T("想讓人氣達到 {n}|人気を {n} にしたい") },
    { id: "chart", w: 6, text: T("想登上月度排行榜前 10 名|月間ランキングのトップ 10 に入りたい") },
    { id: "trophy", w: 4, text: T("想在年度頒獎拿到獎座|年末の授賞式でトロフィーを取りたい") },
    { id: "star5", w: 5, text: T("想留下一部 ★5 的作品|★5 の作品を残したい") },
    { id: "duo", w: 6, text: T("想和 {partner} 一起工作|{partner} と一緒に仕事がしたい") },
    { id: "rest", w: 6, text: T("想好好放個長假（連續休息 4 天以上）|ゆっくり長い休みがほしい（4 日以上の休養）") },
    { id: "fanmeet", w: 6, text: T("想辦一場粉絲見面會|ファンミーティングを開きたい") },
    { id: "course", w: 6, text: T("想再多上 {n} 堂課精進自己|あと {n} 回レッスンを受けて腕を磨きたい") }
  ];

  // ---- 2. 季度目標 ----
  // minLv：公司等級門檻；text 的 {n}＝目標數量
  var GOALS = [
    { id: "hot", minLv: 1, text: T("完成 {n} 件本季熱門方向的工作（成功以上）|今季の人気ジャンルの仕事を {n} 件成功させる") },
    { id: "great", minLv: 1, text: T("工作大成功 {n} 次|仕事で大成功を {n} 回") },
    { id: "earn", minLv: 1, text: T("本季工作收入達到 {n}|今季の仕事の収入を {n} にする") },
    { id: "chart", minLv: 2, text: T("同一個月有 {n} 位自家藝人進入排行榜前 10|同じ月に自社タレント {n} 人がランキングのトップ 10 入り") },
    { id: "tierA", minLv: 4, text: T("完成 {n} 件 A 級以上的工作（成功以上）|A 級以上の仕事を {n} 件成功させる") },
    { id: "rlead", minLv: 3, text: T("讓一位 R 藝人在 B 級以上工作擔任主角並成功|R のタレントを B 級以上の主演で成功させる") },
    { id: "wishes", minLv: 1, text: T("實現 {n} 個藝人的心願|タレントの願いを {n} 個かなえる") },
    { id: "core", minLv: 1, text: T("核心粉絲總數增加 {n}|コアファンの合計を {n} 増やす") },
    { id: "clean", minLv: 1, keep: true, text: T("整季都沒有醜聞爆出壞結果|今季はスキャンダルで悪い結果を出さない") },
    { id: "rookie", minLv: 1, text: T("讓入社一年內的新人人氣達到 {n}|入社 1 年以内の新人の人気を {n} にする") },
    { id: "bond", minLv: 1, text: T("讓藝人之間結成 {n} 組好友|タレント同士で {n} 組の親友を作る") }
  ];

  // ---- 3. 臨場決策 ----
  // best＝最適合的策略、worst＝最不適合的；另外一個是普通。策略：steady 穩紮穩打／rush 全力衝刺／flair 發揮個性
  var STRATS = {
    steady: { icon: "🛡", name: T("穩紮穩打|堅実に"), hint: T("降低出錯風險|ミスを減らす") },
    rush: { icon: "🔥", name: T("全力衝刺|全力で攻める"), hint: T("賭一把，消耗體力|勝負に出る・体力を使う") },
    flair: { icon: "✨", name: T("發揮個性|個性を出す"), hint: T("看本人的特質與魅力|本人の個性次第") }
  };
  var SITS = [
    { id: "rewrite", best: "flair", worst: "steady", text: T("導演臨時改了整場戲的台詞！|監督が直前でシーンのセリフを全部変えた！") },
    { id: "light", best: "steady", worst: "rush", text: T("舞台燈光故障，現場一片混亂。|照明トラブルで現場が混乱している。") },
    { id: "rival", best: "rush", worst: "steady", text: T("對手公司的藝人在旁邊搶鏡頭。|ライバル事務所のタレントが横でカメラを奪いにくる。") },
    { id: "rain", best: "steady", worst: "flair", text: T("外景突然下大雨，大家都很狼狽。|ロケ中に突然の大雨、みんなずぶ濡れ。") },
    { id: "live", best: "rush", worst: "steady", text: T("現場直播觀看人數暴增，大家都在看！|生配信の視聴者が急増、みんな見ている！") },
    { id: "adlib", best: "flair", worst: "steady", text: T("對手演員突然即興演出。|共演者が突然アドリブを仕掛けてきた。") },
    { id: "tired", best: "steady", worst: "rush", text: T("連續拍攝到深夜，全員都很疲憊。|深夜まで撮影が続き、全員が疲れ切っている。") },
    { id: "climax", best: "rush", worst: "flair", text: T("最重要的高潮場面就在眼前。|一番大事なクライマックスの場面だ。") },
    { id: "critic", best: "steady", worst: "flair", text: T("知名評論家坐在第一排。|有名な評論家が最前列に座っている。") },
    { id: "fans", best: "flair", worst: "steady", text: T("台下滿滿都是熱情的粉絲。|客席は熱心なファンでいっぱい。") },
    { id: "prop", best: "flair", worst: "rush", text: T("重要的道具壞掉了，得想辦法補救。|大事な小道具が壊れた、なんとかしないと。") },
    { id: "nerve", best: "steady", worst: "rush", text: T("緊張到手心冒汗，心跳好快。|緊張で手に汗、心臓がバクバクしている。") },
    { id: "sponsor", best: "steady", worst: "flair", text: T("贊助商高層來現場視察。|スポンサーの役員が現場を視察に来た。") },
    { id: "encore", best: "rush", worst: "steady", text: T("觀眾大喊安可，氣氛沸騰！|観客のアンコールで会場が沸いている！") },
    { id: "silence", best: "flair", worst: "rush", text: T("全場突然安靜下來，所有人都在等。|会場が急に静まり、全員が待っている。") }
  ];

  // ---- 4. 粉絲行程（擴充 Core.schedule 的 kind） ----
  // cost：固定＋每公司等級；finish 的效果在 starv_plus.js
  var FAN_TASKS = {
    fanmeet: { icon: "🤝", days: 2, cost: 2000, costPerLv: 500, stamina: 15, stress: 4 },
    fanlive: { icon: "📱", days: 1, cost: 0, costPerLv: 0, stamina: 5, stress: 3 },
    merch: { icon: "🛍", days: 3, cost: 3000, costPerLv: 1000, stamina: 8, stress: 6 }
  };

  // ---- 6. 改編：原作方向 → 可以改編的方向 ----
  var ADAPT = {
    drama: ["film", "stage"], film: ["drama", "stage"], stage: ["film", "drama"], singer: ["film", "drama"],
    idol: ["drama", "film"], voice: ["film", "drama"], comedy: ["film", "host"], vtuber: ["voice", "drama"],
    band: ["film"], host: ["comedy"], composer: ["film"]
  };

  var X = { BAL: BAL, WISHES: WISHES, GOALS: GOALS, STRATS: STRATS, SITS: SITS, FAN_TASKS: FAN_TASKS, ADAPT: ADAPT };
  X.WISH_BY_ID = {}; WISHES.forEach(function (w) { X.WISH_BY_ID[w.id] = w; });
  X.GOAL_BY_ID = {}; GOALS.forEach(function (g) { X.GOAL_BY_ID[g.id] = g; });
  D.PLUS = X;
})();
