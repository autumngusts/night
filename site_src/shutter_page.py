"""快門之後（shutter）的頁面。

寫真集企劃《十二月光》：出版社委託你在 60 天內拍完 12 位女性的寫真集，最後選誰當封面＝結局。
白天接案（雜誌、Cosplay、私人寫真、商業廣告、婚紗、旅行外拍）或拍寫真集章節；夜晚在酒吧、暗房等地點推進個人故事，
交往後有成年戀人的夜晚劇情（18 禁確認沿用盛夏合宿）。
拍攝小遊戲：取景（三分法、構圖大小、視線）、燈光（方向、柔／硬光、強度、補光）、抓 0.5 秒的最佳瞬間、指導對話、底片張數限制。
遊戲邏輯全部在瀏覽器端：static/shutter_data.js（女主角、案子、場景、器材、個人故事）→ shutter_night.js（夜晚劇情）
→ shutter_cast.js（頭像池、客人個性模板）→ shutter_shoot.js（拍攝小遊戲）→ shutter.js（規則與畫面）。
頭像沿用 static/images/jikan/ 的 g_ 成年女性圖（n_ 系列是學生制服，不使用）；拍攝場景用 tools/shutter_cutout.py 產生的去背版（static/images/shutter/）。2026-11-11 依使用者需求新增。
"""

from __future__ import annotations

from site_src.layout import page_shell

SHUTTER_SCRIPTS: tuple[str, ...] = (
    "shutter_data.js",
    "shutter_night.js",
    "shutter_cast.js",
    "shutter_shoot.js",
    "shutter.js",
)


def build_shutter_html() -> str:
    body = """    <div class="sh-wrap">
      <div id="sh-app" data-img="../static/images/jikan/" data-cut="../static/images/shutter/">
        <noscript>這個遊戲需要 JavaScript。</noscript>
      </div>
    </div>
"""
    return page_shell(
        title="快門之後",
        body=body,
        static_prefix="../static/",
        home_href="../index.html",
        extra_scripts=SHUTTER_SCRIPTS,
        extra_styles=("css/shutter.css",),
        extra_i18n=("i18n/shutter.js",),
    )
