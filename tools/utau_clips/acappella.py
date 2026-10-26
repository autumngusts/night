"""我不會唱歌（utau）進階模式：阿卡貝拉編曲（acap_bbox／acap_bass／acap_full）。

使用者提案（2026-10-25）：B-box → 加入貝斯 → 加入和聲，三個獨立的題目版本。試聽多輪後定案（2026-10-26）：
  B-box   鼓軌找打擊點並分類（大鼓／小鼓／Hi-hat）→ 換成 unfa 的真人口技單音（② EDM 組合：短大鼓＋「psh」小鼓＋閉合 Hi-hat）。
          程式合成的口技音色（簡單合成、模擬口腔共鳴）、VOICEVOX 念的口技、AVP 資料集（新手錄音）都試聽後不採用。
  貝斯    貝斯軌 CREPE 音符 → VOICEVOX 青山龍星唱「ドゥ」，混音 0.7。（Demucs 原始貝斯軌不採用）
  和聲    其他樂器軌推和弦 → 三部展開排列 → 節奏伴唱：每拍正拍「ドゥ」、反拍「ワ」，混音 40%。
          （試聽過「ウ」長音、「オ・ウ・ア」、哼唱「ン」、6 人合唱團、主旋律＋和聲、非 VOICEVOX 合成合唱後選定）
  所有 VOICEVOX 聲部都強制 f0：只給樂譜時低音域會走音（實測低聲部唱準 0〜88%，強制後 99〜100%）。

需要：VOICEVOX ENGINE（ja_voice）、unfa 口技單音集（cache/unfa/，第一次自動下載，不進 Git）。
由 build_pack.build_acappella() 呼叫；歌曲片段長度＝ACAP_CLIP。
"""

from __future__ import annotations

import json

import numpy as np

import build_pack as bp
import ja_voice as jv

