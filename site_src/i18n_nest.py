"""秘密的同居生活（nest）的 UI 字串（zh / ja / en）。

由 i18n_data.py 合併進 STRINGS；generate.py 依 ns_ 前綴輸出成 static/i18n/nest.js。
劇情與遊戲內文字放在 static_src/nest_*.js（目前只有繁中），這裡只放頁面標題與首頁卡片。
"""

from __future__ import annotations

NEST_ZH: dict[str, str] = {"ns_title": "秘密的同居生活"}
NEST_JA: dict[str, str] = {"ns_title": "ひみつの同居生活"}
NEST_EN: dict[str, str] = {"ns_title": "Secret Shared House"}

NEST_PROJECT: dict[str, dict[str, str]] = {
    "zh": {"project_nest_name": "秘密的同居生活", "project_nest_desc": "【18 禁】繼承外婆的老公寓「椿莊」，90 天內還清貸款。房間配置拼圖：貝斯聲、晚歸、樓上的腳步、料理香、貓、菸味 vs 淺眠、白天睡、過敏……誰住誰隔壁決定滿意度與房租。20 位房客各有個人故事與兩段專屬夜晚，修繕、聊天、公共空間的意外，還有深夜的敲門聲"},
    "ja": {"project_nest_name": "ひみつの同居生活", "project_nest_desc": "【18 禁】祖母の古いアパート「椿荘」を相続、90 日で借金を返済。部屋割りパズル：ベースの音・深夜帰宅・足音・料理の匂い・猫・煙草 vs 浅い眠り・昼寝・アレルギー……隣人の組み合わせが満足度と家賃を決める。20 人の住人それぞれの物語と二つの夜（本文は繁体字中国語）"},
    "en": {"project_nest_name": "Secret Shared House", "project_nest_desc": "[18+] Inherit grandma's old apartment and repay the loan in 90 days. A room-layout puzzle — bass practice, late nights, footsteps, cooking, cats and smoke vs light sleepers, night-shift workers and allergies — decides satisfaction and rent. 20 tenants with their own stories and nights (Traditional Chinese text)"},
}
