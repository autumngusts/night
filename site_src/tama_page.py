"""百鬼轉珠（tama）的頁面。

單人轉珠 RPG：在 6×5 盤面上拖曳珠子（5 秒時間制限），直／橫 3 顆以上同色消除形成連擊，
5 位祓い手（女生圖鑑頭像）依消除的屬性珠攻擊妖怪。和風妖怪世界觀，3 章 12 關、25 位角色。
規則依據 docs/tama_game_design.md。遊戲邏輯全部在瀏覽器端：
static/tama_data.js（角色、妖怪、關卡）→ tama_core.js（規則）→ tama_art.js（妖怪 SVG）
→ tama_board.js（Canvas 盤面與轉珠操作）→ tama.js（畫面與本機存檔）。
頭像沿用 static/images/jikan/ 的 g_ 系列。2026-11-16 依使用者需求新增。
"""

from __future__ import annotations

from site_src.layout import page_shell

TAMA_SCRIPTS: tuple[str, ...] = ("tama_data.js", "tama_core.js", "tama_art.js", "tama_board.js", "tama.js")


def build_tama_html() -> str:
    body = """    <div id="tm-app" data-img="../static/images/jikan/">
      <noscript>這個遊戲需要 JavaScript。</noscript>
    </div>
"""
    return page_shell(
        title="百鬼轉珠",
        body=body,
        static_prefix="../static/",
        home_href="../index.html",
        extra_scripts=TAMA_SCRIPTS,
        extra_styles=("css/tama.css",),
        extra_i18n=("i18n/tama.js",),
    )
