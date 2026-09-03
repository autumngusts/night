"""ホームページに表示するミニプロジェクトの一覧。

新しいミニプロジェクトを追加する場合は、ここにエントリを追記し、
site_src/i18n_data.py に name_key / desc_key の翻訳を追加し、
generate.py の build_pages() で出力先を登録する。
"""

from __future__ import annotations

PROJECTS = [
    {
        "id": "night",
        "href": "night/index.html",
        "name_key": "project_night_name",
        "desc_key": "project_night_desc",
    },
    {
        "id": "midnight",
        "href": "midnight/index.html",
        "name_key": "project_midnight_name",
        "desc_key": "project_midnight_desc",
    },
]
