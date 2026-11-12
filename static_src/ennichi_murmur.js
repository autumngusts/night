// ============================================================================
// 緣日樂園：murmur（客人的碎碎念，規格 §5.4）。範本依「類型＋話題」挑選，變數：{ride} {food} {item}。
// 文字以 C(zh, ja) 保存；今日話題 = s.today.topics 的計數（打烊後列前三名）。
// ============================================================================
(function () {
  "use strict";
  var D = window.PriTestEnnichiData, C = D.C;
  var TYPES = ["impression", "complaint", "need", "recommend", "sns", "gossip", "season", "love", "rival"];
  var T = {
    impression: {
      _: [C("{ride}好好玩！", "{ride}楽しかった！"), C("{ride}的燈好漂亮……", "{ride}の灯り、きれい……"), C("還想再坐一次{ride}", "もう一回{ride}乗りたい")],
      shrine: [C("參拜完心情好平靜", "お参りしたら落ち着いた"), C("本殿好有氣氛", "本殿、雰囲気あるね")],
      omikuji: [C("抽到大吉了！", "大吉だった！"), C("……是小凶，有點在意", "……小凶。ちょっと気になる")],
      ticket: [C("拿了整理券，先去逛別的", "整理券もらったから先に他を回ろう")],
      qstall: [C("排隊的時候還能買汽水，好貼心", "並んでる間にラムネ買えるの助かる")],
      kasa: [C("買了和傘，雨天也很有氣氛", "和傘買った、雨の日もいい感じ")]
    },
    complaint: {
      queue: [C("{ride}排了好久……不排了", "{ride}、並びすぎ……もういいや"), C("隊伍都沒在動耶", "列が全然進まない")],
      broken: [C("{ride}突然停了！？", "{ride}止まっちゃった！？"), C("故障了啦，好可惜", "故障だって、残念")],
      expensive: [C("{ride}好貴……", "{ride}高いなあ……")],
      soldout: [C("{food}賣完了……", "{food}売り切れ……"), C("想吃的都沒了", "食べたいもの全部売り切れ")],
      litter: [C("垃圾桶好少，竹籤要丟哪", "ゴミ箱少なすぎ、串どこに捨てるの"), C("地上好多垃圾……", "地面にゴミが……")],
      wind: [C("今天風太大，{ride}停駛了", "今日は風が強くて{ride}運休だって")],
      rain: [C("雨好大，都沒地方躲……", "雨すごいのに雨宿りする所がない……")]
    },
    need: {
      hunger: [C("肚子好餓，附近沒有吃的", "お腹すいた、食べるとこない")],
      thirst: [C("好想喝冷飲，這附近都沒有賣", "冷たい飲み物ほしい、売ってない")],
      toilet: [C("廁所在哪裡啦——", "トイレどこー！")],
      fatigue: [C("走好累，想找張長椅坐一下", "歩き疲れた、ベンチ座りたい")],
      fun: [C("好像沒什麼好玩的……", "遊ぶものあんまりないね……")],
      dry: [C("淋濕了……有沒有賣傘的地方", "濡れちゃった……傘売ってないかな")]
    },
    recommend: {
      recommend: [C("下次一定要帶朋友來！", "今度は友達も連れてくる！"), C("這裡比想像中好玩", "思ったより楽しかった")],
      wish: [C("繪馬上的願望實現了！謝謝！", "絵馬のお願い、叶った！ありがとう！")]
    },
    sns: { _: [C("#緣日樂園 {ride}拍起來超好看 ✨", "#縁日遊園 {ride}めっちゃ映える ✨"), C("#緣日樂園 {item}入手！", "#縁日遊園 {item}ゲット！")] }
  };

  function fill(c, ctx) {
    function rep(str, lang) {
      return str.replace("{ride}", ctx.ride ? ctx.ride[lang] : "").replace("{food}", ctx.food ? ctx.food[lang] : "").replace("{item}", ctx.item ? ctx.item[lang] : "");
    }
    return { zh: rep(c.zh, "zh"), ja: rep(c.ja, "ja") };
  }

  function say(s, g, type, topic, ctx) {
    if (!s.today) return null;
    var Core = window.PriTestEnnichiCore;
    var group = T[type] || {}, list = group[topic] || group._ || [C("……", "……")];
    var m = { t: s.min, day: s.day, gid: g ? g.id : 0, photo: g ? g.photo : null, type: type, topic: topic, text: fill(list[Core.rint(s, list.length)], ctx || {}) };
    s.today.murmurs.push(m);
    if (s.today.murmurs.length > 300) s.today.murmurs.shift();
    s.today.topics[topic] = (s.today.topics[topic] || 0) + 1;
    return m;
  }

  function topTopics(s, n) {
    if (!s.today) return [];
    return Object.keys(s.today.topics).map(function (k) { return [k, s.today.topics[k]]; })
      .sort(function (a, b) { return b[1] - a[1] || (a[0] < b[0] ? -1 : 1); }).slice(0, n);
  }

  window.PriTestEnnichiMurmur = { TYPES: TYPES, TEMPLATES: T, say: say, topTopics: topTopics };
})();
