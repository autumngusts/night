"""射彈宇宙（shedan）的 UI 字串（zh / ja / en）。由 i18n_data.py 合併；generate.py 依 sd_ 前綴輸出成 static/i18n/shedan.js。
角色、敵人、屬性、反應的名稱放在 static_src/shedan_data*.js（{zh, ja, en}）。"""

from __future__ import annotations

_ROWS: tuple[tuple[str, str, str, str], ...] = (
    ("sd_title", "射彈宇宙", "射弾宇宙", "Shedan Cosmos"),
    ("sd_nav", "選單", "メニュー", "Menu"),
    ("sd_pick_title", "編成隊伍", "編成", "Assemble the crew"),
    ("sd_pick_hint", "選 4 位隊員出擊（{n}/4）", "4 人選んで出撃（{n}/4）", "Pick 4 crew ({n}/4)"),
    ("sd_launch", "出擊", "出撃", "Launch"),
    ("sd_turn", "回合 {n}", "ターン {n}", "Turn {n}"),
    ("sd_hits", "{n} Hit", "{n} Hit", "{n} Hits"),
    ("sd_chain", "連爆 ×{n}", "連爆 ×{n}", "Chain ×{n}"),
    ("sd_max_chain", "最大連爆 {n}", "最大連爆 {n}", "Best chain {n}"),
    ("sd_enemy_turn", "敵方行動", "敵の行動", "Enemy turn"),
    ("sd_drag_hint", "按住拖曳拉弓，放開射出", "ドラッグして引き、離して発射", "Drag to pull, release to shoot"),
    ("sd_win", "星域淨空", "宙域制圧", "Sector cleared"),
    ("sd_lose", "全員撤退", "全員撤退", "Crew retreated"),
    ("sd_again", "再戰一場", "もう一戦", "Fight again"),
    ("sd_back_pick", "重新編成", "編成に戻る", "Change crew"),
    ("sd_result_stats", "回合 {turns}・總傷害 {dmg}・最大連爆 {chain}", "ターン {turns}・総ダメージ {dmg}・最大連爆 {chain}", "Turns {turns} · Damage {dmg} · Best chain {chain}"),
    ("sd_weak", "弱點", "弱点", "Weak"),
    ("sd_resist", "抗性", "耐性", "Resist"),
)

SHEDAN_ZH: dict[str, str] = {k: zh for k, zh, _ja, _en in _ROWS}
SHEDAN_JA: dict[str, str] = {k: ja for k, _zh, ja, _en in _ROWS}
SHEDAN_EN: dict[str, str] = {k: en for k, _zh, _ja, en in _ROWS}

SHEDAN_PROJECT: dict[str, dict[str, str]] = {
    "zh": {"project_shedan_name": "射彈宇宙", "project_shedan_desc": "彈弓式彈射肉鴿：拉弓射出隊員在星空戰場反彈撞擊，7 屬性星象反應與連爆一路連鎖"},
    "ja": {"project_shedan_name": "射弾宇宙", "project_shedan_desc": "スリングショット式の弾射ローグライク：隊員を引いて撃ち、星空の戦場で反射・衝突。7 属性の星象反応と連爆がつながる"},
    "en": {"project_shedan_name": "Shedan Cosmos", "project_shedan_desc": "Slingshot bounce roguelike: pull and fling your crew across a starfield, chaining seven-element reactions and explosions"},
}
