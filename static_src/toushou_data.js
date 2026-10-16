// 東正小遊戲（toushou）的共用資料：通用消息牌、風向、任務卡，以及類別登錄函式。
// 各類別的標的與專屬消息牌放在 toushou_data_*.js，透過 registerCategory() 登錄。
// 這裡不放任何規則邏輯；規則在 toushou_core.js。
// 內容來源：docs/toushou_data_draft.md（2026-10-15 使用者審核通過）。
(function () {
  "use strict";

  function C(ja, zh) { return { ja: ja, zh: zh }; }

  // 依目前語言取文字：zh 用 zh，其他（ja/en）用 ja；缺值時互相 fallback。
  function text(obj, lang) {
    if (!obj) return "";
    if (typeof obj === "string") return obj;
    if (lang === "zh") return obj.zh || obj.ja || "";
    return obj.ja || obj.zh || "";
  }

  var CATEGORIES = [];
  var TARGETS = [];
  var NEWS_CARDS = [];

  function N(id, tone, ja, zh) { return { id: id, tone: tone, text: C(ja, zh), category: null }; }

  // 通用消息牌：任何類別的標的都能用（除非該類別在 excludeCommonCards 中排除）
  [
    N("g01", "up", "有名人が{target}を大絶賛", "名人公開大力推薦{target}"),
    N("g02", "up", "{target}がSNSで突然バズる", "{target}在社群上意外爆紅"),
    N("g03", "up", "海外メディアが{target}を大特集", "海外媒體大篇幅報導{target}"),
    N("g04", "down", "{target}は実は名ばかりだと暴露される", "有人爆料{target}其實名不符實"),
    N("g05", "down", "{target}のスキャンダルが発覚", "{target}被爆出醜聞"),
    N("g06", "down", "専門家が{target}は持ち上げられすぎだと批判", "專家公開批評{target}被過度吹捧"),
    N("g07", "down", "{target}のブームはもう終わったらしい", "{target}的熱潮據說已經退燒"),
    N("g08", "down", "{target}より優れた代替品が登場", "出現比{target}更好的替代品"),
    N("g09", "down", "ネットで{target}への長文の酷評が拡散", "網路上流傳{target}的負評長文"),
    N("g10", "neutral", "近く{target}について重大発表があるらしい", "據說近期將有關於{target}的重大宣布"),
    N("g11", "neutral", "大口投資家がひそかに{target}を売買しているらしい", "有大戶正在悄悄買賣{target}"),
    N("g12", "neutral", "{target}への専門家の評価が真っ二つ", "專家對{target}的評價兩極")
  ].forEach(function (card) { NEWS_CARDS.push(card); });

  // def = { id, name, role, excludeCommonCards?, targets: [{id,name,summary,tags,hooks}], newsCards: [{id,tone,text}] }
  function registerCategory(def) {
    CATEGORIES.push({
      id: def.id,
      name: def.name,
      role: def.role,
      excludeCommonCards: (def.excludeCommonCards || []).slice()
    });
    (def.targets || []).forEach(function (t) {
      TARGETS.push({ id: t.id, category: def.id, name: t.name, summary: t.summary, tags: t.tags, hooks: t.hooks });
    });
    (def.newsCards || []).forEach(function (n) {
      NEWS_CARDS.push({ id: n.id, tone: n.tone, text: n.text, category: def.id });
    });
  }

  var WIND_COMPOSITION = { up: 2, down: 2, neutral: 1 };

  function M(id, check, params, reward, ja, zh) {
    return { id: id, check: check, params: params, reward: reward, text: C(ja, zh) };
  }

  // params 中 category 為 null 時，發任務時由引擎從本局標的的類別中隨機指定。
  var MISSIONS = [
    M("m_first", "firstPlaceAtLeast", { count: 2 }, 300,
      "第1位（同率含む）を{count}回以上取る", "拿到第 1 名（含並列）{count} 次以上"),
    M("m_exact", "exactHit", { within: 5 }, 300,
      "予想価格と最終株価の差が{within}以内を1回以上", "至少一次預測價與最終股價誤差 ≤ {within}"),
    M("m_catrise", "categoryRiseAtLeast", { category: null, price: 150 }, 200,
      "「{category}」の銘柄の最終株価が{price}以上になる", "「{category}」類標的中有最終股價 ≥ {price}"),
    M("m_crash", "anyTargetCrash", { price: 40 }, 200,
      "いずれかの銘柄の最終株価が{price}以下になる", "任一標的最終股價 ≤ {price}"),
    M("m_rank2", "finalRank", { rank: 2 }, 300,
      "最終チップ（任務報酬を除く）で第{rank}位", "最終籌碼（不含任務獎勵）為第 {rank} 名"),
    M("m_allin", "allInOnce", { pct: 80 }, 300,
      "手持ちの{pct}%以上を賭けて利益を出す（1回以上）", "至少一次押注 ≥ 當時籌碼的 {pct}% 且獲利"),
    M("m_contra", "contrarian", {}, 300,
      "過半数が騰落の方向を外した銘柄で、自分は当てる（1回以上）", "至少一次：過半數人猜錯漲跌方向，而自己猜對"),
    M("m_swing", "ownNewsSwing", { abs: 30 }, 200,
      "自分の発表で株価が一度に{abs}以上動く", "自己釋放的消息讓股價一次變動 ≥ {abs}")
  ];

  // 黑天鵝事件卡（進階2）。group：delta／price／flow／settle／calm。{k} 於顯示時代入
  function SW(id, group, ja, zh, jaText, zhText) {
    return { id: id, group: group, name: C(ja, zh), text: C(jaText, zhText) };
  }
  var SWAN_CARDS = [
    SW("circuit", "delta", "サーキットブレーカー", "熔斷", "各発表の増減は −10〜+10 に制限", "每一則的加減分限制在 −10～＋10"),
    SW("hype", "delta", "テーマ株騒動", "題材炒作", "1件目の増減が2倍", "第 1 則的加減分 ×2"),
    SW("whale", "delta", "大口参入", "主力進場", "最後の発表の増減が2倍", "最後一則的加減分 ×2"),
    SW("exhausted", "delta", "材料出尽くし", "利多出盡", "最後の発表の増減の正負が逆転", "最後一則的加減分正負反轉"),
    SW("fomo", "delta", "個人投資家の熱狂", "散戶狂熱", "プラスの増減が1.5倍", "為正的加減分 ×1.5"),
    SW("panic", "delta", "パニック売り", "恐慌拋售", "マイナスの増減が1.5倍", "為負的加減分 ×1.5"),
    SW("lull", "delta", "閑散相場", "量縮盤整", "すべての増減が半分", "每一則的加減分減半"),
    SW("momentum", "delta", "モメンタム", "動能效應", "2件目以降、直前の増減の半分が上乗せ", "第 2 則起，再加上前一則加減分的一半"),
    SW("exright", "price", "権利落ち予告", "預告除權", "{k}件目の後、株価が100に戻る", "第 {k} 則之後，價格回到 100"),
    SW("shortcover", "price", "買い戻し", "空頭回補", "初めて60を割ったとき即 +20", "第一次跌破 60 時立刻 +20"),
    SW("gap", "price", "窓開け", "跳空開盤", "株価が −20〜+20 ランダムに動く", "價格隨機變動 −20～＋20"),
    SW("limit", "price", "値幅制限", "漲跌停板", "株価は開始価格 ±50 の範囲内", "價格限制在起始價 ±50 以內"),
    SW("rumor", "price", "デマ発覚", "謠言破滅", "最後に1件の発表がデマと判明し、その増減が取り消される", "最後隨機揭穿 1 則消息，扣回它的加減分"),
    SW("extra", "flow", "臨時株主総会", "股東臨時會", "最初の株主が最後にもう1件発表する", "第一位股東在最後再發一則"),
    SW("gag", "flow", "箝口令", "封口令", "1件目は手札をそのまま出すのみ（改変・自作不可）", "第 1 則只能直接打出手牌（不能改寫或自訂）"),
    SW("reverse", "flow", "逆順発言", "逆序發言", "賭け後のチップが少ない順に発表", "依下注後剩餘籌碼由少到多發言"),
    SW("cancel", "settle", "取引取消", "交易取消", "最終株価が開始価格 ±5 以内なら全員の賭け金を返却", "最終價與起始價相差 5 以內則全員退回押注"),
    SW("upset", "settle", "大番狂わせ", "爆冷門", "誤差が大きい順に配当", "依誤差由大到小分配彩池"),
    SW("bailout", "settle", "救済資金", "紓困加碼", "銀行が彩池の50%を上乗せ", "銀行加碼彩池 50%"),
    SW("calm", "calm", "平穏", "平靜", "何も起きない", "沒有事件")
  ];
  var SWAN_COMPOSITION = { calm: 7 }; // 未列出的事件各 1 張

  window.PriTestToushouData = {
    C: C,
    text: text,
    registerCategory: registerCategory,
    CATEGORIES: CATEGORIES,
    TARGETS: TARGETS,
    NEWS_CARDS: NEWS_CARDS,
    WIND_COMPOSITION: WIND_COMPOSITION,
    SWAN_CARDS: SWAN_CARDS,
    SWAN_COMPOSITION: SWAN_COMPOSITION,
    MISSIONS: MISSIONS,
    HAND_SIZE: 5,
    START_PRICE: 100
  };
})();
