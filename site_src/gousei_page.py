"""武俠合成（gousei）のページを組み立てる。

ゲームロジックはすべてブラウザ側：static/gousei_core.js（規則引擎）→ static/gousei.js（UI）。
主題資料（static/gousei_data_<theme>.js）は大きいので script 清單に入れず、
選んだ主題だけ gousei.js が動的に読み込む。URL は asset_url のキャッシュ雜湊付きで #gs-app の data 屬性に埋め込む。
"""

from __future__ import annotations

from site_src.layout import asset_url, page_shell

GOUSEI_SCRIPTS: tuple[str, ...] = (
    "qrcode.js",
    "gousei_core.js",
    "gousei.js",
)

GOUSEI_THEMES: tuple[str, ...] = ("wuxia", "wafu")

GOUSEI_DATA_FILES: tuple[str, ...] = tuple(f"gousei_data_{t}.js" for t in GOUSEI_THEMES)

STATIC_PREFIX = "../static/"


def build_gousei_html() -> str:
    attrs = " ".join(
        f'data-src-{t}="{asset_url(STATIC_PREFIX, f"gousei_data_{t}.js")}"' for t in GOUSEI_THEMES
    )
    body = f"""    <div class="gs-wrap">
      <h1 data-i18n="gs_title"></h1>
      <div id="gs-app" {attrs}></div>
    </div>
"""
    return page_shell(
        title="Gousei",
        body=body,
        static_prefix=STATIC_PREFIX,
        home_href="../index.html",
        extra_scripts=GOUSEI_SCRIPTS,
    )
