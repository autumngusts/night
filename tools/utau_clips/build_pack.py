"""我不會唱歌（utau）進階模式：題庫包製作工具。

在本機把 YouTube 連結（或本機音檔）轉成題庫包 zip，主持人在遊戲畫面匯入後離線播放。
音檔不進 Git、不上網（使用者指定：本機題庫包）。

每首歌製作的版本：
  original      原曲（結算後公布答案時播放）
  instrumental  純樂器：Demucs 去掉人聲
  vocal         純人聲：Demucs 只留人聲（幾乎沒有人聲的曲子會略過）
  other         只有旋律樂器：Demucs 的 other（拿掉人聲、鼓、貝斯）
  speed         極端變快：1.5 倍速＋升 6 半音
  chip          8bit 旋律：人聲旋律用 CREPE 辨識成音符，再用脈衝波（紅白機音色）演奏
  vocal_rev     人聲倒放：伴奏正常、人聲倒著放
  rhythm        只留鼓＋貝斯
  reverse       整段倒放
  zh_sing       中文歌聲：DiffSinger 聲庫用中文填詞唱原曲旋律（需要 lyrics.json 的填詞與 models/ 的聲庫）；
                長度跟著 lyrics.json 的 clip（新聽寫的是 30 秒，其他版本維持 15 秒）
  zh_sing_inst  中文歌聲＋伴奏（遊戲中播放 5 次後可用的提示，不是獨立的題目版本）
  ja_sing       日文歌聲：VOICEVOX 角色用日文填詞唱原曲旋律（華語歌用；需要 lyrics.json 的 ja_sing 與 VOICEVOX ENGINE）
  ja_sing_inst  日文歌聲＋伴奏（提示）

用法（詳見同目錄 README.md）：
  tools/utau_clips/.venv/Scripts/python.exe tools/utau_clips/build_pack.py
"""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import os
import re
import subprocess
import sys
import time
import zipfile
from pathlib import Path

import warnings

# Demucs 模型由 huggingface_hub 下載；Windows 沒有 symlink 權限、沒設 HF_TOKEN 時會洗版警告，與製作結果無關
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
os.environ.setdefault("HF_HUB_VERBOSITY", "error")
warnings.filterwarnings("ignore", module="huggingface_hub")

import numpy as np
import soundfile as sf

import ja_voice
import zh_voice

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
SONGS_JS = ROOT / "static_src" / "utau_songs.js"
CACHE = HERE / "cache"
OUT = HERE / "out"
SR = 44100
PAD = 1.0  # 分離時前後多留的秒數（給 Demucs 上下文，成品會剪掉）
# AI 歌聲（zh_sing 等）的長度：使用者試聽後要求中文歌聲拉長到 30 秒（2026-10-17），其他版本維持 --clip（15 秒）
SING_CLIP = 30.0
VARIANTS = ("original", "instrumental", "vocal", "other", "speed", "chip", "zh_sing", "zh_sing_inst",
            "ja_sing", "ja_sing_inst", "vocal_rev", "rhythm", "reverse")
# 製作方式改變時遞增：快取資料夾名稱含此版本，舊成品自動失效
# 2：使用者試聽後，變速改極端變快、拿掉八音盒／8bit、新增 other／vocal_rev／reverse（2026-10-16）
# 3：新增 chip（CREPE 版 8bit 旋律；使用者試聽三種程度後選「只有主旋律」）
RECIPE = 3
# 8bit 旋律（chip）的音色版本：只換音色時遞增這個，而不是 RECIPE（RECIPE 會讓 Demucs 分離與 AI 歌聲全部重做）。
# 快取裡的 chip 沒有對應的 chip-v<版本> 標記檔時，用快取的 vocal.m4a 重新做一次 chip。
# 2：音色由 25% 脈衝波改為柔和方波（使用者試聽 5 種後選定，2026-10-17）
CHIP_VERSION = 2
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


def load_entries(path: Path) -> list[dict]:
    if not path.exists():
        return []
    return json.loads(path.read_text(encoding="utf-8") or "[]")


def save_entries(path: Path, entries: list[dict]) -> None:
    """一首一行寫回清單，方便人工檢查與修改。"""
    lines = [json.dumps(e, ensure_ascii=False) for e in entries]
    body = "[\n  " + ",\n  ".join(lines) + "\n]\n" if lines else "[]\n"
    path.write_text(body, encoding="utf-8")


