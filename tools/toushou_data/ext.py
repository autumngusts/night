"""toushou 擴充標的轉換：tools/toushou_data/ext/<類別 id>.txt → static_src/toushou_data_ext.js。

執行：
  py -3 tools/toushou_data/ext.py

撰寫格式（一行一個標的，# 開頭為註解，欄位以「 | 」分隔）：
  中文名/日文名 | 中文簡介 | 日文簡介 | 特徵 | 消息切入點

* 名稱、特徵、切入點的日文與中文相同時可省略日文（名稱省略「/日文名」，特徵寫「中文」而非「中文=日文」）。
* 特徵 2〜3 個、切入點剛好 3 個，以「;」分隔，每個寫「中文=日文」。
* 簡介只寫優點（規格：股東再放消息往下扣或往上推）。
* id 為「該類別既有前綴＋流水號」，接在既有標的之後（例：sengoku_person 既有 sp01〜sp10，擴充從 sp11 起）。
  只能在檔尾追加，不要插入或調換行，否則 id 會改變。
* 跨類別或與既有標的同名時報錯。

類別的前綴與既有數量寫在 CATEGORIES；既有標的的名稱從 static_src/toushou_data_*.js 讀取（以 node 執行）。
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC_DIR = Path(__file__).resolve().parent / "ext"
OUT = ROOT / "static_src" / "toushou_data_ext.js"

# 類別 id → (id 前綴, 既有標的數)
CATEGORIES: dict[str, tuple[str, int]] = {
    "sengoku_person": ("sp", 10),
    "tw_company": ("tc", 18),
    "jp_company": ("jp", 19),
    "hokkaido": ("hk", 9),
    "tohoku": ("th", 10),
    "kansai": ("ks", 10),
    "kanto": ("kt", 10),
    "washoku": ("ws", 10),
    "anime_game": ("ag", 17),
    "jp_sports": ("js", 10),
    "jp_pop": ("pc", 10),
    "taiwan_spot": ("tp", 10),
}

BASE_FILES = ["toushou_data.js", "toushou_data_sengoku.js", "toushou_data_celebrity.js", "toushou_data_company.js",
              "toushou_data_region.js", "toushou_data_food.js", "toushou_data_anime.js", "toushou_data_culture.js",
              "toushou_data_taiwan.js"]


def existing_names() -> dict[str, str]:
    """既有標的：zh 名稱 → id。"""
    script = (
        "var fs=require('fs'),w={};"
        + "".join(f"new Function('window',fs.readFileSync({json.dumps(str(ROOT / 'static_src' / f))},'utf8'))(w);" for f in BASE_FILES)
        + "console.log(JSON.stringify(w.PriTestToushouData.TARGETS.map(function(t){return [t.name.zh,t.id];})));"
    )
    out = subprocess.run(["node", "-e", script], capture_output=True, text=True, encoding="utf-8", check=True).stdout
    return {zh: iid for zh, iid in json.loads(out)}


def pair(text: str) -> dict[str, str]:
    zh, _, ja = text.partition("=")
    zh, ja = zh.strip(), ja.strip()
    return {"ja": ja or zh, "zh": zh}


def main() -> int:
    errors: list[str] = []
    seen = existing_names()
    blocks: list[str] = []
    total = 0
    for cat, (prefix, base) in CATEGORIES.items():
        path = SRC_DIR / f"{cat}.txt"
        if not path.exists():
            continue
        rows = []
        for no, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            parts = [p.strip() for p in line.split(" | ")]
            where = f"{path.name}:{no}"
            if len(parts) != 5:
                errors.append(f"{where}: 欄位數 {len(parts)}（應為 5）")
                continue
            names, sum_zh, sum_ja, tags_s, hooks_s = parts
            zh, _, ja = names.partition("/")
            zh, ja = zh.strip(), (ja.strip() or zh.strip())
            tags = [pair(x) for x in tags_s.split(";") if x.strip()]
            hooks = [pair(x) for x in hooks_s.split(";") if x.strip()]
            if not (2 <= len(tags) <= 3):
                errors.append(f"{where}: 特徵 {len(tags)} 個（應為 2〜3）")
            if len(hooks) != 3:
                errors.append(f"{where}: 切入點 {len(hooks)} 個（應為 3）")
            if not sum_zh or not sum_ja:
                errors.append(f"{where}: 簡介不可空白")
            if zh in seen:
                errors.append(f"{where}: 「{zh}」已存在（{seen[zh]}）")
                continue
            iid = f"{prefix}{base + len(rows) + 1:02d}"
            seen[zh] = iid
            rows.append({"id": iid, "name": {"ja": ja, "zh": zh}, "summary": {"ja": sum_ja, "zh": sum_zh},
                         "tags": tags, "hooks": hooks})
        total += len(rows)
        print(f"{cat}: 擴充 {len(rows)}（共 {base + len(rows)}）")
        body = ",\n".join("    " + json.dumps(r, ensure_ascii=False) for r in rows)
        blocks.append(f"  D.addTargets({json.dumps(cat)}, [\n{body}\n  ]);\n")
    if errors:
        print(f"{len(errors)} 個錯誤：")
        for e in errors:
            print("  " + e)
        return 1
    OUT.write_text(
        "// 由 tools/toushou_data/ext.py 從 tools/toushou_data/ext/*.txt 產生，請勿手改。\n"
        "// 替既有類別追加標的（2026-10-19 擴充：總數約 500）。\n"
        "(function () {\n  \"use strict\";\n  var D = window.PriTestToushouData;\n\n"
        + "\n".join(blocks)
        + "})();\n",
        encoding="utf-8",
    )
    print(f"擴充標的共 {total}，輸出 {OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
