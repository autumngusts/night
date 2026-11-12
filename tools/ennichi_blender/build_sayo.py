# ============================================================================
# 緣日樂園：用 Blender（背景執行）程式產生巫女小夜的 VRM 1.0（2026-11-12）
#   與 tools/ennichi_model/build_vrm.js（純 JS 版）同一套造型與骨架，差別在 Blender 能做的事：
#     * 細分曲面（Catmull-Clark）：頭、手、衣服、頭髮的輪廓圓滑，沒有多邊形稜角
#     * 布料模擬：大袖在 T-pose 下受重力自然下垂、產生皺褶後再套用成形狀
#     * 形狀鍵（shape key）做表情；VRM Add-on for Blender 設定 MToon、表情、彈簧骨並匯出 VRM 1.0
#   座標：腳本內的造型數字沿用 glTF／JS 版（Y 往上、+Z 面向前方），建網格時換成 Blender（Z 往上、-Y 面向前方）。
# 用法（由 tools/ennichi_blender/build.js 呼叫，它會先把五官貼圖轉成 PNG）：
#   blender -b -P tools/ennichi_blender/build_sayo.py -- --tex <貼圖資料夾> --out <輸出.vrm> [--preview <預覽.png>]
# 前置：Blender 4.2 以上＋VRM Add-on for Blender（擴充 id: vrm）
# ============================================================================
import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ARGS = {}
for i in range(0, len(argv) - 1, 2):
    ARGS[argv[i].lstrip("-")] = argv[i + 1]
TEX_DIR = ARGS.get("tex", "")
OUT = ARGS.get("out", "")
CLOTH = ARGS.get("cloth", "1") == "1"

SKIN = "#ffe9e0"
SKIN_SHADE = "#f4d0c6"
HAIR = "#231c2b"
HAIR_SHADE = "#0f0a16"
EYE_H, EYE_X, EYE_Y = 0.031, 0.049, 1.238
LID_UP = EYE_H * 0.357
EK = EYE_H / 0.028


# ---------------------------------------------------------------- 小工具
def lin1(v):
    v /= 255.0
    return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4


def lin(hexstr):
    n = int(hexstr[1:], 16)
    return (lin1((n >> 16) & 255), lin1((n >> 8) & 255), lin1(n & 255))


def bl(p):
    """glTF（Y-up、+Z 前）→ Blender（Z-up、-Y 前）"""
    return (p[0], -p[2], p[1])


def smooth(a, b, v):
    t = max(0.0, min(1.0, (v - a) / (b - a)))
    return t * t * (3 - 2 * t)


def v3(p):
    return Vector(p)


# ---------------------------------------------------------------- 幾何（gl 座標；面為四邊形，極點會在建網格時合併）
class Geom:
    def __init__(self, pos=None, uv=None, faces=None):
        self.pos = pos or []
        self.uv = uv or []
        self.faces = faces or []

    def map(self, fn):
        self.pos = [fn(p) for p in self.pos]
        return self


def lathe(profile, seg, rmod=None):
    g = Geom()
    rows = len(profile)
    for i, (r0, y) in enumerate(profile):
        for s in range(seg + 1):
            a = s / seg * math.pi * 2
            r = r0 * (rmod(a, y) if rmod else 1.0)
            g.pos.append((r * math.sin(a), y, r * math.cos(a)))
            g.uv.append((s / seg, 1 - i / (rows - 1)))
    for i in range(rows - 1):
        for s in range(seg):
            a0 = i * (seg + 1) + s
            b0 = a0 + seg + 1
            g.faces.append((a0, a0 + 1, b0 + 1, b0))
    return g


def sphere_profile(rings):
    return [(math.sin(math.pi * (1 - i / rings)), math.cos(math.pi * (1 - i / rings))) for i in range(rings + 1)]


def ellipsoid(c, r, seg=20, rings=14):
    return lathe(sphere_profile(rings), seg).map(lambda p: (c[0] + p[0] * r[0], c[1] + p[1] * r[1], c[2] + p[2] * r[2]))


def super_ellipsoid(c, r, e1, e2, seg_u=16, seg_v=24):
    def S(v, e):
        return math.copysign(abs(v) ** e, v)
    g = Geom()
    for i in range(seg_u + 1):
        u = -math.pi / 2 + math.pi * i / seg_u
        for j in range(seg_v + 1):
            v = -math.pi + 2 * math.pi * j / seg_v
            g.pos.append((c[0] + r[0] * S(math.cos(u), e1) * S(math.sin(v), e2), c[1] + r[1] * S(math.sin(u), e1), c[2] + r[2] * S(math.cos(u), e1) * S(math.cos(v), e2)))
            g.uv.append((j / seg_v, 1 - i / seg_u))
    for i in range(seg_u):
        for j in range(seg_v):
            a0 = i * (seg_v + 1) + j
            b0 = a0 + seg_v + 1
            g.faces.append((a0, a0 + 1, b0 + 1, b0))
    g.recalc = True
    return g


