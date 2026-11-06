"""大名幸村（yukimura）的頁面。

東北戰國類倖存者：選一位大名，在 15 分鐘內活下來並打倒魔王。手機用虛擬搖桿操作，支援多人連線（可中途加入／退出）。
遊戲邏輯全部在瀏覽器端：static/yukimura_data.js（資料）→ yukimura_core.js（規則與模擬）
→ yukimura_net.js（多人連線：firebase_config.js／game_storage.js 的 rtState）→ yukimura_3d.js（three.js，進入戰場才載入）→ yukimura.js（畫面）。
2026-11-05 依使用者需求新增。
2026-11-06 新模式「天下布武」：yukimura_tenka.js（軍略樹、符文、天命、流派、軍令資料）、yukimura_tenka_ui.js（軍略樹與符文格畫面）。
"""

from __future__ import annotations

from site_src.layout import asset_url, page_shell

YUKIMURA_SCRIPTS: tuple[str, ...] = (
    "yukimura_data.js",
    "yukimura_tenka.js",
    "yukimura_core.js",
    "firebase_config.js",
    "game_storage.js",
    "qrcode.js",
    "yukimura_net.js",
    "yukimura_3d.js",
    "yukimura_tenka_ui.js",
    "yukimura.js",
)


def build_yukimura_html() -> str:
    three_src = asset_url("../static/", "vendor/three.min.js")
    body = f"""    <div class="yk-wrap">
      <div id="yk-app" data-three-src="{three_src}"></div>
    </div>
"""
    return page_shell(
        title="大名幸村",
        body=body,
        static_prefix="../static/",
        home_href="../index.html",
        extra_scripts=YUKIMURA_SCRIPTS,
        extra_styles=("css/yukimura.css",),
        extra_i18n=("i18n/yukimura.js",),
    )
