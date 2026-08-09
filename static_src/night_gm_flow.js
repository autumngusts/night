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
  // （docs/scenario_flow_rules.md §4「描写・行為判定・分岐の表記ルール」）に準拠：
  // 深さが増える「→→」等は、その先の選択肢/分岐の後に処理する内容という位置づけなので、
  // このアプリでは「選択肢を提示→GMがクリック→続きの行を敘述」という順送りで表現する。
  var CHOICE_MARKER_RE = /\(→([^)]+)\)/g;
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

  // ---- 「雜兵戰鬥」構造の検出（第17項） ----
  // fields_data_*.js内の該当行は必ず L(depth, null, ["ザコ戦闘（撃破ルーン：N）", "雜兵戰鬥（擊破盧恩：N）"])
  // の形（labelなし、本文がこの文言そのもの）で出現する。1件だけ半角スペース入りの表記ゆれ
  // （"ザコ戦闘 (撃破ルーン：1)"）があるため、開き括弧の直前は全角/半角どちらでも一致するようにする。
  function isZakoBattleTriggerLine(line) {
    if (line.label) return false;
    var ja = (line.text && line.text.ja) || "";
    var zh = (line.text && line.text.zh) || "";
    return /^ザコ戦闘\s*[（(]/.test(ja) || /^雜兵戰鬥（/.test(zh);
  }

  // トリガー行の直後から、このザコ戦闘で登場する敵を名指ししているbullet行（「XXX（頁）／Lv.N」の
  // ように"「"で始まる、トリガー行より深いdepthのbullet行）を、そうでない行（＝撃破後の結果文言、
  // または次のイベント行）に当たるまで収集する。nextIndexが収集後の再開位置（walk.lineIndexへ書き戻す）。
  function collectZakoEnemyLines(lines, triggerIndex) {
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
  function parseZakoEnemyRef(line) {
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
  function resolveZakoEnemyMatch(nameToken) {
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
      state.gmFlow.walk = { slotIndex: idx, branchIndex: resolved.branchIndex, floorIndex: currentFloorIndexForSlot(idx), lineIndex: 0 };
      advanceFieldWalk();
      return;
    }
    // 自動解決できなかった場合のみ（varianceTable未整備・シナリオ不明・データ不一致など）、
    // GMに規則書を見て選んでもらうフォールバックへ進む。
    state.gmFlow.walk = { slotIndex: idx, branchIndex: null, floorIndex: currentFloorIndexForSlot(idx), lineIndex: 0 };
    state.gmFlow.narrationText = window.I18N.t("gm_flow_pick_branch_narration", {
      name: window.PriTestFields.localizedText(entry.name),
    });
    state.gmFlow.awaitingOk = true;
    state.gmFlow.actionKind = "branchChoice";
    Core.saveState();
    Core.renderCurrentLocationStatus();
  }

  function handleBranchChoiceClick(branchIndex) {
    var state = window.PriTestNightCore.state;
    var walk = state.gmFlow.walk;
    if (!walk) return;
    walk.branchIndex = branchIndex;
    walk.floorIndex = currentFloorIndexForSlot(walk.slotIndex);
    walk.lineIndex = 0;
    advanceFieldWalk();
  }

  // 現在のwalk位置から、次の(→X)選択肢が現れるまで（または樓層の本文が尽きるまで）行を
  // 連結して1ブロックとして敘述する。選択肢が見つかればそこで停止してボタンを提示し、
  // 見つからなければ樓層本文の終わりとして[OK]（または獎勵があれば領取ボタン）に戻す。
  // 注意：複数の分岐選択肢がある行に遭遇しても、どの選択肢が実際にどの後続行に対応するかは
  // データ上グループ化されていない（規則書原文がそもそもそういう構造）ため、選択後もそのまま
  // 樓層本文の続きを順番に敘述する——選ばなかった側の説明文が混ざって出ることがあり得るが、
  // 数値やルールを捏造するわけではなく規則書本文そのものなので、GMが読んで取捨選択すればよい
  // という前提（docs/enemy_damage_rules.md系のGMディスクレション哲学に合わせる）。
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
    var choiceLabels = [];
    var zakoTriggerIndex = -1;
    var i = walk.lineIndex;
    for (; i < lines.length; i++) {
      var line = lines[i];
      // 「突破判定」欄は、玩家が突破判定を選んだ場合にのみ参照する非公開情報——
      // GM敘述には出さない（[突破]ボタンの対話框側で別途処理する）。
      if (line.label && (line.label.ja === "突破判定" || line.label.zh === "突破判定")) continue;
      // 「雜兵戰鬥」構造：ここで一旦停止し、敵の正体はボタンを押すまで敘述しない（第17項）。
      if (isZakoBattleTriggerLine(line)) {
        zakoTriggerIndex = i;
        break;
      }
      var lineText = Fields.localizedText(line.text);
      var prefix = line.label ? Fields.localizedText(line.label) + window.I18N.t("colon_separator") : "";
      var indent = line.depth ? new Array(line.depth + 1).join("　") : "";
      blockParts.push(indent + prefix + lineText);
      var labels = parseChoiceLabels(lineText);
      if (labels.length) {
        choiceLabels = labels;
        i++; // 次回はこの行の次から再開
        break;
      }
    }
    walk.lineIndex = i;
    var blockText = blockParts.join("\n");
    if (zakoTriggerIndex !== -1) {
      state.gmFlow.narrationText = blockText;
      state.gmFlow.pendingChoiceLabels = [];
      state.gmFlow.awaitingOk = true;
      state.gmFlow.actionKind = "zakoBattle";
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

  function handleLineChoiceClick(label) {
    var Core = window.PriTestNightCore;
    var state = Core.state;
    Core.state.turnMessages.push({ text: window.I18N.t("gm_flow_choice_picked_log", { label: label }), time: Date.now(), side: "gm" });
    state.gmFlow.pendingChoiceLabels = [];
    advanceFieldWalk();
  }

  // ---- 「雜兵戰鬥」ボタン：敵を敘述し、判明した分だけ戦場に自動追加する（第17項） ----
  function handleZakoBattleClick() {
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
    var collected = collectZakoEnemyLines(lines, triggerIndex);
    var narrationParts = [Fields.localizedText(triggerLine.text)];
    var addedNames = [];
    var addedKeys = {};
    var reminderTexts = [];
    collected.enemyLines.forEach(function (line) {
      narrationParts.push(Fields.localizedText(line.text));
      var ref = parseZakoEnemyRef(line);
      var matchedAny = false;
      // nameTokensにはja/zh両方の表記が別トークンとして入る（同一エネミーを指すことが多い）ため、
      // familyId|enemyIdで重複追加・重複ログを防ぐ（addEnemyToBattle自体は既に選択済みキーに
      // 対して何もしないが、addedNamesへの二重表示はここで防ぐ必要がある）。
      ref.nameTokens.forEach(function (token) {
        var match = resolveZakoEnemyMatch(token);
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
        reminderTexts.push(window.I18N.t("gm_flow_zako_battle_manual_add_reminder", { text: Fields.localizedText(line.text) }));
      } else if (ref.needsLevelCorrection) {
        reminderTexts.push(window.I18N.t("gm_flow_zako_battle_level_correction_reminder", { text: Fields.localizedText(line.text) }));
      }
    });
    if (addedNames.length) {
      state.turnMessages.push({
        text: window.I18N.t("gm_flow_zako_battle_added_log", { names: addedNames.join("、") }),
        time: Date.now(),
        side: "gm",
      });
    }
    reminderTexts.forEach(function (text) {
      state.turnMessages.push({ text: text, time: Date.now(), side: "gm" });
    });

    walk.lineIndex = collected.nextIndex;
    state.gmFlow.narrationText = narrationParts.join("\n");
    if (typeof walk.slotIndex === "number") {
      // このカードの樓層数値（state.cardLevels[slotIndex]）が変化した瞬間、
      // notifyCardLevelChanged経由で自動的に敘述の続きへ進める——GMは進度版を操作しなくてよい。
      state.gmFlow.battleWaitActive = true;
      state.gmFlow.battleWaitCardLevel = Core.state.cardLevels ? Core.state.cardLevels[walk.slotIndex] : null;
      state.gmFlow.awaitingOk = true;
      state.gmFlow.actionKind = "battleWait";
    } else {
      // 起點／終點の板塊にはcardLevelsが無く自動検知できないため、[OK]による手動続行に留める。
      state.gmFlow.battleWaitActive = false;
      state.gmFlow.battleWaitCardLevel = null;
      state.gmFlow.awaitingOk = true;
      state.gmFlow.actionKind = "ok";
    }
    Core.saveState();
    Core.renderCurrentLocationStatus();
  }

  // stepCardLevel（night.js、盤面の樓層数値＋/-ボタン）から、値が変化するたびに呼ばれる。
  // battleWaitActive中で、かつ変化したのがこのwalkの対象カードであれば、規則書敘述の続きへ進める。
  function notifyCardLevelChanged(index) {
    var Core = window.PriTestNightCore;
    var state = Core.state;
    var walk = state.gmFlow.walk;
    if (!state.gmFlow.battleWaitActive || !walk || walk.slotIndex !== index) return;
    if (state.cardLevels[index] === state.gmFlow.battleWaitCardLevel) return; // 変化なし（値の再確定など）
    state.gmFlow.battleWaitActive = false;
    state.gmFlow.battleWaitCardLevel = null;
    // このGMの手動＋クリックが、既にこの樓層の「踏破」を意味する数値変化として使われた——
    // finishFieldWalkの第5項改（樓層本文終了時の自動＋1）と二重に加算されるのを防ぐ
    // （二重加算されると、複数フロア持ちのカードでフロアを1つ丸ごと読み飛ばしてしまう）。
    walk.battleWaitAdvancedCardLevel = true;
    advanceFieldWalk();
  }

  // 樓層本文が尽きた（または分岐データが解決できなかった）ときの締めくくり。
  // floorにreward（fields.jsの構造化獎勵データ）があれば[領取獎勵]ボタンも合わせて出す。
  function finishFieldWalk(blockText, floor) {
    var Core = window.PriTestNightCore;
    var state = Core.state;
    var FloorBreakthrough = window.PriTestNightFloorBreakthrough;
    var walkSlotIndex = state.gmFlow.walk ? state.gmFlow.walk.slotIndex : null;
    // notifyCardLevelChanged参照：雜兵戰鬥の戦闘待ち中にGMが盤面の＋をクリックして
    // 既にこの樓層分のカウンターを進めている場合、下の自動＋1をスキップする。
    var alreadyAdvancedByBattleWait = !!(state.gmFlow.walk && state.gmFlow.walk.battleWaitAdvancedCardLevel);
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
    // 全樓層踏破に達した場合はstepCardLevel内部でgrantCardFullClearRewardIfNeededが発火し、
    // そちらのGM敘述（全踏破／黄金樹の帳）が今設定した敘述を上書きする（意図的：より重要な
    // 報告を優先する）。起點/終點の板塊にはcardLevelsが無いためfloorのみ・数値indexのみ対象。
    if (floor && typeof walkSlotIndex === "number" && !alreadyAdvancedByBattleWait) {
      Core.stepCardLevel(walkSlotIndex, 1);
    }
  }

  // finishFieldWalkが検出したfloor.reward情報は、モーダルを開くのに実物のfloorオブジェクトの
  // 参照が要る（openFloorRewardModalはfloor自体を引数に取る）ため、stateに直列化保存せず
  // モジュール内変数として持つ（devicecrossの同期は不要——[領取獎勵]は押した端末で
  // 既存の獎勵モーダルを開くだけの操作で、既存の獎勵システム自体は元々cross-device同期済み）。
  var pendingFloorEndFloor = null;

  function handleFloorEndRewardClick() {
    if (pendingFloorEndFloor) window.PriTestNightFloorBreakthrough.openFloorRewardModal(pendingFloorEndFloor);
    clearGmFlowGate();
    window.PriTestNightCore.saveState();
    window.PriTestNightCore.renderCurrentLocationStatus();
  }

  // 第15項：全樓層踏破時、grantCardFullClearRewardIfNeeded（night.js）から呼ばれる。
  // 効果自体はすでに自動付与済み——ここは「何が起きたか」をGM敘述として見せて[OK]待ちにするだけ。
  function showFullClearNarration(cardName, effectText) {
    var Core = window.PriTestNightCore;
    var state = Core.state;
    state.gmFlow.narrationText = window.I18N.t("gm_flow_full_clear_narration", { name: cardName, effect: effectText });
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
  // [OK]を押しても進めさせず、残数を再度リマインドする。
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
    clearGmFlowGate();
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
    state.gmFlow.battleWaitCardLevel = null;
    pendingFloorEndFloor = null;
    lastTypedNarration = null;
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

  // [進入下一晚]：既存の主要ボタン（#btn-primary-action、シナリオ有無で
  // openKeepCardsDrawer/openSelectDrawerのどちらかに繋がる）をそのままクリックする——
  // ロジックを複製せず、既存の正しい分岐に完全に委ねる。
  function handleAdvanceNightClick() {
    clearGmFlowGate();
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
        addActionButton(actionsEl, "gm_flow_claim_reward_button", handleFloorEndRewardClick);
        addActionButton(actionsEl, "gm_flow_ok_button", handleGmFlowOk);
      } else if (state.gmFlow.actionKind === "zakoBattle") {
        addActionButton(actionsEl, "gm_flow_zako_battle_button", handleZakoBattleClick);
      } else if (state.gmFlow.actionKind === "battleWait") {
        // 戦闘解決待ち：ボタンは出さない。GMは戦場ドロワー側で戦闘を進め、盤面の樓層数値が
        // 変化した瞬間（notifyCardLevelChanged）に自動で敘述の続きへ進む。
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
    notifyCardLevelChanged: notifyCardLevelChanged,
  };
})();
