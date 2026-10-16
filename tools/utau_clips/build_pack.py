"""我不會唱歌（utau）進階模式：題庫包製作工具。

在本機把 YouTube 連結（或本機音檔）轉成題庫包 zip，主持人在遊戲畫面匯入後離線播放。
音檔不進 Git、不上網（使用者指定：本機題庫包）。

每首歌製作的版本：
  original      原曲（結算後公布答案時播放）
  instrumental  純樂器：Demucs 去掉人聲
  vocal         純人聲：Demucs 只留人聲（幾乎沒有人聲的曲子會略過）
  speed         變速變調：整段加速升調或放慢降調
  rhythm        只留鼓＋貝斯
  melody        八音盒／8bit 旋律版：人聲旋律用 pYIN 轉成音符後重新合成（偶爾會轉錯）

用法（詳見同目錄 README.md）：
  tools/utau_clips/.venv/Scripts/python.exe tools/utau_clips/build_pack.py
"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
import zipfile
from pathlib import Path

import numpy as np
import soundfile as sf

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
SONGS_JS = ROOT / "static_src" / "utau_songs.js"
CACHE = HERE / "cache"
OUT = HERE / "out"
SR = 44100
PAD = 1.0  # 分離時前後多留的秒數（給 Demucs 上下文，成品會剪掉）
VARIANTS = ("original", "instrumental", "vocal", "speed", "rhythm", "melody")
PACK_FORMAT = "pritest-utau-pack"
PACK_VERSION = 1


# Windows 主控台預設 cp932／cp950，印中日文會出錯
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def log(msg: str) -> None:
    print(msg, flush=True)


def ffmpeg_exe() -> str:
    import imageio_ffmpeg

    return imageio_ffmpeg.get_ffmpeg_exe()


def run_ffmpeg(args: list[str]) -> None:
    subprocess.run([ffmpeg_exe(), "-hide_banner", "-loglevel", "error", "-y", *args], check=True)


# ---------------- 歌曲資料 ----------------


def song_catalog() -> dict[str, dict]:
    """用 node 讀出 static_src/utau_songs.js 的歌單（id → 歌曲資料）。"""
    script = (
        "var fs=require('fs');var w={};"
        "new Function('window',fs.readFileSync(process.argv[1],'utf8'))(w);"
        "process.stdout.write(JSON.stringify(w.PriTestUtauSongs.songs));"
    )
    out = subprocess.run(["node", "-e", script, str(SONGS_JS)], check=True, capture_output=True)
    return {s["id"]: s for s in json.loads(out.stdout.decode("utf-8"))}


def resolve_entry(entry: dict, catalog: dict[str, dict]) -> dict:
    """songs.json 的一筆 → 完整歌曲資料。id 對得到歌單就沿用歌單的歌名等欄位，也可以全部自己寫。"""
    if not entry.get("url") and not entry.get("file"):
        raise ValueError(f"需要 url 或 file：{entry}")
    base = dict(catalog.get(entry.get("id", ""), {}))
    for key in ("t", "a", "y", "r", "c"):
        if key in entry:
            base[key] = entry[key]
    missing = [k for k in ("t", "a", "y", "r", "c") if k not in base]
    if missing:
        raise ValueError(f"{entry.get('id') or entry}：歌單裡找不到這個 id，請補上欄位 {missing}")
    base["id"] = entry.get("id") or f"{base['r']}:{base['t']}"
    base["source"] = entry.get("url") or str(Path(entry["file"]).resolve())
    base["start"] = entry.get("start")
    return base


def source_key(source: str) -> str:
    return hashlib.sha1(source.encode("utf-8")).hexdigest()[:12]


# ---------------- 下載與讀取 ----------------


def fetch_source(song: dict) -> Path:
    """下載（或轉檔）成 44.1kHz 立體聲 wav，結果存在 cache/src/。"""
    key = source_key(song["source"])
    wav = CACHE / "src" / f"{key}.wav"
    if wav.exists():
        return wav
    wav.parent.mkdir(parents=True, exist_ok=True)
    src = song["source"]
    if src.startswith("http"):
        import yt_dlp

        dl_dir = CACHE / "dl"
        dl_dir.mkdir(parents=True, exist_ok=True)
        opts = {
            "format": "bestaudio/best",
            "outtmpl": str(dl_dir / f"{key}.%(ext)s"),
            "noplaylist": True,
            "quiet": True,
            "no_warnings": True,
            "ffmpeg_location": ffmpeg_exe(),
        }
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(src, download=True)
            src = ydl.prepare_filename(info)
    run_ffmpeg(["-i", src, "-vn", "-ac", "2", "-ar", str(SR), str(wav)])
    return wav


def load_audio(path: Path) -> np.ndarray:
    audio, sr = sf.read(str(path), dtype="float32", always_2d=True)
    assert sr == SR, sr
    if audio.shape[1] == 1:
        audio = np.repeat(audio, 2, axis=1)
    return audio[:, :2]


# ---------------- 副歌位置 ----------------


def pick_start(audio: np.ndarray, clip: float) -> float:
    """沒指定 start 時：在全曲 25%〜75% 之間找平均音量最大的一段（通常是副歌）。"""
    total = len(audio) / SR
    if total <= clip + 2 * PAD:
        return 0.0
    mono = audio.mean(axis=1)
    hop = SR // 2  # 0.5 秒一格
    n = len(mono) // hop
    rms = np.sqrt(np.mean(mono[: n * hop].reshape(n, hop) ** 2, axis=1))
    win = int(clip * 2)
    sums = np.convolve(rms, np.ones(win), mode="valid")  # sums[i] = 從 i*0.5 秒開始的 clip 秒
    lo = max(int(total * 0.25 * 2), int(PAD * 2))
    hi = min(int(total * 0.75 * 2), len(sums) - 1 - int(PAD * 2))
    if hi <= lo:
        return max(0.0, (total - clip) / 2)
    best = lo + int(np.argmax(sums[lo:hi + 1]))
    return best / 2


# ---------------- 音源分離 ----------------

_MODEL = None


def separate(segment: np.ndarray) -> dict[str, np.ndarray]:
    """Demucs（htdemucs）分成 drums / bass / other / vocals。"""
    global _MODEL
    import torch
    from demucs.apply import apply_model
    from demucs.pretrained import get_model

    if _MODEL is None:
        _MODEL = get_model("htdemucs")
        _MODEL.eval()
    wav = torch.from_numpy(np.ascontiguousarray(segment.T)).float()
    ref = wav.mean(0)
    mean, std = ref.mean(), ref.std() + 1e-8
    with torch.no_grad():
        out = apply_model(_MODEL, ((wav - mean) / std)[None], device="cpu", progress=False)[0]
    out = out * std + mean
    return {name: out[i].numpy().T.astype(np.float32) for i, name in enumerate(_MODEL.sources)}


# ---------------- 旋律合成 ----------------


def extract_notes(vocals: np.ndarray) -> list[tuple[float, float, int]]:
    """人聲 → (開始秒, 長度秒, MIDI 音高) 的音符列表。"""
    import librosa

    sr = 22050
    y = librosa.resample(vocals.mean(axis=1), orig_sr=SR, target_sr=sr)
    hop = 256
    f0, voiced, prob = librosa.pyin(
        y, fmin=librosa.note_to_hz("C2"), fmax=librosa.note_to_hz("C6"), sr=sr, frame_length=2048, hop_length=hop
    )
    midi = np.where(voiced & (prob > 0.3), np.round(librosa.hz_to_midi(np.nan_to_num(f0, nan=1.0))), 0).astype(int)
    # 中值濾波去掉一兩格的抖動
    smooth = midi.copy()
    for i in range(2, len(midi) - 2):
        smooth[i] = int(np.median(midi[i - 2:i + 3]))
    notes = []
    frame = hop / sr
    i = 0
    while i < len(smooth):
        j = i
        while j < len(smooth) and smooth[j] == smooth[i]:
            j += 1
        if smooth[i] > 0 and (j - i) * frame >= 0.08:
            notes.append((i * frame, (j - i) * frame, int(smooth[i])))
        i = j
    return notes


def synth_melody(notes: list[tuple[float, float, int]], length: float, timbre: str) -> np.ndarray:
    """音符 → 單聲道音訊。musicbox：衰減的正弦＋泛音；chip：方波（8bit）。"""
    out = np.zeros(int(length * SR), dtype=np.float32)
    if not notes:
        return out
    # 移八度，讓旋律落在該音色好聽的音域
    center = 76 if timbre == "musicbox" else 69
    shift = 12 * round((center - float(np.median([n[2] for n in notes]))) / 12)
    for start, dur, pitch in notes:
        freq = 440.0 * 2 ** ((pitch + shift - 69) / 12)
        if timbre == "musicbox":
            ring = max(dur, 0.6)
            t = np.arange(int(ring * SR)) / SR
            wave = np.sin(2 * np.pi * freq * t) + 0.3 * np.sin(4 * np.pi * freq * t) + 0.08 * np.sin(8 * np.pi * freq * t)
            env = np.exp(-t / 0.35) * np.minimum(1.0, t / 0.004)
        else:
            t = np.arange(int(dur * SR)) / SR
            wave = np.sign(np.sin(2 * np.pi * freq * t)) * 0.5
            env = np.minimum(1.0, t / 0.005) * np.minimum(1.0, (dur - t) / 0.02 + 1e-3).clip(0, 1)
        seg = (wave * env).astype(np.float32)
        a = int(start * SR)
        b = min(len(out), a + len(seg))
        if b > a:
            out[a:b] += seg[: b - a]
    return out


# ---------------- 混音與輸出 ----------------


def finish(audio: np.ndarray) -> np.ndarray:
    """淡入淡出＋音量統一（RMS 約 -18dBFS，峰值不超過 0.95）。"""
    audio = audio.astype(np.float32).copy()
    if audio.ndim == 1:
        audio = audio[:, None]
    fade = int(0.3 * SR)
    ramp = np.linspace(0, 1, fade, dtype=np.float32)[:, None]
    audio[:fade] *= ramp
    audio[-fade:] *= ramp[::-1]
    rms = float(np.sqrt(np.mean(audio ** 2))) + 1e-9
    gain = (10 ** (-18 / 20)) / rms
    peak = float(np.max(np.abs(audio))) * gain
    if peak > 0.95:
        gain *= 0.95 / peak
    return audio * gain


def rms_db(audio: np.ndarray) -> float:
    return 20 * np.log10(float(np.sqrt(np.mean(audio ** 2))) + 1e-9)


def encode(audio: np.ndarray, dest: Path, tmp: Path, filters: str | None = None) -> None:
    """wav → AAC（.m4a，所有瀏覽器都能播）。"""
    sf.write(str(tmp), audio, SR)
    args = ["-i", str(tmp)]
    if filters:
        args += ["-af", filters]
    args += ["-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", str(dest)]
    run_ffmpeg(args)


def speed_filter(key: str) -> str:
    """變速變調：依歌曲固定選「快＋升 3 半音」或「慢＋降 3 半音」。"""
    fast = int(key, 16) % 2 == 0
    tempo, semis = (1.3, 3) if fast else (0.8, -3)
    ratio = 2 ** (semis / 12)
    return f"asetrate={SR}*{ratio:.6f},aresample={SR},atempo={tempo / ratio:.6f}"


def build_song(song: dict, clip: float) -> dict:
    wav = fetch_source(song)
    audio = load_audio(wav)
    start = float(song["start"]) if song["start"] is not None else pick_start(audio, clip)
    key = source_key(song["source"])
    out_dir = CACHE / "clips" / f"{key}-{start:g}-{clip:g}"
    meta_path = out_dir / "clips.json"
    if meta_path.exists():
        return {"start": start, "dir": out_dir, "clips": json.loads(meta_path.read_text(encoding="utf-8"))}
    out_dir.mkdir(parents=True, exist_ok=True)

    a = max(0, int((start - PAD) * SR))
    b = min(len(audio), int((start + clip + PAD) * SR))
    segment = audio[a:b]
    lead = int(start * SR) - a
    body = slice(lead, lead + int(clip * SR))

    log("    分離音源…")
    stems = separate(segment)
    tmp = out_dir / "tmp.wav"
    made = []

    def write(name: str, data: np.ndarray, filters: str | None = None) -> None:
        encode(finish(data), out_dir / f"{name}.m4a", tmp, filters)
        made.append(name)

    write("original", segment[body])
    write("instrumental", (stems["drums"] + stems["bass"] + stems["other"])[body])
    write("rhythm", (stems["drums"] + stems["bass"])[body])
    write("speed", segment[body], speed_filter(key))
    vocals = stems["vocals"][body]
    if rms_db(vocals) > -40:
        write("vocal", vocals)
        log("    擷取旋律…")
        notes = extract_notes(vocals)
        if len(notes) >= 4:
            timbre = "musicbox" if int(key, 16) % 3 else "chip"
            write("melody", synth_melody(notes, clip, timbre))
        else:
            log("    旋律音符太少，略過八音盒／8bit 版")
    else:
        log("    幾乎沒有人聲，略過純人聲與旋律版")
    tmp.unlink(missing_ok=True)
    meta_path.write_text(json.dumps(made), encoding="utf-8")
    return {"start": start, "dir": out_dir, "clips": made}


def main() -> None:
    parser = argparse.ArgumentParser(description="製作我不會唱歌的進階模式題庫包")
    parser.add_argument("--songs", default=str(HERE / "songs.json"), help="輸入清單（預設 songs.json）")
    parser.add_argument("--clip", type=float, default=15.0, help="每段秒數（預設 15）")
    parser.add_argument("--out", default=str(OUT / "utau_pack.zip"), help="輸出的題庫包")
    parser.add_argument("--only", action="append", help="只處理指定 id（可重複）")
    args = parser.parse_args()

    catalog = song_catalog()
    entries = json.loads(Path(args.songs).read_text(encoding="utf-8"))
    songs = [resolve_entry(e, catalog) for e in entries]
    if args.only:
        songs = [s for s in songs if s["id"] in args.only]
    if not songs:
        sys.exit("清單是空的：請在 songs.json 加入歌曲")

    manifest = {"format": PACK_FORMAT, "version": PACK_VERSION, "clipSeconds": args.clip, "songs": []}
    files: list[tuple[Path, str]] = []
    failed = []
    for i, song in enumerate(songs, 1):
        log(f"[{i}/{len(songs)}] {song['t']} — {song['a']}")
        try:
            res = build_song(song, args.clip)
        except Exception as exc:  # 單首失敗不影響其他首
            log(f"    失敗：{exc}")
            failed.append(song["id"])
            continue
        folder = source_key(song["source"])
        clips = {}
        for name in res["clips"]:
            arc = f"clips/{folder}/{name}.m4a"
            files.append((res["dir"] / f"{name}.m4a", arc))
            clips[name] = arc
        manifest["songs"].append({
            "id": song["id"], "t": song["t"], "a": song["a"], "y": song["y"], "r": song["r"], "c": song["c"],
            "start": res["start"], "clips": clips,
        })
        log(f"    起點 {res['start']:g} 秒：{', '.join(res['clips'])}")

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    # 音檔本來就壓縮過，用 STORED（不壓縮）：瀏覽器端的讀取器只支援這種格式
    with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_STORED) as zf:
        zf.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=1))
        for src, arc in files:
            zf.write(src, arc)
    size = out.stat().st_size / 1024 / 1024
    log(f"完成：{len(manifest['songs'])} 首 → {out}（{size:.1f} MB）")
    if failed:
        log(f"失敗 {len(failed)} 首：{', '.join(failed)}")


if __name__ == "__main__":
    main()
