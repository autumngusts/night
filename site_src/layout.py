"""全ページ共通のレイアウト（ヘッダー・言語切替・フッター）を組み立てる。"""

from __future__ import annotations

import hashlib
from pathlib import Path

from site_src.version import VERSION

LANGS = ("zh", "ja", "en")

# generate.py は build_static_assets() → build_pages() の順に実行するので、ページを組み立てる
# 時点で dist/static/ にはもう今回の CSS/JS がある。
DIST_STATIC_DIR = Path(__file__).resolve().parent.parent / "dist" / "static"


def asset_url(static_prefix: str, name: str) -> str:
    """快取破壞（2026-10-03）：GitHub Pages 對靜態檔回 Cache-Control: max-age=600，網址不變時
    瀏覽器會把「新的 HTML」配上「快取中的舊 JS/CSS」（實際發生：流程簡介新分頁的 i18n 鍵沒有
    翻譯、分頁點擊沒有綁定）。這裡用建置後檔案內容的雜湊當 ?v=，檔案一改網址就跟著變。"""
    path = DIST_STATIC_DIR / name
    if not path.is_file():
        return f"{static_prefix}{name}"
    digest = hashlib.sha1(path.read_bytes()).hexdigest()[:10]
    return f"{static_prefix}{name}?v={digest}"


def page_shell(
    *,
    title: str,
    body: str,
    static_prefix: str,
    home_href: str,
    extra_scripts: tuple[str, ...] = (),
) -> str:
    lang_buttons = "\n".join(
        f'      <button type="button" class="lang-btn" data-lang="{lang}" data-i18n="lang_name_{lang}"></button>'
        for lang in LANGS
    )
    scripts = "\n".join(
        f'  <script src="{asset_url(static_prefix, name)}"></script>' for name in extra_scripts
    )

    return f"""<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<link rel="icon" href="data:,">
<link rel="stylesheet" href="{asset_url(static_prefix, 'style.css')}">
</head>
<body>
  <header class="site-header">
    <div class="site-title-group">
      <a class="site-title" href="{home_href}" data-i18n="site_name"></a><span class="site-version">v{VERSION}</span>
    </div>
    <nav class="lang-switch">
{lang_buttons}
    </nav>
  </header>
  <main>
{body}
  </main>
  <script src="{asset_url(static_prefix, 'i18n.js')}"></script>
{scripts}
</body>
</html>
"""