def spline(pts, n):
    out = []
    for k in range(n + 1):
        f = k / n * (len(pts) - 1)
        i = min(int(f), len(pts) - 2)
        t = f - i
        p0, p1, p2, p3 = pts[max(i - 1, 0)], pts[i], pts[i + 1], pts[min(i + 2, len(pts) - 1)]
        t2, t3 = t * t, t * t * t
        out.append(tuple(0.5 * (2 * p1[d] + (-p0[d] + p2[d]) * t + (2 * p0[d] - 5 * p1[d] + 4 * p2[d] - p3[d]) * t2 + (-p0[d] + 3 * p1[d] - 3 * p2[d] + p3[d]) * t3) for d in range(3)))
    return out


def strand(ctrl, width, thick, outward, samples=18, ring=8):
    """沿曲線掃掠扁平橢圓斷面（髮束、衣領、繩子）"""
    pts = [Vector(p) for p in spline(ctrl, samples)]
    g = Geom()
    for k, p in enumerate(pts):
        t = k / samples
        T = (pts[min(k + 1, samples)] - pts[max(k - 1, 0)]).normalized()
        O = Vector(outward(tuple(p), t))
        W = O.cross(T).normalized()
        N = T.cross(W).normalized()
        w = width(t) if callable(width) else width
        h = thick(t) if callable(thick) else thick
        for j in range(ring + 1):
            a = j / ring * math.pi * 2
            q = p + W * (math.cos(a) * w / 2) + N * (math.sin(a) * h / 2)
            g.pos.append(tuple(q))
            g.uv.append((j / ring, t))
    for k in range(samples):
        for j in range(ring):
            a0 = k * (ring + 1) + j
            b0 = a0 + ring + 1
            g.faces.append((a0, a0 + 1, b0 + 1, b0))
    g.recalc = True
    return g


def patch(x0, x1, y0, y1, nx, ny, z_at, mirror_u=False):
    g = Geom()
    for j in range(ny + 1):
        for i in range(nx + 1):
            x = x0 + (x1 - x0) * i / nx
            y = y1 - (y1 - y0) * j / ny
            g.pos.append((x, y, z_at(x, y)))
            g.uv.append(((1 - i / nx) if mirror_u else i / nx, 1 - j / ny))
    for j in range(ny):
        for i in range(nx):
            a = j * (nx + 1) + i
            c = a + nx + 1
            g.faces.append((a, c, c + 1, a + 1))
    return g


# ---------------------------------------------------------------- 頭（雕塑過的臉型）
HEAD_C = (0.0, 1.252, 0.0)
HEAD_R = (0.150, 0.163, 0.148)


def sculpt_head(u, R, C):
    x, y, z = u[0] * R[0], u[1] * R[1], u[2] * R[2]
    if u[1] < 0.15:
        t = min(1.0, (0.15 - u[1]) / 1.15)
        x *= 1 - 0.40 * t ** 1.5
        z *= (1 - 0.16 * t ** 1.3) if u[2] > 0 else (1 - 0.35 * t)
    if u[2] > 0:
        z *= 0.94
    if u[2] < 0 and u[1] > -0.3:
        z *= 1.07
    if u[1] < -0.8:
        y -= 0.006 * (-0.8 - u[1]) / 0.2
    if u[2] > 0:
        z += 0.0065 * math.exp(-((x / 0.010) ** 2 + ((y + 0.052) / 0.020) ** 2))
    return (C[0] + x, C[1] + y, C[2] + z)


HEAD = lathe(sphere_profile(40), 56).map(lambda p: sculpt_head(p, HEAD_R, HEAD_C))


def _bvh(g):
    tris = []
    for f in g.faces:
        tris.append((f[0], f[1], f[2]))
        tris.append((f[0], f[2], f[3]))
    return BVHTree.FromPolygons([Vector(p) for p in g.pos], tris, all_triangles=True, epsilon=0.0)


HEAD_BVH = _bvh(HEAD)


def surface_z(x, y):
    """從正面往 -Z 打到頭部表面；打在輪廓外時往中線靠一點再打"""
    for k in range(20):
        xx = x * (0.97 ** k)
        hit = HEAD_BVH.ray_cast(Vector((xx, y, 1.0)), Vector((0, 0, -1)))
        if hit[0] is not None:
            return hit[0].z
    return 0.0


