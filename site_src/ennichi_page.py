"""緣日樂園（ennichi）的頁面——目前是人物呈現的技術驗證樣本。

規格：docs/ennichi_rules.md（§8 人物呈現、§9.1 three.js 版本與擴充）。
遊戲邏輯全部在瀏覽器端：static/ennichi_lab.js 先載入共用的 vendor/three.min.js（r149），
再載入 vendor/ennichi_vrm.js（GLTFLoader／OrbitControls／Bloom＋@pixiv/three-vrm），
顯示 VRM 近景、看板人物群眾、murmur 氣泡與立繪比較。2026-11-12 依使用者需求新增。
"""

from __future__ import annotations

from site_src.layout import asset_url, page_shell

ENNICHI_SCRIPTS: tuple[str, ...] = ("ennichi_lab.js",)


def build_ennichi_html() -> str:
    three_src = asset_url("../static/", "vendor/three.min.js")
    vendor_src = asset_url("../static/", "vendor/ennichi_vrm.js")
    body = f"""    <div class="en-wrap">
      <div id="en-app" data-three-src="{three_src}" data-vendor-src="{vendor_src}"
           data-model="../static/models/ennichi/sayo.vrm"
           data-jikan="../static/images/jikan/"></div>
    </div>
"""
    return page_shell(
        title="緣日樂園",
        body=body,
        static_prefix="../static/",
        home_href="../index.html",
        extra_scripts=ENNICHI_SCRIPTS,
        extra_styles=("css/ennichi.css",),
        extra_i18n=("i18n/ennichi.js",),
    )
