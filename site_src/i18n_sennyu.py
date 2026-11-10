"""潛入晶片（sennyu）的 UI 字串（zh / ja / en）。

由 i18n_data.py 合併進 STRINGS；generate.py 依 sn_ 前綴輸出成 static/i18n/sennyu.js。
劇情、人物、情報等遊戲內容放在 static_src/sennyu_*.js（目前只有繁中），這裡只放頁面標題與首頁卡片。
"""

from __future__ import annotations

SENNYU_ZH: dict[str, str] = {
    "sn_title": "潛入晶片",
}
SENNYU_JA: dict[str, str] = {
    "sn_title": "潜入チップ",
}
SENNYU_EN: dict[str, str] = {
    "sn_title": "Chip Infiltration",
}

# 首頁卡片（project_sennyu_* 不以 sn_ 開頭，留在共用 i18n.js）
SENNYU_PROJECT: dict[str, dict[str, str]] = {
    "zh": {"project_sennyu_name": "潛入晶片", "project_sennyu_desc": "文字冒險：扮演女間諜以秘書身分潛入晶片大廠 VN，處理不合理要求、主持、應酬、夜間潛入，一步步取得信任走到執行長身邊，奪取封存的「零號模型」。多重結局，約 1 小時"},
    "ja": {"project_sennyu_name": "潜入チップ", "project_sennyu_desc": "テキストADV：女スパイが秘書として半導体大手 VN に潜入。理不尽な頼みごと、司会、接待、夜の潜入をこなして信頼を得て CEO の側へ——封印された「ゼロ号モデル」を奪え。マルチエンディング・約1時間（本文は繁体字中国語）"},
    "en": {"project_sennyu_name": "Chip Infiltration", "project_sennyu_desc": "Visual novel: a spy poses as a secretary at chipmaker VN, earning trust through absurd requests, hosting, dinners and night infiltrations until she reaches the CEO and the sealed Model Zero. Multiple endings, about 1 hour (Traditional Chinese text)"},
}
