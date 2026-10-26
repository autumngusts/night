"""我不會唱歌（utau）進階模式：阿卡貝拉編曲（試聽原型）。

使用者提案（2026-10-25）：B-box → 加入貝斯 → 加入合音，三個獨立版本。
貝斯、合音各做兩種給使用者試聽後再決定：
  B-box      鼓軌 → 依頻段找出大鼓／小鼓／Hi-hat 的打擊點 → 換成嘴巴打擊音
             （kit A：合成的口技音色；kit B：VOICEVOX 青山龍星念「ドゥン／パ／ツ」，後兩個母音無聲化。
              模擬口腔共鳴的 kit C／D 使用者試聽後不採用）
  貝斯       real：Demucs 貝斯軌；vocal：貝斯軌 CREPE 音符 → VOICEVOX 青山龍星唱「ドゥ」
  合音       melody：歌聲旋律（CREPE）→ VOICEVOX 唱「ル」（原唱性別的角色＋另一性別低八度疊唱）
             harmony：其他樂器軌推和弦（大小三和弦）→ 三部和聲唱「ウ」（玄野武宏／春日部つむぎ／四国めたん）

用法：
  tools/utau_clips/.venv/Scripts/python.exe tools/utau_clips/acappella.py [歌曲 id ...]
輸出：cache/acap/<來源雜湊>-<起點>/*.m4a 與 out/acappella_preview.html
"""

from __future__ import annotations

import html
import json
import os
import sys
from pathlib import Path

import numpy as np

import build_pack as bp
import ja_voice as jv

SR = bp.SR
CLIP = 15.0
ACAP = bp.CACHE / "acap"
TEST_IDS = ["ja:Get Wild", "ja:紅蓮華", "ja:Lemon", "en:Let It Go", "zh:小幸運", "zh:晴天"]
# VOICEVOX 歌唱用 style id（/singers 的 frame_decode）
BASS_SINGER = 3013  # 青山龍星（低音男聲）
HARMONY_SINGERS = (3011, 3008, 3002)  # 低：玄野武宏、中：春日部つむぎ、高：四国めたん
MELODY_SINGERS = {"male": 3011, "female": 3002}
KIT_SPEAKER = 13  # 青山龍星（朗讀）
rng = np.random.default_rng(7)


def log(msg: str) -> None:
    print(msg, flush=True)


# ---------------- 分軌（快取）----------------


def stems_for(song: dict) -> tuple[Path, dict[str, np.ndarray], np.ndarray]:
    start = float(song["start"])
    out_dir = ACAP / f"{bp.source_key(song['source'])}-{start:g}"
    cache = out_dir / "stems.npz"
    if cache.exists():
        d = np.load(cache)
        return out_dir, {k: d[k] for k in ("drums", "bass", "other", "vocals")}, d["original"]
    out_dir.mkdir(parents=True, exist_ok=True)
    audio = bp.load_audio(bp.fetch_source(song))
    a = max(0, int((start - bp.PAD) * SR))
    b = min(len(audio), int((start + CLIP + bp.PAD) * SR))
    segment = audio[a:b]
    lead = int(start * SR) - a
    body = slice(lead, lead + int(CLIP * SR))
    log("    分離音源…")
    stems = {k: v[body] for k, v in bp.separate(segment).items()}
    original = segment[body]
    np.savez(cache, original=original, **stems)
    return out_dir, stems, original


# ---------------- B-box ----------------


def _band(y: np.ndarray, lo: float | None, hi: float | None) -> np.ndarray:
    from scipy.signal import butter, sosfilt

    if lo and hi:
        sos = butter(4, [lo, hi], btype="band", fs=SR, output="sos")
    elif lo:
        sos = butter(4, lo, btype="high", fs=SR, output="sos")
    else:
        sos = butter(4, hi, btype="low", fs=SR, output="sos")
    return sosfilt(sos, y)


def drum_hits(drums: np.ndarray) -> list[tuple[float, str, float]]:
    """鼓軌 → [(秒, kick|snare|hat, 力度 0〜1)]。整個鼓軌找 onset（口技一次只發一個音），
    每個打擊點取 60ms 頻譜：<150Hz／150Hz〜5kHz／>5kHz 的能量比例與音量決定種類。
    （舊法三個頻段各自找 onset，Hi-hat 的 1.5〜5kHz 成分被當成小鼓，Get Wild 15 秒抓到 105 個小鼓。）"""
    import librosa

    y = drums.mean(axis=1)
    starts = librosa.onset.onset_detect(y=y, sr=SR, units="samples", backtrack=True)
    feats = []
    for a in starts:
        w = y[a: a + int(0.06 * SR)]
        if len(w) < 256:
            continue
        spec = np.abs(np.fft.rfft(w * np.hanning(len(w)))) ** 2
        f = np.fft.rfftfreq(len(w), 1 / SR)
        tot = spec.sum() + 1e-12
        feats.append((a / SR, spec[f < 150].sum() / tot, spec[(f >= 150) & (f < 5000)].sum() / tot,
                      spec[f >= 5000].sum() / tot, float(np.sqrt(np.mean(w ** 2)))))
    if not feats:
        return []
    ref = np.percentile([x[4] for x in feats], 95) + 1e-9
    out = []
    for t, low, mid, high, rms in feats:
        rel = rms / ref
        if rel < 0.08:
            continue  # 殘響、其他軌漏進來的聲音
        if high > 0.45 and rel < 0.35:
            kind = "hat"
        elif (mid >= 0.3 and rel >= 0.5) or mid >= 0.5:
            kind = "snare"
        elif low >= 0.55:
            kind = "kick"
        else:
            kind = "hat" if high > mid else "snare"
        out.append((t, kind, float(min(1.0, rel))))
    # 第二輪：密集的 Hi-hat 在整軌 onset 中常被大鼓／小鼓蓋掉，另外在 >6kHz 找，補上與既有打擊點相隔 50ms 以上的
    hi = _band(y, 6000, None).astype(np.float32)
    env = librosa.onset.onset_strength(y=hi, sr=SR, hop_length=256)
    frames = librosa.onset.onset_detect(onset_envelope=env, sr=SR, hop_length=256)
    if len(frames):
        href = np.percentile(env[frames], 90) + 1e-9
        taken = np.array([h[0] for h in out]) if out else np.zeros(0)
        for f in frames:
            t = float(librosa.frames_to_time(f, sr=SR, hop_length=256))
            v = env[f] / href
            if v >= 0.35 and (not len(taken) or np.min(np.abs(taken - t)) >= 0.05):
                out.append((t, "hat", float(min(1.0, v)) * 0.6))
        out.sort()
    return out


def _env(n: int, attack: float, tau: float) -> np.ndarray:
    t = np.arange(n) / SR
    return np.minimum(1.0, t / max(attack, 1e-4)) * np.exp(-t / tau)


def synth_kit() -> dict[str, np.ndarray]:
    """kit A：合成的口技音色。
    kick「b-m」：唇爆破音＋從 140Hz 掉到 55Hz 的低音（帶一點聲帶嗡聲）；
    snare「Pff」：唇爆破＋1.5〜7kHz 氣音；hat「ts」：舌尖 t＋高頻 s。
    （2026-10-25 曾改做模擬口腔共鳴、每下隨機變化的 kit C／D，使用者試聽後「完全無法使用」，改回 kit A。）"""
    def noise(sec):
        return rng.standard_normal(int(sec * SR))

    n = int(0.22 * SR)
    t = np.arange(n) / SR
    freq = 55 + 85 * np.exp(-t / 0.035)
    phase = np.cumsum(freq) / SR
    hum = np.sin(2 * np.pi * phase) + 0.25 * _band(2 * (phase % 1.0) - 1, None, 600)
    kick = hum * _env(n, 0.004, 0.07)
    pop = _band(noise(0.012), None, 1800) * _env(int(0.012 * SR), 0.0005, 0.004)
    kick[: len(pop)] += 0.6 * pop

    n = int(0.18 * SR)
    snare = _band(noise(0.18), 1500, 7000) * _env(n, 0.002, 0.05)
    snare[: len(pop)] += 0.8 * pop

    n = int(0.08 * SR)
    hat = _band(noise(0.08), 5500, None) * _env(n, 0.001, 0.022)
    tick = _band(noise(0.006), 3000, 6000) * _env(int(0.006 * SR), 0.0005, 0.002)
    hat[: len(tick)] += tick
    return {k: (v / (np.max(np.abs(v)) + 1e-9)).astype(np.float32) for k, v in
            {"kick": kick, "snare": snare * 0.8, "hat": hat * 0.45}.items()}


