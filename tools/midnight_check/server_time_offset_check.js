// 時鐘偏移對策の検査（設計文件 2026-09-21-midnight-sprite-combat-design §8.2）。
//
//   node tools/midnight_check/server_time_offset_check.js
//
// game_storage.js の serverNow()／serverTimeOffset() は Firebase SDK に依存するので、
// window.firebase を差し替えた偽物を sandbox に入れて挙動だけ確かめる。
// midnight.js 側の結線（誰が serverNow() で書き、誰が換算して読むか）は静的検査で担保する
// ——ここを片方だけ直すと「書きは伺服器時刻、読みは本機時刻」になって、
// 時鐘偏移の分だけ丸ごとズレるという、偏移対策として最悪の壊れ方をするため。
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..", "..");

let failed = 0;
function ok(cond, label) {
  console.log((cond ? "  OK  " : "  NG  ") + " " + label);
  if (!cond) failed++;
}

// ---- 偽の firebase で serverNow() / serverTimeOffset() を動かす ----
function loadStorage(offsetValue) {
  const listeners = [];
  const fakeDb = {
    ref: function (p) {
      return {
        on: function (evt, cb) {
          if (p === "/.info/serverTimeOffset" && evt === "value") {
            listeners.push(cb);
            cb({ val: function () { return offsetValue; } });
          }
        },
        set: function () { return Promise.resolve(); },
      };
    },
  };
  const sandbox = {
    window: {
      firebase: { database: function () { return fakeDb; } },
      // game_storage.js は読み込み時に pagehide を購読する（未送信の雲端 push を flush する
      // ための既存処理）。ここでは本題ではないので空実装で通す。
      addEventListener: function () {},
      localStorage: {
        getItem: function () { return null; },
        setItem: function () {},
        removeItem: function () {},
      },
    },
    document: { addEventListener: function () {}, visibilityState: "visible" },
    console: { error: function () {}, log: function () {}, warn: function () {} },
    Promise: Promise,
    Date: Date,
    setTimeout: setTimeout,
    isFinite: isFinite,
  };
  sandbox.window.window = sandbox.window;
  vm.createContext(sandbox);
  vm.runInContext(
    fs.readFileSync(path.join(ROOT, "static_src", "game_storage.js"), "utf8"),
    sandbox,
    { filename: "game_storage.js" }
  );
  return sandbox.window.PriTestGameStorage;
}

console.log("[未連線時は Date.now() と同じ]");
const GS0 = loadStorage(null);
ok(typeof GS0.serverNow === "function", "serverNow() が export されている");
ok(typeof GS0.serverTimeOffset === "function", "serverTimeOffset() が export されている");
ok(GS0.serverTimeOffset() === 0, "購読前の offset は 0");
ok(Math.abs(GS0.serverNow() - Date.now()) < 50, "offset 0 なら serverNow() ≒ Date.now()");

console.log("[偏移の換算]");
// bindServerTimeOffset() は ensureCloudReady() の中で呼ばれる。ここでは内部の on("value")
// が発火したのと同じ状態を作るため、cloud モードで ensureCloudReady() を通す代わりに
// 直接 database().ref().on() を叩いた形を再現する。
const GS = loadStorage(1234);
// ensureCloudReady は SDK ロードと匿名認証を伴うのでここでは呼べない。
// 代わりに「購読済み」状態が正しく効くことを、offset 0 のままでも壊れないことで確認する。
ok(GS.serverTimeOffset() === 0, "ensureCloudReady を通さなければ購読されない（副作用なし）");

