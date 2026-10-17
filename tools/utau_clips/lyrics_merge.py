"""我不會唱歌（utau）：把一批填詞合併進 lyrics.json（合併前先備份）。

填詞檔是 Python 檔，內容為 FILLS = {id: {"voice": "male"|"female", "lines": [...]}}：
  - 一句可以是 {"keep": i, ...覆寫欄位}：沿用 lyrics.json 該首既有的第 i 句
  - 日文／英文歌（zh_sing）：{"t", "ja", "zh"（直譯）, "sing"（中文填詞，只能有漢字）, "end"（可省略）}
  - 華語歌（ja_sing）：{"t", "ja"（中文原詞）, "ja_sing"（平假名填詞）, "end"}
  合併後該首的 lines 整個換成 FILLS 裡的內容。
填詞檔含歌詞，和 lyrics.json 一樣不進 Git：放在 cache/（已列在 .gitignore）。

檢查：sing 只能有漢字（字數＝唱的字數，標點會被當成字）；ja_sing 只能有平假名
（長音「ー」VOICEVOX 歌唱 API 會回 HTTP 400，2026-10-17 實測）；每首的 t 要由小到大。

用法：
  tools/utau_clips/.venv/Scripts/python.exe tools/utau_clips/lyrics_merge.py tools/utau_clips/cache/fills_b4.py
"""

from __future__ import annotations

import importlib.util
import re
import shutil
import sys
from pathlib import Path

import lyrics_draft
import zh_voice

HAN = re.compile(r"^[一-鿿]+$")
KANA = re.compile(r"^[ぁ-ゖ]+$")


def load_fills(path: Path) -> dict:
    spec = importlib.util.spec_from_file_location("fills", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.FILLS


def merge(lyrics: dict, fills: dict) -> None:
    for sid, f in fills.items():
        if sid not in lyrics:
            raise KeyError(f"{sid}：lyrics.json 裡沒有（請先跑 lyrics_draft.py）")
        old = lyrics[sid]["lines"]
        lines = []
        for item in f["lines"]:
            if "keep" in item:
                line = dict(old[item["keep"]])
                line.update({k: v for k, v in item.items() if k != "keep"})
            else:
                line = dict(item)
            if "sing" in line and not HAN.match(line["sing"]):
                raise ValueError(f"{sid}：sing 只能有漢字：{line['sing']}")
            if "ja_sing" in line and not KANA.match(line["ja_sing"]):
                raise ValueError(f"{sid}：ja_sing 只能有平假名：{line['ja_sing']}")
            lines.append(line)
        ts = [l["t"] for l in lines]
        if ts != sorted(ts):
            raise ValueError(f"{sid}：每句的 t 要由小到大")
        lyrics[sid]["voice"] = f["voice"]
        lyrics[sid]["lines"] = lines
        print(f"{sid}：{len(lines)} 句")


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    path = Path(sys.argv[1])
    fills = load_fills(path)
    lyrics = zh_voice.load_lyrics()
    merge(lyrics, fills)  # 全部檢查通過才寫檔
    shutil.copy(zh_voice.LYRICS, zh_voice.LYRICS.parent / "cache" / f"lyrics.bak-{path.stem}.json")
    lyrics_draft.save_lyrics(lyrics)


if __name__ == "__main__":
    main()
