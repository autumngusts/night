"""我不會唱歌（utau）進階模式：替 songs.json 自動找 YouTube 網址。

1. 依地區／分類／年代（或指定 id）把 static_src/utau_songs.js 歌單裡的歌加進 songs.json。
2. songs.json 裡還沒有 url／file 的歌，用 yt-dlp 搜尋 YouTube（只搜尋，不下載），
   挑出最像「官方原曲音源」的結果寫回 url，並在 _yt 欄位記下影片標題、頻道、長度與警告，方便人工審核。

挑選方式：
- 每首搜尋兩次：一般搜尋（多半是 MV），以及加上「Provided to YouTube by」（容易搜到 YouTube Music 的 Topic 純音訊）。
- 確定是原唱的頻道優先：頻道名稱含歌手名，或官方頻道說明欄裡出現的 Topic 頻道（羅馬拼音的歌手名）。
  Topic 是純音訊，沒有 MV 的前奏劇情與對白，副歌偵測較準，所以同樣是原唱時略優先。
- 排除 live、翻唱、伴奏、remix、耐久等版本，長度不在 80〜480 秒之間的扣分。
- 無法確認是原唱的結果仍會寫入，但附上警告，請人工確認。

用法（詳見同目錄 README.md）：
  tools/utau_clips/.venv/Scripts/python.exe tools/utau_clips/find_urls.py --region ja --category anime
"""

from __future__ import annotations

import argparse
import re
import unicodedata
from pathlib import Path

from build_pack import HERE, load_entries, log, normalize_source, save_entries, song_catalog

# 標題出現這些字（且歌名本身沒有）就不是原曲音源
BAD_WORDS = (
    "live", "ライブ", "cover", "カバー", "歌ってみた", "弾いてみた", "叩いてみた", "karaoke", "カラオケ",
    "instrumental", "off vocal", "inst", "piano", "ピアノ", "オルゴール", "remix", "full album",
    "1 hour", "1時間", "耐久", "nightcore", "sped up", "slowed", "reaction", "medley", "メドレー",
    "tv size", "tv.size", "tvサイズ", "short ver", "first take", "原曲歌手", "originally performed", "翻唱", "伴奏",
)
MIN_SEC, MAX_SEC = 80, 480


def norm(text: str) -> str:
    """比對用：全形半形統一、轉小寫、去掉空白與標點（中日文字保留）。"""
    return re.sub(r"[\W_]+", "", unicodedata.normalize("NFKC", text or "").lower())


def channel_of(cand: dict) -> str:
    return cand.get("channel") or cand.get("uploader") or ""


def is_official(cand: dict, artist: str) -> bool:
    """頻道名稱含歌手名（官方頻道，或名稱對得上的 Topic 頻道）。"""
    return bool(norm(artist)) and norm(artist) in norm(channel_of(cand))


def topic_aliases(cands: list[dict], artist: str) -> set[str]:
    """Topic 頻道名稱常是羅馬拼音（Ken Hirai - Topic），對不上原文歌手名。
    官方頻道上傳的音源說明欄是「歌名 · Ken Hirai」，所以出現在官方頻道說明欄裡的 Topic 頻道名稱就是原唱。"""
    # 只比對「· 歌手名」，避免「Provided to YouTube by Walt Disney Records」這種唱片公司名稱誤中
    official_desc = " ".join(
        unicodedata.normalize("NFKC", c.get("description") or "").lower() for c in cands if is_official(c, artist)
    )
    names = set()
    for c in cands:
        ch = channel_of(c)
        name = unicodedata.normalize("NFKC", ch[: -len(" - Topic")]).lower().strip()
        if ch.endswith(" - Topic") and name and f"· {name}" in official_desc:
            names.add(ch)
    return names


def score(cand: dict, title: str, artist: str, rank: int, aliases: set[str]) -> tuple[int, list[str]]:
    """候選影片的分數與警告。"""
    vt = cand.get("title") or ""
    channel = channel_of(cand)
    sec = cand.get("duration")
    pts = -rank * 2  # 搜尋排名越前面越好
    warn = []
    topic = channel.endswith(" - Topic")
    if is_official(cand, artist) or channel in aliases:
        pts += 70 if topic else 60  # Topic 是純音訊，略優於 MV
    elif topic:
        # 可能是羅馬拼音的原唱，也可能是別人的翻唱，需要人工確認
        pts += 15
        warn.append(f"「{channel}」不確定是不是原唱")
    else:
        warn.append("不是官方頻道")
    if norm(vt) == norm(title):
        pts += 30  # Topic 音源的標題就是歌名本身
    elif norm(title) in norm(vt):
        pts += 20
    else:
        pts -= 30
        warn.append("影片標題不含歌名")
    low_t, low_v = unicodedata.normalize("NFKC", title).lower(), unicodedata.normalize("NFKC", vt).lower()
    bad = [w for w in BAD_WORDS if w in low_v and w not in low_t]
    if bad:
        pts -= 40
        warn.append("可能不是原曲：" + "、".join(bad))
    if sec is None:
        pts -= 5
    elif not MIN_SEC <= sec <= MAX_SEC:
        pts -= 30
        warn.append(f"長度 {int(sec)} 秒")
    return pts, warn


def search(query: str, n: int) -> list[dict]:
    import yt_dlp

    opts = {"quiet": True, "no_warnings": True, "extract_flat": "in_playlist", "skip_download": True}
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(f"ytsearch{n}:{query}", download=False)
    return [e for e in (info.get("entries") or []) if e and e.get("id")]


