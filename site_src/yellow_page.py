"""黃牌 Yellow Card（yellow）のページを組み立てる。

Hellcard／Hellcard 2 を参考にした協力型デッキ構築カードゲーム。四隅に各職業が陣取り、近距離／遠距離の
二区画に並ぶ敵の群れを協力して倒していく。
ゲームロジックはすべてブラウザ側：static/yellow_data.js（資料）→ static/yellow_core.js（規則引擎）→
static/yellow_net.js（連線房間：firebase_config.js／game_storage.js の rtState を使う）→ static/yellow.js（UI）。
Firebase SDK は連線房間を開いたときだけ game_storage.js が遅延ロードする（本機遊玩では通信なし）。
"""

from __future__ import annotations

from site_src.layout import page_shell

YELLOW_SCRIPTS: tuple[str, ...] = (
    "yellow_data.js",
    "yellow_core.js",
    "yellow_ai.js",
    "yellow_audio.js",
    "firebase_config.js",
    "game_storage.js",
    "qrcode.js",
    "yellow_net.js",
    "yellow.js",
)


def build_yellow_html() -> str:
    body = """    <div class="yc-wrap">
      <h1 data-i18n="yc_title"></h1>
      <div id="yc-app"></div>
    </div>
"""
    return page_shell(
        title="Yellow Card",
        body=body,
        static_prefix="../static/",
        home_href="../index.html",
        extra_scripts=YELLOW_SCRIPTS,
    )
