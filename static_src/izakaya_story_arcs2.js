// 深夜居酒屋（izakaya）：1b 事件線的多人場面（💃 舞團醜聞、📈 投資的心境、🏯 豪門遺囑、📖 師父的料理帳，各 7 段）。
// 主線揭曉：再開發的鷹司集團董事長宗一郎是師父（鷹司 宗介）的弟弟；二十年前料亭「月見」大火後師父失憶，
// 以「源先生」的名字在霧島千鶴的料亭當廚師；雙胞胎女兒澄香與凜被拆散。見計畫 2026-11-09-izakaya-1b.md。
// 公休日只在第 6／12／18／24 天之後，所以「大場面」用 day≥18 的公休日，之後的段落放在打烊（close）。
(function () {
  "use strict";
  function L(arr) { return arr.map(function (x) { var i = x.indexOf("|"); return [x.slice(0, i), x.slice(i + 1)]; }); }
  function S(id, who, arc, at, cond, lines, ch) { var o = { id: id, who: who, arc: arc, at: at, cond: cond, lines: L(lines), pri: 3 }; if (ch) o.ch = ch; return o; }
  function Ar(name) { var a = {}; a[name] = 1; return a; }

  window.PriTestIzakayaScenes = (window.PriTestIzakayaScenes || []).concat([
    // ======================= 💃 舞團醜聞 =======================
    S("dance_01", ["reika", "miyabi"], "dance", "visit", { seen: ["reika_03"], present: ["reika", "miyabi"] }, [
      "|門鈴響起。進門的天城 雅，和吧台的鳳 麗華四目相對。",
      "miyabi|「……麗華。」",
      "reika|「團長。好久不見。」",
      "|兩人之間隔著三個空位，卻像隔著一整個舞台。"
    ], [
      { t: "把兩人的酒放在一起", fx: { arc: Ar("dance"), link: [["reika", "miyabi", "boss"]] } },
      { t: "讓她們保持距離", fx: { arc: Ar("dance") } }
    ]),
    S("dance_02", ["ran", "reika"], "dance", "visit", { flag: ["ran_dance"], seen: ["reika_03"] }, [
      "ran|「老闆，我在追的『假傷退團』……主角常來你的店吧？」",
      "ran|「舞團說她裝病，可是醫院有她的掛號紀錄。這不合理。」",
      "|蘭的眼睛裡，又燃起了記者的火。"
    ], [
      { t: "「真相要由她自己說。」", fx: { arc: Ar("dance"), aff: { reika: 4 } } },
      { t: "「妳去問團長吧。」", fx: { arc: Ar("dance"), link: [["ran", "miyabi", "rival"]] } }
    ]),
    S("dance_03", ["reika"], "dance", "close", { seen: ["reika_05"], arc: { dance: 1 } }, [
      "|打烊後，麗華和你把 X 光片、醫院收據、排練表攤在吧台上。",
      "reika|「全部都在。我受傷是真的。」",
      "reika|「可是我還是不知道……團長為什麼要那樣說。」"
    ], [
      { t: "「去問她吧。」", fx: { arc: Ar("dance") } },
      { t: "「我們一起找答案。」", fx: { arc: Ar("dance"), aff: { reika: 3 } } }
    ]),
    S("dance_04", ["miyabi"], "dance", "visit", { seen: ["miyabi_05"], arc: { dance: 2 } }, [
      "miyabi|「那份贊助合約……是鷹司集團的。」",
      "miyabi|「他們要用『文化街區』當再開發的招牌。舞團是門面，麗華是門面的門面。」",
      "miyabi|「門面受傷了，他們就要撤資。所以我……把她變成了『逃兵』。」"
    ], [
      { t: "「說出來吧，在大家面前。」", fx: { arc: Ar("dance"), link: [["miyabi", "ayano", "debt"]] } },
      { t: "「先跟麗華道歉。」", fx: { arc: Ar("dance"), aff: { miyabi: 4 } } }
    ]),
    S("dance_05", ["reika", "miyabi"], "dance", "holiday", { arc: { dance: 4 }, seen: ["dance_04"], day: [18, 30] }, [
      "|月見橫丁慈善公演。商店街的廣場上，鋪著臨時搭的木地板。",
      "|麗華穿著一年沒碰的舞衣，站在燈光下。腳踝纏著繃帶。",
      "|音樂響起。第一個迴旋，她晃了一下——然後穩穩地站住了。",
      "|台下，雅用手摀住了嘴。"
    ], [
      { t: "帶頭鼓掌", fx: { arc: Ar("dance"), rep: 10 } },
      { t: "看向雅", fx: { arc: Ar("dance"), aff: { miyabi: 5 } } }
    ]),
    S("dance_06", ["miyabi"], "dance", "close", { seen: ["dance_05"] }, [
      "|公演結束的夜晚，雅在店門口，對著蘭的錄音筆鞠躬。",
      "miyabi|「鳳 麗華沒有裝病。說謊的人，是我。」",
      "miyabi|「為了保住贊助，我毀了一個舞者的名譽。我在這裡，向她、向所有人道歉。」",
      "|隔天的週刊頭條：『月華舞踊團 團長自白』。"
    ], [{ t: "替雅倒最後一杯酒", fx: { arc: Ar("dance"), rep: 10 } }]),
    S("dance_07", ["reika", "miyabi"], "dance", "visit", { seen: ["dance_06"], present: ["reika", "miyabi"] }, [
      "|麗華坐到了雅的旁邊。中間沒有空位了。",
      "reika|「團長。我不原諒妳。」",
      "reika|「……可是，我想再站上妳的舞台。」",
      "|雅低著頭，肩膀一直在抖。"
    ], [{ t: "端上兩碗熱湯", fx: { arc: Ar("dance"), aff: { reika: 5, miyabi: 5 }, link: [["reika", "miyabi", "friend"]] } }]),

    // ======================= 📈 投資的心境 =======================
    S("invest_01", ["saya"], "invest", "visit", { seen: ["saya_02"] }, [
      "|理財講座的傳單，貼滿了商店街的布告欄。",
      "|千夏、鈴的爸媽、隔壁的魚店老闆……大家都在討論「賣地投資」。",
      "saya|「月見橫丁的大家，要變成有錢人囉～」"
    ], [{ t: "「先別急著簽約。」", fx: { arc: Ar("invest"), rep: 2 } }, { t: "觀察沙耶的表情", fx: { arc: Ar("invest"), flag: ["saya_doubt"] } }]),
    S("invest_02", ["chinatsu", "saya"], "invest", "visit", { seen: ["invest_01"], present: ["chinatsu", "saya"] }, [
      "chinatsu|「沙耶老師！妳推薦的那個基金，我想加碼！」",
      "saya|「……千夏小姐，妳確定嗎？那個風險……」",
      "chinatsu|「怕什麼！我上次賠的，這次一口氣賺回來！」",
      "|沙耶的笑容，僵了一瞬間。"
    ], [{ t: "勸千夏冷靜", fx: { arc: Ar("invest"), aff: { chinatsu: 3 } } }, { t: "看沙耶怎麼回答", fx: { arc: Ar("invest"), link: [["chinatsu", "saya", "debt"]] } }]),
    S("invest_03", ["rin"], "invest", "visit", { seen: ["invest_01", "rin_05"] }, [
      "rin|「老闆……爸爸媽媽說，要把店賣了。」",
      "rin|「講座的老師說，現在賣最划算。賣了錢可以投資，以後就不用那麼辛苦。」",
      "rin|「可是那是爺爺的爺爺開的店啊……」"
    ], [{ t: "「我陪妳去跟爸媽談。」", fx: { arc: Ar("invest"), aff: { rin: 5 } } }, { t: "「先查清楚那個講座。」", fx: { arc: Ar("invest"), link: [["rin", "saya", "debt"]] } }]),
    S("invest_04", ["saya"], "invest", "close", { seen: ["saya_05"] }, [
      "|打烊後，沙耶把手機推到你面前。上面是一份名單：月見橫丁的每一家店，旁邊標著「已簽」「未簽」。",
      "saya|「鷹司不動產要我在年底前，讓這張表全部變成『已簽』。」",
      "saya|「你的店……是最後一家。」"
    ], [{ t: "「我不會賣。」", fx: { arc: Ar("invest"), aff: { saya: 3 } } }, { t: "「妳想讓它全部變成『已簽』嗎？」", fx: { arc: Ar("invest"), aff: { saya: 5 } } }]),
    S("invest_05", ["rin"], "invest", "visit", { seen: ["invest_03"], arc: { invest: 3 } }, [
      "rin|「老闆！爸爸媽媽明天就要簽約了！」",
      "rin|「店員的結衣小姐說，那份合約的收購價，只有市價的一半！」",
      "|鈴手裡抓著一份用紅筆畫滿記號的合約影本。"
    ], [{ t: "衝去和菓子店阻止簽約", fx: { arc: Ar("invest"), rep: 3 } }, { t: "「請沙耶出面說清楚。」", fx: { arc: Ar("invest"), aff: { saya: 3 } } }]),
    S("invest_06", ["saya"], "invest", "holiday", { seen: ["saya_08"], arc: { invest: 5 }, day: [18, 30] }, [
      "|商店街的緊急會議。公民館裡擠滿了人。",
      "|沙耶站上講台，手上拿著那疊合約影本。",
      "saya|「我是鷹司不動產雇來的。這些收購價，全部是騙局。」",
      "saya|「對不起。……真的，對不起。」",
      "|會場一片譁然。然後，有人開始拍手。"
    ], [{ t: "第一個站起來拍手", fx: { arc: Ar("invest"), rep: 10, aff: { saya: 6 } } }]),
    S("invest_07", ["saya", "chinatsu"], "invest", "visit", { seen: ["invest_06"], present: ["saya", "chinatsu"] }, [
      "chinatsu|「沙耶。我賠掉的錢，妳不用還。」",
      "chinatsu|「是我自己貪心。投資就是這樣，輸了要認。」",
      "chinatsu|「不過……下次的講座，記得教我怎麼不貪心。」",
      "|沙耶哭著笑了。"
    ], [{ t: "請兩人喝一杯", fx: { arc: Ar("invest"), aff: { saya: 4, chinatsu: 4 }, link: [["saya", "chinatsu", "friend"]] } }]),

    // ======================= 🏯 豪門遺囑 =======================
    S("will_01", ["ayano"], "will", "visit", { seen: ["ayano_02"] }, [
      "|電視新聞：『鷹司集團 月見橫丁再開發計畫 由專務鷹司綾乃主導』。",
      "|畫面上的女人，就是每晚坐在角落的那位客人。",
      "|店裡的常客們，一起轉頭看向她。"
    ], [{ t: "「在我的店裡，她只是客人。」", fx: { arc: Ar("will"), aff: { ayano: 5 } } }, { t: "什麼都不說", fx: { arc: Ar("will") } }]),
    S("will_02", ["sumika", "ayano"], "will", "visit", { seen: ["sumika_02"], present: ["sumika", "ayano"] }, [
      "ayano|「……澄香？妳怎麼會在這種地方？」",
      "sumika|「綾乃姊姊……」",
      "ayano|「回家。父親知道妳一個人跑出來，會怎麼想？」",
      "|澄香低著頭，卻沒有站起來。"
    ], [
      { t: "「讓她吃完這一餐吧。」", fx: { arc: Ar("will"), link: [["ayano", "sumika", "sister"]] } },
      { t: "讓姊妹自己談", fx: { arc: Ar("will"), link: [["ayano", "sumika", "sister"]] } }
    ]),
    S("will_03", ["ayano"], "will", "close", { seen: ["ayano_05"] }, [
      "|打烊後，一位西裝律師來店裡找綾乃。",
      "|「鷹司專務。董事長的遺囑，下個月公開。繼承人的名字是——」",
      "|律師看了你一眼，壓低聲音。綾乃的臉，瞬間失去了血色。"
    ], [{ t: "倒一杯熱茶給她", fx: { arc: Ar("will"), flag: ["will_name"] } }]),
    S("will_04", ["sumika"], "will", "visit", { seen: ["will_03", "sumika_03"] }, [
      "sumika|「遺囑上的名字，是『藤堂 凜』。」",
      "sumika|「照片背面寫著『澄香與凜』。……那個凜，就是她吧？」",
      "|你想起懷錶上刻著家紋的那位冷面女子。"
    ], [
      { t: "「我認識一位叫藤堂凜的人。」", fx: { arc: Ar("will"), link: [["sumika", "rin_t", "sister"]] } },
      { t: "「我幫妳找她。」", fx: { arc: Ar("will"), link: [["sumika", "rin_t", "sister"]] } }
    ]),
    S("will_05", ["ayano", "sumika"], "will", "holiday", { arc: { will: 3 }, seen: ["will_04"], day: [18, 30] }, [
      "|鷹司集團總部，遺囑公開的會議室。綾乃、澄香，還有你帶來的藤堂 凜。",
      "|律師念出遺囑：『繼承人藤堂凜、鷹司澄香，皆為吾兄鷹司宗介之女。』",
      "|『二十年前月見之火，吾見而未救。為奪其地，吾奪其家。此罪，吾以全部財產償還。』",
      "|凜握著懷錶，澄香握著凜的手。綾乃站在窗邊，一動也不動。"
    ], [
      { t: "走到綾乃身邊", fx: { arc: Ar("will"), aff: { ayano: 6 } } },
      { t: "看著雙胞胎姊妹", fx: { arc: Ar("will"), aff: { sumika: 6 } } }
    ]),
    S("will_06", ["ayano"], "will", "close", { seen: ["will_05"] }, [
      "|打烊後，綾乃來了。她沒有點菜，只是坐著。",
      "ayano|「我是兇手的女兒。我主導的再開發，蓋在伯父的血淚上。」",
      "ayano|「……我該怎麼辦？」"
    ], [
      { t: "「把月見橫丁還給大家。」", fx: { arc: Ar("will"), flag: ["will_stop"], rep: 5 } },
      { t: "「先好好哭一場。」", fx: { arc: Ar("will"), aff: { ayano: 8 } } }
    ]),
    S("will_07", ["sumika", "ayano"], "will", "visit", { seen: ["will_06"], present: ["sumika", "ayano"] }, [
      "sumika|「綾乃姊姊。我們，還是姊妹吧？」",
      "ayano|「……我們沒有血緣關係。」",
      "sumika|「可是我們一起長大了二十年。這不是假的。」",
      "|綾乃轉過頭，用手背擦了擦眼睛。"
    ], [{ t: "端上三人份的料理", fx: { arc: Ar("will"), aff: { ayano: 5, sumika: 5 } } }]),

    // ======================= 📖 師父的料理帳 =======================
    S("master_01", ["chizuru"], "master", "visit", { seen: ["chizuru_02"] }, [
      "|千鶴嚐了一口你的關東煮，眼淚掉了下來。",
      "chizuru|「……這是『月見』的味道。二十年了，我以為再也吃不到了。」",
      "chizuru|「你的師父，是不是叫宗介？」"
    ], [{ t: "「您認識我師父？」", fx: { arc: Ar("master"), aff: { chizuru: 5 } } }]),
    S("master_02", ["chizuru"], "master", "close", { seen: ["chizuru_04"] }, [
      "|打烊後，千鶴說起二十年前的那一夜。",
      "chizuru|「宗介和他的妻子，在『月見』的樓上睡著。火是從後門燒起來的。」",
      "chizuru|「我趕到的時候，只看到宗介抱著料理帳，跳進了河裡。」"
    ], [{ t: "安靜地聽到最後", fx: { arc: Ar("master") } }]),
    S("master_03", ["ayano", "chizuru"], "master", "visit", { seen: ["ayano_04", "chizuru_04"] }, [
      "ayano|「父親的書房裡，有一張『月見』的舊照片。」",
      "ayano|「他每天晚上，都對著那張照片喝酒。」",
      "ayano|「我以為那是懷念。原來……是懺悔。」"
    ], [{ t: "「這件事，要讓師父知道。」", fx: { arc: Ar("master"), flag: ["master_photo"] } }]),
    S("master_04", ["chizuru"], "master", "close", { seen: ["chizuru_06"], arc: { master: 3 } }, [
      "|打烊後，你把找到的料理帳殘頁全部攤開。二手書店、店員、常客們……每個人手上都有一頁。",
      "|拼起來，只差最後一行：『月見燉菜：最後，加入——』",
      "chizuru|「……我知道。宗介說過，那是『家人的味道』。」"
    ], [
      { t: "「家人的味道……是師娘的梅乾！」", fx: { arc: Ar("master"), flag: ["master_ume"] } },
      { t: "「再想想……是月見橫丁的井水！」", fx: { arc: Ar("master"), flag: ["master_ume"] } }
    ]),
    S("master_05", ["chizuru"], "master", "visit", { seen: ["master_04"], arc: { master: 4 }, day: [18, 30] }, [
      "chizuru|「我想好了。讓你見源先生——宗介。」",
      "chizuru|「明天打烊後，我會帶他來。」",
      "chizuru|「請你用料理帳，做那道『月見燉菜』給他吃。」"
    ], [{ t: "「我會用盡全力。」", fx: { arc: Ar("master") } }]),
    S("master_06", ["chizuru"], "master", "close", { seen: ["master_05"] }, [
      "|打烊後，千鶴帶著一位白髮的男人走進店裡。他環顧四周，眼神茫然。",
      "|你端上照著料理帳做的月見燉菜。他嚐了一口，筷子掉在地上。",
      "|「……這個味道。這是……我的店。」",
      "|男人的眼淚一顆一顆落下。「志乃……澄香……凜……我的家人……」",
      "|二十年的空白，在一碗燉菜裡回來了。"
    ], [{ t: "叫他一聲「師父」", fx: { arc: Ar("master"), rep: 15, aff: { chizuru: 8 } } }]),
    S("master_07", ["sumika"], "master", "visit", { seen: ["master_06", "will_05"] }, [
      "|師父、澄香、凜，三個人坐在吧台。",
      "|師父拿起刀，教兩個女兒切第一根蔥。",
      "sumika|「爸爸，你切得好快喔。」",
      "|凜沒有說話，只是緊緊握著懷錶，嘴角第一次在笑。"
    ], [{ t: "為他們做一桌菜", fx: { arc: Ar("master"), aff: { sumika: 8 }, rep: 8 } }])
  ]);
})();