# ---------------------------------------------------------------- 骨架
SLEEVE_X = [0.17, 0.27, 0.37]
BONES = [
    ("hips", None, (0, 0.72, 0)), ("spine", "hips", (0, 0.80, 0)), ("chest", "spine", (0, 0.94, 0)),
    ("neck", "chest", (0, 1.06, 0)), ("head", "neck", (0, 1.12, 0)),
    ("leftUpperArm", "chest", (0.10, 1.03, 0)), ("leftLowerArm", "leftUpperArm", (0.29, 1.03, 0)), ("leftHand", "leftLowerArm", (0.46, 1.03, 0)),
    ("rightUpperArm", "chest", (-0.10, 1.03, 0)), ("rightLowerArm", "rightUpperArm", (-0.29, 1.03, 0)), ("rightHand", "rightLowerArm", (-0.46, 1.03, 0)),
    ("leftUpperLeg", "hips", (0.075, 0.69, 0)), ("leftLowerLeg", "leftUpperLeg", (0.075, 0.39, 0)), ("leftFoot", "leftLowerLeg", (0.075, 0.07, 0)),
    ("rightUpperLeg", "hips", (-0.075, 0.69, 0)), ("rightLowerLeg", "rightUpperLeg", (-0.075, 0.39, 0)), ("rightFoot", "rightLowerLeg", (-0.075, 0.07, 0)),
    ("hair1", "head", (0, 1.13, -0.15)), ("hair2", "hair1", (0, 1.02, -0.165)), ("hair3", "hair2", (0, 0.91, -0.17)), ("hair4", "hair3", (0, 0.80, -0.165)),
]
for sx, side in ((1, "left"), (-1, "right")):
    for k, x in enumerate(SLEEVE_X):
        parent = side + ("UpperArm" if x < 0.29 else "LowerArm")
        BONES.append((f"{side}Sleeve{k}a", parent, (x * sx, 1.02, 0)))
        BONES.append((f"{side}Sleeve{k}b", f"{side}Sleeve{k}a", (x * sx, 0.93, 0)))
        BONES.append((f"{side}Sleeve{k}c", f"{side}Sleeve{k}b", (x * sx, 0.85, 0)))
HUMAN = [b[0] for b in BONES[:17]]
BONE_POS = {b[0]: b[2] for b in BONES}
CHILD = {}
for b in BONES:
    if b[1] and b[1] not in CHILD:
        CHILD[b[1]] = b[0]
# VRM 的骨名對應（Add-on 的屬性名是 snake_case）
SNAKE = {n: "".join("_" + c.lower() if c.isupper() else c for c in n) for n in HUMAN}


# ---------------------------------------------------------------- 蒙皮權重（回傳 [(骨名, 權重)]）
def rigid(bone):
    return lambda p: [(bone, 1.0)]


def ponytail_w(p):
    ys, names = [1.13, 1.02, 0.91, 0.80], ["hair1", "hair2", "hair3", "hair4"]
    if p[1] >= ys[0]:
        return [("hair1", 1.0)]
    for i in range(3):
        if p[1] >= ys[i + 1]:
            t = (ys[i] - p[1]) / (ys[i] - ys[i + 1])
            return [(names[i], 1 - t), (names[i + 1], t)]
    return [("hair3", 1.0)]


def sleeve_w(side):
    def f(p):
        ax = abs(p[0])
        k = min(range(3), key=lambda i: abs(ax - SLEEVE_X[i]))
        arm = side + ("UpperArm" if ax < 0.29 else "LowerArm")
        a, b = f"{side}Sleeve{k}a", f"{side}Sleeve{k}b"
        if p[1] >= 1.0:
            return [(arm, 1.0)]
        if p[1] >= 0.93:
            t = (1.0 - p[1]) / 0.07
            return [(arm, 1 - t), (a, t)]
        t = min(1.0, (0.93 - p[1]) / 0.08)
        return [(a, 1 - t), (b, t)]
    return f


def arm_w(side):
    # 手臂在手肘（x≈0.29）附近平滑混合，彎曲時不會折出尖角
    def f(p):
        t = smooth(0.25, 0.33, abs(p[0]))
        return [(side + "UpperArm", 1 - t), (side + "LowerArm", t)]
    return f


def torso_w(p):
    t = smooth(0.86, 0.92, p[1])
    return [("spine", 1 - t), ("chest", t)]


# ---------------------------------------------------------------- 零件
TORSO_PROFILE = [(0, 0.80), (0.104, 0.80), (0.106, 0.86), (0.118, 0.93), (0.124, 0.98), (0.118, 1.03), (0.09, 1.065), (0.05, 1.085), (0, 1.09)]
TORSO_Z = 0.74


def torso_r(y):
    for a, b in zip(TORSO_PROFILE, TORSO_PROFILE[1:]):
        if a[1] <= y <= b[1]:
            return a[0] + (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1])
    return 0.0


def torso_z(x, y):
    r = torso_r(y)
    return TORSO_Z * math.sqrt(max(0.0, r * r - x * x))


def out_axis(p, t=0):
    return tuple(Vector((p[0], 0, p[2] / (TORSO_Z * TORSO_Z))).normalized())


class Part:
    def __init__(self, mat, geom, weights, role=None, subd=0, mesh="body"):
        self.mat, self.geom, self.mesh, self.subd = mat, geom, mesh, subd
        # 掃掠、超橢球、手臂的面方向不保證朝外：建網格時重算法線（貼片與頭部是單面，維持原樣）
        self.recalc = getattr(geom, "recalc", False)
        self.weights = rigid(weights) if isinstance(weights, str) else weights
        self.role = role or mat


