"""ホームページ（ミニプロジェクト選択画面）を組み立てる。"""

from __future__ import annotations

from site_src.layout import page_shell
from site_src.projects import PROJECT_TABS, PROJECTS

_PROJECTS_BY_ID = {project["id"]: project for project in PROJECTS}

# 標籤切換：一開始全部隱藏；按下標籤顯示該組，再按一次同一標籤則收起。
_TAB_SCRIPT = """    <script>
    (function () {
      var tabs = document.querySelectorAll(".home-tab");
      var panels = document.querySelectorAll(".home-tab-panel");
      var hint = document.getElementById("home-tab-hint");
      function show(id) {
        for (var i = 0; i < tabs.length; i++) {
          var on = tabs[i].getAttribute("data-tab") === id;
          tabs[i].classList.toggle("is-active", on);
          tabs[i].setAttribute("aria-selected", on ? "true" : "false");
        }
        for (var j = 0; j < panels.length; j++) {
          panels[j].hidden = panels[j].getAttribute("data-tab") !== id;
        }
        hint.hidden = !!id;
      }
      for (var k = 0; k < tabs.length; k++) {
        tabs[k].addEventListener("click", function () {
          var id = this.getAttribute("data-tab");
          show(this.classList.contains("is-active") ? null : id);
        });
      }
    })();
    </script>
"""


def _card(project: dict) -> str:
    return f"""      <a class="project-card" href="{project['href']}">
        <h2 data-i18n="{project['name_key']}"></h2>
        <p data-i18n="{project['desc_key']}"></p>
      </a>"""


def _tab_button(tab: dict) -> str:
    label = (
        f'data-i18n="{tab["label_key"]}">'
        if "label_key" in tab
        else f'>{tab["label"]}'
    )
    return (
        f'      <button type="button" class="home-tab" role="tab" aria-selected="false" '
        f'data-tab="{tab["id"]}" {label}</button>'
    )


def build_index_html() -> str:
    buttons = "\n".join(_tab_button(tab) for tab in PROJECT_TABS)
    panels = "\n".join(
        f'    <div class="project-grid home-tab-panel" role="tabpanel" data-tab="{tab["id"]}" hidden>\n'
        + "\n".join(_card(_PROJECTS_BY_ID[pid]) for pid in tab["projects"])
        + "\n    </div>"
        for tab in PROJECT_TABS
    )

    body = f"""    <h1 data-i18n="home_title"></h1>
    <p data-i18n="home_subtitle"></p>
    <div class="home-tabs" role="tablist">
{buttons}
    </div>
    <p id="home-tab-hint" class="home-tab-hint" data-i18n="home_tab_hint"></p>
{panels}
{_TAB_SCRIPT}"""

    return page_shell(
        title="PriTest",
        body=body,
        static_prefix="static/",
        home_href="index.html",
    )
