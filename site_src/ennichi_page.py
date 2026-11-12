"""緣日樂園（ennichi）的頁面。

遊戲頁 ennichi/index.html：神社遊樂園經營（規格 docs/ennichi_rules.md，計畫 docs/superpowers/plans/2026-11-12-ennichi-mvp.md）。
規則在 static/ennichi_data.js → ennichi_murmur.js → ennichi_wish.js → ennichi_core.js → ennichi_sim.js，
畫面在 ennichi_crowd.js（看板人物）→ ennichi_3d.js（three.js 樂園）→ ennichi.js（HUD、面板）。
樣本頁 ennichi/lab/index.html：人物呈現技術驗證（VRM 近景、看板人物、murmur、立繪），2026-11-12 起暫停修改。
"""

from __future__ import annotations

from site_src.layout import asset_url, page_shell

ENNICHI_SCRIPTS: tuple[str, ...] = (
    "ennichi_data.js",
    "ennichi_murmur.js",
    "ennichi_wish.js",
    "ennichi_core.js",
    "ennichi_sim.js",
    "ennichi_crowd.js",
    "ennichi_3d.js",
    "ennichi.js",
)
ENNICHI_LAB_SCRIPTS: tuple[str, ...] = ("ennichi_lab.js",)


def build_ennichi_html() -> str:
    three_src = asset_url("../static/", "vendor/three.min.js")
    vendor_src = asset_url("../static/", "vendor/ennichi_vrm.js")
    body = f"""    <div class="en-wrap">
      <div id="en-game" data-three-src="{three_src}" data-vendor-src="{vendor_src}"
           data-model="../static/models/ennichi/sayo_blender.vrm"
           data-model-crowd="../static/models/ennichi/sayo.vrm"
           data-jikan="../static/images/jikan/"></div>
    </div>
"""
    return page_shell(
        title="緣日樂園",
        body=body,
        static_prefix="../static/",
        home_href="../index.html",
        extra_scripts=ENNICHI_SCRIPTS,
        extra_styles=("css/ennichi.css",),
        extra_i18n=("i18n/ennichi.js",),
    )


def build_ennichi_lab_html() -> str:
    three_src = asset_url("../../static/", "vendor/three.min.js")
    vendor_src = asset_url("../../static/", "vendor/ennichi_vrm.js")
    body = f"""    <div class="en-wrap">
      <div id="en-app" data-three-src="{three_src}" data-vendor-src="{vendor_src}"
           data-model="../../static/models/ennichi/sayo.vrm"
           data-model-blender="../../static/models/ennichi/sayo_blender.vrm"
           data-jikan="../../static/images/jikan/"></div>
    </div>
"""
    return page_shell(
        title="緣日樂園 樣本",
        body=body,
        static_prefix="../../static/",
        home_href="../../index.html",
        extra_scripts=ENNICHI_LAB_SCRIPTS,
        extra_styles=("css/ennichi.css",),
        extra_i18n=("i18n/ennichi.js",),
    )
