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
    {
        "id": "toushou",
        "href": "toushou/index.html",
        "name_key": "project_toushou_name",
        "desc_key": "project_toushou_desc",
    },
    {
        "id": "utau",
        "href": "utau/index.html",
        "name_key": "project_utau_name",
        "desc_key": "project_utau_desc",
    },
    {
        "id": "gousei",
        "href": "gousei/index.html",
        "name_key": "project_gousei_name",
        "desc_key": "project_gousei_desc",
    },
    {
        "id": "katana",
        "href": "katana/index.html",
        "name_key": "project_katana_name",
        "desc_key": "project_katana_desc",
    },
    {
        "id": "yellow",
        "href": "yellow/index.html",
        "name_key": "project_yellow_name",
        "desc_key": "project_yellow_desc",
    },
    {
        "id": "fist",
        "href": "fist/index.html",
        "name_key": "project_fist_name",
        "desc_key": "project_fist_desc",
    },
    {
        "id": "dejavu",
        "href": "dejavu/index.html",
        "name_key": "project_dejavu_name",
        "desc_key": "project_dejavu_desc",
    },
]