YOUTUBE_ID = re.compile(
    r"(?:youtube\.com/(?:watch\?(?:.*&)?v=|shorts/|embed/|live/)|youtu\.be/)([A-Za-z0-9_-]{11})"
)


def normalize_source(src: str) -> str:
    """YouTube 的各種網址（youtu.be、shorts、music.youtube、帶 &t= 等）統一成 watch?v=<id>，
    同一支影片才不會因網址寫法不同而重複下載、算出不同的快取雜湊。"""
    m = YOUTUBE_ID.search(src)
    return f"https://www.youtube.com/watch?v={m.group(1)}" if m else src


def resolve_entry(entry: dict, catalog: dict[str, dict]) -> dict:
    """songs.json 的一筆 → 完整歌曲資料。id 對得到歌單就沿用歌單的歌名等欄位，也可以全部自己寫。"""
    if not entry.get("url") and not entry.get("file"):
        raise ValueError(f"{entry.get('id') or entry}：需要 url 或 file（可以先跑 find_urls.py 自動搜尋）")
    base = dict(catalog.get(entry.get("id", ""), {}))
    for key in ("t", "a", "y", "r", "c"):
        if key in entry:
            base[key] = entry[key]
    missing = [k for k in ("t", "a", "y", "r", "c") if k not in base]
    if missing:
        raise ValueError(f"{entry.get('id') or entry}：歌單裡找不到這個 id，請補上欄位 {missing}")
    base["id"] = entry.get("id") or f"{base['r']}:{base['t']}"
    base["source"] = normalize_source(entry["url"]) if entry.get("url") else str(Path(entry["file"]).resolve())
    base["start"] = entry.get("start")
    skip = entry.get("skip") or []
    bad = [v for v in skip if v not in VARIANTS or v == "original"]
    if bad:
        raise ValueError(f"{base['id']}：skip 只能填 {list(VARIANTS[1:])}，不認得 {bad}（原曲公布答案要用，不能略過）")
    base["skip"] = list(skip)
    return base


def source_key(source: str) -> str:
    return hashlib.sha1(source.encode("utf-8")).hexdigest()[:12]


# ---------------- 下載與讀取 ----------------


def fetch_source(song: dict) -> Path:
    """YouTube 下載到 cache/dl/（只留原始壓縮檔，一首約 4MB；不另存整首 wav，那一首要 40MB）。本機檔直接回傳。"""
    src = song["source"]
    if not src.startswith("http"):
        return Path(src)
    key = source_key(src)
    dl_dir = CACHE / "dl"
    found = sorted(p for p in dl_dir.glob(f"{key}.*") if not p.name.endswith(".part"))
    if found:
        return found[0]
    import yt_dlp

    dl_dir.mkdir(parents=True, exist_ok=True)
    opts = {
        "format": "bestaudio/best",
        "outtmpl": str(dl_dir / f"{key}.%(ext)s"),
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "ffmpeg_location": ffmpeg_exe(),
    }
    # YouTube 偶爾對個別影片回 HTTP 403（大量連續下載時較常見）：等一下、換播放器用戶端再試（2026-10-17 實測多數重試即成功）
    clients = [None, ["ios"], ["web_safari"], ["tv"]]
    last_exc = None
    for attempt, client in enumerate(clients):
        if client:
            opts["extractor_args"] = {"youtube": {"player_client": client}}
            time.sleep(5 * attempt)
        try:
            with yt_dlp.YoutubeDL(opts) as ydl:
                info = ydl.extract_info(src, download=True)
                return Path(ydl.prepare_filename(info))
        except yt_dlp.utils.DownloadError as exc:
            # 403 之外，換用戶端也可能遇到「格式不可用」，一律換下一個用戶端再試
            last_exc = exc
            if attempt + 1 < len(clients):
                log(f"    下載失敗，換用戶端重試（{attempt + 1}/{len(clients) - 1}）：{str(exc)[:60]}")
    raise last_exc


