(function () {
  // midnight（即時制）的敵人 sprite 表現層。
  // 設計文件：docs/superpowers/specs/2026-09-21-midnight-sprite-combat-design.md
  //
  // 跟判定層完全分離（spec §4）——這裡只知道「現在該顯示哪一幀」，完全不參與命中判定；
  // 反過來判定層只讀 enemy_sprite_data.js 的 hitFrame，不碰圖片。所以就算一張圖都還沒
  // 產出，遊戲照樣成立。
  //
  // 從 sheet 切出單幀是靠 CSS 的 background-position（不另外產出切好的檔案），所以
  // cellPx 必須由顯示框的實際寬度推算、不能寫死：桌機與手機的框寬不同，但共用同一張 sheet。
  var S = window.PriTestEnemySprite;
  var R = window.PriTestEnemySpriteRegistry;

  var stageEl = null;
  var stageFaces = []; // 1 体につき 1 枚。分裂した夜王は横に並べる（gladius 3 体／harmonia 9 体）
  var stageCount = 1;
  var current = null; // { animId: string, startAt: number }
  var cellPx = 0;      // 1 格の横幅（舞台の幅そのもの）
  var cellHPx = 0;     // 1 格の高さ。正方形の sheet では cellPx と同じ
  var currentSheet = null;
  var stageAspect = 1; // 1 格の 高さ/幅。正方形なら 1

  // bossForm（"fused"／"split"、midnight.js の trig.bossForm と同じ値）を渡すと、その形態
  // 専用の sheet があればそちらを使う。gladius のように合体形態と分裂形態で見た目が
  // まったく別物になる夜王があるため（登録表側の sheetIdForBoss() が專用 sheet の
  // 產出済み判定まで持っていて、未產出なら既定の boss_<id> を返す）。
  function sheetFileFor(familyId, enemyId, isBoss, bossForm) {
    if (!R) return null;
    var id = isBoss ? R.sheetIdForBoss(enemyId, bossForm) : R.sheetIdForEnemy(familyId, enemyId);
    if (!id) return null;
    var sheet = R.getSheet(id);
    if (!sheet || !sheet.available) return null;
    return sheet.file;
  }

  // 未產出の敵に、產出済みの sheet から 1 枚を割り当てる（使用者明確規格
  // 「剩餘還沒配對的會先隨機抽取一張點陣圖」）。60 組が揃うまでの繋ぎで、
  // 素材が入ったらその敵は自分の sheet に切り替わる。
  //
  // Math.random() は使わない。毎フレーム呼ばれるので、乱数だと同じ敵が 1 影格ごとに
  // 別の生き物に化けてしまう。sheetId のハッシュで決めれば、同じ敵は常に同じ代役になり、
  // かつ全端末で一致する（RTDB に何も同期しなくてよい）。
  //
  // 2026-09-22 使用者明確規格「特別是區分敵人種類 若沒有連結的直接抽選其他敵人 boss另外
  // 抽選其他夜王點陣圖」：代役只在同一種類裡挑——一般敵人（family_*）只從產出済みの
  // family sheet 挑、夜王（boss_*）只從產出済みの boss sheet 挑，不會互相混用。
  // 一般敵人再多一層優先：同系統的另一個變體（family_x_a ↔ family_x_b）若已產出，
  // 優先當代役（同系統的外型最接近）；沒有才退到雜湊抽選。
  // 2026-09-23：個別敵人專屬 sheet（enemy_*）が加わった。代役を選ぶ側から見ると
  // これも「一般敵の絵」なので、boss_* でなければ候補に入れる——BOSS_SHEET_RE の
  // 否定でそのまま拾えるので、ここは足さない。
  // なお sheetIdForEnemy() は專屬 sheet が未產出なら系統 sheet を返すので、ここへ
  // 渡ってくる key は family_* のまま。同系統の別変体を優先する下の分岐は効き続ける。
  var BOSS_SHEET_RE = /^boss_/;
  var FAMILY_VARIANT_RE = /^(family_.+)_([ab])$/;

  function siblingSheetId(sheetId) {
    var m = FAMILY_VARIANT_RE.exec(sheetId || "");
    if (!m) return null;
    return m[1] + "_" + (m[2] === "a" ? "b" : "a");
  }

  function substituteSheetFile(key, isBoss) {
    if (!R || !key) return null;
    var sibling = !isBoss ? R.getSheet(siblingSheetId(key)) : null;
    if (sibling && sibling.available) return sibling.file;
    var avail = R.listSheets().filter(function (s) {
      return s.available && BOSS_SHEET_RE.test(s.id) === !!isBoss;
    });
    if (!avail.length) return null;
    var h = 0;
    for (var i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
    return avail[h % avail.length].file;
  }

  // 本来の sheet が無いときに代役を返す版。呼び出し端が「代役でもよい場面か」を
  // 決められるよう、厳密版（sheetFileFor）とは別の関数にしてある。
  function sheetFileOrSubstitute(familyId, enemyId, isBoss, bossForm) {
    var own = sheetFileFor(familyId, enemyId, isBoss, bossForm);
    if (own) return own;
    if (!R) return null;
    var id = isBoss ? R.sheetIdForBoss(enemyId, bossForm) : R.sheetIdForEnemy(familyId, enemyId);
    return substituteSheetFile(id, !!isBoss);
  }

  function frameIndexAt(animId, elapsedMs) {
    var a = S.getAnim(animId);
    if (!a || elapsedMs < 0) return null;
    var idx = Math.floor(elapsedMs / a.frameMs);
    if (a.loop) return idx % a.frameCount;
    if (idx >= a.frameCount) return a.hold ? a.frameCount - 1 : null;
    return idx;
  }

  // 縦横で 1 格の寸法が違う sheet（横長セル）に対応する（2026-09-22）。
  // cellH を省略すると従来どおり正方形として扱うので、既存の呼び出しは挙動が変わらない。
  function backgroundPosition(animId, frameIndex, px, cellH) {
    var a = S.getAnim(animId);
    if (!a) return "0px 0px";
    var ch = cellH || px;
    return -(frameIndex * px) + "px " + -(a.row * ch) + "px";
  }

  // ---- 以下是 DOM 操作。跟上面的純函式不同，check 腳本驗不到（要 Playwright），
  // 手動確認步驟見計畫的 Task 6 Step 6。----
  //
  // DOM 所有權：這個模組只擁有自己建立的 #midnight-enemy-sprite-stage，絕不去動
  // #midnight-field-encounter-image（那是 midnight.js 的）。夜王分支對名冊裡沒有立繪的
  // 敵人（nameless，劇本10専用）是刻意把 <img> 藏起來的，這裡若順手翻它的 hidden，
  // 就會把前一隻敵人殘留的 src 或空 src 露出來。img 的可見性一律交給呼叫端決定。
  //
  // 2026-09-21 使用者明確規格改版：sprite 不再取代插圖，而是「背景仍舊顯示元圖片，
  // 產生的點陣圖敵人顯示在圖片的頂層」。舞台用 position:absolute 疊在 <img> 正上方
  // （堆疊順序見 style.css 同選擇器的說明），所以呼叫端在 sprite 顯示時也不再去藏 <img>。

  // 舞台の中に「1 格ぶんの面」を置く（2026-09-22）。
  //
  // 舞台そのものは正方形（CSS の aspect-ratio 1/1）で、插圖の上に重ねる位置を決める役。
  // 背景をその正方形に直接貼ると、横長セルの sheet では 1 格より背の高い範囲が見えてしまい、
  // 隣の行（＝別の動作の絵）が上にはみ出して映る。面を 1 格の高さちょうどにして舞台の下端へ
  // 貼り付ければ、見える範囲が必ず 1 格に収まり、しかも接地の位置は正方形のときと変わらない。
  function makeFace(doc) {
    var face = doc.createElement("div");
    face.className = "midnight-sprite-face";
    return face;
  }

  function mount(wrapEl) {
    if (!wrapEl || stageEl) return;
    stageEl = wrapEl.ownerDocument.createElement("div");
    stageEl.id = "midnight-enemy-sprite-stage";
    stageEl.hidden = true;
    stageFaces = [];
    wrapEl.insertBefore(stageEl, wrapEl.firstChild);
    ensureFaces(1);
  }

  // 表示する体数を count 枚に揃える（2026-09-22 使用者明確規格：三頭犬は分裂すると
  // 「橫排產生三張（三隻各別單頭犬）」、harmonia の第二形態は分身が総勢 9 体）。
  //
  // 1 体のときは従来どおり舞台いっぱいに 1 枚。複数のときは舞台の幅を頭数で割って
  // 横一列に並べる——数が増えるほど 1 体は小さくなるが、「何体いるか」が一目で分かる
  // ほうが戰鬥の情報として要る。接地は全員そろえる（下端合わせ）。
  function ensureFaces(count) {
    if (!stageEl) return;
    var doc = stageEl.ownerDocument;
    while (stageFaces.length < count) {
      var face = makeFace(doc);
      stageEl.appendChild(face);
      stageFaces.push(face);
    }
    while (stageFaces.length > count) {
      var extra = stageFaces.pop();
      if (extra.parentNode) extra.parentNode.removeChild(extra);
    }
  }

  function showStatic() {
    if (stageEl) stageEl.hidden = true;
    current = null;
    syncWrapMinHeight(0); // 舞台收起就放掉撐高（見 syncCellPx() 說明）
  }

  // sheet 是橫6幀 × 縱8動作，以顯示框的一邊當作1格的實際尺寸。
  // 視窗縮放／手機轉向後框寬會變，所以要能重算；但 backgroundSize 只在寬度真的變了
  // 才寫回 DOM，避免每一影格都觸發樣式重算。
  function syncCellPx() {
    if (!stageEl || !stageFaces.length) return;
    var boxW = stageEl.offsetWidth || 128;
    var n = stageFaces.length;
    // 5 体までは横一列。それを超えると 1 体が細くなりすぎるので 2 段に組む
    // （9 体なら後列 4＋前列 5）。後列は少し上げて中央へ寄せ、群れに見せる。
    var cols = n <= 5 ? n : Math.ceil(n / 2);
    var backCount = n - cols;
    var px = Math.floor(boxW / cols);
    var aspect = cellAspectOf(currentSheet);
    if (px === cellPx && aspect === stageAspect) return;
    cellPx = px;
    stageAspect = aspect;
    cellHPx = Math.round(px * aspect);
    stageFaces.forEach(function (face, i) {
      var isBack = i < backCount;
      var col = isBack ? i : i - backCount;
      var offset = isBack ? Math.round(px / 2) : 0;
      face.style.left = col * px + offset + "px";
      face.style.right = "auto";
      face.style.width = px + "px";
      face.style.height = cellHPx + "px";
      face.style.bottom = (isBack ? Math.round(cellHPx * 0.45) : 0) + "px";
      face.style.backgroundSize = S.SHEET_COLS * cellPx + "px " + S.SHEET_ROWS * cellHPx + "px";
    });
    // 2026-09-22 使用者明確規格「點陣圖會蓋過敵人名稱，敵人名稱一定顯示在點陣圖之下」：
    // 舞台是以插圖為中心的正方形（寬＝插圖寬），插圖是橫向時舞台會上下溢出、蓋到容器下方的
    // 名稱。把容器撐到「舞台高度」與「最高的那一體（後列會再抬高 0.45 格）」之間較大者，
    // 名稱就一定排在點陣圖下面。
    var tallest = backCount ? cellHPx + Math.round(cellHPx * 0.45) : cellHPx;
    syncWrapMinHeight(Math.max(stageEl.offsetHeight || boxW, tallest));
  }

  function syncWrapMinHeight(px) {
    var wrap = stageEl && stageEl.parentElement;
    if (!wrap) return;
    var value = px ? px + "px" : "";
    if (wrap.style.minHeight !== value) wrap.style.minHeight = value;
  }

  // 回傳 true＝sprite 舞台已顯示（疊在插圖之上）；
  // 回傳 false＝顯示不了（例如 stageEl 還沒 mount），呼叫端要改叫 showStatic() 收掉舞台。
  // 不論回傳什麼，呼叫端都不該去動 <img> 的 hidden——插圖一律留著當背景。
  function showSprite(sheetFile, staticPrefix, count) {
    if (!stageEl) return false;
    var n = Math.max(1, Math.min(12, Math.round(count || 1)));
    if (n !== stageCount) {
      stageCount = n;
      cellPx = 0; // 頭数が変われば 1 体の幅も変わる
    }
    ensureFaces(n);
    var url = "url(" + (staticPrefix || "../static/") + "images/sprites/" + sheetFile + ")";
    stageFaces.forEach(function (face) {
      face.style.backgroundImage = url;
    });
    stageEl.hidden = false;
    currentSheet = sheetFile;
    preload(sheetFile, staticPrefix); // セルの縦横比を読むため、Image を必ず 1 つ持っておく
    cellPx = 0; // 縦横比が変わるので強制的に測り直す
    syncCellPx();
    playAnim("idle", Date.now());
    return true;
  }

  // 今どの動畫を再生中か。呼び出し端が「受擊で攻擊モーションを中斷してよいか」を
  // 判断するために要る——攻擊モーションは階段3で命中タイミングの予告そのものになるので、
  // プレイヤーが殴るたびに hurt で潰れると予告として機能しなくなる。
  function currentAnimId() {
    return current ? current.animId : null;
  }

  function playAnim(animId, startAt) {
    if (!S.getAnim(animId)) return;
    current = { animId: animId, startAt: startAt };
  }

  // ---- 死亡小視窗（2026-09-22 使用者明確規格「在右上角縮小比較小的視窗播放死亡動畫」）----
  // 敵人 HP 歸零的同一影格，戰鬥面板就會被收掉（activeEncounter 變 null），主舞台上的
  // death 動畫根本來不及被看到。改成擊破時在呼叫端指定的容器（右上 HUD 那一欄的最後一個
  // 子元素，不蓋任何內容）開一個小舞台，獨立播完 death＋停留後自動隱藏。
  // 跟主舞台完全獨立：各自有自己的 sheet／格寬／時間軸，主舞台被 showStatic() 收掉也不影響。
  var deathEl = null;
  var deathFace = null;
  var deathPlay = null; // { startAt, until }
  var deathCellPx = 0;
  var deathCellH = 0;
  var deathAspect = 1;
  var DEATH_POPUP_LINGER_MS = 700; // death 最後一幀（hold）多停這麼久再收掉

  function mountDeathPopup(containerEl) {
    if (!containerEl || deathEl) return;
    deathEl = containerEl.ownerDocument.createElement("div");
    deathEl.id = "midnight-enemy-death-popup";
    deathEl.hidden = true;
    deathFace = makeFace(containerEl.ownerDocument);
    deathEl.appendChild(deathFace);
    containerEl.appendChild(deathEl);
  }

  function playDeathPopup(sheetFile, staticPrefix, now) {
    if (!deathEl || !deathFace || !sheetFile) return false;
    deathFace.style.backgroundImage =
      "url(" + (staticPrefix || "../static/") + "images/sprites/" + sheetFile + ")";
    deathEl.hidden = false;
    deathCellPx = 0; // 強制重算 backgroundSize（元素剛從 hidden 變可見）
    preload(sheetFile, staticPrefix);
    deathPlay = {
      startAt: now,
      until: now + S.animTotalMs("death") + DEATH_POPUP_LINGER_MS,
      sheet: sheetFile,
    };
    tickDeathPopup(now);
    return true;
  }

  function tickDeathPopup(now) {
    if (!deathEl || !deathFace || !deathPlay) return;
    if (now >= deathPlay.until) {
      deathEl.hidden = true;
      deathPlay = null;
      return;
    }
    var px = deathEl.offsetWidth || 96;
    var aspect = cellAspectOf(deathPlay.sheet);
    if (px !== deathCellPx || aspect !== deathAspect) {
      deathCellPx = px;
      deathAspect = aspect;
      deathCellH = Math.round(px * aspect);
      deathFace.style.height = deathCellH + "px";
      deathFace.style.backgroundSize = S.SHEET_COLS * px + "px " + S.SHEET_ROWS * deathCellH + "px";
    }
    var idx = frameIndexAt("death", now - deathPlay.startAt);
    if (idx === null) idx = S.getAnim("death").frameCount - 1;
    deathFace.style.backgroundPosition = backgroundPosition("death", idx, px, deathCellH);
  }

  // ---- 夜王を倒したときの中央演出（2026-09-22 使用者明確規格「擊破後不用再右上角播放
  // 死亡動畫：打贏這個就是遊戲勝利故直接在中間展示動畫，且死亡動畫播放速度極慢」）----
  //
  // 右上の小視窗（playDeathPopup）は一般敵・強敵用。夜王は倒した時点でゲーム勝利なので、
  // 勝利彈窗の中に大きく出す。彈窗は全画面の覆いなので、その中に置かないと隠れてしまう。
  // 再生は DEFEAT_SLOW 倍だけ引き伸ばし、最後の幀で止めたままにする（自動では消さない
  // ——プレイヤーが彈窗を閉じるまで見せる）。
  var DEFEAT_SLOW = 6;
  var defeatEl = null;
  var defeatFaces = [];
  var defeatPlay = null; // { startAt, sheet }
  var defeatCellPx = 0;
  var defeatCellH = 0;
  var defeatAspect = 1;

  function mountDefeatStage(containerEl) {
    if (!containerEl) return;
    if (defeatEl && defeatEl.parentNode === containerEl) return;
    if (defeatEl && defeatEl.parentNode) defeatEl.parentNode.removeChild(defeatEl);
    defeatEl = containerEl.ownerDocument.createElement("div");
    defeatEl.id = "midnight-boss-defeat-stage";
    defeatEl.hidden = true;
    defeatFaces = [];
    containerEl.appendChild(defeatEl);
  }

  function playDefeat(sheetFile, staticPrefix, now, count) {
    if (!defeatEl || !sheetFile) return false;
    var n = Math.max(1, Math.min(12, Math.round(count || 1)));
    var doc = defeatEl.ownerDocument;
    while (defeatFaces.length < n) {
      var face = makeFace(doc);
      defeatEl.appendChild(face);
      defeatFaces.push(face);
    }
    while (defeatFaces.length > n) {
      var extra = defeatFaces.pop();
      if (extra.parentNode) extra.parentNode.removeChild(extra);
    }
    preload(sheetFile, staticPrefix);
    var url = "url(" + (staticPrefix || "../static/") + "images/sprites/" + sheetFile + ")";
    defeatFaces.forEach(function (f) {
      f.style.backgroundImage = url;
    });
    defeatEl.hidden = false;
    defeatCellPx = 0; // 強制的に測り直す
    defeatPlay = { startAt: now, sheet: sheetFile };
    tickDefeat(now);
    return true;
  }

  function hideDefeat() {
    if (defeatEl) defeatEl.hidden = true;
    defeatPlay = null;
  }

  function tickDefeat(now) {
    if (!defeatEl || defeatEl.hidden || !defeatPlay || !defeatFaces.length) return;
    var n = defeatFaces.length;
    var cols = n <= 5 ? n : Math.ceil(n / 2);
    var backCount = n - cols;
    var boxW = defeatEl.offsetWidth || 320;
    var px = Math.floor(boxW / cols);
    var aspect = cellAspectOf(defeatPlay.sheet);
    if (px !== defeatCellPx || aspect !== defeatAspect) {
      defeatCellPx = px;
      defeatAspect = aspect;
      defeatCellH = Math.round(px * aspect);
      defeatEl.style.height = Math.round(defeatCellH * (n <= 5 ? 1 : 1.45)) + "px";
      defeatFaces.forEach(function (face, i) {
        var isBack = i < backCount;
        var col = isBack ? i : i - backCount;
        face.style.left = col * px + (isBack ? Math.round(px / 2) : 0) + "px";
        face.style.right = "auto";
        face.style.width = px + "px";
        face.style.height = defeatCellH + "px";
        face.style.bottom = (isBack ? Math.round(defeatCellH * 0.45) : 0) + "px";
        face.style.backgroundSize = S.SHEET_COLS * px + "px " + S.SHEET_ROWS * defeatCellH + "px";
      });
    }
    // 「極慢」：経過時間を DEFEAT_SLOW で割って幀を引く。最後の幀（death は hold）で止まる。
    var idx = frameIndexAt("death", (now - defeatPlay.startAt) / DEFEAT_SLOW);
    if (idx === null) idx = S.getAnim("death").frameCount - 1;
    var pos = backgroundPosition("death", idx, defeatCellPx, defeatCellH);
    defeatFaces.forEach(function (face) {
      face.style.backgroundPosition = pos;
    });
  }

  // ---- 預載（2026-09-22 使用者明確規格「實際遊戲內模式也要確實的出現而不要晚出現」）----
  // sheet 每張 1.4~2.4MB，showSprite() 才設 backgroundImage 的話，圖片載完前舞台是空的。
  // 呼叫端在「遭遇成為候選」（識別資訊準備／進入戰鬥讀條）與等待房抽到模擬敵人時就先
  // 預載；同一個檔名只會建立一次 Image 物件。
  var preloaded = {};
  function preload(sheetFile, staticPrefix) {
    if (!sheetFile || preloaded[sheetFile]) return;
    var img = new Image();
    img.src = (staticPrefix || "../static/") + "images/sprites/" + sheetFile;
    preloaded[sheetFile] = img; // 留住參考，避免被 GC 後瀏覽器又重新要求
  }

  // 1 格の「高さ÷幅」。既定は 1（正方形）。
  //
  // sheet 側にこの値を持たせず、読み込んだ画像の実寸から割り出す：登錄表に縦横比を書くと
  // 画像と二重管理になり、差し替えたときに必ずどちらかが古くなる。画像が読み込まれる前は
  // 1 を返すが、tick() が毎影格 syncCellPx() を呼ぶので、読み込み完了の次の影格で正しい値に
  // 入れ替わる（切り替わるのは backgroundSize だけで、再生位置は崩れない）。
  //
  // 横長セルの sheet がある理由は spec §5.3 を見ること（gladius 分裂形態）。
  function cellAspectOf(sheetFile) {
    var img = sheetFile ? preloaded[sheetFile] : null;
    if (!img || !img.naturalWidth || !img.naturalHeight) return 1;
    return (img.naturalHeight / S.SHEET_ROWS) / (img.naturalWidth / S.SHEET_COLS);
  }

  function tick(now) {
    tickDeathPopup(now);
    tickDefeat(now);
    if (!stageEl || stageEl.hidden || !current) return;
    syncCellPx();
    var idx = frameIndexAt(current.animId, now - current.startAt);
    if (idx === null) {
      playAnim("idle", now);
      idx = 0;
    }
    var pos = backgroundPosition(current.animId, idx, cellPx, cellHPx);
    stageFaces.forEach(function (face) {
      face.style.backgroundPosition = pos;
    });
  }

  window.PriTestMidnightSprite = {
    mountDeathPopup: mountDeathPopup,
    playDeathPopup: playDeathPopup,
    mountDefeatStage: mountDefeatStage,
    playDefeat: playDefeat,
    hideDefeat: hideDefeat,
    defeatSlowFactor: function () { return DEFEAT_SLOW; },
    preload: preload,
    cellAspectOf: cellAspectOf,
    sheetFileFor: sheetFileFor,
    substituteSheetFile: substituteSheetFile,
    sheetFileOrSubstitute: sheetFileOrSubstitute,
    frameIndexAt: frameIndexAt,
    backgroundPosition: backgroundPosition,
    mount: mount,
    showStatic: showStatic,
    showSprite: showSprite,
    spriteCount: function () { return stageCount; },
    playAnim: playAnim,
    currentAnimId: currentAnimId,
    tick: tick
  };
})();
