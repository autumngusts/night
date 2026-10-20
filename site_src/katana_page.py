"""神前鍛刀對決（katana）のページを組み立てる。

ゲームロジックはすべてブラウザ側：static/katana_data.js（資料）→ static/katana_core.js（冶金・規則引擎）→ static/katana_games.js（工序小遊戲）→ static/katana_arena.js（對刀場模擬）→ static/katana_net.js（連線對刀：firebase_config.js／game_storage.js の rtState を使う）→ static/katana.js（UI）。
Firebase SDK は連線對刀の房間を開いたときだけ game_storage.js が遅延ロードする（ふだんは通信なし）。
"""

from __future__ import annotations

from site_src.layout import page_shell

KATANA_SCRIPTS: tuple[str, ...] = (
    "katana_data.js",
    "katana_core.js",
    "katana_games.js",
    "katana_arena.js",
    "firebase_config.js",
    "game_storage.js",
    "katana_net.js",
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
