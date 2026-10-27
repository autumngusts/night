// 明星經紀 starV：重大事件 v2——對手公司互動（6 種；規格 §7、§9）。
// rival: true → 觸發時抽一家對手放進 ctx.rival；needStar: true → 另外放一位該公司的宿敵明星到 ctx.star。
// 文字佔位 {rival}＝對手公司名、{star}＝宿敵明星名。
(function () {
  "use strict";

  var root = typeof window !== "undefined" ? window : globalThis;
  var T = root.PriTestStarvData.T;

  function O(w, fx, bad) { return { w: w, fx: fx || {}, bad: !!bad }; }
  function C(label, hint, outcomes) { return { label: T(label), hint: T(hint), outcomes: outcomes }; }
  function E(id, category, target, title, text, choices, defaultChoice, extra) {
    var ev = { id: id, addedIn: "v2", category: category, target: target, trigger: "random", weight: 10, rival: true,
      title: T(title), text: T(text), choices: choices, defaultChoice: defaultChoice };
    Object.keys(extra || {}).forEach(function (k) { ev[k] = extra[k]; });
    return ev;
  }

  root.PriTestStarvEvents.add([
    E("rival_collab", "chance", "famous", "聯合演出邀約|合同出演の打診", "{rival}提議讓 {name} 和他們的藝人聯合演出。|{rival}が {name} と自社タレントの共演を持ちかけてきた。", [
      C("答應|引き受ける", "人氣↑ 資金↑ 對手也變強|人気↑ 資金↑ 相手も強くなる", [O(1, { fame: 60, money: 20000, rivalPower: 5 })]),
      C("婉拒|断る", "沒有變化|変化なし", [O(1, {})])
    ], 1),
    E("paparazzi", "scandal", "famous", "對手放狗仔|ライバルの差し金", "週刊爆料 {name} 的負面消息，消息來源據說是{rival}。|{name} の悪い噂が週刊誌に。情報源は{rival}らしい。", [
      C("反擊爆料|暴露で反撃", "對手變弱 但可能兩敗俱傷|相手が弱る　ただし共倒れも", [O(5, { rivalPower: -10, famePct: -0.05 }), O(5, { famePct: -0.15, rivalPower: -5 }, true)]),
      C("發聲明澄清|声明で否定", "花錢 壓力↑|出費 ストレス↑", [O(1, { money: -10000, stress: 5 })]),
      C("無視|無視する", "看運氣|運次第", [O(6, {}), O(4, { famePct: -0.1 }, true)])
    ], 2),
    E("schedule_clash", "chance", "any", "搶檔期|スケジュールの奪い合い", "{rival}的新作和 {name} 的作品撞期了。|{rival}の新作が {name} の作品と公開日が重なった。", [
      C("硬碰硬|正面から勝負", "看運氣|運次第", [O(5, { fame: 80, rivalPower: -5 }), O(5, { famePct: -0.1, stress: 10 }, true)]),
      C("讓檔|日程をずらす", "沒有變化|変化なし", [O(1, {})])
    ], 1),
    E("rival_challenge", "special", "famous", "宿敵下戰帖|ライバルからの挑戦状", "{rival}的{star}在節目上公開向 {name} 下戰帖。|{rival}の{star}が番組で {name} に挑戦状を叩きつけた。", [
      C("應戰|受けて立つ", "看板出現指名工作|指名の仕事がボードに", [O(1, { specialJob: true, stress: 10 })]),
      C("不理會|相手にしない", "人氣小幅↓|人気やや↓", [O(1, { famePct: -0.05 })])
    ], 1, { needStar: true }),
    E("joint_brand", "company", "none", "聯名活動|コラボ企画", "{rival}想和公司一起辦聯名活動。|{rival}が共同キャンペーンを提案してきた。", [
      C("合作|組む", "資金↑ 聲望↑ 對手也變強|資金↑ 評判↑ 相手も強くなる", [O(1, { money: 40000, rep: 20, rivalPower: 5 })]),
      C("婉拒|断る", "沒有變化|変化なし", [O(1, {})])
    ], 1),
    E("rival_poach", "poach", "famous", "對手公開挖角|ライバルの公然の引き抜き", "{rival}在記者會上公開說想簽下 {name}。|{rival}が会見で {name} を獲得したいと公言した。", [
      C("加薪留人|昇給して引き留める", "月薪↑ 滿意度↑|月給↑ 満足度↑", [O(1, { salaryPct: 0.3, satisfaction: 15 })]),
      C("放人換違約金|違約金をもらって手放す", "失去藝人 資金↑ 對手變強|タレントを失う 資金↑ 相手が強くなる", [O(1, { leave: true, moneyBySalary: 6, rivalPower: 10 })]),
      C("談感情|情に訴える", "看滿意度|満足度次第", [O(5, { satisfaction: -5 }), O(5, { leave: true, rivalPower: 10 }, true)])
    ], 2)
  ]);
})();
