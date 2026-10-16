"""我不會唱歌（utau）進階模式：中文版音檔（zh_read 中文朗讀＋伴奏、zh_sing 中文歌聲、zh_sing_inst 歌聲＋伴奏）。

由 build_pack.py 呼叫；歌詞來自 lyrics.json（不進 Git，譯詞與填詞在對話中由 Claude 撰寫）。

- zh_read：每句中文譯詞（lines[].zh）用 edge-tts 台灣語音朗讀，放在原曲該句開始的時間點（lines[].t），疊上伴奏。
- zh_sing：中文填詞（lines[].sing，一字一音節）用 DiffSinger 聲庫唱原曲旋律。
    音高＝原唱的 CREPE 曲線（保留滑音、顫音），移八度到聲庫音域；
    字的起點對到原唱人聲的發音起點（onset），比對到 CREPE 音符起點時節奏準確率高（Ria 72%→78%、綺萱 83%，2026-10-17 實測）。
    聲庫依原唱性別：male → Ria／狸安、female → 綺萱（lyrics.json 的 voice）。
- zh_sing_inst：zh_sing＋伴奏，作為遊戲中「播放 5 次後可加上伴奏」的提示。

模型放在 models/（不進 Git，安裝方式見 README.md）。
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import subprocess
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
MODELS = HERE / "models"
LYRICS = HERE / "lyrics.json"
SR = 44100
FR = SR / 512  # DiffSinger 每秒 frame 數
ZH_RECIPE = 1  # 中文版製作方式改變時遞增，快取自動失效
TTS_VOICES = {"female": "zh-TW-HsiaoChenNeural", "male": "zh-TW-YunJheNeural"}
SING_VOICES = {"male": "ria", "female": "qixuan"}
VOCODER = "pc_nsf_hifigan_44.1k_hop512_128bin_2025.02.onnx"


def load_lyrics() -> dict:
    if not LYRICS.exists():
        return {}
    return json.loads(LYRICS.read_text(encoding="utf-8"))


def lyric_key(entry: dict) -> str:
    """歌詞內容＋聲線＋製作方式 → 快取鍵（改了譯詞就重做）。"""
    raw = json.dumps({"lines": entry["lines"], "voice": entry.get("voice"), "r": ZH_RECIPE}, ensure_ascii=False, sort_keys=True)
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:10]


def ready(entry: dict) -> tuple[bool, bool]:
    """(可以做朗讀, 可以做歌聲)：每一句都要有 zh／sing。"""
    lines = entry.get("lines") or []
    return bool(lines) and all(l.get("zh") for l in lines), bool(lines) and all(l.get("sing") for l in lines)


# ---------------- 朗讀（edge-tts）----------------


async def _tts(text: str, voice: str, dest: Path) -> None:
    import edge_tts

    for attempt in range(4):  # edge-tts 偶爾回傳空音訊，重試
        try:
            await edge_tts.Communicate(text, voice).save(str(dest))
            return
        except edge_tts.exceptions.NoAudioReceived:
            await asyncio.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"edge-tts 失敗：{text}")


def read_aloud(entry: dict, clip: float, tmp_dir: Path, decode, ffmpeg: str) -> np.ndarray:
    """每句朗讀放在該句時間點；念不完就加速（最多 1.35 倍）。回傳單聲道。"""
    voice = TTS_VOICES[entry.get("voice", "female")]
    out = np.zeros(int(clip * SR), dtype=np.float32)
    lines = entry["lines"]
    for i, line in enumerate(lines):
        mp3 = tmp_dir / f"line{i}.mp3"
        asyncio.run(_tts(line["zh"], voice, mp3))
        x = decode(mp3).mean(axis=1)
        mp3.unlink(missing_ok=True)
        idx = np.where(np.abs(x) > 0.01 * (np.abs(x).max() + 1e-9))[0]
        if len(idx):
            x = x[idx[0]: idx[-1] + 1]
        room = (lines[i + 1]["t"] if i + 1 < len(lines) else clip) - line["t"] - 0.1
        dur = len(x) / SR
        if dur > room > 0:
            rate = min(1.35, dur / room)
            res = subprocess.run(
                [ffmpeg, "-hide_banner", "-loglevel", "error", "-f", "f32le", "-ar", str(SR), "-ac", "1", "-i", "-",
                 "-af", f"atempo={rate:.3f}", "-f", "f32le", "-ac", "1", "-ar", str(SR), "-"],
                input=x.astype(np.float32).tobytes(), check=True, capture_output=True,
            )
            x = np.frombuffer(res.stdout, dtype=np.float32)
        a = int(line["t"] * SR)
        b = min(len(out), a + len(x))
        if b > a:
            out[a:b] += x[: b - a]
    return out


# ---------------- 歌聲（DiffSinger）----------------

_SESS = {}


def _sess(path: Path):
    import onnxruntime as ort

    key = str(path)
    if key not in _SESS:
        opt = ort.SessionOptions()
        opt.log_severity_level = 3
        _SESS[key] = ort.InferenceSession(key, opt, providers=["CPUExecutionProvider"])
    return _SESS[key]


class _Model:
    """DiffSinger 子模型資料夾（dsconfig.yaml＋自己的音素表／語言表）。"""

    def __init__(self, folder: Path):
        import yaml

        self.dir = folder
        self.cfg = yaml.safe_load(open(folder / "dsconfig.yaml", encoding="utf-8"))
        ph = folder / self.cfg["phonemes"]
        if ph.suffix == ".json":
            self.ph = json.loads(ph.read_text(encoding="utf-8"))
        else:
            self.ph = {p: i for i, p in enumerate(ph.read_text(encoding="utf-8").split())}
        lang = self.cfg.get("languages")
        self.lang = json.loads((folder / lang).read_text(encoding="utf-8")) if lang else None

    def tokens(self, phs):
        return np.array([[self.ph[p] for p in phs]], np.int64)

    def languages(self, phs):
        return np.array([[self.lang.get(p.split("/")[0], 0) if "/" in p else 0 for p in phs]], np.int64)


class _Voice:
    TARGET_MIDI = {"ria": 57, "qixuan": 69}  # Ria 音域 A2〜G#4；綺萱是少女聲

    def __init__(self, name: str):
        import yaml

        root = MODELS / name
        if not root.exists():
            raise FileNotFoundError(f"找不到聲庫 {root}（安裝方式見 README.md）")
        self.ac, self.dur, self.var = _Model(root), _Model(root / "dsdur"), _Model(root / "dsvariance")
        self.acoustic = _sess(root / self.ac.cfg["acoustic"])
        self.dur_ling = _sess(root / "dsdur" / self.dur.cfg["linguistic"])
        self.dur_pred = _sess(root / "dsdur" / self.dur.cfg["dur"])
        self.var_ling = _sess(root / "dsvariance" / self.var.cfg["linguistic"])
        self.var_pred = _sess(root / "dsvariance" / self.var.cfg["variance"])
        d = yaml.safe_load(open(root / "dsdur" / "dsdict-zh.yaml", encoding="utf-8"))
        self.g2p = {e["grapheme"]: e["phonemes"] for e in d["entries"]}
        self.vowels = {s["symbol"] for s in d["symbols"] if s["type"] in ("vowel", "coda")}
        self.var_inputs = {i.name: i for i in self.var_pred.get_inputs()}
        self.ac_inputs = {i.name for i in self.acoustic.get_inputs()}
        self.target_midi = self.TARGET_MIDI[name]

    def split_lead(self, phs):
        """音素分成「音符起點前」（子音、介音）與「起點後」（母音起）。"""
        for i, p in enumerate(phs):
            if p in self.vowels:
                return phs[:i], phs[i:]
        return [], phs


_VOICES = {}


def _voice(name: str) -> _Voice:
    if name not in _VOICES:
        _VOICES[name] = _Voice(name)
    return _VOICES[name]


def _pinyin(text: str) -> list[str]:
    from pypinyin import Style, lazy_pinyin

    # 填詞中的「著」都是助詞（zhe），pypinyin 會念成 zhu
    return ["zhe" if ch == "著" else py for ch, py in zip(text, lazy_pinyin(text, style=Style.NORMAL, v_to_u=False))]


def _crepe(vocals: np.ndarray):
    import librosa
    import torch
    import torchcrepe

    y16 = librosa.resample(vocals.mean(axis=1), orig_sr=SR, target_sr=16000)
    f0, per = torchcrepe.predict(torch.tensor(y16)[None], 16000, hop_length=160, fmin=80, fmax=1000, model="full",
                                 return_periodicity=True, batch_size=512, device="cpu", decoder=torchcrepe.decode.viterbi)
    return f0[0].numpy(), per[0].numpy()


def _onsets(vocals: np.ndarray):
    import librosa

    y = librosa.resample(vocals.mean(axis=1), orig_sr=SR, target_sr=22050)
    env = librosa.onset.onset_strength(y=y, sr=22050, hop_length=256)
    on = librosa.onset.onset_detect(onset_envelope=env, sr=22050, hop_length=256, units="frames")
    return librosa.frames_to_time(on, sr=22050, hop_length=256), env[on] / (env.max() + 1e-9)


def _choose(cands, strength, k, t0, t1):
    """從候選起點挑 k 個（遞增）：盡量平均分布在 [t0, t1)，並偏好強的發音起點（動態規劃）。"""
    n = len(cands)
    target = [t0 + i * (t1 - t0) / k for i in range(k)]
    cost = np.full((k, n), 1e18)
    back = np.zeros((k, n), dtype=int)
    for j in range(n):
        cost[0][j] = (cands[j] - target[0]) ** 2 * 4 - 0.02 * strength[j]
    for i in range(1, k):
        for j in range(i, n):
            b = int(np.argmin(cost[i - 1][:j]))
            cost[i][j] = cost[i - 1][b] + (cands[j] - target[i]) ** 2 - 0.02 * strength[j]
            back[i][j] = b
    j = int(np.argmin(cost[k - 1]))
    idx = [j]
    for i in range(k - 1, 0, -1):
        j = back[i][j]
        idx.append(j)
    return [cands[i] for i in idx[::-1]]


def _spans(starts, line_end, t10, voiced):
    """每個字唱到下一個字起點；中間原唱有 ≥ 120ms 無聲就在無聲處結束（留休止）。"""
    spans = []
    for i, s in enumerate(starts):
        nxt = starts[i + 1] if i + 1 < len(starts) else line_end
        e = nxt
        idx = np.where((t10 >= s + 0.08) & (t10 < nxt))[0]
        run = 0
        for k in range(len(idx) - 1, -1, -1):
            if not voiced[idx[k]]:
                run += 1
            else:
                if run >= 12:
                    e = t10[idx[k]] + 0.01
                break
        spans.append((s, e))
    return spans


def sing(entry: dict, vocals: np.ndarray, notes: list, clip: float) -> np.ndarray:
    """中文填詞歌聲（單聲道）。notes＝build_pack.crepe_notes(vocals) 的結果。"""
    vc = _voice(SING_VOICES[entry.get("voice", "female")])
    f0, per = _crepe(vocals)
    t10 = np.arange(len(f0)) * 0.01
    voiced = per > 0.3
    midi10 = 69 + 12 * np.log2(np.maximum(f0, 1) / 440)
    shift = 12 * round((vc.target_midi - float(np.median(midi10[voiced]))) / 12)
    ot, os_ = _onsets(vocals)
    lines = entry["lines"]
    spans, pys = [], []
    for i, line in enumerate(lines):
        end = lines[i + 1]["t"] if i + 1 < len(lines) else clip
        ns = [n for n in notes if line["t"] - 0.15 <= n[0] < end - 0.15]
        if not ns:
            continue
        k = len(line["sing"])
        s0, e0 = ns[0][0], max(n[0] + n[1] for n in ns)
        mask = (ot >= s0 - 0.08) & (ot < e0 - 0.1)
        cands, strg = list(ot[mask]), list(os_[mask])
        if not cands or abs(cands[0] - s0) > 0.08:  # 第一個字一定從該句第一個音開始
            cands, strg = [s0] + cands, [1.0] + strg
        if len(cands) < k:  # 發音起點不夠：補音符起點
            extra = [n[0] for n in ns if all(abs(n[0] - c) > 0.05 for c in cands)]
            merged = sorted(zip(cands + extra, strg + [0.0] * len(extra)))
            cands, strg = [m[0] for m in merged], [m[1] for m in merged]
        if len(cands) < k:  # 還是不夠：平分時間
            cands, strg = [s0 + j * (e0 - s0) / k for j in range(k)], [0.0] * k
        spans += _spans(_choose(np.array(cands), np.array(strg), k, s0, e0), e0, t10, voiced)
        pys += _pinyin(line["sing"])
    missing = sorted({p for p in pys if p not in vc.g2p})
    if missing:
        raise ValueError(f"聲庫字典裡沒有這些拼音：{missing}")

    gm = np.interp(t10, t10[voiced], midi10[voiced]) if voiced.any() else np.full(len(t10), 60.0)

    def midi_at(s, e):
        m = (t10 >= s) & (t10 < e)
        return int(round(np.median(gm[m]) + shift)) if m.any() else 60

    chars = [(s, e, midi_at(s, e)) for s, e in spans]
    # word 序列：子音歸前一個 word，音符起點＝母音起點（DiffSinger 慣例）
    lead0, _ = vc.split_lead(vc.g2p[pys[0]])
    words = [(["SP"] + lead0, [chars[0][2]] * (1 + len(lead0)), 0.0)]
    for i, ((s, e, m), py) in enumerate(zip(chars, pys)):
        _, rest = vc.split_lead(vc.g2p[py])
        if i + 1 < len(chars):
            ns_, _, nm = chars[i + 1]
            nlead, _ = vc.split_lead(vc.g2p[pys[i + 1]])
            if ns_ - e > 0.02:
                words.append((rest, [m] * len(rest), s))
                words.append((["SP"] + nlead, [nm] * (1 + len(nlead)), e))
            else:
                words.append((rest + nlead, [m] * len(rest) + [nm] * len(nlead), s))
        else:
            words.append((rest, [m] * len(rest), s))
            words.append((["SP"], [m], e))
    bounds = [int(round(w[2] * FR)) for w in words] + [int(round(clip * FR))]
    word_dur = np.maximum(np.diff(bounds), 1)
    phs = [p for w in words for p in w[0]]

    feed = {"tokens": vc.dur.tokens(phs), "word_div": np.array([[len(w[0]) for w in words]], np.int64),
            "word_dur": np.array([word_dur], np.int64)}
    if vc.dur.lang:
        feed["languages"] = vc.dur.languages(phs)
    enc, mask = vc.dur_ling.run(None, feed)
    pred = vc.dur_pred.run(None, {"encoder_out": enc, "x_masks": mask,
                                  "ph_midi": np.array([[m for w in words for m in w[1]]], np.int64)})[0][0]
    # 每個 word 內：結尾的子音（下一個字的開頭）照預測長度但不超過 40%，其餘按預測比例分配
    ph_dur, k = [], 0
    for w, W in zip(words, word_dur):
        wp = w[0]
        p = np.maximum(pred[k:k + len(wp)], 0.5)
        n_tail = len(wp) - 1 if wp[0] == "SP" else next((j for j, ph in enumerate(reversed(wp)) if ph in vc.vowels), len(wp))
        head, tail = p[: len(wp) - n_tail], p[len(wp) - n_tail:]
        tail_sum = min(float(tail.sum()), 0.4 * W) if len(tail) else 0.0
        tail = tail * (tail_sum / tail.sum()) if len(tail) else tail
        head = head * ((W - tail_sum) / head.sum())
        cum = np.round(np.cumsum(np.concatenate([head, tail]))).astype(int)
        cum[-1] = W
        ph_dur += list(np.diff(np.concatenate([[0], cum])))
        k += len(wp)
    ph_dur = np.maximum(np.array(ph_dur, np.int64), 1)
    n_frames = int(ph_dur.sum())
    pitch = np.interp(np.arange(n_frames) / FR, t10, gm) + shift
    pitch = np.convolve(np.pad(pitch, 2, mode="edge"), np.ones(5) / 5, mode="valid").astype(np.float32)
    f0_hz = (440 * 2 ** ((pitch - 69) / 12)).astype(np.float32)
    durs = np.array([ph_dur], np.int64)
    zeros = np.zeros((1, n_frames), np.float32)

    feed = {"tokens": vc.var.tokens(phs), "ph_dur": durs}
    if vc.var.lang:
        feed["languages"] = vc.var.languages(phs)
    venc, _ = vc.var_ling.run(None, feed)
    vfeed = {"encoder_out": venc, "ph_dur": durs, "pitch": pitch[None],
             "retake": np.ones((1, n_frames, vc.var_inputs["retake"].shape[-1]), bool), "steps": np.array(10, np.int64)}
    for name in ("breathiness", "voicing", "tension"):
        if name in vc.var_inputs:
            vfeed[name] = zeros
    outs = dict(zip([o.name for o in vc.var_pred.get_outputs()], vc.var_pred.run(None, vfeed)))
    afeed = {"tokens": vc.ac.tokens(phs), "durations": durs, "f0": f0_hz[None], "gender": zeros,
             "velocity": np.ones((1, n_frames), np.float32), "depth": np.array(0.6, np.float32), "steps": np.array(20, np.int64)}
    if "languages" in vc.ac_inputs:
        afeed["languages"] = vc.ac.languages(phs)
    for name in ("breathiness", "voicing", "tension"):
        if name in vc.ac_inputs:
            afeed[name] = outs.get(name + "_pred", zeros)
    mel = vc.acoustic.run(None, afeed)[0]
    wav = _sess(MODELS / "vocoder" / VOCODER).run(None, {"mel": mel, "f0": f0_hz[None]})[0][0]
    wav = wav[: int(clip * SR)].astype(np.float32)
    return np.pad(wav, (0, max(0, int(clip * SR) - len(wav))))


def rms(x: np.ndarray) -> float:
    return float(np.sqrt(np.mean(x ** 2))) + 1e-9


def over_backing(voice: np.ndarray, inst: np.ndarray, level: float) -> np.ndarray:
    """人聲疊伴奏：兩者先各自正規化，伴奏乘上 level（朗讀 0.45、歌聲 0.5，試聽後決定）。"""
    n = min(len(voice), len(inst))
    return voice[:n] / rms(voice) + level * inst[:n] / rms(inst)
