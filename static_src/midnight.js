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

  var GRID = Map_.GRID_SIZE;
  var CELL = Map_.CELL_PX;
  var MOVE_SPEED = 4.5; // 每秒移動幾格（世界座標）
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
  var STAMINA_COST_ATTACK_NORMAL = 15; // 連擊第1、2擊
  var STAMINA_COST_ATTACK_THIRD = 20; // 連擊第3擊
  var ATTACK_COMBO_WINDOW_MS = 1000; // 連擊判定窗口
  var ATTACK_THIRD_HIT_MULT = 1.5;
  var STAMINA_COST_SKILL = 25;
  var STAMINA_COST_DODGE = 10;
  var STAMINA_COST_BLOCK_SUCCESS = 5; // 成功防禦一次攻擊時扣的體力，見resolveMyIncomingHit()
  // 佔位值：使用者只給了體力消耗數字，沒有給實際傷害公式／FP上限／聖杯瓶回復量／解謎獎勵
  // 數量，依CLAUDE.md §19原則不可自行發明規則數值，這裡先用小的demo佔位值讓功能可測試，
  // 之後有正式數值時應該直接取代這些常數，不要繼續用這裡的猜測值。
  var ATTACK_BASE_DAMAGE = 1; // 沿用既有demoStat/sharedTarget攻擊demo原本的-1

  // ---- 戰技B（魔術／祈禱，2026-09-05 HUD優化新增）：長按確定施放，消耗FP而非體力。
  // FP_COST_SORCERY是佔位值（使用者只說「消耗相應FP等等」，沒給實際數字，理由同上方
  // ATTACK_BASE_DAMAGE註解）。FP不自動回復——使用者沒有提供回復規則，依CLAUDE.md §19
  // 原則不猜測，之後有正式規則書數值時再補。長按時間2秒是使用者明確規格。----
  var FP_COST_SORCERY = 20;
  var SORCERY_CAST_HOLD_MS = 2000;
  var FLASK_READ_MS = 600; // 聖杯瓶按下到確定使用的讀取時間，使用者明確規格

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
  var ENEMY_ATTACK_HIT_WINDOW_MS = [2000, 2500, 3000]; // 使用者明確規格：連續攻擊每次反應時限2s→2.5s→3s
  // 目標選擇機率：使用者只給了相對順序「有敵視>單體>多人」，沒給實際數字，demo佔位權重。
  var ENEMY_ATTACK_TARGET_WEIGHT_AGGRO = 0.5;
  var ENEMY_ATTACK_TARGET_WEIGHT_SINGLE = 0.3;
  var ENEMY_ATTACK_TARGET_WEIGHT_MULTI = 0.2;
  var ENEMY_ATTACK_HIT_COUNT_WEIGHTS = [0.6, 0.3, 0.1]; // 使用者明確規格：1次60%／2次30%／3次10%
  var ENEMY_ATTACK_DAMAGE = 10; // 佔位值：使用者沒有給實際傷害數字，同ATTACK_BASE_DAMAGE同類注解
  var ATTACK_EFFECT_DISPLAY_MS = 400; // 刀光/爪痕特效顯示時間，純視覺demo值
  var FP_MAX_DEFAULT = 50;
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
  var FIELD_TRIGGER_RADIUS = 2; // 「靠近」的判定半徑，比TOWER/SPIRIT_BIRD略大——這類點的卡片圖示本身較大
  var FIELD_INVITE_RADIUS = FIELD_TRIGGER_RADIUS; // 「地圖一定小周圍附近」的邀請範圍，沿用同一個靠近半徑
  var FIELD_INVITE_TIME_LIMIT_MS = 3000; // 使用者明確規格：邀請時限3秒
  var FIELD_ENTER_WAIT_MS = 500; // 使用者明確規格：正式進入後一同等待0.5秒才開始敘述
  var FIELD_VOTE_TIME_LIMIT_MS = 10000; // 使用者明確規格：分歧意見不一致的等待時間10秒，逾時交給系統決定
  var FIELD_ENEMY_HP_DEFAULT = 30; // 遇敵demo用血量佔位值（非正式數值，見上方ATTACK_BASE_DAMAGE同類註解）

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
  var blessingClaimed = {}; // pointId -> { claimedBy }（來自RTDB，見onBlessingClaimedReceived）
  var nearbyBlessing = null; // 目前在使用範圍內、尚未領取的祝福籌碼地點
  // 地圖上的丟棄物（2026-09-05角色面板優化新增）：groundItemId -> {kind, itemId,
  // usesRemaining, x, y, droppedBy, createdAt}（來自RTDB，見onGroundItemsReceived／
  // dropInventoryItem()／handlePickupGroundItem()）。任何人靠近都能撿，不限丟棄者本人。
  var groundItems = {};
  var nearbyGroundItem = null; // { id, data } 目前在拾取範圍內、尚未被撿走的掉落物
  var stamina = { current: STAMINA_MAX, max: STAMINA_MAX }; // 本地端資源，不同步（見上方常數區塊註解）
  var fp = { current: FP_MAX_DEFAULT, max: FP_MAX_DEFAULT }; // 本地端資源、不同步，理由同stamina；不自動回復
  var comboState = { hitIndex: 0, lastHitAt: 0 }; // hitIndex: 0=下一擊是第1擊，1=第2擊，2=第3擊
  var blockHolding = false;
  var sorceryHoldStartAt = null; // 戰技B（魔術／祈禱）長按開始時間，null＝目前沒在長按
  var flaskReadingUntil = null; // 聖杯瓶讀取中的到期時間戳，null＝目前沒在讀取
  var dodgePressedAt = 0; // 最近一次成功迴避（有扣到體力）的時間戳，見handleDodgeClick／resolveMyIncomingHit
  // 我目前正在承受的敵人攻擊（只有自己是targetSlots其中之一時才會有值，見updateEnemyAttack()）：
  // { pointId, attackId, hitIndex, hitCount, phase:"warn"|"window"|"done", windowStartAt, phaseEndAt }
  var myIncomingAttack = null;
  var attackEffectTimer = null;
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
  var nearbyFieldPoint = null; // 目前在FIELD_TRIGGER_RADIUS範圍內的地圖點（sorcerer型別除外）
  var nearbyCastlePoint = null; // 目前是否站在王城castleZone範圍內，見updateNearbyCastle()
  var CASTLE_POINT_ID = "castle_j"; // 王城合成點的固定id，跟一般地圖點的隨機id分開，方便辨識
  var activeEncounter = null; // 目前在範圍內、我是參與者、已解決分歧且敵人仍存活的地圖點——非null時攻擊/戰技要打這個點的敵人，不是共用標靶
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
        GameStorage.rtTransaction(gameId, "cloud", "demoStat/" + myTokenId, function (cur) {
          return cur === null ? 100 : cur;
        });
        GameStorage.rtTransaction(gameId, "cloud", "character/" + myTokenId, function (cur) {
          return cur === null ? newCharacterForSlot(mySlot) : cur;
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

  function onCharactersReceived(value) {
    characters = value || {};
    var mine = characters[myTokenId];
    if (mine && mine._lastTileRewardNote) {
      if (lastShownTileRewardAt !== null && mine._lastTileRewardNote.at !== lastShownTileRewardAt) {
        showToast(mine._lastTileRewardNote.text);
      }
      lastShownTileRewardAt = mine._lastTileRewardNote.at;
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
    // 通常還是空的，這裡直接讀undefined時用100當滿血顯示，跟demoStat其他地方的預設值一致。
    var hpVal = demoStats[p.tokenId];
    var hpValNum = hpVal === undefined ? 100 : hpVal;
    var hpTrack = document.createElement("span");
    hpTrack.className = "midnight-bar-track midnight-bar-track-sm midnight-slot-hp";
    var hpFill = document.createElement("span");
    hpFill.className = "midnight-bar-fill midnight-bar-hp";
    hpFill.style.width = Math.max(0, Math.min(100, hpValNum)) + "%";
    hpTrack.appendChild(hpFill);
    card.appendChild(hpTrack);

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
      GameStorage.rtSet(gameId, "cloud", "demoStat/" + myTokenId, previousStat === undefined ? 100 : previousStat);
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
    el("btn-midnight-attack-shared-target").addEventListener("click", handleAttackClick);
    el("btn-midnight-skill").addEventListener("click", handleSkillClick);
    bindSkillBHoldInput();
    el("btn-midnight-dodge").addEventListener("click", handleDodgeClick);
    bindBlockHoldInput();
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
      if (!mySlot || isPaused() || !nearbyBird) return;
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
    el("btn-midnight-blessing-claim").addEventListener("click", handleBlessingClaimClick);
    el("btn-midnight-pickup-ground-item").addEventListener("click", handlePickupGroundItem);
    el("btn-midnight-open-merchant").addEventListener("click", openMerchantModal);
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
    el("btn-midnight-toggle-menu").addEventListener("click", function () {
      var panel = el("midnight-menu-panel");
      panel.hidden = !panel.hidden;
    });
    el("btn-midnight-pause-game").addEventListener("click", handlePauseGame);
    el("btn-midnight-resume-game").addEventListener("click", handleResumeGame);
    el("btn-midnight-lobby-join").addEventListener("click", handleLobbyJoin);
    el("btn-midnight-lobby-ready").addEventListener("click", handleLobbyReadyToggle);
    el("btn-midnight-lobby-leave").addEventListener("click", handleLobbyLeave);
    el("btn-midnight-map-icon").addEventListener("click", function () {
      setMapExpanded(!mapExpanded);
    });
    el("btn-midnight-map-close").addEventListener("click", function () {
      setMapExpanded(false);
    });
    el("btn-midnight-advance-day2").addEventListener("click", handleAdvanceToDay2);
    el("btn-midnight-advance-day3").addEventListener("click", handleAdvanceToDay3);
    el("btn-midnight-restart-cycle").addEventListener("click", handleRestartCycle);

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

  // 攻擊/戰技實際要打的對象：如果目前站在一個已解決分歧、敵人仍存活的地圖點旁
  // （activeEncounter非null），打這個點的敵人（fieldEnemyHp/{pointId}）；否則沿用
  // 原本技術驗證片的共用標靶（demoStat/sharedTarget）。兩者都用同一套transaction()
  // 原子扣血機制，只是路徑不同。
  function damageCombatTarget(amount) {
    if (activeEncounter) {
      var pointId = activeEncounter.id;
      GameStorage.rtTransaction(gameId, "cloud", "fieldEnemyHp/" + pointId, function (cur) {
        var next = (cur === null ? FIELD_ENEMY_HP_DEFAULT : cur) - amount;
        return next < 0 ? 0 : next;
      });
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

  // 普通攻擊3連段：1秒判定窗口內連續點擊才算連段，超過窗口未點擊則從第1擊重新算。
  // 第1、2擊消耗15體力，第3擊消耗20體力且傷害1.5倍（使用者明確規格）；第3擊之後連段
  // 歸零，下次點擊重新從第1擊開始。
  function handleAttackClick() {
    if (!mySlot || isPaused()) return;
    var now = Date.now();
    if (now - comboState.lastHitAt > ATTACK_COMBO_WINDOW_MS) comboState.hitIndex = 0;
    var isThirdHit = comboState.hitIndex === 2;
    var cost = isThirdHit ? STAMINA_COST_ATTACK_THIRD : STAMINA_COST_ATTACK_NORMAL;
    if (!spendStamina(cost)) return;
    comboState.lastHitAt = now;
    var displayHit = comboState.hitIndex + 1;
    comboState.hitIndex = isThirdHit ? 0 : comboState.hitIndex + 1;
    var damage = isThirdHit ? Math.round(ATTACK_BASE_DAMAGE * ATTACK_THIRD_HIT_MULT) : ATTACK_BASE_DAMAGE;
    damageCombatTarget(damage);
    el("midnight-combo-note").textContent = window.I18N.t("midnight_combo_label", { count: displayHit });
  }

  // 戰技A：消耗25體力，即時觸發。目前尚未有正式的戰技效果/傷害數值（使用者只給了體力
  // 消耗），先沿用跟普通攻擊同樣的基礎傷害套用到目前的攻擊目標，等有正式戰技資料時再
  // 取代這裡。
  function handleSkillClick() {
    if (!spendStamina(STAMINA_COST_SKILL)) return;
    damageCombatTarget(ATTACK_BASE_DAMAGE);
  }

  // ---- 角色專屬〔技藝〕〔技能〕（2026-09-05戰鬥優化新增）：對應character_types.js的
  // type.arts[0]／type.skills[0]（例：追蹤者的「襲擊之楔」／「爪擊」），跟上面
  // btn-midnight-skill/skill-b（通用武器戰技demo）是不同東西。比照CLAUDE.md §36
  // 「fake ability entry」與既有demo戰鬥的佔位值模式（ATTACK_BASE_DAMAGE旁的既有注解
  // 已確立「沒有正式公式前用demo佔位值」）：扣次數（用角色物件上的
  // _artUsesRemaining／_skillUsesRemaining追蹤，初始值取自ability.uses）、對目前
  // combat target造成demo佔位傷害、並把完整body文字用showToast()既有機制顯示——
  // 不新增第二套action log系統。----
  var CHARACTER_ABILITY_DAMAGE = ATTACK_BASE_DAMAGE;

  function characterAbilityEntry(kind) {
    var c = characters[myTokenId];
    var type = c && c.typeId ? window.PriTestCharacterTypes.get(c.typeId) : null;
    var ability = type ? (kind === "art" ? (type.arts || [])[0] : (type.skills || [])[0]) : null;
    return { c: c, type: type, ability: ability };
  }

  function useCharacterAbility(kind) {
    if (!mySlot || isPaused()) return;
    var found = characterAbilityEntry(kind);
    if (!found.c || !found.ability) return;
    var field = kind === "art" ? "_artUsesRemaining" : "_skillUsesRemaining";
    var remaining = found.c[field];
    if (remaining === undefined || remaining === null) remaining = found.ability.uses || 0;
    if (remaining <= 0) {
      showToast(window.I18N.t("midnight_character_ability_no_uses_note"));
      return;
    }
    remaining -= 1;
    found.c[field] = remaining;
    GameStorage.rtSet(gameId, "cloud", "character/" + myTokenId + "/" + field, remaining);
    damageCombatTarget(CHARACTER_ABILITY_DAMAGE);
    var CharacterTypes = window.PriTestCharacterTypes;
    showToast(CharacterTypes.localizedText(found.ability.name) + "：" + CharacterTypes.localizedText(found.ability.body));
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
  function renderCharacterActionButtons() {
    var found = characterAbilityEntry("art");
    var artBtn = el("btn-midnight-art");
    artBtn.hidden = !found.ability;
    if (found.ability) el("midnight-art-label").textContent = window.PriTestCharacterTypes.localizedText(found.ability.name);
    var foundSkill = characterAbilityEntry("skill");
    var skillBtn = el("btn-midnight-character-skill");
    skillBtn.hidden = !foundSkill.ability;
    if (foundSkill.ability) el("midnight-character-skill-label").textContent = window.PriTestCharacterTypes.localizedText(foundSkill.ability.name);
  }

  // 扣FP：不足時回傳false、不扣，跟spendStamina()同一種寫法。
  function spendFp(cost) {
    if (!mySlot || isPaused()) return false;
    if (fp.current < cost) return false;
    fp.current -= cost;
    return true;
  }

  // 戰技B（魔術／祈禱，2026-09-05 HUD優化新增）：長按2秒才確定施放，消耗FP。跟
  // bindBlockHoldInput()同款mousedown/touchstart開始、mouseup/touchend/leave結束的
  // pattern，差別是放開時如果還沒滿2秒＝取消（不消耗、不觸發），滿2秒由updateSorceryHold()
  // 判定並觸發，而不是放開的當下判定——這樣「長按满2秒」跟「放開」是兩件獨立的事，符合
  // 使用者規格「長按著2s才確定使用並消耗相應FP」。
  function bindSkillBHoldInput() {
    var btn = el("btn-midnight-skill-b");
    btn.addEventListener("mousedown", startSkillBHold);
    btn.addEventListener("mouseup", endSkillBHold);
    btn.addEventListener("mouseleave", endSkillBHold);
    btn.addEventListener(
      "touchstart",
      function (e) {
        e.preventDefault();
        startSkillBHold();
      },
      { passive: false }
    );
    btn.addEventListener("touchend", endSkillBHold);
    btn.addEventListener("touchcancel", endSkillBHold);
  }

  function startSkillBHold() {
    if (!mySlot || isPaused() || sorceryHoldStartAt !== null) return;
    if (fp.current < FP_COST_SORCERY) return;
    sorceryHoldStartAt = Date.now();
  }

  function endSkillBHold() {
    sorceryHoldStartAt = null; // 未滿SORCERY_CAST_HOLD_MS前放開＝取消，不消耗不觸發
  }

  // 長按滿SORCERY_CAST_HOLD_MS才真正觸發：跟A用同一套佔位傷害整合方式（damageCombatTarget
  // 打的目標判斷跟A完全相同），傷害公式本身仍不在這次milestone範圍內。
  function updateSorceryHold(now) {
    if (sorceryHoldStartAt === null) return;
    if (now - sorceryHoldStartAt < SORCERY_CAST_HOLD_MS) return;
    sorceryHoldStartAt = null; // 先清掉避免同一次長按重複觸發
    if (!spendFp(FP_COST_SORCERY)) return;
    damageCombatTarget(ATTACK_BASE_DAMAGE);
  }

  // 迴避：消耗10體力。體力不足時spendStamina()會回傳false、不記錄這次迴避時間點，等於
  // 這次迴避沒有真正生效——見resolveMyIncomingHit()判定「這一擊有沒有被成功迴避」。
  function handleDodgeClick() {
    if (!spendStamina(STAMINA_COST_DODGE)) return;
    dodgePressedAt = Date.now();
  }

  // 防禦：長按觸發（滑鼠/觸控），持有期間體力不回復（使用者規則）。「成功防禦」要扣5
  // 體力，實際判定在resolveMyIncomingHit()：敵人攻擊的反應窗口內只要blockHolding為
  // true就算擋到，若當下體力不足以扣STAMINA_COST_BLOCK_SUCCESS則防禦失敗、視同沒擋到。
  // 另外使用者規則要求「擁有雙持技能以及盾牌才能使用」，但目前角色沒有裝備/技能系統
  // 可以檢查，所以先不擋（所有玩家都能按），之後有裝備資料時要在這裡補上判定。
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

  function startBlockHold() {
    if (!mySlot || isPaused()) return;
    blockHolding = true;
  }

  function endBlockHold() {
    blockHolding = false;
  }

  // 聖杯瓶（2026-09-05 HUD優化改版）：按下不會立刻生效，先開始0.6秒讀取（卡片上方讀取
  // 條，見renderCharPanel／CSS），讀取完才真正扣次數＋回血——使用者明確規格「讀取完
  // 0.6s才確定使用並回復血量」。剩餘數不足或已經在讀取中時直接no-op。
  function handleUseFlaskClick() {
    if (!mySlot || isPaused() || flaskReadingUntil !== null) return;
    var res = characters[myTokenId];
    if (!res || res.flaskCount <= 0) return;
    flaskReadingUntil = Date.now() + FLASK_READ_MS;
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
    GameStorage.rtTransaction(gameId, "cloud", "demoStat/" + myTokenId, function (cur) {
      var next = (cur === null ? 100 : cur) + FLASK_HEAL_AMOUNT;
      return next > 100 ? 100 : next;
    });
  }

  // 消耗品快速使用卡片（2026-09-05 HUD優化新增）：固定使用陣列第0筆（＝目前的「快速
  // 使用」道具，見規劃紀錄設計取捨——要更換快速道具，從角色面板的消耗品清單按「設為
  // 快速使用」，見renderCharacterSheet()）。依CLAUDE.md §19/§32原則，這裡不計算實際
  // 效果數值，只扣一次使用次數＋用showToast()顯示該道具的規則書原文，交由玩家/GM自行
  // 判斷套用效果，比照night.js遇到未定效果時的既有作法。
  function handleUseQuickConsumableClick() {
    if (!mySlot || isPaused()) return;
    var c = characters[myTokenId];
    var inst = c && c.consumables && c.consumables[0];
    if (!inst) return;
    var item = window.PriTestConsumables.get(inst.itemId);
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
      showToast(window.PriTestConsumables.localizedText(item.name) + "：" + window.PriTestConsumables.localizedText(item.body));
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

  // 武器快速切換卡片（左／右，2026-09-05 HUD優化新增）：純粹循環切換
  // c.equippedWeaponIdL/R這兩個顯示用欄位，不影響handleAttackClick/handleSkillClick的
  // 實際傷害（那兩個函式仍是ATTACK_BASE_DAMAGE佔位值，武器對戰鬥數值的整合不在這次
  // milestone範圍內，見規劃紀錄）。存weaponId字串而非index，避免merchant/reward對
  // weaponIds陣列增刪時卡片顯示的武器跟著錯位。
  function cycleEquippedWeapon(side) {
    if (!mySlot || isPaused()) return;
    var c = characters[myTokenId];
    var ids = (c && c.weaponIds) || [];
    if (ids.length === 0) return;
    var field = side === "L" ? "equippedWeaponIdL" : "equippedWeaponIdR";
    var cur = c[field] || ids[0];
    var idx = ids.indexOf(cur);
    var next = ids[(idx + 1) % ids.length];
    c[field] = next; // 樂觀更新本地顯示，RTDB回傳後onCharactersReceived會再覆寫一次同樣的值
    GameStorage.rtSet(gameId, "cloud", "character/" + myTokenId + "/" + field, next);
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

  // 時間到了就發動下一次攻擊：目標選擇分三層機率（敵視>單體>多人，使用者明確規格的
  // 相對順序，實際權重是demo佔位值），攻擊次數依ENEMY_ATTACK_HIT_COUNT_WEIGHTS決定。
  // 整段在transaction()裡面做，確保「決定攻擊了沒」跟「決定打誰/打幾下」是同一次原子
  // 操作，不會有兩個裝置同時各自發動一次攻擊的競態。
  function maybeStartEnemyAttack(pt, trig, now) {
    if (trig.enemyAttack) {
      enemyAttackStartAttempted[pt.id] = false; // 攻擊已經發動了（不論是不是自己發動的），下次空窗期要能再嘗試一次
      return;
    }
    if (!trig.nextAttackAt || now < trig.nextAttackAt) return;
    if (enemyAttackStartAttempted[pt.id]) return;
    enemyAttackStartAttempted[pt.id] = true;
    GameStorage.rtTransaction(gameId, "cloud", "fieldTrigger/" + pt.id, function (cur) {
      if (!cur || cur.enemyAttack) return cur;
      if (!cur.nextAttackAt || Date.now() < cur.nextAttackAt) return cur;
      var slots = participantSlots(cur);
      if (!slots.length) return cur;
      var aggroSlot = aggroHolderSlot(cur);
      var mode = "single";
      if (aggroSlot && slots.length > 1) {
        var modeIdx = pickWeightedIndex(Math.random(), [
          ENEMY_ATTACK_TARGET_WEIGHT_AGGRO,
          ENEMY_ATTACK_TARGET_WEIGHT_SINGLE,
          ENEMY_ATTACK_TARGET_WEIGHT_MULTI,
        ]);
        mode = modeIdx === 0 ? "aggro" : modeIdx === 1 ? "single" : "multi";
      }
      if (mode === "multi" && slots.length < 2) mode = "single"; // 人數不夠鎖定多人時退回單體
      var targetSlots;
      if (mode === "aggro") {
        targetSlots = [aggroSlot];
      } else if (mode === "single") {
        targetSlots = [slots[Math.floor(Math.random() * slots.length)]];
      } else {
        // 多人一起攻擊：使用者原話「2人3人都有可能」，人數足夠時隨機選2或3人。
        var count = slots.length >= 3 ? (Math.random() < 0.5 ? 2 : 3) : 2;
        var pool = slots.slice();
        targetSlots = [];
        for (var i = 0; i < count && pool.length; i++) {
          targetSlots.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
        }
      }
      var hitCount = pickWeightedIndex(Math.random(), ENEMY_ATTACK_HIT_COUNT_WEIGHTS) + 1;
      var out = {};
      for (var k in cur) out[k] = cur[k]; // ES5：手動合成，跟maybeResolveFieldVote()同樣手法
      out.enemyAttack = {
        attackId: pt.id + ":" + Date.now(),
        targetSlots: targetSlots,
        hitCount: hitCount,
        warnAt: Date.now(),
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
    if (dodged || blockHolding) {
      resolveMyIncomingHit(st, dodged ? "dodge" : "block");
      return;
    }
    if (now >= st.phaseEndAt) resolveMyIncomingHit(st, "hit");
  }

  function resolveMyIncomingHit(st, kind) {
    if (kind === "block" && !spendStamina(STAMINA_COST_BLOCK_SUCCESS)) kind = "hit"; // 體力不足，防禦失敗
    if (kind === "hit") {
      GameStorage.rtTransaction(gameId, "cloud", "demoStat/" + myTokenId, function (cur) {
        var next = (cur === null ? 100 : cur) - ENEMY_ATTACK_DAMAGE;
        return next < 0 ? 0 : next;
      });
    }
    dodgePressedAt = 0; // 這次按鍵已經用掉，避免同一次按鍵被下一擊重複判定成功
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

  // 攻擊特效：刀光劍影／野獸爪痕撕裂動作二選一（使用者明確規格），純視覺、跟命中結果
  // 無關——敵人這一下本來就會「打出來」，玩家迴避/防禦成功與否只影響有沒有真的扣血。
  function triggerAttackEffect() {
    var effectEl = el("midnight-attack-effect");
    effectEl.className = Math.random() < 0.5 ? "midnight-attack-effect-slash" : "midnight-attack-effect-claw";
    effectEl.hidden = false;
    if (attackEffectTimer) clearTimeout(attackEffectTimer);
    attackEffectTimer = setTimeout(function () {
      effectEl.hidden = true;
      effectEl.className = "";
    }, ATTACK_EFFECT_DISPLAY_MS);
  }

  // 警示圖示：只在phase==="warn"（攻擊發動前0.5秒）顯示，CSS負責閃爍動畫本身。
  function renderEnemyAttackOverlay() {
    el("midnight-incoming-attack-warning").hidden = !(myIncomingAttack && myIncomingAttack.phase === "warn");
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
    if (!mySlot || isPaused() || towerSolved[pt.id] || towerInvites[pt.id] || towerEnterAttempted[pt.id]) return;
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
  // 這三型是新籌碼點（merchant／strong_enemy／random_event，見updateNearbyChipPoint()），
  // 跟field卡牌點各自獨立的proximity/流程，不能被這裡的「進入」流程誤判。
  var NON_FIELD_POINT_TYPES = { sorcerer: true, merchant: true, strong_enemy: true, random_event: true };

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
    var candidate = nearbyFieldPoint || nearbyStrongEnemy || nearbyCastlePoint;
    if (!candidate) {
      activeEncounter = null;
      return;
    }
    var trig = fieldTriggers[candidate.id];
    var amParticipant = !!(trig && trig.participants && trig.participants[mySlot]);
    var hp = fieldEnemyHp[candidate.id];
    activeEncounter =
      trig && trig.status === "resolved" && amParticipant && trig.enemyFamilyId && (hp === undefined || hp > 0) ? candidate : null;
  }

  // 按下「進入」：建立這個點的事件紀錄，發起人自己直接算第一個參與者。用transaction()
  // 保證多裝置幾乎同時按到同一個點時只有一份紀錄生效（跟maybeTriggerLobbyCountdown()
  // 同樣的併發安全模式）。
  function handleEnterFieldPointClick(pt) {
    if (!mySlot || isPaused() || fieldTriggers[pt.id] || fieldEnterAttempted[pt.id]) return;
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
  // 而卡住不動）。分歧變體（branchIndex）在這一刻決定性挑定，之後不會再變。
  function maybeAdvanceFieldInvite(pt) {
    var trig = fieldTriggers[pt.id];
    if (!trig || trig.status !== "inviting" || fieldInviteResolveAttempted[pt.id]) return;
    if (Date.now() < trig.inviteDeadline) return;
    fieldInviteResolveAttempted[pt.id] = true;
    var branchIndex = pickFieldBranchIndex(pt);
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
        floorIndex: 0,
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
  // 「這個板塊會遇到哪隻敵人」用的是同一套解析，不是自己另外亂數選。
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
        matches.push(match);
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
    GameStorage.rtTransaction(gameId, "cloud", "fieldEnemyHp/" + pt.id, function (cur) {
      return cur === null ? FIELD_ENEMY_HP_DEFAULT : cur;
    });
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
      else if (pt.type === "blessing" && !blessing && !blessingClaimed[pt.id]) blessing = pt;
    });

    nearbyMerchant = merchant;
    el("midnight-merchant-prompt").hidden = !merchant;

    nearbyBlessing = blessing;
    el("midnight-blessing-prompt").hidden = !blessing;

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
        return cur === null ? FIELD_ENEMY_HP_DEFAULT : cur;
      });
    });
  }

  function handleStrongEnemyEnterClick() {
    if (!mySlot || isPaused() || !nearbyStrongEnemy) return;
    var trig = fieldTriggers[nearbyStrongEnemy.id];
    if (!trig || trig.status !== "resolved") return;
    GameStorage.rtSet(gameId, "cloud", "fieldTrigger/" + nearbyStrongEnemy.id + "/participants/" + mySlot, true);
  }

  // ---- 祝福籌碼：靠近後可直接領取，用跟towerSolved完全同款的transaction()
  // first-writer-wins寫法避免多人同時領到同一個。祝福籍碼在event_rulebook.js／
  // fields_data_*.js都查無對應的效果數字，依CLAUDE.md §19原則不可自行發明數值，因此
  // 領取成功後只提示「效果由GM依規則書處理」，不套用任何自動數值變化（見規劃紀錄）。----
  function handleBlessingClaimClick() {
    if (!mySlot || isPaused() || !nearbyBlessing) return;
    var pointId = nearbyBlessing.id;
    GameStorage.rtTransaction(gameId, "cloud", "blessingClaimed/" + pointId, function (cur) {
      return cur ? cur : { claimedBy: myTokenId };
    }).then(function (committed) {
      if (committed && committed.claimedBy === myTokenId) {
        showToast(window.I18N.t("midnight_blessing_claim_note"));
      }
    });
  }

  // ---- 丟棄物撿取（2026-09-05角色面板優化新增）：跟updateNearbyTower()同款proximity
  // pattern，半徑沿用TOWER_ACTIVATE_RADIUS同量級的GROUND_ITEM_PICKUP_RADIUS。----
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
  }

  // 撿取也受6/4/2上限限制（使用者確認的硬上限規格）：滿了要先在角色面板丟棄才能撿。
  // 用transaction()寫groundItems/{id}/pickedUpBy當first-writer-wins仲裁，避免兩人同時
  // 撿到同一個掉落物——跟towerSolved／blessingClaimed同一套手法（寫入標記而不是直接
  // 刪除節點，因為這個repo既有的rtTransaction()用法都是「寫值」不是「刪節點」，維持
  // 一致的既有pattern）。撿走後的掉落物在渲染/proximity判斷都視為不存在（見
  // updateNearbyGroundItem()的pickedUpBy檢查／drawGroundItemMarker()呼叫端過濾）。
  function handlePickupGroundItem() {
    if (!mySlot || isPaused() || !nearbyGroundItem) return;
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
        var instId = window.PriTestCharacterDrawer.makeConsumableInstanceId(data.itemId, c2);
        c2.consumables = (c2.consumables || []).concat([{ id: instId, itemId: data.itemId, usesRemaining: data.usesRemaining || 1 }]);
        GameStorage.rtSet(gameId, "cloud", "character/" + myTokenId + "/consumables", c2.consumables);
      }
    });
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
    if (data) {
      el("midnight-strong-enemy-image").src = window.PriTestEnemies.imagePath(data.enemy, "../static/");
      el("midnight-strong-enemy-image").alt = name;
    }
    var amParticipant = !!(trig.participants && trig.participants[mySlot]);
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

  function openMerchantModal() {
    if (!nearbyMerchant) return;
    el("midnight-merchant-weapon-result").textContent = "";
    el("midnight-merchant-consumable-result").textContent = "";
    renderMerchantRuneNote();
    renderMerchantConsumableList();
    el("midnight-merchant-modal").hidden = false;
  }

  function closeMerchantModal() {
    el("midnight-merchant-modal").hidden = true;
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
    // 其餘loot kind（stoneswordKey／smithingStone／potentialPower／weaponSkillReroll／
    // chaliceBonus）midnight角色物件目前沒有對應欄位，本次milestone先略過，不阻塞其餘
    // 品項的授予（不是bug，是已知範圍限制，見規劃紀錄）。
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

  // potentialPower（得意武器／附帶效果擇一，對應使用者追加需求）：兩邊各自可重抽，
  // 選定其中一邊才真正commit——commitPotentialPowerWeapon／commitAttachedEffectChoice
  // 都是character_drawer.js既有純函式，直接對characters[myTokenId]操作。
  function renderPotentialPowerRewardDetail(id, entry, detail) {
    if (!potentialPowerDraftById[id]) potentialPowerDraftById[id] = { weapon: null, effect: null };
    var draft = potentialPowerDraftById[id];
    var CD = window.PriTestCharacterDrawer;

    var weaponSection = document.createElement("div");
    var weaponBtn = document.createElement("button");
    weaponBtn.type = "button";
    weaponBtn.textContent = window.I18N.t("midnight_reward_potential_draw_weapon_button");
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
    effectBtn.addEventListener("click", function () {
      var c = characters[myTokenId];
      if (c) draft.effect = CD.rollPotentialPowerAttachedEffect(c);
      renderRewardDetail(id, entry);
    });
    effectSection.appendChild(effectBtn);
    var resolvedEffect = draft.effect && (draft.effect.effect || (draft.effect.candidates && draft.effect.candidates[0]));
    if (resolvedEffect) {
      var effectLabel = document.createElement("p");
      effectLabel.textContent = window.PriTestCharacterTypes.localizedText(resolvedEffect.name);
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

  function renderRewardDetail(id, entry) {
    var detail = el("midnight-reward-detail");
    detail.innerHTML = "";
    if (entry.kind === "potentialPower") {
      renderPotentialPowerRewardDetail(id, entry, detail);
      return;
    }
    if (!rewardDraftById[id]) rewardDraftById[id] = computeRewardDraw(entry);
    var draft = rewardDraftById[id];
    var resultText = document.createElement("p");
    resultText.textContent = draft.label;
    detail.appendChild(resultText);
    // 持有量硬上限（2026-09-05角色面板優化新增）：weapon/consumable/talisman三種entry
    // 對應角色面板的6/4/2格上限，滿了就不給確認收下，提示先去角色面板丟棄騰出空間——
    // 獎勵本身仍留在待處理清單裡，之後騰出空間再回來點確認即可，不會憑空遺失。
    var inventoryKind = entry.kind === "weapon" || entry.kind === "consumable" || entry.kind === "talisman" ? entry.kind : null;
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

  function openCharacterSheetModal() {
    characterSheetSelection = null;
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

    renderAbilityList(el("midnight-character-sheet-skills"), type && type.skills, "skill", CharacterTypes);
    renderAbilityList(el("midnight-character-sheet-arts"), type && type.arts, "art", CharacterTypes);
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
      dropBtn.textContent = window.I18N.t("midnight_sheet_discard_button");
      dropBtn.addEventListener("click", function () {
        dropInventoryItem(kind, id);
        characterSheetSelection = null;
        renderCharacterSheet();
      });
      detail.appendChild(dropBtn);
    }

    if (sel.kind === "weapon") {
      var w = window.PriTestWeapons.get(baseCatalogId(sel.ref));
      if (!w) return;
      appendNameBody(window.PriTestWeapons.localizedText(w.name) + "（" + w.rarity + "）", window.PriTestWeapons.localizedText(w.body || {}));
      var artInfo = CD.computeArtPower(c, sel.ref);
      if (artInfo) {
        var powerP = document.createElement("p");
        powerP.textContent = window.I18N.t("midnight_character_sheet_power", { value: artInfo.artPower });
        detail.appendChild(powerP);
      }
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

    if (!trig) {
      enterPrompt.hidden = false;
      invitePrompt.hidden = true;
      banner.hidden = true;
      el("midnight-field-enter-name").textContent = locationName;
      el("btn-midnight-field-enter").disabled = !mySlot || isPaused();
      return;
    }
    enterPrompt.hidden = true;

    var amParticipant = !!(trig.participants && trig.participants[mySlot]);

    if (trig.status === "inviting") {
      banner.hidden = true;
      if (amParticipant) {
        invitePrompt.hidden = true; // 我已經是參與者（發起人自己），等active階段的banner接手
        return;
      }
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
    el("midnight-field-banner-name").textContent = locationName;

    if (Date.now() < trig.enterAt + FIELD_ENTER_WAIT_MS) {
      el("midnight-field-narrative-text").textContent = "";
      el("midnight-field-vote-panel").hidden = true;
      return;
    }

    renderFieldVoteOrResult(pt, trig);
  }

  function renderFieldVoteOrResult(pt, trig) {
    var votePanel = el("midnight-field-vote-panel");
    if (!fieldTypewriterDoneFor[pt.id]) {
      votePanel.hidden = true; // 打字機還在播（文字內容由maybeStartFieldTypewriter驅動），先不顯示投票/結果
      return;
    }
    var labels = fieldChoiceLabelsFor(pt, trig);
    votePanel.hidden = false;
    if (trig.status === "resolved" || labels.length <= 1) {
      el("midnight-field-vote-options").innerHTML = "";
      el("midnight-field-vote-timer").textContent = "";
      var hp = fieldEnemyHp[pt.id];
      if (trig.enemyFamilyId && hp !== undefined && hp <= 0) {
        el("midnight-field-vote-status").textContent = window.I18N.t("midnight_field_encounter_cleared_note");
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
    var hp = demoStats[myTokenId];
    setBar("midnight-self-hp-fill", "midnight-self-hp-value", hp === undefined ? 100 : hp, 100);
    setBar("midnight-self-stamina-fill", "midnight-self-stamina-value", stamina.current, stamina.max);
    setBar("midnight-self-fp-fill", "midnight-self-fp-value", fp.current, fp.max);
    var res = characters[myTokenId] || { runes: 0, flaskCount: FLASK_MAX_DEFAULT, flaskMax: FLASK_MAX_DEFAULT };
    el("midnight-self-rune-value").textContent = res.runes;
    el("midnight-flask-count").textContent = window.I18N.t("midnight_flask_remaining", { count: res.flaskCount });
    el("btn-midnight-use-flask").disabled = res.flaskCount <= 0 || flaskReadingUntil !== null;
    renderFlaskReadBar();
    renderSorceryCastBar();
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

  function renderSorceryCastBar() {
    var fillEl = el("midnight-skill-b-cast-fill");
    if (!fillEl) return;
    if (sorceryHoldStartAt === null) {
      fillEl.style.width = "0%";
      return;
    }
    var elapsed = Date.now() - sorceryHoldStartAt;
    fillEl.style.width = Math.max(0, Math.min(100, (elapsed / SORCERY_CAST_HOLD_MS) * 100)) + "%";
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
    var effectiveId = weaponId || ids[0];
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
      var raw = fieldEnemyHp[activeEncounter.id];
      hp = raw === undefined ? FIELD_ENEMY_HP_DEFAULT : raw;
      max = FIELD_ENEMY_HP_DEFAULT;
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
    el("btn-midnight-attack-shared-target").disabled = !canAct || stamina.current < STAMINA_COST_ATTACK_NORMAL;
    el("btn-midnight-skill").disabled = !canAct || stamina.current < STAMINA_COST_SKILL;
    el("btn-midnight-skill-b").disabled = !canAct || fp.current < FP_COST_SORCERY;
    el("btn-midnight-dodge").disabled = !canAct || stamina.current < STAMINA_COST_DODGE;
    renderFieldEncounterPanel(usingEncounter);
  }

  // 敵人圖片/名稱：直接讀static_src/enemies_data_1~4.js既有資料（window.PriTestEnemies），
  // 不是自己另外畫的圖或編的名字。用lastRenderedEncounterKey擋掉「同一隻敵人每影格都
  // 重設一次img.src」（會造成瀏覽器重複要求同一張圖、偶爾閃爍）。
  function renderFieldEncounterPanel(usingEncounter) {
    var box = el("midnight-field-encounter");
    if (!usingEncounter) {
      box.hidden = true;
      lastRenderedEncounterKey = null;
      return;
    }
    box.hidden = false;
    var trig = fieldTriggers[activeEncounter.id] || {};
    var key = trig.enemyFamilyId + ":" + trig.enemyId;
    if (key === lastRenderedEncounterKey) return;
    lastRenderedEncounterKey = key;
    var data = window.PriTestEnemies ? window.PriTestEnemies.get(trig.enemyFamilyId, trig.enemyId) : null;
    if (!data) return;
    var name = window.PriTestEnemies.localizedText(data.enemy.name);
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
  var mapIconNudge = false; // 戰鬥剛結束、提示玩家點地圖圖示重新展開（見recomputeActiveEncounter呼叫處）
  var wasInActiveEncounter = false; // 偵測activeEncounter「有→無」邊緣用，見frame()

  // 地圖收合／展開（2026-09-05 HUD優化改版）：拿掉舊版「縮小顯示尺寸但仍可見」的
  // 中間態（.midnight-canvas-mini），改成跟既有tower/merchant modal同款的「整個
  // #midnight-map-panel用position:fixed全螢幕疊層，hidden屬性控制顯示/隱藏」——
  // 展開＝拿掉hidden（可以看到、可以移動），收合＝加上hidden（畫面上完全看不到，
  // 只剩HUD右上角的地圖圖示按鈕）。不再有「縮小但看得到」的第三態。
  function setMapExpanded(expanded) {
    mapExpanded = expanded;
    el("midnight-map-panel").hidden = !expanded;
    if (expanded) mapIconNudge = false; // 玩家點開地圖後，提示動畫的任務就完成了
    renderMapIcon();
  }

  function renderMapIcon() {
    var btn = el("btn-midnight-map-icon");
    if (!btn) return;
    btn.classList.toggle("midnight-map-icon-nudge", mapIconNudge && !mapExpanded);
  }

  function tryMove(dx, dy) {
    var nx = localPos.x + dx;
    var ny = localPos.y + dy;
    // 分離X/Y軸各自檢查，讓角色可以沿著牆滑動（其中一軸卡牆、另一軸仍可移動），
    // 手感比「整個位移一起被牆擋死」更接近一般即時制動作遊戲。
    if (Map_.isWalkable(map, nx, localPos.y)) localPos.x = nx;
    if (Map_.isWalkable(map, localPos.x, ny)) localPos.y = ny;
  }

  function updateMovement(dtSec) {
    // 觀戰者（沒有席位）或遊戲暫停中都不能移動——觀戰限制是「多的人變成觀戰而不能做任何
    // 操作」的要求，暫停限制是「全部人無法動作」的要求。使用者明確規格（2026-09-06）：
    // 縮小地圖時要無法移動角色，只限定「展開地圖」時才能移動——不是bug，是刻意的設計
    // （之前2026-09-05的修正誤把這個規則當成bug修掉了，這裡改回來）。
    if (!mySlot || isPaused() || !mapExpanded) return;
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

  // ---- 「第二天」／「第三天」／「重新」按鈕：都是寫進共享的meta，任何一台裝置按下
  // 就對所有裝置同時生效（跟其他meta欄位一樣透過RTDB訂閱同步），不是只有按的人自己看到
  // 變化。進入新一天時同時清空meta.pause——currentPhaseInfo()是用
  // 「effectiveNow(now) - 該天的StartAt」算elapsed，如果不清空，前一天累積的
  // totalPausedMs會被重複扣一次（那段暫停發生在新天的StartAt之前，跟新的一天無關）。----
  function handleAdvanceToDay2() {
    GameStorage.rtSet(gameId, "cloud", "meta/day2StartAt", Date.now());
    GameStorage.rtSet(gameId, "cloud", "meta/pause", null);
  }

  function handleAdvanceToDay3() {
    GameStorage.rtSet(gameId, "cloud", "meta/day3StartAt", Date.now());
    GameStorage.rtSet(gameId, "cloud", "meta/pause", null);
  }

  function handleRestartCycle() {
    GameStorage.rtSet(gameId, "cloud", "meta", {
      mapSeed: meta.mapSeed,
      createdAt: meta.createdAt,
      sessionStartAt: Date.now(),
    });
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
    GameStorage.rtTransaction(gameId, "cloud", "demoStat/" + myTokenId, function (cur) {
      var next = (cur === null ? 100 : cur) - 1;
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
  }

  // 地圖上的點畫成小張撲克牌（背景卡片＋牌面數字/K），對應midnight_map.js抽牌生成
  // 邏輯，讓玩家能直接看出這個點是哪張牌，而不只是一個色點。
  //
  // 「完全攻破」判定（2026-09-05籌碼優化新增）：不同type各自對應既有的解決狀態欄位，
  // 全部重用既有RTDB資料，不另外發明第二套「完成」旗標：
  //   sorcerer：towerSolved[pt.id]存在。
  //   strong_enemy：fieldTriggers[pt.id]已揭露敵人(enemyFamilyId)且fieldEnemyHp<=0。
  //   blessing：blessingClaimed[pt.id]存在（見handleBlessingClaimClick()）。
  //   一般地點卡（2~10/K/J）：fieldTriggers[pt.id].status==="resolved"，若該分歧有指派
  //     敵人則額外要求fieldEnemyHp<=0（和平結局視為直接攻破）。
  //   merchant／random_event：沒有單一「攻破」結果（商人可重複使用、聖甲蟲各玩家各自
  //     判定成功/失敗），不畫X。
  function isPointCleared(pt) {
    if (pt.type === "sorcerer") return !!towerSolved[pt.id];
    if (pt.type === "blessing") return !!blessingClaimed[pt.id];
    if (pt.type === "merchant" || pt.type === "random_event") return false;
    var trig = fieldTriggers[pt.id];
    if (pt.type === "strong_enemy") {
      return !!(trig && trig.enemyFamilyId && fieldEnemyHp[pt.id] <= 0);
    }
    if (!trig || trig.status !== "resolved") return false;
    if (trig.enemyFamilyId) return fieldEnemyHp[pt.id] <= 0;
    return true;
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
      if (revealedLabel) {
        // 已揭露：不再畫icon，改畫名稱標籤（跟一般地點卡一樣的標籤樣式，垂直置中在
        // 原本icon的位置，而不是icon下方——這個型別本來就沒有卡片本體可以貼在下面）。
        drawNameLabel(px, py - CELL * 0.34, revealedLabel);
      } else if (icon.complete && icon.naturalWidth > 0) {
        ctx.drawImage(icon, px - chipSize / 2, py - chipSize / 2, chipSize, chipSize);
        var chipNameInfo = Map_.CHIP_TYPE_NAMES[pt.type];
        // 祝福籌碼一開始就顯示名稱（使用者明確規格），強敵/隨機事件揭露前維持純icon。
        if (pt.type === "blessing" && chipNameInfo) {
          drawNameLabel(px, py + chipSize / 2 + 2, chipNameInfo.zh);
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
    var cw = CELL * 1.3;
    var ch = CELL * 1.7;
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

  function drawSpiritBirdMarker(bird) {
    var px = (bird.x + 0.5) * CELL;
    var py = (bird.y + 0.5) * CELL;
    ctx.save();
    ctx.fillStyle = "rgba(160, 220, 255, 0.9)";
    ctx.strokeStyle = "#0c3a52";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px, py - CELL * 0.45);
    ctx.lineTo(px + CELL * 0.4, py + CELL * 0.25);
    ctx.lineTo(px, py + CELL * 0.08);
    ctx.lineTo(px - CELL * 0.4, py + CELL * 0.25);
    ctx.closePath();
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
      ctx.strokeStyle = "#0c0f14";
      ctx.lineWidth = 1.5;
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

  // 除了更新HUD文字，也負責顯示/隱藏「第二天」「第三天」「重新」三個按鈕——它們只在
  // 對應的stage才看得到，而不是一直顯示，避免玩家在不該按的時間點誤按。
  function renderDayPhaseHud(phaseInfo) {
    var elText = el("midnight-hud-day-phase");
    el("btn-midnight-advance-day2").hidden = phaseInfo.stage !== "waitingForDay2";
    el("btn-midnight-advance-day3").hidden = phaseInfo.stage !== "waitingForDay3";
    el("btn-midnight-restart-cycle").hidden = phaseInfo.day !== 3;

    if (phaseInfo.day === 3) {
      elText.textContent = window.I18N.t("midnight_day3_note");
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
    updateMovement(dtSec);
    updateNearbyBird();
    updateNearbyTower();
    updateNearbyFieldPoint();
    updateNearbyChipPoint();
    updateNearbyCastle();
    updateNearbyGroundItem();
    updateEnemyAttack(now);
    updateStamina(dtSec);
    updateSorceryHold(now);
    updateFlaskReading(now);
    updatePuzzleTimer(now);
    maybePushPosition(now);
    var phaseInfo = currentPhaseInfo(now);
    maybeApplyCircleDamage(now, phaseInfo);
    render(now, phaseInfo);
    renderCharPanel();
    renderCombatPanel();
    renderCharacterActionButtons();
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

  function startLoop() {
    requestAnimationFrame(frame);
  }

  document.addEventListener("DOMContentLoaded", function () {
    canvas = el("midnight-canvas");
    ctx = canvas.getContext("2d");
    canvas.width = GRID * CELL;
    canvas.height = GRID * CELL;

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
    GameStorage.rtSubscribe(gameId, "cloud", "groundItems", onGroundItemsReceived);
    GameStorage.rtSubscribe(gameId, "cloud", "fieldTrigger", onFieldTriggersReceived);
    GameStorage.rtSubscribe(gameId, "cloud", "fieldEnemyHp", onFieldEnemyHpReceived);
    GameStorage.rtSubscribe(gameId, "cloud", "pendingRewards", onPendingRewardsReceived);
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
        sorceryHoldStartAt: sorceryHoldStartAt,
        flaskReadingUntil: flaskReadingUntil,
      };
    },
  };
})();
