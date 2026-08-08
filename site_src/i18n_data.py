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

STRINGS: dict[str, dict[str, str]] = {
    "zh": STRINGS_ZH,
    "ja": STRINGS_JA,
    "en": STRINGS_EN,
}
