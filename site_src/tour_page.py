"""星途巡演（tour）的頁面。

你是 5 人偶像團體 LUMINA 的經紀人，帶她們跑 20 個城市的巡演：白天排練／宣傳／休息／單獨相處，
晚上演出（4 軌節奏遊戲打 call，可自動演出），演出後在巴士、酒吧、頂樓觸發個人線；交往後有成年戀人的夜晚劇情，
但每次密會都會提高狗仔指數，到 100 就上週刊。最終站台北大巨蛋依總人氣決定結局（18 禁確認沿用 champ）。
遊戲邏輯全部在瀏覽器端：static/tour_data.js → tour_night.js → tour_cast.js（頭像池、邂逅角色）→ tour.js。
頭像沿用 static/images/jikan/ 的 g_ 成年女性圖。2026-11-11 依使用者需求新增。
"""

from __future__ import annotations

from site_src.layout import page_shell

TOUR_SCRIPTS: tuple[str, ...] = (
    "tour_data.js",
    "tour_night.js",
    "tour_night2.js",
    "tour_night3.js",
    "tour_cast.js",
    "tour.js",
)


def build_tour_html() -> str:
    body = """    <div class="tr-wrap">
      <div id="tr-app" data-img="../static/images/jikan/">
        <noscript>這個遊戲需要 JavaScript。</noscript>
      </div>
    </div>
"""
    return page_shell(
        title="星途巡演",
        body=body,
        static_prefix="../static/",
        home_href="../index.html",
        extra_scripts=TOUR_SCRIPTS,
        extra_styles=("css/tour.css",),
        extra_i18n=("i18n/tour.js",),
    )
