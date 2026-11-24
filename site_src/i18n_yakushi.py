"""少女藥師的獨語（yakushi）的 UI 字串。第 1 階段只做 zh，ja／en 先與 zh 相同。
由 i18n_data.py 合併；generate.py 依 ys_ 前綴輸出成 static/i18n/yakushi.js。
劇情、藥材、人物文字放在 static_src/yakushi_*.js 的資料裡。"""

from __future__ import annotations

_ROWS: tuple[tuple[str, str], ...] = (
    ("ys_title", "少女藥師的獨語"),
    ("ys_loading", "載入中…"),
    ("ys_disclaimer", "藥材說明與解方皆為遊戲設定，非醫療建議。"),
)

YAKUSHI_ZH: dict[str, str] = {k: zh for k, zh in _ROWS}
YAKUSHI_JA: dict[str, str] = dict(YAKUSHI_ZH)
YAKUSHI_EN: dict[str, str] = dict(YAKUSHI_ZH)

YAKUSHI_PROJECT: dict[str, dict[str, str]] = {
    "zh": {"project_yakushi_name": "少女藥師的獨語", "project_yakushi_desc": "藥師養女誤入後宮，用藥材知識與推理，解開後宮、花街與宮外的藥毒事件"},
    "ja": {"project_yakushi_name": "少女藥師的獨語", "project_yakushi_desc": "薬師の養女が後宮へ。薬の知識と推理で後宮・花街・宮外の事件を解く"},
    "en": {"project_yakushi_name": "少女藥師的獨語", "project_yakushi_desc": "An apothecary's daughter solves poison mysteries in the inner palace"},
}
