"""Night ミニゲーム（トランプ翻牌占い）ページを組み立てる。

画面構造:
  screen-board  ... 常時表示される盤面（3x3 + 起點/終點・ログ）。
                    localStorage に保存された状態があればそのまま復元される。
  select-drawer ... 開始/次の夜で右からスライドインするカード選択ドロワー。
  modal         ... 翻開/放回牌庫の確認ダイアログ。

実際のゲームロジックと永続化（localStorage への JSON 保存）は
static/night.js（クライアントサイド）が担当する。
"""

from __future__ import annotations

from site_src.layout import page_shell

BODY = """    <div class="night-header-row">
      <div class="night-header-left">
        <div class="main-menu-block" id="main-menu-block">
          <button type="button" class="main-menu-toggle-btn" id="btn-main-menu-toggle" aria-label="toggle main menu">&#9776;</button>
          <div class="main-menu-list" id="main-menu-list">
            <a id="link-characters" class="back-link main-menu-item" href="../index.html" data-i18n="back_characters"></a>
            <button id="btn-undo-night" type="button" class="main-menu-item" data-i18n="undo_night_button"></button>
            <button id="btn-primary-action" type="button" class="main-menu-item primary-btn"></button>
            <button id="btn-new-game" type="button" class="main-menu-item danger-btn" data-i18n="new_game_button"></button>
            <button id="btn-battle-info" type="button" class="main-menu-item" data-i18n="battle_sheet_label"></button>
            <button id="btn-potential-power-info" type="button" class="main-menu-item" data-i18n="potential_power_menu_label"></button>
          </div>
        </div>
        <h1 data-i18n="project_night_name"></h1>
        <p id="day-status" class="day-status"></p>
        <button type="button" class="info-btn" id="btn-setup-info">i</button>
        <div id="setup-info-bubble" class="info-bubble" hidden>
          <button type="button" class="info-bubble-close" id="setup-info-close">&times;</button>
          <h3 id="setup-info-title"></h3>
          <div id="setup-info-body"></div>
        </div>
      </div>
    </div>

    <div id="screen-missing-game" hidden>
      <p data-i18n="game_not_found"></p>
      <a class="back-link" href="../admin/index.html" data-i18n="back_admin"></a>
    </div>

    <section id="screen-board" class="screen">
      <div class="board-area" id="board-area">
        <div class="board-grid" id="board-grid">
          <div class="field-level field-level-0" id="field-level-0"></div>
          <div class="field-level field-level-1" id="field-level-1"></div>
          <div class="field-level field-level-2" id="field-level-2"></div>
          <div class="pile-wrap pile-wrap-start" id="pile-wrap-start">
            <button type="button" class="pile pile-start" id="pile-start"></button>
            <div class="pile-checks">
              <label class="pile-check"><input type="checkbox" id="pile-check-start-one">1</label>
              <label class="pile-check"><input type="checkbox" id="pile-check-start-all"><span data-i18n="check_all_label"></span></label>
            </div>
          </div>
          <div class="pile-wrap pile-wrap-end" id="pile-wrap-end">
            <button type="button" class="pile pile-end" id="pile-end"></button>
            <div class="pile-checks">
              <label class="pile-check"><input type="checkbox" id="pile-check-end-one">1</label>
              <label class="pile-check"><input type="checkbox" id="pile-check-end-all"><span data-i18n="check_all_label"></span></label>
            </div>
          </div>
        </div>
        <div class="board-side-wrap">
          <div id="board-side-enemies" class="selected-enemy-list board-side-enemies" hidden></div>
          <div id="board-side-mob-hp" class="board-side-enemy-hp" hidden>
            <h4 data-i18n="battle_mob_hp_title"></h4>
            <div id="board-side-mob-hp-list"></div>
          </div>
          <div id="board-side-enemy-hp" class="board-side-enemy-hp" hidden>
            <h4 data-i18n="battle_enemy_hp_title"></h4>
            <div class="battle-hp-grid battle-hp-grid-compact" id="board-side-enemy-hp-grid"></div>
          </div>
          <div id="board-side-position" class="board-side-enemy-hp" hidden>
            <h4 data-i18n="battle_areas_title"></h4>
            <div class="battle-areas">
              <div class="battle-area">
                <h5 data-i18n="battle_front_area_label"></h5>
                <div class="battle-toggle-grid" id="board-side-position-front"></div>
              </div>
              <div class="battle-area">
                <h5 data-i18n="battle_back_area_label"></h5>
                <div class="battle-toggle-grid" id="board-side-position-back"></div>
              </div>
            </div>
          </div>
        </div>
        <div class="night3-boss-wrap">
          <img id="night3-boss-image" class="night3-boss-image" hidden>
          <div id="night3-boss-hp" class="board-side-enemy-hp night3-boss-hp" hidden>
            <h4 data-i18n="battle_enemy_hp_title"></h4>
            <div class="battle-hp-grid battle-hp-grid-compact" id="night3-boss-hp-grid"></div>
          </div>
        </div>
      </div>
      <div class="time-loss-bar" id="time-loss-bar">
        <span data-i18n="time_loss_summary_label"></span>
        <span id="time-loss-summary"></span>
        <button type="button" class="info-btn" id="btn-time-loss-info">i</button>
      </div>
      <div class="time-loss-bar" id="attribute-status-bar">
        <span data-i18n="attribute_status_bar_label"></span>
        <button type="button" class="info-btn" id="btn-attribute-status-info">i</button>
      </div>
      <div class="dice-pool-block" id="dice-pool-bar">
        <div class="dice-pool-header">
          <span data-i18n="dice_pool_label"></span>
          <button type="button" class="dice-add-btn" id="btn-dice-pool-add">&#127922;</button>
        </div>
        <div class="dice-pool-list" id="dice-pool-list"></div>
        <button type="button" class="primary-btn action-phase-btn" id="btn-action-phase"></button>
      </div>

      <div class="function-menu-block" id="function-menu-block">
        <button type="button" class="function-menu-toggle-btn" id="btn-function-menu-toggle" aria-label="toggle function menu">&#9654;</button>
        <div class="function-menu-list" id="function-menu-list">
          <button type="button" class="primary-btn function-menu-item" id="btn-generic-check" data-i18n="generic_check_button"></button>
        </div>
      </div>

      <div id="action-phase-modal" class="modal" hidden>
        <div class="modal-box">
          <p id="action-phase-modal-title" data-i18n="action_phase_select_title"></p>
          <div class="actions action-phase-grid">
            <button type="button" data-phase="normal" data-i18n="action_phase_normal"></button>
            <button type="button" data-phase="combat" data-i18n="action_phase_combat"></button>
            <button type="button" data-phase="extra" data-i18n="action_phase_extra"></button>
            <button type="button" data-phase="defense" data-i18n="action_phase_defense"></button>
          </div>
          <div class="actions">
            <button id="btn-action-phase-cancel" type="button" data-i18n="cancel_button"></button>
          </div>
        </div>
      </div>
      <div class="character-roster" id="character-roster">
        <h3 data-i18n="character_roster_title"></h3>
        <div class="character-roster-table-wrap">
          <table class="character-roster-table" id="character-roster-table">
            <thead>
              <tr>
                <th></th>
                <th data-i18n="character_roster_col_name"></th>
                <th data-i18n="character_type_label"></th>
                <th data-i18n="record_level_label"></th>
                <th data-i18n="character_hp_label"></th>
                <th data-i18n="character_fp_label"></th>
                <th data-i18n="character_blessing_slots_label"></th>
                <th data-i18n="record_flask_base_label"></th>
              </tr>
            </thead>
            <tbody id="character-roster-tbody"></tbody>
          </table>
        </div>
        <hr class="roster-skills-divider">
        <div class="roster-skills-header">
          <h3 data-i18n="roster_skills_section_title"></h3>
          <button id="btn-roster-skills-toggle" type="button" class="icon-btn" aria-label="toggle roster skills">👁</button>
        </div>
        <div id="character-roster-skills"></div>
      </div>
      <div class="log-panel">
        <div class="log-header">
          <h2 data-i18n="log_title"></h2>
          <button id="btn-log-toggle" type="button" class="icon-btn" aria-label="toggle log">👁</button>
        </div>
        <ul id="log-list"></ul>
      </div>

      <div class="threat-ref-block">
        <button type="button" id="btn-open-rulebook" data-i18n="rulebook_open_button"></button>
      </div>
    </section>

    <div id="rulebook-modal" class="modal" hidden>
      <div class="modal-box gallery-modal-box rulebook-modal-box">
        <button type="button" id="btn-rulebook-floating-close" class="modal-floating-close" aria-label="close">×</button>
        <h2 data-i18n="boss_rulebook_title"></h2>
        <div class="rulebook-tabs" id="rulebook-tabs">
          <button type="button" class="rulebook-tab-btn active" data-tab="nightking" data-i18n="rulebook_tab_nightking"></button>
          <button type="button" class="rulebook-tab-btn" data-tab="miniking" data-i18n="rulebook_tab_miniking"></button>
          <button type="button" class="rulebook-tab-btn" data-tab="enemy" data-i18n="rulebook_tab_enemy"></button>
          <button type="button" class="rulebook-tab-btn" data-tab="weapon" data-i18n="rulebook_tab_weapon"></button>
          <button type="button" class="rulebook-tab-btn" data-tab="talisman" data-i18n="rulebook_tab_talisman"></button>
          <button type="button" class="rulebook-tab-btn" data-tab="consumable" data-i18n="rulebook_tab_consumable"></button>
          <button type="button" class="rulebook-tab-btn" data-tab="board" data-i18n="rulebook_tab_board"></button>
          <button type="button" class="rulebook-tab-btn" data-tab="event" data-i18n="rulebook_tab_event"></button>
          <button type="button" class="rulebook-tab-btn" data-tab="worldview" data-i18n="rulebook_tab_worldview"></button>
        </div>
        <div class="rulebook-tab-panel" id="rulebook-panel-nightking">
          <div id="boss-rulebook-list"></div>
        </div>
        <div class="rulebook-tab-panel" id="rulebook-panel-miniking" hidden>
          <p class="threat-ref-body" data-i18n="rulebook_no_data"></p>
        </div>
        <div class="rulebook-tab-panel" id="rulebook-panel-enemy" hidden>
          <div class="weapon-search-box">
            <input type="text" id="enemy-rulebook-search-input">
          </div>
          <div class="weapon-subtabs" id="enemy-family-subtabs"></div>
          <div id="enemy-rulebook-list"></div>
        </div>
        <div class="rulebook-tab-panel" id="rulebook-panel-weapon" hidden>
          <div class="weapon-subtabs" id="weapon-subtabs"></div>
          <div id="weapon-subtab-panels"></div>
        </div>
        <div class="rulebook-tab-panel" id="rulebook-panel-talisman" hidden>
          <div id="talisman-acquisition-table"></div>
          <div id="talisman-rulebook-list"></div>
        </div>
        <div class="rulebook-tab-panel" id="rulebook-panel-consumable" hidden>
          <div id="consumable-determine-table"></div>
          <div id="consumable-rulebook-list"></div>
        </div>
        <div class="rulebook-tab-panel" id="rulebook-panel-board" hidden>
          <div id="field-rulebook-list"></div>
        </div>
        <div class="rulebook-tab-panel" id="rulebook-panel-event" hidden>
          <div id="event-rulebook-list"></div>
        </div>
        <div class="rulebook-tab-panel" id="rulebook-panel-worldview" hidden>
          <div id="worldview-rulebook-list"></div>
        </div>
        <div class="actions">
          <button type="button" id="btn-rulebook-close" class="primary-btn" data-i18n="close_button"></button>
        </div>
      </div>
    </div>

    <div id="select-drawer" class="drawer">
      <div class="drawer-backdrop" id="drawer-backdrop"></div>
      <div class="drawer-panel">
        <h2 id="select-title"></h2>
        <div id="select-grid" class="card-groups"></div>
        <p id="select-count"></p>
        <div class="actions">
          <button id="btn-select-cancel" type="button" data-i18n="cancel_button"></button>
          <button id="btn-select-submit" type="button" class="primary-btn" data-i18n="submit_button"></button>
        </div>
      </div>
    </div>

    <div id="keep-drawer" class="drawer">
      <div class="drawer-backdrop" id="keep-drawer-backdrop"></div>
      <div class="drawer-panel">
        <h2 data-i18n="keep_cards_title"></h2>
        <p id="keep-terrain-note" class="threat-ref-body" hidden></p>
        <div id="keep-grid" class="suit-grid"></div>
        <p id="keep-count"></p>
        <div class="actions">
          <button id="btn-keep-cancel" type="button" data-i18n="cancel_button"></button>
          <button id="btn-keep-submit" type="button" class="primary-btn" data-i18n="submit_button"></button>
        </div>
      </div>
    </div>

    <div id="modal" class="modal" hidden>
      <div class="modal-box">
        <p id="modal-message"></p>
        <div class="actions">
          <button id="modal-no" type="button" data-i18n="no_button"></button>
          <button id="modal-yes" type="button" class="primary-btn" data-i18n="yes_button"></button>
          <button id="modal-extra" type="button" class="danger-btn" hidden></button>
        </div>
      </div>
    </div>

    <div id="combat-modal" class="modal" hidden>
      <div class="modal-box combat-modal-box">
        <h2 id="combat-modal-title"></h2>
        <p id="combat-modal-error" class="error-banner" hidden></p>
        <div class="combat-action-grid">
          <button type="button" class="combat-action-btn combat-action-normal-btn" data-action="attack" data-i18n="combat_action_attack"></button>
          <button type="button" class="combat-action-btn combat-action-normal-btn" data-action="skill" data-i18n="combat_action_skill"></button>
          <button type="button" class="combat-action-btn combat-action-normal-btn" data-action="flask" data-i18n="combat_action_flask"></button>
          <button type="button" class="combat-action-btn combat-action-normal-btn" data-action="consumable" data-i18n="combat_action_consumable"></button>
          <button type="button" class="combat-action-btn combat-action-normal-btn" data-action="move" data-i18n="combat_action_move"></button>
          <button type="button" class="combat-action-btn combat-action-normal-btn" data-action="equip" data-i18n="combat_action_equip"></button>
          <button type="button" class="combat-action-btn combat-action-defense-btn" data-action="defense" data-i18n="combat_action_defense" hidden></button>
        </div>
        <div id="combat-modal-content"></div>
        <div class="actions">
          <button id="btn-combat-modal-close" type="button" class="primary-btn" data-i18n="close_button"></button>
        </div>
      </div>
    </div>

    <div id="merchant-modal" class="modal" hidden>
      <div class="modal-box combat-modal-box">
        <h2 data-i18n="merchant_modal_title"></h2>
        <div class="wb-row">
          <label data-i18n="merchant_character_label"></label>
          <select id="merchant-character-select"></select>
        </div>
        <p id="merchant-rune-label" class="threat-ref-body"></p>
        <div id="merchant-modal-content"></div>
        <div class="actions">
          <button id="btn-merchant-modal-close" type="button" class="primary-btn" data-i18n="close_button"></button>
        </div>
      </div>
    </div>

    <div id="potential-power-modal" class="modal" hidden>
      <div class="modal-box combat-modal-box">
        <h2 data-i18n="potential_power_modal_title"></h2>
        <div class="wb-row">
          <label data-i18n="potential_power_character_label"></label>
          <select id="potential-power-character-select"></select>
        </div>
        <div class="wb-row">
          <label data-i18n="potential_power_star_label"></label>
          <select id="potential-power-star-select">
            <option value="1">★</option>
            <option value="2">★★</option>
            <option value="3">★★★</option>
            <option value="4">★★★★</option>
          </select>
        </div>
        <div id="potential-power-modal-content"></div>
        <div class="actions">
          <button id="btn-potential-power-modal-close" type="button" class="primary-btn" data-i18n="close_button"></button>
        </div>
      </div>
    </div>

    <div id="breakthrough-modal" class="modal" hidden>
      <div class="modal-box combat-modal-box">
        <h2 id="breakthrough-modal-title" data-i18n="breakthrough_modal_title"></h2>
        <div id="breakthrough-import-row" class="wb-row">
          <select id="breakthrough-branch-select"></select>
          <select id="breakthrough-floor-select"></select>
          <button id="breakthrough-import-btn" type="button" data-i18n="breakthrough_import_button"></button>
        </div>
        <div class="wb-row">
          <span id="breakthrough-target-hideable" class="wb-row">
            <label data-i18n="breakthrough_target_label"></label>
            <input id="breakthrough-target-input" type="number" class="stat-input" min="0" />
            <label class="field-row">
              <input id="breakthrough-perpc-checkbox" type="checkbox" />
              <span data-i18n="breakthrough_perpc_label"></span>
            </label>
          </span>
          <select id="breakthrough-stat-select">
            <option value="any" data-i18n="check_stat_any"></option>
            <option value="luck" data-i18n="check_stat_luck"></option>
            <option value="physical" data-i18n="check_stat_physical"></option>
            <option value="mental" data-i18n="check_stat_mental"></option>
          </select>
        </div>
        <p id="breakthrough-sum-label" class="threat-ref-body"></p>
        <div id="breakthrough-characters"></div>
        <p id="breakthrough-error" class="error-banner" hidden></p>
        <div class="actions">
          <button id="btn-breakthrough-cancel" type="button" data-i18n="cancel_button"></button>
          <button id="btn-breakthrough-reveal" type="button" class="primary-btn" data-i18n="breakthrough_reveal_button"></button>
          <button id="btn-breakthrough-fail" type="button" class="danger-btn" data-i18n="breakthrough_fail_button" hidden></button>
          <button id="btn-breakthrough-pass" type="button" class="primary-btn" data-i18n="breakthrough_pass_button" hidden></button>
        </div>
      </div>
    </div>

    <div id="threat-drawer" class="drawer">
      <div class="drawer-backdrop" id="threat-drawer-backdrop"></div>
      <div class="drawer-panel">
        <button type="button" class="drawer-close-tab" data-close-btn="btn-threat-drawer-close">&rsaquo;</button>
        <div class="drawer-panel-scroll">
        <h2 data-i18n="threat_sheet_title"></h2>

        <h3 id="tl-day1-title"></h3>
        <div id="tl-day1-list" class="tl-list"></div>

        <h3 id="tl-day2-title"></h3>
        <div id="tl-day2-list" class="tl-list"></div>

        <div class="threat-ref-block">
          <h3 data-i18n="time_loss_accum_timing_title"></h3>
          <p id="time-loss-accum-timing-body" class="threat-ref-body"></p>
        </div>

        <div class="threat-ref-block">
          <h3 data-i18n="night_rain_timing_title"></h3>
          <p id="night-rain-timing-body" class="threat-ref-body"></p>
        </div>

        <div class="threat-ref-block">
          <h3 data-i18n="roll_table_title"></h3>
          <div id="roll-effects-list" class="tl-list"></div>
        </div>

        <div class="threat-ref-block">
          <h3 data-i18n="wandering_blessing_title"></h3>
          <div class="wb-row">
            <span data-i18n="wandering_blessing_base_label"></span>
            <span id="wb-base" class="wb-checks"></span>
          </div>
          <div class="wb-row">
            <span data-i18n="wandering_blessing_extra_label"></span>
            <span id="wb-extra" class="wb-checks"></span>
          </div>
        </div>

        <div class="threat-ref-block">
          <div class="field-row-block">
            <label data-i18n="smithing_stone_label"></label>
            <input type="text" id="input-smithing-stone">
          </div>
          <div class="field-row-block">
            <label data-i18n="stonesword_key_label"></label>
            <input type="text" id="input-stonesword-key">
          </div>
          <div class="field-row-block">
            <label data-i18n="grace_label"></label>
            <input type="text" id="input-grace">
          </div>
        </div>

        <div class="actions">
          <button id="btn-threat-drawer-close" type="button" class="primary-btn" data-i18n="close_button"></button>
        </div>
        </div>
      </div>
    </div>

    <div id="character-drawer" class="drawer">
      <div class="drawer-backdrop" id="character-drawer-backdrop"></div>
      <div class="drawer-panel">
        <button type="button" class="drawer-close-tab" data-close-btn="btn-character-close">&rsaquo;</button>
        <div class="drawer-panel-scroll">
        <h2 id="character-drawer-name"></h2>
        <p id="character-type-badge" class="character-type-badge"></p>
        <img id="character-portrait" class="character-portrait" hidden>

        <div class="threat-ref-block">
          <h3 data-i18n="record_sheet_title"></h3>
          <p id="char-drawer-error" class="error-banner" hidden></p>
          <div class="field-grid">
            <div class="field-row">
              <span data-i18n="record_level_label"></span>
              <span class="stat-stepper">
                <button type="button" class="level-btn" data-stepper="char-level" data-delta="-1">&minus;</button>
                <span class="level-value" id="char-level-value"></span>
                <button type="button" class="level-btn" data-stepper="char-level" data-delta="1">&plus;</button>
              </span>
              <span id="char-level-next-cost" class="level-bonus-marker"></span>
            </div>
            <div class="field-row">
              <span data-i18n="record_runes_label"></span>
              <span class="stat-stepper">
                <button type="button" class="level-btn" data-stepper="char-runes" data-delta="-1">&minus;</button>
                <span class="level-value" id="char-runes-value"></span>
                <button type="button" class="level-btn" data-stepper="char-runes" data-delta="1">&plus;</button>
              </span>
            </div>
          </div>

          <div class="field-grid">
            <div class="field-row">
              <span data-i18n="character_hp_label"></span>
              <span class="stat-stepper">
                <button type="button" class="level-btn" data-stepper="char-hp-current" data-delta="-1">&minus;</button>
                <span class="level-value" id="char-hp-current-value"></span>
                <button type="button" class="level-btn" data-stepper="char-hp-current" data-delta="1">&plus;</button>
              </span>
              <span>/</span>
              <span class="stat-stepper">
                <span class="level-value" id="char-hp-max-value" data-longpress-edit="1"></span>
              </span>
              <span id="char-hp-level-bonus" class="level-bonus-marker"></span>
            </div>
            <div class="field-row">
              <span data-i18n="character_fp_label"></span>
              <span class="stat-stepper">
                <button type="button" class="level-btn" data-stepper="char-fp-current" data-delta="-1">&minus;</button>
                <span class="level-value" id="char-fp-current-value"></span>
                <button type="button" class="level-btn" data-stepper="char-fp-current" data-delta="1">&plus;</button>
              </span>
              <span>/</span>
              <span class="stat-stepper">
                <span class="level-value" id="char-fp-max-value" data-longpress-edit="1"></span>
              </span>
              <span id="char-fp-level-bonus" class="level-bonus-marker"></span>
            </div>
          </div>
          <div class="field-grid">
            <div class="field-row">
              <span data-i18n="character_blessing_slots_label"></span>
              <span class="stat-stepper">
                <button type="button" class="level-btn" data-stepper="char-blessing-current" data-delta="-1">&minus;</button>
                <span class="level-value" id="char-blessing-current-value"></span>
                <button type="button" class="level-btn" data-stepper="char-blessing-current" data-delta="1">&plus;</button>
              </span>
              <span>/</span>
              <span class="stat-stepper">
                <span class="level-value" id="char-blessing-max-value" data-longpress-edit="1"></span>
              </span>
              <span id="char-blessing-level-bonus" class="level-bonus-marker"></span>
            </div>
          </div>
          <div class="field-grid">
            <div class="field-row">
              <span data-i18n="record_flask_base_label"></span>
              <span class="stat-stepper">
                <button type="button" class="level-btn" data-stepper="char-flask-base-used" data-delta="-1">&minus;</button>
                <span class="level-value" id="char-flask-base-used-value"></span>
                <button type="button" class="level-btn" data-stepper="char-flask-base-used" data-delta="1">&plus;</button>
              </span>
              <span>/</span>
              <span class="stat-stepper">
                <span class="level-value" id="char-flask-base-max-value" data-longpress-edit="1"></span>
              </span>
              <span class="flask-extra-inline">
                <span data-i18n="record_flask_extra_label"></span>
                <span class="stat-stepper">
                  <button type="button" class="level-btn" data-stepper="char-flask-extra-used" data-delta="-1">&minus;</button>
                  <span class="level-value" id="char-flask-extra-used-value"></span>
                  <button type="button" class="level-btn" data-stepper="char-flask-extra-used" data-delta="1">&plus;</button>
                </span>
                <span>/</span>
                <span class="stat-stepper">
                  <span class="level-value" id="char-flask-extra-max-value" data-longpress-edit="1"></span>
                </span>
              </span>
            </div>
          </div>
          <div class="field-row">
            <span data-i18n="record_flask_heal_amount_label"></span>
            <span class="stat-stepper">
              <span class="level-value" id="char-flask-heal-amount-value" data-longpress-edit="1"></span>
            </span>
            <span id="char-flask-heal-bonus" class="weapon-damage-tag"></span>
          </div>
          <div class="field-row">
            <span data-i18n="record_hp_value_label"></span>
            <input type="number" id="char-hp-value" class="stat-input" min="0">
          </div>
          <div class="field-row">
            <span data-i18n="record_revival_label"></span>
            <span class="stat-stepper">
              <button type="button" class="level-btn" data-stepper="char-revival-count" data-delta="-1">&minus;</button>
              <span class="level-value" id="char-revival-count-value"></span>
              <button type="button" class="level-btn" data-stepper="char-revival-count" data-delta="1">&plus;</button>
            </span>
            <span id="char-revival-bonus-marker" class="level-bonus-marker"></span>
          </div>
        </div>

        <label class="field-row" id="char-entered-row">
          <input type="checkbox" id="char-entered">
          <span data-i18n="character_entered_label"></span>
        </label>

        <div class="dice-pool-block">
          <div class="dice-pool-header">
            <h3 data-i18n="character_dice_pool_label"></h3>
            <button type="button" class="dice-add-btn" id="btn-char-dice-add">&#127922;</button>
          </div>
          <div class="dice-pool-list" id="char-dice-pool-list"></div>
          <p id="char-dice-pool-status" class="dice-status-label"></p>
        </div>

        <div class="weapon-db-field">
          <h3 data-i18n="weapon_db_title"></h3>
          <div class="weapon-search-box">
            <input type="text" id="weapon-search-input">
            <div class="weapon-search-results" id="weapon-search-results" hidden></div>
          </div>
          <div class="weapon-roll-field" id="weapon-roll-field"></div>
          <div id="weapon-list"></div>
        </div>

        <div class="weapon-db-field">
          <h3 data-i18n="talisman_db_title"></h3>
          <div class="weapon-search-box">
            <input type="text" id="talisman-search-input">
            <div class="weapon-search-results" id="talisman-search-results" hidden></div>
          </div>
          <div class="weapon-roll-field" id="talisman-roll-field"></div>
          <div id="talisman-list"></div>
        </div>

        <div class="weapon-db-field">
          <h3 data-i18n="consumable_db_title"></h3>
          <div class="weapon-search-box">
            <input type="text" id="consumable-search-input">
            <div class="weapon-search-results" id="consumable-search-results" hidden></div>
          </div>
          <div class="weapon-roll-field" id="consumable-roll-field"></div>
          <div id="consumable-list"></div>
        </div>

        <div class="tag-field" data-field="buildup">
          <h3 data-i18n="record_buildup_label"></h3>
          <div class="tag-list" id="tag-list-buildup"></div>
          <div class="tag-add-row">
            <input type="text" id="tag-input-buildup">
            <button type="button" class="tag-add-btn" data-field="buildup" data-i18n="tag_add_button"></button>
            <button type="button" class="danger-btn" id="btn-buildup-clear-all" data-i18n="buildup_clear_all_button"></button>
          </div>
        </div>

        <div class="threat-ref-block" id="type-reference-block" hidden>
          <h3 id="type-reference-title"></h3>
          <p id="type-reference-stats" class="threat-ref-body"></p>
        </div>
        <div class="threat-ref-block">
          <h3 data-i18n="cv_active_skills_title"></h3>
          <div id="type-active-skills"></div>
        </div>
        <div class="threat-ref-block">
          <h3 data-i18n="cv_passives_title"></h3>
          <div id="type-passives"></div>
        </div>

        <div class="threat-ref-block" id="relic-select-block">
          <h3 data-i18n="relic_select_title"></h3>
          <p class="threat-ref-body" id="relic-progress-text"></p>
          <div class="actions">
            <button type="button" id="btn-relic-roll" data-i18n="relic_roll_button"></button>
            <button type="button" id="btn-relic-toggle-all" data-i18n="relic_show_all_button"></button>
          </div>
          <div class="dice-pool-list" id="relic-dice-display"></div>
          <div id="relic-candidates"></div>
          <div id="relic-learned-list"></div>
          <div id="relic-all-list" hidden></div>
        </div>

        <div class="threat-ref-block" id="attached-select-block">
          <h3 data-i18n="attached_select_title"></h3>
          <p class="threat-ref-body" id="attached-progress-text"></p>
          <div class="actions">
            <button type="button" id="btn-attached-roll-2d" data-i18n="attached_roll_2d_button"></button>
            <button type="button" id="btn-attached-toggle-all" data-i18n="relic_show_all_button"></button>
          </div>
          <div class="dice-pool-list" id="attached-dice-display"></div>
          <div id="attached-candidates"></div>
          <div id="attached-learned-list"></div>
          <div id="attached-all-list" hidden></div>
        </div>

        <div class="actions">
          <button id="btn-delete-character" type="button" class="danger-btn" data-i18n="delete_character_button"></button>
          <button id="btn-character-close" type="button" class="primary-btn" data-i18n="close_button"></button>
        </div>
        </div>
      </div>
    </div>

    <div id="skills-drawer" class="drawer drawer-left">
      <div class="drawer-backdrop" id="skills-drawer-backdrop"></div>
      <div class="drawer-panel">
        <button type="button" class="drawer-close-tab" data-close-btn="btn-skills-drawer-close">&lsaquo;</button>
        <div class="drawer-panel-scroll">
        <h2 id="skills-drawer-name"></h2>
        <div class="threat-ref-block" id="skills-drawer-stats-block" hidden>
          <h3 id="skills-drawer-stats-title"></h3>
          <p class="threat-ref-body" id="skills-drawer-stats"></p>
        </div>
        <div class="tag-field" data-field="notes">
          <h3 data-i18n="character_notes_label"></h3>
          <div class="tag-list" id="tag-list-notes"></div>
          <div class="tag-add-row">
            <input type="text" id="tag-input-notes">
            <button type="button" class="tag-add-btn" data-field="notes" data-i18n="tag_add_button"></button>
          </div>
        </div>
        <div class="threat-ref-block">
          <h3 data-i18n="cv_active_skills_title"></h3>
          <div id="skills-drawer-active"></div>
        </div>
        <div class="threat-ref-block">
          <h3 data-i18n="cv_passives_title"></h3>
          <div id="skills-drawer-passive"></div>
        </div>
        <div class="actions">
          <button id="btn-skills-drawer-close" type="button" class="primary-btn" data-i18n="close_button"></button>
        </div>
        </div>
      </div>
    </div>

    <div id="weapon-detail-drawer" class="drawer drawer-left">
      <div class="drawer-backdrop" id="weapon-detail-drawer-backdrop"></div>
      <div class="drawer-panel">
        <button type="button" class="drawer-close-tab" data-close-btn="btn-weapon-detail-drawer-close">&lsaquo;</button>
        <div class="drawer-panel-scroll">
        <h2 data-i18n="weapon_detail_drawer_title"></h2>
        <div id="weapon-detail-drawer-body"></div>
        <div class="actions">
          <button id="btn-weapon-detail-drawer-close" type="button" class="primary-btn" data-i18n="close_button"></button>
        </div>
        </div>
      </div>
    </div>

    <div id="talisman-detail-drawer" class="drawer drawer-left">
      <div class="drawer-backdrop" id="talisman-detail-drawer-backdrop"></div>
      <div class="drawer-panel">
        <button type="button" class="drawer-close-tab" data-close-btn="btn-talisman-detail-drawer-close">&lsaquo;</button>
        <div class="drawer-panel-scroll">
        <h2 data-i18n="talisman_detail_drawer_title"></h2>
        <div id="talisman-detail-drawer-body"></div>
        <div class="actions">
          <button id="btn-talisman-detail-drawer-close" type="button" class="primary-btn" data-i18n="close_button"></button>
        </div>
        </div>
      </div>
    </div>

    <div id="consumable-detail-drawer" class="drawer drawer-left">
      <div class="drawer-backdrop" id="consumable-detail-drawer-backdrop"></div>
      <div class="drawer-panel">
        <button type="button" class="drawer-close-tab" data-close-btn="btn-consumable-detail-drawer-close">&lsaquo;</button>
        <div class="drawer-panel-scroll">
        <h2 data-i18n="consumable_detail_drawer_title"></h2>
        <div id="consumable-detail-drawer-body"></div>
        <div class="actions">
          <button id="btn-consumable-detail-drawer-close" type="button" class="primary-btn" data-i18n="close_button"></button>
        </div>
        </div>
      </div>
    </div>

    <div id="battle-drawer" class="drawer">
      <div class="drawer-backdrop" id="battle-drawer-backdrop"></div>
      <div class="drawer-panel">
        <button type="button" class="drawer-close-tab" data-close-btn="btn-battle-drawer-close">&rsaquo;</button>
        <div class="drawer-panel-scroll">
        <h2 data-i18n="battle_sheet_title"></h2>

        <div class="threat-ref-block">
          <h3 data-i18n="battle_enemy_lookup_title"></h3>
          <div class="weapon-search-box">
            <input type="text" id="battle-enemy-search-input">
            <div class="weapon-search-results" id="battle-enemy-search-results" hidden></div>
          </div>
          <div id="battle-enemy-lookup-result"></div>
        </div>

        <div class="threat-ref-block">
          <h3 data-i18n="battle_selected_enemies_title"></h3>
          <div id="battle-selected-enemies" class="selected-enemy-list" hidden></div>
        </div>

        <div class="threat-ref-block">
          <h3 data-i18n="battle_areas_title"></h3>
          <div class="battle-areas">
            <div class="battle-area">
              <h4 data-i18n="battle_front_area_label"></h4>
              <p class="threat-ref-body" data-i18n="battle_front_area_note"></p>
              <div class="battle-toggle-grid" id="battle-front-grid"></div>
            </div>
            <div class="battle-area">
              <h4 data-i18n="battle_back_area_label"></h4>
              <p class="threat-ref-body" data-i18n="battle_back_area_note"></p>
              <div class="battle-toggle-grid" id="battle-back-grid"></div>
            </div>
          </div>
        </div>

        <div class="threat-ref-block">
          <h3 data-i18n="battle_enemy_hp_title"></h3>
          <p class="threat-ref-body" data-i18n="battle_hp_apply_order_note"></p>
          <div class="battle-hp-grid" id="battle-enemy-hp-grid"></div>
        </div>

        <div class="threat-ref-block">
          <h3 data-i18n="battle_mob_hp_title"></h3>
          <p class="threat-ref-body" data-i18n="battle_mob_hp_note"></p>
          <div id="battle-mob-hp-list"></div>
          <button type="button" id="btn-battle-add-mob-row" data-i18n="battle_add_mob_row_button"></button>
        </div>

        <div class="threat-ref-block">
          <h3 data-i18n="battle_pc_damage_title"></h3>
          <p class="threat-ref-body" id="battle-pc-damage-body"></p>
        </div>
        <div class="threat-ref-block">
          <h3 data-i18n="battle_enemy_damage_title"></h3>
          <p class="threat-ref-body" id="battle-enemy-damage-body"></p>
        </div>
        <div class="threat-ref-block">
          <h3 data-i18n="battle_position_title"></h3>
          <p class="threat-ref-body" id="battle-position-body"></p>
        </div>
        <div class="threat-ref-block">
          <h3 data-i18n="battle_simple_combat_title"></h3>
          <p class="threat-ref-body" id="battle-simple-combat-body"></p>
        </div>
        <div class="threat-ref-block">
          <h3 data-i18n="battle_pc_count_title"></h3>
          <p class="threat-ref-body" id="battle-pc-count-body"></p>
        </div>

        <div class="actions">
          <button id="btn-battle-clear" type="button" class="danger-btn" data-i18n="battle_clear_button"></button>
          <button id="btn-battle-drawer-close" type="button" class="primary-btn" data-i18n="close_button"></button>
        </div>
        </div>
      </div>
    </div>

    <div id="attribute-status-drawer" class="drawer">
      <div class="drawer-backdrop" id="attribute-status-drawer-backdrop"></div>
      <div class="drawer-panel">
        <button type="button" class="drawer-close-tab" data-close-btn="btn-attribute-status-drawer-close">&rsaquo;</button>
        <div class="drawer-panel-scroll">
        <h2 data-i18n="attribute_status_panel_title"></h2>
        <p class="threat-ref-body" data-i18n="attribute_status_panel_note"></p>
        <div id="attribute-status-list"></div>
        <div class="actions">
          <button id="btn-attribute-status-drawer-close" type="button" class="primary-btn" data-i18n="close_button"></button>
        </div>
        </div>
      </div>
    </div>
"""


def build_night_html() -> str:
    return page_shell(
        title="Night - PriTest",
        body=BODY,
        static_prefix="../static/",
        home_href="../index.html",
        extra_scripts=(
            "games.js",
            "firebase_config.js",
            "game_storage.js",
            "scenarios.js",
            "character_types.js",
            "weapons.js",
            "weapon_rulebook.js",
            "talismans.js",
            "consumables.js",
            "character_drawer.js",
            "night_bosses.js",
            "night_boss_rulebook.js",
            "enemies.js",
            "fields.js",
            "event_rulebook.js",
            "worldview.js",
            "night.js",
        ),
    )
