// 明星經紀 starV：重大事件 v3——生涯（續約、引退；規格 §11）。兩者都是條件觸發，由核心在合約到期、引退判定時推出。
// renew / retire / retain 是生涯專用的 fx，效果依藝人當下的滿意度決定（見 starv_core.js 的 applyFx）。
(function () {
  "use strict";

  var root = typeof window !== "undefined" ? window : globalThis;
  var T = root.PriTestStarvData.T;

  function O(fx) { return { w: 1, fx: fx, bad: false }; }
  function C(label, hint, fx) { return { label: T(label), hint: T(hint), outcomes: [O(fx)] }; }
  function E(id, title, text, choices, defaultChoice) {
    return { id: id, addedIn: "v3", category: "special", target: "any", trigger: "cond", weight: 10,
      title: T(title), text: T(text), choices: choices, defaultChoice: defaultChoice };
  }

  root.PriTestStarvEvents.add([
    E("contract_renewal", "合約到期|契約満了", "{name} 的合約到期了，要怎麼談續約？|{name} の契約が満了した。更新の条件はどうする？", [
      C("加薪續約|昇給して更新", "月薪↑ 滿意度↑ 一定續約|月給↑ 満足度↑ 必ず更新", { renew: "raise" }),
      C("照常續約|通常の条件で更新", "月薪小幅↑ 滿意度低可能拒絕|月給やや↑ 満足度が低いと断られる", { renew: "standard" }),
      C("不續約|更新しない", "藝人離開|タレントが去る", { renew: "release" })
    ], 1),
    E("retire_offer", "引退的念頭|引退の申し出", "{name} 說最近在考慮引退。|{name} が引退を考えていると打ち明けた。", [
      C("尊重決定|本人の意思を尊重", "引退（評分夠高就進名人堂）|引退（評価が高ければ殿堂入り）", { retire: true }),
      C("加薪挽留|昇給して引き留める", "成功率看滿意度|成功率は満足度次第", { retain: "raise" }),
      C("給一個月長假|一か月の長期休暇", "成功率看滿意度|成功率は満足度次第", { retain: "rest" })
    ], 2)
  ]);
})();
