// 少女藥師的獨語（yakushi）：序章「芋頭與名冊」（教學）。規則依據 docs/yakushi_game_design.md §9.0。
(function () {
  "use strict";
  var root = typeof window !== "undefined" ? window : globalThis;
  var L = function (who, text) { return { who: who, text: text }; };
  var DEF = {
    id: "case0", title: "序章　芋頭與名冊", hours: 8, startPlace: "dorm",
    cast: ["maomao", "xiaoman", "qin", "xuanshi"], startCards: [],
    places: [
      { id: "dorm", name: "下女宿舍", spots: [
        { id: "d_sick", kind: "look", label: "看看病倒的同寢", gives: ["sym_numb"],
          text: "阿桃抱著喉嚨，說話含糊。嘴唇和舌頭都在發麻……吃了什麼刺激的東西？" },
        { id: "d_xiaoman", kind: "talk", label: "問小滿", gives: ["tes_xiaoman"],
          text: "「今晚只有芋頭燉菜是新的菜色啦。我嫌黏沒吃，結果就我沒事。」" },
        { id: "d_roommate", kind: "talk", label: "問阿桃", requires: ["tes_roommate"], gives: [],
          text: "阿桃已經能說話了，一直向妳道謝。" }
      ] },
      { id: "kitchen", name: "宮人廚房", spots: [
        { id: "k_pot", kind: "look", label: "查看剩下的燉菜", gives: ["ev_tuber"],
          text: "鍋底還剩幾塊「芋頭」。比平常的芋頭小、也圓了一點。" },
        { id: "k_ledger", kind: "look", label: "翻廚房帳本", gives: ["ev_ledger"],
          text: "這週的芋頭進價只有平常的一半，經手人是採買的小宦官。" },
        { id: "k_eunuch", kind: "talk", label: "問採買的小宦官", requires: ["ev_ledger"], gives: ["p_eunuch", "tes_eunuch"],
          text: "「芋、芋頭就是芋頭！我……我是在城外的野地挖的，省下來的錢……」" }
      ] }
    ],
    cards: {
      sym_numb: { kind: "symptom", name: "口舌發麻、喉嚨腫痛", text: "吃下燉菜後不久，多人口舌發麻、喉嚨腫痛。",
        tags: ["口舌發麻", "喉嚨腫痛", "onset:fast"], of: "ev_tuber" },
      tes_xiaoman: { kind: "testimony", name: "小滿的證言", text: "今晚新菜色只有芋頭燉菜，沒吃的小滿沒事。" },
      ev_tuber: { kind: "evidence", name: "剩下的「芋頭」", text: "比一般芋頭小而圓的塊莖。", tags: ["塊莖"], herb: "banxia" },
      ev_ledger: { kind: "evidence", name: "廚房帳本", text: "這週芋頭進價只有平常一半。" },
      p_eunuch: { kind: "person", name: "採買的小宦官", text: "負責宮人廚房採買的小宦官。" },
      tes_eunuch: { kind: "testimony", name: "小宦官的證言", text: "「芋頭」是他在城外野地挖來的，混在芋頭裡交差。" },
      re_tuber_look: { kind: "reaction", name: "細看：小而圓的塊莖", text: "直徑不到一寸，頂端有凹陷的莖痕，不是芋頭。",
        tags: ["小型塊莖", "頂端凹陷莖痕"], of: "ev_tuber" },
      tes_roommate: { kind: "testimony", name: "阿桃的證言", text: "「那芋頭咬下去刺刺的，像有針在扎舌頭。」",
        tags: ["刺舌感"], of: "ev_tuber" }
    },
    tests: [
      { evidence: "ev_tuber", method: "look", text: "直徑不到一寸，頂端有凹陷的莖痕。這不是芋頭。", gives: "re_tuber_look" }
    ],
    patients: [
      { id: "pt_roommate", name: "同寢的阿桃", remedy: ["shengjiang", "gancao"], gives: "tes_roommate",
        text: "口舌腫脹、說不出話。先讓她把嘴裡的東西漱乾淨，再調點能緩和的東西。" }
    ],
    medicineBox: ["shengjiang", "gancao", "lvdou", "bohe", "dazao"],
    solution: { who: "p_eunuch", what: "herb:banxia", how: "tes_eunuch", why: "ev_ledger" },
    rebuttals: [
      { who: "p_eunuch", claim: "芋頭就是芋頭！宮外的野芋頭也是芋頭！", accepts: ["herb:banxia", "re_tuber_look"],
        reply: "「生、生半夏……？我、我真的不知道……」" },
      { who: "p_eunuch", claim: "帳上的錢我一文都沒有拿！", accepts: ["ev_ledger"],
        reply: "「……只有一點點，真的只有一點點……」" }
    ],
    deep: null,
    story: {
      intro: [L(null, "入宮第三晚。宿舍裡此起彼落的咳嗽聲，吵醒了卯卯。"),
              L("qin", "「有人下毒！誰都不准離開宿舍！」"),
              L("maomao", "（……下毒？不，這個症狀，比較像是吃錯東西。）")],
      truth: [L("maomao", "小宦官把在野地挖到的生半夏當成芋頭，混進採買裡，私吞了差價。"),
              L("maomao", "生半夏不經炮製就入口，會讓口舌發麻、喉嚨腫痛。宮裡的廚子沒見過，才會照芋頭煮。"),
              L("maomao", "這不是下毒，只是貪小便宜。……但貪小便宜，有時候比下毒還可怕。")],
      outro: [L("qin", "「……妳叫什麼名字？」"), L("maomao", "「卯卯。」"),
              L("xuanshi", "「原來如此。是個有意思的下女呢。」"),
              L("maomao", "（那個人是誰？笑得這麼好看的人，一定很麻煩。）")]
    },
    monologue: [L("maomao", "宮裡的人不認得生半夏。這座宮殿的藥庫裡，大概還有很多被當成別的東西的藥吧。")]
  };
  if (typeof module !== "undefined" && module.exports) module.exports = DEF;
  if (root.PriTestYakushiCore) root.PriTestYakushiCore.registerCase(DEF);
})();
