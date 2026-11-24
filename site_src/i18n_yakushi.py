"""少女藥師的獨語（yakushi）的 UI 字串。第 1 階段只做 zh，ja／en 先與 zh 相同。
由 i18n_data.py 合併；generate.py 依 ys_ 前綴輸出成 static/i18n/yakushi.js。
劇情、藥材、人物文字放在 static_src/yakushi_*.js 的資料裡。"""

from __future__ import annotations

_ROWS: tuple[tuple[str, str], ...] = (
    ("ys_title", "少女藥師的獨語"),
    ("ys_loading", "載入中…"),
    ("ys_disclaimer", "藥材說明與解方皆為遊戲設定，非醫療建議。"),
    ("ys_case_locked", "尚未解鎖"),
    ("ys_best", "最佳 {r}"),
    ("ys_continue", "繼續"),
    ("ys_new", "開始"),
    ("ys_hours", "剩餘時辰 {n}"),
    ("ys_stamina", "體力 {n}"),
    ("ys_hours_out", "時辰到了，卯卯被叫了回去。"),
    ("ys_next", "下一句"),
    ("ys_skip", "略過"),
    ("ys_to_board", "整理推理"),
    ("ys_lab", "鑑定・試藥・調藥"),
    ("ys_cards", "線索"),
    ("ys_back_title", "回標題"),
    ("ys_book", "藥材圖鑑"),
    ("ys_journal", "獨語帖"),
    ("ys_cast", "人物"),
    ("ys_reset", "清除存檔"),
    ("ys_reset_confirm", "確定清除所有進度？"),
    ("ys_narrator", "旁白"),
    ("ys_kind_evidence", "證物"),
    ("ys_kind_testimony", "證言"),
    ("ys_kind_symptom", "症狀"),
    ("ys_kind_reaction", "反應"),
    ("ys_kind_person", "人物"),
    ("ys_kind_herb", "藥材"),
)

YAKUSHI_ZH: dict[str, str] = {k: zh for k, zh in _ROWS}
YAKUSHI_JA: dict[str, str] = dict(YAKUSHI_ZH)
YAKUSHI_EN: dict[str, str] = dict(YAKUSHI_ZH)

YAKUSHI_PROJECT: dict[str, dict[str, str]] = {
    "zh": {"project_yakushi_name": "少女藥師的獨語", "project_yakushi_desc": "藥師養女誤入後宮，用藥材知識與推理，解開後宮、花街與宮外的藥毒事件"},
    "ja": {"project_yakushi_name": "少女藥師的獨語", "project_yakushi_desc": "薬師の養女が後宮へ。薬の知識と推理で後宮・花街・宮外の事件を解く"},
    "en": {"project_yakushi_name": "少女藥師的獨語", "project_yakushi_desc": "An apothecary's daughter solves poison mysteries in the inner palace"},
}
