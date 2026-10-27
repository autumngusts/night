// 明星經紀 starV：首批名錄（v1）。計畫 9 會擴充到 SR 30／SSR 12。
(function () {
  "use strict";

  var root = typeof window !== "undefined" ? window : globalThis;
  var T = root.PriTestStarvData.T;

  root.PriTestStarvRoster.add([
    {
      id: "sr001", rarity: "SR", addedIn: "v1", debut: false,
      name: T("星野澪|星野 澪"), gender: "f", age: 19, dir: "singer", subDirs: ["idol"],
      apt: { act: "C", vocal: "A", dance: "C", talk: "B", charm: "B", sense: "B" },
      stats: { act: 25, vocal: 80, dance: 30, talk: 35, charm: 45, sense: 40 },
      traits: ["sweetvoice"], skill: null,
      look: { face: 1, hair: 3, hairColor: 6, eye: 2, outfit: 1, acc: 2, skin: 0 },
      bio: T("在地下 Live House 唱了三年的少女，嗓音清亮得像玻璃風鈴。|地下ライブハウスで三年歌い続けた少女。ガラスの風鈴のように澄んだ声。")
    },
    {
      id: "sr002", rarity: "SR", addedIn: "v1", debut: false,
      name: T("陸景行|陸 景行"), gender: "m", age: 24, dir: "film", subDirs: ["drama"],
      apt: { act: "A", vocal: "C", dance: "C", talk: "B", charm: "A", sense: "B" },
      stats: { act: 75, vocal: 20, dance: 25, talk: 40, charm: 65, sense: 35 },
      traits: ["method", "camera"], skill: null,
      look: { face: 2, hair: 7, hairColor: 0, eye: 4, outfit: 5, acc: -1, skin: 1 },
      bio: T("劇團出身的實力派，拍戲前會花一個月住進角色的生活。|劇団出身の実力派。撮影前の一か月は役の暮らしをして過ごす。")
    },
    {
      id: "sr003", rarity: "SR", addedIn: "v1", debut: false,
      name: T("白鳥舞|白鳥 舞"), gender: "f", age: 21, dir: "dancer", subDirs: ["stage"],
      apt: { act: "B", vocal: "C", dance: "A", talk: "C", charm: "B", sense: "B" },
      stats: { act: 35, vocal: 25, dance: 90, talk: 20, charm: 45, sense: 40 },
      traits: ["supple"], skill: null,
      look: { face: 0, hair: 9, hairColor: 1, eye: 1, outfit: 3, acc: 4, skin: 0 },
      bio: T("前芭蕾舞團首席，轉戰街舞後一夜爆紅。|元バレエ団プリンシパル。ストリートダンスに転向して一夜でブレイク。")
    },
    {
      id: "ssr001", rarity: "SSR", addedIn: "v1", debut: true,
      name: T("天音詩織|天音 詩織"), gender: "f", age: 20, dir: "idol", subDirs: ["singer", "drama"],
      apt: { act: "B", vocal: "S", dance: "A", talk: "A", charm: "S", sense: "B" },
      stats: { act: 50, vocal: 95, dance: 80, talk: 60, charm: 100, sense: 45 },
      traits: ["aura", "showman"],
      skill: { id: "miracle", name: T("奇蹟偶像|奇跡のアイドル"), desc: T("偶像／歌手表現 +20%，大成功門檻 -0.2|アイドル・歌手の表現 +20%、大成功ライン -0.2"),
        fx: { perfDirs: { dirs: ["idol", "singer"], v: 1.2 }, greatShift: { dirs: ["idol", "singer"], v: 0.2 } } },
      look: { face: 3, hair: 11, hairColor: 4, eye: 5, outfit: 7, acc: 0, skin: 0 },
      bio: T("十歲那年在商店街的歌唱大賽奪冠，從此夢想站上巨蛋。|十歳で商店街ののど自慢を制して以来、ドームのステージが夢。")      ,
      story: T("詩織第一次站上巨蛋那天，台下的螢光棒海裡，有一支是商店街的老闆舉著的。十年前他把冠軍獎盃遞給她時說：『等妳唱到巨蛋，我一定去。』她在安可時唱了那首比賽時的歌，聲音只顫抖了一下。|詩織が初めてドームに立った日、客席のペンライトの海に、商店街の店主が振る一本があった。十年前、優勝トロフィーを渡しながら彼は言った。『ドームで歌う日が来たら、必ず行く』。アンコールで彼女はあの大会の曲を歌った。声が震えたのは一度だけだった。")
    },
    {
      id: "ssr002", rarity: "SSR", addedIn: "v1", debut: false,
      name: T("夜城蓮|夜城 蓮"), gender: "m", age: 27, dir: "film", subDirs: ["stage", "drama"],
      apt: { act: "S", vocal: "B", dance: "B", talk: "B", charm: "A", sense: "A" },
      stats: { act: 110, vocal: 40, dance: 45, talk: 50, charm: 85, sense: 70 },
      traits: ["method", "perfectionist"],
      skill: { id: "thousand", name: T("千面|千の顔"), desc: T("電影／舞台劇／電視劇表現 +20%，大成功門檻 -0.15|映画・舞台・ドラマの表現 +20%、大成功ライン -0.15"),
        fx: { perfDirs: { dirs: ["film", "stage", "drama"], v: 1.2 }, greatShift: { dirs: ["film", "stage", "drama"], v: 0.15 } } },
      look: { face: 2, hair: 5, hairColor: 0, eye: 3, outfit: 6, acc: 5, skin: 2 },
      bio: T("被稱為「一人千面」的天才演員，沒有人見過他的真面目。|「千の顔を持つ男」と呼ばれる天才俳優。素顔を知る者はいない。")      ,
      story: T("領獎那晚，記者問蓮：「哪一張臉才是真正的你？」他想了很久，說：「今天站在這裡、手在發抖的這張吧。」那是他出道以來，第一次在鏡頭前沒有演任何人。|授賞式の夜、記者が蓮に聞いた。「どの顔が本当のあなたですか」。彼は長く考えてから答えた。「今日ここに立って、手が震えているこの顔でしょう」。デビュー以来初めて、カメラの前で誰も演じなかった瞬間だった。")
    }
  ]);
})();
