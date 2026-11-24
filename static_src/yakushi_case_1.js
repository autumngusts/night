// 少女藥師的獨語（yakushi）：案 1「沉香夜話」（後宮）。規則依據 docs/yakushi_game_design.md §9.1。
(function () {
  "use strict";
  var root = typeof window !== "undefined" ? window : globalThis;
  var L = function (who, text) { return { who: who, text: text }; };
  var DEF = {
    id: "case1", title: "案一　沉香夜話", hours: 12, startPlace: "palace",
    cast: ["maomao", "xuanshi", "handang", "liang", "zhou", "xiaoman"], startCards: [],
    places: [
      { id: "palace", name: "梁昭儀的寢殿", spots: [
        { id: "pa_liang", kind: "look", label: "察看昭儀的病況", gives: ["sym_liang"],
          text: "昭儀的瞳孔散得很大，嘴唇乾裂，說話時眼神一直飄向牆角。夜裡發作得最厲害。" },
        { id: "pa_censer", kind: "look", label: "查看寢殿的香爐", gives: ["ev_ash"],
          text: "香爐裡的灰還沒清。撥開來看，灰裡夾著沒燒盡的花瓣碎屑和細小的顆粒。" },
        { id: "pa_cuilv", kind: "talk", label: "問點香的侍女", gives: ["p_cuilv", "ev_incense", "p_maid"],
          text: "「這是素荷姊姊送來的家鄉沉香，說能安眠。娘娘喜歡，我每晚睡前都點一爐。」" },
        { id: "pa_box", kind: "look", label: "查看裝香的木盒", requires: ["ev_incense"], gives: ["ev_wrapper"],
          text: "盒底墊著一張摺好的包香紙，角落印著一個小小的店號。宮裡的香，不會用外頭的紙包。" }
      ] },
      { id: "store", name: "香料庫", spots: [
        { id: "st_ledger", kind: "look", label: "翻香料庫的入庫帳", gives: ["ev_ledger"],
          text: "這半年發給昭儀宮的香，帳上只有檀香和蘇合香。沒有任何一筆沉香。" },
        { id: "st_shop", kind: "talk", label: "問來送貨的香料鋪掌櫃", requires: ["ev_wrapper"], gives: ["tes_shopkeeper"],
          text: "掌櫃看了包香紙一眼，笑容僵了一下：「本鋪的紙……小店只替幾位娘娘的宮裡供香，別的，小的不記得了。」" }
      ] },
      { id: "physic", name: "太醫署", spots: [
        { id: "ph_zhou", kind: "talk", label: "問周太醫", gives: ["tes_zhou"],
          text: "「心、心神失養！是心神失養！下官開了安神湯……喝了是、是更糟了沒錯……」" },
        { id: "ph_record", kind: "look", label: "翻昭儀的脈案", gives: ["ev_record"],
          text: "脈案上記著：白日尚可，每到亥時之後心悸、口乾，夜半見幻影。病是跟著夜晚來的。" }
      ] },
      { id: "quarters", name: "宮女住處", spots: [
        { id: "qu_xiaoman", kind: "talk", label: "問小滿", gives: ["tes_lover"],
          text: "「素荷姊姊？她有個同鄉的侍衛相好啦。三個月前那人被調去邊關，聽說是昭儀親口下的令。」" },
        { id: "qu_suhe", kind: "talk", label: "問同鄉女官素荷", requires: ["p_maid"], gives: ["tes_suhe"],
          text: "「那是我家鄉最好的香。娘娘待我如姊妹，我只是想讓她睡得安穩些。」她的指尖，一直在捻袖口。" },
        { id: "qu_room", kind: "look", label: "看素荷的房間", requires: ["p_maid"], gives: ["ev_fake_incense", "ev_notes"],
          text: "枕下壓著一封寫給翠縷的短箋，還有一本翻得起毛的醫書筆記，其中一頁折了角。" }
      ] }
    ],
    cards: {
      sym_liang: { kind: "symptom", name: "昭儀的症狀", text: "瞳孔散大、口乾、心悸、夜裡看見幻影；入夜後發作，白日稍緩。",
        tags: ["瞳孔放大", "口乾", "譫妄", "onset:mid"], of: "ev_ash" },
      ev_ash: { kind: "evidence", name: "香爐的灰燼", text: "寢殿香爐裡的灰，夾著沒燒盡的花瓣碎屑與細小顆粒。",
        tags: ["茄科草本"], herb: "mantuoluo" },
      re_seed: { kind: "reaction", name: "細看：灰裡的種子", text: "灰裡的顆粒是扁扁的腎形種子，還有喇叭形白花的碎瓣。",
        tags: ["扁腎形種子"], of: "ev_ash" },
      ev_incense: { kind: "evidence", name: "素荷送的「沉香」", text: "裝在木盒裡的香木塊，說是素荷家鄉的上好沉香。",
        tags: ["香木塊"], herb: "tanxiang" },
      re_float: { kind: "reaction", name: "溶水：浮起來的「沉香」", text: "香木塊丟進水盆，浮在水面上。真正的沉香會沉到底。",
        tags: ["入水浮起"], of: "ev_incense" },
      p_maid: { kind: "person", name: "同鄉女官素荷", text: "與梁昭儀同鄉的女官，昭儀入宮時一起帶進來的人。" },
      p_cuilv: { kind: "person", name: "點香的侍女翠縷", text: "昭儀寢殿的侍女，每晚負責點香。" },
      ev_fake_incense: { kind: "evidence", name: "給翠縷的短箋", text: "素荷的筆跡：「家鄉好香，每晚睡前點一爐，娘娘必能安睡。切莫斷了。」" },
      tes_lover: { kind: "testimony", name: "小滿的證言", text: "素荷同鄉的侍衛相好，三個月前被調去邊關，據說是昭儀下的令。" },
      tes_suhe: { kind: "testimony", name: "素荷的證言", text: "「娘娘待我如姊妹，我只是想讓她睡得安穩。」" },
      ev_ledger: { kind: "evidence", name: "香料庫的入庫帳", text: "半年來發給昭儀宮的香裡，沒有任何一筆沉香。" },
      tes_zhou: { kind: "testimony", name: "周太醫的診斷", text: "「心神失養」。開了安神湯，症狀反而更重。" },
      ev_record: { kind: "evidence", name: "昭儀的脈案", text: "每到亥時之後心悸、口乾，夜半見幻影；白日尚可。" },
      ev_wrapper: { kind: "evidence", name: "包香紙", text: "印著香料鋪店號的包香紙。這家鋪子只替幾位位分更高的娘娘供香。" },
      ev_notes: { kind: "evidence", name: "素荷的醫書筆記", text: "翻得起毛的筆記，折角的那一頁寫著「醉心花，入香令人安臥」，字跡是素荷的。" },
      tes_shopkeeper: { kind: "testimony", name: "香料鋪掌櫃的話", text: "認得自家的包香紙，卻說不記得賣給了誰，只說小店替幾位娘娘的宮裡供香。" },
      tes_liang: { kind: "testimony", name: "梁昭儀的證言", text: "「那個侍衛……是我調走的。宮女與侍衛私通是死罪，被人發現前，我只能先送他走。」" }
    },
    tests: [
      { evidence: "ev_incense", method: "water", text: "香木塊丟進水盆——浮在水面上，輕飄飄地轉了半圈。沉香，是會沉的。", gives: "re_float" },
      { evidence: "ev_incense", method: "smell", text: "香氣甜潤，持久不散。好聞是好聞，可沉香點燃時那種層層變化的香氣，一點也沒有。" },
      { evidence: "ev_ash", method: "look", text: "撥開灰燼細看：扁扁的腎形種子，還有喇叭形白花的碎瓣。不是昭儀院子裡的花。", gives: "re_seed" },
      { evidence: "ev_ash", method: "smell", text: "灰裡有一股焦苦味，被甜甜的香氣蓋住了。單聞香，是聞不出來的。" }
    ],
    patients: [
      { id: "pt_liang", name: "梁昭儀", remedy: ["gancao", "lvdou", "suanzaoren"], gives: "tes_liang",
        text: "先把香撤掉、開窗通風，讓昭儀在安靜的地方躺好，再調點能讓她平靜下來的東西。" }
    ],
    medicineBox: ["gancao", "lvdou", "suanzaoren", "bohe", "rougui", "dazao"],
    solution: { who: "p_maid", what: "herb:mantuoluo", how: "ev_fake_incense", why: "tes_lover" },
    rebuttals: [
      { who: "p_maid", claim: "那是上好的沉香，是我家鄉最好的香！", accepts: ["herb:tanxiang", "re_float"],
        reply: "「……浮、浮起來了？不可能，那明明是……」" },
      { who: "p_maid", claim: "香灰裡的花粉？那是娘娘院子裡自己種的花！", accepts: ["herb:mantuoluo", "re_seed"],
        reply: "「……」素荷咬住了嘴唇，再也沒說話。" },
      { who: "p_maid", claim: "我與娘娘情同姊妹，怎麼可能害她？", accepts: ["tes_lover"],
        reply: "「姊妹……？那她為什麼要把他送走！他做錯了什麼！」" }
    ],
    deep: {
      label: "是誰教她混花粉的？",
      options: [
        { key: "consort", card: "ev_wrapper", monologue: [
          L("maomao", "包香紙上的店號，只替幾位位分更高的娘娘供香。"),
          L("maomao", "一個女官，要怎麼拿到那種地方的紙？……也可能只是哪位娘娘賞了舊紙。"),
          L("maomao", "我只是個下女。紙會說話，可惜它不會說名字。") ] },
        { key: "self", card: "ev_notes", monologue: [
          L("maomao", "折角的那一頁，是她自己的字。"),
          L("maomao", "也許她真的是一個人想到的。也許，有人只是剛好把那本書放到她手邊。"),
          L("maomao", "筆記不會說謊，但筆記也不會告訴我，是誰教她翻開那一頁。") ] },
        { key: "shop", card: "tes_shopkeeper", monologue: [
          L("maomao", "掌櫃的笑容，僵了那麼一下。"),
          L("maomao", "賣香的人最懂香。要在香裡混東西，找他們最方便——當然，也可能他只是怕惹上麻煩。"),
          L("maomao", "說不記得的人，通常記得很清楚。只是記得什麼，我不知道。") ] }
      ],
      none: [
        L("maomao", "素荷到最後都沒說，是誰教她把花粉混進香裡的。"),
        L("maomao", "……算了。我只是個下女，知道太多，晚上會睡不著。")
      ]
    },
    story: {
      intro: [L(null, "入宮滿一個月。卯卯被掖庭令玄氏叫了過去。"),
              L("xuanshi", "「梁昭儀連日失眠、心悸，夜裡還說看見人影。太醫署治了半個月，越治越糟。」"),
              L("xuanshi", "「妳替我去看看。不必聲張，就當是去幫忙打掃。」"),
              L("maomao", "（……打掃。這人把麻煩事說得像是去摘花。）"),
              L("handang", "「我在殿外候著。有事，喊一聲。」"),
              L("zhou", "「心、心神失養，這是下官的診斷……小丫頭可別亂碰藥爐啊！」"),
              L("maomao", "（失眠、心悸、看見幻影。……夜裡才發作的病，通常不是心神的問題。）")],
      truth: [L("maomao", "犯人是昭儀的同鄉女官素荷。她送來的「家鄉沉香」，其實是檀香——丟進水裡就浮起來了。"),
              L("maomao", "檀香本身沒有毒。有毒的，是她混進香裡的曼陀羅花粉和種子。灰裡的腎形種子就是證據。"),
              L("maomao", "她寫短箋給翠縷，叮囑每晚睡前點一爐。所以昭儀白日還好，一入夜就心悸、口乾、瞳孔散大，看見幻影。"),
              L("maomao", "香料庫的帳上沒有這批沉香，脈案上發作的時辰也對得上——病是跟著香爐的煙來的。"),
              L("maomao", "周太醫的安神湯治不好，是因為每晚還在點同一爐香。藥是灌進去了，毒也一起吸進去了。"),
              L("maomao", "她恨昭儀，是因為心上人被調去了邊關。可昭儀調走那個侍衛，是怕兩人私通的事被人發現——那是死罪。"),
              L("maomao", "她到最後都沒說，是誰教她把花粉混進香裡的。")],
      outro: [L("liang", "「……我以為我在護著她。原來我只是讓她恨我。」"),
              L("maomao", "「曼陀羅本身沒有錯。古時候也有人用它來止痛。」"),
              L("maomao", "「毒沒有錯，錯的是拿它的人。」"),
              L("xuanshi", "「妳說話總是這樣，不給人留情面。」"),
              L("handang", "「……但她說得沒錯。」"),
              L("maomao", "（那張包香紙，玄氏收走的時候，什麼也沒問。）")]
    },
    monologue: [L("maomao", "宮裡的香，越貴越好聞，也越適合藏東西。"),
                L("maomao", "下次聞到太甜的香，我大概會先把它丟進水裡。")]
  };
  if (typeof module !== "undefined" && module.exports) module.exports = DEF;
  if (root.PriTestYakushiCore) root.PriTestYakushiCore.registerCase(DEF);
})();
