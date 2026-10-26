"""武俠合成（gousei）のページを組み立てる。

ゲームロジックはすべてブラウザ側：static/gousei_core.js（規則引擎）→ static/gousei.js（UI）。
主題資料（static/gousei_data_<theme>.js）は大きいので script 清單に入れず、
選んだ主題だけ gousei.js が動的に読み込む。URL は asset_url のキャッシュ雜湊付きで #gs-app の data 屬性に埋め込む。
"""

from __future__ import annotations

from site_src.layout import asset_url, page_shell

GOUSEI_SCRIPTS: tuple[str, ...] = (
    # 連線同步用：Firebase 設定、雲端同步（SDK 只在建立／加入房間時才載入）
    "firebase_config.js",
    "game_storage.js",
    "qrcode.js",
    "gousei_core.js",
    "gousei_art.js",
    "gousei.js",
)

GOUSEI_THEMES: tuple[str, ...] = ("wuxia", "wafu")

# 語音模式的拼音表（tools/gousei_data/build_pinyin.py 產生）也是開啟語音時才動態載入
GOUSEI_PINYIN_FILE = "gousei_pinyin.js"

GOUSEI_DATA_FILES: tuple[str, ...] = tuple(f"gousei_data_{t}.js" for t in GOUSEI_THEMES) + (GOUSEI_PINYIN_FILE,)

STATIC_PREFIX = "../static/"


def build_gousei_html() -> str:
    attrs = " ".join(
        f'data-src-{t}="{asset_url(STATIC_PREFIX, f"gousei_data_{t}.js")}"' for t in GOUSEI_THEMES
    )
    attrs += f' data-src-pinyin="{asset_url(STATIC_PREFIX, GOUSEI_PINYIN_FILE)}"'
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
