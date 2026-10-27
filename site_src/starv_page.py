"""明星經紀 starV（starv）のページを組み立てる。

放置型の芸能事務所経営ゲーム。規格：docs/superpowers/specs/2026-10-27-starv-design.md
ゲームロジックはすべてブラウザ側：static/starv_data.js（資料）→ starv_roster*.js（SR/SSR 名錄）→
starv_core.js（規則引擎）→ starv_store.js（存檔）→ starv_avatar.js（頭像）→ starv_ui.js（共用 UI）→
starv_view_*.js（各分頁）→ starv_log.js（日誌・離線報告）→ starv.js（主程式）。
"""

from __future__ import annotations

from site_src.layout import page_shell

STARV_SCRIPTS: tuple[str, ...] = (
    "starv_data.js",
    "starv_roster.js",
    "starv_roster_1.js",
    "starv_core.js",
    "starv_store.js",
    "starv_avatar.js",
    "starv_ui.js",
    "starv_view_artists.js",
    "starv_view_gacha.js",
    "starv.js",
)


def build_starv_html() -> str:
    body = """    <div class="sv-root">
      <div id="sv-app"></div>
    </div>
"""
    return page_shell(
        title="starV",
        body=body,
        static_prefix="../static/",
        home_href="../index.html",
        extra_scripts=STARV_SCRIPTS,
        extra_styles=("css/starv.css",),
        extra_i18n=("i18n/starv.js",),
    )
