"""全ページ共通のレイアウト（ヘッダー・言語切替・フッター）を組み立てる。"""

from __future__ import annotations

import hashlib
from pathlib import Path

from site_src.version import VERSION

LANGS = ("zh", "ja", "en")

# 「付款」分頁（使用者指定 2026-11-20）：輸入這組密碼才看得到。純前端檢查，只是擋一般瀏覽，不是真正的保護。
PAY_PASSWORD = "nightnight"
PAY_STORAGE_KEY = "pritest-pay-unlocked"


def pay_gate_script(home_href: str) -> str:
    """付款遊戲頁的入口檢查：放在 i18n.js 之後、遊戲腳本之前。沒解鎖就問密碼，錯了回首頁。"""
    return f"""
  <script>
  (function () {{
    var ok = false;
    try {{ ok = localStorage.getItem("{PAY_STORAGE_KEY}") === "1"; }} catch (e) {{}}
    if (ok) return;
    var input = window.prompt(window.I18N ? I18N.t("home_pay_prompt") : "password");
    if (input === "{PAY_PASSWORD}") {{
      try {{ localStorage.setItem("{PAY_STORAGE_KEY}", "1"); }} catch (e) {{}}
      return;
    }}
    document.documentElement.style.display = "none";
    location.replace("{home_href}");
    throw new Error("pay gate");
  }})();
  </script>"""

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
    extra_styles: tuple[str, ...] = (),
    extra_i18n: tuple[str, ...] = (),
    paid: bool = False,
) -> str:
    lang_buttons = "\n".join(
        f'      <button type="button" class="lang-btn" data-lang="{lang}" data-i18n="lang_name_{lang}"></button>'
        for lang in LANGS
    )
    # 各遊戲自己的樣式（static_src/css/<遊戲>.css；使用者指定 2026-10-26：每個遊戲分開 CSS，更新不互相影響）
    styles = "".join(
        f'\n<link rel="stylesheet" href="{asset_url(static_prefix, name)}">' for name in extra_styles
    )
    # 各遊戲自己的字串（static/i18n/<遊戲>.js，generate.py 依鍵的前綴從 STRINGS 分出）：緊接在 i18n.js 之後、遊戲腳本之前
    i18n_scripts = "".join(
        f'\n  <script src="{asset_url(static_prefix, name)}"></script>' for name in extra_i18n
    )
    if paid:
        i18n_scripts += pay_gate_script(home_href)
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
<link rel="stylesheet" href="{asset_url(static_prefix, 'style.css')}">{styles}
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
  <script src="{asset_url(static_prefix, 'i18n.js')}"></script>{i18n_scripts}
{scripts}
</body>
</html>
"""
