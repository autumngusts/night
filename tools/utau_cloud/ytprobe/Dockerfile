FROM python:3.12-slim
# yt-dlp[default] 含 yt-dlp-ejs（YouTube 的 JS 驗證腳本）；deno 是 yt-dlp 預設使用的 JS runtime
RUN pip install --no-cache-dir "yt-dlp[default]==2026.8.19" deno \
 && yt-dlp --version && deno --version
WORKDIR /app
COPY main.py .
CMD ["python", "main.py"]
