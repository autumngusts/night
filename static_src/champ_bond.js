// 冠軍教練（champ）：羈絆（2026-11-11 第五版，使用者指定「訓練策略 5、7＋戀愛擴充全部」）。
// 1 多段式約會（出發→途中→道別 3 題，累積心動值決定結尾）　2 地點專屬題目　3 依關係階段的事件
// 4 擁抱／親吻指令　5 她主動的事件　6 約會意外　7 新約會地點　8 「第一次」相簿
// 訓練：深夜一對一陪練、新人導師制度。
// 親密內容（牽手、擁抱、親吻、交往）只對 18 歲以上的選手開放；未成年選手走「信賴的教練」路線，18 歲時有成年禮事件。
// 事件一律放進 S.events，型別 t:"bond"（key＋pid），由 champ_life.js 的 resolve() 轉交這裡處理。
(function () {
  "use strict";

  var D = window.PriTestChampData, Core = window.PriTestChampCore;
  var C = D.C, L = D.L;
  var ADULT = 18;
  var MENTOR_WEEKS = 8, MENTOR_MAX = 2;
  function S() { return Core.get(); }
  function tr(k, p) { return Core.tr(k, p); }
  function clamp(x, a, b) { return Core.clamp(x, a, b); }
  function pick(a) { return Core.pick(a); }
  function rnd(a, b) { return Core.rnd(a, b); }
  function person(id) { return Core.person(id); }
  function roster() { return S().roster.map(person).filter(Boolean); }
  function wkKey() { var s = S(); return s.year * 100 + s.wk; }
  function LIFE() { return window.PriTestChampLife; }
  function album(kind, p, text) { var lf = LIFE(); if (lf) lf.album(kind, p, text); }
  function T(c, p) { return L(c).replace(/\{name\}/g, p ? p.handle : ""); }

  // =====================================================================
  // 資料
  // =====================================================================
  // 約會地點專屬題目（每個地點 2 題）。like／dislike 是個性 id：hot calm natural tsun hard confident shy lady
  function Q(q, a, b, c) { return { q: q, o: [a, b, c] }; }
  function O(t, like, dislike) { return { t: t, like: like || [], dislike: dislike || [] }; }
  var SPOT_EV = {
    cafe: [
      Q(C("她盯著菜單上的季節限定聖代看了很久。", "彼女はメニューの季節限定パフェをじっと見ている。"),
        O(C("「就點那個吧，我請。」", "「それにしよう、おごるよ」"), ["natural", "shy", "lady"], ["tsun"]), O(C("「熱量很高喔？」", "「カロリー高いよ？」"), ["hard"], ["natural", "hot", "lady"]), O(C("點一份，兩根湯匙", "一つ頼んでスプーン二本"), ["tsun", "hot", "confident"], ["calm"])),
      Q(C("店裡在放一首老情歌，她跟著輕輕哼。", "店内で古いラブソングが流れ、彼女が小さく口ずさむ。"),
        O(C("跟著一起哼", "一緒に口ずさむ"), ["hot", "natural"], ["calm"]), O(C("安靜地聽她唱", "黙って聴く"), ["shy", "calm", "lady"], []), O(C("「原來你會唱歌啊」", "「歌えたんだ」"), ["confident", "tsun"], ["shy"]))
    ],
    karaoke: [
      Q(C("她把麥克風遞給你：「換你了！」", "彼女がマイクを差し出す。「次はあなた！」"),
        O(C("唱一首熱血動畫歌", "熱いアニソンを歌う"), ["hot", "natural"], ["lady"]), O(C("唱一首深情的慢歌", "しっとりバラードを歌う"), ["shy", "lady", "calm"], ["hot"]), O(C("推給她：「我想聽你唱」", "「君の歌が聴きたい」と返す"), ["confident", "tsun"], ["shy"])),
      Q(C("點歌機跳出一首合唱情歌。", "選曲画面にデュエットのラブソングが出てきた。"),
        O(C("「來合唱吧」", "「デュエットしよう」"), ["hot", "confident", "natural"], ["shy"]), O(C("假裝沒看到，切下一首", "見なかったことにして飛ばす"), ["shy"], ["tsun", "confident"]), O(C("「你唱女生的部分？」", "「女性パート歌う？」"), ["tsun", "lady"], []))
    ],
    cinema: [
      Q(C("要看哪一部？", "どの映画を観る？"),
        O(C("恐怖片", "ホラー"), ["hot", "confident"], ["shy", "lady"]), O(C("愛情片", "恋愛映画"), ["shy", "lady", "tsun"], ["hard"]), O(C("動畫電影", "アニメ映画"), ["natural", "hard"], ["confident"])),
      Q(C("電影演到最感人的地方，她偷偷擦了眼睛。", "一番泣けるシーンで、彼女がこっそり目元をぬぐった。"),
        O(C("默默遞上面紙", "黙ってティッシュを渡す"), ["shy", "lady", "calm"], []), O(C("假裝沒看到", "見なかったふり"), ["tsun", "confident"], ["natural"]), O(C("小聲說「我也哭了」", "「俺も泣いた」とささやく"), ["hot", "natural", "hard"], ["calm"]))
    ],
    aquarium: [
      Q(C("水母區的燈光很暗，她走得很慢。", "クラゲのエリアは暗く、彼女はゆっくり歩く。"),
        O(C("放慢腳步配合她", "歩調を合わせる"), ["calm", "shy", "lady"], []), O(C("說水母的冷知識", "クラゲの豆知識を話す"), ["hard", "natural"], ["tsun"]), O(C("拍下她看水母的側臉", "クラゲを見る横顔を撮る"), ["confident", "tsun"], ["shy"])),
      Q(C("海豚表演前，她猶豫要不要坐第一排（會被潑濕）。", "イルカショーの前、最前列（濡れる席）に座るか迷っている。"),
        O(C("「坐第一排！」", "「最前列だ！」"), ["hot", "natural"], ["lady"]), O(C("坐後面，把外套借她", "後ろに座って上着を貸す"), ["lady", "shy"], ["hot"]), O(C("讓她決定", "彼女に任せる"), ["confident", "calm"], []))
    ],
    night: [
      Q(C("服務生問要不要開一瓶紅酒。", "ウェイターがワインを勧めてきた。"),
        O(C("點一杯就好，明天還要練習", "明日も練習だから一杯だけ"), ["hard", "calm"], ["lady"]), O(C("開一瓶好酒慶祝", "いいワインで乾杯"), ["lady", "confident"], ["hard"]), O(C("點兩杯氣泡果汁", "スパークリングジュースを二つ"), ["natural", "shy", "tsun"], [])),
      Q(C("窗外是整座城市的燈火，她問：「你喜歡這座城市嗎？」", "窓の外は一面の夜景。「この街、好き？」と彼女が聞く。"),
        O(C("「因為有你在，所以喜歡。」", "「君がいるから好きだ」"), ["shy", "tsun", "lady"], ["calm"]), O(C("說起自己剛來這裡的故事", "この街に来た頃の話をする"), ["calm", "hard"], []), O(C("「下次帶你去更高的地方看」", "「今度はもっと高い所から見よう」"), ["confident", "hot", "natural"], []))
    ],
    amuse: [
      Q(C("雲霄飛車的隊伍好長，她有點不敢坐。", "ジェットコースターの列。彼女は少し怖そう。"),
        O(C("「我陪你，抓著我就好」", "「一緒だから、つかまってて」"), ["shy", "lady", "natural"], []), O(C("「怕的話就去坐旋轉木馬」", "「怖いならメリーゴーランドにしよう」"), ["calm"], ["hot", "confident"]), O(C("笑她膽小", "怖がりだとからかう"), ["tsun", "hot"], ["shy", "lady"])),
      Q(C("摩天輪慢慢升高，她望著窗外不說話。", "観覧車がゆっくり上がる。彼女は窓の外を見て黙っている。"),
        O(C("坐到她旁邊", "隣に座る"), ["shy", "tsun", "natural"], ["calm"]), O(C("一起數底下的燈", "下の灯りを一緒に数える"), ["natural", "hard", "calm"], []), O(C("「今天謝謝你」", "「今日はありがとう」"), ["lady", "confident", "hot"], []))
    ],
    shopping: [
      Q(C("她拿著兩件衣服問：「哪件比較好看？」", "二着の服を持って「どっちが似合う？」"),
        O(C("指著比較可愛的那件", "かわいい方を指す"), ["natural", "shy"], ["confident"]), O(C("指著比較成熟的那件", "大人っぽい方を指す"), ["confident", "lady", "calm"], ["natural"]), O(C("「你穿什麼都好看」", "「何でも似合うよ」"), ["tsun"], ["hard", "calm"])),
      Q(C("她在飾品店前停下腳步。", "アクセサリー店の前で彼女が立ち止まった。"),
        O(C("陪她一起慢慢挑", "一緒にゆっくり選ぶ"), ["lady", "shy", "calm"], []), O(C("偷偷記下她看的款式", "見ていたものをこっそり覚える"), ["tsun", "shy"], []), O(C("「比賽獎金下來再買」", "「賞金が出たら買おう」"), ["hard", "hot"], ["lady"]))
    ],
    onsen: [
      Q(C("泡完湯，她穿著浴衣、頭髮還有點濕。", "湯上がりの浴衣姿、髪がまだ少し濡れている。"),
        O(C("「浴衣很適合你」", "「浴衣、似合ってる」"), ["shy", "lady", "tsun"], []), O(C("遞上咖啡牛奶", "コーヒー牛乳を渡す"), ["natural", "hot", "hard"], []), O(C("提醒她把頭髮吹乾免得感冒", "風邪ひくから髪を乾かしてと言う"), ["calm", "hard"], ["confident"])),
      Q(C("旅館有桌球台，她躍躍欲試。", "旅館の卓球台に彼女がうずうずしている。"),
        O(C("認真對決", "本気で勝負"), ["hot", "confident", "hard"], ["lady"]), O(C("故意輸給她", "わざと負ける"), ["natural", "lady"], ["hot", "tsun"]), O(C("坐在旁邊看她跟其他客人打", "隣で応援する"), ["shy", "calm"], []))
    ],
    books: [
      Q(C("她拿起一本詩集翻了翻，又放回去。", "彼女は詩集をめくって、また棚に戻した。"),
        O(C("偷偷買下來送她", "こっそり買ってプレゼント"), ["shy", "lady", "tsun"], []), O(C("問她喜歡哪一首", "どの詩が好きか聞く"), ["calm", "hard"], []), O(C("推薦一本攻略書", "攻略本を勧める"), ["hot", "natural"], ["lady", "calm"])),
      Q(C("兩個人同時伸手拿同一本書。", "二人が同時に同じ本に手を伸ばした。"),
        O(C("讓給她", "譲る"), ["lady", "calm"], []), O(C("「一起看吧」", "「一緒に読もう」"), ["shy", "natural", "tsun"], []), O(C("「猜拳決定！」", "「じゃんけんで決めよう！」"), ["hot", "confident"], ["shy"]))
    ],
    catcafe: [
      Q(C("一隻貓一直蹭你，不理她。", "猫があなたにばかり懐いて、彼女には寄ってこない。"),
        O(C("把貓抱到她腿上", "猫を彼女の膝に乗せる"), ["natural", "shy", "lady"], []), O(C("炫耀一下", "ちょっと自慢する"), ["tsun", "hot"], ["confident"]), O(C("教她用逗貓棒", "猫じゃらしの使い方を教える"), ["hard", "calm"], [])),
      Q(C("她學貓叫想吸引牠們注意。", "彼女が猫の鳴き真似をしている。"),
        O(C("跟著一起學", "一緒に真似する"), ["natural", "hot"], ["calm"]), O(C("偷偷錄下來", "こっそり録画"), ["tsun", "confident"], ["shy", "lady"]), O(C("「很像喔」", "「そっくりだね」"), ["shy", "lady", "hard"], []))
    ],
    beach: [
      Q(C("她撿到一個漂亮的貝殼。", "彼女がきれいな貝殻を拾った。"),
        O(C("「留著當紀念吧」", "「記念に取っておこう」"), ["shy", "lady", "calm"], []), O(C("比賽誰撿得多", "どっちが多く拾えるか勝負"), ["hot", "hard", "confident"], ["lady"]), O(C("放到耳邊聽海的聲音", "耳に当てて海の音を聴く"), ["natural", "tsun"], [])),
      Q(C("她想在沙灘上寫字。", "彼女が砂浜に文字を書きたがっている。"),
        O(C("寫下隊名和「世界冠軍」", "チーム名と「世界一」と書く"), ["hot", "hard", "confident"], []), O(C("寫下兩個人的名字", "二人の名前を書く"), ["shy", "tsun", "lady"], ["calm"]), O(C("畫一隻歪歪的貓", "下手な猫を描く"), ["natural"], []))
    ],
    arcade: [
      Q(C("她想挑戰太鼓遊戲的最高難度。", "太鼓ゲームの最高難度に挑戦したいらしい。"),
        O(C("雙人一起打", "二人で叩く"), ["hot", "natural"], []), O(C("在旁邊幫她數拍子", "横でリズムを数える"), ["hard", "calm"], []), O(C("「你一定不行」", "「絶対無理だって」"), ["tsun", "confident"], ["shy", "lady"])),
      Q(C("拍貼機前，她拉了拉你的袖子。", "プリクラの前で、彼女があなたの袖を引いた。"),
        O(C("一起拍，比個愛心", "一緒に撮ってハートを作る"), ["natural", "hot", "tsun"], ["calm"]), O(C("擺出職業選手的帥氣姿勢", "プロらしいキメポーズ"), ["confident", "hard"], []), O(C("「我不太會拍照……」", "「写真は苦手で……」"), ["shy", "calm"], ["natural"]))
    ],
    planet: [
      Q(C("解說員說今晚的主題是「夏季大三角」。", "解説員「今夜のテーマは夏の大三角です」"),
        O(C("小聲補充牛郎織女的故事", "織姫と彦星の話をささやく"), ["shy", "lady", "tsun"], []), O(C("認真聽、一起找星座", "真剣に聴いて星座を探す"), ["hard", "calm", "natural"], []), O(C("「我們隊就是三角戰術」", "「うちのチームも三角戦術だ」"), ["hot", "confident"], ["lady"])),
      Q(C("座椅往後仰，她的手放在扶手上。", "リクライニングした座席、彼女の手が肘掛けにある。"),
        O(C("輕輕碰一下她的手", "そっと手に触れる"), ["shy", "tsun", "lady"], ["calm"]), O(C("專心看星星", "星に集中する"), ["calm", "hard"], ["tsun"]), O(C("偷看她的側臉", "横顔をこっそり見る"), ["natural", "confident"], []))
    ],
    fireworks: [
      Q(C("屋台一排排，她看起來每一攤都想吃。", "屋台が並び、彼女はどれも食べたそう。"),
        O(C("「全部買，分著吃」", "「全部買って分けよう」"), ["natural", "hot"], ["hard"]), O(C("買她最喜歡的蘋果糖", "好物のりんご飴を買う"), ["shy", "lady", "tsun"], []), O(C("玩撈金魚", "金魚すくいをする"), ["confident", "hard"], [])),
      Q(C("人越來越多，她差點被擠開。", "人混みで彼女とはぐれそうになった。"),
        O(C("牽住她的手", "手をつなぐ"), ["shy", "tsun", "natural"], []), O(C("讓她抓著你的袖子", "袖をつかませる"), ["lady", "calm"], []), O(C("帶她到人少的祕密地點", "人の少ない穴場に連れていく"), ["confident", "hot", "hard"], []))
    ],
    nightmarket: [
      Q(C("夜市的臭豆腐攤前，她皺了皺鼻子。", "夜市の臭豆腐の屋台で、彼女が鼻をしかめた。"),
        O(C("「吃吃看，很好吃的！」", "「食べてみて、美味しいよ！」"), ["hot", "natural", "confident"], ["lady"]), O(C("改買珍珠奶茶", "タピオカミルクティーにする"), ["shy", "lady", "tsun"], []), O(C("兩個人各吃一口挑戰", "一口ずつチャレンジ"), ["hard", "tsun"], ["calm"])),
      Q(C("射氣球攤的大獎是一隻巨大的熊。", "射的の大当たりは巨大なクマのぬいぐるみ。"),
        O(C("拿出職業選手的準度", "プロの精度を見せる"), ["confident", "hot", "natural"], []), O(C("讓她來，你幫忙瞄", "彼女に撃たせて狙いを教える"), ["shy", "hard", "lady"], []), O(C("「那種東西很難中的」", "「あれは当たらないよ」"), ["calm"], ["natural", "hot"]))
    ],
    zoo: [
      Q(C("熊貓館前排了長長的隊伍。", "パンダ舎の前に長い行列。"),
        O(C("排！一定要看", "並ぶ！絶対見たい"), ["natural", "hot", "shy"], ["calm"]), O(C("先去看人少的企鵝", "空いてるペンギンを先に"), ["calm", "hard"], []), O(C("買熊貓髮箍給她戴", "パンダのカチューシャを買ってあげる"), ["tsun", "lady", "confident"], [])),
      Q(C("她蹲在水豚面前看了二十分鐘。", "彼女はカピバラの前に二十分しゃがんでいる。"),
        O(C("陪她一起蹲著看", "一緒にしゃがんで眺める"), ["natural", "shy", "calm"], []), O(C("「水豚好像你喔」", "「カピバラって君に似てる」"), ["tsun", "hot"], ["lady", "confident"]), O(C("去買飼料來餵", "エサを買ってくる"), ["hard", "lady"], []))
    ],
    ski: [
      Q(C("她第一次滑雪，在初級道上摔了好幾次。", "初めてのスキー、初級コースで何度も転ぶ彼女。"),
        O(C("牽著她慢慢滑", "手を引いてゆっくり滑る"), ["shy", "lady", "natural"], []), O(C("示範正確的姿勢", "正しいフォームを見せる"), ["hard", "calm"], []), O(C("「再來！摔倒才會進步！」", "「もう一回！転んで上手くなる！」"), ["hot", "confident"], ["shy", "lady"])),
      Q(C("滑雪場的小屋裡，她捧著熱可可發抖。", "ロッジで、彼女がココアを持って震えている。"),
        O(C("把圍巾圍到她脖子上", "マフラーを巻いてあげる"), ["shy", "tsun", "lady"], []), O(C("搓熱她的手", "手をこすって温める"), ["natural", "hot"], ["calm"]), O(C("再點一杯熱的", "もう一杯温かいのを頼む"), ["calm", "hard", "confident"], []))
    ],
    shrine: [
      Q(C("廟會的籤筒前，她要你也抽一支。", "縁日のおみくじの前で、あなたにも引けと言う。"),
        O(C("抽到大吉，和她交換", "大吉を引いて交換する"), ["natural", "shy"], []), O(C("「我不信這個」", "「占いは信じない」"), ["calm"], ["natural", "lady"]), O(C("一起綁在祈願牆上", "一緒に結んでいく"), ["lady", "tsun", "hard"], [])),
      Q(C("她在繪馬上寫願望，用手遮著不給你看。", "絵馬に願いを書き、手で隠して見せてくれない。"),
        O(C("不偷看，寫自己的", "覗かずに自分のを書く"), ["calm", "lady", "shy"], []), O(C("「是不是寫我？」", "「俺のこと書いた？」"), ["confident", "tsun"], ["shy"]), O(C("寫「全隊平安」", "「チーム全員無事」と書く"), ["hard", "hot", "natural"], []))
    ],
    gamecafe: [
      Q(C("電競咖啡廳裡有人認出你們，邀請來一場 2v2。", "e スポーツカフェで気づかれ、2v2 に誘われた。"),
        O(C("全力打爆對手", "全力で叩きのめす"), ["hot", "confident"], ["shy"]), O(C("讓她 carry，你打輔助", "彼女にキャリーさせてサポート"), ["tsun", "natural", "hard"], []), O(C("婉拒，今天只想兩個人", "断る、今日は二人だけ"), ["shy", "lady", "calm"], ["hot"])),
      Q(C("她點了一份以她名字命名的特調飲料。", "彼女の名前がついたコラボドリンクを頼んだ。"),
        O(C("「味道跟你一樣甜」", "「君みたいに甘い」"), ["tsun", "confident", "natural"], ["calm"]), O(C("一起拍照上傳", "一緒に写真をアップ"), ["hot", "confident"], ["shy"]), O(C("認真給出飲料評價", "真面目に味をレビュー"), ["hard", "calm"], []))
    ],
    home: [
      Q(C("第一次到她的住處，房間裡有點亂。", "初めての彼女の部屋。少し散らかっている。"),
        O(C("「很有生活感，我喜歡」", "「生活感があって好きだよ」"), ["natural", "hot", "shy"], []), O(C("幫她一起收拾", "一緒に片付ける"), ["hard", "calm", "lady"], ["tsun"]), O(C("看到她以前的獎盃，問起故事", "昔のトロフィーの話を聞く"), ["confident", "tsun"], [])),
      Q(C("她說要下廚，結果廚房冒出一陣煙。", "手料理を作ると言ったら、キッチンから煙が。"),
        O(C("「一起重做吧」", "「一緒に作り直そう」"), ["shy", "natural", "hard"], []), O(C("全部吃完，說很好吃", "全部食べて美味しいと言う"), ["tsun", "lady", "hot"], []), O(C("「我們叫外送吧」", "「出前を取ろう」"), ["calm", "confident"], ["hard"]))
    ],
    trip: [
      Q(C("小旅行的第一站，是她一直想去的港口小鎮。", "小旅行の最初は、彼女が行きたがっていた港町。"),
        O(C("什麼都不排，到處晃", "予定を決めずにぶらぶら"), ["natural", "hot", "calm"], ["hard"]), O(C("按照她做的旅遊筆記走", "彼女の旅行メモどおりに回る"), ["hard", "shy", "lady"], []), O(C("給她一個驚喜行程", "サプライズの行程を用意"), ["tsun", "confident"], [])),
      Q(C("夜晚的旅館窗邊，她說：「好想一直這樣下去。」", "夜の宿の窓辺で「ずっとこうしていたい」と彼女。"),
        O(C("「那就一直這樣下去吧」", "「じゃあずっとこうしていよう」"), ["shy", "lady", "tsun"], []), O(C("說起退役之後的計畫", "引退後の計画を話す"), ["calm", "hard"], []), O(C("「下次去更遠的地方」", "「次はもっと遠くへ行こう」"), ["hot", "natural", "confident"], []))
    ]
  };

  // 約會中的意外（途中 25%）。fx：funds／fans 增減、news＝上新聞
  var ACCIDENTS = [
    { icon: "💸", q: C("要結帳時，你發現錢包忘在宿舍了。", "会計の時、財布を寮に忘れたことに気づいた。"),
      o: [ { t: C("老實說，讓她先付", "正直に言って立て替えてもらう"), like: ["confident", "lady", "natural"], dislike: ["tsun"] },
           { t: C("跑回去拿（$5K 計程車費）", "取りに戻る（タクシー $5K）"), like: ["hard", "calm"], dislike: ["hot"], fx: { funds: -5 } },
           { t: C("用手機支付救援", "スマホ決済で切り抜ける"), like: ["calm", "hard", "tsun"], dislike: [] } ] },
    { icon: "📸", q: C("一群粉絲認出了你們，興奮地衝過來。", "ファンの集団に気づかれ、駆け寄ってきた。"),
      o: [ { t: C("大方地合照簽名", "堂々と写真とサイン"), like: ["confident", "hot"], dislike: ["shy"], fx: { fans: 800 } },
           { t: C("說是在討論戰術，正經地應對", "作戦会議中だと真面目に対応"), like: ["calm", "hard"], dislike: ["tsun"] },
           { t: C("拉著她轉身就跑", "彼女の手を引いて逃げる"), like: ["natural", "tsun", "shy"], dislike: ["lady"], fx: { news: 1 } } ] },
    { icon: "🧭", q: C("手機沒電，兩個人迷路了。", "スマホの充電が切れて、道に迷った。"),
      o: [ { t: C("憑直覺亂走", "勘で歩く"), like: ["hot", "natural"], dislike: ["calm", "lady"] },
           { t: C("找路人問路", "道を尋ねる"), like: ["calm", "lady", "hard"], dislike: [] },
           { t: C("「迷路也不錯，多走一會」", "「迷子もいいね、もう少し歩こう」"), like: ["shy", "tsun", "confident"], dislike: ["hard"] } ] },
    { icon: "🩹", q: C("她穿著新鞋，腳後跟磨破了。", "新しい靴で、彼女のかかとが靴擦れした。"),
      o: [ { t: C("背她走一段", "おんぶする"), like: ["natural", "shy", "lady"], dislike: ["tsun"] },
           { t: C("去便利商店買 OK 繃", "コンビニで絆創膏を買う"), like: ["calm", "hard", "tsun"], dislike: [] },
           { t: C("「換雙拖鞋吧」，陪她去買", "「サンダルに替えよう」と買いに行く（$3K）"), like: ["confident", "hot"], dislike: [], fx: { funds: -3 } } ] },
    { icon: "😳", q: C("巧遇宿敵隊伍的選手，對方瞇起眼睛：「約會？」", "ライバルチームの選手と鉢合わせ。「デート？」と目を細められた。"),
      o: [ { t: C("「對，有意見嗎？」", "「そうだけど、何か？」"), like: ["confident", "tsun", "hot"], dislike: ["shy"], fx: { news: 1 } },
           { t: C("「戰術會議而已」", "「作戦会議だよ」"), like: ["calm", "shy"], dislike: ["tsun", "confident"] },
           { t: C("約對方下次正式比賽見真章", "次の公式戦で決着をつけようと言う"), like: ["hot", "hard"], dislike: ["lady"] } ] },
    { icon: "⛈", q: C("突然下起大雷雨，兩人困在屋簷下。", "突然の雷雨で、二人は軒下に閉じ込められた。"),
      o: [ { t: C("把外套披在她身上", "上着を彼女に掛ける"), like: ["lady", "shy", "tsun"], dislike: [] },
           { t: C("趁機聊聊彼此的事", "この機会にお互いの話をする"), like: ["calm", "hard", "natural"], dislike: [] },
           { t: C("「衝吧！」淋雨跑回去", "「走ろう！」雨の中を帰る"), like: ["hot", "confident", "natural"], dislike: ["lady", "calm"] } ] }
  ];

  // 道別（依關係階段）。stage 0＝信賴（朋友／未成年）1＝曖昧 2＝交往 3＝誓約
  var CLOSE = [
    [ Q(C("送她回宿舍，在門口她說：「今天謝謝你，教練。」", "寮の前で「今日はありがとう、コーチ」"),
        O(C("「明天練習也加油」", "「明日の練習も頑張ろう」"), ["hard", "hot", "calm"], []), O(C("「下次再一起出來」", "「また一緒に出かけよう」"), ["natural", "shy", "lady"], []), O(C("摸摸她的頭", "頭をぽんぽんする"), ["natural", "shy"], ["tsun", "confident", "lady"])),
      Q(C("回程的電車上，她打了個大哈欠。", "帰りの電車で、彼女が大きなあくびをした。"),
        O(C("「到站再叫你，睡一下吧」", "「着いたら起こすから寝てていいよ」"), ["shy", "natural", "lady"], []), O(C("一起復盤上週的比賽", "先週の試合を振り返る"), ["hard", "calm"], ["natural"]), O(C("講笑話讓她醒著", "冗談で起こしておく"), ["hot", "tsun", "confident"], [])) ],
    [ Q(C("道別時，她站在原地遲遲沒有走。", "別れ際、彼女はなかなか帰ろうとしない。"),
        O(C("「再走一段吧」", "「もう少し歩こうか」"), ["shy", "tsun", "lady"], []), O(C("輕輕握住她的手", "そっと手を握る"), ["natural", "hot", "shy"], ["calm"]), O(C("「快回去，別感冒了」", "「早く帰って、風邪ひくよ」"), ["calm", "hard"], ["tsun"])),
      Q(C("路燈下，她小聲問：「教練對大家都這麼好嗎？」", "街灯の下、「コーチって誰にでも優しいの？」と小声で。"),
        O(C("「只有對你這樣」", "「君にだけだよ」"), ["shy", "tsun", "lady", "natural"], ["calm"]), O(C("「選手都是我的寶物」", "「選手はみんな宝物だ」"), ["hard", "calm"], ["tsun", "confident"]), O(C("笑著反問她希望是怎樣", "どうであってほしいか聞き返す"), ["confident", "hot"], [])) ],
    [ Q(C("分別前，她拉住你的衣角：「再一下下就好。」", "別れ際、服の裾をつかんで「もう少しだけ」"),
        O(C("緊緊抱住她", "ぎゅっと抱きしめる"), ["shy", "tsun", "natural", "hot"], []), O(C("牽著手繞遠路回去", "手をつないで遠回りして帰る"), ["lady", "calm", "hard"], []), O(C("「明天也會見面的」", "「明日も会えるよ」"), ["confident"], ["tsun", "shy"])),
      Q(C("她閉上眼睛，像在等待什麼。", "彼女が目を閉じた。何かを待っているように。"),
        O(C("輕輕吻她", "そっとキスする"), ["shy", "tsun", "lady", "natural", "hot", "confident"], []), O(C("吻她的額頭", "おでこにキスする"), ["calm", "hard"], ["confident"]), O(C("捏捏她的臉", "ほっぺをつまむ"), ["natural"], ["lady", "shy"])) ],
    [ Q(C("她看著手上的戒指：「我們以後會住在哪裡呢？」", "指輪を見つめて「将来どこに住むのかな」"),
        O(C("「有海的地方」", "「海の見える所」"), ["natural", "shy", "lady"], []), O(C("「離練習室近一點的地方」", "「練習室の近く」"), ["hard", "hot"], ["lady"]), O(C("「你在的地方就好」", "「君がいる所ならどこでも」"), ["tsun", "confident", "calm"], [])),
      Q(C("回家的路上，她把頭靠在你肩上。", "帰り道、彼女があなたの肩に頭を預けた。"),
        O(C("吻她的頭髮", "髪にキスする"), ["shy", "lady", "tsun"], []), O(C("說「我愛你」", "「愛してる」と言う"), ["hot", "natural", "confident"], ["tsun"]), O(C("什麼都不說，放慢腳步", "何も言わず歩調をゆるめる"), ["calm", "hard"], [])) ]
  ];

  // 新的約會地點（加在 D.DATE_SPOTS 後面）。req：lover＝交往中、vow＝誓約。kiss：心動結尾的場景描寫
  var NEW_SPOTS = [
    { id: "nightmarket", name: C("夜市", "夜市"), icon: "🏮", cost: 3, mood: 13, aff: 5, text: C("在夜市從頭吃到尾，最後兩個人分了一碗芒果冰。", "夜市を端から端まで食べ歩き、最後はマンゴーかき氷を半分こ。") },
    { id: "zoo", name: C("動物園", "動物園"), icon: "🐼", cost: 5, mood: 14, aff: 5, text: C("在動物園看了熊貓和水豚，她買了一個水豚吊飾。", "動物園でパンダとカピバラを見て、彼女はカピバラのキーホルダーを買った。") },
    { id: "ski", name: C("滑雪場", "スキー場"), icon: "⛷", cost: 16, mood: 19, aff: 7, text: C("在滑雪場摔了好多次，最後終於一起滑完一整條雪道。", "何度も転んだけれど、最後は二人で一本滑りきった。") },
    { id: "shrine", name: C("廟會祈福", "縁日・参拝"), icon: "⛩", cost: 4, mood: 12, aff: 6, text: C("在廟會祈求全隊平安，她的繪馬始終沒給你看。", "縁日でチームの無事を祈った。彼女の絵馬は最後まで見せてもらえなかった。") },
    { id: "gamecafe", name: C("電競主題咖啡廳", "e スポーツカフェ"), icon: "🎧", cost: 6, mood: 14, aff: 5, text: C("在電競咖啡廳打了幾場休閒局，還喝到了她的聯名飲料。", "e スポーツカフェで何戦か遊び、彼女のコラボドリンクも飲んだ。") },
    { id: "home", name: C("她的家", "彼女の家"), icon: "🏠", cost: 2, mood: 20, aff: 8, req: "lover", text: C("在她家一起煮了晚餐，窩在沙發上看完一整季動畫。", "彼女の家で晩ご飯を作り、ソファでアニメを一気見した。") },
    { id: "trip", name: C("兩天一夜旅行", "一泊二日の旅行"), icon: "🧳", cost: 35, mood: 28, aff: 10, req: "vow", text: C("兩天一夜的小旅行。早上醒來，窗外是一片海。", "一泊二日の小旅行。朝、目を覚ますと窓の外は一面の海だった。") }
  ];
  // 各地點心動結尾的場景（沒有寫的用一般描寫）
  var KISS_SCENE = {
    amuse: C("摩天輪到達最頂端的那一刻，", "観覧車がてっぺんに着いたその瞬間、"),
    fireworks: C("最大的那朵煙火綻放時，", "一番大きな花火が開いた瞬間、"),
    planet: C("人工星空的流星劃過時，", "プラネタリウムの流れ星が流れた瞬間、"),
    night: C("城市的燈火在窗外閃爍，", "窓の外で街の灯りがまたたく中、"),
    beach: C("夕陽沉進海裡的時候，", "夕日が海に沈むその時、"),
    ski: C("雪花落在她的睫毛上，", "雪が彼女のまつげに落ちて、"),
    trip: C("旅館窗外傳來海浪聲，", "宿の窓の外から波の音が聞こえる中、"),
    home: C("沙發上，動畫的片尾曲響起時，", "ソファで、アニメのエンディングが流れる中、")
  };
  // 個性對新地點的喜好（加到 D.TRAIT 的 likes／dislikes）
  var NEW_LIKES = { hot: ["ski", "nightmarket"], calm: ["shrine"], natural: ["zoo", "nightmarket"], tsun: ["gamecafe"], hard: ["gamecafe", "shrine"], confident: ["ski"], shy: ["zoo", "home"], lady: ["trip"] };
  var NEW_DISLIKES = { lady: ["nightmarket"], calm: ["gamecafe"] };

  // 結尾的旁白
  var END = {
    awkward: [C("回程的路上有點安靜，兩個人都沒找到話題。", "帰り道は少し静かで、二人とも話題が見つからなかった。"), C("她說「今天謝謝」，笑容卻有點勉強。", "「今日はありがとう」と言った彼女の笑顔は、少しぎこちなかった。")],
    fine: [C("「明天見。」她揮揮手，走進了宿舍。", "「また明日」と手を振って、彼女は寮へ入っていった。"), C("她說今天很開心，下次還想再來。", "今日は楽しかった、また来たいと彼女は言った。")],
    trust: [C("「有你當教練真好。」她笑著說。", "「あなたがコーチでよかった」と彼女は笑った。"), C("她說下一場比賽一定要贏給你看。", "次の試合は絶対に勝ってみせる、と彼女は言った。")],
    hand: C("回程的路上，指尖不小心碰在一起——她沒有放開，反而輕輕握住了。", "帰り道、指先が触れ合った――彼女は離さず、そっと握り返してきた。"),
    hand2: C("你們牽著手，慢慢地走回去。", "二人は手をつないで、ゆっくり帰った。"),
    hug: C("道別的時候，她忽然撲進你的懷裡，緊緊地抱住你。", "別れ際、彼女がふいに胸に飛び込んで、ぎゅっと抱きついてきた。"),
    hug2: C("分開前，你們安靜地抱了很久。", "別れる前、二人は静かに長く抱き合った。"),
    cheek: C("她踮起腳尖，在你的臉頰上輕輕親了一下，然後紅著臉跑開了。", "彼女はつま先立ちで、あなたの頬にそっとキスをして、真っ赤になって走っていった。"),
    kiss: C("她閉上眼睛。你們的唇輕輕碰在一起，時間好像停了下來。", "彼女が目を閉じた。唇がそっと重なり、時間が止まったようだった。"),
    kiss2: C("你們交換了一個溫柔的吻。", "二人は優しいキスを交わした。"),
    vow: C("她把戴著戒指的手放進你的手心，輕聲說：「以後也一直在一起吧。」", "指輪をはめた手をあなたの手のひらに重ねて、「これからもずっと一緒にいようね」と彼女はささやいた。")
  };

  // 個性的反應台詞
  function TL(hot, calm, natural, tsun, hard, confident, shy, lady) { return { hot: hot, calm: calm, natural: natural, tsun: tsun, hard: hard, confident: confident, shy: shy, lady: lady }; }
  var FIRST_HAND = TL(
    C("「手、手好熱……是我的還是你的啦！」", "「手、熱っ……私の？あなたの？」"), C("「……這樣走，比較不會走散。」", "「……こうしてれば、はぐれない」"),
    C("「欸嘿嘿，教練的手好大～」", "「えへへ、コーチの手おっきい～」"), C("「只、只是怕你走丟而已！」", "「は、はぐれないようにしてるだけだから！」"),
    C("「……這個，也要練習很多次才會習慣吧。」", "「……これも、たくさん練習しないと慣れないね」"), C("「牽好喔，我可是很搶手的。」", "「ちゃんと握ってて。私、人気あるんだから」"),
    C("「……（低著頭，耳朵全紅了）」", "「……（うつむいて、耳まで真っ赤）」"), C("「這是本小姐特別允許的。」", "「これは、わたくしが特別に許したのですわ」"));
  var HUG = TL(
    C("「充電完成！今天也能燃燒了！」", "「充電完了！今日も燃えていける！」"), C("「……再一分鐘。」", "「……あと一分」"),
    C("「好溫暖～可以一直這樣嗎？」", "「あったか～い、ずっとこうしてていい？」"), C("「放、放開啦！……再、再一下也可以。」", "「は、離して！……もうちょっとなら、いいけど」"),
    C("「力氣好像都回來了。」", "「力が戻ってきた気がする」"), C("「抱我抱得這麼緊，那麼喜歡我？」", "「そんなに強く抱いて、そんなに私が好き？」"),
    C("「……心跳聲，被聽到了吧。」", "「……心臓の音、聞こえちゃったよね」"), C("「真是的……下不為例喔。」", "「もう……今回だけですわよ」"));
  var KISS = TL(
    C("「……比拿下大龍還要讓人心跳加速。」", "「……バロン取るよりドキドキする」"), C("「……我記住這個瞬間了。」", "「……この瞬間、覚えておく」"),
    C("「欸？欸欸？剛剛那是……！」", "「え？ええっ？今の……！」"), C("「笨、笨蛋！誰准你……不、不准停下來。」", "「ば、ばか！誰が許したの……や、やめないで」"),
    C("「明天練習，我一定會發揮得更好。」", "「明日の練習、絶対いつも以上にやれる」"), C("「這可是我的初吻……要負責喔？」", "「私のファーストキスなんだから……責任取ってよね？」"),
    C("「……（把臉埋進你的胸口）」", "「……（あなたの胸に顔をうずめる）」"), C("「……這個吻，我會好好珍藏的。」", "「……このキス、大切にしまっておきますわ」"));
  // 你告白（交往）成功
  var LOVER_YES = TL(
    C("「真的嗎！？我也是！我也是！！」", "「ほんと！？私も！私もだよ！！」"), C("「……我也一直在等你說這句話。」", "「……私もずっと、その言葉を待ってた」"),
    C("「欸……那、那我們現在是男女朋友了？好開心！」", "「え……じゃあ私たち、付き合ってるってこと？うれしい！」"), C("「哼，現在才說，太慢了啦……我也喜歡你。」", "「ふん、遅いよ……私も、好き」"),
    C("「我會一邊比賽，一邊好好珍惜你。」", "「試合も、あなたのことも、ちゃんと大切にする」"), C("「我就知道你會先說出口。好啊，我答應你。」", "「先に言うと思ってた。いいよ、付き合ってあげる」"),
    C("「……（點頭點了好多次）……好。」", "「……（何度もうなずいて）……はい」"), C("「這份告白，本小姐收下了。往後請多指教。」", "「その告白、お受けしますわ。これからよろしくお願いいたします」"));
  var LOVER_NO = TL(
    C("「我、我現在只想著比賽……再給我一點時間！」", "「い、今は試合のことしか……もう少し時間ちょうだい！」"), C("「……謝謝。可是我還沒準備好。」", "「……ありがとう。でも、まだ準備ができてない」"),
    C("「欸？咦？我腦袋轉不過來……」", "「え？えっ？頭が追いつかない……」"), C("「突、突然說這個幹嘛啦！」", "「きゅ、急に何言ってるの！」"),
    C("「等我拿到冠軍，再回答你好嗎？」", "「優勝したら、返事させて」"), C("「想追我？再努力一點吧。」", "「私を落としたいなら、もう少し頑張って」"),
    C("「……（逃走了）」", "「……（逃げた）」"), C("「這種事，要更有誠意一點才行喔。」", "「そういうことは、もっと誠意を見せてからですわ」"));
  // 她向你告白
  var HER_CONFESS = TL(
    C("「教練！我喜歡你！跟我交往吧！！」", "「コーチ！好きです！付き合ってください！！」"), C("「我分析過很多次……結論是，我喜歡你。」", "「何度も分析した……結論は、あなたが好き」"),
    C("「我好像……喜歡上教練了。這樣可以嗎？」", "「私、コーチのこと好きになっちゃったみたい。いいのかな？」"), C("「我、我才不是喜歡你！……騙你的，我很喜歡你。」", "「べ、別に好きじゃ……嘘。大好き」"),
    C("「我想站在離你最近的地方。」", "「あなたの一番近くにいたい」"), C("「給你一個機會，當我的男朋友吧。」", "「チャンスをあげる。私の彼氏になって」"),
    C("「……那個，請、請跟我交往！」", "「……あの、つ、付き合ってください！」"), C("「本小姐決定了，要和你在一起。」", "「わたくし決めましたの。あなたと一緒になるって」"));
  // 成年禮（18 歲）
  var ADULT_LINE = TL(
    C("「18 歲了！教練，以後別再把我當小孩子了！」", "「18 歳！コーチ、もう子ども扱いしないでよね！」"), C("「今天開始，我是大人了。」", "「今日から、大人だから」"),
    C("「長大了耶～可是好像沒什麼不一樣？」", "「大人になった～けど、何も変わらない？」"), C("「哼，終於追上你一點了。」", "「ふん、やっと少し追いついた」"),
    C("「成年了，我會更努力的。」", "「大人になったし、もっと頑張る」"), C("「從今天起，用看女人的眼光看我吧。」", "「今日からは、大人の女として見てよね」"),
    C("「……長大了，有些話，好像可以說了。」", "「……大人になったら、言えることもある気がする」"), C("「成人禮的和服，好看嗎？」", "「成人式の振袖、似合います？」"));
  // 深夜陪練的對話
  var LATE = TL(
    C("「再一場！教練不准先睡！」", "「もう一戦！コーチ先に寝ちゃダメ！」"), C("「深夜的練習室，很安靜，我喜歡。」", "「深夜の練習室は静かで好き」"),
    C("「肚子餓了……教練，泡麵分你一半～」", "「お腹すいた……カップ麺半分あげる～」"), C("「我、我才不是因為你陪我才練得這麼晚！」", "「あ、あなたがいるから遅くまで練習してるわけじゃないから！」"),
    C("「謝謝你陪我練到這麼晚。我會變強的。」", "「こんな遅くまでありがとう。強くなるから」"), C("「看好了，這操作全聯賽只有我做得到。」", "「見てて、この操作はリーグで私だけ」"),
    C("「……只有兩個人的時候，比較說得出話。」", "「……二人きりだと、少し話せる」"), C("「本小姐的努力，可別說出去喔。」", "「わたくしの努力、内緒ですわよ」"));
  var LATE_SLEEP = C("練到一半，她靠在你肩上睡著了。你沒有叫醒她。", "途中で、彼女はあなたの肩にもたれて眠ってしまった。起こさなかった。");
  var LATE_LOVER = [C("「練完了……可以抱一下嗎？」", "「練習終わり……ぎゅってしていい？」"), C("「有你陪著，熬夜也不累。」", "「あなたがいれば、徹夜も平気」"), C("她在你的臉頰上親了一下：「晚安，教練。」", "頬にキスして「おやすみ、コーチ」")];
  // 生日（交往中）
  var BDAY_KISS = C("她抱著禮物，踮腳在你臉頰上親了一下：「這是謝禮。」", "プレゼントを抱えて、背伸びして頬にキス。「お礼だよ」");

  // 每週事件（關係階段、她主動、成年禮、導師出師）。opts：aff／mood／fat／cond／others（好感 60 以上其他人的心情）／first／lover／line（個性台詞表）
  var EV = {
    // 信賴（朋友）
    earphone: { icon: "🎧", st: 0, text: C("巴士上，{name} 把一邊耳機遞給你：「這首歌很好聽喔。」", "バスの中、{name} が片方のイヤホンを差し出す。「この曲いいよ」"),
      opts: [ { t: C("一起聽到下車", "降りるまで一緒に聴く"), aff: 4, mood: 6 }, { t: C("「我比較想聽你講話」", "「君の話が聞きたいな」"), aff: 3, mood: 4 } ] },
    bag: { icon: "🎒", st: 0, text: C("{name} 搬著一大箱周邊商品，搖搖晃晃。", "{name} がグッズの大きな箱を抱えてふらふらしている。"),
      opts: [ { t: C("幫她搬", "代わりに持つ"), aff: 4, mood: 5 }, { t: C("叫二軍的人來幫忙", "二軍を呼んで手伝わせる"), aff: 1, mood: 2 } ] },
    // 曖昧（成年）
    handtouch: { icon: "✋", st: 1, text: C("覆盤時兩人同時伸手拿滑鼠，手疊在一起。{name} 沒有馬上抽開。", "振り返り中、同時にマウスに手を伸ばして手が重なった。{name} はすぐには離さない。"),
      opts: [ { t: C("輕輕握住", "そっと握る"), aff: 6, mood: 8, first: "hand", line: "FIRST_HAND" }, { t: C("笑著把滑鼠讓給她", "笑ってマウスを譲る"), aff: 2, mood: 3 } ] },
    shoulder: { icon: "🚌", st: 1, text: C("比賽回程的車上，{name} 靠在你肩上睡著了。", "試合帰りの車で、{name} があなたの肩で眠ってしまった。"),
      opts: [ { t: C("讓她靠著，把外套蓋在她身上", "そのまま上着を掛けてあげる"), aff: 6, mood: 8, fat: -6 }, { t: C("輕輕把她扶正", "そっと起こさないように姿勢を直す"), aff: 2, mood: 2 } ] },
    // 交往
    farewell: { icon: "🤗", st: 2, text: C("遠征出發前，{name} 在機場拉住你：「抱一下再走。」", "遠征出発前、空港で {name} が引き止める。「ぎゅってしてから行こう」"),
      opts: [ { t: C("緊緊抱住她", "ぎゅっと抱きしめる"), aff: 5, mood: 12, first: "hug", line: "HUG" }, { t: C("「大家在看啦」，摸摸她的頭", "「みんな見てるよ」と頭をなでる"), aff: 1, mood: 2 } ] },
    backhug: { icon: "🫂", st: 2, text: C("輸掉比賽的夜裡，你一個人在練習室覆盤。{name} 從背後輕輕抱住了你：「不是你的錯。」", "負けた夜、一人で振り返りをしていると、{name} が後ろからそっと抱きしめた。「あなたのせいじゃない」"),
      opts: [ { t: C("握住她的手，轉身抱住她", "手を握って、振り向いて抱きしめる"), aff: 6, mood: 15, first: "hug", line: "HUG", team: 3 }, { t: C("「謝謝……我想再看一下錄影」", "「ありがとう……もう少し映像を見たい」"), aff: 2, mood: 4 } ] },
    lunch: { icon: "🍱", st: 2, text: C("{name} 塞給你一個便當盒：「多做了一份而已。」", "{name} がお弁当箱を押しつける。「多めに作っただけ」"),
      opts: [ { t: C("全部吃光，說超好吃", "完食して最高だと言う"), aff: 5, mood: 10 }, { t: C("「下次一起做吧」", "「今度一緒に作ろう」"), aff: 4, mood: 8 } ] },
    latemsg: { icon: "📱", st: 2, text: C("半夜一點，{name} 傳來訊息：「睡了嗎？」", "深夜 1 時、{name} からメッセージ。「もう寝た？」"),
      opts: [ { t: C("打電話給她", "電話をかける"), aff: 5, mood: 10, fat: 4 }, { t: C("回覆「還沒，想你」", "「まだ。会いたい」と返す"), aff: 4, mood: 7 }, { t: C("已讀，明天再說", "既読だけつけて明日話す"), aff: -3, mood: -6 } ] },
    stay: { icon: "🌙", st: 2, text: C("練習結束，{name} 小聲問：「今天……可以晚點回去嗎？」", "練習後、{name} が小声で「今日……もう少し一緒にいていい？」"),
      opts: [ { t: C("「當然可以」，陪她散步到深夜", "「もちろん」と夜遅くまで散歩する"), aff: 6, mood: 12, fat: 5 }, { t: C("「明天還要比賽，早點休息」", "「明日も試合だ、早く休もう」"), aff: -1, mood: -4, fat: -5 } ] },
    jealoushug: { icon: "💢", st: 2, text: C("{name} 看到你跟其他選手聊得很開心，鼓著臉走過來：「……我也要抱抱。」", "他の選手と楽しそうに話すあなたを見て、{name} がむくれて近づく。「……私もぎゅってして」"),
      opts: [ { t: C("當場抱住她", "その場で抱きしめる"), aff: 6, mood: 12, others: -4, first: "hug", line: "HUG" }, { t: C("「回去再說」，偷偷捏捏她的手", "「後でね」とこっそり手を握る"), aff: 3, mood: 5 } ] },
    // 誓約
    ring: { icon: "💍", st: 3, text: C("{name} 拉著你走進飾品店：「戒指……要不要一起挑一對？」", "{name} がジュエリー店へ引っぱる。「指輪……おそろいで選ばない？」"),
      opts: [ { t: C("一起挑一對（$20K）", "ペアリングを選ぶ（$20K）"), aff: 6, mood: 15, funds: -20 }, { t: C("「我早就準備好了」", "「実はもう用意してある」"), aff: 8, mood: 18, funds: -30 } ] },
    parents: { icon: "🏡", st: 3, text: C("{name}：「我爸媽說……想見見你。」", "{name}「うちの両親が……あなたに会いたいって」"),
      opts: [ { t: C("穿上西裝，帶著伴手禮去拜訪（$10K）", "スーツで手土産を持って挨拶へ（$10K）"), aff: 8, mood: 15, funds: -10 }, { t: C("「等拿下世界冠軍再去」", "「世界一になったら行こう」"), aff: 2, mood: 4 } ] },
    future: { icon: "🌅", st: 3, text: C("夜裡的陽台上，{name} 問：「退役之後，你想做什麼？」", "夜のベランダで {name} が聞く。「引退したら、何がしたい？」"),
      opts: [ { t: C("「跟你一起開一間戰隊」", "「君と一緒にチームを作りたい」"), aff: 6, mood: 12 }, { t: C("「每天陪你吃早餐」", "「毎朝一緒に朝ごはんを食べたい」"), aff: 7, mood: 14 } ] },
    // 她的告白（交往）
    herconf: { icon: "💌", st: 1, text: C("練習室只剩你們兩個。{name} 深吸一口氣：", "練習室に二人きり。{name} が深呼吸して——"), quote: "HER_CONFESS",
      opts: [ { t: C("「我也喜歡你」", "「俺も好きだ」"), lover: true, aff: 8, mood: 20 }, { t: C("「對不起，我是你的教練」", "「ごめん、俺は君のコーチだ」"), aff: -8, mood: -12 } ] },
    // 成年禮
    adult: { icon: "🎉", st: 0, text: C("今天是 {name} 的 18 歲成年禮。", "今日は {name} の成人の日。"), quote: "ADULT_LINE",
      opts: [ { t: C("送她一束花（$5K）", "花束を贈る（$5K）"), aff: 5, mood: 10, funds: -5 }, { t: C("「恭喜你，長大了」", "「おめでとう、大人になったね」"), aff: 3, mood: 6 } ] },
    // 導師出師
    mentor: { icon: "🎓", st: -1, text: C("{name} 跟著導師 {mentor} 學了 8 週，正式出師了！", "{name} が師匠 {mentor} のもとで 8 週間学び、ついに独り立ち！"),
      opts: [ { t: C("辦個小小的出師慶祝（$6K）", "ささやかな卒業祝い（$6K）"), mood: 8, funds: -6, chem: 6 }, { t: C("「以後也要互相照顧喔」", "「これからも支え合ってね」"), mood: 4, chem: 3 } ] }
  };
  var LINES = { FIRST_HAND: FIRST_HAND, HUG: HUG, KISS: KISS, HER_CONFESS: HER_CONFESS, ADULT_LINE: ADULT_LINE };

  // 新成就
  var EX = window.PriTestChampExtra;
  [{ id: "lover", icon: "💕", name: C("戀人", "恋人"), desc: C("和一位選手開始交往", "選手と付き合い始める") },
   { id: "first_kiss", icon: "💋", name: C("初吻", "ファーストキス"), desc: C("和交往的選手第一次接吻", "恋人と初めてキスをする") },
   { id: "mentor", icon: "🎓", name: C("傳承", "継承"), desc: C("新人在導師帶領下出師", "新人が師匠のもとで独り立ちする") }
  ].forEach(function (a) { if (!EX.ACH_BY_ID[a.id]) { EX.ACH.push(a); EX.ACH_BY_ID[a.id] = a; } });

  // 新地點登記到 D.DATE_SPOTS（只做一次）
  if (!D.DATE_SPOT.home) NEW_SPOTS.forEach(function (sp) { D.DATE_SPOTS.push(sp); D.DATE_SPOT[sp.id] = sp; });
  Object.keys(NEW_LIKES).forEach(function (k) { var t = D.TRAIT[k]; if (t) NEW_LIKES[k].forEach(function (x) { if (t.likes.indexOf(x) < 0) t.likes.push(x); }); });
  Object.keys(NEW_DISLIKES).forEach(function (k) { var t = D.TRAIT[k]; if (t) { t.dislikes = t.dislikes || []; NEW_DISLIKES[k].forEach(function (x) { if (t.dislikes.indexOf(x) < 0) t.dislikes.push(x); }); } });

  // =====================================================================
  // 關係階段
  // =====================================================================
  function adult(p) { return !!p && p.age >= ADULT; }
  function partner() { var s = S(), p = s.partnerPid && person(s.partnerPid); return p && p.team === "me" ? p : null; }
  function isLover(p) { return !!p && adult(p) && (p.lover || p.vow); }
  // 0＝信賴（朋友或未成年）1＝曖昧 2＝交往 3＝誓約
  function stage(p) {
    if (!adult(p)) return 0;
    if (p.vow) return 3;
    if (p.lover) return 2;
    return p.aff >= 60 ? 1 : 0;
  }
  function firsts(p) { if (!p.firsts) p.firsts = {}; return p.firsts; }
  function markFirst(p, k, text) {
    var f = firsts(p);
    if (f[k]) return false;
    f[k] = S().year;
    if (k === "kiss") { S().flags = S().flags || {}; S().flags.firstKiss = 1; }
    album("first_" + k, p, text);
    return true;
  }
  function setLover(p) {
    var s = S();
    p.lover = true; s.partnerPid = p.id;
    s.flags = s.flags || {}; s.flags.lover = 1;
    album("lover", p, L(LOVER_YES[p.trait] || LOVER_YES.calm));
    Core.addNews(tr("news_lover", { name: p.handle }), "gold");
    // 其他好感 60 以上的成年選手有點失落
    roster().forEach(function (x) { if (x.id !== p.id && x.aff >= 60) x.mood = clamp(x.mood - 6, 0, 100); });
  }
  // 你主動告白（交往）：成年、好感 75 以上、目前沒有交往對象，1 點行動點
  var CONFESS_AFF = 75;
  function canConfess(p) { return adult(p) && p.team === "me" && !p.lover && !p.vow && p.aff >= CONFESS_AFF && !partner(); }
  function confess(pid) {
    var s = S(), p = person(pid);
    if (!canConfess(p)) return { ok: false };
    if (s.ap < 1) return { ok: false, msg: tr("err_ap") };
    s.ap -= 1;
    var ch = p.aff >= 85 ? 1 : 0.6 + (p.aff - CONFESS_AFF) * 0.04;
    var out;
    if (Math.random() < ch) {
      setLover(p);
      p.mood = clamp(p.mood + 20, 0, 100); p.aff = clamp(p.aff + 5, 0, 100);
      out = { ok: true, yes: true, line: L(LOVER_YES[p.trait] || LOVER_YES.calm) };
    } else {
      p.mood = clamp(p.mood - 3, 0, 100);
      out = { ok: true, yes: false, line: L(LOVER_NO[p.trait] || LOVER_NO.calm) };
    }
    Core.save();
    return out;
  }

  // =====================================================================
  // 多段式約會
  // =====================================================================
  function spotReq(sp, p) {
    if (sp.req === "lover") return isLover(p);
    if (sp.req === "vow") return adult(p) && !!p.vow;
    return true;
  }
  function canDate(pid, spotId) {
    var p = person(pid), sp = D.DATE_SPOT[spotId];
    if (!p || !sp) return { ok: false };
    if (!spotReq(sp, p)) return { ok: false, msg: tr("err_spot_req_" + sp.req) };
    return Core.canDate(spotId);
  }
  // 3 題：出發（地點專屬 70%／一般）→ 途中（意外 25%／地點專屬／一般）→ 道別（依關係階段）
  function dateStart(pid, spotId) {
    var p = person(pid), st = stage(p), steps = [];
    var own = (SPOT_EV[spotId] || []).map(function (x, i) { return { k: "spot", i: i }; });
    own = Core.shuffle(own);
    var gen = Core.shuffle(window.PriTestChampStory.DATE_EVENTS.map(function (x, i) { return { k: "gen", i: i }; }));
    steps.push(own.length && Math.random() < 0.7 ? own.shift() : gen.shift());
    if (Math.random() < 0.25) steps.push({ k: "acc", i: Math.floor(Math.random() * ACCIDENTS.length) });
    else steps.push(own.length ? own.shift() : gen.shift());
    steps.push({ k: "close", st: st, i: Math.floor(Math.random() * CLOSE[st].length) });
    return { pid: pid, spot: spotId, steps: steps, n: 0, heart: 0, ans: [] };
  }
  function stepQ(step, spot) {
    if (step.k === "spot") return SPOT_EV[spot][step.i];
    if (step.k === "gen") return window.PriTestChampStory.DATE_EVENTS[step.i];
    if (step.k === "acc") return ACCIDENTS[step.i];
    return CLOSE[step.st][step.i];
  }
  function question(de) { var st = de.steps[de.n]; return st ? stepQ(st, de.spot) : null; }
  // 回答一題：回傳 { heart: +1／0／−1 }
  function answer(de, idx) {
    var q = question(de), p = person(de.pid);
    if (!q || !p) return 0;
    var o = q.o[idx], h = o.like.indexOf(p.trait) >= 0 ? 1 : o.dislike.indexOf(p.trait) >= 0 ? -1 : 0;
    de.heart += h; de.ans.push(idx); de.n++;
    return h;
  }
  // 約會結算：花費行動點與金錢，依心動值決定結尾（未成年＝信賴路線，不會有親密結尾）
  function dateFinish(de) {
    var s = S(), p = person(de.pid), sp = D.DATE_SPOT[de.spot], t = D.TRAIT[p.trait];
    var chk = canDate(de.pid, de.spot);
    if (!chk.ok) return chk;
    s.ap -= 1; s.funds -= sp.cost;
    var like = t.likes.indexOf(de.spot) >= 0 ? 1 : (t.dislikes || []).indexOf(de.spot) >= 0 ? -1 : 0;
    var heart = de.heart + like, st = stage(p);
    // 意外的附帶效果
    var extra = [];
    de.steps.forEach(function (step, k) {
      if (step.k !== "acc") return;
      var fx = ACCIDENTS[step.i].o[de.ans[k]].fx;
      if (!fx) return;
      if (fx.funds) s.funds += fx.funds;
      if (fx.fans) { s.fans += fx.fans; extra.push(tr("date_fx_fans", { n: fx.fans })); }
      if (fx.news) { Core.addNews(tr("news_date_spotted", { name: p.handle }), "event"); extra.push(tr("date_fx_news")); }
    });
    var mul = Math.max(0.3, (1 + 0.15 * heart) * (t.dateMul || 1));
    p.mood = clamp(p.mood + sp.mood * mul, 0, 100);
    p.aff = clamp(p.aff + sp.aff * mul, 0, 100);
    p.fatigue = clamp(p.fatigue - 8, 0, 100);
    if (p.mood >= 80 && p.cond < 2 && Math.random() < 0.35) p.cond++;
    // 結尾
    var kind, text, line = "", scene = KISS_SCENE[de.spot] ? L(KISS_SCENE[de.spot]) : "";
    if (heart <= -2) { kind = "awkward"; text = L(pick(END.awkward)); }
    else if (st === 0 || heart <= 0) { kind = adult(p) ? "fine" : "trust"; text = L(pick(END[kind])); }
    else if (st === 1) {
      kind = "hand";
      if (markFirst(p, "hand", L(sp.name))) { text = L(END.hand); line = L(FIRST_HAND[p.trait]); }
      else text = L(END.hand2);
    } else if (st === 2) {
      var f = firsts(p);
      if (!f.hug) { kind = "hug"; markFirst(p, "hug", L(sp.name)); text = L(END.hug); line = L(HUG[p.trait]); }
      else if (heart >= 2 && !f.cheek) { kind = "cheek"; markFirst(p, "cheek", L(sp.name)); text = L(END.cheek); }
      else if (heart >= 2 || (scene && heart >= 1 && f.cheek)) {
        kind = "kiss";
        if (markFirst(p, "kiss", L(sp.name))) { text = scene + L(END.kiss); line = L(KISS[p.trait]); }
        else text = scene + L(END.kiss2);
      } else { kind = "hug"; text = L(END.hug2); }
    } else {
      kind = "vow"; text = (scene ? scene : "") + L(END.vow);
      if (!firsts(p).kiss) markFirst(p, "kiss", L(sp.name));
    }
    if (kind !== "awkward" && kind !== "fine" && kind !== "trust") { p.aff = clamp(p.aff + 2, 0, 100); p.mood = clamp(p.mood + 5, 0, 100); }
    if (kind !== "awkward" && heart >= 2) album("date", p, L(sp.name) + "：" + text);
    var good = heart >= 1, bad = heart <= -1, ST = window.PriTestChampStory;
    if (!line && (good || bad)) line = L((good ? ST.DATE_LIKE : ST.DATE_DISLIKE)[p.trait] || ST.DATE_LIKE.calm);
    var msg = L(sp.text) + "\n" + text + (line ? "\n" + line : "") + "\n" + tr(good ? "date_like" : bad ? "date_dislike" : "date_ok", { name: p.handle }) + "（" + tr("date_heart", { n: (heart > 0 ? "+" : "") + heart }) + "）" + (extra.length ? "\n" + extra.join("\n") : "");
    var scn = Core.checkMilestone(p);
    Core.save();
    return { ok: true, kind: kind, msg: msg, scene: scn };
  }

  // =====================================================================
  // 擁抱／親吻（交往中且成年；擁抱每週一次不花行動點、親吻每週一次 1 點）
  // =====================================================================
  function intimacyRisk(p) {
    var s = S(), k = wkKey();
    if (!s.intim || s.intim.wk !== k) s.intim = { wk: k, n: 0 };
    s.intim.n++;
    if (s.intim.n >= 3 && Math.random() < 0.25) {
      var seen = roster().filter(function (x) { return x.id !== p.id && x.aff >= 50; });
      seen.forEach(function (x) { x.mood = clamp(x.mood - 5, 0, 100); });
      if (Math.random() < 0.35) { s.fans = Math.round(s.fans * 0.97); Core.addNews(tr("news_scandal", { name: p.handle }), "loss"); return tr("intim_scandal"); }
      return tr("intim_seen");
    }
    return "";
  }
  function canHug(p) { return isLover(p) && p.hugWk !== wkKey(); }
  function canKiss(p) { return isLover(p) && p.kissWk !== wkKey() && S().ap >= 1; }
  function hug(pid) {
    var s = S(), p = person(pid);
    if (!p || !isLover(p)) return { ok: false };
    if (p.hugWk === wkKey()) return { ok: false, msg: tr("err_once_week") };
    p.hugWk = wkKey();
    var sad = s.lostWk === wkKey() || s.lostWk === wkKey() - 1;
    p.mood = clamp(p.mood + (sad ? 18 : 8), 0, 100);
    p.aff = clamp(p.aff + 2, 0, 100);
    p.fatigue = clamp(p.fatigue - 3, 0, 100);
    var first = markFirst(p, "hug", tr("act_hug"));
    var risk = intimacyRisk(p);
    Core.save();
    return { ok: true, line: (sad ? tr("hug_after_loss") + "\n" : "") + L(HUG[p.trait] || HUG.calm) + (first ? "\n💗 " + tr("first_hug") : "") + (risk ? "\n" + risk : "") };
  }
  function kiss(pid) {
    var s = S(), p = person(pid);
    if (!p || !isLover(p)) return { ok: false };
    if (p.kissWk === wkKey()) return { ok: false, msg: tr("err_once_week") };
    if (s.ap < 1) return { ok: false, msg: tr("err_ap") };
    s.ap -= 1; p.kissWk = wkKey();
    p.aff = clamp(p.aff + 3, 0, 100);
    p.mood = clamp(p.mood + 12, 0, 100);
    var lines = [], f = firsts(p);
    if (!f.cheek) { markFirst(p, "cheek", tr("act_kiss")); lines.push(L(END.cheek), "💗 " + tr("first_cheek")); }
    else if (!f.kiss) { markFirst(p, "kiss", tr("act_kiss")); lines.push(L(END.kiss), L(KISS[p.trait] || KISS.calm), "💗 " + tr("first_kiss")); }
    else lines.push(L(END.kiss2), L(KISS[p.trait] || KISS.calm));
    // 比賽週還沒打：調子 +1
    if (Core.myMatch() && !s.done && p.cond < 2) { p.cond++; lines.push(tr("kiss_cond")); }
    var risk = intimacyRisk(p);
    if (risk) lines.push(risk);
    Core.save();
    return { ok: true, line: lines.join("\n") };
  }
  function bdayKiss(p) {
    if (!isLover(p)) return "";
    markFirst(p, "cheek", tr("album_bday"));
    p.aff = clamp(p.aff + 2, 0, 100);
    return L(BDAY_KISS);
  }

  // =====================================================================
  // 深夜一對一陪練（2 點行動點，每人每週一次）
  // =====================================================================
  var LATE_AP = 2;
  function canLate(p) { return p && p.team === "me" && p.lateWk !== wkKey() && S().ap >= LATE_AP; }
  function lateTrain(pid) {
    var s = S(), p = person(pid);
    if (!p || p.team !== "me") return { ok: false };
    if (p.lateWk === wkKey()) return { ok: false, msg: tr("err_once_week") };
    if (s.ap < LATE_AP) return { ok: false, msg: tr("err_ap") };
    s.ap -= LATE_AP; p.lateWk = wkKey();
    var low = D.STATS.slice().sort(function (a, b) { return p.stats[a] - p.stats[b]; });
    var g1 = rnd(1.2, 2.2) * Math.max(0.5, Core.growthMul(p)), g2 = g1 * 0.5;
    p.stats[low[0]] = clamp(p.stats[low[0]] + g1, 1, 99);
    p.stats[low[1]] = clamp(p.stats[low[1]] + g2, 1, 99);
    if (p.practice) p.mastery[p.practice] = Math.round(clamp((p.mastery[p.practice] || 0) + rnd(3, 6), 0, 100) * 10) / 10;
    p.aff = clamp(p.aff + 4, 0, 100);
    p.mood = clamp(p.mood + 3, 0, 100);
    p.fatigue = clamp(p.fatigue + 12, 0, 100);
    var st = stage(p), talk = "";
    if (st >= 2) talk = L(pick(LATE_LOVER));
    else if (st === 1 && Math.random() < 0.3) talk = L(LATE_SLEEP);
    else if (Math.random() < 0.6) talk = L(LATE[p.trait] || LATE.calm);
    var msg = tr("late_done", { name: p.handle, a: L(D.STAT[low[0]]), g1: g1.toFixed(1), b: L(D.STAT[low[1]]), g2: g2.toFixed(1) }) + (p.practice && D.HERO[p.practice] ? "\n" + tr("late_hero", { hero: L(D.HERO[p.practice].name) }) : "");
    var scn = Core.checkMilestone(p);
    Core.save();
    return { ok: true, msg: msg, line: talk, scene: scn };
  }

  // =====================================================================
  // 新人導師（S.mentors＝{ 新人 id: { m: 導師 id, wk: 週數 } }）
  // 新人 20 歲以下；導師 21 歲以上且 OVR 比新人高 3；每位導師只帶一人；最多 2 組。8 週後出師。
  // 效果：新人訓練成長 ×1.3、導師 ×0.85；兩人默契每週 +2；導師心態每週 +0.15。
  // =====================================================================
  function mentors() { var s = S(); if (!s.mentors) s.mentors = {}; return s.mentors; }
  function isRookie(p) { return p && p.team === "me" && p.age <= 20; }
  function mentorOk(m, r) { return m && r && m.id !== r.id && m.team === "me" && m.age >= 21 && Core.ovr(m) >= Core.ovr(r) + 3; }
  function mentorOf(rid) { var x = mentors()[rid]; return x ? person(x.m) : null; }
  function menteeOf(mid) { var M = mentors(), r = null; Object.keys(M).forEach(function (k) { if (M[k].m === mid) r = person(k); }); return r; }
  function mentorCands(rid) {
    var r = person(rid), M = mentors();
    return roster().filter(function (m) {
      if (!mentorOk(m, r)) return false;
      var busy = Object.keys(M).some(function (k) { return k !== rid && M[k].m === m.id; });
      return !busy;
    });
  }
  function setMentor(rid, mid) {
    var M = mentors(), r = person(rid);
    if (!mid) { delete M[rid]; Core.save(); return { ok: true }; }
    var m = person(mid);
    if (!isRookie(r) || !mentorOk(m, r)) return { ok: false };
    if (!M[rid] && Object.keys(M).length >= MENTOR_MAX) return { ok: false, msg: tr("err_mentor_max", { n: MENTOR_MAX }) };
    if (mentorCands(rid).indexOf(m) < 0) return { ok: false };
    M[rid] = { m: mid, wk: M[rid] && M[rid].m === mid ? M[rid].wk : 0 };
    Core.save();
    return { ok: true, msg: tr("mentor_set", { a: m.handle, b: r.handle }) };
  }
  // 訓練倍率（champ_core.js 的 weeklyUpkeep 呼叫）
  function trainMul(p) {
    var M = mentors();
    if (M[p.id]) return 1.3;
    if (Object.keys(M).some(function (k) { return M[k].m === p.id; })) return 0.85;
    return 1;
  }
  function mentorWeek() {
    var s = S(), M = mentors();
    Object.keys(M).forEach(function (rid) {
      var r = person(rid), m = person(M[rid].m);
      // 任一方離隊、或新人已超過 20 歲：解除
      if (!m || !r || m.team !== "me" || !isRookie(r)) { delete M[rid]; return; }
      M[rid].wk++;
      Core.addChem(rid, m.id, 2);
      m.stats.mental = clamp(m.stats.mental + 0.15, 1, 99);
      if (M[rid].wk >= MENTOR_WEEKS) {
        var best = D.STATS.slice().sort(function (a, b) { return m.stats[b] - m.stats[a]; })[0];
        r.stats[best] = clamp(r.stats[best] + 1.5, 1, 99);
        r.stats.mental = clamp(r.stats.mental + 1, 1, 99);
        s.events.push({ t: "bond", key: "mentor", pid: r.id, mid: m.id, stat: best });
        album("mentor", r, tr("mentor_grad_album", { a: m.handle, stat: L(D.STAT[best]) }));
        s.flags = s.flags || {}; s.flags.mentor = 1;
        delete M[rid];
      }
    });
  }
  function onRemove(pid) {
    var s = S(), M = mentors();
    Object.keys(M).forEach(function (k) { if (k === pid || M[k].m === pid) delete M[k]; });
    if (s.partnerPid === pid) s.partnerPid = null;
  }

  // =====================================================================
  // 每週事件
  // =====================================================================
  function queued(key) { return (S().events || []).some(function (e) { return e.t === "bond" && e.key === key; }); }
  function push(key, p, extra) {
    var e = { t: "bond", key: key, pid: p.id };
    if (extra) Object.keys(extra).forEach(function (k) { e[k] = extra[k]; });
    S().events.push(e);
  }
  function onWeek() {
    var s = S(), w = Core.week(), ps = roster(), pt = partner();
    if (s.partnerPid && !pt) s.partnerPid = null;
    // 成年禮：季前第 1 週（休賽季剛過、年齡 +1）
    if (w.k === "pre" && w.i === 0) ps.forEach(function (p) { if (p.age === ADULT && !p.adultEv) { p.adultEv = 1; if (p.aff >= 20) push("adult", p); } });
    var r = Math.random();
    if (pt && isLover(pt)) {
      // 她主動：30%
      if (r < 0.3) {
        var pool = ["lunch", "latemsg", "stay"];
        if (ps.some(function (x) { return x.id !== pt.id && x.aff >= 60; })) pool.push("jealoushug");
        if (!firsts(pt).hug) pool.push("farewell");
        if (pt.vow) pool.push("ring", "parents", "future");
        push(pick(pool), pt);
        return;
      }
    } else {
      // 她的告白：成年、好感 80 以上、沒有交往對象，每週 12%
      var cand = ps.filter(function (p) { return adult(p) && !p.lover && !p.vow && p.aff >= 80; });
      if (cand.length && r < 0.12 && !queued("herconf")) { push("herconf", pick(cand)); return; }
    }
    // 關係階段的小事件：20%（交往對象以外，最高到曖昧）
    if (Math.random() < 0.2) {
      var others = ps.filter(function (x) { return x.id !== s.partnerPid; });
      if (!others.length) return;
      var p = pick(others);
      var st = Math.min(1, stage(p)), keys = Object.keys(EV).filter(function (k) { return EV[k].st === st && !EV[k].quote; });
      if (st === 1 && firsts(p).hand) keys = keys.filter(function (k) { return k !== "handtouch"; });
      if (keys.length) push(pick(keys), p);
    }
  }
  function onSeries(se, win) {
    var s = S();
    if (win) return;
    s.lostWk = wkKey();
    var pt = partner();
    if (pt && isLover(pt) && !queued("backhug")) push("backhug", pt);
  }

  // 事件處理（Life.resolve 轉交）。choice：選項 index；null＝預設（最後一個選項）
  function resolve(ev, choice) {
    var s = S(), E = EV[ev.key], p = person(ev.pid);
    if (!E || !p) return "";
    var i = choice == null ? E.opts.length - 1 : +choice, o = E.opts[i] || E.opts[0];
    if (o.funds && s.funds + o.funds < 0) return { fail: tr("err_funds") };
    if (o.funds) s.funds += o.funds;
    if (o.aff) p.aff = clamp(p.aff + o.aff, 0, 100);
    if (o.mood) p.mood = clamp(p.mood + o.mood, 0, 100);
    if (o.fat) p.fatigue = clamp(p.fatigue + o.fat, 0, 100);
    if (o.team) roster().forEach(function (x) { if (x.id !== p.id) x.mood = clamp(x.mood + o.team, 0, 100); });
    if (o.others) roster().forEach(function (x) { if (x.id !== p.id && x.aff >= 60) x.mood = clamp(x.mood + o.others, 0, 100); });
    if (o.chem && ev.mid) Core.addChem(p.id, ev.mid, o.chem);
    var lines = [L(o.t)];
    if (o.lover && !partner()) { setLover(p); lines.push(L(LOVER_YES[p.trait] || LOVER_YES.calm)); }
    if (o.first && markFirst(p, o.first, L(E.text).replace("{name}", p.handle).replace("{mentor}", ""))) lines.push("💗 " + tr("first_" + o.first));
    if (o.line && LINES[o.line]) lines.push(L(LINES[o.line][p.trait] || LINES[o.line].calm));
    if (E.st >= 1 && i === 0 && ev.key !== "herconf") album("moment", p, L(E.text).replace("{name}", p.handle));
    Core.checkMilestone(p);
    return lines.join("\n");
  }
  // 畫面用：事件的內容
  function evView(ev) {
    var E = EV[ev.key], p = person(ev.pid), m = ev.mid ? person(ev.mid) : null;
    if (!E || !p) return null;
    var text = L(E.text).replace(/\{name\}/g, p.handle).replace(/\{mentor\}/g, m ? m.handle : "");
    if (ev.key === "mentor" && ev.stat) text += "\n" + tr("mentor_grad", { name: p.handle, stat: L(D.STAT[ev.stat]) });
    return { icon: E.icon, title: tr("bond_" + ev.key), text: text, quote: E.quote ? L(LINES[E.quote][p.trait] || LINES[E.quote].calm) : "",
      opts: E.opts.map(function (o) { return { t: L(o.t), dis: !!(o.funds && S().funds + o.funds < 0) }; }), pid: p.id, mid: m ? m.id : null };
  }

  function init(s) {
    s.mentors = s.mentors || {};
    // 舊存檔：誓約對象視為交往中
    if (!s.partnerPid) s.roster.forEach(function (id) { var p = person(id); if (p && p.vow) { p.lover = true; s.partnerPid = p.id; } });
  }

  window.PriTestChampBond = {
    ADULT: ADULT, CONFESS_AFF: CONFESS_AFF, LATE_AP: LATE_AP, MENTOR_WEEKS: MENTOR_WEEKS, MENTOR_MAX: MENTOR_MAX,
    SPOT_EV: SPOT_EV, ACCIDENTS: ACCIDENTS, CLOSE: CLOSE, EV: EV,
    init: init, onWeek: onWeek, onSeries: onSeries, onRemove: onRemove, resolve: resolve, evView: evView,
    adult: adult, stage: stage, partner: partner, isLover: isLover, setLover: setLover, firsts: firsts, markFirst: markFirst,
    canConfess: canConfess, confess: confess, spotReq: spotReq, canDate: canDate,
    dateStart: dateStart, question: question, answer: answer, dateFinish: dateFinish,
    canHug: canHug, canKiss: canKiss, hug: hug, kiss: kiss, bdayKiss: bdayKiss,
    canLate: canLate, lateTrain: lateTrain,
    mentors: mentors, isRookie: isRookie, mentorOf: mentorOf, menteeOf: menteeOf, mentorCands: mentorCands, setMentor: setMentor, trainMul: trainMul, mentorWeek: mentorWeek
  };
})();
