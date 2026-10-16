// 我不會唱歌（utau）的歌單、分類與題庫包音檔版本。
// 歌單是題庫包製作工具（tools/utau_clips/build_pack.py）查歌名／歌手／年份／分類用的目錄。
// 新增歌曲：在對應「地區＋分類」的區塊加一行 S(年份, "歌名", "歌手")。年代由年份自動換算（1985 → 1980s）。
// 選曲方針（使用者指定）：以日本歌為主並細分類別；歐美、韓國只留在台灣／日本也廣為人知的歌。
// 歌名、歌手保留原文；id 由地區＋歌名組成，同地區內不要重複歌名。
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
      id: "speed",
      name: { zh: "變速變調", ja: "速度・キー変更", en: "Speed & pitch" },
      desc: { zh: "整段加速升調或放慢降調", ja: "テンポとキーを上げる／下げる", en: "Sped up and raised, or slowed and lowered" }
    },
    {
      id: "rhythm",
      name: { zh: "只有鼓＋貝斯", ja: "ドラム＋ベースのみ", en: "Drums & bass only" },
      desc: { zh: "只剩節奏組，高難度", ja: "リズム隊だけ。高難度", en: "Rhythm section only. Hard!" }
    },
    {
      id: "melody",
      name: { zh: "八音盒／8bit", ja: "オルゴール／8bit", en: "Music box / 8-bit" },
      desc: { zh: "歌聲旋律改用八音盒或 8bit 音色演奏", ja: "歌のメロディをオルゴールか8bit音で演奏", en: "The vocal melody replayed as a music box or 8-bit tune" }
    }
  ];

  var songs = [];
  var region = null;
  var cat = null;
  function S(year, title, artist) {
    songs.push({ id: region + ":" + title, r: region, c: cat, y: year, t: title, a: artist });
  }

  // ================= 日本 =================
  region = "ja";

  cat = "anime";
  S(1968, "ゲゲゲの鬼太郎", "熊倉一雄");
  S(1974, "宇宙戦艦ヤマト", "ささきいさお");
  S(1976, "キャンディ・キャンディ", "堀江美都子");
  S(1979, "ドラえもんのうた", "大杉久美子");
  S(1979, "銀河鉄道999", "ゴダイゴ");
  S(1984, "愛をとりもどせ!!", "クリスタルキング");
  S(1985, "タッチ", "岩崎良美");
  S(1986, "摩訶不思議アドベンチャー!", "高橋洋樹");
  S(1986, "ペガサス幻想", "MAKE-UP");
  S(1986, "君をのせて", "井上あずみ");
  S(1987, "Get Wild", "TM NETWORK");
  S(1988, "さんぽ", "井上あずみ");
  S(1988, "アンパンマンのマーチ", "ドリーミング");
  S(1989, "CHA-LA HEAD-CHA-LA", "影山ヒロノブ");
  S(1990, "おどるポンポコリン", "B.B.クィーンズ");
  S(1992, "ムーンライト伝説", "DALI");
  S(1993, "君が好きだと叫びたい", "BAAD");
  S(1994, "ゆずれない願い", "田村直美");
  S(1995, "残酷な天使のテーゼ", "高橋洋子");
  S(1996, "そばかす", "JUDY AND MARY");
  S(1996, "DAN DAN 心魅かれてく", "FIELD OF VIEW");
  S(1997, "めざせポケモンマスター", "松本梨香");
  S(1997, "もののけ姫", "米良美一");
  S(1998, "Catch You Catch Me", "グミ");
  S(1999, "ウィーアー!", "きただにひろし");
  S(1999, "Butter-Fly", "和田光司");
  S(1999, "Driver's High", "L'Arc～en～Ciel");
  S(2001, "いつも何度でも", "木村弓");
  S(2003, "メリッサ", "ポルノグラフィティ");
  S(2003, "悲しみをやさしさに", "little by little");
  S(2004, "GO!!!", "FLOW");
  S(2004, "READY STEADY GO", "L'Arc～en～Ciel");
  S(2005, "創聖のアクエリオン", "AKINO");
  S(2006, "ハレ晴レユカイ", "平野綾・茅原実里・後藤邑子");
  S(2006, "God knows...", "平野綾");
  S(2007, "夢をかなえてドラえもん", "mao");
  S(2008, "ブルーバード", "いきものがかり");
  S(2009, "only my railgun", "fripSide");
  S(2009, "Don't say \"lazy\"", "桜高軽音部");
  S(2010, "恋愛サーキュレーション", "千石撫子（花澤香菜）");
  S(2011, "コネクト", "ClariS");
  S(2013, "紅蓮の弓矢", "Linked Horizon");
  S(2014, "unravel", "TK from 凛として時雨");
  S(2014, "シルエット", "KANA-BOON");
  S(2014, "レット・イット・ゴー～ありのままで～", "松たか子");
  S(2015, "シュガーソングとビターステップ", "UNISON SQUARE GARDEN");
  S(2016, "前前前世", "RADWIMPS");
  S(2016, "なんでもないや", "RADWIMPS");
  S(2017, "打上花火", "DAOKO×米津玄師");
  S(2017, "ようこそジャパリパークへ", "どうぶつビスケッツ×PPP");
  S(2017, "ピースサイン", "米津玄師");
  S(2018, "ドラえもん", "星野源");
  S(2019, "紅蓮華", "LiSA");
  S(2019, "竈門炭治郎のうた", "椎名豪 feat. 中川奈美");
  S(2019, "愛にできることはまだあるかい", "RADWIMPS");
  S(2020, "炎", "LiSA");
  S(2020, "廻廻奇譚", "Eve");
  S(2021, "Cry Baby", "Official髭男dism");
  S(2021, "One Last Kiss", "宇多田ヒカル");
  S(2022, "残響散歌", "Aimer");
  S(2022, "ミックスナッツ", "Official髭男dism");
  S(2022, "新時代", "Ado");
  S(2022, "星座になれたら", "結束バンド");
  S(2023, "アイドル", "YOASOBI");
  S(2023, "青のすみか", "キタニタツヤ");
  S(2023, "勇者", "YOASOBI");
  S(2024, "Bling-Bang-Bang-Born", "Creepy Nuts");
  S(2024, "オトノケ", "Creepy Nuts");

  cat = "screen";
  S(1981, "セーラー服と機関銃", "薬師丸ひろ子");
  S(1985, "恋におちて -Fall in love-", "小林明子");
  S(1991, "ラブ・ストーリーは突然に", "小田和正");
  S(1991, "SAY YES", "CHAGE&ASKA");
  S(1992, "君がいるだけで", "米米CLUB");
  S(1992, "世界中の誰よりきっと", "中山美穂&WANDS");
  S(1993, "YAH YAH YAH", "CHAGE&ASKA");
  S(1994, "春よ、来い", "松任谷由実");
  S(1995, "Tomorrow", "岡本真夜");
  S(1996, "LA・LA・LA LOVE SONG", "久保田利伸 with ナオミ・キャンベル");
  S(1996, "名もなき詩", "Mr.Children");
  S(1997, "CAN YOU CELEBRATE?", "安室奈美恵");
  S(1998, "Time goes by", "Every Little Thing");
  S(1999, "First Love", "宇多田ヒカル");
  S(2000, "Everything", "MISIA");
  S(2000, "地上の星", "中島みゆき");
  S(2004, "瞳をとじて", "平井堅");
  S(2005, "粉雪", "レミオロメン");
  S(2005, "Planetarium", "大塚愛");
  S(2005, "青春アミーゴ", "修二と彰");
  S(2007, "Flavor Of Life", "宇多田ヒカル");
  S(2007, "Love so sweet", "嵐");
  S(2008, "キセキ", "GReeeeN");
  S(2010, "ありがとう", "いきものがかり");
  S(2011, "マル・マル・モリ・モリ!", "薫と友樹、たまにムック。");
  S(2013, "潮騒のメモリー", "天野春子（小泉今日子）");
  S(2016, "恋", "星野源");
  S(2018, "Lemon", "米津玄師");
  S(2019, "Pretender", "Official髭男dism");
  S(2019, "白日", "King Gnu");
  S(2020, "感電", "米津玄師");
  S(2020, "I LOVE...", "Official髭男dism");
  S(2022, "Subtitle", "Official髭男dism");

  cat = "pop";
  S(1990, "愛は勝つ", "KAN");
  S(1990, "夏祭り", "JITTERIN'JINN");
  S(1991, "どんなときも。", "槇原敬之");
  S(1993, "負けないで", "ZARD");
  S(1993, "ロマンスの神様", "広瀬香美");
  S(1994, "innocent world", "Mr.Children");
  S(1995, "ロビンソン", "スピッツ");
  S(1995, "Hello, Again ～昔からある場所～", "My Little Lover");
  S(1995, "LOVE LOVE LOVE", "DREAMS COME TRUE");
  S(1995, "WOW WAR TONIGHT", "H Jungle with t");
  S(1996, "DEPARTURES", "globe");
  S(1996, "チェリー", "スピッツ");
  S(1998, "Automatic", "宇多田ヒカル");
  S(2000, "TSUNAMI", "サザンオールスターズ");
  S(2001, "天体観測", "BUMP OF CHICKEN");
  S(2001, "小さな恋のうた", "MONGOL800");
  S(2001, "涙そうそう", "夏川りみ");
  S(2001, "Lifetime Respect", "三木道三");
  S(2003, "さくらんぼ", "大塚愛");
  S(2003, "雪の華", "中島美嘉");
  S(2003, "さくら（独唱）", "森山直太朗");
  S(2003, "Choo Choo TRAIN", "EXILE");
  S(2004, "ハナミズキ", "一青窈");
  S(2004, "栄光の架橋", "ゆず");
  S(2004, "3月9日", "レミオロメン");
  S(2005, "桜", "コブクロ");
  S(2005, "Story", "AI");
  S(2006, "純恋歌", "湘南乃風");
  S(2007, "蕾", "コブクロ");
  S(2008, "そばにいるね", "青山テルマ feat.SoulJa");
  S(2008, "愛をこめて花束を", "Superfly");
  S(2009, "Butterfly", "木村カエラ");
  S(2009, "女々しくて", "ゴールデンボンバー");
  S(2010, "トイレの神様", "植村花菜");
  S(2011, "家族になろうよ", "福山雅治");
  S(2011, "PONPONPON", "きゃりーぱみゅぱみゅ");
  S(2012, "つけまつける", "きゃりーぱみゅぱみゅ");
  S(2014, "R.Y.U.S.E.I.", "三代目 J Soul Brothers");
  S(2017, "猫", "DISH//");
  S(2018, "マリーゴールド", "あいみょん");
  S(2018, "青と夏", "Mrs. GREEN APPLE");
  S(2018, "U.S.A.", "DA PUMP");
  S(2019, "夜に駆ける", "YOASOBI");
  S(2019, "香水", "瑛人");
  S(2020, "ドライフラワー", "優里");
  S(2020, "怪獣の花唄", "Vaundy");
  S(2020, "群青", "YOASOBI");
  S(2023, "唱", "Ado");
  S(2023, "ケセラセラ", "Mrs. GREEN APPLE");

  cat = "idol";
  S(1977, "UFO", "ピンク・レディー");
  S(1982, "赤いスイートピー", "松田聖子");
  S(1982, "少女A", "中森明菜");
  S(1985, "なんてったってアイドル", "小泉今日子");
  S(1986, "DESIRE -情熱-", "中森明菜");
  S(1987, "ガラスの十代", "光GENJI");
  S(1997, "硝子の少年", "KinKi Kids");
  S(1998, "夜空ノムコウ", "SMAP");
  S(1999, "LOVEマシーン", "モーニング娘。");
  S(2000, "らいおんハート", "SMAP");
  S(2000, "ハッピーサマーウェディング", "モーニング娘。");
  S(2003, "世界に一つだけの花", "SMAP");
  S(2006, "Real Face", "KAT-TUN");
  S(2007, "Happiness", "嵐");
  S(2007, "ポリリズム", "Perfume");
  S(2008, "truth", "嵐");
  S(2010, "ヘビーローテーション", "AKB48");
  S(2011, "フライングゲット", "AKB48");
  S(2013, "恋するフォーチュンクッキー", "AKB48");
  S(2016, "サイレントマジョリティー", "欅坂46");
  S(2017, "インフルエンサー", "乃木坂46");
  S(2018, "シンデレラガール", "King & Prince");
  S(2020, "Make you happy", "NiziU");

  cat = "net";
  S(2007, "みくみくにしてあげる♪【してやんよ】", "ika feat. 初音ミク");
  S(2007, "メルト", "ryo feat. 初音ミク");
  S(2008, "ワールドイズマイン", "ryo feat. 初音ミク");
  S(2008, "ブラック★ロックシューター", "ryo feat. 初音ミク");
  S(2008, "恋は戦争", "ryo feat. 初音ミク");
  S(2008, "炉心融解", "iroha feat. 鏡音リン");
  S(2010, "マトリョシカ", "ハチ feat. 初音ミク・GUMI");
  S(2010, "ローリンガール", "wowaka feat. 初音ミク");
  S(2011, "千本桜", "黒うさP feat. 初音ミク");
  S(2011, "カゲロウデイズ", "じん feat. 初音ミク");
  S(2011, "天ノ弱", "164 feat. GUMI");
  S(2012, "脳漿炸裂ガール", "れるりり feat. 初音ミク・GUMI");
  S(2016, "シャルル", "バルーン feat. flower");
  S(2017, "砂の惑星", "ハチ feat. 初音ミク");
  S(2017, "ヒバナ", "DECO*27 feat. 初音ミク");
  S(2018, "ロキ", "みきとP feat. 鏡音リン");
  S(2020, "グッバイ宣言", "Chinozo feat. flower");
  S(2020, "うっせぇわ", "Ado");
  S(2020, "KING", "Kanaria feat. GUMI");
  S(2021, "ヴァンパイア", "DECO*27 feat. 初音ミク");
  S(2022, "可愛くてごめん", "HoneyWorks feat. かぴ");

  cat = "classic";
  S(1961, "上を向いて歩こう", "坂本九");
  S(1963, "見上げてごらん夜の星を", "坂本九");
  S(1974, "学園天国", "フィンガー5");
  S(1975, "ルージュの伝言", "荒井由実");
  S(1975, "木綿のハンカチーフ", "太田裕美");
  S(1977, "津軽海峡・冬景色", "石川さゆり");
  S(1977, "北国の春", "千昌夫");
  S(1978, "勝手にシンドバッド", "サザンオールスターズ");
  S(1978, "与作", "北島三郎");
  S(1979, "いとしのエリー", "サザンオールスターズ");
  S(1979, "異邦人", "久保田早紀");
  S(1979, "YOUNG MAN (Y.M.C.A.)", "西城秀樹");
  S(1980, "乾杯", "長渕剛");
  S(1981, "ルビーの指環", "寺尾聰");
  S(1983, "ワインレッドの心", "安全地帯");
  S(1983, "15の夜", "尾崎豊");
  S(1984, "六本木心中", "アン・ルイス");
  S(1984, "まつり", "北島三郎");
  S(1985, "卒業", "尾崎豊");
  S(1986, "時の流れに身をまかせ", "テレサ・テン");
  S(1986, "天城越え", "石川さゆり");
  S(1989, "川の流れのように", "美空ひばり");
  S(1989, "未来予想図II", "DREAMS COME TRUE");
  S(1992, "島唄", "THE BOOM");
  S(1992, "糸", "中島みゆき");

  // ================= 華語 =================
  region = "zh";

  cat = "screen";
  S(1979, "小城故事", "鄧麗君");
  S(1983, "酒干倘賣無", "蘇芮");
  S(1994, "新不了情", "萬芳");
  S(2001, "情非得已", "庾澄慶");
  S(2007, "不能說的秘密", "周杰倫");
  S(2011, "那些年", "胡夏");
  S(2014, "平凡之路", "樸樹");
  S(2015, "小幸運", "田馥甄");
  S(2016, "光年之外", "鄧紫棋");
  S(2020, "刻在我心底的名字", "盧廣仲");

  cat = "pop";
  S(1977, "月亮代表我的心", "鄧麗君");
  S(1979, "甜蜜蜜", "鄧麗君");
  S(1979, "恰似你的溫柔", "蔡琴");
  S(1982, "童年", "羅大佑");
  S(1982, "鹿港小鎮", "羅大佑");
  S(1987, "我只在乎你", "鄧麗君");
  S(1987, "大約在冬季", "齊秦");
  S(1987, "外面的世界", "齊秦");
  S(1988, "我的未來不是夢", "張雨生");
  S(1988, "愛拼才會贏", "葉啟田");
  S(1989, "真的愛你", "Beyond");
  S(1989, "千千闕歌", "陳慧嫻");
  S(1989, "夢醒時分", "陳淑樺");
  S(1990, "光輝歲月", "Beyond");
  S(1990, "我是一隻小小鳥", "趙傳");
  S(1992, "紅日", "李克勤");
  S(1993, "海闊天空", "Beyond");
  S(1993, "情人", "Beyond");
  S(1993, "吻別", "張學友");
  S(1994, "忘情水", "劉德華");
  S(1995, "一千個傷心的理由", "張學友");
  S(1996, "心太軟", "任賢齊");
  S(1996, "挪威的森林", "伍佰");
  S(1996, "姊妹", "張惠妹");
  S(1997, "聽海", "張惠妹");
  S(1997, "冰雨", "劉德華");
  S(1998, "對面的女孩看過來", "任賢齊");
  S(2000, "後來", "劉若英");
  S(2000, "至少還有你", "林憶蓮");
  S(2000, "溫柔", "五月天");
  S(2000, "勇氣", "梁靜茹");
  S(2000, "天黑黑", "孫燕姿");
  S(2001, "綠光", "孫燕姿");
  S(2001, "簡單愛", "周杰倫");
  S(2001, "雙截棍", "周杰倫");
  S(2001, "屋頂", "周杰倫、溫嵐");
  S(2001, "唯一", "王力宏");
  S(2003, "晴天", "周杰倫");
  S(2003, "遇見", "孫燕姿");
  S(2003, "十年", "陳奕迅");
  S(2003, "突然的自我", "伍佰");
  S(2003, "說愛你", "蔡依林");
  S(2003, "生如夏花", "樸樹");
  S(2004, "七里香", "周杰倫");
  S(2004, "江南", "林俊傑");
  S(2004, "倔強", "五月天");
  S(2004, "寧夏", "梁靜茹");
  S(2004, "愛你", "王心凌");
  S(2005, "浮誇", "陳奕迅");
  S(2005, "童話", "光良");
  S(2005, "大城小愛", "王力宏");
  S(2005, "你是我的眼", "蕭煌奇");
  S(2006, "富士山下", "陳奕迅");
  S(2006, "小情歌", "蘇打綠");
  S(2006, "舞孃", "蔡依林");
  S(2006, "戀愛ING", "五月天");
  S(2007, "青花瓷", "周杰倫");
  S(2007, "日不落", "蔡依林");
  S(2008, "稻香", "周杰倫");
  S(2008, "說好的幸福呢", "周杰倫");
  S(2008, "小酒窩", "林俊傑、蔡卓妍");
  S(2008, "突然好想你", "五月天");
  S(2010, "她說", "林俊傑");
  S(2012, "泡沫", "鄧紫棋");
  S(2012, "我的歌聲裡", "曲婉婷");
  S(2013, "修煉愛情", "林俊傑");
  S(2014, "煎熬", "李佳薇");
  S(2015, "演員", "薛之謙");
  S(2016, "告白氣球", "周杰倫");
  S(2016, "大風吹", "草東沒有派對");
  S(2017, "漂向北方", "黃明志");
  S(2017, "魚仔", "盧廣仲");
  S(2018, "年少有為", "李榮浩");
  S(2018, "學貓叫", "小潘潘、小峰峰");
  S(2019, "少年", "夢然");
  S(2019, "愛人錯過", "告五人");
  S(2021, "孤勇者", "陳奕迅");

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
  S(1999, "I Want It That Way", "Backstreet Boys");
  S(1998, "...Baby One More Time", "Britney Spears");
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
