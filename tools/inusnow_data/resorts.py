"""イヌスノー第一批雪場的設定（docs/inusnow_design.md §2.2）。

bbox＝(南, 西, 北, 東)，涵蓋雪場的主要雪道即可；建置工具會再依實際雪道範圍外擴 150 m 決定格網。
gs＝大曲道雪道的 OSM 名稱候選（部分符合即可，依序嘗試）；都找不到時依 §2.2 的條件自動選。
notes＝依雪道指南確認事實後的手動修正說明（設計 §2.4：只確認事實，不描圖）。
"""

from __future__ import annotations

RESORTS: list[dict] = [
    {
        "id": "happo",
        "name": {"ja": "白馬八方尾根", "zh": "白馬八方尾根", "en": "Hakuba Happo-one"},
        "pref": {"ja": "長野県", "zh": "長野縣", "en": "Nagano"},
        "bbox": (36.680, 137.770, 36.720, 137.850),
        "gs": ["オリンピックコースI", "オリンピックコースII", "オリンピック", "リーゼン"],
        "notes": "",
    },
    {
        "id": "yakebitai",
        "name": {"ja": "志賀高原 焼額山", "zh": "志賀高原 燒額山", "en": "Shiga Kogen Yakebitai"},
        "pref": {"ja": "長野県", "zh": "長野縣", "en": "Nagano"},
        "bbox": (36.745, 138.490, 36.785, 138.535),
        "gs": ["第2", "第１", "第1"],
        "notes": "",
    },
    {
        "id": "teine",
        "name": {"ja": "サッポロテイネ", "zh": "札幌手稻", "en": "Sapporo Teine"},
        "pref": {"ja": "北海道", "zh": "北海道", "en": "Hokkaido"},
        "bbox": (43.060, 141.170, 43.105, 141.225),
        "gs": ["大回転", "オリンピア", "北壁"],
        "notes": "",
    },
    {
        "id": "hirafu",
        "name": {"ja": "ニセコ グラン・ヒラフ", "zh": "二世古 Grand Hirafu", "en": "Niseko Grand Hirafu"},
        "pref": {"ja": "北海道", "zh": "北海道", "en": "Hokkaido"},
        "bbox": (42.845, 140.650, 42.885, 140.710),
        "gs": ["センター", "ダイナミック", "ジャンボ"],
        "notes": "",
    },
    {
        "id": "zao",
        "name": {"ja": "蔵王温泉", "zh": "藏王溫泉", "en": "Zao Onsen"},
        "pref": {"ja": "山形県", "zh": "山形縣", "en": "Yamagata"},
        "bbox": (38.130, 140.380, 38.180, 140.460),
        "gs": ["横倉", "パラダイス", "ザンゲ", "樹氷原"],
        "notes": "",
    },
    {
        "id": "nozawa",
        "name": {"ja": "野沢温泉", "zh": "野澤溫泉", "en": "Nozawa Onsen"},
        "pref": {"ja": "長野県", "zh": "長野縣", "en": "Nagano"},
        "bbox": (36.900, 138.410, 36.940, 138.480),
        "gs": ["チャンピオン", "シュナイダー", "スカイライン"],
        "notes": "",
    },
    {
        "id": "naeba",
        "name": {"ja": "苗場", "zh": "苗場", "en": "Naeba"},
        "pref": {"ja": "新潟県", "zh": "新潟縣", "en": "Niigata"},
        "bbox": (36.770, 138.730, 36.810, 138.800),
        "gs": ["男子リーゼン", "女子リーゼン", "リーゼン", "大斜面"],
        "notes": "",
    },
    {
        "id": "rusutsu",
        "name": {"ja": "ルスツ", "zh": "留壽都", "en": "Rusutsu"},
        "pref": {"ja": "北海道", "zh": "北海道", "en": "Hokkaido"},
        "bbox": (42.730, 140.870, 42.770, 140.930),
        "gs": ["ヘザー", "イゾラ", "ジュニア"],
        "notes": "",
    },
]

# OSM 資料不足時的替補（設計 Q1）
FALLBACKS: list[dict] = [
    {
        "id": "appi",
        "name": {"ja": "安比高原", "zh": "安比高原", "en": "Appi Kogen"},
        "pref": {"ja": "岩手県", "zh": "岩手縣", "en": "Iwate"},
        "bbox": (39.950, 140.920, 40.000, 141.000),
        "gs": ["ザイラー", "セカンド"],
        "notes": "",
    },
    {
        "id": "akakura",
        "name": {"ja": "妙高 赤倉温泉", "zh": "妙高 赤倉溫泉", "en": "Myoko Akakura Onsen"},
        "pref": {"ja": "新潟県", "zh": "新潟縣", "en": "Niigata"},
        "bbox": (36.870, 138.140, 36.910, 138.200),
        "gs": ["チャンピオン", "大斜面"],
        "notes": "",
    },
    {
        "id": "furano",
        "name": {"ja": "富良野", "zh": "富良野", "en": "Furano"},
        "pref": {"ja": "北海道", "zh": "北海道", "en": "Hokkaido"},
        "bbox": (43.300, 142.320, 43.350, 142.400),
        "gs": ["ダウンヒル", "チャンピオン", "ロマンス"],
        "notes": "",
    },
]
