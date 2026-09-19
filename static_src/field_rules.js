(function () {
  // 場地卡の「追加ルール」（specialRule）：fields_data_*.js の各 branch.specialRule に
  // 規則原文が入っている。ここでは**規則原文を再録しない**（CLAUDE.md §12）。置くのは
  //   ① どの追加ルールが存在するか（id ↔ 名稱 ↔ 原文中の検出キーワード）
  //   ② 各ルールをアプリ側で自動適用するために必要な数値・判定パラメータだけ
  // の2つ。文言は常に specialRule 側が正で、こちらはその索引と機械可読な要約にすぎない。
  //
  // 規則書が「■」「□」で伏せている数値は、■/□ の個数がそのまま「格」数
  //（既存前例：midnight.js lowHpThreshold の「規則書の□□□＝3」）。
  // 使用者明確規格（2026-09-18）「一格子＝night 1格＝midnight 10HP」に従い、
  // HP の増減量だけ {night, midnight} で分ける。蓄積値や判定目標値は刻度が無いので共通。
  //
  // detect：branch.specialRule の日本語原文に含まれていれば、そのルールが有効とみなす
  // キーワード。原文の見出し（「追加ルール：溶岩」等）から採っているので、①②の採番や
  //「」の有無に左右されないよう、見出し語そのものだけを使う。
  function C(ja, zh) {
    return { ja: ja, zh: zh };
  }

  function lang() {
    return window.I18N ? window.I18N.getLang() : "zh";
  }

  function T(field) {
    if (!field) return "";
    if (typeof field === "string") return field;
    return field[lang()] || field.zh || field.ja || "";
  }

  // kind の意味（同じ kind は同じ注入点を共有する＝1ルール1実装にしない）：
  //   ailmentAccum   ... そのフィールドにいる間、指定の状態異常が溜まり続ける系
  //   floorDamage    ... フロア踏破ごとに無条件でHP損害
  //   checkDamage    ... フロア描写の確認直後に行為判定、失敗でHP損害
  //   maxHp          ... そのフィールドにいる間の最大HP増減
  //   accumPlus      ... 蓄積量そのものへの一律加算
  //   visionRestrict ... 戦闘時の行動制限
  //   freeRoute      ... フロアを任意順で攻略できる（既存の branch.freeFloorOrder で実装済み）
  //   checkTimeLoss  ... 行為判定の結果で「タイムロス」を蓄積
  var RULES = [
    // ---- 状態異常が溜まり続ける系（フロア描写の確認直後に行為判定して蓄積）----
    // 共通構造：非戦闘時にも蓄積／戦闘終了後も残る／別フィールドへ移動するか、
    // 戦闘中と同じ条件でその異常の効果が発揮されるとクリア。
    {
      id: "blood_wind",
      name: C("血病の風", "血病之風"),
      src: "fields_data_2.js:1895",
      detect: "血病の風",
      kind: "ailmentAccum",
      ailment: "出血",
      check: { target: 11, stat: "運試し" },
      onSuccess: 1,
      onFailure: 3,
    },
    {
      id: "sleep_hill",
      name: C("眠りの丘", "沉眠之丘"),
      src: "fields_data_2.js:2072",
      detect: "眠りの丘",
      kind: "ailmentAccum",
      ailment: "睡眠",
      check: { target: 10, stat: "運試し" },
      onSuccess: 1,
      onFailure: 3,
    },
    {
      id: "poison_swamp",
      name: C("毒沼", "毒沼"),
      src: "fields_data_3.js:462",
      detect: "毒沼",
      kind: "ailmentAccum",
      ailment: "猛毒",
      check: { target: 10, stat: "運試し" },
      onSuccess: 1,
      onFailure: 3,
    },
    {
      id: "rot_swamp",
      name: C("腐敗沼", "腐敗沼"),
      src: "fields_data_3.js:627",
      detect: "腐敗沼",
      kind: "ailmentAccum",
      ailment: "腐敗",
      check: { target: 10, stat: "運試し" },
      onSuccess: 1,
      onFailure: 3,
    },
    {
      id: "frozen_swamp",
      name: C("凍える沼", "凍結沼澤"),
      src: "fields_data_3.js:807",
      detect: "凍える沼",
      kind: "ailmentAccum",
      ailment: "凍傷",
      check: { target: 10, stat: "フィジカル" },
      onSuccess: 1,
      onFailure: 3,
    },
    {
      id: "sleep_lake",
      name: C("睡眠の湖沼", "睡眠的湖沼"),
      src: "fields_data_3.js:957",
      detect: "睡眠の湖沼",
      kind: "ailmentAccum",
      ailment: "睡眠",
      check: { target: 10, stat: "運試し" },
      onSuccess: 1,
      onFailure: 3,
    },
    {
      id: "madness_swamp",
      name: C("発狂沼", "發狂沼"),
      src: "fields_data_3.js:1116",
      detect: "発狂沼",
      kind: "ailmentAccum",
      ailment: "発狂",
      check: { target: 10, stat: "メンタル" },
      onSuccess: 1,
      onFailure: 3,
    },
    {
      id: "bleed_lake",
      name: C("出血の湖沼", "出血的湖沼"),
      src: "fields_data_3.js:1270",
      detect: "出血の湖沼",
      kind: "ailmentAccum",
      ailment: "出血",
      check: { target: 10, stat: "フィジカル" },
      onSuccess: 1,
      onFailure: 3,
    },
    {
      // こちらは行為判定ではなく「フロア踏破するごとに 腐敗：1D-1（最低値0）」。
      // 解除条件も他と違い「移動先に同じルールが無ければ解除」。
      id: "crimson_rot_miasma",
      name: C("朱い腐敗の瘴気", "朱紅腐敗的瘴氣"),
      src: "fields_data_4.js:1956/2337/2533",
      detect: "朱い腐敗の瘴気",
      kind: "ailmentAccum",
      ailment: "腐敗",
      check: null,
      onFloorCleared: { dice: 1, modifier: -1, min: 0 },
      clearsOnLeaveUnlessSameRule: true,
    },
    {
      // 蓄積の契機は規則原文に無く「非戦闘時にも蓄積し、戦闘終了後も残る」だけ。
      // 蓄積速度の数値が規則書に書かれていないため、量の自動付与は行わない
      //（CLAUDE.md §19：値を自分で発明しない）。「戦闘終了でクリアしない」側だけを扱う。
      id: "freezing_blizzard",
      name: C("凍てつく吹雪", "凍寒的暴風雪"),
      src: "fields_data_4.js:2795/2940/3087",
      detect: "凍てつく吹雪",
      kind: "ailmentAccum",
      ailment: "凍傷",
      check: null,
      persistsAfterCombat: true,
      clearsOnLeaveUnlessSameRule: true,
    },

    // ---- HP損害系 ----
    {
      // 「フロア踏破するごとに、PC全員は無条件で『HP損害：■』」＝■1個＝1格。
      id: "lava",
      name: C("溶岩", "熔岩"),
      src: "fields_data_4.js:3234/3324/3432",
      detect: "溶岩",
      kind: "floorDamage",
      hpDamage: { night: 1, midnight: 10 },
    },
    {
      // 「各フロアの〔描写〕を確認し終えると同時に〈11｜運試し〉、失敗したら『HP損害：■』」。
      id: "ballista",
      name: C("バリスタ射撃", "弩砲射擊"),
      src: "fields_data_3.js:1448",
      detect: "バリスタ射撃",
      kind: "checkDamage",
      check: { target: 11, stat: "運試し" },
      hpDamageOnFailure: { night: 1, midnight: 10 },
    },

    // ---- 最大HP ----
    {
      // 「このフィールドに存在する限り、PCは『最大HP：-3』となり、現在HPもそれにならう
      //（適用時、最大HPや現在HPの下限は1）。フィールドから出たとき、最大値は戻るが
      // 現在値は戻らない。『共鳴する結晶：+1』ごとに、この最大HP減衰は1緩和される。
      //『大空洞の恩寵』を獲得しているとき、この追加ルールは無効になる。」
      id: "crystal_curse",
      name: C("結晶の呪気", "結晶的呪氣"),
      src: "fields_data_3.js:2552／fields_data_4.js:716/1122",
      detect: "結晶の呪気",
      kind: "maxHp",
      maxHpDelta: -3, // 格数（midnight側は既存の ×10 が自動で効く）
      minStat: 1,
      easedPerCounter: 1, // 「共鳴する結晶：+1」ごとに1緩和
      counterId: "resonant_crystal",
      negatedByGraceId: "great_cavern",
    },

    // ---- 蓄積量への一律加算 ----
    {
      // ※1：PC・エネミーから発生する属性/状態異常が蓄積するとき、通常より1多く蓄積する
      //（1Hitでも2Hitでも +1）。
      // ※2：フロア描写の直後、アクションフェイズ開始時に「HP回復：□（渦巻く）」または
      //「HP損害：■（逆巻く）」。どちらが発揮されるかは最初に決定し、以後シナリオ終了まで不変。
      id: "growing_presence",
      name: C("増大する気配", "增大的氣息"),
      src: "fields_data_3.js:2552",
      detect: "増大する気配",
      kind: "accumPlus",
      accumBonus: 1,
      // 「増大する気配決定表」（fields_data_3.js:2337-2351）。ダイス2個で、片方の奇偶と
      // もう片方の出目の組み合わせから1つだけ決まり、以後シナリオ終了まで変わらない。
      // 表の文言そのものは fields_data 側が持つ（ここで再録しない）。持つのはアプリが
      // 効果を適用するために要る値だけ：
      //   note ※1 … accumLabel の属性/状態異常の蓄積が常に+1（1Hitでも2Hitでも+1）
      //   note ※2 … フロア描写の直後、アクションフェイズ開始時にHP回復／HP損害
      // accumLabel は表では「毒」と書かれているが、アプリ内の正式ラベルは「猛毒」。
      decisionTable: [
        { id: "flame", parity: "odd", faces: [1], note: "※1", accumLabel: "炎" },
        { id: "holy", parity: "odd", faces: [2], note: "※1", accumLabel: "聖" },
        { id: "magic", parity: "odd", faces: [3], note: "※1", accumLabel: "魔" },
        { id: "lightning", parity: "odd", faces: [4], note: "※1", accumLabel: "雷" },
        { id: "poison", parity: "odd", faces: [5], note: "※1", accumLabel: "猛毒" },
        { id: "rot", parity: "odd", faces: [6], note: "※1", accumLabel: "腐敗" },
        { id: "frostbite", parity: "even", faces: [1], note: "※1", accumLabel: "凍傷" },
        { id: "bleed", parity: "even", faces: [2], note: "※1", accumLabel: "出血" },
        { id: "heal_swirl", parity: "even", faces: [3, 4], note: "※2", hpHeal: { night: 1, midnight: 10 } },
        { id: "heal_surge", parity: "even", faces: [5, 6], note: "※2", hpDamage: { night: 1, midnight: 10 } },
      ],
    },

    // ---- 戦闘時の行動制限 ----
    {
      // 「戦闘時、『後衛』に存在するキャラクターは狙いを定められないので、エネミーを
      // 対象とする『アタック』と『スキル（戦技／魔術／祈祷）の使用』を行えない。」
      // 恩寵「山嶺の恩寵」が無効化する（graces.js mountain_peak.blizzardVisionImmune）。
      id: "blizzard_vision",
      name: C("吹雪の視界", "暴風雪的視野"),
      src: "fields_data_4.js:2795",
      detect: "吹雪の視界",
      kind: "visionRestrict",
      backRowCannotAttack: true,
      backRowCannotUseSkill: true,
      negatedByGraceId: "mountain_peak",
    },

    // ---- フロアの攻略順（既存実装あり）----
    {
      // 「フロア1〜N を任意の順番で攻略可能。フロア踏破をM個以上成功したら全フロア踏破効果」。
      // これは既に branch.freeFloorOrder（clearThreshold）として機械可読になっており、
      // night_gm_flow.js の beginFreeFloorChoice()／markFreeFloorCleared() が実装済み。
      // ここには索引としてだけ載せる（二重実装しない）。
      id: "free_route",
      name: C("ルートの自由", "路線自由"),
      src: "fields_data_1.js:1598／fields_data_4.js:231/716/1122",
      detect: "ルートの自由",
      kind: "freeRoute",
      implementedBy: "branch.freeFloorOrder + night_gm_flow.js",
    },

    // ---- 行為判定→タイムロス ----
    {
      // 「GMが新たなフロアの〔描写〕を読み上げるたびに、PC全員で〈11｜運試し〉
      //〈11｜フィジカル〉〈11｜メンタル〉を行う。最低1種、1人が2〜3種行ってもよい。
      // 誰も実行していない種は自動的に失敗。
      // PC1〜2人：1種でも成功すればペナルティなし、すべて失敗ならタイムロス蓄積。
      // PC3〜4人：合計『PC人数-1』種以上成功でペナルティなし、そうでなければタイムロス蓄積。」
      id: "lost_hidden_city",
      name: C("迷いの隠れ都", "迷途的隱藏都市"),
      src: "fields_data_4.js:3949",
      detect: "迷いの隠れ都",
      kind: "checkTimeLoss",
      checks: [
        { target: 11, stat: "運試し" },
        { target: 11, stat: "フィジカル" },
        { target: 11, stat: "メンタル" },
      ],
      // 成功数がこの閾値「未満」ならタイムロス。PC人数をキーに引く。
      requiredSuccesses: { 1: 1, 2: 1, 3: 2, 4: 3 },
      timeLossOnFailure: 1,
    },
  ];

  var BY_ID = {};
  RULES.forEach(function (r) {
    BY_ID[r.id] = r;
  });

  function list() {
    return RULES.slice();
  }

  function get(id) {
    return BY_ID[id] || null;
  }

  // branch.specialRule（C(ja, zh) 形式でも素の文字列でも可）から、有効な追加ルールの
  // id 配列を返す。判定は日本語原文に対して行う——zh 訳は表記ゆれがあるため。
  function detect(specialRule) {
    var ja = "";
    if (!specialRule) return [];
    if (typeof specialRule === "string") ja = specialRule;
    else ja = specialRule.ja || specialRule.zh || "";
    if (!ja) return [];
    var ids = [];
    RULES.forEach(function (r) {
      if (ja.indexOf(r.detect) !== -1) ids.push(r.id);
    });
    return ids;
  }

  function has(specialRule, id) {
    return detect(specialRule).indexOf(id) !== -1;
  }

  // 依モード取値：{night, midnight} の欄位はモードで引き分け、それ以外はそのまま返す。
  // graces.js の value() とまったく同じ約束にしてある。
  function value(id, key, mode) {
    var r = BY_ID[id];
    if (!r) return null;
    var v = r[key];
    if (v && typeof v === "object" && !(v instanceof Array) && ("night" in v || "midnight" in v)) {
      return v[mode === "midnight" ? "midnight" : "night"];
    }
    return v === undefined ? null : v;
  }

  // 「増大する気配決定表」の1行を id で引く（決まった1つだけが有効）。
  function variant(ruleId, variantId) {
    var r = BY_ID[ruleId];
    if (!r || !r.decisionTable || !variantId) return null;
    for (var i = 0; i < r.decisionTable.length; i++) {
      if (r.decisionTable[i].id === variantId) return r.decisionTable[i];
    }
    return null;
  }

  // モード別の数値をvariantから引く（value()のvariant版）。
  function variantValue(ruleId, variantId, key, mode) {
    var v = variant(ruleId, variantId);
    if (!v) return null;
    var x = v[key];
    if (x && typeof x === "object" && !(x instanceof Array) && ("night" in x || "midnight" in x)) {
      return x[mode === "midnight" ? "midnight" : "night"];
    }
    return x === undefined ? null : x;
  }

  window.PriTestFieldRules = {
    list: list,
    get: get,
    variant: variant,
    variantValue: variantValue,
    detect: detect,
    has: has,
    value: value,
    localizedText: T,
  };
})();
