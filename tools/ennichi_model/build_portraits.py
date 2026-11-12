# ============================================================================
# 緣日樂園：新製立繪的 SVG 向量暫代版（技術驗證樣本，2026-11-12）
#   jikan 的頭像是外部工具生成的 256×256 webp；新角色的正式立繪要照 docs/ennichi_art_prompts.md 生成。
#   在那之前，用同一套「臉＋眼＋頭髮＋服裝」零件畫出 3 張向量頭像，構圖對齊 jikan（胸上、正面、白底）。
# 用法：py -3 tools/ennichi_model/build_portraits.py
#   輸出 static_src/images/ennichi/portrait_<id>.svg
# ============================================================================
from __future__ import annotations

import os

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
OUT_DIR = os.path.join(ROOT, "static_src", "images", "ennichi")
LINE = "#3a2a33"


def eye(cx: float, cy: float, side: int, grad: str, happy: bool = False) -> str:
    """動畫風大眼：眼白、漸層虹膜、瞳孔、兩顆高光、上睫毛（外眼角上挑）、下睫毛。side = -1 左眼／1 右眼。"""
    if happy:
        # 笑瞇眼：一條往上彎的粗線
        return (
            f'<path d="M{cx-14},{cy+2} Q{cx},{cy-12} {cx+14},{cy+2}" fill="none" stroke="{LINE}" '
            f'stroke-width="4" stroke-linecap="round"/>'
        )
    o = side  # 外眼角方向
    return f"""
  <ellipse cx="{cx}" cy="{cy}" rx="13" ry="15.5" fill="#fff"/>
  <ellipse cx="{cx}" cy="{cy+1.5}" rx="11" ry="14" fill="url(#{grad})"/>
  <ellipse cx="{cx}" cy="{cy+3}" rx="5" ry="7.5" fill="#1d1018" opacity=".85"/>
  <ellipse cx="{cx}" cy="{cy+8}" rx="7" ry="3.5" fill="#fff" opacity=".25"/>
  <circle cx="{cx-4*o}" cy="{cy-5}" r="3.8" fill="#fff"/>
  <circle cx="{cx+4*o}" cy="{cy+7}" r="1.8" fill="#fff"/>
  <path d="M{cx-15*o},{cy-6} Q{cx-6*o},{cy-19} {cx+9*o},{cy-15} Q{cx+16*o},{cy-13} {cx+19*o},{cy-17}
           L{cx+17*o},{cy-11} Q{cx+12*o},{cy-11} {cx+14*o},{cy-6} Q{cx+4*o},{cy-14} {cx-15*o},{cy-6} Z"
        fill="{LINE}"/>
  <path d="M{cx-9*o},{cy+15} Q{cx},{cy+18} {cx+9*o},{cy+15}" fill="none" stroke="{LINE}" stroke-width="1.2" opacity=".6"/>"""


def face(skin: str, iris: tuple[str, str], mouth: str, happy_eyes: bool = False, brow_tilt: float = 0) -> str:
    left, right = 101, 155
    cy = 142
    return f"""
  <defs>
    <linearGradient id="iris" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="{iris[0]}"/><stop offset="1" stop-color="{iris[1]}"/>
    </linearGradient>
    <filter id="soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3"/></filter>
  </defs>
  <rect x="115" y="180" width="26" height="36" fill="{skin}" stroke="{LINE}" stroke-width="1.5"/>
  <path d="M115,190 Q128,200 141,190 L141,200 Q128,206 115,200 Z" fill="#000" opacity=".08"/>
  <path d="M84,112 C84,152 100,184 128,198 C156,184 172,152 172,112 C172,70 84,70 84,112 Z"
        fill="{skin}" stroke="{LINE}" stroke-width="1.6"/>
  <ellipse cx="99" cy="166" rx="11" ry="5" fill="#ff8f9a" opacity=".45" filter="url(#soft)"/>
  <ellipse cx="157" cy="166" rx="11" ry="5" fill="#ff8f9a" opacity=".45" filter="url(#soft)"/>
  {eye(left, cy, -1, "iris", happy_eyes)}
  {eye(right, cy, 1, "iris", happy_eyes)}
  <path d="M{left-12},{cy-26+brow_tilt} Q{left},{cy-31} {left+12},{cy-27-brow_tilt}" fill="none" stroke="{LINE}" stroke-width="1.8" stroke-linecap="round"/>
  <path d="M{right-12},{cy-27-brow_tilt} Q{right},{cy-31} {right+12},{cy-26+brow_tilt}" fill="none" stroke="{LINE}" stroke-width="1.8" stroke-linecap="round"/>
  <path d="M127,163 L129,166" stroke="{LINE}" stroke-width="1.2" stroke-linecap="round" opacity=".6"/>
  {mouth}"""


