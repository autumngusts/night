"""深夜居酒屋（izakaya）的頁面。

經營＋料理＋八點檔群像劇：白天採買、晚上接客（回合制對話＋週末即時尖峰），推理客人喜好、經營口碑星級，
常客與店員交錯的事件線、約會、結婚。單機或 2〜4 人連線分工。
設計：docs/superpowers/specs/2026-11-09-izakaya-design.md。2026-11-09 依使用者需求新增。
"""

from __future__ import annotations

from site_src.layout import asset_url, page_shell

IZAKAYA_SCRIPTS: tuple[str, ...] = (
    "izakaya_data.js",
    "izakaya_cast.js",
    "izakaya_story.js",
    "izakaya_story_main.js",
    "izakaya_story_arcs.js",
    "izakaya_story_staff.js",
    "izakaya_story_main2.js",
    "izakaya_story_arcs2.js",
    "izakaya_story_staff2.js",
    "izakaya_story_heart.js",
    "izakaya_story_truth.js",
    "izakaya_rush.js",
    "izakaya_core.js",
    "firebase_config.js",
    "game_storage.js",
    "qrcode.js",
    "izakaya_net.js",
    "izakaya_3d.js",
    "izakaya.js",
)


def build_izakaya_html() -> str:
    three_src = asset_url("../static/", "vendor/three.min.js")
    body = f"""    <div class="iz-wrap">
      <div id="iz-app" data-three-src="{three_src}" data-img="../static/images/jikan/"></div>
    </div>
"""
    return page_shell(
        title="深夜居酒屋",
        body=body,
        static_prefix="../static/",
        home_href="../index.html",
        extra_scripts=IZAKAYA_SCRIPTS,
        extra_styles=("css/izakaya.css",),
        extra_i18n=("i18n/izakaya.js",),
    )
