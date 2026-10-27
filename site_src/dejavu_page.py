"""DÉJÀ VU 山道下坡（dejavu）的頁面。

參加玩家輪流決定山路結構（或選固定山路、隨機生成，都可以微調），選季節，各自選車調校，
接著由物理模擬自動跑完整場比賽，看誰先抵達終點、誰站上前三名。
遊戲邏輯全部在瀏覽器端：static/dejavu_data.js（資料）→ static/dejavu_cars.js／dejavu_bikes.js／dejavu_courses.js（擴充車款、機車與山路）→ static/dejavu_core.js（賽道＋物理）→ static/dejavu_modes.js（錦標賽／傳說／下注／紀錄）→ static/dejavu_net.js（多裝置連線：firebase_config.js／game_storage.js 的 rtState，開房間時才載入 Firebase）→ static/dejavu_cockpit.js（3D 視角）→ static/dejavu_tv.js（轉播鏡頭／導播／重播字幕）→ static/dejavu.js（畫面）。
"""

from __future__ import annotations

from site_src.layout import page_shell

DEJAVU_SCRIPTS: tuple[str, ...] = (
    "dejavu_data.js",
    "dejavu_cars.js",
    "dejavu_bikes.js",
    "dejavu_courses.js",
    "dejavu_core.js",
    "dejavu_modes.js",
    "firebase_config.js",
    "game_storage.js",
    "dejavu_net.js",
    "dejavu_cockpit.js",
    "dejavu_tv.js",
    "dejavu.js",
)


def build_dejavu_html() -> str:
    body = """    <div class="dv-wrap">
      <h1 data-i18n="dv_title"></h1>
      <div id="dv-app"></div>
    </div>
"""
    return page_shell(
        title="DÉJÀ VU",
        body=body,
        static_prefix="../static/",
        home_href="../index.html",
        extra_scripts=DEJAVU_SCRIPTS,
        extra_styles=("css/dejavu.css",),
        extra_i18n=("i18n/dejavu.js",),
    )
