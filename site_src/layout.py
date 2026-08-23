"""全ページ共通のレイアウト（ヘッダー・言語切替・フッター）を組み立てる。"""

from __future__ import annotations

from site_src.version import VERSION

LANGS = ("zh", "ja", "en")


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
        f'  <script src="{static_prefix}{name}"></script>' for name in extra_scripts
    )

    return f"""<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<link rel="icon" href="data:,">
<link rel="stylesheet" href="{static_prefix}style.css">
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
  <script src="{static_prefix}i18n.js"></script>
{scripts}
</body>
</html>
"""