def voicevox_kit() -> dict[str, np.ndarray]:
    """kit B：VOICEVOX 青山龍星念短音。kick「ドゥン」（低音）；snare「パ」、hat「ツ」把母音無聲化，只剩氣音。"""
    import urllib.parse
    import urllib.request

    jv.ensure_engine()

    def say(text: str, devoice: bool, pitch: float) -> np.ndarray:
        url = jv.API + "/audio_query?" + urllib.parse.urlencode({"text": text, "speaker": KIT_SPEAKER})
        q = json.loads(urllib.request.urlopen(urllib.request.Request(url, method="POST")).read())
        q.update(speedScale=1.8, pitchScale=pitch, prePhonemeLength=0.0, postPhonemeLength=0.02, volumeScale=1.0)
        if devoice:
            for ap in q["accent_phrases"]:
                for m in ap["moras"]:
                    m["vowel"] = m["vowel"].upper()
                    m["pitch"] = 0.0
        wav = jv._post("/synthesis", {"speaker": KIT_SPEAKER}, q)
        tmp = bp.CACHE / "tmp_kit.wav"
        tmp.write_bytes(wav)
        y = bp.load_audio(tmp).mean(axis=1)
        tmp.unlink(missing_ok=True)
        nz = np.flatnonzero(np.abs(y) > 0.02 * np.max(np.abs(y)))
        y = y[nz[0]: nz[-1] + 1] if len(nz) else y
        return (y / (np.max(np.abs(y)) + 1e-9)).astype(np.float32)

    return {"kick": say("ドゥン", False, -0.12), "snare": say("パ", True, 0.0) * 0.8, "hat": say("ツ", True, 0.0) * 0.45}


# AVP（Amateur Vocal Percussion）資料集：28 位真人錄的口技，CC BY 4.0（ROLI Ltd.／Queen Mary University of London，
# https://zenodo.org/records/5036529）。下載到 cache/avp/（不進 Git）。合成音色（kit A／C／D）使用者試聽後都覺得不自然，改用真人錄音。
AVP_DIR = bp.CACHE / "avp" / "AVP_Dataset"
# 依雜訊底、三種聲音的音色分離度與一致性評分後挑出的參與者（2026-10-25）
AVP_KITS = {"p20": ("Fixed", 20), "p13": ("Fixed", 13), "p19": ("Personal", 19)}
AVP_CLASSES = {"kick": ("Kick", 0.25, 1.0), "snare": ("Snare", 0.25, 0.8), "hat": ("HHclosed", 0.12, 0.45)}


def avp_kit(mode: str, participant: int, variations: int = 8) -> dict[str, list[np.ndarray]]:
    """真人口技音色：同一個人錄的同類聲音取 variations 個（音色最接近該類中位數、音量夠大的），播放時輪流隨機挑。
    每個聲音從發聲起點（超過峰值 10% 前 3ms）切到下一個聲音或最長秒數，去 50Hz 以下低頻，尾端 15ms 淡出。"""
    import soundfile as sf

    kit = {}
    pdir = AVP_DIR / mode / f"Participant_{participant}"
    for name, (cls, maxlen, level) in AVP_CLASSES.items():
        wav = pdir / f"P{participant}_{cls}_{mode}.wav"
        y, sr = sf.read(str(wav), dtype="float32")
        if y.ndim == 2:
            y = y.mean(axis=1)
        if sr != SR:
            import librosa

            y = librosa.resample(y, orig_sr=sr, target_sr=SR)
        y = _band(y, 50, None).astype(np.float32)
        ons = [float(l.split(",")[0]) for l in wav.with_suffix(".csv").read_text(encoding="utf-8").splitlines() if l.strip()]
        cands = []
        for i, t in enumerate(ons):
            end = min(ons[i + 1] if i + 1 < len(ons) else t + maxlen, t + maxlen)
            x = y[max(0, int((t - 0.01) * SR)): int(end * SR)]
            if len(x) < 512:
                continue
            pk = float(np.max(np.abs(x)))
            first = int(np.argmax(np.abs(x) > 0.1 * pk))
            x = x[max(0, first - int(0.003 * SR)):].copy()
            fade = min(len(x), int(0.015 * SR))
            x[-fade:] *= np.linspace(1, 0, fade, dtype=np.float32)
            spec = np.abs(np.fft.rfft(x * np.hanning(len(x))))
            cen = float((spec * np.fft.rfftfreq(len(x), 1 / SR)).sum() / (spec.sum() + 1e-12))
            cands.append((cen, pk, x))
        med = np.median([c[0] for c in cands])
        loud = np.median([c[1] for c in cands])
        good = [c for c in cands if c[1] >= 0.5 * loud] or cands
        good.sort(key=lambda c: abs(np.log2(c[0] / med)))
        kit[name] = [(c[2] / (np.max(np.abs(c[2])) + 1e-9) * level).astype(np.float32) for c in good[:variations]]
    return kit


# unfa 的口技單音集（Freesound 714272「unfa's complete beatbox one-shot set 2023」，CC0；錄音室麥克風，有經驗的口技者）。
# AVP 是新手用筆電麥克風錄的，使用者要「比較真實的 b-box」（2026-10-25）。原檔要登入，這裡用公開的 HQ 試聽 mp3（cache/unfa/，不進 Git）。
# 整段 3 分 19 秒沒有標註：依作者說明的錄音順序（大鼓→小鼓→rimshot→hi-hat→tom→鈸）加上頻譜（低頻比例、重心、餘音長短）挑出下列起點。
UNFA_FILE = bp.CACHE / "unfa" / "unfa_hq.mp3"
UNFA_URL = "https://cdn.freesound.org/previews/714/714272_1038806-hq.mp3"
UNFA_KICK = [1.30, 2.46, 4.23, 9.80, 10.69]  # 餘音短的大鼓（3.37、8.63 是 505 風長大鼓，不用）
UNFA_SNARE = {"natural": [12.93, 15.16, 19.67, 22.88, 24.10], "edm": [20.85, 21.90, 28.24]}
UNFA_HAT = [44.76, 47.68, 127.59, 138.47, 143.65]  # 餘音短（閉合）的 hi-hat
UNFA_MAXLEN = {"kick": 0.35, "snare": 0.35, "hat": 0.15}


def _oneshots(y: np.ndarray, onsets: np.ndarray, times: list[float], maxlen: float, level: float) -> list[np.ndarray]:
    """從長錄音切出單音：對齊到最近的 onset，切到音量掉到峰值 3% 以下（約 −30dB）＋30ms、下一個 onset 或 maxlen，尾端淡出。"""
    out = []
    for t in times:
        i = int(np.argmin(np.abs(onsets - t)))
        a = max(0, int((onsets[i] - 0.003) * SR))
        nxt = onsets[i + 1] if i + 1 < len(onsets) else onsets[i] + maxlen
        x = y[a: int(min(nxt, onsets[i] + maxlen) * SR)].copy()
        w = int(0.01 * SR)
        env = np.array([np.sqrt(np.mean(x[j:j + w] ** 2)) for j in range(0, max(1, len(x) - w), w)])
        pk = int(np.argmax(env))
        below = np.flatnonzero(env[pk:] < env[pk] * 0.03)
        if len(below):
            x = x[: min(len(x), (pk + below[0] + 3) * w)]
        fade = min(len(x), int(0.015 * SR))
        x[-fade:] *= np.linspace(1, 0, fade, dtype=np.float32)
        out.append((x / (np.max(np.abs(x)) + 1e-9) * level).astype(np.float32))
    return out


