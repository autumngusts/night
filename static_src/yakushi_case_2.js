// 少女藥師的獨語（yakushi）：案 2「錦鯉樓的苦杏」（花街）。規則依據 docs/yakushi_game_design.md §9.2。
(function () {
  "use strict";
  var root = typeof window !== "undefined" ? window : globalThis;
  var L = function (who, text) { return { who: who, text: text }; };
  var DEF = {
    id: "case2", title: "案二　錦鯉樓的苦杏", hours: 12, startPlace: "banquet",
    cast: ["maomao", "handang", "gepo", "xuejuan", "yuetang", "feitong", "duheng"], startCards: [],
    places: [
      { id: "banquet", name: "錦鯉樓・宴廳", spots: [
        { id: "ba_seat", kind: "look", label: "查看葉老爺倒下的席位", gives: ["sym_merchant"],
          text: "席上翻倒的酒杯，旁邊一碗杏仁茶。聽說老爺倒下前一直喊頭暈，喘不過氣。" },
        { id: "ba_tea", kind: "look", label: "查看剩下的杏仁茶", gives: ["ev_tea"],
          text: "雪鵑席上那碗杏仁茶還剩一半，碗底沉著磨碎的杏仁渣。" },
        { id: "ba_clerk", kind: "talk", label: "問鹽商的帳房", gives: ["p_clerk", "tes_clerk"],
          text: "「我整晚都在外間對帳，席上的酒菜一樣也沒碰過。……要我說，那茶可是雪鵑姑娘親手端的。」" },
        { id: "ba_officer", kind: "talk", label: "問官差", gives: ["p_xuejuan"],
          text: "「茶是那個雪鵑端的，老爺喝了就倒，還用查嗎？」" }
      ] },
      { id: "kitchen", name: "錦鯉樓・廚房", spots: [
        { id: "ki_bag", kind: "look", label: "查看廚房的杏仁袋", gives: ["ev_bag"],
          text: "袋上寫著「甜杏仁」，廚子說杏仁茶都用這一袋。抓一顆聞，沒什麼氣味。" },
        { id: "ki_wine", kind: "look", label: "查看收回來的酒壺", gives: ["ev_wine"],
          text: "宴後收回廚房的酒壺，壺底沉著一層搗碎的果仁渣。酒裡為什麼會有果仁？" },
        { id: "ki_cook", kind: "talk", label: "問廚子", gives: ["tes_cook"],
          text: "「那壺酒不是樓裡的，是客人那邊自己帶來的。小蓮那丫頭偷喝了一口剩的，現在還躺著呢。」" }
      ] },
      { id: "xroom", name: "雪鵑的房間", spots: [
        { id: "xr_xuejuan", kind: "talk", label: "問雪鵑", gives: ["tes_xuejuan"],
          text: "「……那人說過，要替我贖身。我沒答應。」雪鵑別過臉。「我以為，我還有時間回答他。」" },
        { id: "xr_box", kind: "look", label: "打開雪鵑的妝匣", requires: ["tes_xuejuan"], gives: ["ev_debt"],
          text: "雪鵑默默把妝匣推過來。最底層壓著一張摺起的字據，不是她的東西。" }
      ] },
      { id: "shop", name: "杜衡的藥鋪", spots: [
        { id: "sh_duheng", kind: "talk", label: "問杜衡", gives: ["tes_duheng"],
          text: "「三天前有個指頭沾著墨的客人，買了一大包苦杏仁，說是要止咳。……止咳，用不了那麼多。」" },
        { id: "sh_book", kind: "look", label: "翻杜衡的藥書", gives: ["ev_book"],
          text: "藥書寫著：苦、甜杏仁外形相同，苦者有毒，搗碎加水有異味。書背角落有個褪了色的印記，不像民間的東西。" }
      ] }
    ],
    cards: {
      sym_merchant: { kind: "symptom", name: "葉老爺的症狀", text: "宴席中途頭暈、喘不過氣，很快倒下。" },
      ev_tea: { kind: "evidence", name: "剩下的杏仁茶", text: "雪鵑席上的杏仁茶，碗底沉著磨碎的杏仁渣。",
        tags: ["杏仁核仁"], herb: "tianxingren" },
      re_tea_taste: { kind: "reaction", name: "嚐：杏仁茶", text: "微甜，帶一點油香。沒有苦味。",
        tags: ["微甜"], of: "ev_tea" },
      ev_wine: { kind: "evidence", name: "收回來的酒壺", text: "宴後收回廚房的酒壺，壺底沉著搗碎的果仁渣。",
        tags: ["杏仁核仁"], herb: "kuxingren" },
      re_wine_smell: { kind: "reaction", name: "嗅：酒壺裡的渣", text: "把壺底的渣加水搗開，散出一股明顯的苦杏仁氣味。",
        tags: ["苦杏仁味"], of: "ev_wine" },
      re_wine_taste: { kind: "reaction", name: "嚐：酒壺裡的渣", text: "極苦，苦得舌根發緊，久久不散。",
        tags: ["極苦"], of: "ev_wine" },
      ev_bag: { kind: "evidence", name: "廚房的杏仁袋", text: "寫著「甜杏仁」的布袋，杏仁茶都用這一袋。" },
      p_clerk: { kind: "person", name: "鹽商的帳房孫遠", text: "跟了葉老爺二十年的帳房，指頭上總沾著墨。" },
      p_xuejuan: { kind: "person", name: "雪鵑", text: "錦鯉樓紅牌。官差認定是她端的杏仁茶害死了葉老爺。" },
      tes_clerk: { kind: "testimony", name: "帳房的證言", text: "「我整晚都在外間對帳，席上的酒菜一樣也沒碰過。」" },
      tes_cook: { kind: "testimony", name: "廚子的證言", text: "那壺酒不是樓裡的，是客人那邊帶來的。小蓮偷喝了剩酒，病倒了。" },
      tes_xuejuan: { kind: "testimony", name: "雪鵑的話", text: "「那人說過要替我贖身。我沒答應……我以為我還有時間回答他。」" },
      ev_debt: { kind: "evidence", name: "挪用公款的字據", text: "帳房孫遠親筆畫押，承認挪用葉家鹽號的公款。葉老爺交給雪鵑保管。" },
      tes_duheng: { kind: "testimony", name: "杜衡的證言", text: "三天前，一個指頭沾墨的客人買了一大包苦杏仁，說是要止咳。" },
      ev_book: { kind: "evidence", name: "杜衡的藥書", text: "寫著苦、甜杏仁的分辨法。書背角落有個褪色的印記。" },
      tes_maid: { kind: "testimony", name: "小蓮的證言", text: "「酒是帳房孫先生交給我的，說是老爺愛喝的家鄉酒，要我送進宴席。」" }
    },
    tests: [
      { evidence: "ev_tea", method: "taste", text: "卯卯舀了一小口。微甜，帶一點油香。……這碗茶，是清白的。", gives: "re_tea_taste" },
      { evidence: "ev_tea", method: "smell", text: "只有淡淡的奶香和杏仁香，沒有什麼刺鼻的味道。" },
      { evidence: "ev_wine", method: "smell", text: "把壺底的渣加水搗開——一股明顯的苦杏仁氣味衝上來。", gives: "re_wine_smell" },
      { evidence: "ev_wine", method: "taste", text: "卯卯用指尖沾了一點壺底的渣送進嘴裡。極苦，苦得舌根發緊。「……妳！」韓當一把抓住她的手腕，臉色比她還白。", gives: "re_wine_taste" },
      { evidence: "ev_wine", method: "animal", text: "餵了一點給廚房捉來的老鼠，沒過多久，牠就喘得厲害。" }
    ],
    patients: [
      { id: "pt_lian", name: "試喝剩酒的小蓮", remedy: ["jinyinhua", "gancao"], gives: "tes_maid",
        text: "小丫頭頭暈想吐，呼吸有點急。先讓她到通風的地方躺好，再調點能緩和的東西。" }
    ],
    medicineBox: ["jinyinhua", "gancao", "lvdou", "bohe", "juhua", "rougui"],
    solution: { who: "p_clerk", what: "herb:kuxingren", how: "tes_maid", why: "ev_debt" },
    rebuttals: [
      { who: "p_clerk", claim: "杏仁茶裡就有杏仁！毒是從茶裡來的，茶可是雪鵑端的！", accepts: ["herb:tianxingren", "re_tea_taste"],
        reply: "「甜、甜的……？那、那又怎樣！」" },
      { who: "p_clerk", claim: "那壺酒？我連碰都沒碰過！", accepts: ["tes_maid"],
        reply: "「那丫頭……那丫頭不是喝了酒嗎！怎麼還能說話！」" },
      { who: "p_clerk", claim: "我跟了老爺二十年，情同父子，怎麼會害他！", accepts: ["ev_debt"],
        reply: "「……老爺說要查帳。查了，我就完了。我只是……只是想要時間把錢補回去。」" }
    ],
    deep: null,
    story: {
      intro: [L(null, "卯卯藉口回家探視養父，難得出了宮。韓當奉命隨行。"),
              L(null, "還沒走到藥鋪，錦鯉樓的小廝就跑來拉人：昨夜宴席上，鹽商葉老爺倒地斷了氣。"),
              L("gepo", "「官差說是雪鵑端的杏仁茶有毒，要拿人封樓！妳給我查清楚——診金？先欠著。」"),
              L(null, "官差伸手要拉雪鵑，葛婆一步跨過去，把人擋在身後。"),
              L("gepo", "「要帶人，先把老娘這把骨頭拆了。……卯卯，查得出來，診金給妳三成。不，兩成。」"),
              L("maomao", "「五成。」"),
              L("gepo", "「搶錢啊妳！」嘴上這麼罵，她的手卻一直沒離開雪鵑的肩膀。"),
              L("handang", "「我跟著。別亂嚐東西。」"),
              L("maomao", "（……這種話，跟我說是沒用的。）")],
      truth: [L("maomao", "犯人是葉老爺的帳房孫遠。他挪用了鹽號的公款，畫了押的字據落到了老爺手上。"),
              L("maomao", "老爺打算宴後查帳。三天前，帳房到養父的藥鋪買了一大包苦杏仁，說是要止咳。"),
              L("maomao", "他把苦杏仁搗碎泡進酒裡，交給廚房的小蓮，說是「老爺愛喝的家鄉酒」，讓她送進宴席。"),
              L("maomao", "老爺喝了酒，很快頭暈、喘不過氣，倒在雪鵑的席前。官差看見桌上的杏仁茶，就認定毒在茶裡。"),
              L("maomao", "可是茶用的是廚房那袋甜杏仁，嚐起來是甜的。真正有苦杏仁味的，是收回廚房的那壺酒。"),
              L("maomao", "小蓮偷喝了剩酒，也頭暈想吐——她是證人，也差一點成了第二個死者。"),
              L("maomao", "字據一直在雪鵑的妝匣裡。老爺說過，放在她那裡，比放在自己身上安全。")],
      outro: [L("feitong", "「卯卯！下次回來教我認藥嘛，我也想知道哪顆是苦的！」"),
              L("yuetang", "「別學她亂嚐。……卯卯，謝謝妳。雪鵑那孩子，是不會說這兩個字的。」"),
              L("xuejuan", "「……多管閒事。」她把一包杏仁糖塞進卯卯手裡，轉身就走。"),
              L("gepo", "「診金照算，杏仁糖的錢也要扣——欸，別瞪我。樓還開著，算妳一份功勞。」"),
              L("duheng", "「卯卯，宮裡……」"),
              L("duheng", "「……不，沒什麼。早點回去，別讓人等。」"),
              L("maomao", "（養父有話沒說完。……我也沒有問。）")]
    },
    monologue: [L("maomao", "苦杏仁和甜杏仁，外表一模一樣。人也是。"),
                L("maomao", "……不過嚐過一次的味道，我不會忘。")]
  };
  if (typeof module !== "undefined" && module.exports) module.exports = DEF;
  if (root.PriTestYakushiCore) root.PriTestYakushiCore.registerCase(DEF);
})();
