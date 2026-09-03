"""midnight（即時制擴張版・技術驗證片）ページを組み立てる。

これは正式なゲームではなく、擴張版本編の前段として必要な3つの技術リスク
（程式動態生成地圖／canvas+requestAnimationFrame連續渲染／複數裝置同時修改同一數值
時RTDB transaction()原子操作）を検証するための最小構成ページ。実際の戦鬥数値・
キャラクターシート統合・地圖以外の遊戲規則はこのmilestoneの範囲外
（`C:\\Users\\autum\\.claude\\plans\\functional-leaping-map.md` 参照）。

実際のロジックは static/midnight_map.js（地圖生成）・static/midnight.js
（session／canvas描画／即時移動同步／縮圈／RTDB連携）が担当する。
"""

from __future__ import annotations

from site_src.layout import page_shell

BODY = """    <div class="midnight-wrap">
      <h1 data-i18n="midnight_title"></h1>
      <p class="threat-ref-body" data-i18n="midnight_tech_demo_note"></p>

      <div id="midnight-start-screen">
        <button type="button" id="btn-midnight-create" class="primary-btn" data-i18n="midnight_create_button"></button>
        <p class="threat-ref-body" data-i18n="midnight_join_hint"></p>
      </div>

      <canvas id="midnight-canvas" hidden></canvas>

      <div id="midnight-hud" hidden>
        <div class="wb-row">
          <span data-i18n="midnight_share_link_label"></span>
          <input type="text" id="midnight-share-link" readonly>
        </div>
        <div class="wb-row">
          <span id="midnight-hud-self-stat"></span>
          <span id="midnight-hud-target-stat"></span>
          <button type="button" id="btn-midnight-attack-shared-target" data-i18n="midnight_attack_target_button"></button>
        </div>
        <p class="threat-ref-body" data-i18n="midnight_controls_hint"></p>
      </div>
    </div>
"""


def build_midnight_html() -> str:
    return page_shell(
        title="Midnight - PriTest",
        body=BODY,
        static_prefix="../static/",
        home_href="../index.html",
        extra_scripts=(
            "firebase_config.js",
            "game_storage.js",
            "midnight_map.js",
            "midnight.js",
        ),
    )
