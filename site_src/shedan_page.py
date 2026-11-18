"""射彈宇宙（shedan）的頁面。

彈弓式彈射＋肉鴿：拖曳拉弓射出角色，在 9:16 的星空戰場反彈撞擊敵人，打出 Hit、連爆與星象反應。
規則依據 docs/shedan_game_design.md；設計 docs/superpowers/specs/2026-11-17-shedan-design.md。
載入順序：vendor/matter.min.js → shedan_rng.js → shedan_data.js → shedan_data_heroes.js → shedan_data_enemies.js
→ shedan_data_relics.js（遺物、套裝、事件）→ shedan_combat.js（規則，不碰 DOM／物理）→ shedan_physics.js（matter.js 場地）
→ shedan_run.js（遠征規則：地圖、節點、獎勵）→ shedan_render.js（Canvas）→ shedan.js（畫面流程）。
頁面滿版，原本的導覽列平時隱藏，左上 ☰ 鍵展開。頭像沿用 static/images/jikan/ 的 g_ 系列。
2026-11-18 依使用者需求新增；首頁 test 分頁只顯示、不能點，要自己輸入 /shedan 進入。
"""

from __future__ import annotations

from site_src.layout import page_shell

SHEDAN_SCRIPTS: tuple[str, ...] = (
    "shedan_rng.js",
    "shedan_data.js",
    "shedan_data_heroes.js",
    "shedan_data_enemies.js",
    "shedan_data_relics.js",
    "shedan_combat.js",
    "shedan_physics.js",
    "shedan_run.js",
    "shedan_render.js",
    "shedan.js",
)

# matter.js 在 vendor/ 裡，由 generate.py 整個資料夾複製，不在 SHEDAN_SCRIPTS（複製清單）裡
PAGE_SCRIPTS: tuple[str, ...] = ("vendor/matter.min.js", *SHEDAN_SCRIPTS)


def build_shedan_html() -> str:
    body = """    <div id="sd-app" data-img="../static/images/jikan/">
      <noscript>這個遊戲需要 JavaScript。</noscript>
    </div>
"""
    return page_shell(
        title="射彈宇宙",
        body=body,
        static_prefix="../static/",
        home_href="../index.html",
        extra_scripts=PAGE_SCRIPTS,
        extra_styles=("css/shedan.css",),
        extra_i18n=("i18n/shedan.js",),
    )