def build_parts():
    P = []

    def put(mat, g, w, role=None, subd=0, mesh="body"):
        P.append(Part(mat, g, w, role, subd, mesh))

    # --- 頭：臉（貼圖）與其餘皮膚
    face_uv = lambda p: ((p[0] + 0.16) / 0.32, 1 - (1.38 - p[1]) / 0.32)
    head = Geom(list(HEAD.pos), [face_uv(p) for p in HEAD.pos], [])

    def is_face(p):
        return p[2] > 0.035 and 1.07 < p[1] < 1.37 and abs(p[0]) < 0.14
    face_g = Geom(head.pos, head.uv, [f for f in HEAD.faces if all(is_face(head.pos[i]) for i in f)])
    rest_g = Geom(head.pos, head.uv, [f for f in HEAD.faces if not all(is_face(head.pos[i]) for i in f)])
    put("face", face_g, "head")
    put("skin", rest_g, "head")
    for sx in (1, -1):
        put("skin", ellipsoid((0.141 * sx, 1.228, -0.008), (0.01, 0.022, 0.015), 12, 8), "head", subd=1)
    put("skin", lathe([(0, 1.05), (0.036, 1.05), (0.034, 1.13), (0, 1.13)], 20), "neck")

    # --- 五官面片（Face 網格：有形狀鍵）
    for sx in (1, -1):
        cx = EYE_X * sx
        put("eye", patch(cx - EYE_H, cx + EYE_H, EYE_Y - EYE_H, EYE_Y + EYE_H, 16, 16, lambda x, y: surface_z(x, y) + 0.0012, sx < 0), "head", "eye", mesh="face")
        put("lid", patch(cx - EYE_H, cx + EYE_H, EYE_Y - EYE_H + LID_UP, EYE_Y + EYE_H + LID_UP, 16, 16, lambda x, y: surface_z(x, y) + 0.0019, sx < 0), "head", "lid", mesh="face")
    put("mouth", patch(-0.022, 0.022, 1.128, 1.172, 12, 12, lambda x, y: surface_z(x, y) + 0.0012), "head", "mouth", mesh="face")

    # --- 頭髮
    HC, HR = (0, 1.268, -0.008), (0.160, 0.163, 0.160)
    cap = lathe(sphere_profile(36), 48).map(lambda u: sculpt_head(u, HR, HC))
    cap.faces = [f for f in cap.faces if all((cap.pos[i][1] > 1.335 or cap.pos[i][2] < 0.03) and cap.pos[i][1] > 1.10 for i in f)]
    put("hair", cap, "head", subd=1)
    cap_out = lambda p, t=0: tuple((Vector(p) - Vector(HC)).normalized())
    bangs = [(-0.125, 1.235), (-0.1, 1.275), (-0.075, 1.29), (-0.05, 1.30), (-0.025, 1.288), (0, 1.302), (0.025, 1.29), (0.05, 1.298), (0.075, 1.286), (0.1, 1.272), (0.125, 1.232)]
    for x0, ty in bangs:
        root = (x0 * 0.8, 1.405, surface_z(x0 * 0.8, 1.38) - 0.004)
        mid = (x0, 1.345, surface_z(x0, 1.345) + 0.013)
        tip = (x0 * 1.06, ty, surface_z(x0 * 1.06, ty) + 0.007)
        put("hair", strand([root, mid, tip], lambda t: 0.05 * (1 - t) ** 0.7 + 0.003, lambda t: 0.008 * (1 - t) + 0.002, cap_out), "head", subd=1)
    for sx in (1, -1):
        put("hair", strand([(0.118 * sx, 1.35, 0.06), (0.142 * sx, 1.25, 0.07), (0.138 * sx, 1.14, 0.068), (0.122 * sx, 1.05, 0.055)],
                           lambda t: 0.05 * (1 - t) ** 0.6 + 0.005, 0.01, cap_out), "head", subd=1)
    for k in range(-3, 4):
        bx = k * 0.04
        put("hair", strand([(bx * 0.8, 1.40, -0.06), (bx, 1.33, -0.16), (bx * 1.05, 1.22, -0.172), (bx * 0.6, 1.12, -0.158)],
                           lambda t: 0.06 * (1 - t * 0.6), 0.014, cap_out, samples=14), "head", subd=1)
    for n, dx in enumerate([-0.03, -0.012, 0.006, 0.024, 0.04]):
        z0 = -0.152 - (n % 2) * 0.006
        put("hair", strand([(dx * 0.5, 1.135, z0), (dx * 1.5, 1.04, z0 - 0.014), (dx * 1.3, 0.94, z0 - 0.02), (dx * 0.6, 0.80, z0 - 0.014)],
                           lambda t: 0.05 * (1 - t) ** 0.5 + 0.004, 0.014, lambda p, t=0: (0, 0, -1), samples=20), ponytail_w, subd=1)
    put("white", super_ellipsoid((0, 1.13, -0.166), (0.044, 0.02, 0.012), 0.5, 0.5, 10, 16), "hair1", subd=1)
    for a, b in ((1.136, 1.128), (1.124, 1.132)):
        put("red", strand([(-0.046, a, -0.17), (0, b, -0.181), (0.046, a, -0.17)], 0.006, 0.006, lambda p, t=0: (0, 0, -1), samples=10, ring=6), "hair1")

    # --- 白衣＋交領
    put("white", lathe(TORSO_PROFILE, 40).map(lambda p: (p[0], p[1], p[2] * TORSO_Z)), torso_w, subd=1)

    def collar(sx, inset, z_off, w, mat):
        pts = [(0.052 * sx - inset * sx, 1.08, -0.025), (0.056 * sx - inset * sx, 1.062, 0.04)]
        for qx, qy in ((0.026, 1.01), (-0.004, 0.96), (-0.036, 0.91), (-0.06, 0.87)):
            x = qx * sx - inset * sx
            pts.append((x, qy, torso_z(x, qy) + z_off))
        put(mat, strand(pts, w, 0.006, out_axis, samples=24, ring=6), torso_w, subd=1)
    collar(1, 0.012, 0.004, 0.012, "accent")
    collar(-1, 0.012, 0.002, 0.012, "accent")
    collar(-1, 0, 0.005, 0.024, "white")
    collar(1, 0, 0.008, 0.024, "white")

    # --- 緋袴（打褶）＋腰紐、前結、腰板
    hakama = [(0, 0.075), (0.24, 0.075), (0.238, 0.11), (0.20, 0.40), (0.16, 0.66), (0.135, 0.80), (0.122, 0.875), (0, 0.875)]

    def pleat(a, y):
        depth = 0.032 * (1 - (y - 0.075) / 0.8) + 0.006
        front = 1.0 if math.cos(a) > 0 else 0.45
        return 1 + depth * front * abs(math.sin(a * 5))
    put("red", lathe(hakama, 160, pleat).map(lambda p: (p[0], p[1], p[2] * 0.8)), "hips")
    ring = []
    for a in range(25):
        th = a / 24 * math.pi * 2
        ring.append((0.126 * math.sin(th), 0.858, 0.126 * math.cos(th) * 0.8 + 0.002))
    put("red", strand(ring, 0.022, 0.008, lambda p, t=0: tuple(Vector((p[0], 0, p[2])).normalized()), samples=64, ring=6), "hips", subd=1)
    for sx in (1, -1):
        put("red", strand([(0, 0.858, 0.106), (0.03 * sx, 0.874, 0.118), (0.055 * sx, 0.86, 0.12), (0.03 * sx, 0.846, 0.118), (0, 0.858, 0.108)],
                          0.016, 0.006, lambda p, t=0: (0, 0, 1), samples=16, ring=6), "hips", subd=1)
        put("red", strand([(0.006 * sx, 0.852, 0.112), (0.018 * sx, 0.80, 0.118), (0.024 * sx, 0.74, 0.124)],
                          lambda t: 0.016 - t * 0.004, 0.005, lambda p, t=0: (0, 0, 1), samples=10, ring=6), "hips", subd=1)
    put("red", super_ellipsoid((0, 0.88, -0.098), (0.075, 0.035, 0.012), 0.3, 0.3, 10, 16), "hips", subd=1)

    # --- 手臂、手、大袖（大袖另外做布料模擬）、袖括紐、足袋、草履
    for sx, side in ((1, "left"), (-1, "right")):
        arm = lathe([(0, 0), (0.048, 0), (0.046, 0.53), (0.04, 1), (0, 1)], 16).map(lambda p, sx=sx: ((0.10 + 0.35 * p[1]) * sx, 1.03 + p[0], p[2]))
        arm.recalc = True
        put("white", arm, arm_w(side), role="arm", subd=1)
        put("skin", ellipsoid((0.488 * sx, 1.028, 0.002), (0.042, 0.022, 0.034), 14, 10), side + "Hand", subd=1)
        put("skin", ellipsoid((0.468 * sx, 1.032, 0.034), (0.018, 0.012, 0.014), 10, 6), side + "Hand", subd=1)
        put("white", super_ellipsoid((0.27 * sx, 0.965, 0), (0.135, 0.12, 0.05), 0.3, 0.5, 18, 28), sleeve_w(side), role="sleeve_" + side)
        put("red", strand([(0.145 * sx, 0.852, 0.05), (0.27 * sx, 0.848, 0.054), (0.395 * sx, 0.852, 0.05)], 0.008, 0.006, lambda p, t=0: (0, -1, 0), samples=12, ring=6), sleeve_w(side), role="cord_" + side)
        put("white", ellipsoid((0.075 * sx, 0.05, 0.028), (0.042, 0.04, 0.078)), side + "Foot", subd=1)
        put("sole", super_ellipsoid((0.075 * sx, 0.012, 0.03), (0.05, 0.011, 0.098), 0.4, 0.4, 8, 16), side + "Foot", subd=1)
        put("accent", strand([(0.05 * sx, 0.03, 0.03), (0.075 * sx, 0.07, 0.09), (0.1 * sx, 0.03, 0.03)], 0.008, 0.006, lambda p, t=0: (0, 1, 0), samples=10, ring=6), side + "Foot")
    return P


