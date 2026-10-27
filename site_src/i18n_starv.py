"""明星經紀 starV（starv）的 UI 字串（zh / ja / en）。

每列是 (鍵, 繁體中文, 日文)，en 沿用日文（規格 §15.4）。由 i18n_data.py 合併進 STRINGS，
generate.py 依前綴 sv_ 輸出成 static/i18n/starv.js。
藝人名、作品名、方向名、事件文字等遊戲資料在 static_src/starv_data.js（{ zh, ja }）。
首頁卡片的 project_starv_* 不以 sv_ 開頭，留在共用 i18n.js。
"""

from __future__ import annotations

_ROWS: list[tuple[str, str, str]] = [
    # ---- 外框 ----
    ("sv_title", "明星經紀 starV", "芸能事務所 starV"),
    ("sv_company_default", "無名經紀公司", "名もなき事務所"),
    ("sv_level", "Lv{lv}", "Lv{lv}"),
    ("sv_rep_tip", "聲望 {rep} / 下一級 {next}", "評判 {rep} / 次のレベル {next}"),
    ("sv_money", "{n} 元", "{n} 円"),
    ("sv_tickets", "星探券 {n}", "スカウト券 {n}"),
    ("sv_date", "第 {y} 年 {m} 月 {d} 日", "{y}年目 {m}月{d}日"),
    ("sv_welcome_intro", "你是剛成立的經紀公司社長。用星探券與試鏡招募新人，安排上課、訓練與工作，把他們培養成閃耀的明星。遊戲時間會一直流動：現實 1 分鐘＝遊戲 1 天，關掉頁面也會繼續（最多補 8 小時）。", "あなたは設立したばかりの芸能事務所の社長。スカウト券とオーディションで新人を集め、レッスン・トレーニング・仕事を組んで、輝くスターに育てよう。ゲーム内の時間は流れ続ける：現実の 1 分＝ゲームの 1 日。ページを閉じても進む（最大 8 時間分）。"),
    ("sv_welcome_name", "公司名稱", "事務所名"),
    ("sv_welcome_name_ph", "例如：星光經紀", "例：スターライト・プロ"),
    ("sv_welcome_start", "開業！", "開業する！"),
    ("sv_toast_level_up", "公司升到 Lv{lv}！", "事務所が Lv{lv} に！"),
    ("sv_close", "關閉", "閉じる"),
    ("sv_cancel", "取消", "キャンセル"),
    ("sv_confirm", "確定", "決定"),
    ("sv_none", "無", "なし"),
    ("sv_days", "{n} 天", "{n}日"),
    # ---- 錯誤（Core 回傳的錯誤碼） ----
    ("sv_err_money", "資金不足", "資金が足りません"),
    ("sv_err_tickets", "星探券不足", "スカウト券が足りません"),
    ("sv_err_daily", "今天的試鏡次數已經用完了", "本日のオーディション回数の上限です"),
    ("sv_err_count", "操作無效", "無効な操作です"),
    ("sv_err_pool", "操作無效", "無効な操作です"),
    ("sv_err_kind", "操作無效", "無効な操作です"),
    ("sv_err_policy", "操作無效", "無効な操作です"),
    ("sv_err_busy", "行程中，無法安排", "スケジュール中です"),
    ("sv_err_noArtist", "找不到這位藝人", "タレントが見つかりません"),
    ("sv_err_noCourse", "找不到這堂課", "レッスンが見つかりません"),
    ("sv_err_facility", "需要對應的設施或公司等級", "対応する設備か事務所レベルが必要です"),
    ("sv_err_noJob", "這件工作已經不在看板上了", "この仕事はもうボードにありません"),
    ("sv_err_slots", "人數不符", "人数が合いません"),
    ("sv_err_fame", "人氣不足", "人気が足りません"),
    ("sv_err_prof", "熟練度不足", "熟練度が足りません"),
    ("sv_err_full", "宿舍已滿", "寮が満室です"),
    ("sv_err_noEntry", "找不到這位候補", "候補が見つかりません"),
    ("sv_err_size", "組合需要 2～5 人", "ユニットは 2～5 人です"),
    ("sv_err_taken", "有人已經在別的組合裡", "別のユニットに所属しているメンバーがいます"),
    ("sv_err_dir", "方向無效", "無効な方向です"),
    ("sv_err_sub", "副方向最多 2 個，不能重複，也不能和主方向相同", "サブは 2 つまで・重複不可・メインと同じものは不可"),
    ("sv_err_import", "無法讀取這個存檔字串", "このセーブ文字列は読み込めません"),
    # ---- 招募 ----
    ("sv_tab_gacha", "招募", "スカウト"),
    ("sv_gacha_pickup", "本月 PICKUP", "今月の PICKUP"),
    ("sv_gacha_pity", "距離 SSR 保底還有 {n} 抽", "SSR 確定まであと {n} 回"),
    ("sv_pool_money", "一般試鏡", "一般オーディション"),
    ("sv_pool_money_desc", "用公司資金舉辦公開試鏡，大多是 R 新人。", "事務所の資金で公開オーディション。ほとんどは R の新人。"),
    ("sv_pool_ticket", "星探券招募", "スカウト券"),
    ("sv_pool_ticket_desc", "星探親自出馬，稀有新人的機率大幅提升。", "スカウトが直接動く。レアな新人の確率が大幅アップ。"),
    ("sv_pool_rates", "SR {sr}%・SSR {ssr}%", "SR {sr}%・SSR {ssr}%"),
    ("sv_pull_1", "單抽 {cost}", "1回 {cost}"),
    ("sv_pull_10", "十連 {cost}", "10連 {cost}"),
    ("sv_pull_10_note", "十連保證一位 SR 以上", "10連は SR 以上が 1 人確定"),
    ("sv_daily_left", "今天還能試鏡 {n} 次", "本日あと {n} 回"),
    ("sv_reveal_title", "招募結果", "スカウト結果"),
    ("sv_reveal_skip", "全部翻開", "すべてめくる"),
    ("sv_reveal_done", "完成", "OK"),
    ("sv_res_lb", "限界突破 {n}", "限界突破 {n}"),
    ("sv_res_tickets", "重複 → 星探券 +{n}", "重複 → スカウト券 +{n}"),
    ("sv_res_wait", "宿舍已滿 → 候補名單", "寮が満室 → 候補リスト"),
    ("sv_res_lost", "候補也滿了，錯過了…", "候補も満員で見送り…"),
    ("sv_spot_skill", "專屬技能", "固有スキル"),
    ("sv_age", "{n} 歲", "{n}歳"),
    ("sv_wait_title", "候補名單", "候補リスト"),
    ("sv_wait_hint", "宿舍滿了的新人會在這裡等 30 天。解約其他藝人或升級宿舍就能讓他們入社。", "寮が満室のときの新人はここで 30 日待つ。契約解除や寮の拡張で入所できる。"),
    ("sv_wait_empty", "目前沒有候補", "候補はいません"),
    ("sv_wait_left", "還剩 {n} 天", "あと {n} 日"),
    ("sv_wait_accept", "入社", "入所"),
    # ==== 之後的 task 在這行之前追加字串 ====
]

STARV_ZH: dict[str, str] = {k: zh for k, zh, _ in _ROWS}
STARV_JA: dict[str, str] = {k: ja for k, _, ja in _ROWS}
STARV_EN: dict[str, str] = dict(STARV_JA)

STARV_ZH.update({
    "project_starv_name": "明星經紀 starV",
    "project_starv_desc": "放置型經紀公司經營：抽卡招募藝人，安排上課、訓練與工作，培養 16 種方向的明星",
})
STARV_JA.update({
    "project_starv_name": "芸能事務所 starV",
    "project_starv_desc": "放置型の芸能事務所経営。ガチャでタレントをスカウトし、レッスンと仕事を組んで 16 の分野のスターを育てる",
})
STARV_EN.update({
    "project_starv_name": "starV",
    "project_starv_desc": "Idle talent-agency sim: scout artists from a gacha, schedule lessons and jobs, and raise stars across 16 career paths",
})
