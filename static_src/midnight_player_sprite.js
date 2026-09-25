(function () {
  // midnight（即時制）的**玩家操作角色** sprite 表現層。
  // 規格：tools/sprite_spec.md「玩家操作角色 sheet」
  // 設計文件：docs/superpowers/specs/2026-09-21-midnight-sprite-combat-design.md
  //
  // 敵人側（midnight_sprite.js）と同じ三層解耦の約束を守る：ここは「今どの幀を出すか」
  // だけを知っていて、傷害計算にも命中判定にも一切関与しない。呼び出し端が
  // 「この操作が起きた」と告げるだけで、遊戲状態はここからは読まない。
  //
  // 敵人側と分けた理由：
  //   ・sheet の行数が違う（敵人 6×8／玩家 6×10）。SHEET_ROWS を共用すると全格ずれる。
  //   ・敵人は「1 種類の敵が N 体」＝全員同じ sheet・同じ動作。玩家は「N 人が別々の
  //     角色類型で、別々の動作を同時に再生する」——面ごとに sheet と時間軸を持つ必要がある。
  // 共通化できるのは backgroundPosition の算術くらいで、そこを無理に括ると
  // どちらの都合も満たさない関数が 1 つ増えるだけなので、意図的に別モジュールにしてある。
  var S = window.PriTestPlayerSprite;
  var R = window.PriTestPlayerSpriteRegistry;

  // 玩家が立つ帯の右端＝舞台幅に対する比。舞台は敵人舞台と同じ正方形（幅＝插圖の実寸幅）で、
  // 敵人の絵はその中央あたりに立つ。0.58 までを玩家の持ち場にすると、いちばん前の玩家が
  // 敵人のすこし手前・左に重なって立つ絵になる（使用者明確規格「戰鬥時可以放入敵人的左側」）。
  //
  // **插圖の外（left:-100%）には置けない**：戰鬥面板の祖先 #midnight-hud-bottom-center は
  // overflow-x:hidden なので、枠の外へ出した面は丸ごと切り落とされて画面に出ない
  // （2026-09-25 実測。舞台の矩形は正しく左側に出ているのに何も見えなかった原因）。
  var GROUP_RIGHT = 0.58;
  // 1 面の横幅の上限（舞台幅比）。敵人の 1 格は插圖の幅いっぱい（夜王も雑魚も同じ枠）なので、
  // 同寸で並べると人間が竜と同じ大きさに見える。0.36 は「1 人でも小さすぎない」ところ。
  var FACE_MAX_RATIO = 0.36;
  // 隣の面との間隔（面の幅比）。1 未満＝重ねる。人数が増えるほど 1 面も細くするので、
  // 6 人でも GROUP_RIGHT の帯に必ず収まる（syncLayout() の faceW の式）。
  var FACE_STEP = 0.55;
  var MAX_FACES = 8;

  var stageEl = null;
  var faces = []; // { key, el, sheetFile, animId, startAt, cellPx, cellHPx, aspect }
  var stageW = 0;

  // 產出済みの sheet だけを返す（未產出なら null＝その角色は表示しない）。
  // 敵人側のような代役は立てない：他人の角色の絵が自分の立ち位置に出るのは、
  // 「誰がどこにいるか」を読む画面では何も出ないより混乱する。
  function sheetFileForType(typeId) {
    if (!R || !typeId) return null;
    return R.sheetFileForType(typeId);
  }

  function frameIndexAt(animId, elapsedMs) {
    var a = S.getAnim(animId);
    if (!a || elapsedMs < 0) return null;
    var idx = Math.floor(elapsedMs / a.frameMs);
    if (a.loop) return idx % a.frameCount;
    if (idx >= a.frameCount) return a.hold ? a.frameCount - 1 : null;
    return idx;
  }

  function backgroundPosition(animId, frameIndex, px, cellH) {
    var a = S.getAnim(animId);
    if (!a) return "0px 0px";
    var ch = cellH || px;
    return -(frameIndex * px) + "px " + -(a.row * ch) + "px";
  }

  // ---- 預載（敵人側と同じ理由：sheet は 1 枚 1MB 前後あり、backgroundImage を
  // 設定した瞬間に出したいなら先に読んでおくしかない）----
  var preloaded = {};
  function preload(sheetFile, staticPrefix) {
    if (!sheetFile || preloaded[sheetFile]) return;
    var img = new Image();
    img.src = (staticPrefix || "../static/") + "images/sprites/" + sheetFile;
    preloaded[sheetFile] = img;
  }

  // 1 格の「高さ÷幅」。登錄表に持たせず読み込んだ画像の実寸から割り出すのは敵人側と同じ
  // （画像と二重管理にしない）。今の玩家 sheet は全部正方格なので 1 になるが、
  // 切り直しで横長になっても描画が崩れないようにしておく。
  function cellAspectOf(sheetFile) {
    var img = sheetFile ? preloaded[sheetFile] : null;
    if (!img || !img.naturalWidth || !img.naturalHeight) return 1;
    return (img.naturalHeight / S.SHEET_ROWS) / (img.naturalWidth / S.SHEET_COLS);
  }

  // ---- DOM ----
  //
  // 舞台は敵人舞台とまったく同じ矩形（親 #midnight-field-encounter-image-wrap に重なる
  // 正方形）で、その**左側の帯だけ**を使う（使用者明確規格「戰鬥時可以放入敵人的左側」）。
  // 矩形をそろえてあるので下端＝接地線が敵人と一致する。帯の取り方は syncLayout()、
  // 「なぜ插圖の外に出さないのか」は GROUP_RIGHT のところ。
  function mount(wrapEl) {
    if (!wrapEl || stageEl) return;
    stageEl = wrapEl.ownerDocument.createElement("div");
    stageEl.id = "midnight-player-sprite-stage";
    stageEl.hidden = true;
    wrapEl.appendChild(stageEl);
  }

  function mounted() {
    return !!stageEl;
  }

  function makeFace(doc) {
    var face = doc.createElement("div");
    face.className = "midnight-sprite-face midnight-player-sprite-face";
    return face;
  }

  function findFace(key) {
    for (var i = 0; i < faces.length; i++) {
      if (faces[i].key === key) return faces[i];
    }
    return null;
  }

  // 出演者を party の並びどおりに揃える。
  // party は [{ key, typeId }]（key は tokenId）。並びの先頭が敵人にいちばん近い位置。
  //
  // key で既存の面を引き継ぐ（作り直さない）のが肝：毎影格呼ばれるので、作り直すと
  // 再生中の動畫が毎影格 idle に戻る。人数や顔ぶれが変わったときだけ DOM を触る。
  function setParty(party, staticPrefix) {
    if (!stageEl) return false;
    var doc = stageEl.ownerDocument;
    var wanted = [];
    (party || []).slice(0, MAX_FACES).forEach(function (p) {
      var file = sheetFileForType(p && p.typeId);
      if (!p || !p.key || !file) return; // 未產出の角色類型はこの場に出さない
      wanted.push({ key: p.key, file: file });
    });
    if (!wanted.length) {
      if (!stageEl.hidden) stageEl.hidden = true;
      return false;
    }
    var next = [];
    wanted.forEach(function (w) {
      var face = findFace(w.key);
      if (!face) {
        face = { key: w.key, el: makeFace(doc), sheetFile: null, animId: "idle", startAt: Date.now(), cellPx: 0, cellHPx: 0, aspect: 1 };
        stageEl.appendChild(face.el);
      }
      if (face.sheetFile !== w.file) {
        face.sheetFile = w.file;
        face.el.style.backgroundImage = "url(" + (staticPrefix || "../static/") + "images/sprites/" + w.file + ")";
        face.cellPx = 0; // 縦横比を測り直させる
        preload(w.file, staticPrefix);
      }
      next.push(face);
    });
    // 退場した面を片づける
    faces.forEach(function (f) {
      if (next.indexOf(f) === -1 && f.el.parentNode) f.el.parentNode.removeChild(f.el);
    });
    var reordered = next.length !== faces.length;
    if (!reordered) {
      for (var i = 0; i < next.length; i++) {
        if (next[i] !== faces[i]) { reordered = true; break; }
      }
    }
    faces = next;
    if (reordered) stageW = 0; // 並びが変わったら配置を計算し直す
    stageEl.hidden = false;
    return true;
  }

  function hide() {
    if (stageEl) stageEl.hidden = true;
  }

  // 動作を指示する。priority が今再生中のものより低ければ無視する
  // （player_sprite_data.js の priority、受擊は招式を割り込めるが死亡は何にも割り込まれない）。
  // force を立てると priority を無視して差し替える（同じ動作の再トリガ＝連打時に
  // 先頭から出し直したい場合に使う）。
  function playAnim(key, animId, startAt, force) {
    var face = findFace(key);
    if (!face || !S.getAnim(animId)) return false;
    if (!force && face.animId && face.animId !== "idle") {
      var elapsed = startAt - face.startAt;
      var running = frameIndexAt(face.animId, elapsed) !== null;
      if (running && S.animPriority(animId) < S.animPriority(face.animId)) return false;
    }
    face.animId = animId;
    face.startAt = startAt;
    return true;
  }

  function currentAnimId(key) {
    var face = findFace(key);
    return face ? face.animId : null;
  }

  // 面の寸法と横位置。舞台の幅（＝插圖の幅）が変わったときだけ書き戻す
  // （毎影格 style を書くとレイアウト再計算が走る）。人数が変わったときは setParty() が
  // stageW を 0 に戻すので、同じ入口でやり直される。
  function syncLayout() {
    if (!stageEl || !faces.length) return;
    var boxW = stageEl.offsetWidth || 0;
    // 戰鬥面板が開いた直後の数影格は、親（inline-block）の幅が敵人插圖の読み込み待ちで
    // まだ数十 px しかない。そのまま採寸すると全員が 24px の粒になって左端に重なり、
    // 幅が確定するまでその姿が見えてしまう。確定するまでは何も書かずに次の影格へ送る
    // （#midnight-field-encounter-image の最小表示幅は 140px なので 48 未満は必ず未確定）。
    if (boxW < 48) return;
    if (boxW === stageW) return;
    stageW = boxW;
    var n = faces.length;
    // 帯（0 ～ GROUP_RIGHT）に n 人が FACE_STEP 刻みで重なって収まる最大の面幅。
    // 上限 FACE_MAX_RATIO を超えない範囲で、人数が増えるほど自動的に細くなる。
    var band = boxW * GROUP_RIGHT;
    var faceW = Math.max(24, Math.round(Math.min(boxW * FACE_MAX_RATIO, band / (1 + (n - 1) * FACE_STEP))));
    var step = Math.round(faceW * FACE_STEP);
    faces.forEach(function (face, i) {
      face.aspect = cellAspectOf(face.sheetFile);
      face.cellPx = faceW;
      face.cellHPx = Math.round(faceW * face.aspect);
      // i=0 が帯のいちばん右＝敵人に近い側。奥（左）へ行くほど少しだけ小さく見せたいところ
      // だが、面ごとに幅を変えると接地線もずれるので、同寸のまま重ねるだけにしてある。
      face.el.style.left = Math.max(0, Math.round(band - faceW - i * step)) + "px";
      face.el.style.right = "auto";
      face.el.style.width = faceW + "px";
      face.el.style.height = face.cellHPx + "px";
      face.el.style.bottom = "0px";
      face.el.style.backgroundSize = S.SHEET_COLS * faceW + "px " + S.SHEET_ROWS * face.cellHPx + "px";
      // 後ろの人ほど下に描く（DOM 順は party 順なので z-index で明示する）。
      face.el.style.zIndex = String(MAX_FACES - i);
    });
  }

  function tick(now) {
    if (!stageEl || stageEl.hidden || !faces.length) return;
    syncLayout();
    faces.forEach(function (face) {
      // 画像の読み込みが完了すると縦横比が 1 から実値に変わることがある。その影格で
      // 測り直す（stageW を 0 に戻すと次の syncLayout() が全部書き直す）。
      if (face.cellPx && cellAspectOf(face.sheetFile) !== face.aspect) stageW = 0;
      var idx = frameIndexAt(face.animId, now - face.startAt);
      if (idx === null) {
        face.animId = "idle";
        face.startAt = now;
        idx = 0;
      }
      face.el.style.backgroundPosition = backgroundPosition(face.animId, idx, face.cellPx, face.cellHPx);
    });
  }

  window.PriTestMidnightPlayerSprite = {
    GROUP_RIGHT: GROUP_RIGHT,
    FACE_MAX_RATIO: FACE_MAX_RATIO,
    FACE_STEP: FACE_STEP,
    sheetFileForType: sheetFileForType,
    frameIndexAt: frameIndexAt,
    backgroundPosition: backgroundPosition,
    cellAspectOf: cellAspectOf,
    preload: preload,
    mount: mount,
    mounted: mounted,
    setParty: setParty,
    hide: hide,
    playAnim: playAnim,
    currentAnimId: currentAnimId,
    faceCount: function () { return faces.length; },
    tick: tick
  };
})();