def load_audio(path: Path) -> np.ndarray:
    """用 ffmpeg 解碼成 44.1kHz 立體聲 float32，直接從管線讀進記憶體。"""
    out = subprocess.run(
        [ffmpeg_exe(), "-hide_banner", "-loglevel", "error", "-i", str(path), "-vn",
         "-ac", "2", "-ar", str(SR), "-f", "f32le", "-"],
        check=True, capture_output=True,
    )
    return np.frombuffer(out.stdout, dtype=np.float32).reshape(-1, 2).copy()


# ---------------- 副歌位置 ----------------


STEP = 0.5  # 副歌偵測的時間解析度（秒）


def _repetition(chroma: np.ndarray, win: int) -> np.ndarray:
    """rep[i] = 從第 i 格開始、長 win 格的片段，與全曲其他不重疊位置最相似的程度（和聲進行的重複度）。"""
    n = chroma.shape[1]
    sim = chroma.T @ chroma
    rep = np.zeros(max(0, n - win + 1))
    kernel = np.ones(win) / win
    for lag in range(win, n - win + 1):
        m = np.convolve(np.diagonal(sim, offset=lag), kernel, mode="valid")  # 片段 i 與片段 i+lag 的相似度
        rep[: len(m)] = np.maximum(rep[: len(m)], m)
        rep[lag: lag + len(m)] = np.maximum(rep[lag: lag + len(m)], m)
    return rep


def _z(x: np.ndarray) -> np.ndarray:
    return (x - x.mean()) / (x.std() + 1e-9)