def bangs(color: str, xs: list[tuple[float, float, float]], top: float = 84) -> str:
    """瀏海：每束 (起點 x, 尖端 x, 尖端 y)。"""
    out = []
    for x0, xt, yt in xs:
        out.append(
            f'<path d="M{x0-13},{top} Q{(x0+xt)/2-6},{(top+yt)/2} {xt},{yt} Q{(x0+xt)/2+8},{(top+yt)/2} {x0+14},{top} Z" '
            f'fill="{color}" stroke="{LINE}" stroke-width="1.3" stroke-linejoin="round"/>'
        )
    return "\n  ".join(out)


def crown(color: str, shine: str) -> str:
    return f"""
  <path d="M78,124 C66,58 190,58 178,124 C172,98 152,84 128,84 C104,84 84,98 78,124 Z"
        fill="{color}" stroke="{LINE}" stroke-width="1.5"/>
  <path d="M96,76 Q128,64 160,76" fill="none" stroke="{shine}" stroke-width="5" stroke-linecap="round" opacity=".55"/>"""


def side_locks(color: str, length: float) -> str:
    return f"""
  <path d="M82,104 C74,140 76,{150+length} 88,{170+length} C92,{150+length*0.6} 94,140 100,108 Z" fill="{color}" stroke="{LINE}" stroke-width="1.4"/>
  <path d="M174,104 C182,140 180,{150+length} 168,{170+length} C164,{150+length*0.6} 162,140 156,108 Z" fill="{color}" stroke="{LINE}" stroke-width="1.4"/>"""


def wrap(inner: str, bg: tuple[str, str]) -> str:
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">
  <defs>
    <radialGradient id="bg" cx=".5" cy=".42" r=".7">
      <stop offset="0" stop-color="{bg[0]}"/><stop offset="1" stop-color="{bg[1]}"/>
    </radialGradient>
  </defs>
  <rect width="256" height="256" fill="url(#bg)"/>
  <!-- 放大 1.4 倍、以臉為中心，構圖接近 jikan 的胸上特寫 -->
  <g transform="translate(-51.2,-56) scale(1.4)">
{inner}
  </g>
</svg>
"""


def sayo() -> str:
    hair, shine = "#2a2232", "#6a5a86"
    return wrap(f"""
  <!-- 後髮（長直髮） -->
  <path d="M70,112 C58,38 198,38 186,112 C194,170 198,226 210,256 L46,256 C58,226 62,170 70,112 Z" fill="{hair}" stroke="{LINE}" stroke-width="1.5"/>
  <!-- 白衣＋緋色襦袢的 V 領 -->
  <path d="M28,256 C34,230 62,216 104,210 L152,210 C194,216 222,230 228,256 Z" fill="#fbfaf7" stroke="{LINE}" stroke-width="1.6"/>
  <path d="M110,210 L128,246 L146,210 Z" fill="#d42a3c" stroke="{LINE}" stroke-width="1.3"/>
  <path d="M100,210 L128,256 M156,210 L128,256" stroke="{LINE}" stroke-width="1.6" fill="none"/>
  <path d="M60,236 Q70,246 66,256 M196,236 Q186,246 190,256" stroke="#c5c6dc" stroke-width="2" fill="none"/>
  {face("#ffe8dc", ("#5a1626", "#d0506a"), '<path d="M120,178 Q128,184 136,178" fill="none" stroke="#b4485a" stroke-width="2" stroke-linecap="round"/>')}
  {crown(hair, shine)}
  {bangs(hair, [(94, 92, 126), (108, 104, 134), (122, 120, 128), (136, 138, 134), (150, 154, 127), (163, 166, 120)])}
  {side_locks(hair, 40)}
  <!-- 紅白的髮飾（水引） -->
  <circle cx="174" cy="100" r="7" fill="#d42a3c" stroke="{LINE}" stroke-width="1.2"/>
  <path d="M174,93 Q186,86 190,98 Q182,100 174,100 Q184,108 182,116 Q174,110 174,100 Z" fill="#fff" stroke="{LINE}" stroke-width="1.1"/>
