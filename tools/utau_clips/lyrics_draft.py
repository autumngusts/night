"""我不會唱歌（utau）：用 Whisper 聽寫題目片段的原曲歌詞，寫成 lyrics.json 的草稿。

流程：
  1. build_pack.py 先做出片段（需要 cache 裡的 vocal.m4a）。
  2. 本工具從同一個起點聽寫 30 秒（build_pack.SING_CLIP，AI 歌聲的長度）的歌詞＋每句開始時間
     → lyrics.json（每句只有 ja／t，zh 與 sing 留空；該首記上 clip: 30）。
     已經填好 15 秒的舊資料：保留原本的句子，只補上 15 秒以後的聽寫（不必重填前半）。
  3. 在對話中請 Claude 校對聽寫、填上 voice（原唱 male／female）、中文直譯 zh（對照用）、中文填詞 sing。
  4. 再跑一次 build_pack.py，就會做出 zh_sing／zh_sing_inst。

lyrics.json 有版權疑慮，不進 Git（已列在 .gitignore）。
用法：
  tools/utau_clips/.venv/Scripts/python.exe tools/utau_clips/lyrics_draft.py [--only ja:紅蓮華] [--redo]
"""

from __future__ import annotations

import argparse
import json

import numpy as np

import build_pack as bp
import zh_voice


def transcribe(model, vocals: np.ndarray, lang: str) -> list[dict]:
    """人聲 → 句子 [{t, ja}]：逐字時間戳記，停頓 ≥ 0.3 秒或（日文）遇到空白就斷句。"""
    import librosa

    y16 = librosa.resample(vocals.mean(axis=1), orig_sr=bp.SR, target_sr=16000).astype(np.float32)
    segs, _ = model.transcribe(y16, language=lang, beam_size=5, word_timestamps=True,
                               condition_on_previous_text=False)
    words = [w for s in segs for w in (s.words or [])]
    lines, cur = [], []
    for w in words:
        gap = cur and w.start - cur[-1].end >= 0.3
        space = cur and lang == "ja" and w.word.startswith(" ")
        if gap or space:
            lines.append(cur)
            cur = []
        cur.append(w)
    if cur:
        lines.append(cur)
    sep = " " if lang == "en" else ""
    return [{"t": round(float(c[0].start), 2), "ja": sep.join(x.word.strip() for x in c).strip()} for c in lines]


def save_lyrics(data: dict) -> None:
    """一句一行，方便人工編修。"""
    body = ",\n".join(
        f'  {json.dumps(sid, ensure_ascii=False)}: {{"start": {v["start"]}, ' + (f'"clip": {v["clip"]:g}, ' if v.get("clip") else '') + f'"voice": {json.dumps(v.get("voice", ""))}, "lines": [\n'
        + ",\n".join("    " + json.dumps(l, ensure_ascii=False) for l in v["lines"]) + "\n  ]}"
        for sid, v in data.items()
    )
    zh_voice.LYRICS.write_text("{\n" + body + "\n}\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="聽寫題目片段的歌詞，寫成 lyrics.json 草稿")
    parser.add_argument("--only", action="append", help="只處理指定 id（可重複）")
    parser.add_argument("--region", action="append", help="只處理指定地區（ja／zh／ko／en，可重複）")
    parser.add_argument("--redo", action="store_true", help="已經有的也重新聽寫（會覆蓋該首的譯詞！）")
    parser.add_argument("--model", default="medium", help="Whisper 模型（預設 medium）")
    parser.add_argument("--clip", type=float, default=15.0, help="題目片段的秒數（找快取用，預設 15）")
    parser.add_argument("--length", type=float, default=bp.SING_CLIP, help="聽寫的秒數（預設 30）")
    args = parser.parse_args()

    from faster_whisper import WhisperModel

    lyrics = zh_voice.load_lyrics()
    catalog = bp.song_catalog()
    entries = bp.load_entries(bp.HERE / "songs.json")
    model = None
    for e in entries:
        sid = e.get("id")
        if not sid or e.get("start") is None or e.get("exclude") or (args.only and sid not in args.only):
            continue
        if args.region and sid.split(":")[0] not in args.region:
            continue
        old = lyrics.get(sid)
        same = old and abs(float(old.get("start", -1)) - float(e["start"])) < 0.01
        if same and not args.redo and float(old.get("clip") or args.clip) >= args.length - 0.01:
            continue
        keep = old["lines"] if same and not args.redo else []  # 舊的 15 秒資料：保留已填好的句子
        src = bp.normalize_source(e["url"]) if e.get("url") else str(e.get("file"))
        clip_dir = bp.CACHE / "clips" / f"{bp.source_key(src)}-{float(e['start']):g}-{args.clip:g}-r{bp.RECIPE}"
        if not (clip_dir / "vocal.m4a").exists():
            bp.log(f"{sid}：還沒有片段（請先跑 build_pack.py），略過")
            continue
        song = bp.resolve_entry(e, catalog)
        try:
            stems = bp.long_stems(song, {"start": float(e["start"]), "dir": clip_dir}, args.length)
        except Exception as exc:
            bp.log(f"{sid}：分離 {args.length:g} 秒失敗（{exc}），略過")
            continue
        if model is None:
            bp.log(f"載入 Whisper {args.model}…")
            model = WhisperModel(args.model, device="cpu", compute_type="int8")
        lang = {"ja": "ja", "zh": "zh", "ko": "ko", "en": "en"}.get(sid.split(":")[0], "ja")
        lines = transcribe(model, bp.load_audio(stems / "vocal.m4a"), lang)
        if keep:
            last = max(l["t"] for l in keep)
            lines = keep + [l for l in lines if l["t"] >= max(args.clip - 0.5, last + 0.5)]
        lyrics[sid] = {"start": float(e["start"]), "clip": args.length, "voice": (old or {}).get("voice", ""), "lines": lines}
        bp.log(f"{sid}：{len(lines)} 句　" + "／".join(l["ja"] for l in lines))
        save_lyrics(lyrics)
    pending = [sid for sid, v in lyrics.items() if not all(zh_voice.ready(v)) or not v.get("voice")]
    if pending:
        bp.log(f"還沒填完中文（或 voice）的：{', '.join(pending)}")


if __name__ == "__main__":
    main()
