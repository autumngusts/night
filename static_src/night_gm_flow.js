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

  // 敵名bullet行から、対戦相手候補の名前トークン（複数名が「＆」等で連記されている場合は分割）と
  // Lv数値、および「L補」（未実装のレベル補正、docs/scenario_flow_rules.md参照）の有無を取り出す。
  // 数値を捏造しない方針に合わせ、Lv.の後ろの「+L補」分はここでは加算しない——GM側の確認に委ねる。
  function parseCombatEnemyRef(line) {
    var ja = (line.text && line.text.ja) || "";
    var zh = (line.text && line.text.zh) || "";
    var jaInner = (/「([^」]+)」/.exec(ja) || [])[1] || "";
    var zhInner = (/「([^」]+)」/.exec(zh) || [])[1] || "";
    var lvMatch = /Lv\.?\s*(\d+)/i.exec(jaInner) || /Lv\.?\s*(\d+)/i.exec(zhInner);
    var needsLevelCorrection = /L補/.test(jaInner) || /L補/.test(zhInner);
    var nameTokens = [];
    [jaInner, zhInner].forEach(function (inner) {
      var namePart = inner.split(/[（(]/)[0];
      namePart.split(/[＆&、，,]/).forEach(function (part) {
        var t = part.trim();
        if (t && nameTokens.indexOf(t) === -1) nameTokens.push(t);
      });
    });
    return { nameTokens: nameTokens, level: lvMatch ? parseInt(lvMatch[1], 10) : null, needsLevelCorrection: needsLevelCorrection };
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

  // カードの現在樓層（state.cardLevels、板塊のみ）に対応するfloorIndexを求める。
  // 起點/終點の板塊にはcardLevelsが無いため常にfloor 0から始める。
  function currentFloorIndexForSlot(idx) {
    var levelVal = typeof idx === "number" ? window.PriTestNightCore.state.cardLevels[idx] : null;
    return typeof levelVal === "number" ? levelVal : 0;
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

  // "2-7, 10" / "2-7、10" / "1" / "8, 9" のような表記を数値の配列に展開する。
  function parseScenarioNumberRanges(text) {
    var nums = [];
    String(text || "")
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

  // varianceTableの「内容」列を解析する。"1-3 X／4-6 Y" のようにダイス目レンジ＋名前が
  // 「／」区切りで複数あれば{min,max,name}の配列を返す（骰子を振って決める）。単一の内容
  // （レンジ表記が無い）ならnullを返し、呼び出し側はテキストそのものを分岐名として扱う。
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
      var m = /^(\d+)(?:-(\d+))?\s*(.+)$/.exec(segments[i]);
      if (!m) return null; // レンジ表記になっていない区切りが混ざっていたら安全側でnull
      parsed.push({ min: parseInt(m[1], 10), max: m[2] ? parseInt(m[2], 10) : parseInt(m[1], 10), name: m[3].trim() });
    }
    return parsed;
  }

  // entryのvarianceTableとシナリオ番号から、実際に該当する分岐indexを自動で解決する。
  // 骰子が必要な内容（複数レンジ）は、その場でこのアプリが1D6を振って決める——GMが把握して
  // いない/記録されていない過去の骰目を「捏造」するのではなく、今その場で正規の骰子を振る
  // という点で、既存の突破判定等の自動ダイス処理と同じ立ち位置。解決できなければnullを返し、
  // 呼び出し側はGMに規則書を見て選んでもらうフォールバックへ進む。
  function autoResolveBranch(entry) {
    if (!entry.branches || !entry.branches.length) return null;
    if (entry.branches.length === 1) return { branchIndex: 0, roll: null };
    if (!entry.varianceTable || !entry.varianceTable.rows) return null;
    var scenarioNum = resolveScenarioNumber();
    if (scenarioNum === null) return null;
    var matchRow = null;
    for (var i = 0; i < entry.varianceTable.rows.length; i++) {
      var row = entry.varianceTable.rows[i];
      if (parseScenarioNumberRanges(row[0] && row[0].ja).indexOf(scenarioNum) !== -1) {
        matchRow = row;
        break;
      }
    }
    if (!matchRow) return null;
    var contentText = matchRow[2] ? matchRow[2].ja : "";
    var diceOptions = parseVarianceContent(contentText);
    var targetName = contentText.trim();
    var roll = null;
    if (diceOptions) {
      roll = Math.floor(Math.random() * 6) + 1;
      var picked = diceOptions.filter(function (o) {
        return roll >= o.min && roll <= o.max;
      })[0];
      if (!picked) return null;
      targetName = picked.name;
    }
    for (var bi = 0; bi < entry.branches.length; bi++) {
      if (entry.branches[bi].name && entry.branches[bi].name.ja === targetName) {
        return { branchIndex: bi, roll: roll };
      }
    }
    return null; // 解決した名前がbranches[]のどれとも一致しない＝データの想定外、GMへ委ねる
  }

  function handleEnterClick() {
    var Core = window.PriTestNightCore;
    var state = Core.state;
    var idx = state.focusedIndex;
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
    // 第19項：この地點に未使用の籌碼事件があれば、樓層本文の敘述を始める前に先に使用可否を尋ねる。
    if (offerEventChipIfPending(idx, "startWalk")) return;
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
    var resolved = autoResolveBranch(entry);
    if (resolved) {
      if (resolved.roll !== null) {
        state.turnMessages.push({
          text: window.I18N.t("gm_flow_branch_roll_log", {
            roll: resolved.roll,
            name: window.PriTestFields.localizedText(entry.branches[resolved.branchIndex].name),
          }),
          time: Date.now(),
          side: "gm",
        });
      }
      state.gmFlow.walk = {
        slotIndex: idx,
        branchIndex: resolved.branchIndex,
        floorIndex: currentFloorIndexForSlot(idx),
        lineIndex: 0,
        branchFloor: null,
        branchFloorArmed: false,
        pendingPrefixText: null,
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
      window.I18N.t("gm_flow_chip_offer_narration", { chip: window.I18N.t("event_chip_" + chipId) }) +
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
    var i = walk.lineIndex;
    while (i < lines.length) {
      var line = lines[i];
      // walk.branchFloorArmed：ジャンプ直後の見出し行自身は必ず境界判定を素通りさせる
      // （見出し行そのものの深さはbranchFloorと同じなので、境界判定を即有効にすると
      // ジャンプ先の内容を一切敘述せずスキップしてしまう）。この行を処理し終えた直後に
      // trueへ切り替え、以後（次の行から）は本来の「兄弟/より浅い行で打ち切る」判定を行う。
      if (walk.branchFloor != null && walk.branchFloorArmed && line.depth <= walk.branchFloor) {
        i = skipConstructSiblings(lines, i, walk.branchFloor);
        walk.branchFloor = null;
        walk.branchFloorArmed = false;
        continue;
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
      var lineText = Fields.localizedText(line.text);
      blockParts.push(formatWalkLine(line));
      var labels = parseChoiceLabels(lineText);
      if (labels.length) {
        choiceLabels = labels;
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
    var Enemies = window.PriTestEnemies;
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
    var addedKeys = {};
    var reminderTexts = [];
    collected.enemyLines.forEach(function (line) {
      narrationParts.push(Fields.localizedText(line.text));
      var ref = parseCombatEnemyRef(line);
      var matchedAny = false;
      // nameTokensにはja/zh両方の表記が別トークンとして入る（同一エネミーを指すことが多い）ため、
      // familyId|enemyIdで重複追加・重複ログを防ぐ（addEnemyToBattle自体は既に選択済みキーに
      // 対して何もしないが、addedNamesへの二重表示はここで防ぐ必要がある）。
      ref.nameTokens.forEach(function (token) {
        var match = resolveCombatEnemyMatch(token);
        if (match) {
          matchedAny = true;
          var key = match.familyId + "|" + match.enemy.id;
          if (!addedKeys[key]) {
            addedKeys[key] = true;
            Core.addEnemyToBattle(match, ref.level || 1);
            addedNames.push(Enemies.localizedText(match.enemy.name));
          }
        }
      });
      if (!matchedAny) {
        reminderTexts.push(window.I18N.t("gm_flow_combat_manual_add_reminder", { text: Fields.localizedText(line.text) }));
      } else if (ref.needsLevelCorrection) {
        reminderTexts.push(window.I18N.t("gm_flow_combat_level_correction_reminder", { text: Fields.localizedText(line.text) }));
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
    // 第5項改：この樓層の敘述が最後まで終わったら、GMが手動で盤面の[+]を押さなくても
    // 自動で樓層カウンターを1つ進め、公開盤地図上のカードの数字が自動的に「踏破済み」を
    // 反映するようにする——以後は自動化GMもそのカードの数字を見るだけで現在位置が分かる。
    if (floor && typeof walkSlotIndex === "number") {
      Core.stepCardLevel(walkSlotIndex, 1);
      // 第18・19項「結束該卡牌的最後一個樓層後...則再處理［全踏破］處理...再次詢問是否使用
      // 籌碼事件...接著處理［地圖移動機制］」：たった今の＋1でカードの実在する樓層をすべて
      // 踏破済み（cardLevels===floorCount、まだ「全」ではない）になった場合、この樓層の
      // 獎勵ゲート（floorEnd）をGMが領取し終えるまで待ってから（＝
      // closeGmFlowGateAndConsumePendingAdvance／advanceCardConclusionChain側で）
      // 「全」踏破処理→籌碼確認→地圖移動、の順で自動的に連鎖させる。ここで即座に進めると、
      // まだ見せていないこの樓層の獎勵ゲートを跨ぎ越してしまうため、領取完了（[獲得完]）の
      // タイミングまで意図的に遅延させる。
      if (walkEntry && typeof walkEntry.floorCount === "number" && Core.state.cardLevels[walkSlotIndex] === walkEntry.floorCount) {
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
  // 実際の移動操作自体は既存の盤面長押し移動UIに委ねる、単純な[OK]ゲート。
  function showMapMoveNarration() {
    var Core = window.PriTestNightCore;
    var state = Core.state;
    state.gmFlow.narrationText = window.I18N.t("gm_flow_map_move_prompt");
    state.gmFlow.awaitingOk = true;
    state.gmFlow.actionKind = "ok";
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
    state.gmFlow.chipOfferSlot = null;
    state.gmFlow.chipOfferContinuation = null;
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
        Core.stepCardLevel(finalFloorSlot, 1); // → 「全」。内部でgrantCardFullClearRewardIfNeededが発火し、続く敘述ゲートを新たに開く
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
      } else if (state.gmFlow.actionKind === "chipOffer") {
        // 第19項：籌碼事件の使用可否確認。
        addActionButton(actionsEl, "gm_flow_chip_offer_use_button", handleChipOfferUseClick);
        addActionButton(actionsEl, "gm_flow_chip_offer_skip_button", handleChipOfferSkipClick);
      } else {
        addActionButton(actionsEl, "gm_flow_ok_button", handleGmFlowOk);
      }
      return;
    }

    lastTypedNarration = null;
    narrationEl.textContent = "";
    stopTypewriter(narrationEl);
    if (!card) {
      dialogueEl.classList.remove("has-dialogue"); // 敘述もボタンも出せることが無ければ分隔線ごと隠す
      return;
    }

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
  };
})();
