(function () {
  // 第7部「エネミーセクション」討伐対象の通常エネミー（夜の王を除く）。
  // 出典: 規則書 P.230-238。系統（科）ごとに基礎データ（レベル別HP枠・乱戦ダメージ）を共有し、
  // 各エネミーは「サイズ・耐性・アクション決定表（出目→アクション→乱戦ダメージ修正）・特殊能力」を持つ。
  // 写真の解像度・回転により、基礎データ表の一部数値・一部エネミー名は判読信頼度が低い（family.note参照）。
  function C(ja, zh) {
    return { ja: ja, zh: zh };
  }

  function base(dmgRow, hpRow) {
    // dmgRow: レベル1〜15の乱戦ダメージ基準値。hpRow（任意）: 同レベルのHP枠表記（規則書の「□×n」表記）。
    return dmgRow.map(function (dmg, i) {
      return { level: i + 1, dmg: dmg, hp: (hpRow && hpRow[i]) || null };
    });
  }

  // guardValueTable の row.value 用: レベルの奇数／偶数で交互に異なる値をとる系統向けの15要素配列を生成する。
  function oddEven(oddValue, evenValue) {
    var out = [];
    for (var lv = 1; lv <= 15; lv++) {
      out.push(lv % 2 === 1 ? oddValue : evenValue);
    }
    return out;
  }

  // guardValueTable の row.value 用: レベル3個ごとに3値が循環する系統向けの15要素配列を生成する。
  function cycle3(v1, v2, v3) {
    var out = [];
    for (var lv = 1; lv <= 15; lv++) {
      var m = lv % 3;
      out.push(m === 1 ? v1 : m === 2 ? v2 : v3);
    }
    return out;
  }

  var FAMILIES = [].concat(
    window.PriTestEnemiesData1,
    window.PriTestEnemiesData2,
    window.PriTestEnemiesData3,
    window.PriTestEnemiesData4
  );

  function localizedText(field) {
    if (!field) return "";
    var lang = window.I18N ? window.I18N.getLang() : "zh";
    return field[lang] || field.zh || field.ja || "";
  }

  function listFamilies() {
    return FAMILIES;
  }

  function allEnemies() {
    var out = [];
    FAMILIES.forEach(function (fam) {
      fam.enemies.forEach(function (e) {
        out.push({ familyId: fam.id, familyName: fam.name, familyBase: fam.base, enemy: e });
      });
    });
    return out;
  }

  function search(query) {
    var q = (query || "").trim().toLowerCase();
    if (!q) return [];
    return allEnemies().filter(function (row) {
      var n = row.enemy.name;
      return (
        (n.ja && n.ja.toLowerCase().indexOf(q) !== -1) ||
        (n.zh && n.zh.toLowerCase().indexOf(q) !== -1)
      );
    });
  }

  function imagePath(enemy, staticPrefix) {
    if (!enemy || !enemy.image) return null;
    return (staticPrefix || "../static/") + "images/enemies/" + enemy.image;
  }

  function get(familyId, enemyId) {
    var fam = FAMILIES.filter(function (f) {
      return f.id === familyId;
    })[0];
    if (!fam) return null;
    var e = fam.enemies.filter(function (x) {
      return x.id === enemyId;
    })[0];
    if (!e) return null;
    return { familyId: fam.id, familyName: fam.name, familyBase: fam.base, enemy: e };
  }

  // 系統（科）そのもの（guardCount/guardValueTable等、get()が返さない科レベルの
  // フィールドを読むため）を返す。docs/enemy_damage_rules.md 5節のガード回数/HP価値
  // システムで使用。
  function getFamily(familyId) {
    return FAMILIES.filter(function (f) {
      return f.id === familyId;
    })[0] || null;
  }

  window.PriTestEnemies = {
    listFamilies: listFamilies,
    allEnemies: allEnemies,
    search: search,
    get: get,
    getFamily: getFamily,
    imagePath: imagePath,
    localizedText: T,
  };

  function T(field) {
    return localizedText(field);
  }
})();