# ---------------------------------------------------------------- 表情（形狀鍵）
def morph(part, p):
    def move_to(x, y, lift=0.0012):
        return (x, y, surface_z(x, y) + lift)
    out = {}
    cx = EYE_X if p[0] > 0 else -EYE_X
    cy = EYE_Y
    dx = (p[0] - cx) / EYE_H
    if part.role == "lid":
        out["blink"] = move_to(p[0], p[1] - EK * (0.0135 + 0.012 * (1 - dx * dx)), 0.0019)
        out["happy"] = move_to(p[0], p[1] - EK * (0.008 + 0.010 * dx * dx), 0.0019)
    elif part.role == "eye":
        out["blink"] = move_to(p[0], cy + (p[1] - cy) * 0.05)
        out["happy"] = move_to(p[0], cy + 0.006 * EK + (p[1] - cy) * 0.05)
    elif part.role == "mouth":
        my, mdx = 1.15, p[0] / 0.022
        out["aa"] = move_to(p[0] * 0.85, my + (p[1] - my) * 5)
        out["happy"] = move_to(p[0] * 1.25, p[1] + 0.002 * mdx * mdx)
    return out


# ---------------------------------------------------------------- Blender 物件
def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def ensure_addon():
    for mod in ("bl_ext.user_default.vrm", "io_scene_vrm"):
        try:
            bpy.ops.preferences.addon_enable(module=mod)
            return mod
        except Exception:
            continue
    raise RuntimeError("找不到 VRM Add-on for Blender（擴充 id: vrm）")


