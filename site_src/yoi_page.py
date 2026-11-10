"""宵の怪談（yoi）的頁面。

合作推理＋資源管理：一行人在鬧鬼的建築裡度過一晚，蒐集線索推理怪異的真面目與 3 條禁忌，在結界間「名指し」封印它。
規則依據：docs/yoi_game_design.md。遊戲邏輯全部在瀏覽器端：
static/yoi_data.js（職業、舞台、怪異、禁忌、事件）→ yoi_core.js（純邏輯規則引擎，node 也能跑）
→ yoi_3d.js（three.js 剖面娃娃屋，第一次用到才載入 vendor/three.min.js）→ yoi.js（畫面、本機存檔）。
"""

from __future__ import annotations

from site_src.layout import asset_url, page_shell

YOI_SCRIPTS: tuple[str, ...] = (
    "yoi_data.js",
    "yoi_core.js",
    "yoi_3d.js",
    "yoi.js",
)


def build_yoi_html() -> str:
    three_src = asset_url("../static/", "vendor/three.min.js")
    body = f"""    <div class="yo-wrap">
      <div id="yo-app" data-three-src="{three_src}"></div>
    </div>
"""
    return page_shell(
        title="宵の怪談",
        body=body,
        static_prefix="../static/",
        home_href="../index.html",
        extra_scripts=YOI_SCRIPTS,
        extra_styles=("css/yoi.css",),
        extra_i18n=("i18n/yoi.js",),
    )
