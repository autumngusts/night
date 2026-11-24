// 少女藥師的獨語（yakushi）：人物。規則依據 docs/yakushi_game_design.md §3。
(function () {
  "use strict";
  var root = typeof window !== "undefined" ? window : globalThis;
  var LIST = [
    { id: "maomao", name: "卯卯", role: "藥師養女・下女", desc: "在柳巷旁的農村長大，被老藥師杜衡收養。表面冷淡寡言、怕麻煩，一碰到藥和毒就兩眼發亮。",
      notes: [{ after: null, text: "……只要能碰到宮裡的藥庫，當下女也不算太虧。" },
              { after: "case1", text: "毒沒有錯，錯的是拿它的人。這句話，我大概要記很久。" }] },
    { id: "xuanshi", name: "玄氏", role: "掖庭令", desc: "管理後宮宮人的官員。俊美到不像真人，笑容溫和，卻看不透他在想什麼。",
      notes: [{ after: null, text: "笑得越好看的人越麻煩。這是花街教我的。" },
              { after: "case3", text: "那天他封存證物的手，比平常快了一點。" }] },
    { id: "handang", name: "韓當", role: "貼身禁衛", desc: "玄氏的護衛。寡言、正直、勞碌命，常負責收拾卯卯惹出的麻煩。少數會把卯卯的推理認真聽完的人。",
      notes: [{ after: null, text: "不多話，但會把我說的聽完。這種人很少見。" },
              { after: "case2", text: "我嚐毒的時候他臉色比我還白。下次還是別讓他看見。" }] },
    { id: "duheng", name: "杜衡", role: "養父・老藥師", desc: "住在柳巷邊的老藥師，溫和、跛腳。他曾經待過宮中，卯卯的藥學知識全部來自他。",
      notes: [{ after: null, text: "我會的東西，全是他教的。" },
              { after: "case3", text: "他從不提宮裡的事。我也從來沒問。" }] },
    { id: "gepo", name: "葛婆", role: "錦鯉樓老鴇", desc: "錦鯉樓的老鴇。吝嗇刁鑽、精明毒舌，會把麻煩事丟給卯卯，也會敲竹槓，但在緊要關頭護短。",
      notes: [{ after: null, text: "跟她說話要先數好錢袋。" },
              { after: "case2", text: "嘴上收我雙倍價，手卻把人護在身後。真是的。" }] },
    { id: "yuetang", name: "月棠", role: "錦鯉樓紅牌（琴）", desc: "錦鯉樓紅牌，擅琴。沉穩大姊，最懂人心。",
      notes: [{ after: null, text: "她看人的眼神，比我看藥材還準。" }] },
    { id: "xuejuan", name: "雪鵑", role: "錦鯉樓紅牌（詩）", desc: "錦鯉樓紅牌，擅詩。高傲毒舌，其實最心軟。",
      notes: [{ after: null, text: "嘴巴很毒的人，通常心裡最軟。" },
              { after: "case2", text: "她肯說出口，比任何證物都難得。" }] },
    { id: "feitong", name: "緋桐", role: "錦鯉樓紅牌（舞）", desc: "錦鯉樓紅牌，擅舞。開朗愛玩，消息靈通。",
      notes: [{ after: null, text: "花街裡的風聲，找她就對了。就是話太多。" }] },
    { id: "qin", name: "秦尚宮", role: "女官・下女上司", desc: "管下女的女官。嚴厲，但賞罰分明。",
      notes: [{ after: null, text: "很可怕，但從不亂罰人。這樣的上司，還算好伺候。" }] },
    { id: "xiaoman", name: "小滿", role: "同期下女", desc: "卯卯的同寢。愛聊八卦、消息通，是後宮情報來源。",
      notes: [{ after: null, text: "宮裡的消息，十件有九件從她嘴裡先傳出來。" }] },
    { id: "zhou", name: "周太醫", role: "太醫", desc: "膽小的庸醫，負責誤診與搞笑。並非壞人。",
      notes: [{ after: null, text: "診斷總是差一點點。但他不是壞人，這點我可以保證。" }] },
    { id: "liang", name: "梁昭儀", role: "後宮妃嬪", desc: "案 1 登場的妃嬪，依案件需要出場。",
      notes: [{ after: "case1", text: "身分高的人，煩惱也不會比較少。" }] }
  ];
  var byId = {};
  LIST.forEach(function (c) { byId[c.id] = c; });
  var api = { get: function (id) { return byId[id] || null; }, list: function () { return LIST.slice(); } };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.PriTestYakushiCast = api;
})();
