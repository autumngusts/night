"""角色欄位ページ（1つのゲームセーブに紐づく最大10体のキャラクター管理）を組み立てる。

画面構造:
  character-list    ... 入場中/未入場のキャラクター一覧（最大10件）。
  character-drawer  ... 名前・HP/FP・加護・屬性・狀態・裝備・武器・技能・
                        大招・道具を編集するスライドインドロワー。

実際のロジックと永続化（localStorage への JSON 保存）は
static/games.js・static/characters.js（クライアントサイド）が担当する。
"""

from __future__ import annotations

from site_src.layout import page_shell

BODY = """    <a class="back-link" href="../admin/index.html" data-i18n="back_admin"></a>
    <h1 id="game-title"></h1>

    <div id="screen-missing-game" hidden>
      <p data-i18n="game_not_found"></p>
      <a class="back-link" href="../admin/index.html" data-i18n="back_admin"></a>
    </div>

    <section id="screen-characters">
      <div class="field-row-block">
        <label data-i18n="character_type_label"></label>
        <select id="character-type-select"></select>
      </div>
      <div class="actions">
        <button id="btn-add-character" type="button" class="primary-btn" data-i18n="add_character_button"></button>
        <a id="btn-enter-map" class="primary-btn" href="#" data-i18n="enter_map_button"></a>
        <button id="btn-view-gallery" type="button" data-i18n="character_gallery_button"></button>
      </div>

      <ul id="character-list" class="character-list"></ul>
    </section>

    <div id="gallery-modal" class="modal" hidden>
      <div class="modal-box gallery-modal-box">
        <h2 data-i18n="character_gallery_title"></h2>
        <div id="gallery-carousel" class="gallery-carousel">
          <button id="btn-gallery-prev" type="button" class="gallery-carousel-arrow" data-i18n="gallery_prev_button"></button>
          <div class="gallery-carousel-card">
            <img id="gallery-carousel-image" class="gallery-carousel-image" alt="" hidden />
            <p id="gallery-carousel-name" class="gallery-carousel-name"></p>
            <button id="btn-gallery-detail-toggle" type="button" data-i18n="gallery_detail_toggle_button"></button>
            <div id="gallery-carousel-detail" class="threat-ref-block" hidden>
              <p id="gallery-carousel-stats" class="threat-ref-body"></p>
              <h3 data-i18n="cv_active_skills_title"></h3>
              <div id="gallery-carousel-active"></div>
              <h3 data-i18n="cv_passives_title"></h3>
              <div id="gallery-carousel-passive"></div>
            </div>
          </div>
          <button id="btn-gallery-next" type="button" class="gallery-carousel-arrow" data-i18n="gallery_next_button"></button>
        </div>
        <div class="actions">
          <button id="btn-gallery-close" type="button" class="primary-btn" data-i18n="close_button"></button>
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
              <span id="char-hp-talisman-bonus" class="level-bonus-marker talisman-bonus-marker"></span>
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
              <span id="char-fp-talisman-bonus" class="level-bonus-marker talisman-bonus-marker"></span>
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
              <span id="char-blessing-talisman-bonus" class="level-bonus-marker talisman-bonus-marker"></span>
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
              <span id="char-flask-uses-penalty-marker" class="level-bonus-marker"></span>
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
"""


def build_characters_html() -> str:
    return page_shell(
        title="Characters - PriTest",
        body=BODY,
        static_prefix="../static/",
        home_href="../index.html",
        extra_scripts=(
            "games.js",
            "firebase_config.js",
            "game_storage.js",
            "character_types.js",
            "weapons_categories.js",
            "weapons_skills.js",
            "weapons_data.js",
            "weapons.js",
            "weapon_rulebook.js",
            "talismans.js",
            "consumables.js",
            "character_drawer.js",
            "characters.js",
        ),
    )
