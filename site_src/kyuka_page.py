"""九華（kyuka）的頁面。

冒險者公會招募角色能力系統的試作（規則依據 docs/kyuka_design.md）：
N／R／SR／SSR／UR 招募、九華 9V（1～99 隨機）以櫻瓣花紋呈現、依親密度 33／66 綻放未解鎖的三華、
等級 1～50 的微幅成長、九九八十一型、新玩法用的標籤。最終移植到 RMD，這裡先在瀏覽器端試作。
static/kyuka_data.js（角色、型名、稀有度、標籤）→ kyuka_core.js（規則）→ kyuka_crest.js（花紋 SVG）→ kyuka.js（畫面與本機存檔）。
頭像沿用 static/images/jikan/ 的 g_ 系列。2026-11-16 依使用者需求新增；首頁 test 分頁只顯示、不能點，要自己輸入 /kyuka 進入。
"""

from __future__ import annotations

from site_src.layout import page_shell

KYUKA_SCRIPTS: tuple[str, ...] = ("kyuka_data.js", "kyuka_core.js", "kyuka_crest.js", "kyuka.js")


def build_kyuka_html() -> str:
    body = """    <div id="ky-app" data-img="../static/images/jikan/">
      <noscript>這個頁面需要 JavaScript。</noscript>
    </div>
"""
    return page_shell(
        title="九華",
        body=body,
        static_prefix="../static/",
        home_href="../index.html",
        extra_scripts=KYUKA_SCRIPTS,
        extra_styles=("css/kyuka.css",),
        extra_i18n=("i18n/kyuka.js",),
    )
