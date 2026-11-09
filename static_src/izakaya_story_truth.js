// 深夜居酒屋（izakaya）：批次 B——主劇情的三層真相（使用者指定 2026-11-09：曲折離奇、多重結局、不跑 3 輪以上很難串到最深處的祕密）。
//   第 1 年：鷹司董事長為了土地放任大火（既有內容）。
//   第 2 年（legacy.runs ≥ 1，且以前看過 master_06）：既視感、神祕女客「夜」、火災報告的矛盾 → 千鶴自白（secret_chizuru）。
//   第 3 年（legacy.runs ≥ 2，且以前解開 secret_chizuru）：夜＝師娘志乃；火在燈籠倒下前就被放了，千鶴無罪；
//     你是「月見」板前夫婦的孩子，是師父把你抱出火場 → 真結局「月見之燈」（secret_truth）。
// 旗標以 secret_ 開頭的，一年結束時會記進跨局記憶（izakaya_core.js mergeLegacy）。
(function () {
  "use strict";
  function L(arr) { return arr.map(function (x) { var i = x.indexOf("|"); return [x.slice(0, i), x.slice(i + 1)]; }); }
  function S(id, who, at, cond, lines, ch, arc) { var o = { id: id, who: who, at: at, cond: cond, lines: L(lines), pri: 4 }; if (arc) o.arc = arc; if (ch) o.ch = ch; return o; }
  function A(id, n) { var a = {}; a[id] = n; return a; }
  function T(n) { return { truth: n || 1 }; }

  window.PriTestIzakayaScenes = (window.PriTestIzakayaScenes || []).concat([
    // ======================= 第 2 年：既視感 =======================
    S("mio_dv", ["mio"], "visit", { run: 1, ever: ["band_06"], day: [3, 30] }, [
      "mio|「老闆……我們以前見過嗎？」",
      "mio|「我做了一個很長的夢。夢裡，我在這家店唱了一首歌，大家都在哭。」",
      "|她笑著搖搖頭，好像在笑自己傻。你卻覺得，胸口有什麼東西在發燙。"
    ], [{ t: "「也許那不是夢。」", fx: { aff: A("mio", 5) } }, { t: "「那一定是很好的夢。」", fx: { aff: A("mio", 4) } }]),
    S("chizuru_dv", ["chizuru"], "visit", { run: 1, ever: ["master_06"], day: [6, 30] }, [
      "|千鶴一進門，就盯著天花板上的紅燈籠，臉色發白。",
      "chizuru|「……可以，把那盞燈籠拿下來嗎？」",
      "chizuru|「我從二十年前，就怕燈籠。」"
    ], [{ t: "把燈籠拿下來", fx: { aff: A("chizuru", 5), flag: ["clue_fear"] } }, { t: "「為什麼怕燈籠？」", fx: { aff: A("chizuru", 3), flag: ["clue_fear"] } }]),
    S("sumika_dv", ["sumika"], "visit", { run: 1, ever: ["master_06"], day: [5, 30] }, [
      "|澄香帶來一個舊音樂盒。打開，是一首很慢的搖籃曲。",
      "sumika|「小時候，有個看不清臉的阿姨，常常在窗外唱這首歌給我聽。」",
      "sumika|「家裡的人說，那是我做的夢。」"
    ], [{ t: "「再放一次吧。」", fx: { aff: A("sumika", 5), flag: ["clue_lullaby"] } }]),

    // ======================= 第 2 年：神祕女客「夜」=======================
    S("yoru_01", ["yoru"], "visit", { run: 1, day: [1, 30] }, [
      "|最裡面的位子，坐著一位戴著長手套的婦人。",
      "yoru|「月見燉菜，一份。」",
      "|菜單上沒有這道菜。可是她說得那麼理所當然，像是點了幾十年。"
    ], [{ t: "「我試著做做看。」", fx: { aff: A("yoru", 5) } }, { t: "「您怎麼知道這道菜？」", fx: { aff: A("yoru", 3) } }], "truth"),
    S("yoru_02", ["yoru"], "visit", { seen: ["yoru_01"], aff: A("yoru", 5) }, [
      "yoru|「這家店，以前廚房在左邊吧。」",
      "yoru|「醬油要放在伸手就拿得到的地方。那個人，總是這樣說。」",
      "|她說的「那個人」，聲音輕得像是在怕驚醒誰。"
    ], [{ t: "「那個人是誰？」", fx: { aff: A("yoru", 3) } }, { t: "把醬油移到左邊", fx: { aff: A("yoru", 6) } }], "truth"),
    S("yoru_03", ["yoru"], "visit", { seen: ["yoru_02"], aff: A("yoru", 10) }, [
      "|她拿杯子的時候，手套滑了下來。",
      "|左手從手腕到手指，布滿了燒傷的疤痕。",
      "yoru|「……嚇到你了吧。很久以前的傷了。」"
    ], [{ t: "替她把手套戴好", fx: { aff: A("yoru", 6), flag: ["clue_burn"] } }, { t: "「是火災嗎？」", fx: { aff: A("yoru", 3), flag: ["clue_burn"] } }], "truth"),
    S("yoru_04", ["yoru"], "close", { seen: ["yoru_03"], aff: A("yoru", 15) }, [
      "|打烊收拾時，你在她坐過的位子上，發現一張折起來的紙。",
      "|是料理帳的一頁。字跡卻不是師父的——是秀氣的女字。",
      "|『給宗介。如果有一天你想起來了，記得醬油放左邊。』"
    ], [{ t: "小心收好", fx: { flag: ["clue_page"] } }], "truth"),

    // ======================= 第 2 年：火災報告的矛盾 → 千鶴自白 =======================
    S("clue_01", ["chizuru"], "close", { run: 1, ever: ["master_06"], seen: ["chizuru_05"] }, [
      "|打烊後，你攤開前刑警留下的火災報告影本。",
      "|『起火點：二樓客房。原因：紙燈籠倒塌。』",
      "|可是第一年，千鶴說過：「火是從後門燒起來的。」兩個說法，對不起來。"
    ], [{ t: "記下這個矛盾", fx: { flag: ["clue_lantern"] } }], "truth"),
    S("clue_02", ["ayano"], "visit", { run: 1, flag: ["clue_lantern"] }, [
      "ayano|「父親的日記裡，有一頁被撕掉了。我在書桌夾層找到了。」",
      "ayano|「『那晚她打翻了燈籠。我替她頂罪，也順便拿走了那塊地。我是個卑鄙的男人。』」",
      "ayano|「……『她』是誰？」"
    ], [{ t: "想起千鶴怕燈籠的樣子", fx: { flag: ["clue_diary"] } }, { t: "「先別告訴任何人。」", fx: { flag: ["clue_diary"] } }], "truth"),
    S("clue_03", ["chizuru"], "visit", { run: 1, flag: ["clue_diary"], aff: A("chizuru", 25) }, [
      "|你把日記的那一頁，放在千鶴面前。",
      "|她看了很久，然後笑了。是一種終於放下什麼的笑。",
      "chizuru|「是我。那晚我去找宗介，跟志乃吵了起來。我推了一把……燈籠倒了。」",
      "chizuru|「宗一郎替我頂了罪。他愛我，我卻愛著他哥哥。二十年，我每天都在等有人來揭穿我。」"
    ], [
      { t: "「謝謝妳說出來。」", fx: { flag: ["secret_chizuru"], arc: T(), aff: A("chizuru", 6) } },
      { t: "什麼都不說，陪著她", fx: { flag: ["secret_chizuru"], arc: T(), aff: A("chizuru", 8) } }
    ], "truth"),
    S("yoru_05", ["yoru"], "visit", { seen: ["yoru_04"], flag: ["secret_chizuru"] }, [
      "|夜聽說了千鶴的自白，筷子停在半空。",
      "yoru|「……她錯了。」",
      "yoru|「燈籠倒下的時候，火……已經在燒了。」",
      "|她站起來，沒有付錢就走了。你追出去，巷子裡已經沒有人。"
    ], [{ t: "記住這句話", fx: { flag: ["clue_before"] } }], "truth"),

    // ======================= 第 3 年：夜的真身 =======================
    S("yoru_06", ["yoru"], "visit", { run: 2, secret: ["secret_chizuru"], seen: ["yoru_03"] }, [
      "yoru|「你又開了一年店呢。……你是不是覺得，這一年好像過過很多次？」",
      "yoru|「我也是。每一年，我都坐在這個位子，看著你。」",
      "|她把手套整個脫了下來。"
    ], [{ t: "「您到底是誰？」", fx: { aff: A("yoru", 5) } }, { t: "靜靜等她說", fx: { aff: A("yoru", 6) } }], "truth"),
    S("yoru_07", ["yoru"], "visit", { seen: ["yoru_06"], aff: A("yoru", 20) }, [
      "|夜拿出一張燒掉一角的照片。「月見」的全體員工，站在櫻花樹下。",
      "|中間是年輕的師父，旁邊是一位溫柔的女性。再旁邊，是一對穿著廚師服的夫婦，抱著一個小小的孩子。",
      "yoru|「這個孩子……你認得嗎？」"
    ], [{ t: "「……那是我？」", fx: { flag: ["secret_photo"], aff: A("yoru", 5) } }], "truth"),
    S("yoru_08", ["yoru"], "close", { seen: ["yoru_07"] }, [
      "|打烊後，夜第一次留了下來。",
      "yoru|「我叫志乃。鷹司志乃。宗介的妻子，澄香和凜的母親。」",
      "yoru|「大家都以為我死在火裡了。我也讓他們這樣以為。這張臉、這隻手……我沒有勇氣回去。」",
      "|二十年前死去的師娘，就坐在你的吧台前。"
    ], [{ t: "「歡迎回來，師娘。」", fx: { flag: ["secret_shino"], arc: T(), aff: A("yoru", 10) } }], "truth"),

    // ======================= 第 3 年：最深處的真相 → 真結局 =======================
    S("truth_01", ["yoru", "chizuru"], "visit", { seen: ["yoru_08"], present: ["yoru", "chizuru"] }, [
      "|志乃走到千鶴面前。千鶴的臉一瞬間失去血色。",
      "chizuru|「志乃……妳……還活著……」",
      "yoru|「千鶴。那晚燈籠倒下的時候，後門已經在燒了。是宗一郎的人放的火。」",
      "yoru|「妳沒有殺任何人。妳背了二十年不屬於妳的罪。」",
      "|千鶴跪坐在地上，哭得像個孩子。"
    ], [{ t: "扶起千鶴", fx: { flag: ["secret_innocent"], arc: T(), aff: { chizuru: 10, yoru: 5 } } }], "truth"),
    S("truth_02", ["yoru"], "close", { seen: ["truth_01"] }, [
      "yoru|「照片裡抱著孩子的那對夫婦，是『月見』的板前。阿誠和小春。」",
      "yoru|「火燒起來的時候，他們回頭去救客人，再也沒有出來。」",
      "yoru|「宗介抱著他們的孩子，從二樓跳進了河裡。那孩子，就是你。」",
      "yoru|「宗介失去了記憶，卻一直記得要把手藝教給你。那是他跟阿誠的約定。」",
      "|你終於明白，為什麼這家店的每一道菜，都讓你覺得像是回到了家。"
    ], [{ t: "說不出話，只是點頭", fx: { flag: ["secret_you"], arc: T() } }], "truth"),
    S("truth_03", ["yoru"], "close", { seen: ["truth_02", "master_06"] }, [
      "|打烊後，店裡只亮著一盞燈。師父坐在吧台，志乃戴著手套走了進來。",
      "|師父看著她，很久很久。然後他站起來，走進廚房，把醬油移到了左邊。",
      "|「……志乃。醬油，要放在伸手就拿得到的地方。」",
      "yoru|「……你這個人，二十年了，還是只記得這種事。」",
      "|她摘下手套，牽起了他布滿刀繭的手。"
    ], [{ t: "悄悄把暖簾收起來", fx: { arc: T(), rep: 10 } }], "truth"),
    S("truth_final", ["yoru"], "close", { seen: ["truth_03"] }, [
      "|最後一個夜晚。師父、志乃、澄香、凜、千鶴……還有每一位常客，都擠進了小小的店裡。",
      "|師父把一塊新的木招牌交給你。上面寫著兩個字：『月見』。",
      "|「這家店，是阿誠和小春的孩子的店。也是我們一家的店。」",
      "yoru|「你一直都是我們的孩子。從那一夜開始。」",
      "|紅燈籠一盞一盞亮起。二十年前熄滅的燈，終於又點亮了。"
    ], [{ t: "掛上新的招牌", fx: { flag: ["secret_truth"], arc: T(), rep: 20 } }], "truth")
  ]);
})();
