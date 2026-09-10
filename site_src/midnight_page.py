"""midnight（即時制擴張版）ページを組み立てる。

これは正式なゲームではなく、擴張版本編の前段として必要な技術リスク
（canvas+requestAnimationFrame連續渲染／複數裝置同時修改同一數値時RTDB
transaction()原子操作）を検証するための最小構成ページ。地圖は固定佈局（seedは
地圖上の點位置と縮圈中心錨點のランダム決定にのみ使用）。

2026-09-05追加、2026-09-06改版：地圖上の點に近づくと「地點名稱＋進入ボタン」を表示、
押すと周囲のプレイヤーへ3秒間の参加招待を送り、招待終了後に正式に進入（参加者のみ）。
参加者全員で0.5秒待ってからstatic_src/fields_data_1~4.jsの既有樓層【描写】敘述を
static_src/night_gm_flow.jsのtypewriteInto()で打字機表示し、同じく既有の
parseChoiceLabels()で「(→XXX)」分歧標記を抽出して投票選択肢にする。分歧の確定は
「その事件の参加者全員」が同じ選択肢を選ぶまで（または10秒逾時で系統決定）。確定後は
選んだ分歧段落の文字からnight_gm_flow.js既有のparseCombatEnemyRef／
resolveCombatEnemyMatchで（night本来の「この板塊で遭遇する敵」判定と同じロジックで）
static_src/enemies_data_1~4.jsの敵人を割り当て、画像付きで遭遇戦に入る（見つからなけ
れば戦闘なしの平和な結果）——ただし実際の攻防判定はmidnightが元々持っていた即時制
demo戦鬥（普通攻撃連段／戦技／迴避／防禦、体力制）をそのまま流用しており、正式な
傷害公式統合はまだこのmilestoneの範囲外のまま。

2026-09-05再改版：地圖に商人／強敵／隨機事件（聖甲蟲）の3種類の新籌碼點を追加し、
角色屬性管理（static_src/character_drawer.jsのnewCharacter()と同形狀の角色物件、
RTDBパスcharacter/{tokenId}）を新設した。武器/消耗品/護符の獲得はCharacterDrawer
既有のmerchantDrawWeapon／makeConsumableInstanceId／potentialPowerDrawWeapon／
rollPotentialPowerAttachedEffect／commitPotentialPowerWeapon／
commitAttachedEffectChoiceを直接再利用しており、実際の戦闘傷害公式・角色レベルアップ
UI自体はこのmilestoneの範囲外のまま（詳細は
`C:\\Users\\autum\\.claude\\plans\\pure-strolling-mochi.md` 参照）。

実際のロジックは static/midnight_map.js（地圖生成）・static/midnight.js
（session／canvas描画／即時移動同步／縮圈／RTDB連携）が担当する。
"""

from __future__ import annotations

from site_src.layout import page_shell

