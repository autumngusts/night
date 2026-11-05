// 明星經紀 starV：醜聞連鎖（多階段危機）與藝人關係事件（2026-11-05 使用者指定「1-7 可以做」的 5、7）。
// 連鎖：第一段是一般的隨機事件；選項結果的 fx.chain＝幾天後（fx.chainDays，預設 2）接續的下一段事件 id，
// 由 starv_plus.js 排進 st.plus.chain，到期時以同一位藝人觸發。後續各段 trigger 為 "cond"（只由程式觸發），不會被隨機抽到。
// 關係事件（trigger "cond"）由 starv_plus.js 每月依好友／對手組合觸發，ctx.partner＝另一人（文字裡的 {partner}）。
// 擴充效果鍵（starv_plus.js 的 fx 掛鉤）：anti 黑粉指數、core 核心粉（人氣的比例）、bond 兩人關係、partner 對方的壓力／滿意度／心情。
(function () {
  "use strict";

  var root = typeof window !== "undefined" ? window : globalThis;
  var D = root.PriTestStarvData;
  var T = D.T;

  function O(w, fx, bad) { return { w: w, fx: fx || {}, bad: !!bad }; }
  function C(label, hint, outcomes) { return { label: T(label), hint: T(hint), outcomes: outcomes }; }
  function E(id, category, target, title, text, choices, defaultChoice, trigger, weight) {
    return { id: id, addedIn: "v7", category: category, target: target, trigger: trigger || "random", weight: weight || 10,
      title: T(title), text: T(text), choices: choices, defaultChoice: defaultChoice };
  }
  var START = 30;   // 連鎖起點的權重比一般事件（10）高，玩家才遇得到

  root.PriTestStarvEvents.add([
    // ===== 連鎖 A：深夜密會 =====
    E("ch_love_1", "scandal", "famous", "深夜密會|深夜の密会", "週刊拍到 {name} 深夜和神秘人物一起進出公寓。這只是開始……|週刊誌が深夜に {name} と謎の人物がマンションに出入りする姿を撮った。これは始まりにすぎない……", [
      C("公開戀情|交際を公表する", "賭粉絲的反應|ファンの反応次第", [O(5, { famePct: -0.08, stress: -10, chain: "ch_love_2a" }, true), O(5, { famePct: 0.05, core: 0.03, chain: "ch_love_2a" })]),
      C("堅決否認|きっぱり否定する", "可能被追打|追撃されるかも", [O(6, { stress: 10, chain: "ch_love_2b" }), O(4, { stress: 5 })]),
      C("沉默不回應|ノーコメント", "放著會發酵|放置すると発酵する", [O(10, { chain: "ch_love_2b", chainDays: 3 })])
    ], 1, "random", START),
    E("ch_love_2a", "scandal", "any", "粉絲分裂|ファンが分裂", "公開戀情後，{name} 的粉絲論壇吵成兩派，有人退坑、有人力挺。|交際公表後、{name} のファン掲示板が二派に割れた。去る人もいれば応援する人も。", [
      C("親筆寫信給粉絲|直筆の手紙をファンへ", "核心粉↑ 黑粉↓|コアファン↑ アンチ↓", [O(7, { core: 0.05, anti: -10, stress: 5 }), O(3, { anti: 5 }, true)]),
      C("讓時間沖淡一切|時間に任せる", "黑粉可能增加|アンチが増えるかも", [O(6, { anti: 8, famePct: -0.03 }, true), O(4, {})])
    ], 1, "cond"),
    E("ch_love_2b", "scandal", "any", "第二批照片|第二弾の写真", "第二批照片流出，這次清楚拍到了正臉。媒體開始在 {name} 家門口守候。|第二弾の写真が流出、今回は顔がはっきり写っている。マスコミが {name} の自宅前に張り込み始めた。", [
      C("召開記者會坦白|会見で正直に話す", "短痛|痛みは短い", [O(6, { famePct: -0.1, anti: -5, stress: -5, chain: "ch_love_3" }), O(4, { famePct: -0.05, core: 0.02 })]),
      C("對週刊提告|週刊誌を提訴する", "花錢 看運氣|出費 運次第", [O(5, { money: -30000, famePct: 0.03 }), O(5, { money: -30000, anti: 15, famePct: -0.12, chain: "ch_love_3" }, true)]),
      C("繼續否認|否定を続ける", "風險很大|リスク大", [O(4, { stress: 15 }), O(6, { anti: 20, famePct: -0.2, satisfaction: -10 }, true)])
    ], 0, "cond"),
    E("ch_love_3", "chance", "any", "風波之後|騒動のあとで", "風波漸漸平息，有談話節目想邀請 {name} 聊聊這段經歷。|騒動が落ち着いてきた。トーク番組が {name} にこの経験を語ってほしいと言っている。", [
      C("上節目真情告白|番組で本音を語る", "人氣可能大翻身|大逆転のチャンス", [O(6, { famePct: 0.12, core: 0.04, anti: -10 }), O(4, { famePct: -0.05, anti: 5 }, true)]),
      C("婉拒，專心工作|断って仕事に集中", "穩定|安定", [O(1, { stress: -10, satisfaction: 5 })])
    ], 1, "cond"),

    // ===== 連鎖 B：舊帳被翻 =====
    E("ch_past_1", "net", "famous", "出道前的直播|デビュー前の配信", "網友翻出 {name} 出道前的直播片段，裡面的發言引發爭議。|{name} のデビュー前の配信が掘り起こされ、当時の発言が物議を醸している。", [
      C("立刻道歉|すぐに謝罪", "人氣小幅↓|人気やや↓", [O(7, { famePct: -0.04, anti: -3 }), O(3, { famePct: -0.04, chain: "ch_past_2" })]),
      C("解釋前後文|前後の文脈を説明", "看網友買不買單|受け入れられるか次第", [O(5, { famePct: 0.02 }), O(5, { anti: 10, chain: "ch_past_2" }, true)]),
      C("不理會|相手にしない", "可能延燒|延焼のおそれ", [O(3, {}), O(7, { anti: 8, chain: "ch_past_2" }, true)])
    ], 0, "random", START),
    E("ch_past_2", "net", "any", "網路公審|ネットの吊し上げ", "爭議持續延燒，有人發起抵制，連 {name} 代言的品牌都來關切。|炎上は止まらず不買運動まで始まり、{name} が出ている CM のスポンサーも懸念を示している。", [
      C("主動暫停活動一週|一週間の活動自粛", "黑粉↓ 之後有轉機|アンチ↓ その後に転機", [O(1, { rest: 7, famePct: -0.05, anti: -15, chain: "ch_past_3", chainDays: 8 })]),
      C("請公關團隊處理|PR チームに対応を頼む", "花錢 看運氣|出費 運次第", [O(5, { money: -20000, anti: -8 }), O(5, { money: -20000, anti: 15, famePct: -0.1 }, true)]),
      C("硬撐照常工作|普段どおり仕事を続ける", "壓力↑|ストレス↑", [O(4, { stress: 15 }), O(6, { stress: 20, anti: 12, famePct: -0.15 }, true)])
    ], 0, "cond"),
    E("ch_past_3", "chance", "any", "復出的方式|復帰のしかた", "自粛期間結束了，{name} 準備回到工作崗位。|自粛期間が終わり、{name} は仕事に戻る準備をしている。", [
      C("以公益活動復出|チャリティ活動で復帰", "形象回升|イメージ回復", [O(7, { famePct: 0.06, anti: -10, core: 0.02 }), O(3, { anti: 5 }, true)]),
      C("低調回到工作|静かに仕事へ戻る", "穩定|安定", [O(1, { stress: -5 })])
    ], 1, "cond"),

    // ===== 連鎖 C：片場爆料 =====
    E("ch_diva_1", "scandal", "famous", "前工作人員爆料|元スタッフの暴露", "前工作人員在網路上爆料 {name} 在片場態度惡劣，貼文被大量轉發。|元スタッフが {name} の撮影現場での態度が最悪だったとネットで暴露、拡散されている。", [
      C("私下聯絡對方和解|個別に連絡して和解", "花錢|出費", [O(6, { money: -10000 }), O(4, { money: -10000, chain: "ch_diva_2" })]),
      C("公開反駁|公に反論する", "粉絲力挺或火上加油|擁護か炎上か", [O(5, { core: 0.02 }), O(5, { anti: 12, chain: "ch_diva_2" }, true)]),
      C("請劇組出面說明|制作側に説明を頼む", "比較穩|比較的安全", [O(7, { famePct: 0.02 }), O(3, { chain: "ch_diva_2" })])
    ], 2, "random", START),
    E("ch_diva_2", "scandal", "any", "錄音檔流出|録音データの流出", "一段疑似 {name} 在片場發脾氣的錄音被放上網。|撮影現場で {name} が怒鳴っているとされる録音がネットに上がった。", [
      C("承認情緒失控並道歉|感情的になったと認めて謝罪", "誠實的代價|正直の代償", [O(7, { famePct: -0.06, anti: -8, stress: 5, chain: "ch_diva_3" }), O(3, { famePct: -0.1, anti: 5 }, true)]),
      C("委託鑑定錄音真偽|録音の真偽を鑑定に出す", "花錢 一翻兩瞪眼|出費 白黒つく", [O(4, { money: -15000, famePct: 0.08, anti: -15 }), O(6, { money: -15000, anti: 15, famePct: -0.12 }, true)])
    ], 0, "cond"),
    E("ch_diva_3", "chance", "any", "反差角色|ギャップのある役", "有導演看了這次的風波，想給 {name} 一個反差很大的角色。|今回の騒動を見たある監督が、{name} にギャップの大きい役をオファーしてきた。", [
      C("接下挑戰|挑戦を受ける", "指名工作|指名の仕事", [O(1, { specialJob: true, stress: 5 })]),
      C("先休息調整|まずは休んで立て直す", "壓力↓|ストレス↓", [O(1, { rest: 3, stress: -15 })])
    ], 1, "cond"),

    // ===== 連鎖 D：過勞危機 =====
    E("ch_burn_1", "health", "stressed", "彩排時差點昏倒|リハーサル中に倒れかける", "{name} 在彩排時臉色蒼白，差點昏倒在舞台上。|{name} がリハーサル中に真っ青になり、ステージで倒れそうになった。", [
      C("立刻送醫檢查|すぐ病院で検査", "花錢 休養|出費 休養", [O(8, { money: -5000, rest: 3, stress: -10 }), O(2, { money: -5000, rest: 3, chain: "ch_burn_2" })]),
      C("休息一下繼續|少し休んで続ける", "體力↓ 有風險|体力↓ リスクあり", [O(5, { stamina: -15 }), O(5, { stamina: -25, chain: "ch_burn_2" }, true)])
    ], 0, "random", START),
    E("ch_burn_2", "health", "any", "記者守在醫院|病院前の記者", "媒體拍到 {name} 進出醫院，網路上出現各種猜測。|{name} の通院が撮られ、ネットにはさまざまな憶測が飛び交っている。", [
      C("發聲明說明狀況|声明で状況を説明", "粉絲安心|ファンが安心", [O(7, { core: 0.03, anti: -5 }), O(3, { famePct: -0.03 })]),
      C("保持沉默|沈黙を守る", "謠言可能升級|噂がエスカレートするかも", [O(5, {}), O(5, { anti: 6, famePct: -0.05, chain: "ch_burn_3" }, true)])
    ], 0, "cond"),
    E("ch_burn_3", "health", "any", "引退謠言|引退の噂", "網路謠傳 {name} 準備引退，粉絲人心惶惶。|{name} が引退するという噂が流れ、ファンが動揺している。", [
      C("開直播報平安|配信で元気な姿を見せる", "核心粉↑|コアファン↑", [O(8, { core: 0.05, famePct: 0.03, anti: -5 }), O(2, { stress: 10 })]),
      C("由公司發公告|事務所から告知する", "穩定|安定", [O(1, { famePct: -0.02 })])
    ], 1, "cond"),

    // ===== 連鎖 E：抄襲疑雲 =====
    E("ch_copy_1", "scandal", "music", "比對影片|比較動画", "有網友做了比對影片，指稱 {name} 的新作抄襲。|ネットに比較動画が上がり、{name} の新作が盗作だと言われている。", [
      C("公開創作過程|制作過程を公開", "證明清白的機會|潔白を示すチャンス", [O(6, { core: 0.02, famePct: 0.03 }), O(4, { chain: "ch_copy_2" })]),
      C("交給律師處理|弁護士に任せる", "花錢|出費", [O(5, { money: -20000 }), O(5, { money: -20000, chain: "ch_copy_2" })]),
      C("不予回應|コメントしない", "可能延燒|延焼のおそれ", [O(4, {}), O(6, { anti: 10, chain: "ch_copy_2" }, true)])
    ], 1, "random", START),
    E("ch_copy_2", "scandal", "any", "原作者發聲|原作者が声を上げる", "被指抄襲的原作者也出面了，態度曖昧不明。|盗作元とされる作者が姿を見せた。態度ははっきりしない。", [
      C("親自拜訪原作者|原作者を直接訪ねる", "誠意可能被接受|誠意が通じるかも", [O(6, { famePct: 0.08, anti: -12 }), O(4, { money: -30000, famePct: -0.08, chain: "ch_copy_3" }, true)]),
      C("等原作者表態|原作者の出方を待つ", "看對方|相手次第", [O(5, {}), O(5, { anti: 12, famePct: -0.12, chain: "ch_copy_3" }, true)])
    ], 1, "cond"),
    E("ch_copy_3", "chance", "any", "和解與合作|和解と共作", "雙方談過之後，原作者提議乾脆一起合作推出新版本。|話し合いの末、原作者が一緒に新バージョンを作ろうと提案してきた。", [
      C("合作推出新版|共作で新バージョン", "化危機為轉機|ピンチをチャンスに", [O(7, { famePct: 0.1, core: 0.03, money: 10000 }), O(3, { stress: 10 })]),
      C("和解後各走各的|和解して別々の道へ", "花錢收尾|出費で決着", [O(1, { money: -10000, anti: -5 })])
    ], 1, "cond"),

    // ===== 藝人關係事件 =====
    E("bond_clash", "company", "any", "休息室裡的爭吵|楽屋での口論", "{name} 和 {partner} 在休息室為了角色分配大吵一架，整層樓都聽得到。|{name} と {partner} が役の割り振りで楽屋で大げんか、フロア中に響いている。", [
      C("安排兩人好好談|二人で話し合わせる", "可能和好|仲直りできるかも", [O(6, { bond: 20, stress: -5, partner: { stress: -5 } }), O(4, { bond: -10, stress: 5 }, true)]),
      C("讓他們各自冷靜|それぞれ頭を冷やさせる", "暫時平息|ひとまず収まる", [O(1, { stress: -5, partner: { stress: -5 } })]),
      C("讓他們在工作上一較高下|仕事で決着をつけさせる", "對立加深 指名工作|対立が深まる 指名の仕事", [O(1, { bond: -15, specialJob: true })])
    ], 1, "cond"),
    E("bond_support", "company", "any", "宵夜之約|夜食の誘い", "{partner} 注意到 {name} 最近壓力很大，主動約他去吃宵夜。|{partner} は {name} が最近ストレスを抱えていると気づき、夜食に誘った。", [
      C("給兩人放半天假|二人に半日休みをあげる", "壓力↓ 感情↑|ストレス↓ 絆↑", [O(1, { stress: -15, bond: 10, partner: { stress: -8, mood: 1 } })]),
      C("工作優先|仕事を優先", "小幅增加感情|絆が少し深まる", [O(1, { bond: 3 })])
    ], 0, "cond")
  ]);
})();
