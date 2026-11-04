"""末日據點（zombie）的頁面。

殭屍生存：帶一小群倖存者撐過 10 或 30 天。白天分配工作、在城市地圖外出搜刮（事件卡），夜晚 3D 即時防守或自動結算。
遊戲邏輯全部在瀏覽器端：static/zombie_data.js（資料）→ zombie_night.js（夜晚模擬）→ zombie_core.js（規則與狀態）
→ zombie_net.js（合作連線：firebase_config.js／game_storage.js 的 rtState）→ zombie_3d.js（three.js，第一次入夜才載入）→ zombie.js（畫面）。
2026-11-04 依使用者需求新增。
"""

from __future__ import annotations

from site_src.layout import asset_url, page_shell

ZOMBIE_SCRIPTS: tuple[str, ...] = (
    "zombie_data.js",
    "zombie_night.js",
    "zombie_core.js",
    "firebase_config.js",
    "game_storage.js",
    "qrcode.js",
    "zombie_net.js",
    "zombie_3d.js",
    "zombie.js",
)


def build_zombie_html() -> str:
    three_src = asset_url("../static/", "vendor/three.min.js")
    body = f"""    <div class="zm-wrap">
      <div id="zm-app" data-three-src="{three_src}"></div>
    </div>
"""
    return page_shell(
        title="末日據點",
        body=body,
        static_prefix="../static/",
        home_href="../index.html",
        extra_scripts=ZOMBIE_SCRIPTS,
        extra_styles=("css/zombie.css",),
        extra_i18n=("i18n/zombie.js",),
    )
