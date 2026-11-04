"""萬人迷（wanren）的頁面。

模擬大學生活：私立音夣學園大學的大一新生，三個學年（完整版約 24 小時）內遇見 15 位主要女主角（同級生 5、學姐 4、老師 4、家長 2）與追加的 50 位學妹、學姐、老師・導師、家長，
提升好感、完成任務、約會、告白；每天約 3 個新的迷妹要決定回應或無視；每學年中間報告、最後產生學業與感情的總報告。
遊戲邏輯全部在瀏覽器端：static/wanren_data.js（人物與資料）→ wanren_data2〜4.js（擴充、追加 50 人、追加事件）→ wanren_core.js（規則與狀態，localStorage）
→ wanren_3d.js（three.js 3D 校園、走動的學生，第一次用到才載入 vendor/three.min.js）→ wanren.js（畫面）。
"""

from __future__ import annotations

from site_src.layout import asset_url, page_shell

WANREN_SCRIPTS: tuple[str, ...] = (
    "wanren_data.js",
    "wanren_data2.js",
    "wanren_data3.js",
    "wanren_data4.js",
    # 追加的朋友・死黨・老師・家長・學姐 20 人與 8 種新個性（2026-11-04）
    "wanren_data5.js",
    "wanren_core.js",
    "firebase_config.js",
    "game_storage.js",
    "wanren_net.js",
    "wanren_3d.js",
    "wanren.js",
)


def build_wanren_html() -> str:
    three_src = asset_url("../static/", "vendor/three.min.js")
    body = f"""    <div class="wr-wrap">
      <div id="wr-app" data-three-src="{three_src}"></div>
    </div>
"""
    return page_shell(
        title="萬人迷",
        body=body,
        static_prefix="../static/",
        home_href="../index.html",
        extra_scripts=WANREN_SCRIPTS,
        extra_styles=("css/wanren.css",),
        extra_i18n=("i18n/wanren.js",),
    )
