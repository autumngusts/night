"""神前鍛刀對決（katana）のページを組み立てる。

ゲームロジックはすべてブラウザ側：static/katana_data.js（資料）→ static/katana_core.js（冶金・規則引擎）→ static/katana.js（UI）。
"""

from __future__ import annotations

from site_src.layout import page_shell

KATANA_SCRIPTS: tuple[str, ...] = (
    "katana_data.js",
    "katana_core.js",
    "katana.js",
)


def build_katana_html() -> str:
    body = """    <div class="kt-wrap">
      <h1 data-i18n="kt_title"></h1>
      <div id="kt-app"></div>
    </div>
"""
    return page_shell(
        title="Katana Master",
        body=body,
        static_prefix="../static/",
        home_href="../index.html",
        extra_scripts=KATANA_SCRIPTS,
    )
