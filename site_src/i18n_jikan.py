"""時間管理大師（jikan）的 UI 字串（zh / ja / en）。

由 i18n_data.py 合併進 STRINGS；generate.py 依 jk_ 前綴輸出成 static/i18n/jikan.js。
女孩的台詞、情報、地點等遊戲內容放在 static_src/jikan_data.js（原作為繁體中文，目前只有繁中），
這裡只放頁面標題與首頁卡片。
"""

from __future__ import annotations

JIKAN_ZH: dict[str, str] = {
    "jk_title": "時間管理大師",
}
JIKAN_JA: dict[str, str] = {
    "jk_title": "時間管理の達人",
}
JIKAN_EN: dict[str, str] = {
    "jk_title": "Time Management Master",
}

# 首頁卡片（project_jikan_* 不以 jk_ 開頭，留在共用 i18n.js）
JIKAN_PROJECT: dict[str, dict[str, str]] = {
    "zh": {"project_jikan_name": "時間管理大師", "project_jikan_desc": "同時和好幾個她約會，記住每個人說過的事——記錯扣分、搞混更慘。28 天、32 種個性，在街道上走走邂逅，車站常有新面孔"},
    "ja": {"project_jikan_name": "時間管理の達人", "project_jikan_desc": "何人もの彼女と同時にデート。一人ひとりの話を覚えておこう——間違えたら減点、混同したらもっと大変。28 日間・32 種の性格、街を歩いて出会い、駅には新しい顔も（本文は繁体字中国語）"},
    "en": {"project_jikan_name": "Time Management Master", "project_jikan_desc": "Date several girls at once and remember what each one told you — mix them up and pay the price. 28 days, 32 personalities, a walkable town where the station brings new faces (Traditional Chinese text)"},
}
