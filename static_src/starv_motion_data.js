// 明星經紀 starV：動圖圖鑑「御三家」資料（規格見 docs/superpowers/specs/2026-11-15-starv-motion-codex.md）。
// 只放資料；解鎖邏輯在 starv_motion.js，畫面在 starv_motion_ui.js。
//
// ★ 換上正式動畫時只要改這個檔案：
//   1. 把 webm 放進 static_src/images/starv/motion/（generate.py 會整個複製到 dist/static/images/）
//   2. 在下面每個動作的 src 填路徑（相對於 static/），例如 "images/starv/motion/s1_1.webm"
//   3. 名字、介紹、動作名稱改成正式文字（"中文|日文"）
//   src 留空字串時，圖鑑顯示「動畫準備中」的佔位畫面。
// ID（s1／s2／s3）存在玩家存檔裡，上線後不要改；要加第二期角色就往 STARTERS 後面追加新 ID。
(function () {
  "use strict";

  var root = typeof window !== "undefined" ? window : globalThis;
  var D = root.PriTestStarvData;
  var T = D.T;

  function move(name, src) { return { name: T(name), src: src || "" }; }
  function starter(id, name, desc, color, icon, moves) {
    return { id: id, name: T(name), desc: T(desc), color: color, icon: icon, moves: moves };
  }

  D.MOTION = {
    STARTERS: [
      starter("s1", "御三家・歌|御三家・歌", "以歌聲打動人心的新人。|歌声で心をつかむ新人。", "#ff5fa8", "🎤", [
        move("動作 1|モーション 1", ""),
        move("動作 2|モーション 2", ""),
        move("動作 3|モーション 3", "")
      ]),
      starter("s2", "御三家・舞|御三家・舞", "以舞步點亮舞台的新人。|ダンスでステージを照らす新人。", "#7c4dff", "🕺", [
        move("動作 1|モーション 1", ""),
        move("動作 2|モーション 2", ""),
        move("動作 3|モーション 3", "")
      ]),
      starter("s3", "御三家・演|御三家・演", "以演技說故事的新人。|演技で物語を語る新人。", "#e0b04a", "🎬", [
        move("動作 1|モーション 1", ""),
        move("動作 2|モーション 2", ""),
        move("動作 3|モーション 3", "")
      ])
    ],
    // 解鎖階段（每一局＝每個紀元各自判定；已解鎖的動作永久保留）
    //   階段 1：開局選擇御三家 → 選的那位 動作 1
    //   階段 2：本紀元第 1 次頒獎典禮結束 → 選的那位 動作 2、其他兩位 動作 1
    //   階段 3：再達到公司 Lv{midLevel} → 選的那位 動作 3、其他兩位 動作 2
    // 其他兩位的動作 3 只能在之後的局（新紀元或重新開始）選它們才拿得到。
    midLevel: 5
  };
  D.MOTION.BY_ID = {};
  D.MOTION.STARTERS.forEach(function (s) { D.MOTION.BY_ID[s.id] = s; });
})();
