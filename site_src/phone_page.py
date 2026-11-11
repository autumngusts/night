"""手機裡的她們（phone）的頁面。

訊息模擬：整個遊戲在一支手機的畫面裡（聊天、限動、交友 App、行事曆）。21 天 × 4 個時段，每個時段只能回 3 則訊息。
回覆的語氣（甜／幽默／認真／曖昧）、貼圖、秒回或已讀不回、記不記得她說過的事（記憶題）決定好感；
好感到了會約會、告白、交往，深夜可以去她家（18 禁確認沿用盛夏合宿）。8 位女主角＋交友 App 配對的一般角色。
遊戲邏輯全部在瀏覽器端：static/phone_data.js（訊息池與女主角）→ phone_night.js／phone_night2.js／phone_night3.js（夜晚劇情：每位女主角 4 段專屬＋共用 10 段、深夜訊息）→ phone.js（規則與畫面）。
頭像沿用 static/images/jikan/ 的 g_ 成年女性圖。2026-11-11 依使用者需求新增。
"""

from __future__ import annotations

from site_src.layout import page_shell

PHONE_SCRIPTS: tuple[str, ...] = ("phone_data.js", "phone_night.js", "phone_night2.js", "phone_night3.js", "phone.js")


def build_phone_html() -> str:
    body = """    <div class="ph-wrap">
      <div id="ph-app" data-img="../static/images/jikan/">
        <noscript>這個遊戲需要 JavaScript。</noscript>
      </div>
    </div>
"""
    return page_shell(
        title="手機裡的她們",
        body=body,
        static_prefix="../static/",
        home_href="../index.html",
        extra_scripts=PHONE_SCRIPTS,
        extra_styles=("css/phone.css",),
        extra_i18n=("i18n/phone.js",),
    )
