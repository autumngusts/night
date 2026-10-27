// 明星經紀 starV：重大事件 v4——大型企劃的分歧（規格 §12）。由核心在企劃階段結束時推出，ctx.project＝企劃 id。
// projectMod 加到下一階段的表現修正，projectDays 加到下一階段的天數。
(function () {
  "use strict";

  var root = typeof window !== "undefined" ? window : globalThis;
  var T = root.PriTestStarvData.T;

  function O(w, fx, bad) { return { w: w, fx: fx, bad: !!bad }; }
  function C(label, hint, outcomes) { return { label: T(label), hint: T(hint), outcomes: outcomes }; }
  function E(id, title, text, choices, defaultChoice) {
    return { id: id, addedIn: "v4", category: "special", target: "none", trigger: "cond", weight: 10,
      title: T(title), text: T(text), choices: choices, defaultChoice: defaultChoice };
  }

  root.PriTestStarvEvents.add([
    E("proj_injury", "主演受傷|主演の負傷", "企劃進行中，主要成員之一受了傷。|企画の途中で、主要メンバーの一人が負傷した。", [
      C("換角繼續|代役で続行", "下一階段表現↓|次の段階の表現↓", [O(1, { projectMod: -0.1 })]),
      C("延期等他康復|回復を待って延期", "下一階段天數↑ 花錢|次の段階の日数↑ 出費", [O(1, { projectDays: 7, money: -20000 })])
    ], 1),
    E("proj_sponsor", "贊助商加碼|スポンサーの増額", "贊助商願意加碼，條件是在作品裡放更多置入。|スポンサーが増額を申し出た。条件は作中のタイアップを増やすこと。", [
      C("接受|受ける", "資金↑ 下一階段表現↓|資金↑ 次の段階の表現↓", [O(1, { money: 80000, projectMod: -0.05 })]),
      C("婉拒|断る", "沒有變化|変化なし", [O(1, {})])
    ], 1),
    E("proj_buzz", "宣傳爆紅|宣伝がバズった", "企劃的預告在網路上爆紅，大家都在討論。|企画の予告がネットでバズり、話題になっている。", [
      C("加碼宣傳|宣伝を追加", "花錢 下一階段表現大幅↑|出費 次の段階の表現大幅↑", [O(7, { money: -30000, projectMod: 0.15 }), O(3, { money: -30000, projectMod: 0.03 }, true)]),
      C("維持原計畫|計画どおり進める", "下一階段表現小幅↑|次の段階の表現やや↑", [O(1, { projectMod: 0.05 })])
    ], 1)
  ]);
})();
