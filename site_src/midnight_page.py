"""midnight（即時制擴張版・技術驗證片）ページを組み立てる。

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
        <div class="wb-row" id="midnight-lobby-ready-row">
          <button type="button" id="btn-midnight-lobby-ready" hidden></button>
          <button type="button" id="btn-midnight-lobby-leave" data-i18n="midnight_lobby_leave_button" hidden></button>
        </div>
        <p id="midnight-lobby-countdown" hidden></p>
        <p id="midnight-lobby-spectator-note" class="threat-ref-body" data-i18n="midnight_lobby_spectator_note" hidden></p>
        <!-- 房間設定（2026-09-06優化，使用者明確規格「一開始創立房間後，能選擇一些房間
             設定：[夜王]第三天的最終夜王，night中的10隻夜王可選擇（同時會根據night中的
             抽選表等等影響劇本的走向）；[地圖]基本版/完整版（目前完整版不能選）」）：
             夜王清單直接重用static_src/scenarios.js既有的10個劇本（每個劇本對應一個
             bossId，跟night.js的night_king_1~10、night_gm_flow.jsの「夜の強敵決定表」
             查表用的劇本編號是同一份資料），不新增第二套劇本/夜王資料。寫入
             meta.nightBossId（劇本id，空字串＝隨機決定）／meta.mapVariant（"basic"|"full"，
             "full"目前disabled、僅先保留UI）。跟測試模式同一套「同一場遊戲所有人共用、
             開局前才能改」的既定模式，見static/midnight.jsのrenderLobbySettings()。 -->
        <div class="wb-row" id="midnight-lobby-night-boss-row">
          <label data-i18n="midnight_lobby_night_boss_label"></label>
          <select id="midnight-lobby-night-boss-select"></select>
        </div>
        <div class="wb-row" id="midnight-lobby-map-variant-row">
          <label data-i18n="midnight_lobby_map_variant_label"></label>
          <select id="midnight-lobby-map-variant-select">
            <option value="basic" data-i18n="midnight_lobby_map_variant_basic"></option>
            <option value="full" data-i18n="midnight_lobby_map_variant_full" disabled></option>
          </select>
        </div>
        <div class="wb-row">
          <label>
            <input type="checkbox" id="midnight-lobby-test-mode-checkbox">
            <span data-i18n="midnight_test_mode_label"></span>
          </label>
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
          <p id="midnight-field-enter-name"></p>
          <button type="button" id="btn-midnight-field-enter" data-i18n="midnight_field_enter_button"></button>
        </div>

        <div id="midnight-field-invite-prompt" hidden>
          <p id="midnight-field-invite-text"></p>
          <p id="midnight-field-invite-timer"></p>
          <button type="button" id="btn-midnight-field-invite-accept" data-i18n="midnight_field_invite_accept_button"></button>
        </div>

        <div id="midnight-field-banner" hidden>
          <p id="midnight-field-banner-name"></p>
          <!-- 進入讀取條（2026-09-06新增）：正式進入後的0.5秒等待（FIELD_ENTER_WAIT_MS）
               期間顯示，取代原本的空白等待，見static/midnight.jsのrenderFieldOverlay()。 -->
          <div id="midnight-field-loading-bar" class="midnight-loading-track" hidden>
            <span id="midnight-field-loading-fill" class="midnight-loading-fill"></span>
          </div>
          <p id="midnight-field-narrative-text"></p>
          <div id="midnight-field-vote-panel" hidden>
            <p id="midnight-field-vote-timer"></p>
            <div id="midnight-field-vote-options"></div>
            <p id="midnight-field-vote-status"></p>
          </div>
        </div>

        <!-- 強敵籌碼（2026-09-05新增）：靠近後揭示event_rulebook.js「強敵決定表」抽出的敵人，
             玩家自行決定是否按「進入戰鬥」（不像地圖點卡牌事件需要邀請/投票共識）。見
             static/midnight.js的updateNearbyChipPoint()／renderStrongEnemyOverlay()。 -->
        <div id="midnight-strong-enemy-banner" hidden>
          <p id="midnight-strong-enemy-name"></p>
          <!-- 種類／體型／弱點（若有）：2026-09-06使用者明確要求，見static/midnight.jsの
               renderStrongEnemyOverlay()。 -->
          <p id="midnight-strong-enemy-detail"></p>
          <img id="midnight-strong-enemy-image" alt="">
          <button type="button" id="btn-midnight-strong-enemy-enter" data-i18n="midnight_strong_enemy_enter_button"></button>
        </div>

        <!-- 隨機事件籌碼（聖甲蟲，2026-09-05新增）：顯示event_rulebook.jsのrandom_eventチット
             「スカラベ／聖甲蟲」分支的描寫文字，玩家選精神/運氣/體能其中一項投骰判定。見
             static/midnight.js的renderScarabOverlay()。 -->
        <div id="midnight-scarab-banner" hidden>
          <p id="midnight-scarab-text"></p>
          <div id="midnight-scarab-stat-picker">
            <button type="button" id="btn-midnight-scarab-mental" data-i18n="midnight_scarab_stat_mental"></button>
            <button type="button" id="btn-midnight-scarab-luck" data-i18n="midnight_scarab_stat_luck"></button>
            <button type="button" id="btn-midnight-scarab-physical" data-i18n="midnight_scarab_stat_physical"></button>
          </div>
          <p id="midnight-scarab-result"></p>
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
          <div id="midnight-intro-bird-wrap">
            <svg id="midnight-intro-bird-svg" viewBox="0 0 100 60" aria-hidden="true">
              <path d="M50 30 C40 10, 10 8, 0 20 C15 22, 30 28, 42 34 C30 34, 15 38, 2 46 C14 54, 42 50, 50 34 C58 50, 86 54, 98 46 C85 38, 70 34, 58 34 C70 28, 85 22, 100 20 C90 8, 60 10, 50 30 Z" />
            </svg>
          </div>
          <span id="midnight-intro-party-dot-1" class="midnight-intro-party-dot"></span>
          <span id="midnight-intro-party-dot-2" class="midnight-intro-party-dot"></span>
          <span id="midnight-intro-party-dot-3" class="midnight-intro-party-dot"></span>
          <p id="midnight-intro-note" data-i18n="midnight_intro_note"></p>
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
          <!-- 進入戰鬥（2026-09-06優化，使用者明確規格「若因為離開過再次進入戰鬥或參加
               別人的戰鬥，都須先按下上方資訊欄的進入戰鬥，接著需要讀條3秒後才正式進入
               戰鬥畫面」）：見static/midnight.jsのrenderEnterBattlePrompt()／
               handleEnterBattleClick()／updateBattleEnterLoading()。 -->
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
               CSS動畫），見static/midnight.jsのupdateResumeCountdownHud()。 -->
          <div id="midnight-resume-countdown-row" hidden>
            <p id="midnight-resume-countdown-text"></p>
            <div id="midnight-resume-countdown-bar" class="midnight-loading-track">
              <span id="midnight-resume-countdown-fill" class="midnight-loading-fill"></span>
            </div>
          </div>
          <!-- 第一天/第二天夜之強敵系統倒數（2026-09-06優化，使用者明確規格「系統自動
               倒數讀條10s」）：純顯示，玩家不用也不能操作，見
               static/midnight.jsのrenderFinalCircleCountdown()。 -->
          <p id="midnight-final-circle-countdown" hidden></p>
          <!-- 第一天夜之強敵戰後（2026-09-06三次優化，使用者明確規格「第一天夜之強敵戰鬥
               結束後，總計時10秒後才正式開始第二天倒計時，能選的只有祝福與離去」）：只有
               祝福＋離去，沒有商人。離去純本地端關閉這個區塊，見
               static/midnight.jsのhandleDay1RewardsLeaveClick()。 -->
          <div id="midnight-hud-day1-rewards-row" hidden>
            <button type="button" id="btn-midnight-hud-blessing-day1" data-i18n="midnight_hud_blessing_button"></button>
            <button type="button" id="btn-midnight-hud-day1-leave" data-i18n="midnight_hud_leave_button"></button>
          </div>
          <!-- 第二天夜之強敵戰後（2026-09-06三次優化，使用者明確規格「第二天戰鬥結束後，
               沒有總計時，能選的有祝福商人與離去，接著才是按準備進入第三天」）：祝福／
               商人／離去為一組，離去只關閉這一組本地顯示，不影響下方獨立的「準備」列，見
               static/midnight.jsのrenderFinalCircleRewardsHud()。 -->
          <button type="button" id="btn-midnight-hud-blessing" data-i18n="midnight_hud_blessing_button" hidden></button>
          <div id="midnight-hud-merchant-row" hidden>
            <button type="button" id="btn-midnight-open-merchant-hud" data-i18n="midnight_hud_merchant_button"></button>
            <button type="button" id="btn-midnight-hud-day2-leave" data-i18n="midnight_hud_leave_button"></button>
          </div>
          <div id="midnight-hud-ready-final-row" hidden>
            <button type="button" id="btn-midnight-ready-final-boss"></button>
            <span id="midnight-ready-final-note"></span>
          </div>
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
            <canvas id="midnight-minimap-canvas" hidden></canvas>
            <button type="button" id="btn-midnight-map-icon" data-i18n="midnight_map_icon_label"></button>
          </div>
          <button type="button" id="btn-midnight-open-character-sheet" data-i18n="midnight_character_sheet_open_button"></button>
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
          <div id="midnight-test-panel" hidden>
            <h3 data-i18n="midnight_test_panel_title"></h3>
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
          </div>
        </div>

        <div id="midnight-menu-panel" hidden>
          <button type="button" id="btn-midnight-pause-game" data-i18n="midnight_pause_button"></button>
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
            </div>
            <p id="midnight-field-encounter-name"></p>
          </div>
          <div class="midnight-bar-row midnight-enemy-hp-row">
            <span class="midnight-bar-label" data-i18n="midnight_enemy_hp_label"></span>
            <span class="midnight-bar-track"><span class="midnight-bar-fill midnight-bar-enemy" id="midnight-enemy-hp-fill"></span></span>
            <span class="midnight-bar-value" id="midnight-enemy-hp-value"></span>
          </div>
          <!-- 屬性/狀態異常共同蓄積小型顯示（2026-09-05武器資料真正接入新增，見
               static/midnight.js的renderAttributeAccumNote()），純文字列出目前
               combat target累積中的項目，例如「炎:3  猛毒:5」。 -->
          <p id="midnight-attribute-accum-note"></p>
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

        <div id="midnight-tower-puzzle-modal" hidden>
          <div id="midnight-tower-puzzle-box">
            <h3 data-i18n="midnight_puzzle_title"></h3>
            <p id="midnight-puzzle-timer"></p>
            <p id="midnight-puzzle-question"></p>
            <input type="number" id="midnight-puzzle-answer-input">
            <div class="wb-row">
              <button type="button" id="btn-midnight-puzzle-submit" data-i18n="midnight_puzzle_submit_button"></button>
              <button type="button" id="btn-midnight-puzzle-close" data-i18n="midnight_puzzle_close_button"></button>
            </div>
            <p id="midnight-puzzle-result"></p>
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
            <div id="midnight-merchant-forge-list"></div>
            <p id="midnight-merchant-forge-result"></p>
            <button type="button" id="btn-midnight-merchant-close" data-i18n="midnight_merchant_close_button"></button>
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
              <ul id="midnight-reward-list"></ul>
              <div id="midnight-reward-detail"></div>
            </div>
            <button type="button" id="btn-midnight-reward-close" data-i18n="midnight_reward_close_button"></button>
          </div>
        </div>
      </div>

      <div id="midnight-hud" hidden>
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
            "auto_gm.js",
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
            "night_gm_flow.js",
            "midnight_map.js",
            "midnight.js",
        ),
    )
