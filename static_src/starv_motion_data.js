// 明星經紀 starV：動圖圖鑑「御三家」資料（規格見 docs/superpowers/specs/2026-11-15-starv-motion-codex.md）。
// 只放資料；解鎖邏輯在 starv_motion.js，畫面在 starv_motion_ui.js。
//
// ★ 換上正式動畫時只要改這個檔案：
//   1. 把 webm 放進 static_src/images/starv/motion/（generate.py 會整個複製到 dist/static/images/）
//   2. 在下面每個動作的 src 填路徑（相對於 static/），例如 "images/starv/motion/s1_1.webm"
//   3. 靜止圖（選擇畫面、圖鑑縮圖用；png／webp）：
//        starter 的 still ＝ 角色立繪（選擇畫面的卡片），例如 "images/starv/motion/s1.webp"
//        move 的第 3 個參數 ＝ 該動作的縮圖（可省略，省略時用角色的 still）
//      still 留空時：選擇畫面改用動作 1 webm 的第一格；圖鑑縮圖顯示圖示。
//   4. 名字、介紹、動作名稱改成正式文字（"中文|日文"）
//   src 留空字串時，圖鑑顯示「動畫準備中」的佔位畫面，本命彈出也會略過。
// ID（s1／s2／s3）存在玩家存檔裡，上線後不要改；要加第二期角色就往 STARTERS 後面追加新 ID。
(function () {
  "use strict";

  var root = typeof window !== "undefined" ? window : globalThis;
  var D = root.PriTestStarvData;
  var T = D.T;

  // anim：同一動作的動態 WebP（Safari／iOS 不支援 VP9 透明 webm，或 webm 載入失敗時改用）；ms：一輪的長度（毫秒）
  function move(name, src, still, anim, ms) { return { name: T(name), src: src || "", still: still || "", anim: anim || "", ms: ms || 0 }; }
  // 正式素材：images/starv/motion/<id>.webp（靜止圖）、<id>_<n>.webm／.webp（動作 n）
  function mv(id, n, name) { var p = "images/starv/motion/" + id + "_" + n; return move(name, p + ".webm", "", p + ".webp", [0, 2976, 3968, 4960][n]); }
  function starter(id, name, desc, color, icon, still, moves) {
    return { id: id, name: T(name), desc: T(desc), color: color, icon: icon, still: still || "", moves: moves };
  }

  D.MOTION = {
    STARTERS: [
      starter("s1", "御三家・歌|御三家・歌", "以歌聲打動人心的新人。|歌声で心をつかむ新人。", "#ff5fa8", "🎤", "images/starv/motion/s1.webp", [
        mv("s1", 1, "動作 1|モーション 1"),
        mv("s1", 2, "動作 2|モーション 2"),
        mv("s1", 3, "動作 3|モーション 3")
      ]),
      starter("s2", "御三家・舞|御三家・舞", "以舞步點亮舞台的新人。|ダンスでステージを照らす新人。", "#7c4dff", "🕺", "images/starv/motion/s2.webp", [
        mv("s2", 1, "動作 1|モーション 1"),
        mv("s2", 2, "動作 2|モーション 2"),
        mv("s2", 3, "動作 3|モーション 3")
      ]),
      starter("s3", "御三家・演|御三家・演", "以演技說故事的新人。|演技で物語を語る新人。", "#e0b04a", "🎬", "images/starv/motion/s3.webp", [
        mv("s3", 1, "動作 1|モーション 1"),
        mv("s3", 2, "動作 2|モーション 2"),
        mv("s3", 3, "動作 3|モーション 3")
      ])
    ],
    // 解鎖階段（每一局＝每個紀元各自判定；已解鎖的動作永久保留）
    //   階段 1：開局選擇御三家 → 選的那位 動作 1
    //   階段 2：本紀元第 1 次頒獎典禮結束 → 選的那位 動作 2、其他兩位 動作 1
    //   階段 3：再達到公司 Lv{midLevel} → 選的那位 動作 3、其他兩位 動作 2
    // 其他兩位的動作 3 只能在之後的局（新紀元或重新開始）選它們才拿得到。
    midLevel: 5,
    // 本命彈出（starv_motion_ui.js）：一般遊戲中每隔 popupEveryMs（現實毫秒）在遊戲畫面右下角播放本命目前最高等級的動作
    // popupLoops 輪後關閉；面積最多佔可見遊戲畫面的 popupArea
    popupEveryMs: 60000, popupLoops: 2, popupArea: 1 / 4
  };
  D.MOTION.BY_ID = {};
  D.MOTION.STARTERS.forEach(function (s) { D.MOTION.BY_ID[s.id] = s; });
})();