BODY = """    <div class="midnight-wrap">
      <h1 data-i18n="midnight_title"></h1>
      <p class="threat-ref-body" data-i18n="midnight_tech_demo_note"></p>

      <div id="midnight-start-screen">
        <button type="button" id="btn-midnight-create" class="primary-btn" data-i18n="midnight_create_button"></button>
        <p class="threat-ref-body" data-i18n="midnight_join_hint"></p>
      </div>

      <div id="midnight-share-panel" hidden>
        <div class="wb-row">
          <span data-i18n="midnight_share_link_label"></span>
          <input type="text" id="midnight-share-link" readonly>
        </div>
      </div>

      <div id="midnight-lobby" hidden>
        <h2 data-i18n="midnight_lobby_title"></h2>
        <div id="midnight-lobby-slots"></div>
        <div id="midnight-lobby-join-form" hidden>
          <div class="wb-row">
            <input type="text" id="midnight-lobby-name-input" maxlength="12">
          </div>
          <div class="wb-row" id="midnight-lobby-character-picker"></div>
          <div class="wb-row">
            <input type="password" id="midnight-lobby-passcode-input" maxlength="4" inputmode="numeric" pattern="[0-9]{4}">
            <button type="button" id="btn-midnight-lobby-join" data-i18n="midnight_lobby_join_button"></button>
          </div>
          <p class="threat-ref-body" data-i18n="midnight_lobby_passcode_hint"></p>
        </div>
        <!-- 角色詳細資訊視窗（2026-09-08使用者明確要求「選擇角色時，按下該角色右邊彈出視窗，
             顯示放大圖片與角色詳細資訊(HP/FP/威力補正/技能招式技藝/得意武器/初始裝備/判定值)」）：
             直接重用characters.js圖鑑既有的CharacterDrawer.buildTypeStatLines()／
             renderAbilitySections()（readOnly模式），見static/midnight.jsの
             renderLobbyCharacterDetail()。 -->
        <div id="midnight-lobby-character-detail" hidden>
          <button type="button" id="btn-midnight-lobby-character-detail-close" class="midnight-modal-close-x">&times;</button>
          <img id="midnight-lobby-character-detail-image" alt="">
          <p id="midnight-lobby-character-detail-name"></p>
          <p id="midnight-lobby-character-detail-stats"></p>
          <div>
            <h4 data-i18n="cv_active_skills_title"></h4>
            <div id="midnight-lobby-character-detail-active"></div>
          </div>
          <div>
            <h4 data-i18n="cv_passives_title"></h4>
            <div id="midnight-lobby-character-detail-passive"></div>
          </div>
        </div>
        <div class="wb-row" id="midnight-lobby-ready-row">
          <button type="button" id="btn-midnight-lobby-ready" hidden></button>
          <button type="button" id="btn-midnight-lobby-leave" class="danger-btn" data-i18n="midnight_lobby_leave_button" hidden></button>
        </div>
        <p id="midnight-lobby-countdown" hidden></p>
        <p id="midnight-lobby-spectator-note" class="threat-ref-body" data-i18n="midnight_lobby_spectator_note" hidden></p>
        <!-- 房間設定（2026-09-06優化，2026-09-10「完整版」正式接入）：
             夜王清單直接重用static_src/scenarios.js既有的10個劇本（每個劇本對應一個
             bossId，跟night.js的night_king_1~10、night_gm_flow.jsの「夜の強敵決定表」
             查表用的劇本編號是同一份資料），不新增第二套劇本/夜王資料。寫入
             meta.nightBossId（劇本id，空字串＝隨機決定）／meta.mapVariant（"basic"|"full"）。
             "full"：使用者提供4張新地圖原畫（見static/midnight_map_variants.js），開局那一刻
             用meta.mapSeed決定性抽一張（80%機率），其餘20%退回基本版地形。跟測試模式同一套
             「同一場遊戲所有人共用、開局前才能改」的既定模式，見static/midnight.jsの
             renderLobbySettings()。 -->
        <div class="wb-row" id="midnight-lobby-night-boss-row">
          <label data-i18n="midnight_lobby_night_boss_label"></label>
          <select id="midnight-lobby-night-boss-select"></select>
        </div>
        <div class="wb-row" id="midnight-lobby-map-variant-row">
          <label data-i18n="midnight_lobby_map_variant_label"></label>
          <select id="midnight-lobby-map-variant-select">
            <option value="basic" data-i18n="midnight_lobby_map_variant_basic"></option>
            <option value="full" data-i18n="midnight_lobby_map_variant_full"></option>
          </select>
        </div>
        <!-- 難度（2026-09-08使用者明確規格「標準模式：流浪祝福3次，耗盡後遊戲失敗並詢問
             是否切換阿罵模式；阿罵模式：流浪祝福無限，永不結束遊戲」）：寫入meta.difficulty，
             跟夜王/地圖同一套「開局前才能改」模式，見static/midnight.jsのrenderLobbySettings()／
             handleDifficultySelectChange()／瀕死系統（tryConsumeWanderingBlessing()等）。 -->
        <div class="wb-row" id="midnight-lobby-difficulty-row">
          <label data-i18n="midnight_lobby_difficulty_label"></label>
          <select id="midnight-lobby-difficulty-select">
            <option value="standard" data-i18n="midnight_difficulty_standard"></option>
            <option value="unlimited" data-i18n="midnight_difficulty_unlimited"></option>
          </select>
        </div>
        <!-- 流程簡介（使用者明確規格「測試模式選項上面有『流程簡介』，打開後播放打字機
             直到按下右上X」）：純本地端展示視窗，不涉及任何共享state，開關只影響自己這台
             裝置的畫面，見static/midnight.jsのhandleFlowIntroOpenClick()/
             handleFlowIntroCloseClick()。 -->
        <div class="wb-row">
          <button type="button" id="btn-midnight-flow-intro-open" data-i18n="midnight_flow_intro_open_button"></button>
        </div>
        <!-- 測試模式（2026-09-09合併，使用者明確規格「測試模式與debug模式合併為一」）：
             原本private/main的獨立Debug模式（可調整盧恩/獲得武器/回滿FP/復歸回滿血/快速
             通過魔術師塔，見static/midnight.jsのrenderDebugPanel()）已併入這顆勾選框，
             開啟需輸入密碼（見handleTestModeToggle()）。 -->
        <div class="wb-row">
          <label>
            <input type="checkbox" id="midnight-lobby-test-mode-checkbox">
            <span data-i18n="midnight_test_mode_label"></span>
          </label>
        </div>
      </div>

      <!-- 流程簡介視窗（見上方按鈕註解）：跟#midnight-character-sheet-modal同款
           「全螢幕半透明黑＋置中卡片＋固定右上角關閉✕」既有慣例。左側是跟地圖同比例的
           空白示意畫布（CSS動畫示範縮圈／靈鳥飛行／四角HUD位置標籤，純示意，不是真的
           地圖canvas），右側是打字機播放的流程說明文字（static/midnight.jsの
           handleFlowIntroOpenClick()呼叫night_gm_flow.jsの既有typewriteInto()）。 -->
      <div id="midnight-flow-intro-modal" hidden>
        <div id="midnight-flow-intro-box">
          <button type="button" id="btn-midnight-flow-intro-close" class="midnight-modal-close-x">&times;</button>
          <h3 data-i18n="midnight_flow_intro_title"></h3>
          <div id="midnight-flow-intro-body">
            <div id="midnight-flow-intro-demo">
              <div id="midnight-flow-intro-demo-ring"></div>
              <div id="midnight-flow-intro-demo-bird">🦅</div>
              <span class="midnight-flow-intro-demo-label midnight-flow-intro-demo-label-tl" data-i18n="midnight_flow_intro_label_team"></span>
              <span class="midnight-flow-intro-demo-label midnight-flow-intro-demo-label-tr" data-i18n="midnight_flow_intro_label_map_char"></span>
              <span class="midnight-flow-intro-demo-label midnight-flow-intro-demo-label-br" data-i18n="midnight_flow_intro_label_action"></span>
              <span class="midnight-flow-intro-demo-label midnight-flow-intro-demo-label-bl" data-i18n="midnight_flow_intro_label_item"></span>
            </div>
            <p id="midnight-flow-intro-text"></p>
          </div>
        </div>
      </div>

      <div id="midnight-map-area" hidden>
        <!-- 地圖點卡牌事件：靠近地圖上的點時顯示，內容直接讀
             static_src/fields_data_1~4.js既有規則資料（地點名稱／樓層敘述／「(→XXX)」
             分歧標記），敵人引用解析重用static_src/night_gm_flow.js既有邏輯。見
             static/midnight.js的FIELD_*常數與updateNearbyFieldPoint()說明。三個區塊互斥
             （進入提示／邀請提示／正式進入後的banner），放在整個#midnight-map-area最
             上面，搭配CSS position:fixed固定在畫面最上方。 -->
        <div id="midnight-field-enter-prompt" hidden>
          <button type="button" class="midnight-top-banner-collapse-btn" aria-label="collapse">&#9654;</button>
          <p id="midnight-field-enter-name"></p>
          <button type="button" id="btn-midnight-field-enter" data-i18n="midnight_field_enter_button"></button>
        </div>

        <!-- 中途加入（2026-09-07新增，design§1.4）：跟上面3個互斥區塊獨立，不受pt/trig狀態
             分支影響——靠近一個「已經過了邀請階段（投票中或已解決）、但自己還不是participants」
             的地圖點時就會顯示。2026-09-07 review修正：外層改成跟#midnight-merchant-prompt／
             #midnight-blessing-prompt同款的巢狀<div hidden>結構（按鈕＋讀取提示都是內部一般
             流排版的子元素），套用style.css既有的固定定位選擇器群組（見約5173行），否則沒有
             position:fixed的裸元素會被#midnight-map-panel（position:fixed全螢幕不透明背景）
             蓋住，實際遊玩中完全看不到也點不到。按下後等待FIELD_LATE_JOIN_WAIT_MS才真正
             寫入participants，見static/midnight.jsのhandleLateJoinFieldClick()／
             renderFieldOverlay()。 -->
        <div id="midnight-field-late-join-prompt" hidden>
          <button type="button" class="midnight-top-banner-collapse-btn" aria-label="collapse">&#9654;</button>
          <button type="button" id="btn-midnight-field-late-join" data-i18n="midnight_field_late_join_button"></button>
          <div id="midnight-field-late-join-loading" hidden data-i18n="midnight_field_late_join_loading_note"></div>
        </div>

        <!-- 後補領獎（2026-09-07新增，design§1.5）：跟上面的中途加入按鈕同款結構，獨立於
             其他區塊，不受pt/trig狀態分支影響——靠近「自己從未加入過、但已留有一次性內容
             過去發放紀錄」的地圖點（板塊樓層看fieldProgress，強敵/隨機事件看fieldTrigger
             自己的resolved+HP歸零）時就會顯示。沿用#midnight-field-late-join-prompt同款
             巢狀<div hidden>結構＋共用固定定位選擇器群組（見style.css約5173行），按下後
             等待FIELD_LATE_JOIN_WAIT_MS才真正呼叫對應的claim函式，見static/midnight.jsの
             handleLateClaimClick()／renderFieldOverlay()。 -->
        <div id="midnight-field-late-claim-prompt" hidden>
          <button type="button" class="midnight-top-banner-collapse-btn" aria-label="collapse">&#9654;</button>
          <button type="button" id="btn-midnight-field-late-claim" data-i18n="midnight_field_late_claim_button"></button>
          <div id="midnight-field-late-claim-loading" hidden data-i18n="midnight_field_late_join_loading_note"></div>
        </div>

        <div id="midnight-field-invite-prompt" hidden>
          <button type="button" class="midnight-top-banner-collapse-btn" aria-label="collapse">&#9654;</button>
          <p id="midnight-field-invite-text"></p>
          <p id="midnight-field-invite-timer"></p>
          <button type="button" id="btn-midnight-field-invite-accept" data-i18n="midnight_field_invite_accept_button"></button>
        </div>

        <div id="midnight-field-banner" hidden>
          <button type="button" class="midnight-top-banner-collapse-btn" aria-label="collapse">&#9654;</button>
          <p id="midnight-field-banner-name"></p>
          <!-- 進入讀取條（2026-09-06新增）：正式進入後的0.5秒等待（FIELD_ENTER_WAIT_MS）
               期間顯示，取代原本的空白等待，見static/midnight.jsのrenderFieldOverlay()。 -->
          <div id="midnight-field-loading-bar" class="midnight-loading-track" hidden>
            <span id="midnight-field-loading-fill" class="midnight-loading-fill"></span>
          </div>
          <p id="midnight-field-narrative-text"></p>
          <!-- 已加入名單／「立即進入」（2026-09-07新增，design§1.2）：邀請時限尚未結束前，
               自己若已加入，顯示目前已加入的玩家名字＋讓自己可以提前跳過剩餘時限直接
               進入，不需要等其他人。見static/midnight.jsのrenderFieldOverlay()／
               handleForceEnterFieldClick()。 -->
          <div id="midnight-field-invite-status" hidden>
            <p data-i18n="midnight_field_invite_joined_label"></p>
            <p><span data-role="names"></span></p>
            <button type="button" data-role="force-enter" data-i18n="midnight_field_force_enter_button"></button>
          </div>
          <div id="midnight-field-vote-panel" hidden>
            <p id="midnight-field-vote-timer"></p>
            <div id="midnight-field-vote-options"></div>
            <p id="midnight-field-vote-status"></p>
          </div>
          <!-- 2026-09-08使用者明確規格「當有其他玩家還沒開啟過獎勵清單 以及 還沒關閉獎勵
               清單時, 其他人按下進入下一層會跳黃字說明 並且無法繼續前進直到參加的人都
               關閉了獎勵清單」：這一層擊破後，在所有參與者的獎勵清單（個人待領取清單／
               共享獎勵池）都resolved之前，fieldTrigger不會被清空（見
               static/midnight.jsのmaybeClearFieldTriggerAfterRewardGate()），此時顯示這行
               黃字說明；沒有卡住時本身hidden。 -->
          <p id="midnight-field-reward-gate-note" class="warning-text" hidden data-i18n="midnight_field_reward_gate_note"></p>
        </div>

        <!-- 強敵籌碼（2026-09-05新增）：靠近後揭示event_rulebook.js「強敵決定表」抽出的敵人，
             玩家自行決定是否按「進入戰鬥」（不像地圖點卡牌事件需要邀請/投票共識）。見
             static/midnight.js的updateNearbyChipPoint()／renderStrongEnemyOverlay()。 -->
        <div id="midnight-strong-enemy-banner" hidden>
          <button type="button" class="midnight-top-banner-collapse-btn" aria-label="collapse">&#9654;</button>
          <p id="midnight-strong-enemy-name"></p>
          <!-- 種類／體型／弱點（若有）：2026-09-06使用者明確要求，見static/midnight.jsの
               renderStrongEnemyOverlay()。 -->
          <p id="midnight-strong-enemy-detail"></p>
          <img id="midnight-strong-enemy-image" alt="">
          <button type="button" id="btn-midnight-strong-enemy-enter" data-i18n="midnight_strong_enemy_enter_button"></button>
        </div>

        <!-- 遭遇戰鬥前置準備（2026-09-09新增，使用者明確規格）：敵人/強敵/夜之強敵/夜王
             這4種會進入戰鬥的encounter，第一次遭遇時先顯示識別資訊5秒、讀完顯示「準備
             進入戰鬥」，這段期間地圖不會被強制收合。見static/midnight.jsの
             updateBattlePrep()/renderBattlePrepBanner()。 -->
        <div id="midnight-battle-prep-banner" hidden>
          <p id="midnight-battle-prep-name"></p>
          <p id="midnight-battle-prep-detail"></p>
          <div class="midnight-loading-track">
            <span id="midnight-battle-prep-loading-fill" class="midnight-loading-fill"></span>
          </div>
          <p id="midnight-battle-prep-status"></p>
        </div>

        <!-- 夜之強敵戰後的行動鎖定提示（2026-09-10使用者明確要求「結束夜之強敵戰鬥時，
             在上面banner顯示：離去後才能開始行動……」）：Day1／Day2夜之強敵擊退後的
             祝福／商人／離去區塊還開著時，地圖移動本來就已經被鎖住
             （static/midnight.jsのrewardsMovementLocked()，2026-09-08既有行為），但畫面
             上沒有任何說明，玩家會以為卡住了。這裡只是把既有的鎖定狀態明講出來，不改變
             鎖定規則本身。跟其他上方banner同一組固定定位/折疊行為（見TOP_BANNER_IDS）。 -->
        <div id="midnight-rewards-lock-banner" hidden>
          <button type="button" class="midnight-top-banner-collapse-btn" aria-label="collapse">&#9654;</button>
          <p id="midnight-rewards-lock-note" data-i18n="midnight_rewards_lock_note"></p>
        </div>

        <!-- 隨機事件籌碼（聖甲蟲，2026-09-05新增）：顯示event_rulebook.jsのrandom_eventチット
             「スカラベ／聖甲蟲」分支的描寫文字，玩家選精神/運氣/體能其中一項投骰判定。見
             static/midnight.js的renderScarabOverlay()。 -->
        <div id="midnight-scarab-banner" hidden>
          <button type="button" class="midnight-top-banner-collapse-btn" aria-label="collapse">&#9654;</button>
          <p id="midnight-scarab-text"></p>
          <div id="midnight-scarab-stat-picker">
            <button type="button" id="btn-midnight-scarab-mental" data-i18n="midnight_scarab_stat_mental"></button>
            <button type="button" id="btn-midnight-scarab-luck" data-i18n="midnight_scarab_stat_luck"></button>
            <button type="button" id="btn-midnight-scarab-physical" data-i18n="midnight_scarab_stat_physical"></button>
          </div>
          <p id="midnight-scarab-result"></p>
        </div>

        <!-- 隨機事件籌碼其餘8個分支通用banner（Task 20新增，設計文件§8.1-8.2）：聖甲蟲
             繼續沿用上面的#midnight-scarab-banner（renderScarabBranch()原樣呼叫既有
             renderScarabOverlay()）；Task 20實作女神像／埋もれ宝／隕石3個分支，Task 21
             再補上歩く霊廟／夜の勢力／虫の大量発生／発狂地帯4個分支，Task 22補上「襲撃」
             （6種命定敵：忌み鬼／兆し／調律の魔物／三つ首の獣／霧の裂け目／安寧者たち）——
             這些分支大多沿用同一組#midnight-random-event-action／choice-a／choice-b按鈕
             （發狂地帯的「離開」／「探索塔」、虫の大量発生的「HP」／「FP」二選一都是動態
             覆寫這兩顆按鈕的文字，見renderRandomEventOverlay()裡每次重繪都先重置回預設文字
             的說明）。只有「襲撃」→「調律の魔物」的3選1（取引に応じる／立ち去る／
             戦いを仕掛ける）需要額外3顆專用按鈕（見下方midnight-tuning-demon-choice-*，
             Task 22新增），因為3個選項需要同時並列顯示，不是像其餘分支那樣的2選1。見
             static/midnight.js的renderRandomEventOverlay()／renderTuningDemonBranch()。 -->
        <div id="midnight-random-event-banner" hidden>
          <p id="midnight-random-event-text"></p>
          <button type="button" id="midnight-random-event-action" data-i18n="midnight_random_event_action_button"></button>
          <button type="button" id="midnight-random-event-choice-a" data-i18n="midnight_random_event_choice_a_button" hidden></button>
          <button type="button" id="midnight-random-event-choice-b" data-i18n="midnight_random_event_choice_b_button" hidden></button>
          <!-- 女神像分支專用（fix-round，review指摘）：event_rulebook.js:426-427的「判定
               成功」與「PCが追跡者／無頼漢／守護者／執行者のいずれか」是兩個彼此獨立的
               條件，破壊者不必是判定成功的同一人，因此另外用一個獨立按鈕呈現，不與上面
               的-action（進行判定）共用。見static/midnight.js的
               renderGoddessStatueBranch()／handleGoddessStatueBreakClick()。 -->
          <button
            type="button"
            id="midnight-random-event-goddess-break-action"
            data-i18n="midnight_random_event_goddess_break_button"
            hidden
          ></button>
          <!-- 「襲撃」→「調律の魔物」分支專用（Task 22新增，event_rulebook.js:862-985）：
               取引に応じる／立ち去る／戦いを仕掛ける3選1，見static/midnight.jsの
               renderTuningDemonBranch()。 -->
          <button
            type="button"
            id="midnight-tuning-demon-choice-deal"
            data-i18n="midnight_tuning_demon_choice_deal_button"
            hidden
          ></button>
          <button
            type="button"
            id="midnight-tuning-demon-choice-leave"
            data-i18n="midnight_tuning_demon_choice_leave_button"
            hidden
          ></button>
          <button
            type="button"
            id="midnight-tuning-demon-choice-fight"
            data-i18n="midnight_tuning_demon_choice_fight_button"
            hidden
          ></button>
          <p id="midnight-random-event-result"></p>
        </div>

        <!-- 敵人攻擊（2026-09-05新增）：只有「同一板塊、同一籌碼事件」（activeEncounter）
             內、被指定為攻擊目標的那個玩家自己的畫面才會顯示——不是全體參與者共用的畫面
             （使用者明確規格：警示圖示閃爍0.5秒後才進行攻擊，攻擊特效為刀光劍影或爪痕）。
             全螢幕固定疊層，跟#midnight-field-banner等同一組定位方式。見static/midnight.js
             的updateEnemyAttack()／renderEnemyAttackOverlay()。 -->
        <div id="midnight-incoming-attack-warning" hidden>
          <span id="midnight-incoming-attack-name"></span>
          <!-- 2026-09-06三次優化：Day3夜之王招式附帶的規則書原文note（例如特殊能力的敘述
               性效果，數值/門檻無法從既有資料確認的部分，CLAUDE.md §19「不自行發明數值」
               方針），一般敵人沒有這個欄位，見static/midnight.jsのrenderEnemyAttackOverlay()。 -->
          <p id="midnight-incoming-attack-note" hidden></p>
        </div>
        <div id="midnight-attack-effect" hidden></div>

        <!-- 板塊(卡牌)獎勵「開啟並執行」的簡短提示（2026-09-05新增）：直接顯示獲得
             品項名稱幾秒後自動消失，不像獎勵清單彈窗需要點擊/確認。見static/midnight.js
             的showToast()。 -->
        <div id="midnight-toast" hidden></div>

        <!-- 開局10秒進場動畫（2026-09-06優化，2026-09-06二次修正使用者明確規格「不要完全
             覆蓋其動畫演出頁面，仍舊要逐漸顯現出地圖，靈鷹圖示與所有人在地圖外順時針繞兩圈
             後，定位在開始地點並開始」）：半透明疊層，pointer-events蓋住底下所有操作（配合
             static/midnight.jsのintroActive()另外擋掉鍵盤移動），底下地圖canvas清晰可見、
             透明度逐幀淡入。靈鷹本體用inline SVG剪影（專案沒有靈鷹美術素材，其餘UI也是走
             inline SVG/CSS icon風格，例如劍/盾圖示），靈鷹與3個隊員小圓點的位置由
             static/midnight.jsのpositionIntroFlyers()依真實地圖座標逐幀計算寫入inline
             left/top（沿地圖外圈順時針繞兩圈後收斂到起始地點），不是CSS keyframe，見
             renderIntroOverlay()。 -->
        <div id="midnight-intro-overlay" hidden>
          <!-- 夜王〔開場〕敘述（使用者明確規格「原本顯示『靈鷹正載著眾人飛向夜之地圖』上面
               一排再顯示該劇本的NIGHT中夜王的(開場)」）：文字來源跟night.js開局自動播放的
               開場敘述完全相同的static/worldview.js資料（見static/night_gm_flow.jsの
               resolveNightKingNarrationText()新增匯出），不是另外編的文字；找不到資料
               （meta.resolvedNightBossId尚未解出/找不到對應bossId）時整段隱藏，不硬湊。
               見static/midnight.jsのrenderIntroOverlay()。 -->
          <p id="midnight-intro-boss-text" hidden></p>
          <!-- 2026-09-10使用者明確要求「開始遊戲會順時針轉的舊鳥圖示，改成流程簡介會移動
               的鳥並放大3倍」：原本的inline SVG剪影換成跟流程簡介示意畫布
               (#midnight-flow-intro-demo-bird)完全相同的🦅字符，字級是那邊1.4rem的3倍
               （見style.css）。飛行軌跡本身（順時針繞地圖外圈兩圈後降落）維持不變，由
               static/midnight.jsのpositionIntroFlyers()逐幀寫入inline left/top。 -->
          <div id="midnight-intro-bird-wrap">
            <span id="midnight-intro-bird-glyph" aria-hidden="true">&#129413;</span>
          </div>
          <span id="midnight-intro-party-dot-1" class="midnight-intro-party-dot"></span>
          <span id="midnight-intro-party-dot-2" class="midnight-intro-party-dot"></span>
          <span id="midnight-intro-party-dot-3" class="midnight-intro-party-dot"></span>
          <p id="midnight-intro-note" data-i18n="midnight_intro_note"></p>
        </div>

        <!-- Day3夜之王開場動畫（2026-09-08使用者明確要求「開場動畫中下方文字敘述也補上該
             夜王的前言敘述(與night的自動開場一樣文本)，同時3秒後在開始位置慢速閃星星直到
             正式開始」）：進入day3王戰遭遇（activeEncounter.id===day3Boss）後、玩家尚未按
             [進入戰鬥]確認前顯示一次（每台裝置本地判斷，不同步），見static/midnight.jsの
             updateDay3BossIntroOverlay()。前言敘述讀night_boss_rulebook.jsのboss.intro
             欄位——目前規則書轉錄尚未包含這段文字（P.240-249待補），沒有資料時這段文字
             直接隱藏，不自行編造內容。 -->
        <div id="midnight-day3-boss-intro-overlay" hidden>
          <img id="midnight-day3-boss-intro-image" alt="" hidden>
          <p id="midnight-day3-boss-intro-name"></p>
          <p id="midnight-day3-boss-intro-text" hidden></p>
          <span id="midnight-day3-boss-intro-star" hidden>✦</span>
        </div>

        <!-- 瀕死狀態自身提示（2026-09-08新增，見static/midnight.jsのupdateNearDeathState()／
             renderNearDeathStatus()）：期間無法移動/使用物品，僅能查看角色資訊與開啟選單
             （這兩個入口本身不受這個banner影響，仍可正常點擊），純顯示倒數與復歸進度。 -->
        <div id="midnight-near-death-status" hidden>
          <p id="midnight-near-death-status-text"></p>
        </div>

        <!-- 遊戲失敗彈窗（2026-09-08新增，見switchToUnlimitedMode()）：標準模式流浪祝福
             耗盡後、有人瀕死逾時未能復歸時，全員都看到這個彈窗，任何一人按下確認即可切換
             阿罵模式並讓全員瀕死角色一次復活繼續遊戲。 -->
        <div id="midnight-game-failure-modal" hidden>
          <div id="midnight-game-failure-box">
            <h3 data-i18n="midnight_game_failure_title"></h3>
            <p data-i18n="midnight_game_failure_body"></p>
            <button type="button" id="btn-midnight-game-failure-confirm" class="danger-btn" data-i18n="midnight_game_failure_confirm_button"></button>
          </div>
        </div>

        <!-- 遊戲勝利彈窗（使用者明確規格「遊戲第三天勝利後顯示(結局)」）：跟遊戲失敗彈窗
             同款「全螢幕置中卡片」，文字來源跟開局〔開場〕同一份static/worldview.js資料
             （見static/midnight.jsのupdateGameVictoryModal()/renderIntroBossText()同款用法），
             只是取結局段落。關閉只是本地端旗標（同day1RewardsDismissed既有模式），不影響
             fieldTrigger/fieldEnemyHp等共享戰鬥結果，讓玩家關閉後仍可留在畫面上自由查看。 -->
        <div id="midnight-game-victory-modal" hidden>
          <div id="midnight-game-victory-box">
            <h3 data-i18n="midnight_game_victory_title"></h3>
            <p id="midnight-game-victory-text"></p>
            <button type="button" id="btn-midnight-game-victory-confirm" data-i18n="midnight_game_victory_confirm_button"></button>
          </div>
        </div>

        <!-- ==================================================================
             固定角落HUD（2026-09-05 HUD全面重排）：取代原本文件流排列的
             #midnight-char-panel／#midnight-combat-panel／#midnight-players-panel，
             改成使用者指定的5個固定區塊，不管地圖是展開還是收合都看得到、操作得到——
             地圖現在改成一個全螢幕modal（見下方#midnight-map-panel），是額外「點開」
             來看地形/位置/移動用的子畫面，不是主畫面。這些區塊本身固定在viewport角落，
             用CSS position:fixed，不是相對canvas。================================== -->

        <!-- 左上：自己的HP/FP/體力＋聖杯瓶剩餘數＋隊友血量（renderOccupiedSlotCard()
             既有函式輸出，容器換成這裡，函式邏輯不變）。 -->
        <div id="midnight-hud-top-left">
          <div class="midnight-bar-row">
            <span class="midnight-bar-label" data-i18n="midnight_stat_hp_label"></span>
            <span class="midnight-bar-track"><span class="midnight-bar-fill midnight-bar-hp" id="midnight-self-hp-fill"></span></span>
            <span class="midnight-bar-value" id="midnight-self-hp-value"></span>
          </div>
          <div class="midnight-bar-row">
            <span class="midnight-bar-label" data-i18n="midnight_stat_fp_label"></span>
            <span class="midnight-bar-track"><span class="midnight-bar-fill midnight-bar-fp" id="midnight-self-fp-fill"></span></span>
            <span class="midnight-bar-value" id="midnight-self-fp-value"></span>
          </div>
          <div class="midnight-bar-row">
            <span class="midnight-bar-label" data-i18n="midnight_stat_stamina_label"></span>
            <span class="midnight-bar-track"><span class="midnight-bar-fill midnight-bar-stamina" id="midnight-self-stamina-fill"></span></span>
            <span class="midnight-bar-value" id="midnight-self-stamina-value"></span>
          </div>
          <div class="midnight-bar-row">
            <span id="midnight-flask-count"></span>
          </div>
          <div id="midnight-players-panel-slots"></div>
          <!-- 掉落物簡易資訊（2026-09-06使用者明確要求「靠近掉落物時顯示簡易資訊在左側，
               延續隊友血量資訊下方，拾取按鈕也在其下方」）：原本
               #midnight-ground-item-prompt巢狀在地圖modal內部、地圖收合時完全看不到，
               這次搬到左上角HUD（跟隊友血量卡同一個固定面板），見static/midnight.jsの
               updateNearbyGroundItem()。 -->
          <div id="midnight-ground-item-prompt" hidden>
            <p id="midnight-ground-item-name"></p>
            <button type="button" id="btn-midnight-pickup-ground-item" data-i18n="midnight_pickup_button"></button>
          </div>
        </div>

        <!-- 右上收合按鈕列（2026-09-05 HUD優化改版：使用者明確規格「收合地圖/腳色/選單
             的按鈕放置於右上方，以[盧恩][地圖][角色][選單]順序排列」）：地圖圖示點擊
             展開/收合全螢幕地圖（見midnight.jsのsetMapExpanded()，戰鬥結束後會有
             .midnight-map-icon-nudge提示動畫）；角色/選單按鈕原本埋在地圖modal內部、
             只有地圖展開時才看得到，這次搬出來變成不管地圖展開/收合都能點的固定入口。
             #midnight-menu-panel也跟著搬到這裡同層級（見下方），不再巢狀在地圖modal
             裡，否則地圖收合時選單面板會被地圖modal的hidden邏輯連坐隱藏。 -->
        <div id="midnight-hud-top-right">
          <!-- 進入戰鬥（2026-09-06優化，2026-09-08 private側亦獨立搬到右上，使用者明確
               規格「若因為離開過再次進入戰鬥或參加別人的戰鬥，都須先按下上方資訊欄的進入
               戰鬥，接著需要讀條3秒後才正式進入戰鬥畫面」）：見static/midnight.jsの
               renderEnterBattlePrompt()／handleEnterBattleClick()／
               updateBattleEnterLoading()。2026-09-09由左上搬到右上，使用者明確規格。 -->
          <div id="midnight-enter-battle-prompt" hidden>
            <button type="button" id="btn-midnight-enter-battle" data-i18n="midnight_enter_battle_button"></button>
            <div id="midnight-enter-battle-loading-bar" class="midnight-loading-track" hidden>
              <span id="midnight-enter-battle-loading-fill" class="midnight-loading-fill"></span>
            </div>
          </div>
          <!-- 暫停後繼續遊戲的倒數＋讀取條（2026-09-06三次優化，使用者明確規格「暫停遊戲後
               的繼續遊戲，需要再上方資訊欄中顯示倒數與讀取條」）：跟原本
               #midnight-pause-overlay的全螢幕文字倒數並存（那個繼續擋操作），這裡額外在
               資訊欄提供視覺化讀取條。讀取條時長對齊RESUME_COUNTDOWN_MS=3秒，跟「進入戰鬥」
               讀取條一樣用JS逐幀算style.width（不套用寫死0.5秒的.midnight-loading-fill-animate
               CSS動畫），見static/midnight.jsのupdateResumeCountdownHud()。2026-09-09由
               左上搬到右上，使用者明確規格。 -->
          <div id="midnight-resume-countdown-row" hidden>
            <p id="midnight-resume-countdown-text"></p>
            <div id="midnight-resume-countdown-bar" class="midnight-loading-track">
              <span id="midnight-resume-countdown-fill" class="midnight-loading-fill"></span>
            </div>
          </div>
          <!-- 第一天/第二天夜之強敵系統倒數（2026-09-06優化，使用者明確規格「系統自動
               倒數讀條10s」）：純顯示，玩家不用也不能操作，見
               static/midnight.jsのrenderFinalCircleCountdown()。2026-09-09由左上搬到
               右上，使用者明確規格。 -->
          <p id="midnight-final-circle-countdown" hidden></p>
          <!-- 第一天/第二天夜之強敵戰後的祝福／商人／離去列已由private/main獨立搬到這個
               flex column更下方（跟「角色」按鈕同一區塊，見下方
               #midnight-hud-day1-rewards-row／#midnight-hud-day2-rewards-row），這裡不
               重複放一份，避免id重複。 -->
          <div id="midnight-hud-ready-final-row" hidden>
            <button type="button" id="btn-midnight-ready-final-boss"></button>
            <span id="midnight-ready-final-note"></span>
          </div>
          <span class="midnight-rune-value">
            <span data-i18n="midnight_stat_rune_label"></span>
            <span id="midnight-self-rune-value">0</span>
          </span>
          <!-- 小地圖（2026-09-06使用者明確要求「戰鬥中小地圖顯示在地圖按鈕左邊,尺寸為原
               地圖的1/10倍」）：跟#btn-midnight-map-icon同一列,只在戰鬥中（activeEncounter
               存在）且地圖收合時顯示——地圖展開時本身就看得到全圖,不需要小地圖。內容直接
               把#midnight-canvas目前畫好的內容整張縮小畫上去（見static/midnight.jsの
               render()結尾),不重畫一次地圖邏輯。 -->
          <div id="midnight-map-icon-row">
            <!-- 上方地點卡牌／籌碼banner折疊後的展開鈕（2026-09-08新增於private/main，
                 2026-09-09使用者明確要求改放在盧恩下方、地圖按鈕左側，而不是private/main
                 原本的盧恩左邊；圖示也改用「◀」跟banner上「▶」收合鈕相對應），見
                 static/midnight.jsのupdateTopBannerCollapseUI()。 -->
            <button type="button" id="btn-midnight-top-banner-reopen" aria-label="reopen" hidden>&#9664;</button>
            <canvas id="midnight-minimap-canvas" hidden></canvas>
            <button type="button" id="btn-midnight-map-icon" data-i18n="midnight_map_icon_label"></button>
          </div>
          <button type="button" id="btn-midnight-open-character-sheet" data-i18n="midnight_character_sheet_open_button"></button>

          <!-- 鍛造台戰技重抽（2026-09-08使用者明確規格「鍛造台戰技重抽為鍛造村的獎勵，不放
               在腳色視窗內，在離開鍛造村範圍後直接歸0無法使用」）：從角色面板搬到這個
               flex column裡，靠近鍛造村（map.points裡card==="8"的一般地點卡，見
               midnight_map.jsのFIELD_CARD_NAMES）才顯示，不是merchant/blessing那種獨立
               籌碼，因此靠static/midnight.jsのupdateNearbyFieldPoint()新增的
               nearbySmithingVillage proximity判斷，不是trig狀態。按鈕本身與modal
               （#midnight-weapon-reroll-modal）完全重用，只換了開啟按鈕的位置與可見條件，
               見renderWeaponRerollOpenButton()。 -->
          <button type="button" id="btn-midnight-open-weapon-reroll" data-i18n="midnight_weapon_reroll_open_button" hidden></button>

          <!-- 夜之強敵戰後的[使用祝福]／[離去]（2026-09-08使用者明確要求「放置右上方
               「角色」的下方並橫排」，原本在#midnight-hud-top-left，函式邏輯不變只是
               容器換到這裡）：第一天夜之強敵戰後（2026-09-06三次優化，使用者明確規格
               「第一天夜之強敵戰鬥結束後，總計時10秒後才正式開始第二天倒計時，能選的
               只有祝福與離去」）：只有祝福＋離去，沒有商人。離去純本地端關閉這個區塊，見
               static/midnight.jsのhandleDay1RewardsLeaveClick()。 -->
          <div id="midnight-hud-day1-rewards-row" hidden>
            <button type="button" id="btn-midnight-hud-blessing-day1" data-i18n="midnight_hud_blessing_button"></button>
            <button type="button" id="btn-midnight-hud-day1-leave" class="danger-btn" data-i18n="midnight_hud_leave_button"></button>
          </div>
          <!-- 第二天夜之強敵戰後（2026-09-06三次優化，使用者明確規格「第二天戰鬥結束後，
               沒有總計時，能選的有祝福商人與離去，接著才是按準備進入第三天」）：祝福／
               商人／離去為一組並排，離去只關閉這一組本地顯示，不影響下方獨立的「準備」列，
               見static/midnight.jsのrenderFinalCircleRewardsHud()。外層
               #midnight-hud-day2-rewards-row純粹是排版用的橫向容器（見style.css），本身
               不控制hidden——祝福鈕／商人列各自的hidden邏輯不變。 -->
          <div id="midnight-hud-day2-rewards-row">
            <button type="button" id="btn-midnight-hud-blessing" data-i18n="midnight_hud_blessing_button" hidden></button>
            <div id="midnight-hud-merchant-row" hidden>
              <button type="button" id="btn-midnight-open-merchant-hud" data-i18n="midnight_hud_merchant_button"></button>
              <button type="button" id="btn-midnight-hud-day2-leave" class="danger-btn" data-i18n="midnight_hud_leave_button"></button>
            </div>
          </div>

          <button type="button" id="btn-midnight-toggle-menu" data-i18n="midnight_menu_button"></button>

          <!-- 測試模式面板（2026-09-06數值真正接入新增，使用者明確規格：「開始遊戲可以
               選擇測試模式，在右邊可以顯示敵我傷害資訊，甚至可以手動拉條來改變傷害值」）：
               改成#midnight-hud-top-right這個flex column的最後一個子元素（原本是獨立
               position:fixed、用寫死的top值疊在按鈕列下方，使用者回報「會擋住選單/角色
               按鈕」——寫死的offset沒有算進按鈕列實際高度，例如新增這顆小地圖列之後就
               不準）。改用flex文件流排列後，不管上面有幾顆按鈕、多高，都會自動接在下面，
               且align-items:flex-end讓它跟按鈕群一樣切齊右邊，徹底解決疊字問題。由
               meta.testMode控制顯示，meta.testTuning四個倍率透過RTDB同步。見
               static/midnight.js的renderTestPanel()/handleTestSliderInput()。 -->
          <!-- 測試主控台入口（2026-09-09改版）：只在meta.testMode為true時才顯示，取代
               原本「測試模式一開就常駐顯示整塊面板」的作法，見static/midnight.jsの
               renderTestPanel()。 -->
          <button type="button" id="btn-midnight-open-test-console" data-i18n="midnight_test_console_open_button" hidden></button>

          <div id="midnight-test-panel" hidden>
            <div class="wb-row">
              <h3 data-i18n="midnight_test_panel_title"></h3>
              <button type="button" id="btn-midnight-test-panel-close">×</button>
            </div>
            <p id="midnight-test-panel-last-pc"></p>
            <p id="midnight-test-panel-last-pc-defense"></p>
            <p id="midnight-test-panel-last-enemy"></p>
            <p id="midnight-test-panel-last-enemy-guard"></p>
            <!-- 2026-09-06優化：滑桿範圍擴大（使用者明確規格：敵人HP/玩家傷害0.2x~100x、
                 敵人攻擊0x~20x、敵人防禦價值0x~10x）並加上可直接輸入數字的輸入框，兩者
                 互相同步（見static/midnight.jsのbindTestSliderInput()/renderTestPanel()）。 -->
            <div class="wb-row">
              <label data-i18n="midnight_test_mult_enemy_hp"></label>
              <input type="range" id="midnight-test-slider-enemy-hp" min="0.2" max="100" step="0.1" value="1">
              <input type="number" id="midnight-test-number-enemy-hp" class="midnight-test-number-input" min="0.2" max="100" step="0.1" value="1">
              <span id="midnight-test-slider-enemy-hp-value"></span>
            </div>
            <div class="wb-row">
              <label data-i18n="midnight_test_mult_enemy_atk"></label>
              <input type="range" id="midnight-test-slider-enemy-atk" min="0" max="20" step="0.1" value="1">
              <input type="number" id="midnight-test-number-enemy-atk" class="midnight-test-number-input" min="0" max="20" step="0.1" value="1">
              <span id="midnight-test-slider-enemy-atk-value"></span>
            </div>
            <div class="wb-row">
              <label data-i18n="midnight_test_mult_pc_dmg"></label>
              <input type="range" id="midnight-test-slider-pc-dmg" min="0.2" max="100" step="0.1" value="1">
              <input type="number" id="midnight-test-number-pc-dmg" class="midnight-test-number-input" min="0.2" max="100" step="0.1" value="1">
              <span id="midnight-test-slider-pc-dmg-value"></span>
            </div>
            <div class="wb-row">
              <label data-i18n="midnight_test_mult_enemy_guard"></label>
              <input type="range" id="midnight-test-slider-enemy-guard" min="0" max="10" step="0.1" value="1">
              <input type="number" id="midnight-test-number-enemy-guard" class="midnight-test-number-input" min="0" max="10" step="0.1" value="1">
              <span id="midnight-test-slider-enemy-guard-value"></span>
            </div>
            <!-- 立即縮圈（Task 3新增） -->
            <button type="button" id="btn-midnight-test-force-shrink" data-i18n="midnight_test_force_shrink_button"></button>
          </div>

          <!-- Debug面板（2026-09-08新增於private/main，2026-09-09合併：與測試模式共用
               同一顆密碼閘門勾選框＋同一個testConsoleOpen選單開關，不再有獨立的
               meta.debugMode），所有操作只作用在自己目前操作的角色，見static/midnight.jsの
               renderDebugPanel()。「設定個別戰技魔術祈禱」重用既有鍛造台重骰UI（不是另外
               發明一套挑選機制），這裡只是給自己灌免費重骰次數再開啟鍛造台。 -->
          <div id="midnight-debug-panel" hidden>
            <h3 data-i18n="midnight_debug_panel_title"></h3>
            <div class="wb-row">
              <label data-i18n="midnight_debug_rune_label"></label>
              <input type="number" id="midnight-debug-rune-input" class="midnight-test-number-input" min="0" step="1" value="0">
              <button type="button" id="btn-midnight-debug-set-rune" data-i18n="midnight_debug_apply_button"></button>
            </div>
            <div class="wb-row">
              <label data-i18n="midnight_debug_weapon_label"></label>
              <select id="midnight-debug-weapon-select"></select>
              <button type="button" id="btn-midnight-debug-grant-weapon" data-i18n="midnight_debug_apply_button"></button>
            </div>
            <div class="wb-row">
              <button type="button" id="btn-midnight-debug-reroll-credits" data-i18n="midnight_debug_reroll_credits_button"></button>
            </div>
            <div class="wb-row">
              <button type="button" id="btn-midnight-debug-full-fp" data-i18n="midnight_debug_full_fp_button"></button>
            </div>
            <div class="wb-row">
              <button type="button" id="btn-midnight-debug-revive-full-hp" data-i18n="midnight_debug_revive_full_hp_button"></button>
            </div>
            <div class="wb-row">
              <button type="button" id="btn-midnight-debug-skip-tower" data-i18n="midnight_debug_skip_tower_button"></button>
            </div>
          </div>
        </div>

        <div id="midnight-menu-panel" hidden>
          <!-- 流浪祝福剩餘格數（2026-09-08新增，見static/midnight.jsのrenderWanderingBlessingHud()）：
               標準模式顯示剩餘格數，阿罵模式顯示「無限」。2026-09-08使用者再次明確要求
               「選單按下才顯示流浪祝福，平時不顯示」：搬進選單面板，跟著#midnight-menu-panel
               本身的hidden切換自動顯示/隱藏，static/midnight.jsのrenderWanderingBlessingHud()
               不需要另外控制hidden，只負責填textContent。 -->
          <span id="midnight-wandering-blessing-value" class="midnight-rune-value"></span>
          <button type="button" id="btn-midnight-pause-game" class="danger-btn" data-i18n="midnight_pause_button"></button>
          <button type="button" id="btn-midnight-resume-game" data-i18n="midnight_resume_button" hidden></button>
        </div>

        <!-- 左下：2x2四張卡片——上＝聖杯瓶、下＝消耗品、左/右＝武器。 -->
        <div id="midnight-hud-bottom-left">
          <button type="button" id="btn-midnight-use-flask" class="midnight-action-card midnight-action-card-flask">
            <span class="midnight-bar-track midnight-bar-track-sm"><span class="midnight-bar-fill midnight-bar-flask-read" id="midnight-flask-read-fill"></span></span>
            <span data-i18n="midnight_flask_use_button"></span>
          </button>
          <button type="button" id="btn-midnight-weapon-left" class="midnight-action-card midnight-action-card-weapon">
            <span id="midnight-weapon-left-label"></span>
          </button>
          <button type="button" id="btn-midnight-weapon-right" class="midnight-action-card midnight-action-card-weapon">
            <span id="midnight-weapon-right-label"></span>
          </button>
          <button type="button" id="btn-midnight-use-consumable" class="midnight-action-card midnight-action-card-consumable">
            <span id="midnight-consumable-label"></span>
          </button>
        </div>

        <!-- 左手一般攻擊／魔術祈禱（2026-09-05武器資料真正接入新增，使用者明確規格：
             「因為有左右手能拿武器設定，左手的攻擊魔術等都在左下另外增設按鍵」）。跟
             右下角原本那組按鈕算是同一套邏輯的左手版，只是位置移到左下角武器卡片附近。
             一般攻擊在該側武器是空手/盾牌/法杖・聖印時直接hidden（見
             static/midnight.js的renderSideCombatButtons()）；魔術/祈禱最多2顆按鈕
             （btn-midnight-skill-b1-left／b2-left，杖/聖印同時有2個固定魔術/祈禱時使用），
             跟單一入口（btn-midnight-skill-b-left）互斥顯示。 -->
        <div id="midnight-hud-bottom-left-actions">
          <!-- 長按顯示特殊攻擊選單（2026-09-06優化，使用者明確規格「玩家有學習到跳躍
               攻擊/衝刺攻擊的話，長按[攻擊]其上方會另外顯示擁有的特殊攻擊」）：選單本身
               是按鈕本身的手足元素（不能巢狀在<button>裡面，HTML不允許button巢狀
               button），用CSS絕對定位疊在#midnight-attack-wrap-left上方，見
               static/midnight.jsのbindAttackHoldInput()／renderAttackSpecialMenu()。 -->
          <div id="midnight-attack-wrap-left" class="midnight-attack-wrap">
            <div id="midnight-attack-special-menu-left" class="midnight-attack-special-menu" hidden></div>
            <button type="button" id="btn-midnight-attack-left">
              <span class="midnight-icon-sword"></span>
              <!-- 2026-09-06優化：拿掉固定的data-i18n，改成static/midnight.jsのrenderSideCombatButtons()
                   動態填入——下次攻擊會是2Hit時顯示[Hit]，否則顯示原本的攻擊文字。 -->
              <span id="midnight-attack-left-label"></span>
            </button>
          </div>
          <button type="button" id="btn-midnight-skill-b-left">
            <span class="midnight-icon-sword"></span>
            <span class="midnight-bar-track midnight-bar-track-sm"><span class="midnight-bar-fill midnight-bar-sorcery-cast" id="midnight-skill-b-cast-fill-left"></span></span>
            <span id="midnight-skill-b-label-left"></span>
          </button>
          <button type="button" id="btn-midnight-skill-b1-left" hidden>
            <span class="midnight-icon-sword"></span>
            <span class="midnight-bar-track midnight-bar-track-sm"><span class="midnight-bar-fill midnight-bar-sorcery-cast" id="midnight-skill-b1-cast-fill-left"></span></span>
            <span id="midnight-skill-b1-label-left"></span>
          </button>
          <button type="button" id="btn-midnight-skill-b2-left" hidden>
            <span class="midnight-icon-sword"></span>
            <span class="midnight-bar-track midnight-bar-track-sm"><span class="midnight-bar-fill midnight-bar-sorcery-cast" id="midnight-skill-b2-cast-fill-left"></span></span>
            <span id="midnight-skill-b2-label-left"></span>
          </button>
        </div>

        <!-- 中間下方：敵人HP，只在「碰到敵人進入戰鬥」（activeEncounter）時顯示，見
             midnight.jsのrenderCombatPanel()。 -->
        <div id="midnight-hud-bottom-center" hidden>
          <!-- 逃離戰鬥（2026-09-06使用者明確要求「在敵人資訊中右上方有逃離戰鬥按鈕」）：
               只是讓本地玩家放棄目前這場activeEncounter（比照走出觸發半徑的效果），不是
               正式規則書的「撤退」判定（見docs/scenario_flow_rules.md備註，該規則書講的是
               正式night.js場次的HP增加代價；midnight.js本來就是簡化demo戰鬥，範圍外），
               見static/midnight.jsのhandleFleeBattleClick()。 -->
          <button type="button" id="btn-midnight-flee-battle" data-i18n="midnight_flee_battle_button"></button>
          <!-- 遇敵：靠近的地圖點分歧確定後如果指派了敵人，顯示敵人圖片/名稱（讀
               static_src/enemies_data_1~4.js既有資料，不是自己畫的圖或編的名字）。
               2026-09-06使用者明確要求「血量資訊放置於圖片下方」：HP列搬到這個
               區塊之後（原本在敵人圖片之前）。 -->
          <div id="midnight-field-encounter" hidden>
            <!-- 命中特效（2026-09-06使用者明確要求「玩家使用任何攻擊效果時,也在敵人的
                 圖片上產生不同的刀光效果...且能根據屬性更換顏色」）：疊在敵人圖片正上方
                 的獨立容器，顏色由static/midnight.jsのtriggerEnemyHitEffect()透過CSS
                 變數--hit-color即時指定，動畫定義見style.css。 -->
            <div id="midnight-field-encounter-image-wrap">
              <img id="midnight-field-encounter-image" alt="">
              <div id="midnight-enemy-hit-effect" hidden></div>
              <!-- 消耗品丟擲動畫（2026-09-08使用者明確要求「使用消耗品時...對敵人丟出火焰壺、
                   飛刀、調香瓶等等動畫，顏色改以屬性的顏色」）：見static/midnight.jsの
                   triggerConsumableThrowEffect()，圖示與顏色依道具決定，只在丟擲類/對敵人
                   噴霧類消耗品觸發，自身/全體PC用的道具不觸發。 -->
              <div id="midnight-consumable-throw-effect" hidden></div>
            </div>
            <p id="midnight-field-encounter-name"></p>
          </div>
          <!-- 屬性/狀態異常共同蓄積小型顯示（2026-09-05武器資料真正接入新增，見
               static/midnight.js的renderAttributeAccumNote()），純文字列出目前
               combat target累積中的項目，例如「炎2・睡眠2」。2026-09-08使用者明確規格
               「敵人若有受到屬性傷害則在血條上方黃字標註」：搬到.midnight-enemy-hp-row
               上方（原本在下方），並改用黃字（見style.cssの#midnight-attribute-accum-note）。 -->
          <p id="midnight-attribute-accum-note"></p>
          <div class="midnight-bar-row midnight-enemy-hp-row">
            <span class="midnight-bar-label" data-i18n="midnight_enemy_hp_label"></span>
            <span class="midnight-bar-track"><span class="midnight-bar-fill midnight-bar-enemy" id="midnight-enemy-hp-fill"></span></span>
            <span class="midnight-bar-value" id="midnight-enemy-hp-value"></span>
          </div>
          <!-- 鑑定眼（鐵之眼被動，2026-09-05角色能力真正接入新增）：只在有activeEncounter
               （見trig.enemyFamilyId真實敵人資料）且角色類型有此被動時顯示，見
               static/midnight.js的handleEyeForValueClick()。 -->
          <button type="button" id="btn-midnight-eye-for-value" hidden></button>
          <pre id="midnight-eye-for-value-note"></pre>
        </div>

        <!-- 右下：攻擊／戰技A（即時）／戰技B（魔術・祈禱，長按2秒讀條）／迴避／防禦／
             角色專屬技藝／角色專屬技能。實際扣的血由static/midnight.js的
             damageCombatTarget()判斷要打這裡的敵人還是原本的共用標靶。圖示化
             （2026-09-05戰鬥優化改版：使用者明確規格「攻擊共用標靶改成一把劍的圖示，
             戰技使用劍的圖示＋戰技，防禦使用盾牌的圖示」）：劍/盾用inline SVG
             mask-image（見style.css的.midnight-icon-sword／.midnight-icon-shield），
             不需要額外圖檔請求。這一組是「右手」版本（見static/midnight.js的
             renderSideCombatButtons()），左手版本在#midnight-hud-bottom-left-actions。 -->
        <div id="midnight-hud-bottom-right">
          <!-- 長按顯示特殊攻擊選單，見左手版本上方註解與static/midnight.jsのbindAttackHoldInput()。 -->
          <div id="midnight-attack-wrap-right" class="midnight-attack-wrap">
            <div id="midnight-attack-special-menu" class="midnight-attack-special-menu" hidden></div>
            <button type="button" id="btn-midnight-attack-shared-target">
              <span class="midnight-icon-sword"></span>
              <!-- 2026-09-06優化：拿掉固定的data-i18n，改成static/midnight.jsのrenderSideCombatButtons()
                   動態填入——下次攻擊會是2Hit時顯示[Hit]，否則顯示原本的攻擊文字。 -->
              <span id="midnight-attack-shared-target-label"></span>
            </button>
          </div>
          <button type="button" id="btn-midnight-skill">
            <span class="midnight-icon-sword"></span>
            <!-- 2026-09-06使用者明確要求「底層操作面板中[戰技]名稱需隨著右手武器跟換為
                 [戰技(名稱)]」：拿掉固定的data-i18n，改成static/midnight.jsのrenderCombatPanel()
                 依weaponArtEntry()動態填入，同一顆按鈕、同一份i18n模板字串。 -->
            <span id="midnight-skill-a-label" data-i18n="midnight_skill_a_button"></span>
          </button>
          <button type="button" id="btn-midnight-skill-b">
            <span class="midnight-icon-sword"></span>
            <span class="midnight-bar-track midnight-bar-track-sm"><span class="midnight-bar-fill midnight-bar-sorcery-cast" id="midnight-skill-b-cast-fill"></span></span>
            <span id="midnight-skill-b-label"></span>
          </button>
          <button type="button" id="btn-midnight-skill-b1" hidden>
            <span class="midnight-icon-sword"></span>
            <span class="midnight-bar-track midnight-bar-track-sm"><span class="midnight-bar-fill midnight-bar-sorcery-cast" id="midnight-skill-b1-cast-fill"></span></span>
            <span id="midnight-skill-b1-label"></span>
          </button>
          <button type="button" id="btn-midnight-skill-b2" hidden>
            <span class="midnight-icon-sword"></span>
            <span class="midnight-bar-track midnight-bar-track-sm"><span class="midnight-bar-fill midnight-bar-sorcery-cast" id="midnight-skill-b2-cast-fill"></span></span>
            <span id="midnight-skill-b2-label"></span>
          </button>
          <!-- 迴避/防禦成功、受到傷害的浮動提示（2026-09-06優化，使用者明確規格：
               「因迴避或防禦而成功擋下敵人攻擊時，在其按鈕上方顯示[成功迴避][成功防禦]
               1秒後消失，反之受到傷害則在上面顯示紅字[受到傷害]」）：各按鈕自己的
               .midnight-action-flash子元素，見static/midnight.jsのshowActionFlash()／
               resolveMyIncomingHit()。data-i18n拿掉改放進子span，避免applyI18n()的
               el.textContent覆寫連同flash子元素一起清空。 -->
          <button type="button" id="btn-midnight-dodge">
            <span id="midnight-dodge-flash" class="midnight-action-flash" hidden></span>
            <span data-i18n="midnight_dodge_button"></span>
          </button>
          <!-- 防禦讀條（2026-09-06使用者明確要求「防禦長按→防禦，且在上面用現在施法的
               讀條，按著時直接滿格」）：跟戰技B施法讀條共用同一種.midnight-bar-track／
               .midnight-bar-fill視覺元件，差別是防禦沒有蓄力時間，長按期間直接顯示滿格
               （見static/midnight.jsのstartBlockHold()／endBlockHold()），純粹當作「目前
               正在防禦中」的視覺提示，不是施法進度。 -->
          <button type="button" id="btn-midnight-block">
            <span id="midnight-block-flash" class="midnight-action-flash" hidden></span>
            <span class="midnight-icon-shield"></span>
            <span class="midnight-bar-track midnight-bar-track-sm"><span class="midnight-bar-fill midnight-bar-sorcery-cast" id="midnight-block-guard-fill"></span></span>
            <span data-i18n="midnight_block_button"></span>
          </button>
          <!-- 特殊防禦（第六感／遺物效果額外防禦選項，2026-09-05角色能力真正接入新增）：
               只在availableSpecialDefenseOption()有結果時顯示，見static/midnight.js的
               renderCharacterActionButtons()／handleSpecialDefenseClick()。 -->
          <button type="button" id="btn-midnight-defense-special" hidden>
            <span id="midnight-defense-special-flash" class="midnight-action-flash" hidden></span>
            <span class="midnight-icon-shield"></span>
            <span id="midnight-defense-special-label"></span>
          </button>
          <!-- 角色專屬〔技藝〕〔技能〕（2026-09-05戰鬥優化新增）：對應
               character_types.js的type.arts[0]／type.skills[0]，文字直接讀該ability的
               本地化名稱，跟上面通用武器戰技demo（btn-midnight-skill/skill-b）是不同
               東西，見static/midnight.js的renderCharacterActionButtons()。角色類型若
               沒有arts/skills就整顆按鈕hidden。 -->
          <!-- 技藝圖示改用專屬.midnight-icon-art（2026-09-06使用者明確要求「腳色的技藝要
               比較特別的圖示，使用次數較少難以回復」），跟一般攻擊/戰技共用的劍圖示區分
               開來，見style.css。 -->
          <button type="button" id="btn-midnight-art" hidden>
            <span class="midnight-icon-art"></span>
            <span id="midnight-art-label"></span>
          </button>
          <button type="button" id="btn-midnight-character-skill" hidden>
            <span class="midnight-icon-sword"></span>
            <span id="midnight-character-skill-label"></span>
          </button>
          <!-- 高防禦（守護者被動，2026-09-05角色能力真正接入新增）：只在角色類型有此被動時
               顯示，見static/midnight.js的handleHighGuardToggleClick()。 -->
          <button type="button" id="btn-midnight-high-guard" hidden></button>
          <!-- 元素操控（隱者/隱者黎明被動，2026-09-05角色能力真正接入新增）：見
               static/midnight.js的handleElementalControlClick()。 -->
          <button type="button" id="btn-midnight-elemental-control" hidden></button>
        </div>

        <!-- 全螢幕地圖modal（2026-09-05 HUD優化改版；2026-09-06修正：先前塔／商人／祝福／
             角色面板／獎勵清單等彈窗誤植在這個地圖modal內部，導致地圖收合時完全看不到、
             按下角落HUD的「角色」等按鈕也沒有反應——這違反本檔案與#midnight-hud-top-left/
             -right既有註解已經明訂的設計（「這些是底層畫面配置，地圖只是額外點開的子畫面，
             不是操作角色/戰鬥的前提」）。修法：把這些跟「看地圖畫面」本身無關的彈窗/modal
             全部搬出來，變成跟#midnight-hud-*同層級的#midnight-map-area直接子元素（見下方
             獨立區塊），#midnight-map-panel內只留下canvas本身、疊在canvas上的地圖收合✕、
             暫停疊層、靈鳥提示、手機搖桿——這幾個才是真正跟「地圖畫面」綁在一起的東西。 -->
        <div id="midnight-map-panel" hidden>
          <div class="wb-row">
            <button type="button" id="btn-midnight-map-close" data-i18n="midnight_map_close_button"></button>
          </div>
          <div id="midnight-canvas-wrap">
            <canvas id="midnight-canvas"></canvas>
            <!-- 地圖右上關閉✕（2026-09-06使用者明確要求「關閉地圖的X直接放置在地圖圖片上
                 的右上」）：跟上面.wb-row那顆收合文字按鈕功能相同（都呼叫
                 static/midnight.jsのsetMapExpanded(false)），只是改成疊在canvas本身右上角、
                 更符合直覺的圓形✕。 -->
            <button type="button" id="btn-midnight-map-close-corner">&times;</button>

            <div id="midnight-pause-overlay" hidden>
              <p id="midnight-pause-overlay-text"></p>
            </div>
            <div id="midnight-spirit-bird-prompt" hidden>
              <button type="button" id="btn-midnight-use-spirit-bird" data-i18n="midnight_spirit_bird_use_button"></button>
            </div>
            <div id="midnight-mobile-joystick" hidden>
              <div id="midnight-mobile-joystick-knob"></div>
            </div>
          </div>
        </div>

        <!-- ==================================================================
             以下彈窗/modal跟地圖是否展開無關（2026-09-06從#midnight-map-panel內部搬出，
             見上方大段說明）：靠近地圖上的點、或按下固定HUD按鈕就會顯示，不管地圖modal
             目前是打開還是收合。================================== -->

        <!-- 魔術師塔（2026-09-05籌碼優化改版：使用者明確規格「先顯示進入選項，
             進入邀請完後才顯示其解謎，任何一個人完成就全員完成能獲得獎勵」）：
             三種互斥狀態——①尚未觸發：顯示「進入」②邀請中且我不是參與者：顯示
             邀請文字＋「加入」③邀請結束、我是參與者：不需要按鍵，
             #midnight-tower-puzzle-modal自動彈出（見static/midnight.js的
             renderTowerOverlay()）。 -->
        <div id="midnight-tower-prompt" hidden>
          <button type="button" id="btn-midnight-tower-enter" data-i18n="midnight_tower_enter_button"></button>
          <div id="midnight-tower-invite-wait" hidden>
            <p id="midnight-tower-invite-text"></p>
            <button type="button" id="btn-midnight-tower-invite-accept" data-i18n="midnight_field_invite_accept_button"></button>
          </div>
        </div>

        <!-- 商人籌碼（2026-09-05新增，2026-09-06改版加上名稱＋進入讀取條，跟板塊
             卡牌一樣「顯示資訊＋進入」）：純本地modal（不需要跨玩家共享狀態），比照
             midnight-tower-puzzle-modal同款巢狀<div hidden>結構。見
             static/midnight.js的updateNearbyChipPoint()／handleMerchantEnterClick()。 -->
        <div id="midnight-merchant-prompt" hidden>
          <p id="midnight-merchant-prompt-name"></p>
          <button type="button" id="btn-midnight-open-merchant" data-i18n="midnight_field_enter_button"></button>
          <div id="midnight-merchant-loading-bar" class="midnight-loading-track" hidden>
            <span id="midnight-merchant-loading-fill" class="midnight-loading-fill"></span>
          </div>
        </div>

        <!-- 祝福籌碼（2026-09-05籌碼優化新增，2026-09-06改版：比照商人籌碼加上名稱
             ＋進入讀取條＋疊一層視窗顯示內容，見下方#midnight-blessing-modal；使用
             祝福可重複觸發、不再打X，見static/midnight.js的
             handleBlessingEnterClick()／handleBlessingUseClick()。2026-09-06再修正：
             這個進入提示先前跟#midnight-field-enter-prompt同時觸發（NON_FIELD_POINT_TYPES
             漏排除blessing類型），造成「兩個進入」重複顯示，見static/midnight.jsの
             NON_FIELD_POINT_TYPES說明）。 -->
        <div id="midnight-blessing-prompt" hidden>
          <p id="midnight-blessing-prompt-name"></p>
          <button type="button" id="btn-midnight-blessing-claim" data-i18n="midnight_field_enter_button"></button>
          <div id="midnight-blessing-loading-bar" class="midnight-loading-track" hidden>
            <span id="midnight-blessing-loading-fill" class="midnight-loading-fill"></span>
          </div>
        </div>

        <!-- 魔術師塔解謎modal（2026-09-07改版：兩數四則運算換成6種參數化謎題，見設計文件
             §4.1／static/midnight_puzzles.js／static/midnight.jsのrenderTowerPuzzleModal()）：
             box內容完全由JS依puzzle.kind動態產生，這裡只留空容器＋答錯提示。 -->
        <div id="midnight-tower-puzzle-modal" hidden>
          <div id="midnight-tower-puzzle-box">
            <h3 data-i18n="midnight_puzzle_title"></h3>
            <div id="midnight-tower-puzzle-body"></div>
            <p id="midnight-tower-puzzle-wrong-note" class="warning-text" hidden data-i18n="midnight_tower_wrong_note"></p>
          </div>
        </div>

        <!-- 塔謎題12骰牌型獎勵（設計文件§4.2，Task 11新增）：解謎成功後由
             static/midnight.jsのstartTowerDiceHandReward()自動彈出，box樣式比照
             #midnight-tower-puzzle-modal/-box同款全螢幕覆蓋。12顆骰子由JS動態產生於
             #midnight-tower-dice-hand-body（renderTowerDiceHandModal()），重骰只能用一次，
             確定牌型按鈕呼叫window.PriTestMidnightPuzzles.judgeDiceHand()判定後依
             TOWER_DICE_HAND_REWARDS發獎，沿用既有grantLootRewardEntryToCharacter()/
             CharacterDrawer.drawWeaponFromCategory()，不另外發明發獎邏輯。標題重用既有
             night.js版「役判定式獎勵」同一個i18n key（dice_hand_draw_modal_title），
             兩邊都是同一套judgeDiceHand()牌型結果、語意相同。 -->
        <div id="midnight-tower-dice-hand-modal" hidden>
          <div id="midnight-tower-dice-hand-box">
            <h3 data-i18n="dice_hand_draw_modal_title"></h3>
            <div id="midnight-tower-dice-hand-body"></div>
            <div class="wb-row">
              <button type="button" id="btn-midnight-tower-dice-reroll" data-i18n="midnight_tower_dice_reroll_button"></button>
              <button type="button" id="btn-midnight-tower-dice-confirm" data-i18n="midnight_tower_dice_confirm_button"></button>
            </div>
          </div>
        </div>

        <div id="midnight-merchant-modal" hidden>
          <div id="midnight-merchant-box">
            <h3 data-i18n="midnight_merchant_title"></h3>
            <p id="midnight-merchant-rune-note"></p>
            <div class="wb-row">
              <button type="button" id="btn-midnight-merchant-buy-weapon" data-i18n="midnight_merchant_buy_weapon_button"></button>
            </div>
            <p id="midnight-merchant-weapon-result"></p>
            <div id="midnight-merchant-consumable-list"></div>
            <p id="midnight-merchant-consumable-result"></p>
            <h4 data-i18n="midnight_merchant_forge_title"></h4>
            <p id="midnight-merchant-forge-stone-note"></p>
            <div id="midnight-merchant-forge-list"></div>
            <p id="midnight-merchant-forge-result"></p>
            <button type="button" id="btn-midnight-merchant-close" data-i18n="midnight_merchant_close_button"></button>
          </div>
        </div>

        <!-- 戰技重抽鍛造台（設計文件§3.5，Task 13新增）：跟#midnight-merchant-modal／
             #midnight-blessing-modal完全分開的獨立功能（跟商人的鍛冶合稀有度強化面板也是
             不同功能，見上方#midnight-merchant-forge-title），從角色面板武器格下方的
             #btn-midnight-open-weapon-reroll開啟（見static/midnight.jsのopenWeaponRerollModal()）。
             CSS沿用跟#midnight-merchant-modal/-box同款的全螢幕覆蓋＋置中卡片版型（見
             style.css的#midnight-merchant-modal選擇器群組），不是Task 6教訓中那種
             position:fixed小型浮動提示——這是完整modal覆蓋。
             ①未選定武器/枠：#midnight-weapon-reroll-list只顯示可選清單。
             ②已選定、尚未[使用]：list區改顯示固定卡片＋[使用]按鈕可見。
             ③已[使用]：#midnight-weapon-reroll-compare顯示新舊戰技比較＋[套用]可見。
             [保留並離開]在①②③都可見（唯一離開手段，二段式確認見
             handleWeaponRerollKeepAndLeaveClick()），可見性/文字切換全部由
             static/midnight.jsのrenderWeaponRerollModal()動態控制，這裡只放空容器。 -->
        <div id="midnight-weapon-reroll-modal" hidden>
          <div id="midnight-weapon-reroll-box">
            <h3 data-i18n="midnight_weapon_reroll_title"></h3>
            <div id="midnight-weapon-reroll-list"></div>
            <!-- 2026-09-08使用者明確規格「使用時抽到的戰技需要完整顯示資訊 並放在左右以
                 供對比」：改成左右並排兩欄（原本是上下兩行且只有名稱），每欄完整顯示
                 名稱＋種類＋規則本文，見static/midnight.jsのrenderWeaponRerollModal()。 -->
            <div id="midnight-weapon-reroll-compare" hidden>
              <div class="midnight-weapon-reroll-compare-col">
                <h4 data-i18n="midnight_weapon_reroll_old_label"></h4>
                <div id="midnight-weapon-reroll-compare-old"></div>
              </div>
              <div class="midnight-weapon-reroll-compare-col">
                <h4 data-i18n="midnight_weapon_reroll_new_label"></h4>
                <div id="midnight-weapon-reroll-compare-new"></div>
              </div>
            </div>
            <div class="wb-row">
              <button type="button" id="btn-midnight-weapon-reroll-use" data-i18n="midnight_weapon_reroll_use_button"></button>
              <button type="button" id="btn-midnight-weapon-reroll-apply" data-i18n="midnight_weapon_reroll_apply_button"></button>
              <button type="button" id="btn-midnight-weapon-reroll-keep-leave" data-i18n="midnight_weapon_reroll_keep_leave_button"></button>
            </div>
            <p id="midnight-weapon-reroll-leave-note" class="warning-text" hidden data-i18n="midnight_weapon_reroll_leave_note"></p>
          </div>
        </div>

        <!-- 祝福視窗（2026-09-06新增）：疊在地圖上方的視窗，跟#midnight-merchant-modal
             同款CSS（背景50%透明黑，見style.css），使用者確認可重複使用、不打X，見
             static/midnight.js的openBlessingModal()／handleBlessingUseClick()。 -->
        <div id="midnight-blessing-modal" hidden>
          <div id="midnight-blessing-box">
            <h3 data-i18n="midnight_blessing_title"></h3>
            <p data-i18n="midnight_blessing_modal_desc"></p>
            <button type="button" id="btn-midnight-blessing-use" data-i18n="midnight_blessing_claim_button"></button>
            <p id="midnight-blessing-result"></p>
            <!-- 領取後升級（2026-09-06使用者明確要求「領取祝福後再跳出角色目前的等級與
                 盧恩，可以去做+號升級」，且「平常在角色視窗中取消等級兩側的+-號」）：
                 這個level-row原本放在#midnight-character-sheet-modal裡，現在唯一入口搬來
                 這裡；id維持不變，static/midnight.jsのrenderCharacterSheetLevelRow()／
                 handleMidnightLevelDelta()／bindEvents()裡對+/-按鈕的事件綁定完全不用改，
                 因為都是用id查DOM，不管實際掛在哪個父層底下（CLAUDE.md §41重用原則）。 -->
            <div id="midnight-character-sheet-level-row">
              <span data-i18n="record_level_label"></span>
              <button type="button" class="level-btn" id="btn-midnight-sheet-level-minus">&minus;</button>
              <span id="midnight-character-sheet-level-value"></span>
              <button type="button" class="level-btn" id="btn-midnight-sheet-level-plus">&plus;</button>
              <span id="midnight-character-sheet-level-next-cost"></span>
              <span data-i18n="record_runes_label"></span>
              <span id="midnight-character-sheet-runes-value"></span>
            </div>
            <button type="button" id="btn-midnight-blessing-close" data-i18n="midnight_merchant_close_button"></button>
          </div>
        </div>

        <!-- 取引（bargainReveal）視窗（設計文件§3.6/§9-2，Task 15新增）：跟#midnight-merchant-modal
             同款絕對定位＋置中版型（見style.css）。每個participant各自在自己的裝置上開啟、各自
             選擇自己要的deal——不是party-wide單一選擇，因此不透過tileRewardGrantedBy搶鎖，見
             static/midnight.jsのmaybeGrantFieldTileReward()內的呼叫處與openBargainRevealModal()／
             renderBargainDealList()。選項清單完全由JS依entry.deals動態產生於
             #midnight-bargain-deal-list，這裡只留空容器＋標題＋關閉鈕。 -->
        <div id="midnight-bargain-modal" hidden>
          <div id="midnight-bargain-box">
            <h3 data-i18n="midnight_bargain_title"></h3>
            <div id="midnight-bargain-deal-list"></div>
            <button type="button" id="btn-midnight-bargain-close" data-i18n="midnight_bargain_close_button"></button>
          </div>
        </div>

        <!-- 角色屬性管理面板（2026-09-05新增，2026-09-06改版：使用者明確規格的順序——
             （類型名）等級／HP／FP→武器(6格)→消耗品(4格)→裝飾品(2格)→可發動技能→技藝→
             被動能力→遺物效果→附帶效果→威力補正→得意武器→判定值，右側detail拉滿版高，
             固定右上角關閉✕）。顯示characters[myTokenId]（CharacterDrawer.newCharacter()
             同形狀物件），見static/midnight.js的renderCharacterSheet()。 -->
        <div id="midnight-character-sheet-modal" hidden>
          <div id="midnight-character-sheet-box">
            <!-- 固定右上角關閉✕（2026-09-06使用者明確要求「角色視窗固定右上方有關閉X
                 按鈕」），取代原本擠在最下面的關閉字按鈕。 -->
            <button type="button" id="btn-midnight-character-sheet-close" class="midnight-modal-close-x">&times;</button>
            <h3 data-i18n="midnight_character_sheet_title"></h3>
            <p id="midnight-character-sheet-summary"></p>
            <!-- 可習得遺物效果（2026-09-05角色能力真正接入新增）：重用character_drawer.js
                 既有的relicCandidateFor／relicAllUnlearned／learnRelicEffect等純函式
                 （見CLAUDE.md §41重用原則），只有UI渲染是midnight自己的（見
                 renderMidnightRelicLearnSection()）。只在learnedRelicEffects.length <
                 relicMaxLearnable(c.level)時顯示，跟主遊戲relic-select-block同一個條件。 -->
            <div class="midnight-sheet-section" id="midnight-sheet-relic-learn-block">
              <h4 data-i18n="relic_select_title"></h4>
              <p id="midnight-character-sheet-relic-progress"></p>
              <button type="button" id="btn-midnight-sheet-relic-roll" data-i18n="relic_roll_button"></button>
              <div id="midnight-character-sheet-relic-dice"></div>
              <div id="midnight-character-sheet-relic-candidates"></div>
            </div>
            <div id="midnight-character-sheet-split">
              <div id="midnight-character-sheet-list">
                <div class="midnight-sheet-section">
                  <h4 data-i18n="midnight_character_sheet_weapons_label"></h4>
                  <div id="midnight-character-sheet-weapons" class="midnight-sheet-slots"></div>
                </div>
                <div class="midnight-sheet-section">
                  <h4 data-i18n="midnight_character_sheet_consumables_label"></h4>
                  <div id="midnight-character-sheet-consumables" class="midnight-sheet-slots"></div>
                </div>
                <div class="midnight-sheet-section">
                  <h4 data-i18n="midnight_character_sheet_talismans_label"></h4>
                  <div id="midnight-character-sheet-talismans" class="midnight-sheet-slots"></div>
                </div>
                <div class="midnight-sheet-section">
                  <h4 data-i18n="midnight_character_sheet_skills_label"></h4>
                  <div id="midnight-character-sheet-skills"></div>
                </div>
                <div class="midnight-sheet-section">
                  <h4 data-i18n="midnight_character_sheet_arts_label"></h4>
                  <div id="midnight-character-sheet-arts"></div>
                </div>
                <div class="midnight-sheet-section">
                  <h4 data-i18n="midnight_character_sheet_abilities_label"></h4>
                  <div id="midnight-character-sheet-abilities"></div>
                </div>
                <div class="midnight-sheet-section">
                  <h4 data-i18n="midnight_character_sheet_relics_label"></h4>
                  <div id="midnight-character-sheet-relics"></div>
                </div>
                <div class="midnight-sheet-section">
                  <h4 data-i18n="midnight_character_sheet_effects_label"></h4>
                  <div id="midnight-character-sheet-effects"></div>
                </div>
                <!-- 威力補正／得意武器／判定值（2026-09-06使用者明確要求移到清單後面，
                     等級升降改在#midnight-blessing-modal內，這裡不再放level-row）。 -->
                <p id="midnight-character-sheet-power"></p>
                <p id="midnight-character-sheet-favored"></p>
                <p id="midnight-character-sheet-checkvalues"></p>
              </div>
              <div id="midnight-character-sheet-detail"></div>
            </div>
          </div>
        </div>

        <!-- 獎勵清單（擊殺敵人／聖甲蟲成功，2026-09-05新增）：左右分割彈窗，左邊
             pendingRewards[myTokenId]清單，點擊後右邊顯示自動抽選結果，確認收下。
             potentialPower（得意武器/附帶效果擇一）額外提供兩個各自抽選的按鈕，見
             static/midnight.js的renderRewardModal()。 -->
        <div id="midnight-reward-modal" hidden>
          <div id="midnight-reward-box">
            <h3 data-i18n="midnight_reward_title"></h3>
            <div id="midnight-reward-split">
              <div id="midnight-reward-list-wrap">
                <h4 data-i18n="midnight_reward_shared_section_title"></h4>
                <ul id="midnight-reward-list-shared"></ul>
                <h4 data-i18n="midnight_reward_section_title"></h4>
                <ul id="midnight-reward-list-personal"></ul>
              </div>
              <div id="midnight-reward-detail"></div>
            </div>
            <button type="button" id="btn-midnight-reward-close" data-i18n="midnight_reward_close_button"></button>
          </div>
        </div>
      </div>

      <!-- 2026-09-08使用者明確規格「上方的hud資訊欄，縮小時，僅縮成一條薄線 且圖層順序
           放在最後」：新增btn-midnight-hud-collapse常駐在最外層（不隨內容一起收起），
           #midnight-hud-content包住原本的day-phase文字/重新開始按鈕/操作提示，收合時
           整個隱藏，#midnight-hud本身縮成薄線＋z-index降到最低，見
           static/midnight.jsのupdateHudInfoBarCollapseUI()／style.cssの
           #midnight-hud.midnight-hud-collapsed。 -->
      <div id="midnight-hud" hidden>
        <button type="button" id="btn-midnight-hud-collapse" data-i18n="midnight_hud_collapse_button"></button>
        <div id="midnight-hud-content">
          <div class="wb-row">
            <span id="midnight-hud-day-phase"></span>
            <!-- 2026-09-06優化：第二天/第三天推進改為全自動（縮圈到底＋夜之強敵戰鬥／全員
                 準備），拿掉原本的手動[進入第二天]/[進入第三天]按鈕，見
                 static/midnight.jsのupdateAutoDayAdvance()／maybeTriggerDay3FromReady()。 -->
            <button type="button" id="btn-midnight-restart-cycle" data-i18n="midnight_restart_cycle_button" hidden></button>
          </div>
          <p class="threat-ref-body" data-i18n="midnight_controls_hint"></p>
        </div>
      </div>

    </div>
"""


