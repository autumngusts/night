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
from site_src.night_page import build_night_html

ROOT = Path(__file__).parent
DIST_DIR = ROOT / "dist"
STATIC_SRC_DIR = ROOT / "static_src"


def build_static_assets() -> None:
    static_dist = DIST_DIR / "static"
    static_dist.mkdir(parents=True, exist_ok=True)
    shutil.copy(STATIC_SRC_DIR / "style.css", static_dist / "style.css")
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
    ):
        shutil.copy(STATIC_SRC_DIR / name, static_dist / name)

    template = (STATIC_SRC_DIR / "i18n.template.js").read_text(encoding="utf-8")
    data = json.dumps(STRINGS, ensure_ascii=False, indent=2)
    (static_dist / "i18n.js").write_text(
        template.replace("__I18N_DATA__", data), encoding="utf-8"
    )

    images_src = STATIC_SRC_DIR / "images"
    if images_src.is_dir():
        shutil.copytree(images_src, static_dist / "images")


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


def main() -> None:
    for name in ("index.html", "night", "admin", "characters", "static"):
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
