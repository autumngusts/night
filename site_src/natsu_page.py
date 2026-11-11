"""盛夏合宿（natsu）的頁面。

30 天的海邊集訓營：你是企業女排「海燕」的代理教練。白天排晨練菜單、午後個別指導或練習賽、
夜晚在海邊／宿舍等地自由行動觸發個人線，交往後有成年戀人的夜晚劇情（18 禁確認沿用 champ）。
第 30 天全國企業盃準決賽與決賽，依戰術剋制、能力、默契與調子模擬。
遊戲邏輯全部在瀏覽器端：static/natsu_data.js（隊員、菜單、對手、個人線）→ natsu_night.js（夜晚劇情）→ natsu_cast.js（頭像池、邂逅角色的職業與個性模板）→ natsu.js（規則與畫面）。
頭像沿用 static/images/jikan/ 的 g_ 成年女性圖（n_ 系列是學生制服，不使用）。2026-11-11 依使用者需求新增。
"""

from __future__ import annotations

from site_src.layout import page_shell

NATSU_SCRIPTS: tuple[str, ...] = (
    "natsu_data.js",
    "natsu_night.js",
    "natsu_night2.js",
    "natsu_night3.js",
    "natsu_night4.js",
    "natsu_cast.js",
    "natsu.js",
)


def build_natsu_html() -> str:
    body = """    <div class="nt-wrap">
      <div id="nt-app" data-img="../static/images/jikan/">
        <noscript>這個遊戲需要 JavaScript。</noscript>
      </div>
    </div>
"""
    return page_shell(
        title="盛夏合宿",
        body=body,
        static_prefix="../static/",
        home_href="../index.html",
        extra_scripts=NATSU_SCRIPTS,
        extra_styles=("css/natsu.css",),
        extra_i18n=("i18n/natsu.js",),
    )
