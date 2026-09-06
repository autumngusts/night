// ============================================================================
// midnight（即時制擴張版・技術驗證片）主邏輯。
// ============================================================================
// 這是技術驗證片，範圍見docs之外另存的規劃紀錄（本次milestone明確排除：任何實際戰鬥
// 數值/傷害公式/角色卡整合，只驗證「canvas+rAF連續渲染＋即時移動同步＋
// 縮圈錨點計時＋共享數值用RTDB transaction()原子操作」這幾個技術風險點）。
// 簡易測試改版：地圖改用固定佈局（見midnight_map.js），seed用來決定地圖上的點位置、
// 三天縮圈時間軸（Day1／Day2各自的開始地點與兩階段終點）。
//
// 三天階段改版（2026-09-04）：沿用使用者在photo/midnight/map_origin_annotated.png上
// 第二輪標註（A＝開始地點、Z＝黃金樹之帳候選、F＝靈鳥）描出的固定資料
// （midnight_map.js的A_CANDIDATES／Z_CANDIDATES／SPIRIT_BIRD_LINKS／assignDayPlan()）。
// 只有前兩天在這張地圖上進行，每天各有兩個縮圈階段（開放→縮到3倍徑中繼圓→暫停→
// 縮到終點小圓），第三天（夜之王決戰）與地圖無關，這裡不實作、只顯示提示文字。
// 秒數（20秒×4段）是使用者明確註記的「未來會調整」佔位值，不是最終數值。
//
// 跟night.js完全分開的獨立state／Firebase資料路徑（games/{gameId}/rtState/...，
// 不是night專屬的nightState/characters），刻意不重用night.js的回合制/DOM格子渲染
// pattern——見規劃紀錄，這裡的地圖是自由座標＋canvas，跟night固定9格棋盤是不同量級的東西。
(function () {
  "use strict";

  var Map_ = window.PriTestMidnightMap;
  var GameStorage = window.PriTestGameStorage;
  // 2026-09-05武器資料真正接入新增：直接呼叫character_drawer.js/weapons.js既有的純函式
  // （computeWeaponDamage／computeArtPower／各種skill威力解析／parseAttackCost等），不重寫
  // 一套新的傷害/消耗規則。night.js（回合制）本身不會被載入這個頁面（見site_src/
  // midnight_page.py的extra_scripts），它內部的renderCombatAttackAction等函式也未掛在任何
  // window.*命名空間，因此無法沿用——這裡只重用character_drawer.js真正exported出來的部分。
  var Weapons = window.PriTestWeapons;
  var CharacterDrawer = window.PriTestCharacterDrawer;

  var GRID = Map_.GRID_SIZE;
  var CELL = Map_.CELL_PX;
  var MOVE_SPEED = 2.25; // 每秒移動幾格（世界座標）。2026-09-06使用者明確要求「一般移動速度減慢0.5倍」，
  // 原值4.5的一半；靈鳥自動飛行速度＝MOVE_SPEED*SPIRIT_BIRD_SPEED_MULT（見下方），因此跟著等比例變慢，
  // 不需要另外調整SPIRIT_BIRD_SPEED_MULT本身。
  var POS_PUSH_INTERVAL_MS = 100; // 位置節流：本地移動即時反應，但只用10Hz的頻率把座標寫進RTDB
  var DAMAGE_TICK_MS = 1000; // 圈外每1秒扣1點demo存活值
  var LERP_FACTOR = 0.25; // 遠端圖標插值平滑係數（每影格往目標位置靠近的比例）

  // ---- 三天縮圈時間軸（佔位秒數，使用者已註記「未來會調整」）----
  // 每個階段（phase A／phase B）依序是：開放（grace）→ 慢慢縮到3倍徑中繼圓（shrink1，
  // 圓心是該階段的midCenter，不是最終目的地Z）→ 暫停不動（hold）→ 再慢慢縮到終點小圓／
  // 黃金樹之帳（shrink2，圓心跟半徑同時從midCenter／MID_RADIUS內插到Z／FINAL_RADIUS）。
  // phase B開始時全地圖重新開放（半徑回到FULL_RADIUS），走一次一樣的四段結構，只是終點
  // 換成另一個Z。
  //
  // Day1／Day2的phase B都不會自動結束：縮到終點小圓後就停在那裡（stage="waitingForDay2"
  // ／"waitingForDay3"），要等玩家按下對應按鈕（寫入meta.day2StartAt／day3StartAt）才會
  // 繼續——見currentPhaseInfo()。這樣GM／玩家可以控制節奏，不會縮完就自動跳下一天。
  var PHASE_GRACE_MS = 20000;
  var PHASE_SHRINK1_MS = 35000; // 使用者要求「第一階段的縮圈速度可以再慢一些」，比其他三段長
  var PHASE_HOLD_MS = 20000;
  var PHASE_SHRINK2_MS = 20000;
  var PHASE_TOTAL_MS = PHASE_GRACE_MS + PHASE_SHRINK1_MS + PHASE_HOLD_MS + PHASE_SHRINK2_MS;
  var FULL_RADIUS = Map_.FULL_RADIUS;
  var MID_RADIUS = Map_.MID_RADIUS;
  var FINAL_RADIUS = Map_.FINAL_RADIUS;

  // ---- 靈鳥（F）----
  var SPIRIT_BIRD_ACTIVATE_RADIUS = 1.5; // 玩家離F點多近才能使用
  var SPIRIT_BIRD_SPEED_MULT = 2; // 自動飛行速度＝一般移動速度的幾倍

  // ---- 角色資源／即時制戰鬥（2026-09-05新增，數值來源見使用者聊天訊息明確提供的規格：
  // 體力基礎100/100、每秒回復+2、普通攻擊消耗15（第3擊消耗20且傷害1.5倍，判定窗口1秒）、
  // 戰技消耗25、迴避消耗10、防禦成功消耗5且長按中不回復。體力是本地端連續變化的資源
  // （不透過RTDB同步——跟stamina這種每影格都可能變動的數值，比照這個repo「60Hz送RTDB
  // 太貴太慢」的既有結論，不適合網路同步；只有自己需要看到自己的體力條），HP則沿用既有
  // demoStat/{tokenId}機制（已經是這次milestone驗證過的transaction()同步值，直接當作HP
  // 使用，不重新發明第二套HP欄位）。----
  var STAMINA_MAX = 100;
  var STAMINA_REGEN_PER_SEC = 5; // 2026-09-05 HUD優化：使用者明確要求從2改成5
  var ATTACK_COMBO_WINDOW_MS = 1000; // 連擊判定窗口
  var STAMINA_COST_DODGE = 10;
  // 2026-09-05武器資料真正接入：一般攻擊/戰技/魔術祈禱/防禦的傷害與體力/FP/HP消耗，
  // 全部改用CharacterDrawer.computeWeaponDamage／parseAttackCost／parseActionCost／
  // parseGuardCost等實際武器資料計算（見computeSideAttackInfo／computeMidnightSkillCost／
  // currentGuardInfo），空手或武器缺失資料時直接隱藏/禁用對應按鈕，不再有demo佔位常數。
  // 角色專屬〔技藝〕〔技能〕的傷害（原本借用這裡的demo常數）已於2026-09-05角色能力
  // 真正接入改為computeCharacterAbilityDamage()實際解析，不再需要這個佔位常數。

  // ---- 骰子點數→即時制資源消耗的換算率（2026-09-05使用者明確規格）：一般攻擊/戰技/
  // 防禦的「骰子成本」（CharacterDrawer.parseAttackCost/parseActionCost/parseGuardCost
  // 解析出的骰子成本，見下方diceCostPoints()）換算成體力＝×2；戰技/魔術/祈禱本文
  // 「FP■■」「HP■■」中■的個數（parseActionCost.fpCost/hpCost，這是既有解析結果，
  // 不是自行發明的數字）換算成FP/HP消耗＝×10。----
  var DICE_COUNT_TO_STAMINA_MULT = 2;
  var BLOCK_SQUARE_COUNT_TO_RESOURCE_MULT = 10;

  // 2026-09-06優化（使用者明確規格「第一天的縮圈若已經到最小時，若有任一玩家進入了該圈內，
  // 則資訊欄中系統自動倒數讀條10s，接著抽選第一天夜之強敵後進入戰鬥。擊退敵人後系統讀條
  // 10s後自行開啟第二天」）：見updateFinalCircleBoss()／updateAutoDayAdvance()。2026-09-06
  // 三次優化：使用者明確規格改成「總計時10秒後才正式開始第二天倒計時」，從原本20秒改為10秒。
  var FINAL_CIRCLE_BOSS_COUNTDOWN_MS = 10000;
  var FINAL_CIRCLE_BOSS_DAY_ADVANCE_MS = 10000;
  var GOLDEN_TREE_CARD_ID = "a_golden"; // fields_data_1.jsのカードA「黄金樹の帳」，「夜の強敵決定表」附著在這張卡的extraTables

  // CharacterDrawer.parseAttackCost/parseActionCost/parseGuardCost回傳的骰子成本物件中，
  // "sum"類型（①②③圈字組合，武器攻擊/戰技最常見的表示法）的diceCountMin固定是1（代表
  // 「最少1顆骰子就可能滿足這個組合」，是驗證骰子選擇用的欄位，不是「這個成本相當於幾
  // 點」——例如"①"跟"①①"的diceCountMin都是1，但後者顯然成本更高）。真正隨組合變重的是
  // sumTotal（圈字數字加總）。"same"/"straight"類型（ゾロ(N)／連番(N)）沒有sumTotal，
  // 這時diceCountMin本身就是實際骰子顆數，直接當點數使用沒有問題。這裡統一取「骰子
  // 點數」：sum類型用sumTotal，其餘類型用diceCountMin。
  function diceCostPoints(part) {
    if (!part || !part.diceKind) return 0;
    return part.diceKind === "sum" ? part.sumTotal || 0 : part.diceCountMin;
  }

  // ---- 戰技B（魔術／祈禱，2026-09-05 HUD優化新增）：長按確定施放，消耗FP而非體力。
  // FP不自動回復——使用者沒有提供回復規則，依CLAUDE.md §19原則不猜測，之後有正式規則書
  // 數值時再補。長按時間2秒是使用者明確規格。----
  var SORCERY_CAST_HOLD_MS = 2000;

  // ---- 屬性/狀態異常共同蓄積（2026-09-05武器資料真正接入新增，見docs/enemy_damage_rules.md
  // §7）：使用者明確規格「拉長為需要2倍」，基本閾值8→16。弱點閾值（規則書6點）本計畫暫不
  // 實作（midnight目前沒有把地圖敵人與enemies_data_*.js的弱點資料接起來的既有管道，不自行
  // 發明弱點判定，全部敵人一律用基本閾值）。----
  var ATTRIBUTE_STATUS_THRESHOLD = 16;
  var ATTRIBUTE_STATUS_ELEMENT_NAMES_JA = ["魔", "炎", "雷", "聖"];
  var ATTRIBUTE_STATUS_AILMENT_NAMES_JA = ["猛毒", "腐敗", "出血", "凍傷", "発狂", "睡眠", "呪死"];
  var FLASK_READ_MS = 1000; // 聖杯瓶按下到確定使用的讀取時間，使用者明確規格（2026-09-06優化改為1.0秒）

  // ---- 敵人屬性攻擊（2026-09-06角色能力真正接入・不撓前置工程新增，使用者明確規格：
  // 「敵人結構化資料應要帶有屬性，否則則將原規則書敵人的屬性攻擊紀錄起來」）：稽核後確認
  // enemies_data_1~4.js的每隻敵人已有actions[]（規則書「アクション決定表」轉錄），每個
  // action.note是規則書原文，其中會直接寫明「屬性名:數值」或「屬性名:XD」（例如
  // 「炎:1D」「猛毒:2」）——這是既有的規則書轉錄文字，不是自己新增或猜測的資料，只是
  // 之前沒有程式碼去解析它。這裡只解析actions[]（每次骰到該roll就會發生的攻擊本體），
  // 刻意不解析special欄位（那裡常是「條件發揮」的被動效果，例如「溶岩の滞留（条件発揮）」，
  // 條件是否成立無法自動判定，貿然套用會變成憑空發明觸發時機，違反CLAUDE.md §19）。
  var ENEMY_ATTACK_ATTRIBUTE_NAMES = ["炎", "雷", "聖", "魔", "猛毒", "腐敗", "出血", "凍傷", "発狂", "發狂", "睡眠", "呪死"];

  // 「發狂」是「発狂」的zh表記，蓄積bucket統一用ja「発狂」當key（跟ATTRIBUTE_STATUS_
  // AILMENT_NAMES_JA既有清單一致），避免同一個異常因為文字語言不同被拆成兩個bucket。
  function normalizeAttributeLabel(label) {
    return label === "發狂" ? "発狂" : label;
  }

  // 2026-09-06數值真正接入時修正的既有bug：這裡原本掃描action.note，但實際核對
  // enemies_data_1~4.js資料後發現「屬性名:數值」標記其實寫在action.mod欄位
  // （例："＋120＆「炎:1D」"），note裡完全沒有這個格式（已用grep驗證0命中），導致這個
  // 函式形同虛設。改成掃描mod（note備用），並用global regex取出「這一招」全部的屬性標記
  // （一招可能同時附帶多個，例如"＋120＆「魔:1D」＆「雷:1D」＆「凍傷:1D」"），不再是
  // 「掃全部actions[]再隨機挑一個」的demo佔位做法——現在敵人攻擊已經真的先選定唯一一招
  // （見pickEnemyAction()），這裡只需要解析「這一招」實際附帶的屬性。
  function parseElementalAttacksFromAction(action) {
    var found = [];
    if (!action) return found;
    var texts = [(action.mod && action.mod.ja) || action.mod || "", (action.note && action.note.ja) || "", (action.note && action.note.zh) || ""];
    var re = new RegExp("(" + ENEMY_ATTACK_ATTRIBUTE_NAMES.join("|") + ")[:：]\\s*(\\d+)D?", "gi");
    texts.forEach(function (text) {
      var m;
      re.lastIndex = 0;
      while ((m = re.exec(String(text)))) {
        found.push({ label: normalizeAttributeLabel(m[1]), value: parseInt(m[2], 10) });
      }
    });
    return found;
  }

  // 玩家自身受到的屬性/異常蓄積：跟現有attributeAccum（PC→敵人方向）是分開的本地only
  // 狀態（不需要跨玩家同步，只有自己需要知道自己承受了多少），沿用同一套
  // ATTRIBUTE_STATUS_THRESHOLD／異常觸發後歸零・屬性觸發後保留超額的規則
  // （docs/enemy_damage_rules.md §7.3/§7.4，跟maybeTriggerAttributeAccum同一套規則，
  // 只是方向相反、只追蹤自己一人）。
  var receivedAttributeAccum = {}; // name(已正規化為ja) -> number
  var receivedAttributeAccumTriggeredCount = {};

  function recordReceivedAttributeAccum(rawLabel, amount) {
    var name = normalizeAttributeLabel(rawLabel);
    var next = (receivedAttributeAccum[name] || 0) + amount;
    receivedAttributeAccum[name] = next;
    var isAilment = ATTRIBUTE_STATUS_AILMENT_NAMES_JA.indexOf(name) !== -1;
    var prevCount = receivedAttributeAccumTriggeredCount[name] || 0;
    var newCount = Math.floor(next / ATTRIBUTE_STATUS_THRESHOLD);
    if (newCount <= prevCount) return;
    receivedAttributeAccumTriggeredCount[name] = newCount;
    for (var i = prevCount + 1; i <= newCount; i++) triggerUnyieldingStackIfApplicable();
    if (isAilment) {
      receivedAttributeAccum[name] = 0;
      receivedAttributeAccumTriggeredCount[name] = 0;
    }
  }

  // 不撓（執行者/執行者暗影被動，2026-09-06角色能力真正接入新增）：每當自身受到的屬性/
  // 異常蓄積值達到閾值並觸發時，取得1個永久堆疊（直到encounter結束歸零，見
  // onEncounterEnded），消費見unyieldingHitBonus/unyieldingSkillBonus等價的疊加點
  // （fightingSpiritFlatBonus旁的flatBonus注入點，Phase1/computeMidnightSkillDamage
  // 已有的加成疊加位置）。
  function triggerUnyieldingStackIfApplicable() {
    var c = characters[myTokenId];
    var type = c && c.typeId ? window.PriTestCharacterTypes.get(c.typeId) : null;
    var hasUnyielding =
      type &&
      (type.abilities || []).some(function (a) {
        return a.id === "unyielding";
      });
    if (!c || !hasUnyielding) return;
    var next = (c._unyieldingStacks || 0) + 1;
    c._unyieldingStacks = next;
    GameStorage.rtSet(gameId, "cloud", "character/" + myTokenId + "/_unyieldingStacks", next);
    var CharacterTypes = window.PriTestCharacterTypes;
    var ability = type.abilities[0];
    showToast(CharacterTypes.localizedText(ability.name) + "：" + window.I18N.t("midnight_unyielding_stack_note", { count: next }));
  }

  // 不撓堆疊的實際傷害加成（比照night.js:5078-5084的stacks×5/10/10公式，
  // hit1/hit2為武器攻擊、skill為技藝/技能/戰技通用）。
  function unyieldingHitBonus(c) {
    var stacks = (c && c._unyieldingStacks) || 0;
    return { hit1: stacks * 5, hit2: stacks * 10 };
  }
  function unyieldingSkillBonus(c) {
    return ((c && c._unyieldingStacks) || 0) * 10;
  }

  // ---- 敵人攻擊（2026-09-05再新增，只在「同一板塊、同一籌碼事件」下才同步，也就是
  // activeEncounter／fieldTrigger存在時才會發動，跟沒有板塊概念的demoStat/sharedTarget
  // 共用標靶無關）。數值來源：使用者聊天訊息明確給的機率／秒數，加上事前用
  // AskUserQuestion跟使用者確認過的三個設計決定：
  //   ①「敵視」判定＝目前對這隻敵人造成最多累積傷害的參與者（這個技術驗證片沒有既有
  //     仇恨值/威脅值系統，使用者選擇不新增一套，直接沿用傷害量最簡單判定）。
  //   ②攻擊觸發＝敵人存活期間，每次攻擊結束後隨機等待2~4秒再發動下一次。
  //   ③「多名一起攻擊」鎖定人數＝2人或3人都有可能（使用者原話：「2人3人都有可能」）。
  // 目標選擇的三層機率權重、每次攻擊造成的傷害量，使用者都沒有給實際數字，這裡先用
  // demo佔位權重／傷害值（見下方個別常數註解），之後有正式規則書數值時應直接取代。----
  var ENEMY_ATTACK_INTERVAL_MIN_MS = 2000;
  var ENEMY_ATTACK_INTERVAL_MAX_MS = 4000;
  var ENEMY_ATTACK_WARN_MS = 500; // 使用者明確規格：警示圖示閃爍0.5秒後才開始攻擊
  var ENEMY_ATTACK_HIT_WINDOW_MS = [2000, 2500, 3000]; // 反應時限（單次攻擊事件固定用第0段＝2秒）
  // 2026-09-06數值真正接入：不再用demo佔位機率決定打誰/打幾下，改成先從敵人實際
  // 「アクション決定表」（enemy.actions[]）抽出一招，依該招敘述判斷是個別傷害（1人）
  // 還是亂戰傷害（1~3人），見pickEnemyAction()/resolveEnemyActionOutcome()。因此
  // 舊有的ENEMY_ATTACK_TARGET_WEIGHT_*／ENEMY_ATTACK_HIT_COUNT_WEIGHTS／ENEMY_ATTACK_DAMAGE
  // 三組demo佔位常數已移除，一次攻擊事件固定只有1次命中判定（hitCount=1）。
  var ATTACK_EFFECT_DISPLAY_MS = 400; // 刀光特效顯示時間，純視覺用
  var ENEMY_HIT_EFFECT_DISPLAY_MS = 300; // 玩家命中敵人的刀光特效顯示時間，純視覺用，跟上面敵人打玩家的特效各自獨立
  var FP_BASE = 10; // 使用者明確規格：FP基礎10，疊加方式與HP相同（見selfFpMax()）
  var FLASK_MAX_DEFAULT = 3;
  var FLASK_HEAL_AMOUNT = 30;
  var TOWER_ACTIVATE_RADIUS = 1.5; // 沿用SPIRIT_BIRD_ACTIVATE_RADIUS同樣的數值
  var TOWER_PUZZLE_TIME_LIMIT_MS = 30000; // 使用者指定「預計要解30秒程度」
  var TOWER_REWARD_RUNES = 50;

  // ---- 角色面板持有量上限（2026-09-05角色面板優化新增，使用者明確規格：「6格武器欄
  // 4格消耗品欄 2格裝飾品欄」＋確認過這是硬性上限，超過需先丟棄才能撿新的）----
  var WEAPON_SLOT_COUNT = 6;
  var CONSUMABLE_SLOT_COUNT = 4;
  var TALISMAN_SLOT_COUNT = 2;
  var GROUND_ITEM_PICKUP_RADIUS = 1.5; // 沿用TOWER_ACTIVATE_RADIUS同量級

  // 持有量是否還有空間可以再拿一個（kind: "weapon"|"consumable"|"talisman"）。消耗品
  // 用「不同itemId視為佔一格」計算（c.consumables是instance陣列，同一itemId可能疊加
  // usesRemaining，但規格是「4格消耗品欄」＝4種，不是4個instance——跟角色面板要顯示
  // 4格卡片的介面一致）。
  function inventoryOccupiedCount(c, kind) {
    if (kind === "weapon") return (c.weaponIds || []).length;
    if (kind === "talisman") return (c.talismanIds || []).length;
    if (kind === "consumable") return (c.consumables || []).length;
    return 0;
  }

  function inventorySlotLimit(kind) {
    if (kind === "weapon") return WEAPON_SLOT_COUNT;
    if (kind === "talisman") return TALISMAN_SLOT_COUNT;
    if (kind === "consumable") return CONSUMABLE_SLOT_COUNT;
    return Infinity;
  }

  function hasInventorySpace(c, kind) {
    if (!c) return false;
    return inventoryOccupiedCount(c, kind) < inventorySlotLimit(kind);
  }

  // ---- 地圖點卡牌事件（2026-09-05新增，2026-09-06依使用者更精確的規格改版）----
  // 流程：靠近地圖上的點（sorcerer／魔術師塔除外，已有自己的解謎流程）→顯示地點名稱＋
  // 「進入」按鍵→按下後向附近玩家發出3秒邀請→邀請結束後（不論誰真的加入了）正式進入、
  // 參與者一同等待0.5秒→打字機顯示樓層【描寫】敘述→從敘述文字中偵測規則書既有的
  // 「（→XXX）」分歧標記當投票選項→只有「目前在同一卡牌事件的參與者」需要選擇同一項才
  // 確定，10秒未達成共識則由系統決定→敵人指派：從確定選中的那個分歧段落文字裡，用
  // 跟static_src/night_gm_flow.js完全相同的解析（parseCombatEnemyRef／
  // resolveCombatEnemyMatch）比對出static_src/enemies_data_1~4.js既有資料裡對應的敵人
  // （night既有GM流程本來就是這樣認定「這個板塊會遇到哪隻敵人」的，這裡直接重用同一套
  // 解析邏輯，不是自己另外亂數選一隻）。
  // 地點名稱／樓層敘述／分歧標記／敵人引用全部直接讀static_src/fields_data_1~4.js既有的
  // 規則資料（window.PriTestFields），不是自己另外編寫的文字——只有「靠近才顯示進入
  // 按鍵」「邀請共同進入」「全體參與者投票才執行」「遇敵沿用即時戰鬥雛形」這幾個流程
  // 本身是這次新增的示範機制，不是規則書內容。打字機效果直接重用
  // window.PriTestNightGmFlow.typewriteInto（跟night.js既有GM敘述用的是同一個函式）。----
  // 2026-09-06使用者回報「卡片及籌碼進入的範圍可以再縮小,免得靠近時多重判斷」：地圖上
  // 點與點之間距離較近時，半徑2會同時落在兩個點的判定範圍內，導致提示互相搶顯示／
  // proximity判斷不穩定。縮小成1.6（原本的80%），保留「比TOWER/SPIRIT_BIRD
  // （皆為1.5）略大」的既有關係與「不用整格對齊也能觸發」的容錯，同時降低跟鄰近點
  // 重疊的機率。
  var FIELD_TRIGGER_RADIUS = 1.6; // 「靠近」的判定半徑，比TOWER/SPIRIT_BIRD略大——這類點的卡片圖示本身較大
  var FIELD_INVITE_RADIUS = FIELD_TRIGGER_RADIUS; // 「地圖一定小周圍附近」的邀請範圍，沿用同一個靠近半徑
  var FIELD_INVITE_TIME_LIMIT_MS = 3000; // 使用者明確規格：邀請時限3秒
  var FIELD_ENTER_WAIT_MS = 500; // 使用者明確規格：正式進入後一同等待0.5秒才開始敘述
  var FIELD_VOTE_TIME_LIMIT_MS = 10000; // 使用者明確規格：分歧意見不一致的等待時間10秒，逾時交給系統決定
  // 2026-09-06數值真正接入：敵人HP不再用demo佔位固定值30，改成「實際hp格數x10」
  // （見enemyRealHpMax()，讀enemies_data_*.jsのfamily.base[level-1].hp既有格數字串）。
  // 找不到資料（極少數缺漏或尚未指派敵人）時才退回這個保底值，避免顯示0/0。
  var FIELD_ENEMY_HP_FALLBACK = 30;
  // 雜兵單位HP（2026-09-06死靈術前置工程新增，使用者明確規格：「雜兵血量即為格子數x10」，
  // 格子數＝night_gm_flow.js既有parseCombatEnemyRef()解析出的「+雜兵N」後綴N）。
  var MOB_HP_PER_ROW = 10;
  var GUARD_BREAK_RECOVER_MS = 5000; // 使用者明確規格：Guard Point扣到0後，5秒後回復原本的Guard Point
  var GUARD_REDUCTION_THRESHOLD = 3; // 使用者明確規格：▲(0.5)/◆(1)每集滿3點，Guard Point-1
  var ART_COOLDOWN_MS = 180000; // 使用者明確規格：技藝冷卻180秒
  var SKILL_COOLDOWN_MS = 60000; // 使用者明確規格：技能冷卻60秒

  // ---- 強敵籌碼擊殺獎勵（2026-09-05新增，數值取自event_rulebook.jsのstrong_enemy
  // chip文字「撃破ルーン：8」「潜在する力：★★」，1日目/一般值；不做2日目「恐るべき
  // 強敵」的12盧恩/★★★區分，見規劃紀錄）----
  var STRONG_ENEMY_REWARD_RUNES = 8;
  var STRONG_ENEMY_REWARD_POTENTIAL_STARS = 2;

  // ---- 標點（ping）----
  var PING_DISPLAY_MS = 6000; // 標點顯示幾毫秒後自動消失（本地渲染端判斷，不刪RTDB資料）
  var LONG_PRESS_MS = 500; // 長按判定門檻

  // ---- 圈外遮罩／下雨特效 ----
  var RAIN_DROP_COUNT = 140;
  var RAIN_FALL_SPEED = 260; // px/秒
  var rainDrops = null; // 延遲到canvas尺寸確定後才初始化（見initRainDrops）

  // ---- 遊戲創建／等待房／斷線重連／接管 ----
  // 一局遊戲最多3個玩家「席位」（players/1~3），每個席位有名稱／角色／4位數重連密碼／
  // 目前控制此席位的tokenId／是否已準備。等待房裡先選好這些資訊、按下準備，全部已佔用
  // 席位都準備後才開始5秒倒數。超過3人自動變成觀戰（沒有席位、不能移動/攻擊/標點/用
  // 靈鳥）。斷線或重開頁面後，任何人（包含觀戰者）只要輸入該席位的密碼，就能把tokenId
  // 改成自己的、接手繼續操作——密碼本身也存在RTDB裡（沒有另外雜湊），這跟admin密碼
  // (games.js)一樣是低風險示範用途，不是正式帳號系統。
  var MAX_PLAYERS = 3;
  var READY_COUNTDOWN_MS = 5000;
  var RESUME_COUNTDOWN_MS = 3000;

  // 角色選項直接沿用static_src/character_types.js既有的20個「night」角色（10個基礎＋
  // 10個變體：xxx_dark／xxx_dawn，id/name欄位都照抄character_types.js，不是自己另外
  // 發明的名字）——這次只借用名稱＋頭像圖片當等待房的角色選擇＋地圖上圖標的視覺識別，
  // 數值/技能等實際角色卡整合明確仍不在這次milestone範圍內（見檔案開頭說明），之後若
  // 要接上真正數值，直接以這份對照表為基礎擴充即可，不需要重新設計選角UI。
  // 頭像圖片：character_types.js原本的c1~c10.jpg每張都畫了兩個人（左＝基礎、右＝變體，
  // 使用者確認過這個排版規律），單張直接當縮圖沒辦法分辨基礎/變體。已用
  // static_src/images/characters/midnight/裁切成c{n}_base.jpg／c{n}_variant.jpg
  // （見photo無關、純粹是把原圖對半切開，沒有改動character_types.js自己用的原圖），
  // 這裡的image只存檔名，實際路徑組裝見characterImagePath()。
  var CHARACTER_PRESETS = [
    { id: "tracker", nameKey: "midnight_character_tracker", image: "c1_base.jpg", color: "#5ecb7d" },
    { id: "tracker_dark", nameKey: "midnight_character_tracker_dark", image: "c1_variant.jpg", color: "#5ecb7d" },
    { id: "guardian", nameKey: "midnight_character_guardian", image: "c2_base.jpg", color: "#7fb2ff" },
    { id: "guardian_dawn", nameKey: "midnight_character_guardian_dawn", image: "c2_variant.jpg", color: "#7fb2ff" },
    { id: "iron_eye", nameKey: "midnight_character_iron_eye", image: "c3_base.jpg", color: "#e0664c" },
    { id: "iron_eye_dark", nameKey: "midnight_character_iron_eye_dark", image: "c3_variant.jpg", color: "#e0664c" },
    { id: "lady", nameKey: "midnight_character_lady", image: "c4_base.jpg", color: "#f2c14e" },
    { id: "lady_dawn", nameKey: "midnight_character_lady_dawn", image: "c4_variant.jpg", color: "#f2c14e" },
    { id: "ruffian", nameKey: "midnight_character_ruffian", image: "c5_base.jpg", color: "#c78af0" },
    { id: "ruffian_dark", nameKey: "midnight_character_ruffian_dark", image: "c5_variant.jpg", color: "#c78af0" },
    { id: "avenger", nameKey: "midnight_character_avenger", image: "c6_base.jpg", color: "#57c7c0" },
    { id: "avenger_dark", nameKey: "midnight_character_avenger_dark", image: "c6_variant.jpg", color: "#57c7c0" },
    { id: "hermit", nameKey: "midnight_character_hermit", image: "c7_base.jpg", color: "#e08fd0" },
    { id: "hermit_dawn", nameKey: "midnight_character_hermit_dawn", image: "c7_variant.jpg", color: "#e08fd0" },
    { id: "executor", nameKey: "midnight_character_executor", image: "c8_base.jpg", color: "#9aa8ff" },
    { id: "executor_dark", nameKey: "midnight_character_executor_dark", image: "c8_variant.jpg", color: "#9aa8ff" },
    { id: "scholar", nameKey: "midnight_character_scholar", image: "c9_base.jpg", color: "#ffb35c" },
    { id: "scholar_dark", nameKey: "midnight_character_scholar_dark", image: "c9_variant.jpg", color: "#ffb35c" },
    { id: "undertaker", nameKey: "midnight_character_undertaker", image: "c10_base.jpg", color: "#8fd15c" },
    { id: "undertaker_dawn", nameKey: "midnight_character_undertaker_dawn", image: "c10_variant.jpg", color: "#8fd15c" },
  ];

  var players = {}; // slot("1"|"2"|"3") -> { name, characterId, passcode, tokenId, ready }
  var mySlot = null; // 1~3：我目前控制的席位；null＝觀戰
  var selectedCharacterId = CHARACTER_PRESETS[0].id; // 等待房表單目前選的角色
  var pendingJoinSlot = null; // 目前正在填寫加入表單、鎖定要送出的目標席位（見renderLobby()的說明）
  var countdownTriggerAttempted = false; // 避免每個影格都重複送出開始倒數的transaction
  var sessionStartTriggerAttempted = false;
  var resumeFinalizeAttempted = false;

  var gameId = null;
  var myTokenId = null;
  var myName = null;
  var map = null;
  var meta = null; // { mapSeed, sessionStartAt }
  var localPos = null; // { x, y } 本地即時座標（自己的token，zero-latency）
  var remoteTokens = {}; // tokenId -> { x, y, name, color, updatedAt }（來自RTDB）
  var renderedRemotePos = {}; // tokenId -> { x, y }（插值後、實際畫在畫面上的座標）
  var demoStats = {}; // tokenId(或"sharedTarget") -> number（HP，見上方註解）

  // 自身即時戰鬥HP的{current,max}表示（2026-09-05角色能力真正接入新增）：給
  // CharacterDrawer.fightingSpiritFlatBonus／talismanFlatSkillBonus的hpOverride參數用
  // （這兩個函式原本讀c.hp，但c.hp在midnight代表的是等級養成用的RPG血量上限，
  // 跟這裡的競技場demoStat是不同刻度，見computeCharacterAbilityDamage()的同款說明）。
  // 2026-09-06數值真正接入：即時制HP上限不再固定100，改成使用者明確規格「血量為基礎100
  // 再加上初期HPx10,升級造成的HP上升也疊加上去」。c.hp.max已經是「type初期值＋升級加點」
  // 加總後的RPG量表數字（character_drawer.jsのnewCharacter()／applyLevelUpResourceBonus()），
  // 另外疊加塔利斯曼/遺物/附加效果的totalFlatMaxStatBonus（既有三套bonus系統，CLAUDE.md §12），
  // 跟現有FP上限公式（selfFpMax()）採同一套疊加方式。角色未知（尚未載入）時退回基礎100。
  function selfArenaHpMax(c) {
    if (!c || !c.hp) return 100;
    return 100 + (c.hp.max + CharacterDrawer.totalFlatMaxStatBonus(c, "hp")) * 10;
  }
  function selfArenaHp() {
    var max = selfArenaHpMax(characters[myTokenId]);
    var current = demoStats[myTokenId];
    return { current: current === undefined ? max : current, max: max };
  }
  // demoStat/{myTokenId}的transaction() cur===null（尚未有任何紀錄）時的滿血預設值——
  // 這種情況下characters[myTokenId]理應已經是自己實際角色資料（不是剛加入的瞬間），
  // 直接用selfArenaHpMax()算，取代原本寫死的100。
  function mySelfHpMaxFallback() {
    return selfArenaHpMax(characters[myTokenId]);
  }
  // FP基礎10，疊加方式與HP相同（使用者明確規格）。
  function selfFpMax(c) {
    if (!c || !c.fp) return FP_BASE;
    return FP_BASE + (c.fp.max + CharacterDrawer.totalFlatMaxStatBonus(c, "fp")) * 10;
  }

  // 測試模式倍率（2026-09-06新增，見meta.testTuning／renderTestPanel()）：直接讀meta
  // （已經是既有的「收到就更新本地變數」reactive pattern，不需要另外維護一份本地副本），
  // 非測試模式或尚未設定時一律視為1（不影響任何計算）。
  function testMult(key) {
    var v = meta && meta.testTuning && meta.testTuning[key];
    return typeof v === "number" ? v : 1;
  }

  // ---- 房間設定（2026-09-06優化，使用者明確規格：「一開始創立房間後，能選擇一些房間
  // 設定：[夜王]第三天的最終夜王，night中的10隻夜王可選擇（同時會根據night中的抽選表
  // 等等影響劇本的走向）；[地圖]基本版/完整版（目前完整版不能選）」）：直接重用
  // static_src/scenarios.js既有的10個劇本（每個劇本固定對應一個bossId，跟
  // night_gm_flow.js「夜の強敵決定表」查表用的劇本編號是同一份資料，見
  // resolveNightBossScenarioId()／maybeStartFinalCircleBoss()），不新增第二套劇本資料。
  // meta.nightBossId：玩家在房間設定選的劇本id，空字串＝尚未選/交給隨機決定；
  // meta.resolvedNightBossId：開局那一刻（跟sessionStartAt同一次transaction()）真正
  // 確定的劇本id——選了具體夜王就是那個id，選隨機則用meta.mapSeed（開局前就已經
  // 全裝置共享的種子）決定性挑一個，所有裝置算出同一個結果，不需要額外協調。
  // meta.mapVariant目前只有"basic"生效，"full"選項UI層級disabled（見midnight_page.py），
  // 保留欄位供未來「完整版：為其他所有地圖抽一張」實作時使用，不在這次範圍內。----
  function nightBossScenarioOptions() {
    var Scenarios = window.PriTestScenarios;
    if (!Scenarios) return [];
    return Scenarios.list()
      .filter(function (s) {
        return Scenarios.numberForId(s.id) !== null; // 排除自訂劇本（沒有規則書編號，也沒有夜の強敵決定表可查）
      })
      .map(function (s) {
        var number = Scenarios.numberForId(s.id);
        var label = Scenarios.localizedName(s.bossName || s.name);
        return { id: s.id, number: number, label: number + ". " + label };
      });
  }

  function resolveNightBossScenarioId() {
    if (meta && meta.resolvedNightBossId) return meta.resolvedNightBossId;
    if (meta && meta.nightBossId) return meta.nightBossId;
    var options = nightBossScenarioOptions();
    if (!options.length) return null;
    return options[(meta.mapSeed || 0) % options.length].id;
  }

  function populateNightBossSelect() {
    var select = el("midnight-lobby-night-boss-select");
    if (!select || select.options.length) return; // 只在第一次populate，避免重建打斷使用者正在操作的下拉選單
    var randomOpt = document.createElement("option");
    randomOpt.value = "";
    randomOpt.textContent = window.I18N.t("midnight_lobby_night_boss_random_option");
    select.appendChild(randomOpt);
    nightBossScenarioOptions().forEach(function (opt) {
      var o = document.createElement("option");
      o.value = opt.id;
      o.textContent = opt.label;
      select.appendChild(o);
    });
  }

  function renderLobbySettings() {
    populateNightBossSelect();
    var bossSelect = el("midnight-lobby-night-boss-select");
    if (bossSelect && document.activeElement !== bossSelect) bossSelect.value = (meta && meta.nightBossId) || "";
    var mapSelect = el("midnight-lobby-map-variant-select");
    if (mapSelect && document.activeElement !== mapSelect) mapSelect.value = (meta && meta.mapVariant) || "basic";
  }

  function handleNightBossSelectChange() {
    GameStorage.rtSet(gameId, "cloud", "meta/nightBossId", el("midnight-lobby-night-boss-select").value);
  }

  function handleMapVariantSelectChange() {
    var v = el("midnight-lobby-map-variant-select").value;
    GameStorage.rtSet(gameId, "cloud", "meta/mapVariant", v === "full" ? "basic" : v); // "full"選項本身已disabled，這裡是防呆
  }

  // ---- 測試模式（2026-09-06新增，使用者明確規格：「開始遊戲可以選擇測試模式，在右邊
  // 可以顯示敵我傷害資訊，甚至可以手動拉條來改變傷害值」）：meta.testMode／
  // meta.testTuning皆透過RTDB同步，同一場遊戲所有人共用同一組開關/倍率（跟本專案既有
  // 「持有gameId即可存取」的權限模型一致，CLAUDE.md §38，不做額外的房主限定）。----
  var lastPcDamageInfo = null; // {amount, at}，本地only，供測試面板顯示
  var lastEnemyDamageInfo = null; // {amount, at}，本地only

  function handleTestModeToggle() {
    var checked = el("midnight-lobby-test-mode-checkbox").checked;
    GameStorage.rtSet(gameId, "cloud", "meta/testMode", checked);
  }

  // 2026-09-06優化：滑桿改成可搭配數字輸入框直接輸入（使用者明確規格「可以直接輸入數字」），
  // 兩個input元素各自綁定同一個commit()，並各自clamp在min/max內，避免手動輸入超出規則
  // 範圍的數字（例如負數）。
  function bindTestSliderInput(sliderId, numberId, key, min, max) {
    function commit(raw) {
      var v = parseFloat(raw);
      if (isNaN(v)) return;
      v = Math.max(min, Math.min(max, v));
      GameStorage.rtSet(gameId, "cloud", "meta/testTuning/" + key, v);
    }
    el(sliderId).addEventListener("input", function () { commit(this.value); });
    var numberEl = el(numberId);
    if (numberEl) numberEl.addEventListener("input", function () { commit(this.value); });
  }

  function renderTestPanel() {
    var enabled = !!(meta && meta.testMode);
    var checkbox = el("midnight-lobby-test-mode-checkbox");
    if (checkbox) checkbox.checked = enabled;
    var panel = el("midnight-test-panel");
    if (!panel) return;
    panel.hidden = !enabled;
    if (!enabled) return;
    [
      ["midnight-test-slider-enemy-hp", "midnight-test-number-enemy-hp", "enemyHpMult"],
      ["midnight-test-slider-enemy-atk", "midnight-test-number-enemy-atk", "enemyAtkMult"],
      ["midnight-test-slider-pc-dmg", "midnight-test-number-pc-dmg", "pcDmgMult"],
      ["midnight-test-slider-enemy-guard", "midnight-test-number-enemy-guard", "enemyGuardValueMult"],
    ].forEach(function (pair) {
      var mult = testMult(pair[2]);
      var slider = el(pair[0]);
      var number = el(pair[1]);
      // 避免使用者正在拖動/輸入時被RTDB回傳的舊值打斷——只在目前不是該元素的active
      // element時才覆寫value（跟其他即時輸入元件的既有節流慣例一致）。
      if (slider && document.activeElement !== slider) slider.value = mult;
      if (number && document.activeElement !== number) number.value = mult;
      var valueEl = el(pair[0] + "-value");
      if (valueEl) valueEl.textContent = "x" + mult.toFixed(1);
    });
    var lastPcEl = el("midnight-test-panel-last-pc");
    if (lastPcEl) {
      lastPcEl.textContent = lastPcDamageInfo
        ? window.I18N.t("midnight_test_last_pc_damage", { amount: lastPcDamageInfo.amount })
        : "";
    }
    // 玩家攻擊力／防禦價值（2026-09-06使用者明確要求「顯示數值可以再增加：玩家攻擊力
    // 防禦價值,敵人防禦價值」）：攻擊力＝lastPcDamageInfo.rawAmount（floor()換算前的
    // 原始總傷害，用來對照下面的敵人防禦價值判斷「為什麼這次沒有造成HP損害」）；
    // 防禦價值＝currentGuardInfo()目前裝備算出的百分比減免（沒有盾牌/雙手持握資格時
    // 顯示"-"，不是0%，避免誤會成「防禦力是0」——見currentGuardInfo()註解）。
    var lastPcDefenseEl = el("midnight-test-panel-last-pc-defense");
    if (lastPcDefenseEl) {
      var guardInfo = currentGuardInfo();
      var defText = guardInfo ? guardInfo.pct + "%" : "-";
      var atkText = lastPcDamageInfo ? lastPcDamageInfo.rawAmount : "-";
      lastPcDefenseEl.textContent = window.I18N.t("midnight_test_pc_atk_defense", { atk: atkText, defense: defText });
    }
    var lastEnemyEl = el("midnight-test-panel-last-enemy");
    if (lastEnemyEl) {
      lastEnemyEl.textContent = lastEnemyDamageInfo
        ? window.I18N.t("midnight_test_last_enemy_damage", { amount: lastEnemyDamageInfo.amount })
        : "";
    }
    var lastEnemyGuardEl = el("midnight-test-panel-last-enemy-guard");
    if (lastEnemyGuardEl) {
      // 2026-09-06改版：HP價值現在代表減傷率（百分比），顯示加上%。
      var guardValText = lastPcDamageInfo && lastPcDamageInfo.hpValue ? Math.round(lastPcDamageInfo.hpValue) + "%" : "-";
      lastEnemyGuardEl.textContent = window.I18N.t("midnight_test_enemy_guard_value", { value: guardValText });
    }
  }
  var remotePings = {}; // tokenId -> { x, y, name, createdAt }（來自RTDB）
  // tokenId -> 完整CharacterDrawer.newCharacter()同形狀角色物件（含runes），外加midnight
  // 原本就有的flaskCount/flaskMax欄位（沿用原本命名，只是併到同一個RTDB物件底下，不是
  // 另開一份，見onCharactersReceived／規劃紀錄「角色屬性管理」章節的設計取捨）。
  var characters = {};
  var towerSolved = {}; // pointId -> { solvedBy }（來自RTDB，見onTowerSolvedReceived）
  // 塔的邀請狀態（2026-09-05籌碼優化新增，使用者明確規格：「魔術師塔...顯示進入選項
  // 進入邀請完後 才會顯示其解謎 任何一個人完成就全員完成能獲得獎勵」）。獨立於
  // fieldTriggers之外自成一份RTDB路徑（不是重用fieldTriggers/{pointId}），因為
  // pt.type==="sorcerer"本來就被NON_FIELD_POINT_TYPES排除在field流程外，混用同一個
  // 路徑容易造成兩套邏輯互相干擾。shape跟fieldTriggers的inviting/active兩階段一致，
  // 只是沒有branchIndex/floorIndex這些field專屬欄位：
  // towerInvites[pointId] = { status:"inviting"|"active", initiatedBy, startedAt,
  //   inviteDeadline, participants:{[slot]:true} }
  var towerInvites = {};
  var towerEnterAttempted = {}; // pointId -> true（本地節流，同fieldEnterAttempted）
  var towerInviteResolveAttempted = {}; // pointId -> true（本地節流，同fieldInviteResolveAttempted）
  var towerPuzzleStartedFor = {}; // pointId -> true（本地旗標：active後只自動開一次解謎modal）
  // pointId -> { tokenId: timestamp, ... }（來自RTDB，見onBlessingClaimedReceived）。
  // 2026-09-06使用者明確要求「使用祝福後不會被打X、能再次使用」：這份資料只當作使用
  // 記錄留存（不再用來擋任何人重複領取），因此不影響isPointCleared()／
  // updateNearbyChipPoint()的proximity判斷，見handleBlessingUseClick()。
  var blessingClaimed = {};
  var nearbyBlessing = null; // 目前在使用範圍內的祝福籌碼地點（可重複觸發，不因曾被領取過而消失）
  var blessingEnterTimer = null; // 進入祝福的0.5秒讀取條計時器id，見handleBlessingEnterClick()/closeBlessingModal()
  var merchantEnterTimer = null; // 進入商人的0.5秒讀取條計時器id，見handleMerchantEnterClick()/closeMerchantModal()
  // 本次是否有「剛使用過祝福、尚未拿去升級」的額度（2026-09-06使用者明確要求「只有
  // 使用後能提升等級，不再自己的腳色中隨時升級」）：本地端旗標，不需要跨裝置同步
  // （跟stamina/fp一樣是本地端資源，且升級本身已經透過character/{tokenId}同步）。
  // handleBlessingUseClick()領取時設true，handleMidnightLevelDelta()升級成功後消耗回false。
  var blessingLevelUpAvailable = false;
  // 地圖上的丟棄物（2026-09-05角色面板優化新增）：groundItemId -> {kind, itemId,
  // usesRemaining, x, y, droppedBy, createdAt}（來自RTDB，見onGroundItemsReceived／
  // dropInventoryItem()／handlePickupGroundItem()）。任何人靠近都能撿，不限丟棄者本人。
  var groundItems = {};
  var nearbyGroundItem = null; // { id, data } 目前在拾取範圍內、尚未被撿走的掉落物
  var stamina = { current: STAMINA_MAX, max: STAMINA_MAX }; // 本地端資源，不同步（見上方常數區塊註解）
  var fp = { current: FP_BASE, max: FP_BASE }; // 本地端資源、不同步，理由同stamina；不自動回復。角色載入後由renderCombatPanel()改成selfFpMax(c)
  // 一般攻擊連段計數，左右手各自獨立（2026-09-05左右手雙獨立武器欄新增，使用者明確規格：
  // 「因為有左右手能拿武器設定，左手的攻擊魔術等都在左下另外增設按鍵」）。
  // hitIndex: 0=下一擊是第1擊，1=第2擊，2=第3擊。
  var comboState = {
    L: { hitIndex: 0, lastHitAt: 0 },
    R: { hitIndex: 0, lastHitAt: 0 },
  };
  var blockHolding = false;
  // 戰技B（魔術／祈禱）長按狀態，key格式："R"/"L"（該側武器只有1個固定魔術/祈禱時）或
  // "R:0"/"R:1"/"L:0"/"L:1"（杖/聖印同時有2個固定魔術/祈禱、分開成2顆按鈕時）。
  // 值＝長按開始時間戳，沒有該key＝目前沒在長按這顆按鈕。
  var sorceryHoldState = {};
  // 屬性/狀態異常共同蓄積（本地端cache，來自RTDB attributeAccum/{targetKey}，見
  // onAttributeAccumReceived／recordAttributeAccum）。targetKey：有activeEncounter時＝
  // pointId，否則＝"sharedTarget"，跟damageCombatTarget()判斷「打誰」的邏輯一致。
  // attributeAccum[targetKey] = { [屬性或異常的ja名稱]: 目前蓄積值 }
  var attributeAccum = {};
  // 已經觸發過的次數，避免RTDB同步延遲造成同一次跨越閾值被算兩次觸發（key＝
  // targetKey+":"+name，值＝上次已處理到的「觸發次數」floor(蓄積/閾值)）。
  var attributeAccumTriggeredCount = {};
  var flaskReadingUntil = null; // 聖杯瓶讀取中的到期時間戳，null＝目前沒在讀取
  var dodgePressedAt = 0; // 最近一次成功迴避（有扣到體力）的時間戳，見handleDodgeClick／resolveMyIncomingHit
  // 特殊防禦（第六感／遺物效果額外防禦選項，2026-09-05角色能力真正接入新增）：跟dodgePressedAt
  // 同一套時間戳判定模式，見handleSpecialDefenseClick／resolveMyIncomingHit。
  var specialDefensePressedAt = 0;
  // 我目前正在承受的敵人攻擊（只有自己是targetSlots其中之一時才會有值，見updateEnemyAttack()）：
  // { pointId, attackId, hitIndex, hitCount, phase:"warn"|"window"|"done", windowStartAt, phaseEndAt }
  var myIncomingAttack = null;
  var attackEffectTimer = null;
  var enemyHitEffectTimer = null;
  var nearbyTower = null; // 目前在使用範圍內的魔術師塔地點（map.points中type==="sorcerer"者）
  // 地圖點卡牌事件狀態（見上方FIELD_*常數註解）：
  // fieldTriggers[pointId] = {
  //   status: "inviting"|"active"|"resolved",
  //   initiatedBy, startedAt, inviteDeadline,     // 邀請階段
  //   participants: { [slot]: true },             // 這個事件的參與者——只有他們要投票/能遇敵
  //   enterAt, branchIndex, floorIndex,           // 正式進入時決定（branchIndex是seeded挑的，不是投票）
  //   voteDeadline, votes: { [slot]: choiceIndex }, choiceIndex, resolvedAt,
  //   enemyFamilyId, enemyId                      // 只有分歧段落內確實有戰鬥引用時才有
  // }
  var fieldTriggers = {}; // 來自RTDB，見onFieldTriggersReceived
  var fieldEnemyHp = {}; // pointId -> number（來自RTDB，見onFieldEnemyHpReceived，用法跟demoStat同一套transaction()機制）
  // 雜兵HP（2026-09-06角色能力真正接入・死靈術前置工程新增）：pointId -> number。
  // 使用者明確規格：雜兵血量＝樓層文字「+雜兵N」後綴的N×10（單一合併血量池，不是night.js
  // 那種每隻獨立一列），玩家攻擊一律先打雜兵、雜兵歸零才開始打敵人本體（fieldEnemyHp），
  // 雜兵不會反擊、只當作敵人HP的延伸——見damageCombatTarget()／maybeAssignFieldEnemy()。
  var fieldMobHp = {};
  // 樓層探索進度（2026-09-05套用night.js既有板塊流程新增）：跟fieldTriggers/{pointId}
  // 這個「單次進入session」（邀請→敘述→投票→遇敵）分開，是獨立持久的進度記錄，見
  // maybeAdvanceFieldProgressAfterFloorClear()說明。
  // fieldProgress[pointId] = { branchIndex, floorIndex, cleared, advancedBy<N>（每層各自
  //   一個first-writer-wins guard欄位，見maybeAdvanceFieldProgressAfterFloorClear）,
  //   fullClearRewardGrantedBy }
  var fieldProgress = {}; // 來自RTDB，見onFieldProgressReceived
  var nearbyFieldPoint = null; // 目前在FIELD_TRIGGER_RADIUS範圍內的地圖點（sorcerer型別除外）
  var nearbyCastlePoint = null; // 目前是否站在王城castleZone範圍內，見updateNearbyCastle()
  var CASTLE_POINT_ID = "castle_j"; // 王城合成點的固定id，跟一般地圖點的隨機id分開，方便辨識
  var activeEncounter = null; // 目前在範圍內、我是參與者、已解決分歧且敵人仍存活的地圖點——非null時攻擊/戰技要打這個點的敵人，不是共用標靶
  // 逃離戰鬥（2026-09-06使用者明確要求「在敵人資訊中右上方有逃離戰鬥按鈕」）：本地端
  // 記錄「我對這個地圖點按過逃離」，recomputeActiveEncounter()因此不會把它當成
  // activeEncounter，直到我離開所有觸發範圍後整份清空（見該函式），重新靠近才會再次
  // 視為新的遭遇。純本地UI放棄，不是正式規則書的「撤退」判定（見docs/scenario_flow_rules.md
  // 備註，那是正式night.js場次的HP增加代價，midnight.js本來就是簡化demo戰鬥，範圍外）。
  var fledEncounterIds = {};
  // 2026-09-06優化（使用者明確規格「若因為離開過再次進入戰鬥或參加別人的戰鬥，都須先
  // 按下上方資訊欄的進入戰鬥，接著讀條3秒後才正式進入戰鬥畫面」）：confirmedEncounterIds
  // 記錄「這場遭遇（fieldTrigger/{id}）我這次已經正式進入戰鬥畫面」，跟fledEncounterIds
  // 一樣是本地端、離開所有觸發範圍就整份清空（見recomputeActiveEncounter()）。
  // pendingBattleReentry：目前顯示著[進入戰鬥]提示、尚未確認的候選地圖點；
  // battleEnteringUntil：按下後的讀取到期時間戳，null＝目前沒在讀取。
  var confirmedEncounterIds = {};
  var pendingBattleReentry = null;
  var battleEnteringUntil = null;
  var BATTLE_ENTER_LOADING_MS = 3000; // 使用者明確規格「接著需要讀條3秒後才正式進入戰鬥畫面」
  var fieldEnterAttempted = {}; // pointId -> true（本地節流：按下「進入」的transaction只送一次）
  var fieldInviteResolveAttempted = {}; // pointId -> true（本地節流：inviting→active的transaction只送一次）
  var fieldTypewriterStartedFor = {}; // pointId -> true（本地旗標：這個點的打字機動畫只啟動一次）
  var fieldTypewriterDoneFor = {}; // pointId -> true（本地旗標：打字機播完、可以顯示投票選項了）
  var fieldVoteDeadlineSetAttempted = {}; // pointId -> true（本地節流：voteDeadline的transaction只送一次）
  var fieldVoteResolveAttempted = {}; // pointId -> true（本地節流，避免同一個點每影格都重打一次transaction）
  var fieldEnemyAssignAttempted = {}; // pointId -> true（本地節流：敵人指派的transaction只送一次）
  var lastRenderedVoteKey = {}; // pointId -> 簽章字串（votes+mySlot+isPaused），沒變就不重建投票按鈕DOM
  // 敵人攻擊：跟上面幾個fieldXxxAttempted同樣的本地節流手法，避免每影格（60Hz）都對
  // 同一件事重送一次transaction()。這三個會在攻擊排程→發動→收尾的循環裡反覆重置
  // （不是像fieldEnterAttempted那樣整個點的生命週期只成立一次），見各自呼叫處註解。
  var nextAttackScheduleAttempted = {}; // pointId -> true（正在等這次nextAttackAt的transaction回應）
  var enemyAttackStartAttempted = {}; // pointId -> true（正在等這次攻擊發動的transaction回應）
  var enemyAttackFinishAttempted = {}; // pointId -> attackId（正在等這個attackId收尾的transaction回應）
  var lastRenderedEncounterKey = null; // 目前combat panel顯示中的敵人（familyId:enemyId），避免每影格重設img.src
  // 新籌碼點（merchant／strong_enemy／random_event，2026-09-05新增，見規劃紀錄）：
  // 跟field卡牌點各自獨立的proximity偵測，見updateNearbyChipPoint()。強敵籌碼直接
  // 重用fieldTriggers/{pointId}與fieldEnemyHp/{pointId}的既有RTDB shape與戰鬥/攻擊
  // 排程函式（見rollAndAssignStrongEnemy()說明），因此不需要另一組戰鬥狀態變數。
  var nearbyMerchant = null; // 目前在使用範圍內的商人地點
  var nearbyStrongEnemy = null; // 目前在使用範圍內、尚未擊殺的強敵地點
  var nearbyRandomEvent = null; // 目前在使用範圍內的隨機事件（聖甲蟲）地點
  var strongEnemyRollAttempted = {}; // pointId -> true（本地節流：強敵決定表只送一次transaction）
  var strongEnemyRewardAttempted = {}; // pointId -> true（本地節流：擊殺獎勵只送一次transaction）
  // 2026-09-06優化（使用者明確規格「第一天/第二天夜之強敵」）：縮圈到最小（見
  // phaseInfoForDay()的waitingForDay2/3 stage）後的強制夜之強敵戰鬥，比照strong_enemy
  // 籌碼同一套fieldTrigger/fieldEnemyHp shape，id固定為"finalCircleDayN"，見
  // updateFinalCircleBoss()／rollAndAssignFinalCircleBoss()。
  var nearbyFinalCircleBoss = null;
  var finalCircleRollAttempted = {}; // dayIndex -> true（本地節流，同strongEnemyRollAttempted）
  var finalCircleDayAdvanceAttempted = {}; // dayIndex -> true（本地節流：自動換日的transaction只送一次）
  var lastAutoDayForCooldownReset = 1; // 偵測「天數真的變了」才resetAbilityCooldowns()，每個裝置各自偵測，見updateAutoDayAdvance()
  var readyFinalBoss = {}; // slot -> true（來自RTDB，第二天夜之強敵擊破後的「準備開始夜王戰鬥」，見handleReadyFinalBossToggle()）
  var scarabResult = null; // { pointId, statKey, dice, sum, target, success } 本次聖甲蟲判定結果（本地only，顯示用）
  var pendingRewards = {}; // tokenId -> [{id, kind, value, resolved}]（來自RTDB，見onPendingRewardsReceived）
  var puzzle = null; // { pointId, answer, deadline } 進行中的解謎狀態（本地only，不同步）
  var keysDown = {};
  var lastFrameTime = null;
  var lastPosPushTime = 0;
  var lastPushedPos = null;
  var lastDamageTickTime = 0;
  var lastDayPhaseKey = null; // 偵測phase切換用（day+phase字串），切換時重新render HUD文字
  var canvas = null;
  var ctx = null;
  // 小地圖（2026-09-06新增，見#midnight-minimap-canvas的HTML註解）：跟主canvas共用同一份
  // 畫面內容，render()結尾把主canvas整張縮小畫進來，不重複執行地圖繪製邏輯。
  var minimapCanvas = null;
  var minimapCtx = null;
  var mapImage = new Image();
  mapImage.src = "../static/images/maps/map_origin.jpg";

  // 新籌碼點圖示（2026-09-05新增）：直接沿用night既有EVENT_CHIP_TYPES用的同一批圖檔
  // （static_src/images/icons/），不是另外畫的圖，見drawPointCard()。
  var CHIP_ICON_IMAGES = {
    merchant: new Image(),
    strong_enemy: new Image(),
    random_event: new Image(),
    blessing: new Image(),
  };
  CHIP_ICON_IMAGES.merchant.src = "../static/images/icons/merchant.png";
  CHIP_ICON_IMAGES.strong_enemy.src = "../static/images/icons/strong-enemy.png";
  CHIP_ICON_IMAGES.random_event.src = "../static/images/icons/random.png";
  CHIP_ICON_IMAGES.blessing.src = "../static/images/icons/blessing.png";

  // 角色頭像快取（2026-09-05地圖優化新增，供drawToken()當玩家圖示用，見
  // characterImageForId()）：依檔名快取，不是依characterId快取，因為同一張圖可能被
  // 多個角色共用CHARACTER_PRESETS內的image欄位（目前每個characterId各自對應唯一檔名，
  // 但用檔名當key比較保險，不假設一對一）。
  var CHARACTER_PORTRAIT_IMAGES = {};
  function characterImageForId(characterId) {
    var preset = findCharacterPreset(characterId);
    if (!preset) return null;
    var cached = CHARACTER_PORTRAIT_IMAGES[preset.image];
    if (!cached) {
      cached = new Image();
      cached.src = characterImagePath(preset.image);
      CHARACTER_PORTRAIT_IMAGES[preset.image] = cached;
    }
    return cached;
  }

  var autoFly = null; // { fromX, fromY, toX, toY, controlX, controlY, startTime, duration }
  var nearbyBird = null; // 目前在使用範圍內的SPIRIT_BIRD_LINKS entry（null=不在任何範圍內）

  var joystickActive = false;
  var joystickVec = { x: 0, y: 0 }; // 手機搖桿方向，-1~1正規化
  var joystickTouchId = null;
  var joystickCenter = { x: 0, y: 0 };
  var joystickMaxOffset = 32;

  var longPressTimer = null;
  var longPressStartClient = null;

  function qsGameId() {
    var params = new URLSearchParams(window.location.search);
    return params.get("game");
  }

  function randomTokenId() {
    return "tok" + Math.random().toString(16).slice(2) + Date.now().toString(16);
  }

  function el(id) {
    return document.getElementById(id);
  }

  // ---- 建立新測試場：產生gameId＋初始meta（地圖種子、三天縮圈時間軸起點），等寫入RTDB
  // 真正完成後才導向帶?game=的網址（讓建立者跟加入者走同一條初始化路徑，不用維護兩套
  // 邏輯）。----
  // 使用者實測發現的bug修正（2026-09-03）：以前這裡呼叫完GameStorage.rtSet()（fire-and-
  // forget，不等待）就立刻window.location.href導頁。但rtSet內部要先依序載入4個Firebase
  // SDK script＋完成匿名登入才會真的送出寫入，這些都還沒完成、頁面就已經因為導頁被整個
  // 摧毀——寫入永遠沒機會真正送到Firebase，導致其他裝置（甚至導頁後的自己）訂閱到的meta
  // 永遠是null，畫面卡在起始畫面看不到地圖（不是AppCheck/reCAPTCHA或Firebase規則的問題，
  // 這兩者在同個repo既有的night雲端遊戲已驗證過不會擋住流程）。改成await rtSet()回傳的
  // Promise，確認真的寫入成功後才導頁。
  function handleCreateClick() {
    var btn = el("btn-midnight-create");
    btn.disabled = true;
    btn.textContent = window.I18N.t("midnight_creating_note");
    var newId = GameStorage.generateCloudGameId();
    var seed = (Math.random() * 0xffffffff) >>> 0;
    var now = Date.now();
    // 不再馬上寫sessionStartAt——遊戲創建後先進等待房，全部已佔用席位都按下準備才會
    // 觸發5秒倒數、倒數結束才寫sessionStartAt（見maybeTriggerLobbyCountdown()／
    // maybeTriggerSessionStart()），時間軸從那時候才開始算。
    var initialMeta = {
      mapSeed: seed,
      createdAt: now,
    };
    GameStorage.rtSet(newId, "cloud", "meta", initialMeta).then(function () {
      window.location.href = "?game=" + encodeURIComponent(newId);
    });
  }

  // ---- 加入既有測試場：訂閱meta，等待地圖種子抵達後才真正開始（可能是自己剛
  // 建立、也可能是別人分享連結進來，兩種情況走同一段初始化）。----
  // 注意：meta不再是「建立後就不會變」——day2StartAt／day3StartAt／重新開始／等待房
  // 倒數／暫停 都會再次寫入meta，所以每次收到都要更新本地的meta變數，只有下面「產生
  // 地圖」這段初始化只能跑一次（用isFirstTime擋住，不是靠meta是否為null判斷，因為meta
  // 在第一次之後就一直是truthy的）。畫面要顯示等待房還是地圖，則是每次收到meta都要
  // 重新判斷（見updateLobbyOrGameVisibility()），因為sessionStartAt可能是稍後才出現。
  function onMetaReceived(value) {
    if (!value) return;
    var isFirstTime = !meta;
    meta = value;
    if (isFirstTime) {
      map = Map_.generateMap(meta.mapSeed);
      el("midnight-start-screen").hidden = true;
      startLoop();
    }
    updateLobbyOrGameVisibility();
  }

  // 依meta.sessionStartAt是否存在，切換顯示等待房或地圖畫面；剛切換進地圖那一刻，如果
  // 我有已佔用的席位（mySlot），把本地出生點設到該席位的席位出生點附近。這個函式在
  // onMetaReceived／onPlayersReceived都會被呼叫（兩邊都可能影響「該顯示哪個畫面」的
  // 判斷），用一個旗標（gameViewInitialized）避免重複初始化出生點。
  var gameViewInitialized = false;
  function updateLobbyOrGameVisibility() {
    if (!meta || !map) return;
    var started = !!meta.sessionStartAt;
    el("midnight-lobby").hidden = started;
    el("midnight-map-area").hidden = !started;
    el("midnight-hud").hidden = !started;
    if (started && !gameViewInitialized) {
      gameViewInitialized = true;
      setMapExpanded(true);
      if (mySlot) {
        var rand = Math.random;
        var spawn = findWalkableSpawnNear(map.dayPlan.day1.start, rand);
        localPos = { x: spawn.x, y: spawn.y };
        // 用同一個新建角色物件算出真實HP上限（見selfArenaHpMax()），避免demoStat初始化
        // 時角色資料還沒經過RTDB round-trip、本地characters[]仍是空的而退回基礎100。
        var initialChar = newCharacterForSlot(mySlot);
        GameStorage.rtTransaction(gameId, "cloud", "demoStat/" + myTokenId, function (cur) {
          return cur === null ? selfArenaHpMax(initialChar) : cur;
        });
        GameStorage.rtTransaction(gameId, "cloud", "character/" + myTokenId, function (cur) {
          return cur === null ? initialChar : cur;
        });
      }
    }
    if (!started) {
      renderLobby();
    } else {
      // players/資料可能早就到了（在sessionStartAt出現之前），這裡進場當下要主動渲染
      // 一次玩家面板，不能只靠onPlayersReceived之後「剛好又有新的players/變動」才觸發
      // ——像這種「稍後才進來的觀戰者，加入時遊戲已經開始、players已經不會再變」的情況，
      // 不主動渲染的話面板會永遠是空的。
      renderPlayersPanel();
    }
  }

  // 在指定錨點附近找一個可行走的出生點（小範圍隨機偏移，避免多名玩家完全疊在同一格），
  // 找不到就直接用錨點本身（A_CANDIDATES本身已確認可行走）。
  function findWalkableSpawnNear(anchor, rand) {
    var guard = 0;
    while (guard < 300) {
      guard++;
      var dx = (rand() * 2 - 1) * 3;
      var dy = (rand() * 2 - 1) * 3;
      var x = anchor.x + dx;
      var y = anchor.y + dy;
      if (Map_.isWalkable(map, x, y)) return { x: x, y: y };
    }
    return { x: anchor.x + 0.5, y: anchor.y + 0.5 };
  }

  // 角色屬性管理（2026-09-05新增）：建立一個跟night character_drawer.jsの
  // newCharacter()同形狀的角色物件，讓CharacterDrawer既有的merchantDrawWeapon／
  // potentialPowerDrawWeapon／rollPotentialPowerAttachedEffect等helper可以直接對這個
  // 物件操作，不用另外設計一套精簡欄位（見規劃紀錄）。flaskCount/flaskMax沿用midnight
  // 原本的命名，一併放進同一個物件（newCharacter()沒有這兩個欄位名稱）。
  function newCharacterForSlot(slot) {
    var p = players[slot];
    var typeId = p ? p.characterId : null;
    var name = p ? p.name : "";
    var c = window.PriTestCharacterDrawer.newCharacter(name, typeId);
    c.flaskCount = FLASK_MAX_DEFAULT;
    c.flaskMax = FLASK_MAX_DEFAULT;
    return c;
  }

  function onTokensReceived(value) {
    remoteTokens = value || {};
  }

  function onDemoStatsReceived(value) {
    demoStats = value || {};
    renderCombatPanel();
    renderCharPanel();
    if (meta && meta.sessionStartAt) renderPlayersPanel();
  }

  function onPingsReceived(value) {
    remotePings = value || {};
  }

  var lastShownTileRewardAt = null; // 本地only：避免板塊獎勵toast在每次character/資料更新時重複跳出

  var fpInitialized = false; // 本地only：角色資料首次抵達時，把fp（本地端資源，不同步）
  // 從開頭的FP_BASE bootstrap值一次性灌滿到真正的selfFpMax(c)，避免顯示「10/40」這種
  // 看起來像沒滿血、實際上只是還沒同步過的誤導畫面（demoStat/HP走RTDB transaction()
  // 初始化已經是滿血，FP純本地端則需要在這裡補一次）。

  function onCharactersReceived(value) {
    characters = value || {};
    var mine = characters[myTokenId];
    if (mine && !fpInitialized) {
      fpInitialized = true;
      fp.max = selfFpMax(mine);
      fp.current = fp.max;
    }
    if (mine && mine._lastTileRewardNote) {
      if (lastShownTileRewardAt !== null && mine._lastTileRewardNote.at !== lastShownTileRewardAt) {
        showToast(mine._lastTileRewardNote.text);
      }
      lastShownTileRewardAt = mine._lastTileRewardNote.at;
    }
    // 2026-09-06使用者回報bug「一開始拿著武器時攻擊沒反應，要先切換過武器才會動」：
    // 角色剛建立時equippedWeaponIdL/R是undefined，只有顯示層renderWeaponCard()有
    // undefined→ids[0]的暫時性fallback讓武器卡片「看起來」已裝備，但真正判斷攻擊/戰技/
    // 威力補正的computeSideAttackInfo()／weaponArtEntry()等函式直接讀原始欄位，undefined
    // 時一律視為「沒有武器」——顯示跟實際狀態對不上。修法：角色首次載入、還沒手動切換過
    // 武器時，直接把顯示層一直以來的fallback值(ids[0])寫成真正的裝備狀態（等同呼叫一次
    // cycleEquippedWeapon()循環到ids[0]的最終結果），只需要一次性寫入即可，寫入後
    // equippedWeaponIdL/R不再是undefined，這段guard自然不會重複執行。
    if (mine && mine.equippedWeaponIdL === undefined && mine.equippedWeaponIdR === undefined && mine.weaponIds && mine.weaponIds.length) {
      var startingWeaponId = mine.weaponIds[0];
      mine.equippedWeaponIdL = startingWeaponId;
      mine.equippedWeaponIdR = startingWeaponId;
      GameStorage.rtSet(gameId, "cloud", "character/" + myTokenId + "/equippedWeaponIdL", startingWeaponId);
      GameStorage.rtSet(gameId, "cloud", "character/" + myTokenId + "/equippedWeaponIdR", startingWeaponId);
      syncEquippedWeaponIds(mine);
    }
    renderCharPanel();
    renderCharacterSheet();
  }

  function onTowerSolvedReceived(value) {
    towerSolved = value || {};
  }

  function onTowerInvitesReceived(value) {
    towerInvites = value || {};
  }

  function onBlessingClaimedReceived(value) {
    blessingClaimed = value || {};
  }

  function onGroundItemsReceived(value) {
    groundItems = value || {};
  }

  function onFieldTriggersReceived(value) {
    fieldTriggers = value || {};
  }

  function onFieldEnemyHpReceived(value) {
    fieldEnemyHp = value || {};
    renderCombatPanel();
  }

  // 雜兵HP歸零偵測（2026-09-06死靈術前置工程新增）：跟damageCombatTarget()是分開的
  // 觸發點，因為要讓每個正在旁觀這個地圖點的client（不只是打出最後一擊的那個人）都各自
  // 判斷「我是否有死靈術，該不該擲骰」——比照night.js的handleMobRowDepleted()掃描全體
  // 已入場角色的精神，midnight下每個client只負責掃描自己的角色（各自寫回自己的
  // deathSpirits，不能代寫別人）。
  var lastKnownMobHp = {}; // pointId -> number，記住上一次收到的值，才能判斷「剛好從>0變成0」

  function onFieldMobHpReceived(value) {
    var next = value || {};
    Object.keys(next).forEach(function (pointId) {
      var prev = lastKnownMobHp[pointId];
      if (prev !== undefined && prev > 0 && next[pointId] <= 0) {
        maybeRollNecromancyForSelf(pointId);
      }
    });
    lastKnownMobHp = next;
    fieldMobHp = next;
    renderCombatPanel();
  }

  // 死靈術（復仇者/復仇者暗影被動，2026-09-06角色能力真正接入新增）：雜兵HP歸零時，
  // 持有此被動者各擲1個骰子，5/6成功即召喚死靈（hpCurrent/hpMax=3，比照night.js既有數值）
  // 到c.deathSpirits。使用者確認的觸發條件是「打過雜兵血量」（即雜兵HP耗盡），跟night.js
  // 「每失去1行」的逐行觸發不同——midnight的雜兵是單一合併血量池（使用者明確規格），因此
  // 簡化成整個池歸零時觸發1次，不追蹤「行」的中間邊界。
  var NECROMANCY_SUCCESS_ROLLS = [5, 6];
  var DEATH_SPIRIT_HP = 3;

  function maybeRollNecromancyForSelf(pointId) {
    var c = characters[myTokenId];
    var type = c && c.typeId ? window.PriTestCharacterTypes.get(c.typeId) : null;
    var ability = type
      ? (type.abilities || []).filter(function (a) {
          return a.id === "necromancy";
        })[0]
      : null;
    if (!c || !ability) return;
    var roll = 1 + Math.floor(Math.random() * 6);
    var success = NECROMANCY_SUCCESS_ROLLS.indexOf(roll) !== -1;
    var CharacterTypes = window.PriTestCharacterTypes;
    var name = CharacterTypes.localizedText(ability.name);
    if (success) {
      var spirits = (c.deathSpirits || []).slice();
      spirits.push({ id: "sp" + Date.now() + Math.floor(Math.random() * 1000), hpCurrent: DEATH_SPIRIT_HP, hpMax: DEATH_SPIRIT_HP });
      c.deathSpirits = spirits;
      GameStorage.rtSet(gameId, "cloud", "character/" + myTokenId + "/deathSpirits", spirits);
    }
    showToast(name + "：" + window.I18N.t(success ? "midnight_necromancy_success_note" : "midnight_necromancy_fail_note", { roll: roll }));
  }

  function onFieldProgressReceived(value) {
    fieldProgress = value || {};
    renderFieldOverlay();
  }

  function onPendingRewardsReceived(value) {
    pendingRewards = value || {};
    renderRewardModal();
  }

  // ---- players/{slot}訂閱：等待房畫面、進場後的玩家面板、開局倒數判斷、都靠這份資料。----
  function onPlayersReceived(value) {
    players = value || {};
    // 如果我控制的席位（依tokenId比對）出現在資料裡，同步一下mySlot（處理「我在等待房
    // 已經加入過，重新整理頁面後mySlot本地變數會是null，但players資料裡我的tokenId還在」
    // 這種情況——雖然重開頁面myTokenId會換一個新的，所以理論上不會自動比對到，這裡保留
    // 是為了同一個session內、players資料比預期晚一點點才到達時不會誤判成「我沒有席位」）。
    var foundSlot = null;
    Object.keys(players).forEach(function (slot) {
      if (players[slot] && players[slot].tokenId === myTokenId) foundSlot = slot;
    });
    if (foundSlot) mySlot = foundSlot;
    else if (mySlot && (!players[mySlot] || players[mySlot].tokenId !== myTokenId)) {
      // 我原本控制的席位被別人接管走了（輸入密碼取代我），這裡失去控制權、變回觀戰。
      mySlot = null;
    }
    if (meta && !meta.sessionStartAt) {
      renderLobby();
      maybeTriggerLobbyCountdown();
    } else {
      renderPlayersPanel();
    }
  }

  function occupiedSlots() {
    var out = [];
    for (var i = 1; i <= MAX_PLAYERS; i++) {
      if (players[String(i)]) out.push(String(i));
    }
    return out;
  }

  // ---- 等待房畫面渲染：3個席位卡片（空位顯示「加入」表單觸發按鈕、已佔用顯示名稱＋
  // 準備狀態＋非本人時的「接管」按鈕）、我自己的準備/取消準備按鈕、倒數文字、滿員觀戰
  // 提示。----
  function renderLobby() {
    var container = el("midnight-lobby-slots");
    container.innerHTML = "";
    for (var i = 1; i <= MAX_PLAYERS; i++) {
      var slot = String(i);
      var p = players[slot];
      var card = document.createElement("div");
      card.className = "midnight-slot-card" + (p ? "" : " midnight-slot-empty");
      if (!p) {
        card.textContent = window.I18N.t("midnight_lobby_slot_empty");
        if (!mySlot && !meta.sessionStartAt) {
          var joinBtn = document.createElement("button");
          joinBtn.type = "button";
          joinBtn.textContent = window.I18N.t("midnight_lobby_join_button");
          joinBtn.addEventListener("click", function (slotForClick) {
            return function () {
              showJoinForm(slotForClick);
            };
          }(slot));
          card.appendChild(joinBtn);
        }
      } else {
        renderOccupiedSlotCard(card, slot, p);
      }
      container.appendChild(card);
    }

    var isFull = occupiedSlots().length >= MAX_PLAYERS;
    el("midnight-lobby-spectator-note").hidden = !(isFull && !mySlot);

    var readyBtn = el("btn-midnight-lobby-ready");
    var leaveBtn = el("btn-midnight-lobby-leave");
    if (mySlot && players[mySlot]) {
      readyBtn.hidden = false;
      readyBtn.textContent = window.I18N.t(players[mySlot].ready ? "midnight_lobby_unready_button" : "midnight_lobby_ready_button");
      leaveBtn.hidden = false;
    } else {
      readyBtn.hidden = true;
      leaveBtn.hidden = true;
    }

    // 表單開著時（pendingJoinSlot有值）不要在這裡強制收起——renderLobby()會被任何
    // players/資料變動觸發（例如別人切換準備狀態），如果每次都無條件隱藏表單，使用者
    // 才剛點「加入」要輸入名稱/密碼，畫面就會被別人的操作打斷、表單突然消失。只有在
    // 「我沒有正在填的表單」或「我要填的那個席位剛好被別人搶走了」才收起。
    var form = el("midnight-lobby-join-form");
    if (!pendingJoinSlot || players[pendingJoinSlot]) {
      form.hidden = true;
      pendingJoinSlot = null;
    }
  }

  function renderOccupiedSlotCard(card, slot, p) {
    var dot = document.createElement("span");
    dot.className = "midnight-slot-color-dot";
    dot.style.background = characterColor(p.characterId);
    card.appendChild(dot);

    var nameSpan = document.createElement("span");
    nameSpan.className = "midnight-slot-name";
    var charLabel = characterName(p.characterId);
    nameSpan.textContent =
      p.name + "（" + charLabel + "）" + (p.tokenId === myTokenId ? " " + window.I18N.t("midnight_takeover_self_note") : "") + (p.ready ? " ✓" : "");
    card.appendChild(nameSpan);

    // 其他玩家的血量條：只有進場後（demoStats已經有資料）才有意義，等待房階段demoStats
    // 通常還是空的，這裡直接讀undefined時視為滿血顯示。HP上限已不是固定100（見
    // selfArenaHpMax()），改用百分比換算血條寬度。
    var hpMaxForSlot = selfArenaHpMax(characters[p.tokenId]);
    var hpVal = demoStats[p.tokenId];
    var hpValNum = hpVal === undefined ? hpMaxForSlot : hpVal;
    var hpTrack = document.createElement("span");
    hpTrack.className = "midnight-bar-track midnight-bar-track-sm midnight-slot-hp";
    var hpFill = document.createElement("span");
    hpFill.className = "midnight-bar-fill midnight-bar-hp";
    hpFill.style.width = Math.max(0, Math.min(100, (hpValNum / hpMaxForSlot) * 100)) + "%";
    hpTrack.appendChild(hpFill);
    card.appendChild(hpTrack);

    // 攻擊／技能使用提示（見broadcastCombatActionBubble()說明）：掛在血量條右邊，
    // 自己/隊友共用同一個渲染路徑——只顯示combatActionEvents裡這個tokenId還在
    // COMBAT_ACTION_BUBBLE_MS內的最新兩筆（舊的在上、新的在下），逾時的單純不畫
    // （不需要另外清除RTDB資料）。每筆各自的滑入動畫見.midnight-action-bubble-line
    // （style.css）。
    var bubbleEvents = (combatActionEvents[p.tokenId] || []).filter(function (ev) {
      return ev && Date.now() - ev.at < COMBAT_ACTION_BUBBLE_MS;
    });
    if (bubbleEvents.length) {
      var bubbleStack = document.createElement("span");
      bubbleStack.className = "midnight-action-bubble-stack";
      bubbleEvents.forEach(function (ev) {
        var line = document.createElement("span");
        line.className = "midnight-action-bubble-line";
        line.textContent = ev.text;
        bubbleStack.appendChild(line);
      });
      card.appendChild(bubbleStack);
    }

    if (p.tokenId !== myTokenId) {
      var takeoverBtn = document.createElement("button");
      takeoverBtn.type = "button";
      takeoverBtn.textContent = window.I18N.t("midnight_takeover_button");
      takeoverBtn.addEventListener("click", function () {
        handleTakeover(slot);
      });
      card.appendChild(takeoverBtn);
    }
  }

  function findCharacterPreset(characterId) {
    return (
      CHARACTER_PRESETS.filter(function (c) {
        return c.id === characterId;
      })[0] || CHARACTER_PRESETS[0]
    );
  }

  function characterColor(characterId) {
    return findCharacterPreset(characterId).color;
  }

  function characterName(characterId) {
    return window.I18N.t(findCharacterPreset(characterId).nameKey);
  }

  function showJoinForm(slot) {
    pendingJoinSlot = slot;
    var form = el("midnight-lobby-join-form");
    form.hidden = false;
    form.dataset.targetSlot = slot;
    var nameInput = el("midnight-lobby-name-input");
    var passInput = el("midnight-lobby-passcode-input");
    nameInput.placeholder = window.I18N.t("midnight_lobby_name_placeholder");
    passInput.placeholder = window.I18N.t("midnight_lobby_passcode_placeholder");
    renderCharacterPicker();
  }

  function characterImagePath(image) {
    return "../static/images/characters/midnight/" + image;
  }

  // 20個角色（10基礎＋10變體）共用10張頭像圖，縮圖本身分不出基礎/變體，所以每個選項
  // 底下都要顯示文字名稱（不能只靠hover title——變體的存在意義就是要讓玩家看得到、選
  // 得到，不是靠猜或滑鼠移過去才知道）。
  function renderCharacterPicker() {
    var picker = el("midnight-lobby-character-picker");
    picker.innerHTML = "";
    CHARACTER_PRESETS.forEach(function (c) {
      var wrap = document.createElement("button");
      wrap.type = "button";
      wrap.className = "midnight-character-option" + (c.id === selectedCharacterId ? " midnight-character-selected" : "");
      wrap.style.borderColor = c.id === selectedCharacterId ? c.color : "transparent";
      var img = document.createElement("img");
      img.src = characterImagePath(c.image);
      img.alt = window.I18N.t(c.nameKey);
      wrap.appendChild(img);
      var label = document.createElement("span");
      label.className = "midnight-character-option-label";
      label.textContent = window.I18N.t(c.nameKey);
      wrap.appendChild(label);
      wrap.addEventListener("click", function () {
        selectedCharacterId = c.id;
        renderCharacterPicker();
      });
      picker.appendChild(wrap);
    });
  }

  // 加入席位用transaction()（不是rtSet）：避免兩台裝置幾乎同時點同一個空位的「加入」，
  // 都以為自己搶到了——transaction()保證只有先送達的那個真的寫進去，晚到的那個會看到
  // cur已經非null，直接回傳原值（不覆寫），我們再從transaction()的回傳結果比對
  // tokenId是不是自己的，藉此知道「我剛剛的加入其實搶輸了」，要提示使用者換個空位。
  function handleLobbyJoin() {
    var form = el("midnight-lobby-join-form");
    var slot = form.dataset.targetSlot;
    var name = el("midnight-lobby-name-input").value.trim() || window.I18N.t("midnight_default_player_name");
    var passcode = el("midnight-lobby-passcode-input").value.trim();
    if (!/^\d{4}$/.test(passcode)) {
      window.alert(window.I18N.t("midnight_lobby_passcode_hint"));
      return;
    }
    var entry = { name: name, characterId: selectedCharacterId, passcode: passcode, tokenId: myTokenId, ready: false };
    GameStorage.rtTransaction(gameId, "cloud", "players/" + slot, function (cur) {
      return cur === null ? entry : cur;
    }).then(function (committed) {
      pendingJoinSlot = null;
      if (committed && committed.tokenId === myTokenId) {
        mySlot = slot;
        form.hidden = true;
      } else {
        window.alert(window.I18N.t("midnight_lobby_slot_taken_note")); // 搶輸了，該格已被別人佔用
        renderLobby();
      }
    });
  }

  function handleLobbyReadyToggle() {
    if (!mySlot || !players[mySlot]) return;
    GameStorage.rtSet(gameId, "cloud", "players/" + mySlot + "/ready", !players[mySlot].ready);
  }

  // 離開席位（只在等待房、遊戲還沒開始時可以用）：把整個players/{slot}刪掉（不是只清
  // tokenId），讓別人可以重新加入這個空位、選新的名稱/角色/密碼——跟接管不同，接管是
  // 「保留原本的名稱/角色/密碼，只換誰在操作」，離開則是「這個席位的設定本身也作廢」。
  function handleLobbyLeave() {
    if (!mySlot || meta.sessionStartAt) return;
    var slot = mySlot;
    GameStorage.rtSet(gameId, "cloud", "players/" + slot, null).then(function () {
      mySlot = null;
      renderLobby();
    });
  }

  // 全部已佔用席位都準備好後，任一裝置都可以觸發5秒倒數——用transaction()保證只有第一個
  // 送達的寫入生效，其餘裝置的呼叫會看到cur已經非null直接回傳原值。countdownTriggerAttempted
  // 只是本地端的節流（避免同一個裝置每個影格都呼叫一次transaction()），不是正確性保證，
  // 正確性由transaction()本身保證。
  function maybeTriggerLobbyCountdown() {
    if (!meta || meta.sessionStartAt || meta.countdownStartAt) return;
    var occupied = occupiedSlots();
    if (occupied.length === 0) return;
    var allReady = occupied.every(function (slot) {
      return players[slot].ready;
    });
    if (!allReady) {
      countdownTriggerAttempted = false;
      return;
    }
    if (countdownTriggerAttempted) return;
    countdownTriggerAttempted = true;
    GameStorage.rtTransaction(gameId, "cloud", "meta/countdownStartAt", function (cur) {
      return cur === null ? Date.now() : cur;
    });
  }

  // 倒數期間如果有已佔用席位取消準備，取消倒數（回到等待狀態）——避免有人還沒準備好
  // 就被強制拖進遊戲。
  function maybeCancelLobbyCountdown() {
    if (!meta || meta.sessionStartAt || !meta.countdownStartAt) return;
    var occupied = occupiedSlots();
    var allReady = occupied.length > 0 && occupied.every(function (slot) {
      return players[slot].ready;
    });
    if (!allReady) {
      GameStorage.rtSet(gameId, "cloud", "meta/countdownStartAt", null);
      countdownTriggerAttempted = false;
      sessionStartTriggerAttempted = false;
    }
  }

  // 倒數跑完後，任一裝置transaction()寫入sessionStartAt（同樣用transaction()避免多裝置
  // 重複寫入；就算真的重複寫，寫入的值理論上也很接近，不影響遊戲性，只是保守起見一樣用
  // transaction()維持機制一致）。
  function maybeTriggerSessionStart(now) {
    if (!meta || meta.sessionStartAt || !meta.countdownStartAt) return;
    if (now < meta.countdownStartAt + READY_COUNTDOWN_MS) return;
    if (sessionStartTriggerAttempted) return;
    sessionStartTriggerAttempted = true;
    GameStorage.rtTransaction(gameId, "cloud", "meta/sessionStartAt", function (cur) {
      return cur === null ? Date.now() : cur;
    });
    // 開局那一刻順便確定夜王（見上方meta.resolvedNightBossId說明）：選了具體夜王就固定
    // 那個，選隨機則用mapSeed決定性挑一個，所有裝置都會算出同一個結果，transaction()
    // 只是避免不必要的重複寫入，不是為了協調「誰先決定」。
    GameStorage.rtTransaction(gameId, "cloud", "meta/resolvedNightBossId", function (cur) {
      return cur === null ? resolveNightBossScenarioId() : cur;
    });
  }

  // ---- 進場後的「玩家」面板：3個席位＋非本人時的「接管」按鈕（同一個UI元件邏輯也能
  // 處理斷線重連——原本控制的裝置已經離線，密碼正確的話任何人都能接手）。----
  function renderPlayersPanel() {
    var container = el("midnight-players-panel-slots");
    if (!container) return;
    container.innerHTML = "";
    for (var i = 1; i <= MAX_PLAYERS; i++) {
      var slot = String(i);
      var p = players[slot];
      var card = document.createElement("div");
      card.className = "midnight-slot-card" + (p ? "" : " midnight-slot-empty");
      if (!p) {
        card.textContent = window.I18N.t("midnight_lobby_slot_empty");
      } else {
        renderOccupiedSlotCard(card, slot, p);
      }
      container.appendChild(card);
    }
  }

  // ---- 接管／斷線重連：任何人（包含觀戰者）輸入該席位的4位數密碼正確就能接手，把
  // players/{slot}.tokenId改成自己的tokenId，之後由自己這台裝置繼續推送該席位的位置。
  // 「一台裝置只能操作一隻」：如果我原本已經控制別的席位，接管新的之前要先釋放舊的
  // （把舊席位的tokenId設回null，不是刪掉整個席位——名稱/角色/密碼保留，等別人之後
  // 用密碼接管，行為跟「斷線」是同一套機制，不需要另外做真的斷線偵測）。
  // 生存值（demoStat）延續：接管時把原本tokenId的demoStat值原封不動搬到新tokenId上，
  // 不是重新初始化成100——重連不該讓角色滿血復活。原本控制的tokenId在tokens/裡會變成
  // 不再更新的殘影，這是刻意的簡化（見檔案開頭的已知簡化說明），不影響demoStat的延續。
  function handleTakeover(slot) {
    var p = players[slot];
    if (!p) return;
    var input = window.prompt(window.I18N.t("midnight_takeover_prompt"));
    if (input === null) return;
    if (input !== p.passcode) {
      window.alert(window.I18N.t("midnight_takeover_wrong_password"));
      return;
    }
    var previousPos = remoteTokens[p.tokenId];
    var previousStat = demoStats[p.tokenId];
    var previousCharacter = characters[p.tokenId];
    var previousMySlot = mySlot;
    GameStorage.rtSet(gameId, "cloud", "players/" + slot + "/tokenId", myTokenId).then(function () {
      mySlot = slot;
      if (previousMySlot && previousMySlot !== slot) {
        GameStorage.rtSet(gameId, "cloud", "players/" + previousMySlot + "/tokenId", null);
      }
      if (previousPos) {
        localPos = { x: previousPos.x, y: previousPos.y };
      } else if (!localPos) {
        var spawn = findWalkableSpawnNear(map.dayPlan.day1.start, Math.random);
        localPos = { x: spawn.x, y: spawn.y };
      }
      GameStorage.rtSet(gameId, "cloud", "demoStat/" + myTokenId, previousStat === undefined ? selfArenaHpMax(previousCharacter) : previousStat);
      GameStorage.rtSet(
        gameId,
        "cloud",
        "character/" + myTokenId,
        previousCharacter === undefined ? newCharacterForSlot(slot) : previousCharacter
      );
      renderLobby();
      renderPlayersPanel();
    });
  }

  // ---- 輸入：held-key連續移動（即時制常見手感——按住方向鍵，角色持續移動），
  // 而不是回合制常見的「點一下走一步」。加上電腦端中鍵/長按標點、手機端搖桿移動＋
  // 長按標點。----
  function bindInput() {
    document.addEventListener("keydown", function (e) {
      keysDown[e.key.toLowerCase()] = true;
      if (autoFly && isMovementKey(e.key)) autoFly = null; // 移動鍵會終止靈鳥自動飛行
    });
    document.addEventListener("keyup", function (e) {
      keysDown[e.key.toLowerCase()] = false;
    });
    el("btn-midnight-enter-battle").addEventListener("click", handleEnterBattleClick);
    bindAttackHoldInput();
    el("btn-midnight-skill").addEventListener("click", handleSkillClick);
    bindSkillBHoldInput();
    el("btn-midnight-dodge").addEventListener("click", handleDodgeClick);
    bindBlockHoldInput();
    el("btn-midnight-defense-special").addEventListener("click", handleSpecialDefenseClick);
    el("btn-midnight-high-guard").addEventListener("click", handleHighGuardToggleClick);
    el("btn-midnight-eye-for-value").addEventListener("click", handleEyeForValueClick);
    el("btn-midnight-elemental-control").addEventListener("click", handleElementalControlClick);
    el("btn-midnight-art").addEventListener("click", handleArtClick);
    el("btn-midnight-character-skill").addEventListener("click", handleCharacterSkillClick);
    el("btn-midnight-use-flask").addEventListener("click", handleUseFlaskClick);
    el("btn-midnight-use-consumable").addEventListener("click", handleUseQuickConsumableClick);
    el("btn-midnight-weapon-left").addEventListener("click", function () {
      cycleEquippedWeapon("L");
    });
    el("btn-midnight-weapon-right").addEventListener("click", function () {
      cycleEquippedWeapon("R");
    });
    el("btn-midnight-tower-enter").addEventListener("click", function () {
      if (nearbyTower) handleTowerEnterClick(nearbyTower);
    });
    el("btn-midnight-tower-invite-accept").addEventListener("click", function () {
      if (nearbyTower) handleAcceptTowerInviteClick(nearbyTower);
    });
    el("btn-midnight-puzzle-submit").addEventListener("click", handlePuzzleSubmit);
    el("btn-midnight-puzzle-close").addEventListener("click", closeTowerPuzzleModal);
    el("btn-midnight-use-spirit-bird").addEventListener("click", function () {
      // 見handleTowerEnterClick()同一則2026-09-06三次優化註解：戰鬥中不能使用靈鳥飛行。
      if (!mySlot || isPaused() || activeEncounter || !nearbyBird) return;
      startAutoFly(nearbyBird);
    });
    el("btn-midnight-field-enter").addEventListener("click", function () {
      var pt = nearbyFieldPoint || nearbyCastlePoint;
      if (pt) handleEnterFieldPointClick(pt);
    });
    el("btn-midnight-field-invite-accept").addEventListener("click", function () {
      var pt = nearbyFieldPoint || nearbyCastlePoint;
      if (pt) handleAcceptFieldInviteClick(pt);
    });
    el("btn-midnight-strong-enemy-enter").addEventListener("click", handleStrongEnemyEnterClick);
    el("btn-midnight-flee-battle").addEventListener("click", handleFleeBattleClick);
    el("btn-midnight-blessing-claim").addEventListener("click", handleBlessingEnterClick);
    el("btn-midnight-blessing-use").addEventListener("click", handleBlessingUseClick);
    el("btn-midnight-blessing-close").addEventListener("click", closeBlessingModal);
    el("btn-midnight-pickup-ground-item").addEventListener("click", handlePickupGroundItem);
    el("btn-midnight-open-merchant").addEventListener("click", handleMerchantEnterClick);
    el("btn-midnight-merchant-buy-weapon").addEventListener("click", handleMerchantBuyWeapon);
    el("btn-midnight-merchant-close").addEventListener("click", closeMerchantModal);
    el("btn-midnight-scarab-mental").addEventListener("click", function () {
      handleScarabCheckClick("mental");
    });
    el("btn-midnight-scarab-luck").addEventListener("click", function () {
      handleScarabCheckClick("luck");
    });
    el("btn-midnight-scarab-physical").addEventListener("click", function () {
      handleScarabCheckClick("physical");
    });
    el("btn-midnight-reward-close").addEventListener("click", closeRewardModal);
    el("btn-midnight-open-character-sheet").addEventListener("click", openCharacterSheetModal);
    el("btn-midnight-character-sheet-close").addEventListener("click", closeCharacterSheetModal);
    el("btn-midnight-sheet-level-minus").addEventListener("click", function () {
      handleMidnightLevelDelta(-1);
    });
    el("btn-midnight-sheet-level-plus").addEventListener("click", function () {
      handleMidnightLevelDelta(1);
    });
    el("btn-midnight-sheet-relic-roll").addEventListener("click", handleMidnightRelicRoll);
    el("btn-midnight-toggle-menu").addEventListener("click", function () {
      var panel = el("midnight-menu-panel");
      panel.hidden = !panel.hidden;
    });
    el("btn-midnight-pause-game").addEventListener("click", handlePauseGame);
    el("btn-midnight-resume-game").addEventListener("click", handleResumeGame);
    el("btn-midnight-lobby-join").addEventListener("click", handleLobbyJoin);
    el("btn-midnight-lobby-ready").addEventListener("click", handleLobbyReadyToggle);
    el("btn-midnight-lobby-leave").addEventListener("click", handleLobbyLeave);
    el("midnight-lobby-night-boss-select").addEventListener("change", handleNightBossSelectChange);
    el("midnight-lobby-map-variant-select").addEventListener("change", handleMapVariantSelectChange);
    el("midnight-lobby-test-mode-checkbox").addEventListener("change", handleTestModeToggle);
    bindTestSliderInput("midnight-test-slider-enemy-hp", "midnight-test-number-enemy-hp", "enemyHpMult", 0.2, 100);
    bindTestSliderInput("midnight-test-slider-enemy-atk", "midnight-test-number-enemy-atk", "enemyAtkMult", 0, 20);
    bindTestSliderInput("midnight-test-slider-pc-dmg", "midnight-test-number-pc-dmg", "pcDmgMult", 0.2, 100);
    bindTestSliderInput("midnight-test-slider-enemy-guard", "midnight-test-number-enemy-guard", "enemyGuardValueMult", 0, 10);
    el("btn-midnight-map-icon").addEventListener("click", function () {
      setMapExpanded(!mapExpanded);
    });
    el("btn-midnight-map-close").addEventListener("click", function () {
      setMapExpanded(false);
    });
    // 2026-09-06使用者明確要求「地圖版的右上直接放置另一個關閉按鍵，可以明白關掉」：
    // 額外加一個固定在地圖modal右上角的✕按鈕，跟原本#midnight-map-panel頂端那條
    // .wb-row裡的收合地圖按鈕功能相同，只是多一個更顯眼、位置更直覺的入口。
    el("btn-midnight-map-close-corner").addEventListener("click", function () {
      setMapExpanded(false);
    });
    el("btn-midnight-restart-cycle").addEventListener("click", handleRestartCycle);
    el("btn-midnight-hud-blessing-day1").addEventListener("click", handleHudBlessingUseClick);
    el("btn-midnight-hud-day1-leave").addEventListener("click", handleDay1RewardsLeaveClick);
    el("btn-midnight-hud-blessing").addEventListener("click", handleHudBlessingUseClick);
    el("btn-midnight-open-merchant-hud").addEventListener("click", openMerchantModal);
    el("btn-midnight-hud-day2-leave").addEventListener("click", handleDay2RewardsLeaveClick);
    el("btn-midnight-ready-final-boss").addEventListener("click", handleReadyFinalBossToggle);

    bindPingInput();
    bindJoystickInput();
  }

  function isMovementKey(key) {
    var k = key.toLowerCase();
    return k === "arrowup" || k === "arrowdown" || k === "arrowleft" || k === "arrowright" || k === "w" || k === "a" || k === "s" || k === "d";
  }

  // ============================================================================
  // 體力制即時戰鬥：普通攻擊連段／戰技／迴避／防禦。體力是本地端資源（見常數區塊
  // 註解），扣血/傷害仍透過既有demoStat/{tokenId或sharedTarget}的transaction()機制同步，
  // 不重新發明第二套同步方式。
  // ============================================================================

  // 扣體力：不足時回傳false、不扣，呼叫端要因此直接放棄這次動作（不能打出去卻不扣體力）。
  function spendStamina(cost) {
    if (!mySlot || isPaused()) return false;
    if (stamina.current < cost) return false;
    stamina.current -= cost;
    return true;
  }

  function damageSharedTarget(amount) {
    GameStorage.rtTransaction(gameId, "cloud", "demoStat/sharedTarget", function (cur) {
      var next = (cur === null ? 20 : cur) - amount;
      return next < 0 ? 0 : next;
    });
  }

  // ---- 敵人Guard Point／HP價值（2026-09-06數值真正接入，比照night.jsのGuard回數/HP價值
  // 機制，docs/enemy_damage_rules.md §5，night.js不會載入這個頁面，這裡直接複製一份純函式
  // 邏輯）：通常敵人的family.guardCount（最大值）／family.guardValueTable沿用既有資料，
  // 不重新定義規則。累積方式依使用者明確規格簡化成「即時制連續累積」：▲=1單位／◆=2單位
  // （對應規則書▲=0.5點／◆=1點，用整數單位避免float同步誤差），每滿
  // GUARD_REDUCTION_THRESHOLD*2＝6單位（＝3點）就讓現在的Guard Point-1（下限0）。
  // Guard Point歸零後5秒（GUARD_BREAK_RECOVER_MS）自動回復到最大值＋單位歸零，純粹用時間
  // 差計算（guardBrokenAt存在且已經過5秒＝視為已回復），不需要額外的回復transaction。----
  function parseGuardCountValue(count) {
    if (typeof count === "number") return count;
    var text = (count && (count.zh || count.ja)) || "";
    var m = /^(\d+)/.exec(text);
    return m ? parseInt(m[1], 10) : null;
  }

  function guardValueForCount(guardValueTable, guardCountValue, level) {
    if (!guardValueTable) return null;
    var row = guardValueTable.filter(function (r) {
      return parseGuardCountValue(r.count) === guardCountValue;
    })[0];
    if (!row) return null;
    if (Array.isArray(row.value)) return row.value[Math.max(0, Math.min(row.value.length - 1, (level || 1) - 1))];
    return row.value;
  }

  // 目前的Guard Point（純函式，依trig快取的guardUnits/guardBrokenAt跟現在時間推算，
  // 不需要額外的「回復」寫入——回復純粹是「已經過了5秒」這個時間條件的自然結果）。
  function currentGuardCountForTrig(trig, guardMax) {
    if (!trig) return guardMax;
    var brokenAt = trig.guardBrokenAt || null;
    if (brokenAt) return Date.now() - brokenAt >= GUARD_BREAK_RECOVER_MS ? guardMax : 0;
    var units = trig.guardUnits || 0;
    var reduceBy = Math.floor(units / (GUARD_REDUCTION_THRESHOLD * 2));
    return Math.max(0, guardMax - reduceBy);
  }

  // 玩家攻擊命中時，若這次傷害帶有▲/◆符號（computeWeaponDamage/computeMidnightSkillDamage
  // 的hit1Symbol/hit2Symbol/symbol），累積到這個地圖點的guardUnits——已經過5秒回復期時
  // 先歸零累積再開始加總，避免舊的累積值在回復後被誤當作還沒過期。
  // ---- Day3「夜之王」資料整合（2026-09-06三次優化・完整版）：sentinel
  // enemyFamilyId==="night_boss"／enemyId=bossId，重用一般敵人同一套fieldTrigger/
  // fieldEnemyHp即時制戰鬥管線（Guard Point、HP損害、進入戰鬥流程、攻擊排程、反應窗口、
  // 併發安全transaction()），不另外整套平行系統——只在HP上限／Guard資料／選招算傷害／
  // 圖片顯示這幾個資料來源分流讀取夜王專屬資料（guardDataForTrig()／bossHpMax()／
  // pickAndResolveBossAction()／renderFieldEncounterPanel()的boss分支）。選招/算傷害
  // 直接呼叫night.js既有的自動化GM純函式模組window.PriTestAutoGm（見auto_gm.js／
  // boss_auto_gm_data.js），不重新發明夜王招式解析規則。----
  var BOSS_ENEMY_FAMILY_SENTINEL = "night_boss";

  function bossRulebookData(bossId) {
    var Rulebook = window.PriTestBossRulebook;
    return Rulebook ? Rulebook.get(bossId) : null;
  }

  // 依trig.enemyFamilyId分流取得Guard資料：一般敵人沿用window.PriTestEnemies.getFamily()，
  // 夜之王讀night_boss_rulebook.js既有的guardCount/guardValueTable（已跟一般敵人family
  // 同構的{count:Number,value:Number}形狀，不需要額外轉換）。
  function guardDataForTrig(trig) {
    if (!trig || !trig.enemyFamilyId) return null;
    if (trig.enemyFamilyId === BOSS_ENEMY_FAMILY_SENTINEL) {
      var boss = bossRulebookData(trig.enemyId);
      return boss ? { guardCount: boss.guardCount, guardValueTable: boss.guardValueTable } : null;
    }
    return window.PriTestEnemies.getFamily(trig.enemyFamilyId);
  }

  // 夜之王HP池上限：hpBoxes（night_boss_rulebook.js已結構化的每列格數陣列）加總×10
  // （沿用一般敵人既有換算慣例），套用測試模式敵人HP倍率。已知簡化：全部10隻夜王一律
  // 用單一聚合HP池，不做規則書原本的多列HP（1〜3體）UI——多列HP本身只是「顯示方式」，
  // 擊敗夜之王所需的總傷害量不變；唯一因此無法忠實呈現的是gladius分裂形態「傷害÷3同時
  // 套用到3個個體、任一個體歸零就轉回合體」的細節，見pickAndResolveBossAction()註解。
  function bossHpMax(bossId) {
    var boss = bossRulebookData(bossId);
    var total = 0;
    (boss && boss.hpBoxes ? boss.hpBoxes : []).forEach(function (n) {
      total += n || 0;
    });
    return Math.round((total || FIELD_ENEMY_HP_FALLBACK) * 10 * testMult("enemyHpMult"));
  }

  function recordGuardReductionForPoint(pointId, symbol) {
    var units = symbol === "◆" ? 2 : symbol === "▲" ? 1 : 0;
    if (!units) return;
    var trig = fieldTriggers[pointId];
    var fam = guardDataForTrig(trig);
    if (!fam || typeof fam.guardCount !== "number") return;
    GameStorage.rtTransaction(gameId, "cloud", "fieldTrigger/" + pointId, function (cur) {
      if (!cur) return cur;
      var out = {};
      for (var k in cur) out[k] = cur[k];
      var brokenAt = out.guardBrokenAt || null;
      var u = out.guardUnits || 0;
      if (brokenAt && Date.now() - brokenAt >= GUARD_BREAK_RECOVER_MS) {
        u = 0;
        brokenAt = null;
      }
      u += units;
      var reduceBy = Math.floor(u / (GUARD_REDUCTION_THRESHOLD * 2));
      var newGuard = Math.max(0, fam.guardCount - reduceBy);
      if (newGuard === 0 && !brokenAt) brokenAt = Date.now();
      // everGuardBroken：跟guardBrokenAt不同，這個欄位一旦true就永遠不會被回復流程清掉
      // （回復只清guardBrokenAt/guardUnits），供夜之王「行動激化」機制使用——規則書原文
      // 是「體勢崩潰發生後，直到戰鬥結束為止」的永久性效果，不是「目前有沒有正在崩勢中」。
      out.guardUnits = u;
      out.guardBrokenAt = brokenAt;
      if (newGuard === 0) out.everGuardBroken = true;
      return out;
    });
  }

  // 敵人HP上限：實際hp格數x10（使用者明確規格），取代原本demo佔位固定值30。讀
  // enemies_data_*.jsのfamily.base[level-1].hp既有格數字串（例："×5/×4"，"/"分隔多條
  // HP行，每行"×N"代表N格，見docs整理），找不到資料時才退回FIELD_ENEMY_HP_FALLBACK。
  // 夜之王（enemyFamilyId===night_boss）另外分流到bossHpMax()。
  function enemyRealHpMax(trig) {
    if (!trig || !trig.enemyFamilyId) return FIELD_ENEMY_HP_FALLBACK;
    if (trig.enemyFamilyId === BOSS_ENEMY_FAMILY_SENTINEL) return bossHpMax(trig.enemyId);
    var data = window.PriTestEnemies.get(trig.enemyFamilyId, trig.enemyId);
    var level = trig.level || 1;
    var lvEntry = (data && data.familyBase || []).filter(function (l) {
      return l.level === level;
    })[0];
    var hpText = lvEntry && lvEntry.hp;
    if (!hpText) return FIELD_ENEMY_HP_FALLBACK;
    var total = 0;
    String(hpText)
      .split("/")
      .forEach(function (part) {
        var m = /×(\d+)/.exec(part);
        if (m) total += parseInt(m[1], 10);
      });
    return Math.round((total || FIELD_ENEMY_HP_FALLBACK) * 10 * testMult("enemyHpMult"));
  }

  // 敵人本體HP損害（2026-09-06使用者明確規格改版，取代原本沿用night.js的floor(總傷害
  // ÷HP價值)格數換算）：「敵人的HP價值視為減傷率──HP價值80則減80%傷害」，直接
  // realDamage = amount × (1 - HP價值/100)。查Guard Point對應HP價值的方式不變
  // （guardCount／guardValueTable／▲◆累積降低Guard Point進而降低HP價值＝破防降低減傷率
  // 的機制原封不動，見currentGuardCountForTrig()/recordGuardReductionForPoint()），只有
  // 「HP價值最後拿來做什麼運算」這一步依使用者規格從night.js的格數制改成即時制專屬的
  // 百分比減傷制——這是midnight.js（即時制）跟night.js（回合制）刻意分歧的地方，不是
  // bug，回合制的格數制沿用docs/enemy_damage_rules.md §5.3不變。HP價值超出0~100的
  // 理論值（例如套用測試模式倍率後）夾在合理範圍，避免出現負傷害或减傷超過100%。
  // 找不到guard資料的敵人（理論上不會發生，25個family都有guardCount/guardValueTable）
  // 才退回直接扣原始amount（0%減傷）。
  function applyDamageToFieldEnemyHp(pointId, amount) {
    var trig = fieldTriggers[pointId];
    var fam = guardDataForTrig(trig);
    var realDamage = amount;
    var hpValueUsed = null;
    if (fam && typeof fam.guardCount === "number" && fam.guardValueTable) {
      var guardNow = currentGuardCountForTrig(trig, fam.guardCount);
      var hpValue = guardValueForCount(fam.guardValueTable, guardNow, trig.level || 1);
      if (hpValue) {
        // 測試模式「敵人防禦價值」倍率（2026-09-06新增，見testMult()說明）：直接乘進
        // HP價值（減傷率）本身，跟其餘三個倍率一樣是計算鏈最後一步的乘法，不影響規則
        // 本身的算式。
        hpValue = hpValue * testMult("enemyGuardValueMult");
        var reductionPct = Math.max(0, Math.min(100, hpValue));
        realDamage = Math.round(amount * (1 - reductionPct / 100));
      }
      hpValueUsed = hpValue;
    }
    realDamage = Math.round(realDamage * testMult("pcDmgMult"));
    lastPcDamageInfo = { amount: realDamage, rawAmount: amount, hpValue: hpValueUsed, at: Date.now() };
    GameStorage.rtTransaction(gameId, "cloud", "fieldEnemyHp/" + pointId, function (cur) {
      var max = enemyRealHpMax(trig);
      var next = (cur === null ? max : cur) - realDamage;
      return next < 0 ? 0 : next;
    });
  }

  // 攻擊/戰技實際要打的對象：如果目前站在一個已解決分歧、敵人仍存活的地圖點旁
  // （activeEncounter非null），打這個點的敵人（fieldEnemyHp/{pointId}）；否則沿用
  // 原本技術驗證片的共用標靶（demoStat/sharedTarget）。兩者都用同一套transaction()
  // 原子扣血機制，只是路徑不同。雜兵（2026-09-06死靈術前置工程新增，使用者明確規格）：
  // 這個地圖點有雜兵HP（fieldMobHp）且尚未歸零時，攻擊一律先扣雜兵HP，超過雜兵剩餘量的
  // 部分（溢出）才繼續扣到敵人本體——雜兵歸零後的必要偵測（觸發死靈術）放在
  // onFieldMobHpReceived()做，因為要讓「所有正在旁觀這個雜兵HP的client」都能各自判斷
  // 自己是否要擲骰，不能只有打出最後一擊的那個人才觸發。
  // symbol（可省略）：這次攻擊的▲/◆記號（見computeWeaponDamage等回傳的hit1Symbol/
  // hit2Symbol/symbol），2026-09-06新增，用來累積敵人本體的Guard削り值（見
  // recordGuardReductionForPoint()），跟雜兵/敵人本體傷害分配是兩件獨立的事。
  function damageCombatTarget(amount, symbol) {
    if (activeEncounter) {
      var pointId = activeEncounter.id;
      if (symbol) recordGuardReductionForPoint(pointId, symbol);
      var mobHpBefore = fieldMobHp[pointId];
      if (mobHpBefore !== undefined && mobHpBefore > 0) {
        GameStorage.rtTransaction(gameId, "cloud", "fieldMobHp/" + pointId, function (cur) {
          var current = cur === null ? 0 : cur;
          var next = current - amount;
          return next < 0 ? 0 : next;
        });
        var enemyOverflow = amount - mobHpBefore;
        if (enemyOverflow > 0) applyDamageToFieldEnemyHp(pointId, enemyOverflow);
      } else {
        applyDamageToFieldEnemyHp(pointId, amount);
      }
      // 累積每個席位對這隻敵人造成的傷害，供敵人攻擊的「敵視」目標判定使用
      // （見aggroHolderSlot()）——這個技術驗證片沒有既有仇恨值系統，使用者確認過
      // 直接用累積傷害最高者當作demo佔位規則即可。
      if (mySlot) {
        GameStorage.rtTransaction(gameId, "cloud", "fieldTrigger/" + pointId + "/damageBySlot/" + mySlot, function (cur) {
          return (cur || 0) + amount;
        });
      }
      return;
    }
    damageSharedTarget(amount);
  }

  // ---- 屬性/狀態異常共同蓄積（2026-09-05武器資料真正接入新增，見docs/enemy_damage_rules.md
  // §7）：所有攻擊者對同一個目標的蓄積值加總（RTDB transaction原子累加，天然就是「共同
  // 計算」，不需要另外合併每個角色各自的記錄）。閾值使用者明確規格「拉長為需要2倍」
  // （ATTRIBUTE_STATUS_THRESHOLD=16，見常數區塊）。目標key跟damageCombatTarget()判斷
  // 「打誰」用同一套邏輯：有activeEncounter時＝該地圖點pointId，否則＝"sharedTarget"。----
  function currentAttributeAccumTargetKey() {
    return activeEncounter ? activeEncounter.id : "sharedTarget";
  }

  function recordAttributeAccum(name, amount) {
    var targetKey = currentAttributeAccumTargetKey();
    GameStorage.rtTransaction(gameId, "cloud", "attributeAccum/" + targetKey + "/" + name, function (cur) {
      return (cur || 0) + amount;
    }).then(function (committed) {
      if (typeof committed === "number") maybeTriggerAttributeAccum(targetKey, name, committed);
    });
  }

  function onAttributeAccumReceived(value) {
    attributeAccum = value || {};
  }

  // 蓄積值每跨過一次閾值＝一次觸發（屬性可超額累計、同一時間可能觸發多次；狀態異常則
  // docs §7.4規定觸發後歸零、每回合只發揮一次——這裡簡化成「歸零後重新累積」，不额外做
  // 回合鎖，因為midnight沒有night.js的回合/phase概念）。用RTDB
  // attributeAccumTriggerClaims/{targetKey}/{name}/{觸發序號} 的first-writer-wins
  // transaction（跟fieldProgress.advancedBy<N>同一種既有寫法）避免多名攻擊者的裝置
  // 幾乎同時跨越閾值時重複觸發。
  function maybeTriggerAttributeAccum(targetKey, name, total) {
    var isAilment = ATTRIBUTE_STATUS_AILMENT_NAMES_JA.indexOf(name) !== -1;
    var key = targetKey + ":" + name;
    var prevCount = attributeAccumTriggeredCount[key] || 0;
    var newCount = Math.floor(total / ATTRIBUTE_STATUS_THRESHOLD);
    if (newCount <= prevCount) return;
    attributeAccumTriggeredCount[key] = newCount;
    for (var i = prevCount + 1; i <= newCount; i++) triggerAttributeAccumEffect(targetKey, name, isAilment, i);
    if (isAilment) {
      // 狀態異常觸發後歸零（docs §7.4「発動後は0に戻す」），屬性則保留超額部分持續累計
      // （docs §7.3，不歸零）。
      GameStorage.rtSet(gameId, "cloud", "attributeAccum/" + targetKey + "/" + name, 0);
      attributeAccumTriggeredCount[key] = 0;
    }
  }

  function triggerAttributeAccumEffect(targetKey, name, isAilment, triggerIndex) {
    GameStorage.rtTransaction(
      gameId,
      "cloud",
      "attributeAccumTriggerClaims/" + targetKey + "/" + name + "/" + triggerIndex,
      function (cur) {
        return cur === null ? myTokenId : cur;
      }
    ).then(function (committed) {
      if (committed !== myTokenId) return; // 搶輸了，這次觸發已經由別的裝置負責顯示
      applyAttributeAccumEffect(name, targetKey);
    });
  }

  // docs/enemy_damage_rules.md §7.6：多數效果本身是「HP損害■」，不可自行發明數值
  // （CLAUDE.md §19），只顯示規則原文交由GM/玩家判斷；唯一能自動化的是「呪死」——
  // 規則書效果是「撃破（瀕死則立即撃破，否則持續到異常結束）」，midnight的敵人HP只有
  // 單一數字、沒有瀕死/持續的概念，這裡對應成「直接把敵人HP歸零」。
  function applyAttributeAccumEffect(name, targetKey) {
    if (name === "呪死") {
      if (targetKey === "sharedTarget") damageSharedTarget(9999);
      else GameStorage.rtSet(gameId, "cloud", "fieldEnemyHp/" + targetKey, 0);
      showToast(window.I18N.t("midnight_attribute_accum_curse_note", { name: name }));
      return;
    }
    showToast(window.I18N.t("midnight_attribute_accum_trigger_note", { name: name }));
  }

  // 蓄積值小型顯示區塊（角色面板/戰鬥面板附近，見renderCombatPanel()呼叫）：只顯示目前
  // combat target累積中、尚未歸零的項目。
  function renderAttributeAccumNote() {
    var noteEl = el("midnight-attribute-accum-note");
    if (!noteEl) return;
    var data = attributeAccum[currentAttributeAccumTargetKey()] || {};
    var parts = [];
    ATTRIBUTE_STATUS_ELEMENT_NAMES_JA.concat(ATTRIBUTE_STATUS_AILMENT_NAMES_JA).forEach(function (name) {
      if (data[name]) parts.push(name + ":" + data[name]);
    });
    noteEl.textContent = parts.join("  ");
  }

  // ============================================================================
  // 2026-09-05武器資料真正接入：以下取代原本的demo佔位公式，直接呼叫
  // CharacterDrawer（character_drawer.js）既有的computeWeaponDamage／parseAttackCost／
  // parseActionCost／各種skill威力解析函式計算實際數值。左右手各自獨立（見comboState／
  // 常數區塊註解），一般攻擊/魔術祈禱各自綁定該側裝備的武器；戰技A（單一入口）比照
  // 右手武器（見weaponArtEntry），使用者這次只明確要求「攻擊/魔術」分左右手。
  // ============================================================================

  // 某一側（"L"/"R"）目前裝備武器的一般攻擊資料。回傳null＝這一側目前不能使用一般攻擊
  // （空手／盾牌／法杖・聖印，使用者確認：「杖與祈禱的該側攻擊按鍵非活性」）。
  function computeSideAttackInfo(side) {
    var c = characters[myTokenId];
    var weaponId = c && c["equippedWeaponId" + side];
    if (!c || !weaponId) return null;
    var weapon = Weapons.get(baseCatalogId(weaponId));
    if (!weapon) return null;
    var category = Weapons.getCategory(weapon.category);
    if (!category || category.isShield) return null;
    var dmg = CharacterDrawer.computeWeaponDamage(c, weaponId, selfArenaHp()); // 杖／聖印回傳null（無1Hit/2Hit概念）
    if (!dmg) return null;
    // 不撓（2026-09-06角色能力真正接入新增）：stacks×5/10疊加到武器攻擊1Hit/2Hit傷害
    // （比照night.js:5078-5081的unyieldingHitBonus注入點）。
    var unyieldingBonus = unyieldingHitBonus(c);
    if (unyieldingBonus.hit1 || unyieldingBonus.hit2) {
      dmg = {
        hit1Damage: dmg.hit1Damage + unyieldingBonus.hit1,
        // hit2Damage可能是null（該武器種沒有2Hit，見computeWeaponDamage），null+數字在JS會
        // 被當成0處理、誤把「沒有2Hit」變成「2Hit傷害=bonus」，因此這裡要先判斷是否為null。
        hit2Damage: dmg.hit2Damage === null ? null : dmg.hit2Damage + unyieldingBonus.hit2,
        hit1Symbol: dmg.hit1Symbol,
        hit2Symbol: dmg.hit2Symbol,
      };
    }
    var cost = CharacterDrawer.parseAttackCost(Weapons.localizedText(category.basicStats.attackCost));
    if (!cost) return null;
    return { weaponId: weaponId, dmg: dmg, cost: cost };
  }

  // 普通攻擊3連段（左右手各自獨立）：1秒判定窗口內連續點擊才算連段，超過窗口未點擊則從
  // 第1擊重新算。第1、2擊套用武器1Hit數值，第3擊套用2Hit數值（沒有2Hit資料的武器——
  // 弓/弩/投擲武器等——第3擊仍沿用1Hit數值，使用者已確認）。體力消耗＝骰子點數×2
  // （DICE_COUNT_TO_STAMINA_MULT，使用者明確規格）。
  function handleAttackClick(side) {
    if (!mySlot || isPaused()) return;
    var info = computeSideAttackInfo(side);
    if (!info) return;
    var cs = comboState[side];
    var now = Date.now();
    if (now - cs.lastHitAt > ATTACK_COMBO_WINDOW_MS) cs.hitIndex = 0;
    var isThirdHit = cs.hitIndex === 2;
    var useHit2 = isThirdHit && info.dmg.hit2Damage !== null && !!info.cost.hit2;
    var points = diceCostPoints(useHit2 ? info.cost.hit2 : info.cost.hit1);
    if (!spendStamina(points * DICE_COUNT_TO_STAMINA_MULT)) return;
    cancelFlaskReadingForOtherAction();
    cs.lastHitAt = now;
    cs.hitIndex = isThirdHit ? 0 : cs.hitIndex + 1;
    var damage = useHit2 ? info.dmg.hit2Damage : info.dmg.hit1Damage;
    var damageSymbol = useHit2 ? info.dmg.hit2Symbol : info.dmg.hit1Symbol;
    damageCombatTarget(damage, damageSymbol);
    triggerEnemyHitEffect(weaponHitColor(info.weaponId));
    applyWeaponAttributeAccumOnHit(info.weaponId, useHit2);
    // 2026-09-06優化（使用者明確要求「戰鬥畫面中敵人血量下方不顯示連段」）：拿掉原本
    // 敵人HP下方的連段文字提示，改成攻擊按鈕本身在下次攻擊會是2Hit時顯示[Hit]
    // （見renderSideCombatButtons()／attackButtonHitReady()）。
    var atkWeapon = Weapons.get(baseCatalogId(info.weaponId));
    var atkName = atkWeapon ? Weapons.localizedText(atkWeapon.name) : window.I18N.t("midnight_attack_target_button");
    broadcastCombatActionBubble(atkName);
  }

  // ============================================================================
  // 2026-09-06優化（使用者明確規格「玩家有學習到跳躍攻擊/衝刺攻擊的話，在操作面板長按
  // [攻擊]，其上方會另外顯示擁有的特殊攻擊，再點下去該特殊攻擊即可發動」）：跳躍攻擊／
  // 衝刺攻擊本身是night.js既有的「習得relic效果（kind:"Action"）」，傷害公式（1Hit傷害
  // +▲；大槍時衝刺攻擊也+▲；習得2個以上衝刺攻擊+15）直接重用
  // CharacterDrawer.findLearnedActionRelicByName／countLearnedActionRelicsByName（跟
  // night.jsのrenderCombatSpecialAttackActions同一套，見night.js:4817-4896），不重新
  //發明數值。night.js原本還有「前衛時才能用跳躍攻擊／後衛時才能用衝刺攻擊」的位置限制，
  // 但midnight.js（即時制）完全沒有前衛/後衛狀態，因此這裡不套用該限制——只要有裝備
  // 近戰武器且習得對應效果就能使用，這是midnight.js刻意跟night.js分歧的簡化（跟
  // docs/midnight_realtime_combat_numbers.md記載的Guard Point百分比減傷制同一種
  // 「即時制沒有的前提條件就不強加」的既定做法）。
  // ============================================================================
  var ATTACK_SPECIAL_MENU_HOLD_MS = 400; // 長按超過此時間才顯示選單，跟戰技B的2秒蓄力長按用途不同（這裡只是「按住看選單」不是「蓄力施放」）
  var attackHoldState = { L: null, R: null }; // 按下攻擊鍵的時間戳，null＝目前沒按著
  var attackSpecialMenuOpen = { L: false, R: false };

  // 該側目前裝備武器可用的跳躍攻擊/衝刺攻擊清單（沒有裝備近戰武器或都沒習得則為空陣列）。
  function availableSpecialAttackEntries(side) {
    var c = characters[myTokenId];
    var weaponId = c && c["equippedWeaponId" + side];
    if (!c || !weaponId) return [];
    var weapon = Weapons.get(baseCatalogId(weaponId));
    var category = weapon && Weapons.getCategory(weapon.category);
    if (!category || category.isShield || category.isRanged || category.id === "staff" || category.id === "sacred_seal") return [];
    var dmg = CharacterDrawer.computeWeaponDamage(c, weaponId, selfArenaHp());
    if (!dmg) return [];
    var out = [];
    var jumpEffect = CharacterDrawer.findLearnedActionRelicByName(c, ["跳躍攻擊", "ジャンプ攻撃"]);
    if (jumpEffect) {
      var jumpAtkUpBonus = (c.learnedAttachedEffects || []).indexOf("jump_atk_up") !== -1 ? 10 : 0;
      out.push({ kind: "jump", weaponId: weaponId, effect: jumpEffect, value: dmg.hit1Damage + dmg.artPower + jumpAtkUpBonus, symbol: dmg.hit1Symbol });
    }
    var dashEffect = CharacterDrawer.findLearnedActionRelicByName(c, ["衝刺攻擊", "ダッシュ攻撃"]);
    if (dashEffect) {
      var isGreatSpear = category.id === "great_spear";
      var dashAtkUpBonus = (c.learnedAttachedEffects || []).indexOf("dash_atk_up") !== -1 ? 10 : 0;
      var dashMultiBonus = CharacterDrawer.countLearnedActionRelicsByName(c, ["衝刺攻擊", "ダッシュ攻撃"]) >= 2 ? 15 : 0;
      out.push({
        kind: "dash",
        weaponId: weaponId,
        effect: dashEffect,
        value: dmg.hit1Damage + (isGreatSpear ? dmg.artPower : 0) + dashAtkUpBonus + dashMultiBonus,
        symbol: dmg.hit1Symbol,
      });
    }
    return out;
  }

  function bindAttackHoldInput() {
    ["L", "R"].forEach(function (side) {
      var btn = el(side === "L" ? "btn-midnight-attack-left" : "btn-midnight-attack-shared-target");
      if (!btn) return;
      btn.addEventListener("mousedown", function () {
        startAttackHold(side);
      });
      btn.addEventListener("mouseup", function () {
        endAttackHold(side);
      });
      btn.addEventListener("mouseleave", function () {
        cancelAttackHold(side);
      });
      btn.addEventListener(
        "touchstart",
        function (e) {
          e.preventDefault();
          startAttackHold(side);
        },
        { passive: false }
      );
      btn.addEventListener("touchend", function () {
        endAttackHold(side);
      });
      btn.addEventListener("touchcancel", function () {
        cancelAttackHold(side);
      });
    });
  }

  function startAttackHold(side) {
    if (!mySlot || isPaused()) return;
    attackHoldState[side] = Date.now();
  }

  function cancelAttackHold(side) {
    attackHoldState[side] = null;
  }

  // 放開時：如果長按期間選單已經被updateAttackHold()開啟，這次放開只是關閉選單，不觸發
  // 一般攻擊（避免長按看完選單、放開手時又不小心打出一發一般攻擊，浪費體力/連段）；
  // 否則（單純點擊、或沒有任何特殊攻擊可顯示）視為一般攻擊。
  function endAttackHold(side) {
    var startedAt = attackHoldState[side];
    attackHoldState[side] = null;
    if (startedAt === null || startedAt === undefined) return;
    if (attackSpecialMenuOpen[side]) {
      attackSpecialMenuOpen[side] = false;
      renderAttackSpecialMenu(side);
      return;
    }
    handleAttackClick(side);
  }

  function updateAttackHold(now) {
    ["L", "R"].forEach(function (side) {
      var startedAt = attackHoldState[side];
      if (startedAt === null || startedAt === undefined || attackSpecialMenuOpen[side]) return;
      if (now - startedAt < ATTACK_SPECIAL_MENU_HOLD_MS) return;
      if (!availableSpecialAttackEntries(side).length) return; // 沒有任何習得的特殊攻擊，維持原本「按住不放最後放開＝一般攻擊」的行為
      attackSpecialMenuOpen[side] = true;
      renderAttackSpecialMenu(side);
    });
  }

  function attackSpecialMenuElId(side) {
    return side === "L" ? "midnight-attack-special-menu-left" : "midnight-attack-special-menu";
  }

  function renderAttackSpecialMenu(side) {
    var menuEl = el(attackSpecialMenuElId(side));
    if (!menuEl) return;
    var entries = attackSpecialMenuOpen[side] ? availableSpecialAttackEntries(side) : [];
    menuEl.hidden = !entries.length;
    menuEl.innerHTML = "";
    entries.forEach(function (entry) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "midnight-attack-special-btn";
      var name = window.I18N.t(entry.kind === "jump" ? "midnight_special_attack_jump_label" : "midnight_special_attack_dash_label");
      btn.textContent = name + " " + CharacterDrawer.formatValueWithSymbol(entry.value, entry.symbol);
      btn.addEventListener("click", function () {
        useSpecialAttack(side, entry);
      });
      menuEl.appendChild(btn);
    });
  }

  // 消耗解析沿用武器戰技/魔術祈禱同一套computeMidnightSkillCost（本文「消耗：①①」→
  // 骰子點數×2體力），跟castWeaponSkillEntry()同一套資源檢查/扣除模式。
  function useSpecialAttack(side, entry) {
    if (!mySlot || isPaused()) return;
    attackSpecialMenuOpen[side] = false;
    renderAttackSpecialMenu(side);
    var c = characters[myTokenId];
    if (!c) return;
    var bodyText = window.PriTestCharacterTypes.localizedText(entry.effect.body);
    var cost = computeMidnightSkillCost(bodyText);
    if (stamina.current < cost.staminaCost || fp.current < cost.fpCost) return;
    cancelFlaskReadingForOtherAction();
    if (cost.staminaCost) spendStamina(cost.staminaCost);
    if (cost.fpCost) spendFp(cost.fpCost);
    if (cost.hpCost) spendSelfHp(cost.hpCost);
    damageCombatTarget(entry.value, entry.symbol);
    triggerEnemyHitEffect(weaponHitColor(entry.weaponId));
    var name = window.I18N.t(entry.kind === "jump" ? "midnight_special_attack_jump_label" : "midnight_special_attack_dash_label");
    broadcastCombatActionBubble(name);
  }

  // 武器固有的屬性/狀態異常技能（weapons.js的elementSkillBody/statusSkillBody樣板：
  // 「戰技不發揮」，只在一般攻擊以總合傷害命中時才觸發）：1Hit蓄積+1，2Hit蓄積+2，直接
  // 重用character_drawer.js既有的weaponAccumulationEffects()判斷武器有哪些屬性/異常技能
  // （含毒蠍系裝飾品的+1 scorpionBonus），不重新解析weapon.skills。
  function applyWeaponAttributeAccumOnHit(weaponId, isHit2) {
    var c = characters[myTokenId];
    if (!c) return;
    var effects = CharacterDrawer.weaponAccumulationEffects(c, weaponId);
    if (!effects.length) return;
    var base = isHit2 ? 2 : 1;
    effects.forEach(function (eff) {
      recordAttributeAccum(eff.label, base + eff.scorpionBonus);
    });
  }

  // 戰技／魔術／祈禱共用的消耗解析：CharacterDrawer.parseActionCost(body)回傳的骰子成本
  // （見diceCostPoints()）換算體力×2；fpCost／hpCost（本文「FP■■」「HP■■」中■的
  // 個數，parseActionCost既有解析結果，不是自行發明的數字）換算FP/HP×10（使用者明確
  // 規格：「戰技魔術祈禱本文的方塊格數x10，戰技有骰子點數消耗時，額外扣體力x2」）。
  function computeMidnightSkillCost(bodyText) {
    var cost = CharacterDrawer.parseActionCost(bodyText);
    return {
      staminaCost: diceCostPoints(cost) * DICE_COUNT_TO_STAMINA_MULT,
      fpCost: cost.fpCost * BLOCK_SQUARE_COUNT_TO_RESOURCE_MULT,
      hpCost: cost.hpCost * BLOCK_SQUARE_COUNT_TO_RESOURCE_MULT,
    };
  }

  // 戰技／魔術／祈禱傷害：沿用既有fallback鏈（跟night.js的computeSkillDamage同一套
  // 判斷方針）。杖/聖印一律用spellSkillPowerValue（威力數字不需明寫"+戰技威力"也視為
  // 已含），其餘武器用artSkillPowerValue（需本文明寫）。都失敗則退到
  // fixedSkillPowerValue／bareGuardSymbolSkillValue，仍失敗則回傳null（無法解算威力，
  // 交由GM/玩家依規則原文判斷，不發明數值）。
  function computeMidnightSkillDamage(c, weaponId, bodyText) {
    var artPower = 0;
    var isSpell = false;
    var skillDamageKind = null;
    if (weaponId) {
      var weapon = Weapons.get(baseCatalogId(weaponId));
      var category = weapon && Weapons.getCategory(weapon.category);
      var artInfo = CharacterDrawer.computeArtPower(c, weaponId);
      artPower = artInfo ? artInfo.artPower : 0;
      isSpell = !!(category && (category.id === "staff" || category.id === "sacred_seal"));
      // skillDamageKindはnight.jsのcomputeSkillDamageと同じ分類（見night.js:5237）：
      // 附帶効果「戰技/魔術/祈禱傷害+5」（attachedSkillDamageBonus）のkind判定に使う。
      if (category) skillDamageKind = category.id === "staff" ? "sorcery" : category.id === "sacred_seal" ? "incant" : "art";
    }
    var result = isSpell ? CharacterDrawer.spellSkillPowerValue(bodyText, artPower) : CharacterDrawer.artSkillPowerValue(bodyText, artPower);
    if (!result) result = CharacterDrawer.fixedSkillPowerValue(bodyText);
    if (!result) result = CharacterDrawer.bareGuardSymbolSkillValue(bodyText);
    if (!result) return null;
    // 固定加成（跟night.jsのcomputeSkillDamage同一批，見night.js:5258-5266）：只有解算出
    // 基礎威力時才疊加，避免對無法計算的技能捏造數值（CLAUDE.md §19）。
    var selfHp = selfArenaHp();
    var flatBonus =
      CharacterDrawer.talismanFlatSkillBonus(c, selfHp) +
      CharacterDrawer.fightingSpiritFlatBonus(c, selfHp) +
      unyieldingSkillBonus(c) +
      (skillDamageKind ? CharacterDrawer.attachedSkillDamageBonus(c, skillDamageKind) : 0);
    return { value: result.value + flatBonus, symbol: result.symbol };
  }

  // 觸發一次戰技／魔術／祈禱（戰技A即時觸發／戰技B長按滿後觸發共用同一個函式）：先確認
  // 體力/FP都足夠才真正扣款（避免體力扣了才發現FP不夠、且已扣的體力沒有回滾機制的問題），
  // HP消耗（HP■×10）沒有事先檢查門檻——比照「代價類」技能允許扣到低血，不額外發明限制。
  function castWeaponSkillEntry(entry) {
    if (!mySlot || isPaused()) return;
    var c = characters[myTokenId];
    if (!c) return;
    var bodyText = Weapons.localizedText(entry.body);
    var cost = computeMidnightSkillCost(bodyText);
    if (stamina.current < cost.staminaCost || fp.current < cost.fpCost) return;
    cancelFlaskReadingForOtherAction();
    if (cost.staminaCost) spendStamina(cost.staminaCost);
    if (cost.fpCost) spendFp(cost.fpCost);
    if (cost.hpCost) spendSelfHp(cost.hpCost);
    var dmgInfo = computeMidnightSkillDamage(c, entry.weaponId, bodyText);
    var name = Weapons.localizedText(entry.name);
    if (dmgInfo) {
      damageCombatTarget(dmgInfo.value, dmgInfo.symbol);
      triggerEnemyHitEffect(weaponHitColor(entry.weaponId));
      showToast(name + "：" + (dmgInfo.symbol ? dmgInfo.value + " + " + dmgInfo.symbol : String(dmgInfo.value)));
    } else {
      // 威力無法自動解算（■或未預期的本文格式）：不發明數值，顯示規則原文交由GM/玩家判斷
      // （CLAUDE.md §19既有慣例）。
      showToast(name + "：" + bodyText);
    }
    broadcastCombatActionBubble(name);
  }

  function spendSelfHp(amount) {
    var maxHp = mySelfHpMaxFallback();
    GameStorage.rtTransaction(gameId, "cloud", "demoStat/" + myTokenId, function (cur) {
      var next = (cur === null ? maxHp : cur) - amount;
      return next < 0 ? 0 : next;
    });
  }

  // 戰技A（單一入口，比照右手武器——使用者這次只明確要求「攻擊/魔術」分左右手）：
  // 一般武器（非杖/聖印/盾）固有的Action類戰技，直接重用
  // CharacterDrawer.getEquippedWeaponSkillEntries(c)（night.js既有函式，讀c.equippedWeaponIds，
  // 見syncEquippedWeaponIds）取得目前裝備武器的戰技清單。
  function weaponArtEntry() {
    var c = characters[myTokenId];
    var weaponId = c && c.equippedWeaponIdR;
    if (!c || !weaponId) return null;
    var weapon = Weapons.get(baseCatalogId(weaponId));
    var category = weapon && Weapons.getCategory(weapon.category);
    if (!category || category.isShield || category.id === "staff" || category.id === "sacred_seal") return null;
    var matches = CharacterDrawer.getEquippedWeaponSkillEntries(c).filter(function (e) {
      return e.weaponId === weaponId;
    });
    return matches[0] || null;
  }

  function handleSkillClick() {
    var entry = weaponArtEntry();
    if (!entry) return;
    castWeaponSkillEntry(entry);
  }

  // ---- 角色專屬〔技藝〕〔技能〕（2026-09-05戰鬥優化新增，2026-09-06改用時間冷卻）：
  // 對應character_types.js的type.arts[0]／type.skills[0]（例：追蹤者的「襲擊之楔」／
  // 「爪擊」），跟上面btn-midnight-skill/skill-b（通用武器戰技）是不同東西。冷卻時間到才
  // 能再用（用角色物件上的_artCooldownUntil／_skillCooldownUntil追蹤，見
  // useCharacterAbility()／ART_COOLDOWN_MS／SKILL_COOLDOWN_MS）、對目前combat target
  // 造成傷害、並把完整body文字用showToast()既有機制顯示——不新增第二套action log系統。----

  // 角色技藝/技能的實際傷害計算（2026-09-05角色能力真正接入新增，取代先前的
  // CHARACTER_ABILITY_DAMAGE demo佔位值）：依night.js既有computeSkillDamage規則
  // （night.js:5225-5320）確認——type.arts[0]/type.skills[0]沒有weaponId，因此不走
  // computeArtPower（那是武器戰技/魔術/祈禱專用），而是fixedSkillPowerValue解析本文
  // 明寫的固定數值，疊加talismanFlatSkillBonus／fightingSpiritFlatBonus兩個固定加成
  // （attachedSkillDamageBonus在night.js只套用在有weaponId的entry，故不套用於此）。
  // hpOverride：character_drawer.js的這兩個函式原本讀c.hp（角色卡等級養成用的RPG HP），
  // 但midnight自己的即時戰鬥HP另外存在demoStats（見spendSelfHp/demoStat同款機制），
  // 兩者刻度不同（demoStat是即時制競技場血量，換算公式見selfArenaHpMax()；c.hp是等級
  // 對應的RPG血量上限，兩者不能直接互換），
  // 因此改用hpOverride參數傳入即時HP，不能直接同步覆寫c.hp（會弄壞等級養成用的數值）。
  // 算不出來（本文含未解析的■或格式外）時回傳null，交由呼叫端顯示規則原文，不發明數值
  // （CLAUDE.md §19）。
  function computeCharacterAbilityDamage(c, ability) {
    var bodyText = window.PriTestCharacterTypes.localizedText(ability.body);
    var dmg = CharacterDrawer.fixedSkillPowerValue(bodyText);
    if (!dmg) return null;
    var selfHp = selfArenaHp();
    var flatBonus =
      CharacterDrawer.talismanFlatSkillBonus(c, selfHp) + CharacterDrawer.fightingSpiritFlatBonus(c, selfHp) + unyieldingSkillBonus(c);
    return { value: dmg.value + flatBonus, symbol: dmg.symbol };
  }

  // 遺物效果驅動的替代技藝/技能/防禦（2026-09-05角色能力真正接入新增，見CLAUDE.md §36）：
  // 掃描c.learnedRelicEffects裡帶有variantEntry欄位的遺物效果。單一資料來源是
  // character_types.js（night.js的renderCombatSkillAction／renderCombatDefenseAction讀
  // 同一個欄位，見night.js:5347-5371／8340-8354），這裡不重新定義規則文字。回傳
  // {skill:[], art:[], defense:[]}三個陣列，因為同一角色可能同時習得多個變體
  // （例如隱者混成魔法最多4選項）。
  function learnedVariantEntries(c, type) {
    var CD = window.PriTestCharacterDrawer;
    var out = { skill: [], art: [], defense: [] };
    if (!c || !type) return out;
    var learned = c.learnedRelicEffects || [];
    (type.relicEffectGroups || []).forEach(function (g, gi) {
      (g.effects || []).forEach(function (e, ei) {
        if (!e.variantEntry) return;
        if (learned.indexOf(CD.relicEffectKey(type.id, gi, ei)) === -1) return;
        var v = e.variantEntry;
        if (v.action || v.defense) {
          if (v.action) out[v.action.slot === "art" ? "art" : "skill"].push(v.action);
          if (v.defense) out.defense.push(v.defense);
        } else if (v.kind === "Defense") {
          out.defense.push(v);
        } else {
          out[v.slot === "art" ? "art" : "skill"].push(v);
        }
      });
    });
    return out;
  }

  function characterAbilityEntry(kind) {
    var c = characters[myTokenId];
    var type = c && c.typeId ? window.PriTestCharacterTypes.get(c.typeId) : null;
    var baseAbility = type ? (kind === "art" ? (type.arts || [])[0] : (type.skills || [])[0]) : null;
    // 已選定的替代招式（角色面板切換，見renderSkillArtSlot）：以combined [base].concat(variants)
    // 的index儲存於c._selectedArtVariantIndex／_selectedSkillVariantIndex，避免用entry.id當
    // key——追蹤者的速擊變體刻意跟實entry共用同一個id（見character_types.js的
    // variantEntry.quickVariant注解），用id判斷會混淆「選了變體」跟「用基礎招式」。
    var variants = type ? learnedVariantEntries(c, type)[kind] : [];
    var selectedField = kind === "art" ? "_selectedArtVariantIndex" : "_selectedSkillVariantIndex";
    var selectedIdx = c ? c[selectedField] || 0 : 0;
    var ability = selectedIdx >= 1 && variants[selectedIdx - 1] ? variants[selectedIdx - 1] : baseAbility;
    return { c: c, type: type, ability: ability, baseAbility: baseAbility, variants: variants };
  }

  function useCharacterAbility(kind) {
    if (!mySlot || isPaused()) return;
    var found = characterAbilityEntry(kind);
    if (!found.c || !found.ability) return;
    // 2026-09-06數值真正接入：技藝/技能不再用「使用次數」（_artUsesRemaining/
    // _skillUsesRemaining）限制，改用使用者明確規格的時間冷卻——技藝180秒
    // （ART_COOLDOWN_MS）、技能60秒（SKILL_COOLDOWN_MS），換日立即重置（見
    // updateAutoDayAdvance()裡對resetAbilityCooldowns()的呼叫）。
    var usedViaPowerResonanceCredit = false;
    var cooldownField = kind === "art" ? "_artCooldownUntil" : "_skillCooldownUntil";
    var cooldownUntil = found.c[cooldownField] || 0;
    if (Date.now() < cooldownUntil) {
      // 力量感應（送葬人被動，2026-09-05角色能力真正接入新增）：其他PC使用技藝時累積的
      // credit可以不受冷卻限制地使用自己的技藝——見broadcastArtUseEvent／
      // onAbilityUseEventsReceived。只對kind==="art"生效（跟night.js「不祥一擊」限定
      // 技藝一致，技能不適用）。
      if (kind === "art" && (found.c._powerResonanceCredits || 0) > 0) {
        usedViaPowerResonanceCredit = true;
        var nextCredits = found.c._powerResonanceCredits - 1;
        found.c._powerResonanceCredits = nextCredits;
        GameStorage.rtSet(gameId, "cloud", "character/" + myTokenId + "/_powerResonanceCredits", nextCredits);
      } else {
        showToast(window.I18N.t("midnight_character_ability_cooldown_note", { seconds: Math.ceil((cooldownUntil - Date.now()) / 1000) }));
        return;
      }
    } else {
      var nextCooldownUntil = Date.now() + (kind === "art" ? ART_COOLDOWN_MS : SKILL_COOLDOWN_MS);
      found.c[cooldownField] = nextCooldownUntil;
      GameStorage.rtSet(gameId, "cloud", "character/" + myTokenId + "/" + cooldownField, nextCooldownUntil);
    }
    cancelFlaskReadingForOtherAction();
    // 力量感應觸發點：任何PC使用技藝（非以credit免費使用時）都要廣播，讓其他持有力量感應
    // 被動的玩家累積credit——比照night.js「以力量感應使用的技藝不適用此效果」，credit消耗
    // 的這次使用不重新廣播，避免連鎖。
    if (kind === "art" && !usedViaPowerResonanceCredit) broadcastArtUseEvent();
    var CharacterTypes = window.PriTestCharacterTypes;
    var name = CharacterTypes.localizedText(found.ability.name);
    var body = CharacterTypes.localizedText(found.ability.body);
    var dmgInfo = computeCharacterAbilityDamage(found.c, found.ability);
    if (dmgInfo) {
      damageCombatTarget(dmgInfo.value, dmgInfo.symbol);
      // 角色專屬能力不綁定特定武器，沒有武器屬性技能的概念，固定顯示無屬性（白色）刀光。
      triggerEnemyHitEffect(null);
      showToast(name + "：" + (dmgInfo.symbol ? dmgInfo.value + " + " + dmgInfo.symbol : String(dmgInfo.value)));
    } else {
      // 威力無法自動解算（■或未預期的本文格式）：不發明數值，顯示規則原文交由GM/玩家判斷
      // （CLAUDE.md §19既有慣例，比照castWeaponSkillEntry的同款fallback）。
      showToast(name + "：" + body);
    }
    broadcastCombatActionBubble(name);
  }

  // 力量感應（送葬人/送葬人黎明被動，2026-09-05角色能力真正接入新增）：任何PC使用技藝時，
  // 對abilityUseEvents/{tokenId}寫入時間戳廣播；持有此被動的其他玩家client訂閱後比對
  // lastSeenAbilityUseEventTs判斷是否為「新」事件，是則累積一個免費使用credit
  // （_powerResonanceCredits，見useCharacterAbility()的消耗點）。
  var lastSeenAbilityUseEventTs = {}; // tokenId -> 已處理過的時間戳，初次訂閱時的既有值不算新事件

  function broadcastArtUseEvent() {
    GameStorage.rtSet(gameId, "cloud", "abilityUseEvents/" + myTokenId, Date.now());
  }

  function onAbilityUseEventsReceived(value) {
    var events = value || {};
    Object.keys(events).forEach(function (tokenId) {
      if (tokenId === myTokenId) return;
      var ts = events[tokenId];
      if (lastSeenAbilityUseEventTs[tokenId] === undefined) {
        lastSeenAbilityUseEventTs[tokenId] = ts;
        return;
      }
      if (ts <= lastSeenAbilityUseEventTs[tokenId]) return;
      lastSeenAbilityUseEventTs[tokenId] = ts;
      grantPowerResonanceCreditIfApplicable();
    });
  }

  function grantPowerResonanceCreditIfApplicable() {
    var c = characters[myTokenId];
    var type = c && c.typeId ? window.PriTestCharacterTypes.get(c.typeId) : null;
    var hasPowerResonance =
      type &&
      (type.abilities || []).some(function (a) {
        return a.id === "power_resonance";
      });
    if (!c || !hasPowerResonance) return;
    var next = (c._powerResonanceCredits || 0) + 1;
    c._powerResonanceCredits = next;
    GameStorage.rtSet(gameId, "cloud", "character/" + myTokenId + "/_powerResonanceCredits", next);
  }

  // 隊友使用攻擊／技能提示（2026-09-05使用者明確要求「除了迴避防禦，攻擊/技能會短暫
  // 出現在自己血量資訊框右邊，隊友的也類似對話框暫時顯示，暫存2秒後消失」；2026-09-06
  // 再次明確要求「按下後要更新使用的動作且要有向上滑動的動畫，一名玩家可以同時顯示兩筆
  // 動作，新的動作發生時往上捲動一筆」）：跟上面abilityUseEvents同一種「寫時間戳到RTDB、
  // 其他client訂閱後比對」的既有廣播模式，只是combatActionEvents/{tokenId}改存最新兩筆
  // 的陣列（舊的在前、新的在後），讓每個裝置各自依「now - at < COMBAT_ACTION_BUBBLE_MS」
  // 本地判斷單筆是否還要顯示，不需要額外的清除transaction。渲染掛在
  // renderOccupiedSlotCard()既有的每位玩家卡片上（見該函式），「上滑」效果直接靠每次
  // render都重建DOM節點時套用CSS animation（.midnight-action-bubble-line，見style.css），
  // 新節點被插入時animation自然播放一次，不需要額外的RAF/reflow技巧。
  var COMBAT_ACTION_BUBBLE_MS = 2000;
  var combatActionEvents = {}; // tokenId -> [{text, at}, ...]，最多2筆

  function broadcastCombatActionBubble(text) {
    if (!myTokenId) return;
    var list = (combatActionEvents[myTokenId] || []).slice();
    list.push({ text: text, at: Date.now() });
    if (list.length > 2) list = list.slice(list.length - 2);
    combatActionEvents[myTokenId] = list;
    GameStorage.rtSet(gameId, "cloud", "combatActionEvents/" + myTokenId, list);
    renderPlayersPanel();
    setTimeout(renderPlayersPanel, COMBAT_ACTION_BUBBLE_MS + 50);
  }

  function onCombatActionEventsReceived(value) {
    combatActionEvents = value || {};
    renderPlayersPanel();
    var latestAt = 0;
    Object.keys(combatActionEvents).forEach(function (tokenId) {
      (combatActionEvents[tokenId] || []).forEach(function (ev) {
        if (ev && ev.at > latestAt) latestAt = ev.at;
      });
    });
    if (latestAt) setTimeout(renderPlayersPanel, Math.max(0, latestAt + COMBAT_ACTION_BUBBLE_MS - Date.now()) + 50);
  }

  function handleArtClick() {
    useCharacterAbility("art");
  }

  function handleCharacterSkillClick() {
    useCharacterAbility("skill");
  }

  // 依角色類型是否有arts/skills決定按鈕顯示與否＋文字，每影格呼叫（跟renderCombatPanel
  // 同量級的cheap DOM更新，角色類型不會在對局中途變動，但characters[myTokenId]物件
  // 參照可能因onCharactersReceived而換掉，用簡單粗暴的每影格重設避免漏更新）。
  // 冷卻中的按鈕文字：本體名稱後面加「（N秒）」倒數，跟本文其餘資源不足時disable的既有
  // pattern一致，不需要另外的視覺元件。
  function abilityLabelWithCooldown(name, c, cooldownField) {
    var until = (c && c[cooldownField]) || 0;
    var remain = Math.ceil((until - Date.now()) / 1000);
    return remain > 0 ? name + window.I18N.t("midnight_ability_cooldown_suffix", { seconds: remain }) : name;
  }

  function renderCharacterActionButtons() {
    var found = characterAbilityEntry("art");
    var artBtn = el("btn-midnight-art");
    artBtn.hidden = !found.ability;
    if (found.ability) {
      var artName = window.PriTestCharacterTypes.localizedText(found.ability.name);
      var artCooldownUntil = (found.c && found.c._artCooldownUntil) || 0;
      el("midnight-art-label").textContent = abilityLabelWithCooldown(artName, found.c, "_artCooldownUntil");
      artBtn.disabled = Date.now() < artCooldownUntil && !((found.c && found.c._powerResonanceCredits) > 0);
    }
    var foundSkill = characterAbilityEntry("skill");
    var skillBtn = el("btn-midnight-character-skill");
    skillBtn.hidden = !foundSkill.ability;
    if (foundSkill.ability) {
      var skillName = window.PriTestCharacterTypes.localizedText(foundSkill.ability.name);
      var skillCooldownUntil = (foundSkill.c && foundSkill.c._skillCooldownUntil) || 0;
      el("midnight-character-skill-label").textContent = abilityLabelWithCooldown(skillName, foundSkill.c, "_skillCooldownUntil");
      skillBtn.disabled = Date.now() < skillCooldownUntil;
    }

    // 特殊防禦按鈕（2026-09-05角色能力真正接入新增）：第六感／遺物效果額外防禦選項，見
    // availableSpecialDefenseOption()。
    var c = characters[myTokenId];
    var type = c && c.typeId ? window.PriTestCharacterTypes.get(c.typeId) : null;
    var specialOption = availableSpecialDefenseOption(c, type);
    var specialBtn = el("btn-midnight-defense-special");
    specialBtn.hidden = !specialOption;
    if (specialOption) {
      var CharacterTypes = window.PriTestCharacterTypes;
      var label = specialOption.kind === "sixthSense" ? CharacterTypes.localizedText(specialOption.ability.name) : CharacterTypes.localizedText(specialOption.entry.name);
      el("midnight-defense-special-label").textContent = label;
    }

    // 高防禦切換鈕（2026-09-05角色能力真正接入新增）：見handleHighGuardToggleClick()。
    var highGuardBtn = el("btn-midnight-high-guard");
    var hgAbility = highGuardAbility(type);
    highGuardBtn.hidden = !hgAbility;
    if (hgAbility) {
      highGuardBtn.textContent = window.PriTestCharacterTypes.localizedText(hgAbility.name) + (c && c._highGuardActive ? " ✓" : "");
      highGuardBtn.classList.toggle("midnight-sheet-variant-active", !!(c && c._highGuardActive));
    }

    // 元素操控按鈕（2026-09-05角色能力真正接入新增）：見handleElementalControlClick()。
    var elementalControlBtn = el("btn-midnight-elemental-control");
    var ecAbility = elementalControlAbility(type);
    elementalControlBtn.hidden = !ecAbility;
    if (ecAbility) {
      elementalControlBtn.textContent =
        window.PriTestCharacterTypes.localizedText(ecAbility.name) + "(" + (c && c.elementalMarks ? c.elementalMarks : 0) + "/" + ELEMENTAL_MARKS_MAX + ")";
    }
  }

  // 扣FP：不足時回傳false、不扣，跟spendStamina()同一種寫法。
  function spendFp(cost) {
    if (!mySlot || isPaused()) return false;
    if (fp.current < cost) return false;
    fp.current -= cost;
    return true;
  }

  // 戰技B（魔術／祈禱，長按2秒才確定施放，消耗FP/體力）：左右手各自獨立，且杖/聖印
  // 若同時具有2個固定魔術/祈禱（例：隱者的杖同時有「輝石飛彈」＋「輝石弧光」）要拆分成
  // 2顆按鈕（使用者明確規格），每顆按鈕各自的長按狀態記在sorceryHoldState（key見常數
  // 區塊註解）。slot:null的按鈕只在該側「剛好只有1個固定魔術/祈禱」時使用；slot:0/1
  // 的按鈕只在「剛好有2個」時使用——renderSideCombatButtons()負責依實際武器資料切換
  // 顯示哪一組。
  var SORCERY_BUTTON_DEFS = [
    { key: "R", btnId: "btn-midnight-skill-b", side: "R", slot: null, labelId: "midnight-skill-b-label", fillId: "midnight-skill-b-cast-fill" },
    { key: "R:0", btnId: "btn-midnight-skill-b1", side: "R", slot: 0, labelId: "midnight-skill-b1-label", fillId: "midnight-skill-b1-cast-fill" },
    { key: "R:1", btnId: "btn-midnight-skill-b2", side: "R", slot: 1, labelId: "midnight-skill-b2-label", fillId: "midnight-skill-b2-cast-fill" },
    {
      key: "L",
      btnId: "btn-midnight-skill-b-left",
      side: "L",
      slot: null,
      labelId: "midnight-skill-b-label-left",
      fillId: "midnight-skill-b-cast-fill-left",
    },
    {
      key: "L:0",
      btnId: "btn-midnight-skill-b1-left",
      side: "L",
      slot: 0,
      labelId: "midnight-skill-b1-label-left",
      fillId: "midnight-skill-b1-cast-fill-left",
    },
    {
      key: "L:1",
      btnId: "btn-midnight-skill-b2-left",
      side: "L",
      slot: 1,
      labelId: "midnight-skill-b2-label-left",
      fillId: "midnight-skill-b2-cast-fill-left",
    },
  ];
  var SORCERY_BUTTON_DEFS_BY_KEY = {};
  SORCERY_BUTTON_DEFS.forEach(function (def) {
    SORCERY_BUTTON_DEFS_BY_KEY[def.key] = def;
  });

  // 目前裝備在某一側的杖/聖印固定魔術/祈禱清單（kind:"art"，不含"random"抽卡欄——沿用
  // 「未解決交由GM」的既有慣例，不新增自動抽卡）。非杖/聖印或空手回傳空陣列。
  function weaponSpellEntries(side) {
    var c = characters[myTokenId];
    var weaponId = c && c["equippedWeaponId" + side];
    if (!c || !weaponId) return [];
    var weapon = Weapons.get(baseCatalogId(weaponId));
    var category = weapon && Weapons.getCategory(weapon.category);
    if (!category || (category.id !== "staff" && category.id !== "sacred_seal")) return [];
    return CharacterDrawer.getEquippedWeaponSkillEntries(c).filter(function (e) {
      return e.weaponId === weaponId;
    });
  }

  function sorceryButtonEntry(def) {
    var entries = weaponSpellEntries(def.side);
    if (def.slot === null) return entries.length === 1 ? entries[0] : null;
    return entries[def.slot] || null;
  }

  function bindSkillBHoldInput() {
    SORCERY_BUTTON_DEFS.forEach(function (def) {
      var btn = el(def.btnId);
      if (!btn) return;
      btn.addEventListener("mousedown", function () {
        startSkillBHold(def.key);
      });
      btn.addEventListener("mouseup", function () {
        endSkillBHold(def.key);
      });
      btn.addEventListener("mouseleave", function () {
        endSkillBHold(def.key);
      });
      btn.addEventListener(
        "touchstart",
        function (e) {
          e.preventDefault();
          startSkillBHold(def.key);
        },
        { passive: false }
      );
      btn.addEventListener("touchend", function () {
        endSkillBHold(def.key);
      });
      btn.addEventListener("touchcancel", function () {
        endSkillBHold(def.key);
      });
    });
  }

  function startSkillBHold(key) {
    if (!mySlot || isPaused() || sorceryHoldState[key]) return;
    var def = SORCERY_BUTTON_DEFS_BY_KEY[key];
    var entry = def && sorceryButtonEntry(def);
    if (!entry) return;
    var cost = computeMidnightSkillCost(Weapons.localizedText(entry.body));
    if (stamina.current < cost.staminaCost || fp.current < cost.fpCost) return;
    sorceryHoldState[key] = Date.now();
  }

  function endSkillBHold(key) {
    delete sorceryHoldState[key]; // 未滿SORCERY_CAST_HOLD_MS前放開＝取消，不消耗不觸發
  }

  // 長按滿SORCERY_CAST_HOLD_MS才真正觸發，跟戰技A共用castWeaponSkillEntry()。
  function updateSorceryHold(now) {
    Object.keys(sorceryHoldState).forEach(function (key) {
      if (now - sorceryHoldState[key] < SORCERY_CAST_HOLD_MS) return;
      delete sorceryHoldState[key]; // 先清掉避免同一次長按重複觸發
      var def = SORCERY_BUTTON_DEFS_BY_KEY[key];
      var entry = def && sorceryButtonEntry(def);
      if (entry) castWeaponSkillEntry(entry);
    });
  }

  // 迴避：消耗10體力。體力不足時spendStamina()會回傳false、不記錄這次迴避時間點，等於
  // 這次迴避沒有真正生效——見resolveMyIncomingHit()判定「這一擊有沒有被成功迴避」。
  function handleDodgeClick() {
    if (!spendStamina(STAMINA_COST_DODGE)) return;
    cancelFlaskReadingForOtherAction();
    dodgePressedAt = Date.now();
  }

  // 特殊防禦選項（2026-09-05角色能力真正接入新增，見CLAUDE.md §36）：第六感（追蹤者被動）
  // 或遺物效果驅動的額外防禦（冰塊之棺／妖刀解放系／探求的衝擊波緩和）。規則書原文都是
  // 「視為自身進行了『HP價值：60~100』的防禦/迴避」——這個HP價值本來就足以扛下絕大多數
  // 敵人攻擊傷害（見resolveEnemyActionOutcome()），因此統一比照迴避的完全無效化處理，
  // 不做百分比減免（不新增規則書沒有的中間態）。第六感（passive、使用次數限定）跟其餘relic變體
  // （每個角色類型專屬、不會跟第六感共存）互斥，取第一個可用者。
  function availableSpecialDefenseOption(c, type) {
    if (!c || !type) return null;
    var sixthSenseAbility = (type.abilities || []).filter(function (a) {
      return a.id === "sixth_sense";
    })[0];
    if (sixthSenseAbility) {
      var CD = window.PriTestCharacterDrawer;
      var remaining = c._sixthSenseUsesRemaining;
      if (remaining === undefined || remaining === null) remaining = (sixthSenseAbility.uses || 0) + CD.getSkillUsesBonus(c);
      return { kind: "sixthSense", ability: sixthSenseAbility, remaining: remaining };
    }
    var variant = learnedVariantEntries(c, type).defense[0];
    return variant ? { kind: "relicVariant", entry: variant } : null;
  }

  // 實際扣資源（第六感扣使用次數；遺物變體依本文「消耗：N」骰子成本換算體力，跟一般戰技
  // 同一套diceCostPoints×DICE_COUNT_TO_STAMINA_MULT公式）。回傳是否扣款成功。
  function trySpendSpecialDefenseCost(c, option) {
    if (option.kind === "sixthSense") {
      if (option.remaining <= 0) return false;
      var next = option.remaining - 1;
      c._sixthSenseUsesRemaining = next;
      GameStorage.rtSet(gameId, "cloud", "character/" + myTokenId + "/_sixthSenseUsesRemaining", next);
      return true;
    }
    var bodyText = window.PriTestCharacterTypes.localizedText(option.entry.body);
    var cost = CharacterDrawer.parseActionCost(bodyText);
    return spendStamina(diceCostPoints(cost) * DICE_COUNT_TO_STAMINA_MULT);
  }

  function handleSpecialDefenseClick() {
    var c = characters[myTokenId];
    var type = c && c.typeId ? window.PriTestCharacterTypes.get(c.typeId) : null;
    if (!mySlot || isPaused() || !availableSpecialDefenseOption(c, type)) return;
    specialDefensePressedAt = Date.now();
  }

  // 高防禦（守護者被動，2026-09-05角色能力真正接入新增）：開啟時支付「骰子消耗：1」
  // （＝HIGH_GUARD_DICE_COUNT×DICE_COUNT_TO_STAMINA_MULT體力），設定c._highGuardActive
  // 直到遭遇結束（見onEncounterEnded）或再次點擊手動關閉。比照night.js本身也從未把
  // 「■」的Guard減傷數值／「敵視：+1」具體套用（night.js:8168-8189一帶只有flag+提示，
  // 見稽核結果）——midnight同樣只做旗標與規則原文提示，不發明數值（CLAUDE.md §19）；
  // 「敵視」在midnight沒有對應的aggro數值系統可掛，一併留給規則原文提示。
  var HIGH_GUARD_DICE_COUNT = 1;

  function highGuardAbility(type) {
    return type
      ? (type.abilities || []).filter(function (a) {
          return a.id === "high_guard";
        })[0]
      : null;
  }

  function handleHighGuardToggleClick() {
    var c = characters[myTokenId];
    var type = c && c.typeId ? window.PriTestCharacterTypes.get(c.typeId) : null;
    var ability = highGuardAbility(type);
    if (!mySlot || isPaused() || !c || !ability) return;
    if (c._highGuardActive) {
      c._highGuardActive = false;
      GameStorage.rtSet(gameId, "cloud", "character/" + myTokenId + "/_highGuardActive", false);
      return;
    }
    if (!spendStamina(HIGH_GUARD_DICE_COUNT * DICE_COUNT_TO_STAMINA_MULT)) return;
    c._highGuardActive = true;
    GameStorage.rtSet(gameId, "cloud", "character/" + myTokenId + "/_highGuardActive", true);
    var CharacterTypes = window.PriTestCharacterTypes;
    showToast(CharacterTypes.localizedText(ability.name) + "：" + CharacterTypes.localizedText(ability.body));
  }

  // 鑑定眼（鐵之眼被動，2026-09-05角色能力真正接入新增）：公開目前遭遇敵人的科（family）
  // 防禦次數／HP價值參考表。重用window.PriTestEnemies.getFamily()既有真實資料（不是
  // 猜測值），只有渲染表格的部分是midnight自己的（night_rulebook.js的
  // buildEnemyGuardValueTable依賴window.PriTestNightCore，只有night.js頁面才有載入，
  // midnight頁面沒有載入night.js，故不重用該渲染函式，改直接輸出文字版）。本地only顯示
  // （未做跨玩家RTDB同步），「供全體PC共享」由GM桌邊口頭轉達，比照桌遊實體性質簡化。
  var EYE_FOR_VALUE_DICE_COUNT = 1;

  function eyeForValueAbility(type) {
    return type
      ? (type.abilities || []).filter(function (a) {
          return a.id === "eye_for_value";
        })[0]
      : null;
  }

  function buildGuardValueTableText(fam) {
    var lines = [];
    (fam.guardValueTable || []).forEach(function (row) {
      var valueText;
      if (Array.isArray(row.value)) {
        valueText = row.value
          .map(function (v, i) {
            return "Lv" + (i + 1) + ":" + (row.theoretical ? "(" + v + ")" : v);
          })
          .join(" ");
      } else {
        valueText = row.theoretical ? "(" + row.value + ")" : String(row.value);
      }
      lines.push(row.count + " → " + valueText);
    });
    return lines.join("\n");
  }

  // 元素操控（隱者/隱者黎明被動，2026-09-05角色能力真正接入新增）：從目前combat target
  // 吸收屬性痕，重用Phase 1（2026-09-05武器資料真正接入）既有的attributeAccum共同蓄積
  // 系統判斷「目標是否有屬性傷害紀錄」（凡不在ATTRIBUTE_STATUS_AILMENT_NAMES_JA清單內、
  // 且蓄積值>0的項目都視為屬性），不新建第二套判斷。FP回復用的是midnight本地fp資源
  // （跟spendFp/fp.current同一份，不是c.fp）。
  var ELEMENTAL_CONTROL_DICE_COUNT = 1;
  var ELEMENTAL_MARKS_MAX = 3;

  function elementalControlAbility(type) {
    return type
      ? (type.abilities || []).filter(function (a) {
          return a.id === "elemental_control";
        })[0]
      : null;
  }

  function targetHasElementalDamage() {
    var data = attributeAccum[currentAttributeAccumTargetKey()] || {};
    return Object.keys(data).some(function (name) {
      return data[name] > 0 && ATTRIBUTE_STATUS_AILMENT_NAMES_JA.indexOf(name) === -1;
    });
  }

  function handleElementalControlClick() {
    var c = characters[myTokenId];
    var type = c && c.typeId ? window.PriTestCharacterTypes.get(c.typeId) : null;
    var ability = elementalControlAbility(type);
    if (!mySlot || isPaused() || !c || !ability) return;
    if ((c.elementalMarks || 0) >= ELEMENTAL_MARKS_MAX) {
      showToast(window.I18N.t("midnight_elemental_control_max_note"));
      return;
    }
    if (!targetHasElementalDamage()) return;
    if (!spendStamina(ELEMENTAL_CONTROL_DICE_COUNT * DICE_COUNT_TO_STAMINA_MULT)) return;
    c.elementalMarks = Math.min(ELEMENTAL_MARKS_MAX, (c.elementalMarks || 0) + 1);
    GameStorage.rtSet(gameId, "cloud", "character/" + myTokenId + "/elementalMarks", c.elementalMarks);
    fp.current = Math.min(fp.max, fp.current + 1);
    var CharacterTypes = window.PriTestCharacterTypes;
    showToast(CharacterTypes.localizedText(ability.name) + "：" + CharacterTypes.localizedText(ability.body));
  }

  function handleEyeForValueClick() {
    var c = characters[myTokenId];
    var type = c && c.typeId ? window.PriTestCharacterTypes.get(c.typeId) : null;
    var ability = eyeForValueAbility(type);
    var trig = activeEncounter ? fieldTriggers[activeEncounter.id] : null;
    if (!mySlot || isPaused() || !c || !ability || !trig || !trig.enemyFamilyId) return;
    var fam = window.PriTestEnemies.getFamily(trig.enemyFamilyId);
    if (!fam) return;
    if (!spendStamina(EYE_FOR_VALUE_DICE_COUNT * DICE_COUNT_TO_STAMINA_MULT)) return;
    var CharacterTypes = window.PriTestCharacterTypes;
    el("midnight-eye-for-value-note").textContent =
      CharacterTypes.localizedText(fam.name) + "\n" + buildGuardValueTableText(fam);
  }

  // 防禦資格與百分比減免（使用者澄清修正：沒有裝備盾牌則防禦鍵直接非活性化，不是0%
  // 減免；唯一例外是角色只裝備1把武器、且已習得遺物效果「雙手持握的達人（両手持ちの
  // 達人）」——本文明寫固定數字「骰子消耗：2」「HP價值：60」，這是規則書寫死的數字、
  // 不是待解析的■，可以直接使用）。回傳null＝目前不能防禦；否則回傳
  // {costPoints, pct}供扣體力/計算減傷用（costPoints見diceCostPoints()說明）。
  var DUAL_GRIP_MASTER_RELIC_NAMES = ["雙手持握的達人", "両手持ちの達人"];
  var DUAL_GRIP_MASTER_GUARD_DICE_COUNT = 2;
  var DUAL_GRIP_MASTER_GUARD_PCT = 60;

  function currentGuardInfo() {
    var c = characters[myTokenId];
    if (!c) return null;
    var sides = ["L", "R"]
      .map(function (side) {
        return c["equippedWeaponId" + side];
      })
      .filter(function (id) {
        return !!id;
      });
    var shield = null;
    sides.forEach(function (weaponId) {
      var weapon = Weapons.get(baseCatalogId(weaponId));
      var category = weapon && Weapons.getCategory(weapon.category);
      if (category && category.isShield) shield = { weaponId: weaponId, weapon: weapon, category: category };
    });
    if (shield) {
      var guardCost = CharacterDrawer.parseGuardCost(Weapons.localizedText(shield.category.basicStats.guardCost));
      var rarity = CharacterDrawer.getEffectiveWeaponRarity(c, shield.weaponId);
      var pct = rarity === "R" || rarity === "L" ? shield.category.basicStats.guardHpRL : shield.category.basicStats.guardHpCU;
      return { costPoints: diceCostPoints(guardCost), pct: pct };
    }
    if (sides.length === 1 && CharacterDrawer.findLearnedRelicEffectByName(c, DUAL_GRIP_MASTER_RELIC_NAMES)) {
      return { costPoints: DUAL_GRIP_MASTER_GUARD_DICE_COUNT, pct: DUAL_GRIP_MASTER_GUARD_PCT };
    }
    return null; // 沒有盾牌、也不符合雙手持握的達人條件→防禦鍵非活性化
  }

  // 防禦：長按觸發（滑鼠/觸控），持有期間體力不回復（使用者規則）。成功防禦時扣的體力＝
  // currentGuardInfo().costPoints×2（跟一般攻擊/戰技同一套「骰子點數×2＝體力」公式），
  // 實際判定與百分比減損在resolveMyIncomingHit()。
  function bindBlockHoldInput() {
    var btn = el("btn-midnight-block");
    btn.addEventListener("mousedown", startBlockHold);
    btn.addEventListener("mouseup", endBlockHold);
    btn.addEventListener("mouseleave", endBlockHold);
    btn.addEventListener(
      "touchstart",
      function (e) {
        e.preventDefault();
        startBlockHold();
      },
      { passive: false }
    );
    btn.addEventListener("touchend", endBlockHold);
    btn.addEventListener("touchcancel", endBlockHold);
  }

  // 防禦讀條（2026-09-06使用者明確要求「防禦長按→防禦，且在上面用現在施法的讀條，按著
  // 時直接滿格」）：防禦沒有蓄力時間，不是像戰技B那樣隨時間漸進填滿，長按期間直接顯示
  // 滿格，純粹當作「目前正在防禦中」的視覺提示，見#midnight-block-guard-fill。
  function renderBlockGuardBar() {
    var fillEl = el("midnight-block-guard-fill");
    if (fillEl) fillEl.style.width = blockHolding ? "100%" : "0%";
  }

  function startBlockHold() {
    if (!mySlot || isPaused() || !currentGuardInfo()) return;
    cancelFlaskReadingForOtherAction();
    blockHolding = true;
    renderBlockGuardBar();
  }

  function endBlockHold() {
    blockHolding = false;
    renderBlockGuardBar();
  }

  // 聖杯瓶（2026-09-05 HUD優化改版，2026-09-06優化改為1.0秒）：按下不會立刻生效，先開始
  // FLASK_READ_MS讀取（卡片上方讀取條，見renderCharPanel／CSS），讀取完才真正扣次數＋
  // 回血——使用者明確規格「使用聖杯瓶時間為1.0s，期間使用任何動作、受到傷害都會停止
  // 使用」。剩餘數不足或已經在讀取中時直接no-op。
  function handleUseFlaskClick() {
    if (!mySlot || isPaused() || flaskReadingUntil !== null) return;
    var res = characters[myTokenId];
    if (!res || res.flaskCount <= 0) return;
    flaskReadingUntil = Date.now() + FLASK_READ_MS;
  }

  // 聖杯瓶讀取中若使用其他動作則取消（2026-09-06使用者明確要求）：讀取條只是「確定要
  // 喝」的緩衝時間，玩家在讀取完成前改做別的動作（攻擊/戰技/魔術/道具/迴避/防禦）就視為
  // 中斷這次使用——不扣flaskCount也不回血，直接清掉倒數，之後可以再重新按聖杯瓶鍵。
  // 只在各動作真正「確定要做」（資源檢查都通過）之後才呼叫，避免點擊失敗的動作
  // （例如體力不足被擋下）也誤取消。
  function cancelFlaskReadingForOtherAction() {
    flaskReadingUntil = null;
  }

  // 讀取到期才真正扣次數＋回血，回復量FLASK_HEAL_AMOUNT是佔位值（見常數區塊註解）。
  function updateFlaskReading(now) {
    if (flaskReadingUntil === null || now < flaskReadingUntil) return;
    flaskReadingUntil = null;
    commitFlaskHeal();
  }

  function commitFlaskHeal() {
    GameStorage.rtTransaction(gameId, "cloud", "character/" + myTokenId + "/flaskCount", function (cur) {
      var next = (cur === null ? FLASK_MAX_DEFAULT : cur) - 1;
      return next < 0 ? 0 : next;
    });
    var maxHp = mySelfHpMaxFallback();
    GameStorage.rtTransaction(gameId, "cloud", "demoStat/" + myTokenId, function (cur) {
      var next = (cur === null ? maxHp : cur) + FLASK_HEAL_AMOUNT;
      return next > maxHp ? maxHp : next;
    });
  }

  // ---- 消耗品實際效果（2026-09-05武器資料真正接入新增）----
  // night.js有自己一套applyConsumableEffect/CONSUMABLE_TARGET_KIND，但night.js本身沒有
  // 載入這個頁面（見site_src/midnight_page.py的extra_scripts，它的函式也未掛在任何
  // window.*，完全無法從這裡呼叫），所以整份重寫成即時制精簡版，不是照抄。
  //
  // 範圍取捨：只自動套用「數值可直接計算、且沒有回合/階段生命週期」的效果——
  // 「□」視為+1（CLAUDE.md §17），非骰子的固定屬性/異常數字視為蓄積值（記入Phase 1
  // 新建的attributeAccum共同蓄積系統）。以下這些**不**自動套用數值，只用showToast()
  // 顯示規則原文交由GM/玩家判斷（CLAUDE.md §19既有慣例，理由各自標註）：
  //   - 「直到階段/戰鬥結束為止」的buff（hero_meat_chunk／grease／
  //     perfume_iron_pot_spray／perfume_uplifting_aroma／perfume_acid_spray）：
  //     midnight沒有night.js的phase/combat生命週期可以掛「結束時重設」，見CLAUDE.md §21
  //     「Phase Reset Checklist」的既有原則——沒有對應的reset時機就不能先套用效果。
  //   - 需要實際擲骰決定數值的效果（turtle_neck_pickle的體力骰、folding_shuriken的
  //     「10×1D」、throwing_pot的「X：1D」）：這個repo的骰子都是玩家在桌上實際擲的
  //     實體骰，不能用Math.random()代替（會破壞桌遊本身的擲骰體驗）。
  //   - bitter_medicine（清除自身異常狀態蓄積）／throwing_dagger（▲）：分別依賴
  //     「PC自身承受的異常蓄積」「武器context的威力修正」，這兩套機制目前的
  //     attributeAccum系統只做了「PC→敵人」方向，還沒有對應資料可用。
  var MIDNIGHT_CONSUMABLE_TIMED_OR_UNRESOLVED = {
    item_hero_meat_chunk: true,
    item_turtle_neck_pickle: true,
    item_bitter_medicine: true,
    item_grease: true,
    item_throwing_dagger: true,
    item_folding_shuriken: true,
    item_throwing_pot: true,
    item_perfume_acid_spray: true,
    item_perfume_iron_pot_spray: true,
    item_perfume_uplifting_aroma: true,
  };

  // 目前唯一在場的「其他PC」（依slot排序取第1個）：item_warming_stone用。midnight一次
  // 最多3人，多人在場時只自動選第1個找到的，沒有另外做選擇UI（這次milestone範圍取捨，
  // 之後若需要精確指定對象，可仿照角色面板既有的picker UI再擴充，不是這裡直接發明）。
  function firstOtherPcTokenId() {
    var slots = Object.keys(players || {});
    for (var i = 0; i < slots.length; i++) {
      var p = players[slots[i]];
      if (slots[i] !== mySlot && p && p.tokenId) return p.tokenId;
    }
    return null;
  }

  function healCharacterHp(tokenId, amount) {
    var maxHp = selfArenaHpMax(characters[tokenId]);
    GameStorage.rtTransaction(gameId, "cloud", "demoStat/" + tokenId, function (cur) {
      var next = (cur === null ? maxHp : cur) + amount;
      return next > maxHp ? maxHp : next;
    });
  }

  // 博聞強識（學者被動，2026-09-06角色能力真正接入新增）：使用者確認「消耗品在原本night
  // 中就有等級2資訊，將他也帶入」，數值直接抄night.js的applyConsumableEffect()既有分支
  // （single source of truth＝night.js，不是自己另外發明），只套用在midnight這6個已經
  // 支援自動解算的項目——其餘MIDNIGHT_CONSUMABLE_TIMED_OR_UNRESOLVED項目仍受限於「直到
  // 階段/戰鬥結束」生命週期或需要實體骰兩個既有理由，這次沒有一併打開。
  function hasCarriedKnowledge(c) {
    var type = c && c.typeId ? window.PriTestCharacterTypes.get(c.typeId) : null;
    return !!(
      type &&
      (type.abilities || []).some(function (a) {
        return a.id === "carried_knowledge";
      })
    );
  }

  // 套用消耗品效果本體：可自動解算的分支直接套用數值，其餘一律只顯示規則原文
  // （MIDNIGHT_CONSUMABLE_TIMED_OR_UNRESOLVED旗標）。applyLevel2＝hasCarriedKnowledge(c)。
  function applyMidnightConsumableEffect(c, itemId) {
    var applyLevel2 = hasCarriedKnowledge(c);
    if (itemId === "item_shard_of_starlight") {
      // night.js:7737「applyLevel2 ? 6 : 3」。
      fp.current = Math.min(fp.max, fp.current + (applyLevel2 ? 6 : 3));
    } else if (itemId === "item_warming_stone") {
      // night.js:7782「(applyLevel2 ? 4 : 2)」，對象含自身＋其他1名PC。
      var hpAmount = applyLevel2 ? 4 : 2;
      healCharacterHp(myTokenId, hpAmount);
      var otherTokenId = firstOtherPcTokenId();
      if (otherTokenId) healCharacterHp(otherTokenId, hpAmount);
    } else if (itemId === "item_azure_throwing_knife") {
      damageCombatTarget(2); // 這個項目本文沒有等級2效果（night.js:7802-7803無applyLevel2分支）
      triggerEnemyHitEffect(null); // 純物理投擲武器，沒有屬性標記，顯示無屬性（白色）刀光
    } else if (itemId === "item_bone_poison_dart") {
      // 「毒：1D」：2026-08-24使用者裁定，沒有額外擲骰指示時Xd視為固定值X（見docs/
      // enemy_damage_rules.md §1.1）。等級2額外造成【總合傷害：15】（night.js:7808-7809）。
      recordAttributeAccum("猛毒", 1);
      if (applyLevel2) {
        damageCombatTarget(15);
        triggerEnemyHitEffect(enemyHitColorFromEffects([{ label: "毒" }])); // 毒鏢主題色（綠）
      }
    } else if (itemId === "item_perfume_spark_aroma") {
      // night.js:7875「1 + (applyLevel2 ? 2 : 0)」＝1或3。
      recordAttributeAccum("炎", applyLevel2 ? 3 : 1);
    } else if (itemId === "item_perfume_poison_spray") {
      // night.js:7892「1 + (applyLevel2 ? 2 : 0)」＝1或3。
      recordAttributeAccum("猛毒", applyLevel2 ? 3 : 1);
    }
    // 其餘（MIDNIGHT_CONSUMABLE_TIMED_OR_UNRESOLVED為true的項目）不套用任何數值，
    // 交由呼叫端只顯示規則原文。
  }

  // 消耗品快速使用卡片（2026-09-05 HUD優化新增）：固定使用陣列第0筆（＝目前的「快速
  // 使用」道具，見規劃紀錄設計取捨——要更換快速道具，從角色面板的消耗品清單按「設為
  // 快速使用」，見renderCharacterSheet()）。
  function handleUseQuickConsumableClick() {
    if (!mySlot || isPaused()) return;
    var c = characters[myTokenId];
    var inst = c && c.consumables && c.consumables[0];
    if (!inst) return;
    var item = window.PriTestConsumables.get(inst.itemId);
    // 石劍鑰匙／鍛造石：這兩個是「持有即生效」的鑰匙類道具（見handleEnterFieldPointClick／
    // 商人鍛造台的持有檢查），不是點一下就耗用的消耗品，按快速使用鍵只顯示提示，不扣
    // usesRemaining——避免玩家誤按就把鑰匙用掉。
    if (item && item.noStackLimit) {
      showToast(window.PriTestConsumables.localizedText(item.name) + "：" + window.PriTestConsumables.localizedText(item.body));
      return;
    }
    cancelFlaskReadingForOtherAction();
    GameStorage.rtTransaction(gameId, "cloud", "character/" + myTokenId + "/consumables", function (cur) {
      var list = (cur || []).slice();
      var idx = -1;
      for (var i = 0; i < list.length; i++) {
        if (list[i].id === inst.id) {
          idx = i;
          break;
        }
      }
      if (idx === -1) return cur;
      var next = list[idx].usesRemaining - 1;
      if (next <= 0) list.splice(idx, 1);
      else list[idx] = { id: list[idx].id, itemId: list[idx].itemId, usesRemaining: next };
      return list;
    });
    if (item) {
      applyMidnightConsumableEffect(c, inst.itemId);
      var autoApplied = !MIDNIGHT_CONSUMABLE_TIMED_OR_UNRESOLVED[inst.itemId];
      var suffix = autoApplied
        ? window.I18N.t("midnight_consumable_auto_applied_note")
        : window.I18N.t("midnight_consumable_manual_note");
      showToast(window.PriTestConsumables.localizedText(item.name) + "：" + window.PriTestConsumables.localizedText(item.body) + suffix);
      // 2026-09-06使用者明確要求「使用技能魔術甚至消耗品也需要在腳色的使用資訊log中
      // 顯示出來」：跟一般攻擊/戰技/角色能力共用同一顆action bubble（見
      // broadcastCombatActionBubble()），不新增第二套顯示機制。
      broadcastCombatActionBubble(window.PriTestConsumables.localizedText(item.name));
    }
  }

  // 把指定instance搬到consumables陣列開頭，變成新的「快速使用」道具（見
  // handleUseQuickConsumableClick／角色面板「設為快速使用」按鈕），純陣列reorder，
  // 不新增第二套資料結構。
  function setQuickConsumable(instId) {
    GameStorage.rtTransaction(gameId, "cloud", "character/" + myTokenId + "/consumables", function (cur) {
      var list = (cur || []).slice();
      var idx = -1;
      for (var i = 0; i < list.length; i++) {
        if (list[i].id === instId) {
          idx = i;
          break;
        }
      }
      if (idx <= 0) return cur;
      var picked = list.splice(idx, 1)[0];
      list.unshift(picked);
      return list;
    });
  }

  // 武器快速切換卡片（左／右，2026-09-05 HUD優化新增，2026-09-05武器資料真正接入後
  // c.equippedWeaponIdL/R已經是handleAttackClick/handleSkillClick/戰技B等真正的傷害/消耗
  // 計算來源，不再只是顯示用欄位）。存weaponId字串而非index，避免merchant/reward對
  // weaponIds陣列增刪時卡片顯示的武器跟著錯位。
  // 循環清單最前面插入""（空手），使用者明確規格：「左下切換武器時要有一個空白，當作是
  // 沒裝備」。c[field]===undefined（角色剛建立、還沒手動切換過）時比照舊行為預設顯示/使用
  // ids[0]；一旦玩家循環切到""，就是明確選擇空手，不會再自動回退成ids[0]。
  function cycleEquippedWeapon(side) {
    if (!mySlot || isPaused()) return;
    var c = characters[myTokenId];
    var ids = (c && c.weaponIds) || [];
    var field = side === "L" ? "equippedWeaponIdL" : "equippedWeaponIdR";
    var rotation = [""].concat(ids);
    var cur = c[field] === undefined ? ids[0] || "" : c[field];
    var idx = rotation.indexOf(cur);
    if (idx === -1) idx = 0;
    var next = rotation[(idx + 1) % rotation.length];
    c[field] = next; // 樂觀更新本地顯示，RTDB回傳後onCharactersReceived會再覆寫一次同樣的值
    GameStorage.rtSet(gameId, "cloud", "character/" + myTokenId + "/" + field, next);
    syncEquippedWeaponIds(c);
  }

  // character_drawer.js的computeWeaponDamage／weaponInnateHitBonus／weaponAccumulationEffects
  // 等既有函式，判斷「單獨裝備」「兩手持強化」等條件時讀的是c.equippedWeaponIds（陣列，
  // night.js既有欄位），不是midnight自己的equippedWeaponIdL/R——兩者原本互不相通。每次
  // 左右手裝備變動時同步寫回equippedWeaponIds，讓這些既有函式能正確運作，不用另外複製
  // 一份判斷邏輯。
  function syncEquippedWeaponIds(c) {
    var ids = [c.equippedWeaponIdL, c.equippedWeaponIdR].filter(function (id) {
      return !!id;
    });
    c.equippedWeaponIds = ids;
    GameStorage.rtSet(gameId, "cloud", "character/" + myTokenId + "/equippedWeaponIds", ids);
  }

  // 直接指定裝備哪一把武器（左／右），供角色面板「裝備」按鈕使用——跟
  // cycleEquippedWeapon()循環切換不同，這裡是「選好特定一把，直接裝上」。固定裝L側
  // （見CLAUDE.md §41「不重新發明第三套機制」原則：只新增這個必要的最小函式，不做
  // 選左右側的UI，因為既有兩張武器卡片本來就是靠cycleEquippedWeapon()循環切換，這裡
  // 只是提供角色面板一個「選定裝上」的捷徑）。
  function setEquippedWeapon(weaponId) {
    var c = characters[myTokenId];
    if (!c) return;
    c.equippedWeaponIdL = weaponId;
    GameStorage.rtSet(gameId, "cloud", "character/" + myTokenId + "/equippedWeaponIdL", weaponId);
    syncEquippedWeaponIds(c);
  }

  // 每影格回復體力：長按防禦中不回復（使用者規則），觀戰者/暫停中也不回復。
  function updateStamina(dtSec) {
    if (!mySlot || isPaused() || blockHolding) return;
    stamina.current = Math.min(stamina.max, stamina.current + STAMINA_REGEN_PER_SEC * dtSec);
  }

  // ============================================================================
  // 敵人攻擊（2026-09-05新增，見上方ENEMY_ATTACK_*常數區塊的設計決定與資料來源說明）。
  // 只在activeEncounter存在時（同一板塊、同一籌碼事件、敵人仍存活）才會運作，跟原本
  // 技術驗證片的demoStat/sharedTarget共用標靶無關。
  //
  // 資料流：fieldTrigger/{pointId}下新增三個欄位——
  //   damageBySlot: { [slot]: 累積傷害 }        用於判定「敵視」目標
  //   nextAttackAt: 下一次攻擊要發動的時間戳     沒有攻擊進行中時才會被排定
  //   enemyAttack: { attackId, targetSlots, hitCount, warnAt } 或 null
  //     一次攻擊事件的權威資料（目標/次數/警示開始時間），任何在場的參與者裝置都可能
  //     透過transaction()排定/發動/收尾，跟這個檔案其他地方（投票/塔解謎）同一套
  //     「先到先贏、輸的那次transaction直接讀到贏家寫的值」併發安全模式。
  //   實際的反應窗口／命中判定則是「被鎖定的那個玩家自己的裝置」用本地計時器
  //   （myIncomingAttack）獨立處理——跟聖杯瓶/攻擊傷害一樣，只有自己的裝置能決定
  //   「我自己的HP要不要被扣」，不需要額外的RTDB回合制交握。
  // ============================================================================

  function enemyAttackHitWindowMs(hitIndex) {
    var idx = Math.max(0, Math.min(hitIndex, ENEMY_ATTACK_HIT_WINDOW_MS.length - 1));
    return ENEMY_ATTACK_HIT_WINDOW_MS[idx];
  }

  function enemyAttackTotalDurationMs(hitCount) {
    var total = ENEMY_ATTACK_WARN_MS;
    for (var i = 0; i < hitCount; i++) total += enemyAttackHitWindowMs(i);
    return total;
  }

  // 依權重陣列（不需要總和為1）挑一個index，randValue是外部傳入的0~1亂數來源。
  function pickWeightedIndex(randValue, weights) {
    var sum = 0;
    for (var i = 0; i < weights.length; i++) sum += weights[i];
    var target = randValue * sum;
    var acc = 0;
    for (var j = 0; j < weights.length; j++) {
      acc += weights[j];
      if (target < acc) return j;
    }
    return weights.length - 1;
  }

  // 敵視目標：目前對這隻敵人造成最多累積傷害的參與者。沒有人造成過傷害（damageBySlot
  // 是空的）時回傳null，代表這次還不能用「敵視」這個機率層（見maybeStartEnemyAttack）。
  function aggroHolderSlot(trig) {
    var damageBySlot = (trig && trig.damageBySlot) || {};
    var best = null;
    var bestVal = 0;
    Object.keys(damageBySlot).forEach(function (slot) {
      if (damageBySlot[slot] > bestVal) {
        bestVal = damageBySlot[slot];
        best = slot;
      }
    });
    return best;
  }

  // 敵人存活期間，沒有攻擊進行中也還沒排下一次攻擊時，排一個demo佔位的隨機等待時間
  // （2~4秒，使用者確認的設計決定②）。用transaction()避免多裝置同時排出不同的時間。
  function ensureNextAttackScheduled(pt, trig) {
    if (trig.enemyAttack || trig.nextAttackAt) {
      nextAttackScheduleAttempted[pt.id] = false; // 已經排好了（不論是不是自己排的），下次進入空窗期時要能再排一次
      return;
    }
    if (nextAttackScheduleAttempted[pt.id]) return;
    nextAttackScheduleAttempted[pt.id] = true;
    GameStorage.rtTransaction(gameId, "cloud", "fieldTrigger/" + pt.id + "/nextAttackAt", function (cur) {
      if (cur !== null) return cur;
      return Date.now() + ENEMY_ATTACK_INTERVAL_MIN_MS + Math.floor(Math.random() * (ENEMY_ATTACK_INTERVAL_MAX_MS - ENEMY_ATTACK_INTERVAL_MIN_MS));
    });
  }

  // roll範圍轉成加權寬度：規則書行動決定表有1D6（"1"~"6"）也有2D6（"1~2"、"9~10"等
  // 範圍）兩種寫法，寬度＝高-低+1（單一數字寬度1），"—"（不適用/理論值列）寬度0、
  // 自然被pickWeightedIndex排除，不需要另外判斷是1D6還是2D6。
  function enemyActionRollWeight(rollStr) {
    var s = String(rollStr || "")
      .replace(/～/g, "~")
      .trim();
    var m = /^(\d+)~(\d+)$/.exec(s);
    if (m) return Math.max(0, parseInt(m[2], 10) - parseInt(m[1], 10) + 1);
    return /^\d+$/.test(s) ? 1 : 0;
  }

  // 依權重（規則書骰面寬度）從敵人實際「アクション決定表」抽一招。找不到任何有效權重
  // （actions缺漏或全部是"—"）時回傳null，呼叫端要能處理「這次抽不到招式」的情況。
  function pickEnemyAction(actions) {
    var list = actions || [];
    var weights = list.map(function (a) {
      return enemyActionRollWeight(a.roll);
    });
    var total = weights.reduce(function (a, b) {
      return a + b;
    }, 0);
    if (!total) return null;
    return list[pickWeightedIndex(Math.random(), weights)];
  }

  // 解析action.mod的加減值："＋120"／"－240"／"±0"／"—"，可能附加"＆「屬性:XD」"字尾
  // （已經由parseElementalAttacksFromAction另外處理，這裡只取最前面的加減值部分）。
  function parseModValue(modText) {
    var s = String(modText || "")
      .split(/[＆&]/)[0]
      .trim();
    var plus = /^[＋+]\s*(\d+)/.exec(s);
    if (plus) return parseInt(plus[1], 10);
    var minus = /^[－\-]\s*(\d+)/.exec(s);
    if (minus) return -parseInt(minus[1], 10);
    return 0; // "±0"／"—"／無法解析
  }

  var INDIVIDUAL_DAMAGE_RE = /個別(?:ダメージ|傷害)[:：]\+?(\d+)/;
  var GROUP_DAMAGE_RE = /乱戦|亂戰/;

  // 決定這一招的傷害「種類」與數值（使用者明確規格：敘述若明寫個別傷害＝單體，其餘
  // （乱戦/亂戰）＝1~3人）。個別傷害多半直接把最終數字寫在note裡（例：【個別ダメージ:180】），
  // 不必再套用base/mod公式；乱戦傷害則用「該等級的乱戦ダメージ基準值＋這一招的mod修正」
  // （docs整理的既有資料結構，不是自己發明的公式）。兩者都沒命中時回傳kind:null——
  // 不發明數值，交由呼叫端只顯示招式名稱、不扣血（CLAUDE.md §19既有慣例）。
  function resolveEnemyActionOutcome(familyBase, level, action) {
    var noteJa = (action.note && action.note.ja) || "";
    var noteZh = (action.note && action.note.zh) || "";
    var m = INDIVIDUAL_DAMAGE_RE.exec(noteJa) || INDIVIDUAL_DAMAGE_RE.exec(noteZh);
    if (m) return { kind: "single", amount: parseInt(m[1], 10) };
    if (GROUP_DAMAGE_RE.test(noteJa) || GROUP_DAMAGE_RE.test(noteZh)) {
      var lvEntry = (familyBase || []).filter(function (l) {
        return l.level === level;
      })[0];
      var base = lvEntry ? lvEntry.dmg : 0;
      return { kind: "group", amount: base + parseModValue(action.mod) };
    }
    return { kind: null, amount: 0 };
  }

  // Day3夜之王選招/算傷害（完整版，2026-09-06三次優化）：直接呼叫night.js既有的自動化GM
  // 純函式模組window.PriTestAutoGm.rollEnemyAction()（見auto_gm.js），沿用同一套「依骰面
  // 找對應行、formAware夜王依目前形態(bossForm)找對應範圍、guardBroken後行動激化+N骰」
  // 邏輯，不重新發明。roster/aggro/front用一個輕量shim換算成該模組期待的陣列形狀——
  // 即時制沒有前衛/後衛，全員一律視為front（front全true），這是唯一的簡化，讓規則書
  // 「〇〇All」類targetRule都退化成「全體現有參與者」，不猜測前衛/後衛實際分配。
  function bossAutoGmBattleState(trig) {
    var slots = participantSlots(trig);
    var aggro = slots.map(function (slot) {
      return (trig && trig.damageBySlot && trig.damageBySlot[slot]) || 0;
    });
    var front = slots.map(function () {
      return true;
    });
    return { slots: slots, aggro: aggro, front: front, bossForm: (trig && trig.bossForm) || "fused", guardBroken: !!(trig && trig.everGuardBroken) };
  }

  // 已知簡化（誠實劃定「完整版」邊界，見docs/midnight_realtime_combat_numbers.md）：
  //   - 亂戰傷害一律視為「每個被選中的人各自承受這個數字」（跟一般敵人既有慣例一致），
  //     不做規則書「N人份加權共享同一個傷害池」的精確配分（window.PriTestAutoGm雖有
  //     splitGroupSharesWeighted()可用，但該模組自身註解已說明目前資料全是「重量一致」
  //     的單一權重群組，等效於均分——這裡選擇不均分、每人各自承受頭條數字，維持跟一般
  //     敵人現有UX一致，是刻意的簡化不是bug）。
  //   - 一招若同時有亂戰傷害＋額外個別傷害兩種效果，只採用亂戰傷害（較顯著的頭條數字），
  //     額外的個別傷害效果不模擬。
  //   - row.conditions（例如"special_levitate"等純敘述性特殊效果、規則書數值/門檻無法
  //     從既有資料確認的機制）一律不自動計算，只在renderEnemyAttackOverlay()額外顯示
  //     規則書原文note，交由玩家自行判斷（CLAUDE.md §19「■」處理方式）。
  // 找不到資料/選不出招時回傳null，呼叫端要能處理「這次抽不到招式」。
  function pickAndResolveBossAction(bossId, trig) {
    var AutoGm = window.PriTestAutoGm;
    if (!AutoGm) return null;
    var battleState = bossAutoGmBattleState(trig);
    var slots = battleState.slots;
    if (!slots.length) return null;
    var rollResult = AutoGm.rollEnemyAction("boss|" + bossId, battleState);
    if (!rollResult || !rollResult.structuredRow) return null;
    var row = rollResult.structuredRow;
    var name = rollResult.originalRow ? rollResult.originalRow.name : null;
    var noteText = rollResult.originalRow && rollResult.originalRow.note ? rollResult.originalRow.note.ja || rollResult.originalRow.note.zh || "" : "";
    var kind = null;
    var amount = 0;
    var targetSlots = [];
    if (row.groupDamage) {
      var gd = AutoGm.computeGroupDamage(rollResult, {}, 0);
      var indices = AutoGm.resolveTargets(row.targetRule, battleState, slots.length);
      if (!indices.length) indices = slots.map(function (_, i) { return i; });
      kind = "group";
      amount = gd ? gd.total : 0;
      targetSlots = indices.map(function (i) { return slots[i]; });
    } else if (row.individualDamage && row.individualDamage.length) {
      var entry = row.individualDamage[0];
      var idmg = AutoGm.computeIndividualDamage(entry, {}, 0);
      var idxs = AutoGm.resolveTargets(entry.targetRule || row.targetRule, battleState, slots.length);
      var pickIdx = idxs.length ? idxs[Math.floor(Math.random() * idxs.length)] : Math.floor(Math.random() * slots.length);
      kind = "single";
      amount = idmg ? idmg.total : entry.amount || 0;
      targetSlots = [slots[pickIdx]];
    }
    if (!kind || !targetSlots.length) return null;
    return {
      actionName: name,
      actionMod: noteText, // 供parseElementalAttacksFromAction()解析note文字中的「屬性:ND」標記（沿用texts[0]=action.mod的既有fallback行為，不需要另外改那個函式）
      actionNote: noteText,
      kind: kind,
      amount: amount,
      targetSlots: targetSlots,
      formFlip: (row.conditions || []).indexOf("form_change_at_end_phase") !== -1,
    };
  }

  // 時間到了就發動下一次攻擊：2026-09-06數值真正接入，不再用demo佔位機率決定打誰/
  // 打幾下，改成先從敵人實際「アクション決定表」抽一招（pickEnemyAction），依這一招的
  // 敘述判斷是個別傷害（1人，優先選敵視最高者，沒有敵視紀錄則隨機1人）還是亂戰傷害
  // （隨機1~3人，使用者明確規格）。整段在transaction()裡面做，確保「決定攻擊了沒」跟
  // 「決定打誰/打這一招」是同一次原子操作，不會有兩個裝置同時各自發動一次攻擊的競態。
  function maybeStartEnemyAttack(pt, trig, now) {
    if (trig.enemyAttack) {
      enemyAttackStartAttempted[pt.id] = false; // 攻擊已經發動了（不論是不是自己發動的），下次空窗期要能再嘗試一次
      return;
    }
    if (!trig.nextAttackAt || now < trig.nextAttackAt) return;
    if (enemyAttackStartAttempted[pt.id]) return;
    enemyAttackStartAttempted[pt.id] = true;
    var isBoss = trig.enemyFamilyId === BOSS_ENEMY_FAMILY_SENTINEL;
    var enemyData = !isBoss && trig.enemyFamilyId ? window.PriTestEnemies.get(trig.enemyFamilyId, trig.enemyId) : null;
    GameStorage.rtTransaction(gameId, "cloud", "fieldTrigger/" + pt.id, function (cur) {
      if (!cur || cur.enemyAttack) return cur;
      if (!cur.nextAttackAt || Date.now() < cur.nextAttackAt) return cur;
      var slots = participantSlots(cur);
      if (!slots.length) return cur;
      var out = {};
      for (var k in cur) out[k] = cur[k]; // ES5：手動合成，跟maybeResolveFieldVote()同樣手法
      if (isBoss) {
        // Day3夜之王：選招/算傷害/選目標整段交給pickAndResolveBossAction()（見該函式
        // 註解），這裡只負責把結果寫進跟一般敵人共用的enemyAttack schema。
        var bossOutcome = pickAndResolveBossAction(cur.enemyId, cur);
        out.enemyAttack = {
          attackId: pt.id + ":" + Date.now(),
          targetSlots: bossOutcome ? bossOutcome.targetSlots : [],
          hitCount: 1,
          warnAt: Date.now(),
          actionName: bossOutcome ? bossOutcome.actionName : null,
          actionMod: bossOutcome ? bossOutcome.actionMod : null,
          actionNote: bossOutcome ? bossOutcome.actionNote : null,
          dmgKind: bossOutcome ? bossOutcome.kind : null,
          dmgAmount: bossOutcome ? bossOutcome.amount : 0,
        };
        // gladius「形態変化」：轉換條件在動作本身（不是HP歸零），即時制沒有階段可以等，
        // 選出這一招的當下就直接切換（fused<->split），見pickAndResolveBossAction()
        // 的formFlip判斷（row.conditions含"form_change_at_end_phase"）。這個轉換不重灌
        // HP/Guard（跟harmonia類「HP歸零才轉換、順便全回復」是完全不同的機制，見
        // maybeResetBossFormOnDefeat()）。
        if (bossOutcome && bossOutcome.formFlip) {
          out.bossForm = out.bossForm === "split" ? "fused" : "split";
        }
        out.nextAttackAt = null;
        return out;
      }
      var action = enemyData ? pickEnemyAction(enemyData.enemy.actions) : null;
      var outcome = action ? resolveEnemyActionOutcome(enemyData.familyBase, cur.level || 1, action) : { kind: null, amount: 0 };
      var targetSlots;
      if (outcome.kind === "group") {
        var count = Math.min(slots.length, Math.floor(Math.random() * 3) + 1);
        var pool = slots.slice();
        targetSlots = [];
        for (var i = 0; i < count && pool.length; i++) {
          targetSlots.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
        }
      } else {
        var aggroSlot = aggroHolderSlot(cur);
        targetSlots = [aggroSlot || slots[Math.floor(Math.random() * slots.length)]];
      }
      out.enemyAttack = {
        attackId: pt.id + ":" + Date.now(),
        targetSlots: targetSlots,
        hitCount: 1, // 一次攻擊事件已經對應規則書「一招」，不再有demo佔位的連續多段命中
        warnAt: Date.now(),
        actionName: action ? action.name : null,
        actionMod: action ? action.mod : null, // 供resolveMyIncomingHit解析這一招實際附帶的屬性
        dmgKind: outcome.kind,
        dmgAmount: outcome.amount,
      };
      out.nextAttackAt = null; // 這次攻擊收尾時（maybeFinishEnemyAttack）才會再排下一次
      return out;
    });
  }

  // 攻擊事件的「理論總長度」（警示0.5秒＋依次數累加的各段反應窗口）一到，就把
  // enemyAttack清掉並排下一次攻擊。用理論總長度而不是等每個被鎖定玩家各自回報結果，
  // 是為了避免有人提早迴避成功、有人還在等最後一擊逾時時，兩邊對「這次攻擊算不算
  // 結束」的認知不一致——反正每個被鎖定的玩家本來就各自用本地計時器獨立判定自己的
  // 命中結果（myIncomingAttack），不需要RTDB上的enemyAttack撐到那麼久。
  function maybeFinishEnemyAttack(pt, trig, now) {
    var atk = trig.enemyAttack;
    if (!atk) {
      enemyAttackFinishAttempted[pt.id] = null; // 已經被清掉了（不論是不是自己清的），重置給下一次攻擊用
      return;
    }
    if (now < atk.warnAt + enemyAttackTotalDurationMs(atk.hitCount)) return;
    if (enemyAttackFinishAttempted[pt.id] === atk.attackId) return;
    enemyAttackFinishAttempted[pt.id] = atk.attackId;
    GameStorage.rtTransaction(gameId, "cloud", "fieldTrigger/" + pt.id, function (cur) {
      if (!cur || !cur.enemyAttack || cur.enemyAttack.attackId !== atk.attackId) return cur;
      var out = {};
      for (var k in cur) out[k] = cur[k];
      out.enemyAttack = null;
      out.nextAttackAt = Date.now() + ENEMY_ATTACK_INTERVAL_MIN_MS + Math.floor(Math.random() * (ENEMY_ATTACK_INTERVAL_MAX_MS - ENEMY_ATTACK_INTERVAL_MIN_MS));
      return out;
    });
  }

  // 我自己是不是這次攻擊的目標，並推進我自己本地的反應窗口狀態機（warn→window→done，
  // 每一下命中都重新進入window）。不是目標，或攻擊已經換了一次（attackId不同）時，
  // 清掉舊的本地狀態。
  function updateMyIncomingAttack(pt, trig, now) {
    var atk = trig.enemyAttack;
    var targeted = !!(atk && mySlot && atk.targetSlots && atk.targetSlots.indexOf(mySlot) !== -1);
    if (!targeted) {
      if (myIncomingAttack && (!atk || atk.attackId !== myIncomingAttack.attackId)) myIncomingAttack = null;
      return;
    }
    if (!myIncomingAttack || myIncomingAttack.attackId !== atk.attackId) {
      myIncomingAttack = {
        pointId: pt.id,
        attackId: atk.attackId,
        hitIndex: 0,
        hitCount: atk.hitCount,
        phase: "warn",
        windowStartAt: null,
        phaseEndAt: atk.warnAt + ENEMY_ATTACK_WARN_MS,
        actionName: atk.actionName,
        actionMod: atk.actionMod,
        actionNote: atk.actionNote,
        dmgKind: atk.dmgKind,
        dmgAmount: atk.dmgAmount,
      };
      return;
    }
    var st = myIncomingAttack;
    if (st.phase === "warn") {
      if (now >= st.phaseEndAt) {
        st.phase = "window";
        st.windowStartAt = now;
        st.phaseEndAt = now + enemyAttackHitWindowMs(st.hitIndex);
        triggerAttackEffect(); // 使用者規格：進行攻擊時顯示刀光劍影／爪痕特效
      }
      return;
    }
    if (st.phase !== "window") return;
    // 使用者明確規格：2秒內按下迴避或防禦才算成功回應——迴避看dodgePressedAt是否落在
    // 這次窗口開始之後（避免沿用窗口開啟前、上一擊留下的舊按鍵紀錄）；防禦看目前是否
    // 正長按著（blockHolding），成功防禦要另外扣體力，體力不足則視同沒擋到。
    var dodged = dodgePressedAt >= st.windowStartAt;
    var special = specialDefensePressedAt >= st.windowStartAt;
    if (dodged || blockHolding || special) {
      resolveMyIncomingHit(st, dodged ? "dodge" : special ? "special" : "block");
      return;
    }
    if (now >= st.phaseEndAt) resolveMyIncomingHit(st, "hit");
  }

  // 2026-09-06優化：迴避/防禦成功或受到傷害時，在對應按鈕上方短暫顯示文字，1秒後自動
  // 消失（見resolveMyIncomingHit()呼叫端）。跟showToast()是各自獨立的小型UI元件，這個
  // 固定綁在某個按鈕的位置上，不是畫面中央的全域提示。
  var actionFlashTimers = {};
  function showActionFlash(elId, text, variant) {
    var target = el(elId);
    if (!target) return;
    target.textContent = text;
    target.className = "midnight-action-flash" + (variant ? " midnight-action-flash-" + variant : "");
    target.hidden = false;
    if (actionFlashTimers[elId]) clearTimeout(actionFlashTimers[elId]);
    actionFlashTimers[elId] = setTimeout(function () {
      target.hidden = true;
    }, 1000);
  }

  // 防禦成功時的傷害＝incomingDamage×(1-pct/100)（使用者明確規格：「根據HP價值來扣相應
  // 的趴數 90 = 90%減免」），取代舊版「擋到＝完全不扣血」；沒有盾牌/雙手持握的達人資格、
  // 或體力不足以支付骰子成本×2時，防禦失敗、視同完全命中（kind改成"hit"）。special＝
  // 第六感／遺物效果額外防禦（見availableSpecialDefenseOption），資源不足時同樣降級為"hit"，
  // 成功則比照dodge完全無效化（不進入下面的HP損害transaction）。
  function resolveMyIncomingHit(st, kind) {
    var blockPct = 0;
    if (kind === "block") {
      var guard = currentGuardInfo();
      if (!guard || !spendStamina(guard.costPoints * DICE_COUNT_TO_STAMINA_MULT)) {
        kind = "hit";
      } else {
        blockPct = guard.pct;
      }
    }
    if (kind === "special") {
      var c = characters[myTokenId];
      var type = c && c.typeId ? window.PriTestCharacterTypes.get(c.typeId) : null;
      var option = availableSpecialDefenseOption(c, type);
      if (!option || !trySpendSpecialDefenseCost(c, option)) kind = "hit";
    }
    // 2026-09-06優化（使用者明確規格「因迴避或防禦而成功擋下敵人攻擊時，在其按鈕上方
    // 顯示[成功迴避][成功防禦]1秒後消失，反之受到傷害則在上面顯示紅字[受到傷害]」）：
    // 上面兩段已經把資源不足的降級處理完，這裡的kind是最終結果。block雖然仍會造成
    // 部分傷害（見下方減傷計算），但規則上仍算「防禦成功」（跟kind==="hit"的完全命中
    // 區分），所以歸在成功那一組。
    if (kind === "dodge") {
      showActionFlash("midnight-dodge-flash", window.I18N.t("midnight_dodge_success_flash"), "success");
    } else if (kind === "block") {
      showActionFlash("midnight-block-flash", window.I18N.t("midnight_block_success_flash"), "success");
    } else if (kind === "special") {
      showActionFlash("midnight-defense-special-flash", window.I18N.t("midnight_block_success_flash"), "success");
    } else {
      showActionFlash("midnight-dodge-flash", window.I18N.t("midnight_damage_taken_flash"), "damage");
      showActionFlash("midnight-block-flash", window.I18N.t("midnight_damage_taken_flash"), "damage");
    }
    // 2026-09-06數值真正接入：敵人攻擊傷害不再是固定的ENEMY_ATTACK_DAMAGE佔位值，改用
    // 這一招實際解析出的dmgAmount（見resolveEnemyActionOutcome()）÷10（使用者明確規格：
    // 「敵人傷害計算：串接後的傷害值除以10」，比照night.js既有的「乱戦/個別傷害÷HP價值」
    // 換算精神，這裡改用固定÷10簡化），再套用測試模式倍率。抽不到招式或算不出數值
    // （dmgKind為null）時視為0傷害，不發明數值（CLAUDE.md §19）。
    if (kind === "hit" || kind === "block") {
      // 2026-09-06優化（使用者明確規格「使用聖杯瓶時間為1.0s，期間使用任何動作、受到傷害
      // 都會停止使用」）：迴避/特殊防禦完全化解不算「受到傷害」，只有真的進入這裡（完全
      // 命中／防禦部分減傷）才取消聖杯瓶讀取，跟其他動作共用同一個取消函式。
      cancelFlaskReadingForOtherAction();
      var rawDamage = Math.round(((st.dmgAmount || 0) / 10) * testMult("enemyAtkMult"));
      var damage = kind === "block" ? Math.round(rawDamage * (1 - blockPct / 100)) : rawDamage;
      lastEnemyDamageInfo = { amount: damage, at: Date.now() };
      var maxHp = mySelfHpMaxFallback();
      GameStorage.rtTransaction(gameId, "cloud", "demoStat/" + myTokenId, function (cur) {
        var next = (cur === null ? maxHp : cur) - damage;
        return next < 0 ? 0 : next;
      });
    }
    // 敵人屬性攻擊（2026-09-06角色能力真正接入・不撓前置工程新增，使用者明確規格）：只在
    // 完全命中（kind==="hit"，未被迴避/防禦/特殊防禦化解）時套用，比照迴避/防禦連同追加
    // 效果一併無效化的既有慣例。這次攻擊已經是規則書「アクション決定表」抽出的唯一一招
    // （見maybeStartEnemyAttack()），直接解析這一招本身的mod欄位（見
    // parseElementalAttacksFromAction()），不再是「掃全部actions[]再隨機挑一個」的demo
    // 佔位做法；一招可能同時附帶多個屬性/異常，全部套用。
    if (kind === "hit") {
      parseElementalAttacksFromAction({ mod: st.actionMod }).forEach(function (a) {
        recordReceivedAttributeAccum(a.label, a.value);
      });
    }
    dodgePressedAt = 0; // 這次按鍵已經用掉，避免同一次按鍵被下一擊重複判定成功
    specialDefensePressedAt = 0;
    st.hitIndex += 1;
    if (st.hitIndex >= st.hitCount) {
      st.phase = "done";
      return;
    }
    st.phase = "window";
    st.windowStartAt = Date.now();
    st.phaseEndAt = st.windowStartAt + enemyAttackHitWindowMs(st.hitIndex);
    triggerAttackEffect();
  }

  // 攻擊特效：2026-09-06數值真正接入，使用者明確要求取消野獸撕咬動畫，固定只用刀光，
  // 純視覺、跟命中結果無關——敵人這一下本來就會「打出來」，玩家迴避/防禦成功與否只
  // 影響有沒有真的扣血。
  function triggerAttackEffect() {
    var effectEl = el("midnight-attack-effect");
    effectEl.className = "midnight-attack-effect-slash";
    effectEl.hidden = false;
    if (attackEffectTimer) clearTimeout(attackEffectTimer);
    attackEffectTimer = setTimeout(function () {
      effectEl.hidden = true;
      effectEl.className = "";
    }, ATTACK_EFFECT_DISPLAY_MS);
  }

  // 玩家攻擊命中敵人的刀光顏色對照（2026-09-06使用者明確要求「能根據有些帶有屬性效果
  // 等等的更換顏色：無屬性白色/炎紅色/魔藍色/毒綠色/雷金色/聖黃帶白色」）：比對的是
  // weaponAccumulationEffects()回傳的label原文（可能是zh"火"或ja"炎"，見weapons_data.js
  // 的C(ja,zh)雙語資料，兩種字都比對），不是遊戲規則數值，純粹UI呈現用途。找不到符合的
  // 屬性字樣（含武器沒有任何屬性/異常技能時）一律視為無屬性、顯示白色。
  var ENEMY_HIT_ELEMENT_COLOR_RULES = [
    { test: /^(炎|火)/, color: "#ff5a40" },
    { test: /^魔/, color: "#4d9dff" },
    { test: /^(猛毒|毒)/, color: "#4ecb6b" },
    { test: /^雷/, color: "#ffcf3d" },
    { test: /^聖/, color: "#fff6c2" },
  ];
  var ENEMY_HIT_NO_ELEMENT_COLOR = "#ffffff";

  function enemyHitColorFromEffects(effects) {
    for (var i = 0; i < (effects || []).length; i++) {
      var label = effects[i].label || "";
      for (var j = 0; j < ENEMY_HIT_ELEMENT_COLOR_RULES.length; j++) {
        if (ENEMY_HIT_ELEMENT_COLOR_RULES[j].test.test(label)) return ENEMY_HIT_ELEMENT_COLOR_RULES[j].color;
      }
    }
    return ENEMY_HIT_NO_ELEMENT_COLOR;
  }

  // 目前使用中武器的命中特效顏色：直接重用CharacterDrawer.weaponAccumulationEffects()
  // （跟applyWeaponAttributeAccumOnHit()同一份資料），不重新解析武器屬性技能。
  function weaponHitColor(weaponId) {
    var c = characters[myTokenId];
    if (!c || !weaponId) return ENEMY_HIT_NO_ELEMENT_COLOR;
    return enemyHitColorFromEffects(CharacterDrawer.weaponAccumulationEffects(c, weaponId));
  }

  // 玩家攻擊命中特效（2026-09-06使用者明確要求「玩家使用任何攻擊效果時,也在敵人的圖片
  // 上產生不同的刀光效果」）：只在真的站在有敵人圖片可疊加的遭遇（activeEncounter）時
  // 顯示，共用標靶demo（沒有encounter）沒有圖片可疊，直接跳過。
  function triggerEnemyHitEffect(color) {
    if (!activeEncounter) return;
    var effectEl = el("midnight-enemy-hit-effect");
    if (!effectEl) return;
    effectEl.style.setProperty("--hit-color", color || ENEMY_HIT_NO_ELEMENT_COLOR);
    effectEl.hidden = false;
    // 重新觸發CSS animation（連續命中時，上一次的動畫可能還沒播完）：先移除play class、
    // 強制reflow，再加回去，讓瀏覽器把它當成全新的animation重新播放。
    effectEl.classList.remove("midnight-enemy-hit-effect-play");
    void effectEl.offsetWidth; // 強制reflow
    effectEl.classList.add("midnight-enemy-hit-effect-play");
    if (enemyHitEffectTimer) clearTimeout(enemyHitEffectTimer);
    enemyHitEffectTimer = setTimeout(function () {
      effectEl.hidden = true;
    }, ENEMY_HIT_EFFECT_DISPLAY_MS);
  }

  // 警示圖示：只在phase==="warn"（攻擊發動前0.5秒）顯示，CSS負責閃爍動畫本身。
  // 2026-09-06數值真正接入新增：同時顯示這一招的招式名稱（使用者明確規格）。
  function renderEnemyAttackOverlay() {
    var showing = !!(myIncomingAttack && myIncomingAttack.phase === "warn");
    el("midnight-incoming-attack-warning").hidden = !showing;
    if (showing) {
      var nameEl = el("midnight-incoming-attack-name");
      var name = myIncomingAttack.actionName ? window.PriTestEnemies.localizedText(myIncomingAttack.actionName) : "";
      if (nameEl) nameEl.textContent = name;
      // Day3夜之王專屬：顯示這一招規則書原文note（見pickAndResolveBossAction()），一般
      // 敵人的攻擊沒有這個欄位，元素維持隱藏。
      var noteEl = el("midnight-incoming-attack-note");
      if (noteEl) {
        noteEl.hidden = !myIncomingAttack.actionNote;
        noteEl.textContent = myIncomingAttack.actionNote || "";
      }
    }
  }

  // 每影格驅動：不在activeEncounter內（沒站在遇敵點旁、沒解決分歧、或敵人已死）時，
  // 清掉本地殘留狀態並直接return——這個機制完全依附在既有的「同一板塊、同一籌碼事件」
  // 遇敵範圍判定上（使用者明確規格）。
  function updateEnemyAttack(now) {
    if (!activeEncounter || isPaused()) {
      myIncomingAttack = null;
      renderEnemyAttackOverlay();
      return;
    }
    var pt = activeEncounter;
    var trig = fieldTriggers[pt.id] || {};
    ensureNextAttackScheduled(pt, trig);
    maybeStartEnemyAttack(pt, trig, now);
    maybeFinishEnemyAttack(pt, trig, now);
    updateMyIncomingAttack(pt, trig, now);
    renderEnemyAttackOverlay();
  }

  // ============================================================================
  // 魔術師塔解謎：地圖上card==="10"／type==="sorcerer"的既有生成點（見midnight_map.js
  // buildPointRequests()），玩家靠近時顯示「解謎」按鈕，點擊後跳出簡易四則運算題目，
  // 30秒內答對才算成功。已解開的塔用RTDB的towerSolved/{pointId}記錄（用transaction()
  // 判定「是誰先解開的」，避免多人同時解同一座塔時重複發獎勵——跟demoStat攻擊/縮圈扣血
  // 用的是同一套併發安全機制，不是另外發明的）。
  // ============================================================================

  function updateNearbyTower() {
    if (!mySlot || !localPos || autoFly) {
      nearbyTower = null;
      renderTowerOverlay();
      return;
    }
    var found = null;
    map.points.forEach(function (pt) {
      if (found || pt.type !== "sorcerer") return;
      var dist = Math.hypot(localPos.x - (pt.x + 0.5), localPos.y - (pt.y + 0.5));
      if (dist <= TOWER_ACTIVATE_RADIUS) found = pt;
    });
    nearbyTower = found;
    if (found) maybeAdvanceTowerInvite(found);
    renderTowerOverlay();
  }

  // 靠近塔按下「進入」：建立towerInvites/{pointId}（inviting狀態），廣播
  // FIELD_INVITE_TIME_LIMIT_MS邀請時限——沿用跟一般地點卡完全同款的3秒邀請時限常數，
  // 不另外發明第二個時限數字。
  function handleTowerEnterClick(pt) {
    // 2026-09-06三次優化（使用者明確規格「夜之強敵戰鬥中無法任何的參加其他板塊與籌碼」）：
    // activeEncounter存在＝目前正在跟某個地圖點的敵人戰鬥中，此時不能另外開啟其他籌碼/
    // 板塊互動（塔／祝福／商人／拾取／靈鳥飛行皆同一守衛）。
    if (!mySlot || isPaused() || activeEncounter || towerSolved[pt.id] || towerInvites[pt.id] || towerEnterAttempted[pt.id]) return;
    towerEnterAttempted[pt.id] = true;
    var now = Date.now();
    GameStorage.rtTransaction(gameId, "cloud", "towerInvites/" + pt.id, function (cur) {
      if (cur !== null) return cur;
      var participants = {};
      participants[mySlot] = true;
      return {
        status: "inviting",
        initiatedBy: mySlot,
        startedAt: now,
        inviteDeadline: now + FIELD_INVITE_TIME_LIMIT_MS,
        participants: participants,
      };
    });
  }

  function handleAcceptTowerInviteClick(pt) {
    if (!mySlot || isPaused()) return;
    var invite = towerInvites[pt.id];
    if (!invite || invite.status !== "inviting") return;
    GameStorage.rtSet(gameId, "cloud", "towerInvites/" + pt.id + "/participants/" + mySlot, true);
  }

  function maybeAdvanceTowerInvite(pt) {
    var invite = towerInvites[pt.id];
    if (!invite || invite.status !== "inviting" || towerInviteResolveAttempted[pt.id]) return;
    if (Date.now() < invite.inviteDeadline) return;
    towerInviteResolveAttempted[pt.id] = true;
    GameStorage.rtTransaction(gameId, "cloud", "towerInvites/" + pt.id, function (cur) {
      if (!cur || cur.status !== "inviting") return cur;
      return {
        status: "active",
        initiatedBy: cur.initiatedBy,
        startedAt: cur.startedAt,
        inviteDeadline: cur.inviteDeadline,
        participants: cur.participants || {},
      };
    });
  }

  // 邀請結束、狀態轉active後，對「所有參與者」（不只是發起人）自動開一次解謎modal——
  // 跟一般地點卡「active後自動打字機」是同樣的自動化精神，不需要玩家再點一次按鈕。
  function renderTowerOverlay() {
    var pt = nearbyTower;
    var promptEl = el("midnight-tower-prompt");
    var enterBtn = el("btn-midnight-tower-enter");
    var inviteWait = el("midnight-tower-invite-wait");
    if (!pt || towerSolved[pt.id]) {
      promptEl.hidden = true;
      return;
    }
    promptEl.hidden = false;
    var invite = towerInvites[pt.id];
    var amParticipant = !!(invite && invite.participants && invite.participants[mySlot]);
    if (!invite) {
      enterBtn.hidden = false;
      inviteWait.hidden = true;
      return;
    }
    enterBtn.hidden = true;
    if (invite.status === "inviting") {
      inviteWait.hidden = amParticipant;
      if (!amParticipant) {
        var inviterName = (players[invite.initiatedBy] && players[invite.initiatedBy].name) || "";
        el("midnight-tower-invite-text").textContent = window.I18N.t("midnight_field_invite_text", {
          inviter: inviterName,
          name: fieldLocationName(pt),
        });
      }
      return;
    }
    inviteWait.hidden = true;
    if (invite.status === "active" && amParticipant && !towerSolved[pt.id] && !towerPuzzleStartedFor[pt.id]) {
      towerPuzzleStartedFor[pt.id] = true;
      startTowerPuzzle(pt);
    }
  }

  function startTowerPuzzle(pt) {
    if (towerSolved[pt.id]) return;
    var a = 1 + Math.floor(Math.random() * 12);
    var b = 1 + Math.floor(Math.random() * 12);
    var ops = ["+", "-", "×"];
    var op = ops[Math.floor(Math.random() * ops.length)];
    var answer;
    if (op === "+") {
      answer = a + b;
    } else if (op === "-") {
      if (b > a) {
        var tmp = a;
        a = b;
        b = tmp;
      }
      answer = a - b;
    } else {
      answer = a * b;
    }
    puzzle = { pointId: pt.id, answer: answer, deadline: Date.now() + TOWER_PUZZLE_TIME_LIMIT_MS };
    el("midnight-puzzle-question").hidden = false;
    el("midnight-puzzle-question").textContent = a + " " + op + " " + b + " = ?";
    el("midnight-puzzle-answer-input").hidden = false;
    el("midnight-puzzle-answer-input").value = "";
    el("btn-midnight-puzzle-submit").hidden = false;
    el("btn-midnight-puzzle-submit").disabled = false;
    el("midnight-puzzle-result").textContent = "";
    el("midnight-tower-puzzle-modal").hidden = false;
  }

  function handlePuzzleSubmit() {
    if (!puzzle) return;
    if (Date.now() > puzzle.deadline) {
      showPuzzleResult(window.I18N.t("midnight_puzzle_timeout_text"));
      puzzle = null;
      return;
    }
    var input = parseInt(el("midnight-puzzle-answer-input").value, 10);
    if (input !== puzzle.answer) {
      el("midnight-puzzle-result").textContent = window.I18N.t("midnight_puzzle_fail_text");
      return;
    }
    var pointId = puzzle.pointId;
    var submitBtn = el("btn-midnight-puzzle-submit");
    submitBtn.disabled = true;
    GameStorage.rtTransaction(gameId, "cloud", "towerSolved/" + pointId, function (cur) {
      return cur ? cur : { solvedBy: myTokenId };
    }).then(function (committed) {
      if (committed && committed.solvedBy === myTokenId) {
        // 「任何一個人完成就全員完成能獲得獎勵」（使用者明確規格）：對towerInvites裡
        // 這場邀請的所有參與者發獎，不是只給實際解謎、贏得transaction的這個人——比照
        // maybeGrantStrongEnemyReward()「對participants全體push獎勵」的既有寫法。
        var invite = towerInvites[pointId];
        var participantSlotsList = invite ? Object.keys(invite.participants || {}) : [mySlot];
        participantSlotsList.forEach(function (slot) {
          var p = players[slot];
          var targetTokenId = p ? p.tokenId : myTokenId;
          GameStorage.rtTransaction(gameId, "cloud", "character/" + targetTokenId + "/runes", function (cur) {
            return (cur === null ? 0 : cur) + TOWER_REWARD_RUNES;
          });
        });
        showPuzzleResult(window.I18N.t("midnight_puzzle_success_text", { runes: TOWER_REWARD_RUNES }));
      } else {
        showPuzzleResult(window.I18N.t("midnight_puzzle_already_solved_text"));
      }
      puzzle = null;
    });
  }

  function showPuzzleResult(text) {
    el("midnight-puzzle-result").textContent = text;
    el("midnight-puzzle-question").hidden = true;
    el("midnight-puzzle-answer-input").hidden = true;
    el("btn-midnight-puzzle-submit").hidden = true;
  }

  function closeTowerPuzzleModal() {
    el("midnight-tower-puzzle-modal").hidden = true;
    puzzle = null;
  }

  // ============================================================================
  // 地圖點卡牌事件（2026-09-05新增，2026-09-06改版，見上方FIELD_*常數註解）。
  // ============================================================================

  // 用「地圖種子＋任意字串」決定性地衍生一個0~count-1的索引：挑分歧變體、挑意見不一致
  // 逾時後的系統決定、挑同一段落內有多隻敵人引用時要選哪一隻，都用這個取代
  // Math.random()——保證各裝置在同樣輸入下算出同樣結果，不需要額外靠transaction()仲裁
  // 「選到哪一個」，只需要transaction()仲裁「有沒有人已經寫過」。
  function stringSeedFrom(base, extra) {
    var str = base + "|" + extra;
    var h = 0;
    for (var i = 0; i < str.length; i++) {
      h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
    }
    return h >>> 0;
  }

  function fieldSeededIndex(key, count) {
    if (count <= 0) return 0;
    var rand = Map_.mulberry32(stringSeedFrom(String(meta.mapSeed), key));
    return Math.floor(rand() * count);
  }

  // 地圖點的card（"2".."10"／"K"）對應到static_src/fields_data_1~4.js既有資料的id
  // （"card_2".."card_10"／"card_k"）——直接沿用既有規則資料的地點名稱/分歧名稱/分歧
  // 介紹文字/樓層敘述，不是自己另外編寫的。
  function fieldCardData(card) {
    if (!window.PriTestFields) return null;
    return window.PriTestFields.get("card_" + card.toLowerCase());
  }

  function fieldCardBranches(card) {
    var data = fieldCardData(card);
    return (data && data.branches) || [];
  }

  // 這張卡的固定樓層數（night規則書「フィールド1つは1〜5つのフロアで構成」）：優先讀
  // 卡片本身的floorCount欄位（跟branch.floors.length可能不同，例如水辺の大教会那種
  // 「フロア1〜4を任意の順番で2つ踏破すれば全踏破」的freeFloorOrder特例卡：floorCount
  // 是2，但floors陣列仍列出4個）。這裡不支援freeFloorOrder的「任意順序」彈性，一律照
  // 陣列順序（0,1,2...）走到floorCount為止即視為全踏破——是已知的簡化（跟本檔案其他
  // 「本次milestone明確排除」的範圍限縮同精神），不是算錯數字。
  function fieldFloorCountForCard(card) {
    var data = fieldCardData(card);
    if (data && typeof data.floorCount === "number") return data.floorCount;
    var branches = fieldCardBranches(card);
    return (branches[0] && branches[0].floors && branches[0].floors.length) || 1;
  }

  function fieldLocationName(pt) {
    var data = fieldCardData(pt.card);
    return data ? window.PriTestFields.localizedText(data.name) : "";
  }

  // 這個點本次要用哪個分歧變體（例如「大教會(1)」／「大教會(2)」／「大教會（炎）」…）：
  // 規則書原本是依劇本/花色查varianceTable決定，這裡沒有「劇本」「花色」這些概念，改用
  // fieldSeededIndex()決定性挑一個——不是玩家投票的對象（使用者這次的規格是「分歧點」
  // 指樓層敘述裡的「(→XXX)」選擇，見下方fieldChoiceLabelsFor()，不是變體本身）。
  function pickFieldBranchIndex(pt) {
    var branches = fieldCardBranches(pt.card);
    return branches.length ? fieldSeededIndex(pt.id + ":branch", branches.length) : 0;
  }

  // 樓層裡負責敘述場景的那一行：規則書固定用【描写／描寫】標籤（見fields_data_*.js的
  // L(0,["描写","描寫"],...)），突破判定等機關行不算敘述。找不到就退回分歧介紹
  // （branch.intro），再找不到就退回地點名稱本身——愈後面愈簡陋，但不會是空字串。
  function findFloorDescriptionLine(floor) {
    var lines = (floor && floor.lines) || [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (line.depth === 0 && line.label && (line.label.ja === "描写" || line.label.zh === "描寫")) return line;
    }
    return null;
  }

  function fieldFloorForTrig(pt, trig) {
    var branch = fieldCardBranches(pt.card)[trig.branchIndex];
    return branch ? (branch.floors || [])[trig.floorIndex || 0] : null;
  }

  function fieldNarrativeTextFor(pt, trig) {
    var branch = fieldCardBranches(pt.card)[trig.branchIndex];
    var floor = fieldFloorForTrig(pt, trig);
    var descLine = findFloorDescriptionLine(floor);
    if (descLine) return window.PriTestFields.localizedText(descLine.text);
    if (branch && branch.intro) return window.PriTestFields.localizedText(branch.intro);
    return fieldLocationName(pt);
  }

  // 分歧點選項：直接沿用static_src/night_gm_flow.js既有的「(→XXX)」標記偵測
  // （parseChoiceLabels，跟GM敘述樓層本文用的是同一套規則書標記規則，不是自己發明的
  // 選項），從樓層敘述文字裡抓出來。沒有標記（0或1個）代表這段沒有真正的分歧，不需要
  // 投票，直接視為單一結果往下走。
  function fieldChoiceLabelsFor(pt, trig) {
    var text = fieldNarrativeTextFor(pt, trig);
    return window.PriTestNightGmFlow.parseChoiceLabels(text);
  }

  function participantSlots(trig) {
    var participants = (trig && trig.participants) || {};
    return Object.keys(participants).filter(function (slot) {
      return participants[slot];
    });
  }

  // 靠近判定：跟updateNearbyTower()/updateNearbyBird()同樣的pattern，只是這裡同時要
  // 驅動整條「邀請→正式進入→打字機→投票→遇敵」流程。sorcerer型別排除在外（已有自己
  // 獨立的解謎流程，見startTowerPuzzle）。
  // 這幾型是新籌碼點（merchant／strong_enemy／random_event／blessing，見
  // updateNearbyChipPoint()），跟field卡牌點各自獨立的proximity/流程，不能被這裡的
  // 「進入」流程誤判。2026-09-06修正：漏排除blessing，導致靠近祝福籌碼時
  // #midnight-field-enter-prompt跟#midnight-blessing-prompt同時觸發，形成使用者回報的
  // 「祝福畫面有兩個進入」重複顯示。
  var NON_FIELD_POINT_TYPES = { sorcerer: true, merchant: true, strong_enemy: true, random_event: true, blessing: true };

  function updateNearbyFieldPoint() {
    if (!mySlot || !localPos || autoFly) {
      nearbyFieldPoint = null;
      recomputeActiveEncounter();
      renderFieldOverlay();
      return;
    }
    var found = null;
    map.points.forEach(function (pt) {
      if (found || NON_FIELD_POINT_TYPES[pt.type]) return;
      var dist = Math.hypot(localPos.x - (pt.x + 0.5), localPos.y - (pt.y + 0.5));
      if (dist <= FIELD_TRIGGER_RADIUS) found = pt;
    });
    nearbyFieldPoint = found;
    if (found) {
      maybeAdvanceFieldInvite(found);
      maybeStartFieldTypewriter(found);
      maybeSetFieldVoteDeadline(found);
      maybeResolveFieldVote(found);
      maybeGrantFieldTileRewardOnClear(found);
    }
    recomputeActiveEncounter();
    renderFieldOverlay();
  }

  // 王城（castleZone）→ J卡牌事件（2026-09-05 HUD優化新增）：串接midnight_map.js檔案
  // 開頭與buildPointRequests()註解已經明確記錄、但尚未實作的伏筆——「J＝堡壘／地下堡壘
  // （fields_data_4.js card_j），對應地圖中央固定存在的王城castleZone」。王城是一塊
  // 「範圍」不是地圖上的一個點，判斷方式用Map_.isCastleZone()（面的包含判定），不是
  // 其他地圖點慣用的FIELD_TRIGGER_RADIUS距離判斷，因此獨立成自己的updateNearbyCastle()
  // （不是塞進updateNearbyFieldPoint()改參數）。用固定id的合成點物件
  // {id, card:"J", x, y}（x/y取castleZone遮罩的重心，見midnight_map.js
  // computeMaskCentroid()）餵給既有的field事件機制（maybeAdvanceFieldInvite／
  // maybeStartFieldTypewriter／maybeSetFieldVoteDeadline／maybeResolveFieldVote／
  // maybeGrantFieldTileRewardOnClear——這些函式只讀pt.id/pt.card，不需要為王城另外
  // 寫一套）。
  function updateNearbyCastle() {
    if (!mySlot || !localPos || autoFly) {
      nearbyCastlePoint = null;
      recomputeActiveEncounter();
      renderFieldOverlay();
      return;
    }
    var inside = Map_.isCastleZone(map, localPos.x, localPos.y);
    nearbyCastlePoint = inside
      ? { id: CASTLE_POINT_ID, card: "J", x: map.castleCenter.x, y: map.castleCenter.y }
      : null;
    if (nearbyCastlePoint) {
      maybeAdvanceFieldInvite(nearbyCastlePoint);
      maybeStartFieldTypewriter(nearbyCastlePoint);
      maybeSetFieldVoteDeadline(nearbyCastlePoint);
      maybeResolveFieldVote(nearbyCastlePoint);
      maybeGrantFieldTileRewardOnClear(nearbyCastlePoint);
    }
    recomputeActiveEncounter();
    renderFieldOverlay();
  }

  // activeEncounter：field卡牌點跟strong_enemy籌碼點共用同一套fieldTriggers/{pointId}
  // 與fieldEnemyHp/{pointId} shape（見規劃紀錄「強敵/scarab 戰鬥的 RTDB 狀態機」），
  // 因此抽成一個共用步驟，接受nearbyFieldPoint、nearbyStrongEnemy或nearbyCastlePoint
  // 其中之一。
  function recomputeActiveEncounter() {
    var candidate = nearbyFieldPoint || nearbyStrongEnemy || nearbyCastlePoint || nearbyFinalCircleBoss || nearbyDay3Boss;
    var wasActive = !!activeEncounter;
    if (!candidate) {
      activeEncounter = null;
      fledEncounterIds = {}; // 離開所有觸發範圍，之後重新靠近（不管是同一點還是別的點）都要重新視為新遭遇
      // 2026-09-06優化：離開觸發範圍也清掉「已確認進入戰鬥」紀錄，之後重新靠近（同一場
      // 仍存活的戰鬥）要重新走一次[進入戰鬥]確認流程，跟fledEncounterIds同一套「離開就
      // 重置」精神（使用者明確規格「因為離開過再次進入戰鬥」）。
      confirmedEncounterIds = {};
      pendingBattleReentry = null;
      battleEnteringUntil = null;
      if (wasActive) onEncounterEnded();
      return;
    }
    if (fledEncounterIds[candidate.id]) {
      activeEncounter = null;
      pendingBattleReentry = null;
      if (wasActive) onEncounterEnded();
      return;
    }
    var trig = fieldTriggers[candidate.id];
    var hp = fieldEnemyHp[candidate.id];
    var enemyAlive = !!(trig && trig.status === "resolved" && trig.enemyFamilyId && (hp === undefined || hp > 0));
    if (!enemyAlive) {
      activeEncounter = null;
      pendingBattleReentry = null;
      if (wasActive) onEncounterEnded();
      return;
    }
    // 2026-09-06優化（使用者明確規格「若因為離開過再次進入戰鬥或參加別人的戰鬥，都須先
    // 按下上方資訊欄的進入戰鬥，接著讀條3秒後才正式進入戰鬥畫面」）：本來就是participant
    // （邀請/投票時就加入）且第一次遇到這場已解決的遭遇時，直接視為「已在其中」，不用
    // 多此一舉再按一次；否則（重新靠近、或原本不是participant想加入別人的戰鬥）要先
    // 經過下面的[進入戰鬥]確認流程，見handleEnterBattleClick()／updateBattleEnterLoading()。
    var amParticipant = !!(trig.participants && trig.participants[mySlot]);
    if (confirmedEncounterIds[candidate.id] === undefined && amParticipant) {
      confirmedEncounterIds[candidate.id] = true;
    }
    if (confirmedEncounterIds[candidate.id]) {
      pendingBattleReentry = null;
      activeEncounter = candidate;
      return;
    }
    if (!pendingBattleReentry || pendingBattleReentry.id !== candidate.id) {
      pendingBattleReentry = candidate;
      battleEnteringUntil = null; // 換了對象，先前可能還在跑的讀取作廢
    }
    activeEncounter = null;
    if (wasActive) onEncounterEnded();
  }

  // 按下上方資訊欄的[進入戰鬥]：開始BATTLE_ENTER_LOADING_MS讀取，讀取完才真正標記為
  // participant並設定activeEncounter（見updateBattleEnterLoading()）。
  function handleEnterBattleClick() {
    if (!mySlot || isPaused() || !pendingBattleReentry || battleEnteringUntil !== null) return;
    battleEnteringUntil = Date.now() + BATTLE_ENTER_LOADING_MS;
  }

  function updateBattleEnterLoading(now) {
    if (battleEnteringUntil === null || now < battleEnteringUntil) return;
    battleEnteringUntil = null;
    if (!pendingBattleReentry) return;
    var id = pendingBattleReentry.id;
    var trig = fieldTriggers[id];
    var amParticipant = !!(trig && trig.participants && trig.participants[mySlot]);
    if (!amParticipant) GameStorage.rtSet(gameId, "cloud", "fieldTrigger/" + id + "/participants/" + mySlot, true);
    confirmedEncounterIds[id] = true;
    delete fledEncounterIds[id];
    pendingBattleReentry = null;
    recomputeActiveEncounter();
  }

  // 上方資訊欄的[進入戰鬥]提示（見midnight_page.pyの#midnight-enter-battle-prompt）：
  // 沒有候選對象時整塊隱藏；有候選但還沒按下時顯示按鈕；按下後顯示讀取條
  // （沿用.midnight-loading-track/.midnight-loading-fill既有樣式，跟field卡牌的
  // 進入讀取條同一套視覺元件）。
  function renderEnterBattlePrompt() {
    var wrap = el("midnight-enter-battle-prompt");
    if (!wrap) return;
    wrap.hidden = !pendingBattleReentry;
    if (!pendingBattleReentry) return;
    var btn = el("btn-midnight-enter-battle");
    var bar = el("midnight-enter-battle-loading-bar");
    var fill = el("midnight-enter-battle-loading-fill");
    var loading = battleEnteringUntil !== null;
    if (btn) btn.hidden = loading;
    if (bar) bar.hidden = !loading;
    if (loading && fill) {
      var elapsed = BATTLE_ENTER_LOADING_MS - (battleEnteringUntil - Date.now());
      fill.style.width = Math.max(0, Math.min(100, (elapsed / BATTLE_ENTER_LOADING_MS) * 100)) + "%";
    }
  }

  // 遭遇結束時的清理（2026-09-05角色能力真正接入新增）：高防禦狀態（規則書「直到結束
  // 階段為止」，midnight沒有phase概念，比照CLAUDE.md §21精神，選在「離開/解決這場遭遇」
  // 時清除）；不撓堆疊（2026-09-06新增，規則書「直到戰鬥結束為止」，同樣選在遭遇結束時
  // 歸零，並清空這場遭遇累積的「自身受到屬性/異常」蓄積，避免殘留到下一場戰鬥）。
  function onEncounterEnded() {
    var c = characters[myTokenId];
    if (c && c._highGuardActive) {
      c._highGuardActive = false;
      GameStorage.rtSet(gameId, "cloud", "character/" + myTokenId + "/_highGuardActive", false);
    }
    if (c && c._unyieldingStacks) {
      c._unyieldingStacks = 0;
      GameStorage.rtSet(gameId, "cloud", "character/" + myTokenId + "/_unyieldingStacks", 0);
    }
    receivedAttributeAccum = {};
    receivedAttributeAccumTriggeredCount = {};
  }

  // 逃離戰鬥（2026-09-06使用者明確要求「在敵人資訊中右上方有逃離戰鬥按鈕」）：見上方
  // fledEncounterIds說明，只是本地端放棄目前這場activeEncounter，不做任何規則書判定。
  function handleFleeBattleClick() {
    if (!mySlot || isPaused() || !activeEncounter) return;
    fledEncounterIds[activeEncounter.id] = true;
    // 2026-09-06優化：逃離後也要清掉「已確認進入戰鬥」的本地紀錄，否則下次靠近時
    // recomputeActiveEncounter()會因為confirmedEncounterIds還是true而跳過[進入戰鬥]
    // 讀條，等同逃離沒有生效。
    delete confirmedEncounterIds[activeEncounter.id];
    recomputeActiveEncounter();
    renderCombatPanel();
  }

  // 按下「進入」：建立這個點的事件紀錄，發起人自己直接算第一個參與者。用transaction()
  // 保證多裝置幾乎同時按到同一個點時只有一份紀錄生效（跟maybeTriggerLobbyCountdown()
  // 同樣的併發安全模式）。
  // 角色是否持有某個itemId的消耗品（石劍鑰匙／鍛造石的持有判定，見
  // handleEnterFieldPointClick／renderMerchantForgeList）。
  function characterHasConsumable(c, itemId) {
    return !!(c && (c.consumables || []).some(function (inst) {
      return inst.itemId === itemId;
    }));
  }

  function handleEnterFieldPointClick(pt) {
    if (!mySlot || isPaused() || fieldTriggers[pt.id] || fieldEnterAttempted[pt.id]) return;
    var progress = fieldProgress[pt.id];
    if (progress && progress.cleared) return; // 已全踏破，沒有更多樓層可以探索
    // 封牢（evergaol）：使用者明確規格「在擁有鑰匙的人才能對封牢進行動作」，只有持有
    // 石劍鑰匙的角色才能按「進入」。
    if (pt.type === "evergaol" && !characterHasConsumable(characters[myTokenId], "item_stonesword_key")) {
      showToast(window.I18N.t("midnight_evergaol_need_key_note"));
      return;
    }
    fieldEnterAttempted[pt.id] = true;
    var now = Date.now();
    GameStorage.rtTransaction(gameId, "cloud", "fieldTrigger/" + pt.id, function (cur) {
      if (cur !== null) return cur;
      var participants = {};
      participants[mySlot] = true;
      return {
        status: "inviting",
        initiatedBy: mySlot,
        startedAt: now,
        inviteDeadline: now + FIELD_INVITE_TIME_LIMIT_MS,
        participants: participants,
      };
    });
  }

  // 附近玩家在邀請時限內按下「加入」：直接把自己這個席位寫進participants，不需要
  // transaction（重複寫true本來就是幂等的，兩人同時按也不會互相蓋掉彼此）。
  function handleAcceptFieldInviteClick(pt) {
    if (!mySlot || isPaused()) return;
    var trig = fieldTriggers[pt.id];
    if (!trig || trig.status !== "inviting") return;
    GameStorage.rtSet(gameId, "cloud", "fieldTrigger/" + pt.id + "/participants/" + mySlot, true);
  }

  // 邀請時限一到，任何看得到這個點的裝置都可以把狀態從inviting轉成active（不論當時
  // 究竟有誰加入了——「第一次邀請結束後才正式進入」是使用者明確規格，不會因為沒人回應
  // 而卡住不動）。分歧變體（branchIndex）只在這張卡第一次被進入時決定性挑定，之後
  // 每一層都沿用同一個branchIndex（見fieldProgress，第2層以後靠已存的進度接續，不會
  // 重新抽一次分歧）。floorIndex同理：有進度就從未踏破的那一層開始，不是每次都從0。
  function maybeAdvanceFieldInvite(pt) {
    var trig = fieldTriggers[pt.id];
    if (!trig || trig.status !== "inviting" || fieldInviteResolveAttempted[pt.id]) return;
    if (Date.now() < trig.inviteDeadline) return;
    fieldInviteResolveAttempted[pt.id] = true;
    var progress = fieldProgress[pt.id];
    var branchIndex = progress && typeof progress.branchIndex === "number" ? progress.branchIndex : pickFieldBranchIndex(pt);
    var floorIndex = (progress && progress.floorIndex) || 0;
    GameStorage.rtTransaction(gameId, "cloud", "fieldTrigger/" + pt.id, function (cur) {
      if (!cur || cur.status !== "inviting") return cur;
      return {
        status: "active",
        initiatedBy: cur.initiatedBy,
        startedAt: cur.startedAt,
        inviteDeadline: cur.inviteDeadline,
        participants: cur.participants || {},
        enterAt: cur.inviteDeadline,
        branchIndex: branchIndex,
        floorIndex: floorIndex,
      };
    });
  }

  // 正式進入後，參與者各自的裝置在enterAt+0.5秒時才開始播打字機（各裝置各自本地計時，
  // 都是從同一個共享的enterAt算起，不需要額外再靠RTDB同步「現在播到第幾個字」）。直接
  // 重用static_src/night_gm_flow.js既有的typewriteInto()——跟night.js的GM敘述用同一個
  // 打字機function，不是自己另外寫一套。
  function maybeStartFieldTypewriter(pt) {
    var trig = fieldTriggers[pt.id];
    if (!trig || trig.status === "inviting") return;
    if (!trig.participants || !trig.participants[mySlot]) return;
    if (fieldTypewriterStartedFor[pt.id]) return;
    if (Date.now() < trig.enterAt + FIELD_ENTER_WAIT_MS) return;
    fieldTypewriterStartedFor[pt.id] = true;
    var text = fieldNarrativeTextFor(pt, trig);
    window.PriTestNightGmFlow.typewriteInto(el("midnight-field-narrative-text"), text, {
      onDone: function () {
        fieldTypewriterDoneFor[pt.id] = true;
      },
    });
  }

  // 打字機播完才開始算「意見不一致等待時間」（使用者規格：讀完敘述才跳出選項投票），
  // 用transaction()保證只有第一個抵達的裝置真正決定deadline的起點。
  function maybeSetFieldVoteDeadline(pt) {
    var trig = fieldTriggers[pt.id];
    if (!trig || trig.status !== "active") return;
    if (!trig.participants || !trig.participants[mySlot]) return;
    if (!fieldTypewriterDoneFor[pt.id] || fieldVoteDeadlineSetAttempted[pt.id]) return;
    fieldVoteDeadlineSetAttempted[pt.id] = true;
    var now = Date.now();
    GameStorage.rtTransaction(gameId, "cloud", "fieldTrigger/" + pt.id + "/voteDeadline", function (cur) {
      return cur === null ? now + FIELD_VOTE_TIME_LIMIT_MS : cur;
    });
  }

  // 只有「目前在同一卡牌事件的參與者」（trig.participants）需要選擇同一項才確定，不是
  // 全場已入座玩家——不在事件內的人本來就不參與這個板塊的任何事情（使用者明確規格）。
  // 全員一致才確定執行；全員都投了但意見不一致則繼續等，直到10秒逾時才由系統決定。
  function maybeResolveFieldVote(pt) {
    var trig = fieldTriggers[pt.id];
    if (!trig || trig.status !== "active" || fieldVoteResolveAttempted[pt.id]) return;
    if (!trig.voteDeadline) return; // 打字機還沒播完、還沒開始算投票時限
    var labels = fieldChoiceLabelsFor(pt, trig);
    var now = Date.now();
    var choiceIndex = null;
    if (labels.length <= 1) {
      choiceIndex = 0;
    } else {
      var participants = participantSlots(trig);
      var votes = trig.votes || {};
      var timedOut = now >= trig.voteDeadline;
      var allVoted =
        participants.length > 0 &&
        participants.every(function (slot) {
          return votes[slot] !== undefined && votes[slot] !== null;
        });
      if (allVoted) {
        var first = votes[participants[0]];
        var consensus = participants.every(function (slot) {
          return votes[slot] === first;
        });
        if (consensus) choiceIndex = first;
        else if (timedOut) choiceIndex = pickFallbackChoice(votes, participants, labels.length, pt);
        else return; // 全員都投了但還沒有共識，且還沒逾時，繼續等待
      } else if (timedOut) {
        choiceIndex = pickFallbackChoice(votes, participants, labels.length, pt);
      } else {
        return;
      }
    }
    fieldVoteResolveAttempted[pt.id] = true;
    GameStorage.rtTransaction(gameId, "cloud", "fieldTrigger/" + pt.id, function (cur) {
      if (!cur || cur.status !== "active") return cur;
      var out = {};
      for (var k in cur) out[k] = cur[k]; // ES5：不用Object.assign，手動合成（跟night_gm_flow.js的mergeParams同樣手法）
      out.status = "resolved";
      out.choiceIndex = choiceIndex;
      out.resolvedAt = Date.now();
      return out;
    }).then(function () {
      maybeAssignFieldEnemy(pt, choiceIndex);
    });
  }

  // 逾時仍未達成共識時的系統決定：優先取得票數最多的選項（多數決），完全沒有人投票時
  // 用fieldSeededIndex()決定性挑一個，確保各裝置得出同樣結果。
  function pickFallbackChoice(votes, participants, labelCount, pt) {
    var counts = {};
    participants.forEach(function (slot) {
      var v = votes[slot];
      if (v === undefined || v === null) return;
      counts[v] = (counts[v] || 0) + 1;
    });
    var bestIndex = null;
    var bestCount = -1;
    Object.keys(counts).forEach(function (key) {
      if (counts[key] > bestCount) {
        bestCount = counts[key];
        bestIndex = parseInt(key, 10);
      }
    });
    if (bestIndex !== null) return bestIndex;
    return fieldSeededIndex(pt.id + ":choicefallback", labelCount);
  }

  // 從樓層文字中找出「選中的那個分歧標記」對應的巢狀內文：規則書把分支開頭寫成
  // depth比敘述行深一階、本文就是標籤文字本身的一行（例如
  // L(1, null, ["忍んで切り抜ける", "潛行通過"])），接下來depth更深、直到下一個
  // depth<=1為止的所有行都屬於這個分支。找不到這樣的巢狀區塊（有些「(→XXX)」指向的是
  // 同一樓層之外的地方，這裡沒有完整的跨樓層/跨卡牌連結）就退而求其次改掃整個樓層，
  // 避免因為結構對不上就完全放棄辨識敵人。
  function collectLinesForChoice(floor, label) {
    var lines = (floor && floor.lines) || [];
    var startIdx = -1;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (line.depth === 1 && window.PriTestFields.localizedText(line.text) === label) {
        startIdx = i;
        break;
      }
    }
    if (startIdx === -1) return lines;
    var out = [lines[startIdx]];
    for (var j = startIdx + 1; j < lines.length; j++) {
      if (lines[j].depth <= 1) break;
      out.push(lines[j]);
    }
    return out;
  }

  // 掃一組樓層行，找出跟static_src/night_gm_flow.js的parseCombatEnemyRef/
  // resolveCombatEnemyMatch同樣邏輯能辨識出的敵人（帶頁碼/等級的「「XXX(頁)/Lv.N」」
  // 括號引用），比對static_src/enemies_data_1~4.js既有資料——這跟night既有GM流程判斷
  // 「這個板塊會遇到哪隻敵人」用的是同一套解析，不是自己另外亂數選。每筆match額外帶
  // mobRowCount（2026-09-06死靈術前置工程新增，來自同一行GmFlow.parseCombatEnemyRef()
  // 既有解析出的「+雜兵N」後綴，不是另外自己猜的）。
  function scanLinesForEnemyMatches(lines) {
    var GmFlow = window.PriTestNightGmFlow;
    var matches = [];
    var seen = {};
    (lines || []).forEach(function (line) {
      var ja = (line.text && line.text.ja) || "";
      var zh = (line.text && line.text.zh) || "";
      if (!/「[^」]+」/.test(ja) && !/「[^」]+」/.test(zh)) return;
      var ref = GmFlow.parseCombatEnemyRef(line);
      ref.nameTokens.forEach(function (token) {
        var match = GmFlow.resolveCombatEnemyMatch(token);
        if (!match) return;
        var key = match.familyId + "|" + match.enemy.id;
        if (seen[key]) return;
        seen[key] = true;
        matches.push({ familyId: match.familyId, enemy: match.enemy, mobRowCount: ref.mobRowCount || 0, level: ref.level || 1 });
      });
    });
    return matches;
  }

  // 分歧確定後指派敵人：只看選中那個分歧段落的文字裡有沒有戰鬥引用，找不到就代表這個
  // 分歧和平通過、不指派敵人——不自行發明「這裡應該要打一場」。
  function maybeAssignFieldEnemy(pt, choiceIndex) {
    if (fieldEnemyAssignAttempted[pt.id]) return;
    var trig = fieldTriggers[pt.id];
    if (!trig) return;
    var floor = fieldFloorForTrig(pt, trig);
    if (!floor) return;
    var labels = fieldChoiceLabelsFor(pt, trig);
    var label = labels[choiceIndex];
    var lines = label ? collectLinesForChoice(floor, label) : floor.lines;
    var matches = scanLinesForEnemyMatches(lines);
    if (!matches.length) {
      // 無敵人引用＝和平通過：獎勵清單(a)「開啟並執行」，見規劃紀錄第7節。
      maybeGrantFieldTileReward(pt, trig, floor);
      maybeAdvanceFieldProgressAfterFloorClear(pt, trig);
      return;
    }
    fieldEnemyAssignAttempted[pt.id] = true;
    var picked = matches[fieldSeededIndex(pt.id + ":enemy", matches.length)];
    GameStorage.rtTransaction(gameId, "cloud", "fieldTrigger/" + pt.id + "/enemyFamilyId", function (cur) {
      return cur === null ? picked.familyId : cur;
    });
    GameStorage.rtTransaction(gameId, "cloud", "fieldTrigger/" + pt.id + "/enemyId", function (cur) {
      return cur === null ? picked.enemy.id : cur;
    });
    // 敵人等級（2026-09-06數值真正接入新增）：一般地圖遇敵原本沒有存等級，這裡比照
    // 強敵籌碼流程（rollAndAssignStrongEnemy()，同樣用"level"欄位名）一併存下來，
    // enemyRealHpMax()／敵人攻擊基準值都需要用等級查family.base對應行。
    GameStorage.rtTransaction(gameId, "cloud", "fieldTrigger/" + pt.id + "/level", function (cur) {
      return cur === null ? picked.level : cur;
    });
    GameStorage.rtTransaction(gameId, "cloud", "fieldEnemyHp/" + pt.id, function (cur) {
      return cur === null ? enemyRealHpMax({ enemyFamilyId: picked.familyId, enemyId: picked.enemy.id, level: picked.level }) : cur;
    });
    // 雜兵（2026-09-06死靈術前置工程新增，使用者明確規格）：血量＝樓層文字「+雜兵N」
    // 後綴的N×MOB_HP_PER_ROW，單一合併血量池。沒有「+雜兵」後綴（mobRowCount===0）就
    // 不建立fieldMobHp項目，damageCombatTarget()會判斷undefined＝沒有雜兵直接打敵人。
    if (picked.mobRowCount > 0) {
      GameStorage.rtTransaction(gameId, "cloud", "fieldTrigger/" + pt.id + "/mobRowCount", function (cur) {
        return cur === null ? picked.mobRowCount : cur;
      });
      GameStorage.rtTransaction(gameId, "cloud", "fieldMobHp/" + pt.id, function (cur) {
        return cur === null ? picked.mobRowCount * MOB_HP_PER_ROW : cur;
      });
    }
  }

  // ============================================================================
  // 新籌碼點（商人／強敵／隨機事件，2026-09-05新增）＋角色屬性管理＋獎勵清單系統。
  // 見規劃紀錄 C:\Users\autum\.claude\plans\pure-strolling-mochi.md。
  // ============================================================================

  function findEventChip(id) {
    var list = window.PriTestEventRulebook ? window.PriTestEventRulebook.list() : [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) return list[i];
    }
    return null;
  }

  function baseCatalogId(id) {
    var idx = String(id || "").indexOf("::");
    return idx === -1 ? id : id.slice(0, idx);
  }

  var toastTimer = null;
  function showToast(text) {
    var box = el("midnight-toast");
    if (!box) return;
    box.textContent = text;
    box.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      box.hidden = true;
    }, 4000);
  }

  // 每幀掃描這三型新籌碼點的proximity，跟updateNearbyFieldPoint()各自獨立（field卡牌
  // 已排除這三型，見NON_FIELD_POINT_TYPES）。
  function updateNearbyChipPoint() {
    if (!mySlot || !localPos || autoFly) {
      nearbyMerchant = null;
      nearbyStrongEnemy = null;
      nearbyRandomEvent = null;
      nearbyBlessing = null;
      el("midnight-merchant-prompt").hidden = true;
      el("midnight-blessing-prompt").hidden = true;
      closeMerchantModal();
      closeBlessingModal();
      recomputeActiveEncounter();
      renderStrongEnemyOverlay();
      renderScarabOverlay();
      return;
    }
    var merchant = null;
    var strongEnemy = null;
    var randomEvent = null;
    var blessing = null;
    map.points.forEach(function (pt) {
      var dist = Math.hypot(localPos.x - (pt.x + 0.5), localPos.y - (pt.y + 0.5));
      if (dist > FIELD_TRIGGER_RADIUS) return;
      if (pt.type === "merchant" && !merchant) merchant = pt;
      else if (pt.type === "strong_enemy" && !strongEnemy) strongEnemy = pt;
      else if (pt.type === "random_event" && !randomEvent) randomEvent = pt;
      // 2026-09-06使用者明確要求「使用祝福後能再次使用」：拿掉!blessingClaimed[pt.id]
      // 條件，不再因為曾經有人領取過就從此不再顯示。
      else if (pt.type === "blessing" && !blessing) blessing = pt;
    });

    // 離開範圍時關掉對應視窗（2026-09-06使用者回報bug：「目前開啟商人仍能帶著亂跑」，
    // 修法見updateMovement()裡新增的modal開啟中禁止移動判斷；這裡另外處理「玩家離開
    // 範圍後視窗還開著」的收尾，兩者互為前提但各自獨立，因為離開範圍本身也可能是
    // 遊戲重新整理/斷線重連等情境，不是只有移動一種來源）。
    if (!merchant && nearbyMerchant) closeMerchantModal();
    if (!blessing && nearbyBlessing) closeBlessingModal();

    nearbyMerchant = merchant;
    el("midnight-merchant-prompt").hidden = !merchant;
    if (merchant) el("midnight-merchant-prompt-name").textContent = window.I18N.t("midnight_merchant_title");

    nearbyBlessing = blessing;
    el("midnight-blessing-prompt").hidden = !blessing;
    if (blessing) el("midnight-blessing-prompt-name").textContent = window.I18N.t("midnight_blessing_title");

    nearbyStrongEnemy = strongEnemy;
    if (strongEnemy) {
      rollAndAssignStrongEnemy(strongEnemy);
      maybeGrantStrongEnemyReward(strongEnemy);
    }
    recomputeActiveEncounter();
    renderStrongEnemyOverlay();

    nearbyRandomEvent = randomEvent;
    renderScarabOverlay();
  }

  // ---- 強敵籌碼：靠近後用event_rulebook.js既有「強敵決定表」（跟night_gm_flow.js完全
  // 相同的解析邏輯）決定敵人，直接生成一個status:"resolved"的fieldTrigger物件，天然
  // 重用既有戰鬥/攻擊排程（見規劃紀錄「強敵/scarab 戰鬥的 RTDB 狀態機」）。----
  function rollAndAssignStrongEnemy(pt) {
    if (strongEnemyRollAttempted[pt.id] || fieldTriggers[pt.id]) return;
    strongEnemyRollAttempted[pt.id] = true;
    var GmFlow = window.PriTestNightGmFlow;
    var chip = findEventChip("strong_enemy");
    var table = chip && chip.extraTables && chip.extraTables[0];
    if (!GmFlow || !table) return;
    var rolled = GmFlow.rollStrongEnemyTable(table);
    if (!rolled) return;
    var parsed = GmFlow.extractLevelAndNameTokens((rolled.entry && rolled.entry.ja) || "");
    var match = null;
    for (var i = 0; i < parsed.nameTokens.length && !match; i++) {
      match = GmFlow.resolveCombatEnemyMatch(parsed.nameTokens[i]);
    }
    if (!match) return; // 找不到就整體放棄，不硬湊（CLAUDE.md §19同精神，不捏造規則結果）
    var level = (parsed.level || 1) + (rolled.levelBonus || 0);
    var now = Date.now();
    GameStorage.rtTransaction(gameId, "cloud", "fieldTrigger/" + pt.id, function (cur) {
      if (cur !== null) return cur;
      return {
        status: "resolved",
        enemyFamilyId: match.familyId,
        enemyId: match.enemy.id,
        level: level,
        participants: {},
        resolvedAt: now,
      };
    }).then(function () {
      GameStorage.rtTransaction(gameId, "cloud", "fieldEnemyHp/" + pt.id, function (cur) {
        return cur === null ? enemyRealHpMax({ enemyFamilyId: match.familyId, enemyId: match.enemy.id, level: level }) : cur;
      });
    });
  }

  function handleStrongEnemyEnterClick() {
    if (!mySlot || isPaused() || !nearbyStrongEnemy) return;
    var trig = fieldTriggers[nearbyStrongEnemy.id];
    if (!trig || trig.status !== "resolved") return;
    GameStorage.rtSet(gameId, "cloud", "fieldTrigger/" + nearbyStrongEnemy.id + "/participants/" + mySlot, true);
  }

  // ============================================================================
  // 2026-09-06優化：第一天/第二天「夜之強敵」——縮圈完全結束（waitingForDay2/3 stage）
  // 後，任一玩家進入最終小圓即觸發，跟strong_enemy籌碼不同的是：(1) 不需要玩家手動按
  // 「進入戰鬥」，10秒系統倒數後直接自動抽選並開戰；(2) 敵人決定表是「夜の強敵決定表」
  // （fields_data_1.jsのa_goldenカードextraTables，依劇本編號查表），不是event_rulebook.js
  // 的一般強敵決定表；(3) participants一開始就是全部已佔用席位，不是個別玩家自己按
  // 「加入」——這是規則書「PC全員」必須一起面對的關卡戰，不是可選的field事件。
  // 敵人名稱→enemyFamilyId的解析（GmFlow.extractLevelAndNameTokens／resolveCombatEnemyMatch）
  // 沿用跟rollAndAssignStrongEnemy()完全相同的既有邏輯，不重新寫一套。
  // ============================================================================

  // a_golden卡片「1日目／2日目」分支裡，帶有「夜の強敵決定表」字樣那一行本身標注的固定
  // 等級（Day1固定Lv.10、Day2固定Lv.15，見fields_data_1.js原文）——直接從資料裡讀出來，
  // 不在這裡硬編碼寫死的數字，資料若未來修訂也會自動跟著變動。
  function nightBossFixedLevel(card, dayIndex) {
    var branch = card && card.branches && card.branches[dayIndex - 1];
    var found = null;
    (branch ? branch.floors : []).forEach(function (floor) {
      (floor.lines || []).forEach(function (line) {
        if (found !== null) return;
        var text = (line.text && line.text.ja) || "";
        if (!/夜の強敵決定表/.test(text)) return;
        var m = /Lv\.?\s*(\d+)/i.exec(text);
        if (m) found = parseInt(m[1], 10);
      });
    });
    return found;
  }

  function finalCircleBossDefeated(dayIndex) {
    var id = "finalCircleDay" + dayIndex;
    var trig = fieldTriggers[id];
    if (!trig || trig.status !== "resolved") return false;
    var hp = fieldEnemyHp[id];
    return hp !== undefined && hp <= 0;
  }

  // 縮圈後判斷「哪些席位當下實際在最終小圓內」（2026-09-06三次優化，使用者明確規格「縮圈
  // 完後，仍在卡牌樓層探索的不受進入夜之強敵影響，直到該名也正式進入夜之強敵戰鬥」）：
  // 抽出跟updateFinalCircleBoss()原本「anyoneInside」判斷同一套距離計算，差別是這裡要留下
  // 「哪些人」而不只是「有沒有人」，給rollAndAssignFinalCircleBoss()決定participants用。
  // 還在別的樓層探索、沒進最終小圓的玩家不會被列入，維持自由探索；他們之後若自己走進最終
  // 小圓，一樣要走recomputeActiveEncounter()既有的「非participant→進入戰鬥確認」流程。
  function slotsInsideFinalCircle(phaseInfo) {
    var result = [];
    occupiedSlots().forEach(function (slot) {
      var tokenId = players[slot] && players[slot].tokenId;
      if (!tokenId) return;
      var pos = tokenId === myTokenId ? localPos : remoteTokens[tokenId];
      if (pos && Math.hypot(pos.x - phaseInfo.finalCenter.x, pos.y - phaseInfo.finalCenter.y) <= phaseInfo.finalRadius) {
        result.push(slot);
      }
    });
    return result;
  }

  // 依查表結果實際指派敵人，跟rollAndAssignStrongEnemy()同一套transaction() first-writer-wins
  // 保護，避免多裝置同時偵測到「10秒到了」而重複抽選。查不到（例如選了沒有規則書編號的
  // 自訂劇本）就整體放棄，不硬湊（CLAUDE.md §19精神）——保留waitingForDayN stage，交由
  // GM手動處理。
  // 已知簡化（尚未實作）：規則書extraNotes記載「劇本8、9」的2日目夜之強敵由1日目擲骰值
  // 直接連動決定（不再重擲，見GmFlow.rollNightBossEntry()的forcedRoll參數／
  // night_gm_flow.js的NIGHT_BOSS_LINKED_SCENARIOS），這裡day2固定重新擲一次1D，沒有
  // 套用連動規則——影響範圍僅限劇本8、9，其餘8個劇本行為正確。
  function rollAndAssignFinalCircleBoss(dayIndex, pointId, phaseInfo) {
    if (fieldTriggers[pointId]) return;
    var GmFlow = window.PriTestNightGmFlow;
    var Scenarios = window.PriTestScenarios;
    var Fields = window.PriTestFields;
    if (!GmFlow || !Scenarios || !Fields) return;
    var card = Fields.get(GOLDEN_TREE_CARD_ID);
    var scenarioId = resolveNightBossScenarioId();
    var scenarioNumber = scenarioId ? Scenarios.numberForId(scenarioId) : null;
    var row = card ? GmFlow.resolveNightBossTableRow(card, scenarioNumber) : null;
    var rolled = row ? GmFlow.rollNightBossEntry(row, dayIndex) : null;
    if (!rolled) return;
    var parsed = GmFlow.extractLevelAndNameTokens(rolled.ja || rolled.zh || "");
    var nameTokens = parsed.nameTokens.length ? parsed.nameTokens : [rolled.ja, rolled.zh].filter(Boolean);
    var match = null;
    for (var i = 0; i < nameTokens.length && !match; i++) {
      match = GmFlow.resolveCombatEnemyMatch(nameTokens[i]);
    }
    if (!match) return;
    var level = nightBossFixedLevel(card, dayIndex) || 1;
    // 只把「當下實際在最終小圓內」的席位列為participant（見slotsInsideFinalCircle()說明），
    // 不再無條件用occupiedSlots()（全體）——理論上觸發這個函式時at least一人已經在圈內
    // （見updateFinalCircleBoss()的anyoneInside判斷），這裡至少會有一筆。
    var participants = {};
    slotsInsideFinalCircle(phaseInfo).forEach(function (slot) {
      participants[slot] = true;
    });
    var now = Date.now();
    GameStorage.rtTransaction(gameId, "cloud", "fieldTrigger/" + pointId, function (cur) {
      if (cur !== null) return cur;
      return {
        status: "resolved",
        enemyFamilyId: match.familyId,
        enemyId: match.enemy.id,
        level: level,
        participants: participants,
        resolvedAt: now,
      };
    }).then(function () {
      GameStorage.rtTransaction(gameId, "cloud", "fieldEnemyHp/" + pointId, function (cur) {
        return cur === null ? enemyRealHpMax({ enemyFamilyId: match.familyId, enemyId: match.enemy.id, level: level }) : cur;
      });
    });
  }

  // 每幀呼叫：偵測目前是哪一天在等待夜之強敵、有沒有人已經進入最終小圓、10秒倒數是否
  // 已經跑完，並把結果反映到nearbyFinalCircleBoss（餵給recomputeActiveEncounter()的
  // candidate，跟其他field/strong_enemy/castle點同一套）。
  function updateFinalCircleBoss(now) {
    var phaseInfo = currentPhaseInfo(now);
    var dayIndex = phaseInfo.stage === "waitingForDay2" ? 1 : phaseInfo.stage === "waitingForDay3" ? 2 : null;
    if (!dayIndex || !phaseInfo.finalCenter) {
      nearbyFinalCircleBoss = null;
      return;
    }
    var pointId = "finalCircleDay" + dayIndex;
    var trig = fieldTriggers[pointId];
    // nearbyFinalCircleBoss只給有席位的真正玩家（跟其他updateNearby*()一致，觀戰者沒有
    // 角色，不該收到[進入戰鬥]之類的提示），但下面「偵測任一玩家是否在圈內」的倒數觸發
    // 邏輯不限定mySlot——任何裝置（含觀戰者）都能幫忙偵測、寫入共享倒數，多一台裝置
    // 偵測只是提高可靠度，transaction()本身已經防止重複寫入。
    if (mySlot && trig && trig.status === "resolved") {
      nearbyFinalCircleBoss = { id: pointId, x: phaseInfo.finalCenter.x, y: phaseInfo.finalCenter.y };
      return;
    }
    nearbyFinalCircleBoss = null;
    if (!meta) return;
    var anyoneInside = slotsInsideFinalCircle(phaseInfo).length > 0;
    var countdownKey = "finalCircleCountdownDay" + dayIndex + "At";
    if (anyoneInside && !meta[countdownKey]) {
      GameStorage.rtTransaction(gameId, "cloud", "meta/" + countdownKey, function (cur) {
        return cur === null ? Date.now() : cur;
      });
    }
    var startAt = meta[countdownKey];
    if (startAt && now - startAt >= FINAL_CIRCLE_BOSS_COUNTDOWN_MS && !finalCircleRollAttempted[pointId]) {
      finalCircleRollAttempted[pointId] = true;
      rollAndAssignFinalCircleBoss(dayIndex, pointId, phaseInfo);
    }
  }

  // ---- Day3「夜之王」戰鬥（2026-09-06三次優化，完整版）：套用房間設定選好的夜王
  // （meta.resolvedNightBossId，見§2「夜王」選單說明），第三天一開始（meta.day3StartAt，
  // 既有「全員按準備」流程觸發）就對全體在場玩家開啟，比照updateFinalCircleBoss()「沒有
  // 地圖點、全域判定」的既有先例，而非強敵籌碼的「靠近半徑」設計——固定id "day3Boss"，
  // 沿用跟一般強敵籌碼完全相同的fieldTrigger/fieldEnemyHp shape（見上方guardDataForTrig()/
  // bossHpMax()/pickAndResolveBossAction()），因此[進入戰鬥]確認流程／攻擊排程／反應
  // 窗口／命中判定全部原樣沿用，不需要另外實作一套。----
  var DAY3_BOSS_POINT_ID = "day3Boss";
  var nearbyDay3Boss = null;
  var day3BossRollAttempted = false;

  function day3BossDefeated() {
    var trig = fieldTriggers[DAY3_BOSS_POINT_ID];
    if (!trig || trig.status !== "resolved") return false;
    var hp = fieldEnemyHp[DAY3_BOSS_POINT_ID];
    return hp !== undefined && hp <= 0;
  }

  // 查不到meta.resolvedNightBossId對應的規則書資料（例如自訂劇本沒有夜王資料）就放棄，
  // 保留day3階段但沒有戰鬥可打，交由GM/玩家自行處理，不硬湊一個假夜王（CLAUDE.md §19）。
  function rollAndAssignDay3Boss() {
    if (!meta || !meta.day3StartAt || fieldTriggers[DAY3_BOSS_POINT_ID] || day3BossRollAttempted) return;
    var bossId = meta.resolvedNightBossId;
    if (!bossId || !bossRulebookData(bossId)) return;
    day3BossRollAttempted = true;
    var participants = {};
    occupiedSlots().forEach(function (slot) {
      participants[slot] = true;
    });
    GameStorage.rtTransaction(gameId, "cloud", "fieldTrigger/" + DAY3_BOSS_POINT_ID, function (cur) {
      if (cur !== null) return cur;
      return {
        status: "resolved",
        enemyFamilyId: BOSS_ENEMY_FAMILY_SENTINEL,
        enemyId: bossId,
        level: 16,
        bossForm: "fused",
        participants: participants,
        resolvedAt: Date.now(),
      };
    }).then(function () {
      GameStorage.rtTransaction(gameId, "cloud", "fieldEnemyHp/" + DAY3_BOSS_POINT_ID, function (cur) {
        return cur === null ? bossHpMax(bossId) : cur;
      });
    });
  }

  // harmonia／stragedes／nameless「形態変化」：跟gladius的「合體/分裂」是完全不同的機制
  // （見night_boss_rulebook.js對應specials原文）——這3隻是「第一形態HP歸零時不結束戰鬥，
  // 下個時機點全回復HP/Guard、清空屬性異常蓄積、切換成第二形態的動作表，第二形態HP歸零
  // 才是真正擊敗」。gladius的合體/分裂則是動作觸發、不重灌HP（見maybeStartEnemyAttack()
  // 的formFlip分支），兩者不能共用同一個判斷式。
  var BOSS_HP_RESET_ON_FORM_SWAP = { harmonia: true, stragedes: true, nameless: true };
  var day3FormResetAttempted = false;

  function maybeResetBossFormOnDefeat(trig, hp) {
    if (!trig || !BOSS_HP_RESET_ON_FORM_SWAP[trig.enemyId]) return;
    if (trig.bossForm === "split") return; // 已經在第二形態，HP歸零＝真的擊敗，交由既有day3BossDefeated()判斷
    if (hp === undefined || hp > 0) return;
    if (day3FormResetAttempted) return;
    day3FormResetAttempted = true;
    GameStorage.rtTransaction(gameId, "cloud", "fieldTrigger/" + DAY3_BOSS_POINT_ID, function (cur) {
      if (!cur || cur.bossForm === "split") return cur;
      var out = {};
      for (var k in cur) out[k] = cur[k];
      out.bossForm = "split";
      out.guardUnits = 0;
      out.guardBrokenAt = null;
      out.everGuardBroken = false;
      out.damageBySlot = null;
      return out;
    }).then(function () {
      GameStorage.rtSet(gameId, "cloud", "fieldEnemyHp/" + DAY3_BOSS_POINT_ID, bossHpMax(trig.enemyId));
      GameStorage.rtSet(gameId, "cloud", "attributeAccum/" + DAY3_BOSS_POINT_ID, null);
      day3FormResetAttempted = false;
    });
  }

  // 每幀呼叫：偵測第三天是否已開始、指派夜王、餵給recomputeActiveEncounter()的
  // candidate（跟其他nearby*()一致，只給有席位的真正玩家），並檢查是否觸發harmonia類
  // 形態轉換。沒有地圖點座標概念，x/y給0（day3期間地圖本來就自動收合，不會被畫出來）。
  function updateDay3Boss() {
    if (!meta || !meta.day3StartAt) {
      nearbyDay3Boss = null;
      return;
    }
    rollAndAssignDay3Boss();
    var trig = fieldTriggers[DAY3_BOSS_POINT_ID];
    var hp = fieldEnemyHp[DAY3_BOSS_POINT_ID];
    var alive = !!(trig && trig.status === "resolved" && (hp === undefined || hp > 0));
    nearbyDay3Boss = mySlot && alive ? { id: DAY3_BOSS_POINT_ID, x: 0, y: 0 } : null;
    if (trig) maybeResetBossFormOnDefeat(trig, hp);
  }

  // 上方資訊欄的系統倒數提示（「系統自動倒數讀條10s」，使用者明確規格），跟
  // #midnight-enter-battle-prompt是各自獨立的提示（這裡沒有按鈕，純粹顯示倒數，玩家
  // 不需要也不能操作）。
  function renderFinalCircleCountdown(now) {
    var wrap = el("midnight-final-circle-countdown");
    if (!wrap || !meta) return;
    var phaseInfo = currentPhaseInfo(now);
    var dayIndex = phaseInfo.stage === "waitingForDay2" ? 1 : phaseInfo.stage === "waitingForDay3" ? 2 : null;
    var pointId = dayIndex ? "finalCircleDay" + dayIndex : null;
    var trig = pointId ? fieldTriggers[pointId] : null;
    var startAt = dayIndex ? meta["finalCircleCountdownDay" + dayIndex + "At"] : null;
    var show = !!(startAt && (!trig || trig.status !== "resolved"));
    wrap.hidden = !show;
    if (!show) return;
    var remain = Math.max(0, Math.ceil((startAt + FINAL_CIRCLE_BOSS_COUNTDOWN_MS - now) / 1000));
    wrap.textContent = window.I18N.t("midnight_final_circle_boss_countdown_note", { seconds: remain });
  }

  // ---- 擊退第一天夜之強敵後20秒自動開啟第二天（使用者明確規格「擊退敵人後系統讀條20s
  // 後自行開啟第二天」）；第二天夜之強敵擊退後不自動進day3，改成下方的「準備」機制
  // （使用者明確規格「沒有設時間限制，所有人都按下準備後才開始夜王戰鬥」）。跟原本
  // 手動的[進入第二天/第三天]按鈕（handleAdvanceToDay2/3）功能重疊、且會讓玩家能跳過
  // 強制的夜之強敵戰鬥，因此拿掉那兩顆按鈕，日期推進全部改由這裡跟
  // maybeTriggerDay3FromReady()自動驅動。----
  function updateAutoDayAdvance(now) {
    if (!meta) return;
    if (!meta.day2StartAt) {
      if (finalCircleBossDefeated(1) && !meta.finalCircleDay1DefeatedAt) {
        GameStorage.rtTransaction(gameId, "cloud", "meta/finalCircleDay1DefeatedAt", function (cur) {
          return cur === null ? Date.now() : cur;
        });
      }
      if (
        meta.finalCircleDay1DefeatedAt &&
        now - meta.finalCircleDay1DefeatedAt >= FINAL_CIRCLE_BOSS_DAY_ADVANCE_MS &&
        !finalCircleDayAdvanceAttempted[2]
      ) {
        finalCircleDayAdvanceAttempted[2] = true;
        GameStorage.rtTransaction(gameId, "cloud", "meta/day2StartAt", function (cur) {
          return cur === null ? Date.now() : cur;
        });
        GameStorage.rtSet(gameId, "cloud", "meta/pause", null);
      }
    }
    var phaseInfo = currentPhaseInfo(now);
    if (phaseInfo.day !== lastAutoDayForCooldownReset) {
      lastAutoDayForCooldownReset = phaseInfo.day;
      resetAbilityCooldowns();
    }
  }

  // 上方資訊欄「使用祝福」：2026-09-06三次優化，使用者明確規格把原本「day>=2就能用」改成
  // 兩個各自獨立的時間點——第一天夜之強敵擊退後（Day1區塊）／第二天夜之強敵擊退後（Day2
  // 區塊），兩顆按鈕（btn-midnight-hud-blessing-day1／btn-midnight-hud-blessing）共用同一個
  // handler，判斷條件統一改成「第一天夜之強敵已擊退」（finalCircleBossDefeated(1)後永遠為
  // true，天然涵蓋Day1區塊開放的當下、以及之後的Day2/Day3），可用與否交給呼叫端的HUD顯示
  // 條件（renderFinalCircleRewardsHud()）決定要不要顯示按鈕，這裡只把關「真的不該用」的
  // 情況（還沒擊退第一天強敵、暫停中、沒有席位）。效果沿用既有applyBlessingRestore()
  // （HP/FP/體力/聖杯瓶全滿）＋開放一次升級額度，跟地圖籌碼版本完全相同的規則效果，只是
  // 入口換成HUD按鈕、不寫blessingClaimed記錄（沒有對應的籌碼id可以記）。
  function handleHudBlessingUseClick() {
    if (!mySlot || isPaused() || !finalCircleBossDefeated(1)) return;
    applyBlessingRestore();
    blessingLevelUpAvailable = true;
    renderCharacterSheet();
    var c = characters[myTokenId];
    if (c) renderCharacterSheetLevelRow(c, window.PriTestCharacterDrawer);
    showToast(window.I18N.t("midnight_blessing_claim_note"));
  }

  // Day1／Day2夜之強敵戰後HUD區塊的本地端「離去」旗標（2026-09-06三次優化，使用者明確
  // 規格：「還有最後一按鈕[離去]，則完全關閉兩者，該玩家開始第二天的探索」／「第二天...
  // 能選的有祝福商人與離去」）：純本地端UI狀態，不寫RTDB——每個玩家各自決定何時關閉自己
  // 看到的提示、繼續探索，不影響其他玩家或全域的day2StartAt/day3StartAt時間軸。
  var day1RewardsDismissed = false;
  var day2RewardsDismissed = false;
  function handleDay1RewardsLeaveClick() {
    day1RewardsDismissed = true;
    renderFinalCircleRewardsHud(Date.now());
  }
  function handleDay2RewardsLeaveClick() {
    day2RewardsDismissed = true;
    renderFinalCircleRewardsHud(Date.now());
  }

  // 上方資訊欄「準備開始夜王戰鬥」：第二天夜之強敵擊退後才會顯示（使用者明確規格「第二天
  // 結束夜之強敵後，出現祝福與商人，都能循環使用，沒有設時間限制，所有人都按下準備後才
  // 開始夜王戰鬥」）。跟大廳準備（players/{slot}.ready）是各自獨立的欄位——大廳準備決定
  // 「開局」，這裡的準備決定「進入day3」，語意不同，用獨立的readyFinalBoss/{slot}路徑。
  function handleReadyFinalBossToggle() {
    if (!mySlot || isPaused() || !finalCircleBossDefeated(2)) return;
    GameStorage.rtSet(gameId, "cloud", "readyFinalBoss/" + mySlot, !readyFinalBoss[mySlot]);
  }

  function onReadyFinalBossReceived(value) {
    readyFinalBoss = value || {};
  }

  // 全部已佔用席位都準備後，任一裝置transaction()寫入day3StartAt（跟maybeTriggerSessionStart
  // 同一套first-writer-wins模式）。
  var day3TriggerAttempted = false;
  function maybeTriggerDay3FromReady() {
    if (!meta || meta.day3StartAt || !meta.day2StartAt || !finalCircleBossDefeated(2)) return;
    var slots = occupiedSlots();
    if (!slots.length || !slots.every(function (slot) { return !!readyFinalBoss[slot]; })) return;
    if (day3TriggerAttempted) return;
    day3TriggerAttempted = true;
    GameStorage.rtTransaction(gameId, "cloud", "meta/day3StartAt", function (cur) {
      return cur === null ? Date.now() : cur;
    });
    GameStorage.rtSet(gameId, "cloud", "meta/pause", null);
  }

  // 上方資訊欄的祝福/商人/離去/準備區塊render（2026-09-06三次優化，使用者明確規格拆成
  // Day1／Day2兩個各自獨立的時間點）：
  //   - Day1區塊（祝福＋離去，沒有商人）：第一天夜之強敵擊退後開放，直到本地端按下離去
  //     （day1RewardsDismissed）為止，見handleDay1RewardsLeaveClick()。
  //   - Day2區塊（祝福＋商人＋離去，沒有總計時，一擊退就立刻開放）：第二天夜之強敵擊退後
  //     開放，直到本地端按下離去（day2RewardsDismissed）為止；離去只關閉這個區塊本身，
  //     不影響下面「準備開始夜王戰鬥」列——後者是獨立的party-wide gate，不該被擋住。
  function renderFinalCircleRewardsHud(now) {
    var phaseInfo = currentPhaseInfo(now);
    var day1Wrap = el("midnight-hud-day1-rewards-row");
    // Day1區塊只在「第一天已擊退、第二天強敵尚未也擊退」的窗口顯示，避免玩家進度較快時
    // Day1／Day2兩組區塊同時疊在畫面上。
    var day1Available = finalCircleBossDefeated(1) && !finalCircleBossDefeated(2) && !day1RewardsDismissed;
    if (day1Wrap) day1Wrap.hidden = !day1Available;

    var blessingBtn = el("btn-midnight-hud-blessing");
    var merchantWrap = el("midnight-hud-merchant-row");
    // day3（夜之王戰鬥）開始後，Day2祝福/商人/離去／準備都不再需要顯示——
    // finalCircleBossDefeated(2)本身一旦為true就不會再變回false，需要額外用
    // phaseInfo.day < 3擋住day3開始後的畫面。
    var day2Available = finalCircleBossDefeated(2) && phaseInfo.day < 3 && !day2RewardsDismissed;
    if (blessingBtn) blessingBtn.hidden = !day2Available;
    if (merchantWrap) merchantWrap.hidden = !day2Available;
    var readyWrap = el("midnight-hud-ready-final-row");
    var merchantAvailable = finalCircleBossDefeated(2) && phaseInfo.day < 3;
    if (readyWrap) readyWrap.hidden = !merchantAvailable;
    if (merchantAvailable) {
      var slots = occupiedSlots();
      var readyCount = slots.filter(function (slot) { return !!readyFinalBoss[slot]; }).length;
      var readyBtn = el("btn-midnight-ready-final-boss");
      if (readyBtn) {
        readyBtn.textContent = window.I18N.t(
          mySlot && readyFinalBoss[mySlot] ? "midnight_ready_final_boss_unready_button" : "midnight_ready_final_boss_ready_button"
        );
      }
      var readyNote = el("midnight-ready-final-note");
      if (readyNote) readyNote.textContent = window.I18N.t("midnight_ready_final_boss_count_note", { ready: readyCount, total: slots.length });
    }
  }

  // ---- 祝福籌碼：2026-09-06改版，比照商人籌碼的「進入→0.5秒讀取條→疊一層視窗」
  // 流程（見handleMerchantEnterClick()），視窗內才是真正的「使用祝福」按鈕
  // （handleBlessingUseClick()）。改版重點（使用者明確要求）：
  //   1. 不再用transaction()做first-writer-wins排他鎖——祝福可以無限次重複使用，
  //      不會因為曾經有人用過就打X、也不會擋住其他人（或同一人）之後再用。
  //   2. 使用後才能升級一次（見blessingLevelUpAvailable／handleMidnightLevelDelta()），
  //      不再是角色面板隨時可以自由升級。
  // blessingClaimed仍然寫入RTDB，純粹當作使用記錄留存，不參與任何門檻判斷。----
  function handleBlessingEnterClick() {
    // 見handleTowerEnterClick()同一則2026-09-06三次優化註解：戰鬥中不能開啟祝福籌碼。
    if (!mySlot || isPaused() || activeEncounter || !nearbyBlessing || blessingEnterTimer) return;
    startEnterLoading("midnight-blessing-loading-bar", "midnight-blessing-loading-fill");
    el("btn-midnight-blessing-claim").disabled = true;
    blessingEnterTimer = setTimeout(function () {
      blessingEnterTimer = null;
      stopEnterLoading("midnight-blessing-loading-bar", "midnight-blessing-loading-fill");
      el("btn-midnight-blessing-claim").disabled = false;
      if (nearbyBlessing) openBlessingModal();
    }, FIELD_ENTER_WAIT_MS);
  }

  function openBlessingModal() {
    if (!nearbyBlessing) return;
    el("midnight-blessing-result").textContent = "";
    el("midnight-blessing-modal").hidden = false;
    // 2026-09-06使用者明確要求「領取祝福後再跳出角色目前的等級與盧恩，可以去做+號升級」：
    // #midnight-character-sheet-level-row已經從#midnight-character-sheet-modal搬到這個
    // 視窗裡（見midnight_page.py說明），但renderCharacterSheet()本身會在
    // #midnight-character-sheet-modal是hidden時直接return（角色面板沒開的情況很常見，
    // 例如玩家人正站在祝福籌碼旁邊，不是特地開角色面板），因此這裡要直接呼叫
    // renderCharacterSheetLevelRow()，不能依賴renderCharacterSheet()順便更新到。
    var c = characters[myTokenId];
    if (c) renderCharacterSheetLevelRow(c, window.PriTestCharacterDrawer);
  }

  function closeBlessingModal() {
    el("midnight-blessing-modal").hidden = true;
    if (blessingEnterTimer) {
      clearTimeout(blessingEnterTimer);
      blessingEnterTimer = null;
    }
    stopEnterLoading("midnight-blessing-loading-bar", "midnight-blessing-loading-fill");
    el("btn-midnight-blessing-claim").disabled = false;
    // 2026-09-06使用者再次明確要求「每次靠近祝福都要重新按使用才能升級」：視窗一關閉
    // （不論是玩家自己按關閉，還是走出範圍時被updateNearbyChipPoint()自動關閉，見上方
    // 「!blessing && nearbyBlessing」那段），這次祝福給的升級額度就一併作廢，下次再開
    // 這個視窗（即使還是同一個祝福籌碼）都要重新點「使用祝福」才能繼續升級。
    blessingLevelUpAvailable = false;
  }

  // 視窗內「使用祝福」：docs/scenario_flow_rules.md §9「祝福チット」規則書原文寫的是
  // 「PC全員」的HP/FP/加護/聖杯瓶/夜渡りスキル回復，但這裡是使用者自己走到籌碼旁邊
  // 觸發的動作，而stamina/fp本來就是本地端不同步資源（見檔案開頭常數區塊註解），無法
  // 從這裡的client直接改到其他玩家自己畫面上的本地變數，因此套用範圍是「使用者自己」
  // 的HP／FP／體力／聖杯瓶全部回滿，不是整隊。可以重複點擊（不像商人購買有次數/資源
  // 限制），每次都會重新回滿並重新給一次升級額度。
  function handleBlessingUseClick() {
    if (!mySlot || isPaused() || !nearbyBlessing) return;
    applyBlessingRestore();
    blessingLevelUpAvailable = true;
    renderCharacterSheet();
    // 同openBlessingModal()的說明：這個視窗裡的等級/盧恩/+號升級不能只靠
    // renderCharacterSheet()順便更新，見上方註解。
    var c = characters[myTokenId];
    if (c) renderCharacterSheetLevelRow(c, window.PriTestCharacterDrawer);
    GameStorage.rtSet(gameId, "cloud", "blessingClaimed/" + nearbyBlessing.id + "/" + myTokenId, Date.now());
    el("midnight-blessing-result").textContent = window.I18N.t("midnight_blessing_claim_note");
    showToast(window.I18N.t("midnight_blessing_claim_note"));
  }

  // HP（demoStat，見selfArenaHpMax()）／FP／體力（皆本地端資源）／聖杯瓶使用回數，全部回滿。
  function applyBlessingRestore() {
    stamina.current = stamina.max;
    fp.current = fp.max;
    GameStorage.rtSet(gameId, "cloud", "demoStat/" + myTokenId, mySelfHpMaxFallback());
    var c = characters[myTokenId];
    if (c) {
      GameStorage.rtSet(gameId, "cloud", "character/" + myTokenId + "/flaskCount", c.flaskMax || FLASK_MAX_DEFAULT);
    }
    renderCharPanel();
  }

  // ---- 丟棄物撿取（2026-09-05角色面板優化新增）：跟updateNearbyTower()同款proximity
  // pattern，半徑沿用TOWER_ACTIVATE_RADIUS同量級的GROUND_ITEM_PICKUP_RADIUS。----
  // 掉落物簡易資訊的名稱文字（2026-09-06使用者明確要求「靠近掉落物時顯示簡易資訊」，
  // 原本只有一顆孤零零的撿取按鈕，沒有顯示是什麼東西）：依kind分別查武器/裝飾品/消耗品
  // 三份既有規則資料的localizedText(name)，跟renderCharacterSheet()查詢同一批物品名稱
  // 用的是同一套既有API，不重新發明。
  function groundItemDisplayName(data) {
    if (!data) return "";
    if (data.kind === "weapon") {
      var w = window.PriTestWeapons.get(baseCatalogId(data.itemId));
      return w ? window.PriTestWeapons.localizedText(w.name) : data.itemId;
    }
    if (data.kind === "talisman") {
      var t = window.PriTestTalismans.get(data.itemId);
      return t ? window.PriTestTalismans.localizedText(t.name) : data.itemId;
    }
    if (data.kind === "consumable") {
      var item = window.PriTestConsumables.get(data.itemId);
      return item ? window.PriTestConsumables.localizedText(item.name) : data.itemId;
    }
    return data.itemId || "";
  }

  function updateNearbyGroundItem() {
    if (!mySlot || !localPos || autoFly) {
      nearbyGroundItem = null;
      el("midnight-ground-item-prompt").hidden = true;
      return;
    }
    var found = null;
    Object.keys(groundItems).forEach(function (id) {
      if (found) return;
      var item = groundItems[id];
      if (item.pickedUpBy) return;
      var dist = Math.hypot(localPos.x - item.x, localPos.y - item.y);
      if (dist <= GROUND_ITEM_PICKUP_RADIUS) found = { id: id, data: item };
    });
    nearbyGroundItem = found;
    el("midnight-ground-item-prompt").hidden = !found;
    if (found) el("midnight-ground-item-name").textContent = groundItemDisplayName(found.data);
  }

  // 撿取也受6/4/2上限限制（使用者確認的硬上限規格）：滿了要先在角色面板丟棄才能撿。
  // 用transaction()寫groundItems/{id}/pickedUpBy當first-writer-wins仲裁，避免兩人同時
  // 撿到同一個掉落物——跟towerSolved／blessingClaimed同一套手法（寫入標記而不是直接
  // 刪除節點，因為這個repo既有的rtTransaction()用法都是「寫值」不是「刪節點」，維持
  // 一致的既有pattern）。撿走後的掉落物在渲染/proximity判斷都視為不存在（見
  // updateNearbyGroundItem()的pickedUpBy檢查／drawGroundItemMarker()呼叫端過濾）。
  function handlePickupGroundItem() {
    // 見handleTowerEnterClick()同一則2026-09-06三次優化註解：戰鬥中不能撿取掉落物。
    if (!mySlot || isPaused() || activeEncounter || !nearbyGroundItem) return;
    var c = characters[myTokenId];
    if (!c) return;
    var kind = nearbyGroundItem.data.kind;
    if (!hasInventorySpace(c, kind)) {
      showToast(window.I18N.t("midnight_inventory_full_note"));
      return;
    }
    var id = nearbyGroundItem.id;
    var data = nearbyGroundItem.data;
    GameStorage.rtTransaction(gameId, "cloud", "groundItems/" + id + "/pickedUpBy", function (cur) {
      return cur ? cur : myTokenId;
    }).then(function (committed) {
      if (committed !== myTokenId) return; // 被別人搶先撿走
      var c2 = characters[myTokenId];
      if (!c2) return;
      if (kind === "weapon") {
        c2.weaponIds = (c2.weaponIds || []).concat([data.itemId]);
        GameStorage.rtSet(gameId, "cloud", "character/" + myTokenId + "/weaponIds", c2.weaponIds);
      } else if (kind === "talisman") {
        c2.talismanIds = (c2.talismanIds || []).concat([data.itemId]);
        GameStorage.rtSet(gameId, "cloud", "character/" + myTokenId + "/talismanIds", c2.talismanIds);
      } else if (kind === "consumable") {
        var pickedItem = window.PriTestConsumables.get(data.itemId);
        var pickedUses = data.usesRemaining || 1;
        // 石劍鑰匙／鍛造石（noStackLimit:true）：跟現有同itemId的instance合併疊加
        // usesRemaining，不佔用新的消耗品欄位（使用者明確規格「沒有堆疊限制」）；
        // 一般消耗品維持既有行為，每次撿取都是獨立的新instance（各自佔1格）。
        var existing =
          pickedItem && pickedItem.noStackLimit
            ? (c2.consumables || []).filter(function (inst) {
                return inst.itemId === data.itemId;
              })[0]
            : null;
        if (existing) {
          existing.usesRemaining += pickedUses;
          c2.consumables = c2.consumables.slice();
        } else {
          var instId = window.PriTestCharacterDrawer.makeConsumableInstanceId(data.itemId, c2);
          c2.consumables = (c2.consumables || []).concat([{ id: instId, itemId: data.itemId, usesRemaining: pickedUses }]);
        }
        GameStorage.rtSet(gameId, "cloud", "character/" + myTokenId + "/consumables", c2.consumables);
      }
    });
  }

  // 從enemy.special本文（例："〔弱点:炎＆猛毒＆腐敗＆凍傷〕公開情報（209頁）。"）擷取
  // 「弱点/弱點:」後面到下一個〕為止的內容——這段本來就是規則書標明「公開情報」的文字，
  // 不是自行發明數值（CLAUDE.md §19）。沒有這段文字（大多數敵人沒有明確弱點）就回傳""。
  function enemyWeaknessText(enemy) {
    var special = window.PriTestEnemies ? window.PriTestEnemies.localizedText(enemy.special) : "";
    var m = /弱[点點][:：]([^〕\]】]+)/.exec(special || "");
    return m ? m[1] : "";
  }

  function renderStrongEnemyOverlay() {
    var banner = el("midnight-strong-enemy-banner");
    var pt = nearbyStrongEnemy;
    var trig = pt && fieldTriggers[pt.id];
    if (!pt || !trig || !trig.enemyFamilyId) {
      banner.hidden = true;
      return;
    }
    banner.hidden = false;
    var data = window.PriTestEnemies ? window.PriTestEnemies.get(trig.enemyFamilyId, trig.enemyId) : null;
    var name = data ? window.PriTestEnemies.localizedText(data.enemy.name) : trig.enemyId;
    el("midnight-strong-enemy-name").textContent = window.I18N.t("midnight_strong_enemy_reveal_note", { name: name, level: trig.level });
    // 種類／體型／弱點（2026-09-06使用者明確要求「地圖上方顯示強敵資訊：種類 體型
    // 弱點(若有)」）：種類讀家系（family）名稱，體型讀enemy.size既有欄位（S/L/LL），
    // 弱點只在enemy.special本文有明確標示時才顯示，不硬湊。
    var detailEl = el("midnight-strong-enemy-detail");
    if (detailEl) {
      var parts = [];
      if (data) {
        parts.push(window.I18N.t("midnight_strong_enemy_kind_label", { kind: window.PriTestEnemies.localizedText(data.familyName) }));
        if (data.enemy.size) parts.push(window.I18N.t("midnight_strong_enemy_size_label", { size: data.enemy.size }));
        var weakness = enemyWeaknessText(data.enemy);
        if (weakness) parts.push(window.I18N.t("midnight_strong_enemy_weakness_label", { weakness: weakness }));
      }
      detailEl.textContent = parts.join("　");
    }
    var amParticipant = !!(trig.participants && trig.participants[mySlot]);
    // 2026-09-06使用者明確要求「進入戰鬥後不再上方資訊欄中顯示圖片(背景的畫面已經有
    // 敵人照片了)」：已經是這場戰鬥的participant時，#midnight-field-encounter那邊已經
    // 放大顯示同一張敵人照片（見renderFieldEncounterPanel()），這裡改成只隱藏圖片本身
    // （名稱/種類/體型/弱點文字繼續保留在這個上方資訊欄）。
    var imageEl = el("midnight-strong-enemy-image");
    imageEl.hidden = amParticipant;
    if (data && !amParticipant) {
      imageEl.src = window.PriTestEnemies.imagePath(data.enemy, "../static/");
      imageEl.alt = name;
    }
    var hp = fieldEnemyHp[pt.id];
    var alive = hp === undefined || hp > 0;
    el("btn-midnight-strong-enemy-enter").hidden = amParticipant || !alive;
  }

  // 擊殺偵測與獎勵：first-writer-wins transaction保證只有一台裝置實際push獎勵，
  // 但push對象是participants內「所有」玩家（不是只有贏得transaction的那個人）。
  function maybeGrantStrongEnemyReward(pt) {
    if (strongEnemyRewardAttempted[pt.id]) return;
    var trig = fieldTriggers[pt.id];
    if (!trig || trig.status !== "resolved" || !trig.enemyFamilyId) return;
    var hp = fieldEnemyHp[pt.id];
    if (hp === undefined || hp > 0) return;
    strongEnemyRewardAttempted[pt.id] = true;
    GameStorage.rtTransaction(gameId, "cloud", "fieldTrigger/" + pt.id + "/rewardGrantedBy", function (cur) {
      return cur === null ? myTokenId : cur;
    }).then(function (committed) {
      if (committed !== myTokenId) return;
      Object.keys(trig.participants || {}).forEach(function (slot) {
        var p = players[slot];
        if (!p) return;
        pushPendingReward(p.tokenId, { kind: "rune", value: STRONG_ENEMY_REWARD_RUNES });
        pushPendingReward(p.tokenId, { kind: "potentialPower", value: STRONG_ENEMY_REWARD_POTENTIAL_STARS });
      });
    });
  }

  function pushPendingReward(tokenId, entry) {
    var rewardId = "rw" + Date.now() + Math.floor(Math.random() * 100000);
    entry.resolved = false;
    GameStorage.rtSet(gameId, "cloud", "pendingRewards/" + tokenId + "/" + rewardId, entry);
  }

  // ---- 商人籌碼：純本地modal，比照tower puzzle的模式。武器/消耗品購買都直接複用
  // CharacterDrawer既有helper，操作角色屬性管理章節的characters[myTokenId]物件。
  // 消耗品固定清單沿用night.js的MERCHANT_CONSUMABLE_IDS同一批id（night.js本身太重、
  // 依賴自己頁面的DOM/state，不適合整個載入這個技術驗證片，因此在這裡另存一份同樣的
  // id清單，只複製5個id字串，不重抄任何規則邏輯，見規劃紀錄）。----
  var MERCHANT_CONSUMABLE_IDS = [
    "item_warming_stone",
    "item_turtle_neck_pickle",
    "item_throwing_pot",
    "item_shard_of_starlight",
    "item_throwing_dagger",
  ];

  // 鍛造台（稀有度強化）費用：docs/scenario_flow_rules.md §9／event_rulebook.jsの
  // merchantチット原文只提到「鍛冶台も使わせてもらえそうだ」，148頁的實際費用沒有轉錄
  // 進這個repo，因此不是規則書確認的數字。暫時比照同一個商人籌碼裡唯一有確認數字的
  // 「裝備品購入：盧恩1」訂為同額佔位值（同ATTACK_BASE_DAMAGE等常數的既有慣例），
  // 之後有正式頁面數字時應直接取代這個常數。
  var MERCHANT_FORGE_COST_RUNES = 1;

  // 進入讀取條共用小工具（2026-09-06新增，見docs/scenario_flow_rules.md §9「進入」
  // 統一比照板塊卡牌既有的FIELD_ENTER_WAIT_MS=0.5秒讀取節奏，讓商人/祝福這類籌碼也有
  // 一樣的「按下進入→讀取條0.5秒→顯示內容」流程）。CSS動畫本身固定0.5秒（見style.css
  // 的.midnight-loading-fill-animate），這裡只負責重新播放（移除再加回class觸發reflow）
  // 與顯示/隱藏容器。
  function startEnterLoading(barId, fillId) {
    var fill = el(fillId);
    fill.classList.remove("midnight-loading-fill-animate");
    void fill.offsetWidth; // 強制reflow，讓下一行重新加回class時動畫會從頭播放
    fill.classList.add("midnight-loading-fill-animate");
    el(barId).hidden = false;
  }

  function stopEnterLoading(barId, fillId) {
    el(barId).hidden = true;
    el(fillId).classList.remove("midnight-loading-fill-animate");
  }

  // 商人「進入」：2026-09-06使用者要求商人/祝福比照板塊卡牌一樣，按下進入後有0.5秒
  // 讀取條，讀取完才顯示商人視窗（原本openMerchantModal()是按鈕直接呼叫，現在拆成
  // 「進入」與「開視窗」兩步）。
  function handleMerchantEnterClick() {
    // 見handleTowerEnterClick()同一則2026-09-06三次優化註解：戰鬥中不能開啟商人籌碼。
    if (!mySlot || isPaused() || activeEncounter || !nearbyMerchant || merchantEnterTimer) return;
    startEnterLoading("midnight-merchant-loading-bar", "midnight-merchant-loading-fill");
    el("btn-midnight-open-merchant").disabled = true;
    merchantEnterTimer = setTimeout(function () {
      merchantEnterTimer = null;
      stopEnterLoading("midnight-merchant-loading-bar", "midnight-merchant-loading-fill");
      el("btn-midnight-open-merchant").disabled = false;
      if (nearbyMerchant) openMerchantModal();
    }, FIELD_ENTER_WAIT_MS);
  }

  // 2026-09-06優化：第二天夜之強敵擊退後，商人也能直接從上方資訊欄開啟（使用者明確規格
  // 「出現祝福與商人，都能循環使用，沒有設時間限制」），不需要走到地圖上的商人籌碼——
  // 下面的render function本身不讀取nearbyMerchant的任何欄位，純粹只有這行guard，所以
  // 兩種入口可以直接共用同一個函式。
  function openMerchantModal() {
    if (!nearbyMerchant && !finalCircleBossDefeated(2)) return;
    el("midnight-merchant-weapon-result").textContent = "";
    el("midnight-merchant-consumable-result").textContent = "";
    el("midnight-merchant-forge-result").textContent = "";
    renderMerchantRuneNote();
    renderMerchantConsumableList();
    renderMerchantForgeList();
    el("midnight-merchant-modal").hidden = false;
  }

  // 2026-09-06使用者回報bug「開啟商人仍能帶著亂跑」：關閉時一併清掉還沒跑完的進入
  // 讀取條計時器／讀取條顯示／按鈕disabled狀態，避免玩家離開商人範圍時（見
  // updateNearbyChipPoint()）留下卡住的中間狀態；實際「開著視窗時禁止移動」的判斷則
  // 在updateMovement()裡另外處理。
  function closeMerchantModal() {
    el("midnight-merchant-modal").hidden = true;
    if (merchantEnterTimer) {
      clearTimeout(merchantEnterTimer);
      merchantEnterTimer = null;
    }
    stopEnterLoading("midnight-merchant-loading-bar", "midnight-merchant-loading-fill");
    el("btn-midnight-open-merchant").disabled = false;
  }

  function renderMerchantRuneNote() {
    var c = characters[myTokenId];
    el("midnight-merchant-rune-note").textContent = window.I18N.t("midnight_merchant_rune_note", { runes: c ? c.runes : 0 });
  }

  function renderMerchantConsumableList() {
    var container = el("midnight-merchant-consumable-list");
    container.innerHTML = "";
    var Consumables = window.PriTestConsumables;
    MERCHANT_CONSUMABLE_IDS.forEach(function (id) {
      var item = Consumables.get(id);
      if (!item) return;
      var btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = Consumables.localizedText(item.name);
      btn.addEventListener("click", function () {
        handleMerchantBuyConsumable(id);
      });
      container.appendChild(btn);
    });
  }

  function handleMerchantBuyWeapon() {
    var c = characters[myTokenId];
    if (!c || (c.runes || 0) < 1) return;
    if (!hasInventorySpace(c, "weapon")) {
      el("midnight-merchant-weapon-result").textContent = window.I18N.t("midnight_inventory_full_note");
      return;
    }
    var result = window.PriTestCharacterDrawer.merchantDrawWeapon(c, 1);
    if (!result) return;
    c.runes -= 1;
    GameStorage.rtSet(gameId, "cloud", "character/" + myTokenId, c);
    el("midnight-merchant-weapon-result").textContent = window.I18N.t("midnight_merchant_weapon_result", {
      name: window.PriTestWeapons.localizedText(result.item.name),
      rarity: result.rarity,
    });
    renderMerchantRuneNote();
  }

  function handleMerchantBuyConsumable(itemId) {
    var c = characters[myTokenId];
    if (!c || (c.runes || 0) < 1) return;
    var item = window.PriTestConsumables.get(itemId);
    if (!item) return;
    if (!hasInventorySpace(c, "consumable")) {
      el("midnight-merchant-consumable-result").textContent = window.I18N.t("midnight_inventory_full_note");
      return;
    }
    var instanceId = window.PriTestCharacterDrawer.makeConsumableInstanceId(itemId, c);
    c.consumables = c.consumables || [];
    c.consumables.push({ id: instanceId, itemId: itemId, usesRemaining: item.uses || 1 });
    c.runes -= 1;
    GameStorage.rtSet(gameId, "cloud", "character/" + myTokenId, c);
    el("midnight-merchant-consumable-result").textContent = window.I18N.t("midnight_merchant_consumable_result", {
      name: window.PriTestConsumables.localizedText(item.name),
    });
    renderMerchantRuneNote();
  }

  // ---- 鍛造台（稀有度強化，2026-09-05套用night.js既有板塊流程新增）：直接重用
  // character_drawer.js既有的upgradeWeaponRarity/canUpgradeWeaponRarity（C→U→R，早在
  // 該檔案裡就是專為「商人チットイベント『鍛造台』」準備的helper，先前只是一直沒有UI
  // 接上去），不是另外發明第二套稀有度規則。列出玩家自己持有的每把武器，可強化的顯示
  // 「強化」按鈕（消耗MERCHANT_FORGE_COST_RUNES），已達最高（R／L）則顯示已達上限的
  // 停用文字。----
  function renderMerchantForgeList() {
    var container = el("midnight-merchant-forge-list");
    container.innerHTML = "";
    var c = characters[myTokenId];
    // 使用者明確規格：「擁有鍛造石的人才能對商人鐵匠進行動作」。
    if (!characterHasConsumable(c, "item_smithing_stone")) {
      container.textContent = window.I18N.t("midnight_merchant_forge_need_stone_note");
      return;
    }
    var ids = (c && c.weaponIds) || [];
    if (!ids.length) {
      container.textContent = window.I18N.t("midnight_merchant_forge_empty_note");
      return;
    }
    var CD = window.PriTestCharacterDrawer;
    var Weapons = window.PriTestWeapons;
    ids.forEach(function (weaponId) {
      var weapon = Weapons.get(baseCatalogId(weaponId));
      if (!weapon) return;
      var rarity = CD.getEffectiveWeaponRarity(c, weaponId);
      var name = Weapons.localizedText(weapon.name);
      var btn = document.createElement("button");
      btn.type = "button";
      if (!CD.canUpgradeWeaponRarity(c, weaponId)) {
        btn.textContent = window.I18N.t("midnight_merchant_forge_max_note", { name: name, rarity: rarity });
        btn.disabled = true;
      } else {
        btn.textContent = window.I18N.t("midnight_merchant_forge_weapon_button", {
          name: name,
          rarity: rarity,
          cost: MERCHANT_FORGE_COST_RUNES,
        });
        btn.disabled = (c.runes || 0) < MERCHANT_FORGE_COST_RUNES;
        btn.addEventListener("click", function () {
          handleMerchantForgeWeapon(weaponId);
        });
      }
      container.appendChild(btn);
    });
  }

  function handleMerchantForgeWeapon(weaponId) {
    var c = characters[myTokenId];
    if (!c || (c.runes || 0) < MERCHANT_FORGE_COST_RUNES || !characterHasConsumable(c, "item_smithing_stone")) return;
    var CD = window.PriTestCharacterDrawer;
    if (!CD.upgradeWeaponRarity(c, weaponId)) return;
    c.runes -= MERCHANT_FORGE_COST_RUNES;
    GameStorage.rtSet(gameId, "cloud", "character/" + myTokenId, c);
    var weapon = window.PriTestWeapons.get(baseCatalogId(weaponId));
    el("midnight-merchant-forge-result").textContent = window.I18N.t("midnight_merchant_forge_result", {
      name: weapon ? window.PriTestWeapons.localizedText(weapon.name) : weaponId,
      rarity: CD.getEffectiveWeaponRarity(c, weaponId),
    });
    renderMerchantRuneNote();
    renderMerchantForgeList();
  }

  // ---- 隨機事件籌碼（聖甲蟲）：直接讀event_rulebook.js既有random_event chip中name.zh
  // 為「聖甲蟲」的分支敘述文字，判定機制依使用者要求簡化為「選精神/運氣/體能其中一項，
  // 用CharacterTypes既有checkValues決定要投幾顆d6，加總跟目標值13比較」。失敗不套用
  // 任何懲罰（night原文「FP損害：■」數值未定且midnight沒有FP資源，見規劃紀錄設計取捨）。----
  var SCARAB_CHECK_TARGET = 13;

  function findScarabBranch() {
    var chip = findEventChip("random_event");
    var branches = (chip && chip.branches) || [];
    for (var i = 0; i < branches.length; i++) {
      if (branches[i].name && branches[i].name.zh === "聖甲蟲") return branches[i];
    }
    return null;
  }

  function scarabDescriptionText() {
    var branch = findScarabBranch();
    var lines = (branch && branch.floors && branch.floors[0] && branch.floors[0].lines) || [];
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].label && lines[i].label.zh === "描寫") {
        return window.PriTestEventRulebook.localizedText(lines[i].text);
      }
    }
    return "";
  }

  function renderScarabOverlay() {
    var banner = el("midnight-scarab-banner");
    var pt = nearbyRandomEvent;
    if (!pt) {
      banner.hidden = true;
      return;
    }
    banner.hidden = false;
    el("midnight-scarab-text").textContent = scarabDescriptionText();
    var trig = fieldTriggers[pt.id];
    var attempted = !!(trig && trig.attempted && trig.attempted[mySlot]);
    el("midnight-scarab-stat-picker").hidden = attempted;
    if (scarabResult && scarabResult.pointId === pt.id) {
      el("midnight-scarab-result").textContent = scarabResult.text;
    } else if (attempted) {
      el("midnight-scarab-result").textContent = window.I18N.t("midnight_scarab_already_attempted_note");
    } else {
      el("midnight-scarab-result").textContent = "";
    }
  }

  function handleScarabCheckClick(statKey) {
    if (!mySlot || isPaused() || !nearbyRandomEvent) return;
    var pt = nearbyRandomEvent;
    var trig = fieldTriggers[pt.id];
    if (trig && trig.attempted && trig.attempted[mySlot]) return;
    GameStorage.rtSet(gameId, "cloud", "fieldTrigger/" + pt.id + "/attempted/" + mySlot, true);
    var c = characters[myTokenId];
    var type = c && c.typeId ? window.PriTestCharacterTypes.get(c.typeId) : null;
    var diceCount = type && type.checkValues ? type.checkValues[statKey] || 0 : 0;
    var dice = [];
    for (var i = 0; i < diceCount; i++) dice.push(1 + Math.floor(Math.random() * 6));
    var sum = dice.reduce(function (a, b) {
      return a + b;
    }, 0);
    var success = sum >= SCARAB_CHECK_TARGET;
    scarabResult = {
      pointId: pt.id,
      text: window.I18N.t(success ? "midnight_scarab_success_text" : "midnight_scarab_fail_text", {
        sum: sum,
        target: SCARAB_CHECK_TARGET,
      }),
    };
    if (success) pushPendingReward(myTokenId, { kind: "talisman" });
    renderScarabOverlay();
  }

  // ---- 板塊(卡牌)獎勵——開啟並執行：讀該floor.reward，用night_floor_breakthrough.js
  // 既有isLootRewardEntry()篩出戰利品entry（純函式，不依賴night.js的Core.state），
  // 逐筆授予後直接顯示toast，不像擊殺敵人獎勵需要另開分割視窗。----
  function grantLootRewardEntryToCharacter(c, entry) {
    var CD = window.PriTestCharacterDrawer;
    if (entry.kind === "rune") {
      c.runes = (c.runes || 0) + (entry.value || 0);
      return window.I18N.t("midnight_reward_label_rune", { value: entry.value || 0 });
    }
    if (entry.kind === "weaponStar") {
      if (!hasInventorySpace(c, "weapon")) return null; // 已滿：略過（同下方既有「不阻塞其餘品項」精神）
      var result = CD.merchantDrawWeapon(c, entry.value || 1);
      if (!result) return null;
      return window.PriTestWeapons.localizedText(result.item.name);
    }
    if (entry.kind === "consumable") {
      if (!hasInventorySpace(c, "consumable")) return null;
      var Consumables = window.PriTestConsumables;
      c.consumables = c.consumables || [];
      if (entry.itemId) {
        var namedItem = Consumables.get(entry.itemId);
        var instId = CD.makeConsumableInstanceId(entry.itemId, c);
        c.consumables.push({ id: instId, itemId: entry.itemId, usesRemaining: (namedItem && namedItem.uses) || 1 });
        return namedItem ? Consumables.localizedText(namedItem.name) : entry.itemId;
      }
      var pool = Consumables.list();
      if (!pool.length) return null;
      var picked = pool[Math.floor(Math.random() * pool.length)];
      var pickedInstId = CD.makeConsumableInstanceId(picked.id, c);
      c.consumables.push({ id: pickedInstId, itemId: picked.id, usesRemaining: picked.uses || 1 });
      return Consumables.localizedText(picked.name);
    }
    if (entry.kind === "talisman") {
      if (!hasInventorySpace(c, "talisman")) return null;
      var Talismans = window.PriTestTalismans;
      var talismanPool = Talismans.list();
      if (!talismanPool.length) return null;
      var pickedTalisman = talismanPool[Math.floor(Math.random() * talismanPool.length)];
      c.talismanIds = c.talismanIds || [];
      c.talismanIds.push(pickedTalisman.id);
      return Talismans.localizedText(pickedTalisman.name);
    }
    // 2026-09-06使用者明確要求「K（教會）過程中會取得聖杯瓶，讓聖杯瓶使用上限增加」：
    // fields_data_4.js card_k（教會）樓層1的reward本來就有{kind:"chaliceBonus", value:1}
    // 這筆（規則書原文「PC全員は「聖杯瓶の使用回数：+1」を獲得」），只是midnight角色物件
    // 原本沒有對應處理、被上面這段舊註解刻意略過。這裡補上：flaskMax/flaskCount各自
    // +value，等同拿到新的聖杯瓶充能同時直接補滿（跟遊戲裡「拿到聖杯瓶」的既有體感一致）。
    if (entry.kind === "chaliceBonus") {
      var bonus = entry.value || 0;
      c.flaskMax = (c.flaskMax || FLASK_MAX_DEFAULT) + bonus;
      c.flaskCount = (c.flaskCount || 0) + bonus;
      return window.I18N.t("midnight_reward_label_chalice_bonus", { value: bonus });
    }
    // 其餘loot kind（stoneswordKey／smithingStone／potentialPower／weaponSkillReroll）
    // midnight角色物件目前沒有對應欄位，本次milestone先略過，不阻塞其餘品項的授予
    // （不是bug，是已知範圍限制，見規劃紀錄）。
    return null;
  }

  function grantTileLootToParticipants(trig, lootEntries) {
    Object.keys(trig.participants || {}).forEach(function (slot) {
      var p = players[slot];
      if (!p) return;
      var c = characters[p.tokenId];
      if (!c) return;
      var labels = [];
      lootEntries.forEach(function (entry) {
        var label = grantLootRewardEntryToCharacter(c, entry);
        if (label) labels.push(label);
      });
      if (!labels.length) return;
      c._lastTileRewardNote = { text: window.I18N.t("midnight_reward_toast_prefix") + labels.join("、"), at: Date.now() };
      GameStorage.rtSet(gameId, "cloud", "character/" + p.tokenId, c);
    });
  }

  var fieldTileRewardAttempted = {}; // pointId -> true（本地節流：板塊獎勵只送一次transaction）

  function maybeGrantFieldTileReward(pt, trig, floor) {
    if (fieldTileRewardAttempted[pt.id]) return;
    fieldTileRewardAttempted[pt.id] = true;
    var FloorBreakthrough = window.PriTestNightFloorBreakthrough;
    var reward = (floor && floor.reward) || [];
    var lootEntries = FloorBreakthrough ? reward.filter(FloorBreakthrough.isLootRewardEntry) : [];
    if (!lootEntries.length) return;
    GameStorage.rtTransaction(gameId, "cloud", "fieldTrigger/" + pt.id + "/tileRewardGrantedBy", function (cur) {
      return cur === null ? myTokenId : cur;
    }).then(function (committed) {
      if (committed !== myTokenId) return;
      grantTileLootToParticipants(trig, lootEntries);
    });
  }

  function maybeGrantFieldTileRewardOnClear(pt) {
    var trig = fieldTriggers[pt.id];
    if (!trig || trig.status !== "resolved" || !trig.enemyFamilyId) return;
    var hp = fieldEnemyHp[pt.id];
    if (hp === undefined || hp > 0) return;
    var floor = fieldFloorForTrig(pt, trig);
    if (!floor) return;
    maybeGrantFieldTileReward(pt, trig, floor);
    maybeAdvanceFieldProgressAfterFloorClear(pt, trig);
  }

  // ---- 樓層探索進度推進（2026-09-05套用night.js既有板塊流程新增）----
  // night規則書§2-5「全フロア踏破確認」／§2-7「繰り返し」：一張卡有固定樓層數，逐層
  // 踏破，全部踏破後才發放「全フロア踏破効果」（ルーン獲得＋タイムロス）。這裡沿用
  // fieldTrigger既有的邀請→敘述→投票→遇敵pipeline處理「每一層」，這個函式只負責在
  // 一層的獎勵發放後，判斷「還有沒有下一層」並推進：
  //   - 還有下一層：把fieldTrigger/{pointId}整個清空（null），讓這個點可以重新觸發
  //     「進入」流程（沿用一模一樣的pipeline，只是這次maybeAdvanceFieldInvite會從
  //     fieldProgress讀到正確的branchIndex／下一個floorIndex，不會重新抽分歧或回到
  //     第0層）。這正是「中途離開再回來，從未踏破的樓層繼續」的機制：只要fieldProgress
  //     還在，不管什麼時候重新按「進入」都會接著上次的樓層走。
  //   - 沒有下一層了（已達floorCount）：標記cleared，發放「全踏破」盧恩獎勵（見
  //     maybeGrantFieldFullClearReward），維持fieldTrigger原樣（不清空）以便地圖圖示
  //     用既有isPointCleared()／fieldEnemyHp<=0判斷continue顯示✕記號。
  // advancedBy<N>guard欄位是跟maybeGrantStrongEnemyReward的rewardGrantedBy同一種
  // first-writer-wins寫法：多名參與者的裝置幾乎同時偵測到這一層結束時，只有transaction
  // 真正贏得該guard欄位的那一台裝置才會實際執行清空/發獎，其餘裝置的.then()會看到
  // committed !== myTokenId而直接放棄，不會重複執行。
  var fieldFloorAdvanceAttempted = {}; // pointId+":"+floorIndex -> true（本地節流，避免同一台裝置每影格重送同一層的transaction）

  function resetFieldPointLocalFlags(id) {
    delete fieldEnterAttempted[id];
    delete fieldInviteResolveAttempted[id];
    delete fieldTypewriterStartedFor[id];
    delete fieldTypewriterDoneFor[id];
    delete fieldVoteDeadlineSetAttempted[id];
    delete fieldVoteResolveAttempted[id];
    delete fieldEnemyAssignAttempted[id];
    delete fieldTileRewardAttempted[id];
    delete lastRenderedVoteKey[id];
  }

  function maybeAdvanceFieldProgressAfterFloorClear(pt, trig) {
    var floorIndex = trig.floorIndex || 0;
    var key = pt.id + ":" + floorIndex;
    if (fieldFloorAdvanceAttempted[key]) return;
    fieldFloorAdvanceAttempted[key] = true;
    var floorCount = fieldFloorCountForCard(pt.card);
    var nextFloorIndex = floorIndex + 1;
    var cleared = nextFloorIndex >= floorCount;
    GameStorage.rtTransaction(gameId, "cloud", "fieldProgress/" + pt.id + "/advancedBy" + floorIndex, function (cur) {
      return cur === null ? myTokenId : cur;
    }).then(function (committed) {
      if (committed !== myTokenId) return; // 搶輸了，這一層的推進已經由別的裝置負責
      GameStorage.rtSet(gameId, "cloud", "fieldProgress/" + pt.id + "/branchIndex", trig.branchIndex);
      GameStorage.rtSet(gameId, "cloud", "fieldProgress/" + pt.id + "/floorIndex", nextFloorIndex);
      GameStorage.rtSet(gameId, "cloud", "fieldProgress/" + pt.id + "/cleared", cleared);
      if (cleared) {
        maybeGrantFieldFullClearReward(pt, trig);
      } else {
        resetFieldPointLocalFlags(pt.id);
        GameStorage.rtSet(gameId, "cloud", "fieldTrigger/" + pt.id, null);
        GameStorage.rtSet(gameId, "cloud", "fieldEnemyHp/" + pt.id, null);
      }
    });
  }

  // 「全フロア踏破効果」の盧恩部分：card.allFloorEffect原文（例："盧恩：2／時間損耗：1"）
  // 跟night.js的parseAllFloorEffectAmount同款regex，純函式沒有night.js的state耦合，
  // 這裡另存一份而不是整個載入night.js（同MERCHANT_CONSUMABLE_IDS註解的既有慣例）。
  // 時間損耗（タイムロス）部分沒有對應資源——midnight用縮圈計時取代night的天數/時間
  // 損耗機制，這裡不套用，只套用盧恩部分（已知的範圍限制，不是算錯數字）。
  function parseAllFloorEffectRuneAmount(text) {
    var m = /(?:盧恩|ルーン)[：:]\s*([+＋]?\d+)/.exec(String(text || ""));
    return m ? parseInt(m[1].replace(/[＋+]/g, ""), 10) || 0 : 0;
  }

  function maybeGrantFieldFullClearReward(pt, trig) {
    var data = fieldCardData(pt.card);
    var effectText = data && data.allFloorEffect ? window.PriTestFields.localizedText(data.allFloorEffect) : "";
    var runeAmount = parseAllFloorEffectRuneAmount(effectText);
    if (!runeAmount) return;
    GameStorage.rtTransaction(gameId, "cloud", "fieldProgress/" + pt.id + "/fullClearRewardGrantedBy", function (cur) {
      return cur === null ? myTokenId : cur;
    }).then(function (committed) {
      if (committed !== myTokenId) return;
      Object.keys(trig.participants || {}).forEach(function (slot) {
        var p = players[slot];
        if (!p) return;
        pushPendingReward(p.tokenId, { kind: "rune", value: runeAmount });
      });
    });
  }

  // ---- 獎勵清單（擊殺敵人／聖甲蟲成功）：左右分割彈窗。rewardDraftById/
  // potentialPowerDraftById是本地only的抽選結果快取，避免每次RTDB更新重新渲染時
  // 重新抽一次（點進某個項目後結果應該固定，直到確認收下或關閉）。----
  var selectedRewardId = null;
  var rewardDraftById = {};
  var potentialPowerDraftById = {};
  var lastRewardIdsKey = "";
  var rewardModalDismissed = false;

  function rewardEntryLabel(entry) {
    if (entry.kind === "rune") return window.I18N.t("midnight_reward_kind_rune");
    if (entry.kind === "potentialPower") return window.I18N.t("midnight_reward_kind_potential_power");
    if (entry.kind === "talisman") return window.I18N.t("midnight_reward_kind_talisman");
    if (entry.kind === "weapon") return window.I18N.t("midnight_reward_kind_weapon");
    if (entry.kind === "consumable") return window.I18N.t("midnight_reward_kind_consumable");
    return entry.kind;
  }

  // 2026-09-06三次優化（使用者明確規格「例如武器獎勵：選擇後 按下抽選後 抽完該物品顯示
  // 其資訊...」）：weapon/talisman/consumable三種kind額外把抽到的原始item/weaponId也
  // 放進回傳物件（不只是label字串），供renderRewardDetail()呼叫既有renderWeaponSheetDetail()
  // /顯示消耗品裝飾品效果本文用；rune沒有「物品資訊」可顯示，維持原樣。
  function computeRewardDraw(entry) {
    if (entry.kind === "rune") {
      var value = entry.value || 0;
      return {
        label: window.I18N.t("midnight_reward_draw_rune", { value: value }),
        apply: function (c) {
          c.runes = (c.runes || 0) + value;
        },
      };
    }
    if (entry.kind === "talisman") {
      var Talismans = window.PriTestTalismans;
      var pool = Talismans.list();
      var pickedTalisman = pool[Math.floor(Math.random() * pool.length)];
      return {
        label: Talismans.localizedText(pickedTalisman.name),
        item: pickedTalisman,
        apply: function (c) {
          c.talismanIds = c.talismanIds || [];
          c.talismanIds.push(pickedTalisman.id);
        },
      };
    }
    if (entry.kind === "weapon") {
      var c0 = characters[myTokenId] || { weaponIds: [] };
      var result = window.PriTestCharacterDrawer.merchantDrawWeapon({ weaponIds: (c0.weaponIds || []).slice() }, entry.value || 1);
      if (!result) return { label: window.I18N.t("midnight_reward_draw_empty"), apply: function () {} };
      return {
        label: window.PriTestWeapons.localizedText(result.item.name),
        item: result.item,
        weaponId: result.weaponId,
        apply: function (c) {
          c.weaponIds = c.weaponIds || [];
          c.weaponIds.push(result.weaponId);
        },
      };
    }
    if (entry.kind === "consumable") {
      var Consumables = window.PriTestConsumables;
      var itemPool = Consumables.list();
      var pickedItem = itemPool[Math.floor(Math.random() * itemPool.length)];
      return {
        label: Consumables.localizedText(pickedItem.name),
        item: pickedItem,
        apply: function (c) {
          var instId = window.PriTestCharacterDrawer.makeConsumableInstanceId(pickedItem.id, c);
          c.consumables = c.consumables || [];
          c.consumables.push({ id: instId, itemId: pickedItem.id, usesRemaining: pickedItem.uses || 1 });
        },
      };
    }
    return { label: window.I18N.t("midnight_reward_draw_empty"), apply: function () {} };
  }

  function confirmRewardEntry(id, draft) {
    var c = characters[myTokenId];
    if (!c) return;
    draft.apply(c);
    GameStorage.rtSet(gameId, "cloud", "character/" + myTokenId, c);
    GameStorage.rtSet(gameId, "cloud", "pendingRewards/" + myTokenId + "/" + id + "/resolved", true);
    delete rewardDraftById[id];
    selectedRewardId = null;
  }

  // 「丟棄」（2026-09-06三次優化新增，使用者明確規格「下方有取得及丟棄」）：只標記這筆
  // 獎勵已處理，不呼叫draft.apply()套用效果——跟confirmRewardEntry()對照，少了套用這一步。
  function discardRewardEntry(id) {
    GameStorage.rtSet(gameId, "cloud", "pendingRewards/" + myTokenId + "/" + id + "/resolved", true);
    delete rewardDraftById[id];
    selectedRewardId = null;
  }

  // potentialPower（得意武器／附帶效果擇一，對應使用者追加需求）：兩邊各自抽選一次，
  // 選定其中一邊才真正commit——commitPotentialPowerWeapon／commitAttachedEffectChoice
  // 都是character_drawer.js既有純函式，直接對characters[myTokenId]操作。2026-09-06三次
  // 優化（使用者明確規格「抽選完一次後，按鈕不再可按下（非活性化）」）：拿掉原本「兩邊
  // 各自可重抽」的設計，抽過一次後對應按鈕disable，不能再重新抽。
  function renderPotentialPowerRewardDetail(id, entry, detail) {
    if (!potentialPowerDraftById[id]) potentialPowerDraftById[id] = { weapon: null, effect: null };
    var draft = potentialPowerDraftById[id];
    var CD = window.PriTestCharacterDrawer;

    var weaponSection = document.createElement("div");
    var weaponBtn = document.createElement("button");
    weaponBtn.type = "button";
    weaponBtn.textContent = window.I18N.t("midnight_reward_potential_draw_weapon_button");
    weaponBtn.disabled = !!draft.weapon;
    weaponBtn.addEventListener("click", function () {
      var c = characters[myTokenId];
      if (c) draft.weapon = CD.potentialPowerDrawWeapon(c, entry.value || 1);
      renderRewardDetail(id, entry);
    });
    weaponSection.appendChild(weaponBtn);
    if (draft.weapon && draft.weapon.item) {
      var weaponLabel = document.createElement("p");
      weaponLabel.textContent = window.PriTestWeapons.localizedText(draft.weapon.item.name);
      weaponSection.appendChild(weaponLabel);
      var chooseWeaponBtn = document.createElement("button");
      chooseWeaponBtn.type = "button";
      chooseWeaponBtn.textContent = window.I18N.t("midnight_reward_potential_choose_button");
      chooseWeaponBtn.addEventListener("click", function () {
        var c = characters[myTokenId];
        if (!c) return;
        CD.commitPotentialPowerWeapon(c, draft.weapon);
        GameStorage.rtSet(gameId, "cloud", "character/" + myTokenId, c);
        GameStorage.rtSet(gameId, "cloud", "pendingRewards/" + myTokenId + "/" + id + "/resolved", true);
        delete potentialPowerDraftById[id];
        selectedRewardId = null;
      });
      weaponSection.appendChild(chooseWeaponBtn);
    }
    detail.appendChild(weaponSection);

    var effectSection = document.createElement("div");
    var effectBtn = document.createElement("button");
    effectBtn.type = "button";
    effectBtn.textContent = window.I18N.t("midnight_reward_potential_draw_effect_button");
    effectBtn.disabled = !!draft.effect;
    effectBtn.addEventListener("click", function () {
      var c = characters[myTokenId];
      if (c) draft.effect = CD.rollPotentialPowerAttachedEffect(c);
      renderRewardDetail(id, entry);
    });
    effectSection.appendChild(effectBtn);
    var resolvedEffect = draft.effect && (draft.effect.effect || (draft.effect.candidates && draft.effect.candidates[0]));
    if (resolvedEffect) {
      var effectLabel = document.createElement("p");
      effectLabel.textContent =
        window.PriTestCharacterTypes.localizedText(resolvedEffect.name) +
        window.I18N.t("colon_separator") +
        window.PriTestCharacterTypes.localizedText(resolvedEffect.body || {});
      effectSection.appendChild(effectLabel);
      var chooseEffectBtn = document.createElement("button");
      chooseEffectBtn.type = "button";
      chooseEffectBtn.textContent = window.I18N.t("midnight_reward_potential_choose_button");
      chooseEffectBtn.addEventListener("click", function () {
        var c = characters[myTokenId];
        if (!c) return;
        CD.commitAttachedEffectChoice(c, resolvedEffect);
        GameStorage.rtSet(gameId, "cloud", "character/" + myTokenId, c);
        GameStorage.rtSet(gameId, "cloud", "pendingRewards/" + myTokenId + "/" + id + "/resolved", true);
        delete potentialPowerDraftById[id];
        selectedRewardId = null;
      });
      effectSection.appendChild(chooseEffectBtn);
    }
    detail.appendChild(effectSection);
  }

  // 2026-09-06三次優化（使用者明確規格「選擇後 按下抽選後 抽完該物品顯示其資訊...下方有
  // 取得及丟棄」／「抽選完一次後，按鈕不再可按下（非活性化）」）：weapon/consumable/
  // talisman三種kind改成兩段式——先顯示「抽選」按鈕（尚未有rewardDraftById[id]時），
  // 點擊後才真正抽選並鎖住按鈕；抽選完顯示完整資訊（武器沿用既有renderWeaponSheetDetail()
  // ，已內建稀有度色點/傷害估算/戰技；消耗品/裝飾品新增顯示效果本文），並排「取得」
  // （既有confirmRewardEntry）與新增的「丟棄」（discardRewardEntry，只標記已處理、不套用
  // 效果）兩個按鈕。rune沒有「抽選」的必要（結果本來就是固定的value），維持原本直接顯示。
  function renderRewardDetail(id, entry) {
    var detail = el("midnight-reward-detail");
    detail.innerHTML = "";
    if (entry.kind === "potentialPower") {
      renderPotentialPowerRewardDetail(id, entry, detail);
      return;
    }
    var needsDrawStep = entry.kind === "weapon" || entry.kind === "consumable" || entry.kind === "talisman";
    if (needsDrawStep && !rewardDraftById[id]) {
      var drawBtn = document.createElement("button");
      drawBtn.type = "button";
      drawBtn.textContent = window.I18N.t("midnight_reward_draw_button");
      drawBtn.addEventListener("click", function () {
        rewardDraftById[id] = computeRewardDraw(entry);
        renderRewardDetail(id, entry);
      });
      detail.appendChild(drawBtn);
      return;
    }
    if (!rewardDraftById[id]) rewardDraftById[id] = computeRewardDraw(entry);
    var draft = rewardDraftById[id];
    if (entry.kind === "weapon" && draft.weaponId) {
      var c1 = characters[myTokenId];
      if (c1) renderWeaponSheetDetail(detail, c1, draft.weaponId, window.PriTestCharacterDrawer);
      else {
        var weaponFallback = document.createElement("p");
        weaponFallback.textContent = draft.label;
        detail.appendChild(weaponFallback);
      }
    } else {
      var resultText = document.createElement("p");
      resultText.textContent = draft.label;
      detail.appendChild(resultText);
      if (draft.item && draft.item.body) {
        var bodyText = document.createElement("p");
        var Localizer = entry.kind === "talisman" ? window.PriTestTalismans : window.PriTestConsumables;
        bodyText.textContent = Localizer.localizedText(draft.item.body);
        detail.appendChild(bodyText);
      }
    }
    // 持有量硬上限（2026-09-05角色面板優化新增）：weapon/consumable/talisman三種entry
    // 對應角色面板的6/4/2格上限，滿了就不給確認收下，提示先去角色面板丟棄騰出空間——
    // 獎勵本身仍留在待處理清單裡，之後騰出空間再回來點確認即可，不會憑空遺失。
    var inventoryKind = needsDrawStep ? entry.kind : null;
    var c0 = characters[myTokenId];
    if (inventoryKind && c0 && !hasInventorySpace(c0, inventoryKind)) {
      var fullNote = document.createElement("p");
      fullNote.textContent = window.I18N.t("midnight_inventory_full_note");
      detail.appendChild(fullNote);
      return;
    }
    var confirmBtn = document.createElement("button");
    confirmBtn.type = "button";
    confirmBtn.textContent = window.I18N.t("midnight_reward_confirm_button");
    confirmBtn.addEventListener("click", function () {
      confirmRewardEntry(id, draft);
    });
    detail.appendChild(confirmBtn);
    var discardBtn = document.createElement("button");
    discardBtn.type = "button";
    discardBtn.textContent = window.I18N.t("midnight_reward_discard_button");
    discardBtn.addEventListener("click", function () {
      discardRewardEntry(id);
    });
    detail.appendChild(discardBtn);
  }

  function renderRewardModal() {
    var list = pendingRewards[myTokenId] || {};
    var unresolvedIds = Object.keys(list).filter(function (id) {
      return !list[id].resolved;
    });
    var idsKey = unresolvedIds.slice().sort().join(",");
    if (idsKey !== lastRewardIdsKey) {
      lastRewardIdsKey = idsKey;
      rewardModalDismissed = false; // 有新的未解決獎勵時，重新自動彈出
    }
    var modal = el("midnight-reward-modal");
    if (!modal) return;
    if (!unresolvedIds.length || rewardModalDismissed) {
      modal.hidden = true;
      return;
    }
    modal.hidden = false;
    var listEl = el("midnight-reward-list");
    listEl.innerHTML = "";
    unresolvedIds.forEach(function (id) {
      var entry = list[id];
      var li = document.createElement("li");
      var btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = rewardEntryLabel(entry);
      btn.addEventListener("click", function () {
        selectedRewardId = id;
        renderRewardDetail(id, entry);
      });
      li.appendChild(btn);
      listEl.appendChild(li);
    });
    if (!selectedRewardId || !list[selectedRewardId] || list[selectedRewardId].resolved) {
      selectedRewardId = unresolvedIds[0];
    }
    renderRewardDetail(selectedRewardId, list[selectedRewardId]);
  }

  function closeRewardModal() {
    rewardModalDismissed = true;
    el("midnight-reward-modal").hidden = true;
  }

  // ---- 角色屬性管理面板：唯讀顯示characters[myTokenId]，不提供編輯（見規劃紀錄設計取捨）。----
  // 角色面板選取狀態（2026-09-05角色面板優化新增）：{kind, ref}——kind決定右側detail
  // 怎麼顯示／是否提供裝備/丟棄按鈕，ref是該kind下用來識別項目的值（武器/裝飾品是id
  // 字串、消耗品是instance id、技能/技藝/被動是ability物件本身、遺物效果是learnedKey
  // 字串、附帶效果是effect id字串）。開啟/關閉面板時重置，避免跨角色殘留選取。
  var characterSheetSelection = null;

  // 等級提升＋可習得遺物效果的擲骰狀態（2026-09-05角色能力真正接入新增）：跟
  // character_drawer.js的relicRolledDice是各自獨立的模組層級變數（midnight跟主遊戲角色卡
  // 是完全不同的頁面），開關角色面板時重置，避免跨角色殘留擲骰結果。
  var midnightRelicRolledDice = null;

  function openCharacterSheetModal() {
    characterSheetSelection = null;
    midnightRelicRolledDice = null;
    el("midnight-character-sheet-modal").hidden = false;
    renderCharacterSheet();
  }

  function closeCharacterSheetModal() {
    el("midnight-character-sheet-modal").hidden = true;
  }

  function selectCharacterSheetItem(kind, ref) {
    characterSheetSelection = { kind: kind, ref: ref };
    renderCharacterSheet();
  }

  // 6/4/2格欄位（2026-09-05角色面板優化新增，使用者明確規格）：items是實際持有的項目
  // 陣列，slotCount是硬上限，renderLabel(item)回傳格子上顯示的文字，onSelect(item)是
  // 點擊時要呼叫的selectCharacterSheetItem()包裝——不足slotCount的格子畫成空格佔位，
  // 讓玩家一眼看出還有幾格空間。
  function renderInventorySlots(container, items, slotCount, kind, renderLabel) {
    container.innerHTML = "";
    for (var i = 0; i < slotCount; i++) {
      var slotEl = document.createElement("button");
      slotEl.type = "button";
      slotEl.className = "midnight-sheet-slot";
      if (i < items.length) {
        var item = items[i];
        slotEl.textContent = renderLabel(item);
        var isSelected =
          characterSheetSelection && characterSheetSelection.kind === kind && characterSheetSelection.ref === (item.id || item);
        if (isSelected) slotEl.classList.add("midnight-sheet-slot-selected");
        slotEl.addEventListener("click", function (boundItem) {
          return function () {
            selectCharacterSheetItem(kind, boundItem.id || boundItem);
          };
        }(item));
      } else {
        slotEl.textContent = "";
        slotEl.disabled = true;
        slotEl.classList.add("midnight-sheet-slot-empty");
      }
      container.appendChild(slotEl);
    }
  }

  // 可發動技能／技藝／被動能力（type.skills／type.arts／type.abilities）：純規則說明，
  // 唯讀清單，點擊只顯示detail、沒有裝備/丟棄按鈕（不是持有物）。
  function renderAbilityList(container, abilities, kind, CharacterTypes) {
    container.innerHTML = "";
    (abilities || []).forEach(function (ability) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = CharacterTypes.localizedText(ability.name);
      if (characterSheetSelection && characterSheetSelection.kind === kind && characterSheetSelection.ref === ability) {
        btn.classList.add("midnight-sheet-slot-selected");
      }
      btn.addEventListener("click", function () {
        selectCharacterSheetItem(kind, ability);
      });
      container.appendChild(btn);
    });
  }

  // 技藝／技能欄位（2026-09-05角色能力真正接入新增，取代原本套用renderAbilityList的顯示）：
  // 除了基礎招式，若已習得帶variantEntry的遺物效果（見learnedVariantEntries()），一併列出
  // 每個可切換的替代招式。點擊清單中尚未生效的項目即切換為使用該招式（存
  // c._selectedArtVariantIndex／_selectedSkillVariantIndex，0＝基礎招式，其餘＝variants
  // 陣列的index+1），同時沿用既有selectCharacterSheetItem()顯示detail的機制。只有1個選項
  // （沒有已習得的替代招式）時，行為等同原本的renderAbilityList。
  function renderSkillArtSlot(container, kind, c, type, CharacterTypes) {
    container.innerHTML = "";
    var baseAbility = type ? (kind === "art" ? (type.arts || [])[0] : (type.skills || [])[0]) : null;
    if (!baseAbility) return;
    var variants = learnedVariantEntries(c, type)[kind];
    var options = [baseAbility].concat(variants);
    var selectedField = kind === "art" ? "_selectedArtVariantIndex" : "_selectedSkillVariantIndex";
    var currentIdx = c[selectedField] || 0;
    options.forEach(function (ability, idx) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = CharacterTypes.localizedText(ability.name);
      if (currentIdx === idx) btn.classList.add("midnight-sheet-variant-active");
      if (characterSheetSelection && characterSheetSelection.kind === kind && characterSheetSelection.ref === ability) {
        btn.classList.add("midnight-sheet-slot-selected");
      }
      btn.addEventListener("click", function () {
        if (options.length > 1 && currentIdx !== idx) {
          c[selectedField] = idx;
          GameStorage.rtSet(gameId, "cloud", "character/" + myTokenId + "/" + selectedField, idx);
        }
        selectCharacterSheetItem(kind, ability);
      });
      container.appendChild(btn);
    });
  }

  // 等級提升（2026-09-05角色能力真正接入新增）：重用CharacterDrawer.tryLevelUp()（跟主遊戲
  // 角色卡char-level stat stepper同一套盧恩費用規則，見character_drawer.js:1231-1251），
  // 只有這裡的DOM渲染與+/-按鈕綁定是midnight自己的。
  // 2026-09-06使用者明確要求「只有使用後能提升等級，不再自己的腳色中隨時升級」：
  // 「+」（升級）按鈕在blessingLevelUpAvailable為false時disable，並附加提示文字；
  // 「−」（降級，用來修正誤按，不消耗盧恩）不受此限制，維持隨時可用。
  // 2026-09-06使用者再次明確要求「使用祝福後能持續升級直到不足盧恩，而非只能升一次」：
  // 規則書（docs/scenario_flow_rules.md §9祝福チット）原文只寫「PC全員はレベルアップができ」，
  // 沒有「限一次」的字樣，因此拿掉原本「升一次就消耗掉這次祝福額度」的限制，改成只要
  // blessingLevelUpAvailable為true（已使用過祝福）就能持續升級，真正的上限交給盧恩是否足夠
  // 判斷（tryLevelUp本身既有的insufficient_runes）。同時「+」按鈕旁的費用提示改成：盧恩足夠時
  // 顯示原本的「（-N）」，不足時改用黃字「（需要N盧恩）」，讓玩家不用點下去才知道會失敗。
  function renderCharacterSheetLevelRow(c, CD) {
    el("midnight-character-sheet-level-value").textContent = c.level;
    el("midnight-character-sheet-runes-value").textContent = c.runes || 0;
    var costEl = el("midnight-character-sheet-level-next-cost");
    var nextCost = c.level + 1;
    var insufficientRunes = c.level < CD.LEVEL_CAP && (c.runes || 0) < nextCost;
    if (c.level >= CD.LEVEL_CAP) {
      costEl.textContent = "";
    } else if (insufficientRunes) {
      costEl.textContent = window.I18N.t("midnight_level_next_cost_needed", { cost: nextCost });
    } else {
      costEl.textContent = window.I18N.t("level_next_cost_marker", { cost: nextCost });
    }
    costEl.classList.toggle("midnight-level-cost-insufficient", insufficientRunes);
    var plusBtn = el("btn-midnight-sheet-level-plus");
    plusBtn.disabled = !blessingLevelUpAvailable || c.level >= CD.LEVEL_CAP || insufficientRunes;
    plusBtn.title = blessingLevelUpAvailable ? "" : window.I18N.t("midnight_level_up_needs_blessing_note");
  }

  function handleMidnightLevelDelta(delta) {
    var c = characters[myTokenId];
    var CD = window.PriTestCharacterDrawer;
    if (!c) return;
    if (delta > 0 && !blessingLevelUpAvailable) {
      showToast(window.I18N.t("midnight_level_up_needs_blessing_note"));
      return;
    }
    var result = CD.tryLevelUp(c, delta);
    if (!result.ok) {
      if (result.reason === "insufficient_runes") {
        showToast(window.I18N.t("level_up_insufficient_runes", { level: result.nextLevel, cost: result.cost, runes: result.runes }));
      }
      return;
    }
    // 2026-09-06使用者明確要求「使用祝福後能持續升級直到不足盧恩，而非一次」：不再於此把
    // blessingLevelUpAvailable設回false，讓玩家可以連續點「+」直到盧恩不足（renderCharacterSheetLevelRow
    // 的insufficientRunes判斷會自然disable按鈕）。
    midnightRelicRolledDice = null; // 等級變動會影響relicMaxLearnable()上限，清掉避免殘留候選跟新上限對不上
    GameStorage.rtSet(gameId, "cloud", "character/" + myTokenId, c);
    renderCharacterSheet();
    // 同openBlessingModal()的說明：+/-現在只會出現在#midnight-blessing-modal裡，
    // renderCharacterSheet()在角色面板沒開時會提早return、不會更新level-row，這裡要
    // 額外直接呼叫一次。
    renderCharacterSheetLevelRow(c, CD);
  }

  // 可習得遺物效果候選卡：一張候選卡的DOM組裝＋「習得」按鈕（重用
  // CharacterDrawer.learnRelicEffect，跟character_drawer.js的renderRelicCandidateCard
  // 走同一套規則，只是DOM是midnight自己排版）。
  function renderMidnightRelicCandidateCard(container, candidate, c, CD, CharacterTypes) {
    var card = document.createElement("div");
    card.className = "midnight-relic-candidate-card";
    var nameEl = document.createElement("p");
    nameEl.textContent = CharacterTypes.localizedText(candidate.effect.name);
    card.appendChild(nameEl);
    var bodyEl = document.createElement("p");
    bodyEl.textContent = CharacterTypes.localizedText(candidate.effect.body);
    card.appendChild(bodyEl);

    var choiceConfig = CD.relicChoiceConfigForEffect(candidate.effect);
    var choiceSelect = null;
    if (choiceConfig) {
      choiceSelect = document.createElement("select");
      var randomOpt = document.createElement("option");
      randomOpt.value = "-1";
      randomOpt.textContent = window.I18N.t("relic_choice_random_option");
      choiceSelect.appendChild(randomOpt);
      choiceConfig.options.forEach(function (opt, idx) {
        var o = document.createElement("option");
        o.value = String(idx);
        o.textContent = CharacterTypes.localizedText(opt);
        choiceSelect.appendChild(o);
      });
      card.appendChild(choiceSelect);
    }

    var learnBtn = document.createElement("button");
    learnBtn.type = "button";
    learnBtn.textContent = window.I18N.t("relic_learn_button");
    learnBtn.addEventListener("click", function () {
      var pickedIdx = choiceSelect ? Number(choiceSelect.value) : -1;
      var pickedOption = choiceConfig && pickedIdx >= 0 ? choiceConfig.options[pickedIdx] : null;
      CD.learnRelicEffect(c, candidate, pickedOption);
      GameStorage.rtSet(gameId, "cloud", "character/" + myTokenId, c);
      midnightRelicRolledDice = null;
      renderCharacterSheet();
    });
    card.appendChild(learnBtn);
    container.appendChild(card);
  }

  function renderMidnightRelicCandidates(c, type, CD, CharacterTypes) {
    var candidatesEl = el("midnight-character-sheet-relic-candidates");
    candidatesEl.innerHTML = "";
    if (!type || !midnightRelicRolledDice) return;
    if ((c.learnedRelicEffects || []).length >= CD.relicMaxLearnable(c.level)) return;

    var forward = CD.relicCandidateFor(type, c, midnightRelicRolledDice.x, midnightRelicRolledDice.y);
    var reverse = CD.relicCandidateFor(type, c, midnightRelicRolledDice.y, midnightRelicRolledDice.x);
    if (forward && reverse && forward.key === reverse.key) reverse = null;

    if (forward || reverse) {
      var label = document.createElement("p");
      label.textContent = window.I18N.t("relic_choose_one_label");
      candidatesEl.appendChild(label);
      if (forward) renderMidnightRelicCandidateCard(candidatesEl, forward, c, CD, CharacterTypes);
      if (reverse) renderMidnightRelicCandidateCard(candidatesEl, reverse, c, CD, CharacterTypes);
    } else {
      var freeLabel = document.createElement("p");
      freeLabel.textContent = window.I18N.t("relic_free_choice_label");
      candidatesEl.appendChild(freeLabel);
      CD.relicAllUnlearned(type, c).forEach(function (cand) {
        renderMidnightRelicCandidateCard(candidatesEl, cand, c, CD, CharacterTypes);
      });
    }
  }

  // 遺物效果學習區塊（2026-09-05角色能力真正接入新增）：跟主遊戲relic-select-block
  // （character_drawer.js的renderRelicSection）同一個顯示條件——只有還有名額
  // （learned < relicMaxLearnable(c.level)）時才顯示。
  function renderMidnightRelicLearnSection(c, type, CD, CharacterTypes) {
    var block = el("midnight-sheet-relic-learn-block");
    var learned = (c.learnedRelicEffects || []).length;
    var maxLearnable = type ? CD.relicMaxLearnable(c.level) : 0;
    block.hidden = !type || learned >= maxLearnable;
    if (block.hidden) return;

    var progressEl = el("midnight-character-sheet-relic-progress");
    progressEl.innerHTML = "";
    progressEl.appendChild(document.createTextNode(window.I18N.t("relic_progress_text", { learned: learned, max: maxLearnable })));
    var pending = Math.max(0, maxLearnable - learned);
    if (pending > 0) {
      var badge = document.createElement("span");
      badge.className = "relic-learnable-badge";
      badge.textContent = window.I18N.t("relic_learnable_badge", { count: pending });
      progressEl.appendChild(badge);
    }

    el("btn-midnight-sheet-relic-roll").disabled = learned >= maxLearnable;
    var diceEl = el("midnight-character-sheet-relic-dice");
    if (midnightRelicRolledDice) CD.renderDiceDisplay(diceEl, [midnightRelicRolledDice.x, midnightRelicRolledDice.y]);
    else diceEl.innerHTML = "";

    renderMidnightRelicCandidates(c, type, CD, CharacterTypes);
  }

  function handleMidnightRelicRoll() {
    var c = characters[myTokenId];
    var CD = window.PriTestCharacterDrawer;
    if (!c || !c.typeId) return;
    if ((c.learnedRelicEffects || []).length >= CD.relicMaxLearnable(c.level)) return;
    midnightRelicRolledDice = { x: CD.rollD6(), y: CD.rollD6() };
    renderCharacterSheet();
  }

  function renderCharacterSheet() {
    var modal = el("midnight-character-sheet-modal");
    if (!modal || modal.hidden) return;
    var c = characters[myTokenId];
    if (!c) return;
    var CharacterTypes = window.PriTestCharacterTypes;
    var CD = window.PriTestCharacterDrawer;
    var type = c.typeId ? CharacterTypes.get(c.typeId) : null;
    var typeName = type ? CharacterTypes.localizedText(type.name) : "";
    el("midnight-character-sheet-summary").textContent = window.I18N.t("midnight_character_sheet_summary", {
      name: c.name,
      type: typeName,
      level: c.level,
      hp: c.hp.current + "/" + c.hp.max,
      fp: c.fp.current + "/" + c.fp.max,
    });

    // 判定值（checkValues：精神/運氣/體能，跟聖甲蟲判定共用同一份i18n key，見
    // handleScarabCheckClick()）。
    var checkValues = type ? type.checkValues : null;
    el("midnight-character-sheet-checkvalues").textContent = checkValues
      ? window.I18N.t("midnight_character_sheet_checkvalues", {
          mental: checkValues.mental || 0,
          luck: checkValues.luck || 0,
          physical: checkValues.physical || 0,
        })
      : "";

    // 威力補正：computeArtPower()需要指定一把實際武器（沒有「不含武器」的算法），這裡
    // 用目前裝備中的武器（equippedWeaponIdL）當代表值；個別武器的威力補正另外在該武器
    // 被點選時顯示在右側detail（見renderCharacterSheetDetail()的weapon分支）。
    var artInfo = c.equippedWeaponIdL ? CD.computeArtPower(c, c.equippedWeaponIdL) : null;
    el("midnight-character-sheet-power").textContent = artInfo
      ? window.I18N.t("midnight_character_sheet_power", { value: artInfo.artPower })
      : window.I18N.t("midnight_character_sheet_power_none");

    el("midnight-character-sheet-favored").textContent = type
      ? window.I18N.t("midnight_character_sheet_favored", { text: CharacterTypes.localizedText(type.favoredWeapons) })
      : "";

    renderCharacterSheetLevelRow(c, CD);
    renderMidnightRelicLearnSection(c, type, CD, CharacterTypes);

    renderInventorySlots(el("midnight-character-sheet-weapons"), c.weaponIds || [], WEAPON_SLOT_COUNT, "weapon", function (wid) {
      var w = window.PriTestWeapons.get(baseCatalogId(wid));
      return w ? window.PriTestWeapons.localizedText(w.name) : wid;
    });
    renderInventorySlots(el("midnight-character-sheet-consumables"), c.consumables || [], CONSUMABLE_SLOT_COUNT, "consumable", function (inst) {
      var item = window.PriTestConsumables.get(inst.itemId);
      return (item ? window.PriTestConsumables.localizedText(item.name) : inst.itemId) + " x" + inst.usesRemaining;
    });
    renderInventorySlots(el("midnight-character-sheet-talismans"), c.talismanIds || [], TALISMAN_SLOT_COUNT, "talisman", function (tid) {
      var t = window.PriTestTalismans.get(tid);
      return t ? window.PriTestTalismans.localizedText(t.name) : tid;
    });

    renderSkillArtSlot(el("midnight-character-sheet-skills"), "skill", c, type, CharacterTypes);
    renderSkillArtSlot(el("midnight-character-sheet-arts"), "art", c, type, CharacterTypes);
    renderAbilityList(el("midnight-character-sheet-abilities"), type && type.abilities, "ability", CharacterTypes);

    // 遺物效果：重用character_drawer.js既有的relicEffectForKey(type, key)，不重新走訪
    // type.relicEffectGroups自己找（見character_drawer.js:942-950，這個helper正是為了
    // 「拿learnedRelicEffects裡的key換回效果物件」而存在）。
    var relicBox = el("midnight-character-sheet-relics");
    relicBox.innerHTML = "";
    (c.learnedRelicEffects || []).forEach(function (key) {
      var effect = type ? CD.relicEffectForKey(type, key) : null;
      var btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = effect ? CharacterTypes.localizedText(effect.name) : key;
      if (characterSheetSelection && characterSheetSelection.kind === "relic" && characterSheetSelection.ref === key) {
        btn.classList.add("midnight-sheet-slot-selected");
      }
      btn.addEventListener("click", function () {
        selectCharacterSheetItem("relic", key);
      });
      relicBox.appendChild(btn);
    });

    var effectBox = el("midnight-character-sheet-effects");
    effectBox.innerHTML = "";
    (c.learnedAttachedEffects || []).forEach(function (eid) {
      var effect = CD.attachedEffectById(eid);
      var btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = effect ? CharacterTypes.localizedText(effect.name) : eid;
      if (characterSheetSelection && characterSheetSelection.kind === "attached" && characterSheetSelection.ref === eid) {
        btn.classList.add("midnight-sheet-slot-selected");
      }
      btn.addEventListener("click", function () {
        selectCharacterSheetItem("attached", eid);
      });
      effectBox.appendChild(btn);
    });

    renderCharacterSheetDetail(c, type, CharacterTypes, CD);
  }

  // 單一戰技/共通戰技條目：名稱（Action類戰技才附上估計傷害黃字，跟night.jsの
  // renderWeaponSkillEntry()同一套判斷——只有ref.kind==="art"才計算威力）＋本文。
  // artInfo為null（例如角色沒有裝備任何武器算不出威力）時只顯示名稱＋本文，不強行估算。
  function appendWeaponSheetSkillEntry(container, name, body, artInfo, isSpellCategory, CD) {
    var nameP = document.createElement("p");
    nameP.appendChild(document.createTextNode(name));
    var artResult = artInfo ? (isSpellCategory ? CD.spellSkillPowerValue(body, artInfo.artPower) : CD.artSkillPowerValue(body, artInfo.artPower)) : null;
    if (artResult) {
      var tag = document.createElement("span");
      tag.className = "weapon-damage-tag";
      tag.textContent = " " + CD.formatValueWithSymbol(artResult.value, artResult.symbol);
      nameP.appendChild(tag);
    }
    container.appendChild(nameP);
    if (body) {
      var bodyP = document.createElement("p");
      bodyP.className = "threat-ref-body";
      bodyP.textContent = body;
      container.appendChild(bodyP);
    }
  }

  // 角色視窗武器詳細資訊（2026-09-06使用者明確規格大改版）：顯示順序統一為
  // 名稱（稀有度色點）→傷害估算黃字→威力補正→連擊特典→戰技→戰技B，比照night.js既有的
  // renderWeaponCard()資料來源與判斷方式（category.twoHitBonus／getEquippedWeaponSkillEntries／
  // weaponAccumulationEffects／resolveWeaponSkillDisplay），不重新定義任何規則數值，
  // 只是換一種版面排列。
  function renderWeaponSheetDetail(detail, c, weaponId, CD) {
    var Weapons_ = window.PriTestWeapons;
    var w = Weapons_.get(baseCatalogId(weaponId));
    if (!w) return;
    var category = Weapons_.getCategory(w.category);

    // [名稱]：稀有度色點跟night.js角色卡武器清單同一組.weapon-rarity-dot/.weapon-rarity-X
    // （C白／U藍／R紫／L金，見style.css），不是這裡另外發明的新標記。
    var nameEl = document.createElement("h4");
    if (w.rarity) {
      var rarityDot = document.createElement("span");
      rarityDot.className = "weapon-rarity-dot weapon-rarity-" + w.rarity;
      rarityDot.textContent = "■";
      nameEl.appendChild(rarityDot);
      nameEl.appendChild(document.createTextNode(" "));
    }
    nameEl.appendChild(document.createTextNode(Weapons_.localizedText(w.name) + "（" + w.rarity + "）"));
    detail.appendChild(nameEl);
    var bodyEl = document.createElement("p");
    bodyEl.textContent = Weapons_.localizedText(w.body || {});
    detail.appendChild(bodyEl);

    // [1Hit/2Hit傷害估算]：帶▲◆或屬性/異常附著技能時一併顯示（傳入accumEffects），
    // 跟角色卡頁面顯示同一套weaponDamageTagText()。
    var estimatedDmg = category && !category.isShield ? CD.computeWeaponDamage(c, weaponId, selfArenaHp()) : null;
    if (estimatedDmg) {
      var dmgP = document.createElement("p");
      var dmgTag = document.createElement("span");
      dmgTag.className = "weapon-damage-tag";
      dmgTag.textContent = CD.weaponDamageTagText(estimatedDmg, CD.weaponAccumulationEffects(c, weaponId));
      dmgP.appendChild(dmgTag);
      detail.appendChild(dmgP);
    }

    // [威力補正]：分類名稱（例："平衡"）＋數值，讓玩家看得出這個補正是依哪個分類算出來的。
    var artInfo = CD.computeArtPower(c, weaponId);
    if (artInfo) {
      var powerP = document.createElement("p");
      powerP.textContent = window.I18N.t("midnight_character_sheet_weapon_power_mod", { label: artInfo.powerModText || "-", value: artInfo.powerMod });
      detail.appendChild(powerP);
    }

    // [連擊特典]：category.twoHitBonus規則書原文（部分武器種才有，例如大劍/斧槍系兩手
    // 持握時的2Hit加成說明），跟night.jsのrenderWeaponCard()同一份資料。
    if (category && category.twoHitBonus && category.twoHitBonus.length) {
      var twoHitTitle = document.createElement("p");
      twoHitTitle.className = "boss-subheading";
      twoHitTitle.textContent = window.I18N.t("weapon_two_hit_bonus_label");
      detail.appendChild(twoHitTitle);
      category.twoHitBonus.forEach(function (bonus) {
        var bonusP = document.createElement("p");
        bonusP.className = "threat-ref-body";
        bonusP.textContent = Weapons_.localizedText(bonus.name) + window.I18N.t("colon_separator") + Weapons_.localizedText(bonus.body);
        detail.appendChild(bonusP);
      });
    }

    // [戰技]：這把武器的Action類戰技（跟combat面板的weaponArtEntry()同一份資料，這裡
    // 全部列出，不只取第一個），逐一附上估計傷害黃字＋本文。
    var actionEntries = CD.getEquippedWeaponSkillEntries(c).filter(function (e) {
      return e.weaponId === weaponId;
    });
    if (actionEntries.length) {
      var skillATitle = document.createElement("p");
      skillATitle.className = "boss-subheading";
      skillATitle.textContent = window.I18N.t("midnight_character_sheet_skill_a_label");
      detail.appendChild(skillATitle);
      var isSpellCategory = !!(category && (category.id === "staff" || category.id === "sacred_seal"));
      actionEntries.forEach(function (entry) {
        appendWeaponSheetSkillEntry(
          detail,
          Weapons_.localizedText(entry.name),
          Weapons_.localizedText(entry.body),
          artInfo,
          isSpellCategory,
          CD
        );
      });
    }

    // [戰技B]：盾的附著效果/逆位戰技，或一般武器的屬性/異常附著技能，加上共通戰技
    // （weaponExtraSkills）統一併成同一區塊（使用者明確規格「另外的戰技或是附著的
    // 共通戰技等等」）。"random"種類尚未擲骰決定的空槽直接跳過（沒有名稱/本文可顯示，
    // 跟weaponAccumulationEffects()既有做法一致，不發明尚未決定的內容）。
    var skillBRefs = category && category.isShield ? (w.attachedEffect || []).concat(w.reverseArt || []) : (w.skills || []).slice();
    skillBRefs = skillBRefs.filter(function (ref) {
      return ref.kind !== "random";
    });
    skillBRefs = skillBRefs.concat((c.weaponExtraSkills && c.weaponExtraSkills[weaponId]) || []);
    // 排除kind==="Action"（已經在上面[戰技]區塊列過，例如一般武器/盾的逆位戰技也可能是
    // Action類），避免同一個技能在[戰技]跟[戰技B]重複出現兩次。
    var resolvedSkillB = skillBRefs
      .map(function (ref) {
        return CD.resolveWeaponSkillDisplay(ref);
      })
      .filter(function (d) {
        return d && d.kind !== "Action" && (d.name || d.body);
      });
    if (resolvedSkillB.length) {
      var skillBTitle = document.createElement("p");
      skillBTitle.className = "boss-subheading";
      skillBTitle.textContent = window.I18N.t("midnight_character_sheet_skill_b_label");
      detail.appendChild(skillBTitle);
      resolvedSkillB.forEach(function (d) {
        var entryP = document.createElement("p");
        entryP.className = "threat-ref-body";
        entryP.textContent = d.name + (d.body ? window.I18N.t("colon_separator") + d.body : "");
        detail.appendChild(entryP);
      });
    }
  }

  // 右側detail：武器/消耗品/裝飾品是持有物，額外顯示【裝備】【丟棄】；技能/技藝/被動/
  // 遺物效果/附帶效果是唯讀規則說明，只顯示name+body（見計畫書「持有物 vs 規則說明」
  // 的區分）。
  function renderCharacterSheetDetail(c, type, CharacterTypes, CD) {
    var detail = el("midnight-character-sheet-detail");
    detail.innerHTML = "";
    var sel = characterSheetSelection;
    if (!sel) return;

    function appendNameBody(name, body) {
      var nameEl = document.createElement("h4");
      nameEl.textContent = name;
      detail.appendChild(nameEl);
      var bodyEl = document.createElement("p");
      bodyEl.textContent = body;
      detail.appendChild(bodyEl);
    }

    function appendInventoryButtons(kind, id) {
      if (kind === "weapon") {
        var equipBtn = document.createElement("button");
        equipBtn.type = "button";
        equipBtn.textContent = window.I18N.t("midnight_sheet_equip_button");
        equipBtn.addEventListener("click", function () {
          setEquippedWeapon(id);
          renderCharacterSheet();
        });
        detail.appendChild(equipBtn);
      } else if (kind === "consumable") {
        var quickBtn = document.createElement("button");
        quickBtn.type = "button";
        quickBtn.textContent = window.I18N.t("midnight_sheet_equip_button");
        quickBtn.addEventListener("click", function () {
          setQuickConsumable(id);
        });
        detail.appendChild(quickBtn);
      } else if (kind === "talisman") {
        var note = document.createElement("p");
        note.textContent = window.I18N.t("midnight_talisman_always_active_note");
        detail.appendChild(note);
      }
      var dropBtn = document.createElement("button");
      dropBtn.type = "button";
      // 2026-09-06使用者明確要求「[裝備][丟棄]稍微有間距,丟棄紅色背景」：紅底沿用既有
      // .danger-btn-sm（跟renderWeaponCard()清除按鈕同一顆樣式），額外掛
      // midnight-sheet-discard-btn只負責跟前一顆按鈕的間距，不是重新定義顏色。
      dropBtn.className = "danger-btn-sm midnight-sheet-discard-btn";
      dropBtn.textContent = window.I18N.t("midnight_sheet_discard_button");
      dropBtn.addEventListener("click", function () {
        dropInventoryItem(kind, id);
        characterSheetSelection = null;
        renderCharacterSheet();
      });
      detail.appendChild(dropBtn);
    }

    if (sel.kind === "weapon") {
      renderWeaponSheetDetail(detail, c, sel.ref, CD);
      appendInventoryButtons("weapon", sel.ref);
    } else if (sel.kind === "consumable") {
      var inst = (c.consumables || []).filter(function (i) {
        return i.id === sel.ref;
      })[0];
      if (!inst) return;
      var item = window.PriTestConsumables.get(inst.itemId);
      if (!item) return;
      appendNameBody(window.PriTestConsumables.localizedText(item.name), window.PriTestConsumables.localizedText(item.body || {}));
      appendInventoryButtons("consumable", sel.ref);
    } else if (sel.kind === "talisman") {
      var t = window.PriTestTalismans.get(sel.ref);
      if (!t) return;
      appendNameBody(window.PriTestTalismans.localizedText(t.name), window.PriTestTalismans.localizedText(t.body || {}));
      appendInventoryButtons("talisman", sel.ref);
    } else if (sel.kind === "skill" || sel.kind === "art" || sel.kind === "ability") {
      appendNameBody(CharacterTypes.localizedText(sel.ref.name), CharacterTypes.localizedText(sel.ref.body));
    } else if (sel.kind === "relic") {
      var effect = type ? CD.relicEffectForKey(type, sel.ref) : null;
      if (!effect) return;
      appendNameBody(CharacterTypes.localizedText(effect.name), CharacterTypes.localizedText(effect.body));
    } else if (sel.kind === "attached") {
      var attached = CD.attachedEffectById(sel.ref);
      if (!attached) return;
      appendNameBody(CharacterTypes.localizedText(attached.name), CharacterTypes.localizedText(attached.body));
    }
  }

  // 丟棄（2026-09-05角色面板優化新增）：從持有陣列移除＋在自己目前座標建立地圖上的
  // 掉落物（groundItems/{id}），供任何靠近的人撿取（見handlePickupGroundItem()）。
  function dropInventoryItem(kind, id) {
    if (!mySlot || !localPos) return;
    var c = characters[myTokenId];
    if (!c) return;
    var field = kind === "weapon" ? "weaponIds" : kind === "talisman" ? "talismanIds" : "consumables";
    var list = (c[field] || []).slice();
    var idx = -1;
    for (var i = 0; i < list.length; i++) {
      var itemId = kind === "consumable" ? list[i].id : list[i];
      if (itemId === id) {
        idx = i;
        break;
      }
    }
    if (idx === -1) return;
    var dropped = list.splice(idx, 1)[0];
    c[field] = list;
    GameStorage.rtSet(gameId, "cloud", "character/" + myTokenId + "/" + field, list);
    var groundId = "gi" + Math.random().toString(16).slice(2) + Date.now().toString(16);
    GameStorage.rtSet(gameId, "cloud", "groundItems/" + groundId, {
      kind: kind,
      itemId: kind === "consumable" ? dropped.itemId : dropped,
      usesRemaining: kind === "consumable" ? dropped.usesRemaining : null,
      x: localPos.x,
      y: localPos.y,
      droppedBy: myTokenId,
      createdAt: Date.now(),
    });
  }

  // 畫面：三種互斥狀態——①還沒人觸發過（顯示地點名稱＋「進入」）②邀請中且我不是參與者
  // （顯示邀請框＋倒數＋「加入」）③其餘情況若我是參與者才顯示banner（正式進入0.5秒後
  // 開始打字機，播完才顯示投票/結果）。不在事件內的人（既沒發起也沒在時限內加入）在
  // 邀請結束後這裡什麼都不顯示——不參與卡牌板塊的任何事情與戰鬥（使用者明確規格）。
  function renderFieldOverlay() {
    var pt = nearbyFieldPoint || nearbyCastlePoint;
    var enterPrompt = el("midnight-field-enter-prompt");
    var invitePrompt = el("midnight-field-invite-prompt");
    var banner = el("midnight-field-banner");
    if (!pt) {
      enterPrompt.hidden = true;
      invitePrompt.hidden = true;
      banner.hidden = true;
      return;
    }
    var trig = fieldTriggers[pt.id];
    var locationName = fieldLocationName(pt);
    var progress = fieldProgress[pt.id];

    if (!trig) {
      enterPrompt.hidden = false;
      invitePrompt.hidden = true;
      banner.hidden = true;
      if (progress && progress.cleared) {
        // 全樓層已踏破：不能再進入，只顯示地點名稱＋已探索完畢的提示，隱藏「進入」按鈕
        // （呼應night規則書「全フロア踏破」後即不可再探索同一フィールド）。
        el("midnight-field-enter-name").textContent = locationName + "（" + window.I18N.t("midnight_field_fully_explored_note") + "）";
        el("btn-midnight-field-enter").hidden = true;
      } else {
        var floorCount = fieldFloorCountForCard(pt.card);
        var floorLabel = progress
          ? "（" + window.I18N.t("midnight_field_floor_progress_label", { current: (progress.floorIndex || 0) + 1, total: floorCount }) + "）"
          : "";
        // 封牢（evergaol）沒有石劍鑰匙時，按鈕disabled＋名稱附註提示（使用者明確規格：
        // 「在擁有鑰匙的人才能對封牢進行動作」）。
        var lacksKey = pt.type === "evergaol" && !characterHasConsumable(characters[myTokenId], "item_stonesword_key");
        el("midnight-field-enter-name").textContent = locationName + floorLabel + (lacksKey ? "（" + window.I18N.t("midnight_evergaol_need_key_note") + "）" : "");
        el("btn-midnight-field-enter").hidden = false;
        el("btn-midnight-field-enter").disabled = !mySlot || isPaused() || lacksKey;
      }
      return;
    }
    enterPrompt.hidden = true;

    var amParticipant = !!(trig.participants && trig.participants[mySlot]);

    if (trig.status === "inviting") {
      if (amParticipant) {
        // 2026-09-06使用者回報bug「首次進入卡牌，上方資訊欄會短暫沒有顯示」：發起人（自己）
        // 在邀請時限（FIELD_INVITE_TIME_LIMIT_MS）尚未結束前，原本enterPrompt/invitePrompt/banner
        // 三個都是hidden，畫面完全空白。改成沿用banner既有的名稱列＋讀取條元件，讓地點名稱
        // 持續顯示、並用讀取條表示「邀請倒數中」，時限一到（trig.status變成active）就會接續
        // 原本「0.5秒讀取→打字機」那段既有流程，不需要另外收尾。
        invitePrompt.hidden = true;
        banner.hidden = false;
        el("midnight-field-banner-name").textContent = locationName;
        el("midnight-field-narrative-text").textContent = "";
        el("midnight-field-vote-panel").hidden = true;
        var inviteLoadingBar = el("midnight-field-loading-bar");
        inviteLoadingBar.hidden = false;
        var invitePct = Math.max(
          0,
          Math.min(100, ((Date.now() - trig.startedAt) / (trig.inviteDeadline - trig.startedAt)) * 100)
        );
        el("midnight-field-loading-fill").style.width = invitePct + "%";
        return;
      }
      banner.hidden = true;
      invitePrompt.hidden = false;
      var inviterName = (players[trig.initiatedBy] && players[trig.initiatedBy].name) || "";
      var remainSec = Math.max(0, Math.ceil((trig.inviteDeadline - Date.now()) / 1000));
      el("midnight-field-invite-text").textContent = window.I18N.t("midnight_field_invite_text", { inviter: inviterName, name: locationName });
      el("midnight-field-invite-timer").textContent = window.I18N.t("midnight_field_invite_timer_label", { seconds: remainSec });
      el("btn-midnight-field-invite-accept").disabled = !mySlot || isPaused();
      return;
    }

    invitePrompt.hidden = true;

    if (!amParticipant) {
      banner.hidden = true; // 不在事件內：不參與這個板塊的任何事情與戰鬥
      return;
    }

    banner.hidden = false;
    var bannerFloorLabel = window.I18N.t("midnight_field_floor_progress_label", {
      current: (trig.floorIndex || 0) + 1,
      total: fieldFloorCountForCard(pt.card),
    });
    el("midnight-field-banner-name").textContent = locationName + "（" + bannerFloorLabel + "）";

    // 2026-09-06使用者明確要求「進入所需0.5s中，在名稱下方表示一個讀取條動畫0.5s，
    // 後開始樓層講解」：這段elapsed/FIELD_ENTER_WAIT_MS是每個裝置各自依同一個共享的
    // trig.enterAt本地算出的進度百分比（不是CSS動畫），renderFieldOverlay()本身已經
    // 每影格重新呼叫（見frame()裡的updateNearbyFieldPoint()），直接用目前時間算寬度
    // 即可，不需要額外的計時器或動畫restart邏輯。
    var loadingBar = el("midnight-field-loading-bar");
    if (Date.now() < trig.enterAt + FIELD_ENTER_WAIT_MS) {
      el("midnight-field-narrative-text").textContent = "";
      el("midnight-field-vote-panel").hidden = true;
      loadingBar.hidden = false;
      var loadingPct = Math.max(0, Math.min(100, ((Date.now() - trig.enterAt) / FIELD_ENTER_WAIT_MS) * 100));
      el("midnight-field-loading-fill").style.width = loadingPct + "%";
      return;
    }
    loadingBar.hidden = true;

    renderFieldVoteOrResult(pt, trig);
  }

  function renderFieldVoteOrResult(pt, trig) {
    var votePanel = el("midnight-field-vote-panel");
    var narrativeEl = el("midnight-field-narrative-text");
    if (!fieldTypewriterDoneFor[pt.id]) {
      votePanel.hidden = true; // 打字機還在播（文字內容由maybeStartFieldTypewriter驅動），先不顯示投票/結果
      return;
    }
    // 2026-09-06使用者明確要求「在戰鬥中暫時不顯示其他資訊欄的內容,只顯示板塊名稱」：
    // 這個板塊正是目前的activeEncounter（敵人仍存活、正在戰鬥）時,隱藏敘述文字／投票
    // 結果,只留renderFieldOverlay()已經設定好的板塊名稱；敵人死亡或沒有敵人時
    // （activeEncounter變成null）才恢復顯示，不需要額外重播打字機。
    if (activeEncounter && activeEncounter.id === pt.id) {
      narrativeEl.hidden = true;
      votePanel.hidden = true;
      return;
    }
    narrativeEl.hidden = false;
    var labels = fieldChoiceLabelsFor(pt, trig);
    votePanel.hidden = false;
    if (trig.status === "resolved" || labels.length <= 1) {
      el("midnight-field-vote-options").innerHTML = "";
      el("midnight-field-vote-timer").textContent = "";
      var hp = fieldEnemyHp[pt.id];
      var progressForClear = fieldProgress[pt.id];
      if (trig.enemyFamilyId && hp !== undefined && hp <= 0) {
        el("midnight-field-vote-status").textContent =
          progressForClear && progressForClear.cleared
            ? window.I18N.t("midnight_field_fully_explored_note")
            : window.I18N.t("midnight_field_encounter_cleared_note");
      } else if (trig.status === "resolved" && !trig.enemyFamilyId) {
        el("midnight-field-vote-status").textContent = window.I18N.t("midnight_field_no_combat_note");
      } else {
        el("midnight-field-vote-status").textContent = "";
      }
      return;
    }
    // 投票中：列出每個分歧標記當按鈕，點擊寫入自己這個席位的選擇。計時文字/狀態文字
    // 每影格更新沒關係（只是textContent），但選項按鈕本身只在票數真的變動時才重建
    // ——不然每影格（60Hz）都innerHTML=""再重新appendChild，不只是浪費，玩家點擊的
    // 那個瞬間按鈕也可能剛好被整組換掉、造成點擊落空。
    var remainSec = trig.voteDeadline ? Math.max(0, Math.ceil((trig.voteDeadline - Date.now()) / 1000)) : Math.ceil(FIELD_VOTE_TIME_LIMIT_MS / 1000);
    el("midnight-field-vote-timer").textContent = window.I18N.t("midnight_field_vote_timer_label", { seconds: remainSec });
    var votes = trig.votes || {};
    var myVote = mySlot ? votes[mySlot] : undefined;
    var voteKey = JSON.stringify(votes) + ":" + mySlot + ":" + isPaused();
    if (lastRenderedVoteKey[pt.id] !== voteKey) {
      lastRenderedVoteKey[pt.id] = voteKey;
      var optionsWrap = el("midnight-field-vote-options");
      optionsWrap.innerHTML = "";
      labels.forEach(function (label, i) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = label + (myVote === i ? " ✓" : "");
        btn.disabled = !mySlot || isPaused();
        btn.addEventListener("click", function () {
          GameStorage.rtSet(gameId, "cloud", "fieldTrigger/" + pt.id + "/votes/" + mySlot, i);
        });
        optionsWrap.appendChild(btn);
      });
    }
    var participants = participantSlots(trig);
    var votedCount = participants.filter(function (slot) {
      return votes[slot] !== undefined && votes[slot] !== null;
    }).length;
    el("midnight-field-vote-status").textContent = window.I18N.t("midnight_field_vote_progress_label", { voted: votedCount, total: participants.length });
  }

  // 解謎倒數：跟畫面上其他計時文字一樣，每影格重算剩餘秒數，不逐秒另外排timer。
  function updatePuzzleTimer(now) {
    if (!puzzle) return;
    var remainMs = puzzle.deadline - now;
    if (remainMs <= 0) {
      showPuzzleResult(window.I18N.t("midnight_puzzle_timeout_text"));
      puzzle = null;
      return;
    }
    el("midnight-puzzle-timer").textContent = window.I18N.t("midnight_puzzle_timer_label", { seconds: Math.ceil(remainMs / 1000) });
  }

  // ============================================================================
  // 角色資訊面板／戰鬥面板 render：HP/FP/體力/盧恩/聖杯瓶（自己）、敵人HP（共用標靶）。
  // 其他玩家的HP條在renderOccupiedSlotCard()裡（玩家面板既有機制，不在這裡重複畫）。
  // ============================================================================

  function setBar(fillId, valueId, current, max) {
    var fillEl = el(fillId);
    if (fillEl) {
      var pct = max > 0 ? Math.max(0, Math.min(100, (current / max) * 100)) : 0;
      fillEl.style.width = pct + "%";
    }
    var valueEl = el(valueId);
    if (valueEl) valueEl.textContent = Math.round(current) + "/" + Math.round(max);
  }

  function renderCharPanel() {
    if (!mySlot) return; // 觀戰者沒有角色資源可顯示
    var selfChar = characters[myTokenId];
    var hpMax = selfArenaHpMax(selfChar);
    var hp = demoStats[myTokenId];
    setBar("midnight-self-hp-fill", "midnight-self-hp-value", hp === undefined ? hpMax : hp, hpMax);
    setBar("midnight-self-stamina-fill", "midnight-self-stamina-value", stamina.current, stamina.max);
    // 「最大FP＋□」類裝飾品/遺物效果/附帶效果：套用CharacterDrawer既有的
    // totalFlatMaxStatBonus（跟night.js算最大HP/FP完全同一套helper），不重新發明判斷。
    // 2026-09-06數值真正接入：HP/FP上限公式改用selfArenaHpMax()/selfFpMax()（使用者明確
    // 規格「血量為基礎100再加上初期HPx10,升級造成的HP上升也疊加上去」），取代先前固定100。
    if (selfChar) fp.max = selfFpMax(selfChar);
    setBar("midnight-self-fp-fill", "midnight-self-fp-value", fp.current, fp.max);
    var res = characters[myTokenId] || { runes: 0, flaskCount: FLASK_MAX_DEFAULT, flaskMax: FLASK_MAX_DEFAULT };
    el("midnight-self-rune-value").textContent = res.runes;
    el("midnight-flask-count").textContent = window.I18N.t("midnight_flask_remaining", {
      count: res.flaskCount,
      max: res.flaskMax || FLASK_MAX_DEFAULT,
    });
    el("btn-midnight-use-flask").disabled = res.flaskCount <= 0 || flaskReadingUntil !== null;
    renderFlaskReadBar();
    renderSorceryCastBars();
    renderQuickActionCards();
  }

  // 聖杯瓶讀取條：跟技能B施法讀條共用.midnight-bar-track/.midnight-bar-fill視覺元件
  // （style.css既有class，只是換一個fill顏色），沒有讀取中時寬度歸零。
  function renderFlaskReadBar() {
    var fillEl = el("midnight-flask-read-fill");
    if (!fillEl) return;
    if (flaskReadingUntil === null) {
      fillEl.style.width = "0%";
      return;
    }
    var elapsed = FLASK_READ_MS - (flaskReadingUntil - Date.now());
    fillEl.style.width = Math.max(0, Math.min(100, (elapsed / FLASK_READ_MS) * 100)) + "%";
  }

  // 每顆魔術/祈禱按鈕各自獨立的長按讀條（左右手＋單一/雙按鈕共6顆，見SORCERY_BUTTON_DEFS）。
  function renderSorceryCastBars() {
    SORCERY_BUTTON_DEFS.forEach(function (def) {
      var fillEl = el(def.fillId);
      if (!fillEl) return;
      var startedAt = sorceryHoldState[def.key];
      if (startedAt === undefined) {
        fillEl.style.width = "0%";
        return;
      }
      fillEl.style.width = Math.max(0, Math.min(100, ((Date.now() - startedAt) / SORCERY_CAST_HOLD_MS) * 100)) + "%";
    });
  }

  // 底部左側四張卡片中的武器（左／右）／消耗品文字：純顯示，見cycleEquippedWeapon／
  // handleUseQuickConsumableClick的行為說明。
  function renderQuickActionCards() {
    var c = characters[myTokenId];
    var ids = (c && c.weaponIds) || [];
    renderWeaponCard("midnight-weapon-left-label", c && c.equippedWeaponIdL, ids);
    renderWeaponCard("midnight-weapon-right-label", c && c.equippedWeaponIdR, ids);
    var inst = c && c.consumables && c.consumables[0];
    var consumableLabel = el("midnight-consumable-label");
    if (consumableLabel) {
      if (!inst) {
        consumableLabel.textContent = window.I18N.t("midnight_weapon_slot_empty");
      } else {
        var item = window.PriTestConsumables.get(inst.itemId);
        consumableLabel.textContent =
          (item ? window.PriTestConsumables.localizedText(item.name) : inst.itemId) + " x" + inst.usesRemaining;
      }
    }
    el("btn-midnight-use-consumable").disabled = !inst;
  }

  function renderWeaponCard(labelId, weaponId, ids) {
    var labelEl = el(labelId);
    if (!labelEl) return;
    // weaponId===undefined＝角色剛建立、還沒手動切換過，比照舊行為預設顯示ids[0]；
    // weaponId===""＝玩家已經明確循環切到空手（見cycleEquippedWeapon），不再回退成ids[0]。
    var effectiveId = weaponId === undefined ? ids[0] : weaponId;
    if (!effectiveId) {
      labelEl.textContent = window.I18N.t("midnight_weapon_slot_empty");
      return;
    }
    var w = window.PriTestWeapons.get(baseCatalogId(effectiveId));
    labelEl.textContent = w ? window.PriTestWeapons.localizedText(w.name) + "（" + w.rarity + "）" : effectiveId;
  }

  // 戰鬥面板：預設顯示技術驗證片原本的共用標靶（沒有遇到敵人時），一旦站在已解決分歧
  // 且敵人仍存活的地圖點旁（activeEncounter），改顯示該點專屬的敵人圖片/名稱/HP——
  // 攻擊/戰技按鈕本身不變，實際打誰由damageCombatTarget()判斷。
  function renderCombatPanel() {
    var usingEncounter = !!activeEncounter;
    var hp, max;
    if (usingEncounter) {
      max = enemyRealHpMax(fieldTriggers[activeEncounter.id]);
      var raw = fieldEnemyHp[activeEncounter.id];
      hp = raw === undefined ? max : raw;
    } else {
      hp = demoStats.sharedTarget === undefined ? 20 : demoStats.sharedTarget;
      max = 20;
    }
    setBar("midnight-enemy-hp-fill", "midnight-enemy-hp-value", hp, max);
    // 敵人HP掛在畫面中間下方，只在真正「碰到敵人進入戰鬥」（活躍的地圖點/強敵遭遇戰）
    // 時顯示——使用者明確規格，跟技術驗證片原本的共用標靶demo（沒有遇敵概念）分開。
    var hudBottomCenter = el("midnight-hud-bottom-center");
    if (hudBottomCenter) hudBottomCenter.hidden = !usingEncounter;
    var canAct = !!mySlot && !isPaused();
    renderSideCombatButtons("L");
    renderSideCombatButtons("R");
    var artEntry = weaponArtEntry();
    var artBtn = el("btn-midnight-skill");
    artBtn.hidden = !artEntry;
    if (artEntry) {
      var artCost = computeMidnightSkillCost(Weapons.localizedText(artEntry.body));
      artBtn.disabled = !canAct || stamina.current < artCost.staminaCost || fp.current < artCost.fpCost;
      // 2026-09-06使用者明確要求「[戰技]名稱需隨著右手武器跟換為[戰技(名稱)]」：
      // artEntry.name是這把武器實際的戰技名稱（跟角色視窗武器詳細資訊同一份資料）。
      var artLabelEl = el("midnight-skill-a-label");
      if (artLabelEl) artLabelEl.textContent = window.I18N.t("midnight_skill_a_button_named", { name: Weapons.localizedText(artEntry.name) });
    }
    el("btn-midnight-dodge").disabled = !canAct || stamina.current < STAMINA_COST_DODGE;
    el("btn-midnight-block").disabled = !canAct || !currentGuardInfo();
    renderAttributeAccumNote();
    renderFieldEncounterPanel(usingEncounter);
  }

  // 2026-09-06優化（使用者明確規格「玩家因攻擊的連段而造成下次攻擊會2hit時，攻擊按鈕
  // 變更[Hit]，若超過闕值時間則返回顯示[攻擊]」）：闕值時間沿用既有的連段判定窗口
  // ATTACK_COMBO_WINDOW_MS（跟handleAttackClick()判斷連段是否中斷同一個常數），不用
  // 額外定義第二個時間常數。
  function attackButtonHitReady(side) {
    var cs = comboState[side];
    return cs.hitIndex === 2 && Date.now() - cs.lastHitAt <= ATTACK_COMBO_WINDOW_MS;
  }

  // 左右手一般攻擊／魔術祈禱按鈕的顯示/啟用狀態（見computeSideAttackInfo／
  // weaponSpellEntries／SORCERY_BUTTON_DEFS）。
  function renderSideCombatButtons(side) {
    var canAct = !!mySlot && !isPaused();
    var atkBtn = el(side === "L" ? "btn-midnight-attack-left" : "btn-midnight-attack-shared-target");
    var atkLabelEl = el(side === "L" ? "midnight-attack-left-label" : "midnight-attack-shared-target-label");
    if (atkBtn) {
      var atkInfo = computeSideAttackInfo(side);
      atkBtn.hidden = !atkInfo;
      if (atkInfo) {
        var cs = comboState[side];
        var useHit2 = cs.hitIndex === 2 && atkInfo.dmg.hit2Damage !== null && !!atkInfo.cost.hit2;
        var points = diceCostPoints(useHit2 ? atkInfo.cost.hit2 : atkInfo.cost.hit1);
        atkBtn.disabled = !canAct || stamina.current < points * DICE_COUNT_TO_STAMINA_MULT;
        if (atkLabelEl) {
          atkLabelEl.textContent = attackButtonHitReady(side)
            ? window.I18N.t("midnight_attack_hit_ready_button")
            : window.I18N.t(side === "L" ? "midnight_attack_left_button" : "midnight_attack_target_button");
        }
      }
    }
    var spells = weaponSpellEntries(side);
    var defs = SORCERY_BUTTON_DEFS.filter(function (def) {
      return def.side === side;
    });
    var singleDef = defs[0],
      slot0Def = defs[1],
      slot1Def = defs[2];
    if (spells.length >= 2) {
      hideSpellButton(singleDef);
      renderSpellButton(slot0Def, spells[0], canAct);
      renderSpellButton(slot1Def, spells[1], canAct);
    } else {
      hideSpellButton(slot0Def);
      hideSpellButton(slot1Def);
      renderSpellButton(singleDef, spells[0] || null, canAct);
    }
  }

  function hideSpellButton(def) {
    var btn = def && el(def.btnId);
    if (btn) btn.hidden = true;
  }

  function renderSpellButton(def, entry, canAct) {
    if (!def) return;
    var btn = el(def.btnId);
    if (!btn) return;
    btn.hidden = !entry;
    if (!entry) return;
    var labelEl = el(def.labelId);
    if (labelEl) labelEl.textContent = Weapons.localizedText(entry.name);
    var cost = computeMidnightSkillCost(Weapons.localizedText(entry.body));
    btn.disabled = !canAct || stamina.current < cost.staminaCost || fp.current < cost.fpCost;
  }

  // 敵人圖片/名稱：直接讀static_src/enemies_data_1~4.js既有資料（window.PriTestEnemies），
  // 不是自己另外畫的圖或編的名字。用lastRenderedEncounterKey擋掉「同一隻敵人每影格都
  // 重設一次img.src」（會造成瀏覽器重複要求同一張圖、偶爾閃爍）。
  function renderFieldEncounterPanel(usingEncounter) {
    var box = el("midnight-field-encounter");
    var c = characters[myTokenId];
    var type = c && c.typeId ? window.PriTestCharacterTypes.get(c.typeId) : null;
    var eyeAbility = eyeForValueAbility(type);
    var eyeBtn = el("btn-midnight-eye-for-value");
    if (!usingEncounter) {
      box.hidden = true;
      lastRenderedEncounterKey = null;
      eyeBtn.hidden = true;
      el("midnight-eye-for-value-note").textContent = "";
      return;
    }
    box.hidden = false;
    var trig = fieldTriggers[activeEncounter.id] || {};
    eyeBtn.hidden = !eyeAbility || !trig.enemyFamilyId;
    if (eyeAbility) eyeBtn.textContent = window.PriTestCharacterTypes.localizedText(eyeAbility.name);
    var key = trig.enemyFamilyId + ":" + trig.enemyId;
    if (key === lastRenderedEncounterKey) return;
    lastRenderedEncounterKey = key;
    el("midnight-eye-for-value-note").textContent = "";
    // Day3夜之王（2026-09-06三次優化）：圖片/名稱改讀night_bosses.js既有的圖片名冊
    // （跟房間設定「夜王」選單、night.js回合制側同一份資料），不是window.PriTestEnemies。
    // nameless不在這份名冊裡（劇本10専用、規則書本身就沒有正式立繪，見night_bosses.js
    // 既有註解），只顯示名稱、圖片留白，不當例外拋錯。
    if (trig.enemyFamilyId === BOSS_ENEMY_FAMILY_SENTINEL) {
      var bossInfo = bossRulebookData(trig.enemyId);
      var bossName = bossInfo ? window.PriTestEnemies.localizedText(bossInfo.name) : trig.enemyId;
      var NightBosses = window.PriTestNightBosses;
      var bossPortrait = NightBosses ? NightBosses.get(trig.enemyId) : null;
      var imgEl = el("midnight-field-encounter-image");
      if (bossPortrait) {
        imgEl.src = NightBosses.imagePath(bossPortrait, "../static/");
        imgEl.hidden = false;
      } else {
        imgEl.hidden = true;
      }
      imgEl.alt = bossName;
      el("midnight-field-encounter-name").textContent = bossName;
      return;
    }
    var data = window.PriTestEnemies ? window.PriTestEnemies.get(trig.enemyFamilyId, trig.enemyId) : null;
    if (!data) return;
    var name = window.PriTestEnemies.localizedText(data.enemy.name);
    el("midnight-field-encounter-image").hidden = false;
    el("midnight-field-encounter-image").src = window.PriTestEnemies.imagePath(data.enemy, "../static/");
    el("midnight-field-encounter-image").alt = name;
    el("midnight-field-encounter-name").textContent = name;
  }

  // ---- 標點：電腦中鍵點擊立即標點；電腦左鍵/手機觸控長按（LONG_PRESS_MS）也標點。
  // 手機的搖桿另外用midnight-mobile-joystick元素處理，不會跟canvas上的長按標點衝突
  // （搖桿是獨立的DOM元素，觸控在搖桿範圍內就不會觸發canvas的長按計時）。----
  function bindPingInput() {
    canvas.addEventListener("mousedown", function (e) {
      if (e.button === 1) {
        e.preventDefault();
        placePingAtClient(e.clientX, e.clientY);
        return;
      }
      if (e.button === 0) startLongPress(e.clientX, e.clientY);
    });
    canvas.addEventListener("mouseup", cancelLongPress);
    canvas.addEventListener("mouseleave", cancelLongPress);
    canvas.addEventListener(
      "auxclick",
      function (e) {
        if (e.button === 1) e.preventDefault();
      },
      false
    );

    canvas.addEventListener(
      "touchstart",
      function (e) {
        if (e.touches.length !== 1) return;
        var t = e.touches[0];
        startLongPress(t.clientX, t.clientY);
      },
      { passive: true }
    );
    canvas.addEventListener("touchend", cancelLongPress);
    canvas.addEventListener("touchcancel", cancelLongPress);
  }

  function startLongPress(clientX, clientY) {
    cancelLongPress();
    longPressStartClient = { x: clientX, y: clientY };
    longPressTimer = window.setTimeout(function () {
      placePingAtClient(clientX, clientY);
      longPressTimer = null;
    }, LONG_PRESS_MS);
  }

  function cancelLongPress() {
    if (longPressTimer) {
      window.clearTimeout(longPressTimer);
      longPressTimer = null;
    }
    longPressStartClient = null;
  }

  function placePingAtClient(clientX, clientY) {
    if (!mySlot || isPaused()) return; // 觀戰者／暫停中不能操作
    var rect = canvas.getBoundingClientRect();
    var scaleX = canvas.width / rect.width;
    var scaleY = canvas.height / rect.height;
    var worldX = ((clientX - rect.left) * scaleX) / CELL;
    var worldY = ((clientY - rect.top) * scaleY) / CELL;
    var now = Date.now();
    GameStorage.rtSet(gameId, "cloud", "pings/" + myTokenId, {
      x: worldX,
      y: worldY,
      name: myName,
      createdAt: now,
    });
  }

  // ---- 手機搖桿：拖曳搖桿元素本身控制移動方向（跟直接拖曳畫面移動角色不同，這裡固定
  // 用搖桿這個獨立UI元件操作，符合「用氣泡操作拖曳來慢慢移動」的手機操作方式）。----
  function bindJoystickInput() {
    var stick = el("midnight-mobile-joystick");
    var knob = el("midnight-mobile-joystick-knob");

    function updateKnob(dx, dy) {
      knob.style.transform = "translate(" + dx + "px, " + dy + "px)";
    }

    function handleMove(clientX, clientY) {
      var dx = clientX - joystickCenter.x;
      var dy = clientY - joystickCenter.y;
      var dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > joystickMaxOffset) {
        dx = (dx / dist) * joystickMaxOffset;
        dy = (dy / dist) * joystickMaxOffset;
        dist = joystickMaxOffset;
      }
      updateKnob(dx, dy);
      joystickVec.x = dist < 4 ? 0 : dx / joystickMaxOffset;
      joystickVec.y = dist < 4 ? 0 : dy / joystickMaxOffset;
    }

    stick.addEventListener(
      "touchstart",
      function (e) {
        var t = e.touches[0];
        joystickTouchId = t.identifier;
        var rect = stick.getBoundingClientRect();
        joystickCenter = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        joystickActive = true;
        if (autoFly) autoFly = null;
        handleMove(t.clientX, t.clientY);
        e.preventDefault();
      },
      { passive: false }
    );
    stick.addEventListener(
      "touchmove",
      function (e) {
        for (var i = 0; i < e.touches.length; i++) {
          if (e.touches[i].identifier === joystickTouchId) {
            handleMove(e.touches[i].clientX, e.touches[i].clientY);
            break;
          }
        }
        e.preventDefault();
      },
      { passive: false }
    );
    function endJoystick() {
      joystickActive = false;
      joystickTouchId = null;
      joystickVec = { x: 0, y: 0 };
      updateKnob(0, 0);
    }
    stick.addEventListener("touchend", endJoystick);
    stick.addEventListener("touchcancel", endJoystick);
  }

  var mapExpanded = false;
  var mapIconNudge = false; // 戰鬥剛結束／換日，提示玩家點地圖圖示查看（見recomputeActiveEncounter呼叫處／frame()換日偵測）
  var wasInActiveEncounter = false; // 偵測activeEncounter「有→無」邊緣用，見frame()
  var lastKnownDayForMapNudge = null; // 2026-09-06三次優化（使用者明確規格「延伸有新狀況才提示」邏輯）：
  // 換日（day2StartAt／day3StartAt生效）代表縮圈範圍/黃金樹之帳位置改變，也提示玩家看地圖，
  // 跟「戰鬥剛結束」同一套mapIconNudge旗標／CSS，只是多一個觸發時機，見frame()裡的呼叫處。

  // 地圖收合／展開（2026-09-05 HUD優化改版）：拿掉舊版「縮小顯示尺寸但仍可見」的
  // 中間態（.midnight-canvas-mini），改成跟既有tower/merchant modal同款的「整個
  // #midnight-map-panel用position:fixed全螢幕疊層，hidden屬性控制顯示/隱藏」——
  // 展開＝拿掉hidden（可以看到、可以移動），收合＝加上hidden（畫面上完全看不到，
  // 只剩HUD右上角的地圖圖示按鈕）。不再有「縮小但看得到」的第三態。
  function setMapExpanded(expanded) {
    mapExpanded = expanded;
    // 2026-09-06：#btn-midnight-map-close-corner現在疊在canvas本身右上角（見
    // midnight_page.py／style.css說明），是#midnight-map-panel的子孫元素，父層的
    // hidden切換就會連坐隱藏，不需要再另外對這顆按鈕設定hidden。
    el("midnight-map-panel").hidden = !expanded;
    if (expanded) mapIconNudge = false; // 玩家點開地圖後，提示動畫的任務就完成了
    renderMapIcon();
  }

  function renderMapIcon() {
    var btn = el("btn-midnight-map-icon");
    if (!btn) return;
    btn.classList.toggle("midnight-map-icon-nudge", mapIconNudge && !mapExpanded);
  }

  // 角色按鈕黃光（2026-09-06三次優化，使用者明確規格「角色還有遺物效果可學習時，角色按鈕
  // 閃黃光」）：判斷式跟renderMidnightRelicLearnSection()同一套（learned < relicMaxLearnable），
  // CSS keyframe直接重用.midnight-map-icon-nudge同一組，只是換一個class名稱套用到角色按鈕，
  // 不重寫動畫本體（見style.css）。純粹依目前角色資料狀態逐幀重算，不需要另外clear。
  function renderCharacterIcon() {
    var btn = el("btn-midnight-open-character-sheet");
    if (!btn) return;
    var c = characters[myTokenId];
    var CD = window.PriTestCharacterDrawer;
    var CharacterTypes = window.PriTestCharacterTypes;
    var type = c && c.typeId && CharacterTypes ? CharacterTypes.get(c.typeId) : null;
    var nudge = !!(c && type && CD && (c.learnedRelicEffects || []).length < CD.relicMaxLearnable(c.level));
    btn.classList.toggle("midnight-character-icon-nudge", nudge);
  }

  function tryMove(dx, dy) {
    var nx = localPos.x + dx;
    var ny = localPos.y + dy;
    // 分離X/Y軸各自檢查，讓角色可以沿著牆滑動（其中一軸卡牆、另一軸仍可移動），
    // 手感比「整個位移一起被牆擋死」更接近一般即時制動作遊戲。
    if (Map_.isWalkable(map, nx, localPos.y)) localPos.x = nx;
    if (Map_.isWalkable(map, localPos.x, ny)) localPos.y = ny;
  }

  function updateMovement(dtSec, now) {
    // 觀戰者（沒有席位）或遊戲暫停中都不能移動——觀戰限制是「多的人變成觀戰而不能做任何
    // 操作」的要求，暫停限制是「全部人無法動作」的要求。使用者明確規格（2026-09-06）：
    // 縮小地圖時要無法移動角色，只限定「展開地圖」時才能移動——不是bug，是刻意的設計
    // （之前2026-09-05的修正誤把這個規則當成bug修掉了，這裡改回來）。
    // 開局10秒進場動畫期間（見introActive()）同樣不能移動，使用者明確規格「遊戲開始有
    // 10秒的動畫時間，期間不能移動操作」。
    if (!mySlot || isPaused() || !mapExpanded || introActive(now)) return;
    // 2026-09-06使用者回報bug「開啟商人仍能帶著亂跑」：商人／祝福視窗開啟中禁止移動，
    // 跟tower puzzle/character sheet等其他全螢幕modal理應一致（這兩個視窗原本沒有這個
    // 判斷，導致玩家能一邊看著商人視窗一邊移動離開，商人視窗卻沒有跟著關閉）。
    if (!el("midnight-merchant-modal").hidden || !el("midnight-blessing-modal").hidden) return;
    if (autoFly) {
      updateAutoFly();
      return;
    }
    var dx = 0;
    var dy = 0;
    if (keysDown["arrowup"] || keysDown["w"]) dy -= 1;
    if (keysDown["arrowdown"] || keysDown["s"]) dy += 1;
    if (keysDown["arrowleft"] || keysDown["a"]) dx -= 1;
    if (keysDown["arrowright"] || keysDown["d"]) dx += 1;
    if (joystickActive && (joystickVec.x !== 0 || joystickVec.y !== 0)) {
      dx = joystickVec.x;
      dy = joystickVec.y;
    }
    if (dx === 0 && dy === 0) return;
    var len = Math.sqrt(dx * dx + dy * dy);
    var step = (MOVE_SPEED * dtSec) / len;
    tryMove(dx * step, dy * step);
  }

  // ---- 靈鳥自動飛行：沿二次貝茲曲線（起點/控制點/終點見SPIRIT_BIRD_LINKS）從F點
  // 飛到目的地，速度是一般移動速度的SPIRIT_BIRD_SPEED_MULT倍。任何移動鍵/搖桿輸入會
  // 終止（見bindInput()/bindJoystickInput()裡對autoFly的清除）。----
  function bezierPoint(t, p0, pc, p1) {
    var mt = 1 - t;
    return {
      x: mt * mt * p0.x + 2 * mt * t * pc.x + t * t * p1.x,
      y: mt * mt * p0.y + 2 * mt * t * pc.y + t * t * p1.y,
    };
  }

  function bezierLength(p0, pc, p1) {
    var samples = 20;
    var total = 0;
    var prev = p0;
    for (var i = 1; i <= samples; i++) {
      var pt = bezierPoint(i / samples, p0, pc, p1);
      total += Math.hypot(pt.x - prev.x, pt.y - prev.y);
      prev = pt;
    }
    return total;
  }

  function startAutoFly(bird) {
    var p0 = { x: localPos.x, y: localPos.y };
    var pc = { x: bird.controlX, y: bird.controlY };
    var p1 = { x: bird.toX + 0.5, y: bird.toY + 0.5 };
    var length = bezierLength(p0, pc, p1);
    var duration = (length / (MOVE_SPEED * SPIRIT_BIRD_SPEED_MULT)) * 1000;
    autoFly = {
      p0: p0,
      pc: pc,
      p1: p1,
      startTime: Date.now(),
      duration: Math.max(duration, 300),
    };
  }

  function updateAutoFly() {
    var t = (Date.now() - autoFly.startTime) / autoFly.duration;
    if (t >= 1) {
      localPos.x = autoFly.p1.x;
      localPos.y = autoFly.p1.y;
      autoFly = null;
      return;
    }
    var pt = bezierPoint(t, autoFly.p0, autoFly.pc, autoFly.p1);
    localPos.x = pt.x;
    localPos.y = pt.y;
  }

  // ---- 偵測玩家是否站在某個靈鳥（F）的使用範圍內，決定要不要顯示「使用靈鳥」按鈕。----
  function updateNearbyBird() {
    if (!mySlot || !localPos || autoFly) {
      nearbyBird = null;
      el("midnight-spirit-bird-prompt").hidden = true;
      return;
    }
    var found = null;
    Map_.SPIRIT_BIRD_LINKS.forEach(function (bird) {
      if (found) return;
      var dist = Math.hypot(localPos.x - (bird.x + 0.5), localPos.y - (bird.y + 0.5));
      if (dist <= SPIRIT_BIRD_ACTIVATE_RADIUS) found = bird;
    });
    nearbyBird = found;
    el("midnight-spirit-bird-prompt").hidden = !found;
  }

  // ---- 節流網路寫入：本地移動每影格都即時反應（zero-latency），但只用10Hz頻率把
  // 座標實際送進RTDB（60Hz送RTDB太貴太頻繁）。其他裝置收到後用lerp插值補間，
  // 掩蓋掉這10Hz之間的網路延遲與更新間隔，讓遠端角色看起來也是平滑移動而非跳格。----
  function maybePushPosition(now) {
    if (!mySlot || !localPos) return; // 觀戰者沒有角色，不推送位置
    if (now - lastPosPushTime < POS_PUSH_INTERVAL_MS) return;
    if (lastPushedPos && lastPushedPos.x === localPos.x && lastPushedPos.y === localPos.y) return;
    lastPosPushTime = now;
    lastPushedPos = { x: localPos.x, y: localPos.y };
    GameStorage.rtSet(gameId, "cloud", "tokens/" + myTokenId, {
      x: localPos.x,
      y: localPos.y,
      name: myName,
      updatedAt: now,
    });
  }

  // ---- 單一天的縮圈四段換算：回傳{stage, center, radius, finalCenter, finalRadius}。
  // endPoint要有x/y（終點Z）與midCenter（縮到大圈那一段用的中繼圓心）。stage==="done"
  // 表示這一天的縮圈已經跑完、圓已經停在終點小圓——呼叫端要再判斷「是否可以進入下一
  // 天」，不是這個函式自己決定（見currentPhaseInfo()的waitingForDay2/3邏輯）。
  // finalCenter/finalRadius永遠是這一天最終會停在的小圓（不隨階段變化），給shrink2
  // 階段畫「最終位置預覽圈」用（見render()）。
  //
  // 2026-09-04第二次修正：每天只有一輪「開放(grace)→縮到大圈(shrink1)→暫停(hold)→
  // 縮到小圈(shrink2)」，不是兩輪（第一次實作誤把使用者說的「兩天」拆成「兩天各兩
  // 階段」，已依使用者提供的明確流程圖修正）。----
  function computeDayStage(dayElapsed, endPoint) {
    var finalCenter = { x: endPoint.x + 0.5, y: endPoint.y + 0.5 };
    var midCenter = { x: endPoint.midCenter.x + 0.5, y: endPoint.midCenter.y + 0.5 };
    if (dayElapsed < PHASE_GRACE_MS) {
      return { stage: "grace", center: midCenter, radius: FULL_RADIUS, finalCenter: finalCenter, finalRadius: FINAL_RADIUS };
    }
    if (dayElapsed < PHASE_GRACE_MS + PHASE_SHRINK1_MS) {
      var t1 = (dayElapsed - PHASE_GRACE_MS) / PHASE_SHRINK1_MS;
      return {
        stage: "shrink1",
        center: midCenter,
        radius: FULL_RADIUS + (MID_RADIUS - FULL_RADIUS) * t1,
        finalCenter: finalCenter,
        finalRadius: FINAL_RADIUS,
      };
    }
    if (dayElapsed < PHASE_GRACE_MS + PHASE_SHRINK1_MS + PHASE_HOLD_MS) {
      return { stage: "hold", center: midCenter, radius: MID_RADIUS, finalCenter: finalCenter, finalRadius: FINAL_RADIUS };
    }
    if (dayElapsed < PHASE_TOTAL_MS) {
      var t2 = (dayElapsed - PHASE_GRACE_MS - PHASE_SHRINK1_MS - PHASE_HOLD_MS) / PHASE_SHRINK2_MS;
      var center = { x: midCenter.x + (finalCenter.x - midCenter.x) * t2, y: midCenter.y + (finalCenter.y - midCenter.y) * t2 };
      var radius = MID_RADIUS + (FINAL_RADIUS - MID_RADIUS) * t2;
      return { stage: "shrink2", center: center, radius: radius, finalCenter: finalCenter, finalRadius: FINAL_RADIUS };
    }
    return { stage: "done", center: finalCenter, radius: FINAL_RADIUS, finalCenter: finalCenter, finalRadius: FINAL_RADIUS };
  }

  // ---- 暫停：main menu的「暫停遊戲」會凍結所有計時（縮圈時間軸）跟操作（移動/攻擊/
  // 標點/靈鳥），直到按下「繼續遊戲」，繼續時畫面倒數3秒才真的解除。用單一meta.pause
  // 物件（{pausedAt, resumeAt, totalPausedMs}）而不是分開三個欄位，是為了能用單一
  // transaction()原子地判斷並更新，避免多裝置同時偵測到「倒數跑完該解除暫停了」時
  // 重複把pausedDuration疊加兩次（見maybeFinalizeResume()的說明）。----
  function isPaused() {
    return !!(meta.pause && meta.pause.pausedAt);
  }

  // 開局10秒進場動畫（2026-09-06優化，使用者明確規格「遊戲開始有10秒的動畫時間，期間
  // 不能移動操作：用動畫演出一隻略大的靈鷹載著入場腳色以漩渦飛行後10秒，最終停在大家的
  // 起始地點後正式開始，期間地圖慢慢從全透明到不透明」）：直接以meta.sessionStartAt為
  // 基準（所有裝置本來就共用同一個時間點，不需要另外的欄位協調），跟isPaused()刻意分開
  // 判斷（isPaused()綁定的是GM暫停的UI/邏輯，這裡是開局當下的一次性演出，兩者意義不同，
  // 不應該共用同一個旗標，見renderIntroOverlay()對#midnight-pause-overlay完全不觸碰）。
  var INTRO_DURATION_MS = 10000;
  function introActive(now) {
    return !!(meta && meta.sessionStartAt && now - meta.sessionStartAt < INTRO_DURATION_MS);
  }

  function isResumeCountingDown(now) {
    return !!(meta.pause && meta.pause.resumeAt && now < meta.pause.resumeAt);
  }

  // 把「暫停期間不該流逝的時間」從now裡扣掉：已經確定結束的暫停用totalPausedMs扣，
  // 目前正暫停中（不管是不是已經按了繼續、還在倒數）則直接凍結在pausedAt那一刻。
  function effectiveNow(now) {
    var pause = meta.pause;
    var totalPaused = (pause && pause.totalPausedMs) || 0;
    if (pause && pause.pausedAt) return pause.pausedAt - totalPaused;
    return now - totalPaused;
  }

  function handlePauseGame() {
    GameStorage.rtTransaction(gameId, "cloud", "meta/pause", function (cur) {
      var base = cur || { totalPausedMs: 0 };
      if (base.pausedAt) return base;
      return { totalPausedMs: base.totalPausedMs || 0, pausedAt: Date.now(), resumeAt: null };
    });
  }

  function handleResumeGame() {
    GameStorage.rtTransaction(gameId, "cloud", "meta/pause", function (cur) {
      if (!cur || !cur.pausedAt || cur.resumeAt) return cur;
      return { totalPausedMs: cur.totalPausedMs || 0, pausedAt: cur.pausedAt, resumeAt: Date.now() + RESUME_COUNTDOWN_MS };
    });
  }

  // 倒數跑完後才真的把暫停期間累加進totalPausedMs、清掉pausedAt/resumeAt——用
  // transaction()而不是分開讀寫，這樣即使多台裝置同時偵測到「該解除了」各自呼叫這個
  // function，Firebase會依序處理：第一個成功後cur.pausedAt已經是null，其餘裝置重試時
  // if條件不成立、直接回傳cur不變，不會把同一段暫停時間重複加總兩次。
  function maybeFinalizeResume(now) {
    if (!isResumeCountingDown(now) && !(meta.pause && meta.pause.resumeAt && now >= meta.pause.resumeAt)) return;
    if (now < meta.pause.resumeAt) return;
    if (resumeFinalizeAttempted) return;
    resumeFinalizeAttempted = true;
    GameStorage.rtTransaction(gameId, "cloud", "meta/pause", function (cur) {
      if (!cur || !cur.pausedAt || !cur.resumeAt || Date.now() < cur.resumeAt) return cur;
      return { totalPausedMs: (cur.totalPausedMs || 0) + (cur.resumeAt - cur.pausedAt), pausedAt: null, resumeAt: null };
    }).then(function () {
      resumeFinalizeAttempted = false;
    });
  }

  // ---- 三天縮圈時間軸換算：day1／day2縮到終點小圓後不會自動結束，而是停在那裡
  // （stage="waitingForDay2"／"waitingForDay3"），要等玩家按下對應按鈕、把
  // meta.day2StartAt／day3StartAt寫進RTDB後才會繼續算下一天／進入day3。day3
  // （meta.day3StartAt已設定）回傳day:3、不畫圈，畫面只顯示提示文字並自動收合地圖
  // （見frame()）。所有elapsed計算都用effectiveNow()而不是原始now，暫停期間時間軸
  // 凍結不動。----
  function currentPhaseInfo(rawNow) {
    var now = effectiveNow(rawNow);
    if (meta.day3StartAt) {
      return { day: 3, stage: "day3", center: null, radius: null };
    }
    if (meta.day2StartAt) {
      var day2Elapsed = Math.max(0, now - meta.day2StartAt);
      return phaseInfoForDay(2, day2Elapsed);
    }
    var day1Elapsed = Math.max(0, now - meta.sessionStartAt);
    return phaseInfoForDay(1, day1Elapsed);
  }

  function phaseInfoForDay(dayIndex, dayElapsed) {
    var dayPlan = map.dayPlan["day" + dayIndex];
    var waitingStage = dayIndex === 1 ? "waitingForDay2" : "waitingForDay3";
    var s = computeDayStage(dayElapsed, dayPlan.end);
    var stage = s.stage === "done" ? waitingStage : s.stage;
    return { day: dayIndex, stage: stage, center: s.center, radius: s.radius, finalCenter: s.finalCenter, finalRadius: s.finalRadius };
  }

  // ---- 「重新」按鈕：寫進共享的meta，任何一台裝置按下就對所有裝置同時生效（跟其他meta
  // 欄位一樣透過RTDB訂閱同步）。第二天／第三天的推進已改為updateAutoDayAdvance()／
  // maybeTriggerDay3FromReady()全自動驅動（見上方「夜之強敵」區塊說明），不再需要手動
  // 按鈕——進入新一天時一樣要清空meta.pause，理由不變：currentPhaseInfo()是用
  // 「effectiveNow(now) - 該天的StartAt」算elapsed，如果不清空，前一天累積的
  // totalPausedMs會被重複扣一次（那段暫停發生在新天的StartAt之前，跟新的一天無關）。----
  // 換日立即重置自己的技藝/技能冷卻（使用者明確規格：「改變到明天時立即重置」）——只清
  // 自己的角色資料，跟其他meta欄位不同，這裡不需要透過meta同步（每個裝置各自負責清自己
  // 那份character/{myTokenId}）。
  function resetAbilityCooldowns() {
    if (!myTokenId) return;
    GameStorage.rtSet(gameId, "cloud", "character/" + myTokenId + "/_artCooldownUntil", 0);
    GameStorage.rtSet(gameId, "cloud", "character/" + myTokenId + "/_skillCooldownUntil", 0);
  }

  function handleRestartCycle() {
    GameStorage.rtSet(gameId, "cloud", "meta", {
      mapSeed: meta.mapSeed,
      createdAt: meta.createdAt,
      sessionStartAt: Date.now(),
    });
    // 2026-09-06三次優化：day3夜之王戰鬥沿用fieldTrigger/fieldEnemyHp/day3Boss（跟一般
    // 強敵籌碼共用同一套shape），這幾個節點不像meta.*那樣會隨上面整個覆寫而自動清空，
    // 需要額外清除，否則重新開始一輪後夜之王會直接沿用上一輪的殘留HP/形態。
    GameStorage.rtSet(gameId, "cloud", "fieldTrigger/" + DAY3_BOSS_POINT_ID, null);
    GameStorage.rtSet(gameId, "cloud", "fieldEnemyHp/" + DAY3_BOSS_POINT_ID, null);
    GameStorage.rtSet(gameId, "cloud", "attributeAccum/" + DAY3_BOSS_POINT_ID, null);
    day3BossRollAttempted = false;
  }

  // ---- 縮圈扣血：本地每秒判定一次自己是否在圈外，若是則透過transaction()對自己的
  // demoStat做原子扣血。這是「持續傷害縮圈」規則的技術驗證（非正式數值），也直接沿用
  // 跟共享標靶攻擊按鈕相同的transaction()機制。day3（與地圖無關）不扣血。----
  function maybeApplyCircleDamage(now, phaseInfo) {
    if (!mySlot || !localPos) return; // 觀戰者沒有角色，不扣血
    if (phaseInfo.day === 3 || isPaused()) return;
    if (now - lastDamageTickTime < DAMAGE_TICK_MS) return;
    lastDamageTickTime = now;
    var dx = localPos.x - phaseInfo.center.x;
    var dy = localPos.y - phaseInfo.center.y;
    var dist = Math.sqrt(dx * dx + dy * dy);
    if (dist <= phaseInfo.radius) return;
    var maxHp = mySelfHpMaxFallback();
    GameStorage.rtTransaction(gameId, "cloud", "demoStat/" + myTokenId, function (cur) {
      var next = (cur === null ? maxHp : cur) - 1;
      return next < 0 ? 0 : next;
    });
  }

  function render(now, phaseInfo) {
    var w = canvas.width;
    var h = canvas.height;
    ctx.fillStyle = "#0c0f14";
    ctx.fillRect(0, 0, w, h);

    // 地圖背景：直接畫使用者提供的origin地圖原畫（見midnight_map.js的buildFixedGrid
    // 註解），不再逐格畫wall/floor色塊——牆的可行走判定仍在map.grid，只是不視覺化，
    // 因為現在牆的形狀（陸地邊界＋王城）已經是原畫本身的視覺呈現。圖片非同步載入，
    // 載入完成前先顯示上面填的底色，避免出現破圖。
    if (mapImage.complete && mapImage.naturalWidth > 0) {
      ctx.drawImage(mapImage, 0, 0, w, h);
    }

    // 地圖上的點：用抽牌結果畫成撲克牌樣式。
    map.points.forEach(drawPointCard);

    // 堡壘（J）：地圖中央castleZone固定範圍，不在map.points隨機清單裡，見
    // drawCastleMarker()／updateNearbyCastle()裡合成的{id:CASTLE_POINT_ID, card:"J"}點。
    drawCastleMarker();

    // 丟棄物（2026-09-05角色面板優化新增）：閃爍圖示，已被撿走的（pickedUpBy存在）
    // 不畫，避免撿走後畫面短暫殘影。
    Object.keys(groundItems).forEach(function (id) {
      var item = groundItems[id];
      if (!item.pickedUpBy) drawGroundItemMarker(item, now);
    });

    // 靈鳥（F）圖示：畫一個小小的鳥型標記，讓玩家知道哪裡可以使用。
    Map_.SPIRIT_BIRD_LINKS.forEach(drawSpiritBirdMarker);

    // 縮圈：圈外用深色遮罩＋下雨特效蓋住（drawOutsideCircleMask），圈的邊界再疊一條細線
    // 方便辨識。中心/半徑用sessionStartAt（或day2StartAt）換算出目前day/stage對應的
    // 值，不是逐幀網路同步；grace/shrink1/hold階段中心是該天的midCenter，只有shrink2
    // 才會讓中心跟半徑一起內插到終點Z（見computeDayStage()）。
    if (phaseInfo.day !== 3) {
      var cx = phaseInfo.center.x * CELL;
      var cy = phaseInfo.center.y * CELL;
      var rPx = phaseInfo.radius * CELL;
      drawOutsideCircleMask(w, h, cx, cy, rPx, now);
      ctx.strokeStyle = "#7fd1ff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, rPx, 0, Math.PI * 2);
      ctx.stroke();

      // 縮到小圈時（shrink2），內側另外畫一圈細線標出最終位置（黃金樹之帳實際落點／
      // 半徑），讓玩家在圓還沒縮完前就能看到終點在哪，及早往那個方向移動。
      if (phaseInfo.stage === "shrink2") {
        ctx.strokeStyle = "rgba(255, 213, 74, 0.85)";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.arc(phaseInfo.finalCenter.x * CELL, phaseInfo.finalCenter.y * CELL, phaseInfo.finalRadius * CELL, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // 標點（ping）：包含自己跟其他裝置的，只畫還沒過期的。
    Object.keys(remotePings).forEach(function (id) {
      var p = remotePings[id];
      if (!p || now - p.createdAt > PING_DISPLAY_MS) return;
      drawPing(p);
    });

    // 圖標：依「玩家席位」而不是直接列舉tokens/裡的每個key來畫——接管後舊tokenId會在
    // tokens/留下不再更新的殘影，改成只畫players/{slot}目前指向的tokenId，殘影就不會
    // 被畫出來。自己的席位直接用本地即時座標（zero-latency），別人的席位用lerp插值。
    for (var slotIdx = 1; slotIdx <= MAX_PLAYERS; slotIdx++) {
      var p = players[String(slotIdx)];
      if (!p) continue;
      if (p.tokenId === myTokenId) {
        if (mySlot && localPos) drawToken(localPos.x, localPos.y, p.characterId, p.name);
        continue;
      }
      var target = remoteTokens[p.tokenId];
      if (!target) continue;
      var cur = renderedRemotePos[p.tokenId] || { x: target.x, y: target.y };
      cur.x += (target.x - cur.x) * LERP_FACTOR;
      cur.y += (target.y - cur.y) * LERP_FACTOR;
      renderedRemotePos[p.tokenId] = cur;
      drawToken(cur.x, cur.y, p.characterId, p.name);
    }

    renderMinimap();
  }

  // 小地圖（2026-09-06使用者明確要求「戰鬥中小地圖顯示在地圖按鈕左邊,尺寸為原地圖的
  // 1/10倍」）：只在戰鬥中（activeEncounter存在）且地圖收合時顯示——地圖展開時本身
  // 就看得到全圖，不需要小地圖；直接把剛畫好的主canvas整張縮小畫進來，不重新執行一次
  // 地圖繪製邏輯（跟主canvas共用同一份畫面內容，drawImage()本身就會做縮放）。
  function renderMinimap() {
    if (!minimapCanvas) return;
    var showing = !!(activeEncounter && !mapExpanded);
    minimapCanvas.hidden = !showing;
    if (!showing) return;
    minimapCtx.clearRect(0, 0, minimapCanvas.width, minimapCanvas.height);
    minimapCtx.drawImage(canvas, 0, 0, minimapCanvas.width, minimapCanvas.height);
  }

  // 地圖上的點畫成小張撲克牌（背景卡片＋牌面數字/K），對應midnight_map.js抽牌生成
  // 邏輯，讓玩家能直接看出這個點是哪張牌，而不只是一個色點。
  //
  // 「完全攻破」判定（2026-09-05籌碼優化新增）：不同type各自對應既有的解決狀態欄位，
  // 全部重用既有RTDB資料，不另外發明第二套「完成」旗標：
  //   sorcerer：towerSolved[pt.id]存在。
  //   blessing：2026-09-06使用者明確要求「使用祝福後不會被打X、能再次使用」，改成
  //     永遠不算「攻破」，跟merchant一樣可以無限次重複使用。
  //   一般地點卡（2~10/K/J）：fieldTriggers[pt.id].status==="resolved"，若該分歧有指派
  //     敵人則額外要求fieldEnemyHp<=0（和平結局視為直接攻破）。
  //   merchant／blessing／random_event：沒有單一「攻破」結果（商人/祝福可重複使用、
  //     聖甲蟲各玩家各自判定成功/失敗），不畫X。
  function isPointCleared(pt) {
    if (pt.type === "sorcerer") return !!towerSolved[pt.id];
    if (pt.type === "merchant" || pt.type === "blessing" || pt.type === "random_event") return false;
    if (pt.type === "strong_enemy") {
      var trig = fieldTriggers[pt.id];
      return !!(trig && trig.enemyFamilyId && fieldEnemyHp[pt.id] <= 0);
    }
    // 一般地點卡（2~10/K/J）：「攻破」＝全樓層踏破（fieldProgress.cleared），不是單一
    // 樓層resolved就算——套用night規則書「全フロア踏破」才算完全攻破的概念（見
    // maybeAdvanceFieldProgressAfterFloorClear），跟strong_enemy籌碼（單層、擊殺即完成）
    // 的判定分開。
    return !!(fieldProgress[pt.id] && fieldProgress[pt.id].cleared);
  }

  // 已攻破：在圖示/卡片中央疊畫一個半透明深紅色✕，不擋住底下圖示本身（半透明），
  // 讓玩家一眼看出「這裡已經清過了」。
  function drawClearedMark(px, py, radius) {
    ctx.save();
    ctx.strokeStyle = "rgba(168, 20, 20, 0.85)";
    ctx.lineWidth = Math.max(2, radius * 0.22);
    ctx.beginPath();
    ctx.moveTo(px - radius, py - radius);
    ctx.lineTo(px + radius, py + radius);
    ctx.moveTo(px + radius, py - radius);
    ctx.lineTo(px - radius, py + radius);
    ctx.stroke();
    ctx.restore();
  }

  // 名稱標籤（原本只有一般地點卡在用，2026-09-05籌碼優化擴充給籌碼圖示也能用）：畫一塊
  // 跟卡片同色系的小標籤底板＋置中文字，見原本drawPointCard()裡的既有做法說明。
  function drawNameLabel(px, labelTopY, text) {
    var labelFontPx = Math.max(10, Math.floor(CELL * 0.68));
    ctx.font = "bold " + labelFontPx + "px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    var textWidth = ctx.measureText(text).width;
    var padX = CELL * 0.3;
    var labelW = textWidth + padX * 2;
    var labelH = labelFontPx + CELL * 0.25;
    ctx.fillStyle = "rgba(10, 12, 18, 0.82)";
    ctx.strokeStyle = "#20242c";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.rect(px - labelW / 2, labelTopY, labelW, labelH);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#f5f5f0";
    ctx.fillText(text, px, labelTopY + labelH / 2 + 1);
  }

  // 強敵／隨機事件揭露後，圖示替換成名稱標籤要用的文字（2026-09-05籌碼優化新增）：
  //   strong_enemy：讀fieldTriggers既有揭露的敵人本地化名稱（跟banner用同一份資料）。
  //   random_event：固定顯示「聖甲蟲」（event_rulebook.js既有branch名稱本身就是這個），
  //     一旦有任何玩家attempted過就視為揭露。
  // 尚未揭露則回傳null，呼叫端維持畫icon。
  function revealedChipLabel(pt) {
    if (pt.type === "strong_enemy") {
      var trig = fieldTriggers[pt.id];
      if (!trig || !trig.enemyFamilyId) return null;
      var data = window.PriTestEnemies ? window.PriTestEnemies.get(trig.enemyFamilyId, trig.enemyId) : null;
      return data ? window.PriTestEnemies.localizedText(data.enemy.name) : trig.enemyId;
    }
    if (pt.type === "random_event") {
      var t = fieldTriggers[pt.id];
      var attempted = t && t.attempted && Object.keys(t.attempted).length > 0;
      return attempted ? Map_.CHIP_TYPE_NAMES.random_event.zh : null;
    }
    return null;
  }

  function drawPointCard(pt) {
    var px = pt.x * CELL + CELL / 2;
    var py = pt.y * CELL + CELL / 2;
    var icon = CHIP_ICON_IMAGES[pt.type];
    if (icon) {
      var chipSize = CELL * 1.6;
      var revealedLabel = revealedChipLabel(pt);
      // 強敵籌碼抽選完後（2026-09-06使用者明確要求「地圖上顯示圖示與名稱」）：icon要
      // 跟名稱一起顯示，不是像隨機事件（聖甲蟲）那樣把icon整個換成名稱標籤。
      if (revealedLabel && pt.type !== "strong_enemy") {
        // 已揭露：不再畫icon，改畫名稱標籤（跟一般地點卡一樣的標籤樣式，垂直置中在
        // 原本icon的位置，而不是icon下方——這個型別本來就沒有卡片本體可以貼在下面）。
        drawNameLabel(px, py - CELL * 0.34, revealedLabel);
      } else if (icon.complete && icon.naturalWidth > 0) {
        ctx.drawImage(icon, px - chipSize / 2, py - chipSize / 2, chipSize, chipSize);
        var chipNameInfo = Map_.CHIP_TYPE_NAMES[pt.type];
        // 商人／強敵／隨機事件在揭露前一律顯示型別名稱（例如「強敵」「隨機事件」），跟
        // 祝福一樣以文字表示，而不是只有純icon（2026-09-06使用者明確要求）；強敵一旦
        // 揭露，這裡改顯示抽選到的敵人名稱（revealedLabel）取代型別名稱，圖示本身保留。
        var labelText = revealedLabel || (chipNameInfo && chipNameInfo.zh);
        if (labelText) {
          drawNameLabel(px, py + chipSize / 2 + 2, labelText);
        }
      }
      if (isPointCleared(pt)) drawClearedMark(px, py, chipSize / 2);
      return;
    }
    drawCardShape(px, py, pt.card, Map_.FIELD_CARD_NAMES[pt.card]);
    if (isPointCleared(pt)) drawClearedMark(px, py, CELL * 0.85);
  }

  // 卡片本體（數字/K/J＋名稱標籤）：原本只有drawPointCard()在用，2026-09-05籌碼優化
  // 抽成獨立函式，讓drawCastleMarker()（堡壘J，固定一個、不在map.points清單裡）能重用
  // 同一套畫法，不用另外複製一份卡片樣式。
  function drawCardShape(px, py, cardText, nameInfo) {
    // 2026-09-06使用者明確要求「數字卡牌的大小與籌碼事件的大小相同」：改成跟
    // drawPointCard()裡籌碼icon同樣的CELL*1.6正方形，不再用原本1.3x1.7的長方形。
    var cw = CELL * 1.6;
    var ch = CELL * 1.6;
    var isChurch = cardText === "K";
    ctx.save();
    ctx.fillStyle = isChurch ? "#f2e2b8" : "#f5f5f0";
    ctx.strokeStyle = "#20242c";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.rect(px - cw / 2, py - ch / 2, cw, ch);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = isChurch ? "#a8321a" : "#20242c";
    ctx.font = "bold " + Math.floor(CELL * (cardText.length > 1 ? 0.55 : 0.7)) + "px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(cardText, px, py);
    // 地點全名（2026-09-05 HUD優化新增：使用者要求卡片標示地點名稱，如「大教會」
    // 「坑道」）——直接讀midnight_map.js既有的FIELD_CARD_NAMES，不是自己另外編地名。
    // 第一版直接把文字寫在卡片下方的地圖底圖上，字級太小（CELL*0.32≈5px）又跟底圖的
    // 樹林/岩石紋理混在一起完全看不清楚（Playwright截圖比對後發現的問題）。改成畫一塊
    // 跟數字卡片同色系的小標籤底板，文字放大到有實際可讀性，不直接疊在地圖底圖上。
    if (nameInfo) {
      drawNameLabel(px, py + ch / 2 + 2, nameInfo.zh);
    }
    ctx.restore();
  }

  // 堡壘（J）：地圖中央castleZone固定範圍，不透過placePoints()隨機生成，見
  // midnight_map.jsのcomputeMaskCentroid()／generateMap()回傳的castleCenter。只有一個，
  // 固定畫在map.castleCenter，不用像其他籌碼一樣逐一forEach。
  function drawCastleMarker() {
    var px = map.castleCenter.x * CELL;
    var py = map.castleCenter.y * CELL;
    drawCardShape(px, py, "J", Map_.FIELD_CARD_NAMES.J);
    if (isPointCleared({ id: CASTLE_POINT_ID, card: "J", type: "castle" })) {
      drawClearedMark(px, py, CELL * 0.85);
    }
  }

  // 圈外遮罩＋下雨特效：先整張canvas鋪一層半透明深色，再用destination-out複合模式把
  // 圈內範圍「挖空」（標準的「聚光燈」畫法），讓圈內維持原本地圖亮度、圈外變暗；接著
  // 只在遮罩範圍（圈外）畫雨滴，強化「這裡是危險/暴風區」的視覺提示。雨滴用固定亂數
  // pool（initRainDrops()產生，純視覺不需要跨裝置同步，也不用seed）落下、超出畫布底部
  // 就繞回頂端。
  function drawOutsideCircleMask(w, h, cx, cy, radiusPx, now) {
    if (!rainDrops) initRainDrops(w, h);
    // 用evenodd clip（整個畫布矩形 - 圈的圓形子路徑）限制接下來的fillRect只畫在圈外，
    // 不能用destination-out疊圓形去「擦掉」畫面——那樣會把圈內已經畫好的地圖/點位/
    // 靈鳥圖示一起擦成透明，不是只擦掉遮罩本身。
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.moveTo(cx + radiusPx, cy);
    ctx.arc(cx, cy, radiusPx, 0, Math.PI * 2, true);
    ctx.clip("evenodd");
    ctx.fillStyle = "rgba(4, 8, 16, 0.6)";
    ctx.fillRect(0, 0, w, h);
    ctx.restore();

    var dtSec = lastFrameTime === null ? 0 : 1 / 60;
    ctx.save();
    ctx.strokeStyle = "rgba(180, 210, 235, 0.35)";
    ctx.lineWidth = 1;
    for (var i = 0; i < rainDrops.length; i++) {
      var d = rainDrops[i];
      d.y += RAIN_FALL_SPEED * dtSec;
      if (d.y > h) {
        d.y = -20;
        d.x = Math.random() * w;
      }
      var dist = Math.hypot(d.x - cx, d.y - cy);
      if (dist <= radiusPx) continue; // 只在圈外（遮罩範圍）畫雨
      ctx.beginPath();
      ctx.moveTo(d.x, d.y);
      ctx.lineTo(d.x - 3, d.y + 12);
      ctx.stroke();
    }
    ctx.restore();
  }

  function initRainDrops(w, h) {
    rainDrops = [];
    for (var i = 0; i < RAIN_DROP_COUNT; i++) {
      rainDrops.push({ x: Math.random() * w, y: Math.random() * h });
    }
  }

  // 靈鳥圖示（2026-09-06使用者明確要求「將靈鳥移動的類三角形更換為靈鳥圖示」）：改用
  // 展翅鳥形的向量圖形（身體橢圓＋左右對稱雙翼曲線），取代原本看起來像三角形/風箏的
  // 四邊形畫法。純canvas向量畫法，不需要額外圖檔請求（跟其他籌碼icon走圖片載入的做法
  // 不同，靈鳥點是固定佈局的少量常數點，向量畫法已經足夠清楚）。
  function drawSpiritBirdMarker(bird) {
    var px = (bird.x + 0.5) * CELL;
    var py = (bird.y + 0.5) * CELL;
    var s = CELL * 0.5;
    ctx.save();
    ctx.fillStyle = "rgba(160, 220, 255, 0.9)";
    ctx.strokeStyle = "#0c3a52";
    ctx.lineWidth = 1;
    // 左翼
    ctx.beginPath();
    ctx.moveTo(px, py - s * 0.05);
    ctx.quadraticCurveTo(px - s * 0.85, py - s * 0.65, px - s * 1.15, py + s * 0.05);
    ctx.quadraticCurveTo(px - s * 0.5, py + s * 0.05, px, py + s * 0.25);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // 右翼（左翼鏡射）
    ctx.beginPath();
    ctx.moveTo(px, py - s * 0.05);
    ctx.quadraticCurveTo(px + s * 0.85, py - s * 0.65, px + s * 1.15, py + s * 0.05);
    ctx.quadraticCurveTo(px + s * 0.5, py + s * 0.05, px, py + s * 0.25);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // 身體（疊在雙翼交會處上方，蓋掉翼根接縫）
    ctx.beginPath();
    ctx.ellipse(px, py - s * 0.02, s * 0.16, s * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  // 丟棄物閃爍標記（2026-09-05角色面板優化新增，使用者明確規格「丟棄時在地圖上閃
  // 點」）：用Math.sin依時間震盪透明度，達到閃爍效果，純視覺不需要跨裝置同步時間點
  // （每個裝置各自算自己的sin波，視覺上仍然是同步閃爍，因為都是用同一個Date.now()
  // 量級的now，不會看起來各自不同步）。
  function drawGroundItemMarker(item, now) {
    var px = (item.x + 0.5) * CELL;
    var py = (item.y + 0.5) * CELL;
    var alpha = 0.5 + 0.5 * Math.sin(now / 200);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = "#ffd54a";
    ctx.strokeStyle = "#5a4300";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(px, py, CELL * 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#20242c";
    ctx.font = "bold " + Math.floor(CELL * 0.5) + "px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    var glyph = item.kind === "weapon" ? "W" : item.kind === "talisman" ? "T" : "C";
    ctx.fillText(glyph, px, py);
    ctx.restore();
  }

  function drawPing(p) {
    var px = p.x * CELL;
    var py = p.y * CELL;
    ctx.save();
    ctx.strokeStyle = "#ffd54a";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(px, py - CELL * 1.6);
    ctx.lineTo(px, py);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(px, py - CELL * 1.6, CELL * 0.35, 0, Math.PI * 2);
    ctx.fillStyle = "#ffd54a";
    ctx.fill();
    ctx.strokeStyle = "#5a4300";
    ctx.stroke();
    if (p.name) {
      ctx.fillStyle = "#fff7d9";
      ctx.font = "10px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(p.name, px, py - CELL * 2.1);
    }
    ctx.restore();
  }

  // 玩家圖示（2026-09-05地圖優化改版：改用選擇的角色頭像，大小為原本純色圓的2倍
  // 直徑——使用者明確規格「玩家的自己的圖示使用選擇的腳色的大頭貼 大小為目前的圓
  // 兩倍」）。頭像圖片非同步載入，載入完成前退回原本的純色圓形畫法當保底，避免破圖。
  function drawToken(x, y, characterId, name) {
    var px = x * CELL;
    var py = y * CELL;
    var portrait = characterImageForId(characterId);
    if (portrait && portrait.complete && portrait.naturalWidth > 0) {
      var diameter = CELL * 0.8 * 2; // 原本純色圓半徑CELL*0.4（直徑CELL*0.8）的2倍
      var radius = diameter / 2;
      ctx.save();
      ctx.beginPath();
      ctx.arc(px, py, radius, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(portrait, px - radius, py - radius, diameter, diameter);
      ctx.restore();
      // 外框改用該角色的代表色（characterColor，跟大廳席位卡同一份CHARACTER_PRESETS.color）
      // 凸顯是哪個玩家的標記，取代原本固定的深色外框（2026-09-06使用者明確要求）。
      ctx.strokeStyle = characterColor(characterId);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(px, py, radius, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.fillStyle = characterColor(characterId);
      ctx.beginPath();
      ctx.arc(px, py, CELL * 0.4, 0, Math.PI * 2);
      ctx.fill();
    }
    if (name) {
      ctx.fillStyle = "#e8e8ec";
      ctx.font = "10px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(name, px, py - CELL * 0.9);
    }
  }

  var STAGE_LABEL_KEY = {
    grace: "midnight_phase_grace",
    shrink1: "midnight_phase_shrink1",
    hold: "midnight_phase_hold",
    shrink2: "midnight_phase_shrink2",
    waitingForDay2: "midnight_phase_waiting",
    waitingForDay3: "midnight_phase_waiting",
  };

  // 除了更新HUD文字，也負責顯示/隱藏「重新」按鈕——只在day3才看得到。第二天/第三天的
  // 推進已經全自動（見updateAutoDayAdvance()／maybeTriggerDay3FromReady()），不再有
  // 對應的手動按鈕可以顯示/隱藏。
  function renderDayPhaseHud(phaseInfo) {
    var elText = el("midnight-hud-day-phase");
    el("btn-midnight-restart-cycle").hidden = phaseInfo.day !== 3;

    if (phaseInfo.day === 3) {
      // 2026-09-06三次優化：Day3夜之王戰鬥完整版接入後，改顯示套用房間設定的夜王名稱，
      // 取代原本「尚未實作」的靜態提示（見meta.resolvedNightBossId／rollAndAssignDay3Boss()）。
      var bossId = meta && meta.resolvedNightBossId;
      var bossInfo = bossId ? bossRulebookData(bossId) : null;
      elText.textContent = bossInfo
        ? window.I18N.t("midnight_day3_boss_label", { name: window.PriTestEnemies.localizedText(bossInfo.name) })
        : window.I18N.t("midnight_day3_note");
      return;
    }
    var phaseLabel = window.I18N.t(STAGE_LABEL_KEY[phaseInfo.stage]);
    elText.textContent = window.I18N.t("midnight_day_phase_label", { day: phaseInfo.day, phase: phaseLabel });
  }

  // frame()從產生地圖那一刻就開始跑（見onMetaReceived），等待房階段也要跑，才能讓
  // 準備倒數／開局倒數即時更新畫面——但等待房階段不做移動/縮圈/傷害那一整套遊戲邏輯，
  // 只更新倒數文字並偵測「該不該正式開局了」。
  function frame(ts) {
    var now = Date.now();
    var dtSec = lastFrameTime === null ? 0 : Math.min((ts - lastFrameTime) / 1000, 0.1);
    lastFrameTime = ts;

    if (!meta || !meta.sessionStartAt) {
      if (meta) {
        maybeCancelLobbyCountdown();
        maybeTriggerSessionStart(now);
        renderLobbyCountdown(now);
      }
      requestAnimationFrame(frame);
      return;
    }

    maybeFinalizeResume(now);
    updatePauseOverlay(now);
    updateResumeCountdownHud(now);
    renderIntroOverlay(now);
    updateMovement(dtSec, now);
    updateFinalCircleBoss(now);
    updateDay3Boss();
    updateNearbyBird();
    updateNearbyTower();
    updateNearbyFieldPoint();
    updateNearbyChipPoint();
    updateNearbyCastle();
    updateNearbyGroundItem();
    updateEnemyAttack(now);
    updateBattleEnterLoading(now);
    renderEnterBattlePrompt();
    renderFinalCircleCountdown(now);
    updateStamina(dtSec);
    updateSorceryHold(now);
    updateAttackHold(now);
    updateFlaskReading(now);
    updatePuzzleTimer(now);
    maybePushPosition(now);
    var phaseInfo = currentPhaseInfo(now);
    maybeApplyCircleDamage(now, phaseInfo);
    updateAutoDayAdvance(now);
    maybeTriggerDay3FromReady();
    render(now, phaseInfo);
    renderCharPanel();
    renderCombatPanel();
    renderCharacterActionButtons();
    renderTestPanel();
    renderLobbySettings();
    renderFinalCircleRewardsHud(now);
    // 第三天（夜之王決戰）與地圖無關，直接自動收合地圖——每個裝置各自根據共享的
    // meta.day3StartAt判斷，不需要額外同步「誰收合了」這個UI狀態。
    if (phaseInfo.day === 3 && mapExpanded) setMapExpanded(false);
    // 進戰鬥自動收合地圖（2026-09-05 HUD優化，使用者確認：所有戰鬥都觸發，不限強敵
    // 籌碼）；戰鬥結束（activeEncounter從有變無）時提示玩家點地圖圖示重新展開、繼續移動。
    if (activeEncounter && mapExpanded) setMapExpanded(false);
    if (!activeEncounter && wasInActiveEncounter) {
      mapIconNudge = true;
      renderMapIcon();
    }
    wasInActiveEncounter = !!activeEncounter;
    // 換日提示（2026-09-06三次優化，延伸既有「有新狀況才提示」邏輯）：day從undefined第一次
    // 賦值不算「換日」（那是遊戲剛開始，intro動畫已經在提示了），只有day實際往上跳
    // （1→2、2→3）才視為新狀況提示玩家看地圖。
    if (lastKnownDayForMapNudge !== null && phaseInfo.day !== lastKnownDayForMapNudge) {
      mapIconNudge = true;
      renderMapIcon();
    }
    lastKnownDayForMapNudge = phaseInfo.day;
    renderCharacterIcon();
    var phaseKey = phaseInfo.day + ":" + phaseInfo.stage;
    if (phaseKey !== lastDayPhaseKey) {
      lastDayPhaseKey = phaseKey;
      renderDayPhaseHud(phaseInfo);
    }
    requestAnimationFrame(frame);
  }

  // 等待房倒數文字：countdownStartAt存在時顯示「N秒後開始」，N每影格重算。
  function renderLobbyCountdown(now) {
    var el_ = el("midnight-lobby-countdown");
    if (!meta.countdownStartAt) {
      el_.hidden = true;
      return;
    }
    var remainMs = meta.countdownStartAt + READY_COUNTDOWN_MS - now;
    var seconds = Math.max(0, Math.ceil(remainMs / 1000));
    el_.hidden = false;
    el_.textContent = window.I18N.t("midnight_lobby_countdown_text", { seconds: seconds });
  }

  // 暫停覆蓋層：暫停中顯示「遊戲已暫停」，倒數中顯示「N秒後繼續」，都沒有就隱藏。也負責
  // 切換選單裡「暫停遊戲」／「繼續遊戲」兩個按鈕的顯示。
  function updatePauseOverlay(now) {
    var overlay = el("midnight-pause-overlay");
    var pauseBtn = el("btn-midnight-pause-game");
    var resumeBtn = el("btn-midnight-resume-game");
    var paused = isPaused();
    pauseBtn.hidden = paused;
    resumeBtn.hidden = !paused;
    if (!paused) {
      overlay.hidden = true;
      return;
    }
    overlay.hidden = false;
    var text = el("midnight-pause-overlay-text");
    if (isResumeCountingDown(now)) {
      var seconds = Math.max(0, Math.ceil((meta.pause.resumeAt - now) / 1000));
      text.textContent = window.I18N.t("midnight_pause_overlay_resume_countdown", { seconds: seconds });
    } else {
      text.textContent = window.I18N.t("midnight_pause_overlay_paused_text");
    }
  }

  // 上方資訊欄的繼續遊戲倒數＋讀取條（2026-09-06三次優化，使用者明確規格「暫停遊戲後的
  // 繼續遊戲，需要再上方資訊欄中顯示倒數與讀取條」）：跟#midnight-pause-overlay並存（那個
  // 純文字、繼續擋操作），這裡額外提供視覺化讀取條。RESUME_COUNTDOWN_MS=3秒，跟「進入
  // 戰鬥」讀取條(BATTLE_ENTER_LOADING_MS)同一種「JS逐幀算style.width百分比」寫法，因為
  // 現有.midnight-loading-fill-animate這個CSS class的animation-duration寫死0.5秒，跟3秒
  // 對不上，不能直接套用。
  function updateResumeCountdownHud(now) {
    var row = el("midnight-resume-countdown-row");
    if (!row) return;
    var counting = isResumeCountingDown(now);
    row.hidden = !counting;
    if (!counting) return;
    var seconds = Math.max(0, Math.ceil((meta.pause.resumeAt - now) / 1000));
    el("midnight-resume-countdown-text").textContent = window.I18N.t("midnight_pause_overlay_resume_countdown", { seconds: seconds });
    var elapsed = RESUME_COUNTDOWN_MS - (meta.pause.resumeAt - now);
    var pct = Math.max(0, Math.min(100, (elapsed / RESUME_COUNTDOWN_MS) * 100));
    el("midnight-resume-countdown-fill").style.width = pct + "%";
  }

  // 進場動畫覆蓋層：只在introActive()期間顯示（見常數區塊說明）。2026-09-06二次修正
  // （使用者明確規格「不要完全覆蓋其動畫演出頁面，仍舊要逐漸顯現出地圖，靈鷹圖示與所有人
  // 在地圖外順時針繞兩圈後，定位在開始地點並開始」）：覆蓋層背景改成半透明（見style.css），
  // 讓底下地圖canvas的透明度漸變真正看得見；靈鷹／隊員小圓點改成JS逐幀依真實地圖座標計算
  // 螢幕位置（見introFlightPoint()），不再是跟地圖座標無關的抽象CSS keyframe漩渦。
  var introOverlayShown = false;
  var INTRO_ORBIT_END_RATIO = 0.8; // 0~80%進度沿地圖外圈繞兩圈，80~100%收斂降落到起始地點
  var INTRO_ORBIT_RADIUS_RATIO = 0.62; // 軌道半徑＝地圖畫面尺寸的62%，確保軌跡在地圖外側

  // 把地圖格子座標換算成目前畫面上canvas實際顯示的螢幕像素座標（canvas內部解析度是
  // GRID*CELL固定值，但CSS顯示尺寸會依畫面縮放，兩者透過getBoundingClientRect()的比例
  // 換算，跟render()裡「格子座標×CELL＝canvas內部像素」是同一套座標系，只是這裡多一步
  // 轉成螢幕座標）。
  function mapCellToScreenPoint(canvasEl, cellX, cellY) {
    var rect = canvasEl.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return {
      x: rect.left + ((cellX * CELL) / canvasEl.width) * rect.width,
      y: rect.top + ((cellY * CELL) / canvasEl.height) * rect.height,
      rect: rect,
    };
  }

  // progress（0~1）＋角度相位偏移（度，讓隊員小圓點跟靈鷹同軌跡但錯開角度）→ 該時間點的
  // 螢幕座標。前INTRO_ORBIT_END_RATIO比例＝順時針繞地圖外圈兩圈（720度），剩餘比例＝從
  // 軌道終點直線收斂到起始地點（landing）。
  function introFlightPoint(progress, landing, orbitCenter, orbitRadius, phaseOffsetDeg) {
    if (progress <= INTRO_ORBIT_END_RATIO) {
      var orbitProgress = progress / INTRO_ORBIT_END_RATIO;
      var angle = ((orbitProgress * 720 + phaseOffsetDeg) * Math.PI) / 180 - Math.PI / 2;
      return {
        x: orbitCenter.x + Math.cos(angle) * orbitRadius,
        y: orbitCenter.y + Math.sin(angle) * orbitRadius,
      };
    }
    var landProgress = (progress - INTRO_ORBIT_END_RATIO) / (1 - INTRO_ORBIT_END_RATIO);
    var edgeAngle = ((720 + phaseOffsetDeg) * Math.PI) / 180 - Math.PI / 2;
    var edgePoint = {
      x: orbitCenter.x + Math.cos(edgeAngle) * orbitRadius,
      y: orbitCenter.y + Math.sin(edgeAngle) * orbitRadius,
    };
    return {
      x: edgePoint.x + (landing.x - edgePoint.x) * landProgress,
      y: edgePoint.y + (landing.y - edgePoint.y) * landProgress,
    };
  }

  var INTRO_PARTY_DOT_PHASE_OFFSETS_DEG = [-35, -70, -105]; // 三個隊員小圓點跟在靈鷹後面的角度相位

  function positionIntroFlyers(progress, canvasEl) {
    var birdWrap = el("midnight-intro-bird-wrap");
    if (!birdWrap || !canvasEl || !map || !map.dayPlan || !map.dayPlan.day1) return;
    var landing = mapCellToScreenPoint(canvasEl, map.dayPlan.day1.start.x, map.dayPlan.day1.start.y);
    if (!landing) return;
    var rect = landing.rect;
    var orbitCenter = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    var orbitRadius = Math.max(rect.width, rect.height) * INTRO_ORBIT_RADIUS_RATIO;
    var birdPt = introFlightPoint(progress, landing, orbitCenter, orbitRadius, 0);
    birdWrap.style.left = birdPt.x + "px";
    birdWrap.style.top = birdPt.y + "px";
    INTRO_PARTY_DOT_PHASE_OFFSETS_DEG.forEach(function (offsetDeg, idx) {
      var dot = el("midnight-intro-party-dot-" + (idx + 1));
      if (!dot) return;
      var dotPt = introFlightPoint(progress, landing, orbitCenter, orbitRadius, offsetDeg);
      dot.style.left = dotPt.x + "px";
      dot.style.top = dotPt.y + "px";
    });
  }

  function renderIntroOverlay(now) {
    var overlay = el("midnight-intro-overlay");
    if (!overlay) return;
    var active = introActive(now);
    overlay.hidden = !active;
    var canvasEl = el("midnight-canvas");
    if (active) {
      introOverlayShown = true;
      var progress = Math.max(0, Math.min(1, (now - meta.sessionStartAt) / INTRO_DURATION_MS));
      if (canvasEl) canvasEl.style.opacity = String(progress);
      positionIntroFlyers(progress, canvasEl);
    } else if (introOverlayShown) {
      introOverlayShown = false;
      if (canvasEl) canvasEl.style.opacity = "";
    }
  }

  function startLoop() {
    requestAnimationFrame(frame);
  }

  document.addEventListener("DOMContentLoaded", function () {
    canvas = el("midnight-canvas");
    ctx = canvas.getContext("2d");
    canvas.width = GRID * CELL;
    canvas.height = GRID * CELL;

    // 小地圖：尺寸固定是主地圖canvas解析度的1/10（使用者明確規格），見render()結尾。
    minimapCanvas = el("midnight-minimap-canvas");
    minimapCtx = minimapCanvas.getContext("2d");
    minimapCanvas.width = Math.round((GRID * CELL) / 10);
    minimapCanvas.height = Math.round((GRID * CELL) / 10);

    if ("ontouchstart" in window || navigator.maxTouchPoints > 0) {
      el("midnight-mobile-joystick").hidden = false;
    }

    gameId = qsGameId();
    myTokenId = randomTokenId();
    myName = window.I18N.t("midnight_default_player_name") + Math.floor(Math.random() * 1000);

    bindInput();

    if (!gameId) {
      el("midnight-start-screen").hidden = false;
      el("btn-midnight-create").addEventListener("click", handleCreateClick);
      return;
    }

    // 分享連結獨立成midnight-share-panel、不放在midnight-hud裡——hud要進遊戲後才顯示，
    // 但等待房階段（邀請其他人加入）才是最需要看到/複製這個連結的時候。
    el("midnight-share-link").value = window.location.href;
    el("midnight-share-panel").hidden = false;
    GameStorage.rtSubscribe(gameId, "cloud", "meta", onMetaReceived);
    GameStorage.rtSubscribe(gameId, "cloud", "tokens", onTokensReceived);
    GameStorage.rtSubscribe(gameId, "cloud", "demoStat", onDemoStatsReceived);
    GameStorage.rtSubscribe(gameId, "cloud", "pings", onPingsReceived);
    GameStorage.rtSubscribe(gameId, "cloud", "players", onPlayersReceived);
    GameStorage.rtSubscribe(gameId, "cloud", "character", onCharactersReceived);
    GameStorage.rtSubscribe(gameId, "cloud", "towerSolved", onTowerSolvedReceived);
    GameStorage.rtSubscribe(gameId, "cloud", "towerInvites", onTowerInvitesReceived);
    GameStorage.rtSubscribe(gameId, "cloud", "blessingClaimed", onBlessingClaimedReceived);
    GameStorage.rtSubscribe(gameId, "cloud", "readyFinalBoss", onReadyFinalBossReceived);
    GameStorage.rtSubscribe(gameId, "cloud", "groundItems", onGroundItemsReceived);
    GameStorage.rtSubscribe(gameId, "cloud", "fieldTrigger", onFieldTriggersReceived);
    GameStorage.rtSubscribe(gameId, "cloud", "fieldEnemyHp", onFieldEnemyHpReceived);
    GameStorage.rtSubscribe(gameId, "cloud", "fieldMobHp", onFieldMobHpReceived);
    GameStorage.rtSubscribe(gameId, "cloud", "fieldProgress", onFieldProgressReceived);
    GameStorage.rtSubscribe(gameId, "cloud", "attributeAccum", onAttributeAccumReceived);
    GameStorage.rtSubscribe(gameId, "cloud", "pendingRewards", onPendingRewardsReceived);
    GameStorage.rtSubscribe(gameId, "cloud", "abilityUseEvents", onAbilityUseEventsReceived);
    GameStorage.rtSubscribe(gameId, "cloud", "combatActionEvents", onCombatActionEventsReceived);
  });

  // Playwright多裝置測試用の唯一存取窗口（見tools/field_card_sweep）：直接讀取內部
  // state比疊加DOM data屬性更可靠、也不會誤動到正式UI。不對外公開文件化，純測試用。
  window.PriTestMidnight = {
    _debugState: function () {
      return {
        gameId: gameId,
        myTokenId: myTokenId,
        localPos: localPos,
        remoteTokens: remoteTokens,
        demoStats: demoStats,
        remotePings: remotePings,
        meta: meta,
        map: map,
        nearbyBird: nearbyBird,
        autoFly: autoFly,
        phaseInfo: meta && map && meta.sessionStartAt ? currentPhaseInfo(Date.now()) : null,
        players: players,
        mySlot: mySlot,
        stamina: stamina,
        comboState: comboState,
        blockHolding: blockHolding,
        characters: characters,
        towerSolved: towerSolved,
        towerInvites: towerInvites,
        blessingClaimed: blessingClaimed,
        nearbyBlessing: nearbyBlessing,
        groundItems: groundItems,
        nearbyGroundItem: nearbyGroundItem,
        nearbyTower: nearbyTower,
        puzzle: puzzle,
        fieldTriggers: fieldTriggers,
        fieldEnemyHp: fieldEnemyHp,
        fieldMobHp: fieldMobHp,
        receivedAttributeAccum: receivedAttributeAccum,
        fieldProgress: fieldProgress,
        nearbyFieldPoint: nearbyFieldPoint,
        activeEncounter: activeEncounter,
        myIncomingAttack: myIncomingAttack,
        nearbyStrongEnemy: nearbyStrongEnemy,
        nearbyMerchant: nearbyMerchant,
        nearbyRandomEvent: nearbyRandomEvent,
        pendingRewards: pendingRewards,
        fp: fp,
        mapExpanded: mapExpanded,
        mapIconNudge: mapIconNudge,
        nearbyCastlePoint: nearbyCastlePoint,
        sorceryHoldState: sorceryHoldState,
        attributeAccum: attributeAccum,
        flaskReadingUntil: flaskReadingUntil,
        fieldTypewriterDoneFor: fieldTypewriterDoneFor,
        fieldTypewriterStartedFor: fieldTypewriterStartedFor,
      };
    },
  };
})();
