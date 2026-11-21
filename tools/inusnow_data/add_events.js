// イヌスノー（狗雪）Slopestyle 與 Snowboard Cross 的選段（docs/inusnow_design.md §17.1）。
// 不連網：讀已提交的雪場 JSON 與格網高度，選出區段後另存成雪道 <原id>sl／<原id>cx，寫進 events.slope／events.cross，
// 並更新 index.json。可以重複執行（會先移除上次加的 sl／cx 雪道）。
//   node tools/inusnow_data/add_events.js
"use strict";
var fs = require("fs");
var path = require("path");

var SRC = path.join(__dirname, "..", "..", "static_src");
var DATA = path.join(SRC, "inusnow", "data");
var D = require(path.join(SRC, "inusnow_data.js"));
var T = require(path.join(SRC, "inusnow_terrain.js"));

var STEP = 10;
var DEG = Math.PI / 180;
var RULE = {
  slope: { lenMin: 400, lenMax: 650, avgMin: Math.tan(10 * DEG), avgMax: Math.tan(18 * DEG), win: 60, winMin: Math.tan(6 * DEG), width: 30, parkLenMin: 450 },
  cross: { lenMin: 700, lenMax: 1100, dropMin: 120, dropMax: 280, win: 80, winMin: Math.tan(5 * DEG), width: 30 },
};

function r1(v) { return Math.round(v * 10) / 10; }

