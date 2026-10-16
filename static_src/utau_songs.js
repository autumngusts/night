// 我不會唱歌（utau）進階模式的歌單與演唱方式。
// 新增歌曲：在對應地區的區塊加一行 S(年份, "歌名", "歌手")。年代由年份自動換算（1985 → 1980s）。
// 歌名、歌手保留原文；id 由地區＋歌名組成，同地區內不要重複歌名。
(function () {
  "use strict";

  var REGIONS = [
    { id: "zh", name: { zh: "華語", ja: "中華圏", en: "Mandarin / Cantonese" } },
    { id: "ja", name: { zh: "日本", ja: "日本", en: "Japanese" } },
    { id: "ko", name: { zh: "韓國", ja: "韓国", en: "Korean" } },
    { id: "en", name: { zh: "歐美", ja: "洋楽", en: "Western" } }
  ];

  var STYLES = [
    {
      id: "instrumental",
      name: { zh: "純樂器", ja: "楽器のみ", en: "Instrumental" },
      desc: {
        zh: "不能唱歌詞，只能用哼、口哨或模仿樂器的聲音表現旋律",
        ja: "歌詞は禁止。ハミング・口笛・楽器のモノマネでメロディだけを表現する",
        en: "No lyrics: hum, whistle or imitate instruments to carry the melody"
      }
    },
    {
      id: "vocal",
      name: { zh: "純人聲", ja: "アカペラ", en: "A cappella" },
      desc: {
        zh: "沒有伴奏，照原曲的旋律與歌詞清唱",
        ja: "伴奏なしで、原曲のメロディと歌詞のままアカペラで歌う",
        en: "No backing: sing the original melody and lyrics unaccompanied"
      }
    },
    {
      id: "variation",
      name: { zh: "變奏版", ja: "アレンジ版", en: "Variation" },
      desc: {
        zh: "把節奏或曲風整個換掉（例如抒情改搖滾、改饒舌、改演歌）",
        ja: "リズムや曲調をガラッと変える（バラード→ロック、ラップ、演歌など）",
        en: "Change the rhythm or genre (ballad as rock, rap, enka, etc.)"
      }
    },
    {
      id: "lyrics",
      name: { zh: "歌詞變化版", ja: "替え歌", en: "New lyrics" },
      desc: {
        zh: "旋律照原曲，歌詞換成自己即興編的內容",
        ja: "メロディは原曲のまま、歌詞を自分で即興の替え歌にする",
        en: "Keep the original melody, improvise your own lyrics"
      }
    }
  ];

  var songs = [];
  var region = null;
  function S(year, title, artist) {
    songs.push({ id: region + ":" + title, r: region, y: year, t: title, a: artist });
  }

  region = "zh";
  S(1977, "月亮代表我的心", "鄧麗君");
  S(1979, "甜蜜蜜", "鄧麗君");
  S(1979, "小城故事", "鄧麗君");
  S(1979, "恰似你的溫柔", "蔡琴");
  S(1982, "童年", "羅大佑");
  S(1982, "鹿港小鎮", "羅大佑");
  S(1983, "酒干倘賣無", "蘇芮");
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
  S(1994, "新不了情", "萬芳");
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
  S(2001, "情非得已", "庾澄慶");
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
  S(2007, "不能說的秘密", "周杰倫");
  S(2007, "日不落", "蔡依林");
  S(2008, "稻香", "周杰倫");
  S(2008, "說好的幸福呢", "周杰倫");
  S(2008, "小酒窩", "林俊傑、蔡卓妍");
  S(2008, "突然好想你", "五月天");
  S(2010, "她說", "林俊傑");
  S(2011, "那些年", "胡夏");
  S(2012, "泡沫", "鄧紫棋");
  S(2012, "我的歌聲裡", "曲婉婷");
  S(2013, "修煉愛情", "林俊傑");
  S(2014, "平凡之路", "樸樹");
  S(2014, "煎熬", "李佳薇");
  S(2015, "演員", "薛之謙");
  S(2015, "小幸運", "田馥甄");
  S(2016, "告白氣球", "周杰倫");
  S(2016, "光年之外", "鄧紫棋");
  S(2016, "大風吹", "草東沒有派對");
  S(2017, "漂向北方", "黃明志");
  S(2017, "魚仔", "盧廣仲");
  S(2018, "年少有為", "李榮浩");
  S(2018, "學貓叫", "小潘潘、小峰峰");
  S(2019, "少年", "夢然");
  S(2019, "愛人錯過", "告五人");
  S(2020, "刻在我心底的名字", "盧廣仲");
  S(2021, "孤勇者", "陳奕迅");

  region = "ja";
  S(1961, "上を向いて歩こう", "坂本九");
  S(1974, "学園天国", "フィンガー5");
  S(1975, "ルージュの伝言", "荒井由実");
  S(1975, "木綿のハンカチーフ", "太田裕美");
  S(1977, "津軽海峡・冬景色", "石川さゆり");
  S(1977, "北国の春", "千昌夫");
  S(1979, "いとしのエリー", "サザンオールスターズ");
  S(1979, "異邦人", "久保田早紀");
  S(1982, "赤いスイートピー", "松田聖子");
  S(1983, "15の夜", "尾崎豊");
  S(1985, "卒業", "尾崎豊");
  S(1985, "恋におちて -Fall in love-", "小林明子");
  S(1986, "時の流れに身をまかせ", "テレサ・テン");
  S(1987, "Get Wild", "TM NETWORK");
  S(1989, "川の流れのように", "美空ひばり");
  S(1989, "未来予想図II", "DREAMS COME TRUE");
  S(1990, "愛は勝つ", "KAN");
  S(1990, "夏祭り", "JITTERIN'JINN");
  S(1991, "SAY YES", "CHAGE&ASKA");
  S(1991, "ラブ・ストーリーは突然に", "小田和正");
  S(1991, "どんなときも。", "槇原敬之");
  S(1992, "君がいるだけで", "米米CLUB");
  S(1992, "島唄", "THE BOOM");
  S(1992, "糸", "中島みゆき");
  S(1993, "負けないで", "ZARD");
  S(1994, "春よ、来い", "松任谷由実");
  S(1995, "ロビンソン", "スピッツ");
  S(1995, "残酷な天使のテーゼ", "高橋洋子");
  S(1995, "WOW WAR TONIGHT", "H Jungle with t");
  S(1995, "LOVE LOVE LOVE", "DREAMS COME TRUE");
  S(1996, "チェリー", "スピッツ");
  S(1997, "CAN YOU CELEBRATE?", "安室奈美恵");
  S(1997, "硝子の少年", "KinKi Kids");
  S(1998, "夜空ノムコウ", "SMAP");
  S(1998, "Automatic", "宇多田ヒカル");
  S(1999, "First Love", "宇多田ヒカル");
  S(1999, "LOVEマシーン", "モーニング娘。");
  S(2000, "TSUNAMI", "サザンオールスターズ");
  S(2000, "地上の星", "中島みゆき");
  S(2001, "天体観測", "BUMP OF CHICKEN");
  S(2001, "小さな恋のうた", "MONGOL800");
  S(2001, "涙そうそう", "夏川りみ");
  S(2003, "世界に一つだけの花", "SMAP");
  S(2003, "さくらんぼ", "大塚愛");
  S(2003, "雪の華", "中島美嘉");
  S(2004, "ハナミズキ", "一青窈");
  S(2004, "栄光の架橋", "ゆず");
  S(2004, "3月9日", "レミオロメン");
  S(2005, "粉雪", "レミオロメン");
  S(2005, "桜", "コブクロ");
  S(2008, "愛をこめて花束を", "Superfly");
  S(2010, "ヘビーローテーション", "AKB48");
  S(2011, "千本桜", "黒うさP feat. 初音ミク");
  S(2013, "恋するフォーチュンクッキー", "AKB48");
  S(2016, "前前前世", "RADWIMPS");
  S(2016, "恋", "星野源");
  S(2017, "猫", "DISH//");
  S(2018, "Lemon", "米津玄師");
  S(2018, "パプリカ", "Foorin");
  S(2018, "マリーゴールド", "あいみょん");
  S(2018, "青と夏", "Mrs. GREEN APPLE");
  S(2019, "白日", "King Gnu");
  S(2019, "Pretender", "Official髭男dism");
  S(2019, "夜に駆ける", "YOASOBI");
  S(2019, "紅蓮華", "LiSA");
  S(2019, "香水", "瑛人");
  S(2020, "炎", "LiSA");
  S(2020, "うっせぇわ", "Ado");
  S(2020, "ドライフラワー", "優里");
  S(2020, "怪獣の花唄", "Vaundy");
  S(2022, "新時代", "Ado");
  S(2022, "ミックスナッツ", "Official髭男dism");
  S(2023, "アイドル", "YOASOBI");
  S(2023, "唱", "Ado");
  S(2023, "ケセラセラ", "Mrs. GREEN APPLE");
  S(2024, "Bling-Bang-Bang-Born", "Creepy Nuts");

  region = "ko";
  S(1988, "붉은 노을", "이문세");
  S(1992, "난 알아요", "서태지와 아이들");
  S(2003, "소주 한 잔", "임창정");
  S(2007, "Tell Me", "Wonder Girls");
  S(2007, "거짓말", "BIGBANG");
  S(2008, "Nobody", "Wonder Girls");
  S(2009, "Gee", "少女時代");
  S(2009, "Sorry, Sorry", "SUPER JUNIOR");
  S(2009, "Ring Ding Dong", "SHINee");
  S(2009, "Abracadabra", "Brown Eyed Girls");
  S(2010, "좋은 날", "IU");
  S(2011, "Bubble Pop!", "HyunA");
  S(2011, "Fiction", "BEAST");
  S(2012, "강남스타일 (Gangnam Style)", "PSY");
  S(2012, "Fantastic Baby", "BIGBANG");
  S(2013, "으르렁 (Growl)", "EXO");
  S(2015, "BANG BANG BANG", "BIGBANG");
  S(2016, "Cheer Up", "TWICE");
  S(2016, "TT", "TWICE");
  S(2016, "피 땀 눈물 (Blood Sweat & Tears)", "BTS");
  S(2017, "DNA", "BTS");
  S(2017, "밤편지", "IU");
  S(2017, "빨간 맛 (Red Flavor)", "Red Velvet");
  S(2018, "DDU-DU DDU-DU", "BLACKPINK");
  S(2018, "Bad Boy", "Red Velvet");
  S(2019, "Kill This Love", "BLACKPINK");
  S(2019, "MIROH", "Stray Kids");
  S(2020, "Dynamite", "BTS");
  S(2020, "How You Like That", "BLACKPINK");
  S(2021, "Butter", "BTS");
  S(2021, "Next Level", "aespa");
  S(2021, "Celebrity", "IU");
  S(2022, "Hype Boy", "NewJeans");
  S(2022, "Ditto", "NewJeans");
  S(2022, "LOVE DIVE", "IVE");
  S(2023, "Super Shy", "NewJeans");
  S(2024, "Supernova", "aespa");
  S(2024, "APT.", "ROSÉ & Bruno Mars");

  region = "en";
  S(1965, "Yesterday", "The Beatles");
  S(1968, "Hey Jude", "The Beatles");
  S(1969, "My Way", "Frank Sinatra");
  S(1970, "Let It Be", "The Beatles");
  S(1971, "Imagine", "John Lennon");
  S(1971, "Take Me Home, Country Roads", "John Denver");
  S(1973, "Yesterday Once More", "Carpenters");
  S(1975, "Bohemian Rhapsody", "Queen");
  S(1976, "Dancing Queen", "ABBA");
  S(1977, "We Will Rock You", "Queen");
  S(1977, "Hotel California", "Eagles");
  S(1977, "Stayin' Alive", "Bee Gees");
  S(1978, "Y.M.C.A.", "Village People");
  S(1983, "Billie Jean", "Michael Jackson");
  S(1983, "Beat It", "Michael Jackson");
  S(1983, "Every Breath You Take", "The Police");
  S(1983, "Girls Just Want to Have Fun", "Cyndi Lauper");
  S(1984, "Time After Time", "Cyndi Lauper");
  S(1984, "Like a Virgin", "Madonna");
  S(1984, "Careless Whisper", "George Michael");
  S(1985, "Take On Me", "a-ha");
  S(1985, "We Are the World", "USA for Africa");
  S(1985, "Heaven", "Bryan Adams");
  S(1986, "Livin' on a Prayer", "Bon Jovi");
  S(1986, "The Final Countdown", "Europe");
  S(1987, "Never Gonna Give You Up", "Rick Astley");
  S(1987, "Sweet Child o' Mine", "Guns N' Roses");
  S(1990, "Vogue", "Madonna");
  S(1991, "Smells Like Teen Spirit", "Nirvana");
  S(1991, "Losing My Religion", "R.E.M.");
  S(1992, "I Will Always Love You", "Whitney Houston");
  S(1992, "Tears in Heaven", "Eric Clapton");
  S(1992, "Heal the World", "Michael Jackson");
  S(1994, "All I Want for Christmas Is You", "Mariah Carey");
  S(1994, "Zombie", "The Cranberries");
  S(1995, "Wonderwall", "Oasis");
  S(1996, "Wannabe", "Spice Girls");
  S(1997, "My Heart Will Go On", "Celine Dion");
  S(1997, "MMMBop", "Hanson");
  S(1997, "Barbie Girl", "Aqua");
  S(1997, "Torn", "Natalie Imbruglia");
  S(1997, "Bitter Sweet Symphony", "The Verve");
  S(1998, "...Baby One More Time", "Britney Spears");
  S(1998, "Believe", "Cher");
  S(1999, "I Want It That Way", "Backstreet Boys");
  S(2000, "Oops!... I Did It Again", "Britney Spears");
  S(2000, "Yellow", "Coldplay");
  S(2002, "Complicated", "Avril Lavigne");
  S(2002, "Lose Yourself", "Eminem");
  S(2003, "Hey Ya!", "OutKast");
  S(2003, "Crazy in Love", "Beyoncé");
  S(2004, "Toxic", "Britney Spears");
  S(2004, "Mr. Brightside", "The Killers");
  S(2005, "Because of You", "Kelly Clarkson");
  S(2006, "Hips Don't Lie", "Shakira");
  S(2007, "Umbrella", "Rihanna");
  S(2008, "Poker Face", "Lady Gaga");
  S(2008, "Viva la Vida", "Coldplay");
  S(2009, "I Gotta Feeling", "The Black Eyed Peas");
  S(2010, "Baby", "Justin Bieber");
  S(2010, "Rolling in the Deep", "Adele");
  S(2011, "Someone Like You", "Adele");
  S(2011, "Call Me Maybe", "Carly Rae Jepsen");
  S(2012, "Let Her Go", "Passenger");
  S(2013, "Happy", "Pharrell Williams");
  S(2013, "Let It Go", "Idina Menzel");
  S(2013, "Counting Stars", "OneRepublic");
  S(2014, "Uptown Funk", "Mark Ronson ft. Bruno Mars");
  S(2014, "Shake It Off", "Taylor Swift");
  S(2014, "Thinking Out Loud", "Ed Sheeran");
  S(2015, "See You Again", "Wiz Khalifa ft. Charlie Puth");
  S(2015, "Hello", "Adele");
  S(2015, "Sorry", "Justin Bieber");
  S(2017, "Shape of You", "Ed Sheeran");
  S(2017, "Perfect", "Ed Sheeran");
  S(2017, "Despacito", "Luis Fonsi ft. Daddy Yankee");
  S(2018, "Old Town Road", "Lil Nas X");
  S(2018, "Someone You Loved", "Lewis Capaldi");
  S(2019, "bad guy", "Billie Eilish");
  S(2019, "Blinding Lights", "The Weeknd");
  S(2019, "Dance Monkey", "Tones and I");
  S(2020, "Levitating", "Dua Lipa");
  S(2021, "drivers license", "Olivia Rodrigo");
  S(2022, "As It Was", "Harry Styles");
  S(2022, "Anti-Hero", "Taylor Swift");
  S(2023, "Flowers", "Miley Cyrus");
  S(2024, "Espresso", "Sabrina Carpenter");

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

  function byId(id) {
    for (var i = 0; i < songs.length; i++) if (songs[i].id === id) return songs[i];
    return null;
  }

  function style(id) {
    for (var i = 0; i < STYLES.length; i++) if (STYLES[i].id === id) return STYLES[i];
    return null;
  }

  window.PriTestUtauSongs = {
    regions: REGIONS,
    styles: STYLES,
    songs: songs,
    decadeOf: decadeOf,
    decades: decades,
    text: text,
    byId: byId,
    style: style
  };
})();
