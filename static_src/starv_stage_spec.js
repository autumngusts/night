// 明星經紀 starV：3D 演出的純函式規格（規格 §16）。不碰 three.js 與 DOM，node 也能測。
// 方向 → 場景／動作；外觀參數 → 角色規格（顏色與 2D 頭像共用）；站位；鏡頭腳本與鏡頭座標。
(function () {
  "use strict";

  var root = typeof window !== "undefined" ? window : globalThis;
  var D = root.PriTestStarvData;
  var Avatar = root.PriTestStarvAvatar;

  var SCENES = ["concert", "filmset", "studio", "booth", "theater", "news", "stream", "runway", "awards"];
  var MOTIONS = ["sing", "dance", "play", "act", "host", "pose", "walk", "bow", "award"];
  var SCENE_BY_DIR = {
    singer: "concert", idol: "concert", dancer: "concert", band: "concert", film: "filmset", drama: "filmset",
    stage: "theater", cm: "studio", model: "runway", host: "studio", comedy: "studio", anchor: "news",
    vtuber: "stream", influencer: "stream", voice: "booth", composer: "booth"
  };
  var MOTION_BY_DIR = {
    singer: "sing", idol: "dance", dancer: "dance", band: "play", film: "act", drama: "act", stage: "act",
    cm: "pose", model: "walk", host: "host", comedy: "host", anchor: "host", vtuber: "host", influencer: "pose",
    voice: "sing", composer: "play"
  };
  var DEFAULT_LOOK = { face: 0, hair: 0, hairColor: 0, eye: 0, outfit: 0, acc: -1, skin: 0 };
  var LENGTH = { job: 10, replay: 10, project: 18, awards: 9 };
  var SHOT_ORDER = ["wide", "push", "orbit", "low", "close"];

  function at(list, i) { var n = list.length; return list[((i % n) + n) % n]; }
  function sceneFor(dir) { return SCENE_BY_DIR[dir] || "studio"; }
  function motionFor(dir) { return MOTION_BY_DIR[dir] || "pose"; }

  function rig(look, gender) {
    look = look || DEFAULT_LOOK;
    var hair = ((look.hair % 12) + 12) % 12;
    return {
      skin: at(D.LOOK.skins, look.skin), hair: at(D.LOOK.hairColors, look.hairColor), hairLen: Math.floor(hair / 3), bangs: hair % 3,
      outfit: at(Avatar.OUTFITS, look.outfit), skirt: gender === "f" && look.outfit % 2 === 0, acc: look.acc == null ? -1 : look.acc,
      height: gender === "m" ? 1.04 : 1
    };
  }

  function slots(n) {
    var out = [];
    for (var i = 0; i < n; i++) out.push((i - (n - 1) / 2) * 1.1);
    return out;
  }

  function hash(s) { var h = 0; s = String(s || ""); for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); }

  function plan(opts) {
    var kind = opts.kind || "job";
    var duration = opts.duration || LENGTH[kind] || 10;
    var scene = kind === "awards" ? "awards" : opts.scene || sceneFor(opts.dir);
    var motion = kind === "awards" ? "award" : opts.motion || motionFor(opts.dir);
    var count = duration >= 15 ? 5 : 3, start = hash(opts.seed != null ? opts.seed : opts.dir) % SHOT_ORDER.length, shots = [];
    for (var i = 0; i < count; i++) {
      shots.push({ kind: i === 0 ? "wide" : SHOT_ORDER[(start + i) % SHOT_ORDER.length], start: duration * i / count, end: duration * (i + 1) / count });
    }
    shots[count - 1].end = duration;
    return { scene: scene, motion: motion, duration: duration, shots: shots };
  }

  function lerp(a, b, u) { return a + (b - a) * u; }
  function ease(u) { return u * u * (3 - 2 * u); }

  // 鏡頭座標（舞台中心在原點，地面 y = 0，藝人面向 +z）
  function camera(kind, u, x) {
    u = ease(Math.max(0, Math.min(1, u)));
    x = x || 0;
    if (kind === "push") return { pos: [lerp(0, x * 0.5, u), lerp(2.2, 1.7, u), lerp(7, 3.4, u)], look: [x * 0.5, 1.3, 0] };
    if (kind === "orbit") { var a = lerp(-0.9, 0.9, u); return { pos: [Math.sin(a) * 5, 2, Math.cos(a) * 5], look: [0, 1.2, 0] }; }
    if (kind === "low") return { pos: [lerp(1.6, -1.2, u), 0.45, 3.6], look: [x, 1.7, 0] };
    if (kind === "close") return { pos: [x + 0.25, 1.65, lerp(2.2, 1.7, u)], look: [x, 1.55, 0] };
    return { pos: [0, lerp(2.6, 2.3, u), lerp(8, 7.4, u)], look: [0, 1.2, 0] };
  }

  root.PriTestStarvStageSpec = {
    SCENES: SCENES, MOTIONS: MOTIONS, sceneFor: sceneFor, motionFor: motionFor, rig: rig, slots: slots, plan: plan, camera: camera
  };
})();
