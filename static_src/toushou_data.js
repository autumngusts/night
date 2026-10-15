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

  window.PriTestToushouData = {
    C: C,
    text: text,
    registerCategory: registerCategory,
    CATEGORIES: CATEGORIES,
    TARGETS: TARGETS,
    NEWS_CARDS: NEWS_CARDS,
    WIND_COMPOSITION: WIND_COMPOSITION,
    MISSIONS: MISSIONS,
    HAND_SIZE: 5,
    START_PRICE: 100
  };
})();
