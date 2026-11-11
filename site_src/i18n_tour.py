"""星途巡演（tour）的 UI 字串（zh / ja / en）。

由 i18n_data.py 合併進 STRINGS；generate.py 依 tr_ 前綴輸出成 static/i18n/tour.js。
劇情與遊戲內文字放在 static_src/tour_*.js（目前只有繁中），這裡只放頁面標題與首頁卡片。
"""

from __future__ import annotations

TOUR_ZH: dict[str, str] = {"tr_title": "星途巡演"}
TOUR_JA: dict[str, str] = {"tr_title": "スターロード・ツアー"}
TOUR_EN: dict[str, str] = {"tr_title": "Star Road Tour"}

TOUR_PROJECT: dict[str, dict[str, str]] = {
    "zh": {"project_tour_name": "星途巡演", "project_tour_desc": "【18 禁】5 人偶像團體的經紀人，20 城巡演：白天排練、宣傳、單獨相處，晚上用節奏遊戲幫她們打 call；演出後的巴士與飯店是秘密戀愛的舞台，但小心狗仔——最終站台北大巨蛋"},
    "ja": {"project_tour_name": "スターロード・ツアー", "project_tour_desc": "【18 禁】5 人組アイドルのマネージャーとして 20 都市ツアーへ。昼はレッスン・宣伝・二人きりの時間、夜はリズムゲームでコール。終演後のバスとホテルは秘密の恋の舞台、でも週刊誌に注意——最終公演は台北ドーム（本文は繁体字中国語）"},
    "en": {"project_tour_name": "Star Road Tour", "project_tour_desc": "[18+] Manage a 5-member idol group on a 20-city tour: rehearse, promote and steal time alone by day, cheer them on in a rhythm game by night — secret romance on the tour bus and in hotels, but watch out for paparazzi. Final stop: Taipei Dome (Traditional Chinese text)"},
}
