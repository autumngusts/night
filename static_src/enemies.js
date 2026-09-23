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

  // 新字體／舊字體（異體字）正規化。
  // 2026-08-23 已經踩過一次：enemies_data_3.js 的「竜のツリーガード」ja 側用新字體「竜」，
  // 而 fields_data_4.js 的敵人引用用舊字體「龍」，search() 是純子字串比對所以對不上；當時的
  // 修法是把敵人資料那一側改成「龍」。但那只修了那一組資料——2026-09-24 的籌碼交叉測試
  // （tools/midnight_check/chip_coverage_check.js）發現 event_rulebook.js 的「可怖強敵決定表」
  // 仍然寫新字體「竜のツリーガード」，於是第 2 天⑧點的可怖強敵有 1/12 機率解析失敗，
  // 靜默退回 randomEnemyMatchFallback()＝從全部 149 隻裡亂數挑一隻，可能挑到雜魚。
  //
  // 逐份資料去統一字體治標不治本（規則書原文本來就兩種寫法都有，而且改原文等於竄改轉錄），
  // 因此改在比對的唯一出入口做正規化：把已知的異體字摺疊成同一個字再比對。只收錄實際
  // 出現過的對應，不做通用的漢字正規化（那會引入誤配）。
  var KANJI_VARIANTS = { "竜": "龍" }; // 竜 → 龍

  function foldVariants(text) {
    var out = "";
    for (var i = 0; i < text.length; i++) {
      var ch = text.charAt(i);
      out += KANJI_VARIANTS[ch] || ch;
    }
    return out;
  }

  function search(query) {
    var q = foldVariants((query || "").trim().toLowerCase());
    if (!q) return [];
    return allEnemies().filter(function (row) {
      var n = row.enemy.name;
      return (
        (n.ja && foldVariants(n.ja.toLowerCase()).indexOf(q) !== -1) ||
        (n.zh && foldVariants(n.zh.toLowerCase()).indexOf(q) !== -1)
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
    // 名稱比對用的異體字正規化（見 KANJI_VARIANTS 說明）。night_gm_flow.js 的
    // resolveCombatEnemyMatch() 在多筆命中時要做精確比對，那一步也必須經過同一個正規化，
    // 否則「search 找得到、精確比對卻對不上」會退回 null。
    foldNameVariants: foldVariants,
    get: get,
    getFamily: getFamily,
    imagePath: imagePath,
    localizedText: T,
  };

  function T(field) {
    return localizedText(field);
  }
})();
