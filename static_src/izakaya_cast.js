// 深夜居酒屋（izakaya）：角色名單。常客、店員的固定設定，以及一般客的生成。
// 頭像全部用照片（使用者指定 2026-11-09：不要 SVG；每次開新局都要輪換）：assignPhotos 依該局亂數洗牌 191 張，
// 先分給常客與店員（同一局內不重複），其餘給一般客。1a 沒有男性照片，一般客全為女性。
// 劇情在 izakaya_story_*.js；這裡只放人物檔案與玩家要推理的隱藏喜好（pref＝[鹹, 甜, 油, 清爽, 辣]）。全員成年（20 歲以上）。
(function () {
  "use strict";
  var D = window.PriTestIzakayaData, C = D.C;

  var JOBS = ["上班族", "護理師", "國小老師", "平面設計師", "業務", "工程師", "美髮師", "保險員", "編輯", "研究生",
    "公務員", "銀行員", "甜點師", "花店店員", "模特兒", "漫畫家", "空服員", "藥劑師", "律師", "健身教練"].map(function (z) { return C(z); });
  var PERSONAS = ["genki", "cool", "shy", "otona", "tsundere", "tennen", "majime", "gossip", "romantic", "cynical"];
  var MOODS = ["happy", "tired", "sad", "angry", "excited", "lonely", "nervous", "calm"];
  var SURNAMES = ["佐藤", "鈴木", "高橋", "田中", "伊藤", "渡邊", "山本", "中村", "小林", "加藤", "吉田", "山田", "佐佐木", "松本", "井上", "木村", "林", "清水", "山崎", "森", "池田", "橋本", "阿部", "石川", "前田", "藤田", "小川", "岡田", "長谷川", "村上"];
  var GIVEN = ["美咲", "陽菜", "結衣", "葵", "七海", "彩花", "真由", "沙織", "優奈", "麻衣", "千尋", "瑞穗", "愛", "舞", "遙", "楓", "茜", "詩織", "桃子", "由佳", "明日香", "奈奈", "春香", "里奈", "綾", "智子", "惠", "薰", "幸", "純"];

  function ch(o) { o.name = C(o.zh, o.ja || o.zh); o.job = C(o.jobZh); o.bio = C(o.bioZh); return o; }

  // ---------------- 常客（事件線：band＝消失的樂團「深夜列車」、contest＝歌唱比賽；dance／invest／will／master 為 1b 伏筆）----------------
  var REGULARS = [
    ch({ id: "mio", zh: "白石 澪", age: 29, jobZh: "保險業務", persona: "cool", pref: [0, -1, -1, 2, 0], taboo: null, drink: 2, topic: "music",
      likes: ["calm", "honest"], favSpot: "yakei", arcs: ["band", "contest"], from: 2, freq: 0.45,
      bioZh: "前「深夜列車」主唱，十年前出道前夕突然失聲退團，現在連店裡的 BGM 都會讓她皺眉。",
      lines: { heart: "「……剛剛那一下，心跳得跟以前站上舞台時一樣。」", confess: "「我的聲音，只想唱給你聽。」", propose: "「十年前我放棄了一個夢，這次我不想再放手。」", wedding: "「從今天起，這家店的最後一首歌由我來唱。」" } }),
    ch({ id: "chinatsu", zh: "葉山 千夏", age: 30, jobZh: "證券營業員", persona: "genki", pref: [2, 0, 2, -1, 1], taboo: null, drink: 2, topic: "money",
      likes: ["play", "care"], favSpot: "matsuri", arcs: ["band", "invest"], from: 3, freq: 0.45,
      bioZh: "前「深夜列車」鼓手，開朗愛笑，但每到下雨天就獨自喝悶酒；當年解散後大病一場。",
      lines: { heart: "「欸……我心跳怎麼比打鼓還快啦！」", confess: "「我啊，連輸都想跟你一起輸。」", propose: "「人生這支股，我全押你了！」", wedding: "「乾杯！這次是一輩子的乾杯！」" } }),
    ch({ id: "rin", zh: "小鳥遊 鈴", age: 24, jobZh: "和菓子店看板娘", persona: "tennen", pref: [-1, 2, 0, 1, -2], taboo: "alcohol", drink: 0, topic: "food",
      likes: ["sweet", "play"], favSpot: "asaichi", arcs: ["contest"], from: 1, freq: 0.45,
      bioZh: "商店街和菓子老鋪的獨生女，被推派為歌唱大賽主辦，天然呆但意外有行動力。",
      lines: { heart: "「心臟怦怦跳……這、這是新口味的和菓子的感覺嗎？」", confess: "「我想每天都做最甜的點心給你。」", propose: "「和菓子店的第二代老闆娘……不，是老闆的老婆！」", wedding: "「婚禮的喜餅，當然是我自己做的！」" } }),
    ch({ id: "saeko", zh: "黑川 冴子", age: 38, jobZh: "唱片公司製作人", persona: "otona", pref: [1, -2, 1, 1, 0], taboo: "raw", drink: 2, topic: "work",
      likes: ["smart", "bold"], favSpot: "onsen", arcs: ["band", "contest"], from: 6, freq: 0.42,
      bioZh: "業界名製作人，當年「深夜列車」的經紀人，手上握著那首未發表的歌的版權。",
      lines: { heart: "「……我居然也會有這種表情。別看。」", confess: "「才華是商品，但你不是。你是我想要的人。」", propose: "「這份合約沒有解約條款，簽嗎？」", wedding: "「十年來第一次，我不想控制任何事。」" } }),
    ch({ id: "hinata", zh: "春日 日向", age: 22, jobZh: "街頭歌手", persona: "majime", pref: [0, 1, 0, 1, -1], taboo: "sea", drink: 1, topic: "dream",
      likes: ["honest", "shy"], favSpot: "karaoke", arcs: ["contest", "band"], from: 4, freq: 0.45,
      bioZh: "每晚在車站前唱歌，為了大賽拚命練習；她不知道自己的身世藏著一個祕密。",
      lines: { heart: "「我想把現在的心情寫成一首歌……可是好難為情。」", confess: "「我所有的歌，都是唱給你的。」", propose: "「我想跟你組一個只有兩個人的樂團，一輩子。」", wedding: "「這首歌叫做『老闆』……啊，不准笑！」" } }),
    ch({ id: "ran", zh: "早乙女 蘭", age: 27, jobZh: "八卦週刊記者", persona: "gossip", pref: [1, 0, 1, 0, 2], taboo: null, drink: 1, topic: "gossip",
      likes: ["tease", "smart"], favSpot: "aquarium", arcs: ["band", "dance"], from: 5, freq: 0.42,
      bioZh: "嗅覺敏銳的記者，正在追「深夜列車」解散的獨家；據說下一個目標是某個舞團。",
      lines: { heart: "「這個……不能寫成報導。是我一個人的獨家。」", confess: "「我追過很多真相，只有你讓我想停下來。」", propose: "「頭條我已經想好了：『記者，嫁人了』。」", wedding: "「今天不帶錄音筆，全部用心記住。」" } }),
    // ---- 1b 新增常客（舞團醜聞、投資的心境、豪門遺囑、師父的料理帳）----
    ch({ id: "reika", zh: "鳳 麗華", age: 32, jobZh: "瑜伽老師（前舞團首席）", persona: "otona", pref: [0, 1, -1, 2, 0], taboo: null, drink: 1, topic: "dream",
      likes: ["calm", "care"], favSpot: "hanami", arcs: ["dance"], from: 7, freq: 0.45,
      bioZh: "「月華舞踊團」的前首席。一年前「假傷退團」的醜聞主角，從此再也不跳舞。",
      lines: { heart: "「……好久沒有這種，想要踮起腳尖的感覺了。」", confess: "「我想為你再跳一次。只為你。」", propose: "「人生的下一支舞，請當我的舞伴。」", wedding: "「這是我跳過最美的一支舞。」" } }),
    ch({ id: "miyabi", zh: "天城 雅", age: 46, jobZh: "月華舞踊團團長", persona: "cool", pref: [1, -1, 1, 1, 0], taboo: "raw", drink: 2, topic: "work",
      likes: ["smart", "bold"], favSpot: "museum", arcs: ["dance"], from: 9, freq: 0.42,
      bioZh: "一手撐起舞團的鐵腕團長。對麗華的「假傷」絕口不提。",
      lines: { heart: "「……我已經很多年，沒被人這樣看著了。」", confess: "「舞台以外的地方，我也想有個人陪著。」", propose: "「後半生的編舞，交給你了。」", wedding: "「今天，我不是團長。只是一個新娘。」" } }),
    ch({ id: "saya", zh: "一之瀨 沙耶", age: 33, jobZh: "理財講師", persona: "romantic", pref: [0, 2, 1, 0, -1], taboo: null, drink: 1, topic: "money",
      likes: ["sweet", "honest"], favSpot: "yakata", arcs: ["invest"], from: 8, freq: 0.45,
      bioZh: "在商店街開免費理財講座的美女講師，笑容溫柔，眼底卻藏著疲倦。",
      lines: { heart: "「我說過很多謊……可是現在的心跳，是真的。」", confess: "「我想用乾淨的心，重新開始喜歡一個人。」", propose: "「這次的承諾，沒有任何附帶條款。」", wedding: "「這是我這輩子，最划算的一筆投資。」" } }),
    ch({ id: "ayano", zh: "鷹司 綾乃", age: 35, jobZh: "鷹司集團專務", persona: "tsundere", pref: [1, -1, 0, 1, 1], taboo: null, drink: 2, topic: "work",
      likes: ["bold", "tease"], favSpot: "snow", arcs: ["will", "master"], from: 10, freq: 0.42,
      bioZh: "主導月見橫丁再開發的集團專務。每晚卻偷偷來這家店，坐在最角落。",
      lines: { heart: "「別、別誤會！是雪太冷了才靠過來的！」", confess: "「這家店……還有你，是我唯一不想拆掉的東西。」", propose: "「我的人生合約，只簽給你一個人。」", wedding: "「月見橫丁，我們一起守護。」" } }),
    ch({ id: "sumika", zh: "鷹司 澄香", age: 27, jobZh: "鷹司集團千金", persona: "shy", pref: [0, 2, 0, 1, -1], taboo: "sea", drink: 1, topic: "family",
      likes: ["shy", "care"], favSpot: "amusement", arcs: ["will", "master"], from: 11, freq: 0.45,
      bioZh: "被保護得像籠中鳥的千金。第一次偷溜出家門，就走進了這家店。",
      lines: { heart: "「心臟……跳得好快。這也是我第一次知道的事。」", confess: "「我想要一個，不是因為我姓鷹司才對我好的人。」", propose: "「我想跟你一起，去好多好多沒去過的地方。」", wedding: "「爸爸……兩個爸爸，都在看著我呢。」" } }),
    ch({ id: "chizuru", zh: "霧島 千鶴", age: 52, jobZh: "老料亭女將", persona: "otona", pref: [1, 0, 0, 2, 0], taboo: null, drink: 2, topic: "food",
      likes: ["honest", "calm"], favSpot: "beach", arcs: ["master"], from: 12, freq: 0.42,
      bioZh: "隔壁街老料亭「霧島」的女將。每次吃你的菜，都會露出懷念又悲傷的表情。",
      lines: { heart: "「都這把年紀了……還會心跳加速，真是傷腦筋。」", confess: "「我等了一個人二十年。現在，我想讓自己往前走。」", propose: "「餘生的每一頓飯，我們一起做吧。」", wedding: "「我的婚禮料理……當然由我們兩個人來做。」" } })
  ];

  // ---------------- 店員（★4 雇用；面試劇情在 ★3 起的公休日出現）----------------
  var STAFF = [
    ch({ id: "akari", zh: "朝倉 灯", age: 23, jobZh: "前田徑選手", persona: "genki", pref: [2, 0, 2, 0, 0], taboo: null, drink: 1, topic: "dream",
      likes: ["play", "bold"], favSpot: "matsuri", arcs: [], from: 0, freq: 0, ability: "fast", wage: 4500,
      bioZh: "膝傷退役，跑得比誰都快，想找到「跑以外」的自己。",
      lines: { heart: "「我現在跑得好快……是心臟。」", confess: "「這次的終點線，我想跟你一起衝過去！」", propose: "「下半輩子的接力棒，交給我吧！」", wedding: "「從今天起，我們是同一隊了！」" } }),
    ch({ id: "shizuku", zh: "二階堂 雫", age: 25, jobZh: "圖書館員", persona: "shy", pref: [0, 1, -1, 2, -2], taboo: "alcohol", drink: 0, topic: "family",
      likes: ["calm", "smart"], favSpot: "aquarium", arcs: ["master"], from: 0, freq: 0, ability: "memo", wage: 4000,
      bioZh: "安靜、記憶力驚人；祖父是師父的老友，身上帶著料理帳的一頁。",
      lines: { heart: "「……這一頁，我想夾在心裡最重要的地方。」", confess: "「我記得你說過的每一句話。全部。」", propose: "「請、請把我的名字……寫進你的人生裡。」", wedding: "「這是我讀過最幸福的一章。」" } }),
    ch({ id: "reina", zh: "真壁 玲奈", age: 31, jobZh: "前銀座調酒師", persona: "otona", pref: [1, -1, 0, 1, 1], taboo: null, drink: 2, topic: "work",
      likes: ["bold", "honest"], favSpot: "yakei", arcs: [], from: 0, freq: 0, ability: "bar", wage: 5500,
      bioZh: "被名店開除的天才調酒師，不肯說原因。",
      lines: { heart: "「這杯的名字……就叫『心動』吧。」", confess: "「我調過幾千杯酒，第一次想醉的是你。」", propose: "「往後每一晚的最後一杯，都由我來調。」", wedding: "「敬我們。一輩子不打烊。」" } }),
    ch({ id: "yuzu", zh: "桐谷 柚子", age: 21, jobZh: "前偶像練習生", persona: "genki", pref: [0, 2, 1, 0, -1], taboo: null, drink: 1, topic: "love",
      likes: ["sweet", "play"], favSpot: "karaoke", arcs: ["contest"], from: 0, freq: 0, ability: "host", wage: 4000,
      bioZh: "被經紀公司放生的練習生，笑容是武器，偷偷報名了歌唱大賽。",
      lines: { heart: "「這不是營業用的笑容喔，是真的。」", confess: "「我只想當你一個人的偶像！」", propose: "「畢業公演……不，是結婚公演！」", wedding: "「全場的應援色，今天都是你！」" } }),
    ch({ id: "tsumugi", zh: "水無瀬 紬", age: 28, jobZh: "前托兒所老師", persona: "romantic", pref: [0, 1, 0, 2, 0], taboo: null, drink: 1, topic: "family",
      likes: ["care", "calm"], favSpot: "onsen", arcs: [], from: 0, freq: 0, ability: "fast", wage: 4500,
      bioZh: "溫柔堅強，獨自照顧生病的母親，需要晚上的工作。",
      lines: { heart: "「好久……沒有人讓我想撒嬌了。」", confess: "「我想照顧的人，第一次是想被你照顧。」", propose: "「媽媽說，你是個好人。我也這麼覺得。」", wedding: "「從今天起，換我們一起守著這個家。」" } }),
    ch({ id: "ayame", zh: "篠宮 菖蒲", age: 26, jobZh: "前會計師", persona: "majime", pref: [1, 0, 0, 1, 0], taboo: "meat", drink: 1, topic: "money",
      likes: ["smart", "honest"], favSpot: "asaichi", arcs: ["invest"], from: 0, freq: 0, ability: "memo", wage: 5000,
      bioZh: "從大型事務所離職，數字比誰都準，對錢有創傷。",
      lines: { heart: "「心跳數……超出預算了。」", confess: "「我算了很多次，答案都是你。」", propose: "「我們的帳本，從今天起合併。」", wedding: "「這是我做過最不划算、也最幸福的決定。」" } }),
    ch({ id: "miu", zh: "天野 美羽", age: 24, jobZh: "前舞團舞者", persona: "tsundere", pref: [0, 2, -1, 1, 0], taboo: null, drink: 1, topic: "gossip",
      likes: ["tease", "shy"], favSpot: "aquarium", arcs: ["dance"], from: 0, freq: 0, ability: "host", wage: 4500,
      bioZh: "某個舞團醜聞的當事人之一，嘴硬心軟。",
      lines: { heart: "「才、才沒有心動！只是剛才轉圈轉暈了！」", confess: "「……笨蛋，我只跳給你看。」", propose: "「既然你都這麼說了，我就勉強答應吧……一輩子。」", wedding: "「第一支舞，你要是踩到我的腳就完蛋了。」" } }),
    ch({ id: "kotone", zh: "柚木 琴音", age: 22, jobZh: "音大學生", persona: "cynical", pref: [1, -1, 0, 0, 2], taboo: null, drink: 2, topic: "music",
      likes: ["smart", "tease"], favSpot: "karaoke", arcs: ["contest"], from: 0, freq: 0, ability: "bar", wage: 4000,
      bioZh: "毒舌的音大生，歌唱大賽的強敵，跟日向是死對頭。",
      lines: { heart: "「……走音的是我的心跳。不准說出去。」", confess: "「我討厭不完美的東西。你是例外。」", propose: "「二重奏的另一個聲部，只能是你。」", wedding: "「今天的我，大概是全世界最不毒舌的人。」" } }),
    ch({ id: "rin_t", zh: "藤堂 凜", age: 27, jobZh: "前祕書", persona: "cool", pref: [1, 0, 1, 1, 0], taboo: "sea", drink: 2, topic: "work",
      likes: ["calm", "bold"], favSpot: "yakei", arcs: ["will"], from: 0, freq: 0, ability: "fast", wage: 5000,
      bioZh: "自稱孤兒的冷面祕書，懷錶從不離身。",
      lines: { heart: "「行程表上沒有這一項……但我不想刪掉。」", confess: "「我第一次想把自己的事，排在第一位。」", propose: "「從今天起，我的名字後面要加上你的姓。」", wedding: "「我終於有了一個真正的家。」" } }),
    ch({ id: "kaede", zh: "椎名 楓", age: 30, jobZh: "樂器行店員", persona: "otona", pref: [2, 0, 1, 0, 1], taboo: null, drink: 2, topic: "music",
      likes: ["honest", "calm"], favSpot: "onsen", arcs: ["band"], from: 0, freq: 0, ability: "bar", wage: 5000,
      bioZh: "前「深夜列車」貝斯手，解散後再也沒碰過貝斯，認得澪的聲音。",
      lines: { heart: "「低音……是心跳的聲音。你聽到了嗎？」", confess: "「我想當你的低音，一直在你後面撐著。」", propose: "「這把貝斯十年沒響過，今天為你彈。」", wedding: "「這次，我們不會解散了。」" } }),
    // ---- 1b 新增店員 20 人 ----
    ch({ id: "hikari", zh: "星野 光", age: 22, jobZh: "天文研究生", persona: "tennen", pref: [0, 2, 0, 1, 0], taboo: null, drink: 1, topic: "dream",
      likes: ["calm", "smart"], favSpot: "snow", arcs: [], from: 0, freq: 0, ability: "memo", wage: 4000,
      bioZh: "白天睡覺、晚上看星星的研究生，能背出全天八十八個星座。",
      lines: { heart: "「我找到一顆新的星星了……就在我旁邊。」", confess: "「你是我的一等星。」", propose: "「我想跟你一起，看遍全世界的星空。」", wedding: "「今晚的星星，全都在祝福我們。」" } }),
    ch({ id: "nagisa", zh: "汐見 渚", age: 25, jobZh: "前海女", persona: "genki", pref: [2, 0, 0, 2, 0], taboo: null, drink: 2, topic: "food",
      likes: ["play", "bold"], favSpot: "beach", arcs: [], from: 0, freq: 0, ability: "fast", wage: 4500,
      bioZh: "從漁村北上的前海女，憋氣三分鐘，挑海鮮的眼光比誰都準。",
      lines: { heart: "「心跳得好快……比潛到海底還喘。」", confess: "「我想跟你，一起游到很遠的地方。」", propose: "「這片海，以後就是我們兩個的了！」", wedding: "「從今天起，你就是我的港口。」" } }),
    ch({ id: "kurumi", zh: "胡桃澤 胡桃", age: 23, jobZh: "甜點師學徒", persona: "shy", pref: [0, 2, 1, 0, -2], taboo: "alcohol", drink: 0, topic: "food",
      likes: ["sweet", "shy"], favSpot: "amusement", arcs: [], from: 0, freq: 0, ability: "host", wage: 4000,
      bioZh: "從法式甜點店被趕出來的學徒，想做出適合居酒屋的和風甜點。",
      lines: { heart: "「好、好甜……不是點心，是現在的氣氛。」", confess: "「我想每天，做一份只給你的甜點。」", propose: "「結婚蛋糕……我想自己做。」", wedding: "「這是我做過，最甜的一天。」" } }),
    ch({ id: "sakura", zh: "春野 櫻", age: 26, jobZh: "花藝師", persona: "romantic", pref: [0, 1, 0, 2, 0], taboo: null, drink: 1, topic: "love",
      likes: ["care", "honest"], favSpot: "hanami", arcs: [], from: 0, freq: 0, ability: "host", wage: 4500,
      bioZh: "每天在店裡插一瓶季節的花。她說，每一朵花都有想傳達的話。",
      lines: { heart: "「這種心情……就像花苞要開的前一刻。」", confess: "「我想把所有的花語，都送給你。」", propose: "「捧花的花，我早就選好了。」", wedding: "「今天的花，全都是為你開的。」" } }),
    ch({ id: "kanon", zh: "音無 花音", age: 24, jobZh: "前電台 DJ", persona: "gossip", pref: [1, 0, 1, 0, 1], taboo: null, drink: 2, topic: "music",
      likes: ["tease", "play"], favSpot: "karaoke", arcs: [], from: 0, freq: 0, ability: "bar", wage: 4500,
      bioZh: "深夜廣播節目被腰斬的 DJ，說話像在主持節目，一刻都停不下來。",
      lines: { heart: "「……這段，不能播出去。是我的私人時間。」", confess: "「我想把你，點成我人生的固定節目。」", propose: "「接下來這首歌，獻給——我的未婚夫！」", wedding: "「各位聽眾，今天的節目是我們的婚禮直播！」" } }),
    ch({ id: "misaki", zh: "岬 美咲", age: 29, jobZh: "前刑警", persona: "cool", pref: [2, 0, 1, 1, 1], taboo: null, drink: 2, topic: "work",
      likes: ["bold", "honest"], favSpot: "yakei", arcs: ["will"], from: 0, freq: 0, ability: "fast", wage: 5500,
      bioZh: "辭職的前刑警，眼神銳利。她說，有一件二十年前的懸案一直放不下。",
      lines: { heart: "「……警戒解除。在你身邊，我可以放鬆。」", confess: "「我想保護的人，第一次不是因為工作。」", propose: "「終身監護權，交給我吧。」", wedding: "「這次，我不會讓任何人傷害你。」" } }),
    ch({ id: "tomoe", zh: "巴 智惠", age: 34, jobZh: "前料亭仲居", persona: "otona", pref: [1, 0, 0, 2, 0], taboo: null, drink: 1, topic: "family",
      likes: ["calm", "care"], favSpot: "yakata", arcs: ["master"], from: 0, freq: 0, ability: "memo", wage: 5000,
      bioZh: "年輕時在料亭「月見」當過仲居。那家料亭，二十年前在一場大火中燒毀了。",
      lines: { heart: "「……好像回到了十四歲，第一次心動的時候。」", confess: "「我想好好地，為自己活一次。」", propose: "「以後的每個季節，都想跟你一起過。」", wedding: "「月見的大家……我終於幸福了。」" } }),
    ch({ id: "ruri", zh: "瑠璃川 瑠璃", age: 21, jobZh: "美大生", persona: "tsundere", pref: [0, 1, 0, 1, 1], taboo: null, drink: 1, topic: "dream",
      likes: ["smart", "tease"], favSpot: "museum", arcs: [], from: 0, freq: 0, ability: "host", wage: 4000,
      bioZh: "天才型的美大生，嘴上嫌棄一切，筆記本卻畫滿了店裡的客人。",
      lines: { heart: "「……我想把現在畫下來。不准動！」", confess: "「我畫了一百張你的速寫。……笨蛋，看不出來嗎？」", propose: "「這幅畫的標題，叫做『一輩子』。」", wedding: "「這是我的最高傑作。」" } }),
    ch({ id: "aoi", zh: "青山 葵", age: 27, jobZh: "程式設計師", persona: "cynical", pref: [1, 0, 2, 0, 1], taboo: null, drink: 2, topic: "work",
      likes: ["smart", "calm"], favSpot: "aquarium", arcs: [], from: 0, freq: 0, ability: "memo", wage: 5000,
      bioZh: "過勞離職的工程師。替店裡寫了一套點單系統，卻說「只是順手」。",
      lines: { heart: "「心跳數異常……這不是 bug。」", confess: "「我的人生程式，缺了你就跑不動。」", propose: "「要不要跟我，合併成同一個分支？」", wedding: "「部署成功。永遠不回滾。」" } }),
    ch({ id: "hotaru", zh: "宮下 螢", age: 25, jobZh: "夜班護理師", persona: "romantic", pref: [0, 1, 0, 2, 0], taboo: null, drink: 1, topic: "family",
      likes: ["care", "calm"], favSpot: "onsen", arcs: [], from: 0, freq: 0, ability: "fast", wage: 4500,
      bioZh: "醫院輪調後只剩半天的班，想在剩下的晚上學做菜。",
      lines: { heart: "「脈搏……好快。這次是我的。」", confess: "「換我來照顧你，好不好？」", propose: "「健康的時候、生病的時候，我都在。」", wedding: "「這是我最幸福的一次夜班。」" } }),
    ch({ id: "chiyo", zh: "千代田 千代", age: 30, jobZh: "前酒藏杜氏", persona: "majime", pref: [1, 0, 0, 1, 0], taboo: null, drink: 2, topic: "food",
      likes: ["honest", "smart"], favSpot: "asaichi", arcs: [], from: 0, freq: 0, ability: "bar", wage: 5500,
      bioZh: "家傳酒藏倒閉後上京的女杜氏，對日本酒有說不完的講究。",
      lines: { heart: "「……這種感覺，像新酒剛釀好的那一刻。」", confess: "「我想跟你，一起慢慢釀成好酒。」", propose: "「我們的酒藏，名字就叫『深夜』吧。」", wedding: "「乾杯。這杯酒，我會記一輩子。」" } }),
    ch({ id: "mai", zh: "舞原 舞", age: 23, jobZh: "舞團研究生", persona: "genki", pref: [0, 2, -1, 1, 0], taboo: null, drink: 1, topic: "dream",
      likes: ["play", "care"], favSpot: "hanami", arcs: ["dance"], from: 0, freq: 0, ability: "host", wage: 4000,
      bioZh: "月華舞踊團的研究生，崇拜前首席麗華。她說，醜聞那晚她看到了什麼。",
      lines: { heart: "「心臟在跳迴旋！停不下來啦！」", confess: "「我想跟你，跳一支只有兩個人的舞！」", propose: "「下一場公演，請當我的男主角！」", wedding: "「今天的我，是全世界最閃亮的首席！」" } }),
    ch({ id: "yui", zh: "結城 結衣", age: 28, jobZh: "前證券分析師", persona: "majime", pref: [1, 0, 0, 1, 0], taboo: null, drink: 1, topic: "money",
      likes: ["smart", "honest"], favSpot: "museum", arcs: ["invest"], from: 0, freq: 0, ability: "memo", wage: 5000,
      bioZh: "被裁員的分析師。一眼看穿商店街流行的理財講座「有問題」。",
      lines: { heart: "「這個走勢……完全超出我的預測。」", confess: "「我分析了很久，結論是：我喜歡你。」", propose: "「長期持有，絕不拋售。」", wedding: "「這是我人生最穩健的決定。」" } }),
    ch({ id: "riko", zh: "早瀨 莉子", age: 24, jobZh: "外送員", persona: "genki", pref: [2, 0, 2, 0, 1], taboo: null, drink: 1, topic: "gossip",
      likes: ["play", "bold"], favSpot: "amusement", arcs: [], from: 0, freq: 0, ability: "fast", wage: 4000,
      bioZh: "騎腳踏車跑遍全區的外送員，商店街每一戶的八卦她都知道。",
      lines: { heart: "「我騎了一整天都沒喘，現在卻喘不過氣……」", confess: "「以後，我只想送一個地方——你身邊！」", propose: "「終點站，就是你家了！」", wedding: "「這次的包裹，是我自己！」" } }),
    ch({ id: "shion", zh: "紫苑寺 紫苑", age: 31, jobZh: "占卜師", persona: "tennen", pref: [0, 1, 0, 1, 0], taboo: null, drink: 1, topic: "love",
      likes: ["tease", "calm"], favSpot: "yakata", arcs: [], from: 0, freq: 0, ability: "host", wage: 4500,
      bioZh: "神祕的占卜師，替客人算命也替店裡算進貨。準得嚇人。",
      lines: { heart: "「……奇怪，這個未來，我沒有占卜到。」", confess: "「塔羅說，我的戀人牌是你。」", propose: "「我已經算過了。我們會白頭偕老。」", wedding: "「這次的結果，不需要占卜也知道。」" } }),
    ch({ id: "kaho", zh: "夏目 夏帆", age: 22, jobZh: "衝浪手", persona: "genki", pref: [2, 0, 1, 1, 0], taboo: null, drink: 1, topic: "dream",
      likes: ["bold", "play"], favSpot: "beach", arcs: [], from: 0, freq: 0, ability: "fast", wage: 4000,
      bioZh: "為了存比賽旅費來打工的衝浪手，曬得黝黑，笑起來像夏天。",
      lines: { heart: "「這是我遇過，最大的一道浪。」", confess: "「我想跟你，一起追下一道浪！」", propose: "「一輩子的浪，我們一起衝！」", wedding: "「今天的海，是最棒的一天！」" } }),
    ch({ id: "ren", zh: "蓮見 蓮", age: 33, jobZh: "前律師", persona: "cool", pref: [1, -1, 0, 2, 0], taboo: null, drink: 2, topic: "work",
      likes: ["smart", "honest"], favSpot: "snow", arcs: ["will"], from: 0, freq: 0, ability: "memo", wage: 6000,
      bioZh: "曾是鷹司集團的顧問律師。因為一份遺囑，她辭職了。",
      lines: { heart: "「……沒有任何條文，能解釋現在的心情。」", confess: "「我想跟你，訂一份沒有期限的契約。」", propose: "「本人自願，終身履行。」", wedding: "「這是我見證過，最美的一份契約。」" } }),
    ch({ id: "yuki", zh: "雪村 雪", age: 26, jobZh: "民謠歌手", persona: "shy", pref: [0, 1, 0, 2, -1], taboo: null, drink: 1, topic: "music",
      likes: ["shy", "honest"], favSpot: "snow", arcs: ["contest"], from: 0, freq: 0, ability: "bar", wage: 4500,
      bioZh: "雪國出身的民謠歌手，聲音像雪一樣乾淨。她在找一首母親哼過的歌。",
      lines: { heart: "「……雪會融化，可是這個心情不會。」", confess: "「我想把這首歌，唱給你一個人聽。」", propose: "「我們的歌，要唱一輩子。」", wedding: "「春天來了。我的春天。」" } }),
    ch({ id: "asuka", zh: "飛鳥 明日香", age: 25, jobZh: "前空服員", persona: "otona", pref: [0, 1, 0, 2, 0], taboo: null, drink: 1, topic: "love",
      likes: ["care", "smart"], favSpot: "yakei", arcs: [], from: 0, freq: 0, ability: "host", wage: 5000,
      bioZh: "飛遍世界的前空服員。她說，想找一個不用再起飛的地方。",
      lines: { heart: "「……好像遇到亂流了。是好的那種。」", confess: "「我想在你這裡，降落。」", propose: "「單程票。目的地，你。」", wedding: "「各位旅客，本班機即將抵達——幸福。」" } }),
    ch({ id: "sumire", zh: "篠原 堇", age: 29, jobZh: "二手書店店主", persona: "shy", pref: [0, 1, 0, 2, 0], taboo: null, drink: 1, topic: "family",
      likes: ["calm", "shy"], favSpot: "museum", arcs: ["master"], from: 0, freq: 0, ability: "memo", wage: 4500,
      bioZh: "經營二手書店的安靜女子。店裡收到了一本燒焦的舊食譜。",
      lines: { heart: "「……這一頁，我想反覆讀很多遍。」", confess: "「我們的故事，我想一直讀下去。」", propose: "「請和我一起，寫完下一本書。」", wedding: "「這是我讀過，最幸福的結局。」" } })
  ];
  var ALL = REGULARS.concat(STAFF), BY = {};
  ALL.forEach(function (c) { BY[c.id] = c; });

  // 照片（使用者指定 2026-11-09：每次開新局都要輪換）：洗牌全部 191 張，先分給常客與店員，其餘給一般客
  var ALL_PHOTOS = [], k;
  for (k = 0; k <= 15; k++) ALL_PHOTOS.push("hero_" + ("00" + k).slice(-3));
  for (k = 0; k <= 31; k++) ALL_PHOTOS.push("n_" + ("00" + k).slice(-3));
  for (k = 0; k <= 142; k++) ALL_PHOTOS.push("g_" + ("00" + k).slice(-3));
  function assignPhotos(rnd) {
    var list = ALL_PHOTOS.slice(), i, photos = {};
    for (i = list.length - 1; i > 0; i--) { var j = Math.floor(rnd() * (i + 1)), t = list[i]; list[i] = list[j]; list[j] = t; }
    ALL.forEach(function (c, n) { photos[c.id] = list[n]; });
    return { photos: photos, rest: list.slice(ALL.length) };
  }
  // 一般客：rnd() 回傳 [0,1)；同一個亂數序列產生同一批人。照片依序取自 assignPhotos 剩下的 rest
  function genPool(rnd, n, photos) {
    var i, out = [];
    for (i = 0; i < n; i++) {
      var pref = D.DIMS.map(function () { return Math.floor(rnd() * 5) - 2; });
      var tr = rnd();
      out.push({
        id: "w" + i,
        name: C(SURNAMES[Math.floor(rnd() * SURNAMES.length)] + " " + GIVEN[Math.floor(rnd() * GIVEN.length)]),
        photo: photos[i % photos.length],
        job: JOBS[Math.floor(rnd() * JOBS.length)],
        persona: PERSONAS[Math.floor(rnd() * PERSONAS.length)],
        pref: pref,
        taboo: tr < 0.12 ? "raw" : tr < 0.2 ? "sea" : tr < 0.26 ? "meat" : tr < 0.34 ? "alcohol" : null,
        drink: tr >= 0.26 && tr < 0.34 ? 0 : Math.floor(rnd() * 3),
        topic: Object.keys(D.TOPICS)[Math.floor(rnd() * 8)],
        budget: 1 + Math.floor(rnd() * 3)
      });
    }
    return out;
  }

  window.PriTestIzakayaCast = {
    REGULARS: REGULARS, STAFF: STAFF, JOBS: JOBS, PERSONAS: PERSONAS, MOODS: MOODS, ALL_PHOTOS: ALL_PHOTOS,
    byId: function (id) { return BY[id] || null; }, genPool: genPool, assignPhotos: assignPhotos
  };
})();
