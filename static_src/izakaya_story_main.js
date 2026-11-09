// 深夜居酒屋（izakaya）：常客劇情（6 人 × 10 段）。格式見 izakaya_story.js；大綱見計畫 Task 11。
// 台詞用 "說話者 id|文字"（旁白的說話者留空："|文字"），由 L() 轉成引擎要的 [說話者, 文字]。
// 觸發節奏：第 k 段要看過前一段、主角好感 ≥ (k-1)×6；選了特定選項才出現的段落不擋後面的段落。
// 只在打烊（close）／公休（holiday）出現的段落不能用 present 條件（那時沒有「同晚到店」的概念）。
(function () {
  "use strict";
  function L(arr) { return arr.map(function (x) { var i = x.indexOf("|"); return [x.slice(0, i), x.slice(i + 1)]; }); }
  function S(id, who, at, cond, lines, ch) { var o = { id: id, who: who, at: at, cond: cond, lines: L(lines) }; if (ch) o.ch = ch; return o; }

  window.PriTestIzakayaScenes = (window.PriTestIzakayaScenes || []).concat([
    // ======================= 白石 澪（音樂與失落：悲傷→救贖）=======================
    S("mio_01", ["mio"], "visit", { day: [2, 30] }, [
      "|店裡的收音機正播著十年前的流行歌。",
      "mio|「老闆，可以把音樂關掉嗎？」",
      "|她說得很客氣，握著杯子的手卻在發抖。",
      "mio|「……抱歉，我只是不太喜歡吵。」"
    ], [{ t: "默默關掉收音機", fx: { aff: { mio: 5 } } }, { t: "換成安靜的爵士樂", fx: { aff: { mio: 2 }, flag: ["mio_jazz"] } }]),
    S("mio_02", ["mio"], "visit", { seen: ["mio_01"], aff: { mio: 6 } }, [
      "mio|「今天也給我溫的就好。」",
      "|她輕輕清了清喉嚨，像是怕弄壞什麼。",
      "mio|「喉嚨……以前受過傷。冷的東西會讓它想起來。」"
    ], [{ t: "端上一杯熱檸檬水", fx: { aff: { mio: 4 } } }, { t: "「以前是唱歌的嗎？」", fx: { aff: { mio: -2 }, flag: ["mio_asked"] } }]),
    S("mio_03", ["mio"], "close", { seen: ["mio_02"], aff: { mio: 12 } }, [
      "|打烊後收拾暖簾時，店外的巷子傳來輕輕的哼歌聲。",
      "|是澪。她靠著電線桿，對著夜空哼一段沒有歌詞的旋律。",
      "|那聲音乾淨得讓人忘了呼吸——直到她發現你，歌聲戛然而止。",
      "mio|「……你什麼都沒聽到。對吧？」"
    ], [{ t: "「很好聽。真的。」", fx: { aff: { mio: 3 }, flag: ["mio_hum"] } }, { t: "「我剛出來，什麼？」", fx: { aff: { mio: 3 } } }]),
    S("mio_04", ["mio"], "visit", { seen: ["mio_03"], aff: { mio: 18 }, present: ["mio", "chinatsu"] }, [
      "|門鈴響起，千夏大笑著走進來：「老闆～老樣子！」",
      "|吧台另一端，澪手中的杯子「啪」地掉在地上。",
      "chinatsu|「……澪？」",
      "mio|「…………」",
      "|十年的沉默，在小小的店裡凝固成一道看不見的牆。"
    ], [
      { t: "「我來收拾，兩位先坐。」打圓場", fx: { link: [["mio", "chinatsu", "ex_band"]], arc: { band: 1 } } },
      { t: "裝作沒事，繼續擦杯子", fx: { aff: { mio: 3 }, arc: { band: 1 } } }
    ]),
    S("mio_05", ["mio"], "visit", { seen: ["band_01"], aff: { mio: 24 } }, [
      "mio|「……『深夜列車』。我們的樂團叫這個名字。」",
      "mio|「出道前一晚，我們在一家像這裡一樣的小店慶祝。」",
      "mio|「隔天早上，我發不出聲音了。醫生說喉嚨沒有問題。」",
      "|她把手放在喉嚨上，好像那裡還留著什麼。",
      "mio|「沒有問題，卻唱不出來。你懂那種感覺嗎？」"
    ], [{ t: "安靜地聽她說到最後", fx: { aff: { mio: 6 } } }]),
    S("mio_06", ["mio"], "visit", { seen: ["mio_05"], aff: { mio: 30 }, day: [14, 30] }, [
      "|她結帳時，錢包裡掉出一張保險單。",
      "|被保險人的名字不是她——是「葉山 千夏」。",
      "mio|「啊……那是工作上的東西。」",
      "|她搶回去的速度太快了。快得像是在藏一個十年的祕密。"
    ], [{ t: "「千夏小姐知道嗎？」", fx: { aff: { mio: 2 }, flag: ["mio_insure"] } }, { t: "什麼都不問", fx: { aff: { mio: 4 } } }]),
    S("mio_07", ["mio"], "visit", { seen: ["mio_06"], aff: { mio: 36 }, present: ["mio", "saeko"] }, [
      "|一位穿著高級套裝的女人推門而入。",
      "saeko|「好久不見，澪。妳的聲音……還是沒回來？」",
      "|澪的臉一瞬間失去血色。她丟下錢，衝出了店門。",
      "saeko|「……她還是一樣，一看到我就逃。」"
    ], [
      { t: "追出去找澪", fx: { aff: { mio: 6 }, link: [["mio", "saeko", "secret"]] } },
      { t: "留下來，替冴子倒一杯酒", fx: { aff: { saeko: 4 } } }
    ]),
    S("mio_08", ["mio"], "close", { seen: ["mio_07", "hinata_08"], aff: { mio: 42 } }, [
      "|打烊後，澪一個人坐在吧台最角落。",
      "mio|「日向……是我妹妹。我居然現在才知道。」",
      "mio|「媽媽離開家的時候，我才十歲。她說會回來。」",
      "mio|「原來她在別的地方，有了另一個女兒，還錄下了我小時候的歌……」",
      "|她笑了，眼淚卻停不下來。"
    ], [
      { t: "「我陪妳去找她。」", fx: { link: [["mio", "hinata", "sister"]], aff: { mio: 8 } } },
      { t: "「什麼時候見她，妳自己決定。」", fx: { aff: { mio: 4 } } }
    ]),
    S("mio_09", ["mio"], "visit", { seen: ["mio_08"], aff: { mio: 48 }, arc: { contest: 4 } }, [
      "|歌唱大賽的前一晚。店裡只剩下澪。",
      "mio|「老闆……可以聽我唱一句嗎？只要一句。」",
      "|她深吸一口氣，張開嘴——",
      "|聲音沙啞、顫抖，卻確實存在。",
      "mio|「……出來了。十年了，它出來了。」"
    ], [{ t: "「明天，唱給大家聽吧。」", fx: { flag: ["mio_sing"], aff: { mio: 5 } } }, { t: "「別勉強，慢慢來就好。」", fx: { aff: { mio: 3 } } }]),
    S("mio_10", ["mio"], "visit", { seen: ["mio_09", "band_06"], aff: { mio: 54 } }, [
      "|大賽過後，澪又來了。這次她沒有叫你關掉音樂。",
      "mio|「十年前我以為，失去聲音就失去了一切。」",
      "mio|「可是在這家店裡，我遇見了千夏、日向，還有……你。」",
      "mio|「謝謝你讓這家店變成我的舞台。」",
      "|她舉起杯子，輕輕哼起那首「深夜列車」的歌。"
    ], [{ t: "舉杯回應", fx: { aff: { mio: 10 }, rep: 5 } }]),

    // ======================= 葉山 千夏（豪爽背後的愧疚與金錢）=======================
    S("chinatsu_01", ["chinatsu"], "visit", { day: [3, 30] }, [
      "chinatsu|「老闆！生啤三杯，一次上！」",
      "|她一口氣乾掉一杯，豪邁地擦了擦嘴。",
      "chinatsu|「今天股票大漲！全店的客人，這一輪我請！」",
      "|店裡響起一片歡呼。"
    ], [{ t: "跟著乾一杯", fx: { aff: { chinatsu: 5 } } }, { t: "「喝慢一點啦。」", fx: { aff: { chinatsu: 2 }, flag: ["chinatsu_care"] } }]),
    S("chinatsu_02", ["chinatsu"], "visit", { seen: ["chinatsu_01"], aff: { chinatsu: 6 } }, [
      "chinatsu|「欸老闆，你有在玩股票嗎？」",
      "chinatsu|「我跟你說，這支下個月一定漲。我的直覺從來沒錯過！」",
      "|她在餐巾紙上寫下一串數字，推到你面前。"
    ], [{ t: "「那就請千夏老師指導一下。」", fx: { aff: { chinatsu: 3 }, cash: 2000 } }, { t: "「我還是專心顧店好了。」", fx: { aff: { chinatsu: 1 } } }]),
    S("chinatsu_03", ["chinatsu"], "visit", { seen: ["chinatsu_02"], aff: { chinatsu: 12 }, day: [8, 30] }, [
      "|外面下著大雨。千夏一個人坐在吧台，罕見地沒有說話。",
      "|她點的是熱清酒，一杯一杯慢慢喝。",
      "chinatsu|「……雨天啊，會想起醫院的窗戶。」"
    ], [{ t: "什麼都不說，陪她坐著", fx: { aff: { chinatsu: 6 } } }, { t: "放一首輕快的歌", fx: { aff: { chinatsu: 4 } } }]),
    S("chinatsu_04", ["chinatsu"], "visit", { seen: ["chinatsu_03"], aff: { chinatsu: 18 } }, [
      "chinatsu|「我啊，最討厭醫院的味道。」",
      "chinatsu|「十年前住了半年。那時候樂團剛解散，我又生了一場大病。」",
      "chinatsu|「醫藥費是天文數字……可是不知道為什麼，最後全部都付清了。」",
      "|她笑著聳聳肩，好像在說別人的事。"
    ], [{ t: "「是誰付的？」", fx: { aff: { chinatsu: 3 }, flag: ["chinatsu_ill"] } }, { t: "換個輕鬆的話題", fx: { aff: { chinatsu: 3 } } }]),
    S("chinatsu_05", ["chinatsu"], "visit", { seen: ["chinatsu_04", "mio_06"], aff: { chinatsu: 24 } }, [
      "chinatsu|「老闆，我查到了。當年的醫藥費，不是我的保險付的。」",
      "chinatsu|「我根本沒有那種保險。有人用我的名字，替我付了十年。」",
      "|她握著酒杯的手在發抖。",
      "chinatsu|「到底是誰……為什麼不告訴我？」"
    ], [
      { t: "告訴她澪皮夾裡的保險單", fx: { link: [["chinatsu", "mio", "debt"]], arc: { band: 1 }, aff: { chinatsu: 3 } } },
      { t: "「也許對方有不能說的理由。」", fx: { aff: { mio: 5 }, arc: { band: 1 } } }
    ]),
    S("chinatsu_06", ["chinatsu"], "visit", { seen: ["chinatsu_05"], aff: { chinatsu: 30 }, day: [16, 30] }, [
      "|千夏一進門就趴在吧台上。",
      "chinatsu|「……賠光了。全部。」",
      "chinatsu|「我的直覺，第一次錯得這麼徹底。」",
      "|她抬起頭，眼睛紅紅的，卻還是努力擠出笑容。"
    ], [{ t: "「先借妳周轉吧。」（-5000）", fx: { cash: -5000, aff: { chinatsu: 10 }, flag: ["chinatsu_loan"] } }, { t: "「今晚我請，吃飽再說。」", fx: { aff: { chinatsu: 4 } } }]),
    S("chinatsu_07", ["chinatsu"], "close", { seen: ["chinatsu_06"], aff: { chinatsu: 36 } }, [
      "|打烊後，千夏從包包裡拿出一雙磨損得發亮的鼓棒。",
      "chinatsu|「解散之後，我一直帶著它。說是護身符，其實是捨不得。」",
      "|她在吧台邊緣輕輕敲了幾下，節奏還是那麼準。"
    ], [{ t: "「打一段給我聽？」", fx: { aff: { chinatsu: 4 }, flag: ["chinatsu_drum"] } }, { t: "幫她把鼓棒收好", fx: { aff: { chinatsu: 2 } } }]),
    S("chinatsu_08", ["chinatsu"], "visit", { seen: ["chinatsu_07"], aff: { chinatsu: 40 }, present: ["chinatsu", "saeko"] }, [
      "saeko|「千夏。妳在找替妳付醫藥費的人吧。」",
      "saeko|「是我。我用那首歌的版權，換了妳的命。」",
      "chinatsu|「……妳說什麼？那首歌是我們四個人的！」",
      "|千夏猛地站起來，椅子倒在地上。"
    ], [
      { t: "站在千夏這邊", fx: { aff: { chinatsu: 6, saeko: -4 } } },
      { t: "「兩位，坐下來好好談。」", fx: { link: [["chinatsu", "saeko", "debt"]], aff: { chinatsu: 3, saeko: 3 } } }
    ]),
    S("chinatsu_09", ["chinatsu"], "visit", { seen: ["chinatsu_08"], aff: { chinatsu: 46 }, flag: ["chinatsu_loan"] }, [
      "chinatsu|「老闆！上次借的錢，連本帶利還你！」",
      "|她把信封拍在吧台上，裡面還夾著一張演唱會門票。",
      "chinatsu|「這次是踏實賺來的。我換了一個不用賭直覺的工作。」"
    ], [{ t: "收下", fx: { cash: 6000, aff: { chinatsu: 5 } } }]),
    S("chinatsu_09b", ["chinatsu"], "visit", { seen: ["chinatsu_08"], aff: { chinatsu: 46 }, notFlag: ["chinatsu_loan"] }, [
      "chinatsu|「老闆，這給你。」",
      "|一張手寫的門票：『深夜列車 復活試奏會（？）』。",
      "chinatsu|「還沒決定要不要辦啦。可是第一張票，想給你。」"
    ], [{ t: "收下", fx: { aff: { chinatsu: 6 } } }]),
    S("chinatsu_10", ["chinatsu"], "visit", { seen: ["chinatsu_08", "band_06"], aff: { chinatsu: 54 } }, [
      "chinatsu|「我報名了大賽的伴奏樂隊！……雖然比賽已經結束了啦。」",
      "chinatsu|「總之，我決定重新打鼓。不是為了誰，是為了我自己。」",
      "|她舉起啤酒，大笑著。這次的笑容，沒有勉強。"
    ], [{ t: "「乾杯！」", fx: { aff: { chinatsu: 10 }, rep: 5 } }]),

    // ======================= 小鳥遊 鈴（喜劇、商店街人情）=======================
    S("rin_01", ["rin"], "visit", { day: [1, 30] }, [
      "rin|「老闆老闆！這是我們家的新作和菓子，請試吃！」",
      "|你咬了一口。——是鹹的。非常鹹。",
      "rin|「怎麼樣怎麼樣？我把砂糖跟鹽的罐子換了位置，應該更好吃了吧？」"
    ], [{ t: "「……這是鹹的。」老實說", fx: { aff: { rin: 4 } } }, { t: "「很、很有個性的味道！」", fx: { aff: { rin: 1 }, flag: ["rin_lie"] } }]),
    S("rin_02", ["rin"], "visit", { seen: ["rin_01"], aff: { rin: 6 } }, [
      "rin|「老闆，聽我說！商店街開會，大家竟然推我當歌唱大賽的主辦！」",
      "rin|「我連卡拉 OK 都只去過三次耶！」",
      "rin|「……但是，我想讓商店街熱鬧起來。老闆可以幫我嗎？」"
    ], [{ t: "「當然，算我一份。」", fx: { arc: { contest: 1 }, aff: { rin: 5 } } }, { t: "「先看看情況再說吧。」", fx: { arc: { contest: 1 }, aff: { rin: 1 } } }]),
    S("rin_03", ["rin"], "holiday", { seen: ["rin_02", "contest_01"], aff: { rin: 12 } }, [
      "|公休日，鈴抱著一大捲紙來敲門。",
      "rin|「海報大作戰！一起畫吧！」",
      "|兩個小時後，畫出來的麥克風看起來像一根大蔥。",
      "rin|「……好像，有點醜？」"
    ], [{ t: "「重畫一張吧！」", fx: { aff: { rin: 4 } } }, { t: "「大蔥很有居酒屋風格，就用這張！」", fx: { flag: ["rin_poster"], rep: 3 } }]),
    S("rin_04", ["rin"], "visit", { seen: ["rin_03"], aff: { rin: 18 } }, [
      "rin|「老闆……我跟你說一個祕密。」",
      "rin|「我一滴酒都不能喝。可是商店街的聚會，大家都會一直勸酒。」",
      "rin|「我從來不敢拒絕，每次都偷偷倒進盆栽裡。」"
    ], [{ t: "「下次聚會，我幫妳準備『看起來像酒』的飲料。」", fx: { aff: { rin: 6 } } }, { t: "「教妳一句漂亮的拒絕台詞。」", fx: { aff: { rin: 4 } } }]),
    S("rin_05", ["rin"], "visit", { seen: ["rin_04"], aff: { rin: 24 }, day: [12, 30] }, [
      "|鈴把一張傳單放在吧台上，平常的笑容不見了。",
      "|『月見橫丁再開發計畫 說明會』。",
      "rin|「我們家的店……已經開了八十年了。」"
    ], [{ t: "「先別擔心，還沒決定的事。」", fx: { aff: { rin: 4 } } }, { t: "「一起去區公所問清楚！」", fx: { flag: ["rin_city"], aff: { rin: 6 } } }]),
    S("rin_06", ["rin"], "visit", { seen: ["rin_05"], aff: { rin: 30 }, present: ["rin", "hinata"] }, [
      "rin|「欸？那位日向小姐，跟澪小姐長得好像喔。」",
      "rin|「眼睛，還有唱歌前會摸喉嚨的習慣……一模一樣耶。」",
      "|天然呆的直覺，有時候比誰都準。"
    ], [{ t: "「真的嗎？妳看得好仔細。」", fx: { flag: ["rin_noticed"], aff: { rin: 3 } } }, { t: "笑著帶過", fx: { aff: { rin: 2 } } }]),
    S("rin_07", ["rin"], "visit", { seen: ["rin_06"], aff: { rin: 36 }, present: ["rin", "saeko"] }, [
      "saeko|「小鳥遊小姐，我們公司願意贊助歌唱大賽。」",
      "saeko|「條件只有一個：讓我當評審。」",
      "rin|「贊助！？老闆，怎麼辦！？」"
    ], [
      { t: "「接受吧，大賽需要經費。」", fx: { arc: { contest: 1 }, link: [["rin", "saeko", "boss"]] } },
      { t: "「條件太奇怪了，拒絕。」", fx: { rep: -3, aff: { rin: 3 }, arc: { contest: 1 } } }
    ]),
    S("rin_08", ["rin"], "holiday", { seen: ["rin_07"], aff: { rin: 40 }, arc: { contest: 3 } }, [
      "rin|「老闆！大事不好！大賽的場地被重複預約了！」",
      "rin|「另一場是……再開發公司的說明會！」",
      "|她急得快哭出來了。"
    ], [{ t: "「我的店借妳當會場！」", fx: { rep: 5, arc: { contest: 1 } } }, { t: "「我出錢，改借公民館。」（-3000）", fx: { cash: -3000, arc: { contest: 1 } } }]),
    S("rin_09", ["rin"], "close", { seen: ["rin_08"], aff: { rin: 46 }, arc: { contest: 5 } }, [
      "|大賽結束的夜晚。慶功的人潮散去後，鈴趴在吧台上睡著了。",
      "|手裡還握著寫滿行程的筆記本，嘴角沾著和菓子的粉。",
      "rin|「……大家……都很開心……太好了……」"
    ], [{ t: "替她蓋上外套", fx: { aff: { rin: 6 } } }]),
    S("rin_10", ["rin"], "visit", { seen: ["rin_09", "contest_06"], aff: { rin: 52 } }, [
      "rin|「老闆！我決定了！明年要辦第二屆！」",
      "rin|「然後，評審長要請老闆來當！不准拒絕喔！」",
      "|她遞上一盒和菓子。這次，是甜的。"
    ], [{ t: "「遵命，主辦大人。」", fx: { aff: { rin: 10 }, rep: 5 } }]),

    // ======================= 黑川 冴子（反派的苦衷、職場權謀）=======================
    S("saeko_01", ["saeko"], "visit", { day: [6, 30] }, [
      "|一位氣場驚人的女性坐上吧台，看了一眼生魚片就推回來。",
      "saeko|「我不吃生的。你們店不問客人的嗎？」",
      "|整間店的溫度好像下降了兩度。"
    ], [{ t: "「非常抱歉，馬上換一道。」", fx: { aff: { saeko: 3 } } }, { t: "「這是今天最好的魚，請試一口。」", fx: { aff: { saeko: -2 }, flag: ["saeko_bold"] } }]),
    S("saeko_02", ["saeko"], "visit", { seen: ["saeko_01"], aff: { saeko: 6 } }, [
      "saeko|「這家店……味道不差。」",
      "|她遞出一張燙金名片：『黑川 冴子　唱片公司 製作人』。",
      "saeko|「如果有會唱歌的客人，記得通知我。」"
    ], [{ t: "收下名片", fx: { flag: ["saeko_card"], aff: { saeko: 2 } } }, { t: "「我不太懂音樂。」", fx: { aff: { saeko: 2 } } }]),
    S("saeko_03", ["saeko"], "visit", { seen: ["saeko_02"], aff: { saeko: 12 } }, [
      "saeko|「才華？那只是商品。賣不出去的才華，跟垃圾沒兩樣。」",
      "saeko|「這個業界就是這樣。我十年前就學會了。」",
      "|她說得很冷，喝酒的速度卻很快。"
    ], [{ t: "「可是妳看起來不像真的這麼想。」", fx: { aff: { saeko: 4 }, flag: ["saeko_argue"] } }, { t: "「真是辛苦的世界。」", fx: { aff: { saeko: 1 } } }]),
    S("saeko_04", ["saeko"], "visit", { seen: ["saeko_03", "band_03"], aff: { saeko: 18 } }, [
      "saeko|「……對，我手上有一首歌。『深夜列車』沒能發表的出道曲。」",
      "saeko|「版權在我手上。十年了，我一次都沒有拿出來賣。」",
      "|她盯著杯子裡的冰塊，像在看一段很遠的過去。"
    ], [{ t: "「為什麼不賣？」", fx: { flag: ["saeko_why"], aff: { saeko: 3 } } }, { t: "「那就還給樂團啊。」", fx: { aff: { saeko: -3 } } }]),
    S("saeko_05", ["saeko"], "close", { seen: ["saeko_04", "chinatsu_05"], aff: { saeko: 22 } }, [
      "|打烊後，冴子一個人留下來。",
      "saeko|「十年前，千夏病倒了。需要一大筆錢。」",
      "saeko|「公司說，只要把出道曲的版權賣給他們，就幫忙付醫藥費。」",
      "saeko|「我簽了。用她們最重要的東西，換了千夏的命。然後被所有人討厭到現在。」",
      "|她第一次在你面前，露出疲憊的表情。"
    ], [
      { t: "「妳救了她。」", fx: { aff: { saeko: 8 }, link: [["saeko", "chinatsu", "debt"]] } },
      { t: "「為什麼不告訴她們？」", fx: { aff: { saeko: -2 } } }
    ]),
    S("saeko_06", ["saeko"], "visit", { seen: ["saeko_05"], aff: { saeko: 28 }, day: [15, 30] }, [
      "saeko|「公司要我把那首歌賣給大企業做廣告歌。」",
      "saeko|「下週交不出簽約書，我就得滾蛋。」",
      "|她笑了一下，很難看的笑。"
    ], [{ t: "「那首歌不該變成廣告歌。」", fx: { aff: { saeko: 6 }, flag: ["saeko_resist"] } }, { t: "「先保住工作吧。」", fx: { aff: { saeko: 2 } } }]),
    S("saeko_07", ["saeko"], "visit", { seen: ["saeko_06"], aff: { saeko: 32 }, arc: { contest: 2 } }, [
      "saeko|「歌唱大賽的評審，我已經跟主辦談好了。」",
      "saeko|「我在找一個聲音。十年前弄丟的那個聲音。」",
      "|她沒有說是誰。"
    ], [{ t: "「祝妳找到。」", fx: { arc: { contest: 1 }, aff: { saeko: 2 } } }, { t: "「妳在找澪，對吧？」", fx: { flag: ["saeko_motive"], aff: { saeko: 2 }, arc: { contest: 1 } } }]),
    S("saeko_08", ["saeko"], "holiday", { seen: ["saeko_07"], aff: { saeko: 38 }, flag: ["saeko_resist"] }, [
      "|公休日，冴子約你在公司樓下見面。",
      "|她手上拿著一封辭職信，已經在那裡站了一個小時。",
      "saeko|「……我是不是很可笑？」"
    ], [{ t: "「我陪妳一起交出去。」", fx: { aff: { saeko: 10 }, flag: ["saeko_quit"] } }, { t: "「再想一想也沒關係。」", fx: { aff: { saeko: 3 } } }]),
    S("saeko_09", ["saeko"], "visit", { seen: ["saeko_07"], aff: { saeko: 42 }, present: ["saeko", "mio"] }, [
      "|冴子走到澪面前，深深地低下頭。",
      "saeko|「澪。十年前，對不起。」",
      "mio|「……我一直以為，是妳偷走了我們的歌。」",
      "saeko|「是我偷的。為了千夏。但我還是偷了。」"
    ], [
      { t: "讓兩人獨處", fx: { link: [["saeko", "mio", "friend"]], arc: { band: 1 } } },
      { t: "替兩人各倒一杯酒", fx: { aff: { mio: 3, saeko: 3 }, arc: { band: 1 } } }
    ]),
    S("saeko_10", ["saeko"], "visit", { seen: ["saeko_09", "band_06"], aff: { saeko: 48 } }, [
      "saeko|「我開了一家小小的獨立廠牌。」",
      "saeko|「第一首發行的歌，是『深夜列車』的出道曲。版權，還給她們了。」",
      "saeko|「第一位簽約的新人……是日向。」",
      "|她遞出新的名片，上面只寫著一行字：『黑川音樂工作室』。"
    ], [{ t: "「恭喜。乾杯。」", fx: { aff: { saeko: 10 }, rep: 5 } }]),

    // ======================= 春日 日向（追夢、身世之謎）=======================
    S("hinata_01", ["hinata"], "visit", { day: [4, 30] }, [
      "|背著吉他的年輕女生推門進來，手指上貼滿了 OK 繃。",
      "hinata|「請、請問……這裡最便宜的是什麼？」",
      "hinata|「我剛在車站前唱完。今天……只有兩個人停下來聽。」"
    ], [{ t: "端上一碗熱雜炊", fx: { aff: { hinata: 5 } } }, { t: "「妳都唱什麼歌？」", fx: { aff: { hinata: 3 } } }]),
    S("hinata_02", ["hinata"], "visit", { seen: ["hinata_01"], aff: { hinata: 6 } }, [
      "|日向盯著菜單看了很久，最後只點了白飯。",
      "hinata|「……我對海鮮過敏。居酒屋的菜，好多都不能吃。」",
      "|她不好意思地笑了。"
    ], [{ t: "「我做幾道沒有海鮮的給妳。」", fx: { aff: { hinata: 4 } } }, { t: "「試試我們的招牌嘛！」", fx: { aff: { hinata: -1 } } }]),
    S("hinata_03", ["hinata"], "visit", { seen: ["hinata_02", "contest_01"], aff: { hinata: 12 } }, [
      "|日向把歌唱大賽的報名表攤在吧台上，手在發抖。",
      "hinata|「我想報名。可是……我真的可以嗎？」"
    ], [{ t: "「可以。妳的歌，值得被聽見。」", fx: { arc: { contest: 1 }, aff: { hinata: 5 } } }, { t: "「報名吧，然後每天來這裡練習。」", fx: { arc: { contest: 1 }, aff: { hinata: 2 } } }]),
    S("hinata_04", ["hinata"], "close", { seen: ["hinata_03"], aff: { hinata: 18 } }, [
      "hinata|「我唯一的寶物，是媽媽留下來的錄音帶。」",
      "hinata|「媽媽說，那是她最喜歡的歌。可是唱歌的人……不是媽媽。」",
      "hinata|「我一直很想知道，那個聲音是誰。」"
    ], [{ t: "「錄了什麼歌？」", fx: { flag: ["hinata_tape"], aff: { hinata: 3 } } }, { t: "靜靜聽她說", fx: { flag: ["hinata_tape"], aff: { hinata: 3 } } }]),
    S("hinata_05", ["hinata"], "visit", { seen: ["hinata_04"], aff: { hinata: 22 } }, [
      "|一個戴著耳機的女生走進來，看到日向就冷笑。",
      "kotone|「又是妳。在車站前大吼大叫的那個。」",
      "kotone|「妳的歌，只有熱情。技巧連及格都沒有。」",
      "hinata|「……妳說什麼！」"
    ], [
      { t: "替日向說話", fx: { aff: { hinata: 6 }, link: [["hinata", "kotone", "rival"]] } },
      { t: "「那就在大賽上一決勝負吧。」", fx: { arc: { contest: 1 }, link: [["hinata", "kotone", "rival"]] } }
    ]),
    S("hinata_06", ["hinata"], "visit", { seen: ["hinata_05", "contest_02"], aff: { hinata: 28 } }, [
      "|練歌時，日向唱到高音破了音。",
      "|店裡一瞬間安靜下來。",
      "|她咬著嘴唇，抓起吉他跑出了店門。"
    ], [{ t: "追出去", fx: { aff: { hinata: 8 } } }, { t: "煮一碗熱湯等她回來", fx: { aff: { hinata: 5 } } }]),
    S("hinata_07", ["hinata"], "holiday", { seen: ["hinata_06"], aff: { hinata: 34 }, flag: ["hinata_tape"] }, [
      "|公休日，日向帶著一台老舊的隨身聽來店裡。",
      "|錄音帶裡傳出一個小女孩的歌聲，稚嫩卻清澈。",
      "|——那是澪的聲音。你在打烊後的巷子裡聽過。"
    ], [{ t: "「我們去問澪小姐吧。」", fx: { flag: ["hinata_ask"] } }, { t: "「先查清楚再說。」", fx: { flag: ["hinata_search"] } }]),
    S("hinata_08", ["hinata"], "visit", { seen: ["hinata_07"], aff: { hinata: 40 }, present: ["hinata", "mio"] }, [
      "|日向把錄音帶放在澪的面前。",
      "hinata|「這個聲音……是妳，對不對？」",
      "mio|「……這是我七歲的時候。媽媽很喜歡錄我唱歌。」",
      "hinata|「媽媽……她叫春日 和美。她是我的媽媽。」",
      "|兩個人看著彼此，眼眶慢慢紅了。同一個母親，分開的二十年。"
    ], [{ t: "把兩人的手放在一起", fx: { link: [["hinata", "mio", "sister"]], arc: { band: 1 }, aff: { hinata: 8, mio: 8 } } }]),
    S("hinata_09", ["hinata"], "close", { seen: ["hinata_08", "contest_05"], aff: { hinata: 44 } }, [
      "|大賽結束的夜晚，日向抱著吉他坐在吧台。",
      "hinata|「我唱了媽媽的歌。姊姊在台下哭了。」",
      "hinata|「名次……其實沒那麼重要了。」",
      "|她笑得比任何時候都燦爛。"
    ], [{ t: "「妳唱得很好。」", fx: { aff: { hinata: 8 } } }]),
    S("hinata_10", ["hinata"], "visit", { seen: ["hinata_09", "saeko_10"], aff: { hinata: 50 } }, [
      "hinata|「老闆！冴子小姐說要讓我出道！」",
      "hinata|「出道曲……是姊姊她們當年的那首歌。由我來唱！」",
      "hinata|「第一場演出，可以在這家店辦嗎？」"
    ], [{ t: "「當然。這裡就是妳的起點。」", fx: { aff: { hinata: 10 }, rep: 8 } }]),

    // ======================= 早乙女 蘭（懸疑追查、記者倫理）=======================
    S("ran_01", ["ran"], "visit", { day: [5, 30] }, [
      "|一位短髮女性在每道菜上撒滿辣椒粉，眼睛卻一直打量其他客人。",
      "ran|「老闆，這裡的常客，你都認識嗎？」"
    ], [{ t: "端上一道辣味豆腐", fx: { aff: { ran: 5 } } }, { t: "「妳在找誰？」", fx: { flag: ["ran_watch"], aff: { ran: 2 } } }]),
    S("ran_02", ["ran"], "visit", { seen: ["ran_01"], aff: { ran: 6 } }, [
      "|你注意到她的包包裡，錄音筆的紅燈亮著。",
      "ran|「……啊，被發現了？職業病啦。」"
    ], [{ t: "「店裡請關掉。」", fx: { aff: { ran: -2 }, rep: 2 } }, { t: "裝作沒看到", fx: { flag: ["ran_rec"], aff: { ran: 2 } } }]),
    S("ran_03", ["ran"], "visit", { seen: ["ran_02"], aff: { ran: 12 } }, [
      "ran|「我上一篇獨家，害一個人丟了工作。」",
      "ran|「報導是真的。可是……真的就一定要寫出來嗎？」",
      "|她第一次沒有撒辣椒粉。"
    ], [{ t: "「妳會這樣問，就代表妳是好記者。」", fx: { aff: { ran: 5 } } }, { t: "「妳後悔嗎？」", fx: { flag: ["ran_regret"], aff: { ran: 3 } } }]),
    S("ran_04", ["ran"], "visit", { seen: ["ran_03", "band_01"], aff: { ran: 18 } }, [
      "|蘭亮出記者證。",
      "ran|「老實說吧，我在追『深夜列車』解散的真相。」",
      "ran|「前主唱和前鼓手，都是這家店的常客。對吧？」"
    ], [
      { t: "提供一點線索", fx: { arc: { band: 1 }, flag: ["ran_lead"], aff: { ran: 4 } } },
      { t: "「我不會出賣客人。」", fx: { aff: { mio: 3 }, flag: ["ran_lead"] } }
    ]),
    S("ran_05", ["ran"], "close", { seen: ["ran_04"], aff: { ran: 24 }, flag: ["ran_lead"] }, [
      "|打烊後，蘭把一疊照片攤在吧台上。",
      "|照片裡，冴子在十年前的醫院門口，和一位醫生交談。",
      "ran|「我跟蹤了她三天。這女人，藏著大祕密。」"
    ], [{ t: "「妳該停手了。」", fx: { flag: ["ran_stop"] } }, { t: "一起看照片", fx: { flag: ["ran_photo"] } }]),
    S("ran_06", ["ran"], "visit", { seen: ["ran_05"], aff: { ran: 30 }, day: [15, 30] }, [
      "ran|「總編叫我別再查了。說是『上面』的意思。」",
      "ran|「一個過氣樂團的解散，為什麼會驚動上面？」",
      "|她的手指，在杯緣不安地繞圈。"
    ], [{ t: "「我支持妳查下去。」", fx: { aff: { ran: 6 } } }, { t: "「先保護好自己。」", fx: { aff: { ran: 3 } } }]),
    S("ran_07", ["ran"], "visit", { seen: ["ran_06", "band_05"], aff: { ran: 36 } }, [
      "ran|「我知道全部的真相了。版權、醫藥費、失聲的原因。」",
      "ran|「這是十年一遇的獨家。可是寫出來，冴子會毀掉，澪也會受傷。」",
      "ran|「老闆……你覺得我該寫嗎？」"
    ], [{ t: "「不要寫。」", fx: { flag: ["ran_noprint"], aff: { mio: 5 } } }, { t: "「妳自己決定。」", fx: { flag: ["ran_choice"], aff: { ran: 4 } } }]),
    S("ran_08", ["ran"], "holiday", { seen: ["ran_07"], aff: { ran: 40 }, flag: ["ran_noprint"] }, [
      "|公休日，蘭傳來一份草稿。",
      "|標題是：『十年後的重逢——深夜居酒屋的一夜』。",
      "|沒有醜聞，沒有爆料。只有一群人，重新找回彼此的故事。"
    ], [{ t: "認真讀完她的草稿", fx: { aff: { ran: 6 } } }]),
    S("ran_09", ["ran"], "visit", { seen: ["ran_07"], aff: { ran: 44 }, day: [24, 30] }, [
      "ran|「下一個要追的題目決定了。」",
      "ran|「某個知名舞團的首席，傳出『假傷退團』。我覺得背後有鬼。」",
      "|她的眼睛又亮了起來。"
    ], [{ t: "「小心一點。」", fx: { flag: ["ran_dance"], aff: { ran: 3 } } }]),
    S("ran_10", ["ran"], "visit", { seen: ["ran_09", "band_06"], aff: { ran: 50 } }, [
      "|蘭坐下來，點了一杯生啤。",
      "ran|「今天沒帶錄音筆。」",
      "ran|「就只是……想來這裡喝一杯。這樣也可以吧？」"
    ], [{ t: "「隨時歡迎。」", fx: { aff: { ran: 10 }, rep: 5 } }])
  ]);
})();
