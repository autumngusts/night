"""繩文帝國（jomon）的頁面。

參照世紀帝國 2／4 的即時文明養成：從繩文時代的小村落開始生產村民、分配採集、蓋房子，
人口達到門檻（300 → 750 → 1800 → 4000 → 1 萬 → 2.5 萬 → 5 萬 → 10 萬）就能升時代，一路到江戶時代。
飛鳥時代選擇文明；派兵自動遠征 NPC，殘兵帶著戰利品與俘虜回來；彌生時代起會被襲擊。
遊戲邏輯全部在瀏覽器端：static/jomon_data.js（時代、建築、兵種、研究、文明、討伐目標）→
static/jomon_world_data.js（勢力、事件、任務、資源儲量）→ static/jomon_core.js（state、即時模擬、即時戰鬥、偵察、存讀檔）→
static/jomon_world.js（勢力外交、事件、任務）→ static/jomon_scene3d.js（Three.js 程序建模的 3D 村落，
three.js 與其他遊戲共用 static/vendor/three.min.js，動態載入）→ static/jomon_battle3d.js（3D 戰場）→ static/jomon.js（畫面與互動）。
規則見 docs/jomon_game_design.md。狀態存在 localStorage["pritest-jomon-save"]。
"""

from __future__ import annotations

from site_src.layout import asset_url, page_shell

JOMON_SCRIPTS: tuple[str, ...] = (
    "jomon_data.js",
    "jomon_world_data.js",
    "jomon_core.js",
    "jomon_world.js",
    "jomon_scene3d.js",
    "jomon_battle3d.js",
    "jomon.js",
)


def build_jomon_html() -> str:
    three_src = asset_url("../static/", "vendor/three.min.js")
    body = f"""    <div class="jm-wrap">
      <div id="jm-app" class="jm-root" data-three-src="{three_src}">
        <noscript>這個遊戲需要 JavaScript。</noscript>
      </div>
    </div>
"""
    return page_shell(
        title="繩文帝國",
        body=body,
        static_prefix="../static/",
        home_href="../index.html",
        extra_scripts=JOMON_SCRIPTS,
        extra_styles=("css/jomon.css",),
        extra_i18n=("i18n/jomon.js",),
    )
