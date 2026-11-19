"""煉金術士（atelier）的頁面。規則依據 docs/atelier_design.md。

用相機採集真實世界的顏色，回到工房在色彩棋盤上調和道具（第 1 階段：瑠璃的工房）。
static/atelier_data.js（數值）→ atelier_colors.js（傳統色）→ atelier_hosts.js（工房主人）
→ atelier_core.js（規則）→ atelier_method_board.js（色彩棋盤）→ atelier_camera.js（取色）→ atelier.js（畫面、存檔）。
2026-11-19 依使用者需求新增；首頁 test 分頁只顯示、不能點，要自己輸入 /atelier 進入。
"""

from __future__ import annotations

from site_src.layout import page_shell

ATELIER_SCRIPTS: tuple[str, ...] = (
    "atelier_data.js",
    "atelier_colors.js",
    "atelier_hosts.js",
    "atelier_core.js",
    "atelier_method_board.js",
    "atelier_camera.js",
    "atelier.js",
)


def build_atelier_html() -> str:
    body = """    <div id="at-app" class="at-wrap">
      <noscript>這個頁面需要 JavaScript。</noscript>
    </div>
"""
    return page_shell(
        title="煉金術士",
        body=body,
        static_prefix="../static/",
        home_href="../index.html",
        extra_scripts=ATELIER_SCRIPTS,
        extra_styles=("css/atelier.css",),
        extra_i18n=("i18n/atelier.js",),
    )