""", ("#fff7f4", "#f6dfe2"))


def tetsuko() -> str:
    hair, shine = "#b45a2a", "#f0a060"
    grin = '<path d="M116,176 Q128,190 140,176 Z" fill="#a83848" stroke="#5a2030" stroke-width="1.5" stroke-linejoin="round"/><path d="M119,177 L137,177 L135,180 L121,180 Z" fill="#fff"/>'
    return wrap(f"""
  <!-- 後髮（短、亂翹） -->
  <path d="M72,126 C62,48 194,48 184,126 C190,150 186,170 180,184 L170,170 L164,186 L92,186 L86,170 L76,184 C70,170 66,150 72,126 Z" fill="{hair}" stroke="{LINE}" stroke-width="1.5"/>
  <!-- 工作服（深藍連身服＋立領＋肩帶） -->
  <path d="M26,256 C32,230 62,216 104,210 L152,210 C194,216 224,230 230,256 Z" fill="#2f3e64" stroke="{LINE}" stroke-width="1.6"/>
  <path d="M104,210 L118,232 L128,214 L138,232 L152,210" fill="#3d4f7c" stroke="{LINE}" stroke-width="1.4"/>
  <path d="M128,214 L128,256" stroke="#c9a640" stroke-width="2.5"/>
  <rect x="58" y="230" width="22" height="26" rx="3" fill="#e9b640" stroke="{LINE}" stroke-width="1.3"/>
  <path d="M160,226 L212,256" stroke="#7a5030" stroke-width="7"/>
  {face("#ffe2d0", ("#1f5a3c", "#5ac08a"), grin, brow_tilt=-2)}
  <ellipse cx="160" cy="174" rx="8" ry="3.5" fill="#556" opacity=".35"/>
  {crown(hair, shine)}
  {bangs(hair, [(92, 86, 118), (106, 102, 128), (122, 124, 122), (138, 142, 130), (154, 160, 120), (166, 172, 112)])}
  <path d="M120,62 Q112,44 126,40 Q122,52 132,60 Z" fill="{hair}" stroke="{LINE}" stroke-width="1.3"/>
  <!-- 頭上的護目鏡 -->
  <path d="M76,98 Q128,74 180,98" fill="none" stroke="#4a3a30" stroke-width="7"/>
  <circle cx="108" cy="84" r="15" fill="#5a4a40" stroke="{LINE}" stroke-width="1.5"/>
  <circle cx="148" cy="84" r="15" fill="#5a4a40" stroke="{LINE}" stroke-width="1.5"/>
  <circle cx="108" cy="84" r="10" fill="#f0a030"/><circle cx="148" cy="84" r="10" fill="#f0a030"/>
  <path d="M102,79 L107,76 M142,79 L147,76" stroke="#fff6d0" stroke-width="2.5" stroke-linecap="round"/>
