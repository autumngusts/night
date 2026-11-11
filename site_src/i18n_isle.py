"""無人島的漂流者（isle）的 UI 字串（zh / ja / en）。由 i18n_data.py 合併；generate.py 依 il_ 前綴輸出成 static/i18n/isle.js。"""

from __future__ import annotations

ISLE_ZH: dict[str, str] = {"il_title": "無人島的漂流者"}
ISLE_JA: dict[str, str] = {"il_title": "無人島の漂流者"}
ISLE_EN: dict[str, str] = {"il_title": "Castaways"}

ISLE_PROJECT: dict[str, dict[str, str]] = {
    "zh": {"project_isle_name": "無人島的漂流者", "project_isle_desc": "【18 禁】郵輪觸礁，你和 8 位女性被沖上無人島。分配採集、汲水、伐木、探索與建造，對抗飢餓、口渴和暴風雨；蓋避難所、小屋、訊號火與木筏。營火、沙灘、瀑布的夜晚，30 天後獲救、出海，或留在島上"},
    "ja": {"project_isle_name": "無人島の漂流者", "project_isle_desc": "【18 禁】客船が座礁し、あなたと 8 人の女性が無人島へ。採集・水汲み・伐採・探索・建築を割り振り、飢えと渇きと嵐に立ち向かう。シェルター、小屋、狼煙、筏。焚き火と砂浜と滝の夜、30 日後に救助か出航か島に残るか（本文は繁体字中国語）"},
    "en": {"project_isle_name": "Castaways", "project_isle_desc": "[18+] Shipwrecked on a desert island with 8 women: assign foraging, water, wood, exploring and building against hunger, thirst and storms; build shelters, huts, a signal fire and a raft. Nights by the fire, the beach and the falls, and in 30 days, rescue, escape or stay (Traditional Chinese text)"},
}
