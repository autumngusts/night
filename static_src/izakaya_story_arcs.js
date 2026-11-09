// 深夜居酒屋（izakaya）：事件線的多人場面（1a：🎸 消失的樂團 6 段、🎤 歌唱比賽 7 段）。格式見 izakaya_story.js。
// 公休日在第 6、12、18、24 天之後，所以大賽（contest_05）放在 day≥18 的公休日，大賽之後的段落改在打烊（close）。
(function () {
  "use strict";
  function L(arr) { return arr.map(function (x) { var i = x.indexOf("|"); return [x.slice(0, i), x.slice(i + 1)]; }); }
  function S(id, who, arc, at, cond, lines, ch) { var o = { id: id, who: who, arc: arc, at: at, cond: cond, lines: L(lines), pri: 3 }; if (ch) o.ch = ch; return o; }

  window.PriTestIzakayaScenes = (window.PriTestIzakayaScenes || []).concat([
    // ======================= 🎸 消失的樂團「深夜列車」=======================
    S("band_01", ["mio", "chinatsu"], "band", "visit", { seen: ["mio_04"], present: ["mio", "chinatsu"] }, [
      "|澪和千夏又在同一晚出現了。這次，兩人都沒有離開。",
      "chinatsu|「……妳過得好嗎？」",
      "mio|「普通。妳呢？」",
      "chinatsu|「普通。」",
      "|十年後的第一段對話，短得令人心痛。"
    ], [
      { t: "替兩人各送一杯酒", fx: { arc: { band: 1 }, aff: { mio: 3, chinatsu: 3 } } },
      { t: "讓她們自己說下去", fx: { flag: ["band_cold"], arc: { band: 1 } } }
    ]),
    S("band_02", ["mio", "kaede"], "band", "visit", { seen: ["band_01"], staff: "kaede" }, [
      "|吧台後的楓，聽到澪點餐的聲音，手上的酒杯碎了。",
      "kaede|「……澪？真的是妳？」",
      "mio|「楓……妳在這裡工作？」",
      "|深夜列車的貝斯手和主唱，隔著吧台，十年後重逢。"
    ], [
      { t: "「去打個招呼吧，杯子我來收。」", fx: { link: [["kaede", "mio", "ex_band"]], arc: { band: 1 } } },
      { t: "先讓楓冷靜一下", fx: { aff: { kaede: 4 }, arc: { band: 1 } } }
    ]),
    S("band_03", ["saeko", "mio"], "band", "visit", { seen: ["band_01"], present: ["saeko", "mio"] }, [
      "|冴子在離開前，在澪的位子旁停下腳步。",
      "saeko|「澪。那首歌，是我的。」",
      "saeko|「如果妳想拿回去，就自己來找我。」",
      "|門關上了。澪握著筷子的手指發白。"
    ], [
      { t: "「那首歌是什麼？」追問澪", fx: { flag: ["band_song"], arc: { band: 1 } } },
      { t: "什麼都不說，替她換一杯熱茶", fx: { flag: ["band_song"], arc: { band: 1 } } }
    ]),
    S("band_04", ["ran"], "band", "visit", { flag: ["band_song"] }, [
      "ran|「老闆，『那首歌是我的』——這句話，你也聽到了吧？」",
      "ran|「深夜列車解散的那晚，到底發生了什麼？」",
      "|她把錄音筆放在吧台上。這一次，她讓你看見紅燈。"
    ], [
      { t: "說出你知道的部分", fx: { flag: ["ran_knows"], arc: { band: 1 } } },
      { t: "「這是她們的故事，不是我的。」", fx: { aff: { mio: 5 }, arc: { band: 1 } } }
    ]),
    S("band_05", ["mio", "chinatsu", "saeko"], "band", "holiday", { arc: { band: 4 }, seen: ["saeko_05"] }, [
      "|公休日。你把澪、千夏、冴子三個人約到店裡。",
      "saeko|「十年前，千夏病倒。我用出道曲的版權換了醫藥費。」",
      "mio|「……我知道。那天晚上，我在走廊聽到了。」",
      "mio|「我不想讓千夏知道，自己的命是用我們的歌換來的。所以……我不唱了。」",
      "chinatsu|「笨蛋……妳們兩個都是笨蛋！」",
      "|醫生說喉嚨沒有問題。失去聲音的，是她的心。"
    ], [
      { t: "讓三個人把話說開", fx: { arc: { band: 1 }, link: [["mio", "chinatsu", "friend"], ["mio", "saeko", "friend"]] } },
      { t: "先只陪著澪", fx: { aff: { mio: 8 }, arc: { band: 1 } } }
    ]),
    S("band_06", ["mio", "chinatsu"], "band", "close", { seen: ["band_05", "contest_05"] }, [
      "|大賽結束的夜晚，店裡擠滿了人。",
      "|千夏敲起鼓棒，楓抱著借來的貝斯，日向彈起吉他。",
      "mio|「這是『深夜列車』的出道曲。十年遲到的首演。」",
      "|沙啞、顫抖，卻比任何時候都動人的歌聲，填滿了小小的居酒屋。",
      "|有人在哭，有人在笑。你站在吧台後面，看著這一切。"
    ], [{ t: "在吧台後面，靜靜地聽到最後", fx: { arc: { band: 1 }, rep: 15 } }]),

    // ======================= 🎤 歌唱比賽 =======================
    S("contest_01", ["rin"], "contest", "visit", { seen: ["rin_02"], day: [5, 30] }, [
      "|鈴在店門口貼上一張大海報：『第一屆 月見橫丁歌唱大賽』。",
      "rin|「報名處就在這裡！老闆說可以借店裡當練歌場！」",
      "|……你什麼時候說過？"
    ], [{ t: "「……好吧，歡迎來練歌。」", fx: { arc: { contest: 1 }, rep: 3 } }]),
    S("contest_02", ["hinata", "rin"], "contest", "close", { seen: ["contest_01"], arc: { contest: 2 } }, [
      "|打烊後的練歌大會。",
      "|鈴唱到一半忘詞，千夏把鼓棒敲在吧台上打拍子，日向的高音讓玻璃杯嗡嗡作響。",
      "rin|「老闆也唱一首嘛！」",
      "|全場的目光，都轉向了你。"
    ], [
      { t: "硬著頭皮唱一首", fx: { aff: { hinata: 3, rin: 3 }, arc: { contest: 1 } } },
      { t: "「我當評審，負責打分數！」", fx: { flag: ["contest_judge"], arc: { contest: 1 } } }
    ]),
    S("contest_03", ["hinata", "yuzu"], "contest", "visit", { seen: ["contest_02"], staff: "yuzu" }, [
      "|練歌時，地上掉了一張寫滿歌詞的提詞紙。",
      "kotone|「作弊。日向，這是妳的吧？」",
      "hinata|「不是我！」",
      "|你看見柚子的臉一瞬間變得蒼白。那是她的字跡。"
    ], [
      { t: "說出真相", fx: { aff: { hinata: 5, yuzu: -3 }, arc: { contest: 1 } } },
      { t: "私下跟柚子談", fx: { aff: { yuzu: 5 }, flag: ["contest_secret"], arc: { contest: 1 } } }
    ]),
    S("contest_03b", ["hinata"], "contest", "visit", { seen: ["contest_02"], notSeen: ["contest_03"], day: [14, 30] }, [
      "|練歌時，地上掉了一張寫滿歌詞的提詞紙。",
      "kotone|「作弊。日向，這是妳的吧？」",
      "hinata|「不是我！」",
      "|紙條背面，畫著一個小小的偶像簽名。日向的字不是這樣的。"
    ], [
      { t: "替日向作證", fx: { aff: { hinata: 5 }, arc: { contest: 1 } } },
      { t: "「別吵了，再寫一張不就好了。」", fx: { flag: ["contest_secret"], arc: { contest: 1 } } }
    ]),
    S("contest_04", ["saeko", "mio"], "contest", "visit", { seen: ["contest_02"], arc: { contest: 3 } }, [
      "|大賽的評審名單公布了。",
      "|第三位：『黑川 冴子（唱片公司製作人）』。",
      "|坐在吧台角落的澪，看到名單後一句話也沒說，只是把酒一口喝乾。"
    ], [
      { t: "去安撫澪", fx: { aff: { mio: 5 }, arc: { contest: 1 } } },
      { t: "問冴子為什麼要當評審", fx: { flag: ["saeko_motive"], arc: { contest: 1 } } }
    ]),
    S("contest_05", ["rin", "hinata"], "contest", "holiday", { arc: { contest: 4 }, seen: ["contest_04"], day: [18, 30] }, [
      "|月見橫丁歌唱大賽，當天。",
      "|日向唱了媽媽留下的那首歌。台下，有人輕輕跟著哼。",
      "|——是澪。坐在評審席的冴子，看著澪，緩緩站了起來。",
      "saeko|「……那個聲音。我找了十年的聲音。」",
      "|會場一片譁然。"
    ], [
      { t: "為日向大聲喝采", fx: { arc: { contest: 1 }, rep: 10 } },
      { t: "替所有參賽者鼓掌", fx: { arc: { contest: 1 }, rep: 8 } }
    ]),
    S("contest_06", ["rin"], "contest", "close", { seen: ["contest_05"] }, [
      "|慶功宴。參賽者、評審、商店街的人，全部擠進了小小的店裡。",
      "rin|「老闆～！今天辛苦了！大家都說，明年還要再辦！」",
      "|有人在唱歌，有人在哭，有人搶著付帳。"
    ], [
      { t: "「今晚第一輪，我請！」（-5000）", fx: { cash: -5000, rep: 10, aff: { rin: 3, hinata: 3, mio: 3 } } },
      { t: "端出拿手菜，跟大家一起慶祝", fx: { rep: 5 } }
    ])
  ]);
})();
