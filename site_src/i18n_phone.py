"""手機裡的她們（phone）的 UI 字串（zh / ja / en）。由 i18n_data.py 合併；generate.py 依 ph_ 前綴輸出成 static/i18n/phone.js。"""

from __future__ import annotations

PHONE_ZH: dict[str, str] = {"ph_title": "手機裡的她們"}
PHONE_JA: dict[str, str] = {"ph_title": "スマホの中の彼女たち"}
PHONE_EN: dict[str, str] = {"ph_title": "Girls in My Phone"}

PHONE_PROJECT: dict[str, dict[str, str]] = {
    "zh": {"project_phone_name": "手機裡的她們", "project_phone_desc": "【18 禁】整個遊戲都在一支手機裡：21 天、8 個她，每個時段只能回 3 則訊息。語氣、貼圖、秒回或已讀不回，還有「你還記得我最喜歡吃什麼嗎？」——答成別人的就完了。限動、交友 App、約會、深夜視訊，還有去她家的夜晚"},
    "ja": {"project_phone_name": "スマホの中の彼女たち", "project_phone_desc": "【18 禁】ゲームのすべてがスマホの中。21 日間、8 人の彼女、各時間帯で返信できるのは 3 通だけ。口調、スタンプ、即レスか既読スルーか、そして「私の好きな食べ物、覚えてる？」。ストーリー、マッチングアプリ、デート、深夜のビデオ通話、彼女の部屋で過ごす夜（本文は繁体字中国語）"},
    "en": {"project_phone_name": "Girls in My Phone", "project_phone_desc": "[18+] The whole game lives in a phone: 21 days, 8 women, only 3 replies per time slot. Tone, stickers, instant replies or left on read, and the dreaded question of whether you remember her favorite food. Stories, a dating app, dates, late-night video calls and nights at her place (Traditional Chinese text)"},
}