SR = bp.SR
# 使用者 2026-10-25：「音樂長度需要 30s」
ACAP_CLIP = 30.0
# 製作方式改變時遞增（成品資料夾 acap-v<版本>/）
ACAP_VERSION = 1
NAMES = ("acap_bbox", "acap_bass", "acap_full")
BASS_SINGER = 3013  # 青山龍星（ノーマル）
HARMONY_SINGERS = (3011, 3008, 3002)  # 低：玄野武宏、中：春日部つむぎ、高：四国めたん
HARMONY_PAN = (0.0, -0.6, 0.6)  # 低：中間、中：偏左、高：偏右
HARMONY_GAIN = (0.85, 0.8, 0.8)
BASS_LEVEL = 0.7
HARMONY_LEVEL = 0.4


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
    （三個頻段各自找 onset 時，Hi-hat 的 1.5〜5kHz 成分會被當成小鼓。）"""
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


# unfa 的口技單音集（Freesound 714272「unfa's complete beatbox one-shot set 2023」，CC0；錄音室錄音）。
# 原檔要登入，這裡用公開的 HQ 試聽 mp3（cache/unfa/，不進 Git）。整段沒有標註，依作者說明的錄音順序加上頻譜挑出下列起點（秒）。
UNFA_FILE = bp.CACHE / "unfa" / "unfa_hq.mp3"
UNFA_URL = "https://cdn.freesound.org/previews/714/714272_1038806-hq.mp3"
UNFA_KIT = {  # 名稱: (起點, 最長秒數, 音量)
    "kick": ([1.30, 2.46, 4.23, 9.80, 10.69], 0.35, 1.0),  # 餘音短的大鼓
    "snare": ([20.85, 21.90, 28.24], 0.35, 0.8),  # EDM 風「psh」小鼓
    "hat": ([44.76, 47.68, 127.59, 138.47, 143.65], 0.15, 0.45),  # 閉合 Hi-hat
}
_kit_cache: dict | None = None


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


def bbox_kit() -> dict[str, list[np.ndarray]]:
    global _kit_cache
    if _kit_cache is None:
        import librosa

        if not UNFA_FILE.exists():
            import urllib.request

            UNFA_FILE.parent.mkdir(parents=True, exist_ok=True)
            urllib.request.urlretrieve(UNFA_URL, UNFA_FILE)
        y = _band(bp.load_audio(UNFA_FILE).mean(axis=1), 40, None).astype(np.float32)
        onsets = librosa.onset.onset_detect(y=y, sr=SR, units="time", backtrack=True, delta=0.2)
        _kit_cache = {k: _oneshots(y, onsets, ts, ml, lv) for k, (ts, ml, lv) in UNFA_KIT.items()}
    return _kit_cache


def render_bbox(hits, sec: float, seed: int = 7) -> np.ndarray:
    """打擊點 → B-box。每種音有多個真人錄音變化，每一下隨機挑一個。"""
    kit = bbox_kit()
    rng = np.random.default_rng(seed)
    out = np.zeros(int(sec * SR) + SR, dtype=np.float32)
    for t, name, v in hits:
        s = kit[name][rng.integers(len(kit[name]))]
        a = int(t * SR)
        b = min(len(out), a + len(s))
        out[a:b] += s[: b - a] * (0.55 + 0.45 * v)
    return out[: int(sec * SR)]


# ---------------- VOICEVOX 唱音符 ----------------


def _fr(t: float) -> int:
    return int(round(t * jv.FPS))


def sing_notes(notes: list, lyric: str, style: int, curve, sec: float, win: float = 20.0, tail: float = 2.0) -> np.ndarray:
    """音符 [(開始, 長度, MIDI)] → VOICEVOX 歌聲，f0 強制成 curve＝(t10, midi10)。
    超過 25 秒時每 win 秒分段交給 VOICEVOX，再疊回原位置（一次送太長會很慢）。"""
    if sec <= 25:
        return _sing_chunk(notes, lyric, style, curve, sec)
    out = np.zeros(int(sec * SR) + int(tail * SR), dtype=np.float32)
    w0 = 0.0
    while w0 < sec:
        sub = [(s - w0, d, m) for s, d, m in notes if w0 <= s < w0 + win]
        if sub:
            y = _sing_chunk(sub, lyric, style, (curve[0] - w0, curve[1]), win + tail)
            a = int(w0 * SR)
            out[a: a + len(y)] += y[: len(out) - a]
        w0 += win
    return out[: int(sec * SR)]


def _sing_chunk(notes: list, lyric: str, style: int, curve, sec: float) -> np.ndarray:
    jv.ensure_engine()
    n = int(sec * SR)
    notes = sorted((max(0.1, s), d, m) for s, d, m in notes if s + d > 0.12 and s < sec - 0.05)
    clean = []
    for s, d, m in notes:  # 去掉重疊
        if clean and s < clean[-1][0] + clean[-1][1]:
            ps, pd, pm = clean[-1]
            clean[-1] = (ps, max(0.05, s - ps), pm)
        clean.append((s, min(d, sec - s), m))
    clean = [c for c in clean if c[1] >= 0.05]
    if not clean:
        return np.zeros(n, dtype=np.float32)
    score = [{"key": None, "frame_length": max(1, _fr(clean[0][0])), "lyric": ""}]
    for i, (s, d, m) in enumerate(clean):
        e = s + d
        nxt = clean[i + 1][0] if i + 1 < len(clean) else sec
        if nxt - e > 0.03:
            score.append({"key": int(m), "frame_length": max(1, _fr(e) - _fr(s)), "lyric": lyric})
            score.append({"key": None, "frame_length": max(1, _fr(nxt) - _fr(e)), "lyric": ""})
        else:
            score.append({"key": int(m), "frame_length": max(1, _fr(nxt) - _fr(s)), "lyric": lyric})
    q = json.loads(jv._post("/sing_frame_audio_query", {"speaker": jv.TEACHER}, {"notes": score}))
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


def natural_curve(notes, sec: float, seed: int, glide: bool = True):
    """樂譜 → f0 曲線（MIDI，每 10ms）：音與音之間滑音、0.45 秒後才出現的顫音（5.3Hz、±0.2 半音）、
    很小的隨機飄移。glide=False 時是不加修飾的階梯（貝斯用）。"""
    from scipy.ndimage import gaussian_filter1d

    t = np.arange(int(sec * 100)) * 0.01
    step = np.full(len(t), np.nan)
    vib = np.zeros(len(t))
    for s, d, m in notes:
        a, b = int(s * 100), min(len(t), int((s + d) * 100))
        step[a:b] = m
        if glide and d > 0.6:
            k = np.arange(b - a) * 0.01
            vib[a:b] = 0.2 * np.clip((k - 0.45) / 0.3, 0, 1) * np.sin(2 * np.pi * 5.3 * k)
    ok = ~np.isnan(step)
    if not ok.any():
        return t, np.full(len(t), 60.0)
    step = np.interp(t, t[ok], step[ok])
    if not glide:
        return t, step
    drift = gaussian_filter1d(np.random.default_rng(seed).standard_normal(len(t)), 40) * 0.05 / 0.06
    return t, gaussian_filter1d(step, 3) + vib + drift


# ---------------- 人聲貝斯 ----------------


def vocal_bass(bass: np.ndarray, sec: float) -> np.ndarray:
    notes = bp.crepe_notes(bass, fmin=35, fmax=400)  # torchcrepe 在 fmin 低於約 32Hz 時整段回傳 NaN
    if not notes:
        return np.zeros(int(sec * SR), dtype=np.float32)
    # 青山龍星唱得穩的音域（約 A2）；原貝斯多半在 E1〜E2，通常升一個八度
    k = 12 * round((45 - float(np.median([x[2] for x in notes]))) / 12)
    notes = [(s, d, m + k) for s, d, m in notes]
    return sing_notes(notes, "ドゥ", BASS_SINGER, natural_curve(notes, sec, 0, glide=False), sec)


# ---------------- 和弦 → 節奏伴唱 ----------------


def chord_track(other: np.ndarray, bass: np.ndarray, mix: np.ndarray):
    """[(開始, 長度, 根音 0〜11, 大三和弦?)] 與拍點（秒）：以拍為單位比對 24 種三和弦，再用動態規劃抑制頻繁換和弦。
    （試過「先判調、只用調內和弦」，與貝斯的吻合度沒有變好，不採用。）"""
    import librosa

    sr = 22050
    y = librosa.resample((other + 0.6 * bass).mean(axis=1), orig_sr=SR, target_sr=sr)
    chroma = librosa.feature.chroma_cqt(y=y, sr=sr, hop_length=512)
    ym = librosa.resample(mix.mean(axis=1), orig_sr=SR, target_sr=sr)
    _, beats = librosa.beat.beat_track(y=ym, sr=sr, hop_length=512)
    bounds = sorted(set([0] + [int(b) for b in beats if 0 < b < chroma.shape[1]] + [chroma.shape[1]]))
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
            out[-1] = (out[-1][0], to_t(b) - out[-1][0], root, major)
        else:
            out.append((to_t(a), to_t(b) - to_t(a), root, major))
    return out, [float(t) for t in librosa.frames_to_time(beats, sr=sr, hop_length=512)]


def voice_chords(chords) -> list[list[tuple[float, float, int]]]:
    """每個和弦排成三個聲部，選與上一個和弦移動最少的轉位（緊密排列，高聲部在 MIDI 64〜76），
    再展開：中聲部降八度當低聲部，原低聲部當中聲部（低於 MIDI 55 升八度，春日部つむぎ唱 D3 附近會走音）。
    緊密排列時三個聲部擠在一個八度內，使用者試聽「黏在一起無法分辨」。"""
    parts = [[], [], []]
    prev = None
    for s, d, root, major in chords:
        pcs = [root, (root + (4 if major else 3)) % 12, (root + 7) % 12]
        cands = []
        for top in range(64, 77):
            if top % 12 not in pcs:
                continue
            others = [p for p in pcs if p != top % 12]
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
    p0, p1, p2 = ([(s, max(0.1, d - 0.06), m) for s, d, m in p] for p in parts)  # 每個音尾留一點換氣
    return [[(s, d, m - 12) for s, d, m in p1], [(s, d, m + 12 if m < 55 else m) for s, d, m in p0], p2]


def comp_notes(part, beats):
    """節奏伴唱：每拍正拍短音「ドゥ」、反拍「ワ」，音高取當下的和聲音。"""
    on, off = [], []
    for b0, b1 in zip(beats, beats[1:]):
        ibi = b1 - b0
        for t, dur, dst in ((b0, 0.35 * ibi, on), (b0 + 0.5 * ibi, 0.4 * ibi, off)):
            m = next((m for s, d, m in part if s <= t + 0.02 < s + d), None)
            if m is not None:
                dst.append((t, max(0.08, dur), m))
    return on, off


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


def soft_voice(x: np.ndarray, wet: float = 0.25) -> np.ndarray:
    """輕柔處理（使用者：「和聲再輕柔一點」）：低通 2.8kHz 去掉 VOICEVOX 偏亮的高頻＋少量殘響。"""
    from scipy.signal import butter, fftconvolve, sosfiltfilt

    y = sosfiltfilt(butter(4, 2800, "low", fs=SR, output="sos"), x).astype(np.float32)
    n = int(1.2 * SR)
    ir = np.random.default_rng(3).standard_normal(n).astype(np.float32) * np.exp(-np.arange(n) / (0.3 * SR))
    ir = sosfiltfilt(butter(2, 3500, "low", fs=SR, output="sos"), ir).astype(np.float32)
    rv = fftconvolve(y, ir)[: len(y)].astype(np.float32)
    rv *= np.sqrt(np.mean(y ** 2)) / (np.sqrt(np.mean(rv ** 2)) + 1e-9)
    return y + wet * rv


def _unit(x: np.ndarray) -> np.ndarray:
    return x / (float(np.sqrt(np.mean(x ** 2))) + 1e-9)


def sing_voice(part, style: int, vowel: str, seed: int, sec: float) -> np.ndarray:
    n = int(sec * SR)
    y = sing_notes(part, vowel, style, natural_curve(part, sec, seed), sec)[:n]
    return _unit(np.pad(y, (0, n - len(y))) * note_envelope(part, n))


def harmony(stems, original: np.ndarray, sec: float) -> np.ndarray:
    """節奏伴唱三部和聲 → 立體聲（RMS 1）。"""
    n = int(sec * SR)
    chords, beats = chord_track(stems["other"], stems["bass"], original)
    phrase = phrase_envelope(stems, n)
    out = np.zeros((n, 2), dtype=np.float32)
    for part, style, pan, gain in zip(voice_chords(chords), HARMONY_SINGERS, HARMONY_PAN, HARMONY_GAIN):
        on, off = comp_notes(part, beats)
        y = 0.8 * sing_voice(on, style, "ドゥ", style, sec) + sing_voice(off, style, "ワ", style + 1, sec)
        y = soft_voice(_unit(y)) * gain * phrase
        th = (pan + 1) * np.pi / 4
        out[:, 0] += np.cos(th) * y
        out[:, 1] += np.sin(th) * y
    return _unit(out)


# ---------------- 三個版本 ----------------


def make(stems: dict, original: np.ndarray, sec: float = ACAP_CLIP) -> dict[str, np.ndarray]:
    """stems（drums／bass／other／vocals，與 original 同長、sec 秒）→ {acap_bbox, acap_bass, acap_full}（立體聲，未正規化）。"""
    n = int(sec * SR)
    bbox = _unit(render_bbox(drum_hits(stems["drums"]), sec))
    bass = _unit(vocal_bass(stems["bass"], sec)[:n])
    with_bass = np.stack([bbox + BASS_LEVEL * bass] * 2, axis=1)
    return {
        "acap_bbox": np.stack([bbox] * 2, axis=1),
        "acap_bass": with_bass,
        "acap_full": with_bass + HARMONY_LEVEL * harmony(stems, original, sec),
    }
