"""武俠合成（gousei）資料建置：驗證 tools/gousei_data/<theme>/*.json、計算階段、輸出 static_src/gousei_data_<theme>.js。

執行：
  py -3 tools/gousei_data/build.py              # 建置全部主題
  py -3 tools/gousei_data/build.py wuxia        # 只建置一個主題
  py -3 tools/gousei_data/build.py --check      # 只驗證、不輸出
  py -3 tools/gousei_data/build.py --skeleton   # 不檢查總數與階段分布（只有骨架時用）

階段：初始物體 = 0；其他 = 所有配方中 max(材料階段) + 1 的最小值。
資料格式與驗證規則見 docs/gousei_game_design.md。
"""

from __future__ import annotations

import json
import re
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT_DIR = ROOT.parent.parent / "static_src"
ID_RE = re.compile(r"^[a-z0-9_]+$")
MID_TIERS = (3, 4)
HIGH_TIERS = (5, 7)
MIN_MID = 200
MIN_HIGH = 400


def pair_key(a: str, b: str) -> str:
    return f"{a}|{b}" if a <= b else f"{b}|{a}"


def compute_tiers(basics: list[str], recipes: dict[str, str]) -> dict[str, int]:
    tiers = {b: 0 for b in basics}
    pairs = [(key.split("|"), res) for key, res in recipes.items()]
    changed = True
    while changed:
        changed = False
        for (a, b), res in pairs:
            if a in tiers and b in tiers:
                t = max(tiers[a], tiers[b]) + 1
                if res not in tiers or t < tiers[res]:
                    tiers[res] = t
                    changed = True
    return tiers


def load_theme(theme_dir: Path, skeleton: bool = False) -> dict:
    errors: list[str] = []
    meta = json.loads((theme_dir / "theme.json").read_text(encoding="utf-8"))
    cats = {c["id"] for c in meta["categories"]}
    items: dict[str, dict] = {}
    order: list[str] = []

    def add_item(it: dict, cat: str, src: str) -> None:
        iid = it.get("id", "")
        if not isinstance(iid, str) or not ID_RE.match(iid):
            errors.append(f"{src}: 不合法的 id {iid!r}")
            return
        if iid in items:
            errors.append(f"{src}: id 重複 {iid}（已在 {items[iid]['src']}）")
            return
        if not it.get("zh") or not it.get("ja"):
            errors.append(f"{src}: {iid} 缺少 zh 或 ja 名稱")
            return
        items[iid] = {"id": iid, "zh": it["zh"], "ja": it["ja"], "cat": cat, "src": src}
        order.append(iid)

    for b in meta["basics"]:
        add_item(b, "basic", "theme.json")
    for j in meta["junk"]:
        add_item(j, "junk", "theme.json")

    chunks = []
    for path in sorted(theme_dir.glob("*.json")):
        if path.name == "theme.json":
            continue
        chunk = json.loads(path.read_text(encoding="utf-8"))
        own = chunk.get("category")
        if own != "core" and own not in cats:
            errors.append(f"{path.name}: 未定義的分類 {own!r}")
            continue
        for it in chunk.get("items", []):
            cat = it.get("cat", own)
            if cat not in cats:
                errors.append(f"{path.name}: {it.get('id')} 的分類 {cat!r} 未定義")
                continue
            if own != "core" and cat != own:
                errors.append(f"{path.name}: {it.get('id')} 必須屬於分類 {own}")
                continue
            add_item(it, cat, path.name)
        chunks.append((path.name, own, chunk.get("recipes", [])))

    for lang in ("zh", "ja"):
        seen: dict[str, str] = {}
        for iid in order:
            name = items[iid][lang]
            if name in seen:
                errors.append(f"{items[iid]['src']}: {lang} 名稱「{name}」重複（{seen[name]} 與 {iid}）")
            else:
                seen[name] = iid

    recipes: dict[str, str] = {}
    recipe_src: dict[str, str] = {}
    for src, own, rows in chunks:
        for row in rows:
            if not (isinstance(row, list) and len(row) == 3):
                errors.append(f"{src}: 配方格式錯誤 {row!r}")
                continue
            a, b, r = row
            missing = [x for x in (a, b, r) if x not in items]
            if missing:
                errors.append(f"{src}: 配方 {row} 引用不存在的物體 {missing}")
                continue
            if items[r]["cat"] in ("basic", "junk"):
                errors.append(f"{src}: 配方 {row} 的結果不能是初始物體或廢料")
                continue
            if items[a]["cat"] == "junk" or items[b]["cat"] == "junk":
                errors.append(f"{src}: 配方 {row} 的材料不能是廢料")
                continue
            if own != "core":
                if items[r]["cat"] != own:
                    errors.append(f"{src}: 配方 {row} 的結果不屬於分類 {own}")
                    continue
                if own not in (items[a]["cat"], items[b]["cat"]):
                    errors.append(f"{src}: 配方 {row} 至少要有一個材料屬於分類 {own}")
                    continue
                foreign = [x for x in (a, b) if items[x]["src"] not in (src, "core.json", "theme.json")]
                if foreign:
                    errors.append(f"{src}: 配方 {row} 的材料 {foreign} 只能來自本檔、core.json 或初始物體")
                    continue
            key = pair_key(a, b)
            if key in recipes:
                errors.append(f"{src}: 組合 {key} 重複（已在 {recipe_src[key]} 定義為 {recipes[key]}）")
                continue
            recipes[key] = r
            recipe_src[key] = src

    basics = [b["id"] for b in meta["basics"]]
    tiers = compute_tiers(basics, recipes)
    for iid in order:
        it = items[iid]
        if it["cat"] == "junk":
            it["tier"] = 0
        elif iid in tiers:
            it["tier"] = tiers[iid]
        else:
            it["tier"] = None
            errors.append(f"{it['src']}: {iid}（{it['zh']}）無法從初始物體合成")

    normal = [items[i] for i in order if items[i]["cat"] not in ("basic", "junk")]
    hist = Counter(i["tier"] for i in normal if i["tier"] is not None)
    mid = sum(n for t, n in hist.items() if MID_TIERS[0] <= t <= MID_TIERS[1])
    high = sum(n for t, n in hist.items() if HIGH_TIERS[0] <= t <= HIGH_TIERS[1])
    if not skeleton:
        if len(normal) < meta.get("min_items", 0):
            errors.append(f"物體數 {len(normal)} 少於 {meta['min_items']}")
        if mid < meta.get("min_mid", MIN_MID):
            errors.append(f"階段 3〜4 的物體 {mid} 種，少於 {meta.get('min_mid', MIN_MID)}")
        if high < meta.get("min_high", MIN_HIGH):
            errors.append(f"階段 5〜7 的物體 {high} 種，少於 {meta.get('min_high', MIN_HIGH)}")

    per_file = Counter(i["src"] for i in normal)
    stats = {"items": len(normal), "recipes": len(recipes), "mid": mid, "high": high,
             "tiers": dict(sorted(hist.items())), "per_file": dict(sorted(per_file.items()))}
    return {"meta": meta, "items": [items[i] for i in order], "recipes": recipes, "errors": errors, "stats": stats}


