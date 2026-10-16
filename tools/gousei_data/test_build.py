"""gousei 資料建置工具的檢查。執行：py -3 -m unittest tools/gousei_data/test_build.py"""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build  # noqa: E402

THEME = {
    "id": "fx",
    "name": {"zh": "測試", "ja": "テスト"},
    "basics": [{"id": "b1", "zh": "甲", "ja": "甲"}, {"id": "b2", "zh": "乙", "ja": "乙"}],
    "junk": [{"id": "z1", "zh": "灰", "ja": "灰"}],
    "categories": [{"id": "c", "zh": "類", "ja": "類"}, {"id": "d", "zh": "別", "ja": "別"}],
    "min_items": 0, "min_mid": 0, "min_high": 0,
}
CORE = {"category": "core", "items": [{"id": "c1", "zh": "一", "ja": "一", "cat": "c"}],
        "recipes": [["b1", "b2", "c1"]]}
CAT_C = {"category": "c", "items": [{"id": "c2", "zh": "二", "ja": "二"}, {"id": "c3", "zh": "三", "ja": "三"}],
         "recipes": [["c1", "b1", "c2"], ["c2", "c2", "c3"]]}


def write_theme(root: Path, files: dict) -> Path:
    d = root / "fx"
    d.mkdir()
    for name, data in files.items():
        (d / name).write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    return d


class BuildTest(unittest.TestCase):
    def load(self, files):
        with tempfile.TemporaryDirectory() as tmp:
            return build.load_theme(write_theme(Path(tmp), files))

    def test_ok_and_tiers(self):
        th = self.load({"theme.json": THEME, "core.json": CORE, "c.json": CAT_C})
        self.assertEqual(th["errors"], [])
        tiers = {i["id"]: i["tier"] for i in th["items"]}
        self.assertEqual(tiers, {"b1": 0, "b2": 0, "z1": 0, "c1": 1, "c2": 2, "c3": 3})
        self.assertEqual(th["recipes"]["b1|c1"], "c2")

    def test_min_tier_over_multiple_recipes(self):
        cat = dict(CAT_C, recipes=CAT_C["recipes"] + [["c1", "c1", "c3"]])
        th = self.load({"theme.json": THEME, "core.json": CORE, "c.json": cat})
        self.assertEqual({i["id"]: i["tier"] for i in th["items"]}["c3"], 2)

    def test_duplicate_key(self):
        cat = dict(CAT_C, recipes=CAT_C["recipes"] + [["b1", "c1", "c3"]])
        th = self.load({"theme.json": THEME, "core.json": CORE, "c.json": cat})
        self.assertTrue(any("重複" in e and "b1|c1" in e for e in th["errors"]), th["errors"])

    def test_unreachable(self):
        cat = dict(CAT_C, items=CAT_C["items"] + [{"id": "c4", "zh": "四", "ja": "四"}])
        th = self.load({"theme.json": THEME, "core.json": CORE, "c.json": cat})
        self.assertTrue(any("c4" in e and "無法" in e for e in th["errors"]), th["errors"])

    def test_ownership(self):
        cat_d = {"category": "d", "items": [{"id": "d1", "zh": "丁", "ja": "丁"}], "recipes": [["c2", "b1", "d1"]]}
        th = self.load({"theme.json": THEME, "core.json": CORE, "c.json": CAT_C, "d.json": cat_d})
        self.assertTrue(any("d.json" in e for e in th["errors"]), th["errors"])

    def test_duplicate_name(self):
        cat = dict(CAT_C, items=[{"id": "c2", "zh": "一", "ja": "二"}, {"id": "c3", "zh": "三", "ja": "三"}])
        th = self.load({"theme.json": THEME, "core.json": CORE, "c.json": cat})
        self.assertTrue(any("名稱" in e for e in th["errors"]), th["errors"])

    def test_junk_rules(self):
        cat = dict(CAT_C, recipes=CAT_C["recipes"] + [["z1", "c1", "c3"]])
        th = self.load({"theme.json": THEME, "core.json": CORE, "c.json": cat})
        self.assertTrue(any("廢料" in e for e in th["errors"]), th["errors"])

    def test_min_items(self):
        theme = dict(THEME, min_items=10)
        with tempfile.TemporaryDirectory() as tmp:
            d = write_theme(Path(tmp), {"theme.json": theme, "core.json": CORE, "c.json": CAT_C})
            self.assertTrue(build.load_theme(d)["errors"])
            self.assertEqual(build.load_theme(d, skeleton=True)["errors"], [])

    def test_render_js(self):
        th = self.load({"theme.json": THEME, "core.json": CORE, "c.json": CAT_C})
        js = build.render_js(th)
        prefix = '(window.PriTestGouseiData = window.PriTestGouseiData || {})["fx"] = '
        self.assertIn(prefix, js)
        data = json.loads(js.split(prefix, 1)[1].rstrip().rstrip(";"))
        self.assertEqual(data["basics"], ["b1", "b2"])
        self.assertEqual(data["junk"], ["z1"])
        self.assertIn(["c3", "三", "三", "c", 3], data["items"])
        self.assertEqual(data["recipes"]["c2|c2"], "c3")


if __name__ == "__main__":
    unittest.main()