def pick_start(audio: np.ndarray, clip: float) -> float:
    """沒指定 start 時自動找副歌（2026-10-16 以 Whisper 辨識片段歌詞驗證，見 docs/utau_game_design.md §6.3）。

    1. 分數＝音量（z 分數）＋重複度（z 分數）− 0.6 × 在全曲的位置：副歌大聲、會重複出現；
       只看音量容易選到 C 段或最後一次副歌，加上重複度與「偏好前面」後選到的是第一次完整副歌。
    2. 只在全曲 15%〜80% 之間找（避開前奏、尾奏）。
    3. 從最高分往前退，退到分數仍在最高分 −1 以內的平台開頭（最多 8 秒），讓片段從副歌第一句開始，而不是句子中間。
    4. 對齊到起點前後 1 秒內 onset 最強的拍點。
    """
    import librosa

    total = len(audio) / SR
    if total <= clip + 2 * PAD:
        return 0.0
    sr = 22050
    y = librosa.resample(audio.mean(axis=1), orig_sr=SR, target_sr=sr)
    hop = int(sr * STEP)
    rms = librosa.feature.rms(y=y, frame_length=hop, hop_length=hop, center=False)[0]
    chroma = librosa.feature.chroma_cqt(y=y, sr=sr, hop_length=512)
    per = hop // 512
    n = min(len(rms), chroma.shape[1] // per)
    chroma = chroma[:, : n * per].reshape(12, n, per).mean(axis=2)
    chroma = chroma / (np.linalg.norm(chroma, axis=0, keepdims=True) + 1e-9)

    win = int(clip / STEP)
    loud = np.convolve(rms[:n], np.ones(win) / win, mode="valid")
    rep = _repetition(chroma, win)
    m = min(len(loud), len(rep))
    t = np.arange(m) * STEP
    score = _z(loud[:m]) + _z(rep[:m]) - 0.6 * t / total
    ok = (t >= total * 0.15) & (t <= total * 0.8) & (t >= PAD) & (t + clip + PAD <= total)
    if not ok.any():
        return max(0.0, (total - clip) / 2)
    best = int(np.argmax(np.where(ok, score, -np.inf)))
    i = best
    while i > 0 and ok[i - 1] and (best - i + 1) * STEP <= 8 and score[i - 1] >= score[best] - 1.0:
        i -= 1
    start = i * STEP

    oenv = librosa.onset.onset_strength(y=y, sr=sr, hop_length=512)
    _, beats = librosa.beat.beat_track(onset_envelope=oenv, sr=sr, hop_length=512)
    times = librosa.frames_to_time(beats, sr=sr, hop_length=512)
    near = [(oenv[b], bt) for b, bt in zip(beats, times) if abs(bt - start) <= 1.0 and bt >= PAD]
    if near:
        start = float(max(near)[1])
    return round(start, 2)


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


# ---------------- 8bit 旋律 ----------------


def crepe_notes(vocals: np.ndarray) -> list[tuple[float, float, int]]:
    """人聲 → 音符 [(開始秒, 長度秒, MIDI)]。

    音高用 CREPE（torchcrepe）：舊版 pYIN 在快節奏人聲上大多判為無聲，原唱在唱的時間只有 18〜66% 有音符，
    聽不出是什麼歌；CREPE 提高到 64〜96%，音準（±1 半音）96〜100%（2026-10-16 以 6 首實測）。
    1. 逐格（10ms）音高，periodicity > 0.3 視為有聲，四捨五入成半音，5 格中值濾波。
    2. 同音高之間 ≤ 30ms 的斷訊補起來。
    3. 同音高連續格成一個音，但在人聲的發音起點（onset）切開，保留歌詞的節奏（重複同音的音節）。
    4. 與下一個音間隔 < 0.12 秒就延長補滿；離中位數超過 9 半音的音移八度（八度誤判）。
    """
    import librosa
    import torch
    import torchcrepe

    y16 = librosa.resample(vocals.mean(axis=1), orig_sr=SR, target_sr=16000)
    f0, per = torchcrepe.predict(
        torch.tensor(y16)[None], 16000, hop_length=160, fmin=80, fmax=1000, model="full",
        return_periodicity=True, batch_size=128, device="cpu", decoder=torchcrepe.decode.viterbi,
    )
    f0, per = f0[0].numpy(), per[0].numpy()
    frame = 0.01
    midi = np.where(per > 0.3, np.round(librosa.hz_to_midi(f0)), 0).astype(int)
    sm = midi.copy()
    for i in range(2, len(midi) - 2):
        sm[i] = int(np.median(midi[i - 2:i + 3]))
    i = 0
    while i < len(sm):
        if sm[i]:
            i += 1
            continue
        j = i
        while j < len(sm) and not sm[j]:
            j += 1
        if 0 < i and j < len(sm) and j - i <= 3 and sm[i - 1] == sm[j]:
            sm[i:j] = sm[j]
        i = j
    onsets = {int(o) for o in librosa.onset.onset_detect(y=y16, sr=16000, hop_length=160, backtrack=True, units="frames")}
    notes = []
    i = 0
    while i < len(sm):
        j = i + 1
        while j < len(sm) and sm[j] == sm[i] and j not in onsets:
            j += 1
        if sm[i] > 0 and (j - i) * frame >= 0.06:
            notes.append([i * frame, (j - i) * frame, int(sm[i])])
        i = j
    for a, b in zip(notes, notes[1:]):
        if 0 < b[0] - (a[0] + a[1]) < 0.12:
            a[1] = b[0] - a[0]
    if notes:
        med = np.median([n[2] for n in notes])
        for n in notes:
            n[2] -= 12 * round((n[2] - med) / 12) if abs(n[2] - med) > 9 else 0
    return [tuple(n) for n in notes]


def synth_chip(notes: list[tuple[float, float, int]], length: float) -> np.ndarray:
    """音符 → 柔和方波：50% 方波、起音 12ms、尾音 50ms，再以 2.5kHz 低通去掉刺耳的高頻。
    整體移八度讓旋律中位數落在 D5 附近；長音 0.2 秒後加一點顫音。
    使用者試聽 5 種音色後選此款（舊版 25% 脈衝波太尖銳；三角波、加回音、陶笛未採用，2026-10-17）。"""
    from scipy.signal import butter, sosfilt

    release = 0.05
    out = np.zeros(int((length + release) * SR), dtype=np.float32)
    if not notes:
        return out[: int(length * SR)]
    shift = 12 * round((74 - float(np.median([n[2] for n in notes]))) / 12)
    for start, dur, pitch in notes:
        n = int((dur + release) * SR)
        t = np.arange(n) / SR
        freq = 440.0 * 2 ** ((pitch + shift - 69) / 12)
        depth = np.clip((t - 0.2) / 0.15, 0, 1) * 0.25 if dur > 0.3 else 0.0
        phase = np.cumsum(freq * 2 ** (depth * np.sin(2 * np.pi * 5.5 * t) / 12)) / SR
        wave = np.where(phase % 1.0 < 0.5, 1.0, -1.0)
        env = np.minimum(1.0, t / 0.012) * np.clip((dur + release - t) / release, 0, 1)
        a = int(start * SR)
        b = min(len(out), a + n)
        if b > a:
            out[a:b] += (wave * env)[: b - a].astype(np.float32)
    out = sosfilt(butter(2, 2500, fs=SR, output="sos"), out).astype(np.float32)
    return out[: int(length * SR)]


# ---------------- 中文版（朗讀／歌聲）----------------


def build_zh(song: dict, res: dict, lyrics: dict, clip: float) -> dict[str, Path]:
    """lyrics.json 有這首歌的填詞時，做出 zh_sing／zh_sing_inst／ja_sing／ja_sing_inst。
    長度＝lyrics.json 該首的 clip（舊資料沒有 clip＝與題目片段同長）；比題目片段長時用 long_stems() 另外分離的人聲／伴奏。
    快取在成品資料夾的 zh-<歌詞雜湊>/（歌詞或製作方式改變就重做）。
    （中文朗讀 zh_read 使用者試聽後不採用，2026-10-17 拿掉。）"""
    entry = lyrics.get(song["id"])
    if not entry:
        return {}
    if abs(float(entry.get("start", -1)) - res["start"]) > 0.01:
        log(f"    lyrics.json 的起點（{entry.get('start')}）與這次（{res['start']:g}）不同，略過中文版；請重新聽寫歌詞")
        return {}
    _, can_sing = zh_voice.ready(entry)
    can_ja = ja_voice.ready(entry)
    out_dir = res["dir"] / f"zh-{zh_voice.lyric_key(entry)}"
    want = (["zh_sing", "zh_sing_inst"] if can_sing else []) + (["ja_sing", "ja_sing_inst"] if can_ja else [])
    made = {name: out_dir / f"{name}.m4a" for name in want}
    if all(p.exists() for p in made.values()):
        return made
    out_dir.mkdir(parents=True, exist_ok=True)
    tmp = out_dir / "tmp.wav"
    clip = float(entry.get("clip") or clip)
    stems = long_stems(song, res, clip) if clip > res["clip"] + 0.01 else res["dir"]
    inst = load_audio(stems / "instrumental.m4a").mean(axis=1)
    if can_sing and not (made["zh_sing"].exists() and made["zh_sing_inst"].exists()):
        log("    中文歌聲…")
        vocals = load_audio(stems / "vocal.m4a")
        wav = zh_voice.sing(entry, vocals, crepe_notes(vocals), clip)
        encode(finish(wav), made["zh_sing"], tmp)
        encode(finish(zh_voice.over_backing(wav, inst, 0.5)), made["zh_sing_inst"], tmp)
    if can_ja and not (made["ja_sing"].exists() and made["ja_sing_inst"].exists()):
        log("    日文歌聲（VOICEVOX）…")
        vocals = load_audio(stems / "vocal.m4a")
        wav = ja_voice.sing(entry, vocals, crepe_notes(vocals), clip, load_audio)
        encode(finish(wav), made["ja_sing"], tmp)
        encode(finish(zh_voice.over_backing(wav, inst, 0.5)), made["ja_sing_inst"], tmp)
    tmp.unlink(missing_ok=True)
    return made


def long_stems(song: dict, res: dict, seconds: float) -> Path:
    """從題目片段的同一個起點分離較長的一段（AI 歌聲用），只存人聲與伴奏；快取在成品資料夾的 long<秒數>/。"""
    out_dir = res["dir"] / f"long{seconds:g}"
    if (out_dir / "vocal.m4a").exists() and (out_dir / "instrumental.m4a").exists():
        return out_dir
    log(f"    分離 {seconds:g} 秒的人聲／伴奏（AI 歌聲用）…")
    audio = load_audio(fetch_source(song))
    start = res["start"]
    a = max(0, int((start - PAD) * SR))
    b = min(len(audio), int((start + seconds + PAD) * SR))
    segment = audio[a:b]
    lead = int(start * SR) - a
    body = slice(lead, lead + int(seconds * SR))
    stems = separate(segment)
    n = int(seconds * SR)

    def fit(x: np.ndarray) -> np.ndarray:  # 歌曲結尾不足時補靜音
        return np.pad(x, ((0, max(0, n - len(x))), (0, 0)))[:n]

    out_dir.mkdir(parents=True, exist_ok=True)
    tmp = out_dir / "tmp.wav"
    encode(finish(fit((stems["drums"] + stems["bass"] + stems["other"])[body])), out_dir / "instrumental.m4a", tmp)
    encode(finish(fit(stems["vocals"][body])), out_dir / "vocal.m4a", tmp)
    tmp.unlink(missing_ok=True)
    return out_dir


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


def speed_filter(tempo: float = 1.5, semis: int = 6) -> str:
    """極端變快：asetrate 改音高，再用 atempo 補成指定速度。
    使用者試聽後指定 1.5 倍速＋升 6 半音（舊版 1.3 倍＋3 半音太簡單；放慢版不採用）。"""
    ratio = 2 ** (semis / 12)
    return f"asetrate={SR}*{ratio:.6f},aresample={SR},atempo={tempo / ratio:.6f}"


def refresh_chip(out_dir: Path, clip: float) -> None:
    """快取的 chip 是舊音色時，用同資料夾的 vocal.m4a 重做（音符辨識不變，只換音色）。"""
    chip = out_dir / "chip.m4a"
    mark = out_dir / f"chip-v{CHIP_VERSION}"
    if not chip.exists() or mark.exists():
        return
    log("    8bit 旋律換新音色…")
    notes = crepe_notes(load_audio(out_dir / "vocal.m4a"))
    tmp = out_dir / "tmp.wav"
    encode(finish(synth_chip(notes, clip)), chip, tmp)
    tmp.unlink(missing_ok=True)
    mark.touch()


def build_song(song: dict, clip: float) -> dict:
    key = source_key(song["source"])

    def cached(start: float) -> dict | None:
        out_dir = CACHE / "clips" / f"{key}-{start:g}-{clip:g}-r{RECIPE}"
        meta = out_dir / "clips.json"
        if meta.exists():
            refresh_chip(out_dir, clip)
            return {"start": start, "dir": out_dir, "clip": clip, "clips": json.loads(meta.read_text(encoding="utf-8"))}
        return None

    # 起點已知且做過：不必下載、解碼
    if song["start"] is not None and (hit := cached(float(song["start"]))):
        return hit
    audio = load_audio(fetch_source(song))
    if song["start"] is not None:
        start = float(song["start"])
    else:
        log("    尋找副歌…")
        start = pick_start(audio, clip)
        if hit := cached(start):
            return hit
    out_dir = CACHE / "clips" / f"{key}-{start:g}-{clip:g}-r{RECIPE}"
    meta_path = out_dir / "clips.json"
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

    original = segment[body]
    instrumental = (stems["drums"] + stems["bass"] + stems["other"])[body]
    vocals = stems["vocals"][body]
    other = stems["other"][body]
    write("original", original)
    write("instrumental", instrumental)
    if rms_db(other) > -40:
        write("other", other)
    else:
        log("    幾乎沒有旋律樂器，略過「只有旋律樂器」")
    write("speed", original, speed_filter())
    if rms_db(vocals) > -40:
        write("vocal", vocals)
        log("    擷取旋律…")
        notes = crepe_notes(vocals)
        if len(notes) >= 8:
            write("chip", synth_chip(notes, clip))
            (out_dir / f"chip-v{CHIP_VERSION}").touch()
        else:
            log("    旋律音符太少，略過 8bit 旋律")
        write("vocal_rev", instrumental + vocals[::-1])
    else:
        log("    幾乎沒有人聲，略過純人聲、8bit 旋律與人聲倒放")
    write("rhythm", (stems["drums"] + stems["bass"])[body])
    write("reverse", original[::-1])
    tmp.unlink(missing_ok=True)
    meta_path.write_text(json.dumps(made), encoding="utf-8")
    return {"start": start, "dir": out_dir, "clip": clip, "clips": made}


VARIANT_LABELS = {
    "original": "原曲", "instrumental": "純樂器", "vocal": "純人聲",
    "other": "旋律樂器", "speed": "極端變快", "chip": "8bit 旋律", "vocal_rev": "人聲倒放",
    "zh_sing": "中文歌聲", "zh_sing_inst": "中文歌聲＋伴奏（提示）",
    "ja_sing": "日文歌聲", "ja_sing_inst": "日文歌聲＋伴奏（提示）", "rhythm": "鼓＋貝斯", "reverse": "整段倒放",
}


def write_preview(dest: Path, previews: list[dict]) -> Path:
    """本機試聽頁：每首歌一列、每個版本一個播放器，聽過再決定要不要在 songs.json 加 skip。
    直接讀 cache/ 裡的音檔，不另外複製。"""
    def href(p: Path) -> str:
        try:
            return Path(os.path.relpath(p, dest.parent)).as_posix()
        except ValueError:  # Windows 上輸出到別的磁碟機時沒有相對路徑
            return p.resolve().as_uri()

    head = "".join(f"<th>{VARIANT_LABELS[v]}</th>" for v in VARIANTS)
    rows = []
    for item in previews:
        song, res, kept, paths = item["song"], item["res"], item["kept"], item["paths"]
        cells = []
        for v in VARIANTS:
            if v not in paths:
                cells.append('<td class="none">—</td>')
                continue
            cls = "" if v in kept else ' class="skip"'
            src = html.escape(href(paths[v]))
            cells.append(f'<td{cls}><audio controls preload="none" src="{src}"></audio></td>')
        src_link = html.escape(song["source"])
        rows.append(
            f'<tr><th class="song"><code>{html.escape(song["id"])}</code><br>{html.escape(song["t"])} — '
            f'{html.escape(song["a"])}<br><small>起點 {res["start"]:g} 秒・'
            f'<a href="{src_link}" target="_blank">來源</a></small></th>{"".join(cells)}</tr>'
        )
    page = f"""<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8"><title>題庫包試聽</title>
<style>
body {{ font-family: system-ui, sans-serif; margin: 16px; background: #fff; color: #222; }}
table {{ border-collapse: collapse; }}
th, td {{ border: 1px solid #ccc; padding: 6px; vertical-align: top; }}
th.song {{ text-align: left; min-width: 220px; font-weight: normal; }}
audio {{ width: 180px; }}
td.skip {{ background: #f3d6d6; opacity: .6; }}
td.none {{ color: #999; text-align: center; }}
</style></head><body>
<h1>題庫包試聽（{len(previews)} 首）</h1>
<p>紅底＝songs.json 的 <code>skip</code> 已排除、不會放進題庫包。
聽起來不行的版本，在該首加上 <code>"skip": ["rhythm"]</code> 之類再重跑（不會重做音檔）。
起點不對就改 <code>start</code>。</p>
<table><tr><th>歌曲</th>{head}</tr>
{chr(10).join(rows)}
</table></body></html>
"""
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(page, encoding="utf-8")
    return dest


def write_pack(out: Path, manifest: dict, files: list[tuple[Path, str]]) -> float:
    """寫出題庫包 zip，回傳 MB。音檔本來就壓縮過，用 STORED（不壓縮）：瀏覽器端的讀取器只支援這種格式。"""
    out.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_STORED) as zf:
        zf.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=1))
        for src, arc in files:
            zf.write(src, arc)
    return out.stat().st_size / 1024 / 1024


