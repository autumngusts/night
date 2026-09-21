(function () {
  // 第三天（最終夜）に登場する夜の王の画像レジストリ。
  // 管理者がゲームごとに1体選び、Nightボードの第三天到達時に盤面右側へ表示する。
  var BOSSES = [
    { id: "maris", title: "Maris", subtitle: "Fathom of Night", image: "maris.jpg" },
    { id: "fulghor", title: "Fulghor", subtitle: "Champion of Nightglow", image: "fulghor.jpg" },
    { id: "harmonia", title: "Harmonia", subtitle: "Weapon-Bequeathed", image: "harmonia.jpg" },
    { id: "gladius", title: "Gladius", subtitle: "Beast of Night", image: "gladius.jpg" },
    { id: "gnoster", title: "Gnoster", subtitle: "Wisdom of Night", image: "gnoster.jpg" },
    { id: "caligo", title: "Caligo", subtitle: "Miasma of Night", image: "caligo.jpg" },
    { id: "libra", title: "Libra", subtitle: "Creature of Night", image: "libra.jpg" },
    { id: "edele", title: "Edele", subtitle: "Baron of Night", image: "edele.jpg" },
    { id: "stragedes", title: "Stragedes", subtitle: "Rebellion of Night", image: "stragedes.jpg" },
    // 2026-09-21補上第10隻：劇本10「夜之側影」（scenarios.js night_aspect）的夜王，
    // night_boss_rulebook.js／boss_auto_gm_data.js／night_gm_flow.js的id「nameless」早已存在，
    // 只差這裡的名簿與圖片（使用者提供photo/nameless.png，縮成700px的jpg）。
    { id: "nameless", title: "Nameless", subtitle: "Night Aspect", image: "nameless.jpg" },
  ];

  function list() {
    return BOSSES;
  }

  function get(id) {
    return (
      BOSSES.filter(function (b) {
        return b.id === id;
      })[0] || null
    );
  }

  function imagePath(boss, staticPrefix) {
    if (!boss) return null;
    return (staticPrefix || "../static/") + "images/bosses/" + boss.image;
  }

  window.PriTestNightBosses = { list: list, get: get, imagePath: imagePath };
})();
