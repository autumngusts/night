// 萬人迷（wanren）：追加的事件（2026-11-03 使用者「中間觸發事件稍微頻繁，更多事件能觸發，新增更多遊戲性」）。
// X_EVENTS：早上的隨機事件（與 wanren_core.js 原有的 rain／wallet… 混在一起抽），以及晚上的深夜訊息。
// ENCOUNTERS2：自由時間的校園遭遇（走路或行動後觸發）。kind:"her"＝需要在場、已認識的女主角。
// 每個事件都是資料＋函式：cond(s, A) 是否能發生、pick(s, A) 決定對象、view(s, ev, A) 畫面、res(s, ev, idx, out, A) 結果。
// A 是 wanren_core.js 傳進來的工具（addAff、applyEff、name、pick、rand、metList、loversOf、addSkill…），避免重複定義規則。
// 載入順序：wanren_data3.js → 本檔 → wanren_core.js。
(function () {
  "use strict";

  var D = window.PriTestWanrenData;
  if (!D) return;

  function seen(s, hid) { s.h[hid].lastSeen = s.day; }
  // 今天在學校的已認識女主角（可加條件）
  function presentMet(s, A, f) {
    return A.metList(s, f).filter(function (hid) { return A.whereIs(s, hid, s.day, 0); });
  }
  function byGroup(groups) { return function (h, hd) { return groups.indexOf(hd.group) >= 0; }; }

  // ---------------- 早上的隨機事件 ----------------
  // w：被抽中的權重（原有事件每個 1）
  var X_EVENTS = [
    { id: "groupwork", w: 1.2,
      cond: function (s, A) { return s.today.kind === "weekday" && presentMet(s, A, byGroup(["classmate", "kouhai", "senior"])).length > 0; },
      pick: function (s, A) { return { hid: A.pick(s, presentMet(s, A, byGroup(["classmate", "kouhai", "senior"]))) }; },
      view: function (s, ev, A) { var n = A.name(ev.hid); return { title: "📊 分組報告", text: "課堂分組報告，你和" + n + "被分在同一組。她看著題目：「……要怎麼分工呢？」", opts: ["一起認真做完", "交給她做，自己摸魚", "做完後順便邀她去吃飯（¥800）"] }; },
      res: function (s, ev, idx, out, A) {
        var h = ev.hid;
        if (idx === 0) { out.push("你們討論到很晚，報告拿了全班最高分。"); A.applyEff(s, { study: 2, stamina: -5 }, out); A.addAff(s, h, 5, out); }
        else if (idx === 1) { out.push(A.name(h) + "一個人做完了報告，看你的眼神有點冷。"); A.addAff(s, h, -4, out); A.applyEff(s, { rep: -1 }, out); }
        else if (s.stats.money < 800) { out.push("……錢包裡只剩零錢。你們只好去便利商店買飯糰。她倒是笑得很開心。"); A.addAff(s, h, 3, out); }
        else { out.push("報告做完後，你們去吃了拉麵。她說：「下次也要同一組喔。」"); A.applyEff(s, { money: -800, study: 1 }, out); A.addAff(s, h, 5, out); if (!s.h[h].dating) s.today.flirt += 1; }
        seen(s, h);
      } },
    { id: "errand", w: 1,
      cond: function (s, A) { return presentMet(s, A, byGroup(["teacher"])).length > 0; },
      pick: function (s, A) { return { hid: A.pick(s, presentMet(s, A, byGroup(["teacher"]))) }; },
      view: function (s, ev, A) { var n = A.name(ev.hid); return { title: "📦 老師的委託", text: n + "抱著一大箱資料叫住你：「你來得正好。今天能幫我個忙嗎？可能要花一點時間。」", opts: ["幫忙（自由時間 −1）", "「抱歉，今天有事」"] }; },
      res: function (s, ev, idx, out, A) {
        if (idx === 0) { out.push("你幫" + A.name(ev.hid) + "整理了一個下午的資料。她遞給你一杯咖啡：「謝謝，幫了大忙。」"); A.addAff(s, ev.hid, 6, out); A.applyEff(s, { rep: 1, study: 1 }, out); s.today.apBonus -= 1; seen(s, ev.hid); }
        else { out.push("「是嗎。那就算了。」"); A.addAff(s, ev.hid, -1, out); }
      } },
    { id: "parentvisit", w: 0.9,
      cond: function (s, A) { return A.metList(s, byGroup(["parent"])).length > 0; },
      pick: function (s, A) { return { hid: A.pick(s, A.metList(s, byGroup(["parent"]))) }; },
      view: function (s, ev, A) { var n = A.name(ev.hid); return { title: "🧺 家長來訪", text: n + "來學校辦事，在校門口叫住了你，手上提著一盒點心：「剛好路過，順便來看看你。」", opts: ["陪她逛校園（自由時間 −1）", "收下點心、道謝"] }; },
      res: function (s, ev, idx, out, A) {
        var hd = D.HEROINE_BY_ID[ev.hid];
        if (idx === 0) {
          out.push("你帶" + A.name(ev.hid) + "走了一圈校園。她在櫻花樹下停了很久：「……好懷念。年輕真好呢。」");
          A.addAff(s, ev.hid, 7, out); s.today.apBonus -= 1;
          if (hd.daughter && s.h[hd.daughter].met) { out.push("（" + A.name(hd.daughter) + "遠遠看到你們，表情有點複雜。）"); A.addAff(s, hd.daughter, 2, out); }
        } else { out.push("點心很好吃。"); A.addAff(s, ev.hid, 2, out); A.applyEff(s, { stamina: 5 }, out); }
        seen(s, ev.hid);
      } },
    { id: "advice", w: 1,
      cond: function (s, A) { return A.metList(s, byGroup(["kouhai"])).length > 0; },
      pick: function (s, A) { return { hid: A.pick(s, A.metList(s, byGroup(["kouhai"]))) }; },
      view: function (s, ev, A) { var n = A.name(ev.hid); return { title: "💭 學妹的戀愛諮詢", text: n + "紅著臉跑過來：「學長……我有喜歡的人了。要怎麼告白比較好？」", opts: ["認真地給建議", "「那個人……該不會是我吧？」", "「我不太懂這種事耶」"] }; },
      res: function (s, ev, idx, out, A) {
        var h = ev.hid, aff = s.h[h].aff;
        if (idx === 0) { out.push("你認真地說了很多。她聽完，小聲地說：「……學長，好遲鈍喔。」"); A.addAff(s, h, 4, out); A.addSkill(s, "talk", 1, out); }
        else if (idx === 1 && aff >= 50) { out.push("她的臉一下子紅透了：「學、學長是笨蛋！」說完就跑走了。……好像猜中了。"); A.addAff(s, h, 8, out); }
        else if (idx === 1) { out.push("她愣了一下：「……學長，好自戀喔。」"); A.addAff(s, h, -3, out); }
        else { out.push("「這樣啊……」她有點失望地走了。"); A.addAff(s, h, -1, out); }
        seen(s, h);
      } },
    { id: "pastexam", w: 0.9,
      cond: function (s, A) { return A.metList(s, function (h, hd) { return hd.group === "senior" && h.aff >= 20; }).length > 0; },
      pick: function (s, A) { return { hid: A.pick(s, A.metList(s, function (h, hd) { return hd.group === "senior" && h.aff >= 20; })) }; },
      view: function (s, ev, A) { return { title: "📑 學姐的考古題", text: A.name(ev.hid) + "塞給你一疊影印本：「這是去年的考古題。……不要說是我給的喔。」", opts: ["收下並道謝", "「我想靠自己的實力」"] }; },
      res: function (s, ev, idx, out, A) {
        if (idx === 0) { out.push("考古題上寫滿了她的筆記，連重點都畫好了。"); A.applyEff(s, { study: 3 }, out); A.addAff(s, ev.hid, 3, out); }
        else { out.push("她笑著拍拍你的頭：「有骨氣。我喜歡。」"); A.addAff(s, ev.hid, 4, out); A.applyEff(s, { rep: 1 }, out); }
        seen(s, ev.hid);
      } },
    { id: "rival", w: 0.8,
      cond: function (s, A) { return A.metList(s, function (h, hd) { return h.aff >= 50 && hd.group !== "parent"; }).length > 0; },
      pick: function (s, A) { return { hid: A.pick(s, A.metList(s, function (h, hd) { return h.aff >= 50 && hd.group !== "parent"; })) }; },
      view: function (s, ev, A) { var n = A.name(ev.hid); return { title: "🔥 情敵登場", text: "籃球社的王牌在中庭公開宣布要追" + n + "。全校都在看你的反應。", opts: ["正面挑戰：鬥牛一場", "不跟他比，直接去找她說話（自由時間 −1）", "不在意"] }; },
      res: function (s, ev, idx, out, A) {
        var h = ev.hid;
        if (idx === 0) {
          var win = s.skills.sport >= 30 || A.rand(s) < 0.35 + s.stats.stamina / 400;
          if (win) { out.push("你在最後一秒投進了逆轉的一球。" + A.name(h) + "在場邊用力地鼓掌。"); A.addAff(s, h, 8, out); A.applyEff(s, { rep: 2, charm: 1, stamina: -10 }, out); s.fans += 3; }
          else { out.push("你輸了，輸得很慘。可是" + A.name(h) + "拿著毛巾走了過來：「……你很努力了。」"); A.addAff(s, h, 3, out); A.applyEff(s, { rep: -1, stamina: -12 }, out); }
          A.addSkill(s, "sport", 1, out);
        } else if (idx === 1) { out.push("你走到" + A.name(h) + "面前，只說了一句「今天一起回家吧」。籃球社的王牌默默地離開了。"); A.addAff(s, h, 6, out); s.today.apBonus -= 1; }
        else { out.push("……過了幾天，聽說" + A.name(h) + "有點在意你的反應。"); A.addAff(s, h, -4, out); }
        seen(s, h);
      } },
    { id: "cold", w: 0.8,
      cond: function (s) { return s.stats.stamina < 45; },
      view: function () { return { title: "🤧 好像感冒了", text: "早上起床喉嚨好痛，頭也昏昏的。", opts: ["吃藥硬撐", "到保健中心躺一下（自由時間 −1）"] }; },
      res: function (s, ev, idx, out, A) {
        if (idx === 0) { out.push("撐是撐住了，可是整天都昏昏沉沉的。"); A.applyEff(s, { stamina: -8 }, out); return; }
        out.push("你在保健中心睡了一覺，好多了。");
        A.applyEff(s, { stamina: 16 }, out); s.today.apBonus -= 1;
        var care = ["rena", "shizuku", "fuyuka", "sumika"].filter(function (x) { return D.HEROINE_BY_ID[x] && s.h[x].met && A.available(s, x); });
        if (care.length) { var c = A.pick(s, care); out.push(A.name(c) + "幫你量了體溫：「不可以太勉強自己喔。」"); A.addAff(s, c, 4, out); seen(s, c); }
      } },
    { id: "horoscope", w: 0.8,
      cond: function (s) { return !s.today.lucky; },
      view: function () { return { title: "🔮 今天的星座運勢", text: "早餐時電視上的星座運勢說：「今天的戀愛運 ★★★★★！主動跟人說話會有好事發生！」", opts: ["相信它，今天主動一點", "我不信這個"] }; },
      res: function (s, ev, idx, out, A) {
        if (idx === 0) { s.today.lucky = true; out.push("（今天聊天的好感 ×1.2）"); A.applyEff(s, { charm: 1 }, out); }
        else { out.push("你轉台看了新聞。"); A.applyEff(s, { study: 1 }, out); }
      } },
    { id: "doublebook", w: 0.7,
      cond: function (s, A) { return !s.today.date && A.metList(s, function (h) { return h.aff >= 40; }).length >= 2; },
      pick: function (s, A) {
        var list = A.metList(s, function (h) { return h.aff >= 40; }), a = A.pick(s, list);
        return { hid: a, hid2: A.pick(s, list.filter(function (x) { return x !== a; })) };
      },
      view: function (s, ev, A) { var a = A.name(ev.hid), b = A.name(ev.hid2); return { title: "📱 撞期了", text: a + "和" + b + "幾乎同時傳來訊息：「今晚有空嗎？想見你。」", opts: ["赴" + a + "的約", "赴" + b + "的約", "兩個都婉拒"] }; },
      res: function (s, ev, idx, out, A) {
        if (idx < 2) {
          var go = idx === 0 ? ev.hid : ev.hid2, no = idx === 0 ? ev.hid2 : ev.hid;
          s.today.date = go;
          out.push("你回覆了" + A.name(go) + "。約會成立！晚上記得赴約。");
          out.push(A.name(no) + "：「……這樣啊。」"); A.addAff(s, no, -4, out);
        } else { out.push("你兩個都婉拒了。兩個人都有點失落。"); A.addAff(s, ev.hid, -2, out); A.addAff(s, ev.hid2, -2, out); }
      } },
    { id: "lunch", w: 1.1,
      cond: function (s, A) { return presentMet(s, A, function (h) { return h.aff >= 25; }).length > 0; },
      pick: function (s, A) { return { hid: A.pick(s, presentMet(s, A, function (h) { return h.aff >= 25; })) }; },
      view: function (s, ev, A) { return { title: "🍱 午餐的邀約", text: A.name(ev.hid) + "拿著兩個便當走過來：「做太多了……一起吃吧？」", opts: ["一起吃", "「我已經吃過了」"] }; },
      res: function (s, ev, idx, out, A) {
        if (idx === 0) {
          out.push("你們坐在中庭的長椅上吃便當。" + A.name(ev.hid) + "一直偷看你吃東西的樣子。");
          A.addAff(s, ev.hid, 5, out); A.applyEff(s, { stamina: 10 }, out);
          if (!s.h[ev.hid].dating && A.loversOf(s).length) { s.today.flirt += 1; out.push("（女友好像會在意……）"); }
        } else { out.push("「這樣啊……」她把便當收了回去。"); A.addAff(s, ev.hid, -1, out); }
        seen(s, ev.hid);
      } },
    { id: "charity", w: 0.7,
      cond: function () { return true; },
      view: function () { return { title: "🎗 校園義賣", text: "學生會在中庭辦義賣，為附近的育幼院募款。", opts: ["捐 ¥2,000", "幫忙顧攤（自由時間 −1）", "路過"] }; },
      res: function (s, ev, idx, out, A) {
        if (idx === 0) {
          if (s.stats.money >= 2000) { out.push("你把錢投進募款箱。學生會的人向你深深鞠躬。"); A.applyEff(s, { money: -2000, rep: 4 }, out); }
          else { out.push("你掏出了身上所有的零錢。「心意最重要喔。」"); A.applyEff(s, { rep: 1 }, out); }
        } else if (idx === 1) {
          out.push("你在攤位幫忙叫賣，結果你站的那一攤賣得最好。");
          A.applyEff(s, { rep: 3, charm: 1 }, out); s.fans += 2; s.today.apBonus -= 1;
          D.CLUB_BY_ID.council.members.forEach(function (m) { if (s.h[m].met && A.available(s, m)) { A.addAff(s, m, 2, out); seen(s, m); } });
        } else out.push("你從攤位旁邊走過。");
      } },
    { id: "loveletter", w: 0.8,
      cond: function (s, A) { return A.metList(s, function (h) { return h.aff >= 55 && !h.dating; }).length > 0; },
      pick: function (s, A) { return { hid: A.pick(s, A.metList(s, function (h) { return h.aff >= 55 && !h.dating; })) }; },
      view: function (s, ev, A) { return { title: "✉ 沒有署名的信", text: "書桌的抽屜裡有一封沒有署名的信：『一直在看著你。』……字跡好像有點眼熟。是" + A.name(ev.hid) + "嗎？", opts: ["去問" + A.name(ev.hid), "收好，不去追究"] }; },
      res: function (s, ev, idx, out, A) {
        if (idx === 0) {
          if (A.rand(s) < 0.65) { out.push(A.name(ev.hid) + "的臉一下子紅了：「你、你怎麼知道是我……！」"); A.addAff(s, ev.hid, 8, out); }
          else { out.push(A.name(ev.hid) + "一臉疑惑：「不是我喔？」……氣氛有點尷尬。那會是誰呢？"); A.addAff(s, ev.hid, -2, out); s.fans += 1; }
          seen(s, ev.hid);
        } else { out.push("你把信夾進了筆記本。"); A.applyEff(s, { charm: 1 }, out); }
      } },
    { id: "studygroup", w: 1.5,
      cond: function (s, A) { return s.today.examWeek && presentMet(s, A).length > 0; },
      pick: function (s, A) { return { hid: A.pick(s, presentMet(s, A)) }; },
      view: function (s, ev, A) { return { title: "📚 讀書會", text: "考試快到了。" + A.name(ev.hid) + "傳訊息來：「今天放學後……要不要一起讀書？」", opts: ["參加（自由時間 −1）", "自己讀比較專心"] }; },
      res: function (s, ev, idx, out, A) {
        if (idx === 0) { out.push("你們讀到圖書館閉館。她說：「跟你一起讀書，好像比較記得住。」"); A.applyEff(s, { study: 3, stamina: -5 }, out); A.addAff(s, ev.hid, 4, out); s.today.apBonus -= 1; seen(s, ev.hid); }
        else { out.push("你一個人讀完了範圍。"); A.applyEff(s, { study: 2 }, out); }
      } },
    { id: "phonecheck", w: 0.8,
      cond: function (s, A) { return A.loversOf(s).length > 0 && (s.contacts > 0 || s.fans >= 20); },
      pick: function (s, A) { return { hid: A.pick(s, A.loversOf(s)) }; },
      view: function (s, ev, A) { return { title: "📵 手機抽查", text: A.name(ev.hid) + "拿著你的手機，螢幕上跳出了一堆迷妹的訊息：「……這些人是誰？」", opts: ["誠實說明", "撒嬌帶過", "把手機交給她，讓她全部刪掉"] }; },
      res: function (s, ev, idx, out, A) {
        var h = ev.hid;
        if (idx === 0) { var ok = s.stats.rep >= 0; out.push(ok ? "你一五一十地說明了。她嘆了一口氣：「……我相信你。」" : "你越說明，她的臉越黑……"); A.addAff(s, h, ok ? 2 : -3, out); }
        else if (idx === 1) { var ok2 = s.stats.charm >= 50; out.push(ok2 ? "她被你逗笑了：「……真拿你沒辦法。」" : "「不要想矇混過去！」"); A.addAff(s, h, ok2 ? 3 : -4, out); }
        else { out.push("她把迷妹們的聯絡方式全部刪掉了，然後滿意地把手機還給你：「好了。」"); A.addAff(s, h, 5, out); s.contacts = 0; A.applyEff(s, { charm: -1 }, out); }
        seen(s, h);
      } },
    { id: "sick", w: 0.7,
      cond: function (s, A) { return A.metList(s, function (h) { return h.aff >= 40; }).length > 0; },
      pick: function (s, A) { return { hid: A.pick(s, A.metList(s, function (h) { return h.aff >= 40; })) }; },
      view: function (s, ev, A) { return { title: "🤒 她感冒了", text: "聽說" + A.name(ev.hid) + "感冒了，今天沒辦法來學校。", opts: ["帶慰問品去探望（¥800，自由時間 −1）", "傳訊息關心", "不打擾她"] }; },
      res: function (s, ev, idx, out, A) {
        var h = ev.hid;
        if (idx === 0 && s.stats.money >= 800) { out.push("你帶著水果去探望她。她裹著棉被，聲音沙啞地說：「……你怎麼來了。」然後偷偷地笑了。"); A.applyEff(s, { money: -800 }, out); A.addAff(s, h, 9, out); s.today.apBonus -= 1; seen(s, h); }
        else if (idx <= 1) { out.push("她回了一個小小的貼圖：「謝謝……」"); A.addAff(s, h, 3, out); s.h[h].lastSeen = Math.max(s.h[h].lastSeen, s.day - 1); }
        else out.push("你讓她好好休息。");
        s.today.absent = s.today.absent || {}; s.today.absent[h] = true;
      } },
    { id: "photoshoot", w: 0.6,
      cond: function (s) { return s.stats.charm >= 35; },
      view: function () { return { title: "📸 攝影社的邀請", text: "攝影社的社長拜託你：「校園攝影展的模特兒，可以請你來當嗎？」", opts: ["答應（體力 −5）", "推掉"] }; },
      res: function (s, ev, idx, out, A) {
        if (idx === 0) { out.push("攝影展開幕後，你的照片前面擠滿了人。"); A.applyEff(s, { charm: 2, stamina: -5 }, out); s.fans += 4; s.today.flirt += 1; }
        else { out.push("「好可惜……」社長失望地走了。"); }
      } }
  ];

  // 晚上的深夜訊息（晚上自主活動後有機率發生）
  var LATE_NIGHT = {
    id: "latenight", w: 0, night: true,
    view: function (s, ev, A) { return { title: "🌙 深夜的訊息", text: "快要睡著的時候，手機亮了。是" + A.name(ev.hid) + "：「……還醒著嗎？睡不著，想跟你說說話。」", opts: ["聊到深夜（體力 −5）", "「晚安，明天見」", "已讀不回"] }; },
    res: function (s, ev, idx, out, A) {
      var h = ev.hid;
      if (idx === 0) { out.push("你們聊到凌晨兩點。最後她傳了一句：「……謝謝你陪我。」"); A.addAff(s, h, 5, out); A.applyEff(s, { stamina: -5 }, out); s.h[h].lastSeen = Math.max(s.h[h].lastSeen, s.day); }
      else if (idx === 1) { out.push("「嗯，晚安。」後面跟著一個小小的愛心。"); A.addAff(s, h, 2, out); }
      else { out.push("訊息一直顯示「已讀」。……她大概在等吧。"); A.addAff(s, h, -3, out); }
    }
  };
  X_EVENTS.push(LATE_NIGHT);

  // ---------------- 校園遭遇（追加） ----------------
  var ENCOUNTERS2 = [
    { id: "carry", kind: "her", title: "📚 抱著一大疊書", text: "{n}抱著比頭還高的一疊書，搖搖晃晃地走過來。", opts: ["幫她搬一半", "幫她全部搬", "假裝沒看見"],
      res: function (s, ev, idx, out, A) {
        if (idx === 0) { out.push("「謝謝……」你們並肩走著，她偷偷看了你好幾眼。"); A.addAff(s, ev.hid, 4, out); }
        else if (idx === 1) { out.push("你一個人搬完了全部。她跟在旁邊一直說謝謝。"); A.addAff(s, ev.hid, 5, out); A.applyEff(s, { stamina: -5 }, out); }
        else { out.push("身後傳來書掉了一地的聲音……"); A.addAff(s, ev.hid, -2, out); }
        seen(s, ev.hid);
      } },
    { id: "snack", kind: "her", title: "🍪 分你一半", text: "{n}正在吃餅乾，看到你就把剩下的一半遞了過來：「要吃嗎？」", opts: ["「謝謝！」", "「你吃就好」"],
      res: function (s, ev, idx, out, A) {
        if (idx === 0) { out.push("餅乾甜甜的。她看著你吃，好像比自己吃還開心。"); A.addAff(s, ev.hid, 3, out); A.applyEff(s, { stamina: 4 }, out); }
        else { out.push("「是嗎……」她默默地把餅乾吃完了。"); A.addAff(s, ev.hid, 1, out); }
        seen(s, ev.hid);
      } },
    { id: "rehearse", kind: "her", title: "🫣 告白的練習？", text: "你在轉角聽見{n}對著牆壁小聲說：「我、我一直都……」她回頭看到你，整個人僵住了。", opts: ["假裝什麼都沒聽到", "「要我當你的練習對象嗎？」"],
      res: function (s, ev, idx, out, A) {
        if (idx === 0) { out.push("她鬆了一口氣，又好像有點失望。"); A.addAff(s, ev.hid, 2, out); }
        else if (s.h[ev.hid].aff >= 45) { out.push("她紅著臉瞪了你很久，然後小聲說：「……不用練習了。對象就是你啦。」說完就跑走了。"); A.addAff(s, ev.hid, 7, out); }
        else { out.push("「才、才不要！」她丟下這句話就跑了。"); A.addAff(s, ev.hid, -2, out); }
        seen(s, ev.hid);
      } },
    { id: "selfie", kind: "her", title: "🤳 幫忙拍照", text: "{n}拿著手機：「可以幫我拍一張嗎？背景要有櫻花……啊，噴水池也可以。」", opts: ["認真地幫她拍", "「一起入鏡吧」自拍"],
      res: function (s, ev, idx, out, A) {
        if (idx === 0) { out.push("你蹲下來找角度拍了十張。她看了照片：「哇……你很會拍耶！」"); A.addAff(s, ev.hid, 3, out); A.addSkill(s, "art", 0.5, out); }
        else { out.push("兩個人擠在小小的鏡頭裡。她把那張照片設成了手機桌布。"); A.addAff(s, ev.hid, 5, out); if (!s.h[ev.hid].dating && A.loversOf(s).length) s.today.flirt += 1; }
        seen(s, ev.hid);
      } },
    { id: "busker", title: "🎸 中庭的街頭表演", text: "中庭有人在街頭表演，主唱忽然指著你：「那邊的帥哥！要不要上來一起唱？」", opts: ["上台", "在台下聽"],
      res: function (s, ev, idx, out, A) {
        if (idx === 0 && (s.skills.music >= 20 || A.rand(s) < 0.3)) { out.push("你唱完一首，台下爆出了掌聲和尖叫。"); A.applyEff(s, { charm: 1, rep: 1 }, out); s.fans += 3; A.addSkill(s, "music", 0.5, out); }
        else if (idx === 0) { out.push("……你走音走得很徹底。台下笑成一片，不過大家好像很開心。"); A.applyEff(s, { rep: -1 }, out); s.fans += 1; }
        else { out.push("歌聲很好聽，你在台下聽完了整首歌。"); A.applyEff(s, { stamina: 3 }, out); }
      } },
    { id: "vending", title: "🥤 自動販賣機", text: "你買飲料的時候，販賣機「咚」地一聲多掉了一瓶。", opts: ["收下，運氣真好", "放在旁邊給下一個人"],
      res: function (s, ev, idx, out, A) {
        if (idx === 0) { s.inv.drink = (s.inv.drink || 0) + 1; out.push("（得到「運動飲料」）"); }
        else { out.push("一個學妹拿起飲料，對著空氣說了聲謝謝。"); A.applyEff(s, { rep: 1 }, out); }
      } },
    { id: "flyer", title: "📄 發傳單", text: "社團的人抱著一大疊傳單，快哭了：「拜託幫忙發一下！一下下就好！」", opts: ["幫忙", "「抱歉，趕時間」"],
      res: function (s, ev, idx, out, A) {
        if (idx === 0) { out.push("你發的傳單特別多人收。社團的人一直跟你道謝。"); A.applyEff(s, { rep: 2, stamina: -4 }, out); s.fans += 1; A.addSkill(s, "talk", 0.5, out); }
        else out.push("你從旁邊走過去了。");
      } },
    { id: "survey", title: "📋 問卷調查", text: "心理系的研究生拿著問卷：「題目是『大學生的戀愛觀』，大概五分鐘。」", opts: ["認真填寫", "婉拒"],
      res: function (s, ev, idx, out, A) {
        if (idx === 0) { out.push("最後一題是『你現在有喜歡的人嗎？』……你想了很久。"); A.applyEff(s, { study: 1 }, out); A.addSkill(s, "talk", 0.5, out); }
        else out.push("「沒關係，謝謝！」");
      } },
    { id: "puppy", title: "🐶 迷路的小狗", text: "一隻戴著項圈的小狗在校園裡跑來跑去，好像迷路了。", opts: ["帶到校門的保全室", "摸摸牠就走"],
      res: function (s, ev, idx, out, A) {
        if (idx === 0) {
          out.push("狗主人是一個小女孩，她哭著向你道謝。這件事在校園傳開了。");
          A.applyEff(s, { rep: 2, stamina: -3 }, out); s.fans += 1;
          if (D.HEROINE_BY_ID.sachi && s.h.sachi.met) { out.push("幸隊長點了點頭：「做得好。」"); A.addAff(s, "sachi", 3, out); }
        } else { out.push("小狗舔了舔你的手。"); A.applyEff(s, { stamina: 3 }, out); }
      } },
    { id: "rumor", title: "👂 聽到有人在聊你", text: "走廊轉角，兩個女生在小聲地討論你：「欸，你覺得他怎麼樣？」", opts: ["停下來偷聽", "咳一聲，讓她們知道你在"],
      res: function (s, ev, idx, out, A) {
        if (idx === 0) { var good = s.stats.rep >= 0; out.push(good ? "「超溫柔的啦！而且很帥！」你默默地走開，嘴角止不住上揚。" : "「聽說他很花心耶……」你默默地走開了。"); A.applyEff(s, good ? { charm: 1 } : { stamina: -3 }, out); }
        else { out.push("兩個人尖叫著跑走了。第二天，她們成為了你的粉絲。"); s.fans += 2; }
      } },
    { id: "fortune", title: "🔮 戀愛占卜攤", text: "中庭擺了一個戀愛占卜攤。占卜師對你招手：「年輕人，要不要算一下你的命定之人？一次 ¥500。」", opts: ["算一次（¥500）", "不用了"],
      res: function (s, ev, idx, out, A) {
        var met = A.metList(s);
        if (idx !== 0 || s.stats.money < 500) { out.push("占卜師神秘地笑了：「緣分會自己找上門的。」"); return; }
        A.applyEff(s, { money: -500 }, out);
        if (!met.length) { out.push("「你的命定之人……還沒出現。多出去走走吧。」"); A.applyEff(s, { charm: 1 }, out); return; }
        var hid = A.pick(s, met);
        out.push("「你的命定之人，名字裡有……『" + A.name(hid).split(" ").pop().charAt(0) + "』字。」……好像在哪裡聽過。");
        A.addAff(s, hid, 3, out);
      } },
    { id: "scout", title: "🌟 星探", text: "一個戴墨鏡的人遞給你一張名片：「我是模特兒經紀公司的。你有興趣嗎？」", opts: ["收下名片，試鏡看看（體力 −8）", "婉拒"],
      res: function (s, ev, idx, out, A) {
        if (idx === 0) { out.push("試鏡的照片被放上了經紀公司的網站。你的追蹤人數暴增。"); A.applyEff(s, { charm: 2, rep: -1, stamina: -8, money: 3000 }, out); s.fans += 5; s.today.flirt += 1; }
        else { out.push("「可惜了。改變心意的話隨時聯絡我。」"); A.applyEff(s, { rep: 1 }, out); }
      } },
    { id: "omamori", title: "🎐 手作的御守", text: "一個不認識的女生把一個手作御守塞進你手裡：「考、考試加油！」說完就跑走了。", opts: ["收下，好好收著", "追上去還給她"],
      res: function (s, ev, idx, out, A) {
        if (idx === 0) { out.push("御守上繡著小小的「必勝」兩個字。"); A.applyEff(s, { study: 1, charm: 1 }, out); s.fans += 1; }
        else { out.push("你追上她，把御守還了回去。她哭著說：「……你人真好。」"); A.applyEff(s, { rep: 1 }, out); }
      } },
    { id: "petals", title: "🍃 風", text: "一陣風吹過，花瓣（或落葉）落在你的肩膀上。遠處好像有人在看你。", opts: ["把花瓣拍掉", "就這樣讓它留著"],
      res: function (s, ev, idx, out, A) {
        if (idx === 1) { out.push("「好像畫一樣……」遠處傳來小小的尖叫聲。"); s.fans += 1; A.applyEff(s, { charm: 1 }, out); }
        else out.push("你繼續往前走。");
      } }
  ];

  // ---------------- 成就（追加） ----------------
  D.ACHIEVEMENTS.push(
    { id: "meet30", icon: "📇", name: "人脈廣闊", desc: "認識 30 位可攻略角色" },
    { id: "meetEvery", icon: "🏫", name: "全校都認識", desc: "認識全部 65 位可攻略角色" },
    { id: "events50", icon: "🎲", name: "事件體質", desc: "經歷 50 次隨機事件或校園遭遇" },
    { id: "kouhaiLover", icon: "🎀", name: "學妹的學長", desc: "和學妹交往" },
    { id: "parentOK", icon: "👪", name: "母女的祝福", desc: "完成一位家長「與女兒」的任務" }
  );
  // 「校園人脈王」的說明：15 位主要女主角（追加的 50 人另外算）
  D.ACHIEVEMENTS.forEach(function (a) { if (a.id === "meetAll") a.desc = "認識全部 15 位主要女主角"; });

  D.X_EVENTS = X_EVENTS;
  D.X_EVENT_BY_ID = {};
  X_EVENTS.forEach(function (e) { D.X_EVENT_BY_ID[e.id] = e; });
  ENCOUNTERS2.forEach(function (e) { D.ENCOUNTERS.push(e); });
})();
