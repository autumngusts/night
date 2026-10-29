"""把 static_src/style.css 裡各小遊戲的樣式搬到 static_src/css/<遊戲>.css（使用者指定 2026-10-26：
「盡量每個新遊戲都放置不同 js、css，這樣分別更新不會互相影響到」）。

一次性的搬移工具，保留在 repo 以便日後再有遊戲樣式誤放進 style.css 時重跑（重跑是冪等的：
已經搬走的規則不在 style.css 裡，就只會搬新混進去的）。

用法：py -3 tools/split_css.py [--check]
  --check：只檢查 style.css 裡還有沒有遊戲前綴的規則，有就列出並以 1 結束（不改檔）。

判斷方式：每條規則（含 @media／@supports 裡的每條）看選擇器的前綴（class 或 id，例如 .kt-、#gs-）；
@keyframes 看名稱前綴。註解跟著下一條規則走。一條規則的選擇器若同時屬於兩個以上的遊戲、
或混了遊戲與共用的選擇器，就留在 style.css 並列出來，人工處理。
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STYLE = ROOT / "static_src" / "style.css"
OUT_DIR = ROOT / "static_src" / "css"

# 遊戲 → 選擇器前綴（class／id／keyframes 名稱都用同一組）
GAMES: dict[str, tuple[str, ...]] = {
    "yellow": ("yc-",),
    "katana": ("kt-",),
    "fist": ("fe-", "ff-", "fr-"),
    "dejavu": ("dv-",),
    "gousei": ("gs-", "gsa-"),
    "toushou": ("ts-",),
    "utau": ("ut-",),
    "starv": ("sv-",),
    "saigo": ("sg-",),
}

TOKEN_RE = re.compile(r"[.#]([a-zA-Z][\w-]*)")


def game_of_name(name: str) -> str | None:
    for game, prefixes in GAMES.items():
        if any(name.startswith(p) for p in prefixes):
            return game
    return None


def parse_blocks(text: str) -> list[tuple[str, str, str]]:
    """把 CSS 切成頂層區塊：(前置註解與空白, 開頭（選擇器或 @規則）, 完整區塊文字)。"""
    blocks: list[tuple[str, str, str]] = []
    i, n = 0, len(text)
    pending = ""
    while i < n:
        # 收集空白與註解
        j = i
        while j < n:
            if text[j].isspace():
                j += 1
            elif text.startswith("/*", j):
                e = text.index("*/", j) + 2
                j = e
            else:
                break
        pending += text[i:j]
        i = j
        if i >= n:
            break
        # 一個區塊：讀到對應的 } 為止（或 @import 之類以 ; 結尾）
        start = i
        depth = 0
        while i < n:
            c = text[i]
            if text.startswith("/*", i):
                i = text.index("*/", i) + 2
                continue
            if c in "\"'":
                q = c
                i += 1
                while i < n and text[i] != q:
                    i += 2 if text[i] == "\\" else 1
                i += 1
                continue
            if c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    i += 1
                    break
            elif c == ";" and depth == 0:
                i += 1
                break
            i += 1
        block = text[start:i]
        head = block.split("{", 1)[0].strip()
        blocks.append((pending, head, block))
        pending = ""
    if pending.strip():
        blocks.append((pending, "", ""))
    return blocks


def classify_selector(head: str) -> str | None:
    """回傳遊戲名、"shared"，或 "mixed"（選擇器混了不同歸屬）。"""
    owners: set[str] = set()
    for part in head.split(","):
        names = TOKEN_RE.findall(part)
        games = {g for g in (game_of_name(x) for x in names) if g}
        if len(games) > 1:
            return "mixed"
        owners.add(games.pop() if games else "shared")
    if len(owners) == 1:
        return owners.pop()
    return "mixed"


def classify_block(head: str) -> str:
    if head.startswith("@keyframes") or head.startswith("@-webkit-keyframes"):
        name = head.split(None, 1)[1].strip() if " " in head else ""
        return game_of_name(name) or "shared"
    return classify_selector(head) or "shared"


def split(text: str):
    """回傳 (留在 style.css 的文字, {遊戲: 文字}, 混合規則清單)。"""
    shared: list[str] = []
    games: dict[str, list[str]] = {g: [] for g in GAMES}
    mixed: list[str] = []
    for pre, head, block in parse_blocks(text):
        if not block:
            shared.append(pre)
            continue
        if head.startswith("@media") or head.startswith("@supports"):
            inner = block[block.index("{") + 1: block.rindex("}")]
            parts: dict[str, list[str]] = {}
            for ipre, ihead, iblock in parse_blocks(inner):
                if not iblock:
                    parts.setdefault("shared", []).append(ipre)
                    continue
                owner = classify_block(ihead)
                if owner == "mixed":
                    mixed.append(f"{head} → {ihead[:80]}")
                    owner = "shared"
                parts.setdefault(owner, []).append(ipre + iblock)
            for owner, chunks in parts.items():
                body = "".join(chunks)
                if not body.strip():
                    continue
                wrapped = f"{head} {{{body}\n}}"
                if owner == "shared":
                    shared.append(pre + wrapped)
                else:
                    games[owner].append(pre + wrapped)
                pre = "\n"  # 前置註解只跟第一份走
            continue
        owner = classify_block(head)
        if owner == "mixed":
            mixed.append(head[:100])
            owner = "shared"
        (shared if owner == "shared" else games[owner]).append(pre + block)
    return "".join(shared), {g: "".join(v) for g, v in games.items()}, mixed


def main() -> int:
    text = STYLE.read_text(encoding="utf-8")
    shared, per_game, mixed = split(text)
    moved = {g: t for g, t in per_game.items() if t.strip()}
    if "--check" in sys.argv:
        for g, t in moved.items():
            print(f"style.css 裡還有 {g} 的樣式（{t.count('{')} 個區塊）")
        for m in mixed:
            print("混合選擇器：", m)
        return 1 if moved else 0
    OUT_DIR.mkdir(exist_ok=True)
    for g, t in moved.items():
        path = OUT_DIR / f"{g}.css"
        header = f"/* {g} 的樣式（由 tools/split_css.py 從 style.css 搬出；之後直接改這個檔） */\n"
        old = path.read_text(encoding="utf-8") if path.exists() else header
        path.write_text(old.rstrip("\n") + "\n" + t.strip("\n") + "\n", encoding="utf-8")
        print(f"{g}: {t.count('{')} 個區塊 → {path.relative_to(ROOT)}")
    STYLE.write_text(re.sub(r"\n{3,}", "\n\n", shared).rstrip() + "\n", encoding="utf-8")
    for m in mixed:
        print("混合選擇器（留在 style.css）：", m)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
