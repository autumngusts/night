"""イヌスノー的雪場資料建置工具（docs/inusnow_design.md §2）。

用法：
  py -3 tools/inusnow_data/fetch.py --all              # 8 個雪場（resorts.py 的 RESORTS）
  py -3 tools/inusnow_data/fetch.py happo zao          # 指定雪場
  py -3 tools/inusnow_data/fetch.py --fallback appi    # 替補雪場（FALLBACKS）

流程：Overpass 查雪道與纜車 → 合併同名、首尾相接的雪道 → 依雪道範圍外擴 150 m 決定格網
→ 下載國土地理院 DEM5A（z15，缺值用 DEM10B z14 補）→ 重取樣成 8 m 格網 → 選大曲道雪道 → 輸出 JSON。

只用標準函式庫。下載結果快取在 tools/inusnow_data/cache/（不提交）。
請求帶通用 User-Agent，不含個人資訊；Overpass 每次查詢間隔 5 秒以上，標高圖每張間隔 0.2 秒以上。
"""

from __future__ import annotations

import argparse
import base64
import json
import math
import struct
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
from resorts import FALLBACKS, RESORTS  # noqa: E402

CACHE = ROOT / "cache"
OUT_DIR = ROOT.parent.parent / "static_src" / "inusnow" / "data"
UA = "PriTest-build-tool/1.0"
OVERPASS = "https://overpass-api.de/api/interpreter"
DEM5A = "https://cyberjapandata.gsi.go.jp/xyz/dem5a_png/{z}/{x}/{y}.png"
DEM10B = "https://cyberjapandata.gsi.go.jp/xyz/dem_png/{z}/{x}/{y}.png"

CELL = float(__import__("os").environ.get("INU_CELL", "10"))   # 格網間距（公尺，暫定）
SCALE = float(__import__("os").environ.get("INU_SCALE", "0.1"))  # 高度量化（公尺）
MARGIN = 150.0        # 雪道外擴範圍（公尺）
M_PER_DEG_LAT = 110540.0
M_PER_DEG_LON_EQ = 111320.0
JOIN_DIST = 20.0      # 首尾距離小於這個值就視為相接（公尺）
GS_MIN_LEN = 600.0
GS_MIN_DROP = 150.0
GS_WIN_MAX = 1300.0   # 大曲道的最長長度（m）
GS_START_TAN = 0.105  # 起點 60 m 平均坡度 ≥ 6°
GS_MIN_TAN = 0.044    # 任何 80 m 區間平均坡度 ≥ 2.5°
DEFAULT_WIDTH = {"novice": 45.0, "easy": 40.0, "intermediate": 35.0, "advanced": 30.0, "expert": 25.0, "freeride": 25.0}
DIFF_RANK = {"novice": 0, "easy": 1, "intermediate": 2, "advanced": 3, "expert": 4, "freeride": 4}

_last_overpass = 0.0
_last_tile = 0.0


# ---------------------------------------------------------------- 下載
def http_get(url: str, data: bytes | None = None) -> bytes | None:
    req = urllib.request.Request(url, data=data, headers={"User-Agent": UA})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=120) as res:
                return res.read()
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            if e.code in (429, 502, 503, 504) and attempt < 3:
                time.sleep(10 * (attempt + 1))
                continue
            raise
        except urllib.error.URLError:
            if attempt < 3:
                time.sleep(5 * (attempt + 1))
                continue
            raise
    return None


def overpass(resort: dict) -> dict:
    global _last_overpass
    path = CACHE / f"{resort['id']}_osm.json"
    if path.is_file():
        return json.loads(path.read_text(encoding="utf-8"))
    s, w, n, e = resort["bbox"]
    q = (
        f"[out:json][timeout:120];("
        f'way["piste:type"="downhill"]({s},{w},{n},{e});'
        f'way["aerialway"]({s},{w},{n},{e});'
        f");out geom;"
    )
    wait = 5.0 - (time.time() - _last_overpass)
    if wait > 0:
        time.sleep(wait)
    raw = http_get(OVERPASS, urllib.parse.urlencode({"data": q}).encode())
    _last_overpass = time.time()
    if raw is None:
        raise RuntimeError("overpass returned nothing")
    path.write_bytes(raw)
    return json.loads(raw.decode("utf-8"))