def make_armature():
    arm_data = bpy.data.armatures.new("Armature")
    arm = bpy.data.objects.new("Armature", arm_data)
    bpy.context.scene.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    eb = {}
    for name, parent, pos in BONES:
        b = arm_data.edit_bones.new(name)
        b.head = bl(pos)
        child = CHILD.get(name)
        if name == "head":
            tail = (0, 1.40, 0)
        elif name == "hips":
            tail = BONE_POS["spine"]
        elif name == "chest":
            tail = BONE_POS["neck"]
        elif child:
            tail = BONE_POS[child]
        elif "Hand" in name:
            tail = (pos[0] + (0.06 if pos[0] > 0 else -0.06), pos[1], pos[2])
        elif "Foot" in name:
            tail = (pos[0], pos[1] - 0.04, pos[2] + 0.10)
        else:
            tail = (pos[0], pos[1] - 0.06, pos[2])
        b.tail = bl(tail)
        if parent:
            b.parent = eb[parent]
        eb[name] = b
    bpy.ops.object.mode_set(mode="OBJECT")
    return arm


def build_object(name, parts, mats, with_shape_keys=False):
    bm = bmesh.new()
    uv_layer = bm.loops.layers.uv.verify()
    deform = bm.verts.layers.deform.verify()
    group_index = {b[0]: i for i, b in enumerate(BONES)}
    vmap_all = []  # (零件, 原始頂點 index → bm 頂點)
    for part in parts:
        g = part.geom
        key_to_v = {}
        vmap = []
        for p in g.pos:
            key = (round(p[0], 6), round(p[1], 6), round(p[2], 6))
            v = key_to_v.get(key)
            if v is None:
                v = bm.verts.new(bl(p))
                acc = {}
                for bone, w in part.weights(p):
                    if w > 1e-4:
                        acc[group_index[bone]] = acc.get(group_index[bone], 0.0) + w
                for gi, w in acc.items():
                    v[deform][gi] = w
                key_to_v[key] = v
            vmap.append(v)
        mi = mats.index(part.mat)
        new_faces = []
        for f in g.faces:
            verts, uvs = [], []
            for i in f:
                if vmap[i] not in verts:
                    verts.append(vmap[i])
                    uvs.append(g.uv[i])
            if len(verts) < 3:
                continue
            try:
                face = bm.faces.new(verts)
            except ValueError:
                continue
            face.material_index = mi
            face.smooth = True
            for loop, uv in zip(face.loops, uvs):
                loop[uv_layer].uv = uv
            new_faces.append(face)
        if part.recalc and new_faces:
            bmesh.ops.recalc_face_normals(bm, faces=new_faces)
        vmap_all.append((part, vmap))
    bm.verts.index_update()
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    for b in BONES:
        obj.vertex_groups.new(name=b[0])
    for m in mats:
        mesh.materials.append(MATERIALS[m])
    if with_shape_keys:
        obj.shape_key_add(name="Basis", from_mix=False)
        for key in ("blink", "aa", "happy"):
            sk = obj.shape_key_add(name=key, from_mix=False)  # from_mix=True 會把前一個形狀鍵混進來（aa 裡出現閉眼）
            for part, vmap in vmap_all:
                for idx, v in enumerate(vmap):
                    target = morph(part, part.geom.pos[idx]).get(key)
                    if target:
                        sk.data[v.index].co = bl(target)
    bm.free()
    return obj


def apply_subsurf(obj, levels):
    if levels <= 0:
        return
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    mod = obj.modifiers.new("Subsurf", "SUBSURF")
    mod.levels = levels
    mod.render_levels = levels
    mod.uv_smooth = "PRESERVE_BOUNDARIES"
    bpy.ops.object.modifier_apply(modifier=mod.name)
    obj.select_set(False)