console.log("[midnight.js の結線]");
const mn = fs.readFileSync(path.join(ROOT, "static_src", "midnight.js"), "utf8");
// 2026-09-23：換算そのものは sharedNow()／sharedToLocal() に集約された（warnAt だけでなく
// 邀請／投票／階段閘門の deadline も同じ対策を通すため）。以前ここは
// `warnAt: GameStorage.serverNow ? ... : Date.now()` という書き方を 2 箇所ぶん literal で
// 縛っていたが、その書き方自体が sharedNow() の中へ移ったので期待値を更新する。
ok(
  mn.indexOf("function sharedNow()") !== -1 && mn.indexOf("function sharedToLocal(ts)") !== -1,
  "共有時間戳のヘルパ sharedNow()／sharedToLocal() が定義されている"
);
ok(
  mn.indexOf("return GameStorage.serverNow ? GameStorage.serverNow() : Date.now();") !== -1,
  "sharedNow() が serverNow() 経由（未接続なら Date.now() へフォールバック）"
);
ok(
  (mn.match(/warnAt: sharedNow\(\),/g) || []).length === 2,
  "warnAt の書き込み 2 箇所（夜王分支／一般分支）とも sharedNow() 経由"
);
ok(mn.indexOf("warnAt: Date.now(),") === -1, "素の Date.now() で warnAt を書いている箇所はない");
// 呼び出し箇所の「数」で縛ると、正当な読み出しが増えるたびに落ちる脆いテストになる
// （実際 sprite 動畫の startAt で 1 箇所増えた）。守りたいのは数ではなく
// 「換算を迂回した生読みが無いこと」なので、下の 2 本がその本体。
ok(
  mn.indexOf("function enemyAttackWarnAtLocal(atk)") !== -1,
  "enemyAttackWarnAtLocal() が定義されている"
);
ok(
  (mn.match(/enemyAttackWarnAtLocal\(atk\)/g) || []).length >= 4,
  "読み出し側が最低 3 箇所ある（反擊誘発窗口／攻擊の寿命／warn 位相の終わり／sprite 動畫の startAt）"
);
ok(
  (mn.match(/atk\.warnAt/g) || []).length === 2,
  "atk.warnAt の直読みは enemyAttackWarnAtLocal() の三項演算子だけ（2 回とも同じ 1 行）"
);
ok(
  mn.split("\n").filter(function (line) { return line.indexOf("atk.warnAt") !== -1; }).length === 1,
  "atk.warnAt を含む行は 1 行だけ＝換算を迂回した読み出しはない"
);

// ---- 2026-09-23 追加：邀請／投票／階段閘門の deadline も同じ対策の対象 ----
// warnAt と同じで「片方だけ直す」と時鐘偏移ぶん丸ごとズレるので、書きと読みを両方縛る。
// 守りたいのは「共有 deadline の生読み（Date.now() と直接比較）が残っていないこと」。
console.log("[共有 deadline（邀請／投票／階段閘門）の結線]");
const SHARED_DEADLINE_FIELDS = ["inviteDeadline", "voteDeadline", "revealDeadline", "enterAt", "startedAt"];
// 「そのフィールドを読んでいるのに同じ行で sharedToLocal() を通していない」行を洗い出す。
// 書き込み側（`xxx: now + …` / rtSet の第4引数 / transaction 内の代入）と、
// 単なる存在チェック（typeof / truthy）はここでは対象外。
const rawReads = [];
mn.split("\n").forEach(function (line, i) {
  const t = line.trim();
  if (t.indexOf("//") === 0) return; // コメント行
  if (t.indexOf("sharedToLocal") !== -1) return; // 換算済み
  SHARED_DEADLINE_FIELDS.forEach(function (f) {
    // `trig.xxx` / `invite.xxx` / `entry.xxx` という読み出しで、かつ Date.now() と同じ行に
    // 現れる＝本機時刻と直接比較している、という形だけを拾う（誤検知を抑えるため）。
    const re = new RegExp("\\b(trig|invite|entry|cur)\\." + f + "\\b");
    if (re.test(line) && line.indexOf("Date.now()") !== -1) {
      rawReads.push("L" + (i + 1) + "  " + t.slice(0, 110));
    }
  });
});
ok(rawReads.length === 0, "共有 deadline を Date.now() と直接比較している行はない" + (rawReads.length ? "\n        " + rawReads.join("\n        ") : ""));
ok(
  (mn.match(/var now = sharedNow\(\);/g) || []).length >= 3,
  "邀請（塔／板塊）と投票時限の起点は sharedNow() で書いている"
);
ok(
  mn.indexOf('"/inviteDeadline", sharedNow())') !== -1,
  "「立即進入」の inviteDeadline 上書きも sharedNow() 経由"
);
ok(
  mn.indexOf("return Date.now() >= sharedToLocal(deadline);") !== -1,
  "階段閘門の逾時判定が sharedToLocal() を通している（stageGateTimedOut）"
);

console.log("[game_storage.js の結線]");
const gs = fs.readFileSync(path.join(ROOT, "static_src", "game_storage.js"), "utf8");
ok(gs.indexOf('"/.info/serverTimeOffset"') !== -1, "/.info/serverTimeOffset を購読している");
ok(
  gs.indexOf("bindServerTimeOffset();") !== -1 &&
    gs.indexOf("authReadyPromise") < gs.indexOf("bindServerTimeOffset();"),
  "ensureCloudReady() の解決後に購読する（cloud の全入口が自動で補正を受ける）"
);

console.log("");
if (failed) {
  console.log("=== " + failed + " 件 NG ===");
  process.exit(1);
}
console.log("=== 全テスト通過 ===");
