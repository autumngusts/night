"""我不會唱歌（utau）のページを組み立てる。

ゲームロジックはすべてブラウザ側：
static/utau_songs.js（進階模式の歌單）→ static/utau_core.js（規則引擎）→ static/utau.js（UI）。
"""

from __future__ import annotations

from site_src.layout import page_shell

UTAU_SCRIPTS: tuple[str, ...] = (
    "utau_songs.js",
    "utau_core.js",
    "utau.js",
)

BODY = """    <div class="ut-wrap">
      <h1 data-i18n="ut_title"></h1>
      <div id="ut-app"></div>
    </div>
"""


def build_utau_html() -> str:
    return page_shell(
        title="Utau",
        body=BODY,
        static_prefix="../static/",
        home_href="../index.html",
        extra_scripts=UTAU_SCRIPTS,
    )