def build_midnight_html() -> str:
    return page_shell(
        title="Midnight - PriTest",
        body=BODY,
        static_prefix="../static/",
        home_href="../index.html",
        extra_scripts=(
            "firebase_config.js",
            "game_storage.js",
            # 2026-09-06優化：房間設定新增「夜王」選擇（見midnight.jsのrenderLobbySettings()），
            # 直接重用night.js既有的10個劇本/夜王資料（scenarios.js的SCENARIOS、
            # night_bosses.js的圖片registry），不新增第二套劇本資料。
            "scenarios.js",
            "night_bosses.js",
            # 2026-09-06三次優化：Day3夜之王即時制戰鬥新增，直接重用night.js既有的自動化GM
            # 純函式模組（rollEnemyAction()/resolveTargets()/computeGroupDamage()等，見
            # midnight.jsのbossAutoGmBattleState()/pickAndResolveBossAction()），不重新
            # 發明一套夜王招式解析規則。
            "night_boss_rulebook.js",
            "boss_auto_gm_data.js",
            "fields_data_1.js",
            "fields_data_2.js",
            "fields_data_3.js",
            "fields_data_4.js",
            "fields.js",
            "enemies_data_1.js",
            "enemies_data_2.js",
            "enemies_data_3.js",
            "enemies_data_4.js",
            "enemies.js",
            # fix(2026-09-10)：auto_gm.jsの頂部で`var Enemies = window.PriTestEnemies;`と
            # module-load時点の値をキャプチャしている（enemies.jsの前に置くと永遠にundefined
            # のまま）。night_page.pyでは既にenemies.jsの後にauto_gm.jsを置いているが、
            # midnight_page.pyだけ順序が逆（auto_gm.jsがenemies.jsより前）になっており、
            # Day3夜王戦の毎回の攻撃決定（pickAndResolveBossAction→AutoGm.rollEnemyAction→
            # Enemies.localizedText(bossInfo.name)）がTypeError（"Cannot read properties of
            # undefined (reading 'localizedText')"）で必ず例外を投げ、RTDBのtransaction()が
            # rejectしてenemyAttackStartAttempted[]のローカル節流フラグが二度とリセットされず、
            # 「夜之王が一切自動攻撃しなくなる」既存バグの直接原因だった（ブラウザ実機で確認
            # 済み、console.errorに上記スタックトレースが実際に出力されていた）。enemies.jsの
            # 後に移動するだけで直る、データや戦闘ロジック側の問題ではない。
            "auto_gm.js",
            # 2026-09-05追加：商人／強敵／隨機事件籌碼＋角色屬性管理＋獎勵清單系統。
            # 順序沿用site_src/night_page.pyの既存extra_scripts相對順序（依賴關係已在那邊
            # 驗證過，這裡直接照抄，不重新試錯）。
            "character_types.js",
            "weapons_categories.js",
            "weapons_skills.js",
            "weapons_data.js",
            "weapons.js",
            "weapon_rulebook.js",
            "talismans.js",
            "consumables.js",
            "character_drawer.js",
            "event_rulebook.js",
            "night_floor_breakthrough.js",
            # 2026-09-10追加：夜王〔開場〕〔結局〕敘述（見midnight_page.pyの
            # #midnight-intro-boss-text／#midnight-game-victory-modal說明），night_gm_flow.js
            # 的resolveNightKingNarrationText()內部讀window.PriTestWorldview，必須排在它之前。
            "worldview.js",
            "night_gm_flow.js",
            "midnight_puzzles.js",
            "midnight_random_events.js",
            # 2026-09-10新增：「完整版」4張新地圖資料，midnight_map.jsのgenerateMap()內部
            # 讀window.PriTestMidnightMapVariants，必須排在它之前。
            "midnight_map_variants.js",
            "midnight_map.js",
            # 2026-09-10新增：規則文本轉換層（回合制用語→即時制說法），midnight.jsの
            # mnText()會讀window.PriTestMidnightTextAdapt，必須排在它之前。純字串函式、
            # 沒有其他相依，放這裡即可。
            "midnight_text_adapt.js",
            "midnight.js",
        ),
    )
