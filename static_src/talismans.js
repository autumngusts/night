(function () {
  // タリスマン（装飾品）データベース。武器と異なり単体でPassive効果を1つ持つだけの単純な構造。
  // 写真の情報密度が高く、確認できた名称・効果を中心とした部分収録（200〜202頁）。
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

  var UNCONFIRMED = C("未確認（原文が判読できず要確認）", "未確認（原文判讀不易，待確認）");

  var TALISMANS = [
    {
      id: "talisman_sturdy_horn_charm",
      name: C("頑健の角飾り", "頑健的角飾"),
      body: C(
        "自身はエネミーからの状態異常「出血／凍傷」の蓄積値を無効にする。",
        "自身無效化來自敵人的異常狀態「出血／凍傷」蓄積值。"
      ),
    },
    {
      id: "talisman_immune_horn_charm",
      name: C("免疫の角飾り", "免疫的角飾"),
      body: C(
        "自身はエネミーからの状態異常「猛毒／腐敗」の蓄積値を無効にする。",
        "自身無效化來自敵人的異常狀態「猛毒／腐敗」蓄積值。"
      ),
    },
    {
      id: "talisman_sane_horn_charm",
      name: C("正気の角飾り", "正氣的角飾"),
      body: C(
        "自身はエネミーからの状態異常「発狂／睡眠」の蓄積値を無効にする。",
        "自身無效化來自敵人的異常狀態「發狂／睡眠」蓄積值。"
      ),
    },
    {
      id: "talisman_dappled_horn_charm",
      name: C("斑色の角飾り", "斑色的角飾"),
      body: C(
        "自身がエネミーから状態異常の蓄積値を受けるとき、その蓄積値を「-1」する。",
        "自身受到來自敵人的異常狀態蓄積值時、將其「-1」。"
      ),
    },
    {
      id: "talisman_prince_of_death_pouch",
      name: C("死王子の懐", "死亡王子的懷袋"),
      body: C("自身はエネミーからの状態異常「呪死」の蓄積値を無効にする。", "自身無效化來自敵人的異常狀態「咒死」蓄積值。"),
    },
    {
      id: "talisman_dragoncrest_thunder",
      name: C("雷竜印の紋章", "雷龍紋章"),
      body: C("自身はエネミーからの属性「雷」の蓄積値を無効にする。", "自身無效化來自敵人的屬性「雷」蓄積值。"),
    },
    {
      id: "talisman_dragoncrest_flame",
      name: C("炎竜印の紋章", "炎龍紋章"),
      body: C("自身はエネミーからの属性「炎」の蓄積値を無効にする。", "自身無效化來自敵人的屬性「炎」蓄積值。"),
    },
    {
      id: "talisman_dragoncrest_magic",
      name: C("魔力竜印の紋章", "魔力龍紋章"),
      body: C("自身はエネミーからの属性「魔」の蓄積値を無効にする。", "自身無效化來自敵人的屬性「魔」蓄積值。"),
    },
    {
      id: "talisman_dragoncrest_holy",
      name: C("聖竜印の紋章", "聖龍紋章"),
      body: C("自身はエネミーからの属性「聖」の蓄積値を無効にする。", "自身無效化來自敵人的屬性「聖」蓄積值。"),
    },
    {
      id: "talisman_dragoncrest_pearl",
      name: C("真珠竜印の紋章", "珍珠龍紋章"),
      body: C(
        "自身がエネミーから属性の蓄積値を受けるとき、その蓄積値を「-1」する。",
        "自身受到來自敵人的屬性蓄積值時、將其「-1」。"
      ),
    },
    {
      id: "talisman_dragon_shield_crest",
      name: C("竜印の盾のタリスマン", "龍印盾紋章"),
      body: C(
        "自身に「HP価値：＋10」する。ただし複数回ガードする場合は最初の1回のみ適用（最大100）。",
        "自身「HP價值：+10」、但複數回防禦時 只計入第一次 且最大１００。"
      ),
    },
    {
      id: "talisman_millicents_gauntlet",
      name: C("ミリセントの装手", "米莉森的護手"),
      body: C("自身の威力補正「技量：+5、バランス：+5」。", "自身的威力補正「技量：+5，平衡：+5」。"),
    },
    {
      id: "talisman_twin_blade",
      name: C("両刃の徽章", "雙刃徽章"),
      body: C("自身の威力補正「技量：+5」。", "自身的威力補正「技量：+5」。"),
    },
    {
      id: "talisman_winged_sword",
      name: C("有翼剣の徽章", "有翼劍徽章"),
      body: C(
        "自身が装備状態の近接武器に「2Hit特典：総合ダメージ及び復帰ダメージ+5」を追加する。",
        "自身裝備狀態的近戰武器追加「2Hit特典:總和傷害與復歸傷害+5」。"
      ),
    },
    {
      id: "talisman_god_skin_swaddle",
      name: C("神肌のおくるみ", "神肌的襁褓"),
      body: C(
        "自身が同一ターン内に2Hitを2回行ったとき、自身に「HP回復：□」する。",
        "自身同一回合執行2回2Hit時,自身「HP回復:□」。"
      ),
    },
    {
      id: "talisman_curved_sword",
      name: C("曲剣のタリスマン", "彎劍護符"),
      body: C(
        "自身が遺物効果「ガードカウンター」を使用する際、ダメージを「＋15」する。",
        "自身遺物效果「防禦反擊」使用時 傷害＋１５。"
      ),
    },
    {
      id: "talisman_greathammer",
      name: C("大槌のタリスマン", "大槌護符"),
      body: C(
        "自身が装備状態の近接武器に「2Hit特典：総合ダメージ+▲」を追加する。",
        "自身裝備狀態的近戰武器追加「2Hit特典:總和傷害 +▲」。"
      ),
    },
    {
      id: "talisman_scorpion_magic",
      name: C("魔力の蠍", "魔力之蠍"),
      body: C(
        "自身がエネミーに属性「魔」の蓄積値を与えるとき、その蓄積値を「+1」する。（Hit数を問わない）",
        "自身給予敵人「魔」屬性蓄積值時，該蓄積值+1。(不問Hit數)"
      ),
    },
    {
      id: "talisman_scorpion_flame",
      name: C("炎の蠍", "炎之蠍"),
      body: C(
        "自身がエネミーに属性「炎」の蓄積値を与えるとき、その蓄積値を「+1」する。（Hit数を問わない）",
        "自身給予敵人「炎」屬性蓄積值時，該蓄積值+1。(不問Hit數)"
      ),
    },
    {
      id: "talisman_scorpion_thunder",
      name: C("雷の蠍", "雷之蠍"),
      body: C(
        "自身がエネミーに属性「雷」の蓄積値を与えるとき、その蓄積値を「+1」する。（Hit数を問わない）",
        "自身給予敵人「雷」屬性蓄積值時，該蓄積值+1。(不問Hit數)"
      ),
    },
    {
      id: "talisman_scorpion_sacred",
      name: C("聖なる蠍", "聖蠍"),
      body: C(
        "自身がエネミーに属性「聖」の蓄積値を与えるとき、その蓄積値を「+1」する。（Hit数を問わない）",
        "自身給予敵人「聖」屬性蓄積值時，該蓄積值+1。(不問Hit數)"
      ),
    },
    {
      id: "talisman_warrior_jar_shard",
      name: C("戦士の壺の破片", "戰士之壺碎片"),
      body: C("自身の「戦技」ダメージを「＋5」する。", "自身「戰技」傷害+5。"),
    },
    {
      id: "talisman_sorcerer_orb",
      name: C("魔術師球のタリスマン", "魔術師球護符"),
      body: C("自身の「魔術」ダメージを「＋5」する。", "自身「魔術」傷害+5。"),
    },
    {
      id: "talisman_believer_cloth",
      name: C("信徒の誓布", "信徒的誓布"),
      body: C("自身の「祈祷」ダメージを「＋5」する。", "自身「祈禱」傷害+5。"),
    },
    {
      id: "talisman_longbow",
      name: C("遠矢のタリスマン", "遠矢護符"),
      body: C("自身の射撃武器「1Hitダメージ」を「＋5」する。", "自身射擊武器1Hit傷害+5。"),
    },
    {
      id: "talisman_hardbow",
      name: C("硬矢のタリスマン", "硬矢護符"),
      body: C("自身の射撃武器「2Hitダメージ」を「＋5」する。", "自身射擊武器2Hit傷害+5。"),
    },
    {
      id: "talisman_companion_jar",
      name: C("友なる壺", "友伴之壺"),
      body: C(
        "自身が使用する消耗品「投擲武器／投擲壺」のダメージを「＋5」する。",
        "自身使用的消耗品「投擲武器/投擲壺」傷害+5。"
      ),
    },
    {
      id: "talisman_crimson_amber_medallion",
      name: C("緋琥珀のメダリオン", "緋琥珀勳章"),
      body: C("自身の「最大HP」を「＋□」する。", "自身「最大HP＋□」。"),
    },
    {
      id: "talisman_blue_amber_medallion",
      name: C("青琥珀のメダリオン", "青琥珀勳章"),
      body: C("自身の「最大FP」を「＋□」する。", "自身「最大FP＋□」。"),
    },
    {
      id: "talisman_green_amber_medallion",
      name: C("緑琥珀のメダリオン", "綠琥珀勳章"),
      body: C(
        "行動フェイズ終了時、自身の耐力ダイスが0個の場合、自身に耐力ダイスを1個追加する。",
        "行動階段結束時,自身耐力骰子為0的時候,為自身追加1顆耐力骰。"
      ),
    },
    {
      id: "talisman_crimson_seed_medallion",
      name: C("緋色種子のメダリオン", "緋色種子勳章"),
      body: C("自身が使用する聖杯瓶の「HP回復量」を「＋□」する。", "自身使用的聖杯瓶「HP回復量＋□」。"),
    },
    {
      id: "talisman_green_turtle",
      name: C("緑亀のタリスマン", "綠龜護符"),
      body: C("ガードフェイズ開始時、自身に耐力ダイスを1個追加する。", "防禦階段開始時,為自身追加1顆耐力骰。"),
    },
    {
      id: "talisman_erdtree_favor",
      name: C("黄金樹の恩寵", "黃金樹的恩寵"),
      body: C("自身の「最大HP＋□／最大FP＋□」する。", "自身「最大HP＋□ / 最大FP＋□」。"),
    },
    {
      id: "talisman_carian_filigree",
      name: C("カーリアの徽章", "卡利亞徽章"),
      body: C(
        "自身が「戦技」を使用する際の「FPコスト」を、任意で「HPコスト」に変更できる。（分割して変換することはできない）",
        "自身使用「戰技」的「FP cost」可任意改為「HP cost」。(無法分割變換)"
      ),
    },
    {
      id: "talisman_primal_glintstone_blade",
      name: C("原輝石の刃", "原輝石之刃"),
      body: C(
        "自身が「魔術／祈祷」を使用する際の「FPコスト」を、任意で「HPコスト」に変更できる。（分割して変換することはできない）",
        "自身使用「魔術/祈禱」的「FP cost」可任意改為「HP cost」。(無法分割變換)"
      ),
    },
    {
      id: "talisman_old_lords_talisman",
      name: C("古き王のタリスマン", "古王護符"),
      body: C(
        "自身が使用する「魔術／祈祷」の効果時間「フェイズ終了まで／終了フェイズまで」を、任意で「次のターンの終了フェイズまで」に変更できる。",
        "自身使用「魔術/祈禱」的「階段結束為止/結束階段為止」可任意改為「下一回合的結束階段為止」。"
      ),
    },
    {
      id: "talisman_radagons_soreseal",
      name: C("ラダゴンの肖像", "拉塔岡的肖像"),
      body: C(
        "自身が「魔術／祈祷」を使用する際の消費点を1点減らすことができる（③③の場合は②③に変換可）。ゾロ目・連番には無効。",
        "自身使用「魔術/祈禱」的消耗點數、可將其減少1點（33的情況可轉換23）、對豹子連號無效。"
      ),
    },
    {
      id: "talisman_pillage_cameo",
      name: C("略奪のカメオ", "掠奪的浮雕"),
      body: C(
        "自身のみで総合ダメージ130以上を発生させたときのみ有効。1ターンに1回限り、自身に「HP回復：□」する。",
        "只有自身造成總和傷害130以上時生效、每回合限一次、自身「HP回復 □」。"
      ),
    },
    {
      id: "talisman_spirit_horn",
      name: C("精霊の角", "精靈之角"),
      body: C(
        "自身のみで総合ダメージ130以上を発生させたときのみ有効。1ターンに1回限り、自身に「FP回復：□」する。",
        "只有自身造成總和傷害130以上時生效、每回合限一次、自身「FP回復 □」。"
      ),
    },
    {
      id: "talisman_claw",
      name: C("爪のタリスマン", "爪之護符"),
      body: C("自身の遺物効果「ジャンプ攻撃」のダメージを「＋10」する。", "自身的遺物效果「跳躍攻擊」傷害「＋10」。"),
    },
    {
      id: "talisman_axe",
      name: C("斧のタリスマン", "斧之護符"),
      body: C("自身の遺物効果「タメ攻撃」のダメージを「＋10」する。", "自身的遺物效果「蓄力攻擊」傷害「＋10」。"),
    },
    {
      id: "talisman_roar_medallion",
      name: C("咆哮遺物のメダリオン", "咆哮遺物勳章"),
      body: C("一部のスキル効果が強化される（スキルの記述に従う）。", "部分技能效果得到強化（依照技能敘述）。"),
    },
    {
      id: "talisman_godfreys_icon",
      name: C("ゴッドフレイの肖像", "戈弗雷的肖像"),
      body: C(
        "自身が「魔術／祈祷」を使用する際の消費点を1点（ダイス1個ぶん）増やすと、ダメージを「＋10」する。",
        "自身使用「魔術/祈禱」的消耗點數、可將其增加1顆1點、則傷害+10。"
      ),
    },
    {
      id: "talisman_perfumers",
      name: C("調香師のタリスマン", "調香師的護符"),
      body: C(
        "調香瓶の消耗品を使用する際、そのレベル2の効果を使用する。",
        "使用調香瓶消耗品時、使用其等級2的效果。"
      ),
    },
    {
      id: "talisman_blood_lord_joy",
      name: C("血の君主の歓喜", "血之君主的歡喜"),
      body: C(
        "いずれかのPCがエネミーに状態異常「出血」の蓄積値を発生させるたび（耐性であっても）、自身に「HP回復：□」と「FP回復：□」を適用する。",
        "任一名PC對敵人造成異常狀態「出血」蓄積值時（即使耐性），自身即獲得「HP回復：□」與「FP回復：□」。"
      ),
    },
    {
      id: "talisman_rot_joy",
      name: C("廃散者の歓喜", "廢散者的歡喜"),
      body: C(
        "いずれかのPCがエネミーに状態異常「腐敗」の蓄積値を発生させるたび（耐性であっても）、自身に「HP回復：□」と「FP回復：□」を適用する。",
        "任一名PC對敵人造成異常狀態「腐敗」蓄積值時（即使耐性），自身即獲得「HP回復：□」與「FP回復：□」。"
      ),
    },
    {
      id: "talisman_greed",
      name: C("貪欲者の洛印", "貪婪者的烙印"),
      body: C(
        "自身の「最大HP」を「-2」する。全フェイズ踏破時、自身が獲得するルーン量を「+1」する。",
        "自身的最大HP-2、全階踏破時、增加自身獲得的盧恩量+1。"
      ),
    },
    {
      id: "talisman_great_goat",
      name: C("大山羊のタリスマン", "大山羊護符"),
      body: C("ガードフェイズ開始時、自身の耐力ダイスを1個（1点）増やす。", "防禦階段開始時、自身耐力骰增加一顆1點。"),
    },
    {
      id: "talisman_great_shield",
      name: C("大盾のタリスマン", "大盾護符"),
      body: C(
        "自身がガードを行う際、1回で2回ガードする場合、2回目以降「ガード時HP価値+20」する（最大100）。",
        "自身進行防禦時，一次進行兩次防禦時、第2次以後「防禦時HP價值+20」最大100。"
      ),
    },
    {
      id: "talisman_arsenal_charm",
      name: C("樹幽羽のタリスマン", "樹幽羽護符"),
      body: C(
        "自身がガードを行う際、「ガード時HP価値+10」は最初の1回のみ（最大100）。",
        "自身進行防禦時，「防禦時HP價值+10」只有第一次、最大100。"
      ),
    },
    {
      id: "talisman_shield_scorpion_charm",
      name: C("捧鬮の盾", "捧鬮之盾"),
      body: C(
        "自身が「HP価値：最大HP」のとき、自身がガードすると「HP価値＋20」する（複数回ガードする場合は最初の1回のみ適用）。",
        "自身「HP價值：最大HP」時，自身進行防禦「hp價值＋20」（多次防禦時，第一次適用）。"
      ),
    },
    {
      id: "talisman_sword_scorpion_charm",
      name: C("捧鬮の剣", "捧鬮之劍"),
      body: C(
        "自身が「現在HP＝最大HP」のとき、自身から発生するアタックのダメージを「1Hit：＋5／2Hit：＋10」する。戦技・魔術・祈祷の場合は＋5。",
        "自身「現在HP＝最大HP」時，自身進行的攻擊傷害「1Hit：＋5／2Hit：＋10」。戰技魔法祈禱則為+5。"
      ),
    },
    {
      id: "talisman_crimson_seven_edge",
      name: C("赤羽の七支刃", "赤羽的七支刃"),
      body: C("自身が「現在HP＝□□□以下」のとき、自身から発生するダメージを「＋5」する。", "自身「現在HP＝□□□以下」時，自身造成的傷害「＋5」。"),
    },
    {
      id: "talisman_indigo_seven_edge",
      name: C("青紫の七支刃", "青紫的七支刃"),
      body: C(
        "自身が「現在HP＝□□□以下」のとき、自身に「HP価値：+20」する（ただし最大値100）。",
        "自身「現在HP＝□□□以下」時，自身獲得「HP價值：+20」（但最大值為100）。"
      ),
    },
    {
      id: "talisman_dew_tear",
      name: C("憐みの雫", "憐憫的雫滴"),
      body: C(
        "ターン開始時、耐力ダイスを振る際に発動できる。ダイス1個少なく振り、自身に「HP回復：□」する。",
        "回合開始，骰耐力骰時可發動，少擲一顆並可以恢復HP□。"
      ),
    },
    {
      id: "talisman_blue_dancer_blade",
      name: C("青色の凶刃", "青色的凶刃"),
      body: C("自身が遺物「致命の一撃」を使用すると、自身に「FP回復：□」する。", "自身使用遺物「致命一擊」時，恢復FP□。"),
    },
    {
      id: "talisman_green_dancer_blade",
      name: C("緑色の凶刃", "綠色的凶刃"),
      body: C("自身が遺物「致命の一撃」を使用すると、自身に「HP回復：□」する。", "自身使用遺物「致命一擊」時，恢復HP□。"),
    },
    {
      id: "talisman_short_dancer_blade",
      name: C("短剣の凶刃", "短劍的凶刃"),
      body: C("自身が遺物「致命の一撃」を使用すると、ダメージを「＋15」する。", "自身使用遺物「致命一擊」時，傷害+15。"),
    },
    {
      id: "talisman_gold_scarab",
      name: C("金のスカラベ", "金聖甲蟲"),
      body: C("ボスを撃破したとき、自身が獲得するルーンを「＋1」する。", "擊破boss時，自身盧恩額外+1。"),
    },
    {
      id: "talisman_silver_scarab",
      name: C("銀のスカラベ", "銀聖甲蟲"),
      body: C(
        "自身が潜在能力を獲得する際、レアリティ決定の出目に「＋1」する。",
        "自身潛在能力獲得，稀有度決定時，骰出點數再額外+1。"
      ),
    },
  ];

  function list() {
    return TALISMANS;
  }

  function get(id) {
    return (
      TALISMANS.filter(function (t) {
        return t.id === id;
      })[0] || null
    );
  }

  function search(query) {
    var q = (query || "").trim().toLowerCase();
    if (!q) return [];
    return TALISMANS.filter(function (t) {
      return T(t.name).toLowerCase().indexOf(q) !== -1;
    });
  }

  // タリスマン獲得決定表（200-202頁）。1D6で表A（①②③）／表B（④⑤⑥）を決め、
  // 各表内をさらにグループ（1D6、6グループ均等）→グループ内アイテム（1D6、
  // アイテム数が6未満のグループは出目が重複する）の2段階で振って1個を決定する
  // d66形式のランダム決定表。最終グループ（メダリオン・恩寵系6種）はA表・B表で共通。
  function R(roll, id) {
    return { roll: roll, id: id };
  }

  var ACQUISITION_SHARED_GROUP = [
    R("1", "talisman_crimson_amber_medallion"),
    R("2", "talisman_blue_amber_medallion"),
    R("3", "talisman_green_amber_medallion"),
    R("4", "talisman_crimson_seed_medallion"),
    R("5", "talisman_green_turtle"),
    R("6", "talisman_erdtree_favor"),
  ];

  var ACQUISITION_GROUPS_A = [
    [
      R("1", "talisman_sturdy_horn_charm"),
      R("2", "talisman_immune_horn_charm"),
      R("3", "talisman_sane_horn_charm"),
      R("4-5", "talisman_dappled_horn_charm"),
      R("6", "talisman_prince_of_death_pouch"),
    ],
    [
      R("1", "talisman_dragoncrest_thunder"),
      R("2", "talisman_dragoncrest_flame"),
      R("3", "talisman_dragoncrest_magic"),
      R("4", "talisman_dragoncrest_holy"),
      R("5", "talisman_dragoncrest_pearl"),
      R("6", "talisman_dragon_shield_crest"),
    ],
    [
      R("1", "talisman_millicents_gauntlet"),
      R("2", "talisman_twin_blade"),
      R("3", "talisman_winged_sword"),
      R("4", "talisman_god_skin_swaddle"),
      R("5", "talisman_curved_sword"),
      R("6", "talisman_greathammer"),
    ],
    [
      R("1-2", "talisman_scorpion_magic"),
      R("3", "talisman_scorpion_flame"),
      R("4", "talisman_scorpion_thunder"),
      R("5-6", "talisman_scorpion_sacred"),
    ],
    [
      R("1", "talisman_warrior_jar_shard"),
      R("2", "talisman_sorcerer_orb"),
      R("3", "talisman_believer_cloth"),
      R("4", "talisman_longbow"),
      R("5", "talisman_hardbow"),
      R("6", "talisman_companion_jar"),
    ],
    ACQUISITION_SHARED_GROUP,
  ];

  var ACQUISITION_GROUPS_B = [
    [
      R("1", "talisman_carian_filigree"),
      R("2", "talisman_primal_glintstone_blade"),
      R("3", "talisman_old_lords_talisman"),
      R("4", "talisman_radagons_soreseal"),
      R("5", "talisman_pillage_cameo"),
      R("6", "talisman_spirit_horn"),
    ],
    [
      R("1-2", "talisman_claw"),
      R("3", "talisman_axe"),
      R("4", "talisman_roar_medallion"),
      R("5", "talisman_godfreys_icon"),
      R("6", "talisman_perfumers"),
    ],
    [
      R("1", "talisman_blood_lord_joy"),
      R("2", "talisman_rot_joy"),
      R("3", "talisman_greed"),
      R("4", "talisman_great_goat"),
      R("5", "talisman_great_shield"),
      R("6", "talisman_arsenal_charm"),
    ],
    [
      R("1", "talisman_shield_scorpion_charm"),
      R("2", "talisman_sword_scorpion_charm"),
      R("3-4", "talisman_crimson_seven_edge"),
      R("5-6", "talisman_indigo_seven_edge"),
    ],
    [
      R("1", "talisman_dew_tear"),
      R("2", "talisman_blue_dancer_blade"),
      R("3", "talisman_green_dancer_blade"),
      R("4", "talisman_short_dancer_blade"),
      R("5", "talisman_gold_scarab"),
      R("6", "talisman_silver_scarab"),
    ],
    ACQUISITION_SHARED_GROUP,
  ];

  function acquisitionTables() {
    return { groupsA: ACQUISITION_GROUPS_A, groupsB: ACQUISITION_GROUPS_B };
  }

  window.PriTestTalismans = {
    list: list,
    get: get,
    search: search,
    localizedText: T,
    acquisitionTables: acquisitionTables,
  };
})();
