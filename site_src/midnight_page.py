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
        <div id="midnight-incoming-attack-warning" hidden></div>
        <div id="midnight-attack-effect" hidden></div>

        <!-- 板塊(卡牌)獎勵「開啟並執行」的簡短提示（2026-09-05新增）：直接顯示獲得
             品項名稱幾秒後自動消失，不像獎勵清單彈窗需要點擊/確認。見static/midnight.js
             的showToast()。 -->
        <div id="midnight-toast" hidden></div>

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
          <button type="button" id="btn-midnight-map-icon" data-i18n="midnight_map_icon_label"></button>
          <button type="button" id="btn-midnight-open-character-sheet" data-i18n="midnight_character_sheet_open_button"></button>
          <button type="button" id="btn-midnight-toggle-menu" data-i18n="midnight_menu_button"></button>
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

        <!-- 中間下方：敵人HP，只在「碰到敵人進入戰鬥」（activeEncounter）時顯示，見
             midnight.jsのrenderCombatPanel()。 -->
        <div id="midnight-hud-bottom-center" hidden>
          <div class="midnight-bar-row midnight-enemy-hp-row">
            <span class="midnight-bar-label" data-i18n="midnight_enemy_hp_label"></span>
            <span class="midnight-bar-track"><span class="midnight-bar-fill midnight-bar-enemy" id="midnight-enemy-hp-fill"></span></span>
            <span class="midnight-bar-value" id="midnight-enemy-hp-value"></span>
          </div>
          <!-- 遇敵：靠近的地圖點分歧確定後如果指派了敵人，顯示敵人圖片/名稱（讀
               static_src/enemies_data_1~4.js既有資料，不是自己畫的圖或編的名字）。 -->
          <div id="midnight-field-encounter" hidden>
            <img id="midnight-field-encounter-image" alt="">
            <p id="midnight-field-encounter-name"></p>
          </div>
          <p id="midnight-combo-note"></p>
        </div>

        <!-- 右下：攻擊／戰技A（即時）／戰技B（魔術・祈禱，長按2秒讀條）／迴避／防禦／
             角色專屬技藝／角色專屬技能。實際扣的血由static/midnight.js的
             damageCombatTarget()判斷要打這裡的敵人還是原本的共用標靶。圖示化
             （2026-09-05戰鬥優化改版：使用者明確規格「攻擊共用標靶改成一把劍的圖示，
             戰技使用劍的圖示＋戰技，防禦使用盾牌的圖示」）：劍/盾用inline SVG
             mask-image（見style.css的.midnight-icon-sword／.midnight-icon-shield），
             不需要額外圖檔請求。 -->
        <div id="midnight-hud-bottom-right">
          <button type="button" id="btn-midnight-attack-shared-target">
            <span class="midnight-icon-sword"></span>
            <span data-i18n="midnight_attack_target_button"></span>
          </button>
          <button type="button" id="btn-midnight-skill">
            <span class="midnight-icon-sword"></span>
            <span data-i18n="midnight_skill_a_button"></span>
          </button>
          <button type="button" id="btn-midnight-skill-b">
            <span class="midnight-icon-sword"></span>
            <span class="midnight-bar-track midnight-bar-track-sm"><span class="midnight-bar-fill midnight-bar-sorcery-cast" id="midnight-skill-b-cast-fill"></span></span>
            <span data-i18n="midnight_skill_b_button"></span>
          </button>
          <button type="button" id="btn-midnight-dodge" data-i18n="midnight_dodge_button"></button>
          <button type="button" id="btn-midnight-block">
            <span class="midnight-icon-shield"></span>
            <span data-i18n="midnight_block_button"></span>
          </button>
          <!-- 角色專屬〔技藝〕〔技能〕（2026-09-05戰鬥優化新增）：對應
               character_types.js的type.arts[0]／type.skills[0]，文字直接讀該ability的
               本地化名稱，跟上面通用武器戰技demo（btn-midnight-skill/skill-b）是不同
               東西，見static/midnight.js的renderCharacterActionButtons()。角色類型若
               沒有arts/skills就整顆按鈕hidden。 -->
          <button type="button" id="btn-midnight-art" hidden>
            <span class="midnight-icon-sword"></span>
            <span id="midnight-art-label"></span>
          </button>
          <button type="button" id="btn-midnight-character-skill" hidden>
            <span class="midnight-icon-sword"></span>
            <span id="midnight-character-skill-label"></span>
          </button>
        </div>

        <!-- 全螢幕地圖modal（2026-09-05 HUD優化改版）：比照#midnight-tower-puzzle-modal
             既有的modal寫法，hidden屬性控制顯示/隱藏，展開＝拿掉hidden、收合＝加上
             hidden，不再有「縮小但看得到」的中間態（見midnight.jsのsetMapExpanded()）。 -->
        <div id="midnight-map-panel" hidden>
          <div class="wb-row">
            <button type="button" id="btn-midnight-map-close" data-i18n="midnight_map_close_button"></button>
          </div>
          <div id="midnight-canvas-wrap">
            <canvas id="midnight-canvas"></canvas>

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

            <!-- 商人籌碼（2026-09-05新增）：純本地modal（不需要跨玩家共享狀態），比照
                 midnight-tower-puzzle-modal同款巢狀<div hidden>結構。見
                 static/midnight.js的updateNearbyChipPoint()／renderMerchantModal()。 -->
            <div id="midnight-merchant-prompt" hidden>
              <button type="button" id="btn-midnight-open-merchant" data-i18n="midnight_merchant_open_button"></button>
            </div>

            <!-- 祝福籌碼（2026-09-05籌碼優化新增）：純本地proximity判斷＋跨玩家transaction
                 領取，不需要邀請/投票，比照商人籌碼同款簡單prompt。見
                 static/midnight.js的updateNearbyChipPoint()／handleBlessingClaimClick()。 -->
            <div id="midnight-blessing-prompt" hidden>
              <button type="button" id="btn-midnight-blessing-claim" data-i18n="midnight_blessing_claim_button"></button>
            </div>

            <div id="midnight-pause-overlay" hidden>
              <p id="midnight-pause-overlay-text"></p>
            </div>
            <div id="midnight-spirit-bird-prompt" hidden>
              <button type="button" id="btn-midnight-use-spirit-bird" data-i18n="midnight_spirit_bird_use_button"></button>
            </div>
            <div id="midnight-mobile-joystick" hidden>
              <div id="midnight-mobile-joystick-knob"></div>
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
                <p class="threat-ref-body" data-i18n="midnight_merchant_smithing_unsupported_note"></p>
                <button type="button" id="btn-midnight-merchant-close" data-i18n="midnight_merchant_close_button"></button>
              </div>
            </div>

            <!-- 角色屬性管理面板（2026-09-05新增，2026-09-05籌碼優化改版為左右分割＋
                 6/4/2格硬上限＋裝備/丟棄）：顯示characters[myTokenId]（
                 CharacterDrawer.newCharacter()同形狀物件）目前的等級/判定值/威力補正/
                 得意武器/武器/護符/消耗品/可發動技能/被動能力/遺物效果/附帶效果。左側
                 清單、右側detail（點擊左側任一項目顯示，比照#midnight-reward-split同款
                 左右分割pattern），見static/midnight.js的renderCharacterSheet()。 -->
            <div id="midnight-character-sheet-modal" hidden>
              <div id="midnight-character-sheet-box">
                <h3 data-i18n="midnight_character_sheet_title"></h3>
                <p id="midnight-character-sheet-summary"></p>
                <p id="midnight-character-sheet-checkvalues"></p>
                <p id="midnight-character-sheet-power"></p>
                <p id="midnight-character-sheet-favored"></p>
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
                  </div>
                  <div id="midnight-character-sheet-detail"></div>
                </div>
                <button type="button" id="btn-midnight-character-sheet-close" data-i18n="midnight_character_sheet_close_button"></button>
              </div>
            </div>

            <!-- 丟棄物撿取（2026-09-05角色面板優化新增）：地圖上閃爍的掉落物，任何人靠近
                 都能撿（不限丟棄者本人），見static/midnight.js的
                 updateNearbyGroundItem()／handlePickupGroundItem()。 -->
            <div id="midnight-ground-item-prompt" hidden>
              <button type="button" id="btn-midnight-pickup-ground-item" data-i18n="midnight_pickup_button"></button>
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
        </div>
      </div>

      <div id="midnight-hud" hidden>
        <div class="wb-row">
          <span id="midnight-hud-day-phase"></span>
          <button type="button" id="btn-midnight-advance-day2" data-i18n="midnight_advance_day2_button" hidden></button>
          <button type="button" id="btn-midnight-advance-day3" data-i18n="midnight_advance_day3_button" hidden></button>
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
