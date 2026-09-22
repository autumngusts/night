// 夜の王の行動決定表（night_boss_rulebook.js の actions）と、auto_gm が実際に引く
// 構造化テーブル（boss_auto_gm_data.js の rows）が食い違っていないかを見る。
//
//   node tools/midnight_check/boss_action_table_check.js
//
// なぜ要るか：auto_gm.js は「構造化テーブルで出目が当たった行の index」で規則書の行を
// 引き、そこから招式名と注釈を取る（rollEnemyAction() の originalRow）。つまり
//   ① 規則書の行のセル数が actionColumns と合っていること
//   ② 規則書の行順と構造化テーブルの行順が同じであること
// の 2 つが崩れると、画面には別の行の招式名が出て、注釈も取れなくなる。
//
// 実際に起きた（2026-09-22 に発見）：harmonia の 4 行と stragedes の 6 行で、2 つある
// 形態欄が 1 セルに潰れていた。セル数が 1 つ足りないので招式名の位置が 1 つずれ、
// 「乱戦ダメージ」列の数値が招式名として表示されていた（「900」「—」「1200＆「腐敗：1D」」）。
// 注釈は列が無くなるので undefined になり、「腐敗：1D」のような属性効果が
// parseElementalAttacksFromAction() に渡らず、そのまま捨てられていた。
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..", "..");
const sandbox = { window: {}, console: { log: function () {}, warn: function () {}, error: function () {} } };
vm.createContext(sandbox);
["night_boss_rulebook.js", "boss_auto_gm_data.js"].forEach(function (f) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, "static_src", f), "utf8"), sandbox, { filename: f });
});
const Rulebook = sandbox.window.PriTestBossRulebook;
const AutoGmData = sandbox.window.PriTestBossAutoGmData;

let fail = 0;
function ok(cond, label) {
  console.log((cond ? "  OK   " : "  FAIL ") + label);
  if (!cond) fail++;
}

function txt(v) {
  if (!v) return "";
  return typeof v === "string" ? v : v.ja || v.zh || "";
}

// "1~2" / "5" / "—" → {min,max} または null
function parseRange(cell) {
  const s = txt(cell).replace(/[^0-9~]/g, "");
  if (!s) return null;
  const m = /^(\d+)~(\d+)$/.exec(s);
  if (m) return { min: +m[1], max: +m[2] };
  if (/^\d+$/.test(s)) return { min: +s, max: +s };
  return null;
}

function sameRange(a, b) {
  if (!a && !b) return true;
  return !!a && !!b && a.min === b.min && a.max === b.max;
}

console.log("[セル数]");
Rulebook.list().forEach(function (boss) {
  const n = boss.actionColumns.length;
  const wrong = boss.actions.filter(function (r) {
    return r.length !== n;
  });
  ok(
    wrong.length === 0,
    boss.id + " の全 " + boss.actions.length + " 行が " + n + " セル" +
      (wrong.length ? "（" + wrong.length + " 行がずれている）" : "")
  );
});

console.log("[規則書と構造化テーブルの行順]");
Rulebook.list().forEach(function (boss) {
  const data = AutoGmData.get(boss.id);
  if (!data) {
    ok(false, boss.id + " の auto_gm データがある");
    return;
  }
  const cols = boss.actionColumns.map(txt);
  const nameIdx = cols.indexOf("アクション名");
  ok(nameIdx !== -1, boss.id + " に「アクション名」列がある");
  let mismatch = 0;
  data.rows.forEach(function (row, i) {
    const raw = boss.actions[i];
    if (!raw) { mismatch++; return; }
    if (data.formAware) {
      const rf = row.rollRangeByForm ? row.rollRangeByForm.fused : null;
      const rs = row.rollRangeByForm ? row.rollRangeByForm.split : null;
      if (!sameRange(parseRange(raw[0]), rf) || !sameRange(parseRange(raw[1]), rs)) mismatch++;
    } else {
      const r = parseRange(raw[0]);
      if (!r || r.min !== row.rollMin || r.max !== row.rollMax) mismatch++;
    }
  });
  ok(
    mismatch === 0,
    boss.id + " の構造化 " + data.rows.length + " 行が規則書と同じ順・同じ出目" +
      (mismatch ? "（" + mismatch + " 行がずれている）" : "")
  );
});

console.log("[出目のある行は必ず構造化されている]");
// 出目欄が「—」の行は 1D で選ばれない特殊行（規則書どおり）。それ以外は auto_gm が
// 引けなければ「規則書にあるのにゲームに出てこない招式」になる。
Rulebook.list().forEach(function (boss) {
  const data = AutoGmData.get(boss.id);
  if (!data) return;
  const cols = boss.actionColumns.map(txt);
  const nameIdx = cols.indexOf("アクション名");
  const formAware = !!data.formAware;
  const missing = [];
  boss.actions.forEach(function (raw, i) {
    const hasRoll = formAware
      ? !!parseRange(raw[0]) || !!parseRange(raw[1])
      : !!parseRange(raw[0]);
    if (!hasRoll) return; // 出目「—」＝GM が条件で使う特殊行
    if (!data.rows[i]) missing.push(txt(raw[nameIdx]));
  });
  ok(missing.length === 0, boss.id + " の出目つき行は全て構造化されている" + (missing.length ? "（欠け: " + missing.join("、") + "）" : ""));
});

console.log(fail === 0 ? "\nすべてOK" : "\n" + fail + " 件 FAIL");
process.exit(fail === 0 ? 0 : 1);
