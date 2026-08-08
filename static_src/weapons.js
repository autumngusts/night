(function () {
  // 装備品（武器）データベース。現時点では「短剣」カテゴリのみ収録（写真提供分）。
  // 他カテゴリ（大剣・大曲剣・刺剣・直剣・大槍・槍・斧槍・弓・大斧・特大武器・杖・聖印・盾など）は
  // 資料が揃い次第、同じ形式で CATEGORIES／SKILLS／WEAPONS に追加していく。
  function C(ja, zh) {
    return { ja: ja, zh: zh };
  }

  function lang() {
    return window.I18N ? window.I18N.getLang() : "zh";
  }

  // {zh, ja} を現在言語で解決する（未整備言語は zh にフォールバック）
  function T(field) {
    if (!field) return "";
    if (typeof field === "string") return field;
    return field[lang()] || field.zh || field.ja || "";
  }

  var UNCONFIRMED = C("未確認（原文が判読できず要確認）", "未確認（原文判讀不易，待確認）");

  // 共通武器スキル（カテゴリを問わず使われる汎用テンプレート。出典：規則書154頁）
  function statusSkillBody(statusField) {
    return C(
      "「" +
        T(statusField) +
        "」の状態異常。このスキルを持つ武器でアタックを行い、総合ダメージとしてエネミーにダメージを与える際、効果を発揮（戦技では発揮されない）。エネミーに対する状態異常蓄積値が増加する。1Hitのときは「蓄積値：1」、2Hitのときは「蓄積値：2」。",
      "「" +
        T(statusField) +
        "」異常狀態。持有此技能的武器進行攻擊，以總合傷害對敵人造成傷害時發揮效果（戰技不發揮）。敵人的異常狀態蓄積值增加。1Hit時「蓄積值：1」，2Hit時「蓄積值：2」。"
    );
  }

  function elementSkillBody(elementField) {
    return C(
      "「" +
        T(elementField) +
        "」の属性（魔／炎／雷／聖のいずれか）。このスキルを持つ武器でアタックを行い、総合ダメージとしてエネミーにダメージを与える際、効果を発揮（戦技では発揮されない）。エネミーに対する属性蓄積値が増加する。1Hitのときは「蓄積値：1」、2Hitのときは「蓄積値：2」。",
      "「" +
        T(elementField) +
        "」屬性（魔／火／雷／聖之一）。持有此技能的武器進行攻擊，以總合傷害對敵人造成傷害時發揮效果（戰技不發揮）。敵人的屬性蓄積值增加。1Hit時「蓄積值：1」，2Hit時「蓄積值：2」。"
    );
  }

  // 特効：X（死に生きる者／竜／星の眷属など、敵の特定カテゴリに対する追加ダメージ。出典：規則書154-155頁）
  function specialEffectSkillBody(targetField) {
    return C(
      "このスキルを持つ武器でアタックを行い、総合ダメージとしてエネミーにダメージを与える際に、効果を発揮。エネミーが「" +
        T(targetField) +
        "」の場合、発生するダメージを「1Hit：+5／2Hit：+10」する。",
      "持有此技能的武器進行攻擊，以總合傷害對敵人造成傷害時發揮效果。敵人為「" +
        T(targetField) +
        "」時，發生的傷害「1Hit：+5／2Hit：+10」。"
    );
  }

  // シナリオのイベントでのみ獲得する、レア度C/U専用の「属性・状態異常／基本威力-5」スキル（出典：規則書154頁）
  function elementMinus5SkillBody(elementField) {
    return C(
      "このスキルは、シナリオのイベントでしか獲得せず、「レア度：C/U」の武器にしか追加されない（「レア度：R/L」の武器は、このスキルを獲得しない）。このスキルを持つ武器を「武器威力：－5」する。「" +
        T(elementField) +
        "」の属性（魔／炎／雷／聖のいずれか）。このスキルを持つ武器でアタックを行い、総合ダメージとしてエネミーにダメージを与える際に、効果を発揮（戦技では発揮されない）。エネミーに対する「属性蓄積値（117頁）」が増加する。1Hitのときは「蓄積値：1」、2Hitのときは「蓄積値：2」。",
      "此技能僅能透過劇本事件獲得，且只會追加於「稀有度：C/U」的武器上（「稀有度：R/L」的武器不會獲得此技能）。持有此技能的武器「武器威力：－5」。「" +
        T(elementField) +
        "」屬性（魔／火／雷／聖之一）。持有此技能的武器進行攻擊，以總合傷害對敵人造成傷害時發揮效果（戰技不發揮）。敵人的「屬性蓄積值（117頁）」增加。1Hit時「蓄積值：1」，2Hit時「蓄積值：2」。"
    );
  }

  function statusMinus5SkillBody(statusField) {
    return C(
      "このスキルは、シナリオのイベントでしか獲得せず、「レア度：C/U」の武器にしか追加されない（「レア度：R/L」の武器は、このスキルを獲得しない）。このスキルを持つ武器を「武器威力：－5」する。「" +
        T(statusField) +
        "」の状態異常。このスキルを持つ武器でアタックを行い、総合ダメージとしてエネミーにダメージを与える際に、効果を発揮（戦技では発揮されない）。エネミーに対する「状態異常蓄積値（117頁）」が増加する。1Hitのときは「蓄積値：1」、2Hitのときは「蓄積値：2」。",
      "此技能僅能透過劇本事件獲得，且只會追加於「稀有度：C/U」的武器上（「稀有度：R/L」的武器不會獲得此技能）。持有此技能的武器「武器威力：－5」。「" +
        T(statusField) +
        "」異常狀態。持有此技能的武器進行攻擊，以總合傷害對敵人造成傷害時發揮效果（戰技不發揮）。敵人的「異常狀態蓄積值（117頁）」增加。1Hit時「蓄積值：1」，2Hit時「蓄積值：2」。"
    );
  }


  var CATEGORIES = window.PriTestWeaponsCategories;

  var SKILLS = window.PriTestWeaponsSkills;

  var WEAPONS = window.PriTestWeaponsData;


  function list() {
    return WEAPONS;
  }

  function get(id) {
    return (
      WEAPONS.filter(function (w) {
        return w.id === id;
      })[0] || null
    );
  }

  function getCategory(id) {
    return (
      CATEGORIES.filter(function (c) {
        return c.id === id;
      })[0] || null
    );
  }

  function getSkill(id) {
    return SKILLS[id] || null;
  }

  // 登録済み戦技の全件（{id, ...skill}[]）。ランダム戦技の手動割り当て検索に使う。
  function allSkills() {
    return Object.keys(SKILLS).map(function (id) {
      var s = SKILLS[id];
      return { id: id, name: s.name, kind: s.kind, body: s.body };
    });
  }

  function categories() {
    return CATEGORIES;
  }

  // 名称の部分一致検索（大文字小文字を区別しない）。空文字なら空配列を返す。
  function search(query) {
    var q = (query || "").trim().toLowerCase();
    if (!q) return [];
    return WEAPONS.filter(function (w) {
      return T(w.name).toLowerCase().indexOf(q) !== -1;
    });
  }

  window.PriTestWeapons = {
    list: list,
    get: get,
    getCategory: getCategory,
    getSkill: getSkill,
    allSkills: allSkills,
    categories: categories,
    search: search,
    localizedText: T,
    statusSkillBody: statusSkillBody,
    elementSkillBody: elementSkillBody,
    specialEffectSkillBody: specialEffectSkillBody,
    elementMinus5SkillBody: elementMinus5SkillBody,
    statusMinus5SkillBody: statusMinus5SkillBody,
  };
})();
