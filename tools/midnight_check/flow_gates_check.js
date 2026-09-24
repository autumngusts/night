// midnight の「全員が操作するまで次へ進まない」ゲートに、逃げ道があるかを検査する。
//
//   node tools/midnight_check/flow_gates_check.js
//   （または tools/midnight_check で npm run test:flow_gates）
//
// なぜ要るか：midnight の席は切断では解放されない（接手にはパスワードが要る、
// midnight.js performTakeover()）。currentlySeatedSlots() は players[slot] が真かどうかしか
// 見ないので、参加者が1人離線しただけで seatedSlots.every(...) が永久に false のままになり、
// そのイベントは次段へ進めなくなる。
//
// これは実際に繰り返し起きている：
//   2026-09-12 共享池獎勵の投票に時限が無く「板塊の第1層で永久に卡死」（midnight.js:14530〜）
//   2026-09-13 獎勵清單を閉じると［拿取］が二度と出ず、全員が道連れ（midnight.js:15827〜）
// どちらも「transaction で deadline を決め、逾時したら現状のまま先へ進める」で直した。
// 同じ形のゲートを新しく足したときに逃げ道を忘れると、また同じ卡死が生まれる——
// 実行時には例外も警告も出ず、ただ永久に進まないだけなので、静的に検査しておく。
const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(path.resolve(__dirname, "..", "..", "static_src", "midnight.js"), "utf8");
const lines = src.split("\n");

let fail = 0;
function ok(cond, label) {
  console.log((cond ? "  OK   " : "  FAIL ") + label);
  if (!cond) fail++;
}

// 逃げ道が無くてよいゲート。規則書または使用者の明確な指定で「時間制限を設けない」と
// 決まっているものだけをここに挙げる。新しく足すときは必ず理由を書くこと。
const ALLOWED_WITHOUT_ESCAPE = {
  maybeTriggerLobbyCountdown:
    "開始前のロビー。全員が準備を押すまで開始しないのが正しく、まだ誰もゲーム内で待たされていない（準備の取り消しも maybeCancelLobbyCountdown で可能）",
  maybeCancelLobbyCountdown: "上と対。倒數の取り消し側なので、そもそも待ちを作らない",
  maybeTriggerDay3FromReady:
    "使用者明確規格「沒有設時間限制，所有人都按下準備後才開始夜王戰鬥」（midnight.js:11651/11773）。時限を入れると規格違反になる",
};

// 関数の開始行を拾い、指定行がどの関数に属するかを引く。
const fnStarts = [];
lines.forEach((l, i) => {
  const m = /^  function ([A-Za-z_][A-Za-z0-9_]*)/.exec(l);
  if (m) fnStarts.push({ line: i, name: m[1] });
});
function ownerOf(idx) {
  let cur = null;
  for (const f of fnStarts) {
    if (f.line <= idx) cur = f;
    else break;
  }
  return cur;
}
function bodyOf(fn) {
  let end = lines.length;
  for (const f of fnStarts) {
    if (f.line > fn.line) {
      end = f.line;
      break;
    }
  }
  return lines.slice(fn.line, end).join("\n");
}

// 「席（slot）全員ぶんを every で待つ」＝ゲート。
const gateLines = [];
lines.forEach((l, i) => {
  if (/\.every\(function \(slot\)/.test(l)) gateLines.push(i);
});

console.log("[全員待ちゲートの検出]");
ok(gateLines.length > 0, "ゲートを " + gateLines.length + " 箇所検出");

const seen = new Set();
const gates = [];
gateLines.forEach((idx) => {
  const fn = ownerOf(idx);
  if (!fn || seen.has(fn.name)) return;
  seen.add(fn.name);
  gates.push(fn);
});

console.log("[逃げ道（逾時 fallback）の有無]");
gates.forEach((fn) => {
  const body = bodyOf(fn);
  const hasEscape = /stageGateTimedOut|[Dd]eadline|TIMEOUT|Timeout/.test(body);
  const allowed = Object.prototype.hasOwnProperty.call(ALLOWED_WITHOUT_ESCAPE, fn.name);
  if (allowed) {
    ok(true, fn.name + "（逃げ道なしを許可：" + ALLOWED_WITHOUT_ESCAPE[fn.name] + "）");
    return;
  }
  ok(hasEscape, fn.name + " に逾時 fallback がある");
});

console.log("[逾時ヘルパ自体の健全性]");
ok(/function stageGateTimedOut\(pointId, gateKey\)/.test(src), "stageGateTimedOut() がある");
ok(/function clearStageGateDeadline\(pointId, gateKey\)/.test(src), "clearStageGateDeadline() がある");
// deadline は transaction で決めること（rtSet で上書きすると後から来た装置が延長してしまう）。
// 2026-09-23：この deadline は跨裝置で読む共有時間戳なので、起点が Date.now() から
// sharedNow()（伺服器時刻、§8.2）へ変わり、updater 内で使う変数名も now → sharedDeadline に
// なった。縛りたいのは「transaction の first-writer-wins であること」なので、値の作り方には
// 踏み込まず `cur === null ? <何か> : cur` の形だけを見る。
ok(
  /stageDeadlines\/" \+ gateKey, function \(cur\) \{\s*\n\s*return cur === null \? \w+ : cur;/.test(src),
  "deadline は transaction の first-writer-wins で決めている"
);
// 本地節流は boolean ではなく時刻で持つこと（trig が作り直されたとき再送できる＝自己修復）。
ok(/var stageGateDeadlineSentAt = \{\}/.test(src), "本地節流は時刻で持つ（再訪時に自己修復する）");
ok(/STAGE_GATE_DEADLINE_RETRY_MS/.test(src), "再送間隔の上限がある（毎フレーム transaction を送らない）");
// もう一巡する分岐では古い deadline を消すこと（消さないと次の巡回が即逾時になる）。
ok(
  /madnessStageAdvanceAttempted\[key\] = false;[\s\S]{0,200}clearStageGateDeadline\(pt\.id, "madness:" \+ stage\)/.test(src),
  "発狂地帯の再巡回で古い deadline を消している"
);

console.log(fail === 0 ? "\n=== 全テスト通過 ===" : "\n=== 失敗 " + fail + " 件 ===");
process.exit(fail === 0 ? 0 : 1);
