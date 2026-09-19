(function () {
  // 恩寵（規則書142頁）：事件／戰鬥結果讓PC永久獲得的個人特典。
  //
  // 規則原文的單一資料來源是 event_rulebook.js（各事件的 body 文字）與
  // fields_data_*.js，這裡**不重抄規則原文**（CLAUDE.md §12），只定義：
  //   ① 有哪些恩寵（id ↔ 名稱），讓 night.js／midnight.js 能用同一組 id 互通。
  //   ② 每個恩寵在程式中實際要用到的數值，並依遊戲模式分開。
  //
  // night（回合制）與 midnight（即時制）的HP刻度是 1:10——這是既有換算，不是這裡
  // 新發明的：midnight.js selfArenaHpMax() 為「100 + hp.max×10」，lowHpThreshold 的
  // 註解也明寫「規則書的□□□＝3是回合制HP刻度，midnight的競技場HP是它的10倍」。
  // 因此規則原文中以回合制刻度書寫的數值，midnight 欄位一律是它的10倍。
  //
  // id 沿用 midnight 已經上線的那一組（v0.9.0/v0.10.0，2026-09-14），因為
  // character/{tokenId}/graces 底下已經有用這些 id 寫入的存檔資料，改名會孤立它們。
  // legacyField 是更早期散落在角色物件上的舊旗標名，只在讀取時相容，不再寫入。
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

  var GRACES = [
    {
      // event_rulebook.js:578-579「夜の恩寵」：アーツの使用回数が「祝福での休息」で
      // 回復するようになる。アーツ（type.arts）本文原本寫的是「使用次數：○（於當日
      // 結束時回復）」，所以平常祝福休息不會回復它——這個恩寵才讓它回復。
      id: "night_grace",
      name: C("夜の恩寵", "夜之恩寵"),
      src: "event_rulebook.js:579 夜の勢力",
      legacyField: "_nightBlessing",
    },
    {
      // event_rulebook.js:668-669「知の集約」：戦闘終了時にPC代表1人が1Dを振り、
      // 「出目：⚀」ならPCはそれぞれ「ルーン：1」を追加で獲得する。
      // 使用者明確規格（2026-09-15）把判定出目改為「6」，兩種模式共用。
      id: "knowledge",
      name: C("知の集約", "知識的集約"),
      src: "event_rulebook.js:668 虫の大量発生",
      legacyField: "_insectKnowledgeBlessing",
      successFaces: [6],
      runeReward: 1,
    },
    {
      // event_rulebook.js:817-818「夜に刻まれし癒えぬ傷」：個人PC限定の恩寵。
      // ダメージによってHP損害を受けるとき、その損害が「+■」される。
      // 「■」規則書沒有給值（CLAUDE.md §19不得自行發明），改依使用者明確規格
      // （2026-09-15）「受到傷害時，額外扣HP10」＝midnight刻度10，換算回合制為1。
      id: "unhealing_wound",
      name: C("夜に刻まれし癒えぬ傷", "夜間刻下的不癒之傷"),
      src: "event_rulebook.js:817 襲撃・忌み鬼（PC死亡分支）",
      extraHpDamage: { night: 1, midnight: 10 },
    },
    {
      // event_rulebook.js:826-827「祝福王の恩寵」：獲得時に威力補正1種を選び
      // 「+(aの2倍)」する。「a」＝このシナリオ内で「祝福での休息」に利用した祝福の数。
      // night 依規則書原文（每次祝福休息 ×2）；midnight 依使用者明確規格
      // （2026-09-15）「每使用過不同地點的祝福，則威力補正+1，最多+10」。
      id: "blessing_king",
      name: C("祝福王の恩寵", "篝火王的恩寵"),
      src: "event_rulebook.js:826 襲撃・忌み鬼",
      powerModPerBlessing: { night: 2, midnight: 1 },
      powerModMax: { night: null, midnight: 10 },
      // 獲得時要玩家自選1種威力補正，記在角色的這個欄位（值是 character_drawer.js
      // POWER_MOD_STAT_MAP 的 statKey；名稱文字也跟該表一致，不另外發明譯名）。
      choiceField: "graceFlameKingPowerModChoice",
      powerModOptions: [
        { statKey: "strength", name: C("筋力", "力量") },
        { statKey: "dex", name: C("技量", "技巧") },
        { statKey: "balance", name: C("バランス", "平衡") },
        { statKey: "intelligence", name: C("知力", "智力") },
        { statKey: "faith", name: C("信仰", "信仰") },
        { statKey: "arcane", name: C("神秘", "神秘") },
      ],
    },
    {
      // event_rulebook.js:1091-1092「獣の狩り」：アクション／エクストラフェイズ開始時に
      // 獲得したすべてのスタミナダイスの「□」を自動的に「⚀」に変更する（隊列決定前）。
      // 使用者明確規格（2026-09-15）以實際點數表示＝「點數2自動變為點數5」。
      // midnight は骰子池を持たないので、使用者明確規格（2026-09-14）の
      // 「體力20%以下時+3/秒、持續5秒、冷卻60秒」で読み替える。その即時制側の数値は
      // midnight.js の GRACE_BEAST_HUNT_* 定数が持つ（ここには骰子側だけ置く）。
      id: "beast_hunt",
      name: C("獣の狩り", "獸之狩獵"),
      src: "event_rulebook.js:1091 三つ首の獣",
      diceFaceFrom: 2,
      diceFaceTo: 5,
    },
    {
      // event_rulebook.js:1178-1179「冷たい蜃気楼」：個人PC限定の恩寵。自身が
      // 「現在HP：0」になりそうなHP損害・属性損害・状態異常を適用された場合、
      // 「現在HP：0」にならず「現在HP：□（1点）」になり、代わりにこの恩寵を失う。
      // midnight 依使用者明確規格（2026-09-15）「為所剩10點hp」＝同 1:10 換算。
      id: "cold_mirage",
      name: C("冷たい蜃気楼", "冰冷的海市蜃樓"),
      src: "event_rulebook.js:1178 霧の裂け目",
      survivalHp: { night: 1, midnight: 10 },
      consumedOnTrigger: true,
    },
    {
      // event_rulebook.js:1227-1228「世界を安寧する力」：PCが瀕死状態になったとき1Dし、
      // 出目⚀⚁ならディフェンスフェイズ終了時に【復帰ダメージ120】を割り振られたものとして
      // 復帰する。さらに「瀕死になったPCが他のPCからの復帰ダメージで復帰した場合」、
      // その復帰したPCは戦闘終了まで、アタック由来ダメージを「1Hit：+5／2Hit：+10」、
      // 装備品スキル由来ダメージを「+5」する。
      id: "world_peace",
      name: C("世界を安寧する力", "使世界安寧之力"),
      src: "event_rulebook.js:1227 安寧者たち",
      selfRevivalFaces: [1, 2],
      selfRevivalDamage: 120,
      revivedHit1Bonus: 5,
      revivedHit2Bonus: 10,
      revivedSkillBonus: 5,
    },
    // ------------------------------------------------------------------
    // ここから下は場地卡（fields_data_*.js）由来の恩寵。
    // 随機事件由来のものと同じく本文に「恩寵については142頁」と明記されている。
    // 規則書が値を「□」で伏せている箇所は、□ の個数がそのまま「格」数
    //（既存前例：midnight.js lowHpThreshold の「規則書の□□□＝3」）。
    // 使用者明確規格（2026-09-18）「一格子＝night 1格＝midnight 10HP」。
    // 最大HP/最大FPの加算は「格」単位のまま持つ——midnight 側は
    // selfArenaHpMax()／selfFpMax() が (hp.max + totalFlatMaxStatBonus) * 10 と
    // すでに10倍しているため、ここで10倍すると二重になる。
    // 一方ダメージ量そのものは刻度が違うので {night, midnight} で分ける。
    // ------------------------------------------------------------------
    {
      // fields_data_4.js:2288 / 2503 / 2771（3つの場地に登場）「腐れ森の恩寵」：
      // シナリオ終了まで「最大HP：+□□」＝+2格、さらに「耐性：腐敗」
      //（「状態異常：腐敗」が蓄積せず、これによってHP損害を受けない）。
      id: "rotten_forest",
      name: C("腐れ森の恩寵", "潰爛森林的恩寵"),
      src: "fields_data_4.js:2288/2503/2771 腐れ森",
      maxHpBonus: 2,
      rotImmune: true,
      // 獲得手順（fields_data_4.js:2268/2492/2760「腐れ森の恩寵を求めて」）：
      //「PCの代表ひとりが1Dする。出目が『5以上』だった場合は『腐れ森の恩寵』を得る。
      //  出目が『4以下』だった場合、このフロアには『腐れ森の恩寵』はなく、
      //  このフィールド以外で『腐れ森の恩寵を求めて』が発生したとき、そのときの1Dの
      //  出目を『+2』する。この効果は累積する。」
      // ——失敗した「フィールド」ごとに+2が積まれ、別のフィールドで振るときだけ乗る。
      acquisition: { dice: 1, target: 5, bonusPerFailedFieldElsewhere: 2 },
    },
    {
      // fields_data_4.js:2895「山嶺の恩寵」：シナリオ終了まで「凍傷」の蓄積最大値を「+4」、
      //「凍傷」発生時のHP損害を「□」＝1格軽減、戦闘中なら凍傷発症直後のアクションフェイズの
      // スタミナダイスに骰子を追加（使用者明確規格 2026-09-18「骰子點數3」）、
      // さらにこのフィールドの追加ルール「吹雪の視界」を無効化する。
      id: "mountain_peak",
      name: C("山嶺の恩寵", "山嶺的恩寵"),
      src: "fields_data_4.js:2895 氷雪の山嶺",
      frostbiteAccumMaxBonus: 4,
      frostbiteDamageReduce: { night: 1, midnight: 10 },
      staminaDiceFace: 3,
      blizzardVisionImmune: true,
    },
    {
      // fields_data_4.js:3613「大空洞の恩寵」：追加ルール「結晶の呪気」を無効化。
      // 聖杯瓶の使用回数の残量が0になった場合、即座に「アーツの使用回数」が1回分回復する。
      //（この恩寵だけは規則書に□が無く、最初から値が完全に書かれている）
      id: "great_cavern",
      name: C("大空洞の恩寵", "大空洞的恩寵"),
      src: "fields_data_4.js:3613 大空洞",
      crystalCurseImmune: true,
      artsRecoverOnFlaskEmpty: 1,
    },
    {
      // fields_data_4.js:3804「隠れ都の恩寵」：「さまよう祝福」の上限を+1。さらにシナリオ
      // 終了まで「PCが戦闘中に死亡し、蘇生した場合、その戦闘終了時まで最大HP：+□／
      // 最大FP：+□（各1格）。スキル、アーツの使用回数がすべて回復する」効果を得る。
      id: "hidden_city",
      name: C("隠れ都の恩寵", "隱藏都市的恩寵"),
      src: "fields_data_4.js:3804 隠れ都ノクラテオ",
      wanderingBlessingMaxBonus: 1,
      revivedMaxHpBonus: 1,
      revivedMaxFpBonus: 1,
      revivedRestoreAllUses: true,
    },
    {
      // fields_data_3.js:2618-2628「大ルーンの虚像」：「アーツ」を「最大使用回数：+1」する。
      // ただし「葬儀屋」ではないPCは、それぞれ自身のアーツを1ターンの間に1回しか使用できない。
      //（この恩寵も規則書に□が無い）
      id: "great_rune_mirage",
      name: C("大ルーンの虚像", "大盧恩的虛像"),
      src: "fields_data_3.js:2619 大ルーンの虚像",
      artsMaxUsesBonus: 1,
      nonUndertakerOncePerTurn: true,
    },
    {
      // event_rulebook.js:857-858「融合する命」：聖杯瓶でHPが回復するPCは、同じだけFPも
      // 回復する。（midnight.js commitFlaskHeal() 已實作，2026-09-15改走統一的恩寵欄位。）
      id: "fused_life",
      name: C("融合する命", "融合之命"),
      src: "event_rulebook.js:857 襲撃・兆し",
      legacyField: "_fusedLife",
    },
  ];

  var BY_ID = {};
  GRACES.forEach(function (g) {
    BY_ID[g.id] = g;
  });

  function list() {
    return GRACES.slice();
  }

  function get(id) {
    return BY_ID[id] || null;
  }

  // 角色持有的恩寵記在 c.graces，形狀是**物件map**（{id: true}）而不是陣列。
  // 這是為了讓付與可以用 rtSet(character/<tokenId>/graces/<id>, true) 單獨寫入——
  // 天生冪等，多台裝置同時付與不同恩寵也不會互相覆蓋（陣列整包寫就會）。
  function has(c, id) {
    if (!c) return false;
    if (c.graces && c.graces[id]) return true;
    var def = BY_ID[id];
    return !!(def && def.legacyField && c[def.legacyField]);
  }

  function grant(c, id) {
    if (!c || !BY_ID[id]) return false;
    if (!c.graces) c.graces = {};
    if (c.graces[id]) return false;
    c.graces[id] = true;
    return true;
  }

  // 舊旗標も一緒に落とす。片方だけ消すと has() が相容判定で true を返し続けるため。
  function revoke(c, id) {
    if (!c) return false;
    var changed = false;
    if (c.graces && c.graces[id]) {
      delete c.graces[id];
      changed = true;
    }
    var def = BY_ID[id];
    if (def && def.legacyField && c[def.legacyField]) {
      c[def.legacyField] = false;
      changed = true;
    }
    return changed;
  }

  // 依模式取數值：欄位若是 {night, midnight} 就取對應模式，否則直接回傳（兩模式共用）。
  function value(id, key, mode) {
    var g = BY_ID[id];
    if (!g) return null;
    var v = g[key];
    if (v && typeof v === "object" && !(v instanceof Array) && ("night" in v || "midnight" in v)) {
      return v[mode === "midnight" ? "midnight" : "night"];
    }
    return v === undefined ? null : v;
  }

  window.PriTestGraces = {
    list: list,
    get: get,
    has: has,
    grant: grant,
    revoke: revoke,
    value: value,
    localizedText: T,
  };
})();
