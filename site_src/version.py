"""網站版本號。

使用者要求：在畫面最上方「PriTest」旁邊顯示 v0.xxx.xxx 格式的版本號，且每次 push 到
main 都要遞增，commit message 也要註明對應版本號。

慣例：
- 格式固定為 v0.<minor>.<patch>（目前階段一律保持主版號 0）。
- 每次 push 前，預設遞增 patch（最後一段）。
- 若該次 push 屬於較大幅度的變更（新功能、架構調整等），可依判斷改為遞增 minor
  並將 patch 歸零，由開發者（或 Claude Code）視情況決定。
- 這裡只有單一字串常數，供 generate.py／layout.py 讀取後印在頁首與（未來如需要）
  其他地方，避免各處各自硬編版本號。
"""

from __future__ import annotations

VERSION = "0.1.0"
