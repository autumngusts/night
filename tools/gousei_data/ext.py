"""gousei 擴充資料轉換：tools/gousei_data/<theme>_ext/<category>.txt → tools/gousei_data/<theme>/x_<category>.json。

執行：
  py -3 tools/gousei_data/ext.py              # 轉換全部主題
  py -3 tools/gousei_data/ext.py wuxia        # 只轉換一個主題

撰寫格式（一行一個物體，# 之後為註解）：
  郭靖 = 俠客 + 射鵰 ; 傻小子 + 降龍十八掌
  黃蓉/黄蓉 = 桃花島主 + 女兒

* 「zh」或「zh/ja」；省略 ja 時以 KANJI_MAP 把繁體字換成日本新字體。
* 等號右邊是一或多組配方，以「;」分隔；材料寫 zh 名稱（主題內任何物體，含其他擴充檔，可前向引用）。
* id 由 zh 名稱的拼音產生（x_ 開頭），同名稱永遠同 id，插入或調換行不會影響既有存檔。
* 輸出的 JSON 帶 "open": true，build.py 允許引用其他分類的物體（結果仍須屬於本分類）。
* 特例 alt.txt：替**既有物體**追加配方（不新增物體），格式相同，等號左邊寫既有名稱；
  輸出為 x_alt.json（category 為 core，結果可屬任何分類）。用來增加低階組合的命中率，
  追加的配方應滿足「結果階段 ≤ 兩材料最高階段 + 1」，才不會改變既有階段與任務分布。

轉換後請執行 build.py 驗證（組合重複、無法合成等由 build.py 檢查）。
"""

from __future__ import annotations

import hashlib
import json
import re
import sys
from pathlib import Path

from pypinyin import lazy_pinyin

ROOT = Path(__file__).resolve().parent

# 只收字形差異（繁體 → 日本新字體），不收詞彙替換；「龍」日文名稱慣用原字，不轉。
_KANJI_SRC, _KANJI_DST = (
    "氣龜體黑雜兔絕黃雞鬥獵靈貓惡錢蟬步蠶蟲絲澤應獸假脫畫點髓傳螢將斷鄉懷舊緣劍俠險舉佛數壽圓滿歸禪兩轉戰虛會迴來靜聲擊醉獨沉濟缽學祕"
    "膽舍邊對鐵礦鹽藥燈內輕焰隱姬盜當鑄溫寶歲經爐參淨歡腦釀續壯顏拔兒燒狀樓搖卷棧攝醫藏圖彌帶綠德稻穗條萬國觀吞雙縱殘乘總橫關鍊霸繩"
    "覺聽蠟嚴處峽溪濕恆潛淺亂縣莊曉麥驛廢廳悅營齋錄團戶隨單灣發變腳藝寢樂奧櫻讀戀榮晚繪釋惠權豐廣驗禱產麵瀨寫濱眾賴窗狹戲頰與爭實寬"
    "屬嶽巖彈從徵惱慘拜擔據擴攜效曆歷晝樞檢歐毆沒淚渴滯犧獻疊癡盡碎禮祿稱穩竊粹纖聰肅臟莖號衞衛裝覽觸譽讓豫貳賣賤贊踐軀辭遙遞遲醬"
    "鎭鑛閱隸顯飜餘驅髮鬪鷄麴默齒齡晉樣殼澀瀧瓣辯辨謠證豔壓壞壘奬孃屆峯巢彎徑拂擇敍稅竝繼臺舖艷譯讚陷飮價儉凜剎剩勞勳勸區卻吳圍增"
    "娛專岡帥彥擧栖罐爲曬鹼黨齊鷗幫",
    "気亀体黒雑兎絶黄鶏闘猟霊猫悪銭蝉歩蚕虫糸沢応獣仮脱画点髄伝蛍将断郷懐旧縁剣侠険挙仏数寿円満帰禅両転戦虚会廻来静声撃酔独沈済鉢学秘"
    "胆舎辺対鉄鉱塩薬灯内軽焔隠姫盗当鋳温宝歳経炉参浄歓脳醸続壮顔抜児焼状楼揺巻桟摂医蔵図弥帯緑徳稲穂条万国観呑双縦残乗総横関錬覇縄"
    "覚聴蝋厳処峡渓湿恒潜浅乱県荘暁麦駅廃庁悦営斎録団戸随単湾発変脚芸寝楽奥桜読恋栄晩絵釈恵権豊広験祷産麺瀬写浜衆頼窓狭戯頬与争実寛"
    "属岳巌弾従徴悩惨拝担拠拡携効暦歴昼枢検欧殴没涙渇滞犠献畳痴尽砕礼禄称穏窃粋繊聡粛臓茎号衛衛装覧触誉譲予弐売賎賛践躯辞遥逓遅醤"
    "鎮鉱閲隷顕翻余駆髪闘鶏麹黙歯齢晋様殻渋滝弁弁弁謡証艶圧壊塁奨嬢届峰巣弯径払択叙税並継台舗艶訳讃陥飲価倹凛刹剰労勲勧区却呉囲増"
    "娯専岡帥彦挙棲缶為晒鹸党斉鴎幇",
)
assert len(_KANJI_SRC) == len(_KANJI_DST), (len(_KANJI_SRC), len(_KANJI_DST))
KANJI_MAP = dict(zip(_KANJI_SRC, _KANJI_DST))

LINE_RE = re.compile(r"^(?P<names>[^=]+?)\s*=\s*(?P<recipes>.+)$")