// 雪道以 10 m 重新取樣：[{x, z, h}]
function resample(t, p) {
  var pts = p.pts, out = [], cum = [0];
  for (var i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  var len = cum[cum.length - 1], k = 0;
  for (var s = 0; s <= len; s += STEP) {
    while (k < pts.length - 2 && cum[k + 1] < s) k++;
    var seg = cum[k + 1] - cum[k], u = seg > 0 ? (s - cum[k]) / seg : 0;
    var x = pts[k][0] + (pts[k + 1][0] - pts[k][0]) * u, z = pts[k][1] + (pts[k + 1][1] - pts[k][1]) * u;
    out.push({ x: x, z: z, h: T.height(t, x, z) });
  }
  return out;
}

function windowsOk(rs, i, j, win, minSlope) {
  var n = win / STEP;
  for (var a = i; a + n <= j; a++) if ((rs[a].h - rs[a + n].h) / win < minSlope) return false;
  return true;
}

function turning(rs, i, j) {
  var sum = 0;
  for (var a = i + 1; a < j; a++) {
    var h1 = Math.atan2(rs[a].x - rs[a - 1].x, rs[a].z - rs[a - 1].z), h2 = Math.atan2(rs[a + 1].x - rs[a].x, rs[a + 1].z - rs[a].z);
    var d = h2 - h1;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    sum += Math.abs(d);
  }
  return sum;
}

// 急彎（30 m 內方向變化 > 60°）會讓 Cross 的選手停住，所以不選有急彎的區段
function hairpin(rs, i, j) {
  for (var a = i; a + 3 <= j; a++) {
    var h1 = Math.atan2(rs[a + 1].x - rs[a].x, rs[a + 1].z - rs[a].z), h2 = Math.atan2(rs[a + 3].x - rs[a + 2].x, rs[a + 3].z - rs[a + 2].z);
    var d = Math.abs(h2 - h1);
    if (d > Math.PI) d = 2 * Math.PI - d;
    if (d > 60 * DEG) return true;
  }
  return false;
}

function isPark(p) {
  var n = p.name || {};
  return /パーク|Park|PARK|park/.test((n.ja || "") + " " + (n.en || "") + " " + (n.zh || ""));
}

function pickSlope(t, pistes) {
  var R = RULE.slope, best = null;
  pistes.forEach(function (p) {
    if (p.width < R.width) return;
    var rs = resample(t, p), park = isPark(p);
    var lenMin = park ? R.parkLenMin : R.lenMin;
    for (var i = 0; i < rs.length; i++) {
      for (var L = lenMin; L <= R.lenMax; L += STEP) {
        var j = i + L / STEP;
        if (j >= rs.length) break;
        var avg = (rs[i].h - rs[j].h) / L;
        if (avg < R.avgMin || avg > R.avgMax) continue;
        if (!windowsOk(rs, i, j, R.win, R.winMin)) continue;
        // 公園名稱優先；其次平均坡度接近 14°、長一點
        var score = (park ? 1000 : 0) - Math.abs(avg - Math.tan(14 * DEG)) * 400 + L / 100;
        if (!best || score > best.score) best = { score: score, p: p, rs: rs, i: i, j: j, park: park };
      }
    }
  });
  return best;
}

function pickCross(t, pistes) {
  var R = RULE.cross, best = null;
  pistes.forEach(function (p) {
    if (p.width < R.width) return;
    var rs = resample(t, p);
    for (var i = 0; i < rs.length; i += 2) {
      for (var L = R.lenMin; L <= R.lenMax; L += 20) {
        var j = i + L / STEP;
        if (j >= rs.length) break;
        var drop = rs[i].h - rs[j].h;
        if (drop < R.dropMin || drop > R.dropMax) continue;
        if (!windowsOk(rs, i, j, R.win, R.winMin) || hairpin(rs, i, j)) continue;
        // 有彎道的雪道優先（方向變化總和），其次長度
        var score = turning(rs, i, j) * 10 + L / 100;
        if (!best || score > best.score) best = { score: score, p: p, rs: rs, i: i, j: j };
      }
    }
  });
  return best;
}

function segPiste(src, suffix, rs, i, j) {
  var pts = [];
  for (var a = i; a <= j; a++) pts.push([r1(rs[a].x), r1(rs[a].z)]);
  var len = 0;
  for (var b = 1; b < pts.length; b++) len += Math.hypot(pts[b][0] - pts[b - 1][0], pts[b][1] - pts[b - 1][1]);
  return { id: src.id + suffix, osm: src.osm, name: src.name, diff: src.diff, width: src.width, len: r1(len), drop: r1(rs[i].h - rs[j].h), pts: pts };
}

function fullCopy(src, suffix) {
  var o = JSON.parse(JSON.stringify(src));
  o.id = src.id.replace(/gs$/, "") + suffix;
  return o;
}

async function main() {
  var index = JSON.parse(fs.readFileSync(path.join(DATA, "index.json"), "utf8"));
  for (var k = 0; k < D.RESORTS.length; k++) {
    var id = D.RESORTS[k], file = path.join(DATA, id + ".json");
    var json = JSON.parse(fs.readFileSync(file, "utf8"));
    json.pistes = json.pistes.filter(function (p) { return !/(sl|cx)$/.test(p.id); });
    var t = await T.load(json);
    var base = json.pistes.filter(function (p) { return !/gs$/.test(p.id); });
    var gs = json.pistes.filter(function (p) { return p.id === json.events.gs.piste; })[0];
    var notes = String(json.notes || "").replace(/\s*\[P2[^\]]*\]/g, "");
    var sl = pickSlope(t, base), cx = pickCross(t, base), slP, cxP;
    if (sl) slP = segPiste(sl.p, "sl", sl.rs, sl.i, sl.j);
    else { slP = fullCopy(gs, "sl"); notes += " [P2 slope: 找不到符合條件的雪道，用大曲道代替]"; }
    if (cx) cxP = segPiste(cx.p, "cx", cx.rs, cx.i, cx.j);
    else { cxP = fullCopy(gs, "cx"); notes += " [P2 cross: 找不到符合條件的雪道，用大曲道代替]"; }
    json.pistes.push(slP, cxP);
    json.events = { gs: json.events.gs, slope: { piste: slP.id }, cross: { piste: cxP.id } };
    json.notes = notes.trim();
    var text = JSON.stringify(json);
    fs.writeFileSync(file, text);
    var item = index.resorts.filter(function (r) { return r.id === id; })[0];
    var info = function (p) { return { piste: p.id, name: p.name, diff: p.diff, len: p.len, drop: p.drop, width: p.width }; };
    item.slope = info(slP); item.cross = info(cxP);
    item.kb = Math.round(Buffer.byteLength(text) / 1024);
    console.log(id + "：slope " + slP.id + " " + (slP.name && slP.name.ja || "") + " " + slP.len + " m／" + slP.drop + " m" + (sl && sl.park ? "（公園）" : "")
      + "；cross " + cxP.id + " " + (cxP.name && cxP.name.ja || "") + " " + cxP.len + " m／" + cxP.drop + " m");
  }
  fs.writeFileSync(path.join(DATA, "index.json"), JSON.stringify(index));
}

main().catch(function (e) { console.error(e); process.exit(1); });
