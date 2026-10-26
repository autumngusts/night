# ============================================================================
# katana 美術素材匯入（2026-10-25）：把生成工具給的原圖整理成 docs/katana_art_spec.md 的規格位置。
#   俯視圖 → static_src/katana_art/top/<id>.png   768×768，鍔（握持點）在正中央、柄的中線水平、刀尖在中心右方 tip×768
#   側視圖 → static_src/katana_art/side/<id>.png  裁到刀的範圍、寬 1024；印出鍔的位置比例，填進 katana.js 的 ART_SIDE
# 原圖另存到 photo/tmp/katana/<id>_upon.png、<id>_side.png。
# 定位方法：
#   * 生成圖外圍常有一層 alpha < 32 的淡霧，先清成全透明。
#   * 鍔＝不透明高度最大的那幾欄（高度 ≥ 最大值 90% 的欄取中心）。沒有鍔的刀（例如只有鎺）就落在鎺上。
#   * 水平：用柄（刀柄頭到鍔之間）各欄不透明範圍的中點擬合直線，以鍔為中心轉正。
#     不用刀尖定水平，因為有反りの刀刀尖本來就不在中線上。
# 用法：py -3 tools/katana_art/import_art.py <id> --top 原圖.png --side 原圖.webp [--tip 0.45] [--flip-top] [--flip-side]
#   長柄兵器 --tip 0.38；原圖刀尖朝左時加 --flip-*；
#   刀身外有一圈白色光暈（去背殘留的柔和陰影）時加 --halo 90（alpha 低於 90 的清掉，其餘拉伸）
# 檢查圖：--preview 輸出.png（深色底、十字線、刀尖圓，俯視與側視並排）
# ============================================================================
import argparse
import math
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
TOP_SIZE = 768
SIDE_WIDTH = 1024


HALO = 32


def load_clean(path, flip):
    im = Image.open(path).convert("RGBA")
    if flip:
        im = im.transpose(Image.FLIP_LEFT_RIGHT)
    a = np.array(im)
    if HALO <= 32:
        a[a[..., 3] < 32, 3] = 0
    else:
        # 去背殘留的白色光暈：alpha < HALO 清掉，其餘重新拉伸到 0〜255（保留邊緣的抗鋸齒）
        al = a[..., 3].astype(float)
        a[..., 3] = np.clip((al - HALO) / (255 - HALO) * 255, 0, 255).astype(np.uint8)
    return Image.fromarray(a)


def guard_column(op):
    h = op.sum(0)
    cols = np.where(h >= 0.9 * h.max())[0]
    gx = (cols[0] + cols[-1]) / 2.0
    ys = np.where(op[:, int(round(gx))])[0]
    return gx, (ys[0] + ys[-1]) / 2.0


def hilt_angle(op, gx):
    xs = np.where(op.any(0))[0]
    left = xs[0]
    # 柄頭與鍔附近的金具會讓中點跳動，只取中間 15%〜85%
    x0, x1 = int(left + (gx - left) * 0.15), int(left + (gx - left) * 0.85)
    px, py = [], []
    for x in range(x0, x1):
        ys = np.where(op[:, x])[0]
        if len(ys):
            px.append(x)
            py.append((ys[0] + ys[-1]) / 2.0)
    if len(px) < 10:
        return 0.0
    k = np.polyfit(px, py, 1)[0]
    return math.degrees(math.atan(k))


def do_top(src, out, tip, flip):
    im = load_clean(src, flip)
    op = np.array(im)[..., 3] >= 128
    gx, gy = guard_column(op)
    ang = hilt_angle(op, gx)
    rot = im.rotate(ang, resample=Image.BICUBIC, center=(gx, gy))
    op2 = np.array(rot)[..., 3] >= 128
    tip_x = np.where(op2.any(0))[0][-1]
    s = tip * TOP_SIZE / (tip_x - gx)
    big = rot.resize((max(1, round(rot.width * s)), max(1, round(rot.height * s))), Image.LANCZOS)
    canvas = Image.new("RGBA", (TOP_SIZE, TOP_SIZE), (0, 0, 0, 0))
    canvas.paste(big, (round(TOP_SIZE / 2 - gx * s), round(TOP_SIZE / 2 - gy * s)), big)
    canvas.save(out, optimize=True)
    bb = canvas.getchannel("A").point(lambda v: 255 if v >= 128 else 0).getbbox()
    print("top: guard (%.0f, %.0f) hilt tilt %.2f° scale %.3f → bbox %s" % (gx, gy, ang, s, bb))
    if bb[0] < 0 or bb[2] > TOP_SIZE - 1:
        print("  警告：柄超出畫面（柄比刀身長很多？）")
    return canvas


def do_side(src, out, flip):
    im = load_clean(src, flip)
    bb = im.getchannel("A").point(lambda v: 255 if v >= 32 else 0).getbbox()
    c = im.crop(bb)
    h = round(c.height * SIDE_WIDTH / c.width)
    c = c.resize((SIDE_WIDTH, h), Image.LANCZOS)
    c.save(out, optimize=True)
    gx, _ = guard_column(np.array(c)[..., 3] >= 128)
    ratio = gx / SIDE_WIDTH
    print("side: %dx%d guard ratio %.3f （katana.js ART_SIDE 填這個值）" % (SIDE_WIDTH, h, ratio))
    return c, ratio


def preview(path, top, side, tip):
    W = TOP_SIZE
    sv = side.resize((W, max(1, round(side.height * W / side.width))))
    bg = Image.new("RGBA", (W, W + sv.height + 20), (40, 44, 52, 255))
    bg.paste(top, (0, 0), top)
    d = ImageDraw.Draw(bg)
    d.line([(W / 2, 0), (W / 2, W)], fill=(255, 80, 80, 255))
    d.line([(0, W / 2), (W, W / 2)], fill=(255, 80, 80, 255))
    r = tip * W
    d.ellipse([W / 2 - r, W / 2 - r, W / 2 + r, W / 2 + r], outline=(120, 200, 255, 255))
    bg.paste(sv, (0, W + 20), sv)
    bg.save(path)


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")  # Windows 主控台預設 cp932／cp950
    ap = argparse.ArgumentParser()
    ap.add_argument("id")
    ap.add_argument("--top")
    ap.add_argument("--side")
    ap.add_argument("--tip", type=float, default=0.45)
    ap.add_argument("--flip-top", action="store_true")
    ap.add_argument("--flip-side", action="store_true")
    ap.add_argument("--preview")
    ap.add_argument("--halo", type=int, default=32)
    a = ap.parse_args()
    global HALO
    HALO = a.halo
    raw = os.path.join(ROOT, "photo", "tmp", "katana")
    os.makedirs(raw, exist_ok=True)
    top = side = None
    if a.top:
        Image.open(a.top).save(os.path.join(raw, a.id + "_upon.png"))
        top = do_top(a.top, os.path.join(ROOT, "static_src", "katana_art", "top", a.id + ".png"), a.tip, a.flip_top)
    if a.side:
        Image.open(a.side).save(os.path.join(raw, a.id + "_side.png"))
        side, _ = do_side(a.side, os.path.join(ROOT, "static_src", "katana_art", "side", a.id + ".png"), a.flip_side)
    if a.preview and top is not None and side is not None:
        preview(a.preview, top, side, a.tip)
    if not a.top and not a.side:
        sys.exit("需要 --top 或 --side")


if __name__ == "__main__":
    main()
