"""秘密的同居生活（nest）的頁面。

你繼承了外婆的老公寓「椿莊」（5 層 × 4 間＝20 間），90 天內還清貸款，否則被建商收購。
核心玩法是房間配置拼圖：房客的聲音、晚歸、腳步、料理、貓、菸味，和淺眠、白天睡、過敏、怕味道等特質互相影響，
左右鄰居、樓上樓下、樓層與角間決定滿意度，滿意度決定房租，太低就會搬走。
20 位房客女主角各有 3 段個人故事、告白、2 段專屬夜晚劇情；另有共用夜晚劇情與公共空間的意外事件（18 禁確認沿用盛夏合宿）。
遊戲邏輯全部在瀏覽器端：static/nest_data.js（系統）→ nest_heroines.js／nest_heroines2.js（20 位女主角）
→ nest_night.js／nest_night2.js（夜晚劇情）→ nest_cast.js（頭像池、一般房客）→ nest.js（規則與畫面）。
頭像沿用 static/images/jikan/ 的 g_ 成年女性圖（n_ 系列是學生制服，不使用）。2026-11-11 依使用者需求新增。
"""

from __future__ import annotations

from site_src.layout import page_shell

NEST_SCRIPTS: tuple[str, ...] = (
    "nest_data.js",
    "nest_heroines.js",
    "nest_heroines2.js",
    "nest_night.js",
    "nest_night2.js",
    "nest_cast.js",
    "nest.js",
)


def build_nest_html() -> str:
    body = """    <div class="ns-wrap">
      <div id="ns-app" data-img="../static/images/jikan/">
        <noscript>這個遊戲需要 JavaScript。</noscript>
      </div>
    </div>
"""
    return page_shell(
        title="秘密的同居生活",
        body=body,
        static_prefix="../static/",
        home_href="../index.html",
        extra_scripts=NEST_SCRIPTS,
        extra_styles=("css/nest.css",),
        extra_i18n=("i18n/nest.js",),
    )
