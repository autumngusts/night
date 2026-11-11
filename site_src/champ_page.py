"""冠軍教練（champ）的頁面。

全球女子 5v5 MOBA 聯賽的總教練模擬：選擇 12 個起始地區之一（韓國・中國難度低；台灣・北美・西歐中；其餘高），
管理一軍／二軍、招募新人、訓練、約會與飯店秘密約會提升好感與心情；比賽時負責 BP（無懼選角）與戰術，
勝負由選手數值、英雄熟練度、陣容與當天調子計算，並以 3D 重播 3〜5 個關鍵會戰。
遊戲邏輯全部在瀏覽器端：static/champ_data.js（地區、100 英雄、戰術、約會）
→ champ_story.js（個性台詞、murmur、約會選項、身世小故事）→ champ_extra.js（局中指令、設施、節日、結局、成就資料）→ champ_core.js → champ_life.js（合約轉會、設施、事件、宿敵、成就、頒獎）→ champ_bond.js（多段式約會、交往與親密互動、深夜陪練、新人導師）→ champ_bp.js（對位剋制、搖擺位、陣容原型、局間學習、選手請求、BP 評分）→ champ_3d.js（three.js 關鍵會戰重播，第一次用到才載入 vendor/three.min.js）→ champ.js（畫面）。
選手頭像沿用時間管理大師（jikan）的女生照片。2026-11-11 依使用者需求新增。
"""

from __future__ import annotations

from site_src.layout import asset_url, page_shell

CHAMP_SCRIPTS: tuple[str, ...] = (
    "champ_data.js",
    "champ_story.js",
    "champ_extra.js",
    "champ_core.js",
    "champ_life.js",
    "champ_bond.js",
    "champ_bp.js",
    "champ_3d.js",
    "champ.js",
)


def build_champ_html() -> str:
    three_src = asset_url("../static/", "vendor/three.min.js")
    body = f"""    <div class="cc-wrap">
      <div id="cc-app" data-three-src="{three_src}" data-img="../static/images/jikan/"></div>
    </div>
"""
    return page_shell(
        title="冠軍教練",
        body=body,
        static_prefix="../static/",
        home_href="../index.html",
        extra_scripts=CHAMP_SCRIPTS,
        extra_styles=("css/champ.css",),
        extra_i18n=("i18n/champ.js",),
    )
