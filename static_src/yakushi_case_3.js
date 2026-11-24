// 少女藥師的獨語（yakushi）：案 3「端午的黃酒」（宮廷外）。規則依據 docs/yakushi_game_design.md §9.3。
(function () {
  "use strict";
  var root = typeof window !== "undefined" ? window : globalThis;
  var L = function (who, text) { return { who: who, text: text }; };
  var DEF = {
    id: "case3", title: "案三　端午的黃酒", hours: 12, startPlace: "market",
    cast: ["maomao", "xuanshi", "handang", "zhou"], startCards: [],
    places: [
      { id: "market", name: "鳳京北市", spots: [
        { id: "mk_zhou", kind: "talk", label: "問周太醫", gives: ["tes_zhou"],
          text: "「疫、疫病！吐的吐、痛的痛，一整條街都是，不是疫病是什麼！得快封街！」" },
        { id: "mk_stall", kind: "look", label: "看街口的酒攤", gives: ["ev_sign"],
          text: "酒攤掛著「御用雄黃酒・溫熱現賣」的布招，價錢比別家便宜一半。端午前後，排隊的人沒斷過。" },
        { id: "mk_xuanshi", kind: "talk", label: "向玄氏回報封印的事", requires: ["ev_seal"], gives: ["tes_xuanshi"],
          text: "玄氏看著封印的拓樣，笑容一點也沒變：「查到酒坊為止。妳查到的，已經夠了。」" }
      ] },
      { id: "slum", name: "貧民區", spots: [
        { id: "sl_patients", kind: "look", label: "察看病倒的人", gives: ["sym_slum"],
          text: "嘔吐、腹痛，靠近了能聞到嘴裡一股蒜味。病倒的都是大人，沒喝酒的孩子大多沒事。" },
        { id: "sl_cup", kind: "look", label: "查看病人家裡剩的酒", gives: ["ev_wine_dregs"],
          text: "灶邊一碗喝剩的雄黃酒，已經涼了。碗底沉著一層紅色的礦粉碎屑。" }
      ] },
      { id: "brewery", name: "福泉酒坊", spots: [
        { id: "br_brewer", kind: "talk", label: "問酒坊老闆", gives: ["p_brewer"],
          text: "「本坊是御用酒坊！端午的雄黃酒，溫熱了才香，城裡誰不愛喝？」老闆的笑，掛得太用力了。" },
        { id: "br_jars", kind: "look", label: "查看酒罈的封印", gives: ["ev_seal"],
          text: "封泥上壓著御用的印。紋路清楚、朱色沉穩——不像仿的。" },
        { id: "br_sack", kind: "look", label: "查看庫房的白色粉末", gives: ["ev_powder"],
          text: "庫房角落有一袋白色粉末。跟來的周太醫一看就叫了起來：「砒、砒霜！」" },
        { id: "br_ledger", kind: "look", label: "翻酒坊的帳", requires: ["p_brewer"], gives: ["ev_seal_cost"],
          text: "帳上雄黃的進價低得離譜，賣價卻標著「御用」。省下來的錢，一筆一筆記得清清楚楚。" },
        { id: "br_handang", kind: "talk", label: "問韓當", requires: ["ev_seal"], gives: ["tes_handang"],
          text: "韓當盯著封印看了很久。「……這種印，不是外頭能刻的。」他沒有再說下去。" }
      ] },
      { id: "pharmacy", name: "北市藥鋪", spots: [
        { id: "ph_keeper", kind: "talk", label: "問藥鋪掌櫃", gives: ["p_keeper", "tes_keeper"],
          text: "「雄黃？酒坊來買過，挑最便宜、成色最差的那種。我還提醒過，那種貨溫了喝不得……」" },
        { id: "ph_sample", kind: "look", label: "比對藥櫃裡的雄黃", gives: ["ev_sample"],
          text: "上等的雄黃是透亮的橙紅色塊；掌櫃說酒坊買走的，是混著雜石、顏色發暗的碎渣。" }
      ] }
    ],
    cards: {
      sym_slum: { kind: "symptom", name: "貧民區病人的症狀", text: "嘔吐、腹痛，嘴裡有股蒜味；喝過酒數時辰後發作，沒喝酒的孩子大多沒事。",
        tags: ["嘔吐", "腹痛", "onset:mid"], of: "ev_wine_dregs" },
      ev_wine_dregs: { kind: "evidence", name: "喝剩的雄黃酒", text: "病人家裡喝剩的「御用雄黃酒」，碗底沉著紅色的礦粉碎屑。",
        tags: ["紅色系礦物"], herb: "xionghuang" },
      re_heat: { kind: "reaction", name: "加熱：冒白煙的酒渣", text: "酒渣一加熱就冒出白煙，散出蒜一樣的臭味。溫熱的酒，讓劣質雄黃更毒。",
        tags: ["加熱有蒜臭"], of: "ev_wine_dregs" },
      ev_powder: { kind: "evidence", name: "庫房的白色粉末", text: "酒坊庫房角落的一袋白色粉末。周太醫說是砒霜。",
        tags: ["白色粉末"], herb: "mingfan" },
      re_powder_look: { kind: "reaction", name: "細看：白色粉末", text: "粉裡夾著沒磨細的透明結晶塊。",
        tags: ["透明結晶塊"], of: "ev_powder" },
      re_powder_taste: { kind: "reaction", name: "嚐：白色粉末", text: "又酸又澀，舌頭一縮。",
        tags: ["酸澀"], of: "ev_powder" },
      p_brewer: { kind: "person", name: "福泉酒坊的馮老闆", text: "自稱御用酒坊的老闆，端午前後賣溫熱的雄黃酒。" },
      p_keeper: { kind: "person", name: "北市藥鋪的掌櫃", text: "把劣質雄黃賣給酒坊的藥鋪掌櫃。" },
      tes_zhou: { kind: "testimony", name: "周太醫的診斷", text: "「疫病！得快封街！」" },
      ev_sign: { kind: "evidence", name: "酒攤的布招", text: "「御用雄黃酒・溫熱現賣」，價錢比別家便宜一半。" },
      ev_seal: { kind: "evidence", name: "酒罈上的御用封印", text: "封泥上壓著御用的印，紋路清楚、朱色沉穩，不像仿的。" },
      ev_seal_cost: { kind: "evidence", name: "酒坊的進料帳", text: "劣質雄黃的低進價、掛「御用」名義的賣價，省下的錢一筆一筆記著。" },
      tes_handang: { kind: "testimony", name: "韓當的話", text: "「……這種印，不是外頭能刻的。」" },
      tes_xuanshi: { kind: "testimony", name: "玄氏的話", text: "「查到酒坊為止。妳查到的，已經夠了。」" },
      tes_keeper: { kind: "testimony", name: "藥鋪掌櫃的證言", text: "酒坊挑最便宜、成色最差的雄黃買。掌櫃提醒過那種貨溫了喝不得。" },
      ev_sample: { kind: "evidence", name: "藥鋪的雄黃樣品", text: "上等雄黃是透亮的橙紅色塊；酒坊買走的是混雜石、顏色發暗的碎渣。" },
      tes_patients: { kind: "testimony", name: "病人們的證言", text: "「這條街病倒的，都喝過街口酒攤溫熱的御用雄黃酒。孩子沒喝，就沒事。」" }
    },
    tests: [
      { evidence: "ev_wine_dregs", method: "heat", text: "把酒渣放上小火——冒出一縷白煙，散出蒜一樣的臭味。溫酒，就是在做這件事。", gives: "re_heat" },
      { evidence: "ev_wine_dregs", method: "water", text: "碎屑不溶於水，沉在碗底，橙紅偏黃。" },
      { evidence: "ev_powder", method: "silver", text: "銀針插進粉裡，拔出來還是亮的。周太醫鬆了口氣：「沒毒！」——銀針只認得一種毒，其他的，它什麼也說不出來。" },
      { evidence: "ev_powder", method: "look", text: "粉裡夾著沒磨細的透明結晶塊。砒霜，不會長這樣。", gives: "re_powder_look" },
      { evidence: "ev_powder", method: "taste", text: "又酸又澀，舌頭一縮。……是拿來讓混濁的酒變清的東西。", gives: "re_powder_taste" }
    ],
    patients: [
      { id: "pt_slum", name: "輕症的病人", remedy: ["lvdou", "gancao"], gives: "tes_patients",
        text: "一位腹痛的大嬸，症狀還輕。先別讓她再喝那酒，讓她躺下歇著，再調點能緩和的東西。" }
    ],
    medicineBox: ["lvdou", "gancao", "jinyinhua", "shengjiang", "bohe", "dazao"],
    solution: { who: "p_brewer", what: "herb:xionghuang", how: "re_heat", why: "ev_seal_cost" },
    rebuttals: [
      { who: "p_brewer", claim: "是疫病！太醫都說了，跟我的酒沒關係！", accepts: ["tes_patients", "herb:xionghuang"],
        reply: "「孩、孩子沒事又怎樣……那、那是巧合！」" },
      { who: "p_brewer", claim: "雄黃酒端午家家戶戶都喝，怎麼就我的有毒？", accepts: ["re_heat"],
        reply: "「溫、溫熱了才好賣啊……誰知道溫了會……」" },
      { who: "p_brewer", claim: "我是御用酒坊！封印就是證明！", accepts: ["ev_seal_cost"],
        reply: "「……那、那封印是真的！真的！我、我只是……」他看了一眼酒罈上的封印，忽然閉上了嘴。" }
    ],
    deep: {
      label: "真的御用封印從哪裡來？",
      options: [
        { key: "leak", card: "ev_seal", monologue: [
          L("maomao", "封印是真的。真的東西，總得有人從裡面拿出來。"),
          L("maomao", "是誰、為了什麼——也可能只是一批該銷毀的舊印，被人貪了。"),
          L("maomao", "宮牆很高，可是牆上，好像總有縫。") ] },
        { key: "protect_someone", card: "tes_handang", monologue: [
          L("maomao", "韓當說到一半就停了。他不是會吞話的人。"),
          L("maomao", "玄氏要護著的，也許是某個人。也許，只是某個不能碰的地方。"),
          L("maomao", "……我不知道。韓當大概也不知道。") ] },
        { key: "protect_maomao", card: "tes_xuanshi", monologue: [
          L("maomao", "「妳查到的，已經夠了。」"),
          L("maomao", "那句話，聽起來像是在擋著什麼，不讓它碰到我。"),
          L("maomao", "……也可能，只是嫌我多事。笑得那麼好看的人，說什麼都像真的。") ] }
      ],
      none: [
        L("maomao", "真的御用封印，為什麼會在一間假冒御用的酒坊裡？"),
        L("maomao", "沒有人回答。也沒有人准我再問。")
      ]
    },
    story: {
      intro: [L(null, "端午前後，鳳京北市的貧民區接連有人嘔吐、腹痛，病倒了一整條街。"),
              L(null, "街頭巷尾都說是疫病。官府已經在準備封街。"),
              L("xuanshi", "「封了街，裡面的人就出不來了。在那之前，替我查清楚。」"),
              L("zhou", "「下、下官也奉命同行……疫病可是會傳人的啊！」"),
              L("handang", "「站我後面。」"),
              L("maomao", "（疫病會挑大人生病，放過孩子嗎？……不太像。）"),
              L("maomao", "（端午。家家戶戶喝的東西，只有一樣。）")],
      truth: [L("maomao", "犯人是福泉酒坊的馮老闆。他自稱御用酒坊，端午前後在街口賣溫熱的雄黃酒。"),
              L("maomao", "為了壓低成本，他向藥鋪買最便宜、混著雜石的劣質雄黃泡酒——帳上的進價低得離譜，賣價卻掛著「御用」。"),
              L("maomao", "雄黃本來就不該隨便入口，溫熱之後更毒。酒渣一加熱就冒白煙、散出蒜臭，就是證據。"),
              L("maomao", "貧民區病倒的人，都喝過那個酒攤的溫酒；沒喝酒的孩子大多沒事。這不是疫病。"),
              L("maomao", "數時辰後嘔吐、腹痛、嘴裡有蒜味，病人家裡剩的酒渣，正是橙紅偏黃的雄黃。"),
              L("maomao", "庫房裡那袋白粉，周太醫喊是砒霜。銀針沒變黑，可銀針本來就只認得一種毒——細看、嚐過，才知道是明礬，用來讓酒看起來清澈。"),
              L("maomao", "酒坊的招牌是假的。可是酒罈上的封印……是真的。")],
      outro: [L("xuanshi", "「酒坊查封，老闆收押。北市不必封街了。」"),
              L("xuanshi", "「封印的證物，即刻封存。往後，不准再查。」"),
              L(null, "他把封泥收進匣子，親手上了鎖。動作很穩，只是比平常快了一點。"),
              L("handang", "「……」韓當看了玄氏一眼，什麼也沒說。"),
              L("maomao", "（真的御用封印，為什麼會在一間假冒御用的酒坊裡？）"),
              L("maomao", "「……這件事，大概還沒結束。」")]
    },
    monologue: [L("maomao", "銀針不變黑，不代表沒有毒。人不說話，也不代表什麼都不知道。")]
  };
  if (typeof module !== "undefined" && module.exports) module.exports = DEF;
  if (root.PriTestYakushiCore) root.PriTestYakushiCore.registerCase(DEF);
})();