def _unfa_audio():
    import librosa

    if not UNFA_FILE.exists():
        import urllib.request

        UNFA_FILE.parent.mkdir(parents=True, exist_ok=True)
        urllib.request.urlretrieve(UNFA_URL, UNFA_FILE)
    y = _band(bp.load_audio(UNFA_FILE).mean(axis=1), 40, None).astype(np.float32)
    onsets = librosa.onset.onset_detect(y=y, sr=SR, units="time", backtrack=True, delta=0.2)
    return y, onsets


def unfa_kit(snare: str) -> dict[str, list[np.ndarray]]:
    y, onsets = _unfa_audio()
    return {"kick": _oneshots(y, onsets, UNFA_KICK, UNFA_MAXLEN["kick"], 1.0),
            "snare": _oneshots(y, onsets, UNFA_SNARE[snare], UNFA_MAXLEN["snare"], 0.8),
            "hat": _oneshots(y, onsets, UNFA_HAT, UNFA_MAXLEN["hat"], 0.45)}


def unfa_browser() -> Path:
    """unfa 整段錄音切成每一聲的試聽清單（標出目前選用的），方便使用者指出分錯的聲音。"""
    import soundfile as sf

    y, onsets = _unfa_audio()
    seg = bp.OUT / "unfa_seg"
    seg.mkdir(parents=True, exist_ok=True)
    used = {}
    for t in UNFA_KICK:
        used[t] = "大鼓"
    for k, ts in UNFA_SNARE.items():
        for t in ts:
            used[t] = "小鼓（自然）" if k == "natural" else "小鼓（EDM）"
    for t in UNFA_HAT:
        used[t] = "Hi-hat"
    rows = []
    for i, t in enumerate(onsets):
        nxt = onsets[i + 1] if i + 1 < len(onsets) else t + 0.6
        x = y[int(t * SR): int(min(nxt, t + 0.6) * SR)]
        f = seg / f"{i:03d}.wav"
        sf.write(str(f), x, SR)
        tag = next((v for k, v in used.items() if abs(k - t) < 0.05), "")
        rows.append(f'<tr{" class=used" if tag else ""}><td>{i:03d}</td><td>{t:.2f} 秒</td><td>{tag}</td>'
                    f'<td><audio controls preload="none" src="unfa_seg/{f.name}"></audio></td></tr>')
    dest = bp.OUT / "unfa_browser.html"
    dest.write_text('<!doctype html><meta charset="utf-8"><title>unfa 口技單音</title>'
                    '<style>body{font-family:sans-serif;margin:16px}td{padding:2px 8px}tr.used{background:#ffe9a8}</style>'
                    '<h1>unfa 口技單音（整段切開）</h1><p>黃色＝目前選用。分錯的話告訴我編號與正確種類。'
                    '來源：Freesound 714272（unfa，CC0）</p><table>' + "".join(rows) + "</table>", encoding="utf-8")
    return dest


def render_bbox(hits, kit: dict) -> np.ndarray:
    """打擊點 → B-box。kit 的每種音可以是多個變化（真人錄音），每一下隨機挑一個。
    開放 hi-hat 在下一下打擊時切斷（10ms 淡出）。"""
    out = np.zeros(int(CLIP * SR) + SR, dtype=np.float32)
    for i, (t, name, v) in enumerate(hits):
        s = kit[name]
        if isinstance(s, list):
            s = s[rng.integers(len(s))]
        if name == "hat_open" and i + 1 < len(hits):
            n = max(1, int((hits[i + 1][0] - t) * SR))
            if n < len(s):
                s = s[:n].copy()
                fade = min(n, int(0.01 * SR))
                s[-fade:] *= np.linspace(1, 0, fade, dtype=np.float32)
        a = int(t * SR)
        b = min(len(out), a + len(s))
        out[a:b] += s[: b - a] * (0.55 + 0.45 * v)
    return out[: int(CLIP * SR)]


# ---------------- VOICEVOX 唱音符 ----------------


def fr(t: float) -> int:
    return int(round(t * jv.FPS))


def sing_notes(notes: list, lyric: str, style: int, curve=None, win: float = 20.0, tail: float = 2.0) -> np.ndarray:
    """長度（CLIP）超過 25 秒時（整首試聽），每 win 秒的音符分段交給 VOICEVOX，再疊回原位置。"""
    global CLIP
    total = CLIP
    if total <= 25:
        return _sing_chunk(notes, lyric, style, curve)
    out = np.zeros(int(total * SR) + int(tail * SR), dtype=np.float32)
    w0 = 0.0
    try:
        while w0 < total:
            sub = [(s - w0, d, m) for s, d, m in notes if w0 <= s < w0 + win]
            if sub:
                CLIP = win + tail
                c = (curve[0] - w0, curve[1]) if curve is not None else None
                y = _sing_chunk(sub, lyric, style, c)
                a = int(w0 * SR)
                out[a: a + len(y)] += y[: len(out) - a]
            CLIP = total
            w0 += win
    finally:
        CLIP = total
    return out[: int(total * SR)]


def _sing_chunk(notes: list, lyric: str, style: int, curve=None) -> np.ndarray:
    """音符 [(開始, 長度, MIDI)] → VOICEVOX 歌聲。curve＝(t10, midi10) 時用它取代 f0（保留滑音），否則照樂譜音高。"""
    jv.ensure_engine()
    n = int(CLIP * SR)
    notes = sorted((max(0.1, s), d, m) for s, d, m in notes if s + d > 0.12 and s < CLIP - 0.05)
    clean = []
    for s, d, m in notes:  # 去掉重疊
        if clean and s < clean[-1][0] + clean[-1][1]:
            ps, pd, pm = clean[-1]
            clean[-1] = (ps, max(0.05, s - ps), pm)
        clean.append((s, min(d, CLIP - s), m))
    clean = [c for c in clean if c[1] >= 0.05]
    if not clean:
        return np.zeros(n, dtype=np.float32)
    score = [{"key": None, "frame_length": max(1, fr(clean[0][0])), "lyric": ""}]
    for i, (s, d, m) in enumerate(clean):
        e = s + d
        nxt = clean[i + 1][0] if i + 1 < len(clean) else CLIP
        if nxt - e > 0.03:
            score.append({"key": int(m), "frame_length": max(1, fr(e) - fr(s)), "lyric": lyric})
            score.append({"key": None, "frame_length": max(1, fr(nxt) - fr(e)), "lyric": ""})
        else:
            score.append({"key": int(m), "frame_length": max(1, fr(nxt) - fr(s)), "lyric": lyric})
    q = json.loads(jv._post("/sing_frame_audio_query", {"speaker": jv.TEACHER}, {"notes": score}))
    if curve is not None:
        t10, midi10 = curve
        tf = np.arange(len(q["f0"])) / jv.FPS
        c = 440 * 2 ** ((np.interp(tf, t10, midi10) - 69) / 12)
        q["f0"] = [float(x) if f > 0 else 0.0 for f, x in zip(q["f0"], c)]
    wav = jv._post("/frame_synthesis", {"speaker": style}, q)
    tmp = bp.CACHE / "tmp_acap.wav"
    tmp.write_bytes(wav)
    y = bp.load_audio(tmp).mean(axis=1)
    tmp.unlink(missing_ok=True)
    return np.pad(y, (0, max(0, n - len(y))))[:n].astype(np.float32)


def shift_to(notes: list, target: float) -> int:
    return 12 * round((target - float(np.median([x[2] for x in notes]))) / 12) if notes else 0


def vocal_bass(bass: np.ndarray) -> np.ndarray:
    notes = bp.crepe_notes(bass, fmin=35, fmax=400)  # torchcrepe 在 fmin 低於約 32Hz 時整段回傳 NaN
    k = shift_to(notes, 45)  # 青山龍星唱得穩的音域（約 A2）；原貝斯多半在 E1〜E2，通常升一個八度
    notes = [(s, d, m + k) for s, d, m in notes]
    # 只給樂譜時 VOICEVOX 在低音域音高會跑掉（6 首實測與原貝斯一致僅 24〜65%），f0 改成樂譜音高的階梯曲線
    t10 = np.arange(int(CLIP * 100)) * 0.01
    step = np.full(len(t10), np.nan)
    for s, d, m in notes:
        step[int(s * 100):int((s + d) * 100)] = m
    ok = ~np.isnan(step)
    step = np.interp(t10, t10[ok], step[ok]) if ok.any() else np.full(len(t10), 45.0)
    return sing_notes(notes, "ドゥ", BASS_SINGER, (t10, step))


