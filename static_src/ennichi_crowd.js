// ============================================================================
// 緣日樂園：看板人物（billboard sprite）共用群眾模組
//   由樣本頁 ennichi_lab.js 抽出，供樣本頁與 3D 樂園共用。
//   開場把 VRM 從 8 方向 × 4 格走路 × 4 種服裝渲染成圖集，
//   再用一個 InstancedBufferGeometry 畫出全部客人（1 draw call）。
//   THREE 於呼叫時才存取（本檔載入時 THREE 可能尚未就緒）。
// ============================================================================
(function () {
  "use strict";

  // 看板人物的服裝（top＝白衣材質、bottom＝緋袴材質、hair）
  var OUTFITS = [
    { top: "#2e3e6e", bottom: "#24305a", hair: "#3a2a20" },
    { top: "#f4a6bc", bottom: "#7a3ea0", hair: "#6b3e26" },
    { top: "#8fd0c0", bottom: "#3f7f74", hair: "#1e1a20" },
    { top: "#fbfaf8", bottom: "#d42a3c", hair: "#2b2233" },
  ];
  var CELL = 192, DIRS = 8, FRAMES = 4;
  var SIZE = 1.55; // 圖集一格對應的世界尺寸（正交相機的視野寬高）

  function bone(vrm, name) { return vrm.humanoid.getNormalizedBoneNode(name); }

  function restPose(vrm) {
    bone(vrm, "leftUpperArm").rotation.set(0, 0, -1.22);
    bone(vrm, "rightUpperArm").rotation.set(0, 0, 1.22);
    bone(vrm, "leftLowerArm").rotation.set(0, 0, -0.12);
    bone(vrm, "rightLowerArm").rotation.set(0, 0, 0.12);
    ["leftUpperLeg", "rightUpperLeg", "leftLowerLeg", "rightLowerLeg"].forEach(function (n) { bone(vrm, n).rotation.set(0, 0, 0); });
    ["spine", "chest", "neck", "head"].forEach(function (n) { bone(vrm, n).rotation.set(0, 0, 0); });
  }

  // 走路姿勢：phase 0〜2π
  function walkPose(vrm, phase, amp) {
    var s = Math.sin(phase);
    bone(vrm, "leftUpperLeg").rotation.x = -s * 0.45 * amp;
    bone(vrm, "rightUpperLeg").rotation.x = s * 0.45 * amp;
    bone(vrm, "leftLowerLeg").rotation.x = Math.max(0, s) * 0.55 * amp;
    bone(vrm, "rightLowerLeg").rotation.x = Math.max(0, -s) * 0.55 * amp;
    bone(vrm, "leftUpperArm").rotation.x = s * 0.35 * amp;
    bone(vrm, "rightUpperArm").rotation.x = -s * 0.35 * amp;
    bone(vrm, "spine").rotation.y = s * 0.08 * amp;
  }

  function recolor(vrm, outfit) {
    vrm.scene.traverse(function (o) {
      if (!o.isMesh) return;
      (Array.isArray(o.material) ? o.material : [o.material]).forEach(function (m) {
        var name = (m.name || "").split(" ")[0];
        var hex = name === "white" ? outfit.top : name === "red" ? outfit.bottom : name === "hair" ? outfit.hair : null;
        if (!hex) return;
        var c = new THREE.Color(hex); // 色彩管理已開，set 十六進位時會自動轉成 linear
        if (m.color) m.color.copy(c);
        if (m.shadeColorFactor) m.shadeColorFactor.copy(c).multiplyScalar(0.55);
      });
    });
  }

  function buildAtlas(renderer, vrm) {
    var aScene = new THREE.Scene();
    aScene.add(new THREE.HemisphereLight("#c8d0ff", "#4a3a30", 0.9));
    var key = new THREE.DirectionalLight("#ffe2c0", 0.7);
    key.position.set(1, 3, 4);
    aScene.add(key);
    aScene.add(vrm.scene);
    vrm.scene.traverse(function (o) { o.frustumCulled = false; });

    // 正交相機以身體中心（y=0.74）為準、略微俯視（約 11°），畫格寬高 = SIZE
    var half = SIZE / 2;
    var cam = new THREE.OrthographicCamera(-half, half, half, -half, 0.1, 20);
    cam.position.set(0, 0.74 + 5 * Math.tan(0.2), 5);
    cam.lookAt(0, 0.74, 0);

    var cols = DIRS, rows = FRAMES * OUTFITS.length;
    var rt = new THREE.WebGLRenderTarget(cols * CELL, rows * CELL, { depthBuffer: true });
    rt.texture.generateMipmaps = false;
    rt.texture.minFilter = THREE.LinearFilter;
    rt.texture.magFilter = THREE.LinearFilter;

    var prevClear = renderer.getClearColor(new THREE.Color()), prevAlpha = renderer.getClearAlpha();
    renderer.setRenderTarget(rt);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, true);
    renderer.autoClear = false;
    rt.scissorTest = true;
    OUTFITS.forEach(function (outfit, v) {
      recolor(vrm, outfit);
      for (var f = 0; f < FRAMES; f++) {
        restPose(vrm);
        // 4 格：左腳在前、交錯、右腳在前、交錯
        walkPose(vrm, f * Math.PI / 2 + Math.PI / 2, 1);
        vrm.expressionManager.setValue("happy", v % 2 ? 0.6 : 0);
        for (var d = 0; d < cols; d++) {
          vrm.scene.rotation.y = d * Math.PI / 4;
          // 彈簧骨（馬尾、袖子）記得上一格的世界座標：每格先把姿勢套上、再重設彈簧，否則轉向後頭髮會被甩歪
          vrm.humanoid.update();
          vrm.scene.updateMatrixWorld(true);
          if (vrm.springBoneManager) vrm.springBoneManager.reset();
          vrm.update(0);
          var x = d * CELL, y = (v * FRAMES + f) * CELL;
          rt.viewport.set(x, y, CELL, CELL);
          rt.scissor.set(x, y, CELL, CELL);
          renderer.setRenderTarget(rt);
          renderer.clearDepth();
          renderer.render(aScene, cam);
        }
      }
    });
    rt.scissorTest = false;
    renderer.autoClear = true;
    renderer.setRenderTarget(null);
    renderer.setClearColor(prevClear, prevAlpha);
    return rt.texture;
  }

  function material(tex, fog) {
    return new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: tex },
        uGrid: { value: new THREE.Vector2(DIRS, FRAMES * OUTFITS.length) },
        uSize: { value: SIZE },
        uTint: { value: new THREE.Color("#c9cfee") },
        uFog: { value: fog.color },
        uFogNear: { value: fog.near },
        uFogFar: { value: fog.far },
      },
      vertexShader: [
        "attribute vec3 iPos; attribute vec2 iCell; attribute float iScale;",
        "uniform vec2 uGrid; uniform float uSize;",
        "varying vec2 vUv; varying float vDepth;",
        "void main() {",
        "  vec3 right = normalize(vec3(viewMatrix[0][0], 0.0, viewMatrix[2][0]));",
        "  vec3 wp = iPos + right * (position.x * uSize * iScale) + vec3(0.0, position.y * uSize * iScale, 0.0);",
        "  vUv = (iCell + uv) / uGrid;",
        "  vec4 mv = viewMatrix * vec4(wp, 1.0);",
        "  vDepth = -mv.z;",
        "  gl_Position = projectionMatrix * mv;",
        "}",
      ].join("\n"),
      fragmentShader: [
        "uniform sampler2D uMap; uniform vec3 uTint; uniform vec3 uFog; uniform float uFogNear; uniform float uFogFar;",
        "varying vec2 vUv; varying float vDepth;",
        "void main() {",
        "  vec4 c = texture2D(uMap, vUv);",
        "  if (c.a < 0.5) discard;",
        // 圖集是不透明模型畫在透明黑底上，邊緣經線性取樣後等於「預乘 alpha」：除回去，邊緣才不會一圈黑點
        "  c.rgb /= c.a;",
        "  float f = smoothstep(uFogNear, uFogFar, vDepth);",
        "  gl_FragColor = vec4(mix(c.rgb * uTint, uFog, f), 1.0);",
        "}",
      ].join("\n"),
    });
  }

  function create(scene, tex, maxN) {
    var base = new THREE.PlaneGeometry(1, 1);
    base.translate(0, 0.5, 0);
    var geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute("position", base.attributes.position);
    geo.setAttribute("uv", base.attributes.uv);
    var iPos = new THREE.InstancedBufferAttribute(new Float32Array(maxN * 3), 3);
    var iCell = new THREE.InstancedBufferAttribute(new Float32Array(maxN * 2), 2);
    var iScale = new THREE.InstancedBufferAttribute(new Float32Array(maxN), 1);
    iPos.setUsage(THREE.DynamicDrawUsage); iCell.setUsage(THREE.DynamicDrawUsage); iScale.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("iPos", iPos); geo.setAttribute("iCell", iCell); geo.setAttribute("iScale", iScale);
    geo.instanceCount = 0;
    var mesh = new THREE.Mesh(geo, material(tex, scene.fog));
    mesh.frustumCulled = false;
    scene.add(mesh);
    return {
      mesh: mesh,
      set: function (i, x, y, z, dir, row, scale) { iPos.setXYZ(i, x, y, z); iCell.setXY(i, dir, row); iScale.setX(i, scale); },
      count: function (n) { geo.instanceCount = n; iPos.needsUpdate = true; iCell.needsUpdate = true; iScale.needsUpdate = true; },
    };
  }

  function dirIndex(heading, camX, camZ, x, z) {
    var k = Math.round((heading - Math.atan2(camX - x, camZ - z)) / (Math.PI / 4));
    return ((k % 8) + 8) % 8;
  }

  window.PriTestEnnichiCrowd = {
    OUTFITS: OUTFITS, CELL: CELL, DIRS: DIRS, FRAMES: FRAMES, SIZE: SIZE,
    restPose: restPose, walkPose: walkPose, buildAtlas: buildAtlas,
    create: create, dirIndex: dirIndex,
  };
})();
