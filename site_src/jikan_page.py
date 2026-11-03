"""時間管理大師（jikan）的頁面。

28 天的戀愛記憶遊戲：同時和好幾個女孩約會，記住每個人說過的事（姓氏、生日、喜好、謊言……），
約會時被考到記錯就扣好感、跟別人搞混扣更多。外出邂逅時在街道圖上走動（車站最容易遇見新面孔）。
遊戲邏輯全部在瀏覽器端：static/jikan_data.js（個性台詞、情報、地點資料）→ static/jikan_map.js（街道圖）
→ static/jikan.js（流程與畫面）。頭像在 static/images/jikan/。規則見 docs/jikan_game_design.md。
狀態存在 localStorage["pritest-jikan-save"]。
"""

from __future__ import annotations

from site_src.layout import page_shell

JIKAN_SCRIPTS: tuple[str, ...] = (
    "jikan_data.js",
    "jikan_map.js",
    "jikan.js",
)


def build_jikan_html() -> str:
    body = """    <div class="jk-wrap">
      <div id="jk-app" class="jk-root" data-img="../static/images/jikan/">
        <noscript>這個遊戲需要 JavaScript。</noscript>
      </div>
    </div>
"""
    return page_shell(
        title="時間管理大師",
        body=body,
        static_prefix="../static/",
        home_href="../index.html",
        extra_scripts=JIKAN_SCRIPTS,
        extra_styles=("css/jikan.css",),
        extra_i18n=("i18n/jikan.js",),
    )
