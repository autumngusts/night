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
