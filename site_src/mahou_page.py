"""魔法變色龍（mahou）的頁面。

躲貓貓繪圖派對遊戲：一名玩家上傳照片（或選內建場景），其他玩家在照片上擺放小人物（20 種動作）、
用豐富的畫筆把它塗成跟背景一樣，躲藏階段結束後由鬼在照片上找出小人物。
房間可設定畫圖時間、尋找時間、失誤次數上限，以及一般／感染／同步三種模式。
遊戲邏輯全部在瀏覽器端：static/mahou_data.js（動作、場景、工具資料）→ mahou_core.js（規則與狀態機）
→ mahou_figure.js（小人物繪製、命中判定、上色引擎）→ mahou_scenes.js（內建場景）
→ mahou_net.js（連線：firebase_config.js／game_storage.js 的 rtState）→ mahou.js（畫面）。
2026-11-05 依使用者需求新增。
"""

from __future__ import annotations

from site_src.layout import page_shell

MAHOU_SCRIPTS: tuple[str, ...] = (
    "mahou_data.js",
    "mahou_core.js",
    "mahou_figure.js",
    "mahou_scenes.js",
    "firebase_config.js",
    "game_storage.js",
    "qrcode.js",
    "mahou_net.js",
    "mahou.js",
)


def build_mahou_html() -> str:
    body = """    <div class="mh-wrap">
      <div id="mh-app"></div>
    </div>
"""
    return page_shell(
        title="魔法變色龍",
        body=body,
        static_prefix="../static/",
        home_href="../index.html",
        extra_scripts=MAHOU_SCRIPTS,
        extra_styles=("css/mahou.css",),
        extra_i18n=("i18n/mahou.js",),
    )
