/* イヌスノー（狗雪）單板物理（docs/inusnow_design.md §3）。固定步長 1/60 秒。
   不碰 DOM、不讀寫 localStorage；只用 + − × ÷、Math.sqrt、Math.abs、比較（設計 §11：之後移植成 Go，同一組輸入要得到同樣的結果）。
   輸入：{s: −8..8 轉向（右為正）, c: 0/1 蹲低, j: 0/1 起跳, g: 0..6 抓板, z: 0/1 興奮度發動（P2）}。
   env：{terrain, snow, spinMul?（Slopestyle 的轉體倍率）, rut?（G1 溝痕）,
        P3：surf(x, z)?（路面雪質）, grip?, muAdd?, wind?: [ax, az], cold?（每秒速度損失）, brake?（救難犬挖掘時煞停）}；
   沒有這些欄位時與第 1 階段完全相同。 */
(function (root) {
  "use strict";

  var D = root.PriTestInusnowData || (typeof require === "function" ? require("./inusnow_data.js") : null);
  var T = root.PriTestInusnowTerrain || (typeof require === "function" ? require("./inusnow_terrain.js") : null);
  var P = D.PHYS;
  var Z = D.ZOOM, RU = D.RUT;
  var DT = 1 / P.hz;

  function statMul(v) { return D.STAT_LO + D.STAT_SPAN * v / 100; }

  // 犬種能力 → 物理乘數（設計 §5.1）
  function dogMods(dog) {
    var st = (dog && dog.stats) || { bal: 50, pow: 50, brv: 50, tec: 50, siz: 50, cld: 50 };
    return {
      grip: statMul(st.bal),
      land: statMul(st.bal),
      skid: 2 - statMul(st.pow),          // 力量越高，橫滑減速越少
      push: statMul(st.pow),
      ollie: statMul(st.brv),
      turn: statMul(st.tec),
      spin: statMul(st.tec),
      drag: 2 - statMul(st.siz),          // 體型越大，每單位質量的空氣阻力越小
    };
  }

  function create(terrain, start, dog) {
    var y = T.height(terrain, start.x, start.z);
    var sp = P.startSpeed;
    return {
      p: [start.x, y, start.z],
      v: [start.tx * sp, 0, start.tz * sp],
      h: [start.tx, start.tz],
      air: false, crouch: 0, edge: 0, yawAir: 0, airSteps: 0,
      fall: 0, t: 0, mods: dogMods(dog), boost: 1,
      zoom: 0, zoomT: 0, zoomHalf: false, scent: 0, scentShow: 0, scentIn: -1,
    };
  }

  function speed(st) { return Math.sqrt(st.v[0] * st.v[0] + st.v[1] * st.v[1] + st.v[2] * st.v[2]); }

  // 板頭方向往右（ω>0）轉 ω·dt：h ← normalize(h + ω·dt·r)，r＝(−hz, hx)
  function turnHeading(st, w) {
    var hx = st.h[0] + w * DT * (-st.h[1]);
    var hz = st.h[1] + w * DT * st.h[0];
    var l = Math.sqrt(hx * hx + hz * hz) || 1;
    st.h[0] = hx / l; st.h[1] = hz / l;
  }

  function step(st, input, env) {
    var t = env.terrain, m = st.mods;
    var snowKey = env.surf ? env.surf(st.p[0], st.p[2]) : (env.snow || "groomed");
    var snow = D.SNOW[snowKey] || D.SNOW.groomed;
    var ev = [];
    st.t += 1;
    var steer = (input.s || 0) / 8;
    // 蹲低與邊刃（畫面用）
    var ct = input.c ? 1 : 0;
    var dc = ct - st.crouch, mx = P.crouchRate * DT;
    if (dc > mx) dc = mx; else if (dc < -mx) dc = -mx;
    st.crouch += dc;
    st.edge += (steer - st.edge) * 0.15;

    var v = st.v, p = st.p;

    // S2 興奮度：量表滿時輸入 z 發動 240 步（設計 §17.5）
    if (input.z && st.zoomT === 0 && st.zoom >= Z.max && st.fall === 0) {
      st.zoomT = Z.steps; st.zoom = 0;
      ev.push("zoom");
    }
    var zooming = st.zoomT > 0;
    if (zooming) {
      st.zoomT -= 1;
      if (st.zoomT === 0) { st.zoomHalf = false; ev.push("zoomEnd"); }
    }

    if (st.fall > 0) {
      st.fall -= 1;
      v[0] *= 0.94; v[1] *= 0.94; v[2] *= 0.94;
      if (st.fall === 0) ev.push("recover");
      steer = 0;
    }

    if (!st.air) {
      var n = T.normal(t, p[0], p[2]);
      // 速度貼著坡面
      var vn = v[0] * n[0] + v[1] * n[1] + v[2] * n[2];
      v[0] -= vn * n[0]; v[1] -= vn * n[1]; v[2] -= vn * n[2];
      // 重力的切向分量
      var g = P.g;
      v[0] += (0 - (-g * n[1]) * n[0]) * DT;
      v[1] += (-g - (-g * n[1]) * n[1]) * DT;
      v[2] += (0 - (-g * n[1]) * n[2]) * DT;
      var sp = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);

      // G1 溝痕：所在格的深度 d（0～1）
      var rd = 0, rc = null;
      if (env.rut) {
        rc = T.rutAt(env.rut, p[0], p[2]);
        if (rc) { rd = rc.n / RU.max; if (rd <= RU.minD) rd = 0; }
      }
      if (st.fall === 0) {
        // 轉向：低速好轉、蹲低難轉
        var w = steer * P.turnBase * m.turn / (1 + sp / P.turnSpeedRef) * (1 - P.crouchTurn * st.crouch);
        if (zooming) w *= Z.turn;
        if (rd > 0) w *= 1 - RU.turn * rd;
        turnHeading(st, w);
        // 板子在坡面上的方向 b（速度在板子後方時視為反腳滑行，b 反向）
        var bx = st.h[0], bz = st.h[1];
        var by = -(n[0] * bx + n[2] * bz) / n[1];
        var bl = Math.sqrt(bx * bx + by * by + bz * bz);
        bx /= bl; by /= bl; bz /= bl;
        var vb = v[0] * bx + v[1] * by + v[2] * bz;
        if (vb < 0) { bx = -bx; by = -by; bz = -bz; vb = -vb; }
        var lx = v[0] - vb * bx, ly = v[1] - vb * by, lz = v[2] - vb * bz;
        var lat = Math.sqrt(lx * lx + ly * ly + lz * lz);
        var cap = P.gripAccel * snow.grip * m.grip * DT * (zooming ? Z.grip : 1) * (env.grip || 1);
        if (lat <= cap) {
          // 刻滑：側向速度轉成板子方向，速度大小幾乎不變
          var keep = sp * (1 - P.carveLoss * lat);
          v[0] = bx * keep; v[1] = by * keep; v[2] = bz * keep;
        } else if (lat > 0) {
          // 橫滑：只消掉 cap，超出的部分造成減速
          var r = 1 - cap / lat;
          v[0] = vb * bx + lx * r; v[1] = vb * by + ly * r; v[2] = vb * bz + lz * r;
          var dec = P.skidDecel * m.skid * DT * (1 - cap / lat);
          var sp2 = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
          if (sp2 > 0) {
            var f = sp2 > dec ? (sp2 - dec) / sp2 : 0;
            v[0] *= f; v[1] *= f; v[2] *= f;
          }
          if (lat - cap > 1.2) ev.push("skid");
        }
      }
      // 溝痕：速度方向和溝的方向差 > 20° 時減速，並被帶往溝的方向
      if (rd > 0 && st.fall === 0) {
        var rl = Math.sqrt(rc.dx * rc.dx + rc.dz * rc.dz);
        var vhs = Math.sqrt(v[0] * v[0] + v[2] * v[2]);
        if (rl > 0 && vhs > 0.5) {
          var rx = rc.dx / rl, rz = rc.dz / rl;
          var cs = (rx * v[0] + rz * v[2]) / vhs;
          if (cs < 0) { rx = -rx; rz = -rz; cs = -cs; }
          if (cs < RU.cosLimit) {
            var kd2 = 1 - RU.decel * rd * DT / vhs;
            if (kd2 < 0) kd2 = 0;
            v[0] *= kd2; v[1] *= kd2; v[2] *= kd2;
            var px2 = rx - cs * v[0] / vhs, pz2 = rz - cs * v[2] / vhs, pl = Math.sqrt(px2 * px2 + pz2 * pz2);
            if (pl > 0) { v[0] += px2 / pl * RU.pull * rd * DT; v[2] += pz2 / pl * RU.pull * rd * DT; }
          }
        }
      }
      // 興奮度：沿速度方向加速
      if (zooming && st.fall === 0) {
        var sz = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
        if (sz > 0.1) {
          var ka = 1 + Z.accel * (st.zoomHalf ? 0.5 : 1) * m.push * DT / sz;
          v[0] *= ka; v[1] *= ka; v[2] *= ka;
        }
      }
      // 雪面摩擦
      sp = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
      if (sp > 0) {
        var fr = (snow.mu + (env.muAdd || 0)) * P.g * n[1] * DT;
        var k = sp > fr ? (sp - fr) / sp : 0;
        v[0] *= k; v[1] *= k; v[2] *= k;
      }
      // 起跳（ollie）
      if (input.j && st.fall === 0) {
        var vo = P.vOllie * m.ollie;
        v[0] += n[0] * vo; v[1] += n[1] * vo; v[2] += n[2] * vo;
        st.air = true; st.yawAir = 0; st.airSteps = 0;
        ev.push("ollie");
      }
    } else {
      // 空中：重力；轉向輸入＝轉體
      v[1] -= P.g * DT;
      if (st.fall === 0 && steer !== 0) {
        var ws = steer * P.spinRate * m.spin * (env.spinMul || 1);
        turnHeading(st, ws);
        st.yawAir += ws * DT;
      }
      st.airSteps += 1;
    }

    // P3：側風、寒冷、挖掘時煞停
    if (env.wind) { v[0] += env.wind[0] * DT; v[2] += env.wind[1] * DT; }
    if (env.cold) { var kc = 1 - env.cold * DT; v[0] *= kc; v[1] *= kc; v[2] *= kc; }
    if (env.brake && !st.air) { var kb = 1 - 6 * DT; v[0] *= kb; v[1] *= kb; v[2] *= kb; }

    // 空氣阻力（蹲低減阻）與完美旗門的加速倍率
    var spd = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
    if (spd > 0) {
      var drag = P.kAir * m.drag * (1 - P.crouchDrag * st.crouch) * spd * DT;
      var kd = drag < 1 ? 1 - drag : 0;
      v[0] *= kd; v[1] *= kd; v[2] *= kd;
    }

    // 移動
    p[0] += v[0] * DT; p[1] += v[1] * DT; p[2] += v[2] * DT;
    var gy = T.height(t, p[0], p[2]);

    if (st.air) {
      if (p[1] <= gy) {
        p[1] = gy;
        st.air = false;
        land(st, t, ev, snowKey);
      }
    } else if (p[1] - gy > P.takeoffGap) {
      // 地面往下掉得比速度能貼住的快：離地
      st.air = true; st.yawAir = 0; st.airSteps = 0;
      ev.push("takeoff");
    } else {
      p[1] = gy;
    }
    return ev;
  }

  // 落地判定（設計 §3.3）：板子與水平速度方向的夾角
  function land(st, t, ev, snowKey) {
    var v = st.v;
    var n = T.normal(t, st.p[0], st.p[2]);
    var vh = Math.sqrt(v[0] * v[0] + v[2] * v[2]);
    var c = vh > 0.5 ? Math.abs((st.h[0] * v[0] + st.h[1] * v[2]) / vh) : 1;
    var vn = v[0] * n[0] + v[1] * n[1] + v[2] * n[2];
    v[0] -= vn * n[0]; v[1] -= vn * n[1]; v[2] -= vn * n[2];
    if (c >= P.landClean * (2 - st.mods.land) || st.airSteps < 6) {
      ev.push("land");
    } else if (c >= P.landSketchy) {
      v[0] *= P.sketchyKeep; v[1] *= P.sketchyKeep; v[2] *= P.sketchyKeep;
      ev.push("sketchy");
    } else {
      v[0] *= P.fallKeep; v[1] *= P.fallKeep; v[2] *= P.fallKeep;
      st.fall = snowKey === "powder" || snowKey === "deep" ? P.fallStepsPowder : P.fallSteps;   // 粉雪摔倒只停 60 步（設計 §6）
      ev.push("fall");
    }
    // 落地後板頭對齊速度方向（較近的那一端）
    if (vh > 0.5 && st.fall > 0) {
      var sx = v[0], sz = v[2], l = Math.sqrt(sx * sx + sz * sz) || 1;
      st.h[0] = sx / l; st.h[1] = sz / l;
    }
  }

  // 撞到障礙（樹、Cross 的空中碰撞）：直接摔倒
  function knock(st) {
    if (st.fall > 0) return false;
    st.v[0] *= P.fallKeep; st.v[1] *= P.fallKeep; st.v[2] *= P.fallKeep;
    st.fall = P.fallSteps;
    st.zoomT = 0;
    return true;
  }

  var Phys = { create: create, step: step, speed: speed, dogMods: dogMods, knock: knock, DT: DT };
  root.PriTestInusnowPhys = Phys;
  if (typeof module !== "undefined" && module.exports) module.exports = Phys;
})(typeof window !== "undefined" ? window : globalThis);