def melody_chorus(vocals: np.ndarray, voice: str) -> np.ndarray:
    import torch  # noqa: F401（crepe 需要）
    import zh_voice as zv

    notes = bp.crepe_notes(vocals)
    f0, per = zv._crepe(vocals)
    t10 = np.arange(len(f0)) * 0.01
    voiced = per > 0.3
    midi10 = 69 + 12 * np.log2(np.maximum(f0, 1) / 440)
    gm = np.interp(t10, t10[voiced], midi10[voiced]) if voiced.any() else np.full(len(t10), 60.0)
    lead_target, sub_target = (57, 45) if voice == "male" else (65, 53)
    other = "female" if voice == "male" else "male"
    k1 = shift_to(notes, lead_target)
    lead = sing_notes([(s, d, m + k1) for s, d, m in notes], "ル", MELODY_SINGERS[voice], (t10, gm + k1))
    # 另一性別疊唱：女聲高八度（原唱男）或男聲低八度（原唱女）
    k2 = k1 + (12 if voice == "male" else -12)
    sub = sing_notes([(s, d, m + k2) for s, d, m in notes], "ル", MELODY_SINGERS[other], (t10, gm + k2))
    return lead + 0.55 * sub


# ---------------- 和弦 → 三部和聲 ----------------


def chord_track(other: np.ndarray, bass: np.ndarray, mix: np.ndarray) -> list[tuple[float, float, int, bool]]:
    """[(開始, 長度, 根音 0〜11, 大三和弦?)]：以拍為單位比對 24 種三和弦，再用動態規劃抑制頻繁換和弦。"""
    import librosa

    sr = 22050
    y = librosa.resample((other + 0.6 * bass).mean(axis=1), orig_sr=SR, target_sr=sr)
    chroma = librosa.feature.chroma_cqt(y=y, sr=sr, hop_length=512)
    ym = librosa.resample(mix.mean(axis=1), orig_sr=SR, target_sr=sr)
    _, beats = librosa.beat.beat_track(y=ym, sr=sr, hop_length=512)
    bounds = [0] + [int(b) for b in beats if 0 < b < chroma.shape[1]] + [chroma.shape[1]]
    bounds = sorted(set(bounds))
    templates = []
    for root in range(12):
        for major in (True, False):
            v = np.zeros(12)
            v[[root, (root + (4 if major else 3)) % 12, (root + 7) % 12]] = [1.0, 0.8, 0.8]
            templates.append((root, major, v / np.linalg.norm(v)))
    segs = []
    for a, b in zip(bounds, bounds[1:]):
        c = chroma[:, a:b].mean(axis=1)
        c = c / (np.linalg.norm(c) + 1e-9)
        segs.append((a, b, np.array([c @ v for _, _, v in templates])))
    n, m = len(segs), len(templates)
    cost = np.full((n, m), -np.inf)
    back = np.zeros((n, m), dtype=int)
    cost[0] = segs[0][2]
    penalty = 0.08
    for i in range(1, n):
        for j in range(m):
            prev = cost[i - 1] - penalty
            prev[j] += penalty
            back[i, j] = int(np.argmax(prev))
            cost[i, j] = prev[back[i, j]] + segs[i][2][j]
    path = [int(np.argmax(cost[-1]))]
    for i in range(n - 1, 0, -1):
        path.append(back[i, path[-1]])
    path.reverse()
    to_t = lambda f: float(librosa.frames_to_time(f, sr=sr, hop_length=512))
    out = []
    for (a, b, _), j in zip(segs, path):
        root, major, _ = templates[j]
        if out and out[-1][2] == root and out[-1][3] == major:
            s, d, r, mj = out[-1]
            out[-1] = (s, to_t(b) - s, r, mj)
        else:
            out.append((to_t(a), to_t(b) - to_t(a), root, major))
    return out


def voice_chords(chords) -> list[list[tuple[float, float, int]]]:
    """每個和弦排成三個聲部（低／中／高），選與上一個和弦移動最少的轉位，高聲部在 MIDI 64〜76。"""
    parts = [[], [], []]
    prev = None
    for s, d, root, major in chords:
        pcs = [root, (root + (4 if major else 3)) % 12, (root + 7) % 12]
        cands = []
        for top in range(64, 77):
            if top % 12 not in pcs:
                continue
            others = [p for p in pcs if p != top % 12]
            # 緊密排列：從高聲部往下找另外兩個音
            mid = max(x for x in range(top - 12, top) if x % 12 in others)
            low = max(x for x in range(mid - 12, mid) if x % 12 in others and x % 12 != mid % 12)
            cands.append((low - 12 if low > 55 else low, mid, top))
        v = min(cands, key=lambda c: sum(abs(a - b) for a, b in zip(c, prev)) if prev else abs(c[2] - 69))
        prev = v
        for i in range(3):
            p = parts[i]
            if p and p[-1][2] == v[i] and abs(p[-1][0] + p[-1][1] - s) < 0.02:
                p[-1] = (p[-1][0], s + d - p[-1][0], v[i])
            else:
                p.append((s, d, v[i]))
    # 每個音尾留一點換氣
    return [[(s, max(0.1, d - 0.06), m) for s, d, m in p] for p in parts]


def harmony_chorus(stems, original) -> np.ndarray:
    chords = chord_track(stems["other"], stems["bass"], original)
    parts = voice_chords(chords)
    out = np.zeros(int(CLIP * SR), dtype=np.float32)
    for part, style, gain in zip(parts, HARMONY_SINGERS, (0.9, 0.75, 0.8)):
        out += gain * sing_notes(part, "ウ", style)
    return out, chords


# ---------------- 混音與試聽頁 ----------------


def norm(x: np.ndarray) -> np.ndarray:
    x = x.astype(np.float32)
    if x.ndim == 2:
        x = x.mean(axis=1)
    return x / (float(np.sqrt(np.mean(x ** 2))) + 1e-9) * 0.1


LABELS = {
    "original": "原曲",
    "bbox_a": "B-box（kit A 合成）", "bbox_b": "B-box（kit B VOICEVOX）",
    "bbox_unfa_n": "B-box（unfa・自然小鼓）", "bbox_unfa_e": "B-box（unfa・EDM 小鼓）",
    "L2_unfa_n": "unfa 自然＋人聲貝斯", "L2_unfa_e": "unfa EDM＋人聲貝斯",
    "L3_unfa_n": "完整：unfa 自然＋人聲貝斯＋和聲", "L3_unfa_e": "完整：unfa EDM＋人聲貝斯＋和聲",
    "bbox_p20": "B-box（真人 20 號）", "bbox_p13": "B-box（真人 13 號）", "bbox_p19": "B-box（真人 19 號・自然發音）",
    "L2_p20": "真人 20 號＋人聲貝斯", "L2_p13": "真人 13 號＋人聲貝斯", "L2_p19": "真人 19 號＋人聲貝斯",
    "L3_p20": "完整：真人 20 號＋人聲貝斯＋和聲", "L3_p13": "完整：真人 13 號＋人聲貝斯＋和聲",
    "L3_p19": "完整：真人 19 號＋人聲貝斯＋和聲",
    "bass_real": "貝斯（真實貝斯軌）", "bass_vocal": "貝斯（人聲 ドゥ）",
    "cho_melody": "合音（主旋律 ル）", "cho_harmony": "合音（三部和聲 ウ）",
    "L2_real": "kit A＋真實貝斯", "L2_vocal": "kit A＋人聲貝斯",
    "L3_real_melody": "完整：真實貝斯＋主旋律", "L3_vocal_melody": "完整：人聲貝斯＋主旋律",
    "L3_vocal_harmony": "完整：人聲貝斯＋和聲", "L3_vocal_both": "完整：人聲貝斯＋主旋律＋和聲",
}
GROUPS = [("B-box（第 1 層）：unfa 口技", ["original", "bbox_unfa_n", "bbox_unfa_e"]),
          ("第 2 層：B-box＋人聲貝斯", ["L2_unfa_n", "L2_unfa_e"]),
          ("第 3 層：B-box＋人聲貝斯＋三部和聲", ["L3_unfa_n", "L3_unfa_e"]),
          ("參考：上一版", ["bbox_p20", "bbox_p13", "bbox_p19", "bbox_a"])]


