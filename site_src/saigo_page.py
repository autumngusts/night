"""賽狗賽狗（saigo）的頁面。

自己養狗、在家園訓練，跟 CPU 或朋友的狗（共 6 隻）在隨機生成的關卡賽道上比賽；出賽前看能力／調子／天氣下注，3D 轉播觀戰。
遊戲邏輯全部在瀏覽器端：static/saigo_data.js（犬種與資料）→ saigo_core.js（出賽表＋確定性模擬＋賠率）→ saigo_bet.js（下注）
→ saigo_kennel.js（犬舍，localStorage）→ saigo_net.js（多裝置連線：firebase_config.js／game_storage.js 的 rtState）
→ saigo_3d.js（three.js 建模與轉播，第一次用到才載入 vendor/three.min.js）→ saigo.js（畫面）。
"""

from __future__ import annotations

from site_src.layout import asset_url, page_shell

SAIGO_SCRIPTS: tuple[str, ...] = (
    "saigo_data.js",
    "saigo_core.js",
    "saigo_bet.js",
    "saigo_kennel.js",
    "firebase_config.js",
    "game_storage.js",
    "qrcode.js",
    "saigo_net.js",
    "saigo_3d.js",
    "saigo.js",
)


def build_saigo_html() -> str:
    three_src = asset_url("../static/", "vendor/three.min.js")
    body = f"""    <div class="sg-wrap">
      <div id="sg-app" data-three-src="{three_src}"></div>
    </div>
"""
    return page_shell(
        title="賽狗賽狗",
        body=body,
        static_prefix="../static/",
        home_href="../index.html",
        extra_scripts=SAIGO_SCRIPTS,
        extra_styles=("css/saigo.css",),
        extra_i18n=("i18n/saigo.js",),
    )
