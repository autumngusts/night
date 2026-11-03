"""サイト全体で使う多言語文字列（中文 / 日本語 / English）。

キーを1つ追加・変更するだけで、ホームページと各ミニプロジェクトの
両方に反映される。generate.py がこの辞書を JSON として
static/i18n.js に埋め込み、ブラウザ側で言語切替に使う。

翻訳文字列本体は1ファイルが大きくなりすぎるのを防ぐため、言語ごとに
i18n_data_zh.py / i18n_data_ja.py / i18n_data_en.py に分割されている。
キーを追加・変更する際は該当言語のファイルを編集すること。
"""

from __future__ import annotations

from site_src.i18n_data_en import STRINGS_EN
from site_src.i18n_data_ja import STRINGS_JA
from site_src.i18n_data_zh import STRINGS_ZH
from site_src.i18n_katana import KATANA_EN, KATANA_JA, KATANA_ZH
from site_src.i18n_yellow import YELLOW_EN, YELLOW_JA, YELLOW_ZH
from site_src.i18n_fist import FIST_EN, FIST_JA, FIST_ZH
from site_src.i18n_fist_raid import FIST_RAID_EN, FIST_RAID_JA, FIST_RAID_ZH
from site_src.i18n_dejavu import DEJAVU_EN, DEJAVU_JA, DEJAVU_ZH
from site_src.i18n_starv import STARV_EN, STARV_JA, STARV_ZH
from site_src.i18n_saigo import SAIGO_EN, SAIGO_JA, SAIGO_ZH
from site_src.i18n_wanren import WANREN_EN, WANREN_JA, WANREN_ZH
from site_src.i18n_reiwa import REIWA_EN, REIWA_JA, REIWA_ZH
from site_src.i18n_jikan import JIKAN_EN, JIKAN_JA, JIKAN_PROJECT, JIKAN_ZH

# 首頁卡片（project_saigo_* 不以 sg_ 開頭，留在共用 i18n.js）
SAIGO_PROJECT: dict[str, dict[str, str]] = {
    "zh": {"project_saigo_name": "賽狗賽狗", "project_saigo_desc": "47 種犬種、自己養狗訓練，6 隻狗在隨機關卡賽道（跳欄、隧道、接飛盤、游泳……）比賽；看調子與天氣下注，3D 轉播、多裝置同步觀戰"},
    "ja": {"project_saigo_name": "サイゴサイゴ", "project_saigo_desc": "47 犬種から自分の犬を育成。ハードル・トンネル・フリスビー・プールなどランダムなコースで 6 頭が競走、調子と天気を見て馬券を買い、3D 中継を複数端末で同期観戦"},
    "en": {"project_saigo_name": "Saigo Saigo", "project_saigo_desc": "Raise your own dog from 47 breeds, then bet on 6-dog obstacle races (hurdles, tunnels, frisbee, pool…) with a 3D broadcast synced across devices"},
}

# 首頁卡片（project_wanren_* 不以 wr_ 開頭，留在共用 i18n.js）
WANREN_PROJECT: dict[str, dict[str, str]] = {
    "zh": {"project_wanren_name": "萬人迷", "project_wanren_desc": "從大一開始的三年大學生活：15 位個性不同的她（同級生、學姐、老師、家長），好感、任務、約會、告白與修羅場；每天都有新的迷妹。3D 校園自由走動，每學年中間報告、三年後總報告"},
    "ja": {"project_wanren_name": "万人迷", "project_wanren_desc": "大学 1 年生からの三年間。同級生・先輩・先生・保護者の 15 人と好感度、頼みごと、デート、告白、修羅場。毎日新しいファンも現れる。3D キャンパスを歩き回り、学年ごとと三年後にレポート"},
    "en": {"project_wanren_name": "Heartthrob", "project_wanren_desc": "Three years of university life from freshman year: 15 heroines, quests, dates, confessions and jealousy, plus new admirers every day — on a walkable 3D campus, with yearly and final reports"},
}

# 神前鍛刀對決・黃牌・鐵拳教育・DÉJÀ VU 的字串較多，獨立放在 i18n_katana.py／i18n_yellow.py／i18n_fist.py／i18n_dejavu.py 再合併
STRINGS: dict[str, dict[str, str]] = {
    "zh": {**STRINGS_ZH, **KATANA_ZH, **YELLOW_ZH, **FIST_ZH, **FIST_RAID_ZH, **DEJAVU_ZH, **STARV_ZH, **SAIGO_ZH, **SAIGO_PROJECT["zh"], **WANREN_ZH, **WANREN_PROJECT["zh"], **REIWA_ZH, **JIKAN_ZH, **JIKAN_PROJECT["zh"]},
    "ja": {**STRINGS_JA, **KATANA_JA, **YELLOW_JA, **FIST_JA, **FIST_RAID_JA, **DEJAVU_JA, **STARV_JA, **SAIGO_JA, **SAIGO_PROJECT["ja"], **WANREN_JA, **WANREN_PROJECT["ja"], **REIWA_JA, **JIKAN_JA, **JIKAN_PROJECT["ja"]},
    "en": {**STRINGS_EN, **KATANA_EN, **YELLOW_EN, **FIST_EN, **FIST_RAID_EN, **DEJAVU_EN, **STARV_EN, **SAIGO_EN, **SAIGO_PROJECT["en"], **WANREN_EN, **WANREN_PROJECT["en"], **REIWA_EN, **JIKAN_EN, **JIKAN_PROJECT["en"]},
}
