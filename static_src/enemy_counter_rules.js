(function () {
  // 防禦反擊型招式的反擊效果——純判定層。
  // 設計文件：docs/superpowers/specs/2026-09-21-midnight-enemy-counter-design.md
  //
  // 這個模組刻意不讀任何遊戲狀態、不碰 DOM、不碰 RTDB（比照 midnight_sprite.js 與
  // enemy_action_anim_map.js 的三層解耦約束）。所有判斷都留在 midnight.js 的呼叫端，
  // 這裡只有純函式，方便用 tools/midnight_check/enemy_counter_check.js 直接測。

  // 敵人使出防禦反擊型招式之後，玩家對牠出手還會被反擊的時間（設計文件 §4）。
  var COUNTER_WINDOW_MS = 2000;

  // 反擊每一下給玩家的反應時間。一般攻擊是 2000/2500/3000ms
  // （ENEMY_ATTACK_HIT_WINDOW_MS），反擊刻意更短，這就是「快速反擊」的表現。
  var COUNTER_REACTION_WINDOW_MS = 1000;

  // 對象招式（設計文件 §3）：全 549 筆裡命中 4 名 6 筆——
  //   ガードカウンター（3 筆）／ハイガード＆ガードカウンター／バックラーパリィ／
  //   弾き＆妖刀解放
  // 關鍵字刻意收窄：補標時使用者對其他含防禦語彙的招式（盾撃→single、
  // 突撃指令＆防御態勢→thrust、踏み込み＆盾ガード→thrust、時間差攻撃＆黄金の返報→single、
  // 薙ぎ払い＆防御態勢→area）都明確給了攻擊動畫，代表那些是「攻擊為主、附帶防禦」的
  // 複合技，不列入反擊對象。
  //
  // 「弾き」是招架的和語。動畫那邊被產生器的 /弾/（彈丸）誤命中而分到 line，但依照
  // 「複合技以攻擊部分分類」的既有慣例，動畫維持 line 不動，只有反擊效果在這裡撈它
  // （使用者裁示）。寫成 /弾き/ 而不是 /弾/，是為了不把「魔力弾」「重力弾」等彈丸系
  // 掃進來——全 549 筆裡 /弾き/ 只命中 弾き＆妖刀解放 這 1 筆。
  var COUNTER_NAME_RE = /カウンター|パリィ|弾き/;

  // actionName 可以直接把 enemies_data_*.js 的 action.name 丟進來——實際資料是
  // { ja: "ガードカウンター", zh: "格擋反擊" } 這種多語物件，enemyAttack.actionName
  // 也是原封不動載這個形狀（見 maybeStartEnemyAttack()）。判定比照對照表以 ja 為準，
  // 同時也接受直接傳字串。把這裡當成字串處理會讓反擊永遠不發動。
  function isCounterAction(actionName) {
    if (!actionName) return false;
    var s = typeof actionName === "string" ? actionName : actionName.ja;
    if (!s || typeof s !== "string") return false;
    return COUNTER_NAME_RE.test(s);
  }

  // 反擊每一下的傷害＝原招式的一半（使用者明確規格）。
  // 原招式傷害是 0（規則書沒寫傷害的招式）時一半仍是 0，會播反擊表現但不扣血，
  // 符合 CLAUDE.md §19「不發明數值」。
  function counterDamage(dmgAmount) {
    var n = Number(dmgAmount);
    if (!isFinite(n) || n <= 0) return 0;
    return Math.round(n / 2);
  }

  // 反擊下數 1~2 各 50%（使用者明確規格）。
  // 收 rand 參數而不是自己呼叫 Math.random()，是為了讓邊界可測
  // （比照既有的 pickWeightedIndex(Math.random(), weights) 寫法）。
  function pickCounterHitCount(rand) {
    return rand < 0.5 ? 1 : 2;
  }

  window.PriTestEnemyCounterRules = {
    COUNTER_WINDOW_MS: COUNTER_WINDOW_MS,
    COUNTER_REACTION_WINDOW_MS: COUNTER_REACTION_WINDOW_MS,
    isCounterAction: isCounterAction,
    counterDamage: counterDamage,
    pickCounterHitCount: pickCounterHitCount,
  };
})();
