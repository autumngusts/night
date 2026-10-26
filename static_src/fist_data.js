// 鐵拳教育（fist）：靜態資料。規則在 fist_core.js，畫面在 fist.js；設計見 docs/fist_game_design.md。
// 名稱都是 { zh, ja, en } 三語；UI 字串在 site_src/i18n_fist.py。
(function () {
  "use strict";

  function N(zh, ja, en) { return { zh: zh, ja: ja, en: en }; }

  var W = 7, H = 5;

  // 校園地圖 7×5（上下左右相鄰）。type：blind 死角／class 教室／path 通道／office 辦公室／nurse 保健室／
  // broadcast 廣播室／principal 校長室。事件只會發生在 blind 與 class。
  var TILE_ROWS = [
    [["roof_w", "blind", N("西頂樓", "西屋上", "West roof")], ["music", "class", N("音樂教室", "音楽室", "Music room")], ["stairs_w", "path", N("西樓梯", "西階段", "West stairs")], ["lab", "class", N("理化教室", "理科室", "Science lab")], ["broadcast", "broadcast", N("廣播室", "放送室", "Broadcast room")], ["stairs_e", "path", N("東樓梯", "東階段", "East stairs")], ["roof_e", "blind", N("東頂樓", "東屋上", "East roof")]],
    [["c2a", "class", N("2年A班", "2年A組", "Class 2-A")], ["c2b", "class", N("2年B班", "2年B組", "Class 2-B")], ["hall_w", "path", N("西走廊", "西廊下", "West hall")], ["hall_c", "path", N("中央走廊", "中央廊下", "Main hall")], ["hall_e", "path", N("東走廊", "東廊下", "East hall")], ["c3c", "class", N("3年C班", "3年C組", "Class 3-C")], ["c3d", "class", N("3年D班", "3年D組", "Class 3-D")]],
    [["wc_w", "blind", N("西側廁所", "西トイレ", "West restroom")], ["office", "office", N("教師辦公室", "職員室", "Staff room")], ["nurse", "nurse", N("保健室", "保健室", "Infirmary")], ["lobby", "path", N("穿堂", "昇降口", "Entrance hall")], ["library", "class", N("圖書館", "図書室", "Library")], ["principal", "principal", N("校長室", "校長室", "Principal's office")], ["wc_e", "blind", N("東側廁所", "東トイレ", "East restroom")]],
    [["field_w", "path", N("操場西", "校庭西", "Field west")], ["field_c", "path", N("操場", "校庭", "Field")], ["field_e", "path", N("操場東", "校庭東", "Field east")], ["canteen", "path", N("福利社", "購買部", "School store")], ["gym", "class", N("體育館", "体育館", "Gym")], ["storage", "blind", N("器材室", "体育倉庫", "Equipment room")], ["gym_back", "blind", N("體育館後方", "体育館裏", "Behind the gym")]],
    [["gate", "path", N("校門", "校門", "School gate")], ["bikes", "blind", N("腳踏車棚", "駐輪場", "Bike shed")], ["garden", "path", N("中庭", "中庭", "Courtyard")], ["club", "class", N("社團大樓", "部室棟", "Club building")], ["pool", "path", N("游泳池", "プール", "Pool")], ["court", "path", N("籃球場", "バスケコート", "Basketball court")], ["alley", "blind", N("後門小巷", "裏門の路地", "Back alley")]]
  ];

  var TILES = [];
  var TILE = {};
  TILE_ROWS.forEach(function (row, y) {
    row.forEach(function (c, x) {
      var t = { id: c[0], type: c[1], name: c[2], x: x, y: y };
      TILES.push(t);
      TILE[t.id] = t;
    });
  });

  // 老師：hp 體力、pow 力量（鐵拳）、talk 口才（說服）、sense 觀察力（蒐證）
  var CLASSES = [
    { id: "pe", icon: "💪", color: "#e0553b", hp: 12, pow: 3, talk: 1, sense: 1,
      name: N("體育老師", "体育教師", "PE Teacher"),
      desc: N("熱血正面突破。腳程快、拳頭硬，但不擅長講道理。", "熱血の正面突破。足が速く拳が重いが、理屈は苦手。", "Hot-blooded and direct. Fast on their feet and hits hard, but not much of a talker."),
      skill: { id: "dash", name: N("衝刺", "ダッシュ", "Dash"), desc: N("這回合步數 +4。", "このターンの歩数 +4。", "+4 steps this turn.") },
      ult: { id: "barrage", name: N("百裂鐵拳", "百裂鉄拳", "Hundred Iron Fists"), desc: N("格鬥中使用：畫面上所有霸凌者受到 力量×2 傷害。", "格闘中に使用：画面上のいじめっ子全員に 力×2 ダメージ。", "In a fight: every bully on screen takes Power×2.") } },
    { id: "exdelinq", icon: "🕶️", color: "#7b5cd6", hp: 10, pow: 3, talk: 2, sense: 1,
      name: N("前不良老師", "元ヤン教師", "Ex-Delinquent Teacher"),
      desc: N("以前是傳說中的不良。一個眼神就能讓霸凌者動彈不得。", "かつての伝説のヤンキー。ひと睨みでいじめっ子を黙らせる。", "Once a legendary delinquent. One glare and bullies freeze."),
      skill: { id: "glare", name: N("眼神威嚇", "メンチ切り", "Death Glare"), desc: N("同格所有霸凌者氣焰 −1，並被嚇住（跳過下次行動）。", "同じマスのいじめっ子全員の勢い −1、さらに萎縮（次の行動を飛ばす）。", "Every bully here loses 1 swagger and is stunned (skips their next action).") },
      ult: { id: "legend", name: N("傳說特攻服", "伝説の特攻服", "Legendary Jacket"), desc: N("格鬥中使用：畫面上所有霸凌者受到 4 傷害，餘波讓相鄰格的霸凌者也受到 4 傷害。", "格闘中に使用：画面上のいじめっ子全員に 4 ダメージ、余波で隣接マスのいじめっ子にも 4 ダメージ。", "In a fight: every bully on screen takes 4, and the shockwave deals 4 to bullies on adjacent spaces.") } },
    { id: "counselor", icon: "🫶", color: "#2e9e7a", hp: 8, pow: 1, talk: 3, sense: 2,
      name: N("輔導老師", "スクールカウンセラー", "School Counselor"),
      desc: N("用話語打開心門。最能守護受害學生，也能讓霸凌者真心認錯。", "言葉で心を開く。被害生徒を守り、いじめっ子に本気で反省させる。", "Opens hearts with words. Best at protecting victims and making bullies truly repent."),
      skill: { id: "counsel", name: N("心靈諮商", "カウンセリング", "Counseling"), desc: N("同格與相鄰格的受害學生心靈 +3。", "同じマスと隣接マスの被害生徒の心 +3。", "Victims here and on adjacent spaces recover 3 heart.") },
      ult: { id: "truth", name: N("真心話", "本音の言葉", "Heart-to-Heart"), desc: N("格鬥中使用：畫面上所有霸凌者受到 口才×2 傷害（算說服），投訴 −1。", "格闘中に使用：画面上のいじめっ子全員に 話術×2 ダメージ（説得扱い）、苦情 −1。", "In a fight: every bully on screen takes Talk×2 (counts as talk). Complaints −1.") } },
    { id: "science", icon: "🧪", color: "#3a86c8", hp: 8, pow: 2, talk: 1, sense: 3,
      name: N("理化老師", "理科教師", "Science Teacher"),
      desc: N("冷靜蒐證的專家。錄音筆一放，霸凌者無所遁形。", "冷静な証拠集めのプロ。ボイスレコーダーを仕掛ければ逃げ場はない。", "A calm evidence expert. Once the recorder is planted, there's nowhere to hide."),
      skill: { id: "recorder", name: N("錄音筆", "ボイスレコーダー", "Voice Recorder"), desc: N("這格整章都「有證據」；之後每個校園階段這格有霸凌者就證據 +1。", "このマスは章の間ずっと「証拠あり」。以後、学校フェイズにいじめっ子がいれば証拠 +1。", "This space has evidence for the rest of the chapter; each school phase a bully is here, +1 evidence.") },
      ult: { id: "reaction", name: N("化學反應", "化学反応", "Chemical Reaction"), desc: N("格鬥中使用：畫面上所有霸凌者氣焰 −3，並暈眩一陣子；戰後沒倒下的也被嚇住。", "格闘中に使用：画面上のいじめっ子全員の勢い −3、しばらく気絶。戦闘後も残った者は萎縮。", "In a fight: every bully on screen loses 3 swagger and is dazed; survivors stay stunned afterward.") } },
    { id: "it", icon: "💻", color: "#d4a017", hp: 8, pow: 1, talk: 2, sense: 3,
      name: N("資訊老師", "情報科教師", "IT Teacher"),
      desc: N("掌握校園監視器與網路。遠端就能蒐證，還能扭轉輿論。", "防犯カメラとネットを掌握。離れた場所から証拠を集め、世論もひっくり返す。", "Controls the cameras and the network. Gathers evidence remotely and turns public opinion."),
      skill: { id: "cctv", name: N("監視器調閱", "防犯カメラ確認", "Check Cameras"), desc: N("任選一格有霸凌者的格子，讓它「有證據」，證據 +1。", "いじめっ子のいる任意のマスを「証拠あり」にし、証拠 +1。", "Pick any space with a bully: it gains evidence, and +1 evidence.") },
      ult: { id: "viral", name: N("網路輿論反轉", "ネット世論反転", "Viral Reversal"), desc: N("證據 +3，投訴 −2。", "証拠 +3、苦情 −2。", "+3 evidence, complaints −2.") } },
    { id: "lit", icon: "📖", color: "#c2417a", hp: 9, pow: 2, talk: 3, sense: 1,
      name: N("國文老師", "国語教師", "Literature Teacher"),
      desc: N("言語就是力量。激勵同伴、號召全校，正面衝撞權力。", "言葉こそ力。仲間を鼓舞し、全校に呼びかけ、権力に正面からぶつかる。", "Words are power. Rallies allies, calls on the whole school, and confronts power head-on."),
      skill: { id: "rally", name: N("激勵", "鼓舞", "Rally"), desc: N("同格的老師（含自己）體力 +2、熱血 +1。", "同じマスの教師（自分含む）の体力 +2、熱血 +1。", "Teachers here (including you) gain 2 stamina and 1 passion.") },
      ult: { id: "speech", name: N("校園廣播", "全校放送", "School-wide Address"), desc: N("黑暗度 −3；權力者在場時權力之壁 −3。", "闇 −3。権力者がいれば権力の壁 −3。", "Darkness −3; if a power figure is present, their Wall −3.") } }
  ];
  var CLASS = {};
  CLASSES.forEach(function (c) { CLASS[c.id] = c; });

  // 霸凌者。fierce＝同格有老師就打老師；coward＝同格有老師就逃；stubborn＝說服只有一半效果
  var ENEMIES = [
    { id: "lackey", icon: "😏", hp: 3, atk: 1, name: N("跟班", "取り巻き", "Lackey") },
    { id: "delinquent", icon: "😠", hp: 5, atk: 2, fierce: true, name: N("不良少年", "不良少年", "Delinquent") },
    { id: "netbully", icon: "📱", hp: 3, atk: 1, coward: true, name: N("網路霸凌者", "ネットいじめ犯", "Cyberbully") },
    { id: "senior", icon: "😤", hp: 7, atk: 3, fierce: true, name: N("運動社學長", "運動部の先輩", "Club Senior") },
    { id: "ringleader", icon: "😈", hp: 8, atk: 2, fierce: true, stubborn: true, summon: true, name: N("霸凌主謀", "いじめの主犯", "Ringleader") },
    // 權力者（章節 Boss）
    { id: "queen", icon: "👑", hp: 10, atk: 2, wall: 4, fierce: true, stubborn: true, boss: true, at: "c2a", esc: "lackey",
      name: N("班級女王", "クラスの女王", "Class Queen") },
    { id: "captain", icon: "⚾", hp: 14, atk: 3, wall: 6, fierce: true, stubborn: true, boss: true, at: "gym", esc: "delinquent",
      name: N("棒球隊隊長", "野球部キャプテン", "Baseball Captain") },
    { id: "chairman", icon: "🏛️", hp: 18, atk: 3, wall: 9, fierce: true, stubborn: true, boss: true, at: "principal", esc: "delinquent",
      name: N("理事長", "理事長", "Board Chairman") }
  ];
  var ENEMY = {};
  ENEMIES.forEach(function (e) { ENEMY[e.id] = e; });

  var CHAPTERS = [
    { boss: "queen", victimHp: 6,
      groups: [["lackey"], ["lackey", "lackey"], ["delinquent"], ["netbully", "lackey"], ["delinquent", "lackey"]],
      name: N("第一章　被沉默的教室", "第一章　沈黙の教室", "Chapter 1: The Silenced Classroom"),
      intro: N("你是今年春天新來的老師。第一天就發現：2年A班的學生在走廊上低著頭，沒有人敢說話。前輩老師只說了一句「別多管閒事」。——但你不打算假裝沒看見。",
        "あなたは今年の春に着任した新任教師。初日から気づいた。2年A組の生徒たちは廊下でうつむき、誰も口を開かない。先輩教師は「余計なことはするな」とだけ言った。——だが、見て見ぬふりをするつもりはない。",
        "You're the new teacher this spring. On day one you notice it: the students of Class 2-A walk the halls with their heads down, and nobody dares to speak. A senior teacher only says, \"Don't stick your nose in.\" But you have no intention of looking away."),
      bossLine: N("「老師，你知道我爸是誰嗎？這個班我說了算。」", "「先生、私のパパが誰か知ってる？このクラスは私が決めるの。」", "\"Teacher, do you know who my father is? I run this class.\""),
      clear: N("女王的王冠落地。教室裡第一次響起了笑聲。但你聽說，體育館那邊有更深的陰影……", "女王の王冠が落ちた。教室に初めて笑い声が響いた。だが体育館のほうには、もっと深い影があるらしい……", "The queen's crown falls. For the first time, laughter fills the classroom. But you hear there's a deeper shadow over at the gym...") },
    { boss: "captain", victimHp: 6,
      groups: [["delinquent", "lackey"], ["senior"], ["senior", "lackey"], ["netbully", "netbully"], ["ringleader", "lackey"]],
      name: N("第二章　社團的陰影", "第二章　部活の影", "Chapter 2: Shadow of the Club"),
      intro: N("棒球隊是學校的招牌，拿過全國大賽。但每天放學後，器材室裡都傳出學弟的哭聲。教練說：「這叫磨練。」校方說：「不要影響比賽。」",
        "野球部は学校の看板で、全国大会の常連だ。だが毎日放課後、体育倉庫から後輩の泣き声が聞こえる。監督は「これは鍛錬だ」と言い、学校は「試合に影響を出すな」と言う。",
        "The baseball team is the school's pride, national tournament regulars. But every day after school, crying echoes from the equipment room. The coach calls it \"discipline.\" The school says, \"Don't disrupt the season.\""),
      bossLine: N("「教練都沒說話，你一個新來的憑什麼？」", "「監督も何も言わねえのに、新任のあんたが何様だ？」", "\"Even the coach keeps quiet. Who do you think you are, rookie?\""),
      clear: N("隊長低下了頭，學弟們終於能抬頭挺胸地練球。但這一切，都是有人默許的——那個人就坐在校長室裡。", "キャプテンが頭を下げ、後輩たちはようやく胸を張って練習できるようになった。だが全ては黙認されていた——その人物は校長室にいる。", "The captain bows his head, and the juniors can finally practice with pride. But all of it was allowed to happen, by someone sitting in the principal's office."),
    },
    { boss: "chairman", victimHp: 7,
      groups: [["senior", "delinquent"], ["ringleader", "lackey", "lackey"], ["netbully", "delinquent"], ["senior", "senior"], ["ringleader", "delinquent"]],
      name: N("第三章　理事長的城牆", "第三章　理事長の城壁", "Chapter 3: The Chairman's Wall"),
      intro: N("所有的霸凌事件都被壓了下來，報告書一份都沒有送出校門。理事長用捐款與人脈築起一道牆，把真相和學生的聲音都關在牆裡。這一次，要打破的是權力本身。",
        "すべてのいじめ事件は揉み消され、報告書は一枚も校門の外に出なかった。理事長は寄付金と人脈で壁を築き、真実も生徒の声も閉じ込めた。今度打ち破るのは、権力そのものだ。",
        "Every bullying case was buried; not one report ever left the school gate. With donations and connections, the chairman built a wall that locked away the truth and the students' voices. This time, what you must break is power itself."),
      bossLine: N("「年輕人，正義當不了飯吃。簽了這份切結書，你還能繼續當老師。」", "「若いの、正義じゃ飯は食えんよ。この誓約書にサインすれば、教師を続けさせてやろう。」", "\"Young one, justice doesn't pay the bills. Sign this agreement and you can keep your job.\""),
      clear: N("權力之牆崩塌了。被壓下的報告一份份公開，學生們的聲音終於傳到了校門外。你不再是「新來的老師」——你是他們的老師。",
        "権力の壁は崩れ落ちた。揉み消された報告書は次々と公開され、生徒たちの声はついに校門の外へ届いた。あなたはもう「新任」ではない——彼らの先生だ。",
        "The wall of power crumbles. Buried reports come to light one by one, and the students' voices finally reach beyond the gate. You're no longer \"the new teacher\". You're their teacher.") }
  ];

  var PERKS = ["maxhp", "pow", "talk", "sense", "cd", "heat"];

  var VICTIM_NAMES = {
    zh: ["小林", "阿哲", "佳穎", "子晴", "冠宇", "語彤", "家豪", "品妍", "柏翰", "思妤", "承恩", "雅婷"],
    ja: ["小林", "タクミ", "ユイ", "ハルカ", "ソウタ", "ミオ", "ケンタ", "サクラ", "リク", "アオイ", "ユウト", "ヒナ"],
    en: ["Kobayashi", "Leo", "Mia", "Hana", "Sam", "Yui", "Ken", "Lily", "Ray", "Ivy", "Noah", "Emma"]
  };

  window.PriTestFistData = {
    W: W, H: H, TILES: TILES, TILE: TILE,
    CLASSES: CLASSES, CLASS: CLASS,
    ENEMIES: ENEMIES, ENEMY: ENEMY,
    CHAPTERS: CHAPTERS, PERKS: PERKS, VICTIM_NAMES: VICTIM_NAMES,
    MAX_DARK: 20, MAX_COMP: 10, MAX_HEAT: 5, AP: 3, STEPS: 5, BOSS_ROUND: 7, SKILL_CD: 2,
    SPAWN_RATE: [0, 0.5, 1.0, 1.9, 2.3],
    // 在格鬥畫面裡放的必殺技（其他的在地圖上用）
    FIGHT_ULTS: { barrage: 1, legend: 1, truth: 1, reaction: 1 },
    // 格鬥：畫面上的數值＝規則數值 ×10（霸凌者氣焰 5 → 50）
    FIGHT_SCALE: 10, FIGHT_TIME: 10
  };
})();
