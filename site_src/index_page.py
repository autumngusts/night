"""ホームページ（ミニプロジェクト選択画面）を組み立てる。"""

from __future__ import annotations

from site_src.layout import page_shell
from site_src.projects import PROJECTS


def build_index_html() -> str:
    cards = "\n".join(
        f"""    <a class="project-card" href="{project['href']}">
      <h2 data-i18n="{project['name_key']}"></h2>
      <p data-i18n="{project['desc_key']}"></p>
    </a>"""
        for project in PROJECTS
    )

    body = f"""    <h1 data-i18n="home_title"></h1>
    <p data-i18n="home_subtitle"></p>
    <div class="project-grid">
{cards}
    </div>
"""

    return page_shell(
        title="PriTest",
        body=body,
        static_prefix="static/",
        home_href="index.html",
    )