def build(song: dict, kits: dict) -> dict:
    out_dir, stems, original = stems_for(song)
    voice = song.get("voice", "female")
    tmp = out_dir / "tmp.wav"
    parts = {}
    meta = {}

    def get(name: str, make):
        f = out_dir / f"{name}.npy"
        if f.exists():
            parts[name] = np.load(f)
        else:
            parts[name] = norm(make())
            np.save(f, parts[name])

    hits = drum_hits(stems["drums"])
    meta["hits"] = {k: sum(1 for h in hits if h[1] == k) for k in ("kick", "snare", "hat")}
    for k in ("a", "b", *AVP_KITS, "unfa_n", "unfa_e"):
        get(f"bbox_{k}", lambda k=k: render_bbox(hits, kits[k]))
    get("bass_real", lambda: stems["bass"])
    log("    人聲貝斯…")
    get("bass_vocal", lambda: vocal_bass(stems["bass"]))
    log("    主旋律合音…")
    get("cho_melody", lambda: melody_chorus(stems["vocals"], voice))
    log("    三部和聲…")
    hf = out_dir / "chords.json"
    if not (out_dir / "cho_harmony.npy").exists():
        wav, chords = harmony_chorus(stems, original)
        parts["cho_harmony"] = norm(wav)
        np.save(out_dir / "cho_harmony.npy", parts["cho_harmony"])
        hf.write_text(json.dumps(chords), encoding="utf-8")
    else:
        parts["cho_harmony"] = np.load(out_dir / "cho_harmony.npy")
    names = "C C# D D# E F F# G G# A A# B".split()
    meta["chords"] = " ".join(f"{names[r]}{'' if mj else 'm'}" for _, _, r, mj in json.loads(hf.read_text(encoding="utf-8")))

    p = parts
    mixes = {
        "original": original,
        "bbox_a": p["bbox_a"], "bbox_b": p["bbox_b"],
        **{f"bbox_{k}": p[f"bbox_{k}"] for k in (*AVP_KITS, "unfa_n", "unfa_e")},
        **{f"L2_{k}": p[f"bbox_{k}"] + 0.8 * p["bass_vocal"] for k in ("unfa_n", "unfa_e")},
        **{f"L3_{k}": p[f"bbox_{k}"] + 0.7 * p["bass_vocal"] + 1.0 * p["cho_harmony"] for k in ("unfa_n", "unfa_e")},
        **{f"L2_{k}": p[f"bbox_{k}"] + 0.8 * p["bass_vocal"] for k in AVP_KITS},
        **{f"L3_{k}": p[f"bbox_{k}"] + 0.7 * p["bass_vocal"] + 1.0 * p["cho_harmony"] for k in AVP_KITS},
        "bass_real": p["bass_real"], "bass_vocal": p["bass_vocal"],
        "cho_melody": p["cho_melody"], "cho_harmony": p["cho_harmony"],
        "L2_real": p["bbox_a"] + 0.8 * p["bass_real"],
        "L2_vocal": p["bbox_a"] + 0.8 * p["bass_vocal"],
        "L3_real_melody": p["bbox_a"] + 0.7 * p["bass_real"] + 1.0 * p["cho_melody"],
        "L3_vocal_melody": p["bbox_a"] + 0.7 * p["bass_vocal"] + 1.0 * p["cho_melody"],
        "L3_vocal_harmony": p["bbox_a"] + 0.7 * p["bass_vocal"] + 1.0 * p["cho_harmony"],
        "L3_vocal_both": p["bbox_a"] + 0.7 * p["bass_vocal"] + 1.0 * p["cho_melody"] + 0.55 * p["cho_harmony"],
    }
    paths = {}
    for name, data in mixes.items():
        dest = out_dir / f"{name}.m4a"
        bp.encode(bp.finish(data), dest, tmp)
        paths[name] = dest
    tmp.unlink(missing_ok=True)
    return {"song": song, "paths": paths, "meta": meta}


def write_preview(results: list[dict]) -> Path:
    dest = bp.OUT / "acappella_preview.html"
    dest.parent.mkdir(parents=True, exist_ok=True)

    def href(p: Path) -> str:
        return Path(os.path.relpath(p, dest.parent)).as_posix()

    blocks = []
    for r in results:
        s = r["song"]
        rows = []
        for title, names in GROUPS:
            cells = "".join(
                f'<div class="cell"><div class="lab">{html.escape(LABELS[n])}</div>'
                f'<audio controls preload="none" src="{html.escape(href(r["paths"][n]))}"></audio></div>'
                for n in names)
            rows.append(f'<h3>{title}</h3><div class="row">{cells}</div>')
        m = r["meta"]
        info = f'打擊點：大鼓 {m["hits"]["kick"]}／小鼓 {m["hits"]["snare"]}／Hi-hat {m["hits"]["hat"]}　和弦：{html.escape(m["chords"])}'
        blocks.append(f'<section><h2>{html.escape(s["t"])} — {html.escape(s["a"])}</h2>'
                      f'<p class="meta">{info}</p>{"".join(rows)}</section>')
    page = f"""<!doctype html><meta charset="utf-8"><title>阿卡貝拉編曲試聽</title>
<style>body{{font-family:sans-serif;margin:16px;background:#fafafa}}section{{background:#fff;border:1px solid #ddd;border-radius:8px;padding:12px;margin-bottom:16px}}
h2{{margin:0 0 4px}}h3{{margin:10px 0 4px;font-size:14px;color:#555}}.row{{display:flex;flex-wrap:wrap;gap:8px}}
.cell{{border:1px solid #eee;border-radius:6px;padding:6px}}.lab{{font-size:13px;margin-bottom:2px}}.meta{{font-size:12px;color:#777;margin:0}}audio{{width:240px}}</style>
<h1>阿卡貝拉編曲試聽（{len(results)} 首）</h1>
<p>口技錄音：unfa（Freesound 714272，CC0）、Amateur Vocal Percussion Dataset（ROLI Ltd.／Queen Mary University of London，CC BY 4.0）<br>VOICEVOX:青山龍星、VOICEVOX:玄野武宏、VOICEVOX:春日部つむぎ、VOICEVOX:四国めたん</p>
{"".join(blocks)}"""
    dest.write_text(page, encoding="utf-8")
    return dest


# 30 秒、多種 B-box 風格（使用者 2026-10-25：「配幾個 bbox 風格給我，音樂長度需要 30s」）。全部用 unfa 的錄音。
STYLE_CLIP = 30.0
STYLES_DIR = bp.CACHE / "acap30"
UNFA_KICK_LONG = [3.37, 8.63]  # 505 風、餘音長的大鼓
UNFA_RIM = [25.25, 26.35, 27.50, 30.17]  # 錄音順序在小鼓之後、音量小的清脆聲（推測是 rimshot）
UNFA_HAT_OPEN = [34.25, 178.13]  # 餘音約 0.6 秒的 hi-hat（開放）
STYLES = {
    "s1": ("① 自然", UNFA_KICK, UNFA_SNARE["natural"], False),
    "s2": ("② EDM", UNFA_KICK, UNFA_SNARE["edm"], False),
    "s3": ("③ 重低音 505", UNFA_KICK_LONG, UNFA_SNARE["natural"], False),
    "s4": ("④ Rimshot 輕快", UNFA_KICK, UNFA_RIM, False),
    "s5": ("⑤ 開放 Hi-hat 律動", UNFA_KICK, UNFA_SNARE["natural"], True),
}


