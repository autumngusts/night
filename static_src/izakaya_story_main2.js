// 深夜居酒屋（izakaya）：1b 新常客劇情（6 人 × 10 段）。格式見 izakaya_story.js；角色與主線揭曉見計畫 2026-11-09-izakaya-1b.md。
// 新常客較晚到店（第 7〜12 天），好感門檻改為 (k-1)×5。
(function () {
  "use strict";
  function L(arr) { return arr.map(function (x) { var i = x.indexOf("|"); return [x.slice(0, i), x.slice(i + 1)]; }); }
  function S(id, who, at, cond, lines, ch) { var o = { id: id, who: who, at: at, cond: cond, lines: L(lines) }; if (ch) o.ch = ch; return o; }
  function A(id, n) { var a = {}; a[id] = n; return a; }

  window.PriTestIzakayaScenes = (window.PriTestIzakayaScenes || []).concat([
    // ======================= 鳳 麗華（前舞團首席：被汙名的傷）=======================
    S("reika_01", ["reika"], "visit", { day: [4, 30] }, [
      "|一位姿態挺拔的女性坐上吧台，脊背像一把尺。",
      "reika|「溫熱的烏龍茶就好。我不太喝酒。」",
      "|她的右腳踝，纏著一圈不太明顯的護具。"
    ], [{ t: "端上熱茶", fx: { aff: A("reika", 5) } }, { t: "「腳受傷了嗎？」", fx: { aff: A("reika", 2), flag: ["reika_ankle"] } }]),
    S("reika_02", ["reika"], "visit", { seen: ["reika_01"], aff: A("reika", 5) }, [
      "reika|「我在隔壁街教瑜伽。很安靜的工作。」",
      "|她說「安靜」兩個字的時候，眼神飄得很遠。",
      "reika|「以前的工作……太吵了。」"
    ], [{ t: "「以前做什麼？」", fx: { aff: A("reika", 2) } }, { t: "「安靜也很好。」", fx: { aff: A("reika", 4) } }]),
    S("reika_03", ["reika"], "visit", { seen: ["reika_02"], aff: A("reika", 10) }, [
      "|店裡的電視播著舞蹈比賽。麗華看了一眼，就把視線移開。",
      "|旁邊的客人小聲說：「那不是『假傷退團』的那個首席嗎？」",
      "|麗華放下筷子，安靜地付了錢。"
    ], [{ t: "請那位客人小聲一點", fx: { aff: A("reika", 6) } }, { t: "追出去送她一包點心", fx: { aff: A("reika", 4) } }]),
    S("reika_04", ["reika"], "visit", { seen: ["reika_03", "dance_01"], aff: A("reika", 15) }, [
      "reika|「我沒有裝病。」",
      "reika|「首演前一週，我在排練時摔下舞台。醫生說韌帶斷了，至少休息一年。」",
      "reika|「可是團裡對外說，我是『假裝受傷、臨陣脫逃』。」"
    ], [{ t: "「為什麼要這樣說？」", fx: { aff: A("reika", 4), flag: ["reika_truth"] } }, { t: "「我相信妳。」", fx: { aff: A("reika", 6) } }]),
    S("reika_05", ["reika"], "visit", { seen: ["reika_04"], aff: A("reika", 20) }, [
      "|麗華把一張 X 光片放在吧台上。",
      "reika|「這是證據。我一直沒拿出來。」",
      "reika|「如果公開，團長會被追究。她把我從十五歲帶大……我做不到。」"
    ], [{ t: "「妳想保護她。」", fx: { aff: A("reika", 5), link: [["reika", "miyabi", "boss"]] } }, { t: "「可是妳的名譽呢？」", fx: { aff: A("reika", 3), flag: ["reika_xray"] } }]),
    S("reika_06", ["reika"], "close", { seen: ["reika_05"], aff: A("reika", 25) }, [
      "|打烊後，麗華在空蕩蕩的店裡，慢慢踮起腳尖。",
      "|一個小小的旋轉。她扶住吧台，咬著嘴唇。",
      "reika|「……還轉得動。原來還轉得動。」"
    ], [{ t: "為她鼓掌", fx: { aff: A("reika", 6) } }, { t: "「別勉強。」", fx: { aff: A("reika", 3) } }]),
    S("reika_07", ["reika"], "visit", { seen: ["reika_06"], aff: A("reika", 30), staff: "mai" }, [
      "|店員舞端著盤子走出來，看到麗華的瞬間，盤子掉在地上。",
      "mai|「麗華姐！我一直在找妳！醜聞那天晚上……我看到了！」",
      "reika|「舞……妳不該來的。」"
    ], [{ t: "讓舞說下去", fx: { arc: { dance: 1 }, link: [["reika", "mai", "friend"]] } }, { t: "先讓兩人到角落坐", fx: { aff: A("reika", 3), arc: { dance: 1 } } }]),
    S("reika_08", ["reika"], "visit", { seen: ["reika_06", "dance_03"], aff: A("reika", 35) }, [
      "reika|「商店街要辦慈善公演。鈴問我……要不要上台。」",
      "reika|「我一年沒跳了。腳也還沒完全好。」",
      "|她握著茶杯的手，在發抖，也在發燙。"
    ], [{ t: "「跳吧。我們都會去看。」", fx: { aff: A("reika", 6), arc: { dance: 1 } } }, { t: "「等腳好了再說。」", fx: { aff: A("reika", 3) } }]),
    S("reika_09", ["reika"], "close", { seen: ["reika_08", "dance_05"], aff: A("reika", 40) }, [
      "|公演結束的夜晚。麗華的腳踝又腫了，臉上卻是笑的。",
      "reika|「掌聲……我以為這輩子再也聽不到了。」"
    ], [{ t: "替她冰敷", fx: { aff: A("reika", 8) } }]),
    S("reika_10", ["reika"], "visit", { seen: ["reika_09", "dance_07"], aff: A("reika", 45) }, [
      "reika|「我決定了，開一間小小的舞蹈教室。」",
      "reika|「教小朋友，也教想重新開始的大人。」",
      "reika|「第一個學生……老闆，你要不要來？」"
    ], [{ t: "「我會努力不踩到妳的腳。」", fx: { aff: A("reika", 10), rep: 5 } }]),

    // ======================= 天城 雅（舞團團長：鐵腕背後的交易）=======================
    S("miyabi_01", ["miyabi"], "visit", { day: [6, 30] }, [
      "|一位氣場凌厲的中年女性，看都沒看菜單就點了冷酒。",
      "miyabi|「生的不要。熟的，清淡的。快一點。」"
    ], [{ t: "迅速端上湯豆腐", fx: { aff: A("miyabi", 5) } }, { t: "「慢工出細活喔。」", fx: { aff: A("miyabi", 1) } }]),
    S("miyabi_02", ["miyabi"], "visit", { seen: ["miyabi_01"], aff: A("miyabi", 5) }, [
      "miyabi|「我經營一個舞團。三十個舞者的生計，在我一個人肩上。」",
      "miyabi|「藝術？那是有錢人的玩具。我們需要的是贊助商。」"
    ], [{ t: "「辛苦了。」", fx: { aff: A("miyabi", 4) } }, { t: "「舞者們也是這樣想嗎？」", fx: { aff: A("miyabi", 2) } }]),
    S("miyabi_03", ["miyabi"], "visit", { seen: ["miyabi_02"], aff: A("miyabi", 10) }, [
      "|雅的手機響個不停。螢幕上顯示：『鷹司集團 文化事業部』。",
      "miyabi|「……是，下季的公演一定照計畫。不會再有『意外』。」",
      "|她掛掉電話，一口喝乾了酒。"
    ], [{ t: "再倒一杯", fx: { aff: A("miyabi", 4) } }, { t: "「贊助商很嚴格？」", fx: { aff: A("miyabi", 3), flag: ["miyabi_sponsor"] } }]),
    S("miyabi_04", ["miyabi"], "visit", { seen: ["miyabi_03", "dance_01"], aff: A("miyabi", 15) }, [
      "miyabi|「麗華在這裡……我早就知道。」",
      "miyabi|「那孩子十五歲進團，我教她每一個動作。」",
      "|她的聲音，第一次沒有稜角。"
    ], [{ t: "「為什麼不去跟她說話？」", fx: { aff: A("miyabi", 4) } }, { t: "靜靜聽她說", fx: { aff: A("miyabi", 4) } }]),
    S("miyabi_05", ["miyabi"], "visit", { seen: ["miyabi_04"], aff: A("miyabi", 20) }, [
      "miyabi|「贊助合約裡有一條：『主角在公演前受傷，贊助全數撤回。』」",
      "miyabi|「麗華受傷那天，我只剩一個選擇——說她是裝病，是她自己逃走。」",
      "miyabi|「這樣算『違約的是舞者』，不是舞團。三十個人的飯碗保住了。」"
    ], [{ t: "「妳犧牲了她。」", fx: { aff: A("miyabi", 2), flag: ["miyabi_clause"] } }, { t: "「妳一直很痛苦吧。」", fx: { aff: A("miyabi", 6), flag: ["miyabi_clause"] } }]),
    S("miyabi_06", ["miyabi"], "close", { seen: ["miyabi_05"], aff: A("miyabi", 25) }, [
      "|打烊後，雅一個人留下來，看著手機裡的舊照片。",
      "|照片裡，十五歲的麗華穿著不合身的舞衣，笑得很燦爛。",
      "miyabi|「……我是個很差勁的老師。」"
    ], [{ t: "「現在還來得及。」", fx: { aff: A("miyabi", 6) } }, { t: "陪她坐到天亮", fx: { aff: A("miyabi", 5) } }]),
    S("miyabi_07", ["miyabi"], "visit", { seen: ["miyabi_06"], aff: A("miyabi", 30), present: ["miyabi", "ayano"] }, [
      "|角落的綾乃站起來，走到雅的身邊。",
      "ayano|「天城團長。下一季的贊助，我們打算撤回。」",
      "ayano|「月見橫丁的再開發，需要那筆預算。」",
      "|雅的臉色瞬間發白。"
    ], [{ t: "替雅說話", fx: { aff: A("miyabi", 6), link: [["miyabi", "ayano", "debt"]] } }, { t: "「兩位到外面談吧。」", fx: { link: [["miyabi", "ayano", "debt"]], arc: { dance: 1 } } }]),
    S("miyabi_08", ["miyabi"], "holiday", { seen: ["miyabi_06"], aff: A("miyabi", 35), arc: { dance: 3 } }, [
      "|公休日，雅來找你，手上拿著一份記者會的稿子。",
      "miyabi|「我要公開真相。舞團可能會倒，我也會被罵。」",
      "miyabi|「可是我不想讓那孩子，再背著這個汙名活下去。」"
    ], [{ t: "「我陪妳去。」", fx: { aff: A("miyabi", 8), arc: { dance: 1 } } }, { t: "「先跟麗華說吧。」", fx: { aff: A("miyabi", 5), arc: { dance: 1 } } }]),
    S("miyabi_09", ["miyabi"], "visit", { seen: ["miyabi_08", "dance_06"], aff: A("miyabi", 40) }, [
      "miyabi|「舞團沒倒。商店街的人，一個一個來買公演的票。」",
      "miyabi|「三十個舞者說，薪水少一點沒關係。」",
      "|她笑了，笑得有點笨拙。"
    ], [{ t: "「乾杯。」", fx: { aff: A("miyabi", 8) } }]),
    S("miyabi_10", ["miyabi"], "visit", { seen: ["miyabi_09"], aff: A("miyabi", 45) }, [
      "miyabi|「新公演的主角，我想請麗華回來。」",
      "miyabi|「她說要考慮。……也是，被我傷成那樣。」",
      "miyabi|「但我會等。這次，換我等她。」"
    ], [{ t: "「她一定會回來的。」", fx: { aff: A("miyabi", 10), rep: 5 } }]),

    // ======================= 一之瀨 沙耶（理財講師：被操控的誘餌）=======================
    S("saya_01", ["saya"], "visit", { day: [5, 30] }, [
      "|一位笑容甜美的女性，在每張桌上放了一張傳單：『免費理財講座 讓您的店面變成資產！』",
      "saya|「老闆也來聽聽看嘛～商店街的大家都報名了喔。」"
    ], [{ t: "收下傳單", fx: { aff: A("saya", 4) } }, { t: "「店裡不能發傳單喔。」", fx: { aff: A("saya", 1), rep: 1 } }]),
    S("saya_02", ["saya"], "visit", { seen: ["saya_01"], aff: A("saya", 4) }, [
      "saya|「老闆，你知道嗎？這一帶的地價，明年會翻倍喔。」",
      "saya|「與其守著小店，不如趁現在賣掉，拿去投資。」",
      "|她說得很順，像是背過很多次。"
    ], [{ t: "「我喜歡守著小店。」", fx: { aff: A("saya", 3) } }, { t: "「妳自己相信嗎？」", fx: { aff: A("saya", 2), flag: ["saya_doubt"] } }]),
    S("saya_03", ["saya"], "visit", { seen: ["saya_02"], aff: A("saya", 10) }, [
      "|講座結束後，沙耶一個人來到店裡，點了一杯梅酒。",
      "saya|「……今天又有一家老鋪簽約了。大家都很感謝我。」",
      "|她把梅酒一口喝完，眼眶紅紅的。"
    ], [{ t: "「妳不開心？」", fx: { aff: A("saya", 5) } }, { t: "再倒一杯", fx: { aff: A("saya", 3) } }]),
    S("saya_04", ["saya"], "visit", { seen: ["saya_03", "invest_01"], aff: A("saya", 15) }, [
      "saya|「我以前……是真的想幫人理財的。」",
      "saya|「三年前，我自己被騙光了積蓄，還欠了一大筆錢。」",
      "saya|「有人說，只要我幫忙開講座，債就一筆勾銷。」"
    ], [{ t: "「是誰？」", fx: { aff: A("saya", 4), flag: ["saya_who"] } }, { t: "「妳想脫身嗎？」", fx: { aff: A("saya", 5) } }]),
    S("saya_05", ["saya"], "visit", { seen: ["saya_04"], aff: A("saya", 20) }, [
      "|沙耶的手機跳出訊息：『本週還差三家，別讓我們失望。——鷹司不動產』",
      "saya|「……被你看到了。」",
      "saya|「我是鷹司集團的誘餌。讓店家心甘情願賣地，再蓋成大樓。」"
    ], [{ t: "「妳可以說出真相。」", fx: { aff: A("saya", 4), link: [["saya", "ayano", "boss"]] } }, { t: "「妳也是受害者。」", fx: { aff: A("saya", 6), link: [["saya", "ayano", "boss"]] } }]),
    S("saya_06", ["saya"], "close", { seen: ["saya_05"], aff: A("saya", 25) }, [
      "|打烊後，沙耶把一疊合約影本放在吧台上。",
      "saya|「這些是我經手的店。每一份的收購價，都被壓到市價的一半。」",
      "saya|「如果我拿出來……他們不會放過我。」"
    ], [{ t: "「我們會保護妳。」", fx: { aff: A("saya", 6), flag: ["saya_docs"] } }, { t: "「先交給可信的人保管。」", fx: { aff: A("saya", 5), flag: ["saya_docs"] } }]),
    S("saya_07", ["saya"], "visit", { seen: ["saya_06"], aff: A("saya", 30), present: ["saya", "chinatsu"] }, [
      "chinatsu|「沙耶老師！妳推薦的基金……全部歸零了！」",
      "chinatsu|「我把剩下的積蓄都押上去了啊！」",
      "|沙耶低著頭，一句話都說不出來。"
    ], [{ t: "攔住千夏", fx: { aff: A("saya", 4), arc: { invest: 1 } } }, { t: "讓沙耶自己說", fx: { aff: A("chinatsu", 3), arc: { invest: 1 }, link: [["saya", "chinatsu", "debt"]] } }]),
    S("saya_08", ["saya"], "close", { seen: ["saya_06"], aff: A("saya", 35), arc: { invest: 3 } }, [
      "|打烊後，沙耶穿著樸素的套裝留了下來。",
      "saya|「明天商店街開會。我要在大家面前，把一切說出來。」",
      "saya|「可以……在後面看著我嗎？」"
    ], [{ t: "「我會坐在第一排。」", fx: { aff: A("saya", 8), arc: { invest: 1 } } }, { t: "「我把千夏也叫來。」", fx: { aff: A("saya", 5), arc: { invest: 1 } } }]),
    S("saya_09", ["saya"], "visit", { seen: ["saya_08", "invest_06"], aff: A("saya", 40) }, [
      "saya|「我把講座的錢，一家一家還回去了。」",
      "saya|「被罵、被潑水……可是，好輕鬆。」",
      "|她第一次，笑得沒有任何計算。"
    ], [{ t: "「妳很勇敢。」", fx: { aff: A("saya", 8) } }]),
    S("saya_10", ["saya"], "visit", { seen: ["saya_09"], aff: A("saya", 45) }, [
      "saya|「我重新開了理財講座。這次是真的免費。」",
      "saya|「第一堂課的主題是：『如何不被我這種人騙』。」",
      "|商店街的人笑成一片。"
    ], [{ t: "「我會去聽。」", fx: { aff: A("saya", 10), rep: 5 } }]),

    // ======================= 鷹司 綾乃（集團專務：拆不掉的地方）=======================
    S("ayano_01", ["ayano"], "visit", { day: [4, 30] }, [
      "|一位穿著名牌大衣的女性，挑了吧台最角落的位子。",
      "ayano|「……不要多問。上菜就好。」",
      "|她吃得很慢，好像在記住每一口的味道。"
    ], [{ t: "安靜地上菜", fx: { aff: A("ayano", 5) } }, { t: "「好吃嗎？」", fx: { aff: A("ayano", 2) } }]),
    S("ayano_02", ["ayano"], "visit", { seen: ["ayano_01"], aff: A("ayano", 5) }, [
      "ayano|「這家店，二十年前就在了吧。」",
      "ayano|「我小時候……來過一次。那時候的老闆，做了一道很好吃的燉菜。」",
      "|她說完，自己愣了一下，像是說溜了嘴。"
    ], [{ t: "「那是我師父。」", fx: { aff: A("ayano", 4), flag: ["ayano_kid"] } }, { t: "「歡迎回來。」", fx: { aff: A("ayano", 5) } }]),
    S("ayano_03", ["ayano"], "visit", { seen: ["ayano_02", "will_01"], aff: A("ayano", 10) }, [
      "ayano|「沒錯，我就是主導再開發的人。你們想罵就罵吧。」",
      "ayano|「這條街老舊、危險、沒有未來。我只是做該做的事。」",
      "|她說得很硬，手卻緊緊握著杯子。"
    ], [{ t: "「那妳為什麼每晚都來？」", fx: { aff: A("ayano", 5), flag: ["ayano_why"] } }, { t: "「我會守住這家店。」", fx: { aff: A("ayano", 2) } }]),
    S("ayano_04", ["ayano"], "visit", { seen: ["ayano_03"], aff: A("ayano", 15) }, [
      "ayano|「我父親……從來沒有稱讚過我。」",
      "ayano|「澄香什麼都不用做，就是他的寶貝。我做到死，也只是『專務』。」",
      "ayano|「再開發成功的話，他說不定會看我一眼。」"
    ], [{ t: "「妳很寂寞吧。」", fx: { aff: A("ayano", 6) } }, { t: "「妳不需要他的認可。」", fx: { aff: A("ayano", 4) } }]),
    S("ayano_05", ["ayano"], "visit", { seen: ["ayano_04"], aff: A("ayano", 20) }, [
      "ayano|「父親病倒了。醫生說，撐不過這個冬天。」",
      "ayano|「律師說，遺囑已經寫好了。可是內容……不讓我看。」",
      "|她第一次，在你面前喝醉了。"
    ], [{ t: "叫計程車送她回家", fx: { aff: A("ayano", 5) } }, { t: "讓她在店裡睡一會兒", fx: { aff: A("ayano", 6) } }]),
    S("ayano_06", ["ayano"], "close", { seen: ["ayano_05", "will_03"], aff: A("ayano", 25) }, [
      "ayano|「遺囑裡寫的繼承人，不是我，也不是澄香。」",
      "ayano|「是一個叫『藤堂 凜』的人。我連聽都沒聽過。」",
      "ayano|「我到底……算什麼？」"
    ], [{ t: "「妳就是妳。」", fx: { aff: A("ayano", 6) } }, { t: "「一起查清楚吧。」", fx: { aff: A("ayano", 4), arc: { will: 1 } } }]),
    S("ayano_07", ["ayano"], "visit", { seen: ["ayano_06"], aff: A("ayano", 30), arc: { master: 2 } }, [
      "ayano|「我翻了父親的舊資料。二十年前，有一家料亭『月見』燒掉了。」",
      "ayano|「那塊地……後來變成了集團的第一棟大樓。」",
      "ayano|「火災報告上寫著：『店主失蹤，妻子身亡』。店主的名字，是鷹司 宗介——我父親的哥哥。」"
    ], [{ t: "「我師父……是妳的伯父？」", fx: { aff: A("ayano", 5), arc: { master: 1 }, flag: ["ayano_fire"] } }]),
    S("ayano_08", ["ayano"], "holiday", { seen: ["ayano_07"], aff: A("ayano", 35) }, [
      "|公休日，綾乃約你在月見橫丁的入口見面。",
      "ayano|「我取消了下週的收購簽約。」",
      "ayano|「父親會氣瘋吧。……可是，我不想再拆掉任何人的家了。」"
    ], [{ t: "「謝謝妳。」", fx: { aff: A("ayano", 8), flag: ["will_stop"], rep: 5 } }, { t: "陪她走完整條街", fx: { aff: A("ayano", 8), flag: ["will_stop"] } }]),
    S("ayano_09", ["ayano"], "visit", { seen: ["ayano_08", "will_05"], aff: A("ayano", 40) }, [
      "ayano|「澄香跟藤堂 凜……是雙胞胎。是伯父的女兒。」",
      "ayano|「我才是父親的親生女兒，卻什麼都不是。」",
      "ayano|「……奇怪，知道了反而輕鬆。我終於可以做自己了。」"
    ], [{ t: "替她倒一杯", fx: { aff: A("ayano", 8) } }]),
    S("ayano_10", ["ayano"], "visit", { seen: ["ayano_09"], aff: A("ayano", 45) }, [
      "ayano|「我辭掉專務了。」",
      "ayano|「接下來，我想做月見橫丁的『修復計畫』。不拆，只修。」",
      "ayano|「第一個要修的，是這家店漏水的屋頂。」"
    ], [{ t: "「拜託了，專務大人。」", fx: { aff: A("ayano", 10), rep: 8 } }]),

    // ======================= 鷹司 澄香（籠中千金：身世之謎）=======================
    S("sumika_01", ["sumika"], "visit", { day: [5, 30] }, [
      "|一位穿著洋裝的女孩怯生生地推開門，像是第一次走進居酒屋。",
      "sumika|「請、請問……這裡要怎麼點菜？」",
      "|她說這是她第一次，一個人出門。"
    ], [{ t: "耐心教她點菜", fx: { aff: A("sumika", 5) } }, { t: "「交給我吧。」", fx: { aff: A("sumika", 4) } }]),
    S("sumika_02", ["sumika"], "visit", { seen: ["sumika_01"], aff: A("sumika", 5) }, [
      "sumika|「我對海鮮過敏……家裡的廚師都知道，可是外面的人不知道。」",
      "sumika|「原來在外面，要自己說出來才行。」",
      "|她說得很認真，像在學習一件很重要的事。"
    ], [{ t: "「說出來就好。」", fx: { aff: A("sumika", 5) } }, { t: "替她做一道沒有海鮮的菜", fx: { aff: A("sumika", 5) } }]),
    S("sumika_03", ["sumika"], "visit", { seen: ["sumika_02"], aff: A("sumika", 10) }, [
      "sumika|「我其實……不是爸爸的親生女兒。」",
      "sumika|「小時候不小心聽到的。可是我不敢問。」",
      "sumika|「問了的話，好像什麼都會壞掉。」"
    ], [{ t: "「不管是誰的女兒，妳就是妳。」", fx: { aff: A("sumika", 6) } }, { t: "「想知道真相嗎？」", fx: { aff: A("sumika", 4), flag: ["sumika_ask"] } }]),
    S("sumika_04", ["sumika"], "visit", { seen: ["sumika_03", "will_02"], aff: A("sumika", 15) }, [
      "sumika|「綾乃姊姊討厭我。我知道。」",
      "sumika|「爸爸把我寵成這樣，她卻什麼都得不到。」",
      "sumika|「如果可以，我想把我有的東西，全部分給她。」"
    ], [{ t: "「去跟她說吧。」", fx: { aff: A("sumika", 5) } }, { t: "「妳們都沒有錯。」", fx: { aff: A("sumika", 5) } }]),
    S("sumika_05", ["sumika"], "visit", { seen: ["sumika_04"], aff: A("sumika", 20) }, [
      "|澄香拿出一張很舊的照片：兩個一模一樣的嬰兒，躺在同一個搖籃裡。",
      "sumika|「在爸爸的保險箱裡找到的。背面寫著：『澄香與凜』。」",
      "sumika|「我……有一個雙胞胎姊妹？」"
    ], [{ t: "「我好像認識一個叫凜的人。」", fx: { aff: A("sumika", 4), flag: ["will_twin"], arc: { will: 1 } } }, { t: "「我們一起找她。」", fx: { aff: A("sumika", 6), flag: ["will_twin"], arc: { will: 1 } } }]),
    S("sumika_06", ["sumika"], "close", { seen: ["sumika_05"], aff: A("sumika", 25) }, [
      "|打烊後，澄香說她不想回家。",
      "sumika|「家裡好大，可是好冷。這裡好小，可是好暖。」",
      "sumika|「……我可以在這裡，多待一下嗎？」"
    ], [{ t: "泡一杯熱可可給她", fx: { aff: A("sumika", 6) } }, { t: "「下次白天來幫忙吧。」", fx: { aff: A("sumika", 5) } }]),
    S("sumika_07", ["sumika"], "visit", { seen: ["sumika_06", "will_05"], aff: A("sumika", 30) }, [
      "sumika|「我的親生爸爸……是二十年前失蹤的料亭主人。」",
      "sumika|「也就是說，你的師父，是我的爸爸。」",
      "sumika|「這家店……原來是爸爸的味道。」"
    ], [{ t: "端上師父的招牌菜", fx: { aff: A("sumika", 8), arc: { master: 1 } } }]),
    S("sumika_08", ["sumika"], "holiday", { seen: ["sumika_07"], aff: A("sumika", 35) }, [
      "|公休日，澄香穿著工作服來店裡。",
      "sumika|「我想學做菜。爸爸的菜。」",
      "|她握刀的手笨拙，眼神卻很認真。"
    ], [{ t: "從切蔥開始教她", fx: { aff: A("sumika", 8) } }, { t: "「先從洗碗開始喔。」", fx: { aff: A("sumika", 6) } }]),
    S("sumika_09", ["sumika"], "visit", { seen: ["sumika_08", "master_06"], aff: A("sumika", 40) }, [
      "sumika|「我見到爸爸了。他想起來了……他叫了我的名字。」",
      "sumika|「凜也在。我們兩個，抱著爸爸哭了好久。」",
      "|她哭著笑著，把一盒手做便當推給你。"
    ], [{ t: "收下便當", fx: { aff: A("sumika", 10) } }]),
    S("sumika_10", ["sumika"], "visit", { seen: ["sumika_09"], aff: A("sumika", 45) }, [
      "sumika|「我決定不繼承集團了。那個位子，給想守護這條街的人。」",
      "sumika|「我想在這裡，跟爸爸、凜、還有你，一起做菜。」",
      "|她第一次，自己點了一杯酒。"
    ], [{ t: "「乾杯。」", fx: { aff: A("sumika", 10), rep: 8 } }]),

    // ======================= 霧島 千鶴（老料亭女將：等了二十年的人）=======================
    S("chizuru_01", ["chizuru"], "visit", { day: [6, 30] }, [
      "|一位穿著和服的女性，優雅地坐上吧台。",
      "|她嚐了一口煮物，筷子停在半空中。",
      "chizuru|「……這個高湯的取法，你跟誰學的？」"
    ], [{ t: "「跟我師父。」", fx: { aff: A("chizuru", 5), flag: ["chizuru_dashi"] } }, { t: "「自己琢磨的。」", fx: { aff: A("chizuru", 2) } }]),
    S("chizuru_02", ["chizuru"], "visit", { seen: ["chizuru_01"], aff: A("chizuru", 5) }, [
      "chizuru|「我在隔壁街開了一家老料亭『霧島』。三代了。」",
      "chizuru|「年輕的時候，跟一個很會做菜的男人，比過好多次手藝。」",
      "|她說到「男人」兩個字的時候，聲音輕了下去。"
    ], [{ t: "「誰贏了？」", fx: { aff: A("chizuru", 4) } }, { t: "「那個人現在呢？」", fx: { aff: A("chizuru", 3) } }]),
    S("chizuru_03", ["chizuru"], "visit", { seen: ["chizuru_02", "master_01"], aff: A("chizuru", 10) }, [
      "chizuru|「我店裡有個廚師，大家叫他源先生。」",
      "chizuru|「二十年前，我在河邊撿到他。他什麼都不記得，只記得怎麼做菜。」",
      "chizuru|「他的菜，跟你的菜……味道好像。」"
    ], [{ t: "「可以見見他嗎？」", fx: { aff: A("chizuru", 4), flag: ["chizuru_gen"] } }, { t: "「真是巧。」", fx: { aff: A("chizuru", 3), flag: ["chizuru_gen"] } }]),
    S("chizuru_04", ["chizuru"], "visit", { seen: ["chizuru_03"], aff: A("chizuru", 15) }, [
      "|千鶴從懷裡拿出一本燒焦的筆記本——料理帳的封面。",
      "chizuru|「源先生被撿到的時候，緊緊抱著這個。」",
      "chizuru|「裡面缺了好幾頁。他說，找回那些頁，也許就能想起來。」"
    ], [{ t: "「我這裡有幾頁！」", fx: { aff: A("chizuru", 6), arc: { master: 1 } } }, { t: "「我會幫忙找。」", fx: { aff: A("chizuru", 5), arc: { master: 1 } } }]),
    S("chizuru_05", ["chizuru"], "visit", { seen: ["chizuru_04"], aff: A("chizuru", 20) }, [
      "chizuru|「我很早就猜到了。源先生，就是『月見』的宗介。」",
      "chizuru|「我沒有告訴任何人。因為……他忘了他的妻子，卻記得我。」",
      "chizuru|「我是不是很卑鄙？」"
    ], [{ t: "「妳只是不想失去他。」", fx: { aff: A("chizuru", 6), link: [["chizuru", "ayano", "secret"]] } }, { t: "「該讓他想起來了。」", fx: { aff: A("chizuru", 4) } }]),
    S("chizuru_06", ["chizuru"], "close", { seen: ["chizuru_05"], aff: A("chizuru", 25) }, [
      "|打烊後，千鶴在吧台上，仔細抄寫料理帳裡的每一道菜。",
      "chizuru|「最後一頁的菜叫『月見燉菜』。可是作法的最後一行，燒掉了。」",
      "chizuru|「只有宗介知道，最後放的是什麼。」"
    ], [{ t: "一起試做", fx: { aff: A("chizuru", 6), arc: { master: 1 } } }, { t: "「答案也許在別的頁。」", fx: { aff: A("chizuru", 4), arc: { master: 1 } } }]),
    S("chizuru_07", ["chizuru"], "visit", { seen: ["chizuru_06"], aff: A("chizuru", 30), present: ["chizuru", "ayano"] }, [
      "|綾乃看到千鶴，猛地站了起來。",
      "ayano|「霧島女將……二十年前，火災那晚，妳也在現場吧。」",
      "chizuru|「……我在。我看到了，放火的人穿著鷹司家的外套。」",
      "|店裡一片死寂。"
    ], [{ t: "讓兩人把話說完", fx: { arc: { master: 1 }, link: [["chizuru", "ayano", "secret"]] } }, { t: "先請其他客人離開", fx: { rep: -2, arc: { master: 1 } } }]),
    S("chizuru_08", ["chizuru"], "holiday", { seen: ["chizuru_07"], aff: A("chizuru", 35) }, [
      "|公休日，千鶴帶你去看「月見」的舊址。現在是一棟玻璃大樓。",
      "chizuru|「以前這裡有一棵很大的櫻花樹。宗介說，要在樹下開一輩子的店。」"
    ], [{ t: "牽起她的手", fx: { aff: A("chizuru", 8) } }, { t: "「我會替師父，把店開下去。」", fx: { aff: A("chizuru", 8) } }]),
    S("chizuru_09", ["chizuru"], "visit", { seen: ["chizuru_08", "master_06"], aff: A("chizuru", 40) }, [
      "chizuru|「宗介想起來了。全部。」",
      "chizuru|「他想起了妻子……也想起了我。他說，謝謝我這二十年。」",
      "chizuru|「……這樣就夠了。真的，這樣就夠了。」"
    ], [{ t: "陪她喝一杯", fx: { aff: A("chizuru", 10) } }]),
    S("chizuru_10", ["chizuru"], "visit", { seen: ["chizuru_09"], aff: A("chizuru", 45) }, [
      "chizuru|「『霧島』和這家店，以後一起辦季節宴席吧。」",
      "chizuru|「老料亭和深夜居酒屋。宗介一定會很高興。」",
      "|她笑得像個少女。"
    ], [{ t: "「一言為定。」", fx: { aff: A("chizuru", 10), rep: 8 } }])
  ]);
})();