def to_ja(zh: str) -> str:
    return "".join(KANJI_MAP.get(ch, ch) for ch in zh)


def make_id(zh: str, used: set[str]) -> str:
    base = "x_" + "".join(re.sub(r"[^a-z0-9]", "", p.lower()) for p in lazy_pinyin(zh))[:40]
    iid = base
    if iid in used or base == "x_":
        iid = base + "_" + hashlib.md5(zh.encode("utf-8")).hexdigest()[:6]
    used.add(iid)
    return iid


def load_existing(theme_dir: Path) -> dict[str, str]:
    """主題中既有（非擴充）物體：zh 名稱 → id。"""
    names: dict[str, str] = {}
    for path in sorted(theme_dir.glob("*.json")):
        if path.name.startswith("x_"):
            continue
        data = json.loads(path.read_text(encoding="utf-8"))
        rows = data.get("items", [])
        if path.name == "theme.json":
            rows = data["basics"] + data["junk"]
        for it in rows:
            names[it["zh"]] = it["id"]
    return names


def convert(theme: str) -> list[str]:
    errors: list[str] = []
    theme_dir = ROOT / theme
    src_dir = ROOT / f"{theme}_ext"
    meta = json.loads((theme_dir / "theme.json").read_text(encoding="utf-8"))
    cats = {c["id"] for c in meta["categories"]}
    existing = load_existing(theme_dir)
    used_ids = set(existing.values())

    parsed: list[tuple[str, list[dict], list[tuple[int, str, str, str]]]] = []
    new_names: dict[str, str] = {}
    alt_rows: list[tuple[int, str, str, str]] = []
    for path in sorted(src_dir.glob("*.txt")):
        cat = path.stem
        if cat == "alt":
            for no, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
                line = raw.split("#", 1)[0].strip()
                if not line:
                    continue
                m = LINE_RE.match(line)
                if not m:
                    errors.append(f"{path.name}:{no}: 格式錯誤 {raw!r}")
                    continue
                zh = m.group("names").split("/")[0].strip()
                for part in m.group("recipes").split(";"):
                    mats = [x.strip() for x in part.split("+")]
                    if len(mats) != 2 or not all(mats):
                        errors.append(f"{path.name}:{no}: 配方格式錯誤 {part.strip()!r}")
                        continue
                    alt_rows.append((no, mats[0], mats[1], zh))
            continue
        if cat not in cats:
            errors.append(f"{path.name}: 未定義的分類 {cat!r}")
            continue
        items: list[dict] = []
        rows: list[tuple[int, str, str, str]] = []
        for no, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            line = raw.split("#", 1)[0].strip()
            if not line:
                continue
            m = LINE_RE.match(line)
            if not m:
                errors.append(f"{path.name}:{no}: 格式錯誤 {raw!r}")
                continue
            names = [n.strip() for n in m.group("names").split("/")]
            zh = names[0]
            ja = names[1] if len(names) > 1 and names[1] else to_ja(zh)
            if re.search(r"\s|[0-9０-９]", zh + ja) or re.fullmatch(r"[一二三四五六七八九十百千]+", zh):
                errors.append(f"{path.name}:{no}: 名稱不可含空白或數字（語音模式以數字指定池子編號）：{zh!r}")
                continue
            if zh in existing or zh in new_names:
                errors.append(f"{path.name}:{no}: 名稱「{zh}」已存在")
                continue
            iid = make_id(zh, used_ids)
            new_names[zh] = iid
            items.append({"id": iid, "zh": zh, "ja": ja})
            for part in m.group("recipes").split(";"):
                mats = [x.strip() for x in part.split("+")]
                if len(mats) != 2 or not all(mats):
                    errors.append(f"{path.name}:{no}: 配方格式錯誤 {part.strip()!r}")
                    continue
                rows.append((no, mats[0], mats[1], zh))
        parsed.append((cat, items, rows))

    every = {**existing, **new_names}
    if alt_rows:
        parsed.append(("alt", [], alt_rows))
    for cat, items, rows in parsed:
        recipes = []
        for no, a, b, r in rows:
            missing = [x for x in (a, b, r) if x not in every]
            if missing:
                errors.append(f"{cat}.txt:{no}: 「{r}」的材料或結果不存在 {missing}")
                continue
            recipes.append([every[a], every[b], every[r]])
        out = theme_dir / f"x_{cat}.json"
        body = {"category": cat, "open": True, "items": items, "recipes": recipes}
        text = ("{\n  \"category\": " + json.dumps("core" if cat == "alt" else cat) + ",\n  \"open\": true,\n  \"items\": [\n"
                + ",\n".join("    " + json.dumps(it, ensure_ascii=False) for it in body["items"])
                + "\n  ],\n  \"recipes\": [\n"
                + ",\n".join("    " + json.dumps(rc, ensure_ascii=False) for rc in body["recipes"])
                + "\n  ]\n}\n")
        out.write_text(text, encoding="utf-8")
    print(f"[{theme}] 擴充物體 {len(new_names)} 種")
    return errors


def main(argv: list[str]) -> int:
    themes = argv or sorted(p.name[:-4] for p in ROOT.glob("*_ext") if p.is_dir())
    failed = False
    for theme in themes:
        errors = convert(theme)
        if errors:
            failed = True
            print(f"[{theme}] {len(errors)} 個錯誤：")
            for e in errors[:300]:
                print("  " + e)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