def tile(kind: str, z: int, x: int, y: int) -> bytes | None:
    global _last_tile
    path = CACHE / f"{kind}_{z}_{x}_{y}.png"
    miss = CACHE / f"{kind}_{z}_{x}_{y}.404"
    if path.is_file():
        return path.read_bytes()
    if miss.is_file():
        return None
    wait = 0.2 - (time.time() - _last_tile)
    if wait > 0:
        time.sleep(wait)
    url = (DEM5A if kind == "dem5a" else DEM10B).format(z=z, x=x, y=y)
    raw = http_get(url)
    _last_tile = time.time()
    if raw is None:
        miss.write_bytes(b"")
        return None
    path.write_bytes(raw)
    return raw


# ---------------------------------------------------------------- PNG 解碼（不依賴 Pillow）
def png_rgb(raw: bytes) -> tuple[int, int, list[tuple[int, int, int]]]:
    assert raw[:8] == b"\x89PNG\r\n\x1a\n"
    pos = 8
    idat = b""
    plte = None
    w = h = depth = ctype = 0
    while pos < len(raw):
        ln = struct.unpack(">I", raw[pos:pos + 4])[0]
        kind = raw[pos + 4:pos + 8]
        body = raw[pos + 8:pos + 8 + ln]
        pos += 12 + ln
        if kind == b"IHDR":
            w, h, depth, ctype = struct.unpack(">IIBB", body[:10])
        elif kind == b"PLTE":
            plte = [tuple(body[i:i + 3]) for i in range(0, len(body), 3)]
        elif kind == b"IDAT":
            idat += body
        elif kind == b"IEND":
            break
    assert depth == 8, f"unsupported bit depth {depth}"
    bpp = {2: 3, 6: 4, 3: 1, 0: 1, 4: 2}[ctype]
    data = zlib.decompress(idat)
    stride = w * bpp
    out = bytearray(h * stride)
    prev = bytearray(stride)
    p = 0
    for row in range(h):
        f = data[p]
        line = bytearray(data[p + 1:p + 1 + stride])
        p += 1 + stride
        for i in range(stride):
            a = line[i - bpp] if i >= bpp else 0
            b = prev[i]
            c = prev[i - bpp] if i >= bpp else 0
            if f == 1:
                line[i] = (line[i] + a) & 255
            elif f == 2:
                line[i] = (line[i] + b) & 255
            elif f == 3:
                line[i] = (line[i] + ((a + b) >> 1)) & 255
            elif f == 4:
                pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
                pr = a if pa <= pb and pa <= pc else (b if pb <= pc else c)
                line[i] = (line[i] + pr) & 255
        out[row * stride:(row + 1) * stride] = line
        prev = line
    px: list[tuple[int, int, int]] = []
    for i in range(w * h):
        if ctype == 3:
            px.append(plte[out[i]])  # type: ignore[index]
        else:
            px.append((out[i * bpp], out[i * bpp + 1], out[i * bpp + 2]))
    return w, h, px


def dem_value(rgb: tuple[int, int, int]) -> float | None:
    v = (rgb[0] << 16) + (rgb[1] << 8) + rgb[2]
    if v == 1 << 23:
        return None
    if v > 1 << 23:
        v -= 1 << 24
    return v * 0.01


class DemSource:
    """以 Web Mercator 的像素座標取高度；同一張圖只解碼一次。"""

    def __init__(self, kind: str, z: int):
        self.kind, self.z = kind, z
        self.cache: dict[tuple[int, int], list[float | None] | None] = {}

    def _tile(self, tx: int, ty: int) -> list[float | None] | None:
        key = (tx, ty)
        if key not in self.cache:
            raw = tile(self.kind, self.z, tx, ty)
            if raw is None:
                self.cache[key] = None
            else:
                w, h, px = png_rgb(raw)
                assert w == 256 and h == 256
                self.cache[key] = [dem_value(c) for c in px]
        return self.cache[key]

    def pixel(self, lat: float, lon: float) -> tuple[float, float]:
        n = 256 * (1 << self.z)
        x = (lon + 180.0) / 360.0 * n
        s = math.sin(math.radians(lat))
        y = (0.5 - math.log((1 + s) / (1 - s)) / (4 * math.pi)) * n
        return x, y

    def at_px(self, px: int, py: int) -> float | None:
        t = self._tile(px >> 8, py >> 8)
        if t is None:
            return None
        return t[(py & 255) * 256 + (px & 255)]

    def height(self, lat: float, lon: float) -> float | None:
        x, y = self.pixel(lat, lon)
        x -= 0.5
        y -= 0.5
        x0, y0 = math.floor(x), math.floor(y)
        fx, fy = x - x0, y - y0
        vals = [self.at_px(x0, y0), self.at_px(x0 + 1, y0), self.at_px(x0, y0 + 1), self.at_px(x0 + 1, y0 + 1)]
        if any(v is None for v in vals):
            good = [v for v in vals if v is not None]
            return sum(good) / len(good) if good else None
        a, b, c, d = vals  # type: ignore[misc]
        return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy


# ---------------------------------------------------------------- 雪道整理
class Proj:
    """西北角為原點：x＝往東（公尺）、z＝往南（公尺）。設計 §2.3 的等距圓柱近似。"""

    def __init__(self, lat0: float, lon0: float):
        self.lat0, self.lon0 = lat0, lon0
        self.kx = M_PER_DEG_LON_EQ * math.cos(math.radians(lat0))

    def xz(self, lat: float, lon: float) -> tuple[float, float]:
        return (lon - self.lon0) * self.kx, (self.lat0 - lat) * M_PER_DEG_LAT

    def latlon(self, x: float, z: float) -> tuple[float, float]:
        return self.lat0 - z / M_PER_DEG_LAT, self.lon0 + x / self.kx


def dist(a, b) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


def polylen(pts) -> float:
    return sum(dist(pts[i], pts[i + 1]) for i in range(len(pts) - 1))


def chain_ways(ways: list[dict]) -> list[dict]:
    """同名的線狀雪道，首尾相接的串成一條（方向不一致時反轉）。"""
    out: list[dict] = []
    by_name: dict[str, list[dict]] = {}
    for w in ways:
        by_name.setdefault(w["name"] or f"#{w['osm']}", []).append(w)
    for name, group in by_name.items():
        rest = [dict(w) for w in group]
        while rest:
            cur = rest.pop(0)
            pts = list(cur["ll"])
            ids = [cur["osm"]]
            diffs = [cur["diff"]]
            changed = True
            while changed:
                changed = False
                for i, w in enumerate(rest):
                    q = w["ll"]
                    if dist(pts[-1], q[0]) < JOIN_DIST:
                        pts += q[1:]
                    elif dist(pts[-1], q[-1]) < JOIN_DIST:
                        pts += list(reversed(q))[1:]
                    elif dist(pts[0], q[-1]) < JOIN_DIST:
                        pts = q[:-1] + pts
                    elif dist(pts[0], q[0]) < JOIN_DIST:
                        pts = list(reversed(q))[:-1] + pts
                    else:
                        continue
                    ids.append(w["osm"])
                    diffs.append(w["diff"])
                    rest.pop(i)
                    changed = True
                    break
            diff = max(diffs, key=lambda d: DIFF_RANK.get(d, 2))
            out.append({"name": cur["name"], "osm": ids, "diff": diff, "ll": pts, "nameZh": cur.get("nameZh"), "nameEn": cur.get("nameEn")})
    return out


COARSE = 4           # 背景粗格網＝CELL×4（暫定 40 m）


def proj_pts(proj: "Proj", ll) -> list[tuple[float, float]]:
    return [proj.xz(a, b) for a, b in ll]


def corridor_mask(gw: int, gh: int, polylines) -> list[bool]:
    """雪道線條經過的格子標 True，再往外擴 MARGIN（BFS）。"""
    near = [False] * (gw * gh)
    for pts in polylines:
        for k in range(len(pts) - 1):
            (x0, z0), (x1, z1) = pts[k], pts[k + 1]
            n = max(1, int(math.hypot(x1 - x0, z1 - z0) / (CELL * 0.5)))
            for t in range(n + 1):
                i = int(round((x0 + (x1 - x0) * t / n) / CELL))
                j = int(round((z0 + (z1 - z0) * t / n) / CELL))
                if 0 <= i < gw and 0 <= j < gh:
                    near[j * gw + i] = True
    steps = int(math.ceil(MARGIN / CELL))
    frontier = [k for k, v in enumerate(near) if v]
    for _ in range(steps):
        nxt = []
        for k in frontier:
            i, j = k % gw, k // gw
            for ii, jj in ((i - 1, j), (i + 1, j), (i, j - 1), (i, j + 1)):
                if 0 <= ii < gw and 0 <= jj < gh and not near[jj * gw + ii]:
                    near[jj * gw + ii] = True
                    nxt.append(jj * gw + ii)
        frontier = nxt
    return near


