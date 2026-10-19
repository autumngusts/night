// 武俠合成（gousei）規則引擎：純函式，不碰 DOM／localStorage，方便用 node 測試。
//
// 規則（使用者指定，詳見 docs/gousei_game_design.md）：
//   ・組合必有結果：配方表沒有的組合 → 依 key 雜湊選一個廢料；任一材料是廢料 → 必為廢料
//   ・每人任務：中階 ×1（階段 3〜4）＋ 高階 ×2（階段 5〜7），全體不重複
//   ・共用池子，每輪每人合成一次；只有在自己回合親手合出自己的任務物才算達成
//   ・最先達成全部任務者立即獲勝；可復原一層
(function () {
  "use strict";

  var MID_TIERS = [3, 4];
  var HIGH_TIERS = [5, 7];
  var MIN_PLAYERS = 2;
  var MAX_PLAYERS = 8;

  function clone(obj) { return JSON.parse(JSON.stringify(obj)); }

  // FNV-1a 32bit
  function hashStr(s) {
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  }

  // mulberry32：同一個 seed 在每台裝置都得到相同序列（分別裝置模式靠這個算出同樣的任務）
  function makeRng(seed) {
    var a = hashStr(String(seed));
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function newSeed(rand) {
    var chars = "0123456789abcdefghijklmnopqrstuvwxyz";
    var out = "";
    for (var i = 0; i < 8; i++) out += chars.charAt(Math.floor(rand() * chars.length));
    return out;
  }

  function shuffle(arr, rng) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
    }
    return a;
  }

  function pairKey(a, b) { return a <= b ? a + "|" + b : b + "|" + a; }

  function indexTheme(data) {
    var byId = {};
    var items = data.items.map(function (row) {
      var it = { id: row[0], zh: row[1], ja: row[2], cat: row[3], tier: row[4] };
      byId[it.id] = it;
      return it;
    });
    var junkSet = {};
    data.junk.forEach(function (id) { junkSet[id] = true; });
    var catById = {};
    data.categories.forEach(function (c) { catById[c.id] = c; });
    return { id: data.id, data: data, items: items, byId: byId, basics: data.basics.slice(),
      junk: data.junk.slice(), junkSet: junkSet, recipes: data.recipes, catById: catById };
  }

  function combine(theme, a, b) {
    var key = pairKey(a, b);
    var junkPick = theme.junk[hashStr(key) % theme.junk.length];
    if (theme.junkSet[a] || theme.junkSet[b]) return junkPick;
    return theme.recipes[key] || junkPick;
  }

  function inRange(tier, range) { return tier >= range[0] && tier <= range[1]; }

  function dealTargets(theme, seed, playerCount) {
    var rng = makeRng("targets:" + seed);
    function candidates(range) {
      return theme.items.filter(function (it) {
        return it.cat !== "basic" && !theme.junkSet[it.id] && inRange(it.tier, range);
      }).map(function (it) { return it.id; });
    }
    var mids = shuffle(candidates(MID_TIERS), rng);
    var highs = shuffle(candidates(HIGH_TIERS), rng);
    if (mids.length < playerCount || highs.length < playerCount * 2) throw new Error("not-enough-targets");
    var out = [];
    for (var i = 0; i < playerCount; i++) out.push([mids[i], highs[i * 2], highs[i * 2 + 1]]);
    return out;
  }

  function newGame(theme, opts) {
    var targets = dealTargets(theme, opts.seed, opts.names.length);
    return {
      version: 1,
      themeId: theme.id,
      seed: opts.seed,
      mode: opts.mode,
      players: opts.names.map(function (name, i) {
        return { id: "p" + (i + 1), name: name, targets: targets[i], done: [] };
      }),
      pool: theme.basics.slice(),
      round: 1,
      turn: 0,
      log: [],
      winner: null,
      prev: null
    };
  }

  function currentPlayer(state) { return state.players[state.turn]; }

  function applyCombine(theme, state, a, b) {
    if (state.winner) throw new Error("game-over");
    if (state.pool.indexOf(a) < 0 || state.pool.indexOf(b) < 0) throw new Error("not-in-pool");
    var snap = clone(state);
    snap.prev = null; // 只保留一層復原
    var next = clone(snap);
    next.prev = snap;
    var result = combine(theme, a, b);
    var isNew = next.pool.indexOf(result) < 0;
    if (isNew) next.pool.push(result);
    var p = next.players[next.turn];
    var achieved = p.targets.indexOf(result) >= 0 && p.done.indexOf(result) < 0;
    if (achieved) p.done.push(result);
    var entry = { round: next.round, playerId: p.id, a: a, b: b, result: result, isNew: isNew, achieved: achieved };
    next.log.push(entry);
    if (p.done.length >= p.targets.length) {
      next.winner = p.id;
    } else {
      next.turn += 1;
      if (next.turn >= next.players.length) { next.turn = 0; next.round += 1; }
    }
    return { state: next, entry: entry };
  }

  function undo(state) { return state && state.prev ? state.prev : null; }

  // 已知會合出廢料的組合：材料本身是廢料，或遊戲紀錄中同一組合（不分順序）合出過廢料。
  // 回傳 { result: 廢料 id 或 null, junkMaterial: 是否因材料是廢料 }；不是已知廢料則回傳 null。
  // 只看紀錄，不偷看配方表，所以不會洩漏「沒試過的組合」是否有配方。
  function knownJunk(theme, state, a, b) {
    if (theme.junkSet[a] || theme.junkSet[b]) return { result: null, junkMaterial: true };
    var key = pairKey(a, b);
    for (var i = state.log.length - 1; i >= 0; i--) {
      var e = state.log[i];
      if (theme.junkSet[e.result] && pairKey(e.a, e.b) === key) return { result: e.result, junkMaterial: false };
    }
    return null;
  }

  // 把廢料移出池子（不算回合）。上一步的快照也一併清掉，復原時廢料不會跑回來。
  function clearJunk(theme, state) {
    var next = clone(state);
    function strip(s) { s.pool = s.pool.filter(function (id) { return !theme.junkSet[id]; }); }
    strip(next);
    if (next.prev) strip(next.prev);
    return next;
  }

  // 分別裝置模式：手機只需要主題、seed、人數、自己的編號，就能算出自己的任務（不同步）
  function joinParam(state, index) {
    return [state.themeId, state.seed, state.players.length, index].join(".");
  }

  function parseJoin(str) {
    var parts = String(str || "").split(".");
    if (parts.length !== 4) return null;
    var count = parseInt(parts[2], 10);
    var index = parseInt(parts[3], 10);
    if (!/^[a-z0-9_]+$/.test(parts[0]) || !/^[0-9a-zA-Z]+$/.test(parts[1])) return null;
    if (!(count >= MIN_PLAYERS && count <= MAX_PLAYERS) || !(index >= 0 && index < count)) return null;
    return { themeId: parts[0], seed: parts[1], count: count, index: index };
  }

  // ---------------- 語音指令（只做字串解析；麥克風／朗讀在 gousei.js） ----------------
  // 辨識結果的漢字／假名不穩定：片假名一律轉平假名、去掉空白與標點後再比對。
  // 同音字（雷加水 → 累家稅）靠拼音比對：setPinyin() 載入「拼音 → 漢字」表（static_src/gousei_pinyin.js）後，
  //   每個字轉成寬鬆化的無聲調拼音，名稱與辨識結果在「字」與「拼音」兩種層次都比對，取較高者。
  // 正規化後一個字對應一個 token，所以字串位置與 token 位置一致，可以直接用同一個 index 切開。

  function toHiragana(s) {
    return s.replace(/[ァ-ヶ]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0x60); });
  }

  function normSpeech(s) {
    return toHiragana(String(s || "").toLowerCase()).replace(/[\s、。，,.．!！?？「」『』・…~〜"'“”:：;；]/g, "");
  }

  var pinyinOf = null; // 字 → 寬鬆拼音；setPinyin() 之後才有

  // 台灣口音常見的混用：zh/ch/sh ≈ z/c/s、ing/eng ≈ in/en、n ≈ l
  function fuzzySyllable(s) {
    return s.replace(/^([zcs])h/, "$1").replace(/([ie])ng$/, "$1n").replace(/^n(?=[aeiouv])/, "l");
  }

  function setPinyin(table) {
    pinyinOf = {};
    Object.keys(table || {}).forEach(function (py) {
      var f = fuzzySyllable(py);
      var chars = table[py];
      for (var i = 0; i < chars.length; i++) pinyinOf[chars.charAt(i)] = f;
    });
  }

  function tokens(n) {
    var out = [];
    for (var i = 0; i < n.length; i++) {
      var c = n.charAt(i);
      out.push(pinyinOf && pinyinOf[c] ? pinyinOf[c] : c);
    }
    return out;
  }

  function levenshtein(a, b) {
    var prev = [], cur, i, j;
    for (j = 0; j <= b.length; j++) prev.push(j);
    for (i = 1; i <= a.length; i++) {
      cur = [i];
      for (j = 1; j <= b.length; j++) {
        cur.push(Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)));
      }
      prev = cur;
    }
    return prev[b.length];
  }

  // ---- 音節的「聽起來像不像」 ----
  // 辨識器會把聽不懂的外語音節換成任意同類音（yo アキ → 幼兒體：a→兒、ki→體），
  // 所以喚醒詞以「聲母類別 × 韻母類別」比對，而不是列舉寫法。
  var PY_INITIALS = ["zh", "ch", "sh", "b", "p", "m", "f", "d", "t", "n", "l", "g", "k", "h", "j", "q", "x", "r", "z", "c", "s", "y", "w"];
  var INITIAL_CLASS = { j: "jqx", q: "jqx", x: "jqx", z: "zcs", c: "zcs", s: "zcs", d: "dt", t: "dt", g: "gkh", k: "gkh", h: "gkh",
    b: "bp", p: "bp", m: "mnl", n: "mnl", l: "mnl", f: "f", r: "r", y: "zero", w: "zero", "": "zero" };
  var FINAL_CLASS = { i: "i", ei: "i", ie: "i", o: "o", ou: "o", ao: "o", uo: "o", ong: "o", iu: "o", iao: "o",
    a: "a", ai: "a", an: "a", ang: "a", ia: "a", e: "e", er: "e", en: "e", eng: "e", u: "u", ui: "u", un: "u", v: "u", ue: "u" };

  function splitSyllable(s) {
    if (!/^[a-z]+$/.test(s)) return null;
    for (var i = 0; i < PY_INITIALS.length; i++) {
      var ini = PY_INITIALS[i];
      if (s.length > ini.length && s.indexOf(ini) === 0) return [ini, s.slice(ini.length)];
    }
    return ["", s];
  }

  function partCost(a, b, classes) {
    if (a === b) return 0;
    return classes[a] && classes[a] === classes[b] ? 0.5 : 1;
  }

  // 0＝相同、0.5＝聲母或韻母只差同類、1＝不像
  function syllableCost(a, b) {
    if (a === b) return 0;
    var x = splitSyllable(a), y = splitSyllable(b);
    if (!x || !y) return 1;
    return Math.max(partCost(x[0], y[0], INITIAL_CLASS), partCost(x[1], y[1], FINAL_CLASS));
  }

  function levenshteinCost(a, b) {
    var prev = [], cur, i, j;
    for (j = 0; j <= b.length; j++) prev.push(j);
    for (i = 1; i <= a.length; i++) {
      cur = [i];
      for (j = 1; j <= b.length; j++) cur.push(Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + syllableCost(a[i - 1], b[j - 1])));
      prev = cur;
    }
    return prev[b.length];
  }

  function syllableIs(s, initials, finalClasses) {
    var p = splitSyllable(s);
    return !!p && initials.indexOf(p[0]) >= 0 && finalClasses.indexOf(FINAL_CLASS[p[1]]) >= 0;
  }

  // 喚醒詞「yo, アキ」。
  //   字面：「秋」「亜紀」等一般詞彙（物體名稱也有「秋」）必須前面接 yo 才算。
  //   拼音：yo（零聲母／y ＋ o 類韻母：有、要、幼、喲）＋ a（零聲母母音：阿、啊、兒、愛）
  //        ＋ ki（j q x d t g k ＋ i／ei：基、奇、西、體、地、幾）。z c s（子、十）不算，避免「有兒子」「有二十」。
  //   英文：「yo aki」「you a key」。
  //   訓練：玩家自己說過的喚醒詞（templates，見 matchWakeTemplates）。
  var WAKE_YO = ["yo", "よー", "よう", "よぉ", "よ", "ヨ", "夜", "陽", "洋", "喲", "唷", "呦", "哟"].map(normSpeech);
  var WAKE_AKI = ["aki", "アキ", "阿基", "阿奇", "阿琪", "阿吉", "阿姬", "阿紀", "阿祺", "阿齊", "阿琦", "阿岐"].map(normSpeech);
  var WAKE_AKI_WEAK = ["秋", "亜紀", "亜希", "安芸", "阿木", "明", "空き", "飽き"].map(normSpeech);
  var WAKE_KANA = /(よ[うーぉお]?|ゆ[うー]?|お)[ー]?[あわ][ー]?(き|ち|け|ぎ|てぃ)/;
  var WAKE_LATIN = /(yo|you|yoh)(a|ah)?(ki|key|kee|chi|qi)/;
  var WAKE_LATIN_START = /^(aki|akey|akee)/;

  function isWakeYo(s) { return syllableIs(s, ["", "y"], ["o"]); }
  function isWakeA(s) { return syllableIs(s, [""], ["a", "e", "o"]); }
  function isWakeKi(s) { return syllableIs(s, ["j", "q", "x", "d", "t", "g", "k"], ["i"]); }

  // 訓練過的喚醒詞：在辨識結果裡找與任一範本「拼音距離」夠近的片段。
  // 3 音節以下只容許同類音的差異（距離 ≤ 0.5）；4 音節以上容許差一個音節。朗讀中只接受完全一致。
  function matchWakeTemplates(n, templates, strict) {
    if (!templates || !templates.length) return null;
    var t = tokens(n);
    var best = null;
    templates.forEach(function (tp) {
      var tt = tokens(normSpeech(tp));
      var L = tt.length;
      if (!L) return;
      var allowed = strict ? 0 : (L >= 4 ? 1 : (L >= 2 ? 0.5 : 0));
      for (var w = Math.max(1, L - 1); w <= L + 1; w++) {
        for (var i = 0; i + w <= t.length; i++) {
          var d = levenshteinCost(t.slice(i, i + w), tt);
          if (d <= allowed && (!best || d < best.d || (d === best.d && i < best.i))) best = { d: d, i: i, end: i + w };
        }
      }
    });
    return best ? { rest: n.slice(best.end) } : null;
  }

  // strict = 朗讀中：喇叭的聲音可能被收音，只接受有 yo 開頭的完整喚醒詞
  function detectWake(text, strict, templates) {
    var n = normSpeech(text);
    var trained = matchWakeTemplates(n, templates, strict);
    if (trained) return trained;
    // 字面
    var lists = [[WAKE_AKI, false], [WAKE_AKI_WEAK, true]];
    for (var l = 0; l < lists.length; l++) {
      var words = lists[l][0], needYo = lists[l][1] || strict;
      for (var w = 0; w < words.length; w++) {
        var idx = n.indexOf(words[w]);
        while (idx >= 0) {
          var hasYo = false;
          for (var y = 0; y < WAKE_YO.length; y++) {
            if (idx >= WAKE_YO[y].length && n.slice(idx - WAKE_YO[y].length, idx) === WAKE_YO[y]) { hasYo = true; break; }
          }
          if (hasYo || (!needYo && idx === 0)) return { rest: n.slice(idx + words[w].length) };
          idx = n.indexOf(words[w], idx + 1);
        }
      }
    }
    // 假名（日文辨識）
    var m = WAKE_KANA.exec(n);
    if (m) return { rest: n.slice(m.index + m[0].length) };
    // 拼音
    if (pinyinOf) {
      var t = tokens(n);
      for (var i = 0; i + 2 < t.length; i++) {
        if (isWakeYo(t[i]) && isWakeA(t[i + 1]) && isWakeKi(t[i + 2])) return { rest: n.slice(i + 3) };
      }
      // 「亞基」（yo+a 連在一起）、「阿吉」（沒聽到 yo）：只在開頭、且不是朗讀中才算
      if (!strict && t.length >= 2 && (t[0] === "ya" || isWakeA(t[0])) && isWakeKi(t[1])) return { rest: n.slice(2) };
    }
    // 英文
    m = WAKE_LATIN.exec(n);
    if (m) return { rest: n.slice(m.index + m[0].length) };
    if (!strict) {
      m = WAKE_LATIN_START.exec(n);
      if (m) return { rest: n.slice(m[0].length) };
    }
    return null;
  }

  var COMBO_SEPS = ["加上", "加", "和", "跟", "與", "与", "配上", "配", "+", "＋", "プラス", "たす", "足す", "と", "plus", "and"].map(normSpeech);
  // 同音的分隔詞（家、佳、河、根…）：拼音一致就當作分隔候選，切錯的位置會因為比對分數低而被淘汰
  var COMBO_SEPS_PY = [["jia", "shang"], ["jia"], ["he"], ["gen"], ["yu"]].map(function (s) { return s.map(fuzzySyllable); });
  var COMBO_HEAD = ["我要", "我想", "請", "把"].map(normSpeech);
  var COMBO_TAIL = ["を合成してください", "を合成して", "を合成", "合成してください", "合成して", "してください", "合成", "して",
    "ください", "です", "吧", "で"].map(normSpeech);
  var COMBO_MIN_SCORE = 0.6;
  var PINYIN_PENALTY = 0.05; // 只有讀音一樣時，略低於字面完全一致

  // 池子編號（1 起算，＝池子順序）：「3」「三」「第三個」「7號」「3番」。數字是辨識最穩定的內容。
  var CN_DIGITS = { "零": 0, "〇": 0, "一": 1, "二": 2, "兩": 2, "两": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9 };

  function parseSpokenNumber(s) {
    s = s.replace(/^(第|だい)/, "").replace(/(號|号|個|个|番目|番|ばんめ|ばん)$/, "");
    if (/^[0-9０-９]+$/.test(s)) {
      return parseInt(s.replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xfee0); }), 10);
    }
    if (!s || !/^[零〇一二兩两三四五六七八九十百]+$/.test(s)) return null;
    var total = 0, cur = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s.charAt(i);
      if (c === "十") { total += (cur || 1) * 10; cur = 0; }
      else if (c === "百") { total += (cur || 1) * 100; cur = 0; }
      else cur = CN_DIGITS[c];
    }
    return total + cur;
  }

  // 確認提問的回答：true＝對、false＝不對、null＝都不是。否定詞先判斷（「不對」含「對」）
  var ANSWER_NO = ["不", "錯", "错", "取消", "いいえ", "ちがう", "違", "だめ", "やめ", "no"].map(normSpeech);
  var ANSWER_YES = ["對", "对", "是", "好", "確定", "确定", "沒錯", "可以", "嗯", "合成", "はい", "うん", "そう", "ええ", "おっけー",
    "ok", "yes"].map(normSpeech);

  function parseYesNo(text) {
    var n = normSpeech(text);
    if (!n) return null;
    for (var i = 0; i < ANSWER_NO.length; i++) if (n.indexOf(ANSWER_NO[i]) >= 0) return false;
    for (var j = 0; j < ANSWER_YES.length; j++) if (n.indexOf(ANSWER_YES[j]) >= 0) return true;
    return null;
  }

  // 「A 加 B」→ 池子裡最像的兩個物體（廢料不列入候選）。各段也可以是池子編號（「3 加 7」）。
  // 回傳的 exact＝兩段都是字面完全一致或編號；只靠讀音或近似比對時為 false（UI 會先確認再合成）。
  // 每一段的相似度（字面或拼音的 1−編輯距離／長度）都要 ≥ 0.6（兩個字錯一個不算），否則回傳 null。
  function parseVoiceCombo(theme, pool, text) {
    var n = normSpeech(text);
    var changed = true;
    while (changed && n) {
      changed = false;
      COMBO_HEAD.forEach(function (h) { if (n.indexOf(h) === 0 && n.length > h.length) { n = n.slice(h.length); changed = true; } });
      COMBO_TAIL.forEach(function (s) {
        if (n.length > s.length && n.slice(-s.length) === s) { n = n.slice(0, -s.length); changed = true; }
      });
    }
    if (!n) return null;
    var nt = tokens(n);
    var cands = [];
    function addCand(id, name) {
      var s = normSpeech(name);
      if (s) cands.push({ id: id, s: s, t: tokens(s) });
    }
    pool.forEach(function (id) {
      if (theme.junkSet[id] || !theme.byId[id]) return;
      var it = theme.byId[id];
      addCand(id, it.zh);
      if (it.ja !== it.zh) addCand(id, it.ja);
    });
    var memo = {};
    function bestFor(from, to) {
      var key = from + ":" + to;
      if (memo.hasOwnProperty(key)) return memo[key];
      var s = n.slice(from, to), t = nt.slice(from, to);
      var best = null;
      var num = parseSpokenNumber(s);
      if (num !== null && num >= 1 && num <= pool.length && !theme.junkSet[pool[num - 1]] && theme.byId[pool[num - 1]]) {
        memo[key] = { id: pool[num - 1], score: 1 };
        return memo[key];
      }
      for (var i = 0; i < cands.length; i++) {
        var c = cands[i];
        var len = Math.max(s.length, c.s.length);
        if (Math.abs(s.length - c.s.length) > len / 2) continue;
        var score = s === c.s ? 1 : 1 - levenshtein(s, c.s) / len;
        if (pinyinOf && score < 1) score = Math.max(score, 1 - levenshtein(t, c.t) / len - PINYIN_PENALTY);
        if (!best || score > best.score) best = { id: c.id, score: score };
      }
      memo[key] = best;
      return best;
    }
    var result = null;
    function trySplit(at, sepLen, exactOnly) {
      if (at <= 0 || at + sepLen >= n.length) return;
      var a = bestFor(0, at), b = bestFor(at + sepLen, n.length);
      if (!a || !b) return;
      var min = Math.min(a.score, b.score);
      if (exactOnly && min < 1 - PINYIN_PENALTY) return;
      var score = min + (a.score + b.score) / 1000;
      if (min >= COMBO_MIN_SCORE && (!result || score > result.score)) result = { a: a.id, b: b.id, score: score, exact: min >= 1 };
    }
    COMBO_SEPS.forEach(function (sep) {
      var idx = n.indexOf(sep, 1);
      while (idx > 0) {
        trySplit(idx, sep.length, false);
        idx = n.indexOf(sep, idx + 1);
      }
    });
    if (pinyinOf) {
      COMBO_SEPS_PY.forEach(function (sep) {
        for (var i = 1; i + sep.length < nt.length; i++) {
          var hit = true;
          for (var k = 0; k < sep.length; k++) if (nt[i + k] !== sep[k]) { hit = false; break; }
          if (hit) trySplit(i, sep.length, false);
        }
      });
    }
    // 沒說「加」：例如「火水」，只接受兩段都完全一致（讀音一致也可）
    for (var i = 1; i < n.length; i++) trySplit(i, 0, true);
    return result;
  }

  window.PriTestGouseiCore = {
    MID_TIERS: MID_TIERS,
    HIGH_TIERS: HIGH_TIERS,
    MIN_PLAYERS: MIN_PLAYERS,
    MAX_PLAYERS: MAX_PLAYERS,
    hashStr: hashStr,
    makeRng: makeRng,
    newSeed: newSeed,
    pairKey: pairKey,
    indexTheme: indexTheme,
    combine: combine,
    dealTargets: dealTargets,
    newGame: newGame,
    currentPlayer: currentPlayer,
    applyCombine: applyCombine,
    undo: undo,
    knownJunk: knownJunk,
    clearJunk: clearJunk,
    joinParam: joinParam,
    parseJoin: parseJoin,
    normSpeech: normSpeech,
    detectWake: detectWake,
    parseVoiceCombo: parseVoiceCombo,
    setPinyin: setPinyin,
    parseSpokenNumber: parseSpokenNumber,
    parseYesNo: parseYesNo
  };
})();