def drape_sleeve(obj, side):
    """大袖：T-pose 下以上緣為固定點做布料模擬，套用最後一格的形狀"""
    sx = 1 if side == "left" else -1
    pin = obj.vertex_groups.new(name="_pin")
    idx = [v.index for v in obj.data.vertices if v.co.z >= 1.0]  # Blender 的 Z ＝ gl 的 Y
    pin.add(idx, 1.0, "REPLACE")
    # 手臂當碰撞體
    bpy.ops.mesh.primitive_cylinder_add(radius=0.05, depth=0.38, location=(0.28 * sx, 0, 1.03), rotation=(0, math.pi / 2, 0))
    col = bpy.context.active_object
    col.modifiers.new("Collision", "COLLISION")
    cloth = obj.modifiers.new("Cloth", "CLOTH")
    s = cloth.settings
    s.quality = 6
    s.mass = 0.12
    s.tension_stiffness = 12
    s.compression_stiffness = 12
    s.bending_stiffness = 0.4
    s.vertex_group_mass = "_pin"
    cloth.collision_settings.distance_min = 0.004
    scene = bpy.context.scene
    scene.frame_start, scene.frame_end = 1, 36
    cloth.point_cache.frame_end = 36
    for f in range(1, 37):
        scene.frame_set(f)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=cloth.name)
    print("[ennichi] cloth applied:", obj.name)
    g = obj.vertex_groups.get("_pin")
    if g:
        obj.vertex_groups.remove(g)
    bpy.data.objects.remove(col, do_unlink=True)
    scene.frame_set(1)


def reweight_sleeve(obj, side):
    """布料模擬後形狀改變：依新的位置重算袖子的權重"""
    fn = sleeve_w(side)
    for v in obj.data.vertices:
        p = (v.co.x, v.co.z, -v.co.y)
        for gi in [g.group for g in v.groups]:
            obj.vertex_groups[gi].remove([v.index])
        for bone, w in fn(p):
            if w > 1e-4:
                obj.vertex_groups[bone].add([v.index], w, "ADD")


# ---------------------------------------------------------------- 材質（MToon）
MATERIALS = {}


def load_image(name):
    path = os.path.join(TEX_DIR, name + ".png")
    img = bpy.data.images.load(path)
    img.pack()
    return img


def mtoon(name, color, shade, outline=0.0, tex=None, mask=False, shift=-0.05, rim=(0, 0, 0)):
    m = bpy.data.materials.new(name)
    m.vrm_addon_extension.mtoon1.enabled = True
    g = m.vrm_addon_extension.mtoon1
    g.pbr_metallic_roughness.base_color_factor = (*color, 1)
    mt = g.extensions.vrmc_materials_mtoon
    mt.shade_color_factor = shade
    mt.shading_shift_factor = shift
    mt.shading_toony_factor = 0.9
    mt.gi_equalization_factor = 0.9
    mt.parametric_rim_color_factor = rim
    mt.parametric_rim_fresnel_power_factor = 4
    mt.parametric_rim_lift_factor = 0
    mt.rim_lighting_mix_factor = 1
    mt.outline_width_mode = "worldCoordinates" if outline > 0 else "none"
    mt.outline_width_factor = outline
    mt.outline_color_factor = lin("#2a1c26")
    mt.outline_lighting_mix_factor = 0.6
    if tex:
        img = load_image(tex)
        g.pbr_metallic_roughness.base_color_texture.index.source = img
        mt.shade_multiply_texture.index.source = img
        for t in (g.pbr_metallic_roughness.base_color_texture.index, mt.shade_multiply_texture.index):
            t.sampler.wrap_s = "CLAMP_TO_EDGE"
            t.sampler.wrap_t = "CLAMP_TO_EDGE"
    if mask:
        g.alpha_mode = "MASK"
        g.alpha_cutoff = 0.5
    MATERIALS[name] = m
    return m


def make_materials():
    skin, skin_shade = lin(SKIN), lin(SKIN_SHADE)
    ratio = tuple(skin_shade[i] / skin[i] for i in range(3))
    mtoon("skin", skin, skin_shade, outline=0.0025)
    mtoon("face", (1, 1, 1), ratio, outline=0.0025, tex="face")
    mtoon("eye", (1, 1, 1), (0.88, 0.86, 0.9), tex="eye", mask=True, shift=-0.4)
    mtoon("lid", (1, 1, 1), ratio, tex="lid", mask=True)
    mtoon("mouth", (1, 1, 1), (0.9, 0.85, 0.85), tex="mouth", mask=True, shift=-0.4)
    mtoon("hair", lin(HAIR), lin(HAIR_SHADE), outline=0.003, rim=(0.25, 0.22, 0.35))
    mtoon("white", lin("#fbfaf8"), lin("#c3c5dc"), outline=0.003, rim=(0.2, 0.2, 0.25))
    mtoon("red", lin("#d22a3c"), lin("#801425"), outline=0.003, rim=(0.2, 0.1, 0.12))
    mtoon("accent", lin("#e0303f"), lin("#8a1626"), outline=0.002)
    mtoon("sole", lin("#9a7450"), lin("#5a4028"), outline=0.002)


