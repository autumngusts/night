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

# 神前鍛刀對決・黃牌・鐵拳教育・DÉJÀ VU 的字串較多，獨立放在 i18n_katana.py／i18n_yellow.py／i18n_fist.py／i18n_dejavu.py 再合併
STRINGS: dict[str, dict[str, str]] = {
    "zh": {**STRINGS_ZH, **KATANA_ZH, **YELLOW_ZH, **FIST_ZH, **FIST_RAID_ZH, **DEJAVU_ZH, **STARV_ZH},
    "ja": {**STRINGS_JA, **KATANA_JA, **YELLOW_JA, **FIST_JA, **FIST_RAID_JA, **DEJAVU_JA, **STARV_JA},
    "en": {**STRINGS_EN, **KATANA_EN, **YELLOW_EN, **FIST_EN, **FIST_RAID_EN, **DEJAVU_EN, **STARV_EN},
}
