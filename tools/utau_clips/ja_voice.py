"""我不會唱歌（utau）進階模式：日文歌聲（ja_sing、ja_sing_inst）。

華語歌的日文填詞（lyrics.json 的 lines[].ja_sing，一個假名唱一個音）用 VOICEVOX 角色唱原曲旋律：
  原唱人聲 onset → 每個假名的起訖（與 zh_voice 相同的對齊方式）→ VOICEVOX 樂譜（93.75 fps）
  → /sing_frame_audio_query（波音リツ的歌唱模型決定音素與時長）
  → f0 換成原唱的 CREPE 曲線（移八度到角色音域，保留滑音、顫音）→ /frame_synthesis（指定角色）
角色（使用者試聽後指定，2026-10-17）：原唱 male → 玄野武宏、female → 四国めたん。
ja_sing_inst＝ja_sing＋伴奏，遊戲中播放 5 次後可用的提示。

VOICEVOX ENGINE 放在 models/voicevox/windows-cpu/（不進 Git）；沒在執行時會自動啟動，結束時關閉。
使用規約：作品中要標示「VOICEVOX:角色名」（遊戲畫面已標示）。
"""

from __future__ import annotations

import atexit
import json
import subprocess
import time
import urllib.parse
import urllib.request
from pathlib import Path

import numpy as np

import zh_voice as zv

HERE = Path(__file__).resolve().parent
ENGINE = HERE / "models" / "voicevox" / "windows-cpu" / "run.exe"
API = "http://127.0.0.1:50021"
FPS = 93.75  # VOICEVOX 歌唱的 frame rate（24000 / 256）
SR = 44100
TEACHER = 6000  # 波音リツ（sing）
ROLES = {"male": ("玄野武宏", 3011, 57), "female": ("四国めたん", 3002, 65)}  # 名稱, style id, 旋律中位數要移到的 MIDI
_proc = None


def ready(entry: dict) -> bool:
    lines = entry.get("lines") or []
    return bool(lines) and all(l.get("ja_sing") for l in lines)


def _alive() -> bool:
    try:
        urllib.request.urlopen(API + "/version", timeout=2).read()
        return True
    except Exception:
        return False


def ensure_engine() -> None:
    """引擎沒在跑就啟動（本工具結束時關閉）。"""
    global _proc
    if _alive():
        return
    if not ENGINE.exists():
        raise FileNotFoundError(f"找不到 VOICEVOX ENGINE：{ENGINE}（安裝方式見 README.md）")
    _proc = subprocess.Popen([str(ENGINE), "--host", "127.0.0.1", "--port", "50021"], cwd=str(ENGINE.parent),
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    atexit.register(_proc.terminate)
    for _ in range(90):
        if _alive():
            return
        time.sleep(1)
    raise RuntimeError("VOICEVOX ENGINE 啟動逾時")


def _post(path: str, params: dict, body) -> bytes:
    url = API + path + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, data=json.dumps(body).encode("utf-8"), headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=600) as r:
        return r.read()


def _mora_spans(entry: dict, vocals: np.ndarray, notes: list, clip: float):
    """每個假名的 (起, 訖)：第一個假名從該句第一個音開始，其餘對到原唱 onset（zh_voice 的方法）。"""
    f0, per = zv._crepe(vocals)
    t10 = np.arange(len(f0)) * 0.01
    voiced = per > 0.3
    ot, os_ = zv._onsets(vocals)
    lines = entry["lines"]
    spans, kana = [], []
    for i, line in enumerate(lines):
        end = lines[i + 1]["t"] if i + 1 < len(lines) else clip
        ns = [n for n in notes if line["t"] - 0.15 <= n[0] < end - 0.15]
        if not ns:
            continue
        k = len(line["ja_sing"])
        s0, e0 = ns[0][0], max(n[0] + n[1] for n in ns)
        mask = (ot >= s0 - 0.08) & (ot < e0 - 0.1)
        cands, strg = list(ot[mask]), list(os_[mask])
        if not cands or abs(cands[0] - s0) > 0.08:
            cands, strg = [s0] + cands, [1.0] + strg
        if len(cands) < k:
            extra = [n[0] for n in ns if all(abs(n[0] - c) > 0.05 for c in cands)]
            merged = sorted(zip(cands + extra, strg + [0.0] * len(extra)))
            cands, strg = [m[0] for m in merged], [m[1] for m in merged]
        if len(cands) < k:
            cands, strg = [s0 + j * (e0 - s0) / k for j in range(k)], [0.0] * k
        spans += zv._spans(zv._choose(np.array(cands), np.array(strg), k, s0, e0), e0, t10, voiced)
        kana += list(line["ja_sing"])
    return spans, kana, f0, per


def sing(entry: dict, vocals: np.ndarray, notes: list, clip: float, decode) -> np.ndarray:
    """日文歌聲（單聲道 44.1kHz）。decode＝build_pack.load_audio。"""
    ensure_engine()
    _, style, target = ROLES[entry.get("voice", "female")]
    spans, kana, f0, per = _mora_spans(entry, vocals, notes, clip)
    t10 = np.arange(len(f0)) * 0.01
    voiced = per > 0.3
    midi10 = 69 + 12 * np.log2(np.maximum(f0, 1) / 440)
    shift = 12 * round((target - float(np.median(midi10[voiced]))) / 12)
    gm = np.interp(t10, t10[voiced], midi10[voiced]) if voiced.any() else np.full(len(t10), 60.0)

    def fr(t):
        return int(round(t * FPS))

    score = [{"key": None, "frame_length": max(1, fr(spans[0][0])), "lyric": ""}]  # 第一個音符必須是休止
    for i, ((s, e), k) in enumerate(zip(spans, kana)):
        m = (t10 >= s) & (t10 < e)
        key = int(round(np.median(gm[m]) + shift)) if m.any() else 60
        nxt = spans[i + 1][0] if i + 1 < len(spans) else clip
        if nxt - e > 0.03:
            score.append({"key": key, "frame_length": max(1, fr(e) - fr(s)), "lyric": k})
            score.append({"key": None, "frame_length": max(1, fr(nxt) - fr(e)), "lyric": ""})
        else:
            score.append({"key": key, "frame_length": max(1, fr(nxt) - fr(s)), "lyric": k})
    q = json.loads(_post("/sing_frame_audio_query", {"speaker": TEACHER}, {"notes": score}))
    tf = np.arange(len(q["f0"])) / FPS
    curve = 440 * 2 ** ((np.interp(tf, t10, gm) + shift - 69) / 12)
    q["f0"] = [float(c) if f > 0 else 0.0 for f, c in zip(q["f0"], curve)]
    wav = _post("/frame_synthesis", {"speaker": style}, q)
    tmp = HERE / "cache" / "tmp_voicevox.wav"
    tmp.parent.mkdir(parents=True, exist_ok=True)
    tmp.write_bytes(wav)
    y = decode(tmp).mean(axis=1)  # decode 會重新取樣成 44.1kHz
    tmp.unlink(missing_ok=True)
    n = int(clip * SR)
    return np.pad(y, (0, max(0, n - len(y))))[:n].astype(np.float32)