def main() -> None:
    parser = argparse.ArgumentParser(description="製作我不會唱歌的進階模式題庫包")
    parser.add_argument("--songs", default=str(HERE / "songs.json"), help="輸入清單（預設 songs.json）")
    parser.add_argument("--clip", type=float, default=15.0, help="每段秒數（預設 15）")
    parser.add_argument("--out", default=str(OUT / "utau_pack.zip"), help="輸出的題庫包")
    parser.add_argument("--only", action="append", help="只處理指定 id（可重複）")
    parser.add_argument("--repick", action="store_true", help="自動選的起點（_autoStart）重新偵測；手動填的 start 不受影響")
    parser.add_argument("--split", action="store_true",
                        help="另外依「地區＋分類」拆成多個題庫包（utau_pack_ja-anime.zip 等），方便手機分批匯入")
    args = parser.parse_args()

    catalog = song_catalog()
    lyrics = zh_voice.load_lyrics()
    songs_path = Path(args.songs)
    entries = load_entries(songs_path)
    # 還沒找到網址的歌（find_urls.py 搜尋失敗或剛加入）先略過，不讓整批停下來
    pending = [e for e in entries if not e.get("url") and not e.get("file")]
    # exclude：使用者審核後決定「不做」的歌，保留在清單（避免 find_urls.py 再加回來）但不製作
    excluded = [e for e in entries if e.get("exclude")]
    work = [(e, resolve_entry(e, catalog)) for e in entries if (e.get("url") or e.get("file")) and not e.get("exclude")]
    if args.only:
        work = [(e, s) for e, s in work if s["id"] in args.only]
    if not work:
        sys.exit("清單是空的：請在 songs.json 加入歌曲（或先跑 find_urls.py）")

    manifest = {"format": PACK_FORMAT, "version": PACK_VERSION, "clipSeconds": args.clip, "songs": []}
    files: list[tuple[Path, str]] = []
    previews: list[dict] = []
    failed = []
    for i, (entry, song) in enumerate(work, 1):
        log(f"[{i}/{len(work)}] {song['t']} — {song['a']}")
        repick = args.repick and entry.get("_autoStart")
        if repick:
            song["start"] = None
        try:
            res = build_song(song, args.clip)
        except Exception as exc:  # 單首失敗不影響其他首
            log(f"    失敗：{exc}")
            failed.append(song["id"])
            continue
        if entry.get("start") is None or repick:
            # 自動偵測的起點寫回清單：下次製作結果相同，要微調也直接改這個數字
            entry["start"] = res["start"]
            entry["_autoStart"] = True
        paths = {name: res["dir"] / f"{name}.m4a" for name in res["clips"]}
        try:
            paths.update(build_zh(song, res, lyrics, args.clip))
        except Exception as exc:  # 中文版失敗不影響其他版本
            log(f"    中文版失敗：{exc}")
        # skip 只影響打包：快取照樣保留，之後取消 skip 不必重做
        kept = [name for name in paths if name not in song["skip"]]
        if not any(name not in ("original", "zh_sing_inst", "ja_sing_inst") for name in kept):
            log("    所有題目版本都被略過，這首不放進題庫包")
            failed.append(song["id"])
            previews.append({"song": song, "res": res, "kept": kept, "paths": paths})
            continue
        folder = source_key(song["source"])
        clips = {}
        for name in kept:
            arc = f"clips/{folder}/{name}.m4a"
            files.append((paths[name], arc))
            clips[name] = arc
        manifest["songs"].append({
            "id": song["id"], "t": song["t"], "a": song["a"], "y": song["y"], "r": song["r"], "c": song["c"],
            "start": res["start"], "clips": clips,
        })
        previews.append({"song": song, "res": res, "kept": kept, "paths": paths})
        skipped = [n for n in paths if n not in kept]
        log(f"    起點 {res['start']:g} 秒：{', '.join(kept)}" + (f"（略過 {', '.join(skipped)}）" if skipped else ""))
        save_entries(songs_path, entries)  # 每首都存：全部歌單要跑好幾個小時，中途中斷也不會遺失自動選的起點

    save_entries(songs_path, entries)

    out = Path(args.out)
    size = write_pack(out, manifest, files)
    if args.split:
        # 依地區＋分類拆包；遊戲匯入時以歌曲 id 合併，可以只匯入想玩的分類
        groups: dict[str, list[dict]] = {}
        for song in manifest["songs"]:
            groups.setdefault(f"{song['r']}-{song['c']}", []).append(song)
        for name, group in sorted(groups.items()):
            arcs = {arc for song in group for arc in song["clips"].values()}
            part = dict(manifest, songs=group)
            dest = out.with_name(f"{out.stem}_{name}{out.suffix}")
            mb = write_pack(dest, part, [(src, arc) for src, arc in files if arc in arcs])
            log(f"  分包 {dest.name}：{len(group)} 首（{mb:.1f} MB）")
    preview = write_preview(out.parent / "preview.html", previews)
    log(f"完成：{len(manifest['songs'])} 首 → {out}（{size:.1f} MB）")
    log(f"試聽頁：{preview}")
    if failed:
        log(f"失敗 {len(failed)} 首：{', '.join(failed)}")
    if pending:
        log(f"還沒有網址的 {len(pending)} 首沒有處理（可以跑 find_urls.py 搜尋）")
    if excluded:
        log(f"標記為不做（exclude）的 {len(excluded)} 首沒有處理")


if __name__ == "__main__":
    main()
