(function () {
  // マップ盤面（フィールド）カードのデータベース。規則書の各フィールドカードの内容を、
  // カード名（最大分類）→分岐区域（タグ表示）→フロア→イベント行、という階層で保持する。
  // 写真提供が進み次第、CARDS配列に同じ形式で追加していく（現時点はA・2のみ収録）。
  function C(ja, zh) {
    return { ja: ja, zh: zh };
  }

  // 武器抽選ウィザードの「射撃武器」「盾」グループショートカット。character_drawer.jsが
  // 先に読み込まれる前提で実値を引き継ぐ（未読込時は既知のリテラルへフォールバック）。
  var CD_REF = window.PriTestCharacterDrawer || {};
  var RANGED_GROUP_CATEGORY = CD_REF.RANGED_GROUP_CATEGORY || "__ranged_group__";
  var SHIELD_GROUP_CATEGORY = CD_REF.SHIELD_GROUP_CATEGORY || "__shield_group__";

  function lang() {
    return window.I18N ? window.I18N.getLang() : "zh";
  }

  function T(field) {
    if (!field) return "";
    if (typeof field === "string") return field;
    return field[lang()] || field.zh || field.ja || "";
  }

  // depth: 0=通常記述（判定／描写／報酬など） 1〜3=「→」「→→」「→→→」に相当するイベント／小イベントの分岐。
  // label: 【突破判定】【描写】【成功】など、原文の角括弧見出し（任意）。text: 本文。
  // bullet: true の場合、直前のイベント行に属する「・」箇条書き詳細として、親と同じ深さで描画する。
  function L(depth, label, text, bullet) {
    return {
      depth: depth,
      label: label ? C(label[0], label[1]) : null,
      text: C(text[0], text[1]),
      bullet: !!bullet,
    };
  }

  var CARDS = [].concat(
    window.PriTestFieldsData1,
    window.PriTestFieldsData2,
    window.PriTestFieldsData3,
    window.PriTestFieldsData4
  );

  window.PriTestFields = {
    list: function () {
      return CARDS;
    },
    get: function (id) {
      return (
        CARDS.filter(function (c) {
          return c.id === id;
        })[0] || null
      );
    },
    localizedText: T,
  };
})();
