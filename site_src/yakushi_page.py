"""少女藥師的獨語（yakushi）的頁面。規則依據 docs/yakushi_game_design.md。

架空中華後宮的推理冒險：調查 → 鑑定 → 試藥／調藥 → 推理板 → 指認。
載入順序：yakushi_herbs.js（registry）→ yakushi_herbs_*.js（6 類藥材）→ yakushi_cast.js（人物）
→ yakushi_core.js（規則）→ yakushi_case_*.js（案件）→ yakushi.js（畫面、存檔）。
2026-11-24 依使用者需求新增；放在首頁「付款」分頁（page_shell(paid=True)）。
"""

from __future__ import annotations

from site_src.layout import page_shell

YAKUSHI_SCRIPTS: tuple[str, ...] = (
    "yakushi_herbs.js",
    "yakushi_herbs_poison.js",
    "yakushi_herbs_mineral.js",
    "yakushi_herbs_animal.js",
    "yakushi_herbs_tonic.js",
    "yakushi_herbs_clear.js",
    "yakushi_herbs_boudoir.js",
    "yakushi_cast.js",
    "yakushi_core.js",
    "yakushi_case_0.js",
    "yakushi_case_1.js",
    "yakushi_case_2.js",
    "yakushi_case_3.js",
    "yakushi.js",
)


def build_yakushi_html() -> str:
    body = """    <div id="ys-app">
      <noscript>這個遊戲需要 JavaScript。</noscript>
    </div>
"""
    return page_shell(
        paid=True,
        title="少女藥師的獨語",
        body=body,
        static_prefix="../static/",
        home_href="../index.html",
        extra_scripts=YAKUSHI_SCRIPTS,
        extra_styles=("css/yakushi.css",),
        extra_i18n=("i18n/yakushi.js",),
    )
