(function () {
  // 自動化GM Phase 2：シナリオ進行フロー（進度版の[進入]/[突破]・GM敘述・獎勵収集ゲート）。
  // auto_gm.js（Phase 1：戦闘中の敵行動ロール）とは別軸の機能で、こちらはUI操作と
  // state書き込みの両方を行う（night_floor_breakthrough.js/night_event_chips.jsと同じ立ち位置の
  // night.js別クロージャモジュール）。window.PriTestNightCore経由でnight.js側のstate/save/rerenderに
  // アクセスする。GMの操作・敘述はすべて既存の鵝黃色進度版（#location-status-overlay）内で完結させ、
  // 公開盤面の地図側には一切ボタンを追加しない。

  // シナリオのbossId（scenarios.js）と、世界観データ（worldview.js）の夜の王ストーリーセクション
  // （night_king_1〜10）との対応表。両者にIDによる直接リンクが無いため、scenarios.jsの
  // name/bossNameとworldview.jsのtitleを突き合わせて確認した（推測ではなく、既存データ同士の
  // 文字列一致による裏取り）：
  //   night_king_1「三つ首の獣」= tricephalos.name（bossId: gladius）
  //   night_king_2「喰らいつく顎」= gaping_jaw.name（bossId: edele）
  //   night_king_3「知性の蟲」= sentient_pest.name（bossId: gnoster）
  //   night_king_4「兆し」= augur.name（bossId: maris）
  //   night_king_5「夜の魔、リスラ」= equilibrious_beast.bossName（bossId: libra）
  //   night_king_6「闇駆ける狩人「夜光の騎士、フルゴール」」= darkdrift_knight.name+bossName（bossId: fulghor）
  //   night_king_7「霧の裂け目 夜の霞、カリゴ」= fissure_in_the_fog.name+bossName（bossId: caligo）
  //   night_king_8「救いの旗手(...ハルモニア)」= balancers.bossName（bossId: harmonia）
  //   night_king_9「反逆のストラゲス(...)」= dreglord.bossName（bossId: stragedes）
  //   night_king_10「夜の輪郭(...ナメレス)」= night_aspect.bossName（bossId: nameless）
  var BOSS_ID_TO_WORLDVIEW_ID = {
    gladius: "night_king_1",
    edele: "night_king_2",
    gnoster: "night_king_3",
    maris: "night_king_4",
    libra: "night_king_5",
    fulghor: "night_king_6",
    caligo: "night_king_7",
    harmonia: "night_king_8",
    stragedes: "night_king_9",
    nameless: "night_king_10",
  };

  // ---- 汎用打字機ヘルパー（第1項） ----
  // 短い間隔でチャンクずつ文字を追加していく、単純な漸進表示。要素ごとに直前のタイマーを
  // 記録しておき、再呼び出し時は前のアニメーションを確実に止めてから始める（同じ要素に対して
  // 二重に動き続けることがないようにする）。
  var activeTimers = new WeakMap();

  function stopTypewriter(el) {
    var timer = activeTimers.get(el);
    if (timer) {
      clearInterval(timer);
      activeTimers.delete(el);
    }
    el.classList.remove("gm-flow-typing");
  }

  function typewriteInto(el, text, opts) {
    opts = opts || {};
    var chunkSize = opts.chunkSize || 2;
    var intervalMs = opts.intervalMs || 28;
    stopTypewriter(el);
    el.textContent = "";
    if (!text) {
      if (opts.onDone) opts.onDone();
      return;
    }
    el.classList.add("gm-flow-typing");
    var i = 0;
    var timer = setInterval(function () {
      i += chunkSize;
      el.textContent = text.slice(0, i);
      if (i >= text.length) {
        stopTypewriter(el);
        if (opts.onDone) opts.onDone();
      }
    }, intervalMs);
    activeTimers.set(el, timer);
  }

  // ---- 夜の王〔開場〕の取得（第11項） ----
  function extractOpeningText(section) {
    var blocks = section.blocks || [];
    var collecting = false;
    var parts = [];
    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i];
      if (b.kind === "label") {
        if (collecting) break; // 次のlabel（通常はエンディング）に到達したら終了
        collecting = true; // 最初のlabelがオープニング/開場ラベル自体
        continue;
      }
      if (collecting && b.kind === "text") {
        parts.push(window.PriTestWorldview.localizedText(b.body));
      }
    }
    return parts.join("\n\n");
  }

  function resolveOpeningNarrationText() {
    var Core = window.PriTestNightCore;
    var Worldview = window.PriTestWorldview;
    if (!Worldview) return null;
    var scenario = Core.getScenario();
    if (!scenario || !scenario.bossId) return null;
    var worldviewId = BOSS_ID_TO_WORLDVIEW_ID[scenario.bossId];
    if (!worldviewId) return null;
    var section = Worldview.list().filter(function (s) {
      return s.id === worldviewId;
    })[0];
    if (!section) return null;
    return extractOpeningText(section);
  }

  // ゲーム読み込み直後に1度だけ呼ばれる（night.js DOMContentLoaded、loadState()直後）。
  // すでに開場済み・機能OFF・敘述表示中のいずれかならなにもしない。
  function maybeShowOpeningNarration() {
    var Core = window.PriTestNightCore;
    var state = Core.state;
    if (!state.gmFlowEnabled || state.gmFlow.openingPlayed || state.gmFlow.awaitingOk) return;
    var text = resolveOpeningNarrationText();
    if (!text) return;
    state.gmFlow.narrationText = text;
    state.gmFlow.awaitingOk = true;
    state.gmFlow.actionKind = "ok";
    Core.saveState();
  }

  // ---- 進度版内の[進入]/[突破]/[OK]表示（第2・4項） ----
  var lastTypedNarration = null;

  function renderNarrationInto(text) {
    var p = document.getElementById("location-status-narration");
    if (!p) return;
    if (text === lastTypedNarration) {
      p.textContent = text; // 同じ敘述の再描画（他の状態変化での再render）はアニメーションし直さない
      return;
    }
    lastTypedNarration = text;
    typewriteInto(p, text);
  }

  // ---- [進入]：規則書の分岐/樓層本文（branches[].floors[].lines[]）を順に敘述する（第16項改） ----
  // 「(→XXX)」「(→XXX)(→YYY)」のような選択肢/分岐マーカーを検出する。規則書の表記ルール
  // （docs/scenario_flow_rules.md §4「描写・行為判定・分岐の表記ルール」）に準拠。
  // 第27項で判明：実データの大多数（zh側はほぼ全て、ja側も過半）は全角括弧「（→X）」で
  // 書かれており、旧・半角のみの正規表現では検出漏れが大量発生していた（zh基準で約93%が
  // 未検出）——全角/半角どちらの括弧も受け付けるよう修正。「→→X」「→→→X」のような複数
  // 矢印（規則書の入れ子表記）は、矢印の数を問わず末尾のラベル文字列だけを取り出す
  // （このアプリでは深さの違いを区別せず、単に「選択肢を提示→クリック→続きを敘述」という
  // 順送りで表現する既存方針のまま）。
  var CHOICE_MARKER_RE = /[（(]→+([^）)]+)[）)]/g;
  function parseChoiceLabels(text) {
    var labels = [];
    var re = new RegExp(CHOICE_MARKER_RE.source, "g");
    var m;
    while ((m = re.exec(text))) labels.push(m[1]);
    return labels;
  }

  // ---- 「行為判定」の自動擲骰（PC全員／それぞれ／各自が固定目標値へ個別に判定する形式のみ）----
  // 「協力 N×PC人数」のような党全員の骰子を合算する形式（既存の突破判定／判定發生UIの対象）
  // とは別物。ブラケット〈N|屬性〉がちょうど1つだけ・「協力」を含まない・「全員」「それぞれ」
  // 「各自」のいずれかを含む場合のみ対象とする。複数回連続判定・屬性選択式・特定の1名のみ
  // 行う任意判定などそれ以外の形式は対象外とし、従来通り生の文言をそのまま敘述する（安全側
  // ——このアプリが分岐先を誤って決め打ちしない、既存の"■"と同じ方針）。
  var ABILITY_CHECK_BRACKET_RE = /[〈<]\s*(\d+)\s*[|｜]\s*(フィジカル|體能|メンタル|精神|運試し|運気|運氣|任意の判定値|任意判定值|任意的判定值)\s*[〉>]/;
  var ABILITY_CHECK_STAT_MAP = {
    フィジカル: "physical",
    體能: "physical",
    メンタル: "mental",
    精神: "mental",
    運試し: "luck",
    運気: "luck",
    運氣: "luck",
    任意の判定値: "any",
    任意判定值: "any",
    任意的判定值: "any",
  };
  // ラベルは通常「行為判定」だが、東の地下砦「地上階層の踊り場」のように同一フロア内で
  // 連続する複数の判定を区別するため「行為判定1」「行為判定2」のように番号付きになっている
  // 場合もある（実データ確認済み、この1フロアのみ）——番号の有無を問わず同じ扱いでよい。
  var ABILITY_CHECK_LABEL_RE = /^行為判定\d*$/;
  function parseIndividualAbilityCheck(line) {
    if (!line.label || !ABILITY_CHECK_LABEL_RE.test(line.label.ja || "") || !ABILITY_CHECK_LABEL_RE.test(line.label.zh || "")) return null;
    var text = (line.text && line.text.ja) || "";
    if (!text || text.indexOf("協力") !== -1) return null;
    if (!/全員|それぞれ|各自/.test(text)) return null;
    // 「それぞれ任意で〜行うことができる」のように「それぞれ」があっても「任意で」（各PCの
    // 任意参加）が付いている場合は、全員必須の判定ではない——対象外として従来通りの
    // 生の文言敘述に委ねる（実データで確認済み：event_rulebook.jsのスカラベ事件）。
    if (text.indexOf("任意で") !== -1) return null;
    var re = new RegExp(ABILITY_CHECK_BRACKET_RE.source, "g");
    var matches = [];
    var m;
    while ((m = re.exec(text))) matches.push(m);
    if (matches.length !== 1) return null;
    var statKey = ABILITY_CHECK_STAT_MAP[matches[0][2]];
    if (!statKey) return null;
    return { target: parseInt(matches[0][1], 10), statKey: statKey, markerLabel: singleMarkerLabel(text) };
  }

  // 判定行自身の文中に「（→X）」マーカーがちょうど1つだけ埋め込まれている場合、そのラベルを
  // 返す（例："成否に関わらず、戦闘になる（→ボス戦闘）"のように、結果に関わらず合流する
  // 行き先を判定行自身が示しているケース）。0個または2個以上（曖昧）ならnull。
  function singleMarkerLabel(text) {
    var labels = parseChoiceLabels(text);
    return labels.length === 1 ? labels[0] : null;
  }

  // ---- 「行為判定」の自動擲骰（協力＝黨全員骰子加総の単純な1回判定のみ）----
  // 「協力 N×PC人数｜屬性」「協力 N｜屬性」形式で、属性が1種類・繰り返し回数の指定
  // （「2回」「3回」等）が無い単純な1回勝負のものだけを対象にする。複数属性の連続判定・
  // 繰り返し判定はここでは対象外とし、従来通り生の文言をそのまま敘述する（安全側——
  // このアプリが誤った回数/組み合わせで判定してしまわないように、既存の"■"と同じ方針）。
  function parseCooperativeAbilityCheck(line) {
    if (!line.label || (line.label.ja !== "行為判定" && line.label.zh !== "行為判定")) return null;
    var text = (line.text && line.text.ja) || "";
    if (!text || text.indexOf("協力") === -1) return null;
    if (/\d\s*回/.test(text)) return null; // 「を2回行う」等の繰り返し判定は対象外
    var statKeywordCount = (text.match(/フィジカル|メンタル|運試し|任意の判定値/g) || []).length;
    if (statKeywordCount !== 1) return null; // 複数属性の連続判定は対象外
    var parsed = window.PriTestNightFloorBreakthrough.parseBreakthroughCheckText(text);
    if (!parsed || parsed.special || !parsed.stat || typeof parsed.target !== "number") return null;
    return { target: parsed.target, perPC: !!parsed.perPC, statKey: parsed.stat, markerLabel: singleMarkerLabel(text) };
  }

  // ---- 「行為判定」の自動擲骰（特定の1名のPCだけが行う形式）----
  // 「弱点を狙うPC」「遺体を調べるPC」「探りに行くPC」「先頭を進むPCひとり」「任意のPC」
  // のように、「協力」でも「全員／それぞれ／各自」でもない、特定の（or GMが選ぶ）1名だけが
  // 行う判定。GMに「誰が行くか」を選ばせてから、その1名だけ自動で擲骰する。
  // 「〜てもよい」（行ってもよい／被ってもよい等）という任意参加の言い回しがある場合のみ
  // retryOnFail:trueとし、失敗するたびに（そのPCを除外して）別の玩家を選び直せるように
  // する——実データで確認済み：女神像イベント（card_k／event_rulebook.js）は両方とも
  // 「誰も判定を行わないなら」という明示的な離脱ルールを持ち、「1人でも成功すれば」という
  // 複数人が挑戦し得る前提の結果文言と対になっている。「〜こと」（行うこと）という命令形の
  // 場合は、既にその1名が確定している場面（例：既に「弱点を狙う」を選んだ後）なので、
  // 1回だけ判定して結果に関わらず先へ進む。
  function parseSinglePlayerCheck(line) {
    if (!line.label || (line.label.ja !== "行為判定" && line.label.zh !== "行為判定")) return null;
    var text = (line.text && line.text.ja) || "";
    if (!text || text.indexOf("協力") !== -1) return null;
    if (/全員|それぞれ|各自/.test(text)) return null; // 全員版（parseIndividualAbilityCheck）の対象
    if (/\d\s*回/.test(text)) return null; // 連続判定は対象外（安全側）
    var re = new RegExp(ABILITY_CHECK_BRACKET_RE.source, "g");
    var matches = [];
    var m;
    while ((m = re.exec(text))) matches.push(m);
    if (matches.length !== 1) return null;
    var statKey = ABILITY_CHECK_STAT_MAP[matches[0][2]];
    if (!statKey) return null;
    var retryOnFail = /てもよい/.test(text);
    return { target: parseInt(matches[0][1], 10), statKey: statKey, retryOnFail: retryOnFail, markerLabel: singleMarkerLabel(text) };
  }

  // ---- 「行為判定」自動擲骰（水辺の大教会「水辺を抜けて横の瓦礫から」専用：任意のPCが
  // 任意の順番・任意回数で個別に判定を繰り返し、累積成功回数が目標に達するまで続ける。
  // 失敗が一定回数溜まるたびに必要な成功回数が増える）----
  // 「PCは任意の順番でこれを行う。成否の結果は1回の判定ごとに確認すること」という、この
  // フロア特有の言い回しで検出する（実データ確認済み、この1箇所のみ・◇♣の2花色分岐で
  // それぞれ1回ずつ出現）。目標成功回数・失敗エスカレーション幅は判定行自身ではなく、
  // 直後の「成功1回ごと」「失敗1回ごと」ラベル行の本文から読み取る——呼び出し側
  // （advanceFieldWalk）でlines配列を参照して行う（この関数は判定行1行のみを見る）。
  // 「■」のHP損害量そのものは読み取らない・自動適用しない——GMが規則書通り手動で処理する、
  // 既存の"■"と同じ方針。
  // このフロアの判定行だけ、ブラケットが〈〉ではなく半角丸括弧"(11|任意の判定値)"という
  // 表記ゆれになっている（実データ確認済み、書き起こし表記の揺れ）——他の検出関数が使う
  // 共有ABILITY_CHECK_BRACKET_RE（〈〉/<>のみ）を緩めると、無関係な丸括弧付き文言まで
  // 誤って引っかけるおそれがあるため、この関数専用の別パターンとして丸括弧も受け付ける。
  var OPEN_ENDED_TALLY_BRACKET_RE = /[〈<(]\s*(\d+)\s*[|｜]\s*(フィジカル|體能|メンタル|精神|運試し|運気|運氣|任意の判定値|任意判定值|任意的判定值)\s*[〉>)]/;
  function parseOpenEndedTallyCheck(line) {
    if (!line.label || (line.label.ja !== "行為判定" && line.label.zh !== "行為判定")) return null;
    var text = (line.text && line.text.ja) || "";
    if (!text || text.indexOf("任意の順番で") === -1) return null;
    if (text.indexOf("判定ごとに確認する") === -1) return null;
    var re = new RegExp(OPEN_ENDED_TALLY_BRACKET_RE.source, "g");
    var matches = [];
    var m;
    while ((m = re.exec(text))) matches.push(m);
    if (matches.length !== 1) return null;
    var statKey = ABILITY_CHECK_STAT_MAP[matches[0][2]];
    if (!statKey) return null;
    return { target: parseInt(matches[0][1], 10), statKey: statKey };
  }

  // ---- 「行為判定」自動擲骰（坑道「白い結晶」専用：分岐ポイント累積 → 2枝分岐）----
  // このフロア一箇所にしか出現しない特殊な入れ子構造（既存の協力式／全員個別式のどちらの
  // 型にも当てはまらない——目標値に「×PC人数」が付かない一方、判定行自身の文中に2つの
  // （→X）マーカーを持ち、成否ではなく累積ポイントで行き先が決まる）ため、固有キーワード
  // 「分岐ポイント」で厳密に絞り込んで検出する（他フロアの類似文言を誤って引っかけない
  // よう安全側——既存の"■"と同じ方針）。
  function parseBranchPointTallyCheck(line) {
    if (!line.label || (line.label.ja !== "行為判定" && line.label.zh !== "行為判定")) return null;
    var text = (line.text && line.text.ja) || "";
    if (!text || text.indexOf("分岐ポイント") === -1) return null;
    var re = new RegExp(ABILITY_CHECK_BRACKET_RE.source);
    var m = re.exec(text);
    if (!m) return null;
    var statKey = ABILITY_CHECK_STAT_MAP[m[2]];
    if (!statKey) return null;
    var repeatMatch = /を\s*(\d+)\s*回行う/.exec(text);
    var repeat = repeatMatch ? parseInt(repeatMatch[1], 10) : 1;
    var markers = parseChoiceLabels(text);
    if (markers.length !== 2) return null;
    var lowMatch = /(\d+)\s*以下/.exec(text);
    if (!lowMatch) return null;
    return {
      target: parseInt(m[1], 10),
      statKey: statKey,
      repeat: repeat,
      highLabel: markers[0],
      lowLabel: markers[1],
      lowThreshold: parseInt(lowMatch[1], 10),
    };
  }

  // ---- 「行為判定」自動擲骰（坑道「白い結晶」専用：連続する2種の個別判定を、成功数で
  // 3段階「成功2回／成功1回／失敗2回」へ振り分ける）----
  // 「〜と〜を連続して行うこと」という、このフロア特有の言い回しで検出する（実データ確認済み、
  // この1箇所のみ——他の複数属性連続判定はこの言い回しを持たないため誤検出しない）。
  // 目標値に「×PC人数」が付かないため各PCが個別に判定するが、結果は黨全体で1つの階級として
  // 扱われる——(全体の判定回数のうち成功した回数)が全回成功なら「成功2回」、全敗なら
  // 「失敗2回」、それ以外（一部成功）は「成功1回」として最も近い階級を採用する。
  function parseSequentialPairCheck(line) {
    if (!line.label || (line.label.ja !== "行為判定" && line.label.zh !== "行為判定")) return null;
    var text = (line.text && line.text.ja) || "";
    if (!text || text.indexOf("連続して行う") === -1) return null;
    var re = new RegExp(ABILITY_CHECK_BRACKET_RE.source, "g");
    var matches = [];
    var m;
    while ((m = re.exec(text))) matches.push(m);
    if (matches.length !== 2) return null;
    var stat1 = ABILITY_CHECK_STAT_MAP[matches[0][2]];
    var stat2 = ABILITY_CHECK_STAT_MAP[matches[1][2]];
    if (!stat1 || !stat2) return null;
    return {
      checks: [
        { target: parseInt(matches[0][1], 10), statKey: stat1 },
        { target: parseInt(matches[1][1], 10), statKey: stat2 },
      ],
      markerLabel: singleMarkerLabel(text),
    };
  }

  // ---- 「行為判定」自動擲骰（湖沼(睡)「眠りの霧の鍾乳洞」専用：祭壇に興味があるかどうかを
  // 先に聞いてから、どちらの協力式判定を使うか決める）----
  // 「Xを優先するなら〈N1|attr〉を行うこと。Yが気になるなら〈N2|attr〉を行い、……」という、
  // このフロア特有の「なら」による二択の言い回しで検出する（実データ確認済み、この1箇所のみ）。
  // 選択肢のボタン文言は、この言い回しの各節（「なら」の直前）からそのまま切り出す——
  // 固有の物語文言（「祭壇」等）をこちら側で決め打ちしない、既存の"■"と同じ方針。
  function parseConditionalCooperativeChoice(line) {
    if (!line.label || (line.label.ja !== "行為判定" && line.label.zh !== "行為判定")) return null;
    var text = (line.text && line.text.ja) || "";
    if (!text || text.indexOf("なら") === -1) return null;
    var segments = text.split("なら");
    if (segments.length !== 3) return null; // ちょうど2回の「なら」（＝2択）のみ対象
    var label1 = segments[0].trim();
    var tailParts = segments[1].split(/[。、]/);
    var label2 = (tailParts[tailParts.length - 1] || "").trim();
    if (!label1 || !label2) return null;
    var Breakthrough = window.PriTestNightFloorBreakthrough;
    var check1 = Breakthrough.parseBreakthroughCheckText(segments[1]);
    var check2 = Breakthrough.parseBreakthroughCheckText(segments[2]);
    if (!check1 || !check2 || check1.special || check2.special || !check1.stat || !check2.stat) return null;
    if (check1.stat !== check2.stat) return null; // 属性が異なる場合は対象外（安全側）
    return {
      options: [
        { label: label1, target: check1.target, perPC: !!check1.perPC, statKey: check1.stat },
        { label: label2, target: check2.target, perPC: !!check2.perPC, statKey: check2.stat },
      ],
    };
  }

  // ---- 「行為判定」自動擲骰（東の地下砦「入り組んだ地下の回廊」専用：同じ屬性・異なる
  // 目標値の協力式判定を「順番に」複数回行い、途中で失敗したら即座にその段の結果へ
  // （ザコ戦闘／ボス戦闘等）合流し、途中で成功したら次の段へ進む連鎖）----
  // 「〜をそれぞれ順番に行うこと」という、このフロア特有の言い回しで検出する（実データ
  // 確認済み、この1箇所のみ）。既存のparseCooperativeAbilityCheckは属性キーワードが
  // 複数回（＝この形式）出現する場合を意図的に対象外としているため、そちらとは衝突しない。
  var COOP_CHAIN_BRACKET_RE = /[〈<]\s*協力\s*(\d+)\s*[×xX]\s*PC(?:の数|人数)\s*[|｜]\s*(フィジカル|體能|メンタル|精神|運試し|運気|運氣)\s*[〉>]/;
  function parseSequentialCooperativeChain(line) {
    if (!line.label || (line.label.ja !== "行為判定" && line.label.zh !== "行為判定")) return null;
    var text = (line.text && line.text.ja) || "";
    if (!text || text.indexOf("順番に行う") === -1) return null;
    var re = new RegExp(COOP_CHAIN_BRACKET_RE.source, "g");
    var matches = [];
    var m;
    while ((m = re.exec(text))) matches.push(m);
    if (matches.length < 2) return null;
    var stats = matches.map(function (mm) {
      return ABILITY_CHECK_STAT_MAP[mm[2]];
    });
    if (stats.indexOf(undefined) !== -1 || stats.some(function (s) { return s !== stats[0]; })) return null; // 属性が異なる場合は対象外（安全側）
    return {
      mode: "earlyExitChain",
      steps: matches.map(function (mm) {
        return { target: parseInt(mm[1], 10), statKey: ABILITY_CHECK_STAT_MAP[mm[2]] };
      }),
    };
  }

  // ---- 「行為判定」自動擲骰（水辺の大教会「正面から（梅花）」／発狂地帯「狂い火の塔3」／
  // 襲撃「三つ首の獣」「狼の気配2」共通：異なる屬性の協力式判定を「順番に」または
  // 「連続して」複数回行い、成否に関わらず全段を実行してから、総成功回数で結果を決める）----
  // 「〜を順番に／連続して行うこと。成否に関わらず／関係なく〜」という言い回しで検出する
  // （実データ確認済み——言い回しに表記ゆれがあるため両方を受け付ける）。属性が同じ場合は
  // parseSequentialCooperativeChain（早期終了あり）の対象になるため、こちらは属性が
  // 異なる場合のみを扱う——両者は互いに排他的（実データ確認済み）。
  function parseSequentialCoopTallyCheck(line) {
    if (!line.label || (line.label.ja !== "行為判定" && line.label.zh !== "行為判定")) return null;
    var text = (line.text && line.text.ja) || "";
    if (!text || (text.indexOf("順番に行う") === -1 && text.indexOf("連続して行う") === -1)) return null;
    if (text.indexOf("成否に関わらず") === -1 && text.indexOf("成否に関係なく") === -1) return null;
    var re = new RegExp(COOP_CHAIN_BRACKET_RE.source, "g");
    var matches = [];
    var m;
    while ((m = re.exec(text))) matches.push(m);
    if (matches.length < 2) return null;
    var steps = matches.map(function (mm) {
      return { target: parseInt(mm[1], 10), statKey: ABILITY_CHECK_STAT_MAP[mm[2]] };
    });
    if (steps.some(function (s) { return !s.statKey; })) return null;
    return { mode: "tallyAll", steps: steps, markerLabel: singleMarkerLabel(text) };
  }

  // ---- 「行為判定」自動擲骰（大野営地「火の戦車」専用：代表者1人を選び、代表者と
  // それ以外のPC全員でそれぞれ異なる目標値の個別判定を行う）----
  // 「PCのうち代表者1人を選んで〜〈N1|屬性〉を行い、他のPCは〜〈N2|屬性〉を行うこと」
  // という、このフロア特有の言い回しで検出する（実データ確認済み、この1箇所のみ）。
  // 結果（成功／失敗）は代表者自身の判定結果で決まる（後続の「成功」「失敗」本文は代表者
  // 視点で分岐しており、他のPCの結果はその中で個別に触れられる形——実データ確認済み）。
  // なお代表者の「成功」側にはさらに追加の個別判定（〈10|フィジカル〉での爆発回避）が
  // 本文中に埋め込まれているが、これは自動化せず従来通り生の文言のままGMに委ねる
  // （既存の"■"と同じ方針——このフロアに限り、代表者選出＋全員擲骰までを自動化の範囲とする）。
  function parseRepresentativePickCheck(line) {
    if (!line.label || (line.label.ja !== "行為判定" && line.label.zh !== "行為判定")) return null;
    var text = (line.text && line.text.ja) || "";
    if (!text || text.indexOf("代表者1人を選んで") === -1) return null;
    var re = new RegExp(ABILITY_CHECK_BRACKET_RE.source, "g");
    var matches = [];
    var m;
    while ((m = re.exec(text))) matches.push(m);
    if (matches.length !== 2) return null;
    var repStat = ABILITY_CHECK_STAT_MAP[matches[0][2]];
    var othersStat = ABILITY_CHECK_STAT_MAP[matches[1][2]];
    if (!repStat || !othersStat) return null;
    return {
      repTarget: parseInt(matches[0][1], 10),
      repStat: repStat,
      othersTarget: parseInt(matches[1][1], 10),
      othersStat: othersStat,
    };
  }

  // ---- 「行為判定」自動擲骰（砦「壺投げのトロル」専用：PC全員がそれぞれ異なる屬性の
  // 判定を複数回（1回ずつ）行う。成否に関わらず次へ進み、結果はPCごとに異なり得るため
  // （既存のparseIndividualAbilityCheckと同じ方針で）両方の結果文をそのまま敘述し、GMが
  // 実際の結果と照らして該当PCへ伝える）----
  // 「それぞれ」＋ブラケットが2つ以上（＝複数の異なる屬性を1回ずつ）という、このフロア
  // 特有の形で検出する。ブラケットが1つだけならparseIndividualAbilityCheckの対象。
  function parseMultiStatIndividualCheck(line) {
    if (!line.label || (line.label.ja !== "行為判定" && line.label.zh !== "行為判定")) return null;
    var text = (line.text && line.text.ja) || "";
    if (!text || text.indexOf("協力") !== -1) return null;
    if (!/それぞれ/.test(text)) return null;
    if (text.indexOf("任意で") !== -1) return null;
    var re = new RegExp(ABILITY_CHECK_BRACKET_RE.source, "g");
    var matches = [];
    var m;
    while ((m = re.exec(text))) matches.push(m);
    if (matches.length < 2) return null;
    var checks = [];
    for (var i = 0; i < matches.length; i++) {
      var statKey = ABILITY_CHECK_STAT_MAP[matches[i][2]];
      if (!statKey) return null;
      checks.push({ target: parseInt(matches[i][1], 10), statKey: statKey });
    }
    return { checks: checks, markerLabel: singleMarkerLabel(text) };
  }

  function getWalkEntry(walk) {
    return window.PriTestNightFloorBreakthrough.resolveFieldEntryForSlot(walk.slotIndex);
  }

  function getWalkFloor(walk) {
    var entry = getWalkEntry(walk);
    if (!entry || !entry.branches || walk.branchIndex === null) return null;
    var branch = entry.branches[walk.branchIndex];
    if (!branch) return null;
    return (branch.floors || [])[walk.floorIndex] || null;
  }

  // ---- 「路線自由」カード（branch.freeFloorOrder、例：砦／地下砦）----
  // 通常のcardLevels連番進行ではなく、フロアを任意の順で選ばせ、指定数踏破した時点で
  // 全踏破とする。位置ごとのクリア状態はstate.freeFloorCleared[slotIndex]（boolean[]、
  // branch.floorPreviews.length分）で管理する——cardLevelsは表示専用（クリア数、全踏破時null）
  // として直接書き換えるだけで、stepCardLevelの連番ロジックは経由しない。

  // slotIndex＋branchのクリア状態配列を取得する（未初期化ならbranch.floorPreviews.length分の
  // falseで初期化して保存する）。
  function getFreeFloorCleared(slotIndex, branch) {
    var Core = window.PriTestNightCore;
    var state = Core.state;
    if (!state.freeFloorCleared) state.freeFloorCleared = {};
    var key = String(slotIndex);
    var previewCount = (branch.floorPreviews || []).length;
    var arr = state.freeFloorCleared[key];
    if (!Array.isArray(arr) || arr.length !== previewCount) {
      arr = [];
      for (var i = 0; i < previewCount; i++) arr.push(false);
      state.freeFloorCleared[key] = arr;
    }
    return arr;
  }

  // position（1始まり）を踏破済みにマークし、盤面のカード数字表示をクリア数（全踏破前）に
  // 同期する。全踏破の判定・処理自体はfinishFieldWalk側で行う。
  function markFreeFloorCleared(slotIndex, branch, position) {
    var Core = window.PriTestNightCore;
    var state = Core.state;
    var arr = getFreeFloorCleared(slotIndex, branch);
    if (position >= 1 && position <= arr.length) arr[position - 1] = true;
    var clearedCount = arr.filter(Boolean).length;
    if (state.cardLevels[slotIndex] !== null) {
      state.cardLevels[slotIndex] = clearedCount;
      if (Core.renderCardLevel) Core.renderCardLevel(slotIndex);
    }
    return arr;
  }

  // ---- 第5項：通常カード（連番floorIndex）の「真の踏破」状態 ----
  // state.floorCleared[slotIndex]（boolean[]、floorCount分）——cardLevelsはあくまで
  // 「次に試すべき樓層」を指すポインタで、突破判定の「スキップ」でも進んでしまうため、
  // 「本当にその樓層の敘述を最後まで読み終えたか」は別途ここで管理する。

  // slotIndex＋floorCountのクリア状態配列を取得する（未初期化ならfloorCount分のfalseで
  // 初期化して保存する）。
  function getFloorCleared(slotIndex, floorCount) {
    var state = window.PriTestNightCore.state;
    if (!state.floorCleared) state.floorCleared = {};
    var key = String(slotIndex);
    var arr = state.floorCleared[key];
    if (!Array.isArray(arr) || arr.length !== floorCount) {
      arr = [];
      for (var i = 0; i < floorCount; i++) arr.push(false);
      state.floorCleared[key] = arr;
    }
    return arr;
  }

  function markFloorCleared(slotIndex, floorCount, floorIndex) {
    var arr = getFloorCleared(slotIndex, floorCount);
    if (floorIndex >= 0 && floorIndex < arr.length) arr[floorIndex] = true;
    return arr;
  }

  // floorCount分のfloorClearedのうち、最初にまだfalseの樓層indexを返す（全部true ならnull）。
  function firstUnclearedFloorIndex(slotIndex, floorCount) {
    var arr = getFloorCleared(slotIndex, floorCount);
    for (var i = 0; i < floorCount; i++) {
      if (!arr[i]) return i;
    }
    return null;
  }

  // justResolvedFloorIndexの樓層が1つ解決した（真に踏破 or 突破判定でスキップ）直後に
  // cardLevels[slotIndex]を更新する。突破スキップで先の樓層へ進めるが、スキップした樓層
  // 自体はfloorClearedに残らない（後で全樓層を1巡し終えたときに、まだfalseの樓層が
  // 残っていれば、そこへ「巻き戻して」再度差し出す——docs/scenario_flow_rules.md：
  // 突破スキップはフィールド移動まで一時的、離れると未踏破に戻る、を「同じ訪問中に全樓層
  // 一巡し終えた時点」で強制する形で再現）。
  // 1. justResolvedFloorIndex+1から、既にfloorClearedがtrueの樓層を飛ばして次を探す。
  // 2. 見つかれば（floorCount未満）そこへ進む——通常の連続探索と、巻き戻し後に再び前進する
  //    場合の両方をこれ1つでカバーする。
  // 3. floorCountに達したら（この訪問で全樓層を1巡し終えた）、firstUnclearedFloorIndexで
  //    最初からやり直し、まだfalseの樓層があればそこへ巻き戻す。無ければ「全」（null）。
  function advanceOrRewindCardPointer(slotIndex, floorCount, justResolvedFloorIndex) {
    var Core = window.PriTestNightCore;
    var state = Core.state;
    var clearedArr = getFloorCleared(slotIndex, floorCount);
    var next = justResolvedFloorIndex + 1;
    while (next < floorCount && clearedArr[next]) next++;
    if (next < floorCount) {
      state.cardLevels[slotIndex] = next;
    } else {
      var uncleared = firstUnclearedFloorIndex(slotIndex, floorCount);
      state.cardLevels[slotIndex] = uncleared === null ? null : uncleared;
    }
    if (Core.renderCardLevel) Core.renderCardLevel(slotIndex);
  }

  // 突破判定モーダル（night_floor_breakthrough.js、既存の実装ではwalkと無関係にGMが
  // ブランチ/樓層を手動選択する）から、樓層をスキップした直後に呼ばれる。スキップは
  // 「真に踏破」扱いにしない（floorClearedはtrueにしない）——advanceOrRewindCardPointerで
  // 先の樓層へポインタを進めるだけ。路線自由カードは「スキップ＝クリア数に含めない」
  // だけでよく、ポインタ（クリア数表示）自体は変更しない。
  function resolveFloorSkip(slotIndex, branchIndex, floorIndex) {
    var Core = window.PriTestNightCore;
    var entry = window.PriTestNightFloorBreakthrough.resolveFieldEntryForSlot(slotIndex);
    var branch = entry && entry.branches ? entry.branches[branchIndex] : null;
    if (!branch || branch.freeFloorOrder) return; // 路線自由カード、または解決不能：ポインタは変更しない
    if (typeof entry.floorCount !== "number") return;
    advanceOrRewindCardPointer(slotIndex, entry.floorCount, floorIndex);
  }

  // floor.label（"フロア1"等）から位置番号（1始まり）を取り出す。パターンに合わなければnull。
  function freeFloorPositionOfFloor(floor) {
    var text = (floor.label && (floor.label.ja || floor.label.zh)) || "";
    var m = /(\d+)/.exec(text);
    return m ? parseInt(m[1], 10) : null;
  }

  // branch.floors[]の中から、position（1始まり）に対応する行き先を解決する。同じ位置に
  // 複数の花色バリアントが並んでいる場合（例：砦branchのフロア2/3）は、各エントリーの
  // titleの先頭にある花色記号（例："(♥) 正門広場..."）で絞り込む。候補が1つだけの場合は
  // 花色を問わず常にそれを使う（西/東の地下砦branchのように、branch自体が既に特定の花色に
  // 限定されているケース）。見つからなければ-1を返す。
  function resolveFreeFloorEntryIndex(branch, position, suitCode) {
    var floors = branch.floors || [];
    var candidates = [];
    for (var i = 0; i < floors.length; i++) {
      if (freeFloorPositionOfFloor(floors[i]) === position) candidates.push(i);
    }
    if (!candidates.length) return -1;
    if (candidates.length === 1) return candidates[0];
    for (var ci = 0; ci < candidates.length; ci++) {
      var title = (floors[candidates[ci]].title && floors[candidates[ci]].title.ja) || "";
      // 花色記号は「♠♥♦♣ 谷底の地下通路」のように裸で始まる場合と、
      // 「(♥) 正門広場 (老獅子たち)」のように半角丸括弧で囲まれている場合の両方がある
      // （実データ確認済み——後者を素通りしていたため、複数花色候補があるフロアで常に
      // 配列順の最初の候補へフォールバックしてしまうバグがあった）。
      var suitMatch = /^[（(]?([♠♥♦◇♣]+)[）)]?/.exec(title);
      if (suitMatch && suitCellMatches(suitMatch[1], suitCode)) return candidates[ci];
    }
    return candidates[0]; // 花色で絞り込めなければ最初の候補へフォールバック
  }

  // ［路線自由］入口：まだ踏破していない位置のfloorPreviewsを列挙し、GMが読み上げてから
  // プレイヤーに選ばせるための選択肢ゲートを開く（specialRuleの規則書文言通り）。既に
  // clearThresholdに達している場合は「これ以上探索不可」を敘述するだけで終える。
  function beginFreeFloorChoice(idx, entry, branchIndex) {
    var Core = window.PriTestNightCore;
    var state = Core.state;
    var Fields = window.PriTestFields;
    var branch = entry.branches[branchIndex];
    var cleared = getFreeFloorCleared(idx, branch);
    var threshold = branch.freeFloorOrder.clearThreshold;
    var clearedCount = cleared.filter(Boolean).length;
    if (clearedCount >= threshold) {
      state.gmFlow.narrationText = window.I18N.t("gm_flow_free_floor_no_more_narration", { name: Fields.localizedText(entry.name) });
      state.gmFlow.awaitingOk = true;
      state.gmFlow.actionKind = "ok";
      state.gmFlow.walk = null;
      Core.saveState();
      Core.renderCurrentLocationStatus();
      return;
    }
    var previews = branch.floorPreviews || [];
    var optionPositions = [];
    var narrationParts = [];
    for (var i = 0; i < previews.length; i++) {
      if (cleared[i]) continue;
      var p = previews[i];
      optionPositions.push(i + 1);
      narrationParts.push(
        window.I18N.t("gm_flow_free_floor_preview_line", {
          label: Fields.localizedText(p.label),
          title: Fields.localizedText(p.title),
          text: Fields.localizedText(p.text),
        })
      );
    }
    state.gmFlow.walk = {
      slotIndex: idx,
      branchIndex: branchIndex,
      floorIndex: null,
      lineIndex: 0,
      branchFloor: null,
      branchFloorArmed: false,
      pendingPrefixText: null,
      pendingOutcomeFilter: null,
      pendingConvergeLabel: null,
    };
    state.gmFlow.freeFloorOptions = optionPositions;
    state.gmFlow.narrationText =
      window.I18N.t("gm_flow_free_floor_choice_intro", { name: Fields.localizedText(entry.name), cleared: clearedCount, threshold: threshold }) +
      "\n\n" +
      narrationParts.join("\n\n");
    state.gmFlow.awaitingOk = true;
    state.gmFlow.actionKind = "freeFloorChoice";
    Core.saveState();
    Core.renderCurrentLocationStatus();
  }

  // ［路線自由］選択肢のボタンが押された：花色で行き先を解決し、通常のadvanceFieldWalk
  // walkthroughへ引き継ぐ（解決できなかった場合のみ、想定外のデータとしてGMへ委ねる——
  // 数値・分岐先を捏造しない、既存の"■"と同じ方針）。
  function handleFreeFloorChoiceClick(position) {
    var Core = window.PriTestNightCore;
    var state = Core.state;
    var walk = state.gmFlow.walk;
    if (!walk) return;
    var entry = getWalkEntry(walk);
    var branch = entry && entry.branches ? entry.branches[walk.branchIndex] : null;
    state.gmFlow.freeFloorOptions = [];
    if (!branch) {
      finishFieldWalk();
      return;
    }
    var suitCode = resolveSuitForSlot(walk.slotIndex);
    var floorIdx = resolveFreeFloorEntryIndex(branch, position, suitCode);
    if (floorIdx === -1) {
      state.gmFlow.narrationText = window.I18N.t("gm_flow_free_floor_resolve_failed_narration");
      state.gmFlow.awaitingOk = true;
      state.gmFlow.actionKind = "ok";
      state.gmFlow.walk = null;
      Core.saveState();
      Core.renderCurrentLocationStatus();
      return;
    }
    walk.floorIndex = floorIdx;
    walk.lineIndex = 0;
    walk.pendingOutcomeFilter = null;
    walk.pendingConvergeLabel = null;
    advanceFieldWalk();
  }

  // ---- 第27項：同一樓層内の「（→X）」選択肢／分岐を、実際に選ばれた側の内容だけ敘述する ----
  // 構造化分析（劇本1の9+6枚）で判明：分岐/選択肢の行き先は必ず「トリガー行より1段深い
  // （depth+1）・label無し・text（ja/zh）がマーカーのラベル文字列と一致（前置き括弧の手前
  // までの一致でも可——「ザコ戦闘（撃破ルーン：1）」に対する「ザコ戦闘」ラベルのように、
  // 既存のisCombatTriggerLineが検出する戦闘トリガー行もこの一致規則だけで自然にカバーできる）」
  // という「見出し行」として存在する——新しいデータ欄は不要、既存のdepth/label/textの慣習を
  // そのままジャンプ先の解決に使えばよい。

  // lineの本文（ja/zh）が、見出しラベルlabelと一致するかどうかを判定する。完全一致、または
  // 先頭の「（」「(」より手前部分の一致（ザコ戦闘（撃破ルーン：1）のような戦闘トリガー見出し・
  // フロア1の内容表（1D）のようなダイス表見出し、どちらも同じ規則でカバーする）。
  function lineHeadingMatchesLabel(line, label) {
    if (line.label) return false;
    var trimmedLabel = String(label || "").trim();
    if (!trimmedLabel) return false;
    var candidates = [(line.text && line.text.ja) || "", (line.text && line.text.zh) || ""];
    for (var i = 0; i < candidates.length; i++) {
      var full = candidates[i].trim();
      if (!full) continue;
      if (full === trimmedLabel) return true;
      var prefix = full.split(/[（(]/)[0].trim();
      if (prefix && prefix === trimmedLabel) return true;
    }
    return false;
  }

  // 1行分をadvanceFieldWalkと同じ書式（インデント＋ラベル＋本文）に整形する。
  function formatWalkLine(line) {
    var Fields = window.PriTestFields;
    var lineText = Fields.localizedText(line.text);
    var prefix = line.label ? Fields.localizedText(line.label) + window.I18N.t("colon_separator") : "";
    var indent = line.depth ? new Array(line.depth + 1).join("　") : "";
    return indent + prefix + lineText;
  }

  // fromIndex以降で、label無し・textがlabelと一致する最初の見出し行のindexを探す
  // （見つからなければindex:-1）。意図的にdepthでは絞り込まない——ネストした選択肢/分岐
  // マーカー（例：「忍んで切り抜ける」分岐のさらに内側にある「失敗」行が持つ「(→ザコ戦闘)」）
  // は、自分自身より1段深いところではなく、外側の選択肢と共通の合流先（兄弟見出し、しばしば
  // 自分より浅い深さ）を指すことがある——実データ（劇本1 card_2フロア1）で確認済み。
  // 見出しラベルはフロア内で実質的に一意なgotoラベルとして機能する前提で、単純な前方一致
  // 探索にする（呼び出し側resolveDiceTableHeadingIfAny/handleLineChoiceClickが見つかった
  // 見出し自身のdepthを新しいbranchFloorとして採用するため、深さの整合性は自然に保たれる）。
  //
  // 途中で通過する行のうち、見出しではない通常行（label有り）は選択肢に依らない共通・確定
  // 内容（例：card_k「フロア1の内容表（1D）」見出しの手前にある「獲得」行——ダイス目に
  // 関わらず必ず起こる）として敘述テキストに蓄積し、textとして返す。一方、一致しない見出し
  // （選ばなかった側の分岐、または別のダイス目結果）に行き当たった場合は、その見出し自身の
  // 子孫（自分より深いdepthの行）だけを読み飛ばして次の兄弟見出しの探索を続け、その内容は
  // 蓄積しない——選ばなかった分岐の内容を誤って敘述してしまわないようにするため。
  function findHeadingIndexForLabel(lines, fromIndex, label) {
    var collected = [];
    var i = fromIndex;
    while (i < lines.length) {
      var line = lines[i];
      if (!line.label) {
        if (lineHeadingMatchesLabel(line, label)) return { index: i, text: collected.join("\n") };
        i = skipConstructSiblings(lines, i + 1, line.depth + 1);
        continue;
      }
      collected.push(formatWalkLine(line));
      i++;
    }
    return { index: -1, text: collected.join("\n") };
  }

  // fromIndexから、depth以上の行（選ばなかった側の兄弟見出し・その子行）を読み飛ばし、
  // depth未満（この選択肢/分岐構造全体を抜けた＝共通の続きの敘述）に達した最初のindex、
  // または末尾を返す。
  function skipConstructSiblings(lines, fromIndex, depth) {
    var i = fromIndex;
    while (i < lines.length && lines[i].depth >= depth) i++;
    return i;
  }

  // 「フロア1の内容表（1D）」のような、GMが1D6を振ってどの見出しへ進むかを決めるダイス表
  // 見出しかどうかを判定する（既存の場地カード直下varianceTable「内容 (1D)」列見出しと同じ
  // 表記慣習——カード単位ではなく樓層内に入れ子になったもの）。
  var DICE_TABLE_HEADING_RE = /[（(]\s*1D\d*\s*[）)]\s*$/;
  function isDiceTableHeadingLine(line) {
    if (!line || line.label) return false;
    var ja = (line.text && line.text.ja) || "";
    var zh = (line.text && line.text.zh) || "";
    return DICE_TABLE_HEADING_RE.test(ja.trim()) || DICE_TABLE_HEADING_RE.test(zh.trim());
  }

  // ダイス表本文（例：「1＝埋まった女神像／2・3＝瓦礫の山／4・5＝商人／6＝強敵の予感」）を
  // 解析する。各セグメントは「面数（・/、/,で複数列挙可）＝名前」の形——見つからない/形式が
  // 想定外の場合はnullを返し、呼び出し側は自動解決を諦めてGMフォールバックに委ねる
  // （数値・分岐先を捏造しない、既存の"■"と同じ方針）。
  function parseInlineDiceTable(text) {
    var segments = String(text || "")
      .split(/[／\/]/)
      .map(function (s) {
        return s.trim();
      })
      .filter(Boolean);
    if (segments.length < 2) return null;
    var entries = [];
    for (var i = 0; i < segments.length; i++) {
      var m = /^([\d・、,]+)\s*[＝=]\s*(.+)$/.exec(segments[i]);
      if (!m) return null;
      var faces = m[1]
        .split(/[・、,]/)
        .map(function (f) {
          return parseInt(f, 10);
        })
        .filter(function (n) {
          return !isNaN(n);
        });
      if (!faces.length) return null;
      entries.push({ faces: faces, name: m[2].trim() });
    }
    return entries;
  }

  // ---- 「戰鬥」構造の検出：ザコ戦闘／ボス戦闘の両方（第17・18項） ----
  // fields_data_*.js内の該当行は必ず L(depth, null, ["ザコ戦闘（撃破ルーン：N）", "雜兵戰鬥（擊破盧恩：N）"])
  // または同型の["ボス戦闘（撃破ルーン：N）", "王戰（擊破盧恩：N）"]の形（labelなし、本文がこの文言
  // そのもの）で出現する。どちらも中身は通常のEnemies系データ（夜の王ではない、単に手強い雑兵編成）
  // なので、以降の敵解決・戦場追加ロジックは完全に共通化できる。1件だけ半角スペース入りの表記ゆれ
  // （"ザコ戦闘 (撃破ルーン：1)"）があるため、開き括弧の直前は全角/半角どちらでも一致するようにする。
  var COMBAT_TRIGGER_TITLES = [
    { ja: "ザコ戦闘", zh: "雜兵戰鬥" },
    { ja: "ボス戦闘", zh: "王戰" },
  ];
  function isCombatTriggerLine(line) {
    if (line.label) return false;
    var ja = (line.text && line.text.ja) || "";
    var zh = (line.text && line.text.zh) || "";
    return COMBAT_TRIGGER_TITLES.some(function (t) {
      return new RegExp("^" + t.ja + "\\s*[（(]").test(ja) || new RegExp("^" + t.zh + "（").test(zh);
    });
  }

  // 自動化GM 戰鬥自動化：トリガー行が「ボス戦闘／王戰」（COMBAT_TRIGGER_TITLES[1]）かどうかを
  // 判定する（isCombatTriggerLineと同じマッチング方式）。「ザコ戦闘／雜兵戰鬥」ならfalse。
  function isBossCombatTriggerLine(line) {
    var t = COMBAT_TRIGGER_TITLES[1];
    var ja = (line.text && line.text.ja) || "";
    var zh = (line.text && line.text.zh) || "";
    return new RegExp("^" + t.ja + "\\s*[（(]").test(ja) || new RegExp("^" + t.zh + "（").test(zh);
  }

  // ボタンラベル・敘述冒頭に使う表示名（「雜兵戰鬥」／「王戰」）は、判定に使ったパターンではなく
  // トリガー行自身の現在言語のテキストからそのまま切り出す（i18nキーを2つ用意する必要が無い）。
  function combatTriggerTitle(line) {
    var text = window.PriTestFields.localizedText(line.text);
    return text.split(/[（(]/)[0];
  }

  // トリガー行の直後から、この戦闘で登場する敵を名指ししているbullet行（「XXX（頁）／Lv.N」の
  // ように"「"で始まる、トリガー行以上のdepthのbullet行）を、そうでない行（＝撃破後の結果文言、
  // または次のイベント行）に当たるまで収集する。nextIndexが収集後の再開位置（walk.lineIndexへ書き戻す）。
  function collectCombatEnemyLines(lines, triggerIndex) {
    var triggerDepth = lines[triggerIndex].depth;
    var enemyLines = [];
    var j = triggerIndex + 1;
    for (; j < lines.length; j++) {
      var l = lines[j];
      // 敵名bullet行はトリガー行と同じdepth（例：fields_data_3.js:1371〜）とdepth+1
      // （例：fields_data_1.js:72〜）の両方の表記が実データに存在するため、depthでの絞り込みは
      // 「トリガーより浅くなった＝この戦闘ブロックを抜けた」場合の打ち切りにのみ使う。
      if (!l.bullet || l.depth < triggerDepth) break;
      var ja = (l.text && l.text.ja) || "";
      var zh = (l.text && l.text.zh) || "";
      if (ja.indexOf("「") !== 0 && zh.indexOf("「") !== 0) break;
      enemyLines.push(l);
    }
    return { enemyLines: enemyLines, nextIndex: j };
  }

  // {key,params}形のnote（resolveAndAddCombatEnemiesが返す）をi18n paramsに変換する際、
  // 共通のtext（該当行の敘述文）とnote固有のparamsを1つのオブジェクトへ浅く合成する
  // （ES5のためObject.assignは使わず手動で合成）。
  function mergeParams(base, extra) {
    var out = {};
    for (var k in base) out[k] = base[k];
    if (extra) for (var k2 in extra) out[k2] = extra[k2];
    return out;
  }

  // 「XXX(頁)/Lv.N」のような1つの名前欄テキストから、Lv数値と名前トークン（複数名が「＆」等
  // で連記されている場合は分割）を取り出す共用ロジック。フロア敘述の「」括弧内テキスト
  // （parseCombatEnemyRef）と、強敵決定表の条目テキスト（括弧なし、resolveStrongEnemyEntry）
  // の両方から使う。
  function extractLevelAndNameTokens(text) {
    var lvMatch = /Lv\.?\s*(\d+)/i.exec(text || "");
    var namePart = String(text || "").split(/[（(]/)[0];
    var nameTokens = [];
    namePart.split(/[＆&、，,]/).forEach(function (part) {
      var t = part.trim();
      if (t && nameTokens.indexOf(t) === -1) nameTokens.push(t);
    });
    return { nameTokens: nameTokens, level: lvMatch ? parseInt(lvMatch[1], 10) : null };
  }

  // 樓層文字の「」括弧の外側にある「+モブ1」／「+雜兵1」後綴（雜兵HP追加のフラグ）を検出する。
  // 例："「亜人たち(220頁)/Lv.2+L補」+モブ1"（enemies_data_2.js等の敵special欄と対になる表記）。
  var MOB_ROW_SUFFIX_RE = /[+＋]\s*(?:モブ|雜兵)\s*\d+/;

  // 敵人special欄位の「最大HP：PC人数[×N]」血量覆寫公式を検出する（L補を問わず固定、と
  // 明記されている既存敵人資料に実例多数あり）。命中すれば倍率（無ければ×1扱い）を返す。
  var MOB_MAX_HP_OVERRIDE_RE = /最大HP[:：]\s*PC人[数數]\s*(?:[×xX]\s*(\d+))?/;
  function parseMobMaxHpOverride(specialField) {
    if (!specialField) return null;
    var texts = [specialField.ja || "", specialField.zh || ""];
    for (var i = 0; i < texts.length; i++) {
      var m = MOB_MAX_HP_OVERRIDE_RE.exec(texts[i]);
      if (m) return m[1] ? parseInt(m[1], 10) : 1;
    }
    return null;
  }

  // idxが盤面9マス（0-8）ならL補（等級補正）を返す。起點/終點（"start"/"end"）はマスの
  // 列を持たないためnull（自動判定を諦める、既存の"■"と同じ「捏造しない」方針）。
  // L補の確定式：docs/scenario_flow_rules.md参照。night.jsのfieldLevelsForDay()
  // （1日目[0,1,2]／2日目[5,4,3]、盤面の.field-level-0/1/2表示と同じ値）を列index(0-2)で引く。
  function fieldLevelCorrectionForSlot(slotIndex) {
    if (typeof slotIndex !== "number") return null;
    var levels = window.PriTestNightCore.fieldLevelsForDay();
    return levels[slotIndex % 3];
  }

  // 自動化GM 戰鬥自動化：通常戰鬥／簡易戰鬥判定（docs/combat_flow_rules.md §6）。
  // ボス戰闘（isBoss=true）は必ず通常戰鬥。ザコ戰闘はPC平均等級（端數捨去）とappliedLevel
  // （L補込み）を比較する：PC平均<敵人等級→通常戰鬥、PC平均≧敵人等級→簡易戰鬥。
  function determineCombatMode(appliedLevel, isBoss) {
    if (isBoss) return "normal";
    var Core = window.PriTestNightCore;
    var entered = Core.getRosterCharacters().filter(function (c) {
      return c.entered;
    });
    // entered中のPCが1人もいなければ判定不能。数値を捏造せず、安全側の通常戰鬥として扱う。
    if (!entered.length) return "normal";
    var totalLevel = 0;
    entered.forEach(function (c) {
      totalLevel += c.level || 1;
    });
    var avgLevel = Math.floor(totalLevel / entered.length);
    return avgLevel < appliedLevel ? "normal" : "simplified";
  }

  // 敵名bullet行から、対戦相手候補の名前トークン・Lv数値・「L補」の有無・「+モブN」雜兵HP
  // フラグの有無を取り出す。
  function parseCombatEnemyRef(line) {
    var ja = (line.text && line.text.ja) || "";
    var zh = (line.text && line.text.zh) || "";
    var jaInner = (/「([^」]+)」/.exec(ja) || [])[1] || "";
    var zhInner = (/「([^」]+)」/.exec(zh) || [])[1] || "";
    var needsLevelCorrection = /L補/.test(jaInner) || /L補/.test(zhInner);
    var hasMobRow = MOB_ROW_SUFFIX_RE.test(ja) || MOB_ROW_SUFFIX_RE.test(zh);
    var jaParsed = extractLevelAndNameTokens(jaInner);
    var zhParsed = extractLevelAndNameTokens(zhInner);
    var nameTokens = [];
    jaParsed.nameTokens.concat(zhParsed.nameTokens).forEach(function (t) {
      if (nameTokens.indexOf(t) === -1) nameTokens.push(t);
    });
    var level = jaParsed.level !== null ? jaParsed.level : zhParsed.level;
    return { nameTokens: nameTokens, level: level, needsLevelCorrection: needsLevelCorrection, hasMobRow: hasMobRow };
  }

  // 名前トークンからEnemies.search経由で一意に一致するエネミーだけを返す（1件に絞れない場合は
  // null＝自動追加を諦めてGMの手動追加に委ねる、"■"と同じ「捏造しない」方針）。
  function resolveCombatEnemyMatch(nameToken) {
    var Enemies = window.PriTestEnemies;
    if (!Enemies || !nameToken) return null;
    var matches = Enemies.search(nameToken);
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) {
      var exact = matches.filter(function (m) {
        var n = m.enemy.name;
        return n && (n.ja === nameToken || n.zh === nameToken);
      });
      if (exact.length === 1) return exact[0];
    }
    return null;
  }

  // ---- 戦闘遭遇の共通解決：名前トークン一覧→敵人比對→L補適用→戦場追加→雜兵HP自動追加 ----
  // 樓層敘述の「雜兵戰鬥／王戰」（handleCombatTriggerClick）と、強敵決定表（night_event_chips.js
  // のresolveStrongEnemyEntry）の両方から呼ばれる共用ロジック。turnMessagesへは直接pushせず、
  // 呼び出し側が組み立てやすい{key,params}形の描述的オブジェクトを返すだけに留める。
  function resolveAndAddCombatEnemies(nameTokens, level, needsCorrection, hasMobRow, slotIndex, isBoss) {
    var Core = window.PriTestNightCore;
    var Enemies = window.PriTestEnemies;
    var correction = fieldLevelCorrectionForSlot(slotIndex);
    var appliedLevel = needsCorrection && correction !== null ? (level || 1) + correction : level || 1;
    var addedNames = [];
    var addedKeys = {};
    var matchedAny = false;
    var matchedFirst = null;
    (nameTokens || []).forEach(function (token) {
      var match = resolveCombatEnemyMatch(token);
      if (!match) return;
      matchedAny = true;
      if (!matchedFirst) matchedFirst = match;
      var key = match.familyId + "|" + match.enemy.id;
      if (addedKeys[key]) return;
      addedKeys[key] = true;
      Core.addEnemyToBattle(match, appliedLevel);
      addedNames.push(Enemies.localizedText(match.enemy.name));
    });

    // 自動化GM 戰鬥自動化：この呼び出しで実際に敵人を追加できた場合のみ、通常/簡易戰鬥判定を
    // 更新する。1回の戰鬥トリガーで複数回呼ばれることがあるため（敵名bullet行が複数ある等）、
    // 一度でも「通常戰鬥」判定が出たら以後は上書きしない（最も厳しい判定を優先、docs §6）。
    if (matchedAny) {
      var battle = Core.state.battle;
      battle.combatIsBoss = battle.combatIsBoss || !!isBoss;
      var thisMode = determineCombatMode(appliedLevel, isBoss);
      battle.combatMode = battle.combatMode === "normal" || thisMode === "normal" ? "normal" : thisMode;
    }

    var levelNote = null;
    if (matchedAny && needsCorrection) {
      levelNote =
        correction !== null
          ? { key: "gm_flow_combat_level_correction_applied_log", params: { correction: correction, level: appliedLevel } }
          : { key: "gm_flow_combat_level_correction_reminder", params: {} };
    }

    var mobNote = null;
    if (hasMobRow) {
      if (matchedFirst) {
        var multiplier = parseMobMaxHpOverride(matchedFirst.enemy.special);
        var maxHp = null;
        if (multiplier !== null) {
          var pcCount = Core.getRosterCharacters().filter(function (c) {
            return c.entered;
          }).length;
          maxHp = multiplier * pcCount;
          mobNote = { key: "gm_flow_combat_mob_hp_override_log", params: { max: maxHp, multiplier: multiplier, pcCount: pcCount } };
        } else if (correction !== null) {
          maxHp = correction + 1;
          mobNote = { key: "gm_flow_combat_mob_hp_default_log", params: { max: maxHp, correction: correction } };
        } else {
          mobNote = { key: "gm_flow_combat_mob_hp_unknown_reminder", params: {} };
        }
        if (maxHp !== null) Core.addAutoMobHpRow(maxHp);
      } else {
        mobNote = { key: "gm_flow_combat_mob_hp_unresolved_reminder", params: {} };
      }
    }

    return { addedNames: addedNames, matchedAny: matchedAny, levelNote: levelNote, mobNote: mobNote };
  }

  // カードの現在樓層（state.cardLevels、板塊のみ）に対応するfloorIndexを求める。
  // 起點/終點の板塊にはcardLevelsが無いため常にfloor 0から始める。
  function currentFloorIndexForSlot(idx) {
    var levelVal = typeof idx === "number" ? window.PriTestNightCore.state.cardLevels[idx] : null;
    return typeof levelVal === "number" ? levelVal : 0;
  }

  // 第2項：［進入］／［突破］ボタンを出す直前に、その樓層の先頭〔描写〕を進度版へ
  // 先に見せる（規則書§2-3-1→§2-3-2の順序）。autoResolveBranchは純粋関数（state変更なし）
  // だが、複数候補から1D6で決めるカードは呼ぶたびに乱数を消費する——ここでのプレビュー用の
  // 一時的な解決結果は捨てるだけ（実際の［進入］クリック時にbeginFieldWalkFlowが改めて
  // 自前で解決する）ので状態への影響は無いが、"roll済み"の分岐と実際に確定する分岐が
  // ズレて見える恐れがあるため、乱数が絡む場合（resolved.roll !== null）はプレビューを
  // 諦めて空文字を返す（従来通りボタンだけのblind表示にフォールバック）。
  // 路線自由カード（砦/地下砦）はfloorIndexという単純な連番概念を持たないため対象外。
  function floorLeadingDescriptionText(idx, entry) {
    if (!entry || !entry.branches || !entry.branches.length) return "";
    // 第6項：全踏破済み（cardLevels===null）のカードはhandleEnterClick側で樓層敘述を
    // 経由せず直接地圖移動へ案内するため、ここでも樓層0の内容を誤ってプレビューしない。
    if (typeof idx === "number" && window.PriTestNightCore.state.cardLevels[idx] === null) return "";
    var resolved = autoResolveBranch(entry, idx);
    if (!resolved || resolved.roll !== null) return "";
    var branch = entry.branches[resolved.branchIndex];
    if (!branch || branch.freeFloorOrder) return "";
    var floorIndex = currentFloorIndexForSlot(idx);
    var floor = (branch.floors || [])[floorIndex];
    if (!floor || !floor.lines || !floor.lines.length) return "";
    var lines = floor.lines;
    var descLine =
      lines.filter(function (l) {
        return l.label && (l.label.ja === "描写" || l.label.zh === "描寫");
      })[0] || lines[0];
    return formatWalkLine(descLine);
  }

  // ---- 分岐の自動解決（GMや玩家がボタンで選ぶのではなく、劇本ごとの固定/抽選機制に従う） ----
  // 「シナリオ1〜10」＝scenarios.jsのSCENARIOS配列順（1始まり）。night_king_N（worldview.js）との
  // 対応をtricephalos=1/♥=varianceTable行1「小野営地の君主軍」で裏取りしたのと同じ考え方で、
  // ここでも配列順をそのままシナリオ番号として扱う（カスタムシナリオはlist()の末尾に付くだけで
  // 1-10の範囲に入らないため、該当行が見つからずGMへのフォールバックへ自然に流れる）。
  function resolveScenarioNumber() {
    var Scenarios = window.PriTestScenarios;
    var Core = window.PriTestNightCore;
    var scenario = Core.getScenario();
    if (!scenario || !Scenarios || !Scenarios.list) return null;
    var list = Scenarios.list();
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === scenario.id) return i + 1;
    }
    return null;
  }

  // "2-7, 10" / "2-7、10" / "1" / "8, 9" / "2～7、10"（全角/半角波ダッシュ）のような表記を
  // 数値の配列に展開する。波ダッシュ（～/〜）は「-」と同じ範囲区切りとして正規化する
  // （規則書側の表記揺れ——実データ調査で両方の書式が混在していると判明）。
  function parseScenarioNumberRanges(text) {
    var nums = [];
    String(text || "")
      .replace(/[～〜]/g, "-")
      .split(/[,、]/)
      .forEach(function (part) {
        var p = part.trim();
        var range = /^(\d+)-(\d+)$/.exec(p);
        if (range) {
          for (var n = parseInt(range[1], 10); n <= parseInt(range[2], 10); n++) nums.push(n);
        } else if (/^\d+$/.test(p)) {
          nums.push(parseInt(p, 10));
        }
      });
    return nums;
  }

  // varianceTableの「シナリオ」欄セル1つを解析する。"4"／"2-7, 10"／空欄（前行のシナリオ番号を
  // 引き継ぐ——表計算ソフトの結合セル表記をそのまま配列化したデータでよく見られる）に加え、
  // "4／1日目"のように「／N日目」の日程限定が付いている場合はそれを分離してdayとして返す
  // （呼び出し側でstate.dayNumberと比較する）。日程限定が無ければday:nullとなり、その行は
  // シナリオ番号が一致すれば日程を問わず対象になる。
  function parseScenarioColumnCell(text) {
    var t = String(text || "").trim();
    if (!t) return { nums: [], day: null, blank: true };
    var dayMatch = /^(.+?)[／\/]\s*(\d+)\s*日目\s*$/.exec(t);
    var mainPart = dayMatch ? dayMatch[1] : t;
    var day = dayMatch ? parseInt(dayMatch[2], 10) : null;
    return { nums: parseScenarioNumberRanges(mainPart), day: day, blank: false };
  }

  // 花色コード（"S"/"H"/"D"/"C"）と、varianceTableの花色欄に実際に現れる記号の対応。
  // ◇（白抜き）と♦（塗り）はどちらもダイヤを表す表記揺れとして同一視する。
  var SUIT_CODE_TO_SYMBOLS = { S: ["♠"], H: ["♥"], D: ["♦", "◇"], C: ["♣"] };

  // idx（板塊indexまたは"start"/"end"）に対応する実際の花色コードを取得する。
  function resolveSuitForSlot(idx) {
    var Core = window.PriTestNightCore;
    var state = Core.state;
    if (idx === "start") return state.startSuit;
    if (idx === "end") return state.endSuit;
    var slot = typeof idx === "number" ? state.slots[idx] : null;
    if (!slot) return null;
    var card = Core.CARD_BY_CODE[slot.code];
    return card ? card.suit : null;
  }

  // 花色欄のテキストに実際の花色コードが含まれるか判定する。欄が空欄（制約無し）なら常に
  // true。引いたカードの花色が不明（suitCode===null、例：起點/終點で花色未設定）な場合も、
  // 誤って絞りすぎないようtrueを返す（＝制約を無視、既存の「花色を一切見ない」挙動に留まる）。
  function suitCellMatches(suitText, suitCode) {
    var t = String(suitText || "").trim();
    if (!t) return true;
    if (!suitCode) return true;
    var symbols = SUIT_CODE_TO_SYMBOLS[suitCode];
    if (!symbols) return true;
    // 「♠♥♣（◇以外）」のような除外表記：括弧内に「以外」と共に挙げられている花色記号は、
    // 逆に対象から除外する（例：この場合♦/◇の花色は対象外）——単純な部分文字列一致だと、
    // 除外用に書かれた記号まで「含まれている」と誤判定してしまう。
    var excludeMatch = /[（(]([^）)]*)以外[）)]/.exec(t);
    if (excludeMatch) {
      var excludedSymbols = excludeMatch[1].match(/[♠♥♦◇♣]/g) || [];
      if (symbols.some(function (sym) { return excludedSymbols.indexOf(sym) !== -1; })) {
        return false;
      }
    }
    return symbols.some(function (sym) {
      return t.indexOf(sym) !== -1;
    });
  }

  // "1・2"／"1-2"／"1～2"／"1、2"のような面数リスト表記を、個々の面数の配列に展開する
  // （parseInlineDiceTableと同じ考え方——ダイス表面数リストの表記揺れを許容する）。
  function parseFaceList(text) {
    var faces = [];
    String(text || "")
      .split(/[・、,]/)
      .forEach(function (part) {
        var p = part.trim().replace(/[～〜]/g, "-");
        var range = /^(\d+)-(\d+)$/.exec(p);
        if (range) {
          for (var n = parseInt(range[1], 10); n <= parseInt(range[2], 10); n++) faces.push(n);
        } else if (/^\d+$/.test(p)) {
          faces.push(parseInt(p, 10));
        }
      });
    return faces;
  }

  // varianceTableの「内容」列を解析する。"1-3 X／4-6 Y"や"1・2 X／3・4 Y"、"1～5＝X／6＝Y"の
  // ように、ダイス面数リスト＋名前が「／」区切りで複数あれば{faces,name}の配列を返す
  // （骰子を振って決める）。面数リストの後ろは空白または「＝」「=」区切りのどちらでも名前へ
  // 続く。いずれかの区切りが面数リストで始まっていない（＝名前だけの並び等、想定外の書式）
  // 場合はnullを返し、呼び出し側はテキストそのものを分岐名として扱う。
  function parseVarianceContent(text) {
    var segments = String(text || "")
      .split(/[／\/]/)
      .map(function (s) {
        return s.trim();
      })
      .filter(Boolean);
    if (segments.length < 2) return null;
    var parsed = [];
    for (var i = 0; i < segments.length; i++) {
      var m = /^([\d,、・\-～〜]+)\s*[＝=]?\s*(.+)$/.exec(segments[i]);
      if (!m) return null; // 面数リストで始まっていない区切りが混ざっていたら安全側でnull
      var faces = parseFaceList(m[1]);
      if (!faces.length) return null;
      parsed.push({ faces: faces, name: m[2].trim() });
    }
    return parsed;
  }

  // branches[].nameとvarianceTableの内容列から解決した名前を比較する際、全角/半角括弧の
  // 表記揺れ（例："鍛冶村（雷1）" vs "鍛冶村(雷1)"）を吸収する。語順の違いなど括弧の表記
  // 揺れ以外の不一致は正規化しない——それはデータ側の不整合であり、この関数で無理に一致
  // させるのではなく元データ（fields_data_*.js）側を修正すべき、という既存方針を維持する。
  function normalizeBranchNameForMatch(text) {
    return String(text || "")
      .replace(/[（(]/g, "(")
      .replace(/[）)]/g, ")")
      .trim();
  }

  // varianceTableの内容欄が「※ランダム決定」のような単純なプレースホルダーで、実際の対応
  // 表がextraTables（例：鍛冶村／遺跡の「1回目×2回目」2段階ダイスグリッド）としてカード側に
  // 用意されている場合に、その表を見つける。1列目の各行見出しに「1回目」/「第1次」、
  // 1行目の各列見出し（先頭列を除く）に「2回目」/「第2次」を含む表だけを対象にする
  // （既存データで確認できた表記——将来別の表記の2段階表が現れた場合は対象外＝GMへ
  // フォールバックのままになる、無理に汎用化しない）。
  function findTwoRollGridTable(entry) {
    var tables = entry.extraTables;
    if (!tables || !tables.length) return null;
    for (var t = 0; t < tables.length; t++) {
      var table = tables[t];
      if (!table.columns || !table.rows || table.columns.length < 2 || !table.rows.length) continue;
      var rowsOk = true;
      for (var r = 0; r < table.rows.length; r++) {
        var rowHead = (table.rows[r][0] && table.rows[r][0].ja) || "";
        if (!/1回目|第1次/.test(rowHead)) {
          rowsOk = false;
          break;
        }
      }
      if (!rowsOk) continue;
      var colsOk = true;
      for (var c = 1; c < table.columns.length; c++) {
        var colHead = (table.columns[c] && table.columns[c].ja) || "";
        if (!/2回目|第2次/.test(colHead)) {
          colsOk = false;
          break;
        }
      }
      if (colsOk) return table;
    }
    return null;
  }

  // "1回目＝1・2"／"2回目＝3・4"のような表見出しから、末尾の面数リスト部分だけを取り出して
  // parseFaceListへ渡す（見出し文言そのものを面数として誤解析しないため）。
  function extractFaceListFromGridHeader(text) {
    var m = /[＝=]\s*([\d・、,\-～〜]+)\s*$/.exec(String(text || ""));
    if (!m) return [];
    return parseFaceList(m[1]);
  }

  // 2段階ダイスグリッド（1回目＝行／2回目＝列）を実際に振って解決する。セルの内容が
  // 「振り直し」／「重新擲骰」なら、このアプリがその場で振り直す（GMが記録していない過去の
  // 骰目を捏造するのではなく、今その場で正規の骰子を振るという既存方針のまま）。
  // 見出しの面数リストが解析できない、または20回振り直しても確定しない（想定外のデータ）
  // 場合はnullを返し、呼び出し側はGMへのフォールバックへ進む。
  function resolveTwoRollGrid(table) {
    for (var attempt = 0; attempt < 20; attempt++) {
      var roll1 = 1 + Math.floor(Math.random() * 6);
      var roll2 = 1 + Math.floor(Math.random() * 6);
      var rowIdx = -1;
      for (var r = 0; r < table.rows.length; r++) {
        if (extractFaceListFromGridHeader(table.rows[r][0].ja).indexOf(roll1) !== -1) {
          rowIdx = r;
          break;
        }
      }
      var colIdx = -1;
      for (var c = 1; c < table.columns.length; c++) {
        if (extractFaceListFromGridHeader(table.columns[c].ja).indexOf(roll2) !== -1) {
          colIdx = c;
          break;
        }
      }
      if (rowIdx === -1 || colIdx === -1) return null;
      var cell = table.rows[rowIdx][colIdx];
      var name = cell ? String(cell.ja || "").trim() : "";
      if (/振り直し|重新擲骰|再抽選|再擲骰/.test(name)) continue;
      return { name: name, roll1: roll1, roll2: roll2 };
    }
    return null;
  }

  // ---- 強敵決定表（event_rulebook.jsのstrong_enemyチット、extraTables）の自動擲骰 ----

  // ダイス欄（例："1／135"）を解析する：1顆目の目（die1）と、2顆目の目が該当する面数文字列
  // （faces2、"135"＝奇数目、"246"＝偶数目）を返す。解析できなければnull。
  function parseStrongEnemyDiceCell(text) {
    var m = /^(\d)\s*[／\/]\s*(\d+)$/.exec(String(text || "").trim());
    if (!m) return null;
    return { die1: parseInt(m[1], 10), faces2: m[2] };
  }

  // 強敵決定表の最終行「レベルを+1して振り直す」／「等級+1後重新擲骰」を検出する。
  var STRONG_ENEMY_REROLL_RE = /振り直す|重新擲骰/;

  // 強敵決定表を実際に1D6+1D6で振って解決する。reroll行に命中した場合は等級+1を積算して
  // その場で振り直す（既存resolveTwoRollGridと同じ「今その場で正規の骰子を振る」方針、
  // 上限20回で打ち切り）。表の解析・解決に失敗した場合はnull（GMへのフォールバック、
  // 既存の"■"と同じ「捏造しない」方針）。
  function rollStrongEnemyTable(table) {
    var levelBonus = 0;
    var rollLog = [];
    for (var attempt = 0; attempt < 20; attempt++) {
      var die1 = 1 + Math.floor(Math.random() * 6);
      var die2 = 1 + Math.floor(Math.random() * 6);
      var matchedRow = null;
      for (var r = 0; r < table.rows.length; r++) {
        var cell = parseStrongEnemyDiceCell(table.rows[r][0] && table.rows[r][0].ja);
        if (cell && cell.die1 === die1 && cell.faces2.indexOf(String(die2)) !== -1) {
          matchedRow = table.rows[r];
          break;
        }
      }
      if (!matchedRow) return null;
      var entry = matchedRow[1];
      rollLog.push({ die1: die1, die2: die2, text: (entry && entry.ja) || "" });
      var isReroll = STRONG_ENEMY_REROLL_RE.test((entry && entry.ja) || "") || STRONG_ENEMY_REROLL_RE.test((entry && entry.zh) || "");
      if (isReroll) {
        levelBonus++;
        continue;
      }
      return { entry: entry, die1: die1, die2: die2, levelBonus: levelBonus, rollLog: rollLog };
    }
    return null;
  }

  // 強敵決定表の条目テキスト（例："亜人の女王&亜人の剣聖（221頁）／Lv.8 + L補正"、「」括弧
  // なし）を解析し、既存resolveAndAddCombatEnemiesで戦場へ自動追加する。強敵決定表の条目に
  // 「+モブN」後綴の実例は無いため、hasMobRowは常にfalse固定にする。
  function resolveStrongEnemyEntry(entry, slotIndex, levelBonus) {
    var ja = (entry && entry.ja) || "";
    var zh = (entry && entry.zh) || "";
    var needsCorrection = /L補/.test(ja) || /L補/.test(zh);
    var jaParsed = extractLevelAndNameTokens(ja);
    var zhParsed = extractLevelAndNameTokens(zh);
    var nameTokens = [];
    jaParsed.nameTokens.concat(zhParsed.nameTokens).forEach(function (t) {
      if (nameTokens.indexOf(t) === -1) nameTokens.push(t);
    });
    var baseLevel = (jaParsed.level !== null ? jaParsed.level : zhParsed.level) || 1;
    var level = baseLevel + (levelBonus || 0);
    // 強敵決定表はランダム遭遇（ザコ戰鬥）のみで、王戰の実例は無いためisBoss常にfalse固定。
    return resolveAndAddCombatEnemies(nameTokens, level, needsCorrection, false, slotIndex, false);
  }

  // スート欄自体に「花色記号＋名前」の組がまとめて書かれているケース（例：大教会の
  // "♠♥ 丘の上の大教会／♦♣ 水辺の大教会"——内容欄は「－」のプレースホルダーで、実際の
  // 対応表はスート欄にある）を解析する。各「／」区切りグループの先頭にある花色記号
  // （♠♥◇♦♣、連続してもよい）と、それに続く名前を読み取る。1つでも解析に失敗した
  // グループがあればnullを返す（安全側——無理にこの形式だと決めつけない）。
  function parseSuitEmbeddedNameGroups(text) {
    var groups = String(text || "")
      .split(/[／\/]/)
      .map(function (s) {
        return s.trim();
      })
      .filter(Boolean);
    if (groups.length < 2) return null;
    var parsed = [];
    for (var i = 0; i < groups.length; i++) {
      var m = /^([♠♥♦◇♣]+)\s+(.+)$/.exec(groups[i]);
      if (!m) return null;
      parsed.push({ suitSymbols: m[1], name: m[2].trim() });
    }
    return parsed;
  }

  // entryのvarianceTableとシナリオ番号・花色から、実際に該当する分岐indexを自動で解決する。
  // 骰子が必要な内容（複数レンジ）は、その場でこのアプリが1D6を振って決める——GMが把握して
  // いない/記録されていない過去の骰目を「捏造」するのではなく、今その場で正規の骰子を振る
  // という点で、既存の突破判定等の自動ダイス処理と同じ立ち位置。解決できなければnullを返し、
  // 呼び出し側はGMに規則書を見て選んでもらうフォールバックへ進む。
  function autoResolveBranch(entry, idx) {
    if (!entry.branches || !entry.branches.length) return null;
    if (entry.branches.length === 1) return { branchIndex: 0, roll: null };
    if (!entry.varianceTable || !entry.varianceTable.rows) return null;
    var scenarioNum = resolveScenarioNumber();
    if (scenarioNum === null) return null;
    var suitCode = resolveSuitForSlot(idx);
    var dayNumber = window.PriTestNightCore.state.dayNumber;
    var lastCellInfo = null;
    var candidateRows = [];
    for (var i = 0; i < entry.varianceTable.rows.length; i++) {
      var row = entry.varianceTable.rows[i];
      var cellInfo = parseScenarioColumnCell(row[0] && row[0].ja);
      // 空欄のシナリオ欄は「結合セル」——直前の非空行のシナリオ番号/日程をそのまま引き継ぐ。
      if (cellInfo.blank && lastCellInfo) cellInfo = lastCellInfo;
      else if (!cellInfo.blank) lastCellInfo = cellInfo;
      if (cellInfo.nums.indexOf(scenarioNum) === -1) continue;
      if (cellInfo.day !== null && cellInfo.day !== dayNumber) continue;
      candidateRows.push(row);
    }
    if (!candidateRows.length) return null;
    // シナリオ番号（＋日程）が一致する行が複数残る場合、花色欄が実際の花色と一致する行を
    // 優先する。どれも花色欄が空欄（制約無し）ならその中の最初の行を使う。
    var matchRow =
      candidateRows.filter(function (row) {
        var suitText = row[1] && row[1].ja;
        return suitText && String(suitText).trim() && suitCellMatches(suitText, suitCode);
      })[0] ||
      candidateRows.filter(function (row) {
        var suitText = row[1] && row[1].ja;
        return !suitText || !String(suitText).trim();
      })[0] ||
      null;
    if (!matchRow) return null;
    var contentText = matchRow[2] ? matchRow[2].ja : "";
    var diceOptions = parseVarianceContent(contentText);
    var targetName = contentText.trim();
    var roll = null;
    var roll2 = null;
    if (diceOptions) {
      roll = Math.floor(Math.random() * 6) + 1;
      var picked = diceOptions.filter(function (o) {
        return o.faces.indexOf(roll) !== -1;
      })[0];
      if (!picked) return null;
      targetName = picked.name;
    } else if (/^※/.test(targetName)) {
      // 内容欄が「※ランダム決定」等の単純なプレースホルダーの場合のみ、extraTablesの
      // 2段階ダイスグリッドを試す（他の想定外の書式まで無理に対象化しない）。
      var gridTable = findTwoRollGridTable(entry);
      var gridResult = gridTable ? resolveTwoRollGrid(gridTable) : null;
      if (!gridResult) return null;
      targetName = gridResult.name;
      roll = gridResult.roll1;
      roll2 = gridResult.roll2;
    } else {
      // ダイスレンジでも「※」プレースホルダーでもない場合のみ、花色だけで（骰子を使わず）
      // 決まる2つの書式を試す：
      // (a) スート欄自体に「花色記号＋名前」の組が書かれている（大教会の丘/水辺パターン）。
      // (b) スート欄・内容欄がどちらも同数の要素を持ち、位置で対応づけられている
      //     （遺跡の崖上/下層パターン——スート欄は空白区切り、内容欄は「／」区切り）。
      // どちらの書式の前提条件（欄の形）にも当てはまらない場合は、単一の直接名（大半の行
      // ——例：坑道(1)のような通常行）とみなし、targetNameをそのまま使う（従来の挙動）。
      // 一方、書式の前提条件には当てはまったのに実際の花色と一致する候補が無かった場合は
      // nullを返す（GMへフォールバック）——無理に一致させない。
      var suitText2 = matchRow[1] ? matchRow[1].ja : "";
      var embeddedGroups = parseSuitEmbeddedNameGroups(suitText2);
      if (embeddedGroups) {
        var matchedGroup = embeddedGroups.filter(function (g) {
          return suitCellMatches(g.suitSymbols, suitCode);
        })[0];
        if (!matchedGroup) return null;
        targetName = matchedGroup.name;
      } else {
        var contentSegs = targetName
          .split(/[／\/]/)
          .map(function (s) {
            return s.trim();
          })
          .filter(Boolean);
        var suitTokens = suitText2
          .split(/\s+/)
          .map(function (s) {
            return s.trim();
          })
          .filter(Boolean);
        if (contentSegs.length >= 2 && contentSegs.length === suitTokens.length) {
          var positionalName = null;
          for (var si = 0; si < suitTokens.length; si++) {
            if (suitCellMatches(suitTokens[si], suitCode)) {
              positionalName = contentSegs[si];
              break;
            }
          }
          if (positionalName === null) return null;
          targetName = positionalName;
        }
        // どちらの前提条件にも当てはまらない場合はtargetNameをそのまま使う（下へ続く）。
      }
    }
    var normalizedTarget = normalizeBranchNameForMatch(targetName);
    for (var bi = 0; bi < entry.branches.length; bi++) {
      if (entry.branches[bi].name && normalizeBranchNameForMatch(entry.branches[bi].name.ja) === normalizedTarget) {
        return { branchIndex: bi, roll: roll, roll2: roll2 };
      }
    }
    // 最終フォールバック：内容欄が複数の分岐候補名を「／」区切りで並べているだけで、実際の
    // 対応花色はbranches[]自身の名前（「名前（花色）」形式、例：西の地下砦（♠♥）／東の地下砦
    // （◇♣）——砦／地下砦カード）に書かれているケース。内容欄の各候補（先頭に装飾的な
    // 「(...)」があれば取り除く——例：(黒陶)西の地下砦）が、いずれかの分岐名の花色部分を
    // 除いた名前と一致し、かつその分岐自身の花色サフィックスが実際の花色と一致すれば採用する。
    if (suitCode) {
      var rawCandidates = targetName
        .split(/[／\/]/)
        .map(function (s) {
          return s.trim().replace(/^[（(][^）)]*[）)]/, "").trim();
        })
        .filter(Boolean);
      for (var ci = 0; ci < rawCandidates.length; ci++) {
        var candidateNorm = normalizeBranchNameForMatch(rawCandidates[ci]);
        for (var bi2 = 0; bi2 < entry.branches.length; bi2++) {
          var bn = entry.branches[bi2].name;
          if (!bn || !bn.ja) continue;
          var pm = /^(.*?)[（(]([^）)]+)[）)]\s*$/.exec(bn.ja);
          if (!pm) continue;
          if (normalizeBranchNameForMatch(pm[1]) !== candidateNorm) continue;
          if (suitCellMatches(pm[2], suitCode)) return { branchIndex: bi2, roll: roll, roll2: roll2 };
        }
      }
    }
    return null; // 解決した名前がbranches[]のどれとも一致しない＝データの想定外、GMへ委ねる
  }

  function handleEnterClick() {
    var Core = window.PriTestNightCore;
    var state = Core.state;
    var idx = state.focusedIndex;
    // 第6項：この卡牌が既に全踏破済み（cardLevels===null）の場合、再度[進入]を押しても
    // 樓層0から敘述し直さない——currentFloorIndexForSlotはnullを「0扱い」で返すため、
    // このガードが無いと全踏破済みカードでも毎回樓層0の内容を再敘述してしまう
    // （ユーザー報告の追加バグ）。全踏破処理自体は既に完了済みなので、籌碼確認
    // （まだ使っていなければ）→地圖移動の案内へ直接進める（advanceCardConclusionChainを
    // そのまま再利用——チェーン自体は既に全踏破ゲートを閉じ終えた前提のロジックなので、
    // pendingFinalFloorSlotは設定しない）。
    if (typeof idx === "number" && state.cardLevels[idx] === null) {
      state.gmFlow.pendingChipCheckSlot = idx;
      state.gmFlow.pendingMapMoveSlot = idx;
      advanceCardConclusionChain();
      return;
    }
    var entry = window.PriTestNightFloorBreakthrough.resolveFieldEntryForSlot(idx);
    // ［初始地點］第18項：起點／終點は数値cardLevelsを持たないため、[進入]を押した瞬間に
    // 「1」チェックを自動でオンにし、盤面から見ても「現在フロア1にいる」ことが分かるようにする
    // （従来はGMが手動でチェックしない限り、進度版の敘述以外に現在地を示す手掛かりが無かった）。
    if (entry && (idx === "start" || idx === "end")) {
      var pileChecks = idx === "start" ? state.startChecks : state.endChecks;
      if (!pileChecks.one) {
        pileChecks.one = true;
        Core.renderPiles();
      }
    }
    // 第19項・第3項改：この地點に未使用の籌碼事件があれば、樓層本文の敘述を始める前に先に
    // 使用可否を尋ねる——ただし「進入第一層前」の1回だけ（cardLevels[idx]===0＝このカード
    // でまだ1つも樓層を進めていない、真の初回進入）。handleEnterClickは同じカード内の
    // 2層目以降でも[進入]を押すたびに呼ばれる関数のため、この条件が無いと毎層聞いてしまう
    // （ユーザー報告のバグ）。
    var isFreshCardVisit = typeof idx === "number" && state.cardLevels[idx] === 0;
    if (isFreshCardVisit && offerEventChipIfPending(idx, "startWalk")) return;
    beginFieldWalkFlow(idx, entry);
  }

  // handleEnterClickから分離：籌碼事件を先に確認する必要が無い場合はそのまま、確認後に
  // 「使用」／「稍後」いずれを選んでも（resolveChipOffer経由で）ここへ戻ってくる。
  function beginFieldWalkFlow(idx, entry) {
    var Core = window.PriTestNightCore;
    var state = Core.state;
    if (!entry || !entry.branches || !entry.branches.length) {
      // 分岐データが無いカード（規則書データが未整備、等）は従来通りの簡易リマインドへ退避する。
      var name = entry ? window.PriTestFields.localizedText(entry.name) : "";
      state.gmFlow.narrationText = window.I18N.t("gm_flow_enter_narration", { name: name });
      state.gmFlow.awaitingOk = true;
      state.gmFlow.actionKind = "ok";
      state.gmFlow.walk = null;
      Core.saveState();
      Core.renderCurrentLocationStatus();
      return;
    }
    var resolved = autoResolveBranch(entry, idx);
    if (resolved) {
      if (resolved.roll2 !== null && resolved.roll2 !== undefined) {
        state.turnMessages.push({
          text: window.I18N.t("gm_flow_branch_roll2_log", {
            roll1: resolved.roll,
            roll2: resolved.roll2,
            name: window.PriTestFields.localizedText(entry.branches[resolved.branchIndex].name),
          }),
          time: Date.now(),
          side: "gm",
        });
      } else if (resolved.roll !== null) {
        state.turnMessages.push({
          text: window.I18N.t("gm_flow_branch_roll_log", {
            roll: resolved.roll,
            name: window.PriTestFields.localizedText(entry.branches[resolved.branchIndex].name),
          }),
          time: Date.now(),
          side: "gm",
        });
      }
      var resolvedBranch = entry.branches[resolved.branchIndex];
      if (resolvedBranch && resolvedBranch.freeFloorOrder) {
        // ［路線自由］（specialRule参照）：フロアを任意の順で選ばせる特殊カード。通常の
        // 連番floorIndex進行ではなく、専用の選択肢ゲートへ入る。
        beginFreeFloorChoice(idx, entry, resolved.branchIndex);
        return;
      }
      state.gmFlow.walk = {
        slotIndex: idx,
        branchIndex: resolved.branchIndex,
        floorIndex: currentFloorIndexForSlot(idx),
        lineIndex: 0,
        branchFloor: null,
        branchFloorArmed: false,
        pendingPrefixText: null,
        pendingOutcomeFilter: null,
        pendingConvergeLabel: null,
      };
      advanceFieldWalk();
      return;
    }
    // 自動解決できなかった場合のみ（varianceTable未整備・シナリオ不明・データ不一致など）、
    // GMに規則書を見て選んでもらうフォールバックへ進む。
    state.gmFlow.walk = {
      slotIndex: idx,
      branchIndex: null,
      floorIndex: currentFloorIndexForSlot(idx),
      lineIndex: 0,
      branchFloor: null,
      branchFloorArmed: false,
      pendingPrefixText: null,
      pendingOutcomeFilter: null,
      pendingConvergeLabel: null,
    };
    state.gmFlow.narrationText = window.I18N.t("gm_flow_pick_branch_narration", {
      name: window.PriTestFields.localizedText(entry.name),
    });
    state.gmFlow.awaitingOk = true;
    state.gmFlow.actionKind = "branchChoice";
    Core.saveState();
    Core.renderCurrentLocationStatus();
  }

  // ---- 第19項：籌碼事件の使用可否を先に尋ねる ----
  // idxに未使用の籌碼（state.eventChips[idx] && !state.eventChipsUsed[idx]）があれば、
  // 敘述を「使用しますか？」ゲートに切り替えてtrueを返す（呼び出し元はここで処理を止める）。
  // 無ければ何もせずfalseを返す（呼び出し元がそのまま通常の処理を続ける）。
  // continuation："startWalk"（［進入］直後、チップ解決後にbeginFieldWalkFlowへ続ける）｜
  // "cardConclusion"（カードの全踏破処理が終わった後の再確認、解決後はadvanceCardConclusionChain
  // を続けて［地圖移動］へ進む）。
  function offerEventChipIfPending(idx, continuation) {
    var Core = window.PriTestNightCore;
    var state = Core.state;
    if (typeof idx !== "number") return false;
    var chipId = state.eventChips ? state.eventChips[idx] : null;
    if (!chipId || (state.eventChipsUsed && state.eventChipsUsed[idx])) return false;
    state.gmFlow.chipOfferSlot = idx;
    state.gmFlow.chipOfferContinuation = continuation;
    state.gmFlow.narrationText =
      window.I18N.t("gm_flow_chip_offer_narration", { chip: Core.eventChipDisplayLabel(idx) }) +
      "\n" +
      window.I18N.t("gm_flow_chip_effect_" + chipId);
    state.gmFlow.awaitingOk = true;
    state.gmFlow.actionKind = "chipOffer";
    Core.saveState();
    Core.renderCurrentLocationStatus();
    return true;
  }

  // 「使用」：既存の籌碼事件モーダル（night_event_chips.js）をそのまま開く——中身の購買/祝福/
  // 記錄等の個別UIは複製せず、既存の正しい実装に完全に委ねる（実際に使用済みになった時点で
  // 拔除されるのも、既存のmarkEventChipUsed経由の挙動そのまま）。
  function handleChipOfferUseClick() {
    resolveChipOffer(true);
  }

  // 「稍後」：今は使わず、そのまま樓層の敘述（またはOK状態）へ進む。籌碼は盤面に残り続け、
  // 樓層敘述が終わった後（continuation==="startWalk"の場合）にもう一度尋ねられる。
  function handleChipOfferSkipClick() {
    resolveChipOffer(false);
  }

  function resolveChipOffer(use) {
    var Core = window.PriTestNightCore;
    var state = Core.state;
    var idx = state.gmFlow.chipOfferSlot;
    var continuation = state.gmFlow.chipOfferContinuation;
    state.gmFlow.chipOfferSlot = null;
    state.gmFlow.chipOfferContinuation = null;
    clearGmFlowGate();
    Core.saveState();
    Core.renderCurrentLocationStatus();
    if (use && window.PriTestNightEventChips) window.PriTestNightEventChips.openEventChipModal(idx);
    if (continuation === "startWalk") {
      var entry = window.PriTestNightFloorBreakthrough.resolveFieldEntryForSlot(idx);
      beginFieldWalkFlow(idx, entry);
    } else if (continuation === "cardConclusion") {
      // 使う／稍後いずれの場合も、次は［地圖移動機制］（まだ保留があれば）へ進める。
      advanceCardConclusionChain();
    }
  }

  function handleBranchChoiceClick(branchIndex) {
    var state = window.PriTestNightCore.state;
    var walk = state.gmFlow.walk;
    if (!walk) return;
    walk.branchIndex = branchIndex;
    walk.floorIndex = currentFloorIndexForSlot(walk.slotIndex);
    walk.lineIndex = 0;
    walk.branchFloor = null;
    walk.branchFloorArmed = false;
    walk.pendingPrefixText = null;
    walk.pendingOutcomeFilter = null;
    walk.pendingConvergeLabel = null;
    advanceFieldWalk();
  }

  // 現在のwalk位置から、次の(→X)選択肢が現れるまで（または樓層の本文が尽きるまで）行を
  // 連結して1ブロックとして敘述する。選択肢が見つかればそこで停止してボタンを提示する。
  // 第27項：walk.branchFloorが設定されている間（＝選ばれた分岐の内容を辿っている間）、
  // その深さ以下（＝選ばなかった兄弟見出し、またはこの構造を抜けた共通の続き）に達したら、
  // 兄弟をまとめて読み飛ばしてから改めて判定し直す——handleLineChoiceClick側で実際に
  // ジャンプ先を解決できた場合にのみbranchFloorが立つため、解決できなかった場合は従来通り
  // 単純な線形敘述（選ばなかった側の説明文が混ざり得る、GMディスクレション任せ）にフォール
  // バックする。
  function advanceFieldWalk() {
    var Core = window.PriTestNightCore;
    var state = Core.state;
    var walk = state.gmFlow.walk;
    var Fields = window.PriTestFields;
    var floor = walk ? getWalkFloor(walk) : null;
    if (!walk || !floor) {
      finishFieldWalk();
      return;
    }
    var lines = floor.lines || [];
    var blockParts = [];
    // 第27項：handleLineChoiceClickがジャンプ先を解決する際、マーカー行と実際の見出し行の
    // 間に挟まっていた「選択肢に依らない共通・確定内容」（例：card_kの「獲得」行）を蓄積して
    // ここに渡してくる。ジャンプ後最初の敘述ブロックの冒頭に差し込む（一度使ったら消費済み）。
    if (walk.pendingPrefixText) {
      blockParts.push(walk.pendingPrefixText);
      walk.pendingPrefixText = null;
    }
    var choiceLabels = [];
    var combatTriggerIndex = -1;
    var abilityCheckIndex = -1;
    var abilityCheckSpec = null;
    var cooperativeCheckIndex = -1;
    var cooperativeCheckSpec = null;
    var playerPickCheckIndex = -1;
    var playerPickCheckSpec = null;
    var branchPointTallyIndex = -1;
    var branchPointTallySpec = null;
    var sequentialPairIndex = -1;
    var sequentialPairSpec = null;
    var conditionalChoiceIndex = -1;
    var conditionalChoiceSpec = null;
    var chainCheckIndex = -1;
    var chainCheckSpec = null;
    var openEndedTallyIndex = -1;
    var openEndedTallySpec = null;
    var repPickIndex = -1;
    var repPickSpec = null;
    var multiStatCheckIndex = -1;
    var multiStatCheckSpec = null;
    var i = walk.lineIndex;
    while (i < lines.length) {
      var line = lines[i];
      // walk.branchFloorArmed：ジャンプ直後の見出し行自身は必ず境界判定を素通りさせる
      // （見出し行そのものの深さはbranchFloorと同じなので、境界判定を即有効にすると
      // ジャンプ先の内容を一切敘述せずスキップしてしまう）。この行を処理し終えた直後に
      // trueへ切り替え、以後（次の行から）は本来の「兄弟/より浅い行で打ち切る」判定を行う。
      if (walk.branchFloor != null && walk.branchFloorArmed && line.depth <= walk.branchFloor) {
        // 例外：行為判定行自身に埋め込まれた「成否に関わらず〜（→X）」マーカー（handleAbility
        // CheckDoneClick等がwalk.pendingConvergeLabelへ保存）が、ちょうどこの境界の行き先を
        // 指している場合——これは「選ばなかった別の分岐」ではなく、選んだ分岐自身も合流する
        // 先そのものなので、スキップせず境界を解除して素通りさせる（実データ確認済み：
        // 大教會(1)の「弱点を狙う」→「行為判定：…戦闘になる（→ボス戦闘）」→「ボス戦闘」は
        // 選択した側の分岐自身がボス戦闘へ合流する、選ばなかった側の兄弟ではない）。
        if (walk.pendingConvergeLabel && lineHeadingMatchesLabel(line, walk.pendingConvergeLabel)) {
          walk.branchFloor = null;
          walk.branchFloorArmed = false;
          walk.pendingConvergeLabel = null;
        } else {
          i = skipConstructSiblings(lines, i, walk.branchFloor);
          walk.branchFloor = null;
          walk.branchFloorArmed = false;
          walk.pendingConvergeLabel = null;
          continue;
        }
      }
      if (walk.branchFloor != null) walk.branchFloorArmed = true;
      // 「突破判定」欄は、玩家が突破判定を選んだ場合にのみ参照する非公開情報——
      // GM敘述には出さない（[突破]ボタンの対話框側で別途処理する）。
      if (line.label && (line.label.ja === "突破判定" || line.label.zh === "突破判定")) {
        i++;
        continue;
      }
      // 「雜兵戰鬥」／「王戰」構造：ここで一旦停止し、［戰鬥機制］へ切り替える。敵の正体は
      // ボタンを押すまで敘述しない（第17・18項：任何進入戰鬥時、先暫停樓層判定機制）。
      if (isCombatTriggerLine(line)) {
        combatTriggerIndex = i;
        break;
      }
      // 「PC全員／それぞれ／各自が個別に固定目標値へ判定する」形式の行為判定：詳細な判定
      // 基準（目標値・屬性）は進度版に出さず、自動GMが各玩家の判定骰を代行してから続きを
      // 敘述する。この行自体は敘述に含めない（生のPC全員は〈N|屬性〉を行う、という文言を
      // そのまま貼り出さない——ユーザー指示）。成功/失敗どちらの後続内容を敘述するかは
      // 従来通りGMが規則書と実際の判定結果を照らして判断する（このアプリは自動で分岐先を
      // 選ばない——複数PCが異なる結果になり得るため、単純に片方だけを選ぶと誤りうる）。
      // 坑道「白い結晶」専用の2つの入れ子判定は、parseIndividualAbilityCheck等の汎用
      // 検出より先に判定する（分岐ポイント行はブラケットが1つだけなので、そのままでは
      // 個別式として誤検出されてしまう——実データ確認済み）。
      var parsedBranchPointTally = parseBranchPointTallyCheck(line);
      if (parsedBranchPointTally) {
        branchPointTallyIndex = i;
        branchPointTallySpec = parsedBranchPointTally;
        i++;
        break;
      }
      var parsedSequentialPair = parseSequentialPairCheck(line);
      if (parsedSequentialPair) {
        sequentialPairIndex = i;
        sequentialPairSpec = parsedSequentialPair;
        i++;
        break;
      }
      // 湖沼(睡)「眠りの霧の鍾乳洞」専用：祭壇に興味があるかどうかで判定基準が変わる二択。
      var parsedConditionalChoice = parseConditionalCooperativeChoice(line);
      if (parsedConditionalChoice) {
        conditionalChoiceIndex = i;
        conditionalChoiceSpec = parsedConditionalChoice;
        i++;
        break;
      }
      // 東の地下砦「入り組んだ地下の回廊」専用：同じ屬性・異なる目標値の協力式判定の連鎖。
      var parsedChainCheck = parseSequentialCooperativeChain(line);
      if (parsedChainCheck) {
        chainCheckIndex = i;
        chainCheckSpec = parsedChainCheck;
        i++;
        break;
      }
      // 水辺の大教会「正面から（梅花）」専用：異なる屬性の協力式判定を順番に全段実行し、
      // 総成功回数で結果を決める。
      var parsedTallyCheck = parseSequentialCoopTallyCheck(line);
      if (parsedTallyCheck) {
        chainCheckIndex = i;
        chainCheckSpec = parsedTallyCheck;
        i++;
        break;
      }
      // 水辺の大教会「水辺を抜けて横の瓦礫から」専用：任意のPCが任意回数、目標成功回数
      // まで判定を繰り返す。目標成功回数・失敗エスカレーション幅は直後の「成功1回ごと」
      // 「失敗1回ごと」ラベル行の本文から読み取る（この関数だけでは判定行1行しか見えない
      // ため、ここでlines配列を直接参照する）。
      var parsedOpenEndedTally = parseOpenEndedTallyCheck(line);
      if (parsedOpenEndedTally) {
        var oeSuccessLine = lines[i + 1] && lines[i + 1].label && /成功.*ごと/.test(lines[i + 1].label.ja || "") ? lines[i + 1] : null;
        var oeFailLine = lines[i + 2] && lines[i + 2].label && /失敗.*ごと/.test(lines[i + 2].label.ja || "") ? lines[i + 2] : null;
        var oeSuccessText = oeSuccessLine ? (oeSuccessLine.text && oeSuccessLine.text.ja) || "" : "";
        var oeFailText = oeFailLine ? (oeFailLine.text && oeFailLine.text.ja) || "" : "";
        var oeThresholdMatch = /合計(?:で)?(\d+)回(?:の)?成功/.exec(oeSuccessText);
        var oeEscalationMatch = /合計(?:で)?(\d+)回失敗/.exec(oeFailText);
        if (oeSuccessLine && oeThresholdMatch) {
          openEndedTallyIndex = i;
          openEndedTallySpec = {
            target: parsedOpenEndedTally.target,
            statKey: parsedOpenEndedTally.statKey,
            successThreshold: parseInt(oeThresholdMatch[1], 10),
            failEscalationStep: oeEscalationMatch ? parseInt(oeEscalationMatch[1], 10) : null,
            successCount: 0,
            failCount: 0,
            successLineJaLabel: oeSuccessLine.label.ja,
          };
          i = i + (oeFailLine ? 3 : 2); // 判定行・成功/失敗ラベル行はいずれも生の文言を敘述に出さない
          break;
        }
        // 直後の「成功1回ごと」行から数値を読み取れなかった場合は、安全側で従来通り
        // 生の文言敘述にフォールバックする（数値・分岐先を捏造しない）。
      }
      // 大野営地「火の戦車」専用：代表者1人を選び、代表者とそれ以外のPC全員でそれぞれ
      // 異なる目標値の個別判定を行う。
      var parsedRepPick = parseRepresentativePickCheck(line);
      if (parsedRepPick) {
        repPickIndex = i;
        repPickSpec = parsedRepPick;
        i++;
        break;
      }
      // 砦「壺投げのトロル」専用：PC全員がそれぞれ異なる屬性の判定を複数回（1回ずつ）行う。
      var parsedMultiStatCheck = parseMultiStatIndividualCheck(line);
      if (parsedMultiStatCheck) {
        multiStatCheckIndex = i;
        multiStatCheckSpec = parsedMultiStatCheck;
        i++;
        break;
      }
      var parsedAbilityCheck = parseIndividualAbilityCheck(line);
      if (parsedAbilityCheck) {
        abilityCheckIndex = i;
        abilityCheckSpec = parsedAbilityCheck;
        i++; // 判定完了後はこの行の次から再開
        break;
      }
      // 「協力」形式の単純な1回勝負判定：黨全員で1つの結果が決まるため、こちらは
      // 個別判定と違い、判定完了後に一致した側（成功／失敗）だけを選んで敘述できる
      // （下のwalk.pendingOutcomeFilterで処理）。
      var parsedCooperativeCheck = parseCooperativeAbilityCheck(line);
      if (parsedCooperativeCheck) {
        cooperativeCheckIndex = i;
        cooperativeCheckSpec = parsedCooperativeCheck;
        i++;
        break;
      }
      // 特定の1名のPCだけが行う判定：GMに「誰が行くか」を選ばせてから、その1名だけ
      // 自動で擲骰する。協力式と同様、判定完了後は一致した側（成功／失敗）だけを選んで
      // 敘述する（walk.pendingOutcomeFilter）。
      var parsedPlayerPickCheck = parseSinglePlayerCheck(line);
      if (parsedPlayerPickCheck) {
        playerPickCheckIndex = i;
        playerPickCheckSpec = parsedPlayerPickCheck;
        i++;
        break;
      }
      // 「成功」「失敗」等の結果行は、それぞれが独立に同じ選択肢マーカーを持つことがある
      // （例：坑道1の行為判定——成功・失敗どちらの行にも(→ザコ戦闘)が個別に埋め込まれている）。
      // マーカーが見つかった時点ですぐ打ち切ると、まだ処理していない側の結果行（＝失敗した
      // PCへ伝えるべき効果文など）が一切敘述されないままになってしまう。次の行も同じ深さの
      // 「成功／失敗」系の結果行である間は打ち切らず、その行まで敘述に含めてから打ち切る。
      var isOutcomeLabel = line.label && (/成功|失敗/.test(line.label.ja || "") || /成功|失敗/.test(line.label.zh || ""));
      var nextLine = lines[i + 1];
      var nextIsSiblingOutcome =
        isOutcomeLabel &&
        nextLine &&
        nextLine.depth === line.depth &&
        nextLine.label &&
        (/成功|失敗/.test(nextLine.label.ja || "") || /成功|失敗/.test(nextLine.label.zh || ""));
      // handleCooperativeCheckConfirmClickが結果（"成功"／"失敗"）を確定させた直後、この
      // フィルターが立っていれば、一致しない側の結果行は敘述に含めずスキップする（協力式
      // 判定は黨全員で1つの結果しか無いため、個別判定と違い一致しない側を見せる必要が無い）。
      // 成功/失敗系の行の並びを抜けた時点（次が同深さの兄弟でなくなった時点）でフィルターは
      // 消費済みとして解除する——それ以降の無関係な成功/失敗ペアに影響しないようにする。
      if (walk.pendingOutcomeFilter) {
        if (isOutcomeLabel) {
          var outcomeMatches = line.label.ja === walk.pendingOutcomeFilter || line.label.zh === walk.pendingOutcomeFilter;
          if (!outcomeMatches) {
            if (!nextIsSiblingOutcome) walk.pendingOutcomeFilter = null;
            i++;
            continue;
          }
          if (!nextIsSiblingOutcome) walk.pendingOutcomeFilter = null;
        } else {
          walk.pendingOutcomeFilter = null; // 成功/失敗以外の行に達したら対象範囲は終わり
        }
      }
      var lineText = Fields.localizedText(line.text);
      blockParts.push(formatWalkLine(line));
      var labels = parseChoiceLabels(lineText);
      if (labels.length) choiceLabels = labels; // 上書き（複数の結果行が別々に同じ選択肢マーカーを持つ場合、通常は同じ値になる）
      if (choiceLabels.length && !nextIsSiblingOutcome) {
        i++; // 次回はこの行の次から再開
        break;
      }
      i++;
    }
    walk.lineIndex = i;
    var blockText = blockParts.join("\n");
    if (combatTriggerIndex !== -1) {
      state.gmFlow.narrationText = blockText;
      state.gmFlow.pendingChoiceLabels = [];
      state.gmFlow.awaitingOk = true;
      state.gmFlow.actionKind = "combatTrigger";
      state.gmFlow.combatTriggerLabel = combatTriggerTitle(lines[combatTriggerIndex]);
    } else if (branchPointTallyIndex !== -1) {
      state.gmFlow.narrationText = blockText;
      state.gmFlow.pendingChoiceLabels = [];
      state.gmFlow.awaitingOk = true;
      state.gmFlow.actionKind = "branchPointTally";
      state.gmFlow.branchPointTallySpec = branchPointTallySpec;
    } else if (sequentialPairIndex !== -1) {
      state.gmFlow.narrationText = blockText;
      state.gmFlow.pendingChoiceLabels = [];
      state.gmFlow.awaitingOk = true;
      state.gmFlow.actionKind = "sequentialPairCheck";
      state.gmFlow.sequentialPairSpec = sequentialPairSpec;
    } else if (conditionalChoiceIndex !== -1) {
      state.gmFlow.narrationText = (blockText ? blockText + "\n" : "") + window.I18N.t("gm_flow_conditional_choice_prompt");
      state.gmFlow.pendingChoiceLabels = [];
      state.gmFlow.awaitingOk = true;
      state.gmFlow.actionKind = "conditionalCooperativeChoice";
      state.gmFlow.conditionalCooperativeChoiceSpec = conditionalChoiceSpec;
    } else if (chainCheckIndex !== -1) {
      state.gmFlow.narrationText = blockText;
      state.gmFlow.pendingChoiceLabels = [];
      state.gmFlow.awaitingOk = true;
      state.gmFlow.actionKind = "sequentialCooperativeChain";
      state.gmFlow.sequentialChainSpec = {
        mode: chainCheckSpec.mode,
        steps: chainCheckSpec.steps,
        stepIndex: 0,
        successCount: 0,
        awaitingContinue: false,
        markerLabel: chainCheckSpec.markerLabel || null,
      };
    } else if (openEndedTallyIndex !== -1) {
      state.gmFlow.narrationText = (blockText ? blockText + "\n" : "") + window.I18N.t("gm_flow_player_pick_check_prompt");
      state.gmFlow.pendingChoiceLabels = [];
      state.gmFlow.awaitingOk = true;
      state.gmFlow.actionKind = "openEndedTallyCheck";
      state.gmFlow.openEndedTallySpec = openEndedTallySpec;
    } else if (repPickIndex !== -1) {
      state.gmFlow.narrationText = (blockText ? blockText + "\n" : "") + window.I18N.t("gm_flow_representative_pick_prompt");
      state.gmFlow.pendingChoiceLabels = [];
      state.gmFlow.awaitingOk = true;
      state.gmFlow.actionKind = "representativePickCheck";
      state.gmFlow.representativePickSpec = repPickSpec;
    } else if (multiStatCheckIndex !== -1) {
      state.gmFlow.narrationText = blockText;
      state.gmFlow.pendingChoiceLabels = [];
      state.gmFlow.awaitingOk = true;
      state.gmFlow.actionKind = "multiStatIndividualCheck";
      state.gmFlow.multiStatCheckSpec = { checks: multiStatCheckSpec.checks, stepIndex: 0, results: {}, markerLabel: multiStatCheckSpec.markerLabel };
    } else if (abilityCheckIndex !== -1) {
      state.gmFlow.narrationText = blockText;
      state.gmFlow.pendingChoiceLabels = [];
      state.gmFlow.awaitingOk = true;
      state.gmFlow.actionKind = "abilityCheck";
      state.gmFlow.abilityCheckSpec = abilityCheckSpec;
    } else if (cooperativeCheckIndex !== -1) {
      state.gmFlow.narrationText = blockText;
      state.gmFlow.pendingChoiceLabels = [];
      state.gmFlow.awaitingOk = true;
      state.gmFlow.actionKind = "cooperativeCheck";
      state.gmFlow.cooperativeCheckSpec = cooperativeCheckSpec;
    } else if (playerPickCheckIndex !== -1) {
      // 生の判定基準文は出さないため、代わりに「誰が行くか選んでほしい」ことだけ伝える
      // （ボタンだけ並んでいても、何を選ぶボタンなのかGM/玩家に伝わらないため）。
      state.gmFlow.narrationText = (blockText ? blockText + "\n" : "") + window.I18N.t("gm_flow_player_pick_check_prompt");
      state.gmFlow.pendingChoiceLabels = [];
      state.gmFlow.awaitingOk = true;
      state.gmFlow.actionKind = "playerPickCheck";
      state.gmFlow.playerPickCheckSpec = playerPickCheckSpec;
      state.gmFlow.playerPickCheckExcluded = [];
    } else if (choiceLabels.length) {
      state.gmFlow.narrationText = blockText;
      state.gmFlow.pendingChoiceLabels = choiceLabels;
      state.gmFlow.awaitingOk = true;
      state.gmFlow.actionKind = "lineChoice";
    } else {
      finishFieldWalk(blockText, floor);
    }
    Core.saveState();
    Core.renderCurrentLocationStatus();
  }

  // 選ばれた選択肢labelの行き先（同じ樓層内、label無し・textが一致する見出し行）を探し、
  // 見つかればそこへジャンプして以降その分岐の内容だけを敘述する（walk.branchFloorに
  // 見つかった見出し自身のdepthを立てることで、advanceFieldWalk側が選ばなかった兄弟を
  // 読み飛ばす）。見出しがダイス表（「フロア1の内容表（1D）」等）なら、1D6を振って対応する
  // アウトカム見出しへさらにジャンプする。行き先を解決できなかった場合（想定外の表記等）は、
  // 第27項適用前と同じ「そのまま線形に続ける」挙動へ安全にフォールバックする——数値・
  // 分岐先を捏造しない、既存の"■"と同じ方針。
  function handleLineChoiceClick(label) {
    var Core = window.PriTestNightCore;
    var state = Core.state;
    state.turnMessages.push({ text: window.I18N.t("gm_flow_choice_picked_log", { label: label }), time: Date.now(), side: "gm" });
    state.gmFlow.pendingChoiceLabels = [];
    var walk = state.gmFlow.walk;
    var floor = walk ? getWalkFloor(walk) : null;
    if (walk && floor) {
      var lines = floor.lines || [];
      var found = findHeadingIndexForLabel(lines, walk.lineIndex, label);
      if (found.index !== -1) {
        var resolved = resolveDiceTableHeadingIfAny(lines, found.index);
        walk.lineIndex = resolved.index;
        walk.branchFloor = lines[resolved.index].depth;
        walk.branchFloorArmed = false; // ジャンプ先の見出し行自身は境界判定の対象外にする
        var prefixText = [found.text, resolved.text].filter(Boolean).join("\n");
        walk.pendingPrefixText = prefixText || null;
      }
    }
    advanceFieldWalk();
  }

  // headingIndexの行が「フロア1の内容表（1D）」のようなダイス表見出しなら、1D6を振って
  // 直後のbullet行（同表）から対応するアウトカム見出し（見出し自身と同じ深さの兄弟）を
  // 探し出し、そのindexとtext（間に挟まる共通・確定内容、あれば）を返す。ダイス表見出し
  // でない、または表の解析・アウトカム見出しの発見に失敗した場合は、headingIndexをそのまま
  // 返す（フォールバック——見出し自体は敘述されるので、GMが規則書を見て手動で判断できる）。
  function resolveDiceTableHeadingIfAny(lines, headingIndex) {
    var heading = lines[headingIndex];
    if (!isDiceTableHeadingLine(heading)) return { index: headingIndex, text: "" };
    var depth = heading.depth;
    var tableLine = lines[headingIndex + 1];
    if (!tableLine || !tableLine.bullet || tableLine.depth !== depth + 1) return { index: headingIndex, text: "" };
    var entries = parseInlineDiceTable(window.PriTestFields.localizedText(tableLine.text));
    if (!entries) return { index: headingIndex, text: "" };
    var roll = 1 + Math.floor(Math.random() * 6);
    var matched = entries.filter(function (e) {
      return e.faces.indexOf(roll) !== -1;
    })[0];
    if (!matched) return { index: headingIndex, text: "" };
    window.PriTestNightCore.state.turnMessages.push({
      text: window.I18N.t("gm_flow_dice_table_roll_log", { roll: roll, name: matched.name }),
      time: Date.now(),
      side: "gm",
    });
    var outcome = findHeadingIndexForLabel(lines, headingIndex + 1, matched.name);
    return outcome.index !== -1 ? outcome : { index: headingIndex, text: "" };
  }

  // ---- ［戰鬥機制］入口：「雜兵戰鬥」／「王戰」ボタン。敵を敘述し、判明した分だけ戦場に
  // 自動追加してから、GMには「戰鬥進行中」とだけ示して待機状態（battleWait）へ入る
  // （第17・18項：目前先讓Gm敘述戰鬥中、額外的機制往後另行增加）。 ----
  function handleCombatTriggerClick() {
    var Core = window.PriTestNightCore;
    var state = Core.state;
    var Fields = window.PriTestFields;
    var walk = state.gmFlow.walk;
    var floor = walk ? getWalkFloor(walk) : null;
    if (!walk || !floor) {
      finishFieldWalk();
      return;
    }
    var lines = floor.lines || [];
    var triggerIndex = walk.lineIndex;
    var triggerLine = lines[triggerIndex];
    if (!triggerLine) {
      advanceFieldWalk();
      return;
    }
    var collected = collectCombatEnemyLines(lines, triggerIndex);
    var narrationParts = [Fields.localizedText(triggerLine.text)];
    var addedNames = [];
    var reminderTexts = [];
    var isBoss = isBossCombatTriggerLine(triggerLine);
    collected.enemyLines.forEach(function (line) {
      narrationParts.push(Fields.localizedText(line.text));
      var ref = parseCombatEnemyRef(line);
      var result = resolveAndAddCombatEnemies(ref.nameTokens, ref.level, ref.needsLevelCorrection, ref.hasMobRow, walk.slotIndex, isBoss);
      addedNames = addedNames.concat(result.addedNames);
      if (!result.matchedAny) {
        reminderTexts.push(window.I18N.t("gm_flow_combat_manual_add_reminder", { text: Fields.localizedText(line.text) }));
      }
      if (result.levelNote) {
        reminderTexts.push(window.I18N.t(result.levelNote.key, mergeParams({ text: Fields.localizedText(line.text) }, result.levelNote.params)));
      }
      if (result.mobNote) {
        reminderTexts.push(window.I18N.t(result.mobNote.key, mergeParams({ text: Fields.localizedText(line.text) }, result.mobNote.params)));
      }
    });
    if (addedNames.length) {
      state.turnMessages.push({
        text: window.I18N.t("gm_flow_combat_added_log", { names: addedNames.join("、") }),
        time: Date.now(),
        side: "gm",
      });
    }
    reminderTexts.forEach(function (text) {
      state.turnMessages.push({ text: text, time: Date.now(), side: "gm" });
    });

    narrationParts.push(window.I18N.t("gm_flow_combat_in_progress_narration"));
    walk.lineIndex = collected.nextIndex;
    state.gmFlow.narrationText = narrationParts.join("\n");
    state.gmFlow.combatTriggerLabel = null;
    // ［戰鬥機制］：エネミーの全HP行が0になるまで待つ（night.jsのsetActionPhase、
    // combatEndオプション経由でnotifyCombatEndedが呼ばれる）。GMは進度版側で何も操作しない。
    state.gmFlow.battleWaitActive = true;
    state.gmFlow.awaitingOk = true;
    state.gmFlow.actionKind = "battleWait";
    Core.saveState();
    Core.renderCurrentLocationStatus();
  }

  // ［戰鬥結束］：night.jsのsetActionPhaseが「エネミー全滅→一般行動へ自動復帰」を検出した
  // 瞬間（combatEndオプション）に呼ばれる。battleWaitActive中でなければ無関係の戦闘終了
  // （樓層敘述と無関係にGMが手動で編成したエネミーを倒した場合等）なので何もしない。
  function notifyCombatEnded() {
    var Core = window.PriTestNightCore;
    var state = Core.state;
    if (!state.gmFlow.battleWaitActive) return;
    state.gmFlow.battleWaitActive = false;
    advanceFieldWalk(); // ［樓層判定機制］へ戻り、撃破後の規則書敘述（獎勵等）を続ける
  }

  // 樓層本文が尽きた（または分岐データが解決できなかった）ときの締めくくり。
  // floorにreward（fields.jsの構造化獎勵データ）があれば[領取獎勵]ボタンも合わせて出す。
  function finishFieldWalk(blockText, floor) {
    var Core = window.PriTestNightCore;
    var state = Core.state;
    var FloorBreakthrough = window.PriTestNightFloorBreakthrough;
    var walk = state.gmFlow.walk;
    var walkSlotIndex = walk ? walk.slotIndex : null;
    var walkEntry = walk ? getWalkEntry(walk) : null;
    var walkFloorIndex = walk ? walk.floorIndex : null;
    var hasReward = !!(floor && FloorBreakthrough.floorHasAnyReward && FloorBreakthrough.floorHasAnyReward(floor));
    state.gmFlow.narrationText = blockText || window.I18N.t("gm_flow_walk_end_narration");
    state.gmFlow.awaitingOk = true;
    state.gmFlow.pendingChoiceLabels = [];
    state.gmFlow.walk = null;
    if (hasReward) {
      state.gmFlow.actionKind = "floorEnd";
      pendingFloorEndFloor = floor;
    } else {
      state.gmFlow.actionKind = "ok";
      pendingFloorEndFloor = null;
    }
    // ［路線自由］（branch.freeFloorOrder）カード：通常のcardLevels連番進行ではなく、
    // 位置ごとのクリア状態を管理する。しきい値に達したら「全踏破」チェーンへ乗せる
    // （通常カードと同じpendingFinalFloorSlot等の仕組みを再利用するが、stepCardLevelの
    // 連番ロジックは経由しない——advanceCardConclusionChain側でcardLevels===nullを見て
    // stepCardLevelを呼ばないよう分岐する）。
    var walkBranch = walkEntry && walk && typeof walk.branchIndex === "number" ? walkEntry.branches[walk.branchIndex] : null;
    if (walkBranch && walkBranch.freeFloorOrder && floor && typeof walkSlotIndex === "number") {
      var freeFloorPosition = freeFloorPositionOfFloor(floor);
      if (freeFloorPosition !== null) markFreeFloorCleared(walkSlotIndex, walkBranch, freeFloorPosition);
      var freeFloorClearedCount = getFreeFloorCleared(walkSlotIndex, walkBranch).filter(Boolean).length;
      if (freeFloorClearedCount >= walkBranch.freeFloorOrder.clearThreshold) {
        state.cardLevels[walkSlotIndex] = null;
        if (Core.renderCardLevel) Core.renderCardLevel(walkSlotIndex);
        state.gmFlow.pendingFinalFloorSlot = walkSlotIndex;
        state.gmFlow.pendingChipCheckSlot = walkSlotIndex;
        state.gmFlow.pendingMapMoveSlot = walkSlotIndex;
      }
      return;
    }
    // 第5項改：この樓層の敘述が最後まで終わったら、GMが手動で盤面の[+]を押さなくても
    // 自動で樓層カウンターを進め、公開盤地図上のカードの数字が自動的に「踏破済み」を
    // 反映するようにする——以後は自動化GMもそのカードの数字を見るだけで現在位置が分かる。
    // 敘述を最後まで読み終えた＝真の踏破なので、floorClearedにも記録する（突破判定の
    // 「スキップ」との違いは第5項参照）。
    if (floor && typeof walkSlotIndex === "number") {
      if (walkEntry && typeof walkEntry.floorCount === "number" && typeof walkFloorIndex === "number") {
        markFloorCleared(walkSlotIndex, walkEntry.floorCount, walkFloorIndex);
        advanceOrRewindCardPointer(walkSlotIndex, walkEntry.floorCount, walkFloorIndex);
      }
      // 第18・19項「結束該卡牌的最後一個樓層後...則再處理［全踏破］處理...再次詢問是否使用
      // 籌碼事件...接著處理［地圖移動機制］」：cardLevelsが「全」（null）になった＝floorCleared
      // が全樓層true（第6項の巻き戻しロジックにより、途中にスキップだけの樓層が残っていれば
      // nullにはならず、その樓層へポインタが巻き戻される）。この樓層の獎勵ゲート（floorEnd）
      // をGMが領取し終えるまで待ってから（＝closeGmFlowGateAndConsumePendingAdvance／
      // advanceCardConclusionChain側で）「全」踏破処理→籌碼確認→地圖移動、の順で自動的に
      // 連鎖させる。ここで即座に進めると、まだ見せていないこの樓層の獎勵ゲートを跨ぎ越して
      // しまうため、領取完了（[獲得完]）のタイミングまで意図的に遅延させる。
      if (Core.state.cardLevels[walkSlotIndex] === null) {
        state.gmFlow.pendingFinalFloorSlot = walkSlotIndex;
        state.gmFlow.pendingChipCheckSlot = walkSlotIndex;
        state.gmFlow.pendingMapMoveSlot = walkSlotIndex;
      }
    } else if (floor && (walkSlotIndex === "start" || walkSlotIndex === "end")) {
      // 起點／終點（出發地點／黄金樹の帳）は数値cardLevelsを持たないためstepCardLevelの
      // 対象外だったが、常にfloorCount:1（fields.js参照）——樓層本文の敘述完了＝即座に
      // その唯一の樓層を踏破済みなので、数値板塊の「cardLevels===floorCountに到達」と
      // 同じ扱いで全踏破連鎖の対象にする（ユーザー報告：出發地點で戦闘に勝っても全踏破・
      // 地圖移動が案内されないバグの修正）。籌碼事件（state.eventChips）は起點/終點には
      // 存在しない概念のため、pendingChipCheckSlotはここでは設定しない。
      state.gmFlow.pendingFinalFloorSlot = walkSlotIndex;
      state.gmFlow.pendingMapMoveSlot = walkSlotIndex;
    }
  }

  // finishFieldWalkが検出したfloor.reward情報は、モーダルを開くのに実物のfloorオブジェクトの
  // 参照が要る（openFloorRewardModalはfloor自体を引数に取る）ため、stateに直列化保存せず
  // モジュール内変数として持つ（devicecrossの同期は不要——[領取獎勵]は押した端末で
  // 既存の獎勵モーダルを開くだけの操作で、既存の獎勵システム自体は元々cross-device同期済み）。
  var pendingFloorEndFloor = null;

  function handleFloorEndRewardClick() {
    if (pendingFloorEndFloor) window.PriTestNightFloorBreakthrough.openFloorRewardModal(pendingFloorEndFloor);
    closeGmFlowGateAndConsumePendingAdvance();
    window.PriTestNightCore.saveState();
    window.PriTestNightCore.renderCurrentLocationStatus();
  }

  // 第15・18項：全樓層踏破時、grantCardFullClearRewardIfNeeded（night.js）から呼ばれる。
  // 効果自体はすでに自動付与済み——ここは「何が起きたか」をGM敘述として見せて[OK]待ちにするだけ。
  // effectTextが無いカード（allFloorEffect未設定）でも「全踏破した」こと自体は必ず敘述する。
  // ［地圖移動］への案内はここでは出さない——この呼び出しの後、GMがこのゲートを閉じた時点で
  // advanceCardConclusionChainが籌碼確認（あれば）を挟んでから改めて出す（第19項の順序：
  // 全踏破処理→籌碼確認→地圖移動）。この呼び出しはa_golden（黄金樹の帳）以外の全踏破でのみ
  // 発生する（黄金樹の帳はhandleGoldenTreeFullClearが別途、進次日の案内を出す）。
  function showFullClearNarration(cardName, effectText) {
    var Core = window.PriTestNightCore;
    var state = Core.state;
    state.gmFlow.narrationText = effectText
      ? window.I18N.t("gm_flow_full_clear_narration", { name: cardName, effect: effectText })
      : window.I18N.t("gm_flow_full_clear_narration_no_effect", { name: cardName });
    state.gmFlow.awaitingOk = true;
    state.gmFlow.actionKind = "ok";
    Core.saveState();
    Core.renderCurrentLocationStatus();
  }

  // ［地圖移動機制］：全踏破処理（と、あれば籌碼確認）がすべて終わった後の最後の案内。
  // 実際の移動操作自体は既存の盤面長押し移動UIに委ねる。第4項：ゲートを開いた時点の
  // focusedIndexを記録しておき、[OK]を押した時点でまだ同じ位置のままなら（＝実際には
  // 移動していない）ゲートを閉じずにリマインドを繰り返す（handleMapMoveOkClick参照）。
  function showMapMoveNarration() {
    var Core = window.PriTestNightCore;
    var state = Core.state;
    state.gmFlow.narrationText = window.I18N.t("gm_flow_map_move_prompt");
    state.gmFlow.awaitingOk = true;
    state.gmFlow.actionKind = "mapMove";
    state.gmFlow.pendingMapMoveFromIndex = state.focusedIndex;
    Core.saveState();
    Core.renderCurrentLocationStatus();
  }

  // 第4項：地圖移動ゲートの[OK]。まだ移動していない（focusedIndexがゲートを開いた時点と
  // 同じ）場合はリマインドを再表示してゲートを維持する（＝実質的な迴圈）。移動済みなら
  // 通常のゲート解決（closeGmFlowGateAndConsumePendingAdvance）へ進む。
  function handleMapMoveOkClick() {
    var Core = window.PriTestNightCore;
    var state = Core.state;
    if (state.focusedIndex === state.gmFlow.pendingMapMoveFromIndex) {
      state.gmFlow.narrationText = window.I18N.t("gm_flow_map_move_not_moved_reminder");
      lastTypedNarration = null; // リマインド文言は必ず打字機を再生する
      Core.saveState();
      Core.renderCurrentLocationStatus();
      return;
    }
    state.gmFlow.pendingMapMoveFromIndex = null;
    closeGmFlowGateAndConsumePendingAdvance();
    Core.saveState();
    Core.renderCurrentLocationStatus();
  }

  function handleBreakthroughClick() {
    var idx = window.PriTestNightCore.state.focusedIndex;
    if (idx === null || idx === undefined) return;
    window.PriTestNightFloorBreakthrough.openBreakthroughModal(idx);
  }

  // 獎勵収集完成ゲート（第5項）：縮小されたまま未クローズの獎勵視窗が残っていれば、
  // [獲得完]を押しても進めさせず、残数を再度リマインドする。
  function handleGmFlowOk() {
    var Core = window.PriTestNightCore;
    var state = Core.state;
    var pending = state.gmFlow.pendingRewardWindows.length;
    if (pending > 0) {
      state.gmFlow.narrationText = window.I18N.t("gm_flow_reward_pending_reminder", { count: pending });
      lastTypedNarration = null; // リマインド文言は必ず打字機を再生する
      Core.saveState();
      Core.renderCurrentLocationStatus();
      return;
    }
    if (!state.gmFlow.openingPlayed) state.gmFlow.openingPlayed = true;
    closeGmFlowGateAndConsumePendingAdvance();
    Core.saveState();
    Core.renderCurrentLocationStatus();
  }

  function clearGmFlowGate() {
    var state = window.PriTestNightCore.state;
    state.gmFlow.awaitingOk = false;
    state.gmFlow.narrationText = null;
    state.gmFlow.actionKind = "ok";
    state.gmFlow.walk = null;
    state.gmFlow.pendingChoiceLabels = [];
    state.gmFlow.battleWaitActive = false;
    state.gmFlow.combatTriggerLabel = null;
    state.gmFlow.abilityCheckSpec = null;
    abilityCheckRolls = null;
    state.gmFlow.cooperativeCheckSpec = null;
    cooperativeCheckRolls = null;
    state.gmFlow.playerPickCheckSpec = null;
    state.gmFlow.playerPickCheckExcluded = [];
    state.gmFlow.branchPointTallySpec = null;
    state.gmFlow.sequentialPairSpec = null;
    branchTallyRolls = null;
    state.gmFlow.conditionalCooperativeChoiceSpec = null;
    state.gmFlow.sequentialChainSpec = null;
    state.gmFlow.openEndedTallySpec = null;
    state.gmFlow.representativePickSpec = null;
    state.gmFlow.multiStatCheckSpec = null;
    state.gmFlow.freeFloorOptions = [];
    state.gmFlow.chipOfferSlot = null;
    state.gmFlow.chipOfferContinuation = null;
    state.gmFlow.pendingMapMoveFromIndex = null;
    pendingFloorEndFloor = null;
    lastTypedNarration = null;
  }

  // 第18・19項「結束該卡牌的最後一個樓層後...則再處理［全踏破］處理...再次詢問是否使用
  // 籌碼事件...接著處理［地圖移動機制］」：finishFieldWalkが「この＋1でカードの実在する
  // 樓層をすべて踏破済みになった」と検出していた場合、pendingFinalFloorSlot／
  // pendingChipCheckSlot／pendingMapMoveSlotの3つを予約している。1つのゲートが閉じる
  // たびに、この順（全踏破→籌碼確認→地圖移動）で次に何を出すべきか判定し直す
  // ディスパッチャ——1ステップ進めるたびに新しいゲートが開いて処理が中断するため、
  // 各ステップの解決処理（handleGmFlowOk／handleFloorEndRewardClick／resolveChipOffer）
  // から改めて呼び直される。
  function advanceCardConclusionChain() {
    var Core = window.PriTestNightCore;
    var state = Core.state;
    // pendingFinalFloorSlot／pendingMapMoveSlotは数値（板塊index）または"start"/"end"
    // （起點/終點）のいずれも取り得る——null/undefinedと区別するだけなので厳密等価で判定する。
    var finalFloorSlot = state.gmFlow.pendingFinalFloorSlot;
    if (finalFloorSlot !== null && finalFloorSlot !== undefined) {
      state.gmFlow.pendingFinalFloorSlot = null;
      if (typeof finalFloorSlot === "number") {
        // ［路線自由］カード（finishFieldWalkが既にcardLevelsを直接nullへ設定済み）は
        // stepCardLevelの連番ロジックを経由せず、全踏破処理だけを直接発火する
        // （stepCardLevelをここでも呼ぶと、既にnullな状態から更に1つ進めてしまい、
        // steps配列の先頭へ巻き戻ってしまう）。
        if (Core.state.cardLevels[finalFloorSlot] === null) {
          Core.grantCardFullClearRewardIfNeeded(finalFloorSlot);
        } else {
          Core.stepCardLevel(finalFloorSlot, 1); // → 「全」。内部でgrantCardFullClearRewardIfNeededが発火し、続く敘述ゲートを新たに開く
        }
      } else {
        Core.grantPileFullClearRewardIfNeeded(finalFloorSlot); // "start"|"end"
      }
      return;
    }
    // 籌碼事件（state.eventChips）は起點/終點には存在しない概念のため、pendingChipCheckSlotは
    // 数値板塊のときのみ設定される（finishFieldWalk参照）——ここも数値限定のままでよい。
    var chipCheckSlot = state.gmFlow.pendingChipCheckSlot;
    if (typeof chipCheckSlot === "number") {
      state.gmFlow.pendingChipCheckSlot = null;
      if (offerEventChipIfPending(chipCheckSlot, "cardConclusion")) return;
    }
    var mapMoveSlot = state.gmFlow.pendingMapMoveSlot;
    if (mapMoveSlot !== null && mapMoveSlot !== undefined) {
      state.gmFlow.pendingMapMoveSlot = null;
      showMapMoveNarration();
    }
  }

  // GMがこの樓層のゲート（[獲得完]/[OK]/[領取獎勵]）を実際に閉じ終えたタイミングで呼ばれる。
  // handleGmFlowOk（[獲得完]/[OK]）とhandleFloorEndRewardClick（[領取獎勵]）の両方の
  // ゲート解決経路から呼ばれる。
  function closeGmFlowGateAndConsumePendingAdvance() {
    clearGmFlowGate();
    advanceCardConclusionChain();
  }

  // ---- 日夜轉場整體流程（第16項） ----

  // 「黄金樹の帳」全踏破時（night.jsのgrantCardFullClearRewardIfNeededから呼ばれる）。
  // 規則書：夜の強敵撃破後の追加処理——全員の聖杯瓶使用回数／現在HP／現在FP／夜渡りスキル
  // 使用回数を最大値まで回復（レベルアップの実行自体は各キャラクター詳細ドロワー側の既存UIを
  // 使う操作なので、ここでは自動化せずリマインドに留める）。処理後は[進入下一晚]/[稍後]を出す。
  function handleGoldenTreeFullClear(cardName, effectText) {
    var Core = window.PriTestNightCore;
    var state = Core.state;
    var EventChips = window.PriTestNightEventChips;
    if (EventChips) {
      Core.getRosterCharacters()
        .filter(function (c) {
          return c.entered;
        })
        .forEach(function (c) {
          EventChips.applyEventChipBlessingRest(c);
        });
    }
    state.gmFlow.narrationText = window.I18N.t("gm_flow_golden_tree_clear_narration", { name: cardName, effect: effectText });
    state.gmFlow.awaitingOk = true;
    state.gmFlow.actionKind = "nightAdvance";
    Core.saveState();
    Core.renderCurrentLocationStatus();
  }

  // 黄金樹の帳（a_golden）の全踏破は通常カードと同じfinishFieldWalk経路を通るため、
  // pendingChipCheckSlot／pendingMapMoveSlotも一緒に予約されている場合がある。黄金樹の帳は
  // ［地圖移動］ではなく進次日フロー（handleAdvanceNightClick/handleDismissNarrationClick）に
  // 分岐するため、advanceCardConclusionChainを経由せず素通りする——次日は盤面ごと入れ替わり
  // 無関係になるので、ここで確実に破棄しておく。
  function clearPendingCardConclusionFlags() {
    var state = window.PriTestNightCore.state;
    state.gmFlow.pendingFinalFloorSlot = null;
    state.gmFlow.pendingChipCheckSlot = null;
    state.gmFlow.pendingMapMoveSlot = null;
  }

  // [進入下一晚]：既存の主要ボタン（#btn-primary-action、シナリオ有無で
  // openKeepCardsDrawer/openSelectDrawerのどちらかに繋がる）をそのままクリックする——
  // ロジックを複製せず、既存の正しい分岐に完全に委ねる。
  function handleAdvanceNightClick() {
    clearGmFlowGate();
    clearPendingCardConclusionFlags();
    window.PriTestNightCore.saveState();
    window.PriTestNightCore.renderCurrentLocationStatus();
    var btn = document.getElementById("btn-primary-action");
    if (btn && !btn.disabled) btn.click();
  }

  // [稍後]：夜の強敵撃破の敘述だけ閉じる（進次日はまだしない）。
  function handleDismissNarrationClick() {
    clearGmFlowGate();
    window.PriTestNightCore.saveState();
    window.PriTestNightCore.renderCurrentLocationStatus();
  }

  // 3日目に到達したら（このゲームで初回のみ）、最終「夜の王」戦闘に触れるアナウンスを出す。
  // state.gmFlowEnabledかつdayNumber>=3の間、renderLocationBanner呼び出しのたびにチェックするが、
  // finalDayAnnouncedで一度きりに制限する。
  function maybeAnnounceFinalDay() {
    var Core = window.PriTestNightCore;
    var state = Core.state;
    if (!state.gmFlowEnabled || state.gmFlow.finalDayAnnounced || state.gmFlow.awaitingOk) return;
    if (state.dayNumber < 3) return;
    state.gmFlow.finalDayAnnounced = true;
    var game = Core.getGame();
    var bossName = "";
    if (game && game.night3BossId && window.PriTestBossRulebook) {
      var bossInfo = window.PriTestBossRulebook.get(game.night3BossId);
      if (bossInfo) bossName = window.PriTestFields.localizedText(bossInfo.name);
    }
    if (!bossName) bossName = window.I18N.t("gm_flow_final_day_boss_unknown");
    state.gmFlow.narrationText = window.I18N.t("gm_flow_final_day_narration", { boss: bossName });
    state.gmFlow.awaitingOk = true;
    state.gmFlow.actionKind = "finalDayBattle";
    Core.saveState();
  }

  // [開啟夜王戰鬥]：既存の戦闘ドロワーを開くだけ——エネミー追加自体は既存の検索/追加UIに委ねる
  // （夜の王のHP/レベルは構造化データで既に正しいが、編隊への追加処理自体は複製しない）。
  function handleOpenFinalBattleClick() {
    clearGmFlowGate();
    var Core = window.PriTestNightCore;
    Core.saveState();
    Core.renderCurrentLocationStatus();
    Core.openBattleDrawer();
  }

  // ---- 「行為判定」自動擲骰モーダル ----
  // { charId: { dice:[...], sum, passed, statKey } }。breakthroughState（night_floor_breakthrough.js）
  // と同じ設計方針——現在進行中の判定發生のみ有効な非永続state、リロードで消えてもよい
  // （判定自体は一瞬の操作であり、gmFlow.abilityCheckSpecだけ保存されていれば
  // 再びこのモーダルを開き直して振り直せる）。
  var abilityCheckRolls = null;

  function beginAbilityCheck() {
    abilityCheckRolls = {};
    renderAbilityCheckModal();
    var modalEl = document.getElementById("ability-check-modal");
    if (modalEl) modalEl.hidden = false;
  }

  function renderAbilityCheckModal() {
    var Core = window.PriTestNightCore;
    var state = Core.state;
    var spec = state.gmFlow.abilityCheckSpec;
    var titleEl = document.getElementById("ability-check-modal-title");
    var container = document.getElementById("ability-check-characters");
    var doneBtn = document.getElementById("btn-ability-check-done");
    if (!spec || !titleEl || !container || !doneBtn) return;
    if (!abilityCheckRolls) abilityCheckRolls = {};
    titleEl.textContent = window.I18N.t("ability_check_modal_title", {
      stat: window.I18N.t("check_stat_" + spec.statKey),
    });
    container.innerHTML = "";
    var CharacterTypes = window.PriTestCharacterTypes;
    var entered = Core.getRosterCharacters().filter(function (c) {
      return c.entered;
    });
    entered.forEach(function (c) {
      var row = document.createElement("div");
      row.className = "wb-row breakthrough-char-row";
      var name = document.createElement("span");
      name.className = "breakthrough-char-name";
      name.textContent = c.name;
      row.appendChild(name);

      var entry = abilityCheckRolls[c.id];
      var statSelect = null;
      if (spec.statKey === "any") {
        statSelect = document.createElement("select");
        ["luck", "physical", "mental"].forEach(function (key) {
          var opt = document.createElement("option");
          opt.value = key;
          opt.textContent = window.I18N.t("check_stat_" + key);
          statSelect.appendChild(opt);
        });
        statSelect.value = (entry && entry.statKey) || "luck";
        statSelect.disabled = !!entry;
        row.appendChild(statSelect);
      }

      if (entry) {
        var resultLabel = document.createElement("span");
        resultLabel.className = "ability-check-result " + (entry.passed ? "ability-check-pass" : "ability-check-fail");
        resultLabel.textContent = window.I18N.t("ability_check_result_label", {
          dice: entry.dice.join("+"),
          sum: entry.sum,
          outcome: window.I18N.t(entry.passed ? "ability_check_pass_label" : "ability_check_fail_label"),
        });
        row.appendChild(resultLabel);
      } else {
        var rollBtn = document.createElement("button");
        rollBtn.type = "button";
        rollBtn.className = "combat-attack-hit-btn";
        rollBtn.textContent = window.I18N.t("ability_check_roll_button");
        rollBtn.addEventListener("click", function () {
          var useStat = statSelect ? statSelect.value : spec.statKey;
          rollAbilityCheckForCharacter(c.id, useStat);
        });
        row.appendChild(rollBtn);
      }
      container.appendChild(row);
    });
    // entered.length===0（入場PCがいない）の場合、everyは空配列に対してtrueを返す——
    // 振る対象が無いのでそのまま［完成判定］を押せる状態にする（さもないと永久にボタンが
    // 有効化されず、そのままwalkthroughが進められなくなってしまう）。
    var allRolled = entered.every(function (c) {
      return !!abilityCheckRolls[c.id];
    });
    doneBtn.disabled = !allRolled;
  }

  function rollAbilityCheckForCharacter(charId, statKey) {
    var Core = window.PriTestNightCore;
    var state = Core.state;
    var spec = state.gmFlow.abilityCheckSpec;
    if (!spec || !abilityCheckRolls) return;
    var c = Core.getRosterCharacters().filter(function (rc) {
      return rc.id === charId;
    })[0];
    var type = c && c.typeId ? window.PriTestCharacterTypes.get(c.typeId) : null;
    var count = window.PriTestNightFloorBreakthrough.effectiveCheckValue(c, type, statKey);
    var dice = [];
    for (var i = 0; i < count; i++) dice.push(1 + Math.floor(Math.random() * 6));
    var sum = dice.reduce(function (a, b) {
      return a + b;
    }, 0);
    abilityCheckRolls[charId] = { dice: dice, sum: sum, passed: sum >= spec.target, statKey: statKey };
    renderAbilityCheckModal();
  }

  // 全員の判定骰を振り終えたら［完成］：各PCの結果を留言板へ一括報告し（失敗者がいれば
  // 追加で個別にリマインド——効果自体は"■"と同じく非強制／GM判断のため自動適用しない）、
  // モーダルを閉じて敘述walkthroughを続行する（この行為判定自体の生の判定基準文は敘述に
  // 出さない——後続の成功/失敗の文言はこれまで通りそのまま敘述され、GMが実際の結果と
  // 照らして該当プレイヤーへ伝える）。
  function handleAbilityCheckDoneClick() {
    var Core = window.PriTestNightCore;
    var state = Core.state;
    var spec = state.gmFlow.abilityCheckSpec;
    if (!spec || !abilityCheckRolls) return;
    // 砦「壺投げのトロル」の多屬性連続判定中は、通常の完成処理ではなく専用の
    // resolveMultiStatCheckRoundへ委ねる（同じモーダル・骰子ロジックをそのまま再利用しつつ、
    // 複数ラウンドをまたいでPCごとの結果を積み上げる必要があるため）。
    if (state.gmFlow.multiStatCheckSpec) {
      resolveMultiStatCheckRound();
      return;
    }
    var entered = Core.getRosterCharacters().filter(function (c) {
      return c.entered;
    });
    var entries = entered
      .filter(function (c) {
        return !!abilityCheckRolls[c.id];
      })
      .map(function (c) {
        var entry = abilityCheckRolls[c.id];
        return window.I18N.t("gm_flow_ability_check_result_entry", {
          name: c.name,
          dice: entry.dice.join("+"),
          sum: entry.sum,
          outcome: window.I18N.t(entry.passed ? "ability_check_pass_label" : "ability_check_fail_label"),
        });
      });
    var failedNames = entered
      .filter(function (c) {
        return abilityCheckRolls[c.id] && !abilityCheckRolls[c.id].passed;
      })
      .map(function (c) {
        return c.name;
      });
    state.turnMessages.push({
      text: window.I18N.t("gm_flow_ability_check_summary_log", {
        target: spec.target,
        stat: window.I18N.t("check_stat_" + spec.statKey),
        results: entries.join("、"),
      }),
      time: Date.now(),
      side: "gm",
    });
    if (failedNames.length) {
      state.turnMessages.push({
        text: window.I18N.t("gm_flow_ability_check_fail_reminder_log", { names: failedNames.join("、") }),
        time: Date.now(),
        side: "gm",
      });
    }
    abilityCheckRolls = null;
    var modalEl = document.getElementById("ability-check-modal");
    if (modalEl) modalEl.hidden = true;
    state.gmFlow.abilityCheckSpec = null;
    state.gmFlow.actionKind = "ok";
    // この判定行自身に「成否に関わらず〜（→X）」マーカーが埋め込まれていた場合、境界判定を
    // 誤って「選ばなかった分岐」として読み飛ばさないよう合流先ラベルを伝える。
    var abilityWalk = state.gmFlow.walk;
    if (abilityWalk && spec.markerLabel) abilityWalk.pendingConvergeLabel = spec.markerLabel;
    advanceFieldWalk();
  }

  // ---- 砦「壺投げのトロル」専用：PC全員がそれぞれ異なる屬性の判定を複数回行う ----
  // 既存のability-check-modalをラウンドごとに使い回す（各ラウンドは1つの屬性・全員個別式）。
  function beginMultiStatCheck() {
    var Core = window.PriTestNightCore;
    var state = Core.state;
    var spec = state.gmFlow.multiStatCheckSpec;
    if (!spec) return;
    spec.stepIndex = 0;
    spec.results = {};
    state.gmFlow.abilityCheckSpec = { target: spec.checks[0].target, statKey: spec.checks[0].statKey, markerLabel: null };
    state.gmFlow.actionKind = "abilityCheck";
    abilityCheckRolls = {};
    renderAbilityCheckModal();
    var modalEl = document.getElementById("ability-check-modal");
    if (modalEl) modalEl.hidden = false;
    Core.saveState();
  }

  // 現在のラウンドの擲骰が確定した：各PCの結果をmultiStatCheckSpec.resultsへ積み上げる。
  // まだラウンドが残っていれば同じモーダルを次の屬性で振り直させ、最後まで終わったら
  // PCごとの成功数を留言板へまとめて記録し（結果はPCごとに異なり得るため、既存の
  // 個別判定と同様「すべて成功」「失敗」どちらの結果文もそのまま敘述してGM判断に委ねる
  // ——自動でどちらかへ絞り込まない）、敘述walkthroughを続行する。
  function resolveMultiStatCheckRound() {
    var Core = window.PriTestNightCore;
    var state = Core.state;
    var multiSpec = state.gmFlow.multiStatCheckSpec;
    var roundSpec = state.gmFlow.abilityCheckSpec;
    if (!multiSpec || !roundSpec || !abilityCheckRolls) return;
    var entered = Core.getRosterCharacters().filter(function (c) {
      return c.entered;
    });
    entered.forEach(function (c) {
      var entry = abilityCheckRolls[c.id];
      if (!entry) return;
      if (!multiSpec.results[c.id]) multiSpec.results[c.id] = [];
      multiSpec.results[c.id].push(entry);
    });
    abilityCheckRolls = null;
    if (multiSpec.stepIndex < multiSpec.checks.length - 1) {
      multiSpec.stepIndex += 1;
      var nextCheck = multiSpec.checks[multiSpec.stepIndex];
      state.gmFlow.abilityCheckSpec = { target: nextCheck.target, statKey: nextCheck.statKey, markerLabel: null };
      abilityCheckRolls = {};
      renderAbilityCheckModal();
      Core.saveState();
      return;
    }
    var entries = entered.map(function (c) {
      var rounds = multiSpec.results[c.id] || [];
      var passCount = rounds.filter(function (r) {
        return r.passed;
      }).length;
      return window.I18N.t("gm_flow_multi_stat_check_result_entry", { name: c.name, pass: passCount, total: rounds.length });
    });
    state.turnMessages.push({
      text: window.I18N.t("gm_flow_multi_stat_check_summary_log", { results: entries.join("、") }),
      time: Date.now(),
      side: "gm",
    });
    var modalEl = document.getElementById("ability-check-modal");
    if (modalEl) modalEl.hidden = true;
    state.gmFlow.abilityCheckSpec = null;
    state.gmFlow.multiStatCheckSpec = null;
    state.gmFlow.actionKind = "ok";
    var walk = state.gmFlow.walk;
    if (walk && multiSpec.markerLabel) walk.pendingConvergeLabel = multiSpec.markerLabel;
    advanceFieldWalk();
  }

  // ---- 「行為判定」自動擲骰モーダル（協力式・単純な1回勝負のみ）----
  // { charId: { dice:[...], statKey, rerollPending } }。個別判定用のabilityCheckRollsとは
  // 別変数——黨全員の骰子を1つのプールに合算する点が違う（個別のpassedは持たない）。
  var cooperativeCheckRolls = null;

  function beginCooperativeCheck() {
    cooperativeCheckRolls = {};
    renderCooperativeCheckModal();
    var modalEl = document.getElementById("cooperative-check-modal");
    if (modalEl) modalEl.hidden = false;
  }

  function renderCooperativeCheckModal() {
    var Core = window.PriTestNightCore;
    var state = Core.state;
    var spec = state.gmFlow.cooperativeCheckSpec;
    var titleEl = document.getElementById("cooperative-check-modal-title");
    var container = document.getElementById("cooperative-check-characters");
    var poolLabel = document.getElementById("cooperative-check-pool-label");
    var confirmBtn = document.getElementById("btn-cooperative-check-confirm");
    if (!spec || !titleEl || !container || !confirmBtn) return;
    if (!cooperativeCheckRolls) cooperativeCheckRolls = {};
    // 門檻（目標値）は玩家にも進度版にも一切表示しない——擲骰完了後、自動GMが通過/失敗の
    // 結果だけを進度版で揭曉する（ユーザー指示：始終不顯示判定門檻）。
    titleEl.textContent = window.I18N.t("cooperative_check_modal_title", { stat: window.I18N.t("check_stat_" + spec.statKey) });
    container.innerHTML = "";
    var entered = Core.getRosterCharacters().filter(function (c) {
      return c.entered;
    });
    var poolSum = 0;
    entered.forEach(function (c) {
      var entry = cooperativeCheckRolls[c.id];
      if (entry) {
        poolSum += entry.dice.reduce(function (a, b) {
          return a + b;
        }, 0);
      }
    });
    entered.forEach(function (c) {
      var row = document.createElement("div");
      row.className = "wb-row breakthrough-char-row";
      var name = document.createElement("span");
      name.className = "breakthrough-char-name";
      name.textContent = c.name;
      row.appendChild(name);

      var entry = cooperativeCheckRolls[c.id];
      var statSelect = null;
      if (spec.statKey === "any") {
        statSelect = document.createElement("select");
        ["luck", "physical", "mental"].forEach(function (key) {
          var opt = document.createElement("option");
          opt.value = key;
          opt.textContent = window.I18N.t("check_stat_" + key);
          statSelect.appendChild(opt);
        });
        statSelect.value = (entry && entry.statKey) || "luck";
        statSelect.disabled = !!entry;
        row.appendChild(statSelect);
      }

      if (entry) {
        var diceLabel = document.createElement("span");
        diceLabel.textContent = entry.dice.join("+");
        row.appendChild(diceLabel);
        if (entry.rerollPending) {
          entry.dice.forEach(function (val, dieIdx) {
            var rerollBtn = document.createElement("button");
            rerollBtn.type = "button";
            rerollBtn.className = "combat-attack-hit-btn";
            rerollBtn.textContent = window.I18N.t("cooperative_check_reroll_die_button", { value: val });
            rerollBtn.addEventListener("click", function () {
              rerollCooperativeCheckDie(c.id, dieIdx);
            });
            row.appendChild(rerollBtn);
          });
        } else if (c.blessingSlots && c.blessingSlots.current > 0) {
          var blessingBtn = document.createElement("button");
          blessingBtn.type = "button";
          blessingBtn.className = "breakthrough-blessing-btn";
          blessingBtn.textContent = window.I18N.t("breakthrough_blessing_button", { current: c.blessingSlots.current });
          blessingBtn.addEventListener("click", function () {
            useCooperativeCheckBlessing(c.id);
          });
          row.appendChild(blessingBtn);
        }
      } else {
        var rollBtn = document.createElement("button");
        rollBtn.type = "button";
        rollBtn.className = "combat-attack-hit-btn";
        rollBtn.textContent = window.I18N.t("ability_check_roll_button");
        rollBtn.addEventListener("click", function () {
          var useStat = statSelect ? statSelect.value : spec.statKey;
          rollCooperativeCheckForCharacter(c.id, useStat);
        });
        row.appendChild(rollBtn);
      }
      container.appendChild(row);
    });
    if (poolLabel) poolLabel.textContent = window.I18N.t("cooperative_check_pool_label", { sum: poolSum });
    var allRolled = entered.every(function (c) {
      return !!cooperativeCheckRolls[c.id];
    });
    var anyRerollPending = entered.some(function (c) {
      return cooperativeCheckRolls[c.id] && cooperativeCheckRolls[c.id].rerollPending;
    });
    confirmBtn.disabled = !allRolled || anyRerollPending;
  }

  function rollCooperativeCheckForCharacter(charId, statKey) {
    var Core = window.PriTestNightCore;
    if (!cooperativeCheckRolls) return;
    var c = Core.getRosterCharacters().filter(function (rc) {
      return rc.id === charId;
    })[0];
    var type = c && c.typeId ? window.PriTestCharacterTypes.get(c.typeId) : null;
    var count = window.PriTestNightFloorBreakthrough.effectiveCheckValue(c, type, statKey);
    var dice = [];
    for (var i = 0; i < count; i++) dice.push(1 + Math.floor(Math.random() * 6));
    cooperativeCheckRolls[charId] = { dice: dice, statKey: statKey, rerollPending: false };
    renderCooperativeCheckModal();
  }

  function useCooperativeCheckBlessing(charId) {
    var Core = window.PriTestNightCore;
    var c = Core.getRosterCharacters().filter(function (rc) {
      return rc.id === charId;
    })[0];
    if (!c || !c.blessingSlots || c.blessingSlots.current <= 0) return;
    var entry = cooperativeCheckRolls && cooperativeCheckRolls[charId];
    if (!entry || !entry.dice.length) return;
    if (!window.confirm(window.I18N.t("breakthrough_blessing_confirm", { name: c.name }))) return;
    c.blessingSlots.current -= 1;
    Core.saveRosterCharacters();
    entry.rerollPending = true;
    renderCooperativeCheckModal();
  }

  function rerollCooperativeCheckDie(charId, dieIndex) {
    var entry = cooperativeCheckRolls && cooperativeCheckRolls[charId];
    if (!entry || !entry.rerollPending) return;
    entry.dice[dieIndex] = 1 + Math.floor(Math.random() * 6);
    entry.rerollPending = false;
    renderCooperativeCheckModal();
  }

  // ［確認骰子］：全員が振り終えたら、自動GMがプール合計と目標値（perPCならPC人数倍）を
  // 比較して通過/失敗を決定する——ユーザー指示通り、目標値そのものはここでも表示しない
  // （留言板にはプール合計と結果だけを記録する）。閉じた後、walk.pendingOutcomeFilterを
  // 立ててadvanceFieldWalkへ戻し、一致した側の成功/失敗内容だけを続けて敘述させる。
  function handleCooperativeCheckConfirmClick() {
    var Core = window.PriTestNightCore;
    var state = Core.state;
    var spec = state.gmFlow.cooperativeCheckSpec;
    if (!spec || !cooperativeCheckRolls) return;
    // 東の地下砦「入り組んだ地下の回廊」の連鎖判定中は、通常の確認処理ではなく専用の
    // resolveSequentialChainStepへ委ねる（同じモーダル・骰子ロジックをそのまま再利用しつつ、
    // 各段ごとに異なる結果文へ振り分ける必要があるため）。
    if (state.gmFlow.sequentialChainSpec) {
      resolveSequentialChainStep();
      return;
    }
    var entered = Core.getRosterCharacters().filter(function (c) {
      return c.entered;
    });
    var poolSum = 0;
    entered.forEach(function (c) {
      var entry = cooperativeCheckRolls[c.id];
      if (entry) {
        poolSum += entry.dice.reduce(function (a, b) {
          return a + b;
        }, 0);
      }
    });
    var actualTarget = spec.perPC ? spec.target * entered.length : spec.target;
    var passed = poolSum >= actualTarget;
    state.turnMessages.push({
      text: window.I18N.t("gm_flow_cooperative_check_summary_log", {
        sum: poolSum,
        outcome: window.I18N.t(passed ? "ability_check_pass_label" : "ability_check_fail_label"),
      }),
      time: Date.now(),
      side: "gm",
    });
    cooperativeCheckRolls = null;
    var modalEl = document.getElementById("cooperative-check-modal");
    if (modalEl) modalEl.hidden = true;
    state.gmFlow.cooperativeCheckSpec = null;
    state.gmFlow.actionKind = "ok";
    var walk = state.gmFlow.walk;
    if (walk) {
      walk.pendingOutcomeFilter = passed ? "成功" : "失敗";
      if (spec.markerLabel) walk.pendingConvergeLabel = spec.markerLabel;
    }
    advanceFieldWalk();
  }

  // ---- 東の地下砦「入り組んだ地下の回廊」専用：協力式判定の連鎖 ----
  // 現在の段（sequentialChainSpec.stepIndex）に対応する協力式判定モーダルを開く。
  // 途中の段から再開する場合（前段成功→［繼續］）もこの関数で次の段を開始する。
  function beginSequentialChainStep() {
    var Core = window.PriTestNightCore;
    var state = Core.state;
    var chain = state.gmFlow.sequentialChainSpec;
    if (!chain) return;
    var step = chain.steps[chain.stepIndex];
    state.gmFlow.cooperativeCheckSpec = { target: step.target, perPC: true, statKey: step.statKey, markerLabel: null };
    state.gmFlow.actionKind = "cooperativeCheck";
    cooperativeCheckRolls = {};
    renderCooperativeCheckModal();
    var modalEl = document.getElementById("cooperative-check-modal");
    if (modalEl) modalEl.hidden = false;
    Core.saveState();
  }

  // 現在の段の擲骰が確定した。2つのモードがある：
  // ・"earlyExitChain"（東の地下砦）：この段専用の結果ラベル（「成功N回目」／「失敗N回目」）
  //   をフロアのlines[]から探して敘述する。失敗、または最終段まで終わった場合は通常の
  //   walkthrough機構（pendingOutcomeFilter／pendingConvergeLabel）に確定を委ねる——結果文
  //   自身に埋め込まれた「（→X）」があれば正しく合流できる。途中の段で成功した場合だけ、
  //   その段の結果文をそのまま敘述し、［繼續］ボタンで次の段へ進める。
  // ・"tallyAll"（水辺の大教会）：成否に関わらず全段を実行し、総成功回数を集計する。
  //   最終段が終わって初めて「N回成功」ラベルで結果を確定する（途中経過は敘述しない
  //   ——規則書も「成否に関わらず次に進む」としているため、途中の成否は隠したまま進める）。
  // どちらのモードも、このフロアの結果行はすべて兄弟として並んでいるため、walkの線形読み
  // 進めにそのまま任せると直後の戦闘トリガー見出し等へ誤って突入し得る——合流先マーカーが
  // 無い場合は直接finishFieldWalkでフロア締めくくりへ進む。
  function resolveSequentialChainStep() {
    var Core = window.PriTestNightCore;
    var state = Core.state;
    var chain = state.gmFlow.sequentialChainSpec;
    var spec = state.gmFlow.cooperativeCheckSpec;
    if (!chain || !spec || !cooperativeCheckRolls) return;
    var entered = Core.getRosterCharacters().filter(function (c) {
      return c.entered;
    });
    var poolSum = 0;
    entered.forEach(function (c) {
      var entry = cooperativeCheckRolls[c.id];
      if (entry) {
        poolSum += entry.dice.reduce(function (a, b) {
          return a + b;
        }, 0);
      }
    });
    var actualTarget = spec.target * entered.length;
    var passed = poolSum >= actualTarget;
    cooperativeCheckRolls = null;
    var modalEl = document.getElementById("cooperative-check-modal");
    if (modalEl) modalEl.hidden = true;
    state.turnMessages.push({
      text: window.I18N.t("gm_flow_cooperative_check_summary_log", {
        sum: poolSum,
        outcome: window.I18N.t(passed ? "ability_check_pass_label" : "ability_check_fail_label"),
      }),
      time: Date.now(),
      side: "gm",
    });
    var walk = state.gmFlow.walk;
    var floor = walk ? getWalkFloor(walk) : null;
    var lines = floor ? floor.lines || [] : [];
    var roundNum = chain.stepIndex + 1;
    var isLastStep = roundNum >= chain.steps.length;

    function findOutcomeLine(jaLabel) {
      for (var i = 0; i < lines.length; i++) {
        if (lines[i].label && lines[i].label.ja === jaLabel) return lines[i];
      }
      return null;
    }
    // tallyAllモードは書き起こしごとに結果ラベルの命名規則が揺れている（実データ確認済み）：
    // 「{n}回成功」（水辺の大教会）、「成功{n}回」／「失敗{total}回」（三つ首の獣・狼の気配2）、
    // 「成功{n}回以上」（狂い火の塔3）。完全一致する回数のラベルを最優先、無ければ「◯回以上」
    // 系のうち条件を満たす最も厳しい（＝値が大きい）閾値を採用し、0回成功時のみ
    // 「すべて失敗」「全部失敗」系ラベルもフォールバックとして受け付ける。
    function findBestTallyOutcomeLine(successCount, totalChecks) {
      var thresholdBest = null;
      var thresholdBestN = -1;
      var zeroFallback = null;
      for (var li = 0; li < lines.length; li++) {
        var candLine = lines[li];
        if (!candLine.label) continue;
        var ja = candLine.label.ja || "";
        var exactMatch = /^(\d+)回成功$/.exec(ja) || /^成功(\d+)回$/.exec(ja);
        if (exactMatch && parseInt(exactMatch[1], 10) === successCount) return candLine;
        var thresholdMatch = /^(\d+)回以上成功$/.exec(ja) || /^成功(\d+)回以上$/.exec(ja);
        if (thresholdMatch) {
          var n = parseInt(thresholdMatch[1], 10);
          if (successCount >= n && n > thresholdBestN) {
            thresholdBest = candLine;
            thresholdBestN = n;
          }
        }
        if (successCount === 0 && !zeroFallback) {
          var failMatch = /^失敗(\d+)回$/.exec(ja);
          if (ja === "すべて失敗" || ja === "全部失敗" || (failMatch && parseInt(failMatch[1], 10) === totalChecks)) {
            zeroFallback = candLine;
          }
        }
      }
      return thresholdBest || zeroFallback;
    }
    function finalizeWith(outcomeLabel, outcomeLine) {
      var lineMarker = outcomeLine ? singleMarkerLabel((outcomeLine.text && outcomeLine.text.ja) || "") : null;
      var marker = lineMarker || chain.markerLabel || null;
      state.gmFlow.sequentialChainSpec = null;
      state.gmFlow.cooperativeCheckSpec = null;
      if (marker && walk) {
        state.gmFlow.actionKind = "ok";
        walk.pendingOutcomeFilter = outcomeLabel;
        walk.pendingConvergeLabel = marker;
        advanceFieldWalk();
      } else {
        finishFieldWalk(outcomeLine ? formatWalkLine(outcomeLine) : "", floor);
        Core.saveState();
        Core.renderCurrentLocationStatus();
      }
    }

    if (chain.mode === "tallyAll") {
      if (passed) chain.successCount += 1;
      if (!isLastStep) {
        // 成否に関わらず次の段へ（途中経過は敘述しない）。
        chain.stepIndex += 1;
        chain.awaitingContinue = true;
        state.gmFlow.cooperativeCheckSpec = null;
        state.gmFlow.narrationText = window.I18N.t("gm_flow_chain_next_step_narration");
        state.gmFlow.awaitingOk = true;
        state.gmFlow.actionKind = "sequentialCooperativeChain";
        Core.saveState();
        Core.renderCurrentLocationStatus();
        return;
      }
      var tallyLine = findBestTallyOutcomeLine(chain.successCount, chain.steps.length);
      var tallyLabel = tallyLine && tallyLine.label ? tallyLine.label.ja : chain.successCount + "回成功";
      finalizeWith(tallyLabel, tallyLine);
      return;
    }

    // mode === "earlyExitChain"（既定）
    var outcomeLabel = (passed ? "成功" : "失敗") + roundNum + "回目";
    var outcomeLine = findOutcomeLine(outcomeLabel);
    if (!passed || isLastStep) {
      finalizeWith(outcomeLabel, outcomeLine);
      return;
    }
    // 途中の段の成功：この段の結果文だけ敘述し、［繼續］で次の段へ。
    chain.stepIndex += 1;
    chain.awaitingContinue = true;
    state.gmFlow.cooperativeCheckSpec = null;
    state.gmFlow.narrationText = outcomeLine ? formatWalkLine(outcomeLine) : "";
    state.gmFlow.awaitingOk = true;
    state.gmFlow.actionKind = "sequentialCooperativeChain";
    Core.saveState();
    Core.renderCurrentLocationStatus();
  }

  // ---- 「行為判定」（水辺の大教会「水辺を抜けて横の瓦礫から」専用：任意のPCが任意回数
  // 判定を繰り返す）----
  // クリックされたPC（＋statKeyが"any"の場合は選んだ屬性）で1回だけ擲骰し、累積成功回数
  // へ反映する。目標成功回数に達していれば「成功N回ごと」ラベル行の本文を敘述してフロア
  // 締めくくりへ、達していなければ進捗（成功／失敗回数）を敘述して同じピッカーを再表示する
  // （retryOnFailのような除外はしない——「PCは任意の順番で」＝同じPCが何度でも挑戦できる）。
  function handleOpenEndedTallyPickClick(charId, statKey) {
    var Core = window.PriTestNightCore;
    var state = Core.state;
    var spec = state.gmFlow.openEndedTallySpec;
    if (!spec) return;
    var c = Core.getRosterCharacters().filter(function (rc) {
      return rc.id === charId;
    })[0];
    if (!c) return;
    var type = c.typeId ? window.PriTestCharacterTypes.get(c.typeId) : null;
    var useStat = spec.statKey === "any" ? statKey : spec.statKey;
    var count = window.PriTestNightFloorBreakthrough.effectiveCheckValue(c, type, useStat);
    var dice = [];
    for (var i = 0; i < count; i++) dice.push(1 + Math.floor(Math.random() * 6));
    var sum = dice.reduce(function (a, b) {
      return a + b;
    }, 0);
    var passed = sum >= spec.target;
    state.turnMessages.push({
      text: window.I18N.t("gm_flow_player_pick_check_result_log", {
        name: c.name,
        dice: dice.join("+"),
        sum: sum,
        outcome: window.I18N.t(passed ? "ability_check_pass_label" : "ability_check_fail_label"),
      }),
      time: Date.now(),
      side: "gm",
    });
    if (passed) {
      spec.successCount += 1;
    } else {
      spec.failCount += 1;
      if (spec.failEscalationStep && spec.failCount % spec.failEscalationStep === 0) {
        spec.successThreshold += 1;
      }
    }
    if (spec.successCount >= spec.successThreshold) {
      var walk = state.gmFlow.walk;
      var floor = walk ? getWalkFloor(walk) : null;
      var lines = floor ? floor.lines || [] : [];
      var successLine = null;
      for (var li = 0; li < lines.length; li++) {
        if (lines[li].label && lines[li].label.ja === spec.successLineJaLabel) {
          successLine = lines[li];
          break;
        }
      }
      state.gmFlow.openEndedTallySpec = null;
      finishFieldWalk(successLine ? formatWalkLine(successLine) : "", floor);
      Core.saveState();
      Core.renderCurrentLocationStatus();
      return;
    }
    state.gmFlow.narrationText = window.I18N.t("gm_flow_open_ended_tally_progress", {
      success: spec.successCount,
      threshold: spec.successThreshold,
      fail: spec.failCount,
    });
    Core.saveState();
    Core.renderCurrentLocationStatus();
  }

  // ---- 「行為判定」（大野営地「火の戦車」専用：代表者1人を選び、代表者とそれ以外の
  // PC全員でそれぞれ異なる目標値の個別判定を行う）----
  // クリックされたPCを代表者として、代表者本人＋それ以外の入場PC全員をまとめて自動で
  // 擲骰する（GMが選ぶのは代表者のみ——他のPCは自動的に「それ以外」として全員判定する）。
  // 結果の分岐（成功／失敗）は代表者自身の判定結果で決まる。
  function handleRepresentativePickClick(charId) {
    var Core = window.PriTestNightCore;
    var state = Core.state;
    var spec = state.gmFlow.representativePickSpec;
    if (!spec) return;
    var entered = Core.getRosterCharacters().filter(function (c) {
      return c.entered;
    });
    var rep = entered.filter(function (c) {
      return c.id === charId;
    })[0];
    if (!rep) return;
    var others = entered.filter(function (c) {
      return c.id !== charId;
    });

    function rollOne(c, target, statKey) {
      var type = c.typeId ? window.PriTestCharacterTypes.get(c.typeId) : null;
      var count = window.PriTestNightFloorBreakthrough.effectiveCheckValue(c, type, statKey);
      var dice = [];
      for (var i = 0; i < count; i++) dice.push(1 + Math.floor(Math.random() * 6));
      var sum = dice.reduce(function (a, b) {
        return a + b;
      }, 0);
      return { dice: dice, sum: sum, passed: sum >= target };
    }

    var repResult = rollOne(rep, spec.repTarget, spec.repStat);
    var otherResults = others.map(function (c) {
      return { name: c.name, result: rollOne(c, spec.othersTarget, spec.othersStat) };
    });

    var entries = [
      window.I18N.t("gm_flow_representative_pick_result_entry", {
        name: rep.name,
        dice: repResult.dice.join("+"),
        sum: repResult.sum,
        outcome: window.I18N.t(repResult.passed ? "ability_check_pass_label" : "ability_check_fail_label"),
      }),
    ].concat(
      otherResults.map(function (o) {
        return window.I18N.t("gm_flow_representative_pick_result_entry", {
          name: o.name,
          dice: o.result.dice.join("+"),
          sum: o.result.sum,
          outcome: window.I18N.t(o.result.passed ? "ability_check_pass_label" : "ability_check_fail_label"),
        });
      })
    );
    state.turnMessages.push({
      text: window.I18N.t("gm_flow_representative_pick_summary_log", { results: entries.join("、") }),
      time: Date.now(),
      side: "gm",
    });
    var failedNames = otherResults
      .filter(function (o) {
        return !o.result.passed;
      })
      .map(function (o) {
        return o.name;
      });
    if (!repResult.passed) failedNames.unshift(rep.name);
    if (failedNames.length) {
      state.turnMessages.push({
        text: window.I18N.t("gm_flow_ability_check_fail_reminder_log", { names: failedNames.join("、") }),
        time: Date.now(),
        side: "gm",
      });
    }
    state.gmFlow.representativePickSpec = null;
    state.gmFlow.actionKind = "ok";
    var walk = state.gmFlow.walk;
    if (walk) walk.pendingOutcomeFilter = repResult.passed ? "成功" : "失敗";
    advanceFieldWalk();
  }

  // ---- 「行為判定」（特定の1名のPCだけが行う形式）：GMが「誰が行くか」を選ぶ ----
  // クリックされたPC1名だけを自動で擲骰する。retryOnFail:falseなら結果に関わらず即座に
  // 先へ進む（既にその1名が確定している場面向け）。retryOnFail:trueで失敗した場合は、
  // そのPCを候補から除外し、同じゲートを再表示して別の玩家を選び直せるようにする
  // （［離去］ボタンでいつでも打ち切れる）。
  function handlePlayerPickCheckClick(charId) {
    var Core = window.PriTestNightCore;
    var state = Core.state;
    var spec = state.gmFlow.playerPickCheckSpec;
    if (!spec) return;
    var c = Core.getRosterCharacters().filter(function (rc) {
      return rc.id === charId;
    })[0];
    if (!c) return;
    var type = c.typeId ? window.PriTestCharacterTypes.get(c.typeId) : null;
    var count = window.PriTestNightFloorBreakthrough.effectiveCheckValue(c, type, spec.statKey);
    var dice = [];
    for (var i = 0; i < count; i++) dice.push(1 + Math.floor(Math.random() * 6));
    var sum = dice.reduce(function (a, b) {
      return a + b;
    }, 0);
    var passed = sum >= spec.target;
    state.turnMessages.push({
      text: window.I18N.t("gm_flow_player_pick_check_result_log", {
        name: c.name,
        dice: dice.join("+"),
        sum: sum,
        outcome: window.I18N.t(passed ? "ability_check_pass_label" : "ability_check_fail_label"),
      }),
      time: Date.now(),
      side: "gm",
    });
    if (passed || !spec.retryOnFail) {
      state.gmFlow.playerPickCheckSpec = null;
      state.gmFlow.playerPickCheckExcluded = [];
      state.gmFlow.actionKind = "ok";
      var walk = state.gmFlow.walk;
      if (walk) {
        walk.pendingOutcomeFilter = passed ? "成功" : "失敗";
        if (spec.markerLabel) walk.pendingConvergeLabel = spec.markerLabel;
      }
      advanceFieldWalk();
      return;
    }
    // 失敗かつretryOnFail：このPCを除外して同じゲートを再表示する。
    var excluded = state.gmFlow.playerPickCheckExcluded || [];
    excluded.push(charId);
    state.gmFlow.playerPickCheckExcluded = excluded;
    Core.saveState();
    Core.renderCurrentLocationStatus();
  }

  // ［離去］：誰も（またはこれ以上）判定を試みない——規則書の「誰も判定を行わないなら」に
  // 相当する。失敗扱いとして先へ進む。
  function handlePlayerPickCheckLeaveClick() {
    var Core = window.PriTestNightCore;
    var state = Core.state;
    var spec = state.gmFlow.playerPickCheckSpec;
    if (!spec) return;
    state.turnMessages.push({
      text: window.I18N.t("gm_flow_player_pick_check_leave_log"),
      time: Date.now(),
      side: "gm",
    });
    state.gmFlow.playerPickCheckSpec = null;
    state.gmFlow.playerPickCheckExcluded = [];
    state.gmFlow.actionKind = "ok";
    var walk = state.gmFlow.walk;
    if (walk) {
      walk.pendingOutcomeFilter = "失敗";
      if (spec.markerLabel) walk.pendingConvergeLabel = spec.markerLabel;
    }
    advanceFieldWalk();
  }

  // ［湖沼(睡)専用の二択］：選ばれた選択肢の{target,perPC,statKey}をそのまま既存の協力式
  // 判定（cooperativeCheck）へ引き継ぐ——モーダルもロジックも完全に再利用する。
  function handleConditionalCooperativeChoiceClick(option) {
    var Core = window.PriTestNightCore;
    var state = Core.state;
    state.turnMessages.push({ text: window.I18N.t("gm_flow_choice_picked_log", { label: option.label }), time: Date.now(), side: "gm" });
    state.gmFlow.conditionalCooperativeChoiceSpec = null;
    state.gmFlow.cooperativeCheckSpec = { target: option.target, perPC: option.perPC, statKey: option.statKey, markerLabel: null };
    state.gmFlow.actionKind = "cooperativeCheck";
    Core.saveState();
    Core.renderCurrentLocationStatus();
  }

  // ---- 「行為判定」自動擲骰（坑道「白い結晶」専用モーダル）----
  // 分岐ポイント累積（外側、複数ラウンド）／連続2種判定（内側、複数ステップ）のどちらも、
  // 「各PCが個別に骰子を振る→自動GMが目標値と照合→次のラウンド/ステップへ、または最終
  // 結果を確定」という同じ形なので、1つのモーダル・stateを使い回す。既存のcooperativeCheck
  // 同様、目標値はここでも一切表示しない（ユーザー指示：判定門檻を終始見せない）。
  var branchTallyRolls = null; // { charId: { dice:[...], rerollPending } }（ラウンド/ステップごとに使い回す一時state）

  function beginBranchPointTally() {
    var state = window.PriTestNightCore.state;
    var spec = state.gmFlow.branchPointTallySpec;
    if (!spec) return;
    spec.round = 1;
    spec.points = 0;
    branchTallyRolls = {};
    renderBranchTallyModal();
    var modalEl = document.getElementById("branch-tally-modal");
    if (modalEl) modalEl.hidden = false;
  }

  function beginSequentialPairCheck() {
    var state = window.PriTestNightCore.state;
    var spec = state.gmFlow.sequentialPairSpec;
    if (!spec) return;
    spec.stepIndex = 0;
    spec.totalSuccess = 0;
    spec.totalAttempts = 0;
    branchTallyRolls = {};
    renderBranchTallyModal();
    var modalEl = document.getElementById("branch-tally-modal");
    if (modalEl) modalEl.hidden = false;
  }

  // 現在アクティブな段階（外側の分岐ポイントラウンド、または内側の連続判定ステップ）に
  // 対応する{statKey,target}を返す。どちらも保留中でなければnull。
  function activeBranchTallyStep() {
    var state = window.PriTestNightCore.state;
    var outer = state.gmFlow.branchPointTallySpec;
    if (outer) return { statKey: outer.statKey, target: outer.target };
    var inner = state.gmFlow.sequentialPairSpec;
    if (inner) return inner.checks[inner.stepIndex];
    return null;
  }

  function renderBranchTallyModal() {
    var Core = window.PriTestNightCore;
    var state = Core.state;
    var outer = state.gmFlow.branchPointTallySpec;
    var inner = state.gmFlow.sequentialPairSpec;
    var step = activeBranchTallyStep();
    var titleEl = document.getElementById("branch-tally-modal-title");
    var container = document.getElementById("branch-tally-characters");
    var confirmBtn = document.getElementById("btn-branch-tally-confirm");
    if (!step || !titleEl || !container || !confirmBtn) return;
    if (!branchTallyRolls) branchTallyRolls = {};
    if (outer) {
      titleEl.textContent = window.I18N.t("gm_flow_branch_tally_outer_title", {
        round: outer.round,
        total: outer.repeat,
        stat: window.I18N.t("check_stat_" + step.statKey),
      });
    } else {
      titleEl.textContent = window.I18N.t("gm_flow_branch_tally_inner_title", {
        step: inner.stepIndex + 1,
        total: inner.checks.length,
        stat: window.I18N.t("check_stat_" + step.statKey),
      });
    }
    container.innerHTML = "";
    var entered = Core.getRosterCharacters().filter(function (c) {
      return c.entered;
    });
    entered.forEach(function (c) {
      var row = document.createElement("div");
      row.className = "wb-row breakthrough-char-row";
      var name = document.createElement("span");
      name.className = "breakthrough-char-name";
      name.textContent = c.name;
      row.appendChild(name);

      var entry = branchTallyRolls[c.id];
      if (entry) {
        var diceLabel = document.createElement("span");
        diceLabel.textContent = entry.dice.join("+");
        row.appendChild(diceLabel);
        if (entry.rerollPending) {
          entry.dice.forEach(function (val, dieIdx) {
            var rerollBtn = document.createElement("button");
            rerollBtn.type = "button";
            rerollBtn.className = "combat-attack-hit-btn";
            rerollBtn.textContent = window.I18N.t("cooperative_check_reroll_die_button", { value: val });
            rerollBtn.addEventListener("click", function () {
              rerollBranchTallyDie(c.id, dieIdx);
            });
            row.appendChild(rerollBtn);
          });
        } else if (c.blessingSlots && c.blessingSlots.current > 0) {
          var blessingBtn = document.createElement("button");
          blessingBtn.type = "button";
          blessingBtn.className = "breakthrough-blessing-btn";
          blessingBtn.textContent = window.I18N.t("breakthrough_blessing_button", { current: c.blessingSlots.current });
          blessingBtn.addEventListener("click", function () {
            useBranchTallyBlessing(c.id);
          });
          row.appendChild(blessingBtn);
        }
      } else {
        var rollBtn = document.createElement("button");
        rollBtn.type = "button";
        rollBtn.className = "combat-attack-hit-btn";
        rollBtn.textContent = window.I18N.t("ability_check_roll_button");
        rollBtn.addEventListener("click", function () {
          rollBranchTallyForCharacter(c.id, step.statKey);
        });
        row.appendChild(rollBtn);
      }
      container.appendChild(row);
    });
    var allRolled = entered.every(function (c) {
      return !!branchTallyRolls[c.id];
    });
    var anyRerollPending = entered.some(function (c) {
      return branchTallyRolls[c.id] && branchTallyRolls[c.id].rerollPending;
    });
    confirmBtn.disabled = !allRolled || anyRerollPending;
  }

  function rollBranchTallyForCharacter(charId, statKey) {
    var Core = window.PriTestNightCore;
    if (!branchTallyRolls) return;
    var c = Core.getRosterCharacters().filter(function (rc) {
      return rc.id === charId;
    })[0];
    var type = c && c.typeId ? window.PriTestCharacterTypes.get(c.typeId) : null;
    var count = window.PriTestNightFloorBreakthrough.effectiveCheckValue(c, type, statKey);
    var dice = [];
    for (var i = 0; i < count; i++) dice.push(1 + Math.floor(Math.random() * 6));
    branchTallyRolls[charId] = { dice: dice, rerollPending: false };
    renderBranchTallyModal();
  }

  function useBranchTallyBlessing(charId) {
    var Core = window.PriTestNightCore;
    var c = Core.getRosterCharacters().filter(function (rc) {
      return rc.id === charId;
    })[0];
    if (!c || !c.blessingSlots || c.blessingSlots.current <= 0) return;
    var entry = branchTallyRolls && branchTallyRolls[charId];
    if (!entry || !entry.dice.length) return;
    if (!window.confirm(window.I18N.t("breakthrough_blessing_confirm", { name: c.name }))) return;
    c.blessingSlots.current -= 1;
    Core.saveRosterCharacters();
    entry.rerollPending = true;
    renderBranchTallyModal();
  }

  function rerollBranchTallyDie(charId, dieIndex) {
    var entry = branchTallyRolls && branchTallyRolls[charId];
    if (!entry || !entry.rerollPending) return;
    entry.dice[dieIndex] = 1 + Math.floor(Math.random() * 6);
    entry.rerollPending = false;
    renderBranchTallyModal();
  }

  // ［確認骰子］：現在のラウンド/ステップの各PCの合計をそれぞれ目標値と比較し（門檻は
  // 表示しない）、外側なら分岐ポイント（成功1回ごとに+2・失敗1回ごとに-1）へ、内側なら
  // 成功/試行数へ加算する。まだラウンド/ステップが残っていれば同じモーダルを次の分だけ
  // 振り直させ、最後まで終わったら最終結果を確定して閉じる。
  function handleBranchTallyConfirmClick() {
    var Core = window.PriTestNightCore;
    var state = Core.state;
    var step = activeBranchTallyStep();
    if (!step || !branchTallyRolls) return;
    var entered = Core.getRosterCharacters().filter(function (c) {
      return c.entered;
    });
    var successCount = 0;
    var failCount = 0;
    entered.forEach(function (c) {
      var entry = branchTallyRolls[c.id];
      if (!entry) return;
      var sum = entry.dice.reduce(function (a, b) {
        return a + b;
      }, 0);
      if (sum >= step.target) successCount++;
      else failCount++;
    });
    branchTallyRolls = null;
    var outer = state.gmFlow.branchPointTallySpec;
    var inner = state.gmFlow.sequentialPairSpec;
    if (outer) {
      outer.points += successCount * 2 - failCount;
      if (outer.round < outer.repeat) {
        outer.round += 1;
        branchTallyRolls = {};
        renderBranchTallyModal();
        Core.saveState();
        return;
      }
      // 規則書は「2以上→高い方」「0以下→低い方」のみを定め、ちょうど中間（この場合は
      // 1点）の扱いを明記していない——GM判断を仰いだ結果、この空隙は「高い方」側へ
      // 寄せる方針を確認済み（lowThresholdより大きければ常に高い方）。
      var highBranch = outer.points > outer.lowThreshold;
      state.turnMessages.push({
        text: window.I18N.t("gm_flow_branch_tally_outer_summary_log", {
          points: outer.points,
          branch: highBranch ? outer.highLabel : outer.lowLabel,
        }),
        time: Date.now(),
        side: "gm",
      });
      var outerModalEl = document.getElementById("branch-tally-modal");
      if (outerModalEl) outerModalEl.hidden = true;
      state.gmFlow.branchPointTallySpec = null;
      state.gmFlow.actionKind = "ok";
      handleLineChoiceClick(highBranch ? outer.highLabel : outer.lowLabel);
      return;
    }
    if (inner) {
      inner.totalSuccess += successCount;
      inner.totalAttempts += entered.length;
      if (inner.stepIndex < inner.checks.length - 1) {
        inner.stepIndex += 1;
        branchTallyRolls = {};
        renderBranchTallyModal();
        Core.saveState();
        return;
      }
      var tierLabel;
      if (!inner.totalAttempts || inner.totalSuccess === inner.totalAttempts) {
        tierLabel = "成功2回";
      } else if (inner.totalSuccess === 0) {
        tierLabel = "失敗2回";
      } else {
        tierLabel = "成功1回";
      }
      state.turnMessages.push({
        text: window.I18N.t("gm_flow_branch_tally_inner_summary_log", { tier: tierLabel }),
        time: Date.now(),
        side: "gm",
      });
      var innerModalEl = document.getElementById("branch-tally-modal");
      if (innerModalEl) innerModalEl.hidden = true;
      state.gmFlow.sequentialPairSpec = null;
      state.gmFlow.actionKind = "ok";
      var walk = state.gmFlow.walk;
      if (walk) {
        walk.pendingOutcomeFilter = tierLabel;
        if (inner.markerLabel) walk.pendingConvergeLabel = inner.markerLabel;
      }
      advanceFieldWalk();
    }
  }

  // night.js側のrenderCurrentLocationStatus()から、#location-status-content（樓層詳細資訊）を
  // 組み立てた直後に呼ばれる。進度版下段の「GM對話框」（#location-status-dialogue、分隔線で
  // 樓層詳細資訊と区切る）に、敘述文（あれば、#location-status-narration）と、
  // [進入]/[突破]、または[OK]/[進入下一晚][稍後]/[開啟夜王戰鬥]のいずれかのボタン
  // （#location-status-actions）を描画する。cardはnull（開場敘述中など）でもよい。
  function renderLocationBanner(idx, card) {
    var Core = window.PriTestNightCore;
    var state = Core.state;
    var dialogueEl = document.getElementById("location-status-dialogue");
    var narrationEl = document.getElementById("location-status-narration");
    var actionsEl = document.getElementById("location-status-actions");
    var waitingBadge = document.getElementById("gm-flow-waiting-badge");
    if (!dialogueEl || !narrationEl || !actionsEl) return;
    if (!state.gmFlowEnabled) {
      dialogueEl.classList.remove("has-dialogue");
      narrationEl.textContent = "";
      actionsEl.innerHTML = "";
      lastTypedNarration = null;
      if (waitingBadge) waitingBadge.hidden = true;
      return;
    }
    maybeAnnounceFinalDay(); // stateを直接書き換えるだけ（自身はrenderを呼ばない、再帰防止）
    dialogueEl.classList.add("has-dialogue");
    actionsEl.innerHTML = "";
    // [GM等待中]バッジ：折りたたみ時も見えるようにoverlay直下に置いているため、collapsedの
    // 状態に関わらずawaitingOk中は常に点滅させる（＝GMが進度版を開いて対応する必要がある合図）。
    if (waitingBadge) waitingBadge.hidden = !state.gmFlow.awaitingOk;

    if (state.gmFlow.awaitingOk) {
      renderNarrationInto(state.gmFlow.narrationText || "");
      if (state.gmFlow.actionKind === "nightAdvance") {
        addActionButton(actionsEl, "gm_flow_advance_night_button", handleAdvanceNightClick);
        addActionButton(actionsEl, "gm_flow_dismiss_button", handleDismissNarrationClick);
      } else if (state.gmFlow.actionKind === "finalDayBattle") {
        addActionButton(actionsEl, "gm_flow_open_final_battle_button", handleOpenFinalBattleClick);
      } else if (state.gmFlow.actionKind === "branchChoice") {
        // どの分岐がこのプレイに該当するかはアプリ側で判定できないため、規則書を見たGMに
        // 選んでもらう——分岐名そのものをボタンラベルにする（(→X)選択肢と同じUIパターン）。
        var walk = state.gmFlow.walk;
        var entry = walk ? getWalkEntry(walk) : null;
        (entry && entry.branches ? entry.branches : []).forEach(function (branch, bi) {
          var btn = document.createElement("button");
          btn.type = "button";
          btn.className = "gm-flow-action-btn";
          btn.textContent = window.PriTestFields.localizedText(branch.name);
          btn.addEventListener("click", function () {
            handleBranchChoiceClick(bi);
          });
          actionsEl.appendChild(btn);
        });
      } else if (state.gmFlow.actionKind === "lineChoice") {
        (state.gmFlow.pendingChoiceLabels || []).forEach(function (label) {
          var btn = document.createElement("button");
          btn.type = "button";
          btn.className = "gm-flow-action-btn";
          btn.textContent = label;
          btn.addEventListener("click", function () {
            handleLineChoiceClick(label);
          });
          actionsEl.appendChild(btn);
        });
      } else if (state.gmFlow.actionKind === "floorEnd") {
        // ［戰鬥結束］獎勵ゲート：領取後、全項目を受け取り終える（pendingRewardWindowsが
        // 空になる）まで［獲得完］を押しても再度リマインドされる（第18項）。
        addActionButton(actionsEl, "gm_flow_claim_reward_button", handleFloorEndRewardClick);
        addActionButton(actionsEl, "gm_flow_reward_done_button", handleGmFlowOk);
      } else if (state.gmFlow.actionKind === "combatTrigger") {
        // ［戰鬥機制］入口：ボタンラベルはトリガー行自身の文言（「雜兵戰鬥」／「王戰」）を
        // そのまま使う（第17・18項）。
        var combatBtn = document.createElement("button");
        combatBtn.type = "button";
        combatBtn.className = "gm-flow-action-btn";
        combatBtn.textContent = state.gmFlow.combatTriggerLabel || window.I18N.t("gm_flow_combat_trigger_button_fallback");
        combatBtn.addEventListener("click", handleCombatTriggerClick);
        actionsEl.appendChild(combatBtn);
      } else if (state.gmFlow.actionKind === "battleWait") {
        // ［戰鬥機制］：ボタンは出さない。エネミーの全HP行が0になった瞬間
        // （notifyCombatEnded、night.jsのsetActionPhase combatEndオプション経由）に
        // 自動で敘述の続き（［戰鬥結束］）へ進む。
      } else if (state.gmFlow.actionKind === "mapMove") {
        // 第4項：地圖移動ゲート。[OK]はhandleMapMoveOkClickへ——まだ移動していなければ
        // ゲートを閉じずリマインドを繰り返す。
        addActionButton(actionsEl, "gm_flow_ok_button", handleMapMoveOkClick);
      } else if (state.gmFlow.actionKind === "chipOffer") {
        // 第19項：籌碼事件の使用可否確認。
        addActionButton(actionsEl, "gm_flow_chip_offer_use_button", handleChipOfferUseClick);
        addActionButton(actionsEl, "gm_flow_chip_offer_skip_button", handleChipOfferSkipClick);
      } else if (state.gmFlow.actionKind === "abilityCheck") {
        // 行為判定（PC全員／それぞれ／各自が個別に判定する形式）：生の判定基準文は出さず、
        // ボタンを押すとモーダルで各PCの判定骰を自動で振る。
        addActionButton(actionsEl, "gm_flow_ability_check_button", function () {
          beginAbilityCheck();
        });
      } else if (state.gmFlow.actionKind === "cooperativeCheck") {
        // 行為判定（協力＝黨全員骰子加総の単純な1回勝負）：目標値は一切出さず、
        // ボタンを押すとモーダルで各PCの判定骰を自動で振る。確認後は自動GMが
        // 一致した側（成功／失敗）だけを続けて敘述する。
        addActionButton(actionsEl, "gm_flow_cooperative_check_button", function () {
          beginCooperativeCheck();
        });
      } else if (state.gmFlow.actionKind === "playerPickCheck") {
        // 行為判定（特定の1名のPCだけが行う形式）：GMに「誰が行くか」を選ばせる——
        // 既に失敗して除外された玩家は再表示しない。retryOnFail:trueの場合のみ［離去］を出す。
        var pickSpec = state.gmFlow.playerPickCheckSpec;
        var excludedIds = state.gmFlow.playerPickCheckExcluded || [];
        var pickCandidates = Core.getRosterCharacters().filter(function (c) {
          return c.entered && excludedIds.indexOf(c.id) === -1;
        });
        pickCandidates.forEach(function (c) {
          var btn = document.createElement("button");
          btn.type = "button";
          btn.className = "gm-flow-action-btn";
          btn.textContent = c.name;
          btn.addEventListener("click", function () {
            handlePlayerPickCheckClick(c.id);
          });
          actionsEl.appendChild(btn);
        });
        if (pickSpec && pickSpec.retryOnFail) {
          addActionButton(actionsEl, "gm_flow_player_pick_check_leave_button", handlePlayerPickCheckLeaveClick);
        }
      } else if (state.gmFlow.actionKind === "conditionalCooperativeChoice") {
        // 湖沼(睡)専用：祭壇に興味があるか先に選ばせる（選択肢文言はデータから切り出し済み）。
        var ccSpec = state.gmFlow.conditionalCooperativeChoiceSpec;
        (ccSpec ? ccSpec.options : []).forEach(function (opt) {
          var btn = document.createElement("button");
          btn.type = "button";
          btn.className = "gm-flow-action-btn";
          btn.textContent = opt.label;
          btn.addEventListener("click", function () {
            handleConditionalCooperativeChoiceClick(opt);
          });
          actionsEl.appendChild(btn);
        });
      } else if (state.gmFlow.actionKind === "sequentialCooperativeChain") {
        // 東の地下砦専用：連鎖の最初の段は［判定發生］、途中の段成功後は［繼續］で次の段へ。
        var chainSpec = state.gmFlow.sequentialChainSpec;
        var chainBtnKey = chainSpec && chainSpec.awaitingContinue ? "gm_flow_chain_continue_button" : "gm_flow_branch_tally_button";
        addActionButton(actionsEl, chainBtnKey, function () {
          beginSequentialChainStep();
        });
      } else if (state.gmFlow.actionKind === "openEndedTallyCheck") {
        // 水辺の大教会専用：任意のPCが任意回数（statKey==="any"なら屬性も選んで）挑戦できる
        // ピッカー——除外はしない（retryOnFailと違い、同じPCが何度でも再挑戦できる）。
        var oeSpec = state.gmFlow.openEndedTallySpec;
        var oeCandidates = Core.getRosterCharacters().filter(function (c) {
          return c.entered;
        });
        oeCandidates.forEach(function (c) {
          if (oeSpec && oeSpec.statKey === "any") {
            ["luck", "physical", "mental"].forEach(function (statKey) {
              var btn = document.createElement("button");
              btn.type = "button";
              btn.className = "gm-flow-action-btn";
              btn.textContent = c.name + "（" + window.I18N.t("check_stat_" + statKey) + "）";
              btn.addEventListener("click", function () {
                handleOpenEndedTallyPickClick(c.id, statKey);
              });
              actionsEl.appendChild(btn);
            });
          } else {
            var btn2 = document.createElement("button");
            btn2.type = "button";
            btn2.className = "gm-flow-action-btn";
            btn2.textContent = c.name;
            btn2.addEventListener("click", function () {
              handleOpenEndedTallyPickClick(c.id, oeSpec ? oeSpec.statKey : "luck");
            });
            actionsEl.appendChild(btn2);
          }
        });
      } else if (state.gmFlow.actionKind === "representativePickCheck") {
        // 大野営地「火の戦車」専用：代表者1人だけを選ばせる——それ以外の入場PC全員は
        // クリック時に自動で判定される。
        Core.getRosterCharacters()
          .filter(function (c) {
            return c.entered;
          })
          .forEach(function (c) {
            var btn = document.createElement("button");
            btn.type = "button";
            btn.className = "gm-flow-action-btn";
            btn.textContent = c.name;
            btn.addEventListener("click", function () {
              handleRepresentativePickClick(c.id);
            });
            actionsEl.appendChild(btn);
          });
      } else if (state.gmFlow.actionKind === "multiStatIndividualCheck") {
        // 砦「壺投げのトロル」専用：複数ラウンドはモーダル内で自動的に続く。
        addActionButton(actionsEl, "gm_flow_ability_check_button", function () {
          beginMultiStatCheck();
        });
      } else if (state.gmFlow.actionKind === "branchPointTally" || state.gmFlow.actionKind === "sequentialPairCheck") {
        // 坑道「白い結晶」専用：分岐ポイント累積／連続2種判定のどちらも同じ1つの
        // ［判定發生］ボタンで開始する（複数ラウンド/ステップはモーダル内で自動的に続く）。
        addActionButton(actionsEl, "gm_flow_branch_tally_button", function () {
          if (state.gmFlow.actionKind === "branchPointTally") beginBranchPointTally();
          else beginSequentialPairCheck();
        });
      } else if (state.gmFlow.actionKind === "freeFloorChoice") {
        // ［路線自由］：まだ踏破していない位置のボタンを1つずつ並べる（第Ｎ項：砦／地下砦等）。
        var freeFloorWalk = state.gmFlow.walk;
        var freeFloorEntry = freeFloorWalk ? getWalkEntry(freeFloorWalk) : null;
        var freeFloorBranch = freeFloorEntry && freeFloorEntry.branches ? freeFloorEntry.branches[freeFloorWalk.branchIndex] : null;
        var freeFloorPreviews = freeFloorBranch ? freeFloorBranch.floorPreviews || [] : [];
        (state.gmFlow.freeFloorOptions || []).forEach(function (position) {
          var preview = freeFloorPreviews[position - 1];
          var btn = document.createElement("button");
          btn.type = "button";
          btn.className = "gm-flow-action-btn";
          btn.textContent = preview
            ? window.PriTestFields.localizedText(preview.label) + window.I18N.t("colon_separator") + window.PriTestFields.localizedText(preview.title)
            : String(position);
          btn.addEventListener("click", function () {
            handleFreeFloorChoiceClick(position);
          });
          actionsEl.appendChild(btn);
        });
      } else {
        addActionButton(actionsEl, "gm_flow_ok_button", handleGmFlowOk);
      }
      return;
    }

    lastTypedNarration = null;
    stopTypewriter(narrationEl);
    if (!card) {
      narrationEl.textContent = "";
      dialogueEl.classList.remove("has-dialogue"); // 敘述もボタンも出せることが無ければ分隔線ごと隠す
      return;
    }
    // 第2項：進入/突破の選択肢を出す前に、その樓層の先頭〔描写〕を先に見せる
    // （規則書§2-3-1→§2-3-2の順序）。解決できない場合（路線自由カード・乱数が絡む
    // 分岐等）は従来通り空欄のまま。
    narrationEl.textContent = typeof idx === "number" ? floorLeadingDescriptionText(idx, card) : "";

    addActionButton(actionsEl, "gm_flow_enter_button", handleEnterClick);
    addActionButton(actionsEl, "gm_flow_breakthrough_button", handleBreakthroughClick);
  }

  function addActionButton(actionsEl, labelKey, onClick) {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "gm-flow-action-btn";
    btn.textContent = window.I18N.t(labelKey);
    btn.addEventListener("click", onClick);
    actionsEl.appendChild(btn);
    return btn;
  }

  window.PriTestNightGmFlow = {
    typewriteInto: typewriteInto,
    renderLocationBanner: renderLocationBanner,
    maybeShowOpeningNarration: maybeShowOpeningNarration,
    maybeAnnounceFinalDay: maybeAnnounceFinalDay,
    showFullClearNarration: showFullClearNarration,
    handleGoldenTreeFullClear: handleGoldenTreeFullClear,
    notifyCombatEnded: notifyCombatEnded,
    handleAbilityCheckDoneClick: handleAbilityCheckDoneClick,
    handleCooperativeCheckConfirmClick: handleCooperativeCheckConfirmClick,
    handleBranchTallyConfirmClick: handleBranchTallyConfirmClick,
    parseIndividualAbilityCheck: parseIndividualAbilityCheck,
    parseCooperativeAbilityCheck: parseCooperativeAbilityCheck,
    parseSinglePlayerCheck: parseSinglePlayerCheck,
    parseBranchPointTallyCheck: parseBranchPointTallyCheck,
    parseSequentialPairCheck: parseSequentialPairCheck,
    parseConditionalCooperativeChoice: parseConditionalCooperativeChoice,
    parseSequentialCooperativeChain: parseSequentialCooperativeChain,
    parseSequentialCoopTallyCheck: parseSequentialCoopTallyCheck,
    parseOpenEndedTallyCheck: parseOpenEndedTallyCheck,
    parseRepresentativePickCheck: parseRepresentativePickCheck,
    parseMultiStatIndividualCheck: parseMultiStatIndividualCheck,
    resolveAndAddCombatEnemies: resolveAndAddCombatEnemies,
    extractLevelAndNameTokens: extractLevelAndNameTokens,
    fieldLevelCorrectionForSlot: fieldLevelCorrectionForSlot,
    mergeParams: mergeParams,
    rollStrongEnemyTable: rollStrongEnemyTable,
    resolveStrongEnemyEntry: resolveStrongEnemyEntry,
    resolveFloorSkip: resolveFloorSkip,
  };
})();