def pick(song: dict, n: int) -> dict | None:
    # 一般搜尋多半是 MV；加上 Topic 音源說明欄固定會有的「Provided to YouTube by」才容易搜到純音訊
    ranks: dict[str, int] = {}
    cands: dict[str, dict] = {}
    for query in (f"{song['a']} {song['t']}", f"{song['a']} {song['t']} \"Provided to YouTube by\""):
        for rank, cand in enumerate(search(query, n)):
            cands.setdefault(cand["id"], cand)
            ranks[cand["id"]] = min(rank, ranks.get(cand["id"], rank))
    if not cands:
        return None
    aliases = topic_aliases(list(cands.values()), song["a"])
    scored = []
    for vid, cand in cands.items():
        rank = ranks[vid]
        pts, warn = score(cand, song["t"], song["a"], rank, aliases)
        scored.append((pts, rank, cand, warn))
    pts, _, cand, warn = max(scored, key=lambda x: (x[0], -x[1]))
    yt = {
        "title": cand.get("title"),
        "channel": cand.get("channel") or cand.get("uploader"),
        "sec": int(cand["duration"]) if cand.get("duration") else None,
    }
    if warn:
        yt["warn"] = warn
    return {"url": normalize_source(f"https://www.youtube.com/watch?v={cand['id']}"), "_yt": yt}


def main() -> None:
    parser = argparse.ArgumentParser(description="替我不會唱歌的 songs.json 自動找 YouTube 網址")
    parser.add_argument("--songs", default=str(HERE / "songs.json"), help="清單（預設 songs.json）")
    parser.add_argument("--region", action="append", help="從歌單加入此地區的歌（ja/zh/ko/en，可重複）")
    parser.add_argument("--category", action="append", help="從歌單加入此分類的歌（anime/screen/pop/idol/net/classic，可重複）")
    parser.add_argument("--decade", action="append", type=int, help="從歌單加入此年代的歌（例如 1990，可重複）")
    parser.add_argument("--id", action="append", help="從歌單加入指定 id（例如 ja:紅蓮華，可重複）")
    parser.add_argument("--all", action="store_true", help="加入整份歌單")
    parser.add_argument("--redo", action="append", help="重新搜尋指定 id（會覆蓋原本的 url）")
    parser.add_argument("--limit", type=int, default=0, help="這次最多搜尋幾首（0＝不限）")
    parser.add_argument("--candidates", type=int, default=8, help="每首看前幾個搜尋結果（預設 8）")
    args = parser.parse_args()

    catalog = song_catalog()
    path = Path(args.songs)
    entries = load_entries(path)
    have = {e.get("id") for e in entries}

    # 1. 從歌單加入
    if args.all or args.region or args.category or args.decade or args.id:
        for bad in [i for i in (args.id or []) if i not in catalog]:
            log(f"歌單裡沒有 {bad}，略過")
        added = 0
        for sid, s in catalog.items():
            if sid in have:
                continue
            if args.id and sid not in args.id:
                continue
            if args.region and s["r"] not in args.region:
                continue
            if args.category and s["c"] not in args.category:
                continue
            if args.decade and s["y"] // 10 * 10 not in args.decade:
                continue
            entries.append({"id": sid})
            have.add(sid)
            added += 1
        log(f"從歌單加入 {added} 首（清單共 {len(entries)} 首）")
        save_entries(path, entries)

    # 2. 搜尋還沒有網址的歌
    redo = set(args.redo or [])
    todo = [e for e in entries if (not e.get("url") and not e.get("file")) or e.get("id") in redo]
    if args.limit:
        todo = todo[: args.limit]
    warned = []
    for i, entry in enumerate(todo, 1):
        song = dict(catalog.get(entry.get("id", ""), {}))
        song.update({k: entry[k] for k in ("t", "a") if k in entry})
        if not song.get("t") or not song.get("a"):
            log(f"[{i}/{len(todo)}] {entry.get('id') or entry}：歌單裡找不到，請自己填 t／a 或 url")
            continue
        log(f"[{i}/{len(todo)}] {song['t']} — {song['a']}")
        try:
            found = pick(song, args.candidates)
        except Exception as exc:  # 單首失敗不影響其他首
            log(f"    搜尋失敗：{exc}")
            continue
        if not found:
            log("    沒有搜尋結果")
            continue
        if found["url"] != entry.get("url"):
            entry.pop("start", None)  # 換了影片，舊的起點不再適用
            entry.pop("_autoStart", None)
        entry.update(found)
        yt = found["_yt"]
        log(f"    {yt['title']}／{yt['channel']}／{yt['sec']} 秒")
        if yt.get("warn"):
            log(f"    ⚠ {'；'.join(yt['warn'])}")
            warned.append(entry.get("id"))
        save_entries(path, entries)  # 每首都存，中途中斷也不會白搜

    missing = sum(1 for e in entries if not e.get("url") and not e.get("file"))
    log(f"完成：搜尋 {len(todo)} 首，清單中還沒有網址的有 {missing} 首")
    if warned:
        log(f"需要人工確認的 {len(warned)} 首：{', '.join(warned)}")
        log("  確認方式：打開網址聽一下；不對就自己改 url，或用 --redo <id> 重新搜尋")


if __name__ == "__main__":
    main()
