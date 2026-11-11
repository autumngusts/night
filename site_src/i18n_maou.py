"""魔王城的防衛戰（maou）的 UI 字串（zh / ja / en）。由 i18n_data.py 合併；generate.py 依 mu_ 前綴輸出成 static/i18n/maou.js。"""

from __future__ import annotations

MAOU_ZH: dict[str, str] = {"mu_title": "魔王城的防衛戰"}
MAOU_JA: dict[str, str] = {"mu_title": "魔王城防衛戦"}
MAOU_EN: dict[str, str] = {"mu_title": "Demon Castle Defense"}

MAOU_PROJECT: dict[str, dict[str, str]] = {
    "zh": {"project_maou_name": "魔王城的防衛戰", "project_maou_desc": "【18 禁】塔防＋魔物娘：剛繼任的人類魔王，把魅魔、精靈弓手、暗黑騎士、龍娘、吸血鬼、九尾狐、魔女……10 位部下配置在城內，擋住 12 章勇者軍團。升級、奧義、羈絆故事與戰後的夜晚，最後立一位魔后"},
    "ja": {"project_maou_name": "魔王城防衛戦", "project_maou_desc": "【18 禁】タワーディフェンス×魔物娘。人間出身の新魔王として、サキュバス・エルフ・暗黒騎士・竜娘・吸血鬼・九尾・魔女など 10 人の部下を城内に配置し、12 章の勇者軍を迎え撃つ。強化、奥義、絆の物語と戦後の夜、最後に魔后を選ぶ（本文は繁体字中国語）"},
    "en": {"project_maou_name": "Demon Castle Defense", "project_maou_desc": "[18+] Tower defense with monster girls: as a newly crowned human Demon Lord, deploy a succubus, elf archer, dark knight, dragon girl, vampire, kitsune, witch and more against 12 chapters of the invading army, with upgrades, ultimate skills, bond stories, nights, and a queen at the end (Traditional Chinese text)"},
}
