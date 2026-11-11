"""魔王城的防衛戰（maou）的頁面。

塔防＋魔物娘：你是剛繼任的人類魔王，把 10 位魔族部下（魅魔、精靈弓手、暗黑騎士、狼人、龍娘、吸血鬼、九尾狐、魔女、樹精、機巧人偶）
配置在城內的台座上，擋住 12 章的勇者軍團（Canvas 即時戰鬥、升級、奧義）。城內談話培養羈絆，羈絆第 2 段後解鎖奧義與夜晚劇情（18 禁），
締結契約的部下可以在最後被立為魔后。18 禁確認沿用盛夏合宿。
遊戲邏輯全部在瀏覽器端：static/maou_data.js（地圖、部下、敵人、關卡）→ maou_story.js（部下的故事）→ maou_night.js／maou_night2.js／maou_night3.js（夜晚劇情：每人 4 段專屬＋共用 8 段、城內曖昧談話）→ maou.js（塔防引擎與畫面）。
頭像用 static/images/jikan/ 的 g_000〜g_059 奇幻系列（排除名單外），設定為外表成年、活了數百年的魔族。2026-11-11 依使用者需求新增。
"""

from __future__ import annotations

from site_src.layout import page_shell

MAOU_SCRIPTS: tuple[str, ...] = ("maou_data.js", "maou_story.js", "maou_night.js", "maou_night2.js", "maou_night3.js", "maou.js")


def build_maou_html() -> str:
    body = """    <div class="mu-wrap">
      <div id="mu-app" data-img="../static/images/jikan/">
        <noscript>這個遊戲需要 JavaScript。</noscript>
      </div>
    </div>
"""
    return page_shell(
        title="魔王城的防衛戰",
        body=body,
        static_prefix="../static/",
        home_href="../index.html",
        extra_scripts=MAOU_SCRIPTS,
        extra_styles=("css/maou.css",),
        extra_i18n=("i18n/maou.js",),
    )
