"""深夜居酒屋（izakaya）的 UI 字串（zh / ja / en）。

鍵用 iz_ 前綴（generate.py 的 GAME_I18N_PREFIXES 會輸出成 static/i18n/izakaya.js）。
菜單、角色、劇情等遊戲資料的文字放在 static_src/izakaya_*.js。英文只有標題與首頁卡片，其餘 fallback 到繁中。
2026-11-09 依使用者需求新增。
"""

from __future__ import annotations

IZAKAYA_ZH: dict[str, str] = {
    "iz_title": "深夜居酒屋",
    "iz_loading": "準備中……",
}

IZAKAYA_JA: dict[str, str] = {
    "iz_title": "深夜居酒屋",
    "iz_loading": "準備中……",
}

IZAKAYA_EN: dict[str, str] = {
    "iz_title": "Midnight Izakaya",
}

# 首頁卡片（project_izakaya_* 不以 iz_ 開頭，留在共用 i18n.js）
IZAKAYA_PROJECT: dict[str, dict[str, str]] = {
    "zh": {"project_izakaya_name": "深夜居酒屋", "project_izakaya_desc": "經營＋料理＋八點檔：白天採買、晚上接客，從對話推理客人的喜好，週末尖峰即時出菜。常客與店員交錯的樂團往事、歌唱大賽……星級越高越能約會、交往、結婚。3D 店內，單機或 2〜4 人連線分工"},
    "ja": {"project_izakaya_name": "深夜居酒屋", "project_izakaya_desc": "経営＋料理＋昼ドラ：昼は仕入れ、夜は接客。会話から客の好みを推理し、週末のピークはリアルタイムで料理を出す。常連と店員が織りなすバンドの過去、歌唱大会……星が増えるほどデート・交際・結婚へ。3D 店内、ソロでも 2〜4 人協力でも"},
    "en": {"project_izakaya_name": "Midnight Izakaya", "project_izakaya_desc": "Run a late-night izakaya: shop by day, serve by night, read your guests' hidden tastes, survive the weekend rush, and get tangled in your regulars' melodramas. 3D shop, solo or 2–4 player co-op"},
}
