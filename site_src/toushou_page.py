"""東正小遊戲（toushou）のページを組み立てる。

ゲームロジックはすべてブラウザ側：
static/toushou_data.js（共用資料）→ static/toushou_data_*.js（各類別）→
static/toushou_core.js（規則引擎）→ static/toushou.js（UI）。
新しい類別ファイルを追加したら TOUSHOU_SCRIPTS に追記する（generate.py もこれを使う）。
"""

from __future__ import annotations

from site_src.layout import page_shell

TOUSHOU_SCRIPTS: tuple[str, ...] = (
    # 連線模式（多裝置）用：Firebase 設定、雲端同步、QR Code（SDK 只在建立／加入房間時才載入）
    "firebase_config.js",
    "game_storage.js",
    "qrcode.js",
    "toushou_data.js",
    "toushou_data_sengoku.js",
    "toushou_data_celebrity.js",
    "toushou_data_company.js",
    "toushou_data_region.js",
    "toushou_data_food.js",
    "toushou_data_anime.js",
    "toushou_data_culture.js",
    "toushou_data_taiwan.js",
    # 擴充標的（tools/toushou_data/ext.py 產生；需在各類別檔之後）
    "toushou_data_ext.js",
    # 滿分男模式的題庫（只登錄到 MANFEN_*，不影響經典／內線）
    "toushou_data_manfen.js",
    "toushou_core.js",
    "toushou_core_manfen.js",
    "toushou.js",
)

BODY = """    <div class="ts-wrap">
      <h1 data-i18n="ts_title"></h1>
      <div id="ts-app"></div>
    </div>
"""


def build_toushou_html() -> str:
    return page_shell(
        title="Toushou",
        body=BODY,
        static_prefix="../static/",
        home_href="../index.html",
        extra_scripts=TOUSHOU_SCRIPTS,
        extra_styles=("css/toushou.css",),
        extra_i18n=("i18n/toushou.js",),
    )