def render_js(theme: dict) -> str:
    meta = theme["meta"]
    data = {
        "id": meta["id"],
        "name": meta["name"],
        "basics": [b["id"] for b in meta["basics"]],
        "junk": [j["id"] for j in meta["junk"]],
        "categories": meta["categories"],
        "items": [[i["id"], i["zh"], i["ja"], i["cat"], i["tier"]] for i in theme["items"]],
        "recipes": dict(sorted(theme["recipes"].items())),
    }
    body = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    return (
        "// 由 tools/gousei_data/build.py 產生，請勿手動修改；原始資料在 tools/gousei_data/<theme>/。\n"
        f"(window.PriTestGouseiData = window.PriTestGouseiData || {{}})[{json.dumps(meta['id'])}] = {body};\n"
    )


def main(argv: list[str]) -> int:
    check = "--check" in argv
    skeleton = "--skeleton" in argv
    names = [a for a in argv if not a.startswith("--")]
    dirs = [ROOT / n for n in names] if names else sorted(p.parent for p in ROOT.glob("*/theme.json"))
    failed = False
    for d in dirs:
        theme = load_theme(d, skeleton=skeleton)
        print(f"[{d.name}] {json.dumps(theme['stats'], ensure_ascii=False)}")
        if theme["errors"]:
            failed = True
            print(f"[{d.name}] {len(theme['errors'])} 個錯誤：")
            for e in theme["errors"][:300]:
                print("  " + e)
            continue
        if not check:
            out = OUT_DIR / f"gousei_data_{theme['meta']['id']}.js"
            out.write_text(render_js(theme), encoding="utf-8")
            print(f"[{d.name}] 已輸出 {out}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
