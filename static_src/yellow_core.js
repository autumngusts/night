// 黃牌 Yellow Card：規則引擎（純邏輯，不碰 DOM；node 也能跑，見 tools/yellow_check/core_check.js）。
// 整局狀態是一個可 JSON 化的物件 st，所有變動都透過 apply(st, ctrl, action)：
//   本機模式 ctrl 一律是 "local"；連線模式由房主代為套用，ctrl＝送出操作的玩家 cid。
//   英雄的 ctrl 欄位決定誰能操作它（hero.ctrl === ctrl）。
//
// 戰場（使用者指定 2026-10-22）：英雄全部站在圓形戰場中心面向外，戰場依人數切成等分的扇形區
// （st.secs[i]＝第 i 區主人的 seat），每區分內圈 near（近距離）與外圈 far（遠距離）。
//   敵人站在誰的扇形區就攻擊誰；那位英雄倒下時改打順時針方向下一位存活的英雄。
//   英雄可以攻擊任何扇形區的敵人，只受射程限制：near＝內圈、far＝外圈、any＝都可以。
//   Boss 站在外圈但體型巨大，任何射程都打得到；不會被擊退或拉近；「近遠效果不同」的卡對 Boss 用外圈效果。
//   近戰敵人在外圈時攻擊會改成「前進」，遠程敵人在內圈時攻擊會改成「後退」——擊退／拉近就是打斷攻擊。
// 2026-10-23 使用者指定（仿 Hellcard，見 docs/yellow_card_design.md）：倒下的英雄戰後不會自動復活，要有人選「復活神殿」；
//   祭壇分 5 種、職業聖地、無盡模式的苦痛修正、影響隊友的遺物、局外進度（開局時帶進來的 h.lv／出發遺物）。
// 敵人的判定點是依體型大小的圓（使用者指定 2026-10-22）。座標由 layout() 統一計算，畫面與「指定範圍卡」
// （tgt:"area"，把範圍圈放在戰場上）的命中判定共用同一套；全範圍卡（內圈／外圈／全場）不看位置。
(function () {
  "use strict";

  var root = typeof window !== "undefined" ? window : globalThis;
  var D = root.PriTestYellowData;

  // 升級時數值會加成的 op（n 欄位）
  var BOOST_OPS = { dmg: 1, dmgAll: 1, dmgSec: 1, dmgExec: 1, dmgMissing: 1, dmgSpirit: 1, dmgMel: 1, lifesteal: 1, hexDmg: 1,
    blk: 1, blkAlly: 1, blkAll: 1, blkSpirit: 1, heal: 1, healAll: 1, regen: 1, st: 1, stAll: 1, pow: 1, trap: 1, sac: 1, finale: 1 };
  var NO_BOOST_POW = { mana: 1, spiritTurn: 1, melTurn: 1, drawTurn: 1, chiAtk: 1, chiTurn: 1, potionTurn: 1, potionStart: 1, adv: 1, luck: 1, formDraw: 1 };
  var NEG_STATUS = ["weak", "vuln", "poison", "burn"];
  var DEBUFF_TYPES = ["weak", "vuln", "poison", "burn", "stun"];
  var MAX_ENEMIES = 14;
  var LOG_MAX = 120;
  var SPIRIT_DMG = 2;

  // ---------------- 亂數（mulberry32，狀態存在 st.seed 才能存檔／同步） ----------------
  function rnd(st) {
    var t = (st.seed = (st.seed + 0x6D2B79F5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function rint(st, n) { return Math.floor(rnd(st) * n); }
  function pick(st, arr) { return arr[rint(st, arr.length)]; }
  function shuffle(st, arr) {
    for (var i = arr.length - 1; i > 0; i--) { var j = rint(st, i + 1); var x = arr[i]; arr[i] = arr[j]; arr[j] = x; }
    return arr;
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  // ---------------- 卡牌 ----------------
  // 升級：有 up 就照 up 覆寫；沒有就把可加成的數值 +30%（至少 +1），都沒有可加成的數值時費用 −1
  function boostList(list) {
    var boosted = false;
    (list || []).forEach(function (f) {
      // 巢狀效果（消耗氣、延遲、賭局的勝負）
      ["fx", "win", "lose"].forEach(function (k) { if (f[k] && boostList(f[k])) boosted = true; });
      if (!BOOST_OPS[f.o] || typeof f.n !== "number" || f.s === "stun" || (f.o === "pow" && NO_BOOST_POW[f.p])) return;
      f.n += Math.max(1, Math.ceil(f.n * 0.3));
      boosted = true;
    });
    return boosted;
  }
  function cardDef(c) {
    var base = D.CARD[c.id];
    if (!base) return null;
    if (!c.up) return base;
    var d = clone(base);
    if (base.up) {
      Object.keys(base.up).forEach(function (k) { d[k] = clone(base.up[k]); });
    } else {
      var b1 = boostList(d.fx), b2 = boostList(d.near), b3 = boostList(d.far), b4 = false;
      Object.keys(d.forms || {}).forEach(function (k) { if (boostList(d.forms[k])) b4 = true; });
      if (!b1 && !b2 && !b3 && !b4 && d.cost > 0) d.cost -= 1;
    }
    return d;
  }

  function newCard(st, id) { st.uid += 1; return { u: st.uid, id: id }; }

  // ---------------- 查詢 ----------------
  function heroes(st) { return st.heroes.filter(function (h) { return !!h; }); }
  function alive(st) { return heroes(st).filter(function (h) { return !h.down; }); }
  function hero(st, seat) { return st.heroes[seat] || null; }
  function enemy(st, u) { for (var i = 0; i < st.enemies.length; i++) if (st.enemies[i].u === u) return st.enemies[i]; return null; }
  function sectorCount(st) { return st.secs.length; }
  function secOf(st, seat) { return st.secs.indexOf(seat); }
  function secOwner(st, sec) { return hero(st, st.secs[sec]); }
  function isBoss(e) { var d = D.ENEMY[e.id]; return !!(d && d.boss); }
  // 遺物效果加總（fx 的數值欄位）
  function relicSum(h, key) {
    var n = 0;
    (h.relics || []).forEach(function (id) { var r = D.RELIC[id]; if (r && typeof r.fx[key] === "number") n += r.fx[key]; });
    return n;
  }
  // 「近遠效果不同」的卡要看目標在哪一圈：Boss 算外圈
  function ringOf(e) { return isBoss(e) ? "far" : e.ring; }

  // 某射程打得到的敵人（任何扇形區）
  function inRange(st, rng) {
    return st.enemies.filter(function (e) {
      if (e.hp <= 0) return false;
      if (!rng || rng === "any" || isBoss(e)) return true;
      return e.ring === rng;
    });
  }

  // ---------------- 戰場幾何 ----------------
  // 座標：圓形戰場直徑 100、中心 (50,50)；角度 0＝正上方、順時針。半徑：中心英雄區／內外圈分界／外緣，
  // 以及敵人站的內圈、外圈半徑與英雄的位置
  // （2026-10-22 使用者指定：英雄區縮成原本的 1/3，內外圈往中心延伸）
  var GEO = { core: 7, mid: 28, edge: 49.5, near: 17.5, far: 38.75, hero: 5.2 };
  function polar(deg, r) {
    var rad = (deg - 90) * Math.PI / 180;
    return { x: 50 + r * Math.cos(rad), y: 50 + r * Math.sin(rad) };
  }
  function secSpan(st) { return 360 / sectorCount(st); }
  // 第 i 區的起始角度：第 0 區置中於正上方
  function secStart(st, i) { var span = secSpan(st); return i * span - span / 2; }
  function enemyRadius(e) {
    var d = D.ENEMY[e.id];
    var k = (d && d.size) || (d && d.boss ? "boss" : d && d.elite ? "l" : "m");
    return D.ENEMY_R[k] || D.ENEMY_R.m;
  }
  // 所有敵人與英雄的位置：{ e: { uid: {x,y,r} }, h: { seat: {x,y} } }。敵人依扇形區與內外圈平均分布在弧上
  function layout(st) {
    var n = sectorCount(st), out = { e: {}, h: {} };
    for (var i = 0; i < n; i++) {
      ["near", "far"].forEach(function (ring) {
        var list = st.enemies.filter(function (e) { return e.sec === i && e.ring === ring; });
        var span = secSpan(st), start = secStart(st, i);
        list.forEach(function (e, j) {
          var ang = n === 1 ? (360 * j / Math.max(1, list.length)) : start + span * (j + 1) / (list.length + 1);
          var p = polar(ang, ring === "near" ? GEO.near : GEO.far);
          out.e[e.u] = { x: p.x, y: p.y, r: enemyRadius(e) };
        });
      });
    }
    st.secs.forEach(function (seat, i) {
      out.h[seat] = n === 1 ? { x: 50, y: 50 } : polar(secStart(st, i) + secSpan(st) / 2, GEO.hero);
    });
    return out;
  }
  // 指定範圍卡放在 (x, y) 時打到的敵人：判定圓與範圍圈重疊，而且在射程內
  function areaHits(st, d, x, y) {
    var R = D.AREA_R[d.ar] || D.AREA_R.m;
    var pos = layout(st).e;
    return inRange(st, d.rng).filter(function (e) {
      var p = pos[e.u];
      if (!p) return false;
      var dx = p.x - x, dy = p.y - y;
      return Math.sqrt(dx * dx + dy * dy) <= R + p.r;
    });
  }

  // 敵人實際會做的事（顯示預測與執行共用）：暈眩／近戰在外圈只能前進／遠程在內圈只能後退
  function effActs(st, e) {
    var def = D.ENEMY[e.id];
    if (e.st.stun > 0) return [{ k: "stun" }];
    var acts = e.intent || [];
    var hasAtk = acts.some(function (a) { return a.k === "atk"; });
    if (hasAtk && def.kind === "melee" && e.ring === "far") return acts.filter(function (a) { return a.k !== "atk"; }).concat([{ k: "move", to: "near" }]);
    if (hasAtk && def.kind === "ranged" && e.ring === "near") return acts.filter(function (a) { return a.k !== "atk"; }).concat([{ k: "move", to: "far" }]);
    return acts;
  }

  function adjacentSec(st, a, b) {
    var n = sectorCount(st);
    if (a === b || n <= 3) return true;
    return (a + 1) % n === b || (b + 1) % n === a;
  }

  // 挑釁中的英雄：敵人所在扇形區或相鄰區的挑釁者（自己區優先）
  function taunter(st, e) {
    var list = alive(st).filter(function (h) { return h.taunt; });
    if (!list.length) return null;
    var own = list.filter(function (h) { return secOf(st, h.seat) === e.sec; });
    if (own.length) return own[0];
    var adj = list.filter(function (h) { return adjacentSec(st, secOf(st, h.seat), e.sec); });
    return adj.length ? adj[0] : null;
  }

  // 自己扇形區的英雄；倒下時順時針找下一位存活者
  function laneTarget(st, e) {
    var n = sectorCount(st);
    for (var k = 0; k < n; k++) {
      var h = secOwner(st, (e.sec + k) % n);
      if (h && !h.down) return h;
    }
    return null;
  }

  // 一個 act 會打到哪些英雄（seat 陣列）
  function actTargets(st, e, act) {
    var a = alive(st);
    if (!a.length) return [];
    var tgt = act.tgt || "lane";
    if (tgt === "all") return a.map(function (h) { return h.seat; });
    var tt = taunter(st, e);
    if (tt) return [tt.seat];
    if (tgt === "low") {
      var low = a.slice().sort(function (x, y) { return (x.hp - y.hp) || (x.seat - y.seat); })[0];
      return [low.seat];
    }
    if (tgt === "rand") {
      var p = hero(st, act.pick);
      return [(p && !p.down ? p : a[0]).seat];
    }
    var l = laneTarget(st, e);
    return l ? [l.seat] : [];
  }

  // 人數縮放：Boss 的攻擊在少人時會全部集中在同一人身上，所以傷害依人數打折；
  // 一般敵人每區各一組，人數多時隊友互相支援較容易，血量略增。數值由 tools/yellow_check/balance_check.js 調整
  var BOSS_HP_BY_PARTY = [0, 0.55, 1.2, 2.3, 4.0];
  var BOSS_DMG_BY_PARTY = [0, 0.5, 0.75, 1, 1.15];
  var HP_BY_PARTY = [0, 0.9, 1, 1.2, 1.6];
  // 幕數成長（加入遺物、金幣、商店後隊伍變強，2026-10-22 用 balance_check 補回難度；
  // 2026-10-23 拿掉商店與每場固定選卡後隊伍變弱，再用 balance_check 調降）
  var HP_BY_ACT = [0.95, 1.08, 1.2];
  var DMG_BY_ACT = [1, 1.06, 1.12];
  var BOSS_HP_MULT = 1.05;
  function partySize(st) { return Math.max(1, Math.min(4, heroes(st).length)); }
  function actOf(st) { return Math.min(st.act, HP_BY_ACT.length - 1); }
  // 苦痛等級：選第 n 級時 1～n 級全部生效（效果一覽見 D.TORMENTS）
  function tor(st, k) { return (st.torment || 0) >= k; }
  // 無盡模式：第三幕之後的第幾輪（0＝還在前三幕）；敵人池依序輪流用三幕的
  function loopOf(st) { return Math.max(0, st.act - (D.ACTS.length - 1)); }
  function actDef(st) { return D.ACTS[st.act % D.ACTS.length]; }
  function extraHp(st) { return (1 + D.ENDLESS.hp * loopOf(st)) * (tor(st, 1) ? 1.1 : 1) * (1 + tmodVal(st, "hp") / 100); }
  // 目前生效的苦痛修正（無盡模式）加總：n × pw
  function tmodVal(st, id) {
    var v = 0;
    (st.tmods || []).forEach(function (m) { if (m.id === id && D.TMOD[id]) v += D.TMOD[id].n * m.pw; });
    return v;
  }

  function enemyHitValue(st, e, n, seat) {
    var v = (n + (e.str || 0)) * DMG_BY_ACT[actOf(st)] * (1 + D.ENDLESS.dmg * loopOf(st)) * (tor(st, 2) ? 1.1 : 1) * (1 + tmodVal(st, "dmg") / 100);
    if (isBoss(e)) v = v * BOSS_DMG_BY_PARTY[partySize(st)];
    if (e.st.weak > 0) v = v * 0.75;
    var h = hero(st, seat);
    if (h && h.st.vuln > 0) v = v * 1.5;
    return Math.max(0, Math.floor(v));
  }

  // 英雄打出的傷害：力量、鷹眼（打外圈）、指虎（打內圈）、狂戰士的狂熱（生命一半以下）、虛弱、目標易傷
  function heroHitValue(h, n, ring, e) {
    var v = n + (h.str || 0) + (ring === "far" ? (h.pw.far || 0) : 0) + (ring === "near" ? (h.pw.near || 0) : 0) + (h.pw.frenzy && h.hp * 2 <= h.max ? h.pw.frenzy : 0);
    var fb = h.form && D.FORMS[h.form];
    if (fb && fb.ring && fb.ring === ring) v += fb.n;
    if (h.st.weak > 0) v = v * 0.75;
    if (e && e.st.vuln > 0) v = v * 1.5;
    return Math.max(0, Math.floor(v));
  }

  // ---------------- 紀錄 ----------------
  function log(st, entry) {
    st.logSeq += 1;
    entry.i = st.logSeq;
    entry.r = st.round;
    st.log.push(entry);
    if (st.log.length > LOG_MAX) st.log.splice(0, st.log.length - LOG_MAX);
  }
  function eref(e) { return { k: "e", id: e.id, u: e.u }; }
  function href(h) { return { k: "h", s: h.seat }; }

  // ---------------- 傷害・狀態 ----------------
  function hitEnemy(st, e, amount, ignoreBlock) {
    if (e.hp <= 0) return 0;
    var absorbed = 0;
    if (!ignoreBlock) { absorbed = Math.min(e.blk, amount); e.blk -= absorbed; }
    var dmg = amount - absorbed;
    e.hp = Math.max(0, e.hp - dmg);
    log(st, { t: "dmg", to: eref(e), n: dmg, b: absorbed });
    if (e.hp <= 0) log(st, { t: "kill", to: eref(e) });
    return dmg;
  }

  // 英雄的攻擊：計算數值後打，血月（leech）吸血
  function heroAttack(st, h, e, base) {
    if (!e || e.hp <= 0 || h.down) return 0;
    var dealt = hitEnemy(st, e, heroHitValue(h, base, ringOf(e), e), false);
    if (dealt > 0 && h.pw.leech) healHero(st, h, h.pw.leech);
    if (e.hp <= 0 && relicSum(h, "killHeal")) healHero(st, h, relicSum(h, "killHeal"));
    // 接力旗：擊倒別人區域的敵人時，那一區的主人回復
    if (e.hp <= 0 && relicSum(h, "relayHeal")) { var ow = secOwner(st, e.sec); if (ow && ow !== h) healHero(st, ow, relicSum(h, "relayHeal")); }
    // 敵人的荊棘（2026-10-23 使用者指定，Hellcard）：這一擊沒打死就反傷出手的英雄（護盾擋得住）；範圍攻擊、多段攻擊每一下都算
    var th = ((D.ENEMY[e.id] && D.ENEMY[e.id].thorns) || 0) + tmodVal(st, "thorns");
    if (th && e.hp > 0) { log(st, { t: "thorns", to: eref(e), s: h.seat, n: th }); hitHero(st, h, th, false, e); }
    return dealt;
  }

  // src：出手的敵人（畫面依序重播敵人回合時用；敵人行動的紀錄都帶 src）
  function hitHero(st, h, amount, ignoreBlock, src) {
    if (h.down) return 0;
    var absorbed = 0;
    if (!ignoreBlock) { absorbed = Math.min(h.blk, amount); h.blk -= absorbed; }
    var dmg = amount - absorbed;
    h.hp = Math.max(0, h.hp - dmg);
    var entry = { t: "dmg", to: href(h), n: dmg, b: absorbed };
    if (src) entry.src = eref(src);
    log(st, entry);
    // 三枚貝殼：被敵人打掉生命時，其他隊友回復一半（最多 4）
    if (src && dmg > 0 && relicSum(h, "shareHeal")) {
      var share = Math.min(4, Math.floor(dmg / 2));
      alive(st).forEach(function (x) { if (x !== h) healHero(st, x, share); });
    }
    if (h.hp <= 0) { downHero(st, h); if (h.down) return dmg; }
    if (dmg > 0 && h.pw.rage) { h.str += h.pw.rage; log(st, { t: "str", to: href(h), n: h.pw.rage }); }
    return dmg;
  }

  function downHero(st, h) {
    if (relicSum(h, "revive") && !h.revUsed) {
      h.revUsed = true;
      h.hp = Math.max(1, Math.ceil(h.max * 0.25));
      log(st, { t: "relicRevive", to: href(h) });
      return;
    }
    h.down = true; h.hp = 0; h.blk = 0; h.taunt = false; h.done = true;
    h.disc = h.disc.concat(h.hand); h.hand = [];
    log(st, { t: "down", to: href(h) });
    if (!alive(st).length) { st.phase = "lose"; log(st, { t: "lose" }); return; }
    alive(st).forEach(function (x) {
      var n = relicSum(x, "allyDownStr");
      if (n) { x.str += n; log(st, { t: "str", to: href(x), n: n }); healHero(st, x, 8); }
    });
  }

  function healHero(st, h, n) {
    if (h.down || n <= 0) return 0;
    var v = Math.min(n, h.max - h.hp);
    h.hp += v;
    if (v > 0) log(st, { t: "heal", to: href(h), n: v });
    return v;
  }

  function gainBlock(st, h, n) {
    if (h.down || n <= 0) return;
    h.blk += n;
    log(st, { t: "blk", to: href(h), n: n });
  }

  // 對敵人施加狀態；法師／女巫的被動讓燃燒／中毒多 1
  function addStatus(st, e, s, n, h) {
    if (e.hp <= 0 || n <= 0) return;
    if (h && s === "burn" && h.pw.burnPlus) n += h.pw.burnPlus;
    if (h && s === "poison" && h.pw.poisonPlus) n += h.pw.poisonPlus;
    e.st[s] = (e.st[s] || 0) + n;
    log(st, { t: "st", to: eref(e), s: s, n: n });
  }

  // 陷阱（遊俠，2026-10-22 path_check 後改版）：整場戰鬥有效、可疊加，任何敵人進入內圈都會觸發（不會消失），
  // 所以「擊退 → 敵人前進 → 再踩一次」是陷阱路線的核心循環
  function moveEnemy(st, e, ring) {
    if (e.hp <= 0 || isBoss(e) || e.ring === ring) return;
    e.ring = ring;
    log(st, { t: "move", to: eref(e), z: ring });
    if (ring === "near") {
      alive(st).forEach(function (h) {
        if (h.trap > 0 && e.hp > 0) {
          log(st, { t: "trapHit", to: eref(e), s: h.seat });
          hitEnemy(st, e, h.trap, false);
        }
      });
    }
  }

  // 把敵人移到別的扇形區（2026-10-23 使用者指定，Hellcard 的站位）：Boss 不會被移動；單人只有一區，沒有效果
  function shiftEnemy(st, e, sec) {
    if (!e || e.hp <= 0 || isBoss(e) || sectorCount(st) < 2 || e.sec === sec) return;
    e.sec = sec;
    log(st, { t: "shift", to: eref(e), sec: sec });
  }

  // ---- 新英雄的機制（2026-10-22 使用者選定：武僧、德魯伊、時空術士、鍊金術師、賭徒） ----
  // 氣（武僧）：最多 D.MAX_CHI
  function gainChi(h, n) { h.chi = Math.min(D.MAX_CHI, (h.chi || 0) + n); }
  // 藥水（鍊金術師）：0 費、用完消耗的藥水牌放進 to 的手牌；id＝"rand" 時隨機
  function brew(st, h, to, id) {
    if (!to || to.down) return;
    var pid = id === "rand" ? pick(st, D.POTIONS) : id;
    if (!D.CARD[pid]) return;
    if (handFull(to)) to.disc.push(newCard(st, pid)); else to.hand.push(newCard(st, pid));
    log(st, { t: "brew", to: href(to), s: h.seat, c: pid });
  }
  // 擲骰（賭徒）：1～6，幸運加點（最多 6）；老千（adv）擲兩次取高
  function rollDie(st, h, adv) {
    var luck = h.pw.luck || 0;
    var once = function () { return Math.min(6, 1 + rint(st, 6) + luck); };
    var v = once();
    if (adv || h.pw.adv) v = Math.max(v, once());
    log(st, { t: "roll", to: href(h), n: v });
    return v;
  }
  // 延遲效果（時空術士）：下回合開始時發動；記住當時的目標
  function runLater(st, h) {
    var list = h.later || [];
    h.later = [];
    list.forEach(function (x) {
      if (st.phase !== "battle") return;
      var d = D.CARD[x.c] || { fx: [], rng: "any" };
      var te = typeof x.e === "number" ? enemy(st, x.e) : null;
      var ts = typeof x.s === "number" ? hero(st, x.s) : null;
      if (typeof x.e === "number" && (!te || te.hp <= 0)) te = null;
      log(st, { t: "later", to: href(h), c: x.c });
      x.fx.forEach(function (f) { if (st.phase === "battle") runFx(st, h, d, f, te, ts, null); });
      checkWin(st);
    });
  }
  // 從棄牌堆拿回最近的 n 張（時空術士的回溯）
  function recall(st, h, n) {
    var got = 0;
    for (var i = 0; i < n && h.disc.length && !handFull(h); i++) { h.hand.push(h.disc.pop()); got++; }
    if (got) log(st, { t: "recall", to: href(h), n: got });
  }

  function removeDead(st) { st.enemies = st.enemies.filter(function (e) { return e.hp > 0; }); }

  // 精靈攻擊：每隻打自己扇形區的一個隨機敵人，沒有就打任意敵人
  function spiritsAttack(st, h) {
    for (var i = 0; i < h.sp; i++) {
      var live = st.enemies.filter(function (e) { return e.hp > 0; });
      if (!live.length) return;
      var own = live.filter(function (e) { return e.sec === secOf(st, h.seat); });
      var e = pick(st, own.length ? own : live);
      log(st, { t: "spirit", to: eref(e), s: h.seat });
      hitEnemy(st, e, SPIRIT_DMG + (h.pw.spirit || 0), false);
    }
  }

  // ---------------- 牌堆 ----------------
  function handFull(h) { return h.hand.length >= D.HAND_MAX; }
  function drawCards(st, h, n) {
    for (var i = 0; i < n; i++) {
      if (handFull(h)) { log(st, { t: "handFull", to: href(h) }); return; }
      if (!h.draw.length) {
        if (!h.disc.length) return;
        h.draw = shuffle(st, h.disc);
        h.disc = [];
      }
      h.hand.push(h.draw.pop());
    }
  }

  // ---------------- 敵人生成 ----------------
  function spawnEnemy(st, id, sec, ring, hpMult) {
    var def = D.ENEMY[id];
    if (!def || st.enemies.length >= MAX_ENEMIES) return null;
    var hp = Math.round((def.hp[0] + rint(st, def.hp[1] - def.hp[0] + 1)) * (hpMult || 1));
    st.uid += 1;
    var e = { u: st.uid, id: id, hp: hp, max: hp, blk: 0, str: 0, st: { weak: 0, vuln: 0, poison: 0, burn: 0, stun: 0 },
      sec: sec, ring: def.boss ? "far" : (ring || def.spawn || "far"), pi: 0, last: -1, intent: [] };
    st.enemies.push(e);
    return e;
  }

  function chooseIntent(st, e) {
    var def = D.ENEMY[e.id];
    var idx;
    if (def.cyc === "rand" && def.pat.length > 1) {
      do { idx = rint(st, def.pat.length); } while (idx === e.last);
    } else {
      idx = e.pi % def.pat.length;
      e.pi += 1;
    }
    e.last = idx;
    e.intent = clone(def.pat[idx]);
    var a = alive(st);
    e.intent.forEach(function (act) { if (act.tgt === "rand" && a.length) act.pick = pick(st, a).seat; });
  }

  function hpMultFor(st) { return (1 + 0.08 * st.floor) * HP_BY_PARTY[partySize(st)] * HP_BY_ACT[actOf(st)] * extraHp(st); }

  function buildEncounter(st, kind) {
    var act = actDef(st);
    var n = sectorCount(st);
    var mult = hpMultFor(st);
    if (kind === "boss") {
      spawnEnemy(st, act.boss, rint(st, n), "far", BOSS_HP_BY_PARTY[partySize(st)] * BOSS_HP_MULT * (1 + D.ENDLESS.hp * loopOf(st)) * (tor(st, 7) ? 1.2 : 1));
      for (var s = 0; s < n; s++) spawnEnemy(st, act.minion, s, null, HP_BY_ACT[actOf(st)] * extraHp(st));
      return;
    }
    // 每個扇形區的敵人依那一區主人選的目的地（Hellcard 式，使用者指定 2026-10-22）：菁英／較強／一般／較弱
    for (var q = 0; q < n; q++) {
      var owner = secOwner(st, q);
      var dd = owner && D.DEST[owner.dest];
      var foe = dd ? dd.foe : "normal";
      if (foe === "elite") spawnEnemy(st, pick(st, act.elites), q, "far", mult * (tor(st, 3) ? 1.25 : 1));
      else pick(st, act.packs).forEach(function (id) { spawnEnemy(st, id, q, null, mult * (D.FOE_HP[foe] || 1)); });
    }
  }

  // ---------------- 戰鬥流程 ----------------
  function resetBattleFields(h) {
    h.blk = 0; h.str = 0; h.taunt = false; h.done = false; h.sp = 0; h.mel = 0; h.trap = 0;
    h.chi = 0; h.form = null; h.later = []; h.flux = 0; h.rg = 0;
    h.st = { weak: 0, vuln: 0, poison: 0, burn: 0, regen: 0 };
    h.pw = {};
  }

  function startBattle(st, kind) {
    st.phase = "battle";
    st.battleKind = kind;
    st.enemies = [];
    st.round = 1;
    heroes(st).forEach(function (h) {
      h.draw = shuffle(st, clone(h.deck)); h.hand = []; h.disc = []; h.exh = [];
      resetBattleFields(h);
      // 倒下的英雄（等著復活神殿）不參戰
      if (h.down) { h.done = true; return; }
      var cd = D.CLASS[h.cls], ps = cd.passive;
      // 被動＋職業聖地的強化（perk 次 × cd.perk）；extra＝鍊金術師、時空術士的累積型資源
      if (ps) { var pn = ps.n + (h.perk || 0) * (cd.perk || 0); if (ps.p === "spiritStart") h.sp = pn; else h.pw[ps.p] = pn; }
      if (cd.extra) Object.keys(cd.extra).forEach(function (k) { h.pw[k] = (h.pw[k] || 0) + cd.extra[k]; });
      // 祭壇延續到這場戰鬥的效果（契約：魔力不夠改付生命）
      if (h.nextB && h.nextB.blood) h.pw.bloodMana = h.nextB.blood;
      // 遺物的能力類效果
      (h.relics || []).forEach(function (id) {
        var pw = D.RELIC[id] && D.RELIC[id].fx.pw;
        if (pw) Object.keys(pw).forEach(function (k) { h.pw[k] = (h.pw[k] || 0) + pw[k]; });
      });
      h.sp = Math.min(D.MAX_SPIRITS, h.sp + relicSum(h, "spiritStart"));
      h.revUsed = false;
    });
    buildEncounter(st, kind);
    // 苦痛修正：敵人開戰護盾／力量
    st.enemies.forEach(function (e) { e.blk += tmodVal(st, "blk"); e.str += tmodVal(st, "str"); });
    log(st, { t: "battle", kind: kind, act: st.act, floor: st.floor });
    st.enemies.forEach(function (e) { chooseIntent(st, e); });
    alive(st).forEach(function (h) { startHeroTurn(st, h); });
    // 鍊金術師：開戰時多一瓶隨機藥水
    alive(st).forEach(function (h) { for (var i = 0; i < (h.pw.potionStart || 0); i++) brew(st, h, h, "rand"); });
    // 遺物的開戰效果（第一回合的護盾、力量、魔力、抽牌；全隊護盾；敵人虛弱）
    alive(st).forEach(function (h) {
      if (relicSum(h, "battleBlk")) gainBlock(st, h, relicSum(h, "battleBlk"));
      var bs = relicSum(h, "battleStr") + (h.nextB ? h.nextB.str || 0 : 0);
      if (bs) { h.str += bs; log(st, { t: "str", to: href(h), n: bs }); }
      h.nextB = null;
      if (relicSum(h, "partyStr")) alive(st).forEach(function (x) { x.str += relicSum(h, "partyStr"); log(st, { t: "str", to: href(x), n: relicSum(h, "partyStr") }); });
      h.mana = Math.max(0, h.mana + relicSum(h, "firstMana") - (tor(st, 10) ? 1 : 0));
      if (relicSum(h, "firstDraw") > 0) drawCards(st, h, relicSum(h, "firstDraw"));
      if (relicSum(h, "partyBlk")) alive(st).forEach(function (x) { gainBlock(st, x, relicSum(h, "partyBlk")); });
      if (relicSum(h, "enemyWeak")) st.enemies.forEach(function (e) { addStatus(st, e, "weak", relicSum(h, "enemyWeak"), null); });
    });
  }

  function startHeroTurn(st, h) {
    if (h.down || st.phase !== "battle") return;
    h.blk = 0;
    h.done = false;
    h.mana = D.MANA + (h.pw.mana || 0) + relicSum(h, "manaTurn");
    // 時空術士的時能：每回合累積，每 3 點多 1 魔力
    if (h.pw.flux) { h.flux = Math.min(D.MAX_FLUX, (h.flux || 0) + h.pw.flux); h.mana += Math.floor(h.flux / 3); }
    // 守護戒指：生命最低的其他隊友得到護盾
    if (relicSum(h, "allyBlk")) {
      var low = alive(st).filter(function (x) { return x !== h; }).sort(function (a, b) { return a.hp / a.max - b.hp / b.max; })[0];
      if (low) gainBlock(st, low, relicSum(h, "allyBlk"));
    }
    if (h.pw.plate) gainBlock(st, h, h.pw.plate);
    if (h.st.regen > 0) { healHero(st, h, h.st.regen); h.st.regen -= 1; }
    if (h.pw.burnAll) st.enemies.forEach(function (e) { addStatus(st, e, "burn", h.pw.burnAll, null); });
    if (h.pw.poisonAll) st.enemies.forEach(function (e) { addStatus(st, e, "poison", h.pw.poisonAll, null); });
    if (h.pw.healAll) alive(st).forEach(function (x) { healHero(st, x, h.pw.healAll); });
    if (h.pw.melTurn) h.mel = Math.min(D.MAX_MELODY, h.mel + h.pw.melTurn);
    if (h.pw.spiritTurn) h.sp = Math.min(D.MAX_SPIRITS, h.sp + h.pw.spiritTurn);
    if (h.pw.chiTurn) gainChi(h, h.pw.chiTurn);
    if (h.pw.weakAll) st.enemies.forEach(function (e) { addStatus(st, e, "weak", h.pw.weakAll, null); });
    if (h.form && D.FORMS[h.form].blk) gainBlock(st, h, D.FORMS[h.form].blk);
    drawCards(st, h, Math.max(1, D.HAND_SIZE + relicSum(h, "handPlus") + (h.pw.drawTurn || 0)));
    for (var pi = 0; pi < (h.pw.potionTurn || 0); pi++) brew(st, h, h, "rand");
    runLater(st, h);
  }

  // 英雄回合結束：精靈攻擊、紅牌判定、虛無卡消耗、手牌進棄牌堆、自身中毒／燃燒
  function endHeroTurn(st, h) {
    if (h.down) return;
    if (h.sp > 0) spiritsAttack(st, h);
    var yellows = h.hand.filter(function (c) { return c.id === "t_yellow"; });
    if (yellows.length >= 2) {
      log(st, { t: "red", to: href(h) });
      h.hand = h.hand.filter(function (c) { return c.id !== "t_yellow"; });
      h.exh = h.exh.concat(yellows);
      hitHero(st, h, relicSum(h, "redHalf") ? Math.floor(D.RED_CARD_DMG / 2) : D.RED_CARD_DMG, true);
      if (h.down) return;
    }
    var keep = [];
    h.hand.forEach(function (c) { var d = D.CARD[c.id]; if (d && d.ethereal) h.exh.push(c); else keep.push(c); });
    h.disc = h.disc.concat(keep);
    h.hand = [];
    if (h.st.poison > 0) { hitHero(st, h, h.st.poison, true); h.st.poison -= 1; }
    if (!h.down && h.st.burn > 0) { hitHero(st, h, h.st.burn, true); h.st.burn = Math.floor(h.st.burn / 2); }
  }

  function enemyTurn(st, e) {
    if (e.hp <= 0) return;
    e.blk = 0;
    if (e.st.poison > 0) { hitEnemy(st, e, e.st.poison, true); e.st.poison -= 1; }
    if (e.hp > 0 && e.st.burn > 0) { hitEnemy(st, e, e.st.burn, true); e.st.burn = Math.floor(e.st.burn / 2); }
    if (e.hp <= 0) return;
    var acts = effActs(st, e);
    if (e.st.stun > 0) { e.st.stun -= 1; log(st, { t: "stunned", to: eref(e) }); return; }
    acts.forEach(function (act) {
      if (st.phase !== "battle" || e.hp <= 0) return;
      runEnemyAct(st, e, act);
    });
  }

  function runEnemyAct(st, e, act) {
    if (act.k === "atk") {
      actTargets(st, e, act).forEach(function (seat) {
        for (var i = 0; i < (act.h || 1); i++) {
          var h = hero(st, seat);
          if (!h || h.down || e.hp <= 0) return;
          hitHero(st, h, enemyHitValue(st, e, act.n, seat), false, e);
          if (h.pw.thorns && !h.down) hitEnemy(st, e, h.pw.thorns, false);
        }
      });
    } else if (act.k === "blk") {
      (act.all ? st.enemies : [e]).forEach(function (x) { if (x.hp > 0) { x.blk += act.n; log(st, { t: "blk", to: eref(x), n: act.n, src: eref(e) }); } });
    } else if (act.k === "buff") {
      (act.all ? st.enemies : [e]).forEach(function (x) { if (x.hp > 0) { x.str += act.str; log(st, { t: "str", to: eref(x), n: act.str, src: eref(e) }); } });
    } else if (act.k === "heal") {
      (act.all ? st.enemies : [e]).forEach(function (x) {
        var v = Math.min(act.n, x.max - x.hp);
        if (x.hp > 0 && v > 0) { x.hp += v; log(st, { t: "heal", to: eref(x), n: v, src: eref(e) }); }
      });
    } else if (act.k === "debuff") {
      actTargets(st, e, act).forEach(function (seat) {
        var h = hero(st, seat);
        h.st[act.s] = (h.st[act.s] || 0) + act.n;
        h.fresh = h.fresh || {};
        h.fresh[act.s] = true; // 這個敵人回合才施加的，回合結束時先不遞減
        log(st, { t: "st", to: href(h), s: act.s, n: act.n, src: eref(e) });
      });
    } else if (act.k === "curse") {
      actTargets(st, e, act).forEach(function (seat) {
        var h = hero(st, seat);
        for (var i = 0; i < act.n; i++) h.disc.push(newCard(st, act.card));
        log(st, { t: "curse", to: href(h), c: act.card, n: act.n, src: eref(e) });
      });
    } else if (act.k === "yellow") {
      actTargets(st, e, act).forEach(function (seat) {
        var h = hero(st, seat);
        h.draw.splice(rint(st, h.draw.length + 1), 0, newCard(st, "t_yellow"));
        log(st, { t: "yellow", to: href(h), src: eref(e) });
      });
    } else if (act.k === "summon") {
      // Boss 召喚的數量依人數縮放（4 人時照資料，人少時減半以下，至少 1 隻）；其他敵人召喚到自己的扇形區
      var cnt = isBoss(e) ? Math.max(1, Math.ceil(act.n * partySize(st) / 4)) : act.n;
      for (var i = 0; i < cnt; i++) {
        var sec = isBoss(e) ? rint(st, sectorCount(st)) : e.sec;
        var m = spawnEnemy(st, act.id, sec, null, hpMultFor(st));
        if (m) { chooseIntent(st, m); log(st, { t: "summon", to: eref(m), src: eref(e) }); }
      }
    } else if (act.k === "move") {
      moveEnemy(st, e, act.to);
    }
  }

  function decay(obj) {
    ["weak", "vuln"].forEach(function (s) { if (obj.st[s] > 0 && !(obj.fresh && obj.fresh[s])) obj.st[s] -= 1; });
    obj.fresh = null;
  }

  // 全員按了結束回合：英雄回合結束 → 敵人依序行動 → 狀態遞減 → 新意圖 → 英雄新回合
  function resolveRound(st) {
    alive(st).forEach(function (h) { endHeroTurn(st, h); });
    if (st.phase !== "battle") return;
    removeDead(st);
    if (checkWin(st)) return;
    log(st, { t: "enemyTurn" });
    st.enemies.slice().forEach(function (e) {
      if (st.phase === "battle") enemyTurn(st, e);
    });
    if (st.phase !== "battle") return;
    removeDead(st);
    if (checkWin(st)) return;
    st.enemies.forEach(decay);
    heroes(st).forEach(function (h) { decay(h); h.taunt = false; });
    st.round += 1;
    log(st, { t: "round" });
    st.enemies.forEach(function (e) { chooseIntent(st, e); });
    alive(st).forEach(function (h) { startHeroTurn(st, h); });
  }

  function maybeResolve(st) {
    var a = alive(st);
    if (st.phase === "battle" && a.length && a.every(function (x) { return x.done; })) resolveRound(st);
  }

  function checkWin(st) {
    removeDead(st);
    if (st.phase !== "battle" || st.enemies.length) return false;
    var kind = st.battleKind;
    log(st, { t: "win", kind: kind });
    // 2026-10-23 使用者指定（仿 Hellcard）：倒下的英雄戰後不會自動復活，要有存活的英雄選「復活神殿」；Boss 戰打贏則全員復活
    var shrine = kind === "boss" || alive(st).some(function (h) { return h.dest === "shrine"; });
    heroes(st).forEach(function (h) {
      if (h.down && shrine) reviveHero(st, h, kind === "boss" ? 25 : D.SHRINE_PCT);
      h.draw = []; h.hand = []; h.disc = []; h.exh = [];
      resetBattleFields(h);
    });
    if (kind === "boss" && st.act >= D.ACTS.length - 1 && !st.endless) { st.phase = "win"; return true; }
    st.phase = "reward";
    heroes(st).forEach(function (h) {
      if (relicSum(h, "endHeal")) healHero(st, h, relicSum(h, "endHeal"));
      if (relicSum(h, "partyEndHeal") && !h.down) alive(st).forEach(function (x) { if (x !== h) healHero(st, x, relicSum(h, "partyEndHeal")); });
    });
    heroes(st).forEach(function (h) {
      // Boss：先從三件 Boss 遺物選一件，再選卡；一般層：只領自己選的目的地的獎勵（2026-10-23 使用者指定，仿 Hellcard）；倒下的英雄沒有獎勵
      var list = h.down ? [] : kind === "boss" ? bossReward(st, h) : destReward(st, h);
      h.pend = list.shift() || null;
      h.queue = list;
    });
    // 全員都沒有要選的（例如鍛造所但牌全升級過了）：直接到下一層
    if (heroes(st).every(function (x) { return !x.pend; })) nextFloor(st);
    return true;
  }

  // 復活（苦痛 9：只有 1 生命）
  function reviveHero(st, h, pct) {
    h.down = false;
    h.hp = tor(st, 9) ? 1 : Math.max(1, Math.ceil(h.max * pct / 100));
    log(st, { t: "revive", to: href(h) });
  }

  function bossReward(st, h) {
    var opts = [];
    for (var i = 0; i < 3; i++) { var b = randomRelic(st, h, ["boss"], opts); if (b) opts.push(b); }
    var out = opts.length ? [{ k: "relic", opts: opts }] : [];
    out.push({ k: "card", opts: rewardCards(st, h, "boss") });
    return out;
  }

  // 目的地的獎勵（打贏之後）；回傳依序要選擇的 pend 陣列（可能是空的）
  function destReward(st, h) {
    var upN = h.deck.filter(function (x) { return !x.up; }).length;
    switch (h.dest) {
      case "spoils": return [{ k: "card", opts: rewardCards(st, h, "spoils") }];
      case "camp": return [{ k: "rest" }];
      case "smithy": return upN >= 2 ? [{ k: "upgrade" }, { k: "upgrade" }] : upN ? [{ k: "upgrade" }] : [];
      case "altar":
        var al = pickW(st, D.ALTARS).id;
        return [{ k: "altar", a: al, relic: al === "blood" ? randomRelic(st, h, ["common", "uncommon", "uncommon", "rare"]) : null }];
      case "sanctum":
        return [{ k: "sanctum", opts: classRares(st, h, 2) }];
      case "treasure":
        var opts = [];
        for (var i = 0; i < 3; i++) { var r = randomRelic(st, h, ["common", "common", "uncommon", "uncommon", "rare"], opts); if (r) opts.push(r); }
        return opts.length ? [{ k: "relic", opts: opts }] : [];
      case "elite":
        h.max += 5; h.hp += 5;
        var er = randomRelic(st, h, ["common", "uncommon", "uncommon", "rare"]);
        if (er) grantRelic(st, h, er);
        return [{ k: "card", opts: rewardCards(st, h, "elite") }];
    }
    return [];
  }

  // 依 w 權重抽一個
  function pickW(st, list) {
    var total = 0;
    list.forEach(function (x) { total += x.w; });
    var r = rnd(st) * total;
    for (var i = 0; i < list.length; i++) { r -= list[i].w; if (r <= 0) return list[i]; }
    return list[list.length - 1];
  }

  // 已解鎖的卡（局外進度；沒有等級資料＝全部解鎖）
  function unlocked(h, c) { return !c.lv || c.lv <= (typeof h.lv === "number" ? h.lv : 99); }
  // 職業聖地：本職業不重複的稀有卡 n 張
  function classRares(st, h, n) {
    var pool = shuffle(st, D.CARDS.filter(function (c) { return c.cls === h.cls && c.rar === "rare" && unlocked(h, c); }));
    return pool.slice(0, n).map(function (c) { return c.id; });
  }

  // ---------------- 遺物 ----------------

  // rars 可以重複列出來加權；不會給已經有的遺物
  function randomRelic(st, h, rars, exclude) {
    var rar = pick(st, rars);
    var solo = partySize(st) < 2;
    var ok = function (r) { return h.relics.indexOf(r.id) < 0 && (!exclude || exclude.indexOf(r.id) < 0) && !(solo && r.team); };
    var pool = D.RELICS.filter(function (r) { return r.rar === rar && ok(r); });
    if (!pool.length) pool = D.RELICS.filter(function (r) { return (rar === "boss" ? r.rar === "boss" : r.rar !== "boss") && ok(r); });
    return pool.length ? pick(st, pool).id : null;
  }

  function grantRelic(st, h, id) {
    var r = D.RELIC[id];
    if (!r || h.relics.indexOf(id) >= 0) return;
    h.relics.push(id);
    if (r.fx.maxHp) { h.max = Math.max(1, h.max + r.fx.maxHp); h.hp = Math.max(1, Math.min(h.max, h.hp + Math.max(0, r.fx.maxHp))); }
    log(st, { t: "relic", to: href(h), id: id });
  }

  // 營火回復的 %（苦痛 5：30 → 20；暴君之冠 −100 → 0）
  function restPct(st, h) { return Math.max(0, (tor(st, 5) ? 20 : 30) + relicSum(h, "restHeal")); }

  // 卡牌獎勵：三條成長方向各出一張（稀有度依種類擲骰，幸運符加稀有機率）；苦痛 8 隨機少一張
  function rewardCards(st, h, kind) {
    var cls = h.cls;
    var rareP = (kind === "boss" ? 1 : kind === "elite" ? 0.35 : 0.15) + relicSum(h, "rareUp");
    var out = D.CLASS[cls].paths.map(function (p) {
      var pool = D.CARDS.filter(function (c) { return c.cls === cls && c.path === p.id && unlocked(h, c); });
      var r = rnd(st);
      var rar = r < rareP ? "rare" : r < rareP + 0.35 ? "uncommon" : "common";
      var list = pool.filter(function (c) { return c.rar === rar; });
      return pick(st, list.length ? list : pool).id;
    });
    if (tor(st, 8)) out.splice(rint(st, out.length), 1);
    return out;
  }

  // ---------------- 地圖（Hellcard 式：每位英雄各自選目的地） ----------------
  // 兩個不重複的目的地（依 D.DESTS 的權重）
  // Boss 前一層：其中一個一定是營火（舊版 Boss 前固定有營火，改成可選）
  function rollDests(st) {
    var out = D.FLOORS[st.floor + 1] === "boss" ? ["camp"] : [];
    // 有隊友倒下：復活神殿一定是選項之一
    if (heroes(st).some(function (h) { return h.down; })) out.unshift("shrine");
    while (out.length < 2) {
      var pool = D.DESTS.filter(function (d) { return d.w > 0 && out.indexOf(d.id) < 0; });
      var total = 0;
      pool.forEach(function (d) { total += d.w; });
      var r = rnd(st) * total;
      for (var i = 0; i < pool.length; i++) { r -= pool[i].w; if (r <= 0 || i === pool.length - 1) { out.push(pool[i].id); break; } }
    }
    return out;
  }

  function enterFloor(st) {
    var boss = D.FLOORS[st.floor] === "boss";
    st.phase = "map";
    // 倒下的英雄不用選（自己的區域照一般敵人）
    heroes(st).forEach(function (h) {
      if (h.down) { h.dests = []; h.dest = "fallen"; } else { h.dests = boss ? ["boss"] : rollDests(st).slice(0, 2); h.dest = null; }
    });
    // 無盡模式的苦痛修正：第四幕起每 2 層全隊三選一（強度 1～3、持續 2～4 層）
    st.tmodPick = null;
    if (loopOf(st) > 0 && st.floor % 2 === 0) {
      st.tmodPick = shuffle(st, D.TMODS.slice()).slice(0, 3).map(function (m) { return { id: m.id, pw: 1 + rint(st, 3), left: 2 + rint(st, 3) }; });
    }
  }
  function allChosen(st) { return !st.tmodPick && heroes(st).every(function (x) { return !!x.dest; }); }

  function controllers(st) {
    var out = [];
    heroes(st).forEach(function (h) { if (out.indexOf(h.ctrl) < 0) out.push(h.ctrl); });
    return out;
  }

  // 全員選好目的地：開戰（Boss 層全員選「Boss」）
  function startFloor(st) {
    var boss = D.FLOORS[st.floor] === "boss";
    log(st, { t: "floor", act: st.act, floor: st.floor });
    startBattle(st, boss ? "boss" : "battle");
  }

  function nextFloor(st) {
    st.floor += 1;
    // 苦痛修正的剩餘層數
    st.tmods = (st.tmods || []).filter(function (m) { m.left -= 1; return m.left > 0; });
    if (st.floor >= D.FLOORS.length) {
      st.act += 1;
      st.floor = 0;
      heroes(st).forEach(function (h) { h.down = false; h.hp = h.max; });
      log(st, { t: "act", act: st.act });
    }
    enterFloor(st);
  }

  // ---------------- 建立 ----------------
  // seats：長度 4，每格 null 或 { cls（英雄 id）, name, ctrl }；扇形區依 seat 順序切
  function create(opts) {
    var st = {
      v: 5, seed: (opts.seed >>> 0) || ((Math.random() * 4294967296) >>> 0), uid: 0,
      hostCtrl: opts.hostCtrl || "local",
      phase: "map", act: 0, floor: 0, battleKind: null,
      // 苦痛等級 0～10、無盡模式（2026-10-23 使用者指定）
      torment: Math.max(0, Math.min(D.TORMENTS.length, Math.floor(Number(opts.torment) || 0))), endless: !!opts.endless,
      heroes: [null, null, null, null], secs: [], enemies: [], round: 0, log: [], logSeq: 0, tmods: [], tmodPick: null
    };
    (opts.seats || []).forEach(function (s, seat) {
      if (!s || !D.CLASS[s.cls] || seat >= D.MAX_SEATS) return;
      var cls = D.CLASS[s.cls];
      var h = {
        seat: seat, cls: s.cls, name: String(s.name || "").slice(0, 16), ctrl: s.ctrl || "local", owner: s.ctrl || "local",
        hp: cls.hp, max: cls.hp, mana: 0, down: false, pend: null, queue: [], relics: [],
        // 局外進度：英雄等級（決定解鎖的卡；沒給＝全部解鎖）、職業聖地強化次數、祭壇延續到下一場的效果
        lv: typeof s.lv === "number" ? Math.max(0, Math.floor(s.lv)) : 99, perk: 0, nextB: null,
        dests: [], dest: null,
        deck: cls.start.concat(st.torment >= 4 ? ["t_regret"] : []).map(function (id) { return newCard(st, id); }),
        draw: [], hand: [], disc: [], exh: []
      };
      if (st.torment >= 6) { h.max = Math.round(h.max * 0.9); h.hp = h.max; }
      resetBattleFields(h);
      st.heroes[seat] = h;
      st.secs.push(seat);
      // 出發遺物（局外進度解鎖的；不在清單上的忽略）
      if (s.art && D.STARTERS.some(function (x) { return x.id === s.art; })) grantRelic(st, h, s.art);
    });
    enterFloor(st);
    return st;
  }

  // ---------------- 出牌 ----------------
  function canPlay(st, h, c) {
    var d = cardDef(c);
    if (!d || d.unplayable) return false;
    return st.phase === "battle" && !h.down && !h.done && (h.mana >= d.cost || bloodCost(h, d) < h.hp);
  }
  // 契約祭壇：魔力不夠時每少 1 點改付 bloodMana 生命（沒有契約＝無限大）
  function bloodCost(h, d) { return h.pw.bloodMana ? (d.cost - h.mana) * h.pw.bloodMana : Infinity; }

  // 合法目標：{ e:[uid...], s:[seat...] }
  function validTargets(st, h, c) {
    var d = cardDef(c);
    var out = { e: [], s: [] };
    if (!d) return out;
    if (d.tgt === "enemy") out.e = inRange(st, d.rng).map(function (e) { return e.u; });
    else if (d.tgt === "ally") out.s = alive(st).map(function (x) { return x.seat; });
    else if (d.tgt === "down") out.s = heroes(st).filter(function (x) { return x.down; }).map(function (x) { return x.seat; });
    else if (d.tgt === "area") out.e = inRange(st, d.rng).map(function (e) { return e.u; }); // 範圍圈可能打到的敵人
    return out;
  }

  function play(st, h, u, tg) {
    var idx = -1;
    h.hand.forEach(function (c, i) { if (c.u === u) idx = i; });
    if (idx < 0) return "no_card";
    var c = h.hand[idx];
    var d = cardDef(c);
    if (!canPlay(st, h, c)) return "cannot_play";
    var vt = validTargets(st, h, c);
    var te = null, ts = null;
    if (d.tgt === "enemy") { if (!tg || vt.e.indexOf(tg.e) < 0) return "bad_target"; te = enemy(st, tg.e); }
    if (d.tgt === "ally" || d.tgt === "down") { if (!tg || vt.s.indexOf(tg.s) < 0) return "bad_target"; ts = hero(st, tg.s); }
    if (d.tgt === "self") ts = h;
    // 指定範圍卡：範圍圈要在戰場內，圈內至少要有一個射程內的敵人（打到誰在出牌當下決定）
    var zone = null;
    if (d.tgt === "area") {
      if (!tg || typeof tg.x !== "number" || typeof tg.y !== "number" || !isFinite(tg.x) || !isFinite(tg.y)) return "bad_target";
      if (Math.sqrt((tg.x - 50) * (tg.x - 50) + (tg.y - 50) * (tg.y - 50)) > GEO.edge) return "bad_target";
      zone = areaHits(st, d, tg.x, tg.y);
      if (!zone.length) return "bad_target";
    }
    var paid = 0;
    if (h.mana < d.cost) { paid = bloodCost(h, d); h.mana = 0; } else h.mana -= d.cost;
    h.hand.splice(idx, 1);
    var ring = te ? ringOf(te) : null;
    var entry = { t: "play", s: h.seat, c: c.id, up: !!c.up, to: te ? eref(te) : ts && ts !== h ? href(ts) : null, ring: d.near || d.far ? ring : null };
    if (zone) { entry.x = Math.round(tg.x * 10) / 10; entry.y = Math.round(tg.y * 10) / 10; entry.ar = d.ar; }
    log(st, entry);
    if (paid) { log(st, { t: "bloodPay", to: href(h), n: paid }); hitHero(st, h, paid, true); }
    // 近遠效果不同：依出牌當下目標所在的圈套用，再套共通效果；德魯伊的姿態加成看出牌當下的姿態
    var formNow = h.form;
    var list = (ring && d[ring] ? d[ring] : []).concat(d.fx).concat(formNow && d.forms && d.forms[formNow] ? d.forms[formNow] : []);
    // 出牌途中被荊棘打倒：後面的效果不再發動（牌進棄牌堆）
    list.forEach(function (f) { if (st.phase === "battle" && !h.down) runFx(st, h, d, f, te, ts, zone); });
    if (h.down) { h.disc.push(c); checkWin(st); return null; }
    // 武僧：每打出一張攻擊牌獲得氣
    if (d.type === "atk" && h.pw.chiAtk) gainChi(h, h.pw.chiAtk);
    // 鍊金術師的材料：每打出 reagent 張牌（藥水不算）做出一瓶隨機藥水
    if (h.pw.reagent && d.rar !== "token") {
      h.rg = (h.rg || 0) + 1;
      if (h.rg >= h.pw.reagent) { h.rg = 0; brew(st, h, h, "rand"); }
    }
    if (d.type === "pow") { /* 能力牌打出後離開牌堆（本場戰鬥） */ }
    else if (d.exhaust) h.exh.push(c);
    else h.disc.push(c);
    checkWin(st);
    return null;
  }

  function finaleAmount(h, f) { var n = f.n * Math.floor(h.mel / (f.per || 1)); h.mel = 0; return n; }

  // zone：指定範圍卡打到的敵人（範圍 op 只作用在這些敵人身上）；全範圍卡為 null
  function runFx(st, h, d, f, te, ts, zone) {
    var area = function () {
      var list = inRange(st, f.r || d.rng || "any");
      return zone ? list.filter(function (e) { return zone.indexOf(e) >= 0; }) : list;
    };
    var i, n;
    switch (f.o) {
      case "dmg":
        for (i = 0; i < (f.h || 1); i++) heroAttack(st, h, te, f.n);
        break;
      case "dmgAll":
        for (i = 0; i < (f.h || 1); i++) area().forEach(function (e) { heroAttack(st, h, e, f.n); });
        break;
      case "dmgSec":
        if (te) st.enemies.filter(function (e) { return e.hp > 0 && e.sec === te.sec; }).forEach(function (e) { heroAttack(st, h, e, f.n); });
        break;
      case "dmgBlock": heroAttack(st, h, te, h.blk * f.n); break;
      case "dmgExec": if (te) heroAttack(st, h, te, te.hp * 2 <= te.max ? f.n * 2 : f.n); break;
      case "dmgMissing": heroAttack(st, h, te, f.n + Math.floor((h.max - h.hp) / f.k)); break;
      case "dmgSpirit": heroAttack(st, h, te, f.n * h.sp); break;
      case "dmgMel": heroAttack(st, h, te, f.n * h.mel); break;
      case "hexDmg":
        if (te) heroAttack(st, h, te, f.n * DEBUFF_TYPES.filter(function (s) { return te.st[s] > 0; }).length);
        break;
      case "lifesteal":
        if (te) { n = heroAttack(st, h, te, f.n); if (n > 0) healHero(st, h, n); }
        break;
      case "detonate":
        if (te && te.st.burn > 0) { var b = te.st.burn; te.st.burn = 0; hitEnemy(st, te, b * f.n, false); }
        break;
      case "blk": gainBlock(st, h, f.n); break;
      case "blkAlly": if (ts) gainBlock(st, ts, f.n); break;
      case "blkAll": alive(st).forEach(function (x) { gainBlock(st, x, f.n); }); break;
      case "blkSpirit": gainBlock(st, h, f.n * h.sp); break;
      case "heal": healHero(st, ts || h, f.n); break;
      case "healAll": alive(st).forEach(function (x) { healHero(st, x, f.n); }); break;
      case "regen": if (ts) { ts.st.regen += f.n; log(st, { t: "st", to: href(ts), s: "regen", n: f.n }); } break;
      case "draw": drawCards(st, h, f.n); break;
      case "mana": h.mana += f.n; break;
      case "str": h.str += f.n; log(st, { t: "str", to: href(h), n: f.n }); break;
      case "strAll": alive(st).forEach(function (x) { x.str += f.n; log(st, { t: "str", to: href(x), n: f.n }); }); break;
      case "strAlly": if (ts) { ts.str += f.n; log(st, { t: "str", to: href(ts), n: f.n }); } break;
      case "st": if (te) addStatus(st, te, f.s, f.n, h); break;
      case "stAll": area().forEach(function (e) { addStatus(st, e, f.s, f.n, h); }); break;
      case "poisonX": if (te && te.st.poison > 0) addStatus(st, te, "poison", te.st.poison * (f.n - 1), null); break;
      case "push": if (te) moveEnemy(st, te, "far"); break;
      case "pull": if (te) moveEnemy(st, te, "near"); break;
      case "pushAll": inRange(st, "near").filter(function (e) { return !zone || zone.indexOf(e) >= 0; }).forEach(function (e) { moveEnemy(st, e, "far"); }); break;
      // 換區：拉到自己的扇形區／推到順時針的下一區／外圈全部推到下一區／把目標那一圈的敵人全部聚到目標的扇形區
      case "toMe": if (te) shiftEnemy(st, te, secOf(st, h.seat)); break;
      case "shove": if (te) shiftEnemy(st, te, (te.sec + 1) % sectorCount(st)); break;
      case "shoveAll": inRange(st, "far").filter(function (e) { return !isBoss(e); }).forEach(function (e) { shiftEnemy(st, e, (e.sec + 1) % sectorCount(st)); }); break;
      case "gather":
        if (te) st.enemies.filter(function (e) { return e.hp > 0 && e !== te && e.ring === te.ring; }).forEach(function (e) { shiftEnemy(st, e, te.sec); });
        break;
      case "pullSec":
        st.enemies.filter(function (e) { return e.hp > 0 && e.ring === "far" && e.sec === secOf(st, h.seat); }).forEach(function (e) { moveEnemy(st, e, "near"); });
        break;
      case "trap": h.trap += f.n; log(st, { t: "trap", to: href(h), n: f.n }); break;
      case "taunt": h.taunt = true; log(st, { t: "taunt", to: href(h) }); break;
      case "lose": hitHero(st, h, f.n, true); break;
      case "revive":
        if (ts && ts.down) {
          ts.down = false; ts.hp = Math.max(1, Math.ceil(ts.max * f.n / 100)); ts.blk = 0;
          ts.st = { weak: 0, vuln: 0, poison: 0, burn: 0, regen: 0 };
          log(st, { t: "revive", to: href(ts) });
          startHeroTurn(st, ts);
        }
        break;
      case "cleanse": if (ts) NEG_STATUS.forEach(function (s) { ts.st[s] = 0; }); break;
      case "cleanseAll": alive(st).forEach(function (x) { NEG_STATUS.forEach(function (s) { x.st[s] = 0; }); }); break;
      case "pow": h.pw[f.p] = (h.pw[f.p] || 0) + f.n; log(st, { t: "pow", to: href(h), p: f.p, n: f.n }); break;
      case "summon":
        n = Math.min(D.MAX_SPIRITS, h.sp + f.n) - h.sp;
        h.sp += n;
        if (n > 0) log(st, { t: "summonSp", to: href(h), n: n });
        break;
      case "spiritsAct": for (i = 0; i < f.n; i++) spiritsAttack(st, h); break;
      case "sac":
        n = h.sp;
        h.sp = 0;
        if (n > 0) log(st, { t: "sac", to: href(h), n: n });
        if (f.k === "blk") gainBlock(st, h, f.n * n);
        else if (f.k === "dmg") heroAttack(st, h, te, f.n * n);
        else if (f.k === "draw") drawCards(st, h, f.n * n);
        else if (f.k === "healAll") alive(st).forEach(function (x) { healHero(st, x, f.n * n); });
        else if (f.k === "dmgAll") inRange(st, "any").forEach(function (e) { heroAttack(st, h, e, f.n * n); });
        break;
      case "mel":
        h.mel = Math.min(D.MAX_MELODY, h.mel + f.n);
        break;
      case "finale":
        n = finaleAmount(h, f);
        log(st, { t: "finale", to: href(h), n: n });
        if (f.k === "blkAll") alive(st).forEach(function (x) { gainBlock(st, x, n); });
        else if (f.k === "healAll") alive(st).forEach(function (x) { healHero(st, x, n); });
        else if (f.k === "strAll") { if (n > 0) alive(st).forEach(function (x) { x.str += n; log(st, { t: "str", to: href(x), n: n }); }); }
        else if (f.k === "dmgAll") { if (n > 0) inRange(st, "any").forEach(function (e) { heroAttack(st, h, e, n); }); }
        else if (f.k === "dmg") { if (n > 0) heroAttack(st, h, te, n); }
        break;
      case "appeal": break;
      // 武僧
      case "chi": gainChi(h, f.n); break;
      case "chiIf":
        if ((h.chi || 0) >= f.c) { h.chi -= f.c; log(st, { t: "chiSpend", to: href(h), n: f.c }); f.fx.forEach(function (g) { if (st.phase === "battle") runFx(st, h, d, g, te, ts, zone); }); }
        break;
      // 德魯伊
      case "form":
        if (h.form !== f.f) {
          h.form = f.f;
          log(st, { t: "form", to: href(h), f: f.f });
          if (h.pw.formDraw) drawCards(st, h, h.pw.formDraw);
        }
        break;
      // 時空術士
      case "delay":
        h.later.push({ c: d.id, fx: clone(f.fx), e: te ? te.u : null, s: ts ? ts.seat : null }); log(st, { t: "delay", to: href(h) });
        if (h.pw.flux) h.flux = Math.min(D.MAX_FLUX, (h.flux || 0) + 1); // 延遲牌也累積時能
        break;
      case "recall": recall(st, h, f.n); break;
      // 鍊金術師
      case "brew": for (i = 0; i < (f.n || 1); i++) brew(st, h, f.ally && ts ? ts : h, f.c); break;
      // 賭徒
      case "roll":
        n = rollDie(st, h, f.a) * f.n;
        if (f.k === "dmg") heroAttack(st, h, te, n);
        else if (f.k === "dmgAll") inRange(st, f.r || "any").filter(function (e) { return !zone || zone.indexOf(e) >= 0; }).forEach(function (e) { heroAttack(st, h, e, n); });
        else if (f.k === "blk") gainBlock(st, h, n);
        else if (f.k === "blkAll") alive(st).forEach(function (x) { gainBlock(st, x, n); });
        else if (f.k === "heal") healHero(st, h, n);
        else if (f.k === "healAll") alive(st).forEach(function (x) { healHero(st, x, n); });
        break;
      case "gamble":
        (rollDie(st, h, f.a) >= 4 ? f.win : f.lose || []).forEach(function (g) { if (st.phase === "battle") runFx(st, h, d, g, te, ts, zone); });
        break;
    }
  }

  // ---------------- 選擇（獎勵／營火／寶箱） ----------------
  // 戰利品除了三選一，也可以改成升級一張卡（使用者指定：基本牌組在過關途中漸漸升級）
  function choose(st, h, c) {
    var p = h.pend;
    if (!p || !c) return "no_pending";
    var err = chooseOne(st, h, p, c);
    if (err) return err;
    if (!h.pend && h.queue && h.queue.length) h.pend = h.queue.shift();
    if (heroes(st).every(function (x) { return !x.pend; })) nextFloor(st);
    return null;
  }

  function chooseOne(st, h, p, c) {
    if (p.k === "relic") {
      if (c.skip) h.pend = null;
      else if (p.opts.indexOf(c.id) >= 0) { grantRelic(st, h, c.id); h.pend = null; }
      else return "bad_choice";
    } else if (p.k === "card") {
      if (c.skip) h.pend = null;
      else if (c.kind === "upgrade") h.pend = { k: "upgrade", back: "card", opts: p.opts };
      else if (p.opts.indexOf(c.id) >= 0) { h.deck.push(newCard(st, c.id)); h.pend = null; }
      else return "bad_choice";
    } else if (p.k === "rest") {
      if (c.kind === "heal") { h.hp = Math.min(h.max, h.hp + Math.ceil(h.max * restPct(st, h) / 100)); h.pend = null; }
      else if (c.kind === "upgrade") h.pend = { k: "upgrade", back: "rest" };
      else return "bad_choice";
    } else if (p.k === "altar") {
      // 祭壇（5 種，見 D.ALTARS）：accept＝接受這座祭壇的交易；skip＝離開
      if (c.skip) { h.pend = null; return null; }
      if (c.kind !== "accept") return "bad_choice";
      var A = D.ALTAR_NUM, al = p.a || "blood";
      if (al === "blood") {
        if (!p.relic || h.max <= D.ALTAR_HP) return "bad_choice";
        h.max -= D.ALTAR_HP; h.hp = Math.min(h.hp, h.max);
        log(st, { t: "altar", to: href(h), n: D.ALTAR_HP });
        grantRelic(st, h, p.relic); h.pend = null;
      } else if (al === "purify" || al === "trade") {
        if (h.deck.length <= 5) return "bad_choice";
        h.pend = { k: "remove", back: "altar", a: al, relic: p.relic };
      } else if (al === "pact") {
        h.nextB = h.nextB || {}; h.nextB.blood = A.pact; h.nextB.str = (h.nextB.str || 0) + 1;
        log(st, { t: "pact", to: href(h) }); h.pend = null;
      } else if (al === "war") {
        if (h.hp <= A.war) return "bad_choice";
        h.hp -= A.war;
        h.nextB = h.nextB || {}; h.nextB.str = (h.nextB.str || 0) + A.warStr;
        log(st, { t: "warAltar", to: href(h), n: A.war }); h.pend = null;
      } else return "bad_choice";
    } else if (p.k === "sanctum") {
      // 職業聖地：永久強化被動（最多 MAX_PERK 次），或從兩張稀有卡選一張
      if (c.skip) h.pend = null;
      else if (c.kind === "perk") {
        if ((h.perk || 0) >= D.MAX_PERK) return "bad_choice";
        h.perk = (h.perk || 0) + 1; log(st, { t: "perk", to: href(h), n: h.perk }); h.pend = null;
      } else if (c.id && p.opts.indexOf(c.id) >= 0) { h.deck.push(newCard(st, c.id)); h.pend = null; }
      else return "bad_choice";
    } else if (p.k === "upgrade" || p.k === "remove") {
      var back = p.back === "rest" ? { k: "rest" } : { k: p.back, opts: p.opts, relic: p.relic, a: p.a };
      if (c.back) { h.pend = p.back ? back : null; return null; }
      var i = -1;
      h.deck.forEach(function (x, j) { if (x.u === c.u) i = j; });
      if (i < 0) return "bad_choice";
      if (p.k === "upgrade") { if (h.deck[i].up) return "bad_choice"; h.deck[i].up = true; h.pend = null; }
      else {
        if (h.deck.length <= 5) return "bad_choice";
        log(st, { t: "removeCard", to: href(h), c: h.deck[i].id });
        h.deck.splice(i, 1);
        h.pend = null;
        // 交換祭壇：換最大生命；淨化祭壇：還可以再移除一張（back 沒有＝返回就是結束）
        if (p.a === "trade") { h.max += D.ALTAR_NUM.trade; h.hp += D.ALTAR_NUM.trade; log(st, { t: "maxHp", to: href(h), n: D.ALTAR_NUM.trade }); }
        else if (p.a === "purify" && p.back && h.deck.length > 5) h.pend = { k: "remove" };
      }
    }
    return null;
  }

  // ---------------- 入口 ----------------
  // action：{ t:"play", s, u, tg } / { t:"end", s, on } / { t:"dest", s, i } / { t:"tmod", i } / { t:"choose", s, c } / { t:"take", s } / { t:"reclaim", s }
  // 回傳 null（成功）或錯誤代碼字串
  function apply(st, ctrl, a) {
    if (!a || typeof a !== "object") return "bad_action";
    var h = typeof a.s === "number" ? hero(st, a.s) : null;
    var mine = h && h.ctrl === ctrl;
    switch (a.t) {
      case "play":
        if (!mine) return "not_yours";
        var perr = play(st, h, a.u, a.tg);
        // 自傷牌可能讓最後一個還沒結束的英雄倒下：這時也要結算回合
        if (!perr) maybeResolve(st);
        return perr;
      case "end":
        if (!mine || st.phase !== "battle" || h.down) return "not_yours";
        h.done = a.on !== false;
        maybeResolve(st);
        return null;
      case "dest":
        // 每位英雄各自選目的地；全員選好就開戰（還沒全員選好之前可以改）
        if (!mine) return "not_yours";
        if (st.phase !== "map" || typeof a.i !== "number" || !h.dests || !h.dests[a.i]) return "bad_vote";
        h.dest = h.dests[a.i];
        if (allChosen(st)) startFloor(st);
        return null;
      case "tmod":
        // 無盡模式的苦痛修正：隊伍裡任何一位玩家都可以選（AI 不選，除非全隊都是 AI——測試用）
        if (st.phase !== "map" || !st.tmodPick || typeof a.i !== "number" || !st.tmodPick[a.i]) return "bad_vote";
        if (controllers(st).indexOf(ctrl) < 0) return "not_yours";
        var tm = st.tmodPick[a.i];
        st.tmods = (st.tmods || []).concat([tm]);
        st.tmodPick = null;
        log(st, { t: "tmod", id: tm.id, n: tm.pw, left: tm.left });
        if (allChosen(st)) startFloor(st);
        return null;
      case "choose":
        if (!mine) return "not_yours";
        return choose(st, h, a.c);
      case "take":
        // 房主接手離線玩家的英雄
        if (!h || ctrl !== st.hostCtrl) return "not_host";
        h.ctrl = ctrl;
        return null;
      case "reclaim":
        // 原本的玩家回來了：把被代打的英雄拿回來（只有開局時坐這個位置的人可以）
        if (!h || !h.owner || h.owner !== ctrl || h.ctrl === ctrl) return "not_yours";
        h.ctrl = ctrl;
        return null;
    }
    return "bad_action";
  }

  root.PriTestYellowCore = {
    create: create, apply: apply,
    cardDef: cardDef, canPlay: canPlay, validTargets: validTargets, inRange: inRange, ringOf: ringOf, isBoss: isBoss,
    effActs: effActs, actTargets: actTargets, layout: layout, areaHits: areaHits, enemyRadius: enemyRadius, GEO: GEO,
    polar: polar, secSpan: secSpan, secStart: secStart, enemyHitValue: enemyHitValue, heroHitValue: heroHitValue,
    heroes: heroes, alive: alive, hero: hero, enemy: enemy, controllers: controllers,
    sectorCount: sectorCount, secOf: secOf, secOwner: secOwner, relicSum: relicSum,
    restPct: restPct, loopOf: loopOf, actDef: actDef, tmodVal: tmodVal, unlocked: unlocked, bloodCost: bloodCost,
    _rnd: rnd
  };
})();
