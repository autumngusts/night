"""PriTest サイト全体のビルドスクリプト。

site_src/ の Python コードがホームページと各ミニプロジェクトの HTML を
組み立て、static_src/ の CSS/JS をそのまま dist/static/ にコピーする。
GitHub Actions から実行され、dist/ がそのまま GitHub Pages に公開される。
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path

from site_src.admin_page import build_admin_html
from site_src.admin_scenarios_page import build_admin_scenarios_html
from site_src.characters_page import build_characters_html
from site_src.i18n_data import STRINGS
from site_src.index_page import build_index_html
from site_src.midnight_page import build_midnight_html
from site_src.night_page import build_night_html
from site_src.toushou_page import TOUSHOU_SCRIPTS, build_toushou_html
from site_src.utau_page import UTAU_SCRIPTS, build_utau_html
from site_src.gousei_page import GOUSEI_DATA_FILES, GOUSEI_SCRIPTS, build_gousei_html
from site_src.katana_page import KATANA_SCRIPTS, build_katana_html
from site_src.yellow_page import YELLOW_SCRIPTS, build_yellow_html
from site_src.fist_page import FIST_SCRIPTS, build_fist_html
from site_src.dejavu_page import DEJAVU_SCRIPTS, build_dejavu_html

ROOT = Path(__file__).parent
DIST_DIR = ROOT / "dist"
STATIC_SRC_DIR = ROOT / "static_src"


# 各遊戲字串鍵的前綴 → static/i18n/<遊戲>.js（其餘留在共用的 i18n.js）
GAME_I18N_PREFIXES: dict[str, tuple[str, ...]] = {
    "yellow": ("yc_",),
    "katana": ("kt_",),
    "dejavu": ("dv_",),
    "fist": ("fe_", "fr_"),
    "toushou": ("ts_",),
    "utau": ("ut_",),
    "gousei": ("gs_",),
}


def split_strings(strings: dict[str, dict[str, str]]) -> tuple[dict[str, dict[str, str]], dict[str, dict[str, dict[str, str]]]]:
    shared: dict[str, dict[str, str]] = {lang: {} for lang in strings}
    per_game: dict[str, dict[str, dict[str, str]]] = {g: {lang: {} for lang in strings} for g in GAME_I18N_PREFIXES}
    for lang, table in strings.items():
        for key, text in table.items():
            owner = next((g for g, ps in GAME_I18N_PREFIXES.items() if key.startswith(ps)), None)
            (per_game[owner][lang] if owner else shared[lang])[key] = text
    return shared, per_game


def build_static_assets() -> None:
    static_dist = DIST_DIR / "static"
    static_dist.mkdir(parents=True, exist_ok=True)
    shutil.copy(STATIC_SRC_DIR / "style.css", static_dist / "style.css")
    # 各遊戲自己的樣式（頁面用 extra_styles 載入）
    css_src = STATIC_SRC_DIR / "css"
    if css_src.is_dir():
        shutil.copytree(css_src, static_dist / "css", dirs_exist_ok=True)
    for name in (
        "games.js",
        "firebase_config.js",
        "game_storage.js",
        "scenarios.js",
        "character_types.js",
        "weapons_categories.js",
        "weapons_skills.js",
        "weapons_data.js",
        "weapons.js",
        "weapon_rulebook.js",
        "talismans.js",
        "consumables.js",
        "graces.js",
        "field_rules.js",
        "character_drawer.js",
        "night_bosses.js",
        "night_boss_rulebook.js",
        "enemies_data_1.js",
        "enemies_data_2.js",
        "enemies_data_3.js",
        "enemies_data_4.js",
        "enemies.js",
        "enemy_auto_gm_data.js",
        "boss_auto_gm_data.js",
        "auto_gm.js",
        "fields_data_1.js",
        "fields_data_2.js",
        "fields_data_3.js",
        "fields_data_4.js",
        "fields.js",
        "event_rulebook.js",
        "worldview.js",
        "qrcode.js",
        "night_rulebook.js",
        "night_weapon_rulebook.js",
        "night_event_chips.js",
        "night_potential_power.js",
        "night_floor_breakthrough.js",
        "night_gm_flow.js",
        "night.js",
        "admin.js",
        "admin_scenarios.js",
        "characters.js",
        "midnight_puzzles.js",
        "midnight_random_events.js",
        "midnight_map_variants.js",
        "midnight_map.js",
        "midnight_text_adapt.js",
        "midnight_relic_memory.js",
        "midnight_relic_memory_catalog.js",
        "weapon_affixes.js",
        "enemy_sprite_data.js",
        "enemy_sprite_registry.js",
        "enemy_action_anim_map.js",
        "midnight_sprite.js",
        "player_sprite_data.js",
        "player_sprite_registry.js",
        "midnight_player_sprite.js",
        "enemy_counter_rules.js",
        "midnight.js",
        *TOUSHOU_SCRIPTS,
        *UTAU_SCRIPTS,
        *GOUSEI_SCRIPTS,
        *KATANA_SCRIPTS,
        *YELLOW_SCRIPTS,
        *FIST_SCRIPTS,
        *DEJAVU_SCRIPTS,
    ):
        shutil.copy(STATIC_SRC_DIR / name, static_dist / name)

    # 武俠合成的主題資料：頁面動態載入，不在 script 清單裡；尚未建置的主題略過
    for name in GOUSEI_DATA_FILES:
        if (STATIC_SRC_DIR / name).is_file():
            shutil.copy(STATIC_SRC_DIR / name, static_dist / name)

    # 字串：共用的放 i18n.js；各遊戲的（依鍵的前綴）放 i18n/<遊戲>.js，頁面用 extra_i18n 載入
    # （使用者指定 2026-10-26：每個遊戲分開 JS／CSS，更新不互相影響；也讓每頁不用下載其他遊戲的字串）
    shared, per_game = split_strings(STRINGS)
    template = (STATIC_SRC_DIR / "i18n.template.js").read_text(encoding="utf-8")
    data = json.dumps(shared, ensure_ascii=False, indent=2)
    (static_dist / "i18n.js").write_text(
        template.replace("__I18N_DATA__", data), encoding="utf-8"
    )
    (static_dist / "i18n").mkdir(exist_ok=True)
    for game, strings in per_game.items():
        (static_dist / "i18n" / f"{game}.js").write_text(
            f"// 由 generate.py 從 site_src 的字串產生（{game}）\nwindow.I18N.extend({json.dumps(strings, ensure_ascii=False, indent=2)});\n",
            encoding="utf-8",
        )

    images_src = STATIC_SRC_DIR / "images"
    if images_src.is_dir():
        shutil.copytree(images_src, static_dist / "images")

    # 神前鍛刀對決的美術素材（docs/katana_art_spec.md §6）
    katana_art_src = STATIC_SRC_DIR / "katana_art"
    if katana_art_src.is_dir():
        shutil.copytree(katana_art_src, static_dist / "katana_art")


def build_pages() -> None:
    (DIST_DIR / "index.html").write_text(build_index_html(), encoding="utf-8")

    night_dir = DIST_DIR / "night"
    night_dir.mkdir(parents=True, exist_ok=True)
    (night_dir / "index.html").write_text(build_night_html(), encoding="utf-8")

    admin_dir = DIST_DIR / "admin"
    admin_dir.mkdir(parents=True, exist_ok=True)
    (admin_dir / "index.html").write_text(build_admin_html(), encoding="utf-8")

    admin_scenarios_dir = admin_dir / "scenarios"
    admin_scenarios_dir.mkdir(parents=True, exist_ok=True)
    (admin_scenarios_dir / "index.html").write_text(build_admin_scenarios_html(), encoding="utf-8")

    characters_dir = DIST_DIR / "characters"
    characters_dir.mkdir(parents=True, exist_ok=True)
    (characters_dir / "index.html").write_text(build_characters_html(), encoding="utf-8")

    midnight_dir = DIST_DIR / "midnight"
    midnight_dir.mkdir(parents=True, exist_ok=True)
    (midnight_dir / "index.html").write_text(build_midnight_html(), encoding="utf-8")

    toushou_dir = DIST_DIR / "toushou"
    toushou_dir.mkdir(parents=True, exist_ok=True)
    (toushou_dir / "index.html").write_text(build_toushou_html(), encoding="utf-8")

    utau_dir = DIST_DIR / "utau"
    utau_dir.mkdir(parents=True, exist_ok=True)
    (utau_dir / "index.html").write_text(build_utau_html(), encoding="utf-8")

    gousei_dir = DIST_DIR / "gousei"
    gousei_dir.mkdir(parents=True, exist_ok=True)
    (gousei_dir / "index.html").write_text(build_gousei_html(), encoding="utf-8")

    katana_dir = DIST_DIR / "katana"
    katana_dir.mkdir(parents=True, exist_ok=True)
    (katana_dir / "index.html").write_text(build_katana_html(), encoding="utf-8")

    yellow_dir = DIST_DIR / "yellow"
    yellow_dir.mkdir(parents=True, exist_ok=True)
    (yellow_dir / "index.html").write_text(build_yellow_html(), encoding="utf-8")

    fist_dir = DIST_DIR / "fist"
    fist_dir.mkdir(parents=True, exist_ok=True)
    (fist_dir / "index.html").write_text(build_fist_html(), encoding="utf-8")

    dejavu_dir = DIST_DIR / "dejavu"
    dejavu_dir.mkdir(parents=True, exist_ok=True)
    (dejavu_dir / "index.html").write_text(build_dejavu_html(), encoding="utf-8")


def main() -> None:
    for name in ("index.html", "night", "admin", "characters", "midnight", "toushou", "utau", "gousei", "katana", "yellow", "fist", "dejavu", "static"):
        target = DIST_DIR / name
        if target.is_dir():
            shutil.rmtree(target)
        elif target.exists():
            target.unlink()
    DIST_DIR.mkdir(parents=True, exist_ok=True)
    build_static_assets()
    build_pages()
    print(f"Generated site into {DIST_DIR}")


if __name__ == "__main__":
    main()