""", ("#f7f8ff", "#dfe5f2"))


def renge() -> str:
    hair, shine = "#8a5a3c", "#d8a880"
    sakura = "".join(
        f'<g transform="translate({x},{y}) scale({s})"><circle r="3" cx="0" cy="-4" fill="#ffd6e2"/><circle r="3" cx="3.8" cy="-1.2" fill="#ffd6e2"/>'
        f'<circle r="3" cx="2.4" cy="3.2" fill="#ffd6e2"/><circle r="3" cx="-2.4" cy="3.2" fill="#ffd6e2"/><circle r="3" cx="-3.8" cy="-1.2" fill="#ffd6e2"/>'
        f'<circle r="1.4" fill="#e86a8a"/></g>'
        for x, y, s in [(46, 246, 1), (70, 234, 0.8), (190, 240, 1), (212, 250, 0.8), (174, 228, 0.7)]
    )
    return wrap(f"""
  <!-- 包包頭 -->
  <circle cx="128" cy="58" r="26" fill="{hair}" stroke="{LINE}" stroke-width="1.5"/>
  <path d="M110,50 Q128,40 146,50" fill="none" stroke="{shine}" stroke-width="4" stroke-linecap="round" opacity=".6"/>
  <path d="M74,124 C64,58 192,58 182,124 C186,150 182,176 176,196 L80,196 C74,176 70,150 74,124 Z" fill="{hair}" stroke="{LINE}" stroke-width="1.5"/>
  <!-- 粉色和服＋白色割烹著 -->
  <path d="M26,256 C32,230 62,216 104,210 L152,210 C194,216 224,230 230,256 Z" fill="#f08aa6" stroke="{LINE}" stroke-width="1.6"/>
  {sakura}
  <path d="M86,216 L128,256 L170,216 C160,212 152,210 152,210 L128,236 L104,210 C104,210 96,212 86,216 Z" fill="#fffdf8" stroke="{LINE}" stroke-width="1.4"/>
  <path d="M104,210 L128,236 L152,210" fill="none" stroke="#f08aa6" stroke-width="3"/>
  {face("#ffeadf", ("#5a2a6a", "#c07ad8"), '<path d="M121,178 Q128,183 135,178" fill="none" stroke="#b4485a" stroke-width="2" stroke-linecap="round"/>', happy_eyes=True)}
  {crown(hair, shine)}
  {bangs(hair, [(96, 98, 120), (110, 108, 128), (126, 128, 124), (142, 144, 128), (157, 160, 118)])}
  {side_locks(hair, 20)}
  <!-- 簪：櫻花＋垂飾 -->
  <path d="M152,48 L176,30 M156,52 L182,38" stroke="#c9a640" stroke-width="2.5" stroke-linecap="round"/>
  <g transform="translate(152,52) scale(2.2)"><circle r="3" cx="0" cy="-4" fill="#ffc0d4" stroke="{LINE}" stroke-width=".5"/><circle r="3" cx="3.8" cy="-1.2" fill="#ffc0d4" stroke="{LINE}" stroke-width=".5"/><circle r="3" cx="2.4" cy="3.2" fill="#ffc0d4" stroke="{LINE}" stroke-width=".5"/><circle r="3" cx="-2.4" cy="3.2" fill="#ffc0d4" stroke="{LINE}" stroke-width=".5"/><circle r="3" cx="-3.8" cy="-1.2" fill="#ffc0d4" stroke="{LINE}" stroke-width=".5"/><circle r="1.5" fill="#e8b030"/></g>
  <path d="M146,58 L144,80 M150,60 L150,84" stroke="#c9a640" stroke-width="1.2"/>
  <circle cx="144" cy="82" r="2.5" fill="#e86a8a"/><circle cx="150" cy="86" r="2.5" fill="#e86a8a"/>
""", ("#fffaf2", "#f7e6d8"))


def main() -> None:
    os.makedirs(OUT_DIR, exist_ok=True)
    for name, fn in (("sayo", sayo), ("tetsuko", tetsuko), ("renge", renge)):
        path = os.path.join(OUT_DIR, f"portrait_{name}.svg")
        svg = fn()
        # 同一頁內嵌多張 SVG 時 id 會互相覆蓋（虹膜顏色全變成第一張的），每張加上角色後綴
        for ident in ("iris", "soft", "bg"):
            svg = svg.replace(f'id="{ident}"', f'id="{ident}_{name}"').replace(f"url(#{ident})", f"url(#{ident}_{name})")
        with open(path, "w", encoding="utf-8") as f:
            f.write(svg)
        print("wrote", os.path.relpath(path, ROOT))


if __name__ == "__main__":
    main()
