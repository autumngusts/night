"""武俠合成（gousei）語音模式用的「漢字→無聲調拼音」對照表。

語音辨識只回傳文字，同音字常常跑掉（雷加水 → 累家稅）。gousei_core.js 會把辨識結果與物體名稱
都轉成拼音再比對，因此需要涵蓋任意常用漢字（不只物體名稱用到的字）的對照表。

輸出 static_src/gousei_pinyin.js：{"lei": "雷累淚…", ...}（依拼音分組以縮小檔案）。
破音字只取 pypinyin 的預設讀音。產物提交進 Git；只有修改本工具時才需要重新執行：

    py -3 -m pip install pypinyin
    py -3 tools/gousei_data/build_pinyin.py
"""

from __future__ import annotations

import json
from pathlib import Path

from pypinyin import Style, lazy_pinyin

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "static_src" / "gousei_pinyin.js"

# CJK 統一漢字基本區（繁簡與日本新字體都在這裡）
RANGES = ((0x4E00, 0x9FFF),)


def build() -> dict[str, str]:
    groups: dict[str, list[str]] = {}
    for lo, hi in RANGES:
        for code in range(lo, hi + 1):
            ch = chr(code)
            py = lazy_pinyin(ch, style=Style.NORMAL, v_to_u=False, errors="ignore")
            if not py or not py[0].isascii() or not py[0].isalpha():
                continue
            groups.setdefault(py[0], []).append(ch)
    return {k: "".join(v) for k, v in sorted(groups.items())}


def main() -> None:
    table = build()
    body = json.dumps(table, ensure_ascii=False, separators=(",", ":"))
    OUT.write_text(
        "// 由 tools/gousei_data/build_pinyin.py 產生，請勿手動修改。\n"
        f"window.PriTestGouseiPinyin = {body};\n",
        encoding="utf-8",
    )
    count = sum(len(v) for v in table.values())
    print(f"{OUT.relative_to(ROOT)}: {len(table)} 個拼音、{count} 字、{OUT.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
