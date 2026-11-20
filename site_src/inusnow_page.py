"""イヌスノー（狗雪，inusnow）的頁面。

狗選手用單板在日本真實雪場的真實雪道上競速。雪道來自 OpenStreetMap、地形來自國土地理院標高圖，
由 tools/inusnow_data/fetch.py 轉成 static/inusnow/data/<雪場>.json。
規則依據 docs/inusnow_design.md；第 1 階段計畫 docs/superpowers/plans/2026-11-20-inusnow-phase1.md。
載入順序：inusnow_data.js（數值表）→ inusnow_terrain.js（格網地形、雪道幾何）→ inusnow_phys.js（單板物理）
→ inusnow_core.js（旗門、比賽、紀錄、重播）→ inusnow_input.js（拖曳、陀螺儀、鍵盤）
→ inusnow_3d.js（three.js 畫面，第一次用到才載入 vendor/three.min.js）→ inusnow.js（畫面流程與存檔）。
2026-11-20 依使用者需求新增；放在首頁「付款」分頁（page_shell(paid=True)）。
"""

from __future__ import annotations

from site_src.layout import asset_url, page_shell

INUSNOW_SCRIPTS: tuple[str, ...] = (
    "inusnow_data.js",
    "inusnow_terrain.js",
    "inusnow_phys.js",
    "inusnow_core.js",
    "inusnow_input.js",
    "inusnow_3d.js",
    "inusnow.js",
)


def build_inusnow_html() -> str:
    three_src = asset_url("../static/", "vendor/three.min.js")
    body = f"""    <div id="inu-app" data-three-src="{three_src}" data-data-dir="../static/inusnow/data/">
      <noscript>這個遊戲需要 JavaScript。</noscript>
    </div>
"""
    return page_shell(
        paid=True,
        title="イヌスノー",
        body=body,
        static_prefix="../static/",
        home_href="../index.html",
        extra_scripts=INUSNOW_SCRIPTS,
        extra_styles=("css/inusnow.css",),
        extra_i18n=("i18n/inusnow.js",),
    )
