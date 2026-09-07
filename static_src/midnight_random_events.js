// ============================================================================
// midnight（即時制擴張版）隨機事件籌碼：10分支中需要獨立子表/多步驟資料的部分，抽成純函式，
// 不含RTDB/DOM——避免把midnight.js塞得更肥。2026-09-07新增(設計文件§8)。
//
// 資料來源：static_src/event_rulebook.js「random_event」籌碼的extraTables
// （「チェスト内容決定表」「襲撃イベント決定表」），以及同檔案「虫の大量発生」
// 「発狂地帯」兩個子事件（322頁）的完整敘述文字。所有數值皆已對照原始rulebook
// 逐行核對，沒有規則書未確認的自行猜測數值（CLAUDE.md §17.1／§19）。
// ============================================================================
(function () {
  "use strict";

  // ---- 埋もれ宝「チェスト内容決定表」（event_rulebook.js extraTables[1]，1D）----
  var CHEST_TABLE = [
    { faces: [1], kind: "smithingStone" },
    { faces: [2], kind: "stoneswordKey" },
    { faces: [3], kind: "consumable" },
    { faces: [4, 5], kind: "weaponStar", value: 2 },
    { faces: [6], kind: "weaponStar", value: 3 },
  ];
  function rollChestTable() {
    var roll = 1 + Math.floor(Math.random() * 6);
    var row = CHEST_TABLE.filter(function (r) { return r.faces.indexOf(roll) !== -1; })[0];
    return { roll: roll, kind: row.kind, value: row.value };
  }
  function rollChestTableThreeTimes() {
    var out = [];
    for (var i = 0; i < 3; i++) out.push(rollChestTable());
    return out;
  }

  // ---- 襲撃イベント決定表（event_rulebook.js extraTables[2]，1D，各自劇本限定）----
  var AMBUSH_TABLE = [
    { faces: [1], nameJa: "忌み鬼", scenarios: [2, 3, 9, 10] },
    { faces: [2], nameJa: "兆し", scenarios: [3, 7, 9, 10] },
    { faces: [3], nameJa: "調律の魔物", scenarios: [6, 7, 9, 10] },
    { faces: [4], nameJa: "三つ首の獣", scenarios: [8, 9] },
    { faces: [5], nameJa: "霧の裂け目", scenarios: [8, 9] },
    { faces: [6], nameJa: "安寧者たち", scenarios: [9] },
  ];
  function rollAmbushTable(scenarioNumber) {
    for (var attempt = 0; attempt < 30; attempt++) {
      var roll = 1 + Math.floor(Math.random() * 6);
      var row = AMBUSH_TABLE.filter(function (r) { return r.faces.indexOf(roll) !== -1; })[0];
      if (row.scenarios.indexOf(scenarioNumber) !== -1) return { roll: roll, nameJa: row.nameJa };
    }
    return null; // 30次都不符合劇本限定，放棄不硬湊
  }

  // ---- 虫の大量発生：多步驟資料（純敘述/判定描述，midnight.js負責流程與RTDB）----
  // 對照event_rulebook.js「虫の大量発生」（322頁）完整本文：
  //   →地面の蟲たち／行為判定：〈12|運試し〉。規則書明文寫的是「運試し」，
  //     不是「任意の判定値」，因此statKey為固定的"luck"（非玩家自選）。
  //     失敗者「ルーン：10」を失う（「ルーン：9以下」の場合はすべて失う）。
  //   →知性の蟲を追う／行為判定：PCそれぞれ「HP損害：□」を受けて〈12|フィジカル〉、
  //     或「HP損害：□」を受けて〈12|メンタル〉（両方12、玩家可自選承受哪種損害/判定）。
  //     半数以上成功→討伐ボーナス；半数以上失敗→無獲得（事件終了）。
  //     「□」的實際數量規則書未標示具體格數，交由GM依規則書原文處理，此處不硬編碼。
  //   →討伐ボーナス：PC全員「撃破ルーン：3」。並獲得恩寵「知の集約」：戦闘終了時に
  //     PC代表1人が1Dを振り、出目1（⚀）ならPCそれぞれ追加で「ルーン：1」。
  var INSECT_SWARM_STEPS = {
    groundBugs: { checkTarget: 12, statKey: "luck", failRuneLoss: 10 },
    chaseBug: { checkTarget: 12, successNeedMajority: true },
    bounty: { runeReward: 3, knowledgeGatherDie: 1, knowledgeGatherFace: 1 },
  };

  // ---- 発狂地帯：多步驟資料 ----
  // 對照event_rulebook.js「発狂地帯」（322頁）完整本文：
  //   →狂い火／行為判定：〈12|任意の判定値〉（玩家自選判定值，因此statKey為"any"）。
  //     成功者「発狂：2D」、失敗者「発狂：3D」。
  //   →狂い火の塔2／行為判定：同樣是〈12|任意の判定値〉、成功2D／失敗3D
  //     （與「狂い火」步驟的判定內容完全相同，是規則書中重複出現的第二次判定）。
  //   →狂い火の塔3／行為判定：依序進行〈協力11×PC人数|運試し〉〈協力11×PC人数|
  //     フィジカル〉〈協力11×PC人数|メンタル〉三個協力判定，成否不影響是否繼續
  //     （事件必定結束），但成功次數決定後續獎懲：
  //       成功2回以上：潜在する力★★×2 → 発狂:2D
  //       成功1回：潜在する力★★×2 → 発狂:3D
  //       すべて失敗：発狂:3D → タイムロス:1
  //     （後續獎懲文字交由midnight.js依rulebook body呈現，此處只保留判定用的數值）
  var MADNESS_ZONE_STEPS = {
    madFire1: { checkTarget: 12, statKey: "any", successMadness: "2D", failMadness: "3D" },
    tower2: { checkTarget: 12, statKey: "any", successMadness: "2D", failMadness: "3D" },
    tower3: { checks: [{ stat: "luck", target: 11 }, { stat: "physical", target: 11 }, { stat: "mental", target: 11 }] },
  };

  window.PriTestMidnightRandomEvents = {
    rollChestTable: rollChestTable,
    rollChestTableThreeTimes: rollChestTableThreeTimes,
    rollAmbushTable: rollAmbushTable,
    insectSwarmSteps: INSECT_SWARM_STEPS,
    madnessZoneSteps: MADNESS_ZONE_STEPS,
  };
})();