def style_kit(kick: list[float], snare: list[float], open_hat: bool) -> dict[str, list[np.ndarray]]:
    y, onsets = _unfa_audio()
    kit = {"kick": _oneshots(y, onsets, kick, 0.45 if kick is UNFA_KICK_LONG else UNFA_MAXLEN["kick"], 1.0),
           "snare": _oneshots(y, onsets, snare, UNFA_MAXLEN["snare"], 0.8),
           "hat": _oneshots(y, onsets, UNFA_HAT, UNFA_MAXLEN["hat"], 0.45)}
    if open_hat:
        kit["hat_open"] = _oneshots(y, onsets, UNFA_HAT_OPEN, 0.5, 0.4)
    return kit


def open_hats(hits) -> list:
    """後面接大鼓／小鼓、且間隔 0.12 秒以上的 hi-hat 改成開放 hi-hat；render_bbox 會在下一下打擊時把它切斷（像踩住 hi-hat）。
    （第一版規則「後面空 0.22 秒以上」在打擊點密集的歌——例如 Get Wild——一個都不會觸發，⑤ 會和 ① 完全一樣。）"""
    out = []
    for i, (t, n, v) in enumerate(hits):
        nxt = hits[i + 1] if i + 1 < len(hits) else None
        is_open = n == "hat" and nxt is not None and nxt[1] != "hat" and nxt[0] - t >= 0.12
        out.append((t, "hat_open" if is_open else n, v))
    return out


def build_styles(song: dict) -> dict:
    global CLIP
    CLIP = STYLE_CLIP
    start = float(song["start"])
    out_dir = STYLES_DIR / f"{bp.source_key(song['source'])}-{start:g}"
    out_dir.mkdir(parents=True, exist_ok=True)
    cache = out_dir / "stems.npz"
    if cache.exists():
        d = np.load(cache)
        stems, original = {k: d[k] for k in ("drums", "bass", "other", "vocals")}, d["original"]
    else:
        audio = bp.load_audio(bp.fetch_source(song))
        a = max(0, int((start - bp.PAD) * SR))
        b = min(len(audio), int((start + CLIP + bp.PAD) * SR))
        segment = audio[a:b]
        lead = int(start * SR) - a
        body = slice(lead, lead + int(CLIP * SR))
        log("    分離音源（30 秒）…")
        stems = {k: np.pad(v[body], ((0, max(0, int(CLIP * SR) - len(v[body]))), (0, 0))) for k, v in bp.separate(segment).items()}
        original = np.pad(segment[body], ((0, max(0, int(CLIP * SR) - len(segment[body]))), (0, 0)))
        np.savez(cache, original=original, **stems)

    def cached(name, make):
        f = out_dir / f"{name}.npy"
        if f.exists():
            return np.load(f)
        x = norm(make())
        np.save(f, x)
        return x

    log("    人聲貝斯…")
    bass = cached("bass_vocal", lambda: vocal_bass(stems["bass"]))
    log("    三部和聲…")
    harm = cached("cho_harmony", lambda: harmony_chorus(stems, original)[0])
    hits = drum_hits(stems["drums"])
    tmp = out_dir / "tmp.wav"
    paths = {"original": out_dir / "original.m4a"}
    bp.encode(bp.finish(original), paths["original"], tmp)
    for key, (_, kick, snare, oh) in STYLES.items():
        bbox = norm(render_bbox(open_hats(hits) if oh else hits, style_kit(kick, snare, oh)))
        for suffix, data in (("bbox", bbox), ("full", bbox + 0.7 * bass + 1.0 * harm)):
            paths[f"{key}_{suffix}"] = out_dir / f"{key}_{suffix}.m4a"
            bp.encode(bp.finish(data), paths[f"{key}_{suffix}"], tmp)
    tmp.unlink(missing_ok=True)
    CLIP = 15.0
    return {"song": song, "paths": paths}


SOFT_LEVELS = {"h1": ("和聲 60%", 0.6), "h2": ("和聲 40%", 0.4), "h3": ("和聲 25%", 0.25)}


def soften(x: np.ndarray) -> np.ndarray:
    """和聲變輕柔（使用者 2026-10-25：「② EDM 可以，和聲再輕柔一點」）：
    低通 2.8kHz 去掉 VOICEVOX 偏亮的高頻、加一點殘響讓和聲退到後面，再把整體 RMS 拉回原值。"""
    from scipy.signal import butter, fftconvolve, sosfiltfilt
    y = sosfiltfilt(butter(4, 2800, "low", fs=SR, output="sos"), x).astype(np.float32)
    n = int(1.4 * SR)
    ir = np.random.default_rng(3).standard_normal(n).astype(np.float32) * np.exp(-np.arange(n) / (0.35 * SR))
    ir = sosfiltfilt(butter(2, 3500, "low", fs=SR, output="sos"), ir).astype(np.float32)
    wet = fftconvolve(y, ir)[: len(y)].astype(np.float32)
    wet *= np.sqrt(np.mean(y ** 2)) / (np.sqrt(np.mean(wet ** 2)) + 1e-9)
    return norm(0.75 * y + 0.45 * wet)


def natural_curve(notes, n_sec: float, seed: int):
    """樂譜 → 自然的 f0 曲線（MIDI，每 10ms）：音與音之間 70ms 滑音、0.45 秒後才出現的顫音（5.3Hz、±0.2 半音）、
    很小的隨機飄移（±5 cents）。只給樂譜時 VOICEVOX 在低音域會走音（實測低聲部唱準 0〜88%），所以強制用這條曲線。"""
    from scipy.ndimage import gaussian_filter1d
    t = np.arange(int(n_sec * 100)) * 0.01
    step = np.full(len(t), np.nan)
    vib = np.zeros(len(t))
    for s, d, m in notes:
        a, b = int(s * 100), min(len(t), int((s + d) * 100))
        step[a:b] = m
        if d > 0.6:
            k = np.arange(b - a) * 0.01
            depth = 0.2 * np.clip((k - 0.45) / 0.3, 0, 1)
            vib[a:b] = depth * np.sin(2 * np.pi * 5.3 * k)
    ok = ~np.isnan(step)
    if not ok.any():
        return t, np.full(len(t), 60.0)
    step = np.interp(t, t[ok], step[ok])
    rng_ = np.random.default_rng(seed)
    drift = gaussian_filter1d(rng_.standard_normal(len(t)), 40) * 0.05 / 0.06
    return t, gaussian_filter1d(step, 3) + vib + drift


def soft_voice(x: np.ndarray, wet: float = 0.25) -> np.ndarray:
    """單一聲部的輕柔處理：低通 2.8kHz＋少量殘響（殘響太多聲部會糊在一起）。"""
    from scipy.signal import butter, fftconvolve, sosfiltfilt
    y = sosfiltfilt(butter(4, 2800, "low", fs=SR, output="sos"), x).astype(np.float32)
    n = int(1.2 * SR)
    ir = np.random.default_rng(3).standard_normal(n).astype(np.float32) * np.exp(-np.arange(n) / (0.3 * SR))
    ir = sosfiltfilt(butter(2, 3500, "low", fs=SR, output="sos"), ir).astype(np.float32)
    rv = fftconvolve(y, ir)[: len(y)].astype(np.float32)
    rv *= np.sqrt(np.mean(y ** 2)) / (np.sqrt(np.mean(rv ** 2)) + 1e-9)
    return y + wet * rv


def note_envelope(notes, n: int) -> np.ndarray:
    """每個音：0.35 起音漸強到 1（最多 0.3 秒），結尾收到 0.7。"""
    env = np.full(n, 0.35, dtype=np.float32)
    for s, d, _ in notes:
        a, b = int(s * SR), min(n, int((s + d + 0.05) * SR))
        if b <= a:
            continue
        k = b - a
        rise = max(1, min(int(0.3 * SR), int(k * 0.4)))
        seg = np.ones(k, dtype=np.float32)
        seg[:rise] = np.linspace(0.35, 1.0, rise)
        fall = max(1, int(k * 0.35))
        seg[-fall:] = np.minimum(seg[-fall:], np.linspace(1.0, 0.7, fall))
        env[a:b] = seg
    return env


