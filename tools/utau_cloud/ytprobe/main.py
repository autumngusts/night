"""雲端抓取 YouTube 音訊的可行性實驗（2026-10-18）。

只回答一個問題：Cloud Run（資料中心 IP）上的 yt-dlp 抓不抓得到 YouTube 音訊。
下載完立即刪除，不保存任何音檔。

雲端：POST /probe  {"urls": [...]}  → 每首的結果（需要 Cloud Run IAM 身分，不公開）
本機：python main.py urls.txt        → 同樣的檢查，當作對照組
"""

from __future__ import annotations

import json
import os
import shutil
import socket
import sys
import tempfile
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer

import yt_dlp

# 與 build_pack.fetch_source 相同的重試順序：預設用戶端失敗就換 ios → web_safari → tv
CLIENTS = [None, ["ios"], ["web_safari"], ["tv"]]


def probe_one(url: str) -> dict:
    t0 = time.time()
    tries = []
    for client in CLIENTS:
        tmp = tempfile.mkdtemp(prefix="ytprobe-")
        opts = {
            "format": "bestaudio/best",
            "outtmpl": os.path.join(tmp, "a.%(ext)s"),
            "noplaylist": True,
            "quiet": True,
            "no_warnings": True,
            "noprogress": True,
        }
        if client:
            opts["extractor_args"] = {"youtube": {"player_client": client}}
        name = client[0] if client else "default"
        try:
            with yt_dlp.YoutubeDL(opts) as ydl:
                info = ydl.extract_info(url, download=True)
                path = ydl.prepare_filename(info)
                size = os.path.getsize(path) if os.path.exists(path) else 0
            tries.append({"client": name, "ok": True})
            return {"url": url, "ok": size > 0, "client": name, "bytes": size, "ext": info.get("ext"),
                    "duration": info.get("duration"), "sec": round(time.time() - t0, 1), "tries": tries}
        except Exception as exc:  # noqa: BLE001 — 實驗要記錄所有失敗原因
            tries.append({"client": name, "ok": False, "error": str(exc)[:300]})
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
    return {"url": url, "ok": False, "sec": round(time.time() - t0, 1), "tries": tries}


def environment() -> dict:
    ip = None
    try:
        ip = urllib.request.urlopen("https://api.ipify.org", timeout=5).read().decode()
    except Exception:  # noqa: BLE001
        pass
    return {"yt_dlp": yt_dlp.version.__version__, "deno": shutil.which("deno"), "host": socket.gethostname(), "egress_ip": ip}


def probe(urls: list[str]) -> dict:
    results = [probe_one(u) for u in urls]
    ok = sum(1 for r in results if r["ok"])
    return {"env": environment(), "ok": ok, "total": len(results), "results": results}


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):  # noqa: N802
        self._send(200, {"env": environment()} if self.path == "/env" else {"ok": True})

    def do_POST(self):  # noqa: N802
        if self.path != "/probe":
            self._send(404, {"error": "not found"})
            return
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
        urls = [u for u in body.get("urls", []) if isinstance(u, str)][:30]
        self._send(200, probe(urls))

    def _send(self, code: int, obj: dict) -> None:
        data = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


if __name__ == "__main__":
    if len(sys.argv) > 1:
        with open(sys.argv[1], encoding="utf-8") as f:
            urls = [line.strip() for line in f if line.strip()]
        print(json.dumps(probe(urls), ensure_ascii=False, indent=1))
    else:
        HTTPServer(("", int(os.environ.get("PORT", "8080"))), Handler).serve_forever()
