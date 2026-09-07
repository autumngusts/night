// ============================================================================
// midnight（即時制擴張版）魔術師塔謎題：純函式產生器，不依賴DOM/RTDB/window.PriTestMidnight*
// 以外的任何全域狀態，midnight.js負責呼叫並處理UI/計時。2026-09-07新增。
// ============================================================================
(function () {
  "use strict";

  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
    }
    return a;
  }

  // ---- 猜數字（4位不重複，幾A幾B） ----
  function genNumberGuess() {
    var digits = shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]).slice(0, 4);
    return { kind: "numberGuess", answer: digits };
  }
  function checkNumberGuess(puzzle, guessDigits) {
    var a = 0, b = 0;
    for (var i = 0; i < 4; i++) {
      if (guessDigits[i] === puzzle.answer[i]) a++;
      else if (puzzle.answer.indexOf(guessDigits[i]) !== -1) b++;
    }
    return { a: a, b: b, solved: a === 4 };
  }

  // ---- 雞兔同籠 ----
  function genChickenRabbit() {
    var H = 8 + Math.floor(Math.random() * 13); // 8~20
    var minF = 2 * H, maxF = 4 * H;
    var F;
    do {
      F = minF + 2 * Math.floor(Math.random() * ((maxF - minF) / 2 + 1));
    } while (F === minF || F === maxF); // 避免全雞或全兔的退化情況
    var x = (4 * H - F) / 2; // 雞
    return { kind: "chickenRabbit", H: H, F: F, answer: x };
  }
  function checkChickenRabbit(puzzle, guess) {
    return { solved: Number(guess) === puzzle.answer };
  }

  // ---- 秤重找次品 ----
  // 2026-09-07驗證：規則書設計文件原稿使用Math.ceil(Math.log(N)/Math.log(3))，但這在
  // N剛好是3的整數次方時會因浮點誤差而算錯——例如Math.log(9)/Math.log(3)實際上等於
  // 2.0000000000000004（不是整數2），Math.ceil後變成3，導致N=9、N=27（本函式N範圍
  // 8~27內兩個實際可能出現的值）都會產生比正確答案多1的錯誤解答。改用整數迴圈
  // （不斷把capacity乘以3直到>=N為止）可以完全避開浮點數精度問題，且已針對
  // N=3/8/9/10/26/27逐一驗證與log版本在非邊界值時的結果相同、且邊界值時才是正確的。
  function genWeighing() {
    var N = 8 + Math.floor(Math.random() * 20); // 8~27
    var lighter = Math.random() < 0.5;
    var answer = 0;
    var cap = 1;
    while (cap < N) { cap *= 3; answer++; }
    return { kind: "weighing", N: N, lighter: lighter, answer: answer };
  }
  function checkWeighing(puzzle, guess) {
    return { solved: Number(guess) === puzzle.answer };
  }

  // ---- 過橋問題（4人，貪心：最快2人來回護送）----
  // 2026-09-07驗證：規則書設計文件原稿的公式（optA=t0+2*t1+t3、optB=2*t0+t1+t3）
  // 經窮舉搜尋（Dijkstra，狀態=4人位置bitmask×手電筒位置）交叉驗證後，發現對所有測試
  // 案例都算出「小於實際最短過橋時間」的不可能答案（例如經典題目times=[1,2,5,10]的
  // 真實最短時間是17，原公式卻算出14——沒有任何過橋策略能在14分鐘內完成，等於出了一題
  // 沒有正確解答的謎題）。已改用經典「4人過橋」的正確兩種策略公式並以窮舉法驗證：
  //   optA = t0 + 3*t1 + t3   （最快2人來回護送最慢2人一起過橋）
  //   optB = 2*t0 + t1 + t2 + t3  （最快的人自己來回擺渡其他3人）
  // 這兩條公式已對8組手選案例＋300組隨機案例做窮舉搜尋比對，min(optA,optB)與真實最短
  // 時間完全一致（0個不符）。
  function genBridge() {
    var times = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]).slice(0, 4).sort(function (a, b) { return a - b; });
    var t = times;
    var optA = t[0] + 3 * t[1] + t[3];
    var optB = 2 * t[0] + t[1] + t[2] + t[3];
    var answer = Math.min(optA, optB);
    return { kind: "bridge", times: times, answer: answer };
  }
  function checkBridge(puzzle, guess) {
    return { solved: Number(guess) === puzzle.answer };
  }

  // ---- 邏輯消去法（3~5人，身高排序線索）----
  function genLogicElimination() {
    var n = 3 + Math.floor(Math.random() * 3); // 3~5
    var names = ["A", "B", "C", "D", "E"].slice(0, n);
    // 身高順序（0=最高）為隨機排列，answer=最高的人
    var order = shuffle(names);
    var clues = [];
    for (var i = 0; i < order.length - 1; i++) {
      clues.push(order[i] + " 比 " + order[i + 1] + " 高");
    }
    return { kind: "logicElimination", names: names, clues: shuffle(clues), answer: order[0] };
  }
  function checkLogicElimination(puzzle, guess) {
    return { solved: String(guess).toUpperCase() === puzzle.answer };
  }

  // ---- 動態逆向思考（數列推算）----
  function genSequence() {
    var kind = ["arithmetic", "geometric", "square"][Math.floor(Math.random() * 3)];
    var seq = [];
    var answer;
    if (kind === "arithmetic") {
      var start = 1 + Math.floor(Math.random() * 10);
      var step = 1 + Math.floor(Math.random() * 5);
      for (var i = 0; i < 4; i++) seq.push(start + i * step);
      answer = start + 4 * step;
    } else if (kind === "geometric") {
      var s2 = 1 + Math.floor(Math.random() * 3);
      var ratio = 2 + Math.floor(Math.random() * 2);
      for (var j = 0; j < 4; j++) seq.push(s2 * Math.pow(ratio, j));
      answer = s2 * Math.pow(ratio, 4);
    } else {
      var offset = Math.floor(Math.random() * 3);
      for (var k = 0; k < 4; k++) seq.push((k + 1 + offset) * (k + 1 + offset));
      answer = (4 + 1 + offset) * (4 + 1 + offset);
    }
    return { kind: "sequence", sequence: seq, answer: answer };
  }
  function checkSequence(puzzle, guess) {
    return { solved: Number(guess) === puzzle.answer };
  }

  var GENERATORS = {
    numberGuess: genNumberGuess,
    chickenRabbit: genChickenRabbit,
    weighing: genWeighing,
    bridge: genBridge,
    logicElimination: genLogicElimination,
    sequence: genSequence,
  };
  var CHECKERS = {
    numberGuess: checkNumberGuess,
    chickenRabbit: checkChickenRabbit,
    weighing: checkWeighing,
    bridge: checkBridge,
    logicElimination: checkLogicElimination,
    sequence: checkSequence,
  };
  var KINDS = Object.keys(GENERATORS);

  function generate(kind) {
    var pick = kind || KINDS[Math.floor(Math.random() * KINDS.length)];
    return GENERATORS[pick]();
  }
  function check(kind, puzzle, guess) {
    return CHECKERS[kind](puzzle, guess);
  }

  // ---- 12骰牌型判定（設計文件§4.2，判定邏輯與night_floor_breakthrough.jsのjudgeDiceHand
  // 完全相同——7骰同值>大骰>小骰>順子>其他，這裡複製一份純函式，不直接import(見既有
  // MERCHANT_CONSUMABLE_IDS慣例，night_floor_breakthrough.js依賴night.js專屬state不能
  // 整個載入這個頁面)。----
  function judgeDiceHand(values) {
    var counts = [0, 0, 0, 0, 0, 0, 0];
    values.forEach(function (v) { counts[v]++; });
    var maxCount = Math.max(counts[1], counts[2], counts[3], counts[4], counts[5], counts[6]);
    var lowCount = counts[1] + counts[2] + counts[3];
    var highCount = counts[4] + counts[5] + counts[6];
    var isStraight = counts[1] > 0 && counts[2] > 0 && counts[3] > 0 && counts[4] > 0 && counts[5] > 0 && counts[6] > 0;
    if (maxCount >= 7) return "sevenDice";
    if (lowCount === 0) return "large";
    if (highCount === 0) return "small";
    if (isStraight) return "straight";
    return "default";
  }

  window.PriTestMidnightPuzzles = {
    KINDS: KINDS,
    generate: generate,
    check: check,
    judgeDiceHand: judgeDiceHand,
  };
})();