def phrase_envelope(stems, n: int) -> np.ndarray:
    """跟著原曲（人聲＋伴奏）的能量起伏：平滑 1.5 秒，第 10〜90 百分位對應到 0.35〜1.0。"""
    from scipy.ndimage import uniform_filter1d
    x = (stems["vocals"] + stems["other"]).mean(axis=1)[:n]
    hop = int(0.05 * SR)
    rms = np.sqrt(np.add.reduceat(x ** 2, np.arange(0, len(x), hop)) / hop)
    rms = uniform_filter1d(rms, size=30)
    lo, hi = np.percentile(rms, 10), np.percentile(rms, 90)
    g = 0.35 + 0.65 * np.clip((rms - lo) / (hi - lo + 1e-9), 0, 1)
    return np.interp(np.arange(n), np.arange(len(g)) * hop, g).astype(np.float32)


def pulse_notes(notes, beats, every: int = 2):
    """長音在每 every 拍重新起音（讓高聲部有自己的節奏，和持續音的低／中聲部區分開）。"""
    marks = beats[::every]
    out = []
    for s, d, m in notes:
        cuts = [s] + [t for t in marks if s + 0.25 < t < s + d - 0.25] + [s + d]
        out += [(a, max(0.1, b - a - 0.05), m) for a, b in zip(cuts, cuts[1:])]
    return out


HARMONY2_VOWELS = ("オ", "ウ", "ア")
HARMONY2_PAN = (0.0, -0.6, 0.6)  # 低：中間、中：偏左、高：偏右


def harmony_chorus2(stems, original) -> np.ndarray:
    """可分辨、有起伏的三部和聲（使用者 2026-10-25：「和聲再有點起伏，黏在一起無法分辨」）。
    展開排列（中聲部降八度）、三種母音、左右分開、高聲部每 2 拍重新起音、音符與段落兩層音量起伏。回傳立體聲。"""
    import librosa
    n = int(CLIP * SR)
    chords = chord_track(stems["other"], stems["bass"], original)
    p0, p1, p2 = voice_chords(chords)
    low = [(s, d, m - 12) for s, d, m in p1]
    mid = [(s, d, m + 12 if m < 55 else m) for s, d, m in p0]  # 春日部つむぎ唱 D3 附近會走音（實測 82%）
    ym = librosa.resample(original.mean(axis=1), orig_sr=SR, target_sr=22050)
    _, bf = librosa.beat.beat_track(y=ym, sr=22050, hop_length=512)
    beats = list(librosa.frames_to_time(bf, sr=22050, hop_length=512))
    # 每小節（4 拍）才重新起音，2 拍一次聽起來太機械
    top = pulse_notes(p2, beats, every=4) if len(beats) > 4 else p2
    # 每個聲部的起音隨機錯開 ±20ms（真人合唱不會完全同時）
    jit = np.random.default_rng(11)
    low, mid, top = ([(max(0.1, s + jit.uniform(-0.02, 0.02)), d, m) for s, d, m in v] for v in (low, mid, top))
    phrase = phrase_envelope(stems, n)
    out = np.zeros((n, 2), dtype=np.float32)
    for part, style, vowel, pan, gain in zip((low, mid, top), HARMONY_SINGERS, HARMONY2_VOWELS, HARMONY2_PAN, (0.85, 0.8, 0.8)):
        y = sing_notes(part, vowel, style, natural_curve(part, CLIP, style))[:n]
        y = np.pad(y, (0, n - len(y))) * note_envelope(part, n)
        y = soft_voice(y / (np.sqrt(np.mean(y ** 2)) + 1e-9)) * gain * phrase
        th = (pan + 1) * np.pi / 4
        out[:, 0] += np.cos(th) * y
        out[:, 1] += np.sin(th) * y
    return out / (np.sqrt(np.mean(out ** 2)) + 1e-9) * 0.1


HARMONY2_LEVELS = {"g60": ("和聲 60%", 0.6), "g40": ("和聲 40%", 0.4)}


def build_edm_harmony2(song: dict) -> dict:
    global CLIP
    out_dir, stems, bass, _ = build_styles_cache_only(song)
    CLIP = STYLE_CLIP
    try:
        f = out_dir / "cho_harmony3.npy"
        if f.exists():
            harm = np.load(f)
        else:
            d = np.load(out_dir / "stems.npz")
            harm = harmony_chorus2(stems, d["original"])
            np.save(f, harm)
        _, kick, snare, oh = STYLES["s2"]
        bbox = norm(render_bbox(drum_hits(stems["drums"]), style_kit(kick, snare, oh)))
        base = np.stack([bbox + 0.7 * bass] * 2, axis=1)
        mixes = {"h2_only": harm, **{f"h2_{k}": base + g * harm for k, (_, g) in HARMONY2_LEVELS.items()}}
        tmp = out_dir / "tmp.wav"
        paths = {"original": out_dir / "original.m4a", "edm_bass": out_dir / "edm_bass.m4a",
                 "edm_h2": out_dir / "edm_h2.m4a"}
        for name, data in mixes.items():
            paths[name] = out_dir / f"{name}.m4a"
            bp.encode(bp.finish(data), paths[name], tmp)
        tmp.unlink(missing_ok=True)
    finally:
        CLIP = 15.0
    return {"song": song, "paths": paths}


def write_harmony2_preview(results: list[dict]) -> Path:
    dest = bp.OUT / "acappella_harmony2.html"

    def cell(label, path):
        src = Path(os.path.relpath(path, dest.parent)).as_posix()
        return (f'<div class="cell"><div class="lab">{html.escape(label)}</div>'
                f'<audio controls preload="none" src="{html.escape(src)}"></audio></div>')

    blocks = []
    for r in results:
        s, ps = r["song"], r["paths"]
        cells = [cell("原曲", ps["original"]), cell("B-box＋人聲貝斯", ps["edm_bass"]),
                 cell("和聲單獨（戴耳機聽左右）", ps["h2_only"])]
        cells += [cell(f"B-box＋貝斯＋{label}", ps[f"h2_{k}"]) for k, (label, _) in HARMONY2_LEVELS.items()]
        blocks.append(f'<section><h2>{html.escape(s["t"])} — {html.escape(s["a"])}</h2><div class="row">{"".join(cells)}</div></section>')
    dest.write_text(f"""<!doctype html><meta charset="utf-8"><title>和聲改版試聽</title>
<style>body{{font-family:sans-serif;margin:16px;background:#fafafa}}section{{background:#fff;border:1px solid #ddd;border-radius:8px;padding:12px;margin-bottom:16px}}
h2{{margin:0 0 8px}}.row{{display:flex;flex-wrap:wrap;gap:8px}}.cell{{border:1px solid #eee;border-radius:6px;padding:6px}}.lab{{font-size:13px}}audio{{width:240px}}</style>
<h1>② EDM — 和聲修正版（30 秒）</h1>
<p>新和聲：修正走音：三個聲部的音高全部強制照樂譜（上一版低聲部 VOICEVOX 唱準僅 0〜88%，現在 100%），並加上音與音之間的滑音、長音後段才出現的顫音、各聲部起音錯開 ±20ms。<br>三個聲部拉開音域、母音 低「オ」／中「ウ」／高「ア」、左中右分開、高聲部每小節重新起音；
每個音漸強漸弱，整段跟著原曲能量起伏（副歌大、主歌小）。</p>
<p>B-box：unfa（Freesound 714272，CC0）／人聲貝斯：VOICEVOX:青山龍星／
三部和聲：VOICEVOX:玄野武宏、VOICEVOX:春日部つむぎ、VOICEVOX:四国めたん</p>{"".join(blocks)}""", encoding="utf-8")
    return dest