def coarsen_outside(hs: list[float], gw: int, gh: int, near: list[bool]) -> list[float]:
    out = list(hs)
    for j in range(gh):
        for i in range(gw):
            k = j * gw + i
            if near[k]:
                continue
            i0 = min((i // COARSE) * COARSE, gw - 1)
            j0 = min((j // COARSE) * COARSE, gh - 1)
            i1 = min(i0 + COARSE, gw - 1)
            j1 = min(j0 + COARSE, gh - 1)
            tx = (i - i0) / COARSE
            tz = (j - j0) / COARSE
            a, b = hs[j0 * gw + i0], hs[j0 * gw + i1]
            c, d = hs[j1 * gw + i0], hs[j1 * gw + i1]
            out[k] = (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz
    return out


def build(resort: dict) -> dict:
    CACHE.mkdir(exist_ok=True)
    osm = overpass(resort)
    lines: list[dict] = []
    areas: list[dict] = []
    lifts: list[dict] = []
    for el in osm.get("elements", []):
        if el.get("type") != "way" or "geometry" not in el:
            continue
        tags = el.get("tags", {})
        ll = [(g["lat"], g["lon"]) for g in el["geometry"]]
        if "aerialway" in tags:
            if tags["aerialway"] in ("cable_car", "gondola", "mixed_lift", "chair_lift", "drag_lift", "t-bar", "j-bar", "platter", "rope_tow", "magic_carpet"):
                lifts.append({"name": tags.get("name", ""), "ll": ll})
            continue
        closed = len(ll) > 3 and ll[0] == ll[-1]
        item = {
            "osm": el["id"],
            "name": tags.get("name", "") or tags.get("piste:name", ""),
            "nameZh": tags.get("name:zh"),
            "nameEn": tags.get("name:en"),
            "diff": tags.get("piste:difficulty", "intermediate"),
            "ll": ll,
        }
        if closed or tags.get("area") == "yes":
            areas.append(item)
        else:
            lines.append(item)
    if not lines:
        raise RuntimeError(f"{resort['id']}: OSM 沒有線狀雪道")

    # 範圍與投影
    all_ll = [p for w in lines + areas for p in w["ll"]]
    lat_n = max(p[0] for p in all_ll)
    lat_s = min(p[0] for p in all_ll)
    lon_w = min(p[1] for p in all_ll)
    lon_e = max(p[1] for p in all_ll)
    pad_lat = MARGIN / M_PER_DEG_LAT
    pad_lon = MARGIN / (M_PER_DEG_LON_EQ * math.cos(math.radians(lat_n)))
    proj = Proj(lat_n + pad_lat, lon_w - pad_lon)
    max_x, max_z = proj.xz(lat_s - pad_lat, lon_e + pad_lon)
    gw = int(math.ceil(max_x / CELL)) + 1
    gh = int(math.ceil(max_z / CELL)) + 1

    # 標高
    dem5 = DemSource("dem5a", 15)
    dem10 = DemSource("dem10b", 14)
    heights: list[float | None] = []
    miss5 = 0
    for j in range(gh):
        for i in range(gw):
            lat, lon = proj.latlon(i * CELL, j * CELL)
            v = dem5.height(lat, lon)
            if v is None:
                miss5 += 1
                v = dem10.height(lat, lon)
            heights.append(v)
        if j % 50 == 0:
            print(f"  {resort['id']}: 格網 {j}/{gh}", flush=True)
    # 還缺的用鄰近平均補（最多 20 輪）
    for _ in range(20):
        holes = [k for k, v in enumerate(heights) if v is None]
        if not holes:
            break
        for k in holes:
            i, j = k % gw, k // gw
            nb = [heights[jj * gw + ii] for ii, jj in ((i - 1, j), (i + 1, j), (i, j - 1), (i, j + 1)) if 0 <= ii < gw and 0 <= jj < gh]
            nb = [v for v in nb if v is not None]
            if nb:
                heights[k] = sum(nb) / len(nb)
    if any(v is None for v in heights):
        raise RuntimeError(f"{resort['id']}: 標高資料不足")
    hs = [float(v) for v in heights]  # type: ignore[arg-type]
    base = math.floor(min(hs))

    # 雪道兩側 MARGIN 以內保留原精度；外面只當背景，改成 COARSE 倍間距的粗格網雙線性內插（檔案小很多）
    near = corridor_mask(gw, gh, [proj_pts(proj, w["ll"]) for w in lines + areas])
    hs = coarsen_outside(hs, gw, gh, near)

    def h_at(x: float, z: float) -> float:
        fx, fz = x / CELL, z / CELL
        i0 = max(0, min(gw - 2, int(math.floor(fx))))
        j0 = max(0, min(gh - 2, int(math.floor(fz))))
        tx, tz = fx - i0, fz - j0
        a, b = hs[j0 * gw + i0], hs[j0 * gw + i0 + 1]
        c, d = hs[(j0 + 1) * gw + i0], hs[(j0 + 1) * gw + i0 + 1]
        return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz

    # 格網編碼（設計 §2.3）：q＝round((h−base)÷SCALE) 的整數；用左、上、左上三格做二維預測
    # （pred＝左＋上−左上；第一列只用左、第一行只用上），只存誤差，Int16LE 後 deflate、base64
    q = [int(round((v - base) / SCALE)) for v in hs]
    resid: list[int] = []
    for j in range(gh):
        for i in range(gw):
            k = j * gw + i
            if i == 0 and j == 0:
                pred = 0
            elif j == 0:
                pred = q[k - 1]
            elif i == 0:
                pred = q[k - gw]
            else:
                pred = q[k - 1] + q[k - gw] - q[k - gw - 1]
            resid.append(q[k] - pred)
    packed = struct.pack(f"<{len(resid)}h", *resid)
    grid_b64 = base64.b64encode(zlib.compress(packed, 9)).decode("ascii")

    # 雪道（局部座標，方向一律由高往低）
    def to_xz(ll):
        return [proj.xz(a, b) for a, b in ll]

    chains = chain_ways(lines)
    pistes = []
    for n, c in enumerate(chains):
        pts = to_xz(c["ll"])
        if len(pts) < 2:
            continue
        if h_at(*pts[0]) < h_at(*pts[-1]):
            pts.reverse()
        ln = polylen(pts)
        pistes.append({
            "id": f"p{n}",
            "osm": c["osm"],
            "name": {k: v for k, v in (("ja", c["name"]), ("zh", c.get("nameZh")), ("en", c.get("nameEn"))) if v},
            "diff": c["diff"],
            "width": DEFAULT_WIDTH.get(c["diff"], 35.0),
            "len": round(ln, 1),
            "drop": round(h_at(*pts[0]) - h_at(*pts[-1]), 1),
            "pts": [[round(x, 1), round(z, 1)] for x, z in pts],
        })
    area_out = [{"osm": a["osm"], "diff": a["diff"], "pts": [[round(x, 1), round(z, 1)] for x, z in to_xz(a["ll"])]} for a in areas]
    lift_out = [{"name": l["name"], "pts": [[round(x, 1), round(z, 1)] for x, z in to_xz(l["ll"])]} for l in lifts]

    # 大曲道雪道：每條候選雪道找「落差最大、坡度連續」的一段（設計 §2.2）
    def resample(pts, step=10.0):
        out = [tuple(pts[0])]
        acc = 0.0
        for i in range(1, len(pts)):
            a, b = pts[i - 1], pts[i]
            seg = dist(a, b)
            while acc + seg >= step:
                t = (step - acc) / seg
                a = (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
                out.append(a)
                seg = dist(a, b)
                acc = 0.0
            acc += seg
        return out

    def best_window(p):
        rs = resample(p["pts"])
        hh = [h_at(x, z) for x, z in rs]
        n = len(hh)
        best = None
        lo, hi = int(GS_MIN_LEN / 10), int(GS_WIN_MAX / 10)
        for i in range(n):
            if i + 6 >= n or (hh[i] - hh[i + 6]) / 60.0 < GS_START_TAN:
                continue
            ok = True
            for j in range(i + 8, min(n, i + hi + 1)):
                if (hh[j - 8] - hh[j]) / 80.0 < GS_MIN_TAN:
                    break
                if j - i >= lo:
                    drop = hh[i] - hh[j]
                    if best is None or drop > best[0]:
                        best = (drop, i, j)
        if best is None:
            return None
        _, i, j = best
        return [[round(x, 1), round(z, 1)] for x, z in rs[i:j + 1]]

    def candidates(ranks):
        out = []
        for p in pistes:
            if DIFF_RANK.get(p["diff"], 2) not in ranks or p["len"] < GS_MIN_LEN:
                continue
            win = best_window(p)
            if not win:
                continue
            drop = h_at(*win[0]) - h_at(*win[-1])
            if drop < GS_MIN_DROP:
                continue
            pref = 0
            for k, cand in enumerate(resort.get("gs", [])):
                if cand in p["name"].get("ja", ""):
                    pref = len(resort.get("gs", [])) - k
                    break
            out.append((pref, drop, p, win))
        return out

    cands = candidates((2, 3)) or candidates((2, 3, 4))
    if not cands:
        raise RuntimeError(f"{resort['id']}: 找不到符合大曲道條件的雪道")
    pref, drop, base_p, win = max(cands, key=lambda c: (c[0], c[1]))
    gs = dict(base_p, id=base_p["id"] + "gs", pts=win, len=round(polylen(win), 1), drop=round(drop, 1))
    pistes.append(gs)

    return {
        "v": 1,
        "id": resort["id"],
        "name": resort["name"],
        "pref": resort["pref"],
        "attribution": ["© OpenStreetMap contributors (ODbL)", "出典：国土地理院 標高タイル（DEM5A／DEM10B）"],
        "origin": {"lat": round(proj.lat0, 7), "lon": round(proj.lon0, 7)},
        "grid": {"w": gw, "h": gh, "cell": CELL, "base": base, "scale": SCALE, "enc": "pred2d-int16le-deflate-base64", "data": grid_b64},
        "pistes": pistes,
        "areas": area_out,
        "lifts": lift_out,
        "events": {"gs": {"piste": gs["id"]}},
        "notes": resort.get("notes", ""),
        "_stats": {"dem5aMissing": miss5, "cells": gw * gh},
    }


def write_index() -> None:
    """雪場清單用的小檔案（畫面不用為了列清單下載全部雪場）：依 resorts.py 的順序。"""
    order = [r["id"] for r in RESORTS + FALLBACKS]
    items = []
    for rid in order:
        path = OUT_DIR / f"{rid}.json"
        if not path.is_file():
            continue
        d = json.loads(path.read_text(encoding="utf-8"))
        gs = next(p for p in d["pistes"] if p["id"] == d["events"]["gs"]["piste"])
        items.append({
            "id": rid, "name": d["name"], "pref": d["pref"],
            "gs": {"piste": gs["id"], "name": gs["name"], "diff": gs["diff"], "len": gs["len"], "drop": gs["drop"], "width": gs["width"]},
            "kb": path.stat().st_size // 1024,
        })
    (OUT_DIR / "index.json").write_text(json.dumps({"v": 1, "resorts": items}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("ids", nargs="*")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--fallback", nargs="*", default=[])
    a = ap.parse_args()
    table = {r["id"]: r for r in RESORTS + FALLBACKS}
    ids = [r["id"] for r in RESORTS] if a.all else list(a.ids)
    ids += a.fallback
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    failed = []
    for rid in ids:
        r = table[rid]
        print(f"== {rid}", flush=True)
        try:
            data = build(r)
        except Exception as e:  # noqa: BLE001
            print(f"  失敗：{e}", flush=True)
            failed.append(rid)
            continue
        stats = data.pop("_stats")
        path = OUT_DIR / f"{rid}.json"
        path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        gs = next(p for p in data["pistes"] if p["id"] == data["events"]["gs"]["piste"])
        print(
            f"  雪道 {len(data['pistes'])} 條、纜車 {len(data['lifts'])} 條、格網 {data['grid']['w']}×{data['grid']['h']}"
            f"（DEM5A 缺 {stats['dem5aMissing']}/{stats['cells']}）、檔案 {path.stat().st_size // 1024} KB",
            flush=True,
        )
        print(f"  大曲道：{gs['name'].get('ja', '?')}（{gs['diff']}）長 {gs['len']} m、落差 {gs['drop']} m", flush=True)
    write_index()
    if failed:
        print("失敗：" + ", ".join(failed))
        sys.exit(1)


if __name__ == "__main__":
    main()