# ---------------------------------------------------------------- VRM 設定
def setup_vrm(arm, face_obj):
    ext = arm.data.vrm_addon_extension
    ext.spec_version = "1.0"
    vrm1 = ext.vrm1
    meta = vrm1.meta
    meta.vrm_name = "Sayo (Ennichi miko, Blender sample)"
    meta.version = "0.3"
    meta.authors.add().value = "PriTest"
    meta.avatar_permission = "everyone"
    meta.commercial_usage = "personalNonProfit"
    meta.allow_excessively_violent_usage = False
    meta.allow_excessively_sexual_usage = False
    meta.allow_political_or_religious_usage = False
    meta.allow_antisocial_or_hate_usage = False
    meta.credit_notation = "required"
    meta.allow_redistribution = False
    meta.modification = "prohibited"
    hb = vrm1.humanoid.human_bones
    for name in HUMAN:
        getattr(hb, SNAKE[name]).node.bone_name = name
    preset = vrm1.expressions.preset
    for key in ("blink", "aa", "happy"):
        bind = getattr(preset, key).morph_target_binds.add()
        bind.node.mesh_object_name = face_obj.name
        bind.index = key
        bind.weight = 1.0

    sb = ext.spring_bone1
    # 碰撞球：位置以世界座標指定（Add-on 用骨頭底下的 Empty 表示碰撞球，直接搬 Empty 最不容易搞錯骨頭的軸向）
    colliders = [("chest", (0, 0.95, 0), 0.12), ("spine", (0, 0.80, 0), 0.115), ("hips", (0, 0.60, 0), 0.16), ("hips", (0, 0.40, 0), 0.19), ("head", (0, 1.25, 0), 0.16)]
    group = sb.add_collider_group()
    group.vrm_name = "body"
    for bone, world, r in colliders:
        c = sb.add_collider(bpy.context, arm)
        c.node.bone_name = bone
        c.shape.sphere.radius = r
        bpy.context.view_layer.update()
        if c.bpy_object:
            m = c.bpy_object.matrix_world.copy()
            m.translation = Vector(bl(world))
            c.bpy_object.matrix_world = m
        group.add_collider().collider_uuid = c.uuid

    def add_spring(name, bones, stiff, grav, drag, radius, with_colliders):
        spring = sb.add_spring()
        spring.vrm_name = name
        for b in bones:
            j = spring.add_joint()
            j.node.bone_name = b
            j.hit_radius = radius
            j.stiffness = stiff
            j.gravity_power = grav
            j.drag_force = drag
        if with_colliders:
            spring.add_collider_group().collider_group_uuid = group.uuid
    add_spring("ponytail", ["hair1", "hair2", "hair3", "hair4"], 0.9, 0.35, 0.35, 0.03, True)
    for side in ("left", "right"):
        for k in range(3):
            add_spring(f"{side}Sleeve{k}", [f"{side}Sleeve{k}a", f"{side}Sleeve{k}b", f"{side}Sleeve{k}c"], 1.0, 0.25, 0.5, 0.035, False)


# ---------------------------------------------------------------- 主流程
def main():
    clear_scene()
    mod = ensure_addon()
    print("[ennichi] addon:", mod)
    make_materials()
    arm = make_armature()
    parts = build_parts()

    body_objs = []
    # 依細分等級分組建物件、套用細分後再合併
    for level in (0, 1):
        ps = [p for p in parts if p.mesh == "body" and p.subd == level and not p.role.startswith("sleeve_")]
        mats = sorted({p.mat for p in ps})
        o = build_object(f"Body_s{level}", ps, mats)
        apply_subsurf(o, level)
        body_objs.append(o)
    for side in ("left", "right"):
        ps = [p for p in parts if p.role == "sleeve_" + side]
        o = build_object("Sleeve_" + side, ps, ["white"])
        if CLOTH:
            try:
                drape_sleeve(o, side)
                reweight_sleeve(o, side)
            except Exception as e:  # 布料模擬失敗時沿用原本的形狀
                print("[ennichi] cloth failed:", e)
        apply_subsurf(o, 1)
        body_objs.append(o)

    bpy.ops.object.select_all(action="DESELECT")
    for o in body_objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = body_objs[0]
    bpy.ops.object.join()
    body = bpy.context.active_object
    body.name = "Body"
    body.data.name = "Body"

    face_parts = [p for p in parts if p.mesh == "face"]
    face = build_object("Face", face_parts, ["eye", "lid", "mouth"], with_shape_keys=True)

    for o in (body, face):
        o.parent = arm
        mod = o.modifiers.new("Armature", "ARMATURE")
        mod.object = arm

    setup_vrm(arm, face)
    nverts = sum(len(o.data.vertices) for o in (body, face))
    print("[ennichi] verts:", nverts)

    bpy.ops.object.select_all(action="DESELECT")
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    result = bpy.ops.export_scene.vrm(filepath=OUT)
    if result != {"FINISHED"}:
        raise RuntimeError(f"export failed: {result}")
    print("[ennichi] wrote", OUT, os.path.getsize(OUT) // 1024, "KB")


main()