def build_edm_soft(song: dict) -> dict:
    """只做 ② EDM：B-box、B-box＋貝斯（無和聲）、以及三種輕柔和聲音量。沿用 build_styles 的 30 秒快取。"""
    global CLIP
    r = build_styles_cache_only(song)
    CLIP = STYLE_CLIP
    out_dir, stems, bass, harm = r
    soft = soften(harm)
    _, kick, snare, oh = STYLES["s2"]
    bbox = norm(render_bbox(drum_hits(stems["drums"]), style_kit(kick, snare, oh)))
    tmp = out_dir / "tmp.wav"
    paths = {"original": out_dir / "original.m4a"}
    mixes = {"edm_bbox": bbox, "edm_bass": bbox + 0.7 * bass,
             **{f"edm_{k}": bbox + 0.7 * bass + g * soft for k, (_, g) in SOFT_LEVELS.items()}}
    for name, data in mixes.items():
        paths[name] = out_dir / f"{name}.m4a"
        bp.encode(bp.finish(data), paths[name], tmp)
    tmp.unlink(missing_ok=True)
    CLIP = 15.0
    return {"song": song, "paths": paths}


def build_styles_cache_only(song: dict):
    """讀 build_styles 留下的快取（stems／人聲貝斯／和聲）；沒有快取就先跑一次 build_styles。"""
    out_dir = STYLES_DIR / f"{bp.source_key(song['source'])}-{float(song['start']):g}"
    need = [out_dir / f for f in ("stems.npz", "bass_vocal.npy", "cho_harmony.npy", "original.m4a")]
    if not all(f.exists() for f in need):
        build_styles(song)
    d = np.load(out_dir / "stems.npz")
    stems = {k: d[k] for k in ("drums", "bass", "other", "vocals")}
    return out_dir, stems, np.load(out_dir / "bass_vocal.npy"), np.load(out_dir / "cho_harmony.npy")


def write_edm_preview(results: list[dict]) -> Path:
    dest = bp.OUT / "acappella_edm.html"

    def cell(label, path):
        src = Path(os.path.relpath(path, dest.parent)).as_posix()
        return (f'<div class="cell"><div class="lab">{html.escape(label)}</div>'
                f'<audio controls preload="none" src="{html.escape(src)}"></audio></div>')

    blocks = []
    for r in results:
        s, ps = r["song"], r["paths"]
        cells = [cell("原曲", ps["original"]), cell("① B-box", ps["edm_bbox"]), cell("② ＋人聲貝斯", ps["edm_bass"])]
        cells += [cell(f"③ ＋輕柔{label}", ps[f"edm_{k}"]) for k, (label, _) in SOFT_LEVELS.items()]
        blocks.append(f'<section><h2>{html.escape(s["t"])} — {html.escape(s["a"])}</h2><div class="row">{"".join(cells)}</div></section>')
    dest.write_text(f"""<!doctype html><meta charset="utf-8"><title>EDM 阿卡貝拉試聽</title>
<style>body{{font-family:sans-serif;margin:16px;background:#fafafa}}section{{background:#fff;border:1px solid #ddd;border-radius:8px;padding:12px;margin-bottom:16px}}
h2{{margin:0 0 8px}}.row{{display:flex;flex-wrap:wrap;gap:8px}}.cell{{border:1px solid #eee;border-radius:6px;padding:6px}}.lab{{font-size:13px}}audio{{width:240px}}</style>
<h1>② EDM 阿卡貝拉（30 秒）— 輕柔和聲音量比較</h1>
<p>和聲處理：低通 2.8kHz＋輕殘響，再分 60%／40%／25% 三種音量（先前版本相當於 100%、未處理）。</p>
<p>B-box：unfa（Freesound 714272，CC0）／人聲貝斯：VOICEVOX:青山龍星／
三部和聲：VOICEVOX:玄野武宏、VOICEVOX:春日部つむぎ、VOICEVOX:四国めたん</p>{"".join(blocks)}""", encoding="utf-8")
    return dest


def write_styles_preview(results: list[dict]) -> Path:
    dest = bp.OUT / "acappella_styles.html"

    def href(p: Path) -> str:
        return Path(os.path.relpath(p, dest.parent)).as_posix()

    def cell(label, path):
        return (f'<div class="cell"><div class="lab">{html.escape(label)}</div>'
                f'<audio controls preload="none" src="{html.escape(href(path))}"></audio></div>')

    blocks = []
    for r in results:
        s, ps = r["song"], r["paths"]
        rows = [f'<div class="row">{cell("原曲（30 秒）", ps["original"])}</div>']
        for key, (label, *_rest) in STYLES.items():
            rows.append(f'<div class="row"><div class="style">{html.escape(label)}</div>'
                        f'{cell("只有 B-box", ps[key + "_bbox"])}{cell("B-box＋人聲貝斯＋和聲", ps[key + "_full"])}</div>')
        blocks.append(f'<section><h2>{html.escape(s["t"])} — {html.escape(s["a"])}</h2>{"".join(rows)}</section>')
    dest.write_text(f"""<!doctype html><meta charset="utf-8"><title>B-box 風格試聽</title>
<style>body{{font-family:sans-serif;margin:16px;background:#fafafa}}section{{background:#fff;border:1px solid #ddd;border-radius:8px;padding:12px;margin-bottom:16px}}
h2{{margin:0 0 8px}}.row{{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:6px}}.style{{width:150px;font-weight:bold}}
.cell{{border:1px solid #eee;border-radius:6px;padding:6px}}.lab{{font-size:13px}}audio{{width:260px}}</style>
<h1>B-box 風格試聽（30 秒）</h1><p>B-box：unfa（Freesound 714272，CC0）／人聲貝斯：VOICEVOX:青山龍星／
三部和聲：VOICEVOX:玄野武宏、VOICEVOX:春日部つむぎ、VOICEVOX:四国めたん</p>{"".join(blocks)}""", encoding="utf-8")
    return dest


def main() -> None:
    args = sys.argv[1:]
    if args and args[0] == "--harmony2":
        catalog = bp.song_catalog()
        entries = {e["id"]: e for e in bp.load_entries(bp.HERE / "songs.json")}
        results = []
        for sid in args[1:] or TEST_IDS:
            log(f"== {sid}")
            try:
                results.append(build_edm_harmony2(bp.resolve_entry(entries[sid], catalog)))
                log(f"和聲改版試聽頁：{write_harmony2_preview(results)}")
            except Exception as exc:
                log(f"    失敗：{exc!r}")
        return
    if args and args[0] == "--edm":
        catalog = bp.song_catalog()
        entries = {e["id"]: e for e in bp.load_entries(bp.HERE / "songs.json")}
        results = []
        for sid in args[1:] or TEST_IDS:
            log(f"== {sid}")
            try:
                results.append(build_edm_soft(bp.resolve_entry(entries[sid], catalog)))
                log(f"EDM 試聽頁：{write_edm_preview(results)}")
            except Exception as exc:
                log(f"    失敗：{exc!r}")
        return
    if args and args[0] == "--styles":
        catalog = bp.song_catalog()
        entries = {e["id"]: e for e in bp.load_entries(bp.HERE / "songs.json")}
        results = []
        for sid in args[1:] or TEST_IDS:
            log(f"== {sid}")
            try:
                results.append(build_styles(bp.resolve_entry(entries[sid], catalog)))
                log(f"風格試聽頁：{write_styles_preview(results)}")
            except Exception as exc:
                log(f"    失敗：{exc!r}")
        return
    ids = args or TEST_IDS
    catalog = bp.song_catalog()
    entries = {e["id"]: e for e in bp.load_entries(bp.HERE / "songs.json")}
    lyrics = json.loads((bp.HERE / "lyrics.json").read_text(encoding="utf-8"))
    kits = {"a": synth_kit(), "b": voicevox_kit(), **{k: avp_kit(*v) for k, v in AVP_KITS.items()},
            "unfa_n": unfa_kit("natural"), "unfa_e": unfa_kit("edm")}
    results = []
    for sid in ids:
        log(f"== {sid}")
        song = bp.resolve_entry(entries[sid], catalog)
        song["voice"] = (lyrics.get(sid) or {}).get("voice", "female")
        try:
            results.append(build(song, kits))
        except Exception as exc:  # 單首失敗不中斷
            log(f"    失敗：{exc!r}")
    log(f"試聽頁：{write_preview(results)}")
    log(f"unfa 單音清單：{unfa_browser()}")


if __name__ == "__main__":
    main()
