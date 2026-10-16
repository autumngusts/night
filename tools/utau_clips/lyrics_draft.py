"""我不會唱歌（utau）：用 Whisper 聽寫題目片段的原曲歌詞，寫成 lyrics.json 的草稿。

流程：
  1. build_pack.py 先做出片段（需要 cache 裡的 vocal.m4a）。
  2. 本工具聽寫歌詞＋每句開始時間 → lyrics.json（每句只有 ja／t，zh 與 sing 留空）。
  3. 在對話中請 Claude 校對聽寫、填上 voice（原唱 male／female）、中文直譯 zh、中文填詞 sing。
  4. 再跑一次 build_pack.py，就會做出 zh_read／zh_sing／zh_sing_inst。

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
        f'  {json.dumps(sid, ensure_ascii=False)}: {{"start": {v["start"]}, "voice": {json.dumps(v.get("voice", ""))}, "lines": [\n'
        + ",\n".join("    " + json.dumps(l, ensure_ascii=False) for l in v["lines"]) + "\n  ]}"
        for sid, v in data.items()
    )
    zh_voice.LYRICS.write_text("{\n" + body + "\n}\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="聽寫題目片段的歌詞，寫成 lyrics.json 草稿")
    parser.add_argument("--only", action="append", help="只處理指定 id（可重複）")
    parser.add_argument("--redo", action="store_true", help="已經有的也重新聽寫（會覆蓋該首的譯詞！）")
    parser.add_argument("--model", default="medium", help="Whisper 模型（預設 medium）")
    parser.add_argument("--clip", type=float, default=15.0)
    args = parser.parse_args()

    from faster_whisper import WhisperModel

    lyrics = zh_voice.load_lyrics()
    entries = bp.load_entries(bp.HERE / "songs.json")
    model = None
    for e in entries:
        sid = e.get("id")
        if not sid or e.get("start") is None or (args.only and sid not in args.only):
            continue
        old = lyrics.get(sid)
        if old and not args.redo and abs(float(old.get("start", -1)) - float(e["start"])) < 0.01:
            continue
        src = bp.normalize_source(e["url"]) if e.get("url") else str(e.get("file"))
        clip_dir = bp.CACHE / "clips" / f"{bp.source_key(src)}-{float(e['start']):g}-{args.clip:g}-r{bp.RECIPE}"
        if not (clip_dir / "vocal.m4a").exists():
            bp.log(f"{sid}：還沒有片段（請先跑 build_pack.py），略過")
            continue
        if model is None:
            bp.log(f"載入 Whisper {args.model}…")
            model = WhisperModel(args.model, device="cpu", compute_type="int8")
        lang = {"ja": "ja", "zh": "zh", "ko": "ko", "en": "en"}.get(sid.split(":")[0], "ja")
        lines = transcribe(model, bp.load_audio(clip_dir / "vocal.m4a"), lang)
        lyrics[sid] = {"start": float(e["start"]), "voice": (old or {}).get("voice", ""), "lines": lines}
        bp.log(f"{sid}：{len(lines)} 句　" + "／".join(l["ja"] for l in lines))
        save_lyrics(lyrics)
    pending = [sid for sid, v in lyrics.items() if not all(zh_voice.ready(v)) or not v.get("voice")]
    if pending:
        bp.log(f"還沒填完中文（或 voice）的：{', '.join(pending)}")


if __name__ == "__main__":
    main()
