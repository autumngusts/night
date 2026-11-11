"""快門之後（shutter）用的去背頭像產生器。

images/jikan/ 的頭像都是白底。拍攝小遊戲要把她放進場景（海邊、暗房……），白底會變成一圈白光，
所以從四邊往內 flood fill「接近白色、且和邊緣相連」的像素，轉成透明，再把邊緣羽化一點。
只處理 g_ 系列（排除名單與 n_ 系列不輸出）。輸出到 static_src/images/shutter/，檔名相同。

執行：py -3 tools/shutter_cutout.py
"""

from __future__ import annotations

from collections import deque
from pathlib import Path

from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "static_src" / "images" / "jikan"
OUT = ROOT / "static_src" / "images" / "shutter"
EXCLUDE = {6, 10, 17, 18, 19, 26, 29, 32}
THRESH = 232  # RGB 都高於這個值＝背景候選


def cutout(path: Path) -> Image.Image:
    im = Image.open(path).convert("RGBA")
    w, h = im.size
    px = im.load()
    bg = [[False] * w for _ in range(h)]
    q: deque[tuple[int, int]] = deque()

    def is_white(x: int, y: int) -> bool:
        r, g, b, _ = px[x, y]
        return r >= THRESH and g >= THRESH and b >= THRESH

    for x in range(w):
        for y in (0, h - 1):
            if is_white(x, y):
                q.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            if is_white(x, y):
                q.append((x, y))
    while q:
        x, y = q.popleft()
        if bg[y][x]:
            continue
        bg[y][x] = True
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h and not bg[ny][nx] and is_white(nx, ny):
                q.append((nx, ny))
    mask = Image.new("L", (w, h), 255)
    mp = mask.load()
    for y in range(h):
        for x in range(w):
            if bg[y][x]:
                mp[x, y] = 0
    # 羽化：先縮一圈再模糊，去掉白色的毛邊
    mask = mask.filter(ImageFilter.MinFilter(5)).filter(ImageFilter.GaussianBlur(1.4))
    im.putalpha(mask)
    return im


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    n = 0
    for i in range(143):
        if i in EXCLUDE:
            continue
        name = f"g_{i:03d}.webp"
        cutout(SRC / name).save(OUT / name, "WEBP", quality=82, method=6)
        n += 1
    print(f"cutout {n} images -> {OUT}")


if __name__ == "__main__":
    main()
