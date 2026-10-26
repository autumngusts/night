// 鐵拳教育：搜打撤模式的文本（學生台詞、線索、說謊的破綻、指認反應、晨間傳聞）。
// 規則引擎只記「用哪一句、填什麼」（例如 ["clue", 句型, 特徵, 值]），畫面再用這裡的模板組成三語文字，
// 所以存檔不依賴語言，切換語言後舊的對話也會跟著換。設計見 docs/fist_raid_design.md 第 8 節。
// 學生的代名詞一律避開（用名字或「那個人」），不從名字推測性別。
(function () {
  "use strict";

  function N(zh, ja, en) { return { zh: zh, ja: ja, en: en }; }

  // 每個特徵值的「述語」：接在「那個人」後面（ATTRS 的順序與 fist_raid_data.js 相同）
  var PRED = {
    grade: [N("是 1 年級的，繫綠領帶", "1年生だった。緑のネクタイ", "is a first-year (green tie)"),
      N("是 2 年級的，繫藍領帶", "2年生だった。青のネクタイ", "is a second-year (blue tie)"),
      N("是 3 年級的，繫紅領帶", "3年生だった。赤のネクタイ", "is a third-year (red tie)")],
    hair: [N("留短髮", "ショートヘアだった", "has short hair"), N("留長髮", "ロングヘアだった", "has long hair"),
      N("綁著馬尾", "ポニーテールだった", "wears a ponytail"), N("理平頭", "坊主頭だった", "has a buzz cut"),
      N("剪鮑伯頭", "ボブだった", "has a bob"), N("一頭捲髮", "くせ毛だった", "has curly hair")],
    color: [N("是黑頭髮", "黒髪だった", "has black hair"), N("頭髮是咖啡色的", "茶髪だった", "has brown hair"),
      N("頭髮染成金色", "金髪に染めていた", "has bleached blond hair")],
    glasses: [N("沒戴眼鏡", "眼鏡はかけていなかった", "doesn't wear glasses"), N("戴著眼鏡", "眼鏡をかけていた", "wears glasses")],
    acc: [N("身上沒什麼配件", "アクセサリーはつけていなかった", "wears no accessories"), N("別著髮夾", "ヘアピンをつけていた", "wears a hairpin"),
      N("戴著耳環", "ピアスをしていた", "wears an earring"), N("脖子上掛著耳機", "首にヘッドホンをかけていた", "keeps headphones around their neck"),
      N("戴著口罩", "マスクをしていた", "wears a face mask"), N("臉上貼著 OK 繃", "顔に絆創膏を貼っていた", "has a bandage on their face")],
    club: [N("沒參加社團", "部活には入っていない", "isn't in any club"), N("是籃球社的", "バスケ部だ", "is in the basketball club"),
      N("是棒球社的", "野球部だ", "is in the baseball club"), N("是熱音社的", "軽音部だ", "is in the band club"),
      N("是美術社的", "美術部だ", "is in the art club"), N("是劍道社的", "剣道部だ", "is in the kendo club")]
  };

  // 線索句型：{p}＝述語
  var CLUE = [
    N("我看到了……在後面下指令的那個人{p}。", "見たんだ……後ろで指示してたやつは{p}。", "I saw it... the one giving the orders {p}."),
    N("大家都怕的那個「老大」，{p}。", "みんなが怖がってる『ボス』は{p}。", "The \"boss\" everyone's afraid of {p}."),
    N("被欺負的同學偷偷跟我說過：帶頭的人{p}。", "いじめられてる子がこっそり教えてくれた。仕切ってるのは{p}。", "One of the kids being bullied told me quietly: the leader {p}."),
    N("那天在走廊上，我聽到有人喊「照老大說的做」……說話的對象{p}。", "あの日、廊下で『ボスの言う通りにしろ』って声がした……言われてた相手は{p}。", "That day in the hall I heard someone say \"do what the boss says\"... and the one they meant {p}."),
    N("群組裡那些訊息，都是同一個人傳的。那個人{p}。", "グループのあのメッセージ、全部同じ人が送ってる。その人は{p}。", "All those messages in the group chat came from one person, who {p}."),
    N("我不想惹麻煩……但我只說一件事：主謀{p}。", "面倒は嫌だけど……ひとつだけ。主犯は{p}。", "I don't want trouble... but just one thing: the mastermind {p}."),
    N("放學後在{place}，我看過那個人。那個人{p}。", "放課後、{place}でそいつを見た。そいつは{p}。", "After school at the {place}, I saw them. They {p}.")
  ];
  // 招供（共犯被指認時）
  var CONFESS = [
    N("……對不起，我只是跟著做而已。真正的老大{p}。", "……ごめんなさい。言われた通りにしただけなんだ。本当のボスは{p}。", "...I'm sorry, I just went along with it. The real boss {p}."),
    N("好啦好啦，我說！叫我們動手的人{p}。拜託不要告訴他們是我說的。", "わかった、言うよ！やれって言ったのは{p}。俺が言ったって言わないで。", "Fine, fine, I'll talk! The one who told us to do it {p}. Please don't say it was me.")
  ];

  // 招呼：依個性（mood）
  var GREET = {
    shy: [N("……老、老師好。", "……せ、先生、こんにちは。", "...H-hello, teacher."), N("（小聲）有什麼事嗎……", "（小声で）何か用ですか……", "(quietly) Is something wrong...?"),
      N("我、我什麼都沒做喔……", "わ、私は何もしてないです……", "I-I didn't do anything..."), N("……（緊張地抓著書包背帶）", "……（カバンの紐をぎゅっと握っている）", "...(gripping the strap of their bag)")],
    bright: [N("啊，新來的老師！聽說你很敢喔！", "あ、新任の先生！けっこう攻めてるって噂だよ！", "Oh, the new teacher! I heard you're pretty bold!"),
      N("老師這麼晚還在學校？加班辛苦了～", "先生、こんな時間まで？お疲れさまー", "Still at school this late? Thanks for working so hard~"),
      N("嘿嘿，老師要不要吃糖？", "へへ、先生、飴いる？", "Hehe, want some candy, teacher?"), N("老師！我剛剛社團練習超累的！", "先生！さっき部活でへとへとだよ！", "Teacher! Practice just wiped me out!")],
    blunt: [N("幹嘛？我很忙。", "何？忙しいんだけど。", "What? I'm busy."), N("老師也管太多了吧。", "先生、首突っ込みすぎじゃない？", "Aren't you sticking your nose in a bit much?"),
      N("……快點說，我要回家了。", "……早くして。帰りたいんだけど。", "...Make it quick, I want to go home."), N("又是你喔。", "またあんたか。", "You again.")],
    calm: [N("老師好。有什麼我能幫忙的嗎？", "こんにちは、先生。何かお手伝いできますか？", "Hello, teacher. Can I help with something?"),
      N("這個時間的學校，安靜得有點可怕呢。", "この時間の学校って、静かすぎて少し怖いですね。", "The school's almost scary-quiet at this hour."),
      N("老師是在調查那件事嗎？", "先生、あの件を調べてるんですか？", "Are you looking into... that thing?"), N("我剛好也想找老師說話。", "ちょうど先生と話したかったんです。", "I was actually hoping to talk to you.")]
  };
  // 說謊的破綻（共犯常有，誠實的人偶爾也會緊張）
  var TELL = [
    N("……（眼神飄向別處）", "……（目をそらした）", "...(their eyes drift away)"), N("（回答得太快了）", "（答えるのが早すぎる）", "(answers a little too quickly)"),
    N("（手指一直在敲桌子）", "（指で机をずっと叩いている）", "(keeps tapping the desk)"), N("……老師，你不會跟別人說吧？", "……先生、誰にも言わないよね？", "...You won't tell anyone, right?"),
    N("（笑了一下，又馬上收起來）", "（一瞬笑って、すぐ真顔に戻った）", "(smiles for a second, then stops)")
  ];
  // 沒有線索可說
  var NONE = [
    N("我不知道……真的，我什麼都沒看到。", "知らない……本当に何も見てない。", "I don't know... really, I didn't see anything."),
    N("那種事，我不想扯進去。", "そういうのには関わりたくない。", "I don't want to get mixed up in that."),
    N("我能說的都說了。", "言えることはもう全部言ったよ。", "I've told you everything I can."),
    N("上次跟老師說完之後，我就沒再看到什麼了。", "前に先生に話してから、特に何も見てない。", "I haven't seen anything since I last talked to you.")
  ];
  // 閒聊（{place}＝常出沒的地點、{club}＝社團）
  var SMALL = [
    N("我放學後通常都在{place}。", "放課後はたいてい{place}にいるよ。", "I'm usually at the {place} after school."),
    N("最近{place}那邊氣氛怪怪的。", "最近、{place}のあたりの空気が変なんだ。", "Things have felt off around the {place} lately."),
    N("{club}最近好像有人一直請假。", "{club}、最近ずっと休んでる人がいるみたい。", "Someone in {club} keeps skipping lately."),
    N("老師，學校真的會變好嗎？", "先生、学校って本当に変わるのかな。", "Teacher, can this school really change?")
  ];
  // 被救出的學生（之後每局遇到都會說真話）
  var THANKS = [
    N("老師……謝謝你。我會把看到的都說出來。", "先生……ありがとう。見たこと、全部話すよ。", "Teacher... thank you. I'll tell you everything I saw."),
    N("上次多虧了老師。這次換我幫你。", "この前は先生のおかげで助かった。今度は私が力になる。", "You helped me last time. Now it's my turn to help you.")
  ];
  // 拒絕作證（被冤枉過）
  var REFUSE = [
    N("你還有臉來找我？我爸媽已經去投訴了。", "よく話しかけられるね。親がもう苦情を入れたから。", "You've got some nerve. My parents already filed a complaint."),
    N("……我不想跟冤枉我的人說話。", "……疑ってきた人とは話したくない。", "...I don't talk to people who accused me.")
  ];
  // 指認結果
  var ACCUSE = {
    wrong: [N("「什麼？我？你有證據嗎！」周圍的學生都看了過來。", "「は？私？証拠あるの！？」周りの生徒たちが振り向いた。", "\"What? Me? Do you have any proof?!\" Everyone nearby turns to look."),
      N("「……老師，你搞錯人了。我要跟家長說。」", "「……先生、人違いだよ。親に言うから。」", "\"...You've got the wrong person. I'm telling my parents.\"")],
    mm: [N("「……呵。被你發現了啊，老師。」那個人的表情一下子變了。", "「……ふーん。バレちゃったか、先生。」その顔つきが一変した。", "\"...Heh. So you figured it out, teacher.\" Their expression changes in an instant."),
      N("「我還以為這學校沒人敢碰我。」那個人慢慢站了起來。", "「この学校で俺に手を出せるやつなんていないと思ってた。」そいつはゆっくり立ち上がった。", "\"I thought nobody in this school would dare touch me.\" They slowly stand up.")]
  };

  // 晨間傳聞（依前幾局發生的事）
  var RUMOR = {
    rescued: [N("{name}今天終於敢抬頭走路了，還說想謝謝老師。", "{name}が今日やっと顔を上げて歩いてた。先生にお礼を言いたいって。", "{name} finally walked with their head up today, and wants to thank you."),
      N("{name}在班上第一次舉手發言了。", "{name}が初めてクラスで手を挙げて発言した。", "{name} raised a hand in class for the first time.")],
    broke: [N("{name}已經好幾天沒來上學了……", "{name}はもう何日も学校に来ていない……", "{name} hasn't come to school in days..."),
      N("{name}的座位一直空著。", "{name}の席はずっと空いたままだ。", "{name}'s seat stays empty.")],
    wrong: [N("{name}的家長到學校抗議，說新來的老師冤枉人。", "{name}の親が学校に乗り込んできた。新任教師に濡れ衣を着せられたって。", "{name}'s parents came to complain that the new teacher made false accusations.")],
    confess: [N("{name}最近都一個人吃午餐，好像在躲誰。", "{name}は最近ひとりで昼を食べている。誰かを避けているみたいだ。", "{name} has been eating lunch alone lately, as if avoiding someone.")],
    solved: [N("{name}被停學了。走廊上的空氣好像輕了一點。", "{name}が停学になった。廊下の空気が少し軽くなった気がする。", "{name} has been suspended. The halls feel a little lighter.")],
    down: [N("聽說昨天放學後，有老師在校園裡倒下了。", "昨日の放課後、校舎で先生が倒れたらしい。", "Word is a teacher collapsed in the school after hours yesterday.")],
    trapped: [N("昨晚校方突然封校，有人說是因為「有老師在亂查」。", "昨夜、学校が急に封鎖された。「嗅ぎ回ってる教師がいる」かららしい。", "The school locked down suddenly last night. Some say it's because \"a teacher's been snooping\".")],
    extract: [N("教育局收到一封匿名信，裡面附了證據。", "教育委員会に、証拠つきの匿名の手紙が届いたらしい。", "The education board reportedly received an anonymous letter with evidence attached.")],
    wall: [N("教職員會議上，第一次有人提到了「{boss}」的名字。", "職員会議で、初めて『{boss}』の名前が出た。", "At the staff meeting, someone mentioned \"{boss}\" by name for the first time.")],
    key: [N("聽說{zone}的門，最近被人打開過。", "{zone}の扉が最近開けられたらしい。", "Someone says the door to the {zone} was opened recently.")],
    hot: [N("最近放學後，{place}常有一群人聚在一起。", "最近、放課後の{place}に人が集まっているらしい。", "Lately a group has been gathering at the {place} after school."),
      N("有人在{place}聽到哭聲。", "{place}で泣き声を聞いた人がいる。", "Someone heard crying at the {place}.")],
    hint: [N("{name}說：「那個主謀……好像{p}。」", "{name}いわく「あの主犯……{p}気がする」", "{name} says: \"That mastermind... I think they {p}.\"")],
    start: [N("新的學期，新的案件。這次的霸凌，背後也有人在操控。", "新しい学期、新しい事件。今回のいじめにも、裏で糸を引く者がいる。", "A new term, a new case. Someone is pulling the strings behind this bullying too.")]
  };

  // 受害日記的片段（搜到日記時顯示；{place}、{p}）
  var DIARY = [
    N("「今天又被叫到{place}。他們說，老大{p}，不准我說出去。」", "「今日も{place}に呼び出された。ボスは{p}って。誰にも言うなって。」", "\"Called to the {place} again today. They said the boss {p}, and I can't tell anyone.\""),
    N("「好想消失。可是如果我消失了，下一個就是別人。」", "「消えたい。でも私が消えたら、次は別の誰かだ。」", "\"I want to disappear. But if I do, it'll just be someone else next.\"")
  ];

  window.PriTestFistRaidText = { PRED: PRED, CLUE: CLUE, CONFESS: CONFESS, GREET: GREET, TELL: TELL, NONE: NONE, SMALL: SMALL,
    THANKS: THANKS, REFUSE: REFUSE, ACCUSE: ACCUSE, RUMOR: RUMOR, DIARY: DIARY, MOODS: ["shy", "bright", "blunt", "calm"] };
})();
