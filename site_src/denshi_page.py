"""電子守衛（denshi）的頁面。

電路板塔防：亂數產生地圖，每波拿到一塊隨機的多格骨牌地基（俄羅斯方塊＋特殊形狀），放上去擋出迷宮，再把砲塔蓋在地基上。
十大地圖各有特殊機制；原始砲塔 Lv3 可電子強化。單機或 2〜4 人合作連線。
遊戲邏輯全部在瀏覽器端：static/denshi_data.js（資料）→ denshi_core.js（規則與模擬）
→ denshi_net.js（合作連線：firebase_config.js／game_storage.js 的 rtState）→ denshi_3d.js（three.js，進入遊戲才載入）→ denshi.js（畫面）。
2026-11-05 依使用者需求新增。
"""

from __future__ import annotations

from site_src.layout import asset_url, page_shell

DENSHI_SCRIPTS: tuple[str, ...] = (
    "denshi_data.js",
    "denshi_core.js",
    "firebase_config.js",
    "game_storage.js",
    "qrcode.js",
    "denshi_net.js",
    "denshi_3d.js",
    "denshi.js",
)


def build_denshi_html() -> str:
    three_src = asset_url("../static/", "vendor/three.min.js")
    body = f"""    <div class="ds-wrap">
      <div id="ds-app" data-three-src="{three_src}"></div>
    </div>
"""
    return page_shell(
        title="電子守衛",
        body=body,
        static_prefix="../static/",
        home_href="../index.html",
        extra_scripts=DENSHI_SCRIPTS,
        extra_styles=("css/denshi.css",),
        extra_i18n=("i18n/denshi.js",),
    )
