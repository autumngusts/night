"""快門之後（shutter）的 UI 字串（zh / ja / en）。

由 i18n_data.py 合併進 STRINGS；generate.py 依 sh_ 前綴輸出成 static/i18n/shutter.js。
劇情與遊戲內文字放在 static_src/shutter_*.js（目前只有繁中），這裡只放頁面標題與首頁卡片。
"""

from __future__ import annotations

SHUTTER_ZH: dict[str, str] = {"sh_title": "快門之後"}
SHUTTER_JA: dict[str, str] = {"sh_title": "シャッターのあとで"}
SHUTTER_EN: dict[str, str] = {"sh_title": "After the Shutter"}

SHUTTER_PROJECT: dict[str, dict[str, str]] = {
    "zh": {"project_shutter_name": "快門之後", "project_shutter_desc": "【18 禁】出版社委託的寫真集《十二月光》：60 天拍完 12 位女性。取景、打光、指導對話、抓住 0.5 秒的最佳瞬間，底片只有 12 張；接雜誌、Cosplay、婚紗、私人寫真與旅行外拍，買鏡頭和燈具，夜晚推進她們的故事。最後選誰當封面，就是你的結局"},
    "ja": {"project_shutter_name": "シャッターのあとで", "project_shutter_desc": "【18 禁】出版社から依頼された写真集『十二月光』。60 日で 12 人の女性を撮る。フレーミング、ライティング、声かけ、0.5 秒のベストショット、フィルムは 12 枚。雑誌・コスプレ・ウェディング・プライベート撮影や旅ロケ、機材購入、夜は彼女たちの物語。表紙に選んだ人が結末になる（本文は繁体字中国語）"},
    "en": {"project_shutter_name": "After the Shutter", "project_shutter_desc": "[18+] A publisher's photobook commission: 12 women in 60 days. Frame, light, direct and catch the 0.5-second perfect moment on a 12-shot roll; take magazine, cosplay, wedding, private and travel shoots, buy gear, and follow their stories at night. Whoever you choose for the cover is your ending (Traditional Chinese text)"},
}
