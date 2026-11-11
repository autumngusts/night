"""無人島的漂流者（isle）的頁面。

生存＋建造：郵輪觸礁，你和 8 位成年女性被沖上無人島。每天分配工作（採集、汲水、伐木、採石、探索、建造、醫療、休息），
管理食物、水、天氣與士氣，建造營火、避難所、集雨器、漁網、菜園、小屋、訊號火、木筏，探索 5 個區域。
夜晚在營火、沙灘、瀑布推進她們的故事，交往後有夜晚劇情（18 禁確認沿用盛夏合宿）。結局：獲救、出海、回家、留在島上。
遊戲邏輯全部在瀏覽器端：static/isle_data.js（系統與漂流者）→ isle_night.js（夜晚劇情）→ isle.js（規則與畫面）。
頭像沿用 static/images/jikan/ 的 g_ 成年女性圖。2026-11-11 依使用者需求新增。
"""

from __future__ import annotations

from site_src.layout import page_shell

ISLE_SCRIPTS: tuple[str, ...] = ("isle_data.js", "isle_night.js", "isle.js")


def build_isle_html() -> str:
    body = """    <div class="il-wrap">
      <div id="il-app" data-img="../static/images/jikan/">
        <noscript>這個遊戲需要 JavaScript。</noscript>
      </div>
    </div>
"""
    return page_shell(
        title="無人島的漂流者",
        body=body,
        static_prefix="../static/",
        home_href="../index.html",
        extra_scripts=ISLE_SCRIPTS,
        extra_styles=("css/isle.css",),
        extra_i18n=("i18n/isle.js",),
    )
