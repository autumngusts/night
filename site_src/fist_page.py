"""鐵拳教育（fist）のページを組み立てる。

新任教師として校内マップ（7×5）を駆け回り、いじめを拳と言葉で止め、証拠を集めて権力者の壁を打ち破る
ゲーム。主要モードは搜打撤（docs/fist_raid_design.md：fist_raid_data.js → fist_raid_core.js → fist_raid.js）、
旧来のターン制は「經典回合制」として残す（docs/fist_game_design.md）。
ゲームロジックはすべてブラウザ側：static/fist_data.js（資料）→ static/fist_core.js（規則引擎）→ static/fist_fight.js（格鬥畫面・音效・切入）→
static/fist_net.js（連線房間：firebase_config.js／game_storage.js の rtState を使う）→ static/fist.js（UI）。
Firebase SDK は連線房間を開いたときだけ game_storage.js が遅延ロードする（本機遊玩では通信なし）。
"""

from __future__ import annotations

from site_src.layout import page_shell

FIST_SCRIPTS: tuple[str, ...] = (
    "fist_data.js",
    "fist_core.js",
    "fist_fight.js",
    "fist_raid_data.js",
    "fist_raid_text.js",
    "fist_raid_art.js",
    "fist_raid_core.js",
    "firebase_config.js",
    "game_storage.js",
    "qrcode.js",
    "fist_net.js",
    "fist_raid.js",
    "fist.js",
)


def build_fist_html() -> str:
    body = """    <div class="fe-wrap">
      <h1 data-i18n="fe_title"></h1>
      <div id="fe-app"></div>
    </div>
"""
    return page_shell(
        title="Iron Fist Education",
        body=body,
        static_prefix="../static/",
        home_href="../index.html",
        extra_scripts=FIST_SCRIPTS,
        extra_styles=("css/fist.css",),
        extra_i18n=("i18n/fist.js",),
    )
