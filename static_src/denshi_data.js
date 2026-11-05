// 電子守衛（denshi）：靜態資料。砲塔、敵人、十大地圖（主題＋特殊機制）、地基方塊（多格骨牌）與特殊格。
// 規則邏輯在 denshi_core.js；這裡只放數值與雙語文字（C(zh, ja)）。2026-11-05 依使用者需求新增。
(function () {
  "use strict";

  function C(zh, ja) { return { zh: zh, ja: ja }; }
  function L(o) {
    if (!o) return "";
    if (typeof o === "string") return o;
    var lang = window.I18N && window.I18N.getLang ? window.I18N.getLang() : "zh";
    return o[lang] || o.zh || o.ja || "";
  }

  // ---------------- 砲塔 ----------------
  // cat：base＝原始砲塔（Lv3 後可「電子強化」成 evo 兩選一）、evo＝強化型、elec＝電子學獨立砲塔
  // kind：bullet（追蹤彈）／shell（範圍砲彈）／rail（直線貫穿）／beam（持續光束）／chain（連鎖閃電）／
  //       pulse（範圍脈衝）／spray（範圍減速）／aura（常駐力場）／freeze（定時凍結）／support（加成鄰格）／eco（經濟）
  // dtype：kin＝動能（會被裝甲減免）、en＝能量（打護盾較有效）
  // lv[i]：c＝升到這一級的費用（第 0 級的費用在 cost）
  var TOWERS = {
    gun: {
      cat: "base", icon: "🔫", color: 0x9fb4c8, cost: 50, kind: "bullet", dtype: "kin", air: true,
      name: C("脈衝機槍", "パルス機銃"),
      desc: C("便宜、射速快的單體砲塔。對空也有效。", "安価で連射が速い単体攻撃。対空可。"),
      lv: [{ dmg: 6, rate: 3, range: 2.6 }, { c: 40, dmg: 10, rate: 3.4, range: 2.6 }, { c: 70, dmg: 15, rate: 4, range: 2.9 }],
      evo: ["transistor", "coilgun"]
    },
    cannon: {
      cat: "base", icon: "💣", color: 0xc07a3a, cost: 80, kind: "shell", dtype: "kin", air: false,
      name: C("電漿迫擊砲", "プラズマ迫撃砲"),
      desc: C("範圍傷害，擅長清成群的小怪。打不到飛行單位。", "範囲攻撃で群れに強い。飛行には当たらない。"),
      lv: [{ dmg: 22, rate: 0.7, range: 3, splash: 0.9 }, { c: 60, dmg: 36, rate: 0.72, range: 3, splash: 1 }, { c: 100, dmg: 55, rate: 0.75, range: 3.2, splash: 1.1 }],
      evo: ["capacitor", "emp"]
    },
    sniper: {
      cat: "base", icon: "🎯", color: 0x7c8a9a, cost: 100, kind: "bullet", dtype: "kin", air: true, fast: true,
      name: C("磁軌狙擊", "レール狙撃"),
      desc: C("超長射程、單發高傷害，適合打重甲與首領。", "超長射程・高威力の単発。重装甲とボス向け。"),
      lv: [{ dmg: 60, rate: 0.4, range: 5.5 }, { c: 80, dmg: 110, rate: 0.42, range: 6 }, { c: 130, dmg: 180, rate: 0.45, range: 6.5 }],
      evo: ["laser", "accel"]
    },
    frost: {
      cat: "base", icon: "❄️", color: 0x8fd8ff, cost: 70, kind: "spray", dtype: "en", air: true,
      name: C("冷媒噴霧", "冷媒スプレー"),
      desc: C("噴灑冷媒讓範圍內的敵人減速。", "冷媒を噴射して範囲内の敵を減速。"),
      lv: [{ dmg: 2, rate: 1.2, range: 2.4, splash: 0.7, slow: 0.35, slowT: 1.5 }, { c: 50, dmg: 4, rate: 1.2, range: 2.5, splash: 0.8, slow: 0.45, slowT: 1.6 }, { c: 80, dmg: 7, rate: 1.3, range: 2.7, splash: 0.9, slow: 0.55, slowT: 1.8 }],
      evo: ["faraday", "supercond"]
    },

    // ---- 電子強化（由原始砲塔 Lv3 進化）----
    transistor: {
      cat: "evo", from: "gun", icon: "🔺", color: 0x2b2b30, cost: 150, kind: "bullet", dtype: "kin", air: true,
      name: C("電晶體放大器", "トランジスタ増幅器"),
      desc: C("訊號放大：連續打同一個目標，每發傷害 +10%（最多 +200%）。換目標就歸零。", "信号増幅：同じ目標に撃ち続けると 1 発ごとに威力 +10%（最大 +200%）。"),
      lv: [{ dmg: 16, rate: 5, range: 3, ramp: 0.1, rampMax: 2 }, { c: 160, dmg: 24, rate: 5.5, range: 3.2, ramp: 0.12, rampMax: 2.5 }]
    },
    coilgun: {
      cat: "evo", from: "gun", icon: "🧲", color: 0xc87533, cost: 160, kind: "rail", dtype: "kin", air: true,
      name: C("電磁線圈槍", "コイルガン"),
      desc: C("線圈依序通電加速彈丸，直線貫穿最多 4 個敵人。", "コイルで弾丸を加速、直線上の敵を最大 4 体貫通。"),
      lv: [{ dmg: 30, rate: 1.8, range: 3.6, pierce: 4 }, { c: 170, dmg: 48, rate: 2, range: 3.9, pierce: 6 }]
    },
    capacitor: {
      cat: "evo", from: "cannon", icon: "🔋", color: 0x2d6fd6, cost: 180, kind: "shell", dtype: "en", air: false,
      name: C("電容放電砲", "コンデンサ放電砲"),
      desc: C("充飽電後一口氣放電：大範圍傷害並讓敵人短暫麻痺。", "満充電で一気に放電：広範囲ダメージ＋短時間マヒ。"),
      lv: [{ dmg: 90, rate: 0.45, range: 3.3, splash: 1.6, stun: 0.6 }, { c: 200, dmg: 140, rate: 0.48, range: 3.5, splash: 1.8, stun: 0.8 }]
    },
    emp: {
      cat: "evo", from: "cannon", icon: "📡", color: 0x7ad0ff, cost: 170, kind: "shell", dtype: "en", air: true,
      name: C("EMP 產生器", "EMP 発生器"),
      desc: C("電磁脈衝：對護盾 ×4 傷害、減速，並讓修復節點停擺。對空有效。", "電磁パルス：シールドに 4 倍、減速、修復ノード停止。対空可。"),
      lv: [{ dmg: 40, rate: 0.8, range: 3.2, splash: 1.5, shieldMul: 4, slow: 0.3, slowT: 1 }, { c: 180, dmg: 65, rate: 0.85, range: 3.4, splash: 1.7, shieldMul: 5, slow: 0.35, slowT: 1.2 }]
    },
    laser: {
      cat: "evo", from: "sniper", icon: "🔴", color: 0xff3344, cost: 200, kind: "beam", dtype: "en", air: true,
      name: C("雷射二極體", "レーザーダイオード"),
      desc: C("持續光束：照同一目標越久越燙，3 秒後傷害 ×4。", "持続ビーム：同じ目標を照射し続けると 3 秒で威力 4 倍。"),
      lv: [{ dmg: 40, rate: 1, range: 5, ramp: 1, rampMax: 3 }, { c: 220, dmg: 65, rate: 1, range: 5.5, ramp: 1.2, rampMax: 3.5 }]
    },
    accel: {
      cat: "evo", from: "sniper", icon: "🌀", color: 0xa070ff, cost: 220, kind: "rail", dtype: "en", air: true,
      name: C("粒子加速器", "粒子加速器"),
      desc: C("把粒子加速到接近光速，直線貫穿整條射程上的所有敵人。", "粒子を光速近くまで加速、射線上の敵をすべて貫通。"),
      lv: [{ dmg: 320, rate: 0.3, range: 7, pierce: 99 }, { c: 260, dmg: 520, rate: 0.32, range: 7.5, pierce: 99 }]
    },
    faraday: {
      cat: "evo", from: "frost", icon: "🕸️", color: 0xb0bccc, cost: 160, kind: "aura", dtype: "en", air: true,
      name: C("法拉第籠", "ファラデーケージ"),
      desc: C("常駐力場：範圍內敵人減速 50%、護盾每秒流失，隱形木馬現形。", "常時フィールド：範囲内を 50% 減速、シールド吸収、トロイを可視化。"),
      lv: [{ dmg: 0, rate: 1, range: 2.6, slow: 0.5, drain: 15 }, { c: 160, dmg: 0, rate: 1, range: 3.2, slow: 0.6, drain: 30 }]
    },
    supercond: {
      cat: "evo", from: "frost", icon: "🧊", color: 0xd6f4ff, cost: 180, kind: "freeze", dtype: "en", air: true,
      name: C("超導冷凍", "超伝導フリーザー"),
      desc: C("每隔一段時間把範圍內最多 3 個敵人完全凍住。", "一定間隔で範囲内の敵を最大 3 体完全に凍結。"),
      lv: [{ dmg: 30, rate: 0.34, range: 2.8, freezeN: 3, freezeT: 1.2 }, { c: 180, dmg: 55, rate: 0.36, range: 3.1, freezeN: 5, freezeT: 1.8 }]
    },

    // ---- 電子學獨立砲塔 ----
    tesla: {
      cat: "elec", icon: "⚡", color: 0xd08a4a, cost: 120, kind: "chain", dtype: "en", air: true,
      name: C("特斯拉線圈", "テスラコイル"),
      desc: C("高壓連鎖閃電，在敵人之間跳躍。", "高電圧の連鎖雷が敵の間を跳ねる。"),
      lv: [{ dmg: 18, rate: 1.1, range: 2.6, chain: 3 }, { c: 90, dmg: 30, rate: 1.15, range: 2.8, chain: 4 }, { c: 140, dmg: 46, rate: 1.2, range: 3, chain: 6 }]
    },
    osc: {
      cat: "elec", icon: "〰️", color: 0xd8dde6, cost: 110, kind: "pulse", dtype: "en", air: true,
      name: C("石英振盪器", "水晶発振器"),
      desc: C("固定頻率發出脈衝，打到範圍內所有敵人（含隱形）。", "一定周期でパルスを放ち、範囲内の全敵（ステルス含む）に命中。"),
      lv: [{ dmg: 14, rate: 0.6, range: 2, reveal: 1 }, { c: 90, dmg: 24, rate: 0.65, range: 2.2, reveal: 1 }, { c: 130, dmg: 38, rate: 0.7, range: 2.4, reveal: 1 }]
    },
    transformer: {
      cat: "elec", icon: "🔌", color: 0x5a6470, cost: 90, kind: "support", dtype: "en", air: false,
      name: C("變壓器", "変圧器"),
      desc: C("升壓供電：周圍 8 格的砲塔傷害提升。", "昇圧給電：周囲 8 マスの砲塔の威力アップ。"),
      lv: [{ buff: 0.2 }, { c: 80, buff: 0.3 }, { c: 120, buff: 0.4, rateBuff: 0.1 }]
    },
    relay: {
      cat: "elec", icon: "📶", color: 0x9aa7b5, cost: 80, kind: "support", dtype: "en", air: false,
      name: C("訊號中繼器", "信号リレー"),
      desc: C("周圍 8 格的砲塔射程增加；Lv3 讓周圍砲塔看得見隱形敵人。", "周囲 8 マスの射程アップ。Lv3 で周囲がステルスを視認。"),
      lv: [{ rbuff: 0.6 }, { c: 70, rbuff: 0.9 }, { c: 110, rbuff: 1.2, see: 1 }]
    },
    solar: {
      cat: "elec", icon: "☀️", color: 0x2c4f9a, cost: 100, kind: "eco", dtype: "en", air: false,
      name: C("太陽能板", "ソーラーパネル"),
      desc: C("不攻擊。每波結束時產生額外資金。", "攻撃しない。ウェーブ終了ごとに追加資金。"),
      lv: [{ income: 14 }, { c: 90, income: 26 }, { c: 130, income: 40 }]
    }
  };
  var BUILD_ORDER = ["gun", "cannon", "sniper", "frost", "tesla", "osc", "transformer", "relay", "solar"];

  // ---------------- 敵人 ----------------
  // hp／spd（格／秒）／armor（動能減免）／shield（先吸收傷害）／bounty（擊殺資金）／leak（到核心扣的耐久）
  var ENEMIES = {
    bit: { hp: 30, spd: 1.1, bounty: 4, cost: 1, from: 1, color: 0x4cff7a, name: C("位元蟲", "ビットバグ"), desc: C("最基本的錯誤。數量多。", "基本的なバグ。数が多い。") },
    packet: { hp: 20, spd: 2, bounty: 4, cost: 1, from: 2, color: 0x35e0ff, name: C("封包洪流", "パケット"), desc: C("跑得很快的資料封包。", "高速で流れるデータパケット。") },
    drone: { hp: 45, spd: 1.3, bounty: 7, cost: 2, from: 4, fly: true, color: 0xffd23c, name: C("偵察無人機", "偵察ドローン"), desc: C("飛行單位：無視迷宮直線飛向核心。迫擊砲打不到。", "飛行：迷路を無視して直進。迫撃砲は当たらない。") },
    firewall: { hp: 130, spd: 0.7, armor: 4, bounty: 10, cost: 3, from: 5, leak: 2, color: 0xff7a2c, name: C("防火牆", "ファイアウォール"), desc: C("厚重裝甲：每發動能傷害減 4（至少保留 30%）。", "重装甲：動能ダメージを 1 発ごと 4 軽減（最低 30%）。") },
    worm: { hp: 50, spd: 1, shield: 60, bounty: 9, cost: 3, from: 6, color: 0xb36bff, name: C("護盾蠕蟲", "シールドワーム"), desc: C("護盾先吸收傷害；能量傷害 ×1.5、EMP 更有效。", "シールドが先に吸収。能量ダメージ 1.5 倍、EMP がさらに有効。") },
    splitter: { hp: 70, spd: 0.9, bounty: 6, cost: 3, from: 8, split: 2, color: 0xff3a55, name: C("分裂病毒", "分裂ウイルス"), desc: C("被消滅時分裂成 2 隻位元蟲。", "倒すとビットバグ 2 体に分裂。") },
    trojan: { hp: 60, spd: 1.2, stealth: true, bounty: 8, cost: 3, from: 9, color: 0xc0c8ff, name: C("隱形木馬", "ステルストロイ"), desc: C("隱形：只有在砲塔射程一半以內才會被瞄準（振盪器、法拉第籠、中繼器 Lv3 可看破）。", "ステルス：射程の半分以内でしか狙われない（発振器・ファラデー・リレー Lv3 で看破）。") },
    healer: { hp: 80, spd: 0.8, heal: 0.05, bounty: 10, cost: 4, from: 11, color: 0x6bffcf, name: C("修復節點", "修復ノード"), desc: C("每秒修復周圍敵人 5% 生命。被 EMP 打到會停擺。", "毎秒周囲の敵を 5% 回復。EMP で停止。") },
    kernel: { hp: 2400, spd: 0.45, armor: 3, shield: 500, bounty: 150, cost: 0, boss: true, leak: 10, color: 0xff2244, name: C("核心恐慌", "カーネルパニック"), desc: C("首領：厚重的裝甲與護盾。", "ボス：重装甲とシールド。") },
    daemon: { hp: 4200, spd: 0.5, fly: true, bounty: 220, cost: 0, boss: true, leak: 10, summon: 5, color: 0xff8a00, name: C("背景惡魔程序", "デーモンプロセス"), desc: C("首領（飛行）：每 5 秒放出 2 架無人機。", "ボス（飛行）：5 秒ごとにドローンを 2 機放出。") },
    singularity: { hp: 9000, spd: 0.4, armor: 5, shield: 1500, bounty: 400, cost: 0, boss: true, leak: 20, emp: 8, color: 0x9a55ff, name: C("奇異點", "シンギュラリティ"), desc: C("最終首領：每 8 秒發出電磁脈衝，讓周圍砲塔停機 2 秒。", "最終ボス：8 秒ごとに電磁パルスで周囲の砲塔を 2 秒停止。") }
  };
  var BOSS_BY_WAVE = { 10: "kernel", 20: "daemon", 30: "singularity" };

  // ---------------- 十大地圖 ----------------
  // board／trace／glow：3D 電路板配色；mech：特殊機制（denshi_core.js 依 id 實作）
  var MAPS = [
    { id: "mobo", board: 0x0b3a29, trace: 0xc9a646, glow: 0x3cffb0, name: C("主機板", "マザーボード"),
      mech: C("匯流排", "バス"), mdesc: C("金色匯流排上的地基，砲塔射速 +25%。", "金色のバス上の地盤に建てた砲塔は連射 +25%。") },
    { id: "psu", board: 0x261a0e, trace: 0xff9a3c, glow: 0xffcc33, name: C("電源供應器", "電源ユニット"),
      mech: C("電壓波動", "電圧変動"), mdesc: C("每波電壓隨機（80%〜125% 傷害）；每 20 秒一次 3 秒突波，全砲塔傷害 ×1.5。", "ウェーブごとに電圧がランダム（威力 80〜125%）。20 秒ごとに 3 秒間のサージで威力 1.5 倍。") },
    { id: "heat", board: 0x1b2734, trace: 0x9fb6c8, glow: 0x6ad1ff, name: C("散熱鰭片", "ヒートシンク"),
      mech: C("過熱", "オーバーヒート"), mdesc: C("砲塔開火會累積熱量，過熱就停機。蓋在散熱鰭片上的地基散熱快 3 倍。", "射撃で熱が溜まり、過熱すると停止。放熱フィン上の地盤は冷却 3 倍。") },
    { id: "ram", board: 0x0e2918, trace: 0x49d36b, glow: 0x7dff7d, name: C("記憶體陣列", "メモリアレイ"),
      mech: C("位元翻轉", "ビット反転"), mdesc: C("每波開始時隨機出現壞軌（擋路、不能蓋），也有舊壞軌被修復，迷宮會變。", "ウェーブ開始ごとに不良セクタが発生／修復され、迷路が変わる。") },
    { id: "quantum", board: 0x140f2e, trace: 0x9b7bff, glow: 0xd17bff, name: C("量子晶片", "量子チップ"),
      mech: C("量子穿隧", "量子トンネル"), mdesc: C("地面敵人會不時穿隧前進 2 格；砲塔有 15% 機率疊加態造成雙倍傷害。", "地上の敵がときどき 2 マス先へトンネル。砲塔は 15% で重ね合わせの 2 倍ダメージ。") },
    { id: "fiber", board: 0x08202e, trace: 0x35e0ff, glow: 0x35e0ff, name: C("光纖網路", "光ファイバー網"),
      mech: C("多路傳輸", "多重伝送"), mdesc: C("3 個入口輪流開放；光纖上的地基，砲塔射程 +0.8。", "3 つの入口が交代で開く。光ファイバー上の地盤は射程 +0.8。") },
    { id: "antenna", board: 0x1a1f12, trace: 0xd9c26a, glow: 0xffe066, name: C("天線陣列", "アンテナアレイ"),
      mech: C("訊號干擾", "電波妨害"), mdesc: C("干擾波會橫掃地圖，被掃到的那幾行砲塔暫時停機。", "妨害波がマップを横切り、範囲内の砲塔が一時停止。") },
    { id: "grid", board: 0x0f1322, trace: 0x6c8cff, glow: 0xb0c4ff, name: C("變電所", "変電所"),
      mech: C("雷暴", "雷嵐"), mdesc: C("每 4 秒隨機落雷，打傷附近敵人；劈中特斯拉線圈會讓它超載 5 秒（傷害 ×2），劈中其他砲塔會停機 2 秒。", "4 秒ごとに落雷し周囲の敵にダメージ。テスラに落ちると 5 秒間過負荷（2 倍）、他の砲塔は 2 秒停止。") },
    { id: "fab", board: 0x232329, trace: 0xc0c0c8, glow: 0xffd27a, name: C("晶圓廠", "ウェハー工場"),
      mech: C("輸送帶", "コンベア"), mdesc: C("輸送帶不能放地基，敵人走在上面速度 ×1.7。", "コンベアには地盤を置けず、上を通る敵は 1.7 倍速。") },
    { id: "aicore", board: 0x1b0a14, trace: 0xff4d7a, glow: 0xff3366, name: C("AI 核心", "AI コア"),
      mech: C("自我學習", "自己学習"), mdesc: C("每波結束後，敵人會對上一波受傷最多的傷害類型（動能／能量）產生 15% 抗性（最多 60%），另一種抗性下降。", "ウェーブ後、敵は最も受けた種類（運動／エネルギー）に 15% 耐性（最大 60%）を獲得し、もう一方は低下。") }
  ];

  // ---------------- 地基方塊 ----------------
  var PIECES = [
    { id: "I", w: 10, cells: [[0, 0], [1, 0], [2, 0], [3, 0]] },
    { id: "O", w: 10, cells: [[0, 0], [1, 0], [0, 1], [1, 1]] },
    { id: "T", w: 10, cells: [[0, 0], [1, 0], [2, 0], [1, 1]] },
    { id: "S", w: 10, cells: [[1, 0], [2, 0], [0, 1], [1, 1]] },
    { id: "Z", w: 10, cells: [[0, 0], [1, 0], [1, 1], [2, 1]] },
    { id: "L", w: 10, cells: [[0, 0], [0, 1], [0, 2], [1, 2]] },
    { id: "J", w: 10, cells: [[1, 0], [1, 1], [1, 2], [0, 2]] },
    { id: "m1", w: 3, cells: [[0, 0]] },
    { id: "d2", w: 4, cells: [[0, 0], [1, 0]] },
    { id: "i3", w: 4, cells: [[0, 0], [1, 0], [2, 0]] },
    { id: "v3", w: 4, cells: [[0, 0], [1, 0], [0, 1]] },
    { id: "X", w: 2, cells: [[1, 0], [0, 1], [1, 1], [2, 1], [1, 2]] },
    { id: "U", w: 2, cells: [[0, 0], [2, 0], [0, 1], [1, 1], [2, 1]] },
    { id: "P", w: 2, cells: [[0, 0], [1, 0], [0, 1], [1, 1], [0, 2]] }
  ];
  // 特殊格：蓋在上面的砲塔得到加成
  var MODS = {
    sc: { color: 0xc06bff, icon: "◆", name: C("超導格", "超伝導マス"), desc: C("傷害 +25%", "威力 +25%") },
    cap: { color: 0x35e0ff, icon: "◎", name: C("電容格", "コンデンサマス"), desc: C("射程 +0.6", "射程 +0.6") },
    fan: { color: 0xf2f6ff, icon: "✣", name: C("散熱格", "放熱マス"), desc: C("射速 +25%", "連射 +25%") },
    au: { color: 0xffc83c, icon: "$", name: C("鍍金格", "金メッキマス"), desc: C("擊殺資金 +2、拆除全額退費", "撃破資金 +2・売却全額返金") }
  };

  var DIFFS = { easy: { hp: 0.75, cash: 1.2, name: C("簡單", "やさしい") }, normal: { hp: 1, cash: 1, name: C("普通", "ふつう") }, hard: { hp: 1.35, cash: 0.9, name: C("困難", "むずかしい") } };
  var PLAYER_COLORS = [0x35e0ff, 0xff8a3c, 0xb36bff, 0x6bff8a];

  window.PriTestDenshiData = {
    C: C, L: L, TOWERS: TOWERS, BUILD_ORDER: BUILD_ORDER, ENEMIES: ENEMIES, BOSS_BY_WAVE: BOSS_BY_WAVE,
    MAPS: MAPS, PIECES: PIECES, MODS: MODS, DIFFS: DIFFS, PLAYER_COLORS: PLAYER_COLORS, W: 20, H: 12
  };
})();
