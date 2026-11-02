"""令和之野望（reiwa）的頁面。

東北地方的戰國風策略遊戲：單人選一個勢力對抗 7 個 AI 勢力，內政、外交、伐掠，逐步擴張版圖。
遊戲邏輯全部在瀏覽器端：static/reiwa_data.js（地圖／勢力／武將／兵種資料）→
static/reiwa_core.js（state、回合制行動、伐掠戰鬥結算、簡易 AI、存讀檔）→
static/reiwa_art.js（東北地形圖、城池 3D 模型、2D 合戰場景）→ static/reiwa_battle3d.js（Three.js 3D 合戰，
three.js 與其他遊戲共用 static/vendor/three.min.js，動態載入）→ static/reiwa.js（畫面與互動）。規則見 docs/reiwa_game_design.md。狀態存在 localStorage["pritest-reiwa-save"]。
"""

from __future__ import annotations

from site_src.layout import asset_url, page_shell

REIWA_SCRIPTS: tuple[str, ...] = (
    "reiwa_data.js",
    "reiwa_core.js",
    "reiwa_art.js",
    "reiwa_battle3d.js",
    "reiwa.js",
)


def build_reiwa_html() -> str:
    # three.js（與 starV／賽狗共用的 vendor/three.min.js r149）在第一次開戰時才由 reiwa_battle3d.js 載入
    three_src = asset_url("../static/", "vendor/three.min.js")
    body = f"""    <div class="rw-wrap">
      <h1 data-i18n="rw_title"></h1>
      <div id="rw-app" data-three-src="{three_src}"></div>
    </div>
"""
    return page_shell(
        title="令和之野望",
        body=body,
        static_prefix="../static/",
        home_href="../index.html",
        extra_scripts=REIWA_SCRIPTS,
        extra_styles=("css/reiwa.css",),
        extra_i18n=("i18n/reiwa.js",),
    )
