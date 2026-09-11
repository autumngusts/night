// ============================================================================
// midnight（即時制擴張版）主邏輯。
// ============================================================================
// 範圍見docs之外另存的規劃紀錄（本次milestone明確排除：任何實際戰鬥
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
  // 2026-09-08使用者明確規格「第一天第一次縮圈時間8分鐘 第二次縮圈時間5分鐘 第二天一樣」，
  // 並在追問後澄清為：「開始後8分鐘開始縮圈，原有速度縮到中繼，停止5分鐘後，開始縮到
  // 最小圈，縮的速率不變」——即grace（開放期，縮圈開始前的安全期）改成8分鐘、hold
  // （中繼圓暫停期）改成5分鐘，shrink1/shrink2（實際縮圈中的兩段）維持原速率/秒數不變。
  // Day1／Day2的phase A／phase B共用同一組常數，因此四個縮圈階段全部套用這個結構。
  var PHASE_GRACE_MS = 8 * 60 * 1000;
  var PHASE_SHRINK1_MS = 35000; // 使用者要求「第一階段的縮圈速度可以再慢一些」，比其他三段長；2026-09-08確認維持原速率不變
  var PHASE_HOLD_MS = 5 * 60 * 1000;
  var PHASE_SHRINK2_MS = 20000; // 2026-09-08確認「縮的速率不變」，維持原秒數
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
  // Task 15新增：取引「死を遠ざけたい」良好效果／「状態異常に強くなりたい」不良效果會分別
  // 把本地端玩家的體力回復速率改成6／秒或4／秒（見下方BARGAIN_DEAL_EFFECTS）。midnight只
  // 追蹤本地端自己的體力（見上方STAMINA_MAX區塊註解「不透過RTDB同步」），因此不需要per
  // character欄位，只需要一個可被取引效果覆寫的module-level變數，取代原本updateStamina()
  // 直接讀STAMINA_REGEN_PER_SEC常數的寫死值。未套用任何取引效果時預設值與
  // STAMINA_REGEN_PER_SEC完全相同，不影響既有行為。
  var myStaminaRegenPerSec = STAMINA_REGEN_PER_SEC;
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
  // 2026-09-08使用者明確要求「不撓...cd:10s」：觸發本身不是按鍵操作（受屬性/異常閾值
  // 自動觸發，見recordReceivedAttributeAccum()），這裡的cd是「兩次觸發之間至少間隔10秒」
  // 的節流，避免短時間內連續跨越閾值時無限疊加。獨立冷卻欄位，跟技能/技藝冷卻無關。
  var UNYIELDING_TRIGGER_COOLDOWN_MS = 10000;

  function triggerUnyieldingStackIfApplicable() {
    var c = characters[myTokenId];
    var type = c && c.typeId ? window.PriTestCharacterTypes.get(c.typeId) : null;
    var hasUnyielding =
      type &&
      (type.abilities || []).some(function (a) {
        return a.id === "unyielding";
      });
    if (!c || !hasUnyielding) return;
    if (Date.now() < (c._unyieldingTriggerCooldownUntil || 0)) return;
    c._unyieldingTriggerCooldownUntil = Date.now() + UNYIELDING_TRIGGER_COOLDOWN_MS;
    GameStorage.rtSet(gameId, "cloud", "character/" + myTokenId + "/_unyieldingTriggerCooldownUntil", c._unyieldingTriggerCooldownUntil);
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
  //   ①「敵視」判定＝目前對這隻敵人造成最多累積傷害的參與者（目前沒有既有
  //     仇恨值/威脅值系統，使用者選擇不新增一套，直接沿用傷害量最簡單判定）。
  //   ②攻擊觸發＝敵人存活期間，每次攻擊結束後隨機等待2~4秒再發動下一次。
  //   ③「多名一起攻擊」鎖定人數＝2人或3人都有可能（使用者原話：「2人3人都有可能」）。
  // 目標選擇的三層機率權重、每次攻擊造成的傷害量，使用者都沒有給實際數字，這裡先用
  // demo佔位權重／傷害值（見下方個別常數註解），之後有正式規則書數值時應直接取代。----
  var ENEMY_ATTACK_INTERVAL_MIN_MS = 2000;
  var ENEMY_ATTACK_INTERVAL_MAX_MS = 4000;
  var ENEMY_ATTACK_WARN_MS = 500; // 使用者明確規格：警示圖示閃爍0.5秒後才開始攻擊
  var ENEMY_ATTACK_HIT_WINDOW_MS = [2000, 2500, 3000]; // 反應時限（單次攻擊事件固定用第0段＝2秒）
  // 2026-09-06數值真正接入：不再用demo佔位機率決定打誰，改成先從敵人實際
  // 「アクション決定表」（enemy.actions[]）抽出一招，依該招敘述判斷是個別傷害（1人）
  // 還是亂戰傷害（1~3人），見pickEnemyAction()/resolveEnemyActionOutcome()。舊有的
  // ENEMY_ATTACK_TARGET_WEIGHT_*／ENEMY_ATTACK_DAMAGE兩組demo佔位常數已移除。
  //
  // 2026-09-10使用者明確規格，連續命中判定（hitCount）依敵人「等級」分成兩組機率：
  //   - 一般敵人（非強敵、非封牢、非特殊強敵、非夜之強敵、非夜之王）：1下60%／2下40%
  //   - 上述以外（強敵/封牢/特殊強敵/夜之強敵/夜之王）：1下50%／2下30%／3下20%
  // 每一下各自有一個反應窗口（ENEMY_ATTACK_HIT_WINDOW_MS依序2.0/2.5/3.0秒），這套分段
  // 基礎設施2026-09-06把hitCount寫死成1之後就一直閒置著，這次直接沿用、不重寫。
  // 傷害分配（使用者明確規格「首擊全額，後續每下半額」）見ENEMY_ATTACK_FOLLOWUP_HIT_DAMAGE_MULT。
  var ENEMY_ATTACK_HIT_COUNT_WEIGHTS_NORMAL = [0.6, 0.4];
  var ENEMY_ATTACK_HIT_COUNT_WEIGHTS_ELITE = [0.5, 0.3, 0.2];
  var ENEMY_ATTACK_FOLLOWUP_HIT_DAMAGE_MULT = 0.5; // 第2下以後每下的傷害倍率（首擊為1）
  var ATTACK_EFFECT_DISPLAY_MS = 400; // 刀光特效顯示時間，純視覺用
  var ENEMY_HIT_EFFECT_DISPLAY_MS = 300; // 玩家命中敵人的刀光特效顯示時間，純視覺用，跟上面敵人打玩家的特效各自獨立
  var CONSUMABLE_THROW_EFFECT_DISPLAY_MS = 500; // 消耗品丟擲動畫顯示時間，需與style.cssのmidnight-consumable-throw-fly動畫時長一致
  var FP_BASE = 10; // 使用者明確規格：FP基礎10，疊加方式與HP相同（見selfFpMax()）
  var FLASK_MAX_DEFAULT = 3;
  var FLASK_HEAL_AMOUNT = 30;
  var TOWER_ACTIVATE_RADIUS = 1.5; // 沿用SPIRIT_BIRD_ACTIVATE_RADIUS同樣的數值

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
  var FIELD_INVITE_TIME_LIMIT_MS = 10000; // 2026-09-07優化：3秒→10秒
  var FIELD_ENTER_WAIT_MS = 1000; // 2026-09-07優化：0.5秒→1秒（一般板塊：A/2~10/K/籌碼）
  var FIELD_ENTER_WAIT_MS_CASTLE = 5000; // 2026-09-07優化新增：僅J（堡壘）適用
  var FIELD_LATE_JOIN_WAIT_MS = 2000; // 2026-09-07優化新增：中途加入/後補領獎的等待時間
  var FIELD_VOTE_TIME_LIMIT_MS = 10000; // 使用者明確規格：分歧意見不一致的等待時間10秒，逾時交給系統決定
  // 2026-09-06數值真正接入：敵人HP不再用demo佔位固定值30，改成「實際hp格數x10」
  // （見enemyRealHpMax()，讀enemies_data_*.jsのfamily.base[level-1].hp既有格數字串）。
  // 找不到資料（極少數缺漏或尚未指派敵人）時才退回這個保底值，避免顯示0/0。
  var FIELD_ENEMY_HP_FALLBACK = 30;
  // 雜兵單位HP（2026-09-06死靈術前置工程新增，使用者明確規格：「雜兵血量即為格子數x10」，
  // 格子數＝night_gm_flow.js既有parseCombatEnemyRef()解析出的「+雜兵N」後綴N）。
  // 2026-09-08使用者明確規格「敵人血量增加10倍」（全部敵人類型都套用）：格子數×10再乘10＝×100。
  var MOB_HP_PER_ROW = 100;
  var GUARD_BREAK_RECOVER_MS = 5000; // 使用者明確規格：Guard Point扣到0後，5秒後回復原本的Guard Point
  var GUARD_REDUCTION_THRESHOLD = 3; // 使用者明確規格：▲(0.5)/◆(1)每集滿3點，Guard Point-1
  var ART_COOLDOWN_MS = 180000; // 使用者明確規格：技藝冷卻180秒
  var SKILL_COOLDOWN_MS = 60000; // 使用者明確規格：技能冷卻60秒
  // 2026-09-08使用者明確要求「原本cd60s的招式每擊破一個敵人加快cd5s,原本cd180s的招式每
  // 擊破一個敵人加快cd10s」：只套用在技能/技藝這兩個通用冷卻欄位（_skillCooldownUntil／
  // _artCooldownUntil），見applyDamageToFieldEnemyHp()裡的擊破偵測、grantKillCooldownReduction()。
  // 不套用在角色專屬「ability」（Lv1，各自有自己獨立的冷卻欄位，例如鑑定眼／元素操控）。
  var SKILL_COOLDOWN_KILL_REDUCTION_MS = 5000;
  var ART_COOLDOWN_KILL_REDUCTION_MS = 10000;

  // ---- 強敵籌碼擊殺獎勵（2026-09-05新增，數值取自event_rulebook.jsのstrong_enemy
  // chip文字「撃破ルーン：8」「潜在する力：★★」，1日目/一般值）----
  var STRONG_ENEMY_REWARD_RUNES = 8;
  var STRONG_ENEMY_REWARD_POTENTIAL_STARS = 2;

  // ---- 2日目「⑧恐るべき強敵」擊殺獎勵（Task 18新增，設計文件§7；數值取自
  // event_rulebook.jsのstrong_enemy chip文字「撃破ルーン：12」「潜在する力：★★★」）----
  var TERRIFYING_STRONG_ENEMY_REWARD_RUNES = 12;
  var TERRIFYING_STRONG_ENEMY_REWARD_POTENTIAL_STARS = 3;

  // ---- 隨機事件「隕石」分支撃破獎勵（Task 20新增，數值取自event_rulebook.js:491/496
  // 「撃破ルーン：8 + L補正」「潜在する力：★★★★」）：「+L補正」全專案沒有通用的
  // resolver（grep確認：只有強敵決定表自己行內編碼的levelBonus，是不同機制），依CLAUDE.md
  // §19僅授予確定的基礎值8，不猜測correction項——已知簡化，不是算錯數字，比照「時間損耗」
  // 略過的既有做法（見parseAllFloorEffectRuneAmount()旁註解）。----
  var METEOR_REWARD_RUNES = 8;
  var METEOR_REWARD_POTENTIAL_STARS = 4;
  var METEOR_ENEMY_LEVEL = 8; // event_rulebook.js:492「降る星の成獣（232頁）／Lv.8」，固定值，沒有"+L補正"

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
  // 2026-09-08使用者明確要求「隊友資訊等平常不顯示接管，按下選單才切換顯示」：每個席位
  // 各自一個開關，預設不顯示接管按鈕，只有點了該卡片的「⋯」才展開；純本地端UI狀態，
  // 不需要同步到RTDB。
  // 2026-09-08使用者明確要求「上方打字機資訊欄右上有一個'-'可以暫時折疊單條線，同時
  // 在右上盧恩左邊出現展開鈕可以再次打開，有按鈕能按時兩者都閃黃光」：這裡指的是
  // #midnight-field-enter-prompt／#midnight-field-invite-prompt／#midnight-field-banner／
  // #midnight-field-late-join-prompt／#midnight-field-late-claim-prompt／
  // #midnight-strong-enemy-banner／#midnight-scarab-banner這組固定在畫面最上方、
  // 互斥顯示（同時間只有一個會出現）的地點卡牌／籌碼banner。純本地端UI狀態，不同步。
  var topBannerCollapsed = false;
  // 2026-09-08新增：#midnight-hud（day/phase文字＋操作提示的頂部資訊欄）收合狀態，純
  // 本地端UI狀態，不同步——使用者明確規格「縮小時，僅縮成一條薄線 且圖層順序放在最後」。
  var hudInfoBarCollapsed = false;
  var TOP_BANNER_IDS = [
    "midnight-field-enter-prompt",
    "midnight-field-invite-prompt",
    "midnight-field-banner",
    "midnight-field-late-join-prompt",
    "midnight-field-late-claim-prompt",
    "midnight-strong-enemy-banner",
    "midnight-scarab-banner",
    "midnight-battle-prep-banner", // 2026-09-09新增（戰鬥前置準備banner），同一組互斥顯示
    "midnight-rewards-lock-banner", // 2026-09-10新增（夜之強敵戰後「離去後才能開始行動」提示）
  ];

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
  // Task 15新增：c._bargainMaxHpBonus是取引「全力で戦いたい」良好效果的「自身最大HP：+□」
  // （設計文件§9-2換算為midnight數值+10），一次性疊加（見BARGAIN_DEAL_EFFECTS），不像
  // totalFlatMaxStatBonus那樣是既有三套bonus系統（CLAUDE.md §12）的一部分，因此不透過該
  // helper計算、直接加在最外層——跟rulebook原文「最大HP：+□」是flat加成（不是×10乘法對象）
  // 一致，只有既有hp.max/totalFlatMaxStatBonus那組才會被×10。未套用此取引效果時
  // （c._bargainMaxHpBonus為0/undefined）回傳值與修改前完全相同。
  function selfArenaHpMax(c) {
    if (!c || !c.hp) return 100;
    return 100 + (c.hp.max + CharacterDrawer.totalFlatMaxStatBonus(c, "hp")) * 10 + (c._bargainMaxHpBonus || 0);
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
  // meta.mapVariant："basic"固定用origin地形；"full"則在開局那一刻（見onMetaReceived()的
  // variantMapGenerated處理）用meta.mapSeed決定性抽一張——使用者明確規格「選擇完整版則
  // 會有80%從中抽出一張」，實際抽選機率邏輯在midnight_map_variants.jsのpickVariantId()。----
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
    var difficultySelect = el("midnight-lobby-difficulty-select");
    if (difficultySelect && document.activeElement !== difficultySelect) {
      difficultySelect.value = (meta && meta.difficulty) || "standard";
    }
  }

  function handleNightBossSelectChange() {
    GameStorage.rtSet(gameId, "cloud", "meta/nightBossId", el("midnight-lobby-night-boss-select").value);
  }

  // 難度（2026-09-08新增，見midnight_page.pyの#midnight-lobby-difficulty-row說明）：跟夜王/
  // 地圖同一套「同一場遊戲所有人共用」模式，開局後理論上還能改，但實務上只在等待房顯示
  // 這個下拉選單（跟夜王/地圖UI一致），不特別鎖定。
  function handleDifficultySelectChange() {
    GameStorage.rtSet(gameId, "cloud", "meta/difficulty", el("midnight-lobby-difficulty-select").value);
  }

  function handleMapVariantSelectChange() {
    GameStorage.rtSet(gameId, "cloud", "meta/mapVariant", el("midnight-lobby-map-variant-select").value);
  }

  // ---- 測試模式（2026-09-06新增，使用者明確規格：「開始遊戲可以選擇測試模式，在右邊
  // 可以顯示敵我傷害資訊，甚至可以手動拉條來改變傷害值」）：meta.testMode／
  // meta.testTuning皆透過RTDB同步，同一場遊戲所有人共用同一組開關/倍率（跟本專案既有
  // 「持有gameId即可存取」的權限模型一致，CLAUDE.md §38，不做額外的房主限定）。----
  var lastPcDamageInfo = null; // {amount, at}，本地only，供測試面板顯示
  var lastEnemyDamageInfo = null; // {amount, at}，本地only
  var testConsoleOpen = false; // 本地only：測試主控台面板開關，不透過meta.testMode控制常駐顯示

  // 測試模式密碼閘門（2026-09-09新增，使用者明確規格：「按下測試模式按鍵需要輸入密碼
  // nightnight」）：只有「開啟」需要密碼，關閉不用。答錯/取消時checkbox要復原成未勾選，
  // 否則畫面會顯示已勾選但meta.testMode其實沒被寫入true，造成UI與實際狀態不一致。
  function handleTestModeToggle() {
    var checkbox = el("midnight-lobby-test-mode-checkbox");
    var checked = checkbox.checked;
    if (!checked) {
      GameStorage.rtSet(gameId, "cloud", "meta/testMode", false);
      return;
    }
    var input = window.prompt(window.I18N.t("midnight_test_mode_password_prompt"));
    if (input !== "nightnight") {
      checkbox.checked = false;
      return;
    }
    GameStorage.rtSet(gameId, "cloud", "meta/testMode", true);
  }

  // 流程簡介視窗（使用者明確規格「打開後播放打字機直到按下右上X」）：純本地端展示，不寫
  // 任何共享state，開/關只影響自己這台裝置畫面。用night_gm_flow.jsの既有typewriteInto()，
  // 不另外寫第二套打字機邏輯（CLAUDE.md §10重用原則）。
  function handleFlowIntroOpenClick() {
    var modal = el("midnight-flow-intro-modal");
    if (!modal) return;
    modal.hidden = false;
    var GmFlow = window.PriTestNightGmFlow;
    var textEl = el("midnight-flow-intro-text");
    if (GmFlow && textEl) {
      GmFlow.typewriteInto(textEl, window.I18N.t("midnight_flow_intro_text"), { chunkSize: 3, intervalMs: 18 });
    } else if (textEl) {
      textEl.textContent = window.I18N.t("midnight_flow_intro_text");
    }
  }

  function handleFlowIntroCloseClick() {
    var modal = el("midnight-flow-intro-modal");
    if (modal) modal.hidden = true;
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
    var openBtn = el("btn-midnight-open-test-console");
    if (openBtn) openBtn.hidden = !enabled;
    if (!enabled) testConsoleOpen = false; // 測試模式被關掉時，順便收掉還開著的主控台
    var panel = el("midnight-test-panel");
    if (!panel) return;
    panel.hidden = !(enabled && testConsoleOpen);
    if (!enabled || !testConsoleOpen) return;
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

  // =====================================================================
  // Debug面板（2026-09-08新增於private/main，使用者明確規格：「debug模式下可以調整盧恩,
  // 獲得指定武器,設定個別戰技魔術祈禱,回復滿FP,復歸並回復滿HP,快速通過魔術師塔」）：
  // 2026-09-09合併——原本獨立的meta.debugMode房間開關已與測試模式合併為同一顆按鈕
  // （meta.testMode，見handleTestModeToggle()），這裡改為跟#midnight-test-panel同一套
  // testConsoleOpen選單開關控制顯示（見renderDebugPanel()），所有操作只作用在「自己目前
  // 操作的角色」（myTokenId），不是給GM調整別人角色的工具。
  // =====================================================================
  var debugWeaponSelectPopulated = false;
  function populateDebugWeaponSelect() {
    var select = el("midnight-debug-weapon-select");
    if (!select || debugWeaponSelectPopulated || !window.PriTestWeapons) return;
    debugWeaponSelectPopulated = true;
    window.PriTestWeapons.list().forEach(function (w) {
      var o = document.createElement("option");
      o.value = w.id;
      o.textContent = window.PriTestWeapons.localizedText(w.name) + "（" + w.category + "）";
      select.appendChild(o);
    });
  }

  function renderDebugPanel() {
    var panel = el("midnight-debug-panel");
    if (!panel) return;
    var enabled = !!(meta && meta.testMode && testConsoleOpen);
    panel.hidden = !enabled;
    if (!enabled) return;
    populateDebugWeaponSelect();
  }

  // 調整盧恩：直接set成輸入框裡的數字（不是加減），對象固定是自己目前操作的角色。
  function handleDebugSetRune() {
    if (!myTokenId) return;
    var v = Math.max(0, Math.round(parseFloat(el("midnight-debug-rune-input").value) || 0));
    GameStorage.rtSet(gameId, "cloud", "character/" + myTokenId + "/runes", v);
  }

  // 獲得指定武器：直接push進weaponIds（跟merchant鍛造既有寫入路徑一致，不重新發明）。
  function handleDebugGrantWeapon() {
    if (!myTokenId) return;
    var weaponId = el("midnight-debug-weapon-select").value;
    if (!weaponId) return;
    GameStorage.rtTransaction(gameId, "cloud", "character/" + myTokenId + "/weaponIds", function (cur) {
      var list = (cur || []).slice();
      list.push(weaponId);
      return list;
    });
  }

  // 設定個別戰技/魔術/祈禱：規則書本身的武器技能是「category對應隨機表」抽選，沒有讓玩家
  // 直接指定任意一個結果的既有機制——與其另外發明第二套「自由選擇」picker，這裡重用既有
  // 鍛造台重骰UI（openWeaponRerollModal），灌5次免費重骰額度讓debug使用者自行開鍛造台
  // 重骰到滿意的結果為止（見docs：CLAUDE.md §11「優先重用現有helper」）。
  function handleDebugGrantRerollCredits() {
    if (!myTokenId) return;
    var c = characters[myTokenId];
    // 樂觀更新本地鏡像（跟cycleEquippedWeapon()同樣的既有慣例）：RTDB回傳前先讓
    // openWeaponRerollModal()的credits>0判斷讀得到新值，避免round-trip delay導致
    // 第一次點擊時modal因為讀到舊值(0)而不開。
    if (c) c._weaponRerollCredits = (c._weaponRerollCredits || 0) + 5;
    GameStorage.rtTransaction(gameId, "cloud", "character/" + myTokenId + "/_weaponRerollCredits", function (cur) {
      return (cur || 0) + 5;
    });
    openWeaponRerollModal();
  }

  function handleDebugFullFp() {
    fp.current = fp.max;
  }

  // 復歸並回復滿HP：若自己正在瀕死中先清空nearDeath，否則單純直接回滿血（不受平常
  // 「隊友復歸傷害只回一半」限制，這是debug強制操作）。
  function handleDebugReviveFullHp() {
    if (!myTokenId) return;
    var c = characters[myTokenId];
    if (c && c.nearDeath && c.nearDeath.active) {
      GameStorage.rtSet(gameId, "cloud", "character/" + myTokenId + "/nearDeath", null);
      finishRevive(myTokenId, true);
    } else {
      GameStorage.rtSet(gameId, "cloud", "demoStat/" + myTokenId, selfArenaHpMax(c));
    }
  }

  // 快速通過魔術師塔：直接呼叫既有解謎成功的處理函式（handleTowerPuzzleResult），跳過
  // 實際答題，獎勵流程（12骰牌型獎勵等）完全比照正常解謎成功路徑，不另外簡化。
  function handleDebugSkipTower() {
    if (!nearbyTower || towerSolved[nearbyTower.id]) return;
    handleTowerPuzzleResult(nearbyTower, true);
  }

  var remotePings = {}; // tokenId -> { x, y, name, createdAt }（來自RTDB）
  // tokenId -> 完整CharacterDrawer.newCharacter()同形狀角色物件（含runes），外加midnight
  // 原本就有的flaskCount/flaskMax欄位（沿用原本命名，只是併到同一個RTDB物件底下，不是
  // 另開一份，見onCharactersReceived／規劃紀錄「角色屬性管理」章節的設計取捨）。
  var characters = {};
  var towerSolved = {}; // pointId -> { solvedBy }（來自RTDB，見onTowerSolvedReceived）
  var towerPuzzleState = {}; // pointId -> { puzzle, pointId }（本地only，2026-09-07新增：6種參數化謎題，見startTowerPuzzle）
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
  var consumableThrowEffectTimer = null;
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
  // 2026-09-08使用者明確規格「鍛造台戰技重抽為鍛造村的獎勵...在離開鍛造村範圍後直接歸0
  // 無法使用」：鍛造村是card==="8"的一般地點卡（見midnight_map.jsのFIELD_CARD_NAMES），
  // 就是nearbyFieldPoint其中一種，這裡只是額外標記「目前這個nearbyFieldPoint是不是鍛造村」，
  // 供renderWeaponRerollOpenButton()判斷可見性、以及離開時歸零點數，見updateNearbyFieldPoint()。
  var nearbySmithingVillage = null;
  // 中途加入（設計文件§1.4）：附近有fieldTrigger、但自己尚未在participants裡的地圖點，
  // 且已經過了邀請階段（status!=="inviting"，邀請階段有自己的「加入」流程，見
  // handleAcceptFieldInviteClick）。由updateNearbyFieldPoint()逐frame判斷，見
  // handleLateJoinFieldClick／renderFieldOverlay()的「參加探索」按鈕。
  var nearbyLateJoinPoint = null;
  // 後補領獎（設計文件§1.5）：自己從未加入過、但這個點已留有一次性內容的過去發放紀錄
  // （板塊樓層看fieldProgress、強敵/隨機事件看fieldTrigger自己的resolved+HP歸零），
  // 由updateNearbyFieldPoint()逐frame判斷，見handleLateClaimClick／renderFieldOverlay()的
  // 「領取獎勵」按鈕。跟nearbyLateJoinPoint的互斥規則見updateNearbyFieldPoint()內部註解。
  var nearbyLateClaimPoint = null;
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
  var BATTLE_PREP_DURATION_MS = 5000; // 使用者明確規格：識別資訊+讀條共5秒
  var battlePrepCandidate = null; // 目前正在跑5秒準備流程的encounter candidate
  var battlePrepUntil = null; // 準備流程結束時間戳；null代表沒有正在準備
  var fieldEnterAttempted = {}; // pointId -> true（本地節流：按下「進入」的transaction只送一次）
  var fieldInviteResolveAttempted = {}; // pointId -> true（本地節流：inviting→active的transaction只送一次）
  var fieldTypewriterStartedFor = {}; // pointId -> true（本地旗標：這個點的打字機動畫只啟動一次）
  var fieldTypewriterDoneFor = {}; // pointId -> true（本地旗標：打字機播完、可以顯示投票選項了）
  // 2026-09-08使用者明確規格「打字機打完樓層敘述後 若為自動選擇的 須停止3秒 才會自動選擇
  // 下一步」：只有labels.length<=1（不需要投票、系統直接決定）的分支才會用到，見
  // maybeResolveFieldVote()。本地端each device各自的打字機播完時間戳，不需要RTDB同步
  // （跟fieldTypewriterStartedFor同一種「各裝置各自本地計時」既有模式）。
  var fieldTypewriterDoneAt = {}; // pointId -> Date.now()（打字機真正播完的時間點）
  var FIELD_AUTO_SELECT_DELAY_MS = 3000;
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
  // ---- Task 20新增：隨機事件籌碼（設計文件§8.1-8.2）本地節流旗標 ----
  var randomEventRollAttempted = {}; // pointId -> true（本地節流：隨機事件決定表只送一次transaction）
  var meteorEnemyAssignAttempted = {}; // pointId -> true（本地節流：隕石王戰敵人指派只送一次transaction）
  var meteorRewardAttempted = {}; // pointId -> true（本地節流：隕石撃破獎勵只送一次transaction）
  // Task 22新增：「襲撃」分支（忌み鬼／兆し／調律の魔物戦いを仕掛ける分支）敵人指派/撃破
  // 獎勵的本地節流旗標，同meteorEnemyAssignAttempted/meteorRewardAttempted既有寫法。
  var ambushEnemyAssignAttempted = {}; // pointId -> true
  var ambushRewardAttempted = {}; // pointId -> true
  // final review指摘修正：renderAmbushBranch()自己的初次決定表roll漏了本地節流旗標，
  // 同ambushEnemyAssignAttempted/randomEventRollAttempted既有idiom補上。
  var ambushRollAttempted = {}; // pointId -> true
  var tuningDemonBargainOpened = {}; // pointId -> true（本地節流：調律の魔物「取引に応じる」的取引揭曉modal，每台裝置只主動開一次，避免render tick每偵重複呼叫openBargainRevealModal()把使用者剛關閉的modal又打開）
  // Task 18新增：2日目「⑧恐るべき強敵」點位決定的本地節流旗標（跟day3TriggerAttempted等
  // 同一套pattern）——每台裝置只嘗試送一次meta/terrifyingStrongEnemyPointId transaction，
  // 見maybeAssignTerrifyingStrongEnemyPoint()說明（該函式掛在updateAutoDayAdvance()裡，
  // 每偵都會被呼叫，若不用這個旗標擋住，「3個點在Day1就已全數擊敗」的null結果會因為
  // Firebase transaction對某路徑寫入null等同刪除該節點、之後永遠讀不到「已決定」痕跡，
  // 而被每偵重複呼叫）。
  var terrifyingStrongEnemyAssignAttempted = false;
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
  var keysDown = {};
  var lastFrameTime = null;
  var lastPosPushTime = 0;
  var lastPushedPos = null;
  var lastDamageTickTime = 0;
  // 2026-09-08使用者明確規格「待在夜雨縮圈範圍外隨時間越扣越多HP：10秒內1s:1點，11~20秒
  // 1s:2點，21~30秒1s:4點，30秒後1s:8點」：null＝目前在圈內（或剛進遊戲還沒判定過），
  // 否則是「這一段連續待在圈外」開始的時間戳，一旦回到圈內就重置，重新出去要重新計時。
  var outsideCircleSinceMs = null;
  var lastDayPhaseKey = null; // 偵測phase切換用（day+phase字串），切換時重新render HUD文字
  var canvas = null;
  var ctx = null;
  // 小地圖（2026-09-06新增，見#midnight-minimap-canvas的HTML註解）：跟主canvas共用同一份
  // 畫面內容，render()結尾把主canvas整張縮小畫進來，不重複執行地圖繪製邏輯。
  var minimapCanvas = null;
  var minimapCtx = null;
  // 「完整版」4張新地圖各自的原畫背景（2026-09-10新增，見midnight_map_variants.js）：
  // 跟origin地圖同一種畫法（render()直接把整張原畫畫成canvas背景，見下方
  // MAP_BACKGROUND_IMAGES／currentMapImage()），不是額外疊加濾鏡或色調轉換模擬「這是
  // 另一張地圖」，使用者已經提供這4張圖各自完整的原畫素材（static_src/images/maps/
  // map_{cassel,ice,kasan,red}.jpg，複製自photo/midnight/同名非標註版）。
  var MAP_BACKGROUND_IMAGES = {
    basic: new Image(),
    cassel: new Image(),
    ice: new Image(),
    kasan: new Image(),
    red: new Image(),
  };
  MAP_BACKGROUND_IMAGES.basic.src = "../static/images/maps/map_origin.jpg";
  MAP_BACKGROUND_IMAGES.cassel.src = "../static/images/maps/map_cassel.jpg";
  MAP_BACKGROUND_IMAGES.ice.src = "../static/images/maps/map_ice.jpg";
  MAP_BACKGROUND_IMAGES.kasan.src = "../static/images/maps/map_kasan.jpg";
  MAP_BACKGROUND_IMAGES.red.src = "../static/images/maps/map_red.jpg";

  function currentMapImage() {
    var variantId = map && map.variantId;
    return MAP_BACKGROUND_IMAGES[variantId] || MAP_BACKGROUND_IMAGES.basic;
  }

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

  // ---- 規則文本轉換（2026-09-10使用者明確規格「詳細資訊中的原本文本，盡量改換成應用在
  // 本規則內能夠讀懂的文本」）：實際的轉換表在static/midnight_text_adapt.js（純字串函式，
  // 見該檔開頭的完整說明）。這裡只是薄包裝，模組沒載入時原樣回傳，不讓詳細視窗整個壞掉。
  //
  // **只能用在「要顯示給玩家看的那一刻」**：computeMidnightSkillCost()／
  // computeMidnightSkillDamage()／CharacterDrawer.parseActionCost()等解析函式吃的都是規則書
  // 原文的既有pattern（「骰子消耗：3」「HP回復：□□」等），餵轉換後的字串進去會直接失配，
  // 導致消耗/傷害算錯。因此所有呼叫端一律維持「原始字串給計算、mnText()只給textContent」。
  function mnText(body, name) {
    var Adapt = window.PriTestMidnightTextAdapt;
    return Adapt ? Adapt.adapt(body, name) : body;
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
  // fix：地圖選單（meta.mapVariant）是等待房內可隨時調整的設定，但原本這裡在「第一次收到
  // meta」那一刻（通常是房主剛建立房間、都還沒機會選地圖之前）就用meta.mapVariant產生
  // map，之後isFirstTime guard讓它終身不會重算——等於「完整版」選單就算選了也完全沒有
  // 效果（地圖已經生成成basic了）。跟meta.resolvedNightBossId同一套既有模式（見
  // maybeTriggerSessionStart()）：開局那一刻才是設定真正「鎖定」的時間點，這裡改成用
  // variantMapGenerated旗標，在sessionStartAt真正出現的那一次額外重新產生一次map（讀
  // 這時候meta.mapVariant的最終值），取代isFirstTime那次用basic產生的暫時版本——等待房
  // 階段本來就只需要map.dayPlan.day1.start這類佔位資訊供角色出生點使用，不受影響。
  var variantMapGenerated = false;
  function onMetaReceived(value) {
    if (!value) return;
    var isFirstTime = !meta;
    meta = value;
    if (isFirstTime) {
      map = Map_.generateMap(meta.mapSeed, "basic");
      el("midnight-start-screen").hidden = true;
      startLoop();
    }
    if (!variantMapGenerated && meta.sessionStartAt) {
      variantMapGenerated = true;
      map = Map_.generateMap(meta.mapSeed, meta.mapVariant);
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
  var lastSharedItemEffectAt = null; // 本地only：同款，供「道具效果擴大」廣播的消耗品效果去重（見applyItemEffectExpand()）

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
    // 「道具效果擴大」廣播來的消耗品效果（見applyItemEffectExpand()）：由收到的這台裝置
    // 自己套用，才能真的動到FP/體力/本地buff。用時間戳比對避免重複套用。
    if (mine && mine._sharedItemEffect && mine._sharedItemEffect.itemId) {
      if (lastSharedItemEffectAt !== null && mine._sharedItemEffect.at !== lastSharedItemEffectAt) {
        applyMidnightConsumableEffect(mine, mine._sharedItemEffect.itemId);
        var sharedItem = window.PriTestConsumables.get(mine._sharedItemEffect.itemId);
        if (sharedItem) showToast(window.I18N.t("midnight_item_expand_received_toast", { item: window.PriTestConsumables.localizedText(sharedItem.name) }));
      }
      lastSharedItemEffectAt = mine._sharedItemEffect.at;
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
      // 2026-09-08修正：weaponIds[1]（追蹤者/守護者等有startingShieldId的類型才會有）是
      // 左手盾，右手固定放主武器；沒有第二件裝備的類型維持原行為（左右手都放同一把）。
      var startingShieldId = mine.weaponIds.length > 1 ? mine.weaponIds[1] : startingWeaponId;
      mine.equippedWeaponIdL = startingShieldId;
      mine.equippedWeaponIdR = startingWeaponId;
      GameStorage.rtSet(gameId, "cloud", "character/" + myTokenId + "/equippedWeaponIdL", startingShieldId);
      GameStorage.rtSet(gameId, "cloud", "character/" + myTokenId + "/equippedWeaponIdR", startingWeaponId);
      syncEquippedWeaponIds(mine);
    }
    renderCharPanel();
    renderCharacterSheet();
    // 2026-09-10修復（使用者回報「瀕死被救起時…」實際上是根本救不起來）：瀕死狀態存在
    // character/{tokenId}/nearDeath，但顯示⚠警示／復歸倒扣條／隊友用的[指定]按鈕的
    // renderOccupiedSlotCard()只由renderLobby()／renderPlayersPanel()呼叫，而這裡原本
    // 沒有重繪席位面板。HP歸零的流程是「demoStat transaction commit →.then()→
    // maybeTriggerNearDeath()寫nearDeath」，兩筆是分開的寫入且順序固定，因此
    // onDemoStatsReceived()那次重繪一定發生在nearDeath抵達之前——結果是隊友畫面上
    // 永遠不會長出[指定]按鈕（除非剛好有別人受傷觸發另一次demoStat變動），瀕死者
    // 只能等15秒逾時強制復歸（會被傳送到最近祝福點、脫離戰鬥）。
    // 補上這一行後，nearDeath的出現/progress累積/清除都會即時反映在席位卡片上。
    // 重繪成本跟onDemoStatsReceived()既有的同一支呼叫相同（只重建3張卡片），
    // lobby階段沿用onPlayersReceived()既有的「未開局就渲染lobby」分流寫法。
    if (meta && meta.sessionStartAt) renderPlayersPanel();
    else renderLobby();
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
    // 共享獎勵池（Task 14b）：其他玩家領走／新的共享獎勵被推入時要跟著重繪，
    // 跟onPendingRewardsReceived()呼叫renderRewardModal()是同一個既有pattern。
    renderRewardModal();
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
      el("midnight-lobby-character-detail").hidden = true;
    }
  }

  // 2026-09-08使用者明確規格「左上隊伍資訊每個人為兩排：第一排名稱與腳色，第二排血量」：
  // card本身改成column排列，row1（色點＋名稱＋交管按鈕）／row2（血量條，含召喚靈體條）
  // 各自是獨立的flex row，取代先前全部塞在同一行的寫法。近死警示badge/戰鬥動作提示泡泡
  // 仍是絕對定位疊加在card上，不受兩排排版影響。
  function renderOccupiedSlotCard(card, slot, p) {
    var row1 = document.createElement("div");
    row1.className = "midnight-slot-row midnight-slot-row1";
    card.appendChild(row1);

    var dot = document.createElement("span");
    dot.className = "midnight-slot-color-dot";
    dot.style.background = characterColor(p.characterId);
    row1.appendChild(dot);

    var nameSpan = document.createElement("span");
    nameSpan.className = "midnight-slot-name";
    var charLabel = characterName(p.characterId);
    nameSpan.textContent =
      p.name + "（" + charLabel + "）" + (p.tokenId === myTokenId ? " " + window.I18N.t("midnight_takeover_self_note") : "") + (p.ready ? " ✓" : "");
    row1.appendChild(nameSpan);

    var row2 = document.createElement("div");
    row2.className = "midnight-slot-row midnight-slot-row2";
    card.appendChild(row2);

    // 其他玩家的血量條：只有進場後（demoStats已經有資料）才有意義，等待房階段demoStats
    // 通常還是空的，這裡直接讀undefined時視為滿血顯示。HP上限已不是固定100（見
    // selfArenaHpMax()），改用百分比換算血條寬度。
    var hpMaxForSlot = selfArenaHpMax(characters[p.tokenId]);
    var hpVal = demoStats[p.tokenId];
    var hpValNum = hpVal === undefined ? hpMaxForSlot : hpVal;
    var hpTrack = document.createElement("span");
    hpTrack.className = "midnight-bar-track midnight-bar-track-sm midnight-slot-hp";
    // 2026-09-08使用者明確規格「有玩家瀕死時 同步顯示其復歸條進度於hp血條中 並使用淺藍色
    // （滿條時開始對其造成復歸，復歸後改為正常血量條），瀕死玩家顯示的復歸進度也為倒扣
    // 方式 120/120 -> 0/120」：nearDeath.progress內部是「已經累積的復歸傷害」由0往上加到
    // required（見maybeTriggerNearDeath()/finishRevive()），這裡只是顯示轉換──顯示值＝
    // required-progress，讓畫面看起來是從required（例如120/120）倒數到0/120，數字歸零＝
    // 已達成復歸條件（不是這裡觸發實際復歸，實際復歸邏輯已在別處由progress>=required判斷）。
    var ndForBar = characters[p.tokenId] && characters[p.tokenId].nearDeath;
    var ndValueEl = null;
    if (ndForBar && ndForBar.active) {
      var ndRequired = ndForBar.required || 1;
      var ndRemaining = Math.max(0, ndRequired - (ndForBar.progress || 0));
      var ndFill = document.createElement("span");
      ndFill.className = "midnight-bar-fill midnight-bar-revival";
      ndFill.style.width = Math.max(0, Math.min(100, (ndRemaining / ndRequired) * 100)) + "%";
      hpTrack.appendChild(ndFill);
      ndValueEl = document.createElement("span");
      ndValueEl.className = "midnight-slot-hp-value";
      ndValueEl.textContent = ndRemaining + "/" + ndRequired;
    } else {
      var hpFill = document.createElement("span");
      hpFill.className = "midnight-bar-fill midnight-bar-hp";
      hpFill.style.width = Math.max(0, Math.min(100, (hpValNum / hpMaxForSlot) * 100)) + "%";
      hpTrack.appendChild(hpFill);
    }
    row2.appendChild(hpTrack);
    if (ndValueEl) row2.appendChild(ndValueEl);

    // 復仇者「召喚靈體」血條（2026-09-08使用者明確要求「其血條資訊寫在左上復仇者玩家hud
    // 之下」）：跟自身/隊友HP條同一個文件流位置，只有目前有召喚靈體時才顯示，見
    // applyMidnightAbilityPostEffect()／updateSummonedSpirit()。
    var spirit = characters[p.tokenId] && characters[p.tokenId].summonedSpirit;
    if (spirit && spirit.maxHp) {
      var spiritTrack = document.createElement("span");
      spiritTrack.className = "midnight-bar-track midnight-bar-track-sm midnight-slot-hp";
      var spiritFill = document.createElement("span");
      spiritFill.className = "midnight-bar-fill midnight-bar-spirit";
      spiritFill.style.width = Math.max(0, Math.min(100, (spirit.hp / spirit.maxHp) * 100)) + "%";
      spiritTrack.appendChild(spiritFill);
      var spiritDef = null;
      for (var sdi = 0; sdi < SPIRIT_SUMMON_TYPES.length; sdi++) {
        if (SPIRIT_SUMMON_TYPES[sdi].kind === spirit.kind) {
          spiritDef = SPIRIT_SUMMON_TYPES[sdi];
          break;
        }
      }
      if (spiritDef) spiritTrack.title = window.I18N.t(spiritDef.nameKey);
      row2.appendChild(spiritTrack);
    }

    // 瀕死警示（2026-09-08新增，使用者明確規格「瀕死狀態的玩家圖示中閃爍黃色警示、當可以
    // 對其復歸傷害時顯示一個指定可按下」；2026-09-08再次明確要求「瀕死玩家的顏色點也閃
    // 黃色警訊圖示」，額外在dot本身疊一個⚠圖示，見style.cssの.midnight-slot-warning-badge）：
    // card本身每次render都是全新建立的元素（renderLobby()／renderPlayersPanel()的
    // innerHTML=""重繪），不需要額外remove。
    var nd = ndForBar;
    if (nd && nd.active) {
      card.classList.add("midnight-flash-yellow");
      var warningBadge = document.createElement("span");
      warningBadge.className = "midnight-slot-warning-badge";
      warningBadge.textContent = "⚠";
      dot.appendChild(warningBadge);
      if (p.tokenId !== myTokenId && isRevivalDamageEligible(p.tokenId)) {
        var designating = revivalDesignateTargetTokenId === p.tokenId;
        var designateBtn = document.createElement("button");
        designateBtn.type = "button";
        designateBtn.className = "midnight-slot-designate-btn" + (designating ? " midnight-slot-designate-active" : "");
        designateBtn.textContent = window.I18N.t(
          designating ? "midnight_near_death_cancel_designate_button" : "midnight_near_death_designate_button"
        );
        designateBtn.addEventListener("click", function (tokenIdForToggle) {
          return function () {
            toggleRevivalDesignate(tokenIdForToggle);
            renderLobby();
            renderPlayersPanel();
          };
        }(p.tokenId));
        card.appendChild(designateBtn);
      }
    }

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

    // 2026-09-08使用者明確規格「拿掉『⋯』選單、在自己右上的HUD主選單按下時才出現交管
    // （觀戰者直接能看到交管按鈕）」：取代先前per-slot「⋯」展開/收起的做法。觀戰者
    // （!mySlot，沒有控制任何席位）永遠直接看到交管按鈕；已經在控制某席位的玩家，只有
    // 打開#midnight-menu-panel（btn-midnight-toggle-menu，見bindInput()）這個HUD主選單時
    // 才會顯示，平時收起避免手機端隊友資訊列表被按鈕塞滿。
    if (p.tokenId !== myTokenId) {
      var menuPanel = el("midnight-menu-panel");
      var menuOpen = !!(menuPanel && !menuPanel.hidden);
      if (!mySlot || menuOpen) {
        var takeoverBtn = document.createElement("button");
        takeoverBtn.type = "button";
        takeoverBtn.textContent = window.I18N.t("midnight_takeover_button");
        takeoverBtn.addEventListener("click", function () {
          handleTakeover(slot);
        });
        row1.appendChild(takeoverBtn);
      }
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
        renderLobbyCharacterDetail(c.id);
      });
      picker.appendChild(wrap);
    });
  }

  // 角色詳細資訊視窗（2026-09-08新增，見midnight_page.pyの#midnight-lobby-character-detail
  // 說明）：CHARACTER_PRESETS的id跟character_types.js的typeId同名，直接查得到type。
  function renderLobbyCharacterDetail(characterId) {
    var panel = el("midnight-lobby-character-detail");
    if (!panel) return;
    var type = window.PriTestCharacterTypes.get(characterId);
    if (!type) return;
    var preset = findCharacterPreset(characterId);
    panel.hidden = false;
    var img = el("midnight-lobby-character-detail-image");
    img.src = characterImagePath(preset.image);
    img.alt = window.I18N.t(preset.nameKey);
    el("midnight-lobby-character-detail-name").textContent = window.I18N.t(preset.nameKey);
    el("midnight-lobby-character-detail-stats").textContent = CharacterDrawer.buildTypeStatLines(type, true).join("\n");
    CharacterDrawer.renderAbilitySections(
      null,
      type,
      el("midnight-lobby-character-detail-active"),
      el("midnight-lobby-character-detail-passive"),
      false,
      true
    );
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
        el("midnight-lobby-character-detail").hidden = true;
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
    performTakeover(slot, p);
  }

  // 2026-09-10除錯用抽出：接管席位的實際邏輯（原本全部塞在handleTakeover()裡），密碼驗證
  // 通過後才呼叫——window.PriTestMidnight._debugTakeover()測試用途需要跳過window.prompt()
  // （瀏覽器自動化工具會被原生prompt卡住），直接重用這段邏輯，不重新複製一份。
  function performTakeover(slot, p) {
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
    el("btn-midnight-execution").addEventListener("click", handleExecutionClick);
    el("btn-midnight-spirit-manage").addEventListener("click", handleSpiritManageClick);
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
    el("btn-midnight-open-weapon-reroll").addEventListener("click", openWeaponRerollModal);
    el("btn-midnight-weapon-reroll-use").addEventListener("click", handleWeaponRerollUseClick);
    el("btn-midnight-weapon-reroll-apply").addEventListener("click", handleWeaponRerollApplyClick);
    el("btn-midnight-weapon-reroll-keep-leave").addEventListener("click", handleWeaponRerollKeepAndLeaveClick);
    el("btn-midnight-bargain-close").addEventListener("click", closeBargainModal);
    el("btn-midnight-toggle-menu").addEventListener("click", function () {
      var panel = el("midnight-menu-panel");
      panel.hidden = !panel.hidden;
      // 2026-09-08新增：交管按鈕的顯示與否跟這個選單開關狀態連動（見renderOccupiedSlotCard()），
      // 開關當下要立即重繪隊友卡片，不能等下一次其他事件觸發render才更新。
      renderPlayersPanel();
    });
    el("btn-midnight-pause-game").addEventListener("click", handlePauseGame);
    el("btn-midnight-resume-game").addEventListener("click", handleResumeGame);
    // 上方地點卡牌／籌碼banner折疊：每個banner各自有一顆同款「－」按鈕，共用同一個
    // click handler（同一時間只會有一個banner顯示，不需要區分是哪一顆按的）。
    Array.prototype.forEach.call(document.querySelectorAll(".midnight-top-banner-collapse-btn"), function (btn) {
      btn.addEventListener("click", function () {
        topBannerCollapsed = true;
        updateTopBannerCollapseUI();
      });
    });
    el("btn-midnight-top-banner-reopen").addEventListener("click", function () {
      topBannerCollapsed = false;
      updateTopBannerCollapseUI();
    });
    // 點左上角色HUD／右上導覽HUD時暫時蓋過上方樓層資訊banner（見bumpHudAboveBanner()）。
    // 用capture階段的listener掛在整個角落容器上，而不是逐顆按鈕綁——這兩塊的內容（隊友
    // 卡片、按鈕列、測試模式面板）都是JS動態重繪的，逐顆綁會在每次render後失效。
    ["midnight-hud-top-left", "midnight-hud-top-right"].forEach(function (id) {
      var hudEl = el(id);
      if (hudEl) hudEl.addEventListener("pointerdown", bumpHudAboveBanner, true);
    });
    el("btn-midnight-hud-collapse").addEventListener("click", function () {
      hudInfoBarCollapsed = !hudInfoBarCollapsed;
      el("midnight-hud").classList.toggle("midnight-hud-collapsed", hudInfoBarCollapsed);
    });
    el("btn-midnight-lobby-join").addEventListener("click", handleLobbyJoin);
    el("btn-midnight-lobby-character-detail-close").addEventListener("click", function () {
      el("midnight-lobby-character-detail").hidden = true;
    });
    el("btn-midnight-lobby-ready").addEventListener("click", handleLobbyReadyToggle);
    el("btn-midnight-lobby-leave").addEventListener("click", handleLobbyLeave);
    el("midnight-lobby-night-boss-select").addEventListener("change", handleNightBossSelectChange);
    el("midnight-lobby-map-variant-select").addEventListener("change", handleMapVariantSelectChange);
    el("midnight-lobby-difficulty-select").addEventListener("change", handleDifficultySelectChange);
    el("btn-midnight-game-failure-confirm").addEventListener("click", switchToUnlimitedMode);
    el("btn-midnight-game-victory-confirm").addEventListener("click", handleGameVictoryConfirmClick);
    el("midnight-lobby-test-mode-checkbox").addEventListener("change", handleTestModeToggle);
    el("btn-midnight-flow-intro-open").addEventListener("click", handleFlowIntroOpenClick);
    el("btn-midnight-flow-intro-close").addEventListener("click", handleFlowIntroCloseClick);
    el("btn-midnight-open-test-console").addEventListener("click", function () {
      testConsoleOpen = true;
      renderTestPanel();
    });
    el("btn-midnight-test-panel-close").addEventListener("click", function () {
      testConsoleOpen = false;
      renderTestPanel();
    });
    el("btn-midnight-test-force-shrink").addEventListener("click", handleForceShrinkClick);
    // 2026-09-09合併：原本private/main有獨立的「Debug模式」checkbox(meta.debugMode)，
    // 使用者明確要求跟測試模式合併為一顆按鈕(meta.testMode)，這裡只保留debug面板本身
    // 各按鈕的綁定，checkbox本體與handleDebugModeToggle()已移除，見renderDebugPanel()
    // 改讀meta.testMode。
    el("btn-midnight-debug-set-rune").addEventListener("click", handleDebugSetRune);
    el("btn-midnight-debug-grant-weapon").addEventListener("click", handleDebugGrantWeapon);
    el("btn-midnight-debug-reroll-credits").addEventListener("click", handleDebugGrantRerollCredits);
    el("btn-midnight-debug-full-fp").addEventListener("click", handleDebugFullFp);
    el("btn-midnight-debug-revive-full-hp").addEventListener("click", handleDebugReviveFullHp);
    el("btn-midnight-debug-skip-tower").addEventListener("click", handleDebugSkipTower);
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
  // L補（使用者明確規格）：這隻敵人若在指派當下有套用L補正（trig.lBonus，見
  // maybeAssignFieldEnemy()/rollAndAssignStrongEnemy()/renderAmbushBossBranch()），直接把
  // L值加到現在的Guard Point上，上限夾在guardMax（種族本身資料定義的防禦次數上限，
  // 也是guardValueTable實際有列的最高count）——guardMax本身沒有被L補正墊高，效果是
  // 「更難把Guard Point打到低於原本上限」，而不是讓Guard Point超過種族原本的資料範圍
  // （避免guardValueForCount()查到guardValueTable沒有定義的count而回傳null）。
  function currentGuardCountForTrig(trig, guardMax) {
    if (!trig) return guardMax;
    // 體崩中（2026-09-11，使用者明確規格「此期間敵人的防禦次數皆以最低計算」）：
    // Guard Point一律視為0，對應guardValueTable裡最低的HP價值＝減傷最少。
    // 放在最前面，優先於guardBrokenAt與lBonus（體崩期間不受L補正墊高）。
    if (staggerActiveForTrig(trig)) return 0;
    var brokenAt = trig.guardBrokenAt || null;
    if (brokenAt) return Date.now() - brokenAt >= GUARD_BREAK_RECOVER_MS ? guardMax : 0;
    var units = trig.guardUnits || 0;
    var reduceBy = Math.floor(units / (GUARD_REDUCTION_THRESHOLD * 2));
    var base = Math.max(0, guardMax - reduceBy);
    return Math.min(guardMax, base + (trig.lBonus || 0));
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
  // Task 15新增：meta.day3BossHpBonusRaw是取引「全力で戦いたい」不良效果的「夜の王のすべての
  // HPライン：+□□」（設計文件§9-2換算為midnight數值+20，多名PC各自套用此不良效果時用
  // rtTransaction累積加總，見BARGAIN_DEAL_EFFECTS）。rulebook原文是「未乘上倍率的HP+20」，
  // 因此加在×10乘法之前的box總和上（跟一般hpBoxes格數同一個乘法基準），不是加在最終結果
  // 之後。未套用此取引效果時（meta.day3BossHpBonusRaw為0/undefined）計算結果與修改前完全
  // 相同。
  function bossHpMax(bossId) {
    var boss = bossRulebookData(bossId);
    var total = 0;
    (boss && boss.hpBoxes ? boss.hpBoxes : []).forEach(function (n) {
      total += n || 0;
    });
    var totalWithBargainBonus = (total || FIELD_ENEMY_HP_FALLBACK) + ((meta && meta.day3BossHpBonusRaw) || 0);
    // 2026-09-08使用者明確規格「敵人血量增加10倍」：在既有×10換算慣例上再乘10（＝×100），
    // 全部敵人類型（雜兵/夜之強敵/夜王）都套用，見enemyRealHpMax()／MOB_HP_PER_ROW同筆修改。
    return Math.round(totalWithBargainBonus * 100 * testMult("enemyHpMult"));
  }

  // ---- 敵人「體崩」狀態（2026-09-11新增，使用者明確規格）----
  // 累積來源：跟Guard Point下降同一份▲◆單位（▲=1／◆=2），但另外存一份
  // trig.staggerUnits——guardUnits會在破防5秒後被回復流程歸零，體崩累積不能跟著歸零，
  // 所以是獨立欄位。累積滿STAGGER_THRESHOLD_UNITS（36單位＝6次Guard Point下降，使用者
  // 明確選擇）就進入體崩：
  //   ・持續STAGGER_DURATION_MS（3秒）
  //   ・期間Guard Point一律以最低（0）計算 → HP價值最低 → 減傷最少（見
  //     currentGuardCountForTrig()的stagger分支）
  //   ・期間敵人不會發動任何攻擊（見maybeStartEnemyAttack()）
  //   ・敵人圖片上方顯示綠底「體崩中！！」（見renderFieldEncounterPanel()）
  // 加速：HP百分比「大於40%且小於60%」時累積×3（使用者明確規格，原則上一場戰鬥體崩1~2次）。
  // staggerSeq：每次進入體崩就+1，供「致命一擊」判斷「同一次體崩只能有一名PC按一次」
  // （見handleExecutionClick()），用序號而不是時間戳，避免多裝置時鐘差造成誤判。
  var STAGGER_THRESHOLD_UNITS = 36;
  var STAGGER_DURATION_MS = 3000;
  var STAGGER_ACCEL_MULT = 3;
  var STAGGER_ACCEL_HP_MIN_PCT = 40; // 大於40%
  var STAGGER_ACCEL_HP_MAX_PCT = 60; // 且小於60%

  function staggerActiveForTrig(trig, now) {
    return !!(trig && trig.staggerUntil && (now || Date.now()) < trig.staggerUntil);
  }

  function activeEncounterStaggering(now) {
    if (!activeEncounter) return false;
    return staggerActiveForTrig(fieldTriggers[activeEncounter.id], now);
  }

  // 目前HP百分比（0~100）；HP尚未寫入時視為滿血。
  function enemyHpPercent(pointId, trig) {
    var max = enemyRealHpMax(trig);
    if (!max) return 100;
    var cur = fieldEnemyHp[pointId];
    return ((cur === undefined ? max : cur) / max) * 100;
  }

  function staggerUnitsGain(pointId, trig, units) {
    var pct = enemyHpPercent(pointId, trig);
    return pct > STAGGER_ACCEL_HP_MIN_PCT && pct < STAGGER_ACCEL_HP_MAX_PCT ? units * STAGGER_ACCEL_MULT : units;
  }

  function recordGuardReductionForPoint(pointId, symbol) {
    var units = symbol === "◆" ? 2 : symbol === "▲" ? 1 : 0;
    if (!units) return;
    var trig = fieldTriggers[pointId];
    var fam = guardDataForTrig(trig);
    if (!fam || typeof fam.guardCount !== "number") return;
    var staggerGain = staggerUnitsGain(pointId, trig, units);
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
      // 體崩累積（見上方說明）：體崩進行中不再累積，避免3秒內把下一次也灌滿。
      var now = Date.now();
      if (!(out.staggerUntil && now < out.staggerUntil)) {
        var su = (out.staggerUnits || 0) + staggerGain;
        if (su >= STAGGER_THRESHOLD_UNITS) {
          out.staggerUnits = 0;
          out.staggerUntil = now + STAGGER_DURATION_MS;
          out.staggerSeq = (out.staggerSeq || 0) + 1;
          out.executionUsedSeq = null; // 新的一次體崩，致命一擊重新開放
        } else {
          out.staggerUnits = su;
        }
      }
      return out;
    });
  }

  // ============================================================================
  // 遺物效果（Passive）共同套用層（2026-09-11新增）
  // ============================================================================
  // 這一層只負責「查角色有沒有習得某個遺物效果」與「把加成算成數字」，實際注入點分散在
  // computeSideAttackInfo()／computeMidnightSkillDamage()／updateStamina()等既有計算處，
  // 不另外建立平行的傷害管線（CLAUDE.md §41「優先重用既有 helper／state／pipeline」）。
  // 名稱同時列 zh／ja 是因為 CharacterDrawer.findLearnedRelicEffectByName() 兩種都比對，
  // 而同一個效果在暗黑／黎明變體的本文措辭可能略有不同、名稱則一致。
  var RELIC = {
    flaskFp: ["聖杯瓶可回復FP", "聖杯瓶でFP回復可能"],
    flaskGulp: ["一口氣飲盡", "一気飲み"],
    skillUsesPlus1: ["技能使用次數＋1", "スキル使用回数＋1"],
    twoHandGuardBreak: ["雙手持握的削韌強化", "両手持ちのガード削り強化"],
    elementAccumPlus1: ["屬性蓄積值＋1", "属性蓄積値＋1"],
    elementJoy: ["屬性達成的歡喜", "属性達成の歓喜"],
    staminaLowRegen: ["回合結束時，體力骰帶入1個", "ターン終了時、スタミナダイス1個持ち越し"],
    staminaMaxPlus: ["防禦階段開始時體力骰回復", "ディフェンス開始時スタミナダイス回復"],
    staminaComboRecover: ["連續攻擊時體力回復", "攻撃連続時、スタミナ回復"],
    fpComboRecover: ["連續攻擊時FP回復", "攻撃連続時、FP回復"],
    rearGuardTactics: ["後衛戰術", "後衛戦術"],
    dualWieldMaster: ["雙刀持握的達人", "二刀持ちの達人"],
    hp130: ["130傷害回復HP", "130ダメージでHP回復"],
    fp130: ["130傷害回復FP", "130ダメージでFP回復"],
    itemEffectExpand: ["道具效果擴大", "アイテム効果拡大"],
    // 各角色專屬
    artBurn: ["技藝強化（燃燒）", "アーツ強化（炎上）"],
    skillFlameCloak: ["技能強化（纏火）", "スキル強化（炎の纏い）"],
    skillTimeExtend: ["技能強化（延長時間）", "スキル強化（時間延長）"],
    artHpRecover: ["技藝強化（HP回復）", "アーツ強化（HP回復）"],
    guardCounterHalberd: ["防禦反擊強化（斧槍）", "ガードカウンター強化（斧槍）"],
    guardHpRecover: ["防禦成功時HP回復", "ガード成功時、HP回復"],
    guardAilmentImmune: ["防禦成功時異常狀態蓄積無效", "ガード成功時、状態異常蓄積無効"],
    thrustCounterMaster: ["突刺反擊的達人", "刺突カウンターの達人"],
    easilyTargeted: ["容易被盯上", "狙われやすい"],
    guardCounter: ["防禦反擊", "ガードカウンター"],
    hit1Boost: ["1Hit攻擊強化", "1Hitアタック強化"],
    hit2Boost: ["2Hit攻擊強化", "2Hitアタック強化"],
    skillPoisonBlade: ["技能強化（毒刃）", "スキル強化（毒刃）"],
    skillDamageUp: ["技能強化（損害增加）", "スキル強化（損害増加）"],
    artAtkUp: ["技藝強化（攻擊力提升）", "アーツ強化（攻撃力上昇）"],
    daggerRestage: ["短劍重演", "短剣リステージ"],
    freeReroll: ["回合中限1次裝備變更免費", "ターン中1回だけ装備変更無償"],
    skillIntercept: ["技能強化（迎擊）", "スキル強化（迎撃）"],
    familyBoost: ["家族強化", "ファミリー強化"],
    familyCoop: ["家族共鬥", "ファミリー共闘"],
    artSpiritFlame: ["技藝強化（靈炎爆發）", "アーツ強化（霊炎爆発）"],
    abilityMagicGround: ["能力強化（魔術之地）", "アビリティ強化（魔術の地）"],
    artBleedAtkUp: ["技藝強化（出血攻擊力強化）", "アーツ強化（出血攻撃力強化）"],
    turnStep: ["轉身之步", "転身のステップ"],
    holyVeil: ["聖幕", "聖なる帳"],
    artHealingRoar: ["技藝強化（治癒咆哮）", "アーツ強化（癒しの咆哮）"],
    artContinuousDamage: ["技藝強化（持續傷害）", "アーツ強化（継続ダメージ）"],
    maxBlessingUp: ["最大加護提升", "最大加護上昇"],
    greaseMaster: ["武器脂的達人", "武器脂の達人"],
    skillAllySupport: ["技能強化（夥伴支援）", "スキル強化（仲間支援）"],
    thrift: ["節約術", "節約術"],
    artAtkBoost: ["技藝強化（攻擊力強化）", "アーツ強化（攻撃力強化）"],
  };

  function hasRelic(c, key) {
    return !!(c && CharacterDrawer.findLearnedRelicEffectByName && CharacterDrawer.findLearnedRelicEffectByName(c, RELIC[key]));
  }

  function countRelic(c, key) {
    return c && CharacterDrawer.countLearnedRelicEffectsByName ? CharacterDrawer.countLearnedRelicEffectsByName(c, RELIC[key]) : 0;
  }

  // 「技藝強化（攻擊力強化／攻擊力提升／出血攻擊力強化）」三個遺物的規則本文結構相同：
  // 使用對應技藝後的一段時間內「攻擊 1Hit:+5／2Hit:+10、戰技・魔術・祈禱 +10」。
  // 使用者2026-09-11把三者的持續時間都指定為10秒（原文是「直到階段結束」），因此共用
  // 同一個角色欄位 _relicAtkBuffUntil，由 useCharacterAbility() 在對應技藝發動時寫入。
  var RELIC_ATK_BUFF_MS = 10000;
  var RELIC_ATK_BUFF_HIT1 = 5;
  var RELIC_ATK_BUFF_HIT2 = 10;
  var RELIC_ATK_BUFF_SKILL = 10;
  // 技藝id → 對應的強化遺物key（習得該遺物時，使用該技藝才會掛上buff）
  var RELIC_ATK_BUFF_BY_ABILITY = {
    ominous_strike: "artAtkBoost", // 送葬人「不祥一擊」
    finale: "artAtkUp", // 淑女「終曲」
    song_of_blood_spirit: "artBleedAtkUp", // 隱者「血魂之歌」
  };

  function relicAtkBuffActive(c, now) {
    return !!(c && c._relicAtkBuffUntil && c._relicAtkBuffUntil > (now || Date.now()));
  }

  // 同時裝備2把「相同類別」的近戰武器（雙刀持握的達人）。
  function dualWieldSameCategory(c) {
    if (!c || !c.equippedWeaponIdL || !c.equippedWeaponIdR) return false;
    if (c.equippedWeaponIdL === c.equippedWeaponIdR) return false;
    var wl = Weapons.get(baseCatalogId(c.equippedWeaponIdL));
    var wr = Weapons.get(baseCatalogId(c.equippedWeaponIdR));
    if (!wl || !wr || wl.category !== wr.category) return false;
    var cat = Weapons.getCategory(wl.category);
    return !!cat && !cat.isShield && !cat.isRanged && cat.id !== "staff" && cat.id !== "sacred_seal";
  }

  // 突刺反擊的達人的對象武器種類（規則書列舉）＋射擊武器。
  var THRUST_COUNTER_CATEGORY_IDS = ["rapier", "heavy_rapier", "spear", "great_spear", "halberd"];

  // 「攻擊過10次以上（敵視：1以上）」：midnight 的敵視＝對這隻敵人的累積傷害
  // （fieldTrigger/{id}/damageBySlot），沒有「攻擊次數」欄位，因此改用自己這一場實際
  // 攻擊過的次數（本地計數 attackCountThisEncounter，離開戰鬥即歸零，見onEncounterEnded()）。
  // 「容易被盯上」＝視為已達成，直接回傳 true。
  var THRUST_COUNTER_ATTACK_THRESHOLD = 10;

  function thrustCounterActive(c) {
    if (!hasRelic(c, "thrustCounterMaster")) return false;
    if (hasRelic(c, "easilyTargeted")) return true;
    return attackCountThisEncounter >= THRUST_COUNTER_ATTACK_THRESHOLD;
  }

  // 一般攻擊的遺物加成（回傳 {hit1, hit2}，單位是總合傷害）。weaponId 決定武器種類相關的
  // 條件（後衛戰術＝射擊武器、突刺反擊的達人＝刺突系與射擊武器、武器脂的達人＝已塗脂）。
  function relicAttackHitBonus(c, weaponId) {
    var out = { hit1: 0, hit2: 0 };
    if (!c) return out;
    var weapon = weaponId ? Weapons.get(baseCatalogId(weaponId)) : null;
    var category = weapon ? Weapons.getCategory(weapon.category) : null;
    var isRanged = !!(category && category.isRanged);
    function add(h1, h2) {
      out.hit1 += h1;
      out.hit2 += h2;
    }
    // 後衛戰術：規則書是「自身位於後衛時」，midnight 沒有前衛/後衛（既有簡化，見
    // availableSpecialAttackEntries() 的同款說明），因此位置條件不套用，只保留武器條件。
    if (isRanged && hasRelic(c, "rearGuardTactics")) add(5, 10);
    if (dualWieldSameCategory(c) && hasRelic(c, "dualWieldMaster")) add(5, 10);
    if (hasRelic(c, "familyCoop") && c.summonedSpirit && c.summonedSpirit.hp > 0) add(5, 10);
    if (thrustCounterActive(c) && category && (isRanged || THRUST_COUNTER_CATEGORY_IDS.indexOf(category.id) !== -1)) add(5, 10);
    if (hasRelic(c, "greaseMaster") && c._greaseWeaponId && c._greaseWeaponId === weaponId) add(5, 10);
    if (relicAtkBuffActive(c)) add(RELIC_ATK_BUFF_HIT1, RELIC_ATK_BUFF_HIT2);
    // 1Hit/2Hit 攻擊強化：只加在對應的那一段。1Hit 版在武器威力補正為「力量」時再+5。
    if (hasRelic(c, "hit1Boost")) {
      var artInfo = weaponId ? CharacterDrawer.computeArtPower(c, weaponId) : null;
      var isStrength = !!(artInfo && /力量|筋力/.test(artInfo.powerModText || ""));
      add(isStrength ? 10 : 5, 0);
    }
    if (hasRelic(c, "hit2Boost")) add(0, 5);
    return out;
  }

  // 戰技／魔術／祈禱的遺物加成（總合傷害）。
  function relicSkillDamageBonus(c) {
    if (!c) return 0;
    var total = 0;
    if (hasRelic(c, "rearGuardTactics")) total += 5;
    if (hasRelic(c, "familyCoop") && c.summonedSpirit && c.summonedSpirit.hp > 0) total += RELIC_ATK_BUFF_SKILL;
    if (relicAtkBuffActive(c)) total += RELIC_ATK_BUFF_SKILL;
    return total;
  }

  // 雙手持握的削韌強化：「僅在自身只裝備1把『威力補正：力量／平衡』的武器時，為2Hit攻擊
  // 產生的傷害追加『+▲』」。▲在傷害文字裡是 Guard 削減記號（見 CLAUDE.md §18），因此
  // 這裡不是加數值，而是讓 2Hit 命中多帶一個▲（recordGuardReductionForPoint 會收下）。
  function twoHandGuardBreakSymbol(c, weaponId) {
    if (!hasRelic(c, "twoHandGuardBreak")) return null;
    if (!c.equippedWeaponIdL || !c.equippedWeaponIdR) return null;
    if (c.equippedWeaponIdL !== c.equippedWeaponIdR) return null; // 只裝備1把（左右手同一把＝雙手持握）
    var artInfo = weaponId ? CharacterDrawer.computeArtPower(c, weaponId) : null;
    var label = (artInfo && artInfo.powerModText) || "";
    return /力量|筋力|平衡|バランス/.test(label) ? "▲" : null;
  }

  // ---- 遺物效果「致命一擊」（2026-09-11新增，使用者明確規格）----
  // 「該玩家習得後，當敵人體崩時敵人圖片中會出現致命一擊選項，按下即可造成傷害並消失。
  //   敵人一次體崩狀態中，僅限一名玩家按下一次該按鈕，未習得的人不會出現該按鈕，
  //   若未裝備近戰武器則無法使用。」
  // 傷害沿用規則書原文【總合傷害：120】，習得2個時+20並在行動後對自身HP/FP各回復□
  // （淑女版原文）。規則書的「消耗：豹子（3個）」是骰池特有的條件（同時出現3個相同出目），
  // 即時制沒有骰池、使用者的規格也只寫「按下即可造成傷害」，因此不收體力費用——
  // 限制改由「只有體崩中的3秒內、且整隊只能有一個人按一次」承擔。
  var EXECUTION_RELIC_NAMES = ["致命一擊", "致命の一撃"];
  var EXECUTION_RUNE_RELIC_NAMES = ["致命一擊獲得盧恩", "致命の一撃でルーン獲得"];
  var EXECUTION_BASE_DAMAGE = 120;
  var EXECUTION_MULTI_LEARN_BONUS = 20;

  // 目前裝備的是不是近戰武器（跟availableSpecialAttackEntries()同一組判斷）。
  function hasMeleeWeaponEquipped(c) {
    if (!c) return false;
    return ["R", "L"].some(function (side) {
      var weaponId = c["equippedWeaponId" + side];
      var weapon = weaponId ? Weapons.get(baseCatalogId(weaponId)) : null;
      var category = weapon && Weapons.getCategory(weapon.category);
      return !!category && !category.isShield && !category.isRanged && category.id !== "staff" && category.id !== "sacred_seal";
    });
  }

  function executionRelicCount(c) {
    return CharacterDrawer.countLearnedActionRelicsByName ? CharacterDrawer.countLearnedActionRelicsByName(c, EXECUTION_RELIC_NAMES) : 0;
  }

  // 這一刻自己能不能按致命一擊（按鈕顯示條件與點擊守衛共用同一份判斷）。
  function executionAvailable(now) {
    if (!mySlot || isPaused() || isSelfDowned() || !activeEncounter) return false;
    var c = characters[myTokenId];
    if (!c || !executionRelicCount(c) || !hasMeleeWeaponEquipped(c)) return false;
    var trig = fieldTriggers[activeEncounter.id];
    if (!staggerActiveForTrig(trig, now)) return false;
    return (trig.executionUsedSeq || 0) !== (trig.staggerSeq || 0);
  }

  function handleExecutionClick() {
    if (!executionAvailable(Date.now())) return;
    var pointId = activeEncounter.id;
    var trig = fieldTriggers[pointId];
    var seq = trig.staggerSeq || 0;
    var wonRace = false;
    // first-writer-wins：同一次體崩只能有一個人成功（多人同時按下時，只有把
    // executionUsedSeq從舊值改成seq的那一筆會commit）。
    GameStorage.rtTransaction(gameId, "cloud", "fieldTrigger/" + pointId + "/executionUsedSeq", function (cur) {
      if ((cur || 0) === seq) {
        wonRace = false;
        return cur;
      }
      wonRace = true;
      return seq;
    }).then(function () {
      if (!wonRace) return;
      var c = characters[myTokenId];
      if (!c) return;
      var count = executionRelicCount(c);
      var damage = EXECUTION_BASE_DAMAGE + (count >= 2 ? EXECUTION_MULTI_LEARN_BONUS : 0);
      damageCombatTarget(damage, null);
      triggerEnemyHitEffect(null);
      // 習得2個時：「此行動後，對自身施加「HP回復：□」與「FP回復：□」」（淑女版原文）。
      if (count >= 2) {
        healSelfHp(BLOCK_SQUARE_COUNT_TO_RESOURCE_MULT);
        healSelfFp(BLOCK_SQUARE_COUNT_TO_RESOURCE_MULT);
      }
      showToast(window.I18N.t("midnight_execution_button") + window.I18N.t("colon_separator") + damage);
      broadcastCombatActionBubble(window.I18N.t("midnight_execution_button"));
      maybeGrantExecutionRunes(pointId);
    });
  }

  // 遺物效果「致命一擊獲得盧恩」：「每次發動致命一擊，全體PC獲得盧恩：1。此效果1次戰鬥中
  // 僅發揮1次（即使多名PC擁有此技能，也僅發揮1次）」。判斷「有沒有任何一位在場PC習得」
  // ——不限定按下致命一擊的那個人自己有；戰鬥單位用fieldTrigger（一個地圖點＝一場戰鬥），
  // 用transaction的first-writer-wins保證整場只發一次。
  function maybeGrantExecutionRunes(pointId) {
    var anyHolder = Object.keys(players || {}).some(function (slot) {
      var p = players[slot];
      var pc = p && characters[p.tokenId];
      return !!(pc && CharacterDrawer.findLearnedRelicEffectByName(pc, EXECUTION_RUNE_RELIC_NAMES));
    });
    if (!anyHolder) return;
    var wonRace = false;
    GameStorage.rtTransaction(gameId, "cloud", "fieldTrigger/" + pointId + "/executionRuneGranted", function (cur) {
      if (cur) {
        wonRace = false;
        return cur;
      }
      wonRace = true;
      return true;
    }).then(function () {
      if (!wonRace) return;
      Object.keys(players || {}).forEach(function (slot) {
        var p = players[slot];
        if (!p || !p.tokenId) return;
        GameStorage.rtTransaction(gameId, "cloud", "character/" + p.tokenId + "/runes", function (cur) {
          return (cur || 0) + 1;
        });
      });
      showToast(window.I18N.t("midnight_execution_rune_toast"));
    });
  }

  // 體崩橫幅與致命一擊按鈕（每影格呼叫，見frameInner()）。renderFieldEncounterPanel()有
  // lastRenderedEncounterKey快取、只在換敵人時才重繪，不能把這種每影格會變的狀態放進去。
  function renderStaggerOverlay(now) {
    var banner = el("midnight-stagger-banner");
    var btn = el("btn-midnight-execution");
    if (!banner || !btn) return;
    var staggering = activeEncounterStaggering(now);
    banner.hidden = !staggering;
    if (staggering) banner.textContent = window.I18N.t("midnight_stagger_banner");
    var canExecute = executionAvailable(now);
    btn.hidden = !canExecute;
    if (canExecute) btn.textContent = window.I18N.t("midnight_execution_button");
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
    // 2026-09-08使用者明確規格「敵人血量增加10倍」：格數×10的既有換算慣例再乘10（＝格數×100）。
    return Math.round((total || FIELD_ENEMY_HP_FALLBACK) * 100 * testMult("enemyHpMult"));
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
        // 鐵眼「標記」（2026-09-08使用者明確要求「敵人HP價值-10 持續10s」）：跟測試模式
        // 倍率同一個時機疊加，見applyMidnightAbilityPostEffect()寫入hpValueReduceUntil。
        if (trig && trig.hpValueReduceUntil && Date.now() < trig.hpValueReduceUntil) hpValue -= 10;
        var reductionPct = Math.max(0, Math.min(100, hpValue));
        realDamage = Math.round(amount * (1 - reductionPct / 100));
      }
      hpValueUsed = hpValue;
    }
    realDamage = Math.round(realDamage * testMult("pcDmgMult"));
    // 2026-09-11使用者明確規格「敵人最低遭受傷害還是會扣1點血量（HP價值100時也有基本傷害）」：
    // 減傷率100%或四捨五入後歸零時，至少扣1。原本amount就是0（例如無法解算威力的招式）時
    // 不套用——那代表「這次本來就沒有傷害」，不是被減傷吃掉。
    if (amount > 0 && realDamage < 1) realDamage = 1;
    lastPcDamageInfo = { amount: realDamage, rawAmount: amount, hpValue: hpValueUsed, at: Date.now() };
    // 擊破偵測（2026-09-08使用者明確要求「每擊破一個敵人加快cd」）：wasAlive在updater最後
    // 一次真正commit的那次呼叫中反映「扣血前是否還活著」，跟committed===0合起來判斷「這一擊
    // 是不是把敵人從有血打到死」，避免同一隻敵人已經是0血時被追加攻擊重複判定擊破。
    var wasAlive = false;
    GameStorage.rtTransaction(gameId, "cloud", "fieldEnemyHp/" + pointId, function (cur) {
      var max = enemyRealHpMax(trig);
      var before = cur === null ? max : cur;
      wasAlive = before > 0;
      var next = before - realDamage;
      return next < 0 ? 0 : next;
    }).then(function (committed) {
      if (wasAlive && committed === 0) grantKillCooldownReduction();
    });
  }

  // 每擊破一個敵人，為自己的技能／技藝冷卻各加快5秒／10秒（2026-09-08使用者明確要求）：
  // 只在目前確實還在冷卻中時才提前，避免把還沒用過的冷卻減到「未來」變成負數提前可用。
  function grantKillCooldownReduction() {
    var c = characters[myTokenId];
    if (!c) return;
    var now = Date.now();
    if ((c._skillCooldownUntil || 0) > now) {
      c._skillCooldownUntil = Math.max(now, c._skillCooldownUntil - SKILL_COOLDOWN_KILL_REDUCTION_MS);
      GameStorage.rtSet(gameId, "cloud", "character/" + myTokenId + "/_skillCooldownUntil", c._skillCooldownUntil);
    }
    if ((c._artCooldownUntil || 0) > now) {
      c._artCooldownUntil = Math.max(now, c._artCooldownUntil - ART_COOLDOWN_KILL_REDUCTION_MS);
      GameStorage.rtSet(gameId, "cloud", "character/" + myTokenId + "/_artCooldownUntil", c._artCooldownUntil);
    }
  }

  // 攻擊/戰技實際要打的對象：如果目前站在一個已解決分歧、敵人仍存活的地圖點旁
  // （activeEncounter非null），打這個點的敵人（fieldEnemyHp/{pointId}）；否則沿用
  // 雜兵（2026-09-06死靈術前置工程新增，使用者明確規格）：
  // 這個地圖點有雜兵HP（fieldMobHp）且尚未歸零時，攻擊一律先扣雜兵HP，超過雜兵剩餘量的
  // 部分（溢出）才繼續扣到敵人本體——雜兵歸零後的必要偵測（觸發死靈術）放在
  // onFieldMobHpReceived()做，因為要讓「所有正在旁觀這個雜兵HP的client」都能各自判斷
  // 自己是否要擲骰，不能只有打出最後一擊的那個人才觸發。
  // symbol（可省略）：這次攻擊的▲/◆記號（見computeWeaponDamage等回傳的hit1Symbol/
  // hit2Symbol/symbol），2026-09-06新增，用來累積敵人本體的Guard削り值（見
  // recordGuardReductionForPoint()），跟雜兵/敵人本體傷害分配是兩件獨立的事。
  // 2026-09-08使用者明確規格「基底傷害 單人遊玩時 所有傷害加倍」，追問後確認：判定方式為
  // 「戰鬥開始時只有1個席位有人在場」（讀trig.participants這個戰鬥開始當下就固定寫入的
  // 快照，不是即時人數——跟day3Boss/finalCircleBoss等既有combat trigger共用同一份
  // participants shape，見rollAndAssignDay3Boss()等），套用範圍是「最終傷害整體×2」，
  // 疊加時機比照血魂之歌1.5倍同一個位置（見下方damageCombatTarget()），兩者可疊加。
  function soloModeActive() {
    if (!activeEncounter) return false;
    var trig = fieldTriggers[activeEncounter.id];
    var participants = (trig && trig.participants) || {};
    return Object.keys(participants).length === 1;
  }

  // 2026-09-10使用者明確規格「先將戰技魔法與祈禱 總傷害2倍，角色技能技藝的總傷害3倍」，
  // 並明確選擇「只在實際造成傷害時×，顯示維持原值」——因此這兩個倍率**不**進
  // computeMidnightSkillDamage()／computeMidnightAbilityDamage()（那兩支同時服務武器詳細
  // 資訊、toast等顯示用途），而是只乘在呼叫damageCombatTarget()的那一行上。
  // 套用範圍（刻意界定，未列入者維持原倍率）：
  //   ×2＝castWeaponSkillEntry()——武器戰技（戰技A/戰技B）與杖/聖印的魔術・祈禱，
  //        兩者共用這唯一一個施放入口。
  //   ×3＝useCharacterAbility()——character_types.js的角色專屬〔技藝〕〔技能〕。
  //   不套用：一般攻擊、跳躍/衝刺特殊攻擊（習得型Action遺物，屬一般攻擊系）、消耗品、
  //        召喚靈體、坩堝諸相・獸的襲擊/咆哮（變身中取代一般攻擊鍵的固定值動作）。
  var WEAPON_SKILL_DAMAGE_MULT = 2;
  var CHARACTER_ABILITY_DAMAGE_MULT = 3;

  var BIG_HIT_RELIC_THRESHOLD = 130;

  function maybeApplyBigHitRelicRecovery(amount) {
    if (amount < BIG_HIT_RELIC_THRESHOLD) return;
    var c = characters[myTokenId];
    if (!c) return;
    if (hasRelic(c, "hp130")) healSelfHp(BLOCK_SQUARE_COUNT_TO_RESOURCE_MULT);
    if (hasRelic(c, "fp130")) healSelfFp(BLOCK_SQUARE_COUNT_TO_RESOURCE_MULT);
  }

  function damageCombatTarget(amount, symbol) {
    // 隱者「血魂之歌」（2026-09-08使用者明確要求「全體攻擊/戰技傷害提升*1.5倍」）：
    // party-wide時限buff（見applyMidnightAbilityPostEffect()寫入meta.bloodSongUntil），
    // 所有造成傷害的動作（普通攻擊/戰技/角色技能技藝）最終都會經過這裡，是唯一的傷害
    // 出口，統一在這裡疊乘最省事、不用逐一修改每個damage計算函式。連帶觸發「攻擊後HP/FP
    // 各回復□，每次間隔2秒」，見maybeApplyBloodSongRegen()。
    if (bloodSongActive()) {
      amount = Math.round(amount * 1.5);
      maybeApplyBloodSongRegen();
    }
    if (soloModeActive()) amount = Math.round(amount * 2);
    // 遺物效果「130傷害回復HP／FP」（2026-09-11）：「當自身單獨造成130以上的總合傷害時」。
    // 規則書原文是「階段結束時施加回復」，即時制沒有階段，改成當下立即回復（使用者的
    // 規格文字對HP版也是直接回復）。□→即時制數值沿用BLOCK_SQUARE_COUNT_TO_RESOURCE_MULT。
    maybeApplyBigHitRelicRecovery(amount);
    // 「指定」復歸傷害轉換（2026-09-08新增，見isRevivalDamageEligible()說明）：轉換成功
    // 就完全不對敵人造成傷害，也不記錄Guard Reduction／敵視——這筆攻擊已經變成救援，不是
    // 打敵人的攻擊。
    if (tryApplyDesignatedRevivalDamage(amount)) return;
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
      // 直接用累積傷害最高者當作demo佔位規則即可。
      if (mySlot) {
        GameStorage.rtTransaction(gameId, "cloud", "fieldTrigger/" + pointId + "/damageBySlot/" + mySlot, function (cur) {
          return (cur || 0) + amount;
        });
      }
      maybeApplyRestageBonus(amount);
      return;
    }
    damageSharedTarget(amount);
  }

  // 淑女「重演」（2026-09-08使用者明確要求「被動無法主動點選、非活性化，每對敵人造成30點
  // 傷害，能額外造成10點傷害 cd:60s」）：累積這名玩家對目前這場敵人造成的總傷害，每跨過
  // 30的倍數就補一次額外10點傷害，用cd:60s節流避免短時間內連續觸發（也防止「額外傷害
  // 也算進累積量」造成的連鎖遞迴——額外傷害改呼叫applyDamageToFieldEnemyHp()而不是
  // damageCombatTarget()，本來就不會回頭觸發這裡）。累積量只在encounter進行中有意義，
  // 不特別歸零（跟unyieldingStacks等其他戰鬥限定buff一樣，實務上角色離開/進入新戰鬥時
  // RTDB值還在，但下一場戰鬥的累積是從舊值繼續疊加——已知簡化，見onEncounterEnded()
  // 未特別清除的其他per-encounter統計同款做法，不影響「跨過30倍數才觸發」的判斷邏輯）。
  function maybeApplyRestageBonus(amount) {
    var c = characters[myTokenId];
    var type = c && c.typeId ? window.PriTestCharacterTypes.get(c.typeId) : null;
    var hasRestage =
      type &&
      (type.skills || []).some(function (s) {
        return s.id === "restage";
      });
    if (!c || !hasRestage || !activeEncounter) return;
    var prevAccum = c._restageAccumDamage || 0;
    var nextAccum = prevAccum + amount;
    c._restageAccumDamage = nextAccum;
    GameStorage.rtSet(gameId, "cloud", "character/" + myTokenId + "/_restageAccumDamage", nextAccum);
    if (Math.floor(nextAccum / 30) <= Math.floor(prevAccum / 30)) return; // 沒有跨過新的30倍數門檻
    if (Date.now() < (c._restageCooldownUntil || 0)) return;
    c._restageCooldownUntil = Date.now() + 60000;
    GameStorage.rtSet(gameId, "cloud", "character/" + myTokenId + "/_restageCooldownUntil", c._restageCooldownUntil);
    applyDamageToFieldEnemyHp(activeEncounter.id, 10);
    var CharacterTypes = window.PriTestCharacterTypes;
    var ability = type.skills[0];
    showToast(CharacterTypes.localizedText(ability.name) + "：+10");
  }

  // ---- 屬性/狀態異常共同蓄積（2026-09-05武器資料真正接入新增，見docs/enemy_damage_rules.md
  // §7）：所有攻擊者對同一個目標的蓄積值加總（RTDB transaction原子累加，天然就是「共同
  // 計算」，不需要另外合併每個角色各自的記錄）。閾值使用者明確規格「拉長為需要2倍」
  // （ATTRIBUTE_STATUS_THRESHOLD=16，見常數區塊）。目標key跟damageCombatTarget()判斷
  // 「打誰」用同一套邏輯：有activeEncounter時＝該地圖點pointId，否則＝"sharedTarget"。----
  function currentAttributeAccumTargetKey() {
    return activeEncounter ? activeEncounter.id : "sharedTarget";
  }

  // ---- 淑女「短劍重演」（2026-09-11使用者明確規格「自身以武器種類『短劍』在10秒內進行過
  // 2次2Hit攻擊時，對敵人產生『HP損害：■』的效果」＝10）：2Hit攻擊時呼叫，本地端視窗計時。
  var DAGGER_RESTAGE_WINDOW_MS = 10000;
  var daggerHit2Times = [];

  function maybeApplyDaggerRestage(c, weaponId, now) {
    if (!hasRelic(c, "daggerRestage") || !activeEncounter) return;
    var w = Weapons.get(baseCatalogId(weaponId));
    if (!w || w.category !== "dagger") return;
    daggerHit2Times.push(now);
    daggerHit2Times = daggerHit2Times.filter(function (t) {
      return now - t <= DAGGER_RESTAGE_WINDOW_MS;
    });
    if (daggerHit2Times.length < 2) return;
    daggerHit2Times = []; // 達成後重新計算，避免每次2Hit都持續觸發
    applyDamageToFieldEnemyHp(activeEncounter.id, BLOCK_SQUARE_COUNT_TO_RESOURCE_MULT);
  }

  // 「技能強化（損害增加）」已經對這場戰鬥的哪些屬性/異常觸發過（規則書是「每被施加
  // 『一種』屬性損害或異常狀態」，因此同一種只算一次），離開戰鬥時清空。
  var restageDamageUpApplied = {};

  function recordAttributeAccum(name, amount) {
    var targetKey = currentAttributeAccumTargetKey();
    // 遺物效果「屬性蓄積值＋1」（2026-09-11）：習得時選定1種屬性，自身對敵人造成的
    // 該屬性蓄積值+1。選擇結果存在角色的relicAccumElementChoice（CLAUDE.md §23-25的
    // 既有欄位，由CharacterDrawer.learnRelicEffect()寫入）。
    var cSelf = characters[myTokenId];
    if (cSelf && hasRelic(cSelf, "elementAccumPlus1") && relicChoiceMatches(cSelf.relicAccumElementChoice, name)) amount += 1;
    // 淑女「技能強化（損害增加）」（2026-09-11）：持有「重演」的角色，敵人每被施加一種
    // 屬性/異常時，追加「HP損害：■」＝10。同一種屬性一場只算一次（見restageDamageUpApplied）。
    if (cSelf && hasRelic(cSelf, "skillDamageUp") && activeEncounter && !restageDamageUpApplied[name]) {
      restageDamageUpApplied[name] = true;
      applyDamageToFieldEnemyHp(activeEncounter.id, BLOCK_SQUARE_COUNT_TO_RESOURCE_MULT);
    }
    GameStorage.rtTransaction(gameId, "cloud", "attributeAccum/" + targetKey + "/" + name, function (cur) {
      return (cur || 0) + amount;
    }).then(function (committed) {
      if (typeof committed === "number") maybeTriggerAttributeAccum(targetKey, name, committed);
    });
  }

  // 遺物選擇（RELIC_CHOICE_CONFIG_BY_NAME機制，CLAUDE.md §25）存的是zh或ja其中一種寫法，
  // 而這裡拿到的屬性/異常名稱是ja（見ATTRIBUTE_STATUS_*_NAMES_JA），因此兩邊都比對。
  function relicChoiceMatches(choice, name) {
    if (!choice || !name) return false;
    if (choice === name) return true;
    var map = window.PriTestMidnightTextAdapt && window.PriTestMidnightTextAdapt.elementAliases;
    if (map && map[choice]) return map[choice].indexOf(name) !== -1;
    // 沒有別名表時退回「互為子字串」的寬鬆比對（例如「炎」vs「火炎」），
    // 不做更聰明的猜測。
    return choice.indexOf(name) !== -1 || name.indexOf(choice) !== -1;
  }

  // 遺物效果「屬性達成的歡喜」用的本地觀測（2026-09-11）：規則書是「每當對敵人的所選屬性
  // 蓄積值達到最大時（**不論由哪位PC累積**），對自身施加HP回復□與FP回復□」。
  // maybeTriggerAttributeAccum()只會在「造成這次蓄積的那台裝置」上跑，而且觸發還會用
  // first-writer-wins搶鎖，因此不能掛在那裡——改成每台裝置各自訂閱attributeAccum的變化、
  // 各自判斷自己有沒有跨過門檻，這樣每個持有此遺物的玩家都會各自回復。
  var joyTriggeredCount = {}; // targetKey+":"+name -> 已處理到的觸發次數

  function onAttributeAccumReceived(value) {
    attributeAccum = value || {};
    maybeApplyAttributeJoyRelic();
  }

  function maybeApplyAttributeJoyRelic() {
    var c = characters[myTokenId];
    if (!c || !hasRelic(c, "elementJoy")) return;
    var choice = c.relicJoyElementChoice || c.relicJoyAilmentChoice;
    if (!choice) return;
    Object.keys(attributeAccum || {}).forEach(function (targetKey) {
      var byName = attributeAccum[targetKey] || {};
      Object.keys(byName).forEach(function (name) {
        if (!relicChoiceMatches(choice, name)) return;
        var key = targetKey + ":" + name;
        var count = Math.floor((byName[name] || 0) / ATTRIBUTE_STATUS_THRESHOLD);
        var prev = joyTriggeredCount[key];
        // 初次看到這個key時只記錄基準（避免剛進場就把既有的蓄積量全部算成「剛達成」）。
        if (prev === undefined) {
          joyTriggeredCount[key] = count;
          return;
        }
        if (count <= prev) {
          joyTriggeredCount[key] = count; // 異常觸發後會歸零，基準跟著降回去
          return;
        }
        joyTriggeredCount[key] = count;
        healSelfHp(BLOCK_SQUARE_COUNT_TO_RESOURCE_MULT);
        healSelfFp(BLOCK_SQUARE_COUNT_TO_RESOURCE_MULT);
      });
    });
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
  // combat target累積中、尚未歸零的項目。2026-09-08使用者明確規格「敵人若有受到屬性傷害
  // 則在血條上方黃字標註 炎2・睡眠2 等等」：格式從「name:value」改成「name+value」（無冒號），
  // 多筆之間用「・」分隔（不是原本的雙空格），顏色改到CSS（見style.cssの
  // #midnight-attribute-accum-note）。
  function renderAttributeAccumNote() {
    var noteEl = el("midnight-attribute-accum-note");
    if (!noteEl) return;
    var data = attributeAccum[currentAttributeAccumTargetKey()] || {};
    var parts = [];
    ATTRIBUTE_STATUS_ELEMENT_NAMES_JA.concat(ATTRIBUTE_STATUS_AILMENT_NAMES_JA).forEach(function (name) {
      if (data[name]) parts.push(name + data[name]);
    });
    noteEl.textContent = parts.join("・");
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
    // （比照night.js:5078-5081的unyieldingHitBonus注入點）。無賴漢「鬥爭心」
    // （2026-09-08使用者明確要求「非滿血時傷害+20至普通攻擊與戰技上」）：原本
    // fightingSpiritFlatBonus只套用在戰技/技能/技藝（computeMidnightSkillDamage／
    // computeCharacterAbilityDamage），這裡補上普通攻擊也套用同一份+20（非滿血才有值，
    // 見CharacterDrawer.fightingSpiritFlatBonus()）。
    var unyieldingBonus = unyieldingHitBonus(c);
    var fightingSpiritBonus = CharacterDrawer.fightingSpiritFlatBonus(c, selfArenaHp());
    // 2026-09-11：遺物效果的一般攻擊加成（後衛戰術／雙刀持握的達人／家族共鬥／突刺反擊的
    // 達人／武器脂的達人／1Hit・2Hit攻擊強化／技藝強化的攻擊力buff），見relicAttackHitBonus()。
    var relicHitBonus = relicAttackHitBonus(c, weaponId);
    var extraHitBonus = unyieldingBonus.hit1 + fightingSpiritBonus + relicHitBonus.hit1;
    var extraHit2Bonus = unyieldingBonus.hit2 + fightingSpiritBonus + relicHitBonus.hit2;
    if (extraHitBonus || extraHit2Bonus) {
      dmg = {
        hit1Damage: dmg.hit1Damage + extraHitBonus,
        // hit2Damage可能是null（該武器種沒有2Hit，見computeWeaponDamage），null+數字在JS會
        // 被當成0處理、誤把「沒有2Hit」變成「2Hit傷害=bonus」，因此這裡要先判斷是否為null。
        hit2Damage: dmg.hit2Damage === null ? null : dmg.hit2Damage + extraHit2Bonus,
        hit1Symbol: dmg.hit1Symbol,
        hit2Symbol: dmg.hit2Symbol,
      };
    }
    var cost = CharacterDrawer.parseAttackCost(Weapons.localizedText(category.basicStats.attackCost));
    if (!cost) return null;
    // 遺物效果「2Hit攻擊的達人（武器種類）」（2026-09-11補實作，見twoHitMasteryPoints()說明）：
    // 沿用CharacterDrawer既有的findTwoHitMasteryOverride()，不在這裡重新解析規則本文。
    var mastery = CharacterDrawer.findTwoHitMasteryOverride ? CharacterDrawer.findTwoHitMasteryOverride(c, category) : null;
    return { weaponId: weaponId, dmg: dmg, cost: cost, mastery: mastery };
  }

  // ---- 遺物效果「2Hit攻擊的達人（武器種類）」（2026-09-11 使用者明確規格：
  // 規則書「此效果1個階段中僅能發揮1次」＝即時制的「冷卻10秒」）----
  //
  // 規則書的消耗是骰子出目組合（例：②③＝手上有2跟3這兩顆骰子就能支付），回合制那邊
  // night.js 把它做成 GM 可切換的「另一種付法」（見night.js:4484的masteryOverride），
  // 因為在骰池裡「用哪幾顆骰子」比「總點數多寡」更重要。midnight 沒有骰池，出目總和
  // 直接×2換算成體力（DICE_COUNT_TO_STAMINA_MULT），因此這個「另一種付法」在即時制
  // 會退化成單純的點數比較。實測既有資料後，13筆中有2筆換算後反而更貴：
  //   鐵眼「2Hit攻擊的達人（弓）」＝1Hit消耗③(3點)→「23」(5點)
  //   淑女「2Hit攻擊的達人（短劍）」＝2Hit消耗①①(2點)→「6」(6點)
  // 規則書把這個遺物寫成好處（淑女那條原文甚至是「**可**將…變更為」），若無條件套用，
  // 這兩個角色會因為習得有益的遺物反而多扣體力——那不是規則原意。因此這裡的判斷是
  // 「只有在換算後更便宜時才發動」，變貴的情況視為不發動（不扣冷卻）。
  // 這是即時制換算下的取捨，不是規則書本身有這條但書；若之後確認要無條件套用，
  // 只需要拿掉下面那行 override < base 的比較。
  var TWO_HIT_MASTERY_COOLDOWN_MS = 10000;

  function twoHitMasteryReady(c, now) {
    return !c || !c._twoHitMasteryCooldownUntil || c._twoHitMasteryCooldownUntil <= now;
  }

  // 回傳這次攻擊實際要支付的骰子點數，並在遺物效果實際發動時回報（呼叫端負責扣冷卻）。
  function twoHitMasteryPoints(c, info, useHit2, basePoints, now) {
    var mastery = info && info.mastery;
    if (!mastery) return null;
    if (mastery.hitType !== (useHit2 ? "hit2" : "hit1")) return null;
    if (!twoHitMasteryReady(c, now)) return null;
    if (!(mastery.value < basePoints)) return null; // 見上方說明：變貴時不發動
    return { points: mastery.value, name: mastery.name, label: mastery.label };
  }

  // 普通攻擊3連段（左右手各自獨立）：1秒判定窗口內連續點擊才算連段，超過窗口未點擊則從
  // 第1擊重新算。第1、2擊套用武器1Hit數值，第3擊套用2Hit數值（沒有2Hit資料的武器——
  // 弓/弩/投擲武器等——第3擊仍沿用1Hit數值，使用者已確認）。體力消耗＝骰子點數×2
  // （DICE_COUNT_TO_STAMINA_MULT，使用者明確規格）。
  // 執行者「坩堝諸相・獸」變身狀態是否生效（見applyMidnightAbilityPostEffect()寫入
  // _beastFormUntil）：變身中「武器・盾・杖・聖印無法使用」，見handleAttackClick()／
  // renderSideCombatButtons()借用左右手攻擊鍵改成「襲擊」／「咆哮」。
  function beastFormActive(c, now) {
    return !!(c && c._beastFormUntil && c._beastFormUntil > now);
  }

  // 「襲擊」（左手鍵，消耗3）：對敵人60傷害＋對任意1名瀕死隊友復歸60（原文同時觸發，
  // 不是二選一，見character_types.jsのcrucible_aspect_beast原文「襲擊」敘述）。
  // 「咆哮」（右手鍵，消耗1）：原文「對敵人30，或對任意1名PC復歸30」是二選一，這裡採用
  // 「有瀕死隊友就優先復歸，否則打敵人」的簡化判斷，不做UI選擇（CLAUDE.md精神：不新增
  // 規則書沒有明講優先順序時的中間態，但保留自動判斷，比什麼都不做更有用）。
  function handleBeastAction(kind) {
    if (!mySlot || isPaused() || isSelfDowned()) return;
    var cost = kind === "assault" ? 3 : 1;
    if (!spendStamina(cost * DICE_COUNT_TO_STAMINA_MULT)) return;
    cancelFlaskReadingForOtherAction();
    if (kind === "assault") {
      damageCombatTarget(60, null);
      triggerEnemyHitEffect(null);
      maybeApplySkillRevivalDamage("復帰ダメージ：60");
      showToast(window.I18N.t("midnight_crucible_assault_button") + "：60");
      broadcastCombatActionBubble(window.I18N.t("midnight_crucible_assault_button"));
    } else {
      var targetId = firstEligibleDownedAllyTokenId();
      if (targetId) {
        applyRevivalProgress(targetId, 30);
      } else {
        damageCombatTarget(30, null);
        triggerEnemyHitEffect(null);
      }
      // 執行者「技藝強化（治癒咆哮）」（2026-09-11）：「使用『咆哮』時，對任意1名PC施加
      // 『HP回復：□□』」＝+20。midnight沒有目標選擇UI，對象取隊伍中第一位其他PC，
      // 沒有其他PC時回自己（比照聖光燈火同款簡化）。
      if (hasRelic(characters[myTokenId], "artHealingRoar")) {
        var roarHeal = BLOCK_SQUARE_COUNT_TO_RESOURCE_MULT * 2;
        if (firstOtherPcTokenId()) healOneOtherPc(roarHeal);
        else healSelfHp(roarHeal);
      }
      showToast(window.I18N.t("midnight_crucible_roar_button") + "：30");
      broadcastCombatActionBubble(window.I18N.t("midnight_crucible_roar_button"));
    }
  }

  function handleAttackClick(side) {
    if (!mySlot || isPaused() || isSelfDowned() || isIceBlizzardBlinded(Date.now())) return;
    if (beastFormActive(characters[myTokenId], Date.now())) {
      handleBeastAction(side === "L" ? "assault" : "roar");
      return;
    }
    var info = computeSideAttackInfo(side);
    if (!info) return;
    var c = characters[myTokenId];
    var cs = comboState[side];
    var now = Date.now();
    if (now - cs.lastHitAt > ATTACK_COMBO_WINDOW_MS) cs.hitIndex = 0;
    var isThirdHit = cs.hitIndex === 2;
    var useHit2 = isThirdHit && info.dmg.hit2Damage !== null && !!info.cost.hit2;
    var points = diceCostPoints(useHit2 ? info.cost.hit2 : info.cost.hit1);
    // 遺物效果「2Hit攻擊的達人」：見twoHitMasteryPoints()說明。冷卻只在真正發動時才起算。
    var masteryHit = twoHitMasteryPoints(c, info, useHit2, points, now);
    if (masteryHit) points = masteryHit.points;
    // 遺物效果「防禦反擊」：防禦成功後下一次攻擊的體力消耗-25%（可疊加），見
    // applyGuardSuccessRelics()／guardCounterDiscountPct()。折扣用完即清空。
    var staminaCost = points * DICE_COUNT_TO_STAMINA_MULT;
    var discountPct = guardCounterDiscountPct(c);
    if (discountPct) staminaCost = Math.max(0, Math.round(staminaCost * (1 - discountPct / 100)));
    if (!spendStamina(staminaCost)) return;
    if (discountPct) consumeGuardCounterDiscount(c);
    if (masteryHit) {
      c._twoHitMasteryCooldownUntil = now + TWO_HIT_MASTERY_COOLDOWN_MS;
      GameStorage.rtSet(gameId, "cloud", "character/" + myTokenId + "/_twoHitMasteryCooldownUntil", c._twoHitMasteryCooldownUntil);
      showToast(masteryHit.name + window.I18N.t("colon_separator") + window.I18N.t("midnight_two_hit_mastery_toast", { cost: masteryHit.label }));
    }
    cancelFlaskReadingForOtherAction();
    cs.lastHitAt = now;
    cs.hitIndex = isThirdHit ? 0 : cs.hitIndex + 1;
    var damage = useHit2 ? info.dmg.hit2Damage : info.dmg.hit1Damage;
    var damageSymbol = useHit2 ? info.dmg.hit2Symbol : info.dmg.hit1Symbol;
    recordAttackForRelics(c, staminaCost, now);
    damageCombatTarget(damage, damageSymbol);
    // 雙手持握的削韌強化：2Hit額外帶一個▲（Guard削減），見twoHandGuardBreakSymbol()。
    // damageCombatTarget()的symbol只能帶一個，因此這裡另外補記一次Guard削減，不影響傷害。
    if (useHit2 && activeEncounter) {
      var extraGuardSymbol = twoHandGuardBreakSymbol(c, info.weaponId);
      if (extraGuardSymbol) recordGuardReductionForPoint(activeEncounter.id, extraGuardSymbol);
      maybeApplyDaggerRestage(c, info.weaponId, now); // 淑女「短劍重演」
    }
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
  // 本場戰鬥的攻擊統計（2026-09-11遺物效果用，本地only、離開戰鬥歸零，見onEncounterEnded()）：
  //   attackCountThisEncounter＝這場自己攻擊過幾次（突刺反擊的達人的「攻擊過10次以上」、
  //     連續攻擊時體力回復的「每攻擊5次」）
  //   attackStaminaWindow＝最近的攻擊體力消耗紀錄 [{at, cost}]（連續攻擊時FP回復的
  //     「10秒內因攻擊消耗40體力」，使用者明確規格）
  var attackCountThisEncounter = 0;
  var attackStaminaWindow = [];
  var ATTACK_STAMINA_RECOVER_EVERY = 5; // 每攻擊5次
  var ATTACK_STAMINA_RECOVER_AMOUNT = 5; // 追加5體力
  var ATTACK_FP_WINDOW_MS = 10000; // 10秒內
  var ATTACK_FP_WINDOW_STAMINA = 40; // 消耗40體力

  // 每次一般攻擊（含蓄力攻擊）後呼叫：累加統計並處理兩個「連續攻擊」系遺物效果。
  function recordAttackForRelics(c, staminaCost, now) {
    attackCountThisEncounter += 1;
    if (hasRelic(c, "staminaComboRecover") && attackCountThisEncounter % ATTACK_STAMINA_RECOVER_EVERY === 0) {
      stamina.current = Math.min(stamina.max, stamina.current + ATTACK_STAMINA_RECOVER_AMOUNT);
    }
    if (hasRelic(c, "fpComboRecover")) {
      attackStaminaWindow.push({ at: now, cost: staminaCost });
      attackStaminaWindow = attackStaminaWindow.filter(function (e) {
        return now - e.at <= ATTACK_FP_WINDOW_MS;
      });
      var sum = attackStaminaWindow.reduce(function (a, e) {
        return a + e.cost;
      }, 0);
      if (sum >= ATTACK_FP_WINDOW_STAMINA) {
        attackStaminaWindow = []; // 達成後重新計算，避免每次攻擊都持續觸發
        healSelfFp(BLOCK_SQUARE_COUNT_TO_RESOURCE_MULT);
      }
    }
  }

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
    // 蓄力攻擊（2026-09-11新增，使用者明確規格「同樣長按攻擊後可以切換攻擊方式以選得此項，
    // 一般攻擊更改為蓄力攻擊，2Hit仍舊照舊。蓄力攻擊消耗骰子點數+1（＝體力+2）」）：
    // 傷害沿用規則書原文「裝備中1把近戰武器的1Hit傷害+10」，習得2個以上再+10（鐵眼版原文）。
    // 消耗在useSpecialAttack()裡另外處理（其餘特殊攻擊是解析本文的「消耗：」，蓄力攻擊的
    // 本文寫的是「1Hit的消耗+1」這種相對值，沒辦法用同一個parser解，見該處說明）。
    var chargeEffect = CharacterDrawer.findLearnedActionRelicByName(c, CHARGE_ATTACK_RELIC_NAMES);
    if (chargeEffect) {
      var chargeMultiBonus = CharacterDrawer.countLearnedActionRelicsByName(c, CHARGE_ATTACK_RELIC_NAMES) >= 2 ? 10 : 0;
      out.push({
        kind: "charge",
        weaponId: weaponId,
        effect: chargeEffect,
        value: dmg.hit1Damage + CHARGE_ATTACK_DAMAGE_BONUS + chargeMultiBonus,
        symbol: dmg.hit1Symbol,
      });
    }
    return out;
  }

  // 蓄力攻擊：規則書「效果：對目標造成【總合傷害：裝備中1把近戰武器的1Hit傷害+10】」／
  // 「消耗：1Hit的消耗+1」。使用者2026-09-11明確確認「骰子點數+1（即體力+2）」。
  var CHARGE_ATTACK_RELIC_NAMES = ["蓄力攻擊", "タメ攻撃"];
  var CHARGE_ATTACK_DAMAGE_BONUS = 10;
  var CHARGE_ATTACK_EXTRA_DICE_POINTS = 1;

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
    if (!mySlot || isPaused() || isSelfDowned() || isIceBlizzardBlinded(Date.now())) return;
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
      var name = specialAttackLabel(entry.kind);
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
    if (!mySlot || isPaused() || isSelfDowned() || isIceBlizzardBlinded(Date.now())) return;
    attackSpecialMenuOpen[side] = false;
    renderAttackSpecialMenu(side);
    var c = characters[myTokenId];
    if (!c) return;
    var bodyText = window.PriTestCharacterTypes.localizedText(entry.effect.body);
    var cost = computeMidnightSkillCost(bodyText);
    // 蓄力攻擊的本文寫的是「1Hit的消耗+1」這種相對值，computeMidnightSkillCost()的
    // parseActionCost()解不出絕對值（會得到0），因此這裡改成「這把武器的1Hit消耗＋1點」
    // 自行組出來（使用者2026-09-11明確確認骰子點數+1＝體力+2）。
    if (entry.kind === "charge") {
      var chargeInfo = computeSideAttackInfo(side);
      var basePoints = chargeInfo ? diceCostPoints(chargeInfo.cost.hit1) : 0;
      cost = {
        staminaCost: (basePoints + CHARGE_ATTACK_EXTRA_DICE_POINTS) * DICE_COUNT_TO_STAMINA_MULT,
        fpCost: 0,
        hpCost: 0,
      };
    }
    if (stamina.current < cost.staminaCost || fp.current < cost.fpCost) return;
    cancelFlaskReadingForOtherAction();
    if (cost.staminaCost) spendStamina(cost.staminaCost);
    if (cost.fpCost) spendFp(cost.fpCost);
    if (cost.hpCost) spendSelfHp(cost.hpCost);
    damageCombatTarget(entry.value, entry.symbol);
    triggerEnemyHitEffect(weaponHitColor(entry.weaponId));
    // 蓄力攻擊也是「一般攻擊的替代」，因此比照handleAttackClick()一併觸發武器的屬性/
    // 異常附著（1Hit相當）。跳躍/衝刺攻擊維持既有行為（原本就沒有觸發）。
    if (entry.kind === "charge") applyWeaponAttributeAccumOnHit(entry.weaponId, false);
    broadcastCombatActionBubble(specialAttackLabel(entry.kind));
  }

  function specialAttackLabel(kind) {
    if (kind === "jump") return window.I18N.t("midnight_special_attack_jump_label");
    if (kind === "charge") return window.I18N.t("midnight_special_attack_charge_label");
    return window.I18N.t("midnight_special_attack_dash_label");
  }

  // 武器固有的屬性/狀態異常技能（weapons.js的elementSkillBody/statusSkillBody樣板：
  // 「戰技不發揮」，只在一般攻擊以總合傷害命中時才觸發）：1Hit蓄積+1，2Hit蓄積+2，直接
  // 重用character_drawer.js既有的weaponAccumulationEffects()判斷武器有哪些屬性/異常技能
  // （含毒蠍系裝飾品的+1 scorpionBonus），不重新解析weapon.skills。
  function applyWeaponAttributeAccumOnHit(weaponId, isHit2) {
    var c = characters[myTokenId];
    if (!c) return;
    var base = isHit2 ? 2 : 1;
    // 追蹤者「技能強化（纏火）」：使用爪擊後10秒內，「為該大劍追加『屬性｜火』」——
    // 期間該大劍的一般攻擊比照武器本身的屬性技能累積火屬性（見applyRelicAbilityPostEffect()）。
    if (c._flameCloakUntil && c._flameCloakUntil > Date.now()) {
      var fw = Weapons.get(baseCatalogId(weaponId));
      if (fw && fw.category === "greatsword") recordAttributeAccum("炎", base);
    }
    var effects = CharacterDrawer.weaponAccumulationEffects(c, weaponId);
    if (!effects.length) return;
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
    // 隱者「聖幕」（混成魔法變體，2026-09-11接上）：「10秒時間為止，自身使用戰技・祈禱・
    // 魔術時不需要FP消耗」——見applyRelicAbilityPostEffect()寫入_noFpCostUntil。
    var cSelf = characters[myTokenId];
    var noFp = !!(cSelf && cSelf._noFpCostUntil && cSelf._noFpCostUntil > Date.now());
    return {
      staminaCost: diceCostPoints(cost) * DICE_COUNT_TO_STAMINA_MULT,
      fpCost: noFp ? 0 : cost.fpCost * BLOCK_SQUARE_COUNT_TO_RESOURCE_MULT,
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
      relicSkillDamageBonus(c) + // 2026-09-11：後衛戰術／家族共鬥／技藝強化的攻擊力buff
      // 隱者「能力強化（魔術之地）」：使用元素操控後10秒內，自身使用的**魔術**傷害+5
      // （只有杖＝sorcery，不含祈禱/一般戰技），見applyRelicAbilityPostEffect()。
      (skillDamageKind === "sorcery" && c._magicGroundUntil && c._magicGroundUntil > Date.now() ? 5 : 0) +
      (skillDamageKind ? CharacterDrawer.attachedSkillDamageBonus(c, skillDamageKind) : 0);
    return { value: result.value + flatBonus, symbol: result.symbol };
  }

  // 觸發一次戰技／魔術／祈禱（戰技A即時觸發／戰技B長按滿後觸發共用同一個函式）：先確認
  // 體力/FP都足夠才真正扣款（避免體力扣了才發現FP不夠、且已扣的體力沒有回滾機制的問題），
  // HP消耗（HP■×10）沒有事先檢查門檻——比照「代價類」技能允許扣到低血，不額外發明限制。
  function castWeaponSkillEntry(entry) {
    if (!mySlot || isPaused() || isSelfDowned() || isIceBlizzardBlinded(Date.now())) return;
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
      // ×2：見WEAPON_SKILL_DAMAGE_MULT說明（只影響實際傷害，下面toast維持顯示原值）。
      damageCombatTarget(Math.round(dmgInfo.value * WEAPON_SKILL_DAMAGE_MULT), dmgInfo.symbol);
      triggerEnemyHitEffect(weaponHitColor(entry.weaponId));
      showToast(name + "：" + (dmgInfo.symbol ? dmgInfo.value + " + " + dmgInfo.symbol : String(dmgInfo.value)));
    } else {
      // 威力無法自動解算（■或未預期的本文格式）：不發明數值，顯示規則原文交由GM/玩家判斷
      // （CLAUDE.md §19既有慣例）。
      showToast(name + "：" + bodyText);
    }
    broadcastCombatActionBubble(name);
  }

  // 對自己回復HP／FP（2026-09-11抽出，供多個遺物效果共用：致命一擊2個、屬性達成的歡喜、
  // 130傷害回復HP/FP、防禦成功時HP回復等。HP是共享的demoStat（用transaction避免併發覆寫），
  // FP是本地端資源，直接改）。回復量已經是即時制數值（□→×10的換算在呼叫端做）。
  function healSelfHp(amount) {
    if (!amount || amount <= 0) return;
    var maxHp = mySelfHpMaxFallback();
    GameStorage.rtTransaction(gameId, "cloud", "demoStat/" + myTokenId, function (cur) {
      var next = (cur === null ? maxHp : cur) + amount;
      return next > maxHp ? maxHp : next;
    });
    shareHealWithPartyIfEmpathyActive(amount);
  }

  function healSelfFp(amount) {
    if (!amount || amount <= 0) return;
    fp.current = Math.min(fp.max, fp.current + amount);
  }

  function spendSelfHp(amount) {
    var maxHp = mySelfHpMaxFallback();
    GameStorage.rtTransaction(gameId, "cloud", "demoStat/" + myTokenId, function (cur) {
      var next = (cur === null ? maxHp : cur) - amount;
      return next < 0 ? 0 : next;
    }).then(function (result) {
      if (result === 0) maybeTriggerNearDeath(myTokenId);
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
      CharacterDrawer.talismanFlatSkillBonus(c, selfHp) +
      CharacterDrawer.fightingSpiritFlatBonus(c, selfHp) +
      unyieldingSkillBonus(c) +
      relicAbilityDamageBonus(c, ability);
    return { value: dmg.value + flatBonus, symbol: dmg.symbol };
  }

  // 角色技藝／技能專屬的遺物加成（2026-09-11）：目前只有「技藝強化（燃燒）」對
  // 襲擊之楔的「總合傷害：+50」是純數值加成（其餘技藝/技能強化的附加效果在
  // applyRelicAbilityPostEffect() 處理）。
  var ART_BURN_DAMAGE_BONUS = 50;

  function relicAbilityDamageBonus(c, ability) {
    if (!c || !ability) return 0;
    if (ability.id === "assault_wedge" && hasRelic(c, "artBurn")) return ART_BURN_DAMAGE_BONUS;
    return 0;
  }

  // 2026-09-08midnight優化：「圖騰・史黛拉」的傷害公式使用者明確要求改成「（戰鬥中人數
  // ×35）+▲」，取代原本規則書「前衛PC人數」（midnight沒有前衛/後衛概念，見§17.1既有
  // 簡化說明），這裡直接讀目前這場encounter的participantSlots()人數；不在戰鬥中（沒有
  // activeEncounter，理論上不會發生，因為技藝一定是對著目前戰鬥的目標使用）時保底視為1人。
  function computeMidnightAbilityDamage(c, ability) {
    if (ability.id === "totem_stella") {
      var bodyText = window.PriTestCharacterTypes.localizedText(ability.body);
      var parsed = CharacterDrawer.fixedSkillPowerValue(bodyText); // 只借用▲符號判斷，數值改用下面公式
      var count = activeEncounter ? participantSlots(fieldTriggers[activeEncounter.id]).length || 1 : 1;
      var selfHp = selfArenaHp();
      var flatBonus =
        CharacterDrawer.talismanFlatSkillBonus(c, selfHp) + CharacterDrawer.fightingSpiritFlatBonus(c, selfHp) + unyieldingSkillBonus(c);
      return { value: count * 35 + flatBonus, symbol: parsed ? parsed.symbol : null };
    }
    return computeCharacterAbilityDamage(c, ability);
  }

  // 2026-09-08midnight優化新增的技藝/技能附加效果（使用者明確要求，跟原本character_types.js
  // 規則書文字不同的「midnight限定」補充規則，見本次對話開頭「將本次midnight特殊改動套用
  // 至文本」）：統一在useCharacterAbility()傷害結算後呼叫，用RTDB時間戳實作，讀取端各自
  // 判斷「現在是否還在時限內」，不需要另外的到期清除transaction。
  // ---- 遺物效果驅動的技藝／技能強化（2026-09-11新增）----
  // 這些遺物的規則本文都是「使用技藝／技能X時，追加○○」，因此統一掛在
  // applyMidnightAbilityPostEffect() 的最前面，依「這次用的是哪一招」分流。
  // 傷害類的加成（例如技藝強化（燃燒）的「總合傷害+50」）在computeMidnightAbilityDamage()
  // 處理，這裡只處理「傷害以外的附加效果」（屬性蓄積／回復／時限buff）。
  var SKILL_INTERCEPT_COOLDOWN_CUT_MS = 10000; // 技能強化（迎擊）：使用者明確規格「冷卻減少10秒」
  var SKILL_FLAME_CLOAK_MS = 10000; // 技能強化（纏火）：使用者明確規格「行動後10秒內」
  var MAGIC_GROUND_MS = 10000; // 能力強化（魔術之地）：原文「直到10秒時間為止」
  var NO_FP_COST_MS = 10000; // 聖幕：「10秒時間為止，使用戰技・祈禱・魔術時不需要FP消耗」

  function applyRelicAbilityPostEffect(abilityId, c, now) {
    if (!c) return;
    // 技藝強化（攻擊力強化／攻擊力提升／出血攻擊力強化）：共用同一個10秒buff欄位，
    // 見relicAtkBuffActive()／relicAttackHitBonus()／relicSkillDamageBonus()。
    var buffKey = RELIC_ATK_BUFF_BY_ABILITY[abilityId];
    if (buffKey && hasRelic(c, buffKey)) {
      c._relicAtkBuffUntil = now + RELIC_ATK_BUFF_MS;
      GameStorage.rtSet(gameId, "cloud", "character/" + myTokenId + "/_relicAtkBuffUntil", c._relicAtkBuffUntil);
    }
    if (abilityId === "assault_wedge" && hasRelic(c, "artBurn")) {
      // 追蹤者・技藝強化（燃燒）：「為技藝『襲擊之楔』對敵人的傷害追加『總合傷害：+50』
      // 與『火：3』」——+50在computeMidnightAbilityDamage()加，這裡只處理屬性蓄積。
      recordAttributeAccum("炎", 3);
    }
    if (abilityId === "claw_shot" && hasRelic(c, "skillFlameCloak")) {
      // 追蹤者・技能強化（纏火）：「僅限裝備中的『大劍』時才發動」。
      var hasGreatsword = ["R", "L"].some(function (side) {
        var wid = c["equippedWeaponId" + side];
        var w = wid ? Weapons.get(baseCatalogId(wid)) : null;
        return !!w && w.category === "greatsword";
      });
      if (hasGreatsword) {
        recordAttributeAccum("炎", 1);
        c._flameCloakUntil = now + SKILL_FLAME_CLOAK_MS;
        GameStorage.rtSet(gameId, "cloud", "character/" + myTokenId + "/_flameCloakUntil", c._flameCloakUntil);
      }
    }
    if (abilityId === "whirlwind" && hasRelic(c, "skillTimeExtend") && activeEncounter) {
      // 守護者・技能強化（延長時間）：「使用旋風時，對雜兵追加『HP損害：+■』」＝+10。
      var wPoint = activeEncounter.id;
      if (fieldMobHp[wPoint] !== undefined && fieldMobHp[wPoint] > 0) damageFieldMobOnly(wPoint, BLOCK_SQUARE_COUNT_TO_RESOURCE_MULT);
    }
    if (abilityId === "marking" && activeEncounter) {
      // 鐵眼・技能強化（延長時間）：「標記的效果持續時間多一倍」＝10秒→20秒。
      if (hasRelic(c, "skillTimeExtend")) {
        GameStorage.rtSet(gameId, "cloud", "fieldTrigger/" + activeEncounter.id + "/hpValueReduceUntil", now + 20000);
      }
      // 鐵眼・技能強化（毒刃）：「追加『劇毒：擲2個骰子取較小的出目1個』」。
      if (hasRelic(c, "skillPoisonBlade")) {
        var d1 = 1 + Math.floor(Math.random() * 6);
        var d2 = 1 + Math.floor(Math.random() * 6);
        recordAttributeAccum("猛毒", Math.min(d1, d2));
      }
    }
    if (abilityId === "wings_of_salvation" && hasRelic(c, "artHpRecover")) {
      // 守護者・技藝強化（HP回復）：「對全體PC施加『HP回復：將目前HP回復至最大值』」。
      healAllPartyToFull();
    }
    if (abilityId === "totem_stella" && hasRelic(c, "artHpRecover")) {
      // 無賴漢・技藝強化（HP回復）：「對全體PC施加『HP回復：□×5』」＝+50。
      healAllPartyBy(BLOCK_SQUARE_COUNT_TO_RESOURCE_MULT * 5);
    }
    if (abilityId === "march_of_the_undying" && hasRelic(c, "artSpiritFlame")) {
      // 復仇者・技藝強化（靈炎爆發）：「對敵人造成『火：2D』，並對召喚中的靈體
      // 施加『HP回復：□×6』」＝+60。
      recordAttributeAccum("炎", 1 + Math.floor(Math.random() * 6) + (1 + Math.floor(Math.random() * 6)));
      if (c.summonedSpirit && c.summonedSpirit.hp > 0) {
        c.summonedSpirit.hp = Math.min(c.summonedSpirit.maxHp, c.summonedSpirit.hp + BLOCK_SQUARE_COUNT_TO_RESOURCE_MULT * 6);
        GameStorage.rtSet(gameId, "cloud", "character/" + myTokenId + "/summonedSpirit", c.summonedSpirit);
      }
    }
    if (abilityId === "empathy" && hasRelic(c, "artContinuousDamage") && activeEncounter) {
      // 學者・技藝強化（持續傷害）：「對雜兵追加造成『HP損害：■』」＝10。
      // 原文另有「若該技藝對敵人造成傷害，則傷害+60」，但共感術本身對敵人沒有傷害
      // （只有全體共享回復），沒有可加的對象，因此不套用（不自行發明一個傷害來源）。
      var ePoint = activeEncounter.id;
      if (fieldMobHp[ePoint] !== undefined && fieldMobHp[ePoint] > 0) damageFieldMobOnly(ePoint, BLOCK_SQUARE_COUNT_TO_RESOURCE_MULT);
    }
    if (abilityId === "elemental_control" && hasRelic(c, "abilityMagicGround")) {
      // 隱者・能力強化（魔術之地）：「直到10秒時間為止，將自身使用的魔術傷害+5」。
      c._magicGroundUntil = now + MAGIC_GROUND_MS;
      GameStorage.rtSet(gameId, "cloud", "character/" + myTokenId + "/_magicGroundUntil", c._magicGroundUntil);
    }
    // 隱者「混成魔法」的4種變體（漩渦烈焰／聖光燈火／聖幕／冷氣風暴）本身已由既有的
    // learnedVariantEntries()／角色面板切換接上（傷害由本文的【總合傷害：N】解析），
    // 這裡補上它們「傷害以外」的部分。
    if (abilityId === "hybrid_magic_vortex_flame") {
      recordAttributeAccum("炎", 1 + Math.floor(Math.random() * 6)); // 火：1D
      damageActiveMobIfAny(BLOCK_SQUARE_COUNT_TO_RESOURCE_MULT); // 對雜兵「HP損害：■」
    } else if (abilityId === "hybrid_magic_frost_storm") {
      recordAttributeAccum("凍傷", 2);
      damageActiveMobIfAny(BLOCK_SQUARE_COUNT_TO_RESOURCE_MULT * 2); // 「HP損害：■■」
    } else if (abilityId === "hybrid_magic_holy_light") {
      // 「對自身與其他任意1名PC施加『HP回復：□□□』」＝各+30。其他PC以隊伍中第一位
      // 非自己的在場玩家為對象（midnight沒有目標選擇UI，比照既有的簡化慣例）。
      healSelfHp(BLOCK_SQUARE_COUNT_TO_RESOURCE_MULT * 3);
      healOneOtherPc(BLOCK_SQUARE_COUNT_TO_RESOURCE_MULT * 3);
    } else if (abilityId === "hybrid_magic_sacred_curtain") {
      c._noFpCostUntil = now + NO_FP_COST_MS;
      GameStorage.rtSet(gameId, "cloud", "character/" + myTokenId + "/_noFpCostUntil", c._noFpCostUntil);
    }
  }

  // 對目前戰鬥點的雜兵造成傷害（沒有雜兵時什麼都不做），供上面幾個技能共用。
  function damageActiveMobIfAny(amount) {
    if (!activeEncounter) return;
    var pointId = activeEncounter.id;
    if (fieldMobHp[pointId] !== undefined && fieldMobHp[pointId] > 0) damageFieldMobOnly(pointId, amount);
  }

  // 全體PC回復（HP是共享的demoStat，用transaction逐一加）。
  function healAllPartyBy(amount) {
    Object.keys(players || {}).forEach(function (slot) {
      var p = players[slot];
      if (!p || !p.tokenId) return;
      var maxHp = selfArenaHpMax(characters[p.tokenId]);
      GameStorage.rtTransaction(gameId, "cloud", "demoStat/" + p.tokenId, function (cur) {
        var next = (cur === null ? maxHp : cur) + amount;
        return next > maxHp ? maxHp : next;
      });
    });
  }

  function healAllPartyToFull() {
    Object.keys(players || {}).forEach(function (slot) {
      var p = players[slot];
      if (!p || !p.tokenId) return;
      GameStorage.rtSet(gameId, "cloud", "demoStat/" + p.tokenId, selfArenaHpMax(characters[p.tokenId]));
    });
  }

  function healOneOtherPc(amount) {
    var tokenId = firstOtherPcTokenId();
    if (!tokenId) return;
    var maxHp = selfArenaHpMax(characters[tokenId]);
    GameStorage.rtTransaction(gameId, "cloud", "demoStat/" + tokenId, function (cur) {
      var next = (cur === null ? maxHp : cur) + amount;
      return next > maxHp ? maxHp : next;
    });
  }

  function applyMidnightAbilityPostEffect(abilityId, c) {
    var now = Date.now();
    applyRelicAbilityPostEffect(abilityId, c, now); // 2026-09-11遺物效果驅動的技藝/技能強化
    if (abilityId === "wings_of_salvation") {
      // 守護者・救世之翼：「隊友可以不受傷害持續10秒」——寫party-wide的meta欄位，見
      // resolveMyIncomingHit()裡對partyNoDamageActive()的判斷。
      GameStorage.rtSet(gameId, "cloud", "meta/partyNoDamageUntil", now + 10000);
    } else if (abilityId === "finale") {
      // 淑女・終曲：「敵人不行動 不會對隊友造成任何傷害 10s」——寫在目前這場encounter的
      // fieldTrigger上，見maybeStartEnemyAttack()裡對enemyStunnedUntil的判斷。
      if (activeEncounter) GameStorage.rtSet(gameId, "cloud", "fieldTrigger/" + activeEncounter.id + "/enemyStunnedUntil", now + 10000);
    } else if (abilityId === "totem_stella") {
      // 無賴漢・圖騰・史黛拉：「之後敵人亂戰傷害-300 持續5秒」，見maybeStartEnemyAttack()
      // 裡對groupDamageReduceUntil/groupDamageReduceAmount的判斷。
      if (activeEncounter) {
        GameStorage.rtSet(gameId, "cloud", "fieldTrigger/" + activeEncounter.id + "/groupDamageReduceUntil", now + 5000);
        GameStorage.rtSet(gameId, "cloud", "fieldTrigger/" + activeEncounter.id + "/groupDamageReduceAmount", 300);
      }
    } else if (abilityId === "marking") {
      // 鐵眼・標記：「敵人HP價值-10 持續10s,按下瞬間也是獲得閃避效果」——HP價值減免見
      // applyDamageToFieldEnemyHp()裡對hpValueReduceUntil的判斷；「按下瞬間獲得閃避」
      // 直接比照handleDodgeClick()寫dodgePressedAt，若剛好有正在等待反應的攻擊視窗，
      // 這一下會被resolveMyIncomingHit()判定為成功迴避。
      if (activeEncounter) GameStorage.rtSet(gameId, "cloud", "fieldTrigger/" + activeEncounter.id + "/hpValueReduceUntil", now + 10000);
      dodgePressedAt = now;
    } else if (abilityId === "inquiry") {
      // 學者・探求：「回復體力10點並讓敵人亂戰傷害-180 持續5秒」——體力回復是本地端資源，
      // 直接加；群體傷害減免寫法跟totem_stella同一組欄位。
      stamina.current = Math.min(stamina.max, stamina.current + 10);
      if (activeEncounter) {
        GameStorage.rtSet(gameId, "cloud", "fieldTrigger/" + activeEncounter.id + "/groupDamageReduceUntil", now + 5000);
        GameStorage.rtSet(gameId, "cloud", "fieldTrigger/" + activeEncounter.id + "/groupDamageReduceAmount", 180);
      }
    } else if (abilityId === "spirit_summon") {
      // 復仇者・召喚靈體：「一次只能召喚一隻」——重新召喚直接取代既有的summonedSpirit。
      // 已知簡化：原文「海倫/弗雷德里克/賽巴斯汀三選一」沒有另外新增專屬選單UI，改成
      // 每次按下依SPIRIT_SUMMON_TYPES順序輪流召喚下一種（見下方索引計算），不是自由選擇。
      var prevKind = c.summonedSpirit && c.summonedSpirit.kind;
      var prevIndex = -1;
      for (var si = 0; si < SPIRIT_SUMMON_TYPES.length; si++) {
        if (SPIRIT_SUMMON_TYPES[si].kind === prevKind) {
          prevIndex = si;
          break;
        }
      }
      var nextDef = SPIRIT_SUMMON_TYPES[(prevIndex + 1 + SPIRIT_SUMMON_TYPES.length) % SPIRIT_SUMMON_TYPES.length];
      var maxHp = nextDef.maxHpRows * MOB_HP_PER_ROW;
      var level = c.level || 1;
      c.summonedSpirit = { kind: nextDef.kind, hp: maxHp, maxHp: maxHp, dmg: nextDef.dmgBase + level * 5, nextAttackAt: now + SPIRIT_ATTACK_INTERVAL_MS };
      GameStorage.rtSet(gameId, "cloud", "character/" + myTokenId + "/summonedSpirit", c.summonedSpirit);
      showToast(window.I18N.t(nextDef.nameKey) + window.I18N.t("midnight_spirit_summon_note"));
    } else if (abilityId === "crucible_aspect_beast") {
      // 執行者・坩堝諸相・獸：「HP回復滿,變身後取代左右手武器...持續20秒」，見
      // beastFormActive()／handleAttackClick()／renderSideCombatButtons()的武器鍵借用。
      var maxHp = mySelfHpMaxFallback();
      GameStorage.rtSet(gameId, "cloud", "demoStat/" + myTokenId, maxHp);
      c._beastFormUntil = now + 20000;
      GameStorage.rtSet(gameId, "cloud", "character/" + myTokenId + "/_beastFormUntil", c._beastFormUntil);
    } else if (abilityId === "empathy") {
      // 學者・共感術：「之後自己的HP回復效果全體共享 10秒」，見
      // shareHealWithPartyIfEmpathyActive()（已知簡化：目前只接上聖杯瓶回復來源）。
      c._empathyShareUntil = now + 10000;
      GameStorage.rtSet(gameId, "cloud", "character/" + myTokenId + "/_empathyShareUntil", c._empathyShareUntil);
    } else if (abilityId === "march_of_the_undying") {
      // 復仇者・不死行軍：「直到結束階段HP不歸零 持續10秒」——沒有phase概念，改用party-wide
      // 10秒時限，見reviveImmuneActive()／maybeTriggerNearDeath()／selfDeathImmuneActive()。
      GameStorage.rtSet(gameId, "cloud", "meta/reviveImmuneUntil", now + 10000);
    } else if (abilityId === "trance") {
      // 送葬人・恍惚：「使用後體力額外1秒恢復2點，此時防禦價值100 持續狀態3秒」，見
      // updateStamina()的加成回復、activeTempGuardPct()的100%減傷。「有讀條」的施放
      // 讀取條視覺效果暫未新增獨立UI元件（已知簡化，效果本身完整套用，不影響數值）。
      c._tranceUntil = now + 3000;
      GameStorage.rtSet(gameId, "cloud", "character/" + myTokenId + "/_tranceUntil", c._tranceUntil);
    } else if (abilityId === "counterattack") {
      // 無賴漢・逆襲：「按下時HP價值80，且瀕死時保留1HP不歸零 持續3秒」——本地端角色buff，
      // 見activeTempGuardPct()／selfDeathImmuneActive()。
      c._counterattackGuardUntil = now + 3000;
      GameStorage.rtSet(gameId, "cloud", "character/" + myTokenId + "/_counterattackGuardUntil", c._counterattackGuardUntil);
      // 無賴漢「技能強化（迎擊）」（2026-09-11使用者明確規格「觸發夜渡技能『逆襲』的防禦
      // 效果時，冷卻減少10秒」）：useCharacterAbility()在呼叫這裡之前已經寫好冷卻，
      // 這裡直接把冷卻往前拉10秒（不會拉到過去，下限是現在）。
      if (hasRelic(c, "skillIntercept")) {
        c._skillCooldownUntil = Math.max(now, (c._skillCooldownUntil || now) - SKILL_INTERCEPT_COOLDOWN_CUT_MS);
        GameStorage.rtSet(gameId, "cloud", "character/" + myTokenId + "/_skillCooldownUntil", c._skillCooldownUntil);
      }
    } else if (abilityId === "whirlwind") {
      // 守護者・旋風：「對雜兵20點傷害」，原文只有■（不可自行發明數值），這裡的20是
      // 使用者這次明確給的midnight限定數字。「S/M敵人▲」原文本身沒有固定傷害數值，只
      // 影響Guard削り值，見recordGuardReductionForPoint()——跟一般攻擊/戰技命中時同一套
      // 累積規則（▲=0.5、◆=1，每滿3點Guard Point-1）。
      if (activeEncounter) {
        var pointId = activeEncounter.id;
        if (fieldMobHp[pointId] !== undefined && fieldMobHp[pointId] > 0) damageFieldMobOnly(pointId, 20);
        var trig = fieldTriggers[pointId];
        var enemyData =
          trig && trig.enemyFamilyId && trig.enemyFamilyId !== BOSS_ENEMY_FAMILY_SENTINEL
            ? window.PriTestEnemies.get(trig.enemyFamilyId, trig.enemyId)
            : null;
        var size = enemyData && enemyData.enemy && enemyData.enemy.size;
        if (size === "S" || size === "M") recordGuardReductionForPoint(pointId, "▲");
      }
    } else if (abilityId === "hybrid_magic") {
      // 隱者・混成魔法：消耗3點屬性痕（門檻已在midnightAbilityPrecondition()確認過）。
      c.elementalMarks = Math.max(0, (c.elementalMarks || 0) - 3);
      GameStorage.rtSet(gameId, "cloud", "character/" + myTokenId + "/elementalMarks", c.elementalMarks);
    } else if (abilityId === "song_of_blood_spirit") {
      // 隱者・血魂之歌：「全體攻擊/戰技傷害提升*1.5倍...此狀態持續10秒」，party-wide，見
      // bloodSongActive()／damageCombatTarget()的疊乘、maybeApplyBloodSongRegen()的回復。
      GameStorage.rtSet(gameId, "cloud", "meta/bloodSongUntil", now + 10000);
    }
  }

  // 復仇者靈體的自動攻擊迴圈（2026-09-08使用者明確要求「攻擊頻率較敵人慢兩倍」，見
  // SPIRIT_ATTACK_INTERVAL_MS）：每個裝置只負責推進自己這個角色召喚的靈體（跟其他
  // per-device authority的既有模式一致，不是全域NPC AI），只在目前站在活躍戰鬥中才會
  // 出招，離開戰鬥/靈體HP歸零就不再攻擊（但不自動清除，讓玩家還看得到靈體已陣亡的
  // 血條，直到encounter結束或重新召喚才清除，見onEncounterEnded()）。
  function updateSummonedSpirit(now) {
    var c = characters[myTokenId];
    var spirit = c && c.summonedSpirit;
    if (!spirit || spirit.hp <= 0 || !activeEncounter) return;
    if (now < (spirit.nextAttackAt || 0)) return;
    spirit.nextAttackAt = now + SPIRIT_ATTACK_INTERVAL_MS;
    c.summonedSpirit = spirit;
    GameStorage.rtSet(gameId, "cloud", "character/" + myTokenId + "/summonedSpirit", spirit);
    // 復仇者「家族強化」（2026-09-11）：「將自身召喚的『靈體』產生的傷害+10」。
    damageCombatTarget(spirit.dmg + (hasRelic(c, "familyBoost") ? SPIRIT_FAMILY_BOOST_BONUS : 0), null);
    triggerEnemyHitEffect(null);
  }

  var SPIRIT_FAMILY_BOOST_BONUS = 10;

  // 對雜兵單獨造成固定傷害，不像damageCombatTarget()那樣把溢出部分繼續打進敵人本體
  // （2026-09-08旋風新增，使用者明確規格是「對雜兵」的獨立傷害，不是一般攻擊的雜兵→敵人
  // 溢出鏈）。沒有雜兵存活時呼叫端本來就不會叫用這個函式，這裡的cur<=0保底只是避免
  // transaction重試時的競態把已死雜兵扣成負數。
  function damageFieldMobOnly(pointId, amount) {
    GameStorage.rtTransaction(gameId, "cloud", "fieldMobHp/" + pointId, function (cur) {
      var current = cur === null ? 0 : cur;
      if (current <= 0) return cur;
      var next = current - amount;
      return next < 0 ? 0 : next;
    });
  }

  // 全隊「暫時不受傷害」是否生效（守護者救世之翼，見applyMidnightAbilityPostEffect()），
  // 全隊共用同一個meta時間戳，任何一名玩家的client判斷都一致。
  function partyNoDamageActive() {
    return !!(meta && meta.partyNoDamageUntil && meta.partyNoDamageUntil > Date.now());
  }

  // 隱者「血魂之歌」是否生效（見damageCombatTarget()的1.5倍疊乘、applyMidnightAbilityPostEffect()
  // 寫入meta.bloodSongUntil）：跟partyNoDamageActive()同一種party-wide時限buff模式。
  function bloodSongActive() {
    return !!(meta && meta.bloodSongUntil && meta.bloodSongUntil > Date.now());
  }

  // 血魂之歌「攻擊後HP/FP各回復□，每次間隔2秒」：□依CLAUDE.md §17視為+1，節流用本地
  // 時間戳（不需要跨玩家同步，每個玩家各自的攻擊各自觸發各自的回復）。
  var BLOOD_SONG_REGEN_INTERVAL_MS = 2000;
  var lastBloodSongRegenAt = 0;

  function maybeApplyBloodSongRegen() {
    var now = Date.now();
    if (now - lastBloodSongRegenAt < BLOOD_SONG_REGEN_INTERVAL_MS) return;
    lastBloodSongRegenAt = now;
    var maxHp = mySelfHpMaxFallback();
    GameStorage.rtTransaction(gameId, "cloud", "demoStat/" + myTokenId, function (cur) {
      var current = cur === null ? maxHp : cur;
      return Math.min(maxHp, current + 1);
    });
    fp.current = Math.min(fp.max, fp.current + 1);
  }

  // 全隊「瀕死免疫」是否生效（復仇者不死行軍），見maybeTriggerNearDeath()／
  // selfDeathImmuneActive()。
  function reviveImmuneActive() {
    return !!(meta && meta.reviveImmuneUntil && meta.reviveImmuneUntil > Date.now());
  }

  // 自身HP即將歸零時是否應該保留在1（不觸發瀕死）：整合party-wide的不死行軍免疫、以及
  // 無賴漢逆襲的個人3秒保護視窗，供resolveMyIncomingHit()統一判斷。跟第六感
  // （sixthSenseSaveValue()）是分開的機制——第六感有自己的冷卻與觸發提示，這裡單純是
  // 「暫時不會死」的buff判定，沒有次數/冷卻限制（限制在buff本身的時限）。
  function selfDeathImmuneActive(c, now) {
    return reviveImmuneActive() || !!(c && c._counterattackGuardUntil && c._counterattackGuardUntil > now);
  }

  // 無賴漢逆襲（80%）／送葬人恍惚（100%，見applyMidnightAbilityPostEffect()寫入
  // _tranceUntil）觸發後的暫時自身減傷：跟currentGuardInfo()的「盾防禦」百分比是分開的
  // 加成來源，不需要真的按住防禦鍵，供resolveMyIncomingHit()在算完kind===hit/block的
  // damage後再疊加一層百分比減免。兩者理論上不會同時生效（不同角色），取較大值即可。
  function activeTempGuardPct(c, now) {
    var pct = 0;
    if (c && c._counterattackGuardUntil && c._counterattackGuardUntil > now) pct = Math.max(pct, 80);
    if (c && c._tranceUntil && c._tranceUntil > now) pct = Math.max(pct, 100);
    return pct;
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

  // 2026-09-08midnight優化：使用者明確要求「原本cd60s的招式每擊破一個敵人加快cd5s...」
  // 同時給了少數技能自己專屬的冷卻秒數（目前只有守護者「旋風」10秒，取代原本一律沿用
  // SKILL_COOLDOWN_MS/ART_COOLDOWN_MS的通用值）。key＝character_types.jsのability.id。
  var MIDNIGHT_ABILITY_COOLDOWN_OVERRIDE_MS = {
    whirlwind: 10000,
    spirit_summon: 10000,
  };

  // 復仇者「召喚靈體」（2026-09-08使用者明確要求，見數值出處character_types.js原文「海倫／
  // 弗雷德里克／賽巴斯汀」三隻靈體的最大HP／發生傷害）：格數換算HP沿用MOB_HP_PER_ROW
  // 同一套「格數×10」慣例。dmg是固定基底＋PC等級×5，弗雷德里克原文另有「+▲」（威力補正）
  // 這裡略過（▲需要角色目前狀態才能算，靈體不是PC本人，不硬套一個角色的▲，已知簡化）。
  var SPIRIT_SUMMON_TYPES = [
    { kind: "helen", nameKey: "midnight_spirit_helen_name", maxHpRows: 2, dmgBase: 15 },
    { kind: "frederik", nameKey: "midnight_spirit_frederik_name", maxHpRows: 5, dmgBase: 5 },
    { kind: "sebastian", nameKey: "midnight_spirit_sebastian_name", maxHpRows: 6, dmgBase: 10 },
  ];
  var SPIRIT_ATTACK_INTERVAL_MS = 6000; // 使用者明確規格「攻擊頻率較敵人慢兩倍」，敵人排程約2~4秒（見ENEMY_ATTACK_INTERVAL_MIN/MAX_MS），這裡固定用兩倍的平均值

  // 這批技藝/技能的body文字本來就寫了「復歸傷害：N」（見parseFixedRevivalDamageValue()），
  // 2026-09-08使用者明確要求這幾招「同時觸發...復歸的傷害」，因此在傷害結算後一併呼叫
  // maybeApplySkillRevivalDamage()。刻意用白名單而不是套用到全部招式，因為「爪擊」
  // （claw_shot）使用者明確要求「不改動」——它的body文字雖然也含「復歸ダメージ：40」，
  // 但那是「任選發揮」的其中一種效果，不該無條件跟傷害同時觸發。
  var MIDNIGHT_ABILITY_AUTO_REVIVAL_IDS = {
    assault_wedge: true, // 追蹤者・襲擊之楔
    wings_of_salvation: true, // 守護者・救世之翼
    one_shot: true, // 鐵眼・一擊必殺
    totem_stella: true, // 無賴漢・圖騰・史黛拉
  };

  // 隱者「混成魔法」的使用門檻（2026-09-08使用者明確要求「消耗3屬性痕」，本文原有
  // 「消去『屬性痕』的『3個』」文字但原本從未真的檢查/消耗elementalMarks）：門檻不足時
  // 靜默不動作，比照handleElementalControlClick()「屬性痕已滿」等既有前置檢查風格。
  function midnightAbilityPrecondition(abilityId, c) {
    if (abilityId === "hybrid_magic") return (c.elementalMarks || 0) >= 3;
    return true;
  }

  // 遺物效果「技能使用次數＋1」的蓄積（2026-09-11）：技能冷卻跑完的那一刻，若蓄積數還沒
  // 達到上限（＝習得幾個就幾個），就+1並重新起算一輪冷卻繼續蓄積。每影格呼叫（見frameInner）。
  // 「初習得時須先跑冷卻流程」＝剛習得時蓄積數是0，要等一輪冷卻結束才會有第一個。
  var lastSkillChargeTickAt = 0;

  function updateSkillExtraCharges(now) {
    if (!mySlot) return;
    var c = characters[myTokenId];
    if (!c) return;
    var max = countRelic(c, "skillUsesPlus1");
    if (!max) return;
    if ((c._skillExtraCharges || 0) >= max) return;
    var until = c._skillCooldownUntil || 0;
    if (!until || now < until) return;
    if (until === lastSkillChargeTickAt) return; // 同一輪冷卻只結算一次
    lastSkillChargeTickAt = until;
    c._skillExtraCharges = (c._skillExtraCharges || 0) + 1;
    var nextUntil = now + SKILL_COOLDOWN_MS;
    c._skillCooldownUntil = (c._skillExtraCharges || 0) >= max ? 0 : nextUntil;
    GameStorage.rtSet(gameId, "cloud", "character/" + myTokenId + "/_skillExtraCharges", c._skillExtraCharges);
    GameStorage.rtSet(gameId, "cloud", "character/" + myTokenId + "/_skillCooldownUntil", c._skillCooldownUntil);
  }

  function useCharacterAbility(kind) {
    if (!mySlot || isPaused() || isSelfDowned() || isIceBlizzardBlinded(Date.now())) return;
    var found = characterAbilityEntry(kind);
    if (!found.c || !found.ability) return;
    if (!midnightAbilityPrecondition(found.ability.id, found.c)) return;
    // 2026-09-06數值真正接入：技藝/技能不再用「使用次數」（_artUsesRemaining/
    // _skillUsesRemaining）限制，改用使用者明確規格的時間冷卻——技藝180秒
    // （ART_COOLDOWN_MS）、技能60秒（SKILL_COOLDOWN_MS），換日立即重置（見
    // updateAutoDayAdvance()裡對resetAbilityCooldowns()的呼叫）。
    var usedViaPowerResonanceCredit = false;
    var cooldownField = kind === "art" ? "_artCooldownUntil" : "_skillCooldownUntil";
    var cooldownUntil = found.c[cooldownField] || 0;
    var abilityId = found.ability.id;
    var baseCooldownMs = MIDNIGHT_ABILITY_COOLDOWN_OVERRIDE_MS[abilityId] || (kind === "art" ? ART_COOLDOWN_MS : SKILL_COOLDOWN_MS);
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
      } else if (kind === "skill" && (found.c._skillExtraCharges || 0) > 0) {
        // 遺物效果「技能使用次數＋1」（2026-09-11使用者明確規格「技能可以多保持一個來
        // 使用，初習得時須先跑冷卻流程，之後多蓄積一個可以使用機會」）：冷卻跑完時
        // 蓄積1次（見updateSkillExtraCharges()），冷卻中可以用掉蓄積的次數。
        // 沿用力量感應credit完全相同的旁路寫法，不新增第二套「次數」系統。
        var nextCharges = found.c._skillExtraCharges - 1;
        found.c._skillExtraCharges = nextCharges;
        GameStorage.rtSet(gameId, "cloud", "character/" + myTokenId + "/_skillExtraCharges", nextCharges);
      } else {
        showToast(window.I18N.t("midnight_character_ability_cooldown_note", { seconds: Math.ceil((cooldownUntil - Date.now()) / 1000) }));
        return;
      }
    } else {
      var nextCooldownUntil = Date.now() + baseCooldownMs;
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
    var dmgInfo = computeMidnightAbilityDamage(found.c, found.ability);
    if (dmgInfo) {
      // ×3：見CHARACTER_ABILITY_DAMAGE_MULT說明（只影響實際傷害，下面toast維持顯示原值）。
      damageCombatTarget(Math.round(dmgInfo.value * CHARACTER_ABILITY_DAMAGE_MULT), dmgInfo.symbol);
      // 角色專屬能力不綁定特定武器，沒有武器屬性技能的概念，固定顯示無屬性（白色）刀光。
      triggerEnemyHitEffect(null);
      showToast(name + "：" + (dmgInfo.symbol ? dmgInfo.value + " + " + dmgInfo.symbol : String(dmgInfo.value)));
    } else {
      // 威力無法自動解算（■或未預期的本文格式）：不發明數值，顯示規則原文交由GM/玩家判斷
      // （CLAUDE.md §19既有慣例，比照castWeaponSkillEntry的同款fallback）。
      showToast(name + "：" + body);
    }
    if (MIDNIGHT_ABILITY_AUTO_REVIVAL_IDS[abilityId]) maybeApplySkillRevivalDamage(body);
    applyMidnightAbilityPostEffect(abilityId, found.c);
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
  // 2026-09-10使用者明確規格「要倒數而恢復使用次數的按鍵，使用圓形背景計時：淡色開始
  // 順時針轉一圈恢復成原本顏色」＋「右下hud的按鈕長度進入戰鬥後就已算完，不能因為增加
  // 文字而拉長後更動按鍵配置位置」：原本的abilityLabelWithCooldown()把「(12s)」直接接在
  // 按鈕文字後面，冷卻期間文字變長→按鈕變寬→整排flex-wrap重排，正是使用者回報的問題。
  // 改成兩段：
  //   - 文字永遠只有招式名稱（不再隨冷卻改變長度），見renderCharacterActionButtons()。
  //   - 冷卻進度改用CSS conic-gradient圓形背景呈現，透過--mn-cd這個CSS變數逐幀寫入
  //     「已經過的百分比」，淡色從12點鐘方向順時針掃一圈後恢復原本配色（見style.css的
  //     .midnight-cooldown-dial）。JS只寫百分比，配色/動畫全部留在CSS。
  // 沒有冷卻或已結束時移除class＋變數，讓按鈕回到完全沒有這層背景的原狀。
  function applyCooldownDial(btn, c, cooldownField, totalMs) {
    if (!btn) return;
    var until = (c && c[cooldownField]) || 0;
    var remain = until - Date.now();
    if (remain <= 0 || !totalMs) {
      btn.classList.remove("midnight-cooldown-dial");
      btn.style.removeProperty("--mn-cd");
      return;
    }
    var elapsedPct = Math.max(0, Math.min(100, ((totalMs - remain) / totalMs) * 100));
    btn.classList.add("midnight-cooldown-dial");
    btn.style.setProperty("--mn-cd", elapsedPct + "%");
  }

  // 這個ability實際的冷卻總長度（跟useCharacterAbility()算baseCooldownMs同一行判斷，
  // 不重複定義第二套規則）：圓形計時盤需要「總長度」才能算出已經過的百分比。
  function abilityCooldownTotalMs(ability, kind) {
    if (!ability) return 0;
    return MIDNIGHT_ABILITY_COOLDOWN_OVERRIDE_MS[ability.id] || (kind === "art" ? ART_COOLDOWN_MS : SKILL_COOLDOWN_MS);
  }

  function renderCharacterActionButtons() {
    var actable = canActNow(); // 瀕死中角色專屬技藝/技能/特殊防禦一律鎖住，見canActNow()
    var found = characterAbilityEntry("art");
    var artBtn = el("btn-midnight-art");
    artBtn.hidden = !found.ability;
    if (found.ability) {
      var artName = window.PriTestCharacterTypes.localizedText(found.ability.name);
      var artCooldownUntil = (found.c && found.c._artCooldownUntil) || 0;
      // 文字固定只有招式名稱（不再附加「(12s)」造成按鈕寬度變動），冷卻改用圓形計時盤。
      el("midnight-art-label").textContent = artName;
      applyCooldownDial(artBtn, found.c, "_artCooldownUntil", abilityCooldownTotalMs(found.ability, "art"));
      artBtn.disabled = !actable || (Date.now() < artCooldownUntil && !((found.c && found.c._powerResonanceCredits) > 0));
    }
    var foundSkill = characterAbilityEntry("skill");
    var skillBtn = el("btn-midnight-character-skill");
    // 執行者「妖刀」kind純粹是"Defense"（沒有Action分支，跟marking／counterattack／trance
    // 這幾個"Action／Defense"雙模式技能不同），2026-09-08改走特殊防禦按鈕流程（見
    // yotoAbilityFor()／availableSpecialDefenseOption()），這裡的一般技能按鈕不再顯示，
    // 避免玩家誤按（原本會扣60秒冷卻卻什麼都沒發生，因為body文字算不出傷害數值）。
    skillBtn.hidden = !foundSkill.ability || foundSkill.ability.kind === "Defense";
    if (foundSkill.ability && !skillBtn.hidden) {
      var skillName = window.PriTestCharacterTypes.localizedText(foundSkill.ability.name);
      var skillCooldownUntil = (foundSkill.c && foundSkill.c._skillCooldownUntil) || 0;
      el("midnight-character-skill-label").textContent = skillName;
      applyCooldownDial(skillBtn, foundSkill.c, "_skillCooldownUntil", abilityCooldownTotalMs(foundSkill.ability, "skill"));
      skillBtn.disabled = !actable || Date.now() < skillCooldownUntil;
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
      var label =
        specialOption.kind === "yoto" ? CharacterTypes.localizedText(specialOption.ability.name) : CharacterTypes.localizedText(specialOption.entry.name);
      el("midnight-defense-special-label").textContent = label;
      specialBtn.disabled = !actable;
    }

    // 高防禦切換鈕（2026-09-05角色能力真正接入新增）：見handleHighGuardToggleClick()。
    var highGuardBtn = el("btn-midnight-high-guard");
    var hgAbility = highGuardAbility(type);
    highGuardBtn.hidden = !hgAbility;
    if (hgAbility) {
      highGuardBtn.textContent = window.PriTestCharacterTypes.localizedText(hgAbility.name) + (c && c._highGuardActive ? " ✓" : "");
      highGuardBtn.classList.toggle("midnight-sheet-variant-active", !!(c && c._highGuardActive));
      highGuardBtn.disabled = !actable;
    }

    // 元素操控按鈕（2026-09-05角色能力真正接入新增）：見handleElementalControlClick()。
    var elementalControlBtn = el("btn-midnight-elemental-control");
    var ecAbility = elementalControlAbility(type);
    elementalControlBtn.hidden = !ecAbility;
    if (ecAbility) {
      elementalControlBtn.textContent =
        window.PriTestCharacterTypes.localizedText(ecAbility.name) + "(" + (c && c.elementalMarks ? c.elementalMarks : 0) + "/" + ELEMENTAL_MARKS_MAX + ")";
      elementalControlBtn.disabled = !actable;
    }

    renderSpiritManageButton(c, actable);
  }

  // 復仇者「靈體管理」按鈕（2026-09-11使用者明確規格）：只有目前有召喚中的靈體時才顯示，
  // 文字是「靈體名稱(HP/最大HP)」，按下解散該靈體（規則書「一次只能召喚一隻」，解散後
  // 就能重新召喚別種，見applyMidnightAbilityPostEffect()的spirit_summon分支）。
  function renderSpiritManageButton(c, actable) {
    var btn = el("btn-midnight-spirit-manage");
    if (!btn) return;
    var spirit = c && c.summonedSpirit;
    btn.hidden = !spirit || !spirit.maxHp;
    if (btn.hidden) return;
    var def = null;
    for (var i = 0; i < SPIRIT_SUMMON_TYPES.length; i++) {
      if (SPIRIT_SUMMON_TYPES[i].kind === spirit.kind) def = SPIRIT_SUMMON_TYPES[i];
    }
    btn.textContent = (def ? window.I18N.t(def.nameKey) : spirit.kind) + "(" + Math.max(0, Math.round(spirit.hp)) + "/" + spirit.maxHp + ")";
    btn.disabled = !actable;
  }

  function handleSpiritManageClick() {
    var c = characters[myTokenId];
    if (!mySlot || isPaused() || !c || !c.summonedSpirit) return;
    c.summonedSpirit = null;
    GameStorage.rtSet(gameId, "cloud", "character/" + myTokenId + "/summonedSpirit", null);
    renderCharPanel();
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
    var entries = CharacterDrawer.getEquippedWeaponSkillEntries(c).filter(function (e) {
      return e.weaponId === weaponId;
    });
    // 遺物效果「得意祈禱『雷之槍』／『燃燒吧！』」（2026-09-11）：「自身裝備中的聖印
    // 可使用該祈禱」。祈禱本體是weapons_skills.js既有的prayer_*，這裡只是把它接到目前
    // 裝備的聖印上（跟night.js的FAVORED_PRAYER_RELIC_MAP同一組對應，該表在
    // character_drawer.js內部沒有匯出，因此這裡列同一份對應，不重新定義祈禱內容）。
    if (category.id === "sacred_seal") {
      FAVORED_PRAYER_RELICS.forEach(function (def) {
        if (!hasRelicNames(c, def.names)) return;
        var skill = Weapons.getSkill(def.skillId);
        if (!skill) return;
        if (
          entries.some(function (e) {
            return e.id === "wpn:" + weaponId + ":" + def.skillId;
          })
        )
          return;
        entries.push({ id: "wpn:" + weaponId + ":" + def.skillId, name: skill.name, body: skill.body, kind: skill.kind, weaponId: weaponId });
      });
    }
    return entries;
  }

  var FAVORED_PRAYER_RELICS = [
    { names: ["得意祈禱「雷之槍」", "得意祈祷「雷の槍」"], skillId: "prayer_lightning_spear" },
    { names: ["得意祈禱「燃燒吧！」", "得意祈祷「火よ！」"], skillId: "prayer_fire_exclaim" },
    { names: ["得意祈禱「獸爪」", "得意祈祷「獣爪」"], skillId: "prayer_beast_claw" },
  ];

  function hasRelicNames(c, names) {
    return !!(c && CharacterDrawer.findLearnedRelicEffectByName && CharacterDrawer.findLearnedRelicEffectByName(c, names));
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
    if (!mySlot || isPaused() || sorceryHoldState[key] || isIceBlizzardBlinded(Date.now())) return;
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
  // 2026-09-08使用者明確要求「瀕死狀態下不能按迴避」：比照其他動作handler既有的
  // isSelfDowned()守衛（見isSelfDowned()說明），這裡原本漏加。
  // 淑女「華麗身法」（2026-09-08使用者明確要求「迴避少消耗體力2」）：判斷是否持有此
  // 被動（elegant_footwork），有則迴避成本固定-2，跟角色類型本身的passive/uses無關。
  function dodgeStaminaCost(c) {
    var type = c && c.typeId ? window.PriTestCharacterTypes.get(c.typeId) : null;
    var hasElegantFootwork =
      type &&
      (type.abilities || []).some(function (a) {
        return a.id === "elegant_footwork";
      });
    return hasElegantFootwork ? Math.max(0, STAMINA_COST_DODGE - 2) : STAMINA_COST_DODGE;
  }

  function handleDodgeClick() {
    if (isSelfDowned()) return;
    if (!spendStamina(dodgeStaminaCost(characters[myTokenId]))) return;
    cancelFlaskReadingForOtherAction();
    dodgePressedAt = Date.now();
  }

  // 特殊防禦選項（2026-09-05角色能力真正接入新增，見CLAUDE.md §36）：第六感（追蹤者被動）
  // 或遺物效果驅動的額外防禦（冰塊之棺／妖刀解放系／探求的衝擊波緩和）。規則書原文都是
  // 「視為自身進行了『HP價值：60~100』的防禦/迴避」——這個HP價值本來就足以扛下絕大多數
  // 敵人攻擊傷害（見resolveEnemyActionOutcome()），因此統一比照迴避的完全無效化處理，
  // 不做百分比減免（不新增規則書沒有的中間態）。第六感（passive、使用次數限定）跟其餘relic變體
  // （每個角色類型專屬、不會跟第六感共存）互斥，取第一個可用者。
  // 2026-09-08使用者明確要求「第六感改為被動、無法主動點選、非活性化，受到致死傷害時
  // 自動觸發」：取代原本可手動選用的sixthSense特殊防禦選項（原本靠「使用次數」限制），
  // 這裡不再把sixth_sense列入手動可選清單，改由sixthSenseSaveValue()／
  // resolveMyIncomingHit()裡的自動攔截處理，見那邊的完整說明。
  // 執行者「妖刀」（2026-09-08使用者明確要求「類似防禦效果,代替防禦能完全無效化傷害,
  // 成功防禦後體力+5」）：原文kind是"Defense"、位於type.skills（Lv2）而非type.abilities，
  // 因此另外用yotoAbilityFor()找，不跟一般Lv1被動的sixth_sense/relicVariant混在一起判斷
  // 順序，但回傳格式相容，共用handleSpecialDefenseClick()／resolveMyIncomingHit()既有的
  // "special"分支（完全無效化）。
  function yotoAbilityFor(type) {
    return type
      ? (type.skills || []).filter(function (a) {
          return a.id === "yoto";
        })[0]
      : null;
  }
  var YOTO_DEFENSE_DICE_COUNT = 2; // 對應本文「消耗：豹子（2個）」，簡化成固定2點骰子成本

  function availableSpecialDefenseOption(c, type) {
    if (!c || !type) return null;
    var yoto = yotoAbilityFor(type);
    if (yoto) return { kind: "yoto", ability: yoto };
    var variant = learnedVariantEntries(c, type).defense[0];
    return variant ? { kind: "relicVariant", entry: variant } : null;
  }

  // 實際扣資源（遺物變體依本文「消耗：N」骰子成本換算體力，跟一般戰技同一套
  // diceCostPoints×DICE_COUNT_TO_STAMINA_MULT公式；妖刀則是固定成本+使用成功後體力+5）。
  // 回傳是否扣款成功。
  function trySpendSpecialDefenseCost(c, option) {
    if (option.kind === "yoto") {
      if (!spendStamina(YOTO_DEFENSE_DICE_COUNT * DICE_COUNT_TO_STAMINA_MULT)) return false;
      stamina.current = Math.min(stamina.max, stamina.current + 5);
      return true;
    }
    var bodyText = window.PriTestCharacterTypes.localizedText(option.entry.body);
    var cost = CharacterDrawer.parseActionCost(bodyText);
    return spendStamina(diceCostPoints(cost) * DICE_COUNT_TO_STAMINA_MULT);
  }

  // 第六感（追蹤者/追蹤者暗黑被動，2026-09-08使用者明確要求改版：「被動無法主動點選、
  // 非活性化，受到致死傷害時、自動觸發此能力、能保持１滴血 維持１秒　cd:60s」，取代
  // 原本使用次數制的手動特殊防禦選項）：純函式，不在這裡寫RTDB，只回傳判斷結果，真正的
  // 冷卻/寬限時間寫入交給呼叫端在transaction的.then()裡處理（比照applyRevivalProgress()
  // 「transaction updater保持純粹、副作用留到commit後」的既有寫法，避免transaction重試
  // 導致toast/寫入被觸發多次）。
  var SIXTH_SENSE_COOLDOWN_MS = 60000;
  var SIXTH_SENSE_GRACE_MS = 1000;

  function sixthSenseAbilityFor(type) {
    return type
      ? (type.abilities || []).filter(function (a) {
          return a.id === "sixth_sense";
        })[0]
      : null;
  }

  function sixthSenseSaveValue(c, now) {
    if (!c) return null;
    if ((c._sixthSenseGraceUntil || 0) > now) return { value: 1, fresh: false };
    var type = c.typeId ? window.PriTestCharacterTypes.get(c.typeId) : null;
    var ability = sixthSenseAbilityFor(type);
    if (!ability) return null;
    if ((c._sixthSenseCooldownUntil || 0) > now) return null;
    return { value: 1, fresh: true, ability: ability };
  }

  // 觸發成功（fresh=true）時才真正寫入冷卻/寬限時間並提示——寬限期間內的後續攔截
  // （fresh=false）只是延續同一次觸發的保護視窗，不重新計時、不重複提示。
  function applySixthSenseTrigger(saveInfo) {
    var c = characters[myTokenId];
    if (!c || !saveInfo || !saveInfo.fresh) return;
    var now = Date.now();
    c._sixthSenseCooldownUntil = now + SIXTH_SENSE_COOLDOWN_MS;
    c._sixthSenseGraceUntil = now + SIXTH_SENSE_GRACE_MS;
    GameStorage.rtSet(gameId, "cloud", "character/" + myTokenId + "/_sixthSenseCooldownUntil", c._sixthSenseCooldownUntil);
    GameStorage.rtSet(gameId, "cloud", "character/" + myTokenId + "/_sixthSenseGraceUntil", c._sixthSenseGraceUntil);
    showToast(window.PriTestCharacterTypes.localizedText(saveInfo.ability.name) + "：" + window.I18N.t("midnight_sixth_sense_trigger_note"));
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
    showToast(CharacterTypes.localizedText(ability.name) + "：" + mnText(CharacterTypes.localizedText(ability.body), CharacterTypes.localizedText(ability.name)));
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

  // 2026-09-08使用者明確要求「元素操控cd:3s」：取代原本沒有冷卻、只受FP/屬性痕上限限制
  // 的節奏，避免蓄積屬性痕過快。獨立的_elementalControlCooldownUntil欄位，跟技能/技藝的
  // 通用冷卻（_skillCooldownUntil/_artCooldownUntil）分開，因為元素操控是Lv1「ability」
  // 不是Lv2/Lv3的技能/技藝，不套用「每擊破一個敵人加快cd」規則（那條只講技能/技藝）。
  var ELEMENTAL_CONTROL_COOLDOWN_MS = 3000;

  function handleElementalControlClick() {
    var c = characters[myTokenId];
    var type = c && c.typeId ? window.PriTestCharacterTypes.get(c.typeId) : null;
    var ability = elementalControlAbility(type);
    if (!mySlot || isPaused() || !c || !ability) return;
    if (Date.now() < (c._elementalControlCooldownUntil || 0)) return;
    if ((c.elementalMarks || 0) >= ELEMENTAL_MARKS_MAX) {
      showToast(window.I18N.t("midnight_elemental_control_max_note"));
      return;
    }
    if (!targetHasElementalDamage()) return;
    if (!spendStamina(ELEMENTAL_CONTROL_DICE_COUNT * DICE_COUNT_TO_STAMINA_MULT)) return;
    c.elementalMarks = Math.min(ELEMENTAL_MARKS_MAX, (c.elementalMarks || 0) + 1);
    GameStorage.rtSet(gameId, "cloud", "character/" + myTokenId + "/elementalMarks", c.elementalMarks);
    c._elementalControlCooldownUntil = Date.now() + ELEMENTAL_CONTROL_COOLDOWN_MS;
    GameStorage.rtSet(gameId, "cloud", "character/" + myTokenId + "/_elementalControlCooldownUntil", c._elementalControlCooldownUntil);
    fp.current = Math.min(fp.max, fp.current + 1);
    var CharacterTypes = window.PriTestCharacterTypes;
    showToast(CharacterTypes.localizedText(ability.name) + "：" + mnText(CharacterTypes.localizedText(ability.body), CharacterTypes.localizedText(ability.name)));
  }

  // 2026-09-08使用者明確要求「鑑定眼公開敵人現在的HP價值5s,cd:60s」：原本沒有冷卻、
  // 顯示的表格也不會自動收起，這裡補上獨立冷卻欄位（跟元素操控同理，Lv1 ability不套用
  // 「擊破加快cd」）與5秒後自動清空文字的計時器。
  var EYE_FOR_VALUE_COOLDOWN_MS = 60000;
  var EYE_FOR_VALUE_DISPLAY_MS = 5000;
  var eyeForValueHideTimer = null;

  function handleEyeForValueClick() {
    var c = characters[myTokenId];
    var type = c && c.typeId ? window.PriTestCharacterTypes.get(c.typeId) : null;
    var ability = eyeForValueAbility(type);
    var trig = activeEncounter ? fieldTriggers[activeEncounter.id] : null;
    if (!mySlot || isPaused() || !c || !ability || !trig || !trig.enemyFamilyId) return;
    if (Date.now() < (c._eyeForValueCooldownUntil || 0)) return;
    var fam = window.PriTestEnemies.getFamily(trig.enemyFamilyId);
    if (!fam) return;
    if (!spendStamina(EYE_FOR_VALUE_DICE_COUNT * DICE_COUNT_TO_STAMINA_MULT)) return;
    c._eyeForValueCooldownUntil = Date.now() + EYE_FOR_VALUE_COOLDOWN_MS;
    GameStorage.rtSet(gameId, "cloud", "character/" + myTokenId + "/_eyeForValueCooldownUntil", c._eyeForValueCooldownUntil);
    var CharacterTypes = window.PriTestCharacterTypes;
    var noteEl = el("midnight-eye-for-value-note");
    noteEl.textContent = CharacterTypes.localizedText(fam.name) + "\n" + buildGuardValueTableText(fam);
    if (eyeForValueHideTimer) clearTimeout(eyeForValueHideTimer);
    eyeForValueHideTimer = setTimeout(function () {
      eyeForValueHideTimer = null;
      noteEl.textContent = "";
    }, EYE_FOR_VALUE_DISPLAY_MS);
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
      // 守護者「高防禦」（2026-09-08使用者明確要求「盾牌防禦再多自帶10%減傷」）：只在
      // 用盾牌防禦（不是雙手持握的達人那種武器防禦）且_highGuardActive時額外+10，見
      // resolveMyIncomingHit()裡對usedShield／highGuardBonusPct的套用。
      var highGuardBonusPct = c._highGuardActive ? 10 : 0;
      return { costPoints: diceCostPoints(guardCost), pct: Math.min(100, pct + highGuardBonusPct), usedShield: true };
    }
    if (sides.length === 1 && CharacterDrawer.findLearnedRelicEffectByName(c, DUAL_GRIP_MASTER_RELIC_NAMES)) {
      return { costPoints: DUAL_GRIP_MASTER_GUARD_DICE_COUNT, pct: DUAL_GRIP_MASTER_GUARD_PCT, usedShield: false };
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
    // 一口氣飲盡（開關開啟時）一次要用掉2次使用次數，剩1次時不能發動（見commitFlaskHeal()）。
    if (res._flaskGulpMode && hasRelic(res, "flaskGulp") && res.flaskCount < 2) return;
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
    var cFlask = characters[myTokenId];
    // 2026-09-11遺物效果（兩者都是角色視窗裡的開關，見appendRelicToggle()）：
    //   一口氣飲盡：開啟時一次消耗2次使用次數，改成把HP回滿
    //   聖杯瓶可回復FP：開啟時不回HP，改回同量的FP
    // 兩個同時開啟時，「一口氣飲盡」的「回滿」對象跟著「可回復FP」變成FP回滿——
    // 規則書沒有同時開啟的規定，這是本實作的取捨（回滿的對象跟著切換走）。
    var gulpOn = !!(cFlask && cFlask._flaskGulpMode && hasRelic(cFlask, "flaskGulp"));
    var fpMode = !!(cFlask && cFlask._flaskFpMode && hasRelic(cFlask, "flaskFp"));
    var flaskUses = gulpOn ? 2 : 1;
    GameStorage.rtTransaction(gameId, "cloud", "character/" + myTokenId + "/flaskCount", function (cur) {
      var next = (cur === null ? FLASK_MAX_DEFAULT : cur) - flaskUses;
      return next < 0 ? 0 : next;
    });
    if (fpMode) {
      healSelfFp(gulpOn ? fp.max : FLASK_HEAL_AMOUNT + flaskHealBonusAmount(cFlask));
      return;
    }
    if (gulpOn) {
      var fullHp = mySelfHpMaxFallback();
      GameStorage.rtSet(gameId, "cloud", "demoStat/" + myTokenId, fullHp);
      return;
    }
    var maxHp = mySelfHpMaxFallback();
    var beforeHp = null;
    // 2026-09-10遺物效果稽核補實作：遺物效果「聖杯瓶回復量提升」在規則書是「回復量+□」，
    // night.js早就有套用（night.js:7075，healAmount＝flaskHealAmount＋getFlaskHealBonus），
    // midnight這邊卻固定回30、等於該效果完全不生效。□→即時制數值的換算沿用既有常數
    // BLOCK_SQUARE_COUNT_TO_RESOURCE_MULT（＝10，跟FLASK_HEAL_AMOUNT本身的30＝規則書3□
    // 同一套換算），不自行發明新數字。
    var flaskHeal = FLASK_HEAL_AMOUNT + flaskHealBonusAmount(characters[myTokenId]);
    GameStorage.rtTransaction(gameId, "cloud", "demoStat/" + myTokenId, function (cur) {
      beforeHp = cur === null ? maxHp : cur;
      var next = beforeHp + flaskHeal;
      return next > maxHp ? maxHp : next;
    }).then(function (committedHp) {
      // 兆し的恩寵「融合する命」（event_rulebook.js:857-858，c._fusedLife旗標見
      // maybeGrantAmbushReward()）：聖杯瓶回HP時FP同量回復。healedAmount取「這次實際回復
      // 量」（已扣掉HP已滿溢出的部分），不是固定FLASK_HEAL_AMOUNT——單純加成、無條件分支，
      // 風險低，因此結構化套用（不同於其餘「直到結束階段」類效果，這裡不需要phase reset）。
      if (committedHp === null || beforeHp === null) return;
      var c = characters[myTokenId];
      var healedAmount = committedHp - beforeHp;
      if (healedAmount <= 0) return;
      if (c && c._fusedLife) fp.current = Math.min(fp.max, fp.current + healedAmount);
      shareHealWithPartyIfEmpathyActive(healedAmount);
    });
  }

  // 遺物效果「聖杯瓶回復量提升」的加成量（見commitFlaskHeal()說明）：習得幾次就+幾□，
  // 直接用CharacterDrawer既有的getFlaskHealBonus()（純函式，回傳習得次數），這裡只負責
  // □→即時制HP的換算。
  function flaskHealBonusAmount(c) {
    if (!c || !CharacterDrawer.getFlaskHealBonus) return 0;
    return CharacterDrawer.getFlaskHealBonus(c) * BLOCK_SQUARE_COUNT_TO_RESOURCE_MULT;
  }

  // 學者「共感術」（2026-09-08使用者明確要求「之後自己的HP回復效果全體共享 10秒」）：
  // 這份專案沒有單一的「回HP」central function（各種回復來源各自獨立寫transaction，見
  // commitFlaskHeal()附近的說明），完整覆蓋所有HP回復來源工程量過大。已知簡化：只接上
  // 最常用的聖杯瓶回復（本函式），其餘來源（消耗品/祝福等）暫不共享，不假裝完整涵蓋。
  function shareHealWithPartyIfEmpathyActive(healedAmount) {
    var c = characters[myTokenId];
    if (!c || !c._empathyShareUntil || c._empathyShareUntil <= Date.now()) return;
    Object.keys(players || {}).forEach(function (slot) {
      var p = players[slot];
      if (!p || !p.tokenId || p.tokenId === myTokenId) return;
      var targetMax = selfArenaHpMax(characters[p.tokenId]);
      GameStorage.rtTransaction(gameId, "cloud", "demoStat/" + p.tokenId, function (cur) {
        var current = cur === null ? targetMax : cur;
        return Math.min(targetMax, current + healedAmount);
      });
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
  // ---- 學者「道具效果擴大」（2026-09-11）----
  // 規則書：「自身使用消耗品『聖杯瓶／勇者的肉塊／龜首漬／星光碎片／苔玉』時，可對自身
  // 以外的任意1名PC也發揮相同效果」。midnight沒有目標選擇UI，對象固定取隊伍中第一位其他PC
  // （比照聖光燈火等既有簡化）。
  // **已知限制**：這5項裡只有「勇者的肉塊」等會動到HP的部分能真的施加在別人身上——
  // FP與體力骰、以及「直到階段結束的自身buff」在midnight都是**各自裝置的本地資源/旗標**
  // （見fp／stamina／c._xxx欄位說明），無法從我的裝置寫進別人的本地狀態。因此這裡只
  // 複製得了HP回復的部分，其餘維持只對自己生效，並在toast提示玩家手動處理，不假裝完整涵蓋。
  var THRIFT_CHANCE = 0.2; // 學者「節約術」：使用者明確規格「20%機率」
  var ITEM_EXPAND_TARGET_ITEM_IDS = [
    "item_hero_meat_chunk",
    "item_turtle_neck_pickle",
    "item_shard_of_starlight",
    "item_bitter_medicine", // 苔藥（使用者寫「苔玉」，consumables.js 裡的名稱是苔藥）
  ];

  function applyItemEffectExpand(c, itemId) {
    if (ITEM_EXPAND_TARGET_ITEM_IDS.indexOf(itemId) === -1) return;
    var otherTokenId = firstOtherPcTokenId();
    if (!otherTokenId) return;
    // 這些消耗品的效果有一部分是「對方裝置上的本地資源/旗標」（FP、體力、_xxxUntil buff），
    // 我的裝置寫不進去，因此改成廣播一則指示給對方的角色節點，由**對方自己的裝置**在
    // onCharactersReceived() 收到時套用同一支applyMidnightConsumableEffect()——
    // 跟既有的_lastTileRewardNote（板塊獎勵toast）完全同一種「寫到對方角色上、對方自己
    // 處理」的模式，效果因此能完整生效，不需要在這裡逐項重寫一份。
    GameStorage.rtSet(gameId, "cloud", "character/" + otherTokenId + "/_sharedItemEffect", { itemId: itemId, at: Date.now() });
    var item = window.PriTestConsumables.get(itemId);
    showToast(
      window.I18N.t("midnight_item_expand_toast", {
        item: item ? window.PriTestConsumables.localizedText(item.name) : itemId,
      })
    );
  }

  function applyMidnightConsumableEffect(c, itemId) {
    var applyLevel2 = hasCarriedKnowledge(c);
    // 丟擲/噴霧動畫（2026-09-08新增）：跟下面的數值套用分支無關，只要是對敵人使用的
    // 丟擲類消耗品就播放，MIDNIGHT_CONSUMABLE_TIMED_OR_UNRESOLVED項目（如投擲短劍／
    // 扇投暗器／火炎壺）沒有對應的數值分支，但一樣需要動畫回饋。
    triggerConsumableThrowEffect(itemId);
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
    } else if (itemId === "item_bone_poison_dart") {
      // 「毒：1D」：2026-08-24使用者裁定，沒有額外擲骰指示時Xd視為固定值X（見docs/
      // enemy_damage_rules.md §1.1）。等級2額外造成【總合傷害：15】（night.js:7808-7809）。
      recordAttributeAccum("猛毒", 1);
      if (applyLevel2) {
        damageCombatTarget(15);
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
    if (!mySlot || isPaused() || isSelfDowned()) return;
    var c = characters[myTokenId];
    var inst = c && c.consumables && c.consumables[0];
    if (!inst) return;
    var item = window.PriTestConsumables.get(inst.itemId);
    // 石劍鑰匙／鍛造石：這兩個是「持有即生效」的鑰匙類道具（見handleEnterFieldPointClick／
    // 商人鍛造台的持有檢查），不是點一下就耗用的消耗品，按快速使用鍵只顯示提示，不扣
    // usesRemaining——避免玩家誤按就把鑰匙用掉。
    if (item && item.noStackLimit) {
      showToast(window.PriTestConsumables.localizedText(item.name) + "：" + mnText(window.PriTestConsumables.localizedText(item.body), window.PriTestConsumables.localizedText(item.name)));
      return;
    }
    cancelFlaskReadingForOtherAction();
    // 學者「節約術」（2026-09-11使用者明確規格「使用消耗品時，20%機率，則將該消耗品的
    // 使用次數回復○1個」）：等同「這次不扣使用次數」。機率在transaction外先擲，避免
    // transaction重試時重複擲骰造成機率失真。
    var thriftSaved = hasRelic(c, "thrift") && Math.random() < THRIFT_CHANCE;
    if (!thriftSaved) {
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
    }
    if (item) {
      applyMidnightConsumableEffect(c, inst.itemId);
      if (thriftSaved) showToast(window.I18N.t("midnight_thrift_toast"));
      // 學者「道具效果擴大」（2026-09-11）：「使用消耗品『聖杯瓶／勇者的肉塊／龜首漬／
      // 星光碎片／苔玉』時，可對自身以外的任意1名PC也發揮相同效果」——對象取隊伍中第一位
      // 其他PC（midnight沒有目標選擇UI，比照聖光燈火等既有簡化）。
      if (hasRelic(c, "itemEffectExpand")) applyItemEffectExpand(c, inst.itemId);
      var autoApplied = !MIDNIGHT_CONSUMABLE_TIMED_OR_UNRESOLVED[inst.itemId];
      var suffix = autoApplied
        ? window.I18N.t("midnight_consumable_auto_applied_note")
        : window.I18N.t("midnight_consumable_manual_note");
      showToast(window.PriTestConsumables.localizedText(item.name) + "：" + mnText(window.PriTestConsumables.localizedText(item.body), window.PriTestConsumables.localizedText(item.name)) + suffix);
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
    if (!mySlot || isPaused() || isSelfDowned()) return;
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
    // 送葬人「恍惚」（2026-09-08使用者明確要求「使用後體力額外1秒恢復2點...持續狀態3秒」）：
    // 疊加在既有回復速率之上，見applyMidnightAbilityPostEffect()寫入_tranceUntil。
    var c = characters[myTokenId];
    var extraRegenPerSec = c && c._tranceUntil && c._tranceUntil > Date.now() ? 2 : 0;
    // 2026-09-11遺物效果（使用者明確規格的即時制對應）：
    //   「防禦階段開始時體力骰回復」→ 體力上限+10（習得幾個就+幾個10）
    //   「回合結束時，體力骰帶入1個」→ 體力在10%以下時，回復速度+2/秒
    var maxBonus = countRelic(c, "staminaMaxPlus") * RELIC_STAMINA_MAX_BONUS;
    stamina.max = STAMINA_MAX + maxBonus;
    if (hasRelic(c, "staminaLowRegen") && stamina.current <= stamina.max * RELIC_STAMINA_LOW_PCT) {
      extraRegenPerSec += RELIC_STAMINA_LOW_REGEN;
    }
    stamina.current = Math.min(stamina.max, stamina.current + (myStaminaRegenPerSec + extraRegenPerSec) * dtSec);
  }

  var RELIC_STAMINA_MAX_BONUS = 10;
  var RELIC_STAMINA_LOW_PCT = 0.1;
  var RELIC_STAMINA_LOW_REGEN = 2;

  // ============================================================================
  // 敵人攻擊（2026-09-05新增，見上方ENEMY_ATTACK_*常數區塊的設計決定與資料來源說明）。
  // 只在activeEncounter存在時（同一板塊、同一籌碼事件、敵人仍存活）才會運作，
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

  // 遺物效果「轉身之步」（2026-09-11使用者明確規格「自身進行迴避時，判定窗口可以增加
  // (+0.2s)」）：反應窗口本身是「這名玩家自己的裝置」在算的本地計時（見
  // updateMyIncomingAttack()），因此直接加在這裡即可，不需要同步給其他玩家。
  // 習得多個就疊加（跟其餘可疊加遺物同一慣例）。
  var TURN_STEP_WINDOW_BONUS_MS = 200;

  function enemyAttackHitWindowMs(hitIndex) {
    var idx = Math.max(0, Math.min(hitIndex, ENEMY_ATTACK_HIT_WINDOW_MS.length - 1));
    return ENEMY_ATTACK_HIT_WINDOW_MS[idx] + countRelic(characters[myTokenId], "turnStep") * TURN_STEP_WINDOW_BONUS_MS;
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

  // 這場遭遇算不算「上位敵人」（決定連續命中次數的機率表，見ENEMY_ATTACK_HIT_COUNT_WEIGHTS_*）：
  // 使用者明確列舉的五類——強敵籌碼／封牢（evergaol）／特殊強敵／夜之強敵／夜之王。
  // 判斷全部用既有的既定識別方式，不新增資料欄位：
  //   - 夜之王：固定id DAY3_BOSS_POINT_ID（見該常數說明）。
  //   - 夜之強敵：rollAndAssignFinalCircleBoss()寫入的固定id "finalCircleDay1"／"finalCircleDay2"。
  //   - 強敵籌碼／封牢：地圖點自己的type（見NON_FIELD_POINT_TYPES／handleFieldEnterClick()）。
  //   - 特殊強敵：Day2「⑧恐るべき強敵」——既有的meta.terrifyingStrongEnemyPointId
  //     （同一個欄位已經在maybeGrantStrongEnemyReward()用來給高倍獎勵，語意一致）。
  //   - 隨機事件「隕石」分支的王戰：資料上沒有type可分，但它是貨真價實的王戰（走跟強敵
  //     完全相同的上方資訊欄＋[進入戰鬥]流程，見encounterEnemyPoint()），因此以
  //     「random_event且已指派enemyFamilyId」認定為上位敵人。
  function isEliteEncounterPoint(pt, trig) {
    if (!pt) return false;
    if (pt.id === DAY3_BOSS_POINT_ID) return true;
    if (pt.id === "finalCircleDay1" || pt.id === "finalCircleDay2") return true;
    if (pt.type === "strong_enemy" || pt.type === "evergaol") return true;
    if (meta && meta.terrifyingStrongEnemyPointId === pt.id) return true;
    if (pt.type === "random_event" && trig && trig.enemyFamilyId) return true;
    return false;
  }

  function pickEnemyAttackHitCount(pt, trig) {
    var weights = isEliteEncounterPoint(pt, trig) ? ENEMY_ATTACK_HIT_COUNT_WEIGHTS_ELITE : ENEMY_ATTACK_HIT_COUNT_WEIGHTS_NORMAL;
    return pickWeightedIndex(Math.random(), weights) + 1;
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
    var slots = targetableParticipantSlots(trig); // 瀕死中的玩家排除在夜王選招目標之外，見上方說明
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
      // 淑女「終曲」：「敵人不行動」持續10秒（見applyMidnightAbilityPostEffect()寫入
      // enemyStunnedUntil）——不是no-op跳過，而是直接把下一次攻擊排程延後到禁閉結束的
      // 時間點，確保禁閉結束後仍會正常排下一次攻擊（見下方transaction commit後對
      // enemyAttackStartAttempted[pt.id]的重置，避免no-op造成本地節流卡死）。
      if (cur.enemyStunnedUntil && Date.now() < cur.enemyStunnedUntil) {
        var stunOut = {};
        for (var sk in cur) stunOut[sk] = cur[sk];
        stunOut.nextAttackAt = cur.enemyStunnedUntil;
        return stunOut;
      }
      // 體崩中（2026-09-11，使用者明確規格「此期間…不會進行任何攻擊」）：跟「終曲」的
      // 禁閉同一種處理——把下一次攻擊排程延後到體崩結束，而不是靜默跳過，確保體崩結束後
      // 仍會正常排下一次攻擊。
      if (cur.staggerUntil && Date.now() < cur.staggerUntil) {
        var stgOut = {};
        for (var gk in cur) stgOut[gk] = cur[gk];
        stgOut.nextAttackAt = cur.staggerUntil;
        return stgOut;
      }
      // 瀕死中的玩家不會被敵人指定為目標（2026-09-08使用者明確要求），見
      // targetableParticipantSlots()說明；夜王分支的目標選擇改在pickAndResolveBossAction()
      // 內部經由bossAutoGmBattleState()套用同一個篩選，這裡的slots只用在一般敵人分支。
      var slots = targetableParticipantSlots(cur);
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
          // 夜之王一定落在上位敵人那組機率（1~3下），見pickEnemyAttackHitCount()。
          hitCount: pickEnemyAttackHitCount(pt, cur),
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
      // 無賴漢「圖騰・史黛拉」（-300持續5秒）／學者「探求」（-180持續5秒）共用同一組
      // fieldTrigger欄位（groupDamageReduceUntil＋groupDamageReduceAmount，見
      // applyMidnightAbilityPostEffect()），只影響亂戰傷害（outcome.kind==="group"），
      // 個別傷害不受影響，扣到0為底不會變成負傷害。兩者理論上不會同時生效（各自角色專屬
      // 技藝/技能），若真的前後疊加，後寫入的會覆蓋前者的量與時限——已知簡化，不做兩組
      // 獨立疊加。
      if (outcome.kind === "group" && cur.groupDamageReduceUntil && Date.now() < cur.groupDamageReduceUntil) {
        outcome.amount = Math.max(0, outcome.amount - (cur.groupDamageReduceAmount || 300));
      }
      var targetSlots;
      if (outcome.kind === "group") {
        var count = Math.min(slots.length, Math.floor(Math.random() * 3) + 1);
        var pool = slots.slice();
        targetSlots = [];
        for (var i = 0; i < count && pool.length; i++) {
          targetSlots.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
        }
      } else {
        // 敵視持有者若剛好瀕死（已經不在篩選過的slots名單內），不能再被指定，退回隨機選一個
        // 還能被打的參與者（見targetableParticipantSlots()說明）。
        var aggroSlot = aggroHolderSlot(cur);
        if (aggroSlot && slots.indexOf(aggroSlot) === -1) aggroSlot = null;
        targetSlots = [aggroSlot || slots[Math.floor(Math.random() * slots.length)]];
      }
      out.enemyAttack = {
        attackId: pt.id + ":" + Date.now(),
        targetSlots: targetSlots,
        hitCount: pickEnemyAttackHitCount(pt, cur), // 依敵人等級分兩組機率，見該函式說明
        warnAt: Date.now(),
        actionName: action ? action.name : null,
        actionMod: action ? action.mod : null, // 供resolveMyIncomingHit解析這一招實際附帶的屬性
        dmgKind: outcome.kind,
        dmgAmount: outcome.amount,
      };
      out.nextAttackAt = null; // 這次攻擊收尾時（maybeFinishEnemyAttack）才會再排下一次
      return out;
    }).then(function () {
      // 2026-09-08新增（終曲禁閉延後排程前置工程）：不管這次commit是真的排了攻擊還是
      // 只是把nextAttackAt延後到禁閉結束時間，都重置本地節流旗標，讓下一輪
      // maybeStartEnemyAttack()可以在nextAttackAt到期後重新嘗試——no-op的舊寫法只在
      // trig.enemyAttack變true時才重置，禁閉延後的commit不會讓enemyAttack變true，
      // 若不在這裡補重置會卡死、永遠不再嘗試排下一次攻擊。
      enemyAttackStartAttempted[pt.id] = false;
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
  // 防禦（block）成功時的遺物效果（2026-09-11）：
  //   ・防禦成功時HP回復：「先對自身施加『HP回復：□』，之後再處理HP損害」——因此在
  //     扣血計算之前呼叫（本函式在showActionFlash那一段被呼叫，早於下方的damage transaction）。
  //   ・防禦反擊：規則書要「支付骰子消耗3對敵人造成1Hit傷害」，使用者2026-09-11改成
  //     「下一個攻擊消費體力-25%（可疊加）」——改存成角色欄位，由handleAttackClick()
  //     的體力計算讀取（見guardCounterDiscountPct()）。斧槍版的「+15」在原規則是反擊
  //     傷害加成，改成折扣制後沒有對應的數值出口，維持不生效（見
  //     docs/midnight_relic_effects_audit.md 的已知限制）。
  var GUARD_COUNTER_DISCOUNT_PCT = 25;

  function applyGuardSuccessRelics() {
    var c = characters[myTokenId];
    if (!c) return;
    if (hasRelic(c, "guardHpRecover")) healSelfHp(BLOCK_SQUARE_COUNT_TO_RESOURCE_MULT);
    if (hasRelic(c, "guardCounter") && hasMeleeWeaponEquipped(c)) {
      var stacks = (c._guardCounterStacks || 0) + countRelic(c, "guardCounter");
      c._guardCounterStacks = stacks;
      GameStorage.rtSet(gameId, "cloud", "character/" + myTokenId + "/_guardCounterStacks", stacks);
    }
  }

  // 下一次攻擊的體力折扣百分比（防禦反擊，可疊加，上限夾在100%以內避免變成免費/負值）。
  function guardCounterDiscountPct(c) {
    var stacks = (c && c._guardCounterStacks) || 0;
    return Math.min(100, stacks * GUARD_COUNTER_DISCOUNT_PCT);
  }

  function consumeGuardCounterDiscount(c) {
    if (!c || !c._guardCounterStacks) return;
    c._guardCounterStacks = 0;
    GameStorage.rtSet(gameId, "cloud", "character/" + myTokenId + "/_guardCounterStacks", 0);
  }

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
      applyGuardSuccessRelics();
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
      // 連續命中（2026-09-10，見ENEMY_ATTACK_HIT_COUNT_WEIGHTS_*）：使用者明確規格
      // 「首擊全額，後續每下半額」——st.hitIndex是0-based，第0下全額、之後每下×0.5。
      // 乘在「÷10換算成即時制傷害」之後、測試模式倍率之前，維持既有計算鏈的順序不變。
      var hitMult = st.hitIndex > 0 ? ENEMY_ATTACK_FOLLOWUP_HIT_DAMAGE_MULT : 1;
      var rawDamage = Math.round(((st.dmgAmount || 0) / 10) * hitMult * testMult("enemyAtkMult"));
      var damage = kind === "block" ? Math.round(rawDamage * (1 - blockPct / 100)) : rawDamage;
      // 無賴漢「逆襲」暫時自身減傷（見activeTempGuardPct()說明）：跟block百分比是分開的
      // 疊加來源，即使這次kind===hit（沒有按防禦）也套用。
      var tempGuardPct = activeTempGuardPct(characters[myTokenId], Date.now());
      if (tempGuardPct) damage = Math.round(damage * (1 - tempGuardPct / 100));
      // 守護者「救世之翼」的全隊暫時不受傷害（見partyNoDamageActive()說明）：完全無效化
      // 這次HP損害，比照迴避/特殊防禦的既有慣例，不進入下面的demoStat transaction。
      if (partyNoDamageActive()) damage = 0;
      lastEnemyDamageInfo = { amount: damage, at: Date.now() };
      var maxHp = mySelfHpMaxFallback();
      // 第六感自動觸發（見sixthSenseSaveValue()說明）／不死行軍・逆襲的暫時瀕死免疫（見
      // selfDeathImmuneActive()說明）：只在這次傷害會把HP打到<=0時才嘗試攔截，updater本身
      // 保持純粹（只讀local狀態、不寫RTDB），實際冷卻/提示的副作用放到.then()對照最終
      // commit結果後才處理，避免transaction重試造成重複觸發。
      var sixthSenseResult = null;
      var immuneApplied = false;
      GameStorage.rtTransaction(gameId, "cloud", "demoStat/" + myTokenId, function (cur) {
        var next = (cur === null ? maxHp : cur) - damage;
        sixthSenseResult = null;
        immuneApplied = false;
        if (next <= 0) {
          if (selfDeathImmuneActive(characters[myTokenId], Date.now())) {
            immuneApplied = true;
            next = 1;
          } else {
            sixthSenseResult = sixthSenseSaveValue(characters[myTokenId], Date.now());
            if (sixthSenseResult) next = sixthSenseResult.value;
          }
        }
        return next < 0 ? 0 : next;
      }).then(function (result) {
        if (sixthSenseResult) {
          applySixthSenseTrigger(sixthSenseResult);
        } else if (!immuneApplied && result === 0) {
          maybeTriggerNearDeath(myTokenId);
        }
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
  // 2026-09-10使用者明確要求「來自敵人的刀光多定義不同方向的刀光，讓每次閃的位置都不同」：
  // 6種變體class（角度／落點各異，實際漸層定義見style.css），每次攻擊隨機挑一種。純視覺，
  // 不影響任何判定，因此用本地Math.random()即可，不需要同步到其他裝置——每個玩家看到的
  // 刀光角度不同並不會造成規則上的不一致。
  var ENEMY_SLASH_EFFECT_CLASSES = [
    "midnight-attack-effect-slash",
    "midnight-attack-effect-slash-2",
    "midnight-attack-effect-slash-3",
    "midnight-attack-effect-slash-4",
    "midnight-attack-effect-slash-5",
    "midnight-attack-effect-slash-6",
  ];

  function triggerAttackEffect() {
    var effectEl = el("midnight-attack-effect");
    effectEl.className = ENEMY_SLASH_EFFECT_CLASSES[Math.floor(Math.random() * ENEMY_SLASH_EFFECT_CLASSES.length)];
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

  // 消耗品丟擲動畫對照表（2026-09-08使用者明確要求「使用消耗品時...對敵人丟出火焰壺、
  // 飛刀、調香瓶等等動畫，顏色改以屬性的顏色」）：icon純粹是文字emoji（不是圖片素材），
  // element對到ENEMY_HIT_ELEMENT_COLOR_RULES同一份顏色表（null＝物理/無屬性＝白色）。
  // 只列出「對象：敵人」的丟擲/噴霧類消耗品——item_perfume_iron_pot_spray（對象：自身）、
  // item_perfume_uplifting_aroma（對象：全體PC）不是丟給敵人的，不列在這裡。
  // item_throwing_pot的「X屬性」依取得場地而定（■，見consumables.jsのbody），沒有標示
  // 時規則書本身寫死預設「投擲壺(炎)」，這裡的預設色沿用該規則書預設值，不是自行發明。
  var MIDNIGHT_CONSUMABLE_THROW_STYLE = {
    item_throwing_dagger: { icon: "🗡️", element: null },
    item_azure_throwing_knife: { icon: "🗡️", element: null },
    item_bone_poison_dart: { icon: "🏹", element: "毒" },
    item_folding_shuriken: { icon: "✳️", element: null },
    item_throwing_pot: { icon: "🏺", element: "炎" },
    item_perfume_acid_spray: { icon: "💨", element: null },
    item_perfume_spark_aroma: { icon: "💨", element: "炎" },
    item_perfume_poison_spray: { icon: "💨", element: "毒" },
  };

  function triggerConsumableThrowEffect(itemId) {
    var style = MIDNIGHT_CONSUMABLE_THROW_STYLE[itemId];
    if (!style || !activeEncounter) return;
    var effectEl = el("midnight-consumable-throw-effect");
    if (!effectEl) return;
    var color = style.element ? enemyHitColorFromEffects([{ label: style.element }]) : ENEMY_HIT_NO_ELEMENT_COLOR;
    effectEl.textContent = style.icon;
    effectEl.style.setProperty("--throw-color", color);
    effectEl.hidden = false;
    effectEl.classList.remove("midnight-consumable-throw-effect-play");
    void effectEl.offsetWidth; // 強制reflow，讓連續使用時animation能重新播放
    effectEl.classList.add("midnight-consumable-throw-effect-play");
    if (consumableThrowEffectTimer) clearTimeout(consumableThrowEffectTimer);
    consumableThrowEffectTimer = setTimeout(function () {
      effectEl.hidden = true;
      triggerEnemyHitEffect(color); // 丟擲物落地＝命中，銜接既有命中刀光特效
    }, CONSUMABLE_THROW_EFFECT_DISPLAY_MS);
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
    if (!mySlot || isPaused() || isSelfDowned()) return;
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

  // 2026-09-07改版（設計文件§4.1）：兩數四則運算題目改為window.PriTestMidnightPuzzles
  // 提供的6種參數化謎題（純函式產生器，見midnight_puzzles.js），本檔只負責依puzzle.kind
  // 分派到對應renderer、呼叫check()判定答案。解謎成功後的獎勵改為12骰牌型抽獎
  // （設計文件§4.2，見Task 11新增的startTowerDiceHandReward()），不再是固定盧恩數。
  function startTowerPuzzle(pt) {
    if (towerSolved[pt.id]) return;
    var puzzle = window.PriTestMidnightPuzzles.generate();
    towerPuzzleState[pt.id] = { puzzle: puzzle, pointId: pt.id };
    renderTowerPuzzleModal(pt, puzzle);
  }

  function renderTowerPuzzleModal(pt, puzzle) {
    var container = el("midnight-tower-puzzle-body");
    container.innerHTML = "";
    el("midnight-tower-puzzle-wrong-note").hidden = true;
    var renderers = {
      numberGuess: renderNumberGuessPuzzle,
      chickenRabbit: renderSingleAnswerPuzzle,
      weighing: renderSingleAnswerPuzzle,
      bridge: renderSingleAnswerPuzzle,
      logicElimination: renderLogicEliminationPuzzle,
      sequence: renderSingleAnswerPuzzle,
    };
    renderers[puzzle.kind](pt, puzzle, container);
    el("midnight-tower-puzzle-modal").hidden = false;
  }

  var TOWER_PROMPT_KEYS = {
    chickenRabbit: "midnight_tower_prompt_chicken_rabbit",
    weighing: "midnight_tower_prompt_weighing",
    bridge: "midnight_tower_prompt_bridge",
    sequence: "midnight_tower_prompt_sequence",
  };

  function renderSingleAnswerPuzzle(pt, puzzle, container) {
    var promptText;
    if (puzzle.kind === "chickenRabbit") promptText = window.I18N.t(TOWER_PROMPT_KEYS.chickenRabbit, { h: puzzle.H, f: puzzle.F });
    else if (puzzle.kind === "weighing") promptText = window.I18N.t(TOWER_PROMPT_KEYS.weighing, { n: puzzle.N });
    else if (puzzle.kind === "bridge") promptText = window.I18N.t(TOWER_PROMPT_KEYS.bridge, { times: puzzle.times.join("、") });
    else promptText = window.I18N.t(TOWER_PROMPT_KEYS.sequence, { seq: puzzle.sequence.join("、") });
    var p = document.createElement("p");
    p.textContent = promptText;
    var input = document.createElement("input");
    input.type = "number";
    input.id = "midnight-tower-answer-input";
    var btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = window.I18N.t("midnight_tower_submit_button");
    btn.addEventListener("click", function () {
      var result = window.PriTestMidnightPuzzles.check(puzzle.kind, puzzle, input.value);
      handleTowerPuzzleResult(pt, result.solved);
    });
    container.appendChild(p);
    container.appendChild(input);
    container.appendChild(btn);
  }

  function renderNumberGuessPuzzle(pt, puzzle, container) {
    var p = document.createElement("p");
    p.textContent = window.I18N.t("midnight_tower_prompt_number_guess");
    var input = document.createElement("input");
    input.type = "text";
    input.maxLength = 4;
    input.pattern = "[0-9]{4}";
    var resultLine = document.createElement("p");
    var btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = window.I18N.t("midnight_tower_guess_button");
    btn.addEventListener("click", function () {
      var digits = String(input.value).split("").map(Number);
      if (digits.length !== 4 || digits.some(isNaN)) return;
      var result = window.PriTestMidnightPuzzles.check("numberGuess", puzzle, digits);
      resultLine.textContent = window.I18N.t("midnight_tower_number_guess_result", { a: result.a, b: result.b });
      if (result.solved) handleTowerPuzzleResult(pt, true);
    });
    container.appendChild(p);
    container.appendChild(input);
    container.appendChild(btn);
    container.appendChild(resultLine);
  }

  function renderLogicEliminationPuzzle(pt, puzzle, container) {
    var p = document.createElement("p");
    p.textContent = window.I18N.t("midnight_tower_prompt_logic_elimination");
    var clueList = document.createElement("ul");
    // 2026-09-07修正（見midnight_puzzles.js的genLogicElimination註解）：clue是{higher,lower}
    // 結構化資料，這裡才是唯一組合成使用者可見文字的地方，因此透過window.I18N.t()翻譯，
    // 不再直接顯示pure-data模組裡硬編碼的繁體中文字串。
    puzzle.clues.forEach(function (clue) {
      var li = document.createElement("li");
      li.textContent = window.I18N.t("midnight_tower_logic_clue", { higher: clue.higher, lower: clue.lower });
      clueList.appendChild(li);
    });
    var select = document.createElement("select");
    puzzle.names.forEach(function (name) {
      var opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      select.appendChild(opt);
    });
    var btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = window.I18N.t("midnight_tower_submit_button");
    btn.addEventListener("click", function () {
      var result = window.PriTestMidnightPuzzles.check("logicElimination", puzzle, select.value);
      handleTowerPuzzleResult(pt, result.solved);
    });
    container.appendChild(p);
    container.appendChild(clueList);
    container.appendChild(select);
    container.appendChild(btn);
  }

  // 解謎成功：本地標記towerSolved並寫回RTDB（不再用transaction搶「誰先解開」——新設計
  // 下每個參與者各自解自己的謎題、各自獲得一份12骰牌型獎勵，不是「搶到才有獎勵」，見
  // startTowerDiceHandReward()裡對myTokenId角色發獎的寫法，不需要靠transaction判斷唯一
  // solvedBy）。解謎失敗：只顯示「答案不對」提示，不關閉modal，讓玩家可以重新作答。
  function handleTowerPuzzleResult(pt, solved) {
    if (!solved) {
      el("midnight-tower-puzzle-wrong-note").hidden = false;
      return;
    }
    el("midnight-tower-puzzle-modal").hidden = true;
    delete towerPuzzleState[pt.id];
    towerSolved[pt.id] = true;
    GameStorage.rtSet(gameId, "cloud", "towerSolved/" + pt.id, true);
    startTowerDiceHandReward(pt); // Task 11
  }

  // ---- 塔謎題12骰牌型獎勵（設計文件§4.2，Task 10遺留的forward reference在此實作）----
  // 解謎成功後每個參與者各自擲12顆骰子，可以任選其中幾顆重骰一次（單次限定），確定後用
  // window.PriTestMidnightPuzzles.judgeDiceHand()（Task 9，跟night.js版
  // static/night_floor_breakthrough.jsのjudgeDiceHand()同一套五種牌型規則：sevenDice/
  // large/small/straight/default）判定牌型，依下表發獎。「杖」品項用
  // window.PriTestCharacterDrawer.drawWeaponFromCategory()（本檔案這次新增，見
  // character_drawer.js，category固定不隨機、其餘完全複用merchantDrawWeapon同一套
  // pickWeaponByRoll/lookupRarityBySum規則與weaponId格式）單獨處理；其餘武器/塔利斯曼/
  // 消耗品改推進pendingRewards佇列（2026-09-09改版，見handleTowerDiceConfirm()），
  // 統一由玩家開獎勵清單抽選/確認取得，不再走grantLootRewardEntryToCharacter()直接授予。
  var TOWER_DICE_HAND_REWARDS = {
    sevenDice: [
      { kind: "staffStar", value: 2 },
      { kind: "weaponStar", value: 3 },
      { kind: "talisman" },
      { kind: "consumable", itemId: "item_shard_of_starlight", count: 2 },
    ],
    large: [
      { kind: "staffStar", value: 2 },
      { kind: "weaponStar", value: 2 },
      { kind: "talisman" },
      { kind: "consumable", itemId: "item_shard_of_starlight", count: 1 },
    ],
    small: [
      { kind: "staffStar", value: 2 },
      { kind: "weaponStar", value: 2 },
      { kind: "consumable", itemId: "item_shard_of_starlight", count: 1 },
    ],
    straight: [
      { kind: "staffStar", value: 2 },
      { kind: "weaponStar", value: 2 },
      { kind: "weaponStar", value: 1 },
      { kind: "consumable", itemId: "item_shard_of_starlight", count: 1 },
    ],
    default: [
      { kind: "staffStar", value: 1 },
      { kind: "weaponStar", value: 1 },
      { kind: "consumable", itemId: "item_shard_of_starlight", count: 1 },
    ],
  };

  var towerDiceState = {}; // pointId -> { dice: [1..6 x12], rerolled: bool }

  function startTowerDiceHandReward(pt) {
    var dice = [];
    for (var i = 0; i < 12; i++) dice.push(1 + Math.floor(Math.random() * 6));
    towerDiceState[pt.id] = { dice: dice, rerolled: false };
    renderTowerDiceHandModal(pt);
  }

  function renderTowerDiceHandModal(pt) {
    var state = towerDiceState[pt.id];
    var container = el("midnight-tower-dice-hand-body");
    container.innerHTML = "";
    state.dice.forEach(function (value, idx) {
      var die = document.createElement("button");
      die.type = "button";
      die.className = "midnight-tower-die midnight-tower-die-flip"; // CSS処理：追加時に5回転してから静止する
      die.textContent = String(value);
      die.dataset.selected = "false";
      die.addEventListener("click", function () {
        if (state.rerolled) return; // 已經重骰過一次，不能再選（單次限定）
        var sel = die.dataset.selected === "true";
        die.dataset.selected = sel ? "false" : "true";
        die.classList.toggle("midnight-tower-die-selected", !sel);
      });
      container.appendChild(die);
    });
    el("btn-midnight-tower-dice-reroll").hidden = state.rerolled;
    el("btn-midnight-tower-dice-reroll").onclick = function () {
      handleTowerDiceReroll(pt);
    };
    el("btn-midnight-tower-dice-confirm").onclick = function () {
      handleTowerDiceConfirm(pt);
    };
    el("midnight-tower-dice-hand-modal").hidden = false;
  }

  function handleTowerDiceReroll(pt) {
    var state = towerDiceState[pt.id];
    if (state.rerolled) return;
    var dieEls = el("midnight-tower-dice-hand-body").querySelectorAll(".midnight-tower-die");
    dieEls.forEach(function (dieEl, idx) {
      // 只重骰玩家有標記選取的那幾顆，其餘保留原本出目——這是這個功能的核心規則。
      if (dieEl.dataset.selected === "true") {
        state.dice[idx] = 1 + Math.floor(Math.random() * 6);
      }
    });
    state.rerolled = true;
    renderTowerDiceHandModal(pt); // 整批重新render：重骰後的骰子也會重播一次flip動畫
  }

  function handleTowerDiceConfirm(pt) {
    var state = towerDiceState[pt.id];
    if (!state) return;
    var handId = window.PriTestMidnightPuzzles.judgeDiceHand(state.dice);
    var rewardSpecs = TOWER_DICE_HAND_REWARDS[handId] || TOWER_DICE_HAND_REWARDS.default;
    var c = characters[myTokenId];
    if (!c) return;
    // 2026-09-09改版：staffStar維持立即抽選武器（跟merchantDrawWeapon同款「抽選前先判斷
    // 空間」的既有慣例，抽選本身有副作用不能延後），其餘kind改推進pendingRewards佇列，
    // 統一由玩家自己開獎勵清單抽選/確認取得，不再背景直接授予+toast。
    var labels = [];
    var anyFull = false;
    rewardSpecs.forEach(function (spec) {
      if (spec.kind === "staffStar") {
        // merchantDrawWeapon同様、hasInventorySpace判定は「抽選する前」に行う――抽選自体は
        // drawWeaponFromCategory内部でc.weaponIdsへ直接pushしてしまうため、抽選後に判定して
        // 弾くと「実際には手に入っていないのにweaponIdsへ残る」不整合が起きる。
        if (!hasInventorySpace(c, "weapon")) {
          anyFull = true;
          return;
        }
        var drawn = window.PriTestCharacterDrawer.drawWeaponFromCategory(c, "staff", spec.value);
        if (drawn) labels.push(window.PriTestWeapons.localizedText(drawn.item.name));
      } else if (spec.kind === "weaponStar") {
        pushPendingReward(myTokenId, { kind: "weaponStar", value: spec.value });
      } else if (spec.kind === "talisman") {
        pushPendingReward(myTokenId, { kind: "talisman" });
      } else if (spec.kind === "consumable") {
        for (var i = 0; i < spec.count; i++) pushPendingReward(myTokenId, { kind: "consumable", itemId: spec.itemId });
      }
    });
    GameStorage.rtSet(gameId, "cloud", "character/" + myTokenId, c);
    el("midnight-tower-dice-hand-modal").hidden = true;
    var toastText = labels.length ? window.I18N.t("midnight_reward_toast_prefix") + labels.join("、") : "";
    if (anyFull) toastText = toastText + (toastText ? "　" : "") + window.I18N.t("midnight_inventory_full_note");
    if (toastText) showToast(toastText);
    delete towerDiceState[pt.id];
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
  // Q（card_q「地變」）的varianceNote明確寫「此場地的內容會依劇本而變化，此外請留意各
  // 場地的樓層數不同」——card_q本身雖有floorCount:4欄位，但那是分歧之一（山嶺(山頂)）
  // 的樓層數，其餘11個分歧實際只有3層（潰爛森林/火山口/隱藏都市各分歧樓層陣列長度
  // 都是3，見fields_data_4.js），不能對Q套用固定的卡面floorCount，否則3層的分歧會被
  // 誤判成還有第4層可踏破。因此Q改用「已指定分歧」（pt.hazardQName配對出的branchIndex，
  // 有進度時用progress.branchIndex，跟maybeAdvanceFieldInvite()同一套快取邏輯）的
  // 實際floors.length，其餘一般卡牌不受影響，維持原本card.floorCount優先的既有行為。
  // fix(2026-09-10)：原本只有Q走「依已指定分歧的實際floors.length」，其餘卡牌一律相信
  // card.floorCount——但實際資料裡一般卡牌也有「分歧的floors陣列比卡面floorCount短」的
  // 案例（fields_data_2.js card_6「坑道」floorCount:2，但branch「倒下的大結晶（大空洞）」
  // 只有1層），會造成使用者回報的「進入下一層卡住」：踏破第0層後floorIndex推進到1、
  // cleared判定成false（1<2），畫面顯示「2/2」可以再進入，但fieldFloorForTrig()取
  // branch.floors[1]是undefined，maybeAssignFieldEnemy()的`if (!floor) return`直接靜默
  // 放棄，樓層永遠不會再推進，這個地圖點就永久卡死。
  // 修正方式：一律取「卡面floorCount」與「這個點實際採用的分歧floors長度」兩者的較小值。
  //   - 分歧比卡面短（card_6 branch3）：改用實際長度，不會產生打不到的幽靈樓層。
  //   - 分歧比卡面長（規則書freeFloorOrder特例，如水辺の大教会 floorCount:2 / floors:4）：
  //     仍取floorCount，維持既有「照順序走到floorCount就算全踏破」的已知簡化不變。
  // Q維持原本「直接用分歧實際長度」的語意（card_q的分歧長度1/3/4都不大於卡面4，取min的
  // 結果與原本完全相同，只是寫在同一段共用邏輯裡，不再是特例分支）。
  function fieldFloorCountForCard(pt) {
    var card = pt.card;
    var data = fieldCardData(card);
    var branches = fieldCardBranches(card);
    var progress = fieldProgress[pt.id];
    var branchIndex = progress && typeof progress.branchIndex === "number" ? progress.branchIndex : pickFieldBranchIndex(pt);
    var branch = branches[branchIndex];
    var branchFloorCount = branch && branch.floors && branch.floors.length ? branch.floors.length : 0;
    var cardFloorCount = data && typeof data.floorCount === "number" ? data.floorCount : 0;
    if (branchFloorCount && cardFloorCount) return Math.min(cardFloorCount, branchFloorCount);
    if (branchFloorCount) return branchFloorCount;
    if (cardFloorCount) return cardFloorCount;
    return (branches[0] && branches[0].floors && branches[0].floors.length) || 1;
  }

  function fieldLocationName(pt) {
    var data = fieldCardData(pt.card);
    return data ? window.PriTestFields.localizedText(data.name) : "";
  }

  // 劇本連動分歧（設計文件§2.1-2.2）：用卡牌本名比對，不用rank——同一個rank在不同劇本可能
  // 對應完全不同板塊類型（例：劇本1 day2 pos5是rank"J"但name是"砦（隨機）"，"J"在基礎地圖
  // 固定代表堡壘）。全程只比對.zh欄位，不經localizedText()（遊戲邏輯不該受玩家個人UI語言影響——
  // 否則同一個game state，中文UI玩家跟日文UI玩家會各自算出不同的分歧結果）。
  function scenarioVariantCandidatesForCard(scenarioId, card) {
    var Scenarios = window.PriTestScenarios;
    if (!Scenarios) return [];
    var scenario = Scenarios.list().filter(function (s) { return s.id === scenarioId; })[0];
    if (!scenario) return [];
    var data = fieldCardData(card);
    var baseName = data ? data.name.zh : "";
    if (!baseName) return [];
    var out = [];
    ["day1", "day2"].forEach(function (dayKey) {
      (scenario[dayKey] || []).forEach(function (slot) {
        if (slot.name && slot.name.zh && slot.name.zh.indexOf(baseName) === 0) out.push(slot);
      });
    });
    return out;
  }

  function matchBranchIndexByName(branches, nameHintZh) {
    for (var i = 0; i < branches.length; i++) {
      if (branches[i].name && branches[i].name.zh === nameHintZh) return i;
    }
    return null;
  }

  // 這個點本次要用哪個分歧變體（例如「大教會(1)」／「大教會(2)」／「大教會（炎）」…）：
  // 優先依目前劇本（resolveNightBossScenarioId()）的day1/day2卡牌配置表比對出「這張卡在這個
  // 劇本裡實際叫什麼名字」，再用該名字去配對這張卡本身的branches——這樣同一劇本、同一張卡在
  // 不同地點抽到的敘述會盡量貼近規則書表定內容，而不是純亂數。查無劇本資料／比對不到對應
  // branch時（例如自訂劇本、或該名字在branches清單裡沒有對應項目）才退回fieldSeededIndex()
  // 純亂數——不是玩家投票的對象（使用者這次的規格是「分歧點」指樓層敘述裡的「(→XXX)」選擇，
  // 見下方fieldChoiceLabelsFor()，不是變體本身）。
  function pickFieldBranchIndex(pt) {
    var branches = fieldCardBranches(pt.card);
    if (!branches.length) return 0;
    // Q板塊（地變，2026-09-10新增）：分歧不是靠劇本配置表或亂數決定，而是
    // placeHazardZonePoints()放點當下就已經指定好這個點對應card_q哪個分歧（見
    // midnight_map_variants.jsのqNames／pt.hazardQName），直接用名稱比對，不落入下面
    // 一般卡牌的劇本比對/亂數退回邏輯。
    if (pt.hazardQName) {
      var qIndex = matchBranchIndexByName(branches, pt.hazardQName);
      if (qIndex !== null) return qIndex;
    }
    var scenarioId = resolveNightBossScenarioId();
    var candidates = scenarioId ? scenarioVariantCandidatesForCard(scenarioId, pt.card) : [];
    if (candidates.length) {
      // 同一張卡不同地點都需要重抽：用pt.id當seed key，不共用同一個結果。
      var picked = candidates[fieldSeededIndex(pt.id + ":scenario_variant", candidates.length)];
      var resolvedIndex = matchBranchIndexByName(branches, picked.name.zh);
      if (resolvedIndex !== null) return resolvedIndex;
    }
    return fieldSeededIndex(pt.id + ":branch", branches.length); // 找不到劇本資料/比對失敗：退回純隨機
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

  // 瀕死中的玩家不會被敵人指定為攻擊目標（2026-09-08使用者明確要求）：疊在
  // participantSlots()之上的篩選層，只用在「敵人決定要打誰」的地方（maybeStartEnemyAttack／
  // bossAutoGmBattleState），不影響participantSlots()原本其他用途（人數統計/血條等）。
  // 全員都瀕死時退回完整名單——沒有目標讓敵人出招，比隨便打一個瀕死玩家更奇怪。
  function targetableParticipantSlots(trig) {
    var slots = participantSlots(trig);
    var alive = slots.filter(function (slot) {
      var tokenId = players[slot] && players[slot].tokenId;
      var c = tokenId && characters[tokenId];
      return !(c && c.nearDeath && c.nearDeath.active);
    });
    return alive.length ? alive : slots;
  }

  // 靠近判定：跟updateNearbyTower()/updateNearbyBird()同樣的pattern，只是這裡同時要
  // 驅動整條「邀請→正式進入→打字機→投票→遇敵」流程。sorcerer型別排除在外（已有自己
  // 獨立的解謎流程，見startTowerPuzzle）。
  // 這幾型是新籌碼點（merchant／strong_enemy／random_event／blessing，見
  // updateNearbyChipPoint()），跟field卡牌點各自獨立的proximity/流程，不能被這裡的
  // 「進入」流程誤判。2026-09-06修正：漏排除blessing，導致靠近祝福籌碼時
  // #midnight-field-enter-prompt跟#midnight-blessing-prompt同時觸發，形成使用者回報的
  // 「祝福畫面有兩個進入」重複顯示。
  // 2026-09-10：hazard_q（Q／地變）從這裡移除——使用者規格「Q的板塊資訊參照night的Q來
  // 執行」，改成跟一般2~10/K地點走同一套fieldCardData()/updateNearbyFieldPoint()
  // pipeline（見pickFieldBranchIndex()如何用pt.hazardQName指定分歧、fieldFloorCountForCard()
  // 如何依分歧實際樓層數而非card_q卡面層數判斷全踏破），不再套用強敵決定表隨機roll一隻
  // 敵人（見hazardQUnlocked()/updateNearbyFieldPoint()裡的開放判定閘門，取代原本
  // rollAndAssignStrongEnemy()裡的特例分支）。
  var NON_FIELD_POINT_TYPES = { sorcerer: true, merchant: true, strong_enemy: true, random_event: true, blessing: true };

  // 2026-09-08新增：離開鍛造村範圍時把c._weaponRerollCredits歸0（使用者明確規格「在離開
  // 鍛造村範圍後 直接歸0無法使用」）——只在「原本在村內、這次真的離開了」的轉換瞬間執行
  // 一次，不是每幀都寫，見updateNearbyFieldPoint()呼叫端。
  function resetWeaponRerollCreditsOnLeaveVillage() {
    var c = characters[myTokenId];
    if (!c || !c._weaponRerollCredits) return;
    c._weaponRerollCredits = 0;
    GameStorage.rtSet(gameId, "cloud", "character/" + myTokenId + "/_weaponRerollCredits", 0);
  }

  function updateNearbyFieldPoint() {
    // day3BossFightActive()（2026-09-10新增，同一次「Day3王戰卡關」修正的第二半）：
    // 上面的候選優先序修正已經確保王戰一定開得起來，但如果這裡仍把腳邊的板塊點認定成
    // nearbyFieldPoint，上方資訊欄就會在王戰進行中繼續跳出「進入」按鈕——玩家一按就會在
    // 最終王戰中開啟一層樓層探索（邀請→打字機→投票→指派敵人的完整流程）。Day3沒有板塊
    // 探索的概念，直接走跟「觀戰者/靈鳥飛行中」相同的既有清空分支，不另外寫一套。
    if (!mySlot || !localPos || autoFly || day3BossFightActive()) {
      if (nearbySmithingVillage) resetWeaponRerollCreditsOnLeaveVillage();
      nearbyFieldPoint = null;
      nearbySmithingVillage = null;
      nearbyLateJoinPoint = null;
      nearbyLateClaimPoint = null;
      renderWeaponRerollOpenButton(characters[myTokenId]);
      recomputeActiveEncounter();
      renderFieldOverlay();
      return;
    }
    var found = null;
    var lockedHazardQNearby = false;
    map.points.forEach(function (pt) {
      if (found || NON_FIELD_POINT_TYPES[pt.type]) return;
      var dist = Math.hypot(localPos.x - (pt.x + 0.5), localPos.y - (pt.y + 0.5));
      if (dist > FIELD_TRIGGER_RADIUS) return;
      // Q板塊開放判定（使用者明確規格「在4/可怖強敵兩者其一通過以前，進入Q時會顯示訊息
      // 『你沒資格阿　先挑戰同區域的地方啊』」）：未解鎖時整個不當成found（沒有「進入」
      // 按鍵），只顯示一次提示——跟其餘一般地點共用同一個FIELD_TRIGGER_RADIUS/found機制，
      // 不是另外發明第二套判定。
      if (pt.type === "hazard_q" && !hazardQUnlocked()) {
        lockedHazardQNearby = true;
        if (!hazardQLockedToastShown[pt.id]) {
          hazardQLockedToastShown[pt.id] = true;
          showToast(window.I18N.t("midnight_hazard_q_locked_toast"));
        }
        return;
      }
      found = pt;
    });
    if (!lockedHazardQNearby) hazardQLockedToastShown = {};
    nearbyFieldPoint = found;
    var foundVillage = found && found.card === "8" ? found : null;
    if (!foundVillage && nearbySmithingVillage) resetWeaponRerollCreditsOnLeaveVillage();
    nearbySmithingVillage = foundVillage;
    renderWeaponRerollOpenButton(characters[myTokenId]);
    if (found) {
      maybeAdvanceFieldInvite(found);
      maybeStartFieldTypewriter(found);
      maybeSetFieldVoteDeadline(found);
      maybeResolveFieldVote(found);
      maybeGrantFieldTileRewardOnClear(found);
      maybeClearFieldTriggerAfterRewardGate(found);
    }
    // 中途加入判斷（設計文件§1.4）：只在「已經過了邀請階段」（status!=="inviting"，
    // 邀請階段沿用既有handleAcceptFieldInviteClick「加入」流程，不重複顯示這個按鈕）
    // 且自己尚未在participants裡時才成立，涵蓋投票中(active)與已解決(resolved，戰鬥中
    // 或已結束)兩種情況。
    nearbyLateJoinPoint = null;
    // 後補領獎判斷（設計文件§1.5，Task 7新增）：板塊樓層半部分——「這個點留有進度紀錄
    // （progress0，代表至少發放過一次perPerson獎勵）、自己從未加入過目前這次trig、也還
    // 沒領過」，不受目前trig狀態或是否已全清影響（ledger累積的是「過去每一層」發過的
    // 獎勵，不是這次trig當下的狀態）。
    nearbyLateClaimPoint = null;
    if (found) {
      var trig0 = fieldTriggers[found.id];
      var progress0 = fieldProgress[found.id];
      // 2026-09-07 Task 7新增：全樓層已踏破後（progress0.cleared，見
      // maybeAdvanceFieldProgressAfterFloorClear()）trig會「維持原樣不清空」，讓地圖圖示能
      // 繼續用trig.status==="resolved"＋HP<=0判斷isPointCleared()——這代表已完全踏破的
      // 板塊，trig0.status永遠停在"resolved"、且自己永遠不在participants裡，若不額外排除
      // 全清狀態，下面的「參加探索」判斷會永遠成立（沒有下一場戰鬥可打，卻一直邀請加入），
      // 且會跟下面新增的「領取獎勵」同時渲染在同一個position:fixed座標（見style.css共用
      // 選擇器，設計是同一時間只顯示其中一個）。已全清時中途加入本來就沒有意義，排除後讓
      // 「領取獎勵」單獨顯示。
      if (trig0 && trig0.status !== "inviting" && !(progress0 && progress0.cleared) &&
        (!trig0.participants || !trig0.participants[mySlot])) {
        nearbyLateJoinPoint = found;
      }
      // 跟nearbyLateJoinPoint互斥：若「參加探索」這一刻已經成立，代表還有進行中的內容
      // 更優先，先不顯示領取獎勵——ledger本身不會過期，等中途加入不再適用（trig被清空
      // 進入下一層、或已全清如上面排除的情況）時再靠近仍能領到，不會遺失獎勵。
      // fix(2026-09-09)：剛按下[進入]的當下，本地fieldTriggers快取可能還沒反映
      // handleEnterFieldPointClick()剛寫入的trig（RTDB監聽回填有延遲），這段窗口內
      // trig0會被誤判成null、neverJoined0誤判成true，導致late-claim-prompt跟banner
      // 搶同一個固定位置閃爍。用既有的fieldEnterAttempted[pt.id]（本來就代表「我剛按過
      // 這個點的進入」）排除這個窗口。
      if (!nearbyLateJoinPoint && progress0 && !fieldEnterAttempted[found.id]) {
        var alreadyClaimed0 = progress0.claimedBy && progress0.claimedBy[myTokenId];
        var neverJoined0 = !(trig0 && trig0.participants && trig0.participants[mySlot]);
        // fix：trig0在樓層推進當下會被maybeClearFieldTriggerAfterRewardGate()清空成null，
        // 這時neverJoined0單看trig0.participants一定誤判成true——即使自己其實是這一層的
        // participant、早就透過grantTileLootToParticipants()/chaliceEntries直接拿到獎勵。
        // 額外查pushPerPlayerReward()存的directSlots（見該函式說明，不受trig清空影響），
        // 只要自己出現在任一筆ledger紀錄的directSlots裡，代表這份獎勵早就直接發放過，
        // 不該再被當成「從未加入、需要後補領獎」，否則會彈出late-claim-prompt讓玩家把同一
        // 份戰利品重複領取一次。
        // fix(2026-09-10)：directSlots只有「這一層剛好發過perPerson獎勵」時才存在
        // （pushPerPlayerReward()在entries為空時直接return），實際資料裡大量樓層的
        // reward只有tieredChoice/hpDamage/note或根本沒有reward，因此光靠directSlots
        // 會漏掉大部分參與紀錄。改為優先查maybeAdvanceFieldProgressAfterFloorClear()
        // 無條件寫入的participatedSlots（同一個fieldProgress節點、同樣slot->true形狀），
        // directSlots的迴圈保留作為舊存檔的相容路徑。
        if (neverJoined0 && mySlot && progress0.participatedSlots && progress0.participatedSlots[mySlot]) {
          neverJoined0 = false;
        }
        if (neverJoined0 && mySlot && progress0.perPlayerRewards) {
          for (var prSeq in progress0.perPlayerRewards) {
            var prEntry = progress0.perPlayerRewards[prSeq];
            if (prEntry.directSlots && prEntry.directSlots[mySlot]) {
              neverJoined0 = false;
              break;
            }
          }
        }
        if (neverJoined0 && !alreadyClaimed0) {
          nearbyLateClaimPoint = found;
        }
      }
    }
    // 後補領獎判斷（設計文件§1.5）：強敵籌碼／隨機事件半部分——這兩型沒有fieldProgress
    // （見NON_FIELD_POINT_TYPES，found不會是這兩型），改讀fieldTrigger自己的resolved狀態＋
    // HP歸零（scarab沒有HP，改看scarabResolved，留給Task 21/22/25接上）判斷「已清除」。
    // 這兩型跟nearbyLateJoinPoint（只適用board floor的found）天然不會撞在一起，不需要
    // 額外互斥判斷。
    map.points.forEach(function (pt2) {
      if (nearbyLateClaimPoint) return;
      if (pt2.type !== "strong_enemy" && pt2.type !== "random_event") return;
      var dist2 = Math.hypot(localPos.x - (pt2.x + 0.5), localPos.y - (pt2.y + 0.5));
      if (dist2 > FIELD_TRIGGER_RADIUS) return;
      var trig2 = fieldTriggers[pt2.id];
      if (!trig2 || trig2.status !== "resolved") return;
      var hp2 = fieldEnemyHp[pt2.id];
      var cleared2 = trig2.enemyFamilyId ? (hp2 !== undefined && hp2 <= 0) : !!trig2.scarabResolved; // scarab目前尚未設定resolved旗標，留給Task 21/22/25接上
      var claimed2 = trig2.claimedBy && trig2.claimedBy[myTokenId];
      var joined2 = trig2.participants && trig2.participants[mySlot];
      if (cleared2 && !claimed2 && !joined2) nearbyLateClaimPoint = pt2;
    });
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
    // day3BossFightActive()：理由同updateNearbyFieldPoint()——王城（J卡）也是板塊卡牌
    // 探索的入口，Day3王戰進行中不該還能踏進去開一層。
    if (!mySlot || !localPos || autoFly || day3BossFightActive()) {
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

  // Task 20新增：隨機事件「隕石」分支的王戰（renderMeteorBranch()指派match後）跟
  // strong_enemy籌碼共用同一套fieldTrigger/fieldEnemyHp shape與「上方資訊欄＋進入戰鬥」UI
  // （renderStrongEnemyOverlay()／handleStrongEnemyEnterClick()／下方recomputeActiveEncounter()），
  // 這裡統一決定「目前是哪一個籌碼點在提供這場戰鬥」，優先權維持跟原本nearbyStrongEnemy
  // 完全一樣（只是多接受一個候選來源），避免每個呼叫端各自重複判斷順序。隨機事件其餘
  // 8個分支（女神像/埋もれ宝等）沒有enemyFamilyId，天然不會被這裡誤判成戰鬥點。
  function encounterEnemyPoint() {
    if (nearbyStrongEnemy) return nearbyStrongEnemy;
    if (nearbyRandomEvent) {
      var t = fieldTriggers[nearbyRandomEvent.id];
      if (t && t.enemyFamilyId) return nearbyRandomEvent;
    }
    return null;
  }

  // activeEncounter：field卡牌點跟strong_enemy籌碼點（含隕石王戰，見encounterEnemyPoint()）
  // 共用同一套fieldTriggers/{pointId}與fieldEnemyHp/{pointId} shape（見規劃紀錄「強敵/scarab
  // 戰鬥的 RTDB 狀態機」），因此抽成一個共用步驟，接受nearbyFieldPoint、encounterEnemyPoint()
  // 或nearbyCastlePoint其中之一。
  // Day3夜之王戰鬥進行中（meta.day3StartAt已設、王還活著、自己有席位）——見updateDay3Boss()。
  // 這是規則書「PC全員」必須一起面對的最終戰，而且Day3本身沒有「在地圖上探索板塊」的概念
  // （既有程式已經這樣認定，見finishRevive()的phaseInfo.day!==3判斷）。
  function day3BossFightActive() {
    return !!nearbyDay3Boss;
  }

  function recomputeActiveEncounter() {
    // 2026-09-10使用者回報「Day3王戰時站在地圖點旁邊會進不了王戰」：候選優先序原本是
    // nearbyFieldPoint → 籌碼 → 王城 → 夜之強敵 → 夜之王，夜之王排在最後。Day3開始時
    // 玩家人若剛好停在任何一個板塊點/籌碼點/王城範圍內，那個點會一直贏得候選權，
    // nearbyDay3Boss永遠輪不到，王戰就此卡住不會開始（實際發生機率取決於地圖種子與
    // 玩家當下位置，因此是時好時壞的偶發卡關）。這裡把夜之王提到最前面。
    //
    // 刻意只提夜之王、不動nearbyFinalCircleBoss的位置：夜之強敵有一條明確的既有規則
    // 「縮圈完後，仍在卡牌樓層探索的不受進入夜之強敵影響，直到該名也正式進入夜之強敵
    // 戰鬥」（見slotsInsideFinalCircle()說明），而「地圖點排在夜之強敵前面」正是實現
    // 那條規則的機制，改動會破壞它。Day3沒有對應的規則——王戰一開始就是全員的。
    var candidate = nearbyDay3Boss || nearbyFieldPoint || encounterEnemyPoint() || nearbyCastlePoint || nearbyFinalCircleBoss;
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
    // 2026-09-09新增：第一次遭遇（confirmedEncounterIds尚未設定過）時，不再直接
    // confirmedEncounterIds=true，改先跑5秒識別資訊準備流程（updateBattlePrep()），
    // 讓地圖不會瞬間收合。re-entry（confirmedEncounterIds已經設過、這次是重新靠近）
    // 維持原有的pendingBattleReentry 3秒讀條流程，不受影響。
    if (confirmedEncounterIds[candidate.id] === undefined && amParticipant) {
      if (!battlePrepCandidate || battlePrepCandidate.id !== candidate.id) {
        battlePrepCandidate = candidate;
        battlePrepUntil = Date.now() + BATTLE_PREP_DURATION_MS;
      }
      return;
    }
    if (confirmedEncounterIds[candidate.id]) {
      pendingBattleReentry = null;
      activeEncounter = candidate;
      closeHudPanelsIfNightBossCombat();
      return;
    }
    if (!pendingBattleReentry || pendingBattleReentry.id !== candidate.id) {
      pendingBattleReentry = candidate;
      battleEnteringUntil = null; // 換了對象，先前可能還在跑的讀取作廢
    }
    activeEncounter = null;
    if (wasActive) onEncounterEnded();
  }

  // 遭遇戰鬥前置準備（2026-09-09新增）：5秒跑完後才把battlePrepCandidate正式提升成
  // confirmedEncounterIds/activeEncounter，讓recomputeActiveEncounter()下一影格接手
  // 既有流程（含frame()裡「activeEncounter存在就setMapExpanded(false)」的既有邏輯，
  // 這裡完全不重複那段收合地圖的程式碼）。
  function updateBattlePrep(now) {
    if (!battlePrepCandidate) return;
    // 離開範圍/敵人已死/已經是participant以外的原因喪失候選資格時作廢，避免殘留。
    var currentEnemyPoint = encounterEnemyPoint();
    var stillValid = (currentEnemyPoint && currentEnemyPoint.id === battlePrepCandidate.id) ||
      (nearbyFieldPoint && nearbyFieldPoint.id === battlePrepCandidate.id) ||
      (nearbyFinalCircleBoss && nearbyFinalCircleBoss.id === battlePrepCandidate.id) ||
      (nearbyDay3Boss && nearbyDay3Boss.id === battlePrepCandidate.id);
    if (!stillValid) {
      battlePrepCandidate = null;
      battlePrepUntil = null;
      return;
    }
    if (now < battlePrepUntil) return;
    confirmedEncounterIds[battlePrepCandidate.id] = true;
    battlePrepCandidate = null;
    battlePrepUntil = null;
    recomputeActiveEncounter();
  }

  // 識別資訊來源沿用renderFieldEncounterPanel()同一套資料查詢（window.PriTestEnemies.get()／
  // bossRulebookData()），不新增第二套敵人資料解析。
  function battlePrepIdentityText(trig) {
    if (!trig) return { name: "", detail: "" };
    if (trig.enemyFamilyId === BOSS_ENEMY_FAMILY_SENTINEL) {
      var bossInfo = bossRulebookData(trig.enemyId);
      return { name: bossInfo ? window.PriTestEnemies.localizedText(bossInfo.name) : trig.enemyId, detail: "" };
    }
    var data = trig.enemyFamilyId && window.PriTestEnemies ? window.PriTestEnemies.get(trig.enemyFamilyId, trig.enemyId) : null;
    if (!data) return { name: "", detail: "" };
    var parts = [];
    parts.push(window.I18N.t("midnight_strong_enemy_kind_label", { kind: window.PriTestEnemies.localizedText(data.familyName) }));
    if (data.enemy.size) parts.push(window.I18N.t("midnight_strong_enemy_size_label", { size: data.enemy.size }));
    return { name: window.PriTestEnemies.localizedText(data.enemy.name), detail: parts.join("　") };
  }

  function renderBattlePrepBanner(now) {
    var box = el("midnight-battle-prep-banner");
    if (!box) return;
    if (!battlePrepCandidate) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    var trig = fieldTriggers[battlePrepCandidate.id];
    var identity = battlePrepIdentityText(trig);
    el("midnight-battle-prep-name").textContent = identity.name;
    el("midnight-battle-prep-detail").textContent = identity.detail;
    var elapsed = BATTLE_PREP_DURATION_MS - Math.max(0, battlePrepUntil - now);
    var pct = Math.max(0, Math.min(100, (elapsed / BATTLE_PREP_DURATION_MS) * 100));
    el("midnight-battle-prep-loading-fill").style.width = pct + "%";
    el("midnight-battle-prep-status").textContent =
      pct >= 100 ? window.I18N.t("midnight_battle_prep_ready_note") : "";
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
    // 復仇者「召喚靈體」：「戰鬥結束時自動消失」（見character_types.js原文），比照
    // 高防禦/不撓同一個清理時機。
    if (c && c.summonedSpirit) {
      c.summonedSpirit = null;
      GameStorage.rtSet(gameId, "cloud", "character/" + myTokenId + "/summonedSpirit", null);
    }
    receivedAttributeAccum = {};
    receivedAttributeAccumTriggeredCount = {};
    // 2026-09-11新增遺物效果用的本場累計（突刺反擊的「攻擊過10次以上」／
    // 連續攻擊時體力回復の5次計數／連續攻擊時FP回復の10秒內體力消耗累計）：
    // 都是「一場戰鬥內」的概念，離開戰鬥就歸零。
    attackCountThisEncounter = 0;
    attackStaminaWindow = [];
    restageDamageUpApplied = {};
    daggerHit2Times = [];
  }

  // 夜之強敵（finalCircleDay1／finalCircleDay2）／夜王（day3Boss，見DAY3_BOSS_POINT_ID）
  // 戰鬥中無法逃離（2026-09-08使用者明確要求）：跟一般地圖上的「強敵」籌碼（nearbyStrongEnemy，
  // type==="strong_enemy"）是不同的東西，後者維持可自由逃離，只有這兩種強制縮圈戰鬥被鎖住。
  function activeEncounterIsNightBoss() {
    return !!(
      activeEncounter &&
      (activeEncounter.id === DAY3_BOSS_POINT_ID || activeEncounter.id.indexOf("finalCircleDay") === 0)
    );
  }

  // 2026-09-08使用者明確規格「進入夜之強敵與夜王戰鬥後...上方hud顯示的欄位都強制關閉
  // 離開」：進入這兩種戰鬥的當下，強制收起玩家可能開著的選單面板／角色面板，避免戰鬥中
  // 還能分心操作這些跟戰鬥無關的視窗（地圖本身已經有既有的「進戰鬥自動收合」機制，見
  // frame()裡「activeEncounter && mapExpanded則setMapExpanded(false)」那段，所有戰鬥都會
  // 觸發、不限這兩種，不在這裡重複處理）。
  function closeHudPanelsIfNightBossCombat() {
    if (!activeEncounterIsNightBoss()) return;
    var menuPanel = el("midnight-menu-panel");
    if (menuPanel && !menuPanel.hidden) {
      menuPanel.hidden = true;
      renderPlayersPanel();
    }
    // 2026-09-10使用者明確要求「戰鬥中仍可打開角色視窗查看裝備」：原本這裡也會呼叫
    // closeCharacterSheetModal()，而本函式是由recomputeActiveEncounter()每影格呼叫的，
    // 等於夜王戰鬥期間角色視窗一打開就立刻被關掉、完全無法查看裝備。改成只收起選單面板
    // （那是暫停/流浪祝福等會打斷戰鬥節奏的操作入口），角色視窗維持可開。角色視窗本身是
    // 唯讀查看＋裝備/丟棄操作，不影響戰鬥判定的正確性。
  }

  // 逃離戰鬥（2026-09-06使用者明確要求「在敵人資訊中右上方有逃離戰鬥按鈕」）：見上方
  // fledEncounterIds說明，只是本地端放棄目前這場activeEncounter，不做任何規則書判定。
  // 2026-09-08新增兩道限制（使用者明確要求）：瀕死中無法逃離（isSelfDowned()）、夜之強敵／
  // 夜王戰鬥中無法逃離（activeEncounterIsNightBoss()，按鈕本身也會隱藏，見renderCombatPanel()）。
  function handleFleeBattleClick() {
    if (!mySlot || isPaused() || !activeEncounter || isSelfDowned() || activeEncounterIsNightBoss()) return;
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
    // 2026-09-08使用者明確規格「進入夜之強敵與夜王戰鬥後 就不得使用地圖上板塊籌碼」：
    // 補上跟handleTowerEnterClick()/handleBlessingEnterClick()/handleMerchantEnterClick()
    // 既有同款的activeEncounter守衛（原本這幾個既有函式已經在「任何戰鬥中」擋下塔/祝福/
    // 商人，只有這個函式漏掉，見上方2026-09-06三次優化註解）。
    if (!mySlot || isPaused() || activeEncounter || fieldTriggers[pt.id] || fieldEnterAttempted[pt.id]) return;
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
    if (!mySlot || isPaused() || isSelfDowned()) return;
    var trig = fieldTriggers[pt.id];
    if (!trig || trig.status !== "inviting") return;
    GameStorage.rtSet(gameId, "cloud", "fieldTrigger/" + pt.id + "/participants/" + mySlot, true);
  }

  // 2026-09-07優化：已加入者可按「立即進入」跳過剩餘邀請時限。直接把inviteDeadline改成現在，
  // 不新增狀態機分支——maybeAdvanceFieldInvite()既有的Date.now()>=inviteDeadline判斷會在下一輪
  // updateNearbyFieldPoint()自然觸發。
  function handleForceEnterFieldClick(pt) {
    var trig = fieldTriggers[pt.id];
    if (!trig || trig.status !== "inviting" || !trig.participants || !trig.participants[mySlot]) return;
    GameStorage.rtSet(gameId, "cloud", "fieldTrigger/" + pt.id + "/inviteDeadline", Date.now());
  }

  // 中途加入（設計文件§1.4）：按下「參加探索」後，等待FIELD_LATE_JOIN_WAIT_MS（會合動畫的
  // 意象時間）才真正把自己寫進participants，不是點下去立刻生效——這段等待純粹是本地UI節奏，
  // 不需要transaction（跟handleAcceptFieldInviteClick同理，重複寫true本來就幂等）。只寫入
  // participants本身，不重新觸發inviting/typewriter/vote這些既有機制：trig.status此時已經是
  // active或resolved，maybeAdvanceFieldInvite／maybeStartFieldTypewriter等函式的status guard
  // 本來就不會因為participants多了一人而重跑。
  var lateJoinTimer = null;
  function handleLateJoinFieldClick(pt) {
    if (!mySlot || isPaused() || lateJoinTimer) return;
    el("midnight-field-late-join-loading").hidden = false;
    lateJoinTimer = setTimeout(function () {
      lateJoinTimer = null;
      el("midnight-field-late-join-loading").hidden = true;
      GameStorage.rtSet(gameId, "cloud", "fieldTrigger/" + pt.id + "/participants/" + mySlot, true);
    }, FIELD_LATE_JOIN_WAIT_MS);
  }

  // 後補領獎（設計文件§1.5）：按下「領取獎勵」後，等待FIELD_LATE_JOIN_WAIT_MS（跟中途加入
  // 同款會合意象時間）才真正呼叫對應的ledger claim函式——板塊樓層的ledger放在
  // fieldProgress/{id}/perPlayerRewards（見Task 1 claimLatePerPlayerRewards()），強敵籌碼／
  // 隨機事件等沒有fieldProgress的一次性內容則改放在fieldTrigger/{id}/perPlayerRewards（見
  // 下方claimLateFieldTriggerRewards()），用fieldProgress[pt.id]是否存在判斷要分派到哪一種。
  var lateClaimTimer = null;
  function handleLateClaimClick(pt) {
    if (!mySlot || isPaused() || lateClaimTimer) return;
    el("midnight-field-late-claim-loading").hidden = false;
    lateClaimTimer = setTimeout(function () {
      lateClaimTimer = null;
      el("midnight-field-late-claim-loading").hidden = true;
      if (fieldProgress[pt.id]) {
        claimLatePerPlayerRewards(pt.id);
      } else {
        claimLateFieldTriggerRewards(pt.id);
      }
    }, FIELD_LATE_JOIN_WAIT_MS);
  }

  // 對strong_enemy/random_event等沒有fieldProgress的一次性內容，ledger改存在
  // fieldTrigger/{id}/perPlayerRewards（跟fieldProgress版同一種{seq:{entries,grantedAt}}
  // 結構），claimedBy也存在fieldTrigger底下——Task 21/25會把撃破獎勵寫進這裡而不是
  // fieldProgress。
  function claimLateFieldTriggerRewards(pointId) {
    GameStorage.rtTransaction(gameId, "cloud", "fieldTrigger/" + pointId + "/claimedBy/" + myTokenId, function (cur) {
      if (cur) return undefined; // 已經領過：中止transaction，不重複授予（同claimLatePerPlayerRewards()寫法）
      return true;
    }).then(function (committed) {
      if (committed !== true) return; // 這次沒有真正搶到(committed===null，代表已經領過)
      var trig = fieldTriggers[pointId] || {};
      var ledger = trig.perPlayerRewards || {};
      Object.keys(ledger).forEach(function (seq) {
        (ledger[seq].entries || []).forEach(function (entry) {
          pushPendingReward(myTokenId, entry);
        });
      });
    });
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
    var waitMs = pt.card === "J" ? FIELD_ENTER_WAIT_MS_CASTLE : FIELD_ENTER_WAIT_MS;
    if (Date.now() < trig.enterAt + waitMs) return;
    fieldTypewriterStartedFor[pt.id] = true;
    var text = fieldNarrativeTextFor(pt, trig);
    window.PriTestNightGmFlow.typewriteInto(el("midnight-field-narrative-text"), text, {
      intervalMs: 56, // 2026-09-07優化：預設28ms的2倍＝變慢0.5倍
      onDone: function () {
        fieldTypewriterDoneFor[pt.id] = true;
        fieldTypewriterDoneAt[pt.id] = Date.now();
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
  // 全員一致就直接採用該項；2026-09-07優化：全員都投完後即使意見不一致，也立即用多數決
  // 判定（不必等滿10秒），加快節奏——只有「還沒全員投完」時才會繼續等到逾時再交給系統決定。
  function maybeResolveFieldVote(pt) {
    var trig = fieldTriggers[pt.id];
    if (!trig || trig.status !== "active" || fieldVoteResolveAttempted[pt.id]) return;
    if (!trig.voteDeadline) return; // 打字機還沒播完、還沒開始算投票時限
    var labels = fieldChoiceLabelsFor(pt, trig);
    var now = Date.now();
    var choiceIndex = null;
    if (labels.length <= 1) {
      // 2026-09-08使用者明確規格「打字機打完樓層敘述後 若為自動選擇的 須停止3秒 才會自動
      // 選擇下一步」：不需要投票的單一分支，原本typewriter一播完就幾乎立即resolve，改成
      // 至少等FIELD_AUTO_SELECT_DELAY_MS，讓玩家有時間讀完敘述。
      var doneAt = fieldTypewriterDoneAt[pt.id];
      if (!doneAt || now < doneAt + FIELD_AUTO_SELECT_DELAY_MS) return;
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
        // 2026-09-07優化：全員投完就立即判定，不再等timedOut——一致用該值，不一致立即多數決。
        choiceIndex = consensus ? first : pickFallbackChoice(votes, participants, labels.length, pt);
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
        matches.push({
          familyId: match.familyId,
          enemy: match.enemy,
          mobRowCount: ref.mobRowCount || 0,
          level: ref.level || 1,
          needsLevelCorrection: !!ref.needsLevelCorrection, // L補：ref已經由GmFlow.parseCombatEnemyRef()偵測「」內文字含「L補」
        });
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
    if (!floor) {
      // fix(2026-09-10)：原本這裡只是`return`，資料上取不到這一層（分歧floors陣列比
      // 卡面floorCount短，見fieldFloorCountForCard()說明）時就永久卡住、沒有任何提示。
      // fieldFloorCountForCard()的min()修正已經讓新遊戲不會走到這裡，這條分支是給
      // 「修正前就已經存進RTDB的舊進度」用的自癒路徑：把樓層當成已經走完往下推進，
      // maybeAdvanceFieldProgressAfterFloorClear()會依修正後的floorCount正確標記cleared。
      // 不自行發明樓層內容或獎勵（規則書沒有這一層＝真的沒有這一層）。
      maybeAdvanceFieldProgressAfterFloorClear(pt, trig);
      return;
    }
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
    // L補（見currentLBonus()說明）：這一行敵人引用文字本身標注「L補」才套用，在指派當下
    // 一次算好、跟level一起凍結寫進trig（不是每幀重算），避免戰鬥途中跨過縮圈開始時間點
    // 導致等級/HP/Guard中途變動。
    var lBonus = picked.needsLevelCorrection ? currentLBonus(currentPhaseInfo(Date.now())) : 0;
    var finalLevel = picked.level + lBonus;
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
      return cur === null ? finalLevel : cur;
    });
    if (lBonus) {
      GameStorage.rtTransaction(gameId, "cloud", "fieldTrigger/" + pt.id + "/lBonus", function (cur) {
        return cur === null ? lBonus : cur;
      });
    }
    GameStorage.rtTransaction(gameId, "cloud", "fieldEnemyHp/" + pt.id, function (cur) {
      return cur === null ? enemyRealHpMax({ enemyFamilyId: picked.familyId, enemyId: picked.enemy.id, level: finalLevel }) : cur;
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
      renderRandomEventOverlay();
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

    // Task 20新增：隨機事件籌碼（設計文件§8.1-8.2）——先決定分支（rollAndAssignRandomEvent），
    // 隕石分支撃破後的獎勵判定（maybeGrantMeteorReward）比照上面strongEnemy同一套「每偵
    // 掃描一次」節奏。encounterEnemyPoint()（下方recomputeActiveEncounter()用到）需要
    // nearbyStrongEnemy跟nearbyRandomEvent都已經是這一輪最新值，因此recomputeActiveEncounter()/
    // renderStrongEnemyOverlay()挪到兩者都指派完之後才呼叫。
    nearbyRandomEvent = randomEvent;
    if (randomEvent) {
      rollAndAssignRandomEvent(randomEvent);
      maybeGrantMeteorReward(randomEvent);
      // Task 21新增：夜の勢力「n連戦」——每次擊敗當前敵人時，判斷是否要重生一隻同款敵人
      // 繼續下一輪，或（達到requiredRounds）發放最終獎勵。跟maybeGrantMeteorReward同一套
      // 「每偵掃描一次」節奏，掛在同一個呼叫點（不是另外發明第二套HP=0偵測機制）。
      maybeAdvanceNightForceRound(randomEvent);
      // Task 22新增：「襲撃」分支（忌み鬼／兆し／調律の魔物戦いを仕掛ける分支）的撃破獎勵，
      // 同maybeGrantMeteorReward()同一套「每偵掃描一次」節奏。
      maybeGrantAmbushReward(randomEvent);
    }

    recomputeActiveEncounter();
    renderStrongEnemyOverlay();
    renderRandomEventOverlay();
  }

  // ---- 強敵籌碼：靠近後用event_rulebook.js既有「強敵決定表」（跟night_gm_flow.js完全
  // 相同的解析邏輯）決定敵人，直接生成一個status:"resolved"的fieldTrigger物件，天然
  // 重用既有戰鬥/攻擊排程（見規劃紀錄「強敵/scarab 戰鬥的 RTDB 狀態機」）。----
  // Q板塊開放判定（2026-09-10使用者更新規格：「額外生成4,可怖強敵，兩者只要其一通過即可
  // 開始Q」，從舊規格「三選二」放寬成「二選一」）：hazardMember是placeHazardZonePoints()
  // 對橘線範圍內的卡4/強敵兩個點標記的旗標，只要其中至少1個isPointCleared()就算解鎖。
  // 實際的「未解鎖時顯示提示、不能進入」閘門在updateNearbyFieldPoint()（Q板塊已改走一般
  // 地點的fieldCardData() pipeline，不再是strong_enemy籌碼特例，見NON_FIELD_POINT_TYPES
  // 說明）。
  var hazardQLockedToastShown = {};
  function hazardQUnlocked() {
    var members = map.points.filter(function (p) {
      return p.hazardMember;
    });
    var clearedCount = members.filter(isPointCleared).length;
    return clearedCount >= 1;
  }

  function rollAndAssignStrongEnemy(pt) {
    if (strongEnemyRollAttempted[pt.id] || fieldTriggers[pt.id]) return;
    strongEnemyRollAttempted[pt.id] = true;
    var GmFlow = window.PriTestNightGmFlow;
    var chip = findEventChip("strong_enemy");
    // Task 18（設計文件§7）：這個點若是Day2開始時決定性挑中的「⑧恐るべき強敵」點
    // （meta.terrifyingStrongEnemyPointId===pt.id），改查extraTables[1]（恐るべき強敵決定表），
    // 其餘2個點維持extraTables[0]（一般強敵決定表）。
    var isTerrifying = meta && meta.terrifyingStrongEnemyPointId === pt.id;
    var table = chip && chip.extraTables && chip.extraTables[isTerrifying ? 1 : 0];
    if (!GmFlow || !table) return;
    var rolled = GmFlow.rollStrongEnemyTable(table);
    if (!rolled) return;
    var parsed = GmFlow.extractLevelAndNameTokens((rolled.entry && rolled.entry.ja) || "");
    var match = null;
    for (var i = 0; i < parsed.nameTokens.length && !match; i++) {
      match = GmFlow.resolveCombatEnemyMatch(parsed.nameTokens[i]);
    }
    if (!match) return; // 找不到就整體放棄，不硬湊（CLAUDE.md §19同精神，不捏造規則結果）
    // L補：強敵決定表（event_rulebook.js「強敵決定表｜1日目(⑦⑧)／2日目(⑦)」跟「恐るべき
    // 強敵決定表｜2日目(⑧)」）的每一列都標注「Lv.N + L補正」，見currentLBonus()說明。
    var lBonus = L_BONUS_TEXT_RE.test((rolled.entry && rolled.entry.ja) || "") ? currentLBonus(currentPhaseInfo(Date.now())) : 0;
    var level = (parsed.level || 1) + (rolled.levelBonus || 0) + lBonus;
    var now = Date.now();
    GameStorage.rtTransaction(gameId, "cloud", "fieldTrigger/" + pt.id, function (cur) {
      if (cur !== null) return cur;
      return {
        status: "resolved",
        enemyFamilyId: match.familyId,
        enemyId: match.enemy.id,
        level: level,
        lBonus: lBonus,
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
    var pt = encounterEnemyPoint(); // Task 20：也接受隕石王戰（見encounterEnemyPoint()說明）
    if (!mySlot || isPaused() || !pt) return;
    var trig = fieldTriggers[pt.id];
    if (!trig || trig.status !== "resolved") return;
    GameStorage.rtSet(gameId, "cloud", "fieldTrigger/" + pt.id + "/participants/" + mySlot, true);
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
    // 擊破獎勵必須放在下面那道早期return之前：戰鬥一旦被指派，trig.status就是"resolved"，
    // 有席位的玩家會走進那個if直接return，放在函式尾端的呼叫永遠不會執行到。
    maybeGrantFinalCircleBossReward(dayIndex, pointId);
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

  // ---- 夜之強敵擊破獎勵（2026-09-10使用者明確要求「打贏夜之強敵參照黃金樹之帳的獎勵來
  // 一樣給予玩家」）----
  // 在此之前，夜之強敵（finalCircleDay1／finalCircleDay2）擊破後完全沒有任何獎勵——
  // maybeGrantStrongEnemyReward()只掛在strong_enemy籌碼的掃描路徑上，這條全域判定的
  // 戰鬥從來沒有接上獎勵。
  //
  // 獎勵來源刻意不另外編一份數字，直接讀fields_data_1.jsのa_goldenカード
  // （「黄金樹の帳」）第dayIndex個branch的樓層reward陣列——那就是規則書為這兩場戰鬥
  // 定義的獎勵本體：
  //   第1天：附帶効果×1 ＋ 撃破ルーン10
  //   第2天：附帶効果×1 ＋ 撃破ルーン15 ＋ 石劍鑰匙×1
  // （資料若之後修訂，這裡會自動跟著變動，不需要改程式。）
  // 資料裡的「附帶効果×1」原本是kind:"note"，本文寫「請使用潛在之力視窗的付帶效果抽選
  // 功能處理」——那是給回合制GM看的指示，midnight沒有GM。使用者明確選擇「新增獎勵kind，
  // 直接抽附帶效果」，因此這裡把該筆note改送成新的kind:"attachedEffect"（見
  // computeRewardDraw()／renderAttachedEffectRewardDetail()），玩家在獎勵清單按抽選就
  // 真的拿得到。判斷方式用「note本文含『付帯効果』／『附帶效果』」，不是寫死索引，
  // 資料增減其他note時不會誤判。
  var finalCircleRewardAttempted = {}; // pointId -> true（本地節流，跟strongEnemyRewardAttempted同款）

  function goldenTreeFloorRewardEntries(dayIndex) {
    var Fields = window.PriTestFields;
    var card = Fields && Fields.get(GOLDEN_TREE_CARD_ID);
    var branch = card && card.branches && card.branches[dayIndex - 1];
    var floor = branch && branch.floors && branch.floors[0];
    return (floor && floor.reward) || [];
  }

  function goldenTreeRewardEntryToPending(entry) {
    if (entry.kind === "note") {
      var text = window.PriTestFields.localizedText(entry.note || {});
      var jaText = (entry.note && entry.note.ja) || "";
      if (/付帯効果/.test(jaText) || /附帶效果/.test(text)) return { kind: "attachedEffect", value: 1 };
      return { kind: "note", text: text };
    }
    // rune／stoneswordKey等既有kind原樣沿用pendingRewards既有處理（computeRewardDraw），
    // 只做淺拷貝避免把resolved等執行期欄位寫回fields_data_1.js的模組層級共用物件
    // （跟pushSharedReward()／樓層獎勵既有做法一致）。
    var copy = {};
    for (var k in entry) {
      if (k === "note") continue; // note是雙語物件、不是pendingRewards認得的欄位，這裡不帶過去
      copy[k] = entry[k];
    }
    return copy;
  }

  function maybeGrantFinalCircleBossReward(dayIndex, pointId) {
    if (finalCircleRewardAttempted[pointId]) return;
    if (!finalCircleBossDefeated(dayIndex)) return;
    var trig = fieldTriggers[pointId];
    if (!trig) return;
    finalCircleRewardAttempted[pointId] = true;
    var entries = goldenTreeFloorRewardEntries(dayIndex);
    if (!entries.length) return;
    // first-writer-wins：跟maybeGrantStrongEnemyReward()完全同一套transaction手法，保證
    // 只有一台裝置真的push，但push對象是participants內「所有」玩家。
    GameStorage.rtTransaction(gameId, "cloud", "fieldTrigger/" + pointId + "/rewardGrantedBy", function (cur) {
      return cur === null ? myTokenId : cur;
    }).then(function (committed) {
      if (committed !== myTokenId) return;
      // 2026-09-10：改成跟樓層獎勵同一套perPerson/固定共享分流（見isPerPersonRewardEntry()）。
      // 原本無條件對每個participant各push一份，等於把「石劍鑰匙×1」這種固定數量的獎勵
      // 發成人數倍數。附帶效果／擊破盧恩仍是每人一份（規則書原文「PCはそれぞれ」）。
      entries.forEach(function (entry) {
        // 分流判斷用轉換後的pending（note→attachedEffect的kind變換必須先發生，否則
        // 「附帶效果×1」會以原本的kind:"note"去查既定值表而落到共享池）。原始entry的
        // 明確perPerson標記由goldenTreeRewardEntryToPending()的淺拷貝一併帶過來。
        var pending = goldenTreeRewardEntryToPending(entry);
        if (!isPerPersonRewardEntry(pending)) {
          pushSharedReward(pointId, pending);
          return;
        }
        Object.keys(trig.participants || {}).forEach(function (slot) {
          var p = players[slot];
          if (p) pushPendingReward(p.tokenId, pending);
        });
      });
    });
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

  // 2026-09-08修正（review發現的bug，非規格變更）：meta.resolvedNightBossId存的其實是
  // 「劇本id」（如"tricephalos"，見resolveNightBossScenarioId()說明），不是規則書夜王id
  // （如"gladius"）。先前這裡直接把劇本id當bossId查bossRulebookData()，兩者namespace
  // 不同，10個劇本全部查不到、全部靜默放棄——三首獸（劇本1）進入Day3沒有夜王戰鬥就是
  // 這個bug。正確作法是先用劇本id查scenarios.js對應項目的.bossId欄位。查不到規則書資料
  // （例如自訂劇本沒有夜王資料）就放棄，保留day3階段但沒有戰鬥可打，交由GM/玩家自行
  // 處理，不硬湊一個假夜王（CLAUDE.md §19）。
  function bossIdForResolvedScenario(scenarioId) {
    var Scenarios = window.PriTestScenarios;
    if (!Scenarios || !scenarioId) return null;
    var scenario = Scenarios.list().filter(function (s) {
      return s.id === scenarioId;
    })[0];
    return scenario ? scenario.bossId : null;
  }

  function rollAndAssignDay3Boss() {
    if (!meta || !meta.day3StartAt || fieldTriggers[DAY3_BOSS_POINT_ID] || day3BossRollAttempted) return;
    var bossId = bossIdForResolvedScenario(meta.resolvedNightBossId);
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

  // ---- Day3夜之王開場動畫（2026-09-08新增，見midnight_page.pyの
  // #midnight-day3-boss-intro-overlay說明）----
  var day3BossIntroShown = false; // 本地端（不同步）：這台裝置這場遊戲是否已經播過一次
  var day3BossIntroStartAt = null;
  var DAY3_BOSS_INTRO_STAR_DELAY_MS = 3000;

  function updateDay3BossIntroOverlay(now) {
    var overlay = el("midnight-day3-boss-intro-overlay");
    if (!overlay) return;
    var trig = fieldTriggers[DAY3_BOSS_POINT_ID];
    // 注意：recomputeActiveEncounter()在還沒按[進入戰鬥]確認前，activeEncounter其實是
    // null、candidate暫存在pendingBattleReentry（confirmedEncounterIds真正變true的當下
    // activeEncounter才會變成候選對象）——所以這裡要看pendingBattleReentry，不是
    // activeEncounter，否則這個條件永遠不會成立。玩家按下[進入戰鬥]確認後
    // （pendingBattleReentry變回null）視為「正式開始」，遮罩就該讓路給實際戰鬥畫面。
    var shouldShow = !!(pendingBattleReentry && pendingBattleReentry.id === DAY3_BOSS_POINT_ID && trig);
    if (shouldShow && !day3BossIntroShown) {
      day3BossIntroShown = true;
      day3BossIntroStartAt = now;
      var bossInfo = bossRulebookData(trig.enemyId);
      var bossName = bossInfo ? window.PriTestEnemies.localizedText(bossInfo.name) : trig.enemyId;
      var NightBosses = window.PriTestNightBosses;
      var bossPortrait = NightBosses ? NightBosses.get(trig.enemyId) : null;
      var imgEl = el("midnight-day3-boss-intro-image");
      if (bossPortrait) {
        imgEl.src = NightBosses.imagePath(bossPortrait, "../static/");
        imgEl.hidden = false;
      } else {
        imgEl.hidden = true;
      }
      el("midnight-day3-boss-intro-name").textContent = bossName;
      // fix：前言敘述原本找night_boss_rulebook.jsのintro欄位，但該欄位從未轉錄過資料，
      // 導致這段文字永遠隱藏。這段文字其實跟night.js開局自動播放的〔開場〕敘述是同一份
      // static/worldview.js資料（HTML註解本來就寫「與night的自動開場一樣文本」），改用
      // static/night_gm_flow.jsの既有resolveNightKingNarrationText()（見midnight.jsの
      // renderIntroBossText()同款用法），trig.enemyId對day3Boss而言本來就是bossId
      // （見rollAndAssignDay3Boss()）。找不到資料才隱藏，不自行編造。
      var GmFlowForIntro = window.PriTestNightGmFlow;
      var introText = GmFlowForIntro ? GmFlowForIntro.resolveNightKingNarrationText(trig.enemyId, "opening") || "" : "";
      var introEl = el("midnight-day3-boss-intro-text");
      introEl.textContent = introText;
      introEl.hidden = !introText;
      el("midnight-day3-boss-intro-star").hidden = true;
    }
    if (!shouldShow) {
      overlay.hidden = true;
      return;
    }
    overlay.hidden = false;
    el("midnight-day3-boss-intro-star").hidden = now - day3BossIntroStartAt < DAY3_BOSS_INTRO_STAR_DELAY_MS;
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

  // ---- 上方地點卡牌／籌碼banner的折疊（2026-09-08新增，見topBannerCollapsed說明） ----
  function findActiveTopBanner() {
    for (var i = 0; i < TOP_BANNER_IDS.length; i++) {
      var bannerEl = el(TOP_BANNER_IDS[i]);
      if (bannerEl && !bannerEl.hidden) return bannerEl;
    }
    return null;
  }

  // 用offsetParent判斷button是否真的可見可按（hidden屬性或祖先hidden都會讓offsetParent
  // 變成null），即使外層banner目前正被CSS折疊成一條窄橫條（overflow:hidden，不是display:
  // none）也不影響判斷，因為折疊用的是max-height/overflow，不是display:none。
  function bannerHasActionableButton(bannerEl) {
    if (!bannerEl || bannerEl.hidden) return false;
    var buttons = bannerEl.querySelectorAll("button");
    for (var i = 0; i < buttons.length; i++) {
      if (buttons[i].classList.contains("midnight-top-banner-collapse-btn")) continue;
      if (buttons[i].offsetParent !== null) return true;
    }
    return false;
  }

  // ---- 上方樓層資訊banner vs 左上角色HUD／右上導覽HUD 的疊層優先權（2026-09-10使用者
  // 明確規格「樓層資訊的banner平時高於左上角色與右上導覽的資訊；戰鬥時左上角色與右上導覽
  // 才蓋過banner，且戰鬥結束、離開等等會回復正常；若點了左上角色hud或右上導覽的hud會暫時
  // 蓋過上方樓層資訊banner，3秒後跳回」）。
  //
  // 實作方式沿用既有的html.midnight-top-banner-collapsed同一套「單一全域旗標→html class
  // →CSS選擇器」慣例（見updateTopBannerCollapseUI()），不在JS裡逐個element寫inline
  // z-index：實際的z-index數值全部留在style.css，這裡只負責決定class要不要掛上。
  //
  // 「戰鬥中」直接沿用activeEncounter（recomputeActiveEncounter()維護的既有狀態，非null
  // ＝目前正在跟某個地圖點/籌碼點的敵人交戰），因此「戰鬥結束（敵人HP歸零）」「逃離/離開
  // 觸發範圍」都會讓它變回null，不需要另外寫一套結束偵測。
  var HUD_ABOVE_BANNER_TAP_MS = 3000; // 使用者明確規格：點過左上/右上HUD後暫時蓋過banner的秒數
  var hudAboveBannerUntil = 0; // 0＝沒有進行中的暫時提升；否則是到期時間戳

  function bumpHudAboveBanner() {
    hudAboveBannerUntil = Date.now() + HUD_ABOVE_BANNER_TAP_MS;
    updateHudStackingUI(Date.now());
  }

  function updateHudStackingUI(now) {
    var above = !!activeEncounter || now < hudAboveBannerUntil;
    document.documentElement.classList.toggle("midnight-hud-above-banner", above);
  }

  function updateTopBannerCollapseUI() {
    var activeBanner = findActiveTopBanner();
    var collapsedNow = topBannerCollapsed && !!activeBanner;
    document.documentElement.classList.toggle("midnight-top-banner-collapsed", collapsedNow);
    var reopenBtn = el("btn-midnight-top-banner-reopen");
    if (!reopenBtn) return;
    reopenBtn.hidden = !collapsedNow;
    var shouldFlash = collapsedNow && bannerHasActionableButton(activeBanner);
    reopenBtn.classList.toggle("midnight-flash-yellow", shouldFlash);
    TOP_BANNER_IDS.forEach(function (id) {
      var bannerEl = el(id);
      if (bannerEl) bannerEl.classList.toggle("midnight-flash-yellow", bannerEl === activeBanner && shouldFlash);
    });
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
    maybeAssignTerrifyingStrongEnemyPoint();
  }

  // ---- Task 18新增（設計文件§7）：2日目「⑧恐るべき強敵」點位決定性挑選——「Day2已經
  // 開始」這個訊號不是靠獨立的day-counter函式（本檔沒有currentDayNumber()這種東西），而是
  // 直接沿用上面updateAutoDayAdvance()已經在維護、經RTDB同步給所有裝置的meta.day2StartAt
  // 本身（跟meta.sessionStartAt／meta.day3StartAt同一套「寫入即代表該天已開始」慣例，見
  // currentPhaseInfo()）。從map.points中「目前尚未被roll過（fieldTriggers[pt.id]尚不存在）」
  // 的strong_enemy點用fieldSeededIndex()決定性挑1個，寫入meta.terrifyingStrongEnemyPointId
  // ——若3個點在Day2開始當下就已全數被roll過（不論生死），chosenId=null，一樣送出
  // transaction（不是直接return不寫），對應規劃§7「3個點在Day1就已全數擊敗，則設為null，
  // Day2沒有恐るべき強敵可打，不硬湊」（Fix round 1修正：這裡的候選排除條件是「已被roll過」
  // 而不是單純「已擊敗」，見下方candidates filter的說明）。
  //
  // 冪等性：strong_enemy籌碼點的fieldTriggers[pt.id]只會從「不存在」單向轉成「存在」
  // （rollAndAssignStrongEnemy()對已存在的點絕對不會重roll，也沒有任何地方會把
  // fieldTriggers[pt.id]刪回不存在），因此不論哪台裝置在哪個時間點跑到這裡，候選集合只會
  // 隨時間縮小、不會擴大——最早一次成功的transaction結果（不論是挑到某個點、還是null）
  // 永遠是「當時可能的最大候選集合」下的結果，之後任何裝置重複呼叫都只會算出同一個或候選
  // 更少的子集合，不會推翻先前已經鎖定的選擇。真正決定
  // 「該選哪一個」不需要transaction仲裁（各裝置用同一份meta.mapSeed+候選清單算出同樣的
  // chosenId，跟fieldSeededIndex()既有慣例相同），transaction只用來擋「這個節點是否已經被
  // 寫過」；一旦寫入非null的真實pointId，之後的transaction一律讀到非null的cur、原樣回傳，
  // 不會再被覆蓋。terrifyingStrongEnemyAssignAttempted這個本地旗標則單純節流「同一台裝置
  // 不用每偵都送一次transaction」——尤其重要於null分支：Firebase transaction對某路徑寫入
  // null等同刪除該節點，之後永遠讀不到「已經決定過」的持久痕跡，若沒有本地旗標擋著，
  // updateAutoDayAdvance()每偵呼叫都會再送一次transaction（雖然結果永遠一致、不會出錯，
  // 但會造成不必要的網路流量）。
  function maybeAssignTerrifyingStrongEnemyPoint() {
    if (!meta || !map || !meta.day2StartAt || terrifyingStrongEnemyAssignAttempted) return;
    terrifyingStrongEnemyAssignAttempted = true;
    if (meta.terrifyingStrongEnemyPointId !== undefined) return; // 本機已經同步到別的裝置決定的結果
    // Fix round 1（審查發現）：候選必須排除「已經被roll過」的點，不只排除「已擊敗」的點
    // ——rollAndAssignStrongEnemy()對已存在fieldTriggers[pt.id]的點絕對不會重roll（見該
    // 函式開頭的`if (strongEnemyRollAttempted[pt.id] || fieldTriggers[pt.id]) return;`），
    // 所以只要fieldTriggers[pt.id]已存在（不論生死、不論是否已擊敗），該點的敵人就已經是
    // 用一般表決定好的，此時再把它標記為「恐るべき強敵」只會造成「敵人是一般強度、卻拿到
    // 恐るべき強敵的12盧恩/★★★高倍獎勵」的不一致（例如隊伍分散行動、有人還在跟該點戰鬥
    // 中就跨過了Day1→Day2的20秒過渡窗，這點在多人連線裡是常見情境，不需要精確的單偵時間
    // 巧合）。對應設計文件§7原文「尚未被擊敗」的意圖應理解為「尚未被觸發（尚未roll過）」。
    var candidates = map.points.filter(function (pt) {
      if (pt.type !== "strong_enemy") return false;
      return !fieldTriggers[pt.id]; // 已經roll過（不論生死）就排除
    });
    var chosenId = candidates.length ? candidates[fieldSeededIndex("day2_terrifying_strong_enemy", candidates.length)].id : null;
    GameStorage.rtTransaction(gameId, "cloud", "meta/terrifyingStrongEnemyPointId", function (cur) {
      return cur === null ? chosenId : cur;
    });
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
    // 2026-09-10使用者明確要求「結束夜之強敵戰鬥出現的使用祝福，按下後可以打開祝福視窗，
    // 讓玩家可以升級」：升級的等級±列（#midnight-character-sheet-level-row）住在
    // #midnight-blessing-modal裡（2026-09-06從角色面板搬過去的既有版位），而這顆HUD按鈕
    // 原本只做applyBlessingRestore()＋開放升級額度、沒有開任何視窗——等於玩家拿到了升級
    // 額度卻找不到地方用（地圖籌碼版的祝福視窗只有靠近祝福籌碼時才打得開）。這裡補上開窗，
    // 跟地圖籌碼版的handleBlessingEnterClick()走完全同一個openBlessingModal()（傳入
    // allowWithoutChip，因為這裡沒有對應的地圖祝福籌碼）。
    openBlessingModal(true);
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
    applyPendingDay3HpBonuses();
  }

  // 取引「後に大成したい」良好效果的c._pendingDay3HpBonus（設計文件§9-2「打贏Day2夜之強敵、
  // 進入Day3時+30 HP」）：進入Day3的當下一次性套用到demoStat（現在HP），套用後清除欄位，
  // 見BARGAIN_DEAL_EFFECTS。所有已佔用席位的裝置都會呼叫maybeTriggerDay3FromReady()
  // （每台各自的day3TriggerAttempted只擋住「同一台裝置」重複呼叫），因此對每個tokenId另外
  // 用day3HpBonusAppliedAt/{tokenId}做「cur===null才是第一個寫入」的idempotent guard——
  // 跟meta/day2StartAt／meta/day3StartAt同一套first-writer-wins pattern，靠transaction()
  // 衝突時會用最新伺服器值重跑updateFn的既有Firebase行為，確保只有恰好一台裝置的wonRace
  // 閉包旗標在「最終真正commit那次呼叫」為true，避免多台裝置各自加總造成HP重複疊加。
  function applyPendingDay3HpBonuses() {
    Object.keys(characters).forEach(function (tokenId) {
      var c = characters[tokenId];
      var bonus = c && c._pendingDay3HpBonus;
      if (!bonus) return;
      var wonRace = false;
      GameStorage.rtTransaction(gameId, "cloud", "day3HpBonusAppliedAt/" + tokenId, function (cur) {
        wonRace = cur === null;
        return cur === null ? Date.now() : cur;
      }).then(function () {
        if (!wonRace) return;
        GameStorage.rtTransaction(gameId, "cloud", "demoStat/" + tokenId, function (cur) {
          return (cur === null ? selfArenaHpMax(c) : cur) + bonus;
        });
        GameStorage.rtSet(gameId, "cloud", "character/" + tokenId + "/_pendingDay3HpBonus", null);
      });
    });
  }

  // Day1／Day2夜之強敵戰後HUD區塊顯示中（尚未按下離去）時鎖定地圖移動（2026-09-08使用者
  // 明確要求「[離去]之前不能在地圖上移動」）：判斷條件跟renderFinalCircleRewardsHud()
  // 算day1Available／day2Available同一套，見updateMovement()呼叫端。
  function rewardsMovementLocked(now) {
    var phaseInfo = currentPhaseInfo(now);
    var day1Available = finalCircleBossDefeated(1) && !finalCircleBossDefeated(2) && !day1RewardsDismissed;
    var day2Available = finalCircleBossDefeated(2) && phaseInfo.day < 3 && !day2RewardsDismissed;
    return day1Available || day2Available;
  }

  // 2026-09-10使用者明確要求「結束夜之強敵戰鬥時，在上面banner顯示：離去後才能開始行動……」：
  // 顯示條件直接沿用rewardsMovementLocked()——它就是「現在因為祝福/商人/離去區塊還開著而
  // 不能移動」的既有判斷，兩者永遠一致，不會出現「banner說被鎖住但其實能動」的落差。
  function renderRewardsLockBanner(now) {
    var banner = el("midnight-rewards-lock-banner");
    if (!banner) return;
    banner.hidden = !rewardsMovementLocked(now);
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

  // allowWithoutChip：2026-09-10新增。地圖籌碼版（handleBlessingEnterClick）必須真的站在
  // 祝福籌碼旁才能開窗，因此預設保留原本的nearbyBlessing守衛；夜之強敵戰後HUD的
  // 「使用祝福」（handleHudBlessingUseClick）沒有對應的地圖籌碼，需要跳過這道守衛。
  // 兩者開的是同一個視窗、同一套升級流程，不另外做第二個祝福視窗。
  function openBlessingModal(allowWithoutChip) {
    if (!nearbyBlessing && !allowWithoutChip) return;
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
    var pt = encounterEnemyPoint(); // Task 20：也接受隕石王戰（見encounterEnemyPoint()說明）
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
    // Task 18（設計文件§7）：Day2「⑧恐るべき強敵」點用高倍獎勵，其餘2個點維持一般值。
    var isTerrifying = meta && meta.terrifyingStrongEnemyPointId === pt.id;
    var runes = isTerrifying ? TERRIFYING_STRONG_ENEMY_REWARD_RUNES : STRONG_ENEMY_REWARD_RUNES;
    var stars = isTerrifying ? TERRIFYING_STRONG_ENEMY_REWARD_POTENTIAL_STARS : STRONG_ENEMY_REWARD_POTENTIAL_STARS;
    GameStorage.rtTransaction(gameId, "cloud", "fieldTrigger/" + pt.id + "/rewardGrantedBy", function (cur) {
      return cur === null ? myTokenId : cur;
    }).then(function (committed) {
      if (committed !== myTokenId) return;
      Object.keys(trig.participants || {}).forEach(function (slot) {
        var p = players[slot];
        if (!p) return;
        pushPendingReward(p.tokenId, { kind: "rune", value: runes });
        pushPendingReward(p.tokenId, { kind: "potentialPower", value: stars });
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
  // 依賴自己頁面的DOM/state，因此在這裡另存一份同樣的
  // id清單，只複製5個id字串，不重抄任何規則邏輯，見規劃紀錄）。----
  var MERCHANT_CONSUMABLE_IDS = [
    "item_warming_stone",
    "item_turtle_neck_pickle",
    "item_throwing_pot",
    "item_shard_of_starlight",
    "item_throwing_dagger",
  ];

  // 鍛造台（稀有度強化）費用（設計文件§6，Task 17）：改為消耗鍛造石（item_smithing_stone）
  // 而不是盧恩——C→U消耗1個，U→R消耗2個。鍛造石是noStackLimit道具，堆疊時共用同一格
  // consumables[]（見consumables.jsのitem_smithing_stone／上方applyReward()的
  // entry.kind==="smithingStone"分支同款寫法），因此「持有幾個」要讀該單一instance的
  // usesRemaining，而不是算instance數量。
  function smithingStoneCount(c) {
    var inst = c && (c.consumables || []).filter(function (i) { return i.itemId === "item_smithing_stone"; })[0];
    return inst ? inst.usesRemaining || 0 : 0;
  }

  function consumeSmithingStones(c, n) {
    var inst = (c.consumables || []).filter(function (i) { return i.itemId === "item_smithing_stone"; })[0];
    if (!inst || inst.usesRemaining < n) return false;
    inst.usesRemaining -= n;
    if (inst.usesRemaining <= 0) {
      c.consumables = c.consumables.filter(function (i) { return i !== inst; });
    }
    return true;
  }

  var FORGE_COST_C_TO_U = 1;
  var FORGE_COST_U_TO_R = 2;

  function forgeCostForRarity(rarity) {
    return rarity === "C" ? FORGE_COST_C_TO_U : rarity === "U" ? FORGE_COST_U_TO_R : null;
  }

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
  // 「強化」按鈕（消耗forgeCostForRarity()對應的鍛造石數量，C→U:1、U→R:2，設計文件§6，
  // Task 17改為消耗鍛造石而非盧恩），已達最高（R／L）則顯示已達上限的停用文字。----
  function renderMerchantForgeList() {
    var container = el("midnight-merchant-forge-list");
    container.innerHTML = "";
    var c = characters[myTokenId];
    var heldStones = smithingStoneCount(c);
    el("midnight-merchant-forge-stone-note").textContent = window.I18N.t("midnight_merchant_forge_stone_note", { count: heldStones });
    // 使用者明確規格：「擁有鍛造石的人才能對商人鐵匠進行動作」。
    if (!heldStones) {
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
        var cost = forgeCostForRarity(rarity);
        btn.textContent = window.I18N.t("midnight_merchant_forge_weapon_button", {
          name: name,
          rarity: rarity,
          cost: cost,
        });
        btn.disabled = heldStones < cost;
        btn.addEventListener("click", function () {
          handleMerchantForgeWeapon(weaponId);
        });
      }
      container.appendChild(btn);
    });
  }

  function handleMerchantForgeWeapon(weaponId) {
    var c = characters[myTokenId];
    if (!c) return;
    var CD = window.PriTestCharacterDrawer;
    var rarity = CD.getEffectiveWeaponRarity(c, weaponId);
    var cost = forgeCostForRarity(rarity);
    if (!cost || !consumeSmithingStones(c, cost)) return;
    if (!CD.upgradeWeaponRarity(c, weaponId)) return;
    GameStorage.rtSet(gameId, "cloud", "character/" + myTokenId, c);
    var weapon = window.PriTestWeapons.get(baseCatalogId(weaponId));
    el("midnight-merchant-forge-result").textContent = window.I18N.t("midnight_merchant_forge_result", {
      name: weapon ? window.PriTestWeapons.localizedText(weapon.name) : weaponId,
      rarity: CD.getEffectiveWeaponRarity(c, weaponId),
    });
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
    var diceCount = effectiveCheckDiceCount(c, statKey);
    var dice = [];
    for (var i = 0; i < diceCount; i++) dice.push(1 + Math.floor(Math.random() * 6));
    var sum = dice.reduce(function (a, b) {
      return a + b;
    }, 0);
    var success = checkSucceeded(c, sum, SCARAB_CHECK_TARGET);
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

  // ============================================================================
  // Task 20（設計文件§8.1-8.2）：隨機事件決定機制＋4個分支（聖甲蟲替換／女神像／
  // 埋もれ宝／隕石）。Task 21再補上4個分支（歩く霊廟／夜の勢力／虫の大量発生／
  // 発狂地帯），只剩「襲撃」留給Task 22（其render function仍先用var宣告佔位，理由見
  // 下方renderRandomEventOverlay()前的說明）。
  // ============================================================================

  // 隨機事件籌碼決定（設計文件§8.1）：跟rollAndAssignStrongEnemy()同款first-writer-wins
  // transaction寫法，天然支援多裝置同時靠近時只有一次真正決定。「霊鷹の止まり木」依規格
  // 直接替換成「スカラベ」分支（沿用同一套聖甲蟲判定，不走場地移動機制）。
  function rollAndAssignRandomEvent(pt) {
    if (randomEventRollAttempted[pt.id] || fieldTriggers[pt.id]) return;
    randomEventRollAttempted[pt.id] = true;
    var GmFlow = window.PriTestNightGmFlow;
    var Scenarios = window.PriTestScenarios;
    var chip = findEventChip("random_event");
    var table = chip && chip.extraTables && chip.extraTables[0];
    var scenarioId = resolveNightBossScenarioId();
    var scenarioNumber = scenarioId && Scenarios ? Scenarios.numberForId(scenarioId) : null;
    if (!GmFlow || !table) return;
    var rolled = GmFlow.rollRandomEventTable(table, scenarioNumber);
    if (!rolled) return;
    // rollRandomEventTable()實際回傳{entry, rowIndex, die1, die2, rollLog}，entry是{ja,zh}
    // 雙語物件（見night_gm_flow.js:1667-1692確認）——不是{name:...}。表格原文條目（例如
    // 「隕石（次頁）※シナリオ1、2、7、8のときのみ。それ以外の場合は振り直し。」）夾帶
    // 頁碼參照與「※劇本限定」註記，不是乾淨的分支名稱，因此用「從第一個全形（截斷」取出
    // 乾淨名稱（分支名稱本身不含「（」，逐行核對過event_rulebook.js:1237-1268十行原文）。
    var branchName = ((rolled.entry && rolled.entry.ja) || "").split("（")[0];
    if (branchName === "霊鷹の止まり木") branchName = "スカラベ"; // 設計規格：直接替換，不走場地移動機制
    // 決定表本行寫「蟻の大量発生」，但event_rulebook.js:595實際分支本文標題是「虫の大量発生」
    // （同一頁328/322頁內容，規則書決定表條目名稱與分支自身.name欄位不一致）——這裡統一
    // 改成後者，讓下方renderRandomEventOverlay()的RENDERERS查表鍵（Task 21以「虫の大量発生」
    // 為key）能真正命中。
    if (branchName === "蟻の大量発生") branchName = "虫の大量発生";
    GameStorage.rtTransaction(gameId, "cloud", "fieldTrigger/" + pt.id, function (cur) {
      if (cur !== null) return cur;
      return { status: "resolved", branchNameJa: branchName, participants: {}, resolvedAt: Date.now() };
    });
  }

  // ============================================================================
  // Task 22（設計文件§8.1-8.2）：「襲撃」分支——6種命定敵（1D，event_rulebook.js:1284-1289
  // 「襲撃イベント決定表」，各自劇本限定）：忌み鬼／兆し／調律の魔物／三つ首の獣／
  // 霧の裂け目／安寧者たち。決定表roll已由rollAmbushTable()完成（midnight_random_events.js，
  // Task19/20已核對過event_rulebook.js逐字轉錄），這裡負責render＋分支dispatch。
  //
  // 範圍取捨（見task-22-report.md完整說明）：
  //   - 忌み鬼／兆し（event_rulebook.js:791-861）：乾淨的單體王戰，比照renderMeteorBranch()
  //     直接指派敵人，Lv.6（跳過+L補正，同METEOR_ENEMY_LEVEL等既有慣例），撃破ルーン各6。
  //   - 調律の魔物（event_rulebook.js:862-985）：完整3選1（取引に応じる／立ち去る／
  //     戦いを仕掛ける），重用Task 15的openBargainRevealModal()/BARGAIN_DEAL_EFFECTS/
  //     bargainDealMatchKey()，「戦いを仕掛ける」分支則重用renderAmbushBossBranch()同一套
  //     敵人指派pipeline（trig.ambushEnemyNameJa本來就是"調律の魔物"）。
  //   - 三つ首の獣／霧の裂け目／安寧者たち（event_rulebook.js:986-1280，已於task規劃階段
  //     完整讀過原文）：規則書原文是多階段分歧敘事＋擲骰檢定，沒有單一「指派1隻敵人、
  //     打倒即結束」的乾淨結構（三つ首の獣是3階段逃走/追撃分歧、完全沒有單一敵人物件；
  //     霧の裂け目是3個判定關卡後接協力偷襲、沒有真正的HP戰鬥；安寧者たち是傳送隊伍並
  //     為「之後」的王戰加成，本身不是戰鬥）。硬套用既有王戰pipeline或另外建立第三套
  //     state machine都會發明規則書未明確結構化的機制（CLAUDE.md §11/§36）。比照
  //     docs/midnight_field_chip_rules.md §7.3「規則書其餘分支未接入」的既有先例、CLAUDE.md
  //     §19「■不得自行發明數值」精神：只顯示banner告知分支名稱，交由GM/玩家依實體規則書
  //     桌上處理，並提供「確認」按鈕讓事件視為已處理（沿用trig單一欄位記錄狀態的既有寫法，
  //     同meteorChoice/madnessStage，不另外發明第三套選擇/dismiss機制）。
  // ============================================================================
  var AMBUSH_NAME_LABELS = {
    "忌み鬼": { ja: "忌み鬼", zh: "忌鬼" },
    "兆し": { ja: "兆し", zh: "兆頭" },
    "調律の魔物": { ja: "調律の魔物", zh: "調律的魔物" },
    "三つ首の獣": { ja: "三つ首の獣", zh: "三首之獸" },
    "霧の裂け目": { ja: "霧の裂け目", zh: "霧之裂縫" },
    "安寧者たち": { ja: "安寧者たち", zh: "安寧者們" },
  };
  var AMBUSH_MANUAL_BRANCHES = { "三つ首の獣": true, "霧の裂け目": true, "安寧者たち": true };
  // 忌み鬼(event_rulebook.js:802)／兆し(:842)／調律の魔物「戦いを仕掛ける」分支(:976)皆為
  // 「Lv.6+L補正」，跳過+L補正（既有慣例，同METEOR_ENEMY_LEVEL不套用L補正的理由）。
  var AMBUSH_BOSS_LEVEL = 6;
  // 各自「撃破ルーン」數值：event_rulebook.js:801（忌み鬼）／:841（兆し）／:975（調律の魔物）。
  var AMBUSH_BOSS_RUNE = { "忌み鬼": 6, "兆し": 6, "調律の魔物": 3 };

  function renderAmbushBranch(pt, trig) {
    if (!trig.ambushEnemyNameJa) {
      if (ambushRollAttempted[pt.id]) return;
      ambushRollAttempted[pt.id] = true;
      var scenarioId = resolveNightBossScenarioId();
      var Scenarios = window.PriTestScenarios;
      var scenarioNumber = scenarioId && Scenarios ? Scenarios.numberForId(scenarioId) : null;
      var rolled = window.PriTestMidnightRandomEvents.rollAmbushTable(scenarioNumber);
      if (!rolled) return;
      GameStorage.rtTransaction(gameId, "cloud", "fieldTrigger/" + pt.id + "/ambushEnemyNameJa", function (cur) {
        return cur === null ? rolled.nameJa : cur;
      });
      return;
    }
    el("midnight-random-event-choice-a").hidden = true;
    el("midnight-random-event-choice-b").hidden = true;
    if (trig.ambushEnemyNameJa === "調律の魔物") {
      renderTuningDemonBranch(pt, trig);
      return;
    }
    if (AMBUSH_MANUAL_BRANCHES[trig.ambushEnemyNameJa]) {
      renderAmbushManualBranch(pt, trig);
      return;
    }
    renderAmbushBossBranch(pt, trig);
  }

  // 忌み鬼／兆し：乾淨單體王戰，比照renderMeteorBranch()直接指派敵人、不走§1.3投票/分歧。
  // 也被renderTuningDemonBranch()的「戦いを仕掛ける」分支重用（trig.ambushEnemyNameJa此時
  // 已經是"調律の魔物"，AMBUSH_BOSS_LEVEL/AMBUSH_BOSS_RUNE都能查到正確值）。
  function renderAmbushBossBranch(pt, trig) {
    el("midnight-random-event-action").hidden = true;
    var Fields = window.PriTestFields;
    var label = AMBUSH_NAME_LABELS[trig.ambushEnemyNameJa] || { ja: trig.ambushEnemyNameJa, zh: trig.ambushEnemyNameJa };
    el("midnight-random-event-text").textContent = window.I18N.t("midnight_random_event_ambush_boss_desc", {
      name: Fields.localizedText(label),
    });
    if (trig.enemyFamilyId || ambushEnemyAssignAttempted[pt.id]) return;
    ambushEnemyAssignAttempted[pt.id] = true;
    var GmFlow = window.PriTestNightGmFlow;
    var match = GmFlow && GmFlow.resolveCombatEnemyMatch(trig.ambushEnemyNameJa);
    if (!match) return; // 找不到就整體放棄，不硬湊（同rollAndAssignStrongEnemy()等既有精神）
    // L補：忌み鬼(802)／兆し(842)／調律の魔物「戦いを仕掛ける」(976)三者的規則書文字都是
    // 「Lv.6 + L補正」/「Lv.6＋L補」，見currentLBonus()說明。
    var lBonus = currentLBonus(currentPhaseInfo(Date.now()));
    var finalLevel = AMBUSH_BOSS_LEVEL + lBonus;
    // 同rollAndAssignNightForceEnemy()既有寫法：對整個fieldTrigger物件做單一atomic
    // transaction，避免enemyFamilyId/enemyId/level分開多次transaction可能交錯寫入的不一致組合。
    GameStorage.rtTransaction(gameId, "cloud", "fieldTrigger/" + pt.id, function (cur) {
      if (cur && cur.enemyFamilyId) return cur;
      var out = {};
      for (var k in cur) out[k] = cur[k];
      out.enemyFamilyId = match.familyId;
      out.enemyId = match.enemy.id;
      out.level = finalLevel;
      out.lBonus = lBonus;
      return out;
    }).then(function () {
      GameStorage.rtTransaction(gameId, "cloud", "fieldEnemyHp/" + pt.id, function (cur) {
        return cur === null
          ? enemyRealHpMax({ enemyFamilyId: match.familyId, enemyId: match.enemy.id, level: finalLevel })
          : cur;
      });
    });
  }

  // 撃破偵測與獎勵：跟maybeGrantMeteorReward()同一套first-writer-wins transaction，掛在
  // 同一個「每偵掃描一次」呼叫點（updateNearbyChipPoint()）。涵蓋忌み鬼／兆し／調律の魔物
  // 「戦いを仕掛ける」這3種會真正走上王戰pipeline的結局（三つ首の獣等3個manual分支不會
  // 指派enemyFamilyId，本函式自然不會對它們動作）。
  function maybeGrantAmbushReward(pt) {
    if (!pt || ambushRewardAttempted[pt.id]) return;
    var trig = fieldTriggers[pt.id];
    if (!trig || trig.branchNameJa !== "襲撃" || !trig.enemyFamilyId) return;
    var hp = fieldEnemyHp[pt.id];
    if (hp === undefined || hp > 0) return;
    ambushRewardAttempted[pt.id] = true;
    // L補：忌み鬼(801)／兆し(841)的撃破ルーン文字是「6 + L補正」，調律の魔物(975)則明確
    // 只寫「撃破ルーン：3」沒有L補正，三者共用trig.lBonus（指派敵人時已凍結，見
    // renderAmbushBossBranch()）但只對前兩者加上去。
    var runeBase = AMBUSH_BOSS_RUNE[trig.ambushEnemyNameJa] || 0;
    var runeValue = runeBase && trig.ambushEnemyNameJa !== "調律の魔物" ? runeBase + (trig.lBonus || 0) : runeBase;
    GameStorage.rtTransaction(gameId, "cloud", "fieldTrigger/" + pt.id + "/rewardGrantedBy", function (cur) {
      return cur === null ? myTokenId : cur;
    }).then(function (committed) {
      if (committed !== myTokenId) return;
      Object.keys(trig.participants || {}).forEach(function (slot) {
        var p = players[slot];
        if (!p) return;
        if (runeValue) pushPendingReward(p.tokenId, { kind: "rune", value: runeValue });
        if (trig.ambushEnemyNameJa === "調律の魔物") {
          // event_rulebook.js:981-982「潜在する力：★★」＝2個★，跟fields_data_4.js:2216-2219
          // 已結構化的同一份固定卡牌獎勵一致（武器附加「発狂／-5」的文字性質同weaponStar的
          // attributeTag，potentialPower既有的抽選流程本來就不吃這個attributeTag，
          // 同既有簡化，不重新發明）。
          pushPendingReward(p.tokenId, { kind: "potentialPower", value: 2 });
        }
        var c = characters[p.tokenId];
        if (!c) return;
        if (trig.ambushEnemyNameJa === "忌み鬼") {
          // event_rulebook.js:826-827「祝福王の恩寵」需要追蹤「本劇本內用於祝福休息的祝福數a」，
          // 已grep確認codebase沒有這個計數器，因此不自動套用「+(a×2)」，只留規則書原文交由
          // GM/玩家自行判斷（CLAUDE.md §19）。「夜に刻まれし癒えぬ傷」是PC死亡分支才會觸發的
          // 另一種結局，本函式只在hp<=0（真正撃破）時執行，不會誤觸發它。
          c._lastTileRewardNote = { text: window.I18N.t("midnight_random_event_ambush_imi_oni_grace_note"), at: Date.now() };
          GameStorage.rtSet(gameId, "cloud", "character/" + p.tokenId, c);
        } else if (trig.ambushEnemyNameJa === "兆し") {
          // event_rulebook.js:857-858「融合する命」：聖杯瓶回HP時FP同量回復——比其餘恩寵單純
          // （純加成、無條件分支），且commitFlaskHeal()的改動風險低，因此結構化為_fusedLife
          // 旗標（見commitFlaskHeal()新增的判斷）。
          c._fusedLife = true;
          c._lastTileRewardNote = { text: window.I18N.t("midnight_random_event_ambush_kizashi_grace_note"), at: Date.now() };
          GameStorage.rtSet(gameId, "cloud", "character/" + p.tokenId, c);
        }
      });
    });
  }

  // 三つ首の獣／霧の裂け目／安寧者たち：規則書為多階段分歧敘事，不建立第三套state machine
  // （見上方大段設計取捨註解），只顯示分支名稱＋交由GM/玩家依實體規則書桌上處理，並提供
  // 一個「確認」按鈕讓事件視為已處理（沿用trig單一欄位記錄狀態的既有寫法，同meteorChoice）。
  function renderAmbushManualBranch(pt, trig) {
    var Fields = window.PriTestFields;
    var label = AMBUSH_NAME_LABELS[trig.ambushEnemyNameJa] || { ja: trig.ambushEnemyNameJa, zh: trig.ambushEnemyNameJa };
    el("midnight-random-event-text").textContent = window.I18N.t("midnight_random_event_ambush_manual_desc", {
      name: Fields.localizedText(label),
    });
    var acknowledged = !!trig.ambushManualAcknowledged;
    el("midnight-random-event-action").hidden = acknowledged;
    el("midnight-random-event-action").textContent = window.I18N.t("midnight_random_event_ambush_manual_ack_button");
    el("midnight-random-event-action").onclick = function () {
      GameStorage.rtSet(gameId, "cloud", "fieldTrigger/" + pt.id + "/ambushManualAcknowledged", true);
    };
    el("midnight-random-event-result").textContent = acknowledged
      ? window.I18N.t("midnight_random_event_ambush_manual_done_note")
      : "";
  }

  // 調律の魔物：完整3選1（取引に応じる／立ち去る／戦いを仕掛ける，event_rulebook.js:862-985）。
  // 「取引抽選表」6個deal跟Task 15為fields_data_4.js「秤の商人」固定卡牌結構化的是同一份
  // rulebook內容（同一個「秤の商人」，只是這裡是隨機事件觸發、那裡是固定卡牌觸發），
  // 因此直接複製該處已核對過的deals陣列（fields_data_4.js:2151-2197）供openBargainRevealModal()
  // /BARGAIN_DEAL_EFFECTS/bargainDealMatchKey()重用，不重新從event_rulebook.js原文轉錄
  // 第二次（避免轉錄drift）。注意：event_rulebook.js自己這份「襲撃」版本原文（:891-945）
  // 在deal 3的悪い効果與deal 5的悪い効果上，文字跟fields_data_4.js已結構化版本有極小出入
  // （deal3：「現在HP」有無；deal5：「⚀」vs「□」），已於task-22-report.md記錄，這裡依
  // brief指示採用fields_data_4.js已核對版本，不視為需要修正的錯誤。
  var TUNING_DEMON_DEALS = [
    {
      label: { ja: "1｜〇〇に優れた体になりたい", zh: "1｜想擁有擅長〇〇的身體" },
      good: {
        ja: "判定値：運試し／フィジカル／メンタルをランダムに1種選び「+2」する。",
        zh: "判定值：運氣／體能／精神隨機選1種「+2」。",
      },
      bad: { ja: "「+5」以上の威力補正をランダムに1種選び「-5」する。", zh: "隨機選擇「+5」以上的威力補正1種「-5」。" },
    },
    {
      label: { ja: "2｜後に大成したい", zh: "2｜想在日後有所成就" },
      good: {
        ja: "夜の王との戦闘で2ターン目のアクションフェイズ開始時を迎えたとき、シナリオ終了まで自身を「最大HP：+□□□」する。",
        zh: "與夜之王戰鬥時，迎來第2回合行動階段開始時，直到劇本結束為止，自身「最大HP：+□□□」。",
      },
      bad: { ja: "自身を「最大FP：-□」と「最大加護：-□」する。", zh: "自身「最大FP：-□」與「最大加護：-□」。" },
    },
    {
      label: { ja: "3｜全力で戦いたい", zh: "3｜想全力戰鬥" },
      good: { ja: "自身を「最大HP：+□」し、「任意の威力補正：+5」する。", zh: "自身「最大HP：+□」，並「任選威力補正：+5」。" },
      bad: {
        ja: "夜の王のすべてのHPラインを「最大HPと現在HP：+□」する（複数のPCでこの効果が発揮された場合、累積する）。",
        zh: "夜之王的所有HP行「最大HP與現在HP：+□」（多名PC發揮此效果時，累積）。",
      },
    },
    {
      label: { ja: "4｜聖杯瓶が欲しい", zh: "4｜想要聖杯瓶" },
      good: { ja: "自身の聖杯瓶を「最大使用回数：+〇」する。", zh: "自身聖杯瓶「最大使用次數：+〇」。" },
      bad: { ja: "自身を「最大HP：-□（最低値1）」する。", zh: "自身「最大HP：-□（最低值1）」。" },
    },
    {
      label: { ja: "5｜状態異常に強くなりたい", zh: "5｜想更能抵抗異常狀態" },
      good: {
        ja: "自身がエネミーから被るすべての「状態異常蓄積最大値」を「+1」する（状態異常になりづらくなる）。",
        zh: "自身承受敵人所有「異常狀態最大蓄積值」「+1」（更不易陷入異常狀態）。",
      },
      bad: {
        ja: "自身がアクションフェイズかエクストラフェイズの開始時に獲得したすべてのスタミナダイスの出目を自動的に「□」に変更する（隊列決定前）。",
        zh: "自身於行動階段或額外階段開始時獲得的所有體力骰出目，自動變更為「□」（隊列決定前）。",
      },
    },
    {
      label: { ja: "6｜死を遠ざけたい", zh: "6｜想遠離死亡" },
      good: { ja: "自身はディフェンスフェイズ開始時にスタミナダイス1個を獲得。", zh: "自身於防禦階段開始時獲得體力骰1個。" },
      bad: { ja: "自身を「最大HP：-□（最低値1）」する。", zh: "自身「最大HP：-□（最低值1）」。" },
    },
  ];

  function renderTuningDemonBranch(pt, trig) {
    el("midnight-random-event-action").hidden = true;
    el("midnight-random-event-text").textContent = window.I18N.t("midnight_random_event_tuning_demon_desc");
    el("midnight-random-event-result").textContent = "";
    if (!trig.tuningDemonChoice) {
      ["deal", "leave", "fight"].forEach(function (choiceKey) {
        var btn = el("midnight-tuning-demon-choice-" + choiceKey);
        btn.hidden = false;
        btn.onclick = function () {
          GameStorage.rtSet(gameId, "cloud", "fieldTrigger/" + pt.id + "/tuningDemonChoice", choiceKey);
        };
      });
      return;
    }
    ["deal", "leave", "fight"].forEach(function (choiceKey) {
      el("midnight-tuning-demon-choice-" + choiceKey).hidden = true;
    });
    if (trig.tuningDemonChoice === "deal") {
      // 取引是玩家個人選擇（同maybeGrantFieldTileReward()既有bargainReveal處理精神：每個
      // participant各自在自己的裝置上開自己的取引視窗，不走搶鎖流程）。用本地節流旗標
      // 只主動開啟一次，避免render tick每偵重複呼叫把使用者剛關閉的modal又打開。
      if (!tuningDemonBargainOpened[pt.id]) {
        tuningDemonBargainOpened[pt.id] = true;
        openBargainRevealModal(pt, trig, { deals: TUNING_DEMON_DEALS });
      }
      return;
    }
    if (trig.tuningDemonChoice === "leave") {
      // event_rulebook.js:960-961：僅「発狂」最大蓄積值-2的note，跟fields_data_4.js:2201-2212
      // 既有的note-kind precedent一致，不可自動套用，交由GM/玩家自行記錄（不新增
      // _madnessMaxDebuff之類沒有其他地方會讀取的欄位）。
      el("midnight-random-event-result").textContent = window.I18N.t("midnight_random_event_tuning_demon_leave_note");
      return;
    }
    // 戦いを仕掛ける：重用renderAmbushBossBranch()同一套敵人指派pipeline
    // （trig.ambushEnemyNameJa此時已是"調律の魔物"）。
    renderAmbushBossBranch(pt, trig);
  }

  function renderRandomEventOverlay() {
    var pt = nearbyRandomEvent;
    var trig = pt && fieldTriggers[pt.id];
    // 每次重繪先把「聖甲蟲」跟「其餘8分支通用」兩個banner都收起來，才由實際命中的分支
    // render function決定顯示哪一個——兩者是各自獨立的DOM id（見site_src/midnight_page.py），
    // 不會互相自動隱藏，否則「先靠近A分支點看到banner，走開後靠近B分支點」會有banner
    // 殘留沒收起來的問題。同理，女神像專用的「破壊」按鈕（fix-round新增）也在這裡一併
    // 先收起——它只被renderGoddessStatueBranch()主動顯示，其餘分支render function
    // （埋もれ宝／隕石／聖甲蟲等）完全不會碰它，若不在這裡統一重置，「先靠近女神像點看到
    // 按鈕顯示，走開後靠近另一個分支點」會讓這顆按鈕（連同其綁定舊pt的onclick）殘留顯示。
    // Task 21新增：#midnight-random-event-action／choice-a／choice-b三顆按鈕在不同分支間
    // 共用同一組DOM（見site_src/midnight_page.py），彼此的文字（data-i18n初始套用的預設
    // 「進行判定」「前往查看」「遠離」）可能被個別render function（例如発狂地帯塔1的
    // 「離開」／「探索塔」、虫の大量発生知性の蟲を追う的「HP／FP」二選一）動態覆寫成
    // 別的文字。因此每次重繪都先重置回三顆按鈕各自的預設i18n文字，再交給實際命中的分支
    // render function視需要覆寫——否則「先靠近発狂地帯看到『離開』/『探索塔』，走開後靠近
    // 隕石點」會讓隕石的『前往查看』/『遠離』按鈕殘留顯示成『離開』/『探索塔』。
    el("midnight-random-event-action").textContent = window.I18N.t("midnight_random_event_action_button");
    el("midnight-random-event-choice-a").textContent = window.I18N.t("midnight_random_event_choice_a_button");
    el("midnight-random-event-choice-b").textContent = window.I18N.t("midnight_random_event_choice_b_button");
    el("midnight-scarab-banner").hidden = true;
    el("midnight-random-event-banner").hidden = true;
    el("midnight-random-event-goddess-break-action").hidden = true;
    // Task 22新增：調律の魔物専用的3顆選項按鈕，跟goddess-break-action同一種「其餘分支完全
    // 不會碰它，若不在這裡統一重置就會殘留顯示」的理由，一併每次重繪先收起。
    el("midnight-tuning-demon-choice-deal").hidden = true;
    el("midnight-tuning-demon-choice-leave").hidden = true;
    el("midnight-tuning-demon-choice-fight").hidden = true;
    if (!pt || !trig || !trig.branchNameJa) return;
    var RENDERERS = {
      "スカラベ": renderScarabBranch,
      "女神像": renderGoddessStatueBranch,
      "埋もれ宝": renderBuriedTreasureBranch,
      "隕石": renderMeteorBranch,
      "歩く霊廟": renderWalkingMausoleumBranch, // Task 21
      "夜の勢力": renderNightForceBranch, // Task 21
      "虫の大量発生": renderInsectSwarmBranch, // Task 21
      "発狂地帯": renderMadnessZoneBranch, // Task 21
      "襲撃": renderAmbushBranch, // Task 22
    };
    var renderer = RENDERERS[trig.branchNameJa];
    if (renderer) renderer(pt, trig);
  }

  function renderScarabBranch(pt, trig) {
    // 沿用現有renderScarabOverlay()／handleScarabCheckClick()全部邏輯，原樣呼叫，不修改。
    renderScarabOverlay();
  }

  // ---- 女神像分支（event_rulebook.js:400-441）----
  var GODDESS_STATUE_CHECK_TARGET = 10; // event_rulebook.js:418「〈10｜メンタル〉」
  // 追跡者／無頼漢／守護者／執行者（含各自暗黑/黎明變體）typeId，見character_types.js
  // 實際核對過的清單（grep "id: \"tracker|ruffian|guardian|executor"）。
  var GODDESS_STATUE_RESTRICTED_TYPE_IDS = ["tracker", "tracker_dark", "ruffian", "ruffian_dark", "guardian", "guardian_dawn", "executor", "executor_dark"];

  function renderGoddessStatueBranch(pt, trig) {
    var banner = el("midnight-random-event-banner");
    banner.hidden = false;
    el("midnight-random-event-choice-a").hidden = true;
    el("midnight-random-event-choice-b").hidden = true;
    el("midnight-random-event-text").textContent = window.I18N.t("midnight_random_event_goddess_desc");
    var attempted = !!(trig.attempted && trig.attempted[mySlot]);
    el("midnight-random-event-action").hidden = attempted;
    el("midnight-random-event-action").onclick = function () {
      handleGoddessStatueCheckClick(pt);
    };
    if (!attempted) el("midnight-random-event-result").textContent = "";

    // fix-round（review指摘）：event_rulebook.js:426-427實際上是兩個彼此獨立的條件——
    // ①「1人でも成功すれば」是全場只要曾有任一PC（不限職業、不限是不是後面破壞的那個人）
    // 成功過一次〈10｜メンタル〉，這件事就對全場成立；②「PCに追跡者／無頼漢／守護者／
    // 執行者のいずれかがいる場合」則是任一符合這4職業(含變體)之一的PC都可以消費技藝破壞，
    // 規則書原文沒有要求②的人必須是①判定成功的同一人。因此這裡用另一顆獨立按鈕呈現
    // 「破壊」動作：只要trig.goddessSucceeded為真（不管是誰讓它變真）、且目前操作角色
    // 本身符合4職業之一、且尚未被任何人領取過（trig.statueRewardGrantedBy，
    // first-writer-wins鎖，見handleGoddessStatueBreakClick()），任何裝置上符合條件的
    // PC都能看到並按下這顆按鈕。
    var breakBtn = el("midnight-random-event-goddess-break-action");
    var breakC = characters[myTokenId];
    var breakEligible = !!(breakC && breakC.typeId && GODDESS_STATUE_RESTRICTED_TYPE_IDS.indexOf(breakC.typeId) !== -1);
    breakBtn.hidden = !(trig.goddessSucceeded && breakEligible && !trig.statueRewardGrantedBy);
    breakBtn.onclick = function () {
      handleGoddessStatueBreakClick(pt);
    };
  }

  function handleGoddessStatueCheckClick(pt) {
    if (!mySlot || isPaused() || isSelfDowned()) return;
    var trig = fieldTriggers[pt.id];
    if (trig && trig.attempted && trig.attempted[mySlot]) return;
    GameStorage.rtSet(gameId, "cloud", "fieldTrigger/" + pt.id + "/attempted/" + mySlot, true);
    // event_rulebook.js:418「FP損害：■」——■數值規則書未標示，依CLAUDE.md §19不自行發明，
    // 不在這裡自動扣除任何FP，交由GM依規則書原文處理（描述文字midnight_random_event_goddess_desc
    // 已保留這段提示）。
    var c = characters[myTokenId];
    var diceCount = effectiveCheckDiceCount(c, "mental");
    var sum = 0;
    for (var i = 0; i < diceCount; i++) sum += 1 + Math.floor(Math.random() * 6);
    var success = checkSucceeded(c, sum, GODDESS_STATUE_CHECK_TARGET);
    el("midnight-random-event-result").textContent = window.I18N.t(success ? "midnight_random_event_success_note" : "midnight_random_event_fail_note", {
      sum: sum,
      target: GODDESS_STATUE_CHECK_TARGET,
    });
    if (success) {
      // fix-round（review指摘）：event_rulebook.js:426「1人でも成功すれば」是對全場成立的
      // 共享事實，不是只屬於這次點擊的local變數，因此寫入trig層級的goddessSucceeded，讓
      // 所有裝置上的renderGoddessStatueBranch()／任何符合4職業之一的PC都能感知並之後
      // 觸發破壞（見handleGoddessStatueBreakClick()），不要求破壞者必須是判定成功的
      // 同一人。
      GameStorage.rtSet(gameId, "cloud", "fieldTrigger/" + pt.id + "/goddessSucceeded", true);
    }
  }

  function handleGoddessStatueBreakClick(pt) {
    if (!mySlot || isPaused() || isSelfDowned()) return;
    var trig = fieldTriggers[pt.id];
    if (!trig || !trig.goddessSucceeded) return;
    var c = characters[myTokenId];
    if (!c || GODDESS_STATUE_RESTRICTED_TYPE_IDS.indexOf(c.typeId) === -1) return;
    // event_rulebook.js:426-427：只要全場曾有任一人判定成功（trig.goddessSucceeded，不必是
    // 自己），且自己是指定4職業(含變體)之一，即可消費技藝破壞女神像，獲得鍊石×3。跟
    // maybeGrantStrongEnemyReward()/maybeGrantFieldTileReward()同款first-writer-wins
    // transaction鎖（fieldTrigger/{id}/statueRewardGrantedBy），確保就算多名符合職業的
    // PC同時按下，也只會真正發放一次。
    GameStorage.rtTransaction(gameId, "cloud", "fieldTrigger/" + pt.id + "/statueRewardGrantedBy", function (cur) {
      return cur === null ? myTokenId : cur;
    }).then(function (committed) {
      if (committed !== myTokenId) return;
      // 這是單一PC的個人動作（消費自己的技藝），不是trig.participants群體踏破獎勵，
      // 因此沿用既有做法：直接重用grantTileLootToParticipants()既有的「推進pendingRewards」
      // 邏輯，participants只放觸發者自己這一個席位。
      // "consumable"kind在computeRewardDraw()裡只認itemId對應的固定品項（忽略value欄位），
      // 無法表達「×3」，正確的kind是"smithingStone"（見該函式"stoneswordKey"/"smithingStone"
      // 分支，value才真的會被疊加進usesRemaining）。
      var soloParticipants = {};
      soloParticipants[mySlot] = true;
      grantTileLootToParticipants({ participants: soloParticipants }, [{ kind: "smithingStone", value: 3, perPerson: true }]);
    });
  }

  // ---- 埋もれ宝分支（event_rulebook.js:442-464）----
  var BURIED_TREASURE_CHECK_TARGET_PER_PC = 12; // event_rulebook.js:452「〈協力12×PC人數｜運試し〉」

  // 判定骰數（2026-09-10遺物效果稽核補實作）：規則書遺物效果「學習能力（精神／運氣／
  // 體能）」＝「將自身『精神：+1』」是加在**擲骰顆數**上，night.js側早就有對應處理
  // （night_floor_breakthrough.jsのeffectiveCheckValue()／auto_gm.js），但midnight這邊
  // 7處判定全部只讀type.checkValues，等於這個遺物效果在即時制完全不生效。
  // 這裡完全重用CharacterDrawer.getCheckStatBonus()（既有純函式，解析遺物本文的+N），
  // 不在midnight另外解析一次規則文字，計算方式與night.js一致（base + bonus，下限0）。
  function effectiveCheckDiceCount(c, statKey) {
    var type = c && c.typeId ? window.PriTestCharacterTypes.get(c.typeId) : null;
    var base = type && type.checkValues && statKey ? type.checkValues[statKey] || 0 : 0;
    var bonus = c && CharacterDrawer.getCheckStatBonus ? CharacterDrawer.getCheckStatBonus(c, statKey) : 0;
    return Math.max(0, base + bonus);
  }

  // 學者「最大加護提升」（2026-09-11使用者明確規格「自身出現的判定皆為過關」）：
  // 規則書原文是「將自身『最大加護：+□』」，而 midnight 沒有「加護」這個資源
  // （只有 HP/FP/體力），因此使用者改指定為「自身的判定必定成功」。所有單人判定都
  // 走這支 helper（協力判定 teamCheckSum() 是全隊加總、不是「自身的判定」，不套用）。
  function checkSucceeded(c, sum, target) {
    if (hasRelic(c, "maxBlessingUp")) return true;
    return sum >= target;
  }

  // Task 21引入通用「協力判定」helper（teamCheckSum(trig, statKey)）前的最小版本：依
  // trig.participants加總每個參與者角色對應checkValues的擲骰。埋もれ宝分支本身沒有
  // 「進入」／「加入」步驟（不像strong_enemy/隕石王戰需要先按進入戰鬥），因此呼叫端
  // （見下方handleBuriedTreasureCheckClick()）改傳「目前入座的全部玩家席位」而不是
  // trig.participants本身（trig.participants對這個分支永遠是空的，直接傳trig會讓
  // 「PC人數」變成0、判定變成必定成功——不是規則書原意）。
  function teamCheckSum(trig, statKey) {
    var sum = 0;
    participantSlots(trig).forEach(function (slot) {
      var p = players[slot];
      var c = p && characters[p.tokenId];
      var diceCount = effectiveCheckDiceCount(c, statKey);
      for (var i = 0; i < diceCount; i++) sum += 1 + Math.floor(Math.random() * 6);
    });
    return sum;
  }

  function renderBuriedTreasureBranch(pt, trig) {
    var banner = el("midnight-random-event-banner");
    banner.hidden = false;
    el("midnight-random-event-choice-a").hidden = true;
    el("midnight-random-event-choice-b").hidden = true;
    el("midnight-random-event-text").textContent = window.I18N.t("midnight_random_event_buried_treasure_desc");
    el("midnight-random-event-action").hidden = !!trig.resolvedOutcome;
    el("midnight-random-event-action").onclick = function () {
      handleBuriedTreasureCheckClick(pt);
    };
    el("midnight-random-event-result").textContent = trig.resolvedOutcome
      ? window.I18N.t(trig.resolvedOutcome === "success" ? "midnight_random_event_treasure_success_note" : "midnight_random_event_treasure_fail_note")
      : "";
  }

  function handleBuriedTreasureCheckClick(pt) {
    if (!mySlot || isPaused() || isSelfDowned()) return;
    var trig = fieldTriggers[pt.id];
    if (!trig || trig.resolvedOutcome) return;
    // 「PC人數」讀全場目前入座的玩家席位數，不是trig.participants（本分支沒有像
    // strong_enemy/隕石王戰那樣「按下進入戰鬥」的加入步驟，規則書原文本身也沒有要求玩家
    // 先加入才能參與這個一次性協力判定，見event_rulebook.js:452）。Task 21若之後引入真正
    // 通用的協力判定helper，這裡的PC人數來源可能需要一併對齊。
    var activeSlots = Object.keys(players).filter(function (slot) {
      return !!players[slot];
    });
    var participantsMap = {};
    activeSlots.forEach(function (slot) {
      participantsMap[slot] = true;
    });
    var target = BURIED_TREASURE_CHECK_TARGET_PER_PC * activeSlots.length;
    var sum = teamCheckSum({ participants: participantsMap }, "luck");
    GameStorage.rtTransaction(gameId, "cloud", "fieldTrigger/" + pt.id, function (cur) {
      if (!cur || cur.resolvedOutcome) return cur;
      var out = {};
      for (var k in cur) out[k] = cur[k];
      out.resolvedOutcome = sum >= target ? "success" : "fail";
      return out;
    }).then(function () {
      if (sum >= target) {
        // event_rulebook.js:458「次の表を見て1Dを3回振り、それぞれの出目に沿った
        // アイテムを1つずつ、合計3個得る」——PC達（隊伍）共享，不是個人專屬，走
        // pushSharedReward()共享池先搶先贏（同其餘固定共享獎勵的既有做法）。
        window.PriTestMidnightRandomEvents.rollChestTableThreeTimes().forEach(function (row) {
          pushSharedReward(pt.id, { kind: row.kind, value: row.value, perPerson: false });
        });
      }
    });
  }

  // ---- 隕石分支（event_rulebook.js:467-499）----
  function renderMeteorBranch(pt, trig) {
    // 描寫「→隕石」／遠離二選一（event_rulebook.js:477原文兩個選項）：這是單一玩家可
    // 自行決定的探索性選擇，不是需要多人協商的§1.3板塊分歧投票，因此沿用簡單的「選項A/
    // 選項B」按鈕做法，不套用投票機制。
    var banner = el("midnight-random-event-banner");
    banner.hidden = false;
    el("midnight-random-event-action").hidden = true;
    el("midnight-random-event-text").textContent = window.I18N.t("midnight_random_event_meteor_desc");
    if (!trig.meteorChoice) {
      el("midnight-random-event-choice-a").hidden = false;
      el("midnight-random-event-choice-a").onclick = function () {
        GameStorage.rtSet(gameId, "cloud", "fieldTrigger/" + pt.id + "/meteorChoice", "go");
      };
      el("midnight-random-event-choice-b").hidden = false;
      el("midnight-random-event-choice-b").onclick = function () {
        GameStorage.rtSet(gameId, "cloud", "fieldTrigger/" + pt.id + "/meteorChoice", "flee");
      };
      el("midnight-random-event-result").textContent = "";
      return;
    }
    el("midnight-random-event-choice-a").hidden = true;
    el("midnight-random-event-choice-b").hidden = true;
    el("midnight-random-event-result").textContent = window.I18N.t(
      trig.meteorChoice === "go" ? "midnight_random_event_meteor_go_note" : "midnight_random_event_meteor_flee_note"
    );
    if (trig.meteorChoice !== "go" || trig.enemyFamilyId || meteorEnemyAssignAttempted[pt.id]) return;
    meteorEnemyAssignAttempted[pt.id] = true;
    var GmFlow = window.PriTestNightGmFlow;
    var match = GmFlow && GmFlow.resolveCombatEnemyMatch("降る星の成獣");
    if (!match) return; // 找不到就整體放棄，不硬湊（同rollAndAssignStrongEnemy()既有精神）
    GameStorage.rtTransaction(gameId, "cloud", "fieldTrigger/" + pt.id + "/enemyFamilyId", function (cur) {
      return cur === null ? match.familyId : cur;
    });
    GameStorage.rtTransaction(gameId, "cloud", "fieldTrigger/" + pt.id + "/enemyId", function (cur) {
      return cur === null ? match.enemy.id : cur;
    });
    GameStorage.rtTransaction(gameId, "cloud", "fieldTrigger/" + pt.id + "/level", function (cur) {
      return cur === null ? METEOR_ENEMY_LEVEL : cur;
    });
    GameStorage.rtTransaction(gameId, "cloud", "fieldEnemyHp/" + pt.id, function (cur) {
      return cur === null ? enemyRealHpMax({ enemyFamilyId: match.familyId, enemyId: match.enemy.id, level: METEOR_ENEMY_LEVEL }) : cur;
    });
  }

  // 擊殺偵測與獎勵：跟maybeGrantStrongEnemyReward()同一套first-writer-wins transaction
  // 保證只有一台裝置實際push獎勵，push對象是participants內所有玩家（進入戰鬥時由
  // handleStrongEnemyEnterClick()／encounterEnemyPoint()通用流程寫入，見上方）。
  function maybeGrantMeteorReward(pt) {
    if (!pt || meteorRewardAttempted[pt.id]) return;
    var trig = fieldTriggers[pt.id];
    if (!trig || trig.branchNameJa !== "隕石" || !trig.enemyFamilyId) return;
    var hp = fieldEnemyHp[pt.id];
    if (hp === undefined || hp > 0) return;
    meteorRewardAttempted[pt.id] = true;
    // L補：event_rulebook.js:491「撃破ルーン：8 + L補正」——只有撃破ルーン有L補正，
    // 敵人本身等級固定Lv.8無L補正（見上方METEOR_ENEMY_LEVEL註解），因此這裡單獨算，不
    // 沿用trig.lBonus（那個欄位在其他分支代表「敵人本身有沒有被L補正加成」，meteor敵人
    // 沒有，不能共用同一個判斷）。
    var runeValue = METEOR_REWARD_RUNES + currentLBonus(currentPhaseInfo(Date.now()));
    GameStorage.rtTransaction(gameId, "cloud", "fieldTrigger/" + pt.id + "/rewardGrantedBy", function (cur) {
      return cur === null ? myTokenId : cur;
    }).then(function (committed) {
      if (committed !== myTokenId) return;
      Object.keys(trig.participants || {}).forEach(function (slot) {
        var p = players[slot];
        if (!p) return;
        // "potentialPower"這個kind目前只有pendingRewards抽選清單流程認得（見
        // renderPotentialPowerRewardDetail()，不是computeRewardDraw()的一般draft流程），
        // 所以這裡必須跟maybeGrantStrongEnemyReward()一樣走pushPendingReward()逐一個別
        // 授予、而不是pushPerPlayerReward()（那只是fieldProgress後補領取ledger，本身
        // 不會立即套用任何東西）。
        pushPendingReward(p.tokenId, { kind: "rune", value: runeValue });
        pushPendingReward(p.tokenId, { kind: "potentialPower", value: METEOR_REWARD_POTENTIAL_STARS });
      });
    });
  }

  // ============================================================================
  // Task 21（設計文件§8.2）：歩く霊廟／夜の勢力／虫の大量発生／発狂地帯4個分支。
  // 共用小工具：目前入座的玩家席位（跟handleBuriedTreasureCheckClick()既有的activeSlots
  // 寫法一致，抽成具名函式供這4個分支重複使用）。這4個分支（除了夜の勢力有「進入戰鬥」
  // 加入流程外）都沒有像strong_enemy那樣的participants加入步驟，規則書原文也是要求
  // 「PCそれぞれ」個別行動或「協力N×PC人數」全員協力，因此協力判定的「PC人數」與「是否
  // 全員嘗試過」都應該讀目前入座的席位，不是trig.participants（這幾個分支的
  // trig.participants本來就一直是空物件）。
  // ============================================================================
  function currentlySeatedSlots() {
    return Object.keys(players).filter(function (slot) {
      return !!players[slot];
    });
  }

  // ---- 歩く霊廟分支（event_rulebook.js:503-544）----
  var MAUSOLEUM_CHECK_TARGET = 11; // event_rulebook.js:521「〈11|フィジカル〉」
  var MAUSOLEUM_FAIL_HP_DAMAGE = 2 * BLOCK_SQUARE_COUNT_TO_RESOURCE_MULT; // 「HP損害：□□」，□換算率沿用既有BLOCK_SQUARE_COUNT_TO_RESOURCE_MULT（見computeMidnightSkillCost()同款換算）

  function renderWalkingMausoleumBranch(pt, trig) {
    var banner = el("midnight-random-event-banner");
    banner.hidden = false;
    el("midnight-random-event-choice-a").hidden = true;
    el("midnight-random-event-choice-b").hidden = true;
    el("midnight-random-event-text").textContent = window.I18N.t("midnight_random_event_mausoleum_desc");
    var attempted = !!(trig.attempted && trig.attempted[mySlot]);
    el("midnight-random-event-action").hidden = attempted;
    el("midnight-random-event-action").onclick = function () {
      handleMausoleumCheckClick(pt);
    };
    if (!attempted) el("midnight-random-event-result").textContent = "";
  }

  function handleMausoleumCheckClick(pt) {
    if (!mySlot || isPaused() || isSelfDowned()) return;
    var trig = fieldTriggers[pt.id];
    if (trig && trig.attempted && trig.attempted[mySlot]) return;
    GameStorage.rtSet(gameId, "cloud", "fieldTrigger/" + pt.id + "/attempted/" + mySlot, true);
    var c = characters[myTokenId];
    var diceCount = effectiveCheckDiceCount(c, "physical");
    var sum = 0;
    for (var i = 0; i < diceCount; i++) sum += 1 + Math.floor(Math.random() * 6);
    var success = checkSucceeded(c, sum, MAUSOLEUM_CHECK_TARGET);
    if (!success) spendSelfHp(MAUSOLEUM_FAIL_HP_DAMAGE);
    // event_rulebook.js:529/538「自身が所持している武器の中から任意の1つ」與同じ物1つ
    // を獲得——規則原文是玩家自行挑選要複製哪一把，但目前codebase沒有「挑選某個武器
    // instance」這種選擇的既有UI/欄位（跟RELIC_CHOICE_CONFIG_BY_NAME那種挑「屬性/異常/
    // 武器種類」的既有選擇機制量級不同），為了不另外發明第三套選擇架構（CLAUDE.md
    // §11/§36），這裡簡化成從自身持有武器中隨機挑1把複製一份（成功／失敗皆會獲得，
    // 只差在失敗多了HP損害）。
    if (c && c.weaponIds && c.weaponIds.length) {
      if (hasInventorySpace(c, "weapon")) {
        var pickedId = c.weaponIds[Math.floor(Math.random() * c.weaponIds.length)];
        c.weaponIds.push(pickedId);
        GameStorage.rtSet(gameId, "cloud", "character/" + myTokenId, c);
      } else {
        showToast(window.I18N.t("midnight_inventory_full_note"));
      }
    }
    el("midnight-random-event-result").textContent = window.I18N.t(
      success ? "midnight_random_event_success_note" : "midnight_random_event_fail_note",
      { sum: sum, target: MAUSOLEUM_CHECK_TARGET }
    );
  }

  // ---- 夜の勢力分支（event_rulebook.js:545-593）----
  // 「夜の勢力決定表」（event_rulebook.js:583-590）。1D＝2那一列規則書原文寫的是
  // 「著大犬」，跟event_rulebook.js:585逐字一致——實際核對enemies_data_1~4.js後確認
  // enemies_data_3.js:1936真正存在的敵人名稱就是「著大犬」（很可能是「巨大犬」的原始
  // 誤植，但enemies_data_*.js的結構化資料本身就是照著這個「誤植」轉錄的），因此這裡使用
  // 「著大犬」（跟資料庫實際存在的名稱一致，才能被resolveCombatEnemyMatch()正確比對到），
  // 不是看起來比較「正常」但資料庫裡其實不存在的「巨大犬」。其餘5列名稱皆已逐一grep
  // enemies_data_1~4.js確認存在且拼字完全一致。
  var NIGHT_FORCE_TABLE = [
    { faces: [1], nameJa: "ユビムシたち", level: 6, rounds: 3 },
    { faces: [2], nameJa: "著大犬", level: 6, rounds: 3 },
    { faces: [3], nameJa: "幽鬼の従者たち", level: 6, rounds: 2 },
    { faces: [4], nameJa: "丘陵の飛竜", level: 5, rounds: 2 },
    { faces: [5], nameJa: "ガーディアン・ゴーレム", level: 5, rounds: 2 },
    { faces: [6], nameJa: "狂い火トロル", level: 3, rounds: 3 },
  ];
  var nightForceEnemyAssignAttempted = {}; // pointId -> true（本地節流：敵人指派只送一次transaction，同meteorEnemyAssignAttempted）
  var nightForceRoundAdvanceAttempted = {}; // pointId -> 上次已處理過的completedRounds值，避免同一輪HP=0重複觸發

  // 夜の勢力的敵人資訊/進入戰鬥/傷害流程完全重用既有的strong_enemy共用機制——
  // encounterEnemyPoint()已經把「trig.enemyFamilyId存在的random_event點」視為跟
  // nearbyStrongEnemy同等的戰鬥目標（見上方說明），renderStrongEnemyOverlay()／
  // handleStrongEnemyEnterClick()／recomputeActiveEncounter()都會自動接手顯示敵人資訊、
  // 進入戰鬥讀條、HP條與攻擊/戰技傷害計算，這裡只需要負責「決定敵人」與「n連戦進度」
  // 本身，不重複實作一套敵人資訊UI。
  function renderNightForceBranch(pt, trig) {
    var banner = el("midnight-random-event-banner");
    banner.hidden = false;
    el("midnight-random-event-choice-a").hidden = true;
    el("midnight-random-event-choice-b").hidden = true;
    el("midnight-random-event-action").hidden = true;
    el("midnight-random-event-result").textContent = "";
    if (!trig.enemyFamilyId) {
      el("midnight-random-event-text").textContent = window.I18N.t("midnight_random_event_night_force_desc");
      rollAndAssignNightForceEnemy(pt);
      return;
    }
    el("midnight-random-event-text").textContent = window.I18N.t("midnight_random_event_night_force_progress_note", {
      completed: trig.completedRounds || 0,
      required: trig.requiredRounds || 0,
    });
  }

  function rollAndAssignNightForceEnemy(pt) {
    if (nightForceEnemyAssignAttempted[pt.id] || (fieldTriggers[pt.id] && fieldTriggers[pt.id].enemyFamilyId)) return;
    nightForceEnemyAssignAttempted[pt.id] = true;
    var roll = 1 + Math.floor(Math.random() * 6);
    var row = NIGHT_FORCE_TABLE.filter(function (r) {
      return r.faces.indexOf(roll) !== -1;
    })[0];
    if (!row) return;
    var GmFlow = window.PriTestNightGmFlow;
    var match = GmFlow && GmFlow.resolveCombatEnemyMatch(row.nameJa);
    if (!match) return; // 找不到就整體放棄，不硬湊（同rollAndAssignStrongEnemy()/renderMeteorBranch()既有精神）
    // review指摘修正（fix round）：改為對整個fieldTrigger/pt.id物件做單一atomic transaction
    // （同上方maybeAssignFieldEnemy()判定分支既有的手動合成手法），而不是enemyFamilyId／
    // enemyId／level／requiredRounds各自獨立4次transaction——多裝置同時各自roll到
    // NIGHT_FORCE_TABLE不同列時，各自的4個獨立transaction可能交錯寫入同一個trigger，
    // 拼出「enemyId來自裝置A、level卻來自裝置B」的不一致組合，進而汙染
    // enemyRealHpMax()的等級對照與敵人比對本身。這裡的fieldTrigger在呼叫此函式之前，
    // 已經由random event chip解決流程建立好{status,branchNameJa,participants,resolvedAt}
    // （見上方分派表建立處），因此用for-in手動合成既有欄位、只新增4個敵人欄位，而不是
    // 整包覆寫（跟rollAndAssignStrongEnemy()從null建立全新物件的情境不同，但「單一
    // transaction對整個trigger物件」的atomic精神完全一致）。
    GameStorage.rtTransaction(gameId, "cloud", "fieldTrigger/" + pt.id, function (cur) {
      if (cur && cur.enemyFamilyId) return cur; // 已有裝置搶先指派過，整個既有物件原封不動送回
      var out = {};
      for (var k in cur) out[k] = cur[k]; // ES5：不用Object.assign，手動合成（同maybeAssignFieldEnemy()既有寫法）
      out.enemyFamilyId = match.familyId;
      out.enemyId = match.enemy.id;
      out.level = row.level;
      out.requiredRounds = row.rounds;
      return out;
    }).then(function () {
      GameStorage.rtTransaction(gameId, "cloud", "fieldEnemyHp/" + pt.id, function (cur) {
        return cur === null ? enemyRealHpMax({ enemyFamilyId: match.familyId, enemyId: match.enemy.id, level: row.level }) : cur;
      });
    });
  }

  // 每次偵掃描一次（掛在跟maybeGrantMeteorReward()同一個呼叫點，見updateNearbyChipPoint()）：
  // 偵測目前敵人HP是否已歸零，若是則判斷「這是不是最後一輪」——不是就補血讓戰鬥無縫接
  // 下一輪（event_rulebook.js:570「それぞれの戦闘の間にはインターバルがない」；受限於
  // RTDB非同步延遲，實務上仍可能有短暫一格的「戰鬥結束」畫面閃爍，這是既有架構限制，
  // 跟maybeGrantMeteorReward()/maybeGrantStrongEnemyReward()面對同一種HP=0偵測延遲問題），
  // 是最後一輪則發放最終獎勵。
  function maybeAdvanceNightForceRound(pt) {
    var trig = fieldTriggers[pt.id];
    if (!trig || trig.branchNameJa !== "夜の勢力" || !trig.enemyFamilyId) return;
    var hp = fieldEnemyHp[pt.id];
    if (hp === undefined || hp > 0) return;
    var completedSoFar = trig.completedRounds || 0;
    if (nightForceRoundAdvanceAttempted[pt.id] === completedSoFar) return; // 這一輪已經處理過
    nightForceRoundAdvanceAttempted[pt.id] = completedSoFar;
    var nextCompleted = completedSoFar + 1;
    var requiredRounds = trig.requiredRounds || 1;
    if (nextCompleted >= requiredRounds) {
      GameStorage.rtTransaction(gameId, "cloud", "fieldTrigger/" + pt.id + "/completedRounds", function (cur) {
        return cur === null || cur < requiredRounds ? nextCompleted : cur;
      }).then(function (committed) {
        if (committed !== nextCompleted) return; // 被別的裝置搶先處理過這一輪
        // event_rulebook.js:563「ボス戦闘（撃破ルーン：7）」＋:579「潜在する力：★★」——
        // 兩者是同一個「n回戦闘結束時」時機點的獎勵，都走pushPendingReward()（同
        // maybeGrantMeteorReward()的理由：potentialPower只有pendingRewards抽選清單流程
        // 認得，見renderPotentialPowerRewardDetail()）。
        Object.keys(trig.participants || {}).forEach(function (slot) {
          var p = players[slot];
          if (!p) return;
          pushPendingReward(p.tokenId, { kind: "rune", value: 7 });
          pushPendingReward(p.tokenId, { kind: "potentialPower", value: 2 });
          // event_rulebook.js:579「PC全員のアーツの使用回数が回復し...」＋「夜の恩寵」：
          // midnight改用時間冷卻（不是使用次數）追蹤技藝/技能，「アーツの使用回数が回復」
          // 對應到讓技能冷卻立即歸零（_skillCooldownUntil，跟resetAbilityCooldowns()換日
          // 重置時使用的欄位/寫法完全一致，只是這裡是對participants每個人各自的tokenId
          // 寫入，不是只清自己）。「夜の恩寵」是設計文件§9-1定義的持久旗標
          // （_nightBlessing），目前handleBlessingUseClick()/useCharacterAbility()尚未有
          // 任何讀取這個旗標的判斷分支（沒有「跳過60秒冷卻改用祝福休息回復」的既有掛勾
          // 點），因此這裡先只寫入旗標本身，不額外發明一套新的冷卻豁免機制——之後若要
          // 真正讓「夜の恩寵」角色的技能改成靠祝福回復，應該在useCharacterAbility()/
          // handleBlessingUseClick()那邊接上判斷，不在這裡多做。
          GameStorage.rtSet(gameId, "cloud", "character/" + p.tokenId + "/_skillCooldownUntil", 0);
          GameStorage.rtSet(gameId, "cloud", "character/" + p.tokenId + "/_nightBlessing", true);
        });
      });
    } else {
      GameStorage.rtTransaction(gameId, "cloud", "fieldTrigger/" + pt.id + "/completedRounds", function (cur) {
        return cur === null || cur < nextCompleted ? nextCompleted : cur;
      }).then(function (committed) {
        if (committed !== nextCompleted) return; // 被別的裝置搶先處理過這一輪
        GameStorage.rtSet(
          gameId,
          "cloud",
          "fieldEnemyHp/" + pt.id,
          enemyRealHpMax({ enemyFamilyId: trig.enemyFamilyId, enemyId: trig.enemyId, level: trig.level })
        );
      });
    }
  }

  // ---- 虫の大量発生分支（event_rulebook.js:595-676）----
  // 判定數值/流程資料統一讀window.PriTestMidnightRandomEvents.insectSwarmSteps
  // （midnight_random_events.js，Task 19/20已核對過event_rulebook.js逐字轉錄），不在這裡
  // 重複定義同一批規則數值。
  var insectBountySelfApplied = {}; // pointId -> true（本地節流：討伐ボーナス的個人套用只做一次，見下方render函式尾端）
  var insectGroundStageAdvanceAttempted = {}; // pointId -> true（本地節流：review指摘修正，避免render tick逐frame重送transaction，同nightForceEnemyAssignAttempted既有idiom）
  var insectChaseStageAdvanceAttempted = {}; // pointId -> true（同上，追蟲階段版本）

  function renderInsectSwarmBranch(pt, trig) {
    var steps = window.PriTestMidnightRandomEvents.insectSwarmSteps;
    var banner = el("midnight-random-event-banner");
    banner.hidden = false;
    el("midnight-random-event-choice-a").hidden = true;
    el("midnight-random-event-choice-b").hidden = true;
    if (!trig.groundBugsOutcome) {
      el("midnight-random-event-text").textContent = window.I18N.t("midnight_random_event_insect_ground_desc");
      var groundAttempted = !!(trig.attempted && trig.attempted[mySlot]);
      el("midnight-random-event-action").hidden = groundAttempted;
      el("midnight-random-event-action").onclick = function () {
        handleInsectGroundCheckClick(pt);
      };
      if (!groundAttempted) el("midnight-random-event-result").textContent = "";
      maybeAdvanceInsectGroundStage(pt, trig);
      return;
    }
    if (!trig.chaseOutcome) {
      el("midnight-random-event-text").textContent = window.I18N.t("midnight_random_event_insect_chase_desc");
      el("midnight-random-event-action").hidden = true;
      var chaseAttempted = !!(trig.chaseAttempted && trig.chaseAttempted[mySlot]);
      el("midnight-random-event-choice-a").hidden = chaseAttempted;
      el("midnight-random-event-choice-a").textContent = window.I18N.t("midnight_random_event_insect_chase_physical_button");
      el("midnight-random-event-choice-a").onclick = function () {
        handleInsectChaseCheckClick(pt, "physical", steps.chaseBug.checkTarget);
      };
      el("midnight-random-event-choice-b").hidden = chaseAttempted;
      el("midnight-random-event-choice-b").textContent = window.I18N.t("midnight_random_event_insect_chase_mental_button");
      el("midnight-random-event-choice-b").onclick = function () {
        handleInsectChaseCheckClick(pt, "mental", steps.chaseBug.checkTarget);
      };
      if (!chaseAttempted) el("midnight-random-event-result").textContent = "";
      maybeAdvanceInsectChaseStage(pt, trig);
      return;
    }
    el("midnight-random-event-action").hidden = true;
    el("midnight-random-event-result").textContent = "";
    el("midnight-random-event-text").textContent = window.I18N.t(
      trig.chaseOutcome === "success" ? "midnight_random_event_insect_bounty_note" : "midnight_random_event_insect_fail_note"
    );
    // 討伐ボーナス（event_rulebook.js:658-660）：由每台裝置各自在自己畫面上偵測到
    // chaseOutcome==="success"時各自套用一次（不是由某一台裝置迴圈trig.participants
    // 逐一授予——這幾個分支的trig.participants本來就是空的，見correction #5同一個道理：
    // 「地面の蟲たち」失敗損失的盧恩是記在自己角色物件的_insectSwarmLostRunes欄位，只有
    // 自己的裝置能讀到並退還給自己）。
    if (trig.chaseOutcome === "success" && !insectBountySelfApplied[pt.id]) {
      insectBountySelfApplied[pt.id] = true;
      var c = characters[myTokenId];
      if (c) {
        c.runes = (c.runes || 0) + (steps.bounty.runeReward || 0);
        if (c._insectSwarmLostRunes) {
          c.runes += c._insectSwarmLostRunes;
          c._insectSwarmLostRunes = 0;
        }
        // 恩寵「知の集約」（event_rulebook.js:668-669）：跟_nightBlessing同一種「先寫入
        // 持久旗標」的第一步做法（設計文件§9-1精神）——「戦闘終了時PC代表1人が1Dを振る」
        // 這個觸發時機目前沒有既有掛勾點（不是本task範圍，見correction #3對_nightBlessing
        // 的同一套判斷），因此這裡不額外發明新的戰鬥結束擲骰機制，只保留旗標供之後接上。
        c._insectKnowledgeBlessing = true;
        GameStorage.rtSet(gameId, "cloud", "character/" + myTokenId, c);
      }
    }
  }

  function handleInsectGroundCheckClick(pt) {
    if (!mySlot || isPaused() || isSelfDowned()) return;
    var trig = fieldTriggers[pt.id];
    if (trig && trig.attempted && trig.attempted[mySlot]) return;
    var steps = window.PriTestMidnightRandomEvents.insectSwarmSteps.groundBugs;
    GameStorage.rtSet(gameId, "cloud", "fieldTrigger/" + pt.id + "/attempted/" + mySlot, true);
    var c = characters[myTokenId];
    var diceCount = effectiveCheckDiceCount(c, steps.statKey);
    var sum = 0;
    for (var i = 0; i < diceCount; i++) sum += 1 + Math.floor(Math.random() * 6);
    if (!checkSucceeded(c, sum, steps.checkTarget) && c) {
      var lost = Math.min(c.runes || 0, steps.failRuneLoss);
      c.runes = (c.runes || 0) - lost;
      c._insectSwarmLostRunes = (c._insectSwarmLostRunes || 0) + lost;
      GameStorage.rtSet(gameId, "cloud", "character/" + myTokenId, c);
    }
  }

  // 全員（目前入座的席位）都嘗試過地面蟲判定後，無論成敗都前進到下一步
  // （event_rulebook.js:617「成否を問わず...へ移る」）。放在render tick持續檢查（而不是
  // 只在點擊當下檢查一次），才不會因為RTDB訂閱延遲讓「最後一個人剛好在自己畫面上看到
  // 別人尚未同步到的attempted」而卡住不觸發（同maybeGrantMeteorReward()等既有做法，
  // transaction本身冪等，重複呼叫無副作用）。
  function maybeAdvanceInsectGroundStage(pt, trig) {
    if (insectGroundStageAdvanceAttempted[pt.id]) return; // review指摘修正：已送過一次transaction，等RTDB回顯前不重送
    var seatedSlots = currentlySeatedSlots();
    var attemptedMap = trig.attempted || {};
    var allAttempted = seatedSlots.length > 0 && seatedSlots.every(function (slot) {
      return !!attemptedMap[slot];
    });
    if (!allAttempted) return;
    insectGroundStageAdvanceAttempted[pt.id] = true; // 送出transaction前先設旗標，同maybeAdvanceNightForceRound()既有idiom
    GameStorage.rtTransaction(gameId, "cloud", "fieldTrigger/" + pt.id + "/groundBugsOutcome", function (cur) {
      return cur ? cur : "done";
    });
  }

  function handleInsectChaseCheckClick(pt, statKey, checkTarget) {
    if (!mySlot || isPaused() || isSelfDowned()) return;
    var trig = fieldTriggers[pt.id];
    if (trig && trig.chaseAttempted && trig.chaseAttempted[mySlot]) return;
    // event_rulebook.js:637「HP損害：□」を受けて〈フィジカル〉、或「FP損害：□」を受けて
    // 〈メンタル〉——各1個□，換算率沿用既有BLOCK_SQUARE_COUNT_TO_RESOURCE_MULT。
    if (statKey === "physical") spendSelfHp(BLOCK_SQUARE_COUNT_TO_RESOURCE_MULT);
    else spendFp(BLOCK_SQUARE_COUNT_TO_RESOURCE_MULT); // spendFp()已有「不足時回傳false、不扣」的既有防呆
    var c = characters[myTokenId];
    var diceCount = effectiveCheckDiceCount(c, statKey);
    var sum = 0;
    for (var i = 0; i < diceCount; i++) sum += 1 + Math.floor(Math.random() * 6);
    var success = checkSucceeded(c, sum, checkTarget);
    GameStorage.rtSet(gameId, "cloud", "fieldTrigger/" + pt.id + "/chaseAttempted/" + mySlot, true);
    GameStorage.rtSet(gameId, "cloud", "fieldTrigger/" + pt.id + "/chaseResults/" + mySlot, success);
  }

  // 全員都嘗試過追蟲判定後，依「PCの半数以上が成功すれば」（event_rulebook.js:645）比對
  // 多數決，寫入chaseOutcome。同maybeAdvanceInsectGroundStage()，放在render tick持續檢查。
  function maybeAdvanceInsectChaseStage(pt, trig) {
    if (insectChaseStageAdvanceAttempted[pt.id]) return; // review指摘修正：已送過一次transaction，等RTDB回顯前不重送
    var seatedSlots = currentlySeatedSlots();
    var attemptedMap = trig.chaseAttempted || {};
    var allAttempted = seatedSlots.length > 0 && seatedSlots.every(function (slot) {
      return !!attemptedMap[slot];
    });
    if (!allAttempted) return;
    insectChaseStageAdvanceAttempted[pt.id] = true; // 送出transaction前先設旗標，同maybeAdvanceNightForceRound()既有idiom
    var results = trig.chaseResults || {};
    var successCount = 0;
    seatedSlots.forEach(function (slot) {
      if (results[slot]) successCount++;
    });
    var outcome = successCount * 2 >= seatedSlots.length ? "success" : "fail";
    GameStorage.rtTransaction(gameId, "cloud", "fieldTrigger/" + pt.id + "/chaseOutcome", function (cur) {
      return cur ? cur : outcome;
    });
  }

  // ---- 発狂地帯分支（event_rulebook.js:678-768）----
  // 判定數值/流程資料統一讀window.PriTestMidnightRandomEvents.madnessZoneSteps
  // （madFire1／tower2／tower3三段的checkTarget/statKey/successMadness/failMadness/
  // checks，Task 19/20已核對過event_rulebook.js逐字轉錄），不在這裡重複定義同一批數值。
  // 唯一例外：event_rulebook.js:709「すぐにでもここで離れてもいい（突破判定が必要...）」
  // 這裡的「突破判定」，逐字核對後確認就是引用同分支頂層event_rulebook.js:685
  // 「〈協力11×PC人数|メンタル〉」這個公式（madnessZoneSteps沒有另外收錄這組數值，因為
  // 它屬於頂層突破判定欄位，不是巢狀行為判定），這裡直接沿用同一份公式，不是自行發明。
  var MADNESS_TOWER1_LEAVE_CHECK_TARGET_PER_PC = 11; // event_rulebook.js:685
  var MADNESS_TOWER1_LEAVE_STAT_KEY = "mental";
  var madnessTower3LocalApplied = {}; // pointId -> true（本地節流：塔3個人發狂蓄積/潛力獎勵只套用一次，見correction #5）
  // pointId+"|"+stage -> true（本地節流：review指摘修正，避免render tick逐frame重送transaction）。
  // 用複合key（而非單純pointId）是因為塔1「離開」失敗後會把madnessStage退回"madFire"並清空
  // attempted/tower2Attempted（見handleMadnessTower1LeaveClick()），讓玩家重新再挑戰一輪——
  // 若只用pointId當旗標會在第一輪送出後永久卡死、不再送出第二輪的推進transaction，因此
  // 下方maybeAdvanceMadnessStage()在偵測到attemptedMap被清空（keys數為0）時會主動重置該
  // stage的旗標，讓下一輪仍能正常推進（不同insectGround/insectChase兩個一次性、不會重來
  // 的階段，那兩個仍用單純的pointId布林旗標即可）。
  var madnessStageAdvanceAttempted = {};

  function renderMadnessZoneBranch(pt, trig) {
    var steps = window.PriTestMidnightRandomEvents.madnessZoneSteps;
    var banner = el("midnight-random-event-banner");
    banner.hidden = false;
    el("midnight-random-event-choice-a").hidden = true;
    el("midnight-random-event-choice-b").hidden = true;
    el("midnight-random-event-action").hidden = true;
    el("midnight-random-event-result").textContent = "";
    var stage = trig.madnessStage || "madFire";
    if (stage === "madFire") {
      el("midnight-random-event-text").textContent = window.I18N.t("midnight_random_event_madness_fire_desc");
      var attempted = !!(trig.attempted && trig.attempted[mySlot]);
      el("midnight-random-event-action").hidden = attempted;
      el("midnight-random-event-action").onclick = function () {
        handleMadnessCheckClick(pt, "madFire", steps.madFire1);
      };
      maybeAdvanceMadnessStage(pt, trig, "madFire", "attempted", "tower1");
    } else if (stage === "tower1") {
      el("midnight-random-event-text").textContent = window.I18N.t("midnight_random_event_madness_tower1_desc");
      el("midnight-random-event-choice-a").hidden = false;
      el("midnight-random-event-choice-a").textContent = window.I18N.t("midnight_random_event_madness_leave_button");
      el("midnight-random-event-choice-a").onclick = function () {
        handleMadnessTower1LeaveClick(pt);
      };
      el("midnight-random-event-choice-b").hidden = false;
      el("midnight-random-event-choice-b").textContent = window.I18N.t("midnight_random_event_madness_explore_button");
      el("midnight-random-event-choice-b").onclick = function () {
        GameStorage.rtTransaction(gameId, "cloud", "fieldTrigger/" + pt.id + "/madnessStage", function (cur) {
          return cur === "tower1" ? "tower2" : cur;
        });
      };
    } else if (stage === "tower2") {
      el("midnight-random-event-text").textContent = window.I18N.t("midnight_random_event_madness_tower2_desc");
      var attempted2 = !!(trig.tower2Attempted && trig.tower2Attempted[mySlot]);
      el("midnight-random-event-action").hidden = attempted2;
      el("midnight-random-event-action").onclick = function () {
        handleMadnessCheckClick(pt, "tower2", steps.tower2);
      };
      maybeAdvanceMadnessStage(pt, trig, "tower2", "tower2Attempted", "tower3");
    } else if (stage === "tower3") {
      el("midnight-random-event-text").textContent = window.I18N.t("midnight_random_event_madness_tower3_desc");
      el("midnight-random-event-action").hidden = !!trig.tower3Outcome;
      el("midnight-random-event-action").onclick = function () {
        handleMadnessTower3Click(pt);
      };
    } else {
      var doneKey = !trig.tower3Outcome
        ? "midnight_random_event_madness_done_note"
        : trig.tower3Outcome === "success2plus"
        ? "midnight_random_event_madness_success2_note"
        : trig.tower3Outcome === "success1"
        ? "midnight_random_event_madness_success1_note"
        : "midnight_random_event_madness_allfail_note";
      el("midnight-random-event-text").textContent = window.I18N.t(doneKey);
    }
    // 塔3個人蓄積/獎勵：跟虫の大量発生的討伐ボーナス同一種設計（correction #5）——每台
    // 裝置各自在自己畫面上偵測到tower3Outcome才第一次套用，發狂蓄積只影響本地端自己
    // （recordReceivedAttributeAccum()本來就是module-scope local變數，不吃tokenId）。
    if (trig.tower3Outcome && !madnessTower3LocalApplied[pt.id]) {
      madnessTower3LocalApplied[pt.id] = true;
      var madnessDiceCount = trig.tower3Outcome === "success2plus" ? 2 : 3; // success2plus:発狂2D／success1・allFail:発狂3D
      var madnessSum = 0;
      for (var i = 0; i < madnessDiceCount; i++) madnessSum += 1 + Math.floor(Math.random() * 6);
      recordReceivedAttributeAccum("発狂", madnessSum);
      if (trig.tower3Outcome !== "allFail") {
        // event_rulebook.js:746/755「潜在する力：★★」を2個——potentialPower只有
        // pendingRewards抽選清單流程認得，走pushPendingReward()（同maybeGrantMeteorReward()
        // 既有理由）。
        pushPendingReward(myTokenId, { kind: "potentialPower", value: 2 });
      }
      // allFail（event_rulebook.js:764）：「タイムロス:1」midnight沒有對應資源，依既有
      // 簡化原則不套用（同§5全踏破效果的既有處理，見handleMadnessTower3Click()附近註解）。
    }
  }

  // madFire／tower2共用：〈checkTarget|任意の判定値〉——玩家可自由選擇任一判定值，目前
  // codebase沒有對應的選擇UI（不像女神像/埋もれ宝等固定用單一判定值），簡化為取自身
  // luck/physical/mental三者最高值（等同玩家會選的最佳判定，比固定優先順序取值更合理）。
  // 成功/失敗後的発狂蓄積骰數(2D/3D)加總即為
  // recordReceivedAttributeAccum()的amount參數（不是骰子顆數本身，見correction #5）。
  function handleMadnessCheckClick(pt, stage, stepConfig) {
    if (!mySlot || isPaused() || isSelfDowned()) return;
    var attemptField = stage === "madFire" ? "attempted" : "tower2Attempted";
    var trig = fieldTriggers[pt.id];
    if (trig && trig[attemptField] && trig[attemptField][mySlot]) return;
    GameStorage.rtSet(gameId, "cloud", "fieldTrigger/" + pt.id + "/" + attemptField + "/" + mySlot, true);
    var c = characters[myTokenId];
    var diceCount = Math.max(effectiveCheckDiceCount(c, "physical"), effectiveCheckDiceCount(c, "mental"), effectiveCheckDiceCount(c, "luck"));
    var sum = 0;
    for (var i = 0; i < diceCount; i++) sum += 1 + Math.floor(Math.random() * 6);
    var success = checkSucceeded(c, sum, stepConfig.checkTarget);
    var madnessDiceCount = success ? 2 : 3;
    var madnessSum = 0;
    for (var j = 0; j < madnessDiceCount; j++) madnessSum += 1 + Math.floor(Math.random() * 6);
    recordReceivedAttributeAccum("発狂", madnessSum);
  }

  // madFire／tower2皆為「全員都嘗試過才前進」（event_rulebook.js:699/727「成否に関わらず
  // 次へ進む」），跟maybeAdvanceInsectGroundStage()同一種render tick持續檢查寫法。
  function maybeAdvanceMadnessStage(pt, trig, stage, attemptField, nextStage) {
    var key = pt.id + "|" + stage;
    var attemptedMap = trig[attemptField] || {};
    if (Object.keys(attemptedMap).length === 0) {
      // attempted被清空（塔1離開失敗、回到madFire重來一輪，見上方欄位註解）：重置旗標，
      // 讓下一輪全員判定完成時仍能送出推進transaction。
      madnessStageAdvanceAttempted[key] = false;
      return;
    }
    if (madnessStageAdvanceAttempted[key]) return; // review指摘修正：已送過一次transaction，等RTDB回顯前不重送
    var seatedSlots = currentlySeatedSlots();
    var allAttempted = seatedSlots.length > 0 && seatedSlots.every(function (slot) {
      return !!attemptedMap[slot];
    });
    if (!allAttempted) return;
    madnessStageAdvanceAttempted[key] = true; // 送出transaction前先設旗標，同maybeAdvanceNightForceRound()既有idiom
    GameStorage.rtTransaction(gameId, "cloud", "fieldTrigger/" + pt.id + "/madnessStage", function (cur) {
      return cur === stage ? nextStage : cur;
    });
  }

  // 塔1「離開」：event_rulebook.js:709「突破判定が必要」引用頂層event_rulebook.js:685
  // 〈協力11×PC人数|メンタル〉這組協力判定（不是brief原本猜測的個人〈12|任意の判定値〉——
  // 逐字核對後這裡才是規則書真正指定的判定，見上方MADNESS_TOWER1_LEAVE_CHECK_TARGET_PER_PC
  // 註解）。成功→事件結束；失敗→除一般失敗效果外回到「狂い火」（madnessStage設回
  // "madFire"、清空attempted讓全員重新嘗試，同時清空tower2Attempted讓下一輪的塔2判定
  // 也重新來過）。
  function handleMadnessTower1LeaveClick(pt) {
    if (!mySlot || isPaused() || isSelfDowned()) return;
    var trig = fieldTriggers[pt.id];
    if (!trig || trig.madnessStage !== "tower1") return;
    var seatedSlots = currentlySeatedSlots();
    var participantsMap = {};
    seatedSlots.forEach(function (slot) {
      participantsMap[slot] = true;
    });
    var target = MADNESS_TOWER1_LEAVE_CHECK_TARGET_PER_PC * seatedSlots.length;
    var sum = teamCheckSum({ participants: participantsMap }, MADNESS_TOWER1_LEAVE_STAT_KEY);
    var success = sum >= target;
    GameStorage.rtTransaction(gameId, "cloud", "fieldTrigger/" + pt.id + "/madnessStage", function (cur) {
      return cur === "tower1" ? (success ? "ended" : "madFire") : cur;
    });
    if (!success) {
      GameStorage.rtSet(gameId, "cloud", "fieldTrigger/" + pt.id + "/attempted", null);
      GameStorage.rtSet(gameId, "cloud", "fieldTrigger/" + pt.id + "/tower2Attempted", null);
    }
    el("midnight-random-event-result").textContent = window.I18N.t(
      success ? "midnight_random_event_success_note" : "midnight_random_event_fail_note",
      { sum: sum, target: target }
    );
  }

  // 塔3（event_rulebook.js:737）：依序做3次協力判定(運試し/體能/精神，各11×PC人數)，
  // 記錄成功次數決定outcome，寫入tower3Outcome共享事實。個人層級的発狂蓄積/潛力獎勵
  // 改由renderMadnessZoneBranch()每台裝置各自偵測套用（見上方correction #5），這裡只
  // 負責寫入共享的判定結果本身。
  function handleMadnessTower3Click(pt) {
    if (!mySlot || isPaused() || isSelfDowned()) return;
    var trig = fieldTriggers[pt.id];
    if (!trig || trig.tower3Outcome) return;
    var steps = window.PriTestMidnightRandomEvents.madnessZoneSteps.tower3;
    var seatedSlots = currentlySeatedSlots();
    var participantsMap = {};
    seatedSlots.forEach(function (slot) {
      participantsMap[slot] = true;
    });
    var wrapped = { participants: participantsMap };
    var successCount = 0;
    (steps.checks || []).forEach(function (check) {
      var target = check.target * seatedSlots.length;
      if (teamCheckSum(wrapped, check.stat) >= target) successCount++;
    });
    var outcome = successCount >= 2 ? "success2plus" : successCount === 1 ? "success1" : "allFail";
    GameStorage.rtTransaction(gameId, "cloud", "fieldTrigger/" + pt.id, function (cur) {
      if (!cur || cur.tower3Outcome) return cur;
      var out = {};
      for (var k in cur) out[k] = cur[k];
      out.tower3Outcome = outcome;
      out.madnessStage = "ended";
      return out;
    });
  }

  // ---- 板塊(卡牌)獎勵——開啟並執行：讀該floor.reward，用night_floor_breakthrough.js
  // 既有isLootRewardEntry()篩出戰利品entry（純函式，不依賴night.js的Core.state），
  // 逐筆推進pendingRewards佇列，統一由玩家自己開獎勵清單抽選/確認取得（2026-09-09改版，
  // 設計文件§4.3）。原本這裡的grantLootRewardEntryToCharacter()直接授予+toast路徑已無
  // 呼叫端，整個移除，各kind的實際套用邏輯搬到computeRewardDraw()。----

  // 背包已滿的提示改由renderRewardDetail()既有的hasInventorySpace()判斷在玩家實際按
  // 「確認」那一刻擋下並提示（2026-09-09改版），不在推進pendingRewards時預判。
  function grantTileLootToParticipants(trig, lootEntries) {
    Object.keys(trig.participants || {}).forEach(function (slot) {
      var p = players[slot];
      if (!p) return;
      lootEntries.forEach(function (entry) {
        pushPendingReward(p.tokenId, entry);
      });
    });
  }

  var fieldTileRewardAttempted = {}; // pointId -> true（本地節流：板塊獎勵只送一次transaction）

  // perPerson判斷（設計文件§1.5，2026-09-10依使用者明確指正改版）：
  // 舊版是「未標記＝每人各自一份」，而當時fields_data_*.js的138筆標記全部是true、其餘
  // 未標記，等於所有樓層獎勵都按人數發放。使用者明確指正：「實際的規則書並不是每筆都
  // perPerson。規則寫『每人各獲得』就是perPerson；『消耗品獲得2個』就是false，三個人
  // 總共只拿兩份」。因此改成：
  //   ①資料本體有明確的true/false就依資料（已依規則書原文逐筆稽核修正，見
  //     docs/midnight_reward_share_rules.md與tools/midnight_check/reward_perperson_check.js）。
  //   ②沒有標記時依kind的既定值——盧恩／聖杯瓶格數是night.js既有分類
  //     TURN_REWARD_ALL_TARGET_KINDS的「全體一律付與」，潛在之力／附帶效果的規則書原文
  //     幾乎全部寫「PCはそれぞれ〜を獲得」，這四種預設每人一份；其餘實體物品
  //     （武器／消耗品／裝飾品／石劍鑰匙／鍛石／戰技重抽）預設是固定數量的共有物，
  //     進共享池由玩家投票決定歸屬。
  var DEFAULT_PER_PERSON_REWARD_KINDS = ["rune", "chaliceBonus", "potentialPower", "attachedEffect"];

  function isPerPersonRewardEntry(entry) {
    if (entry.perPerson === true) return true;
    if (entry.perPerson === false) return false;
    return DEFAULT_PER_PERSON_REWARD_KINDS.indexOf(entry.kind) !== -1;
  }

  // 落後獎勵ledger（設計文件§1.5）：每次對trig.participants發放perPerson獎勵時，額外記一份
  // 到 fieldProgress/{pointId}/perPlayerRewards/{seq}，供之後才加入、原本不在participants裡
  // 的玩家後補領取。固定共享(perPerson:false)的獎勵不進這裡，見pushSharedReward()。
  // fix：directSlots記錄「這一份entries已經透過grantTileLootToParticipants()/chaliceEntries
  // 迴圈直接授予過的席位」（=呼叫當下的trig.participants）。理由：這一層清掉後
  // maybeClearFieldTriggerAfterRewardGate()會把fieldTrigger整個設為null，讓地圖點能重新
  // 觸發「進入」流程給下一層用——但updateNearbyFieldPoint()判斷「要不要顯示後補領獎按鈕」
  // 的neverJoined0原本只看「當下這個trig0.participants」，trig一旦被清空就等於永遠查不到
  // 「這個人其實已經直接領過了」，導致原本的參與者（尤其是用[加入]而非發起「進入」的人，
  // 從未設過fieldEnterAttempted）在floor推進的那一刻被誤判成「後補」，彈出後補領獎視窗，
  // 按下去等於同一份獎勵重複領取一次（見claimLatePerPlayerRewards()）。把directSlots存進
  // fieldProgress（不會隨fieldTrigger清空而消失），讓eligibility判斷能正確排除這些人。
  function pushPerPlayerReward(pointId, entries, directSlots) {
    var perPersonEntries = entries.filter(isPerPersonRewardEntry);
    if (!perPersonEntries.length) return;
    var seq = "pr" + Date.now() + Math.floor(Math.random() * 100000);
    GameStorage.rtSet(gameId, "cloud", "fieldProgress/" + pointId + "/perPlayerRewards/" + seq, {
      entries: perPersonEntries,
      grantedAt: Date.now(),
      directSlots: directSlots || {},
    });
  }

  // 後補領獎（設計文件§1.5）：後加入者按下[領取獎勵]、等待FIELD_LATE_JOIN_WAIT_MS後呼叫。
  // 只把「目前fieldProgress記錄的perPlayerRewards」中，這個玩家(myTokenId)尚未領過的entries
  // 一次授予，並標記claimedBy防止重複。範圍明確排除祝福/商人（那兩種沒有fieldProgress，
  // 呼叫端本來就不會替它們顯示這個按鈕，見Task 8）。
  function claimLatePerPlayerRewards(pointId) {
    GameStorage.rtTransaction(gameId, "cloud", "fieldProgress/" + pointId + "/claimedBy/" + myTokenId, function (cur) {
      if (cur) return undefined; // 已經領過：中止transaction，不重複授予
      return true;
    }).then(function (committed) {
      if (committed !== true) return; // 這次沒有真正搶到(committed===null，代表已經領過)
      var progress = fieldProgress[pointId] || {};
      var ledger = progress.perPlayerRewards || {};
      // 2026-09-09改版：所有entry統一推進pendingRewards（不再對chaliceBonus以外的kind
      // 走grantLootRewardEntryToCharacter()直接套用+toast），跟grantTileLootToParticipants()
      // /claimLateFieldTriggerRewards()保持一致，見設計文件§4.3。
      Object.keys(ledger).forEach(function (seq) {
        (ledger[seq].entries || []).forEach(function (entry) {
          pushPendingReward(myTokenId, entry);
        });
      });
    });
  }

  // 固定共享池（設計文件§3.2）：perPerson:false的獎勵走這裡，全部participants看到同一份，
  // 任一人按領取用transaction鎖定resolvedBy，first-writer-wins（同既有tileRewardGrantedBy
  // 手法）。
  // 2026-09-10（使用者明確規格「消耗品獲得2個…就會是可能三個人總共拿兩份」）：value是
  // 「個數」語意的kind，固定共享時要拆成N筆各自獨立揭示/投票的項目，玩家才可能一人拿一份；
  // 不拆的話3個人只會有1筆可投票、規則書寫的2個其中1個會憑空消失。
  // 哪些kind的value是「個數」沿用既有定義（見docs/midnight_realtime_combat_numbers.md §12.4／
  // night_floor_breakthrough.js）：consumable／talisman／stoneswordKey／smithingStone／
  // weaponSkillReroll是個數或次數；weaponStar／potentialPower的value是★數（稀有度骰子顆數），
  // 絕對不能拆（拆了會把★2降成兩次★1，night.js曾犯過同一個錯，見同文件§12.4）。
  var SHARED_REWARD_COUNT_KINDS = ["consumable", "talisman", "stoneswordKey", "smithingStone", "weaponSkillReroll"];

  function pushSharedReward(pointId, entry) {
    var isCountKind = SHARED_REWARD_COUNT_KINDS.indexOf(entry.kind) !== -1;
    var copies = isCountKind ? Math.max(1, entry.value || 1) : 1;
    for (var i = 0; i < copies; i++) {
      var rewardId = "srw" + Date.now() + "_" + i + "_" + Math.floor(Math.random() * 100000);
      var withFlag = {};
      for (var k in entry) withFlag[k] = entry[k];
      if (isCountKind) withFlag.value = 1; // 拆開後每一筆都是1個
      withFlag.resolved = false;
      GameStorage.rtSet(gameId, "cloud", "fieldTrigger/" + pointId + "/sharedRewards/" + rewardId, withFlag);
    }
  }

  // 2026-09-08使用者明確規格「樓層的獎勵獲得後 開啟獎勵清單 顯示每一個項目按下後會顯示
  // 抽到甚麼...玩家須投票拿取或不拿取 所有人都投票後抽出拿取人中一人才領取到獎勵」：
  // 取代原本claimSharedReward()的「先搶先贏、按下即刻套用」，改成①按下先「揭示」抽到
  // 什麼（drawn，只計算一次、persist供所有人看到同一結果，不是每人各自重算）②每個
  // trig.participants成員各自投「拿取」／「不拿取」③全員投完後，抽出一位真正拿到獎勵。
  //
  // drawSharedRewardData()只回傳可序列化的抽選結果（weaponId/talismanId/itemId/value），
  // 不是像computeRewardDraw()那樣回傳含閉包的apply()——因為這裡多人會看到同一份揭示結果，
  // 必須存進RTDB，閉包沒辦法序列化。
  function drawSharedRewardData(entry) {
    if (entry.kind === "rune") return { value: entry.value || 0 };
    if (entry.kind === "chaliceBonus") return { value: entry.value || 0 };
    if (entry.kind === "weaponSkillReroll") return { value: entry.value || 1 };
    if (entry.kind === "stoneswordKey" || entry.kind === "smithingStone") return { value: entry.value || 1 };
    if (entry.kind === "weapon" || entry.kind === "weaponStar") {
      // 2026-09-10修正：原本一律走merchantDrawWeapon()（大分類完全隨機），忽略了資料裡
      // 的categoryId（fields_data_*.js有不少「聖印」等指定大分類的武器獎勵）。改成跟
      // computeRewardDraw()同一套判斷，共用CharacterDrawer既有的兩支helper。
      var weaponResult = entry.categoryId
        ? window.PriTestCharacterDrawer.drawWeaponFromCategory({ weaponIds: [] }, entry.categoryId, entry.value || 1)
        : window.PriTestCharacterDrawer.merchantDrawWeapon({ weaponIds: [] }, entry.value || 1);
      return weaponResult ? { weaponId: weaponResult.weaponId } : {};
    }
    if (entry.kind === "talisman") {
      var talismanPool = window.PriTestTalismans.list();
      var pickedTalisman = talismanPool[Math.floor(Math.random() * talismanPool.length)];
      return pickedTalisman ? { talismanId: pickedTalisman.id } : {};
    }
    if (entry.kind === "consumable") {
      if (entry.itemId) return { itemId: entry.itemId };
      var consumablePool = window.PriTestConsumables.list();
      var pickedConsumable = consumablePool[Math.floor(Math.random() * consumablePool.length)];
      return pickedConsumable ? { itemId: pickedConsumable.id } : {};
    }
    return {};
  }

  // 抽選結果的顯示文字：drawn為null（還沒揭示）時退回rewardEntryLabel()既有的種類文字
  // （例如「武器」），揭示後改顯示具體品項名稱（例如「反曲劍」）。
  function sharedRewardDrawLabel(entry, drawn) {
    if (!drawn) return rewardEntryLabel(entry);
    if (entry.kind === "rune") return window.I18N.t("midnight_reward_label_rune", { value: drawn.value || 0 });
    if (entry.kind === "chaliceBonus") return window.I18N.t("midnight_reward_label_chalice_bonus", { value: drawn.value || 0 });
    if (entry.kind === "weaponSkillReroll") return window.I18N.t("midnight_reward_label_weapon_skill_reroll", { value: drawn.value || 1 });
    if ((entry.kind === "weapon" || entry.kind === "weaponStar") && drawn.weaponId) {
      var w = window.PriTestWeapons.get(baseCatalogId(drawn.weaponId));
      return w ? window.PriTestWeapons.localizedText(w.name) : drawn.weaponId;
    }
    if (entry.kind === "talisman" && drawn.talismanId) {
      var t = window.PriTestTalismans.get(drawn.talismanId);
      return t ? window.PriTestTalismans.localizedText(t.name) : drawn.talismanId;
    }
    if (entry.kind === "consumable" && drawn.itemId) {
      var item = window.PriTestConsumables.get(drawn.itemId);
      return item ? window.PriTestConsumables.localizedText(item.name) : drawn.itemId;
    }
    if (entry.kind === "stoneswordKey" || entry.kind === "smithingStone") {
      var fixedItemId = entry.kind === "stoneswordKey" ? "item_stonesword_key" : "item_smithing_stone";
      var fixedItem = window.PriTestConsumables.get(fixedItemId);
      return fixedItem ? window.PriTestConsumables.localizedText(fixedItem.name) : fixedItemId;
    }
    return rewardEntryLabel(entry);
  }

  // 把persist的drawn primitive套用到贏得投票的角色身上——邏輯跟grantLootRewardEntryToCharacter()
  // 對應的分支相同，只是吃已經決定好的drawn資料，不再重新擲骰（重新擲骰會跟大家看到的揭示
  // 結果對不上）。
  function applyDrawnSharedRewardToCharacter(c, entry, drawn) {
    var CD = window.PriTestCharacterDrawer;
    if (entry.kind === "rune") {
      c.runes = (c.runes || 0) + (drawn.value || 0);
    } else if (entry.kind === "chaliceBonus") {
      var bonus = drawn.value || 0;
      c.flaskMax = (c.flaskMax || FLASK_MAX_DEFAULT) + bonus;
      c.flaskCount = (c.flaskCount || 0) + bonus;
    } else if (entry.kind === "weaponSkillReroll") {
      c._weaponRerollCredits = (c._weaponRerollCredits || 0) + (drawn.value || 1);
    } else if ((entry.kind === "weapon" || entry.kind === "weaponStar") && drawn.weaponId) {
      c.weaponIds = c.weaponIds || [];
      c.weaponIds.push(drawn.weaponId);
    } else if (entry.kind === "talisman" && drawn.talismanId) {
      c.talismanIds = c.talismanIds || [];
      c.talismanIds.push(drawn.talismanId);
    } else if (entry.kind === "consumable" && drawn.itemId) {
      var namedItem = window.PriTestConsumables.get(drawn.itemId);
      c.consumables = c.consumables || [];
      c.consumables.push({ id: CD.makeConsumableInstanceId(drawn.itemId, c), itemId: drawn.itemId, usesRemaining: (namedItem && namedItem.uses) || 1 });
    } else if (entry.kind === "stoneswordKey" || entry.kind === "smithingStone") {
      var fixedItemId2 = entry.kind === "stoneswordKey" ? "item_stonesword_key" : "item_smithing_stone";
      var value2 = drawn.value || 1;
      c.consumables = c.consumables || [];
      var existing = c.consumables.filter(function (inst) { return inst.itemId === fixedItemId2; })[0];
      if (existing) existing.usesRemaining = (existing.usesRemaining || 0) + value2;
      else c.consumables.push({ id: CD.makeConsumableInstanceId(fixedItemId2, c), itemId: fixedItemId2, usesRemaining: value2 });
    }
  }

  // 「揭示」：只有第一次點擊真的觸發計算（transaction保證只算一次，其餘裝置點擊時
  // cur已經非null，直接維持原值），計算結果對所有人一致。
  function revealSharedReward(pointId, rewardId) {
    GameStorage.rtTransaction(gameId, "cloud", "fieldTrigger/" + pointId + "/sharedRewards/" + rewardId + "/drawn", function (cur) {
      if (cur !== null) return cur;
      var trig = fieldTriggers[pointId];
      var entry = trig && trig.sharedRewards && trig.sharedRewards[rewardId];
      return entry ? drawSharedRewardData(entry) : cur;
    });
  }

  function voteSharedReward(pointId, rewardId, choice) {
    if (!mySlot) return;
    GameStorage.rtSet(gameId, "cloud", "fieldTrigger/" + pointId + "/sharedRewards/" + rewardId + "/votes/" + mySlot, choice);
  }

  var sharedRewardResolveAttempted = {}; // pointId+":"+rewardId -> true（本地節流，避免每幀重送同一筆resolvedBy）

  // 全員投完票後決定贏家：用fieldSeededIndex()（既有的mapSeed決定性亂數，見
  // pickFallbackChoice()同款用法）而不是Math.random()，確保所有裝置各自算出同一個贏家，
  // 不會變成「誰的transaction先送達」的競速（那樣就不是真正公平的隨機，而是網路延遲決定）。
  // 2026-09-08使用者明確規格「若沒有任何人投拿取，強制隨機指派給某一位玩家」：沒有人投
  // 拿取時，改成在全部participants裡抽一位（而不是流標）。
  function maybeResolveSharedRewardVote(pointId, rewardId) {
    var key = pointId + ":" + rewardId;
    if (sharedRewardResolveAttempted[key]) return;
    var trig = fieldTriggers[pointId];
    var entry = trig && trig.sharedRewards && trig.sharedRewards[rewardId];
    if (!entry || entry.resolvedBy || !entry.drawn) return;
    var participants = Object.keys(trig.participants || {});
    if (!participants.length) return;
    var votes = entry.votes || {};
    var allVoted = participants.every(function (slot) {
      return votes[slot] === "take" || votes[slot] === "pass";
    });
    if (!allVoted) return;
    sharedRewardResolveAttempted[key] = true;
    var takers = participants.filter(function (slot) {
      return votes[slot] === "take";
    });
    var pool = takers.length ? takers : participants;
    var winnerSlot = pool[fieldSeededIndex(key + ":winner", pool.length)];
    var winnerTokenId = players[winnerSlot] && players[winnerSlot].tokenId;
    if (!winnerTokenId) return;
    GameStorage.rtSet(gameId, "cloud", "fieldTrigger/" + pointId + "/sharedRewards/" + rewardId + "/resolvedBy", winnerTokenId);
    if (winnerTokenId !== myTokenId) return;
    var c = characters[myTokenId];
    if (!c) return;
    applyDrawnSharedRewardToCharacter(c, entry, entry.drawn);
    c._lastTileRewardNote = { text: window.I18N.t("midnight_reward_toast_prefix") + sharedRewardDrawLabel(entry, entry.drawn), at: Date.now() };
    GameStorage.rtSet(gameId, "cloud", "character/" + myTokenId, c);
  }

  function maybeResolveAllSharedRewardVotes() {
    Object.keys(fieldTriggers).forEach(function (pointId) {
      var trig = fieldTriggers[pointId];
      var shared = trig && trig.sharedRewards;
      if (!shared) return;
      Object.keys(shared).forEach(function (rewardId) {
        maybeResolveSharedRewardVote(pointId, rewardId);
      });
    });
  }

  // 掃描所有fieldTriggers，收集尚未被任何人領取(沒有resolvedBy)的sharedRewards項目
  // （設計文件§3.2：教會/隨機事件埋藏寶物等固定數量獎勵的共享池，先搶先贏；Task 14b新增，
  // 補齊Task 1遺留的玩家端UI缺口）。掃描全部fieldTriggers、不只自己目前所在的地圖點——
  // 共享池是跨全場景玩家可見的，任何人都可能先看到、先領到。
  function collectUnresolvedSharedRewards() {
    var out = [];
    Object.keys(fieldTriggers).forEach(function (pointId) {
      var trig = fieldTriggers[pointId];
      var shared = trig && trig.sharedRewards;
      if (!shared) return;
      Object.keys(shared).forEach(function (rewardId) {
        var entry = shared[rewardId];
        if (entry && !entry.resolvedBy) {
          out.push({ pointId: pointId, rewardId: rewardId, entry: entry });
        }
      });
    });
    return out;
  }

  // 複製自night_floor_breakthrough.js:250(純函式，該檔案雖有載入本頁extra_scripts，但這個
  // 函式本身沒有export，見window.PriTestNightFloorBreakthrough的物件字面量，故在此複製一份)，
  // GM判斷類diceHandChoice獎勵用。演算法與night.js板塊踏破的12骰牌型判定完全相同（辨識同一份
  // 規則書），跟Task 9的midnight_puzzles.jsのjudgeDiceHand(values)是完全不同的函式（那個是
  // 塔解謎專用固定表，簽章也不同：只吃values、不吃entry），刻意取名為judgeDiceHandEntry以
  // 避免混淆。
  function judgeDiceHandEntry(entry, values) {
    var counts = [0, 0, 0, 0, 0, 0, 0];
    values.forEach(function (v) {
      counts[v]++;
    });
    var maxCount = Math.max(counts[1], counts[2], counts[3], counts[4], counts[5], counts[6]);
    var lowCount = counts[1] + counts[2] + counts[3];
    var highCount = counts[4] + counts[5] + counts[6];
    var isStraight = counts[1] > 0 && counts[2] > 0 && counts[3] > 0 && counts[4] > 0 && counts[5] > 0 && counts[6] > 0;
    var matchedId = null;
    if (maxCount >= 7) matchedId = "sevenDice";
    else if (lowCount === 0) matchedId = "large";
    else if (highCount === 0) matchedId = "small";
    else if (isStraight) matchedId = "straight";
    return (entry.hands || []).filter(function (h) {
      return h.id === matchedId;
    })[0] || null;
  }

  // tieredChoiceのtier.labelとfieldChoiceLabelsFor()解析出的「(→XXX)」投票標籤是兩種不同
  // 粒度的文字（實際資料範例，見fields_data_3.js）：
  //   (→スカラベ) ←→ tier.label「スカラベ（分岐ポイント2以上）」（label在後面多了補充說明）
  //   (→瓦礫をあさる) ←→ tier.label「瓦礫をあさる」（完全相同）
  // 因此不能直接用===比對整個字串（label是C(ja,zh)物件也不能直接比對物件），改成取
  // localizedText後、括號前的部份跟voteChoiceLabel比對。night_floor_breakthrough.jsの
  // matchTieredChoiceTierIndex()是同一規則書概念下的比對，但它沒有export、且是比對「跨樓層
  // 累積的routeLabels陣列」（night.js單機流程專用），這裡只需要比對「這一層§1.3投票判定出的
  // 單一標籤」，用較簡單的前綴比對即可，不重新複製整套演算法。
  function tieredChoiceTierMatchesVoteLabel(tierLabel, voteChoiceLabel) {
    if (!voteChoiceLabel) return false;
    var text = window.PriTestFields.localizedText(tierLabel || "");
    if (!text) return false;
    if (text === voteChoiceLabel) return true;
    var head = text.split(/[（(]/)[0];
    return head === voteChoiceLabel;
  }

  // GM判斷類獎勵自動套用（設計文件§3.6，Task 14；bargainReveal留給Task 15的手動UI，不在這裡
  // 處理，呼叫端已先篩掉）。voteChoiceLabel＝這一層§1.3投票判定出的選項標籤(tieredChoice
  // 比對用)，可能為null(這一層沒有選項，或選項文字跟tier.label對不上——保守起見不猜測，
  // 直接略過該entry的獎勵，不硬選一個tier)。遞迴處理tier/hand內層的子reward：實際資料中
  // tier.rewards常混合戰利品與其他判斷類entry（例如fields_data_3.js「嫌な予感・成功1回」
  // 同時有hpDamage跟note兩筆），因此resolveJudgmentRewardEntries必須對子陣列再呼叫自己一次。
  function resolveJudgmentRewardEntries(entries, trig, voteChoiceLabel) {
    var lootOut = [];
    (entries || []).forEach(function (entry) {
      if (entry.kind === "hpDamage") {
        // note文字常描述「行為判定失敗時」「ランダム2人」等條件，這些條件App無法自動判斷
        // （不是真正的機率/擲骰資料），因此統一比照既定設計：隨機挑1名參與者，但2026-09-09
        // 改為不再直接扣血，改推進該玩家的pendingRewards佇列（設計文件§4.4），由玩家自己
        // 開獎勵清單按「確認」時才真正扣血（見computeRewardDraw()的hpDamage分支）。
        var slots = participantSlots(trig);
        if (slots.length) {
          var pickedSlot = slots[Math.floor(Math.random() * slots.length)];
          var tokenId = players[pickedSlot] && players[pickedSlot].tokenId;
          if (tokenId) {
            pushPendingReward(tokenId, { kind: "hpDamage", value: entry.value || 0 });
          }
        }
      } else if (entry.kind === "tieredChoice") {
        var tier = (entry.tiers || []).filter(function (t) {
          return tieredChoiceTierMatchesVoteLabel(t.label, voteChoiceLabel);
        })[0];
        if (tier) lootOut = lootOut.concat(resolveJudgmentRewardEntries(tier.rewards, trig, voteChoiceLabel));
      } else if (entry.kind === "diceHandChoice") {
        var diceCount = entry.diceCount || 12;
        var values = [];
        for (var i = 0; i < diceCount; i++) values.push(1 + Math.floor(Math.random() * 6));
        var hand = judgeDiceHandEntry(entry, values);
        if (hand) lootOut = lootOut.concat(resolveJudgmentRewardEntries(hand.rewards, trig, voteChoiceLabel));
      } else if (entry.kind === "note") {
        // 2026-09-09改版：不再直接寫_lastTileRewardNote背景toast，改推進每個參加者的
        // pendingRewards佇列（設計文件§4.4），開獎勵清單才看得到文字內容。
        Object.keys(trig.participants || {}).forEach(function (slot) {
          var p = players[slot];
          if (!p) return;
          pushPendingReward(p.tokenId, { kind: "note", text: window.PriTestFields.localizedText(entry.note) });
        });
      } else {
        lootOut.push(entry); // 戰利品類直接回傳，交給呼叫端跟現有戰利品entries合併處理
      }
    });
    return lootOut;
  }

  // GM判斷類kind清單（設計文件§3.6）：hpDamage/tieredChoice/diceHandChoice/note這4種交給
  // resolveJudgmentRewardEntries()自動套用；bargainReveal留給Task 15的openBargainRevealModal
  // 手動處理，這裡只負責篩出來、暫不消耗。戰利品類kind清單刻意不在這裡重複定義第二份——
  // night_floor_breakthrough.jsのLOOT_REWARD_KINDS/isLootRewardEntry已經是本頁載入的模組
  // （見site_src/midnight_page.pyのextra_scripts，night_floor_breakthrough.js確實有列入，
  // 跟本任務brief原先假設的「未載入」不同——已重新確認），下面繼續沿用它，不建立衝突的
  // 第二份清單。
  var JUDGMENT_REWARD_KINDS = ["hpDamage", "tieredChoice", "diceHandChoice", "bargainReveal", "note"];
  function isJudgmentRewardEntryLocal(entry) {
    return JUDGMENT_REWARD_KINDS.indexOf(entry.kind) !== -1;
  }

  // ---- 取引（bargainReveal）4個已知deal的midnight數值換算（設計文件§3.6/§9-2，Task 15新增）：
  // key用deal.label的ja原文去掉最前面「N｜」編號前綴（見bargainDealMatchKey()），不用目前
  // 顯示語言的文字，避免zh/en介面下對不到——實際資料見fields_data_4.jsの「取引に応じる」
  // tier，6個deal只有下面4個有結構化數值換算，其餘2個（「〇〇に優れた体になりたい」的
  // 判定值/威力補正、「聖杯瓶が欲しい」的聖杯瓶使用回數／□）刻意不處理，留給GM/玩家依
  // manual_note文字自行處理（CLAUDE.md §19「□不得自行發明數值」——這2個deal雖然文字裡也有
  // □，但目前沒有可疊加的對應欄位可以掛勾，不猜測套用位置）。applyGood/applyBad回傳true
  // 代表已結構化套用完畢，回傳false代表無法結構化、只留文字讓renderBargainDealList()附加
  // midnight_bargain_manual_note提示。----
  var BARGAIN_DEAL_EFFECTS = {
    // 2｜後に大成したい
    "後に大成したい": {
      applyGood: function (c) {
        // 「夜の王との戦闘で2ターン目のアクションフェイズ開始時...最大HP：+□□□」：
        // midnight沒有追蹤「戰鬥內第幾回合」這麼細的state，改用進入Day3當下一次性套用
        // （見maybeTriggerDay3FromReady()/applyPendingDay3HpBonuses()掛勾點，這是設計文件
        // §9-2既定的簡化，不是這裡自行猜測）。
        c._pendingDay3HpBonus = (c._pendingDay3HpBonus || 0) + 30;
        return true;
      },
      applyBad: function () {
        // 「最大FP：-□」立即扣FP（本地端資源，只影響自己，不透過RTDB同步）；
        // 「最大加護：-□」的「加護」midnight無對應資源，略過、不猜測套用位置。
        fp.current = Math.max(0, fp.current - 10);
        return true;
      },
    },
    // 3｜全力で戦いたい
    "全力で戦いたい": {
      applyGood: function (c) {
        // 「自身を「最大HP：+□」」供selfArenaHpMax()疊加；「任意の威力補正：+5」midnight
        // 沒有對應的可疊加威力補正欄位（不是既有三套bonus系統的一部分，見CLAUDE.md §12），
        // 這部分留給GM/玩家依manual_note自行處理，不影響這裡applyGood回傳true（HP+10這部分
        // 確實已結構化套用）。
        c._bargainMaxHpBonus = (c._bargainMaxHpBonus || 0) + 10;
        return true;
      },
      applyBad: function () {
        // 「夜の王のすべてのHPライン：+□□」（未乘上倍率+20，見bossHpMax()掛勾點）：
        // 多名PC各自選到這個deal的bad時累積加總，用rtTransaction。
        GameStorage.rtTransaction(gameId, "cloud", "meta/day3BossHpBonusRaw", function (cur) {
          return (cur || 0) + 20;
        });
        return true;
      },
    },
  };
  // 6｜死を遠ざけたい：良好效果＝防禦階段開始獲得體力骰1個 → 換算為體力回復速率5→6/秒
  // （§9-2既定換算，見myStaminaRegenPerSec）。這個deal沒有對應的已知不良效果數值換算
  // （「自身最大HP：-□（最低值1）」暫不結構化），applyBad固定回傳false。
  var BARGAIN_STAMINA_GOOD_KEY = "死を遠ざけたい";
  // 5｜状態異常に強くなりたい：不良效果＝行動/額外階段體力骰出目自動變更為⚀ → 換算為體力
  // 回復速率5→4/秒。良好效果（異常狀態最大蓄積值+1）暫不結構化，applyGood固定回傳false。
  var BARGAIN_STAMINA_BAD_KEY = "状態異常に強くなりたい";
  BARGAIN_DEAL_EFFECTS[BARGAIN_STAMINA_GOOD_KEY] = {
    applyGood: function () {
      myStaminaRegenPerSec = 6;
      return true;
    },
    applyBad: function () {
      return false;
    },
  };
  BARGAIN_DEAL_EFFECTS[BARGAIN_STAMINA_BAD_KEY] = {
    applyGood: function () {
      return false;
    },
    applyBad: function () {
      myStaminaRegenPerSec = 4;
      return true;
    },
  };

  // deal比對key：一律用deal.label的ja原文（不受目前UI顯示語言影響），去掉最前面「N｜」
  // 編號前綴。例如「2｜後に大成したい」比對key為「後に大成したい」。
  function bargainDealMatchKey(deal) {
    var raw = (deal && deal.label && deal.label.ja) || "";
    var sepIdx = raw.indexOf("｜");
    return sepIdx === -1 ? raw : raw.slice(sepIdx + 1);
  }

  // 通用取引揭曉modal（設計文件§3.6，Task 15新增；資料形狀跟Task 25「調律の魔物」相同，
  // 供其重用同一套engine，見brief）。pt/trig目前未在render本體內使用，維持相同signature是
  // 為了保留呼叫端的觸發格資訊，供未來擴充（例如記錄是哪個地圖點觸發的取引）時不需要改
  // 這裡的介面。
  function openBargainRevealModal(pt, trig, entry) {
    var deals = (entry && entry.deals) || [];
    renderBargainDealList(pt, trig, deals);
    el("midnight-bargain-modal").hidden = false;
  }

  function closeBargainModal() {
    el("midnight-bargain-modal").hidden = true;
  }

  function renderBargainDealList(pt, trig, deals) {
    var listEl = el("midnight-bargain-deal-list");
    listEl.innerHTML = "";
    var Fields = window.PriTestFields;
    deals.forEach(function (deal) {
      var card = document.createElement("div");
      card.className = "midnight-bargain-deal-card";
      var title = document.createElement("p");
      title.textContent =
        Fields.localizedText(deal.label) + "　" + window.I18N.t("midnight_bargain_good_label") + "：" + Fields.localizedText(deal.good);
      card.appendChild(title);
      var badLine = document.createElement("p");
      badLine.className = "warning-text";
      badLine.hidden = true;
      card.appendChild(badLine);
      var btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = window.I18N.t("midnight_bargain_choose_button");
      btn.addEventListener("click", function () {
        badLine.textContent = window.I18N.t("midnight_bargain_bad_label") + "：" + Fields.localizedText(deal.bad);
        badLine.hidden = false;
        btn.disabled = true;
        var c = characters[myTokenId];
        if (!c) return;
        var effects = BARGAIN_DEAL_EFFECTS[bargainDealMatchKey(deal)];
        var goodApplied = !!(effects && effects.applyGood(c));
        var badApplied = !!(effects && effects.applyBad(c));
        c._lastTileRewardNote = {
          text:
            Fields.localizedText(deal.label) +
            "／" +
            window.I18N.t("midnight_bargain_good_label") +
            "：" +
            Fields.localizedText(deal.good) +
            (goodApplied ? "" : window.I18N.t("midnight_bargain_manual_note")) +
            "／" +
            window.I18N.t("midnight_bargain_bad_label") +
            "：" +
            Fields.localizedText(deal.bad) +
            (badApplied ? "" : window.I18N.t("midnight_bargain_manual_note")),
          at: Date.now(),
        };
        GameStorage.rtSet(gameId, "cloud", "character/" + myTokenId, c);
      });
      card.appendChild(btn);
      listEl.appendChild(card);
    });
  }

  function maybeGrantFieldTileReward(pt, trig, floor) {
    if (fieldTileRewardAttempted[pt.id]) return;
    fieldTileRewardAttempted[pt.id] = true;
    var FloorBreakthrough = window.PriTestNightFloorBreakthrough;
    var reward = (floor && floor.reward) || [];
    var lootEntries = FloorBreakthrough ? reward.filter(FloorBreakthrough.isLootRewardEntry) : [];
    var judgmentEntries = reward.filter(isJudgmentRewardEntryLocal);
    var autoJudgmentEntries = judgmentEntries.filter(function (e) {
      return e.kind !== "bargainReveal";
    });
    var bargainEntries = judgmentEntries.filter(function (e) {
      return e.kind === "bargainReveal";
    });
    if (lootEntries.length || autoJudgmentEntries.length) {
      // resolveJudgmentRewardEntries()有副作用(hpDamage的demoStat扣血/diceHandChoice的
      // 擲骰/note寫入角色欄位)，必須放在tileRewardGrantedBy transaction「本裝置搶到鎖」
      // 之後才執行——每個participant各自的裝置都會呼叫到這個函式，若在transaction外先
      // 計算，會變成每台裝置各自獨立扣血/擲骰/寫note（重複套用），而不是只有搶到鎖的
      // 那一台裝置執行一次。lootEntries本身不受影響(既有行為)，但judgment類獎勵的隨機性
      // 副作用必須跟著lock走。
      GameStorage.rtTransaction(gameId, "cloud", "fieldTrigger/" + pt.id + "/tileRewardGrantedBy", function (cur) {
        return cur === null ? myTokenId : cur;
      }).then(function (committed) {
        if (committed !== myTokenId) return;
        // 這一層§1.3投票判定出的選項標籤（trig.choiceIndex由maybeResolveFieldVote寫入），
        // 供tieredChoice比對用；沒有投過票(choiceIndex非數字)則維持null。
        var voteLabel = null;
        if (typeof trig.choiceIndex === "number") {
          var labels = fieldChoiceLabelsFor(pt, trig);
          voteLabel = labels[trig.choiceIndex] || null;
        }
        var resolvedLoot = autoJudgmentEntries.length ? resolveJudgmentRewardEntries(autoJudgmentEntries, trig, voteLabel) : [];
        var allLoot = lootEntries.concat(resolvedLoot);
        if (!allLoot.length) return;
        // perPerson/固定共享的分流（設計文件§1.5/§3.2，Task 1已建好pushPerPlayerReward/
        // pushSharedReward基礎設施但尚未接上任何呼叫路徑，見task-7-report.md「已知限制」——
        // 這裡是接上的地方）。perPerson維持原本「每個participant各自即時拿到一份」的行為
        // （grantTileLootToParticipants），並額外記一份到後補領取ledger；shared則不即時
        // 授予，改為推進fieldTrigger/{id}/sharedRewards、由參與者投票拿取/不拿取後決定
        // 一人領取（見revealSharedReward()/voteSharedReward()/maybeResolveSharedRewardVote()）。
        var perPerson = allLoot.filter(isPerPersonRewardEntry);
        var shared = allLoot.filter(function (e) {
          return !isPerPersonRewardEntry(e);
        });
        if (perPerson.length) {
          // chaliceBonus改走個人待領取清單而非立即套用（設計文件§5，Task 16）：跟
          // rune/talisman等擊殺獎勵一樣，需要玩家自己在獎勵清單彈窗按「領取」才真正
          // 套用flaskMax/flaskCount，不能再讓grantTileLootToParticipants()直接連同
          // 其餘perPerson kind一起立即授予。ledger(pushPerPlayerReward)仍記錄完整
          // perPerson（含chaliceBonus）供後補領取判斷「這個玩家有沒有錯過」；後補流程
          // （claimLatePerPlayerRewards）也同步改成對chaliceBonus改走pushPendingReward、
          // 不再直接立即套用，兩條路徑維持一致。pushPendingReward()這裡改傳淺拷貝
          // （而不是floor.reward裡的原始entry物件參考）：跟pushSharedReward()既有做法
          // 一致，避免把.resolved等執行期欄位直接寫回fields_data_*.js模組層級共用的
          // 靜態資料物件。
          var chaliceEntries = perPerson.filter(function (e) {
            return e.kind === "chaliceBonus";
          });
          var immediateEntries = perPerson.filter(function (e) {
            return e.kind !== "chaliceBonus";
          });
          if (immediateEntries.length) grantTileLootToParticipants(trig, immediateEntries);
          chaliceEntries.forEach(function (e) {
            Object.keys(trig.participants || {}).forEach(function (slot) {
              var p = players[slot];
              // 2026-09-08新增sourcePointId/sourceFloorIndex：供fieldRewardGateOpen()判斷
              // 「這筆待領取獎勵是不是這一層樓層清出來的」，只gate這一層的獎勵，不影響
              // 其他來源（擊殺/塔解謎等）的pendingRewards。
              if (p) pushPendingReward(p.tokenId, { kind: e.kind, value: e.value, sourcePointId: pt.id, sourceFloorIndex: trig.floorIndex || 0 });
            });
          });
          pushPerPlayerReward(pt.id, perPerson, trig.participants);
        }
        shared.forEach(function (e) {
          pushSharedReward(pt.id, e);
        });
      });
    }
    if (bargainEntries.length) {
      // 取引是玩家個人選擇的手動UI（設計文件§3.6），不是自動套用類獎勵，因此不透過
      // tileRewardGrantedBy搶鎖——每個participant各自在自己的裝置上開啟自己的取引視窗、
      // 選擇自己要的deal，applyGood/applyBad只改自己的角色欄位／本地端資源（見
      // BARGAIN_DEAL_EFFECTS），不會有多裝置重複套用的問題。實際資料（fields_data_4.js）
      // 目前每個floor reward只有1筆bargainReveal entry，這裡只處理第一筆。
      if (trig.participants && trig.participants[mySlot]) {
        openBargainRevealModal(pt, trig, bargainEntries[0]);
      }
    }
  }

  function maybeGrantFieldTileRewardOnClear(pt) {
    var trig = fieldTriggers[pt.id];
    if (!trig || trig.status !== "resolved" || !trig.enemyFamilyId) return;
    var hp = fieldEnemyHp[pt.id];
    if (hp === undefined || hp > 0) return;
    var floor = fieldFloorForTrig(pt, trig);
    // fix(2026-09-10)：同maybeAssignFieldEnemy()，floor取不到時不再靜默return（那會讓
    // 敵人已經打倒、樓層卻永遠不推進），改為照樣推進進度；maybeGrantFieldTileReward()
    // 本身已能接受floor為null（reward視為空陣列，不會發明獎勵）。
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
    // fix(2026-09-10)：原本漏了這一個。清空trigger、下一層重新進入時若殘留上一層的
    // 播完時間戳，maybeResolveFieldVote()的「自動選擇前停3秒」（FIELD_AUTO_SELECT_DELAY_MS）
    // 判斷式會因為doneAt早就過期而立即成立，新樓層敘述一播完就瞬間跳過，玩家來不及讀。
    delete fieldTypewriterDoneAt[id];
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
    // kasan地變特殊規則「熔岩」（使用者明確規格「此場地每次樓層踏破，PC全員自動無條件
    // 承受『HP損害：■』」）：■數值規則書未標示，依CLAUDE.md §19不自行發明，只用toast
    // 提醒在場玩家自行依規則書套用，不自動扣血。這裡跑在每個「靠近這個點的玩家」自己的
    // 裝置上（跟fieldFloorAdvanceAttempted guard一樣，是「每個client各自跑一次」而不是
    // 「只有transaction贏家跑一次」），因此每個在場玩家都會各自看到一次提醒，不需要另外
    // 建立跨玩家廣播機制。
    if (map && map.specialRule === "kasan_lava") {
      showToast(window.I18N.t("midnight_kasan_lava_floor_note"));
    }
    var floorCount = fieldFloorCountForCard(pt);
    var nextFloorIndex = floorIndex + 1;
    var cleared = nextFloorIndex >= floorCount;
    GameStorage.rtTransaction(gameId, "cloud", "fieldProgress/" + pt.id + "/advancedBy" + floorIndex, function (cur) {
      return cur === null ? myTokenId : cur;
    }).then(function (committed) {
      if (committed !== myTokenId) return; // 搶輸了，這一層的推進已經由別的裝置負責
      // fix(2026-09-10)：把「這一層實際參加到最後的席位」無條件記進fieldProgress。
      // 原本這份紀錄只是pushPerPlayerReward()的directSlots副產品，而該函式在
      // perPerson獎勵為0筆時會直接return（見該函式）——實際資料裡「這一層沒有任何
      // perPerson戰利品」非常常見（178個樓層中有60個以上的reward只有tieredChoice／
      // hpDamage／note，或根本沒有reward），於是這些樓層踏破後完全沒有留下參與紀錄。
      // 樓層推進時fieldTrigger會被maybeClearFieldTriggerAfterRewardGate()整個清空，
      // updateNearbyFieldPoint()便再也查不到「我其實是這一層的participant」，把原本的
      // 參與者誤判成「延遲入場、需要後補領獎」，跳出late-claim提示（使用者回報現象①）。
      // 這裡沿用既有的fieldProgress ledger節點（跟directSlots同樣是slot->true的形狀），
      // 不另外發明第二套追蹤機制，且不受fieldTrigger清空影響。
      Object.keys(trig.participants || {}).forEach(function (slot) {
        if (!trig.participants[slot]) return;
        GameStorage.rtSet(gameId, "cloud", "fieldProgress/" + pt.id + "/participatedSlots/" + slot, true);
      });
      GameStorage.rtSet(gameId, "cloud", "fieldProgress/" + pt.id + "/branchIndex", trig.branchIndex);
      GameStorage.rtSet(gameId, "cloud", "fieldProgress/" + pt.id + "/floorIndex", nextFloorIndex);
      GameStorage.rtSet(gameId, "cloud", "fieldProgress/" + pt.id + "/cleared", cleared);
      if (cleared) {
        maybeGrantFieldFullClearReward(pt, trig);
      }
      // 2026-09-08使用者明確規格「無法繼續前進 直到參加的人都關閉了獎勵清單」：還有下一層
      // 時，不在這裡立即清空fieldTrigger（原本的做法），改成交給每幀輪詢的
      // maybeClearFieldTriggerAfterRewardGate()——那裡會比對fieldProgress.floorIndex
      // （這裡剛寫入的nextFloorIndex）跟trig.floorIndex，一旦偵測到「bookkeeping已經推進
      // 但trigger還沒清空」且fieldRewardGateOpen()為true才真正清空，避免清空當下就把還沒
      // resolvedBy的sharedRewards一併沖掉、也符合使用者規格的等待語意。
    });
  }

  // 2026-09-08新增：判斷這個地圖點的「獎勵清單」是否已經全部關閉（resolved）——涵蓋①
  // 共享獎勵池（trig.sharedRewards，見pushSharedReward()／maybeResolveSharedRewardVote()）②這一層
  // 樓層清出來、標記了sourcePointId/sourceFloorIndex的個人待領取清單（pendingRewards，見
  // 上方chaliceEntries.forEach()）。只要還有任何一筆未resolved，就回傳false（gate關閉，
  // 不能繼續前進）。
  function fieldRewardGateOpen(pt) {
    var trig = fieldTriggers[pt.id];
    if (!trig) return true;
    var shared = trig.sharedRewards || {};
    for (var rewardId in shared) {
      if (!shared[rewardId].resolvedBy) return false;
    }
    var floorIndex = trig.floorIndex || 0;
    var participants = trig.participants || {};
    for (var slot in participants) {
      var p = players[slot];
      if (!p) continue;
      var list = pendingRewards[p.tokenId] || {};
      for (var id in list) {
        var e = list[id];
        if (!e.resolved && e.sourcePointId === pt.id && e.sourceFloorIndex === floorIndex) return false;
      }
    }
    return true;
  }

  // 2026-09-08新增：每幀輪詢，偵測「fieldProgress已經記錄推進到下一層（bookkeeping已完成，
  // 見maybeAdvanceFieldProgressAfterFloorClear()），但fieldTrigger本身還沒被清空」的窗口，
  // 一旦fieldRewardGateOpen()回傳true才真正清空，讓「進入」按鈕能對下一層重新觸發。多台
  // 裝置可能同時符合條件、同時各自呼叫rtSet(null)，是天然幂等的重複寫入，不需要transaction。
  function maybeClearFieldTriggerAfterRewardGate(pt) {
    var trig = fieldTriggers[pt.id];
    var progress = fieldProgress[pt.id];
    if (!trig || !progress || progress.cleared) return;
    // fix(2026-09-10)：使用者回報「按下『進入下一層』後無法真正進入、卡在該樓層」的直接
    // 成因。handleEnterFieldPointClick()建立的新trigger是
    // {status:"inviting", ...}，**沒有floorIndex欄位**（floorIndex要等
    // maybeAdvanceFieldInvite()邀請時限結束才從fieldProgress補上）。原本的判斷式用
    // `trig.floorIndex || 0`把它當成0，於是「progress.floorIndex(1) > 0」立刻成立，
    // 這個每幀輪詢的函式會在玩家按下「進入」的下一幀就把剛建立的邀請trigger整個清掉
    // ——而且順帶resetFieldPointLocalFlags()把fieldEnterAttempted也清掉，所以按鈕看起來
    // 還能再按，但每按一次都在10秒邀請時限走完之前被抹掉，樓層永遠進不去。
    // 這個函式的用途只有一個：清掉「已經完成、進度已經推進過」的那個舊trigger，因此
    // 加上兩道明確的條件——①必須已經是resolved（樓層跑完的trigger一定是resolved，見
    // maybeAssignFieldEnemy()／maybeGrantFieldTileRewardOnClear()兩個唯一呼叫
    // maybeAdvanceFieldProgressAfterFloorClear()的地方）②floorIndex必須真的存在，
    // 不用「|| 0」把「還沒決定樓層」誤當成第0層。
    if (trig.status !== "resolved" || typeof trig.floorIndex !== "number") return;
    if ((progress.floorIndex || 0) <= trig.floorIndex) return;
    if (!fieldRewardGateOpen(pt)) return;
    resetFieldPointLocalFlags(pt.id);
    GameStorage.rtSet(gameId, "cloud", "fieldTrigger/" + pt.id, null);
    GameStorage.rtSet(gameId, "cloud", "fieldEnemyHp/" + pt.id, null);
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
  // 2026-09-10新增（使用者明確要求「獎勵清單：選中的左側項目時，高亮其選項」＋「抽選的
  // 物品也要詳細顯示其武器資訊」）：共享池項目也可以被選取並在右側detail顯示完整資訊，
  // 跟個人清單的selectedRewardId互斥（選了其中一邊就清掉另一邊），共用同一個detail面板。
  // 值是collectUnresolvedSharedRewards()同款的 pointId + ":" + rewardId。
  var selectedSharedRewardKey = null;
  var rewardDraftById = {};
  var potentialPowerDraftById = {};
  var lastRewardIdsKey = "";
  var rewardModalDismissed = false;

  function rewardEntryLabel(entry) {
    if (entry.kind === "rune") return window.I18N.t("midnight_reward_kind_rune");
    if (entry.kind === "potentialPower") return window.I18N.t("midnight_reward_kind_potential_power");
    if (entry.kind === "attachedEffect") return window.I18N.t("midnight_reward_kind_attached_effect");
    if (entry.kind === "talisman") return window.I18N.t("midnight_reward_kind_talisman");
    // 2026-09-10修正（使用者回報「潛在之力目前寫錯成WeaponStar了？」）：fields_data_*.js／
    // TOWER_DICE_HAND_REWARDS的武器獎勵用的kind是"weaponStar"（value＝★數＝決定稀有度的
    // 骰子顆數），不是"weapon"。個人待領取清單這一條路徑（pushPendingReward→這裡）原本
    // 只認得"weapon"，因此清單上直接顯示未翻譯的原始字串"weaponStar"，看起來像是「潛在
    // 之力被寫成WeaponStar」。共享獎勵那條路徑（drawSharedRewardData()／
    // sharedRewardDrawLabel()／applyDrawnSharedRewardToCharacter()）本來就有處理
    // "weaponStar"，只有個人這條漏掉。這裡與下方computeRewardDraw()／renderRewardDetail()
    // 一起補齊，比照night_floor_breakthrough.jsの「weaponStar＝武器、value是★數」既有定義。
    if (entry.kind === "weapon" || entry.kind === "weaponStar") return window.I18N.t("midnight_reward_kind_weapon");
    if (entry.kind === "consumable") return window.I18N.t("midnight_reward_kind_consumable");
    if (entry.kind === "chaliceBonus") return window.I18N.t("midnight_reward_kind_chalice_bonus");
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
    if (entry.kind === "chaliceBonus") {
      // 跟"rune"一樣是固定數值，沒有隨機抽選的必要，直接回傳可套用的draft
      // （renderRewardDetail()的needsDrawStep只認weapon/consumable/talisman三種，
      // chaliceBonus會跟rune一樣直接落到這裡、顯示確認/丟棄兩顆按鈕）。
      var chaliceValue = entry.value || 0;
      return {
        label: window.I18N.t("midnight_reward_label_chalice_bonus", { value: chaliceValue }),
        apply: function (c) {
          c.flaskMax = (c.flaskMax || FLASK_MAX_DEFAULT) + chaliceValue;
          c.flaskCount = (c.flaskCount || 0) + chaliceValue;
        },
      };
    }
    if (entry.kind === "stoneswordKey" || entry.kind === "smithingStone") {
      var itemId = entry.kind === "stoneswordKey" ? "item_stonesword_key" : "item_smithing_stone";
      var value2 = entry.value || 1;
      var itemData = window.PriTestConsumables.get(itemId);
      return {
        label: (itemData ? window.PriTestConsumables.localizedText(itemData.name) : itemId) + " x" + value2,
        apply: function (c) {
          c.consumables = c.consumables || [];
          var existing = c.consumables.filter(function (inst) { return inst.itemId === itemId; })[0];
          if (existing) {
            existing.usesRemaining = (existing.usesRemaining || 0) + value2;
          } else {
            var instId = window.PriTestCharacterDrawer.makeConsumableInstanceId(itemId, c);
            c.consumables.push({ id: instId, itemId: itemId, usesRemaining: value2 });
          }
        },
      };
    }
    if (entry.kind === "weaponSkillReroll") {
      var rerollValue = entry.value || 1;
      return {
        label: window.I18N.t("midnight_reward_label_weapon_skill_reroll", { value: rerollValue }),
        apply: function (c) {
          c._weaponRerollCredits = (c._weaponRerollCredits || 0) + rerollValue;
        },
      };
    }
    if (entry.kind === "hpDamage") {
      return {
        label: window.I18N.t("midnight_reward_label_hp_damage", { value: entry.value || 0 }),
        apply: function (c) {
          var max = selfArenaHpMax(c);
          GameStorage.rtTransaction(gameId, "cloud", "demoStat/" + myTokenId, function (cur) {
            var current = cur === null ? max : cur;
            return Math.max(0, current - (entry.value || 0));
          }).then(function (result) {
            // 2026-09-09合併私有分支的瀕死系統：延遲到玩家實際確認扣血的這一刻才判斷是否
            // 觸發瀕死，跟private/main原本在判定當下就檢查的時機點不同，但maybeTriggerNearDeath()
            // 本身邏輯不變。
            if (result === 0) maybeTriggerNearDeath(myTokenId);
          });
        },
      };
    }
    if (entry.kind === "note") {
      return {
        label: entry.text || "",
        apply: function () {},
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
    // "weaponStar"是fields_data_*.js／TOWER_DICE_HAND_REWARDS實際使用的kind（見
    // rewardEntryLabel()的2026-09-10修正說明），跟"weapon"完全同一種獎勵，差別只在
    // weaponStar額外可能帶categoryId（指定大分類，例如聖印）與attributeTag（規則書
    // 在武器上附註的屬性文字，例如「聖／-5」）。抽選規則不重新發明：categoryId有值時用
    // CharacterDrawer.drawWeaponFromCategory()（塔謎題「杖」獎勵既有的同一支helper），
    // 沒有就跟原本一樣用merchantDrawWeapon()。兩者都會直接push進傳入角色的weaponIds，
    // 因此比照原本的既有做法傳入淺拷貝的暫時物件，真正的授予留到apply()。
    if (entry.kind === "weapon" || entry.kind === "weaponStar") {
      var c0 = characters[myTokenId] || { weaponIds: [] };
      var scratch = { weaponIds: (c0.weaponIds || []).slice() };
      var stars = entry.value || 1;
      var result = entry.categoryId
        ? window.PriTestCharacterDrawer.drawWeaponFromCategory(scratch, entry.categoryId, stars)
        : window.PriTestCharacterDrawer.merchantDrawWeapon(scratch, stars);
      if (!result) return { label: window.I18N.t("midnight_reward_draw_empty"), apply: function () {} };
      // attributeTag是fields_data_*.js的C(ja,zh)雙語物件，沿用night.jsのhandleTurnRewardClaim
      // 同一種PriTestFields.localizedText()解讀方式；沒有這個欄位時維持null，不硬湊。
      var attributeTag = entry.attributeTag ? window.PriTestFields.localizedText(entry.attributeTag) : null;
      return {
        label: window.PriTestWeapons.localizedText(result.item.name),
        item: result.item,
        weaponId: result.weaponId,
        apply: function (c) {
          c.weaponIds = c.weaponIds || [];
          c.weaponIds.push(result.weaponId);
          if (attributeTag) {
            c.weaponAttributeTags = c.weaponAttributeTags || {};
            c.weaponAttributeTags[result.weaponId] = attributeTag;
          }
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

  // potentialPower（得意武器／附帶效果二選一，對應設計文件§3.3「雙抽同時揭示」）：
  // 2026-09-07改版——原本是兩邊各自獨立「抽選」按鈕＋各自「選擇這個」；現在改成單一
  // 「抽選」按鈕同時抽兩邊（potentialPowerDrawWeapon／rollPotentialPowerAttachedEffect
  // 都是character_drawer.js既有純函式，一次呼叫即拿到完整結果，不需要事先lock按鈕），
  // 揭示後並排顯示兩張結果卡，玩家點其中一張的「選擇這個」才真正commit
  // （commitPotentialPowerWeapon／commitAttachedEffectChoice），另一張直接捨棄
  // （不呼叫任何commit，等同消失）。
  // resolvedEffect的candidates fallback（effect: null時取candidates[0]）沿用舊版邏輯：
  // rollPotentialPowerAttachedEffect擲到已習得過的效果時，回傳的.effect會是null，改用
  // .candidates（同一block內未習得的候補，或全24種未習得候補）代替。
  function renderPotentialPowerRewardDetail(id, entry, detail) {
    var draft = potentialPowerDraftById[id];
    var CD = window.PriTestCharacterDrawer;

    if (!draft) {
      var drawBtn = document.createElement("button");
      drawBtn.type = "button";
      drawBtn.textContent = window.I18N.t("midnight_reward_draw_button");
      drawBtn.addEventListener("click", function () {
        var c = characters[myTokenId];
        if (!c) return;
        potentialPowerDraftById[id] = {
          // entry.valueは★數＝稀有度を決めるD6の個数（weaponStarと同じ意味）であって、
          // 抽選回数ではない——2026-09-10使用者明確確認「『★2 稀有度』一次抽選」。
          // 「1件＝1回分」だと誤解してvalue個の項目へ分割してはいけない（night.js側の
          // 同じ誤りを同日修正済み、night_floor_breakthrough.jsのpotentialPower分岐参照）。
          weapon: CD.potentialPowerDrawWeapon(c, entry.value || 1),
          effect: CD.rollPotentialPowerAttachedEffect(c),
        };
        renderRewardDetail(id, entry);
      });
      detail.appendChild(drawBtn);
      return;
    }

    var note = document.createElement("p");
    note.className = "warning-text";
    note.textContent = window.I18N.t("midnight_reward_potential_choose_note");
    detail.appendChild(note);

    function finishPick() {
      GameStorage.rtSet(gameId, "cloud", "character/" + myTokenId, characters[myTokenId]);
      GameStorage.rtSet(gameId, "cloud", "pendingRewards/" + myTokenId + "/" + id + "/resolved", true);
      delete potentialPowerDraftById[id];
      selectedRewardId = null;
    }

    var row = document.createElement("div");
    row.className = "wb-row";

    if (draft.weapon && draft.weapon.item) {
      var weaponCard = document.createElement("div");
      // 2026-09-10（使用者明確要求「獎勵清單抽選的物品也要詳細顯示其武器資訊，其武器的
      // 戰技魔術與祈禱」）：原本只顯示武器名稱一行，改成跟其餘武器獎勵同一套
      // renderWeaponSheetDetail()。potentialPowerDrawWeapon()此時尚未寫入角色
      // （要等玩家按[選擇這個]才commit），因此傳入catalog id與這次抽到的random戰技
      // （draft.weapon.skillId）當作override，讓玩家選之前就看得到完整內容。
      var cForWeapon = characters[myTokenId];
      if (cForWeapon) {
        renderWeaponSheetDetail(weaponCard, cForWeapon, draft.weapon.item.id, CD, draft.weapon.skillId);
      } else {
        var weaponLabel = document.createElement("p");
        weaponLabel.textContent = window.PriTestWeapons.localizedText(draft.weapon.item.name);
        weaponCard.appendChild(weaponLabel);
      }
      var chooseWeaponBtn = document.createElement("button");
      chooseWeaponBtn.type = "button";
      chooseWeaponBtn.textContent = window.I18N.t("midnight_reward_potential_choose_button");
      chooseWeaponBtn.addEventListener("click", function () {
        var c = characters[myTokenId];
        if (!c) return;
        CD.commitPotentialPowerWeapon(c, draft.weapon);
        finishPick();
      });
      weaponCard.appendChild(chooseWeaponBtn);
      row.appendChild(weaponCard);
    }

    var resolvedEffect = draft.effect && (draft.effect.effect || (draft.effect.candidates && draft.effect.candidates[0]));
    if (resolvedEffect) {
      var effectCard = document.createElement("div");
      var effectLabel = document.createElement("p");
      effectLabel.textContent =
        window.PriTestCharacterTypes.localizedText(resolvedEffect.name) +
        window.I18N.t("colon_separator") +
        mnText(window.PriTestCharacterTypes.localizedText(resolvedEffect.body || {}), window.PriTestCharacterTypes.localizedText(resolvedEffect.name));
      effectCard.appendChild(effectLabel);
      var chooseEffectBtn = document.createElement("button");
      chooseEffectBtn.type = "button";
      chooseEffectBtn.textContent = window.I18N.t("midnight_reward_potential_choose_button");
      chooseEffectBtn.addEventListener("click", function () {
        var c = characters[myTokenId];
        if (!c) return;
        CD.commitAttachedEffectChoice(c, resolvedEffect);
        finishPick();
      });
      effectCard.appendChild(chooseEffectBtn);
      row.appendChild(effectCard);
    }

    detail.appendChild(row);
  }

  // attachedEffect（附帶效果單獨1個，2026-09-10新增）：黃金樹之帳的夜之強敵擊破獎勵
  // 「PCはそれぞれ「付帯効果」を獲得」用（見maybeGrantFinalCircleBossReward()）。
  // 跟potentialPower的差別只在「沒有得意武器那一半」——規則書這裡直接給附帶效果，不是
  // 二選一。因此完全重用CharacterDrawer既有的同兩支helper（rollPotentialPowerAttachedEffect
  // 抽選／commitAttachedEffectChoice確定），不新增第三套附帶效果抽選機制（CLAUDE.md §26）。
  // resolvedEffect的candidates fallback理由同renderPotentialPowerRewardDetail()。
  var attachedEffectDraftById = {};

  function renderAttachedEffectRewardDetail(id, entry, detail) {
    var CD = window.PriTestCharacterDrawer;
    var draft = attachedEffectDraftById[id];

    if (!draft) {
      var drawBtn = document.createElement("button");
      drawBtn.type = "button";
      drawBtn.textContent = window.I18N.t("midnight_reward_draw_button");
      drawBtn.addEventListener("click", function () {
        var c = characters[myTokenId];
        if (!c) return;
        attachedEffectDraftById[id] = CD.rollPotentialPowerAttachedEffect(c);
        renderRewardDetail(id, entry);
      });
      detail.appendChild(drawBtn);
      return;
    }

    var resolvedEffect = draft.effect || (draft.candidates && draft.candidates[0]);
    if (!resolvedEffect) {
      // 24種附帶效果全部習得完（理論上極罕見）：不硬塞一個重複的，如實顯示抽不到並提供
      // 「丟棄」讓玩家把這筆獎勵結掉，沿用既有的discardRewardEntry()。
      var emptyP = document.createElement("p");
      emptyP.textContent = window.I18N.t("midnight_reward_draw_empty");
      detail.appendChild(emptyP);
      var discardBtn = document.createElement("button");
      discardBtn.type = "button";
      discardBtn.textContent = window.I18N.t("midnight_reward_discard_button");
      discardBtn.addEventListener("click", function () {
        delete attachedEffectDraftById[id];
        discardRewardEntry(id);
      });
      detail.appendChild(discardBtn);
      return;
    }

    var effectP = document.createElement("p");
    effectP.textContent =
      window.PriTestCharacterTypes.localizedText(resolvedEffect.name) +
      window.I18N.t("colon_separator") +
      mnText(window.PriTestCharacterTypes.localizedText(resolvedEffect.body || {}), window.PriTestCharacterTypes.localizedText(resolvedEffect.name));
    detail.appendChild(effectP);

    var confirmBtn = document.createElement("button");
    confirmBtn.type = "button";
    confirmBtn.textContent = window.I18N.t("midnight_reward_confirm_button");
    confirmBtn.addEventListener("click", function () {
      var c = characters[myTokenId];
      if (!c) return;
      CD.commitAttachedEffectChoice(c, resolvedEffect);
      GameStorage.rtSet(gameId, "cloud", "character/" + myTokenId, c);
      GameStorage.rtSet(gameId, "cloud", "pendingRewards/" + myTokenId + "/" + id + "/resolved", true);
      delete attachedEffectDraftById[id];
      selectedRewardId = null;
    });
    detail.appendChild(confirmBtn);
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
    if (entry.kind === "attachedEffect") {
      renderAttachedEffectRewardDetail(id, entry, detail);
      return;
    }
    var needsDrawStep = entry.kind === "weapon" || entry.kind === "weaponStar" || entry.kind === "consumable" || entry.kind === "talisman";
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
    if ((entry.kind === "weapon" || entry.kind === "weaponStar") && draft.weaponId) {
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
        bodyText.textContent = mnText(Localizer.localizedText(draft.item.body), draft.label);
        detail.appendChild(bodyText);
      }
    }
    // 持有量硬上限（2026-09-05角色面板優化新增）：weapon/consumable/talisman三種entry
    // 對應角色面板的6/4/2格上限，滿了就不給確認收下，提示先去角色面板丟棄騰出空間——
    // 獎勵本身仍留在待處理清單裡，之後騰出空間再回來點確認即可，不會憑空遺失。
    // weaponStar跟weapon佔用同一個「武器」格位上限，先正規化再查（inventorySlotLimit()
    // 只認得weapon/consumable/talisman三種kind）。
    var inventoryKind = needsDrawStep ? (entry.kind === "weaponStar" ? "weapon" : entry.kind) : null;
    var c0 = characters[myTokenId];
    if (inventoryKind && c0 && !hasInventorySpace(c0, inventoryKind)) {
      // 設計文件§3.1「黃字提示取代靜默略過」：這裡本來就已經不給確認按鈕、彈窗不關閉，
      // 只差視覺上沒有標成警示色——補上.warning-text（本檔案目前唯一的黃字警示樣式，
      // 見style.css，供本次與之後同類黃字提示共用，不重複發明）。
      var fullNote = document.createElement("p");
      fullNote.className = "warning-text";
      fullNote.textContent = window.I18N.t("midnight_inventory_full_note");
      detail.appendChild(fullNote);
      return;
    }
    // 遺物效果「回合中限1次裝備變更免費」（2026-09-11使用者明確規格「每一天僅限1次，
    // 可將武器/消耗品/裝飾品抽選 進行多一次抽選（捨棄前一次結果）」）：只在需要抽選的
    // 三種kind上出現，按下就丟掉目前draft重抽一次，並記下今天已用（_freeRerollUsedDay）。
    if (needsDrawStep && c0 && hasRelic(c0, "freeReroll")) {
      var today = currentPhaseInfo(Date.now()).day;
      if ((c0._freeRerollUsedDay || 0) !== today) {
        var redrawBtn = document.createElement("button");
        redrawBtn.type = "button";
        redrawBtn.textContent = window.I18N.t("midnight_reward_free_redraw_button");
        redrawBtn.addEventListener("click", function () {
          c0._freeRerollUsedDay = today;
          GameStorage.rtSet(gameId, "cloud", "character/" + myTokenId + "/_freeRerollUsedDay", today);
          delete rewardDraftById[id];
          renderRewardDetail(id, entry);
        });
        detail.appendChild(redrawBtn);
      }
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
    // 共享獎勵池（Task 14b，2026-09-08改版成投票制）：跟個人pendingRewards是完全不同的
    // 兩套資料來源，一併算進「有沒有東西要顯示/要不要自動彈出」的判斷，但
    // selectedRewardId/detail面板只服務個人清單——共享池項目走揭示→投票的流程（見下方），
    // 沒有這層detail面板。
    var sharedEntries = collectUnresolvedSharedRewards();
    var sharedKey = sharedEntries
      .map(function (s) {
        return s.pointId + ":" + s.rewardId;
      })
      .sort()
      .join(",");
    var idsKey = unresolvedIds.slice().sort().join(",") + "|" + sharedKey;
    if (idsKey !== lastRewardIdsKey) {
      lastRewardIdsKey = idsKey;
      rewardModalDismissed = false; // 有新的未解決獎勵(個人或共享)時，重新自動彈出
    }
    var modal = el("midnight-reward-modal");
    if (!modal) return;
    if ((!unresolvedIds.length && !sharedEntries.length) || rewardModalDismissed) {
      modal.hidden = true;
      return;
    }
    modal.hidden = false;
    var personalListEl = el("midnight-reward-list-personal");
    var sharedListEl = el("midnight-reward-list-shared");
    personalListEl.innerHTML = "";
    sharedListEl.innerHTML = "";
    unresolvedIds.forEach(function (id) {
      var entry = list[id];
      var li = document.createElement("li");
      var btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = rewardEntryLabel(entry);
      // 選取高亮（2026-09-10使用者明確要求）：沿用style.css新增的.midnight-reward-item-selected，
      // 共享池項目用同一個class，兩邊視覺一致。
      if (selectedRewardId === id) btn.className = "midnight-reward-item-selected";
      btn.addEventListener("click", function () {
        selectedRewardId = id;
        selectedSharedRewardKey = null;
        renderRewardModal();
      });
      li.appendChild(btn);
      personalListEl.appendChild(li);
    });
    // 共享池項目（2026-09-08改版，使用者明確規格「顯示每一個項目 按下後會顯示抽到甚麼...
    // 玩家須投票拿取或不拿取 所有人都投票後抽出拿取人中一人才領取到獎勵」）：取代原本
    // 「看到就能直接領」的first-writer-wins。三種畫面狀態：
    //   ①entry.drawn為null——只顯示種類文字，按下呼叫revealSharedReward()揭示具體品項。
    //   ②已揭示、自己（mySlot）尚未投票——顯示具體品項名稱＋[拿取]/[不拿取]兩顆按鈕。
    //   ③已揭示、自己已投票——顯示具體品項名稱＋目前已投票人數/總參與人數的等待文字，
    //     不能重複投票（實際贏家判定與套用見maybeResolveSharedRewardVote()，每幀輪詢）。
    sharedEntries.forEach(function (shared) {
      var li = document.createElement("li");
      var entry = shared.entry;
      var drawn = entry.drawn;
      var sharedKey = shared.pointId + ":" + shared.rewardId;
      // 2026-09-10：標籤改成可點選的按鈕（跟個人清單同一種互動），按下後在右側detail
      // 顯示這筆共享獎勵的完整資訊（武器沿用renderWeaponSheetDetail()）。
      var label = document.createElement("button");
      label.type = "button";
      label.textContent = drawn ? sharedRewardDrawLabel(entry, drawn) : rewardEntryLabel(entry);
      if (selectedSharedRewardKey === sharedKey) label.className = "midnight-reward-item-selected";
      label.addEventListener("click", function () {
        selectedSharedRewardKey = sharedKey;
        selectedRewardId = null;
        renderRewardModal();
      });
      li.appendChild(label);
      if (!drawn) {
        var revealBtn = document.createElement("button");
        revealBtn.type = "button";
        revealBtn.textContent = window.I18N.t("midnight_reward_shared_reveal_button");
        revealBtn.addEventListener("click", function () {
          revealSharedReward(shared.pointId, shared.rewardId);
        });
        li.appendChild(revealBtn);
      } else {
        var trigForVote = fieldTriggers[shared.pointId];
        var isParticipant = !!(mySlot && trigForVote && trigForVote.participants && trigForVote.participants[mySlot]);
        var myVote = mySlot && entry.votes ? entry.votes[mySlot] : null;
        if (isParticipant && !myVote) {
          var takeBtn = document.createElement("button");
          takeBtn.type = "button";
          takeBtn.textContent = window.I18N.t("midnight_reward_shared_take_button");
          takeBtn.addEventListener("click", function () {
            voteSharedReward(shared.pointId, shared.rewardId, "take");
          });
          li.appendChild(takeBtn);
          var passBtn = document.createElement("button");
          passBtn.type = "button";
          passBtn.textContent = window.I18N.t("midnight_reward_shared_pass_button");
          passBtn.addEventListener("click", function () {
            voteSharedReward(shared.pointId, shared.rewardId, "pass");
          });
          li.appendChild(passBtn);
        } else {
          var votedCount = Object.keys(entry.votes || {}).length;
          var totalCount = Object.keys((trigForVote && trigForVote.participants) || {}).length;
          var statusNote = document.createElement("span");
          statusNote.className = "warning-text";
          statusNote.textContent = myVote
            ? window.I18N.t("midnight_reward_shared_vote_waiting_note", { voted: votedCount, total: totalCount })
            : window.I18N.t("midnight_reward_shared_note");
          li.appendChild(statusNote);
        }
      }
      sharedListEl.appendChild(li);
    });
    // 2026-09-10：detail面板由「個人清單獨佔」改成個人／共享二選一（見
    // selectedSharedRewardKey說明）。選取的共享項目仍存在時優先顯示它；否則退回個人清單
    // 的既有行為（沒有明確選取就自動選第一筆）。
    var selectedShared = null;
    if (selectedSharedRewardKey) {
      sharedEntries.forEach(function (s) {
        if (s.pointId + ":" + s.rewardId === selectedSharedRewardKey) selectedShared = s;
      });
      if (!selectedShared) selectedSharedRewardKey = null; // 已經被別人領走/解決
    }
    if (selectedShared) {
      renderSharedRewardDetail(selectedShared);
      return;
    }
    if (!unresolvedIds.length) {
      // 個人清單目前沒有未解決項目(可能只有共享池項目)：清空detail面板，避免殘留上一次
      // 選取的個人獎勵detail內容。
      selectedRewardId = null;
      el("midnight-reward-detail").innerHTML = "";
      return;
    }
    if (!selectedRewardId || !list[selectedRewardId] || list[selectedRewardId].resolved) {
      selectedRewardId = unresolvedIds[0];
    }
    renderRewardDetail(selectedRewardId, list[selectedRewardId]);
  }

  // 共享池項目的右側詳細資訊（2026-09-10新增，使用者明確要求「獎勵清單抽選的物品也要
  // 詳細顯示其武器資訊，其武器的戰技魔術與祈禱」）：跟個人清單的renderRewardDetail()
  // 是兩條不同的資料來源（共享池的抽選結果已經persist在entry.drawn，不是本地draft），
  // 但顯示用的元件完全共用——武器一律走renderWeaponSheetDetail()（含稀有度色點/傷害估算/
  // 威力補正/戰技/戰技B），裝飾品與消耗品顯示名稱＋效果本文。
  // 尚未揭示（drawn為null）時只顯示種類文字與提示，不預先偷看抽選結果。
  function renderSharedRewardDetail(shared) {
    var detail = el("midnight-reward-detail");
    detail.innerHTML = "";
    var entry = shared.entry;
    var drawn = entry.drawn;
    var titleP = document.createElement("p");
    titleP.textContent = sharedRewardDrawLabel(entry, drawn);
    detail.appendChild(titleP);
    if (!drawn) {
      var note = document.createElement("p");
      note.className = "warning-text";
      note.textContent = window.I18N.t("midnight_reward_shared_note");
      detail.appendChild(note);
      return;
    }
    var c = characters[myTokenId];
    if ((entry.kind === "weapon" || entry.kind === "weaponStar") && drawn.weaponId && c) {
      renderWeaponSheetDetail(detail, c, drawn.weaponId, window.PriTestCharacterDrawer);
      return;
    }
    if (entry.kind === "talisman" && drawn.talismanId) {
      var t = window.PriTestTalismans.get(drawn.talismanId);
      if (t && t.body) {
        var tBody = document.createElement("p");
        tBody.textContent = mnText(window.PriTestTalismans.localizedText(t.body), window.PriTestTalismans.localizedText(t.name));
        detail.appendChild(tBody);
      }
      return;
    }
    var itemId = drawn.itemId || (entry.kind === "stoneswordKey" ? "item_stonesword_key" : entry.kind === "smithingStone" ? "item_smithing_stone" : null);
    if (itemId) {
      var item = window.PriTestConsumables.get(itemId);
      if (item && item.body) {
        var iBody = document.createElement("p");
        iBody.textContent = mnText(window.PriTestConsumables.localizedText(item.body), window.PriTestConsumables.localizedText(item.name));
        detail.appendChild(iBody);
      }
    }
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

  // 戰技重抽鍛造台（設計文件§3.5，Task 13新增）：跟商人的鍛冶合稀有度強化面板（見上方
  // renderMerchantForgeList()）完全分開，是不同功能——這裡改的是c.weaponRandomSkills裡的
  // random戰技枠，不是武器稀有度。weaponRerollState為null時渲染清單模式；選定武器/枠後固定
  // 該筆＋顯示[使用]；[使用]呼叫CD.rerollWeaponSkill()後才顯示新舊比較＋[套用]/[保留並離開]。
  // 三個既有character_drawer.js函式的實際簽章（已於實作前逐一讀取原始碼確認，跟一開始
  // brief猜測的欄位名稱不完全相同）：
  //   listRerollableWeaponSkillSlots(c) → [{weaponId, slot, weaponName(已本地化字串),
  //     currentSkillId}]
  //   rerollWeaponSkill(c, weaponId, slot) → {oldSkillId, newSkillId, dice} | null
  //     （不是{oldLabel,newLabel}現成文字，要另外用CD.resolveRandomSkillDisplay(skillId)
  //     換算成{name,body,kind}才能顯示戰技名稱——跟weaponSkillRefName()裡random分支同一套
  //     helper，見character_drawer.js:2117-2123）
  //   commitWeaponSkillReroll(c, weaponId, slot, skillId) → 直接寫入c.weaponRandomSkills，
  //     無回傳值
  var weaponRerollState = null; // { weaponId, slot, weaponName, rerollResult:{oldSkillId,newSkillId,dice}|null } | null
  // [保留並離開]的二段式確認狀態（跟原本三步驟「離開」型confirm同一種節奏，比照
  // handleLateJoinFieldClick等既有setTimeout用法）：第一次按只顯示警告，3秒內沒有第二次
  // 點擊就視同取消、狀態重置。
  var weaponRerollLeaveArmed = false;
  var weaponRerollLeaveTimer = null;

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
    bodyEl.textContent = mnText(CharacterTypes.localizedText(candidate.effect.body), CharacterTypes.localizedText(candidate.effect.name));
    card.appendChild(bodyEl);

    // 2026-09-11改版（使用者明確規格「跳出另外的視窗讓玩家選擇屬性的按鈕 並且多一個
    // 隨機按鈕由系統決定」）：原本是卡片內的<select>，改成按[習得]後彈出選擇視窗
    // （openRelicChoiceModal()）。選項資料來源不變，仍是
    // CharacterDrawer.relicChoiceConfigForEffect()（RELIC_CHOICE_CONFIG_BY_NAME）。
    var choiceConfig = CD.relicChoiceConfigForEffect(candidate.effect);

    var learnBtn = document.createElement("button");
    learnBtn.type = "button";
    learnBtn.textContent = window.I18N.t("relic_learn_button");
    learnBtn.addEventListener("click", function () {
      if (choiceConfig) {
        openRelicChoiceModal(candidate, choiceConfig, CD, CharacterTypes);
        return;
      }
      commitRelicLearn(candidate, null, CD);
    });
    card.appendChild(learnBtn);
    container.appendChild(card);
  }

  function commitRelicLearn(candidate, pickedOption, CD) {
    var c = characters[myTokenId];
    if (!c) return;
    CD.learnRelicEffect(c, candidate, pickedOption);
    GameStorage.rtSet(gameId, "cloud", "character/" + myTokenId, c);
    midnightRelicRolledDice = null;
    renderCharacterSheet();
  }

  // 遺物效果的「習得時選擇1種屬性／異常／武器」視窗：每個選項一顆按鈕，外加一顆
  // [隨機決定]（傳入null給CharacterDrawer.learnRelicEffect()，由它既有的
  // assignRelicChoiceIfNeeded() 隨機指派，見 CLAUDE.md §24）。
  function openRelicChoiceModal(candidate, choiceConfig, CD, CharacterTypes) {
    var modal = el("midnight-relic-choice-modal");
    if (!modal) return;
    el("midnight-relic-choice-title").textContent = CharacterTypes.localizedText(candidate.effect.name);
    var box = el("midnight-relic-choice-options");
    box.innerHTML = "";
    choiceConfig.options.forEach(function (opt) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = CharacterTypes.localizedText(opt);
      btn.addEventListener("click", function () {
        modal.hidden = true;
        commitRelicLearn(candidate, opt, CD);
      });
      box.appendChild(btn);
    });
    var randomBtn = document.createElement("button");
    randomBtn.type = "button";
    randomBtn.className = "midnight-relic-choice-random";
    randomBtn.textContent = window.I18N.t("relic_choice_random_option");
    randomBtn.addEventListener("click", function () {
      modal.hidden = true;
      commitRelicLearn(candidate, null, CD);
    });
    box.appendChild(randomBtn);
    modal.hidden = false;
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

    // 2026-09-08使用者明確規格「習得遺物效果按下抽選後，不再出現抽選，除非選擇一項學習」：
    // 已經有pending未學習的候選（midnightRelicRolledDice非null）時，按鈕連帶disabled，
    // 避免使用者連按抽選來挑喜歡的骰目——見下方handleMidnightRelicRoll()的同款guard。
    el("btn-midnight-sheet-relic-roll").disabled = learned >= maxLearnable || !!midnightRelicRolledDice;
    var diceEl = el("midnight-character-sheet-relic-dice");
    if (midnightRelicRolledDice) CD.renderDiceDisplay(diceEl, [midnightRelicRolledDice.x, midnightRelicRolledDice.y]);
    else diceEl.innerHTML = "";

    renderMidnightRelicCandidates(c, type, CD, CharacterTypes);
  }

  // 2026-09-08使用者明確規格「習得遺物效果按下抽選後，不再出現抽選，除非選擇一項學習
  // （即不能重複抽選來挑）」：已經有pending未學習的候選時直接no-op，只有renderMidnightRelicCandidateCard()
  // 的[習得]按鈕（見上方）真正選了一項並呼叫CD.learnRelicEffect()後才會把
  // midnightRelicRolledDice清回null，允許下一次抽選。
  function handleMidnightRelicRoll() {
    var c = characters[myTokenId];
    var CD = window.PriTestCharacterDrawer;
    if (!c || !c.typeId) return;
    if (midnightRelicRolledDice) return;
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
    // 2026-09-10：顯示值改用effectiveCheckDiceCount()，跟實際擲骰顆數同一個來源，
    // 「學習能力（精神／運氣／體能）」遺物效果的+1會反映在畫面上（先前只顯示類型基本值）。
    var checkValues = type ? type.checkValues : null;
    el("midnight-character-sheet-checkvalues").textContent = checkValues
      ? window.I18N.t("midnight_character_sheet_checkvalues", {
          mental: effectiveCheckDiceCount(c, "mental"),
          luck: effectiveCheckDiceCount(c, "luck"),
          physical: effectiveCheckDiceCount(c, "physical"),
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
    renderWeaponRerollOpenButton(c);
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

  // 鍛造台開啟按鈕（2026-09-08從角色面板搬到#midnight-hud-top-right，見midnight_page.py
  // 說明）：文字帶剩餘可重抽次數，c._weaponRerollCredits為0（含未設定）時disabled。這個
  // button是computeRewardDraw()的weaponSkillReroll kind給的點數唯一的消費入口（2026-09-09
  // 改版，原本是grantLootRewardEntryToCharacter()，該函式已移除）。2026-09-08使用者明確
  // 規格「不放在腳色視窗內，在離開鍛造村範圍後直接歸0無法使用」：額外只在
  // nearbySmithingVillage（見updateNearbyFieldPoint()）非null時才顯示。
  function renderWeaponRerollOpenButton(c) {
    var btn = el("btn-midnight-open-weapon-reroll");
    if (!btn) return;
    btn.hidden = !nearbySmithingVillage;
    var credits = (c && c._weaponRerollCredits) || 0;
    btn.disabled = credits <= 0;
    btn.textContent = window.I18N.t("midnight_weapon_reroll_open_button", { count: credits });
  }

  // 開啟鍛造台：credits為0時直接no-op（按鈕本身也是disabled，這裡是防禦性二次確認，
  // 例如鍵盤操作繞過disabled屬性的邊角情形）。每次開啟都重置選取/確認狀態，避免殘留
  // 上一次操作到一半的畫面。
  function openWeaponRerollModal() {
    var c = characters[myTokenId];
    if (!c || !((c._weaponRerollCredits || 0) > 0) || !nearbySmithingVillage) return;
    weaponRerollState = null;
    weaponRerollLeaveArmed = false;
    if (weaponRerollLeaveTimer) {
      clearTimeout(weaponRerollLeaveTimer);
      weaponRerollLeaveTimer = null;
    }
    el("midnight-weapon-reroll-leave-note").hidden = true;
    renderWeaponRerollModal();
    el("midnight-weapon-reroll-modal").hidden = false;
  }

  function closeWeaponRerollModal() {
    el("midnight-weapon-reroll-modal").hidden = true;
    el("midnight-weapon-reroll-leave-note").hidden = true;
    weaponRerollState = null;
    weaponRerollLeaveArmed = false;
    if (weaponRerollLeaveTimer) {
      clearTimeout(weaponRerollLeaveTimer);
      weaponRerollLeaveTimer = null;
    }
  }

  // 三種畫面狀態：①未選定武器/枠——只列清單。②已選定、尚未[使用]——清單區改顯示固定
  // 卡片＋[使用]。③已[使用]——額外顯示新舊比較＋[套用]/[保留並離開]。[保留並離開]刻意
  // 在①②③都顯示（不是只有③才有）：它是整個鍛造台唯一的離開手段，語意上「保留」在還沒
  // [使用]時就是單純的「離開」（沒有可放棄的暫存結果）。
  // 2026-09-08新增：c._weaponRerollPending存放「已經[使用]過、尚未[套用]或[保留並離開]」的
  // 暫存抽選結果，跟character_drawer.js內部的weaponSkillSlotKey()是各自獨立的key（那個
  // 是「已套用」的c.weaponRandomSkills專用，語意不同，這裡不重用避免混淆兩種完全不同的
  // 生命週期）。
  function weaponRerollPendingKey(weaponId, slot) {
    return weaponId + ":" + slot;
  }

  function renderWeaponRerollModal() {
    var CD = window.PriTestCharacterDrawer;
    var c = characters[myTokenId];
    var listEl = el("midnight-weapon-reroll-list");
    var useBtn = el("btn-midnight-weapon-reroll-use");
    var applyBtn = el("btn-midnight-weapon-reroll-apply");
    listEl.innerHTML = "";

    if (!weaponRerollState) {
      (c ? CD.listRerollableWeaponSkillSlots(c) : []).forEach(function (slotInfo) {
        var currentDisplay = CD.resolveRandomSkillDisplay(slotInfo.currentSkillId);
        var btn = document.createElement("button");
        btn.type = "button";
        btn.textContent =
          slotInfo.weaponName + "　" + (currentDisplay ? currentDisplay.name : window.I18N.t("midnight_weapon_reroll_undetermined_note"));
        btn.addEventListener("click", function () {
          // 2026-09-08使用者明確規格「抽完該武器後 即使保存離開再次開啟 仍舊是該戰技二選一
          // （即為一次定結果 不得重新抽選亂數）」：CD.rerollWeaponSkill()本身每次呼叫都是
          // 真隨機、沒有記憶性，因此改成這裡先查c._weaponRerollPending是否已經有這個
          // 武器/枠的暫存結果（見weaponRerollPendingKey()），有的話直接還原成③比較畫面，
          // 不重新呼叫[使用]／不重新擲骰；沒有才回到②等待按[使用]。
          var pendingKey = weaponRerollPendingKey(slotInfo.weaponId, slotInfo.slot);
          var pendingResult = c && c._weaponRerollPending && c._weaponRerollPending[pendingKey];
          weaponRerollState = {
            weaponId: slotInfo.weaponId,
            slot: slotInfo.slot,
            weaponName: slotInfo.weaponName,
            rerollResult: pendingResult || null,
          };
          renderWeaponRerollModal();
        });
        listEl.appendChild(btn);
      });
      el("midnight-weapon-reroll-compare").hidden = true;
      useBtn.hidden = true;
      applyBtn.hidden = true;
      return;
    }

    // 選定卡片「貼」在鍛造台下方（純UI呈現的高亮卡片，見設計文件§3.5步驟2）。
    // 2026-09-10（使用者明確要求「鍛造台，抽選等等也為要詳細顯示新舊戰技」）：卡片內
    // 除了武器名稱，再附上這把武器的完整資訊（renderWeaponSheetDetail()，含稀有度/傷害
    // 估算/威力補正/現有戰技），玩家選枠時就能判斷這把武器值不值得花掉重抽次數。
    var pinned = document.createElement("div");
    pinned.className = "midnight-forge-pinned-weapon";
    var pinnedName = document.createElement("p");
    pinnedName.textContent = weaponRerollState.weaponName;
    pinned.appendChild(pinnedName);
    if (c) renderWeaponSheetDetail(pinned, c, weaponRerollState.weaponId, CD);
    listEl.appendChild(pinned);

    var hasResult = !!weaponRerollState.rerollResult;
    el("midnight-weapon-reroll-compare").hidden = !hasResult;
    useBtn.hidden = hasResult;
    applyBtn.hidden = !hasResult;
    if (hasResult) {
      var oldDisplay = CD.resolveRandomSkillDisplay(weaponRerollState.rerollResult.oldSkillId);
      var newDisplay = CD.resolveRandomSkillDisplay(weaponRerollState.rerollResult.newSkillId);
      // 2026-09-08使用者明確規格「使用時抽到的戰技需要完整顯示資訊」＋2026-09-10「詳細
      // 顯示新舊戰技」：名稱＋種類＋規則本文之外，Action類戰技再附上跟武器詳細資訊同一套
      // 的估計傷害黃字（appendWeaponSheetSkillEntry()），讓新舊比較能直接比數值。
      // 舊戰技可能是null（這個枠原本就還沒決定過），此時顯示「尚未決定」而不是空白。
      var artInfoForge = CD.computeArtPower(c, weaponRerollState.weaponId);
      var weaponForge = Weapons.get(baseCatalogId(weaponRerollState.weaponId));
      var categoryForge = weaponForge && Weapons.getCategory(weaponForge.category);
      var isSpellForge = !!(categoryForge && (categoryForge.id === "staff" || categoryForge.id === "sacred_seal"));
      [
        { el: el("midnight-weapon-reroll-compare-old"), display: oldDisplay },
        { el: el("midnight-weapon-reroll-compare-new"), display: newDisplay },
      ].forEach(function (col) {
        col.el.innerHTML = "";
        if (!col.display) {
          var emptyP = document.createElement("p");
          emptyP.textContent = window.I18N.t("midnight_weapon_reroll_undetermined_note");
          col.el.appendChild(emptyP);
          return;
        }
        appendWeaponSheetSkillEntry(
          col.el,
          col.display.name + (col.display.kind ? "［" + col.display.kind + "］" : ""),
          col.display.body || "",
          artInfoForge,
          isSpellForge,
          CD
        );
      });
    }
  }

  // [使用]：呼叫CD.rerollWeaponSkill()重抽一次（純計算，尚未寫回角色）。理論上不會回傳
  // null（listRerollableWeaponSkillSlots只列出確實是random枠的項目，resolveRandomSkillForItem
  // 對應同一份category資料一定能解析），這裡的null guard只是防禦性寫法，不代表有已知的
  // 失敗情境。
  function handleWeaponRerollUseClick() {
    if (!weaponRerollState || weaponRerollState.rerollResult) return;
    var c = characters[myTokenId];
    if (!c) return;
    var result = window.PriTestCharacterDrawer.rerollWeaponSkill(c, weaponRerollState.weaponId, weaponRerollState.slot);
    if (!result) return;
    weaponRerollState.rerollResult = result;
    // 2026-09-08使用者明確規格「一次定結果 不得重新抽選亂數」：把這次[使用]的結果存進
    // c._weaponRerollPending（見weaponRerollPendingKey()），之後不管保存離開再重新開啟、
    // 或整頁重整，同一個武器/枠都會直接還原成這個結果，不會再呼叫CD.rerollWeaponSkill()
    // 重新擲骰——只有[套用]（真正提交後清掉這筆）才會讓該武器/枠恢復成可以再次[使用]。
    var pendingKey = weaponRerollPendingKey(weaponRerollState.weaponId, weaponRerollState.slot);
    c._weaponRerollPending = c._weaponRerollPending || {};
    c._weaponRerollPending[pendingKey] = result;
    GameStorage.rtSet(gameId, "cloud", "character/" + myTokenId + "/_weaponRerollPending/" + pendingKey, result);
    renderWeaponRerollModal();
  }

  // [套用]：真正寫回角色（CD.commitWeaponSkillReroll）並扣1點_weaponRerollCredits——這是
  // _weaponRerollCredits唯一會被扣減的地方（[保留並離開]／逾時取消都不會消耗點數，見
  // handleWeaponRerollKeepAndLeaveClick）。寫回後同步RTDB並更新角色面板（鍛造台開啟按鈕
  // 的剩餘次數文字要跟著變）。2026-09-08新增：同時清掉c._weaponRerollPending裡這個
  // 武器/枠的暫存結果——已經真正套用了，該武器/枠恢復成可以再次[使用]抽新的。
  function handleWeaponRerollApplyClick() {
    if (!weaponRerollState || !weaponRerollState.rerollResult) return;
    var c = characters[myTokenId];
    if (!c) return;
    window.PriTestCharacterDrawer.commitWeaponSkillReroll(
      c,
      weaponRerollState.weaponId,
      weaponRerollState.slot,
      weaponRerollState.rerollResult.newSkillId
    );
    c._weaponRerollCredits = Math.max(0, (c._weaponRerollCredits || 0) - 1);
    var pendingKey = weaponRerollPendingKey(weaponRerollState.weaponId, weaponRerollState.slot);
    if (c._weaponRerollPending) delete c._weaponRerollPending[pendingKey];
    GameStorage.rtSet(gameId, "cloud", "character/" + myTokenId, c);
    closeWeaponRerollModal();
    renderCharacterSheet();
  }

  // [保留並離開]：不寫回角色、不扣點數，只是關閉modal——2026-09-08使用者明確規格「一次
  // 定結果 不得重新抽選亂數」之後，已經[使用]過的結果（c._weaponRerollPending）不會在這裡
  // 被清掉，之後重新開啟同一個武器/枠會直接還原同一組結果（見上方選武器/枠的click
  // handler），不是「放棄」，是「先保留、之後再決定要不要套用」。二段式確認（設計文件
  // §3.5）——第一次按只顯示黃字警告（不關閉modal）；同一按鈕3秒內再按一次才真正
  // closeWeaponRerollModal()；逾時（3秒內沒有第二次點擊）視同取消提醒、狀態重置，下次按
  // [保留並離開]重新從第一次點擊開始算。
  function handleWeaponRerollKeepAndLeaveClick() {
    if (!weaponRerollLeaveArmed) {
      weaponRerollLeaveArmed = true;
      el("midnight-weapon-reroll-leave-note").hidden = false;
      if (weaponRerollLeaveTimer) clearTimeout(weaponRerollLeaveTimer);
      weaponRerollLeaveTimer = setTimeout(function () {
        weaponRerollLeaveArmed = false;
        weaponRerollLeaveTimer = null;
        el("midnight-weapon-reroll-leave-note").hidden = true;
      }, 3000);
      return;
    }
    clearTimeout(weaponRerollLeaveTimer);
    weaponRerollLeaveTimer = null;
    closeWeaponRerollModal();
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
      bodyP.textContent = mnText(body, name);
      container.appendChild(bodyP);
    }
  }

  // 2026-09-10新增（使用者明確要求「獎勵清單抽選的物品也要詳細顯示其武器資訊，其武器的
  // 戰技魔術與祈禱」）：依weaponId解析「這把武器自己的戰技」，不要求該武器已被持有或裝備。
  // 原本renderWeaponSheetDetail()的〔戰技〕區塊是用CD.getEquippedWeaponSkillEntries(c)
  // （只掃c.equippedWeaponIds），因此獎勵剛抽到的新武器、以及角色視窗裡點選「未裝備」的
  // 武器，戰技區塊永遠是空的——杖/聖印的魔術/祈禱也一樣看不到。
  // 資料來源與規則判斷完全沿用character_drawer.js既有純函式（collectWeaponSkillRefs／
  // weaponSkillSlotKey／resolveRandomSkillDisplay／resolveWeaponSkillDisplay），不在這裡
  // 另外解析weapon.skills。
  // random戰技枠：已決定（c.weaponRandomSkills有值）就顯示該戰技；尚未決定則回傳
  // undetermined:true的條目，由呼叫端顯示「未決定」而不是靜默略過——玩家至少要看得出
  // 「這把武器有一個戰技枠還沒決定」，這是既有UI完全沒有揭露的資訊。
  // randomOverrideSkillId（可省略）：這把武器的random戰技枠「這次抽選已經決定、但還沒
  // 寫進角色」時傳入（潛在之力的得意武器抽選就是這種狀態，見
  // CharacterDrawer.potentialPowerDrawWeapon()回傳的skillId）——讓玩家在按下[選擇這個]
  // 之前就看得到會拿到哪個戰技，而不是顯示「未決定」。
  function weaponOwnSkillDisplays(c, weaponId, randomOverrideSkillId) {
    var CD = window.PriTestCharacterDrawer;
    var w = Weapons.get(baseCatalogId(weaponId));
    if (!w) return [];
    var category = Weapons.getCategory(w.category);
    var out = [];
    CD.collectWeaponSkillRefs(category, w).forEach(function (pair) {
      if (pair.ref.kind === "random") {
        var resolved =
          (c && c.weaponRandomSkills && c.weaponRandomSkills[CD.weaponSkillSlotKey(weaponId, pair.slotKey)]) || randomOverrideSkillId || null;
        if (!resolved) {
          out.push({ name: window.I18N.t("midnight_weapon_random_skill_undetermined"), body: "", kind: null, undetermined: true });
          return;
        }
        var display = CD.resolveRandomSkillDisplay(resolved);
        if (display) out.push({ name: display.name, body: display.body, kind: display.kind, undetermined: false });
        return;
      }
      var d = CD.resolveWeaponSkillDisplay(pair.ref);
      if (d && (d.name || d.body)) out.push({ name: d.name, body: d.body, kind: d.kind, undetermined: false });
    });
    // 共通戰技（玩家後天附加在這把武器上的，例如塗脂/獎勵取得）沿用既有欄位，
    // 跟getEquippedWeaponSkillEntries()一樣一併納入。
    ((c && c.weaponExtraSkills && c.weaponExtraSkills[weaponId]) || []).forEach(function (ref) {
      var d2 = CD.resolveWeaponSkillDisplay(ref);
      if (d2 && (d2.name || d2.body)) out.push({ name: d2.name, body: d2.body, kind: d2.kind, undetermined: false });
    });
    return out;
  }

  // 角色視窗武器詳細資訊（2026-09-06使用者明確規格大改版）：顯示順序統一為
  // 名稱（稀有度色點）→傷害估算黃字→威力補正→連擊特典→戰技→戰技B，比照night.js既有的
  // renderWeaponCard()資料來源與判斷方式（category.twoHitBonus／weaponOwnSkillDisplays／
  // weaponAccumulationEffects／resolveWeaponSkillDisplay），不重新定義任何規則數值，
  // 只是換一種版面排列。
  // randomOverrideSkillId（可省略）：直接轉交給weaponOwnSkillDisplays()，見該函式說明。
  function renderWeaponSheetDetail(detail, c, weaponId, CD, randomOverrideSkillId) {
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
    bodyEl.textContent = mnText(Weapons_.localizedText(w.body || {}), Weapons_.localizedText(w.name));
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
        bonusP.textContent =
          Weapons_.localizedText(bonus.name) + window.I18N.t("colon_separator") + mnText(Weapons_.localizedText(bonus.body), Weapons_.localizedText(bonus.name));
        detail.appendChild(bonusP);
      });
    }

    // [戰技]：這把武器的Action類戰技（杖/聖印則是魔術/祈禱），逐一附上估計傷害黃字＋本文。
    // 2026-09-10改用weaponOwnSkillDisplays()（見該函式說明）：改成依weaponId解析武器自己的
    // 戰技，未持有／未裝備的武器（獎勵剛抽到的那把）也看得到完整戰技，取代原本只查
    // c.equippedWeaponIds的CD.getEquippedWeaponSkillEntries()。
    var ownSkills = weaponOwnSkillDisplays(c, weaponId, randomOverrideSkillId);
    var actionSkills = ownSkills.filter(function (d) {
      return d.undetermined || d.kind === "Action";
    });
    if (actionSkills.length) {
      var skillATitle = document.createElement("p");
      skillATitle.className = "boss-subheading";
      skillATitle.textContent = window.I18N.t("midnight_character_sheet_skill_a_label");
      detail.appendChild(skillATitle);
      var isSpellCategory = !!(category && (category.id === "staff" || category.id === "sacred_seal"));
      actionSkills.forEach(function (d) {
        appendWeaponSheetSkillEntry(detail, d.name, d.body, artInfo, isSpellCategory, CD);
      });
    }

    // [戰技B]：盾的附著效果/逆位戰技，或一般武器的屬性/異常附著技能，加上共通戰技
    // （weaponExtraSkills）統一併成同一區塊（使用者明確規格「另外的戰技或是附著的
    // 共通戰技等等」）。"random"種類尚未擲骰決定的空槽直接跳過（沒有名稱/本文可顯示，
    // 跟weaponAccumulationEffects()既有做法一致，不發明尚未決定的內容）。
    // 排除kind==="Action"與未決定枠（已經在上面[戰技]區塊列過，例如一般武器/盾的逆位戰技
    // 也可能是Action類），避免同一個技能在[戰技]跟[戰技B]重複出現兩次。2026-09-10跟上面的
    // [戰技]區塊改用同一份weaponOwnSkillDisplays()結果，不再各自重新解析一次weapon.skills。
    var resolvedSkillB = ownSkills.filter(function (d) {
      return !d.undetermined && d.kind !== "Action" && (d.name || d.body);
    });
    if (resolvedSkillB.length) {
      var skillBTitle = document.createElement("p");
      skillBTitle.className = "boss-subheading";
      skillBTitle.textContent = window.I18N.t("midnight_character_sheet_skill_b_label");
      detail.appendChild(skillBTitle);
      resolvedSkillB.forEach(function (d) {
        var entryP = document.createElement("p");
        entryP.className = "threat-ref-body";
        entryP.textContent = d.name + (d.body ? window.I18N.t("colon_separator") + mnText(d.body, d.name) : "");
        detail.appendChild(entryP);
      });
    }
  }

  // 右側detail：武器/消耗品/裝飾品是持有物，額外顯示【裝備】【丟棄】；技能/技藝/被動/
  // 遺物效果/附帶效果是唯讀規則說明，只顯示name+body（見計畫書「持有物 vs 規則說明」
  // 的區分）。
  // 可切換型遺物效果（2026-09-11使用者明確規格）：效果名稱 → 角色物件上的開關欄位。
  // 開啟時才改變既有行為，關閉（預設）時完全維持原本流程。
  //   聖杯瓶可回復FP：聖杯瓶改成回FP而不是回HP
  //   一口氣飲盡　　：聖杯瓶一次消耗2次使用次數，改為把HP回滿
  var RELIC_TOGGLE_FIELDS = [
    { key: "flaskFp", field: "_flaskFpMode" },
    { key: "flaskGulp", field: "_flaskGulpMode" },
  ];

  function relicToggleFieldForEffect(effect) {
    var nameZh = (effect.name && effect.name.zh) || "";
    var nameJa = (effect.name && effect.name.ja) || "";
    for (var i = 0; i < RELIC_TOGGLE_FIELDS.length; i++) {
      var names = RELIC[RELIC_TOGGLE_FIELDS[i].key];
      if (names.indexOf(nameZh) !== -1 || names.indexOf(nameJa) !== -1) return RELIC_TOGGLE_FIELDS[i].field;
    }
    return null;
  }

  function appendRelicToggle(detail, c, effect) {
    var field = relicToggleFieldForEffect(effect);
    if (!field || !c) return;
    var on = !!c[field];
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "midnight-relic-toggle" + (on ? " midnight-relic-toggle-on" : "");
    btn.textContent = window.I18N.t(on ? "midnight_relic_toggle_on" : "midnight_relic_toggle_off");
    btn.addEventListener("click", function () {
      c[field] = !c[field];
      GameStorage.rtSet(gameId, "cloud", "character/" + myTokenId + "/" + field, c[field]);
      renderCharacterSheet();
    });
    detail.appendChild(btn);
  }

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
      // 規則文本轉換（見mnText()說明）：這個helper是角色視窗右側「技能／技藝／被動／遺物
      // 效果／附帶效果／消耗品／裝飾品」全部唯讀規則說明的共同出口，套在這裡一次即可涵蓋。
      bodyEl.textContent = mnText(body, name);
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
      // 2026-09-11：部分遺物效果是「玩家自己選要不要改變既有行為」的開關（使用者明確
      // 規格「需要在角色視窗中此技能中的詳細來切換，詳細資訊中上方有切換開關」），
      // 因此開關放在名稱/本文之前（上方），見appendRelicToggle()。
      appendRelicToggle(detail, c, effect);
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
  // 2026-09-09合併：上方資訊欄折疊/展開改沿用private/main既有的topBannerCollapsed／
  // updateTopBannerCollapseUI()機制（涵蓋這組全部7個banner，見TOP_BANNER_IDS），不再另外
  // 維護一份只涵蓋2個元素的fieldOverlayCollapsed。
  function renderFieldOverlay() {
    var pt = nearbyFieldPoint || nearbyCastlePoint;
    var enterPrompt = el("midnight-field-enter-prompt");
    var invitePrompt = el("midnight-field-invite-prompt");
    var banner = el("midnight-field-banner");
    // 已加入者的「已加入名單／立即進入」框（2026-09-07新增）：只有邀請中且自己已是
    // participants時才顯示（見下方trig.status==="inviting" && amParticipant分支），
    // 這裡先統一預設收合，避免切換到其他狀態/離開範圍時殘留上一次的內容。
    var inviteStatusBox = el("midnight-field-invite-status");
    inviteStatusBox.hidden = true;
    // 2026-09-08新增：獎勵清單卡住的黃字說明，預設收起，只在下方「trig存在、還有下一層、
    // 但獎勵清單還沒全部關閉」的分支才顯示，見fieldRewardGateOpen()。
    var rewardGateNote = el("midnight-field-reward-gate-note");
    if (rewardGateNote) rewardGateNote.hidden = true;
    // 中途加入按鈕（設計文件§1.4）：獨立於下方pt/trig狀態分支之外決定顯示與否，直接依
    // nearbyLateJoinPoint（已在updateNearbyFieldPoint()排除status==="inviting"與自己已是
    // participant的情況）——這樣即使下面的分支因為trig.status==="inviting"或!pt而提早
    // return，這顆按鈕的顯示狀態仍然每frame都會被正確更新，不會殘留上一個地圖點的狀態。
    // 2026-09-07 review修正：外層#midnight-field-late-join-prompt是套用了position:fixed的
    // 容器（見style.css），真正可點擊的按鈕是內部的#btn-midnight-field-late-join。
    var lateJoinBox = el("midnight-field-late-join-prompt");
    lateJoinBox.hidden = !nearbyLateJoinPoint;
    if (nearbyLateJoinPoint) {
      el("btn-midnight-field-late-join").onclick = function () { handleLateJoinFieldClick(nearbyLateJoinPoint); };
    }
    // 後補領獎按鈕（設計文件§1.5）：跟上面的中途加入按鈕同一套「獨立於pt/trig狀態分支」
    // 的渲染方式——不論下面的分支怎麼early return，這顆按鈕的顯示狀態每frame都會被正確
    // 更新，不會殘留上一個地圖點的狀態。nearbyLateClaimPoint可能是board floor點（found）
    // 也可能是strong_enemy/random_event點（見updateNearbyFieldPoint()的第二段偵測），兩者
    // 用同一顆按鈕與同一個handleLateClaimClick()分派。
    var lateClaimBox = el("midnight-field-late-claim-prompt");
    lateClaimBox.hidden = !nearbyLateClaimPoint;
    if (nearbyLateClaimPoint) {
      el("btn-midnight-field-late-claim").onclick = function () { handleLateClaimClick(nearbyLateClaimPoint); };
    }
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
        var floorCount = fieldFloorCountForCard(pt);
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
        el("midnight-field-late-claim-prompt").hidden = true; // fix(2026-09-09)：同上，邀請倒數期間也要排除
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
        // 已加入名單＋「立即進入」（2026-09-07新增，design§1.2）：只有自己已加入時才會
        // 走到這個分支，直接列出目前participants對應的玩家名稱，並讓自己可以按「立即進入」
        // 提前把inviteDeadline改成現在（見handleForceEnterFieldClick），不需要等剩餘玩家。
        var joinedNames = Object.keys(trig.participants || {}).map(function (slot) {
          return players[slot] && players[slot].name;
        }).filter(Boolean);
        inviteStatusBox.hidden = false;
        inviteStatusBox.querySelector("[data-role=names]").textContent = joinedNames.join("、");
        var forceEnterBtn = inviteStatusBox.querySelector("[data-role=force-enter]");
        forceEnterBtn.disabled = !mySlot || isPaused();
        forceEnterBtn.onclick = function () { handleForceEnterFieldClick(pt); };
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
    el("midnight-field-late-claim-prompt").hidden = true; // fix(2026-09-09)：banner顯示時強制排除late-claim-prompt同時出現，作為第二層保險
    var bannerFloorLabel = window.I18N.t("midnight_field_floor_progress_label", {
      current: (trig.floorIndex || 0) + 1,
      total: fieldFloorCountForCard(pt),
    });
    el("midnight-field-banner-name").textContent = locationName + "（" + bannerFloorLabel + "）";

    // 2026-09-08使用者明確規格「無法繼續前進 直到參加的人都關閉了獎勵清單」：bookkeeping
    // 已經推進到下一層、但fieldTrigger還卡在原地等gate開啟時（見
    // maybeClearFieldTriggerAfterRewardGate()），顯示這行黃字說明。
    var progressForGate = fieldProgress[pt.id];
    if (rewardGateNote) {
      rewardGateNote.hidden = !(
        progressForGate &&
        !progressForGate.cleared &&
        (progressForGate.floorIndex || 0) > (trig.floorIndex || 0) &&
        !fieldRewardGateOpen(pt)
      );
    }

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
        // 2026-09-07新增：即時票數——依trig.votes（席位→選項index）統計目前這個選項有幾票，
        // 讓玩家投票中就能看到目前局勢，不用等到resolved。
        var voteCount = Object.keys(votes).filter(function (slot) {
          return votes[slot] === i;
        }).length;
        var btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = label + window.I18N.t("midnight_field_vote_count_label", { count: voteCount }) + (myVote === i ? " ✓" : "");
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

  // ============================================================================
  // 角色資訊面板／戰鬥面板 render：HP/FP/體力/盧恩/聖杯瓶（自己）、敵人HP（共用標靶）。
  // 其他玩家的HP條在renderOccupiedSlotCard()裡（玩家面板既有機制，不在這裡重複畫）。
  // ============================================================================

  // hideValue（2026-09-08新增，使用者明確規格「debug與測試模式下才顯示敵人血量數值 正常
  // 不顯示數值」）：只影響數字文字，血條長度（視覺比例）維持照常顯示，只有敵人HP條會傳
  // true，自己的HP/體力等其餘既有呼叫點不受影響。
  function setBar(fillId, valueId, current, max, hideValue) {
    var fillEl = el(fillId);
    if (fillEl) {
      var pct = max > 0 ? Math.max(0, Math.min(100, (current / max) * 100)) : 0;
      fillEl.style.width = pct + "%";
    }
    var valueEl = el(valueId);
    if (valueEl) valueEl.textContent = hideValue ? "" : Math.round(current) + "/" + Math.round(max);
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
    // canActNow()（含瀕死判斷，見該函式說明）：瀕死中聖杯瓶/道具/換武器全部鎖住。
    el("btn-midnight-use-flask").disabled = !canActNow() || res.flaskCount <= 0 || flaskReadingUntil !== null;
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
    var actable = canActNow();
    renderWeaponCard("midnight-weapon-left-label", c && c.equippedWeaponIdL, ids);
    renderWeaponCard("midnight-weapon-right-label", c && c.equippedWeaponIdR, ids);
    // 換武器也算「動作」，瀕死中一併鎖住（見canActNow()說明）。
    el("btn-midnight-weapon-left").disabled = !actable;
    el("btn-midnight-weapon-right").disabled = !actable;
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
    el("btn-midnight-use-consumable").disabled = !actable || !inst;
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

  // 戰鬥面板：預設不顯示（沒有遇到敵人時），一旦站在已解決分歧
  // 且敵人仍存活的地圖點旁（activeEncounter），改顯示該點專屬的敵人圖片/名稱/HP——
  // 攻擊/戰技按鈕本身不變，實際打誰由damageCombatTarget()判斷。
  function renderCombatPanel() {
    var usingEncounter = !!activeEncounter;
    // 夜之強敵／夜王戰鬥中不能逃離（見handleFleeBattleClick()上方說明），按鈕直接隱藏。
    var fleeBtn = el("btn-midnight-flee-battle");
    if (fleeBtn) {
      fleeBtn.hidden = activeEncounterIsNightBoss();
      // 瀕死中不能逃離戰鬥（使用者明確規格）：handleFleeBattleClick()本來就有守衛，
      // 這裡讓按鈕本身也直接反白，見canActNow()說明。
      fleeBtn.disabled = !canActNow();
    }
    var hp, max;
    if (usingEncounter) {
      max = enemyRealHpMax(fieldTriggers[activeEncounter.id]);
      var raw = fieldEnemyHp[activeEncounter.id];
      hp = raw === undefined ? max : raw;
    } else {
      hp = demoStats.sharedTarget === undefined ? 20 : demoStats.sharedTarget;
      max = 20;
    }
    // 敵人HP數值只在測試模式顯示（使用者明確規格）。2026-09-09合併：原本private/main
    // 額外用meta.debugMode一起判斷，但Debug模式已與測試模式合併為同一顆按鈕(meta.testMode)，
    // 這裡只留一個條件。
    var showEnemyHpValue = !!(meta && meta.testMode);
    setBar("midnight-enemy-hp-fill", "midnight-enemy-hp-value", hp, max, !showEnemyHpValue);
    // 敵人HP掛在畫面中間下方，只在真正「碰到敵人進入戰鬥」（活躍的地圖點/強敵遭遇戰）
    // 時顯示——使用者明確規格，。
    var hudBottomCenter = el("midnight-hud-bottom-center");
    if (hudBottomCenter) hudBottomCenter.hidden = !usingEncounter;
    var canAct = canActNow();
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
    el("btn-midnight-dodge").disabled = !canAct || stamina.current < dodgeStaminaCost(characters[myTokenId]);
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
    var canAct = canActNow();
    var atkBtn = el(side === "L" ? "btn-midnight-attack-left" : "btn-midnight-attack-shared-target");
    var atkLabelEl = el(side === "L" ? "midnight-attack-left-label" : "midnight-attack-shared-target-label");
    var sideDefs = SORCERY_BUTTON_DEFS.filter(function (def) {
      return def.side === side;
    });
    // 執行者「坩堝諸相・獸」變身中（見beastFormActive()）：借用左右手攻擊鍵改顯示
    // 「襲擊」／「咆哮」，武器/魔術・祈禱按鍵全部隱藏（原文「武器・盾・杖・聖印無法使用」）。
    if (beastFormActive(characters[myTokenId], Date.now())) {
      if (atkBtn) {
        atkBtn.hidden = false;
        atkBtn.disabled = !canAct || stamina.current < (side === "L" ? 3 : 1) * DICE_COUNT_TO_STAMINA_MULT;
      }
      if (atkLabelEl) {
        atkLabelEl.textContent = window.I18N.t(side === "L" ? "midnight_crucible_assault_button" : "midnight_crucible_roar_button");
      }
      sideDefs.forEach(hideSpellButton);
      return;
    }
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
    if (!mySlot || isPaused() || isSelfDowned()) return; // 觀戰者／暫停中不能操作
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
    if (!mySlot || isPaused() || !mapExpanded || introActive(now) || isSelfDowned()) return;
    // 2026-09-06使用者回報bug「開啟商人仍能帶著亂跑」：商人／祝福視窗開啟中禁止移動，
    // 跟tower puzzle/character sheet等其他全螢幕modal理應一致（這兩個視窗原本沒有這個
    // 判斷，導致玩家能一邊看著商人視窗一邊移動離開，商人視窗卻沒有跟著關閉）。
    if (!el("midnight-merchant-modal").hidden || !el("midnight-blessing-modal").hidden) return;
    // 2026-09-08使用者明確要求「結束夜之強敵戰鬥的[使用祝福]與[離去]……在[離去]之前不能
    // 在地圖上移動」：見rewardsMovementLocked()說明，跟HUD區塊顯示條件同一套判斷。
    if (rewardsMovementLocked(now)) return;
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
    // fix：SPIRIT_BIRD_LINKS改成每張地圖各自一份（見midnight_map_variants.js），改讀
    // map.spiritBirdLinks（generateMap()已經依變體塞好，basic地圖等同原本的Map_.SPIRIT_BIRD_LINKS）
    // 而不是固定讀Map_模組層級的origin專屬那份。
    map.spiritBirdLinks.forEach(function (bird) {
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

  // 瀕死中無法移動／使用任何物品或技能（2026-09-08使用者明確規格「期間無法移動與使用
  // 任何物品，僅能查看角色資訊與開啟選單」），見updateNearDeathState()等近死系統函式。
  function isSelfDowned() {
    var c = characters[myTokenId];
    return !!(c && c.nearDeath && c.nearDeath.active);
  }

  // 2026-09-10使用者明確規格「瀕死狀態下不能使用任何下方按鍵、聖杯、道具、換武器、左右手
  // 任何動作，以及不能逃離戰鬥」：各handler本來就有isSelfDowned()守衛（點下去靜默無效），
  // 但按鈕視覺上仍是可按的，玩家會以為是bug。統一抽出這個「現在能不能操作」判斷，讓所有
  // 動作類按鈕的disabled都走同一個條件，畫面直接反映鎖定狀態。
  // 注意：這只涵蓋「動作」——角色視窗、選單、地圖檢視等純檢視操作不受限（使用者原始規格
  // 「僅能查看角色資訊與開啟選單」）。
  function canActNow() {
    return !!mySlot && !isPaused() && !isSelfDowned();
  }

  // =====================================================================
  // 瀕死／復歸／流浪祝福（2026-09-08新增，使用者明確規格，midnight原本完全沒有這套
  // 機制——玩家HP降到0之前只是卡在0沒有任何後續）。跟night.js的3顆20/30/40復歸圓鈕不同，
  // midnight是即時制，這裡簡化成「單一累計復歸傷害總量」，見nearDeathRequiredValue()。
  //
  // character/{tokenId}/nearDeath＝null（未瀕死）或
  //   { active, downedAt, deadlineAt, progress, required, timedOut? }
  // character/{tokenId}/revivalCount＝這場遊戲已完成復歸的次數（決定下次瀕死所需總量）。
  // meta.difficulty＝"standard"（預設，流浪祝福3次）｜"unlimited"（阿罵模式，無限且
  //   永不觸發遊戲失敗）。meta.wanderingBlessingUsed＝標準模式已消耗的流浪祝福格數。
  // meta.gameFailurePending＝true時，全員彈出視窗詢問是否切換阿罵模式（見
  // switchToUnlimitedMode()），此時所有瀕死角色維持鎖定，不會自動復歸。
  // =====================================================================
  var NEAR_DEATH_TIMEOUT_MS = 15000; // 倒地15秒內未能復歸就強制復歸
  var NEAR_DEATH_DAMAGE_PAUSE_MS = 1000; // 使用者明確規格「受到攻擊後1s內能停止倒地時間計時」：
  // 每次受到復歸傷害，倒數期限至少往後延1秒（不會縮短，只確保命中當下不會剛好逾時）。
  var NEAR_DEATH_REVIVAL_PROXIMITY_RADIUS = 1.5; // 不在同一場戰鬥時，靠近多近才能施放復歸傷害（沿用SPIRIT_BIRD_ACTIVATE_RADIUS同量級）
  var WANDERING_BLESSING_STANDARD_COUNT = 3; // 標準模式的流浪祝福總格數

  function nearDeathRequiredValue(tokenId) {
    var count = (characters[tokenId] && characters[tokenId].revivalCount) || 0;
    return count >= 2 ? 120 : count === 1 ? 90 : 60;
  }

  // HP降到0時觸發：任何裝置偵測到都可以安全呼叫（transaction本身保證只有第一次真正生效，
  // 已經在瀕死中的話直接維持原值，不重複觸發）。
  function maybeTriggerNearDeath(tokenId) {
    var c = characters[tokenId];
    if (!c) return;
    var required = nearDeathRequiredValue(tokenId);
    GameStorage.rtTransaction(gameId, "cloud", "character/" + tokenId + "/nearDeath", function (cur) {
      if (cur && cur.active) return cur;
      var now = Date.now();
      return { active: true, downedAt: now, deadlineAt: now + NEAR_DEATH_TIMEOUT_MS, progress: 0, required: required };
    });
  }

  // 找最靠近的祝福點（縮圈期間只考慮圈內的），沒有的話回中心點——使用者明確規格「復活
  // 地點為當下最靠近祝福的地點，若身處縮圈外則復活在圈內的祝福，若圈內無祝福則為中心
  // 點」。Day3沒有地圖/圈的概念，不會呼叫這裡（見finishRevive()的day!==3判斷）。
  function computeReviveSpawnPos(phaseInfo) {
    var blessingPoints = (map && map.points ? map.points : [])
      .filter(function (pt) {
        return pt.type === "blessing";
      })
      .map(function (pt) {
        return { x: pt.x + 0.5, y: pt.y + 0.5 };
      })
      .filter(function (p) {
        var dx = p.x - phaseInfo.center.x;
        var dy = p.y - phaseInfo.center.y;
        return Math.sqrt(dx * dx + dy * dy) <= phaseInfo.radius;
      });
    if (!blessingPoints.length) return { x: phaseInfo.center.x, y: phaseInfo.center.y };
    var origin = localPos || phaseInfo.center;
    var best = blessingPoints[0];
    var bestDistSq = Infinity;
    blessingPoints.forEach(function (p) {
      var dx = p.x - origin.x;
      var dy = p.y - origin.y;
      var d = dx * dx + dy * dy;
      if (d < bestDistSq) {
        bestDistSq = d;
        best = p;
      }
    });
    return best;
  }

  // 復歸完成（不管是逾時強制復歸還是隊友救起）：revivalCount+1（影響下次瀕死所需總量），
  // fullHeal=true（逾時強制復歸）回滿血＋消耗流浪祝福已在呼叫端處理＋自己傳送到最近祝福點；
  // fullHeal=false（隊友復歸傷害救起）只回一半HP，不移動位置，不消耗流浪祝福（使用者明確
  // 規格「若有受到其他玩家的復歸傷害...直到都是0則能再起繼續，但血量回復一半」）。
  function finishRevive(tokenId, fullHeal) {
    GameStorage.rtTransaction(gameId, "cloud", "character/" + tokenId + "/revivalCount", function (cur) {
      return (cur || 0) + 1;
    });
    var maxHp = selfArenaHpMax(characters[tokenId]);
    if (fullHeal) {
      GameStorage.rtSet(gameId, "cloud", "demoStat/" + tokenId, maxHp);
      if (tokenId === myTokenId) {
        var phaseInfo = currentPhaseInfo(Date.now());
        if (phaseInfo.day !== 3) {
          localPos = computeReviveSpawnPos(phaseInfo);
          maybePushPosition(Date.now());
        }
      }
    } else {
      GameStorage.rtSet(gameId, "cloud", "demoStat/" + tokenId, Math.round(maxHp / 2));
    }
    if (revivalDesignateTargetTokenId === tokenId) revivalDesignateTargetTokenId = null;
  }

  // 標準模式：消耗1格流浪祝福，回傳是否真的還有格數可扣（closure旗標反映transaction最後
  // 一次真正commit的判斷，重試時會用最新的cur重新判斷，結果可靠）。阿罵模式視為無限，
  // 一律回傳true（消耗但不真的清空）。
  function tryConsumeWanderingBlessing() {
    if (meta && meta.difficulty === "unlimited") return Promise.resolve(true);
    var consumed = false;
    return GameStorage.rtTransaction(gameId, "cloud", "meta/wanderingBlessingUsed", function (cur) {
      var used = cur || 0;
      if (used >= WANDERING_BLESSING_STANDARD_COUNT) {
        consumed = false;
        return cur;
      }
      consumed = true;
      return used + 1;
    }).then(function () {
      return consumed;
    });
  }

  // 倒地15秒逾時：只有自己的裝置會判斷自己的倒數（見updateNearDeathState()），transaction
  // 把nearDeath.timedOut標成true當作「這次逾時我搶到了」的閘門，避免同一輪逾時被重複處理。
  function forceReviveOnTimeout(tokenId) {
    var wonRace = false;
    GameStorage.rtTransaction(gameId, "cloud", "character/" + tokenId + "/nearDeath", function (cur) {
      if (!cur || !cur.active || cur.timedOut || Date.now() < cur.deadlineAt) {
        wonRace = false;
        return cur;
      }
      wonRace = true;
      var next = {};
      for (var k in cur) next[k] = cur[k];
      next.timedOut = true;
      return next;
    }).then(function () {
      if (!wonRace) return;
      tryConsumeWanderingBlessing().then(function (consumed) {
        if (consumed) {
          GameStorage.rtSet(gameId, "cloud", "character/" + tokenId + "/nearDeath", null);
          finishRevive(tokenId, true);
        } else {
          // 流浪祝福已耗盡：不復歸，維持瀕死鎖定，改觸發遊戲失敗暫停，等全員看到彈窗
          // 決定是否切換阿罵模式（見switchToUnlimitedMode()），不自行猜測要不要繼續。
          GameStorage.rtSet(gameId, "cloud", "meta/gameFailurePending", true);
        }
      });
    });
  }

  // 每幀檢查自己是否已經瀕死逾時——只判斷自己（myTokenId），不用管別人，因為每個瀕死角色
  // 的15秒倒數都是由該角色自己的裝置負責偵測（跟其他「靠近/移動」判斷同一種本地端偵測
  // 慣例）。
  function updateNearDeathState(now) {
    if (!myTokenId) return;
    var c = characters[myTokenId];
    var nd = c && c.nearDeath;
    if (!nd || !nd.active || nd.timedOut) return;
    if (now >= nd.deadlineAt) forceReviveOnTimeout(myTokenId);
  }

  // 「指定」：本地端狀態，不同步——把自己接下來的一般攻擊都轉成對這名瀕死隊友的復歸傷害，
  // 直到取消指定或對象已經不再需要復歸為止（見tryApplyDesignatedRevivalDamage()）。
  var revivalDesignateTargetTokenId = null;

  function slotForTokenId(tokenId) {
    var slots = Object.keys(players || {});
    for (var i = 0; i < slots.length; i++) {
      if (players[slots[i]] && players[slots[i]].tokenId === tokenId) return slots[i];
    }
    return null;
  }

  // 復歸傷害施放資格（使用者明確規格）：跟瀕死者同一場戰鬥（該場fieldTrigger的participants
  // 包含對方的席位）可以直接施放；不在戰鬥中的話，需要在地圖上靠近對方。
  function isRevivalDamageEligible(targetTokenId) {
    var c = characters[targetTokenId];
    if (!c || !c.nearDeath || !c.nearDeath.active) return false;
    if (activeEncounter) {
      var trig = fieldTriggers[activeEncounter.id];
      var targetSlot = slotForTokenId(targetTokenId);
      if (trig && targetSlot && trig.participants && trig.participants[targetSlot]) return true;
    }
    var targetPos = targetTokenId === myTokenId ? localPos : remoteTokens[targetTokenId];
    if (!targetPos || !localPos) return false;
    var dx = localPos.x - targetPos.x;
    var dy = localPos.y - targetPos.y;
    return Math.sqrt(dx * dx + dy * dy) <= NEAR_DEATH_REVIVAL_PROXIMITY_RADIUS;
  }

  function toggleRevivalDesignate(targetTokenId) {
    revivalDesignateTargetTokenId = revivalDesignateTargetTokenId === targetTokenId ? null : targetTokenId;
  }

  // 對瀕死隊友累加復歸傷害進度，滿足需求量時完成復歸（見finishRevive(，false)＝只回半血、
  // 不消耗流浪祝福）。用cur.active=false當作「這次是我完成的」閘門，避免併發的另一筆復歸
  // 傷害重複觸發完成。
  function applyRevivalProgress(targetTokenId, amount) {
    if (amount <= 0) return;
    var completed = false;
    GameStorage.rtTransaction(gameId, "cloud", "character/" + targetTokenId + "/nearDeath", function (cur) {
      if (!cur || !cur.active) {
        completed = false;
        return cur;
      }
      var next = {};
      for (var k in cur) next[k] = cur[k];
      next.progress = (cur.progress || 0) + amount;
      next.deadlineAt = Math.max(cur.deadlineAt, Date.now() + NEAR_DEATH_DAMAGE_PAUSE_MS);
      if (next.progress >= cur.required) {
        next.active = false;
        completed = true;
      } else {
        completed = false;
      }
      return next;
    }).then(function () {
      if (!completed) return;
      GameStorage.rtSet(gameId, "cloud", "character/" + targetTokenId + "/nearDeath", null);
      finishRevive(targetTokenId, false);
    });
  }

  // 一般攻擊在「指定」模式下轉換成復歸傷害（使用者明確規格「其他攻擊則傷害除以2來累積」），
  // 從damageCombatTarget()最前面攔截，攔截成功就完全不對敵人造成傷害。
  function tryApplyDesignatedRevivalDamage(amount) {
    var targetId = revivalDesignateTargetTokenId;
    if (!targetId || !isRevivalDamageEligible(targetId)) return false;
    applyRevivalProgress(targetId, Math.floor(amount / 2));
    return true;
  }

  // 技能/招式文字本身寫明「復歸傷害：N」的（使用者明確規格「即使沒有指定玩家，仍可以
  // 一般傷害對敵人造成傷害同時使用復歸傷害」）：直接累加原值N，不必指定、也不影響對敵人
  // 的傷害——呼叫端在算完一般傷害之後另外呼叫這裡。目前character_types.js等資料尚未有
  // 任何招式使用這個文字（這套機制是這次才新增的），先備妥解析/施放邏輯，之後規則資料
  // 補上「復歸傷害：N」文字時可以直接接上，不需要另外設計。
  function parseFixedRevivalDamageValue(text) {
    var m = /復[帰歸](?:ダメージ|傷害)[：:]\s*(\d+)/.exec(text || "");
    return m ? parseInt(m[1], 10) : null;
  }

  function firstEligibleDownedAllyTokenId() {
    if (revivalDesignateTargetTokenId && isRevivalDamageEligible(revivalDesignateTargetTokenId)) return revivalDesignateTargetTokenId;
    var slots = Object.keys(players || {});
    for (var i = 0; i < slots.length; i++) {
      var p = players[slots[i]];
      if (p && p.tokenId && isRevivalDamageEligible(p.tokenId)) return p.tokenId;
    }
    return null;
  }

  function maybeApplySkillRevivalDamage(bodyText) {
    var fixed = parseFixedRevivalDamageValue(bodyText);
    if (fixed === null) return;
    var targetId = firstEligibleDownedAllyTokenId();
    if (targetId) applyRevivalProgress(targetId, fixed);
  }

  // 標準模式流浪祝福耗盡後（meta.gameFailurePending），任何一名玩家按下確認即可切換成
  // 阿罵模式並讓全員瀕死角色立刻復歸（使用者明確規格「跳出視窗是否轉為阿罵模式，則全員
  // 一次救起繼續遊戲」）。用meta.gameFailurePending本身的transaction（true→false）當作
  // 「誰先按到算誰的」閘門，避免多人同時按下導致重複復歸/重複+1 revivalCount。
  function switchToUnlimitedMode() {
    var wonRace = false;
    GameStorage.rtTransaction(gameId, "cloud", "meta/gameFailurePending", function (cur) {
      if (!cur) {
        wonRace = false;
        return cur;
      }
      wonRace = true;
      return false;
    }).then(function () {
      if (!wonRace) return;
      GameStorage.rtSet(gameId, "cloud", "meta/difficulty", "unlimited");
      Object.keys(characters).forEach(function (tokenId) {
        var c = characters[tokenId];
        if (c && c.nearDeath && c.nearDeath.active) {
          GameStorage.rtSet(gameId, "cloud", "character/" + tokenId + "/nearDeath", null);
          finishRevive(tokenId, true);
        }
      });
    });
  }

  // 自己瀕死中的狀態提示（倒數＋復歸進度），見#midnight-near-death-statusのCSS/HTML說明。
  function renderNearDeathStatus(now) {
    var wrap = el("midnight-near-death-status");
    if (!wrap) return;
    var c = characters[myTokenId];
    var nd = c && c.nearDeath;
    if (!nd || !nd.active) {
      wrap.hidden = true;
      return;
    }
    wrap.hidden = false;
    var remainSec = Math.max(0, Math.ceil((nd.deadlineAt - now) / 1000));
    el("midnight-near-death-status-text").textContent = window.I18N.t("midnight_near_death_status_note", {
      remain: remainSec,
      progress: nd.progress || 0,
      required: nd.required,
    });
  }

  // 右上導覽框的流浪祝福剩餘格數（阿罵模式顯示「無限」）。
  function renderWanderingBlessingHud() {
    var el2 = el("midnight-wandering-blessing-value");
    if (!el2 || !meta) return;
    if (meta.difficulty === "unlimited") {
      el2.textContent = window.I18N.t("midnight_wandering_blessing_unlimited_note");
      return;
    }
    var remain = Math.max(0, WANDERING_BLESSING_STANDARD_COUNT - (meta.wanderingBlessingUsed || 0));
    el2.textContent =
      window.I18N.t("midnight_wandering_blessing_label") +
      window.I18N.t("colon_separator") +
      window.I18N.t("midnight_wandering_blessing_value", { remain: remain, total: WANDERING_BLESSING_STANDARD_COUNT });
  }

  // 遊戲失敗彈窗：meta.gameFailurePending為true時全員都看得到，見switchToUnlimitedMode()。
  function updateGameFailureModal() {
    var modal = el("midnight-game-failure-modal");
    if (!modal || !meta) return;
    modal.hidden = !meta.gameFailurePending;
  }

  // 遊戲勝利彈窗（使用者明確規格「遊戲第三天勝利後顯示(結局)」）：day3BossDefeated()是
  // 既有但先前完全沒有呼叫端的純函式（純粹依fieldTrigger/fieldEnemyHp判斷，不需要額外的
  // meta旗標）。關閉只是本地端旗標（gameVictoryDismissed，同day1RewardsDismissed既有模式），
  // 不寫共享state，讓每位玩家自己決定何時關閉，不影響其他人畫面。
  var gameVictoryDismissed = false;
  function updateGameVictoryModal() {
    var modal = el("midnight-game-victory-modal");
    if (!modal) return;
    var defeated = day3BossDefeated();
    if (!defeated || gameVictoryDismissed) {
      modal.hidden = true;
      return;
    }
    modal.hidden = false;
    var trig = fieldTriggers[DAY3_BOSS_POINT_ID];
    var GmFlow = window.PriTestNightGmFlow;
    var text = trig && GmFlow ? GmFlow.resolveNightKingNarrationText(trig.enemyId, "ending") : null;
    el("midnight-game-victory-text").textContent = text || "";
  }

  function handleGameVictoryConfirmClick() {
    gameVictoryDismissed = true;
    el("midnight-game-victory-modal").hidden = true;
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

  // 「L補」（使用者明確規格，2026-09-10新增）：規則書多處敵人等級/撃破ルーン標注
  // 「+L補正」／「+L補」（fields_data_1~4.js／event_rulebook.jsのstrong_enemy／襲撃
  // 分支既有文字，例如「Lv.2+L補」「撃破ルーン：8 + L補正」），先前因為全專案沒有通用
  // resolver、依CLAUDE.md §19不猜測數值而完全略過。使用者提供的即時制專屬換算：
  // 「每次開始縮圈時L補+1」（第1天縮圈1次=1、縮圈2次=2、第2天縮圈1次=3、縮圈2次=4，
  // 第2天結束後不再增加——沒有更多縮圈可以推進）。跟phaseInfo.stage一樣是純函式，
  // 直接由現有共享的meta.sessionStartAt/day2StartAt/day3StartAt換算出的day/stage決定，
  // 不需要另外用RTDB計數器或transaction累加（不會有多台裝置競速累加的問題，任何時間點
  // 所有裝置算出來的L值天生一致）。只套用在規則書文字本身確實標注「+L補正」/「+L補」的
  // 敵人/獎勵（scanLinesForEnemyMatches／rollAndAssignStrongEnemy／renderAmbushBossBranch／
  // maybeGrantMeteorReward／maybeGrantAmbushReward），不擴大套用到其他沒有標注的敵人。
  function currentLBonus(phaseInfo) {
    if (!phaseInfo) return 0;
    if (phaseInfo.day === 1) {
      if (phaseInfo.stage === "grace") return 0;
      if (phaseInfo.stage === "shrink1") return 1;
      return 2; // hold／shrink2／waitingForDay2：第1天兩次縮圈都已開始過
    }
    if (phaseInfo.day === 2) {
      if (phaseInfo.stage === "grace") return 2; // 承接第1天結束時的L
      if (phaseInfo.stage === "shrink1") return 3;
      return 4; // hold／shrink2／waitingForDay3
    }
    return 4; // day3：沿用第2天結束時的L，沒有更多縮圈可以推進
  }

  var L_BONUS_TEXT_RE = /L補/;

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
    gameVictoryDismissed = false; // 重新開始一輪後，勝利彈窗的本地關閉旗標也要重置，否則下一輪擊敗夜王不會再顯示
  }

  // 立即縮圈（2026-09-09新增，測試主控台專用）：不新增第二套計時系統，直接把目前這一天
  // 的StartAt往回撥PHASE_TOTAL_MS（跟computeDayStage()既有的時間衍生公式一致），讓
  // currentPhaseInfo()下一影格就算出這一天的最終半徑（stage:"done"/"waitingForDay2/3"）。
  // day3沒有地圖/縮圈可言，直接no-op。
  function handleForceShrinkClick() {
    if (!meta || !meta.testMode) return;
    if (meta.day3StartAt) return;
    var now = Date.now();
    if (meta.day2StartAt) {
      GameStorage.rtSet(gameId, "cloud", "meta/day2StartAt", now - PHASE_TOTAL_MS);
    } else {
      GameStorage.rtSet(gameId, "cloud", "meta/sessionStartAt", now - PHASE_TOTAL_MS);
    }
  }

  // ---- 縮圈扣血：本地每秒判定一次自己是否在圈外，若是則透過transaction()對自己的
  // demoStat做原子扣血。這是「持續傷害縮圈」規則的也直接沿用
  // 跟共享標靶攻擊按鈕相同的transaction()機制。day3（與地圖無關）不扣血。----
  // 圈外每秒扣血量：連續在圈外的時間越久，每次tick扣的點數越多（見outsideCircleSinceMs
  // 說明的使用者明確規格）。
  function circleDamagePerTick(elapsedOutsideSec) {
    if (elapsedOutsideSec <= 10) return 1;
    if (elapsedOutsideSec <= 20) return 2;
    if (elapsedOutsideSec <= 30) return 4;
    return 8;
  }

  function maybeApplyCircleDamage(now, phaseInfo) {
    if (!mySlot || !localPos) return; // 觀戰者沒有角色，不扣血
    if (phaseInfo.day === 3 || isPaused()) return;
    var dx = localPos.x - phaseInfo.center.x;
    var dy = localPos.y - phaseInfo.center.y;
    var dist = Math.sqrt(dx * dx + dy * dy);
    if (dist <= phaseInfo.radius) {
      outsideCircleSinceMs = null; // 回到圈內：連續在外時間重置，下次出去重新從1點/秒起算
      return;
    }
    if (outsideCircleSinceMs === null) outsideCircleSinceMs = now;
    if (now - lastDamageTickTime < DAMAGE_TICK_MS) return;
    lastDamageTickTime = now;
    var dmg = circleDamagePerTick((now - outsideCircleSinceMs) / 1000);
    var maxHp = mySelfHpMaxFallback();
    GameStorage.rtTransaction(gameId, "cloud", "demoStat/" + myTokenId, function (cur) {
      var next = (cur === null ? maxHp : cur) - dmg;
      return next < 0 ? 0 : next;
    }).then(function (result) {
      if (result === 0) maybeTriggerNearDeath(myTokenId);
    });
  }

  // ============================================================================
  // 「完整版」4張新地圖的地變特殊規則（使用者明確規格，見docs/midnight_realtime_combat_numbers.md
  // 新增章節）。map.specialRule由midnight_map.jsのgenerateMap()依抽中的地圖變體決定，
  // 沒有變體（origin基礎地圖）時整段no-op。三種週期性效果（cassel/red/ice）各自獨立的
  // 下一次觸發時間用本地變數保存（不需要跨玩家同步——縮圈時間損耗直接寫共享的
  // meta.sessionStartAt/day2StartAt本身就會同步給所有人；腐敗蓄積跟視野阻礙都是「本地
  // only、只有自己需要知道」的既有慣例，同receivedAttributeAccum/暴風雪視野鎖定同理）。
  // kasan的熔岩規則掛在maybeAdvanceFieldProgressAfterFloorClear()（樓層踏破事件本身），
  // 不是週期性，不在這裡處理。
  // ============================================================================
  var casselNextTimeLossAt = null;
  var casselTimeLossAttempted = false;
  var CASSEL_TIME_LOSS_MIN_MS = 30000;
  var CASSEL_TIME_LOSS_MAX_MS = 60000;
  var CASSEL_TIME_LOSS_AMOUNT_MS = 5000;

  // 「迷惘的隱藏都市」（cassel）：使用者明確規格「此場地內每隨機30~60秒，縮圈時間-5秒」。
  // 縮圈時間由currentPhaseInfo()依「now－該天StartAt」算出，因此「縮圈時間-5秒」等同讓
  // 該天的StartAt往前撥5秒（跟測試主控台既有的handleForceShrinkClick()同一種手法，
  // 不是另外發明新的計時欄位）。這個效果是「地圖本身」的規則、跟玩家在哪裡無關，所有人
  // 共用同一份meta，因此任何一個裝置的transaction()寫入就對全場生效，不需要每個玩家
  // 各自觸發。
  function maybeApplyCasselTimeLoss(now, phaseInfo) {
    if (phaseInfo.day === 3) return; // day3沒有縮圈可言
    if (casselNextTimeLossAt === null) {
      casselNextTimeLossAt = now + CASSEL_TIME_LOSS_MIN_MS + Math.random() * (CASSEL_TIME_LOSS_MAX_MS - CASSEL_TIME_LOSS_MIN_MS);
      return;
    }
    if (now < casselNextTimeLossAt || casselTimeLossAttempted) return;
    casselTimeLossAttempted = true;
    var field = phaseInfo.day === 1 ? "sessionStartAt" : "day2StartAt";
    GameStorage.rtTransaction(gameId, "cloud", "meta/" + field, function (cur) {
      return cur === null ? cur : cur - CASSEL_TIME_LOSS_AMOUNT_MS;
    }).then(function () {
      casselTimeLossAttempted = false;
      casselNextTimeLossAt = Date.now() + CASSEL_TIME_LOSS_MIN_MS + Math.random() * (CASSEL_TIME_LOSS_MAX_MS - CASSEL_TIME_LOSS_MIN_MS);
    });
  }

  var redMiasmaNextTickAt = null;
  var RED_MIASMA_INTERVAL_MS = 30000;

  // 「朱紅腐敗的瘴氣」（red）：使用者明確規格「此場地內每30秒，PC全員累積『腐敗：1D
  // （最低值0）』」「此場地的『腐敗』異常狀態不會解除，會持續累積」——後面這句是跟一般
  // 異常狀態「達到閾值觸發效果後歸零」（見recordReceivedAttributeAccum()）不同的地方，
  // 因此這裡刻意不透過那個共用函式（會在跨過閾值時把腐敗歸零、且會連動觸發不撓等其他
  // 機制，不符合「不會解除」的規格），改直接對receivedAttributeAccum這個既有的「玩家
  // 自身蓑積量」本地資料結構累加，不歸零。是本地only狀態（跟receivedAttributeAccum既有
  // 設計一致，只有自己需要知道自己累積了多少），不需要跨玩家同步。
  function maybeApplyRedMiasmaTick(now) {
    if (!mySlot) return;
    if (redMiasmaNextTickAt === null) {
      redMiasmaNextTickAt = now + RED_MIASMA_INTERVAL_MS;
      return;
    }
    if (now < redMiasmaNextTickAt) return;
    redMiasmaNextTickAt = now + RED_MIASMA_INTERVAL_MS;
    var roll = 1 + Math.floor(Math.random() * 6);
    receivedAttributeAccum["腐敗"] = (receivedAttributeAccum["腐敗"] || 0) + roll;
    renderAttributeAccumNote();
  }

  var iceBlizzardNextBlindAt = null;
  var iceBlizzardBlindUntil = 0;
  var ICE_BLIZZARD_BLIND_MIN_MS = 30000;
  var ICE_BLIZZARD_BLIND_MAX_MS = 45000;
  var ICE_BLIZZARD_BLIND_DURATION_MS = 5000;

  // 「暴風雪的視野」（ice）：使用者明確規格「戰鬥時，此場地內每隨機30~45秒，不能對敵人
  // 進行『攻擊』與『使用技能』5秒」。只在真的站在遇敵點（activeEncounter）時才計時/生效，
  // 離開戰鬥後計時停止（下次進入戰鬥重新開始算，不是背景持續跑）——「戰鬥時」是規則
  // 明確的觸發前提，不是地圖全域效果。
  function isIceBlizzardBlinded(now) {
    return !!(map && map.specialRule === "ice_blizzard" && now < iceBlizzardBlindUntil);
  }

  function maybeApplyIceBlizzardTick(now) {
    if (!activeEncounter) {
      iceBlizzardNextBlindAt = null;
      return;
    }
    if (iceBlizzardNextBlindAt === null) {
      iceBlizzardNextBlindAt = now + ICE_BLIZZARD_BLIND_MIN_MS + Math.random() * (ICE_BLIZZARD_BLIND_MAX_MS - ICE_BLIZZARD_BLIND_MIN_MS);
      return;
    }
    if (now < iceBlizzardNextBlindAt) return;
    iceBlizzardBlindUntil = now + ICE_BLIZZARD_BLIND_DURATION_MS;
    iceBlizzardNextBlindAt = now + ICE_BLIZZARD_BLIND_DURATION_MS + ICE_BLIZZARD_BLIND_MIN_MS + Math.random() * (ICE_BLIZZARD_BLIND_MAX_MS - ICE_BLIZZARD_BLIND_MIN_MS);
    showToast(window.I18N.t("midnight_ice_blizzard_blind_note"));
  }

  var iceFrostbiteNextTickAt = null;
  var ICE_FROSTBITE_INTERVAL_MS = RED_MIASMA_INTERVAL_MS; // 使用者2026-09-10指示「以及red的腐敗」＝比照red_miasma同一套頻率/機制實作

  // 「凍寒的暴風雪」（ice）：規則書原文只寫「非戰鬥時にも『凍傷』が蓄積し、戦闘が終了
  // しても『凍傷』蓄積値が残る」，沒有標示蓄積速率數字（CLAUDE.md §19不自行發明）。
  // 2026-09-10使用者指示「地變特殊規則：非戰鬥也蓄積凍傷 以及red的腐敗」——把這句話
  // 理解為「比照red瘴氣腐敗(maybeApplyRedMiasmaTick)同一套機制/頻率」實作：每
  // RED_MIASMA_INTERVAL_MS(30秒)累積「凍傷：1D」，不透過會在跨閾值時歸零的
  // recordReceivedAttributeAccum()（規格明確要求「戰鬥結束也不重置」，跟一般異常「達到
  // 閾值觸發效果後歸零」不同），本地only直接疊加receivedAttributeAccum，原理與範圍限縮
  // 跟maybeApplyRedMiasmaTick()完全對稱。跟原本只在activeEncounter時才計時的
  // 「暴風雪的視野」(maybeApplyIceBlizzardTick)不同，這裡是地圖全域效果，只要目前地圖是
  // ice_blizzard就持續累積，不限戰鬥中。
  function maybeApplyIceFrostbiteTick(now) {
    if (!mySlot) return;
    if (iceFrostbiteNextTickAt === null) {
      iceFrostbiteNextTickAt = now + ICE_FROSTBITE_INTERVAL_MS;
      return;
    }
    if (now < iceFrostbiteNextTickAt) return;
    iceFrostbiteNextTickAt = now + ICE_FROSTBITE_INTERVAL_MS;
    var roll = 1 + Math.floor(Math.random() * 6);
    receivedAttributeAccum["凍傷"] = (receivedAttributeAccum["凍傷"] || 0) + roll;
    renderAttributeAccumNote();
  }

  function applyMapSpecialRuleTick(now, phaseInfo) {
    if (!map || !map.specialRule) return;
    if (map.specialRule === "cassel_hidden_city") maybeApplyCasselTimeLoss(now, phaseInfo);
    else if (map.specialRule === "red_miasma") maybeApplyRedMiasmaTick(now);
    else if (map.specialRule === "ice_blizzard") {
      maybeApplyIceBlizzardTick(now);
      maybeApplyIceFrostbiteTick(now);
    }
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
    var mapImage = currentMapImage();
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
    map.spiritBirdLinks.forEach(drawSpiritBirdMarker);

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
    // 一般地點卡（2~10/K/J／Q）：「攻破」＝全樓層踏破（fieldProgress.cleared），不是單一
    // 樓層resolved就算——套用night規則書「全フロア踏破」才算完全攻破的概念（見
    // maybeAdvanceFieldProgressAfterFloorClear），跟strong_enemy籌碼（單層、擊殺即完成）
    // 的判定分開。Q板塊2026-09-10改走這條一般分支（見NON_FIELD_POINT_TYPES說明）。
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
  // fix：cassel這張「完整版」新地圖沒有畫王城橘線範圍（castleZone全0，見
  // midnight_map_variants.jsのCASSEL_CASTLE_ROWS說明），computeMaskCentroid()對全0遮罩
  // 會退回地圖正中央當佔位重心——如果不擋住，會在地圖正中央畫一個看起來能用、實際上
  // isCastleZone()永遠回傳false（點了沒反應）的假J堡壘圖示，誤導玩家。用mapHasCastle()
  // 判斷這張地圖的castleZone遮罩是不是真的有範圍，沒有就整個不畫。
  function mapHasCastle() {
    if (!map || !map.castleZone) return false;
    for (var i = 0; i < map.castleZone.length; i++) {
      if (map.castleZone[i] === 1) return true;
    }
    return false;
  }

  function drawCastleMarker() {
    if (!mapHasCastle()) return;
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
    // 2026-09-08使用者明確要求「靈鷹圖示可以再大，主要高度要明顯」：原本s=CELL*0.5時
    // 翼展寬約1.15*CELL但縱向只有約0.45*CELL，明顯比籌碼圖示（chipSize=CELL*1.6）扁小。
    // 這裡整體放大並額外拉高縱向比例，讓外觀更接近籌碼的視覺量級。
    var s = CELL * 0.85;
    ctx.save();
    ctx.translate(px, py);
    ctx.scale(1, 1.45);
    ctx.translate(-px, -py);
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
      // 2026-09-08修正：meta.resolvedNightBossId是劇本id，這裡跟rollAndAssignDay3Boss()
      // 一樣要先轉成規則書夜王id才能查bossRulebookData()，否則Day3 HUD會一直落回
      // midnight_day3_note這個「尚未實作」的舊字串（見上方bossIdForResolvedScenario()說明）。
      var bossId = bossIdForResolvedScenario(meta && meta.resolvedNightBossId);
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
  // fix：frame()是驅動整個遊戲（移動/戰鬥/籌碼事件/獎勵清單...全部)的單一主迴圈，
  // requestAnimationFrame(frame)只在函式最後呼叫一次——這代表只要中間任何一個update/
  // render函式丟出例外（例如隨機事件分支查表時遇到未預期的資料形狀），整條呼叫鏈會直接
  // 中斷、後面的requestAnimationFrame(frame)永遠不會執行，導致使用者回報的「經過籌碼事件
  // 後完全卡住，需要重整才能恢復」（整個遊戲不是卡在某個特定狀態，而是整個影格迴圈已經
  // 停止）。這裡加上try/catch＋finally，讓單一影格的例外只中止「這一影格」的處理並印到
  // console供除錯，下一影格仍會照常排程，不會整個遊戲永久停擺。這不會改變任何遊戲規則或
  // 判斷邏輯，純粹是主迴圈本身的容錯，跟CLAUDE.md「不猜規則數值」無關。
  function frame(ts) {
    try {
      frameInner(ts);
    } catch (err) {
      console.error("[midnight] frame() error, skipping this frame:", err);
    } finally {
      requestAnimationFrame(frame);
    }
  }

  function frameInner(ts) {
    var now = Date.now();
    var dtSec = lastFrameTime === null ? 0 : Math.min((ts - lastFrameTime) / 1000, 0.1);
    lastFrameTime = ts;

    if (!meta || !meta.sessionStartAt) {
      if (meta) {
        maybeCancelLobbyCountdown();
        maybeTriggerSessionStart(now);
        renderLobbyCountdown(now);
        // 修正既有bug（2026-09-07使用者回報「等待房中夜王劇本無法選擇」）：renderLobbySettings()
        // （負責populateNightBossSelect()／同步下拉選單目前值）原本只在下方「遊戲已開始」
        // 的主迴圈分支被呼叫，但夜王本來就該在等待房、遊戲開始前就能選——當時只call到
        // renderLobbyCountdown()，never populate這個select，導致選單永遠是空的（連「隨機
        // 決定」這個固定選項都沒有），玩家自然完全無法選擇。
        renderLobbySettings();
      }
      return;
    }

    maybeFinalizeResume(now);
    updatePauseOverlay(now);
    updateResumeCountdownHud(now);
    renderIntroOverlay(now);
    updateMovement(dtSec, now);
    updateFinalCircleBoss(now);
    updateDay3Boss();
    updateDay3BossIntroOverlay(now);
    updateNearbyBird();
    updateNearbyTower();
    updateNearbyFieldPoint();
    updateNearbyChipPoint();
    maybeResolveAllSharedRewardVotes();
    updateTopBannerCollapseUI();
    updateHudStackingUI(now);
    updateNearbyCastle();
    updateNearbyGroundItem();
    updateEnemyAttack(now);
    updateSummonedSpirit(now);
    updateBattleEnterLoading(now);
    updateBattlePrep(now);
    renderEnterBattlePrompt();
    renderBattlePrepBanner(now);
    renderStaggerOverlay(now); // 體崩橫幅／致命一擊按鈕（每影格變動，不能放進有快取的renderFieldEncounterPanel）
    renderFinalCircleCountdown(now);
    updateStamina(dtSec);
    updateSorceryHold(now);
    updateAttackHold(now);
    updateSkillExtraCharges(now); // 遺物效果「技能使用次數＋1」的蓄積
    updateFlaskReading(now);
    maybePushPosition(now);
    var phaseInfo = currentPhaseInfo(now);
    maybeApplyCircleDamage(now, phaseInfo);
    applyMapSpecialRuleTick(now, phaseInfo);
    updateNearDeathState(now);
    renderNearDeathStatus(now);
    renderWanderingBlessingHud();
    updateGameFailureModal();
    updateGameVictoryModal();
    updateAutoDayAdvance(now);
    maybeTriggerDay3FromReady();
    render(now, phaseInfo);
    renderCharPanel();
    renderCombatPanel();
    renderCharacterActionButtons();
    renderTestPanel();
    renderDebugPanel();
    renderLobbySettings();
    renderFinalCircleRewardsHud(now);
    renderRewardsLockBanner(now);
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
      if (!introOverlayShown) renderIntroBossText();
      introOverlayShown = true;
      var progress = Math.max(0, Math.min(1, (now - meta.sessionStartAt) / INTRO_DURATION_MS));
      if (canvasEl) canvasEl.style.opacity = String(progress);
      positionIntroFlyers(progress, canvasEl);
    } else if (introOverlayShown) {
      introOverlayShown = false;
      if (canvasEl) canvasEl.style.opacity = "";
    }
  }

  // 夜王〔開場〕敘述：只在進場動畫「剛變成顯示中」那一刻算一次（不是每影格），文字本身
  // 不會在遊戲過程中變動，沒必要每幀重算。找不到resolvedNightBossId對應的bossId或
  // GmFlow/worldview資料時整段隱藏，不自行編造（同midnight-day3-boss-intro-text既有慣例）。
  function renderIntroBossText() {
    var el_ = el("midnight-intro-boss-text");
    if (!el_) return;
    var GmFlow = window.PriTestNightGmFlow;
    var bossId = bossIdForResolvedScenario(meta && meta.resolvedNightBossId);
    var text = GmFlow && bossId ? GmFlow.resolveNightKingNarrationText(bossId, "opening") : null;
    el_.textContent = text || "";
    el_.hidden = !text;
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
    // 2026-09-10除錯用新增：背景分頁（document.hidden）時Chrome會節流/暫停
    // requestAnimationFrame，導致frame()幾乎不會被呼叫、遊戲卡在原地不動——這不是遊戲
    // 本身的bug，純粹是瀏覽器自動化測試環境的既有限制。手動呼叫這個函式可以繞過rAF直接
    // 推進一次frameInner()，方便測試腳本在背景分頁時也能推進遊戲狀態。
    _tick: function () {
      frameInner(Date.now());
    },
    // 2026-09-10除錯用新增：跳過window.prompt()密碼輸入直接接管席位（同performTakeover()，
    // 見handleTakeover()說明），純測試用，不對外公開文件化。
    _debugTakeover: function (slot) {
      var p = players[slot];
      if (!p) return false;
      performTakeover(slot, p);
      return true;
    },
    // 純測試用（同_debugTakeover，不對外公開文件化）：把fieldFloorCountForCard()這個
    // 純查詢函式暴露出來，讓回歸腳本可以不必真的走到每一個地圖點，就能驗證「卡面
    // floorCount」與「這個點實際採用的分歧floors長度」不會再算出打不到的幽靈樓層
    // （見tools/midnight_check/field_late_claim_check.js的②）。不做任何state mutation。
    _debugFieldFloorCount: function (pt) {
      return fieldFloorCountForCard(pt);
    },
    // 純測試用（同_debugTakeover／_debugFieldFloorCount，不對外公開文件化）：把敵人連續
    // 命中次數的抽選（pickEnemyAttackHitCount，見該函式與ENEMY_ATTACK_HIT_COUNT_WEIGHTS_*）
    // 開放給回歸測試取樣機率分布——這段邏輯平常包在rtTransaction的updater裡、每2~4秒才
    // 跑一次，靠實際遊玩取樣需要數分鐘，測不出分布是否正確。
    _debugPickEnemyAttackHitCount: function (pt, trig) {
      return pickEnemyAttackHitCount(pt, trig);
    },
    _debugIsEliteEncounterPoint: function (pt, trig) {
      return isEliteEncounterPoint(pt, trig);
    },
    // 純測試用（2026-09-11）：體崩累積平常只在「攻擊剛好帶▲/◆記號」時才發生，靠實際
    // 遊玩很難穩定累到36單位，這裡直接開放累積入口給回歸測試。
    _debugRecordGuardReduction: function (pointId, symbol) {
      recordGuardReductionForPoint(pointId, symbol);
    },
    _debugStaggerConstants: function () {
      return {
        thresholdUnits: STAGGER_THRESHOLD_UNITS,
        durationMs: STAGGER_DURATION_MS,
        accelMult: STAGGER_ACCEL_MULT,
        accelHpMinPct: STAGGER_ACCEL_HP_MIN_PCT,
        accelHpMaxPct: STAGGER_ACCEL_HP_MAX_PCT,
      };
    },
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
        towerPuzzleState: towerPuzzleState,
        fieldTriggers: fieldTriggers,
        fieldEnemyHp: fieldEnemyHp,
        fieldMobHp: fieldMobHp,
        receivedAttributeAccum: receivedAttributeAccum,
        fieldProgress: fieldProgress,
        nearbyFieldPoint: nearbyFieldPoint,
        // 2026-09-10補上：recomputeActiveEncounter()的候選來源共有5個，但這裡原本只匯出
        // nearbyFieldPoint／nearbyStrongEnemy／nearbyRandomEvent三個，缺了王城與兩個
        // Boss。回歸測試要驗證「候選優先序」就必須看得到全部5個——先前寫測試時誤以為
        // 讀得到，實際上讀到的永遠是undefined，斷言等於空轉。
        nearbyCastlePoint: nearbyCastlePoint,
        nearbyFinalCircleBoss: nearbyFinalCircleBoss,
        nearbyDay3Boss: nearbyDay3Boss,
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
