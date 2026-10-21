"""我不會唱歌（utau）：把做好的完整題庫包切成手機用的小分包（不重做音檔）。

build_pack.py 的 --split 是依「地區＋分類」拆，最大的一包仍有 300MB 以上；
手機瀏覽器一次匯入太大的檔案容易記憶體不足或超過儲存配額而失敗，所以另外切成每包不超過 --max-mb 的分包。
遊戲匯入時以歌曲 id 合併，全部匯入後與完整包相同；同一首歌的所有版本一定放在同一包。

依「地區＋分類」排序後依序裝箱：相鄰的小分類會併成同一包（減少匯入次數），檔名列出包含的分類，
例如 out/phone/utau_phone_01_en-pop+en-screen+ja-anime.zip。
每次執行會先清掉 out/phone/ 裡舊的 utau_phone_*.zip。

用法：
  tools/utau_clips/.venv/Scripts/python.exe tools/utau_clips/split_pack.py
  ... split_pack.py --max-mb 150                    # 每包上限（預設 100）
  ... split_pack.py --pack out/utau_pack.zip --out out/phone
"""

from __future__ import annotations

import argparse
import json
import sys
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "out"


def chunk(songs: list[dict], sizes: dict[str, int], limit: int) -> list[list[dict]]:
    """依原本順序裝箱，超過上限就開新的一包（單首超過上限時自己一包）。"""
    parts: list[list[dict]] = []
    cur: list[dict] = []
    cur_size = 0
    for song in songs:
        size = sum(sizes[arc] for arc in song["clips"].values())
        if cur and cur_size + size > limit:
            parts.append(cur)
            cur, cur_size = [], 0
        cur.append(song)
        cur_size += size
    if cur:
        parts.append(cur)
    return parts


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="把完整題庫包切成手機用的小分包")
    parser.add_argument("--pack", default=str(OUT / "utau_pack.zip"), help="完整題庫包（預設 out/utau_pack.zip）")
    parser.add_argument("--out", default=str(OUT / "phone"), help="輸出資料夾（預設 out/phone）")
    parser.add_argument("--max-mb", type=float, default=100.0, help="每包上限 MB（預設 100）")
    args = parser.parse_args()

    src = Path(args.pack)
    out_dir = Path(args.out)
    limit = int(args.max_mb * 1024 * 1024)
    with zipfile.ZipFile(src) as zf:
        manifest = json.loads(zf.read("manifest.json"))
        sizes = {info.filename: info.file_size for info in zf.infolist()}
        songs = sorted(manifest["songs"], key=lambda song: f"{song['r']}-{song['c']}")  # sorted 是穩定排序，同分類維持原順序

        out_dir.mkdir(parents=True, exist_ok=True)
        for old in out_dir.glob("utau_phone_*.zip"):
            old.unlink()
        n = 0
        total_mb = 0.0
        for part in chunk(songs, sizes, limit):
            n += 1
            label = "+".join(dict.fromkeys(f"{song['r']}-{song['c']}" for song in part))
            dest = out_dir / f"utau_phone_{n:02d}_{label}.zip"
            # 與 build_pack.py 相同：STORED（不壓縮），瀏覽器端的讀取器只支援這種格式
            with zipfile.ZipFile(dest, "w", compression=zipfile.ZIP_STORED) as out:
                out.writestr("manifest.json", json.dumps(dict(manifest, songs=part), ensure_ascii=False, indent=1))
                for arc in sorted({arc for song in part for arc in song["clips"].values()}):
                    out.writestr(zipfile.ZipInfo(arc, date_time=zf.getinfo(arc).date_time), zf.read(arc))
            mb = dest.stat().st_size / 1024 / 1024
            total_mb += mb
            print(f"  {dest.name}：{len(part)} 首（{mb:.1f} MB）")
    print(f"完成：{len(manifest['songs'])} 首切成 {n} 包（共 {total_mb:.1f} MB）→ {out_dir}")


if __name__ == "__main__":
    main()
