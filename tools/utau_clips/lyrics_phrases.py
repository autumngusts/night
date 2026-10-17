"""我不會唱歌（utau）：填詞輔助。列出每首 AI 歌聲片段的原唱樂句與 Whisper 逐字時間，方便決定每句的 t 與字數。

lyrics_draft.py 的草稿常把十幾秒連成一句、英文一字一行；填詞時需要知道：
  - 樂句：CREPE 音符之間停頓 ≥ 0.25 秒就切開，印出 [開始-結束]、音符數、人聲發音起點數（＝這句大約要填幾個字／音拍）
  - W：Whisper 逐字時間戳記（開始秒:字）

用法（需要先跑過 lyrics_draft.py，才有 lyrics.json 的該首與 30 秒人聲）：
  tools/utau_clips/.venv/Scripts/python.exe tools/utau_clips/lyrics_phrases.py ja:紅蓮華 zh:晴天 > cache/phrases.txt
"""

from __future__ import annotations

import sys

import numpy as np

import build_pack as bp
import zh_voice


def phrases(notes: list, gap: float = 0.25) -> list[list]:
    out, cur = [], []
    for n in notes:
        if cur and n[0] - (cur[-1][0] + cur[-1][1]) >= gap:
            out.append(cur)
            cur = []
        cur.append(n)
    if cur:
        out.append(cur)
    return out


def main() -> None:
    import librosa
    from faster_whisper import WhisperModel

    lyrics = zh_voice.load_lyrics()
    entries = {e["id"]: e for e in bp.load_entries(bp.HERE / "songs.json") if e.get("id")}
    model = None
    for sid in sys.argv[1:]:
        e, v = entries[sid], lyrics[sid]
        src = bp.normalize_source(e["url"]) if e.get("url") else str(e.get("file"))
        clip_dir = bp.CACHE / "clips" / f"{bp.source_key(src)}-{float(e['start']):g}-15-r{bp.RECIPE}"
        clip = float(v.get("clip") or 15)
        stems = clip_dir / f"long{clip:g}" if clip > 15.01 else clip_dir
        vocals = bp.load_audio(stems / "vocal.m4a")
        ot, _ = zh_voice._onsets(vocals)
        print(f"## {sid}  voice={v.get('voice')!r}")
        for p in phrases(bp.crepe_notes(vocals)):
            s, t = p[0][0], p[-1][0] + p[-1][1]
            k = int(((ot >= s - 0.08) & (ot < t - 0.1)).sum())
            print(f"  [{s:5.2f}-{t:5.2f}] 音符{len(p):2d} 起點{k:2d} 中位音{int(np.median([x[2] for x in p]))}")
        if model is None:
            model = WhisperModel("medium", device="cpu", compute_type="int8")
        y16 = librosa.resample(vocals.mean(axis=1), orig_sr=bp.SR, target_sr=16000).astype(np.float32)
        segs, _ = model.transcribe(y16, language=sid.split(":")[0], beam_size=5, word_timestamps=True,
                                   condition_on_previous_text=False)
        words = [w for s in segs for w in (s.words or [])]
        print("  W: " + " ".join(f"{w.start:.1f}:{w.word.strip()}" for w in words))
        sys.stdout.flush()


if __name__ == "__main__":
    main()
