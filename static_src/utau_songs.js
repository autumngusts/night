// 我不會唱歌（utau）的歌單、分類與題庫包音檔版本。
// 歌單是題庫包製作工具（tools/utau_clips/build_pack.py）查歌名／歌手／年份／分類用的目錄。
// 新增歌曲：在對應「地區＋分類」的區塊加一行 S(年份, "歌名", "歌手")。年代由年份自動換算（1985 → 1980s）。
// 選曲方針（使用者指定）：以日本歌為主並細分類別；歐美、韓國只留在台灣／日本也廣為人知的歌。
// 2026-10-17 使用者精選改版：拿掉年代較久遠的歌與多數偶像／VOCALOID／演歌，改以「動漫歌占大比例＋近期話題曲」為主，
// 並依使用者指定補足特定歌手的歌曲數（例：LiSA 10、YOASOBI 15、周杰倫 15 首）。
// 日本歌再補 Billboard JAPAN 年度 Hot 100（2020〜2025）的話題曲與 2020 年以後的熱門動漫主題曲；
// 排除外國歌手、偶像團體、VOCALOID P、使用者拿掉或沒勾選的歌，已有指定曲數的歌手不再加。
// 再補 Billboard JAPAN 年度 Hot 100（2010〜2019）。規則（使用者指定）：只收 2010 年以後；動漫歌要台灣大眾都聽過；
// 流行歌同一人不要太多 → 使用者在勾選頁只勾了幾首的歌手不再另外加，新歌手每人最多 3 首。
// 2026-10-19 使用者從候選清單勾選追加華語 33 首、日本 56 首（含 2005 年以前的歌、周杰倫增至 19 首、VOCALOID「ロキ」，皆為使用者明確選入）。
// 歌名、歌手保留原文；id 由地區＋歌名組成，同地區內不要重複歌名（撞名時用 S() 的第 4 參數 key 區分）。
(function () {
  "use strict";

  var REGIONS = [
    { id: "ja", name: { zh: "日本", ja: "日本", en: "Japanese" } },
    { id: "zh", name: { zh: "華語", ja: "中華圏", en: "Mandarin / Cantonese" } },
    { id: "ko", name: { zh: "韓國", ja: "韓国", en: "Korean" } },
    { id: "en", name: { zh: "歐美", ja: "洋楽", en: "Western" } }
  ];

  var CATEGORIES = [
    { id: "anime", name: { zh: "動漫", ja: "アニメ", en: "Anime" } },
    { id: "screen", name: { zh: "影視（日劇・電影）", ja: "ドラマ・映画", en: "TV & film" } },
    { id: "pop", name: { zh: "流行（J-POP 等）", ja: "J-POP・ポップス", en: "Pop" } },
    { id: "idol", name: { zh: "偶像", ja: "アイドル", en: "Idol" } },
    { id: "net", name: { zh: "VOCALOID・網路", ja: "ボカロ・ネット", en: "Vocaloid & net" } },
    { id: "classic", name: { zh: "懷舊・演歌", ja: "昭和歌謡・演歌", en: "Classics & enka" } }
  ];

  // 進階模式題庫包的音檔版本（由 tools/utau_clips/build_pack.py 製作；original 只在公布答案時播放）
  // 依難度由易到難排列。2026-10-16 使用者試聽後決定：變速改為極端變快、拿掉八音盒／8bit（聽不出來），
  // 新增只有旋律樂器、人聲倒放、整段倒放。題庫包裡不在此清單的版本（舊包的 melody）會被忽略。
  // 之後以 CREPE 重做 8bit 旋律（id 改為 chip，避免舊包聽不出來的 melody 再出現），使用者試聽後採用。
  // zh_sing：AI 中文歌聲（DiffSinger），使用者試聽後採用；hint 是提示用音檔（加上伴奏）。長度 30 秒（使用者指定，其他版本 15 秒）。
  // zh_read（中文朗讀＋伴奏）使用者試聽後不採用，2026-10-17 拿掉；舊包裡的 zh_read 會被忽略。
  // ja_sing：華語歌的日文填詞由 VOICEVOX 角色演唱（男 玄野武宏／女 四国めたん，使用者試聽後指定），提示同 zh_sing。
  var VARIANTS = [
    {
      id: "instrumental",
      name: { zh: "純樂器", ja: "インスト", en: "Instrumental" },
      desc: { zh: "拿掉人聲，只剩伴奏", ja: "ボーカルを消した伴奏だけ", en: "Backing track only, vocals removed" }
    },
    {
      id: "vocal",
      name: { zh: "純人聲", ja: "ボーカルのみ", en: "Vocals only" },
      desc: { zh: "拿掉伴奏，只剩歌聲", ja: "伴奏を消した歌声だけ", en: "Vocals only, backing removed" }
    },
    {
      id: "other",
      name: { zh: "只有旋律樂器", ja: "上モノ楽器のみ", en: "Melodic instruments only" },
      desc: { zh: "拿掉人聲、鼓、貝斯，只剩吉他／鍵盤／弦樂等", ja: "ボーカル・ドラム・ベースを消し、ギター・鍵盤・ストリングスなどだけ", en: "No vocals, drums or bass; just guitars, keys, strings and so on" }
    },
    {
      id: "speed",
      name: { zh: "極端變快", ja: "超高速", en: "Super fast" },
      desc: { zh: "1.5 倍速＋升 6 半音", ja: "1.5倍速＋キー6つ上げ", en: "1.5x speed, 6 semitones higher" }
    },
    {
      id: "zh_sing",
      name: { zh: "中文歌聲", ja: "中国語で歌う", en: "Sung in Chinese" },
      desc: { zh: "AI 歌手用中文填詞唱原曲旋律（只有歌聲）；播放 5 次後可加上伴奏當提示", ja: "AI歌手が中国語の歌詞で原曲のメロディを歌う（歌声のみ）。5回再生すると伴奏をヒントとして追加できる", en: "An AI singer sings the melody with Chinese lyrics (vocals only). After 5 plays you can add the backing track as a hint" },
      hint: "zh_sing_inst"
    },
    {
      id: "ja_sing",
      name: { zh: "日文歌聲", ja: "日本語で歌う", en: "Sung in Japanese" },
      desc: { zh: "VOICEVOX 角色用日文填詞唱原曲旋律（只有歌聲，華語歌用）；播放 5 次後可加上伴奏當提示", ja: "VOICEVOXのキャラクターが日本語の歌詞で原曲のメロディを歌う（歌声のみ・中国語の曲用）。5回再生すると伴奏をヒントとして追加できる", en: "A VOICEVOX character sings the melody with Japanese lyrics (vocals only, for Mandarin songs). After 5 plays you can add the backing track as a hint" },
      hint: "ja_sing_inst"
    },
    {
      id: "chip",
      name: { zh: "8bit 旋律", ja: "8bitメロディ", en: "8-bit melody" },
      desc: { zh: "歌聲旋律改用紅白機音色演奏", ja: "歌のメロディをファミコン風の音で演奏", en: "The vocal melody played with a retro game-console tone" }
    },
    {
      id: "vocal_rev",
      name: { zh: "人聲倒放", ja: "ボーカル逆再生", en: "Reversed vocals" },
      desc: { zh: "伴奏正常，人聲倒著唱", ja: "伴奏はそのまま、歌声だけ逆再生", en: "Backing plays normally, vocals run backwards" }
    },
    // 阿卡貝拉三個版本（2026-10-26 使用者試聽後定案）：B-box 是 unfa 的真人口技單音（CC0），貝斯與和聲由 VOICEVOX 演唱
    {
      id: "acap_full",
      name: { zh: "阿卡貝拉", ja: "アカペラ", en: "A cappella" },
      desc: { zh: "B-box＋人聲貝斯＋和聲伴唱，全部改用人聲重新編曲（AI），沒有主旋律", ja: "ボイパ＋ボーカルベース＋コーラスの声だけアレンジ（AI）。メロディはなし", en: "Rearranged for voices only: beatbox, vocal bass and backing harmonies (AI). No melody" }
    },
    {
      id: "rhythm",
      name: { zh: "只有鼓＋貝斯", ja: "ドラム＋ベースのみ", en: "Drums & bass only" },
      desc: { zh: "只剩節奏組，高難度", ja: "リズム隊だけ。高難度", en: "Rhythm section only. Hard!" }
    },
    {
      id: "acap_bass",
      name: { zh: "B-box＋人聲貝斯", ja: "ボイパ＋ボーカルベース", en: "Beatbox & vocal bass" },
      desc: { zh: "阿卡貝拉拿掉和聲，只剩口技節奏和人聲貝斯，高難度", ja: "アカペラからコーラスを抜いた、ボイパとボーカルベースだけ。高難度", en: "The a cappella version without harmonies: just beatbox and vocal bass. Hard!" }
    },
    {
      id: "acap_bbox",
      name: { zh: "只有 B-box", ja: "ボイパのみ", en: "Beatbox only" },
      desc: { zh: "原曲的鼓改成口技，只剩節奏，超高難度", ja: "ドラムをボイパに置き換えたリズムだけ。超高難度", en: "The drums redone as beatbox, rhythm only. Very hard!" }
    },
    {
      id: "reverse",
      name: { zh: "整段倒放", ja: "まるごと逆再生", en: "Fully reversed" },
      desc: { zh: "整段倒著播，最難", ja: "曲ごと逆再生。最難関", en: "The whole clip backwards. Hardest!" }
    }
  ];

  var songs = [];
  var region = null;
  var cat = null;
  // key：同地區撞名時才傳（例：Folder5 與玉置成実的「Believe」），id 改用 key，畫面仍顯示 title。
  // 不傳 key 的歌 id 不變，既有題庫包與 songs.json 不受影響。
  function S(year, title, artist, key) {
    songs.push({ id: region + ":" + (key || title), r: region, c: cat, y: year, t: title, a: artist });
  }

  // ================= 日本 =================
  region = "ja";

  cat = "anime";
  S(1979, "ドラえもんのうた", "大杉久美子");
  S(1985, "タッチ", "岩崎良美");
  S(1987, "Get Wild", "TM NETWORK");
  S(1989, "CHA-LA HEAD-CHA-LA", "影山ヒロノブ");
  S(1992, "ムーンライト伝説", "DALI");
  S(1992, "微笑みの爆弾", "馬渡松子");
  S(1993, "君が好きだと叫びたい", "BAAD");
  S(1993, "あなただけ見つめてる", "大黒摩季");
  S(1994, "世界が終るまでは…", "WANDS");
  S(1995, "残酷な天使のテーゼ", "高橋洋子");
  S(1996, "そばかす", "JUDY AND MARY");
  S(1996, "DAN DAN 心魅かれてく", "FIELD OF VIEW");
  S(1996, "マイ フレンド", "ZARD");
  S(1997, "めざせポケモンマスター", "松本梨香");
  S(1997, "1/3の純情な感情", "SIAM SHADE");
  S(1997, "キミがいれば", "伊織");
  S(1999, "ウィーアー!", "きただにひろし");
  S(1999, "Butter-Fly", "和田光司");
  S(1999, "brave heart", "宮崎歩");
  S(1999, "おジャ魔女カーニバル!!", "MAHO堂");
  S(2000, "Secret of my heart", "倉木麻衣");
  S(2000, "Believe", "Folder5", "Believe (Folder5)");
  S(2000, "My will", "dream");
  S(2001, "深い森", "Do As Infinity");
  S(2001, "Dearest", "浜崎あゆみ");
  S(2002, "INVOKE", "T.M.Revolution");
  S(2002, "SKILL", "JAM Project");
  S(2002, "遥か彼方", "ASIAN KUNG-FU GENERATION");
  S(2003, "メリッサ", "ポルノグラフィティ");
  S(2003, "Time after time ～花舞う街で～", "倉木麻衣");
  S(2003, "Realize", "玉置成実");
  S(2003, "Believe", "玉置成実", "Believe (玉置成実)");
  S(2003, "BON VOYAGE!", "Bon-Bon Blanco");
  S(2003, "ココロのちず", "BOYSTYLE");
  S(2004, "GO!!!", "FLOW");
  S(2005, "創聖のアクエリオン", "AKINO");
  S(2005, "ETERNAL BLAZE", "水樹奈々");
  S(2005, "GLAMOROUS SKY", "中島美嘉");
  S(2005, "牙狼 ～SAVIOR IN THE DARK～", "JAM Project");
  S(2005, "Reason", "玉置成実");
  S(2005, "月光花", "Janne Da Arc");
  S(2006, "ハレ晴レユカイ", "平野綾・茅原実里・後藤邑子");
  S(2006, "God knows...", "平野綾");
  S(2008, "ブルーバード", "いきものがかり");
  S(2008, "ライオン", "May'n・中島愛");
  S(2009, "only my railgun", "fripSide");
  S(2009, "深愛", "水樹奈々");
  S(2009, "Sign", "FLOW");
  S(2009, "again", "YUI");
  S(2010, "サムライハート (Some Like It Hot!!)", "SPYAIR");
  S(2010, "irony", "ClariS");
  S(2010, "Snow halation", "μ's");
  S(2011, "コネクト", "ClariS");
  S(2011, "oath sign", "LiSA");
  S(2011, "We Go!", "きただにひろし");
  S(2011, "Departure!", "小野正利");
  S(2011, "ONE DAY", "The ROOTLESS");
  S(2012, "crossing field", "LiSA");
  S(2013, "紅蓮の弓矢", "Linked Horizon");
  S(2013, "ルミナス", "ClariS");
  S(2014, "シルエット", "KANA-BOON");
  S(2014, "レット・イット・ゴー～ありのままで～", "松たか子");
  S(2014, "IGNITE", "藍井エイル");
  S(2014, "Rising Hope", "LiSA");
  S(2014, "シルシ", "LiSA");
  S(2014, "イマジネーション", "SPYAIR");
  S(2014, "ひまわりの約束", "秦基博");
  S(2014, "ゲラゲラポーのうた", "キング・クリームソーダ");
  S(2014, "君じゃなきゃダメみたい", "大石昌良");
  S(2014, "光るなら", "Goose house");
  S(2015, "シュガーソングとビターステップ", "UNISON SQUARE GARDEN");
  S(2015, "アイム・ア・ビリーバー", "SPYAIR");
  S(2015, "THE HERO !! ～怒れる拳に火をつけろ～", "JAM Project");
  S(2015, "超絶☆ダイナミック!", "吉井和哉");
  S(2016, "前前前世", "RADWIMPS");
  S(2016, "THE DAY", "ポルノグラフィティ");
  S(2016, "Redo", "鈴木このみ");
  S(2016, "ヒカリアレ", "BURNOUT SYNDROMES");
  S(2017, "打上花火", "DAOKO×米津玄師");
  S(2017, "ピースサイン", "米津玄師");
  S(2017, "Catch the Moment", "LiSA");
  S(2017, "Hope", "安室奈美恵");
  S(2017, "渡月橋 ～君 想ふ～", "倉木麻衣");
  S(2018, "ADAMAS", "LiSA");
  S(2018, "Blizzard", "三浦大知");
  S(2018, "SHINY DAYS", "亜咲花");
  S(2018, "Nameless Story", "寺島拓篤");
  S(2019, "紅蓮華", "LiSA");
  S(2019, "竈門炭治郎のうた", "椎名豪 feat. 中川奈美");
  S(2019, "インフェルノ", "Mrs. GREEN APPLE");
  S(2019, "ハルノヒ", "あいみょん");
  S(2019, "カワキヲアメク", "美波");
  S(2020, "炎", "LiSA");
  S(2020, "廻廻奇譚", "Eve");
  S(2020, "花に亡霊", "ヨルシカ");
  S(2020, "Prover", "milet");
  S(2020, "虹", "菅田将暉");
  S(2020, "ANIMA", "ReoNa");
  S(2020, "PHOENIX", "BURNOUT SYNDROMES");
  S(2020, "DADDY! DADDY! DO! feat. 鈴木愛理", "鈴木雅之");
  S(2021, "Cry Baby", "Official髭男dism");
  S(2021, "One Last Kiss", "宇多田ヒカル");
  S(2021, "怪物", "YOASOBI");
  S(2021, "明け星", "LiSA");
  S(2021, "白銀", "LiSA");
  S(2021, "優しい彗星", "YOASOBI");
  S(2022, "残響散歌", "Aimer");
  S(2022, "ミックスナッツ", "Official髭男dism");
  S(2022, "新時代", "Ado");
  S(2022, "祝福", "YOASOBI");
  S(2022, "KICK BACK", "米津玄師");
  S(2022, "残機", "ずっと真夜中でいいのに。");
  S(2022, "ちゅ、多様性。", "ano");
  S(2022, "第ゼロ感", "10-FEET");
  S(2022, "ギターと孤独と蒼い惑星", "結束バンド");
  S(2022, "花の塔", "さユり");
  S(2022, "私は最強", "Ado");
  S(2023, "アイドル", "YOASOBI");
  S(2023, "青のすみか", "キタニタツヤ");
  S(2023, "勇者", "YOASOBI");
  S(2023, "絆ノ奇跡", "MAN WITH A MISSION × milet");
  S(2023, "Anytime Anywhere", "milet");
  S(2023, "花になって", "緑黄色社会");
  S(2023, "メフィスト", "女王蜂");
  S(2023, "more than words", "羊文学");
  S(2023, "美しい鰭", "スピッツ");
  S(2023, "SPECIALZ", "King Gnu");
  S(2024, "Bling-Bang-Bang-Born", "Creepy Nuts");
  S(2024, "ライラック", "Mrs. GREEN APPLE");
  S(2024, "晴る", "ヨルシカ");
  S(2024, "オレンジ", "SPYAIR");
  S(2024, "UNDEAD", "YOASOBI");
  S(2024, "ファタール", "GEMN");
  S(2024, "夢幻", "MY FIRST STORY × HYDE");
  S(2025, "クスシキ", "Mrs. GREEN APPLE");
  S(2025, "IRIS OUT", "米津玄師");
  S(2025, "Plazma", "米津玄師");
  S(2025, "怪獣", "サカナクション");

  cat = "screen";
  S(1994, "Tomorrow never knows", "Mr.Children");
  S(1996, "LA・LA・LA LOVE SONG", "久保田利伸");
  S(1999, "First Love", "宇多田ヒカル");
  S(2000, "Everything", "MISIA");
  S(2007, "Love so sweet", "嵐");
  S(2007, "明日晴れるかな", "桑田佳祐");
  S(2008, "キセキ", "GReeeeN");
  S(2008, "HANABI", "Mr.Children");
  S(2009, "イチブトゼンブ", "B'z");
  S(2010, "ありがとう", "いきものがかり");
  S(2010, "君に届け", "flumpool");
  S(2011, "Love Story", "安室奈美恵");
  S(2011, "やさしくなりたい", "斉藤和義");
  S(2012, "ヒカリへ", "miwa");
  S(2014, "にじいろ", "絢香");
  S(2015, "クリスマスソング", "back number");
  S(2015, "君がくれた夏", "家入レオ");
  S(2015, "365日の紙飛行機", "AKB48");
  S(2016, "恋", "星野源");
  S(2016, "明日への手紙", "手嶌葵");
  S(2017, "EXCITE", "三浦大知");
  S(2018, "Lemon", "米津玄師");
  S(2018, "アイノカタチ feat.HIDE(GReeeeN)", "MISIA");
  S(2018, "プロローグ", "Uru");
  S(2019, "Pretender", "Official髭男dism");
  S(2019, "白日", "King Gnu");
  S(2019, "us", "milet");
  S(2019, "まちがいさがし", "菅田将暉");
  S(2020, "I LOVE...", "Official髭男dism");
  S(2020, "正しくなれない", "ずっと真夜中でいいのに。");
  S(2020, "裸の心", "あいみょん");
  S(2020, "CITRUS", "Da-iCE");
  S(2020, "あなたがいることで", "Uru");
  S(2021, "ベテルギウス", "優里");
  S(2021, "勿忘", "Awesome City Club");
  S(2022, "Subtitle", "Official髭男dism");
  S(2023, "星月夜", "由薫");
  S(2024, "さよーならまたいつか！", "米津玄師");
  S(2024, "幾億光年", "Omoinotake");
  S(2024, "満ちてゆく", "藤井風");

  cat = "pop";
  S(1985, "ダンシング・ヒーロー (Eat You Up)", "荻野目洋子");
  S(1990, "夏祭り", "JITTERIN'JINN");
  S(1990, "真夏の果実", "サザンオールスターズ");
  S(1992, "決戦は金曜日", "Dreams Come True");
  S(1993, "ロマンスの神様", "広瀬香美");
  S(1993, "負けないで", "ZARD");
  S(1996, "チェリー", "スピッツ");
  S(1998, "HOT LIMIT", "T.M.Revolution");
  S(1999, "カブトムシ", "aiko");
  S(1999, "Love, Day After Tomorrow", "倉木麻衣");
  S(2000, "TSUNAMI", "サザンオールスターズ");
  S(2000, "SEASONS", "浜崎あゆみ");
  S(2001, "小さな恋のうた", "MONGOL800");
  S(2001, "One Night Carnival", "氣志團");
  S(2001, "波乗りジョニー", "桑田佳祐");
  S(2001, "白い恋人達", "桑田佳祐");
  S(2002, "Perseus -ペルセウス-", "島谷ひとみ");
  S(2002, "亜麻色の髪の乙女", "島谷ひとみ");
  S(2003, "Choo Choo TRAIN", "EXILE");
  S(2004, "金魚花火", "大塚愛");
  S(2005, "何度でも", "Dreams Come True");
  S(2006, "SAKURA", "いきものがかり");
  S(2006, "気分上々↑↑", "mihimaru GT");
  S(2008, "愛をこめて花束を", "Superfly");
  S(2008, "気まぐれロマンティック", "いきものがかり");
  S(2008, "帰りたくなったよ", "いきものがかり");
  S(2008, "366日", "HY");
  S(2009, "Butterfly", "木村カエラ");
  S(2009, "女々しくて", "ゴールデンボンバー");
  S(2009, "YELL", "いきものがかり");
  S(2009, "じょいふる", "いきものがかり");
  S(2010, "ずっと好きだった", "斉藤和義");
  S(2010, "Ring a Ding Dong", "木村カエラ");
  S(2010, "Wherever you are", "ONE OK ROCK");
  S(2010, "星に願いを", "flumpool");
  S(2011, "福笑い", "高橋優");
  S(2012, "風が吹いている", "いきものがかり");
  S(2012, "サブリナ", "家入レオ");
  S(2013, "高嶺の花子さん", "back number");
  S(2014, "Darling", "西野カナ");
  S(2015, "トリセツ", "西野カナ");
  S(2015, "もしも運命の人がいるのなら", "西野カナ");
  S(2015, "新宝島", "サカナクション");
  S(2015, "ワタリドリ", "[ALEXANDROS]");
  S(2015, "私以外私じゃないの", "ゲスの極み乙女。");
  S(2015, "ロマンスがありあまる", "ゲスの極み乙女。");
  S(2015, "夜空。feat.ハジ→", "miwa");
  S(2016, "Hero", "安室奈美恵");
  S(2016, "ともに", "WANIMA");
  S(2016, "海の声", "浦島太郎（桐谷健太）");
  S(2016, "PPAP（ペンパイナッポーアッポーペン）", "ピコ太郎");
  S(2017, "猫", "DISH//");
  S(2017, "言って。", "ヨルシカ");
  S(2017, "君はロックを聴かない", "あいみょん");
  S(2017, "愛を伝えたいだとか", "あいみょん");
  S(2017, "やってみよう", "WANIMA");
  S(2017, "世界はあなたに笑いかけている", "Little Glee Monster");
  S(2017, "明日も", "SHISHAMO");
  S(2017, "STAY TUNE", "Suchmos");
  S(2018, "マリーゴールド", "あいみょん");
  S(2018, "U.S.A.", "DA PUMP");
  S(2018, "ただ君に晴れ", "ヨルシカ");
  S(2018, "パプリカ", "Foorin");
  S(2018, "魔法の絨毯", "川崎鷹也");
  S(2018, "さよならエレジー", "菅田将暉");
  S(2018, "別の人の彼女になったよ", "wacci");
  S(2019, "夜に駆ける", "YOASOBI");
  S(2019, "香水", "瑛人");
  S(2019, "宿命", "Official髭男dism");
  S(2019, "だから僕は音楽を辞めた", "ヨルシカ");
  S(2019, "ノーチラス", "ヨルシカ");
  S(2019, "雨とカプチーノ", "ヨルシカ");
  S(2019, "inside you", "milet");
  S(2019, "かくれんぼ", "優里");
  S(2020, "ドライフラワー", "優里");
  S(2020, "怪獣の花唄", "Vaundy");
  S(2020, "群青", "YOASOBI");
  S(2020, "Mela!", "緑黄色社会");
  S(2020, "ハルジオン", "YOASOBI");
  S(2020, "たぶん", "YOASOBI");
  S(2020, "オトナブルー", "新しい学校のリーダーズ");
  S(2020, "死ぬのがいいわ", "藤井風");
  S(2020, "ツキミソウ", "Novelbright");
  S(2020, "恋人ごっこ", "マカロニえんぴつ");
  S(2020, "第六感", "Reol");
  S(2020, "Night Diver", "三浦春馬");
  S(2021, "三原色", "YOASOBI");
  S(2021, "大正浪漫", "YOASOBI");
  S(2021, "もう少しだけ", "YOASOBI");
  S(2021, "ツバメ", "YOASOBI");
  S(2021, "春泥棒", "ヨルシカ");
  S(2021, "シャッター", "優里");
  S(2021, "W/X/Y", "Tani Yuuki");
  S(2021, "きらり", "藤井風");
  S(2021, "シンデレラボーイ", "Saucy Dog");
  S(2021, "なんでもないよ、", "マカロニえんぴつ");
  S(2021, "エジソン", "水曜日のカンパネラ");
  S(2021, "僕は...", "あたらよ");
  S(2021, "アンコール", "YOASOBI");
  S(2021, "海のまにまに", "YOASOBI");
  S(2022, "NIGHT DANCER", "imase");
  S(2022, "スターマイン", "Da-iCE");
  S(2023, "唱", "Ado");
  S(2023, "ケセラセラ", "Mrs. GREEN APPLE");
  S(2023, "晩餐歌", "tuki.");
  S(2023, "I'm a mess", "MY FIRST STORY");
  S(2023, "ランデヴー", "シャイトープ");
  S(2023, "本当はね、", "ヤングスキニー");
  S(2023, "リンジュー・ラヴ", "マカロニえんぴつ");
  S(2023, "アドベンチャー", "YOASOBI");
  S(2023, "一斉ノ喝采", "LiSA");
  S(2024, "舞台に立って", "YOASOBI");
  S(2024, "hanataba", "milet");
  S(2024, "はいよろこんで", "こっちのけんと");
  S(2024, "ハレンチ", "ちゃんみな");
  S(2024, "Bunny Girl", "AKASAKI");
  S(2024, "I wonder", "Da-iCE");
  S(2024, "鬼ノ宴", "友成空");
  S(2025, "ダーリン", "Mrs. GREEN APPLE");
  S(2025, "ROSE", "HANA");
  S(2025, "革命道中", "アイナ・ジ・エンド");
  S(2025, "PUZZLE", "清水翔太");
  S(2025, "SAD SONG", "ちゃんみな");
  S(2025, "B級", "ちゃんみな");
  S(2025, "恋風", "幾田りら");
  S(2025, "百花繚乱", "幾田りら");

  cat = "idol";
  S(2003, "世界に一つだけの花", "SMAP");
  S(2007, "Happiness", "嵐");
  S(2013, "恋するフォーチュンクッキー", "AKB48");
  S(2025, "好きすぎて滅!", "M!LK");

  cat = "net";
  S(2017, "ロキ", "みきとP");
  S(2018, "秒針を噛む", "ずっと真夜中でいいのに。");
  S(2019, "勘冴えて悔しいわ", "ずっと真夜中でいいのに。");
  S(2020, "うっせぇわ", "Ado");
  S(2020, "お勉強しといてよ", "ずっと真夜中でいいのに。");
  S(2020, "暗く黒く", "ずっと真夜中でいいのに。");
  S(2020, "春を告げる", "yama");
  S(2021, "ヨワネハキ", "MAISONdes feat. 和ぬか, asmi");
  S(2022, "可愛くてごめん", "HoneyWorks feat. かぴ");
  S(2022, "Overdose", "なとり");

  cat = "classic";
  S(1979, "真夜中のドア〜stay with me", "松原みき");

  // ================= 華語 =================
  region = "zh";

  cat = "screen";
  S(1994, "新不了情", "萬芳");
  S(1998, "當", "動力火車");
  S(2001, "情非得已", "庾澄慶");
  S(2002, "流星雨", "F4");
  S(2003, "我難過", "5566"); // 偶像劇《MVP情人》片尾曲
  S(2005, "放手一搏", "5566"); // 偶像劇《格鬥天王》片頭曲
  S(2006, "菊花台", "周杰倫");
  S(2007, "不能說的秘密", "周杰倫");
  S(2009, "雨愛", "楊丞琳");
  S(2010, "你不知道的事", "王力宏");
  S(2011, "那些年", "胡夏");
  S(2011, "手掌心", "丁噹");
  S(2015, "小幸運", "田馥甄");
  S(2016, "光年之外", "鄧紫棋");
  S(2020, "刻在我心底的名字", "盧廣仲");
  S(2020, "想見你想見你想見你", "八三夭");
  S(2021, "好不容易", "告五人");

  cat = "pop";
  S(1977, "月亮代表我的心", "鄧麗君");
  S(1979, "甜蜜蜜", "鄧麗君");
  S(1988, "愛拼才會贏", "葉啟田");
  S(1990, "我是一隻小小鳥", "趙傳");
  S(1993, "海闊天空", "Beyond");
  S(1993, "吻別", "張學友");
  S(1994, "忘情水", "劉德華");
  S(1995, "你把我灌醉", "黃大煒");
  S(1996, "挪威的森林", "伍佰");
  S(1996, "姊妹", "張惠妹");
  S(1997, "聽海", "張惠妹");
  S(1997, "朋友", "周華健");
  S(1998, "對面的女孩看過來", "任賢齊");
  S(1998, "愛我別走", "張震嶽");
  S(1998, "紅豆", "王菲");
  S(1999, "擁抱", "五月天");
  S(2000, "後來", "劉若英");
  S(2000, "至少還有你", "林憶蓮");
  S(2000, "溫柔", "五月天");
  S(2000, "勇氣", "梁靜茹");
  S(2000, "龍捲風", "周杰倫");
  S(2001, "綠光", "孫燕姿");
  S(2001, "簡單愛", "周杰倫");
  S(2001, "雙截棍", "周杰倫");
  S(2001, "屋頂", "周杰倫、溫嵐");
  S(2001, "安靜", "周杰倫");
  S(2001, "開不了口", "周杰倫");
  S(2001, "愛在西元前", "周杰倫");
  S(2002, "死了都要愛", "信樂團");
  S(2002, "半島鐵盒", "周杰倫");
  S(2003, "晴天", "周杰倫");
  S(2003, "十年", "陳奕迅");
  S(2003, "突然的自我", "伍佰");
  S(2003, "說愛你", "蔡依林");
  S(2003, "Super Star", "S.H.E");
  S(2003, "愛的主打歌", "蕭亞軒");
  S(2003, "痴心絕對", "李聖傑");
  S(2004, "七里香", "周杰倫");
  S(2004, "江南", "林俊傑");
  S(2004, "倔強", "五月天");
  S(2004, "寧夏", "梁靜茹");
  S(2004, "愛你", "王心凌");
  S(2004, "擱淺", "周杰倫");
  S(2004, "快樂崇拜", "潘瑋柏、張韶涵");
  S(2004, "我們的愛", "飛兒樂團");
  S(2004, "楓", "周杰倫");
  S(2005, "童話", "光良");
  S(2005, "你是我的眼", "蕭煌奇");
  S(2005, "夜曲", "周杰倫");
  S(2005, "可惜不是你", "梁靜茹");
  S(2005, "曖昧", "楊丞琳");
  S(2005, "一路向北", "周杰倫");
  S(2005, "知足", "五月天");
  S(2005, "你不是真正的快樂", "五月天");
  S(2005, "髮如雪", "周杰倫");
  S(2005, "不得不愛", "潘瑋柏、弦子");
  S(2005, "手放開", "李聖傑");
  S(2005, "下雨天", "南拳媽媽");
  S(2005, "為你寫詩", "吳克群");
  S(2006, "小情歌", "蘇打綠");
  S(2006, "舞孃", "蔡依林");
  S(2006, "戀愛ING", "五月天");
  S(2006, "隱形的翅膀", "張韶涵");
  S(2006, "曹操", "林俊傑");
  S(2006, "千里之外", "周杰倫、費玉清");
  S(2006, "我相信", "楊培安");
  S(2006, "精舞門", "羅志祥");
  S(2007, "青花瓷", "周杰倫");
  S(2007, "日不落", "蔡依林");
  S(2007, "中國話", "S.H.E");
  S(2007, "下一個天亮", "郭靜");
  S(2006, "我愛台妹", "MC HotDog、張震嶽");
  S(2006, "聽媽媽的話", "周杰倫");
  S(2007, "一支獨秀", "羅志祥");
  S(2007, "思念是一種病", "張震嶽");
  S(2007, "彩虹", "周杰倫");
  S(2008, "稻香", "周杰倫");
  S(2008, "說好的幸福呢", "周杰倫");
  S(2008, "小酒窩", "林俊傑、蔡卓妍");
  S(2008, "突然好想你", "五月天");
  S(2008, "蒲公英的約定", "周杰倫");
  S(2008, "早安晨之美", "盧廣仲");
  S(2008, "洋蔥", "楊宗緯");
  S(2008, "沒那麼簡單", "黃小琥");
  S(2008, "帶我走", "楊丞琳");
  S(2008, "天后", "陳勢安");
  S(2009, "王妃", "蕭敬騰");
  S(2009, "說謊", "林宥嘉");
  S(2009, "你被寫在我的歌裡", "蘇打綠、Ella");
  S(2009, "失落沙洲", "徐佳瑩");
  S(2009, "心牆", "郭靜");
  S(2010, "她說", "林俊傑");
  S(2010, "背對背擁抱", "林俊傑");
  S(2010, "身騎白馬", "徐佳瑩");
  S(2010, "姊姊", "謝金燕");
  S(2010, "說了再見", "周杰倫");
  S(2010, "超人不會飛", "周杰倫");
  S(2011, "保庇", "王彩樺");
  S(2012, "泡沫", "鄧紫棋");
  S(2012, "我的歌聲裡", "曲婉婷");
  S(2012, "東區東區", "八三夭");
  S(2012, "幸福了 然後呢", "A-Lin");
  S(2012, "明明就", "周杰倫");
  S(2013, "修煉愛情", "林俊傑");
  S(2013, "李白", "李榮浩");
  S(2014, "煎熬", "李佳薇");
  S(2014, "還是會", "韋禮安");
  S(2014, "可惜沒如果", "林俊傑");
  S(2014, "算什麼男人", "周杰倫");
  S(2014, "給我一個理由忘記", "A-Lin");
  S(2014, "手寫的從前", "周杰倫");
  S(2015, "不為誰而作的歌", "林俊傑");
  S(2015, "帥到分手", "周湯豪");
  S(2015, "來自天堂的魔鬼", "鄧紫棋");
  S(2016, "告白氣球", "周杰倫");
  S(2016, "派對動物", "五月天");
  S(2017, "漂向北方", "黃明志");
  S(2017, "魚仔", "盧廣仲");
  S(2017, "浪子回頭", "茄子蛋");
  S(2017, "我們不一樣", "大壯");
  S(2018, "學貓叫", "小潘潘、小峰峰");
  S(2018, "等你下課", "周杰倫");
  S(2019, "愛人錯過", "告五人");
  S(2019, "帶我去找夜生活", "告五人");
  S(2019, "披星戴月的想你", "告五人");
  S(2021, "唯一", "告五人");

  // ================= 韓國（只留台灣／日本也廣為人知的）=================
  region = "ko";

  cat = "pop";
  S(2012, "강남스타일 (Gangnam Style)", "PSY");

  cat = "idol";
  S(2007, "Tell Me", "Wonder Girls");
  S(2008, "Nobody", "Wonder Girls");
  S(2009, "Gee", "少女時代");
  S(2009, "Sorry, Sorry", "SUPER JUNIOR");
  S(2012, "Fantastic Baby", "BIGBANG");
  S(2015, "BANG BANG BANG", "BIGBANG");
  S(2016, "TT", "TWICE");
  S(2016, "Cheer Up", "TWICE");
  S(2017, "DNA", "BTS");
  S(2018, "DDU-DU DDU-DU", "BLACKPINK");
  S(2020, "Dynamite", "BTS");
  S(2020, "How You Like That", "BLACKPINK");
  S(2021, "Butter", "BTS");
  S(2022, "Hype Boy", "NewJeans");
  S(2024, "APT.", "ROSÉ & Bruno Mars");

  // ================= 歐美（只留台灣／日本也廣為人知的經典）=================
  region = "en";

  cat = "screen";
  S(1992, "I Will Always Love You", "Whitney Houston");
  S(1997, "My Heart Will Go On", "Celine Dion");
  S(2013, "Let It Go", "Idina Menzel");
  S(2015, "See You Again", "Wiz Khalifa ft. Charlie Puth");

  cat = "pop";
  S(1965, "Yesterday", "The Beatles");
  S(1968, "Hey Jude", "The Beatles");
  S(1970, "Let It Be", "The Beatles");
  S(1971, "Imagine", "John Lennon");
  S(1971, "Take Me Home, Country Roads", "John Denver");
  S(1973, "Yesterday Once More", "Carpenters");
  S(1975, "Bohemian Rhapsody", "Queen");
  S(1976, "Dancing Queen", "ABBA");
  S(1977, "We Will Rock You", "Queen");
  S(1983, "Billie Jean", "Michael Jackson");
  S(1985, "We Are the World", "USA for Africa");
  S(1994, "All I Want for Christmas Is You", "Mariah Carey");
  S(1998, "...Baby One More Time", "Britney Spears");
  S(1999, "I Want It That Way", "Backstreet Boys");
  S(2010, "Baby", "Justin Bieber");
  S(2017, "Shape of You", "Ed Sheeran");
  S(2017, "Despacito", "Luis Fonsi ft. Daddy Yankee");

  function decadeOf(song) { return Math.floor(song.y / 10) * 10; }

  // 歌單中實際出現的年代（由舊到新）
  function decades() {
    var seen = {};
    songs.forEach(function (s) { seen[decadeOf(s)] = true; });
    return Object.keys(seen).map(Number).sort(function (a, b) { return a - b; });
  }

  function text(obj, lang) {
    if (!obj) return "";
    return obj[lang] || obj.zh || obj.ja || "";
  }

  function find(list, id) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function byId(id) { return find(songs, id); }
  function variant(id) { return find(VARIANTS, id); }
  function region_(id) { return find(REGIONS, id); }
  function category(id) { return find(CATEGORIES, id); }

  window.PriTestUtauSongs = {
    regions: REGIONS,
    categories: CATEGORIES,
    variants: VARIANTS,
    songs: songs,
    decadeOf: decadeOf,
    decades: decades,
    text: text,
    byId: byId,
    variant: variant,
    region: region_,
    category: category
  };
})();
