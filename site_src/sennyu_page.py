"""潛入晶片（sennyu）的頁面。

文字冒險（VN）＋輕度資源管理：扮演女間諜以秘書身分潛入晶片大廠 VN，取得周圍的人信任，
從行政部爬到執行長室，最後從地下金庫取出被封存的「零號模型」。多重結局，一輪約 1 小時。
規則依據：docs/sennyu_game_design.md。遊戲邏輯全部在瀏覽器端：
static/sennyu_data.js（出身、人物、情報、章節、請求、地圖）→ sennyu_story_*.js（劇情場景）
→ sennyu_core.js（純邏輯規則引擎，node 也能跑）→ sennyu.js（畫面、本機存檔）。
頭像沿用 static/images/jikan/ 的圖庫。
"""

from __future__ import annotations

from site_src.layout import page_shell

SENNYU_SCRIPTS: tuple[str, ...] = (
    "sennyu_data.js",
    "sennyu_story_1.js",
    "sennyu_story_2.js",
    "sennyu_story_bond.js",
    "sennyu_story_event.js",
    "sennyu_core.js",
    "sennyu.js",
)


def build_sennyu_html() -> str:
    body = """    <div class="sn-wrap">
      <div id="sn-app" data-img="../static/images/jikan/">
        <noscript>這個遊戲需要 JavaScript。</noscript>
      </div>
    </div>
"""
    return page_shell(
        title="潛入晶片",
        body=body,
        static_prefix="../static/",
        home_href="../index.html",
        extra_scripts=SENNYU_SCRIPTS,
        extra_styles=("css/sennyu.css",),
        extra_i18n=("i18n/sennyu.js",),
    )
