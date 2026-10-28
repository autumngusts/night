// 明星經紀 starV：特性 v2（75 種，合計 100；規格 §3.2）。fx 只用 core 支援的修正鍵：
// growth growthCourse growthTrain stress stamina fame perf pay eventRate perfDirs，以及計畫 10 新增的
// growthStats{stats,v} salary satDrift badLuck fameDecay chem。id 一律以 t_ 開頭，永不重用。
(function () {
  "use strict";

  var root = typeof window !== "undefined" ? window : globalThis;
  var D = root.PriTestStarvData;
  var T = D.T;

  function dirs(list, v) { return { dirs: list, v: v }; }
  function stats(list, v) { return { stats: list, v: v }; }
  function trait(id, name, desc, fx) { return { id: id, name: T(name), desc: T(desc), fx: fx }; }

  [
    // ---- 單一能力成長 ----
    trait("t_actor_eye", "觀察入微|観察眼", "演技成長 +30%|演技の成長 +30%", { growthStats: stats(["act"], 1.3) }),
    trait("t_drama_queen", "戲精|ドラマクイーン", "演技成長 +40%、壓力累積 +15%|演技の成長 +40%、ストレス +15%", { growthStats: stats(["act"], 1.4), stress: 1.15 }),
    trait("t_vocal_gift", "天生好嗓|天性の喉", "歌唱成長 +30%|歌唱の成長 +30%", { growthStats: stats(["vocal"], 1.3) }),
    trait("t_choir", "合唱團出身|聖歌隊出身", "歌唱成長 +20%、課程效果 +10%|歌唱の成長 +20%、レッスン効果 +10%", { growthStats: stats(["vocal"], 1.2), growthCourse: 1.1 }),
    trait("t_rhythm", "節奏感|リズム感", "舞蹈成長 +30%|ダンスの成長 +30%", { growthStats: stats(["dance"], 1.3) }),
    trait("t_athlete", "運動健將|アスリート", "舞蹈成長 +25%、體力消耗 -10%|ダンスの成長 +25%、体力消費 -10%", { growthStats: stats(["dance"], 1.25), stamina: 0.9 }),
    trait("t_chatter", "話匣子|おしゃべり", "口才成長 +30%|話術の成長 +30%", { growthStats: stats(["talk"], 1.3) }),
    trait("t_debater", "辯論社|ディベート部", "口才成長 +25%、壓力累積 +10%|話術の成長 +25%、ストレス +10%", { growthStats: stats(["talk"], 1.25), stress: 1.1 }),
    trait("t_smile", "招牌笑容|スマイル", "魅力成長 +30%|魅力の成長 +30%", { growthStats: stats(["charm"], 1.3) }),
    trait("t_mysterious", "神祕感|ミステリアス", "魅力成長 +35%、人氣獲得 -10%|魅力の成長 +35%、人気 -10%", { growthStats: stats(["charm"], 1.35), fame: 0.9 }),
    trait("t_artist", "藝術家氣質|アーティスト気質", "創意成長 +30%|創造性の成長 +30%", { growthStats: stats(["sense"], 1.3) }),
    trait("t_dreamer", "夢想家|夢想家", "創意成長 +35%、體力消耗 +10%|創造性の成長 +35%、体力消費 +10%", { growthStats: stats(["sense"], 1.35), stamina: 1.1 }),
    // ---- 雙能力成長 ----
    trait("t_musical", "音樂劇咖|ミュージカル俳優", "演技與歌唱成長 +20%|演技と歌唱の成長 +20%", { growthStats: stats(["act", "vocal"], 1.2) }),
    trait("t_idol_trainee", "練習生出身|練習生上がり", "歌唱與舞蹈成長 +20%|歌唱とダンスの成長 +20%", { growthStats: stats(["vocal", "dance"], 1.2) }),
    trait("t_mc_sense", "臨場反應|アドリブ力", "口才與創意成長 +20%|話術と創造性の成長 +20%", { growthStats: stats(["talk", "sense"], 1.2) }),
    trait("t_photogenic", "上鏡|フォトジェニック", "魅力與演技成長 +20%|魅力と演技の成長 +20%", { growthStats: stats(["charm", "act"], 1.2) }),
    trait("t_street", "街頭派|ストリート育ち", "舞蹈與創意成長 +20%|ダンスと創造性の成長 +20%", { growthStats: stats(["dance", "sense"], 1.2) }),
    trait("t_radio", "廣播之聲|ラジオボイス", "歌唱與口才成長 +20%|歌唱と話術の成長 +20%", { growthStats: stats(["vocal", "talk"], 1.2) }),
    trait("t_model_walk", "台步|ウォーキング", "魅力與舞蹈成長 +20%|魅力とダンスの成長 +20%", { growthStats: stats(["charm", "dance"], 1.2) }),
    trait("t_writer", "文青|文学青年", "創意與口才成長 +20%|創造性と話術の成長 +20%", { growthStats: stats(["sense", "talk"], 1.2) }),
    // ---- 方向表現 ----
    trait("t_tear", "淚腺殺手|泣きの名手", "電視劇表現 +18%|ドラマの表現 +18%", { perfDirs: dirs(["drama"], 1.18) }),
    trait("t_big_screen", "大銀幕臉|スクリーン映え", "電影表現 +18%|映画の表現 +18%", { perfDirs: dirs(["film"], 1.18) }),
    trait("t_live_beast", "現場型|ライブの申し子", "歌手／樂團表現 +12%|歌手・バンドの表現 +12%", { perfDirs: dirs(["singer", "band"], 1.12) }),
    trait("t_center", "C 位氣場|センターの器", "偶像表現 +18%|アイドルの表現 +18%", { perfDirs: dirs(["idol"], 1.18) }),
    trait("t_cm_queen", "代言體質|CM 体質", "廣告表現 +18%|CM の表現 +18%", { perfDirs: dirs(["cm"], 1.18) }),
    trait("t_mc_king", "控場王|仕切り上手", "主持人／主播表現 +10%|司会・キャスターの表現 +10%", { perfDirs: dirs(["host", "anchor"], 1.1) }),
    trait("t_battle_dancer", "鬥舞魂|バトル魂", "舞團表現 +18%|ダンスの表現 +18%", { perfDirs: dirs(["dancer"], 1.18) }),
    trait("t_newsroom", "新聞魂|報道魂", "主播表現 +18%|キャスターの表現 +18%", { perfDirs: dirs(["anchor"], 1.18) }),
    trait("t_streamer", "直播體質|配信体質", "虛擬主播表現 +18%|VTuber の表現 +18%", { perfDirs: dirs(["vtuber"], 1.18) }),
    trait("t_garage", "車庫樂手|ガレージ魂", "樂團表現 +18%|バンドの表現 +18%", { perfDirs: dirs(["band"], 1.18) }),
    trait("t_anime_voice", "動畫聲線|アニメ声", "聲優表現 +18%|声優の表現 +18%", { perfDirs: dirs(["voice"], 1.18) }),
    trait("t_theater", "劇場人|劇場人", "舞台劇表現 +18%|舞台の表現 +18%", { perfDirs: dirs(["stage"], 1.18) }),
    trait("t_runway", "伸展台之星|ランウェイの星", "模特兒表現 +18%|モデルの表現 +18%", { perfDirs: dirs(["model"], 1.18) }),
    trait("t_gag", "搞笑神經|笑いのセンス", "搞笑表現 +18%|お笑いの表現 +18%", { perfDirs: dirs(["comedy"], 1.18) }),
    trait("t_trend", "潮流雷達|トレンドレーダー", "網紅表現 +18%|インフルエンサーの表現 +18%", { perfDirs: dirs(["influencer"], 1.18) }),
    trait("t_score", "配樂之耳|劇伴の耳", "配樂表現 +18%|作曲の表現 +18%", { perfDirs: dirs(["composer"], 1.18) }),
    // ---- 月薪 ----
    trait("t_frugal", "勤儉|倹約家", "月薪 -15%|月給 -15%", { salary: 0.85 }),
    trait("t_modest", "知足|足るを知る", "月薪 -10%、人氣獲得 -5%|月給 -10%、人気 -5%", { salary: 0.9, fame: 0.95 }),
    trait("t_diva", "大牌|大物気取り", "月薪 +30%、表現 +8%|月給 +30%、表現 +8%", { salary: 1.3, perf: 1.08 }),
    trait("t_bargain", "便宜簽下|格安契約", "月薪 -20%、每月滿意度 -1|月給 -20%、満足度 毎月 -1", { salary: 0.8, satDrift: -1 }),
    // ---- 滿意度 ----
    trait("t_loyal", "念舊|義理堅い", "每月滿意度 +2|満足度 毎月 +2", { satDrift: 2 }),
    trait("t_cheerful", "樂天派|楽天家", "每月滿意度 +1、壓力累積 -10%|満足度 毎月 +1、ストレス -10%", { satDrift: 1, stress: 0.9 }),
    trait("t_homebody", "戀家|家族思い", "每月滿意度 +1、體力消耗 +5%|満足度 毎月 +1、体力消費 +5%", { satDrift: 1, stamina: 1.05 }),
    trait("t_complainer", "愛抱怨|愚痴っぽい", "每月滿意度 -2、成長 +5%|満足度 毎月 -2、成長 +5%", { satDrift: -2, growth: 1.05 }),
    trait("t_restless", "定不下心|飽き性", "每月滿意度 -1、訓練效果 +15%|満足度 毎月 -1、トレーニング効果 +15%", { satDrift: -1, growthTrain: 1.15 }),
    trait("t_grateful", "感恩|感謝の人", "每月滿意度 +2、工作酬勞 -5%|満足度 毎月 +2、ギャラ -5%", { satDrift: 2, pay: 0.95 }),
    // ---- 事件運 ----
    trait("t_charm_luck", "福星|福の神", "事件壞結果機率 -30%|イベントの悪い結果 -30%", { badLuck: 0.7 }),
    trait("t_careful", "謹慎|慎重派", "事件壞結果機率 -20%、人氣獲得 -5%|イベントの悪い結果 -20%、人気 -5%", { badLuck: 0.8, fame: 0.95 }),
    trait("t_survivor", "危機處理|危機管理", "事件壞結果機率 -15%、壓力累積 -5%|イベントの悪い結果 -15%、ストレス -5%", { badLuck: 0.85, stress: 0.95 }),
    trait("t_jinx", "衰神附身|不運体質", "事件壞結果機率 +40%、人氣獲得 +10%|イベントの悪い結果 +40%、人気 +10%", { badLuck: 1.4, fame: 1.1 }),
    trait("t_trouble", "麻煩製造機|トラブルメーカー", "事件發生率 ×1.5、壞結果 +30%、人氣獲得 +15%|イベント発生率 ×1.5、悪い結果 +30%、人気 +15%", { eventRate: 1.5, badLuck: 1.3, fame: 1.15 }),
    // ---- 人氣衰退 ----
    trait("t_evergreen", "常青樹|息が長い", "人氣衰退 -40%|人気の衰え -40%", { fameDecay: 0.6 }),
    trait("t_always_news", "話題不斷|話題が尽きない", "人氣衰退 -20%、事件發生率 +20%|人気の衰え -20%、イベント発生率 +20%", { fameDecay: 0.8, eventRate: 1.2 }),
    trait("t_steady", "穩定|安定感", "人氣衰退 -15%、表現 +3%|人気の衰え -15%、表現 +3%", { fameDecay: 0.85, perf: 1.03 }),
    trait("t_flash", "一夕爆紅型|一発屋気質", "人氣獲得 +30%、人氣衰退 +50%|人気 +30%、人気の衰え +50%", { fame: 1.3, fameDecay: 1.5 }),
    trait("t_nostalgia", "老派人氣|懐かしの人気", "人氣衰退 -25%、人氣獲得 -10%|人気の衰え -25%、人気 -10%", { fameDecay: 0.75, fame: 0.9 }),
    // ---- 組合 ----
    trait("t_team_player", "團隊精神|チームプレイヤー", "組合默契 +30%|ユニットの相性 +30%", { chem: 1.3 }),
    trait("t_mood_maker", "開心果|ムードメーカー", "組合默契 +20%、壓力累積 -5%|ユニットの相性 +20%、ストレス -5%", { chem: 1.2, stress: 0.95 }),
    trait("t_leader", "隊長氣質|リーダー気質", "組合默契 +25%、壓力累積 +5%|ユニットの相性 +25%、ストレス +5%", { chem: 1.25, stress: 1.05 }),
    trait("t_lone_wolf", "獨行俠|一匹狼", "組合默契 -30%、表現 +6%|ユニットの相性 -30%、表現 +6%", { chem: 0.7, perf: 1.06 }),
    // ---- 複合 ----
    trait("t_iron_lung", "肺活量|肺活量", "體力消耗 -15%、歌唱成長 +10%|体力消費 -15%、歌唱の成長 +10%", { stamina: 0.85, growthStats: stats(["vocal"], 1.1) }),
    trait("t_night_practice", "夜練派|夜練習派", "訓練效果 +20%、體力消耗 +10%|トレーニング効果 +20%、体力消費 +10%", { growthTrain: 1.2, stamina: 1.1 }),
    trait("t_studious", "筆記魔|ノート魔", "課程效果 +25%、壓力累積 +5%|レッスン効果 +25%、ストレス +5%", { growthCourse: 1.25, stress: 1.05 }),
    trait("t_sleepy", "睡不飽|寝不足", "體力消耗 +20%、成長 +5%|体力消費 +20%、成長 +5%", { stamina: 1.2, growth: 1.05 }),
    trait("t_zen", "冥想派|瞑想家", "壓力累積 -25%、表現 -2%|ストレス -25%、表現 -2%", { stress: 0.75, perf: 0.98 }),
    trait("t_gym", "健身狂|筋トレ好き", "體力消耗 -20%、舞蹈成長 +10%|体力消費 -20%、ダンスの成長 +10%", { stamina: 0.8, growthStats: stats(["dance"], 1.1) }),
    trait("t_pressure", "抗壓|プレッシャーに強い", "壓力累積 -20%、表現 +3%|ストレス -20%、表現 +3%", { stress: 0.8, perf: 1.03 }),
    trait("t_nervous", "緊張大師|緊張しい", "壓力累積 +25%、課程效果 +15%|ストレス +25%、レッスン効果 +15%", { stress: 1.25, growthCourse: 1.15 }),
    trait("t_late_bloomer", "大器晚成|大器晩成", "成長 +20%、人氣獲得 -10%|成長 +20%、人気 -10%", { growth: 1.2, fame: 0.9 }),
    trait("t_prodigy", "早熟|早熟", "成長 +10%、人氣衰退 +20%|成長 +10%、人気の衰え +20%", { growth: 1.1, fameDecay: 1.2 }),
    trait("t_workaholic", "工作狂|仕事中毒", "工作酬勞 +10%、壓力累積 +20%、體力消耗 +10%|ギャラ +10%、ストレス +20%、体力消費 +10%", { pay: 1.1, stress: 1.2, stamina: 1.1 }),
    trait("t_lucky_star", "幸運星|ラッキースター", "表現 +4%、事件壞結果 -10%|表現 +4%、イベントの悪い結果 -10%", { perf: 1.04, badLuck: 0.9 }),
    trait("t_charisma", "天生領袖魅力|カリスマ", "人氣獲得 +15%、組合默契 +10%|人気 +15%、ユニットの相性 +10%", { fame: 1.15, chem: 1.1 }),
    trait("t_patient", "耐心|根気強い", "課程與訓練效果 +10%、壓力累積 -5%|レッスンとトレーニング効果 +10%、ストレス -5%", { growthCourse: 1.1, growthTrain: 1.1, stress: 0.95 }),
    trait("t_airhead", "天然呆|天然ボケ", "事件發生率 +30%、每月滿意度 +1、表現 -3%|イベント発生率 +30%、満足度 毎月 +1、表現 -3%", { eventRate: 1.3, satDrift: 1, perf: 0.97 })
  ].forEach(function (t) {
    if (D.TRAIT_BY_ID[t.id]) throw new Error("starV traits: 重複的 ID " + t.id);
    D.TRAITS.push(t);
    D.TRAIT_BY_ID[t.id] = t;
  });
})();
