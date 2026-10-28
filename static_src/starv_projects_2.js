// 明星經紀 starV：大型企劃 v2（25 件，合計 30；計畫 10）。寫法同 starv_projects_1.js。
// 解鎖等級 3～10 分散：小企劃 2～3 階段、10～20 萬；超大企劃 4～5 階段、100～200 萬。branch＝階段結束後的分歧事件。
(function () {
  "use strict";

  var root = typeof window !== "undefined" ? window : globalThis;
  var T = root.PriTestStarvData.T;

  function S(name, dirs, slots, tier, days, branch) { return { name: T(name), dirs: dirs, slots: slots, tier: tier, days: days, branch: branch || null }; }
  function P(id, name, desc, unlockLevel, cost, stages) { return { id: id, addedIn: "v2", name: T(name), desc: T(desc), unlockLevel: unlockLevel, cost: cost, stages: stages }; }
  var LIVE = ["singer", "idol", "dancer", "band"];
  var ACT = ["film", "drama", "stage"];

  root.PriTestStarvProjects.add([
    // ---- Lv3 ----
    P("street_live", "街頭快閃演唱會|ゲリラライブ", "不事先公告，在車站前突然開唱。|予告なしに駅前で突然歌い出す。", 3, 100000, [
      S("場地交涉|場所の交渉", ["host", "influencer"], [1, 2], "C", 4),
      S("快閃演出|ゲリラ本番", LIVE, [2, 4], "B", 3, "proj_weather")
    ]),
    P("web_drama", "網路短劇|ウェブドラマ", "每集三分鐘的網路短劇，從劇本到上線一手包辦。|一話三分のウェブドラマ。脚本から配信まで自前で。", 3, 120000, [
      S("劇本|脚本", ["drama", "comedy"], [1, 2], "C", 5),
      S("拍攝|撮影", ["drama", "film", "influencer"], [2, 3], "B", 8, "proj_rewrite"),
      S("上線|配信開始", ["influencer", "vtuber"], [1, 2], "B", 3)
    ]),
    P("radio_drama", "廣播劇|ラジオドラマ", "深夜時段的廣播劇，靠聲音說完一整個故事。|深夜枠のラジオドラマ。声だけで一つの物語を語り切る。", 3, 150000, [
      S("讀本|本読み", ["voice", "stage"], [1, 3], "C", 4),
      S("錄音|収録", ["voice", "stage", "anchor"], [2, 4], "B", 6, "proj_equipment"),
      S("配樂|劇伴", ["composer"], [1, 1], "B", 4)
    ]),
    // ---- Lv4 ----
    P("morning_drama", "晨間劇|朝ドラ", "半年的晨間劇，全國觀眾每天早上八點準時收看。|半年間の朝ドラ。全国の視聴者が毎朝八時に見る。", 4, 200000, [
      S("選角|キャスティング", ["drama", "stage"], [1, 2], "B", 6),
      S("前半|前半", ["drama", "film", "cm"], [2, 4], "B", 15, "proj_fan_support"),
      S("後半|後半", ["drama", "film"], [2, 4], "A", 15, "proj_buzz")
    ]),
    P("vtuber_live", "虛擬演唱會|バーチャルライブ", "以 3D 模型站上虛擬舞台的大型演唱會。|3D モデルでバーチャルステージに立つ大型ライブ。", 4, 180000, [
      S("模型製作|モデル制作", ["vtuber", "composer"], [1, 2], "B", 8, "proj_equipment"),
      S("彩排|リハーサル", ["vtuber", "singer", "idol"], [2, 4], "B", 5),
      S("正式公演|本公演", ["vtuber", "singer"], [2, 4], "A", 4, "proj_buzz")
    ]),
    P("comedy_gp", "搞笑大賽|お笑いグランプリ", "年度搞笑大賽，從預賽一路殺到決賽。|年に一度のお笑いグランプリ。予選から決勝まで勝ち上がる。", 4, 160000, [
      S("預賽|予選", ["comedy"], [1, 3], "B", 5),
      S("準決賽|準決勝", ["comedy", "host"], [2, 3], "A", 5, "proj_creative_clash"),
      S("決賽|決勝", ["comedy"], [1, 2], "A", 3)
    ]),
    // ---- Lv5 ----
    P("fashion_week", "時尚週|ファッションウィーク", "國際品牌雲集的時尚週，從試裝到慶功派對。|海外ブランドが集うファッションウィーク。試着から打ち上げまで。", 5, 300000, [
      S("試裝|フィッティング", ["model", "cm"], [2, 4], "B", 6),
      S("走秀|ランウェイ", ["model", "dancer"], [3, 5], "A", 5, "proj_weather"),
      S("慶功派對|アフターパーティー", ["model", "influencer", "cm"], [2, 4], "A", 3, "proj_sponsor")
    ]),
    P("news_special", "新聞特別節目|報道特番", "三小時的新聞特別節目，從採訪到直播。|三時間の報道特番。取材から生放送まで。", 5, 250000, [
      S("採訪|取材", ["anchor", "host"], [1, 2], "B", 10, "proj_rewrite"),
      S("製作|制作", ["anchor", "composer"], [1, 3], "A", 8),
      S("直播|生放送", ["anchor", "host"], [1, 3], "A", 3, "proj_rival_release")
    ]),
    P("idol_debut", "偶像出道企劃|アイドルデビュー企画", "從選拔、集訓到出道舞台，打造新的偶像團體。|選抜、合宿、デビューステージ。新しいアイドルグループを生み出す。", 5, 280000, [
      S("選拔|選抜", ["idol", "dancer", "singer"], [3, 5], "B", 8, "proj_fan_support"),
      S("集訓|合宿", ["idol", "dancer"], [3, 5], "B", 12),
      S("出道舞台|デビューステージ", ["idol", "singer"], [3, 5], "A", 4, "proj_buzz")
    ]),
    // ---- Lv6 ----
    P("band_tour", "樂團全國巡迴|バンド全国ツアー", "錄完新專輯，帶著它跑遍全國的 Live House。|新アルバムを録って、それを携えて全国のライブハウスを回る。", 6, 350000, [
      S("錄製新專輯|新アルバム録音", ["band", "composer"], [2, 4], "A", 12, "proj_creative_clash"),
      S("巡迴前半|ツアー前半", ["band", "singer"], [2, 5], "A", 10, "proj_injury"),
      S("巡迴終站|ツアーファイナル", ["band", "singer"], [2, 5], "S", 4)
    ]),
    P("musical", "原創音樂劇|オリジナルミュージカル", "從作曲開始打造的原創音樂劇。|作曲から作り上げるオリジナルミュージカル。", 6, 400000, [
      S("作曲|作曲", ["composer"], [1, 2], "A", 10),
      S("排練|稽古", ["stage", "singer", "dancer"], [3, 5], "A", 15, "proj_injury"),
      S("首演|初演", ["stage", "singer", "dancer"], [3, 5], "S", 5, "proj_preview")
    ]),
    P("cooking_show", "料理對決節目|料理対決番組", "藝人與名廚對決的料理節目。|タレントと名シェフが対決する料理番組。", 6, 300000, [
      S("企劃|企画", ["host", "influencer"], [1, 2], "B", 6),
      S("錄影|収録", ["host", "comedy", "influencer"], [2, 4], "A", 10, "proj_cameo"),
      S("特別篇|特別編", ["host", "influencer"], [2, 3], "A", 4, "proj_sponsor")
    ]),
    // ---- Lv7 ----
    P("film_score", "電影配樂大作|映画音楽の大作", "替話題大片寫配樂，最後辦一場首映音樂會。|話題の大作映画の音楽を書き、最後にプレミア・コンサートを開く。", 7, 450000, [
      S("主題構想|テーマ構想", ["composer"], [1, 2], "A", 10, "proj_creative_clash"),
      S("錄音|レコーディング", ["composer", "band", "singer"], [2, 4], "A", 12),
      S("首映音樂會|プレミア・コンサート", ["composer", "singer", "band"], [2, 4], "S", 3, "proj_preview")
    ]),
    P("brand_collab", "網紅聯名商品|インフルエンサーのコラボ商品", "和品牌推出聯名商品，從企劃到開賣直播。|ブランドとコラボ商品を出す。企画から発売配信まで。", 7, 400000, [
      S("企劃|企画", ["influencer", "model"], [1, 2], "A", 8),
      S("拍攝宣傳|プロモーション撮影", ["influencer", "model", "cm"], [2, 4], "A", 8, "proj_sponsor"),
      S("開賣直播|発売記念配信", ["influencer", "vtuber", "host"], [2, 4], "S", 3, "proj_buzz")
    ]),
    P("sports_variety", "運動會綜藝|スポーツ大会バラエティ", "藝人們分隊比賽的運動會特別節目。|タレントがチームに分かれて競うスポーツ大会特番。", 7, 380000, [
      S("報名|エントリー", ["host", "comedy"], [1, 2], "B", 4),
      S("預賽|予選", ["dancer", "idol", "comedy"], [3, 5], "A", 6, "proj_injury"),
      S("決賽|決勝", ["dancer", "idol", "comedy", "host"], [3, 5], "A", 4, "proj_fan_support")
    ]),
    // ---- Lv8 ----
    P("taiga_drama", "大河劇|大河ドラマ", "播出一整年的歷史大劇。|一年かけて放送する歴史大作ドラマ。", 8, 700000, [
      S("選角|キャスティング", ACT, [2, 4], "A", 8),
      S("第一部|第一部", ["drama", "film"], [3, 5], "A", 20, "proj_weather"),
      S("第二部|第二部", ACT, [3, 5], "S", 20, "proj_rewrite"),
      S("完結篇|完結編", ["drama", "film"], [2, 5], "S", 8, "proj_buzz")
    ]),
    P("anime_film", "劇場版動畫|劇場版アニメ", "原創劇場版動畫，從劇本、配音、主題曲到上映。|オリジナル劇場版アニメ。脚本、アフレコ、主題歌から上映まで。", 8, 650000, [
      S("劇本|脚本", ["voice", "composer"], [1, 2], "A", 10, "proj_rewrite"),
      S("配音|アフレコ", ["voice"], [3, 5], "A", 12),
      S("主題曲|主題歌", ["singer", "band", "idol"], [1, 3], "S", 6),
      S("上映|公開", ["voice", "vtuber", "influencer"], [2, 4], "S", 4, "proj_rival_release")
    ]),
    P("global_cm", "國際廣告大片|国際広告キャンペーン", "跨國品牌的全球廣告，在三大洲同步上線。|多国籍ブランドの世界広告。三大陸で同時公開。", 8, 600000, [
      S("提案|プレゼン", ["cm", "model"], [1, 2], "A", 6),
      S("海外拍攝|海外ロケ", ["cm", "model", "film"], [2, 4], "S", 12, "proj_weather"),
      S("全球上線|世界同時公開", ["cm", "model", "influencer"], [2, 4], "S", 4, "proj_overseas_rights")
    ]),
    // ---- Lv9 ----
    P("year_end_fest", "年末歌謠祭|年末歌謡祭", "一年的最後一晚，全國收看的歌謠祭。|一年の最後の夜、全国が見る歌謡祭。", 9, 900000, [
      S("選曲|選曲", ["singer", "composer"], [1, 3], "A", 6),
      S("彩排|リハーサル", LIVE, [3, 5], "A", 6, "proj_injury"),
      S("前半|前半", ["singer", "idol"], [3, 5], "S", 3),
      S("壓軸|大トリ", ["singer", "band"], [2, 4], "S", 3, "proj_buzz")
    ]),
    P("hollywood", "進軍好萊塢|ハリウッド進出", "海外大片的主要角色，從試鏡到首映紅毯。|海外大作の主要キャスト。オーディションからプレミアのレッドカーペットまで。", 9, 1200000, [
      S("試鏡|オーディション", ["film", "drama"], [1, 2], "A", 10, "proj_overseas_rights"),
      S("拍攝|撮影", ACT, [2, 4], "S", 25, "proj_injury"),
      S("宣傳巡迴|プロモーションツアー", ["film", "model", "host"], [2, 4], "S", 8),
      S("首映|プレミア", ["film", "drama"], [1, 3], "S", 3, "proj_preview")
    ]),
    P("streaming_fest", "百萬人直播祭|百万人配信祭", "連續兩天的超大型直播祭，目標同時在線百萬人。|二日間の超大型配信祭。目標は同時接続百万人。", 9, 1000000, [
      S("籌備|準備", ["vtuber", "influencer"], [2, 3], "A", 8, "proj_equipment"),
      S("第一天|DAY 1", ["vtuber", "influencer", "singer"], [3, 5], "S", 3),
      S("第二天|DAY 2", ["vtuber", "comedy", "host"], [3, 5], "S", 3, "proj_rival_release"),
      S("閉幕|フィナーレ", ["vtuber", "singer", "idol"], [3, 5], "S", 3)
    ]),
    // ---- Lv10 ----
    P("dome_tour", "五大巨蛋巡迴|五大ドームツアー", "五座巨蛋連續公演，事務所的頂點。|五大ドーム連続公演。事務所の頂点。", 10, 1600000, [
      S("排練|リハーサル", LIVE, [3, 5], "A", 10),
      S("東之巨蛋|東のドーム", LIVE, [3, 5], "S", 5, "proj_injury"),
      S("西之巨蛋|西のドーム", LIVE, [3, 5], "S", 5, "proj_fan_support"),
      S("北之巨蛋|北のドーム", LIVE, [3, 5], "S", 5),
      S("終站巨蛋|ファイナルドーム", LIVE, [3, 5], "S", 5, "proj_buzz")
    ]),
    P("world_expo", "世界博覽會開幕式|万博開会式", "全世界轉播的博覽會開幕式演出。|全世界に中継される万博開会式の演出。", 10, 1800000, [
      S("演出構成|演出構成", ["stage", "composer", "dancer"], [2, 4], "A", 12, "proj_creative_clash"),
      S("彩排|リハーサル", ["stage", "dancer", "singer"], [3, 5], "S", 10, "proj_weather"),
      S("開幕式|開会式", ["singer", "dancer", "stage", "host"], [3, 5], "S", 3, "proj_preview")
    ]),
    P("legend_film", "傳說的電影|伝説の映画", "賭上事務所一切的電影大作，目標是影史留名。|事務所のすべてを懸けた映画大作。目指すは映画史に残る一本。", 10, 2000000, [
      S("籌備|準備", ["film", "composer"], [2, 3], "S", 10, "proj_budget"),
      S("拍攝|撮影", ACT, [3, 5], "S", 30, "proj_cameo"),
      S("後製|ポストプロダクション", ["composer", "voice"], [1, 3], "S", 10),
      S("影展|映画祭", ["film", "model", "drama"], [2, 4], "S", 4, "proj_overseas_rights")
    ]),
    P("agency_fest", "事務所感謝祭|事務所感謝祭", "旗下所有藝人齊聚一堂的感謝祭。|所属タレントが一堂に会する感謝祭。", 10, 1500000, [
      S("企劃|企画", ["host", "comedy", "influencer"], [2, 3], "A", 6),
      S("第一部　音樂|第一部　音楽", LIVE, [3, 5], "S", 3, "proj_fan_support"),
      S("第二部　戲劇|第二部　お芝居", ["film", "drama", "stage", "comedy"], [3, 5], "S", 3, "proj_cameo"),
      S("終幕|フィナーレ", ["singer", "idol", "host", "comedy"], [3, 5], "S", 3, "proj_buzz")
    ])
  ]);
})();
