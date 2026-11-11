"""盛夏合宿（natsu）的 UI 字串（zh / ja / en）。

由 i18n_data.py 合併進 STRINGS；generate.py 依 nt_ 前綴輸出成 static/i18n/natsu.js。
劇情與遊戲內文字放在 static_src/natsu_*.js（目前只有繁中），這裡只放頁面標題與首頁卡片。
"""

from __future__ import annotations

NATSU_ZH: dict[str, str] = {"nt_title": "盛夏合宿"}
NATSU_JA: dict[str, str] = {"nt_title": "真夏の合宿"}
NATSU_EN: dict[str, str] = {"nt_title": "Summer Camp"}

NATSU_PROJECT: dict[str, dict[str, str]] = {
    "zh": {"project_natsu_name": "盛夏合宿", "project_natsu_desc": "【18 禁】企業女排的代理教練，30 天海邊集訓：排訓練菜單、個別指導、練習賽，夜晚在海邊與宿舍和 8 位隊員培養感情；每人都有個人故事與交往後的夜晚劇情，最後挑戰全國企業盃"},
    "ja": {"project_natsu_name": "真夏の合宿", "project_natsu_desc": "【18 禁】実業団女子バレーの代理監督として 30 日間の海辺合宿。練習メニュー、個別指導、練習試合、夜は 8 人の選手と海辺や寮で距離を縮める。個人ストーリーと交際後の夜のシナリオ、最後は全国実業団杯（本文は繁体字中国語）"},
    "en": {"project_natsu_name": "Summer Camp", "project_natsu_desc": "[18+] Stand-in coach of a corporate women's volleyball team for a 30-day seaside camp: training menus, one-on-one coaching, scrimmages, and nights by the sea with 8 teammates — personal stories, romance and a national tournament (Traditional Chinese text)"},
}
