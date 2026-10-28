"""明星經紀 starV（starv）のページを組み立てる。

放置型の芸能事務所経営ゲーム。規格：docs/superpowers/specs/2026-10-27-starv-design.md
ゲームロジックはすべてブラウザ側：static/starv_data.js（資料）→ starv_roster*.js（SR/SSR 名錄）→
starv_core.js（規則引擎）→ starv_store.js（存檔）→ starv_cloud.js（雲端存檔）→ starv_avatar.js（頭像）→ starv_murmurs.js（murmur・個人情報）→ starv_ui.js（共用 UI）→
starv_view_*.js（各分頁）→ starv_office3d.js（3D 設施圖）→ starv_log.js（日誌・離線報告）→ starv.js（主程式）。
雲端存檔用共用的 firebase_config.js／game_storage.js／qrcode.js，只有啟用時才載入 Firebase SDK。
"""

from __future__ import annotations

from site_src.layout import asset_url, page_shell

STARV_SCRIPTS: tuple[str, ...] = (
    "firebase_config.js",
    "game_storage.js",
    "qrcode.js",
    "starv_data.js",
    "starv_words_1.js",
    "starv_traits_1.js",
    "starv_events.js",
    "starv_events_1.js",
    "starv_events_2.js",
    "starv_events_3.js",
    "starv_events_4.js",
    "starv_events_5.js",
    "starv_events_6.js",
    "starv_events_7.js",
    "starv_events_8.js",
    "starv_events_9.js",
    "starv_events_10.js",
    "starv_events_11.js",
    "starv_events_12.js",
    "starv_events_13.js",
    "starv_events_14.js",
    "starv_awards_data.js",
    "starv_projects.js",
    "starv_projects_1.js",
    "starv_projects_2.js",
    "starv_achievements.js",
    "starv_achievements_1.js",
    "starv_achievements_2.js",
    "starv_achievements_3.js",
    "starv_roster.js",
    "starv_roster_1.js",
    "starv_roster_2.js",
    "starv_roster_3.js",
    "starv_roster_4.js",
    "starv_roster_5.js",
    "starv_roster_6.js",
    "starv_roster_rivals_1.js",
    "starv_roster_rivals_2.js",
    "starv_core.js",
    "starv_store.js",
    "starv_cloud.js",
    "starv_avatar.js",
    "starv_murmurs.js",
    "starv_stage_spec.js",
    "starv_ui.js",
    "starv_view_artists.js",
    "starv_view_daily.js",
    "starv_view_jobs.js",
    "starv_view_projects.js",
    "starv_view_industry.js",
    "starv_view_gacha.js",
    "starv_view_hall.js",
    "starv_view_company.js",
    "starv_events_ui.js",
    "starv_awards_ui.js",
    "starv_career_ui.js",
    "starv_stage3d.js",
    "starv_office3d.js",
    "starv_stage_ui.js",
    "starv_cloud_ui.js",
    "starv_log.js",
    "starv.js",
)


def build_starv_html() -> str:
    three_src = asset_url("../static/", "vendor/three.min.js")
    body = f"""    <div class="sv-root">
      <div id="sv-app" data-three-src="{three_src}"></div>
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
