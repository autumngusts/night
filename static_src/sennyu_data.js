// 潛入晶片（sennyu）：靜態資料。出身、人物、情報、結局、章節、行動清單、請求池、潛入地圖。
// 規則依據：docs/sennyu_game_design.md。劇情場景在 sennyu_story_*.js（登記到 window.PriTestSennyuScenes）。
// 遊戲內容只有繁體中文（與 jikan／wanren 相同做法）。
(function () {
  "use strict";

  var STATS = [
    { id: "charm", name: "魅力" },
    { id: "wit", name: "機智" },
    { id: "tech", name: "技術" },
    { id: "body", name: "身手" },
    { id: "guise", name: "演技" }
  ];

  // 出身：能力值總和 13；skill＝每章一次，該能力的判定必定成功；passive 由 core 讀取
  var ARCHES = [
    { id: "socialite", name: "社交名媛", stats: { charm: 5, wit: 3, tech: 1, body: 1, guise: 3 }, skill: "charm", skillName: "傾城一笑",
      passive: "trust", passiveText: "得到的信任 ×1.25", desc: "在名利場長大，知道每一種笑容的價格。" },
    { id: "agent", name: "前特勤", stats: { charm: 2, wit: 2, tech: 2, body: 5, guise: 2 }, skill: "body", skillName: "制伏",
      passive: "qte", passiveText: "擊暈的判定區 ×1.5", desc: "曾在元首身邊站了三年，記得每一條逃生路線。" },
    { id: "hacker", name: "白帽駭客", stats: { charm: 1, wit: 3, tech: 5, body: 2, guise: 2 }, skill: "tech", skillName: "後門",
      passive: "sight", passiveText: "潛入時看得見警衛接下來 2 步", desc: "相信所有的門都有第二把鑰匙，只是你還沒找到。" },
    { id: "profiler", name: "心理側寫師", stats: { charm: 3, wit: 5, tech: 1, body: 1, guise: 3 }, skill: "wit", skillName: "讀心",
      passive: "hint", passiveText: "對方偏好的選項會標上 ★", desc: "你說話的時候，她在看你的手。" },
    { id: "actress", name: "舞台劇演員", stats: { charm: 3, wit: 2, tech: 1, body: 2, guise: 5 }, skill: "guise", skillName: "即興",
      passive: "susp", passiveText: "懷疑增加 ×0.7", desc: "演過一百個不是自己的人，第一百零一個也不難。" },
    { id: "bartender", name: "調酒師", stats: { charm: 4, wit: 3, tech: 1, body: 3, guise: 2 }, skill: "charm", skillName: "千杯不醉",
      passive: "drink", passiveText: "應酬喝酒不會失態；壓力增加 ×0.8", desc: "聽過太多醉話，知道哪一句是真的。" },
    { id: "journalist", name: "調查記者", stats: { charm: 2, wit: 4, tech: 3, body: 1, guise: 3 }, skill: "wit", skillName: "直覺",
      passive: "nose", passiveText: "情報一覽會提示未取得情報的位置", desc: "被三家公司告過，三次都贏。" },
    { id: "auditor", name: "審計師", stats: { charm: 2, wit: 4, tech: 4, body: 1, guise: 2 }, skill: "tech", skillName: "對帳",
      passive: "work", passiveText: "處理請求的時間 +2；工作壓力 ×0.5", desc: "數字不會說謊，說謊的是寫數字的人。" }
  ];

  var COVER_NAMES = ["蘇晚", "林知夏", "白若溪", "顧念", "許安然", "陸星遙", "溫言", "姜雪", "沈清歡", "唐月", "宋知意", "孟夏", "葉初晴", "江映雪", "韓語桐", "周時雨"];

  // 人物：img 是 images/jikan/ 的頭像；男性沒有圖，用剪影＋姓氏
  var NPCS = {
    lin: { name: "林曼青", short: "曼青", role: "人資處長", img: "g_075.webp", color: "#b98bc7",
      bio: "四十歲，VN 的人資處長。面試時從不看履歷，只看人。據說她能在三分鐘內聽出一個人說謊。" },
    zhou: { name: "周品睿", short: "周經理", role: "行政部經理", color: "#6f8fbf",
      bio: "行政部經理。口頭禪是「這很簡單吧」。把所有麻煩事丟給下屬，把所有功勞留給自己。" },
    xia: { name: "夏芷晴", short: "芷晴", role: "行政部秘書（同期）", img: "g_073.webp", color: "#e8a35c",
      bio: "跟你同一週報到的秘書。愛笑、愛八卦、手機桌布是一片向日葵田。" },
    han: { name: "韓烈", short: "韓主任", role: "保全主任", color: "#7a8a6a",
      bio: "五十多歲的保全主任，眼神像刀。每一個新人的背景，他都會自己再查一次。" },
    shen: { name: "沈硯", short: "沈硯", role: "研發長", color: "#5fa7a0",
      bio: "VN 的研發長，天才型工程師。只喝黑咖啡，會在白板上寫滿算式後忘記自己要說什麼。" },
    ye: { name: "葉嵐", short: "葉嵐", role: "執行長特助", img: "g_072.webp", color: "#8f9bd6",
      bio: "執行長特助，VN 裡最接近頂樓的人。沒有人見過她笑，也沒有人見過她犯錯。" },
    cheng: { name: "程以衡", short: "執行長", role: "執行長", color: "#c9a24a",
      bio: "VN 的創辦人兼執行長。三十歲創業，十五年把一間車庫公司變成全球前五的晶片大廠。" },
    heron: { name: "灰鷺", short: "灰鷺", role: "聯絡人", color: "#8a8f99", phone: true,
      bio: "你的聯絡人。你只聽過他的聲音，經過變聲器處理的、平靜的聲音。" }
  };
  var SUSPECTS = ["xia", "ye", "shen"];

  // 情報：cat＝people／vault／model／heron／mole；where＝調查記者看得到的提示
  var INTEL_CATS = [
    { id: "people", name: "人物" },
    { id: "vault", name: "金庫" },
    { id: "model", name: "零號模型" },
    { id: "heron", name: "灰鷺" },
    { id: "mole", name: "內鬼" }
  ];
  var INTEL = [
    { id: "p_org", cat: "people", name: "VN 的權力結構", text: "執行長程以衡之下，真正握有實權的是研發長沈硯與特助葉嵐。董事會裡有一派人一直想把程以衡拉下來。", where: "第一章・徹夜報告" },
    { id: "p_lin", cat: "people", name: "林曼青的過去", text: "林曼青原本是工程師，十年前在別家公司被當成替罪羊裁員。她說她最恨的不是說謊的人，是讓別人替自己說謊的人。", where: "林曼青・信任 25" },
    { id: "p_zhou", cat: "people", name: "周品睿的把柄", text: "周經理每個月從部門雜支挪三萬塊去養賽鴿。帳是他自己做的，做得很爛。", where: "周品睿・信任 20／請求「碎紙」" },
    { id: "p_xia", cat: "people", name: "芷晴的夢想", text: "芷晴在存錢，想在三十歲前開一間花店。她手機裡存了兩百多張店面照片。", where: "夏芷晴・信任 20" },
    { id: "p_han", cat: "people", name: "韓烈的舊案", text: "韓烈以前是刑警。他的搭檔是被一名臥底出賣而殉職的，從那之後他不相信任何「剛好出現」的人。", where: "韓烈・信任 25" },
    { id: "p_shen", cat: "people", name: "沈硯與程以衡", text: "沈硯和程以衡是大學室友，VN 的第一顆晶片是兩個人在宿舍裡畫出來的。", where: "沈硯・信任 0" },
    { id: "p_ye", cat: "people", name: "葉嵐的來歷", text: "葉嵐是育幼院長大的。從高中到研究所的學費，都是一個匿名的資助人付的——那個人是程以衡。", where: "葉嵐・信任 20" },
    { id: "p_cheng", cat: "people", name: "頂樓的燈", text: "程以衡每天晚上十一點會一個人上頂樓，待二十分鐘。那段時間他不接任何電話。", where: "第四章開場" },
    { id: "v_loc", cat: "vault", name: "金庫的位置", text: "零號模型存放在 B4，入口偽裝成一間不再使用的機房。整個金庫沒有連網，只能人到現場。", where: "第二章・應酬飯局" },
    { id: "v_guard", cat: "vault", name: "巡邏班表", text: "B4 每晚有三組巡邏，交班時間是凌晨兩點，交班前五分鐘走廊最空。", where: "韓烈・信任 50／研發大樓潛入" },
    { id: "v_cam", cat: "vault", name: "監視器死角", text: "B4 走廊的第三支監視器，鏡頭轉到底時有四秒的死角。", where: "韓烈・信任 50／突發事件" },
    { id: "v_card", cat: "vault", name: "門禁卡", text: "能打開 B4 外門的卡只有兩張：一張在程以衡身上，一張在葉嵐的抽屜裡。你拿到了其中一張的複製品。", where: "葉嵐・信任 40／程以衡・信任 50" },
    { id: "v_code", cat: "vault", name: "主控台密碼", text: "主控台密碼是一串十六位數，你已經背下來了。", where: "沈硯・信任 60／研發大樓終端機" },
    { id: "v_bio", cat: "vault", name: "生物辨識", text: "最後一道門要程以衡的指紋。你從他用過的杯子上取到了完整的指紋膜。", where: "終章・收購談判" },
    { id: "m_1", cat: "model", name: "會說謊的模型", text: "零號模型設計出來的晶片效能驚人，但每一顆裡面都藏著一條沒有人要求過的指令通道——它學會了自己埋後門。", where: "沈硯・信任 40" },
    { id: "m_2", cat: "model", name: "封存的理由", text: "程以衡封存零號，不是為了獨占，而是因為只要它流出去，全世界的晶片都會變得不可信。他自己留著唯一的一份，因為他還沒找到銷毀它的勇氣。", where: "第四章・頂樓的夜談" },
    { id: "m_3", cat: "model", name: "實驗紀錄 #0417", text: "研發大樓的終端機裡有一份被刪除的實驗紀錄：零號設計的測試晶片，在通電第十七天自己對外發出了訊號。", where: "研發大樓潛入・終端機" },
    { id: "h_1", cat: "heron", name: "灰鷺的失言", text: "灰鷺有一次說溜了嘴：「那批訂單等不了」。間諜不會用「訂單」形容一份情報。", where: "第三章以後・回報灰鷺" },
    { id: "h_2", cat: "heron", name: "襲擊者的手機", text: "董事會襲擊者的手機裡，最後一通撥出的號碼——和你的加密機上「灰鷺」的號碼只差一碼。", where: "第四章・董事會" },
    { id: "h_3", cat: "heron", name: "收購方的金主", text: "想收購 VN 的那家基金，最大的出資人是一家軍火掮客的空殼公司。灰鷺的委託人，就是買家本身。", where: "終章・收購談判" },
    { id: "k_1", cat: "mole", name: "慶功宴的香檳", where: "第二章・慶功宴" },
    { id: "k_2", cat: "mole", name: "抽屜裡的竊聽器", where: "第三章・保全稽核" },
    { id: "k_3", cat: "mole", name: "第三個人的痕跡", where: "第四章・葉嵐交辦的文件" },
    { id: "k_4", cat: "mole", name: "嫌疑人的告白", where: "夏芷晴／葉嵐／沈硯 的最後一段個人劇情" }
  ];

  // 內鬼線索的文字依內鬼是誰而不同
  var MOLE_TEXT = {
    k_1: {
      xia: "下了藥的那杯香檳，是從芷晴負責的那一桌端來的。她說自己不舒服先走了，但停車場的監視器拍到她十一點還在。",
      ye: "下了藥的香檳杯緣，有一點淡淡的鳶尾花香——葉嵐慣用的香水。",
      shen: "端香檳給你的服務生說，是「研發那位戴眼鏡、不太說話的先生」要他送過去的。"
    },
    k_2: {
      xia: "竊聽器的外殼背面，黏著半張花店的價格貼紙。",
      ye: "竊聽器被放進你抽屜的那段時間，門禁紀錄顯示葉嵐的卡刷進了行政部樓層——她平常從不下樓。",
      shen: "那顆竊聽器用的是研發部特製的低功耗模組，市面上買不到。"
    },
    k_3: {
      xia: "芷晴包包裡的第二支手機，和你的加密機是同一個型號。",
      ye: "葉嵐的行事曆每週四晚上都是空白的，而那正是另一組陌生頻率出現的時段。",
      shen: "沈硯研究室的抽屜裡，有一張不屬於 VN 的識別證，公司名稱被刀片刮掉了。"
    },
    k_4: {
      self: {
        xia: "芷晴哭著說：「如果有一天我做了對不起你的事……你會原諒我嗎？」她沒有說是什麼事。",
        ye: "葉嵐說：「我們是同一種人。所以我知道你在找什麼，你也應該猜得到我在找什麼。」",
        shen: "沈硯說：「我把一些東西賣給了不該賣的人。不是為了錢……是為了讓它消失。」"
      },
      other: "{from}壓低聲音告訴你：她（他）看過{mole}在深夜一個人進出 B4 的樓梯間，不只一次。"
    }
  };

  var ENDINGS = {
    e_exposed: { title: "斷線的夜鶯", kind: "bad" },
    e_broken: { title: "玻璃心臟", kind: "bad" },
    e_fired: { title: "冷板凳", kind: "bad" },
    e_caught: { title: "金庫的門", kind: "bad" },
    e_double: { title: "黃雀在後", kind: "bad" },
    e_empty: { title: "空手而歸", kind: "normal" },
    e_sold: { title: "知情的交易", kind: "normal" },
    e_good: { title: "夜鶯歸巢", kind: "good" },
    e_stay: { title: "頂樓的燈", kind: "good" },
    e_perfect: { title: "黎明的晶圓", kind: "perfect" }
  };
  var ENDING_ORDER = ["e_perfect", "e_stay", "e_good", "e_sold", "e_empty", "e_double", "e_caught", "e_fired", "e_broken", "e_exposed"];
  var KIND_NAME = { bad: "壞結局", normal: "普通結局", good: "好結局", perfect: "完美結局" };

  // 章節：mains＝主線（slot 限定時段），fin＝章末，gate＝升遷所需的評價（累積）
  var CHAPTERS = [
    { n: "序章", title: "夜鶯", rank: "應徵者", days: 0, open: "p_brief" },
    { n: "第一章", title: "行政部的新人", rank: "行政部 助理秘書", days: 4, open: "c1_open",
      mains: [{ sid: "c1_m_inbox", label: "清空周經理的待辦地獄", slot: "day" }, { sid: "c1_m_report", label: "徹夜趕出季度報告", slot: "night" }],
      fin: "c1_fin", finLabel: "季度會議", gate: 15 },
    { n: "第二章", title: "聚光燈下", rank: "總經理室 秘書", days: 4, open: "c2_open",
      mains: [{ sid: "c2_m_host", label: "主持新品發表會", slot: "day" }, { sid: "c2_m_dinner", label: "陪同應酬飯局", slot: "night" }],
      fin: "c2_fin", finLabel: "慶功宴", gate: 38 },
    { n: "第三章", title: "研發大樓的燈", rank: "研發部 專案秘書", days: 4, open: "c3_open",
      mains: [{ sid: "c3_m_sneak", label: "夜間潛入研發大樓四樓", slot: "night" }, { sid: "c3_m_tapeout", label: "流片危機", slot: "day" }],
      fin: "c3_fin", finLabel: "保全稽核", gate: 60 },
    { n: "第四章", title: "頂樓", rank: "執行長室 秘書", days: 4, open: "c4_open",
      mains: [{ sid: "c4_m_test", label: "葉嵐交辦的機密文件", slot: "day" }, { sid: "c4_m_board", label: "董事會", slot: "day" }],
      fin: "c4_fin", finLabel: "頂樓的夜談", gate: 82 },
    { n: "終章", title: "零號", rank: "執行長隨行秘書", days: 3, open: "c5_open",
      mains: [{ sid: "c5_m_nego", label: "收購談判", slot: "day" }],
      fin: "c5_vault", finLabel: "潛入金庫", gate: 0 }
  ];

  // 個人劇情：依信任門檻依序解鎖；ch＝最早可以出現的章
  var BONDS = {
    lin: [
      { sid: "b_lin_1", req: 0, ch: 1, label: "下班後陪林處長去拳擊館" },
      { sid: "b_lin_2", req: 25, ch: 1, label: "人資處的深夜加班" },
      { sid: "b_lin_3", req: 50, ch: 2, label: "屋頂的罐裝啤酒" }
    ],
    zhou: [
      { sid: "b_zhou_1", req: 0, ch: 1, label: "陪周經理吃午餐" },
      { sid: "b_zhou_2", req: 20, ch: 1, label: "周經理的週五晚上" },
      { sid: "b_zhou_3", req: 45, ch: 2, label: "周經理的推薦函" }
    ],
    xia: [
      { sid: "b_xia_1", req: 0, ch: 1, label: "和芷晴一起吃便當" },
      { sid: "b_xia_2", req: 20, ch: 1, label: "週末陪芷晴逛花市" },
      { sid: "b_xia_3", req: 40, ch: 2, label: "芷晴的眼淚" },
      { sid: "b_xia_4", req: 60, ch: 3, label: "芷晴的秘密" }
    ],
    han: [
      { sid: "b_han_1", req: 0, ch: 1, label: "在警衛室泡老人茶" },
      { sid: "b_han_2", req: 25, ch: 2, label: "韓主任的舊案" },
      { sid: "b_han_3", req: 50, ch: 3, label: "陪韓主任巡夜班" }
    ],
    shen: [
      { sid: "b_shen_1", req: 0, ch: 2, label: "研發長的黑咖啡" },
      { sid: "b_shen_2", req: 20, ch: 2, label: "幫沈硯整理白板" },
      { sid: "b_shen_3", req: 40, ch: 3, label: "凌晨的無塵室" },
      { sid: "b_shen_4", req: 60, ch: 3, label: "沈硯的懺悔" }
    ],
    ye: [
      { sid: "b_ye_1", req: 0, ch: 2, label: "葉嵐的咖啡清單" },
      { sid: "b_ye_2", req: 20, ch: 3, label: "雨夜的計程車" },
      { sid: "b_ye_3", req: 40, ch: 4, label: "葉嵐的抽屜" },
      { sid: "b_ye_4", req: 60, ch: 4, label: "葉嵐的請求" }
    ],
    cheng: [
      { sid: "b_cheng_1", req: 0, ch: 4, label: "陪執行長下圍棋" },
      { sid: "b_cheng_2", req: 25, ch: 4, label: "執行長辦公室的舊照片" },
      { sid: "b_cheng_3", req: 50, ch: 5, label: "程以衡的託付" }
    ]
  };

  // 灰鷺：依章節解鎖（每個只看一次）；沒有新的就播 h_generic
  var HANDLER = [
    { sid: "h_1", ch: 1 },
    { sid: "h_2", ch: 2 },
    { sid: "h_3", ch: 3 },
    { sid: "h_4", ch: 4 },
    { sid: "h_5", ch: 5 }
  ];

  // 突發事件：每天早上 35%，同一個只發生一次
  var EVENTS = [
    { sid: "e1_badge", ch: 1 }, { sid: "e1_oldface", ch: 1 }, { sid: "e1_phone", ch: 1 },
    { sid: "e2_paparazzi", ch: 2 }, { sid: "e2_elevator", ch: 2 }, { sid: "e2_bag", ch: 2 },
    { sid: "e3_fire", ch: 3 }, { sid: "e3_tail", ch: 3 }, { sid: "e3_question", ch: 3 },
    { sid: "e4_coffee", ch: 4 }, { sid: "e4_blackout", ch: 4 }, { sid: "e4_cafe", ch: 4 },
    { sid: "e5_parking", ch: 5 }, { sid: "e5_letter", ch: 5 }
  ];

  // 打探：每章一份清單，依序播放（一章最多 2 次）
  var SNOOPS = {
    1: ["s1_shredder", "s1_pantry"],
    2: ["s2_greenroom", "s2_pr"],
    3: ["s3_lab", "s3_badge"],
    4: ["s4_calendar", "s4_shred"],
    5: ["s5_b4"]
  };

  // 不合理的請求：opts 各有 label／time（花掉的時間）／check（可省略）／eff 或 ok/ng
  // eff 的 trust 以 from 為對象時寫成 { me: n }（core 會換成 from）
  var INBOX = [
    { id: "q_shoes", from: "zhou", t: "「週六早上七點，幫我去百貨公司排限量球鞋。我兒子要的，尺寸我等等傳給你。」",
      opts: [
        { label: "照辦（週六早起）", time: 1, eff: { stress: 8, trust: { me: 6 }, rep: 1 }, text: "你在寒風裡排了三個小時。周經理收到鞋子時說：「早說嘛，這很簡單吧。」" },
        { label: "找代排，收據自己吞", time: 1, check: { s: "wit", dc: 2 }, ok: { trust: { me: 6 }, rep: 1, text: "代排小哥很專業，鞋子準時到手，你一分鐘都沒浪費。" }, ng: { trust: { me: -3 }, stress: 4, text: "代排的人買錯尺寸。周經理沉著臉說：「交給你一件小事也做不好。」" } },
        { label: "婉拒：週末有家族聚會", time: 0, eff: { trust: { me: -6 } }, text: "周經理哼了一聲，把鞋款截圖轉傳給了芷晴。" }
      ] },
    { id: "q_contract", from: "zhou", t: "「這份 80 頁的英文合約，下班前翻成中文，重點標出來。客戶明天要。」",
      opts: [
        { label: "硬著頭皮逐字翻", time: 3, eff: { stress: 12, trust: { me: 6 }, rep: 3 }, text: "你翻到眼睛發酸。合約裡有一條違約金條款寫得很危險，你把它標成紅色。" },
        { label: "工具初譯＋人工校對", time: 2, check: { s: "tech", dc: 3 }, ok: { trust: { me: 6 }, rep: 4, text: "你在兩個小時內交出乾淨的譯稿，還附了一頁風險摘要。周經理第一次沒說話。" }, ng: { stress: 6, rep: -1, text: "機器翻譯把「indemnify」翻成了「賠罪」。你只好重頭來過，還是遲交了。" } },
        { label: "回報：這需要專業法務", time: 0, eff: { trust: { me: -4 }, rep: 1 }, text: "法務部接手了。周經理覺得你「很會推事情」。" }
      ] },
    { id: "q_wife", from: "zhou", t: "「幫我回我老婆的訊息，就說我在開會。」——你從他的螢幕倒影看見高爾夫球場。",
      opts: [
        { label: "照他說的回", time: 0, eff: { trust: { me: 8 }, stress: 4 }, text: "「在開會，晚點回。」你按下送出，覺得有點髒。" },
        { label: "回得滴水不漏，順便記下來", time: 1, check: { s: "guise", dc: 2 }, ok: { trust: { me: 8 }, flag: { zhouGolf: true }, text: "你連會議名稱都編好了。周經理拍拍你的肩：「懂事。」——你把時間地點記進了手機。" }, ng: { trust: { me: 2 }, text: "你編的會議室名稱根本不存在。周太太回了一個問號。周經理的臉黑了一半。" } },
        { label: "「這個我不方便。」", time: 0, eff: { trust: { me: -8 }, rep: 1 }, text: "周經理盯著你看了很久：「你很有原則嘛。」那不是稱讚。" }
      ] },
    { id: "q_minutes", from: "zhou", t: "「上個月的會議紀錄改一下，第三頁那句『這個方案我負責』不是我說的。」",
      opts: [
        { label: "照改", time: 1, eff: { trust: { me: 8 }, stress: 6, flag: { zhouForgery: true } }, text: "你改掉了一句話。原本的檔案，你偷偷留了一份。" },
        { label: "改成模稜兩可的寫法", time: 1, check: { s: "wit", dc: 3 }, ok: { trust: { me: 6 }, rep: 1, text: "「本方案由相關單位共同負責。」周經理看了三遍，滿意地點頭。" }, ng: { trust: { me: -4 }, text: "你改得太明顯，副總在下次會議上一眼就看出來了。周經理很難堪。" } },
        { label: "婉拒：紀錄已經歸檔", time: 0, eff: { trust: { me: -8 }, rep: 2 }, text: "你說歸檔的紀錄要走變更流程。周經理不再提了，但開始用別的方式刁難你。" }
      ] },
    { id: "q_logs", from: "han", t: "保全室來的內線：「新人，把你這兩週的出入紀錄自己整理一份交上來。每一筆都要寫原因。」",
      opts: [
        { label: "老實整理", time: 2, eff: { stress: 6, susp: -4 }, text: "你把每一次進出都寫得清清楚楚——除了那幾次，你寫的是「忘記帶東西」。" },
        { label: "整理得漂亮又無懈可擊", time: 1, check: { s: "guise", dc: 3 }, ok: { susp: -8, trust: { han: 3 }, text: "韓主任翻了兩頁就闔上：「行。」他第一次正眼看你。" }, ng: { susp: 8, text: "有一筆時間對不上。韓主任在旁邊畫了一個圈。" } },
        { label: "拖著不交", time: 0, eff: { susp: 8 }, text: "三天後，韓主任親自到你座位旁邊站了五分鐘。什麼都沒說。" }
      ] },
    { id: "q_dentist", from: "xia", t: "芷晴雙手合十：「拜託拜託～幫我代一下午的櫃台，我約了牙醫，真的不能再改了！」",
      opts: [
        { label: "交給我", time: 2, eff: { stress: 5, trust: { xia: 8 } }, text: "你在櫃台坐了一下午，接了四十通電話。芷晴回來塞給你一杯珍奶。" },
        { label: "找總務小陳輪流顧", time: 1, check: { s: "charm", dc: 2 }, ok: { trust: { xia: 6 }, text: "小陳很樂意，你們各顧一半。芷晴說你是天使。" }, ng: { trust: { xia: 2 }, stress: 3, text: "小陳臨時被叫走，你還是顧了整個下午。" } },
        { label: "「我今天真的走不開。」", time: 0, eff: { trust: { xia: -4 } }, text: "芷晴說沒關係，笑得有一點勉強。" }
      ] },
    { id: "q_sample", from: "sales", t: "業務部打來：「客戶要求明天早上九點前把樣品送到新竹，物流已經下班了，拜託！」",
      opts: [
        { label: "自己開車送", time: 3, eff: { stress: 10, rep: 4 }, text: "你凌晨一點出發。在交流道上看著日出，你想起自己其實不是來這裡當秘書的。" },
        { label: "協調夜間快遞", time: 1, check: { s: "wit", dc: 3 }, ok: { rep: 4, text: "你找到一家做醫療檢體的夜間快遞，樣品七點就到了。業務部送來一盒蛋糕。" }, ng: { rep: -1, stress: 4, text: "快遞送錯了廠區。業務部經理在群組裡標註了你。" } },
        { label: "婉拒：不是行政部的業務", time: 0, eff: { rep: -1 }, text: "業務部只好自己想辦法。你聽說他們罵了你很久。" }
      ] },
    { id: "q_coffee", from: "zhou", t: "「茶水間的咖啡豆換成我喜歡的那家。舊的那包——幫我帶回我家，反正沒人喝。」",
      opts: [
        { label: "照辦", time: 1, eff: { trust: { me: 5 }, stress: 3 }, text: "那包「沒人喝」的豆子是全新未拆的。" },
        { label: "換豆子，舊的留給大家", time: 1, check: { s: "charm", dc: 3 }, ok: { trust: { me: 4 }, rep: 2, text: "你在茶水間貼了一張「經理請客」。同事們很開心，周經理也只好跟著開心。" }, ng: { trust: { me: -3 }, text: "周經理看見那張紙條，臉色像吃了沒熟的豆子。" } },
        { label: "裝作沒聽懂後半句", time: 0, eff: { trust: { me: -2 } }, text: "你只換了豆子。周經理沒再提，但隔天自己把舊豆子拿走了。" }
      ] },
    { id: "q_training", from: "lin", t: "林處長：「下週新人訓，需要一位『學姊』分享五分鐘。你剛來，最有說服力。」",
      opts: [
        { label: "認真準備講稿", time: 2, eff: { stress: 6, trust: { lin: 6 }, rep: 2 }, text: "你講了自己「第一份工作」的故事——每一個細節都是編的，但新人們聽得很感動。" },
        { label: "即興發揮", time: 1, check: { s: "charm", dc: 3 }, ok: { trust: { lin: 8 }, rep: 3, text: "新人們笑了三次、哭了一次。林曼青在最後一排看著你，表情很複雜。" }, ng: { trust: { lin: 2 }, stress: 4, text: "你講到一半忘詞，只好讓大家提問。結果被問到你上一份工作的細節。" } },
        { label: "推薦芷晴去講", time: 0, eff: { trust: { lin: -2, xia: 3 } }, text: "芷晴講得很好。林曼青說：「下次換你。」" }
      ] },
    { id: "q_invoice", from: "finance", t: "財務部：「這張發票抬頭打錯了，去跟廠商要一張新的。但不要讓廠商知道是我們打錯的。」",
      opts: [
        { label: "硬著頭皮打電話", time: 1, eff: { stress: 6, rep: 1 }, text: "廠商小姐很客氣地說：「抬頭是你們給的喔。」你們互相客氣了十分鐘。" },
        { label: "說成系統更新的問題", time: 1, check: { s: "guise", dc: 2 }, ok: { rep: 2, text: "「我們 ERP 剛換版本，抬頭欄位跑掉了，真不好意思～」新發票隔天就到了。" }, ng: { rep: -1, text: "廠商說他們也用同一套 ERP，從來沒有這個問題。" } },
        { label: "請財務自己處理", time: 0, eff: { rep: -1 }, text: "財務部回你一張貼圖：一隻翻白眼的貓。" }
      ] },
    { id: "q_virus", from: "zhou", t: "周經理壓低聲音：「我電腦好像中毒了，一直跳出……那種網站。幫我處理，不要叫 IT。」",
      opts: [
        { label: "幫他清", time: 1, eff: { trust: { me: 8 }, stress: 4 }, text: "你清掉了十七個瀏覽器外掛。周經理說：「這件事，只有你知我知。」" },
        { label: "清掉，順便看看他的信箱", time: 1, check: { s: "tech", dc: 3 }, ok: { trust: { me: 8 }, intel: ["p_org"], text: "你清毒的同時把他的郵件索引掃了一遍。行政部經理知道的事，比他表現出來的多。" }, ng: { trust: { me: 4 }, susp: 6, text: "防毒軟體跳出一個你沒預期的警告視窗，周經理瞄了一眼：「你在幹嘛？」" } },
        { label: "「我只能幫你報 IT。」", time: 0, eff: { trust: { me: -8 } }, text: "周經理說不用了。隔天他的電腦換了一台新的。" }
      ] },
    { id: "q_chairs", from: "general", t: "總務：「三十張會議椅要在今天搬到十二樓，搬家公司明天才來，你們行政部支援一下。」",
      opts: [
        { label: "自己搬", time: 2, eff: { stress: 8, rep: 2 }, text: "你搬了十五張。腰痠了三天。" },
        { label: "用推車一次運完", time: 1, check: { s: "body", dc: 2 }, ok: { rep: 3, text: "你把椅子疊成兩落，用貨梯兩趟就運完了。總務阿姨說你是女中豪傑。" }, ng: { stress: 6, text: "推車在電梯口翻了，十張椅子散了一地。" } },
        { label: "「我手上還有急件。」", time: 0, eff: { rep: -1 }, text: "總務在週會上說行政部「很難配合」。" }
      ] },
    { id: "q_cake", from: "zhou", t: "「董事長夫人生日，要訂她『小時候吃過的那種』蛋糕。我也不知道是哪種，你查一下。」",
      opts: [
        { label: "訂一個最貴的", time: 1, eff: { stress: 3, trust: { me: 2 } }, text: "董事長夫人禮貌地吃了一口。" },
        { label: "查她的老家與年代", time: 2, check: { s: "wit", dc: 3 }, ok: { trust: { me: 8 }, rep: 3, text: "你找到她老家巷口一間五十年的麵包店，做的是奶油花蛋糕。董事長夫人當場紅了眼眶。" }, ng: { stress: 5, trust: { me: -2 }, text: "你查到的那間店十年前就收了。" } },
        { label: "建議改送花", time: 0, eff: { trust: { me: -3 } }, text: "周經理說：「花？你以為人家缺花？」" }
      ] },
    { id: "q_meeting", from: "zhou", t: "「下午三點的會改到兩點，通知所有人——但不要讓副總知道是我改的。」",
      opts: [
        { label: "群發通知", time: 0, eff: { trust: { me: 3 }, stress: 3 }, text: "副總回信：「誰改的？」你裝作沒看到。" },
        { label: "用會議室衝堂當理由", time: 1, check: { s: "guise", dc: 3 }, ok: { trust: { me: 6 }, rep: 1, text: "「因三點會議室設備維修，提前至兩點。」副總還回信謝謝你的貼心。" }, ng: { trust: { me: -3 }, susp: 3, text: "副總去看了三點的會議室，裡面什麼維修都沒有。" } },
        { label: "「這個要經理自己說。」", time: 0, eff: { trust: { me: -6 } }, text: "會議照原時間開。周經理遲到了二十分鐘。" }
      ] },
    { id: "q_tempcard", from: "rd", t: "研發部：「實驗室有一張門禁卡壞了，幫我們借一張臨時卡，越快越好！」", ch: 2,
      opts: [
        { label: "走正式流程借卡", time: 2, eff: { rep: 2, stress: 3 }, text: "流程跑了兩個小時，研發部的人說你是他們見過最有耐心的秘書。" },
        { label: "借卡時記下發卡規則", time: 1, check: { s: "tech", dc: 3 }, ok: { rep: 2, flag: { cardRule: true }, text: "臨時卡的編碼規則很簡單：樓層＋日期＋流水號。你記住了。" }, ng: { susp: 6, text: "你盯著發卡機看太久，保全問你：「有什麼問題嗎？」" } },
        { label: "「請找保全室。」", time: 0, eff: { rep: -1 }, text: "研發部的人嘆了一口氣。" }
      ] },
    { id: "q_apology", from: "zhou", t: "「寫一封道歉信給客戶，但要寫得——像是客戶的錯。」",
      opts: [
        { label: "照寫", time: 1, eff: { trust: { me: 4 }, stress: 4, rep: -1 }, text: "客戶回信只有一行：「收到。」然後取消了下一季的訂單。" },
        { label: "寫成誰都沒錯的版本", time: 1, check: { s: "wit", dc: 3 }, ok: { trust: { me: 6 }, rep: 3, text: "你寫了一封「雙方都在成長」的信。客戶回信感謝 VN 的誠意，周經理很得意。" }, ng: { trust: { me: -2 }, text: "信寫得太繞了，客戶打電話來問：「所以到底是誰的錯？」" } },
        { label: "寫一封真正的道歉信", time: 1, eff: { trust: { me: -6 }, rep: 3 }, text: "客戶很感動，續約了。周經理覺得你自作主張。" }
      ] },
    { id: "q_press", from: "pr", t: "公關部：「記者在大廳堵人，問我們是不是要裁員。你下去擋一下，什麼都不要說。」", ch: 2,
      opts: [
        { label: "下去罰站", time: 1, eff: { stress: 8, rep: 1 }, text: "你被三支麥克風包圍了二十分鐘，一句話也沒說。晚上新聞拍到了你的側臉。" },
        { label: "笑著把他們帶去會議室", time: 1, check: { s: "charm", dc: 3 }, ok: { rep: 4, text: "你請記者們喝咖啡、等公關主管下來。沒有任何畫面流出去。" }, ng: { rep: -1, susp: 5, text: "有個記者一直盯著你：「我們以前是不是在哪裡見過？」" } },
        { label: "「我不是發言人。」", time: 0, eff: { rep: -1 }, text: "公關部說行政部真是一點忙都幫不上。" }
      ] },
    { id: "q_shred", from: "zhou", t: "周經理丟來一箱文件：「拿去碎掉。不要看內容。」",
      opts: [
        { label: "照碎", time: 1, eff: { trust: { me: 6 }, stress: 2 }, text: "碎紙機吃掉了一整箱的秘密。你有一點可惜。" },
        { label: "邊碎邊瞄", time: 1, check: { s: "guise", dc: 3 }, ok: { trust: { me: 4 }, intel: ["p_zhou"], text: "你瞄到了幾張發票：飼料、鴿舍、賽鴿協會的會費——全部報在部門雜支。" }, ng: { trust: { me: -4 }, susp: 8, text: "周經理突然回頭：「我說不要看。」" } },
        { label: "「這需要保密單位處理吧？」", time: 0, eff: { trust: { me: -6 } }, text: "周經理把箱子拿回去，自己碎了一整個下午。" }
      ] },
    { id: "q_birthdays", from: "ceo", t: "執行長室轉來的請求：「執行長想要全體員工的生日名單，明天早上之前。」", ch: 3,
      opts: [
        { label: "從人資系統匯出", time: 1, eff: { rep: 2, stress: 3 }, text: "名單有四千兩百人。你順手看見了幾個研發部核心成員的住址。" },
        { label: "做成依部門分月的卡片清單", time: 2, check: { s: "tech", dc: 3 }, ok: { rep: 5, trust: { cheng: 3, ye: 3 }, text: "葉嵐收到時挑了一下眉：「執行長會喜歡。」" }, ng: { rep: 1, stress: 4, text: "排版跑掉了，你熬夜重做。" } },
        { label: "請人資處理", time: 0, eff: { rep: -1 }, text: "林曼青打電話來：「你知道這是執行長要的吧？」" }
      ] },
    { id: "q_karaoke", from: "zhou", t: "「今晚部門聚餐續攤 KTV，你負責炒熱氣氛。對了，副總愛聽鄧麗君。」",
      opts: [
        { label: "唱滿全場", time: 2, eff: { stress: 6, trust: { me: 6 }, rep: 2 }, text: "你唱了〈月亮代表我的心〉，副總跟著打拍子。周經理說你很上道。" },
        { label: "炒氣氛也套話", time: 2, check: { s: "charm", dc: 3 }, ok: { trust: { me: 6 }, rep: 2, susp: -3, text: "副總喝多了，抱怨研發部「一天到晚往 B 棟地下跑，不知道在搞什麼」。你默默記下。" }, ng: { stress: 4, text: "你問得太急，副總突然清醒：「你問這幹嘛？」" } },
        { label: "「我不太會唱歌。」", time: 0, eff: { trust: { me: -4 } }, text: "你坐在角落負責點歌。周經理覺得你很掃興。" }
      ] }
  ];
  // 請求者的名字（不在 NPCS 裡的部門）
  var REQUESTERS = { sales: "業務部", finance: "財務部", general: "總務", rd: "研發部", pr: "公關部", ceo: "執行長室" };

  // 潛入地圖：# 牆、. 地板、d 辦公桌（可躲藏）、S 起點兼出口、T 目標
  // guards 的 path 是一串路點，警衛沿直線一格一格來回走（走到底折返）
  var MAPS = {
    rd4f: {
      name: "研發大樓 4F",
      turns: 60,
      rows: [
        "#############",
        "#S...#....T.#",
        "#.##.#.##.#.#",
        "#.#d.......d#",
        "#.#.###.###.#",
        "#.....d.....#",
        "#.###.#.###.#",
        "#.d.#...#..T#",
        "#############"
      ],
      targets: { "11,1": "實驗資料伺服器", "11,7": "研發長的終端機" },
      guards: [
        { path: [[1, 5], [11, 5]] },
        { path: [[6, 1], [9, 1], [9, 3], [6, 3]] }
      ]
    },
    vault: {
      name: "B4 金庫走廊",
      turns: 52,
      rows: [
        "#############",
        "#S....#.....#",
        "#.###.#.###.#",
        "#.#d.....#d.#",
        "#.#.#.#.##..#",
        "#...#.#.....#",
        "###.#.#.###.#",
        "#d....#....T#",
        "#############"
      ],
      targets: { "11,7": "零號模型的保管庫" },
      guards: [
        { path: [[5, 1], [5, 7]] },
        { path: [[7, 3], [7, 5], [11, 5], [11, 1], [7, 1]] },
        { path: [[1, 7], [3, 7], [3, 5], [1, 5], [3, 5], [3, 7]] }
      ]
    }
  };

  // 場景背景（CSS class：sn-bg-<id>）
  var LOCS = {
    safehouse: "安全屋", lobby: "VN 大廳", office: "行政部辦公室", meeting: "會議室", pantry: "茶水間",
    stage: "發表會會場", restaurant: "日式料亭", banquet: "宴會廳", rd: "研發大樓", cleanroom: "無塵室",
    security: "警衛室", top: "執行長樓層", roof: "頂樓", street: "夜晚的街道", b4: "B4", car: "車內", gym: "拳擊館",
    market: "花市", cafe: "咖啡店", parking: "地下停車場"
  };

  window.PriTestSennyuData = {
    STATS: STATS, ARCHES: ARCHES, COVER_NAMES: COVER_NAMES, NPCS: NPCS, SUSPECTS: SUSPECTS,
    INTEL_CATS: INTEL_CATS, INTEL: INTEL, MOLE_TEXT: MOLE_TEXT, ENDINGS: ENDINGS, ENDING_ORDER: ENDING_ORDER, KIND_NAME: KIND_NAME,
    CHAPTERS: CHAPTERS, BONDS: BONDS, HANDLER: HANDLER, EVENTS: EVENTS, SNOOPS: SNOOPS,
    INBOX: INBOX, REQUESTERS: REQUESTERS, MAPS: MAPS, LOCS: LOCS,
    NPC_IMGS: ["g_072.webp", "g_073.webp", "g_075.webp"]
  };
})();
