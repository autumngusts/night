// 明星經紀 starV：排行榜與頒獎典禮的定義（規格 §9、§10）。資料驅動：新增方向時只要在 dirs 補上，核心不需要改。
// kind：person 個人／work 作品／rookie 新人／group 團體／company 公司。gender 限定男女；by:"fame" 依人氣；filter:"veteran" 資深。
(function () {
  "use strict";

  var root = typeof window !== "undefined" ? window : globalThis;
  var D = root.PriTestStarvData;
  var T = D.T;

  var CHARTS = [
    { id: "single", name: T("單曲榜|シングルチャート"), dirs: ["singer", "band", "idol", "composer", "dancer"] },
    { id: "ratings", name: T("收視率榜|視聴率ランキング"), dirs: ["drama", "host", "comedy", "anchor", "vtuber", "influencer"] },
    { id: "boxoffice", name: T("票房榜|興行収入ランキング"), dirs: ["film", "stage", "voice", "cm", "model"] },
    { id: "popularity", name: T("人氣榜|人気ランキング"), dirs: null }
  ];

  var CEREMONIES = [
    { id: "film", name: T("金影獎|金影賞") },
    { id: "tv", name: T("金視獎|金視賞") },
    { id: "melody", name: T("金韻獎|金韻賞") },
    { id: "stage", name: T("舞台藝術獎|舞台芸術賞") },
    { id: "media", name: T("新媒體大賞|ニューメディア大賞") },
    { id: "fashion", name: T("時尚廣告大賞|ファッション広告大賞") },
    { id: "special", name: T("年度特別獎|年間特別賞") }
  ];

  function A(id, ceremony, name, dirs, kind, extra) {
    var o = { id: id, ceremony: ceremony, name: T(name), dirs: dirs, kind: kind };
    Object.keys(extra || {}).forEach(function (k) { o[k] = extra[k]; });
    return o;
  }
  var M = { gender: "m" }, F = { gender: "f" };
  var AWARDS = [
    A("film_actor", "film", "最佳男主角|最優秀主演男優賞", ["film"], "person", M),
    A("film_actress", "film", "最佳女主角|最優秀主演女優賞", ["film"], "person", F),
    A("film_sup_actor", "film", "最佳男配角|最優秀助演男優賞", ["film"], "person", M),
    A("film_sup_actress", "film", "最佳女配角|最優秀助演女優賞", ["film"], "person", F),
    A("film_best", "film", "最佳影片|最優秀作品賞", ["film"], "work"),
    A("film_jury", "film", "評審團特別獎|審査員特別賞", ["film", "stage"], "work"),
    A("film_rookie", "film", "最佳新人|新人賞", ["film"], "rookie"),
    A("film_score", "film", "最佳原創配樂|最優秀音楽賞", ["composer"], "work"),

    A("drama_actor", "tv", "戲劇男主角獎|ドラマ主演男優賞", ["drama"], "person", M),
    A("drama_actress", "tv", "戲劇女主角獎|ドラマ主演女優賞", ["drama"], "person", F),
    A("drama_sup", "tv", "戲劇配角獎|ドラマ助演賞", ["drama"], "person"),
    A("drama_best", "tv", "最佳戲劇|最優秀ドラマ賞", ["drama"], "work"),
    A("host_best", "tv", "最佳主持人|最優秀司会者賞", ["host"], "person"),
    A("variety_best", "tv", "最佳綜藝節目|最優秀バラエティ賞", ["host", "comedy"], "work"),
    A("anchor_best", "tv", "最佳主播|最優秀キャスター賞", ["anchor"], "person"),
    A("news_best", "tv", "最佳新聞節目|最優秀報道番組賞", ["anchor"], "work"),
    A("comedy_best", "tv", "搞笑大賞|お笑い大賞", ["comedy"], "person"),
    A("drama_rookie", "tv", "戲劇新人獎|ドラマ新人賞", ["drama"], "rookie"),
    A("variety_rookie", "tv", "綜藝新人獎|バラエティ新人賞", ["host", "comedy", "anchor"], "rookie"),

    A("singer_m", "melody", "最佳男歌手|最優秀男性歌手賞", ["singer"], "person", M),
    A("singer_f", "melody", "最佳女歌手|最優秀女性歌手賞", ["singer"], "person", F),
    A("idol_best", "melody", "最佳偶像|最優秀アイドル賞", ["idol"], "person"),
    A("band_vocal", "melody", "最佳樂團主唱|最優秀バンドボーカル賞", ["band"], "person"),
    A("composer_best", "melody", "最佳作曲|最優秀作曲賞", ["composer"], "person"),
    A("dance_group", "melody", "最佳舞團|最優秀ダンスグループ賞", ["dancer"], "group"),
    A("band_best", "melody", "最佳樂團|最優秀バンド賞", ["band"], "group"),
    A("duet_best", "melody", "最佳合唱|最優秀デュエット賞", ["singer", "idol"], "group"),
    A("album", "melody", "年度專輯|年間最優秀アルバム賞", ["band", "singer"], "work"),
    A("single", "melody", "年度單曲|年間最優秀シングル賞", ["singer", "idol"], "work"),
    A("concert_best", "melody", "最佳演唱會|最優秀ライブ賞", ["idol", "dancer", "singer"], "work"),
    A("music_rookie", "melody", "最佳新人|最優秀新人賞", ["singer", "idol", "band"], "rookie"),

    A("stage_actor", "stage", "最佳舞台劇演員|最優秀舞台俳優賞", ["stage"], "person"),
    A("stage_best", "stage", "最佳舞台劇|最優秀舞台作品賞", ["stage"], "work"),
    A("choreo_best", "stage", "最佳編舞|最優秀振付賞", ["dancer"], "person"),
    A("stage_rookie", "stage", "劇場新人獎|劇場新人賞", ["stage"], "rookie"),

    A("vtuber_best", "media", "年度虛擬主播|年間最優秀 VTuber 賞", ["vtuber"], "person"),
    A("influencer_best", "media", "年度網紅|年間最優秀インフルエンサー賞", ["influencer"], "person"),
    A("voice_best", "media", "最佳聲優|最優秀声優賞", ["voice"], "person"),
    A("voice_work", "media", "最佳配音作品|最優秀アニメ作品賞", ["voice"], "work"),
    A("channel_best", "media", "年度最佳頻道|年間最優秀チャンネル賞", ["vtuber", "influencer"], "work"),
    A("game_stream", "media", "最佳遊戲直播|最優秀ゲーム配信賞", ["vtuber"], "work"),
    A("media_rookie", "media", "新星獎|新星賞", ["vtuber", "influencer", "voice"], "rookie"),

    A("cm_face", "fashion", "年度代言人|年間最優秀 CM タレント賞", ["cm"], "person"),
    A("cm_work", "fashion", "最佳廣告作品|最優秀 CM 作品賞", ["cm"], "work"),
    A("model_best", "fashion", "年度模特兒|年間最優秀モデル賞", ["model"], "person"),
    A("runway_best", "fashion", "最佳時裝秀|最優秀ファッションショー賞", ["model"], "work"),
    A("cover_star", "fashion", "年度封面人物|年間カバースター賞", ["model", "cm"], "person"),
    A("model_rookie", "fashion", "伸展台新人獎|ランウェイ新人賞", ["model"], "rookie"),

    A("artist_of_year", "special", "年度藝人大賞|年間最優秀タレント大賞", null, "person"),
    A("rookie_of_year", "special", "年度最佳新人|年間最優秀新人賞", null, "rookie"),
    A("group_of_year", "special", "最佳組合|最優秀ユニット賞", null, "group"),
    A("agency_of_year", "special", "年度經紀公司|年間最優秀事務所賞", null, "company"),
    A("buzz_award", "special", "最具話題獎|話題賞", null, "person", { by: "fame" }),
    A("fan_choice", "special", "人氣票選獎|ファン投票賞", null, "person", { by: "fame" }),
    A("lifetime", "special", "終身成就獎|功労賞", null, "person", { filter: "veteran" })
  ];

  var BY_ID = {};
  AWARDS.forEach(function (aw) { BY_ID[aw.id] = aw; });
  D.CHARTS = CHARTS;
  D.CEREMONIES = CEREMONIES;
  D.AWARDS = AWARDS;
  D.AWARD_BY_ID = BY_ID;
})();
